/* End-to-end check of the free-first homepage, the tap-to-record recorder, the
   contextual paywall and the analytics events, in a real Chromium against the
   in-memory Supabase (scripts/fixtures/mock-supabase.js).

   Serve the repo first:  python3 -m http.server 8123
   Then:                  npm run test:free-signup
   Needs Playwright (PLAYWRIGHT_MODULE=/path/to/playwright). Chromium's fake
   microphone stands in for a real one, so MediaRecorder, getUserMedia, track
   shutdown and <audio> playback are all the browser's own. Mobile Safari itself
   is not available here; viewports and touch emulation are. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'); const assert = require('assert/strict');
const BASE = 'http://localhost:8123';
const MOCK = fs.readFileSync(__dirname + '/fixtures/mock-supabase.js', 'utf8');
const ok = (n, s) => console.log(`✔ ${n}. ${s}`);

const VIEWPORTS = {
  'iPhone SE (375x667)':        { width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'iPhone 15 Pro Max (430x932)': { width: 430, height: 932, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  'desktop (1280x800)':         { width: 1280, height: 800 },
};

async function newPage(browser, { viewport, tier = 'none', loggedIn = true, consent = true, grant = true }) {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
    isMobile: !!viewport.isMobile, hasTouch: !!viewport.hasTouch, deviceScaleFactor: viewport.deviceScaleFactor || 1,
    permissions: grant ? ['microphone'] : [] });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (url.startsWith(BASE + '/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline in test"}' });
    if (url.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({ tier, loggedIn, consent }) => {
    if (window !== window.top) return;
    localStorage.setItem('mock_logged_in', loggedIn ? '1' : '0');
    if (consent) localStorage.setItem('fthr_analytics_consent', 'granted'); else localStorage.removeItem('fthr_analytics_consent');
    if (!localStorage.getItem('mockdb')) localStorage.setItem('mockdb', JSON.stringify({ tables: {
      profiles: [{ id: 'user-1', onboarding_completed: true, display_name: 'Tester' }],
      subscribers: tier === 'none' ? [] : [{ user_id: 'user-1', tier, status: 'active' }] }, storage: {} }));
    // Count every microphone stream and recorder, and how many tracks are still live.
    window.__mic = { opened: 0, live: 0, recorders: 0, deny: null };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (window.__mic.deny){ const e = new Error('denied'); e.name = window.__mic.deny; throw e; }
      const s = await gum(c); window.__mic.opened++;
      s.getTracks().forEach(t => { window.__mic.live++; const stop = t.stop.bind(t); t.stop = () => { if (t.readyState === 'live') window.__mic.live--; stop(); }; });
      return s;
    };
    const MR = window.MediaRecorder;
    window.MediaRecorder = class extends MR { constructor(...a){ super(...a); window.__mic.recorders++; } };
    window.MediaRecorder.isTypeSupported = MR.isTypeSupported.bind(MR);
    window.__events = [];
    window.addEventListener('subliminally:analytics', e => window.__events.push(e.detail));
  }, { tier, loggedIn, consent });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.body.getAttribute('data-auth') !== 'loading');
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

/* Opens the recorder exactly the way the app does, on two real lines. */
async function openRecorder(page, lines) {
  await page.evaluate(async (lines) => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    startNewSubliminal();
    state.freq = FREQS.find(f => f.hz === 528);
    state.affirmations = lines; state.voiceMode = 'own'; state.selectedVoice = VOICE_RECORD_OWN;
    showBuildPage(); beginRecordingPass('primary');
  }, lines);
  await page.waitForSelector('#recBtn', { state: 'visible' });
  // The page scrolls itself to the recorder (smoothly); measure once it has stopped.
  await page.evaluate(() => new Promise(res => { let last = -1, n = 0; const t = setInterval(() => { if (scrollY === last) { if (++n >= 3) { clearInterval(t); res(); } } else { n = 0; last = scrollY; } }, 80); }));
}
const box = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }, sel);
const mic = page => page.evaluate(() => ({ ...window.__mic }));
const status = page => page.textContent('#recStatus');

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const allErrors = [];

  /* ---------- 1. homepage, signed out ---------- */
  {
    const { ctx, page, errors } = await newPage(browser, { viewport: VIEWPORTS['iPhone SE (375x667)'], loggedIn: false });
    assert.equal((await page.textContent('h1')).replace(/\s+/g, ' ').trim(), 'Your mind. Your voice. Your next chapter.');
    assert.equal((await page.textContent('#heroCta')).trim(), 'Create my free subliminal');
    assert.match(await page.textContent('.hero-free-note'), /Free forever plan\. No credit card required/);
    for (const id of ['howItWorks', 'freeFeatures', 'exploreRitual']) assert.ok(await page.isVisible('#' + id), id + ' visible');
    assert.equal(await page.isVisible('#pricing'), false, 'pricing cards are not on the homepage');
    assert.equal(await page.isVisible('#priceCardRitual'), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 375px');
    ok(1, 'signed-out homepage: new headline, free CTA, verified free note, three sections, no pricing cards, no horizontal scroll');

    // CTA opens the existing sign-up form, with nothing about paying.
    await page.click('#heroCta');
    assert.ok(await page.isVisible('#authOverlay.open'));
    assert.equal((await page.textContent('#authTitle')).trim(), 'Create your account');
    assert.equal((await page.textContent('#authSubmitBtn')).trim(), 'Create a free account');
    assert.equal(await page.isVisible('#upgradeOverlay.open'), false, 'free signup is never behind an upgrade prompt');
    await page.evaluate(() => closeAuthModal());
    await page.evaluate(() => openAuthModal('signup'));            // opened a second time
    const ev = await page.evaluate(() => window.__events.map(e => e.event));
    assert.equal(ev.filter(e => e === 'homepage_view').length, 1, 'homepage_view once');
    assert.equal(ev.filter(e => e === 'signup_started').length, 1, 'signup_started once despite reopening');
    ok(2, `CTA opens the existing sign-up form (no paywall); events ${JSON.stringify(ev)} are not duplicated`);
    await page.evaluate(() => closeAuthModal());

    // Pricing is its own page, reached from the nav.
    await page.evaluate(() => closeMobileNav && closeMobileNav());
    await page.evaluate(() => [...document.querySelectorAll('#navLinks button')].find(b => b.textContent === 'Pricing').click());
    assert.equal(await page.evaluate(() => document.body.dataset.view), 'pricing');
    assert.ok(await page.isVisible('#priceCardRitual') && await page.isVisible('#priceCardFree'));
    assert.equal(await page.isVisible('.hero'), false);
    assert.match(await page.textContent('#priceCardRitual'), /\$99\.99|\$14\.99/);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !document.body.dataset.view);
    assert.ok(await page.isVisible('.hero'));
    ok(3, 'Pricing nav opens a separate pricing page with both plans; Back returns to the homepage');

    // Analytics: no personal data, and nothing without consent.
    const clean = await page.evaluate(() => {
      window.__events.length = 0;
      trackEvent('paywall_viewed', { feature: 'studio_voice', email: 'a@b.com', affirmation: 'I am rich', note: 'x@y.z', required_tier: 'ritual' }, { dedupeKey: 'unit' });
      return window.__events[0];
    });
    assert.deepEqual(Object.keys(clean).sort(), ['at', 'event', 'feature', 'required_tier']);
    const noConsent = await newPage(browser, { viewport: VIEWPORTS['desktop (1280x800)'], loggedIn: false, consent: false });
    assert.equal(await noConsent.page.evaluate(() => window.__events.length), 0, 'no events without consent');
    assert.equal(await noConsent.page.evaluate(() => trackEvent('homepage_view', {})), false);
    await noConsent.ctx.close();
    ok(4, 'analytics strip non-allowlisted props (email, affirmation text); nothing is emitted without consent');
    allErrors.push(...errors); await ctx.close();
  }

  /* ---------- 2. the recorder, on each device size ---------- */
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const { ctx, page, errors } = await newPage(browser, { viewport });
    const longLine = 'I am becoming the person I was always meant to be, and every day I choose peace, clarity and courage over doubt, fear and hesitation. ' .repeat(2);
    await openRecorder(page, [longLine, 'Everything I want is already mine.']);

    // Controls sit below the words and never overlap them.
    const [text, dock, btn] = await page.evaluate(() => ['.record-text', '.record-dock', '#recBtn'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
    assert.ok(dock.top >= text.bottom - 1, `${name}: controls start below the text (${dock.top} >= ${text.bottom})`);
    if (viewport.isMobile) assert.ok(btn.bottom <= viewport.height && btn.top >= 0, `${name}: record button is on screen without scrolling`);
    assert.ok(btn.top >= text.bottom - 1, `${name}: button does not overlap the affirmation`);
    assert.equal(await page.getAttribute('#recBtn', 'aria-label'), 'Start recording');
    assert.match(await page.textContent('#recStatus'), /Tap the button/);
    assert.equal(await page.evaluate(() => document.querySelector('#recBtn').tagName), 'BUTTON');

    // Tap to start.
    await page.click('#recBtn', { force: true });
    await page.waitForFunction(() => document.querySelector('#recBtn').classList.contains('recording'));
    assert.equal(await page.getAttribute('#recBtn', 'aria-label'), 'Stop recording');
    assert.match(await status(page), /Recording/);
    // A second press inside the debounce, and a held-down double tap, must not open a second microphone.
    await page.evaluate(() => { const b = document.querySelector('#recBtn'); b.click(); b.click(); });
    await page.waitForTimeout(1300);
    assert.equal((await mic(page)).opened, 1, `${name}: exactly one microphone stream`);
    assert.equal((await mic(page)).recorders, 1, `${name}: exactly one MediaRecorder`);
    const t1 = await page.textContent('#recTimer');
    assert.match(t1, /^0:0[1-9]$/, `${name}: elapsed time counts (${t1})`);
    assert.equal(await page.isVisible('#recTimer'), true);
    assert.equal(await page.getAttribute('#recTimer', 'aria-hidden'), 'true');   // not read out every second

    // Tap to stop: saved, previewable, microphone released.
    await page.click('#recBtn', { force: true });
    await page.waitForFunction(() => !document.querySelector('#recBtn').classList.contains('recording') && !document.querySelector('#recPreviewWrap').hidden);
    assert.equal((await mic(page)).live, 0, `${name}: no microphone track left running`);
    assert.match(await status(page), /Saved/);
    assert.equal(await page.isDisabled('#nextLineBtn'), false);
    assert.equal(await page.getAttribute('#recBtn', 'aria-label'), 'Re-record this line');
    const src = await page.getAttribute('#recPreview', 'src');
    assert.match(src, /^blob:/);
    // It plays back: a real, decodable, non-empty clip.
    const played = await page.evaluate(async () => {
      const a = document.querySelector('#recPreview'); a.muted = true;
      await new Promise((res, rej) => { if (a.readyState >= 1) return res(); a.onloadedmetadata = res; a.onerror = () => rej(new Error('decode error')); });
      await a.play(); await new Promise(r => setTimeout(r, 400));
      const r = { t: a.currentTime, size: recordings[0].blob.size, type: recordings[0].blob.type }; a.pause(); return r;
    });
    assert.ok(played.t > 0 && played.size > 1000, `${name}: preview plays (${JSON.stringify(played)})`);

    // A normal re-render of the screen keeps the take and does not restart the preview.
    await page.evaluate(() => { showRecordLine(); showRecordLine(); });
    assert.equal(await page.getAttribute('#recPreview', 'src'), src, `${name}: redraw keeps the same take`);

    // Move on and come back: the take is still there, in both directions.
    await page.click('#nextLineBtn');
    assert.match(await page.textContent('#recLine'), /Everything I want/);
    assert.equal(await page.isVisible('#recPreviewWrap'), false, 'line 2 has no take yet');
    assert.equal(await page.isDisabled('#nextLineBtn'), true);
    await page.evaluate(() => { recIndex = 0; showRecordLine(); });
    assert.equal(await page.getAttribute('#recPreview', 'src'), src);
    // Back a step and forward again re-enters the recorder without wiping the take.
    await page.evaluate(() => { prevStep(); beginRecordingPass('primary'); });
    assert.equal(await page.getAttribute('#recPreview', 'src'), src, `${name}: take survives Back then Continue`);
    assert.equal(await page.evaluate(() => recordings.filter(Boolean).length), 1);
    ok(`5 (${name})`, 'controls below the text with no overlap; one tap starts, one tap stops; one mic, released; time counts; preview plays; take survives redraw, line changes and Back/Continue');

    // Keyboard: focus the button, Space starts, Space stops.
    await page.focus('#recBtn');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#recBtn').classList.contains('recording'));
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'recBtn', 'focus stays on the button while recording');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !document.querySelector('#recBtn').classList.contains('recording') && document.querySelector('#recBtn').getAttribute('aria-label') === 'Re-record this line');
    assert.equal((await mic(page)).live, 0);
    assert.notEqual(await page.getAttribute('#recPreview', 'src'), src, `${name}: re-recording replaced the take`);
    assert.equal(await page.getAttribute('#recStatus', 'role'), 'status');
    ok(`6 (${name})`, 'keyboard: Space starts and stops, announced through a status region; re-record replaces the take');

    // Leaving mid-take stops the microphone and keeps the take.
    await page.evaluate(() => { recIndex = 1; showRecordLine(); });
    await page.waitForTimeout(350);   // past the double-tap guard
    await page.click('#recBtn', { force: true }); await page.waitForFunction(() => document.querySelector('#recBtn').classList.contains('recording'));
    await page.waitForTimeout(800);
    await page.evaluate(() => showStep(3));
    await page.waitForFunction(() => window.__mic.live === 0);
    assert.equal(await page.evaluate(() => !!recordings[1]), true, `${name}: a take in progress is kept when you leave`);
    assert.equal(await page.evaluate(() => recState), 'idle');
    ok(`7 (${name})`, 'navigating away mid-recording releases the microphone and keeps the take');
    allErrors.push(...errors); await ctx.close();
  }

  /* ---------- 3. microphone denied, then granted ---------- */
  {
    const { ctx, page, errors } = await newPage(browser, { viewport: VIEWPORTS['iPhone 15 Pro Max (430x932)'] });
    await openRecorder(page, ['I am calm.']);
    await page.evaluate(() => { window.__mic.deny = 'NotAllowedError'; });
    await page.click('#recBtn', { force: true });
    await page.waitForSelector('#recError:not([hidden])');
    assert.match(await page.textContent('#recError'), /Microphone access is blocked/);
    assert.equal(await page.getAttribute('#recError', 'role'), 'alert');
    assert.equal(await page.getAttribute('#recBtn', 'aria-disabled'), 'false', 'button stays usable so they can retry');
    assert.equal((await mic(page)).opened, 0);
    await page.evaluate(() => { window.__mic.deny = 'NotFoundError'; });
    await page.waitForTimeout(350); await page.click('#recBtn', { force: true });
    await page.waitForFunction(() => /No microphone was found/.test(document.querySelector('#recError').textContent));
    await page.evaluate(() => { window.__mic.deny = null; });      // the person fixes it in settings
    await page.waitForTimeout(350); await page.click('#recBtn', { force: true });
    await page.waitForFunction(() => document.querySelector('#recBtn').classList.contains('recording'));
    assert.equal(await page.isVisible('#recError'), false, 'error clears once recording starts');
    await page.waitForTimeout(700); await page.click('#recBtn', { force: true });
    await page.waitForFunction(() => !document.querySelector('#recPreviewWrap').hidden);
    ok(8, 'microphone denied → clear alert with how to fix it; missing mic → its own message; retry after granting records and clears the error');
    allErrors.push(...errors); await ctx.close();
  }

  /* ---------- 4. a saved library recording is never replaced by device speech ---------- */
  {
    const { ctx, page, errors } = await newPage(browser, { viewport: VIEWPORTS['desktop (1280x800)'] });
    await openRecorder(page, ['One.', 'Two.']);
    await page.click('#recBtn', { force: true }); await page.waitForFunction(() => document.querySelector('#recBtn').classList.contains('recording'));
    await page.waitForTimeout(700); await page.click('#recBtn', { force: true });
    await page.waitForFunction(() => !document.querySelector('#recPreviewWrap').hidden);
    const spoke = await page.evaluate(async () => {
      let spoken = 0; const real = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u) => { spoken++; return real(u); };
      prepareFinal(); showStep(7);
      await new Promise(r => setTimeout(r, 300));
      return { spoken, recorded: recordings.filter(Boolean).length, voiceMode: state.voiceMode };
    });
    assert.equal(spoke.spoken, 0, 'own-voice sessions never fall back to device speech');
    assert.equal(spoke.voiceMode, 'own');
    ok(9, 'own-voice build with one recorded and one skipped line: device speech was never invoked');
    allErrors.push(...errors); await ctx.close();
  }

  /* ---------- 5. upsell only on a real premium choice ---------- */
  {
    const free = await newPage(browser, { viewport: VIEWPORTS['iPhone 15 Pro Max (430x932)'], tier: 'none' });
    const p = free.page;
    assert.equal(await p.isVisible('#upgradeOverlay.open'), false, 'no paywall on load');
    // Free custom-voice workflow: record own voice, nothing asks for an upgrade.
    await openRecorder(p, ['I am calm.']);
    await p.click('#recBtn', { force: true }); await p.waitForFunction(() => document.querySelector('#recBtn').classList.contains('recording'));
    await p.waitForTimeout(700); await p.click('#recBtn', { force: true });
    await p.waitForFunction(() => !document.querySelector('#recPreviewWrap').hidden);
    assert.equal(await p.isVisible('#upgradeOverlay.open'), false, 'recording your own voice is free');
    assert.equal(await p.evaluate(() => window.__events.filter(e => e.event === 'paywall_viewed').length), 0);
    // A premium choice: Serenity. Choosing is free; going on with it opens the sheet.
    await p.evaluate(() => { showStep(4); chooseSerenity(); });
    await p.waitForTimeout(300);
    assert.equal(await p.isVisible('#upgradeOverlay.open'), false, 'selecting alone does not interrupt');
    await p.evaluate(() => serenityAllowedToContinue());
    await p.waitForSelector('#upgradeOverlay.open');
    assert.equal(await p.textContent('.um-not-now'), 'Not now');
    await p.click('.um-not-now');
    assert.equal(await p.isVisible('#upgradeOverlay.open'), false);
    const evs = await p.evaluate(() => window.__events.map(e => [e.event, e.feature || null, e.current_tier || null]));
    assert.deepEqual(evs.filter(e => e[0] === 'paywall_viewed'), [['paywall_viewed', 'studio_voice', 'none']]);
    assert.ok(evs.some(e => e[0] === 'paywall_dismissed'));
    // The free choices are untouched: own-voice recording is still there and still free to continue with.
    assert.equal(await p.evaluate(() => recordings[0] && recordings[0].blob.size > 0), true);
    ok(10, 'free user: own-voice recording never prompts; Serenity prompts only on continuing, once (paywall_viewed studio_voice), with a working "Not now"');
    allErrors.push(...free.errors); await free.ctx.close();

    const ritual = await newPage(browser, { viewport: VIEWPORTS['iPhone 15 Pro Max (430x932)'], tier: 'ritual' });
    await ritual.page.evaluate(() => { showStep(4); chooseSerenity(); });
    const allowed = await ritual.page.evaluate(() => serenityAllowedToContinue());
    assert.equal(allowed, true);
    assert.equal(await ritual.page.isVisible('#upgradeOverlay.open'), false);
    ok(11, 'Ritual user: Serenity continues with no prompt (entitlement read from the subscribers row)');
    allErrors.push(...ritual.errors); await ritual.ctx.close();
  }

  assert.deepEqual(allErrors, [], 'no uncaught page errors: ' + allErrors.join(' | '));
  await browser.close();
  console.log('ALL PASSED');
})().catch(e => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
