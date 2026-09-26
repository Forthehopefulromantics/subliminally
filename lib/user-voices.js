// Someone's own cloned voice: the one row that says a voice exists for them at
// the provider, and the id it has there.
//
// The row is the record; the recording it was made from is never kept. Nothing
// here hands a provider voice id to the browser — the page asks for the voice by
// the key 'mine' and this is what resolves it, server-side, for the one person it
// belongs to.
//
// `profiles.cloned_voice_id` is still written alongside the table. It is what the
// app read before user_voice_profiles existed, and a phone running the previous
// build still reads it, so the two are kept in step. It is written, never trusted:
// ownership is read from user_voice_profiles alone (see getVoiceProfile).

import { serviceHeaders } from './supabase-auth.js';
import { PROVIDER } from './voices.js';

const SUPABASE_URL = process.env.SUPABASE_URL;

/* The sentence somebody has to agree to before a voice of theirs is made. It
   lives here so the page cannot show one thing and the server accept another:
   /api/voices hands this exact string to the page, and /api/voice-clone refuses a
   sample that does not come back with it. */
export const VOICE_CLONE_CONSENT =
  'I confirm this recording is my own voice, that I have permission to clone it, and that I consent to Subliminally creating an AI version of my voice. I am not uploading anyone else\'s voice.';

export function consentGiven(headerValue) {
  return typeof headerValue === 'string' && headerValue.trim() === VOICE_CLONE_CONSENT;
}

export async function getVoiceProfile(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_voice_profiles?user_id=eq.${userId}&provider=eq.${PROVIDER}` +
    '&select=id,provider,provider_voice_id,display_name,consent_at,created_at&limit=1',
    { headers: serviceHeaders() },
  );
  if (!res.ok) {
    console.error('voice profile lookup failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  const rows = await res.json();
  /* Only this table counts. `profiles.cloned_voice_id` is still written as a
     mirror for older builds, but the owner can UPDATE their own profile row, so
     a value there is not proof the voice is theirs — it is never read back as
     one. user_voice_profiles has no write policy at all: only this server,
     having just created the voice at the provider, can put a row in it. */
  return (rows && rows[0]) || null;
}

export async function saveVoiceProfile({ userId, providerVoiceId, displayName, consentAt }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_voice_profiles?on_conflict=user_id,provider`, {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({
      user_id: userId,
      provider: PROVIDER,
      provider_voice_id: providerVoiceId,
      display_name: displayName || 'My voice',
      consent_at: consentAt || new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`could not save the voice profile (${res.status}): ${await res.text().catch(() => '')}`);
  await setLegacyClonedVoiceId(userId, providerVoiceId);
  const rows = await res.json().catch(() => null);
  return (rows && rows[0]) || null;
}

export async function deleteVoiceProfile(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_voice_profiles?user_id=eq.${userId}&provider=eq.${PROVIDER}`,
    { method: 'DELETE', headers: serviceHeaders({ Prefer: 'return=minimal' }) },
  );
  if (!res.ok) throw new Error(`could not remove the voice profile (${res.status})`);
  await setLegacyClonedVoiceId(userId, null);
}

async function setLegacyClonedVoiceId(userId, providerVoiceId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ cloned_voice_id: providerVoiceId }),
  });
  if (!res.ok) console.error('could not mirror cloned_voice_id onto the profile', res.status);
}
