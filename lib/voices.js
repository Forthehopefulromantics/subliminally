// The voice catalogue — the one place a display voice is tied to a provider id.
//
// Everything the browser sees is a *key*: 'serenity', 'mine', 'device'.
// The ElevenLabs voice ids live here and only here, so nothing on the page — and
// nothing in a saved subliminal — carries a provider id around. That also means
// a caller cannot ask for an arbitrary voice and spend credits on it: an unknown
// key is refused rather than forwarded.
//
// Adding a voice later is one row: a key nobody has used before, the name and
// one-line description the picker shows, and the id from the ElevenLabs voice
// library. Nothing else in the app needs to change.

export const PROVIDER = 'elevenlabs';

/* V1 offers exactly one AI voice. Every studio voice is a paid feature — see
   hasPremiumAccess() in lib/supabase-auth.js, which /api/tts checks before a
   single provider call is made. */
export const PRESET_VOICES = [
  { key: 'serenity', name: 'Serenity', desc: 'Calm, warm AI voice', providerVoiceId: 'PrH4gjaYIM8R16R889Vf' },
];

/* The six voices the picker used to offer. They are no longer choosable — they
   are not in publicPresetVoices(), so /api/voices never lists them and the
   builder cannot draw a chip for one — but they are still *resolvable*, because
   a subliminal saved before this release has one of these keys in
   `subliminals.ai_voice_id` and must keep playing exactly as it did.

   Resolving to the original id rather than folding these into Serenity is
   deliberate: it keeps every clip already in `tts-cache` valid, so reopening an
   old subliminal reads audio back instead of regenerating it and spending
   credits to change how it sounds. Nothing here is advertised, and nothing here
   is free — a legacy voice goes through the same premium gate as Serenity. */
export const LEGACY_PRESET_VOICES = [
  { key: 'sarah',     name: 'Sarah',     desc: 'warm, calm',      providerVoiceId: 'EXAVITQu4vr4xnSDxMaL' },
  { key: 'charlotte', name: 'Charlotte', desc: 'soft, low',       providerVoiceId: 'XB0fDUnXU5powFXDhCwa' },
  { key: 'alice',     name: 'Alice',     desc: 'clear, steady',   providerVoiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  { key: 'lily',      name: 'Lily',      desc: 'bright',          providerVoiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  { key: 'daniel',    name: 'Daniel',    desc: 'deep, grounding', providerVoiceId: 'onwK4e9ZLuTAKqWW03F9' },
  { key: 'george',    name: 'George',    desc: 'measured',        providerVoiceId: 'JBFqnCBsd6RMkjVDRZzb' },
];

/* Everything the server will resolve: what you may choose, plus what you may
   already have chosen. */
const ALL_PRESET_VOICES = [...PRESET_VOICES, ...LEGACY_PRESET_VOICES];

// The two keys that aren't preset voices. 'device' never reaches the server —
// it means "use the speech synthesis built into this phone" — but it is listed
// so the browser and the server agree on the spelling.
export const MY_VOICE_KEY = 'mine';
export const DEVICE_VOICE_KEY = 'device';

/* What the picker is allowed to know: a key, a name, a description. No ids, and
   no retired voices — this is the list of what may be *chosen*, which is why it
   reads PRESET_VOICES and not ALL_PRESET_VOICES. */
export function publicPresetVoices() {
  return PRESET_VOICES.map(({ key, name, desc }) => ({ key, name, desc }));
}

/* Resolution, by contrast, accepts the retired keys too: a saved subliminal is
   allowed to name a voice that is no longer on offer. */
export function presetVoiceByKey(key) {
  return ALL_PRESET_VOICES.find((v) => v.key === key) || null;
}

/* Is this a voice that costs us money to generate? Every preset does, retired or
   not. Only 'device' (this phone's own speech synthesis) and a recording the
   person made themselves cost nothing, and neither of those ever reaches the
   server. */
export function isStudioVoiceKey(key) {
  return !!presetVoiceByKey(key);
}

/* Before this release the browser stored the raw ElevenLabs id, both in the
   picker and in `subliminals.ai_voice_id`. The migration rewrites those rows to
   keys, but a page that was already open when it shipped — or a row the
   migration has not reached yet — can still send one, so a preset id is accepted
   and mapped rather than refused. Nothing advertises these. */
export function presetVoiceByProviderId(providerVoiceId) {
  return ALL_PRESET_VOICES.find((v) => v.providerVoiceId === providerVoiceId) || null;
}

/* Accepts whatever the caller sent and hands back the preset it names, whether
   that was a key or a legacy provider id. Null for anything else — including
   'mine', which is resolved per-user against their own voice profile. */
export function resolvePresetVoice(requested) {
  if (typeof requested !== 'string' || !requested) return null;
  return presetVoiceByKey(requested) || presetVoiceByProviderId(requested);
}
