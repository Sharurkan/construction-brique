import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_VERSION, type SavedWorld, type SaveStore } from '../core/types';
import { createAutosave } from './autosave';

function state(seed = 0): SavedWorld {
  return {
    version: SAVE_VERSION,
    sizeX: 1,
    sizeY: 1,
    sizeZ: 1,
    seed,
    blocks: new Uint8Array(1),
    player: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
    selected: 1,
    savedAt: 0,
  };
}

/** Store dont chaque écriture dure `writeMs` (minuteries factices) et qui détecte la concurrence. */
class SlowStore implements SaveStore {
  saves: SavedWorld[] = [];
  active = 0;
  maxActive = 0;
  fail = false;
  constructor(private writeMs = 0) {}
  async load() {
    return null;
  }
  async save(w: SavedWorld) {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.writeMs > 0) await new Promise((r) => setTimeout(r, this.writeMs));
      if (this.fail) throw new Error('disque plein');
      this.saves.push(w);
    } finally {
      this.active--;
    }
  }
  async clear() {}
}

class FakeTarget {
  visibilityState = 'visible';
  listeners = new Map<string, Set<() => void>>();
  addEventListener(t: string, fn: () => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: () => void) {
    this.listeners.get(t)?.delete(fn);
  }
  dispatch(t: string) {
    for (const fn of this.listeners.get(t) ?? []) fn();
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

describe('createAutosave', () => {
  let doc: FakeTarget;
  let win: FakeTarget;
  let seq: number;
  const getState = () => state(++seq);

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new FakeTarget();
    win = new FakeTarget();
    seq = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(store: SaveStore, opts: Parameters<typeof createAutosave>[2] = {}) {
    return createAutosave(store, getState, { documentTarget: doc, windowTarget: win, onError: () => {}, ...opts });
  }

  it('anti-rebond : une seule écriture 2 s après la dernière modification', async () => {
    const store = new SlowStore();
    const a = make(store);
    a.markDirty();
    await vi.advanceTimersByTimeAsync(1500);
    a.markDirty();
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.saves.length).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(store.saves.length).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.saves.length).toBe(1);
    a.dispose();
  });

  it('intervalle max : écrit au plus tard après 15 s de modifications continues', async () => {
    const store = new SlowStore();
    const a = make(store);
    for (let t = 0; t < 14_500; t += 500) {
      a.markDirty();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(store.saves.length).toBe(0);
    a.markDirty();
    await vi.advanceTimersByTimeAsync(600);
    expect(store.saves.length).toBe(1);
    a.dispose();
  });

  it('options personnalisées', async () => {
    const store = new SlowStore();
    const a = make(store, { debounceMs: 100, maxIntervalMs: 250 });
    for (let i = 0; i < 4; i++) {
      a.markDirty();
      await vi.advanceTimersByTimeAsync(80);
    }
    expect(store.saves.length).toBe(1); // forcé par maxIntervalMs à t = 250
    a.dispose();
  });

  it('flush écrit immédiatement, puis rien si pas sale', async () => {
    const store = new SlowStore();
    const a = make(store);
    await a.flush();
    expect(store.saves.length).toBe(0);
    a.markDirty();
    await a.flush();
    expect(store.saves.length).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.saves.length).toBe(1); // minuterie annulée par flush
    a.dispose();
  });

  it('jamais deux écritures concurrentes ; une seule écriture en file', async () => {
    const store = new SlowStore(1000);
    const a = make(store);
    a.markDirty();
    const p1 = a.flush();
    a.markDirty();
    const p2 = a.flush();
    a.markDirty();
    const p3 = a.flush();
    expect(p2).toBe(p3);
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all([p1, p2, p3]);
    expect(store.maxActive).toBe(1);
    expect(store.saves.length).toBe(2);
    expect(store.saves[1].seed).toBe(2); // état lu au moment de l'écriture en file
    a.dispose();
  });

  it('modification pendant une écriture → réécrite ensuite', async () => {
    const store = new SlowStore(3000);
    const a = make(store);
    a.markDirty();
    await vi.advanceTimersByTimeAsync(2000); // écriture démarre
    expect(store.active).toBe(1);
    a.markDirty();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.maxActive).toBe(1);
    expect(store.saves.length).toBe(2);
    a.dispose();
  });

  it('visibilitychange (hidden) et pagehide déclenchent une sauvegarde', async () => {
    const store = new SlowStore();
    const a = make(store);
    a.markDirty();
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    expect(store.saves.length).toBe(0);
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    expect(store.saves.length).toBe(1);
    a.markDirty();
    win.dispatch('pagehide');
    await vi.advanceTimersByTimeAsync(0);
    expect(store.saves.length).toBe(2);
    a.dispose();
  });

  it('échec d\'écriture : signalé puis réessayé', async () => {
    const store = new SlowStore();
    store.fail = true;
    const errors: unknown[] = [];
    const a = make(store, { onError: (e) => errors.push(e) });
    a.markDirty();
    await a.flush();
    expect(errors.length).toBe(1);
    store.fail = false;
    await vi.advanceTimersByTimeAsync(2100);
    expect(store.saves.length).toBe(1);
    a.dispose();
  });

  it('getState qui lève ne casse rien', async () => {
    const store = new SlowStore();
    const errors: unknown[] = [];
    const a = createAutosave(store, () => { throw new Error('boum'); }, {
      documentTarget: null, windowTarget: null, onError: (e) => errors.push(e),
    });
    a.markDirty();
    await expect(a.flush()).resolves.toBeUndefined();
    expect(errors.length).toBe(1);
    a.dispose();
  });

  it('dispose retire écouteurs et minuterie', async () => {
    const store = new SlowStore();
    const a = make(store);
    expect(doc.count() + win.count()).toBe(2);
    a.markDirty();
    a.dispose();
    expect(doc.count() + win.count()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.saves.length).toBe(0);
  });

  it('horloge et minuteries injectables', async () => {
    const store = new SlowStore();
    let now = 0;
    const pending: { at: number; fn: () => void }[] = [];
    const a = createAutosave(store, getState, {
      documentTarget: null,
      windowTarget: null,
      timers: {
        now: () => now,
        setTimeout: (fn, ms) => {
          const t = { at: now + ms, fn };
          pending.push(t);
          return t as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout: (h) => {
          const i = pending.indexOf(h as unknown as { at: number; fn: () => void });
          if (i >= 0) pending.splice(i, 1);
        },
      },
    });
    a.markDirty();
    expect(pending.length).toBe(1);
    expect(pending[0].at).toBe(2000);
    now = 2000;
    pending.shift()!.fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.saves.length).toBe(1);
    a.dispose();
  });
});

/** SlowStore doté d'une sauvegarde d'urgence synchrone (journalise l'ordre des appels). */
class EmergencyStore extends SlowStore {
  emergencies: SavedWorld[] = [];
  log: string[] = [];
  emergencyOk = true;
  saveEmergency(w: SavedWorld): boolean {
    this.log.push('emergency');
    if (!this.emergencyOk) return false;
    this.emergencies.push(w);
    return true;
  }
  override async save(w: SavedWorld) {
    this.log.push('save');
    await super.save(w);
  }
}

describe("createAutosave : sauvegarde d'urgence", () => {
  let doc: FakeTarget;
  let win: FakeTarget;
  let seq: number;
  const getState = () => state(++seq);

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new FakeTarget();
    win = new FakeTarget();
    seq = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(store: SaveStore) {
    return createAutosave(store, getState, { documentTarget: doc, windowTarget: win, onError: () => {} });
  }

  it("hidden : écrit l'urgence de façon synchrone, avant l'écriture asynchrone", () => {
    const store = new EmergencyStore(1000);
    const a = make(store);
    a.markDirty();
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    // Aucune attente : l'urgence est déjà écrite au retour du gestionnaire.
    expect(store.emergencies.length).toBe(1);
    expect(store.log).toEqual(['emergency', 'save']);
    a.dispose();
  });

  it('pagehide après hidden sans nouvelle modification : pas de seconde urgence', () => {
    const store = new EmergencyStore(1000);
    const a = make(store);
    a.markDirty();
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    win.dispatch('pagehide');
    expect(store.emergencies.length).toBe(1);
    a.markDirty();
    win.dispatch('pagehide');
    expect(store.emergencies.length).toBe(2);
    a.dispose();
  });

  it("pagehide seul déclenche aussi l'urgence", () => {
    const store = new EmergencyStore(1000);
    const a = make(store);
    a.markDirty();
    win.dispatch('pagehide');
    expect(store.emergencies.length).toBe(1);
    a.dispose();
  });

  it("rien de modifié ou déjà confirmé : pas d'urgence", async () => {
    const store = new EmergencyStore();
    const a = make(store);
    win.dispatch('pagehide');
    expect(store.emergencies.length).toBe(0);
    a.markDirty();
    await a.flush();
    expect(store.saves.length).toBe(1);
    win.dispatch('pagehide');
    expect(store.emergencies.length).toBe(0);
    a.dispose();
  });

  it("urgence en échec (quota) : ignorée, retentée au masquage suivant", () => {
    const store = new EmergencyStore(1000);
    store.emergencyOk = false;
    const a = make(store);
    a.markDirty();
    win.dispatch('pagehide');
    expect(store.emergencies.length).toBe(0);
    store.emergencyOk = true;
    win.dispatch('pagehide');
    expect(store.emergencies.length).toBe(1);
    a.dispose();
  });
});

describe('createAutosave : joueur seul', () => {
  class PlayerStore extends SlowStore {
    log: string[] = [];
    override async save(w: SavedWorld) {
      this.log.push('full');
      await super.save(w);
    }
    async savePlayer(w: SavedWorld) {
      if (this.fail) throw new Error('disque plein');
      this.log.push('player');
      this.saves.push(w);
    }
  }
  const opts = { documentTarget: null, windowTarget: null, onError: () => {} };

  it('déplacement seul → savePlayer ; bloc modifié → écriture complète', async () => {
    const s = new PlayerStore();
    const a = createAutosave(s, () => state(), opts);
    a.markDirty('player');
    await a.flush();
    a.markDirty('player');
    a.markDirty('player');
    await a.flush();
    a.markDirty('world');
    a.markDirty('player');
    await a.flush();
    a.markDirty('player');
    await a.flush();
    a.markDirty(); // défaut = monde
    await a.flush();
    expect(s.log).toEqual(['player', 'player', 'full', 'player', 'full']);
    a.dispose();
  });

  it('écriture complète ratée : la suivante reste complète même si seul le joueur a bougé', async () => {
    const s = new PlayerStore();
    const a = createAutosave(s, () => state(), opts);
    a.markDirty('world');
    s.fail = true;
    await a.flush();
    s.fail = false;
    a.markDirty('player');
    await a.flush();
    a.markDirty('player');
    await a.flush();
    // 1er « full » raté, puis « full » réussi (pas « player »), puis « player ».
    expect(s.log).toEqual(['full', 'full', 'player']);
    expect(s.saves.length).toBe(2);
    a.dispose();
  });

  it('store sans savePlayer : toujours une écriture complète', async () => {
    const s = new SlowStore();
    const a = createAutosave(s, () => state(), opts);
    a.markDirty('player');
    await a.flush();
    expect(s.saves.length).toBe(1);
    a.dispose();
  });
});
