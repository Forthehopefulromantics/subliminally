#!/usr/bin/env node
/* telemetry-test.mjs — what monitoring is allowed to send and to log.
   The rule: codes, counts and timings only. Never affirmation text, links to
   recordings, tokens, or who the person is.      npm run test:telemetry */
import vm from 'node:vm';
import fs from 'node:fs';
import { sanitizeEvent } from '../api/client-event.js';

let fails = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(got)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
}

/* ---- the browser side: run telemetry.js against a fake page and read what it sends ---- */
function pageWith(){
  const sent = [];
  const win = { addEventListener(){} };
  const ctx = vm.createContext({
    window: win, document: { visibilityState: 'visible' },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', onLine: true, maxTouchPoints: 5,
      sendBeacon(url, blob){ sent.push({ url, blob }); return true; } },
    Blob: class { constructor(parts){ this.text = parts.join(''); } },
    fetch: () => Promise.resolve(), API_BASE: '',
  });
  win.navigator = ctx.navigator;
  vm.runInContext(fs.readFileSync(new URL('../js/telemetry.js', import.meta.url), 'utf8'), ctx);
  return { win: ctx.window, sent: () => sent.map(s => JSON.parse(s.blob.text)), urls: () => sent.map(s => s.url) };
}

let p = pageWith();
p.win.reportAudioIssue('clip_load_failed', { code: 'clip_expired', stage: 'first', voice: 'studio', ms: 812.6 });
let e = p.sent()[0];
check('a plain failure is reported with its codes', [e.kind, e.fields], ['audio_clip_load_failed', { code: 'clip_expired', stage: 'first', voice: 'studio', ms: 813 }]);
check('  ...tagged with the platform it happened on', e.platform, 'ios-safari');
check('  ...to the event endpoint', p.urls()[0], '/api/client-event');

p = pageWith();
const secretText = 'I am becoming who I said I would be';
p.win.reportAudioIssue('voice_failed', {
  code: secretText,                                              // a sentence (affirmation text)
  stage: 'https://x.supabase.co/storage/v1/object/sign/tts-cache/u/abc.mp3?token=eyJhbGciOi',  // a link
  voice: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghij',       // a token
  reason: 'user@example.com',                                    // an email
  text: secretText, affirmation: secretText, userId: 'user-abc', email: 'kyla@example.com', token: 'tok',  // not allow-listed names
});
const body = JSON.stringify(p.sent());
check('affirmation text never leaves the page', body.includes('becoming'), false);
check('links to audio never leave the page', body.includes('supabase') || body.includes('http'), false);
check('tokens never leave the page', body.includes('eyJ'), false);
check('emails and user ids never leave the page', /@|user-abc|kyla/.test(body), false);
check('fields that are not on the allow-list are dropped by name', Object.keys(p.sent()[0].fields), []);

p = pageWith();
p.win.reportIssue('Not A Valid Kind!', { code: 'x' });
p.win.reportIssue('audio_ok', {});
check('a malformed event name is refused, a valid one is sent', p.sent().map(s => s.kind), ['audio_ok']);

p = pageWith();
for (let i = 0; i < 200; i++) p.win.reportAudioIssue('flood_' + (i % 100), { code: 'c' + i });
check('a failure loop cannot flood: capped per page load', p.sent().length <= 25, true);
p = pageWith();
for (let i = 0; i < 10; i++) p.win.reportAudioIssue('tts_failed', { code: 'network' });
check('the same failure repeated is sent once', p.sent().length, 1);

/* ---- the server side: it trusts nothing it is sent ---- */
check('server: an unknown event name is dropped', sanitizeEvent({ kind: 'drop_table', fields: {} }), null);
check('server: not-an-object is dropped', sanitizeEvent('hello'), null);
const s = sanitizeEvent({ kind: 'audio_tts_failed', sid: 'abc123', platform: 'native-ios',
  fields: { code: 'quota_exceeded', text: secretText, stage: secretText, url: 'https://a.b/c?token=zzz', ms: 1200 }, extra: 'x' });
check('server: only allow-listed, code-shaped values survive', s.fields, { code: 'quota_exceeded', ms: 1200 });
check('server: nothing outside the schema is kept', Object.keys(s).sort(), ['fields', 'kind', 'online', 'platform', 'sid', 'visible']);
check('server: an unknown platform is not echoed', sanitizeEvent({ kind: 'save_failed', platform: '<script>' }).platform, 'unknown');

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
