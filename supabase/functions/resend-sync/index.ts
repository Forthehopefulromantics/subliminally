// resend-sync -- pushes marketing-consent changes from Supabase to Resend Contacts.
//
// Called by (a) the pg_net poke in marketing_kick() right after an outbox row is written,
// (b) the scheduled drain (pg_cron, every 5 minutes) that retries failures, and (c) you, for
// replay / backfill. Every caller proves itself with the MARKETING_SYNC_SECRET header; the
// function is deployed with --no-verify-jwt because nothing here is a signed-in user.
//
// Secrets (supabase secrets set ...): RESEND_API_KEY, RESEND_SEGMENT_ID, MARKETING_SYNC_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// POST { "action": "drain" }                       work through due events (default)
// POST { "action": "replay" }                      failed/dead events -> pending, then drain
// POST { "action": "enqueue_unsynced" }            queue anyone whose Resend state is out of date, then drain
// POST { "action": "backfill_optouts", "dry_run": true }   read Resend, record existing opt-outs (never writes to Resend)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { createResendClient, drain, importResendOptOuts, makeLogger, scrub, secretsMatch } from '../_shared/core.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const log = makeLogger();
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  if (!(await secretsMatch(req.headers.get('x-sync-secret'), Deno.env.get('MARKETING_SYNC_SECRET') ?? null))) {
    log('warn', 'sync.unauthorized', {});
    return json(401, { error: 'unauthorized' });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const segmentId = Deno.env.get('RESEND_SEGMENT_ID');
  if (!url || !serviceKey || !apiKey || !segmentId) {
    log('error', 'sync.not_configured', {
      missing: [!url && 'SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY', !apiKey && 'RESEND_API_KEY', !segmentId && 'RESEND_SEGMENT_ID'].filter(Boolean),
    });
    return json(500, { error: 'not configured' });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* an empty poke means "drain" */ }
  const action = String(body?.action ?? 'drain');

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const deps = { db, resend: createResendClient({ apiKey }), segmentId, log };

  try {
    if (action === 'backfill_optouts') {
      return json(200, await importResendOptOuts(deps, { dryRun: body?.dry_run !== false }));
    }
    let requeued: number | undefined;
    if (action === 'replay') {
      const { data, error } = await db.rpc('marketing_requeue_failed', { p_limit: Number(body?.limit ?? 500) });
      if (error) throw new Error(error.message);
      requeued = data;
    } else if (action === 'enqueue_unsynced') {
      const { data, error } = await db.rpc('marketing_enqueue_unsynced', { p_limit: Number(body?.limit ?? 500) });
      if (error) throw new Error(error.message);
      requeued = data;
    } else if (action !== 'drain') {
      return json(400, { error: 'unknown action' });
    }
    const summary = await drain(deps);
    return json(200, { action, requeued, ...summary });
  } catch (e) {
    log('error', 'sync.crashed', { action, error: scrub((e as Error)?.message) });
    return json(500, { error: 'sync failed' });
  }
});
