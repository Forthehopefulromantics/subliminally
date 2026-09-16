-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- Grace Days. A streak that a single hard day can wipe out isn't measuring
-- practice, it's measuring luck. A Grace Day is earned by keeping the practice
-- up, and spends itself to bridge one missed day so the run behind it stays
-- intact.
--
-- Two separate things are stored, because they answer different questions:
--
--   grace_days   how many are held and unspent — a balance
--   grace_used   which days were actually bridged — a record
--
-- The record is what matters. Without it the same missed day would be bridged
-- again on every render, and a balance would drain without anything to show
-- for it. With it, a bridged day stays bridged, and the person can be told
-- which day it saved.

alter table public.profiles add column if not exists grace_days integer not null default 0;

create table if not exists public.grace_used (
  user_id   uuid not null references auth.users(id) on delete cascade,
  used_on   date not null,
  time_of_day text not null default 'night',   -- morning and night run their own streaks
  created_at timestamptz not null default now(),
  primary key (user_id, used_on, time_of_day)
);

alter table public.grace_used enable row level security;

drop policy if exists "read own grace" on public.grace_used;
create policy "read own grace" on public.grace_used
  for select using (auth.uid() = user_id);

-- Like Light, spending is not left to the app: the balance is checked and
-- decremented in the same statement that records the day, so two taps can't
-- spend the same Grace Day twice.
create or replace function public.spend_grace_day(p_on date, p_time text default 'night')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Already bridged: nothing to spend, and that is a success, not an error.
  if exists (select 1 from public.grace_used
             where user_id = auth.uid() and used_on = p_on and time_of_day = p_time) then
    return true;
  end if;

  update public.profiles
     set grace_days = grace_days - 1
   where id = auth.uid() and grace_days > 0;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;                       -- none held
  end if;

  insert into public.grace_used (user_id, used_on, time_of_day)
  values (auth.uid(), p_on, p_time)
  on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.spend_grace_day(date, text) from public;
grant execute on function public.spend_grace_day(date, text) to authenticated;

-- One Grace Day per fourteen days of practice, at most three held at a time.
-- Earning is recalculated rather than incremented, so it can't drift: the
-- number held is always (earned so far) minus (spent so far).
create or replace function public.refresh_grace_days()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practice integer;
  v_earned   integer;
  v_spent    integer;
  v_held     integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select count(distinct done_on) into v_practice
    from public.habit_checkins where user_id = auth.uid();

  v_earned := least(3 + (select count(*) from public.grace_used where user_id = auth.uid()),
                    v_practice / 14);
  select count(*) into v_spent from public.grace_used where user_id = auth.uid();
  v_held := greatest(0, least(3, v_earned - v_spent));

  update public.profiles set grace_days = v_held where id = auth.uid();
  return v_held;
end;
$$;

revoke all on function public.refresh_grace_days() from public;
grant execute on function public.refresh_grace_days() to authenticated;
