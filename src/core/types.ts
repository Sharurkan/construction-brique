/**
 * Contrats partagés entre modules. Toute modification doit passer par l'orchestrateur.
 * Repère : X = est, Y = haut, Z = sud. Un bloc occupe [x, x+1) × [y, y+1) × [z, z+1).
 */

// ---------- Blocs ----------
export enum BlockId {
  Air = 0,
  Grass,
  Dirt,
  Stone,
  Cobblestone,
  Log,
  Planks,
  Leaves,
  Brick,
  Glass,
  Sand,
  /** Bloc PLEIN de diamant (tuile Kenney recolorée, voir game/atlas.ts). Le minerai = DiamondOre. */
  Diamond,
  /** Bloc PLEIN d'or (tuile Kenney recolorée, voir game/atlas.ts). Le minerai = GoldOre. */
  Gold,
  WoolWhite,
  WoolRed,
  WoolOrange,
  WoolYellow,
  WoolGreen,
  WoolBlue,
  WoolPurple,
  WoolPink,
  WoolBlack,
  /** Socle indestructible au fond du monde (y = 0). Non présent dans la palette. */
  Bedrock,
  // Nouveaux blocs : TOUJOURS ajoutés à la fin (les numéros sont stockés dans les sauvegardes).
  /** Minerais du Voxel Pack (pierre avec éclats). */
  DiamondOre,
  GoldOre,
  EmeraldOre,
  RubyOre,
  CoalOre,
  IronOre,
  SilverOre,
  /** Bloc PLEIN d'émeraude (tuile Kenney recolorée, voir game/atlas.ts). Le minerai = EmeraldOre. */
  EmeraldBlock,
}

/** Clé de tuile dans l'atlas (ex. 'grass_top'). L'atlas final viendra du pack choisi en Phase 2. */
export type TileKey = string;

export interface BlockDef {
  id: BlockId;
  /** Clés de tuiles par face. */
  tiles: { top: TileKey; side: TileKey; bottom: TileKey };
  /** Rendu dans la passe transparente (verre, feuilles) : pas de culling des faces voisines identiques sauf même id. */
  transparent: boolean;
  /** Collision avec le joueur. */
  solid: boolean;
  /** Peut être cassé par le joueur. */
  breakable: boolean;
  /** Visible dans la palette. */
  inPalette: boolean;
  /** Couleur moyenne (hex) : icônes de secours, particules, couleur provisoire. */
  color: number;
}

// ---------- Monde ----------
export const CHUNK_SIZE = 16;
/** Monde : 6 × 3 × 6 chunks = 96 × 48 × 96 blocs. */
export const WORLD_SIZE_X = 96;
export const WORLD_SIZE_Y = 48;
export const WORLD_SIZE_Z = 96;

export type Vec3i = [number, number, number];

export interface RaycastHit {
  /** Bloc touché. */
  block: Vec3i;
  /** Normale de la face touchée (un seul axe = ±1). Bloc à poser = block + normal. */
  normal: Vec3i;
  id: BlockId;
  distance: number;
}

/** Vue minimale du monde pour les collisions (utilisée par le joueur, Agent D). */
export interface CollisionWorld {
  isSolid(x: number, y: number, z: number): boolean;
}

export interface VoxelWorld extends CollisionWorld {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  getBlock(x: number, y: number, z: number): BlockId;
  /** Renvoie false si hors limites ou interdit (bedrock). Marque les chunks à remailler. */
  setBlock(x: number, y: number, z: number, id: BlockId): boolean;
  raycast(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number): RaycastHit | null;
  /** Appelé après chaque setBlock réussi. Renvoie une fonction de désabonnement. */
  onChange(cb: (x: number, y: number, z: number, id: BlockId) => void): () => void;
  /** Copie brute des blocs, index = x + sizeX * (z + sizeZ * y). */
  serialize(): Uint8Array;
  load(data: Uint8Array): void;
}

// ---------- Entrées / joueur ----------
/** État d'entrée lu à chaque frame (tactile + clavier/souris fusionnés). */
export interface InputState {
  /** Déplacement relatif à la caméra, chaque axe dans [-1, 1]. x = droite, z = avant. */
  move: { x: number; z: number };
  /** Rotation demandée depuis la dernière frame, en radians. Remis à zéro par consumeLook(). */
  look: { yaw: number; pitch: number };
  jump: boolean;
  /** Descendre en mode vol (Maj au clavier, bouton DESCENDRE en tactile). Absent = false. */
  descend?: boolean;
}

export interface PlayerState {
  position: { x: number; y: number; z: number }; // pieds
  yaw: number;
  pitch: number;
}

/** Actions déclenchées par l'interface (boutons, palette). */
export interface GameActions {
  breakBlock(): void;
  placeBlock(): void;
  selectBlock(id: BlockId): void;
  /** Déclenché uniquement après l'appui long sur le bouton « nouveau monde ». */
  newWorld(): void;
  /**
   * Bascule le mode vol et renvoie le nouvel état réel (affiché par le HUD).
   * Tolérance : une implémentation qui ne renvoie rien reste acceptée (le HUD bascule alors localement).
   */
  toggleFly?(): boolean | void;
}

// ---------- Sauvegarde ----------
export const SAVE_VERSION = 1;

export interface SavedWorld {
  version: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  seed: number;
  /** Même format que VoxelWorld.serialize(). */
  blocks: Uint8Array;
  player: PlayerState;
  selected: BlockId;
  savedAt: number;
}

export interface SaveStore {
  load(): Promise<SavedWorld | null>;
  save(world: SavedWorld): Promise<void>;
  clear(): Promise<void>;
}

// ---------- Sons (Phase 2) ----------
export type SoundName = 'break' | 'place' | 'step' | 'jump' | 'click' | 'select' | 'newWorld';
export interface SoundPlayer {
  play(name: SoundName, opts?: { blockId?: BlockId }): void;
  /** Doit être appelé sur un geste utilisateur (politique autoplay). */
  unlock(): void;
}
