-- Persist playback mix choices without regenerating voice audio.
alter table public.subliminals
  add column if not exists mix_settings jsonb not null default '{}'::jsonb;
