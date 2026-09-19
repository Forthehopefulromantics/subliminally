-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- Two things, both for the Habit Tracker's own onboarding:
--
--   1. A third time of day. Habits have been morning or night since the tracker
--      shipped; "anytime" is for the ones that do not belong to either end of
--      the day. The old check constraint refuses the value outright, so it is
--      replaced rather than added to.
--
--   2. Where somebody is in the practice cycle, and whether they have been
--      through the Habit Tracker's setup at all.
--
-- `habit_onboarding_completed` is deliberately its own column and not read off
-- `onboarding_completed`. They are two different experiences: finishing the
-- account questionnaire says nothing about whether this person has ever opened
-- the habit tracker, and finishing the habit tracker's setup does not mean the
-- questionnaire was answered. Neither is allowed to stand in for the other.
--
-- Safe to run repeatedly.

-- ---------- a third time of day ----------
alter table public.habits drop constraint if exists habits_time_of_day_check;
alter table public.habits add constraint habits_time_of_day_check
  check (time_of_day in ('morning', 'night', 'anytime'));

-- ---------- the practice cycle ----------
alter table public.profiles
  add column if not exists habit_onboarding_completed boolean not null default false,
  add column if not exists habit_onboarding_completed_at timestamptz,
  -- Day one of the first 21-day cycle. Everything about where somebody is in
  -- the cycle is counted forward from this date against the check-ins already
  -- on record, so there is no second tally to fall out of step with them --
  -- and nothing to reset when a day is missed.
  add column if not exists habit_cycle_started_on date;

comment on column public.profiles.habit_onboarding_completed is
  'True once the Habit Tracker''s own setup saved a routine. Separate from onboarding_completed; neither implies the other.';
comment on column public.profiles.habit_cycle_started_on is
  'Day one of the first 21-day practice cycle. Cycles are counted as 21 days practised since this date, cumulative — not consecutive, and never reset.';
