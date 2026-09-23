#!/usr/bin/env node
/* voice-routing-test.js — whose voice you chose, and where that takes you

   Not part of the site: scripts/ is excluded from the deploy and from what the
   native apps bundle. It loads the real js/selectable.js and js/builder.js into
   a sandbox over a small fake DOM, with the plan check, the voice catalogue and
   every network call stubbed, and walks the three voice paths end to end.

   The two bugs it pins, which turned out to be one bug:

     * Choosing Serenity (or a cloned voice) and then picking a background on
       the ambience step landed in the manual, affirmation-by-affirmation
       recorder. Step 5's Continue called startNextPhase() — the fork — but the
       background cards called nextStep(), and nextStep() was step+1, and step+1
       from the ambience step is the recorder, for everybody.

     * On that screen the first affirmation read "..." under a correct-looking
       a hard-coded count. Both were placeholders in index.html: arriving without
       going through the fork meant showRecordLine() never ran, so nothing was
       ever drawn over them. Never an off-by-one — recIndex is 0 and lines[0] is
       line one — simply never called.

   And the selection rule the whole app is now held to: a tap paints the answer
   in the same tick, a refused tap leaves the screen showing the truth, and the
   highlight is re-derived on every render rather than painted at the tap site.

     npm run test:voice-routing
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

/* ---------------- the smallest DOM this code can run on ---------------- */
class El {
  constructor(tag){
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.dataset = {}; this.style = {}; this.attrs = {};
    this._classes = new Set(); this.textContent = ''; this._html = '';
    this.disabled = false; this.checked = false; this.value = '';
    this.parentElement = null; this.onclick = null;
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
  set innerHTML(v){ this._html = String(v); this.children = []; }
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

/* Selectors are matched by hand: only the handful of shapes this codebase
   actually writes (#id, .class, tag, and a descendant chain of those) are
   supported, which is plenty and keeps the harness honest about what it tests. */
const doc = {
  _all: [], _byId: new Map(),
  body: null,
  _register(el){ this._all.push(el); if (el.attrs.id) this._byId.set(el.attrs.id, el); },
  createElement(tag){ const el = new El(tag); Object.defineProperty(el, 'id', {
      get(){ return el.attrs.id || ''; }, set(v){ el.attrs.id = v; doc._byId.set(v, el); } }); return el; },
  getElementById(id){ return this._byId.get(id) || null; },
  _matchOne(sel, el){
    return sel.split(',').map(s => s.trim()).filter(Boolean).some(part => {
      // only the right-most simple selector; ancestors are checked by the caller
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

function mk(id, cls, parent){
  const el = doc.createElement('div');
  if (id) el.id = id;
  if (cls) el.className = cls;
  (parent || doc.body).appendChild(el);
  return el;
}

/* Everything builder.js reaches for, by id, at load and during the flow. */
const IDS = ['flowProgress','freqChips','intentionChips','toneChips','countRange','countVal',
  'eftPointsList','bgGrid','waveform','recBtn','freqGuideText','toStep1','toStep5','quizGoal',
  'sessionLengthSlider','sessionLengthVal','lengthMsg','durationChips','ritualModeChips',
  'ritualModeMsg','eftGuidePanel','visualizationGuidePanel','countRow','sessionLengthRow',
  'soothingChips','soothingMsg','soothingMixRow','binauralChips','binauralGuideText',
  'customTrackName','customTrackMsg','customMixRow','customTrackFile','layerVoiceToggle',
  'layerVoicePanel','layerAffText','layerVoiceMsg','layerVoiceMixRow','paceChips','lineGap',
  'lineGapVal','mixTone','mixToneVal','affList','affListMsg','addAffBtn','regenerateBtn',
  'voiceOwn','voiceSerenity','voiceClone','myVoicePanel','voicePreview','voicePickerMsg',
  'serenityPreviewBtn','recCounter','recLine','recTapHint','recStatus','nextLineBtn','skipBtn',
  'finalTitle','finalLine','finalNote','rerecordBtn','finalTitleInput','finalTitleMsg',
  'finalPointTag','sessionTarget','reviewSub','lockSoothing','lockCustomTrack','lockLayerVoice',
  'finalFreqPicker','flowSteps','recordFlowTitle','recordFlowSub','recordBreathNote',
  'finalAmbiencePicker','finalAmbienceSelect','ambienceConfirmBtn','ambienceRemoveBtn','ambienceConfirmNote',
  'ambienceMsg','mixBg','mixBgVal'];
IDS.forEach(id => mk(id));

/* The eight flow-step panels, so showStep() has something to switch between. */
for (let i = 0; i < 8; i++){
  const el = mk(null, 'flow-step', doc.body);
  el.dataset.step = String(i);
  el.setAttribute('data-step', String(i));
}
/* The voice cards are the shapes the picker expects: two buttons and a split. */
/* role="radio" on each card, exactly as index.html marks them — that is what
   decides whether setSelected writes aria-checked or aria-pressed. */
doc.getElementById('voiceOwn').className = 'voice-card';
doc.getElementById('voiceOwn').setAttribute('role', 'radio');
doc.getElementById('voiceClone').className = 'voice-card';
doc.getElementById('voiceClone').setAttribute('role', 'radio');
const serenityCard = doc.getElementById('voiceSerenity');
serenityCard.className = 'voice-card voice-card-split';
const face = doc.createElement('button'); face.className = 'voice-card-face';
face.setAttribute('role', 'radio');
face.appendChild(doc.createElement('h4')); face.appendChild(doc.createElement('p'));
serenityCard.appendChild(face);
serenityCard.appendChild(doc.createElement('h4'));
serenityCard.appendChild(doc.createElement('p'));
doc.getElementById('voiceClone').appendChild(doc.createElement('h4'));
doc.getElementById('voiceClone').appendChild(doc.createElement('p'));
/* The Serenity demo player. Nothing is ever played here; it just has to exist
   so stopSerenityPreview() can be called as steps change. */
const previewEl = doc.getElementById('voicePreview');
previewEl.paused = true; previewEl.ended = true; previewEl.currentTime = 0;
previewEl.pause = () => { previewEl.paused = true; };
previewEl.play = () => Promise.resolve();
doc.getElementById('countRange').value = '10';
doc.getElementById('sessionLengthSlider').value = '5';

/* showStep looks the panel up with a [data-step="n"] selector. */
const realQS = doc.querySelector.bind(doc);
doc.querySelector = (sel) => {
  const m = sel.match(/^\.flow-step\[data-step="(\d+)"\]$/);
  if (m) return doc.querySelectorAll('.flow-step').find(e => e.dataset.step === m[1]) || null;
  return realQS(sel);
};

/* ---------------- the world outside the builder ---------------- */
const store = new Map();
let tier = 'ritual';            // what the plan check answers
let myVoice = null;             // the cloned voice, once it exists
let upgradeModals = [];         // every paywall sheet that opened
const timers = [];              // setTimeout, run by hand so the test controls time

const ctx = {
  console,
  document: doc,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  navigator: { userAgent: 'node', mediaDevices: {} },
  location: { href: 'https://subliminally.test/', origin: 'https://subliminally.test' },
  setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
  clearTimeout(){}, setInterval(){}, clearInterval(){},
  requestAnimationFrame: (fn) => timers.push(fn),
  fetch: async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }),
  Date, Math, JSON, Set, Map, Object, Array, Promise, String, Number, Boolean, Error,
  URL, TextEncoder, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
vm.createContext(ctx);

/* Things builder.js expects other files to have declared. Defined before it
   loads, in the same scope, exactly as the real page's script order does. */
vm.runInContext(`
  var sb = null;
  var currentUser = { id: 'user-under-test' };
  var API_BASE = '';
  var AVATAR_PACK = [];
  var AMBIENCE_URLS = {};
  var __tier = 'ritual';
  var __myVoice = null;
  var __upgrades = [];
  async function getMyTier(){ return __tier; }
  function tierHasFeature(t, key){
    if (t === 'ritual') return true;
    if (t === 'none' || t === 'free') return false;
    return key === 'studio_voice';
  }
  function tierAtLeast(){ return __tier === 'ritual'; }
  function openUpgradeModal(key, opts){ __upgrades.push({ key, trigger: opts && opts.trigger }); }
  function lockedControl(){} function lockSlot(){}
  function applyModeCopy(){} function renderFinalFreqPicker(){}
  function updateSessionTimerLabel(){} function updateFinalPointTag(){}
  function prepareSessionVoice(){} function stopFinal(){}
  function mountVoiceClone(){} function unmountVoiceClone(){}
  function speakWithDeviceVoice(){} async function previewVoice(){}
  function forgetFetch(){} function showBuildPage(){}
  function restartSoothingLayer(){}
  var libraryNowPlayingId = null, todaySubs = [], todaySubChosen = null;
  var TIER_LABEL = { ritual:'Ritual', free:'Free', none:'Free' };
  var MediaRecorder = undefined;
`, ctx);

for (const f of ['js/selectable.js', 'js/ambience.js', 'js/builder.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

/* The voice catalogue is asked over the network on the real page; here it is a
   variable the test sets, so "have they cloned a voice yet" is a knob. */
vm.runInContext(`
  loadVoiceCatalogue = async function(){
    return { presets: FALLBACK_PRESET_VOICES, myVoice: __myVoice, consentStatement: '', provider: null, loaded: true };
  };
  myVoiceProfile = async function(){ return __myVoice; };
  /* builder.js declares these itself, so they are re-stubbed after it loads
     rather than before: nothing here plays audio or speaks. */
  previewVoice = async function(){};
  speakWithDeviceVoice = function(){};
`, ctx);

const run = (src) => vm.runInContext(src, ctx);
/* Choosing an ambience takes two presses now, and that is the point of the
   change: tapping a card auditions it and nothing else, and the confirm
   button is the only thing that answers the question. 'rain' is one of the
   generated backgrounds, so nothing here has to open a speaker.

   What these tests are still about is the fork out of step 5 — and the fork
   now hangs off the confirm rather than off the card. */
/* One sound no longer moves the screen on by itself -- there is room to layer
   a second -- so the pick is followed by Continue, which goes through the same
   fork (nextStep() from step 5 is startNextPhase()). */
const pickAmbience = (key) => vm.runInContext(
  `document.querySelector('#bgGrid .bg-card-face[data-key="${key}"]').onclick(); confirmAmbience(); if (step === 5) nextStep();`, ctx);
const get = (expr) => vm.runInContext(`(${expr})`, ctx);
async function settle(){
  // let the awaits inside the handlers resolve, then fire the 260ms advance
  for (let i = 0; i < 12; i++) await Promise.resolve();
  while (timers.length){ const fn = timers.shift(); fn(); }
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function setWorld(o){
  if ('tier' in o) run(`__tier = ${JSON.stringify(o.tier)};`);
  if ('myVoice' in o) run(`__myVoice = ${JSON.stringify(o.myVoice)};`);
  run(`__upgrades = [];`);
}
const upgrades = () => get('__upgrades');
const selected = (id) => get(`!!document.getElementById(${JSON.stringify(id)}).classList.contains('sel')`);
const aria = (id) => get(`document.getElementById(${JSON.stringify(id)}).getAttribute('aria-checked')`);
const step = () => get('step');
const recLine = () => get(`document.getElementById('recLine').textContent`);
const recCounter = () => get(`document.getElementById('recCounter').textContent`);

/* A build sitting on the voice step with all 10 affirmations behind it. */
const LINES = Array.from({ length: 10 }, (_, i) => `Affirmation number ${i + 1}.`);
function freshBuild(){
  run(`
    state.affirmations = ${JSON.stringify(LINES)};
    state.selectedVoice = null; state.voiceMode = null; state.aiVoiceId = null;
    state.eftMode = false; state.visualizationMode = false;
    state.bg = 'none';
    layerVoiceEnabled = false; layerVoiceMode = 'ai';
    recordings = []; layerRecordings = []; recIndex = 0; recordTarget = 'primary';
    document.getElementById('toStep5').disabled = true;
  `);
  store.clear();
  run(`showStep(4);`);
  while (timers.length) timers.shift();
}

(async () => {

/* ================= 1. RECORD YOUR OWN VOICE ================= */
section('Record your own voice');
setWorld({ tier: 'ritual', myVoice: null });
freshBuild();
run(`chooseVoice('own')`);
check('tapping the card selects it in the same tick', selected('voiceOwn'), true);
check('the other two go dark', [selected('voiceSerenity'), selected('voiceClone')], [false, false]);
check('and it says so to a screen reader', aria('voiceOwn'), 'true');
check('selectedVoice is the named answer', get('state.selectedVoice'), 'record_own');
check('voiceMode derives from it', get('state.voiceMode'), 'own');
check('Continue is enabled', get(`!document.getElementById('toStep5').disabled`), true);
await settle();
check('a pick moves on to ambience', step(), 5);

pickAmbience('rain');
await settle();
check('picking a background reaches the recorder', step(), 6);
check('the counter is drawn, not the placeholder', recCounter(), '1 of 10');
check('affirmation #1 is on screen immediately', recLine(), '"Affirmation number 1."');
check('no "..." anywhere', recLine().includes('...'), false);
check('recordings are sized to the lines', get('recordings.length'), 10);
check('index starts at zero', get('recIndex'), 0);
check('Next line is not available until something is recorded', get(`document.getElementById('nextLineBtn').disabled`), true);

run(`recordings[0] = { url:'blob:1' }; showRecordLine();`);
check('once recorded, Next line opens', get(`document.getElementById('nextLineBtn').disabled`), false);
run(`advanceLine()`);
check('line two is line two', [recCounter(), recLine()], ['2 of 10', '"Affirmation number 2."']);
run(`for (let i = 1; i < 10; i++) advanceLine();`);
check('after the tenth, on to assembly', step(), 7);

/* the Continue button, rather than a background tap */
freshBuild();
run(`chooseVoice('own')`); await settle();
run(`startNextPhase()`);
check('Continue on ambience reaches the recorder too', step(), 6);
check('and it is drawn', recLine(), '"Affirmation number 1."');

/* ================= 2. SERENITY ================= */
section('Serenity');
setWorld({ tier: 'ritual', myVoice: null });
freshBuild();
run(`chooseSerenity()`);
check('Serenity highlights before the plan check comes back', selected('voiceSerenity'), true);
await settle();
check('and stays highlighted after it', selected('voiceSerenity'), true);
check('Record your own voice is not highlighted', selected('voiceOwn'), false);
check('selectedVoice', get('state.selectedVoice'), 'serenity');
check('voiceMode / aiVoiceId', [get('state.voiceMode'), get('state.aiVoiceId')], ['ai', 'serenity']);
check('moved on to ambience', step(), 5);

pickAmbience('rain');
await settle();
check('THE BUG: a background tap must not open the recorder', step(), 7);
check('nothing was queued for recording', get('recordings.length'), 0);

freshBuild();
run(`chooseSerenity()`); await settle();
run(`startNextPhase()`);
check('Continue skips the recorder as well', step(), 7);
check('and Serenity is what it builds with', [get('state.voiceMode'), get('state.aiVoiceId')], ['ai', 'serenity']);

/* coming back to the step, and a refresh */
run(`showStep(4)`); await settle();
check('going back shows Serenity still chosen', selected('voiceSerenity'), true);
check('re-rendering does not lose it', (run(`renderVoiceCards(); paintVoiceCards();`), selected('voiceSerenity')), true);

const remembered = store.get('fthr_voice_choice');
check('the choice was written down', JSON.parse(remembered || 'null') && JSON.parse(remembered).choice, 'serenity');
run(`state.selectedVoice = null; state.voiceMode = null; state.aiVoiceId = null; paintVoiceCards();`);
check('a fresh page starts blank', selected('voiceSerenity'), false);
run(`restoreVoiceChoice()`); await settle();
check('a refresh restores Serenity, not record_own', get('state.selectedVoice'), 'serenity');
check('and lights the right card', selected('voiceSerenity'), true);

/* ================= 3. CLONE YOUR VOICE ================= */
section('Clone your voice — clone already made');
setWorld({ tier: 'ritual', myVoice: { name: 'My voice', provider_voice_id: 'v1' } });
freshBuild();
run(`chooseClonedVoice()`);
check('the card highlights immediately', selected('voiceClone'), true);
await settle();
check('it stays highlighted', selected('voiceClone'), true);
check('selectedVoice', get('state.selectedVoice'), 'clone_voice');
check('built with the clone', [get('state.voiceMode'), get('state.aiVoiceId')], ['ai', 'mine']);
check('moved on to ambience', step(), 5);
pickAmbience('rain');
await settle();
check('THE BUG: no manual recorder for a cloned voice', step(), 7);
check('nothing queued for recording', get('recordings.length'), 0);

section('Clone your voice — no clone yet');
setWorld({ tier: 'ritual', myVoice: null });
freshBuild();
run(`chooseClonedVoice()`); await settle();
check('the clone setup opens', get(`document.getElementById('myVoicePanel').dataset.open`), '1');
check('the card shows what they asked for', selected('voiceClone'), true);
check('but no voice is committed yet', [get('state.voiceMode'), get('state.aiVoiceId')], [null, null]);
check('so Continue stays shut', get(`document.getElementById('toStep5').disabled`), true);
check('and they are not in the recorder', step(), 4);

run(`startNextPhase()`);
check('forcing Continue sends them back to finish the clone, not to record', step(), 4);

setWorld({ tier: 'ritual', myVoice: { name: 'My voice', provider_voice_id: 'v1' } });
run(`onMyVoiceReady()`); await settle();
check('once the clone exists it is committed', [get('state.voiceMode'), get('state.aiVoiceId')], ['ai', 'mine']);
check('selectedVoice', get('state.selectedVoice'), 'clone_voice');
check('Continue opens', get(`document.getElementById('toStep5').disabled`), false);
run(`showStep(5); startNextPhase();`);
check('and it builds, without recording a line', step(), 7);

/* ================= 4. CLONE YOUR VOICE, PHASE 2 =================
   Generating the subliminal is the only thing that asks for speech. Play,
   pause, resume, start over, the mixer and reopening all replay what was made,
   and a failure is said out loud rather than read by the device instead. */
section('Clone your voice — generate once, then only replay');
['finalPlayBtn', 'mixVoice', 'mixLayerVoice', 'loopToggle'].forEach(id => { if (!doc.getElementById(id)) mk(id); });
['mixVoice', 'mixTone', 'mixBg', 'mixLayerVoice'].forEach(id => { doc.getElementById(id).value = '80'; });
doc.getElementById('loopToggle').checked = true;   // keep looping, as a set session length does

/* The server: every /api/tts request is recorded, and it answers like the real
   route — a line it has read before comes back from storage, only a new one
   costs an ElevenLabs generation. */
const ttsCalls = [];
const serverClips = new Set();
let elevenGenerations = 0;
let ttsFailWith = null;
ctx.fetch = async (url, o) => {
  if (!String(url).endsWith('/api/tts')) return { ok: false, status: 404, json: async () => ({}) };
  const body = JSON.parse(o.body);
  ttsCalls.push({ body, auth: o.headers.Authorization });
  if (ttsFailWith) return { ok: false, status: 502, json: async () => ({ error: ttsFailWith }) };
  const clips = body.lines.map((text, index) => {
    const cached = serverClips.has(text);
    if (!cached){ serverClips.add(text); elevenGenerations++; }
    return { index, text, url: `https://storage.test/${encodeURIComponent(text)}.mp3`, cached, error: null };
  });
  return { ok: true, status: 200, json: async () => ({ clips }) };
};

/* Audio, stubbed at the edges: a context that accepts anything, and clips that
   report what was played. The device voice counts every attempt to speak. */
run(`
  sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-owner' } } }) } };
  __device = 0; __played = []; __loads = 0; __ends = [];
  function __node(){
    const t = function(){};
    return new Proxy(t, {
      get(o, k){
        if (k === Symbol.toPrimitive) return () => 0;
        if (k === 'then') return undefined;
        if (k === 'state') return 'running';
        if (!(k in o)) o[k] = __node();
        return o[k];
      },
      set(o, k, v){ o[k] = v; return true; },
      apply(){ return __node(); },
    });
  }
  AudioContext = function(){ return __node(); };
  window.speechSynthesis = { speak(){ __device++; }, cancel(){}, pause(){}, resume(){} };
  SpeechSynthesisUtterance = function(t){ this.text = t; };
  speakWithDeviceVoice = function(){ __device++; };
  startSilentKeeper = function(){}; stopSilentKeeper = function(){};
  startCustomTrackPlayback = function(){};
  sessionBed.attach = sessionLayerBed.attach = function(){};
  sessionBed.setLevel = sessionLayerBed.setLevel = function(){};
  sessionBed.to = sessionLayerBed.to = function(){};
  sessionBed.detach = sessionLayerBed.detach = function(){};
  loadClip = async function(c, handle){ __loads++; return { url: handle.url }; };
  playClip = function(c, clip, gain, dest, onended){ __played.push(clip.url); __ends.push(onended); };
`);
const played = () => get('__played.slice()');
const device = () => get('__device');
const finalLine = () => get(`document.getElementById('finalLine').textContent`);
async function drain(rounds = 6){
  // let a few lines play through: end each clip, then run the gap timers
  for (let i = 0; i < rounds; i++){
    for (let j = 0; j < 12; j++) await Promise.resolve();
    run(`__ends.splice(0).forEach(f => f && f());`);
    while (timers.length){ const fn = timers.shift(); fn(); }
  }
  for (let j = 0; j < 12; j++) await Promise.resolve();
}

setWorld({ tier: 'ritual', myVoice: { name: 'My voice' } });
freshBuild();
// Whatever the sections above left in flight lands before the count starts.
await settle();
run(`ttsCache.clear(); sequencePrepares.clear(); clonedVoiceReadyKey = null;`);
ttsCalls.length = 0; serverClips.clear(); elevenGenerations = 0;
run(`chooseClonedVoice()`); await settle();
check('the saved voice is recognized and committed', [get('state.voiceMode'), get('state.aiVoiceId')], ['ai', 'mine']);
check('choosing it generated nothing', ttsCalls.length, 0);
/* The builder's five, with the blanks and stray spaces a person leaves behind. */
run(`state.affirmations = ['  I am calm.  ', '', 'I am   safe.', '   ', 'I rest easily.'];`);
run(`prepareSessionVoice()`); await settle();
check('generating asks the server once', ttsCalls.length, 1);
check('  ...for the saved voice by key, never an id', ttsCalls[0].body.voiceKey, 'mine');
check('  ...as the signed-in user', ttsCalls[0].auth, 'Bearer tok-owner');
check('  ...with trimmed lines and no blanks', ttsCalls[0].body.lines, ['I am calm.', 'I am safe.', 'I rest easily.']);
check('  ...and ElevenLabs read each line once', elevenGenerations, 3);
check('the subliminal is marked generated', get('clonedVoiceReadyKey === clonedSequenceKey()'), true);
run(`prepareSessionVoice()`); await settle();
check('generating the same words again asks for nothing', ttsCalls.length, 1);

run(`playFinal()`); await drain();
check('Play reaches the existing player', get('finalPlaying'), true);
check('  ...and plays the generated clone audio', played().slice(0, 2), [
  'https://storage.test/I%20am%20calm..mp3', 'https://storage.test/I%20am%20safe..mp3']);
check('  ...with no request made by Play', ttsCalls.length, 1);
run(`pauseFinal()`); await drain(2);
const pausedAt = played().length;
check('pause holds the voice', played().length, pausedAt);
run(`resumeFinal()`); await drain(2);
check('resume carries on', played().length > pausedAt, true);
run(`__played = []; stopFinal(); playFinal();`); await drain(1);
check('Start over plays again from the top', played()[0], 'https://storage.test/I%20am%20calm..mp3');
check('pause, resume and start over made no requests', ttsCalls.length, 1);
run(`document.getElementById('mixBg').value = '20'; document.getElementById('mixVoice').value = '40'; state.bg = 'rain'; state.bgLayer = 'none';`);
check('volume and nature changes leave it generated', get('clonedVoiceReadyKey === clonedSequenceKey()'), true);
run(`stopFinal(); playFinal();`); await drain(2);
check('  ...so playing again asks for nothing', ttsCalls.length, 1);
check('the device voice never spoke', device(), 0);
run(`stopFinal();`);

/* Reopening: a fresh page has nothing in hand, so the saved clips are asked for
   again — and the server answers them from storage, not from ElevenLabs. */
run(`ttsCache.clear(); sequencePrepares.clear(); clonedVoiceReadyKey = null;`);
run(`prepareSessionVoice()`); await settle();
check('reopening fetches the stored audio', ttsCalls.length, 2);
check('  ...without generating it again', elevenGenerations, 3);

/* Editing the words and generating again makes new speech for that line only. */
run(`state.affirmations[4] = 'I rest deeply.';`);
check('changed words mean it needs generating', get('clonedVoiceReadyKey === clonedSequenceKey()'), false);
run(`prepareSessionVoice()`); await settle();
check('  ...and only the changed line is generated', [ttsCalls[2].body.lines, elevenGenerations], [['I rest deeply.'], 4]);

/* A failure is shown, nothing else is played, and Play is the retry. */
run(`state.affirmations[0] = 'I am brave.'; __played = [];`);
ttsFailWith = 'network';
run(`playFinal()`); await drain(2);
check('a failed generation is not played', [get('finalPlaying'), played().length], [false, 0]);
check('  ...it says so', finalLine().includes('tap Play to try again'), true);
check('  ...and never falls back to the device voice', device(), 0);
check('  ...or to any other voice', ttsCalls.every(c => c.body.voiceKey === 'mine'), true);
ttsFailWith = null;
run(`playFinal()`); await drain(2);
check('Play after a failure retries, then plays', [get('finalPlaying'), played()[0]], [true, 'https://storage.test/I%20am%20brave..mp3']);
run(`stopFinal();`);

/* A clip that cannot be loaded stops the session with a message, not the device. */
run(`loadClip = async function(){ throw new Error('decode'); }; __played = [];`);
run(`playFinal()`); await drain(2);
check('an unplayable clip stops rather than substitutes', [get('finalPlaying'), device()], [false, 0]);
check('  ...and says so', finalLine().includes('tap Play to try again'), true);
run(`loadClip = async function(c, handle){ __loads++; return { url: handle.url }; };`);

/* No saved voice: back to the Phase 1 setup, nothing generated. */
setWorld({ tier: 'ritual', myVoice: null });
const before = ttsCalls.length;
run(`clonedVoiceReadyKey = null; showStep(7); prepareSessionVoice();`); await settle();
check('without a saved voice, nothing is generated', ttsCalls.length, before);
check('  ...and the voice setup opens instead', [step(), get(`document.getElementById('myVoicePanel').dataset.open`)], [4, '1']);
check('  ...still without the device voice', device(), 0);

/* ================= the paywall must not strand the screen ================= */
section('A refused tap leaves the screen telling the truth');
setWorld({ tier: 'free', myVoice: null });
freshBuild();
run(`chooseVoice('own')`); await settle();
check('record_own is free and selected', get('state.selectedVoice'), 'record_own');
run(`showStep(4)`);
run(`chooseClonedVoice()`);
check('the tap paints straight away', selected('voiceClone'), true);
await settle();
check('the paywall opened', upgrades().map(u => u.key), ['my_voice']);
check('the refused card reverts', selected('voiceClone'), false);
check('and what they actually have is still shown', selected('voiceOwn'), true);
check('state was never changed behind the paywall', get('state.selectedVoice'), 'record_own');

/* ================= the reusable pattern itself ================= */
section('The selection helper');
run(`
  __g = document.createElement('div'); __g.className='grp'; document.body.appendChild(__g);
  __a = document.createElement('button'); __a.dataset.key='a'; __a.className='chip'; __g.appendChild(__a);
  __b = document.createElement('button'); __b.dataset.key='b'; __b.className='chip'; __g.appendChild(__b);
  __c = document.createElement('button'); __c.dataset.key='c'; __c.className='chip'; __c.setAttribute('role','radio'); __g.appendChild(__c);
`);
run(`syncSelectionByData([__a,__b,__c], 'key', 'b')`);
check('single select lights exactly one', [get(`__a.classList.contains('sel')`), get(`__b.classList.contains('sel')`), get(`__c.classList.contains('sel')`)], [false, true, false]);
check('a plain button says aria-pressed', get(`__b.getAttribute('aria-pressed')`), 'true');
check('the unselected ones say so too', get(`__a.getAttribute('aria-pressed')`), 'false');
check('a radio says aria-checked', get(`__c.getAttribute('aria-checked')`), 'false');
run(`syncSelectionByData([__a,__b,__c], 'key', 'a')`);
check('choosing another moves the highlight', [get(`__a.classList.contains('sel')`), get(`__b.classList.contains('sel')`)], [true, false]);
run(`syncSelectionByDataIn([__a,__b,__c], 'key', ['a','c'])`);
check('multi-select keeps every chosen one lit', [get(`__a.classList.contains('sel')`), get(`__b.classList.contains('sel')`), get(`__c.classList.contains('sel')`)], [true, false, true]);
run(`clearSelection([__a,__b,__c])`);
check('clearing clears the class', get(`[__a,__b,__c].some(e => e.classList.contains('sel'))`), false);
check('and the ARIA with it', get(`__a.getAttribute('aria-pressed')`), 'false');

console.log(`\n${fails ? `${fails} FAILED` : 'all good'}`);
process.exit(fails ? 1 : 0);
})();
