// /api/generate-eft-affirmations.js
import { applyCors } from '../lib/cors.js';
import { faithFraming } from '../lib/faith-language.js';
//
// Generates the content for "Subliminal + EFT Tapping" mode (Ritual only).
// Produces the pieces needed for an 11-line session:
//   1. "Take responsibility for your own well-being." — fixed, said before any
//      tapping starts, so it isn't generated here.
//   2-3. Two setup statements on the Karate Chop, built client-side from
//      `feelingA` and `feelingB`: "Even though I feel {A}, I still completely
//      love and accept myself." then "...{B}, I still completely love and honor
//      myself." Two different feelings, not one repeated.
//   4-12. The cycle, Forehead -> Eyebrow -> Side of the Eye -> Under the Eye ->
//      Under the Nose -> Chin -> Collarbone -> Under the Arm -> Top of the Head.
//      `pointReminders` covers those nine, in order.
//   13. "In body, mind and spirit." — fixed, closes every round.
//   Nothing repeats a set number of times: the line is said once and you tap it
//   for as long as it takes.
//
// This is a separate endpoint from /api/generate-affirmations.js on purpose — the
// regular subliminal flow keeps using that one, untouched.
//
// Copy this file into your project's /api folder. It expects the same
// ANTHROPIC_API_KEY environment variable your existing generate-affirmations.js
// function already uses. If that function uses a different env var name or a
// different Claude model string, match those here instead of what's below.

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { goal, toneLabel, freqLabel, faith, faithWord } = req.body || {};
  // Their saved answer in Settings, as framing rather than a word list. Null
  // when unanswered or unrecognised, and then nothing is said about it at all.
  const framing = faithFraming(faith, faithWord);

  // Forehead first, crown last. The closing Karate Chop is gone: the round now
  // ends on a fixed line ("In body, mind and spirit.") written by the app.
  const pointLabels = [
    'Forehead',
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
  "feelingA": string,
  "feelingB": string,
  "pointReminders": [string, string, string, string, string, string, string, string, string]
}

Rules:
- "feelingA" completes "Even though I feel ___, I still completely love and accept myself." Name the specific feeling in a few words (e.g. "anxious about money", "like I'm not enough"), based on what the person described. Return only that feeling clause — not the rest of the sentence. It must read naturally straight after the word "feel", so no leading "this" or "that".
- "feelingB" completes the second setup statement, "Even though I feel ___, I still completely love and honor myself." This must name a DIFFERENT feeling from feelingA — the one sitting underneath it. If feelingA is the surface worry, feelingB is the fear or the tiredness beneath it (e.g. feelingA "anxious about money", feelingB "ashamed that I'm still here after all this time"). Same grammar rule: it follows the word "feel".
- "pointReminders" is an array of exactly 9 full, natural first-person sentences (roughly 6-14 words each, ending in a period), one for each of these points in this exact order: ${pointLabels.join(', ')}. Write these the way real EFT scripts read — complete, flowing sentences like "It's okay to feel uncertain sometimes." or "I am safe to receive more than I've ever allowed." — never short clipped phrases or word fragments. Each should feel like a natural step in releasing/processing the named feeling, gently varied line to line (not repeats of each other), grounded in what the person described, in a ${toneLabel || 'warm'} tone. Move loosely from naming the feeling toward relief/acceptance by the last point.
- Every sentence should be short enough to say out loud comfortably in one breath, roughly 3-5 seconds.
- Do not diagnose, give medical advice, or reference the healing frequency directly.${framing ? '\n\n' + framing : ''}`;

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

