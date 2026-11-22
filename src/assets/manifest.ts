/**
 * Manifeste des assets (Kenney CC0 + police Andika OFL). Voir CREDITS.md.
 * Tous les chemins sont relatifs au base Vite (import.meta.env.BASE_URL).
 * Les fichiers vivent dans public/assets/ et sont précachés par la PWA.
 */

const BASE = import.meta.env.BASE_URL + 'assets/';
const tex = (key: string): string => `${BASE}textures/${key}.png`;
const snd = (name: string): string => `${BASE}sounds/${name}.ogg`;

/** Liste des clés de tuiles disponibles (toutes en PNG 128 × 128, Kenney Voxel Pack). */
export const TEXTURE_TILE_KEYS = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'cobblestone',
  'log_top',
  'log_side',
  'planks',
  'leaves', // transparente (alpha)
  'brick',
  'glass', // transparente (alpha)
  'sand',
  'diamond',
  'gold',
  'wool', // tuile claire neutre (cotton_tan) à teinter avec WOOL_TINTS
  'bedrock',
  // Laines natives du pack (couleurs douces, non vives) :
  'wool_red',
  'wool_green',
  'wool_blue',
  // Tuiles bonus :
  'stone_brick',
  'planks_red',
  'snow',
  'ice',
] as const;

export type TextureTileKey = (typeof TEXTURE_TILE_KEYS)[number];

/** Taille (px) commune à toutes les tuiles. */
export const TILE_SIZE = 128;

export const TEXTURE_TILES: Record<string, string> = Object.fromEntries(
  TEXTURE_TILE_KEYS.map((k) => [k, tex(k)]),
);

const variants = (name: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => snd(`${name}_${i + 1}`));

/** Groupes de variantes : en jouer une au hasard à chaque fois. */
export const SOUNDS: Record<string, string[]> = {
  break_wood: variants('break_wood', 3),
  break_stone: variants('break_stone', 3),
  break_glass: variants('break_glass', 2),
  break_soft: variants('break_soft', 3),
  place: variants('place', 3),
  step_grass: variants('step_grass', 3),
  step_wood: variants('step_wood', 2),
  step_stone: variants('step_stone', 2),
  jump: variants('jump', 1),
  click: variants('click', 1),
  select: variants('select', 1),
  new_world: variants('new_world', 1),
};

/**
 * Icônes. Les SVG/PNG Kenney sont des pictos BLANCS (sauf btn_break, pioche colorée,
 * et le joystick) : les poser sur un fond (btn_bg ou une pastille CSS colorée).
 */
export const ICONS: Record<string, string> = {
  joystick_base: `${BASE}icons/joystick_base.svg`,
  joystick_knob: `${BASE}icons/joystick_knob.svg`,
  btn_bg: `${BASE}icons/btn_bg.svg`,
  btn_break: `${BASE}icons/btn_break.png`,
  btn_place: `${BASE}icons/btn_place.svg`,
  btn_jump: `${BASE}icons/btn_jump.svg`,
  btn_fly: `${BASE}icons/btn_fly.png`,
  btn_fly_down: `${BASE}icons/btn_fly_down.png`,
  btn_new_world: `${BASE}icons/btn_new_world.png`,
  btn_credits: `${BASE}icons/btn_credits.png`,
  btn_fullscreen: `${BASE}icons/btn_fullscreen.svg`,
  btn_fullscreen_exit: `${BASE}icons/btn_fullscreen_exit.svg`,
  btn_sound_on: `${BASE}icons/btn_sound_on.svg`,
  btn_sound_off: `${BASE}icons/btn_sound_off.svg`,
};

/** Andika (SIL, OFL 1.1). Nom de famille CSS conseillé : 'Andika'. */
export const FONTS: { regular: string; bold?: string } = {
  regular: `${BASE}fonts/Andika-Regular.woff2`,
  bold: `${BASE}fonts/Andika-Bold.woff2`,
};

/** Couleurs vives (multiplicatives) pour teinter la tuile `wool`. */
export const WOOL_TINTS: Record<string, number> = {
  white: 0xffffff,
  red: 0xe53935,
  orange: 0xff9800,
  yellow: 0xffeb3b,
  green: 0x43a047,
  blue: 0x1e88e5,
  purple: 0x8e24aa,
  pink: 0xf06292,
  black: 0x3a3a3a,
};

/**
 * Couleurs de laine qui existent aussi en tuile native du pack (wool_<couleur>).
 * Attention : teintes Kenney plutôt douces/terreuses (rouge brique, vert, bleu),
 * moins vives que WOOL_TINTS ; au choix du moteur.
 */
export const WOOL_HAS_NATIVE: string[] = ['red', 'green', 'blue'];
