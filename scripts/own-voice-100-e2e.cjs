/* End-to-end QA for a complete 100-affirmation subliminal in your own voice:
   choosing the count, recording every line (hold and tap, pause and resume),
   failures that must not cost anything, progressive saving to the account,
   refreshing in the middle, editing, saving without duplicates, reopening,
   re-recording over a saved subliminal without removing anything, and playing
   all 100 in order with the lyrics-style list -- in a real browser (Chromium,
   iPhone viewport) against the in-memory Supabase (scripts/fixtures/mock-supabase.js)
   and a fake microphone.

   Serve the repo first:  python3 -m http.server 8123
   Then:                  npm run test:own-voice-100
   Needs Playwright (npm i -g playwright, or PLAYWRIGHT_MODULE=/path/to/playwright). */
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'); const assert = require('assert/strict');
const BASE = 'http://localhost:8123';
const MOCK = fs.readFileSync(__dirname + '/fixtures/mock-supabase.js', 'utf8');
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const step = (n, s) => console.log(`✔ ${n}. ${s}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const N = 100;
const LINES = n => Array.from({ length: n }, (_, i) => `Affirmation number ${i + 1}: I am steady and whole.`);

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const phone = devices['iPhone 13'];
  const ctx = await browser.newContext({ viewport: phone.viewport, userAgent: phone.userAgent, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  let ttsCalls = 0, generateCalls = 0;
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (url.startsWith(BASE + '/api/tts')) { ttsCalls++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline in test"}' }); }
    if (url.startsWith(BASE + '/api/')) { if (url.includes('generate-affirmations')) generateCalls++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline in test"}' }); }
    if (url.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message + (process.env.DEBUGLOG ? '\n' + e.stack : '')));
  if (process.env.DEBUGLOG) page.on('console', m => console.log('[page]', m.type(), m.text().slice(0, 300)));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => {
    if (window !== window.top) return;
    if (!localStorage.getItem('mockdb')) {
      /* A subliminal that was saved before this change, in the old layout
         (storage path = <user>/<timestamp>/<line>.<ext>). It must survive every
         step below untouched. */
      const sr = 8000, n = 4000, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / sr * 400 * 2 * Math.PI) * 8000, true);
      let bin = ''; new Uint8Array(b).forEach(x => { bin += String.fromCharCode(x); });
      const dataUrl = 'data:audio/wav;base64,' + btoa(bin);
      const legacy = { id: 'legacy-own', user_id: 'user-1', title: 'Saved last month', frequency_hz: 528, affirmations: ['I am old.', 'I am safe.', 'I am kept.', 'I am here.', 'I am whole.'],
        recording_urls: ['user-1/1700000000000/0.wav', 'user-1/1700000000000/1.wav', null, 'user-1/1700000000000/3.wav', 'user-1/1700000000000/4.wav'],
        mix_settings: { affirmationMeta: [0, 1, 2, 3, 4].map(i => ({ order: i, durationMs: 500, recordedText: ['I am old.', 'I am safe.', 'I am kept.', 'I am here.', 'I am whole.'][i] })) },
        background: 'none', duration_seconds: 300, created_at: '2026-09-01T00:00:00.000Z' };
      const storage = {}; ['0', '1', '3', '4'].forEach(i => { storage['recordings/user-1/1700000000000/' + i + '.wav'] = dataUrl; });
      localStorage.setItem('mockdb', JSON.stringify({ tables: {
        profiles: [{ id: 'user-1', onboarding_completed: true, display_name: 'Tester' }],
        subscribers: [{ user_id: 'user-1', tier: 'ritual', status: 'active' }],
        subliminals: [legacy] }, storage }));
    }
  });
  let curMode = 'hold';
  const boot = async () => {
    await page.goto(BASE + '/');
    await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
    await page.waitForTimeout(400);
    curMode = await page.evaluate(() => (recTapMode() ? 'tap' : 'hold'));
  };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const subs = async () => ((await db()).tables.subliminals || []);
  const mocklog = () => page.evaluate(() => JSON.parse(localStorage.getItem('mocklog') || '[]'));
  const storageKeys = async () => Object.keys((await db()).storage).filter(k => k.startsWith('recordings/'));
  const taken = () => page.evaluate(() => recordings.filter(Boolean).length);
  const WAV = `const wav = (hz, secs) => { const sr = 8000, n = Math.floor(sr * secs), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / sr * hz * 2 * Math.PI) * 8000, true);
      return new Blob([b], { type: 'audio/wav' }); };`;

  /* Record the current line. hold: press and release. tap: press, press again. */
  const record = async (mode, ms) => {
    if (mode !== curMode) { await setMode(mode); curMode = mode; }
    const idx = await page.evaluate(() => recIndex);
    const beforeId = await page.evaluate(i => recordings[i] ? recordings[i].id : null, idx);
    await page.dispatchEvent('#recBtn', 'pointerdown');
    await page.waitForFunction(() => document.getElementById('recBtn').classList.contains('recording'));
    await sleep(ms);
    if (mode === 'tap') await page.dispatchEvent('#recBtn', 'pointerdown'); else await page.dispatchEvent('#recBtn', 'pointerup');
    await page.waitForFunction(({ idx, beforeId }) => recordings[idx] && recordings[idx].id !== beforeId, { idx, beforeId }, { timeout: 10000 });
    await page.waitForFunction(() => !recPressed && !recOpening);
  };
  const setMode = async (m) => { await page.click(`#recModeRow [data-mode="${m}"]`); curMode = m; };

  await boot();

  /* ================= 1. choosing how many ================= */
  await page.evaluate(() => { startNewSubliminal(); showBuildPage(); showStep(1); });
  const chips = await page.$$eval('#affirmationCountChips .chip[data-count]', els => els.map(e => e.dataset.count));
  assert.deepEqual(chips, ['5', '10', '20', '50', '100'], 'the five quick picks');
  assert.equal(await page.$$eval('#affirmationCountChips .chip.sel', e => e.length), 1);
  for (const n of [5, 10, 20, 50, 100]) {
    await page.click(`#affirmationCountChips [data-count="${n}"]`);
    const st = await page.evaluate(() => ({ count: state.count, gen: affirmationGenerateCount, sel: [...document.querySelectorAll('#affirmationCountChips .chip.sel')].map(e => e.dataset.count || 'custom'),
      checked: [...document.querySelectorAll('#affirmationCountChips [aria-checked="true"]')].length, hint: document.getElementById('affirmationCountHint').textContent, range: document.getElementById('countRange').value }));
    assert.equal(st.count, n); assert.equal(st.gen, n); assert.deepEqual(st.sel, [String(n)]); assert.equal(st.checked, 1); assert.equal(st.range, String(n), 'the slider under Fine-tune agrees');
    if (n > 10) assert.match(st.hint, new RegExp(`${n} lines is for Record Your Own Voice.*up to 10`)); else assert.match(st.hint, /up to 100.*up to 10/);
  }
  const custom = async (text) => { await page.fill('#affirmationCountCustomInput', text); await page.dispatchEvent('#affirmationCountCustomInput', 'change'); return page.evaluate(() => ({ count: state.count, box: document.getElementById('affirmationCountCustomInput').value, customSel: document.getElementById('affirmationCountCustom').classList.contains('sel'), chips: document.querySelectorAll('#affirmationCountChips .chip[data-count].sel').length })); };
  let c = await custom('37'); assert.deepEqual(c, { count: 37, box: '37', customSel: true, chips: 0 }, 'any number 5-100');
  c = await custom('250'); assert.equal(c.count, 100); assert.equal(c.box, '100', '250 means 100');
  assert.equal(c.customSel, true, '...and the box they typed in stays the lit one'); assert.equal(c.chips, 0);
  c = await custom('2'); assert.equal(c.count, 5, 'below the minimum of 5 is raised to 5');
  c = await custom('64'); assert.equal(c.count, 64);
  c = await custom(''); assert.equal(c.count, 64, 'an empty box keeps the last number');
  await page.fill('#affirmationCountCustomInput', '88'); await page.press('#affirmationCountCustomInput', 'Enter');
  assert.equal(await page.evaluate(() => state.count), 88, 'Enter commits it');
  await page.evaluate(() => { const r = document.getElementById('countRange'); r.value = 73; r.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => [state.count, affirmationGenerateCount, document.getElementById('affirmationCountCustomInput').value].join()), '73,73,73', 'the slider and the custom box stay in step');
  assert.equal(await page.evaluate(() => document.getElementById('countRange').max), '100');
  await page.screenshot({ path: SHOTS + '/own100-count.png' });
  // the offline writer still makes 100 DIFFERENT lines
  const fb = await page.evaluate(() => { state.count = 100; state.intention = 'confidence'; state.goal = 'to be at peace'; const l = buildFallbackList(); return { n: l.length, uniq: new Set(l.map(x => x.toLowerCase())).size }; });
  assert.equal(fb.n, 100); assert.equal(fb.uniq, 100, 'no repeats in 100 offline lines');
  step(1, 'quick picks 5/10/20/50/100 + a custom number (5-100, clamped, Enter commits); slider and box agree; the offline writer yields 100 distinct lines; the hint names which voices read more than 10');

  /* ================= 2. the cost rule: AI voices never get a long list ================= */
  await page.evaluate(() => { state.affirmations = Array.from({ length: 100 }, (_, i) => `Cost line ${i + 1}`); showStep(4); setSelectedVoice(VOICE_SERENITY); nextStep(); });
  await page.waitForTimeout(200);
  let v = await page.evaluate(() => ({ step, n: state.affirmations.length, note: document.getElementById('voiceLimitNote').textContent }));
  assert.equal(v.step, 4); assert.equal(v.n, 100, 'nothing deleted'); assert.match(v.note, /Serenity reads up to 10.*100/);
  await page.evaluate(() => { setSelectedVoice(VOICE_CLONE); nextStep(); });
  assert.match(await page.textContent('#voiceLimitNote'), /Clone Your Voice reads up to 10/);
  const guard = await page.evaluate(async () => { try { await ttsRequest(['a line'], 'serenity', 1); return 'sent'; } catch (e) { return e.message; } });
  assert.equal(guard, 'too_many_lines_for_ai_voice', 'even a direct call cannot send a long list to the voice provider');
  assert.equal(ttsCalls, 0, 'no request reached /api/tts');
  await page.evaluate(() => { setSelectedVoice(VOICE_RECORD_OWN); nextStep(); });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => step), 5, 'Record Your Own Voice carries all 100');
  step(2, '100 lines + Serenity/Clone is held with an explanation, nothing is deleted, and zero requests reach the voice provider; Record Your Own Voice proceeds');

  /* ================= 3. an older (version 1) unfinished draft still opens ================= */
  await page.evaluate(`(async () => {
    ${WAV}
    await DraftStore.clear(draftOwner());
    await DraftStore.save(draftOwner(), { affirmations: ['Old one.', 'Old two.', 'Old three.', 'Old four.', 'Old five.'],
      takes: [{ blob: wav(300, 0.5), durationMs: 500, text: 'Old one.' }, null, { blob: wav(340, 0.5), durationMs: 500, text: 'Old three.' }, null, null],
      freqLayers: [{ hz: 528, vol: 100 }], bg: 'none', bgLayer: 'none', soothingLayer: 'none', targetLengthMinutes: 5 });
    startNewSubliminal(); showBuildPage(); showStep(0);
    await checkRecordingDraft();
  })()`);
  assert.equal(await page.evaluate(() => document.getElementById('draftBanner').hidden), false);
  assert.match(await page.textContent('#draftBannerText'), /2 of 5 affirmations recorded/);
  await page.click('#draftBanner .candlebtn');
  await page.waitForSelector('#recMgrList .rm-row');
  assert.deepEqual(await page.evaluate(() => recordings.map(r => r && r.text)), ['Old one.', null, 'Old three.', null, null], 'a draft saved by the previous version resumes intact');
  await page.waitForFunction(async () => { const d = await DraftStore.load(draftOwner()); return d && d.v === 2 && d.takes.filter(t => t && t.blob).length === 2 && d.takes.every(t => !t || t.id); }, null, { timeout: 5000 });
  step(3, 'a draft saved in the old whole-draft layout resumes with every take, and is rewritten in the per-take layout');
  await page.evaluate(() => { dismissRecordingDraft(); });
  await page.waitForFunction(async () => (await DraftStore.load(draftOwner())) == null);
  await page.waitForFunction(() => !Object.keys(JSON.parse(localStorage.getItem('mockdb')).storage).some(k => k.includes('/takes/')), null, { timeout: 10000 });
  step('3b', 'discarding a draft also removes what it had uploaded to the account (even an upload that was still in flight) — and nothing else');
  const baseUploads = (await mocklog()).filter(e => e.op === 'upload').length;

  /* ================= 4. recording: 100 lines, hold + tap, pause/resume ================= */
  await page.evaluate((lines) => {
    startNewSubliminal(); showBuildPage(); state.affirmations = lines; setFrequencyLayers([{ hz: 528, vol: 100 }]); setSelectedVoice(VOICE_RECORD_OWN);
    takeSync.backoffMs = [5]; window.__puts = 0; const o = DraftStore.putTake; DraftStore.putTake = (...a) => { window.__puts++; return o.apply(DraftStore, a); };
    beginRecordingPass('primary');
  }, LINES(N));
  await page.waitForSelector('#recMgrList .rm-row');
  let ui = await page.evaluate(() => ({ counter: document.getElementById('recCounter').textContent, rows: document.querySelectorAll('#recMgrList .rm-row').length, count: document.getElementById('recMgrCount').textContent,
    prog: document.getElementById('recProgress').hidden, auto: document.getElementById('recAutoNext').checked, mode: recTapMode(), btn: document.getElementById('recBtn').textContent, next: document.getElementById('nextLineBtn').textContent,
    list: (() => { const l = document.getElementById('recMgrList'); return { scrolls: l.scrollHeight > l.clientHeight * 3, overflow: getComputedStyle(l).overflowY, h: l.clientHeight }; })() }));
  assert.equal(ui.counter, 'Recording 1 of 100 · 0 recorded'); assert.equal(ui.rows, 100, 'a numbered row for every affirmation'); assert.equal(ui.count, '100/100');
  assert.equal(ui.prog, false); assert.equal(ui.auto, true, 'a long list moves along by itself by default'); assert.equal(ui.mode, false); assert.equal(ui.btn, 'HOLD');
  assert.ok(ui.list.scrolls && ui.list.overflow === 'auto', 'the list scrolls inside the page (client ' + ui.list.h + 'px)');
  assert.equal(await page.$$eval('#recMgrList .rm-num', e => e.map(x => x.textContent).join(',') === Array.from({ length: 100 }, (_, i) => i + 1).join(',')), true, 'numbered 1 to 100');
  await page.screenshot({ path: SHOTS + '/own100-record-start.png' });

  // line 1: TAP mode with a pause in the middle -- the pause is not part of the take
  await setMode('tap');
  assert.equal(await page.textContent('#recBtn'), 'TAP'); assert.match(await page.textContent('#recordFlowSub'), /Tap to start/);
  await page.dispatchEvent('#recBtn', 'pointerdown');
  await page.waitForFunction(() => document.getElementById('recBtn').classList.contains('recording'));
  assert.equal(await page.evaluate(() => document.getElementById('recTapControls').hidden), false, 'Pause and Cancel appear while recording');
  await sleep(700);
  await page.click('#recPauseBtn');
  assert.equal(await page.evaluate(() => recTake.recorder.state), 'paused'); assert.equal(await page.textContent('#recPauseBtn'), 'Resume');
  assert.match(await page.textContent('#recStatus'), /paused/);
  await sleep(1800);
  await page.click('#recPauseBtn');
  assert.equal(await page.evaluate(() => recTake.recorder.state), 'recording'); assert.equal(await page.textContent('#recPauseBtn'), 'Pause');
  await sleep(700);
  await page.dispatchEvent('#recBtn', 'pointerdown');                                  // tap to finish
  await page.waitForFunction(() => recordings[0] && recordings[0].durationMs);
  const d0 = await page.evaluate(() => recordings[0].durationMs);
  assert.ok(d0 >= 1200 && d0 < 2300, 'the 1.8 s pause is not counted: take is ' + d0 + ' ms');
  assert.equal(await page.evaluate(() => recIndex), 1, 'and it moved on to line 2 by itself');
  assert.equal(await page.textContent('#recCounter'), 'Recording 2 of 100 · 1 recorded');
  assert.equal(await page.evaluate(() => document.getElementById('recTapControls').hidden), true);
  // cancel throws the take away and leaves the line as it was
  await page.dispatchEvent('#recBtn', 'pointerdown'); await page.waitForFunction(() => document.getElementById('recBtn').classList.contains('recording'));
  await sleep(600); await page.click('#recCancelBtn');
  await page.waitForFunction(() => /cancelled/i.test(document.getElementById('recStatus').textContent));
  assert.deepEqual(await page.evaluate(() => [recordings[1], recIndex, recPressed]), [null, 1, false], 'cancel: nothing recorded, same line, ready again');
  // a microphone refusal on one line is a message, not a restart
  await page.evaluate(() => { const md = navigator.mediaDevices, o = md.getUserMedia.bind(md); md.getUserMedia = () => { md.getUserMedia = o; return Promise.reject(new Error('NotAllowedError')); }; });
  await page.dispatchEvent('#recBtn', 'pointerdown');
  await page.waitForFunction(() => /Microphone access is needed/.test(document.getElementById('recStatus').textContent));
  assert.deepEqual(await page.evaluate(() => [recordings.filter(Boolean).length, recPressed, recIndex]), [1, false, 1], 'the refusal changed nothing');
  // a recorder that dies mid-take ends that take only
  await page.dispatchEvent('#recBtn', 'pointerdown'); await page.waitForFunction(() => document.getElementById('recBtn').classList.contains('recording'));
  await page.evaluate(() => recTake.recorder.onerror(new Event('error')));
  await page.waitForFunction(() => /interrupted recording line 2/.test(document.getElementById('recStatus').textContent));
  assert.deepEqual(await page.evaluate(() => [recordings.filter(Boolean).length, recPressed, document.getElementById('recBtn').classList.contains('recording'), recIndex]), [1, false, false, 1], 'recorder failure: the session carries on');
  step(4, 'tap-to-record with Pause/Resume (the pause is not in the take), Cancel, a refused microphone and a failed recorder each cost nothing — and a long list advances to the next line by itself');

  // lines 2..: alternate hold and tap; deliberately fail the upload of one
  const total = async () => page.evaluate(() => recordings.filter(Boolean).length);
  for (let i = 1; i < 60; i++) {
    if (i === 40) {
      await page.waitForFunction(() => recordings.slice(0, 40).every(r => r && r.path), null, { timeout: 20000 });
      await page.evaluate(() => localStorage.setItem('mock_upload_fail', 'all'));
    }
    await record(i % 2 ? 'hold' : 'tap', 520).catch(async (e) => { throw new Error('line ' + (i + 1) + ': ' + e.message); });
    if (i === 40) {
      await page.waitForFunction(() => recSyncState(recordings[40]) === 'failed', null, { timeout: 15000 });
      await page.evaluate(() => localStorage.removeItem('mock_upload_fail'));
    }
    if (i === 33) assert.equal(await page.textContent('#recCounter'), 'Recording 35 of 100 · 34 recorded', 'progress reads like “Recording 35 of 100”');
    if (i === 41) {
      const st = await page.evaluate(() => ({ failed: recordings.filter(r => r && recSyncState(r) === 'failed').length, status: document.querySelector('#recMgrList .rm-row[data-i="40"] .rm-status').textContent,
        summary: document.getElementById('recMgrSummary').textContent, retry: !document.getElementById('recRetryAll').hidden, rec: recordings.filter(Boolean).length }));
      assert.equal(st.failed, 1, 'only that one failed to upload'); assert.match(st.status, /not uploaded yet — saved on this device/); assert.match(st.summary, /1 not uploaded yet/);
      assert.ok(st.retry, 'Retry is offered'); assert.equal(st.rec, 42, 'and recording carried on without stopping');
    }
  }
  assert.equal(await total(), 60);
  // wait for the queue: all but the failed one are in the account already, BEFORE anything was saved
  await page.waitForFunction(() => recordings.filter(r => r && r.path).length === 59, null, { timeout: 20000 });
  const mid = await mocklog();
  const uploadedMid = mid.filter(e => e.op === 'upload').length - baseUploads;
  assert.equal(uploadedMid, 59, '59 recordings were already in the account while still recording (no Save pressed)');
  assert.ok((await storageKeys()).filter(k => k.startsWith('recordings/user-1/takes/')).length === 59, 'in the signed-in person\'s own folder');
  await page.click('#recRetryAll');
  await page.waitForFunction(() => recordings.filter(r => r && r.path).length === 60, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => recordings.filter(Boolean).every(r => recSyncState(r) === 'synced')), true, 'Retry sent the missing one');
  const idsBefore = await page.evaluate(() => recordings.map(r => r && r.id));
  const pathsBefore = await page.evaluate(() => recordings.map(r => r && r.path));
  step('4b', '60 lines recorded by hold and tap: each is sent to the account as it is made (59 there before any Save), one forced upload failure does not stop anything and is fixed with Retry');

  // list behaviour at line 61
  const listBehaviour = await page.evaluate(() => {
    const l = document.getElementById('recMgrList'); const cur = l.children[recIndex]; const lr = l.getBoundingClientRect(), cr = cur.getBoundingClientRect();
    return { recIndex, top: l.scrollTop, lr: [lr.top, lr.bottom], cr: [cr.top, cr.bottom], inView: cr.top >= lr.top - 1 && cr.bottom <= lr.bottom + 1 };
  });
  assert.equal(listBehaviour.recIndex, 60); assert.ok(listBehaviour.top > 1000, 'the list followed the recording down'); assert.ok(listBehaviour.inView, 'the current line is in view in the list ' + JSON.stringify(listBehaviour));
  const keep = await page.evaluate(() => { const l = document.getElementById('recMgrList'); l.scrollTop = 777; paintRecordManager(); return l.scrollTop; });
  assert.equal(keep, 777, 'a repaint does not throw the scroll position back to the top');
  await page.fill('#recJump', '12'); await page.press('#recJump', 'Enter');
  assert.equal(await page.evaluate(() => recIndex), 11, 'Go to line 12'); assert.match(await page.textContent('#recCounter'), /^Recording 12 of 100/);
  assert.equal(await page.evaluate(() => { const l = document.getElementById('recMgrList'); const cr = l.children[11].getBoundingClientRect(), lr = l.getBoundingClientRect(); return cr.top >= lr.top - 1 && cr.bottom <= lr.bottom + 1; }), true, 'and the list scrolled there');
  await page.click('.rm-tools .rm-btn >> text=Next unrecorded');
  assert.equal(await page.evaluate(() => recIndex), 60, 'Next unrecorded finds line 61');
  await page.screenshot({ path: SHOTS + '/own100-record-60.png' });

  // preview, remove a recording (keeps the words), re-record it
  await page.click('#recMgrList .rm-row[data-i="3"] [aria-label^="Play your recording of affirmation 4"]');
  assert.equal(await page.evaluate(() => recPlayingIndex), 3); assert.equal(await page.textContent('#recMgrList .rm-row[data-i="3"] [aria-label^="Stop playing affirmation 4"]'), 'Stop', 'the button becomes Stop while it plays');
  await page.click('#recMgrList .rm-row[data-i="3"] [aria-label^="Stop playing affirmation 4"]');
  assert.equal(await page.evaluate(() => recPlayingIndex), -1, 'preview stops');
  const oldPath3 = pathsBefore[3];
  await page.click('#recMgrList .rm-row[data-i="3"] [aria-label^="Remove the recording of affirmation 4"]');
  assert.deepEqual(await page.evaluate(() => [recordings[3], state.affirmations[3], document.querySelector('#recMgrList .rm-row[data-i="3"] .rm-status').textContent]), [null, LINES(N)[3], 'Not recorded yet'], 'the recording is removed, the words stay');
  await page.waitForFunction(async (p) => { const k = Object.keys(JSON.parse(localStorage.getItem('mockdb')).storage); return !k.includes('recordings/' + p); }, oldPath3, { timeout: 10000 });
  await page.click('#recMgrList .rm-row[data-i="3"] [aria-label="Record affirmation 4"]');
  await record('hold', 520);
  assert.equal(await taken(), 60, 'recorded again');
  await page.evaluate(() => { recIndex = 60; showRecordLine(); });
  step('4c', 'the list is numbered 1-100 and scrolls inside the page (position survives repaints), “Recording N of 100”, Go to line, Next unrecorded, Play/Stop preview, remove just a recording, re-record — and the discarded take\'s uploaded file is cleaned up');

  /* ================= 5. refresh in the middle ================= */
  const idsNow = await page.evaluate(() => recordings.map(r => r && r.id));
  await page.waitForTimeout(800);
  await boot();
  await page.evaluate(() => showBuildPage());
  await page.waitForSelector('#draftBanner:not([hidden])', { timeout: 5000 });
  assert.match(await page.textContent('#draftBannerText'), /60 of 100 affirmations recorded/);
  const uploadsBeforeResume = (await mocklog()).filter(e => e.op === 'upload').length;
  await page.evaluate(() => { takeSync.backoffMs = [5]; window.__puts = 0; const o = DraftStore.putTake; DraftStore.putTake = (...a) => { window.__puts++; return o.apply(DraftStore, a); }; });
  await page.click('#draftBanner .candlebtn');
  await page.waitForSelector('#recMgrList .rm-row');
  const resumed = await page.evaluate(() => ({ step, n: state.affirmations.length, takes: recordings.filter(Boolean).length, ids: recordings.map(r => r && r.id), paths: recordings.map(r => r && r.path), idx: recIndex,
    playable: recordings.filter(Boolean).every(r => r.blob && r.blob.size > 300), counter: document.getElementById('recCounter').textContent }));
  assert.equal(resumed.step, 6); assert.equal(resumed.n, 100); assert.equal(resumed.takes, 60, 'all 60 takes are back'); assert.ok(resumed.playable);
  assert.deepEqual(resumed.ids, idsNow, 'every take kept its identity across the refresh');
  assert.equal(resumed.idx, 60, 'it resumes at the first line with no recording'); assert.ok(resumed.paths.filter(Boolean).length >= 58, 'and knows where it already is in the account');
  assert.match(resumed.counter, /^Recording \d+ of 100 · 60 recorded$/);
  await page.waitForTimeout(1200);
  const uploadsAfterResume = (await mocklog()).filter(e => e.op === 'upload').length;
  assert.ok(uploadsAfterResume - uploadsBeforeResume <= 2, 'resuming did not upload the 60 again (' + (uploadsAfterResume - uploadsBeforeResume) + ' new)');
  assert.equal((await mocklog()).filter(e => e.op === 'upload-duplicate').length, 0, 'and made no duplicate objects');
  step(5, 'full page refresh at 60 of 100: the banner offers it, resuming restores all 60 takes with their identities and account locations — nothing re-uploaded, no duplicate files');

  /* ================= 6. finish the other 40, edit, save ================= */
  await setMode('hold');
  await page.evaluate(() => { recIndex = 60; recScrollListToCurrent = true; showRecordLine(); });
  for (let i = 60; i < 100; i++) {
    await record(i % 3 ? 'hold' : 'hold', 520).catch(e => { throw new Error('line ' + (i + 1) + ': ' + e.message); });
  }
  assert.equal(await taken(), 100);
  assert.equal(await page.evaluate(() => recIndex), 99, 'the last line stays selected (it does not run off the end)');
  assert.equal(await page.textContent('#nextLineBtn'), 'Finish →');
  assert.equal(await page.evaluate(() => document.getElementById('recMgrSummary').textContent.startsWith('100 of 100 recorded')), true);
  assert.equal(await page.getAttribute('#recProgress', 'aria-valuenow'), '100');
  const puts = await page.evaluate(() => window.__puts);
  assert.ok(puts <= 41, 'on-device writes were per take, not the whole draft each time (' + puts + ' take writes for 40 new takes)');
  // edit one recorded line: take kept, flagged; re-record clears it
  await page.click('#recMgrList .rm-row[data-i="9"] [aria-label="Edit affirmation 10"]');
  await page.fill('#recMgrList .rm-edit', 'Affirmation number 10, reworded.'); await page.click('#recMgrList [aria-label="Save this change"]');
  assert.match(await page.textContent('#recMgrList .rm-row[data-i="9"] .rm-status'), /Words changed since recording/);
  await page.click('#recMgrList .rm-row[data-i="9"] [aria-label="Re-record affirmation 10"]');
  await page.evaluate(() => { window.__edited = recordings[9].id; });
  await record('hold', 520);
  assert.notEqual(await page.evaluate(() => recordings[9].id), await page.evaluate(() => window.__edited), 'a new take replaced it');
  assert.match(await page.textContent('#recMgrList .rm-row[data-i="9"] .rm-status'), /^Recorded/);
  await page.waitForFunction(() => recordings.every(r => r && r.path), null, { timeout: 20000 });
  const keysBeforeSave = await storageKeys();
  assert.equal(keysBeforeSave.filter(k => k.includes('/takes/')).length, 100, 'exactly 100 objects in the account for 100 lines — replaced takes left nothing behind');
  const urlsInMemory = await page.evaluate(() => recordings.map(r => r.path));
  assert.equal(new Set(urlsInMemory).size, 100, '100 distinct files');

  await page.evaluate(`(async () => { ${WAV} setAffirmationGap(0.2); state.targetLengthMinutes = 5; prepareFinal(); showStep(7); })()`);
  await page.waitForSelector('#finalPlaylist li');
  assert.equal(await page.$$eval('#finalPlaylist li', l => l.length), 100, 'the finished screen lists all 100 before play');
  assert.equal(await page.textContent('#finalPlaylistCount'), '100/100');
  await page.fill('#finalTitleInput', 'One hundred in my voice');
  const logBeforeSave = (await mocklog()).length;
  await page.evaluate(() => { saveSubliminal(); saveSubliminal(); saveSubliminal(); });          // a frantic triple press
  await page.waitForFunction(() => /Saved to your library/.test(document.getElementById('saveMsg').textContent), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  let rows = await subs(); const mine = rows.filter(r => r.title === 'One hundred in my voice');
  assert.equal(mine.length, 1, 'three presses of Save make one subliminal');
  const row = mine[0];
  assert.equal(row.affirmations.length, 100); assert.equal(row.recording_urls.length, 100); assert.ok(row.recording_urls.every(Boolean), 'every line has its recording');
  assert.deepEqual(row.recording_urls, urlsInMemory, 'saved in line order, pointing at the files already uploaded');
  assert.equal(new Set(row.recording_urls).size, 100); assert.ok(row.recording_urls.every(p => p.startsWith('user-1/')), 'all inside the account\'s own folder');
  assert.deepEqual(row.mix_settings.affirmationMeta.map(m => m.order), [...Array(100).keys()]);
  assert.ok(row.mix_settings.affirmationMeta.every(m => m.durationMs > 0 && m.recordedText), 'duration + recorded text for each of the 100');
  const afterSave = (await mocklog()).slice(logBeforeSave);
  assert.equal(afterSave.filter(e => e.storage && e.op === 'upload').length, 0, 'Save uploaded nothing: it was all there already');
  assert.equal(afterSave.filter(e => e.table === 'subliminals' && e.op === 'insert').length, 1);
  assert.equal((await storageKeys()).filter(k => k.includes('/takes/')).length, 100);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(async () => (await DraftStore.load(draftOwner())) == null), true, 'saving removes the on-device draft');
  assert.equal(await page.evaluate(() => recordings.every(r => r.committed)), true, 'every file is now part of a saved subliminal');
  step(6, 'the other 40 recorded; per-take device writes; edit + re-record; 100 files for 100 lines; Save (pressed three times) wrote one subliminal and uploaded nothing new; order, duration and text saved for each');

  /* ================= 7. reopen, change one line, save over it: nothing removed ================= */
  const legacyBefore = JSON.stringify((await subs()).find(r => r.id === 'legacy-own'));
  const legacyKeysBefore = (await storageKeys()).filter(k => k.includes('1700000000000'));
  await boot();
  assert.equal(await page.evaluate(() => document.getElementById('draftBanner').hidden), true);
  const t0 = Date.now();
  await page.evaluate(async (id) => { await loadSavedIntoBuilder(id); }, row.id);
  const loadMs = Date.now() - t0;
  const re = await page.evaluate(() => ({ n: recordings.filter(Boolean).length, errs: recordingLoadErrors.length, committed: recordings.every(r => r && r.committed && r.path && r.blob.size > 300), dur: recordings.every(r => r.durationMs > 0),
    stale: recordings.filter((r, i) => r.text !== state.affirmations[i]).length, pl: document.querySelectorAll('#finalPlaylist li').length, lines: state.affirmations.slice() }));
  assert.equal(re.n, 100); assert.equal(re.errs, 0); assert.ok(re.committed); assert.ok(re.dur); assert.equal(re.stale, 0); assert.equal(re.pl, 100); assert.deepEqual(re.lines, row.affirmations);
  console.log(`   (100 recordings downloaded and ready in ${loadMs} ms)`);
  // change line 7 only
  await page.evaluate(() => { beginRecordingPass('primary'); try { localStorage.setItem('fthr_rec_auto_next', '0'); } catch (e) {} });
  await page.click('#recMgrList .rm-row[data-i="6"] [aria-label="Re-record affirmation 7"]');
  await record('hold', 520);
  assert.equal(await page.evaluate(() => recIndex), 6, 'auto-advance can be switched off');
  await page.waitForFunction(() => recordings[6].path && !recordings[6].committed, null, { timeout: 10000 });
  const newPath6 = await page.evaluate(() => recordings[6].path);
  assert.notEqual(newPath6, row.recording_urls[6]);
  await page.evaluate(`(async () => { ${WAV} setAffirmationGap(0.2); prepareFinal(); showStep(7); })()`);
  await page.click('#saveBtn');
  await page.waitForFunction(() => /Changes saved to this subliminal/.test(document.getElementById('saveMsg').textContent), null, { timeout: 30000 });
  rows = await subs();
  const updated = rows.find(r => r.id === row.id);
  assert.equal(rows.filter(r => r.title === 'One hundred in my voice').length, 1, 'updated in place, not duplicated');
  assert.equal(updated.recording_urls[6], newPath6);
  assert.deepEqual(updated.recording_urls.filter((_, i) => i !== 6), row.recording_urls.filter((_, i) => i !== 6), 'the other 99 are exactly as they were');
  const keysAfter = await storageKeys();
  assert.ok(keysAfter.includes('recordings/' + row.recording_urls[6]), 'the previous recording of line 7 was NOT deleted (existing data is never removed)');
  assert.equal(JSON.stringify((await subs()).find(r => r.id === 'legacy-own')), legacyBefore, 'a subliminal saved before this change is byte-for-byte untouched');
  assert.deepEqual(keysAfter.filter(k => k.includes('1700000000000')), legacyKeysBefore, 'and so are its recordings');
  // a failed upload during a save over an existing subliminal writes nothing
  await page.evaluate(`(async () => { ${WAV} const b = wav(500, 0.3); window.__newTake = { id: TakeSyncKit.makeId(), url: URL.createObjectURL(b), blob: b, durationMs: 300, text: state.affirmations[20], committed: false }; recordings[20] = window.__newTake; takeSync.backoffMs = [5]; localStorage.setItem('mock_upload_fail', 'all'); })()`);
  const snapshotRow = JSON.stringify((await subs()).find(r => r.id === row.id));
  await page.click('#saveBtn');
  await page.waitForFunction(() => /couldn't be sent to your account/.test(document.getElementById('saveMsg').textContent), null, { timeout: 20000 });
  assert.match(await page.textContent('#saveMsg'), /Nothing was lost and nothing was saved over/);
  assert.equal(JSON.stringify((await subs()).find(r => r.id === row.id)), snapshotRow, 'the saved subliminal was not touched by the failed save');
  assert.ok(await page.evaluate(() => !!recordings[20].blob), 'the take is still here');
  await page.evaluate(() => localStorage.removeItem('mock_upload_fail'));
  await page.click('#saveBtn');
  await page.waitForFunction(() => /Changes saved to this subliminal/.test(document.getElementById('saveMsg').textContent), null, { timeout: 30000 });
  assert.ok((await subs()).find(r => r.id === row.id).recording_urls[20].includes('/takes/'), 'pressing Save again sent only the missing one and saved');
  step(7, 'reopen → 100 recordings back; change one line and save over it: the other 99 untouched, the old file kept, the older subliminal untouched; a failed upload during Save writes nothing and loses nothing');
  const reloadedForPlay = await page.evaluate(async (id) => { await loadSavedIntoBuilder(id); return recordings.filter(Boolean).length; }, row.id);
  assert.equal(reloadedForPlay, 100);
  // the older subliminal still opens
  await page.evaluate(async () => { await loadSavedIntoBuilder('legacy-own'); });
  assert.deepEqual(await page.evaluate(() => [recordings.map(r => !!r), recordingLoadErrors.length]), [[true, true, false, true, true], 0], 'an older subliminal (old storage layout, a gap in it) still loads, gap and all');

  /* ================= 8. play all 100, in order, looping, with the lyrics list ================= */
  await page.evaluate(`(async () => {
    ${WAV}
    closeImmersivePlayer(); stopFinal();
    await loadSavedIntoBuilder(${JSON.stringify(row.id)});
    /* Real recordings are 0.5 s+ each; for a full 100-line pass in test time the
       audio is swapped for 0.12 s tones. Order, loop, list and memory behaviour
       are what is under test, and they do not depend on the length of a line. */
    recordings.forEach((r, i) => { const blob = wav(250 + (i % 20) * 15, 0.12); r.blob = blob; r.url = URL.createObjectURL(blob); r._clip = null; r.durationMs = 120; });
    setAffirmationGap(0.04); state.targetLengthMinutes = 5; prepareFinal(); renderFinalPlaylist();
    window.__ev = []; window.__maxClips = 0;
    affTimeline.on(s => { if (s.type === 'start') { window.__ev.push({ i: s.active, pass: s.pass, t: performance.now() }); window.__maxClips = Math.max(window.__maxClips, recordings.filter(r => r && r._clip).length); } });
    openImmersivePlayer();
    window.__scrollCalls = []; const origScroll = playerLyrics.scrollTo.bind(playerLyrics); playerLyrics.scrollTo = (i) => { window.__scrollCalls.push(i); return origScroll(i); };
  })()`);
  const lyr = await page.evaluate(() => ({ n: document.querySelectorAll('#ipLyrics .ip-lyric').length, texts: [...document.querySelectorAll('#ipLyrics .ip-lyric-text')].map(e => e.textContent).slice(0, 3), states: new Set([...document.querySelectorAll('#ipLyrics .ip-lyric')].map(e => e.dataset.state)).size }));
  assert.equal(lyr.n, 100, 'the lyrics-style list shows the full list before play'); assert.equal(lyr.states, 1);
  await page.click('#ipPlay');
  await page.waitForFunction(() => window.__ev.some(e => e.i === 60), null, { timeout: 40000 });
  // mid-pass: the active line is highlighted AND scrolled into view in the list
  const mid1 = await page.evaluate(() => { const list = document.getElementById('ipLyrics'); const act = document.querySelector('#ipLyrics .ip-lyric[data-state="active"]'); if (!act) return null; const lr = list.getBoundingClientRect(), ar = act.getBoundingClientRect();
    return { i: Number(act.dataset.i), top: list.scrollTop, inView: ar.top >= lr.top - 2 && ar.bottom <= lr.bottom + 2, lit: document.querySelectorAll('#ipLyrics .ip-lyric[data-state="active"]').length, clips: recordings.filter(r => r && r._clip).length }; });
  assert.ok(mid1 && mid1.top > 1000, 'the list auto-scrolled down (scrollTop ' + (mid1 && mid1.top) + ')'); assert.ok(mid1.inView, 'the line being spoken is on screen'); assert.equal(mid1.lit, 1, 'exactly one line lit');
  assert.ok(mid1.clips <= 3, 'at most 3 recordings are held decoded at once (' + mid1.clips + ') — not 100');
  // the screen locks / the app is backgrounded: audio context is suspended under us, then the page returns
  await page.evaluate(() => finalCtx.suspend());
  await page.waitForTimeout(400);
  await page.evaluate(() => { syncFinalAfterForeground(); });
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => finalCtx.state), 'running', 'playback resumed after the interruption');
  await page.waitForFunction(() => window.__ev.some(e => e.pass >= 2 && e.i >= 2), null, { timeout: 60000 });
  const ev = await page.evaluate(() => window.__ev);
  const pass1 = ev.filter(e => e.pass === 1).map(e => e.i);
  assert.deepEqual(pass1, [...Array(100).keys()], 'pass 1: all 100 affirmations, in order, none skipped, none repeated');
  const pass2 = ev.filter(e => e.pass === 2).map(e => e.i);
  assert.deepEqual(pass2.slice(0, 3), [0, 1, 2], 'it loops: pass 2 begins again at line 1');
  const scrollCalls = await page.evaluate(() => window.__scrollCalls);
  const firstWrap = scrollCalls.indexOf(0, scrollCalls.indexOf(99) >= 0 ? scrollCalls.indexOf(99) : 50);
  assert.ok(firstWrap > 0, 'when the loop came round the list was sent back to line 1 (scroll targets: ...' + scrollCalls.slice(-8).join(',') + ')');
  assert.ok(await page.evaluate(() => window.__maxClips) <= 3, 'memory stayed flat across the whole pass: never more than 3 decoded');
  await page.screenshot({ path: SHOTS + '/own100-playing.png' });
  // pause holds the line, resume continues the same one
  await page.click('#ipPlay');
  await page.waitForTimeout(300);
  const frozen = await page.evaluate(() => ({ a: affTimeline.active, n: window.__ev.length }));
  await page.waitForTimeout(1200);
  assert.deepEqual(await page.evaluate(() => ({ a: affTimeline.active, n: window.__ev.length })), frozen, 'nothing advances while paused');
  await page.click('#ipPlay');
  await page.waitForFunction(n => window.__ev.length > n, frozen.n, { timeout: 8000 });
  await page.evaluate(() => stopFinal());
  await page.waitForFunction(() => recordings.filter(r => r && r._clip).length === 0, null, { timeout: 3000 }).catch(() => {});
  assert.equal(await page.evaluate(() => recordings.filter(r => r && r._clip).length), 0, 'stopping gives the decoded audio back');
  step(8, 'all 100 play in order (pass 1 = 0..99 exactly), loop back to line 1 with the list, the active line is lit and scrolled into view, an audio interruption + return resumes cleanly, pause freezes, ≤3 clips decoded at any moment');

  // the real, reopened recordings (not synthetic tones) play from line 1 in order too
  await page.evaluate(async (id) => { closeImmersivePlayer(); stopFinal(); await loadSavedIntoBuilder(id); setAffirmationGap(0.1); window.__real = []; affTimeline.on(s => { if (s.type === 'start') window.__real.push(s.active); }); openImmersivePlayer(); playFinal(); }, row.id);
  await page.waitForFunction(() => window.__real.length >= 5, null, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => window.__real.slice(0, 5)), [0, 1, 2, 3, 4], 'the actual saved recordings play from the start, in order');
  await page.evaluate(() => stopFinal());
  step('8b', 'the actual downloaded recordings (real microphone audio) play in order from line 1');

  /* ================= 9. clean ================= */
  const real = errors.filter(e => !/Failed to load resource|supabase|net::|ERR_|503/.test(e));
  assert.deepEqual(real, [], 'no uncaught page errors: ' + real.join(' | '));
  assert.equal(ttsCalls, 0, 'the voice provider was never asked for anything during the whole run');
  await browser.close();
  console.log('ALL PASSED');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
