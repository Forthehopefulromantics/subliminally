/* Affirmation layering -- the pure parts and the engine, without a browser.
   npm run test:voice-layers */
const assert = require('node:assert/strict');
const VL = require('../js/voice-layers.js');
const UI = require('../js/voice-layers-ui.js');
const log = [];
const ok = (name) => log.push(name);

/* ---- distribution: 5, 10, 20, 50, 100 lines x 1-4 layers ---- */
for (const total of [5, 10, 20, 50, 100]) {
  for (let layers = 1; layers <= 4; layers++) {
    const g = VL.distribute(total, layers);
    assert.equal(g.length, layers, `${total}/${layers}: one group per layer`);
    const flat = g.flat();
    assert.deepEqual(flat, Array.from({ length: total }, (_, i) => i), `${total}/${layers}: every line once, in order, none duplicated`);
    const sizes = g.map(x => x.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${total}/${layers}: balanced (${sizes})`);
    g.forEach(grp => assert.deepEqual(grp, grp.slice().sort((a, b) => a - b), 'a layer keeps its lines in order'));
    assert.ok(g.every(x => x.length > 0), 'no empty layer');
  }
}
assert.deepEqual(VL.distribute(100, 4).map(g => [g[0] + 1, g[g.length - 1] + 1]), [[1, 25], [26, 50], [51, 75], [76, 100]], 'the 100-line example from the brief');
assert.deepEqual(VL.distribute(10, 4).map(g => g.length), [3, 3, 2, 2]);
assert.equal(VL.distribute(2, 4).length, 2, 'fewer lines than layers: only as many layers as there are lines');
assert.equal(VL.distribute(0, 4).length, 1);
ok('distribution 5/10/20/50/100 x 1-4 layers: balanced, ordered, no duplicates; 100 -> 1-25/26-50/51-75/76-100');

/* ---- configuration ---- */
const d = VL.defaultConfig();
assert.deepEqual([d.count, d.mode, d.staggerMs, d.volumes, d.groups], [1, 'staggered', 3000, [65, 40, 30, 20], null]);
assert.deepEqual(VL.normalizeConfig(undefined), d, 'a subliminal saved before layering plays as one voice');
assert.deepEqual(VL.normalizeConfig(null).count, 1);
const messy = VL.normalizeConfig({ count: 9, mode: 'chaos', staggerMs: 99999, volumes: [-5, 'x', 250, 30.4], groups: 'nope' });
assert.deepEqual([messy.count, messy.mode, messy.staggerMs, messy.volumes, messy.groups], [4, 'staggered', 4000, [0, 40, 100, 30], null], 'junk is clamped, never trusted');
assert.equal(VL.normalizeConfig({ staggerMs: 100 }).staggerMs, 2000);
const round = VL.serializeConfig({ count: 3, mode: 'simultaneous', staggerMs: 2500, volumes: [60, 35, 25, 15], groups: [[0, 1], [2], [3, 4], []] });
assert.deepEqual(VL.serializeConfig(JSON.parse(JSON.stringify(round))), round, 'JSON round trip (as stored in mix_settings)');
assert.deepEqual(VL.recommendedConfig({ count: 3, mode: 'simultaneous', staggerMs: 2000, volumes: [1, 2, 3, 4], groups: [[0]] }), { ...d, count: 3 }, 'reset keeps the layer count, restores everything else');
ok('config defaults, clamping, JSON round trip, reset-to-recommended');

/* ---- manual groups ---- */
const man = { count: 2, groups: [[0, 2, 4], [1, 3], [], []] };
assert.deepEqual(VL.resolveGroups(man, 5), [[0, 2, 4], [1, 3]], 'a valid manual split is used');
assert.deepEqual(VL.resolveGroups({ count: 2, groups: [[0, 1], [1, 2], [], []] }, 3), VL.distribute(3, 2), 'a duplicated line -> automatic');
assert.deepEqual(VL.resolveGroups({ count: 2, groups: [[0, 1], [], [], []] }, 2), VL.distribute(2, 2), 'an empty layer -> automatic');
assert.deepEqual(VL.resolveGroups({ count: 2, groups: [[0], [1]] }, 5), VL.distribute(5, 2), 'lines were added since: automatic, never dropped');
assert.deepEqual(VL.resolveGroups({ count: 3, groups: man.groups }, 5), VL.distribute(5, 3), 'a split saved for another layer count is not reused');
let moved = VL.moveLine([[0, 1, 2], [3, 4]], 1, 1);
assert.deepEqual(moved, [[0, 2], [1, 3, 4]], 'move keeps the target in order');
assert.deepEqual(VL.moveLine([[0], [1, 2]], 0, 1), [[0], [1, 2]], 'cannot empty a layer');
assert.equal(VL.layerOf([[0, 1], [2]], 2), 1);
assert.equal(new Set(VL.moveLine(VL.distribute(100, 4), 3, 3).flat()).size, 100, 'moving never duplicates');
ok('manual groups: validated, never duplicate or drop a line, cannot empty a layer');

/* ---- timing ---- */
const t0 = VL.layerOffsets({ count: 4, mode: 'staggered', staggerMs: 3000 });
assert.deepEqual(t0, [0, 3000, 6000, 9000]);
assert.deepEqual(VL.layerOffsets({ count: 4, mode: 'simultaneous' }), [0, 0, 0, 0]);
assert.deepEqual(VL.layerOffsets({ count: 3, mode: 'staggered', staggerMs: 2000 }), [0, 2000, 4000]);
assert.ok(VL.STAGGER_MIN_MS === 2000 && VL.STAGGER_MAX_MS === 4000);
ok('staggered offsets 2-4 s (default 3 s); simultaneous all at 0');

/* ---- gain management ---- */
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
near(VL.headroom([1]), 1); near(VL.headroom([0.65]), 1); near(VL.headroom([]), 1);
near(VL.headroom(VL.layerGains({ count: 4, volumes: [65, 40, 30, 20] })), 1);      // recommended mix already fits
near(VL.headroom([1, 1, 1, 1]), 0.45);
near(VL.headroom([1, 1]), 0.9 / Math.SQRT2);
for (const v of [[1, 1], [1, 1, 1], [1, 1, 1, 1], [0.9, 0.8, 0.7, 0.6]]) {
  const rss = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) * VL.headroom(v);
  assert.ok(rss <= 0.9 + 1e-9, `summed level stays within full scale for ${v}`);
}
assert.deepEqual(VL.layerGains({ count: 2, volumes: [65, 40, 30, 20] }), [0.65, 0.4]);
ok('headroom: 1 layer untouched, recommended mix untouched, four loud layers come down to a summed 0.9');

/* ---- UI helpers ---- */
assert.equal(UI.rangeText([0, 1, 2, 3, 7, 9, 10]), '1–4, 8, 10–11');
assert.equal(UI.rangeText(Array.from({ length: 25 }, (_, i) => i)), '1–25');
assert.equal(UI.SUBTITLE, 'Layer your affirmations to hear more of your intentions in every session.');
ok('panel helpers: range text, exact subtitle');

/* ---- the engine, against a fake context and a fake clock ---- */
function harness(opts = {}) {
  const nodes = [];
  const ctx = { currentTime: 0, createGain() { const n = { gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(v) { n.gain.value = v; } }, connected: true, connect() {}, disconnect() { n.connected = false; } }; nodes.push(n); return n; } };
  const timers = new Map(); let now = 0, next = 1;
  const later = (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; };
  const cancel = id => timers.delete(id);
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      let pick = null;
      for (const [id, t] of timers) if (t.at <= end && (!pick || t.at < pick[1].at)) pick = [id, t];
      if (!pick) break;
      timers.delete(pick[0]); now = Math.max(now, pick[1].at); pick[1].fn();
    }
    now = end;
  };
  const played = []; const pending = [];
  let live = true; const marks = [];
  const eng = new VL.VoiceLayerEngine({
    ctx, bus: {}, later, cancel, isLive: () => live, gapMs: () => opts.gap == null ? 100 : opts.gap, loops: opts.loops,
    onLine: (slot, i) => marks.push([slot, i]),
    playLine: (index, gain, done) => { const e = { index, gain, at: now, slot: nodes.indexOf(gain), done }; played.push(e); if (opts.holdLines) pending.push(e); else later(done, opts.lineMs || 400); }
  });
  return { eng, ctx, nodes, timers, advance, played, pending, marks, kill() { live = false; }, now: () => now };
}
{
  const groups = VL.distribute(8, 4);                 // [0,1] [2,3] [4,5] [6,7]
  const gains = [0.65, 0.4, 0.3, 0.2], offs = [0, 3000, 6000, 9000];
  const h = harness();
  h.eng.sync(groups, gains, offs);
  assert.equal(h.nodes.length, 3, 'layers 2-4 are the engine\'s; layer 1 stays with the main sequence');
  assert.deepEqual(h.nodes.map(n => n.gain.value), [0.4, 0.3, 0.2], 'each layer has its own level');
  h.advance(2999); assert.equal(h.played.length, 0, 'staggered: nothing before the first offset');
  h.advance(2); assert.deepEqual(h.played.map(p => p.index), [2], 'layer 2 starts at 3 s');
  h.advance(3000);
  assert.deepEqual([...new Set(h.played.map(p => p.index))].sort(), [2, 3, 4], 'layer 3 has joined, layer 2 is on its second line');
  assert.equal(h.played.find(p => p.index === 4).at, 6000, 'layer 3 starts exactly 6 s in');
  assert.equal(h.played.find(p => p.index === 6), undefined, 'layer 4 waits for 9 s');
  h.advance(60000);
  const byLayer = [1, 2, 3].map(s => h.played.filter(p => p.slot === s - 1).map(p => p.index));
  assert.deepEqual(byLayer[0].slice(0, 6), [2, 3, 2, 3, 2, 3], 'layer 2 keeps its order and loops on its own');
  assert.deepEqual(byLayer[1].slice(0, 4), [4, 5, 4, 5]);
  assert.deepEqual(byLayer[2].slice(0, 4), [6, 7, 6, 7]);
  for (const p of h.played) assert.ok(groups[p.slot + 1].includes(p.index), 'a layer only plays lines it owns');
  h.eng.stop();
  const before = h.played.length;
  h.advance(60000);
  assert.equal(h.played.length, before, 'nothing plays after stop');
  assert.equal(h.timers.size, 0, 'no timer left behind');
  assert.ok(h.nodes.every(n => !n.connected), 'every node disconnected');
  ok('engine: staggered start, per-layer order + independent loop, only owned lines, clean stop (no timers, nodes disconnected)');
}
{
  const h = harness();
  h.eng.sync(VL.distribute(8, 4), [1, 1, 1, 1], [0, 0, 0, 0]);
  h.advance(1);
  assert.deepEqual(h.played.map(p => p.index).sort(), [2, 4, 6], 'simultaneous: all layers begin together');
  ok('engine: simultaneous start');
}
{
  const h = harness();
  h.eng.sync(VL.distribute(8, 2), [1, 0.4], [0, 0]); h.advance(1);
  assert.equal(h.nodes.length, 1);
  h.eng.sync(VL.distribute(8, 4), [1, 0.4, 0.3, 0.2], [0, 1000, 2000, 3000]);
  assert.equal(h.nodes.length, 3, 'layers added live, existing one kept');
  h.eng.sync(VL.distribute(8, 1), [1], [0]);
  assert.equal(h.eng.layers.length, 0, 'back to one layer removes them all');
  h.advance(60000);
  const after = h.played.length; h.advance(60000);
  assert.equal(h.played.length, after, 'removed layers say nothing more');
  h.eng.sync(VL.distribute(8, 3), [1, 0.4, 0.3], [0, 0, 0]);
  h.advance(10); assert.ok(h.played.length > after, 'and can come back');
  h.eng.stop();
  ok('engine: layers added, removed and re-added live without leftovers');
}
{
  const h = harness({ holdLines: true, gap: 0 });
  h.eng.sync([[0, 1], [2, 3, 4]], [1, 1], [0, 0]);
  h.advance(1);
  assert.equal(h.pending.length, 1);
  h.pending.shift().done(); h.advance(1);
  assert.deepEqual(h.played.map(p => p.index), [2, 3]);
  h.pending[0].done(); h.pending[0].done();   // a duplicate end must not skip a line
  h.advance(1); assert.deepEqual(h.played.map(p => p.index), [2, 3, 4], 'a repeated completion advances once');
  assert.ok(h.eng.request(2), 'a listener can cue a line another layer owns');
  h.pending.splice(0).forEach(e => e.done()); h.advance(1);
  assert.equal(h.played[h.played.length - 1].index, 2, 'the cued line plays next, then order resumes');
  assert.equal(h.eng.request(0), false, 'a line the main voice owns is not the engine\'s');
  // changing the group in place keeps the layer where it was
  h.eng.sync([[0, 1, 4], [2, 3]], [1, 1], [0, 0]);
  h.eng.stop();
  ok('engine: duplicate completions ignored, cueing, in-place regroup');
}
{
  let loopOn = false;
  const h = harness({ loops: () => loopOn, gap: 0, lineMs: 100 });
  h.eng.sync([[0], [1, 2]], [1, 1], [0, 0]);
  h.advance(5000);
  assert.deepEqual(h.played.map(p => p.index), [1, 2], 'play-once: each line once, then the layer rests');
  assert.equal(h.eng.busy(), false);
  assert.equal(h.timers.size, 0);
  ok('engine: play-once mode ends without looping and reports not busy');
}
{
  const h = harness();
  h.eng.sync(VL.distribute(8, 3), [1, 1, 1], [0, 0, 0]);
  h.advance(50);
  h.kill();
  h.advance(60000);
  const n = h.played.length; h.advance(60000);
  assert.equal(n, h.played.length, 'a session that is no longer live starts nothing');
  ok('engine: stale session produces no further audio');
}

console.log('PASS: ' + log.length + ' groups\n  - ' + log.join('\n  - '));
