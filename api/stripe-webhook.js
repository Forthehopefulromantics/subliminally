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

// Which plan a payment buys, keyed by what it charges in cents. Going by the
// amount rather than the Price ID means new Payment Links at the same prices
// keep working without a code change, and there's no ID to copy across by hand
// and get wrong.
//
// The amounts are the same contract as amountCents in the PLANS catalog in
// js/billing.js — that table decides which link a tier's button opens, this
// one decides which tier a completed payment grants. Change a price in Stripe
// and both have to move.
//
// Legacy amounts are from before the plan restructures. Whisper and Reverie
// are both retired; anyone still paying for either keeps everything they had,
// which now lives on Ritual. Their amounts stay mapped so a renewal is still
// recognised — the stored tier keeps saying what they actually pay for, and
// every place that reads a tier honours it as Ritual (normalizeTier() in
// js/billing.js, tierForUser() in lib/supabase-auth.js). Dropping a legacy
// amount here would write tier null on the next renewal, which is a free
// account for somebody who is still being charged.
const AMOUNT_TO_PLAN = {
  1499: { tier: 'ritual', period: 'monthly' },   // Ritual monthly, $14.99
  11199: { tier: 'ritual', period: 'annual' },   // Ritual yearly, $111.99
  // --- legacy, recognised only so existing subscribers keep their access ---
  1111: { tier: 'ritual', period: 'monthly' },   // legacy Ritual, $11.11/mo
  11100: { tier: 'ritual', period: 'annual' },   // legacy Ritual, $111/yr
  555: { tier: 'whisper', period: 'monthly' },   // legacy Whisper, $5.55/mo
  5500: { tier: 'whisper', period: 'annual' },   // legacy Whisper, $55/yr
  1000: { tier: 'whisper', period: 'monthly' },  // legacy Whisper, $10/mo
  2200: { tier: 'ritual', period: 'monthly' },   // legacy Reverie, $22/mo
  3500: { tier: 'ritual', period: 'monthly' },   // legacy Ritual, $35/mo
};

function planForSubscription(sub) {
  const price = sub.items?.data?.[0]?.price;
  if (!price) return null;
  const plan = AMOUNT_TO_PLAN[price.unit_amount] || null;
  if (!plan) console.error('No tier mapped for amount', price.unit_amount, 'price', price.id);
  return plan;
}

function tierForSubscription(sub) {
  const plan = planForSubscription(sub);
  return plan ? plan.tier : null;
}

// client_reference_id carries the Supabase user id, and — since the plan
// catalog landed — the plan the button claimed to be selling, as
// "<user id>__<tier>_<period>". Older checkouts sent the bare user id, so a
// reference with no "__" is read as a user id and nothing else.
function parseClientReference(raw) {
  if (!raw) return { userId: null, intended: null };
  const [userId, plan] = String(raw).split('__');
  if (!plan) return { userId: userId || null, intended: null };
  const cut = plan.lastIndexOf('_');
  if (cut < 1) return { userId: userId || null, intended: null };
  return { userId: userId || null, intended: { tier: plan.slice(0, cut), period: plan.slice(cut + 1) } };
}

// A Payment Link points at one product, and which URL sits on which pricing
// button is a hand-pasted thing that nothing downstream can see. This is the
// check for it: what the button offered, against what Stripe actually charged.
// A mismatch means a link on the pricing page opens the wrong product's
// checkout, so it's logged loudly with both sides named. What somebody paid
// for is still what they get — the amount is the truth here, never the button.
function warnIfPlanMismatch(intended, charged, price) {
  if (!intended || !charged) return;
  if (intended.tier === charged.tier && intended.period === charged.period) return;
  console.error(
    `Checkout plan mismatch: the pricing page offered ${intended.tier}/${intended.period} ` +
      `but Stripe charged ${price?.unit_amount} (${charged.tier}/${charged.period}, price ${price?.id}). ` +
      'A Payment Link in the PLANS catalog in js/billing.js is pointed at the wrong product. ' +
      `Granting ${charged.tier} — what was actually paid for.`
  );
}

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
      const { userId, intended } = parseClientReference(session.client_reference_id);
      if (userId && session.subscription) {
        const sub = await fetchStripeSubscription(session.subscription);
        const charged = planForSubscription(sub);
        const tier = charged ? charged.tier : null;
        warnIfPlanMismatch(intended, charged, sub.items?.data?.[0]?.price);
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
    res.status(500).json({ error: 'Webhook handler error', detail: err.message || String(err) });
  }
}
