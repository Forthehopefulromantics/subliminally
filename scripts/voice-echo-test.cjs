/* Voice echo: the model, persistence and layer independence (no audio device).
   Run:  npm run test:echo */
const assert = require('node:assert/strict');
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
let saves = 0;
global.queueMixSave = () => { saves++; };
const VE = require('../js/voice-echo.js');

// Defaults: every layer off.
VE.reset();
VE.LAYERS.forEach(l => assert.equal(VE.get(l).on, false, l + ' echo starts off'));
assert.deepEqual(VE.LAYERS, ['voice', 'layerVoice']);

// Clamping.
VE.set('voice', { delayMs: 5, mix: 400 });
assert.equal(VE.get('voice').delayMs, 100); assert.equal(VE.get('voice').mix, 100);
VE.set('voice', { delayMs: 99999, mix: -3 });
assert.equal(VE.get('voice').delayMs, 1000); assert.equal(VE.get('voice').mix, 0);
VE.set('voice', { delayMs: 'junk', mix: 'x' });
assert.equal(VE.get('voice').delayMs, VE.DEFAULT_DELAY_MS);

// Independence: a change on one layer never reaches the other.
VE.reset();
const before = JSON.stringify(VE.get('layerVoice'));
VE.set('voice', { on: true, mix: 80, delayMs: 700 });
assert.equal(JSON.stringify(VE.get('layerVoice')), before, 'layerVoice untouched by voice');
VE.set('layerVoice', { on: true, mix: 20, delayMs: 200 });
assert.deepEqual(VE.get('voice'), { on: true, mix: 80, delayMs: 700 });
assert.deepEqual(VE.get('layerVoice'), { on: true, mix: 20, delayMs: 200 });
assert.equal(VE.set('nope', { on: true }), null, 'unknown layer is ignored');
const copy = VE.get('voice'); copy.on = false;
assert.equal(VE.get('voice').on, true, 'get() hands out copies');

// No runaway feedback, any setting.
for (let mix = 0; mix <= 100; mix += 5) {
  const p = VE.paramsFor({ on: true, mix, delayMs: 500 });
  assert.ok(p.feedback <= VE.MAX_FEEDBACK && p.feedback <= 0.45, 'feedback capped at ' + mix);
  assert.ok(p.dry >= 0.7 && p.dry <= 1, 'dry stays audible');
  assert.ok(VE.peakGainEstimate({ on: true, mix, delayMs: 500 }) < 1.7, 'bounded headroom at ' + mix);
}
// Off restores the plain voice.
const off = VE.paramsFor({ on: false, mix: 100, delayMs: 900 });
assert.deepEqual([off.dry, off.send, off.wet, off.feedback], [1, 0, 0, 0]);

// Persistence: serialize -> open restores; newer copy wins; absent = off.
VE.reset();
VE.open('mix-1', null);
VE.set('voice', { on: true, mix: 55, delayMs: 420 });
assert.ok(saves > 0, 'a change asks for a save');
const account = VE.serialize();
VE.open('mix-2', null);
assert.equal(VE.get('voice').on, false, 'another subliminal does not inherit the echo');
VE.open('mix-1', account);
assert.deepEqual(VE.get('voice'), { on: true, mix: 55, delayMs: 420 });
VE.open('mix-1', { voice: { on: false, mix: 10, delayMs: 100 }, ts: 1 });   // stale account copy
assert.deepEqual(VE.get('voice'), { on: true, mix: 55, delayMs: 420 }, 'newer device copy wins');
VE.open('mix-9', { garbage: 1, voice: 'x' });
assert.equal(VE.get('voice').on, false);
VE.open(null, undefined);
VE.LAYERS.forEach(l => assert.equal(VE.get(l).on, false));
console.log('voice echo model: ok');
