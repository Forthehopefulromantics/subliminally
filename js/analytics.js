/* analytics.js — the one place an event leaves the app

   Part of Subliminally. Plain script, shared global scope, loaded before the
   builder so every later file can call trackEvent().

   There is still no analytics provider installed (no gtag, no dataLayer, no
   vendor SDK anywhere in this repo), so nothing here sends anything over the
   network. Events are emitted the way trackPaywall always emitted them — a DOM
   event plus the two globals a tag manager or gtag snippet would already have
   put on the page — and a provider added later picks them up unchanged.

   Three rules live here so no call site can forget them:

     CONSENT   Nothing is handed to a provider, or announced on the DOM event,
               until consent has been granted (setAnalyticsConsent(true), or
               localStorage fthr_analytics_consent = 'granted'). Global Privacy
               Control and Do Not Track count as a refusal. Events that happen
               before consent are dropped, not queued and replayed later.
     PRIVACY   Only the property names in SAFE_PROPS survive, only as short
               primitives, and a string with an "@" in it is dropped. Affirmation
               text, recordings, emails and user ids are not in the list, so a
               call site that passes them by mistake has them stripped.
     ONCE      Each event has a scope (page load, browser session, or person) and
               fires once per scope, so a re-render or a double tap is not a
               second sign-up. */

/* The funnel, and how often each one may fire. 'person' is remembered per user
   id in localStorage so it survives a new tab or a new device session; 'session'
   per tab; 'load' only until the page is reloaded. 'free' events are not
   deduplicated here because the caller already has a natural once-ness (see
   the PAYWALL_EVENTS in entitlements.js). */
const ANALYTICS_EVENTS = {
  homepage_view:             'load',
  signup_started:            'session',
  signup_completed:          'person',
  first_subliminal_created:  'person',
  paywall_viewed:            'session',   // per feature: the key carries it
  subscription_purchased:    'session',   // per plan: the key carries it
  // The rest of the paywall funnel, already emitted by entitlements.js.
  locked_feature_clicked:    'free',
  upgrade_cta_clicked:       'free',
  paywall_dismissed:         'free',
  checkout_started:          'free',
};
const SAFE_PROPS = ['page','feature','required_tier','current_tier','trigger','reason','destination',
                    'period','via','source','method','voice_mode','minutes','signed_in','mode'];

window.subliminallyEvents = window.subliminallyEvents || [];
const analyticsSeen = new Set();       // 'load' scope

function analyticsStoreGet(store, key){ try { return window[store].getItem(key); } catch(e){ return null; } }
function analyticsStoreSet(store, key, v){ try { window[store].setItem(key, v); } catch(e){} }

/* Has this person agreed to be measured? Refusals win over everything. */
let analyticsConsentFlag = null;
function hasAnalyticsConsent(){
  try {
    if (navigator.globalPrivacyControl === true) return false;
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return false;
  } catch(e){}
  if (analyticsConsentFlag !== null) return analyticsConsentFlag;
  if (window.subliminallyConsent === true) return true;
  return analyticsStoreGet('localStorage', 'fthr_analytics_consent') === 'granted';
}
/* For a consent banner (none exists yet) or a native settings switch to call. */
function setAnalyticsConsent(granted){
  analyticsConsentFlag = !!granted;
  analyticsStoreSet('localStorage', 'fthr_analytics_consent', granted ? 'granted' : 'denied');
}

function sanitizeAnalyticsProps(props){
  const out = {};
  if (!props || typeof props !== 'object') return out;
  SAFE_PROPS.forEach(k => {
    const v = props[k];
    if (v == null) return;
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= 40 && v.indexOf('@') === -1) out[k] = v;
  });
  return out;
}

/* Has this event already fired in its scope? Marks it as fired if not. */
function analyticsFirstTime(event, props, dedupeKey){
  const scope = ANALYTICS_EVENTS[event];
  if (scope === 'free') return true;
  const suffix = dedupeKey || (event === 'paywall_viewed' ? (props.feature || '') : event === 'subscription_purchased' ? (props.required_tier || '') + ':' + (props.period || '') : '');
  const key = 'fthr_ev:' + event + (suffix ? ':' + suffix : '');
  if (scope === 'load'){ if (analyticsSeen.has(key)) return false; analyticsSeen.add(key); return true; }
  if (scope === 'session'){
    if (analyticsStoreGet('sessionStorage', key)) return false;
    analyticsStoreSet('sessionStorage', key, '1'); return true;
  }
  // 'person': keyed by the signed-in id so a second account on one browser still counts.
  // Not signed in yet (a sign-up waiting on its confirmation email): there is no
  // person to remember it against, so it is held for this tab only.
  const who = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser.id : null;
  const store = who ? 'localStorage' : 'sessionStorage';
  const pkey = key + ':' + (who || 'anon');
  if (analyticsStoreGet(store, pkey)) return false;
  analyticsStoreSet(store, pkey, '1'); return true;
}

/* Returns true when the event was emitted. */
function trackEvent(event, props, opts){
  if (!Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, event)){
    console.warn('Unknown analytics event:', event);
    return false;
  }
  const clean = sanitizeAnalyticsProps(props);
  if (!hasAnalyticsConsent()) return false;
  if (!analyticsFirstTime(event, clean, opts && opts.dedupeKey)) return false;
  const payload = Object.assign({ event, at: new Date().toISOString() }, clean);
  // A short tail, for looking at what just happened in a console.
  window.subliminallyEvents.push(payload);
  if (window.subliminallyEvents.length > 100) window.subliminallyEvents.shift();
  try { window.dispatchEvent(new CustomEvent('subliminally:analytics', { detail: payload })); } catch(e){}
  if (Array.isArray(window.dataLayer)) window.dataLayer.push(payload);
  if (typeof window.gtag === 'function') window.gtag('event', event, clean);
  return true;
}
