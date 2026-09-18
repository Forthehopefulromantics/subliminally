-- Verifies the sign-up -> profile path the way PostgREST sees it: as the
-- `authenticated` role with a JWT claim, which is the layer the app's profile
-- saves were being rejected at. Rolls itself back; run it with
--   supabase db execute --file scripts/verify-auth-flow.sql
-- or paste it into the SQL editor.
do $$
declare
  uid uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  results text := '';
  step text;
begin
  -- a new auth user, as a sign-up makes one; the trigger should make the profile
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'verify-'||uid||'@example.invalid', 'x', now(), now(), '{"provider":"email"}', '{}');

  results := results || case when exists (select 1 from public.profiles where id = uid)
    then E'PASS  handle_new_user created the profile row\n'
    else E'FAIL  handle_new_user created the profile row\n' end;

  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- what saveProfile() does: an upsert, which is an INSERT to RLS
  begin
    insert into public.profiles (id, username) values (uid, 'verify_'||substr(uid::text,1,8))
      on conflict (id) do update set username = excluded.username;
    step := E'PASS  saveProfile() upsert is allowed on your own row\n';
  exception when others then
    step := E'FAIL  saveProfile() upsert is allowed on your own row -> '||sqlstate||' '||sqlerrm||E'\n';
  end;
  results := results || step;

  -- and a second save, the way onboarding writes again
  begin
    insert into public.profiles (id, higher_self_name) values (uid, 'Kaly')
      on conflict (id) do update set higher_self_name = excluded.higher_self_name;
    step := E'PASS  a second save (onboarding) is allowed\n';
  exception when others then
    step := E'FAIL  a second save (onboarding) is allowed -> '||sqlstate||E'\n';
  end;
  results := results || step;

  results := results || case when (select username from public.profiles where id = uid) is not null
    then E'PASS  the username actually landed on the row\n'
    else E'FAIL  the username actually landed on the row\n' end;

  -- somebody else's row is not yours to write
  begin
    insert into public.profiles (id, username) values (other, 'not_mine');
    step := E'FAIL  another user''s profile is out of reach -> it was allowed\n';
  exception when insufficient_privilege then
    step := E'PASS  another user''s profile is out of reach\n';
  when others then
    step := E'PASS  another user''s profile is out of reach ('||sqlstate||E')\n';
  end;
  results := results || step;

  -- nor is re-keying your own row onto someone else
  begin
    update public.profiles set id = other where id = uid;
    step := E'FAIL  your row cannot be re-keyed onto someone else -> it was allowed\n';
  exception when others then
    step := E'PASS  your row cannot be re-keyed onto someone else\n';
  end;
  results := results || step;

  perform set_config('role', 'postgres', true);
  raise exception E'\n%', results;
end $$;
