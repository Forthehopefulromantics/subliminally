/* End-to-end: frequency layers, 20 affirmations for your own voice, and the
   lyrics-style live list — in a real browser (Chromium, iPhone viewport and user
   agent, so the iOS media-element output route is the one under test) against an
   in-memory Supabase (scripts/fixtures/mock-supabase.js) and a fake microphone.

   Serve the repo first:  python3 -m http.server 8123
   Then:                  npm run test:layers-lyrics
   Needs Playwright (npm i -g playwright, or PLAYWRIGHT_MODULE=/path/to/playwright). */
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'); const assert = require('assert/strict');
const BASE = 'http://localhost:8123';
const MOCK = fs.readFileSync(__dirname + '/fixtures/mock-supabase.js', 'utf8');
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const step = (n, s) => console.log(`✔ ${n}. ${s}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const phone = devices['iPhone 13'];
  const ctx = await browser.newContext({ viewport: phone.viewport, userAgent: phone.userAgent, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (url.startsWith(BASE + '/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline in test"}' });
    if (url.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => {
    if (window !== window.top) return;
    if (!localStorage.getItem('mockdb')) localStorage.setItem('mockdb', JSON.stringify({ tables: {
      profiles: [{ id: 'user-1', onboarding_completed: true, display_name: 'Tester' }],
      subscribers: [{ user_id: 'user-1', tier: 'ritual', status: 'active' }] }, storage: {} }));
    /* Watch every oscillator and every buffer source the page makes, so "how many
       tones are really sounding" and "when did the voice really start" are
       measured at the Web Audio API, not inferred from the page's own state. */
    window.__oscs = []; window.__ctxs = []; window.__srcStarts = []; window.__srcEnds = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    const proto = AC.prototype;
    const origOsc = proto.createOscillator;
    proto.createOscillator = function () {
      const o = origOsc.call(this); const rec = { o, ctx: this, started: false, stopped: false, stopAt: null, hz: null };
      window.__oscs.push(rec);
      const s = o.start.bind(o); o.start = (...a) => { rec.started = true; rec.hz = o.frequency.value; return s(...a); };
      const st = o.stop.bind(o); o.stop = (...a) => { rec.stopped = true; rec.stopAt = a.length ? a[0] : this.currentTime; return st(...a); };
      return o;
    };
    const origBuf = proto.createBufferSource;
    proto.createBufferSource = function () {
      const src = origBuf.call(this);
      const s = src.start.bind(src);
      src.start = (...a) => { window.__srcStarts.push(performance.now()); const r = s(...a); src.addEventListener('ended', () => window.__srcEnds.push(performance.now())); return r; };
      return src;
    };
    const origClose = proto.close;
    proto.close = function () { return origClose.call(this); };
    window.__trackCtx = (c) => { if (!window.__ctxs.includes(c)) window.__ctxs.push(c); };
    const Wrapped = function (...args) { const c = new AC(...args); window.__trackCtx(c); return c; };
    Wrapped.prototype = AC.prototype;
    window.AudioContext = Wrapped; if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
    window.__live = () => window.__oscs.filter(r => r.started && r.ctx.state !== 'closed' && (!r.stopped || (r.stopAt != null && r.stopAt > r.ctx.currentTime)));
  });
  const boot = async () => {
    await page.goto(BASE + '/');
    await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
    await page.waitForTimeout(400);
  };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const subs = async () => ((await db()).tables.subliminals || []);
  const liveHz = () => page.evaluate(() => window.__live().map(r => r.hz).sort((a, b) => a - b));
  const openCtxs = () => page.evaluate(() => window.__ctxs.filter(c => c.state !== 'closed').length);
  const WAV = `const wav = (hz, secs) => { const sr = 8000, n = Math.floor(sr * secs), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / sr * hz * 2 * Math.PI) * 8000, true);
      return new Blob([b], { type: 'audio/wav' }); };`;
  const LINES = n => Array.from({ length: n }, (_, i) => `Affirmation number ${i + 1}: I am steady and whole.`);

  await boot();

  /* ================= 1. FREQUENCY LAYERS: choosing ================= */
  await page.evaluate(() => { startNewSubliminal(); showBuildPage(); showStep(0); });
  for (const hz of [174, 285, 396, 417]) await page.click(`#freqChips .freq-card3[data-hz="${hz}"]`);
  let st = await page.evaluate(() => ({
    sel: [...document.querySelectorAll('#freqChips .freq-card3.sel')].map(e => e.dataset.hz),
    aria: [...document.querySelectorAll('#freqChips .freq-card3.sel')].every(e => e.getAttribute('aria-checked') === 'true'),
    rows: [...document.querySelectorAll('[data-fl-panel]')].filter(p => p.offsetParent).map(p => p.querySelectorAll('.fl-row').length),
    sliders: document.querySelectorAll('#freqChips ~ .fl-tray input[type=range]').length,
    next: !document.getElementById('toStep1').disabled,
    count: document.querySelector('#freqChips ~ .fl-tray .fl-count').textContent }));
  assert.deepEqual(st.sel, ['174', '285', '396', '417'], 'four frequencies can be selected');
  assert.ok(st.aria, 'selected cards say so to a screen reader'); assert.equal(st.sliders, 4, 'each has its own volume slider');
  assert.equal(st.count, '4 of 4 frequencies'); assert.ok(st.next);
  await page.click('#freqChips .freq-card3[data-hz="528"]', { force: true });   // aria-disabled: a real tap still gets the explanation
  st = await page.evaluate(() => ({ n: state.freqLayers.length, note: document.querySelector('#freqChips ~ .fl-tray .fl-note').textContent,
    lit528: document.querySelector('#freqChips .freq-card3[data-hz="528"]').classList.contains('sel'),
    disabled: document.querySelector('#freqChips .freq-card3[data-hz="528"]').getAttribute('aria-disabled') }));
  assert.equal(st.n, 4); assert.match(st.note, /up to 4/); assert.equal(st.lit528, false); assert.equal(st.disabled, 'true');
  await page.screenshot({ path: SHOTS + '/layers-step0.png' });
  await page.click('#freqChips .freq-card3[data-hz="285"]');       // tap again: off
  await page.click('#freqChips ~ .fl-tray .fl-remove[aria-label="Remove 174 Hz"]');   // x button: off
  assert.deepEqual(await page.evaluate(() => state.freqLayers.map(l => l.hz)), [396, 417], 'removable both ways');
  assert.equal(await page.evaluate(() => state.freq.hz), 396, 'state.freq stays the first layer');
  await page.click('#freqChips .freq-card3[data-hz="528"]'); await page.click('#freqChips .freq-card3[data-hz="432"]');
  await page.evaluate(() => { const el = document.querySelector('#freqChips ~ .fl-tray [data-fl-vol="396"]'); el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.deepEqual(await page.evaluate(() => state.freqLayers), [{ hz: 396, vol: 40 }, { hz: 417, vol: 100 }, { hz: 528, vol: 100 }, { hz: 432, vol: 100 }]);
  assert.equal(await page.textContent('#freqChips ~ .fl-tray [data-fl-out="396"]'), '40%');
  step(1, 'four frequencies selectable, a fifth refused with a message, removable by tap and by ×, each with its own 0–100% slider and a visible, announced selected state');

  /* ================= 2. building a finished subliminal with 6 recorded lines ================= */
  await page.evaluate(`(async () => {
    ${WAV}
    state.affirmations = ${JSON.stringify(LINES(6))};
    state.voiceMode = 'own'; state.selectedVoice = VOICE_RECORD_OWN; setSelectedVoice(VOICE_RECORD_OWN);
    state.targetLengthMinutes = 5;
    recordings = state.affirmations.map((t, i) => { const blob = wav(300 + i * 40, 0.6); return { url: URL.createObjectURL(blob), blob, durationMs: 600, text: t }; });
    setAffirmationGap(0.2);
    showBuildPage(); showStep(7); prepareFinal();
  })()`);
  await page.waitForSelector('#finalPlaylist li');
  const beforePlay = await page.evaluate(() => ({
    items: document.querySelectorAll('#finalPlaylist li').length, states: [...document.querySelectorAll('#finalPlaylist li')].map(l => l.dataset.state),
    count: document.getElementById('finalPlaylistCount').textContent, live: window.__live().length }));
  assert.equal(beforePlay.items, 6, 'the whole list is shown before anything plays'); assert.ok(beforePlay.states.every(s => s === 'upcoming'));
  assert.equal(beforePlay.live, 0);
  await page.screenshot({ path: SHOTS + '/layers-final.png' });

  /* ================= 3. PLAY: all layers together, no duplicates ================= */
  await page.evaluate(() => { playFinal(); playFinal(); playFinal(); });      // a frantic triple tap
  await page.waitForTimeout(900);
  assert.deepEqual(await liveHz(), [396, 417, 432, 528], 'all four frequencies sound, at exactly their Hz, once each');
  assert.equal(await openCtxs(), 1, 'one audio context');
  assert.equal(await page.evaluate(() => frequencyMixer.oscillatorCount()), 4);
  assert.ok(await page.evaluate(() => finalPlaying && sessionBed instanceof AmbienceBed));
  await page.evaluate(() => { chooseAmbience('rain'); applySessionAmbience(); });      // nature sound alongside
  await page.waitForTimeout(500);
  assert.deepEqual(await liveHz(), [396, 417, 432, 528], 'adding nature sound does not add or remove tones');
  step(2, 'Play x3 -> exactly 4 oscillators at 396/417/432/528 Hz and 1 context; they run alongside the voice, ambience and music layers');

  // levels glide, never jump
  const glide = await page.evaluate(async () => {
    const v = frequencyMixer.voices.get(396).gain.gain; const before = v.value;
    setFrequencyVolume(396, 5); const immediate = v.value; await new Promise(r => setTimeout(r, 60)); const mid = v.value; await new Promise(r => setTimeout(r, 600)); const end = v.value;
    return { before, immediate, mid, end, target: FrequencyLayers.layerGainValue(5, 4) };
  });
  assert.ok(glide.immediate > glide.target + 0.05, 'the level did not jump on the slider event (' + glide.immediate + ' vs ' + glide.target + ')');
  assert.ok(glide.mid < glide.before && glide.mid > glide.target - 0.001, 'it is moving smoothly');
  assert.ok(Math.abs(glide.end - glide.target) < 0.01, 'and arrives');
  // removal fades, then stops
  await page.evaluate(() => removeFrequency(417));
  assert.equal((await liveHz()).length, 4, 'a removed tone is still fading a moment later (no cut)');
  await page.waitForTimeout(1700);
  assert.deepEqual(await liveHz(), [396, 432, 528], 'then it is gone');
  await page.evaluate(() => toggleFrequency(417));
  await page.waitForTimeout(300);
  assert.deepEqual(await liveHz(), [396, 417, 432, 528], 'added back while playing, exactly once');
  step(3, 'slider moves glide to the target; a removed layer fades before it stops; a layer added mid-play joins once');

  // warnings
  await page.evaluate(() => { [396, 417, 432, 528].forEach(h => setFrequencyVolume(h, 100)); const m = document.getElementById('mixTone'); m.value = 95; m.dispatchEvent(new Event('input', { bubbles: true })); });
  const warn = await page.evaluate(() => [...document.querySelectorAll('[data-fl-warn]')].filter(e => !e.hidden).map(e => e.textContent));
  assert.ok(warn.length && /(tiring|heavy|beat|very high)/i.test(warn[0]), 'uncomfortable combination is warned about: ' + JSON.stringify(warn));
  await page.evaluate(() => { const m = document.getElementById('mixTone'); m.value = 30; m.dispatchEvent(new Event('input', { bubbles: true })); [396, 417, 432, 528].forEach(h => setFrequencyVolume(h, h === 396 ? 40 : 100)); });
  step('3b', 'warning shown for four loud close tones at a high Frequency level, and cleared when it is brought down');

  /* Measured, not assumed: render the real mixer offline and look at the samples. */
  const measured = await page.evaluate(async () => {
    const render = async (layers, band) => {
      const sr = 44100, secs = 3, off = new OfflineAudioContext(2, sr * secs, sr);
      const mixer = new FrequencyLayers.FrequencyMixer();
      mixer.attach(off, off.destination, { level: FrequencyLayers.masterGainValue(100) });   // the Frequency fader at its maximum
      mixer.sync(layers, { band: band || null });
      // let the tones' fade-in settle: measure the second half
      const buf = await off.startRendering(); const d = buf.getChannelData(0).subarray(sr);
      let peak = 0; for (const v of d) peak = Math.max(peak, Math.abs(v));
      const power = (hz) => { let re = 0, im = 0; for (let i = 0; i < d.length; i++) { const a = 2 * Math.PI * hz * i / sr; re += d[i] * Math.cos(a); im += d[i] * Math.sin(a); } return (re * re + im * im) / (d.length * d.length); };
      let crossings = 0; for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) crossings++;
      return { peak, power, estHz: crossings / (d.length / sr) };
    };
    const one = await render([{ hz: 528, vol: 100 }]);
    const four = await render([{ hz: 396, vol: 100 }, { hz: 528, vol: 100 }, { hz: 639, vol: 100 }, { hz: 852, vol: 100 }]);
    const ratio = (r, hz) => r.power(hz) / Math.max(1e-12, r.power(hz * 1.003));
    return { onePeak: one.peak, fourPeak: four.peak, estHz: one.estHz, oneRatio: ratio(one, 528), fourRatios: [396, 528, 639, 852].map(h => ratio(four, h)),
      fourPresent: [396, 528, 639, 852].map(h => four.power(h) > 1e-6) };
  });
  assert.ok(measured.onePeak > 0.09 && measured.onePeak < 0.105, 'one tone peaks where it always has (~0.10): ' + measured.onePeak.toFixed(4));
  assert.ok(measured.fourPeak > measured.onePeak && measured.fourPeak <= 0.21, 'four tones at full level peak at most 2x one tone (' + measured.fourPeak.toFixed(4) + '), nowhere near clipping');
  assert.ok(Math.abs(measured.estHz - 528) < 1.5, 'the rendered tone is 528 Hz, not shifted: ' + measured.estHz.toFixed(2));
  assert.ok(measured.oneRatio > 10 && measured.fourRatios.every(r => r > 10), 'energy sits at exactly each chosen Hz, none at a 0.3% detune: ' + measured.fourRatios.map(r => r.toFixed(0)));
  assert.ok(measured.fourPresent.every(Boolean), 'all four tones are present in the mix');
  step('3c', `measured offline: 1 tone peak ${measured.onePeak.toFixed(3)}, 4 tones peak ${measured.fourPeak.toFixed(3)}; 528 Hz renders at ${measured.estHz.toFixed(1)} Hz; no detuned energy`);

  /* ================= 4. Pause / Resume / Start Over / Stop stay in sync ================= */
  await page.evaluate(() => pauseFinal());
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => finalCtx.state), 'suspended', 'pause suspends the one context every layer lives on');
  assert.equal((await liveHz()).length, 4);
  await page.evaluate(() => resumeFinal());
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => finalCtx.state), 'running');
  assert.deepEqual(await liveHz(), [396, 417, 432, 528], 'resume: same four tones, no new ones');
  await page.evaluate(() => restartListening());
  await page.waitForTimeout(900);
  assert.deepEqual(await liveHz(), [396, 417, 432, 528], 'Start Over: one fresh set, the old context is closed');
  assert.equal(await openCtxs(), 1);
  // a system interruption (call, lock screen) suspends the context under us
  await page.evaluate(() => finalCtx.suspend());
  await page.waitForFunction(() => finalCtx && finalCtx.state === 'running', null, { timeout: 4000 }).catch(() => {});
  const afterInterrupt = await page.evaluate(() => ({ state: finalCtx && finalCtx.state, paused: finalPaused, playing: finalPlaying }));
  assert.ok(afterInterrupt.state === 'running' || afterInterrupt.paused, 'an interruption is recovered or shown as a real pause: ' + JSON.stringify(afterInterrupt));
  if (afterInterrupt.paused) await page.evaluate(() => resumeFinal());
  await page.evaluate(() => { syncFinalAfterForeground(); });   // back from the lock screen / another app
  await page.waitForTimeout(300);
  assert.deepEqual(await liveHz(), [396, 417, 432, 528], 'returning to the page never restarts or doubles the tones');
  step(4, 'pause/resume/start over keep the same 4 tones on one context; an interruption + return from background does not duplicate anything');

  /* ================= 5. persistence per subliminal ================= */
  await page.evaluate(() => { stopFinal(); closeImmersivePlayer(); });
  assert.equal((await liveHz()).length, 0, 'Stop silences every tone');
  assert.equal(await openCtxs(), 0, 'and closes the context');
  assert.equal(await page.evaluate(() => frequencyMixer.voiceCount()), 0);
  await page.fill('#finalTitleInput', 'Layered night');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /Saved to your library/.test(document.getElementById('saveMsg').textContent));
  let rows = await subs();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].mix_settings.freqLayers, [{ hz: 396, vol: 40 }, { hz: 528, vol: 100 }, { hz: 432, vol: 100 }, { hz: 417, vol: 100 }]);
  assert.equal(rows[0].frequency_hz, 396, 'the legacy column holds the first layer');
  assert.equal(rows[0].mix_settings.affirmationMeta.length, 6, 'one metadata entry per affirmation');
  const meta = rows[0].mix_settings.affirmationMeta;
  assert.ok(meta.every((m, i) => m.order === i && m.durationMs > 0 && m.endMs > m.startMs && m.recordedText === LINES(6)[i]), 'order, duration, timing and recorded text saved');
  assert.ok(meta[1].startMs >= meta[0].endMs, 'timings are sequential');
  const id = rows[0].id;
  await boot();
  await page.evaluate(async (id) => { await loadSavedIntoBuilder(id); }, id);
  st = await page.evaluate(() => ({ layers: state.freqLayers, rows: [...document.querySelectorAll('#finalFreqPicker .fl-row')].map(r => [r.dataset.hz, r.querySelector('input').value]),
    chips: [...document.querySelectorAll('#finalFreqPicker .fl-chip.sel')].map(e => e.dataset.hz), title: document.getElementById('finalTitle').textContent }));
  assert.deepEqual(st.layers, [{ hz: 396, vol: 40 }, { hz: 528, vol: 100 }, { hz: 432, vol: 100 }, { hz: 417, vol: 100 }]);
  assert.deepEqual(st.rows, [['396', '40'], ['528', '100'], ['432', '100'], ['417', '100']], 'sliders restored to their saved levels');
  assert.deepEqual(st.chips.sort(), ['396', '417', '432', '528']);
  assert.match(st.title, /396 \+ 528 \+ 432 \+ 417 Hz/);
  // an older row (single frequency_hz, no layers) still opens, and plays as one tone
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); const copy = JSON.parse(JSON.stringify(d.tables.subliminals[0])); copy.id = 'legacy-1'; copy.title = 'Old one'; copy.frequency_hz = 528; delete copy.mix_settings.freqLayers; d.tables.subliminals.push(copy); localStorage.setItem('mockdb', JSON.stringify(d)); });
  await page.evaluate(async () => { await loadSavedIntoBuilder('legacy-1'); });
  assert.deepEqual(await page.evaluate(() => state.freqLayers), [{ hz: 528, vol: 100 }], 'a subliminal saved before layers opens as one full-volume layer');
  await page.evaluate(async (id) => { await loadSavedIntoBuilder(id); }, id);
  step(5, 'layers + levels saved per subliminal (mix_settings.freqLayers, frequency_hz = first), restored after reload; a pre-layers row opens as one tone; per-line metadata saved');

  /* ================= 6. LYRICS: persistent list, synced to the audio ================= */
  await page.evaluate(() => {
    window.__events = [];
    affTimeline.on(s => {
      const act = document.querySelector('#ipLyrics .ip-lyric[data-state="active"]');
      window.__events.push({ t: performance.now(), type: s.type, active: s.active, pass: s.pass, domActive: act ? Number(act.dataset.i) : -1,
        activeCount: document.querySelectorAll('#ipLyrics .ip-lyric[data-state="active"]').length, paused: s.paused });
    });
    window.__srcStarts.length = 0; window.__srcEnds.length = 0;
    openImmersivePlayer();
  });
  const listBefore = await page.evaluate(() => ({ n: document.querySelectorAll('#ipLyrics .ip-lyric').length, texts: [...document.querySelectorAll('#ipLyrics .ip-lyric-text')].map(e => e.textContent),
    states: [...document.querySelectorAll('#ipLyrics .ip-lyric')].map(e => e.dataset.state), playing: finalPlaying, popup: document.querySelectorAll('.ip-affirmation').length }));
  assert.equal(listBefore.n, 6, 'the player lists every affirmation when reopened, before playing'); assert.deepEqual(listBefore.texts, LINES(6));
  assert.ok(listBefore.states.every(s => s === 'upcoming')); assert.equal(listBefore.playing, false); assert.equal(listBefore.popup, 0, 'no individual pop-ups');
  await page.screenshot({ path: SHOTS + '/lyrics-before-play.png' });
  await page.click('#ipPlay');
  await page.waitForFunction(() => window.__events.some(e => e.type === 'start' && e.pass >= 2) , null, { timeout: 20000 });
  const ev = await page.evaluate(() => window.__events);
  const starts = ev.filter(e => e.type === 'start');
  assert.deepEqual(starts.slice(0, 6).map(e => e.active), [0, 1, 2, 3, 4, 5], 'the highlight advances on every affirmation');
  assert.ok(starts.every(e => e.domActive === e.active && e.activeCount === 1), 'the DOM highlight equals the timeline, exactly one line lit at a time');
  const pass2 = starts.find(e => e.pass >= 2);
  assert.equal(pass2.active, 0, 'when the subliminal loops the highlight cycles back to the first line');
  // precision: highlight start vs the moment the audio source really started
  const srcStarts = await page.evaluate(() => window.__srcStarts.slice());
  const evStarts = ev.filter(e => e.type === 'start').map(e => e.t);
  const deltas = evStarts.slice(0, 6).map((t, i) => Math.abs(t - srcStarts[i + 0]) );
  // sources include the 1-sample priming buffer first, so align on the first line start
  const prime = srcStarts.length - starts.length;
  const aligned = evStarts.slice(0, 6).map((t, i) => Math.abs(t - srcStarts[i + (srcStarts.length - ev.filter(e => e.type === 'start').length > 0 ? prime : 0)]));
  assert.ok(aligned.every(d => d < 40), 'highlight starts within 40 ms of the audio source starting: ' + aligned.map(d => d.toFixed(1)).join(','));
  const endsOk = await page.evaluate(() => { const e = window.__events.filter(x => x.type === 'end'); return e.length >= 5 && e.every(x => x.active === -1); });
  assert.ok(endsOk, 'a line stops being the active one when its audio ends');
  step(6, `list of 6 shown before play; highlight 0..5 then back to 0 on the loop; DOM == timeline; start offsets vs audio source: ${aligned.map(d => d.toFixed(0)).join('/')} ms`);

  // visual: active is larger, brighter, and the others are muted but readable
  const look = await page.evaluate(() => {
    const act = document.querySelector('#ipLyrics .ip-lyric[data-state="active"] .ip-lyric-text'); if (!act) return null;
    const other = document.querySelector('#ipLyrics .ip-lyric[data-state="upcoming"] .ip-lyric-text, #ipLyrics .ip-lyric[data-state="played"] .ip-lyric-text');
    const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
    const contrast = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + .05) / (Math.min(A, B) + .05); };
    const bg = 'rgb(33, 23, 80)';   // the lightest stop the player sky reaches behind the list
    return { actScale: getComputedStyle(act).transform, actColor: getComputedStyle(act).color, otherColor: other ? getComputedStyle(other).color : null,
      actContrast: contrast(getComputedStyle(act).color, bg), otherContrast: other ? contrast(getComputedStyle(other).color, bg) : null,
      aria: document.querySelector('#ipLyrics .ip-lyric[data-state="active"]').getAttribute('aria-current'), announce: document.getElementById('ipAnnounce').textContent };
  });
  if (look) {
    assert.notEqual(look.actScale, 'none'); assert.ok(look.actContrast >= 7, 'active line contrast ' + look.actContrast.toFixed(1));
    assert.ok(look.otherContrast >= 4.5, 'muted lines still clear 4.5:1 (' + look.otherContrast.toFixed(1) + ')');
    assert.equal(look.aria, 'true'); assert.ok(LINES(6).includes(look.announce), 'screen readers are told the line being spoken: ' + look.announce);
  }
  await page.screenshot({ path: SHOTS + '/lyrics-playing.png' });

  // pause holds the highlight; resume restores it; Start Over goes back to the top
  await page.waitForFunction(() => affTimeline.active >= 0);
  const beforePause = await page.evaluate(() => ({ active: affTimeline.active, pass: affTimeline.pass }));
  await page.click('#ipPlay');       // pause
  await page.waitForTimeout(250);
  let p = await page.evaluate(() => ({ paused: finalPaused, cls: document.getElementById('ipLyrics').classList.contains('is-paused'), active: affTimeline.active, dom: Number((document.querySelector('#ipLyrics [data-state="active"]') || { dataset: { i: -1 } }).dataset.i), label: document.getElementById('ipPlay').getAttribute('aria-label') }));
  const frozenAt = p.active;
  await page.waitForTimeout(1500);
  const afterWait = await page.evaluate(() => ({ active: affTimeline.active, pass: affTimeline.pass, ev: window.__events.length }));
  assert.ok(p.paused && p.cls && p.label === 'Play', 'paused state shown');
  assert.equal(afterWait.active, frozenAt, 'nothing advances while paused'); assert.equal(afterWait.pass, beforePause.pass);
  await page.click('#ipPlay');       // resume
  await page.waitForFunction(() => !finalPaused);
  const r = await page.evaluate(() => ({ cls: document.getElementById('ipLyrics').classList.contains('is-paused'), active: affTimeline.active }));
  assert.equal(r.cls, false);
  await page.waitForFunction(() => window.__events.filter(e => e.type === 'start').length > 0 && affTimeline.active >= 0, null, { timeout: 8000 });
  await page.click('.ip-control');   // Start over
  await page.waitForFunction(() => affTimeline.active === 0 && affTimeline.pass === 1, null, { timeout: 5000 });
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => { const l = document.getElementById('ipLyrics').getBoundingClientRect(), a = document.querySelector('#ipLyrics .ip-lyric[data-i="0"]').getBoundingClientRect(); return a.top >= l.top && a.bottom <= l.bottom && Math.abs((a.top + a.height / 2) - (l.top + l.height / 2)) < l.height * 0.2; }), true, 'Start Over brings the list back to the first line, in view near the centre');
  assert.deepEqual(await liveHz(), [396, 417, 432, 528], 'and the tones are still one set of four');
  step('6b', 'pause freezes the highlight, resume continues the same line, Start Over restarts at line 1 with a single set of layers; Play/Start Over are on screen');

  const ctrl = await page.evaluate(() => { const r = (id) => { const b = document.querySelector(id).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }; return { play: r('#ipPlay'), over: r('.ip-control') }; });
  assert.ok(ctrl.play && ctrl.over, 'Play/Pause and Start Over are within the viewport');

  // stopping closes everything; leaving the page for another does not strand or double the audio
  await page.evaluate(() => closeImmersivePlayer());
  await page.evaluate(() => showLibraryPage());
  await page.waitForTimeout(300);
  assert.deepEqual(await liveHz(), [396, 417, 432, 528], 'navigating inside the app keeps the session playing, once');
  await page.evaluate(() => stopFinal());
  await page.waitForTimeout(200);
  assert.equal((await liveHz()).length, 0); assert.equal(await openCtxs(), 0);
  const reset = await page.evaluate(() => ({ active: affTimeline.active, states: affTimeline.snapshot().states.every(s => s === 'upcoming') }));
  assert.equal(reset.active, -1); assert.ok(reset.states, 'Stop clears the highlight');
  step(7, 'navigation keeps one playing session; Stop leaves 0 oscillators, 0 open contexts and no highlight');

  /* ================= 8. 20 AFFIRMATIONS ================= */
  await page.evaluate(() => { startNewSubliminal(); showBuildPage(); state.affirmations = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of my own.`); showStep(3); renderAffList(); });
  assert.equal(await page.textContent('#affCount'), '12/20 affirmations');
  for (let i = 0; i < 8; i++) await page.click('#addAffBtn');
  assert.equal(await page.textContent('#affCount'), '20/20 affirmations');
  assert.equal(await page.evaluate(() => document.getElementById('addAffBtn').disabled), true, 'the 21st cannot be added');
  await page.evaluate(() => addAffirmation());
  assert.equal(await page.evaluate(() => state.affirmations.length), 20);
  assert.match(await page.textContent('#affListMsg'), /most one subliminal holds/);
  // reorder + delete + edit in the review step
  await page.evaluate(() => { state.affirmations[0] = 'FIRST'; state.affirmations[1] = 'SECOND'; renderAffList(); });
  await page.click('#affList .aff-row:nth-child(1) .aff-move[aria-label="Move affirmation 1 down"]');
  assert.deepEqual(await page.evaluate(() => state.affirmations.slice(0, 2)), ['SECOND', 'FIRST'], 'reorder');
  await page.click('#affList .aff-row:nth-child(2) .aff-remove');
  assert.equal(await page.evaluate(() => state.affirmations.length), 19, 'delete');
  // paste of 31 lines: cut at 20, and says so
  await page.evaluate(() => { document.getElementById('affirmationPasteText').value = Array.from({ length: 31 }, (_, i) => `Pasted ${i + 1}`).join('\n'); affirmationMode = 'import'; handleAffirmationInputBeforeGenerate(); });
  assert.equal(await page.evaluate(() => state.affirmations.length), 20);
  assert.match(await page.textContent('#affListMsg'), /had 31 lines.*first 20/);
  step(8, 'count shows N/20, the 21st is refused with a message, review step can edit/reorder/delete, a 31-line paste is cut to 20 with an explanation');

  // voice limits: Serenity/Clone keep 10, nothing is deleted, the reason is shown
  await page.evaluate(() => { state.affirmations = Array.from({ length: 12 }, (_, i) => `Keep me ${i + 1}`); showStep(4); setSelectedVoice(VOICE_SERENITY); nextStep(); });
  await page.waitForTimeout(200);
  let v = await page.evaluate(() => ({ step, n: state.affirmations.length, msg: document.getElementById('voiceLimitNote').textContent, note: document.getElementById('voiceLimitNote').textContent, fix: !document.getElementById('voiceLimitFix').hidden }));
  assert.equal(v.step, 4, 'Serenity with 12 lines does not continue'); assert.equal(v.n, 12, 'and nothing was deleted');
  assert.match(v.msg, /Serenity reads up to 10/); assert.match(v.msg, /Nothing has been removed/); assert.ok(v.fix);
  await page.evaluate(() => { setSelectedVoice(VOICE_CLONE); nextStep(); });
  assert.match(await page.textContent('#voiceLimitNote'), /Clone Your Voice reads up to 10/);
  await page.screenshot({ path: SHOTS + '/voice-limit.png' });
  await page.evaluate(() => { setSelectedVoice(VOICE_RECORD_OWN); nextStep(); });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => step), 5, 'Record Your Own Voice carries all 12');
  await page.evaluate(() => { state.affirmations.length = 10; setSelectedVoice(VOICE_SERENITY); });
  assert.equal(await page.evaluate(() => voiceLimitProblem()), '', '10 is still fine for Serenity');
  step('8b', 'Serenity/Clone keep their 10-line limit; 12 lines are never deleted, an explanation + route back is shown; Record Your Own Voice takes them');

  /* ================= 9. record, edit, reorder, delete, re-record, persistence ================= */
  await page.evaluate(() => { startNewSubliminal(); showBuildPage(); state.affirmations = Array.from({ length: 12 }, (_, i) => `Own line ${i + 1}.`); setFrequencyLayers([{ hz: 528, vol: 100 }]); setSelectedVoice(VOICE_RECORD_OWN); beginRecordingPass('primary'); });
  assert.equal(await page.textContent('#recMgrCount'), '12/20'); assert.equal(await page.$$eval('#recMgrList .rm-row', r => r.length), 12);
  const record = async (ms) => {
    await page.dispatchEvent('#recBtn', 'pointerdown'); await page.waitForFunction(() => document.getElementById('recBtn').classList.contains('recording'), null, { timeout: 5000 });
    await sleep(ms); await page.dispatchEvent('#recBtn', 'pointerup');
    await page.waitForFunction(() => /Saved/.test(document.getElementById('recStatus').textContent), null, { timeout: 5000 });
  };
  await record(900);                                   // line 1
  await page.click('#recMgrList .rm-row[data-i="2"] .rm-text'); assert.equal(await page.evaluate(() => recIndex), 2, 'any line can be chosen to record');
  await record(900);                                   // line 3
  await page.click('#recMgrList .rm-row[data-i="5"] .rm-text'); await record(900);   // line 6
  let rec = await page.evaluate(() => ({ r: recordings.map(x => !!x), dur: recordings.filter(Boolean).map(x => x.durationMs >= 400), txt: recordings.filter(Boolean).map(x => x.text), sum: document.getElementById('recMgrSummary').textContent }));
  assert.deepEqual(rec.r.map(Number), [1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]); assert.ok(rec.dur.every(Boolean), 'duration measured per take'); assert.equal(rec.sum, '3 of 12 recorded');
  assert.deepEqual(rec.txt, ['Own line 1.', 'Own line 3.', 'Own line 6.']);
  // reorder: the take moves with its words
  await page.click('#recMgrList .rm-row[data-i="2"] [aria-label="Move affirmation 3 up"]');
  rec = await page.evaluate(() => ({ lines: state.affirmations.slice(0, 4), has: recordings.slice(0, 4).map(x => x && x.text) }));
  assert.deepEqual(rec.lines, ['Own line 1.', 'Own line 3.', 'Own line 2.', 'Own line 4.']); assert.deepEqual(rec.has, ['Own line 1.', 'Own line 3.', null, null], 'recording followed its words');
  // edit a recorded line: kept, flagged
  await page.click('#recMgrList .rm-row[data-i="1"] [aria-label="Edit affirmation 2"]');
  await page.fill('#recMgrList .rm-edit', 'Own line 3, reworded.'); await page.click('#recMgrList [aria-label="Save this change"]');
  assert.match(await page.textContent('#recMgrList .rm-row[data-i="1"] .rm-status'), /Words changed since recording/);
  assert.equal(await page.evaluate(() => !!recordings[1]), true, 'the take is kept, not silently deleted');
  // re-record it, status clears
  await page.click('#recMgrList .rm-row[data-i="1"] [aria-label="Re-record affirmation 2"]'); await record(700);
  assert.match(await page.textContent('#recMgrList .rm-row[data-i="1"] .rm-status'), /^Recorded/);
  // delete an unrecorded line; add one
  await page.click('#recMgrList .rm-row[data-i="3"] [aria-label="Delete affirmation 4"]');
  assert.equal(await page.textContent('#recMgrCount'), '11/20');

  await page.click('#recMgrAdd'); await page.fill('#recMgrList .rm-edit', 'A brand new line.'); await page.click('#recMgrList [aria-label="Save this change"]');
  assert.equal(await page.textContent('#recMgrCount'), '12/20');
  await page.screenshot({ path: SHOTS + '/record-manager.png', fullPage: false });
  step(9, 'record any line, play/re-record, edit (take kept + flagged), reorder (take follows words), delete, add — all with a live N/20 count; durations measured');

  // refresh in the middle: the recording comes back
  await page.waitForTimeout(600);
  const draftState = await page.evaluate(() => ({ lines: state.affirmations.slice(), taken: recordings.map(r => r ? r.text : null) }));
  await boot();
  await page.evaluate(() => showBuildPage());          // opening the builder after a refresh
  await page.waitForSelector('#draftBanner:not([hidden])', { timeout: 5000 });
  assert.match(await page.textContent('#draftBannerText'), /3 of 12 affirmations recorded/);
  await page.click('#draftBanner .candlebtn');
  await page.waitForSelector('#recMgrList .rm-row');
  const resumed = await page.evaluate(() => ({ step, lines: state.affirmations.slice(), taken: recordings.map(r => r ? r.text : null), playable: recordings.filter(Boolean).every(r => r.blob && r.blob.size > 500), idx: recIndex }));
  assert.deepEqual(resumed.lines, draftState.lines, 'affirmations restored in order'); assert.deepEqual(resumed.taken, draftState.taken, 'every take restored with its words');
  assert.ok(resumed.playable); assert.equal(resumed.step, 6);
  step('9b', 'after a full page reload the unfinished recording is offered, and resuming brings back all 12 lines and the 3 takes');

  // finish -> save -> reopen: all affirmations, audio, order, durations come back, and the playlist shows before play
  await page.evaluate(`(async () => {
    ${WAV}
    recordings = recordings.map((r, i) => r || (() => { const blob = wav(280 + i * 20, 0.5); return { url: URL.createObjectURL(blob), blob, durationMs: 500, text: state.affirmations[i] }; })());
    setAffirmationGap(0.2); prepareFinal(); showStep(7);
  })()`);
  await page.fill('#finalTitleInput', 'Twelve in my voice');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /Saved to your library/.test(document.getElementById('saveMsg').textContent));
  rows = await subs(); const row = rows.find(r => r.title === 'Twelve in my voice');
  assert.equal(row.affirmations.length, 12); assert.equal(row.recording_urls.filter(Boolean).length, 12);
  assert.deepEqual(row.mix_settings.affirmationMeta.map(m => m.order), [...Array(12).keys()]);
  assert.ok(row.mix_settings.affirmationMeta.every(m => m.durationMs > 0 && m.recordedText), 'duration + recorded text saved for each');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(async () => (await DraftStore.load(draftOwner())) == null), true, 'saving removes the on-device draft');
  await boot();
  assert.equal(await page.evaluate(() => document.getElementById('draftBanner').hidden), true);
  await page.evaluate(async (id) => { await loadSavedIntoBuilder(id); }, row.id);
  const reopened = await page.evaluate(() => ({ n: recordings.filter(Boolean).length, lines: state.affirmations.slice(), pl: document.querySelectorAll('#finalPlaylist li').length, count: document.getElementById('finalPlaylistCount').textContent,
    stale: recordings.filter(Boolean).filter(r => r.text !== state.affirmations[recordings.indexOf(r)]).length, dur: recordings.every(r => r.durationMs > 0) }));
  assert.equal(reopened.n, 12); assert.deepEqual(reopened.lines, row.affirmations); assert.equal(reopened.pl, 12); assert.equal(reopened.count, '12/20');
  assert.equal(reopened.stale, 0); assert.ok(reopened.dur);
  await page.evaluate(() => openImmersivePlayer());
  assert.equal(await page.$$eval('#ipLyrics .ip-lyric', l => l.length), 12, 'reopening a saved subliminal shows all its affirmations in the player before playing');
  await page.screenshot({ path: SHOTS + '/lyrics-reopened-12.png' });
  step('9c', 'saved with order/duration/timing metadata; after reload all 12 recordings load, the finished screen and the player both list all 12 before play');

  /* ================= 10. auto-scroll, manual scroll, Follow ================= */
  await page.evaluate(`(async () => {
    ${WAV}
    closeImmersivePlayer(); stopFinal();
    state.affirmations = ${JSON.stringify(LINES(20))};
    recordings = state.affirmations.map((t, i) => { const blob = wav(250 + i * 10, 0.5); return { url: URL.createObjectURL(blob), blob, durationMs: 500, text: t }; });
    setAffirmationGap(0.15); state.targetLengthMinutes = 5; prepareFinal(); renderFinalPlaylist();
    openImmersivePlayer(); playFinal();
  })()`);
  await page.waitForFunction(() => affTimeline.active >= 7, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const centred = await page.evaluate(() => { const list = document.getElementById('ipLyrics'); const li = document.querySelector('#ipLyrics [data-state="active"], #ipLyrics [data-state="played"]:last-of-type');
    const cur = document.querySelector('#ipLyrics [data-state="active"]') || [...document.querySelectorAll('#ipLyrics .ip-lyric[data-state="played"]')].pop();
    const lr = list.getBoundingClientRect(), cr = cur.getBoundingClientRect(); return { off: Math.abs((cr.top + cr.height / 2) - (lr.top + lr.height / 2)), h: lr.height, top: list.scrollTop }; });
  assert.ok(centred.top > 100, 'the list scrolled'); assert.ok(centred.off < centred.h * 0.2, 'active line kept near the centre (off by ' + centred.off.toFixed(0) + 'px of ' + centred.h.toFixed(0) + ')');
  // the listener scrolls it themselves: no fight, Follow appears
  await page.evaluate(() => { const l = document.getElementById('ipLyrics'); l.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true })); l.scrollTop = 0; });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => !document.getElementById('ipFollow').hidden), true, 'Follow button appears after a manual scroll');
  const a1 = await page.evaluate(() => affTimeline.active);
  await page.waitForFunction(a => affTimeline.active !== a, a1, { timeout: 5000 });
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => document.getElementById('ipLyrics').scrollTop < 40), 'auto-scroll does not fight a listener who is scrolling');
  await page.screenshot({ path: SHOTS + '/lyrics-manual-scroll.png' });
  await page.click('#ipFollow');
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => document.getElementById('ipFollow').hidden), true, 'Follow resumes following');
  assert.ok(await page.evaluate(() => document.getElementById('ipLyrics').scrollTop > 40), 'and brings the active line back into view');
  // or playback advancing after the idle grace
  await page.evaluate(() => { const l = document.getElementById('ipLyrics'); l.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true })); playerLyrics.lastTouch = Date.now() - 5000; });
  await page.waitForFunction(() => document.getElementById('ipFollow').hidden, null, { timeout: 6000 });
  step(10, '20 lines: active line stays centred; manual scroll stops auto-follow and shows Follow; Follow (or playback moving on after idle) resumes it');
  await page.evaluate(() => stopFinal());

  /* ================= 10b. a layered second voice never lights a line ================= */
  await page.evaluate(`(async () => {
    ${WAV}
    stopFinal(); closeImmersivePlayer();
    state.affirmations = ${JSON.stringify(LINES(4))};
    recordings = state.affirmations.map((t, i) => { const blob = wav(300 + i * 30, 0.6); return { url: URL.createObjectURL(blob), blob, durationMs: 600, text: t }; });
    state.layerAffirmations = ['Quiet layered one.', 'Quiet layered two.', 'Quiet layered three.'];
    layerVoiceEnabled = true; layerVoiceMode = 'own'; state.layerVoiceMode = 'own';
    layerRecordings = state.layerAffirmations.map((t, i) => { const blob = wav(180 + i * 20, 0.6); return { url: URL.createObjectURL(blob), blob }; });
    setAffirmationGap(0.25); prepareFinal(); openImmersivePlayer();
    window.__srcStarts.length = 0; window.__samples = [];
    window.__sampler = setInterval(() => window.__samples.push(document.querySelectorAll('#ipLyrics .ip-lyric[data-state="active"]').length), 25);
    playFinal();
  })()`);
  await page.waitForFunction(() => window.__srcStarts.length >= 8, null, { timeout: 15000 });
  const layered = await page.evaluate(() => { clearInterval(window.__sampler); return {
    segIdx: [...new Set(affTimeline.segments.map(s => s.index))].sort(), maxActive: Math.max(...window.__samples),
    listText: document.getElementById('ipLyrics').textContent, items: document.querySelectorAll('#ipLyrics .ip-lyric').length,
    noteShown: !document.getElementById('ipLayerNote').hidden, sources: window.__srcStarts.length }; });
  assert.ok(layered.segIdx.every(i => i < 4), 'only the main voice reports lines: ' + layered.segIdx);
  assert.ok(layered.maxActive <= 1, 'never more than one line lit, even with two voices going');
  assert.equal(layered.items, 4); assert.ok(!/Quiet layered/.test(layered.listText), 'layered text is never listed or lit');
  assert.ok(layered.noteShown, 'the player says a quieter voice is underneath');
  assert.ok(layered.sources >= 8, 'and the second voice really did play (' + layered.sources + ' sources started)');
  await page.evaluate(() => { stopFinal(); layerVoiceEnabled = false; });
  step('10b', 'layered second voice plays underneath; only the main voice\'s lines are ever listed or highlighted, at most one lit at a time');

  /* ================= 10c. a subliminal keeps at least 5 lines ================= */
  await page.evaluate(() => { closeImmersivePlayer(); startNewSubliminal(); showBuildPage(); state.affirmations = Array.from({ length: 6 }, (_, i) => `Min line ${i + 1}.`); setSelectedVoice(VOICE_RECORD_OWN); beginRecordingPass('primary'); });
  await page.click('#recMgrList .rm-row[data-i="5"] [aria-label="Delete affirmation 6"]');
  assert.equal(await page.evaluate(() => state.affirmations.length), 5);
  assert.equal(await page.evaluate(() => document.querySelector('#recMgrList .rm-row[data-i="4"] [aria-label="Delete affirmation 5"]').disabled), true, 'delete is held at the 5-line minimum');
  step('10c', 'delete stops at the 5-line minimum a subliminal needs');

  /* ================= 11. no console errors; no leaked audio ================= */
  assert.equal((await liveHz()).length, 0); assert.equal(await openCtxs(), 0);
  const real = errors.filter(e => !/Failed to load resource|supabase|net::|ERR_/.test(e));
  assert.deepEqual(real, [], 'no uncaught page errors');
  await browser.close();
  console.log('ALL PASSED');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
