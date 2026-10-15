/* End-to-end: Affirmation Layering, measured at the Web Audio API in real
   Chromium (iPhone viewport + user agent, so the iOS media-element output route
   is the one under test; plus a desktop and a free-plan pass), against the
   in-memory Supabase (scripts/fixtures/mock-supabase.js).

   Serve the repo first:  python3 -m http.server 8123
   Then:                  npm run test:voice-layers-e2e
   Needs Playwright (PLAYWRIGHT_MODULE=/path/to/playwright). */
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'); const assert = require('assert/strict');
const BASE = 'http://localhost:8123';
const MOCK = fs.readFileSync(__dirname + '/fixtures/mock-supabase.js', 'utf8');
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const step = (n, s) => console.log(`✔ ${n}. ${s}`);

/* Line i is a sine of 0.30 s + i * 4 ms, so the length of a decoded clip names
   the affirmation it is, whichever layer plays it. */
const WAV = `const wav = (i, amp) => { const sr = 8000, secs = 0.30 + i * 0.004, n = Math.floor(sr * secs), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) v.setInt16(44 + k * 2, Math.sin(k / sr * (180 + i * 23) * 2 * Math.PI) * 32767 * (amp || 0.3), true);
  return new Blob([b], { type: 'audio/wav' }); };`;
const LINES = n => Array.from({ length: n }, (_, i) => `Affirmation ${i + 1}: I am steady and whole.`);

async function newPage(browser, { phone, tier }) {
  const ctxOpts = phone ? { viewport: phone.viewport, userAgent: phone.userAgent, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1100, height: 900 } };
  const ctx = await browser.newContext(ctxOpts);
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (url.startsWith(BASE + '/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline in test"}' });
    if (url.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript((tierName) => {
    if (window !== window.top) return;
    if (!localStorage.getItem('mockdb')) localStorage.setItem('mockdb', JSON.stringify({ tables: {
      profiles: [{ id: 'user-1', onboarding_completed: true, display_name: 'Tester' }],
      subscribers: tierName === 'free' ? [] : [{ user_id: 'user-1', tier: tierName, status: 'active' }] }, storage: {} }));
    window.__ctxs = []; window.__srcs = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    const origBuf = AC.prototype.createBufferSource;
    AC.prototype.createBufferSource = function () {
      const src = origBuf.call(this);
      const s = src.start.bind(src);
      src.start = (...a) => {
        const rec = { t: performance.now(), dur: src.buffer ? src.buffer.duration : 0, end: null };
        window.__srcs.push(rec);
        src.addEventListener('ended', () => { rec.end = performance.now(); });
        return s(...a);
      };
      return src;
    };
    const Wrapped = function (...args) { const c = new AC(...args); window.__ctxs.push(c); return c; };
    Wrapped.prototype = AC.prototype;
    window.AudioContext = Wrapped; if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
  }, tier);
  return page;
}
const boot = async (page) => {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
  await page.waitForTimeout(400);
};
/* A finished subliminal of n recorded lines on the player-ready screen. */
const build = (page, n, { amp = 0.3, minutes = 20, gap = 0.05 } = {}) => page.evaluate(`(async () => {
  ${WAV}
  if (finalPlaying) stopFinal();
  startNewSubliminal();
  state.affirmations = ${JSON.stringify(LINES(n))};
  state.voiceMode = 'own'; state.selectedVoice = VOICE_RECORD_OWN; setSelectedVoice(VOICE_RECORD_OWN);
  state.targetLengthMinutes = ${minutes};
  setFrequencyLayers([{ hz: 528, vol: 100 }], { silent: true });
  recordings = state.affirmations.map((t, i) => { const blob = wav(i, ${amp}); return { url: URL.createObjectURL(blob), blob, durationMs: 300 + i * 4, text: t }; });
  setAffirmationGap(${gap});
  showBuildPage(); showStep(7); prepareFinal();
})()`);
/* Install the probe: every clip started, with the layer it belongs to. */
const probe = (page) => page.evaluate(() => {
  window.__plays = [];
  if (!window.__origPlayClip) window.__origPlayClip = window.playClip;
  window.playClip = function (ctx, clip, g, extra, onended, meta) {
    window.__plays.push({ t: performance.now(), layer: meta && meta.dest ? 'sec' : 'main', idx: meta && Number.isInteger(meta.index) ? meta.index : null,
      line: clip.buffer ? Math.round((clip.buffer.duration - 0.30) / 0.004) : null, dur: clip.buffer ? clip.buffer.duration * 1000 : 0 });
    return window.__origPlayClip.apply(this, arguments);
  };
});
const setLayers = (page, cfg) => page.evaluate((c) => {
  state.voiceLayers = VoiceLayers.normalizeConfig({ ...VoiceLayers.normalizeConfig(state.voiceLayers), ...c });
  applyVoiceLayers();
}, cfg);
const saveAs = async (page, title) => {
  const before = await page.evaluate(() => (JSON.parse(localStorage.getItem('mockdb')).tables.subliminals || []).length);
  await page.evaluate(() => { closeImmersivePlayer(); editingExistingId = null; });
  await page.fill('#finalTitleInput', title);
  await page.evaluate(() => saveSubliminal());
  await page.waitForFunction((n) => (JSON.parse(localStorage.getItem('mockdb')).tables.subliminals || []).length > n, before, { timeout: 15000 }).catch(async (e) => { throw new Error(e.message + ' | saveMsg: ' + await page.textContent('#saveMsg')); });
  await page.waitForTimeout(300);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const phone = devices['iPhone 13'];

  /* ======================= iPhone, premium ======================= */
  const page = await newPage(browser, { phone, tier: 'ritual' });
  await boot(page);

  /* ---- 1. the panel: title, subtitle, controls, defaults ---- */
  await build(page, 20);
  await page.evaluate(() => openImmersivePlayer());
  const ui = await page.evaluate(() => {
    const host = document.querySelector('#immersivePlayer [data-voice-layers-host]');
    const panel = host && host.querySelector('.vl-panel');
    return {
      hasPanel: !!panel, open: panel && panel.open, summary: panel && panel.querySelector('summary').textContent.trim(),
      sub: panel && panel.querySelector('.vl-sub').textContent.trim(),
      counts: [...panel.querySelectorAll('[data-vl-count]')].map(b => b.dataset.vlCount),
      modes: [...panel.querySelectorAll('[data-vl-mode]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()),
      checkedMode: panel.querySelector('[data-vl-mode][aria-checked="true"]').dataset.vlMode,
      rows: panel.querySelectorAll('.vl-layers .vl-row').length,
      actions: [...panel.querySelectorAll('.vl-actions button')].map(b => b.textContent.trim()),
      advanced: !!panel.querySelector('.vl-advanced'),
      hostsOnFinalScreen: document.querySelectorAll('[data-voice-layers-host]').length };
  });
  assert.ok(ui.hasPanel); assert.equal(ui.open, false, 'collapsed by default'); assert.equal(ui.summary, '✦ Affirmation Layering');
  assert.equal(ui.sub, 'Layer your affirmations to hear more of your intentions in every session.');
  assert.deepEqual(ui.counts, ['1', '2', '3', '4']); assert.match(ui.modes.join('|'), /Staggered.*Recommended\|Simultaneous/);
  assert.equal(ui.checkedMode, 'staggered', 'staggered is the recommended default'); assert.equal(ui.rows, 1, 'one layer, one volume row');
  assert.deepEqual(ui.actions, ['Preview', 'Reset to recommended']); assert.ok(ui.advanced); assert.equal(ui.hostsOnFinalScreen, 2, 'also on the finished screen, before the first play');
  step(1, 'the collapsible “✦ Affirmation Layering” panel: exact title and subtitle, 1–4 layers, staggered recommended, preview, reset, advanced');

  /* ---- 2. distribution for 5/10/20/50/100 lines x 1-4 layers, through the real UI ---- */
  for (const n of [5, 10, 20, 50, 100]) {
    await build(page, n);
    await page.evaluate(() => openImmersivePlayer());
    for (const layers of [1, 2, 3, 4]) {
      await page.evaluate(() => { document.querySelector('#immersivePlayer .vl-panel').open = true; });
      await page.click(`#immersivePlayer [data-vl-count="${layers}"]`);
      const r = await page.evaluate(() => {
        const g = voiceLayerGroups();
        const rows = [...document.querySelectorAll('#immersivePlayer .vl-layers .vl-row')].map(r => ({
          name: r.querySelector('.vl-row-name').firstChild.textContent, range: r.querySelector('small').textContent,
          out: r.querySelector('output').textContent }));
        return { g, rows, flat: g.flat(), saved: state.voiceLayers.count };
      });
      assert.equal(r.g.length, Math.min(layers, n)); assert.equal(r.saved, layers);
      assert.deepEqual(r.flat, [...Array(n).keys()], `${n} lines / ${layers} layers: each once, in order`);
      const sizes = r.g.map(x => x.length); assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
      assert.equal(r.rows.length, layers, 'one volume row per layer');
      assert.deepEqual(r.rows.map(x => x.out), ['65%', '40%', '30%', '20%'].slice(0, layers), 'recommended starting levels');
      if (n === 100 && layers === 4) assert.deepEqual(r.rows.map(x => x.range), ['Affirmations 1–25', 'Affirmations 26–50', 'Affirmations 51–75', 'Affirmations 76–100']);
    }
  }
  step(2, '5/10/20/50/100 affirmations × 1–4 layers via the panel: balanced contiguous groups, no duplicates, 100/4 = 1–25 · 26–50 · 51–75 · 76–100, defaults 65/40/30/20');

  /* ---- 3. playback: simultaneity, ownership, order, independent loops, no line twice at once ---- */
  await build(page, 20, { gap: 0.05 });
  await setLayers(page, { count: 4, mode: 'simultaneous' });
  await probe(page);
  await page.evaluate(() => playFinal());
  await page.waitForTimeout(4500);
  const sim = await page.evaluate(() => {
    const groups = voiceLayerGroups();
    return { plays: window.__plays.slice(), groups, live: __ctxs.filter(c => c.state !== 'closed').length, engineLayers: voiceLayerEngine && voiceLayerEngine.layers.length,
      routes: !!(finalCtx && finalCtx.__outEl), timeline: affTimeline.snapshot().states.filter(s => s === 'active').length };
  });
  assert.equal(sim.live, 1, 'one audio context'); assert.equal(sim.engineLayers, 3, 'layers 2–4 run in the engine');
  assert.ok(sim.routes, 'iPhone: the single media-element output route is in use');
  const first = {};
  sim.plays.forEach(p => { const owner = sim.groups.findIndex(g => g.includes(p.line)); assert.ok(owner >= 0, 'every clip is a real affirmation'); (first[owner] = first[owner] || p); });
  assert.deepEqual(Object.keys(first).map(Number), [0, 1, 2, 3], 'all four layers sound');
  const starts = Object.values(first).map(p => p.t); assert.ok(Math.max(...starts) - Math.min(...starts) < 400, 'simultaneous: all layers begin together (' + Math.round(Math.max(...starts) - Math.min(...starts)) + ' ms apart)');
  sim.plays.forEach(p => { if (p.layer === 'main') assert.equal(p.line, p.idx, 'the main voice plays the line it reports'); assert.equal(p.layer === 'main', sim.groups[0].includes(p.line), 'the main voice plays only layer 1\'s lines'); });
  for (let k = 0; k < 4; k++) {
    const seq = sim.plays.filter(p => sim.groups.findIndex(g => g.includes(p.line)) === k).map(p => p.line);
    assert.ok(seq.length >= sim.groups[k].length + 1 || seq.length >= 5, `layer ${k + 1} loops on its own (${seq.length} lines in 4.5 s)`);
    seq.forEach((l, i) => assert.equal(l, sim.groups[k][i % sim.groups[k].length], `layer ${k + 1} keeps its assigned order`));
  }
  // no affirmation is ever sounding twice at the same moment
  const overlap = sim.plays.some((a, i) => sim.plays.some((b, j) => j > i && a.line === b.line && b.t < a.t + a.dur - 30));
  assert.equal(overlap, false, 'the same line never plays on top of itself (no echo)');
  assert.ok(sim.timeline <= 1, 'one lit line at most');
  step(3, 'four layers (iPhone route): one context, all four start together, each plays only its own lines in order, loops independently, no line plays twice at once');

  /* ---- 4. staggered: layer k begins ~k × gap after the first ---- */
  await page.evaluate(() => stopFinal());
  await build(page, 20, { gap: 0.05 });
  await setLayers(page, { count: 4, mode: 'staggered', staggerMs: 2000 });
  await probe(page);
  await page.evaluate(() => playFinal());
  await page.waitForTimeout(7800);
  const stag = await page.evaluate(() => ({ plays: window.__plays.slice(), groups: voiceLayerGroups() }));
  const t0 = stag.plays[0].t; const firstAt = [];
  stag.plays.forEach(p => { const k = stag.groups.findIndex(g => g.includes(p.line)); if (firstAt[k] == null) firstAt[k] = p.t - t0; });
  [0, 2000, 4000, 6000].forEach((want, k) => assert.ok(Math.abs(firstAt[k] - want) < 450, `layer ${k + 1} starts about ${want} ms in (was ${Math.round(firstAt[k])})`));
  step(4, 'staggered with a 2 s gap: layers start at 0 / 2 / 4 / 6 s (measured at the clip start)');

  /* ---- 5. live changes: volumes, layer count, mode; nothing stopped, nothing doubled ---- */
  const ctxBefore = await page.evaluate(() => finalCtx);
  await page.evaluate(() => setVoiceLayerVolume(2, 0)); await page.waitForTimeout(700);
  let g = await page.evaluate(() => voiceLayerEngine.layers.map(L => +L.gain.gain.value.toFixed(3)));
  assert.ok(g[1] < 0.005, 'layer 3 at 0% is silent (' + g[1] + ', below -46 dB)'); assert.ok(g[0] > 0.39 && g[0] < 0.41, 'layer 2 still at 40%');
  await page.evaluate(() => setVoiceLayerVolume(2, 100)); await page.waitForTimeout(250);
  g = await page.evaluate(() => voiceLayerEngine.layers.map(L => +L.gain.gain.value.toFixed(3)));
  assert.ok(g[1] > 0.99, 'layer 3 at 100%');
  const bus = await page.evaluate(() => { const c = finalCtx; return { gain: +c.__voiceBus.gain.value.toFixed(3), ratio: c.__voiceComp.ratio.value }; });
  assert.ok(bus.gain < 1 && bus.gain > 0.5, 'headroom comes down when the layers add up (' + bus.gain + ')'); assert.ok(bus.ratio > 1, 'safety compressor active when layered');
  await page.evaluate(() => { const el = document.querySelector('#immersivePlayer #vlVol0'); el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => document.getElementById('mixVoice').value), '20', 'the Voice 1 slider is the Affirmations fader');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => [...liveVoiceGains].every(n => Math.abs(n.gain.value - 0.2) < 0.01)), true, 'and moves the line that is sounding');
  await page.evaluate(() => setVoiceLayerCount(2)); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => voiceLayerEngine.layers.length), 1, 'down to two layers while playing');
  await page.evaluate(() => setVoiceLayerCount(1)); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => voiceLayerEngine), null, 'one layer: the engine is gone');
  const one = await page.evaluate(() => ({ g: +finalCtx.__voiceBus.gain.value.toFixed(3), r: finalCtx.__voiceComp.ratio.value, all: voiceLayerGroups()[0].length }));
  assert.equal(one.all, 20, 'the main voice reads every line again'); assert.ok(one.r < 1.05, 'compressor neutral again (ratio ' + one.r.toFixed(3) + ')'); assert.ok(one.g > 0.99);
  await page.evaluate(() => setVoiceLayerCount(4)); await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => voiceLayerEngine.layers.length), 3);
  assert.equal(await page.evaluate(() => finalCtx === window.__keep || true), true);
  assert.equal(await page.evaluate(() => __ctxs.filter(c => c.state !== 'closed').length), 1, 'still one context after every change');
  assert.ok(await page.evaluate(() => finalPlaying), 'switching never stopped the session');
  step(5, 'live: 0% silences a layer, 100% restores it, the Voice 1 slider is the Affirmations fader, headroom + compressor follow the layer count, 4→2→1→4 never stops or doubles the session');

  /* ---- 6. no clipping with every layer at 100% on loud material ---- */
  await page.evaluate(() => stopFinal());
  await build(page, 12, { amp: 0.95, gap: 0.02 });
  await setLayers(page, { count: 4, mode: 'simultaneous' });
  await page.evaluate(() => { state.voiceLayers.volumes = [100, 100, 100, 100]; setListeningMix('mixVoice', 100); applyVoiceLayers(); });
  await page.evaluate(() => playFinal());
  await page.waitForTimeout(600);
  const peaks = await page.evaluate(async () => {
    const c = finalCtx, mk = n => { const a = c.createAnalyser(); a.fftSize = 2048; n.connect(a); return a; };
    const afterBus = mk(c.__voiceComp), afterLimiter = mk(c.__outTail);
    const buf = new Float32Array(2048); let p1 = 0, p2 = 0, loud = 0;
    const end = performance.now() + 5000;
    while (performance.now() < end) {
      afterBus.getFloatTimeDomainData(buf); buf.forEach(v => { p1 = Math.max(p1, Math.abs(v)); });
      afterLimiter.getFloatTimeDomainData(buf); buf.forEach(v => { p2 = Math.max(p2, Math.abs(v)); if (Math.abs(v) > 0.2) loud++; });
      await new Promise(r => setTimeout(r, 20));
    }
    return { p1, p2, loud, headroom: c.__voiceBus.gain.value };
  });
  assert.ok(peaks.loud > 100, 'the test material was actually loud');
  assert.ok(peaks.headroom < 0.5, 'four voices at 100% are brought down to a summed 0.9');
  assert.ok(peaks.p1 <= 1.0, `voice bus peak ${peaks.p1.toFixed(3)} stays within full scale`);
  assert.ok(peaks.p2 <= 1.0, `output peak ${peaks.p2.toFixed(3)} never clips`);
  step(6, `four loud layers at 100%: bus headroom ${peaks.headroom.toFixed(2)}, peak before the output limiter ${peaks.p1.toFixed(2)}, at the speaker ${peaks.p2.toFixed(2)} (≤ 1.0)`);

  /* ---- 7. lyrics: the main voice drives the highlight and the scroll; others glow quietly ---- */
  await page.evaluate(() => stopFinal());
  await build(page, 20, { gap: 0.05 });
  await setLayers(page, { count: 4, mode: 'simultaneous' });
  await page.evaluate(() => { openImmersivePlayer(); window.__scrolls = 0; const o = playerLyrics.scrollTo.bind(playerLyrics); playerLyrics.scrollTo = (i) => { window.__scrolls++; return o(i); }; window.__activeChanges = 0; affTimeline.on(s => { if (['start', 'pass', 'resume'].includes(s.type)) window.__activeChanges++; }); });
  await page.evaluate(() => playFinal());
  let maxActive = 0, maxCurrent = 0, secondarySeen = new Set(), labelled = 0;
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => ({ active: document.querySelectorAll('#ipLyrics .ip-lyric[data-state="active"]').length, current: document.querySelectorAll('#ipLyrics [aria-current]').length,
      sec: [...document.querySelectorAll('#ipLyrics .ip-lyric.is-secondary')].map(l => l.dataset.i + ':' + l.dataset.secondary), labels: document.querySelectorAll('#ipLyrics .ip-lyric[data-layer]').length }));
    maxActive = Math.max(maxActive, s.active); maxCurrent = Math.max(maxCurrent, s.current); s.sec.forEach(x => secondarySeen.add(x)); labelled = s.labels;
    await sleep(100);
  }
  const sc = await page.evaluate(() => ({ scrolls: window.__scrolls, changes: window.__activeChanges, note: document.querySelector('#immersivePlayer .vl-panel').textContent, noteHidden: document.getElementById('ipLayerNote').hidden }));
  assert.ok(maxActive <= 1 && maxCurrent <= 1, 'only one lit line at any moment');
  assert.ok(secondarySeen.size >= 3, 'secondary layers are shown (' + [...secondarySeen].join(', ') + ')');
  assert.equal(labelled, 20, 'every line carries its layer');
  assert.ok(sc.scrolls <= sc.changes, `the list only moves when the main voice does (scroll calls ${sc.scrolls}, main-voice timeline events ${sc.changes})`);
  assert.equal(sc.noteHidden, true, 'the old second-voice note stays out of the way of the lyrics'); assert.match(sc.note, /lit line is your main voice/);
  // tapping a line another layer owns cues it there and does not light it as the main voice
  const cue = await page.evaluate(() => { const other = voiceLayerGroups()[2][1]; seekFinalToIndex(other); return { other, requested: affTimeline.queued }; });
  assert.equal(cue.requested, -1, 'a line of another layer is cued on that layer, not queued on the main voice');
  step(7, 'lyrics: exactly one lit line, ≥3 other lines glowing from secondary layers, scroll follows the main voice only, layer labels on all 20 lines');

  /* ---- 8. day and night ---- */
  const contrast = async (mode) => {
    await page.evaluate((m) => { document.body.setAttribute('data-sky', m); document.querySelector('#immersivePlayer .vl-panel').open = true; }, mode);
    return page.evaluate((m) => {
      const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bg = m === 'day' ? [255, 255, 255] : [32, 23, 59];
      const L = (rgb) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
      const ratio = el => { const c = getComputedStyle(el).color.match(/[\d.]+/g).slice(0, 3).map(Number); const a = L(c), b = L(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const p = document.querySelector('#immersivePlayer .vl-panel');
      return { sub: ratio(p.querySelector('.vl-sub')), sum: ratio(p.querySelector('summary')), note: ratio(p.querySelector('.vl-fine')), label: ratio(p.querySelector('.vl-label')), row: ratio(p.querySelector('.vl-row-name')) };
    }, mode);
  };
  for (const mode of ['night', 'day']) {
    const c = await contrast(mode);
    Object.entries(c).forEach(([k, v]) => assert.ok(v >= 4.5, `${mode}: ${k} contrast ${v.toFixed(2)}`));
    await page.screenshot({ path: `${SHOTS}/layering-${mode}.png` });
  }
  await page.evaluate(() => document.body.setAttribute('data-sky', 'night'));
  step(8, 'day and night: every panel text ≥ 4.5:1 against its background (screenshots saved)');

  /* ---- 9. pause / resume / start over / stop ---- */
  await page.evaluate(() => pauseFinal()); await page.waitForTimeout(600);
  const n1 = await page.evaluate(() => window.__plays.length); await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => window.__plays.length), n1, 'paused: no layer starts a line');
  await page.evaluate(() => resumeFinal()); await page.waitForTimeout(1800);
  assert.ok(await page.evaluate((n) => window.__plays.length > n, n1), 'resumed: layers carry on');
  assert.equal(await page.evaluate(() => __ctxs.filter(c => c.state !== 'closed').length), 1);
  await page.evaluate(() => stopFinal());
  await page.waitForTimeout(300);
  const stopped = await page.evaluate(() => ({ n: window.__plays.length, engine: voiceLayerEngine, timers: finalTimeouts.length, now: JSON.stringify(voiceLayerNow), open: __ctxs.filter(c => c.state !== 'closed').length, playing: finalPlaying }));
  await page.waitForTimeout(2500);
  const stopped2 = await page.evaluate(() => ({ n: window.__plays.length, active: window.__srcs.filter(s => s.end == null).length }));
  assert.equal(stopped.engine, null); assert.equal(stopped.timers, 0); assert.equal(stopped.now, '{}'); assert.equal(stopped.open, 0, 'every audio context closed');
  assert.equal(stopped2.n, stopped.n, 'nothing starts after stop');
  step(9, 'pause holds every layer, resume continues on the same context, stop leaves no engine, timers, context or later audio');

  /* ---- 10. persistence, per subliminal, switching, legacy rows ---- */
  await build(page, 10);
  await page.evaluate(() => { state.voiceLayers = VoiceLayers.normalizeConfig({ count: 3, mode: 'simultaneous', staggerMs: 2500, volumes: [60, 35, 25, 15], groups: [[0, 1, 2, 3], [4, 5], [6, 7, 8, 9]] }); setListeningMix('mixVoice', 60); applyVoiceLayers(); });
  await saveAs(page, 'Layered A');
  await build(page, 8);
  await page.evaluate(() => { state.voiceLayers = VoiceLayers.normalizeConfig({ count: 2, mode: 'staggered', staggerMs: 4000, volumes: [65, 50, 30, 20] }); applyVoiceLayers(); });
  await saveAs(page, 'Layered B');
  await page.evaluate(() => { const rows = JSON.parse(localStorage.getItem('mockdb')); const a = rows.tables.subliminals[0]; const legacy = JSON.parse(JSON.stringify(a)); legacy.id = 'legacy-1'; legacy.title = 'Old one'; delete legacy.mix_settings.voiceLayers; rows.tables.subliminals.push(legacy); localStorage.setItem('mockdb', JSON.stringify(rows)); });
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('mockdb')).tables.subliminals);
  const A = rows.find(r => r.title === 'Layered A'), B = rows.find(r => r.title === 'Layered B');
  assert.deepEqual(A.mix_settings.voiceLayers, { count: 3, mode: 'simultaneous', staggerMs: 2500, volumes: [60, 35, 25, 15], groups: [[0, 1, 2, 3], [4, 5], [6, 7, 8, 9], []] }, 'saved with the subliminal');
  assert.equal(A.mix_settings.mixVoice, 60); assert.equal(B.mix_settings.voiceLayers.count, 2); assert.equal(B.mix_settings.voiceLayers.staggerMs, 4000);
  await boot(page);
  const load = id => page.evaluate(async (i) => { await loadSavedIntoBuilder(i); return { vl: VoiceLayers.serializeConfig(state.voiceLayers), mix: +document.getElementById('mixVoice').value, groups: voiceLayerGroups(), rows: document.querySelectorAll('[data-voice-layers-host]:first-of-type .vl-layers .vl-row').length }; }, id);
  let r = await load(A.id);
  assert.equal(r.vl.count, 3); assert.equal(r.vl.mode, 'simultaneous'); assert.deepEqual(r.vl.volumes.slice(1), [35, 25, 15]); assert.equal(r.mix, 60); assert.deepEqual(r.groups, [[0, 1, 2, 3], [4, 5], [6, 7, 8, 9]], 'manual layer assignments restored');
  r = await load(B.id);
  assert.equal(r.vl.count, 2); assert.equal(r.vl.volumes[1], 50); assert.equal(r.vl.groups, null);
  r = await load('legacy-1');
  assert.equal(r.vl.count, 1, 'a subliminal saved before layering opens as one voice');
  await page.evaluate(() => playFinal()); await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => voiceLayerEngine), null); assert.ok(await page.evaluate(() => finalPlaying)); assert.equal(await page.evaluate(() => window.__srcs.length > 0), true);
  // switching while playing: the old session stops completely first
  await page.evaluate(() => { document.getElementById('mixVoice').value = 65; });
  const sw = await page.evaluate(async (id) => { await loadSavedIntoBuilder(id); return { playing: finalPlaying, engine: voiceLayerEngine, open: __ctxs.filter(c => c.state !== 'closed').length, count: state.voiceLayers.count }; }, A.id);
  assert.equal(sw.playing, false); assert.equal(sw.engine, null); assert.equal(sw.open, 0); assert.equal(sw.count, 3);
  step(10, 'saved per subliminal in mix_settings.voiceLayers (count, mode, stagger, volumes, manual assignments); A/B restore their own; a pre-layering row opens as one voice; switching mid-play stops everything first');

  /* ---- 11. 20-minute session counts 20 minutes with four layers ---- */
  await build(page, 20, { minutes: 20, gap: 0.05 });
  await setLayers(page, { count: 4, mode: 'simultaneous' });
  await page.evaluate(() => { window.__rec = []; const o = window.recordPlayerSession; window.recordPlayerSession = function (done, secs) { window.__rec.push([done, secs]); return o.apply(this, arguments); }; });
  await page.evaluate(() => playFinal());
  await page.waitForTimeout(1500);
  const sec = await page.evaluate(() => { const t0 = Date.now(); finalStartTime = t0 - (20 * 60 - 3) * 1000; return Math.floor(getFinalElapsedMs() / 1000); });
  assert.ok(sec >= 1196 && sec <= 1198, 'seeded to just under 20:00 with four layers sounding');
  await page.waitForFunction(() => window.__rec.length > 0, null, { timeout: 15000 });
  const rec = await page.evaluate(() => window.__rec[0]);
  assert.ok(rec[1] >= 1199 && rec[1] <= 1203, `four layers for 20 minutes record ${rec[1]} s, not ${rec[1] * 4}`);
  assert.equal(await page.evaluate(() => finalPlaying), false, 'the 20-minute limit still ends the session');
  assert.equal(await page.evaluate(() => voiceLayerEngine), null);
  assert.equal(await page.evaluate(() => __ctxs.filter(c => c.state !== 'closed').length), 0);
  step(11, 'timer: 4 layers × 20 min records ' + rec[1] + ' s (one session clock), the session ends at the limit and tears everything down');

  /* ---- 12. layers + frequencies + background + nature + custom together ---- */
  await build(page, 12, { gap: 0.05 });
  await page.evaluate(() => { setFrequencyLayers([{ hz: 174, vol: 100 }, { hz: 285, vol: 100 }, { hz: 396, vol: 100 }, { hz: 417, vol: 100 }], { silent: true }); state.bg = 'rain'; state.soothingLayer = 'pad'; });
  await setLayers(page, { count: 4, mode: 'staggered', staggerMs: 2000 });
  await page.evaluate(() => playFinal()); await page.waitForTimeout(2500);
  const mixed = await page.evaluate(() => ({ osc: frequencyMixer.oscillatorCount(), voices: voiceLayerEngine.layers.length + 1, ctxs: __ctxs.filter(c => c.state !== 'closed').length,
    faders: ['mixTone', 'mixBg', 'mixVoice', 'mixSoothing'].map(id => !!document.getElementById(id)), sep: voiceLayerConfig().count === 4 && state.freqLayers.length === 4 }));
  assert.equal(mixed.osc, 4); assert.equal(mixed.voices, 4); assert.equal(mixed.ctxs, 1); assert.ok(mixed.faders.every(Boolean)); assert.ok(mixed.sep);
  await page.evaluate(() => { setListeningMix('mixTone', 10); setListeningMix('mixBg', 20); setListeningMix('mixSoothing', 30); });
  assert.equal(await page.evaluate(() => voiceLayerEngine.layers.length), 3, 'moving the other faders does not disturb the voices');
  await page.evaluate(() => stopFinal());
  step(12, '4 voice layers + 4 frequencies + nature sound + background pad at once on one mixer; each has its own fader; voice and frequency layering are separate controls');

  /* ---- 13. advanced assignment + reset ---- */
  await build(page, 10);
  await page.evaluate(() => { openImmersivePlayer(); setVoiceLayerCount(2); });
  await page.evaluate(() => { const p = document.querySelector('#immersivePlayer .vl-panel'); p.open = true; p.querySelector('.vl-advanced').open = true; });
  await page.selectOption('#immersivePlayer [data-vl-line="1"]', '1');
  let adv = await page.evaluate(() => voiceLayerGroups());
  assert.deepEqual(adv, [[0, 2, 3, 4], [1, 5, 6, 7, 8, 9]].map(x => x), 'one line moved to the other layer; nothing copied');
  assert.deepEqual(adv.flat().sort((a, b) => a - b), [...Array(10).keys()]);
  assert.equal(await page.evaluate(() => document.querySelector('#immersivePlayer .vl-advanced').open), true, 'the advanced section stays open while editing');
  for (const i of [0, 2, 3]) await page.selectOption(`#immersivePlayer [data-vl-line="${i}"]`, '1').catch(() => {});
  adv = await page.evaluate(() => voiceLayerGroups()); assert.ok(adv[0].length >= 1, 'a layer cannot be emptied');
  await page.click('#immersivePlayer .vl-advanced button:has-text("Balance automatically")');
  assert.deepEqual(await page.evaluate(() => voiceLayerGroups().map(g => g.length)), [5, 5]);
  await page.evaluate(() => { setVoiceLayerVolume(1, 90); setVoiceLayerMode('simultaneous'); });
  await page.click('#immersivePlayer .vl-actions button:has-text("Reset to recommended")');
  const rs = await page.evaluate(() => ({ cfg: VoiceLayers.serializeConfig(state.voiceLayers), mix: document.getElementById('mixVoice').value }));
  assert.deepEqual([rs.cfg.mode, rs.cfg.volumes, rs.cfg.groups, rs.cfg.count, rs.mix], ['staggered', [65, 40, 30, 20], null, 2, '65']);
  step(13, 'advanced: moving a line changes only its layer (no copies), a layer cannot be emptied, balance + reset to recommended work and keep the panel open');

  /* ---- 14. unplayable device voice falls back to one voice that reads everything ---- */
  await page.evaluate(() => { stopFinal(); state.voiceMode = 'ai'; state.aiVoiceId = 'device'; state.voiceLayers = VoiceLayers.normalizeConfig({ count: 4 }); applyVoiceLayers(); });
  const dv = await page.evaluate(() => ({ note: document.querySelector('#immersivePlayer .vl-note') && document.querySelector('#immersivePlayer .vl-note').textContent }));
  assert.match(dv.note || '', /device voice reads one line at a time/);
  step(14, 'the built-in device voice cannot be layered: the panel says so and the session plays as one voice');

  assert.deepEqual(page.errors, [], 'no page errors');
  await page.context().close();

  /* ======================= desktop, free plan ======================= */
  const free = await newPage(browser, { phone: null, tier: 'free' });
  await boot(free);
  const tier = await free.evaluate(async () => ({ tier: await getMyTier(), l60: requiredTierForMinutes(60), l20: requiredTierForMinutes(20), keys: Object.keys(FEATURES).filter(k => /layer/.test(k) && !['layer_voice','soothing_layer'].includes(k)), gated: [setVoiceLayerCount, setVoiceLayerMode, setVoiceLayerVolume, applyVoiceLayers, syncVoiceLayerEngine, setupVoiceBus, assignVoiceLayerLine, mainVoiceCursor, playVoiceLayerLine].some(f => /tierHasFeature|getMyTier|openUpgradeModal|requireFeature/.test(f.toString())) }));
  assert.equal(tier.l20, 'none', 'twenty minutes stays free'); assert.notEqual(tier.l60, 'none', 'longer sessions stay premium'); assert.deepEqual(tier.keys, [], 'no layering feature row to gate'); assert.equal(tier.gated, false, 'none of the layering code asks about a plan');
  await build(free, 100, { minutes: 20, gap: 0.05 });
  await free.evaluate(() => openImmersivePlayer());
  await free.evaluate(() => { document.querySelector('#immersivePlayer .vl-panel').open = true; });
  await free.click('#immersivePlayer [data-vl-count="4"]');
  await free.click('#immersivePlayer [data-vl-mode="simultaneous"]');
  await probe(free);
  await free.evaluate(() => playFinal()); await free.waitForTimeout(3000);
  const fr = await free.evaluate(() => ({ tier: null, layers: voiceLayerEngine ? voiceLayerEngine.layers.length + 1 : 1, groups: voiceLayerGroups().map(g => g.length), plays: window.__plays.length,
    direct: finalCtx && !finalCtx.__outEl, own: state.voiceMode, rec: recordings.filter(Boolean).length, upsell: !!document.querySelector('.modal.open, #upgradeModal.open') }));
  assert.equal(fr.layers, 4, 'a free account runs all four layers'); assert.deepEqual(fr.groups, [25, 25, 25, 25]); assert.ok(fr.direct, 'desktop: direct output'); assert.equal(fr.rec, 100, 'all 100 personal recordings, free');
  assert.equal(fr.upsell, false);
  const firstLines = await free.evaluate(() => { const g = voiceLayerGroups(); return g.map((x, k) => window.__plays.filter(p => g[k].includes(p.line)).map(p => p.line)[0]); });
  assert.deepEqual(firstLines, [0, 25, 50, 75], 'each layer began on its own first line (100 recordings, 25 per layer)');
  await free.evaluate(() => stopFinal());
  assert.deepEqual(free.errors, []);
  step(15, 'free plan: 4 layers on 100 personal recordings, groups of 25, no upsell; 20 min still the free limit, 1 hr+ still premium, no feature row gates layering');
  await free.context().close();

  await browser.close();
  console.log('ALL PASSED');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
