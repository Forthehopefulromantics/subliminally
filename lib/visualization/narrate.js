// Visualization — making Serenity read one story, once.
//
// This is the only code in the feature that spends text-to-speech credits, and
// it is written so that spending them twice for the same words is not something
// a caller can do by accident:
//
//   * a narration that already matches the script is returned, not regenerated;
//   * a script that has changed is only narrated again when the person said so
//     (`replace: true`) — never because they replayed, retuned or reopened it;
//   * the daily allowance is read off a ledger of finished narrations, so a
//     failed attempt costs nothing, and is checked again after the attempt is
//     opened so two requests racing cannot both pass;
//   * the database allows one attempt in flight per person and per story, so a
//     double tap, a second tab or a retry mid-generation is refused;
//   * the old audio stays where it is until the new audio has been saved.

import { resolvePresetVoice } from '../voices.js';
import { hasPremiumAccess, tierForUser } from '../supabase-auth.js';
import { VoiceProviderError, isConfigured, synthesizeSpeech } from '../elevenlabs.js';
import {
  MAX_SCRIPT_CHARS, MAX_SCRIPT_WORDS, NARRATION_BITRATE_KBPS, NARRATION_MODEL_ID, NARRATION_TIMEOUT_MS,
  NARRATION_VOICE_KEY, NARRATION_VOICE_SETTINGS, NARRATION_MAX_SECONDS,
  countWords, localDayWindow, normalizeScript, speechTextFor,
} from './config.js';
import {
  closeAttempt, dailyNarrationLimit, getVisualization, narrationPathFor, narrationsSince,
  openAttempt, removeNarrationFiles, saveNarration, savedFaith, signNarrationUrl, uploadNarration,
} from './store.js';

const HTTP_FOR_CODE = {
  quota_exceeded: 503, rate_limited: 503, provider_auth: 502, not_configured: 503,
  timeout: 504, network: 502, rejected: 502, provider_failed: 502, invalid_voice: 502,
};

/* How much the person has used and may still use today, for the screens that
   say so. `resetsAt` is their own next midnight. */
export async function narrationUsage(userId, tz) {
  const [limit, window] = await Promise.all([dailyNarrationLimit(), Promise.resolve(localDayWindow(tz))]);
  const used = await narrationsSince(userId, window.start.toISOString());
  return { limit, used, remaining: Math.max(0, limit - used), resetsAt: window.end.toISOString(), timeZone: window.zone };
}

export function narrationInfo(row, url) {
  if (!row || !row.narration_path) return null;
  return {
    path: row.narration_path,
    url: url || null,
    scriptHash: row.narration_script_hash,
    generatedAt: row.narration_generated_at,
    durationSeconds: row.narration_duration_seconds == null ? null : Number(row.narration_duration_seconds),
  };
}

const fail = (status, error, extra) => ({ status, json: { error, ...(extra || {}) } });

/* body: { id, replace?, tz? } */
export async function narrateVisualization(user, body) {
  const id = body && body.id;
  const tz = body && body.tz;

  // Serenity is a studio voice, and every studio voice is a paid feature. The
  // check is here, on the route, and not in the button that hides itself.
  const tier = await tierForUser(user.id);
  if (!hasPremiumAccess(tier)) return fail(403, 'upgrade_required', { detail: 'Serenity comes with Ritual.' });
  if (!isConfigured()) return fail(503, 'not_configured');

  const row = await getVisualization(user.id, id);
  if (!row) return fail(404, 'not_found');

  const script = normalizeScript(row.script);
  if (!script || !row.script_hash) return fail(400, 'no_script');
  const words = countWords(script);
  if (words > MAX_SCRIPT_WORDS || script.length > MAX_SCRIPT_CHARS) {
    return fail(400, 'too_long', { words, maxWords: MAX_SCRIPT_WORDS });
  }

  const hasNarration = !!row.narration_path && row.narration_status === 'ready';

  /* The audio already matches the words. Nothing to generate and nothing to
     charge — this is what a double tap, a re-render or a stale tab lands on. */
  if (hasNarration && row.narration_script_hash === row.script_hash) {
    const url = await signNarrationUrl(row.narration_path);
    return { status: 200, json: { alreadyCurrent: true, narration: narrationInfo(row, url), usage: await narrationUsage(user.id, tz) } };
  }

  /* The words have changed since the audio was made. The old narration stays
     until the person has said, in so many words, that it should be replaced. */
  if (hasNarration && body.replace !== true) {
    return fail(409, 'confirm_replace', { detail: 'Your story has changed. Updating the narration uses another narration generation.' });
  }

  const usage = await narrationUsage(user.id, tz);
  if (usage.remaining <= 0) return fail(429, 'daily_limit', { usage });

  const voice = resolvePresetVoice(NARRATION_VOICE_KEY);
  if (!voice) return fail(500, 'server_misconfigured');

  const opened = await openAttempt({
    userId: user.id, visualizationId: row.id, scriptHash: row.script_hash, characterCount: script.length,
  });
  if (opened.conflict) return fail(409, 'already_generating');

  /* The count is read again with the attempt open. Two requests for two
     different stories can both pass the check above in the same instant; the
     database lets only one attempt be open per person, and this is where the
     one that lost finds out. */
  const recount = await narrationsSince(user.id, localDayWindow(tz).start.toISOString());
  if (recount >= usage.limit) {
    await closeAttempt(opened.id, 'failed', 'limit_race');
    return fail(429, 'daily_limit', { usage: { ...usage, used: recount, remaining: 0 } });
  }

  const path = narrationPathFor(user.id, row.id, row.script_hash);
  let audio;
  try {
    audio = await synthesizeSpeech({
      providerVoiceId: voice.providerVoiceId,
      text: speechTextFor(script),
      modelId: NARRATION_MODEL_ID,
      voiceSettings: NARRATION_VOICE_SETTINGS,
      timeoutMs: NARRATION_TIMEOUT_MS,
    });
    if (!audio || !audio.length) throw new VoiceProviderError('provider_failed', 'empty audio');
    await uploadNarration(path, audio);
  } catch (err) {
    const code = err instanceof VoiceProviderError ? err.code : 'provider_failed';
    console.error('visualization narration failed:', code, (err && err.detail) || (err && err.message) || err);
    await closeAttempt(opened.id, 'failed', code);
    return fail(HTTP_FOR_CODE[code] || 502, 'narration_failed', { code });
  }

  /* What is stored is the hash the audio was made from — the one read when the
     attempt began — so a story edited mid-generation is correctly shown as
     needing an update instead of being silently marked current. */
  const durationSeconds = Math.min(NARRATION_MAX_SECONDS, Math.round((audio.length * 8) / (NARRATION_BITRATE_KBPS * 1000)));
  const previousPath = hasNarration ? row.narration_path : null;
  const faith = await savedFaith(user.id);
  const saved = await saveNarration(user.id, row.id, {
    narration_path: path,
    narration_script_hash: row.script_hash,
    narration_generated_at: new Date().toISOString(),
    narration_duration_seconds: durationSeconds,
    narration_status: 'ready',
    faith_used: faith.faith || row.faith_used || null,
  });
  if (!saved) {
    // The audio exists but nothing points at it: do not charge for it, and do not leave it.
    await closeAttempt(opened.id, 'failed', 'save_failed');
    if (path !== previousPath) await removeNarrationFiles([path]);
    return fail(502, 'narration_failed', { code: 'save_failed' });
  }

  await closeAttempt(opened.id, 'succeeded');
  // Only now, with the new narration saved and counted, does the old one go.
  if (previousPath && previousPath !== path) await removeNarrationFiles([previousPath]);

  const url = await signNarrationUrl(path);
  const after = { limit: usage.limit, used: usage.used + 1, remaining: Math.max(0, usage.remaining - 1), resetsAt: usage.resetsAt, timeZone: usage.timeZone };
  return { status: 200, json: { generated: true, narration: narrationInfo(saved, url), usage: after } };
}
