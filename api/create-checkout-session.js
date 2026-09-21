// /api/create-checkout-session.js
// Vercel serverless function — no npm packages needed, uses built-in fetch.
//
// Why this exists: a Stripe Payment Link cannot be told where to send somebody
// afterwards from the URL. Whatever its confirmation page is set to in the
// dashboard is what every customer gets, so paying left people sitting on a
// Stripe receipt page with no way back into the app. A Checkout Session can
// carry a success_url, so the web checkout goes through one of these instead
// and lands back on Subliminally the moment the payment completes.
//
// Nothing about the plan is duplicated here. The browser sends the Payment
// Link from the PLANS catalog in js/billing.js — still the one table — and
// this function looks that link up in Stripe and copies what it sells: the
// price, the quantity, the free trial, promotion codes, tax. So the dashboard
// stays the thing that decides what a plan costs and how long its trial runs,
// and a link that is not one of ours simply isn't found.
//
// The downstream flow is untouched: the session carries the same
// client_reference_id the Payment Link was given, so
// api/stripe-webhook.js sees the same checkout.session.completed it always
// did and writes the same `subscribers` row.
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   STRIPE_SECRET_KEY         - Stripe Dashboard -> Developers -> API keys -> Secret key
//   SUPABASE_URL              - same Project URL used on the site
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Settings -> API -> service_role key
//   SITE_URL                  - optional; where checkout returns to.
//                               Defaults to the live site.

export const config = { api: { bodyParser: true } };

import { applyCors } from '../lib/cors.js';
import { bearerToken, whoIsCalling } from '../lib/supabase-auth.js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SITE_URL = (process.env.SITE_URL || 'https://www.subliminallybyfthr.com').replace(/\/+$/, '');

/* Where a finished checkout lands. `?checkout=success` is what the browser
   watches for — see handleCheckoutReturn() in js/billing.js, which refreshes
   the plan rather than making anyone sign out and back in to see it — and
   `#today` is the signed-in home, not the sales page they just bought from. */
const SUCCESS_URL = `${SITE_URL}/?checkout=success#today`;
const CANCEL_URL = `${SITE_URL}/?checkout=cancelled#pricing`;

/* A Payment Link's configuration, once we have looked it up. Warm lambdas keep
   this between requests; it is only ever a copy of what Stripe already said,
   so the worst a stale entry can do is send somebody to the price that link
   sold a few minutes ago. */
const linkCache = new Map();

function stripeForm(obj, prefix, out) {
  const params = out || new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) stripeForm(value, name, params);
    else if (Array.isArray(value)) value.forEach((v, i) => stripeForm({ [i]: v }, name, params));
    else params.append(name, String(value));
  }
  return params;
}

async function stripe(path, options) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...(options || {}),
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...((options && options.body) ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...((options && options.headers) || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${JSON.stringify(json.error || json)}`);
  return json;
}

/* Find the Payment Link the pricing page opened, by its buy.stripe.com URL.
   Only links on this Stripe account can match, which is what makes it safe to
   take the URL from the browser: there is no price here that we did not
   already publish ourselves. */
async function findPaymentLink(url) {
  let starting_after = null;
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({ limit: '100' });
    if (starting_after) qs.set('starting_after', starting_after);
    const list = await stripe(`payment_links?${qs}`);
    const hit = (list.data || []).find((l) => l.url === url);
    if (hit) return hit;
    if (!list.has_more || !list.data.length) return null;
    starting_after = list.data[list.data.length - 1].id;
  }
  return null;
}

async function planForLink(url) {
  if (linkCache.has(url)) return linkCache.get(url);
  const link = await findPaymentLink(url);
  if (!link) return null;
  const items = await stripe(`payment_links/${link.id}/line_items?limit=10`);
  const first = (items.data || [])[0];
  const priceId = first && first.price && first.price.id;
  if (!priceId) return null;
  const plan = {
    priceId,
    quantity: first.quantity || 1,
    // Everything below is copied rather than decided here, so the dashboard
    // stays the only place a plan's terms are set.
    trialPeriodDays: link.subscription_data && link.subscription_data.trial_period_days,
    trialSettings: link.subscription_data && link.subscription_data.trial_settings,
    allowPromotionCodes: !!link.allow_promotion_codes,
    automaticTax: !!(link.automatic_tax && link.automatic_tax.enabled),
  };
  linkCache.set(url, plan);
  return plan;
}

/* Same shape the Payment Links were given: the user id, then the plan the
   button claimed to be selling. api/stripe-webhook.js parses it and compares
   the claim against what Stripe actually charged. Stripe allows letters,
   digits, dashes and underscores here. */
function checkoutReference(userId, tier, period) {
  return `${userId}__${tier}_${period}`;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  if (!STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'Stripe is not configured on the server yet.' });
    return;
  }

  // Who is checking out is decided by their Supabase token, never by anything
  // the request says about itself — the user id in client_reference_id is what
  // the webhook grants a subscription to.
  const user = await whoIsCalling(bearerToken(req));
  if (!user) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }

  const { link, tier, period } = req.body || {};
  if (typeof link !== 'string' || !/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/.test(link)) {
    res.status(400).json({ error: 'Unknown checkout link.' });
    return;
  }
  const safeTier = /^[a-z]{1,20}$/.test(String(tier || '')) ? tier : 'ritual';
  const safePeriod = ['monthly', 'annual'].includes(String(period || '')) ? period : 'monthly';

  try {
    const plan = await planForLink(link);
    if (!plan) {
      // Not one of our links, or one with nothing to sell. The browser falls
      // back to opening the Payment Link itself, so checkout still works.
      res.status(404).json({ error: 'That checkout link is not set up in Stripe.' });
      return;
    }

    const session = await stripe('checkout/sessions', {
      method: 'POST',
      body: stripeForm({
        mode: 'subscription',
        line_items: [{ price: plan.priceId, quantity: plan.quantity }],
        success_url: SUCCESS_URL,
        cancel_url: CANCEL_URL,
        client_reference_id: checkoutReference(user.id, safeTier, safePeriod),
        customer_email: user.email || undefined,
        allow_promotion_codes: plan.allowPromotionCodes || undefined,
        automatic_tax: plan.automaticTax ? { enabled: true } : undefined,
        subscription_data: plan.trialPeriodDays
          ? {
              trial_period_days: plan.trialPeriodDays,
              ...(plan.trialSettings ? { trial_settings: plan.trialSettings } : {}),
            }
          : undefined,
        // So a subscription can be traced back to an account from the Stripe
        // dashboard alone, the way the webhook traces it the other way.
        metadata: { supabase_user_id: user.id, tier: safeTier, period: safePeriod },
      }).toString(),
    });

    if (!session || !session.url) {
      res.status(502).json({ error: 'Stripe did not return a checkout URL.' });
      return;
    }
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: 'Could not open checkout.', detail: err.message || String(err) });
  }
}
