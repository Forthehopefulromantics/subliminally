// /api/voice-clone.js
// Vercel serverless function — makes a copy of someone's voice from a sample,
// so their subliminals can be generated in their own voice without re-recording
// every line by hand.
//
// Saying affirmations out loud is still the practice, and the app says so. This
// is for the nights you want the session without the recording session.
//
// POST with a recorded sample -> creates the voice at the provider and stores
// its id on the caller's profile. DELETE -> removes it again, at the provider
// and on the profile. A person only ever has one cloned voice; cloning again
// replaces it.
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   ELEVENLABS_API_KEY        - elevenlabs.io -> Profile -> API key (a paid plan
//                               is needed for voice cloning)
//   SUPABASE_URL              - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Settings -> API -> service_role key

import { applyCors } from '../lib/cors.js';
import { bearerToken, whoIsCalling, serviceHeaders, tierForUser } from '../lib/supabase-auth.js';

export const config = { api: { bodyParser: false } };

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;

// Enough for a minute or so of speech, which is all instant cloning needs.
const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_SAMPLE_BYTES) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function getProfileVoice(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=cloned_voice_id`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows[0] ? rows[0].cloned_voice_id : null;
}

async function setProfileVoice(userId, voiceId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ cloned_voice_id: voiceId }),
  });
  if (!res.ok) throw new Error(`Could not save the voice to the profile (${res.status}): ${await res.text()}`);
}

async function deleteRemoteVoice(voiceId) {
  if (!voiceId) return;
  try {
    await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    });
  } catch (e) {
    // Best effort — a leftover voice at the provider shouldn't fail the request.
    console.error('could not delete remote voice', voiceId, e);
  }
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!ELEVENLABS_API_KEY) {
    res.status(503).json({ error: 'not_configured', detail: 'Voice cloning is not switched on yet.' });
    return;
  }
  if (!SUPABASE_URL) { res.status(500).json({ error: 'Server is missing SUPABASE_URL.' }); return; }

  const user = await whoIsCalling(bearerToken(req));
  if (!user) { res.status(401).json({ error: 'Sign in first.' }); return; }

  if (req.method === 'DELETE') {
    const existing = await getProfileVoice(user.id);
    await deleteRemoteVoice(existing);
    try { await setProfileVoice(user.id, null); }
    catch (e) { console.error(e); res.status(500).json({ error: "Couldn't remove your voice." }); return; }
    res.status(200).json({ removed: true });
    return;
  }

  // Cloning your voice is the top of the range — it's the most expensive thing
  // the app does per person.
  const tier = await tierForUser(user.id);
  if (tier !== 'ritual') {
    res.status(403).json({ error: 'upgrade_required', detail: 'Cloning your voice comes with Ritual.' });
    return;
  }

  let sample;
  try { sample = await readRawBody(req); }
  catch (e) {
    res.status(413).json({ error: 'That recording is too long — about a minute is plenty.' });
    return;
  }
  if (!sample || sample.length < 2048) {
    res.status(400).json({ error: 'That recording was too short — read the sample paragraph all the way through.' });
    return;
  }

  const contentType = req.headers['content-type'] || 'audio/webm';
  const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : contentType.includes('mpeg') ? 'mp3' : 'webm';

  try {
    // Replace rather than accumulate: one voice per person, always the latest.
    const previous = await getProfileVoice(user.id);

    const form = new FormData();
    form.append('name', `subliminally-${user.id}`);
    form.append('files', new Blob([sample], { type: contentType }), `sample.${ext}`);
    form.append('description', 'Cloned from a Subliminally voice sample.');

    const el = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form,
    });
    if (!el.ok) {
      const detail = await el.text();
      console.error('ElevenLabs clone failed:', el.status, detail);
      res.status(502).json({ error: "The voice service couldn't use that recording — try again somewhere quieter." });
      return;
    }
    const created = await el.json();
    if (!created || !created.voice_id) {
      res.status(502).json({ error: 'The voice service returned an unexpected response.' });
      return;
    }

    await setProfileVoice(user.id, created.voice_id);
    // Only bin the old one once the new one is safely saved.
    if (previous && previous !== created.voice_id) await deleteRemoteVoice(previous);

    res.status(200).json({ voiceId: created.voice_id });
  } catch (err) {
    console.error('voice-clone error:', err);
    res.status(500).json({ error: "Couldn't finish cloning your voice — try again in a moment." });
  }
}
