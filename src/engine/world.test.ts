import { describe, expect, it } from 'vitest';
import { BlockId, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from '../core/types';
import { BLOCKS, PALETTE } from './blocks';
import { World } from './world';

const sortKeys = (a: Array<[number, number, number]>) => a.map((c) => c.join(',')).sort();

describe('blocs', () => {
  it('définit tous les ids avec des propriétés cohérentes', () => {
    expect(BLOCKS[BlockId.Air].solid).toBe(false);
    expect(BLOCKS[BlockId.Glass].transparent).toBe(true);
    expect(BLOCKS[BlockId.Leaves].transparent).toBe(true);
    expect(BLOCKS[BlockId.Bedrock].breakable).toBe(false);
    expect(BLOCKS[BlockId.Bedrock].inPalette).toBe(false);
    expect(PALETTE).not.toContain(BlockId.Bedrock);
    expect(PALETTE).not.toContain(BlockId.Air);
    for (const id of PALETTE) expect(BLOCKS[id].inPalette).toBe(true);
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });
});

describe('World', () => {
  it('a la taille du contrat', () => {
    const w = new World();
    expect([w.sizeX, w.sizeY, w.sizeZ]).toEqual([WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z]);
    expect(w.data.length).toBe(96 * 48 * 96);
  });

  it('get / set et index plat', () => {
    const w = new World();
    expect(w.getBlock(3, 4, 5)).toBe(BlockId.Air);
    expect(w.setBlock(3, 4, 5, BlockId.Brick)).toBe(true);
    expect(w.getBlock(3, 4, 5)).toBe(BlockId.Brick);
    expect(w.data[3 + 96 * (5 + 96 * 4)]).toBe(BlockId.Brick);
    expect(w.setBlock(3, 4, 5, BlockId.Brick)).toBe(false); // aucun changement
    expect(w.setBlock(3, 4, 5, BlockId.Air)).toBe(true);
    expect(w.getBlock(3, 4, 5)).toBe(BlockId.Air);
  });

  it('gère les limites', () => {
    const w = new World();
    expect(w.getBlock(-1, 5, 5)).toBe(BlockId.Air);
    expect(w.getBlock(96, 5, 5)).toBe(BlockId.Air);
    expect(w.getBlock(5, 48, 5)).toBe(BlockId.Air);
    expect(w.getBlock(5, -1, 5)).toBe(BlockId.Bedrock);
    expect(w.isSolid(-1, 5, 5)).toBe(true);
    expect(w.isSolid(5, 5, 96)).toBe(true);
    expect(w.isSolid(5, 60, 5)).toBe(false);
    expect(w.isSolid(5, -3, 5)).toBe(true);
    expect(w.isSolid(5, 5, 5)).toBe(false);
    expect(w.setBlock(-1, 5, 5, BlockId.Stone)).toBe(false);
    expect(w.setBlock(5, 48, 5, BlockId.Stone)).toBe(false);
    expect(w.setBlock(5, -1, 5, BlockId.Stone)).toBe(false);
    expect(w.setBlock(1.5, 5, 5, BlockId.Stone)).toBe(false);
    w.setBlock(5, 5, 5, BlockId.Stone);
    expect(w.isSolid(5.7, 5.2, 5.9)).toBe(true);
    w.setBlock(6, 5, 5, BlockId.Leaves);
    expect(w.isSolid(6, 5, 5)).toBe(true);
  });

  it('bedrock non cassable et non posable', () => {
    const w = new World();
    w.setBlockRaw(1, 0, 1, BlockId.Bedrock);
    expect(w.setBlock(1, 0, 1, BlockId.Air)).toBe(false);
    expect(w.setBlock(1, 0, 1, BlockId.Stone)).toBe(false);
    expect(w.getBlock(1, 0, 1)).toBe(BlockId.Bedrock);
    expect(w.setBlock(2, 3, 2, BlockId.Bedrock)).toBe(false);
    expect(w.setBlock(2, 3, 2, 999 as BlockId)).toBe(false);
  });

  it('notifie onChange et se désabonne', () => {
    const w = new World();
    const calls: number[][] = [];
    const off = w.onChange((x, y, z, id) => calls.push([x, y, z, id]));
    w.setBlock(1, 2, 3, BlockId.Gold);
    w.setBlock(-1, 2, 3, BlockId.Gold); // refusé : pas de notification
    off();
    w.setBlock(1, 2, 3, BlockId.Air);
    expect(calls).toEqual([[1, 2, 3, BlockId.Gold]]);
  });

  it('marque le chunk sale (centre) et les voisins (bordure)', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Stone); // chunk (1,1,1), intérieur
    expect(w.takeDirtyChunks()).toEqual([[1, 1, 1]]);
    expect(w.takeDirtyChunks()).toEqual([]);

    w.setBlock(16, 20, 20, BlockId.Stone); // bord x = 0 du chunk (1,1,1)
    expect(sortKeys(w.takeDirtyChunks())).toEqual(['0,1,1', '1,1,1']);

    w.setBlock(31, 20, 20, BlockId.Stone); // bord x = 15
    expect(sortKeys(w.takeDirtyChunks())).toEqual(['1,1,1', '2,1,1']);

    // Coin : 8 chunks (AO diagonale incluse).
    w.setBlock(32, 32, 32, BlockId.Stone);
    expect(w.takeDirtyChunks().length).toBe(8);

    // Bord du monde : pas de chunk hors limites.
    w.setBlock(0, 1, 0, BlockId.Stone);
    expect(sortKeys(w.takeDirtyChunks())).toEqual(['0,0,0']);
  });

  it('serialize / load', () => {
    const w = new World();
    w.setBlock(4, 5, 6, BlockId.Diamond);
    const bytes = w.serialize();
    bytes[0] = BlockId.Brick; // copie : ne modifie pas le monde
    expect(w.getBlock(0, 0, 0)).toBe(BlockId.Air);
    const w2 = new World();
    w2.load(bytes);
    expect(w2.getBlock(4, 5, 6)).toBe(BlockId.Diamond);
    expect(w2.getBlock(0, 0, 0)).toBe(BlockId.Brick);
    expect(w2.takeDirtyChunks().length).toBe(6 * 3 * 6);
    expect(() => w2.load(new Uint8Array(10))).toThrow();
  });
});
