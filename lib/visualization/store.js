// Visualization — everything the server reads and writes in Supabase.
//
// All of it is service-role access, scoped by user id on every query: the
// service role bypasses RLS, so each helper here asks for `user_id=eq.<caller>`
// rather than trusting that a row id belongs to whoever sent it.

import { serviceHeaders } from '../supabase-auth.js';
import {
  SETTING_DAILY_NARRATION_LIMIT, DEFAULT_DAILY_NARRATION_LIMIT, STALE_PENDING_SECONDS, parseLimit,
} from './config.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const AUDIO_BUCKET = 'visualization-audio';
const SIGNED_URL_SECONDS = 60 * 60 * 6;

const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, init);
const uuidLike = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
export const isUuid = uuidLike;

/* ---------------- the limit ---------------- */

/* How many new narrations a person may make a day. The table wins, then the
   environment, then the default — so it can be changed with one UPDATE, and
   setting the table row to 0 closes narration for everybody. */
export async function dailyNarrationLimit() {
  try {
    const res = await rest(
      `visualization_settings?key=eq.${SETTING_DAILY_NARRATION_LIMIT}&select=value`,
      { headers: serviceHeaders() },
    );
    if (res.ok) {
      const rows = await res.json();
      const fromTable = parseLimit(rows && rows[0] && rows[0].value);
      if (fromTable != null) return fromTable;
    }
  } catch (e) { /* fall through to the environment */ }
  const fromEnv = parseLimit(process.env.VISUALIZATION_DAILY_NARRATION_LIMIT);
  return fromEnv != null ? fromEnv : DEFAULT_DAILY_NARRATION_LIMIT;
}

/* Narrations that actually finished since `sinceIso`. A failed attempt is not in
   this number, which is the whole of "failed generations do not use the limit". */
export async function narrationsSince(userId, sinceIso) {
  const res = await rest(
    `visualization_narrations?user_id=eq.${userId}&status=eq.succeeded&completed_at=gte.${encodeURIComponent(sinceIso)}&select=id`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) throw new Error(`could not read narration ledger (${res.status})`);
  return ((await res.json()) || []).length;
}

/* ---------------- the ledger ---------------- */

/* Opens an attempt. Returns { id } or { conflict: true } when this person (or
   this visualization) already has one in flight — the database refuses the
   second, so two taps and two tabs cannot both start. An attempt left pending
   by a function that was stopped is retired first so it cannot block forever. */
export async function openAttempt({ userId, visualizationId, scriptHash, characterCount }) {
  const cutoff = new Date(Date.now() - STALE_PENDING_SECONDS * 1000).toISOString();
  await rest(`visualization_narrations?user_id=eq.${userId}&status=eq.pending&created_at=lt.${encodeURIComponent(cutoff)}`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'failed', error_code: 'abandoned', completed_at: new Date().toISOString() }),
  }).catch(() => {});

  const res = await rest('visualization_narrations', {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      user_id: userId,
      visualization_id: visualizationId,
      script_hash: scriptHash,
      character_count: characterCount,
      status: 'pending',
    }),
  });
  if (res.status === 409) return { conflict: true };
  if (!res.ok) throw new Error(`could not open narration attempt (${res.status}): ${await res.text().catch(() => '')}`);
  const rows = await res.json();
  return { id: rows[0].id };
}

/* Closing an attempt as succeeded is what charges the day's allowance, and
   leaving one pending is what would quietly not charge it, so a hiccup here is
   retried rather than shrugged off. */
export async function closeAttempt(id, status, errorCode) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await rest(`visualization_narrations?id=eq.${id}`, {
        method: 'PATCH',
        headers: serviceHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ status, error_code: errorCode || null, completed_at: new Date().toISOString() }),
      });
      if (res.ok) return true;
      console.error('could not close narration attempt', id, status, res.status);
    } catch (e) {
      console.error('could not close narration attempt', id, status, e && e.message);
    }
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
  }
  return false;
}

/* Visualizations this person has a narration in flight for, newest first — what
   the app asks after a refresh in the middle of one. */
export async function pendingFor(userId) {
  const cutoff = new Date(Date.now() - STALE_PENDING_SECONDS * 1000).toISOString();
  const res = await rest(
    `visualization_narrations?user_id=eq.${userId}&status=eq.pending&created_at=gte.${encodeURIComponent(cutoff)}&select=visualization_id`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return [];
  return ((await res.json()) || []).map((r) => r.visualization_id);
}

/* ---------------- visualizations ---------------- */

export async function getVisualization(userId, id) {
  if (!uuidLike(id)) return null;
  const res = await rest(`visualizations?id=eq.${id}&user_id=eq.${userId}&select=*`, { headers: serviceHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

/* Writes the narration columns — the only writer of them. Conditional on the row
   still existing and still being this person's; returns the row or null. */
export async function saveNarration(userId, id, fields) {
  const res = await rest(`visualizations?id=eq.${id}&user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    console.error('could not save narration fields', res.status, await res.text().catch(() => ''));
    return null;
  }
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

export async function deleteVisualizationRow(userId, id) {
  const res = await rest(`visualizations?id=eq.${id}&user_id=eq.${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
  });
  return res.ok;
}

/* The faith the person saved in onboarding or Settings: read here from their
   profile, not sent by the browser, so what shapes the story is only ever what
   they actually chose. */
export async function savedFaith(userId) {
  try {
    const res = await rest(`profiles?id=eq.${userId}&select=faith,faith_other`, { headers: serviceHeaders() });
    if (!res.ok) return { faith: null, faithWord: null };
    const rows = await res.json();
    const row = rows && rows[0];
    if (!row || !row.faith) return { faith: null, faithWord: null };
    return { faith: row.faith, faithWord: row.faith === 'other' ? (row.faith_other || null) : null };
  } catch (e) {
    return { faith: null, faithWord: null };
  }
}

/* ---------------- audio ---------------- */

export function narrationPathFor(userId, visualizationId, scriptHash) {
  return `${userId}/${visualizationId}-${String(scriptHash).slice(0, 24)}.mp3`;
}

export async function uploadNarration(path, bytes) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${AUDIO_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`narration upload failed (${res.status}): ${await res.text().catch(() => '')}`);
}

export async function removeNarrationFiles(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  await fetch(`${SUPABASE_URL}/storage/v1/object/${AUDIO_BUCKET}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
    body: JSON.stringify({ prefixes: list }),
  }).catch((e) => console.error('could not remove narration files', e));
}

export async function signNarrationUrl(path) {
  if (!path) return null;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${AUDIO_BUCKET}/${path}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
  });
  if (!res.ok) return null;
  const out = await res.json().catch(() => null);
  const signed = out && (out.signedURL || out.signedUrl);
  return signed ? `${SUPABASE_URL}/storage/v1${signed}` : null;
}
