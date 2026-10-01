/* End-to-end check of Adjust Sounds on a saved subliminal, in a real browser
   against an in-memory Supabase (scripts/fixtures/mock-supabase.js).
   Serve the repo first:  python3 -m http.server 8123
   Then:                  npm run test:audio-editor
   Needs Playwright (npm i -g playwright, or PLAYWRIGHT_MODULE=/path/to/playwright). */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'); const assert = require('assert/strict');
const BASE = 'http://localhost:8123';
const MOCK = fs.readFileSync(__dirname + '/fixtures/mock-supabase.js', 'utf8');
const SHOTS = process.env.SHOTS || require('os').tmpdir();
let apiCalls = [];
const step = (n, s) => console.log(`✔ ${n}. ${s}`);

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (url.startsWith(BASE + '/api/')) { apiCalls.push(url); return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline in test"}' }); }
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
  });
  const boot = async (hash = '') => {
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
    await page.waitForTimeout(400);
  };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const subs = async () => ((await db()).tables.subliminals || []);
  const log = () => page.evaluate(() => JSON.parse(localStorage.getItem('mocklog') || '[]'));
  const openLibrary = async () => {
    await page.evaluate(async () => { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); showLibraryPage(); await loadMyLibrary({ force: true }); });
    await page.waitForSelector('.lib-adjust', { state: 'visible' });
  };
  const openEditor = async () => {
    await page.click('.lib-adjust');
    await page.waitForSelector('#aeFreqs .ae-card');
  };

  await boot();

  // 1. Create and save a subliminal: built in "record my own voice" mode with
  //    two recorded lines, saved through the real Save button on step 7.
  await page.evaluate(async () => {
    const wav = (hz) => { const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / sr * hz * 2 * Math.PI) * 8000, true);
      return new Blob([b], { type: 'audio/wav' }); };
    startNewSubliminal();
    state.freq = FREQS.find(f => f.hz === 528);
    state.affirmations = ['I am calm and certain.', 'Everything I want is already mine.'];
    state.voiceMode = 'own'; state.selectedVoice = VOICE_RECORD_OWN;
    state.binauralBand = 'theta';
    chooseAmbience('ocean-escape');
    recordings = state.affirmations.map((_, i) => { const blob = wav(300 + i * 50); return { url: URL.createObjectURL(blob), blob }; });
    showBuildPage(); showStep(7); prepareFinal();
  });
  await page.fill('#finalTitleInput', 'Night Reset');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /Saved to your library/.test(document.getElementById('saveMsg').textContent));
  let rows = await subs();
  assert.equal(rows.length, 1);
  const id = rows[0].id; const origRecordings = rows[0].recording_urls; const origAffs = rows[0].affirmations;
  assert.equal(rows[0].frequency_hz, 528); assert.equal(rows[0].binaural_band, 'theta'); assert.equal(rows[0].background, 'ocean-escape');
  assert.equal(origRecordings.filter(Boolean).length, 2);
  // Saving again from step 7 updates in place rather than duplicating.
  await page.evaluate(() => closeCoverPicker && closeCoverPicker()).catch(() => {});
  await page.evaluate(() => document.querySelectorAll('.cover-pop,.modal-overlay').forEach(m => m.remove()));
  assert.equal((await page.textContent('#saveBtnLabel')).trim(), 'Save changes');
  await page.click('#saveBtn');
  await page.waitForFunction(() => /Changes saved/.test(document.getElementById('saveMsg').textContent));
  assert.equal((await subs()).length, 1, 'second save on step 7 must not duplicate');
  step(1, 'created and saved "Night Reset" (528 Hz, Theta, Ocean Escape, 2 recorded lines); re-saving updates in place');

  // 2. Close it (fresh page load = nothing in memory).
  await boot();
  step(2, 'closed (page reloaded, nothing kept in memory)');

  // 3. Reopen the saved subliminal -> Adjust Sounds shows current selections.
  await openLibrary(); await openEditor();
  const lit = await page.evaluate(() => ({
    band: [...document.querySelectorAll('#aeBands .ae-chip.sel')].map(e => e.dataset.band),
    hz: [...document.querySelectorAll('#aeFreqs .ae-card.sel')].map(e => e.dataset.hz),
    amb: [...document.querySelectorAll('#aeAmbience .ae-card.sel')].map(e => e.dataset.key) }));
  assert.deepEqual(lit, { band: ['theta'], hz: ['528'], amb: ['ocean-escape'] });
  await page.screenshot({ path: SHOTS + '/adjust-sounds-open.png' });
  step(3, `reopened; editor pre-selects ${JSON.stringify(lit)}`);

  // 4-5. Change the frequency and save.
  const uploadsBefore = (await log()).filter(e => e.storage).length;
  await page.click('#aeFreqs .ae-card[data-hz="432"]');
  assert.equal(await page.textContent('#aeSaveBtn'), 'Save Changes');
  await page.click('#aeSaveBtn');
  await page.waitForFunction(() => /Saved\./.test(document.getElementById('aeStatus').textContent));
  assert.equal((await subs())[0].frequency_hz, 432);
  step('4-5', 'changed frequency to 432 Hz and saved');

  // 6. Reopen and verify the new frequency persisted.
  await page.click('.audio-editor .ps-close');
  await boot(); await openLibrary(); await openEditor();
  assert.deepEqual(await page.$$eval('#aeFreqs .ae-card.sel', els => els.map(e => e.dataset.hz)), ['432']);
  step(6, 'after reload the editor opens with 432 Hz selected');

  // 7. Change the nature sound without touching affirmations (and preview it).
  await page.click('#aeAmbience .ae-card[data-key="deep-mind"]');      // layer a meditation sound under the ocean
  await page.click('#aeAmbience .ae-card[data-key="ocean-escape"]');    // take the ocean off
  await page.click('#aeBands .ae-chip[data-band="delta"]');
  await page.click('#aePreviewBtn');
  await page.waitForTimeout(800);
  const playing = await page.evaluate(() => finalPlaying);
  await page.click('#aePreviewBtn');
  await page.click('#aeSaveBtn');
  await page.waitForFunction(() => /Saved\./.test(document.getElementById('aeStatus').textContent));
  rows = await subs();
  assert.equal(rows[0].background, 'deep-mind'); assert.equal(rows[0].binaural_band, 'delta');
  assert.deepEqual(rows[0].affirmations, origAffs);
  step(7, `ambience → Deep Mind, brainwave → Delta, previewed (engine playing: ${playing}), saved; affirmations untouched`);

  // 8. The original recording is reused.
  assert.deepEqual(rows[0].recording_urls, origRecordings);
  const uploadsAfter = (await log()).filter(e => e.storage).length;
  assert.equal(uploadsAfter, uploadsBefore, 'no audio uploaded by audio edits');
  assert.equal(apiCalls.filter(u => /\/api\/(tts|voice-clone|voice-preview)/.test(u)).length, 0, 'no TTS / voice API calls: ' + apiCalls.join(', '));
  const recordingStep = await page.evaluate(() => step);
  step(8, `recording_urls identical (${origRecordings.join(', ')}); 0 uploads, 0 calls to /api/tts, /api/voice-clone or /api/voice-preview; builder step stayed at ${recordingStep}`);

  // 9. Adjust each layer's volume.
  const vols = { mixVoice: 81, mixTone: 12, mixBg: 67, mixSoothing: 33 };
  await page.click('#aeSoothing .ae-chip[data-variant="chimes"]');
  await page.waitForFunction(() => state.soothingLayer === 'chimes');
  for (const [k, v] of Object.entries(vols)) {
    await page.$eval(`#aeBody [data-listening-mix="${k}"]`, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  }
  // Autosave is paused while editing: nothing written until Save Changes.
  assert.notEqual((await subs())[0].mix_settings.mixVoice, 81);
  await page.click('#aeSaveBtn');
  await page.waitForFunction(() => /Saved\./.test(document.getElementById('aeStatus').textContent));
  step(9, `set volumes ${JSON.stringify(vols)} + soothing chimes and saved`);

  // 10. Refresh and verify every volume persisted.
  await boot(); await openLibrary(); await openEditor();
  const after = await page.evaluate(() => Object.fromEntries(['mixVoice','mixTone','mixBg','mixSoothing'].map(k => [k, Number(document.querySelector(`#aeBody [data-listening-mix="${k}"]`).value)])));
  assert.deepEqual(after, vols);
  assert.deepEqual(await page.$$eval('#aeSoothing .ae-chip.sel', e => e.map(x => x.dataset.variant)), ['chimes']);
  assert.deepEqual(await page.$$eval('#aeAmbience .ae-card.sel', e => e.map(x => x.dataset.key)), ['deep-mind']);
  assert.deepEqual(await page.$$eval('#aeBands .ae-chip.sel', e => e.map(x => x.dataset.band)), ['delta']);
  await page.$eval('#aeBody', el => { el.scrollTop = 620; });
  await page.screenshot({ path: SHOTS + '/adjust-sounds-reopened.png', fullPage: false });
  await page.$eval('#aeBody', el => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: SHOTS + '/adjust-sounds-volumes.png', fullPage: false });
  step(10, `after refresh: volumes ${JSON.stringify(after)}, chimes, Deep Mind, Delta, 432 Hz all restored`);

  // Discard path: change something, close without saving, nothing written and state restored.
  await page.click('#aeFreqs .ae-card[data-hz="639"]');
  await page.click('.audio-editor .ps-close');   // confirm() auto-accepted → discard
  assert.equal((await subs())[0].frequency_hz, 432);
  assert.equal(await page.evaluate(() => state.freq.hz), 432);

  // 11. No duplicates from editing; Save as new only on request.
  assert.equal((await subs()).length, 1, 'audio editing never duplicates');
  await openEditor();
  await page.click('#aeFreqs .ae-card[data-hz="741"]');
  await page.click('#aeSaveNewBtn');
  await page.fill('#aeNewTitle', 'Night Reset — focus');
  await page.click('#aeNewRow .ps-use');
  await page.waitForFunction(() => /Saved as a new subliminal/.test(document.getElementById('aeStatus').textContent));
  rows = await subs();
  assert.equal(rows.length, 2);
  const orig = rows.find(r => r.id === id), copy = rows.find(r => r.id !== id);
  assert.equal(orig.frequency_hz, 432); assert.equal(copy.frequency_hz, 741);
  assert.deepEqual(copy.recording_urls, origRecordings); assert.equal(copy.title, 'Night Reset — focus');
  step(11, 'audio edits kept 1 row; only the explicit "Save as new" made a 2nd (original untouched, copy reuses the same voice files)');

  // 12. Never forced through recording.
  const visited = await page.evaluate(() => step);
  assert.notEqual(visited, 6);
  const recordStepShown = await page.evaluate(() => document.querySelector('.flow-step[data-step="6"]').classList.contains('active'));
  assert.equal(recordStepShown, false);
  step(12, `recording step never opened (builder step = ${visited}); no re-record prompt`);

  // Logout/login persistence.
  await page.evaluate(() => localStorage.setItem('mock_logged_in', '0'));
  await page.goto(BASE + '/'); await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'out');
  await page.evaluate(() => localStorage.setItem('mock_logged_in', '1'));
  await boot(); await openLibrary();
  await page.click(`#libItem-${id} .lib-adjust`); await page.waitForSelector('#aeFreqs .ae-card.sel');
  assert.deepEqual(await page.$$eval('#aeFreqs .ae-card.sel', e => e.map(x => x.dataset.hz)), ['432']);
  console.log('✔ logout → login: saved mix reopens (432 Hz)');
  await page.click('.audio-editor .ps-close');
  await page.screenshot({ path: SHOTS + '/library-card.png' });

  assert.deepEqual(errors.filter(e => !/AudioContext|play\(\)|NotAllowed|speechSynthesis/.test(e)), [], 'page errors: ' + errors.join('\n'));
  console.log('ALL PASSED');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
