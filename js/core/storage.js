/* PenPlot Studio - persistence (IndexedDB key/value with localStorage fallback). */
(function (PP) {
  'use strict';

  const DB_NAME = 'penplot-studio';
  const STORE = 'kv';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const req = fn(store);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const LS_PREFIX = 'pp.kv.';

  PP.Storage = {
    async get(key) {
      try { return await tx('readonly', s => s.get(key)); }
      catch (e) {
        try { const v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : undefined; } catch (e2) { return undefined; }
      }
    },
    async set(key, value) {
      try { await tx('readwrite', s => s.put(value, key)); }
      catch (e) {
        try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch (e2) { console.warn('Storage full', e2); }
      }
    },
    async del(key) {
      try { await tx('readwrite', s => s.delete(key)); }
      catch (e) { try { localStorage.removeItem(LS_PREFIX + key); } catch (e2) { /* ignore */ } }
    },
    // Small synchronous settings (profiles, UI prefs)
    getLocal(key, def) {
      try { const v = localStorage.getItem('pp.' + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    setLocal(key, value) {
      try { localStorage.setItem('pp.' + key, JSON.stringify(value)); } catch (e) { console.warn(e); }
    },
  };
})(window.PP = window.PP || {});
