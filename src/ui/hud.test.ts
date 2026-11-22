import { describe, expect, it } from 'vitest';
import { BlockId } from '../core/types';
import { PALETTE } from '../engine/blocks';
import { BLOCK_LABELS_FR, nextFlyingState } from './hud';

describe('nextFlyingState (bouton vol)', () => {
  it('toggleFly renvoie un booléen : reflète l’état réel', () => {
    expect(nextFlyingState(true, false, false)).toBe(true);
    expect(nextFlyingState(false, false, false)).toBe(false);
    // Même si l'action a déjà appelé setFlying : pas de double inversion.
    expect(nextFlyingState(true, false, true)).toBe(true);
    expect(nextFlyingState(false, true, false)).toBe(false);
  });

  it('toggleFly ne renvoie rien et ne touche pas au HUD : basculement local', () => {
    expect(nextFlyingState(undefined, false, false)).toBe(true);
    expect(nextFlyingState(undefined, true, true)).toBe(false);
  });

  it('toggleFly a déjà appelé setFlying sans rien renvoyer : état conservé', () => {
    expect(nextFlyingState(undefined, false, true)).toBe(true);
    expect(nextFlyingState(undefined, true, false)).toBe(false);
  });

  it('valeur de retour non booléenne : ignorée', () => {
    expect(nextFlyingState(1, false, false)).toBe(true);
    expect(nextFlyingState('oui', true, true)).toBe(false);
    expect(nextFlyingState(null, false, false)).toBe(true);
  });
});

describe('BLOCK_LABELS_FR', () => {
  it('chaque bloc de la palette a un libellé unique et non vide', () => {
    const labels = PALETTE.map((id) => BLOCK_LABELS_FR[id]);
    for (const l of labels) expect(l?.length ?? 0).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    expect(BLOCK_LABELS_FR[BlockId.Diamond]).toBe('Bloc de diamant');
    expect(BLOCK_LABELS_FR[BlockId.DiamondOre]).toBe('Minerai de diamant');
  });
});
