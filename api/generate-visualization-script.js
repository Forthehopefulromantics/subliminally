// /api/generate-visualization-script.js
//
// Generates a draft visualization script for "Visualization Script" mode
// (Reverie & Ritual). This is meant purely as a starting point — the review step
// in the app gives the person one large, freely-editable box, so whatever comes
// back here just needs to be good raw material, not a finished product.
//
// Copy this file into your project's /api folder, alongside generate-affirmations.js
// and generate-eft-affirmations.js. It expects the same ANTHROPIC_API_KEY
// environment variable those already use.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { goal, toneLabel, freqLabel } = req.body || {};

  if (!goal || !goal.trim()) {
    return res.status(400).json({ error: 'Missing goal' });
  }

  const systemPrompt = `You write short visualization scripts for performers — athletes, artists, performers, salespeople, or anyone preparing for a specific moment (a game, an audition, a pitch, a performance) or calling in a specific outcome or situation.

Return ONLY raw JSON, no markdown code fences, no commentary, matching this exact shape:
{ "script": string }

Rules for "script":
- Second person, present tense throughout ("You walk out...", "You feel..."), like a guided visualization a coach would read aloud.
- Vivid and sensory — what they see, hear, and feel, not just what happens. Ground it in the specific details the person gave you; don't generalize it into something vague.
- 4 to 7 short paragraphs, separated by a blank line (use \\n\\n between paragraphs in the JSON string).
- Arc: settle into the moment -> move through it as it's actually unfolding -> land on the feeling of having done it, calm and certain.
- Warm, ${toneLabel || 'grounded'} tone. No hype-speech clichés, no medical or performance-outcome guarantees, no second-guessing language ("maybe", "hopefully").
- Do not reference the healing frequency directly.`;

  const userPrompt = `What they want to visualize, in their own words: ${goal}
Healing frequency context (tone only, don't name it directly): ${freqLabel || 'none'}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        // Match this to whatever model string your existing
        // /api/generate-affirmations.js already uses.
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return res.status(502).json({ error: 'Upstream generation failed' });
    }

    const data = await response.json();
    const rawText = (data.content || [])
      .map((block) => block.text || '')
      .join('')
      .trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.script || typeof parsed.script !== 'string' || !parsed.script.trim()) {
      throw new Error('Malformed visualization script response');
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('generate-visualization-script error:', err);
    return res.status(500).json({ error: 'Generation failed' });
  }
}
