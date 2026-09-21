// /api/voice-clone.js
// Vercel serverless function — makes a copy of someone's voice from a sample,
// so their subliminals can be generated in their own voice without re-recording
// every line by hand.
//
// Saying affirmations out loud is still the practice, and the app says so. This
// is for the nights you want the session without the recording session.
//
// POST with a recorded sample -> creates the voice at the provider and stores its
// id against the signed-in Supabase user in user_voice_profiles. DELETE -> removes
// it again, at the provider, in the table, and every clip already generated in it.
//
// Two things this route will not do:
//   * clone without consent. The sample has to arrive with BOTH confirmation
//     sentences — x-voice-consent (this is my voice, and mine to use) and
//     x-voice-processing-consent (I agree to it being sent to ElevenLabs and
//     processed there) — matched exactly against the ones the page was given.
//     They are two questions because they are two different things to agree to.
//     Either one missing, no clone.
//   * clone twice. Somebody who already has a voice gets that voice back, for
//     free, unless they explicitly asked to replace it (x-voice-replace). Building
//     a subliminal must never create a second clone.
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   ELEVENLABS_API_KEY        - elevenlabs.io -> Profile -> API key (a paid plan
//                               is needed for voice cloning)
//   SUPABASE_URL              - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Settings -> API -> service_role key

import { applyCors } from '../lib/cors.js';
import { bearerToken, whoIsCalling, tierAtLeast, tierForUser } from '../lib/supabase-auth.js';
import { VoiceProviderError, createInstantVoiceClone, deleteVoice, isConfigured } from '../lib/elevenlabs.js';
import {
  consentGiven, deleteVoiceProfile, getVoiceProfile, processingConsentGiven, saveVoiceProfile,
} from '../lib/user-voices.js';
import { CLONE_TIER } from '../lib/voice-access.js';
import { deleteClipsForVoice } from '../lib/tts-store.js';

// The sample arrives as raw audio, not JSON; cloning at the provider can take
// most of a minute, so the function is given room to finish.
export const config = { api: { bodyParser: false }, maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;

// Enough for a minute or so of speech, which is all instant cloning needs.
const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;

const HTTP_FOR_CODE = {
  quota_exceeded: 429,
  rate_limited: 429,
  invalid_voice: 400,
  timeout: 504,
  network: 502,
  rejected: 422,
  provider_auth: 502,
  provider_failed: 502,
};

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

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!isConfigured()) {
    res.status(503).json({ error: 'not_configured', detail: 'Voice cloning is not switched on yet.' });
    return;
  }
  if (!SUPABASE_URL) { res.status(500).json({ error: 'server_misconfigured' }); return; }

  const user = await whoIsCalling(bearerToken(req));
  if (!user) { res.status(401).json({ error: 'not_signed_in' }); return; }

  if (req.method === 'DELETE') {
    const existing = await getVoiceProfile(user.id);
    const voiceId = existing && existing.provider_voice_id;
    await deleteVoice(voiceId);
    try {
      await deleteVoiceProfile(user.id);
      await deleteClipsForVoice(user.id, voiceId);
    } catch (e) {
      console.error('voice profile removal failed:', e);
      res.status(500).json({ error: 'removal_failed' });
      return;
    }
    res.status(200).json({ removed: true });
    return;
  }

  // Cloning your voice is the top of the range — it's the most expensive thing
  // the app does per person. Serenity and recording yourself are free; this one
  // is not, and lib/voice-access.js is where that is written down.
  const tier = await tierForUser(user.id);
  if (!tierAtLeast(tier, CLONE_TIER)) {
    res.status(403).json({ error: 'upgrade_required', detail: 'Cloning your voice comes with Ritual.' });
    return;
  }

  /* A voice of somebody's own is not something to create on a shrug. The page
     explains what it is and asks two separate things: that it is their voice and
     theirs to use, and that they agree to the recording going to ElevenLabs to
     be turned into one. Both arrive with the sample, and both are checked here
     against this server's own copy of the words. */
  if (!consentGiven(req.headers['x-voice-consent'])) {
    res.status(400).json({ error: 'consent_required' });
    return;
  }
  if (!processingConsentGiven(req.headers['x-voice-processing-consent'])) {
    res.status(400).json({ error: 'processing_consent_required' });
    return;
  }

  /* Already have one? Then that is the voice, and nothing is generated. Replacing
     it is a deliberate act ("Record it again"), not a side effect of building
     another subliminal. */
  const existing = await getVoiceProfile(user.id);
  const replacing = String(req.headers['x-voice-replace'] || '') === '1';
  if (existing && !replacing) {
    res.status(200).json({ reused: true, displayName: existing.display_name || 'Your AI Voice' });
    return;
  }

  let sample;
  try { sample = await readRawBody(req); }
  catch (e) {
    res.status(413).json({ error: 'sample_too_long' });
    return;
  }
  if (!sample || sample.length < 2048) {
    res.status(400).json({ error: 'sample_too_short' });
    return;
  }

  const contentType = req.headers['content-type'] || 'audio/webm';
  const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : contentType.includes('mpeg') ? 'mp3' : 'webm';

  try {
    // Replace rather than accumulate: one voice per person, always the latest.
    const previous = existing && existing.provider_voice_id;

    const voiceId = await createInstantVoiceClone({
      name: `subliminally-${user.id}`,
      description: 'Cloned from a Subliminally voice sample, with the speaker\'s confirmation.',
      sample,
      contentType,
      fileName: `sample.${ext}`,
    });

    await saveVoiceProfile({ userId: user.id, providerVoiceId: voiceId, displayName: 'Your AI Voice' });

    // Only bin the old one — and the audio read in it — once the new one is saved.
    if (previous && previous !== voiceId) {
      await deleteVoice(previous);
      await deleteClipsForVoice(user.id, previous);
    }

    res.status(200).json({ created: true, displayName: 'Your AI Voice' });
  } catch (err) {
    const code = err instanceof VoiceProviderError ? err.code : 'clone_failed';
    console.error('voice-clone error:', code, (err && err.detail) || (err && err.message) || err);
    res.status(HTTP_FOR_CODE[code] || 500).json({ error: code });
  }
}
