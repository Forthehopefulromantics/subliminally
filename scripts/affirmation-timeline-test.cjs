/* Affirmation limits, ordering, and the playback timeline (the single source of
   truth for which line is highlighted).  Run:  npm run test:affirmations */
const assert = require('node:assert/strict');
const K = require('../js/affirmation-timeline.js');

/* ---- limits ---- */
assert.equal(K.limitFor('record_own'), 20);
assert.equal(K.limitFor('serenity'), 10, 'Serenity keeps its 10');
assert.equal(K.limitFor('clone_voice'), 10, 'Clone Your Voice keeps its 10');
assert.equal(K.countLabel(12, 20), '12/20');
assert.equal(K.overLimitMessage(12, 'record_own'), '', '12 lines is fine when recording yourself');
assert.equal(K.overLimitMessage(20, 'record_own'), '', 'and 20 is the most');
assert.equal(K.overLimitMessage(10, 'serenity'), '');
const msg = K.overLimitMessage(14, 'serenity');
assert.match(msg, /up to 10/); assert.match(msg, /14/); assert.match(msg, /Nothing has been removed/, 'the explanation says nothing was deleted');
assert.match(msg, /Record Your Own Voice/, 'and where to go for more');
assert.match(K.overLimitMessage(11, 'clone_voice'), /Clone Your Voice reads up to 10/);

/* ---- ordering ---- */
assert.deepEqual(K.moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
assert.deepEqual(K.moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
const orig = ['a', 'b']; K.moveItem(orig, 0, 1); assert.deepEqual(orig, ['a', 'b'], 'moveItem does not mutate');
assert.deepEqual(K.moveItem(['a', 'b'], 0, 5), ['a', 'b'], 'out of range is a no-op');
// two parallel arrays moved the same way stay parallel
let lines = ['one', 'two', 'three'], takes = [{ id: 1 }, null, { id: 3 }];
lines = K.moveItem(lines, 2, 0); takes = K.moveItem(takes, 2, 0);
assert.deepEqual([lines[0], takes[0].id], ['three', 3]);

/* ---- planned timing metadata ---- */
const plan = K.planTimings([3000, 4000, 2000], { gapMs: 1000 });
assert.deepEqual(plan.map(p => [p.startMs, p.endMs]), [[0, 3000], [4000, 8000], [9000, 11000]]);
assert.equal(K.planTimings([1000], { gapMs: 500, repeats: () => 3 })[0].endMs, 1000 * 3 + 700 * 2, 'repeats (EFT) are inside the line');

/* ---- the timeline ---- */
let clock = 0;
const tl = new K.AffirmationTimeline({ now: () => clock });
tl.setCount(4);
const seen = [];
tl.on(s => seen.push(s.type + ':' + s.active));
tl.beginPass();
assert.deepEqual(tl.snapshot().states, ['upcoming', 'upcoming', 'upcoming', 'upcoming'], 'before play every line is shown, none is lit');

// sequential lines: highlight follows the real start/end
clock = 1000; tl.lineStart(0);
assert.equal(tl.active, 0); assert.equal(tl.stateOf(0), 'active'); assert.equal(tl.stateOf(1), 'upcoming');
clock = 3500; tl.lineEnd(0);
assert.equal(tl.active, -1, 'in the silence between lines nothing is claimed to be speaking');
assert.equal(tl.stateOf(0), 'played');
clock = 5000; tl.lineStart(1);
assert.equal(tl.active, 1); assert.deepEqual(tl.snapshot().states, ['played', 'active', 'upcoming', 'upcoming'], 'advances on every change');
clock = 8000; tl.lineEnd(1);
assert.equal(tl.activeAt(1000), 0); assert.equal(tl.activeAt(3499), 0); assert.equal(tl.activeAt(3500), -1, 'end is exclusive');
assert.equal(tl.activeAt(5000), 1); assert.equal(tl.activeAt(7999), 1); assert.equal(tl.activeAt(9000), -1, 'activeAt answers exactly from the recorded segments (seek / resume)');

// a late or duplicate end never un-highlights the wrong line
clock = 9000; tl.lineStart(2);
tl.lineEnd(1); tl.lineEnd(0);
assert.equal(tl.active, 2, 'ends for other lines are ignored');
clock = 9500; tl.lineEnd(2);
tl.lineEnd(2); assert.equal(tl.active, -1, 'a duplicate end is harmless');

// overlapping: exactly one primary at a time, the later start wins and closes the earlier
clock = 10000; tl.lineStart(2);
clock = 10400; tl.lineStart(3);
assert.equal(tl.active, 3, 'the later start owns the highlight');
assert.equal(tl.stateOf(2), 'played', 'and the earlier one is closed at that instant');
assert.equal(tl.segments.filter(s => s.end == null).length, 1, 'never two open segments');
assert.equal(tl.activeAt(10399), 2); assert.equal(tl.activeAt(10400), 3);
clock = 12000; tl.lineEnd(3);

// pause freezes, resume restores the same highlight
clock = 13000; tl.beginPass(); clock = 13100; tl.lineStart(0);
tl.pause(); assert.equal(tl.snapshot().paused, true); assert.equal(tl.active, 0, 'pausing keeps the highlight');
clock = 99999; // time passes while paused (the session clock excludes it in the app)
tl.resume(); assert.equal(tl.active, 0, 'resume restores the same line');
assert.equal(tl.snapshot().paused, false);

// loop: a new pass starts again from the first line, nothing carried over
clock = 14000; tl.lineEnd(0); clock = 14100; tl.lineStart(1); clock = 15000; tl.lineEnd(1);
tl.beginPass();
assert.deepEqual(tl.snapshot().states, ['upcoming', 'upcoming', 'upcoming', 'upcoming'], 'the loop cycles back to the beginning');
assert.equal(tl.segments.length, 0);
clock = 16000; tl.lineStart(0); assert.equal(tl.active, 0);

// seeking: the requested line is "up next" until it really starts
tl.request(3); assert.equal(tl.stateOf(3), 'queued'); assert.equal(tl.active, 0, 'the current line is not cut');
clock = 17000; tl.lineEnd(0); tl.lineStart(3);
assert.equal(tl.stateOf(3), 'active'); assert.equal(tl.queued, -1, 'the jump is answered when it starts');
assert.equal(tl.stateOf(1), 'played', 'lines before the active one count as passed');
tl.request(99); assert.equal(tl.queued, -1, 'an out-of-range jump is ignored');

// Start Over / Stop
tl.reset(); tl.setCount(4);
assert.deepEqual(tl.snapshot().states, ['upcoming', 'upcoming', 'upcoming', 'upcoming']);
assert.equal(tl.active, -1);

assert.ok(seen.length > 10, 'listeners are told about every change');
tl.on(() => { throw new Error('a broken listener'); });
tl.lineStart(1); // must not throw
console.log('PASS: limits 20/10, count label, over-limit explanation, reorder, timing plan, sequential sync, overlap rule, pause/resume, loop, seek, start over');
