-- Marketing consent + Resend contact sync.
--
-- Run once in Supabase -> SQL Editor (or `supabase db push`), after the earlier
-- migrations. Nothing here calls Resend, sends an email or changes an existing
-- account's consent: legacy users are given an `unknown` row and stay there.
--
-- What it adds
--   marketing_consent       one row per account: subscribed | unsubscribed | unknown,
--                           when, which disclosure wording (version), and where it came from.
--                           Users may READ their own row; every write goes through
--                           set_marketing_consent() (own account only) or service-role code.
--   email_suppressions      opt-outs / bounces / complaints keyed by normalized email. Survives
--                           account deletion, so a deleted-then-recreated address is not mailed.
--   marketing_outbox        queue of "reconcile this contact with Resend" events. Triggers only
--                           ever insert here (local, fast); the Edge Function does the network work.
--   resend_webhook_events   svix-id ledger, so a redelivered webhook is applied once.
--   app_admins              who may read the sync health report / replay failed events.
--
-- Rollback: supabase/rollback/20261017_marketing_consent_sync_down.sql

-- ---------------------------------------------------------------- helpers

create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$ select nullif(lower(btrim(p_email)), '') $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.marketing_consent (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  status           text not null default 'unknown'
                     check (status in ('subscribed', 'unsubscribed', 'unknown')),
  -- When `status` last changed by a person or by Resend. NULL while unknown.
  consent_at       timestamptz,
  -- Which version of the signup / settings disclosure wording was on screen.
  consent_version  text check (consent_version is null or consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  consent_source   text check (consent_source in (
                     'signup_email', 'signup_google', 'signup_apple', 'settings',
                     'resend_webhook', 'resend_reconcile', 'resend_backfill')),
  email_normalized text,          -- last known address; kept so deletion can still name it
  -- What Resend was last told, so an email change or deletion can clean up the old contact.
  resend_contact_id text,
  synced_status    text check (synced_status in ('subscribed', 'unsubscribed')),
  synced_email     text,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint marketing_consent_subscribed_has_proof
    check (status <> 'subscribed' or (consent_at is not null and consent_version is not null and consent_source is not null))
);

create index if not exists marketing_consent_status_idx on public.marketing_consent (status);
create index if not exists marketing_consent_email_idx on public.marketing_consent (email_normalized);

create table if not exists public.email_suppressions (
  email_normalized text primary key,
  reason           text not null check (reason in ('unsubscribed', 'bounced', 'complained')),
  source           text not null,
  event_at         timestamptz not null,   -- when it happened at the provider, not when we heard
  updated_at       timestamptz not null default now()
);

create table if not exists public.marketing_outbox (
  id               bigint generated always as identity primary key,
  user_id          uuid,                   -- deliberately no FK: delete events outlive the user
  email_normalized text not null,
  event_type       text not null check (event_type in
                     ('signup', 'consent_change', 'email_change', 'delete', 'backfill', 'replay')),
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                     check (status in ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);

-- One waiting reconcile event per user: newer ones merge into it. Delete events never merge.
create unique index if not exists marketing_outbox_one_pending_per_user
  on public.marketing_outbox (user_id)
  where status = 'pending' and event_type <> 'delete';
create index if not exists marketing_outbox_due_idx
  on public.marketing_outbox (next_attempt_at) where status in ('pending', 'processing');

create table if not exists public.resend_webhook_events (
  svix_id      text primary key,
  event_type   text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  outcome      text
);

create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- privileges / RLS
-- Supabase grants new public tables to anon + authenticated by default. Take it all
-- back, then give signed-in users read access to their own consent row and nothing else.

alter table public.marketing_consent     enable row level security;
alter table public.email_suppressions    enable row level security;
alter table public.marketing_outbox      enable row level security;
alter table public.resend_webhook_events enable row level security;
alter table public.app_admins            enable row level security;

revoke all on public.marketing_consent, public.email_suppressions, public.marketing_outbox,
              public.resend_webhook_events, public.app_admins from anon, authenticated;
grant select on public.marketing_consent to authenticated;

drop policy if exists "marketing_consent: read own" on public.marketing_consent;
create policy "marketing_consent: read own" on public.marketing_consent
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policy exists for anyone but the service role (which bypasses RLS).

-- ---------------------------------------------------------------- outbox plumbing

-- Pokes the sync Edge Function through pg_net (asynchronous, after commit). The URL and
-- shared secret live in Supabase Vault, never in this file; if they are not set up yet, or
-- anything at all goes wrong, this does nothing and the event simply waits in the outbox
-- for the scheduled drain. Account creation can never depend on it.
create or replace function public.marketing_kick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if coalesce(current_setting('marketing.skip_kick', true), '') = 'on' then return; end if;
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'marketing_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'marketing_sync_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('action', 'drain'),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'marketing_kick skipped: %', sqlerrm;
end;
$$;

create or replace function public.marketing_enqueue(
  p_user uuid, p_email text, p_type text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_type = 'delete' then
    insert into public.marketing_outbox (user_id, email_normalized, event_type, payload)
    values (p_user, coalesce(public.normalize_email(p_email), ''), p_type, p_payload);
  else
    insert into public.marketing_outbox (user_id, email_normalized, event_type, payload)
    values (p_user, coalesce(public.normalize_email(p_email), ''), p_type, p_payload)
    on conflict (user_id) where status = 'pending' and event_type <> 'delete'
    do update set payload          = public.marketing_outbox.payload || excluded.payload,
                  email_normalized = excluded.email_normalized,
                  next_attempt_at  = least(public.marketing_outbox.next_attempt_at, now());
  end if;
  perform public.marketing_kick();
end;
$$;

-- ---------------------------------------------------------------- triggers

-- New account. Reads the signup checkbox from user metadata. The whole body is wrapped so
-- that nothing in here can ever fail a signup. An opt-in only counts when it comes from an
-- email signup with a valid disclosure version; it still has to be proven by the person
-- confirming their email before anything is sent to Resend.
create or replace function public.marketing_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opt boolean;
  v_ver text;
begin
  begin
    v_opt := lower(coalesce(new.raw_user_meta_data ->> 'marketing_opt_in', '')) = 'true'
             and (new.raw_app_meta_data ->> 'provider') = 'email';
    v_ver := left(new.raw_user_meta_data ->> 'marketing_consent_version', 32);
    if v_ver is null or v_ver !~ '^[A-Za-z0-9._-]+$' then v_opt := false; v_ver := null; end if;

    insert into public.marketing_consent
      (user_id, status, consent_at, consent_version, consent_source, email_normalized)
    values (
      new.id,
      case when v_opt then 'subscribed' else 'unknown' end,
      case when v_opt then now() end,
      case when v_opt then v_ver end,
      case when v_opt then 'signup_email' end,
      public.normalize_email(new.email))
    on conflict (user_id) do nothing;
  exception when others then
    raise warning 'marketing_handle_new_user skipped for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_marketing on auth.users;
create trigger on_auth_user_created_marketing
  after insert on auth.users
  for each row execute function public.marketing_handle_new_user();

-- Consent changed (or a subscribed row was created): queue a reconcile. Changes that came
-- FROM Resend are not queued back -- Resend already knows, and echoing them is how loops start.
create or replace function public.marketing_consent_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if tg_op = 'INSERT' and new.status <> 'subscribed' then return new; end if;
  if new.consent_source in ('resend_webhook', 'resend_reconcile', 'resend_backfill') then return new; end if;

  select public.normalize_email(email) into v_email from auth.users where id = new.user_id;
  perform public.marketing_enqueue(
    new.user_id, coalesce(v_email, new.email_normalized),
    case when tg_op = 'INSERT' then 'signup' else 'consent_change' end,
    case when new.status = 'subscribed'
         then jsonb_build_object('optin_at', new.consent_at) else '{}'::jsonb end);
  return new;
end;
$$;

create or replace function public.marketing_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists marketing_consent_touch on public.marketing_consent;
create trigger marketing_consent_touch
  before update on public.marketing_consent
  for each row execute function public.marketing_touch();

drop trigger if exists marketing_consent_enqueue_ins on public.marketing_consent;
create trigger marketing_consent_enqueue_ins
  after insert on public.marketing_consent
  for each row execute function public.marketing_consent_enqueue();

drop trigger if exists marketing_consent_enqueue_upd on public.marketing_consent;
create trigger marketing_consent_enqueue_upd
  after update of status on public.marketing_consent
  for each row execute function public.marketing_consent_enqueue();

-- Account deleted (the cascade from auth.users lands here): tell Resend to forget the address.
create or replace function public.marketing_consent_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.marketing_enqueue(
    old.user_id, old.email_normalized, 'delete',
    jsonb_build_object('email', old.email_normalized, 'synced_email', old.synced_email));
  return old;
exception when others then
  raise warning 'marketing_consent_deleted skipped for %: %', old.user_id, sqlerrm;
  return old;
end;
$$;

drop trigger if exists marketing_consent_delete_enqueue on public.marketing_consent;
create trigger marketing_consent_delete_enqueue
  before delete on public.marketing_consent
  for each row execute function public.marketing_consent_deleted();

-- Email changed, or an address just got verified. Wrapped like the signup trigger.
create or replace function public.marketing_handle_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.marketing_consent;
begin
  begin
    insert into public.marketing_consent (user_id, email_normalized)
    values (new.id, public.normalize_email(new.email))
    on conflict (user_id) do nothing;

    select * into v_row from public.marketing_consent where user_id = new.id;
    update public.marketing_consent
       set email_normalized = public.normalize_email(new.email)
     where user_id = new.id
       and email_normalized is distinct from public.normalize_email(new.email);

    if v_row.status <> 'unknown' or v_row.synced_email is not null then
      perform public.marketing_enqueue(
        new.id, public.normalize_email(new.email),
        case when old.email is distinct from new.email then 'email_change' else 'signup' end,
        case when v_row.status = 'subscribed'
             then jsonb_build_object('optin_at', v_row.consent_at) else '{}'::jsonb end);
    end if;
  exception when others then
    raise warning 'marketing_handle_email_change skipped for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed_marketing on auth.users;
create trigger on_auth_user_email_changed_marketing
  after update of email, email_confirmed_at on auth.users
  for each row
  when (old.email is distinct from new.email
        or (old.email_confirmed_at is null and new.email_confirmed_at is not null))
  execute function public.marketing_handle_email_change();

-- ---------------------------------------------------------------- user-facing RPCs

create or replace function public.set_marketing_consent(
  p_subscribed boolean,
  p_source text default 'settings',
  p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_target  text := case when p_subscribed then 'subscribed' else 'unsubscribed' end;
  v_created timestamptz;
  v_email   text;
  v_row     public.marketing_consent;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_source not in ('settings', 'signup_google', 'signup_apple') then
    raise exception 'unknown consent source' using errcode = '22023';
  end if;
  if p_subscribed and (p_version is null or p_version !~ '^[A-Za-z0-9._-]{1,32}$') then
    raise exception 'a disclosure version is required to opt in' using errcode = '22023';
  end if;

  select created_at, email into v_created, v_email from auth.users where id = v_uid;
  if v_created is null then raise exception 'no such account' using errcode = '28000'; end if;
  -- "I ticked the box while signing up" can only be recorded for a brand-new account.
  if p_source like 'signup\_%' and v_created < now() - interval '1 day' then
    raise exception 'signup consent can only be recorded at signup' using errcode = '22023';
  end if;

  insert into public.marketing_consent (user_id, email_normalized)
  values (v_uid, public.normalize_email(v_email))
  on conflict (user_id) do nothing;

  select * into v_row from public.marketing_consent where user_id = v_uid for update;
  -- Idempotent: repeating the same choice keeps the original timestamp and wording.
  if v_row.status <> v_target then
    update public.marketing_consent
       set status = v_target, consent_at = now(),
           consent_version = case when p_subscribed then p_version else coalesce(p_version, consent_version) end,
           consent_source = p_source,
           email_normalized = public.normalize_email(v_email)
     where user_id = v_uid
     returning * into v_row;
  end if;

  return jsonb_build_object('status', v_row.status, 'consent_at', v_row.consent_at,
                            'consent_version', v_row.consent_version, 'consent_source', v_row.consent_source);
end;
$$;

create or replace function public.get_my_marketing_preference()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.marketing_consent;
  v_sup public.email_suppressions;
  v_email text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into v_row from public.marketing_consent where user_id = v_uid;
  select public.normalize_email(email) into v_email from auth.users where id = v_uid;
  select * into v_sup from public.email_suppressions where email_normalized = v_email;
  return jsonb_build_object(
    'status', coalesce(v_row.status, 'unknown'),
    'consent_at', v_row.consent_at,
    'consent_source', v_row.consent_source,
    'suppressed_reason',
      case when v_sup.email_normalized is not null
                and (v_row.consent_at is null or v_sup.event_at >= v_row.consent_at)
           then v_sup.reason end);
end;
$$;

revoke all on function public.set_marketing_consent(boolean, text, text) from public, anon;
grant execute on function public.set_marketing_consent(boolean, text, text) to authenticated;
revoke all on function public.get_my_marketing_preference() from public, anon;
grant execute on function public.get_my_marketing_preference() to authenticated;

-- ---------------------------------------------------------------- admin RPCs

create or replace function public.is_app_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$ select exists (select 1 from public.app_admins where user_id = auth.uid()) $$;

-- Counts only. There is deliberately no function anywhere that returns the address list.
create or replace function public.marketing_sync_health()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.is_app_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'generated_at', now(),
      'accounts_total',       (select count(*) from auth.users),
      'consent_unknown',      (select count(*) from public.marketing_consent where status = 'unknown'),
      'consent_subscribed',   (select count(*) from public.marketing_consent where status = 'subscribed'),
      'eligible_contacts',    (select count(*) from public.marketing_consent c join auth.users u on u.id = c.user_id
                                where c.status = 'subscribed' and u.email_confirmed_at is not null),
      'synced_contacts',      (select count(*) from public.marketing_consent c join auth.users u on u.id = c.user_id
                                where c.status = 'subscribed' and u.email_confirmed_at is not null
                                  and c.synced_status = 'subscribed'
                                  and c.synced_email = public.normalize_email(u.email)),
      'opt_outs',             (select count(*) from public.marketing_consent where status = 'unsubscribed'),
      'suppressed_emails',    (select count(*) from public.email_suppressions),
      'events_pending',       (select count(*) from public.marketing_outbox where status = 'pending' and attempts = 0),
      'events_retrying',      (select count(*) from public.marketing_outbox where status in ('pending', 'processing') and attempts > 0),
      'events_failed',        (select count(*) from public.marketing_outbox where status in ('failed', 'dead')),
      'last_successful_sync', (select max(last_synced_at) from public.marketing_consent),
      'last_error',           (select last_error from public.marketing_outbox
                                where last_error is not null order by id desc limit 1)));
end;
$$;

create or replace function public.marketing_replay_failed(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.is_app_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  v_n := public.marketing_requeue_failed(p_limit);
  perform public.marketing_kick();
  return v_n;
end;
$$;

revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;
revoke all on function public.marketing_sync_health() from public, anon;
grant execute on function public.marketing_sync_health() to authenticated;
revoke all on function public.marketing_replay_failed(integer) from public, anon;
grant execute on function public.marketing_replay_failed(integer) to authenticated;

-- ---------------------------------------------------------------- service-role RPCs
-- Called only by the Edge Functions with the service-role key.

create or replace function public.marketing_requeue_failed(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- A failed event is skipped when the same user already has a newer pending one (a pending
  -- event re-reads current state anyway); the unique index would refuse the duplicate.
  with picked as (
    select id from public.marketing_outbox o
     where o.status in ('failed', 'dead')
       and (o.event_type = 'delete' or o.user_id is null
            or not exists (select 1 from public.marketing_outbox p
                            where p.user_id = o.user_id and p.status = 'pending' and p.event_type <> 'delete'))
     order by id limit greatest(p_limit, 0)
       for update skip locked)
  update public.marketing_outbox o
     set status = 'pending', attempts = 0, next_attempt_at = now(), locked_until = null,
         event_type = case when o.event_type = 'delete' then 'delete' else 'replay' end
    from picked where o.id = picked.id;
  get diagnostics v_n = row_count;
  return v_n;
exception when unique_violation then
  return 0;
end;
$$;

create or replace function public.marketing_claim_outbox(
  p_limit integer default 10, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  with due as (
    select id from public.marketing_outbox
     where (status = 'pending' and next_attempt_at <= now())
        or (status = 'processing' and locked_until < now())
     order by id limit greatest(p_limit, 0)
       for update skip locked),
  claimed as (
    update public.marketing_outbox o
       set status = 'processing', attempts = o.attempts + 1,
           locked_until = now() + make_interval(secs => p_lease_seconds)
      from due where o.id = due.id
    returning o.*)
  select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.id), '[]'::jsonb) into v from claimed;
  return v;
end;
$$;

create or replace function public.marketing_complete_outbox(
  p_id bigint, p_ok boolean, p_note text default null,
  p_retryable boolean default true, p_retry_after_seconds integer default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.marketing_outbox;
  v_status text;
begin
  select * into v_row from public.marketing_outbox where id = p_id for update;
  if not found then return 'missing'; end if;
  if p_ok then
    update public.marketing_outbox
       set status = 'done', processed_at = now(), locked_until = null, last_error = null,
           payload = payload || jsonb_build_object('outcome', left(coalesce(p_note, 'ok'), 100))
     where id = p_id;
    return 'done';
  end if;
  if p_retryable and v_row.attempts < 8 then
    v_status := 'pending';
    update public.marketing_outbox
       set status = 'pending', locked_until = null, last_error = left(p_note, 500),
           next_attempt_at = now() + make_interval(
             secs => greatest(coalesce(p_retry_after_seconds, 0),
                              least(power(2, v_row.attempts) * 30, 21600))::int)
     where id = p_id;
  else
    v_status := case when p_retryable then 'dead' else 'failed' end;
    update public.marketing_outbox
       set status = v_status, locked_until = null, last_error = left(p_note, 500), processed_at = now()
     where id = p_id;
  end if;
  return v_status;
end;
$$;

create or replace function public.marketing_sync_context(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user record;
  v_c public.marketing_consent;
  v_email text;
  v_sup public.email_suppressions;
begin
  select id, email, email_confirmed_at into v_user from auth.users where id = p_user_id;
  if not found then return jsonb_build_object('user_exists', false); end if;
  select * into v_c from public.marketing_consent where user_id = p_user_id;
  v_email := public.normalize_email(v_user.email);
  select * into v_sup from public.email_suppressions where email_normalized = v_email;
  return jsonb_build_object(
    'user_exists', true,
    'email', v_email,
    'email_confirmed', v_user.email_confirmed_at is not null,
    'consent', case when v_c.user_id is null then null else jsonb_build_object(
        'status', v_c.status, 'consent_at', v_c.consent_at,
        'synced_status', v_c.synced_status, 'synced_email', v_c.synced_email,
        'resend_contact_id', v_c.resend_contact_id) end,
    'suppression', case when v_sup.email_normalized is null then null else jsonb_build_object(
        'reason', v_sup.reason, 'event_at', v_sup.event_at) end);
end;
$$;

create or replace function public.marketing_mark_synced(
  p_user_id uuid, p_status text, p_email text, p_contact_id text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.marketing_consent
     set synced_status = p_status, synced_email = public.normalize_email(p_email),
         resend_contact_id = coalesce(p_contact_id, resend_contact_id),
         last_synced_at = case when p_status is null then last_synced_at else now() end
   where user_id = p_user_id;
  return found;
end;
$$;

create or replace function public.marketing_email_has_account(p_email text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$ select exists (select 1 from auth.users where public.normalize_email(email) = public.normalize_email(p_email)) $$;

create or replace function public.marketing_get_suppression(p_email text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select to_jsonb(s) - 'updated_at' from public.email_suppressions s
   where s.email_normalized = public.normalize_email(p_email)
$$;

-- A provider-side opt-out / bounce / complaint. The only thing that may reverse a newer
-- decision is a NEWER event, and nothing from the provider can ever set anyone to subscribed.
create or replace function public.apply_provider_suppression(
  p_email text, p_reason text, p_event_at timestamptz, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.normalize_email(p_email);
  v_flipped integer := 0;
  v_stored boolean := false;
begin
  if v_email is null then return jsonb_build_object('applied', false, 'reason', 'no_email'); end if;
  if p_reason not in ('unsubscribed', 'bounced', 'complained') then
    raise exception 'bad suppression reason' using errcode = '22023';
  end if;
  if p_source not in ('resend_webhook', 'resend_reconcile', 'resend_backfill') then
    raise exception 'bad suppression source' using errcode = '22023';
  end if;

  insert into public.email_suppressions (email_normalized, reason, source, event_at)
  values (v_email, p_reason, p_source, p_event_at)
  on conflict (email_normalized) do update
     set reason = excluded.reason, source = excluded.source,
         event_at = excluded.event_at, updated_at = now()
   where public.email_suppressions.event_at < excluded.event_at;
  v_stored := found;

  -- Flip consent only where the event is newer than the person's last decision.
  update public.marketing_consent c
     set status = 'unsubscribed', consent_at = p_event_at, consent_source = p_source
    from auth.users u
   where u.id = c.user_id
     and public.normalize_email(u.email) = v_email
     and c.status <> 'unsubscribed'
     and (c.consent_at is null or c.consent_at < p_event_at);
  get diagnostics v_flipped = row_count;

  return jsonb_build_object('applied', true, 'suppression_updated', v_stored, 'accounts_unsubscribed', v_flipped);
end;
$$;

create or replace function public.marketing_record_webhook(p_svix_id text, p_type text)
returns boolean   -- true = first time (or an earlier attempt never finished): go ahead
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done timestamptz;
begin
  insert into public.resend_webhook_events (svix_id, event_type) values (p_svix_id, p_type)
  on conflict (svix_id) do nothing;
  select processed_at into v_done from public.resend_webhook_events where svix_id = p_svix_id;
  return v_done is null;
end;
$$;

create or replace function public.marketing_finish_webhook(p_svix_id text, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.resend_webhook_events set processed_at = now(), outcome = left(p_outcome, 100)
   where svix_id = p_svix_id;
  return found;
end;
$$;

-- Queue a reconcile for everyone whose Resend state does not match Supabase. Never touches
-- `unknown` accounts. Used after an outage and by the scheduled drain as a safety net.
create or replace function public.marketing_enqueue_unsynced(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  perform set_config('marketing.skip_kick', 'on', true);
  for r in
    select c.user_id, public.normalize_email(u.email) as email, c.status, c.consent_at
      from public.marketing_consent c
      join auth.users u on u.id = c.user_id
     where (c.status = 'subscribed' and u.email_confirmed_at is not null
            and (c.synced_status is distinct from 'subscribed'
                 or c.synced_email is distinct from public.normalize_email(u.email)))
        or (c.status = 'unsubscribed' and c.synced_status = 'subscribed')
     limit greatest(p_limit, 0)
  loop
    perform public.marketing_enqueue(r.user_id, r.email, 'backfill',
      case when r.status = 'subscribed' then jsonb_build_object('optin_at', r.consent_at) else '{}'::jsonb end);
    v_n := v_n + 1;
  end loop;
  perform set_config('marketing.skip_kick', 'off', true);
  if v_n > 0 then perform public.marketing_kick(); end if;
  return v_n;
end;
$$;

-- Gives every account that has no consent row an `unknown` one. No events, no Resend calls,
-- nobody is subscribed. Safe to run again.
create or replace function public.marketing_backfill_legacy_consent()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.marketing_consent (user_id, status, email_normalized)
  select u.id, 'unknown', public.normalize_email(u.email)
    from auth.users u
   where not exists (select 1 from public.marketing_consent c where c.user_id = u.id)
  on conflict (user_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'marketing_kick()', 'marketing_enqueue(uuid, text, text, jsonb)',
    'marketing_requeue_failed(integer)', 'marketing_claim_outbox(integer, integer)',
    'marketing_complete_outbox(bigint, boolean, text, boolean, integer)',
    'marketing_sync_context(uuid)', 'marketing_mark_synced(uuid, text, text, text)',
    'marketing_email_has_account(text)', 'marketing_get_suppression(text)',
    'apply_provider_suppression(text, text, timestamptz, text)',
    'marketing_record_webhook(text, text)', 'marketing_finish_webhook(text, text)',
    'marketing_enqueue_unsynced(integer)', 'marketing_backfill_legacy_consent()',
    'marketing_handle_new_user()', 'marketing_consent_enqueue()', 'marketing_consent_deleted()',
    'marketing_handle_email_change()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- legacy accounts
-- Historical users have no proof of consent: they get `unknown` rows and stay there.
select public.marketing_backfill_legacy_consent();
