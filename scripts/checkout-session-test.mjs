#!/usr/bin/env node
/* checkout-session-test.js — what the web checkout sends to Stripe

   Not part of the site: scripts/ is excluded from the deploy and from what the
   native apps bundle. It loads api/create-checkout-session.js with Stripe and
   Supabase stubbed, so nothing here talks to either, and asks the questions
   the checkout has to get right: does the session sell the price that Payment
   Link sells, does it carry the link's free trial, does it come back to
   Subliminally afterwards, and is the account it grants the signed-in one
   rather than the one the request claimed.

     npm run test:checkout

   The links below are the two in the PLANS catalog in js/billing.js. If a plan
   is re-created in Stripe and its link changes, change it there and here.
*/
process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_stub';
process.env.SITE_URL = 'https://www.subliminallybyfthr.com';

const ANNUAL = 'https://buy.stripe.com/9B6eVc2PsaxdgPRg5fgYU08';
const MONTHLY = 'https://buy.stripe.com/00weVc3Tw48PdDFdX7gYU07';

let fails = 0, sessionBodies = [], stripeCalls = [];
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(got)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
}

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')){
    const token = (opts.headers.Authorization || '').replace('Bearer ', '');
    if (token !== 'good-token') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ id: 'user-abc', email: 'kyla@example.com' }) };
  }
  stripeCalls.push(u);
  if (u.includes('payment_links/') && u.includes('line_items'))
    return { ok: true, json: async () => ({ data: [{ quantity: 1, price: { id: u.includes('plink_annual') ? 'price_annual' : 'price_monthly' } }] }) };
  if (u.includes('payment_links'))
    return { ok: true, json: async () => ({ has_more: false, data: [
      { id: 'plink_monthly', url: MONTHLY, subscription_data: { trial_period_days: 3 }, allow_promotion_codes: true },
      { id: 'plink_annual', url: ANNUAL, subscription_data: { trial_period_days: 3,
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } }, automatic_tax: { enabled: true } },
    ] }) };
  if (u.includes('checkout/sessions')){
    sessionBodies.push(Object.fromEntries(new URLSearchParams(opts.body)));
    return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' }) };
  }
  throw new Error('unexpected call: ' + u);
};

const { default: handler } = await import(new URL('../api/create-checkout-session.js', import.meta.url).href);

function mockRes(){
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}
const call = async (body, token = 'good-token') => {
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: token ? 'Bearer ' + token : '' }, body }, res);
  return res;
};

// The annual plan with the three-day trial — the one that was tested by hand.
let res = await call({ link: ANNUAL, tier: 'ritual', period: 'annual' });
check('annual checkout opens', { code: res.code, url: res.body.url }, { code: 200, url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
let sent = sessionBodies.at(-1);
check('it sells the annual price', sent['line_items[0][price]'], 'price_annual');
check('it is a subscription', sent.mode, 'subscription');
check('the free trial is carried over', sent['subscription_data[trial_period_days]'], '3');
check('including what happens without a card', sent['subscription_data[trial_settings][end_behavior][missing_payment_method]'], 'cancel');
check('it comes back to Subliminally', sent.success_url, 'https://www.subliminallybyfthr.com/?checkout=success#today');
check('cancelling comes back too', sent.cancel_url, 'https://www.subliminallybyfthr.com/?checkout=cancelled#pricing');
check('the webhook still gets its reference', sent.client_reference_id, 'user-abc__ritual_annual');
check('tax settings are copied', sent['automatic_tax[enabled]'], 'true');
check('the account is the signed-in one, not the one asked for', sent['metadata[supabase_user_id]'], 'user-abc');

// Monthly, off the other link.
sessionBodies = [];
res = await call({ link: MONTHLY, tier: 'ritual', period: 'monthly' });
sent = sessionBodies.at(-1);
check('monthly checkout opens', res.code, 200);
check('it sells the monthly price', sent['line_items[0][price]'], 'price_monthly');
check('with its own trial', sent['subscription_data[trial_period_days]'], '3');
check('and its promotion codes', sent.allow_promotion_codes, 'true');
check('monthly reference', sent.client_reference_id, 'user-abc__ritual_monthly');

// Nobody else's price, and nobody else's account.
res = await call({ link: 'https://buy.stripe.com/somebodyElsesLink', tier: 'ritual', period: 'annual' });
check('an unknown link is refused (the browser then opens the link itself)', res.code, 404);
res = await call({ link: 'https://evil.example.com/x', tier: 'ritual', period: 'annual' });
check('a link that is not even Stripe is refused', res.code, 400);
res = await call({ link: ANNUAL, tier: 'ritual', period: 'annual' }, 'bad-token');
check('a signed-out caller is refused', res.code, 401);
res = await call({ link: ANNUAL, tier: '<script>', period: 'weekly' });
check('a junk plan claim falls back to something sane', sessionBodies.at(-1).client_reference_id, 'user-abc__ritual_monthly');

// The link lookup is remembered rather than repeated on every checkout.
const before = stripeCalls.filter(u => u.includes('payment_links')).length;
await call({ link: ANNUAL, tier: 'ritual', period: 'annual' });
check('the link lookup is cached', stripeCalls.filter(u => u.includes('payment_links')).length, before);

console.log(fails ? `\n${fails} FAILED\n` : '\nall passed\n');
process.exit(fails ? 1 : 0);
