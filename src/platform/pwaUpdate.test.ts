import { describe, expect, it, vi } from 'vitest';
import { createUpdatePolicy } from './pwaUpdate';

describe('createUpdatePolicy', () => {
  it('écran de démarrage affiché : applique la mise à jour (rechargement)', () => {
    const update = vi.fn(() => Promise.resolve());
    const p = createUpdatePolicy(() => update, () => true);
    p.onNeedRefresh();
    expect(update).toHaveBeenCalledWith(true);
    expect(p.pending).toBe(false);
  });

  it('en pleine partie : ne recharge pas, garde la mise à jour pour le prochain lancement', () => {
    const update = vi.fn(() => Promise.resolve());
    const p = createUpdatePolicy(() => update, () => false);
    p.onNeedRefresh();
    expect(update).not.toHaveBeenCalled();
    expect(p.pending).toBe(true);
  });

  it('updateSW pas encore disponible : en attente, sans erreur', () => {
    const p = createUpdatePolicy(() => null, () => true);
    expect(() => p.onNeedRefresh()).not.toThrow();
    expect(p.pending).toBe(true);
  });

  it('échec de updateSW : signalé, jamais levé', async () => {
    const onError = vi.fn();
    const p = createUpdatePolicy(() => () => Promise.reject(new Error('x')), () => true, onError);
    p.onNeedRefresh();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalled();
  });
});
