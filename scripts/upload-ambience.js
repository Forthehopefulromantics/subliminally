#!/usr/bin/env node
/* upload-ambience.js — put the ambience library into Supabase Storage
 *
 * Part of Subliminally. Run once after 20261004_ambience_library.sql, and
 * again whenever a master in audio/ambience/ changes.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/upload-ambience.js
 *
 * What it does, per track in js/ambience.js:
 *
 *   1. uploads audio/ambience/<file> to the public `ambience` bucket
 *   2. writes the public URL back onto that track's ambience_tracks row
 *
 * The service role key never leaves the machine this runs on. It is not the
 * anon key the site ships with and must not be put in the browser: the whole
 * reason the bucket has no insert policy is so that nothing signed into the
 * app can add audio to a library everybody hears.
 *
 * SAFE TO RE-RUN. Uploads are upserts and the row update is by key, so running
 * it twice does what running it once did.
 *
 * NOT running it is also safe. Until the rows carry a url, and if this table is
 * ever unreachable, the site plays the copies bundled at audio/ambience/ —
 * ambience_tracks is an override, not a dependency. See ambienceUrl() in
 * js/ambience.js.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'ambience';
const ROOT = path.resolve(__dirname, '..');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.');
  process.exit(1);
}

/* The catalogue is read out of js/ambience.js rather than repeated here, so
   the keys and filenames cannot drift apart from what the site actually asks
   for. The file is a plain script meant for a browser, so it is run in a
   sandbox with just enough of a window for it to finish. */
function loadCatalogue() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'ambience.js'), 'utf8');
  const sandbox = { window: {}, console, fetch: () => {}, Map, Set, Math, Float32Array };
  sandbox.window.AMBIENCE_URLS = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'js/ambience.js' });
  return sandbox.window.AMBIENCE_TRACKS;
}

const headers = (extra) => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  ...(extra || {}),
});

async function uploadOne(track) {
  const local = path.join(ROOT, 'audio', 'ambience', track.file);
  if (!fs.existsSync(local)) throw new Error(`missing master: audio/ambience/${track.file}`);
  const bytes = fs.readFileSync(local);
  const storagePath = track.file;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'audio/mpeg',
      // These never change once published, so they are worth caching hard.
      // A new master gets a new upload and a purge, not a shorter max-age.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true',
    }),
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload failed (${res.status}): ${await res.text().catch(() => '')}`);

  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/ambience_tracks?key=eq.${encodeURIComponent(track.key)}`,
    {
      method: 'PATCH',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ storage_path: storagePath, url, updated_at: new Date().toISOString() }),
    },
  );
  if (!patch.ok) throw new Error(`row update failed (${patch.status}): ${await patch.text().catch(() => '')}`);

  return { url, bytes: bytes.length };
}

(async () => {
  const tracks = loadCatalogue();
  if (!tracks || !tracks.length) {
    console.error('no tracks found in js/ambience.js');
    process.exit(1);
  }
  let failed = 0;
  for (const track of tracks) {
    try {
      const { url, bytes } = await uploadOne(track);
      console.log(`${track.key.padEnd(16)} ${(bytes / 1024).toFixed(0).padStart(4)} KB  ${url}`);
    } catch (e) {
      failed++;
      console.error(`${track.key.padEnd(16)} FAILED — ${e.message}`);
    }
  }
  console.log(failed ? `\n${failed} of ${tracks.length} did not upload.` : `\nall ${tracks.length} tracks are live.`);
  process.exit(failed ? 1 : 0);
})();
