import { describe, expect, it } from 'vitest';
import { BlockId } from '../core/types';
import { World } from './world';
import { findSpawn, generateWorld, TERRAIN_MAX } from './worldgen';

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
