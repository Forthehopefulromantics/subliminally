-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
-- Holds the id of the voice a person has cloned at the speech provider, so their
-- subliminals can be generated in their own voice without recording every line.
-- The recording itself never needs to be kept, only the resulting voice id.

alter table public.profiles add column if not exists cloned_voice_id text;

-- The chosen studio voice is remembered per subliminal, so reopening one from
-- the library plays it back in the voice it was built with.
alter table public.subliminals add column if not exists ai_voice_id text;
alter table public.subliminals add column if not exists layer_ai_voice_id text;
