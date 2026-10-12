/* The voice track: pure data in, pure data out. Run: npm run test:track */
const assert = require('assert/strict');
const { renderVoiceTrack, voiceTrackPosition, measureClipLevel } = require('../js/voice-track.js');
const rate = 1000;                                   // 1 sample per millisecond keeps the arithmetic readable
const clip = (index, seconds, value, extra) => ({ index, channels: [new Float32Array(seconds * rate).fill(value)], sampleRate: rate, ...extra });

// Lines, gaps and cues tile the track exactly.
let t = renderVoiceTrack([clip(0, 3, 0.5), clip(1, 2, -0.5)], { gapMs: 2000, jitter: 0, seed: 1 });
assert.equal(t.duration, 3 + 2 + 2 + 2);
assert.deepEqual(t.cues, [{ index: 0, start: 0, end: 5 }, { index: 1, start: 5, end: 9 }]);
assert.equal(t.channels[0][1500], 0.5); assert.equal(t.channels[0][3500], 0, 'silence after line 0'); assert.equal(t.channels[0][5500], -0.5);
console.log('PASS: cues tile the pass; lines and silences are where the cues say');

// Repeats (EFT) are baked in with the beat between them.
t = renderVoiceTrack([clip(0, 1, 0.5, { repeats: 3 })], { gapMs: 1000, jitter: 0, repeatBeatMs: 500, seed: 1 });
assert.equal(t.duration, 3 * 1 + 2 * 0.5 + 1);
console.log('PASS: repeats and their beats are part of the pass');

// Same input, same render; different seed, different breathing room; jitter stays inside its bounds.
const a = renderVoiceTrack([clip(0, 1, 1), clip(1, 1, 1), clip(2, 1, 1)], { gapMs: 2000, jitter: 0.2, seed: 7 });
const b = renderVoiceTrack([clip(0, 1, 1), clip(1, 1, 1), clip(2, 1, 1)], { gapMs: 2000, jitter: 0.2, seed: 7 });
const c = renderVoiceTrack([clip(0, 1, 1), clip(1, 1, 1), clip(2, 1, 1)], { gapMs: 2000, jitter: 0.2, seed: 8 });
assert.deepEqual(a.cues, b.cues); assert.notDeepEqual(a.cues, c.cues);
a.cues.forEach(q => { const gap = q.end - q.start - 1; assert.ok(gap >= 1.6 - 1e-6 && gap <= 2.4 + 1e-6, 'gap ' + gap); });
console.log('PASS: deterministic render; gaps vary within the pace\'s jitter');

// Blank / empty clips are skipped; nothing to play is null, not a zero-length loop.
assert.equal(renderVoiceTrack([], {}), null);
assert.equal(renderVoiceTrack([{ index: 0, channels: [new Float32Array(0)], sampleRate: rate }], {}), null);
console.log('PASS: nothing to say renders nothing');

// Position wraps: any length of session lands inside the pass; a 480 minute run is the same arithmetic.
const p = voiceTrackPosition(t = renderVoiceTrack([clip(0, 3, 1), clip(1, 3, 1)], { gapMs: 1000, jitter: 0, seed: 1 }), 480 * 60 + 5.5);
assert.ok(p.pos >= 0 && p.pos < t.duration); assert.equal(p.cue.index, 1);
assert.equal(voiceTrackPosition(t, 0).cue.index, 0);
console.log('PASS: position wraps for any session length and reports the line being spoken');

// Stereo is kept; mono is duplicated up to it.
t = renderVoiceTrack([{ index: 0, channels: [new Float32Array(1000).fill(1), new Float32Array(1000).fill(-1)], sampleRate: rate }, clip(1, 1, 0.25)], { gapMs: 0, jitter: 0, seed: 1 });
assert.equal(t.channels.length, 2); assert.equal(t.channels[1][500], -1); assert.equal(t.channels[1][1500], 0.25);
console.log('PASS: stereo preserved, mono lines fill both channels');

// A silent recording is detected; a quiet one is not.
assert.ok(measureClipLevel(clip(0, 1, 0)).peak < 0.004);
assert.ok(measureClipLevel(clip(0, 1, 0.05)).peak > 0.004);
console.log('PASS: silent recordings are distinguishable from quiet ones');
