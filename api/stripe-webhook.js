// /api/stripe-webhook.js
// Vercel serverless function — no npm packages needed, uses built-in fetch + crypto.
//
// What it does:
// 1. Verifies the request really came from Stripe (signature check)
// 2. On successful checkout, looks up which plan was purchased and writes it to
//    the Supabase `subscribers` table for that user
// 3. Keeps that row in sync as the subscription renews, upgrades, or cancels
//
// Required environment variables (set these in Vercel -> Project -> Settings -> Environment Variables):
//   STRIPE_SECRET_KEY        - Stripe Dashboard -> Developers -> API keys -> Secret key
//   STRIPE_WEBHOOK_SECRET    - shown when you create the webhook endpoint in Stripe (see setup notes)
//   STRIPE_PRICE_WHISPER_MONTHLY / STRIPE_PRICE_WHISPER_ANNUAL
//   STRIPE_PRICE_RITUAL_MONTHLY  / STRIPE_PRICE_RITUAL_ANNUAL
//     - immutable price_... IDs from the four active Payment Links
//   STRIPE_PRICE_WHISPER_LEGACY / STRIPE_PRICE_RITUAL_LEGACY
//     - optional comma-separated old price_... IDs for existing subscribers
//   SUPABASE_URL             - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY- Supabase -> Settings -> API -> service_role key (NOT the publishable one)

export const config = { api: { bodyParser: false } };

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Immutable Stripe Price IDs are the subscription authority. Configure the
// current IDs in Vercel; optional legacy IDs may be comma-separated so existing
// subscribers keep their access during renewals.
const PRICE_TO_TIER = new Map();
function registerPrices(value, tier) {
  String(value || '').split(',').map((id) => id.trim()).filter(Boolean)
    .forEach((id) => PRICE_TO_TIER.set(id, tier));
}
registerPrices(process.env.STRIPE_PRICE_WHISPER_MONTHLY, 'whisper');
registerPrices(process.env.STRIPE_PRICE_WHISPER_ANNUAL, 'whisper');
registerPrices(process.env.STRIPE_PRICE_RITUAL_MONTHLY, 'ritual');
registerPrices(process.env.STRIPE_PRICE_RITUAL_ANNUAL, 'ritual');
registerPrices(process.env.STRIPE_PRICE_WHISPER_LEGACY, 'whisper');
registerPrices(process.env.STRIPE_PRICE_RITUAL_LEGACY, 'ritual');

function tierForSubscription(sub) {
  const price = sub.items?.data?.[0]?.price;
  if (!price) return null;
  const metadataTier = price.metadata && ['whisper', 'ritual'].includes(price.metadata.subliminally_tier)
    ? price.metadata.subliminally_tier : null;
  const tier = PRICE_TO_TIER.get(price.id) || metadataTier;
  if (!tier) console.error('No tier mapped for Stripe Price ID', price.id);
  return tier;
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export async function verifyStripeSignature(rawBody, sigHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const crypto = await import('crypto');
  if (!sigHeader || !secret) return false;
  const values = {};
  for (const part of sigHeader.split(',')) {
    const splitAt = part.indexOf('=');
    if (splitAt < 1) continue;
    const key = part.slice(0, splitAt);
    (values[key] = values[key] || []).push(part.slice(splitAt + 1));
  }
  const timestamp = Number(values.t && values.t[0]);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  return (values.v1 || []).some((signature) => {
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
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

async function updateByStripeCustomerId(customerId, patch) {
  await supabaseRequest(`subscribers?stripe_customer_id=eq.${customerId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function fetchStripeSubscription(subscriptionId) {
  let res;
  try {
    res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
  } catch (e) {
    throw new Error(`Network error calling Stripe: ${e.message}`);
  }
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe subscription lookup failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  // Fail loudly and specifically if any required env var is missing/empty —
  // this is what usually causes a mysterious "fetch failed" downstream.
  const missing = [];
  if (!STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
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

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let valid = false;
  try {
    valid = await verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Signature verification error:', e);
  }
  if (!valid) {
    res.status(400).send('Invalid signature');
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    res.status(400).send('Invalid JSON');
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id;
      if (userId && session.subscription) {
        const sub = await fetchStripeSubscription(session.subscription);
        const tier = tierForSubscription(sub);
        if (!tier) throw new Error('Checkout used an unmapped Stripe Price ID');
        await upsertByUserId(userId, {
          stripe_customer_id: session.customer,
          tier,
          status: sub.status,
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
          downloads_used: 0,
        });
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const tier = tierForSubscription(sub);
      const patch = {
        status: sub.status,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      };
      if (tier) patch.tier = tier;
      // Reset the download count at the start of each new billing period
      const prevPeriodEnd = event.data.previous_attributes?.current_period_end;
      if (prevPeriodEnd && prevPeriodEnd !== sub.current_period_end) {
        patch.downloads_used = 0;
      }
      await updateByStripeCustomerId(sub.customer, patch);
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await updateByStripeCustomerId(sub.customer, { status: 'canceled' });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler error', detail: err.message || String(err) });
  }
}
