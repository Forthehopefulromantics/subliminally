/* Voice echo against real Web Audio (headless Chromium, OfflineAudioContext).
   Run:  npm run test:echo-e2e   (needs Playwright, see audio-editor-e2e.cjs) */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../js/voice-echo.js'), 'utf8') });

  const r = await page.evaluate(async () => {
    const SR = 44100;
    /* Render a burst through one layer's bus, with the other layer's bus in the
       same context playing its own burst. Returns both outputs separately. */
    async function render(settingsByLayer) {
      VoiceEcho.release();
      VoiceEcho.load(settingsByLayer);
      const ctx = new OfflineAudioContext(2, SR * 3, SR);
      const outs = {};
      for (const layer of VoiceEcho.LAYERS) {
        const merger = ctx.createGain(); merger.connect(ctx.destination);
        const bus = VoiceEcho.busFor(ctx, layer, [merger]);
        const buf = ctx.createBuffer(1, SR / 10, SR);          // 100 ms burst
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = 0.6 * Math.sin(2 * Math.PI * 440 * i / SR);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const g = ctx.createGain(); g.gain.value = layer === 'voice' ? 1 : 0;  // only 'voice' sounds
        src.connect(g); g.connect(bus.input); src.start(0);
        outs[layer] = bus;
      }
      const out = await ctx.startRendering();
      return Array.from(out.getChannelData(0));
    }
    const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
    const peak = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const off = { voice: { on: false }, layerVoice: { on: false } };
    const dry = await render(off);
    const on = await render({ voice: { on: true, mix: 60, delayMs: 500 }, layerVoice: { on: false } });
    const loud = await render({ voice: { on: true, mix: 100, delayMs: 100 }, layerVoice: { on: true, mix: 100, delayMs: 100 } });
    const other = await render({ voice: { on: false }, layerVoice: { on: true, mix: 100, delayMs: 300 } });
    const again = await render(off);
    return {
      dryPeak: peak(dry), dryTail: rms(dry, SR * 0.6, SR * 1.2), dryHead: rms(dry, 0, SR * 0.1),
      onHead: rms(on, 0, SR * 0.1), onEcho1: rms(on, SR * 0.52, SR * 0.6), onGap: rms(on, SR * 0.2, SR * 0.45),
      onPeak: peak(on), loudPeak: peak(loud), loudFinite: loud.every(Number.isFinite),
      otherSameAsDry: dry.every((v, i) => v === other[i]),
      identical: dry.length === again.length && dry.every((v, i) => v === again[i]),
    };
  });

  assert.ok(r.dryHead > 0.3, 'dry voice plays');
  assert.ok(r.dryTail < 1e-6, 'off: no echo, nothing after the burst');
  assert.ok(r.onEcho1 > 0.05, 'on: an echo arrives one delay later (' + r.onEcho1.toFixed(3) + ')');
  assert.ok(r.onGap < 1e-3, 'on: silence between the voice and the first echo (' + r.onGap + ')');
  assert.ok(r.onHead > r.dryHead * 0.6 && r.onHead < r.dryHead * 1.05, 'on: the voice itself is not louder');
  assert.ok(r.onPeak < 1.0, 'on: no clipping at ' + r.onPeak.toFixed(3));
  assert.ok(r.loudPeak < 1.0 && r.loudFinite, 'max intensity, min delay stays under full scale: ' + r.loudPeak.toFixed(3));
  assert.ok(r.otherSameAsDry, "echo on the second voice leaves the main voice's output exactly as it was");
  assert.ok(r.identical, 'turning echo back off restores the dry render exactly');

  /* The whole page: controls exist, drive the store, and the mixer saves them. */
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.join(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const ui = await page.evaluate(() => {
    const out = { hosts: document.querySelectorAll('[data-echo-host] [data-echo-layer]').length, has: typeof VoiceEcho };
    if (typeof VoiceEcho === 'undefined') return out;
    const box = document.querySelector('[data-echo-host="voice"] [data-echo-layer="voice"]');
    const tog = box.querySelector('[data-echo-field="on"]');
    out.slidersDisabledOff = [...box.querySelectorAll('input[type=range]')].every(i => i.disabled);
    tog.checked = true; tog.dispatchEvent(new Event('change', { bubbles: true }));
    const mix = box.querySelector('[data-echo-field="mix"]'); mix.value = 72; mix.dispatchEvent(new Event('input', { bubbles: true }));
    const dl = box.querySelector('[data-echo-field="delayMs"]'); dl.value = 640; dl.dispatchEvent(new Event('input', { bubbles: true }));
    out.voice = VoiceEcho.get('voice'); out.layer = VoiceEcho.get('layerVoice');
    out.readMix = readMixSettings().voiceEcho;
    out.stored = localStorage.getItem('fthr_voice_echo:draft');
    out.min = dl.min; out.max = dl.max;
    return out;
  });
  assert.equal(ui.has, 'object');
  assert.equal(ui.hosts, 2, 'builder mixer carries echo controls for both voice layers');
  assert.ok(ui.slidersDisabledOff, 'sliders wait for the toggle');
  assert.deepEqual(ui.voice, { on: true, mix: 72, delayMs: 640 });
  assert.deepEqual(ui.layer, { on: false, mix: 40, delayMs: 350 }, 'second voice untouched');
  assert.deepEqual(ui.readMix.voice, ui.voice); assert.deepEqual(ui.readMix.layerVoice, ui.layer);
  assert.ok(ui.stored, 'a device copy is written');
  assert.deepEqual([ui.min, ui.max], ['100', '1000']);
  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('voice echo e2e: ok', JSON.stringify(r));
})().catch(e => { console.error(e); process.exit(1); });
