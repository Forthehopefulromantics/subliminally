/* Regression coverage for studio voice failures and long visualization playback. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/builder.js', 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const elements = { finalLine: { textContent: '' } };
const played = [], requests = [];
let failure = null, stopped = 0, done = 0;
const ctx = vm.createContext({
  currentUser: { id: 'user' }, DEVICE_VOICE: 'device', MY_CLONED_VOICE: 'mine',
  getMyTier: async () => 'ritual', tierHasFeature: tier => tier === 'ritual',
  myVoiceProfile: async () => ({ id: 'clone' }),
  finalPlaying: true, finalCtx: {}, state: { aiVoiceId: 'serenity' },
  document: { getElementById: id => elements[id] },
  stopFinal: () => { stopped++; ctx.finalPlaying = false; },
  waitWhileFinalPaused: () => false,
  ttsLineText: text => String(text ?? '').replace(/\s+/g, ' ').trim(),
  synthesizeLine: async (text, voice) => { requests.push({ text, voice }); if(failure) throw Error(failure); return text; },
  studioClipHandle: url => ({ url }), loadClip: async (_, handle) => handle,
  playClip: (_, clip, gain, dest, end) => { played.push(clip.url); end(); },
});
vm.runInContext(section('async function resolveVoiceKey', '/* A *generated* preview'), ctx);
vm.runInContext(section('const TTS_MESSAGES', '/* ---------------- generated speech'), ctx);
vm.runInContext(section('function splitSpeechText', 'async function ttsRequest'), ctx);
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  assert.equal(await ctx.resolveVoiceKey('serenity'), 'serenity');
  assert.equal(await ctx.resolveVoiceKey('mine'), 'mine');
  assert.equal(await ctx.resolveVoiceKey('device'), null);
  await assert.rejects(ctx.resolveVoiceKey(null), /invalid_voice/);
  ctx.currentUser = null;
  await assert.rejects(ctx.resolveVoiceKey('serenity'), /not_signed_in/);
  ctx.currentUser = { id: 'user' }; ctx.getMyTier = async () => 'free';
  await assert.rejects(ctx.resolveVoiceKey('serenity'), /upgrade_required/);
  ctx.getMyTier = async () => 'ritual'; ctx.myVoiceProfile = async () => null;
  await assert.rejects(ctx.resolveVoiceKey('mine'), /no_cloned_voice/);

  const story = 'You step into the warm light. You feel at home, and the room fills with laughter. '.repeat(25).trim();
  const chunks = Array.from(ctx.splitSpeechText(story));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.length <= 400 && c.length > 0));
  assert.equal(chunks.join(' '), story);
  assert.equal(Array.from(ctx.splitSpeechText('a'.repeat(1201))).join(''), 'a'.repeat(1201));
  ctx.playStudioLine(story, 'serenity', () => 0.5, null, () => done++);
  await tick();
  assert.deepEqual(played, chunks);
  assert.ok(requests.every(r => r.voice === 'serenity'));
  assert.equal(done, 1);

  for (const code of ['quota_exceeded', 'network', 'not_configured', 'timeout']) {
    ctx.finalPlaying = true; failure = code;
    ctx.playStudioLine('I belong here.', 'serenity', () => 0.5, null, () => done++);
    await tick();
    assert.equal(ctx.finalPlaying, false);
    assert.ok(elements.finalLine.textContent.length > 0);
    assert.equal(done, 1, 'a failed line must not advance or loop');
    assert.equal(ctx.state.aiVoiceId, 'serenity');
  }
  assert.equal(stopped, 4);

  failure = null; ctx.finalPlaying = true;
  ctx.playStudioLine('I belong here.', 'serenity', () => 0.5, null, () => done++);
  await tick(); assert.equal(done, 2, 'retry plays the chosen voice');

  // A response from a stopped session must not play in the next session.
  let release;
  ctx.synthesizeLine = () => new Promise(resolve => { release = resolve; });
  ctx.playStudioLine('Old session.', 'serenity', () => 0.5, null, () => done++);
  ctx.finalCtx = {}; release('stale'); await tick();
  assert.ok(!played.includes('stale'));

  // Verify HTML audio rejection is surfaced instead of treated as completion.
  let audioError = 0, audioEnd = 0;
  ctx.liveVoiceGains = new Set(); ctx.liveVoiceElements = new Set();
  vm.runInContext(section('function playClip(', '\nlet mediaRecorder'), ctx);
  ctx.playClip({}, { kind: 'element', gain: { gain: {} }, el: { play: () => Promise.reject(Error('blocked')) } }, 1, null,
    () => audioEnd++, () => audioError++);
  await tick(); assert.equal(audioError, 1); assert.equal(audioEnd, 0);
  console.log('PASS: voice resolution, long stories, ordered playback, failure handling, retry, stale sessions, audio rejection');
})().catch(e => { console.error(e); process.exitCode = 1; });
