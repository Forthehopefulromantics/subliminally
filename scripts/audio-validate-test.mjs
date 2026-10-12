// What is allowed to be stored as a finished clip. Run: npm run test:audio-validate
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateSpeechClip, inspectMp3 } from '../lib/audio-validate.js';

const dir = mkdtempSync(path.join(tmpdir(), 'val-'));
let ffmpeg = 'ffmpeg'; try { ffmpeg = (await import('ffmpeg-static')).default || ffmpeg; } catch {}
const make = (secs, hz = 300) => { const f = path.join(dir, `t${secs}.mp3`); execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${secs}`, '-ac', '1', '-ar', '44100', '-b:a', '64k', f]); return readFileSync(f); };

const good = make(4);
const info = inspectMp3(good);
assert.ok(info.ok && Math.abs(info.durationMs - 4000) < 120, 'duration read from the frames: ' + info.durationMs);
assert.equal(validateSpeechClip(good, 'I am calm and I am becoming who I said I would be.').ok, true);
console.log('PASS: a whole clip validates and its real duration is read');

assert.equal(validateSpeechClip(Buffer.alloc(0), 'x').reason, 'too_small');
assert.equal(validateSpeechClip(Buffer.from('{"error":"quota"}'.padEnd(4000, ' ')), 'x').reason, 'not_mp3');
assert.equal(validateSpeechClip(Buffer.alloc(5000), 'x').reason, 'not_mp3');
console.log('PASS: empty bodies, error pages and garbage are refused');

const cut = good.subarray(0, 700);
assert.equal(validateSpeechClip(cut, 'I am calm.').ok, false, 'a clip cut off after a few frames is refused');
const longText = 'I am calm, I am safe, I am enough, and everything I need is already within me, right now.';
const short = make(0.5);
const r = validateSpeechClip(short, longText);
assert.equal(r.ok, false); assert.equal(r.reason, 'too_short');
console.log('PASS: a clip far too short for its words is refused as truncated');
