-- Run this once in Supabase -> SQL Editor, after 20260912_habits_and_journal_photos.sql.
-- The Daily log is now a calendar (one photo per day, tap a day to check in or
-- replace it), so journal_photos needs a uniqueness guarantee on
-- (user_id, entry_date) for the app's upsert-on-checkin to work.

-- Safety net: if any day somehow already has more than one photo, keep only
-- the newest row and drop the rest before the constraint is added. Their
-- storage objects are left in place — harmless leftover files, no longer
-- referenced by any row.
delete from public.journal_photos a
using public.journal_photos b
where a.user_id = b.user_id
  and a.entry_date = b.entry_date
  and a.created_at < b.created_at;

alter table public.journal_photos
  add constraint journal_photos_user_date_unique unique (user_id, entry_date);
