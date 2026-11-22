/**
 * Matériau « gemme » de la démo comparative (demos/gems.html).
 *
 * C'est une COPIE ENRICHIE du ShaderMaterial des chunks (src/engine/materials.ts) : même
 * adressage d'atlas (UV locaux en blocs + index de tuile + fract()), même ombrage précalculé
 * (attribut `shade` = face × AO), même brouillard. Il ajoute seulement :
 * - un attribut `face` (0..5, déjà produit par le mesher dans MeshData.faces, mais pas encore
 *   envoyé au GPU par buildGeometry) → normale + tangentes de la face dans le vertex shader ;
 * - la position MONDE (varying) → direction caméra et cellule du bloc (hash par bloc, valable
 *   même pour les quads fusionnés par le greedy mesher) ;
 * - `uTime`, `uSunDir`, `uBaseTile` (kind = tile − uBaseTile : 0 diamant, 1 or, 2 émeraude).
 *
 * Le mode d'effet est choisi par un #define (MODE) : un programme GPU par option, aucune
 * branche dynamique coûteuse dans le fragment shader.
 */
import * as THREE from 'three';
import type { TextureAtlas } from '../../src/engine';

export const GemMode = {
  Spec: 1, // B : reflet spéculaire + fresnel
  Sweep: 2, // C : bande de lumière animée
  Sparkle: 3, // D : étincelles
  Facet: 4, // E : facettes + envmap analytique
  Combo: 5, // F : B doux + D léger
} as const;
export type GemMode = (typeof GemMode)[keyof typeof GemMode];

const vertexShader = /* glsl */ `
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

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uAtlasSize;
uniform float uCell;
uniform float uPad;
uniform float uTileSize;
uniform float uTilesPerRow;
uniform float uTime;
uniform vec3 uSunDir;
uniform float uBaseTile;
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

// Étincelles : grille g×g par face, une cellule sur ~2 active, clignotement lent par cellule.
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

  float kind = t - uBaseTile;          // 0 diamant, 1 or, 2 émeraude
  float isGold = 1.0 - step(0.5, abs(kind - 1.0));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 cell = floor(vWorld - vN * 0.5);
  vec2 p = f - 0.5;
  vec3 c = base * vShade;
  // Teinte des reflets : blanche pour les pierres, dorée pour le métal.
  vec3 glint = mix(vec3(1.0), mix(base, vec3(1.0, 0.95, 0.75), 0.45) * 1.25, isGold);

#if MODE == 1 || MODE == 5
  // Normale « coussin » : légèrement bombée → la tache de lumière glisse sur la face.
  vec3 n = normalize(vN + (vT * p.x + vB * p.y) * 1.1);
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(n, H), 0.0);
  #if MODE == 1
  // Tache nette + halo large (lustre) : bien lisible même de loin.
  float sp = pow(nh, 22.0) * 1.0 + pow(nh, 5.0) * 0.22;
  float fres = pow(1.0 - max(dot(vN, V), 0.0), 2.5) * 0.6;
  #else
  float sp = pow(nh, 28.0) * 0.7 + pow(nh, 5.0) * 0.12;
  float fres = pow(1.0 - max(dot(vN, V), 0.0), 2.5) * 0.35;
  #endif
  vec3 R = reflect(-V, vN);
  c += glint * sp + envColor(R) * fres * mix(vec3(1.0), base * 1.4, isGold);
#endif

#if MODE == 2
  float ph = hash13(cell);
  float tt = fract(uTime / 3.0 + ph);
  float s = (f.x + (1.0 - f.y)) * 0.5;          // diagonale haut-gauche → bas-droite
  float ctr = tt * 2.6 - 0.8;                   // la bande traverse pendant ~40 % du cycle
  float band = smoothstep(0.11, 0.0, abs(s - ctr)) * 0.85
             + smoothstep(0.035, 0.0, abs(s - ctr + 0.2)) * 0.6;
  c += glint * band;
#endif

#if MODE == 3
  c += glint * sparkles(f, cell, 3.0, 0.55, 2.7) * 1.4;
#endif

#if MODE == 4
  // Taille « table + 4 biseaux », chaque biseau coupé en deux triangles.
  vec2 a = abs(p);
  float tbl = 0.2;
  vec3 n = vN;
  if (max(a.x, a.y) > tbl) {
    if (a.x > a.y) n = normalize(vN + vT * sign(p.x) * 0.9 + vB * sign(p.y) * 0.25);
    else           n = normalize(vN + vB * sign(p.y) * 0.9 + vT * sign(p.x) * 0.25);
  }
  vec3 R = reflect(-V, n);
  vec3 e = envColor(R);
  float lum = dot(e, vec3(0.3, 0.59, 0.11));
  // Couleur saturée modulée par la luminance du reflet : chaque facette a sa propre valeur.
  c = base * (0.45 + 0.75 * lum) * mix(1.0, vShade, 0.6);
  c += e * base * 0.22;
  float sp = pow(max(dot(R, uSunDir), 0.0), 40.0);
  c += glint * sp * 0.9;
  // Arêtes de facettes légèrement claires.
  float edge = min(abs(a.x - a.y) * 1.4, abs(max(a.x, a.y) - tbl));
  c += glint * (1.0 - smoothstep(0.0, 0.025, edge)) * 0.22;
#endif

#if MODE == 5
  c += glint * sparkles(f, cell, 2.0, 0.35, 2.4) * 1.0;
#endif

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Crée le matériau gemme d'une option, partageant la texture et les uniformes d'atlas. */
export function createGemMaterial(
  atlas: TextureAtlas,
  mode: GemMode,
  baseTile: number,
  shared: { uTime: { value: number }; uSunDir: { value: THREE.Vector3 } },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    defines: { MODE: mode },
    uniforms: {
      uMap: { value: atlas.texture },
      uAtlasSize: { value: new THREE.Vector2(atlas.width, atlas.height) },
      uCell: { value: atlas.tileSize + 2 * atlas.padding },
      uPad: { value: atlas.padding },
      uTileSize: { value: atlas.tileSize },
      uTilesPerRow: { value: atlas.tilesPerRow },
      uBaseTile: { value: baseTile },
      uTime: shared.uTime,
      uSunDir: shared.uSunDir,
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    },
    fog: true,
  });
}
