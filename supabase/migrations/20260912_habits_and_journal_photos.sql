-- Run this once in Supabase -> SQL Editor.
-- Adds the tables behind the Daily log (photographed journal pages) and the
-- morning/night Habit tracker, plus the private storage bucket the photos
-- live in. Everything is row-level-secured to the signed-in user.

-- ---------- Daily log: photos of handwritten journal pages ----------
create table if not exists public.journal_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  caption text,
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists journal_photos_user_date_idx on public.journal_photos (user_id, entry_date desc);
alter table public.journal_photos enable row level security;
create policy "journal_photos: own rows" on public.journal_photos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private bucket; the app reads pages back through short-lived signed URLs.
insert into storage.buckets (id, name, public)
  values ('journal-photos', 'journal-photos', false)
  on conflict (id) do nothing;

-- Each person can only touch objects inside their own <user_id>/ folder.
create policy "journal-photos: own folder read" on storage.objects
  for select using (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "journal-photos: own folder insert" on storage.objects
  for insert with check (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "journal-photos: own folder delete" on storage.objects
  for delete using (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Habit tracker: morning & night rituals ----------
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  time_of_day text not null check (time_of_day in ('morning', 'night')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists habits_user_idx on public.habits (user_id, archived);
alter table public.habits enable row level security;
create policy "habits: own rows" on public.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.habit_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  done_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (habit_id, done_on)
);
create index if not exists habit_checkins_user_day_idx on public.habit_checkins (user_id, done_on desc);
alter table public.habit_checkins enable row level security;
create policy "habit_checkins: own rows" on public.habit_checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
