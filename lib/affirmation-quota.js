/* affirmation-quota.js — the daily budget that keeps the OpenAI bill bounded.

   Units, not calls, because the actions are not the same size: a whole set is
   three and one rewritten line is one. At a mini-tier model a unit is about
   $0.0005, so the limits below cap one account at roughly $0.36 a month on
   Free and $0.90 on a paid plan even if it spends every unit every day. Change
   the numbers here, in one place, and nothing else needs to know. */

export const UNIT_COST = { generate: 3, regenerate_all: 3, improve: 3, regenerate_one: 1 };
export const DAILY_UNITS = { free: 24, paid: 60 };

const SUPABASE_URL = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export function dailyLimit(isPaid) {
  return isPaid ? DAILY_UNITS.paid : DAILY_UNITS.free;
}

/* Returns the units used today after spending, or -1 if that would exceed the
   limit. Throws if the budget cannot be checked: the route then refuses rather
   than serving requests it cannot count. A negative cost refunds. */
export async function spendUnits(userId, cost, limit) {
  const res = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/spend_affirmation_units`, {
    method: 'POST',
    headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user: userId, p_cost: cost, p_limit: limit }),
  });
  if (!res.ok) throw new Error(`quota check failed: ${res.status}`);
  const n = await res.json();
  if (typeof n !== 'number') throw new Error('quota check returned nothing');
  return n;
}
