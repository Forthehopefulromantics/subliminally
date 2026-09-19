-- Onboarding as a slideshow, and a durable record of having finished it.
--
-- `20260929_onboarding_personalization.sql` never reached this database, so
-- every onboarding save was rejected whole (PostgREST refuses an upsert naming
-- a column it cannot see) and nothing was written -- not the desires, and not
-- the username the app was using to decide whether onboarding was done. This
-- carries those columns as well, so it stands alone and running the older file
-- afterwards changes nothing.
--
-- Safe to run repeatedly.

alter table public.profiles
  -- From 20260929, repeated here so order does not matter.
  add column if not exists onboarding_desires jsonb not null default '[]'::jsonb,
  add column if not exists onboarding_struggle text,
  add column if not exists onboarding_goal text,
  -- The slideshow's multi-select answers.
  add column if not exists onboarding_struggles jsonb not null default '[]'::jsonb,
  add column if not exists onboarding_goals jsonb not null default '[]'::jsonb,
  -- Whether onboarding is finished. This is the one source of truth: not
  -- localStorage, not whether a username happens to be set, not what the
  -- browser remembers.
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.profiles.onboarding_desires is 'Up to three current desires chosen during onboarding; user-editable.';
comment on column public.profiles.onboarding_struggles is 'What the person asked for support with during onboarding.';
comment on column public.profiles.onboarding_struggle is 'Their own words on the struggles slide, when they picked "Something else".';
comment on column public.profiles.onboarding_goals is 'What the person most wants to change, chosen during onboarding.';
comment on column public.profiles.onboarding_goal is 'Their own words on the goals slide.';
comment on column public.profiles.onboarding_completed is 'True once the final onboarding slide saved successfully. The only thing routing reads.';

-- Anyone already here who plainly went through onboarding keeps their place:
-- nobody gets asked the questions twice because this column arrived late.
update public.profiles
   set onboarding_completed = true,
       onboarding_completed_at = coalesce(onboarding_completed_at, created_at, now())
 where onboarding_completed = false
   and (username is not null or higher_self_name is not null or full_name is not null);

-- Keep updated_at honest without every caller having to remember it.
create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profile_updated_at();
