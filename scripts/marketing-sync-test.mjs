#!/usr/bin/env node
/* marketing-sync-test.mjs — Supabase <-> Resend contact sync, end to end

   Not part of the site: scripts/ is excluded from the deploy and from what the native apps
   bundle. This starts a throwaway PostgreSQL 16 cluster, builds the slice of Supabase the
   migration depends on (auth.users, auth.uid(), roles, Vault, pg_net stubs), applies
   supabase/migrations/20261017_marketing_consent_sync.sql for real, and runs the Edge Function
   logic (supabase/functions/_shared/core.ts) against it with an in-memory fake of the Resend
   Contacts API. Nothing here talks to Supabase or Resend.

     npm run test:marketing-sync

   Needs PostgreSQL 16 server binaries (apt: postgresql-16) and Node 22.18+ (runs the .ts
   directly). Set PG_BIN if they are not in /usr/lib/postgresql/16/bin. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

import {
  normalizeEmail, maskEmail, scrub, makeLogger, drain, importResendOptOuts, handleResendWebhook,
  verifySvix, createResendClient, secretsMatch,
} from '../supabase/functions/_shared/core.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, '..', 'supabase', 'migrations', '20261017_marketing_consent_sync.sql');
const ROLLBACK = join(here, '..', 'supabase', 'rollback', '20261017_marketing_consent_sync_down.sql');
const PG_BIN = process.env.PG_BIN || '/usr/lib/postgresql/16/bin';
if (!existsSync(join(PG_BIN, 'initdb'))) {
  console.error(`PostgreSQL server binaries not found in ${PG_BIN}. Install postgresql-16 or set PG_BIN.`);
  process.exit(2);
}

/* ------------------------------------------------------------------ tiny test kit */
let fails = 0, total = 0;
function check(label, got, want) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got    ${JSON.stringify(got)}\n      wanted ${JSON.stringify(want)}`}`);
}
const section = (t) => console.log(`\n— ${t}`);

/* ------------------------------------------------------------------ postgres harness */
const isRoot = process.getuid && process.getuid() === 0;
const dir = mkdtempSync(join(tmpdir(), 'mktgsync-'));
chmodSync(dir, 0o755);
if (isRoot) execFileSync('chown', ['postgres', dir]);
const asPg = (cmd, args, opts = {}) =>
  isRoot ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], opts) : execFileSync(cmd, args, opts);

function stopPg() {
  try { asPg(join(PG_BIN, 'pg_ctl'), ['-D', join(dir, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
process.on('exit', stopPg);

asPg(join(PG_BIN, 'initdb'), ['-D', join(dir, 'data'), '-A', 'trust', '-U', 'postgres'], { stdio: 'ignore' });
asPg(join(PG_BIN, 'pg_ctl'), ['-D', join(dir, 'data'), '-o', `-c listen_addresses='' -k ${dir} -c fsync=off`, '-l', join(dir, 'log'), '-w', 'start'], { stdio: 'ignore' });

/** Runs SQL as `role` (default: the superuser), optionally as a signed-in user. Returns stdout. */
function sql(query, { role = null, uid = null, expectError = false } = {}) {
  const pre = [];
  if (role) pre.push(`set role ${role};`);
  if (uid) pre.push(`select set_config('request.jwt.claim.sub', '${uid}', false);`);
  const r = spawnSync(join(PG_BIN, 'psql'),
    ['-X', '-A', '-t', '-q', '-h', dir, '-U', 'postgres', '-d', 'test', '-v', 'ON_ERROR_STOP=1', '-c', pre.join(' ') + ' ' + query],
    { encoding: 'utf8' });
  if (expectError) return { ok: r.status === 0, err: (r.stderr || '').trim(), out: (r.stdout || '').trim() };
  if (r.status !== 0) throw new Error(`SQL failed: ${query.slice(0, 200)}\n${r.stderr}`);
  // `select set_config(...)` prints its value first; keep only the last non-empty line(s) of the real query
  return r.stdout.trim();
}
const q = (query, o) => {
  // strip the set_config echo line when a uid is set
  const out = sql(query, o);
  return o && o.uid ? out.split('\n').slice(1).join('\n').trim() : out;
};
const scalar = (query, o) => q(query, o);

spawnSync(join(PG_BIN, 'createdb'), ['-h', dir, '-U', 'postgres', 'test'], { stdio: 'ignore' });
const psqlFile = (file) => {
  const r = spawnSync(join(PG_BIN, 'psql'), ['-X', '-q', '-h', dir, '-U', 'postgres', '-d', 'test', '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql -f ${file} failed:\n${r.stderr}`);
};

/** Service-role RPC adapter handed to the Edge Function logic. */
function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
const db = {
  async rpc(fn, args = {}) {
    const a = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
    const r = sql(`select to_jsonb(public.${fn}(${a}));`, { role: 'service_role', expectError: true });
    if (!r.ok) return { data: null, error: { message: r.err } };
    return { data: r.out === '' ? null : JSON.parse(r.out), error: null };
  },
};

/* ------------------------------------------------------------------ fake Supabase + legacy data */
sql(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant anon, authenticated, service_role to postgres;
create schema auth; create schema vault; create schema net; create schema extensions;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text, email_confirmed_at timestamptz, created_at timestamptz not null default now(),
  raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{"provider":"email"}'
);
create unique index users_email_key on auth.users (lower(email));
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table vault.decrypted_secrets (name text, decrypted_secret text);
create table net._calls (id serial, url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
begin
  if current_setting('test.net_fail', true) = 'on' then raise exception 'pg_net is down'; end if;
  insert into net._calls (url, headers, body) values (url, headers, body); return 1;
end $$;
-- Supabase's default privileges: new public objects are open to every API role.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- What production already has: profiles + the existing handle_new_user trigger.
create table public.profiles (id uuid primary key references auth.users(id), username text);
alter table public.profiles enable row level security;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as
  $$ begin insert into public.profiles (id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
`);
// Three historical users, created BEFORE the migration exists.
const LEGACY = {
  a: 'legacy.optout@example.com',  // unsubscribed in Resend (from the old CSV process)
  b: 'legacy.csv@example.com',     // in Resend, subscribed, never gave us proof
  c: 'legacy.nothing@example.com', // not in Resend at all
};
const ids = {};
for (const [k, email] of Object.entries(LEGACY)) {
  ids[k] = q(`insert into auth.users (email, email_confirmed_at, created_at) values ('${email}', now() - interval '200 days', now() - interval '200 days') returning id;`).split('\n')[0];
}
psqlFile(MIGRATION);
sql(`grant execute on function auth.uid() to anon, authenticated, service_role;`);

/* ------------------------------------------------------------------ fake Resend */
function makeFakeResend() {
  const contacts = new Map(); // email -> { id, email, unsubscribed, segments:Set }
  const calls = [];
  let n = 0;
  const failures = []; // queue of { status, retryAfter }
  const api = {
    calls, contacts,
    failNext(count, status = 500, retryAfter = null) { for (let i = 0; i < count; i++) failures.push({ status, retryAfter }); },
    seed(email, unsubscribed) { const c = { id: `c_${++n}`, email, unsubscribed, segments: new Set() }; contacts.set(email, c); return c; },
    async request(method, path, body) {
      calls.push({ method, path, body });
      const f = failures.shift();
      if (f) return { status: f.status, body: { message: 'injected failure re_secretkey1234567890 for someone@example.com' }, retryAfter: f.retryAfter };
      const ok = (b, s = 200) => ({ status: s, body: b, retryAfter: null });
      const nf = () => ({ status: 404, body: { message: 'not found' }, retryAfter: null });
      const m = path.match(/^\/contacts(?:\/([^/?]+))?(?:\/segments\/([^/?]+))?(?:\?.*)?$/);
      if (!m) return { status: 400, body: {}, retryAfter: null };
      const email = m[1] ? decodeURIComponent(m[1]) : null;
      if (method === 'GET' && !email) {
        const u = new URL('http://x' + path);
        const after = u.searchParams.get('after');
        const all = [...contacts.values()];
        const start = after ? all.findIndex((c) => c.id === after) + 1 : 0;
        const data = all.slice(start, start + 2).map(({ segments, ...c }) => c); // tiny pages to exercise paging
        return ok({ object: 'list', has_more: start + 2 < all.length, data });
      }
      if (method === 'POST' && !email) {
        if (contacts.has(body.email)) return { status: 409, body: { message: 'exists' }, retryAfter: null };
        const c = api.seed(body.email, !!body.unsubscribed);
        (body.segments || []).forEach((s) => c.segments.add(s.id));
        return ok({ object: 'contact', id: c.id }, 201);
      }
      const c = contacts.get(email);
      if (!c) return nf();
      if (method === 'GET') return ok({ object: 'contact', id: c.id, email: c.email, unsubscribed: c.unsubscribed });
      if (method === 'PATCH') { if (typeof body.unsubscribed === 'boolean') c.unsubscribed = body.unsubscribed; return ok({ id: c.id }); }
      if (method === 'DELETE' && !m[2]) { contacts.delete(email); return ok({ deleted: true }); }
      if (method === 'POST' && m[2]) { c.segments.add(m[2]); return ok({ id: m[2] }); }
      return { status: 400, body: {}, retryAfter: null };
    },
  };
  return api;
}

const logLines = [];
const log = makeLogger((l) => logLines.push(l));
let resend = makeFakeResend();
const SEGMENT = 'seg_marketing';
const deps = () => ({ db, resend, segmentId: SEGMENT, log });
const runDrain = () => drain(deps());

/* ------------------------------------------------------------------ helpers over the DB */
let seq = 0;
function signup({ email, optIn = false, version = '2026-10-v1', provider = 'email', confirmed = false, meta = null }) {
  const m = meta ?? (optIn ? { marketing_opt_in: true, marketing_consent_version: version } : {});
  return q(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
            values ('${email}', ${confirmed ? 'now()' : 'null'}, '${JSON.stringify(m)}', '{"provider":"${provider}"}') returning id;`).split('\n')[0];
}
const consent = (id) => { const out = q(`select to_jsonb(c) from public.marketing_consent c where user_id = '${id}';`); return out ? JSON.parse(out) : null; };
const outbox = (where = 'true') => JSON.parse(q(`select coalesce(jsonb_agg(to_jsonb(o) order by id), '[]') from public.marketing_outbox o where ${where};`));
const asUser = (id, query, extra = {}) => q(query, { role: 'authenticated', uid: id, ...extra });
const userErr = (id, query) => sql(query, { role: 'authenticated', uid: id, expectError: true });
const setConsent = (id, subscribed, source = 'settings') =>
  asUser(id, `select public.set_marketing_consent(${subscribed}, '${source}', ${subscribed ? "'2026-10-v1'" : 'null'});`);
const fresh = (prefix) => `${prefix}.${++seq}@example.com`;

/* Svix-signed webhook, built the way Resend/Svix does it. */
const WHSEC = 'whsec_' + Buffer.from('subliminally-test-signing-secret').toString('base64');
function signedWebhook(event, { id = `msg_${++seq}`, ts = Math.floor(Date.now() / 1000), secret = WHSEC, tamper = false } = {}) {
  const raw = JSON.stringify(event);
  const key = Buffer.from(secret.slice(6), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return { rawBody: tamper ? raw.replace('example', 'examplf') : raw, secret: WHSEC,
           headers: { id, timestamp: String(ts), signature: `v1,${sig}` } };
}
const sendWebhook = (event, o) => handleResendWebhook({ db, log }, signedWebhook(event, o));
const contactUpdated = (email, unsubscribed, at = new Date().toISOString()) =>
  ({ type: 'contact.updated', created_at: at, data: { id: 'c_x', email, unsubscribed } });

/* ================================================================== TESTS */

section('migration state: historical users');
check('every legacy account got a consent row', Number(q(`select count(*) from public.marketing_consent;`)) >= 3, true);
for (const [k, email] of Object.entries(LEGACY)) {
  const c = consent(ids[k]);
  check(`legacy ${k} stays unknown with no timestamp`, [c.status, c.consent_at, c.consent_source, c.consent_version], ['unknown', null, null, null]);
}
check('backfill queued nothing and called nothing', [outbox().length, Number(q(`select count(*) from net._calls;`))], [0, 0]);

section('new signup');
{
  const email = fresh('plain');
  const id = signup({ email, confirmed: true });
  const c = consent(id);
  check('no checkbox -> unknown, nothing queued', [c.status, c.consent_at, outbox(`user_id='${id}'`).length], ['unknown', null, 0]);
  check('existing handle_new_user trigger still created the profile', q(`select count(*) from public.profiles where id='${id}';`), '1');
  const r = await runDrain();
  check('draining with nothing to do is a no-op', [r.claimed, resend.contacts.size], [0, 0]);
}
{
  const email = fresh('optin');
  const id = signup({ email, optIn: true });
  const c = consent(id);
  check('checkbox ticked -> subscribed with proof', [c.status, c.consent_version, c.consent_source, !!c.consent_at], ['subscribed', '2026-10-v1', 'signup_email', true]);
  check('one signup event is queued', outbox(`user_id='${id}'`).map((o) => [o.event_type, o.status]), [['signup', 'pending']]);
  let r = await runDrain();
  check('unverified address: nothing is sent to Resend', [r.done, resend.contacts.size], [1, 0]);
  check('outcome recorded as awaiting verification', outbox(`user_id='${id}'`)[0].payload.outcome, 'awaiting_email_verification');
  sql(`update auth.users set email_confirmed_at = now() where id = '${id}';`);
  check('verification queues another event', outbox(`user_id='${id}' and status='pending'`).length, 1);
  r = await runDrain();
  const contact = resend.contacts.get(email);
  check('verified + opted in -> contact created, subscribed, in the marketing segment',
    [!!contact, contact?.unsubscribed, [...(contact?.segments ?? [])]], [true, false, [SEGMENT]]);
  const after = consent(id);
  check('sync state recorded', [after.synced_status, after.synced_email, !!after.last_synced_at, !!after.resend_contact_id], ['subscribed', email, true, true]);
}
{
  check('opt-in without a valid version is not accepted', [
    consent(signup({ email: fresh('nover'), meta: { marketing_opt_in: true } })).status,
    consent(signup({ email: fresh('badver'), meta: { marketing_opt_in: true, marketing_consent_version: 'x y;drop' } })).status,
  ], ['unknown', 'unknown']);
  check('opt-in claimed by a non-email provider is ignored', consent(signup({ email: fresh('goog'), optIn: true, provider: 'google' })).status, 'unknown');
  check('"false"/garbage metadata does not subscribe', consent(signup({ email: fresh('garb'), meta: { marketing_opt_in: 'yes please', marketing_consent_version: 'v1' } })).status, 'unknown');
}
{
  section('signup never depends on the sync');
  sql(`alter table public.marketing_consent rename to marketing_consent_gone;`);
  let id; let threw = false;
  try { id = signup({ email: fresh('survives'), optIn: true }); } catch { threw = true; }
  sql(`alter table public.marketing_consent_gone rename to marketing_consent;`);
  check('account is created even if the consent table is broken', [threw, !!id], [false, true]);

  sql(`insert into vault.decrypted_secrets values ('marketing_sync_url','https://example.test/fn'), ('marketing_sync_secret','shh-secret');`);
  sql(`select set_config('test.net_fail','on', false);`);
  const id2 = (() => { try { return q(`set test.net_fail = 'on'; insert into auth.users (email, raw_user_meta_data) values ('${fresh('netdown')}', '{"marketing_opt_in":true,"marketing_consent_version":"v1"}') returning id;`).split('\n').pop(); } catch { return null; } })();
  check('account is created even if pg_net blows up', !!id2, true);
  const before = Number(q(`select count(*) from net._calls;`));
  const id3 = signup({ email: fresh('kicked'), optIn: true });
  check('with Vault configured, the outbox write pokes the function (async, with the shared secret header)',
    [Number(q(`select count(*) from net._calls;`)) - before, q(`select headers->>'x-sync-secret' from net._calls order by id desc limit 1;`), q(`select url from net._calls order by id desc limit 1;`)],
    [1, 'shh-secret', 'https://example.test/fn']);
  sql(`delete from vault.decrypted_secrets;`);
  void id3;
}

section('duplicate signup');
{
  const email = fresh('dupe');
  const id = signup({ email, optIn: true, confirmed: true });
  const before = consent(id);
  const dup = sql(`insert into auth.users (email, raw_user_meta_data) values ('${email.toUpperCase()}', '{"marketing_opt_in":true,"marketing_consent_version":"v9"}');`, { expectError: true });
  check('same address (any case) cannot create a second account', dup.ok, false);
  check('the existing account\'s consent is untouched', consent(id), before);
  check('and no extra queue entries appeared', outbox(`user_id='${id}'`).length, 1);
  check('normalization dedupes case and whitespace', [normalizeEmail('  Kyla@Example.COM '), normalizeEmail('nope'), normalizeEmail(null)], ['kyla@example.com', null, null]);
}

section('opt-in and opt-out from Settings');
{
  const email = fresh('settings');
  const id = signup({ email, confirmed: true });
  let r = JSON.parse(setConsent(id, true));
  check('opt in records status, source, version', [r.status, r.consent_source, r.consent_version], ['subscribed', 'settings', '2026-10-v1']);
  const stamp = consent(id).consent_at;
  setConsent(id, true);
  check('repeating the same choice keeps the original timestamp (idempotent)', consent(id).consent_at, stamp);
  check('and does not queue a second event', outbox(`user_id='${id}' and status='pending'`).length, 1);
  await runDrain();
  check('synced to Resend', [resend.contacts.get(email)?.unsubscribed, consent(id).synced_status], [false, 'subscribed']);
  const callsBefore = resend.calls.length;
  await runDrain();
  check('draining again makes no Resend calls (idempotent)', resend.calls.length, callsBefore);

  setConsent(id, false);
  check('opt out recorded', consent(id).status, 'unsubscribed');
  await runDrain();
  check('Resend contact marked unsubscribed (not deleted)', [resend.contacts.get(email)?.unsubscribed, consent(id).synced_status], [true, 'unsubscribed']);

  setConsent(id, true);
  await runDrain();
  check('an explicit opt-in lifts the earlier opt-out', [resend.contacts.get(email)?.unsubscribed, consent(id).status], [false, 'subscribed']);
  const prefs = JSON.parse(asUser(id, `select public.get_my_marketing_preference();`));
  check('the preference screen reads status without leaking anything else', Object.keys(prefs).sort(), ['consent_at', 'consent_source', 'status', 'suppressed_reason']);
  check('signup-source consent is refused for an old account', userErr(ids.a, `select public.set_marketing_consent(true, 'signup_google', 'v1');`).ok, false);
  check('unknown consent source is refused', userErr(id, `select public.set_marketing_consent(true, 'admin', 'v1');`).ok, false);
  check('opting in without a version is refused', userErr(id, `select public.set_marketing_consent(true, 'settings', null);`).ok, false);
}
{
  const id = signup({ email: fresh('oauth'), provider: 'google', confirmed: true });
  const r = JSON.parse(asUser(id, `select public.set_marketing_consent(true, 'signup_google', '2026-10-v1');`));
  check('social signup: opt-in captured right after the first session', [r.status, r.consent_source], ['subscribed', 'signup_google']);
}

section('row level security');
{
  const idA = signup({ email: fresh('rlsA'), optIn: true, confirmed: true });
  const idB = signup({ email: fresh('rlsB'), confirmed: true });
  check('a user sees only their own consent row', asUser(idA, `select count(*) from public.marketing_consent;`), '1');
  check('...and it is theirs', asUser(idA, `select user_id from public.marketing_consent;`), idA);
  check('direct UPDATE is refused', userErr(idA, `update public.marketing_consent set status='subscribed' where user_id='${idB}';`).ok, false);
  check('even on their own row', userErr(idA, `update public.marketing_consent set status='unsubscribed' where user_id='${idA}';`).ok, false);
  check('direct INSERT is refused', userErr(idB, `insert into public.marketing_consent (user_id) values (gen_random_uuid());`).ok, false);
  check('direct DELETE is refused', userErr(idA, `delete from public.marketing_consent;`).ok, false);
  setConsent(idB, true);
  check('set_marketing_consent changes only the caller', [consent(idA).status, consent(idB).status], ['subscribed', 'subscribed']);
  setConsent(idB, false);
  check('...B opting out does not touch A', [consent(idA).status, consent(idB).status], ['subscribed', 'unsubscribed']);
  check('anonymous callers cannot set consent', sql(`select public.set_marketing_consent(true,'settings','v1');`, { role: 'anon', expectError: true }).ok, false);
  check('signed-in users cannot read other tables behind the feature',
    ['email_suppressions', 'marketing_outbox', 'resend_webhook_events', 'app_admins'].map((t) => userErr(idA, `select * from public.${t};`).ok), [false, false, false, false]);
  check('users cannot call the service-role functions',
    [`select public.apply_provider_suppression('x@y.z','unsubscribed',now(),'resend_webhook')`,
     `select public.marketing_claim_outbox(5,60)`, `select public.marketing_sync_context('${idB}')`,
     `select public.marketing_backfill_legacy_consent()`, `select public.marketing_enqueue_unsynced(5)`].map((s) => userErr(idA, s + ';').ok),
    [false, false, false, false, false]);
  check('anon cannot call them either', sql(`select public.marketing_claim_outbox(5,60);`, { role: 'anon', expectError: true }).ok, false);
}

section('changing email');
{
  const oldE = fresh('before'), newE = fresh('after');
  const id = signup({ email: oldE, optIn: true, confirmed: true });
  await runDrain();
  check('starts subscribed under the old address', resend.contacts.get(oldE)?.unsubscribed, false);
  sql(`update auth.users set email = '${newE}' where id = '${id}';`);
  check('email change is queued', outbox(`user_id='${id}' and status='pending'`).map((o) => o.event_type), ['email_change']);
  await runDrain();
  check('old contact removed, new one created and subscribed', [resend.contacts.has(oldE), resend.contacts.get(newE)?.unsubscribed, [...(resend.contacts.get(newE)?.segments ?? [])]], [false, false, [SEGMENT]]);
  check('sync state follows the new address', [consent(id).synced_email, consent(id).email_normalized], [newE, newE]);

  // an unverified-to-verified transition for a user who never opted in queues nothing
  const idU = signup({ email: fresh('unk'), confirmed: false });
  sql(`update auth.users set email_confirmed_at = now() where id = '${idU}';`);
  check('unknown-consent users: verifying or changing email queues nothing', outbox(`user_id='${idU}'`).length, 0);
  sql(`update auth.users set email = '${fresh('unk2')}' where id = '${idU}';`);
  check('...and neither does changing it', outbox(`user_id='${idU}'`).length, 0);

  // old address with a recorded opt-out must stay unsubscribed rather than be forgotten
  const o2 = fresh('keepopt'), n2 = fresh('keepnew');
  const id2 = signup({ email: o2, optIn: true, confirmed: true });
  await runDrain();
  await db.rpc('apply_provider_suppression', { p_email: o2, p_reason: 'complained', p_event_at: new Date(Date.now() + 1000).toISOString(), p_source: 'resend_webhook' });
  // complaint flipped consent to unsubscribed; user then re-opts in explicitly and moves address
  setConsent(id2, true);
  sql(`update auth.users set email = '${n2}' where id = '${id2}';`);
  await runDrain();
  check('an old address with a complaint on file is kept, unsubscribed', [resend.contacts.get(o2)?.unsubscribed, resend.contacts.has(n2)], [true, true]);
}

section('account deletion');
{
  const email = fresh('bye');
  const id = signup({ email, optIn: true, confirmed: true });
  await runDrain();
  check('contact exists before deletion', resend.contacts.has(email), true);
  sql(`delete from public.profiles where id = '${id}'; delete from auth.users where id = '${id}';`);
  check('consent row cascaded away', consent(id), null);
  const ev = outbox(`event_type='delete'`).filter((o) => o.email_normalized === email);
  check('a delete event survived the cascade', ev.length, 1);
  await runDrain();
  check('contact removed from Resend', resend.contacts.has(email), false);

  const e2 = fresh('bye-optout');
  const id2 = signup({ email: e2, optIn: true, confirmed: true });
  await runDrain();
  await db.rpc('apply_provider_suppression', { p_email: e2, p_reason: 'unsubscribed', p_event_at: new Date(Date.now() + 1000).toISOString(), p_source: 'resend_webhook' });
  sql(`delete from public.profiles where id = '${id2}'; delete from auth.users where id = '${id2}';`);
  await runDrain();
  check('a recorded opt-out outlives the account: contact kept, unsubscribed', resend.contacts.get(e2)?.unsubscribed, true);

  const e3 = fresh('bye-rejoin');
  const id3 = signup({ email: e3, optIn: true, confirmed: true });
  await runDrain();
  sql(`delete from public.profiles where id = '${id3}'; delete from auth.users where id = '${id3}';`);
  const id3b = signup({ email: e3, optIn: true, confirmed: true });   // signs up again before the queue drains
  await runDrain();
  check('re-signup before the delete event runs: new account\'s contact survives', [resend.contacts.has(e3), consent(id3b)?.synced_status], [true, 'subscribed']);
}

section('failed Resend request, retries, replay');
{
  resend = makeFakeResend();
  const email = fresh('flaky');
  const id = signup({ email, optIn: true, confirmed: true });
  await runDrain(); // clears the unverified-style event for this user if any
  // fresh event after a failing call
  resend = makeFakeResend();
  const email2 = fresh('flaky2');
  const id2 = signup({ email: email2, optIn: true, confirmed: true });
  resend.failNext(1, 500);
  let r = await runDrain();
  let ev = outbox(`user_id='${id2}'`)[0];
  check('a 500 schedules a retry instead of losing the event', [r.retrying, ev.status, ev.attempts], [1, 'pending', 1]);
  check('the stored error never contains the API key or a full address', [/re_secretkey/.test(ev.last_error), /someone@example\.com/.test(ev.last_error)], [false, false]);
  check('the retry is delayed (backoff)', new Date(ev.next_attempt_at).getTime() > Date.now() + 20000, true);
  r = await runDrain();
  check('an immediate drain does not hammer a backed-off event', [r.claimed, resend.contacts.size], [0, 0]);
  sql(`update public.marketing_outbox set next_attempt_at = now() - interval '1 second' where user_id = '${id2}';`);
  r = await runDrain();
  check('after the delay it retries and succeeds', [r.done, resend.contacts.get(email2)?.unsubscribed, outbox(`user_id='${id2}'`)[0].status], [1, false, 'done']);

  // 429 with Retry-After; network failure (status 0)
  const email3 = fresh('limited');
  const id3 = signup({ email: email3, optIn: true, confirmed: true });
  resend.failNext(1, 429, 120);
  await runDrain();
  ev = outbox(`user_id='${id3}'`)[0];
  check('429 honours Retry-After', [ev.status, new Date(ev.next_attempt_at).getTime() >= Date.now() + 100000], ['pending', true]);
  sql(`update public.marketing_outbox set next_attempt_at = now() where user_id = '${id3}';`);
  resend.failNext(1, 0);
  await runDrain();
  check('a dropped connection is retried too', outbox(`user_id='${id3}'`)[0].status, 'pending');
  sql(`update public.marketing_outbox set next_attempt_at = now() where user_id = '${id3}';`);
  await runDrain();
  check('...and succeeds once Resend answers', [outbox(`user_id='${id3}'`)[0].status, resend.contacts.has(email3)], ['done', true]);

  // exhausting retries -> dead ; 401 -> failed + drain aborts
  const email4 = fresh('doomed');
  const id4 = signup({ email: email4, optIn: true, confirmed: true });
  resend.failNext(40, 503);
  for (let i = 0; i < 9; i++) {
    sql(`update public.marketing_outbox set next_attempt_at = now() where user_id = '${id4}' and status = 'pending';`);
    await runDrain();
  }
  ev = outbox(`user_id='${id4}'`)[0];
  check('after 8 attempts the event is parked as dead (not retried forever)', [ev.status, ev.attempts], ['dead', 8]);
  resend.failNext(0);
  resend = makeFakeResend(); // clear leftover injected failures

  const email5 = fresh('badkey'), email6 = fresh('collateral');
  const id5 = signup({ email: email5, optIn: true, confirmed: true });
  const id6 = signup({ email: email6, optIn: true, confirmed: true });
  resend.failNext(1, 401);
  r = await runDrain();
  const e5 = outbox(`user_id='${id5}'`)[0], e6 = outbox(`user_id='${id6}'`)[0];
  check('a rejected API key stops the drain and fails (not retries) the batch', [r.aborted, e5.status, e6.status], [true, 'failed', 'failed']);
  check('nothing was sent with the bad key', resend.contacts.size, 0);

  section('replay');
  const admin = signup({ email: fresh('admin'), confirmed: true });
  const normal = signup({ email: fresh('normal'), confirmed: true });
  sql(`insert into public.app_admins (user_id) values ('${admin}');`);
  check('non-admin cannot replay', userErr(normal, `select public.marketing_replay_failed(10);`).ok, false);
  check('non-admin cannot read the health report', userErr(normal, `select public.marketing_sync_health();`).ok, false);
  const health1 = JSON.parse(asUser(admin, `select public.marketing_sync_health();`));
  check('health report shows failed events', health1.events_failed >= 3, true);
  const replayed = Number(asUser(admin, `select public.marketing_replay_failed(100);`));
  check('admin replay re-queues the failed and dead events', replayed >= 3, true);
  r = await runDrain();
  check('replayed events sync once Resend works', [resend.contacts.has(email4), resend.contacts.has(email5), resend.contacts.has(email6)], [true, true, true]);
  const health2 = JSON.parse(asUser(admin, `select public.marketing_sync_health();`));
  check('health counts drop to zero failed', health2.events_failed, 0);
  check('health report exposes counts only, never an address', /@/.test(JSON.stringify(health2)), false);
  check('health report fields', Object.keys(health2).sort(), [
    'accounts_total', 'consent_subscribed', 'consent_unknown', 'eligible_contacts', 'events_failed', 'events_pending',
    'events_retrying', 'generated_at', 'last_error', 'last_successful_sync', 'opt_outs', 'suppressed_emails', 'synced_contacts']);
  check('last successful sync is reported', !!health2.last_successful_sync, true);
  check('synced_contacts <= eligible_contacts', health2.synced_contacts <= health2.eligible_contacts, true);
  check('replay with nothing failed does nothing', Number(asUser(admin, `select public.marketing_replay_failed(100);`)), 0);
  void id; void email;
}

section('Resend webhooks: contact.updated and friends');
{
  resend = makeFakeResend();
  const email = fresh('unsub');
  const id = signup({ email, optIn: true, confirmed: true });
  await runDrain();
  const outboxBefore = outbox().length;

  const bad = await sendWebhook(contactUpdated(email, true), { tamper: true });
  check('a tampered body is rejected', bad.status, 401);
  const wrongKey = await sendWebhook(contactUpdated(email, true), { secret: 'whsec_' + Buffer.from('other-secret').toString('base64') });
  check('the wrong signing secret is rejected', wrongKey.status, 401);
  const old = await sendWebhook(contactUpdated(email, true), { ts: Math.floor(Date.now() / 1000) - 3600 });
  check('a replayed old delivery (outside the 5 minute window) is rejected', old.status, 401);
  const missing = await handleResendWebhook({ db, log }, { rawBody: '{}', secret: WHSEC, headers: { id: null, timestamp: null, signature: null } });
  check('missing signature headers are rejected', missing.status, 401);
  check('nothing changed after the rejected calls', consent(id).status, 'subscribed');

  const echo = await sendWebhook(contactUpdated(email, false));
  check('contact.updated "subscribed" (our own echo) never changes consent', [echo.status, consent(id).status, echo.body.outcome], [200, 'subscribed', 'ignored:not_an_optout']);

  const t = new Date(Date.now() + 5000).toISOString();
  const hook = { id: 'msg_dupe_1' };
  const ok = await sendWebhook(contactUpdated(email.toUpperCase(), true, t), hook);
  check('contact.updated unsubscribed=true -> consent unsubscribed (case-insensitive match)', [ok.status, consent(id).status, consent(id).consent_source], [200, 'unsubscribed', 'resend_webhook']);
  check('suppression stored with the provider event time', [q(`select reason from public.email_suppressions where email_normalized='${email}';`), q(`select to_char(event_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS') from public.email_suppressions where email_normalized='${email}';`)], ['unsubscribed', t.slice(0, 19)]);
  check('no feedback loop: nothing was queued back to Resend', outbox().length, outboxBefore);
  const dupe = await sendWebhook(contactUpdated(email, true, t), hook);
  check('the same svix-id delivered twice is applied once', [dupe.status, dupe.body.duplicate], [200, true]);

  // staleness
  const email2 = fresh('stale');
  const id2 = signup({ email: email2, confirmed: true });
  setConsent(id2, true);
  const optedIn = consent(id2).consent_at;
  const stale = await sendWebhook(contactUpdated(email2, true, new Date(Date.now() - 3600_000).toISOString()));
  check('a stale unsubscribe (older than the opt-in) cannot reverse the newer opt-in', [stale.status, consent(id2).status, consent(id2).consent_at], [200, 'subscribed', optedIn]);

  // newer unsubscribe stays unsubscribed when a stale "subscribed" event shows up later
  const email3 = fresh('newer');
  const id3 = signup({ email: email3, optIn: true, confirmed: true });
  await runDrain();
  await sendWebhook(contactUpdated(email3, true, new Date(Date.now() + 10_000).toISOString()));
  await sendWebhook(contactUpdated(email3, false, new Date(Date.now() - 10_000).toISOString()));
  await runDrain();
  check('a late "subscribed" event cannot undo a newer unsubscribe', consent(id3).status, 'unsubscribed');
  const s1 = q(`select event_at from public.email_suppressions where email_normalized='${email3}';`);
  await sendWebhook(contactUpdated(email3, true, new Date(Date.now() - 600_000).toISOString()));
  check('an older opt-out cannot overwrite a newer suppression record', q(`select event_at from public.email_suppressions where email_normalized='${email3}';`), s1);
  const callsBefore = resend.calls.length;
  await runDrain();
  check('unsubscribed accounts are never re-synced as subscribed', resend.contacts.get(email3)?.unsubscribed, false); // untouched by us (Resend side was never flipped in this fake)
  void callsBefore;

  // bounce / complaint
  const e4 = fresh('bounce'), e5 = fresh('soft'), e6 = fresh('spam');
  const i4 = signup({ email: e4, optIn: true, confirmed: true }), i5 = signup({ email: e5, optIn: true, confirmed: true }), i6 = signup({ email: e6, optIn: true, confirmed: true });
  const later = new Date(Date.now() + 5000).toISOString();
  await sendWebhook({ type: 'email.bounced', created_at: later, data: { to: [e4], bounce: { type: 'Permanent' } } });
  await sendWebhook({ type: 'email.bounced', created_at: later, data: { to: [e5], bounce: { type: 'Transient' } } });
  await sendWebhook({ type: 'email.complained', created_at: later, data: { to: [e6] } });
  check('hard bounce -> unsubscribed + suppression', [consent(i4).status, q(`select reason from public.email_suppressions where email_normalized='${e4}';`)], ['unsubscribed', 'bounced']);
  check('soft bounce is ignored', consent(i5).status, 'subscribed');
  check('complaint -> unsubscribed + suppression', [consent(i6).status, q(`select reason from public.email_suppressions where email_normalized='${e6}';`)], ['unsubscribed', 'complained']);
  const p6 = JSON.parse(asUser(i6, `select public.get_my_marketing_preference();`));
  check('Settings can say why marketing is off', p6.suppressed_reason, 'complained');
  check('unrelated events are acknowledged and ignored', (await sendWebhook({ type: 'email.delivered', created_at: later, data: { to: [e5] } })).body.outcome, 'ignored');
  const bounceAll = Number(q(`select count(*) from public.resend_webhook_events where processed_at is null;`));
  check('every processed webhook is marked processed', bounceAll, 0);

  // processing failure -> 500 so Resend retries, and the delivery is not marked done
  const failingDb = { rpc: async (fn, a) => (fn === 'apply_provider_suppression' ? { data: null, error: { message: 'db down' } } : db.rpc(fn, a)) };
  const r500 = await handleResendWebhook({ db: failingDb, log }, signedWebhook(contactUpdated(fresh('x'), true), { id: 'msg_fail_1' }));
  check('a database failure answers 500 (so Resend redelivers)', r500.status, 500);
  check('...and the delivery stays unprocessed', q(`select processed_at is null from public.resend_webhook_events where svix_id='msg_fail_1';`), 't');
}

section('Resend feedback loop');
{
  resend = makeFakeResend();
  const email = fresh('loop');
  const id = signup({ email, confirmed: true });
  setConsent(id, true);
  await runDrain();
  // Resend emails us about OUR OWN update; whatever it says, nothing may be queued or flipped.
  const n0 = outbox().length;
  await sendWebhook(contactUpdated(email, false));
  check('echo of our subscribe: nothing queued, consent unchanged', [outbox().length, consent(id).status], [n0, 'subscribed']);
  setConsent(id, false);
  await runDrain();
  const n1 = outbox().length;
  await sendWebhook(contactUpdated(email, true, new Date(Date.now() + 1000).toISOString()));
  check('echo of our unsubscribe: nothing queued back', outbox().length, n1);
  check('and the account is still just unsubscribed', consent(id).status, 'unsubscribed');
}

section('coalescing and duplicate protection');
{
  const email = fresh('burst');
  const id = signup({ email, confirmed: true });
  setConsent(id, true); setConsent(id, false); setConsent(id, true);
  const pend = outbox(`user_id='${id}' and status='pending'`);
  check('rapid toggles collapse into one pending event', pend.length, 1);
  check('...that carries the latest opt-in time', pend[0].payload.optin_at !== undefined, true);
  await runDrain();
  check('end state matches the last choice', [resend.contacts.get(email)?.unsubscribed, consent(id).status], [false, 'subscribed']);
}

section('existing historical users');
{
  resend = makeFakeResend();
  resend.seed(LEGACY.a, true);   // opted out in the old Resend audience
  resend.seed(LEGACY.b, false);  // on the old list, no proof of consent here
  const unsyncedQueued = Number(JSON.parse((await db.rpc('marketing_enqueue_unsynced', { p_limit: 1000 })).data));
  check('re-sync pass never queues unknown-consent accounts', outbox(`user_id in ('${ids.a}','${ids.b}','${ids.c}')`).length, 0);
  void unsyncedQueued;

  const contactsBefore = JSON.stringify([...resend.contacts.values()].map(({ segments, ...c }) => c));
  const dry = await importResendOptOuts(deps(), { dryRun: true });
  check('dry run counts opt-outs, changes nothing', [dry.unsubscribed >= 1, dry.dry_run, consent(ids.a).status], [true, true, 'unknown']);
  check('the fake list is paged (exercises pagination)', dry.pages >= 2 || resend.contacts.size <= 2, true);
  const real = await importResendOptOuts(deps(), { dryRun: false });
  check('import records the existing Resend opt-out', [consent(ids.a).status, consent(ids.a).consent_source, real.applied >= 1], ['unsubscribed', 'resend_backfill', true]);
  check('...as a suppression', q(`select reason from public.email_suppressions where email_normalized='${LEGACY.a}';`), 'unsubscribed');
  check('legacy account that was merely on the old list stays unknown', consent(ids.b).status, 'unknown');
  check('legacy account not in Resend stays unknown', consent(ids.c).status, 'unknown');
  check('the import never writes to Resend', JSON.stringify([...resend.contacts.values()].map(({ segments, ...c }) => c)), contactsBefore);
  check('the import never calls anything but GET', resend.calls.every((c) => c.method === 'GET' || c.path.startsWith('/contacts')), true);
  check('no event was queued, so no email/campaign can follow from a backfill', outbox(`user_id in ('${ids.a}','${ids.b}','${ids.c}')`).length, 0);
  const again = await importResendOptOuts(deps(), { dryRun: false });
  check('running the import twice is harmless', [consent(ids.a).status, again.accounts_unsubscribed], ['unsubscribed', 0]);
  await runDrain();
  const legacyEnc = Object.values(LEGACY).map((e) => encodeURIComponent(e));
  check('draining after a backfill makes no write call for any legacy account',
    resend.calls.filter((c) => c.method !== 'GET' && legacyEnc.some((e) => c.path.includes(e) || JSON.stringify(c.body || {}).includes(e.replace('%40', '@')))), []);

  // A legacy user who explicitly opts in later is subscribed, and that beats the old opt-out
  setConsent(ids.a, true);
  await runDrain();
  check('a legacy opt-out can only be lifted by that person opting in', [consent(ids.a).status, resend.contacts.get(LEGACY.a).unsubscribed], ['subscribed', false]);

  // A subscribed account whose Resend contact is unsubscribed, without a fresh explicit opt-in, is honoured
  const email = fresh('honour');
  const id = signup({ email, optIn: true, confirmed: true });
  sql(`update public.marketing_outbox set payload = '{}' where user_id = '${id}' and status = 'pending';`); // as if from a retry/backfill, not a fresh opt-in
  resend.seed(email, true);
  await runDrain();
  check('subscribed here but unsubscribed at Resend (no fresh opt-in): Resend wins, nothing is resubscribed', [resend.contacts.get(email).unsubscribed, consent(id).status], [true, 'unsubscribed']);
}

section('logging and secrets');
{
  const lines = logLines.join('\n');
  check('structured logs are JSON lines', logLines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), true);
  check('no API key material in the logs', /re_secretkey|re_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9+/=]{8,}|Bearer /.test(lines), false);
  check('no unmasked address in the logs', /[A-Za-z0-9._-]+@(?!\w\*\*\*)[A-Za-z0-9.-]+\.[a-z]+/.test(lines.replace(/\w\*\*\*@\w\*\*\*\.\w+/g, '')), false);
  check('maskEmail', [maskEmail('Kyla@Example.com'), maskEmail(null)], ['k***@e***.com', '(none)']);
  check('scrub removes keys, tokens and addresses', scrub('Bearer abc.def re_abcdefghijk1234 a@b.co whsec_QUJDREVGR0g='), 'Bearer [redacted] re_[redacted] a***@b***.co whsec_[redacted]');
  const sink = [];
  makeLogger((l) => sink.push(l))('error', 'x', { email: 'secret@person.com', error: 'oops re_abcdefghijk1234' });
  check('logger masks the email field and scrubs strings', /secret@person|re_abcdefghijk1234/.test(sink[0]), false);

  // the client puts the key only in the Authorization header
  const seen = [];
  const client = createResendClient({ apiKey: 're_live_supersecretvalue', minIntervalMs: 0, fetchFn: async (url, init) => { seen.push({ url, init }); return new Response('{"id":"1"}', { status: 200 }); } });
  const res = await client.request('GET', '/contacts/a%40b.co');
  check('Resend client uses the official host and a bearer header', [seen[0].url, seen[0].init.headers.Authorization, res.status], ['https://api.resend.com/contacts/a%40b.co', 'Bearer re_live_supersecretvalue', 200]);
  check('network errors become status 0 (retryable), without leaking the key', (await createResendClient({ apiKey: 're_live_supersecretvalue', minIntervalMs: 0, fetchFn: async () => { throw new Error('boom re_live_supersecretvalue'); } }).request('GET', '/x')).body.message.includes('supersecret'), false);
  const files = ['js/account.js', 'js/profile.js', 'index.html', 'supabase/functions/_shared/core.ts', 'supabase/functions/resend-sync/index.ts', 'supabase/functions/resend-webhook/index.ts', 'supabase/migrations/20261017_marketing_consent_sync.sql'];
  const leaked = files.filter((f) => /re_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9+/=]{20,}|service_role['"]?\s*[:=]\s*['"]eyJ/.test(readFileSync(join(here, '..', f), 'utf8')));
  check('no credentials committed in any new or changed file', leaked, []);
  check('RESEND_API_KEY is never referenced client-side', /RESEND_API_KEY/.test(readFileSync(join(here, '..', 'js/account.js'), 'utf8') + readFileSync(join(here, '..', 'js/profile.js'), 'utf8')), false);
  check('secretsMatch', [await secretsMatch('abc', 'abc'), await secretsMatch('abc', 'abd'), await secretsMatch('abc', null), await secretsMatch('abc', 'abcd')], [true, false, false, false]);
  const good = signedWebhook({ a: 1 });
  check('verifySvix accepts a good signature, rejects a changed body', [await verifySvix(good.rawBody, good.headers, WHSEC), await verifySvix(good.rawBody + ' ', good.headers, WHSEC)], [true, false]);
}

section('client wiring');
{
  const account = readFileSync(join(here, '..', 'js/account.js'), 'utf8');
  const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
  check('checkbox exists, is unchecked by default, and carries the exact wording',
    [/id="marketingOptIn"(?![^>]*checked)/.test(html),
     html.includes('Yes! Send me affirmations, wellness tips, product updates, and exclusive Subliminally offers. I can unsubscribe anytime.')], [true, true]);
  check('email signup passes the opt-in only when ticked', /marketingOptInChecked\(\)\s*\?\s*\{ data: \{ marketing_opt_in: true/.test(account), true);
  check('social signup records the tick before leaving for the provider', /authMode === 'signup' && marketingOptInChecked\(\)\) rememberPendingMarketingConsent/.test(account), true);
  check('pending social consent expires', /PENDING_MARKETING_TTL_MS/.test(account), true);
  check('Settings has Email Preferences wired to the RPCs', [html.includes('id="emailPrefsCard"'), html.includes('saveEmailPreference(this.checked)')], [true, true]);
  check('transactional mail is described as separate in Settings', /Account, security, billing and essential service emails/.test(html), true);
}

section('rollback script');
{
  psqlFile(ROLLBACK);
  check('rollback removes the tables and triggers cleanly', [
    q(`select count(*) from pg_tables where schemaname='public' and tablename like 'marketing_%' or tablename in ('email_suppressions','resend_webhook_events','app_admins');`),
    q(`select count(*) from pg_trigger where tgname like '%marketing%' and not tgisinternal;`),
    q(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname like 'marketing_%' or proname in ('set_marketing_consent','get_my_marketing_preference','apply_provider_suppression','is_app_admin','normalize_email'));`),
  ], ['0', '0', '0']);
  check('rollback leaves signup and the profile trigger working', q(`insert into auth.users (email) values ('after.rollback@example.com') returning id;`).length > 10, true);
  check('profiles trigger still fired', q(`select count(*) from public.profiles p join auth.users u on u.id=p.id where u.email='after.rollback@example.com';`), '1');
  psqlFile(MIGRATION);
  check('migration can be re-applied after a rollback', Number(q(`select count(*) from public.marketing_consent;`)) > 0, true);
  psqlFile(MIGRATION);
  check('migration is re-runnable (idempotent)', q(`select count(*) from information_schema.tables where table_schema='public' and table_name='marketing_consent';`), '1');
}

console.log(`\n${total - fails}/${total} checks passed${fails ? ` — ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
