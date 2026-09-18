-- Signing up, and then being able to save who you are.
--
-- `profiles` had RLS on with a select policy and an update policy, and nothing
-- for insert. Every profile write in the app goes through saveProfile(), which
-- upserts -- and an upsert is an INSERT to Postgres, so it was checked against
-- an insert policy that did not exist and rejected with 42501 every time. The
-- visible symptom was the username chosen at sign-up never sticking and the app
-- telling people "You're signed out -- sign in again and retry" right after they
-- had just signed in. Eight accounts, one username between them.

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- The update policy had a USING clause but no WITH CHECK, so the row it let you
-- edit was your own but the row you left behind did not have to be.
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- The trigger that makes the profile row runs inside the transaction that
-- creates the auth user, so anything it raises fails the sign-up itself with
-- "Database error saving new user" and no confirmation email is ever sent.
-- Nothing about a profile row is worth losing an account over: take the row if
-- it can be had, and let the sign-up through either way.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.profiles (id, display_name)
    values (new.id, split_part(new.email, '@', 1))
    on conflict (id) do nothing;
  exception when others then
    raise warning 'handle_new_user: could not create profile for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- It is a trigger function; nothing should be able to call it over the API.
revoke execute on function public.handle_new_user() from anon, authenticated;
