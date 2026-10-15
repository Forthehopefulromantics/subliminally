/* An unfinished recording, kept on this device.

   Recording a hundred affirmations in your own voice takes a long while, and a
   refresh, a crash or the app being closed by the system must not cost any of
   it. Every take is written here as soon as it exists -- audio and all, in
   IndexedDB, which holds blobs where localStorage cannot -- and offered back the
   next time the builder opens.

   LAYOUT (version 2). One small "meta" record per person, and one record per
   take:

     draft:<owner>              { v:2, affirmations, takeIds:[id|null], ...settings }
     take:<owner>:<takeId>      { blob, durationMs, text, path }

   A take is written once, when it is recorded, and never again unless its
   storage path changes; the meta record (the words and the order) is the only
   thing rewritten as lines are edited or moved. The first version stored the
   whole draft -- every blob -- under one key, which meant recording line 90
   rewrote the audio of lines 1 to 89. Drafts saved that way are still read, and
   are upgraded the first time they are saved again; nothing is discarded.

   One draft per signed-in person (or per device when nobody is signed in).
   Saving the subliminal to the library, or choosing Discard, removes it. The
   audio here is also uploaded to the person's own private storage folder as it
   is recorded (see js/take-sync.js); this store is the copy that survives a
   refresh and works offline. */
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
  /* One transaction. `fn(store)` may return a request (its result is returned)
     or a function (called with the store once, after the others, to return a
     value) -- enough for "get all of these" without a transaction per take. */
  function run(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let out;
      try { out = fn(tx.objectStore(STORE)); } catch (e) { try { tx.abort(); } catch (e2) { /* already over */ } db.close(); reject(e); return; }
      tx.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : (out && out.collect ? out.collect() : undefined)); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('indexedDB transaction failed')); };
    }));
  }
  const keyFor = (owner) => 'draft:' + (owner || 'anon');
  const takeKey = (owner, id) => 'take:' + (owner || 'anon') + ':' + id;
  const takePrefix = (owner) => 'take:' + (owner || 'anon') + ':';

  const DraftStore = {
    keyFor, takeKey,

    /* The words, the order and the settings. `takeIds` says which take record
       belongs to which line. */
    saveMeta(owner, meta) {
      const record = Object.assign({}, meta, { v: 2, savedAt: Date.now() });
      return run('readwrite', store => store.put(record, keyFor(owner))).catch(() => undefined);
    },
    /* One take: { blob, durationMs, text, path? }. Resolves true when it is on disk. */
    putTake(owner, id, take) {
      const rec = { blob: take.blob, durationMs: take.durationMs || 0, text: take.text, path: take.path || null };
      return run('readwrite', store => store.put(rec, takeKey(owner, id))).then(() => true, () => false);
    },
    /* Record where a take was uploaded to, without touching its audio. */
    patchTake(owner, id, patch) {
      return run('readwrite', store => {
        const key = takeKey(owner, id);
        const req = store.get(key);
        req.onsuccess = () => { if (req.result) store.put(Object.assign({}, req.result, patch), key); };
        return req;
      }).then(() => true, () => false);
    },
    deleteTake(owner, id) {
      return run('readwrite', store => store.delete(takeKey(owner, id))).catch(() => undefined);
    },

    /* The first version's whole-draft save. Kept so an older caller (and the
       tests that cover the migration) still work. */
    save(owner, draft) {
      const record = Object.assign({}, draft, { v: 1, savedAt: Date.now() });
      return run('readwrite', store => store.put(record, keyFor(owner))).catch(() => undefined);
    },

    /* The draft in the shape the builder uses, whichever version wrote it:
       { affirmations:[], takes:[{blob,durationMs,text,path,id}|null], ...settings }. */
    load(owner) {
      return run('readonly', store => {
        const state = { meta: null, takes: new Map() };
        const req = store.get(keyFor(owner));
        req.onsuccess = () => {
          state.meta = req.result || null;
          const ids = state.meta && state.meta.v === 2 && Array.isArray(state.meta.takeIds) ? state.meta.takeIds : [];
          ids.forEach(id => {
            if (!id) return;
            const r = store.get(takeKey(owner, id));
            r.onsuccess = () => { if (r.result) state.takes.set(id, r.result); };
          });
        };
        return {
          collect() {
            const m = state.meta;
            if (!m) return null;
            if (m.v !== 2) return m;                       // a version-1 draft: audio already inline
            const ids = Array.isArray(m.takeIds) ? m.takeIds : [];
            const out = Object.assign({}, m);
            out.takes = (m.affirmations || []).map((_, i) => {
              const id = ids[i];
              const t = id && state.takes.get(id);
              return t && t.blob ? { id, blob: t.blob, durationMs: t.durationMs || 0, text: t.text, path: t.path || null } : null;
            });
            return out;
          },
        };
      }).catch(() => null).then(d => d || null);
    },

    /* Every storage path this draft has uploaded (for removing them on Discard). */
    paths(draft) {
      return ((draft && draft.takes) || []).filter(t => t && t.path).map(t => t.path);
    },

    clear(owner) {
      return run('readwrite', store => {
        store.delete(keyFor(owner));
        if (typeof IDBKeyRange !== 'undefined') {
          const prefix = takePrefix(owner);
          store.delete(IDBKeyRange.bound(prefix, prefix + '￿'));
        }
        return { collect() { return undefined; } };
      }).catch(() => undefined);
    },
  };
  root.DraftStore = DraftStore;
  if (typeof module !== 'undefined' && module.exports) module.exports = DraftStore;
})(typeof window !== 'undefined' ? window : globalThis);
