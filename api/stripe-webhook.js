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
//   SUPABASE_URL             - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY- Supabase -> Settings -> API -> service_role key (NOT the publishable one)

export const config = { api: { bodyParser: false } };

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Map each Stripe Price ID to your plan names.
// Find these in Stripe -> Product catalog -> click each product -> copy the Price ID (starts with "price_").
const PRICE_TO_TIER = {
  'price_1U00xTBiVHYI4vcXIDdi9kuF': 'whisper',
  'price_1U00y5BiVHYI4vcXrtlN930K': 'reverie',
  'price_1U00yoBiVHYI4vcXirZnmnwI': 'ritual',
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const crypto = await import('crypto');
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const signedPayload = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function supabaseRequest(path, options) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Supabase request failed:', res.status, text);
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
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
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
        const priceId = sub.items?.data?.[0]?.price?.id;
        const tier = PRICE_TO_TIER[priceId] || null;
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
      const priceId = sub.items?.data?.[0]?.price?.id;
      const tier = PRICE_TO_TIER[priceId] || null;
      const patch = {
        tier,
        status: sub.status,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      };
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
    res.status(500).send('Webhook handler error');
  }
}
