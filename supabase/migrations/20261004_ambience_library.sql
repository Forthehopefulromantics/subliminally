-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- THE AMBIENCE LIBRARY: a shelf, not a product of anybody's session.
--
-- Every other piece of audio in this app belongs to one person. A cloned voice
-- is theirs, a recording is theirs, a generated affirmation is theirs and sits
-- in a folder named after their user id, behind a signed URL, in a private
-- bucket. Ambience is the opposite of all of that: five recordings, made once,
-- identical for everybody, and correct to cache for a year at the edge.
--
-- So it gets the one public bucket in the project, and a table anybody may
-- read and nobody may write from the browser:
--
--   ambience          the mp3s. Public-read, because there is nothing in them
--                     that belongs to anyone, and a signed URL that expires
--                     mid-session is a background that stops at 3am.
--   ambience_tracks   which track is which, and where its audio lives.
--
-- Nothing here is generated per user and nothing here costs an API call to
-- play. That is the point of the split: js/ambience.js has no path to
-- /api/tts, so changing your background can never regenerate your voice.
--
-- The files themselves are uploaded by scripts/upload-ambience.js, which fills
-- in storage_path and url. Until it has run — or if it never does — the site
-- plays the copies that ship in audio/ambience/, so this table is an override
-- rather than a dependency.

-- ---------- the bucket ----------
insert into storage.buckets (id, name, public)
  values ('ambience', 'ambience', true)
  on conflict (id) do update set public = true;

-- Public read. Writing is the upload script's job, with the service role, so
-- there is deliberately no insert, update or delete policy: nobody signed into
-- the app can put audio into the shared library.
drop policy if exists "ambience: readable by anyone" on storage.objects;
create policy "ambience: readable by anyone" on storage.objects
  for select using (bucket_id = 'ambience');

-- ---------- the catalogue ----------
create table if not exists public.ambience_tracks (
  -- What state.bg holds and what a saved subliminal's `background` column
  -- says. Permanent: renaming a key renames it for everybody who already
  -- chose it, so the display name is a separate column for a reason.
  key text primary key,
  display_name text not null,
  category text not null default 'Ambient',
  -- Where the object sits in the ambience bucket, and the URL the browser
  -- fetches. Both are filled in by scripts/upload-ambience.js.
  storage_path text,
  url text,
  -- How long one pass of the loop is, and the integrated loudness it was
  -- mastered to. Neither is required to play the track — the browser measures
  -- the decoded audio itself — but having them here is what makes it possible
  -- to check that a newly uploaded track was prepared properly rather than
  -- finding out at bedtime.
  --
  -- loop_seconds is the DECODED length, which is a little shorter than the
  -- length the mp3 container reports: an mp3 carries encoder padding at both
  -- ends and a browser strips it. Measured in Chromium, these come out at
  -- exactly 8, 11.5 and 27 seconds.
  loop_seconds numeric(6,3),
  loudness_lufs numeric(5,2),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ambience_tracks enable row level security;

-- Anybody may read the library, signed in or not: the ambience step is part of
-- the builder, and the builder is open to people who have not made an account
-- yet. There is no insert/update/delete policy, for the same reason the bucket
-- has none.
drop policy if exists "ambience_tracks: readable by anyone" on public.ambience_tracks;
create policy "ambience_tracks: readable by anyone" on public.ambience_tracks
  for select using (true);

-- ---------- the five that open the library ----------
-- Keys match AMBIENCE_TRACKS in js/ambience.js. `url` stays null until the
-- upload script has put the audio in the bucket; the site falls back to the
-- bundled copy in audio/ambience/ while it is, which is also what happens if
-- this table is never reachable.
insert into public.ambience_tracks (key, display_name, category, loop_seconds, loudness_lufs, sort_order)
values
  ('deep-mind',       'Deep Mind',       'Meditation',  8.000, -20.2, 10),
  ('the-sanctuary',   'The Sanctuary',   'Ambient',    27.000, -20.4, 20),
  ('ocean-escape',    'Ocean Escape',    'Nature',     11.500, -20.1, 30),
  ('soft-asmr',       'Soft ASMR',       'Sleep',      27.000, -20.2, 40),
  ('inner-stillness', 'Inner Stillness', 'Meditation', 27.000, -20.7, 50)
on conflict (key) do update set
  display_name  = excluded.display_name,
  category      = excluded.category,
  loop_seconds  = excluded.loop_seconds,
  loudness_lufs = excluded.loudness_lufs,
  sort_order    = excluded.sort_order,
  updated_at    = now();
