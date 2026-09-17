-- Run this once in Supabase -> SQL Editor, after the earlier migrations.
--
-- Cover art for a saved subliminal, so the library reads like a playlist rather
-- than a list of settings.
--
-- One column, not a table. A cover is one image belonging to one subliminal;
-- a second table would buy nothing and cost a join on every library load.
alter table public.subliminals add column if not exists cover_path text;

-- The bucket. Private, like recordings: these are someone's own pictures, and
-- a signed link when the library loads is not expensive.
insert into storage.buckets (id, name, public)
values ('covers', 'covers', false)
on conflict (id) do nothing;

-- Each person reads and writes only inside a folder named after their own id.
-- The path is checked rather than trusted, so a crafted upload cannot land in
-- someone else's folder.
drop policy if exists "read own covers" on storage.objects;
create policy "read own covers" on storage.objects
  for select using (
    bucket_id = 'covers' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "write own covers" on storage.objects;
create policy "write own covers" on storage.objects
  for insert with check (
    bucket_id = 'covers' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "replace own covers" on storage.objects;
create policy "replace own covers" on storage.objects
  for update using (
    bucket_id = 'covers' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "remove own covers" on storage.objects;
create policy "remove own covers" on storage.objects
  for delete using (
    bucket_id = 'covers' and auth.uid()::text = (storage.foldername(name))[1]
  );
