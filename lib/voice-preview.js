// The Serenity demo: one short line, generated once, heard by everybody.
//
// This is NOT the same thing as generating somebody's affirmations in Serenity.
// That is what /api/tts does, it is premium, and it costs us a request per line.
// This is a fixed sentence in a fixed voice at a fixed pace — so it is one audio
// file that never changes, and the honest way to serve it is to make it once and
// then read it back forever. See api/voice-preview.js, which is the only caller.
//
// Keeping the text here rather than in the route is what makes that true: the
// storage path is derived from the words, the voice, the pace and the model, so
// changing any of them is a *new* file generated once, and nothing ever has to
// remember to invalidate a stale one.

import { MODEL_ID } from './elevenlabs.js';
import { hashesFor } from './tts-store.js';
import { presetVoiceByKey } from './voices.js';

/* Which voice the demo is read in. One of the catalogue keys, so the id it
   resolves to is the id a paying member actually hears. */
export const PREVIEW_VOICE_KEY = 'serenity';

/* What it says. Short on purpose: long enough to hear the voice, too short and
   too general to be of any use as free text-to-speech. */
export const PREVIEW_TEXT =
  "Your thoughts are becoming calmer, clearer, and more aligned with the person you're becoming.";

/* The pace the builder calls 'steady' — what a subliminal is read at by default,
   so the demo sounds like the thing it is a demo of. */
export const PREVIEW_SPEED = 1;

export function previewVoiceId() {
  const preset = presetVoiceByKey(PREVIEW_VOICE_KEY);
  return preset ? preset.providerVoiceId : null;
}

/* Where the one file lives, inside the bucket generated clips already use.
   Every other path in there starts with a user id (a uuid), so the underscore
   cannot collide with one — and this file belongs to nobody in particular, which
   is the whole point of it. */
export function previewStoragePath() {
  const { clipKey } = hashesFor({
    text: PREVIEW_TEXT,
    providerVoiceId: previewVoiceId(),
    speed: PREVIEW_SPEED,
    modelId: MODEL_ID,
  });
  return `_preview/${clipKey}.mp3`;
}
