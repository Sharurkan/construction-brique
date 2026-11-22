import { describe, expect, it } from 'vitest';
import { BlockId, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from '../core/types';
import { BLOCKS, BLOCK_COUNT, PALETTE, isValidBlockId } from './blocks';
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

  it('ids stables (sauvegardes) : anciens numéros inchangés, minerais ajoutés à la fin', () => {
    // Ne JAMAIS changer ces valeurs : elles sont stockées dans les mondes sauvegardés.
    expect(BlockId.Sand).toBe(10);
    expect(BlockId.Diamond).toBe(11);
    expect(BlockId.Gold).toBe(12);
    expect(BlockId.WoolBlack).toBe(21);
    expect(BlockId.Bedrock).toBe(22);
    expect([
      BlockId.DiamondOre,
      BlockId.GoldOre,
      BlockId.EmeraldOre,
      BlockId.RubyOre,
      BlockId.CoalOre,
      BlockId.IronOre,
      BlockId.SilverOre,
    ]).toEqual([23, 24, 25, 26, 27, 28, 29]);
    // Bloc plein d'émeraude : ajouté APRÈS les minerais.
    expect(BlockId.EmeraldBlock).toBe(30);
    // Eau : ajoutée à la fin.
    expect(BlockId.Water).toBe(31);
    expect(BLOCK_COUNT).toBe(32);
  });

  it('eau : non solide, transparente, cassable, dans la palette (près du sable)', () => {
    const b = BLOCKS[BlockId.Water];
    expect(b.solid).toBe(false);
    expect(b.transparent).toBe(true);
    expect(b.breakable).toBe(true);
    expect(b.tiles).toEqual({ top: 'water', side: 'water', bottom: 'water' });
    expect(isValidBlockId(31)).toBe(true);
    expect(PALETTE.indexOf(BlockId.Water)).toBe(PALETTE.indexOf(BlockId.Sand) + 1);
    const w = new World();
    expect(w.setBlock(3, 5, 3, BlockId.Water)).toBe(true);
    expect(w.isSolid(3, 5, 3)).toBe(false);
    expect(w.isWater(3.5, 5.2, 3.9)).toBe(true);
    expect(w.isWater(3, 6, 3)).toBe(false);
    expect(w.setBlock(3, 5, 3, BlockId.Air)).toBe(true); // cassable
  });

  it('ancienne sauvegarde (sans eau) : rechargée telle quelle ; une sauvegarde avec eau (31) aussi', () => {
    // Monde « d'avant l'eau » : ids 0..30 seulement.
    const old = new World();
    for (let id = 1; id <= 30; id++) old.setBlockRaw(id, 5, 5, id as BlockId);
    const bytes = old.serialize();
    const w = new World();
    w.load(bytes);
    for (let id = 1; id <= 30; id++) expect(w.getBlock(id, 5, 5)).toBe(id);
    expect(w.serialize()).toEqual(bytes);
    w.setBlock(40, 5, 5, BlockId.Water);
    const w2 = new World();
    w2.load(w.serialize());
    expect(w2.getBlock(40, 5, 5)).toBe(BlockId.Water);
  });

  it('minerais et blocs pleins : dans la palette, opaques, solides, cassables, tuiles distinctes', () => {
    const ores: Array<[BlockId, string]> = [
      [BlockId.DiamondOre, 'ore_diamond'],
      [BlockId.GoldOre, 'ore_gold'],
      [BlockId.EmeraldOre, 'ore_emerald'],
      [BlockId.RubyOre, 'ore_ruby'],
      [BlockId.CoalOre, 'ore_coal'],
      [BlockId.IronOre, 'ore_iron'],
      [BlockId.SilverOre, 'ore_silver'],
      [BlockId.Diamond, 'diamond_block'],
      [BlockId.Gold, 'gold_block'],
      [BlockId.EmeraldBlock, 'emerald_block'],
    ];
    for (const [id, tile] of ores) {
      const b = BLOCKS[id];
      expect(b.id).toBe(id);
      expect(b.tiles).toEqual({ top: tile, side: tile, bottom: tile });
      expect(b.transparent).toBe(false);
      expect(b.solid).toBe(true);
      expect(b.breakable).toBe(true);
      expect(PALETTE).toContain(id);
      expect(isValidBlockId(id)).toBe(true);
    }
    // Les blocs pleins or, émeraude et diamant terminent la palette.
    expect(PALETTE.slice(-3)).toEqual([BlockId.Gold, BlockId.EmeraldBlock, BlockId.Diamond]);
    expect(isValidBlockId(BLOCK_COUNT)).toBe(false);
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

  it('pose et recharge les minerais ; un id inconnu (futur) devient Air', () => {
    const w = new World();
    expect(w.setBlock(1, 5, 1, BlockId.RubyOre)).toBe(true);
    expect(w.setBlock(2, 5, 1, BlockId.SilverOre)).toBe(true);
    const bytes = w.serialize();
    bytes[3] = BLOCK_COUNT; // id d'une version future
    const w2 = new World();
    w2.load(bytes);
    expect(w2.getBlock(1, 5, 1)).toBe(BlockId.RubyOre);
    expect(w2.getBlock(2, 5, 1)).toBe(BlockId.SilverOre);
    expect(w2.getBlock(3, 0, 0)).toBe(BlockId.Air);
    expect(w2.setBlock(4, 5, 1, BLOCK_COUNT as BlockId)).toBe(false);
  });
});

describe('World.snapshot (cache des blocs sérialisés)', () => {
  it('réutilise la même copie tant que rien ne change, puis la renouvelle', () => {
    const w = new World(16, 16, 16);
    const a = w.snapshot();
    expect(w.snapshot()).toBe(a);
    expect(a).not.toBe(w.data);
    w.setBlock(1, 2, 3, BlockId.Stone);
    const b = w.snapshot();
    expect(b).not.toBe(a);
    expect(b[w.index(1, 2, 3)]).toBe(BlockId.Stone);
    expect(a[w.index(1, 2, 3)]).toBe(BlockId.Air); // l'ancienne copie n'est pas modifiée
    w.setBlockRaw(0, 0, 0, BlockId.Dirt);
    expect(w.snapshot()).not.toBe(b);
    const c = w.snapshot();
    w.load(new Uint8Array(16 * 16 * 16));
    expect(w.snapshot()).not.toBe(c);
    const d = w.snapshot();
    w.clear();
    expect(w.snapshot()).not.toBe(d);
  });

  it('setBlock refusé : copie conservée', () => {
    const w = new World(16, 16, 16);
    const a = w.snapshot();
    expect(w.setBlock(0, 0, 0, BlockId.Air)).toBe(false);
    expect(w.snapshot()).toBe(a);
  });
});
