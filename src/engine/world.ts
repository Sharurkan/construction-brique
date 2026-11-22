import {
  BlockId,
  CHUNK_SIZE,
  WORLD_SIZE_X,
  WORLD_SIZE_Y,
  WORLD_SIZE_Z,
  type RaycastHit,
  type VoxelWorld,
} from '../core/types';
import { BLOCKS, BLOCK_COUNT, isValidBlockId } from './blocks';
import { raycastVoxels, type Vec3Like } from './raycast';

type ChangeListener = (x: number, y: number, z: number, id: BlockId) => void;

/** Table « solide » par id, pour éviter un accès objet dans les boucles chaudes. */
const SOLID = new Uint8Array(BLOCK_COUNT);
for (let i = 0; i < BLOCK_COUNT; i++) SOLID[i] = BLOCKS[i as BlockId].solid ? 1 : 0;

/**
 * Monde voxel en mémoire. Stockage plat : index = x + sizeX * (z + sizeZ * y).
 *
 * Hors limites :
 * - getBlock → Air, sauf y < 0 → Bedrock ;
 * - isSolid → true sur les côtés (murs invisibles) et en dessous, false au-dessus.
 */
export class World implements VoxelWorld {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** Nombre de chunks par axe. */
  readonly chunksX: number;
  readonly chunksY: number;
  readonly chunksZ: number;
  /** Données brutes (lecture directe autorisée, écriture via setBlock / setBlockRaw). */
  readonly data: Uint8Array;

  private readonly listeners = new Set<ChangeListener>();
  /** Chunks à remailler, clé = cx + chunksX * (cz + chunksZ * cy). */
  private readonly dirty = new Set<number>();

  constructor(sizeX = WORLD_SIZE_X, sizeY = WORLD_SIZE_Y, sizeZ = WORLD_SIZE_Z) {
    if (sizeX % CHUNK_SIZE || sizeY % CHUNK_SIZE || sizeZ % CHUNK_SIZE) {
      throw new Error(`Taille du monde non multiple de ${CHUNK_SIZE}`);
    }
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.chunksX = sizeX / CHUNK_SIZE;
    this.chunksY = sizeY / CHUNK_SIZE;
    this.chunksZ = sizeZ / CHUNK_SIZE;
    this.data = new Uint8Array(sizeX * sizeY * sizeZ);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  index(x: number, y: number, z: number): number {
    return x + this.sizeX * (z + this.sizeZ * y);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0) return BlockId.Bedrock;
    if (x < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ) return BlockId.Air;
    return this.data[x + this.sizeX * (z + this.sizeZ * y)] as BlockId;
  }

  isSolid(x: number, y: number, z: number): boolean {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0) return true;
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return true; // murs invisibles
    if (y >= this.sizeY) return false;
    return SOLID[this.data[x + this.sizeX * (z + this.sizeZ * y)]] === 1;
  }

  /**
   * Pose / casse un bloc. Renvoie false (et ne fait rien) si : hors limites, id invalide,
   * id = Bedrock, bloc actuel non cassable (bedrock), ou aucun changement.
   */
  setBlock(x: number, y: number, z: number, id: BlockId): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return false;
    if (!this.inBounds(x, y, z)) return false;
    if (!isValidBlockId(id) || id === BlockId.Bedrock) return false;
    const i = x + this.sizeX * (z + this.sizeZ * y);
    const current = this.data[i] as BlockId;
    if (current === id) return false;
    if (current !== BlockId.Air && !BLOCKS[current].breakable) return false;
    this.data[i] = id;
    this.markBlockDirty(x, y, z);
    for (const cb of this.listeners) cb(x, y, z, id);
    return true;
  }

  /**
   * Écriture brute pour la génération : aucune vérification de règle, aucune notification,
   * aucun chunk marqué. Appeler markAllDirty() ensuite.
   */
  setBlockRaw(x: number, y: number, z: number, id: BlockId): void {
    if (!this.inBounds(x, y, z)) return;
    this.data[x + this.sizeX * (z + this.sizeZ * y)] = id;
  }

  /** Vide le monde (tout en Air) et marque tous les chunks. */
  clear(): void {
    this.data.fill(BlockId.Air);
    this.markAllDirty();
  }

  raycast(origin: Vec3Like, dir: Vec3Like, maxDist: number): RaycastHit | null {
    const data = this.data;
    const sx = this.sizeX;
    const sz = this.sizeZ;
    return raycastVoxels(
      (x, y, z) => data[x + sx * (z + sz * y)],
      this.sizeX,
      this.sizeY,
      this.sizeZ,
      origin,
      dir,
      maxDist,
    );
  }

  onChange(cb: ChangeListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  serialize(): Uint8Array {
    return this.data.slice();
  }

  load(data: Uint8Array): void {
    if (data.length !== this.data.length) {
      throw new Error(`Taille de sauvegarde invalide : ${data.length} au lieu de ${this.data.length}`);
    }
    for (let i = 0; i < data.length; i++) {
      // Valeurs inconnues (sauvegarde corrompue / future) → Air.
      this.data[i] = data[i] < BLOCK_COUNT ? data[i] : BlockId.Air;
    }
    this.markAllDirty();
  }

  // ---------- Chunks sales ----------

  /** Marque le chunk contenant (x,y,z) et ses voisins si le bloc est en bordure (y compris diagonaux, pour l'AO). */
  markBlockDirty(x: number, y: number, z: number): void {
    const cx = (x / CHUNK_SIZE) | 0;
    const cy = (y / CHUNK_SIZE) | 0;
    const cz = (z / CHUNK_SIZE) | 0;
    const lx = x - cx * CHUNK_SIZE;
    const ly = y - cy * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const x0 = lx === 0 ? -1 : 0;
    const x1 = lx === CHUNK_SIZE - 1 ? 1 : 0;
    const y0 = ly === 0 ? -1 : 0;
    const y1 = ly === CHUNK_SIZE - 1 ? 1 : 0;
    const z0 = lz === 0 ? -1 : 0;
    const z1 = lz === CHUNK_SIZE - 1 ? 1 : 0;
    for (let oy = y0; oy <= y1; oy++) {
      for (let oz = z0; oz <= z1; oz++) {
        for (let ox = x0; ox <= x1; ox++) this.markChunkDirty(cx + ox, cy + oy, cz + oz);
      }
    }
  }

  markChunkDirty(cx: number, cy: number, cz: number): void {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.chunksX || cy >= this.chunksY || cz >= this.chunksZ) return;
    this.dirty.add(cx + this.chunksX * (cz + this.chunksZ * cy));
  }

  markAllDirty(): void {
    for (let cy = 0; cy < this.chunksY; cy++) {
      for (let cz = 0; cz < this.chunksZ; cz++) {
        for (let cx = 0; cx < this.chunksX; cx++) this.markChunkDirty(cx, cy, cz);
      }
    }
  }

  hasDirtyChunks(): boolean {
    return this.dirty.size > 0;
  }

  /** Renvoie et vide l'ensemble des chunks à remailler (ordre d'insertion). */
  takeDirtyChunks(): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    const cxz = this.chunksX * this.chunksZ;
    for (const key of this.dirty) {
      const cy = Math.floor(key / cxz);
      const rem = key - cy * cxz;
      const cz = Math.floor(rem / this.chunksX);
      const cx = rem - cz * this.chunksX;
      out.push([cx, cy, cz]);
    }
    this.dirty.clear();
    return out;
  }
}
