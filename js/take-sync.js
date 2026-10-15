/* Saving recordings as they are made.

   A subliminal recorded in your own voice can be a hundred separate audio files.
   Uploading them all in one burst when "Save" is pressed is how recordings get
   lost: one dropped connection in the middle of line 63 and the whole session is
   in question. So each take is sent to the person's private storage the moment
   it exists, while they get on with the next line, and Save only has to write
   the list of paths.

   THE RULES THIS ENFORCES
     one object per take   The storage path is made from the take's own id, so
                           the same take can only ever be one file. A retry after
                           a lost response lands on the same path; the storage
                           answer "already exists" is therefore success, not an
                           error, and cannot leave a duplicate behind.
     one upload at a time  Asking for a take that is already uploading (or
                           already uploaded) returns that same upload. Pressing
                           Save while the queue is still working waits on it.
     nothing blocks        A failed upload never stops recording, never discards
                           the take (it stays in memory and in the device draft)
                           and never fails the others. It is retried with a
                           back-off, again when the connection returns, and once
                           more at Save.
     nothing shared is     A take that belongs to a saved subliminal is
     ever deleted          `committed`; only uploads that never made it into a
                           saved subliminal are removed, and only when the take
                           they belonged to is re-recorded or the draft is
                           discarded.
     few at a time         A small pool of uploads, so a hundred takes on a phone
                           connection do not all compete for the same bandwidth,
                           and only the take being sent is read into memory by
                           the network stack at any moment.

   The storage client is passed in, which is also how the tests drive it. */
(function (root) {
  'use strict';

  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* Storage's way of saying this path is already there. It means a previous
     attempt of ours got through, so it is the outcome we wanted. */
  function isAlreadyThere(err) {
    if (!err) return false;
    const text = String(err.message || err.error || '') + ' ' + String(err.statusCode || err.status || '');
    return /already exists|duplicate|\b409\b/i.test(text);
  }

  class TakeSync {
    /* opts:
         upload(path, blob, contentType) -> Promise<{error}|void>   (supabase storage .upload shape)
         remove(paths)                   -> Promise<any>
         folder                          the person's own folder, "<userId>/takes"
         extFor(mime)                    file extension for a recording
         concurrency, retries, backoffMs, sleep (for tests)
         onChange(take)                  a take's sync state moved                        */
    constructor(opts) {
      const o = opts || {};
      this.uploadFn = o.upload;
      this.removeFn = o.remove || (() => Promise.resolve());
      this.folder = o.folder;
      this.extFor = o.extFor || (() => 'webm');
      this.concurrency = Math.max(1, o.concurrency || 3);
      this.retries = o.retries == null ? 3 : o.retries;
      this.backoffMs = o.backoffMs || [700, 2000, 5000];
      this.sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
      this.onChange = o.onChange || (() => {});
      this.active = 0;
      this.queue = [];
      this.inFlight = new Set();
      this.uploads = 0;           // objects actually written (tests assert on this)
    }
    setFolder(folder) { this.folder = folder; }

    /* A take gets its id when it is made, not when it is uploaded. */
    static ensureId(take) { if (take && !take.id) take.id = makeId(); return take && take.id; }
    pathFor(take) {
      TakeSync.ensureId(take);
      const mime = (take.blob && take.blob.type) || 'audio/webm';
      return `${this.folder}/${take.id}.${this.extFor(mime)}`;
    }
    state(take) { return !take ? 'none' : take.path ? 'synced' : take.syncError ? 'failed' : take._sync ? 'syncing' : 'local'; }
    _set(take) { try { this.onChange(take); } catch (e) { /* a listener must not stop an upload */ } }

    /* Start (or join) the upload of one take. Always resolves -- true when the
       take is in storage, false when it is not (yet) -- and never throws. */
    enqueue(take) {
      if (!take || !take.blob) return Promise.resolve(false);
      if (take.path) return Promise.resolve(true);
      if (!this.folder || !this.uploadFn) return Promise.resolve(false);   // signed out: stays on the device
      if (take._sync) return take._sync;
      TakeSync.ensureId(take);
      take.syncError = null;
      const promise = new Promise(resolve => {
        this.queue.push({ take, resolve });
        this._pump();
      }).then(ok => { if (take._sync === promise) take._sync = null; this._set(take); return ok; });
      take._sync = promise;
      this.inFlight.add(promise);
      promise.then(() => this.inFlight.delete(promise));
      this._set(take);
      return promise;
    }
    _pump() {
      while (this.active < this.concurrency && this.queue.length) {
        const job = this.queue.shift();
        this.active++;
        this._send(job.take).then(ok => { this.active--; job.resolve(ok); this._pump(); });
      }
    }
    async _send(take) {
      const path = this.pathFor(take);
      const mime = (take.blob && take.blob.type) || 'audio/webm';
      for (let attempt = 0; ; attempt++) {
        let error = null;
        try {
          const res = await this.uploadFn(path, take.blob, mime);
          error = res && res.error ? res.error : null;
        } catch (e) { error = e || new Error('upload failed'); }
        if (!error || isAlreadyThere(error)) {
          if (!error) this.uploads++;
          take.path = path; take.syncError = null;
          return true;
        }
        if (attempt >= this.retries) {
          take.syncError = String(error.message || error);
          return false;
        }
        await this.sleep(this.backoffMs[Math.min(attempt, this.backoffMs.length - 1)]);
      }
    }

    /* Everything not yet in storage, tried again. Used when the connection comes
       back and when the person signs in. */
    retryAll(takes) {
      return Promise.all((takes || []).map(t => (t && t.blob && !t.path ? this.enqueue(t) : Promise.resolve(true))));
    }
    /* Resolves when nothing is uploading or waiting. */
    async idle() { while (this.inFlight.size) await Promise.all([...this.inFlight]); }
    pendingCount() { return this.inFlight.size; }
    failedCount(takes) { return (takes || []).filter(t => t && t.blob && !t.path && t.syncError && !t._sync).length; }

    /* A take that has been replaced or deleted. Its uploaded object goes with it
       -- unless a saved subliminal points at it, which is never touched. */
    discard(take) {
      if (!take) return Promise.resolve();
      // Still on its way up: let it land, then take it down again, so a late
      // upload cannot leave a file nobody knows about.
      if (take._sync) return take._sync.then(() => this.discard(take));
      if (take.path && !take.committed) {
        const path = take.path;
        take.path = null;
        return Promise.resolve().then(() => this.removeFn([path])).catch(() => undefined);
      }
      return Promise.resolve();
    }
    /* The paths of uploaded takes that never became part of a saved subliminal. */
    uncommittedPaths(takes) {
      return (takes || []).filter(t => t && t.path && !t.committed).map(t => t.path);
    }
  }

  const api = { TakeSync, makeId, isAlreadyThere };
  root.TakeSyncKit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
