// /api/tts.js
// Vercel serverless function — turns the affirmations of one subliminal into
// spoken audio, once.
//
// The browser's built-in speechSynthesis gives you whatever robotic voice the
// device happens to ship, it sounds different on every phone, and on iOS it goes
// silent as soon as a Web Audio context is running — which is exactly when a
// session is playing. So real voices are generated here instead and handed back
// as audio files the player can mix like any other clip.
//
// This is also what makes a *cloned* voice possible: once someone's voice exists
// at the provider, generating a line in their voice is the same call with a
// different voice id.
//
// WHAT THIS ROUTE DELIBERATELY DOES NOT DO: generate eight hours of audio. The
// sequence is generated once, at its natural length, and the player loops it in
// the browser for however long the session was set to run — 20 minutes, an hour,
// four, eight, or any custom length. A twenty-line subliminal costs the same
// whether it plays for twenty minutes or all night, and replaying it tomorrow
// costs nothing at all, because every clip is kept (see lib/tts-store.js).
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   ELEVENLABS_API_KEY        - elevenlabs.io -> Profile -> API key
//   SUPABASE_URL              - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Settings -> API -> service_role key
//
// With ELEVENLABS_API_KEY unset the route replies 503 and the app quietly falls
// back to the device voice, exactly as it behaved before.

import { applyCors } from '../lib/cors.js';
import { bearerToken, whoIsCalling, tierAtLeast, tierForUser } from '../lib/supabase-auth.js';
import { MY_VOICE_KEY, resolvePresetVoice } from '../lib/voices.js';
import { CLONE_TIER } from '../lib/voice-access.js';
import { getVoiceProfile } from '../lib/user-voices.js';
import {
  MODEL_ID, VoiceProviderError, clampSpeed, isConfigured, synthesizeSpeech,
} from '../lib/elevenlabs.js';
import {
  MAX_CHARS_PER_LINE, MAX_LINES_PER_REQUEST, findCachedClips, hashesFor, normalizeLine,
  rateLimitFor, recordGenerations, rememberClip, signClipUrl, storagePathFor, touchClips, uploadClip,
} from '../lib/tts-store.js';

/* Generating several lines takes longer than the default ceiling allows, and a
   function cut off half way through has spent the credits without keeping the
   audio. The browser also batches (see TTS_LINES_PER_REQUEST in js/builder.js), so
   this is headroom rather than something a normal request uses. */
export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;

/* Two people cannot double-spend on the same clip, and neither can one person
   pressing Generate twice: the second request waits on the first rather than
   starting its own. Per instance, so it is a saving and not a guarantee — the
   guarantee is the cache, which makes the second generation unnecessary anyway. */
const inFlight = new Map();
function once(key, work) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/* Nothing past one of these is worth trying: the account is out of credits, the
   key is wrong, or the provider is asking us to slow down. Carrying on through
   the rest of the sequence would just repeat the same failure twenty times. */
const FATAL_CODES = new Set(['quota_exceeded', 'rate_limited', 'provider_auth', 'not_configured']);

const HTTP_FOR_CODE = {
  quota_exceeded: 429,
  rate_limited: 429,
  too_fast: 429,
  hourly_limit: 429,
  daily_limit: 429,
  timeout: 504,
  network: 502,
  invalid_voice: 400,
  provider_auth: 502,
  rejected: 502,
  provider_failed: 502,
};

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/* Which voice, as an id the provider understands — and never one the caller made
   up. A preset is looked up in the catalogue; 'mine' is looked up against the
   caller's own voice profile and nobody else's. */
async function resolveVoice(userId, requested) {
  if (requested === MY_VOICE_KEY) {
    const profile = await getVoiceProfile(userId);
    if (!profile) return { error: 'no_cloned_voice' };
    return { providerVoiceId: profile.provider_voice_id, isClone: true };
  }
  const preset = resolvePresetVoice(requested);
  if (preset) return { providerVoiceId: preset.providerVoiceId, isClone: false };

  /* A subliminal saved before this release stored the raw provider id, and for a
     cloned voice that id is not in the catalogue. It is still only ever accepted
     when it is this person's own. */
  const profile = await getVoiceProfile(userId);
  if (profile && profile.provider_voice_id === requested) {
    return { providerVoiceId: profile.provider_voice_id, isClone: true };
  }
  return { error: 'invalid_voice' };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  if (!isConfigured()) {
    res.status(503).json({ error: 'not_configured', detail: 'No voice provider is set up yet.' });
    return;
  }
  if (!SUPABASE_URL) { res.status(500).json({ error: 'server_misconfigured' }); return; }

  const user = await whoIsCalling(bearerToken(req));
  if (!user) { res.status(401).json({ error: 'not_signed_in' }); return; }

  const body = await readJsonBody(req);
  // `voiceId` is what the previous build sent; a tab open across the deploy still works.
  const requested = typeof body.voiceKey === 'string' ? body.voiceKey : body.voiceId;
  if (typeof requested !== 'string' || !requested) { res.status(400).json({ error: 'no_voice_chosen' }); return; }

  // One line (`text`) is the voice preview; a whole sequence (`lines`) is a subliminal.
  const singleLine = !Array.isArray(body.lines);
  const asked = singleLine ? [body.text] : body.lines;
  const lines = (asked || []).map(normalizeLine);
  if (!lines.length || lines.every((l) => !l)) { res.status(400).json({ error: 'nothing_to_say' }); return; }
  if (lines.length > MAX_LINES_PER_REQUEST) { res.status(400).json({ error: 'too_many_lines' }); return; }

  const speed = clampSpeed(body.speed);

  const voice = await resolveVoice(user.id, requested);
  if (voice.error) { res.status(voice.error === 'invalid_voice' ? 400 : 409).json({ error: voice.error }); return; }

  /* Serenity is the voice the app has, free account or not — it is what most
     people will hear, so gating it behind a plan would have meant a free
     account never hearing the app work. A *cloned* voice is the paid one, and
     it is already only ever your own; this is the same rule /api/voice-clone
     enforces when it creates one, read off lib/voice-access.js so the two
     cannot drift. */
  if (voice.isClone) {
    const tier = await tierForUser(user.id);
    if (!tierAtLeast(tier, CLONE_TIER)) {
      res.status(403).json({ error: 'upgrade_required', detail: 'Your cloned voice comes with Ritual.' });
      return;
    }
  }

  /* One entry per line asked for, in the order they were asked for, so the player
     can line the audio up against the affirmations on screen. */
  const clips = lines.map((line, index) => {
    if (!line) return { index, text: line, error: 'empty' };
    if (line.length > MAX_CHARS_PER_LINE) return { index, text: line, error: 'too_long' };
    const { textHash, clipKey } = hashesFor({ text: line, providerVoiceId: voice.providerVoiceId, speed, modelId: MODEL_ID });
    return { index, text: line, textHash, clipKey };
  });

  const wanted = clips.filter((c) => c.clipKey);
  const cached = await findCachedClips(user.id, wanted.map((c) => c.clipKey));
  const misses = wanted.filter((c) => !cached.has(c.clipKey));

  /* Nothing is generated until the whole request is known to be within the
     allowance — a twenty-line sequence with room for five is refused up front
     rather than paid for halfway. Cache hits never count against it. */
  if (misses.length) {
    const limited = await rateLimitFor(user.id, misses.length);
    if (limited) {
      res.status(429).json({
        error: limited.code,
        headroom: limited.headroom,
        retryAfterSeconds: limited.retryAfterSeconds,
      });
      return;
    }
  }

  const ledger = [];
  let fatal = null;

  for (const clip of wanted) {
    const hit = cached.get(clip.clipKey);
    if (hit) {
      clip.storagePath = hit.storage_path;
      clip.cached = true;
      clip.rowId = hit.id;
      ledger.push({ userId: user.id, providerVoiceId: voice.providerVoiceId, textHash: clip.textHash, characterCount: clip.text.length, cacheHit: true });
      continue;
    }
    if (fatal) { clip.error = fatal; continue; }
    try {
      const storagePath = storagePathFor(user.id, clip.clipKey);
      await once(`${user.id}|${clip.clipKey}`, async () => {
        const audio = await synthesizeSpeech({ providerVoiceId: voice.providerVoiceId, text: clip.text, speed });
        await uploadClip(storagePath, audio);
        await rememberClip({
          userId: user.id,
          providerVoiceId: voice.providerVoiceId,
          clipKey: clip.clipKey,
          textHash: clip.textHash,
          speed,
          modelId: MODEL_ID,
          characterCount: clip.text.length,
          storagePath,
        });
      });
      clip.storagePath = storagePath;
      clip.cached = false;
      ledger.push({ userId: user.id, providerVoiceId: voice.providerVoiceId, textHash: clip.textHash, characterCount: clip.text.length, cacheHit: false });
    } catch (err) {
      const code = err instanceof VoiceProviderError ? err.code : 'generation_failed';
      console.error('tts line failed:', code, (err && err.detail) || (err && err.message) || err);
      clip.error = code;
      if (FATAL_CODES.has(code)) fatal = code;
    }
  }

  await Promise.all([
    recordGenerations(ledger),
    ...clips.filter((c) => c.storagePath).map(async (c) => { c.url = await signClipUrl(c.storagePath); }),
  ]);
  // A signed link that could not be minted is no use to the player either.
  clips.forEach((c) => { if (c.storagePath && !c.url) c.error = c.error || 'generation_failed'; });
  touchClips(clips.filter((c) => c.cached && c.rowId).map((c) => c.rowId));

  const playable = clips.filter((c) => c.url);
  if (!playable.length) {
    const code = fatal || (clips.find((c) => c.error && c.error !== 'empty') || {}).error || 'generation_failed';
    res.status(HTTP_FOR_CODE[code] || 502).json({ error: code });
    return;
  }

  /* The previous build asked for one line and expected the mp3 itself back, so
     that is still what a one-line request gets. */
  if (singleLine) {
    const audio = await fetch(playable[0].url);
    if (audio.ok) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.status(200).send(Buffer.from(await audio.arrayBuffer()));
      return;
    }
  }

  res.status(200).json({
    voiceKey: requested,
    speed,
    characterCount: ledger.reduce((n, r) => n + (r.cacheHit ? 0 : r.characterCount), 0),
    generated: ledger.filter((r) => !r.cacheHit).length,
    reused: ledger.filter((r) => r.cacheHit).length,
    warning: fatal || null,
    clips: clips.map((c) => ({ index: c.index, text: c.text, url: c.url || null, cached: !!c.cached, error: c.error || null })),
  });
}
