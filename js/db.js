// Tiny IndexedDB wrapper. All data (sessions + uploaded documents) lives on-device.
const DB_NAME = 'session-tracker';
const DB_VERSION = 1;

const STORES = {
  programs: 'programs',     // therapy plans/cycles
  sessions: 'sessions',     // individual sessions (documents embedded as blobs)
  checks: 'checks',         // daily CTA completion log, keyed by `${date}|${itemId}`
  kv: 'kv',                 // misc key/value (custom CTAs, custom resources)
};

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.programs)) {
        db.createObjectStore(STORES.programs, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.sessions)) {
        const s = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        s.createIndex('programId', 'programId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.checks)) {
        db.createObjectStore(STORES.checks, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.kv)) {
        db.createObjectStore(STORES.kv, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return open().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async getAll(store) {
    return reqToPromise((await tx(store)).getAll());
  },
  async get(store, key) {
    return reqToPromise((await tx(store)).get(key));
  },
  async put(store, value) {
    await reqToPromise((await tx(store, 'readwrite')).put(value));
    return value;
  },
  async delete(store, key) {
    return reqToPromise((await tx(store, 'readwrite')).delete(key));
  },
  async byIndex(store, indexName, value) {
    const os = await tx(store);
    return reqToPromise(os.index(indexName).getAll(value));
  },
};

export const STORE = STORES;

// Short unique-ish id without external deps.
export function uid() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}
