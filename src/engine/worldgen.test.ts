import { describe, expect, it } from 'vitest';
import { BlockId } from '../core/types';
import { World } from './world';
import { findSpawn, generateWorld, lakeLayout, mulberry32, TERRAIN_MAX, WATER_LEVEL } from './worldgen';

describe('generateWorld', () => {
  it('est déterministe par seed', () => {
    const a = new World();
    const b = new World();
    const c = new World();
    generateWorld(a, 1234);
    generateWorld(b, 1234);
    generateWorld(c, 999);
    expect(a.serialize()).toEqual(b.serialize());
    expect(a.serialize()).not.toEqual(c.serialize());
  });

  it('respecte la structure attendue', () => {
    const w = new World();
    generateWorld(w, 7);
    const counts = new Map<BlockId, number>();
    for (const v of w.data) counts.set(v, (counts.get(v) ?? 0) + 1);
    // Bedrock partout à y = 0, et seulement là.
    for (let z = 0; z < w.sizeZ; z++) for (let x = 0; x < w.sizeX; x++) expect(w.getBlock(x, 0, z)).toBe(BlockId.Bedrock);
    expect(counts.get(BlockId.Bedrock)).toBe(w.sizeX * w.sizeZ);
    expect(counts.get(BlockId.Grass)! > 0).toBe(true);
    expect(counts.get(BlockId.Sand)! > 0).toBe(true);
    expect(counts.get(BlockId.Log)! > 0).toBe(true);
    expect(counts.get(BlockId.Leaves)! > 0).toBe(true);

    // Colonne type : herbe en surface, 3 couches de terre, pierre dessous.
    const x = 48;
    const z = 48;
    let top = w.sizeY - 1;
    while (w.getBlock(x, top, z) === BlockId.Air) top--;
    expect(top).toBeGreaterThanOrEqual(12);
    expect(top).toBeLessThanOrEqual(TERRAIN_MAX);
    expect(w.getBlock(x, top, z)).toBe(BlockId.Grass);
    for (let i = 1; i <= 3; i++) expect(w.getBlock(x, top - i, z)).toBe(BlockId.Dirt);
    expect(w.getBlock(x, top - 4, z)).toBe(BlockId.Stone);
    expect(w.getBlock(x, 1, z)).toBe(BlockId.Stone);
    expect(w.takeDirtyChunks().length).toBe(108);
  });

  it('findSpawn : au centre, posé sur le sol, tête dégagée', () => {
    for (const seed of [1, 2, 3, 42, 2024]) {
      const w = new World();
      generateWorld(w, seed);
      const s = findSpawn(w);
      expect(Math.abs(s.x - 48.5)).toBeLessThan(4);
      expect(Math.abs(s.z - 48.5)).toBeLessThan(4);
      expect(w.isSolid(s.x, s.y - 1, s.z)).toBe(true);
      expect(w.isSolid(s.x, s.y, s.z)).toBe(false);
      expect(w.isSolid(s.x, s.y + 1, s.z)).toBe(false);
    }
  });
});

describe('generateWorld : lac et cascade', () => {
  const SEEDS = [1, 2, 3, 7, 42, 999, 2024, 123456, -5];

  /** Colonnes de la cascade : nombre de blocs d'eau consécutifs au-dessus du niveau du lac. */
  function fallHeight(w: World, x: number, z: number): number {
    let n = 0;
    for (let y = WATER_LEVEL + 1; y < w.sizeY && w.getBlock(x, y, z) === BlockId.Water; y++) n++;
    return n;
  }

  it('de l\'eau, un lac au niveau WATER_LEVEL, entouré de sable', () => {
    for (const seed of SEEDS) {
      const w = new World();
      generateWorld(w, seed);
      let water = 0;
      for (const v of w.data) if (v === BlockId.Water) water++;
      expect(water).toBeGreaterThan(100);
      // Surface du lac : voisins horizontaux non-eau = surtout du sable (la falaise mise à part).
      let sand = 0;
      let other = 0;
      for (let z = 1; z < w.sizeZ - 1; z++) {
        for (let x = 1; x < w.sizeX - 1; x++) {
          if (w.getBlock(x, WATER_LEVEL, z) !== BlockId.Water || w.getBlock(x, WATER_LEVEL + 1, z) !== BlockId.Air) continue;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const id = w.getBlock(x + dx, WATER_LEVEL, z + dz);
            if (id === BlockId.Water) continue;
            if (id === BlockId.Sand) sand++;
            else other++;
          }
        }
      }
      expect(sand).toBeGreaterThan(20);
      expect(sand / (sand + other)).toBeGreaterThan(0.75);
      // Pas d'eau « suspendue » ailleurs que la cascade : toute eau au-dessus du lac est à la cascade.
      const l = lakeLayout(w.sizeX, w.sizeZ, mulberry32(seed ^ 0x5eed));
      for (let y = WATER_LEVEL + 1; y < w.sizeY; y++) {
        for (let z = 0; z < w.sizeZ; z++) {
          for (let x = 0; x < w.sizeX; x++) {
            if (w.getBlock(x, y, z) !== BlockId.Water) continue;
            expect(x === l.fallX || x === l.fallX + 1).toBe(true);
            expect(z >= l.cliff.z1 - 2 && z <= l.fallZ).toBe(true);
          }
        }
      }
    }
  });

  it('une cascade de 2 de large, 4 à 6 blocs au-dessus du lac, qui tombe dans l\'eau', () => {
    for (const seed of SEEDS) {
      const w = new World();
      generateWorld(w, seed);
      const l = lakeLayout(w.sizeX, w.sizeZ, mulberry32(seed ^ 0x5eed));
      for (const x of [l.fallX, l.fallX + 1]) {
        const hgt = fallHeight(w, x, l.fallZ);
        expect(hgt).toBeGreaterThanOrEqual(4);
        expect(hgt).toBeLessThanOrEqual(6);
        // Rideau vertical : devant la falaise (bloc plein derrière), de l'air devant, le lac dessous.
        expect(w.isSolid(x, WATER_LEVEL + 2, l.fallZ - 1)).toBe(true);
        expect(w.getBlock(x, WATER_LEVEL + 2, l.fallZ + 1)).toBe(BlockId.Air);
        expect(w.getBlock(x, WATER_LEVEL, l.fallZ)).toBe(BlockId.Water);
        // Ruisseau au sommet de la falaise.
        expect(w.getBlock(x, l.cliff.top, l.cliff.z1)).toBe(BlockId.Water);
        expect(w.isSolid(x, l.cliff.top - 1, l.cliff.z1)).toBe(true);
      }
    }
  });

  it('point d\'apparition hors de l\'eau, loin du lac mais face à lui (direction −Z)', () => {
    for (const seed of SEEDS) {
      const w = new World();
      generateWorld(w, seed);
      const s = findSpawn(w);
      const l = lakeLayout(w.sizeX, w.sizeZ, mulberry32(seed ^ 0x5eed));
      expect(w.getBlock(s.x, s.y - 1, s.z)).not.toBe(BlockId.Water);
      expect(w.getBlock(s.x, s.y, s.z)).toBe(BlockId.Air);
      expect(w.getBlock(s.x, s.y + 1, s.z)).toBe(BlockId.Air);
      // Assez loin : le bord du lac est à plus de 10 blocs.
      expect(Math.hypot(s.x - l.x, s.z - l.z) - l.rx).toBeGreaterThan(10);
      // Devant le joueur d'un nouveau monde (yaw 0 = regard vers −Z), dans un cône de ±25°.
      expect(l.z).toBeLessThan(s.z);
      expect(Math.abs(l.x - s.x) / (s.z - l.z)).toBeLessThan(Math.tan((25 * Math.PI) / 180));
    }
  });

  it('visible depuis le point d\'apparition : rien ne cache le haut de la cascade', () => {
    for (const seed of SEEDS) {
      const w = new World();
      generateWorld(w, seed);
      const s = findSpawn(w);
      const l = lakeLayout(w.sizeX, w.sizeZ, mulberry32(seed ^ 0x5eed));
      const eye = { x: s.x, y: s.y + 1.6, z: s.z };
      const target = { x: l.fallX + 1, y: l.cliff.top + 0.5, z: l.fallZ + 0.5 };
      const dir = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
      const hit = w.raycast(eye, dir, 80);
      expect(hit).not.toBeNull();
      expect(hit!.id).toBe(BlockId.Water);
      // La surface du lac aussi (point au milieu du lac, côté point d'apparition).
      const lakeTarget = { x: l.x + 0.5, y: WATER_LEVEL + 0.9, z: l.z + 0.5 };
      const d2 = { x: lakeTarget.x - eye.x, y: lakeTarget.y - eye.y, z: lakeTarget.z - eye.z };
      const hit2 = w.raycast(eye, d2, 80);
      expect(hit2?.id).toBe(BlockId.Water);
    }
  });
});
