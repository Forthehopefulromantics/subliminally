-- Permanent home for generated (Serenity / Clone Your Voice) audio.
--
-- Until now a saved AI-voice subliminal stored only its words and a voice key; the
-- audio was re-fetched from the tts-cache every time it was opened and regenerated
-- whenever the cache key changed (pace, model, voice) or the provider/plan/limit
-- checks failed. `voice_audio` is the manifest of audio files that were generated,
-- uploaded to the private `recordings` bucket (<user_id>/voice/<sha256>.mp3) and
-- verified retrievable BEFORE the subliminal was saved:
--
--   { "v": 1, "clips": [ { "voice": "serenity", "speed": 0.92,
--                          "text": "<normalised line>", "path": "<uid>/voice/<sha>.mp3",
--                          "bytes": 12345 } ] }
--
-- Additive and nullable: nothing existing is changed, rewritten or deleted. Rows
-- saved before this stay valid and are backfilled when next opened.

alter table public.subliminals add column if not exists voice_audio jsonb;
