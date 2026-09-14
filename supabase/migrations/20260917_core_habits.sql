-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
-- Marks a habit as non-negotiable: the handful you do even on the nights you
-- have nothing left. Doing just these still counts as keeping the ritual, which
-- is what stops one rushed evening from ending a streak.

alter table public.habits add column if not exists is_core boolean not null default false;

-- Everything else about a short night is worked out from the check-ins that
-- already exist, so there is no extra state to keep in step.
create index if not exists habits_user_core_idx on public.habits (user_id, time_of_day, is_core);
