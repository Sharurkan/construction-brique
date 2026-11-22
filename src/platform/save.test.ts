import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z, type SavedWorld } from '../core/types';
import {
  IndexedDbSaveStore,
  LocalStorageSaveStore,
  MemorySaveStore,
  createSaveStore,
  lastSaveBackend,
  validateSavedWorld,
  type KeyValueStorage,
} from './save';

let dbCounter = 0;
function freshIdb(): IndexedDbSaveStore {
  return new IndexedDbSaveStore({ dbName: `test-db-${++dbCounter}` });
}

function makeWorld(overrides: Partial<SavedWorld> = {}): SavedWorld {
  const sx = WORLD_SIZE_X, sy = WORLD_SIZE_Y, sz = WORLD_SIZE_Z;
  const blocks = new Uint8Array(sx * sy * sz);
  for (let y = 0; y < 14; y++) blocks.fill(y === 0 ? 22 : y < 13 ? 3 : 1, y * sx * sz, (y + 1) * sx * sz);
  // Quelques blocs dispersés.
  for (let i = 0; i < 500; i++) blocks[(i * 7919) % blocks.length] = (i % 21) + 1;
  return {
    version: SAVE_VERSION,
    sizeX: sx,
    sizeY: sy,
    sizeZ: sz,
    seed: 1234,
    blocks,
    player: { position: { x: 48.5, y: 20, z: 48.5 }, yaw: 1.2, pitch: -0.3 },
    selected: 8,
    savedAt: 1_700_000_000_000,
    ...overrides,
  };
}

class FakeStorage implements KeyValueStorage {
  map = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('validateSavedWorld', () => {
  it('accepte un monde valide', () => {
    expect(validateSavedWorld(makeWorld())).not.toBeNull();
  });
  it.each([
    ['null', null],
    ['chaîne', 'abc'],
    ['version future', { ...makeWorld(), version: SAVE_VERSION + 1 }],
    ['version 0', { ...makeWorld(), version: 0 }],
    ['taille négative', { ...makeWorld(), sizeX: -1 }],
    ['blocs trop courts', { ...makeWorld(), blocks: new Uint8Array(10) }],
    ['blocs non binaires', { ...makeWorld(), blocks: [1, 2, 3] }],
    ['joueur absent', { ...makeWorld(), player: undefined }],
    ['joueur NaN', { ...makeWorld(), player: { position: { x: NaN, y: 0, z: 0 }, yaw: 0, pitch: 0 } }],
    ['selected invalide', { ...makeWorld(), selected: 'pierre' }],
  ])('rejette : %s', (_label, raw) => {
    expect(validateSavedWorld(raw)).toBeNull();
  });
});

describe('IndexedDbSaveStore', () => {
  it('load sur base vide → null', async () => {
    expect(await freshIdb().load()).toBeNull();
  });

  it('save → load identique', async () => {
    const store = freshIdb();
    const w = makeWorld();
    await store.save(w);
    const back = await store.load();
    expect(back).not.toBeNull();
    expect(back!.blocks).toBeInstanceOf(Uint8Array);
    expect(back!.blocks).toEqual(w.blocks);
    expect(back).toEqual(w);
  });

  it('persiste entre deux instances (même base)', async () => {
    const name = `test-db-${++dbCounter}`;
    await new IndexedDbSaveStore({ dbName: name }).save(makeWorld({ seed: 99 }));
    const back = await new IndexedDbSaveStore({ dbName: name }).load();
    expect(back?.seed).toBe(99);
  });

  it('écrase la sauvegarde précédente', async () => {
    const store = freshIdb();
    await store.save(makeWorld({ seed: 1 }));
    await store.save(makeWorld({ seed: 2 }));
    expect((await store.load())?.seed).toBe(2);
  });

  it('clear', async () => {
    const store = freshIdb();
    await store.save(makeWorld());
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('données corrompues → null', async () => {
    const store = freshIdb();
    for (const junk of ['n importe quoi', 42, { version: 1 }, { ...makeWorld(), blocks: new Uint8Array(3) }]) {
      await store.putRaw(junk);
      expect(await store.load()).toBeNull();
    }
  });
});

describe('LocalStorageSaveStore', () => {
  it('save → load identique, et compression efficace', async () => {
    const storage = new FakeStorage();
    const store = new LocalStorageSaveStore(storage);
    const w = makeWorld();
    await store.save(w);
    const text = [...storage.map.values()][0];
    expect(text.length).toBeLessThan(w.blocks.length / 10);
    expect(await store.load()).toEqual(w);
  });

  it('clear et base vide → null', async () => {
    const store = new LocalStorageSaveStore(new FakeStorage());
    expect(await store.load()).toBeNull();
    await store.save(makeWorld());
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('données corrompues → null', async () => {
    const storage = new FakeStorage();
    const store = new LocalStorageSaveStore(storage, 'k');
    const good = new FakeStorage();
    await new LocalStorageSaveStore(good, 'k').save(makeWorld());
    const goodObj = JSON.parse(good.getItem('k')!);
    const cases = [
      '{pas du json',
      'null',
      JSON.stringify({ ...goodObj, encoding: 'autre' }),
      JSON.stringify({ ...goodObj, blocks: '!!!pas-base64!!!' }),
      JSON.stringify({ ...goodObj, blocks: goodObj.blocks.slice(0, 8) }),
      JSON.stringify({ ...goodObj, sizeY: 47 }),
      JSON.stringify({ ...goodObj, version: 999 }),
    ];
    for (const c of cases) {
      storage.map.set('k', c);
      expect(await store.load()).toBeNull();
    }
  });

  it('quota dépassé → save rejette, ancienne sauvegarde intacte', async () => {
    const storage = new FakeStorage();
    const store = new LocalStorageSaveStore(storage);
    await store.save(makeWorld({ seed: 1 }));
    storage.quota = 10;
    await expect(store.save(makeWorld({ seed: 2 }))).rejects.toThrow();
    expect((await store.load())?.seed).toBe(1);
  });
});

describe('MemorySaveStore', () => {
  it('save → load → clear', async () => {
    const s = new MemorySaveStore();
    await s.save(makeWorld());
    expect(await s.load()).toEqual(makeWorld());
    await s.clear();
    expect(await s.load()).toBeNull();
  });
});

describe('createSaveStore', () => {
  it('choisit IndexedDB quand disponible', async () => {
    const store = await createSaveStore();
    expect(store).toBeInstanceOf(IndexedDbSaveStore);
    expect(lastSaveBackend).toBe('indexeddb');
  });
});
