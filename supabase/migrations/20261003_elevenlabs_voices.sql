-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- The voice side of the studio, given somewhere to live:
--
--   user_voice_profiles  the voice somebody has had cloned at the speech
--                        provider, against their own account
--   tts_clips            every piece of speech already generated, and where the
--                        mp3 sits — so the same line in the same voice is never
--                        paid for twice
--   tts_generations      the ledger: who asked for what, how many characters,
--                        whether it came out of the cache, and when. The rate
--                        limits are read off this, so they survive a cold start
--   tts-cache (bucket)   the mp3s themselves, private, one folder per person
--
-- Everything here is row-level-secured to the signed-in user, and every write
-- goes through /api/tts and /api/voice-clone with the service role — the browser
-- never writes these tables and never sees a provider voice id.

-- ---------- the voice somebody has of their own ----------
create table if not exists public.user_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'elevenlabs',
  provider_voice_id text not null,
  display_name text not null default 'My voice',
  -- When they confirmed the voice was theirs and theirs to use. The confirmation
  -- is required before a clone is created (see /api/voice-clone), so this is the
  -- record of it rather than a nicety.
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  -- One voice per person per provider. Cloning again replaces it rather than
  -- adding a second, which is also what stops a new clone per subliminal.
  unique (user_id, provider)
);
create index if not exists user_voice_profiles_user_idx on public.user_voice_profiles (user_id);
alter table public.user_voice_profiles enable row level security;

-- You can read your own voice record and nobody else's. There is deliberately no
-- insert/update/delete policy: creating or removing a voice has to also create or
-- remove it at the provider, which only the API routes can do.
drop policy if exists "user_voice_profiles: own rows readable" on public.user_voice_profiles;
create policy "user_voice_profiles: own rows readable" on public.user_voice_profiles
  for select using (auth.uid() = user_id);

-- Anybody who cloned a voice before this table existed keeps it. The id was on
-- their profile; this is the same voice, recorded properly.
insert into public.user_voice_profiles (user_id, provider, provider_voice_id, display_name)
select p.id, 'elevenlabs', p.cloned_voice_id, 'My voice'
from public.profiles p
where p.cloned_voice_id is not null and btrim(p.cloned_voice_id) <> ''
on conflict (user_id, provider) do nothing;

-- ---------- generated speech, kept ----------
create table if not exists public.tts_clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The provider's voice id. Server-side only; RLS keeps it to its owner.
  voice_id text not null,
  -- What identifies one piece of *audio*: the words, the voice, the pace and the
  -- model. The same line read by a different voice is a different clip.
  clip_key text not null,
  -- The words alone. This is what the ledger records and what a duplicate check
  -- means by "the same affirmation text".
  text_hash text not null,
  speed numeric(3,2) not null default 1,
  model_id text not null,
  character_count integer not null default 0,
  storage_path text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (user_id, clip_key)
);
create index if not exists tts_clips_user_voice_idx on public.tts_clips (user_id, voice_id);
create index if not exists tts_clips_last_used_idx on public.tts_clips (last_used_at);
alter table public.tts_clips enable row level security;

drop policy if exists "tts_clips: own rows readable" on public.tts_clips;
create policy "tts_clips: own rows readable" on public.tts_clips
  for select using (auth.uid() = user_id);

-- ---------- the ledger the cost protection reads ----------
create table if not exists public.tts_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_id text not null,
  text_hash text not null,
  character_count integer not null default 0,
  -- True when the audio already existed, so nothing was generated and nothing was
  -- charged. The rate limits count only the rows where this is false.
  cache_hit boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tts_generations_user_time_idx on public.tts_generations (user_id, created_at desc);
alter table public.tts_generations enable row level security;

drop policy if exists "tts_generations: own rows readable" on public.tts_generations;
create policy "tts_generations: own rows readable" on public.tts_generations
  for select using (auth.uid() = user_id);

-- ---------- the mp3s ----------
-- Private, like recordings and covers: this is somebody's own voice, or their own
-- affirmations read aloud. The player fetches them through short-lived signed
-- URLs minted server-side.
insert into storage.buckets (id, name, public)
  values ('tts-cache', 'tts-cache', false)
  on conflict (id) do nothing;

-- Each person can only read inside a folder named after their own id. Writing is
-- the API's job, with the service role, so there is no insert policy: a caller
-- cannot put audio of their own into the cache and have it served as generated.
drop policy if exists "tts-cache: own folder read" on storage.objects;
create policy "tts-cache: own folder read" on storage.objects
  for select using (bucket_id = 'tts-cache' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- saved subliminals: voice keys instead of provider ids ----------
-- The picker used to store the raw ElevenLabs id on the subliminal. It stores a
-- key now ('sarah', 'daniel', 'mine'), so the rows that were written the old way
-- are rewritten to say the same thing in the new language. Anything already a key,
-- or 'device', or null, is left exactly as it is.
update public.subliminals s
set ai_voice_id = 'mine'
from public.profiles p
where p.id = s.user_id and s.ai_voice_id is not null and s.ai_voice_id = p.cloned_voice_id;

update public.subliminals s
set layer_ai_voice_id = 'mine'
from public.profiles p
where p.id = s.user_id and s.layer_ai_voice_id is not null and s.layer_ai_voice_id = p.cloned_voice_id;

with voice_keys(provider_voice_id, voice_key) as (
  values
    ('EXAVITQu4vr4xnSDxMaL', 'sarah'),
    ('XB0fDUnXU5powFXDhCwa', 'charlotte'),
    ('Xb7hH8MSUJpSbSDYk0k2', 'alice'),
    ('pFZP5JQG7iQjIQuC4Bku', 'lily'),
    ('onwK4e9ZLuTAKqWW03F9', 'daniel'),
    ('JBFqnCBsd6RMkjVDRZzb', 'george')
)
update public.subliminals s
set ai_voice_id = v.voice_key
from voice_keys v
where s.ai_voice_id = v.provider_voice_id;

with voice_keys(provider_voice_id, voice_key) as (
  values
    ('EXAVITQu4vr4xnSDxMaL', 'sarah'),
    ('XB0fDUnXU5powFXDhCwa', 'charlotte'),
    ('Xb7hH8MSUJpSbSDYk0k2', 'alice'),
    ('pFZP5JQG7iQjIQuC4Bku', 'lily'),
    ('onwK4e9ZLuTAKqWW03F9', 'daniel'),
    ('JBFqnCBsd6RMkjVDRZzb', 'george')
)
update public.subliminals s
set layer_ai_voice_id = v.voice_key
from voice_keys v
where s.layer_ai_voice_id = v.provider_voice_id;
