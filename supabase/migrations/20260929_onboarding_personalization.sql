-- Expanded onboarding preferences. Safe to run repeatedly.
alter table public.profiles
  add column if not exists onboarding_desires jsonb not null default '[]'::jsonb,
  add column if not exists onboarding_struggle text,
  add column if not exists onboarding_goal text;

comment on column public.profiles.onboarding_desires is 'Up to three current desires selected during onboarding; user-editable.';
comment on column public.profiles.onboarding_struggle is 'Optional current focus or struggle supplied during onboarding.';
comment on column public.profiles.onboarding_goal is 'Primary outcome the user wants Subliminally to support.';
