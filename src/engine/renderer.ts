import * as THREE from 'three';
import { CHUNK_SIZE } from '../core/types';
import type { TextureAtlas } from './atlas';
import { createChunkMaterials, type ChunkMaterials } from './materials';
import { meshChunk, type MeshData } from './mesher';
import type { World } from './world';

interface ChunkEntry {
  opaque: THREE.Mesh | null;
  transparent: THREE.Mesh | null;
  triangles: number;
}

export interface WorldRendererStats {
  /** Triangles actuellement affichables (tous chunks). */
  triangles: number;
  /** Nombre de meshes (≈ appels de dessin max). */
  meshes: number;
  /** Durée du dernier rebuildAll(), en ms. */
  lastRebuildMs: number;
  /** Durée du dernier remaillage d'un chunk, en ms (maillage + création géométrie). */
  lastChunkMs: number;
  /** Durée moyenne glissante d'un remaillage de chunk, en ms. */
  avgChunkMs: number;
  /** Chunks en attente de remaillage. */
  pending: number;
}

/**
 * Affiche un monde voxel : un Mesh opaque et un Mesh transparent (feuilles + verre) par chunk.
 * Les chunks sales sont remaillés progressivement par update().
 */
export class WorldRenderer {
  /** Groupe ajouté à la scène, contenant tous les meshes de chunks. */
  readonly group = new THREE.Group();
  readonly stats: WorldRendererStats = {
    triangles: 0,
    meshes: 0,
    lastRebuildMs: 0,
    lastChunkMs: 0,
    avgChunkMs: 0,
    pending: 0,
  };

  private readonly atlas: TextureAtlas;
  private readonly materials: ChunkMaterials;
  private readonly transparentMaterials: THREE.Material[];
  private readonly chunks = new Map<number, ChunkEntry>();
  /** File de chunks à remailler (clés), sans doublon. */
  private readonly queue = new Set<number>();
  private readonly world: World;
  private readonly scene: THREE.Object3D;

  constructor(world: World, scene: THREE.Object3D, atlas: TextureAtlas) {
    this.world = world;
    this.scene = scene;
    this.atlas = atlas;
    this.materials = createChunkMaterials(atlas);
    this.transparentMaterials = [this.materials.cutout, this.materials.blend];
    this.group.name = 'world';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
  }

  /**
   * Remaille au plus `maxChunksPerFrame` chunks sales. Si `focus` est fourni (position du
   * joueur / de la caméra), les chunks les plus proches passent en premier.
   * Renvoie le nombre de chunks remaillés.
   */
  update(maxChunksPerFrame = 2, focus?: { x: number; y: number; z: number }): number {
    this.pullDirty();
    if (this.queue.size === 0) return 0;
    let keys: number[];
    if (focus && this.queue.size > maxChunksPerFrame) {
      const all = Array.from(this.queue);
      const d = (k: number) => {
        const [cx, cy, cz] = this.decode(k);
        const h = CHUNK_SIZE / 2;
        return (cx * CHUNK_SIZE + h - focus.x) ** 2 + (cy * CHUNK_SIZE + h - focus.y) ** 2 + (cz * CHUNK_SIZE + h - focus.z) ** 2;
      };
      all.sort((a, b) => d(a) - d(b));
      keys = all.slice(0, maxChunksPerFrame);
    } else {
      keys = [];
      for (const k of this.queue) {
        if (keys.length >= maxChunksPerFrame) break;
        keys.push(k);
      }
    }
    for (const k of keys) {
      this.queue.delete(k);
      this.remesh(k);
    }
    this.stats.pending = this.queue.size;
    return keys.length;
  }

  /** Remaille tous les chunks immédiatement (chargement, nouveau monde). */
  rebuildAll(): void {
    const t0 = performance.now();
    this.world.takeDirtyChunks();
    this.queue.clear();
    const { chunksX, chunksY, chunksZ } = this.world;
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cz = 0; cz < chunksZ; cz++) {
        for (let cx = 0; cx < chunksX; cx++) this.remesh(this.key(cx, cy, cz));
      }
    }
    this.stats.lastRebuildMs = performance.now() - t0;
    this.stats.pending = 0;
  }

  /**
   * Monde entièrement changé (chargement, nouveau monde) sans gel : tous les chunks sont mis
   * en file, ceux à au plus `radius` chunks de `focus` (sur les 3 axes, donc aussi celui sous
   * les pieds) sont remaillés tout de suite ; les autres suivront via update(), du plus proche
   * au plus lointain. Renvoie le nombre de chunks remaillés immédiatement.
   */
  rebuildAround(focus: { x: number; y: number; z: number }, radius = 1): number {
    const t0 = performance.now();
    this.world.markAllDirty();
    this.pullDirty();
    const fx = Math.floor(focus.x / CHUNK_SIZE);
    const fy = Math.floor(focus.y / CHUNK_SIZE);
    const fz = Math.floor(focus.z / CHUNK_SIZE);
    const { chunksX, chunksY, chunksZ } = this.world;
    let n = 0;
    for (let cy = Math.max(0, fy - radius); cy <= Math.min(chunksY - 1, fy + radius); cy++) {
      for (let cz = Math.max(0, fz - radius); cz <= Math.min(chunksZ - 1, fz + radius); cz++) {
        for (let cx = Math.max(0, fx - radius); cx <= Math.min(chunksX - 1, fx + radius); cx++) {
          const k = this.key(cx, cy, cz);
          this.queue.delete(k);
          this.remesh(k);
          n++;
        }
      }
    }
    this.stats.lastRebuildMs = performance.now() - t0;
    this.stats.pending = this.queue.size;
    return n;
  }

  /** Matériaux des chunks (fog = true : un scene.fog s'applique automatiquement). */
  get chunkMaterials(): Readonly<ChunkMaterials> {
    return this.materials;
  }

  dispose(): void {
    for (const e of this.chunks.values()) {
      this.disposeMesh(e.opaque);
      this.disposeMesh(e.transparent);
    }
    this.chunks.clear();
    this.queue.clear();
    this.materials.dispose();
    this.scene.remove(this.group);
    this.stats.triangles = 0;
    this.stats.meshes = 0;
  }

  // ---------------------------------------------------------------------------

  private key(cx: number, cy: number, cz: number): number {
    return cx + this.world.chunksX * (cz + this.world.chunksZ * cy);
  }

  private decode(k: number): [number, number, number] {
    const cxz = this.world.chunksX * this.world.chunksZ;
    const cy = Math.floor(k / cxz);
    const r = k - cy * cxz;
    const cz = Math.floor(r / this.world.chunksX);
    return [r - cz * this.world.chunksX, cy, cz];
  }

  private pullDirty(): void {
    if (!this.world.hasDirtyChunks()) return;
    for (const [cx, cy, cz] of this.world.takeDirtyChunks()) this.queue.add(this.key(cx, cy, cz));
    this.stats.pending = this.queue.size;
  }

  private remesh(k: number): void {
    const t0 = performance.now();
    const [cx, cy, cz] = this.decode(k);
    const data = meshChunk(this.world, cx, cy, cz, this.atlas);
    let e = this.chunks.get(k);
    if (!e) {
      e = { opaque: null, transparent: null, triangles: 0 };
      this.chunks.set(k, e);
    }
    this.stats.triangles -= e.triangles;
    e.opaque = this.replace(e.opaque, data.opaque, this.materials.opaque, cx, cy, cz, false);
    e.transparent = this.replace(e.transparent, data.transparent, this.transparentMaterials, cx, cy, cz, true);
    e.triangles = (data.opaque.indices.length + data.transparent.indices.length) / 3;
    this.stats.triangles += e.triangles;
    const dt = performance.now() - t0;
    this.stats.lastChunkMs = dt;
    this.stats.avgChunkMs = this.stats.avgChunkMs === 0 ? dt : this.stats.avgChunkMs * 0.9 + dt * 0.1;
  }

  private replace(
    mesh: THREE.Mesh | null,
    data: MeshData,
    material: THREE.Material | THREE.Material[],
    cx: number,
    cy: number,
    cz: number,
    transparent: boolean,
  ): THREE.Mesh | null {
    if (data.quadCount === 0) {
      if (mesh) {
        this.disposeMesh(mesh);
        this.stats.meshes--;
      }
      return null;
    }
    const geometry = buildGeometry(data, transparent);
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      return mesh;
    }
    const m = new THREE.Mesh(geometry, material);
    m.name = `chunk ${cx},${cy},${cz}${transparent ? ' (transparent)' : ''}`;
    m.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.frustumCulled = true;
    this.group.add(m);
    this.stats.meshes++;
    return m;
  }

  private disposeMesh(mesh: THREE.Mesh | null): void {
    if (!mesh) return;
    mesh.geometry.dispose();
    this.group.remove(mesh);
  }
}

/** Convertit un MeshData en BufferGeometry (bounding sphere calculée pour le frustum culling). */
export function buildGeometry(data: MeshData, withGroups: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  g.setAttribute('tile', new THREE.BufferAttribute(data.tiles, 1));
  g.setAttribute('shade', new THREE.BufferAttribute(data.shades, 1, true));
  g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  if (withGroups) {
    const total = data.indices.length;
    const cut = data.cutoutIndexCount;
    if (cut > 0) g.addGroup(0, cut, 0);
    if (total > cut) g.addGroup(cut, total - cut, 1);
  }
  g.computeBoundingSphere();
  return g;
}
