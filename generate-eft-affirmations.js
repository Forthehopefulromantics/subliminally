// /api/generate-eft-affirmations.js
//
// Generates the content for "Subliminal + EFT Tapping" mode (Ritual only).
// Produces the pieces needed for an 11-line session:
//   1. Setup Statement — built client-side from `setupFeeling`:
//      "Even though I have {setupFeeling}, I deeply and completely love and accept myself."
//      (repeated 3x during playback)
//   2-11. The 10-tap round: Karate Chop -> Eyebrow -> Side of the Eye -> Under the Eye ->
//      Under the Nose -> Chin -> Collarbone -> Under the Arm -> Top of the Head ->
//      Karate Chop again. `kcReminder` is used for both Karate Chop taps (open + close);
//      `pointReminders` covers the 8 points in between, in order. Each repeats 5-7x
//      (the user's pick) during playback.
//
// This is a separate endpoint from /api/generate-affirmations.js on purpose — the
// regular subliminal flow keeps using that one, untouched.
//
// Copy this file into your project's /api folder. It expects the same
// ANTHROPIC_API_KEY environment variable your existing generate-affirmations.js
// function already uses. If that function uses a different env var name or a
// different Claude model string, match those here instead of what's below.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { goal, toneLabel, freqLabel } = req.body || {};

  const pointLabels = [
    'Eyebrow',
    'Side of the Eye',
    'Under the Eye',
    'Under the Nose',
    'Chin',
    'Collarbone',
    'Under the Arm',
    'Top of the Head'
  ];

  const systemPrompt = `You write short EFT (Emotional Freedom Technique / "tapping") scripts.
Return ONLY raw JSON, no markdown code fences, no commentary, matching this exact shape:
{
  "setupFeeling": string,
  "kcReminder": string,
  "pointReminders": [string, string, string, string, string, string, string, string]
}

Rules:
- "setupFeeling" completes the sentence "Even though I have ___, I deeply and completely love and accept myself." Name the specific feeling or issue in a few words (e.g. "this anxiety about money", "this fear of not being enough"), based on what the person described. Return only that feeling clause — not the rest of the sentence.
- "kcReminder" is a short (3-6 word) reminder phrase used at the Karate Chop point, naming the feeling briefly (e.g. "this money anxiety"). It gets reused for both the opening and closing tap of the round, so keep it general enough to work as a bookend.
- "pointReminders" is an array of exactly 8 short (3-8 word) reminder phrases, one for each of these points in this exact order: ${pointLabels.join(', ')}. Each should feel like a natural step in releasing/processing the named feeling, gently varied line to line (not repeats of each other), grounded in what the person described, in a ${toneLabel || 'warm'} tone. Move loosely from naming the feeling toward relief/acceptance by the last point.
- Every phrase should be short enough to say out loud in 2-3 seconds.
- Do not diagnose, give medical advice, or reference the healing frequency directly.`;

  const userPrompt = `What they're working through tonight: ${goal || 'general stress and tension'}
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
        max_tokens: 500,
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

    if (
      !parsed.setupFeeling ||
      !parsed.kcReminder ||
      !Array.isArray(parsed.pointReminders) ||
      parsed.pointReminders.length !== 8
    ) {
      throw new Error('Malformed EFT generation response');
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('generate-eft-affirmations error:', err);
    return res.status(500).json({ error: 'Generation failed' });
  }
}

