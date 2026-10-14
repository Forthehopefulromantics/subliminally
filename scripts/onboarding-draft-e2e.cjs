/* Regression: the onboarding questionnaire used to restart from "Let's begin" on
   every refresh. Real browser, in-memory Supabase (scripts/fixtures/mock-supabase.js).
     python3 -m http.server 8123   (from the repo root)
     PLAYWRIGHT_MODULE=/path/to/playwright node scripts/onboarding-draft-e2e.cjs */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'); const assert = require('assert/strict');
const BASE = 'http://localhost:8123';
const MOCK = fs.readFileSync(__dirname + '/fixtures/mock-supabase.js', 'utf8');
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (url.startsWith(BASE + '/api/')) return route.fulfill({ status: 204, body: '' });
    if (url.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    if (!localStorage.getItem('mockdb')) localStorage.setItem('mockdb', JSON.stringify({ tables: {
      profiles: [{ id: 'user-1', onboarding_completed: false }], subscribers: [] }, storage: {} }));
  });
  const boot = async () => { await page.goto(BASE + '/'); await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in'); await page.waitForTimeout(600); };
  await boot();
  await page.waitForFunction(() => document.getElementById('onboardOverlay').classList.contains('open'), null, { timeout: 8000 });
  // Walk forward: welcome -> name (type) -> higher (type) -> avatar ...
  await page.evaluate(() => { obNext(); });                                  // -> name
  await page.fill('#obName', 'Kyla'); await page.evaluate(() => obNext());   // -> higher
  await page.fill('#obHigherSelfName', 'Aria'); await page.evaluate(() => { obPersonalize(); obRefreshGate(); });
  await page.evaluate(() => { obIndex = OB_SLIDES.indexOf('desires'); obShowSlide(); obToggleChoice('desires', 'love'); obToggleChoice('desires', 'peace'); });
  const before = await page.evaluate(() => ({ slide: obSlideName(), desires: obAnswers.desires.slice() }));
  assert.deepEqual(before, { slide: 'desires', desires: ['love', 'peace'] });
  console.log('✔ 1. partway through: slide "desires", 2 answers, name + higher-self typed');

  await boot();                                                              // the refresh
  await page.waitForFunction(() => document.getElementById('onboardOverlay').classList.contains('open'), null, { timeout: 8000 });
  const after = await page.evaluate(() => ({ slide: obSlideName(), desires: obAnswers.desires.slice(),
    name: document.getElementById('obName').value, higher: document.getElementById('obHigherSelfName').value }));
  assert.deepEqual(after, { slide: 'desires', desires: ['love', 'peace'], name: 'Kyla', higher: 'Aria' });
  console.log('✔ 2. after refresh: resumes on the same slide with answers and typed names intact');

  // A different account must never inherit it.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fthr_onboarding_draft_v1')); d.user = 'someone-else'; localStorage.setItem('fthr_onboarding_draft_v1', JSON.stringify(d)); });
  await boot();
  await page.waitForFunction(() => document.getElementById('onboardOverlay').classList.contains('open'), null, { timeout: 8000 });
  const other = await page.evaluate(() => ({ slide: obSlideName(), desires: obAnswers.desires.length, drafted: !!localStorage.getItem('fthr_onboarding_draft_v1') && JSON.parse(localStorage.getItem('fthr_onboarding_draft_v1')).user }));
  assert.equal(other.slide, 'welcome'); assert.equal(other.desires, 0);
  console.log('✔ 3. another account\'s draft is ignored: starts at the beginning');

  assert.deepEqual(errors.filter(e => !/AudioContext|play\(\)|NotAllowed|speechSynthesis/.test(e)), [], 'page errors: ' + errors.join('\n'));
  console.log('ALL PASSED');
  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
