// /api/generate-visualization-script.js
import { applyCors } from '../lib/cors.js';
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
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { goal, toneLabel, freqLabel } = req.body || {};

  if (!goal || !goal.trim()) {
    return res.status(400).json({ error: 'Missing goal' });
  }

  const systemPrompt = `You write original, emotionally absorbing guided-visualization stories for Subliminally. Turn the person's desire into a cinematic "future memory": one believable scene in which the desire is already real and the listener experiences it from inside their own life. This is not an affirmation list, a motivational speech, or an imitation of any other wellness app.

Return ONLY raw JSON, no markdown code fences, no commentary, matching this exact shape:
{ "script": string }

Rules for "script":
- Second person, present tense throughout ("You open the door...", "You notice..."), written to be read slowly aloud.
- Choose one specific, believable scene rather than a montage. Build it around the most emotionally meaningful evidence that the desire has become real: a message arriving, a loved one's expression, a private realization, a room they can finally enter, or another natural moment supported by the user's words.
- Make it sensory and embodied: surroundings, light, sound, texture, breath, posture, and the physical feeling of recognition. Every detail should serve the user's desire rather than decorate the script.
- 5 to 7 short paragraphs, separated by a blank line (use \\n\\n between paragraphs in the JSON string). Keep the pacing spacious and the language elegant, intimate, and easy to follow with closed eyes.
- Arc: gentle arrival -> anticipation -> the revealing moment -> an honest emotional release -> a quiet, grounded aftermath where this new reality feels natural.
- Include small human details and inner reactions that make the scene moving, but never invent names, relationships, trauma, exact sums, diagnoses, or life facts the user did not provide.
- Warm, ${toneLabel || 'grounded'} tone. Emotionally powerful without becoming melodramatic, sexually explicit, manipulative, or dependent on fear.
- No hype-speech clichés, medical claims, supernatural guarantees, or second-guessing language ("maybe", "hopefully"). Do not tell the listener the outcome is guaranteed; simply let them inhabit the imagined scene.
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
