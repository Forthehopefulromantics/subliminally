// /api/tts.js
// Vercel serverless function — turns one affirmation into spoken audio.
//
// The browser's built-in speechSynthesis gives you whatever robotic voice the
// device happens to ship, it sounds different on every phone, and on iOS it goes
// silent as soon as a Web Audio context is running — which is exactly when a
// session is playing. So real voices are generated here instead and handed back
// as an audio file the player can mix like any other clip.
//
// This is also what makes a *cloned* voice possible: once someone's voice exists
// at the provider, generating a line in their voice is the same call with a
// different voice id.
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   ELEVENLABS_API_KEY        - elevenlabs.io -> Profile -> API key
//   SUPABASE_URL              - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Settings -> API -> service_role key
//
// With ELEVENLABS_API_KEY unset the route replies 503 and the app quietly falls
// back to the device voice, exactly as it behaved before.

import { applyCors } from '../lib/cors.js';
import { bearerToken, whoIsCalling, serviceHeaders, tierForUser } from '../lib/supabase-auth.js';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const MODEL_ID = 'eleven_turbo_v2_5'; // fast and cheap; quality is plenty for affirmations

// The stock voices offered in the picker. Keeping the list here as well as in the
// browser means a caller can't spend credits on some arbitrary voice id.
const ALLOWED_VOICES = new Set([
  'EXAVITQu4vr4xnSDxMaL', // Sarah — warm, calm
  'XB0fDUnXU5powFXDhCwa', // Charlotte — soft, low
  'pFZP5JQG7iQjIQuC4Bku', // Lily — bright, young
  'Xb7hH8MSUJpSbSDYk0k2', // Alice — clear, steady
  'onwK4e9ZLuTAKqWW03F9', // Daniel — deep, grounding
  'JBFqnCBsd6RMkjVDRZzb', // George — measured, older
]);

// A line of an affirmation is short; this is a generous ceiling that still stops
// the route being used as a general-purpose text-to-speech endpoint.
const MAX_CHARS = 400;

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/* A cloned voice belongs to exactly one account, so check the id against that
   person's profile before spending anything on it. */
async function ownsClonedVoice(userId, voiceId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=cloned_voice_id`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return !!(rows && rows[0] && rows[0].cloned_voice_id === voiceId);
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (!ELEVENLABS_API_KEY) {
    res.status(503).json({ error: 'not_configured', detail: 'No voice provider is set up yet.' });
    return;
  }
  if (!SUPABASE_URL) { res.status(500).json({ error: 'Server is missing SUPABASE_URL.' }); return; }

  const user = await whoIsCalling(bearerToken(req));
  if (!user) { res.status(401).json({ error: 'Sign in to use the studio voices.' }); return; }

  const { text, voiceId, speed } = await readJsonBody(req);
  const line = typeof text === 'string' ? text.trim() : '';
  if (!line) { res.status(400).json({ error: 'Nothing to say.' }); return; }
  if (line.length > MAX_CHARS) { res.status(400).json({ error: `Keep each line under ${MAX_CHARS} characters.` }); return; }
  if (typeof voiceId !== 'string' || !voiceId) { res.status(400).json({ error: 'No voice chosen.' }); return; }

  // Studio voices are a paid feature; a cloned voice is also only ever your own.
  const isStock = ALLOWED_VOICES.has(voiceId);
  if (!isStock && !(await ownsClonedVoice(user.id, voiceId))) {
    res.status(403).json({ error: 'That voice is not available on your account.' });
    return;
  }
  const tier = await tierForUser(user.id);
  if (tier === 'none') {
    res.status(403).json({ error: 'upgrade_required', detail: 'Studio voices come with Ritual.' });
    return;
  }

  try {
    const el = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: line,
        model_id: MODEL_ID,
        // Steady and unhurried — an affirmation read with performance in it is
        // harder to absorb than one read plainly. The speed comes from whichever
        // pace was chosen in the builder; the provider's usable range is roughly
        // 0.7 to 1.2, and anything outside it is clamped rather than refused.
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.75,
          style: 0.1,
          use_speaker_boost: true,
          speed: Math.min(1.2, Math.max(0.7, Number(speed) || 1)),
        },
      }),
    });
    if (!el.ok) {
      const detail = await el.text();
      console.error('ElevenLabs TTS failed:', el.status, detail);
      res.status(502).json({ error: "The voice service didn't respond — using your device voice instead." });
      return;
    }
    const audio = Buffer.from(await el.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    // The same line in the same voice always sounds the same, so let the browser
    // keep it rather than paying to generate it again on every loop.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.status(200).send(audio);
  } catch (err) {
    console.error('tts error:', err);
    res.status(500).json({ error: "Couldn't generate that line." });
  }
}
