import { describe, expect, it } from 'vitest';
import { BlockId, type SoundName } from '../core/types';
import { PALETTE } from '../engine/blocks';
import {
  SOUND_GROUPS,
  breakGroupFor,
  materialOf,
  pickVariant,
  pitchVariation,
  soundGroupFor,
  stepGroupFor,
} from './mapping';

describe('materialOf', () => {
  it('classe bois, pierre, verre et doux', () => {
    expect(materialOf(BlockId.Log)).toBe('wood');
    expect(materialOf(BlockId.Planks)).toBe('wood');
    for (const id of [BlockId.Stone, BlockId.Cobblestone, BlockId.Brick, BlockId.Diamond, BlockId.Gold, BlockId.Bedrock]) {
      expect(materialOf(id)).toBe('stone');
    }
    expect(materialOf(BlockId.Glass)).toBe('glass');
    for (const id of [BlockId.Grass, BlockId.Dirt, BlockId.Sand, BlockId.Leaves, BlockId.WoolRed, BlockId.WoolBlack]) {
      expect(materialOf(id)).toBe('soft');
    }
  });

  it('minerais et blocs pleins (or, émeraude, diamant) → pierre', () => {
    for (const id of [
      BlockId.DiamondOre,
      BlockId.GoldOre,
      BlockId.EmeraldOre,
      BlockId.RubyOre,
      BlockId.CoalOre,
      BlockId.IronOre,
      BlockId.SilverOre,
      BlockId.Diamond,
      BlockId.Gold,
      BlockId.EmeraldBlock,
    ]) {
      expect(materialOf(id)).toBe('stone');
      expect(breakGroupFor(id)).toBe('break_stone');
      expect(stepGroupFor(id)).toBe('step_stone');
    }
  });

  it('bloc inconnu ou absent → doux', () => {
    expect(materialOf(undefined)).toBe('soft');
    expect(materialOf(999 as BlockId)).toBe('soft');
  });
});

describe('breakGroupFor / stepGroupFor', () => {
  it('casse selon le matériau', () => {
    expect(breakGroupFor(BlockId.Planks)).toBe('break_wood');
    expect(breakGroupFor(BlockId.Gold)).toBe('break_stone');
    expect(breakGroupFor(BlockId.Glass)).toBe('break_glass');
    expect(breakGroupFor(BlockId.WoolPink)).toBe('break_soft');
  });

  it('pas selon le bloc sous les pieds', () => {
    expect(stepGroupFor(BlockId.Grass)).toBe('step_grass');
    expect(stepGroupFor(BlockId.Sand)).toBe('step_grass');
    expect(stepGroupFor(BlockId.Log)).toBe('step_wood');
    expect(stepGroupFor(BlockId.Brick)).toBe('step_stone');
    expect(stepGroupFor(BlockId.Glass)).toBe('step_stone');
    expect(stepGroupFor(undefined)).toBe('step_grass');
  });

  it('tout bloc de la palette a un groupe connu', () => {
    for (const id of PALETTE) {
      expect(SOUND_GROUPS).toContain(breakGroupFor(id));
      expect(SOUND_GROUPS).toContain(stepGroupFor(id));
    }
  });
});

describe('soundGroupFor', () => {
  it('mappe chaque SoundName vers un groupe', () => {
    const expected: Record<SoundName, string> = {
      break: 'break_soft',
      place: 'place',
      step: 'step_grass',
      jump: 'jump',
      click: 'click',
      select: 'select',
      newWorld: 'new_world',
      splash: 'splash',
    };
    for (const [name, group] of Object.entries(expected)) {
      expect(soundGroupFor(name as SoundName)).toBe(group);
    }
  });

  it('utilise le bloc pour casser et marcher, pas pour poser', () => {
    expect(soundGroupFor('break', BlockId.Stone)).toBe('break_stone');
    expect(soundGroupFor('step', BlockId.Planks)).toBe('step_wood');
    expect(soundGroupFor('place', BlockId.Glass)).toBe('place');
  });

  it('eau : casser / poser → sons doux, marcher au fond → pas doux', () => {
    expect(materialOf(BlockId.Water)).toBe('soft');
    expect(soundGroupFor('break', BlockId.Water)).toBe('break_soft');
    expect(soundGroupFor('place', BlockId.Water)).toBe('place');
    expect(soundGroupFor('step', BlockId.Water)).toBe('step_grass');
  });
});

describe('pickVariant / pitchVariation', () => {
  it('reste dans les bornes', () => {
    expect(pickVariant(0)).toBe(0);
    expect(pickVariant(1, () => 0.99)).toBe(0);
    expect(pickVariant(3, () => 0)).toBe(0);
    expect(pickVariant(3, () => 0.999999)).toBe(2);
    expect(pickVariant(3, () => 1)).toBe(2);
  });

  it('varie la hauteur de ±5 %', () => {
    expect(pitchVariation(() => 0)).toBeCloseTo(0.95);
    expect(pitchVariation(() => 0.5)).toBeCloseTo(1);
    expect(pitchVariation(() => 1)).toBeCloseTo(1.05);
  });
});
