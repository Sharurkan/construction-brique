/**
 * Sauvegarde locale du monde : IndexedDB (préféré) avec repli localStorage, puis mémoire.
 * Aucune donnée ne quitte l'appareil.
 *
 * Toute lecture passe par `validateSavedWorld` : une sauvegarde corrompue, d'une version
 * inconnue ou de taille incohérente renvoie `null` (le jeu génère alors un nouveau monde),
 * jamais d'exception.
 */
import { SAVE_VERSION, type PlayerState, type SavedWorld, type SaveStore } from '../core/types';
import { rleDecode, rleEncode } from './rle';

// ---------- Validation / migration ----------

/**
 * Migrations : MIGRATIONS[v] transforme un objet brut de version v en version v + 1.
 * Pour passer SAVE_VERSION à 2 : ajouter `1: (raw) => ({ ...raw, version: 2, ... })`.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPositiveInt(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0 && v <= 4096;
}

function validatePlayer(p: unknown): PlayerState | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const pos = o.position as Record<string, unknown> | undefined;
  if (!pos || typeof pos !== 'object') return null;
  if (!isFiniteNumber(pos.x) || !isFiniteNumber(pos.y) || !isFiniteNumber(pos.z)) return null;
  if (!isFiniteNumber(o.yaw) || !isFiniteNumber(o.pitch)) return null;
  return { position: { x: pos.x, y: pos.y, z: pos.z }, yaw: o.yaw, pitch: o.pitch };
}

/** Valide (et migre si besoin) un objet lu depuis le stockage. Ne lève jamais. */
export function validateSavedWorld(raw: unknown): SavedWorld | null {
  try {
    if (!raw || typeof raw !== 'object') return null;
    let o = raw as Record<string, unknown>;
    if (!isFiniteNumber(o.version) || !Number.isInteger(o.version) || o.version < 1) return null;
    if (o.version > SAVE_VERSION) return null; // sauvegarde d'une version plus récente du jeu
    while ((o.version as number) < SAVE_VERSION) {
      const migrate = MIGRATIONS[o.version as number];
      if (!migrate) return null;
      o = migrate(o);
    }
    if (!isPositiveInt(o.sizeX) || !isPositiveInt(o.sizeY) || !isPositiveInt(o.sizeZ)) return null;
    let blocks = o.blocks;
    if (blocks instanceof ArrayBuffer) blocks = new Uint8Array(blocks);
    if (!(blocks instanceof Uint8Array)) return null;
    if (blocks.length !== o.sizeX * o.sizeY * o.sizeZ) return null;
    const player = validatePlayer(o.player);
    if (!player) return null;
    if (!isFiniteNumber(o.seed)) return null;
    if (!isFiniteNumber(o.selected) || !Number.isInteger(o.selected) || o.selected < 0 || o.selected > 255) return null;
    const savedAt = isFiniteNumber(o.savedAt) ? o.savedAt : 0;
    return {
      version: SAVE_VERSION,
      sizeX: o.sizeX,
      sizeY: o.sizeY,
      sizeZ: o.sizeZ,
      seed: o.seed,
      blocks,
      player,
      selected: o.selected,
      savedAt,
    };
  } catch {
    return null;
  }
}

// ---------- Monde précédent (« annuler » un nouveau monde) ----------

/**
 * Store capable de garder une copie du monde précédent (avant « nouveau monde »).
 * Restaurer = échanger courant ↔ précédent : on peut donc annuler une restauration.
 */
export interface PreviousWorldCapable {
  /** Écrit `world` dans l'emplacement « précédent » (le courant n'est pas touché). */
  savePrevious(world: SavedWorld): Promise<void>;
  /** Vrai si une copie précédente valide existe. Ne rejette jamais. */
  hasPrevious(): Promise<boolean>;
  /**
   * `current` devient le précédent et l'ancien précédent devient le courant (renvoyé).
   * Renvoie `null` sans rien modifier s'il n'y a pas de copie précédente valide.
   */
  swapWithPrevious(current: SavedWorld): Promise<SavedWorld | null>;
}

export function hasPreviousSlot(store: SaveStore): store is SaveStore & PreviousWorldCapable {
  const s = store as Partial<PreviousWorldCapable>;
  return (
    typeof s.savePrevious === 'function' &&
    typeof s.hasPrevious === 'function' &&
    typeof s.swapWithPrevious === 'function'
  );
}

// ---------- IndexedDB ----------

export interface IndexedDbSaveStoreOptions {
  dbName?: string;
  storeName?: string;
  key?: string;
  /** Clé de la copie du monde précédent (même store). Défaut `previous`. */
  previousKey?: string;
  /** Pour les tests ; par défaut `globalThis.indexedDB`. */
  factory?: IDBFactory;
}

function isInvalidStateError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'InvalidStateError';
}

export class IndexedDbSaveStore implements SaveStore, PreviousWorldCapable {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly key: string;
  private readonly previousKey: string;
  private readonly factory: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(opts: IndexedDbSaveStoreOptions = {}) {
    this.dbName = opts.dbName ?? 'construction-brique';
    this.storeName = opts.storeName ?? 'worlds';
    this.key = opts.key ?? 'current';
    this.previousKey = opts.previousKey ?? 'previous';
    const factory = opts.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) throw new Error('IndexedDB indisponible');
    this.factory = factory;
  }

  /** Ouvre (une seule fois) la base. Rejette si IndexedDB est inutilisable (ex. navigation privée). */
  open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        let req: IDBOpenDBRequest;
        try {
          req = this.factory.open(this.dbName, 1);
        } catch (e) {
          reject(e);
          return;
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName);
        };
        req.onsuccess = () => {
          const db = req.result;
          // Une autre version (onglet plus récent) veut mettre à jour la base : on libère.
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
          };
          // Fermeture imposée par le navigateur (stockage effacé, manque de mémoire…) :
          // la prochaine opération rouvrira la base.
          db.onclose = () => {
            this.dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => reject(req.error ?? new Error('IndexedDB : ouverture impossible'));
        req.onblocked = () => reject(new Error('IndexedDB : ouverture bloquée'));
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  /**
   * Exécute une transaction. `body` lance les requêtes et renvoie une fonction lue à la fin
   * (`oncomplete`) pour produire le résultat. Si la connexion a été fermée par le navigateur
   * (`InvalidStateError` à la création de la transaction), on rouvre la base et on réessaie
   * une fois.
   */
  private async run<T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => () => T,
    commitEarly = false,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const db = await this.open();
      let tx: IDBTransaction;
      try {
        tx = db.transaction(this.storeName, mode);
      } catch (e) {
        if (attempt === 0 && isInvalidStateError(e)) {
          this.forget(db);
          continue;
        }
        throw e;
      }
      return await new Promise<T>((resolve, reject) => {
        let getResult: () => T;
        try {
          getResult = body(tx.objectStore(this.storeName));
        } catch (e) {
          try {
            tx.abort();
          } catch {
            /* déjà terminée */
          }
          reject(e);
          return;
        }
        if (commitEarly) {
          // Force le commit sans attendre la fin de la tâche courante : augmente les chances que
          // l'écriture aboutisse si la page est détruite juste après (pagehide, appli tuée).
          try {
            (tx as { commit?: () => void }).commit?.();
          } catch {
            /* commit() indisponible ou transaction déjà terminée : commit automatique */
          }
        }
        tx.oncomplete = () => {
          try {
            resolve(getResult());
          } catch (e) {
            reject(e);
          }
        };
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB : transaction en erreur'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB : transaction annulée'));
      });
    }
  }

  /** Une seule requête (les écritures sont validées sans attendre). */
  private tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.run(
      mode,
      (s) => {
        const req = fn(s);
        return () => req.result;
      },
      mode === 'readwrite',
    );
  }

  /** Oublie une connexion inutilisable : la prochaine opération rouvrira la base. */
  private forget(db: IDBDatabase): void {
    this.dbPromise = null;
    try {
      db.close();
    } catch {
      /* déjà fermée */
    }
  }

  async load(): Promise<SavedWorld | null> {
    try {
      const raw = await this.tx('readonly', (s) => s.get(this.key));
      return validateSavedWorld(raw);
    } catch {
      return null;
    }
  }

  async savePrevious(world: SavedWorld): Promise<void> {
    await this.tx('readwrite', (s) => s.put(world, this.previousKey));
  }

  async hasPrevious(): Promise<boolean> {
    try {
      const raw = await this.tx('readonly', (s) => s.get(this.previousKey));
      return validateSavedWorld(raw) !== null;
    } catch {
      return false;
    }
  }

  /** Échange courant ↔ précédent dans UNE transaction (tout ou rien). */
  async swapWithPrevious(current: SavedWorld): Promise<SavedWorld | null> {
    return this.run('readwrite', (s) => {
      let restored: SavedWorld | null = null;
      const req = s.get(this.previousKey);
      req.onsuccess = () => {
        restored = validateSavedWorld(req.result);
        if (!restored) return;
        s.put(current, this.previousKey);
        s.put(restored, this.key);
      };
      return () => restored;
    });
  }

  async save(world: SavedWorld): Promise<void> {
    // Le Uint8Array est stocké tel quel (clonage structuré).
    await this.tx('readwrite', (s) => s.put(world, this.key));
  }

  async clear(): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(this.key));
  }

  /** Accès bas niveau pour les tests (écrire des données corrompues). */
  async putRaw(value: unknown): Promise<void> {
    await this.tx('readwrite', (s) => s.put(value, this.key));
  }
}

// ---------- localStorage ----------

/** Sous-ensemble de `Storage` utilisé (injectable pour les tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const B64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + B64_CHUNK)));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface StoredLocalWorld extends Omit<SavedWorld, 'blocks'> {
  encoding: 'rle-base64';
  blocks: string;
}

export class LocalStorageSaveStore implements SaveStore, PreviousWorldCapable {
  private readonly storage: KeyValueStorage;
  private readonly key: string;

  constructor(storage?: KeyValueStorage, key = 'construction-brique:current') {
    const s = storage ?? (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (!s) throw new Error('localStorage indisponible');
    this.storage = s;
    this.key = key;
  }

  async load(): Promise<SavedWorld | null> {
    try {
      const text = this.storage.getItem(this.key);
      if (!text) return null;
      const o = JSON.parse(text) as Partial<StoredLocalWorld>;
      if (!o || typeof o !== 'object' || o.encoding !== 'rle-base64' || typeof o.blocks !== 'string') return null;
      const sx = o.sizeX, sy = o.sizeY, sz = o.sizeZ;
      if (!isPositiveInt(sx) || !isPositiveInt(sy) || !isPositiveInt(sz)) return null;
      const blocks = rleDecode(base64ToBytes(o.blocks), sx * sy * sz);
      return validateSavedWorld({ ...o, blocks });
    } catch {
      return null;
    }
  }

  async save(world: SavedWorld): Promise<void> {
    // Peut lever QuotaExceededError : propagée à l'appelant (l'autosave la journalise).
    this.saveSync(world);
  }

  /** Écriture synchrone (lève en cas d'échec, ex. QuotaExceededError). */
  saveSync(world: SavedWorld): void {
    const stored: StoredLocalWorld = {
      ...world,
      encoding: 'rle-base64',
      blocks: bytesToBase64(rleEncode(world.blocks)),
    };
    this.storage.setItem(this.key, JSON.stringify(stored));
  }

  /**
   * `savedAt` de la donnée stockée sans valider les blocs : `null` si absente,
   * `NaN` si illisible. Ne lève jamais.
   */
  peekSavedAt(): number | null {
    try {
      const text = this.storage.getItem(this.key);
      if (text === null) return null;
      const o = JSON.parse(text) as { savedAt?: unknown } | null;
      return o && typeof o === 'object' && isFiniteNumber(o.savedAt) ? o.savedAt : NaN;
    } catch {
      return NaN;
    }
  }

  async clear(): Promise<void> {
    this.clearSync();
  }

  clearSync(): void {
    this.storage.removeItem(this.key);
  }

  /** Copie du monde précédent, sous la clé `<clé>:previous`. */
  private previousStore(): LocalStorageSaveStore {
    return new LocalStorageSaveStore(this.storage, `${this.key}:previous`);
  }

  async savePrevious(world: SavedWorld): Promise<void> {
    this.previousStore().saveSync(world);
  }

  async hasPrevious(): Promise<boolean> {
    return (await this.previousStore().load()) !== null;
  }

  async swapWithPrevious(current: SavedWorld): Promise<SavedWorld | null> {
    const prev = this.previousStore();
    const restored = await prev.load();
    if (!restored) return null;
    prev.saveSync(current);
    try {
      this.saveSync(restored);
    } catch (e) {
      prev.saveSync(restored); // annule la première écriture
      throw e;
    }
    return restored;
  }
}

// ---------- Sauvegarde d'urgence (synchrone, localStorage) ----------

/** Clé localStorage de la sauvegarde d'urgence écrite quand la page passe en arrière-plan. */
export const EMERGENCY_SAVE_KEY = 'construction-brique:emergency';

/** Store capable d'une écriture de secours synchrone (utilisée par l'autosave sur `pagehide`/hidden). */
export interface EmergencySaveCapable {
  /** Écrit `world` de façon synchrone. Renvoie `false` en cas d'échec (quota…). Ne lève jamais. */
  saveEmergency(world: SavedWorld): boolean;
}

export function hasEmergencySave(store: SaveStore): store is SaveStore & EmergencySaveCapable {
  return typeof (store as Partial<EmergencySaveCapable>).saveEmergency === 'function';
}

/**
 * Enveloppe un store asynchrone (IndexedDB) avec une sauvegarde d'urgence synchrone en
 * localStorage (RLE + base64).
 *
 * L'écriture IndexedDB lancée sur `pagehide` / `visibilitychange` → hidden peut ne jamais
 * aboutir si la page est détruite juste après ; l'urgence, elle, est écrite avant le retour
 * du gestionnaire d'événement.
 * - `load()` renvoie la plus récente des deux (champ `savedAt`) ; une urgence plus récente est
 *   recopiée dans le store principal en tâche de fond ;
 * - l'urgence est effacée dès qu'une écriture principale confirmée est au moins aussi récente ;
 * - urgence corrompue : ignorée (puis effacée à la prochaine écriture principale).
 */
export class EmergencyBackedSaveStore implements SaveStore, EmergencySaveCapable, PreviousWorldCapable {
  readonly primary: SaveStore;
  private readonly emergency: LocalStorageSaveStore;
  /** `false` quand on sait qu'aucune urgence n'est stockée (évite de relire localStorage). */
  private emergencyMaybePresent = true;

  constructor(primary: SaveStore, storage: KeyValueStorage, key = EMERGENCY_SAVE_KEY) {
    this.primary = primary;
    this.emergency = new LocalStorageSaveStore(storage, key);
  }

  async load(): Promise<SavedWorld | null> {
    const [main, urgent] = await Promise.all([
      this.primary.load().catch(() => null),
      this.emergency.load(),
    ]);
    if (!urgent) this.dropUnreadableEmergency();
    if (urgent && (!main || urgent.savedAt > main.savedAt)) {
      // Recopie dans le store principal (copie des blocs : l'appelant garde l'original).
      const copy: SavedWorld = { ...urgent, blocks: urgent.blocks.slice() };
      void this.primary
        .save(copy)
        .then(() => this.dropEmergencyIfNotNewerThan(copy.savedAt))
        .catch(() => {});
      return urgent;
    }
    return main;
  }

  async save(world: SavedWorld): Promise<void> {
    await this.primary.save(world);
    this.dropEmergencyIfNotNewerThan(world.savedAt);
  }

  saveEmergency(world: SavedWorld): boolean {
    try {
      this.emergency.saveSync(world);
      this.emergencyMaybePresent = true;
      return true;
    } catch {
      return false; // quota dépassé, stockage bloqué… : ignoré
    }
  }

  async clear(): Promise<void> {
    try {
      this.emergency.clearSync();
      this.emergencyMaybePresent = false;
    } catch {
      /* ignoré */
    }
    await this.primary.clear();
  }

  async savePrevious(world: SavedWorld): Promise<void> {
    if (!hasPreviousSlot(this.primary)) throw new Error('Pas d’emplacement « précédent »');
    await this.primary.savePrevious(world);
  }

  async hasPrevious(): Promise<boolean> {
    return hasPreviousSlot(this.primary) ? this.primary.hasPrevious() : false;
  }

  async swapWithPrevious(current: SavedWorld): Promise<SavedWorld | null> {
    if (!hasPreviousSlot(this.primary)) return null;
    const restored = await this.primary.swapWithPrevious(current);
    // L'urgence éventuelle concerne l'ANCIEN monde courant : elle ne doit pas écraser le
    // monde restauré au prochain chargement.
    if (restored) this.dropEmergency();
    return restored;
  }

  private dropEmergency(): void {
    try {
      this.emergency.clearSync();
      this.emergencyMaybePresent = false;
    } catch {
      /* ignoré */
    }
  }

  /** Urgence présente mais illisible (corrompue, autre version…) : effacée. */
  private dropUnreadableEmergency(): void {
    try {
      if (this.emergency.peekSavedAt() !== null) this.emergency.clearSync();
      this.emergencyMaybePresent = false;
    } catch {
      /* ignoré */
    }
  }

  private dropEmergencyIfNotNewerThan(savedAt: number): void {
    if (!this.emergencyMaybePresent) return;
    try {
      const t = this.emergency.peekSavedAt();
      if (t === null) {
        this.emergencyMaybePresent = false;
      } else if (!(t > savedAt)) {
        // Plus ancienne (ou égale, ou illisible) que l'écriture confirmée : inutile.
        this.emergency.clearSync();
        this.emergencyMaybePresent = false;
      }
    } catch {
      /* ignoré */
    }
  }
}

// ---------- Mémoire (dernier recours, non persistant) ----------

const copyWorld = (w: SavedWorld): SavedWorld => ({ ...w, blocks: w.blocks.slice() });

export class MemorySaveStore implements SaveStore, PreviousWorldCapable {
  private data: SavedWorld | null = null;
  private previous: SavedWorld | null = null;
  async load(): Promise<SavedWorld | null> {
    return this.data ? copyWorld(this.data) : null;
  }
  async save(world: SavedWorld): Promise<void> {
    this.data = copyWorld(world);
  }
  async clear(): Promise<void> {
    this.data = null;
  }
  async savePrevious(world: SavedWorld): Promise<void> {
    this.previous = copyWorld(world);
  }
  async hasPrevious(): Promise<boolean> {
    return this.previous !== null;
  }
  async swapWithPrevious(current: SavedWorld): Promise<SavedWorld | null> {
    const restored = this.previous;
    if (!restored) return null;
    this.previous = copyWorld(current);
    this.data = restored;
    return copyWorld(restored);
  }
}

// ---------- Choix automatique ----------

export type SaveBackend = 'indexeddb' | 'localstorage' | 'memory';

/** Indique quel stockage a été choisi par le dernier `createSaveStore()` (diagnostic). */
export let lastSaveBackend: SaveBackend | null = null;

function localStorageUsable(): KeyValueStorage | null {
  try {
    const s = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (!s) return null;
    const probe = '__cb_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export interface CreateSaveStoreOptions {
  /**
   * Stockage synchrone de la sauvegarde d'urgence quand IndexedDB est utilisé.
   * Défaut : `localStorage` s'il est utilisable ; `null` pour désactiver.
   */
  emergencyStorage?: KeyValueStorage | null;
  /** Pour les tests : options du store IndexedDB. */
  indexedDb?: IndexedDbSaveStoreOptions;
}

/**
 * IndexedDB si la base s'ouvre (doublé d'une sauvegarde d'urgence synchrone en localStorage
 * quand il est utilisable), sinon localStorage (RLE + base64), sinon mémoire.
 * Ne rejette jamais.
 */
export async function createSaveStore(opts: CreateSaveStoreOptions = {}): Promise<SaveStore> {
  try {
    const idb = new IndexedDbSaveStore(opts.indexedDb);
    await idb.open();
    lastSaveBackend = 'indexeddb';
    const emergency = opts.emergencyStorage !== undefined ? opts.emergencyStorage : localStorageUsable();
    return emergency ? new EmergencyBackedSaveStore(idb, emergency) : idb;
  } catch {
    /* repli */
  }
  const ls = localStorageUsable();
  if (ls) {
    lastSaveBackend = 'localstorage';
    return new LocalStorageSaveStore(ls);
  }
  lastSaveBackend = 'memory';
  return new MemorySaveStore();
}
