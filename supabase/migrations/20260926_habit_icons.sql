-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- An icon for each habit, so a ritual reads as a row of pictures rather than a
-- list of sentences.
--
-- Nullable on purpose. A habit with no icon is not broken: the app guesses one
-- from the name, so every habit that already exists gets a picture the moment
-- this runs, without anyone having to go and set one.
alter table public.habits add column if not exists icon text;
