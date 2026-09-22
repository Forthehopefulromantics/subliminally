-- Player choices travel with an account while localStorage remains the offline fallback.
alter table public.profiles
  add column if not exists player_preferences jsonb not null default '{}'::jsonb;

create table if not exists public.listening_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subliminal_id uuid references public.subliminals(id) on delete set null,
  seconds_listened integer not null check (seconds_listened >= 0),
  completed boolean not null default false,
  ambience_key text,
  loop_mode text check (loop_mode in ('entire','current','none')),
  created_at timestamptz not null default now()
);

alter table public.listening_sessions enable row level security;
drop policy if exists "Users read own listening sessions" on public.listening_sessions;
create policy "Users read own listening sessions" on public.listening_sessions for select using (auth.uid() = user_id);
drop policy if exists "Users create own listening sessions" on public.listening_sessions;
create policy "Users create own listening sessions" on public.listening_sessions for insert with check (auth.uid() = user_id);
