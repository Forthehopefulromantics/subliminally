export const config = { api: { bodyParser: true } };

import { applyCors } from '../lib/cors.js';
import { faithFraming } from '../lib/faith-language.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Server is not configured with an API key yet.' });
    return;
  }

  const { count, freqLabel, toneLabel, goal, faith, faithWord } = req.body || {};
  // Standard subliminals contain at most ten affirmations. EFT keeps its own
  // separate 11-line structure and never calls this route.
  const safeCount = Math.min(Math.max(parseInt(count, 10) || 10, 5), 10);
  /* Their saved answer in Settings, as framing rather than a word list. Null
     when they have not answered or the answer is not one we know, and then the
     section is left out rather than filled with a guess. */
  const framing = faithFraming(faith, faithWord);

  const prompt = `Write ${safeCount} short, first-person, present-tense affirmations for a bedtime affirmation app.
Frequency association (mood only, not medical): ${freqLabel || 'none'}
Desired voice/tone: ${toneLabel || 'warm'}
What the person said they want help with: "${goal || 'not specified'}"
Rules: each line under 12 words, first person, present tense, no medical claims, no "cure"/"heal disease"/"rewire your DNA"/"guaranteed". Reflect their goal naturally without quoting it verbatim.
Return ONLY a raw JSON array of ${safeCount} strings. No markdown, no preamble, no code fences.${framing ? '\n\n' + framing : ''}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      res.status(502).json({ error: 'Affirmation generation failed upstream.' });
      return;
    }

    const data = await response.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!Array.isArray(parsed)) {
      res.status(502).json({ error: 'Unexpected response shape.' });
      return;
    }

    res.status(200).json({ affirmations: parsed.filter((x) => typeof x === 'string') });
  } catch (err) {
    console.error('generate-affirmations error:', err);
    res.status(500).json({ error: 'Something went wrong generating affirmations.' });
  }
}
