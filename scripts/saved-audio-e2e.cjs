/* Persistence QA for generated voices (Serenity, Clone Your Voice) and recorded
   voices: the audio is generated ONCE, stored with the subliminal in the person's
   private storage, verified, and from then on every open reads it back -- through
   refreshes, logouts, browser restarts (a brand-new browser context seeded with
   the old storage state), a dead voice service, a lapsed plan, a changed pace, and
   a later day. A voice is never swapped for the device's voice.

   Real Chromium, the real app code, real mp3s, the in-memory Supabase
   (scripts/fixtures/mock-supabase.js: its storage keeps the uploaded bytes, so a
   read-back is a real byte-for-byte read), and a stand-in for /api/tts.

   Serve the repo first:  python3 -m http.server 8123
   Then:                  npm run test:saved-audio                                   */
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
async function openPage(browser, server, { tier = 'ritual', rows = [savedRow()], state = null } = {}){
  const phone = devices['iPhone 13'];
  const ctx = await browser.newContext(Object.assign(
    { viewport: phone.viewport, userAgent: phone.userAgent, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    state ? { storageState: state } : {}));
  await ctx.route('**/*', server.route);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  if (process.env.DEBUGLOG) page.on('console', m => console.log('[page]', m.type(), m.text().slice(0, 300)));
  await page.addInitScript(PROBE);
  if (!state) await page.addInitScript(({ tier, rows }) => {
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
const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
const voiceFiles = (d) => Object.keys(d.storage).filter(k => k.startsWith('recordings/user-1/voice/'));
const status = (page) => page.evaluate(() => document.getElementById('voiceStatus').getAttribute('data-state'));
const speaks = (page) => page.evaluate(() => window.__probe.speaks);
const watch = (page, freqs) => page.evaluate((f) => { window.__probe.watch = f; window.__probe.frames = []; window.__probe.t0 = performance.now(); }, freqs);
const frames = (page) => page.evaluate(() => window.__probe.frames);
const firstHeard = (fr, f, floor = -75) => { const x = fr.find(k => k.band[f] > floor); return x ? x.t : null; };
async function waitFor(page, fn, ms = 30000){ await page.waitForFunction(fn, null, { timeout: ms }); }
async function playFromLib(page, id = 'serenity-1'){
  await page.evaluate((i) => playFromLibrary(i), id);
}
/* Wait for the stored audio to be written back to a subliminal that had none. */
const hasManifest = (page) => page.evaluate(() => { const r = JSON.parse(localStorage.getItem('mockdb')).tables.subliminals.find(x => x.id === 'serenity-1'); return !!(r.voice_audio && r.voice_audio.clips && r.voice_audio.clips.length); });

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const server = makeServer();

  /* ===== 1. first open of an older subliminal: generated once, then STORED ===== */
  console.log('\n--- 1. generate once, store, verify ---');
  let state;
  {
    const { page, ctx } = await openPage(browser, server);
    await playFromLib(page);
    await waitFor(page, () => finalPlaying === true);
    ok('it plays after generating', await page.evaluate(() => finalPlaying));
    await waitFor(page, () => { const r = JSON.parse(localStorage.getItem('mockdb')).tables.subliminals[0]; return r.voice_audio && r.voice_audio.clips.length === 5; });
    const d = await db(page);
    const row = d.tables.subliminals[0];
    ok('the row now carries a manifest of 5 stored clips', row.voice_audio.clips.length === 5, row.voice_audio);
    ok('  ...5 files are in the private recordings bucket under <user>/voice/', voiceFiles(d).length === 5, voiceFiles(d));
    ok('  ...each manifest path exists in storage with the recorded size', row.voice_audio.clips.every(c => d.storage['recordings/' + c.path] && c.bytes > 1500));
    ok('  ...paths are content hashes (immutable names)', row.voice_audio.clips.every(c => /\/voice\/[0-9a-f]{64}\.mp3$/.test(c.path)), row.voice_audio.clips.map(c => c.path));
    ok('  ...nothing else on the row changed', row.title === 'Calm night' && row.ai_voice_id === 'serenity' && row.affirmations.length === 5);
    ok('the device voice never spoke', (await speaks(page)) === 0);
    const gens = server.generations;
    await page.evaluate(() => stopFinal());
    state = await ctx.storageState();
    ok('generated exactly 5 clips in total', gens === 5, gens);
    await ctx.close();
  }

  /* ===== 2. browser restart / later day / provider dead / plan lapsed ===== */
  console.log('\n--- 2. new browser, voice service DOWN, plan lapsed: still plays from stored audio ---');
  {
    server.alwaysFail = 'quota_exceeded'; server.tts.length = 0; server.audio.length = 0;
    const { page, ctx } = await openPage(browser, server, { state });
    // the plan is gone, as after a lapsed subscription
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); d.tables.subscribers = []; localStorage.setItem('mockdb', JSON.stringify(d)); });
    await page.reload();
    await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
    await watch(page, PITCH);
    await playFromLib(page);
    await waitFor(page, () => finalPlaying === true);
    await page.waitForTimeout(21000);
    const fr = await frames(page);
    ok('plays with the provider returning quota_exceeded', await page.evaluate(() => finalPlaying));
    ok('  ...zero requests to /api/tts', server.tts.length === 0, server.tts.length);
    ok('  ...all five lines are audible in the speaker output, in order', (() => { const h = PITCH.map(f => firstHeard(fr, f)); return h.every(t => t !== null) && h.every((t, i) => !i || t > h[i - 1]); })(), PITCH.map(f => firstHeard(fr, f)));
    ok('  ...from storage, not from the generator links', server.audio.length === 0, server.audio);
    ok('  ...device voice never used', (await speaks(page)) === 0);
    ok('  ...no page errors', page.errors.length === 0, page.errors);
    await page.evaluate(() => stopFinal());
    await ctx.close();   // the lapsed plan is not carried into the later scenarios
    server.alwaysFail = null;
  }

  /* ===== 3. logout, login, refresh ===== */
  console.log('\n--- 3. logout then login ---');
  {
    server.tts.length = 0;
    const { page, ctx } = await openPage(browser, server, { state });
    await playFromLib(page);
    await waitFor(page, () => finalPlaying === true);
    await page.evaluate(() => stopFinal());
    await page.evaluate(() => logOut());
    ok('logout clears the decoded audio and the manifest held in memory', await page.evaluate(() => savedVoiceAudio === null && ttsCache.size === 0 && studioClipHandles.size === 0));
    await page.evaluate(() => localStorage.setItem('mock_logged_in', '1'));
    await page.reload();
    await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
    await playFromLib(page);
    await waitFor(page, () => finalPlaying === true);
    ok('after logging back in it plays again from storage', await page.evaluate(() => finalPlaying));
    ok('  ...with no generation request', server.tts.length === 0, server.tts.length);
    await page.evaluate(() => stopFinal());
    await ctx.close();
  }

  /* ===== 4. the pace is part of the subliminal ===== */
  console.log('\n--- 4. a different pace does not invalidate stored audio ---');
  {
    server.tts.length = 0;
    const d0 = JSON.parse(JSON.stringify(state)); // stored at "steady" (0.92); the row says nothing about pace
    const { page, ctx } = await openPage(browser, server, { state: d0 });
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); d.tables.subliminals[0].mix_settings = { pace: 'drifting' }; localStorage.setItem('mockdb', JSON.stringify(d)); });
    await playFromLib(page);
    await waitFor(page, () => finalPlaying === true);
    ok('the saved pace is restored (Drifting, 0.82)', await page.evaluate(() => paceNow().key === 'drifting' && paceNow().speed === 0.82));
    ok('  ...and plays the stored 0.92 audio without generating', server.tts.length === 0, server.tts.length);
    await page.evaluate(() => stopFinal());
    ok('the pace is written with the mix settings', await page.evaluate(() => readMixSettings().pace === 'drifting'));
    await ctx.close();
  }

  /* ===== 5. a stored file is missing: error + Retry, no device voice, no silent regeneration ===== */
  console.log('\n--- 5. a stored file is gone ---');
  {
    server.tts.length = 0;
    const { page, ctx } = await openPage(browser, server, { state });
    const victim = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); const k = Object.keys(d.storage).find(x => x.startsWith('recordings/user-1/voice/')); const keep = d.storage[k]; delete d.storage[k]; localStorage.setItem('mockdb', JSON.stringify(d)); window.__keep = [k, keep]; return k; });
    await playFromLib(page);
    await waitFor(page, () => document.getElementById('voiceStatus').getAttribute('data-state') === 'failed');
    ok('shows Failed with a clear message', await page.evaluate(() => /could not be found/.test(document.getElementById('finalLine').textContent)), await page.evaluate(() => document.getElementById('finalLine').textContent));
    ok('  ...Retry Audio is offered', await page.evaluate(() => !document.getElementById('retryAudioBtn').hidden));
    ok('  ...NOTHING was regenerated behind the person\'s back', server.tts.length === 0, server.tts.length);
    ok('  ...and no other voice spoke, nothing is playing', (await speaks(page)) === 0 && !(await page.evaluate(() => finalPlaying)));
    ok('  ...the failure was reported as a code only', server.reports.some(r => r.code === 'saved_audio_missing' && r.stage === 'load') && !JSON.stringify(server.reports).includes('calm'), server.reports);
    await page.evaluate(() => document.getElementById('retryAudioBtn').click());
    await waitFor(page, () => document.getElementById('voiceStatus').getAttribute('data-state') === 'ready');
    ok('Retry (the explicit permission) rebuilds just the missing line', server.tts.length >= 1 && server.tts[server.tts.length - 1].lines.length === 1, server.tts.map(t => t.lines.length));
    await page.evaluate(() => playFinal());
    await waitFor(page, () => finalPlaying === true);
    ok('  ...and it plays', await page.evaluate(() => finalPlaying));
    await page.evaluate(() => stopFinal());
    await ctx.close();
  }

  /* ===== 6. storage unreachable (network) ===== */
  console.log('\n--- 6. storage unreachable, then back ---');
  {
    server.tts.length = 0;
    const { page, ctx } = await openPage(browser, server, { state });
    await page.evaluate(() => { window.__realFetch = window.fetch; window.fetch = (u, ...r) => (String(u).startsWith('data:') && window.__down ? Promise.reject(new TypeError('offline')) : window.__realFetch(u, ...r)); window.__down = true; });
    await playFromLib(page);
    await waitFor(page, () => document.getElementById('voiceStatus').getAttribute('data-state') === 'failed', 40000);
    ok('offline: Failed + Retry, and the words say nothing was played in another voice', await page.evaluate(() => /Nothing was played in another voice/.test(document.getElementById('finalLine').textContent) && !document.getElementById('retryAudioBtn').hidden));
    ok('  ...no generation, no device voice', server.tts.length === 0 && (await speaks(page)) === 0);
    await page.evaluate(() => { window.__down = false; document.getElementById('retryAudioBtn').click(); });
    await waitFor(page, () => document.getElementById('voiceStatus').getAttribute('data-state') === 'ready', 40000);
    ok('back online: Retry loads the stored audio (still no generation)', server.tts.length === 0, server.tts.length);
    await ctx.close();
  }

  /* ===== 7. a damaged stored file is detected ===== */
  console.log('\n--- 7. a damaged stored file ---');
  {
    server.tts.length = 0;
    const { page, ctx } = await openPage(browser, server, { state });
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); const k = Object.keys(d.storage).find(x => x.startsWith('recordings/user-1/voice/')); { const i = d.storage[k].indexOf(',') + 1; d.storage[k] = d.storage[k].slice(0, i + 4 * 400); } localStorage.setItem('mockdb', JSON.stringify(d)); });
    await playFromLib(page);
    await waitFor(page, () => document.getElementById('voiceStatus').getAttribute('data-state') === 'failed');
    ok('a truncated file is Failed (saved_audio_corrupt), not played', await page.evaluate(() => studioStatus.code === 'saved_audio_corrupt' && !finalPlaying), await page.evaluate(() => studioStatus));
    ok('  ...and not regenerated without a tap', server.tts.length === 0);
    await ctx.close();
  }

  /* ===== 8. nothing is overwritten or deleted by the fix ===== */
  console.log('\n--- 8. existing recordings are protected ---');
  {
    const s2 = makeServer();
    const own = savedRow({ id: 'own-1', ai_voice_id: null, recording_urls: ['user-1/takes/a.webm', 'user-1/takes/b.webm'], title: 'Mine' });
    const { page, ctx } = await openPage(browser, s2, { rows: [savedRow(), own] });
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); const mp3 = 'data:audio/mpeg;base64,' + 'SUQz' + 'A'.repeat(4000); d.storage['recordings/user-1/takes/a.webm'] = mp3; d.storage['recordings/user-1/takes/b.webm'] = mp3; localStorage.setItem('mockdb', JSON.stringify(d)); localStorage.setItem('mocklog', '[]'); });
    await playFromLib(page);
    await waitFor(page, () => finalPlaying === true);
    await waitFor(page, () => JSON.parse(localStorage.getItem('mockdb')).tables.subliminals[0].voice_audio);
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('mocklog')));
    ok('no storage object was removed or overwritten', !log.some(e => e.storage && (e.op === 'remove' || e.op === 'upload-duplicate')), log.filter(e => e.storage).map(e => e.op));
    const d = await db(page);
    ok('the recorded-voice subliminal\'s files and row are untouched', d.storage['recordings/user-1/takes/a.webm'] && d.tables.subliminals[1].recording_urls.length === 2 && !d.tables.subliminals[1].voice_audio);
    await page.evaluate(() => stopFinal());
    await ctx.close();
  }

  /* ===== 9. saving a new generated-voice subliminal is gated on stored audio ===== */
  console.log('\n--- 9. save is refused unless every line is stored and verified ---');
  {
    const s3 = makeServer();
    const { page, ctx } = await openPage(browser, s3);
    await playFromLib(page);
    await waitFor(page, () => finalPlaying === true);
    await page.evaluate(() => stopFinal());
    // 9a: uploads fail -> nothing saved
    await page.evaluate(() => { localStorage.setItem('mock_upload_fail', 'all'); const d = JSON.parse(localStorage.getItem('mockdb')); d.tables.subliminals[0].voice_audio = null; d.storage = {}; localStorage.setItem('mockdb', JSON.stringify(d)); });
    const rowsBefore = (await db(page)).tables.subliminals.length;
    await page.evaluate(() => { document.getElementById('finalTitleInput').value = 'Copy'; return saveSubliminal({ asNew: true }); });
    const msg = await page.evaluate(() => document.getElementById('saveMsg') ? document.getElementById('saveMsg').textContent : [...document.querySelectorAll('.save-msg')].map(e => e.textContent).join('|'));
    ok('upload failure: no row is written', (await db(page)).tables.subliminals.length === rowsBefore, msg);
    ok('  ...and the person is told nothing was saved', /nothing was saved/i.test(msg), msg);
    // 9b: uploads work -> row written with manifest
    await page.evaluate(() => localStorage.removeItem('mock_upload_fail'));
    await page.evaluate(() => { document.getElementById('finalTitleInput').value = 'Copy'; return saveSubliminal({ asNew: true }); });
    const d = await db(page);
    const copy = d.tables.subliminals.find(r => r.title === 'Copy');
    ok('uploads fine: the new row is written with all 5 stored clips', copy && copy.voice_audio && copy.voice_audio.clips.length === 5, copy && copy.voice_audio);
    ok('  ...every clip is in storage', copy && copy.voice_audio.clips.every(c => d.storage['recordings/' + c.path]));
    ok('  ...and the pace used is recorded in the mix settings', copy && copy.mix_settings && copy.mix_settings.pace === 'steady', copy && copy.mix_settings);
    await ctx.close();
  }

  /* ===== 10. a recorded voice: unreachable -> error + Retry, never a different voice ===== */
  console.log('\n--- 10. Record Your Own Voice ---');
  {
    const s4 = makeServer();
    const own = savedRow({ id: 'own-1', ai_voice_id: null, recording_urls: ['user-1/takes/a.webm', 'user-1/takes/b.webm'], title: 'Mine', affirmations: ['I am calm.', 'I am safe.'] });
    const { page, ctx } = await openPage(browser, s4, { rows: [own] });
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); d.storage = {}; localStorage.setItem('mockdb', JSON.stringify(d)); });
    await page.evaluate(() => playFromLibrary('own-1'));
    await page.waitForTimeout(3000);
    ok('missing recordings: told so, Retry offered, nothing plays, no device voice', await page.evaluate(() => /could not download|didn't download|saved, but/.test(document.getElementById('finalLine').textContent) && !document.getElementById('retryAudioBtn').hidden && !finalPlaying), await page.evaluate(() => document.getElementById('finalLine').textContent));
    ok('  ...the fault is reported as a code', s4.reports.some(r => r.code === 'saved_audio_unreachable'), s4.reports);
    ok('  ...device voice not used', (await speaks(page)) === 0);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${failed ? failed + ' FAILED' : 'all passed'} (${passed} passed)`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
