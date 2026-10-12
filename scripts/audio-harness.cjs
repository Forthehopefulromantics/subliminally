/* Shared harness for the browser tests of the audio system: a static server for
   the site, a real Chromium (Playwright), the in-memory Supabase, and a stand-in
   for /api/tts and /api/voices that returns REAL mp3 files — so what is decoded
   and played in the page is real audio, not a stub. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const MOCK = fs.readFileSync(path.join(ROOT, 'scripts/fixtures/mock-supabase.js'), 'utf8');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json' };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function startStaticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

/* Distinct pure tones per "voice line", so a test can tell WHICH recording or
   which generated clip is actually in the audio by measuring its pitch. */
const LINE_HZ = [280, 360, 440, 520, 600];
function makeFixtures() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-audio-'));
  const ffmpeg = (() => { try { return require('ffmpeg-static'); } catch (e) { return 'ffmpeg'; } })();
  LINE_HZ.forEach((hz, i) => {
    execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=2.5`, '-ac', '1', '-ar', '44100', '-b:a', '64k', path.join(dir, `line${i}.mp3`)]);
  });
  return dir;
}

/* Speech-like WAV recorded "by the user", with its own pitch per line. */
function wavBytes(hz, seconds) {
  const sr = 22050, n = Math.floor(sr * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / sr) * 12000), 44 + i * 2);
  return b;
}

async function launch({ iphone = false, base, fixtures, seed, apiBehaviour = {} }) {
  const browser = await chromium.launch({ args: [] });   // real autoplay policy: audio needs a user gesture
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, userAgent: iphone ? IPHONE_UA : undefined });
  const calls = { tts: [], voices: 0, other: [] };
  const behaviour = { ttsFail: null, voices: { presets: [{ key: 'serenity', name: 'Serenity', fingerprint: 'fp-serenity' }], myVoice: null, consentStatement: 'x', provider: 'elevenlabs' }, ...apiBehaviour };
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (url.startsWith(base + '/api/voices')) { calls.voices++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(behaviour.voices) }); }
    if (url.startsWith(base + '/api/tts')) {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.tts.push({ voiceKey: body.voiceKey, speed: body.speed, lines: body.lines });
      if (behaviour.ttsFail) return route.fulfill({ status: behaviour.ttsFail.status || 502, contentType: 'application/json', body: JSON.stringify({ error: behaviour.ttsFail.error || 'provider_failed' }) });
      const fp = body.voiceKey === 'mine' ? 'fp-mine' : 'fp-serenity';
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ voiceKey: body.voiceKey, voiceFingerprint: behaviour.fingerprint || fp, clips: (body.lines || []).map((t, i) => ({ index: i, text: t, url: `${base}/__fx/line${hzIndex(t)}.mp3`, cached: false, status: 'ready', error: null })) }) });
    }
    if (url.startsWith(base + '/__fx/')) {
      if (behaviour.clipBroken) return route.fulfill({ status: 403, body: 'expired' });
      return route.fulfill({ contentType: 'audio/mpeg', body: fs.readFileSync(path.join(fixtures, url.split('/').pop())) });
    }
    if (url.startsWith(base + '/api/')) { calls.other.push(url); return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); }
    if (url.startsWith(base)) return route.continue();
    return route.abort();
  });
  // Which fixture a line maps to: by its text, "L<n>" -> line n.
  function hzIndex(t) { const m = /L(\d)/.exec(t || ''); return m ? Number(m[1]) : 0; }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({ seedDb }) => {
    if (window !== window.top) return;
    // Anything the phone's own voice is asked to say is recorded, and never actually spoken.
    window.__deviceSpeech = [];
    try {
      const ss = window.speechSynthesis;
      ss.speak = u => { window.__deviceSpeech.push(u.text); setTimeout(() => u.onend && u.onend({}), 20); };
    } catch (e) {}
    if (!localStorage.getItem('mockdb')) localStorage.setItem('mockdb', JSON.stringify(seedDb));
  }, { seedDb: seed });
  return { browser, context, page, calls, behaviour, errors };
}

async function boot(page, base) {
  await page.goto(base + '/');
  await page.waitForFunction(() => document.body.getAttribute('data-auth') === 'in');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'));
}
async function openLibrary(page) {
  await page.evaluate(async () => { showLibraryPage(); await loadMyLibrary({ force: true }); });
  await page.waitForSelector('.lib-play');
}
const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
const mocklog = page => page.evaluate(() => JSON.parse(localStorage.getItem('mocklog') || '[]'));

/* The pitch of what is in the voice track at a given cue — measured on the real
   decoded samples, by counting zero crossings. */
function pitchAtCue(page, cueIndex) {
  return page.evaluate((ci) => {
    const t = voiceRun && voiceRun.main && voiceRun.main.track;
    if (!t) return null;
    const cue = t.cues[ci]; if (!cue) return null;
    const ch = t.channels[0], from = Math.floor(cue.start * t.sampleRate) + 4000, len = Math.floor(1.5 * t.sampleRate);
    let crossings = 0;
    for (let i = from + 1; i < from + len; i++) if ((ch[i - 1] < 0) !== (ch[i] < 0)) crossings++;
    return Math.round(crossings / 2 / (len / t.sampleRate));
  }, cueIndex);
}

const seedSub = (o) => ({ id: 'sub-1', user_id: 'user-1', title: 'Night', frequency_hz: 528, affirmations: ['L0 I am calm.', 'L1 I am safe.', 'L2 I am enough.'], background: 'none', duration_seconds: 1200, recording_urls: null, ai_voice_id: 'serenity', mix_settings: {}, created_at: new Date().toISOString(), ...o });
const seedDb = (subs, tier = 'ritual', storage = {}) => ({ tables: {
  profiles: [{ id: 'user-1', onboarding_completed: true, display_name: 'Tester' }],
  subscribers: tier ? [{ user_id: 'user-1', tier, status: 'active' }] : [],
  subliminals: subs }, storage });

module.exports = { startStaticServer, makeFixtures, launch, boot, openLibrary, db, mocklog, pitchAtCue, seedSub, seedDb, wavBytes, LINE_HZ, IPHONE_UA };
