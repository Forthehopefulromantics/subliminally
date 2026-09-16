-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- The Light system. Light is earned by doing the practice, and the ledger below
-- is the whole record of it: the balance is the sum of these rows, so the
-- history and the total can never disagree with each other.
--
-- Two things are deliberately NOT left to the app:
--
--   1. How much each action is worth. The amounts live in award_light() below,
--      not in the browser, so a page that asks for Light can say what it did
--      but not what that was worth.
--
--   2. Whether an action has already paid out. The unique index makes a repeat
--      impossible at the database level, whatever the app sends. Refreshing the
--      page, tapping twice, or calling the function in a loop all collapse to
--      one row and one payment.

create table if not exists public.light_ledger (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      integer not null check (amount > 0),
  source      text not null,
  source_ref  text not null default '',
  earned_on   date not null default (now() at time zone 'utc')::date,
  created_at  timestamptz not null default now()
);

-- One payment per action per day. This is the anti-farming mechanism; nothing
-- in the app is trusted to enforce it.
create unique index if not exists light_ledger_once
  on public.light_ledger (user_id, source, source_ref, earned_on);

create index if not exists light_ledger_user_day
  on public.light_ledger (user_id, earned_on desc);

alter table public.light_ledger enable row level security;

drop policy if exists "read own light" on public.light_ledger;
create policy "read own light" on public.light_ledger
  for select using (auth.uid() = user_id);

-- No insert policy on purpose: rows arrive only through award_light(), which
-- runs as the definer. Nobody can write their own amount.

-- What each action is worth. Change the numbers here to rebalance the economy;
-- no app release is needed.
create or replace function public.light_value(p_source text)
returns integer
language sql
immutable
as $$
  select case p_source
    when 'habit'            then 5      -- one habit checked off
    when 'ritual_morning'   then 20     -- the whole morning list
    when 'ritual_night'     then 20     -- the whole night list
    when 'journal'          then 15     -- a page photographed, or an entry written
    when 'subliminal'       then 10     -- a session played through
    when 'non_negotiables'  then 25     -- every ✦ kept
    when 'perfect_day'      then 50     -- morning and night, both complete
    when 'week_streak'      then 100    -- seven days of practice
    else 0
  end;
$$;

-- Award Light for something the caller just did. Returns how much was actually
-- granted: 0 means it had already been paid for today, which is not an error.
--
-- p_on lets the app pass the user's own local date, because a day boundary is
-- wherever the person is, not wherever the server is.
create or replace function public.award_light(p_source text, p_ref text default '', p_on date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer;
  v_day    date;
  v_rows   integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_amount := light_value(p_source);
  if v_amount <= 0 then
    return 0;                        -- an action nobody pays for
  end if;

  -- Trust the caller's day only as far as one day either side of the server's,
  -- which covers every real timezone without letting anyone mine the past.
  v_day := coalesce(p_on, (now() at time zone 'utc')::date);
  if v_day > ((now() at time zone 'utc')::date + 1)
     or v_day < ((now() at time zone 'utc')::date - 1) then
    v_day := (now() at time zone 'utc')::date;
  end if;

  insert into public.light_ledger (user_id, amount, source, source_ref, earned_on)
  values (auth.uid(), v_amount, p_source, coalesce(p_ref, ''), v_day)
  on conflict (user_id, source, source_ref, earned_on) do nothing;

  get diagnostics v_rows = row_count;
  return case when v_rows > 0 then v_amount else 0 end;
end;
$$;

revoke all on function public.award_light(text, text, date) from public;
grant execute on function public.award_light(text, text, date) to authenticated;

-- Lifetime total and what was earned today, in one round trip.
create or replace function public.my_light(p_on date default null)
returns table (lifetime bigint, today bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(sum(amount), 0)::bigint,
    coalesce(sum(amount) filter (
      where earned_on = coalesce(p_on, (now() at time zone 'utc')::date)
    ), 0)::bigint
  from public.light_ledger
  where user_id = auth.uid();
$$;

revoke all on function public.my_light(date) from public;
grant execute on function public.my_light(date) to authenticated;
