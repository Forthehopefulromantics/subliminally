-- What you believe, so the app can use your words rather than someone else's.
--
-- Asked once when the account is made, and answerable with nothing at all. It
-- changes what things are called and which habits get suggested; it does not
-- change what anyone can do here or what anything costs. A null faith is the
-- neutral vocabulary, which is what someone who skips the question gets.
--
-- `faith_other` is only ever set alongside faith = 'other', and only ever used
-- as a name -- we know what they call it and nothing else about it.

alter table public.profiles
  add column if not exists faith text,
  add column if not exists faith_other text;

-- An unknown value behaves exactly like no answer in the app, but there is no
-- reason to let one into the column in the first place.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_faith_known'
  ) then
    alter table public.profiles
      add constraint profiles_faith_known check (
        faith is null or faith in
          ('christianity','islam','hinduism','spirituality','agnostic','other')
      );
  end if;
end $$;

-- Free text, and short. It is a word for what someone reaches toward, not a
-- paragraph, and it gets rendered into sentences.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_faith_other_short'
  ) then
    alter table public.profiles
      add constraint profiles_faith_other_short check (
        faith_other is null or char_length(faith_other) <= 40
      );
  end if;
end $$;

comment on column public.profiles.faith is
  'Optional. Chooses the app''s vocabulary only -- never gates a feature.';
comment on column public.profiles.faith_other is
  'Only with faith = ''other''. Used as a name, nothing else.';
