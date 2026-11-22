/**
 * Matériaux des chunks.
 *
 * CHOIX DU SHADER DE RÉPÉTITION DES TUILES : atlas 2D + ShaderMaterial maison + fract().
 * Le greedy mesher produit des quads de plusieurs blocs ; pour que la tuile se RÉPÈTE au
 * lieu de s'étirer, chaque sommet porte des UV « locaux » exprimés en blocs (0..w, 0..h) et
 * l'index de sa tuile. Le fragment shader calcule fract(uv) puis l'adresse dans la cellule
 * de la tuile au sein de l'atlas.
 *
 * Pourquoi pas une DataArrayTexture (WebGL2) ?
 * - le contrat `TextureAtlas` (une texture + index de tuiles) reste valable pour l'UI (icônes de la
 *   palette, particules) et pour assembler un pack de PNG en Phase 2 sans autre format ;
 * - une seule texture 2D, un seul échantillonneur : le plus portable et le moins coûteux
 *   sur GPU mobile d'entrée de gamme ;
 * - le défaut connu de fract() avec un atlas (couture due aux dérivées des mipmaps) ne se
 *   pose pas : NearestFilter sans mipmaps, rendu « pixel art » voulu, monde petit (96 blocs)
 *   donc peu de scintillement au loin. Les coordonnées sont en plus bornées à un demi-texel
 *   de la tuile et l'atlas extrude les bords (padding) : aucun bleeding entre tuiles.
 * - un ShaderMaterial non éclairé (ombrage précalculé par face × AO dans un attribut) est
 *   bien plus léger qu'un MeshLambert/Standard : important pour tenir 30 fps sur tablette.
 */
import * as THREE from 'three';
import type { TextureAtlas } from './atlas';

const vertexShader = /* glsl */ `
attribute float tile;
attribute float shade;
varying vec2 vUv;
varying float vTile;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vTile = tile;
  vShade = shade;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uAtlasSize;
uniform float uCell;
uniform float uPad;
uniform float uTileSize;
uniform float uTilesPerRow;
uniform float uAlphaTest;
uniform float uOpacity;
varying vec2 vUv;
varying float vTile;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  float t = floor(vTile + 0.5);
  float row = floor((t + 0.5) / uTilesPerRow);
  float col = t - row * uTilesPerRow;
  // Répétition de la tuile : fract() des UV locaux (en blocs), bornée à un demi-texel.
  float h = 0.5 / uTileSize;
  vec2 f = clamp(fract(vUv), h, 1.0 - h);
  // Atlas en flipY = false : v croît vers le bas de l'image, d'où (1 - f.y).
  vec2 px = vec2(col * uCell + uPad + f.x * uTileSize, row * uCell + uPad + (1.0 - f.y) * uTileSize);
  vec4 c = texture2D(uMap, px / uAtlasSize);
  if (c.a < uAlphaTest) discard;
  gl_FragColor = vec4(c.rgb * vShade, c.a * uOpacity);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------------------
// Matériau « gemme » (blocs pleins de diamant, d'or, d'émeraude) : effet F « Mélange » de la
// démo demos/gems.html — reflet spéculaire + fresnel dépendant de la vue (doux) et étincelles
// rares (grille 2×2 par face, ~1 case sur 3 active, clignotement lent).
//
// C'est le shader des chunks (mêmes attributs, même adressage d'atlas, ombrage × AO, brouillard)
// auquel s'ajoutent :
// - l'attribut `face` (0..5, envoyé au GPU pour la géométrie gemme SEULEMENT) → normale et
//   tangentes de la face ;
// - la position MONDE → direction de la caméra et cellule du bloc,
//   floor(position − normale × 0,5) : valable aussi sur les quads fusionnés par le greedy mesher
//   (chaque bloc d'un grand quad a ses propres étincelles) ;
// - la matière déduite de l'index de tuile : `uGoldTile` → reflet doré (métal) pour l'or,
//   blanc pour les pierres (diamant, émeraude).
// Fragment en highp (obligatoire en WebGL2) : le hash des étincelles et la position monde
// perdraient leur stabilité en mediump.
// ---------------------------------------------------------------------------

const gemVertexShader = /* glsl */ `
attribute float tile;
attribute float shade;
attribute float face;
varying vec2 vUv;
varying float vTile;
varying float vShade;
varying float vFace;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vTile = tile;
  vShade = shade;
  vFace = face;
  // Repère de la face, cohérent avec les UV du mesher (switch de emitQuad).
  // Les chunks ne sont que translatés : espace objet = espace monde pour les directions.
  int f = int(face + 0.5);
  if (f == 0)      { vN = vec3( 1, 0, 0); vT = vec3(0, 0,-1); vB = vec3(0, 1, 0); }
  else if (f == 1) { vN = vec3(-1, 0, 0); vT = vec3(0, 0, 1); vB = vec3(0, 1, 0); }
  else if (f == 2) { vN = vec3( 0, 1, 0); vT = vec3(1, 0, 0); vB = vec3(0, 0,-1); }
  else if (f == 3) { vN = vec3( 0,-1, 0); vT = vec3(1, 0, 0); vB = vec3(0, 0, 1); }
  else if (f == 4) { vN = vec3( 0, 0, 1); vT = vec3(1, 0, 0); vB = vec3(0, 1, 0); }
  else             { vN = vec3( 0, 0,-1); vT = vec3(-1,0, 0); vB = vec3(0, 1, 0); }
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const gemFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec2 uAtlasSize;
uniform float uCell;
uniform float uPad;
uniform float uTileSize;
uniform float uTilesPerRow;
uniform float uTime;
uniform vec3 uSunDir;
uniform float uGoldTile;
varying vec2 vUv;
varying float vTile;
varying float vShade;
varying float vFace;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
#include <fog_pars_fragment>

// Hash sans sinus (stable en précision limitée).
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// « Envmap » analytique : dégradé ciel / horizon / sol + soleil. Rien à télécharger.
vec3 envColor(vec3 r) {
  vec3 sky = mix(vec3(0.80, 0.93, 1.00), vec3(0.30, 0.60, 1.00), clamp(r.y * 1.4, 0.0, 1.0));
  vec3 gnd = mix(vec3(0.45, 0.42, 0.36), vec3(0.22, 0.36, 0.16), clamp(-r.y * 2.0, 0.0, 1.0));
  vec3 c = mix(gnd, sky, smoothstep(-0.06, 0.06, r.y));
  float sun = pow(max(dot(r, uSunDir), 0.0), 120.0);
  return c + vec3(1.0, 0.97, 0.88) * sun * 2.5;
}

// Étoile à 4 branches centrée sur d (coordonnées de cellule), taille ~ 1/k.
float star(vec2 d, float k) {
  float core = max(0.0, 1.0 - length(d) * k * 2.2);
  float ax = max(0.0, 1.0 - abs(d.x) * k * 9.0) * max(0.0, 1.0 - abs(d.y) * k);
  float ay = max(0.0, 1.0 - abs(d.y) * k * 9.0) * max(0.0, 1.0 - abs(d.x) * k);
  return core * core * 1.6 + ax + ay;
}

// Étincelles : grille g×g par face, une fraction « density » des cases active, clignotement lent.
float sparkles(vec2 f, vec3 cell, float g, float density, float k) {
  vec2 q = f * g;
  vec2 gi = floor(q);
  vec2 gf = fract(q) - 0.5;
  vec3 seed = cell * 1.731 + vec3(gi, vFace * 3.17);
  float h1 = hash13(seed);
  float h2 = hash13(seed + 19.19);
  float h3 = hash13(seed + 7.7);
  vec2 d = gf - (vec2(h1, h2) - 0.5) * 0.45;
  float rate = 0.9 + h3 * 1.3;
  float tw = sin(uTime * rate + h2 * 6.2832);
  tw = pow(max(tw, 0.0), 10.0);
  return step(1.0 - density, h3) * tw * star(d, k);
}

void main() {
  float t = floor(vTile + 0.5);
  float row = floor((t + 0.5) / uTilesPerRow);
  float col = t - row * uTilesPerRow;
  float hp = 0.5 / uTileSize;
  vec2 f = clamp(fract(vUv), hp, 1.0 - hp);
  vec2 px = vec2(col * uCell + uPad + f.x * uTileSize, row * uCell + uPad + (1.0 - f.y) * uTileSize);
  vec3 base = texture2D(uMap, px / uAtlasSize).rgb;

  float isGold = 1.0 - step(0.5, abs(t - uGoldTile));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 cell = floor(vWorld - vN * 0.5);
  vec2 p = f - 0.5;
  vec3 c = base * vShade;
  // Teinte des reflets : blanche pour les pierres, dorée pour le métal.
  vec3 glint = mix(vec3(1.0), mix(base, vec3(1.0, 0.95, 0.75), 0.45) * 1.25, isGold);

  // Normale « coussin » : légèrement bombée → la tache de lumière glisse sur la face.
  vec3 n = normalize(vN + (vT * p.x + vB * p.y) * 1.1);
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(n, H), 0.0);
  float sp = pow(nh, 28.0) * 0.7 + pow(nh, 5.0) * 0.12;
  float fres = pow(1.0 - max(dot(vN, V), 0.0), 2.5) * 0.35;
  vec3 R = reflect(-V, vN);
  c += glint * sp + envColor(R) * fres * mix(vec3(1.0), base * 1.4, isGold);

  c += glint * sparkles(f, cell, 2.0, 0.35, 2.4);

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------------------
// Matériau « eau » : shader des chunks + animation peu coûteuse (aucune texture en plus).
// - Dessus / dessous : la tuile dérive lentement en diagonale, avec une petite ondulation
//   (sinus de la position monde) → surface qui « vit ».
// - Côtés : la tuile défile VERS LE BAS (effet de chute, visible surtout sur la cascade).
// - Teinte bleue multipliée + reflet clair qui ondule ; alpha ≈ 0,7 (on voit le fond).
// Les décalages temporels sont réduits par fract() dans le VERTEX shader (highp) : le fragment
// shader ne manipule que de petites valeurs, sans perte de précision en mediump sur mobile.
// Double face (on voit la surface depuis dessous l'eau) en une seule passe (forceSinglePass).
// ---------------------------------------------------------------------------

const waterVertexShader = /* glsl */ `
attribute float tile;
attribute float shade;
attribute float face;
uniform float uTime;
varying vec2 vUv;
varying float vTile;
varying float vShade;
varying float vSide;
varying vec2 vOff;
varying vec2 vWave;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vTile = tile;
  vShade = shade;
  int f = int(face + 0.5);
  vSide = (f == 2 || f == 3) ? 0.0 : 1.0;
  // Dessus : dérive lente ; côtés : chute (v augmente → le motif descend).
  vOff = vSide > 0.5 ? vec2(0.0, fract(uTime * 0.9)) : fract(vec2(uTime * 0.05, uTime * 0.031));
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // Phase de l'ondulation : position monde, ramenée dans [0, 2π) par sommet.
  float tw = mod(uTime, 6.2831853);
  vWave = vec2(wp.x * 0.9 + wp.z * 0.6 + tw * 1.7, wp.z * 1.1 - wp.x * 0.4 + tw * 1.3);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const waterFragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uAtlasSize;
uniform float uCell;
uniform float uPad;
uniform float uTileSize;
uniform float uTilesPerRow;
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vUv;
varying float vTile;
varying float vShade;
varying float vSide;
varying vec2 vOff;
varying vec2 vWave;
#include <fog_pars_fragment>
void main() {
  float t = floor(vTile + 0.5);
  float row = floor((t + 0.5) / uTilesPerRow);
  float col = t - row * uTilesPerRow;
  float h = 0.5 / uTileSize;
  vec2 wob = vec2(sin(vWave.x), cos(vWave.y)) * 0.04 * (1.0 - vSide);
  vec2 f = clamp(fract(vUv + vOff + wob), h, 1.0 - h);
  vec2 px = vec2(col * uCell + uPad + f.x * uTileSize, row * uCell + uPad + (1.0 - f.y) * uTileSize);
  vec3 c = texture2D(uMap, px / uAtlasSize).rgb * uTint * vShade;
  // Reflet clair qui ondule (dessus seulement).
  c += vec3(0.10, 0.13, 0.16) * (0.5 + 0.5 * sin(vWave.x + vWave.y)) * (1.0 - vSide);
  gl_FragColor = vec4(c, uOpacity + vSide * 0.1);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * Direction du soleil (vers le soleil) des reflets : haut, côté +X / +Z, cohérente avec
 * l'ombrage précalculé des faces (FACE_LIGHT du mesher : +Y > +Z > +X).
 */
export const GEM_SUN_DIR = new THREE.Vector3(0.35, 0.75, 0.55).normalize();

export interface ChunkMaterials {
  opaque: THREE.ShaderMaterial;
  /** Feuilles : alpha binaire, écrit la profondeur, double face. */
  cutout: THREE.ShaderMaterial;
  /** Verre : mélange alpha, n'écrit pas la profondeur. */
  blend: THREE.ShaderMaterial;
  /**
   * Blocs précieux pleins : reflet + fresnel + étincelles (effet F). Opaque. Uniformes
   * `uTime` (secondes, à avancer chaque frame : WorldRenderer.setTime) et `uSunDir`.
   */
  gem: THREE.ShaderMaterial;
  /**
   * Eau : semi-transparente (n'écrit pas la profondeur), double face, animée par `uTime`
   * (même horloge que les gemmes : WorldRenderer.setTime).
   */
  water: THREE.ShaderMaterial;
  dispose(): void;
}

export function createChunkMaterials(atlas: TextureAtlas): ChunkMaterials {
  // Uniformes d'atlas PARTAGÉS (mêmes objets) par les quatre matériaux.
  const shared = {
    uMap: { value: atlas.texture as THREE.Texture },
    uAtlasSize: { value: new THREE.Vector2(atlas.width, atlas.height) },
    uCell: { value: atlas.tileSize + 2 * atlas.padding },
    uPad: { value: atlas.padding },
    uTileSize: { value: atlas.tileSize },
    uTilesPerRow: { value: atlas.tilesPerRow },
  };

  const make = (alphaTest: number, opts: THREE.ShaderMaterialParameters) =>
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...shared,
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uAlphaTest: { value: alphaTest },
        uOpacity: { value: 1 },
      },
      fog: true,
      ...opts,
    });

  const opaque = make(0, { transparent: false, depthWrite: true, side: THREE.FrontSide });
  const cutout = make(0.5, { transparent: false, depthWrite: true, side: THREE.DoubleSide });
  const blend = make(0.02, { transparent: true, depthWrite: false, side: THREE.FrontSide });
  opaque.name = 'chunk-opaque';
  cutout.name = 'chunk-cutout';
  blend.name = 'chunk-blend';

  const gem = new THREE.ShaderMaterial({
    vertexShader: gemVertexShader,
    fragmentShader: gemFragmentShader,
    uniforms: {
      ...shared,
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uSunDir: { value: GEM_SUN_DIR.clone() },
      // Matière déduite de la tuile : seul l'or (métal) a des reflets teintés.
      uGoldTile: { value: atlas.tileIndex('gold_block') },
    },
    fog: true,
    transparent: false,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  gem.name = 'chunk-gem';

  const water = new THREE.ShaderMaterial({
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    uniforms: {
      ...shared,
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uOpacity: { value: 0.72 },
      uTint: { value: new THREE.Color(0.5, 0.74, 1.0) },
    },
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Une seule passe malgré la double face (sinon Three dessine dos puis face : 2 appels).
    forceSinglePass: true,
  });
  water.name = 'chunk-water';

  return {
    opaque,
    cutout,
    blend,
    gem,
    water,
    dispose() {
      opaque.dispose();
      cutout.dispose();
      blend.dispose();
      gem.dispose();
      water.dispose();
    },
  };
}
