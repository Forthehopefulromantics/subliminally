/* visualize-player.js — Enter the scene

   Part of Subliminally; loaded after js/visualize.js. Plays one saved
   visualization: Serenity's narration with an optional frequency (and theta
   wave) and optional nature sounds underneath, as three independent layers on
   one audio context, each with its own volume.

   WHAT THIS FILE MUST NEVER DO is ask for narration. There is no call to
   /api/visualization here, no call to /api/tts, and nothing that could reach
   them: the narration is a file that already exists, fetched from storage by a
   signed link, and everything else in this player — pausing, starting over,
   retuning a layer, moving a fader — is the browser mixing sound. That is what
   makes "replay" and "change the nature sound" free.

   iOS: the context, the media element and the first play() all happen inside
   the tap that opened the player (open() is synchronous up to play()), and the
   mix is routed through audioOut() from js/builder.js — the same output path the
   subliminal player uses, which is what makes sound come out with the ring/silent
   switch on silent and keeps it going when the screen locks. */
(function(){
'use strict';

const THETA_HZ = { delta: 2, theta: 6, alpha: 10 };
const FREQ_SCALE = 0.12;       // 100% on the frequency fader: a tone sits well under a voice
const DEFAULT_CARRIER = 200;   // a theta wave with no frequency chosen needs something to ride on
const LAYER_FADE_IN = 3;
const LAYER_FADE_OUT = 6;

const P = {
  open: false, row: null, ctx: null, master: null, out: null,
  el: null, narrGain: null, narrSource: null,
  freqGain: null, voice: null, applied: { hz: undefined, theta: undefined },
  natureGain: null, bed: null, appliedNature: undefined,
  playing: false, ended: false, loading: false, url: null, resolveUrl: null,
  timer: null, seeking: false,
};

const $ = (id) => document.getElementById(id);
const fmt = (sec) => { sec = Math.max(0, Math.floor(Number(sec) || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ICON = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4h4"/>',
  sound: '<path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M17 9c1.4 1.6 1.4 4.4 0 6"/>',
};
const svg = (n, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra || ''}>${ICON[n]}</svg>`;

/* ---------------------------------------------------------------- the screen */
/* A <div>, deliberately: index.html hides every <section> that is not the current
   page (body[data-view] > nav ~ section:not(#...)), and a player that is a section
   would be hidden along with them. */
function mountUi(){
  if ($('vzPlayer')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="vz-player" id="vzPlayer" aria-hidden="true" aria-label="Visualization player" role="dialog" aria-modal="true">
      <div class="vz-sky" aria-hidden="true"><div class="stars" id="vzStars"></div><div class="vz-orb"></div><div class="vz-haze a"></div><div class="vz-haze b"></div></div>
      <div class="vz-shell">
        <div class="vz-top">
          <button class="vz-iconbtn" type="button" data-vz="close" aria-label="Close">${svg('close')}</button>
          <span class="vz-kicker">Visualization</span>
          <span style="width:46px" aria-hidden="true"></span>
        </div>
        <div class="vz-stage">
          <div class="vz-art breathing" id="vzArt"><img id="vzCover" alt="" hidden></div>
          <div><h2 class="vz-name" id="vzName"></h2><div class="vz-by">Narrated by Serenity</div></div>
        </div>
        <div class="vz-lower">
          <div class="vz-status" id="vzStatus" role="status"></div>
          <div>
            <div class="vz-track" id="vzTrack" role="slider" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="vz-fill" id="vzFill"></div></div>
            <div class="vz-times"><span id="vzElapsed">0:00</span><span id="vzRemain">−0:00</span></div>
          </div>
          <div class="vz-controls">
            <button class="vz-side" type="button" data-vz="restart">${svg('replay')}<span>Start over</span></button>
            <button class="vz-play" type="button" id="vzPlay" data-vz="toggle" aria-label="Play">${svg('play')}</button>
            <button class="vz-side" type="button" data-vz="layers">${svg('sound')}<span>Sound layers</span></button>
          </div>
        </div>
      </div>
    </div>
    <div class="vz-sheet" id="vzSheet" role="dialog" aria-modal="true" aria-label="Adjust sound layers">
      <div class="vz-sheet-panel">
        <div class="vz-sheet-head"><h3>Adjust sound layers</h3><button class="vz-iconbtn" type="button" data-vz="sheet-close" aria-label="Close">${svg('close')}</button></div>
        <p class="viz-hint" style="margin:-4px 0 12px">Serenity, the frequency and the nature sounds are separate layers. Changing them here is instant and never uses another narration.</p>
        <div id="vzSheetBody"></div>
      </div>
    </div>`);
  paintStars();
  const sheet = $('vzSheet');
  $('vzPlayer').addEventListener('click', onClick);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); else onClick(e); });
  const track = $('vzTrack');
  track.addEventListener('click', (e) => { const r = track.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width); });
  track.addEventListener('keydown', (e) => {
    if (!P.el) return;
    if (e.key === 'ArrowRight') seekBy(10); else if (e.key === 'ArrowLeft') seekBy(-10);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && P.open) { if ($('vzSheet').classList.contains('open')) closeSheet(); else close(); } });
}

/* The same handful of twinkling stars as the page's own night sky, dealt from a
   fixed seed so they land in the same places every time. Only visible at night:
   the .stars layer takes its opacity from the sky's --star token. */
function paintStars(){
  const box = $('vzStars'); if (!box) return;
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  box.innerHTML = Array.from({ length: 36 }, () => {
    const d = 1.4 + rnd() * 2.2;
    return `<i style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 78).toFixed(1)}%;width:${d}px;height:${d}px;animation:twinkle ${(2.6 + rnd() * 3.4).toFixed(1)}s ease-in-out ${(rnd() * 4).toFixed(1)}s infinite"></i>`;
  }).join('');
}

function onClick(e){
  const t = e.target.closest('[data-vz]');
  if (!t) return;
  switch (t.dataset.vz){
    case 'close': close(); break;
    case 'toggle': toggle(); break;
    case 'restart': restart(); break;
    case 'layers': openSheet(); break;
    case 'sheet-close': closeSheet(); break;
  }
}

function setStatus(text, isError){
  const el = $('vzStatus'); if (!el) return;
  el.textContent = text || ''; el.classList.toggle('err', !!isError);
}
function paintPlay(){
  const b = $('vzPlay'); if (!b) return;
  if (P.loading){ b.innerHTML = '<span class="viz-spin"></span>'; b.setAttribute('aria-label', 'Loading'); return; }
  const name = P.ended ? 'replay' : P.playing ? 'pause' : 'play';
  b.innerHTML = svg(name);
  b.setAttribute('aria-label', P.ended ? 'Play again' : P.playing ? 'Pause' : 'Play');
}
function paintProgress(){
  if (!P.el) return;
  const dur = duration(), cur = P.el.currentTime || 0;
  const frac = dur ? Math.min(1, cur / dur) : 0;
  const fill = $('vzFill'); if (fill) fill.style.width = `${frac * 100}%`;
  const track = $('vzTrack'); if (track) track.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  const e = $('vzElapsed'), r = $('vzRemain');
  if (e) e.textContent = fmt(cur);
  if (r) r.textContent = `−${fmt(Math.max(0, dur - cur))}`;
}
function duration(){
  const d = P.el && P.el.duration;
  if (Number.isFinite(d) && d > 0) return d;
  return Number(P.row && P.row.narration_duration_seconds) || 0;
}

/* ---------------------------------------------------------------- the audio graph */
function buildGraph(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  P.ctx = new Ctx();
  P.ctx.resume && P.ctx.resume().catch(() => {});
  P.master = P.ctx.createGain();
  P.master.gain.value = 1;
  P.out = typeof audioOut === 'function' ? audioOut(P.ctx) : P.ctx.destination;
  P.master.connect(P.out);

  // Layer 1: Serenity — the saved file, through its own fader.
  P.el = new Audio();
  P.el.crossOrigin = 'anonymous';
  P.el.preload = 'auto';
  P.el.setAttribute('playsinline', '');
  P.narrGain = P.ctx.createGain();
  try {
    P.narrSource = P.ctx.createMediaElementSource(P.el);
    P.narrSource.connect(P.narrGain).connect(P.master);
  } catch (e){
    // No routing through the graph: the element plays straight, and its own volume is the fader.
    console.warn('narration could not be routed through the mixer:', e);
    P.narrSource = null;
  }
  P.el.addEventListener('ended', onEnded);
  P.el.addEventListener('error', onMediaError);
  P.el.addEventListener('waiting', () => { if (P.playing){ P.loading = true; paintPlay(); } });
  ['playing', 'canplay'].forEach((ev) => P.el.addEventListener(ev, () => { if (P.loading){ P.loading = false; paintPlay(); } }));
  P.el.addEventListener('loadedmetadata', paintProgress);

  // Layer 2: frequency / theta wave. Layer 3: nature sounds. Each is a gain node
  // that is the fader, with the sound itself behind it.
  P.freqGain = P.ctx.createGain(); P.freqGain.connect(P.master);
  P.natureGain = P.ctx.createGain(); P.natureGain.connect(P.master);
  if (typeof AmbienceBed === 'function'){
    P.bed = new AmbienceBed('visualization', 'visualization');
    P.bed.attach(P.ctx, P.natureGain);
  }
  P.applied = { hz: undefined, theta: undefined };
  P.appliedNature = undefined;
}

function setGain(node, value){
  if (!node || !P.ctx) return;
  const t = P.ctx.currentTime;
  try { node.gain.cancelScheduledValues(t); node.gain.setTargetAtTime(value, t, 0.03); } catch (e){ node.gain.value = value; }
}

/* A fresh tone: a single steady sine with a slow shimmer from a second one a hair
   off pitch, or — with a theta wave chosen — a different pitch in each ear, so the
   brain hears the difference as a pulse. Faded in, and the previous tone faded
   out underneath it, so changing the setting is never a click. */
function buildTone(hz, theta){
  const ctx = P.ctx;
  const voice = { gain: ctx.createGain(), nodes: [] };
  voice.gain.gain.value = 0;
  voice.gain.connect(P.freqGain);
  const osc = (freq, level, dest, input) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = level;
    o.connect(g);
    if (input != null) g.connect(dest, 0, input); else g.connect(dest);
    o.start(); voice.nodes.push(o, g);
  };
  if (theta && theta !== 'off'){
    const carrier = hz || DEFAULT_CARRIER;
    const merger = ctx.createChannelMerger(2);
    merger.connect(voice.gain); voice.nodes.push(merger);
    osc(carrier, 1, merger, 0);
    osc(carrier + (THETA_HZ[theta] || 6), 1, merger, 1);
  } else {
    osc(hz, 0.5, voice.gain);
    osc(hz * 1.002, 0.5, voice.gain);
  }
  const now = ctx.currentTime;
  try { voice.gain.gain.setValueAtTime(0, now); voice.gain.gain.linearRampToValueAtTime(1, now + LAYER_FADE_IN); } catch (e){ voice.gain.gain.value = 1; }
  return voice;
}
function retireTone(voice, seconds){
  if (!voice) return;
  const ctx = P.ctx;
  const stopAt = (ctx ? ctx.currentTime : 0) + seconds + 0.05;
  try {
    const g = voice.gain.gain; const now = ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + seconds);
    voice.nodes.forEach((n) => { if (n.stop) { try { n.stop(stopAt); } catch (e){} } });
  } catch (e){ /* the context is going away; nothing to tidy */ }
  setTimeout(() => { voice.nodes.forEach((n) => { try { n.disconnect(); } catch (e){} }); try { voice.gain.disconnect(); } catch (e){} }, (seconds + 0.3) * 1000);
}

/* Bring the live layers into line with the saved settings. Only what changed is
   touched: a volume is a gain value, a different frequency or theta wave is a new
   tone, a different nature sound is a crossfade on the ambience bed. */
function applyRow(row, opts){
  if (!P.ctx || !row) return;
  const o = opts || {};
  setGain(P.narrGain, (Number(row.narration_volume) || 0) / 100);
  if (!P.narrSource && P.el) P.el.volume = (Number(row.narration_volume) || 0) / 100;
  setGain(P.freqGain, (Number(row.frequency_volume) || 0) / 100 * FREQ_SCALE);
  setGain(P.natureGain, (Number(row.nature_volume) || 0) / 100);

  const hz = row.frequency_hz ? Number(row.frequency_hz) : null;
  const theta = row.theta_wave || 'off';
  const wantsTone = !!hz || theta !== 'off';
  if (P.applied.hz !== hz || P.applied.theta !== theta || o.restartLayers){
    retireTone(P.voice, 0.6); P.voice = null;
    if (wantsTone && !P.ended) P.voice = buildTone(hz, theta);
    P.applied = { hz, theta };
  }
  const nature = row.nature_sound && row.nature_sound !== 'none' ? row.nature_sound : 'none';
  if (P.bed && (P.appliedNature !== nature || o.restartLayers)){
    P.appliedNature = nature;
    if (P.ended) P.bed.to('none', { fade: 0.2 }); else P.bed.to(nature, { fade: 1.6 });
  }
}

/* ---------------------------------------------------------------- transport */
function playNarration(){
  if (!P.el || !P.url) return Promise.resolve(false);
  P.ctx.resume && P.ctx.resume().catch(() => {});
  const p = P.el.play();
  if (p && p.then) return p.then(() => true).catch((e) => { console.warn('play() was refused:', e && e.name); return false; });
  return Promise.resolve(true);
}

async function startPlayback(){
  P.loading = true; paintPlay(); setStatus('');
  const ok = await playNarration();
  P.loading = false;
  if (ok){ P.playing = true; P.ended = false; setStatus(''); }
  else if (!P.el.error){ P.playing = false; setStatus('Tap play to begin.'); }
  paintPlay();
}

function toggle(){
  if (!P.open) return;
  if (P.ended){ restart(); return; }
  if (P.playing) pause(); else resume();
}
function pause(){
  if (!P.el) return;
  P.el.pause();
  P.playing = false;
  if (P.ctx && P.ctx.state === 'running') P.ctx.suspend().catch(() => {});
  paintPlay();
}
function resume(){
  if (!P.el) return;
  if (!P.url){ setStatus('Still loading your narration…'); return; }
  P.ctx.resume && P.ctx.resume().catch(() => {});
  if (P.el.error) return reloadNarration();
  startPlayback();
}
async function reloadNarration(){
  setStatus('Reconnecting…');
  try {
    const url = P.resolveUrl ? await P.resolveUrl() : null;
    if (!url) throw new Error('no link');
    setUrl(url, true);
  } catch (e){
    setStatus('We couldn’t load the narration. Check your connection and tap play to try again.', true);
  }
}
function restart(){
  if (!P.el || !P.url) return;
  const wasEnded = P.ended;
  P.el.currentTime = 0;
  P.ended = false;
  if (wasEnded) applyRow(window.Viz.current(), { restartLayers: true });
  P.ctx.resume && P.ctx.resume().catch(() => {});
  startPlayback();
  paintProgress();
}
function seekTo(frac){
  if (!P.el || !duration()) return;
  P.el.currentTime = Math.max(0, Math.min(1, frac)) * duration();
  if (P.ended){ P.ended = false; applyRow(window.Viz.current(), { restartLayers: true }); resume(); }
  paintProgress();
}
function seekBy(sec){
  if (!P.el) return;
  P.el.currentTime = Math.max(0, Math.min(duration(), (P.el.currentTime || 0) + sec));
  paintProgress();
}

/* The story is over. The frequency and the nature sounds fade out over a few
   seconds rather than stopping, and the player rests on a replay button. */
function onEnded(){
  P.playing = false; P.ended = true;
  retireTone(P.voice, LAYER_FADE_OUT); P.voice = null; P.applied = { hz: undefined, theta: undefined };
  if (P.bed){ P.bed.stop({ fade: LAYER_FADE_OUT }); P.appliedNature = undefined; }
  paintPlay(); paintProgress();
  setStatus('');
}
function onMediaError(){
  P.playing = false; P.loading = false;
  paintPlay();
  // A signed link can expire while a player sits open; get a fresh one before giving up.
  if (P.resolveUrl && !P.retriedLink){ P.retriedLink = true; reloadNarration(); return; }
  setStatus('We couldn’t load the narration. Check your connection and tap play to try again.', true);
}

/* A link for the narration, at open time or after it. The element is pointed at
   it, and plays at once if the person is already waiting. */
function setUrl(url, autoplay){
  if (!P.el || !url) return;
  const resumeAt = P.url && P.el.currentTime ? P.el.currentTime : 0;
  const wait = !P.url || autoplay;
  P.url = url;
  P.el.src = url;
  P.el.load && P.el.load();
  if (resumeAt){ P.el.addEventListener('loadedmetadata', function once(){ P.el.removeEventListener('loadedmetadata', once); try { P.el.currentTime = resumeAt; } catch (e){} }); }
  if (wait) startPlayback();
}

/* ---------------------------------------------------------------- the sheet */
function openSheet(){
  const body = $('vzSheetBody'); if (!body || !window.Viz) return;
  body.innerHTML = window.Viz.layersHtml();
  window.Viz.syncLayerInputs();
  $('vzSheet').classList.add('open');
}
function closeSheet(){ const s = $('vzSheet'); if (s) s.classList.remove('open'); }

/* ---------------------------------------------------------------- open / close */
function setCover(url){
  const img = $('vzCover'); if (!img) return;
  if (url){ img.src = url; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
}

function mediaSession(row, coverUrl){
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: row.title || 'Visualization', artist: 'Serenity · Subliminally',
      artwork: coverUrl ? [{ src: new URL(coverUrl, location.href).href, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => { if (!P.playing) resume(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (P.playing) pause(); });
  } catch (e){ /* a lock-screen nicety, never a failure */ }
}

/* Called from the tap on "Enter the scene". Everything up to play() is
   synchronous on purpose. */
function open(row, opts){
  const o = opts || {};
  if (P.open) teardown(true);
  // One thing playing at a time: a subliminal that is running yields to the story.
  try { if (typeof finalPlaying !== 'undefined' && finalPlaying && typeof stopFinal === 'function') stopFinal(); } catch (e){}
  mountUi();
  P.open = true; P.row = row; P.ended = false; P.playing = false; P.url = null; P.retriedLink = false;
  P.resolveUrl = o.resolveUrl || null;
  document.body.classList.add('viz-player-open');
  const el = $('vzPlayer'); el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
  $('vzName').textContent = row.title || 'Your visualization';
  setCover(o.coverUrl || null);
  setStatus('');
  paintProgress();

  buildGraph();
  applyRow(row);
  mediaSession(row, o.coverUrl);
  clearInterval(P.timer); P.timer = setInterval(paintProgress, 250);

  if (o.url) setUrl(o.url, true);
  else { P.loading = true; setStatus('Preparing your narration…'); }
  paintPlay();
  const closeBtn = el.querySelector('[data-vz="close"]'); if (closeBtn) closeBtn.focus({ preventScroll: true });
}

function teardown(keepUi){
  clearInterval(P.timer); P.timer = null;
  if (P.el){ try { P.el.pause(); } catch (e){} P.el.removeAttribute('src'); try { P.el.load(); } catch (e){} }
  if (P.voice){ retireTone(P.voice, 0.05); P.voice = null; }
  if (P.bed){
    try { P.bed.detach(); } catch (e){}
    // The ambience module keeps every bed it ever made; this one is finished with.
    try { if (typeof ambienceBeds !== 'undefined') ambienceBeds.delete(P.bed); } catch (e){}
    P.bed = null;
  }
  if (P.ctx){
    try { if (typeof closeAudioOut === 'function') closeAudioOut(P.ctx); } catch (e){}
    try { P.ctx.close(); } catch (e){}
  }
  Object.assign(P, { ctx: null, master: null, out: null, el: null, narrGain: null, narrSource: null, freqGain: null, natureGain: null,
    playing: false, ended: false, loading: false, url: null });
  if ('mediaSession' in navigator){ try { navigator.mediaSession.metadata = null; } catch (e){} }
  if (!keepUi){
    P.open = false; P.row = null;
    const el = $('vzPlayer'); if (el){ el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }
    closeSheet();
    document.body.classList.remove('viz-player-open');
  }
}
function close(){ teardown(false); }

window.VizPlayer = {
  open, close,
  isOpen: () => P.open,
  apply: (row) => { if (P.open){ P.row = row; applyRow(row); } },
  setUrl: (u) => setUrl(u, true),
  setCover,
  /* for scripts/visualization-e2e.cjs */
  _state: P,
};
})();
