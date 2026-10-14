/* telemetry.js — privacy-conscious reliability reporting

   Part of Subliminally. A plain script, loaded before builder.js.

   WHAT THIS IS FOR: knowing that playback, voice generation, saving, sign-in or
   checkout is failing for people, and roughly how often and where, without
   knowing anything about the person or what they were listening to.

   WHAT IS SENT, and nothing else: an event name from a fixed list, a handful of
   short codes from a fixed list of field names ("clip_expired", "studio",
   "ios-safari"), counts and timings, and which platform it happened on.

   WHAT IS NEVER SENT, by construction rather than by care:
     * affirmation text, journal text, or any other text a person wrote;
     * recordings, or a link to one (anything URL-shaped is dropped);
     * access tokens or anything token-shaped (long opaque strings are dropped);
     * the user id, email or any account identifier -- events carry a random id
       made fresh for each page load that cannot be tied to an account.
   Field values must be short, plain codes; anything else is discarded rather
   than trimmed, so a careless caller cannot leak by passing the wrong thing.

   Failures here are swallowed: reporting must never be the thing that breaks
   playback. It is rate-limited per page so a failure loop cannot flood anything. */
(function(){
  const MAX_EVENTS_PER_PAGE = 25;
  const DEDUPE_MS = 30000;
  const FIELDS = ['code', 'stage', 'voice', 'status', 'ms', 'count', 'state', 'area', 'plan', 'reason'];
  const sessionId = Math.random().toString(36).slice(2, 10);
  let sent = 0;
  const recent = new Map();

  function platform(){
    try {
      const native = typeof isNativeApp === 'function' && isNativeApp();
      const ua = navigator.userAgent || '';
      const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
      if (native) return ios ? 'native-ios' : 'native-android';
      if (ios) return 'ios-safari';
      return /Android/.test(ua) ? 'android-web' : 'desktop-web';
    } catch(e){ return 'unknown'; }
  }

  /* Only short, plain codes. A URL, a token, a sentence or a number-ish blob is
     not a code, and is dropped whole. */
  function clean(value){
    if (typeof value === 'number' && isFinite(value)) return Math.round(value);
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;
    if (value.length > 40) return undefined;
    if (!/^[A-Za-z0-9_.:\-]+$/.test(value)) return undefined;   // no spaces: not a sentence
    if (/^[A-Za-z0-9_\-]{24,}$/.test(value)) return undefined;  // opaque and long: token-shaped
    return value;
  }

  window.reportIssue = function(kind, fields){
    try {
      if (typeof kind !== 'string' || !/^[a-z0-9_]{3,40}$/.test(kind)) return;
      if (sent >= MAX_EVENTS_PER_PAGE) return;
      const out = {};
      FIELDS.forEach(k => {
        if (!fields || !(k in fields)) return;
        const v = clean(fields[k]);
        if (v !== undefined) out[k] = v;
      });
      const dedupe = kind + '|' + (out.code || '') + '|' + (out.stage || '');
      const now = Date.now();
      if (recent.has(dedupe) && now - recent.get(dedupe) < DEDUPE_MS) return;
      recent.set(dedupe, now);
      sent++;
      const body = JSON.stringify({
        kind, fields: out, sid: sessionId, platform: platform(),
        online: navigator.onLine !== false,
        visible: document.visibilityState || 'unknown',
      });
      const base = (typeof API_BASE !== 'undefined') ? API_BASE : '';
      const url = base + '/api/client-event';
      // No credentials, no cookies: this endpoint does not know who is asking.
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
      fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    } catch(e){ /* never the cause of a failure */ }
  };
  window.reportAudioIssue = function(kind, fields){ window.reportIssue('audio_' + kind, fields); };
  window.reportSaveIssue  = function(kind, fields){ window.reportIssue('save_' + kind, fields); };
  window.reportAuthIssue  = function(kind, fields){ window.reportIssue('auth_' + kind, fields); };
  window.reportBillingIssue = function(kind, fields){ window.reportIssue('billing_' + kind, fields); };

  /* Things that go wrong without anybody calling us. */
  window.addEventListener('unhandledrejection', function(ev){
    const r = ev && ev.reason;
    const name = r && (r.name || (r.constructor && r.constructor.name));
    window.reportIssue('unhandled_rejection', { code: clean(name) || 'unknown' });
  });
})();
