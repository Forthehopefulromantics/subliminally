/* voice-track.js — one pass of a subliminal's voice, rendered as a single buffer.

   WHY THIS EXISTS

   The player used to read a session one line at a time: decode a clip, play it,
   wait for its `ended` callback, set a timer for the gap, do the next. For a
   session that has to run for eight hours with the screen locked that is a long
   chain of JavaScript callbacks and timers, and every link in it is something a
   phone is allowed to throttle, suspend or drop. When one link broke the session
   went quiet — or, for a studio voice, the catch-all handler quietly read the
   line with the phone's own voice instead.

   Now the whole pass (every line, its repeats and the silence after it) is
   rendered once into one AudioBuffer and played with `loop = true`. The loop
   runs on the audio thread: after it starts no timer, no network request and no
   decoder is needed for the voice to keep going, however long the session is.

   Everything here is plain data in, plain data out (Float32Arrays), so it can be
   tested without a browser. */

/* A small deterministic generator, so the breathing room between lines varies
   from line to line (a gap exactly 2.4s every time is a click track) but a
   given session renders identically every time it is rebuilt. */
function voiceTrackRandom(seed){
  let a = (seed >>> 0) || 1;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function voiceTrackSeed(text){
  let h = 2166136261;
  for (let i = 0; i < text.length; i++){ h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* items:  [{ index, channels: Float32Array[], sampleRate, repeats? }]
   opts:   { gapMs, jitter, repeatBeatMs, seed }
   Returns { channels, sampleRate, length, duration, cues } where each cue is
   { index, start, end } in seconds; `end` includes the silence after the line,
   so the cues tile the track exactly and "loop this affirmation" can loop one. */
function renderVoiceTrack(items, opts){
  opts = opts || {};
  const usable = (items || []).filter(it => it && it.channels && it.channels.length && it.channels[0].length);
  if (!usable.length) return null;
  const rate = usable[0].sampleRate;
  const gapMs = Math.max(0, Number(opts.gapMs) || 0);
  const jitter = Math.max(0, Math.min(0.5, Number(opts.jitter) || 0));
  const beat = Math.max(0, Number(opts.repeatBeatMs == null ? 700 : opts.repeatBeatMs)) / 1000;
  const rand = voiceTrackRandom(opts.seed == null ? voiceTrackSeed(usable.map(u => u.index).join(',')) : opts.seed);
  const nch = Math.min(2, Math.max(...usable.map(u => u.channels.length)));

  // First pass: lay out times in samples.
  const plan = [];
  let cursor = 0;
  usable.forEach(it => {
    const repeats = Math.max(1, it.repeats | 0 || 1);
    const len = it.channels[0].length;
    const start = cursor;
    const placements = [];
    for (let r = 0; r < repeats; r++){
      placements.push(cursor);
      cursor += len;
      if (r < repeats - 1) cursor += Math.round(beat * rate);
    }
    const gap = Math.round((gapMs / 1000) * (1 + (rand() * 2 - 1) * jitter) * rate);
    cursor += gap;
    plan.push({ it, start, end: cursor, placements });
  });

  const total = cursor;
  const out = [];
  for (let c = 0; c < nch; c++) out.push(new Float32Array(total));
  plan.forEach(p => {
    p.placements.forEach(at => {
      for (let c = 0; c < nch; c++){
        const src = p.it.channels[Math.min(c, p.it.channels.length - 1)];
        out[c].set(src, at);
      }
    });
  });
  return {
    channels: out,
    sampleRate: rate,
    length: total,
    duration: total / rate,
    cues: plan.map(p => ({ index: p.it.index, start: p.start / rate, end: p.end / rate })),
  };
}

/* Where in the pass is `t` seconds after the pass started, and which line is
   being spoken. `t` may be any size: the pass loops. */
function voiceTrackPosition(track, t){
  if (!track || !track.duration) return { pos: 0, cue: null, cueIndex: -1 };
  const pos = ((t % track.duration) + track.duration) % track.duration;
  let cueIndex = track.cues.findIndex(c => pos >= c.start && pos < c.end);
  if (cueIndex < 0) cueIndex = track.cues.length - 1;
  return { pos, cue: track.cues[cueIndex], cueIndex };
}

/* Turn a rendered track into an AudioBuffer on `ctx` (an AudioBuffer made for
   one context plays on any other, but building it from plain arrays keeps
   nothing tied to a context that has since been closed). */
function voiceTrackToBuffer(ctx, track){
  const buf = ctx.createBuffer(track.channels.length, track.length, track.sampleRate);
  track.channels.forEach((data, c) => {
    if (buf.copyToChannel) buf.copyToChannel(data, c, 0);
    else buf.getChannelData(c).set(data);
  });
  return buf;
}

/* Copy the samples out of a decoded AudioBuffer so they outlive its context. */
function voiceClipFromBuffer(buffer){
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(Float32Array.from(buffer.getChannelData(c)));
  return { channels, sampleRate: buffer.sampleRate, duration: buffer.duration };
}

/* A recording that decodes to (near) silence is a failed recording, not a quiet
   one. Peak and RMS over the whole clip. */
function measureClipLevel(clip){
  let peak = 0, sum = 0, n = 0;
  (clip.channels || []).forEach(data => {
    for (let i = 0; i < data.length; i++){ const v = Math.abs(data[i]); if (v > peak) peak = v; sum += v * v; n++; }
  });
  return { peak, rms: n ? Math.sqrt(sum / n) : 0, seconds: clip.sampleRate ? ((clip.channels[0] || []).length / clip.sampleRate) : 0 };
}

if (typeof module !== 'undefined' && module.exports){
  module.exports = { renderVoiceTrack, voiceTrackPosition, voiceTrackToBuffer, voiceClipFromBuffer, measureClipLevel, voiceTrackRandom };
}
