/* An unfinished recording, kept on this device.

   Recording twenty affirmations in your own voice takes a while, and a refresh,
   a crash or the app being closed by the system must not cost any of it. Every
   take is written here as soon as it exists -- audio and all, in IndexedDB,
   which holds blobs where localStorage cannot -- and offered back the next time
   the builder opens.

   One draft per signed-in person (or per device when nobody is signed in).
   Saving the subliminal to the library, or choosing Discard, removes it. Nothing
   here is sent anywhere. */
(function (root) {
  'use strict';
  const DB_NAME = 'subliminally-drafts';
  const STORE = 'drafts';
  const VERSION = 1;

  function open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB failed'));
    });
  }
  function run(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : undefined); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('indexedDB transaction failed')); };
    }));
  }
  const keyFor = (owner) => 'draft:' + (owner || 'anon');

  const DraftStore = {
    keyFor,
    /* draft: { affirmations:[], takes:[{blob,durationMs,text}|null], ...settings } */
    save(owner, draft) {
      const record = Object.assign({}, draft, { v: 1, savedAt: Date.now() });
      return run('readwrite', store => store.put(record, keyFor(owner))).catch(() => undefined);
    },
    load(owner) {
      return run('readonly', store => store.get(keyFor(owner))).catch(() => null).then(d => d || null);
    },
    clear(owner) {
      return run('readwrite', store => store.delete(keyFor(owner))).catch(() => undefined);
    },
  };
  root.DraftStore = DraftStore;
  if (typeof module !== 'undefined' && module.exports) module.exports = DraftStore;
})(typeof window !== 'undefined' ? window : globalThis);
