/* Frequency layers: the model and the mixer, against a mock Web Audio context.
   Run:  npm run test:frequency-layers */
const assert = require('node:assert/strict');
const FL = require('../js/frequency-layers.js');

/* ---------- a Web Audio double that records what is done to it ---------- */
class Param {
  constructor(ctx, v = 0) { this.ctx = ctx; this.value = v; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.calls.push(['linear', v, t]); this.target = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); return this; }
  setTargetAtTime(v, t, tc) { this.calls.push(['target', v, t, tc]); this.target = v; return this; }
  cancelScheduledValues(t) { this.calls.push(['cancel', t]); return this; }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outputs = []; this.connected = true; ctx.nodes.push(this); }
  connect(n) { this.outputs.push(n); return n; }
  disconnect() { this.outputs = []; this.connected = false; }
}
function makeCtx() {
  const ctx = { currentTime: 0, nodes: [] };
  ctx.destination = new Node(ctx, 'destination');
  ctx.createGain = () => { const n = new Node(ctx, 'gain'); n.gain = new Param(ctx, 1); return n; };
  ctx.createBiquadFilter = () => { const n = new Node(ctx, 'filter'); n.frequency = new Param(ctx, 350); n.Q = new Param(ctx, 1); return n; };
  ctx.createStereoPanner = () => { const n = new Node(ctx, 'panner'); n.pan = new Param(ctx, 0); return n; };
  ctx.createOscillator = () => {
    const n = new Node(ctx, 'osc'); n.frequency = new Param(ctx, 440); n.type = 'sine';
    n.started = false; n.stopped = false; n.stopAt = null;
    n.start = () => { n.started = true; };
    n.stop = (t) => { n.stopAt = t === undefined ? ctx.currentTime : t; if (t === undefined) { n.stopped = true; if (n.onended) n.onended(); } };
    return n;
  };
  /* time passes: scheduled stops land and fire `ended`. */
  ctx.advance = (s) => {
    ctx.currentTime += s;
    ctx.nodes.filter(n => n.kind === 'osc' && n.started && !n.stopped && n.stopAt != null && n.stopAt <= ctx.currentTime)
      .forEach(n => { n.stopped = true; if (n.onended) n.onended(); });
  };
  ctx.liveOscillators = () => ctx.nodes.filter(n => n.kind === 'osc' && n.started && !n.stopped);
  return ctx;
}

(async () => {
  /* ---- the model ---- */
  const VALID = [174, 285, 396, 417, 432, 528, 639, 741, 852, 963];
  assert.equal(FL.MAX_FREQUENCY_LAYERS, 4);

  let layers = [];
  for (const hz of [174, 285, 396, 417]) {
    const r = FL.toggleFrequencyLayer(layers, hz);
    assert.equal(r.changed, true); assert.equal(r.action, 'added');
    layers = r.layers;
  }
  assert.deepEqual(layers.map(l => l.hz), [174, 285, 396, 417], 'four frequencies can be selected');
  const fifth = FL.toggleFrequencyLayer(layers, 528);
  assert.equal(fifth.changed, false); assert.equal(fifth.reason, 'max');
  assert.equal(fifth.layers.length, 4, 'a fifth is refused');
  const removed = FL.toggleFrequencyLayer(layers, 285);
  assert.deepEqual(removed.layers.map(l => l.hz), [174, 396, 417], 'each is independently removable');
  assert.equal(FL.toggleFrequencyLayer(removed.layers, 528).changed, true, 'room again after a removal');
  assert.equal(layers.length, 4, 'toggle never mutates its input');

  assert.deepEqual(FL.setFrequencyLayerVolume(layers, 396, 40).map(l => l.vol), [100, 100, 40, 100], 'volumes are independent');
  assert.equal(FL.setFrequencyLayerVolume(layers, 396, 250)[2].vol, 100, 'volume clamps to 100');
  assert.equal(FL.setFrequencyLayerVolume(layers, 396, -5)[2].vol, 0, 'volume clamps to 0');
  assert.equal(FL.setFrequencyLayerVolume(layers, 396, 0)[2].vol, 0, '0% is a real value (mute), not "missing"');

  // Persistence: what is saved comes back the same, and old rows still open.
  const saved = JSON.parse(JSON.stringify(FL.serializeFrequencyLayers([{ hz: 528, vol: 70 }, { hz: 432, vol: 20 }])));
  assert.deepEqual(FL.normalizeFrequencyLayers(saved, VALID), [{ hz: 528, vol: 70 }, { hz: 432, vol: 20 }], 'selection + levels round-trip');
  assert.deepEqual(FL.normalizeFrequencyLayers(undefined, VALID, 528), [{ hz: 528, vol: 100 }], 'a row saved before layers opens as one layer');
  assert.deepEqual(FL.normalizeFrequencyLayers([{ hz: 528, vol: 1 }, { hz: 528, vol: 9 }, { hz: 1, vol: 5 }], VALID), [{ hz: 528, vol: 1 }], 'duplicates and unknown Hz dropped');
  assert.equal(FL.normalizeFrequencyLayers(VALID.map(hz => ({ hz, vol: 50 })), VALID).length, 4, 'a hand-edited row cannot exceed four');

  // Headroom
  for (let n = 1; n <= 4; n++) {
    const all = Array.from({ length: n }, (_, i) => ({ hz: VALID[i], vol: 100 }));
    const peak = FL.peakEstimate(all, 100);
    assert.ok(peak <= FL.BASE_LEVEL * Math.sqrt(n) + 1e-9, `peak with ${n} tones stays within sqrt(n) of one tone`);
    assert.ok(peak <= FL.BASE_LEVEL * 2 + 1e-9, 'never more than twice what one tone always was');
  }
  assert.equal(FL.peakEstimate([{ hz: 528, vol: 100 }], 100), FL.BASE_LEVEL, 'a single tone is exactly as loud as it always was');
  assert.ok(FL.layerGainValue(100, 4) < FL.layerGainValue(100, 1), 'each tone steps down as tones are added');

  // Warnings
  assert.deepEqual(FL.assessFrequencyMix([{ hz: 528, vol: 100 }], { master: 30, voice: 65 }), [], 'a normal single tone warns about nothing');
  const stack = FL.assessFrequencyMix([174, 285, 639, 852].map(hz => ({ hz, vol: 100 })), { master: 90, voice: 65 });
  assert.ok(stack.some(w => w.code === 'stack-loud'), 'a loud stack is warned about');
  const close = FL.assessFrequencyMix([{ hz: 396, vol: 80 }, { hz: 417, vol: 80 }], { master: 60, voice: 65 });
  assert.ok(close.some(w => w.code === 'close-pair'), 'tones that beat against each other are named');
  assert.ok(!FL.assessFrequencyMix([{ hz: 396, vol: 10 }, { hz: 417, vol: 10 }], { master: 60 }).some(w => w.code === 'close-pair'), 'quiet close tones are fine');
  assert.ok(FL.assessFrequencyMix([{ hz: 852, vol: 100 }], { master: 90 }).some(w => w.code === 'sharp'), 'a loud high tone is flagged');

  // The output safety net: untouched below the knee, rounded above, never past full scale, symmetric.
  const curve = FL.softLimiterCurve(); const at = v => curve[Math.round(((v / 2) + 1) / 2 * (curve.length - 1))] * 2;
  for (const v of [0, 0.1, 0.3, 0.5, 0.79]) assert.ok(Math.abs(at(v) - v) < 1e-3, 'identity below the knee at ' + v);
  assert.ok(at(1) < 1 && at(1) > 0.9, 'a full-scale sum is rounded, not cut');
  assert.ok(Math.abs(at(-1.2) + at(1.2)) < 1e-6, 'symmetric');
  assert.ok(Array.from(curve).every(v => Math.abs(v * 2) <= 1.0000001), 'the output never exceeds full scale, even for a sum of 2x');
  assert.ok(Array.from(curve).every((v, i, a) => i === 0 || v >= a[i - 1]), 'monotonic, so it never inverts the waveform');
  assert.equal(curve[(curve.length - 1) / 2], 0, 'silence stays exactly silent (no DC offset)');

  /* ---- the mixer ---- */
  const ctx = makeCtx();
  const dest = ctx.createGain();
  const mixer = new FL.FrequencyMixer();
  mixer.attach(ctx, dest, { fadeIn: 2.5, level: FL.masterGainValue(30) });
  const master = mixer.master;
  assert.ok(master.gain.calls.some(c => c[0] === 'linear'), 'the frequency bus fades in');

  mixer.sync([{ hz: 174, vol: 100 }, { hz: 285, vol: 100 }, { hz: 396, vol: 100 }, { hz: 417, vol: 100 }]);
  assert.equal(ctx.liveOscillators().length, 4, 'four frequencies play at once');
  assert.deepEqual(mixer.frequencies().sort(), [174, 285, 396, 417]);
  ctx.liveOscillators().forEach(o => assert.ok(VALID.includes(o.frequency.value) && o.frequency.value === Math.round(o.frequency.value), 'every oscillator is at exactly a chosen Hz: ' + o.frequency.value));
  assert.deepEqual(ctx.liveOscillators().map(o => o.frequency.value).sort((a, b) => a - b), [174, 285, 396, 417], 'no pitch shift, no detuned partner');
  assert.ok(ctx.liveOscillators().every(o => o.type === 'sine'), 'the waveform is a sine');

  // idempotence: repeated sync / attach never doubles a tone
  for (let i = 0; i < 5; i++) mixer.sync([{ hz: 174, vol: 100 }, { hz: 285, vol: 100 }, { hz: 396, vol: 100 }, { hz: 417, vol: 100 }]);
  mixer.attach(ctx, dest, { fadeIn: 2.5, level: 0.03 });
  assert.equal(ctx.liveOscillators().length, 4, 'repeated sync / attach (a second Play) creates no duplicate layers');
  assert.equal(mixer.master, master, 're-attaching to the same context keeps the same bus');

  // levels glide; nothing jumps
  const voice396 = mixer.voices.get(396);
  mixer.sync([{ hz: 174, vol: 100 }, { hz: 285, vol: 100 }, { hz: 396, vol: 25 }, { hz: 417, vol: 100 }]);
  const lastCall = voice396.gain.gain.calls[voice396.gain.gain.calls.length - 1];
  assert.equal(lastCall[0], 'target', 'a volume change glides (setTargetAtTime), it does not jump');
  assert.ok(Math.abs(lastCall[1] - FL.layerGainValue(25, 4)) < 1e-9, 'to that layer\'s own level');
  assert.ok(lastCall[3] > 0, 'with a real time constant');
  assert.ok(voice396.gain.gain.calls.some(c => c[0] === 'cancel'), 'any pending ramp is cancelled first, so the slider is authoritative');
  mixer.setMasterLevel(FL.masterGainValue(80));
  assert.equal(master.gain.calls[master.gain.calls.length - 1][0], 'target', 'the master fader glides too');

  // removing fades out, then stops; the oscillator is not cut mid-cycle
  mixer.sync([{ hz: 174, vol: 100 }, { hz: 285, vol: 100 }, { hz: 417, vol: 100 }]);
  assert.equal(mixer.voiceCount(), 3, 'a removed tone leaves the model at once');
  assert.equal(voice396.gain.gain.calls[voice396.gain.gain.calls.length - 1][1], 0, 'and glides to silence');
  assert.ok(voice396.oscs[0].stopAt > ctx.currentTime, 'its oscillator is stopped later, not now');
  assert.equal(ctx.liveOscillators().length, 4, 'still sounding (fading) for a moment');
  ctx.advance(2);
  assert.equal(ctx.liveOscillators().length, 3, 'then gone');
  assert.equal(mixer.oscillatorCount(), 3);

  // re-adding the same Hz while the old one fades gives exactly one new voice
  mixer.sync([{ hz: 174, vol: 100 }, { hz: 285, vol: 100 }, { hz: 417, vol: 100 }, { hz: 396, vol: 60 }]);
  mixer.sync([{ hz: 174, vol: 100 }, { hz: 285, vol: 100 }, { hz: 417, vol: 100 }, { hz: 396, vol: 60 }]);
  assert.equal(mixer.frequencies().filter(h => h === 396).length, 1);
  assert.equal(ctx.liveOscillators().length, 4);

  // a new tone arrives silent
  const fresh = mixer.voices.get(396);
  assert.equal(fresh.gain.gain.calls.find(c => c[0] === 'set')[1], 0, 'its fade starts from silence, so it cannot click in');
  assert.ok(fresh.gain.gain.calls.some(c => c[0] === 'target' && c[1] > 0), 'and fades in rather than stepping in');

  // the headroom: per-tone targets always shrink as the count grows
  const targets = mixer.layers.map(l => FL.layerGainValue(l.vol, mixer.layers.length));
  assert.ok(targets.every(t => t <= 0.5 + 1e-9), 'no tone is driven above half scale with four playing');

  // binaural: each chosen tone becomes a left/right pair, at exactly Hz and Hz + beat
  const bctx = makeCtx(); const bmix = new FL.FrequencyMixer();
  bmix.attach(bctx, bctx.createGain(), { level: 0.03 });
  bmix.sync([{ hz: 528, vol: 100 }, { hz: 432, vol: 100 }], { band: { hz: 6 } });
  assert.deepEqual(bctx.liveOscillators().map(o => o.frequency.value).sort((a, b) => a - b), [432, 438, 528, 534], 'each ear exactly at Hz and Hz + beat');
  bmix.setBand({ hz: 10 });
  assert.equal(bctx.liveOscillators().length, 4, 'band to band retunes in place');
  assert.ok(bmix.voices.get(528).right.frequency.calls.some(c => c[0] === 'linear' && c[1] === 538), 'the right ear ramps to the new beat');
  bmix.setBand(null);
  assert.equal(bmix.voiceCount(), 2, 'beat off: the same two tones');
  bctx.advance(3);
  assert.deepEqual(bctx.liveOscillators().map(o => o.frequency.value).sort((a, b) => a - b), [432, 528], 'plain tones remain, exactly at Hz');

  // stop / detach leaves nothing running
  mixer.detach();
  assert.equal(ctx.liveOscillators().length, 0, 'detach stops every oscillator');
  assert.equal(mixer.voiceCount(), 0);
  assert.equal(mixer.attached, false);
  mixer.sync([{ hz: 528, vol: 100 }]);
  assert.equal(ctx.liveOscillators().length, 0, 'a detached mixer cannot start anything');

  // a fresh context after stop: one set of tones, not two
  const ctx2 = makeCtx();
  mixer.attach(ctx2, ctx2.createGain(), { level: 0.03 });
  mixer.sync([{ hz: 528, vol: 100 }]);
  mixer.attach(ctx2, ctx2.createGain(), { level: 0.03 });
  assert.equal(ctx2.liveOscillators().length, 1);

  console.log('PASS: 4 frequencies, per-layer volume, persistence round-trip, no duplicates, glide, headroom, true pitch, binaural pairs, clean detach');
})().catch(e => { console.error(e); process.exitCode = 1; });
