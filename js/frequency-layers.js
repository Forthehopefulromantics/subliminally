/* Frequency layers — up to four healing tones playing together.

   Two halves, kept apart so the first can be tested without an AudioContext:

     the model     which frequencies are chosen and how loud each one is. Plain
                   functions over plain arrays: [{ hz:528, vol:100 }, ...].
     the mixer     FrequencyMixer, the Web Audio side. It owns every oscillator
                   the tones use and is the only thing that creates or stops
                   them, so a second press of Play, a repeated change event or a
                   re-render can never stack a second copy of a tone on top of
                   the first: a tone is looked up by its Hz and either exists or
                   it does not.

   Three rules the mixer holds:

     NO CLICKS     nothing is ever set to a new gain in one step. Level changes
                   glide (setTargetAtTime), a new tone starts silent and fades
                   in, a removed tone fades out and is stopped afterwards.
     TRUE PITCH    every oscillator runs at exactly the chosen Hz. Nothing is
                   detuned or pitch-shifted. (With a brainwave band on, the right
                   ear is the chosen Hz plus the band's beat, which is the beat.)
     HEADROOM      each tone's gain is scaled by 1/sqrt(count), so adding tones
                   does not make the whole thing louder, and the whole frequency
                   bus sits at the same ceiling a single tone always had
                   (BASE_LEVEL at 100%). The page's output bus has a limiter
                   behind it as the last line of defence. */
(function (root) {
  'use strict';

  const MAX_FREQUENCY_LAYERS = 4;
  const DEFAULT_LAYER_VOLUME = 100;
  /* What one tone at 100% on a 100% frequency fader has always been. */
  const BASE_LEVEL = 0.10;
  const LEVEL_TC = 0.05;      // seconds: the time constant of a fader move
  const FADE_IN_TC = 0.35;    // a new tone arriving
  const FADE_OUT_TC = 0.12;   // a tone leaving
  const STOP_AFTER = 1.2;     // seconds after a removal that its oscillators stop

  /* ---------------- the model ---------------- */
  function clampVol(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_LAYER_VOLUME;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  /* Anything that might have been saved -> a clean list: only known Hz, no
     repeats, at most four, volumes 0..100. A subliminal saved before layers
     existed has one frequency_hz and nothing else; that becomes one layer. */
  function normalizeFrequencyLayers(raw, validHz, legacyHz) {
    const known = Array.isArray(validHz) && validHz.length ? new Set(validHz) : null;
    const out = [];
    const seen = new Set();
    const push = (hz, vol) => {
      hz = Number(hz);
      if (!Number.isFinite(hz) || seen.has(hz)) return;
      if (known && !known.has(hz)) return;
      if (out.length >= MAX_FREQUENCY_LAYERS) return;
      seen.add(hz);
      out.push({ hz, vol: clampVol(vol) });
    };
    if (Array.isArray(raw)) raw.forEach(l => { if (l && typeof l === 'object') push(l.hz, l.vol); else push(l, DEFAULT_LAYER_VOLUME); });
    if (!out.length && legacyHz != null) push(legacyHz, DEFAULT_LAYER_VOLUME);
    return out;
  }
  /* Tap on a frequency: add it, or take it off. Returns the new list and, when
     nothing could change, why. The input is never mutated. */
  function toggleFrequencyLayer(layers, hz) {
    const list = (layers || []).map(l => ({ hz: l.hz, vol: l.vol }));
    const i = list.findIndex(l => l.hz === hz);
    if (i >= 0) { list.splice(i, 1); return { layers: list, changed: true, action: 'removed', reason: null }; }
    if (list.length >= MAX_FREQUENCY_LAYERS) return { layers: list, changed: false, action: null, reason: 'max' };
    list.push({ hz, vol: DEFAULT_LAYER_VOLUME });
    return { layers: list, changed: true, action: 'added', reason: null };
  }
  function removeFrequencyLayer(layers, hz) {
    return (layers || []).filter(l => l.hz !== hz).map(l => ({ hz: l.hz, vol: l.vol }));
  }
  function setFrequencyLayerVolume(layers, hz, vol) {
    return (layers || []).map(l => ({ hz: l.hz, vol: l.hz === hz ? clampVol(vol) : l.vol }));
  }
  function serializeFrequencyLayers(layers) {
    return (layers || []).slice(0, MAX_FREQUENCY_LAYERS).map(l => ({ hz: l.hz, vol: clampVol(l.vol) }));
  }

  /* ---------------- the level maths ---------------- */
  function layerHeadroom(count) { return count > 1 ? 1 / Math.sqrt(count) : 1; }
  /* A single tone's gain on the frequency bus (before the bus's own master). */
  function layerGainValue(vol, count) { return (clampVol(vol) / 100) * layerHeadroom(count); }
  /* The master gain of the frequency bus: the "Frequency" fader. */
  function masterGainValue(masterPercent) {
    const n = Number(masterPercent);
    return (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0) / 100 * BASE_LEVEL;
  }
  /* Worst case peak of the whole bus: every tone's crest landing together. */
  function peakEstimate(layers, masterPercent) {
    const n = (layers || []).length;
    return (layers || []).reduce((s, l) => s + layerGainValue(l.vol, n), 0) * masterGainValue(masterPercent);
  }

  /* Tones this close together beat against each other: a pulsing roughness
     that is the point of a binaural pair and the opposite of one in a chord. */
  const ROUGH_GAP_HZ = 40;
  const SHARP_HZ = 741;
  /* Combinations that are likely to be uncomfortable. Pure advice: nothing is
     changed for the listener, and every message says what to turn down. */
  function assessFrequencyMix(layers, opts) {
    const o = opts || {};
    const master = o.master == null ? 30 : o.master;
    const voice = o.voice == null ? 65 : o.voice;
    const list = layers || [];
    const warnings = [];
    if (!list.length) return warnings;
    const loud = list.filter(l => l.vol >= 80);
    if (list.length >= 3 && loud.length >= 3 && master >= 70) {
      warnings.push({ code: 'stack-loud', message: 'Three or more tones at a high level can feel heavy or tiring. Try lowering the Frequency level or a few of the tones.' });
    } else if (master >= 90 && list.some(l => l.vol >= 90)) {
      warnings.push({ code: 'master-loud', message: 'The frequency layer is set very high. A gentler level is easier to listen to for a long time.' });
    }
    const near = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Math.abs(a.hz - b.hz) <= ROUGH_GAP_HZ && a.vol >= 50 && b.vol >= 50) near.push([a.hz, b.hz]);
    }
    if (near.length && master >= 40) {
      const pairs = near.map(p => p[0] + ' + ' + p[1] + ' Hz').join(', ');
      warnings.push({ code: 'close-pair', message: pairs + ' sit close together and can beat against each other with a rough, pulsing sound. Lower one of them if it is uncomfortable.' });
    }
    const sharp = list.filter(l => l.hz >= SHARP_HZ && l.vol >= 80);
    if (sharp.length && master >= 80) {
      warnings.push({ code: 'sharp', message: 'Higher tones can feel sharp at a high level. Lower ' + sharp.map(l => l.hz + ' Hz').join(' and ') + ' if it does.' });
    }
    /* Affirmations buried by the tones: the bus is measured as the worst-case
       peak, the voice as its fader, since clips are normalised speech. */
    if (voice <= 15 && peakEstimate(list, master) >= BASE_LEVEL * 0.45) {
      warnings.push({ code: 'drowns-voice', message: 'The frequencies are much louder than your affirmations right now. Raise the Affirmations level or lower the Frequency level.' });
    }
    return warnings;
  }

  /* ---------------- the safety net on the output ----------------
     Everything -- voice, tones, ambience, music -- meets on one bus. With the
     tones kept at a fixed ceiling and every fader at its usual place nothing gets
     near full scale; this is for the moments when a lot of loud layers line up.
     Rather than letting the sum hit the digital ceiling and clip (a harsh,
     distorted crack), it is rounded off: untouched up to LIMITER_KNEE, then
     curving toward 1.0 and never reaching it. The curve is sampled over a bus
     range of -2..2 (the node's input is halved to fit its -1..1 domain, and
     doubled again after it), so a sum of up to twice full scale is still
     shaped instead of cut. Below the knee it is exactly the identity, so
     nothing about normal listening changes. */
  const LIMITER_KNEE = 0.8;
  function softLimit(x) {
    const a = Math.abs(x);
    if (a <= LIMITER_KNEE) return x;
    const room = 1 - LIMITER_KNEE;
    return Math.sign(x) * (LIMITER_KNEE + room * Math.tanh((a - LIMITER_KNEE) / room));
  }
  function softLimiterCurve(points) {
    const n = points || 4097;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const busValue = ((i / (n - 1)) * 2 - 1) * 2;      // -2 .. 2
      curve[i] = softLimit(busValue) / 2;                // back into the node's -1 .. 1
    }
    return curve;
  }

  /* ---------------- the mixer ---------------- */
  function glide(param, target, tc, ctx) {
    if (!param) return;
    const t = ctx.currentTime;
    try {
      if (param.cancelScheduledValues) param.cancelScheduledValues(t);
      if (param.setValueAtTime) param.setValueAtTime(param.value, t);
      if (param.setTargetAtTime) param.setTargetAtTime(target, t, tc);
      else param.value = target;
    } catch (e) { try { param.value = target; } catch (e2) { /* nothing more to do */ } }
  }

  class FrequencyMixer {
    constructor() {
      this.ctx = null;
      this.master = null;     // GainNode: the Frequency fader. Everything else hangs off it.
      this.filter = null;
      this.voices = new Map();   // hz -> voice
      this.retiring = new Set(); // voices fading out
      this.band = null;       // { hz } of the binaural beat, or null
      this.layers = [];
    }
    get attached() { return !!this.ctx && !!this.master; }
    /* Idempotent for one context: attaching again to the same context changes
       nothing, which is what makes a second Play unable to double the tones. */
    attach(ctx, destination, opts) {
      if (this.ctx === ctx && this.master) return this;
      this.detach();
      const o = opts || {};
      this.ctx = ctx;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.4;   // softens harsh upper harmonics
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      const target = o.level == null ? 0 : o.level;
      if (o.fadeIn) master.gain.linearRampToValueAtTime(target, ctx.currentTime + o.fadeIn);
      else master.gain.setValueAtTime(target, ctx.currentTime);
      filter.connect(master);
      if (destination) master.connect(destination);
      this.filter = filter; this.master = master;
      return this;
    }
    setMasterLevel(level) {
      if (!this.attached) return;
      glide(this.master.gain, level, LEVEL_TC, this.ctx);
    }
    _targetFor(layer, count) { return layerGainValue(layer.vol, count); }
    _buildVoice(hz, band) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0;               // arrives silent; sync() fades it in
      gain.connect(this.filter);
      const oscs = [];
      const make = (freq, pan) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        if (pan !== undefined && ctx.createStereoPanner) {
          const p = ctx.createStereoPanner(); p.pan.value = pan;
          o.connect(p); p.connect(gain);
        } else {
          o.connect(gain);
        }
        o.start();
        oscs.push(o);
        return o;
      };
      let right = null;
      if (band) {
        make(hz, -1);
        right = make(hz + band.hz, 1);
      } else {
        make(hz);
      }
      return { hz, gain, oscs, right, band: band ? band.hz : null };
    }
    _retire(voice) {
      if (!voice || voice.retired) return;
      voice.retired = true;
      this.retiring.add(voice);
      const ctx = this.ctx;
      glide(voice.gain.gain, 0, FADE_OUT_TC, ctx);
      const stopAt = ctx.currentTime + STOP_AFTER;
      voice.oscs.forEach(o => {
        try { o.stop(stopAt); } catch (e) { /* already stopped */ }
        o.onended = () => {
          o.__ended = true;
          try { o.disconnect(); } catch (e) { /* ignore */ }
          if (voice.oscs.every(x => x.__ended)) {
            try { voice.gain.disconnect(); } catch (e2) { /* ignore */ }
            this.retiring.delete(voice);
          }
        };
      });
    }
    /* Make the sounding tones equal to `layers`. Safe to call as often as you
       like: tones already sounding are left alone and only retuned in level. */
    sync(layers, opts) {
      if (!this.attached) return;
      const o = opts || {};
      const list = normalizeFrequencyLayers(layers);
      const band = o.band !== undefined ? (o.band ? { hz: o.band.hz } : null) : this.band;
      this.layers = list;
      this.band = band;
      const count = list.length;
      const wanted = new Set(list.map(l => l.hz));
      // Leaving: fade out, stop afterwards, and forget immediately.
      [...this.voices.keys()].forEach(hz => {
        if (!wanted.has(hz)) { this._retire(this.voices.get(hz)); this.voices.delete(hz); }
      });
      list.forEach(layer => {
        let voice = this.voices.get(layer.hz);
        // Beat switched on or off: the graph's shape differs, so the tone is
        // replaced -- the new one fades in as the old one fades out.
        if (voice && !!voice.band !== !!band) {
          this._retire(voice); this.voices.delete(layer.hz); voice = null;
        }
        const target = this._targetFor(layer, count);
        if (!voice) {
          voice = this._buildVoice(layer.hz, band);
          this.voices.set(layer.hz, voice);
          glide(voice.gain.gain, target, FADE_IN_TC, this.ctx);
        } else {
          // Band to band: retune the right ear in place.
          if (band && voice.right && voice.band !== band.hz) {
            try { voice.right.frequency.linearRampToValueAtTime(layer.hz + band.hz, this.ctx.currentTime + 1.2); } catch (e) { voice.right.frequency.value = layer.hz + band.hz; }
            voice.band = band.hz;
          }
          glide(voice.gain.gain, target, LEVEL_TC, this.ctx);
        }
      });
    }
    /* Change only the brainwave beat, keeping the chosen tones. */
    setBand(band) { this.sync(this.layers, { band: band || null }); }
    voiceCount() { return this.voices.size; }
    /* Oscillators currently audible (retiring ones included while they fade). */
    oscillatorCount() {
      let n = 0;
      this.voices.forEach(v => { n += v.oscs.length; });
      this.retiring.forEach(v => { n += v.oscs.filter(o => !o.__ended).length; });
      return n;
    }
    frequencies() { return [...this.voices.keys()]; }
    stop() {
      this.voices.forEach(v => v.oscs.forEach(o => { try { o.stop(); } catch (e) { /* ignore */ } }));
      this.retiring.forEach(v => v.oscs.forEach(o => { try { o.stop(); } catch (e) { /* ignore */ } }));
    }
    detach() {
      this.stop();
      this.voices.forEach(v => { try { v.gain.disconnect(); } catch (e) { /* ignore */ } });
      this.voices.clear(); this.retiring.clear();
      if (this.master) { try { this.master.disconnect(); } catch (e) { /* ignore */ } }
      if (this.filter) { try { this.filter.disconnect(); } catch (e) { /* ignore */ } }
      this.ctx = null; this.master = null; this.filter = null; this.layers = [];
    }
  }

  const api = {
    MAX_FREQUENCY_LAYERS, DEFAULT_LAYER_VOLUME, BASE_LEVEL, ROUGH_GAP_HZ,
    normalizeFrequencyLayers, toggleFrequencyLayer, removeFrequencyLayer, setFrequencyLayerVolume,
    serializeFrequencyLayers, layerHeadroom, layerGainValue, masterGainValue, peakEstimate,
    assessFrequencyMix, FrequencyMixer, LIMITER_KNEE, softLimit, softLimiterCurve,
  };
  root.FrequencyLayers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
