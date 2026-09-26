// Every call that needs ELEVENLABS_API_KEY goes through here.
//
// The key is read from the environment inside this module and never returned,
// logged or sent anywhere except api.elevenlabs.io — so no route has to handle it
// and there is one place to look to be sure it cannot reach the browser.
//
// The other job here is turning whatever the provider says into a *code*. The
// pages upstairs show their own words for 'quota' or 'invalid_voice'; they never
// print a provider error, which is either meaningless to the person reading it
// ("voice_not_found: 0xA...") or, worse, quotes part of our account back at them.

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const API_ROOT = 'https://api.elevenlabs.io/v1';

// Fast and cheap, and plenty for a line of affirmation read plainly.
export const MODEL_ID = 'eleven_turbo_v2_5';

// A minute of speech is generated in a few seconds. Past this something is wrong
// and waiting longer only holds the session open on a screen that says nothing.
const TTS_TIMEOUT_MS = 30000;
// Cloning has to give up before the function does (maxDuration 60s in
// api/voice-clone.js): a function killed mid-wait answers with a bare 504 and
// no log line saying what ElevenLabs was doing.
const CLONE_TIMEOUT_MS = 50000;

export function isConfigured() {
  return !!ELEVENLABS_API_KEY;
}

/* An error the routes can branch on. `code` is ours and stable; `detail` is for
   the server log only and is never handed to the browser. */
export class VoiceProviderError extends Error {
  constructor(code, detail, status) {
    super(code);
    this.code = code;
    this.detail = detail || '';
    this.status = status || 0;
  }
}

/* What the provider's HTTP status and body actually mean for us.
   402/429 are the two that cost money to ignore: the account is out of credits
   or being asked too fast, and retrying makes both worse. */
function classify(status, body) {
  const text = (body || '').toLowerCase();
  if (status >= 400 && status < 500) {
    // Things only voice cloning runs into. Each needs a different fix — ours, the
    // plan's, or a new recording — so each gets its own code.
    if (/voice_limit_reached|maximum amount of custom voices|voice limit/.test(text)) return 'voice_limit_reached';
    if (/captcha|verification|verify/.test(text)) return 'verification_required';
    if (status === 401 || status === 403) {
      return /instant_voice_cloning|voice_cloning|can_not_use|subscription|upgrade/.test(text) ? 'plan_not_allowed' : 'provider_auth';
    }
    if (status === 400 || status === 422) {
      if (/too short|too_short|audio_too_short|minimum duration/.test(text)) return 'sample_too_short';
      if (/invalid_file|invalid audio|audio file|corrupt|could not decode|unsupported|file format|codec/.test(text)) return 'unsupported_format';
    }
  }
  if (status === 401 || status === 403) return 'provider_auth';
  if (status === 402) return 'quota_exceeded';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'invalid_voice';
  if (status === 422) {
    if (text.includes('voice')) return 'invalid_voice';
    if (text.includes('quota') || text.includes('credit')) return 'quota_exceeded';
    return 'rejected';
  }
  if (text.includes('quota') || text.includes('credits')) return 'quota_exceeded';
  return 'provider_failed';
}

async function callProvider(path, init, timeoutMs) {
  if (!ELEVENLABS_API_KEY) throw new VoiceProviderError('not_configured');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      ...init,
      signal: abort.signal,
      headers: { ...(init.headers || {}), 'xi-api-key': ELEVENLABS_API_KEY },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw new VoiceProviderError('timeout', `timed out after ${timeoutMs}ms`);
    throw new VoiceProviderError('network', (err && err.message) || 'fetch failed');
  }
  clearTimeout(timer);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new VoiceProviderError(classify(res.status, detail), detail.slice(0, 400), res.status);
  }
  return res;
}

/* One line of speech, as mp3 bytes. Steady and unhurried: an affirmation read
   with performance in it is harder to absorb than one read plainly. The
   provider's usable speed range is roughly 0.7–1.2, so the pace from the builder
   is clamped rather than refused. */
export async function synthesizeSpeech({ providerVoiceId, text, speed }) {
  const res = await callProvider(`/text-to-speech/${encodeURIComponent(providerVoiceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.75,
        style: 0.1,
        use_speaker_boost: true,
        speed: clampSpeed(speed),
      },
    }),
  }, TTS_TIMEOUT_MS);
  return Buffer.from(await res.arrayBuffer());
}

export function clampSpeed(speed) {
  return Math.min(1.2, Math.max(0.7, Number(speed) || 1));
}

/* Instant Voice Cloning (POST /v1/voices/add, multipart/form-data): one sample
   in, one voice id out, usable straight away — no training step to wait for.
   Professional Voice Cloning is a different endpoint and is never used here. */
export async function createInstantVoiceClone({ name, description, sample, contentType, fileName }) {
  const form = new FormData();
  form.append('name', name);
  form.append('files', new Blob([sample], { type: contentType }), fileName);
  if (description) form.append('description', description);
  const started = Date.now();
  let res;
  try {
    res = await callProvider('/voices/add', { method: 'POST', body: form }, CLONE_TIMEOUT_MS);
  } catch (err) {
    console.error('ElevenLabs /voices/add failed:', err.code, 'HTTP', err.status || '(no response)',
      'body:', err.detail || '', `after ${Date.now() - started}ms`, { bytes: sample.length, contentType });
    throw err;
  }
  const text = await res.text().catch(() => '');
  let created = null;
  try { created = JSON.parse(text); } catch (e) { /* reported below */ }
  if (!created || !created.voice_id) {
    console.error('ElevenLabs /voices/add answered', res.status, 'without a voice_id:', text.slice(0, 400));
    throw new VoiceProviderError('rejected', 'no voice_id in response', res.status);
  }
  console.log('ElevenLabs /voices/add ok', res.status, `in ${Date.now() - started}ms`,
    created.requires_verification ? '(requires_verification)' : '');
  return created.voice_id;
}

/* Best effort: a voice left behind at the provider should never fail a request
   the person asked for. */
export async function deleteVoice(providerVoiceId) {
  if (!providerVoiceId || !ELEVENLABS_API_KEY) return;
  try {
    await callProvider(`/voices/${encodeURIComponent(providerVoiceId)}`, { method: 'DELETE' }, TTS_TIMEOUT_MS);
  } catch (err) {
    console.error('could not delete provider voice', providerVoiceId, err.code || err);
  }
}
