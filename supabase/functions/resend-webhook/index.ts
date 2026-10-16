// resend-webhook -- receives Resend webhooks (Svix-signed) and records opt-outs, bounces and
// complaints in Supabase. Deployed with --no-verify-jwt: Resend cannot send a Supabase JWT, so
// the Svix signature is the authentication. Anything unsigned is refused with 401.
//
// Secret: RESEND_WEBHOOK_SECRET (the `whsec_...` signing secret shown on the webhook in Resend).
// Events to subscribe to: contact.updated, contact.created, email.bounced, email.complained.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleResendWebhook, makeLogger } from '../_shared/core.ts';

Deno.serve(async (req) => {
  const log = makeLogger();
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) {
    log('error', 'webhook.not_configured', {});
    return new Response(JSON.stringify({ error: 'not configured' }), { status: 500 });
  }

  // The signature covers the exact bytes Resend sent, so read the raw text, never re-serialise.
  const rawBody = await req.text();
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await handleResendWebhook({ db, log }, {
    rawBody,
    secret,
    headers: {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
  });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
});
