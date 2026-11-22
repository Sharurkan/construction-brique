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
/** Niveau de l'eau du lac : blocs d'eau jusqu'à y = WATER_LEVEL inclus (surface à y = 12). */
export const WATER_LEVEL = 11;

/**
 * Lac et cascade d'un monde (déterministe par seed, calculé avant le terrain).
 *
 * Le lac est DEVANT le joueur à l'apparition (direction −Z : yaw 0 d'un nouveau monde), à
 * 23–27 blocs du centre, dans une zone basse : une pente douce (« couloir ») descend du centre
 * vers lui pour qu'il soit visible depuis le point d'apparition. Il est bordé d'une plage de
 * sable au ras de l'eau. Derrière lui (côté −Z), une petite falaise rectangulaire (4 à 6 blocs
 * au-dessus de l'eau) porte un ruisseau de 2 blocs de large qui se jette dans le lac en un
 * rideau d'eau vertical (la cascade), face au point d'apparition.
 */
export interface LakeLayout {
  /** Centre du lac. */
  x: number;
  z: number;
  /** Demi-axes de l'ellipse du lac (x plus large que z). */
  rx: number;
  rz: number;
  /** Falaise : rectangle [x0, x1] × [z0, z1], sommet (bloc d'herbe) à y = top. */
  cliff: { x0: number; x1: number; z0: number; z1: number; top: number };
  /** Cascade : colonnes x = fallX et fallX + 1, en z = fallZ (juste devant la falaise). */
  fallX: number;
  fallZ: number;
}

export function lakeLayout(sizeX: number, sizeZ: number, rand: () => number): LakeLayout {
  const cx = sizeX / 2;
  const cz = sizeZ / 2;
  const x = Math.round(cx + (rand() * 2 - 1) * 8);
  const z = Math.round(cz - (23 + rand() * 4));
  const rz = 6 + Math.floor(rand() * 2);
  const rx = rz + 2;
  // Face de la falaise côté lac : 2 rangées à l'intérieur de l'ellipse (la cascade tombe dans l'eau).
  const z1 = z - rz + 1;
  const top = WATER_LEVEL + 4 + Math.floor(rand() * 3); // 15..17 : 4 à 6 blocs au-dessus de l'eau
  const fallX = x - 1 + Math.floor(rand() * 2);
  return {
    x,
    z,
    rx,
    rz,
    cliff: { x0: x - 5, x1: x + 5, z0: z1 - 6, z1, top },
    fallX,
    fallZ: z1 + 1,
  };
}

/** Distance normalisée au centre du lac (< 1 : dans l'eau). */
function lakeDist(l: LakeLayout, x: number, z: number): number {
  return Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
}

function inCliff(l: LakeLayout, x: number, z: number): boolean {
  const c = l.cliff;
  if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return false;
  // Coins arrière arrondis : moins « boîte ».
  return !(z === c.z0 && (x === c.x0 || x === c.x1));
}

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

  const lake = lakeLayout(sizeX, sizeZ, rand);
  const cx = sizeX / 2;
  const cz = sizeZ / 2;
  // Couloir centre → lac (vecteur unitaire et longueur).
  const segX = lake.x - cx;
  const segZ = lake.z - cz;
  const segLen = Math.hypot(segX, segZ);
  const ux = segX / segLen;
  const uz = segZ / segLen;

  const heights = new Int16Array(sizeX * sizeZ);
  const mid = (TERRAIN_MIN + TERRAIN_MAX) / 2;
  const amp = (TERRAIN_MAX - TERRAIN_MIN) / 2;
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      // Deux octaves de bruit de valeur : grandes collines douces + petites bosses.
      const n = valueNoise2(x / 28, z / 28, seed) * 0.7 + valueNoise2(x / 11, z / 11, seed + 101) * 0.3;
      let h = mid + (n * 2 - 1) * amp * 1.25;
      // Centre un peu aplati : apparition et premières constructions plus faciles.
      const dc = Math.hypot(x - cx, z - cz);
      const flat = Math.max(0, 1 - dc / 14);
      h = h + (mid - h) * flat * 0.8;
      // Couloir en pente douce vers le lac (on le voit depuis le point d'apparition).
      const t = ((x - cx) * ux + (z - cz) * uz) / segLen;
      const lat = Math.abs((x - cx) * uz - (z - cz) * ux);
      if (t > 0 && t < 1.2 && lat < 14) {
        // Descend vite (dès ~10 blocs du centre on est presque au niveau de la plage) : depuis
        // le point d'apparition, le regard passe au-dessus du sol jusqu'à la surface du lac.
        h = Math.min(h, mid + (WATER_LEVEL + 1 - mid) * Math.min(1, t / 0.45) + lat * 0.45);
      }
      // Cuvette du lac : fond de 1 à 3 blocs d'eau, plage au ras de l'eau, puis pente douce.
      const e = lakeDist(lake, x, z);
      if (e < 1) h = WATER_LEVEL - 1 - Math.round(2 * smooth(1 - e));
      else h = Math.min(h, WATER_LEVEL + Math.max(0, (e - 1) * lake.rz - 1.5) * 0.6);
      let hi = Math.max(WATER_LEVEL - 3, Math.min(TERRAIN_MAX, Math.round(h)));
      if (inCliff(lake, x, z)) hi = lake.cliff.top;
      heights[x + sizeX * z] = Math.min(hi, sizeY - 10);
    }
  }

  const layer = sizeX * sizeZ;
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const h = heights[x + sizeX * z];
      const col = x + sizeX * z;
      const e = lakeDist(lake, x, z);
      // Sable : zones basses, et plage autour du lac.
      const sandy = h <= SAND_LEVEL || (e < 1 + 3 / lake.rz && h <= WATER_LEVEL + 2);
      data[col] = BlockId.Bedrock; // y = 0
      for (let y = 1; y <= h; y++) {
        let id: BlockId;
        if (y === h) id = sandy ? BlockId.Sand : BlockId.Grass;
        else if (y >= h - 3) id = sandy ? BlockId.Sand : BlockId.Dirt;
        else id = BlockId.Stone;
        data[col + layer * y] = id;
      }
      // Eau du lac (immobile : aucun écoulement simulé).
      if (e < 1) for (let y = h + 1; y <= WATER_LEVEL; y++) data[col + layer * y] = BlockId.Water;
    }
  }

  // Cascade : ruisseau de 3 blocs creusé dans le sommet de la falaise, puis rideau d'eau
  // vertical de 2 blocs de large, du sommet jusqu'au lac.
  const top = lake.cliff.top;
  for (let x = lake.fallX; x <= lake.fallX + 1; x++) {
    for (let z = lake.cliff.z1 - 2; z <= lake.cliff.z1; z++) world.setBlockRaw(x, top, z, BlockId.Water);
    for (let y = top; y > WATER_LEVEL; y--) world.setBlockRaw(x, y, lake.fallZ, BlockId.Water);
  }

  // Arbres épars : tirages aléatoires avec espacement minimal.
  const trees: Array<[number, number]> = [];
  const target = Math.round((sizeX * sizeZ) / 600); // ~15 arbres pour 96 × 96
  const margin = 3;
  for (let attempt = 0; attempt < target * 20 && trees.length < target; attempt++) {
    const x = margin + Math.floor(rand() * (sizeX - 2 * margin));
    const z = margin + Math.floor(rand() * (sizeZ - 2 * margin));
    if (Math.hypot(x - sizeX / 2, z - sizeZ / 2) < SPAWN_CLEAR_RADIUS) continue;
    // Ni dans le lac / sur la plage, ni sur la falaise (la cascade reste dégagée).
    if (lakeDist(lake, x, z) < 1 + 4 / lake.rz) continue;
    const c = lake.cliff;
    if (x >= c.x0 - 2 && x <= c.x1 + 2 && z >= c.z0 - 2 && z <= c.z1 + 2) continue;
    // Ni dans l'axe du regard vers la cascade (couloir dégagé depuis le point d'apparition).
    const tt = ((x - cx) * ux + (z - cz) * uz) / segLen;
    if (tt > 0 && tt < 1 && Math.abs((x - cx) * uz - (z - cz) * ux) < 6) continue;
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
          // Jamais dans l'eau (ni sur des feuilles ou du verre).
          if (id !== BlockId.Leaves && id !== BlockId.Glass && id !== BlockId.Water && y + 2 < world.sizeY) {
            return { x: x + 0.5, y: y + 1, z: z + 0.5 };
          }
          break; // sommet = feuilles / verre : on essaie une autre colonne
        }
      }
    }
  }
  return { x: cx + 0.5, y: world.sizeY - 2, z: cz + 0.5 };
}
