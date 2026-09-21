-- Run this once in Supabase -> SQL Editor, after 20261003_elevenlabs_voices.sql.
--
-- The voice picker offers three things now — Serenity, your cloned AI voice, and
-- recording yourself — where it used to offer six stock voices plus yours plus
-- the device. The six are retired, so the saved subliminals that name one of
-- them are rewritten to name Serenity instead.
--
-- Nothing is lost by this. A saved subliminal stores a voice *key*, not audio:
-- rewriting the key means it is read by Serenity the next time it is opened
-- rather than by a voice the app no longer has. Rows that say 'mine' (the
-- person's own cloned voice), 'device', or nothing at all are left exactly as
-- they are, and a subliminal built from a recording never had a key to rewrite.
--
-- lib/voices.js maps the same six at request time, so a tab that was open across
-- the deploy also plays rather than failing. This migration is what stops that
-- mapping having to be there forever.

-- The keys the picker used to write...
update public.subliminals
set ai_voice_id = 'serenity'
where ai_voice_id in ('sarah','charlotte','alice','lily','daniel','george');

update public.subliminals
set layer_ai_voice_id = 'serenity'
where layer_ai_voice_id in ('sarah','charlotte','alice','lily','daniel','george');

-- ...and the raw ElevenLabs ids the build before that wrote, for any row the
-- previous migration did not reach.
update public.subliminals
set ai_voice_id = 'serenity'
where ai_voice_id in (
  'EXAVITQu4vr4xnSDxMaL','XB0fDUnXU5powFXDhCwa','Xb7hH8MSUJpSbSDYk0k2',
  'pFZP5JQG7iQjIQuC4Bku','onwK4e9ZLuTAKqWW03F9','JBFqnCBsd6RMkjVDRZzb'
);

update public.subliminals
set layer_ai_voice_id = 'serenity'
where layer_ai_voice_id in (
  'EXAVITQu4vr4xnSDxMaL','XB0fDUnXU5powFXDhCwa','Xb7hH8MSUJpSbSDYk0k2',
  'pFZP5JQG7iQjIQuC4Bku','onwK4e9ZLuTAKqWW03F9','JBFqnCBsd6RMkjVDRZzb'
);

-- The clones themselves are untouched: user_voice_profiles still holds one voice
-- per person, still only readable by its owner, and nothing here creates,
-- replaces or removes a voice at the provider.
