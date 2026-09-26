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
//   * clone without consent. The sample has to arrive with the confirmation
//     sentence in x-voice-consent, matched exactly against the one the page was
//     given. No sentence, no clone.
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
import { bearerToken, whoIsCalling, tierForUser, hasPremiumAccess } from '../lib/supabase-auth.js';
import { VoiceProviderError, createInstantVoiceClone, deleteVoice, isConfigured } from '../lib/elevenlabs.js';
import { consentGiven, deleteVoiceProfile, getVoiceProfile, saveVoiceProfile } from '../lib/user-voices.js';
import { deleteClipsForVoice } from '../lib/tts-store.js';
import { checkVoiceSample, parseWav } from '../lib/voice-sample.js';
import { TranscodeError, sniffContainer, transcodeToWav } from '../lib/audio-transcode.js';

// The sample arrives as audio (multipart or raw), not JSON; cloning at the provider can take
// most of a minute, so the function is given room to finish.
export const config = { api: { bodyParser: false }, maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;

// Vercel refuses a request body over 4.5 MB before this function ever runs. The
// page sends at most 90 seconds of 22.05 kHz mono WAV (~4 MB), or a recording or
// file in its own format when the device could not convert it (a minute or two
// of AAC is well under this), so this is a ceiling that is actually reachable,
// not a promise the platform will break.
const MAX_SAMPLE_BYTES = 4.4 * 1024 * 1024;

const HTTP_FOR_CODE = {
  quota_exceeded: 429,
  rate_limited: 429,
  invalid_voice: 400,
  timeout: 504,
  network: 502,
  rejected: 422,
  provider_auth: 502,
  provider_failed: 502,
  plan_not_allowed: 502,
  voice_limit_reached: 502,
  verification_required: 422,
  unsupported_format: 415,
  sample_too_short: 400,
  sample_silent: 400,
  sample_empty: 400,
  sample_no_audio: 422,
  upload_malformed: 400,
  transcode_unavailable: 503,
  save_failed: 500,
};

/* A body that stops arriving must not hold the function open until Vercel kills
   it at 60s with a bare 504 — that looks exactly like a hang from the page. */
const BODY_TIMEOUT_MS = 20000;

function readRawBody(req) {
  // Some runtimes hand the body over already read; use it rather than wait on a
  // stream that will never emit.
  let pre = null;
  try { pre = req.body; } catch (e) { pre = null; }   // Vercel's body getter can throw on odd input
  if (Buffer.isBuffer(pre)) {
    return pre.length > MAX_SAMPLE_BYTES ? Promise.reject(new Error('too_large')) : Promise.resolve(pre);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => { reject(new Error('body_timeout')); req.destroy(); }, BODY_TIMEOUT_MS);
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_SAMPLE_BYTES) { clearTimeout(timer); reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
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

  /* DELETE sits above the premium gate on purpose, and it is the one path here
     that can reach ElevenLabs without a paid plan.

     It removes a voice, it never creates one, so it cannot spend credits — and
     gating it would strand the cloned voice of anybody whose subscription
     lapsed, at the provider, with no way to remove it. The privacy policy says a
     voice is deleted at ElevenLabs when its owner asks; a paywall in front of
     that would make us wrong. It only does anything at all for somebody who
     already has a voice, which means they were premium when it was created. */
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

  /* Cloning your voice is the most expensive thing the app does per person, so
     the gate is here — before the sample is read off the wire and before
     anything reaches ElevenLabs. A free account cannot start a clone by calling
     this route directly.

     Same premium definition as /api/tts, from one place, so the two can never
     drift into disagreeing about who may spend credits. */
  const tier = await tierForUser(user.id);
  if (!hasPremiumAccess(tier)) {
    res.status(403).json({ error: 'upgrade_required', detail: 'Cloning your voice comes with Ritual.' });
    return;
  }

  /* A voice of somebody's own is not something to create on a shrug. The page
     explains what it is and asks them to confirm it is their voice and theirs to
     use; this is that confirmation arriving with the sample. */
  if (!consentGiven(req.headers['x-voice-consent'])) {
    res.status(400).json({ error: 'consent_required' });
    return;
  }
  // The moment the confirmation reached us, stored with the voice it allowed.
  const consentAt = new Date().toISOString();

  /* Already have one? Then that is the voice, and nothing is generated. Replacing
     it is a deliberate act ("Record it again"), not a side effect of building
     another subliminal. */
  const existing = await getVoiceProfile(user.id);
  const replacing = String(req.headers['x-voice-replace'] || '') === '1';
  if (existing && !replacing) {
    res.status(200).json({ reused: true, displayName: existing.display_name || 'My voice' });
    return;
  }

  let raw;
  try { raw = await readRawBody(req); }
  catch (e) {
    const reason = (e && e.message) || String(e);
    console.error('voice-clone: sample not received', user.id, reason);
    if (reason === 'too_large') res.status(413).json({ error: 'sample_too_long' });
    else res.status(408).json({ error: 'sample_not_received' });
    return;
  }
  const declared = req.headers['content-type'] || '';

  let upload;
  try { upload = await unpackSample(raw, declared, req.headers['x-voice-filename']); }
  catch (e) {
    console.error('voice-clone: upload could not be read', user.id, (e && e.message) || e, { bytes: raw.length, declared });
    res.status(400).json({ error: 'upload_malformed' });
    return;
  }
  console.log('voice-clone: sample received', user.id,
    { bytes: upload.bytes.length, declared, fileType: upload.type, fileName: upload.name, replacing });

  /* Whatever arrived becomes 16-bit PCM WAV here, before anything is measured or
     sent. The page normally sends WAV already; anything else — an older iPhone
     build posting Safari's AAC/MP4 as recorded, or a recording or file the device
     could not decode — is transcoded with ffmpeg rather than refused. */
  let sample;
  try { sample = await normalizeSample(upload); }
  catch (e) {
    const code = e instanceof TranscodeError ? e.code : 'unsupported_format';
    console.error('voice-clone: sample could not be converted', user.id, code, (e && e.detail) || (e && e.message) || e,
      { bytes: upload.bytes.length, declared, fileType: upload.type, fileName: upload.name });
    res.status(HTTP_FOR_CODE[code] || 415).json({ error: code });
    return;
  }

  /* The length is checked here, on the audio, not taken from the page's timer. */
  const checked = checkVoiceSample(sample.wav);
  if (!checked.ok) {
    console.error('voice-clone: sample rejected', user.id, checked.code, checked.detail,
      { bytes: sample.wav.length, source: sample.source, declared });
    res.status(HTTP_FOR_CODE[checked.code] || 400).json({ error: checked.code });
    return;
  }
  console.log('voice-clone: sample ok', user.id, { ...checked, source: sample.source });
  const wav = sample.wav;

  try {
    // Replace rather than accumulate: one voice per person, always the latest.
    const previous = existing && existing.provider_voice_id;

    const voiceId = await createInstantVoiceClone({
      name: `subliminally-${user.id}`,
      description: 'Cloned from a Subliminally voice sample, with the speaker\'s confirmation.',
      sample: wav,
      contentType: 'audio/wav',
      fileName: 'sample.wav',
    });
    console.log('voice-clone: ElevenLabs returned a voice', user.id, voiceId);

    /* A voice that cannot be recorded against its owner is a voice nobody can
       use or remove, so it does not stay at the provider either. */
    try {
      await saveVoiceProfile({ userId: user.id, providerVoiceId: voiceId, displayName: 'My voice', consentAt });
      console.log('voice-clone: voice saved to user_voice_profiles', user.id);
    } catch (saveErr) {
      console.error('voice-clone error: save_failed', (saveErr && saveErr.message) || saveErr);
      await deleteVoice(voiceId);
      res.status(500).json({ error: 'save_failed' });
      return;
    }

    // Only bin the old one — and the audio read in it — once the new one is saved.
    if (previous && previous !== voiceId) {
      await deleteVoice(previous);
      await deleteClipsForVoice(user.id, previous);
    }

    res.status(200).json({ created: true, displayName: 'My voice' });
  } catch (err) {
    const code = err instanceof VoiceProviderError ? err.code : 'clone_failed';
    // The provider's own HTTP status and body, so the real reason is in the log.
    console.error('voice-clone error:', code, 'ElevenLabs status:', err && err.status,
      'ElevenLabs body:', (err && err.detail) || (err && err.message) || err,
      { bytes: wav.length, seconds: checked.seconds, source: sample.source, declared });
    res.status(HTTP_FOR_CODE[code] || 500).json({ error: code });
  }
}

/* The sample and what the sender said it was. The page sends multipart/form-data
   with the audio in a `sample` file field (named with the extension that matches
   its type); an older build sends the audio as the whole body, typed by
   Content-Type. Both are read. */
async function unpackSample(raw, declared, headerName) {
  if (/^multipart\/form-data/i.test(declared)) {
    const form = await new Request('http://voice-clone.local/', {
      method: 'POST', headers: { 'content-type': declared }, body: raw,
    }).formData();
    const file = form.get('sample');
    if (!file || typeof file === 'string') throw new Error('no sample file field');
    return { bytes: Buffer.from(await file.arrayBuffer()), type: file.type || '', name: file.name || '' };
  }
  return { bytes: raw, type: declared.split(';')[0].trim(), name: typeof headerName === 'string' ? headerName.slice(0, 200) : '' };
}

const EXT_FOR_TYPE = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/x-caf': 'caf', 'video/3gpp': '3gp', 'audio/3gpp': '3gp',
};

// M4A, MP4 and MOV are the same container; calling one the other is not a mismatch.
const sameFamily = (a, b) => a === b || (['m4a', 'mp4', 'mov', '3gp'].includes(a) && ['m4a', 'mp4', 'mov', '3gp'].includes(b));

/* { wav, source } — the sample as PCM WAV, and how it got that way (for the log). */
async function normalizeSample({ bytes, type, name }) {
  if (!bytes || bytes.length < 1024) throw new TranscodeError('sample_empty', `${bytes ? bytes.length : 0} bytes`);
  if (parseWav(bytes)) return { wav: bytes, source: 'wav' };
  // What the bytes are beats what they were called; the name and type are the fallback.
  const sniffed = sniffContainer(bytes);
  const fromName = (/\.([a-z0-9]{1,5})$/i.exec(name || '') || [])[1];
  const ext = (sniffed && sniffed.ext) || (fromName && fromName.toLowerCase()) || EXT_FOR_TYPE[(type || '').toLowerCase()] || 'bin';
  if (sniffed && type && EXT_FOR_TYPE[type.toLowerCase()] && !sameFamily(EXT_FOR_TYPE[type.toLowerCase()], sniffed.ext)) {
    console.warn('voice-clone: declared type does not match the bytes', { declared: type, actual: sniffed.type, name });
  }
  const wav = await transcodeToWav(bytes, { ext });
  return { wav, source: `transcoded from ${(sniffed && sniffed.type) || type || 'unknown'} (.${ext})` };
}
