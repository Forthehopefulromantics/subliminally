-- Habit Tracker onboarding, the 21-day cycle, and what a habit can say about
-- itself. Safe to run repeatedly.
--
-- Nothing new is created that already exists: the habits themselves still live
-- in `public.habits`, their history still lives in `public.habit_checkins`, and
-- the "have they finished this onboarding" flag sits beside the main one on
-- `public.profiles` rather than in a table of its own. Main onboarding and
-- Habit Tracker onboarding are two separate columns and neither reads the
-- other.

-- ---------- where the Habit Tracker keeps its own state ----------
alter table public.profiles
  -- Separate from onboarding_completed. A person can be all the way through
  -- main onboarding and have never opened the Habit Tracker.
  add column if not exists habit_onboarding_completed boolean not null default false,
  add column if not exists habit_onboarding_completed_at timestamptz,
  -- Which 21-day cycle they are in. 0 means they have not started one.
  add column if not exists habit_cycle_number integer not null default 0,
  -- The day the current cycle began. The cycle runs on calendar days, so a
  -- missed day costs a streak and nothing else -- it never restarts this.
  add column if not exists habit_cycle_started_on date,
  -- How many habits they may keep active right now: 3 to begin with, 3 more
  -- for each cycle finished, 15 at the very most.
  add column if not exists habit_slots integer not null default 3;

comment on column public.profiles.habit_onboarding_completed is 'True once the Habit Tracker onboarding saved. Nothing to do with onboarding_completed, which is the main one.';
comment on column public.profiles.habit_cycle_number is 'Which 21-day cycle the person is in. 1 is their first. Avatar customization unlocks at 2 -- i.e. once cycle 1 is behind them.';
comment on column public.profiles.habit_slots is 'Active habits allowed now: 3, then +3 per completed cycle, capped at 15.';

-- ---------- what a habit can now say about itself ----------
-- 'anytime' joins morning and night: not everything belongs to an end of the
-- day, and forcing a choice is how a habit ends up in the wrong ritual.
alter table public.habits drop constraint if exists habits_time_of_day_check;
alter table public.habits add constraint habits_time_of_day_check
  check (time_of_day in ('morning', 'night', 'anytime'));

alter table public.habits
  add column if not exists duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 600),
  -- 0 = Sunday .. 6 = Saturday, matching JavaScript's getDay(). Every day by
  -- default, because that is what a daily practice is until someone says else.
  add column if not exists days_of_week jsonb not null default '[0,1,2,3,4,5,6]'::jsonb,
  -- Stored now, acted on later: nothing in the app asks for notification
  -- permission yet, and this column does not make it.
  add column if not exists reminder_at time;

comment on column public.habits.days_of_week is 'Days this habit is meant for, 0=Sunday..6=Saturday. Defaults to every day.';
comment on column public.habits.reminder_at is 'Optional local time the person would like reminding. No notifications are sent yet.';

-- ---------- people who were already using the tracker ----------
-- Somebody with 28 habits and two months of check-ins does not need to be
-- taught what a habit is, and must not be walked through a screen that would
-- have them pick three. They are treated as having finished this onboarding,
-- their first cycle dated from the day their oldest habit was made, and their
-- allowance raised to cover what they already keep -- nothing is deleted,
-- archived or renamed by this.
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
