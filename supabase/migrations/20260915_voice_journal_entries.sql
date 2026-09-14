-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
-- Gratitude and manifesting entries can now be spoken instead of typed, so each
-- entry may carry an audio recording as well as (or instead of) its text.

alter table public.journal_entries add column if not exists audio_path text;
alter table public.journal_entries add column if not exists audio_seconds integer;

-- A spoken entry has no typed text, so content can't stay mandatory. Existing
-- rows are untouched; only the requirement is lifted.
alter table public.journal_entries alter column content drop not null;

-- An entry has to be one or the other — this stops a blank row being written if
-- an upload fails halfway.
alter table public.journal_entries
  drop constraint if exists journal_entries_has_content;
alter table public.journal_entries
  add constraint journal_entries_has_content
  check (coalesce(nullif(btrim(content), ''), audio_path) is not null);

-- Private bucket for spoken entries; the app plays them back through
-- short-lived signed URLs, same as the handwritten journal photos.
insert into storage.buckets (id, name, public)
  values ('voice-notes', 'voice-notes', false)
  on conflict (id) do nothing;

-- Each person can only touch objects inside their own <user_id>/ folder.
drop policy if exists "voice-notes: own folder read" on storage.objects;
create policy "voice-notes: own folder read" on storage.objects
  for select using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "voice-notes: own folder insert" on storage.objects;
create policy "voice-notes: own folder insert" on storage.objects
  for insert with check (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "voice-notes: own folder delete" on storage.objects;
create policy "voice-notes: own folder delete" on storage.objects
  for delete using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
