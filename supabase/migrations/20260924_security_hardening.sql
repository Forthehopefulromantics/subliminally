-- Durable per-user quotas for server-side AI generation. The browser cannot
-- read or modify this table; only the service-role-backed API can consume it.
create table if not exists public.ai_usage_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, action, window_started_at)
);

alter table public.ai_usage_windows enable row level security;

create or replace function public.consume_ai_quota(p_user_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_count integer;
  v_limit integer := 30;
begin
  if p_user_id is null or p_action not in ('affirmations', 'eft', 'visualization') then
    raise exception 'invalid quota request' using errcode = '22023';
  end if;

  insert into public.ai_usage_windows (user_id, action, window_started_at, request_count)
  values (p_user_id, p_action, v_window, 1)
  on conflict (user_id, action, window_started_at)
  do update set request_count = ai_usage_windows.request_count + 1
  returning request_count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= v_limit,
    'remaining', greatest(v_limit - v_count, 0),
    'retry_after_seconds', greatest(1, extract(epoch from (v_window + interval '1 hour' - now()))::integer)
  );
end;
$$;

revoke all on table public.ai_usage_windows from public, anon, authenticated;
revoke all on function public.consume_ai_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text) to service_role;

-- Validate that an action actually exists before awarding Light. Sources that
-- have no separate database record use a canonical empty/date reference so a
-- caller cannot mint rewards by inventing arbitrary reference values.
create or replace function public.award_light(p_source text, p_ref text default '', p_on date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_amount integer;
  v_day date;
  v_rows integer;
  v_valid boolean := false;
  v_ref text := coalesce(p_ref, '');
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_amount := light_value(p_source);
  if v_amount <= 0 then return 0; end if;

  v_day := coalesce(p_on, (now() at time zone 'utc')::date);
  if v_day > ((now() at time zone 'utc')::date + 1)
     or v_day < ((now() at time zone 'utc')::date - 1) then
    return 0;
  end if;

  if p_source = 'habit' then
    select exists (
      select 1 from habit_checkins c
      where c.user_id = v_user and c.habit_id::text = v_ref and c.done_on = v_day
    ) into v_valid;
  elsif p_source in ('ritual_morning', 'ritual_night') then
    select count(*) > 0 and count(*) = count(c.id) into v_valid
    from habits h left join habit_checkins c
      on c.habit_id = h.id and c.user_id = v_user and c.done_on = v_day
    where h.user_id = v_user and not h.archived
      and h.time_of_day = case when p_source = 'ritual_morning' then 'morning' else 'night' end;
    v_ref := case when p_source = 'ritual_morning' then 'morning' else 'night' end;
  elsif p_source = 'non_negotiables' then
    if v_ref not in ('morning', 'night') then return 0; end if;
    select count(*) > 0 and count(*) = count(c.id) into v_valid
    from habits h left join habit_checkins c
      on c.habit_id = h.id and c.user_id = v_user and c.done_on = v_day
    where h.user_id = v_user and not h.archived and h.is_core
      and h.time_of_day = case when v_ref = 'morning' then 'morning' else 'night' end;
  elsif p_source = 'perfect_day' then
    select count(*) > 0 and count(*) = count(c.id) into v_valid
    from habits h left join habit_checkins c
      on c.habit_id = h.id and c.user_id = v_user and c.done_on = v_day
    where h.user_id = v_user and not h.archived;
    v_ref := '';
  elsif p_source = 'journal' then
    select exists (
      select 1 from journal_photos j where j.user_id = v_user and j.entry_date = v_day
    ) into v_valid;
    v_ref := v_day::text;
  elsif p_source = 'subliminal' then
    v_valid := (v_ref = '');
  elsif p_source = 'week_streak' then
    select v_ref = date_trunc('week', v_day::timestamp)::date::text
      and count(distinct c.done_on) = 7 into v_valid
    from habit_checkins c
    where c.user_id = v_user and c.done_on between v_day - 6 and v_day;
  end if;

  if not v_valid then return 0; end if;

  insert into light_ledger (user_id, amount, source, source_ref, earned_on)
  values (v_user, v_amount, p_source, v_ref, v_day)
  on conflict (user_id, source, source_ref, earned_on) do nothing;

  get diagnostics v_rows = row_count;
  return case when v_rows > 0 then v_amount else 0 end;
end;
$$;

revoke all on function public.award_light(text, text, date) from public;
grant execute on function public.award_light(text, text, date) to authenticated;
