-- Love this / Not for me, on generated affirmations.
--
-- One row per rating, written by the builder for signed-in accounts. It exists
-- so the writing styles people prefer can be understood later. Nothing trains
-- on it, and nothing reads it but its owner: the app sends a person's own
-- recent ratings back with their own later requests (from this device's copy).

create table if not exists public.affirmation_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  affirmation text not null check (char_length(affirmation) <= 400),
  rating      text not null check (rating in ('up', 'down')),
  intensity   text check (intensity is null or intensity in ('grounded', 'bold', 'delusional')),
  tone        text check (tone is null or char_length(tone) <= 40),
  created_at  timestamptz not null default now()
);

create index if not exists affirmation_feedback_user_idx
  on public.affirmation_feedback (user_id, created_at desc);

alter table public.affirmation_feedback enable row level security;

drop policy if exists "own feedback: insert" on public.affirmation_feedback;
create policy "own feedback: insert" on public.affirmation_feedback
  for insert with check (auth.uid() = user_id);

drop policy if exists "own feedback: read" on public.affirmation_feedback;
create policy "own feedback: read" on public.affirmation_feedback
  for select using (auth.uid() = user_id);
