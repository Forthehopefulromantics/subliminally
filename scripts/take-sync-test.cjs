/* Progressive saving of recordings: one object per take, no duplicates, nothing
   lost, nothing shared ever deleted.  Run:  npm run test:take-sync */
const assert = require('node:assert/strict');
const { TakeSync, makeId, isAlreadyThere } = require('../js/take-sync.js');

const blob = (n = 1) => ({ size: n, type: 'audio/webm' });
const mkTake = (i) => ({ blob: blob(), text: 'line ' + i });
const fast = { sleep: async () => {}, backoffMs: [0] };

(async () => {
  /* ---- one object per take, named from the take's own id ---- */
  {
    const stored = new Map(); let calls = 0;
    const sync = new TakeSync({ ...fast, folder: 'user-1/takes', extFor: () => 'webm', upload: async (path, b) => { calls++; stored.set(path, b); return { error: null }; } });
    const t = mkTake(1);
    assert.equal(await sync.enqueue(t), true);
    assert.equal(t.path, `user-1/takes/${t.id}.webm`, 'path = the person\'s folder + the take id');
    assert.ok(t.path.startsWith('user-1/'), 'always inside the signed-in person\'s own folder');
    assert.equal(calls, 1);
    assert.equal(await sync.enqueue(t), true); assert.equal(calls, 1, 'a take that is already uploaded is never uploaded again');
    assert.equal(sync.state(t), 'synced');
  }

  /* ---- asking twice while it is uploading joins the same upload ---- */
  {
    let calls = 0, release;
    const gate = new Promise(r => { release = r; });
    const sync = new TakeSync({ ...fast, folder: 'u/takes', upload: async () => { calls++; await gate; return { error: null }; } });
    const t = mkTake(1);
    const a = sync.enqueue(t), b = sync.enqueue(t), c = sync.enqueue(t);
    assert.equal(a, b); assert.equal(b, c, 'the same promise');
    assert.equal(sync.state(t), 'syncing'); assert.equal(sync.pendingCount(), 1);
    release(); await Promise.all([a, b, c]);
    assert.equal(calls, 1, 'a frantic triple Save is one upload'); assert.equal(sync.pendingCount(), 0);
  }

  /* ---- a hundred takes: never more than `concurrency` at once, every one stored exactly once ---- */
  {
    const stored = new Map(); let live = 0, peak = 0;
    const sync = new TakeSync({ ...fast, folder: 'u/takes', concurrency: 3, upload: async (path, b) => {
      live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 1)); live--; stored.set(path, b); return { error: null }; } });
    const takes = Array.from({ length: 100 }, (_, i) => mkTake(i));
    await Promise.all(takes.map(t => sync.enqueue(t)));
    assert.equal(stored.size, 100, '100 distinct objects'); assert.equal(sync.uploads, 100);
    assert.ok(peak <= 3, 'at most 3 in flight (saw ' + peak + ')');
    assert.equal(new Set(takes.map(t => t.path)).size, 100, 'no two takes share a path');
    await sync.idle(); assert.equal(sync.pendingCount(), 0);
  }

  /* ---- a failure is retried, then reported -- and never stops anything else ---- */
  {
    const fails = new Map(); const stored = new Set();
    const sync = new TakeSync({ ...fast, folder: 'u/takes', retries: 2, upload: async (path) => {
      const n = (fails.get(path) || 0); if (path.includes('bad') ) { fails.set(path, n + 1); return { error: { message: 'network lost' } }; }
      stored.add(path); return { error: null }; } });
    const good = mkTake(1), bad = mkTake(2); bad.id = 'bad-take';
    const [g, b] = await Promise.all([sync.enqueue(good), sync.enqueue(bad)]);
    assert.equal(g, true); assert.equal(b, false);
    assert.equal(fails.get('u/takes/bad-take.webm'), 3, 'tried 1 + 2 retries');
    assert.equal(sync.state(bad), 'failed'); assert.match(bad.syncError, /network lost/);
    assert.ok(bad.blob, 'the failed take is still there, audio intact');
    assert.equal(sync.failedCount([good, bad]), 1);
    // the connection comes back
    bad.id = 'bad-take'; const orig = sync.uploadFn; sync.uploadFn = async (path) => { stored.add(path); return { error: null }; };
    await sync.retryAll([good, bad]);
    assert.equal(bad.path, 'u/takes/bad-take.webm'); assert.equal(sync.state(bad), 'synced'); assert.equal(sync.failedCount([good, bad]), 0);
  }

  /* ---- a lost response is not a duplicate: "already exists" is success ---- */
  {
    let n = 0; const stored = new Set();
    const sync = new TakeSync({ ...fast, folder: 'u/takes', retries: 3, upload: async (path) => {
      n++;
      if (n === 1) { stored.add(path); throw new Error('response lost'); }           // arrived, but we never heard
      if (stored.has(path)) return { error: { message: 'The resource already exists', statusCode: '409' } };
      stored.add(path); return { error: null }; } });
    const t = mkTake(1);
    assert.equal(await sync.enqueue(t), true, 'treated as saved');
    assert.equal(stored.size, 1, 'exactly one object, not two');
    assert.ok(isAlreadyThere({ message: 'Duplicate' })); assert.ok(isAlreadyThere({ statusCode: 409 })); assert.ok(!isAlreadyThere({ message: 'network' })); assert.ok(!isAlreadyThere(null));
  }

  /* ---- signed out: stays on the device, nothing thrown, nothing sent ---- */
  {
    let calls = 0;
    const sync = new TakeSync({ ...fast, folder: null, upload: async () => { calls++; return { error: null }; } });
    const t = mkTake(1);
    assert.equal(await sync.enqueue(t), false); assert.equal(calls, 0); assert.ok(t.blob && !t.path); assert.equal(sync.state(t), 'local');
    sync.setFolder('u/takes'); assert.equal(await sync.enqueue(t), true, 'goes up once signed in');
    assert.equal(await sync.enqueue({ blob: null }), false, 'a line with no recording is not an upload');
    assert.equal(await sync.enqueue(null), false);
  }

  /* ---- replacing / deleting: only uploads that never became part of a saved subliminal go ---- */
  {
    const removed = [];
    const sync = new TakeSync({ ...fast, folder: 'u/takes', upload: async () => ({ error: null }), remove: async (paths) => { removed.push(...paths); } });
    const draftTake = mkTake(1); await sync.enqueue(draftTake); const draftPath = draftTake.path;
    await sync.discard(draftTake);
    assert.deepEqual(removed, [draftPath], 'an uncommitted upload is removed with its take'); assert.equal(draftTake.path, null);
    const saved = mkTake(2); saved.path = 'u/123/2.webm'; saved.committed = true;
    await sync.discard(saved);
    assert.deepEqual(removed, [draftPath], 'a file that belongs to a saved subliminal is NEVER removed');
    assert.equal(saved.path, 'u/123/2.webm');
    assert.deepEqual(sync.uncommittedPaths([saved, mkTake(3), (() => { const t = mkTake(4); t.path = 'u/takes/x.webm'; return t; })()]), ['u/takes/x.webm']);
    // discarded while still uploading: the late file is cleaned up, not orphaned
    let release; const gate = new Promise(r => { release = r; });
    const slow = new TakeSync({ ...fast, folder: 'u/takes', upload: async () => { await gate; return { error: null }; }, remove: async (p) => { removed.push(...p); } });
    const t = mkTake(5); const up = slow.enqueue(t); const gone = slow.discard(t); release(); await up; await gone;
    assert.ok(removed.includes(`u/takes/${t.id}.webm`), 'a late upload of a discarded take is removed');
  }

  /* ---- ids ---- */
  { const ids = new Set(Array.from({ length: 500 }, () => makeId())); assert.equal(ids.size, 500, 'ids do not collide'); }

  console.log('PASS: one object per take, joined duplicate uploads, 100 takes through a pool of 3, retry + failure isolation, lost-response safety, signed-out stays local, only uncommitted uploads are ever removed');
})().catch(e => { console.error(e); process.exit(1); });
