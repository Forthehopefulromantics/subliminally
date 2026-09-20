-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- ALREADY APPLIED to the live database on 2026-09-19, as the migration
-- `habit_tracker_onboarding` (version 20260919190826) — written straight into
-- Supabase rather than through this folder, so this file did not exist when it
-- ran. What is below reproduces exactly what that migration did, so a fresh
-- environment built from this folder matches production. Running it against
-- the live database now is a no-op, which is the point.
--
-- Everything the Habit Tracker's setup needs:
--
--   1. A third time of day. Habits have been morning or night since the
--      tracker shipped; "anytime" is for the ones that do not belong to either
--      end of the day. The old check constraint refuses the value outright, so
--      it is replaced rather than added to.
--
--   2. Whether somebody has been through the Habit Tracker's setup, and where
--      they are in the practice cycle.
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
  -- and nothing to reset when a day is missed. See habitPractiseDays() and
  -- habitSpacesTotal() in js/habits.js.
  add column if not exists habit_cycle_started_on date,
  -- The two below are NOT READ OR WRITTEN BY ANY CODE. They came with the
  -- migration that was applied directly, which counted cycles and spaces as
  -- stored numbers; js/habits.js derives both from habit_checkins instead, so
  -- a missed day cannot quietly decrement a counter and a backfill cannot
  -- disagree with the check-ins it was computed from. They are kept here only
  -- so this file reproduces the live schema. Either wire them up or drop them
  -- — leaving a stored `habit_slots = 3` that nothing maintains is a trap for
  -- whoever reads this next. See LAUNCH.md.
  add column if not exists habit_cycle_number integer not null default 0,
  add column if not exists habit_slots integer not null default 3;

comment on column public.profiles.habit_onboarding_completed is
  'True once the Habit Tracker''s own setup saved a routine. Separate from onboarding_completed; neither implies the other.';
comment on column public.profiles.habit_cycle_started_on is
  'Day one of the first 21-day practice cycle. Cycles are counted as 21 days practised since this date, cumulative — not consecutive, and never reset.';
comment on column public.profiles.habit_cycle_number is
  'UNUSED by the app — cycles are derived from habit_checkins. Kept because it exists in the live database.';
comment on column public.profiles.habit_slots is
  'UNUSED by the app — spaces are derived from habit_checkins. Kept because it exists in the live database.';

-- ---------- per-habit settings ----------
-- Also unused so far. `duration_minutes` is the one of the three that is safe
-- to offer today; `reminder_at` would be a promise the app cannot keep, since
-- nothing sends a notification. See LAUNCH.md before surfacing either.
alter table public.habits
  add column if not exists duration_minutes integer
    check (duration_minutes is null or duration_minutes between 1 and 600),
  add column if not exists days_of_week jsonb not null default '[0,1,2,3,4,5,6]'::jsonb,
  add column if not exists reminder_at time;

comment on column public.habits.days_of_week is
  'Days this habit is meant for, 0=Sunday..6=Saturday. Defaults to every day. UNUSED by the app so far.';
comment on column public.habits.reminder_at is
  'Optional local time the person would like reminding. No notifications are sent yet, and nothing reads this.';

-- ---------- anybody already keeping habits ----------
-- Nobody who was already using the tracker is sent through a setup flow for a
-- routine they have had for weeks. Their cycle is dated from their first habit
-- rather than from today, so the days they have already practised count.
with used as (
  select user_id,
         min(created_at)::date as first_day,
         count(*) filter (where not archived) as active
    from public.habits
   group by user_id
)
update public.profiles p
   set habit_onboarding_completed = true,
       habit_onboarding_completed_at = coalesce(p.habit_onboarding_completed_at, now()),
       habit_cycle_number = greatest(p.habit_cycle_number, 1),
       habit_cycle_started_on = coalesce(p.habit_cycle_started_on, used.first_day),
       habit_slots = least(15, greatest(p.habit_slots, ((used.active + 2) / 3) * 3, 3))
  from used
 where used.user_id = p.id
   and p.habit_onboarding_completed = false;
