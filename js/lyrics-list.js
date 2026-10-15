/* The lyrics-style affirmation list on the immersive player.

   A persistent, scrollable list of every affirmation. The line being spoken is
   brighter, larger and lit in lavender-and-gold; lines already spoken and lines
   still to come are quieter but stay readable. The list follows the active line
   by keeping it near the centre, and lets go the moment the listener scrolls it
   themselves.

   It owns no clock. It paints what the AffirmationTimeline says (see
   js/affirmation-timeline.js) and nothing else, so it cannot disagree with the
   audio.

   FOLLOW MODE
     on     the active line is kept centred, smoothly.
     off    the listener touched the list (wheel, touch, drag, keys). Nothing
            scrolls it until they press Follow, or until playback has moved on
            to another line while they have been idle for FOLLOW_IDLE_MS --
            so it never fights a thumb that is still on the glass. */
(function (root) {
  'use strict';

  const FOLLOW_IDLE_MS = 4000;

  class LyricsList {
    constructor(opts) {
      this.list = opts.list;               // the scrolling element
      this.followBtn = opts.followBtn || null;
      this.announce = opts.announce || null;   // aria-live region
      this.timeline = opts.timeline;
      this.onSelect = opts.onSelect || null;
      this.reducedMotion = opts.reducedMotion || (() => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches));
      this.lines = [];
      this.tags = [];
      this.items = [];
      this.follow = true;
      this.lastTouch = 0;
      this.lastActive = -1;
      this.now = opts.now || (() => Date.now());
      this._bind();
      if (this.timeline) this.unsubscribe = this.timeline.on(snap => this.paint(snap));
    }
    _bind() {
      const stop = () => this.userScrolled();
      ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'].forEach(ev =>
        this.list.addEventListener(ev, e => { if (ev === 'keydown' && !/^(Arrow|Page|Home|End| )/.test(e.key || '')) return; stop(); }, { passive: true }));
      if (this.followBtn) this.followBtn.addEventListener('click', () => this.resumeFollow());
    }
    setLines(lines, tags) {
      this.lines = (lines || []).map(l => String(l == null ? '' : l));
      this.tags = tags || [];
      this.list.textContent = '';
      this.items = this.lines.map((text, i) => {
        const li = document.createElement('li');
        li.className = 'ip-lyric';
        li.dataset.i = String(i);
        li.setAttribute('role', 'listitem');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ip-lyric-btn';
        const t = document.createElement('span');
        t.className = 'ip-lyric-text';
        t.textContent = text;
        btn.appendChild(t);
        if (this.tags[i]) {
          const tag = document.createElement('small');
          tag.className = 'ip-lyric-tag';
          tag.textContent = this.tags[i];
          btn.appendChild(tag);
        }
        btn.addEventListener('click', () => { if (this.onSelect) this.onSelect(i); });
        li.appendChild(btn);
        this.list.appendChild(li);
        return li;
      });
      this.list.classList.toggle('ip-lyrics-single', this.lines.length === 1);
      this.lastActive = -1;
      this.follow = true;
      this._showFollow(false);
      if (this.timeline) { this.timeline.setCount(this.lines.length); }
      this.paint(this.timeline ? this.timeline.snapshot() : null);
    }
    paint(snap) {
      if (!snap) snap = { states: [], active: -1, queued: -1, paused: false };
      this.items.forEach((li, i) => {
        const st = snap.states[i] || 'upcoming';
        if (li.dataset.state !== st) li.dataset.state = st;
        if (st === 'active') li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
        const btn = li.firstChild;
        if (btn) btn.setAttribute('aria-label', (st === 'active' ? 'Now speaking: ' : st === 'queued' ? 'Up next: ' : '') + (this.lines[i] || ''));
      });
      this.list.classList.toggle('is-paused', !!snap.paused);
      const active = snap.active;
      if (active >= 0 && active !== this.lastActive) {
        this.lastActive = active;
        if (this.announce) this.announce.textContent = (this.lines[active] || '');
        // Playback moved on: an idle listener is brought back along with it.
        if (!this.follow && this.now() - this.lastTouch >= FOLLOW_IDLE_MS) this.resumeFollow(true);
        else if (this.follow) this.scrollToActive();
      } else if (snap.type === 'pass') {
        // The loop came round (or Start Over): back to the first line.
        this.lastActive = -1;
        if (this.follow) this.scrollTo(0);
      } else if (snap.type === 'resume' && this.follow) {
        this.scrollToActive();
      }
    }
    /* Which layer reads each line (1-based; 0 = not layered). Layered lines carry
       a quiet "Voice N" label. This never moves the list. */
    setLayers(owner) {
      this.owner = owner || [];
      const layered = this.owner.some(n => n > 0);
      this.list.classList.toggle('ip-lyrics-layered', layered);
      this.items.forEach((li, i) => {
        const n = this.owner[i] || 0;
        if (n > 0) { li.dataset.layer = String(n); li.dataset.layerLabel = String(n); } else { delete li.dataset.layer; delete li.dataset.layerLabel; }
      });
    }
    /* The lines the secondary layers are saying right now: { slot: lineIndex }.
       A soft glow only. The lit line, the announcement and the scroll position
       belong to the main voice alone, so several simultaneous voices can never
       tug the list about. */
    setSecondary(map) {
      const now = {};
      Object.keys(map || {}).forEach(slot => { const i = map[slot]; if (Number.isInteger(i) && i >= 0) now[i] = slot; });
      this.items.forEach((li, i) => {
        if (now[i]) { li.dataset.secondary = now[i]; li.classList.add('is-secondary'); }
        else if (li.dataset.secondary) { delete li.dataset.secondary; li.classList.remove('is-secondary'); }
      });
    }
    /* Centre line i in the scrolling element. */
    scrollTo(i) {
      const li = this.items[i];
      if (!li || !this.list.clientHeight) return;
      const target = li.offsetTop - (this.list.clientHeight - li.offsetHeight) / 2;
      const top = Math.max(0, Math.min(target, this.list.scrollHeight - this.list.clientHeight));
      this._programmatic = true;
      try { this.list.scrollTo({ top, behavior: this.reducedMotion() ? 'auto' : 'smooth' }); }
      catch (e) { this.list.scrollTop = top; }
      clearTimeout(this._progTimer);
      this._progTimer = setTimeout(() => { this._programmatic = false; }, 700);
    }
    scrollToActive() {
      const i = this.timeline && this.timeline.active >= 0 ? this.timeline.active : this.lastActive;
      if (i >= 0) this.scrollTo(i);
    }
    userScrolled() {
      this.lastTouch = this.now();
      if (this.follow) { this.follow = false; this._showFollow(true); }
    }
    resumeFollow(fromPlayback) {
      this.follow = true;
      this._showFollow(false);
      this.scrollToActive();
      if (!fromPlayback && this.announce && this.followBtn) { /* the button text already says it */ }
    }
    _showFollow(show) {
      if (!this.followBtn) return;
      this.followBtn.hidden = !show;
    }
    destroy() { if (this.unsubscribe) this.unsubscribe(); clearTimeout(this._progTimer); }
  }

  root.LyricsList = LyricsList;
  root.LYRICS_FOLLOW_IDLE_MS = FOLLOW_IDLE_MS;
  if (typeof module !== 'undefined' && module.exports) module.exports = { LyricsList, FOLLOW_IDLE_MS };
})(typeof window !== 'undefined' ? window : globalThis);
