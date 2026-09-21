// Who may use which voice. One table, read by both routes and handed to the
// page, so the lock on the card, the 403 from /api/tts and the 403 from
// /api/voice-clone can never disagree.
//
//   Serenity            free and paid. It is the voice the app has.
//   Record your own     free and paid, and never touches this file — a
//                       recording is the person's own audio and is not sent
//                       through ElevenLabs at all.
//   Clone your voice    Ritual. It is the most expensive thing the app does per
//                       person, and it is the only one that creates something
//                       at the provider that then has to be looked after.
//
// There is deliberately no new tier here: 'ritual' is the plan that already
// exists.

export const SERENITY_TIER = 'none';
export const CLONE_TIER = 'ritual';
