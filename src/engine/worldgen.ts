import { BlockId } from '../core/types';
import type { World } from './world';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage entier 2D → [0, 1). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bruit de valeur 2D lissé, sortie dans [0, 1). */
export function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}

/** Hauteurs minimale / maximale du terrain (surface = y de l'herbe). */
export const TERRAIN_MIN = 12;
export const TERRAIN_MAX = 18;
/** Les surfaces ≤ SAND_LEVEL deviennent du sable (zone basse). */
const SAND_LEVEL = 11;
/** Rayon autour du centre sans arbres (point d'apparition dégagé). */
const SPAWN_CLEAR_RADIUS = 7;

/**
 * Génère le monde (déterministe par seed). Écrit directement dans les données
 * puis marque tous les chunks à remailler ; aucune notification onChange.
 */
export function generateWorld(world: World, seed: number): void {
  seed = seed | 0;
  const { sizeX, sizeY, sizeZ } = world;
  const data = world.data;
  data.fill(BlockId.Air);
  const rand = mulberry32(seed ^ 0x5eed);

  // Petite zone basse (cuvette de sable), placée loin du centre.
  const angle = rand() * Math.PI * 2;
  const dist = Math.min(sizeX, sizeZ) * (0.26 + rand() * 0.08);
  const dipX = sizeX / 2 + Math.cos(angle) * dist;
  const dipZ = sizeZ / 2 + Math.sin(angle) * dist;
  const dipR = 7 + rand() * 3;

  const heights = new Int16Array(sizeX * sizeZ);
  const mid = (TERRAIN_MIN + TERRAIN_MAX) / 2;
  const amp = (TERRAIN_MAX - TERRAIN_MIN) / 2;
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      // Deux octaves de bruit de valeur : grandes collines douces + petites bosses.
      const n = valueNoise2(x / 28, z / 28, seed) * 0.7 + valueNoise2(x / 11, z / 11, seed + 101) * 0.3;
      let h = mid + (n * 2 - 1) * amp * 1.25;
      // Centre un peu aplati : apparition et premières constructions plus faciles.
      const dc = Math.hypot(x - sizeX / 2, z - sizeZ / 2);
      const flat = Math.max(0, 1 - dc / 14);
      h = h + (mid - h) * flat * 0.8;
      const dd = Math.hypot(x - dipX, z - dipZ);
      if (dd < dipR) h -= 5 * smooth(1 - dd / dipR);
      const hi = Math.max(SAND_LEVEL - 2, Math.min(TERRAIN_MAX, Math.round(h)));
      heights[x + sizeX * z] = Math.min(hi, sizeY - 10);
    }
  }

  const layer = sizeX * sizeZ;
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const h = heights[x + sizeX * z];
      const col = x + sizeX * z;
      const sandy = h <= SAND_LEVEL;
      data[col] = BlockId.Bedrock; // y = 0
      for (let y = 1; y <= h; y++) {
        let id: BlockId;
        if (y === h) id = sandy ? BlockId.Sand : BlockId.Grass;
        else if (y >= h - 3) id = sandy ? BlockId.Sand : BlockId.Dirt;
        else id = BlockId.Stone;
        data[col + layer * y] = id;
      }
    }
  }

  // Arbres épars : tirages aléatoires avec espacement minimal.
  const trees: Array<[number, number]> = [];
  const target = Math.round((sizeX * sizeZ) / 600); // ~15 arbres pour 96 × 96
  const margin = 3;
  for (let attempt = 0; attempt < target * 20 && trees.length < target; attempt++) {
    const x = margin + Math.floor(rand() * (sizeX - 2 * margin));
    const z = margin + Math.floor(rand() * (sizeZ - 2 * margin));
    if (Math.hypot(x - sizeX / 2, z - sizeZ / 2) < SPAWN_CLEAR_RADIUS) continue;
    if (trees.some(([tx, tz]) => Math.abs(tx - x) + Math.abs(tz - z) < 9)) continue;
    const h = heights[x + sizeX * z];
    if (h <= SAND_LEVEL + 1) continue;
    trees.push([x, z]);
    placeTree(world, x, h + 1, z, 4 + Math.floor(rand() * 2), rand);
  }

  world.markAllDirty();
}

function placeTree(world: World, x: number, y0: number, z: number, trunk: number, rand: () => number): void {
  const top = y0 + trunk - 1;
  // Feuillage : deux couches larges (5×5 sans les coins) puis deux couches étroites.
  for (let y = top - 1; y <= top + 2; y++) {
    const r = y <= top ? 2 : 1;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (r === 1 ? y === top + 2 : rand() < 0.6)) continue;
        if (world.getBlock(x + dx, y, z + dz) === BlockId.Air) world.setBlockRaw(x + dx, y, z + dz, BlockId.Leaves);
      }
    }
  }
  for (let y = y0; y <= top; y++) world.setBlockRaw(x, y, z, BlockId.Log);
}

/**
 * Point d'apparition sûr : centre du monde, sur le bloc solide le plus haut de la colonne,
 * avec au moins deux blocs d'air au-dessus. Renvoie la position des PIEDS.
 */
export function findSpawn(world: World): { x: number; y: number; z: number } {
  const cx = Math.floor(world.sizeX / 2);
  const cz = Math.floor(world.sizeZ / 2);
  // Spirale autour du centre si la colonne centrale ne convient pas (arbre, construction…).
  for (let r = 0; r < Math.max(world.sizeX, world.sizeZ) / 2; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx;
        const z = cz + dz;
        for (let y = world.sizeY - 1; y >= 0; y--) {
          const id = world.getBlock(x, y, z);
          if (id === BlockId.Air) continue;
          if (id !== BlockId.Leaves && id !== BlockId.Glass && y + 2 < world.sizeY) {
            return { x: x + 0.5, y: y + 1, z: z + 0.5 };
          }
          break; // sommet = feuilles / verre : on essaie une autre colonne
        }
      }
    }
  }
  return { x: cx + 0.5, y: world.sizeY - 2, z: cz + 0.5 };
}
