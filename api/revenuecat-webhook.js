// /api/revenuecat-webhook.js
// Vercel serverless function — no npm packages needed, uses built-in fetch + crypto.
//
// Native (iOS/Android) subscriptions go through RevenueCat instead of Stripe,
// because Apple/Google require in-app subscriptions to use their own billing.
// This keeps the same `subscribers` table Stripe already writes to, so
// getMyTier() on the front end doesn't care which store someone paid through.
//
// What it does:
// 1. Checks the Authorization header matches the shared secret you set when
//    creating the webhook in the RevenueCat dashboard (Project -> Integrations
//    -> Webhooks). RevenueCat doesn't sign payloads like Stripe does — a
//    shared secret header is its equivalent.
// 2. Maps the purchased product ID to one of your plan names.
// 3. Upserts the Supabase `subscribers` row for that user — keyed directly by
//    user_id, because the app logs into RevenueCat with the Supabase user's
//    id as the RevenueCat appUserID (see syncRevenueCatIdentity() in
//    index.html), so app_user_id IS the Supabase user id here.
//
// Required environment variables (set these in Vercel -> Project -> Settings -> Environment Variables):
//   REVENUECAT_WEBHOOK_AUTH   - any secret string you choose; paste the same value into
//                               RevenueCat's webhook "Authorization header value" field
//   SUPABASE_URL              - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Settings -> API -> service_role key (NOT the publishable one)
//
// Note: if someone somehow holds both a web (Stripe) and native (RevenueCat)
// subscription at once, whichever webhook fires last wins this row — an
// acceptable edge case for now rather than something worth merging logic for.

const REVENUECAT_WEBHOOK_AUTH = process.env.REVENUECAT_WEBHOOK_AUTH;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Must match the PLANS catalog in js/billing.js and the product IDs created in
// App Store Connect / Google Play Console / RevenueCat. Both Ritual products
// carry the `ritual` entitlement in the RevenueCat dashboard.
//
// Whisper is retired: it is not sold anywhere and has no pricing card, but
// people are still subscribed to it, so its two products stay mapped here.
// A renewal for one keeps writing tier 'whisper' — the row is left saying what
// the person actually pays for — and every place that *reads* a tier honours
// 'whisper' as Ritual (normalizeTier() in js/billing.js, tierForUser() in
// lib/supabase-auth.js). Deleting these rows would leave a paying subscriber
// with tier null, which is a free account.
const PRODUCT_TO_TIER = {
  'com.fthr.subliminally.ritual.monthly': 'ritual',
  'com.fthr.subliminally.ritual.annual': 'ritual',
  // --- legacy, recognised only so existing subscribers keep their access ---
  'com.fthr.subliminally.whisper.monthly': 'whisper',
  'com.fthr.subliminally.whisper.annual': 'whisper',
};

// Event types where the subscriber gained or renewed access.
const ACTIVE_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
]);

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function isAuthorized(headerValue) {
  if (!headerValue || !REVENUECAT_WEBHOOK_AUTH) return false;
  const crypto = await import('crypto');
  const a = Buffer.from(headerValue);
  const b = Buffer.from(REVENUECAT_WEBHOOK_AUTH);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function supabaseRequest(path, options) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    throw new Error(`Network error calling Supabase at "${url}": ${e.message}`);
  }
  if (!res.ok) {
    const text = await res.text();
    console.error('Supabase request failed:', res.status, text);
    throw new Error(`Supabase ${options.method || 'request'} to ${path} failed (${res.status}): ${text}`);
  }
  return res;
}

async function upsertByUserId(userId, patch) {
  await supabaseRequest('subscribers', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, ...patch }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const missing = [];
  if (!REVENUECAT_WEBHOOK_AUTH) missing.push('REVENUECAT_WEBHOOK_AUTH');
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    res.status(500).json({ error: 'Missing environment variables', detail: missing.join(', ') });
    return;
  }
  if (!/^https:\/\/.+\.supabase\.co$/.test(SUPABASE_URL.trim())) {
    res.status(500).json({ error: 'SUPABASE_URL looks malformed', detail: `Current value: "${SUPABASE_URL}" — should look like https://xxxxx.supabase.co with no trailing slash, quotes, or spaces.` });
    return;
  }

  if (!(await isAuthorized(req.headers['authorization']))) {
    res.status(401).send('Unauthorized');
    return;
  }

  const rawBody = await getRawBody(req);
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    res.status(400).send('Invalid JSON');
    return;
  }

  const event = payload.event;
  if (!event || !event.app_user_id) {
    res.status(200).json({ received: true, skipped: 'no app_user_id on event' });
    return;
  }

  try {
    const userId = event.app_user_id;
    const tier = PRODUCT_TO_TIER[event.product_id] || null;
    const expirationMs = event.expiration_at_ms || null;

    if (event.type === 'EXPIRATION') {
      await upsertByUserId(userId, { status: 'canceled' });
    } else if (ACTIVE_EVENT_TYPES.has(event.type)) {
      await upsertByUserId(userId, {
        tier,
        status: expirationMs && expirationMs > Date.now() ? 'active' : 'canceled',
        current_period_end: expirationMs ? new Date(expirationMs).toISOString() : null,
        // Reset the download count at the start of each new billing period.
        ...(event.type === 'RENEWAL' ? { downloads_used: 0 } : {}),
      });
    } else if (event.type === 'CANCELLATION') {
      // Auto-renew turned off, but they keep access until expiration_at_ms —
      // just record the current expiration; EXPIRATION flips status later.
      await upsertByUserId(userId, {
        current_period_end: expirationMs ? new Date(expirationMs).toISOString() : null,
      });
    }
    // BILLING_ISSUE, TRANSFER, and other event types: no action needed here —
    // a BILLING_ISSUE that isn't resolved eventually produces an EXPIRATION.

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('RevenueCat webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler error', detail: err.message || String(err) });
  }
}
