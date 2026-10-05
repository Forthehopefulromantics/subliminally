export const config = { api: { bodyParser: true } };

import { applyCors } from '../lib/cors.js';
import { cleanRequest, buildResponsesRequest, readAffirmations, callOpenAI } from '../lib/affirmation-engine.js';
import { bearerToken, whoIsCalling, tierForUser, hasPremiumAccess } from '../lib/supabase-auth.js';
import { UNIT_COST, dailyLimit, spendUnits } from '../lib/affirmation-quota.js';

/* The one route behind every affirmation action in the builder: generate,
   regenerate all, regenerate one, make these better (body.mode). The key is
   read here, on the server, and never leaves it. The model is AFFIRMATION_MODEL
   (see lib/affirmation-engine.js). EFT and visualization have their own routes.

   Every call costs money, so it is for signed-in accounts only and spends from
   a daily budget (lib/affirmation-quota.js) before OpenAI is asked anything.
   A call that fails upstream gives its units back. */
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is not configured with an API key yet.' });
    return;
  }

  const user = await whoIsCalling(bearerToken(req)).catch(() => null);
  if (!user) {
    res.status(401).json({ error: 'Create a free account to write affirmations with AI.', code: 'auth' });
    return;
  }

  const { req: clean, error } = cleanRequest(req.body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const cost = UNIT_COST[clean.mode];
  let spent = false;
  try {
    const limit = dailyLimit(hasPremiumAccess(await tierForUser(user.id)));
    if ((await spendUnits(user.id, cost, limit)) < 0) {
      res.status(429).json({ error: "You've used today's AI affirmations. They refresh tomorrow, and you can still edit or add your own lines.", code: 'quota' });
      return;
    }
    spent = true;
    const data = await callOpenAI(buildResponsesRequest(clean), { apiKey });
    res.status(200).json({ affirmations: readAffirmations(data, clean) });
  } catch (err) {
    console.error('generate-affirmations error:', err.message, err.detail || '');
    if (spent) await spendUnits(user.id, -cost, 0).catch(() => {});
    res.status(spent ? 502 : 503).json({ error: 'Something went wrong generating affirmations.' });
  }
}
