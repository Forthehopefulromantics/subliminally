#!/usr/bin/env node
/* today-playback-test.js — only one subliminal plays, and the newest tap wins
 *
 * Not part of the site. Loads the real index.html in Chromium over a fake
 * Supabase (scripts/fixtures/fake-supabase.js) with three saved subliminals
 * whose recordings differ in length, so every Web Audio source can be traced
 * back to the subliminal it came from. Then taps the Today cards: A then B,
 * A→B→C fast, a slow load overtaken by a fast one, pause/resume/switch after
 * pause, leaving Today and coming back, and eight taps in a row -- and checks
 * each time that exactly one subliminal is audible on exactly one open context.
 *
 *   npm run test:today-playback      (needs Playwright + Chromium)
 */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch(e){ ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.argv[2] || path.resolve(__dirname, '..');
function wav(seconds, hz){
  const sr = 22050, n = Math.floor(sr*seconds), buf = Buffer.alloc(44 + n*2);
  buf.write('RIFF',0); buf.writeUInt32LE(36+n*2,4); buf.write('WAVE',8); buf.write('fmt ',12);
  buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(1,22); buf.writeUInt32LE(sr,24);
  buf.writeUInt32LE(sr*2,28); buf.writeUInt16LE(2,32); buf.writeUInt16LE(16,34); buf.write('data',36); buf.writeUInt32LE(n*2,40);
  for (let i=0;i<n;i++) buf.writeInt16LE(Math.round(Math.sin(2*Math.PI*hz*i/sr)*8000), 44+i*2);
  return buf;
}
// Distinct lengths identify which subliminal a decoded buffer belongs to.
const LEN = { A:1.1, B:1.3, C:1.5 };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const m = u.match(/^\/test-audio\/([ABC])\d\.wav$/);
  if (m){ setTimeout(() => { res.writeHead(200, {'content-type':'audio/wav'}); res.end(wav(LEN[m[1]], 300)); }, 150); return; }
  if (u.endsWith('/fake-supabase.js')){ res.writeHead(200,{'content-type':'text/javascript'}); res.end(fs.readFileSync(path.join(__dirname,'fixtures','fake-supabase.js'))); return; }
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  const types = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.webp':'image/webp', '.mp3':'audio/mpeg' };
  res.writeHead(200, {'content-type': types[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
});
const INSTRUMENT = `
(() => {
  const Orig = window.AudioContext;
  window.__ctxs = [];
  window.AudioContext = window.webkitAudioContext = function(...a){ const c = new Orig(...a); window.__ctxs.push(c); return c; };
  window.AudioContext.prototype = Orig.prototype;
  window.__sources = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...a){
    const rec = { t: performance.now(), ctx: this.context, dur: this.buffer ? Math.round(this.buffer.duration*10)/10 : 0, ended:false };
    this.addEventListener('ended', () => rec.ended = true);
    window.__sources.push(rec);
    return start.apply(this, a);
  };
  window.__audible = () => {
    const live = window.__sources.filter(s => !s.ended && s.ctx.state === 'running' && s.dur > 0.5);
    const who = { '1.1':'A', '1.3':'B', '1.5':'C' };
    const since = window.__mark || 0;
    const started = window.__sources.filter(s => s.t >= since && s.dur > 0.5);
    const heard = [...new Set([...live, ...started.filter(s => s.ctx.state === 'running')].map(s => who[s.dur]))].sort();
    return { voices: heard,
             runningContexts: window.__ctxs.filter(c => c.state === 'running').length,
             openContexts: window.__ctxs.filter(c => c.state !== 'closed').length };
  };
})();`;
(async () => {
  await new Promise(r => server.listen(8765, r));
  const browser = await chromium.launch({ args:['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => { if (m.text().startsWith('[playback]')) logs.push(m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ status:200, contentType:'text/javascript', body: fs.readFileSync(path.join(__dirname,'fixtures','fake-supabase.js'),'utf8') });
    if (!url.startsWith('http://localhost:8765')) return route.abort();
    return route.continue();
  });
  await page.addInitScript(INSTRUMENT);
  await page.goto('http://localhost:8765/?audiodebug#today');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay, .modal, [role=dialog]').forEach(m => { if (m.id !== 'immersivePlayer') m.style.display='none'; }); if (typeof showTodayPage==='function') showTodayPage(); });
  await page.waitForSelector('.sess-card[data-sub="A"]', { timeout: 8000 });
  let fails = 0;
  const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok?'PASS ':'FAIL ') + label + '  got=' + JSON.stringify(got) + (ok?'':'  want='+JSON.stringify(want))); };
  const tap = async id => { await page.evaluate(() => { window.__mark = performance.now(); typeof closeImmersivePlayer==='function' && closeImmersivePlayer(); }); await page.click(`.sess-card[data-sub="${id}"]`, { force:true }); };
  const state = () => page.evaluate(() => ({ ...window.__audible(), mgr: window.subliminallyAudioState() }));
  const selected = () => page.evaluate(() => [...document.querySelectorAll('.sess-card.sel')].map(b => b.dataset.sub));

  // 1. A, then B right after A has started.
  await tap('A');
  check('A highlighted immediately on tap', await selected(), ['A']);
  check('A shows loading immediately', await page.evaluate(() => document.querySelector('.sess-card[data-sub="A"]').classList.contains('is-loading')), true);
  await page.waitForTimeout(2000);
  let s = await state();
  check('A playing alone', [s.voices, s.runningContexts, s.mgr.playing], [['A'], 1, 'A']);
  await tap('B');
  check('B highlighted immediately', await selected(), ['B']);
  s = await state();
  check('A silenced in the same tap as B', [s.voices, s.mgr.playing, s.mgr.loading], [[], null, 'B']);
  await page.waitForTimeout(1500);
  s = await state();
  check('only B after switch', [s.voices, s.runningContexts, s.openContexts, s.mgr.playing], [['B'], 1, 1, 'B']);

  // 2. Rapid A -> B -> C (A's row is the slowest, so a race would let A land last).
  await tap('A'); await tap('B'); await tap('C');
  check('C highlighted', await selected(), ['C']);
  await page.waitForTimeout(3000);
  s = await state();
  check('rapid A->B->C: only C plays', [s.voices, s.runningContexts, s.openContexts, s.mgr.playing], [['C'], 1, 1, 'C']);

  // 2b. C -> A -> B where A (slow, 900ms) resolves after B (250ms).
  await tap('A'); await page.waitForTimeout(50); await tap('B');
  await page.waitForTimeout(2500);
  s = await state();
  check('slow A superseded by fast B: B wins', [s.voices, s.runningContexts, s.mgr.playing], [['B'], 1, 'B']);

  // 3. Pause, resume, switch after pause.
  await tap('B');  // same card: pause
  await page.waitForTimeout(300);
  s = await state();
  check('tapping playing card pauses', [s.mgr.playing, s.mgr.paused, s.runningContexts], ['B', true, 0]);
  check('Today button says Resume', await page.evaluate(() => document.getElementById('todayPlayBtn').textContent.trim()), 'Resume');
  await page.evaluate(() => { window.__mark = performance.now(); closeImmersivePlayer(); });
  await page.click('#todayPlayBtn', { force:true });
  await page.waitForTimeout(1500);
  s = await state();
  check('resume via Play button', [s.voices, s.mgr.paused, s.runningContexts], [['B'], false, 1]);
  await tap('B'); await page.waitForTimeout(200);
  await tap('C');
  await page.waitForTimeout(1500);
  s = await state();
  check('switch while paused: only C', [s.voices, s.runningContexts, s.openContexts, s.mgr.playing, s.mgr.paused], [['C'], 1, 1, 'C', false]);

  // 4. Leave Today and come back.
  await page.evaluate(() => showJournalPage());
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__mark = performance.now() - 3000; showTodayPage(); });
  await page.waitForTimeout(800);
  s = await state();
  check('back on Today: still one session, C', [s.voices, s.runningContexts, s.openContexts], [['C'], 1, 1]);
  check('C card shows playing after return', await page.evaluate(() => document.querySelector('.sess-card[data-sub="C"]').classList.contains('is-playing')), true);
  await tap('A');
  await page.waitForTimeout(2200);
  s = await state();
  check('switch after returning: only A', [s.voices, s.runningContexts, s.openContexts], [['A'], 1, 1]);

  // 5. Hammer.
  for (const id of ['B','C','A','C','B','A','B','C']) await tap(id);
  await page.waitForTimeout(3000);
  s = await state();
  check('8 fast taps: last (C) wins, one context', [s.voices, s.runningContexts, s.openContexts, s.mgr.playing], [['C'], 1, 1, 'C']);

  const errs = logs.filter(l => l.startsWith('PAGEERROR'));
  check('no page errors', errs, []);
  console.log('\nplayback log (last 12):\n' + logs.filter(l=>l.startsWith('[playback]')).slice(-12).join('\n'));
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await browser.close(); server.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
