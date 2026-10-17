// What went wrong with generated speech, kept so it can be acted on.
//
// A row says WHAT failed and WHERE (a code, a stage, an HTTP status, how many
// attempts were made) and never WHO SAID WHAT: no affirmation text, no audio, no
// provider response body, no key. The user id is kept so one person's repeated
// failure can be told from a platform-wide one, and it goes null with the
// account (on delete set null).
//
// Repeated failures send one email to the admin, at most once an hour, saying
// which codes are failing and what to do about each — see ACTIONS below.

import { serviceHeaders } from './supabase-auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_TO = 'hello@subliminallybyfthr.com';
const NOTIFY_FROM = 'Subliminally <notifications@subliminallybyfthr.com>';

// This many failures inside this window is "repeated" rather than "one bad moment".
export const ALERT_THRESHOLD = 5;
export const ALERT_WINDOW_MINUTES = 30;
const ALERT_COOLDOWN_MINUTES = 60;

/* Short, and from a closed set: whatever the browser or provider sends is mapped
   onto these before it is stored, so a row can never carry free text. */
const CODES = new Set([
  'quota_exceeded', 'rate_limited', 'provider_auth', 'not_configured', 'timeout', 'network',
  'provider_failed', 'rejected', 'invalid_voice', 'bad_audio', 'upload_failed', 'index_failed',
  'stale_clip', 'generation_failed', 'audio_unreachable', 'audio_empty', 'audio_undecodable',
  'audio_silent', 'playback_failed', 'too_fast', 'hourly_limit', 'daily_limit',
]);
const STAGES = new Set(['generate', 'upload', 'sign', 'verify', 'playback', 'prepare']);

export function safeCode(code) { return CODES.has(code) ? code : 'generation_failed'; }
export function safeStage(stage) { return STAGES.has(stage) ? stage : 'prepare'; }

const ACTIONS = {
  quota_exceeded: 'ElevenLabs is out of credits or characters. Top up or upgrade the ElevenLabs plan.',
  provider_auth: 'ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY in Vercel and redeploy.',
  not_configured: 'ELEVENLABS_API_KEY is not set in this deployment.',
  rate_limited: 'ElevenLabs is rate limiting us (concurrency or requests per minute). Check the plan limits.',
  timeout: 'ElevenLabs is slow or timing out. Check status.elevenlabs.io.',
  network: 'The function cannot reach ElevenLabs. Check status.elevenlabs.io and Vercel egress.',
  provider_failed: 'ElevenLabs is returning 5xx. Check status.elevenlabs.io.',
  bad_audio: 'ElevenLabs answered 200 with something that is not audio. Check status.elevenlabs.io.',
  upload_failed: 'Writing to the tts-cache bucket failed. Check Supabase Storage status and the service role key.',
  index_failed: 'Writing tts_clips failed. Check Supabase and that the migrations have been applied.',
  stale_clip: 'Cached rows pointed at missing audio and were regenerated. Check nobody emptied tts-cache.',
  invalid_voice: 'The Serenity voice id is not accepted by ElevenLabs. Check lib/voices.js.',
  audio_unreachable: 'Browsers cannot download signed tts-cache links. Check bucket policy and signed URL expiry.',
  audio_empty: 'Browsers are downloading empty or truncated clips from tts-cache.',
  audio_undecodable: 'Browsers cannot decode stored clips. Check the stored mp3s.',
  audio_silent: 'Stored clips decode to silence. Check the ElevenLabs voice and the stored mp3s.',
  playback_failed: 'Clips verified but then failed to play. Likely a device/browser issue.',
};

async function rest(path, init) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, init);
}

/* Fire-and-forget safe: a diagnostics failure must never fail the request it is
   describing. Resolves to true when the row was written. */
export async function recordFailure({ userId, voiceKey, code, stage, httpStatus, attempts, source }) {
  try {
    const res = await rest('tts_failures', {
      method: 'POST',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        user_id: userId || null,
        voice_key: typeof voiceKey === 'string' ? voiceKey.slice(0, 24) : null,
        code: safeCode(code),
        stage: safeStage(stage),
        http_status: Number.isFinite(httpStatus) ? httpStatus : null,
        attempts: Number.isFinite(attempts) ? attempts : null,
        source: source === 'client' ? 'client' : 'server',
      }),
    });
    if (!res.ok) { console.error('could not record tts failure', res.status); return false; }
    return true;
  } catch (e) {
    console.error('could not record tts failure', e && e.message);
    return false;
  }
}

/* Called after failures were recorded. Sends at most one email per cooldown, and
   only when the failures inside the window reach the threshold. Returns what it
   did, for the log and the tests. */
export async function maybeAlertAdmin() {
  try {
    const since = new Date(Date.now() - ALERT_WINDOW_MINUTES * 60000).toISOString();
    const res = await rest(`tts_failures?created_at=gte.${since}&select=id,user_id,code,source,alerted&order=created_at.desc&limit=500`,
      { headers: serviceHeaders() });
    if (!res.ok) return 'unreadable';
    const rows = await res.json();
    if (!rows || rows.length < ALERT_THRESHOLD) return 'below_threshold';
    const cooldownStart = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60000).toISOString();
    const recent = await rest(`tts_failures?alerted=is.true&created_at=gte.${cooldownStart}&select=id&limit=1`, { headers: serviceHeaders() });
    if (recent.ok && (await recent.json()).length) return 'cooling_down';
    if (!RESEND_API_KEY) { console.error('TTS ALERT (no RESEND_API_KEY):', rows.length, 'failures in', ALERT_WINDOW_MINUTES, 'min'); return 'no_mailer'; }

    const byCode = {};
    rows.forEach((r) => { byCode[r.code] = (byCode[r.code] || 0) + 1; });
    const people = new Set(rows.map((r) => r.user_id).filter(Boolean)).size;
    const lines = Object.entries(byCode).sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `<li><strong>${code}</strong> × ${n} — ${ACTIONS[code] || 'See the function logs.'}</li>`).join('');
    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        subject: `Serenity voice is failing (${rows.length} failures in ${ALERT_WINDOW_MINUTES} min)`,
        html: `<div style="font-family:sans-serif;max-width:560px"><h2>Serenity voice failures</h2>
          <p>${rows.length} failures in the last ${ALERT_WINDOW_MINUTES} minutes, affecting ${people} account(s).</p>
          <ul>${lines}</ul>
          <p>Rows: <code>select * from tts_failures order by created_at desc</code> in Supabase. They hold codes, never affirmation text.</p></div>`,
      }),
    });
    if (!send.ok) { console.error('tts alert email failed', send.status); return 'send_failed'; }
    // Mark the newest row so the cooldown query finds it.
    await rest(`tts_failures?id=eq.${rows[0].id}`, {
      method: 'PATCH', headers: serviceHeaders({ Prefer: 'return=minimal' }), body: JSON.stringify({ alerted: true }),
    }).catch(() => {});
    return 'sent';
  } catch (e) {
    console.error('tts alert check failed', e && e.message);
    return 'error';
  }
}
