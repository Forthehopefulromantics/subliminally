// Shared logic for the resend-sync and resend-webhook Edge Functions.
//
// Everything here takes its collaborators as arguments (database RPC, Resend client, clock,
// logger) so scripts/marketing-sync-test.mjs can run it against a real Postgres and a fake
// Resend. Only erasable TypeScript syntax is used, so the same file runs under Deno (Supabase)
// and under Node's built-in type stripping (the tests).

export interface Db {
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: any; error: { message: string } | null }>;
}

export interface Logger {
  (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void;
}

export interface ResendResponse {
  status: number;            // 0 = the request never got an answer
  body: any;
  retryAfter: number | null; // seconds, from Retry-After on a 429
}

export interface ResendApi {
  request(method: string, path: string, body?: unknown): Promise<ResendResponse>;
}

export interface Deps {
  db: Db;
  resend: ResendApi;
  segmentId: string;
  log: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// ------------------------------------------------------------------ small helpers

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return e.length > 0 && e.includes('@') ? e : null;
}

/** k***@d***.com — enough to correlate a log line, not enough to mail someone. */
export function maskEmail(email: unknown): string {
  const e = normalizeEmail(email);
  if (!e) return '(none)';
  const [local, domain] = e.split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
}

/** Strips anything that looks like a credential before a message is logged or stored. */
export function scrub(text: unknown): string {
  return String(text ?? '')
    .replace(/re_[A-Za-z0-9_\-]{8,}/g, 're_[redacted]')
    .replace(/whsec_[A-Za-z0-9+/=_\-]+/g, 'whsec_[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, '[jwt]')
    .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m))
    .slice(0, 400);
}

export function makeLogger(sink: (line: string) => void = console.log): Logger {
  return (level, event, fields = {}) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (/email/i.test(k) && typeof v === 'string') safe[k] = maskEmail(v);
      else if (typeof v === 'string') safe[k] = scrub(v);
      else safe[k] = v;
    }
    sink(JSON.stringify({ level, event, ts: new Date().toISOString(), ...safe }));
  };
}

export function sameInstant(a: unknown, b: unknown): boolean {
  if (!a || !b) return false;
  const x = new Date(a as string).getTime();
  const y = new Date(b as string).getTime();
  return Number.isFinite(x) && x === y;
}

async function rpc(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<any> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`rpc ${fn} failed: ${scrub(error.message)}`);
  return data;
}

// ------------------------------------------------------------------ Resend client

export function createResendClient(opts: {
  apiKey: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  minIntervalMs?: number;     // Resend allows ~2 requests/second by default
  sleep?: (ms: number) => Promise<void>;
}): ResendApi {
  const f = opts.fetchFn ?? fetch;
  const base = opts.baseUrl ?? 'https://api.resend.com';
  const gap = opts.minIntervalMs ?? 550;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last = 0;
  return {
    async request(method, path, body) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await f(base + path, {
          method,
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'subliminally-marketing-sync/1',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        let parsed: any = null;
        try { parsed = await res.json(); } catch { parsed = null; }
        const ra = Number(res.headers?.get?.('retry-after'));
        return { status: res.status, body: parsed, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
      } catch (e) {
        return { status: 0, body: { message: scrub((e as Error)?.message) }, retryAfter: null };
      }
    },
  };
}

/** A Resend failure, classified for the retry machinery. */
export class SyncError extends Error {
  retryable: boolean;
  retryAfter: number | null;
  fatal: boolean;   // credentials / permissions: stop the whole drain, don't burn retries
  constructor(message: string, retryable: boolean, retryAfter: number | null = null, fatal = false) {
    super(message);
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.fatal = fatal;
  }
}

function fail(what: string, r: ResendResponse): never {
  const detail = scrub(r.body?.message ?? r.body?.name ?? '');
  const msg = `resend ${what}: HTTP ${r.status}${detail ? ' ' + detail : ''}`;
  if (r.status === 401 || r.status === 403) throw new SyncError(msg, false, null, true);
  if (r.status === 0 || r.status === 408 || r.status === 429 || r.status >= 500) {
    throw new SyncError(msg, true, r.retryAfter);
  }
  throw new SyncError(msg, false);
}

const enc = encodeURIComponent;

// ------------------------------------------------------------------ outbox events

interface OutboxRow {
  id: number;
  user_id: string | null;
  email_normalized: string;
  event_type: string;
  payload: Record<string, any>;
  attempts: number;
}

async function unsubscribeOrForget(deps: Deps, email: string, forget: boolean): Promise<string> {
  const { db, resend } = deps;
  const suppression = await rpc(db, 'marketing_get_suppression', { p_email: email });
  if (forget && !suppression) {
    const r = await resend.request('DELETE', `/contacts/${enc(email)}`);
    if (r.status >= 200 && r.status < 300) return 'deleted';
    if (r.status === 404) return 'absent';
    fail('delete contact', r);
  }
  // Keep the contact, marked unsubscribed, so the opt-out/complaint keeps being honoured.
  const r = await resend.request('PATCH', `/contacts/${enc(email)}`, { unsubscribed: true });
  if (r.status >= 200 && r.status < 300) return 'unsubscribed';
  if (r.status === 404) return 'absent';
  fail('unsubscribe contact', r);
}

async function processDelete(deps: Deps, ev: OutboxRow): Promise<string> {
  const emails = new Set<string>();
  for (const e of [ev.payload?.email, ev.payload?.synced_email, ev.email_normalized]) {
    const n = normalizeEmail(e);
    if (n) emails.add(n);
  }
  const outcomes: string[] = [];
  for (const email of emails) {
    // Someone may have signed up with this address again since; never delete their contact.
    if (await rpc(deps.db, 'marketing_email_has_account', { p_email: email })) { outcomes.push('in_use'); continue; }
    outcomes.push(await unsubscribeOrForget(deps, email, true));
  }
  return 'delete:' + (outcomes.join(',') || 'nothing');
}

async function processReconcile(deps: Deps, ev: OutboxRow): Promise<string> {
  const { db, resend, segmentId, log } = deps;
  const ctx = await rpc(db, 'marketing_sync_context', { p_user_id: ev.user_id });
  if (!ctx || !ctx.user_exists) return 'user_gone';
  const consent = ctx.consent;
  if (!consent) return 'no_consent_row';
  const email: string = ctx.email;

  // The address changed since we last told Resend: clean up the old contact first.
  const old = normalizeEmail(consent.synced_email);
  if (old && old !== email) {
    if (!(await rpc(db, 'marketing_email_has_account', { p_email: old }))) {
      await unsubscribeOrForget(deps, old, true);
    }
    await rpc(db, 'marketing_mark_synced', { p_user_id: ev.user_id, p_status: null, p_email: null, p_contact_id: null });
    log('info', 'sync.old_contact_removed', { event_id: ev.id, old_email: old });
  }

  // ---- not subscribed: only ever move toward unsubscribed
  if (consent.status !== 'subscribed') {
    if (consent.status === 'unsubscribed') {
      const r = await resend.request('PATCH', `/contacts/${enc(email)}`, { unsubscribed: true });
      if (r.status === 404) return 'unsubscribed:no_contact';
      if (r.status < 200 || r.status >= 300) fail('unsubscribe contact', r);
      await rpc(db, 'marketing_mark_synced', { p_user_id: ev.user_id, p_status: 'unsubscribed', p_email: email, p_contact_id: r.body?.id ?? null });
      return 'unsubscribed';
    }
    return 'not_eligible:unknown'; // unknown consent is never sent anywhere
  }

  // ---- subscribed, but the address is not proven to be theirs yet
  if (!ctx.email_confirmed) return 'awaiting_email_verification';

  // ---- a newer opt-out we have on file beats a subscribed row (defensive; the DB keeps these aligned)
  const sup = ctx.suppression;
  if (sup && (!consent.consent_at || new Date(sup.event_at).getTime() >= new Date(consent.consent_at).getTime())) {
    return 'blocked_by_suppression:' + sup.reason;
  }

  // An explicit opt-in that is still the person's latest decision may lift an old Resend opt-out.
  // Anything else (signup retries, email changes, backfills) never does.
  const explicitOptIn = sameInstant(ev.payload?.optin_at, consent.consent_at);

  let contact = await resend.request('GET', `/contacts/${enc(email)}`);
  if (contact.status !== 200 && contact.status !== 404) fail('get contact', contact);

  let contactId: string | null = contact.body?.id ?? null;
  let created = false;
  if (contact.status === 404) {
    const c = await resend.request('POST', '/contacts', {
      email, unsubscribed: false, segments: [{ id: segmentId }],
    });
    if (c.status === 200 || c.status === 201) {
      contactId = c.body?.id ?? null;
      created = true;
    } else if (c.status === 409 || c.status === 422) {
      // Lost a race with another writer: it exists now, so look again.
      contact = await resend.request('GET', `/contacts/${enc(email)}`);
      if (contact.status !== 200) fail('create contact', c);
      contactId = contact.body?.id ?? null;
    } else {
      fail('create contact', c);
    }
  }

  if (!created) {
    if (contact.body?.unsubscribed === true) {
      if (!explicitOptIn) {
        // They opted out at Resend and have not explicitly opted back in: honour it.
        const applied = await rpc(db, 'apply_provider_suppression', {
          p_email: email, p_reason: 'unsubscribed',
          p_event_at: new Date((deps.now ?? Date.now)()).toISOString(), p_source: 'resend_reconcile',
        });
        log('info', 'sync.honoured_resend_optout', { event_id: ev.id, email, applied });
        await rpc(db, 'marketing_mark_synced', { p_user_id: ev.user_id, p_status: 'unsubscribed', p_email: email, p_contact_id: contactId });
        return 'honoured_resend_optout';
      }
      const u = await resend.request('PATCH', `/contacts/${enc(email)}`, { unsubscribed: false });
      if (u.status < 200 || u.status >= 300) fail('resubscribe contact', u);
    }
    // Make sure it is in the marketing segment (adding twice is harmless).
    const s = await resend.request('POST', `/contacts/${enc(email)}/segments/${enc(segmentId)}`);
    if (!(s.status >= 200 && s.status < 300) && s.status !== 409) fail('add to segment', s);
  }

  await rpc(db, 'marketing_mark_synced', { p_user_id: ev.user_id, p_status: 'subscribed', p_email: email, p_contact_id: contactId });
  return created ? 'created' : 'updated';
}

/** Runs one outbox event. Returns a short outcome note; throws SyncError on failure. */
export async function processEvent(deps: Deps, ev: OutboxRow): Promise<string> {
  return ev.event_type === 'delete' ? await processDelete(deps, ev) : await processReconcile(deps, ev);
}

export interface DrainSummary {
  claimed: number; done: number; retrying: number; failed: number; aborted: boolean;
}

/** Claims due events and works through them until none are left or the time budget is spent. */
export async function drain(deps: Deps, opts: { batch?: number; budgetMs?: number } = {}): Promise<DrainSummary> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? 45000;
  const batch = opts.batch ?? 5;
  const out: DrainSummary = { claimed: 0, done: 0, retrying: 0, failed: 0, aborted: false };

  while (now() - started < budget && !out.aborted) {
    const rows: OutboxRow[] = await rpc(deps.db, 'marketing_claim_outbox', { p_limit: batch, p_lease_seconds: 120 });
    if (!rows || rows.length === 0) break;
    out.claimed += rows.length;

    for (let i = 0; i < rows.length; i++) {
      const ev = rows[i];
      if (out.aborted) {
        await rpc(deps.db, 'marketing_complete_outbox', {
          p_id: ev.id, p_ok: false, p_note: 'drain aborted: provider rejected credentials', p_retryable: false,
        });
        out.failed++;
        continue;
      }
      try {
        const note = await processEvent(deps, ev);
        await rpc(deps.db, 'marketing_complete_outbox', { p_id: ev.id, p_ok: true, p_note: note });
        out.done++;
        deps.log('info', 'sync.event_done', { event_id: ev.id, type: ev.event_type, outcome: note, attempts: ev.attempts });
      } catch (e) {
        const se = e instanceof SyncError ? e : new SyncError(scrub((e as Error)?.message), true);
        const status = await rpc(deps.db, 'marketing_complete_outbox', {
          p_id: ev.id, p_ok: false, p_note: se.message, p_retryable: se.retryable,
          p_retry_after_seconds: se.retryAfter,
        });
        if (status === 'pending') out.retrying++; else out.failed++;
        deps.log(se.fatal ? 'error' : 'warn', 'sync.event_failed', {
          event_id: ev.id, type: ev.event_type, attempts: ev.attempts, status, error: se.message,
        });
        if (se.fatal) out.aborted = true;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ backfill of Resend opt-outs

/**
 * One-off, read-only against Resend: pages through existing contacts and records everyone who
 * is already unsubscribed there, so a legacy account never gets subscribed over an opt-out.
 * It never writes to Resend and never subscribes anyone. Defaults to a dry run.
 */
export async function importResendOptOuts(deps: Deps, opts: { dryRun?: boolean; maxPages?: number } = {}) {
  const dryRun = opts.dryRun !== false;
  const maxPages = opts.maxPages ?? 200;
  let after: string | null = null;
  const out = { scanned: 0, unsubscribed: 0, applied: 0, accounts_unsubscribed: 0, pages: 0, dry_run: dryRun, complete: false };
  const at = new Date((deps.now ?? Date.now)()).toISOString();

  for (let page = 0; page < maxPages; page++) {
    const r: ResendResponse = await deps.resend.request('GET', `/contacts?limit=100${after ? `&after=${enc(after)}` : ''}`);
    if (r.status !== 200) fail('list contacts', r);
    const rows: any[] = Array.isArray(r.body?.data) ? r.body.data : [];
    out.pages++;
    for (const c of rows) {
      out.scanned++;
      if (c?.unsubscribed !== true) continue;
      const email = normalizeEmail(c.email);
      if (!email) continue;
      out.unsubscribed++;
      if (dryRun) continue;
      const res = await rpc(deps.db, 'apply_provider_suppression', {
        p_email: email, p_reason: 'unsubscribed', p_event_at: at, p_source: 'resend_backfill',
      });
      out.applied++;
      out.accounts_unsubscribed += Number(res?.accounts_unsubscribed ?? 0);
    }
    if (!r.body?.has_more || rows.length === 0) { out.complete = true; break; }
    after = rows[rows.length - 1].id;
  }
  deps.log('info', 'backfill.optouts', out);
  return out;
}

// ------------------------------------------------------------------ Resend webhooks (Svix)

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Verifies a Svix-signed webhook: HMAC-SHA256 over `${id}.${timestamp}.${body}`, 5 minute window. */
export async function verifySvix(
  rawBody: string,
  h: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowMs: number = Date.now(),
  toleranceSec = 300,
): Promise<boolean> {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;
  let keyBytes: Uint8Array;
  try { keyBytes = b64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret); } catch { return false; }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const data = new TextEncoder().encode(`${h.id}.${h.timestamp}.${rawBody}`);
  for (const part of h.signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    let sigBytes: Uint8Array;
    try { sigBytes = b64ToBytes(sig); } catch { continue; }
    if (await crypto.subtle.verify('HMAC', key, sigBytes, data)) return true;   // constant-time compare
  }
  return false;
}

export interface WebhookResult { status: number; body: Record<string, unknown>; }

export async function handleResendWebhook(
  deps: Pick<Deps, 'db' | 'log' | 'now'>,
  req: { rawBody: string; headers: { id: string | null; timestamp: string | null; signature: string | null }; secret: string },
): Promise<WebhookResult> {
  const { db, log } = deps;
  const nowMs = (deps.now ?? Date.now)();
  if (!(await verifySvix(req.rawBody, req.headers, req.secret, nowMs))) {
    log('warn', 'webhook.bad_signature', {});
    return { status: 401, body: { error: 'invalid signature' } };
  }
  let evt: any;
  try { evt = JSON.parse(req.rawBody); } catch { return { status: 400, body: { error: 'invalid json' } }; }
  const type = String(evt?.type ?? '');
  const svixId = req.headers.id as string;

  const first = await rpc(db, 'marketing_record_webhook', { p_svix_id: svixId, p_type: type });
  if (!first) return { status: 200, body: { ok: true, duplicate: true } };

  // When it happened at Resend (not when it reached us), so a late-delivered old event can
  // never override a newer decision.
  const eventAt = new Date(evt?.created_at ?? Number(req.headers.timestamp) * 1000);
  const at = Number.isFinite(eventAt.getTime()) ? eventAt.toISOString() : new Date(nowMs).toISOString();
  const data = evt?.data ?? {};
  let outcome = 'ignored';

  try {
    const suppress = async (emails: unknown[], reason: string) => {
      let flipped = 0;
      for (const raw of emails) {
        const email = normalizeEmail(raw);
        if (!email) continue;
        const res = await rpc(db, 'apply_provider_suppression', {
          p_email: email, p_reason: reason, p_event_at: at, p_source: 'resend_webhook',
        });
        flipped += Number(res?.accounts_unsubscribed ?? 0);
      }
      return flipped;
    };

    if ((type === 'contact.updated' || type === 'contact.created') && data.unsubscribed === true) {
      const n = await suppress([data.email], 'unsubscribed');
      outcome = `unsubscribed:${n}`;
    } else if (type === 'contact.updated' || type === 'contact.created') {
      // Resend saying "subscribed" is either our own sync echoing back or a dashboard edit.
      // Neither may change consent in Supabase -- only the person can opt in.
      outcome = 'ignored:not_an_optout';
    } else if (type === 'email.complained') {
      outcome = `complained:${await suppress(Array.isArray(data.to) ? data.to : [], 'complained')}`;
    } else if (type === 'email.bounced') {
      const kind = String(data?.bounce?.type ?? '').toLowerCase();
      if (kind === 'permanent') outcome = `bounced:${await suppress(Array.isArray(data.to) ? data.to : [], 'bounced')}`;
      else outcome = 'ignored:soft_bounce';
    }
  } catch (e) {
    log('error', 'webhook.failed', { type, error: scrub((e as Error)?.message) });
    return { status: 500, body: { error: 'processing failed' } }; // not marked processed: Resend will retry
  }

  await rpc(db, 'marketing_finish_webhook', { p_svix_id: svixId, p_outcome: outcome });
  log('info', 'webhook.processed', { type, outcome });
  return { status: 200, body: { ok: true, outcome } };
}

/** Constant-time string comparison (hashes first so length differences leak nothing). */
export async function secretsMatch(a: string | null, b: string | null): Promise<boolean> {
  if (!a || !b) return false;
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
