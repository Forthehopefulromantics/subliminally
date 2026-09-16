-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
-- Your higher self: which of the avatars you chose, and what you named her.
-- She lives on the Today screen, above the day.

alter table public.profiles add column if not exists higher_self_avatar text;
alter table public.profiles add column if not exists higher_self_name text;
