-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- Visualization: one believable scene from a person's future, written with them,
-- narrated once by Serenity, and kept.
--
-- Four things live here, and the split is the point of the file:
--
--   visualizations              the story, its audio settings, and a pointer to
--                               the narration that was generated for it
--   visualization_narrations    the ledger: one row per attempt to generate a
--                               narration. This is what the daily limit is read
--                               off, and only a *succeeded* row counts.
--   visualization_settings      the limits, as data. `daily_visualization_narration_limit`
--                               is changed here (or by VISUALIZATION_DAILY_NARRATION_LIMIT
--                               on the server) — it is not written into the app.
--   the visualization-audio     private bucket holding the narration mp3s.
--                               Written by the server only.
--
-- NARRATION IS NEVER WRITTEN BY THE BROWSER. A signed-in person may insert and
-- update their own story and every audio *setting* (frequency, theta wave,
-- nature sound, the three volumes, cover, title). The columns that say "a
-- narration exists, it matches this script, it cost one of today's
-- generations" are written by /api/visualization with the service role, and a
-- trigger below puts them back if anybody else tries. Without that, the limit
-- would be a suggestion.

-- ---------------------------------------------------------------- settings
create table if not exists public.visualization_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
-- Server-only: RLS on and no policy, so only the service role can read or write.
alter table public.visualization_settings enable row level security;

insert into public.visualization_settings (key, value)
values ('daily_visualization_narration_limit', '1'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- the story
create table if not exists public.visualizations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  title         text not null default 'Untitled visualization' check (char_length(title) <= 120),

  -- How it was made. `qa` is every question asked and what was answered, in
  -- order, so a half-finished creation can be picked up where it stopped.
  initial_desire text not null default '' check (char_length(initial_desire) <= 1000),
  qa            jsonb not null default '[]'::jsonb,
  -- 'questions' while still being asked, 'written' once there is a story.
  stage         text not null default 'questions' check (stage in ('questions', 'written')),

  -- generated_script is what the AI first wrote and is never overwritten by an
  -- edit; script is what the person has made of it. Narration reads `script`.
  generated_script text check (char_length(generated_script) <= 12000),
  script        text check (char_length(script) <= 12000),
  -- Computed by the trigger below from `script`, never sent by the browser, so
  -- there is exactly one definition of "the story changed".
  script_hash   text,

  -- The saved narration. Server-written. narration_script_hash is the
  -- script_hash the audio was generated from: when it differs from script_hash
  -- the story has moved on and the audio has not.
  narration_path             text,
  narration_script_hash      text,
  narration_generated_at     timestamptz,
  narration_duration_seconds numeric,
  narration_status           text not null default 'none'
                             check (narration_status in ('none', 'ready', 'failed')),

  -- The audio layers. Changing any of these never touches the narration.
  frequency_hz     integer check (frequency_hz is null or frequency_hz between 20 and 2000),
  theta_wave       text    not null default 'off' check (theta_wave in ('off', 'delta', 'theta', 'alpha')),
  nature_sound     text    not null default 'none' check (char_length(nature_sound) <= 40),
  narration_volume integer not null default 100 check (narration_volume between 0 and 100),
  frequency_volume integer not null default 25  check (frequency_volume between 0 and 100),
  nature_volume    integer not null default 35  check (nature_volume between 0 and 100),

  -- 'builtin:night' for one of the covers that ship with the app, otherwise a
  -- path in the covers bucket. Stored apart from the audio on purpose.
  cover_path    text check (cover_path is null or char_length(cover_path) <= 200),

  -- The saved faith answer the story was written in the language of (an id from
  -- lib/faith-language.js), recorded for the person's reference. Server-written.
  faith_used    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists visualizations_user_updated_idx
  on public.visualizations (user_id, updated_at desc);

alter table public.visualizations enable row level security;

drop policy if exists "read own visualizations" on public.visualizations;
create policy "read own visualizations" on public.visualizations
  for select using (auth.uid() = user_id);

drop policy if exists "create own visualizations" on public.visualizations;
create policy "create own visualizations" on public.visualizations
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own visualizations" on public.visualizations;
create policy "update own visualizations" on public.visualizations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No delete policy. Deleting goes through /api/visualization, which also removes
-- the narration file, so audio is never left in the bucket with nothing pointing
-- at it.

-- One trigger, three jobs: keep updated_at honest, compute script_hash, and keep
-- the narration columns server-only.
create or replace function public.visualizations_before_write()
returns trigger
language plpgsql
as $$
declare
  normalized text;
begin
  -- The hash is of the story as it will be *read*, so a trailing space or a
  -- doubled space — which sound identical — is not a change worth a second
  -- narration. Paragraph breaks are kept: they are where the pauses are.
  -- Mirrors normalizeScript() in lib/visualization/config.js.
  if new.script is null or btrim(new.script) = '' then
    new.script_hash := null;
  else
    normalized := regexp_replace(new.script, E'\\r\\n?', E'\n', 'g');
    normalized := regexp_replace(normalized, E'[ \\t]+', ' ', 'g');
    normalized := regexp_replace(normalized, E' ?\n ?', E'\n', 'g');
    normalized := regexp_replace(normalized, E'\n{3,}', E'\n\n', 'g');
    normalized := btrim(normalized);
    new.script_hash := encode(sha256(convert_to(normalized, 'UTF8')), 'hex');
  end if;

  new.updated_at := now();

  -- PostgREST runs a signed-in person's request as `authenticated` (and a
  -- signed-out one as `anon`); the service role is neither. Anything those two
  -- send for the server-owned columns is discarded rather than rejected, so a
  -- stale client that still posts a whole row keeps working.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.narration_path := null;
      new.narration_script_hash := null;
      new.narration_generated_at := null;
      new.narration_duration_seconds := null;
      new.narration_status := 'none';
      new.faith_used := null;
    else
      new.narration_path := old.narration_path;
      new.narration_script_hash := old.narration_script_hash;
      new.narration_generated_at := old.narration_generated_at;
      new.narration_duration_seconds := old.narration_duration_seconds;
      new.narration_status := old.narration_status;
      new.faith_used := old.faith_used;
      new.user_id := old.user_id;
      -- The first draft is a record of what the AI wrote: it can be set once, when
      -- the story is first written, and never overwritten by an edit (edits go
      -- in `script`).
      new.generated_script := coalesce(old.generated_script, new.generated_script);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists visualizations_before_write on public.visualizations;
create trigger visualizations_before_write
  before insert or update on public.visualizations
  for each row execute function public.visualizations_before_write();

-- ---------------------------------------------------------------- the ledger
create table if not exists public.visualization_narrations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- Deliberately not a foreign key: deleting a visualization must not give the
  -- person their narration for the day back.
  visualization_id uuid not null,
  script_hash      text,
  character_count  integer,
  -- 'pending' while Serenity is working. 'succeeded' is the only status that
  -- counts toward the daily limit; 'failed' costs nothing.
  status           text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  error_code       text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index if not exists visualization_narrations_user_day_idx
  on public.visualization_narrations (user_id, completed_at desc)
  where status = 'succeeded';

-- A person can have one narration in flight at a time, and one visualization can
-- have one narration in flight at a time. This is what makes a double tap, a
-- second tab, or a re-render unable to start a second paid generation: the
-- second insert is refused by the database, not by a hope.
create unique index if not exists visualization_narrations_one_pending_per_user
  on public.visualization_narrations (user_id) where status = 'pending';
create unique index if not exists visualization_narrations_one_pending_per_viz
  on public.visualization_narrations (visualization_id) where status = 'pending';

alter table public.visualization_narrations enable row level security;

-- A person can see their own usage (the app shows "used today's narration") and
-- nobody else's. Only the server writes.
drop policy if exists "read own narration ledger" on public.visualization_narrations;
create policy "read own narration ledger" on public.visualization_narrations
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------- the audio
-- Private. The server writes with the service role; a person may read (and so
-- sign links for) only the files inside a folder named after their own id.
insert into storage.buckets (id, name, public)
values ('visualization-audio', 'visualization-audio', false)
on conflict (id) do nothing;

drop policy if exists "read own visualization audio" on storage.objects;
create policy "read own visualization audio" on storage.objects
  for select using (
    bucket_id = 'visualization-audio' and auth.uid()::text = (storage.foldername(name))[1]
  );
