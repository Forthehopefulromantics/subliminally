-- Run this once in Supabase -> SQL Editor, after 20260921_light.sql.
--
-- Light for the practice people had already done before Light existed.
--
-- Awarding it at full rate would put long-standing users near the top of the
-- ladder on their first look, which makes the whole thing feel unearned. Not
-- awarding it at all reads as the app not seeing what they have kept up for
-- months. So: a quarter of what those days would be worth now, and no further
-- than Becoming I, which leaves the ladder to be climbed by practice.
--
-- One row per day, under its own source, so it reads as history rather than as
-- something that happened today, and can be told apart from earned Light later.
-- The unique index makes it safe to run twice.

with per_day as (
  -- What each past day would have been worth: 5 a habit, 15 for a journal page.
  select user_id, done_on as day, count(*) * 5 as full_value
  from public.habit_checkins
  where done_on < (now() at time zone 'utc')::date
  group by user_id, done_on

  union all

  select user_id, entry_date as day, 15 as full_value
  from public.journal_photos
  where entry_date < (now() at time zone 'utc')::date
),
combined as (
  select user_id, day, sum(full_value)::int as full_value
  from per_day
  group by user_id, day
),
scored as (
  select user_id, day,
         greatest(1, floor(full_value * 0.25))::int as amount
  from combined
),
running as (
  select user_id, day, amount,
         sum(amount) over (partition by user_id order by day
                           rows between unbounded preceding and current row) as cume
  from scored
)
insert into public.light_ledger (user_id, amount, source, source_ref, earned_on)
select user_id,
       -- The day that crosses the cap is trimmed to land exactly on it, rather
       -- than being dropped whole.
       least(amount, 500 - (cume - amount)) as amount,
       'backfill',
       day::text,
       day
from running
where cume - amount < 500
on conflict (user_id, source, source_ref, earned_on) do nothing;

-- What everyone ended up with.
select u.email,
       sum(l.amount) filter (where l.source = 'backfill') as backfilled,
       sum(l.amount) as lifetime
from public.light_ledger l
join auth.users u on u.id = l.user_id
group by u.email
order by lifetime desc;
