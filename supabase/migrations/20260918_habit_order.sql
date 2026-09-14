-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
-- Lets habits be put in the order you actually do them, rather than the order
-- you happened to type them in.

alter table public.habits add column if not exists sort_order integer;

-- Existing habits keep the order they're already shown in (oldest first) so
-- nothing jumps around the first time this runs.
with ordered as (
  select id, row_number() over (partition by user_id, time_of_day order by created_at) - 1 as n
  from public.habits
)
update public.habits h set sort_order = ordered.n
from ordered where ordered.id = h.id and h.sort_order is null;

alter table public.habits alter column sort_order set default 0;
update public.habits set sort_order = 0 where sort_order is null;
alter table public.habits alter column sort_order set not null;

create index if not exists habits_user_order_idx on public.habits (user_id, time_of_day, sort_order);
