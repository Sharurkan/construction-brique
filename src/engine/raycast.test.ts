import { describe, expect, it } from 'vitest';
import { BlockId } from '../core/types';
import { World } from './world';

function worldWithBlock(x: number, y: number, z: number, id = BlockId.Stone): World {
  const w = new World();
  w.setBlock(x, y, z, id);
  return w;
}

describe('raycast', () => {
  const cases: Array<{ name: string; dir: [number, number, number]; origin: [number, number, number]; normal: [number, number, number] }> = [
    { name: '+X', origin: [5.5, 10.5, 10.5], dir: [1, 0, 0], normal: [-1, 0, 0] },
    { name: '-X', origin: [15.5, 10.5, 10.5], dir: [-1, 0, 0], normal: [1, 0, 0] },
    { name: '+Y', origin: [10.5, 5.5, 10.5], dir: [0, 1, 0], normal: [0, -1, 0] },
    { name: '-Y', origin: [10.5, 15.5, 10.5], dir: [0, -1, 0], normal: [0, 1, 0] },
    { name: '+Z', origin: [10.5, 10.5, 5.5], dir: [0, 0, 1], normal: [0, 0, -1] },
    { name: '-Z', origin: [10.5, 10.5, 15.5], dir: [0, 0, -1], normal: [0, 0, 1] },
  ];
  for (const c of cases) {
    it(`touche le bon bloc et la bonne normale (${c.name})`, () => {
      const w = worldWithBlock(10, 10, 10);
      const o = { x: c.origin[0], y: c.origin[1], z: c.origin[2] };
      const hit = w.raycast(o, { x: c.dir[0], y: c.dir[1], z: c.dir[2] }, 20);
      expect(hit).not.toBeNull();
      expect(hit!.block).toEqual([10, 10, 10]);
      expect(hit!.normal).toEqual(c.normal);
      expect(hit!.id).toBe(BlockId.Stone);
      expect(hit!.distance).toBeCloseTo(4.5, 6);
    });
  }

  it('diagonale : renvoie la face d’entrée correcte', () => {
    const w = worldWithBlock(10, 10, 10);
    // Vise le dessus du bloc en plongeant.
    const hit = w.raycast({ x: 8.5, y: 13, z: 10.5 }, { x: 1, y: -1.2, z: 0 }, 10);
    expect(hit!.block).toEqual([10, 10, 10]);
    expect(hit!.normal).toEqual([0, 1, 0]);
    const place = hit!.block.map((v, i) => v + hit!.normal[i]);
    expect(place).toEqual([10, 11, 10]);
  });

  it('renvoie null dans le vide ou au-delà de maxDist', () => {
    const w = worldWithBlock(10, 10, 10);
    expect(w.raycast({ x: 5.5, y: 10.5, z: 10.5 }, { x: -1, y: 0, z: 0 }, 50)).toBeNull();
    expect(w.raycast({ x: 5.5, y: 30.5, z: 10.5 }, { x: 0, y: 1, z: 0 }, 50)).toBeNull();
    expect(w.raycast({ x: 5.5, y: 10.5, z: 10.5 }, { x: 1, y: 0, z: 0 }, 4)).toBeNull();
    expect(w.raycast({ x: 5.5, y: 10.5, z: 10.5 }, { x: 0, y: 0, z: 0 }, 10)).toBeNull();
  });

  it('ignore l’air et touche le bedrock au fond', () => {
    const w = new World();
    w.setBlockRaw(3, 0, 3, BlockId.Bedrock);
    const hit = w.raycast({ x: 3.5, y: 20, z: 3.5 }, { x: 0, y: -1, z: 0 }, 30);
    expect(hit!.block).toEqual([3, 0, 3]);
    expect(hit!.id).toBe(BlockId.Bedrock);
    expect(hit!.normal).toEqual([0, 1, 0]);
  });

  it('vise le monde depuis l’extérieur (caméra orbitale)', () => {
    const w = worldWithBlock(0, 10, 50);
    const hit = w.raycast({ x: -30.5, y: 10.5, z: 50.5 }, { x: 1, y: 0, z: 0 }, 100);
    expect(hit!.block).toEqual([0, 10, 50]);
    expect(hit!.normal).toEqual([-1, 0, 0]);
    expect(hit!.distance).toBeCloseTo(30.5, 6);
    // Depuis au-dessus du monde.
    const hit2 = worldWithBlock(40, 5, 40).raycast({ x: 40.5, y: 100, z: 40.5 }, { x: 0, y: -1, z: 0 }, 200);
    expect(hit2!.block).toEqual([40, 5, 40]);
    expect(hit2!.normal).toEqual([0, 1, 0]);
    // Rayon qui manque complètement la boîte.
    expect(w.raycast({ x: -5, y: 10, z: 50 }, { x: -1, y: 0, z: 0 }, 100)).toBeNull();
  });

  it('origine dans un bloc : renvoie ce bloc à distance 0', () => {
    const w = worldWithBlock(10, 10, 10);
    const hit = w.raycast({ x: 10.5, y: 10.5, z: 10.5 }, { x: 0, y: 0, z: 1 }, 5);
    expect(hit!.block).toEqual([10, 10, 10]);
    expect(hit!.distance).toBe(0);
    expect(hit!.normal).toEqual([0, 0, -1]);
  });
});

describe('raycastInto (sans allocation)', () => {
  it('même résultat que raycast, dans l’objet fourni ; null si rien', async () => {
    const { createRaycastHit } = await import('./raycast');
    const w = new World(32, 32, 32);
    w.setBlock(10, 5, 10, BlockId.Stone);
    const out = createRaycastHit();
    const o = { x: 10.5, y: 12, z: 10.5 };
    const d = { x: 0.02, y: -1, z: 0.01 };
    const ref = w.raycast(o, d, 20);
    expect(ref?.block).toEqual([10, 5, 10]);
    const hit = w.raycastInto(o, d, 20, out);
    expect(hit).toBe(out);
    expect(hit).toEqual(ref);
    // Réutilisation : un second appel écrase le même objet.
    w.setBlock(3, 3, 3, BlockId.Dirt);
    const hit2 = w.raycastInto({ x: 3.5, y: 10, z: 3.5 }, { x: 0, y: -1, z: 0 }, 20, out);
    expect(hit2).toBe(out);
    expect(out.block).toEqual([3, 3, 3]);
    expect(out.normal).toEqual([0, 1, 0]);
    expect(out.id).toBe(BlockId.Dirt);
    expect(w.raycastInto({ x: 3.5, y: 10, z: 3.5 }, { x: 0, y: 1, z: 0 }, 20, out)).toBeNull();
  });
});
