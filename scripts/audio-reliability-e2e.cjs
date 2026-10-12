/* The audio system, tested as behaviour in a real Chromium: what is actually
   decoded and played, which voice it is, what happens when something fails, and
   what survives a reload. Real mp3/wav audio goes through the real engine; only
   Supabase and the voice provider are stand-ins (scripts/audio-harness.cjs).

   Run:  npm run test:audio
   Needs Playwright (PLAYWRIGHT_MODULE=/path/to/playwright if it is not global)
   and ffmpeg on the PATH (or the ffmpeg-static package).

   Things this CANNOT test, and does not claim to: iOS Safari itself, the lock
   screen, backgrounding, Bluetooth routes, the ringer switch, or the real
   ElevenLabs. Those are listed in docs/AUDIO_AUDIT.md as manual device checks. */
const assert = require('assert/strict');
const H = require('./audio-harness.cjs');

const results = [];
let current = '';
async function test(name, fn) {
  current = name;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`PASS  ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log(`FAIL  ${name}\n      ${(e && e.message || e).toString().split('\n').join('\n      ')}`); }
}

let base, server, fixtures;

async function session(opts) {
  const s = await H.launch({ base, fixtures, ...opts });
  await H.boot(s.page, base);
  await H.openLibrary(s.page);
  return s;
}
const waitTrack = (page, timeout = 15000) => page.waitForFunction(() => finalPlaying && voiceRun && voiceRun.main && voiceRun.main.src, null, { timeout });
const pressPlay = async (page, id = 'sub-1') => {
  await page.evaluate(() => typeof closeImmersivePlayer === 'function' && closeImmersivePlayer());   // minimise the player, as a person would, to reach the list
  await page.click('#libPlay-' + id);
};
const speech = page => page.evaluate(() => window.__deviceSpeech.slice());
const state_ = page => page.evaluate(() => ({ playing: finalPlaying, paused: finalPaused, ctx: finalCtx && finalCtx.state, elapsed: getFinalElapsedMs(), voice: state.aiVoiceId, mode: state.voiceMode }));
const failureBar = page => page.evaluate(() => { const b = document.getElementById('voiceFailureBar'); return b && !b.hidden ? { text: b.querySelector('.vf-text').textContent, retry: !b.querySelector('.vf-retry').hidden, alt: !b.querySelector('.vf-alt').hidden && b.querySelector('.vf-alt').textContent } : null; });
const near = (a, b, tol = 10) => Math.abs(a - b) <= tol;

/* Is sound actually reaching the output bus right now? Taps the bus the whole
   session leaves through with an analyser and reads the level for a moment. */
function outputLevel(page, ms = 1500) {
  return page.evaluate(async (ms) => {
    const ctx = finalCtx, bus = ctx && ctx.__outBus;
    if (!bus) return -1;
    const an = ctx.createAnalyser(); an.fftSize = 2048; bus.connect(an);
    const data = new Float32Array(an.fftSize); let peak = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) { an.getFloatTimeDomainData(data); for (const v of data) peak = Math.max(peak, Math.abs(v)); await new Promise(r => setTimeout(r, 60)); }
    try { bus.disconnect(an); } catch (e) {}
    return peak;
  }, ms);
}

(async () => {
  ({ server, base } = await H.startStaticServer());
  fixtures = H.makeFixtures();

  /* 1 + 5 + 12 (first half) */
  await test('1. Serenity plays in the saved Serenity voice, beyond one second, with the phone voice never used', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      assert.deepEqual([...new Set(s.calls.tts.map(c => c.voiceKey))], ['serenity']);
      const pitches = [await H.pitchAtCue(s.page, 0), await H.pitchAtCue(s.page, 1), await H.pitchAtCue(s.page, 2)];
      assert.ok(near(pitches[0], 280) && near(pitches[1], 360) && near(pitches[2], 440), 'each cue holds the stored Serenity clip for its own line, got ' + pitches);
      await s.page.waitForTimeout(6000);
      const st = await state_(s.page);
      assert.equal(st.playing, true); assert.equal(st.ctx, 'running'); assert.ok(st.elapsed > 6000, 'still going past 6s: ' + st.elapsed);
      assert.ok(await outputLevel(s.page) > 0.01, 'audio is actually reaching the output bus');
      assert.deepEqual(await speech(s.page), [], 'speechSynthesis was never asked to speak');
      assert.equal(s.errors.length, 0, s.errors.join('; '));
    } finally { await s.browser.close(); }
  });

  await test('1b. The same on an iPhone user-agent (media-element output route; still Chromium, not a device)', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]), iphone: true });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      assert.equal(await s.page.evaluate(() => needsMediaElementOutput()), true);
      assert.equal(await s.page.evaluate(() => !!finalCtx.__outEl), true, 'session leaves through the media element');
      await s.page.waitForTimeout(3000);
      assert.equal((await state_(s.page)).playing, true);
      assert.ok(await outputLevel(s.page) > 0.01);
      assert.deepEqual(await speech(s.page), []);
    } finally { await s.browser.close(); }
  });

  /* 2 */
  await test('2. Record Your Own plays the user\'s actual saved recording', async () => {
    const wav = (hz) => 'data:audio/wav;base64,' + H.wavBytes(hz, 2.2).toString('base64');
    const sub = H.seedSub({ ai_voice_id: null, recording_urls: ['user-1/r/0.wav', 'user-1/r/1.wav'], voice_profile: { v: 1, kind: 'recorded' }, affirmations: ['first', 'second'] });
    const s = await session({ seed: H.seedDb([sub], 'ritual', { 'recordings/user-1/r/0.wav': wav(310), 'recordings/user-1/r/1.wav': wav(690) }) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      const p = [await H.pitchAtCue(s.page, 0), await H.pitchAtCue(s.page, 1)];
      assert.ok(near(p[0], 310, 14) && near(p[1], 690, 20), 'the voice track is the recording, got ' + p);
      assert.equal(s.calls.tts.length, 0, 'no generated voice was asked for');
      assert.deepEqual(await speech(s.page), []);
      assert.ok(await outputLevel(s.page) > 0.01);
    } finally { await s.browser.close(); }
  });

  await test('2b. A recording that is missing is reported with Retry, not replaced by the phone voice', async () => {
    const sub = H.seedSub({ ai_voice_id: null, recording_urls: ['user-1/gone/0.wav'], voice_profile: { v: 1, kind: 'recorded' } });
    const s = await session({ seed: H.seedDb([sub]) });
    try {
      await pressPlay(s.page);
      await s.page.waitForTimeout(1500);
      assert.equal((await state_(s.page)).playing, false);
      assert.deepEqual(await speech(s.page), []);
      const text = await s.page.evaluate(() => document.getElementById('finalLine').textContent);
      assert.match(text, /could not download them|never uploaded|No lines were recorded/);
    } finally { await s.browser.close(); }
  });

  /* 3 */
  await test('3. Clone Your Voice plays through the saved clone ("mine") and nothing else', async () => {
    const sub = H.seedSub({ ai_voice_id: 'mine', voice_profile: { v: 1, kind: 'clone', key: 'mine', fingerprint: 'fp-mine' } });
    const voices = { presets: [{ key: 'serenity', name: 'Serenity' }], myVoice: { key: 'mine', name: 'My voice', fingerprint: 'fp-mine' }, consentStatement: 'x', provider: 'elevenlabs' };
    const s = await session({ seed: H.seedDb([sub]), apiBehaviour: { voices } });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      assert.deepEqual([...new Set(s.calls.tts.map(c => c.voiceKey))], ['mine']);
      assert.deepEqual(await speech(s.page), []);
    } finally { await s.browser.close(); }
  });

  await test('3b. A saved clone whose voice has since changed is stopped for an explicit choice', async () => {
    const sub = H.seedSub({ ai_voice_id: 'mine', voice_profile: { v: 1, kind: 'clone', key: 'mine', fingerprint: 'fp-OLD' } });
    const voices = { presets: [], myVoice: { key: 'mine', name: 'My voice', fingerprint: 'fp-mine' }, consentStatement: 'x', provider: 'elevenlabs' };
    const s = await session({ seed: H.seedDb([sub]), apiBehaviour: { voices } });
    try {
      await pressPlay(s.page);
      await s.page.waitForFunction(() => { const b = document.getElementById('voiceFailureBar'); return b && !b.hidden; });
      const bar = await failureBar(s.page);
      assert.match(bar.text, /changed/); assert.equal(bar.alt, 'Use my current voice');
      assert.equal((await state_(s.page)).playing, false);
      await s.page.click('#voiceFailureBar .vf-alt');
      await waitTrack(s.page);
      const saved = (await H.db(s.page)).tables.subliminals[0].voice_profile;
      assert.equal(saved.fingerprint, 'fp-mine', 'the accepted voice is recorded on the subliminal');
    } finally { await s.browser.close(); }
  });

  /* 4 + 13 */
  await test('4. A failed Serenity generation shows an error with Retry, keeps the selection, never speaks with the device, and Retry works', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]), apiBehaviour: { ttsFail: { status: 502, error: 'provider_failed' } } });
    try {
      await pressPlay(s.page);
      await s.page.waitForFunction(() => { const b = document.getElementById('voiceFailureBar'); return b && !b.hidden; });
      const bar = await failureBar(s.page);
      assert.equal(bar.retry, true); assert.match(bar.text, /Nothing was played in another voice/);
      await s.page.waitForTimeout(1200);
      const st = await state_(s.page);
      assert.equal(st.playing, false); assert.equal(st.voice, 'serenity', 'the selection is preserved');
      assert.deepEqual(await speech(s.page), [], 'the phone voice was not substituted');
      s.behaviour.ttsFail = null;
      await s.page.click('#voiceFailureBar .vf-retry');
      await waitTrack(s.page);
      assert.equal(await failureBar(s.page), null);
      assert.deepEqual(await speech(s.page), []);
    } finally { await s.browser.close(); }
  });

  await test('4b. A plan lookup that fails is an error with Retry — not "no plan", and not cached as one', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]) });
    try {
      await s.page.evaluate(() => { forgetFetch('tier'); localStorage.setItem('mockfail', JSON.stringify([{ table: 'subscribers', n: 1 }])); });
      await pressPlay(s.page);
      await s.page.waitForFunction(() => { const b = document.getElementById('voiceFailureBar'); return b && !b.hidden; });
      assert.match((await failureBar(s.page)).text, /confirm your plan/);
      assert.equal((await state_(s.page)).playing, false);
      assert.deepEqual(await speech(s.page), []);
      assert.equal(await s.page.evaluate(() => getMyTier()), 'ritual', 'the failure was not remembered as "no plan"');
      await s.page.click('#voiceFailureBar .vf-retry');
      await waitTrack(s.page);
    } finally { await s.browser.close(); }
  });

  await test('4c. A stored clip whose link has expired is re-requested, then reported — never read by the device', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]), apiBehaviour: { clipBroken: true } });
    try {
      await pressPlay(s.page);
      await s.page.waitForFunction(() => { const b = document.getElementById('voiceFailureBar'); return b && !b.hidden; }, null, { timeout: 20000 });
      assert.ok(s.calls.tts.length >= 3, 'each line was asked for again before giving up: ' + s.calls.tts.length);
      assert.match((await failureBar(s.page)).text, /couldn.t be loaded/);
      assert.deepEqual(await speech(s.page), []);
      s.behaviour.clipBroken = false;
      await s.page.click('#voiceFailureBar .vf-retry');
      await waitTrack(s.page);
    } finally { await s.browser.close(); }
  });

  await test('4d. A page load right at start-up (auth not settled yet) waits for the account instead of falling back', async () => {
    const s = await H.launch({ base, fixtures, seed: H.seedDb([H.seedSub()]) });
    try {
      await H.boot(s.page, base); await H.openLibrary(s.page);
      const r = await s.page.evaluate(async () => {
        document.body.setAttribute('data-auth', 'loading');
        setTimeout(() => document.body.setAttribute('data-auth', 'in'), 700);
        const t0 = performance.now(); const v = await resolveSessionVoice('serenity');
        return { kind: v.kind, waited: Math.round(performance.now() - t0) };
      });
      assert.equal(r.kind, 'serenity'); assert.ok(r.waited >= 600, 'it waited for auth: ' + r.waited);
    } finally { await s.browser.close(); }
  });

  /* 6 + 7 */
  for (const [label, minutes] of [['6. A 60-minute', 60], ['7. A 480-minute', 480]]) {
    await test(`${label} subliminal keeps playing for its whole saved length, then fades out (accelerated clock)`, async () => {
      const s = await session({ seed: H.seedDb([H.seedSub({ duration_seconds: minutes * 60, mix_settings: { pace: 'close', gapMs: 300 } })]) });
      try {
        await s.page.evaluate(() => { const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew; });
        await pressPlay(s.page); await waitTrack(s.page);
        assert.equal(await s.page.evaluate(() => state.targetLengthMinutes), minutes, 'the saved length was restored');
        // The voice is one looping source on the audio thread, not a chain of timers.
        assert.equal(await s.page.evaluate(() => voiceRun.main.src.loop), true);
        await s.page.evaluate((m) => { window.__skew = (m - 1) * 60 * 1000; }, minutes);
        await s.page.waitForTimeout(2600);
        let st = await state_(s.page);
        assert.equal(st.playing, true, 'still playing one minute before the end'); assert.equal(st.ctx, 'running');
        assert.equal(await s.page.evaluate(() => voiceRun.main.src.loop), true);
        await s.page.evaluate((m) => { window.__skew = m * 60 * 1000 + 3000; }, minutes);
        await s.page.waitForFunction(() => !finalPlaying, null, { timeout: 8000 });
        const log = await s.page.evaluate(() => __audioDiag().map(e => e.ev));
        assert.ok(log.includes('finish'), 'it ended by finishing, not by being cut off: ' + log.join(','));
      } finally { await s.browser.close(); }
    });
  }

  await test('7b. The voice loops seamlessly past its own length in real time (no stop, no restart of the player)', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub({ mix_settings: { pace: 'close', gapMs: 200 } })]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      const info = await s.page.evaluate(() => ({ dur: voiceRun.main.track.duration, run: 1 }));
      const positions = [];
      for (let i = 0; i < Math.ceil((info.dur + 3) / 0.25); i++) { positions.push(await s.page.evaluate(() => trackPosition(voiceRun.main))); await s.page.waitForTimeout(250); }
      const wraps = positions.filter((p, i) => i && p < positions[i - 1]).length;
      assert.ok(wraps >= 1, `the pass (${info.dur.toFixed(1)}s) wrapped around at least once`);
      const log = await s.page.evaluate(() => __audioDiag().map(e => e.ev));
      assert.equal(log.filter(e => e === 'track_start').length, 1, 'one source for the whole run; the player was not restarted: ' + log.join(','));
      assert.ok(!log.includes('stop') && !log.includes('finish'));
    } finally { await s.browser.close(); }
  });

  /* 8 */
  await test('8. Pause holds the position and Resume continues the same session (no new player)', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      await s.page.waitForTimeout(1500);
      const before = await s.page.evaluate(() => ({ run: voiceRun, starts: __audioDiag().filter(e => e.ev === 'track_start').length }).starts);
      await s.page.click('#ipPlay');
      await s.page.waitForFunction(() => finalPaused);
      assert.equal((await state_(s.page)).ctx, 'suspended');
      const p1 = await s.page.evaluate(() => trackPosition(voiceRun.main));
      await s.page.waitForTimeout(1500);
      const p2 = await s.page.evaluate(() => trackPosition(voiceRun.main));
      assert.ok(Math.abs(p2 - p1) < 0.1, `position frozen while paused (${p1} -> ${p2})`);
      await s.page.click('#ipPlay');
      await s.page.waitForFunction(() => !finalPaused);
      await s.page.waitForTimeout(1200);
      const p3 = await s.page.evaluate(() => trackPosition(voiceRun.main));
      assert.ok(p3 > p2 + 0.8, `position moved on after resume (${p2} -> ${p3})`);
      const after = await s.page.evaluate(() => __audioDiag().filter(e => e.ev === 'track_start').length);
      assert.equal(after, before, 'resume did not start a new source');
    } finally { await s.browser.close(); }
  });

  await test('8b. Start Over restarts from the top and still plays', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page); await s.page.waitForTimeout(2000);
      const requests = s.calls.tts.length;
      await s.page.click('.ip-control');
      await s.page.waitForFunction(() => finalPlaying && voiceRun && voiceRun.main && getFinalElapsedMs() < 1500);
      assert.equal(s.calls.tts.length, requests, 'Start Over reused the audio in hand');
      assert.ok(await outputLevel(s.page) > 0.01);
    } finally { await s.browser.close(); }
  });

  /* 9 + 10 + persistence */
  await test('9/10. Mixer settings persist per subliminal, each change sends only its own key, and all of it survives a reload', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub(), H.seedSub({ id: 'sub-2', title: 'Other', created_at: new Date(Date.now() - 5000).toISOString() })]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      const saved = () => s.page.waitForFunction(() => /Sound levels saved/.test(document.querySelector('[data-mix-status]').textContent), null, { timeout: 8000 });
      const lastPatch = async () => { const l = (await H.mocklog(s.page)).filter(e => e.op === 'rpc:patch_subliminal_audio'); return l[l.length - 1]; };
      // The first save of an older row writes everything once (it has no saved baseline); after that, only what changed.
      await s.page.evaluate(() => setListeningMix('mixBg', 71)); await saved();
      await s.page.evaluate(() => setListeningMix('mixBg', 72)); await saved();
      assert.deepEqual(Object.keys((await lastPatch()).patch), ['mixBg'], 'moving one fader sent only that fader');
      await s.page.evaluate(() => setListeningMix('mixBg', 71)); await saved();
      await s.page.evaluate(() => setListeningMix('mixVoice', 33)); await saved();
      assert.deepEqual(Object.keys((await lastPatch()).patch), ['mixVoice']);
      let row = (await H.db(s.page)).tables.subliminals.find(r => r.id === 'sub-1');
      assert.equal(row.mix_settings.mixBg, 71); assert.equal(row.mix_settings.mixVoice, 33);
      await s.page.evaluate(() => { setPlayerLoopMode('current'); setPlayerDuration(90); chooseAmbience('deep-mind'); chooseAmbience('rain'); setSoothingLayer('chimes'); pickPace({ dataset: { pace: 'drifting' } }); queueMixSave(); });
      await saved();
      row = (await H.db(s.page)).tables.subliminals.find(r => r.id === 'sub-1');
      assert.equal(row.mix_settings.mixBg, 71, 'earlier changes were not reset by later ones');
      assert.equal(row.mix_settings.loopMode, 'current'); assert.equal(row.mix_settings.durationMinutes, 90);
      assert.equal(row.mix_settings.pace, 'drifting'); assert.equal(row.mix_settings.soothingLayer, 'chimes'); assert.equal(row.mix_settings.bgLayer, 'rain'); assert.equal(row.mix_settings.bg, 'deep-mind');
      const other = (await H.db(s.page)).tables.subliminals.find(r => r.id === 'sub-2');
      assert.deepEqual(other.mix_settings, {}, 'a different subliminal was not touched');

      await s.page.reload(); await s.page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
      await H.openLibrary(s.page);
      await pressPlay(s.page, 'sub-1'); await waitTrack(s.page);
      const got = await s.page.evaluate(() => ({ bg: document.getElementById('mixBg').value, voice: document.getElementById('mixVoice').value, loop: getPlayerLoopMode(), minutes: state.targetLengthMinutes, pace: affirmationPace, gap: affirmationGapMs, soothing: state.soothingLayer, layer: state.bgLayer, ambience: state.bg, aiVoice: state.aiVoiceId }));
      assert.deepEqual(got, { bg: '71', voice: '33', loop: 'current', minutes: 90, pace: 'drifting', gap: 4500, soothing: 'chimes', layer: 'rain', ambience: 'deep-mind', aiVoice: 'serenity' });
      // And the other subliminal opens with ITS settings, not these.
      await pressPlay(s.page, 'sub-2'); await waitTrack(s.page);
      const other2 = await s.page.evaluate(() => ({ bg: document.getElementById('mixBg').value, pace: affirmationPace, soothing: state.soothingLayer, layer: state.bgLayer }));
      assert.deepEqual(other2, { bg: '50', pace: 'steady', soothing: 'none', layer: 'none' });
    } finally { await s.browser.close(); }
  });

  await test('9b. A save that fails is reported, kept on the device, retried, and restored after a reload', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      await s.page.evaluate(() => localStorage.setItem('mockfail', JSON.stringify([{ table: 'rpc', n: 9 }, { table: 'subliminals', op: 'update', n: 9 }])));
      await s.page.evaluate(() => setListeningMix('mixTone', 77));
      await s.page.waitForFunction(() => /Couldn.t save just now/.test(document.querySelector('[data-mix-status]').textContent), null, { timeout: 8000 });
      assert.equal((await H.db(s.page)).tables.subliminals[0].mix_settings.mixTone, undefined, 'the server does not have it');
      // Close the tab before any retry succeeds, reopen: the device's copy is applied and re-sent.
      await s.page.evaluate(() => localStorage.setItem('mockfail', '[]'));
      await s.page.reload(); await s.page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
      await H.openLibrary(s.page);
      await pressPlay(s.page, 'sub-1'); await waitTrack(s.page);
      assert.equal(await s.page.evaluate(() => document.getElementById('mixTone').value), '77', 'the unsaved change came back');
      await s.page.waitForFunction(() => /Sound levels saved/.test(document.querySelector('[data-mix-status]').textContent), null, { timeout: 8000 });
      assert.equal((await H.db(s.page)).tables.subliminals[0].mix_settings.mixTone, 77, 'and was sent to the server');
    } finally { await s.browser.close(); }
  });

  await test('9c. Without the merge function installed, saving still works through a plain update', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub({ mix_settings: { mixBg: 20, bgLayer: 'rain' } })]) });
    try {
      await s.page.evaluate(() => localStorage.setItem('mock_no_rpc', '1'));
      await pressPlay(s.page); await waitTrack(s.page);
      await s.page.evaluate(() => setListeningMix('mixVoice', 44));
      await s.page.waitForFunction(() => /Sound levels saved/.test(document.querySelector('[data-mix-status]').textContent), null, { timeout: 8000 });
      const mix = (await H.db(s.page)).tables.subliminals[0].mix_settings;
      assert.equal(mix.mixVoice, 44); assert.equal(mix.mixBg, 20); assert.equal(mix.bgLayer, 'rain');
    } finally { await s.browser.close(); }
  });

  /* 11 */
  await test('11. Switching subliminals stops the first completely: one context, one voice track, only the new voice', async () => {
    const a = H.seedSub({ id: 'sub-a', affirmations: ['L0 first'], title: 'A' });
    const b = H.seedSub({ id: 'sub-b', affirmations: ['L2 second'], title: 'B', created_at: new Date(Date.now() - 5000).toISOString() });
    const s = await session({ seed: H.seedDb([a, b]) });
    try {
      await s.page.evaluate(() => { window.__ctxs = []; const Orig = window.AudioContext; window.AudioContext = class extends Orig { constructor(...a) { super(...a); window.__ctxs.push(this); } }; });
      await pressPlay(s.page, 'sub-a'); await waitTrack(s.page);
      assert.ok(near(await H.pitchAtCue(s.page, 0), 280));
      const firstRun = await s.page.evaluate(() => { window.__firstRun = voiceRun; return true; });
      await pressPlay(s.page, 'sub-b');
      await s.page.waitForFunction(() => voiceRun && voiceRun !== window.__firstRun && voiceRun.main && voiceRun.main.src);
      const r = await s.page.evaluate(() => ({ states: window.__ctxs.map(c => c.state), running: window.__ctxs.filter(c => c.state === 'running').length, old: window.__firstRun.main.src && true, cues: voiceRun.main.track.cues.length, title: state.playerTitle }));
      assert.equal(r.running, 1, 'exactly one running context: ' + r.states);
      assert.equal(r.cues, 1); assert.equal(r.title, 'B');
      assert.ok(near(await H.pitchAtCue(s.page, 0), 440), 'only the second subliminal\'s voice is in the track');
      assert.equal(await s.page.evaluate(() => window.__firstRun === voiceRun), false);
      assert.deepEqual(await speech(s.page), []);
    } finally { await s.browser.close(); }
  });

  await test('11b. Tapping a second subliminal while the first is still loading does not mix them', async () => {
    const a = H.seedSub({ id: 'sub-a', affirmations: ['L0 first'] });
    const b = H.seedSub({ id: 'sub-b', affirmations: ['L1 second'], created_at: new Date(Date.now() - 5000).toISOString() });
    const s = await session({ seed: H.seedDb([a, b]) });
    try {
      await s.page.evaluate(() => { document.getElementById('libPlay-sub-a').click(); document.getElementById('libPlay-sub-b').click(); });
      await waitTrack(s.page);
      await s.page.waitForTimeout(1500);
      assert.equal(await s.page.evaluate(() => state.playerTitle), 'Night');
      assert.equal(await s.page.evaluate(() => voiceRun.main.track.cues.length), 1);
      assert.ok(near(await H.pitchAtCue(s.page, 0), 360), 'the later tap won, wholly');
    } finally { await s.browser.close(); }
  });

  /* 12 */
  await test('12. Generated audio is requested once per sequence and reused for every replay', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      assert.equal(s.calls.tts.length, 1, 'one batched request for all three lines, not one per line: ' + s.calls.tts.length);
      await s.page.evaluate(() => stopFinal());
      await pressPlay(s.page); await waitTrack(s.page);
      await s.page.click('.ip-control'); await s.page.waitForTimeout(800);
      assert.equal(s.calls.tts.length, 1, 'stop/play/start-over made no new requests');
    } finally { await s.browser.close(); }
  });

  /* 15 */
  await test('15. After signing out and back in, the same subliminal plays in the same voice with the same settings', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub({ mix_settings: { mixBg: 66, pace: 'close', gapMs: 300, loopMode: 'entire' } })]) });
    try {
      await s.page.evaluate(() => sb.auth.signOut());
      await s.page.reload(); await s.page.waitForFunction(() => document.body.getAttribute('data-auth') === 'out');
      assert.equal(await s.page.evaluate(() => finalPlaying), false);
      await s.page.evaluate(() => localStorage.setItem('mock_logged_in', '1'));
      await s.page.reload(); await s.page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
      await H.openLibrary(s.page);
      await pressPlay(s.page); await waitTrack(s.page);
      assert.equal(await s.page.evaluate(() => document.getElementById('mixBg').value), '66');
      assert.ok(near(await H.pitchAtCue(s.page, 0), 280));
      assert.deepEqual(await speech(s.page), []);
    } finally { await s.browser.close(); }
  });

  /* regression for the 1.2 second self-destruct */
  await test('16. A context that is interrupted early is resumed — the session is not destroyed at 1.2 seconds', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      await s.page.evaluate(() => { finalCtx.suspend(); });
      await s.page.waitForTimeout(2600);
      const st = await state_(s.page);
      assert.equal(st.playing, true, 'still a live session');
      assert.equal(st.ctx, 'running', 'the context was asked to run again');
    } finally { await s.browser.close(); }
  });

  await test('16b. A context the browser will not run pauses the session (position kept) instead of stopping it', async () => {
    const s = await session({ seed: H.seedDb([H.seedSub()]) });
    try {
      await pressPlay(s.page); await waitTrack(s.page);
      await s.page.evaluate(() => { const orig = finalCtx.resume.bind(finalCtx); finalCtx.resume = () => Promise.resolve(); window.__origResume = orig; finalCtx.suspend(); });
      await s.page.waitForFunction(() => finalPaused, null, { timeout: 8000 });
      const st = await state_(s.page);
      assert.equal(st.playing, true, 'session kept'); assert.equal(st.paused, true);
      assert.match(await s.page.evaluate(() => document.getElementById('finalLine').textContent), /Tap play to continue/);
      await s.page.evaluate(() => { finalCtx.resume = window.__origResume; });
      await s.page.click('#ipPlay');
      await s.page.waitForFunction(() => finalPlaying && !finalPaused && finalCtx.state === 'running');
    } finally { await s.browser.close(); }
  });

  /* saving */
  await test('17. Saving a recorded subliminal whose upload fails creates nothing; retrying saves it with its voice recorded as fact', async () => {
    const s = await H.launch({ base, fixtures, seed: H.seedDb([]) });
    try {
      await H.boot(s.page, base);
      await s.page.evaluate(async (wavB64) => {
        const bytes = Uint8Array.from(atob(wavB64), c => c.charCodeAt(0));
        startNewSubliminal();
        state.freq = FREQS.find(f => f.hz === 528);
        state.affirmations = ['I am calm.', 'I am safe.'];
        state.voiceMode = 'own'; state.selectedVoice = VOICE_RECORD_OWN;
        recordings = state.affirmations.map(() => { const blob = new Blob([bytes], { type: 'audio/wav' }); return { url: URL.createObjectURL(blob), blob }; });
        showBuildPage(); showStep(7); prepareFinal();
        document.getElementById('finalTitleInput').value = 'Recorded';
        localStorage.setItem('mockfail', JSON.stringify([{ table: 'storage-upload', n: 9 }]));
      }, H.wavBytes(300, 1.5).toString('base64'));
      await s.page.click('#saveBtn');
      await s.page.waitForFunction(() => /nothing was saved/.test(document.getElementById('saveMsg').textContent));
      assert.equal((await H.db(s.page)).tables.subliminals.length, 0, 'no half-saved row that would play in the wrong voice');
      await s.page.evaluate(() => localStorage.setItem('mockfail', '[]'));
      await s.page.click('#saveBtn');
      await s.page.waitForFunction(() => /Saved to your library/.test(document.getElementById('saveMsg').textContent));
      const row = (await H.db(s.page)).tables.subliminals[0];
      assert.equal(row.voice_profile.kind, 'recorded'); assert.equal(row.recording_urls.filter(Boolean).length, 2);
    } finally { await s.browser.close(); }
  });

  await test('17b. Saving a Serenity subliminal records its voice identity and pace', async () => {
    const s = await H.launch({ base, fixtures, seed: H.seedDb([]) });
    try {
      await H.boot(s.page, base);
      await s.page.evaluate(() => {
        startNewSubliminal();
        state.freq = FREQS.find(f => f.hz === 528);
        state.affirmations = ['L0 I am calm.'];
        setSelectedVoice(VOICE_SERENITY);
        pickPace({ dataset: { pace: 'drifting' } });
        showBuildPage(); showStep(7); prepareFinal();
        document.getElementById('finalTitleInput').value = 'Serenity one';
      });
      await s.page.waitForFunction(() => voiceFingerprints.serenity, null, { timeout: 8000 });
      await s.page.click('#saveBtn');
      await s.page.waitForFunction(() => /Saved to your library/.test(document.getElementById('saveMsg').textContent));
      const row = (await H.db(s.page)).tables.subliminals[0];
      assert.equal(row.ai_voice_id, 'serenity');
      assert.equal(row.voice_profile.kind, 'serenity'); assert.equal(row.voice_profile.fingerprint, 'fp-serenity'); assert.equal(row.voice_profile.pace, 'drifting');
      assert.equal(row.mix_settings.pace, 'drifting');
      assert.equal(s.calls.tts.every(c => c.speed === 0.82), true, 'generated at the pace it was saved with');
    } finally { await s.browser.close(); }
  });

  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name.slice(0, 40)).join(' | ')); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exitCode = 1; });
