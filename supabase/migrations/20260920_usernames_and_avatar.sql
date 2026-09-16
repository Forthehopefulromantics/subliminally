-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- Two things:
--   1. usernames. The app has always had a username field, but the column was
--      never created, which is why saving one failed. This adds it and makes
--      it unique regardless of case, so "Kyla" and "kyla" can't both exist.
--   2. which of the drawn avatars is your higher self.

alter table public.profiles add column if not exists username text;

-- Case-insensitive and ignoring blanks, so several profiles can sit without a
-- username without colliding with each other.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null and username <> '';

-- Checking whether a name is free has to work before you own it, so it can't
-- go through the profiles table itself — every sensible policy there hides
-- other people's rows. This answers only yes or no, and nothing else.
create or replace function public.username_available(candidate text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(trim(candidate))
      and id is distinct from auth.uid()
  );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to authenticated;

-- Which of the drawn avatars is yours. higher_self_avatar already exists from
-- the previous migration; this is only here so the file reads completely.
alter table public.profiles add column if not exists higher_self_avatar text;
