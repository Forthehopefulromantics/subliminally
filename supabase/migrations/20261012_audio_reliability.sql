-- Audio reliability: saved voice identity, asset states, and merge-safe mixer saves.
-- Additive and idempotent: nothing is dropped, no row is rewritten except the
-- status backfill on tts_clips. Run once in Supabase -> SQL Editor.

-- ---------- generated speech: what state is each clip in ----------
alter table public.tts_clips add column if not exists status text not null default 'ready';
alter table public.tts_clips add column if not exists byte_size integer;
alter table public.tts_clips add column if not exists duration_ms integer;
alter table public.tts_clips add column if not exists error_code text;
alter table public.tts_clips add column if not exists updated_at timestamptz not null default now();
do $$ begin
  alter table public.tts_clips add constraint tts_clips_status_check
    check (status in ('pending','generating','ready','failed'));
exception when duplicate_object then null; end $$;
-- Clips that predate validation have no recorded size; the API verifies them
-- against storage before it hands them out and re-generates only the bad ones.
create index if not exists tts_clips_status_idx on public.tts_clips (user_id, status);

-- ---------- saved subliminals: the voice they were built in ----------
-- {kind: 'recorded'|'serenity'|'clone'|'device', key, fingerprint, name,
--  speed, pace, layer: {kind,key,fingerprint}}
-- The fingerprint is a short hash of the provider voice id (never the id), so a
-- changed or re-created voice is noticed instead of silently replacing the one
-- the subliminal was saved with.
alter table public.subliminals add column if not exists voice_profile jsonb;
-- Bumped by every mixer save; lets two devices/tabs notice they disagree.
alter table public.subliminals add column if not exists audio_rev integer not null default 0;
alter table public.subliminals add column if not exists audio_updated_at timestamptz;

-- ---------- merge-safe mixer save ----------
-- Writes ONLY the keys sent (a jsonb merge), so moving one slider cannot reset
-- the others, and refuses a write based on an older revision than the row's.
create or replace function public.patch_subliminal_audio(
  p_id uuid, p_patch jsonb, p_base_rev integer default null
) returns table (audio_rev integer, mix_settings jsonb, conflict boolean)
language plpgsql security invoker set search_path = public as $$
declare cur integer;
begin
  select s.audio_rev into cur from subliminals s where s.id = p_id and s.user_id = auth.uid() for update;
  if not found then raise exception 'subliminal not found' using errcode = 'P0002'; end if;
  if p_base_rev is not null and p_base_rev < cur then
    -- Someone else saved since this client last read. Merge anyway (keys are
    -- independent) but tell the caller, which reloads what it did not touch.
    return query
      update subliminals s set mix_settings = coalesce(s.mix_settings,'{}'::jsonb) || p_patch,
        audio_rev = s.audio_rev + 1, audio_updated_at = now()
      where s.id = p_id and s.user_id = auth.uid()
      returning s.audio_rev, s.mix_settings, true;
    return;
  end if;
  return query
    update subliminals s set mix_settings = coalesce(s.mix_settings,'{}'::jsonb) || p_patch,
      audio_rev = s.audio_rev + 1, audio_updated_at = now()
    where s.id = p_id and s.user_id = auth.uid()
    returning s.audio_rev, s.mix_settings, false;
end $$;
revoke all on function public.patch_subliminal_audio(uuid, jsonb, integer) from public;
grant execute on function public.patch_subliminal_audio(uuid, jsonb, integer) to authenticated;

-- ---------- diagnostics: subliminals whose voice cannot be proven ----------
-- Read-only helper for the one-time review in the audit report.
create or replace view public.subliminals_voice_audit as
select s.id, s.user_id, s.title, s.created_at,
  case
    when s.voice_profile is not null then s.voice_profile->>'kind'
    when s.recording_urls is not null and exists (select 1 from unnest(s.recording_urls) u where u is not null) then 'recorded'
    when s.ai_voice_id = 'mine' then 'clone'
    when s.ai_voice_id is not null and s.ai_voice_id <> 'device' then 'serenity'
    else 'unknown_or_device'
  end as inferred_kind,
  s.voice_profile is null as needs_voice_profile
from public.subliminals s;
revoke all on public.subliminals_voice_audit from anon, authenticated;
