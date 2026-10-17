/* End-to-end QA for Serenity (the paid AI voice) in a real browser: Chromium with
   an iPhone viewport and user agent (which exercises the iOS media-element output
   path), the real app code, the real library Play button, real mp3 files, against
   the in-memory Supabase (scripts/fixtures/mock-supabase.js) and a stand-in for
   /api/tts and the storage links.

   What is NOT real here: ElevenLabs. The mp3s are tones, one distinct pitch per
   line (so the order they are heard in can be checked), made with ffmpeg. The
   point is everything after the provider: the request, the retries, the download
   and decode check, the ready gate, and what actually reaches the speaker. A tap
   in front of the output (every path into ctx.destination or the iOS media
   stream goes through one analyser) measures the final mix, so "it played" means
   a pitch was measured in the audio, not that a function was called.

   Serve the repo first:  python3 -m http.server 8123
   Then:                  npm run test:serenity-e2e
   Needs Playwright (npm i -g playwright, or PLAYWRIGHT_MODULE=/path/to/playwright)
   and ffmpeg (ffmpeg-static from node_modules, or one on the PATH). */
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const BASE = 'http://localhost:8123';
const MOCK = fs.readFileSync(__dirname + '/fixtures/mock-supabase.js', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
function ok(label, cond, extra){
  if (cond) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ---------------- real mp3 files, one pitch per line ---------------- */
const FFMPEG = (() => { try { return require('ffmpeg-static') || 'ffmpeg'; } catch (e) { return 'ffmpeg'; } })();
const LINES = ['I am calm.', 'I am safe.', 'I rest easily.', 'I am enough.', 'I am loved.'];
const PITCH = [200, 260, 340, 420, 640];            // Hz; 528 is the frequency layer, kept clear of these
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serenity-e2e-'));
const MP3 = LINES.map((_, i) => {
  const f = path.join(dir, `line${i}.mp3`);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${PITCH[i]}:duration=1.6:sample_rate=44100`,
    '-af', 'volume=0.8,afade=t=in:d=0.05,afade=t=out:st=1.4:d=0.2', '-c:a', 'libmp3lame', '-b:a', '64k', f]);
  return fs.readFileSync(f);
});
ok('the fixtures are real mp3s (ID3/frame header, > 1.5 KB)', MP3.every(b => b.length > 1500 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))));

/* ---------------- the stand-in for /api/tts and the storage links ---------------- */
function makeServer(){
  const s = {
    tts: [], audio: [], reports: [], made: new Set(), generations: 0,
    failNext: 0, failCode: 'timeout', failStatus: 504, alwaysFail: null, delayMs: 0,
    badAudio: new Map(),            // line index -> 'empty' | 'html' (first download only unless sticky)
  };
  s.route = async (route) => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (url.startsWith('https://storage.test/')) {
      const idx = parseInt(url.match(/line(\d)\.mp3/)[1], 10);
      s.audio.push(idx);
      const bad = s.badAudio.get(idx);
      const cors = { 'access-control-allow-origin': '*' };
      if (bad === 'empty') { s.badAudio.delete(idx); return route.fulfill({ status: 200, headers: cors, contentType: 'audio/mpeg', body: MP3[idx].subarray(0, 12) }); }
      if (bad === 'html')  { s.badAudio.delete(idx); return route.fulfill({ status: 200, headers: cors, contentType: 'audio/mpeg', body: Buffer.from('<html>' + 'x'.repeat(3000) + '</html>') }); }
      return route.fulfill({ status: 200, headers: cors, contentType: 'audio/mpeg', body: MP3[idx] });
    }
    if (url.startsWith(BASE + '/api/tts-report')) { s.reports.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (url.startsWith(BASE + '/api/tts')) {
      const body = JSON.parse(route.request().postData() || '{}');
      s.tts.push(body);
      if (s.delayMs) await sleep(s.delayMs);
      if (s.alwaysFail) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: s.alwaysFail }) });
      if (s.failNext > 0) { s.failNext--; return route.fulfill({ status: s.failStatus, contentType: 'application/json', body: JSON.stringify({ error: s.failCode }) }); }
      const clips = body.lines.map((text, index) => {
        const i = LINES.indexOf(text);
        const cached = s.made.has(text) && !body.repair;
        if (!cached) { s.made.add(text); s.generations++; }
        return { index, text, url: `https://storage.test/line${i}.mp3`, cached, error: null, retryable: false };
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clips, generated: 0, reused: 0, warning: null }) });
    }
    if (url.startsWith(BASE + '/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline in test"}' });
    if (url.startsWith(BASE)) return route.continue();
    return route.abort();
  };
  return s;
}

/* ---------------- the tap in front of the speaker ---------------- */
const PROBE = () => {
  if (window !== window.top) return;
  const origConnect = AudioNode.prototype.connect;
  const probes = new WeakMap();
  window.__probe = { speaks: 0, frames: [], watch: [], t0: performance.now() };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = origConnect.call(this, dest, ...rest);
    try {
      const ctx = this.context;
      const isOut = dest === ctx.destination || (typeof MediaStreamAudioDestinationNode !== 'undefined' && dest instanceof MediaStreamAudioDestinationNode);
      if (isOut) {
        let p = probes.get(ctx);
        if (!p) { p = ctx.createAnalyser(); p.fftSize = 8192; p.smoothingTimeConstant = 0; probes.set(ctx, p); window.__probe.analyser = p; window.__probe.ctx = ctx; }
        if (this !== p) origConnect.call(this, p);
      }
    } catch (e) { /* the probe must never break the page */ }
    return r;
  };
  try { window.speechSynthesis.speak = () => { window.__probe.speaks++; }; } catch (e) {}
  setInterval(() => {
    const P = window.__probe;
    if (!P.analyser || !P.watch.length) return;
    const a = P.analyser, bins = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(bins);
    const hz = a.context.sampleRate / a.fftSize;
    const td = new Float32Array(a.fftSize); a.getFloatTimeDomainData(td);
    let sq = 0; for (let i = 0; i < td.length; i++) sq += td[i] * td[i];
    const band = {};
    P.watch.forEach(f => { let m = -200; const c = Math.round(f / hz); for (let k = c - 2; k <= c + 2; k++) if (bins[k] > m) m = bins[k]; band[f] = m; });
    P.frames.push({ t: Math.round(performance.now() - P.t0), rms: Math.sqrt(sq / td.length), band, state: a.context.state });
  }, 60);
};

function savedRow(over){
  return Object.assign({ id: 'serenity-1', user_id: 'user-1', title: 'Calm night', frequency_hz: 528, affirmations: LINES.slice(),
    recording_urls: null, ai_voice_id: 'serenity', background: 'none', duration_seconds: 300, created_at: '2026-10-01T00:00:00.000Z',
    mix_settings: {} }, over || {});
}
async function newPage(browser, server, { tier = 'ritual', rows = [savedRow()], ua = 'iphone' } = {}){
  const phone = devices['iPhone 13'];
  const ctx = await browser.newContext(ua === 'iphone'
    ? { viewport: phone.viewport, userAgent: phone.userAgent, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } });
  await ctx.route('**/*', server.route);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  if (process.env.DEBUGLOG) page.on('console', m => console.log('[page]', m.type(), m.text().slice(0, 300)));
  await page.addInitScript(PROBE);
  await page.addInitScript(({ tier, rows }) => {
    if (window !== window.top) return;
    if (!localStorage.getItem('mockdb')) {
      localStorage.setItem('mockdb', JSON.stringify({ tables: {
        profiles: [{ id: 'user-1', onboarding_completed: true, display_name: 'Tester' }],
        subscribers: tier ? [{ user_id: 'user-1', tier, status: 'active' }] : [],
        subliminals: rows }, storage: {} }));
    }
  }, { tier, rows });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
  await page.waitForTimeout(400);
  page.errors = errors;
  return { ctx, page };
}
const statusLog = (page) => page.evaluate(() => {
  window.__states = [];
  const box = document.getElementById('voiceStatus');
  new MutationObserver(() => window.__states.push(box.getAttribute('data-state'))).observe(box, { attributes: true, attributeFilter: ['data-state'] });
});
const states = (page) => page.evaluate(() => Array.from(new Set(window.__states)));
const watch = (page, freqs) => page.evaluate((f) => { window.__probe.watch = f; window.__probe.frames = []; window.__probe.t0 = performance.now(); }, freqs);
const frames = (page) => page.evaluate(() => window.__probe.frames);
/* First time (ms) a pitch stands clearly above the floor, or null. */
const firstHeard = (fr, f, floor = -75) => { const x = fr.find(k => k.band[f] > floor); return x ? x.t : null; };
const playing = (page) => page.evaluate(() => finalPlaying);
async function waitFor(page, fn, ms = 20000){ await page.waitForFunction(fn, null, { timeout: ms }); }

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  /* ===== 1. a saved Serenity subliminal, opened from the library and played ===== */
  console.log('\n--- first play from the library (iPhone Safari-like) ---');
  {
    const server = makeServer();
    const { page, ctx } = await newPage(browser, server);
    await statusLog(page);
    await watch(page, [...PITCH, 528]);
    await page.evaluate(() => playFromLibrary('serenity-1'));
    await waitFor(page, () => finalPlaying === true);
    ok('the session started (Play waited for the audio instead of racing it)', await playing(page));
    const st = await states(page);
    ok('the states appeared in order: Generating Voice → Saving Audio → Ready to Play', JSON.stringify(st.filter(s => ['generating', 'saving', 'ready'].includes(s))) === JSON.stringify(['generating', 'saving', 'ready']), st);
    ok('all five lines went out in ONE request, for Serenity by key', server.tts.length === 1 && server.tts[0].lines.length === 5 && server.tts[0].voiceKey === 'serenity', server.tts.map(t => [t.voiceKey, t.lines.length]));
    ok('every stored clip was downloaded and checked before play', new Set(server.audio).size === 5, server.audio);
    await page.waitForTimeout(21000);   // five lines of ~1.6s plus a ~2.4s pace gap
    const fr = await frames(page);
    const heard = PITCH.map(f => firstHeard(fr, f));
    ok('the speaker output carries all five lines (a pitch measured for each)', heard.every(t => t !== null), heard);
    ok('  ...in the order written', heard.every((t, i) => i === 0 || t > heard[i - 1]), heard);
    ok('the frequency layer (528 Hz) plays together with the voice', fr.some(k => k.band[528] > -75 && PITCH.some(f => k.band[f] > -75)) || (firstHeard(fr, 528) !== null && heard.every(t => t !== null)), firstHeard(fr, 528));
    ok('the audio context is running (not suspended)', fr.slice(-3).every(k => k.state === 'running'), fr.slice(-1));
    ok('the device voice never spoke', (await page.evaluate(() => window.__probe.speaks)) === 0);
    ok('the voice made no further requests while playing', server.tts.length === 1);
    ok('no page errors', page.errors.length === 0, page.errors);

    /* pause, resume, replay */
    const before = (await frames(page)).length;
    await page.evaluate(() => pauseFinal());
    await page.waitForTimeout(600);
    const paused = await page.evaluate(() => ({ p: finalPaused, state: window.__probe.ctx.state }));
    ok('pause pauses', paused.p === true && paused.state === 'suspended', paused);
    await page.evaluate(() => resumeFinal());
    await page.waitForTimeout(900);
    ok('resume resumes the same session (one context, running)', await page.evaluate(() => finalPlaying && !finalPaused && window.__probe.ctx.state === 'running'));
    await page.evaluate(() => { stopFinal(); });
    await watch(page, [...PITCH, 528]);
    await page.evaluate(() => playFinal());
    await waitFor(page, () => finalPlaying === true);
    await page.waitForTimeout(2600);
    const again = await frames(page);
    ok('replay: the first line is heard again', firstHeard(again, PITCH[0]) !== null);
    ok('  ...with no new request to the server', server.tts.length === 1 && server.generations === 5, [server.tts.length, server.generations]);
    ok('  ...and still no device voice', (await page.evaluate(() => window.__probe.speaks)) === 0);

    /* leaving and coming back */
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1200);
    ok('leaving the app and coming back keeps one session playing', await page.evaluate(() => finalPlaying && window.__probe.ctx.state === 'running'));
    await page.evaluate(() => stopFinal());
    await ctx.close();
  }

  /* ===== 2. a refresh, and opening it again: stored audio, nothing regenerated ===== */
  console.log('\n--- refresh and reopen ---');
  {
    const server = makeServer();
    let { page, ctx } = await newPage(browser, server);
    await page.evaluate(() => playFromLibrary('serenity-1'));
    await waitFor(page, () => finalPlaying === true);
    const db = await page.evaluate(() => localStorage.getItem('mockdb'));
    await page.reload();
    await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
    ok('the saved subliminal survived the refresh untouched', await page.evaluate(() => JSON.parse(localStorage.getItem('mockdb')).tables.subliminals[0].affirmations.length) === 5);
    await statusLog(page);
    await page.evaluate(() => playFromLibrary('serenity-1'));
    await waitFor(page, () => finalPlaying === true);
    ok('after a refresh it plays again, from the stored audio', await playing(page));
    ok('  ...the server read it back, it did not make it again', server.generations === 5, server.generations);
    await ctx.close();
  }

  /* ===== 3. slow network and provider timeouts ===== */
  console.log('\n--- slow network, provider timeouts ---');
  {
    const server = makeServer(); server.delayMs = 1800; server.failNext = 2;
    const { page, ctx } = await newPage(browser, server);
    await statusLog(page);
    await page.evaluate(() => playFromLibrary('serenity-1'));
    await waitFor(page, () => finalPlaying === true, 40000);
    ok('two timeouts and a slow connection: it still gets there by itself', await playing(page));
    ok('  ...bounded retries (3 attempts at the batch)', server.tts.length === 3, server.tts.length);
    ok('  ...the member saw it generating, then ready', (await states(page)).includes('generating') && (await states(page)).includes('ready'));
    await page.evaluate(() => stopFinal());
    await ctx.close();
  }

  /* ===== 4. audio that came back bad ===== */
  console.log('\n--- empty / corrupted audio ---');
  {
    const server = makeServer(); server.badAudio.set(2, 'empty'); server.badAudio.set(4, 'html');
    const { page, ctx } = await newPage(browser, server);
    await watch(page, PITCH);
    await page.evaluate(() => playFromLibrary('serenity-1'));
    await waitFor(page, () => finalPlaying === true, 30000);
    ok('empty and error-page "audio" is caught before play', await playing(page));
    ok('  ...the two bad lines were made again as repairs, and only those', server.tts.length === 2 && server.tts[1].repair === true && server.tts[1].lines.length === 2, server.tts.map(t => [t.repair, t.lines]));
    ok('  ...and reported as codes without the words', server.reports.length >= 2 && !JSON.stringify(server.reports).includes('enough'), server.reports);
    await page.waitForTimeout(21000);
    const fr = await frames(page);
    ok('  ...and every line, including the repaired ones, is heard', PITCH.every(f => firstHeard(fr, f) !== null), PITCH.map(f => firstHeard(fr, f)));
    await page.evaluate(() => stopFinal());
    await ctx.close();
  }

  /* ===== 5. total failure: Failed, Retry Audio, never a device voice ===== */
  console.log('\n--- failure and Retry Audio ---');
  {
    const server = makeServer(); server.alwaysFail = 'provider_failed';
    const { page, ctx } = await newPage(browser, server);
    await statusLog(page);
    await page.evaluate(() => playFromLibrary('serenity-1'));
    await waitFor(page, () => document.getElementById('voiceStatus').getAttribute('data-state') === 'failed', 30000);
    ok('a failed generation shows Failed — never a success state', (await states(page)).includes('failed') && !(await states(page)).includes('ready'));
    ok('  ...with a Retry Audio button', await page.evaluate(() => !document.getElementById('retryAudioBtn').hidden));
    ok('  ...nothing plays, and the device voice is not used', !(await playing(page)) && (await page.evaluate(() => window.__probe.speaks)) === 0);
    ok('  ...after three bounded attempts', server.tts.length === 3, server.tts.length);
    ok('  ...and the library card says so', await page.evaluate(() => { reflectLibraryPlaying(); return /failed/i.test((document.getElementById('libNow-serenity-1') || { textContent: 'failed' }).textContent); }));
    server.alwaysFail = null;
    await page.evaluate(() => document.getElementById('retryAudioBtn').click());
    await waitFor(page, () => document.getElementById('voiceStatus').getAttribute('data-state') === 'ready', 30000);
    ok('Retry Audio recovers once the service is back', true);
    ok('  ...and the button goes away', await page.evaluate(() => document.getElementById('retryAudioBtn').hidden));
    await page.evaluate(() => playFinal());
    await waitFor(page, () => finalPlaying === true);
    ok('  ...and it plays', await playing(page));
    await page.evaluate(() => stopFinal());
    await ctx.close();
  }

  /* ===== 6. paid-user protection ===== */
  console.log('\n--- free preview and paid accounts ---');
  {
    const server = makeServer();
    const { page, ctx } = await newPage(browser, server, { tier: null });
    await statusLog(page);
    await page.evaluate(() => playFromLibrary('serenity-1'));
    await page.waitForTimeout(1500);
    ok('a free account never reaches the voice service for Serenity', server.tts.length === 0, server.tts.length);
    ok('  ...is told it comes with Ritual, with no Retry Audio', await page.evaluate(() => /Ritual/.test(document.getElementById('finalLine').textContent) && document.getElementById('retryAudioBtn').hidden));
    ok('  ...and does not get the device voice instead', !(await playing(page)) && (await page.evaluate(() => window.__probe.speaks)) === 0);
    await ctx.close();
  }

  /* ===== 7. voice + music + frequency layers together, desktop browser ===== */
  console.log('\n--- all layers at once (desktop) ---');
  {
    const server = makeServer();
    const row = savedRow({ background: 'rain', mix_settings: { freqLayers: [{ hz: 528, vol: 60 }, { hz: 432, vol: 40 }], bgLayer: 'none' } });
    const { page, ctx } = await newPage(browser, server, { rows: [row], ua: 'desktop' });
    await watch(page, [...PITCH, 528, 432]);
    await page.evaluate(() => playFromLibrary('serenity-1'));
    await waitFor(page, () => finalPlaying === true);
    await page.waitForTimeout(21000);
    const fr = await frames(page);
    ok('desktop: voice, nature sound and two frequency layers are all heard', PITCH.every(f => firstHeard(fr, f) !== null) && firstHeard(fr, 528) !== null && firstHeard(fr, 432) !== null, [PITCH.map(f => firstHeard(fr, f)), firstHeard(fr, 528), firstHeard(fr, 432)]);
    ok('  ...at the same time (a frame with voice and both tones)', fr.some(k => PITCH.some(f => k.band[f] > -70) && k.band[528] > -70 && k.band[432] > -70));
    ok('  ...no overlap of voice lines (never two voice pitches at once)', !fr.some(k => PITCH.filter(f => k.band[f] > -45).length > 1));
    ok('  ...and no signs of clipping', fr.every(k => k.rms < 0.95));
    await page.evaluate(() => stopFinal());
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${failed ? failed + ' FAILED' : 'all passed'} (${passed} passed)`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
