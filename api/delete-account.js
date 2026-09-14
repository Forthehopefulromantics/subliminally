// /api/delete-account.js
// Vercel serverless function — no npm packages needed, uses built-in fetch.
//
// Deletes the signed-in user's account and everything attached to it. Apple
// requires this to be possible from inside the app (guideline 5.1.1(v)), and
// it's the right thing to offer on the web too.
//
// The browser sends its Supabase access token; we ask Supabase who that token
// belongs to, and only ever delete *that* user — the caller can't name
// someone else. Deletion order: files in storage, then table rows, then the
// auth user itself (which also invalidates every session).
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   SUPABASE_URL              - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Settings -> API -> service_role key
//
// Note: this does not cancel a Stripe or App Store / Play subscription — the UI
// tells people to cancel first.

import { applyCors } from '../lib/cors.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

const STORAGE_BUCKETS = ['recordings', 'avatars', 'custom-tracks', 'journal-photos', 'voice-notes'];
// [table, column that holds the user's id]
const USER_TABLES = [
  ['habit_checkins', 'user_id'],
  ['habits', 'user_id'],
  ['journal_photos', 'user_id'],
  ['journal_entries', 'user_id'],
  ['subliminals', 'user_id'],
  ['push_tokens', 'user_id'],
  ['subscribers', 'user_id'],
  ['profiles', 'id'],
];

function serviceHeaders(extra) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}

async function whoIsCalling(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

async function emptyBucketFolder(bucket, userId) {
  const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 }),
  });
  if (!listRes.ok) return; // bucket may not exist yet — nothing to remove
  const objects = await listRes.json();
  const paths = (objects || []).map((o) => `${userId}/${o.name}`);
  if (!paths.length) return;
  await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
    body: JSON.stringify({ prefixes: paths }),
  });
}

async function deleteRows(table, column, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
  });
  // 404 = table doesn't exist yet (e.g. push_tokens before that migration ran) — fine.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to clear ${table} (${res.status}): ${await res.text()}`);
  }
}

async function deleteClonedVoice(userId) {
  if (!ELEVENLABS_API_KEY) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=cloned_voice_id`, {
      headers: serviceHeaders(),
    });
    if (!res.ok) return;
    const rows = await res.json();
    const voiceId = rows && rows[0] && rows[0].cloned_voice_id;
    if (!voiceId) return;
    await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    });
  } catch (e) {
    // Best effort — never block deleting the account on the voice provider.
    console.error('could not delete cloned voice for', userId, e);
  }
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' });
    return;
  }

  const auth = req.headers['authorization'] || '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!accessToken) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  const user = await whoIsCalling(accessToken);
  if (!user) {
    res.status(401).json({ error: 'Your session has expired — log in again and retry.' });
    return;
  }

  try {
    // A cloned voice lives at the speech provider, not in Supabase, so deleting
    // the account has to reach out and remove it too — otherwise a copy of
    // someone's voice outlives the account that made it.
    await deleteClonedVoice(user.id);

    for (const bucket of STORAGE_BUCKETS) await emptyBucketFolder(bucket, user.id);
    for (const [table, column] of USER_TABLES) await deleteRows(table, column, user.id);

    const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: serviceHeaders(),
    });
    if (!del.ok) throw new Error(`Auth user delete failed (${del.status}): ${await del.text()}`);

    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('delete-account error:', err);
    res.status(500).json({ error: "Couldn't finish deleting the account — email hello@subliminallybyfthr.com and we'll do it by hand." });
  }
}
