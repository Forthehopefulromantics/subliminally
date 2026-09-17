-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- What someone says about a ritual they did not do.
--
-- The point of this table is not measurement. It is that a missed day usually
-- has a reason, and writing the reason down is kinder than pretending the day
-- did not happen -- and more useful later than a gap in a calendar.
--
-- Nothing reads it back to judge anyone. There is no streak penalty attached to
-- it, no score, and answering is optional every single time.
create table if not exists public.ritual_reflections (
  user_id     uuid not null references auth.users(id) on delete cascade,
  missed_on   date not null,
  time_of_day text not null check (time_of_day in ('morning','night')),
  reason      text,
  feeling     text,
  note        text,
  created_at  timestamptz not null default now(),
  -- One per ritual per day: asked once, answered once, never asked again.
  primary key (user_id, missed_on, time_of_day)
);

alter table public.ritual_reflections enable row level security;

drop policy if exists "read own reflections" on public.ritual_reflections;
create policy "read own reflections" on public.ritual_reflections
  for select using (auth.uid() = user_id);

drop policy if exists "write own reflections" on public.ritual_reflections;
create policy "write own reflections" on public.ritual_reflections
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own reflections" on public.ritual_reflections;
create policy "update own reflections" on public.ritual_reflections
  for update using (auth.uid() = user_id);
