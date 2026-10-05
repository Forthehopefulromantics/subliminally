#!/usr/bin/env node
/* visualization-test.mjs — the server half of Visualization

   Runs the real /api/visualization route against an in-memory Supabase, a fake
   Anthropic and a fake ElevenLabs (global fetch is replaced), and checks the
   promises that protect credits:

     * narration is generated once, and replaying / asking again never regenerates
     * a changed script is not re-narrated until the caller says replace:true
     * the daily limit is configuration, not code, and only finished narrations count
     * a failed generation costs nothing and keeps the story
     * two taps / two tabs / two stories at once make one paid generation
     * Serenity is a paid feature, and the check happens before any spend
     * the question writer never goes past five questions in total
     * the story is written in the language of the saved faith, read server-side

     node scripts/visualization-test.mjs        (npm run test:visualization)
*/
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.ANTHROPIC_API_KEY = 'anthropic-test';
process.env.ELEVENLABS_API_KEY = 'eleven-test';

const config = await import('../lib/visualization/config.js');
const prompts = await import('../lib/visualization/prompts.js');

let fails = 0;
const section = (t) => console.log(`\n--- ${t} ---`);
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); }
  catch (e) { fails++; console.log(`FAIL  ${label}\n      ${(e && e.message || e).toString().split('\n').join('\n      ')}`); }
}

/* ---------------- an in-memory world ---------------- */
const world = {
  users: { 'tok-ritual': 'u-ritual', 'tok-free': 'u-free', 'tok-b': 'u-b' },
  subscribers: { 'u-ritual': 'ritual', 'u-b': 'ritual' },
  profiles: { 'u-ritual': { faith: 'christianity' }, 'u-b': { faith: 'psychology' }, 'u-free': {} },
  settings: { daily_visualization_narration_limit: 1 },
  visualizations: [],
  ledger: [],
  storage: new Map(),
  calls: { eleven: 0, anthropic: [], upload: 0 },
  elevenFails: false,
  elevenDelayMs: 0,
  seq: 0,
};
const uuid = () => `00000000-0000-4000-8000-${String(++world.seq).padStart(12, '0')}`;
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function filterRows(rows, params) {
  return rows.filter((r) => [...params.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit'].includes(k)) return true;
    const m = /^(eq|gte|lt)\.(.*)$/.exec(v);
    if (!m) return true;
    const [, op, val] = m;
    const cell = r[k];
    if (op === 'eq') return String(cell) === val;
    if (op === 'gte') return cell != null && cell >= val;
    if (op === 'lt') return cell != null && cell < val;
    return true;
  }));
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body;

  if (url.host === 'db.test') {
    if (url.pathname === '/auth/v1/user') {
      const token = (init.headers.Authorization || '').replace('Bearer ', '');
      return world.users[token] ? json({ id: world.users[token] }) : json({}, 401);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (url.pathname.startsWith('/rest/v1/')) {
      if (table === 'subscribers') {
        const uid = url.searchParams.get('user_id').replace('eq.', '');
        return json(world.subscribers[uid] ? [{ tier: world.subscribers[uid], status: 'active' }] : []);
      }
      if (table === 'profiles') {
        const uid = url.searchParams.get('id').replace('eq.', '');
        return json(world.profiles[uid] ? [world.profiles[uid]] : []);
      }
      if (table === 'visualization_settings') {
        return json(Object.entries(world.settings).map(([key, value]) => ({ key, value })).filter((r) => `eq.${r.key}` === url.searchParams.get('key')));
      }
      if (table === 'visualizations') {
        if (method === 'GET') return json(filterRows(world.visualizations, url.searchParams).map((r) => ({ ...r })));
        const rows = filterRows(world.visualizations, url.searchParams);
        if (method === 'PATCH') { rows.forEach((r) => Object.assign(r, body)); return json(rows.map((r) => ({ ...r }))); }
        if (method === 'DELETE') { world.visualizations = world.visualizations.filter((r) => !rows.includes(r)); return new Response(null, { status: 204 }); }
      }
      if (table === 'visualization_narrations') {
        if (method === 'GET') return json(filterRows(world.ledger, url.searchParams).map((r) => ({ ...r })));
        if (method === 'PATCH') { filterRows(world.ledger, url.searchParams).forEach((r) => Object.assign(r, body)); return new Response(null, { status: 204 }); }
        if (method === 'POST') {
          // the two partial unique indexes: one pending per person, one per story
          const clash = world.ledger.some((r) => r.status === 'pending' && (r.user_id === body.user_id || r.visualization_id === body.visualization_id));
          if (clash) return json({ code: '23505' }, 409);
          const row = { id: uuid(), created_at: new Date().toISOString(), completed_at: null, error_code: null, ...body };
          world.ledger.push(row);
          return json([row], 201);
        }
      }
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      return json({ signedURL: `/object/sign/${url.pathname.split('/sign/')[1]}?token=t` });
    }
    if (url.pathname.startsWith('/storage/v1/object/visualization-audio')) {
      if (method === 'POST') { world.calls.upload++; world.storage.set(url.pathname.split('visualization-audio/')[1], init.body); return json({}); }
      if (method === 'DELETE') { body.prefixes.forEach((p) => world.storage.delete(p)); return json([]); }
    }
    throw new Error(`unhandled db call ${method} ${url}`);
  }

  if (url.host === 'api.elevenlabs.io') {
    world.calls.eleven++;
    world.lastEleven = body;
    if (world.elevenDelayMs) await new Promise((r) => setTimeout(r, world.elevenDelayMs));
    if (world.elevenFails) return new Response('boom', { status: 500 });
    return new Response(Buffer.alloc(16000 * 200), { status: 200 }); // 200 s of 128 kbps mp3
  }

  if (url.host === 'api.anthropic.com') {
    world.calls.anthropic.push(body);
    const out = world.anthropicReply ? world.anthropicReply(body) : { done: true };
    return json({ content: [{ type: 'text', text: JSON.stringify(out) }] });
  }
  return realFetch(input, init);
};

const { default: handler } = await import('../api/visualization.js');

async function call(token, payload) {
  let status = 0, out = null;
  const res = {
    status(s) { status = s; return this; },
    json(b) { out = b; return this; },
    setHeader() {}, end() { return this; },
  };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: payload }, res);
  return { status, body: out };
}

const SCRIPT = 'I push open the door and hear music in the kitchen.\n\nI look for my keys for five minutes before I find them in yesterday\'s purse. I almost laugh.\n\nThen I breathe, and it all feels like mine.';
function newViz(userId, extra = {}) {
  const row = {
    id: uuid(), user_id: userId, title: 'Test', script: SCRIPT,
    script_hash: config.hashScript(SCRIPT),
    narration_path: null, narration_script_hash: null, narration_generated_at: null,
    narration_duration_seconds: null, narration_status: 'none', faith_used: null, ...extra,
  };
  world.visualizations.push(row);
  return row;
}
const setScript = (row, script) => { row.script = script; row.script_hash = config.hashScript(script); };

/* ================================================================ */
section('the script, as it will be read');
await check('normalizing ignores invisible edits but keeps paragraphs', () => {
  assert.equal(config.normalizeScript('  Hello   world \r\n\r\n\r\n\r\nSecond\tpara  '), 'Hello world\n\nSecond para');
  assert.equal(config.hashScript('Hello world.'), config.hashScript('Hello   world.  '));
  assert.notEqual(config.hashScript('Hello world.'), config.hashScript('Hello world!'));
  assert.notEqual(config.hashScript('One.\n\nTwo.'), config.hashScript('One. Two.'));
});
await check('700 words is the five-minute ceiling', () => {
  assert.equal(config.MAX_SCRIPT_WORDS, 700);
  assert.equal(config.countWords('one two  three\nfour'), 4);
});
await check('speech text pauses between paragraphs only, and strips formatting', () => {
  const t = config.speechTextFor('First **bold** line.\nStill first.\n\nSecond.');
  assert.equal(t, 'First bold line. Still first.\n<break time="0.8s" />\nSecond.');
});
await check('"today" is the person\'s own day', () => {
  const now = new Date('2026-10-05T03:30:00Z'); // 8:30pm Oct 4 in Los Angeles
  const la = config.localDayWindow('America/Los_Angeles', now);
  assert.equal(la.start.toISOString(), '2026-10-04T07:00:00.000Z');
  assert.equal(config.localDayWindow('Not/AZone', now).start.toISOString(), '2026-10-05T00:00:00.000Z');
});

section('questions: never more than five in all');
await check('stops at five without asking the model', async () => {
  const before = world.calls.anthropic.length;
  const qa = [1, 2, 3, 4].map((i) => ({ question: `q${i}`, answer: 'a' }));
  const r = await call('tok-ritual', { action: 'question', desire: 'a promotion', qa });
  assert.deepEqual(r.body.done, true);
  assert.equal(world.calls.anthropic.length, before, 'no model call past the ceiling');
});
await check('ignores a client that sends more than four follow-ups', async () => {
  const qa = Array.from({ length: 12 }, (_, i) => ({ question: `q${i}`, answer: 'a' }));
  const r = await call('tok-ritual', { action: 'question', desire: 'x', qa });
  assert.equal(r.body.done, true);
});
await check('always asks at least one follow-up, even if the model says done straight away', async () => {
  world.anthropicReply = () => ({ done: true });
  const r = await call('tok-ritual', { action: 'question', desire: 'getting the promotion', qa: [] });
  assert.equal(r.status, 200);
  assert.equal(r.body.done, false);
  assert.equal(r.body.question, 'How do you want to feel in this moment?');
});
await check('can stop early once it has enough', async () => {
  world.anthropicReply = () => ({ done: true });
  const r = await call('tok-ritual', { action: 'question', desire: 'x', qa: [{ question: 'How do you want to feel?', answer: 'Calm' }] });
  assert.equal(r.body.done, true);
});
await check('returns the next question, and how far along', async () => {
  world.anthropicReply = () => ({ done: false, question: 'How do you want to feel in this moment?' });
  const r = await call('tok-ritual', { action: 'question', desire: 'x', qa: [] });
  assert.equal(r.body.question, 'How do you want to feel in this moment?');
  assert.equal(r.body.asked, 2);
  assert.equal(r.body.max, 5);
});
await check('skipped answers are passed on as skipped', async () => {
  world.anthropicReply = () => ({ done: false, question: 'Where are you?' });
  await call('tok-ritual', { action: 'question', desire: 'x', qa: [{ question: 'Who is there?', answer: '' }] });
  assert.match(world.calls.anthropic.at(-1).messages[0].content, /\(skipped\)/);
});

section('the story: one scene, in their own words about belief');
await check('writes a title and a script, and reads the faith from the profile, not the request', async () => {
  world.anthropicReply = () => ({ title: 'The Morning Everything Changed', script: 'I wake up.\\n\\nI smile.' });
  const r = await call('tok-ritual', { action: 'write', desire: 'my dream apartment', qa: [], faith: 'islam' });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, 'The Morning Everything Changed');
  assert.equal(r.body.script, 'I wake up.\n\nI smile.');
  assert.equal(r.body.faith, 'christianity', 'saved faith wins over anything the request claims');
  const sys = world.calls.anthropic.at(-1).system;
  assert.match(sys, /Christian/);
  assert.match(sys, /God has blessed me/);
  assert.match(sys, /first-person present tense/i);
  assert.match(sys, /minor, ordinary and recoverable/);
  assert.match(sys, /abuse, sexual violence, death/);
});
await check('the saved faith the story was written in is recorded on the row, by the server', async () => {
  const row = newViz('u-ritual');
  world.anthropicReply = () => ({ title: 'T', script: 'One.' });
  await call('tok-ritual', { action: 'write', id: row.id, desire: 'x', qa: [] });
  assert.equal(row.faith_used, 'christianity');
});
await check('a secular answer gets a grounded, secular story', async () => {
  await call('tok-b', { action: 'write', desire: 'x', qa: [] });
  const sys = world.calls.anthropic.at(-1).system;
  assert.match(sys, /secular/);
  assert.doesNotMatch(sys, /God has blessed me/);
});
await check('no saved answer means nothing is said about belief — never Christianity by default', async () => {
  await call('tok-free', { action: 'write', desire: 'x', qa: [] });
  const sys = world.calls.anthropic.at(-1).system;
  assert.doesNotMatch(sys, /Christian|God has blessed|Allah/);
});
await check('an over-long draft is condensed once', async () => {
  const long = Array.from({ length: 760 }, () => 'word').join(' ');
  let n = 0;
  world.anthropicReply = () => (n++ === 0 ? { title: 'T', script: long } : { script: 'Short now.' });
  const r = await call('tok-ritual', { action: 'write', desire: 'x', qa: [] });
  assert.equal(r.body.script, 'Short now.');
});
await check('a revision keeps one change and carries the preset instruction', async () => {
  world.anthropicReply = () => ({ script: 'Revised.' });
  const r = await call('tok-ritual', { action: 'revise', script: SCRIPT, preset: 'realistic' });
  assert.equal(r.body.script, 'Revised.');
  assert.match(world.calls.anthropic.at(-1).messages[0].content, /more realistic/);
  const free = await call('tok-ritual', { action: 'revise', script: SCRIPT, instruction: 'Change the car to a Porsche 911.' });
  assert.match(world.calls.anthropic.at(-1).messages[0].content, /Porsche 911/);
  assert.equal(free.status, 200);
  const none = await call('tok-ritual', { action: 'revise', script: SCRIPT });
  assert.equal(none.status, 400);
});
await check('the writer failing keeps the door open to try again', async () => {
  world.anthropicReply = () => { throw new Error('x'); };
  const saved = globalThis.fetch;
  world.anthropicReply = null;
  globalThis.fetch = async (i, init) => (new URL(typeof i === 'string' ? i : i.url).host === 'api.anthropic.com' ? new Response('no', { status: 500 }) : saved(i, init));
  const r = await call('tok-ritual', { action: 'write', desire: 'x', qa: [] });
  globalThis.fetch = saved;
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'writer_failed');
});

section('narration: once, and only on purpose');
await check('a free account cannot spend voice credits — and the check comes first', async () => {
  const row = newViz('u-free');
  const before = world.calls.eleven;
  const r = await call('tok-free', { action: 'narrate', id: row.id });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'upgrade_required');
  assert.equal(world.calls.eleven, before);
});
await check('signed-out callers are refused', async () => {
  assert.equal((await call('nope', { action: 'narrate', id: 'x' })).status, 401);
});
await check("one person cannot narrate another's story", async () => {
  const row = newViz('u-b');
  const r = await call('tok-ritual', { action: 'narrate', id: row.id });
  assert.equal(r.status, 404);
});

const viz = newViz('u-ritual');
await check('the first narration is generated once, with Serenity, and saved', async () => {
  const r = await call('tok-ritual', { action: 'narrate', id: viz.id, tz: 'UTC' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.generated, true);
  assert.equal(world.calls.eleven, 1);
  assert.match(world.lastEleven.text, /<break time="0.8s" \/>/);
  assert.equal(world.lastEleven.model_id, 'eleven_multilingual_v2');
  assert.equal(world.lastEleven.voice_settings.speed, 0.95);
  assert.equal(viz.narration_status, 'ready');
  assert.equal(viz.narration_script_hash, viz.script_hash);
  assert.ok(viz.narration_path.startsWith('u-ritual/'));
  assert.equal(viz.narration_duration_seconds, 200);
  assert.ok(world.storage.has(viz.narration_path.replace('u-ritual/', 'u-ritual/')));
  assert.deepEqual([r.body.usage.limit, r.body.usage.used, r.body.usage.remaining], [1, 1, 0]);
  assert.ok(r.body.narration.url.startsWith('https://db.test/storage/v1/'));
});
await check('asking again for the same words returns the saved audio and generates nothing', async () => {
  const r = await call('tok-ritual', { action: 'narrate', id: viz.id, tz: 'UTC' });
  assert.equal(r.status, 200);
  assert.equal(r.body.alreadyCurrent, true);
  assert.equal(world.calls.eleven, 1);
  assert.equal(world.ledger.filter((l) => l.status === 'succeeded').length, 1);
});
await check('an invisible edit (extra spaces) is not a change', async () => {
  setScript(viz, SCRIPT.replace(/ /g, '  ') + '   ');
  const r = await call('tok-ritual', { action: 'narrate', id: viz.id, tz: 'UTC' });
  assert.equal(r.body.alreadyCurrent, true);
  assert.equal(world.calls.eleven, 1);
});
await check('a changed script is not narrated again unless the person says so', async () => {
  setScript(viz, SCRIPT + '\n\nThe dinner is a little overcooked and I love it.');
  const r = await call('tok-ritual', { action: 'narrate', id: viz.id, tz: 'UTC' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'confirm_replace');
  assert.equal(world.calls.eleven, 1);
  assert.ok(viz.narration_path, 'old narration still in place');
});
await check('...and when they do, today\'s allowance is already used, so it waits for tomorrow', async () => {
  const r = await call('tok-ritual', { action: 'narrate', id: viz.id, replace: true, tz: 'UTC' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'daily_limit');
  assert.equal(r.body.usage.remaining, 0);
  assert.equal(world.calls.eleven, 1);
  assert.ok(viz.narration_path && viz.narration_status === 'ready', 'old narration untouched');
});
await check('the limit is data: raising it in visualization_settings allows the update', async () => {
  world.settings.daily_visualization_narration_limit = 2;
  const oldPath = viz.narration_path;
  const r = await call('tok-ritual', { action: 'narrate', id: viz.id, replace: true, tz: 'UTC' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(world.calls.eleven, 2);
  assert.equal(viz.narration_script_hash, viz.script_hash);
  assert.notEqual(viz.narration_path, oldPath);
  assert.ok(!world.storage.has(oldPath), 'the replaced audio is removed only after the new one is saved');
  assert.ok(world.storage.has(viz.narration_path));
  world.settings.daily_visualization_narration_limit = 1;
});
await check('yesterday\'s narration does not count against today', async () => {
  const other = newViz('u-ritual');
  world.ledger.forEach((l) => { l.completed_at = new Date(Date.now() - 36 * 3600 * 1000).toISOString(); });
  const r = await call('tok-ritual', { action: 'narrate', id: other.id, tz: 'UTC' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

section('failures cost nothing');
await check('a provider failure keeps the story, leaves no pending attempt, and does not count', async () => {
  world.ledger.length = 0;
  const row = newViz('u-b', { });
  world.elevenFails = true;
  const before = world.calls.upload;
  const r = await call('tok-b', { action: 'narrate', id: row.id, tz: 'UTC' });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'narration_failed');
  assert.equal(row.script, SCRIPT, 'story intact');
  assert.equal(row.narration_status, 'none');
  assert.equal(world.ledger.filter((l) => l.status === 'succeeded').length, 0);
  assert.equal(world.ledger.filter((l) => l.status === 'pending').length, 0);
  assert.equal(world.calls.upload, before);
  world.elevenFails = false;
  const again = await call('tok-b', { action: 'narrate', id: row.id, tz: 'UTC' });
  assert.equal(again.status, 200, 'the allowance is still there to try again');
});

section('two taps, one generation');
await check('simultaneous requests for one story make one paid call', async () => {
  world.ledger.length = 0; world.settings.daily_visualization_narration_limit = 5;
  const row = newViz('u-ritual');
  world.elevenDelayMs = 60;
  const before = world.calls.eleven;
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => call('tok-ritual', { action: 'narrate', id: row.id, tz: 'UTC' })));
  world.elevenDelayMs = 0;
  const statuses = [a, b, c].map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409]);
  assert.equal(world.calls.eleven - before, 1);
});
await check('simultaneous requests for two stories cannot both slip under a limit of one', async () => {
  world.ledger.length = 0; world.settings.daily_visualization_narration_limit = 1;
  const x = newViz('u-ritual'), y = newViz('u-ritual');
  world.elevenDelayMs = 40;
  const before = world.calls.eleven;
  const rs = await Promise.all([x, y].map((r) => call('tok-ritual', { action: 'narrate', id: r.id, tz: 'UTC' })));
  world.elevenDelayMs = 0;
  assert.equal(world.calls.eleven - before, 1);
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
});

section('limits on what can be narrated');
await check('a story over five minutes is refused before any spend', async () => {
  world.ledger.length = 0; world.settings.daily_visualization_narration_limit = 5;
  const row = newViz('u-ritual');
  setScript(row, Array.from({ length: 720 }, () => 'word').join(' '));
  const before = world.calls.eleven;
  const r = await call('tok-ritual', { action: 'narrate', id: row.id });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'too_long');
  assert.equal(world.calls.eleven, before);
});
await check('an empty story is refused', async () => {
  const row = newViz('u-ritual', { script: '', script_hash: null });
  assert.equal((await call('tok-ritual', { action: 'narrate', id: row.id })).body.error, 'no_script');
});

section('usage and delete');
await check('usage reports the allowance', async () => {
  world.ledger.length = 0; world.settings.daily_visualization_narration_limit = 1;
  const r = await call('tok-ritual', { action: 'usage', tz: 'UTC' });
  assert.deepEqual([r.body.usage.limit, r.body.usage.used, r.body.usage.remaining], [1, 0, 1]);
  assert.equal(r.body.maxWords, 700);
});
await check('deleting removes the story and its audio; it does not hand back the day\'s narration', async () => {
  world.ledger.length = 0;
  const row = newViz('u-ritual');
  await call('tok-ritual', { action: 'narrate', id: row.id, tz: 'UTC' });
  const path = row.narration_path;
  assert.ok(world.storage.has(path));
  const r = await call('tok-ritual', { action: 'delete', id: row.id });
  assert.equal(r.status, 200);
  assert.ok(!world.visualizations.includes(row));
  assert.ok(!world.storage.has(path));
  const u = await call('tok-ritual', { action: 'usage', tz: 'UTC' });
  assert.equal(u.body.usage.remaining, 0);
});

console.log(fails ? `\n${fails} FAILED` : '\nAll visualization server checks passed.');
process.exit(fails ? 1 : 0);
