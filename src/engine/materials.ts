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
 * - le contrat `TextureAtlas` (une texture + tileUV) reste valable pour l'UI (icônes de la
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

export interface ChunkMaterials {
  opaque: THREE.ShaderMaterial;
  /** Feuilles : alpha binaire, écrit la profondeur, double face. */
  cutout: THREE.ShaderMaterial;
  /** Verre : mélange alpha, n'écrit pas la profondeur. */
  blend: THREE.ShaderMaterial;
  setAtlas(atlas: TextureAtlas): void;
  dispose(): void;
}

export function createChunkMaterials(atlas: TextureAtlas): ChunkMaterials {
  // Uniformes d'atlas PARTAGÉS (mêmes objets) par les trois matériaux.
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

  return {
    opaque,
    cutout,
    blend,
    setAtlas(a) {
      shared.uMap.value = a.texture;
      shared.uAtlasSize.value.set(a.width, a.height);
      shared.uCell.value = a.tileSize + 2 * a.padding;
      shared.uPad.value = a.padding;
      shared.uTileSize.value = a.tileSize;
      shared.uTilesPerRow.value = a.tilesPerRow;
    },
    dispose() {
      opaque.dispose();
      cutout.dispose();
      blend.dispose();
    },
  };
}
