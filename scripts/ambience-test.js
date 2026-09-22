#!/usr/bin/env node
/* ambience-test.js — the promises the ambience library makes, held to
 *
 * Not part of the site: scripts/ is excluded from the deploy and from what the
 * native apps bundle. It loads the real js/selectable.js, js/ambience.js and
 * js/builder.js into a sandbox over a small fake DOM and a fake Web Audio, and
 * checks the five things that are easy to break and hard to notice:
 *
 *   1. AUDITIONING IS NOT CHOOSING. Tapping through the library does not
 *      change what the session is set to. Only the confirm button does.
 *   2. THE HIGHLIGHT SURVIVES. The chosen card keeps its ring the whole way
 *      through an audition, a re-render and a trip to another step — derived
 *      from state.bg on every paint, per js/selectable.js.
 *   3. ONE TRACK AT A TIME. However fast you switch, exactly one source is
 *      audible afterwards, the old one is stopped rather than merely faded,
 *      and a slow decode that lands after you moved on connects nothing.
 *   4. NOTHING REGENERATES THE VOICE. Changing the ambience, the frequency or
 *      the session length does not reach the speech provider.
 *   5. THE LOOP HAS NO SEAM AND NO JUMP. Decoder padding is trimmed off the
 *      loop points, and a track that arrives at the wrong level is corrected.
 *
 *   npm run test:ambience
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');

let fails = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(got)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
}
function section(t){ console.log(`\n--- ${t} ---`); }

/* ---------------- the smallest DOM this code can run on ----------------
   The same shape as scripts/voice-routing-test.js, with the handful of extras
   the ambience picker needs: toggleAttribute, and <select>/<optgroup>. */
class El {
  constructor(tag){
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.dataset = {}; this.style = {}; this.attrs = {};
    this._classes = new Set(); this.textContent = ''; this._html = '';
    this.disabled = false; this.checked = false; this.value = '';
    this.parentElement = null; this.onclick = null; this.onchange = null;
    this.classList = {
      add: (...c) => c.forEach(x => this._classes.add(x)),
      remove: (...c) => c.forEach(x => this._classes.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !this._classes.has(c) : !!on;
                           v ? this._classes.add(c) : this._classes.delete(c); return v; },
      contains: (c) => this._classes.has(c),
    };
  }
  get className(){ return Array.from(this._classes).join(' '); }
  set className(v){ this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML(){ return this._html; }
  set innerHTML(v){ this._html = String(v); this.children.forEach(c => doc._forget(c)); this.children = []; }
  setAttribute(k, v){ this.attrs[k] = String(v); }
  getAttribute(k){ return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k){ delete this.attrs[k]; }
  toggleAttribute(k, on){ const v = on === undefined ? !(k in this.attrs) : !!on;
                          if (v) this.attrs[k] = ''; else delete this.attrs[k]; return v; }
  hasAttribute(k){ return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  appendChild(c){ c.parentElement = this; this.children.push(c); doc._register(c); return c; }
  querySelector(sel){ return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel){ return doc._match(sel, this._descendants()); }
  _descendants(){ const out = []; const walk = (n) => n.children.forEach(c => { out.push(c); walk(c); }); walk(this); return out; }
  scrollIntoView(){} focus(){} click(){ if (this.onclick) this.onclick(); }
  addEventListener(){} removeEventListener(){}
  get offsetParent(){ return this.style.display === 'none' ? null : (this.parentElement || null); }
  get offsetWidth(){ return 100; }
  closest(sel){ let n = this; while (n){ if (doc._matchOne(sel, n)) return n; n = n.parentElement; } return null; }
  matches(sel){ return doc._matchOne(sel, this); }
}

const doc = {
  _all: [], _byId: new Map(),
  body: null,
  _register(el){ if (!this._all.includes(el)) this._all.push(el); if (el.attrs.id) this._byId.set(el.attrs.id, el); },
  _forget(el){ const i = this._all.indexOf(el); if (i >= 0) this._all.splice(i, 1);
               el.children.forEach(c => this._forget(c)); },
  createElement(tag){ const el = new El(tag); Object.defineProperty(el, 'id', {
      get(){ return el.attrs.id || ''; }, set(v){ el.attrs.id = v; doc._byId.set(v, el); } }); return el; },
  getElementById(id){ return this._byId.get(id) || null; },
  _matchOne(sel, el){
    return sel.split(',').map(s => s.trim()).filter(Boolean).some(part => {
      const simple = part.split(/\s+/).pop();
      return this._simple(simple, el);
    });
  },
  _simple(sel, el){
    const m = sel.match(/^([a-zA-Z]*)((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/);
    if (!m) return false;
    const [, tag, idcls, attrs] = m;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    for (const tok of (idcls.match(/[#.][\w-]+/g) || [])){
      if (tok[0] === '#'){ if (el.attrs.id !== tok.slice(1)) return false; }
      else if (!el._classes.has(tok.slice(1))) return false;
    }
    for (const a of (attrs.match(/\[[^\]]+\]/g) || [])){
      const inner = a.slice(1, -1);
      const eq = inner.match(/^([\w-]+)="?([^"]*)"?$/);
      if (eq){
        const key = eq[1];
        const val = key.startsWith('data-') ? el.dataset[key.slice(5).replace(/-(\w)/g, (_,c)=>c.toUpperCase())] : el.attrs[key];
        if (String(val) !== eq[2]) return false;
      } else if (el.attrs[inner] === undefined && el.dataset[inner] === undefined) return false;
    }
    return true;
  },
  _match(sel, pool){
    const out = [];
    for (const part of sel.split(',').map(s => s.trim()).filter(Boolean)){
      const chain = part.split(/\s+/);
      for (const el of pool){
        if (!this._simple(chain[chain.length - 1], el)) continue;
        let ok = true, n = el.parentElement;
        for (let i = chain.length - 2; i >= 0; i--){
          let found = false;
          while (n){ if (this._simple(chain[i], n)){ found = true; n = n.parentElement; break; } n = n.parentElement; }
          if (!found){ ok = false; break; }
        }
        if (ok && !out.includes(el)) out.push(el);
      }
    }
    return out;
  },
  querySelector(sel){ return this._match(sel, this._all)[0] || null; },
  querySelectorAll(sel){ return this._match(sel, this._all); },
  addEventListener(){}, removeEventListener(){},
};
doc.body = doc.createElement('body'); doc._register(doc.body);
function mk(id){ const el = doc.createElement('div'); if (id) el.id = id; doc.body.appendChild(el); return el; }

/* ---------------- the smallest Web Audio this code can run on ----------------
   Every node records what happened to it, which is the whole point: the
   questions this file asks are "is anything still connected", "was the old
   source stopped", "what gain did the new one end up at". */
let audioLog = [];
function fakeParam(){
  const p = { value: 0, _curves: [] };
  p.cancelScheduledValues = () => {};
  p.setValueAtTime = (v) => { p.value = v; };
  p.setValueCurveAtTime = (curve, at, dur) => { p._curves.push({ curve: Array.from(curve), at, dur });
                                                p.value = curve[curve.length - 1]; };
  p.linearRampToValueAtTime = (v) => { p.value = v; };
  p.exponentialRampToValueAtTime = (v) => { p.value = v; };
  return p;
}
function FakeCtx(){
  this.currentTime = 0;
  this.sampleRate = 44100;
  this.state = 'running';
  this.destination = { _tag: 'destination' };
  this._sources = [];
}
FakeCtx.prototype.createGain = function(){
  const n = { _tag:'gain', gain: fakeParam(), _connected: [], _disconnected: false };
  n.connect = (t) => { n._connected.push(t); return t; };
  n.disconnect = () => { n._disconnected = true; };
  return n;
};
FakeCtx.prototype.createBufferSource = function(){
  const ctx = this;
  const n = { _tag:'source', buffer:null, loop:false, loopStart:0, loopEnd:0,
              _started:null, _stopped:null, _connected:[], _disconnected:false };
  n.connect = (t) => { n._connected.push(t); return t; };
  n.disconnect = () => { n._disconnected = true; };
  n.start = (when, offset) => { n._started = { when, offset }; audioLog.push(`start:${n._key}`); };
  n.stop = (when) => { if (n._stopped === null) n._stopped = when === undefined ? 'now' : when;
                       audioLog.push(`stop:${n._key}`); };
  ctx._sources.push(n);
  return n;
};
FakeCtx.prototype.createBuffer = function(ch, len, rate){
  const data = Array.from({ length: ch }, () => new Float32Array(len));
  return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (i) => data[i] };
};
FakeCtx.prototype.createBiquadFilter = function(){
  const n = { _tag:'filter', type:'', frequency:fakeParam(), Q:fakeParam() };
  n.connect = (t) => t; n.disconnect = () => {};
  return n;
};
FakeCtx.prototype.createOscillator = function(){
  const n = { _tag:'osc', type:'', frequency:fakeParam(), start(){}, stop(){} };
  n.connect = (t) => t; n.disconnect = () => {};
  return n;
};
FakeCtx.prototype.createStereoPanner = function(){
  const n = { _tag:'panner', pan:fakeParam() }; n.connect = (t) => t; n.disconnect = () => {}; return n;
};
FakeCtx.prototype.createMediaStreamDestination = function(){ return { stream:{}, _tag:'msd' }; };
FakeCtx.prototype.resume = function(){ return Promise.resolve(); };
FakeCtx.prototype.close = function(){ this.state = 'closed'; return Promise.resolve(); };
FakeCtx.prototype.decodeAudioData = function(){ throw new Error('decode goes through the stub below'); };

/* An AudioBuffer shaped like a real decoded mp3: a few milliseconds of encoder
   padding at each end, and a body at a level the test chooses. */
function fakeClip(ctx, { seconds = 8, padMs = 26, level = 0.072 } = {}){
  const rate = ctx.sampleRate;
  const len = Math.floor(seconds * rate);
  const pad = Math.floor((padMs / 1000) * rate);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++){
    const d = buf.getChannelData(c);
    for (let i = pad; i < len - pad; i++) d[i] = (i % 2 ? level : -level) * 1.0;
  }
  return { buffer: buf, pad, len };
}

const IDS = ['flowProgress','freqChips','intentionChips','toneChips','countRange','countVal',
  'eftPointsList','bgGrid','waveform','recBtn','freqGuideText','toStep1','toStep5','quizGoal',
  'sessionLengthSlider','sessionLengthVal','lengthMsg','durationChips','ritualModeChips',
  'ritualModeMsg','eftGuidePanel','visualizationGuidePanel','countRow','sessionLengthRow',
  'soothingChips','soothingMsg','soothingMixRow','binauralChips','binauralGuideText',
  'customTrackName','customTrackMsg','customMixRow','customTrackFile','layerVoiceToggle',
  'layerVoicePanel','layerAffText','layerVoiceMsg','layerVoiceMixRow','paceChips','lineGap',
  'lineGapVal','mixTone','mixToneVal','mixBg','mixBgVal','mixVoice','mixVoiceVal','mixSoothing',
  'mixSoothingVal','mixCustom','mixCustomVal','mixLayerVoice','mixLayerVoiceVal',
  'affList','affListMsg','addAffBtn','regenerateBtn',
  'voiceOwn','voiceSerenity','voiceClone','myVoicePanel','voicePreview','voicePickerMsg',
  'serenityPreviewBtn','recCounter','recLine','recTapHint','recStatus','nextLineBtn','skipBtn',
  'finalTitle','finalLine','finalNote','rerecordBtn','finalTitleInput','finalTitleMsg',
  'finalPointTag','sessionTarget','reviewSub','lockSoothing','lockCustomTrack','lockLayerVoice',
  'finalFreqPicker','finalFreqSelect','finalAmbiencePicker','finalAmbienceSelect',
  'ambienceConfirmBtn','ambienceConfirmNote','ambienceMsg','finalPlayBtn','stopBtn','loopToggle',
  'sessionProgress','sessionProgressFill','sessionElapsed','sessionRemaining','saveMsg',
  'flowSteps','recordFlowTitle','recordFlowSub','recordBreathNote'];
IDS.forEach(id => mk(id));
for (let i = 0; i < 8; i++){
  const el = doc.createElement('div'); el.className = 'flow-step';
  el.dataset.step = String(i); el.setAttribute('data-step', String(i));
  doc.body.appendChild(el);
}
doc.getElementById('voiceOwn').className = 'voice-card';
doc.getElementById('voiceClone').className = 'voice-card';
doc.getElementById('voiceSerenity').className = 'voice-card voice-card-split';
const previewEl = doc.getElementById('voicePreview');
previewEl.paused = true; previewEl.pause = () => { previewEl.paused = true; };
previewEl.play = () => Promise.resolve();
doc.getElementById('countRange').value = '14';
doc.getElementById('sessionLengthSlider').value = '5';
['mixTone','mixBg','mixVoice','mixSoothing','mixCustom','mixLayerVoice'].forEach(id => {
  doc.getElementById(id).value = '50';
});
const realQS = doc.querySelector.bind(doc);
doc.querySelector = (sel) => {
  const m = sel.match(/^\.flow-step\[data-step="(\d+)"\]$/);
  if (m) return doc.querySelectorAll('.flow-step').find(e => e.dataset.step === m[1]) || null;
  return realQS(sel);
};

/* ---------------- the world outside ---------------- */
const timers = [];
let ttsCalls = [];          // every request that would have reached the provider
let fetchCalls = [];        // every fetch, so ambience downloads are visible too
let decodeQueue = [];       // decodes waiting to be resolved, so races can be staged

const ctx = {
  console,
  document: doc,
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node', mediaDevices: {} },
  location: { href: 'https://subliminally.test/', origin: 'https://subliminally.test' },
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  clearTimeout(){}, setInterval(){}, clearInterval(){},
  requestAnimationFrame: (fn) => timers.push({ fn, ms: 0 }),
  fetch: async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/api/tts')) ttsCalls.push(String(url));
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64),
             json: async () => ({}), text: async () => '' };
  },
  Date, Math, JSON, Set, Map, Object, Array, Promise, String, Number, Boolean, Error,
  Float32Array, Uint8Array, ArrayBuffer,
  URL, TextEncoder, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  AudioContext: FakeCtx,
  speechSynthesis: { cancel(){}, speak(){} },
  SpeechSynthesisUtterance: function(){},
  Audio: function(){ this.play = () => Promise.resolve(); this.pause = () => {};
                     this.setAttribute = () => {}; this.addEventListener = () => {}; },
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

vm.runInContext(`
  var sb = null;
  var currentUser = { id: 'user-under-test' };
  var API_BASE = '';
  var AVATAR_PACK = [];
  var __tier = 'ritual';
  async function getMyTier(){ return __tier; }
  function tierHasFeature(){ return true; }
  function tierAtLeast(){ return true; }
  function openUpgradeModal(){}
  function lockedControl(){} function lockSlot(){}
  function applyModeCopy(){}
  function mountVoiceClone(){} function unmountVoiceClone(){}
  function speakWithDeviceVoice(){} async function previewVoice(){}
  function forgetFetch(){} function showBuildPage(){}
  function awardLight(){}
  var LIGHT_SOURCES = { subliminal: 'subliminal' };
  var libraryNowPlayingId = null, todaySubs = [], todaySubChosen = null;
  var TIER_LABEL = { ritual:'Ritual', free:'Free', none:'Free' };
  var MediaRecorder = undefined;
`, ctx);

for (const f of ['js/selectable.js', 'js/ambience.js', 'js/builder.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

/* Speech is stubbed out AFTER builder.js, because builder.js declares these
   itself. Nothing in this file may reach the provider; the counter above is
   what proves it. */
vm.runInContext(`
  loadVoiceCatalogue = async function(){
    return { presets: FALLBACK_PRESET_VOICES, myVoice: null, consentStatement:'', provider:null, loaded:true };
  };
  myVoiceProfile = async function(){ return null; };
  previewVoice = async function(){};
  speakWithDeviceVoice = function(){};
  prepareSequenceAudio = async function(){ __voicePrepCount++; return { ok:true }; };
  var __voicePrepCount = 0;
`, ctx);

const run = (src) => vm.runInContext(src, ctx);
const get = (expr) => vm.runInContext(`(${expr})`, ctx);
async function settle(){
  for (let i = 0; i < 20; i++) await Promise.resolve();
  while (timers.length){ const t = timers.shift(); t.fn(); }
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/* The decode stub. Each call is parked so the test can decide when — and in
   what order — it finishes, which is the only way to stage the race that puts
   two tracks on the speaker at once. */
function stubDecode(theCtx, opts){
  theCtx.decodeAudioData = function(){
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    const clip = fakeClip(theCtx, opts);
    clip.buffer._key = 'clip' + decodeQueue.length;
    decodeQueue.push(() => resolve(clip.buffer));
    return p;
  };
}
/* The fetch has to finish before decodeAudioData is even called, so this
   settles first and keeps going until nothing new turns up — otherwise it
   looks at an empty queue and returns before any audio exists. */
async function flushDecodes(){
  for (let pass = 0; pass < 10; pass++){
    await settle();
    if (!decodeQueue.length) break;
    while (decodeQueue.length){ decodeQueue.shift()(); await settle(); }
  }
}

const bgKey = () => get('state.bg');
const candidate = () => get('ambienceCandidate');
const cardSelected = (key) => get(`!!document.querySelector('#bgGrid .bg-card[data-key="${key}"]').classList.contains('sel')`);
const cardAuditioning = (key) => get(`document.querySelector('#bgGrid .bg-card[data-key="${key}"]').hasAttribute('data-auditioning')`);
const faceAria = (key) => get(`document.querySelector('#bgGrid .bg-card-face[data-key="${key}"]').getAttribute('aria-checked')`);
const confirmLabel = () => get(`document.getElementById('ambienceConfirmBtn').textContent`);
const confirmDisabled = () => get(`document.getElementById('ambienceConfirmBtn').disabled`);

(async () => {

/* ============================================================ */
section('the library is drawn, grouped, off js/ambience.js');
check('every recorded track has a card',
  get(`AMBIENCE_TRACKS.every(t => !!document.querySelector('#bgGrid .bg-card[data-key="' + t.key + '"]'))`), true);
check('the five display names', get(`AMBIENCE_TRACKS.map(t => t.name)`),
  ['Deep Mind','The Sanctuary','Ocean Escape','Soft ASMR','Inner Stillness']);
check('their categories', get(`AMBIENCE_TRACKS.map(t => t.category)`),
  ['Meditation','Ambient','Nature','Sleep','Meditation']);
check('the generated backgrounds are still there',
  get(`AMBIENCE_SYNTH.every(t => !!document.querySelector('#bgGrid .bg-card[data-key="' + t.key + '"]'))`), true);
/* In DOM order, which is category order: both Meditation tracks, then
   Ambient, Nature, Sleep — the shelf, grouped. */
check('only recorded tracks get a play button, and they are grouped',
  get(`Array.from(document.querySelectorAll('#bgGrid .bg-preview-btn')).map(b => b.dataset.key)`),
  ['deep-mind','inner-stillness','the-sanctuary','ocean-escape','soft-asmr']);
check('a bundled copy is the fallback when Supabase has not answered',
  get(`ambienceUrl('ocean-escape')`), 'audio/ambience/ocean-escape.mp3');
run(`window.AMBIENCE_URLS = { 'ocean-escape': 'https://cdn.test/ocean.mp3' };`);
check('a stored URL wins once it has', get(`ambienceUrl('ocean-escape')`), 'https://cdn.test/ocean.mp3');
run(`window.AMBIENCE_URLS = {};`);

/* ============================================================ */
section('auditioning is not choosing');
run(`state.bg = 'none'; ambienceCandidate = null; paintBgCards();`);
stubDecode(get('previewCtx') || new FakeCtx());
run(`document.querySelector('#bgGrid .bg-card-face[data-key="ocean-escape"]').onclick();`);
await settle();
check('tapping a card does NOT change the session', bgKey(), 'none');
check('it does mark what is being listened to', candidate(), 'ocean-escape');
check('and draws it as auditioning, not as chosen',
  [cardAuditioning('ocean-escape'), cardSelected('ocean-escape')], [true, false]);
check('the chosen card is still the chosen card', cardSelected('none'), true);
check('the button says what it would do', confirmLabel(), 'Use Ocean Escape');

run(`document.querySelector('#bgGrid .bg-card-face[data-key="soft-asmr"]').onclick();`);
await settle();
check('auditioning a second one still changes nothing', bgKey(), 'none');
check('only one card auditions at a time',
  get(`document.querySelectorAll('#bgGrid .bg-card').filter(c => c.hasAttribute('data-auditioning')).map(c => c.dataset.key)`),
  ['soft-asmr']);

run(`confirmAmbience();`);
await settle();
check('confirming is the only thing that answers the question', bgKey(), 'soft-asmr');
check('and the ring moves with it', [cardSelected('soft-asmr'), cardSelected('none')], [true, false]);
check('the face carries the state for a screen reader', faceAria('soft-asmr'), 'true');
check('the other faces say so too', faceAria('ocean-escape'), 'false');
check('with nothing pending, the button is inert', [confirmLabel(), confirmDisabled()],
  ['Using Soft ASMR', true]);

/* ============================================================ */
section('the highlight is re-derived, never painted at the tap site');
run(`renderBgGrid();`);     // the whole grid thrown away and rebuilt
check('a full re-render keeps the chosen card lit', cardSelected('soft-asmr'), true);
run(`showStep(4); showStep(5);`);
await settle();
check('leaving and coming back keeps it lit', cardSelected('soft-asmr'), true);
check('and re-opens with it as the candidate, so nothing is half-answered',
  candidate(), 'soft-asmr');
run(`clearSelection('.sel'); paintBgCards();`);
check('even a hostile clear is undone by the next paint', cardSelected('soft-asmr'), true);

/* ============================================================ */
section('one ambience at a time, however fast you switch');
run(`state.bg = 'ocean-escape'; ambienceCandidate = null;
     document.getElementById('mixBg').value = '50';
     state.affirmations = ['I rest.']; state.voiceMode = 'ai'; state.aiVoiceId = 'serenity';
     finalPlaying = false;`);
const sessionCtx = new FakeCtx();
stubDecode(sessionCtx);
ctx.__sessionCtx = sessionCtx;
run(`finalCtx = __sessionCtx; sessionBed.attach(__sessionCtx, __sessionCtx.destination);`);
run(`sessionBed.to('ocean-escape', { fade: 1 });`);
await flushDecodes();
check('one source is playing', sessionCtx._sources.filter(s => s._started && s._stopped === null).length, 1);
const first = sessionCtx._sources[0];
check('it loops', first.loop, true);
check('it starts inside the loop window, past the encoder padding',
  first._started.offset > 0 && Math.abs(first._started.offset - first.loopStart) < 1e-9, true);

run(`sessionBed.to('soft-asmr', { fade: 1 });`);
run(`sessionBed.to('deep-mind', { fade: 1 });`);
run(`sessionBed.to('inner-stillness', { fade: 1 });`);
await flushDecodes();
const live = sessionCtx._sources.filter(s => s._started && s._stopped === null);
check('after three switches in a row, exactly one source is still running', live.length, 1);
check('and it is the one that was asked for last', get(`sessionBed.key`), 'inner-stillness');
check('every earlier source was stopped, not just faded',
  sessionCtx._sources.filter(s => s._started).length - live.length >= 1, true);
check('the one still running is at full fade gain',
  Math.abs(live[0]._connected[0].gain.value - 1) < 1e-6 ||
  Math.abs(live[0]._connected[0]._connected[0].gain.value - 1) < 1e-6, true);

/* A decode that comes back late, after the switch it belonged to was
   abandoned, must connect nothing at all. */
run(`sessionBed.to('ocean-escape', { fade: 1 });`);   // this decode is parked
run(`sessionBed.to('deep-mind', { fade: 1 });`);      // and immediately superseded
const before = sessionCtx._sources.filter(s => s._started).length;
await flushDecodes();
const after = sessionCtx._sources.filter(s => s._started && s._stopped === null);
check('a stale decode does not put a second track on the speaker', after.length, 1);
check('and the last answer is the one playing', get(`sessionBed.key`), 'deep-mind');

/* ============================================================ */
section('the mixer moves the bed, not one track inside it');
run(`applyLiveMixGain('mixBg', 20);`);   // not playing: ignored, as before
run(`finalPlaying = true; applyLiveMixGain('mixBg', 20);`);
check('the level lands on the bed', get(`sessionBed.level`), 0.2);
check('and on the node everything goes through', get(`sessionBed.out.gain.value`), 0.2);
run(`sessionBed.to('soft-asmr', { fade: 1 });`);
await flushDecodes();
check('a switch underneath it does not reset the slider', get(`sessionBed.out.gain.value`), 0.2);
run(`finalPlaying = false;`);

/* ============================================================ */
section('nothing about a background, a frequency or a length regenerates a voice');
run(`__voicePrepCount = 0;`); ttsCalls = []; fetchCalls = [];
run(`state.freq = FREQS[5];`);
run(`changeSessionAmbience('the-sanctuary');`);
run(`changeSessionAmbience('ocean-escape');`);
await settle();
check('changing the ambience never reaches the provider', ttsCalls.length, 0);
check('and never re-prepares the voice', get(`__voicePrepCount`), 0);
check('but it does change the answer', bgKey(), 'ocean-escape');

run(`changeFinalFrequency('432');`);
await settle();
check('changing the frequency never reaches the provider', ttsCalls.length, 0);
check('and never re-prepares the voice', get(`__voicePrepCount`), 0);
check('but it does change the answer', get(`state.freq.hz`), 432);

for (const minutes of [20, 60, 240, 480]) { run(`pickDuration(${minutes});`); await settle(); }
run(`document.getElementById('sessionLengthSlider').value = '37'; onSessionLengthInput();`);
await settle();
check('every session length leaves the voice alone', [ttsCalls.length, get(`__voicePrepCount`)], [0, 0]);
check('20 min, 1 hr, 4 hr, 8 hr and a custom length all land',
  get(`state.targetLengthMinutes`), 37);
/* Something WAS fetched — an ambience mp3, warmed so that pressing play does
   not wait on a download. What matters is what was not: nothing in any of that
   went to an API route, so nothing could have cost a generation. */
check('nothing in any of that called an API route',
  fetchCalls.filter(u => u.includes('/api/')), []);
check('the only thing fetched was static ambience audio',
  fetchCalls.every(u => u.startsWith('audio/ambience/') || u.includes('/ambience/')), true);

/* ============================================================ */
section('the loop, and the level');
const probe = new FakeCtx();
const padded = fakeClip(probe, { seconds: 8, padMs: 26, level: 0.072 });
const read = get(`analyseAmbience`);
const measured = read(padded.buffer);
check('the loop starts after the encoder padding', measured.loopStart > 0.02, true);
check('and ends before the padding at the other end', measured.loopEnd < 8 - 0.02, true);
check('a loop long enough to be worth looping', measured.loopEnd - measured.loopStart > 7.9, true);
check('a track already at the house level is left alone',
  Math.abs(measured.gain - 1) < 0.02, true);

const loud = fakeClip(probe, { seconds: 8, padMs: 26, level: 0.36 });   // five times too loud
const quiet = fakeClip(probe, { seconds: 8, padMs: 26, level: 0.012 }); // six times too quiet
const loudGain = read(loud.buffer).gain, quietGain = read(quiet.buffer).gain;
check('a track that arrives too loud is brought down', loudGain < 0.25, true);
check('a track that arrives too quiet is brought up', quietGain > 3, true);
check('and both end up at the same level as each other',
  Math.abs((0.36 * loudGain) - (0.012 * quietGain)) < 0.005, true);

/* ============================================================ */
section('the short clips, and the long night');
const masters = fs.readdirSync(path.join(root, 'audio', 'ambience')).filter(f => f.endsWith('.mp3'));
check('five masters ship with the site', masters.length, 5);
check('one per track in the catalogue',
  get(`AMBIENCE_TRACKS.map(t => t.file)`).every(f => masters.includes(f)), true);
const totalKb = masters.reduce((n, f) => n + fs.statSync(path.join(root, 'audio', 'ambience', f)).size, 0) / 1024;
check('the whole library is smaller than one minute of speech would be', totalKb < 2048, true);
check('there is no multi-hour file anywhere',
  masters.every(f => fs.statSync(path.join(root, 'audio', 'ambience', f)).size < 700 * 1024), true);
/* An eight-hour session out of an eight-second clip is 3,580 passes. Nothing
   schedules them: loop=true is handled in the audio thread, which is what
   makes a backgrounded tab — where timers are throttled to once a minute —
   unable to starve it. */
check('looping is left to the audio thread, so no timer can starve it',
  get(`sessionBed.voice ? sessionBed.voice.src.loop : null`), true);

console.log(fails ? `\n${fails} failed.` : '\nAll good.');
process.exit(fails ? 1 : 0);
})();
