/* Voice echo -- an independent, non-destructive echo on each affirmation layer.

   Two halves, kept apart so the first can be tested without an AudioContext:

     the model     per-layer settings { on, mix, delayMs } for 'voice' (the main
                   voice) and 'layerVoice' (the second, layered voice). Each
                   layer owns its own object; no setter ever touches another.
     the bus       EchoBus, the Web Audio side. One per layer per AudioContext:

                     clips -> input -+-> dry ----------------------+-> out
                                     +-> send -> delay -> tone -+--> wet -> out
                                                   ^            |
                                                   +- feedback -+

   Rules the bus holds:

     NON-DESTRUCTIVE  it only shapes what is playing. The generated or recorded
                      audio is never touched, so changing an echo never needs a
                      new voice recording.
     OFF IS DRY       off means dry = 1 and the send/wet/feedback gains = 0: the
                      voice goes through a unity gain and nothing else. The
                      delay line is fed nothing while off, so turning echo on
                      never replays an old tail.
     NO DUPLICATES    one bus per layer per context, found by layer name. Clips
                      connect to its input once; the wet signal only ever comes
                      out of the delay line.
     NO RUNAWAY       feedback is capped (MAX_FEEDBACK) and low-passed inside the
                      loop, so repeats get darker and quieter and cannot build.
                      The dry level makes room for the wet one, and the page's
                      output bus has the soft limiter as the last defence.
     NO CLICKS        every change glides (setTargetAtTime), including the delay
                      time, so dragging the sliders while a line plays is smooth.
     SAFARI           only DelayNode, GainNode and BiquadFilterNode, no
                      AudioWorklet, nothing outside webkitAudioContext's set. */
(function (root) {
  'use strict';

  const LAYERS = ['voice', 'layerVoice'];
  const LAYER_NAMES = { voice: 'Affirmations', layerVoice: 'Second voice' };
  const MIN_DELAY_MS = 100, MAX_DELAY_MS = 1000;
  const DEFAULT_MIX = 40, DEFAULT_DELAY_MS = 350;
  const MAX_FEEDBACK = 0.45;
  const GLIDE = 0.04;              // seconds; time constant of every parameter move
  const STORE_PREFIX = 'fthr_voice_echo:';

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

  function defaultLayer() { return { on: false, mix: DEFAULT_MIX, delayMs: DEFAULT_DELAY_MS }; }
  function normalizeLayer(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      on: r.on === true,
      mix: Math.round(clamp(num(r.mix, DEFAULT_MIX), 0, 100)),
      delayMs: Math.round(clamp(num(r.delayMs, DEFAULT_DELAY_MS), MIN_DELAY_MS, MAX_DELAY_MS)),
    };
  }
  /* Settings for every layer. Anything missing or malformed becomes the default
     (echo off); an unknown key is dropped. */
  function normalizeAll(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    LAYERS.forEach(l => { out[l] = normalizeLayer(r[l]); });
    return out;
  }

  /* The audio numbers for one layer's settings. Pure, so the headroom rules can
     be checked without a context. */
  function paramsFor(settings) {
    const s = normalizeLayer(settings);
    const m = s.mix / 100;
    if (!s.on) return { dry: 1, send: 0, wet: 0, feedback: 0, delaySec: s.delayMs / 1000 };
    return {
      dry: 1 - 0.3 * m,                                        // makes room for the echo
      send: 1,
      wet: 0.5 * m,
      feedback: Math.min(MAX_FEEDBACK, m * MAX_FEEDBACK),      // 0..0.45, hard-capped
      delaySec: s.delayMs / 1000,
    };
  }
  /* Worst-case gain of the wet path against the dry voice: the echo series
     wet * (1 + f + f^2 ...) is bounded by wet / (1 - f). */
  function peakGainEstimate(settings) {
    const p = paramsFor(settings);
    return p.dry + p.wet / (1 - p.feedback);
  }

  class EchoBus {
    constructor(ctx, layer, destinations) {
      this.ctx = ctx; this.layer = layer;
      this.input = ctx.createGain();
      this.out = ctx.createGain();
      this.dry = ctx.createGain();
      this.send = ctx.createGain();
      this.delay = ctx.createDelay(MAX_DELAY_MS / 1000 + 0.1);
      this.tone = ctx.createBiquadFilter();
      this.tone.type = 'lowpass'; this.tone.frequency.value = 3600; this.tone.Q.value = 0.5;
      this.feedback = ctx.createGain();
      this.wet = ctx.createGain();
      this.input.connect(this.dry); this.dry.connect(this.out);
      this.input.connect(this.send); this.send.connect(this.delay);
      this.delay.connect(this.tone);
      this.tone.connect(this.feedback); this.feedback.connect(this.delay);
      this.tone.connect(this.wet); this.wet.connect(this.out);
      (destinations || []).forEach(d => { if (d) this.out.connect(d); });
      this.dry.gain.value = 1; this.send.gain.value = 0;
      this.wet.gain.value = 0; this.feedback.gain.value = 0;
      this.delay.delayTime.value = DEFAULT_DELAY_MS / 1000;
    }
    apply(settings) {
      const p = paramsFor(settings), t = this.ctx.currentTime;
      const glide = (param, v) => {
        try { param.cancelScheduledValues(t); } catch (e) { /* ignore */ }
        try { param.setTargetAtTime(v, t, GLIDE); } catch (e) { param.value = v; }
      };
      glide(this.dry.gain, p.dry); glide(this.send.gain, p.send);
      glide(this.wet.gain, p.wet); glide(this.feedback.gain, p.feedback);
      glide(this.delay.delayTime, p.delaySec);
    }
    disconnect() {
      [this.input, this.dry, this.send, this.delay, this.tone, this.feedback, this.wet, this.out]
        .forEach(n => { try { n.disconnect(); } catch (e) { /* ignore */ } });
    }
  }

  /* ---- the store: the one place the settings live ---- */
  let settings = normalizeAll(null);
  let stamp = 0;                   // when they last changed; picks the newer of two saved copies
  const buses = new Map();         // layer -> EchoBus on the current context
  const listeners = new Set();

  function get(layer) { return Object.assign({}, settings[layer] || defaultLayer()); }
  function serialize() {
    const out = {};
    LAYERS.forEach(l => { out[l] = Object.assign({}, settings[l]); });
    out.ts = stamp;
    return out;
  }
  function paint() { listeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } }); }
  function applyLive(layer) {
    const bus = buses.get(layer);
    if (bus) bus.apply(settings[layer]);
  }
  /* The only mutation. Touches exactly one layer; every other layer's object is
     left as it was. */
  function set(layer, patch, opts) {
    if (!LAYERS.includes(layer)) return null;
    settings = Object.assign({}, settings, { [layer]: normalizeLayer(Object.assign({}, settings[layer], patch)) });
    stamp = Date.now();
    applyLive(layer);
    paint();
    if (!(opts && opts.silent)) persistChange();
    return get(layer);
  }
  /* Replace everything (opening a subliminal, a draft, a reset). `raw` may be
     nothing, which is the default: every echo off. */
  function load(raw) {
    settings = normalizeAll(raw);
    stamp = raw && Number.isFinite(Number(raw.ts)) ? Number(raw.ts) : 0;
    LAYERS.forEach(applyLive);
    paint();
  }
  function reset() { load(null); }

  /* ---- device copy: survives a refresh or a closed tab even when the account
     write has not landed yet. Newer of the two wins when a subliminal opens. */
  let storeKey = 'draft';
  function storage() { try { return root.localStorage || null; } catch (e) { return null; } }
  function persistChange() {
    const st = storage();
    if (st) { try { st.setItem(STORE_PREFIX + storeKey, JSON.stringify(serialize())); } catch (e) { /* ignore */ } }
    if (typeof root.queueMixSave === 'function') root.queueMixSave();
  }
  function readDevice(key) {
    const st = storage();
    if (!st) return null;
    try { return JSON.parse(st.getItem(STORE_PREFIX + key)); } catch (e) { return null; }
  }
  /* A subliminal opened: use whichever of the account copy and the device copy
     is newer. A subliminal with neither starts with echo off. */
  function open(id, accountCopy) {
    storeKey = id || 'draft';
    const device = id ? readDevice(id) : null;
    const a = accountCopy && typeof accountCopy === 'object' ? accountCopy : null;
    const pick = a && device ? (num(device.ts, 0) > num(a.ts, 0) ? device : a) : (a || device);
    load(pick);
  }

  /* ---- the audio side ---- */
  function busFor(ctx, layer, destinations) {
    if (!LAYERS.includes(layer)) layer = 'voice';
    let bus = buses.get(layer);
    if (bus && bus.ctx !== ctx) { bus.disconnect(); bus = null; }
    if (!bus) {
      bus = new EchoBus(ctx, layer, destinations);
      buses.set(layer, bus);
      bus.apply(settings[layer]);
    }
    return bus;
  }
  function release() { buses.forEach(b => b.disconnect()); buses.clear(); }
  function outputNodes() { return Array.from(buses.values()).map(b => b.out); }

  /* ---- controls: one block per layer, found by data attributes, so the same
     markup works in the player sheet, the sound editor and the builder. ---- */
  function controlsMarkup(layer) {
    const name = LAYER_NAMES[layer] || layer;
    return `<div class="echo-ctl" data-echo-layer="${layer}">
      <label class="echo-toggle"><input type="checkbox" role="switch" data-echo-field="on" aria-label="${name} echo"><span class="echo-track" aria-hidden="true"></span><span class="echo-name">Echo</span><span class="echo-state" data-echo-state></span></label>
      <div class="echo-sliders">
        <label class="echo-row"><span>Intensity</span><input type="range" min="0" max="100" step="1" data-echo-field="mix" aria-label="${name} echo intensity"><output data-echo-out="mix"></output></label>
        <label class="echo-row"><span>Delay</span><input type="range" min="${MIN_DELAY_MS}" max="${MAX_DELAY_MS}" step="10" data-echo-field="delayMs" aria-label="${name} echo delay in milliseconds"><output data-echo-out="delayMs"></output></label>
      </div>
    </div>`;
  }
  function paintControls() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-echo-layer]').forEach(box => {
      const s = settings[box.dataset.echoLayer];
      if (!s) return;
      box.classList.toggle('on', s.on);
      box.querySelectorAll('[data-echo-field]').forEach(el => {
        const v = s[el.dataset.echoField];
        if (el.type === 'checkbox') el.checked = v === true;
        else if (document.activeElement !== el) el.value = v;
        if (el.type === 'range') el.disabled = !s.on;
      });
      const st = box.querySelector('[data-echo-state]');
      if (st) st.textContent = s.on ? 'On' : 'Off';
      const mixOut = box.querySelector('[data-echo-out="mix"]');
      if (mixOut) mixOut.textContent = s.mix + '%';
      const delayOut = box.querySelector('[data-echo-out="delayMs"]');
      if (delayOut) delayOut.textContent = s.delayMs + ' ms';
    });
  }
  function onControl(ev) {
    const el = ev.target;
    if (!el || !el.dataset || !el.dataset.echoField) return;
    const box = el.closest('[data-echo-layer]');
    if (!box) return;
    const field = el.dataset.echoField;
    set(box.dataset.echoLayer, { [field]: field === 'on' ? el.checked : el.value });
  }
  /* The builder's own mixer carries empty hosts; fill them once the page is up. */
  function mountHosts() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-echo-host]').forEach(h => {
      if (!h.firstElementChild) h.innerHTML = controlsMarkup(h.dataset.echoHost);
    });
    paintControls();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountHosts);
    else mountHosts();
    listeners.add(paintControls);
    document.addEventListener('input', onControl);
    document.addEventListener('change', onControl);
  }

  const api = {
    LAYERS, LAYER_NAMES, MIN_DELAY_MS, MAX_DELAY_MS, DEFAULT_MIX, DEFAULT_DELAY_MS, MAX_FEEDBACK,
    defaultLayer, normalizeLayer, normalizeAll, paramsFor, peakGainEstimate,
    get, set, load, reset, open, serialize,
    EchoBus, busFor, release, outputNodes,
    controlsMarkup, paintControls, mountHosts, onChange: fn => listeners.add(fn),
  };
  root.VoiceEcho = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
