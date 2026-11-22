/**
 * Sauvegarde automatique :
 * - anti-rebond : écrit `debounceMs` après la dernière modification ;
 * - intervalle max : jamais plus de `maxIntervalMs` entre la 1re modification non sauvée et l'écriture,
 *   même si l'enfant construit sans arrêt ;
 * - sauvegarde immédiate quand la page passe en arrière-plan (`visibilitychange` → hidden) ou `pagehide` ;
 * - jamais deux écritures concurrentes : une demande pendant une écriture est mise en file (une seule).
 */
import type { SavedWorld, SaveStore } from '../core/types';

type TimerHandle = ReturnType<typeof setTimeout>;

export interface AutosaveTimers {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  now(): number;
}

interface EventTargetLike {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface AutosaveOptions {
  /** Délai après la dernière modification. Défaut 2000 ms. */
  debounceMs?: number;
  /** Délai max entre la 1re modification non sauvée et l'écriture. Défaut 15000 ms. */
  maxIntervalMs?: number;
  /** Horloge et minuteries injectables (tests). Défaut : globales, lues à chaque appel. */
  timers?: AutosaveTimers;
  /** Cible de `visibilitychange` (défaut `document`), `null` pour désactiver. */
  documentTarget?: (EventTargetLike & { visibilityState?: string }) | null;
  /** Cible de `pagehide` (défaut `window`), `null` pour désactiver. */
  windowTarget?: EventTargetLike | null;
  /** Appelé si une écriture échoue (défaut : console.warn). La modification reste marquée « sale ». */
  onError?: (err: unknown) => void;
}

export interface Autosave {
  /** Signale une modification du monde (ou du joueur) à sauvegarder. */
  markDirty(): void;
  /** Sauvegarde immédiatement si nécessaire ; résout quand l'écriture (et celle en file) est finie. */
  flush(): Promise<void>;
  /** Retire les écouteurs et minuteries. N'écrit pas : appeler `flush()` avant si besoin. */
  dispose(): void;
}

const defaultTimers: AutosaveTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h),
  now: () => Date.now(),
};

export function createAutosave(
  store: SaveStore,
  getState: () => SavedWorld,
  opts: AutosaveOptions = {},
): Autosave {
  const debounceMs = opts.debounceMs ?? 2000;
  const maxIntervalMs = Math.max(opts.maxIntervalMs ?? 15000, 0);
  const timers = opts.timers ?? defaultTimers;
  const onError = opts.onError ?? ((err: unknown) => console.warn('[autosave] échec de sauvegarde', err));
  const doc =
    opts.documentTarget !== undefined
      ? opts.documentTarget
      : ((globalThis as { document?: EventTargetLike & { visibilityState?: string } }).document ?? null);
  const win =
    opts.windowTarget !== undefined
      ? opts.windowTarget
      : ((globalThis as { window?: EventTargetLike }).window ?? null);

  let dirty = false;
  let firstDirtyAt: number | null = null;
  let timer: TimerHandle | null = null;
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    if (disposed) return;
    clearTimer();
    const now = timers.now();
    if (firstDirtyAt === null) firstDirtyAt = now;
    const untilMax = maxIntervalMs - (now - firstDirtyAt);
    const delay = Math.max(0, Math.min(debounceMs, untilMax));
    timer = timers.setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  }

  function write(): Promise<void> {
    dirty = false;
    firstDirtyAt = null;
    const p = (async () => {
      try {
        const state = getState();
        await store.save(state);
      } catch (err) {
        onError(err);
        // On réessaiera au prochain déclenchement (au plus tard maxIntervalMs).
        if (!dirty) {
          dirty = true;
          if (!disposed) schedule();
        }
      } finally {
        inFlight = null;
      }
    })();
    inFlight = p;
    return p;
  }

  function flush(): Promise<void> {
    clearTimer();
    if (inFlight) {
      // Une seule écriture en file d'attente, quel que soit le nombre de demandes.
      if (!queued) {
        queued = inFlight.then(() => {
          queued = null;
          return dirty ? write() : undefined;
        });
      }
      return queued;
    }
    if (!dirty) return Promise.resolve();
    return write();
  }

  function markDirty(): void {
    if (disposed) return;
    dirty = true;
    schedule();
  }

  const onVisibility = (): void => {
    if (doc?.visibilityState === 'hidden') void flush();
  };
  const onPageHide = (): void => {
    void flush();
  };
  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', onPageHide);

  return {
    markDirty,
    flush,
    dispose() {
      disposed = true;
      clearTimer();
      doc?.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('pagehide', onPageHide);
    },
  };
}
