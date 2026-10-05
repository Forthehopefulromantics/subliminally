/* End-to-end check of Visualization, in a real browser at iPhone size, against an
   in-memory Supabase (scripts/fixtures/mock-supabase.js) and a scripted
   /api/visualization.

   Serve the repo first:  python3 -m http.server 8123
   Then:                  npm run test:visualization-e2e
   Needs Playwright (npm i -g playwright, or PLAYWRIGHT_MODULE=/path/to/playwright).

   This walks the acceptance flow from the brief — ask, write, edit, revise,
   narrate once, tune the layers, enter the scene, reopen, change the story — and
   counts every request that could cost money: the whole point is that the count
   of `narrate` calls only ever goes up when a person presses the button that says
   so. It runs Chromium with an iPhone 14 profile (390x844, touch, iOS user agent,
   which also selects the iOS audio output path); it is not WebKit. */
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'); const assert = require('assert/strict');
const BASE = 'http://localhost:8123';
const MOCK = fs.readFileSync(__dirname + '/fixtures/mock-supabase.js', 'utf8');
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const step = (n, s) => console.log(`✔ ${n}. ${s}`);

/* What the database and its trigger do for the real thing, on top of the mock: the
   column defaults, script_hash computed from the script, updated_at, and the
   narration columns being refused to the browser. */
const DB_EMULATION = `
(function(){
  const orig = window.supabase.createClient;
  const norm = t => String(t==null?'':t).replace(/\\r\\n?/g,'\\n').replace(/[ \\t]+/g,' ').replace(/ ?\\n ?/g,'\\n').replace(/\\n{3,}/g,'\\n\\n').trim();
  const hash = t => { const n = norm(t); if (!n) return null; let h = 0; for (const c of n) h = (h*31 + c.charCodeAt(0)) | 0; return 'h' + (h>>>0).toString(16) + '_' + n.length; };
  const SERVER = ['narration_path','narration_script_hash','narration_generated_at','narration_duration_seconds','narration_status','faith_used'];
  const strip = v => { const o = { ...v }; SERVER.forEach(k => delete o[k]); return o; };
  window.supabase.createClient = (...a) => {
    const c = orig(...a); const from = c.from.bind(c);
    c.from = (t) => {
      const q = from(t); if (t !== 'visualizations') return q;
      const ins = q.insert.bind(q), upd = q.update.bind(q);
      q.insert = v => { const p = strip(v); return ins({ narration_volume:100, frequency_volume:25, nature_volume:35, theta_wave:'off', nature_sound:'none',
        narration_status:'none', narration_path:null, narration_script_hash:null, narration_duration_seconds:null, script:null, script_hash:null,
        updated_at:new Date().toISOString(), ...p, ...(p.script != null ? { script_hash: hash(p.script) } : {}) }); };
      q.update = v => { const p = strip(v); if ('script' in p) p.script_hash = hash(p.script); p.updated_at = new Date().toISOString(); return upd(p); };
      return q;
    };
    return c;
  };
})();`;

function wavDataUrl(seconds) {
  const sr = 8000, n = sr * seconds, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / sr * 220 * 2 * Math.PI) * 3000), 44 + i * 2);
  return 'data:audio/wav;base64,' + b.toString('base64');
}

/* The scripted server. Every call is recorded; `narrate` also does what the real
   route does to the database. */
const api = {
  limit: 1, used: 0, narrateMode: 'ok', narrateDelay: 700, followUps: 2,
  calls: { question: [], write: [], revise: [], narrate: [], usage: [], delete: [] },
};
const QUESTIONS = ['How do you want to feel in this moment?', 'What are you doing when this happens?', 'Who is the first person you want to tell?', 'What makes it finally feel real?'];
const SCRIPT = 'I push open the door and hear music coming from the kitchen.\n\nI have been looking for my keys for five minutes before I find them in yesterday\'s purse, and I almost laugh. Apparently getting the promotion did not make me organized.\n\nThen my phone buzzes, and it is the message I have been waiting for, and I read it standing in the hallway with one shoe on.\n\nI smile, quietly, because I get to wake up here again tomorrow.';

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  const audio = wavDataUrl(6);
  let page;
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK + DB_EMULATION });
    if (url === BASE + '/api/visualization') {
      const body = JSON.parse(route.request().postData() || '{}');
      const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
      const usage = () => ({ limit: api.limit, used: api.used, remaining: Math.max(0, api.limit - api.used), resetsAt: new Date(Date.now() + 6 * 3600e3).toISOString(), timeZone: body.tz });
      switch (body.action) {
        case 'usage': api.calls.usage.push(body); return reply(200, { usage: usage(), pending: [], maxWords: 700, maxQuestions: 5 });
        case 'question': {
          api.calls.question.push(body);
          const n = body.qa.length;
          if (n >= api.followUps) return reply(200, { done: true });
          return reply(200, { done: false, question: QUESTIONS[n], asked: n + 2, max: 5 });
        }
        case 'write': api.calls.write.push(body); return reply(200, { title: 'The Morning Everything Changed', script: SCRIPT });
        case 'revise': {
          api.calls.revise.push(body);
          const tag = body.preset ? `[${body.preset}] ` : `[custom] `;
          return reply(200, { script: tag + body.script.replace(/^\[[^\]]+\] /, '') });
        }
        case 'delete': api.calls.delete.push(body); return reply(200, { deleted: true });
        case 'narrate': {
          api.calls.narrate.push(body);
          await new Promise(r => setTimeout(r, api.narrateDelay));
          if (api.narrateMode === 'fail') return reply(502, { error: 'narration_failed', code: 'provider_failed' });
          const row = await page.evaluate((id) => JSON.parse(localStorage.getItem('mockdb')).tables.visualizations.find(r => r.id === id), body.id);
          if (api.used >= api.limit) return reply(429, { error: 'daily_limit', usage: usage() });
          if (row.narration_path && row.narration_script_hash !== row.script_hash && !body.replace) return reply(409, { error: 'confirm_replace' });
          if (row.narration_path && row.narration_script_hash === row.script_hash) return reply(200, { alreadyCurrent: true, usage: usage() });
          const path = `${row.user_id}/${row.id}-${row.script_hash}.mp3`;
          await page.evaluate(([id, path, audio]) => {
            const db = JSON.parse(localStorage.getItem('mockdb'));
            const r = db.tables.visualizations.find(x => x.id === id);
            Object.assign(r, { narration_path: path, narration_script_hash: r.script_hash, narration_generated_at: new Date().toISOString(), narration_duration_seconds: 6, narration_status: 'ready' });
            db.storage['visualization-audio/' + path] = audio;
            localStorage.setItem('mockdb', JSON.stringify(db));
          }, [body.id, path, audio]);
          api.used++;
          return reply(200, { generated: true, usage: usage() });
        }
      }
      return reply(400, { error: 'unknown_action' });
    }
    if (url.startsWith(BASE + '/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline in test"}' });
    if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
    return route.abort();
  });
  page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => {
    if (window !== window.top) return;
    if (!localStorage.getItem('mockdb')) localStorage.setItem('mockdb', JSON.stringify({ tables: {
      profiles: [{ id: 'user-1', onboarding_completed: true, display_name: 'Tester', faith: 'christianity' }],
      subscribers: [{ user_id: 'user-1', tier: 'ritual', status: 'active' }] }, storage: {} }));
  });
  const sky = (mode) => page.evaluate((m) => { localStorage.setItem('fthr_sky', JSON.stringify({ mode: m, until: Date.now() + 3600e3 })); }, mode);
  let bootCount = 0;
  const boot = async (hash = '#visualize') => {
    await page.goto(BASE + '/?r=' + (++bootCount) + hash);
    await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
    await page.waitForSelector('#vizRoot > *');
    await page.waitForTimeout(300);
  };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
  const rows = async () => ((await db()).tables.visualizations || []);
  const shot = (name) => page.screenshot({ path: `${SHOTS}/viz-${name}.png` });
  const noSideScroll = async (label) => {
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(w.sw <= w.iw + 1, `${label}: page scrolls sideways (${w.sw} > ${w.iw})`);
  };
  const tap = (sel) => page.tap(sel);
  const money = () => api.calls.narrate.length;

  /* ---- 1-3. the invitation, and the first question ---- */
  await boot();
  await sky('night'); await boot();
  assert.match(await page.textContent('#vizRoot .viz-h1'), /Visualize it before you live it\./);
  assert.match(await page.textContent('#vizRoot .viz-sub'), /Tell me what you want to experience, and I.ll turn it into a scene you can step into\./);
  assert.equal((await page.textContent('[data-act="start"]')).trim(), 'Create a visualization');
  await noSideScroll('home'); await shot('1-home-night');
  step(1, 'home invites with the right words, and nothing scrolls sideways at 390px');

  await tap('[data-act="start"]');
  await page.waitForSelector('#vizAnswer');
  assert.equal((await page.textContent('#vizQuestion')).trim(), 'What do you want to experience?');
  assert.match(await page.textContent('.viz-progress'), /1 of up to 5/);
  const fontSize = await page.$eval('#vizAnswer', el => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(fontSize >= 16, 'inputs must be 16px+ so iOS Safari does not zoom');
  const ph = await page.getAttribute('#vizAnswer', 'placeholder');
  assert.ok(['Getting the promotion', 'Waking up in my dream apartment'].includes(ph), 'placeholder example: ' + ph);
  assert.equal(await page.locator('[data-act="skip"]').count(), 0, 'the opening question cannot be skipped');
  await noSideScroll('ask'); await shot('2-ask-night');
  step(2, 'first question, 1 of up to 5, rotating example, 16px input');

  /* ---- 4. dynamic questions, autosaved ---- */
  await page.fill('#vizAnswer', 'Getting the promotion');
  await tap('[data-act="answer"]');
  await page.waitForFunction(() => document.getElementById('vizQuestion').textContent === 'How do you want to feel in this moment?');
  assert.match(await page.textContent('.viz-progress'), /2 of up to 5/);
  let saved = await rows();
  assert.equal(saved.length, 1); assert.equal(saved[0].initial_desire, 'Getting the promotion'); assert.equal(saved[0].stage, 'questions');
  assert.equal(saved[0].qa.length, 1); assert.equal(saved[0].qa[0].q, 'How do you want to feel in this moment?');
  step(3, 'first answer creates the row; the next question is saved with it');

  /* ---- 5. refresh in the middle: nothing lost ---- */
  await boot();
  assert.match(await page.textContent('.viz-item-foot'), /In progress/);
  await tap('.viz-item');
  await page.waitForSelector('#vizAnswer');
  assert.equal((await page.textContent('#vizQuestion')).trim(), 'How do you want to feel in this moment?');
  assert.match(await page.textContent('.viz-progress'), /2 of up to 5/);
  step(4, 'refreshed mid-creation: the draft is listed, and resumes at the same question');

  /* ---- 6. answer, skip, and the AI stops early ---- */
  await page.fill('#vizAnswer', 'Calm, and a little disbelieving');
  await tap('[data-act="answer"]');
  await page.waitForFunction(() => document.getElementById('vizQuestion').textContent === 'What are you doing when this happens?');
  assert.equal(await page.locator('[data-act="skip"]').count(), 1, 'follow-ups can be skipped');
  await tap('[data-act="skip"]');
  await page.waitForSelector('#vizScript', { timeout: 8000 });
  assert.equal(api.calls.question.length >= 2, true);
  assert.ok(api.calls.question.every(c => c.qa.length <= 4), 'never more than 4 follow-ups after the first question');
  assert.equal(api.calls.question.at(-1).qa.at(-1).answer, '', 'a skipped question is passed on as skipped');
  assert.equal(api.calls.write.length, 1);
  assert.equal(api.calls.write[0].desire, 'Getting the promotion');
  saved = await rows();
  assert.equal(saved[0].stage, 'written');
  assert.equal(saved[0].script, SCRIPT, 'the story is saved before it is shown');
  assert.equal(saved[0].generated_script, SCRIPT);
  assert.equal(saved[0].title, 'The Morning Everything Changed');
  step(5, 'answered one, skipped one, the AI stopped at 4 of 5 questions; one scene written and saved');

  /* ---- 7. the written preview ---- */
  assert.equal((await page.textContent('#vizRoot .viz-h2')).trim(), 'Your visualization');
  assert.match(await page.textContent('#vizRoot .viz-sub'), /Make it feel exactly like you before bringing it to life\./);
  assert.equal(await page.inputValue('#vizScript'), SCRIPT);
  assert.equal(await page.inputValue('#vizTitle'), 'The Morning Everything Changed');
  assert.equal(money(), 0, 'nothing has been narrated yet');
  assert.match(await page.textContent('#vizCta'), /Bring this story to life/);
  assert.match(await page.textContent('#vizCta'), /Serenity will narrate your visualization\. Up to 5 minutes\./);
  assert.equal(await page.locator('#vizLayersWrap *').count(), 0, 'sound layers wait for a narration');
  await noSideScroll('editor'); await shot('3-editor-night');
  step(6, 'written preview first; the call to action says what it will do; no narration yet');

  /* ---- 8. manual edit, autosaved ---- */
  await page.fill('#vizScript', SCRIPT + '\n\nThe dinner is a little overcooked, and I love it anyway.');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('vizSaveState').textContent));
  saved = await rows();
  assert.match(saved[0].script, /overcooked/);
  assert.equal(saved[0].generated_script, SCRIPT, 'the first draft is kept apart from the edit');
  assert.notEqual(saved[0].script_hash, null);
  await page.fill('#vizScript', SCRIPT);
  await page.waitForFunction(() => /Saved/.test(document.getElementById('vizSaveState').textContent));
  step(7, 'the whole text is editable and autosaves');

  /* ---- 9. AI revision ---- */
  await tap('[data-key="realistic"]');
  await page.waitForFunction(() => document.getElementById('vizScript').value.startsWith('[realistic] '));
  assert.equal(api.calls.revise[0].preset, 'realistic');
  assert.equal(api.calls.revise[0].desire, 'Getting the promotion');
  assert.equal(await page.isVisible('#vizUndo'), true);
  await page.fill('#vizInstruction', 'Change the car to a Porsche 911.');
  await tap('#vizInstructBtn');
  await page.waitForFunction(() => document.getElementById('vizScript').value.startsWith('[custom] '));
  assert.equal(api.calls.revise[1].instruction, 'Change the car to a Porsche 911.');
  await tap('#vizUndo');
  assert.ok((await page.inputValue('#vizScript')).startsWith('[realistic] '));
  await tap('#vizUndo');
  assert.equal(await page.inputValue('#vizScript'), SCRIPT);
  await page.waitForFunction(() => /Saved/.test(document.getElementById('vizSaveState').textContent));
  assert.equal((await rows())[0].script, SCRIPT);
  assert.equal(money(), 0);
  step(8, 'AI revisions (preset and free text) apply, are saved, and can be undone');

  /* ---- 10. narrate once; two quick taps, one request ---- */
  await page.evaluate(() => { const b = document.querySelector('[data-act="narrate"]'); b.click(); b.click(); });
  await page.waitForSelector('#vizCta [disabled]');
  assert.match(await page.textContent('#vizCta'), /Serenity is narrating/);
  await page.waitForSelector('[data-act="enter"]', { timeout: 8000 });
  assert.equal(money(), 1, 'a double tap made exactly one narration request');
  assert.equal(api.calls.narrate[0].replace, false);
  saved = await rows();
  assert.equal(saved[0].narration_status, 'ready');
  assert.equal(saved[0].narration_script_hash, saved[0].script_hash);
  assert.match(await page.textContent('#vizCta'), /Enter the scene/);
  assert.ok(await page.isVisible('#vizLayersWrap [data-vz-layer="frequency_hz"]'), 'layers appear with the narration');
  await noSideScroll('editor+layers'); await shot('4-ready-night');
  step(9, 'one narration, from two quick taps; saved; ▶ Enter the scene replaces the call to action');

  /* ---- 11. layers: nothing here may narrate ---- */
  await page.selectOption('[data-vz-layer="frequency_hz"]', '432');
  await tap('[data-vz-theta="theta"]');
  await page.selectOption('[data-vz-layer="nature_sound"]', 'rain');
  await page.$eval('[data-vz-layer="narration_volume"]', el => { el.value = 80; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('[data-vz-layer="frequency_volume"]', el => { el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('[data-vz-layer="nature_volume"]', el => { el.value = 55; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('#vizTitle', 'Our Sunday Morning');
  await tap('[data-act="cover"]');
  await tap('[data-vz-cover="sunrise"]');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('vizSaveState').textContent));
  saved = await rows();
  assert.deepEqual([saved[0].frequency_hz, saved[0].theta_wave, saved[0].nature_sound, saved[0].narration_volume, saved[0].frequency_volume, saved[0].nature_volume, saved[0].title, saved[0].cover_path],
    [432, 'theta', 'rain', 80, 40, 55, 'Our Sunday Morning', 'builtin:sunrise']);
  assert.equal(money(), 1, 'tuning layers, renaming and a new cover made no narration request');
  assert.equal(saved[0].narration_status, 'ready');
  step(10, 'frequency, theta wave, nature sound, three volumes, title and cover all saved — still one narration request');

  /* ---- 12. enter the scene ---- */
  await tap('[data-act="enter"]');
  await page.waitForSelector('#vzPlayer.open');
  await page.waitForFunction(() => { const p = VizPlayer._state; return p.el && !p.el.paused && p.el.currentTime > 0.2; }, null, { timeout: 8000 });
  const live = await page.evaluate(() => { const p = VizPlayer._state; return {
    src: p.el.src.slice(0, 16), state: p.ctx.state, voice: !!p.voice, bed: p.bed && p.bed.key, bedVoice: !!(p.bed && p.bed.voice),
    narr: +p.narrGain.gain.value.toFixed(2), freq: +p.freqGain.gain.value.toFixed(3), nature: +p.natureGain.gain.value.toFixed(2), name: document.getElementById('vzName').textContent }; });
  assert.equal(live.src, 'data:audio/wav;b'); assert.equal(live.state, 'running'); assert.equal(live.voice, true);
  assert.equal(live.bed, 'rain'); assert.equal(live.name, 'Our Sunday Morning');
  assert.deepEqual([live.narr, live.freq, live.nature], [0.8, 0.048, 0.55], 'each layer on its own fader');
  assert.equal(money(), 1);
  await noSideScroll('player'); await shot('5-player-night');
  step(11, 'the saved narration plays with frequency + theta + rain on separate layers at their saved volumes');

  /* ---- 13. pause / resume / start over / adjust layers live ---- */
  await tap('#vzPlay');
  await page.waitForFunction(() => VizPlayer._state.el.paused);
  const t1 = await page.evaluate(() => VizPlayer._state.el.currentTime);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => VizPlayer._state.el.currentTime), t1, 'paused means paused');
  await tap('#vzPlay');
  await page.waitForFunction(() => !VizPlayer._state.el.paused);
  await tap('[data-vz="restart"]');
  await page.waitForFunction(() => VizPlayer._state.el.currentTime < 1.5 && !VizPlayer._state.el.paused);
  await tap('[data-vz="layers"]');
  await page.waitForSelector('#vzSheet.open #vzSheetBody [data-vz-layer="nature_volume"]');
  await noSideScroll('sheet'); await shot('6-sheet-night');
  await page.$eval('#vzSheetBody [data-vz-layer="nature_volume"]', el => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('#vzSheetBody [data-vz-layer="narration_volume"]', el => { el.value = 60; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.selectOption('#vzSheetBody [data-vz-layer="nature_sound"]', 'ocean');
  await tap('#vzSheetBody [data-vz-theta="off"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => { const p = VizPlayer._state; return { narr: +p.narrGain.gain.value.toFixed(2), nature: +p.natureGain.gain.value.toFixed(2), bed: p.bed.key, theta: p.applied.theta }; });
  assert.deepEqual(after, { narr: 0.6, nature: 0.2, bed: 'ocean', theta: 'off' });
  assert.equal(await page.evaluate(() => VizPlayer._state.el.paused), false, 'changing a layer does not interrupt the story');
  assert.equal(money(), 1, 'pause, resume, start over and live layer changes made no narration request');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('vizSaveState') ? document.getElementById('vizSaveState').textContent : 'Saved'));
  await page.waitForTimeout(900);
  saved = await rows();
  assert.deepEqual([saved[0].nature_sound, saved[0].theta_wave, saved[0].narration_volume, saved[0].nature_volume], ['ocean', 'off', 60, 20]);
  step(12, 'pause/resume/start over, and layer changes made live in the player — saved, instant, free');

  /* ---- 14. the story ends ---- */
  await tap('[data-vz="sheet-close"]');
  await page.waitForFunction(() => !document.getElementById('vzSheet').classList.contains('open'));
  await page.evaluate(() => { const el = VizPlayer._state.el; el.currentTime = Math.max(0, el.duration - 0.4); });
  await page.waitForFunction(() => VizPlayer._state.ended, null, { timeout: 8000 });
  assert.equal(await page.getAttribute('#vzPlay', 'aria-label'), 'Play again');
  await tap('#vzPlay');
  await page.waitForFunction(() => !VizPlayer._state.ended && !VizPlayer._state.el.paused);
  assert.equal(money(), 1);
  step(13, 'when the story ends the layers fade out and play-again restarts the same file');

  /* ---- 15. close, refresh, reopen: the same file ---- */
  await tap('[data-vz="close"]');
  await page.waitForFunction(() => !document.getElementById('vzPlayer').classList.contains('open'));
  assert.equal(await page.evaluate(() => VizPlayer._state.ctx), null, 'closing releases the audio context');
  const pathBefore = (await rows())[0].narration_path;
  await boot();
  assert.match(await page.textContent('.viz-item-foot'), /Ready to listen/);
  assert.match(await page.textContent('.viz-item-title'), /Our Sunday Morning/);
  await tap('.viz-item');
  await page.waitForSelector('[data-act="enter"]');
  assert.equal(await page.inputValue('#vizTitle'), 'Our Sunday Morning');
  assert.equal(await page.inputValue('[data-vz-layer="nature_sound"]'), 'ocean');
  assert.equal(await page.inputValue('[data-vz-layer="narration_volume"]'), '60');
  await tap('[data-act="enter"]');
  await page.waitForFunction(() => { const p = VizPlayer._state; return p.el && !p.el.paused && p.el.currentTime > 0.2; }, null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => VizPlayer._state.bed.key), 'ocean', 'saved settings restored exactly');
  assert.equal((await rows())[0].narration_path, pathBefore);
  assert.equal(money(), 1, 'reopening and replaying used the saved file');
  await tap('[data-vz="close"]');
  step(14, 'closed, refreshed, reopened from My Visualizations: same file, same saved settings, no new request');

  /* ---- 16. change the story: stale, asked, never silent ---- */
  const sv = await page.inputValue('#vizScript');
  await page.fill('#vizScript', sv + '\n\nI whisper a quiet thank you to God.');
  await page.waitForSelector('#vizCta .viz-notice');
  assert.match(await page.textContent('#vizCta .viz-notice'), /Your story has changed\./);
  assert.match(await page.textContent('#vizCta .viz-notice'), /Update Serenity.s narration to match\?/);
  assert.match(await page.textContent('#vizCta .viz-notice'), /used today.s Serenity narration, so this one can be updated tomorrow/i, 'with today\'s allowance used it says so plainly');
  assert.ok(await page.isVisible('[data-act="update-narration"]'));
  assert.ok(await page.isVisible('[data-act="keep-narration"]'));
  assert.ok(await page.isVisible('[data-act="enter"]'), 'the old narration still plays');
  assert.equal(money(), 1, 'editing the story did not regenerate anything');
  const oldPath = (await rows())[0].narration_path;
  await shot('7-stale-night'); await noSideScroll('stale');
  await tap('[data-act="keep-narration"]');
  assert.equal(await page.locator('#vizCta .viz-notice').count(), 0);
  await boot();
  assert.match(await page.textContent('.viz-item-foot'), /Narration needs updating/);
  assert.equal((await rows())[0].narration_path, oldPath, 'the old narration remains until replaced');
  step(15, 'edited script: the app asks, says it would use another generation, and keeps the old audio');

  /* ---- 17. update when the limit is used: the story is safe ---- */
  await tap('.viz-item');
  await page.waitForSelector('#vizCta');
  api.limit = 1; api.used = 1;
  await page.evaluate(() => Viz._state.keepOld = {});
  await page.evaluate(() => Viz.render && 0);
  await page.fill('#vizScript', (await page.inputValue('#vizScript')) + ' ');
  await page.fill('#vizScript', (await page.inputValue('#vizScript')).trimEnd() + '!');
  await page.waitForSelector('[data-act="update-narration"]');
  await page.evaluate(() => { const u = Viz._state.usage; u.remaining = 0; u.used = u.limit; });
  await page.evaluate(() => document.querySelector('[data-act="update-narration"]').click());
  await page.waitForTimeout(400);
  assert.equal(money(), 1, 'at the limit the update is not even requested');
  assert.equal((await rows())[0].narration_path, oldPath, 'old narration untouched');
  step(16, 'the limit is reached: no request, nothing lost');

  /* ---- 18. update after the limit resets ---- */
  api.used = 0;
  await boot(); await tap('.viz-item'); await page.waitForSelector('[data-act="update-narration"]');
  assert.match(await page.textContent('#vizCta .viz-notice'), /Updating uses another narration generation \(1 left today\)/, 'it is clear that updating uses another generation');
  await page.evaluate(() => document.querySelector('[data-act="update-narration"]').click());
  await page.waitForFunction(() => !document.querySelector('[data-act="update-narration"]') && document.querySelector('[data-act="enter"]'), null, { timeout: 8000 });
  assert.equal(money(), 2);
  assert.equal(api.calls.narrate[1].replace, true, 'a replacement is only ever requested with replace:true');
  assert.notEqual((await rows())[0].narration_path, oldPath);
  assert.equal((await rows())[0].narration_script_hash, (await rows())[0].script_hash);
  step(17, 'Update narration after the reset: exactly one more request, flagged as a replacement');

  /* ---- 19. a failed narration costs nothing ---- */
  api.used = 0;   // a new day
  await boot();
  await tap('[data-act="start"]');
  await page.fill('#vizAnswer', 'Winning my championship');
  await tap('[data-act="answer"]');
  await page.waitForSelector('#vizAnswer:not([disabled])');
  await page.waitForFunction(() => document.getElementById('vizQuestion').textContent === 'How do you want to feel in this moment?');
  await page.fill('#vizAnswer', 'Strong');
  await tap('[data-act="answer"]');
  await page.waitForFunction(() => document.getElementById('vizQuestion').textContent === 'What are you doing when this happens?');
  await tap('[data-act="answer"]').catch(() => {});
  await page.fill('#vizAnswer', 'Holding the trophy');
  await tap('[data-act="answer"]');
  await page.waitForSelector('#vizScript', { timeout: 8000 });
  assert.equal(api.calls.question.filter(c => c.desire === 'Winning my championship').every(c => c.qa.length <= 4), true);
  api.narrateMode = 'fail';
  const before = money();
  await tap('[data-act="narrate"]');
  await page.waitForFunction(() => /Serenity couldn.t finish your narration\. Your story is safe\. Try again\./.test(document.getElementById('vizCta').textContent), null, { timeout: 8000 });
  assert.equal(money(), before + 1);
  assert.ok(await page.isEnabled('[data-act="narrate"]'), 'the button is back, ready to try again');
  assert.equal(api.used, 0, 'a failure did not use the allowance');
  assert.equal((await rows()).find(r => r.initial_desire === 'Winning my championship').script, SCRIPT, 'the story is still saved');
  api.narrateMode = 'ok';
  step(18, 'a failed narration: the exact words, button re-enabled, allowance and story untouched');

  /* ---- 20. the limit: write freely, narrate tomorrow ---- */
  api.used = 1;
  await page.evaluate(() => { Viz._state.usage = { limit: 1, used: 1, remaining: 0, resetsAt: new Date(Date.now() + 3600e3).toISOString() }; });
  const before2 = money();
  await tap('[data-act="narrate"]');
  await page.waitForSelector('#vizCta .viz-notice');
  assert.match(await page.textContent('#vizCta .viz-notice'), /Your story is ready\./);
  assert.match(await page.textContent('#vizCta .viz-notice'), /You.ve used today.s Serenity narration\. Save this visualization and bring it to life tomorrow\./);
  assert.equal(money(), before2, 'no request was made');
  await page.fill('#vizScript', SCRIPT + '\n\nOne more line, because I can still write.');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('vizSaveState').textContent));
  assert.match((await rows()).find(r => r.initial_desire === 'Winning my championship').script, /One more line/);
  await shot('8-limit-night'); await noSideScroll('limit');
  step(19, 'at the limit: the message from the brief, and the story is still written and saved');

  /* ---- 21. a free account is offered Ritual, not a generation ---- */
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('mockdb')); db.tables.subscribers = []; localStorage.setItem('mockdb', JSON.stringify(db)); });
  await boot(); await tap(`.viz-item[data-id="${(await rows()).find(r => r.initial_desire === 'Winning my championship').id}"]`);
  await page.waitForSelector('[data-act="narrate"]');
  api.used = 0;
  await page.evaluate(() => { Viz._state.usage = { limit: 1, used: 0, remaining: 1 }; });
  const before3 = money();
  await page.evaluate(() => document.querySelector('[data-act="narrate"]').click());
  await page.waitForTimeout(600);
  assert.equal(money(), before3, 'a free account never reaches the narration endpoint from the app');
  assert.ok(await page.evaluate(() => document.getElementById('upgradeOverlay').classList.contains('open') || getComputedStyle(document.getElementById('upgradeOverlay')).display !== 'none'), 'the upgrade sheet opened');
  step(20, 'a free account gets the Ritual explanation instead of a request');

  /* ---- 22. day mode ---- */
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('mockdb')); db.tables.subscribers = [{ user_id: 'user-1', tier: 'ritual', status: 'active' }]; localStorage.setItem('mockdb', JSON.stringify(db)); });
  await sky('day'); await boot();
  assert.equal(await page.getAttribute('body', 'data-sky'), 'day');
  await shot('9-home-day');
  await tap('.viz-item');
  await page.waitForSelector('#vizScript');
  await shot('10-editor-day'); await noSideScroll('editor day');
  const readyRow = (await rows()).find(r => r.narration_status === 'ready');
  await boot(); await tap(`.viz-item[data-id="${readyRow.id}"]`); await page.waitForSelector('[data-act="enter"]');
  await shot('11-ready-day');
  await tap('[data-act="enter"]');
  await page.waitForSelector('#vzPlayer.open');
  await page.waitForTimeout(500);
  await shot('12-player-day');
  await tap('[data-vz="layers"]'); await page.waitForSelector('#vzSheet.open'); await shot('13-sheet-day');
  assert.ok(readyRow);
  await tap('[data-vz="sheet-close"]'); await tap('[data-vz="close"]');
  step(21, 'day sky: the page and player follow the app theme (screenshots saved)');

  /* ---- 23. delete ---- */
  await boot();
  const countBefore = (await rows()).length;
  await tap(`.viz-item[data-id="${(await rows()).find(r => r.initial_desire === 'Winning my championship').id}"]`);
  await page.waitForSelector('[data-act="delete"]');
  await tap('[data-act="delete"]');
  await page.waitForSelector('[data-act="start"]');
  assert.equal(api.calls.delete.length, 1);
  assert.ok(countBefore >= 2);
  step(22, 'delete goes through the server so the audio goes with it');

  assert.deepEqual(errors, [], 'no uncaught page errors: ' + errors.join(' | '));
  console.log(`\nAll Visualization end-to-end checks passed. narrate requests in total: ${money()} (one first narration, one deliberate update, one failed attempt).`);
  console.log('Screenshots:', SHOTS);
  await browser.close();
})().catch(e => { console.error('\nFAILED:', e && e.stack || e); process.exit(1); });
