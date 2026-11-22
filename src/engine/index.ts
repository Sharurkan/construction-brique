// API publique du moteur (Agent C).
export { BLOCKS, PALETTE, ALL_TILE_KEYS, isCutout, isGem, isValidBlockId, isWater } from './blocks';
export { World } from './world';
export { raycastVoxels, createRaycastHit, type Vec3Like } from './raycast';
export {
  generateWorld,
  findSpawn,
  lakeLayout,
  mulberry32,
  valueNoise2,
  TERRAIN_MIN,
  TERRAIN_MAX,
  WATER_LEVEL,
  type LakeLayout,
} from './worldgen';
export {
  type TextureAtlas,
  createPlaceholderAtlas,
  createAtlasFromImages,
  MISSING_TILE,
} from './atlas';
export { meshChunk, type MeshData, type ChunkMesh, type TileLookup } from './mesher';
export { createChunkMaterials, type ChunkMaterials } from './materials';
export { WorldRenderer, buildGeometry, type WorldRendererStats } from './renderer';
