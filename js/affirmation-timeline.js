/* Affirmation limits, ordering helpers, and the playback timeline.

   THE TIMELINE is the one answer to "which affirmation is being spoken right
   now". The player does not keep a timer of its own for it. Whatever actually
   makes the sound reports two things -- this line has started, this line has
   ended -- and the timeline stamps them on the session clock (the same
   pause-aware clock the progress bar and the lock screen use). Everything that
   shows or announces a line reads it back from here, so the highlight can only
   ever be where the audio is.

   Which line is "primary": only the main voice's lines are reported. The quiet
   second voice (Ritual's layered voice) runs on its own cycle underneath and
   never calls lineStart, so it can never light a line it is not saying. If two
   starts ever overlap, the later start owns the highlight and closes the
   earlier segment at that instant -- exactly one line is active at a time. */
(function (root) {
  'use strict';

  /* How many affirmations each way of voicing a subliminal can carry. Recording
     yourself is the only one that is not limited by what a voice provider
     generates per request, so it is the only one that goes to 20. */
  const AFFIRMATION_LIMITS = Object.freeze({ own: 20, serenity: 10, clone: 10, other: 10 });
  const MAX_AFFIRMATIONS = 20;

  function voiceKind(selectedVoice) {
    if (selectedVoice === 'record_own' || selectedVoice === 'own') return 'own';
    if (selectedVoice === 'serenity') return 'serenity';
    if (selectedVoice === 'clone_voice' || selectedVoice === 'clone') return 'clone';
    return 'other';
  }
  function limitFor(selectedVoice) { return AFFIRMATION_LIMITS[voiceKind(selectedVoice)]; }
  function countLabel(count, max) { return count + '/' + (max == null ? MAX_AFFIRMATIONS : max); }
  const VOICE_NAMES = { own: 'Record Your Own Voice', serenity: 'Serenity', clone: 'Clone Your Voice', other: 'This voice' };
  /* The explanation shown when a voice reads fewer lines than there are. The
     lines are never touched: the person decides what to take out. */
  function overLimitMessage(count, selectedVoice) {
    const kind = voiceKind(selectedVoice);
    const max = AFFIRMATION_LIMITS[kind];
    if (count <= max) return '';
    const extra = count - max;
    return VOICE_NAMES[kind] + ' reads up to ' + max + ' affirmations, and you have ' + count + '. '
      + 'Nothing has been removed. Take out ' + extra + ' line' + (extra === 1 ? '' : 's')
      + ' to use this voice, or choose Record Your Own Voice to keep up to ' + AFFIRMATION_LIMITS.own + '.';
  }

  /* ---------------- ordering ---------------- */
  function moveItem(arr, from, to) {
    const out = (arr || []).slice();
    if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item);
    return out;
  }

  /* The plan for one pass: where each line starts and ends on the session
     clock, given how long each is and the silence between them. This is the
     "timing metadata" that is saved with a subliminal; playback itself reports
     the real times, this is what the real times are expected to be. */
  function planTimings(durationsMs, opts) {
    const o = opts || {};
    const gap = Math.max(0, o.gapMs == null ? 2400 : o.gapMs);
    const repeats = o.repeats || (() => 1);
    let t = 0;
    return (durationsMs || []).map((d, index) => {
      const dur = Math.max(0, Number(d) || 0);
      const n = Math.max(1, repeats(index));
      const start = t;
      const end = start + dur * n + (n > 1 ? 700 * (n - 1) : 0);
      t = end + gap;
      return { index, startMs: Math.round(start), endMs: Math.round(end), durationMs: Math.round(dur) };
    });
  }

  /* ---------------- the timeline ---------------- */
  class AffirmationTimeline {
    constructor(opts) {
      this.now = (opts && opts.now) || (() => Date.now());
      this.count = 0;
      this.listeners = new Set();
      this.reset();
    }
    reset() {
      this.pass = 0;
      this.segments = [];
      this.active = -1;
      this.queued = -1;
      this.highest = -1;
      this.played = new Set();
      this.paused = false;
      this._emit('reset');
    }
    setCount(n) { this.count = Math.max(0, n | 0); this._emit('count'); }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    _emit(type) { const snap = this.snapshot(type); this.listeners.forEach(fn => { try { fn(snap); } catch (e) { /* a listener must not stop playback */ } }); }
    /* The sequence starts again from its first line: a new play, Start Over, or
       the loop coming round. Nothing is "played" any more. */
    beginPass() {
      this.pass++;
      this.segments = [];
      this.active = -1; this.queued = -1; this.highest = -1;
      this.played = new Set();
      this._emit('pass');
    }
    lineStart(index, at) {
      if (!Number.isInteger(index) || index < 0) return;
      const t = at == null ? this.now() : at;
      this._closeOpen(t);
      this.segments.push({ index, start: t, end: null, pass: this.pass });
      this.active = index;
      this.queued = -1;      // whichever line starts, the pending jump has been answered
      if (index > this.highest) this.highest = index;
      this._emit('start');
    }
    lineEnd(index, at) {
      const open = this._open();
      if (!open || open.index !== index) return;     // a late or duplicate end is ignored
      open.end = at == null ? this.now() : at;
      this.played.add(index);
      this.active = -1;
      this._emit('end');
    }
    _open() { const s = this.segments[this.segments.length - 1]; return s && s.end == null ? s : null; }
    _closeOpen(t) {
      const open = this._open();
      if (open) { open.end = t; this.played.add(open.index); }
    }
    /* Everything is finished: stop, or the last pass ran out. */
    finish(at) {
      const t = at == null ? this.now() : at;
      this._closeOpen(t);
      this.active = -1; this.queued = -1; this.paused = false;
      this._emit('finish');
    }
    pause() { if (this.paused) return; this.paused = true; this._emit('pause'); }
    resume() { if (!this.paused) return; this.paused = false; this._emit('resume'); }
    /* A jump has been asked for: it will start at the next line boundary. The
       target shows as "up next" rather than pretending it is already speaking. */
    request(index) {
      this.queued = Number.isInteger(index) && index >= 0 && index < this.count ? index : -1;
      this._emit('request');
    }
    /* Which line was sounding at a moment on the session clock. Pure over the
       recorded segments, so seeking and resuming can be answered exactly. */
    activeAt(t) {
      for (let i = this.segments.length - 1; i >= 0; i--) {
        const s = this.segments[i];
        if (t >= s.start && (s.end == null || t < s.end)) return s.index;
      }
      return -1;
    }
    stateOf(i) {
      if (i === this.active) return 'active';
      if (i === this.queued) return 'queued';
      if (this.played.has(i) || (this.highest >= 0 && i < this.highest)) return 'played';
      return 'upcoming';
    }
    snapshot(type) {
      const states = [];
      for (let i = 0; i < this.count; i++) states.push(this.stateOf(i));
      return { type: type || 'snapshot', pass: this.pass, active: this.active, queued: this.queued, paused: this.paused, count: this.count, states };
    }
  }

  const api = { AFFIRMATION_LIMITS, MAX_AFFIRMATIONS, voiceKind, limitFor, countLabel, overLimitMessage, moveItem, planTimings, AffirmationTimeline };
  root.AffirmationKit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
