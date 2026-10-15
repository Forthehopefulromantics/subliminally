-- Own-voice recordings are now uploaded one take at a time, as they are made
-- (up to 100 per subliminal), to <user_id>/takes/<take id>.<ext>.
--
-- The `recordings` bucket predates the migrations in this folder (it was made in
-- the dashboard), so this only makes sure it is there and private and that each
-- person can read, add and remove objects inside their OWN <user_id>/ folder --
-- the rule the app depends on, and the reason one person's recordings can never
-- be reached with another's account. It changes nothing that already exists:
-- the bucket is created only if missing, and the policies carry names of their
-- own, so any policy already on the bucket keeps working alongside them.
--
-- Files are never overwritten (every take has its own name) and the app only
-- deletes an upload that no saved subliminal lists (see
-- removeUnreferencedRecordings in js/builder.js).

insert into storage.buckets (id, name, public)
  values ('recordings', 'recordings', false)
  on conflict (id) do nothing;

drop policy if exists "recordings: own folder read" on storage.objects;
create policy "recordings: own folder read" on storage.objects
  for select using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "recordings: own folder insert" on storage.objects;
create policy "recordings: own folder insert" on storage.objects
  for insert with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "recordings: own folder delete" on storage.objects;
create policy "recordings: own folder delete" on storage.objects
  for delete using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
