#!/usr/bin/env node
/* voice-studio-test.mjs — what the studio sends to ElevenLabs, and what it doesn't

   Not part of the site: scripts/ is excluded from the deploy and from what the
   native apps bundle. It loads api/tts.js and api/voice-clone.js with ElevenLabs,
   Supabase and its storage all stubbed, so nothing here talks to any of them, and
   asks the questions this integration has to get right:

     * is a voice only ever one from the catalogue, or this person's own?
     * is Serenity free, and is a cloned voice paid?
     * is the same line in the same voice generated once and then reused?
     * is a whole sequence refused before it is paid for, when the person is over
       their allowance?
     * does a voice get cloned without the confirmation, or twice?
     * does a provider voice id, or the API key, ever reach the response?

     npm run test:voice
*/
process.env.ELEVENLABS_API_KEY = 'el_test_stub';
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_stub';

const SERENITY = 'PrH4gjaYIM8R16R889Vf';   // as in lib/voices.js
const SARAH = 'EXAVITQu4vr4xnSDxMaL';      // retired — a saved subliminal may still name it
let MY_CLONE = 'voice_clone_of_kyla';
let clonesMade = 0;

let fails = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(got)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
}

/* ---------------- the world, in memory ---------------- */
const db = {
  tier: { tier: 'ritual', status: 'active' },
  voiceProfile: null,            // { provider_voice_id, display_name }
  clonedVoiceId: null,           // profiles.cloned_voice_id
  clips: [],                     // tts_clips
  generations: [],               // tts_generations
  objects: new Map(),            // storage
};
let elevenCalls = [];
let nextElevenResponse = null;   // { status, body } to fail with

function reset(){
  db.tier = { tier: 'ritual', status: 'active' };
  db.voiceProfile = null;
  db.clonedVoiceId = null;
  db.clips = []; db.generations = []; db.objects = new Map();
  elevenCalls = []; nextElevenResponse = null;
}

function reply(body, opts){
  const o = opts || {};
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: o.status ? o.status < 400 : true,
    status: o.status || 200,
    headers: { get: (k) => (o.headers || {})[String(k).toLowerCase()] || null },
    json: async () => (typeof body === 'string' ? JSON.parse(text) : body),
    text: async () => text,
    arrayBuffer: async () => (o.bytes || new TextEncoder().encode(text)).buffer,
  };
}
function paramsOf(url){ return new URL(url).searchParams; }
function eqValue(params, key){ return (params.get(key) || '').replace(/^eq\./, ''); }
function inValues(params, key){
  const raw = params.get(key) || '';
  const inner = raw.replace(/^in\.\(/, '').replace(/\)$/, '');
  return inner ? inner.split(',').map(v => v.replace(/^"|"$/g, '')) : [];
}

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const o = opts || {};
  const method = (o.method || 'GET').toUpperCase();
  const body = o.body && typeof o.body === 'string' ? JSON.parse(o.body) : null;

  /* who is calling */
  if (u.includes('/auth/v1/user')){
    const token = (o.headers.Authorization || '').replace('Bearer ', '');
    if (token !== 'good-token') return reply({}, { status: 401 });
    return reply({ id: 'user-abc', email: 'kyla@example.com' });
  }
  /* which plan */
  if (u.includes('/rest/v1/subscribers')) return reply(db.tier ? [db.tier] : []);
  /* the voice of their own */
  if (u.includes('/rest/v1/user_voice_profiles')){
    if (method === 'GET') return reply(db.voiceProfile ? [db.voiceProfile] : []);
    if (method === 'POST'){
      db.voiceProfile = { id: 'vp-1', user_id: body.user_id, provider: 'elevenlabs', provider_voice_id: body.provider_voice_id,
                          display_name: body.display_name, consent_at: body.consent_at, created_at: 'now' };
      return reply([db.voiceProfile]);
    }
    if (method === 'DELETE'){ db.voiceProfile = null; return reply(''); }
  }
  if (u.includes('/rest/v1/profiles')){
    if (method === 'GET') return reply([{ cloned_voice_id: db.clonedVoiceId }]);
    if (method === 'PATCH'){ db.clonedVoiceId = body.cloned_voice_id; return reply(''); }
  }
  /* the clips already generated */
  if (u.includes('/rest/v1/tts_clips')){
    const p = paramsOf(u);
    if (method === 'GET'){
      const keys = inValues(p, 'clip_key');
      const voice = eqValue(p, 'voice_id');
      return reply(db.clips.filter(c => (keys.length ? keys.includes(c.clip_key) : true) && (voice ? c.voice_id === voice : true)));
    }
    if (method === 'POST'){
      const rows = Array.isArray(body) ? body : [body];
      rows.forEach(r => {
        const existing = db.clips.find(c => c.clip_key === r.clip_key && c.user_id === r.user_id);
        if (existing) Object.assign(existing, r);
        else db.clips.push({ id: `clip-${db.clips.length + 1}`, ...r });
      });
      return reply('');
    }
    if (method === 'PATCH') return reply('');
    if (method === 'DELETE'){
      const voice = eqValue(p, 'voice_id');
      db.clips = db.clips.filter(c => c.voice_id !== voice);
      return reply('');
    }
  }
  /* the ledger, and the count the rate limit reads off it */
  if (u.includes('/rest/v1/tts_generations')){
    if (method === 'GET'){
      const p = paramsOf(u);
      const since = (p.get('created_at') || '').replace('gte.', '');
      const n = db.generations.filter(g => !g.cache_hit && (!since || g.created_at >= since)).length;
      return reply([], { headers: { 'content-range': `0-0/${n}` } });
    }
    if (method === 'POST'){
      (Array.isArray(body) ? body : [body]).forEach(r => db.generations.push({ created_at: new Date().toISOString(), ...r }));
      return reply('');
    }
  }
  /* storage */
  if (u.includes('/storage/v1/object/sign/')){
    const path = u.split('/storage/v1/object/sign/tts-cache/')[1];
    if (!db.objects.has(path)) return reply({ error: 'not found' }, { status: 404 });
    return reply({ signedURL: `/object/sign/tts-cache/${path}?token=stub` });
  }
  if (u.includes('/storage/v1/object/tts-cache/')){
    const path = u.split('/storage/v1/object/tts-cache/')[1];
    if (method === 'POST'){ db.objects.set(path, o.body); return reply({ Key: path }); }
  }
  if (u.includes('/object/sign/tts-cache/')){    // the signed link being read back
    return reply('', { bytes: new Uint8Array([0xff, 0xfb, 0x00, 0x00]) });
  }
  if (u.includes('/storage/v1/object/tts-cache') && method === 'DELETE'){
    (body.prefixes || []).forEach(p => db.objects.delete(p));
    return reply('');
  }
  /* the provider */
  if (u.startsWith('https://api.elevenlabs.io/')){
    elevenCalls.push({ url: u, method, key: o.headers && o.headers['xi-api-key'], body });
    if (nextElevenResponse) return reply(nextElevenResponse.body || 'error', { status: nextElevenResponse.status });
    if (u.includes('/text-to-speech/')) return reply('', { bytes: new Uint8Array([0xff, 0xfb, 0x00, 0x00]) });
    if (u.includes('/voices/add')){
      // A new clone is a new voice at the provider, never the same id back.
      MY_CLONE = `voice_clone_of_kyla_${++clonesMade}`;
      return reply({ voice_id: MY_CLONE });
    }
    if (u.includes('/voices/')) return reply({ ok: true });
  }
  throw new Error('unexpected call: ' + method + ' ' + u);
};

const { default: tts } = await import(new URL('../api/tts.js', import.meta.url).href);
const { default: voiceClone } = await import(new URL('../api/voice-clone.js', import.meta.url).href);
const { default: voices } = await import(new URL('../api/voices.js', import.meta.url).href);

function mockRes(){
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}
async function callTts(body, token = 'good-token'){
  const res = mockRes();
  await tts({ method: 'POST', headers: { authorization: token ? 'Bearer ' + token : '' }, body }, res);
  return res;
}
async function callClone({ method = 'POST', token = 'good-token', consent, processingConsent = PROCESSING_CONSENT, replace, sample = 'x'.repeat(4096) } = {}){
  const res = mockRes();
  const headers = { authorization: token ? 'Bearer ' + token : '', 'content-type': 'audio/webm' };
  if (consent) headers['x-voice-consent'] = consent;
  if (processingConsent) headers['x-voice-processing-consent'] = processingConsent;
  if (replace) headers['x-voice-replace'] = '1';
  const req = {
    method, headers,
    on(event, fn){
      if (event === 'data' && sample) fn(Buffer.from(sample));
      if (event === 'end') fn();
      return req;
    },
    destroy(){},
  };
  await voiceClone(req, res);
  return res;
}
const CONSENT = 'I confirm this is my voice and I have permission to create an AI voice clone from it.';
const PROCESSING_CONSENT = 'I consent to my recording being sent to ElevenLabs and processed there to create my AI voice.';
const LINES = ['I am safe.', 'I keep what I promised myself.', 'I am becoming who I said I would be.'];

/* ---------------- who may generate ---------------- */
reset();
check('no token is refused', (await callTts({ voiceKey: 'serenity', lines: LINES }, null)).code, 401);

/* Serenity is the voice the app has — free accounts included. This is the rule
   that changed: it used to be "any studio voice needs Ritual". */
reset();
db.tier = null;                       // a free account has no subscribers row
let r = await callTts({ voiceKey: 'serenity', lines: LINES });
check('a free account may use Serenity', [r.code, r.body.clips.length], [200, 3]);
check('  ...read by Serenity', elevenCalls[0].url.includes(SERENITY), true);

/* A cloned voice is the paid one, and the gate is on the voice, not the route. */
reset();
db.tier = null;
db.voiceProfile = { id: 'vp-1', provider: 'elevenlabs', provider_voice_id: MY_CLONE, display_name: 'Your AI Voice' };
r = await callTts({ voiceKey: 'mine', lines: LINES });
check('a free account cannot use a cloned voice', [r.code, r.body.error], [403, 'upgrade_required']);
check('  ...and nothing was generated', elevenCalls.length, 0);

/* A subliminal saved when there were six voices still plays. */
reset();
r = await callTts({ voiceKey: 'serenity', lines: [LINES[0]] });
check('a retired voice is read by Serenity', [r.code, elevenCalls[0].url.includes(SERENITY)], [200, true]);

reset();
r = await callTts({ voiceKey: 'not-a-voice', lines: LINES });
check('a voice nobody offers is refused', [r.code, r.body.error], [400, 'invalid_voice']);
check('  ...and nothing was generated', elevenCalls.length, 0);

/* ---------------- generated once, then reused ---------------- */
reset();
r = await callTts({ voiceKey: 'serenity', speed: 0.92, lines: LINES });
check('a sequence comes back one clip per line', [r.code, r.body.clips.length], [200, 3]);
check('  ...every line playable', r.body.clips.every(c => !!c.url && !c.error), true);
check('  ...one generation each', elevenCalls.filter(c => c.url.includes('/text-to-speech/')).length, 3);
check('  ...read by the voice the key names', elevenCalls[0].url.includes(SERENITY), true);
check('  ...charged for what was said', r.body.characterCount, LINES.join('').length);
check('the ledger has a row per line', db.generations.length, 3);
check('  ...with the words hashed, not stored', db.generations.every(g => /^[0-9a-f]{64}$/.test(g.text_hash)), true);
check('  ...and the character count', db.generations.map(g => g.character_count), LINES.map(l => l.length));
check('no provider voice id in the response', JSON.stringify(r.body).includes(SERENITY), false);
check('no API key in the response', JSON.stringify(r.body).includes('el_test_stub'), false);
check('the key did reach the provider', elevenCalls[0].key, 'el_test_stub');

const before = elevenCalls.length;
r = await callTts({ voiceKey: 'serenity', speed: 0.92, lines: LINES });
check('asking again generates nothing', elevenCalls.length - before, 0);
check('  ...and is still playable', r.body.clips.every(c => c.url && c.cached), true);
check('  ...and is charged nothing', r.body.characterCount, 0);
check('  ...but is still on the ledger, as a reuse', db.generations.filter(g => g.cache_hit).length, 3);

r = await callTts({ voiceKey: 'serenity', speed: 1.2, lines: LINES });
check('a different pace is different audio', elevenCalls.filter(c => c.url.includes('/text-to-speech/')).length, 6);

/* the same words in a different voice are not the same clip */
db.voiceProfile = { id: 'vp-1', provider: 'elevenlabs', provider_voice_id: MY_CLONE, display_name: 'Your AI Voice' };
r = await callTts({ voiceKey: 'mine', speed: 0.92, lines: [LINES[0]] });
check('a different voice is different audio', r.body.clips[0].cached, false);

/* ---------------- the cost ceiling ---------------- */
reset();
const halfAnHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
for (let i = 0; i < 149; i++) db.generations.push({ cache_hit: false, created_at: halfAnHourAgo });
r = await callTts({ voiceKey: 'serenity', lines: LINES });
check('a sequence over the allowance is refused whole', [r.code, r.body.error], [429, 'hourly_limit']);
check('  ...before a single line is paid for', elevenCalls.length, 0);
check('  ...and says how much room is left', r.body.headroom, 1);

/* ---------------- when the provider says no ---------------- */
reset();
nextElevenResponse = { status: 402, body: 'quota exceeded' };
r = await callTts({ voiceKey: 'serenity', lines: LINES });
check('out of credits is its own answer', [r.code, r.body.error], [429, 'quota_exceeded']);
check('  ...and it stops after the first line', elevenCalls.length, 1);

reset();
nextElevenResponse = { status: 404, body: 'voice_not_found' };
r = await callTts({ voiceKey: 'serenity', lines: [LINES[0]] });
check('a voice missing at the provider is invalid_voice', r.body.error, 'invalid_voice');

reset();
r = await callTts({ voiceKey: 'serenity', lines: ['a'.repeat(500), LINES[0]] });
check('an over-long line fails on its own', r.body.clips[0].error, 'too_long');
check('  ...and the rest of the sequence still plays', !!r.body.clips[1].url, true);

reset();
r = await callTts({ voiceKey: 'serenity', lines: new Array(30).fill(LINES[0]) });
check('more lines than a session can hold is refused', [r.code, r.body.error], [400, 'too_many_lines']);

/* ---------------- a voice of their own ---------------- */
reset();
r = await callTts({ voiceKey: 'mine', lines: [LINES[0]] });
check('"mine" with no voice yet says so', [r.code, r.body.error], [409, 'no_cloned_voice']);

reset();
db.voiceProfile = { id: 'vp-1', provider: 'elevenlabs', provider_voice_id: MY_CLONE, display_name: 'Your AI Voice' };
r = await callTts({ voiceKey: 'mine', lines: [LINES[0]] });
check('"mine" reads in their own cloned voice', elevenCalls[0].url.includes(MY_CLONE), true);
check('  ...without naming it in the response', JSON.stringify(r.body).includes(MY_CLONE), false);

/* ---------------- cloning ---------------- */
reset();
r = await callClone({ consent: null });
check('no confirmation, no clone', [r.code, r.body.error], [400, 'consent_required']);
check('  ...and nothing reached the provider', elevenCalls.length, 0);

reset();
r = await callClone({ consent: 'I guess so' });
check('the wrong words are not a confirmation', r.body.error, 'consent_required');

/* Agreeing that it is your voice is not agreeing to it being sent anywhere.
   Two questions, two headers, and the route wants both. */
reset();
r = await callClone({ consent: CONSENT, processingConsent: null });
check('no ElevenLabs consent, no clone', [r.code, r.body.error], [400, 'processing_consent_required']);
check('  ...and nothing reached the provider', elevenCalls.length, 0);

reset();
r = await callClone({ consent: CONSENT, processingConsent: 'sure, whatever' });
check('the wrong words are not that confirmation either', r.body.error, 'processing_consent_required');

reset();
db.tier = null;
r = await callClone({ consent: CONSENT });
check('cloning is a Ritual feature', [r.code, r.body.error], [403, 'upgrade_required']);

reset();
r = await callClone({ consent: CONSENT });
check('a first clone is created', [r.code, !!r.body.created], [200, true]);
check('  ...against the signed-in user', db.voiceProfile.user_id, 'user-abc');
check('  ...with the confirmation recorded', !!db.voiceProfile.consent_at, true);
check('  ...and mirrored onto the profile', db.clonedVoiceId, MY_CLONE);
check('  ...without handing the id to the browser', JSON.stringify(r.body).includes(MY_CLONE), false);

const clonesBefore = elevenCalls.filter(c => c.url.includes('/voices/add')).length;
r = await callClone({ consent: CONSENT });
check('building again reuses the voice', [r.code, !!r.body.reused], [200, true]);
check('  ...and clones nothing', elevenCalls.filter(c => c.url.includes('/voices/add')).length - clonesBefore, 0);

db.clips.push({ id: 'c1', user_id: 'user-abc', voice_id: MY_CLONE, clip_key: 'k1', storage_path: 'user-abc/k1.mp3' });
db.objects.set('user-abc/k1.mp3', 'bytes');
r = await callClone({ consent: CONSENT, replace: true });
check('recording it again replaces the voice', !!r.body.created, true);
check('  ...and clears the audio read in the old one', db.clips.length, 0);

r = await callClone({ method: 'DELETE' });
check('removing it removes the record', [r.code, db.voiceProfile], [200, null]);
check('  ...and the mirror on the profile', db.clonedVoiceId, null);

/* ---------------- the catalogue ---------------- */
reset();
db.voiceProfile = { id: 'vp-1', provider: 'elevenlabs', provider_voice_id: MY_CLONE, display_name: 'Your AI Voice' };
const catRes = mockRes();
await voices({ method: 'POST', headers: { authorization: 'Bearer good-token' } }, catRes);
check('the catalogue offers one built-in voice', catRes.body.presets.length, 1);
check('  ...and it is Serenity', [catRes.body.presets[0].key, catRes.body.presets[0].name], ['serenity', 'Serenity']);
check('  ...by key and name only', Object.keys(catRes.body.presets[0]).sort(), ['desc', 'key', 'name']);
check('  ...never by provider id', JSON.stringify(catRes.body).includes(SERENITY), false);
check('  ...says a voice of their own exists', catRes.body.myVoice.key, 'mine');
check('  ...without its id', JSON.stringify(catRes.body).includes(MY_CLONE), false);
check('  ...and carries both confirmations the clone route checks',
  [catRes.body.consentStatement, catRes.body.processingConsentStatement], [CONSENT, PROCESSING_CONSENT]);
check('  ...and which plan cloning needs', catRes.body.cloneTier, 'ritual');

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
