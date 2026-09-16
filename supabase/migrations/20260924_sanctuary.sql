-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- The Sanctuary home. Rooms that open, objects that are earned, and where each
-- object was put.
--
-- Three things are deliberately NOT stored here, because something that already
-- exists answers them:
--
--   Which rooms are unlocked. Derived from light_ledger, which is append-only.
--     That is not a shortcut -- it is the mechanism. "Progress must never
--     disappear" cannot be broken by a bug in code that does not exist, and no
--     future migration can revoke a room, because no row says a room is open.
--     Existing members walk in with rooms already open, earned by practice they
--     did before any of this was built.
--
--   The catalogue of objects. Lives in js/sanctuary.js as a const, the same way
--     LEVELS and AVATARS do. Rebalancing is a release, not a migration.
--
--   Light. light_ledger already is the economy. Nothing here mints or spends.
--
-- What is left is only what is genuinely per-person and cannot be recomputed:
-- which week gave you something, which one you picked, and where you put it.

-- ---------------------------------------------------------------- grants ---
-- One row per week that earned a reward. `offered` is the three the app showed,
-- `chosen` the one taken. Null chosen means the choice is still open, so it
-- survives closing the app mid-decision.
create table if not exists public.sanctuary_grants (
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  offered    text[] not null check (array_length(offered, 1) between 1 and 6),
  chosen     text,
  seed       integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.sanctuary_grants enable row level security;

drop policy if exists "read own grants" on public.sanctuary_grants;
create policy "read own grants" on public.sanctuary_grants
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------ placements ---
-- Where an owned object sits. The primary key is the slot, not the object, so a
-- slot holds exactly one thing and moving something is an update rather than a
-- duplicate. There is no delete policy: taking an object away is not a thing
-- this app does.
create table if not exists public.sanctuary_placements (
  user_id    uuid not null references auth.users(id) on delete cascade,
  room_key   text not null,
  slot_key   text not null,
  item_key   text not null,
  placed_at  timestamptz not null default now(),
  primary key (user_id, room_key, slot_key)
);

alter table public.sanctuary_placements enable row level security;

drop policy if exists "read own placements" on public.sanctuary_placements;
create policy "read own placements" on public.sanctuary_placements
  for select using (auth.uid() = user_id);

-- Which rooms have been opened and looked at, for the "new" marks. One small
-- document rather than a table, because nothing ever queries across it.
alter table public.profiles add column if not exists sanctuary_seen jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------ what you have done ---
-- Every source of Light this person has ever earned, with when it started and
-- how many days carry it. Rooms open off this, so it has to reach back further
-- than the ninety-two days the app keeps in memory.
create or replace function public.my_light_sources()
returns table (source text, days bigint, first_on date, last_on date)
language sql
security definer
set search_path = public
stable
as $$
  select source, count(distinct earned_on)::bigint, min(earned_on), max(earned_on)
  from public.light_ledger
  where user_id = auth.uid()
  group by source;
$$;

revoke all on function public.my_light_sources() from public;
grant execute on function public.my_light_sources() to authenticated;

-- ------------------------------------------------------------ the reward ---
-- A week earns something if Light was earned on four separate days in it. Four
-- rather than seven on purpose: this is the one place a reward is withheld, and
-- withholding it for a hard Tuesday would make the house into a scoreboard.
-- Nothing is ever taken away for a week that does not qualify; it simply passes.
create or replace function public.sanctuary_week_qualifies(p_week date)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct earned_on) >= 4
  from public.light_ledger
  where user_id = auth.uid()
    and earned_on >= date_trunc('week', p_week)::date
    and earned_on <  date_trunc('week', p_week)::date + 7;
$$;

revoke all on function public.sanctuary_week_qualifies(date) from public;
grant execute on function public.sanctuary_week_qualifies(date) to authenticated;

-- Open a week's reward. Returns the row, creating it only if the week really
-- earned one. Called again it returns what is already there, so refreshing the
-- page cannot re-roll the three on offer and cannot grant a second object.
--
-- `seed` is issued here rather than by the app, and is stable for a person and
-- a week. The app picks which three to show from it, so the same three appear
-- on a phone and a laptop, and a reload does not reshuffle them.
--
-- An honest note on what this does and does not prevent: because the catalogue
-- lives in the app, the three keys are sent from the app, and someone editing
-- their own JavaScript could send three of whatever they liked. What they
-- cannot do is get more than one object per qualifying week, claim a week they
-- did not earn, or place anything they were not granted -- and those are the
-- guarantees that matter. Moving the catalogue into the database to close the
-- last gap would buy a cosmetic object a week against a second copy of the
-- catalogue to keep in step, which is a bad trade.
create or replace function public.open_sanctuary_week(p_week date, p_offered text[])
returns public.sanctuary_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := date_trunc('week', p_week)::date;
  v_row  public.sanctuary_grants;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.sanctuary_grants
   where user_id = auth.uid() and week_start = v_week;
  if found then
    return v_row;                      -- already open; whatever is there wins
  end if;

  -- A week still running cannot be claimed, and neither can one that was not
  -- kept up. Neither is an error: there is simply nothing to open.
  if v_week >= date_trunc('week', (now() at time zone 'utc')::date)::date then
    return null;
  end if;
  if not public.sanctuary_week_qualifies(v_week) then
    return null;
  end if;

  insert into public.sanctuary_grants (user_id, week_start, offered, seed)
  values (auth.uid(), v_week, p_offered,
          abs(hashtext(auth.uid()::text || v_week::text)))
  on conflict (user_id, week_start) do nothing;

  select * into v_row from public.sanctuary_grants
   where user_id = auth.uid() and week_start = v_week;
  return v_row;
end;
$$;

revoke all on function public.open_sanctuary_week(date, text[]) from public;
grant execute on function public.open_sanctuary_week(date, text[]) to authenticated;

-- Take one of the three. Only one of the three, and only once: a choice already
-- made stands, so a second tap on a slow connection cannot swap it.
create or replace function public.choose_sanctuary_item(p_week date, p_item text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := date_trunc('week', p_week)::date;
  v_row  public.sanctuary_grants;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.sanctuary_grants
   where user_id = auth.uid() and week_start = v_week;
  if not found then
    return null;
  end if;
  if v_row.chosen is not null then
    return v_row.chosen;               -- already decided, and that is final
  end if;
  if not (p_item = any (v_row.offered)) then
    raise exception 'that was not one of the three offered' using errcode = '22023';
  end if;

  update public.sanctuary_grants set chosen = p_item
   where user_id = auth.uid() and week_start = v_week and chosen is null;
  return p_item;
end;
$$;

revoke all on function public.choose_sanctuary_item(date, text) from public;
grant execute on function public.choose_sanctuary_item(date, text) to authenticated;

-- Put an owned object in a slot. Ownership is checked here rather than trusted,
-- and a slot already holding something is overwritten, which is how moving one
-- object out of a slot and another into it stays a single statement.
create or replace function public.place_sanctuary_item(p_room text, p_slot text, p_item text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not exists (select 1 from public.sanctuary_grants
                  where user_id = auth.uid() and chosen = p_item) then
    raise exception 'you do not have that' using errcode = '42501';
  end if;

  insert into public.sanctuary_placements (user_id, room_key, slot_key, item_key)
  values (auth.uid(), p_room, p_slot, p_item)
  on conflict (user_id, room_key, slot_key)
    do update set item_key = excluded.item_key, placed_at = now();
  return true;
end;
$$;

revoke all on function public.place_sanctuary_item(text, text, text) from public;
grant execute on function public.place_sanctuary_item(text, text, text) to authenticated;
