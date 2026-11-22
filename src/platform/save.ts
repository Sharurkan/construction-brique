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

// ---------- IndexedDB ----------

export interface IndexedDbSaveStoreOptions {
  dbName?: string;
  storeName?: string;
  key?: string;
  /** Pour les tests ; par défaut `globalThis.indexedDB`. */
  factory?: IDBFactory;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB : erreur de requête'));
  });
}

export class IndexedDbSaveStore implements SaveStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly key: string;
  private readonly factory: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(opts: IndexedDbSaveStoreOptions = {}) {
    this.dbName = opts.dbName ?? 'construction-brique';
    this.storeName = opts.storeName ?? 'worlds';
    this.key = opts.key ?? 'current';
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

  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const req = fn(tx.objectStore(this.storeName));
      let result: T;
      reqToPromise(req).then((r) => (result = r), reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB : transaction en erreur'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB : transaction annulée'));
    });
  }

  async load(): Promise<SavedWorld | null> {
    try {
      const raw = await this.tx('readonly', (s) => s.get(this.key));
      return validateSavedWorld(raw);
    } catch {
      return null;
    }
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

export class LocalStorageSaveStore implements SaveStore {
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
    const stored: StoredLocalWorld = {
      ...world,
      encoding: 'rle-base64',
      blocks: bytesToBase64(rleEncode(world.blocks)),
    };
    // Peut lever QuotaExceededError : propagée à l'appelant (l'autosave la journalise).
    this.storage.setItem(this.key, JSON.stringify(stored));
  }

  async clear(): Promise<void> {
    this.storage.removeItem(this.key);
  }
}

// ---------- Mémoire (dernier recours, non persistant) ----------

export class MemorySaveStore implements SaveStore {
  private data: SavedWorld | null = null;
  async load(): Promise<SavedWorld | null> {
    return this.data ? { ...this.data, blocks: this.data.blocks.slice() } : null;
  }
  async save(world: SavedWorld): Promise<void> {
    this.data = { ...world, blocks: world.blocks.slice() };
  }
  async clear(): Promise<void> {
    this.data = null;
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

/**
 * IndexedDB si la base s'ouvre, sinon localStorage (RLE + base64), sinon mémoire.
 * Ne rejette jamais.
 */
export async function createSaveStore(): Promise<SaveStore> {
  try {
    const idb = new IndexedDbSaveStore();
    await idb.open();
    lastSaveBackend = 'indexeddb';
    return idb;
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
