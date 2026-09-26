#!/usr/bin/env node
/* voice-studio-test.mjs — what the studio sends to ElevenLabs, and what it doesn't

   Not part of the site: scripts/ is excluded from the deploy and from what the
   native apps bundle. It loads api/tts.js and api/voice-clone.js with ElevenLabs,
   Supabase and its storage all stubbed, so nothing here talks to any of them, and
   asks the questions this integration has to get right:

     * is a voice only ever one from the catalogue, or this person's own?
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

const SERENITY = 'PrH4gjaYIM8R16R889Vf'; // the one AI voice on offer — lib/voices.js
const SARAH = 'EXAVITQu4vr4xnSDxMaL';   // retired, still resolvable — LEGACY_PRESET_VOICES
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
let failProfileSave = false;     // Supabase refuses the voice profile write

function reset(){
  db.tier = { tier: 'ritual', status: 'active' };
  db.voiceProfile = null;
  db.clonedVoiceId = null;
  db.clips = []; db.generations = []; db.objects = new Map();
  elevenCalls = []; nextElevenResponse = null; failProfileSave = false;
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
    if (token === 'other-token') return reply({ id: 'user-xyz', email: 'someone@example.com' });
    if (token !== 'good-token') return reply({}, { status: 401 });
    return reply({ id: 'user-abc', email: 'kyla@example.com' });
  }
  /* which plan */
  if (u.includes('/rest/v1/subscribers')) return reply(db.tier ? [db.tier] : []);
  /* the voice of their own */
  if (u.includes('/rest/v1/user_voice_profiles')){
    if (method === 'GET'){
      // Rows are looked up by owner, as PostgREST would.
      const owner = eqValue(paramsOf(u), 'user_id');
      const row = db.voiceProfile && (!db.voiceProfile.user_id || db.voiceProfile.user_id === owner) ? db.voiceProfile : null;
      return reply(row ? [row] : []);
    }
    if (method === 'POST'){
      if (failProfileSave) return reply({ message: 'permission denied' }, { status: 403 });
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
    // Reading an object straight back is how the Serenity demo is served.
    if (method === 'GET'){
      if (!db.objects.has(path)) return reply({ error: 'not found' }, { status: 404 });
      return reply('', { bytes: new Uint8Array(Buffer.from(db.objects.get(path))) });
    }
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
    elevenCalls.push({ url: u, method, key: o.headers && o.headers['xi-api-key'], body,
                       form: (typeof FormData !== 'undefined' && o.body instanceof FormData) ? o.body : null });
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
const { default: voicePreview } = await import(new URL('../api/voice-preview.js', import.meta.url).href);
const { PREVIEW_TEXT, previewStoragePath } = await import(new URL('../lib/voice-preview.js', import.meta.url).href);
const { parseWav: parseWavHeader, measureWav: measureWavLevel } = await import(new URL('../lib/voice-sample.js', import.meta.url).href);

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
/* What the page sends: 16-bit PCM WAV, mono, 22.05 kHz — speech-like tone
   bursts with pauses, or silence. */
function makeWav(seconds, { rate = 22050, silent = false, amplitude = 0.3 } = {}){
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++){
    const t = i / rate;
    // Real silence: at the noise floor of a 16-bit capture, not a quiet tone —
    // a genuinely muted or disconnected mic reads at essentially nothing.
    const talking = !silent && (t % 1.5) < 1.0;   // a second of voice, half a second of pause
    const v = silent ? 0.00005 * Math.sin(i) : (talking ? amplitude * Math.sin(2 * Math.PI * 180 * t) : 0.001 * Math.sin(i));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
const GOOD_WAV = makeWav(75);
// Genuinely spoken, genuinely quiet: real consonant/vowel structure (not a flat
// tone) at a peak level a fixed threshold used to refuse outright — the
// "recorded fine, but the mic captured it quietly" case (soft-spoken, some
// distance from the mic, or iOS not applying autoGainControl the way a call
// does when echo cancellation and noise suppression are off). Loud enough to
// clear SILENCE_FLOOR, far under the old flat "voiced" threshold before
// normalization brings it up.
function makeQuietSpeechWav(seconds, { rate = 22050, peak = 0.02 } = {}){
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++){
    const t = i / rate;
    const talking = (t % 1.5) < 1.0;
    // A fundamental plus a couple of harmonics — closer to a voiced formant
    // shape than a pure tone, still cheap to synthesize.
    const v = talking
      ? peak * (0.6 * Math.sin(2 * Math.PI * 150 * t) + 0.3 * Math.sin(2 * Math.PI * 300 * t) + 0.1 * Math.sin(2 * Math.PI * 450 * t))
      : 0.0005 * Math.sin(i);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  }
  return buf;
}
/* Same audio, a normalization pass or a container swap away: not byte-identical
   any more (the route always brings loudness up to a working level now), but
   still the same recording — same duration, still real 16-bit PCM WAV. */
function sameRecording(buf, wantSeconds){
  const wav = parseWavHeader(buf);
  if (!wav) return false;
  return Math.abs(wav.seconds - wantSeconds) < 1 && wav.format === 1 && wav.bitsPerSample === 16;
}

async function callClone({ method = 'POST', token = 'good-token', consent, replace, sample = GOOD_WAV, contentType = 'audio/wav' } = {}){
  const res = mockRes();
  const headers = { authorization: token ? 'Bearer ' + token : '', 'content-type': contentType };
  if (consent) headers['x-voice-consent'] = consent;
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
const CONSENT = 'I confirm this recording is my own voice, that I have permission to clone it, and that I consent to Subliminally creating an AI version of my voice. I am not uploading anyone else\'s voice.';
const LINES = ['I am safe.', 'I keep what I promised myself.', 'I am becoming who I said I would be.'];

/* ---------------- who may generate ---------------- */
reset();
check('no token is refused', (await callTts({ voiceKey: 'serenity', lines: LINES }, null)).code, 401);

reset();
db.tier = null;                       // a free account has no subscribers row
let r = await callTts({ voiceKey: 'serenity', lines: LINES });
check('a free account is asked to upgrade', [r.code, r.body.error], [403, 'upgrade_required']);
check('  ...and nothing was generated', elevenCalls.length, 0);

reset();
r = await callTts({ voiceKey: 'not-a-voice', lines: LINES });
check('a voice nobody offers is refused', [r.code, r.body.error], [400, 'invalid_voice']);
check('  ...and nothing was generated', elevenCalls.length, 0);

/* ---------------- the voices that were retired ----------------
   They are gone from the picker, not from the world: a subliminal saved with one
   still plays, in the voice it was saved with, off the clips already cached. */
reset();
r = await callTts({ voiceKey: 'sarah', lines: [LINES[0]] });
check('a subliminal saved with a retired voice still plays', r.code, 200);
check('  ...in the voice it was saved with, not Serenity', elevenCalls[0].url.includes(SARAH), true);

reset();
db.tier = null;
r = await callTts({ voiceKey: 'sarah', lines: [LINES[0]] });
check('a retired voice is premium too', [r.code, r.body.error], [403, 'upgrade_required']);
check('  ...and nothing was generated', elevenCalls.length, 0);

/* A free account must not reach the provider by any route, including its own
   cloned voice from a lapsed subscription. */
reset();
db.tier = null;
db.voiceProfile = { id: 'vp-1', provider: 'elevenlabs', provider_voice_id: MY_CLONE, display_name: 'My voice' };
r = await callTts({ voiceKey: 'mine', lines: LINES });
check('a lapsed account cannot use its own clone', [r.code, r.body.error], [403, 'upgrade_required']);
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
r = await callTts({ voiceKey: 'daniel', speed: 0.92, lines: [LINES[0]] });
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
db.voiceProfile = { id: 'vp-1', provider: 'elevenlabs', provider_voice_id: MY_CLONE, display_name: 'My voice' };
r = await callTts({ voiceKey: 'mine', lines: [LINES[0]] });
check('"mine" reads in their own cloned voice', elevenCalls[0].url.includes(MY_CLONE), true);
check('  ...without naming it in the response', JSON.stringify(r.body).includes(MY_CLONE), false);

/* Somebody else, signed in and paying, cannot read in this person's voice —
   not by asking for 'mine', and not by sending the provider id itself. */
reset();
db.voiceProfile = { id: 'vp-1', user_id: 'user-abc', provider: 'elevenlabs', provider_voice_id: MY_CLONE, display_name: 'My voice' };
r = await callTts({ voiceKey: 'mine', lines: [LINES[0]] }, 'other-token');
check('another user\'s "mine" is their own, not this one', [r.code, r.body.error], [409, 'no_cloned_voice']);
r = await callTts({ voiceKey: MY_CLONE, lines: [LINES[0]] }, 'other-token');
check('another user sending this voice id is refused', [r.code, r.body.error], [400, 'invalid_voice']);
check('  ...and nothing reached ElevenLabs', elevenCalls.length, 0);

/* ---------------- cloning ---------------- */
reset();
r = await callClone({ consent: null });
check('no confirmation, no clone', [r.code, r.body.error], [400, 'consent_required']);
check('  ...and nothing reached the provider', elevenCalls.length, 0);

reset();
r = await callClone({ consent: 'I guess so' });
check('the wrong words are not a confirmation', r.body.error, 'consent_required');

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

/* ---------------- phase 1: record, consent, clone, remember ---------------- */
reset();
r = await callClone({ token: null, consent: CONSENT });
check('signed out, no clone', [r.code, r.body.error], [401, 'not_signed_in']);
check('  ...and nothing reached the provider', elevenCalls.length, 0);

reset();
const beforeClone = Date.now();
r = await callClone({ consent: CONSENT });
const add = elevenCalls.find(c => c.url.endsWith('/voices/add'));
check('the sample reaches ElevenLabs Instant Voice Cloning', [r.code, !!add, add && add.method], [200, true, 'POST']);
check('  ...from the server, with the server key', add.key, 'el_test_stub');
check('  ...named by account id, not email', add.form.get('name'), 'subliminally-user-abc');
check('  ...never the email address', JSON.stringify([...add.form.keys()].map(k => String(add.form.get(k)))).includes('kyla@'), false);
check('  ...carrying the recording itself', sameRecording(Buffer.from(await add.form.get('files').arrayBuffer()), 75), true);
check('  ...as a WAV file', [add.form.get('files').name, add.form.get('files').type], ['sample.wav', 'audio/wav']);
check('the returned voice_id is saved', db.voiceProfile.provider_voice_id, MY_CLONE);
check('  ...for the signed-in user', db.voiceProfile.user_id, 'user-abc');
check('  ...with a consent timestamp from this request', Date.parse(db.voiceProfile.consent_at) >= beforeClone - 1000, true);

const catMine = mockRes();
await voices({ method: 'POST', headers: { authorization: 'Bearer good-token' } }, catMine);
check('a returning user is recognised as having a voice', !!catMine.body.myVoice, true);

const catOther = mockRes();
await voices({ method: 'POST', headers: { authorization: 'Bearer other-token' } }, catOther);
check('another user does not see that voice', catOther.body.myVoice, null);
const addsBeforeOther = elevenCalls.length;
r = await callTts({ voiceKey: 'mine', lines: [LINES[0]] }, 'other-token');
check('another user cannot generate in it by key', [r.code, r.body.error], [409, 'no_cloned_voice']);
r = await callTts({ voiceKey: MY_CLONE, lines: [LINES[0]] }, 'other-token');
check('  ...nor by its raw voice_id', [r.code, r.body.error], [400, 'invalid_voice']);
check('  ...and nothing reached the provider', elevenCalls.length - addsBeforeOther, 0);

/* The profile row is writable by its owner, so a voice id typed into it is not
   proof of ownership and must never be used. */
reset();
db.clonedVoiceId = 'somebody_elses_voice';
r = await callTts({ voiceKey: 'mine', lines: [LINES[0]] });
check('a voice id written onto your own profile is not trusted', [r.code, r.body.error], [409, 'no_cloned_voice']);
check('  ...and nothing reached the provider', elevenCalls.length, 0);

for (const [status, body, code] of [[500, 'boom', 'provider_failed'], [402, 'quota', 'quota_exceeded'], [200, '{}', 'rejected']]){
  reset();
  nextElevenResponse = { status, body };
  r = await callClone({ consent: CONSENT });
  check(`ElevenLabs ${status} saves no voice`, [r.body.error, db.voiceProfile, db.clonedVoiceId], [code, null, null]);
}

/* ---------------- what a failed clone says, and what it leaves ----------------
   Each of these needs a different fix, so each comes back as its own code rather
   than one "something went wrong". */
for (const [status, body, code] of [
  [401, '{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}', 'provider_auth'],
  [403, '{"detail":{"status":"can_not_use_instant_voice_cloning","message":"Your subscription does not include instant voice cloning"}}', 'plan_not_allowed'],
  [400, '{"detail":{"status":"voice_limit_reached","message":"You have reached your maximum amount of custom voices"}}', 'voice_limit_reached'],
  [400, '{"detail":{"status":"invalid_file","message":"Could not decode the audio file"}}', 'unsupported_format'],
  [422, '{"detail":{"status":"verification_required","message":"Voice verification required"}}', 'verification_required'],
]){
  reset();
  nextElevenResponse = { status, body };
  r = await callClone({ consent: CONSENT });
  check(`ElevenLabs ${status} ${code} is reported as ${code}`, [r.body.error, db.voiceProfile], [code, null]);
}

reset();
failProfileSave = true;
r = await callClone({ consent: CONSENT });
check('a voice that cannot be saved to the account is reported', [r.code, r.body.error], [500, 'save_failed']);
check('  ...and removed at the provider rather than left orphaned',
  elevenCalls.some(c => c.method === 'DELETE' && c.url.endsWith('/voices/' + MY_CLONE)), true);

/* The minute is checked on the audio the server received, not on the page's
   timer — and nothing short, silent or unreadable reaches the provider. */
for (const [label, sample, code] of [
  ['a 45 second sample', makeWav(45), 'sample_too_short'],
  ['a minute of silence', makeWav(70, { silent: true }), 'sample_silent'],
  ['an MP4 header with nothing readable behind it', Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(8192, 1)]), 'unsupported_format'],
  ['an empty body', Buffer.alloc(0), 'sample_empty'],
]){
  reset();
  r = await callClone({ consent: CONSENT, sample });
  check(`${label} is refused as ${code}`, [r.code >= 400, r.body.error], [true, code]);
  check('  ...and nothing reached the provider', elevenCalls.length, 0);
}
reset();
r = await callClone({ consent: CONSENT, sample: makeWav(59.7) });
check('1:00 on the clock that decodes to 59.7s is accepted', [r.code, !!r.body.created], [200, true]);

/* ---------------- a real but quiet recording is not "not enough voice" ----------------
   The bug this guards against: a phone mic that captured actual, continuous
   speech, but at a peak level under the old flat threshold — soft-spoken, some
   distance from the mic, or (on iOS Safari) autoGainControl not applying the
   way it does on a call, because turning off echo cancellation and noise
   suppression for a cleaner sample also turns off the gain stage that rides
   along with them. That is not the same thing as a muted or disconnected mic,
   and must not be refused as sample_silent. */
for (const peak of [0.05, 0.02, 0.008]){
  reset();
  const quiet = makeQuietSpeechWav(75, { peak });
  const level = measureWavLevel(quiet, parseWavHeader(quiet));
  r = await callClone({ consent: CONSENT, sample: quiet });
  check(`continuous real speech at peak ${peak} (raw voicedSeconds ${level.voicedSeconds}) is cloned, not refused as silent`,
    [r.code, r.body.error, !!r.body.created], [200, undefined, true]);
}
reset();
{
  // Below SILENCE_FLOOR before any boost: this is what a muted or disconnected
  // mic actually looks like, and boosting it must not manufacture a "voice".
  const dead = makeWav(70, { silent: true });
  r = await callClone({ consent: CONSENT, sample: dead });
  check('true silence (below the floor, before normalization) is still refused', [r.code, r.body.error], [400, 'sample_silent']);
  check('  ...and nothing reached the provider', elevenCalls.length, 0);
}

/* ---------------- anything that is not WAV is converted, not refused ----------------
   What an iPhone records (AAC in a fragmented MP4, as Safari's MediaRecorder
   writes it), what people upload (M4A, MP4, MOV, MP3, WebM), sent the way the
   page sends it (multipart, named for its type) and the way an older app build
   sends it (the raw bytes as the body). Each is made with the same ffmpeg the
   server uses, from the same speech-like WAV. */
{
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { default: ffmpeg } = await import('ffmpeg-static');
  const dir = mkdtempSync(join(tmpdir(), 'voice-test-'));
  writeFileSync(join(dir, 'src.wav'), makeWav(75, { rate: 44100 }));
  writeFileSync(join(dir, 'short.wav'), makeWav(45, { rate: 44100 }));
  function make(name, args, from = 'src.wav'){
    const out = join(dir, name);
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args.pre || [], '-i', join(dir, from), ...args.post, out]);
    if (r.status !== 0) throw new Error(`could not make ${name}: ${r.stderr}`);
    return readFileSync(out);
  }
  const video = { pre: ['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=15:d=75'], post: [] };
  const media = {
    safariM4a: make('safari.m4a', { post: ['-c:a', 'aac', '-b:a', '64k', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'] }),
    m4a: make('voice.m4a', { post: ['-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart'] }),
    mp3: make('voice.mp3', { post: ['-c:a', 'libmp3lame', '-b:a', '64k'] }),
    webm: make('voice.webm', { post: ['-c:a', 'libopus', '-b:a', '32k'] }),
    mov: make('clip.mov', { pre: video.pre, post: ['-map', '0:v', '-map', '1:a', '-c:v', 'mpeg4', '-q:v', '31', '-c:a', 'aac', '-b:a', '64k', '-shortest'] }),
    mp4: make('clip.mp4', { pre: video.pre, post: ['-map', '0:v', '-map', '1:a', '-c:v', 'mpeg4', '-q:v', '31', '-c:a', 'aac', '-b:a', '64k', '-shortest'] }),
    silentVideo: make('novoice.mp4', { pre: video.pre, post: ['-map', '0:v', '-c:v', 'mpeg4', '-q:v', '31'] }),
    shortM4a: make('short.m4a', { post: ['-c:a', 'aac', '-b:a', '64k'] }, 'short.wav'),
    wav24: make('voice24.wav', { post: ['-c:a', 'pcm_s24le', '-ar', '16000'] }),
  };
  rmSync(dir, { recursive: true, force: true });

  async function multipart(bytes, type, name){
    const form = new FormData();
    form.append('sample', new Blob([bytes], { type }), name);
    const r = new Response(form);
    return { sample: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') };
  }
  function sentToProvider(){
    const add = elevenCalls.find(c => c.url.includes('/voices/add'));
    return add && add.form ? add.form.get('files') : null;
  }

  for (const [label, bytes, type, name] of [
    ['an iPhone Safari recording (fragmented MP4/AAC)', media.safariM4a, 'audio/mp4', 'voice-recording.m4a'],
    ['an uploaded M4A', media.m4a, 'audio/x-m4a', 'Voice Memo.m4a'],
    ['an uploaded MP3', media.mp3, 'audio/mpeg', 'me.mp3'],
    ['an uploaded WebM', media.webm, 'audio/webm', 'me.webm'],
    ['an uploaded MOV video', media.mov, 'video/quicktime', 'IMG_0001.MOV'],
    ['an uploaded MP4 video', media.mp4, 'video/mp4', 'clip.mp4'],
    ['a 24-bit WAV', media.wav24, 'audio/wav', 'studio.wav'],
    ['an M4A with no type and a wrong name', media.m4a, '', 'recording.webm'],
  ]){
    reset();
    r = await callClone({ consent: CONSENT, ...(await multipart(bytes, type, name)) });
    check(`${label} is converted and cloned`, [r.code, !!r.body.created], [200, true]);
    const file = sentToProvider();
    check('  ...and reaches ElevenLabs as PCM WAV named .wav',
      file ? [file.type, file.name, Buffer.from(await file.arrayBuffer()).toString('latin1', 0, 4)] : null,
      ['audio/wav', 'sample.wav', 'RIFF']);
  }

  reset();
  r = await callClone({ consent: CONSENT, sample: media.safariM4a, contentType: 'audio/mp4' });
  check('an older app build posting raw audio/mp4 is converted, not refused', [r.code, !!r.body.created], [200, true]);

  reset();
  r = await callClone({ consent: CONSENT, ...(await multipart(GOOD_WAV, 'audio/wav', 'voice-sample.wav')) });
  check('the page\'s own WAV, as multipart, is cloned', [r.code, !!r.body.created], [200, true]);
  check('  ...still the same recording after normalization', sameRecording(Buffer.from(await sentToProvider().arrayBuffer()), 75), true);

  for (const [label, sample, code] of [
    ['a 45 second M4A', await multipart(media.shortM4a, 'audio/mp4', 'short.m4a'), 'sample_too_short'],
    ['a video with no sound', await multipart(media.silentVideo, 'video/mp4', 'novoice.mp4'), 'sample_no_audio'],
    ['a form with no sample in it', { sample: Buffer.from('--x\r\nContent-Disposition: form-data; name="other"\r\n\r\nhi\r\n--x--\r\n'), contentType: 'multipart/form-data; boundary=x' }, 'upload_malformed'],
  ]){
    reset();
    r = await callClone({ consent: CONSENT, ...sample });
    check(`${label} is refused as ${code}`, [r.code >= 400, r.body.error], [true, code]);
    check('  ...and nothing reached the provider', elevenCalls.length, 0);
  }

  reset();
  r = await callClone({ consent: null, ...(await multipart(media.m4a, 'audio/mp4', 'v.m4a')) });
  check('an upload without the confirmation is still refused', [r.code, r.body.error], [400, 'consent_required']);
}

/* ---------------- the key never reaches the browser ---------------- */
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const root = new URL('../', import.meta.url);
  const clientFiles = [
    ...readdirSync(new URL('js/', root)).filter(f => f.endsWith('.js')).map(f => new URL('js/' + f, root)),
    ...readdirSync(root).filter(f => f.endsWith('.html')).map(f => new URL(f, root)),
  ];
  const leaks = clientFiles.filter(f => /ELEVENLABS_API_KEY|xi-api-key|api\.elevenlabs\.io/.test(readFileSync(f, 'utf8')));
  check('no client file names the ElevenLabs key or calls ElevenLabs', leaks.map(String), []);
}

/* ---------------- the catalogue ---------------- */
reset();
db.voiceProfile = { id: 'vp-1', provider: 'elevenlabs', provider_voice_id: MY_CLONE, display_name: 'My voice' };
const catRes = mockRes();
await voices({ method: 'POST', headers: { authorization: 'Bearer good-token' } }, catRes);
check('the catalogue offers one AI voice', catRes.body.presets.length, 1);
check('  ...and it is Serenity', catRes.body.presets[0].key, 'serenity');
check('  ...by key and name only', Object.keys(catRes.body.presets[0]).sort(), ['desc', 'key', 'name']);
check('  ...never by provider id', JSON.stringify(catRes.body).includes(SERENITY), false);
check('  ...and never offers a retired voice', JSON.stringify(catRes.body).includes('sarah'), false);
check('  ...says a voice of their own exists', catRes.body.myVoice.key, 'mine');
check('  ...without its id', JSON.stringify(catRes.body).includes(MY_CLONE), false);
check('  ...and carries the confirmation the clone route checks', catRes.body.consentStatement, CONSENT);

/* ---------------- the Serenity demo ----------------
   The one place a voice is heard without paying for it. It has to be free to
   play, open to somebody with no account at all, and it has to cost exactly one
   generation for the life of the app — not one per press, per person or per
   page. It also has to be useless as free text-to-speech. */
reset();
async function callPreview({ method = 'GET', token = null, body } = {}){
  const res = mockRes();
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  await voicePreview({ method, headers, body }, res);
  return res;
}
const PREVIEW_PATH = previewStoragePath();

r = await callPreview();
check('the demo plays for somebody with no account', r.code, 200);
check('  ...as an mp3', r.headers['Content-Type'], 'audio/mpeg');
check('  ...cached hard, so most presses never reach the server', r.headers['Cache-Control'], 'public, max-age=31536000, immutable');
check('  ...generated once', elevenCalls.filter(c => c.url.includes('/text-to-speech/')).length, 1);
check('  ...in Serenity', elevenCalls[0].url.includes(SERENITY), true);
check('  ...saying the one line it is allowed to say', elevenCalls[0].body.text, PREVIEW_TEXT);
check('  ...and kept', db.objects.has(PREVIEW_PATH), true);

const afterFirstPreview = elevenCalls.length;
await callPreview();
await callPreview();
await callPreview();
check('pressing Preview again costs nothing', elevenCalls.length - afterFirstPreview, 0);

/* A second serverless instance, cold, with the file already in the bucket: it
   must read it back rather than pay for it again. Importing the route under a
   different URL is how you get one in a single process. */
const { default: coldPreview } = await import(new URL('../api/voice-preview.js?instance=2', import.meta.url).href);
const coldRes = mockRes();
await coldPreview({ method: 'GET', headers: {} }, coldRes);
check('a cold server reads the file back', coldRes.code, 200);
check('  ...without generating anything', elevenCalls.length - afterFirstPreview, 0);
check('  ...the same audio everybody else got', Buffer.from(coldRes.body).equals(Buffer.from(db.objects.get(PREVIEW_PATH))), true);

/* It is a demo, not an endpoint. There is nothing to submit to it. */
const postRes = await callPreview({ method: 'POST', body: { text: 'read my affirmations for free' } });
check('nothing can be submitted to the demo', [postRes.code, postRes.body.error], [405, 'method_not_allowed']);
check('  ...and nothing was generated', elevenCalls.length - afterFirstPreview, 0);

/* Hearing Serenity is free. Being read BY Serenity is not, and the demo does not
   change that for a single caller. */
reset();
db.tier = null;
r = await callTts({ voiceKey: 'serenity', lines: LINES });
check('the demo does not unlock Serenity for a free account', [r.code, r.body.error], [403, 'upgrade_required']);
check('  ...and nothing was generated', elevenCalls.length, 0);

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
