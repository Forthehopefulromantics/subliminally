export const config = { api: { bodyParser: true } };

import { applyCors } from '../lib/cors.js';
import { cleanRequest, buildResponsesRequest, readAffirmations, callOpenAI } from '../lib/affirmation-engine.js';

/* The one route behind every affirmation action in the builder: generate,
   regenerate all, regenerate one, make these better (body.mode). The key is
   read here, on the server, and never leaves it. The model is AFFIRMATION_MODEL
   (see lib/affirmation-engine.js). EFT and visualization have their own routes. */
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

  const { req: clean, error } = cleanRequest(req.body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  try {
    const data = await callOpenAI(buildResponsesRequest(clean), { apiKey });
    res.status(200).json({ affirmations: readAffirmations(data, clean) });
  } catch (err) {
    console.error('generate-affirmations error:', err.message, err.detail || '');
    res.status(502).json({ error: 'Something went wrong generating affirmations.' });
  }
}
