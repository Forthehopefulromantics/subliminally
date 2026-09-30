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
import { VoiceProviderError, createInstantVoiceClone, deleteVoice, findClonesNamed, isConfigured, maskVoiceId } from '../lib/elevenlabs.js';
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

/* The route has 60s (maxDuration) and nothing after that — Vercel stops the
   function mid-await and the page gets a bare 504 with no log line saying which
   step it was on. So every step works inside one budget, and the ElevenLabs call
   is given whatever is left of it rather than a fixed 50s on top of the body and
   the transcode. */
const FUNCTION_BUDGET_MS = 55000;
// Below this there is no point starting a clone: it would be cut off half made.
const MIN_CLONE_MS = 15000;
// A save that fails is tried again before giving up — the voice already exists.
const SAVE_ATTEMPTS = 3;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!isConfigured()) {
    console.error('voice-clone: ELEVENLABS_API_KEY is not set in this environment');
    res.status(503).json({ error: 'not_configured', detail: 'Voice cloning is not switched on yet.' });
    return;
  }
  if (!SUPABASE_URL) { res.status(500).json({ error: 'server_misconfigured' }); return; }

  if (req.method === 'DELETE') { await removeVoice(req, res); return; }

  /* One id per request on every line, so a single attempt can be followed from
     start to finish in the Vercel log. Nothing secret is ever logged: no key, no
     token, no audio — sizes, types, durations, statuses and a shortened voice id. */
  const rid = Math.random().toString(36).slice(2, 8);
  const started = Date.now();
  const log = (...a) => console.log(`voice-clone[${rid}] +${Date.now() - started}ms`, ...a);
  const fail = (...a) => console.error(`voice-clone[${rid}] +${Date.now() - started}ms`, ...a);
  const answer = (status, body) => {
    log('13 response returned to frontend:', status, body.error || (body.created ? 'created' : body.reused ? 'reused' : ''));
    res.status(status).json(body);
  };

  log('1 clone request started', { contentLength: req.headers['content-length'] || null,
    contentType: String(req.headers['content-type'] || '').split(';')[0], replacing: req.headers['x-voice-replace'] === '1' });

  try {
    await cloneVoice(req, { log, fail, answer, started });
  } catch (err) {
    /* Anything not handled below still ends the request with an answer the page
       can show, never a function that dies without one. */
    fail('clone failed unexpectedly:', (err && err.stack) || err);
    if (!res.headersSent) answer(500, { error: 'clone_failed' });
  }
}

async function cloneVoice(req, { log, fail, answer, started }) {
  const user = await whoIsCalling(bearerToken(req));
  if (!user) { answer(401, { error: 'not_signed_in' }); return; }

  /* Cloning your voice is the most expensive thing the app does per person, so
     the gate is here — before the sample is read off the wire and before
     anything reaches ElevenLabs. A free account cannot start a clone by calling
     this route directly.

     Same premium definition as /api/tts, from one place, so the two can never
     drift into disagreeing about who may spend credits. */
  const tier = await tierForUser(user.id);
  if (!hasPremiumAccess(tier)) {
    answer(403, { error: 'upgrade_required', detail: 'Cloning your voice comes with Ritual.' });
    return;
  }

  /* A voice of somebody's own is not something to create on a shrug. The page
     explains what it is and asks them to confirm it is their voice and theirs to
     use; this is that confirmation arriving with the sample. */
  if (!consentGiven(req.headers['x-voice-consent'])) {
    answer(400, { error: 'consent_required' });
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
    log('user already has a saved voice — reusing it, nothing sent to ElevenLabs', maskVoiceId(existing.provider_voice_id));
    answer(200, { reused: true, displayName: existing.display_name || 'My voice' });
    return;
  }
  const previous = existing && existing.provider_voice_id;
  const voiceName = `subliminally-${user.id}`;

  let raw;
  try { raw = await readRawBody(req); }
  catch (e) {
    const reason = (e && e.message) || String(e);
    fail('sample not received:', reason);
    if (reason === 'too_large') answer(413, { error: 'sample_too_long' });
    else answer(408, { error: 'sample_not_received' });
    return;
  }
  const declared = req.headers['content-type'] || '';

  let upload;
  try { upload = await unpackSample(raw, declared, req.headers['x-voice-filename']); }
  catch (e) {
    fail('upload could not be read:', (e && e.message) || e, { bytes: raw.length, declared: declared.split(';')[0] });
    answer(400, { error: 'upload_malformed' });
    return;
  }
  log('2 audio received by backend', { bytes: upload.bytes.length, fileType: upload.type || '(none)', fileName: upload.name || '(none)' });

  /* Whatever arrived becomes 16-bit PCM WAV here, before anything is measured or
     sent. The page normally sends WAV already; anything else — an older iPhone
     build posting Safari's AAC/MP4 as recorded, or a recording or file the device
     could not decode — is transcoded with ffmpeg rather than refused. */
  let sample;
  try { sample = await normalizeSample(upload); }
  catch (e) {
    const code = e instanceof TranscodeError ? e.code : 'unsupported_format';
    fail('sample could not be converted:', code, (e && e.detail) || (e && e.message) || e,
      { bytes: upload.bytes.length, fileType: upload.type, fileName: upload.name });
    answer(HTTP_FOR_CODE[code] || 415, { error: code });
    return;
  }

  /* The length is checked here, on the audio, not taken from the page's timer. */
  const checked = checkVoiceSample(sample.wav);
  log('3 audio duration:', `${Number(checked.seconds || 0).toFixed(1)}s`, { voicedSeconds: checked.voicedSeconds });
  log('4 audio file size:', `${upload.bytes.length} bytes received`, `${sample.wav.length} bytes WAV sent on`);
  log('5 audio MIME type:', upload.type || '(none)', '→', 'audio/wav', `(${sample.source})`);
  if (!checked.ok) {
    fail('sample rejected:', checked.code, checked.detail);
    answer(HTTP_FOR_CODE[checked.code] || 400, { error: checked.code });
    return;
  }
  const wav = sample.wav;

  /* Before making a voice, look for one this person already has at ElevenLabs
     that never reached the table: a previous attempt that ElevenLabs finished
     but that failed after (the save, or the function being stopped). That voice
     is used, not a second one made on every Try Again. */
  let voiceId = null;
  let recovered = false;
  const found = await findClonesNamed(voiceName);
  /* When replacing, only a clone made after the current voice was saved can be
     the unsaved result of this replacement; anything older is a leftover. */
  const since = existing ? Date.parse(existing.consent_at || existing.created_at) || 0 : 0;
  const orphans = (found || []).filter(v => v.voice_id !== previous && (!since || v.created * 1000 > since));
  if (found === null) log('could not check ElevenLabs for an earlier clone (lookup failed) — continuing');
  else log('earlier clones at ElevenLabs not saved to the account:', orphans.length);
  if (orphans.length) {
    voiceId = orphans[0].voice_id;
    recovered = true;
    log('recovering the clone an earlier attempt made instead of creating another', maskVoiceId(voiceId));
    // Any further strays are duplicates nobody can use; tidy them away.
    for (const extra of orphans.slice(1)) await deleteVoice(extra.voice_id);
  }

  if (!voiceId) {
    const left = FUNCTION_BUDGET_MS - (Date.now() - started);
    if (left < MIN_CLONE_MS) {
      fail('not enough time left to clone safely', { leftMs: left });
      answer(504, { error: 'timeout' });
      return;
    }
    try {
      voiceId = await createInstantVoiceClone({
        name: voiceName,
        description: 'Cloned from a Subliminally voice sample, with the speaker\'s confirmation.',
        sample: wav,
        contentType: 'audio/wav',
        fileName: 'sample.wav',
        timeoutMs: left - 3000,   // room to save and answer after
        log: (...a) => log(...a),
      });
    } catch (err) {
      const code = err instanceof VoiceProviderError ? err.code : 'clone_failed';
      // The provider's own HTTP status and body, so the real reason is in the log.
      fail('ElevenLabs error:', code, 'HTTP', (err && err.status) || '(no response)',
        'body:', ((err && err.detail) || (err && err.message) || String(err)).slice(0, 400));
      answer(HTTP_FOR_CODE[code] || 500, { error: code });
      return;
    }
  }
  log('10 voice_id received:', maskVoiceId(voiceId), recovered ? '(recovered from an earlier attempt)' : '(new)');

  /* The save is retried, and a voice that still cannot be saved is left at
     ElevenLabs on purpose: the next Try Again finds it above and saves that,
     rather than making another. */
  let saved = false;
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS && !saved; attempt++) {
    log('11 Supabase save started', { table: 'user_voice_profiles', attempt });
    try {
      await saveVoiceProfile({ userId: user.id, providerVoiceId: voiceId, displayName: 'My voice', consentAt });
      saved = true;
      log('12 Supabase save succeeded');
    } catch (saveErr) {
      fail('12 Supabase save failed:', (saveErr && saveErr.message) || saveErr);
      if (attempt < SAVE_ATTEMPTS) await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
  if (!saved) {
    fail('voice kept at ElevenLabs so the next attempt can recover it', maskVoiceId(voiceId));
    answer(500, { error: 'save_failed' });
    return;
  }

  // Only bin the old one — and the audio read in it — once the new one is saved.
  if (previous && previous !== voiceId) {
    await deleteVoice(previous);
    await deleteClipsForVoice(user.id, previous);
  }

  answer(200, { created: true, recovered, displayName: 'My voice' });
}

/* DELETE sits above the premium gate on purpose, and it is the one path here
   that can reach ElevenLabs without a paid plan.

   It removes a voice, it never creates one, so it cannot spend credits — and
   gating it would strand the cloned voice of anybody whose subscription
   lapsed, at the provider, with no way to remove it. The privacy policy says a
   voice is deleted at ElevenLabs when its owner asks; a paywall in front of
   that would make us wrong. It only does anything at all for somebody who
   already has a voice, which means they were premium when it was created. */
async function removeVoice(req, res) {
  const user = await whoIsCalling(bearerToken(req));
  if (!user) { res.status(401).json({ error: 'not_signed_in' }); return; }
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
