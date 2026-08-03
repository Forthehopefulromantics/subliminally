export const config = { api: { bodyParser: true } };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Server is not configured with an API key yet.' });
    return;
  }

  const { count, freqLabel, toneLabel, goal } = req.body || {};
  const safeCount = Math.min(Math.max(parseInt(count, 10) || 14, 5), 20);

  const prompt = `Write ${safeCount} short, first-person, present-tense affirmations for a bedtime affirmation app.
Frequency association (mood only, not medical): ${freqLabel || 'none'}
Desired voice/tone: ${toneLabel || 'warm'}
What the person said they want help with: "${goal || 'not specified'}"
Rules: each line under 12 words, first person, present tense, no medical claims, no "cure"/"heal disease"/"rewire your DNA"/"guaranteed". Reflect their goal naturally without quoting it verbatim.
Return ONLY a raw JSON array of ${safeCount} strings. No markdown, no preamble, no code fences.`;

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
