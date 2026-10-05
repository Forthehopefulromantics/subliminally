// /api/visualization.js
// Vercel serverless function — every server-side step of the Visualization
// feature, behind one route.
//
// One route rather than six because a Vercel project has a ceiling on how many
// functions it may deploy, and this app is already close to it. The actions are
// separate on the inside (lib/visualization/*) and share nothing but the
// sign-in check:
//
//   question   the next dynamic question, or "enough"
//   write      the first draft of the scene, and its title
//   revise     the scene again, with one change
//   narrate    Serenity reads it (the only action that spends voice credits)
//   usage      today's narration allowance, and any narration still in flight
//   delete     remove a visualization and its audio
//
// Required environment variables:
//   ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:
//   VISUALIZATION_DAILY_NARRATION_LIMIT   used only if the visualization_settings row is absent
//   VISUALIZATION_MODEL, VISUALIZATION_TTS_MODEL

import { applyCors } from '../lib/cors.js';
import { bearerToken, whoIsCalling } from '../lib/supabase-auth.js';
import {
  MAX_ANSWER_CHARS, MAX_DESIRE_CHARS, MAX_INSTRUCTION_CHARS, MAX_SCRIPT_WORDS, MAX_TOTAL_QUESTIONS,
  MIN_FOLLOW_UPS, MAX_SCRIPT_CHARS, TARGET_WORDS_MAX, countWords, normalizeScript,
} from '../lib/visualization/config.js';
import {
  QUESTION_SYSTEM, REVISION_PRESETS, cleanQA, cleanText, questionUserPrompt, reviseSystem,
  reviseUserPrompt, storySystem, storyUserPrompt,
} from '../lib/visualization/prompts.js';
import { WriterError, askWriter, writerConfigured } from '../lib/visualization/anthropic.js';
import {
  deleteVisualizationRow, getVisualization, isUuid, pendingFor, removeNarrationFiles, savedFaith, saveNarration,
} from '../lib/visualization/store.js';
import { narrateVisualization, narrationUsage } from '../lib/visualization/narrate.js';

/* Narration waits on the voice provider for up to ~100 seconds. */
export const config = { maxDuration: 120 };

const reply = (res, { status, json }) => res.status(status).json(json);

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function writerFailure(err) {
  console.error('visualization writer failed:', (err && err.code) || err, (err && err.detail) || '');
  const code = (err instanceof WriterError && err.code) || 'writer_failed';
  return { status: code === 'not_configured' ? 503 : 502, json: { error: 'writer_failed', code } };
}

/* What the model sent, as a script the app can keep: a string, paragraphs
   separated by one blank line, and none of the formatting a narrator would
   read out. */
function tidyScript(raw) {
  if (typeof raw !== 'string') return '';
  return normalizeScript(raw.replace(/\\n/g, '\n').replace(/[*#`]+/g, ''));
}
function tidyTitle(raw) {
  const t = cleanText(raw, 80).replace(/^["'“”]+|["'“”]+$/g, '').replace(/[:.]+$/, '');
  return t || 'Untitled visualization';
}

/* ---------------- question ---------------- */
const FIRST_FOLLOW_UP = 'How do you want to feel in this moment?';
async function nextQuestion(body) {
  const desire = cleanText(body.desire, MAX_DESIRE_CHARS);
  if (!desire) return { status: 400, json: { error: 'missing_desire' } };
  const qa = cleanQA(body.qa, MAX_ANSWER_CHARS);

  /* The ceiling is ours, not the model's: five in all, counting the first. */
  if (qa.length + 1 >= MAX_TOTAL_QUESTIONS) return { status: 200, json: { done: true, reason: 'enough' } };
  if (!writerConfigured()) return { status: 503, json: { error: 'writer_failed', code: 'not_configured' } };

  try {
    const out = await askWriter({
      system: QUESTION_SYSTEM,
      user: questionUserPrompt(desire, qa),
      maxTokens: 120,
      temperature: 0.8,
    });
    const question = cleanText(out.question, 200);
    if (out.done === true && qa.length >= MIN_FOLLOW_UPS) return { status: 200, json: { done: true } };
    /* Always at least one follow-up. A model that says "enough" straight away is
       asked for nothing more than the one question every scene needs. */
    const next = question && out.done !== true ? question : (out.done === true ? FIRST_FOLLOW_UP : '');
    if (!next) return { status: 502, json: { error: 'writer_failed', code: 'malformed' } };
    return { status: 200, json: { done: false, question: next, asked: qa.length + 2, max: MAX_TOTAL_QUESTIONS } };
  } catch (err) {
    return writerFailure(err);
  }
}

/* One more pass when the draft came back too long to narrate in five minutes. */
async function condense(script, faith, faithWord) {
  const out = await askWriter({
    system: reviseSystem(faith, faithWord),
    user: reviseUserPrompt({ script, instruction: `Condense this to about ${TARGET_WORDS_MAX - 60} words. Keep the same scene, voice, the best details, the small imperfection and the ending.` }),
    maxTokens: 1400,
    temperature: 0.6,
  });
  return tidyScript(out.script);
}

/* ---------------- write ---------------- */
async function writeScene(user, body) {
  const desire = cleanText(body.desire, MAX_DESIRE_CHARS);
  if (!desire) return { status: 400, json: { error: 'missing_desire' } };
  const qa = cleanQA(body.qa, MAX_ANSWER_CHARS);
  if (!writerConfigured()) return { status: 503, json: { error: 'writer_failed', code: 'not_configured' } };

  const { faith, faithWord } = await savedFaith(user.id);
  try {
    const out = await askWriter({
      system: storySystem(faith, faithWord),
      user: storyUserPrompt(desire, qa),
      maxTokens: 1700,
      temperature: 0.9,
    });
    let script = tidyScript(out.script);
    if (!script) return { status: 502, json: { error: 'writer_failed', code: 'malformed' } };
    if (countWords(script) > MAX_SCRIPT_WORDS) {
      try { script = (await condense(script, faith, faithWord)) || script; } catch (e) { /* keep the long one; the editor shows the count */ }
    }
    /* Which saved answer this story was written in the language of is recorded on
       the row, by the server (the column is not the browser's to write). */
    if (isUuid(body.id)) await saveNarration(user.id, body.id, { faith_used: faith || null }).catch(() => null);
    return { status: 200, json: { title: tidyTitle(out.title), script, faith: faith || null } };
  } catch (err) {
    return writerFailure(err);
  }
}

/* ---------------- revise ---------------- */
async function reviseScene(user, body) {
  const script = normalizeScript(body.script);
  if (!script) return { status: 400, json: { error: 'missing_script' } };
  if (script.length > MAX_SCRIPT_CHARS * 2) return { status: 400, json: { error: 'too_long' } };

  const preset = typeof body.preset === 'string' ? REVISION_PRESETS[body.preset] : null;
  const typed = cleanText(body.instruction, MAX_INSTRUCTION_CHARS);
  const instruction = preset || typed;
  if (!instruction) return { status: 400, json: { error: 'missing_instruction' } };
  if (!writerConfigured()) return { status: 503, json: { error: 'writer_failed', code: 'not_configured' } };

  const { faith, faithWord } = await savedFaith(user.id);
  try {
    const out = await askWriter({
      system: reviseSystem(faith, faithWord),
      user: reviseUserPrompt({
        script,
        instruction,
        desire: cleanText(body.desire, MAX_DESIRE_CHARS),
        qa: cleanQA(body.qa, MAX_ANSWER_CHARS),
      }),
      maxTokens: 1700,
      temperature: 0.8,
    });
    let revised = tidyScript(out.script);
    if (!revised) return { status: 502, json: { error: 'writer_failed', code: 'malformed' } };
    if (countWords(revised) > MAX_SCRIPT_WORDS) {
      try { revised = (await condense(revised, faith, faithWord)) || revised; } catch (e) { /* as above */ }
    }
    return { status: 200, json: { script: revised } };
  } catch (err) {
    return writerFailure(err);
  }
}

/* ---------------- delete ---------------- */
async function deleteViz(user, body) {
  if (!isUuid(body.id)) return { status: 400, json: { error: 'bad_id' } };
  const row = await getVisualization(user.id, body.id);
  if (!row) return { status: 200, json: { deleted: true } };
  const ok = await deleteVisualizationRow(user.id, row.id);
  if (!ok) return { status: 502, json: { error: 'delete_failed' } };
  await removeNarrationFiles([row.narration_path]);
  return { status: 200, json: { deleted: true } };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!process.env.SUPABASE_URL) { res.status(500).json({ error: 'server_misconfigured' }); return; }

  const user = await whoIsCalling(bearerToken(req));
  if (!user) { res.status(401).json({ error: 'not_signed_in' }); return; }

  const body = await readJsonBody(req);
  try {
    switch (body.action) {
      case 'question': return reply(res, await nextQuestion(body));
      case 'write':    return reply(res, await writeScene(user, body));
      case 'revise':   return reply(res, await reviseScene(user, body));
      case 'narrate':  return reply(res, await narrateVisualization(user, body));
      case 'delete':   return reply(res, await deleteViz(user, body));
      case 'usage': {
        const [usage, pending] = await Promise.all([narrationUsage(user.id, body.tz), pendingFor(user.id)]);
        return reply(res, { status: 200, json: { usage, pending, maxWords: MAX_SCRIPT_WORDS, maxQuestions: MAX_TOTAL_QUESTIONS } });
      }
      default: return reply(res, { status: 400, json: { error: 'unknown_action' } });
    }
  } catch (err) {
    console.error('visualization route error:', body.action, err);
    res.status(500).json({ error: 'server_error' });
  }
}
