// Where generated speech is kept, and what stops it being generated twice.
//
// A line of affirmation read in one voice at one pace always sounds the same, so
// it is worth generating exactly once. The first request pays for it; every
// request after that — the next loop, tomorrow night, the same subliminal opened
// on a phone instead of a laptop — reads the mp3 back out of Supabase Storage.
//
// Three pieces:
//   tts_clips        one row per piece of audio that exists, with where it lives
//   tts_generations  the ledger: who asked for what, how many characters, when
//   the rate limits   read off that ledger, so they survive a cold start
//
// Both tables are written with the service role and read under RLS, so a person
// can see their own usage and nobody else's.

import { createHash } from 'node:crypto';
import { serviceHeaders } from './supabase-auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const BUCKET = 'tts-cache';

// A session can run for eight hours, but the browser decodes each clip once at
// the start and loops the decoded audio, so this only has to outlive the fetch.
// A generous window means a subliminal left open all evening still starts.
const SIGNED_URL_SECONDS = 60 * 60 * 12;

/* How many lines one request may ask for. Twenty is the most affirmations the
   builder allows, and the EFT round is eleven, so this is the whole sequence
   with room to spare — and a ceiling on what a single call can cost. */
export const MAX_LINES_PER_REQUEST = 25;
/* A line of affirmation is short. This is generous and still stops the route
   being used as general-purpose text-to-speech. */
export const MAX_CHARS_PER_LINE = 400;

/* Read off the ledger, per person. Generating a whole twenty-line subliminal is
   twenty rows, so an hour's allowance is several sessions' worth of building and
   rebuilding — and nowhere near enough to run up a bill by holding down Generate.
   Cache hits are not counted: replaying what already exists is free. */
const LIMITS = [
  { seconds: 60,        max: 40,  code: 'too_fast' },
  { seconds: 60 * 60,   max: 150, code: 'hourly_limit' },
  { seconds: 60 * 60 * 24, max: 600, code: 'daily_limit' },
];

export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/* The words as the provider will read them. Trailing spaces and a double space
   in the middle change nothing about how a line sounds, so they must not count
   as a different line — otherwise an invisible edit costs another generation. */
export function normalizeLine(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/* Two hashes on purpose. `textHash` identifies the words alone, which is what the
   ledger records and what a person could reasonably be shown. `clipKey` is what
   identifies one piece of *audio*: the same words read by a different voice, or
   at a different pace, or by a newer model, is a different file. */
export function hashesFor({ text, providerVoiceId, speed, modelId }) {
  const line = normalizeLine(text);
  const textHash = sha256Hex(line);
  const clipKey = sha256Hex([providerVoiceId, modelId, Number(speed).toFixed(2), line].join('\u0000'));
  return { line, textHash, clipKey };
}

export function storagePathFor(userId, clipKey) {
  return `${userId}/${clipKey}.mp3`;
}

async function rest(path, init) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, init);
}

/* ---------------- the clip table ---------------- */

/* Everything already generated for this person out of the keys we are about to
   ask for, in one query rather than one per line. */
export async function findCachedClips(userId, clipKeys) {
  if (!clipKeys.length) return new Map();
  const list = clipKeys.map((k) => `"${k}"`).join(',');
  const res = await rest(
    `tts_clips?user_id=eq.${userId}&clip_key=in.(${list})&select=id,clip_key,storage_path,character_count`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) {
    console.error('tts_clips lookup failed', res.status, await res.text().catch(() => ''));
    return new Map();
  }
  const rows = await res.json();
  return new Map((rows || []).map((r) => [r.clip_key, r]));
}

export async function rememberClip(row) {
  const res = await rest('tts_clips?on_conflict=user_id,clip_key', {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({
      user_id: row.userId,
      voice_id: row.providerVoiceId,
      clip_key: row.clipKey,
      text_hash: row.textHash,
      speed: Number(row.speed).toFixed(2),
      model_id: row.modelId,
      character_count: row.characterCount,
      storage_path: row.storagePath,
      last_used_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) console.error('could not record tts clip', res.status, await res.text().catch(() => ''));
}

/* Which clips are still worth keeping. Nothing depends on this being written, so
   a failure is logged and dropped rather than failing the session. */
export function touchClips(ids) {
  if (!ids.length) return;
  const list = ids.map((k) => `"${k}"`).join(',');
  rest(`tts_clips?id=in.(${list})`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch((e) => console.error('could not touch tts clips', e));
}

/* ---------------- storage ---------------- */

/* The bytes themselves, straight out of the bucket. The player never needs this
   — it is handed a signed link and fetches the mp3 itself — but a route that
   *serves* audio does, and reading an object back is the thing that makes a
   piece of audio worth generating only once. Null when there is nothing there,
   which is not an error: it is how a caller finds out it has to make it. */
export async function readClip(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: serviceHeaders(),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    console.error('could not read clip', path, res.status);
    return null;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length ? bytes : null;
}

export async function uploadClip(path, bytes) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`clip upload failed (${res.status}): ${await res.text().catch(() => '')}`);
}

/* A link the browser can fetch the mp3 with, without the bucket being public. */
export async function signClipUrl(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
  });
  if (!res.ok) {
    console.error('could not sign clip url', path, res.status);
    return null;
  }
  const out = await res.json().catch(() => null);
  const signed = out && (out.signedURL || out.signedUrl);
  return signed ? `${SUPABASE_URL}/storage/v1${signed}` : null;
}

/* When a cloned voice is removed, the audio generated in it is no longer audio
   anybody can hear again — the voice it was read in does not exist. So it goes
   with the voice, files and rows together, rather than sitting in the bucket. */
export async function deleteClipsForVoice(userId, providerVoiceId) {
  if (!providerVoiceId) return;
  const res = await rest(
    `tts_clips?user_id=eq.${userId}&voice_id=eq.${encodeURIComponent(providerVoiceId)}&select=storage_path`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return;
  const rows = await res.json().catch(() => []);
  const paths = (rows || []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: serviceHeaders(),
      body: JSON.stringify({ prefixes: paths }),
    }).catch((e) => console.error('could not remove cached clips', e));
  }
  await rest(`tts_clips?user_id=eq.${userId}&voice_id=eq.${encodeURIComponent(providerVoiceId)}`, {
    method: 'DELETE',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
  }).catch((e) => console.error('could not clear cached clip rows', e));
}

/* ---------------- the ledger, and the limits read off it ---------------- */

export async function recordGenerations(rows) {
  if (!rows.length) return;
  const res = await rest('tts_generations', {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(rows.map((r) => ({
      user_id: r.userId,
      voice_id: r.providerVoiceId,
      text_hash: r.textHash,
      character_count: r.characterCount,
      cache_hit: !!r.cacheHit,
    }))),
  });
  if (!res.ok) console.error('could not record tts generation', res.status, await res.text().catch(() => ''));
}

async function countGenerationsSince(userId, seconds) {
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  const res = await rest(
    `tts_generations?user_id=eq.${userId}&cache_hit=is.false&created_at=gte.${since}&select=id&limit=1`,
    { headers: serviceHeaders({ Prefer: 'count=exact' }) },
  );
  if (!res.ok) return 0;
  const range = res.headers.get('content-range') || '';
  const total = parseInt(range.split('/')[1], 10);
  return Number.isFinite(total) ? total : 0;
}

/* Returns null when the request may go ahead, or the limit it would break.
   `headroom` is how many lines are still allowed, so a request for twenty lines
   with five left is refused before a single one is generated rather than halfway
   through. */
export async function rateLimitFor(userId, wantedLines) {
  for (const limit of LIMITS) {
    const used = await countGenerationsSince(userId, limit.seconds);
    if (used + wantedLines > limit.max) {
      return { code: limit.code, headroom: Math.max(0, limit.max - used), retryAfterSeconds: limit.seconds };
    }
  }
  return null;
}
