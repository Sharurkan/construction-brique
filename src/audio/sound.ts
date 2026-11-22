/**
 * Sons du jeu via la Web Audio API.
 *
 * - Les fichiers ne sont téléchargés et décodés qu'après `unlock()` (geste utilisateur) :
 *   rien n'est chargé au démarrage, et l'AudioContext n'est créé qu'à ce moment-là.
 * - Une URL manquante, un fichier introuvable ou un décodage raté = silence, jamais d'erreur.
 * - Préférence son on/off mémorisée en localStorage (dans try/catch : mode privé, quota…).
 */
import type { BlockId, SoundName, SoundPlayer } from '../core/types';
import { SOUND_GROUPS, pickVariant, pitchVariation, soundGroupFor, type SoundGroup } from './mapping';

export type SoundSources = Partial<Record<string, string[]>>;

export interface WebAudioSoundPlayerOptions {
  /** Volume global (0..1). Défaut 0.6 : doux. */
  volume?: number;
  /** Clé localStorage de la préférence on/off. */
  storageKey?: string;
  /** Fabrique d'AudioContext injectable (tests). Défaut : window.AudioContext. */
  createContext?: () => AudioContext | null;
  /** Téléchargement injectable (tests). Défaut : fetch → arrayBuffer. */
  fetchBuffer?: (url: string) => Promise<ArrayBuffer>;
  rand?: () => number;
  /** Délai minimal avant de retenter un groupe dont aucun fichier n'a pu être chargé (ms). Défaut 10 s. */
  retryDelayMs?: number;
  /** Horloge injectable (tests). Défaut : performance.now / Date.now. */
  now?: () => number;
}

const DEFAULT_STORAGE_KEY = 'construction-brique:sound';

function defaultContext(): AudioContext | null {
  try {
    const w = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

function readPref(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function writePref(key: string, on: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, on ? 'on' : 'off');
  } catch {
    /* stockage indisponible : la préférence ne sera pas retenue */
  }
}

export class WebAudioSoundPlayer implements SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly sources: SoundSources;
  /** Buffers décodés par groupe (les variantes ratées sont simplement absentes). */
  private readonly buffers = new Map<string, AudioBuffer[]>();
  private readonly loading = new Map<string, Promise<void>>();
  /** Groupe en échec → instant à partir duquel on peut retenter. */
  private readonly retryAt = new Map<string, number>();
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly volume: number;
  private readonly storageKey: string;
  private readonly createContext: () => AudioContext | null;
  private readonly fetchBuffer: (url: string) => Promise<ArrayBuffer>;
  private readonly rand: () => number;
  private on: boolean;

  constructor(sources: SoundSources, opts: WebAudioSoundPlayerOptions = {}) {
    this.sources = sources;
    this.volume = opts.volume ?? 0.6;
    this.storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
    this.createContext = opts.createContext ?? defaultContext;
    this.fetchBuffer = opts.fetchBuffer ?? defaultFetch;
    this.rand = opts.rand ?? Math.random;
    this.retryDelayMs = opts.retryDelayMs ?? 10_000;
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.on = readPref(this.storageKey);
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Active / coupe le son et mémorise la préférence. */
  setEnabled(on: boolean): void {
    this.on = on;
    writePref(this.storageKey, on);
    if (this.master && this.ctx) {
      try {
        this.master.gain.setValueAtTime(on ? this.volume : 0, this.ctx.currentTime);
      } catch {
        /* ignore */
      }
    }
  }

  /** Vrai une fois l'AudioContext créé (après un geste utilisateur). */
  get unlocked(): boolean {
    return this.ctx !== null;
  }

  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = this.createContext();
        if (!this.ctx) return;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.on ? this.volume : 0;
        this.master.connect(this.ctx.destination);
        // Préchargement en arrière-plan de tous les groupes connus.
        for (const g of SOUND_GROUPS) void this.load(g);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch {
      /* pas d'audio : silence */
    }
  }

  play(name: SoundName, opts?: { blockId?: BlockId }): void {
    if (!this.on || !this.ctx || !this.master) return;
    try {
      const group = soundGroupFor(name, opts?.blockId);
      const list = this.buffers.get(group);
      if (!list) {
        void this.load(group); // pas encore prêt : silence cette fois-ci
        return;
      }
      if (list.length === 0) return;
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      const src = this.ctx.createBufferSource();
      src.buffer = list[pickVariant(list.length, this.rand)];
      src.playbackRate.value = pitchVariation(this.rand);
      src.connect(this.master);
      src.onended = () => src.disconnect();
      src.start();
    } catch {
      /* silence, jamais d'erreur */
    }
  }

  /**
   * Télécharge et décode les variantes d'un groupe (une seule fois si ça marche).
   * Si AUCUNE variante n'a pu être chargée (réseau, fichier absent du cache…), rien n'est
   * mémorisé : le groupe sera retenté au plus tôt `retryDelayMs` plus tard (pas de boucle).
   */
  private load(group: SoundGroup | string): Promise<void> {
    const existing = this.loading.get(group);
    if (existing) return existing;
    const retryAt = this.retryAt.get(group);
    if (retryAt !== undefined && this.now() < retryAt) return Promise.resolve();
    const ctx = this.ctx;
    const urls = (this.sources[group] ?? []).filter((u) => typeof u === 'string' && u.length > 0);
    const p = (async () => {
      if (!ctx || urls.length === 0) {
        this.buffers.set(group, []);
        return;
      }
      const decoded = await Promise.all(
        urls.map(async (url) => {
          try {
            const data = await this.fetchBuffer(url);
            return await ctx.decodeAudioData(data);
          } catch {
            return null;
          }
        }),
      );
      const ok = decoded.filter((b): b is AudioBuffer => b !== null);
      if (ok.length === 0) throw new Error(`aucun son chargé pour « ${group} »`);
      this.buffers.set(group, ok);
      this.retryAt.delete(group);
    })().catch(() => {
      // Échec : pas de liste vide définitive ; nouvel essai possible après le délai.
      this.loading.delete(group);
      this.retryAt.set(group, this.now() + this.retryDelayMs);
    });
    this.loading.set(group, p);
    return p;
  }
}
