// Shared helper: work out which signed-in user a request belongs to.
//
// The browser sends its Supabase access token in the Authorization header; we
// ask Supabase who that token belongs to rather than trusting anything the
// caller says about itself. Every /api route that acts on someone's data goes
// through here first.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function bearerToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export async function whoIsCalling(accessToken) {
  if (!accessToken) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

export function serviceHeaders(extra) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}

/* Which plan someone is on, straight from the subscribers table. Mirrors
   getMyTier() in the browser, including the retired-tier mapping: Whisper and
   Reverie are no longer sold, and a row still on either is honoured as Ritual
   rather than rewritten. Keep this table in step with LEGACY_TIER_TO_TIER in
   js/billing.js. */
const LEGACY_TIER_TO_TIER = { whisper: 'ritual', reverie: 'ritual' };

/* Does this tier carry the premium entitlement? There is one paid plan, Ritual,
   so this is "on a paid plan at all" — it deliberately does not name a tier, so
   adding a plan later does not silently lock paying members out of their voices.
   A retired tier is already mapped to Ritual by tierForUser before it gets here.

   This is the single definition of premium access for everything that spends
   money at ElevenLabs: /api/tts (Serenity, legacy voices, and a cloned voice)
   and /api/voice-clone. Recording your own voice never asks. */
export function hasPremiumAccess(tier) {
  return !!tier && tier !== 'none';
}

export async function tierForUser(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/subscribers?user_id=eq.${userId}&select=tier,status`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return 'none';
  const rows = await res.json();
  const row = rows && rows[0];
  if (!row || !['active', 'trialing'].includes(row.status)) return 'none';
  return LEGACY_TIER_TO_TIER[row.tier] || row.tier || 'none';
}
