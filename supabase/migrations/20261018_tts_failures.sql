-- Run once in Supabase -> SQL Editor.
--
-- Serenity diagnostics: one row per failed generation, save or playback check.
-- Codes and stages only — never affirmation text, audio, provider response bodies
-- or keys. Written with the service role by /api/tts and /api/tts-report; the
-- browser can neither read nor write it (RLS on, deliberately no policies).
--
-- Nothing depends on this table to work: if it is missing, failures are logged to
-- the function log instead and the app behaves exactly the same.

create table if not exists public.tts_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  voice_key text,
  code text not null,
  stage text not null,
  http_status integer,
  attempts integer,
  source text not null default 'server' check (source in ('server', 'client')),
  alerted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tts_failures_created_idx on public.tts_failures (created_at desc);
alter table public.tts_failures enable row level security;
