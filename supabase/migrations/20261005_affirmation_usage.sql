-- Daily AI-affirmation budget, per account.
--
-- Every call to /api/generate-affirmations spends units from the caller's budget
-- for the day (UTC). The check and the spend are one statement so two requests
-- at once cannot both slip under the limit. Only the server (service role) can
-- touch this: the browser has no policy here and cannot grant itself more.

create table if not exists public.affirmation_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  units   integer not null default 0 check (units >= 0),
  primary key (user_id, day)
);

alter table public.affirmation_usage enable row level security;

-- Spends p_cost units if that keeps today's total within p_limit and returns the
-- new total; returns -1 (and spends nothing) if it would go over. A negative
-- p_cost refunds, never below zero.
create or replace function public.spend_affirmation_units(p_user uuid, p_cost integer, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
begin
  insert into affirmation_usage (user_id, day, units)
  values (p_user, (now() at time zone 'utc')::date, 0)
  on conflict (user_id, day) do nothing;

  update affirmation_usage
     set units = greatest(0, units + p_cost)
   where user_id = p_user
     and day = (now() at time zone 'utc')::date
     and (p_cost <= 0 or units + p_cost <= p_limit)
  returning units into total;

  return coalesce(total, -1);
end;
$$;

revoke all on function public.spend_affirmation_units(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.spend_affirmation_units(uuid, integer, integer) to service_role;
