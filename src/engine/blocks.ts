import { BlockId, type BlockDef, type TileKey } from '../core/types';

/** Raccourci : même tuile sur les 6 faces. */
function all(key: TileKey) {
  return { top: key, side: key, bottom: key };
}

function def(
  id: BlockId,
  tiles: BlockDef['tiles'],
  color: number,
  opts: Partial<Pick<BlockDef, 'transparent' | 'solid' | 'breakable' | 'inPalette'>> = {},
): BlockDef {
  return {
    id,
    tiles,
    color,
    transparent: opts.transparent ?? false,
    solid: opts.solid ?? true,
    breakable: opts.breakable ?? true,
    inPalette: opts.inPalette ?? true,
  };
}

/** Définition de tous les blocs. Couleurs vives mais « réalistes » (herbe verte, terre brune…). */
export const BLOCKS: Record<BlockId, BlockDef> = {
  [BlockId.Air]: def(BlockId.Air, all('air'), 0x000000, {
    transparent: true,
    solid: false,
    breakable: false,
    inPalette: false,
  }),
  [BlockId.Grass]: def(BlockId.Grass, { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, 0x5fbf3a),
  [BlockId.Dirt]: def(BlockId.Dirt, all('dirt'), 0x8b5a2b),
  [BlockId.Stone]: def(BlockId.Stone, all('stone'), 0x8c8c8c),
  [BlockId.Cobblestone]: def(BlockId.Cobblestone, all('cobblestone'), 0x6f6f6f),
  [BlockId.Log]: def(BlockId.Log, { top: 'log_top', side: 'log_side', bottom: 'log_top' }, 0x6b4a2a),
  [BlockId.Planks]: def(BlockId.Planks, all('planks'), 0xc8a165),
  [BlockId.Leaves]: def(BlockId.Leaves, all('leaves'), 0x3f9b2f, { transparent: true }),
  [BlockId.Brick]: def(BlockId.Brick, all('brick'), 0xb5482f),
  [BlockId.Glass]: def(BlockId.Glass, all('glass'), 0xbfe8ff, { transparent: true }),
  [BlockId.Sand]: def(BlockId.Sand, all('sand'), 0xe8d68f),
  // Blocs PLEINS : tuiles recolorées au chargement (game/atlas.ts, GEM_BLOCK_TILES).
  [BlockId.Diamond]: def(BlockId.Diamond, all('diamond_block'), 0x2fd6f0),
  [BlockId.Gold]: def(BlockId.Gold, all('gold_block'), 0xffc81a),
  [BlockId.WoolWhite]: def(BlockId.WoolWhite, all('wool_white'), 0xf4f4f4),
  [BlockId.WoolRed]: def(BlockId.WoolRed, all('wool_red'), 0xe03a3a),
  [BlockId.WoolOrange]: def(BlockId.WoolOrange, all('wool_orange'), 0xf58a1f),
  [BlockId.WoolYellow]: def(BlockId.WoolYellow, all('wool_yellow'), 0xf7d83a),
  [BlockId.WoolGreen]: def(BlockId.WoolGreen, all('wool_green'), 0x5cc23a),
  [BlockId.WoolBlue]: def(BlockId.WoolBlue, all('wool_blue'), 0x3a6fe0),
  [BlockId.WoolPurple]: def(BlockId.WoolPurple, all('wool_purple'), 0x9b4fd0),
  [BlockId.WoolPink]: def(BlockId.WoolPink, all('wool_pink'), 0xf39ac2),
  [BlockId.WoolBlack]: def(BlockId.WoolBlack, all('wool_black'), 0x2a2a2a),
  [BlockId.Bedrock]: def(BlockId.Bedrock, all('bedrock'), 0x3a3a3a, { breakable: false, inPalette: false }),
  // Minerais (pierre + éclats). Couleur = celle des éclats (vignette de secours, particules).
  [BlockId.DiamondOre]: def(BlockId.DiamondOre, all('ore_diamond'), 0x5ac8f0),
  [BlockId.GoldOre]: def(BlockId.GoldOre, all('ore_gold'), 0xf0c040),
  [BlockId.EmeraldOre]: def(BlockId.EmeraldOre, all('ore_emerald'), 0x2fc86a),
  [BlockId.RubyOre]: def(BlockId.RubyOre, all('ore_ruby'), 0xe8403c),
  [BlockId.CoalOre]: def(BlockId.CoalOre, all('ore_coal'), 0x4a4a4e),
  [BlockId.IronOre]: def(BlockId.IronOre, all('ore_iron'), 0x3cb8a0),
  [BlockId.SilverOre]: def(BlockId.SilverOre, all('ore_silver'), 0xc8dce0),
  // Bloc PLEIN ajouté après les minerais (ids figés) : tuile recolorée comme or et diamant.
  [BlockId.EmeraldBlock]: def(BlockId.EmeraldBlock, all('emerald_block'), 0x14e07c),
};

/**
 * Ordre de la palette : nature d'abord (ce qu'on voit autour de soi), puis construction,
 * puis les laines dans l'ordre de l'arc-en-ciel, puis les minerais (du plus commun au plus
 * précieux) et les « trésors » à la fin : blocs pleins d'or, d'émeraude et de diamant
 * (du jaune au bleu en passant par le vert : dégradé agréable en bout de palette).
 */
export const PALETTE: BlockId[] = [
  BlockId.Grass,
  BlockId.Dirt,
  BlockId.Sand,
  BlockId.Stone,
  BlockId.Cobblestone,
  BlockId.Brick,
  BlockId.Planks,
  BlockId.Log,
  BlockId.Leaves,
  BlockId.Glass,
  BlockId.WoolRed,
  BlockId.WoolOrange,
  BlockId.WoolYellow,
  BlockId.WoolGreen,
  BlockId.WoolBlue,
  BlockId.WoolPurple,
  BlockId.WoolPink,
  BlockId.WoolWhite,
  BlockId.WoolBlack,
  BlockId.CoalOre,
  BlockId.IronOre,
  BlockId.SilverOre,
  BlockId.GoldOre,
  BlockId.RubyOre,
  BlockId.EmeraldOre,
  BlockId.DiamondOre,
  BlockId.Gold,
  BlockId.EmeraldBlock,
  BlockId.Diamond,
];

/** Nombre d'identifiants de blocs (taille des tables de correspondance). */
export const BLOCK_COUNT = Object.keys(BLOCKS).length;

/** Toutes les clés de tuiles utilisées par les blocs (sans 'air'), dans un ordre stable. */
export const ALL_TILE_KEYS: TileKey[] = (() => {
  const keys: TileKey[] = [];
  for (let id = 1; id < BLOCK_COUNT; id++) {
    const t = BLOCKS[id as BlockId].tiles;
    for (const k of [t.top, t.side, t.bottom]) if (!keys.includes(k)) keys.push(k);
  }
  return keys;
})();

/**
 * Mode de rendu interne (non exposé dans BlockDef) :
 * - 'cutout' : alpha binaire (feuilles), dessiné avec alphaTest et écriture de profondeur ;
 * - 'blend'  : semi-transparent (verre), mélange alpha sans écriture de profondeur.
 */
export function isCutout(id: BlockId): boolean {
  return id === BlockId.Leaves;
}

export function isValidBlockId(id: number): id is BlockId {
  return Number.isInteger(id) && id >= 0 && id < BLOCK_COUNT;
}
