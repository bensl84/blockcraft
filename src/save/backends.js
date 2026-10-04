// OWNER LANE: FEATURE-MENUS (save). Storage backends behind game.save (SPEC §8.4.3).
//
// IndexedDB 'blockcraft' version 1:
//   store 'worlds'  keyPath 'id'   WorldMeta (+ backup copies: id '<world>~b0..2' / '<world>~d', field backupOf)
//   store 'columns' keyPath 'key'  {key: `${worldId}:${cx}:${cz}`, worldId, cx, cz, v: 1, data: Uint8Array, blockEntities, savedAt}
//                   index 'worldId'
// Both backends share one small async API so the save system (and the unit tests) do not care which one runs:
//   open() -> Promise<bool>
//   write({metas, columns, deleteMetaIds, deleteColumnKeys}) -> Promise   ONE readwrite transaction; every request
//                                                                          is issued synchronously inside the call
//   getMeta(id) ; getAllMetas() ; getColumns(worldId) ; getColumnKeys(worldId) ; close()

export const DB_NAME = 'blockcraft';
export const DB_VERSION = 1;

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** IndexedDB backend. `idb` defaults to the global indexedDB. */
export function createIdbBackend(idb = typeof indexedDB !== 'undefined' ? indexedDB : null, opts = {}) {
  let db = null;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const be = {
    kind: 'idb',
    get isOpen() { return !!db; },
    open() {
      if (db) return Promise.resolve(true);
      if (!idb) return Promise.resolve(false);
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const timer = setTimeout(() => finish(false), timeoutMs);
        let r;
        try { r = idb.open(DB_NAME, DB_VERSION); } catch { clearTimeout(timer); finish(false); return; }
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('columns')) d.createObjectStore('columns', { keyPath: 'key' }).createIndex('worldId', 'worldId', { unique: false });
        };
        r.onsuccess = () => {
          clearTimeout(timer);
          if (done) { try { r.result.close(); } catch { /* ignore */ } return; }
          db = r.result;
          db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } db = null; };
          finish(true);
        };
        r.onerror = () => { clearTimeout(timer); finish(false); };
        r.onblocked = () => { /* another tab holds an old version; wait for the timeout */ };
      });
    },
    write({ metas = [], columns = [], deleteMetaIds = [], deleteColumnKeys = [] } = {}) {
      if (!db) return Promise.reject(new Error('database not open'));
      return new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(['worlds', 'columns'], 'readwrite'); } catch (err) { reject(err); return; }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('transaction error'));
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
        try {
          const ws = tx.objectStore('worlds'), cs = tx.objectStore('columns');
          for (const id of deleteMetaIds) ws.delete(id);
          for (const k of deleteColumnKeys) cs.delete(k);
          for (const m of metas) {
            try { ws.put(m); } catch (err) { if (err && err.name === 'DataCloneError') ws.put(JSON.parse(JSON.stringify(m))); else throw err; }
          }
          for (const c of columns) cs.put(c);
        } catch (err) {
          try { tx.abort(); } catch { /* ignore */ }
          reject(err);
        }
      });
    },
    getMeta(id) {
      if (!db) return Promise.resolve(null);
      return req(db.transaction('worlds').objectStore('worlds').get(id)).then((m) => m || null);
    },
    getAllMetas() {
      if (!db) return Promise.resolve([]);
      return req(db.transaction('worlds').objectStore('worlds').getAll());
    },
    getColumns(worldId) {
      if (!db) return Promise.resolve([]);
      return req(db.transaction('columns').objectStore('columns').index('worldId').getAll(worldId));
    },
    getColumnKeys(worldId) {
      if (!db) return Promise.resolve([]);
      return req(db.transaction('columns').objectStore('columns').index('worldId').getAllKeys(worldId));
    },
    close() { if (db) { try { db.close(); } catch { /* ignore */ } db = null; } },
  };
  return be;
}

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/**
 * In-memory backend: used when IndexedDB is unavailable (worlds then last for this page only) and by the unit
 * tests. `failNext(n)` makes the next n writes fail (retry tests).
 */
export function createMemoryBackend() {
  const worlds = new Map(), cols = new Map();
  let fail = 0;
  return {
    kind: 'memory',
    isOpen: true,
    worlds, cols,
    failNext(n = 1) { fail = n; },
    open() { return Promise.resolve(true); },
    write({ metas = [], columns = [], deleteMetaIds = [], deleteColumnKeys = [] } = {}) {
      if (fail > 0) { fail--; return Promise.reject(new Error('memory backend: simulated failure')); }
      // snapshot synchronously (IndexedDB clones at put time too)
      const m2 = metas.map(clone);
      const c2 = columns.map((c) => ({ ...clone({ ...c, data: null }), data: c.data ? new Uint8Array(c.data) : null }));
      return Promise.resolve().then(() => {
        for (const id of deleteMetaIds) worlds.delete(id);
        for (const k of deleteColumnKeys) cols.delete(k);
        for (const m of m2) worlds.set(m.id, m);
        for (const c of c2) cols.set(c.key, c);
      });
    },
    getMeta(id) { return Promise.resolve(worlds.has(id) ? clone(worlds.get(id)) : null); },
    getAllMetas() { return Promise.resolve([...worlds.values()].map(clone)); },
    getColumns(worldId) { return Promise.resolve([...cols.values()].filter((c) => c.worldId === worldId).map((c) => ({ ...c, data: new Uint8Array(c.data) }))); },
    getColumnKeys(worldId) { return Promise.resolve([...cols.values()].filter((c) => c.worldId === worldId).map((c) => c.key)); },
    close() {},
  };
}
