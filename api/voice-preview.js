// /api/voice-preview.js
// Vercel serverless function — the Serenity demo, for everybody.
//
// WHAT THIS IS NOT: a way to have text read aloud. It takes no parameters at
// all. There is one sentence (lib/voice-preview.js), one voice, one pace, and
// this route will only ever hand back that one file. Having your *own*
// affirmations read in Serenity is /api/tts, which is premium and checks the
// plan before a single character reaches the provider. Those two things are
// deliberately different routes so that one can be open and the other cannot.
//
// WHAT THIS COSTS: one generation, once, for the life of the app. The mp3 is
// kept in the same bucket generated clips live in, under a path derived from the
// words and the voice, and every request after the first reads it back. There is
// no per-request, per-person or per-press provider call — pressing Preview two
// hundred times is two hundred reads of one file. The response is immutable and
// publicly cacheable, so in practice most presses never reach this function at
// all: the browser and the CDN answer them.
//
// No sign-in: somebody deciding whether to pay for a voice has to be able to
// hear it, and there is nothing here that belongs to anyone.

import { applyCors } from '../lib/cors.js';
import { isConfigured, synthesizeSpeech, VoiceProviderError } from '../lib/elevenlabs.js';
import { readClip, uploadClip } from '../lib/tts-store.js';
import {
  PREVIEW_SPEED, PREVIEW_TEXT, previewStoragePath, previewVoiceId,
} from '../lib/voice-preview.js';

/* Generating one line is quick, but the first request of the app's life pays for
   it and should not be cut off half way through, having spent the credit without
   keeping the audio. */
export const config = { maxDuration: 30 };

const SUPABASE_URL = process.env.SUPABASE_URL;

/* A year, immutable. The path changes if the words or the voice ever do, so a
   stale copy cannot outlive the file it is a copy of. */
const CACHE_FOR_A_YEAR = 'public, max-age=31536000, immutable';

/* Per warm instance: the bytes once we have them, the one generation allowed to
   be in flight, and — if that generation failed — how long to leave the provider
   alone. A route anybody may call must not be able to turn one broken minute at
   ElevenLabs into a request per press. */
let cachedPreview = null;
let generating = null;
let nextAttemptAt = 0;
const RETRY_AFTER_FAILURE_MS = 60 * 1000;

async function loadPreview() {
  if (cachedPreview) return cachedPreview;

  /* The normal path, and the only one that ever runs after the first time: the
     file already exists, so read it and tell nobody at ElevenLabs about it. */
  const path = previewStoragePath();
  const stored = await readClip(path).catch((err) => {
    console.error('voice preview lookup failed', err);
    return null;
  });
  if (stored) { cachedPreview = stored; return cachedPreview; }

  if (generating) return generating;
  if (Date.now() < nextAttemptAt) {
    throw new VoiceProviderError('preview_unavailable', 'cooling down after a failed generation');
  }

  generating = (async () => {
    if (!isConfigured()) throw new VoiceProviderError('not_configured');
    const providerVoiceId = previewVoiceId();
    if (!providerVoiceId) throw new VoiceProviderError('invalid_voice', 'no Serenity in the catalogue');

    const audio = await synthesizeSpeech({ providerVoiceId, text: PREVIEW_TEXT, speed: PREVIEW_SPEED });
    /* Storing it is what makes this the last generation. If the bucket refuses,
       this request still gets its audio — the next one simply tries again, which
       is better than failing a preview over a write nobody is waiting on. */
    try { await uploadClip(path, audio); } catch (err) {
      console.error('could not store the voice preview', err);
    }
    cachedPreview = audio;
    return audio;
  })();

  try {
    return await generating;
  } catch (err) {
    nextAttemptAt = Date.now() + RETRY_AFTER_FAILURE_MS;
    throw err;
  } finally {
    generating = null;
  }
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!SUPABASE_URL) { res.status(500).json({ error: 'server_misconfigured' }); return; }

  let audio;
  try {
    audio = await loadPreview();
  } catch (err) {
    const code = err instanceof VoiceProviderError ? err.code : 'preview_unavailable';
    console.error('voice preview failed:', code, (err && err.detail) || (err && err.message) || err);
    /* Never cached: the page falls back to this device reading the line, and the
       next press should get the real thing as soon as there is one. */
    res.setHeader('Cache-Control', 'no-store');
    res.status(code === 'not_configured' ? 503 : 502).json({ error: code });
    return;
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', String(audio.length));
  res.setHeader('Cache-Control', CACHE_FOR_A_YEAR);
  if (req.method === 'HEAD') { res.status(200).end(); return; }
  res.status(200).send(audio);
}
