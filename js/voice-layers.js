/* Affirmation layering: up to four voices reading the same recordings at once.

   NOTHING IS DUPLICATED. A layer is a list of affirmation indices into the one
   list of recordings the subliminal already has. The audio of line 7 is one
   decoded clip no matter which layer plays it, and no file is generated: the
   layers are mixed live on the session's AudioContext.

   This file has two halves:
     - pure helpers (distribution, volumes, headroom, stagger offsets,
       normalising what was saved). No DOM, no audio: node can test them.
     - VoiceLayerEngine, which runs layers 2-4 against a context. Layer 1 is
       the existing sequence in js/builder.js (it owns the timeline, pause,
       seek, EFT repeats and the end-of-session logic); it only asks this file
       which lines are its own.

   The saved shape (inside subliminals.mix_settings.voiceLayers, no schema
   change):
     { count: 1-4, mode: 'staggered'|'simultaneous', staggerMs: 2000-4000,
       volumes: [v1, v2, v3, v4],           // 0-100; v1 mirrors mixVoice
       groups: null | [[idx...], ...] }     // null = automatic split */
(function (root) {
  'use strict';

  const MAX_LAYERS = 4;
  const DEFAULT_VOLUMES = Object.freeze([65, 40, 30, 20]);
  const MODES = Object.freeze(['staggered', 'simultaneous']);
  const DEFAULT_MODE = 'staggered';
  const STAGGER_MIN_MS = 2000, STAGGER_MAX_MS = 4000, STAGGER_DEFAULT_MS = 3000;
  /* The summed voice level (root-sum-square of the layer gains) is kept at or
     under this. One layer, however loud, is never touched (its RSS is itself,
     <= 1). */
  const HEADROOM_CEILING = 1;
  /* With several voices a little extra room is left for the moments they do line
     up, which the safety compressor then only has to round off. */
  const LAYERED_CEILING = 0.9;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function clampCount(n) {
    const v = Math.round(Number(n));
    return Number.isFinite(v) ? clamp(v, 1, MAX_LAYERS) : 1;
  }
  function clampVolume(n, fallback) {
    const v = Number(n);
    return Number.isFinite(v) ? clamp(Math.round(v), 0, 100) : fallback;
  }
  function clampStagger(n) {
    const v = Number(n);
    return Number.isFinite(v) ? clamp(Math.round(v / 100) * 100, STAGGER_MIN_MS, STAGGER_MAX_MS) : STAGGER_DEFAULT_MS;
  }

  /* ---------------- distribution ---------------- */

  /* total lines into `layers` contiguous groups, sizes differing by at most one
     (the earlier layers take the remainder): 100/4 -> 1-25, 26-50, 51-75,
     76-100; 10/4 -> 3,3,2,2. With fewer lines than layers the extra layers are
     simply not used, so no layer is ever empty. Order inside a group is the
     original order. */
  function distribute(total, layers) {
    const n = Math.max(0, total | 0);
    const k = Math.max(1, Math.min(clampCount(layers), n || 1));
    const groups = [];
    const base = Math.floor(n / k), extra = n % k;
    let at = 0;
    for (let g = 0; g < k; g++) {
      const size = base + (g < extra ? 1 : 0);
      const group = [];
      for (let i = 0; i < size; i++) group.push(at + i);
      at += size;
      groups.push(group);
    }
    return groups;
  }

  /* A saved manual split is trusted only if it still describes this list: every
     index 0..total-1 exactly once, across at least `count` non-empty groups.
     Anything else (lines were added or removed since, a hand-edited row) falls
     back to the automatic split instead of dropping or doubling a line. */
  function validGroups(groups, total, count) {
    if (!Array.isArray(groups) || groups.length < count) return false;
    const seen = new Set();
    for (let g = 0; g < count; g++) {
      const grp = groups[g];
      if (!Array.isArray(grp) || !grp.length) return false;
    }
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g];
      if (!Array.isArray(grp)) return false;
      if (g >= count && grp.length) return false;
      for (const i of grp) {
        if (!Number.isInteger(i) || i < 0 || i >= total || seen.has(i)) return false;
        seen.add(i);
      }
    }
    return seen.size === total;
  }

  /* ---------------- configuration ---------------- */

  function defaultConfig() {
    return { count: 1, mode: DEFAULT_MODE, staggerMs: STAGGER_DEFAULT_MS, volumes: DEFAULT_VOLUMES.slice(), groups: null };
  }
  /* Whatever was saved (or nothing) -> a complete, safe config. A subliminal
     saved before layering existed has no voiceLayers and gets one layer, which
     plays exactly as it always did. */
  function normalizeConfig(raw) {
    const d = defaultConfig();
    if (!raw || typeof raw !== 'object') return d;
    const volumes = DEFAULT_VOLUMES.map((def, i) => clampVolume(Array.isArray(raw.volumes) ? raw.volumes[i] : undefined, def));
    let groups = null;
    if (Array.isArray(raw.groups)) {
      groups = raw.groups.slice(0, MAX_LAYERS).map(g => Array.isArray(g) ? g.filter(Number.isInteger) : []);
      while (groups.length < MAX_LAYERS) groups.push([]);
    }
    return {
      count: clampCount(raw.count == null ? 1 : raw.count),
      mode: MODES.includes(raw.mode) ? raw.mode : DEFAULT_MODE,
      staggerMs: clampStagger(raw.staggerMs),
      volumes,
      groups
    };
  }
  function serializeConfig(cfg) {
    const c = normalizeConfig(cfg);
    return { count: c.count, mode: c.mode, staggerMs: c.staggerMs, volumes: c.volumes.slice(), groups: c.groups ? c.groups.map(g => g.slice()) : null };
  }
  /* Recommended = the shipped defaults. Count is the listener's choice and
     stays; everything about how the layers sound goes back. */
  function recommendedConfig(cfg) {
    const d = defaultConfig();
    d.count = normalizeConfig(cfg).count;
    return d;
  }

  /* The groups that will actually play: one per active layer, each non-empty.
     Layer 1 (index 0) is always the primary voice. */
  function resolveGroups(cfg, total) {
    const c = normalizeConfig(cfg);
    const k = Math.min(c.count, Math.max(1, total | 0));
    if (c.groups && validGroups(c.groups, total, k)) return c.groups.slice(0, k).map(g => g.slice());
    return distribute(total, k);
  }
  /* Which layer owns line `i`, or -1. */
  function layerOf(groups, i) {
    for (let g = 0; g < groups.length; g++) if (groups[g].includes(i)) return g;
    return -1;
  }
  /* Move line `i` to `layer` (appending it in original order inside the target)
     in a copy of `groups`. Refuses to empty the layer it leaves. */
  function moveLine(groups, i, layer) {
    const out = groups.map(g => g.slice());
    const from = layerOf(out, i);
    if (from < 0 || layer < 0 || layer >= out.length || from === layer) return out;
    if (out[from].length <= 1) return out;
    out[from] = out[from].filter(x => x !== i);
    out[layer].push(i);
    out[layer].sort((a, b) => a - b);
    return out;
  }

  /* ---------------- timing ---------------- */

  /* When each layer begins, in ms after the session starts. Simultaneous: all at
     0. Staggered: layer k starts k * staggerMs later, so phrases overlap
     naturally rather than landing on the same syllable. */
  function layerOffsets(cfg, layers) {
    const c = normalizeConfig(cfg);
    const n = layers == null ? c.count : layers;
    const out = [];
    for (let k = 0; k < n; k++) out.push(c.mode === 'simultaneous' ? 0 : k * c.staggerMs);
    return out;
  }

  /* ---------------- gain management ---------------- */

  /* Linear per-layer gains (0..1) from the sliders. */
  function layerGains(cfg, layers) {
    const c = normalizeConfig(cfg);
    const n = layers == null ? c.count : layers;
    return c.volumes.slice(0, n).map(v => v / 100);
  }
  /* A single multiplier for the whole voice bus. Voices that are not the same
     recording do not add in phase, so their levels add as root-sum-square, not
     arithmetically. If that sum would pass the ceiling, the bus comes down by
     exactly enough; otherwise it is 1. One layer is always 1, so a single-voice
     session is byte-for-byte the level it always was. */
  function headroom(gains) {
    const list = gains || [];
    const rss = Math.sqrt(list.reduce((s, g) => s + g * g, 0));
    const ceiling = list.length > 1 ? LAYERED_CEILING : HEADROOM_CEILING;
    return rss > ceiling ? ceiling / rss : 1;
  }

  /* ---------------- the engine for layers 2..n ---------------- */

  /* opts:
       ctx            the session AudioContext
       bus            AudioNode every layer's gain feeds (the voice bus)
       playLine       (index, gainNode, done) -> void. Plays line `index`
                      through gainNode and calls done() when it ends or cannot
                      be played. Supplied by the builder, which owns loading.
       later          (fn, ms) -> handle: a session-guarded timer
       cancel         (handle) -> void
       isLive         () -> bool: the session is still the one that started us
       gapMs          () -> ms of silence between two lines of one layer
       loops          () -> bool: start a layer's group again once it has been
                      read through (false = play it once, then that layer rests)
       onLine         (layerIndex, lineIndex|-1) -> void: for the lyrics hint
   Everything it creates is owned here and released in stop(). */
  class VoiceLayerEngine {
    constructor(opts) {
      this.o = opts;
      this.layers = [];            // { gain, group, pos, timer, token, active }
      this.stopped = false;
    }
    /* Make (or remove) layers so there are exactly groups.length - 1 of them.
       Idempotent, so it is the one call for start, for changing the number of
       layers and for editing which lines belong to which. Existing layers keep
       their place in their group when only the group list changes. */
    sync(groups, gains, offsets) {
      if (this.stopped) return;
      const want = Math.max(0, groups.length - 1);
      while (this.layers.length > want) this._remove(this.layers.length - 1);
      for (let k = 0; k < want; k++) {
        const slot = k + 1;
        let L = this.layers[k];
        if (!L) {
          const gain = this.o.ctx.createGain();
          gain.gain.value = 0;
          gain.connect(this.o.bus);
          L = this.layers[k] = { gain, group: [], pos: 0, timer: null, token: 0, active: false, playing: -1 };
          L.group = groups[slot].slice();
          this.setGain(slot, gains[slot]);
          this._begin(L, slot, offsets[slot] || 0);
        } else {
          const cur = L.group[L.pos % Math.max(1, L.group.length)];
          L.group = groups[slot].slice();
          const keep = L.group.indexOf(cur);
          L.pos = keep >= 0 ? keep : L.pos % Math.max(1, L.group.length);
          this.setGain(slot, gains[slot]);
        }
      }
    }
    setGain(slot, value) {
      const L = this.layers[slot - 1];
      if (!L) return;
      const t = this.o.ctx.currentTime;
      try {
        L.gain.gain.cancelScheduledValues(t);
        L.gain.gain.setTargetAtTime(Math.max(0, value || 0), t, 0.03);
        // The exponential approach never quite arrives; a layer set to 0 is silent.
        if (!(value > 0)) L.gain.gain.setValueAtTime(0, t + 0.25);
      } catch (e) { try { L.gain.gain.value = value; } catch (e2) { /* closed */ } }
    }
    /* True while any layer still has lines to say. */
    busy() { return this.layers.some(L => L.active); }
    /* The line each layer is saying right now (-1 between lines). */
    current() { return this.layers.map(L => (L.playing >= 0 ? L.playing : -1)); }
    /* A listener asked for line `index`: if one of our layers owns it, that layer
       says it next. Returns true if one did. */
    request(index) {
      for (const L of this.layers) {
        const at = L.group.indexOf(index);
        if (at >= 0) { L.pos = at; L.requested = true; return true; }
      }
      return false;
    }
    _begin(L, slot, offsetMs) {
      const token = ++L.token;
      L.active = true;
      const step = () => {
        if (this.stopped || L.token !== token || !this.o.isLive() || !L.group.length) return;
        if (L.pos >= L.group.length) L.pos = 0;           // loops on its own, in its own order
        const index = L.group[L.pos];
        L.playing = index;
        if (this.o.onLine) this.o.onLine(slot, index);
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          if (this.stopped || L.token !== token) return;
          L.playing = -1;
          if (this.o.onLine) this.o.onLine(slot, -1);
          if (L.requested) L.requested = false;
          else {
            L.pos++;
            if (L.pos >= L.group.length) {
              if (this.o.loops && !this.o.loops()) { L.active = false; L.timer = null; return; }
              L.pos = 0;
            }
          }
          L.timer = this.o.later(step, this.o.gapMs());
        };
        try { this.o.playLine(index, L.gain, done); } catch (e) { done(); }
      };
      L.timer = this.o.later(step, offsetMs);
    }
    _remove(k) {
      const L = this.layers[k];
      if (!L) return;
      L.token++; L.active = false; L.playing = -1;
      if (L.timer != null) this.o.cancel(L.timer);
      const t = this.o.ctx.currentTime;
      // A short fade rather than a click if a line is mid-word.
      try { L.gain.gain.cancelScheduledValues(t); L.gain.gain.setTargetAtTime(0, t, 0.02); } catch (e) { /* closed */ }
      const g = L.gain;
      setTimeout(() => { try { g.disconnect(); } catch (e) { /* gone */ } }, 200);
      this.layers.length = k;
      if (this.o.onLine) this.o.onLine(k + 1, -1);
    }
    stop() {
      this.stopped = true;
      for (let k = this.layers.length - 1; k >= 0; k--) {
        const L = this.layers[k];
        L.token++; L.playing = -1;
        if (L.timer != null) this.o.cancel(L.timer);
        try { L.gain.disconnect(); } catch (e) { /* gone */ }
      }
      this.layers = [];
    }
  }

  const api = {
    MAX_LAYERS, DEFAULT_VOLUMES, MODES, DEFAULT_MODE, STAGGER_MIN_MS, STAGGER_MAX_MS, STAGGER_DEFAULT_MS, HEADROOM_CEILING, LAYERED_CEILING,
    clampCount, clampVolume, clampStagger,
    distribute, validGroups, resolveGroups, layerOf, moveLine,
    defaultConfig, normalizeConfig, serializeConfig, recommendedConfig,
    layerOffsets, layerGains, headroom, VoiceLayerEngine
  };
  root.VoiceLayers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
