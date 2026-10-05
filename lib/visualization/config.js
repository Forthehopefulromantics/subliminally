// Visualization — the numbers, in one place.
//
// Nothing about a limit is written anywhere else. The daily allowance of new
// narrations is read at request time from the `visualization_settings` table
// (key `daily_visualization_narration_limit`), then from the
// VISUALIZATION_DAILY_NARRATION_LIMIT environment variable, then from the
// default below. Changing it is an UPDATE statement or an env var, never a
// deploy of the app.

import { createHash } from 'node:crypto';

export const SETTING_DAILY_NARRATION_LIMIT = 'daily_visualization_narration_limit';
export const DEFAULT_DAILY_NARRATION_LIMIT = 1;

/* The most questions a person is ever asked, counting the first one ("What do
   you want to experience?"). The model may stop sooner; it may never go past. */
export const MAX_TOTAL_QUESTIONS = 5;
/* At least one follow-up is asked. The first answer alone is rarely enough to
   write a scene that belongs to one person, and it is what makes this a
   conversation rather than a text box. */
export const MIN_FOLLOW_UPS = 1;

/* A visualization is always narratable in five minutes or less. Serenity is
   read at 0.95 speed, which lands near 140 words a minute, so five minutes is
   700 words. The writer is aimed well under that; the cap is what a hand edit
   may not exceed. */
export const NARRATION_MAX_SECONDS = 5 * 60;
export const WORDS_PER_MINUTE = 140;
export const MAX_SCRIPT_WORDS = Math.floor((NARRATION_MAX_SECONDS / 60) * WORDS_PER_MINUTE); // 700
export const TARGET_WORDS_MIN = 420;
export const TARGET_WORDS_MAX = 620;
/* A backstop for the provider request, in characters. 700 words is about 4,300. */
export const MAX_SCRIPT_CHARS = 5000;

export const MAX_DESIRE_CHARS = 1000;
export const MAX_ANSWER_CHARS = 600;
export const MAX_INSTRUCTION_CHARS = 500;

/* A narration that has been "pending" this long was abandoned by a function
   that was stopped; it no longer blocks a new attempt. */
export const STALE_PENDING_SECONDS = 5 * 60;

export const NARRATION_VOICE_KEY = 'serenity';
/* A storyteller, not an announcer: more variation (lower stability), a touch of
   style, unhurried. */
export const NARRATION_VOICE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.75,
  style: 0.3,
  use_speaker_boost: true,
  speed: 0.95,
};
export const NARRATION_MODEL_ID = process.env.VISUALIZATION_TTS_MODEL || 'eleven_multilingual_v2';
export const NARRATION_BITRATE_KBPS = 128; // the provider's default mp3 output (mp3_44100_128)
export const NARRATION_TIMEOUT_MS = 100000;

/* The story, as it will be read: line endings unified, runs of spaces collapsed,
   blank lines limited to one, ends trimmed. This is the definition of "the same
   story" — the database trigger in 20261005_visualizations.sql implements the
   same steps in SQL, and scripts/visualization-test.js checks that the two agree. */
export function normalizeScript(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hashScript(text) {
  const normalized = normalizeScript(text);
  if (!normalized) return null;
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function countWords(text) {
  const t = normalizeScript(text);
  return t ? t.split(/\s+/).length : 0;
}

export function estimatedMinutes(words) {
  return words / WORDS_PER_MINUTE;
}

/* What the provider is sent. Paragraph breaks become a short pause: not after
   every sentence, only where the scene takes a breath. Anything that is not
   speech is removed so it cannot be read aloud. */
export function speechTextFor(script) {
  const paragraphs = normalizeScript(script)
    .replace(/[*_#`~<>[\]{}]/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean);
  return paragraphs.join('\n<break time="0.8s" />\n');
}

/* ---- the daily window ---- */

/* The browser says which timezone it is in so "today" means the person's today,
   and "tomorrow" is when their own midnight passes. An unknown name is UTC. */
export function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch (e) {
    return 'UTC';
  }
}

/* The instant the person's current local day began, and the instant it ends. */
export function localDayWindow(tz, now = new Date()) {
  const zone = validTimeZone(tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now);
  const get = (type) => Number((parts.find((p) => p.type === type) || {}).value) || 0;
  const elapsedMs = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  const start = new Date(now.getTime() - elapsedMs);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), zone };
}

export function parseLimit(value) {
  const n = Number(typeof value === 'string' ? value.trim() : value);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : null;
}
