/* ambience.js — the ambience library, and the one thing allowed to play it

   Part of Subliminally. A plain script, loaded before builder.js: they share
   one global scope, which is what lets the inline onclick handlers in
   index.html keep working, and what lets each file see the ones loaded before
   it. Order matters — see index.html.

   WHAT THIS IS FOR

   Ambience is a *shelf*, not a product of anybody's session. The five tracks
   below are recorded once, stored once, and handed to everybody. Nothing here
   generates audio for a person, so nothing here can reach ElevenLabs — there
   is no code path from an ambience control to /api/tts, and that is the point
   of the file existing separately from the voice.

   That separation is the whole design. A session is three independent things:

     1. the affirmation voice   — generated once, per person, and cached
     2. the ambience            — a shared recording, looped
     3. the frequency layer     — synthesized live, costs nothing

   Changing (2) or (3), or how long the session runs, must never touch (1).
   They are separate graphs with separate lifetimes, and the ambience bed below
   owns exactly one of them.

   THE SHORT CLIPS AND THE LONG NIGHT

   The masters are eight to twenty-seven seconds long and a session can run for
   eight hours. There are no eight-hour files and there never will be; the clip
   loops instead. Two things make that inaudible:

     * The seam is dealt with before the file ships. scripts/prepare-ambience.js
       folds each clip's head onto its own tail, so the master ends on exactly
       the material it begins with and can be played end-to-end forever.
     * The loop itself is left to `AudioBufferSourceNode.loop`, which runs in
       the audio thread. No timer schedules the next repeat, so a backgrounded
       tab — where setInterval is throttled to once a minute — cannot starve
       it. Eight hours of ambience costs no JavaScript at all after the first
       second.

   What the browser still gets wrong is the two ends: an mp3 decodes with a
   few milliseconds of encoder padding on the front and back, and different
   browsers strip different amounts of it. Left alone that padding is a tick
   every time round. So the loop points are measured off the decoded audio
   rather than assumed — see loopWindow(). */

/* ---------------- the library ---------------- */

/* The recorded tracks. `key` is what gets written to state.bg and saved on the
   subliminal row, so it is permanent: renaming one renames it for everybody
   who already chose it. `name` and `category` are what people read, and can
   change freely.

   `file` is the fallback copy that ships with the site. The real source is
   whatever the ambience_tracks table says (see ambienceUrl) — this is what
   plays before that query comes back, and if it never does. */
const AMBIENCE_TRACKS = [
  { key:'deep-mind',       name:'Deep Mind',       category:'Meditation', ic:'◍', file:'deep-mind.mp3',
    blurb:'A low, even field to settle into.' },
  { key:'the-sanctuary',   name:'The Sanctuary',   category:'Ambient',    ic:'✦', file:'the-sanctuary.mp3',
    blurb:'Wide and slow, like a room with height to it.' },
  { key:'ocean-escape',    name:'Ocean Escape',    category:'Nature',     ic:'🌊', file:'ocean-escape.mp3',
    blurb:'Waves arriving, over and over.' },
  { key:'soft-asmr',       name:'Soft ASMR',       category:'Sleep',      ic:'☾', file:'soft-asmr.mp3',
    blurb:'Close, quiet texture for falling asleep to.' },
  { key:'inner-stillness', name:'Inner Stillness', category:'Meditation', ic:'◌', file:'inner-stillness.mp3',
    blurb:'A held tone that asks nothing of you.' },
];

/* The originals: made by the browser out of filtered noise and oscillators, no
   file involved. They stay. Anybody whose saved subliminal says 'rain' still
   gets rain, and they cost nothing to keep — see buildAmbience() in builder.js,
   which is still the only thing that knows how to make them. */
const AMBIENCE_SYNTH = [
  { key:'rain',      name:'Rain',          category:'Generated', ic:'🌧' },
  { key:'ocean',     name:'Ocean',         category:'Generated', ic:'🌊' },
  { key:'waterfall', name:'Waterfall',     category:'Generated', ic:'💧' },
  { key:'forest',    name:'Wind & forest', category:'Generated', ic:'🌲' },
  { key:'birds',     name:'Birds',         category:'Generated', ic:'🐦' },
  { key:'thunder',   name:'Distant storm', category:'Generated', ic:'⛈' },
  { key:'brown',     name:'Brown noise',   category:'Generated', ic:'▮' },
];

const AMBIENCE_NONE = { key:'none', name:'None', category:'', ic:'—' };

/* Every key that means something, in one map, so a lookup never has to know
   which kind it is asking about. */
const AMBIENCE_BY_KEY = (() => {
  const m = new Map();
  [AMBIENCE_NONE, ...AMBIENCE_TRACKS, ...AMBIENCE_SYNTH].forEach((t) => m.set(t.key, t));
  return m;
})();

function ambienceTrack(key){ return AMBIENCE_BY_KEY.get(key) || null; }
function ambienceName(key){ const t = ambienceTrack(key); return t ? t.name : 'None'; }
function isRecordedAmbience(key){ return AMBIENCE_TRACKS.some((t) => t.key === key); }

/* The order the selector draws them in: the recorded library first, grouped by
   what kind of quiet it is, then the generated ones, then None. */
function ambienceSections(){
  const order = ['Meditation', 'Ambient', 'Nature', 'Sleep'];
  const sections = order
    .map((category) => ({ category, tracks: AMBIENCE_TRACKS.filter((t) => t.category === category) }))
    .filter((s) => s.tracks.length);
  sections.push({ category: 'Generated in your browser', tracks: AMBIENCE_SYNTH });
  sections.push({ category: 'No ambience', tracks: [AMBIENCE_NONE] });
  return sections;
}

/* ---------------- where the audio actually lives ----------------

   Supabase first, the bundled copy second. boot.js reads ambience_tracks on
   load and fills window.AMBIENCE_URLS; that query is asynchronous and the
   selector is on screen before it lands, so nothing may depend on it having
   arrived. Resolving the URL at the moment of play rather than at render is
   what makes both true at once. */
const AMBIENCE_LOCAL_DIR = 'audio/ambience/';

function ambienceUrl(key){
  const stored = window.AMBIENCE_URLS && window.AMBIENCE_URLS[key];
  if (stored) return stored;
  const track = ambienceTrack(key);
  return track && track.file ? AMBIENCE_LOCAL_DIR + track.file : null;
}

/* ---------------- fetching and decoding, once ----------------

   Two caches, because they cache different things. The bytes are the download
   and are worth keeping for the life of the page: switching back to a track
   you heard a minute ago should be instant. The decoded buffer belongs to one
   AudioContext, and the player opens a fresh context per session, so it is
   kept on the context itself and goes when the context does.

   decodeAudioData detaches the ArrayBuffer it is given, which is why the cache
   hands out a slice() and never the original — the second decode of a cached
   track would otherwise be handed an empty buffer. */
const ambienceBytes = new Map();   // url -> Promise<ArrayBuffer>

function ambienceFetch(url){
  if (!ambienceBytes.has(url)){
    ambienceBytes.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`ambience ${url} — ${r.status}`);
      return r.arrayBuffer();
    }).catch((e) => { ambienceBytes.delete(url); throw e; }));
  }
  return ambienceBytes.get(url);
}

function ambienceDecode(ctx, url){
  if (!ctx.__ambienceBuffers) ctx.__ambienceBuffers = new Map();
  const cache = ctx.__ambienceBuffers;
  if (!cache.has(url)){
    cache.set(url, ambienceFetch(url).then((bytes) => new Promise((resolve, reject) => {
      // The callback form, not the promise form: older Safari only has that one.
      const done = ctx.decodeAudioData(bytes.slice(0), resolve, reject);
      if (done && done.then) done.then(resolve, reject);
    })).then((buffer) => ({ buffer, ...analyseAmbience(buffer) }))
      .catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}

/* ---------------- what the decoded audio turns out to be ----------------

   Two measurements, both taken once per track per context.

   loopWindow: where the music actually starts and stops inside the decoded
   buffer. An mp3 decodes with encoder padding at both ends and browsers
   disagree about how much of it to hand back, so looping the whole buffer puts
   a few milliseconds of silence into every repeat — which at eight seconds a
   loop is a tick every eight seconds, all night. The scan is bounded: only the
   first and last quarter-second can be padding, and a master that genuinely
   opens quietly must not be cut into.

   gain: the level safety net. The masters are normalised to the same loudness
   by scripts/prepare-ambience.js, so this should come out near 1.0 for all of
   them and does. It exists for the track nobody normalised — one uploaded
   straight into ambience_tracks later, from a phone, at whatever level it
   happened to be — so that switching to it is a change of scene and not a
   fright at two in the morning. */
const AMBIENCE_TARGET_RMS = 0.072;     // where the five masters already sit
const AMBIENCE_SILENCE = 0.0008;       // about -62 dBFS: padding, not content
const AMBIENCE_EDGE_SCAN = 0.25;       // seconds of each end that may be padding
const AMBIENCE_GAIN_RANGE = [0.15, 6]; // how far the safety net may ever reach

function analyseAmbience(buffer){
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const frames = buffer.length;
  const rate = buffer.sampleRate;
  const edge = Math.min(Math.floor(rate * AMBIENCE_EDGE_SCAN), Math.floor(frames / 4));

  const loud = (i) => {
    let peak = 0;
    for (let c = 0; c < channels.length; c++){
      const v = Math.abs(channels[c][i]);
      if (v > peak) peak = v;
    }
    return peak;
  };

  let first = 0;
  while (first < edge && loud(first) < AMBIENCE_SILENCE) first++;
  let last = frames - 1;
  const floor = frames - 1 - edge;
  while (last > floor && loud(last) < AMBIENCE_SILENCE) last--;
  if (last <= first){ first = 0; last = frames - 1; }

  /* Root-mean-square over the loop region, every fourth frame of the first
      channel. A quarter of twenty-seven seconds is still three hundred thousand
      samples — far more than enough to know how loud something is, and quick
      enough that it does not show up as a pause before the audio starts. */
  let sum = 0, n = 0;
  for (let i = first; i <= last; i += 4){ const v = channels[0][i]; sum += v * v; n++; }
  const rms = n ? Math.sqrt(sum / n) : 0;
  let gain = rms > 0 ? AMBIENCE_TARGET_RMS / rms : 1;
  gain = Math.min(AMBIENCE_GAIN_RANGE[1], Math.max(AMBIENCE_GAIN_RANGE[0], gain));

  return { loopStart: first / rate, loopEnd: (last + 1) / rate, gain, rms };
}

/* ---------------- fades ----------------

   Equal power, not linear. Two different recordings are uncorrelated, so their
   powers add rather than their amplitudes: a straight-line crossfade between
   them loses about three decibels in the middle, which is heard as a dip at
   the exact moment you are meant to be hearing neither the dip nor the join.
   sqrt of a linear power blend keeps the total constant the whole way across. */
const AMBIENCE_FADE_SECONDS = 1.6;
const FADE_CURVE_POINTS = 64;

function fadeCurve(from, to){
  const curve = new Float32Array(FADE_CURVE_POINTS);
  for (let i = 0; i < FADE_CURVE_POINTS; i++){
    const t = i / (FADE_CURVE_POINTS - 1);
    curve[i] = Math.sqrt(from * from * (1 - t) + to * to * t);
  }
  return curve;
}

/* Where a fade has got to, worked out from the numbers rather than read off
   the node. A gain being automated by a curve reports its current value
   inconsistently across browsers, and getting this wrong means a track that is
   asked to fade out jumps to full volume first. */
function fadeValueNow(voice, now){
  const f = voice.fade;
  if (!f) return voice.gainNode.gain.value;
  if (now <= f.at) return f.from;
  if (now >= f.at + f.seconds) return f.to;
  const t = (now - f.at) / f.seconds;
  return Math.sqrt(f.from * f.from * (1 - t) + f.to * f.to * t);
}

function scheduleFade(voice, to, seconds, ctx){
  const now = ctx.currentTime;
  const from = fadeValueNow(voice, now);
  const g = voice.gainNode.gain;
  try { g.cancelScheduledValues(now); } catch(e){}
  if (seconds <= 0){
    try { g.setValueAtTime(to, now); } catch(e){}
    voice.fade = { at: now, seconds: 0, from: to, to };
    return;
  }
  try {
    g.setValueAtTime(from, now);
    g.setValueCurveAtTime(fadeCurve(from, to), now, seconds);
  } catch(e){
    // setValueCurveAtTime refuses if another curve is still running on this
    // param. Nothing here is worth failing a switch over; a straight line is
    // the wrong shape, not a broken one.
    try { g.setValueAtTime(from, now); g.linearRampToValueAtTime(to, now + seconds); } catch(e2){}
  }
  voice.fade = { at: now, seconds, from, to };
}

/* ---------------- one bed, one track ----------------

   ONLY ONE AMBIENCE PLAYS AT A TIME. That is enforced here rather than asked
   of callers, because the way it gets broken is never a caller deciding to
   play two — it is a switch landing while the previous track is still
   decoding, and the late one connecting itself on top. So:

     * every switch takes a token, and a decode that finishes holding a stale
       token throws its work away instead of connecting it;
     * the outgoing track is detached from `this.voice` before anything is
       awaited, so it cannot be reached again;
     * the outgoing track is *stopped*, at a time booked in the audio clock,
       not merely faded — a fade to zero still leaves a source running, and a
       source that is never stopped is a track that never ends;
     * and starting any bed stops every other one, so a preview and a session
       can never end up layered.

   A bed is not tied to one AudioContext. The player opens a fresh context for
   each session and closes it afterwards, so attach() is called again each
   time; the key the bed is on survives that, which is what lets a session
   start on the ambience that was chosen hours earlier. */
const ambienceBeds = new Set();

function AmbienceBed(role){
  this.role = role || 'bed';
  this.ctx = null;
  this.out = null;              // carries the mixer level
  this.destination = null;
  this.level = 1;
  this.key = 'none';
  this.voice = null;
  this.token = 0;
  this.onchange = null;         // called whenever what is audible changes
  ambienceBeds.add(this);
}

/* Point the bed at a context and somewhere to send audio. Safe to call again
   on a new context; the old graph belonged to a context that is being closed,
   so there is nothing to tear down. */
AmbienceBed.prototype.attach = function(ctx, destination){
  this.ctx = ctx;
  this.destination = destination || ctx.destination;
  this.out = ctx.createGain();
  this.out.gain.value = this.level;
  this.out.connect(this.destination);
  this.voice = null;
  return this;
};

/* The mixer position. Separate from the fade gain on purpose: dragging the
   slider mid-crossfade must not cancel the crossfade, and a crossfade must not
   undo where the slider was left. */
AmbienceBed.prototype.setLevel = function(level){
  this.level = Math.max(0, Math.min(1, Number(level) || 0));
  if (this.out) this.out.gain.value = this.level;
};

AmbienceBed.prototype.playing = function(){ return !!this.voice; };

/* THE ONE WAY THE AUDIBLE TRACK CHANGES.

   Returns a promise that settles when the new track is playing, but the
   answer — this.key — is written before anything is awaited, so a caller can
   repaint its highlight in the same tick as the tap. */
AmbienceBed.prototype.to = function(key, opts){
  const options = opts || {};
  const fade = options.fade == null ? AMBIENCE_FADE_SECONDS : options.fade;
  const token = ++this.token;

  this.key = key || 'none';
  const outgoing = this.voice;
  this.voice = null;
  if (outgoing) this.retire(outgoing, fade);

  if (!this.ctx || this.key === 'none'){
    if (this.onchange) this.onchange(this.key);
    return Promise.resolve(null);
  }
  ambienceBeds.forEach((bed) => { if (bed !== this) bed.stop({ fade: 0.25 }); });

  const started = isRecordedAmbience(this.key)
    ? this.startRecorded(this.key, fade, token)
    : this.startSynth(this.key, fade, token);

  if (this.onchange) this.onchange(this.key);
  return started;
};

AmbienceBed.prototype.startRecorded = function(key, fade, token){
  const url = ambienceUrl(key);
  if (!url) return Promise.resolve(null);
  const ctx = this.ctx;
  return ambienceDecode(ctx, url).then((clip) => {
    // Somebody switched again while this was downloading, or the session was
    // stopped and the context replaced. Either way this audio is no longer
    // wanted, and connecting it now is exactly how two tracks end up playing.
    if (token !== this.token || ctx !== this.ctx || !this.out) return null;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    const trim = ctx.createGain();
    trim.gain.value = clip.gain;

    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = true;
    src.loopStart = clip.loopStart;
    src.loopEnd = clip.loopEnd;
    src.connect(trim).connect(gainNode).connect(this.out);
    // Start inside the loop window, so the very first pass skips the same
    // padding every later pass does.
    src.start(0, clip.loopStart);

    const voice = { kind:'recorded', src, gainNode, trim, fade:null };
    this.voice = voice;
    scheduleFade(voice, 1, fade, ctx);
    return voice;
  }).catch((e) => {
    console.error('ambience could not be played:', key, e);
    return null;
  });
};

/* The generated backgrounds, through the same fade and the same one-at-a-time
   rule. buildAmbience lives in builder.js and is reached through the window on
   purpose: this file loads first, and at load time it does not exist yet. */
AmbienceBed.prototype.startSynth = function(key, fade, token){
  const ctx = this.ctx;
  const build = window.buildAmbience;
  if (typeof build !== 'function') return Promise.resolve(null);
  if (token !== this.token || !this.out) return Promise.resolve(null);
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(this.out);
  const node = build(ctx, key, gainNode);
  const voice = { kind:'synth', node, gainNode, fade:null };
  this.voice = voice;
  scheduleFade(voice, 1, fade, ctx);
  return Promise.resolve(voice);
};

/* Fade a track out and then genuinely end it. The stop is booked on the audio
   clock rather than a setTimeout: a backgrounded tab throttles timers, and a
   track whose stop is still queued behind a throttled timer is a track that is
   quietly still running under the new one. The disconnect afterwards is a
   timer, but by then the node is silent and stopped, so a late one costs
   nothing. */
AmbienceBed.prototype.retire = function(voice, fade){
  const ctx = this.ctx;
  if (!ctx){ hardStop(voice); return; }
  scheduleFade(voice, 0, fade, ctx);
  const endsAt = ctx.currentTime + fade + 0.05;
  if (voice.kind === 'recorded'){
    try { voice.src.stop(endsAt); } catch(e){ hardStop(voice); }
  }
  setTimeout(() => hardStop(voice), Math.max(0, fade + 0.3) * 1000);
};

function hardStop(voice){
  if (!voice || voice.stopped) return;
  voice.stopped = true;
  if (voice.kind === 'recorded'){
    try { voice.src.stop(); } catch(e){}
    try { voice.src.disconnect(); } catch(e){}
    try { voice.trim.disconnect(); } catch(e){}
  } else if (voice.node && voice.node.stop){
    try { voice.node.stop(); } catch(e){}
  }
  try { voice.gainNode.disconnect(); } catch(e){}
}

/* Silence the bed without forgetting which track it is on — a session that
   stops and is played again comes back on the same ambience. */
AmbienceBed.prototype.stop = function(opts){
  const options = opts || {};
  const fade = options.fade == null ? 0.4 : options.fade;
  this.token++;
  const voice = this.voice;
  this.voice = null;
  if (voice) this.retire(voice, fade);
  if (this.onchange) this.onchange(this.key);
};

/* The context is going away. Everything on it goes with it, immediately. */
AmbienceBed.prototype.detach = function(){
  this.token++;
  if (this.voice) hardStop(this.voice);
  this.voice = null;
  if (this.out){ try { this.out.disconnect(); } catch(e){} }
  this.out = null;
  this.ctx = null;
  this.destination = null;
};

/* ---------------- warming ----------------

   Downloading a twenty-seven second mp3 takes a moment, and the moment you do
   not want it to happen in is the one after somebody presses play. Called when
   the ambience step opens and when the final screen is prepared; failures are
   ignored, because this is an optimisation and the real fetch will report its
   own. */
function warmAmbience(key){
  if (!isRecordedAmbience(key)) return;
  const url = ambienceUrl(key);
  if (url) ambienceFetch(url).catch(() => {});
}

if (typeof window !== 'undefined'){
  window.AMBIENCE_TRACKS = AMBIENCE_TRACKS;
  window.AMBIENCE_SYNTH = AMBIENCE_SYNTH;
  window.AMBIENCE_NONE = AMBIENCE_NONE;
  window.AMBIENCE_FADE_SECONDS = AMBIENCE_FADE_SECONDS;
  window.AmbienceBed = AmbienceBed;
  window.ambienceTrack = ambienceTrack;
  window.ambienceName = ambienceName;
  window.ambienceUrl = ambienceUrl;
  window.ambienceSections = ambienceSections;
  window.isRecordedAmbience = isRecordedAmbience;
  window.warmAmbience = warmAmbience;
  window.analyseAmbience = analyseAmbience;
}
