/**
 * Logique pure (sans Web Audio) : quel groupe de variantes jouer pour un SoundName et un bloc.
 * Les groupes sont les clés de la map de sources passée à WebAudioSoundPlayer
 * (elle viendra de `src/assets/manifest.ts`, export SOUNDS).
 */
import { BlockId, type SoundName } from '../core/types';

export const SOUND_GROUPS = [
  'break_wood',
  'break_stone',
  'break_glass',
  'break_soft',
  'place',
  'step_grass',
  'step_wood',
  'step_stone',
  'jump',
  'click',
  'select',
  'new_world',
] as const;

export type SoundGroup = (typeof SOUND_GROUPS)[number];

/** Grandes familles de matériaux, pour choisir les sons de casse et de pas. */
export type Material = 'wood' | 'stone' | 'glass' | 'soft';

export function materialOf(id: BlockId | undefined): Material {
  switch (id) {
    case BlockId.Log:
    case BlockId.Planks:
      return 'wood';
    case BlockId.Stone:
    case BlockId.Cobblestone:
    case BlockId.Brick:
    case BlockId.Diamond:
    case BlockId.Gold:
    case BlockId.Bedrock:
    case BlockId.DiamondOre:
    case BlockId.GoldOre:
    case BlockId.EmeraldOre:
    case BlockId.RubyOre:
    case BlockId.CoalOre:
    case BlockId.IronOre:
    case BlockId.SilverOre:
      return 'stone';
    case BlockId.Glass:
      return 'glass';
    default:
      return 'soft'; // herbe, terre, sable, feuilles, laines… (et bloc inconnu)
  }
}

export function breakGroupFor(id: BlockId | undefined): SoundGroup {
  switch (materialOf(id)) {
    case 'wood':
      return 'break_wood';
    case 'stone':
      return 'break_stone';
    case 'glass':
      return 'break_glass';
    default:
      return 'break_soft';
  }
}

/** Pas : bois → step_wood, pierre et verre → step_stone, tout le reste → step_grass. */
export function stepGroupFor(id: BlockId | undefined): SoundGroup {
  switch (materialOf(id)) {
    case 'wood':
      return 'step_wood';
    case 'stone':
    case 'glass':
      return 'step_stone';
    default:
      return 'step_grass';
  }
}

/** Groupe de variantes à jouer pour un SoundName (et le bloc concerné, si pertinent). */
export function soundGroupFor(name: SoundName, blockId?: BlockId): SoundGroup {
  switch (name) {
    case 'break':
      return breakGroupFor(blockId);
    case 'step':
      return stepGroupFor(blockId);
    case 'place':
      return 'place';
    case 'jump':
      return 'jump';
    case 'click':
      return 'click';
    case 'select':
      return 'select';
    case 'newWorld':
      return 'new_world';
  }
}

/** Index de variante aléatoire dans [0, count). `rand` injectable (tests). */
export function pickVariant(count: number, rand: () => number = Math.random): number {
  if (count <= 1) return 0;
  return Math.min(count - 1, Math.floor(rand() * count));
}

/** Facteur de hauteur dans [1 - spread, 1 + spread] (±5 % par défaut). */
export function pitchVariation(rand: () => number = Math.random, spread = 0.05): number {
  return 1 + (rand() * 2 - 1) * spread;
}
