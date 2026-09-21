// The voice catalogue — the one place a display voice is tied to a provider id.
//
// There is one built-in voice now: Serenity. The picker offers three things and
// only three — Serenity, the voice you cloned, and recording yourself — so the
// catalogue is one row rather than six, and the six that came before it are
// retired rather than deleted (see RETIRED_VOICES).
//
// Everything the browser sees is a *key*: 'serenity', 'mine'. The ElevenLabs
// voice ids live here and only here, so nothing on the page — and nothing in a
// saved subliminal — carries a provider id around. That also means a caller
// cannot ask for an arbitrary voice and spend credits on it: an unknown key is
// refused rather than forwarded.

export const PROVIDER = 'elevenlabs';

/* Serenity. The one built-in voice, and the only provider id in this file —
   change it here and the whole app follows, because nothing else knows it. */
export const SERENITY_VOICE_KEY = 'serenity';
const SERENITY_PROVIDER_VOICE_ID = 'PrH4gjaYIM8R16R889Vf';

export const PRESET_VOICES = [
  {
    key: SERENITY_VOICE_KEY,
    name: 'Serenity',
    desc: 'Calm, warm AI voice',
    providerVoiceId: SERENITY_PROVIDER_VOICE_ID,
  },
];

// The two keys that aren't preset voices. 'device' never reaches the server —
// it means "use the speech synthesis built into this phone" — and is no longer
// offered in the picker, but it is still what the app falls back to when a
// studio voice cannot be generated, so it is listed for the two to agree on the
// spelling.
export const MY_VOICE_KEY = 'mine';
export const DEVICE_VOICE_KEY = 'device';

/* The voices the picker used to offer, by key and by raw provider id. They are
   not choosable any more, but they are written into saved subliminals and into
   a tab that was open across the deploy, so they resolve to Serenity rather than
   failing — a subliminal built last week still plays, in the voice that replaced
   the one it named. The migration rewrites the rows; this covers everything it
   has not reached. */
const RETIRED_VOICES = [
  'sarah',     'EXAVITQu4vr4xnSDxMaL',
  'charlotte', 'XB0fDUnXU5powFXDhCwa',
  'alice',     'Xb7hH8MSUJpSbSDYk0k2',
  'lily',      'pFZP5JQG7iQjIQuC4Bku',
  'daniel',    'onwK4e9ZLuTAKqWW03F9',
  'george',    'JBFqnCBsd6RMkjVDRZzb',
];

/* What the picker is allowed to know: a key, a name, a description. No ids. */
export function publicPresetVoices() {
  return PRESET_VOICES.map(({ key, name, desc }) => ({ key, name, desc }));
}

export function presetVoiceByKey(key) {
  return PRESET_VOICES.find((v) => v.key === key) || null;
}

export function presetVoiceByProviderId(providerVoiceId) {
  return PRESET_VOICES.find((v) => v.providerVoiceId === providerVoiceId) || null;
}

export function serenityVoice() {
  return presetVoiceByKey(SERENITY_VOICE_KEY);
}

/* Accepts whatever the caller sent and hands back the preset it names, whether
   that was a key, a legacy provider id, or one of the retired voices. Null for
   anything else — including 'mine', which is resolved per-user against their own
   voice profile. */
export function resolvePresetVoice(requested) {
  if (typeof requested !== 'string' || !requested) return null;
  const direct = presetVoiceByKey(requested) || presetVoiceByProviderId(requested);
  if (direct) return direct;
  if (RETIRED_VOICES.includes(requested)) return serenityVoice();
  return null;
}
