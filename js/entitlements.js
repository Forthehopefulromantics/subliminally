/* entitlements.js — one table of what each plan unlocks, and the small set of
   pieces that show it

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html.

   This file loads straight after billing.js because it builds on what is
   already there rather than beside it: PLANS is still the only place a price
   or a Stripe link is written down, TIER_ORDER/tierAtLeast still decide what
   outranks what, TIER_LENGTH_SECONDS still decides how long a session may run,
   and TIER_SUBLIMINAL_CAPS still decides how many may be saved. Nothing here
   keeps a second copy of any of it.

   What this file adds is the other half of a gate: not only "may you", but
   "what would it take, and why would you want it". Every locked control in the
   app used to answer that for itself, in its own words, next to its own
   <a href="#pricing">, which is how you end up with four ways of saying the
   same thing and a fifth that quietly says the wrong tier. Here a feature is
   named once, with the plan it needs and the one line that explains what it
   is for, and every lock, badge, modal and card reads off that row.

   The design rule this file exists to hold: premium features stay visible.
   Nothing is removed from a free account's screen. It is drawn muted, with a
   lock and the plan it belongs to, and it opens an explanation when tapped —
   never a page-load popup, never a redirect straight to pricing. */

/* ---------------- THE FEATURE TABLE ----------------
   One row per thing a plan sells, and one place to change it.

     tier     the minimum plan that may use it. For the session lengths this is
              left out and derived from requiredTierForMinutes() instead, so
              the durations cannot drift from TIER_LENGTH_SECONDS in billing.js.
     name     what it is called on screen, in a badge or a modal title.
     headline what the upgrade modal says first. Feature-specific, always.
     why      one short line on what it is *for*. Not a feature list.
     page     where it lives, for the analytics events only. */
const FEATURES = {
  /* ---- the builder ---- */
  subliminal_20min:  { minutes: 20,  name: '20-minute sessions', page: 'builder',
                       headline: 'Twenty minutes, yours tonight',
                       why: 'Long enough to fall asleep to — included on every free account.' },
  subliminal_1hr:    { minutes: 60,  name: '1-hour sessions', page: 'builder',
                       headline: 'Let it run for an hour ✦',
                       why: 'An hour carries you past the point where you stop listening and start absorbing — the drowsy window is where this work lands.' },
  subliminal_2hr:    { minutes: 120, name: '2-hour sessions', page: 'builder',
                       headline: 'Two hours, all the way under ✦',
                       why: 'Long enough to cover a full sleep cycle, so your affirmations are still playing when your mind is at its most open.' },
  subliminal_4hr:    { minutes: 240, name: '4-hour sessions', page: 'builder',
                       headline: 'Half the night, in your own voice ✦',
                       why: 'Four hours means you never wake up to silence halfway through — the session is still there when you turn over.' },
  subliminal_8hr:    { minutes: 480, name: '8-hour sessions', page: 'builder',
                       headline: 'Sleep with your subliminal tonight ✦',
                       why: 'Eight hours plays from the moment you close your eyes until your alarm — a whole night of your own voice, every night.' },
  soothing_layer:    { tier: 'whisper', name: 'Soothing layer', page: 'builder',
                       headline: 'Soften the whole session ✦',
                       why: 'A warm pad, soft chimes or a low hum underneath everything, so the frequency stops sounding like a tone and starts sounding like somewhere to rest.' },
  custom_track:      { tier: 'ritual', name: 'Your own track', page: 'builder',
                       headline: 'Build it on your own music ✦',
                       why: 'Layer the melody you already fall asleep to underneath your affirmations, instead of choosing from ours.' },
  layer_voice:       { tier: 'ritual', name: 'Second voice layer', page: 'builder',
                       headline: 'A second voice, quieter, underneath ✦',
                       why: 'A separate set of affirmations layered beneath the main ones — twice the repetition in the same session, without it ever feeling crowded.' },
  eft:               { tier: 'ritual', name: 'EFT tapping', page: 'builder',
                       headline: 'Tap into deeper change ✦',
                       why: 'Build the session as a full tapping round — a setup statement and one line for every point, in your own voice, with a pause to move your hands.' },
  visualization:     { tier: 'ritual', name: 'Visualization scripting', page: 'builder',
                       headline: 'Rehearse it before it happens ✦',
                       why: 'Write the scene in your own detail and play it back as one continuous script — mental rehearsal, in the voice you trust most.' },

  /* ---- saving what you build ---- */
  library_space:     { tier: 'whisper', name: 'More library space', page: 'library',
                       headline: 'Room for the whole practice ✦',
                       why: 'Whisper holds ten saved subliminals, Ritual holds as many as you build — one for sleep, one for the morning, one for the week you are having.' },

  /* ---- journal ---- */
  journal:           { tier: 'whisper', name: 'Gratitude journal', page: 'journal',
                       headline: 'Keep your own record ✦',
                       why: 'Three lines each morning is the whole practice — written in present tense, kept where you can read them back.' },
  manifestation:     { tier: 'whisper', name: 'Manifestation tracker', page: 'journal',
                       headline: 'Track your transformation ✦',
                       why: 'Write what has not arrived yet as though it already has, and watch the entries turn from asking into remembering.' },
  journal_voice:     { tier: 'whisper', name: 'Spoken entries', page: 'journal',
                       headline: 'Say it out loud instead ✦',
                       why: 'Some mornings you do not want to type. Record the entry in your own voice and it is kept exactly the same way.' },
  daily_log:         { tier: 'whisper', name: 'Daily log', page: 'rituals',
                       headline: 'Honour the page you wrote by hand ✦',
                       why: 'Photograph the journal you already keep and the calendar fills in around it — the app keeps the record, your notebook keeps the practice.' },

  /* ---- rituals ---- */
  habit_tracker:     { tier: 'ritual', name: 'Habit tracker', page: 'rituals',
                       headline: 'Build your 1% better routine ✦',
                       why: 'A morning and a night you actually keep: three habits to start, three more every twenty-one days practised, and a streak that forgives a missed day.' },
  habit_cycles:      { tier: 'ritual', name: 'Practice cycles', page: 'rituals',
                       headline: 'Twenty-one days, then twenty-one more ✦',
                       why: 'Every cycle you finish earns room for three more habits — the routine grows as you do, up to fifteen.' },
  habit_insights:    { tier: 'ritual', name: 'Streak history', page: 'rituals',
                       headline: 'See the whole run behind you ✦',
                       why: 'Every day you practised, coloured in on one calendar — the weeks you kept are far more convincing than any streak counter.' },
};

/* ---------------- ASKING THE TABLE ---------------- */
/* The plan a feature needs. Session lengths come off requiredTierForMinutes so
   there is exactly one place that knows 20 minutes is free and 8 hours is not. */
function featureRequiredTier(key){
  const f = FEATURES[key];
  if (!f) { console.warn('Unknown feature:', key); return 'ritual'; }
  if (f.minutes != null) return requiredTierForMinutes(f.minutes);
  return f.tier || 'none';
}
function featureName(key){ return (FEATURES[key] && FEATURES[key].name) || 'This feature'; }
/* The feature row for a session length, so the builder's chips and the slider
   answer to the same table. Unknown lengths fall back to the nearest plan the
   minutes themselves require. */
function featureForMinutes(minutes){
  return Object.keys(FEATURES).find(k => FEATURES[k].minutes === minutes) || null;
}
/* The same question for a length that is not one of the presets — the slider
   sits anywhere between five minutes and eight hours. It answers with the
   shortest row that still covers it, so a forty-five minute session explains
   itself with the hour rather than selling somebody the whole night. */
const DURATION_FEATURES = Object.keys(FEATURES)
  .filter(k => FEATURES[k].minutes != null)
  .sort((a, b) => FEATURES[a].minutes - FEATURES[b].minutes);
function featureCoveringMinutes(minutes){
  return DURATION_FEATURES.find(k => minutes <= FEATURES[k].minutes) || DURATION_FEATURES[DURATION_FEATURES.length - 1];
}
/* Does this tier reach this feature? Synchronous — for drawing, where the tier
   is already in hand. */
function tierHasFeature(tier, key){ return tierAtLeast(tier || 'none', featureRequiredTier(key)); }
/* Does the person signed in right now? Asks the subscriber row (cached). */
async function canUseFeature(key){
  if (!currentUser) return featureRequiredTier(key) === 'none';
  return tierHasFeature(await getMyTier(), key);
}
/* FREE / WHISPER / RITUAL, for a badge. TIER_LABEL is the sentence-shaped name
   ("a free account", "Whisper") and stays the one used in prose. */
function tierShortName(tier){ return tier === 'none' ? 'FREE' : (PLANS[tier] ? PLANS[tier].label.toUpperCase() : 'FREE'); }
function tierMark(tier){ return tier === 'ritual' ? '★' : tier === 'whisper' ? '✦' : ''; }
/* What a plan costs, read off the catalog rather than written out again. */
function tierPriceText(tier){
  const monthly = planFor(tier, 'monthly'), annual = planFor(tier, 'annual');
  if (!monthly) return '';
  const money = c => '$' + (c / 100).toFixed(2).replace(/\.00$/, '');
  return annual ? `${money(monthly.amountCents)} a month, or ${money(annual.amountCents)} a year`
                : `${money(monthly.amountCents)} a month`;
}
/* The next rung up from where you are, for "what would upgrading get me". */
function tierAbove(tier){
  const i = TIER_ORDER.indexOf(tier || 'none');
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}
/* How much room a plan gives you in the library. Infinity on Ritual. */
function tierLibraryCap(tier){ return TIER_SUBLIMINAL_CAPS[tier || 'none']; }

function pwEscape(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ---------------- ANALYTICS ----------------
   There is no analytics provider in this app, and this is not the task that
   should add one. So the events are emitted rather than sent: a DOM event
   anything can listen to, plus the two globals a tag manager or gtag snippet
   would already have put on the page if one were installed. Drop a provider in
   later and it picks these up without a line changing here.

   Every event carries the same four things — page, feature, required_tier,
   current_tier — because a paywall number is meaningless without them. */
const PAYWALL_EVENTS = ['paywall_viewed','locked_feature_clicked','upgrade_cta_clicked','paywall_dismissed','checkout_started','subscription_completed'];
window.subliminallyEvents = window.subliminallyEvents || [];
function trackPaywall(event, props){
  // The list above is the contract with whoever reads these later; a typo in an
  // event name is otherwise a silent hole in a funnel nobody notices for weeks.
  if (!PAYWALL_EVENTS.includes(event)) console.warn('Unknown paywall event:', event);
  const payload = Object.assign({ event, at: new Date().toISOString() }, props || {});
  // A short tail, for looking at what just happened in a console.
  window.subliminallyEvents.push(payload);
  if (window.subliminallyEvents.length > 100) window.subliminallyEvents.shift();
  try { window.dispatchEvent(new CustomEvent('subliminally:analytics', { detail: payload })); } catch(e){}
  if (Array.isArray(window.dataLayer)) window.dataLayer.push(payload);
  if (typeof window.gtag === 'function') window.gtag('event', event, payload);
}
/* The four fields every paywall event carries. `tier` is passed in where the
   caller already knows it, so drawing a locked row doesn't cost a round trip. */
function paywallContext(key, tier, extra){
  return Object.assign({
    page: (FEATURES[key] && FEATURES[key].page) || currentPageName(),
    feature: key,
    required_tier: featureRequiredTier(key),
    current_tier: tier || lastKnownTier(),
  }, extra || {});
}
/* Which screen this happened on. data-view is how the app already knows. */
function currentPageName(){ return document.body.getAttribute('data-view') || 'home'; }
/* The tier without waiting: what Today cached for its first paint. Used for
   labelling events and drawing locks, never for deciding access. */
function lastKnownTier(){
  if (typeof todayTier === 'string') return todayTier;
  try { return localStorage.getItem('fthr_tier') || 'none'; } catch(e){ return 'none'; }
}

/* ---------------- <PremiumBadge /> ----------------
   The tiny word that says which plan something belongs to. Lavender for
   Whisper, gold for Ritual — the two colours the tier badge on the profile
   has always used. */
function premiumBadge(tier, opts){
  const o = opts || {};
  if (!tier || tier === 'none') return '';
  return `<span class="premium-badge" data-tier="${tier}"${o.small ? ' data-size="sm"' : ''}>${
    o.mark === false ? '' : `<span class="pb-mark" aria-hidden="true">${tierMark(tier)}</span>`
  }${pwEscape(o.label || tierShortName(tier))}</span>`;
}
function featureBadge(key, opts){ return premiumBadge(featureRequiredTier(key), opts); }
/* The lock. Small, thin-stroked, the same drawing as the one already used on
   the journal's locked panel. */
function lockGlyph(size){
  const s = size || 11;
  return `<svg class="lock-ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}

/* ---------------- <LockedFeature /> ----------------
   Two shapes, one row of the table behind both.

   `lockedControl` dresses a control that already exists — a chip, a toggle
   row, a label — so the thing stays exactly where it was and simply reads as
   locked. `lockedCard` draws a whole preview card for a feature the person
   cannot open yet, which is how a locked prompt or session category is shown
   without hiding what it is. */
function lockedControl(el, key, tier){
  if (!el) return;
  const locked = !tierHasFeature(tier, key);
  el.classList.toggle('is-locked', locked);
  el.dataset.feature = key;
  const needed = featureRequiredTier(key);
  let tag = el.querySelector('.locked-tag');
  if (!locked){ if (tag) tag.remove(); el.removeAttribute('aria-describedby'); return; }
  if (!tag){ tag = document.createElement('span'); tag.className = 'locked-tag'; el.appendChild(tag); }
  tag.innerHTML = lockGlyph(10) + premiumBadge(needed, { small: true });
  tag.title = `${featureName(key)} — ${TIER_LABEL[needed]}`;
}
/* The lock-and-badge pair on its own, for a label that names a premium control
   rather than being one. Empty for anybody who already has it, so a Ritual
   member is not told which plan they are on three times down one screen. */
function lockSlot(id, key, tier){
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  if (tierHasFeature(tier, key)){ el.innerHTML = ''; return; }
  const needed = featureRequiredTier(key);
  el.innerHTML = `<button type="button" class="locked-tag" onclick="openUpgradeModal('${key}', { trigger:'label_lock' })"
    aria-label="${pwEscape(featureName(key))} — ${pwEscape(TIER_LABEL[needed])}, see what it unlocks"
    style="background:none;border:none;padding:0;cursor:pointer;">${lockGlyph(10)}${premiumBadge(needed, { small: true })}</button>`;
}

/* A locked preview card: the name, one line of what it is, a lock and a badge.
   Tapping it explains; it never silently does nothing. */
function lockedCard(key, o){
  const opts = o || {};
  const needed = featureRequiredTier(key);
  const locked = opts.locked !== false;
  const title = pwEscape(opts.title || featureName(key));
  const body = pwEscape(opts.body || (FEATURES[key] && FEATURES[key].why) || '');
  const action = locked
    ? `openUpgradeModal('${key}', { trigger: ${JSON.stringify(opts.trigger || 'locked_card')} })`
    : (opts.onOpen || '');
  return `<button type="button" class="locked-card${locked ? ' is-locked' : ''}" data-feature="${key}"
      onclick="${pwEscape(action)}"${locked ? ` aria-label="${title} — locked, ${pwEscape(TIER_LABEL[needed])}"` : ''}>
    <span class="lc-top">
      <span class="lc-title">${title}${locked ? ' ' + lockGlyph(11) : ''}</span>
      ${locked ? premiumBadge(needed, { small: true }) : ''}
    </span>
    ${body ? `<span class="lc-body">${body}</span>` : ''}
    <span class="lc-cta">${locked ? 'Unlock' : (opts.openLabel || 'Open')} →</span>
  </button>`;
}

/* ---------------- <PlanLimit /> ----------------
   How much of your plan you have used, said plainly, with the way to get more
   sitting quietly beside it. It is drawn for every tier, including Ritual,
   because "Unlimited subliminals" is information a member paid for and should
   get to see. */
function planLimitMarkup(used, tier, opts){
  const o = opts || {};
  const cap = tierLibraryCap(tier);
  const unlimited = !(cap < Infinity);
  const full = !unlimited && used >= cap;
  const pct = unlimited ? 100 : Math.min(100, Math.round((used / cap) * 100));
  return `<div class="plan-limit${full ? ' is-full' : ''}" data-tier="${tier}">
    <div class="plan-limit-row">
      <span class="plan-limit-text">${unlimited ? 'Unlimited subliminals' : `${used} of ${cap} subliminal${cap === 1 ? '' : 's'} saved`}</span>
      ${unlimited ? '' : `<button type="button" class="plan-limit-cta" onclick="openUpgradeModal('library_space', { trigger:'plan_limit' })">Unlock more space ✦</button>`}
    </div>
    ${unlimited ? '' : `<div class="plan-limit-track" role="img" aria-label="${used} of ${cap} saved"><span class="plan-limit-fill" style="width:${pct}%"></span></div>`}
    ${full ? `<div class="plan-limit-note">You can still open and play everything here — it is saving a new one that needs more room.</div>` : (o.note ? `<div class="plan-limit-note">${pwEscape(o.note)}</div>` : '')}
  </div>`;
}

/* ---------------- <UpgradeModal /> ----------------
   The one contextual sheet. It opens on a tap, never on a page load, and it
   says what *that* feature is for rather than listing a plan.

   Frequency is the whole difficulty with a thing like this, so it is handled
   in one place instead of at each call site:

     - a tap is always answered. Somebody who taps a lock twice is asking
       twice, and a sheet that refuses to reopen reads as a broken button;
     - anything the app decides to show by itself passes `auto:true`, and that
       is shown once per feature per session and never while something is in
       progress — a session playing, a journal entry half typed, onboarding,
       a habit check-in, another dialog already open. */
const paywallSeen = new Set();
let paywallOpenFor = null;
/* Is the person in the middle of something? Then nothing volunteers itself. */
function paywallBusy(){
  if (typeof finalPlaying !== 'undefined' && finalPlaying) return true;            // a session is playing
  const dialogOpen = ['authOverlay','askOverlay','dayModalOverlay'].some(id => {
    const el = document.getElementById(id); return el && el.classList.contains('open');
  });
  if (dialogOpen) return true;
  const shellOpen = ['onboardOverlay','habitOnboardOverlay'].some(id => {
    const el = document.getElementById(id); return el && el.classList.contains('open');
  });
  if (shellOpen) return true;                                                      // onboarding, either one
  const voiceRec = document.getElementById('journalVoiceRec');
  if (voiceRec && voiceRec.style.display !== 'none') return true;                   // recording an entry
  const typing = document.activeElement;
  if (typing && /^(INPUT|TEXTAREA)$/.test(typing.tagName) && typing.value) return true;  // mid-sentence
  return false;
}
function openUpgradeModal(key, opts){
  const o = opts || {};
  const f = FEATURES[key];
  if (!f){ console.warn('openUpgradeModal: unknown feature', key); return; }
  const needed = featureRequiredTier(key);
  const tier = o.tier || lastKnownTier();
  const ctx = paywallContext(key, tier, { trigger: o.trigger || 'locked_feature' });

  if (!o.auto) trackPaywall('locked_feature_clicked', ctx);
  if (o.auto && (paywallSeen.has(key) || paywallBusy())) return;

  const overlay = document.getElementById('upgradeOverlay');
  if (!overlay){
    // No markup on this page: say the one thing that matters and stop.
    if (typeof alert === 'function') alert(`${f.headline}\n\n${f.why}`);
    return;
  }
  paywallOpenFor = key;
  paywallSeen.add(key);

  const card = document.getElementById('upgradeModalCard');
  if (card) card.dataset.tier = needed;

  document.getElementById('upgradeModalBadge').innerHTML = premiumBadge(needed) + lockGlyph(12);
  document.getElementById('upgradeModalTitle').textContent = o.headline || f.headline;
  document.getElementById('upgradeModalWhy').textContent = o.why || f.why;
  document.getElementById('upgradeModalPlan').innerHTML =
    `<span class="um-plan-label">Included with</span>
     <span class="um-plan-name">${pwEscape(PLANS[needed] ? PLANS[needed].label : TIER_LABEL[needed])}</span>
     <span class="um-plan-price">${pwEscape(tierPriceText(needed))}</span>`;

  const cta = document.getElementById('upgradeModalCta');
  cta.textContent = currentUser ? `Explore ${PLANS[needed] ? PLANS[needed].label : 'plans'}` : 'Create a free account';
  cta.onclick = () => upgradeFromModal(key, needed);

  overlay.classList.add('open');
  document.body.classList.add('paywall-open');
  trackPaywall('paywall_viewed', ctx);
  setTimeout(() => cta.focus({ preventScroll: true }), 40);
}
function closeUpgradeModal(reason){
  const overlay = document.getElementById('upgradeOverlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  document.body.classList.remove('paywall-open');
  if (paywallOpenFor) trackPaywall('paywall_dismissed', paywallContext(paywallOpenFor, null, { reason: reason || 'close' }));
  paywallOpenFor = null;
}
/* The primary action. It is not a checkout: it is the plan, laid out, with the
   card you would be buying already in front of you. The sheet was the step
   between the tap and the sales page — this is the step after it. */
function upgradeFromModal(key, needed){
  trackPaywall('upgrade_cta_clicked', paywallContext(key, null, { destination: currentUser ? 'pricing' : 'signup' }));
  const overlay = document.getElementById('upgradeOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.classList.remove('paywall-open');
  paywallOpenFor = null;
  if (!currentUser){ openAuthModal('signup'); return; }
  showMarketingHome();
  goTo('pricing');
  spotlightPlanCard(needed);
}
/* A soft ring around the card they came here for, so a two-card pricing page
   does not make them look for it. Wears off on its own. */
function spotlightPlanCard(tier){
  const card = document.getElementById(tier === 'ritual' ? 'priceCardRitual' : 'priceCardWhisper');
  if (!card) return;
  card.classList.add('plan-spotlight');
  setTimeout(() => card.classList.remove('plan-spotlight'), 2600);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeUpgradeModal('escape'); });

/* ---------------- <UpgradeCard /> ----------------
   One card, somewhere down the dashboard, personalised to the plan you are on.
   Not a banner, not at the top, and never two of them at once.

   Which benefit it offers is picked rather than rotated blindly: the ones this
   person has some reason to care about come first — a short session saved,
   nothing written yet, no routine set up — and a day-of-year offset breaks the
   tie, so the card changes over a week instead of showing the same line every
   morning. */
const UPGRADE_BENEFITS = [
  { feature:'subliminal_8hr',  headline:'Sleep with your subliminal tonight ✦', body:'Unlock sessions up to 8 hours — your own voice, from lights out to your alarm.' },
  { feature:'habit_tracker',   headline:'Build your 1% better routine ✦',       body:'A morning and a night you keep, three habits at a time, growing every 21 days.' },
  { feature:'journal',         headline:'Go deeper with your practice ✦',       body:'Unlock journaling, habits, EFT and visualization — the whole practice, not just the sessions.' },
  { feature:'eft',             headline:'Tap into deeper change ✦',             body:'Build a full EFT tapping round into a session, in the voice you trust most.' },
  { feature:'visualization',   headline:'Rehearse it before it happens ✦',      body:'Write the scene in your own detail and play it back as one continuous script.' },
  { feature:'library_space',   headline:'Room for the whole practice ✦',        body:'One subliminal for sleep, one for the morning, one for the week you are having.' },
];
/* Reasons to show one benefit over another, read off what is already loaded on
   Today. Anything unknown simply scores nothing — this never waits on a fetch. */
function upgradeBenefitScore(b){
  try { return upgradeBenefitScoreFrom(b); } catch(e){ return 0; }   // a card is never worth an error
}
function upgradeBenefitScoreFrom(b){
  let score = 0;
  if (b.feature === 'subliminal_8hr' && typeof todayNewestSub !== 'undefined' && todayNewestSub
      && (todayNewestSub.duration_seconds || 0) <= 1200) score += 3;
  if (b.feature === 'library_space' && typeof todaySubs !== 'undefined' && Array.isArray(todaySubs)
      && todaySubs.length >= tierLibraryCap(lastKnownTier())) score += 4;
  if (b.feature === 'habit_tracker' && typeof habitsCache !== 'undefined' && !habitsCache.length) score += 2;
  if (b.feature === 'journal' && lastKnownTier() === 'none') score += 1;
  return score;
}
function pickUpgradeBenefit(tier){
  const open = UPGRADE_BENEFITS.filter(b => !tierHasFeature(tier, b.feature));
  if (!open.length) return null;
  const day = Math.floor(Date.now() / 86400000);
  let best = null, bestScore = -1;
  open.forEach((b, i) => {
    const s = upgradeBenefitScore(b) * 10 + ((day + i) % open.length);
    if (s > bestScore){ bestScore = s; best = b; }
  });
  return best;
}
/* The card itself. Returns '' for anyone with nothing left to unlock, which is
   how a Ritual member sees no marketing on their own home screen. */
function upgradeCardMarkup(tier){
  const b = pickUpgradeBenefit(tier);
  if (!b) return '';
  const needed = featureRequiredTier(b.feature);
  return `<div class="upgrade-card" data-tier="${needed}">
    <div class="upgrade-card-head">
      <span class="today-card-label">Included with ${pwEscape(PLANS[needed].label)}</span>
      ${premiumBadge(needed, { small: true })}
    </div>
    <h3>${pwEscape(b.headline)}</h3>
    <p>${pwEscape(b.body)}</p>
    <button type="button" class="btn btn-ghost" onclick="openUpgradeModal('${b.feature}', { trigger:'discovery_card' })">Explore ${pwEscape(PLANS[needed].label)}</button>
  </div>`;
}
/* Drawn on Today, low down, and only ever one. Hidden entirely on Ritual. */
function renderUpgradeDiscoveryCard(){
  const host = document.getElementById('todayUpgradeCard');
  if (!host) return;
  const tier = lastKnownTier();
  const html = (typeof todayPainted === 'undefined' || todayPainted) ? upgradeCardMarkup(tier) : '';
  host.innerHTML = html;
  host.style.display = html ? 'block' : 'none';
}

/* ---------------- the plan ladder ----------------
   Free → Whisper → Ritual, on the profile, with where you are marked. This is
   the one place in the app that is allowed to be about plans rather than about
   a feature, because it is the screen where somebody went looking. */
function planLadderMarkup(tier){
  const rungs = TIER_ORDER.map(t => ({
    tier: t,
    label: t === 'none' ? 'Free' : PLANS[t].label,
    here: t === tier,
    have: tierAtLeast(tier, t),
  }));
  return `<div class="plan-ladder" data-tier="${tier}">
    <ol class="plan-ladder-rungs">
      ${rungs.map(r => `<li class="plan-rung${r.have ? ' is-have' : ''}${r.here ? ' is-here' : ''}">
        <span class="pr-dot" aria-hidden="true">${r.have ? '✓' : ''}</span>
        <span class="pr-label">${pwEscape(r.label)}</span>
        ${r.here ? '<span class="pr-you">You are here</span>' : ''}
      </li>`).join('')}
    </ol>
    ${planLadderNext(tier)}
  </div>`;
}
/* What the next rung adds, in the words the feature table already uses. No
   price shouting, no countdown — a list and a way to read more. */
const LADDER_UNLOCKS = {
  whisper: ['subliminal_2hr','soothing_layer','journal','manifestation','daily_log','library_space'],
  ritual:  ['subliminal_8hr','habit_tracker','eft','visualization','custom_track','layer_voice'],
};
function planLadderNext(tier){
  const next = tierAbove(tier);
  if (!next) return `<p class="plan-ladder-note">You are on ${pwEscape(PLANS.ritual.label)} — everything in Subliminally is open to you.</p>`;
  const keys = LADDER_UNLOCKS[next] || [];
  return `<details class="plan-ladder-next">
    <summary>What ${pwEscape(PLANS[next].label)} unlocks <span aria-hidden="true">↓</span></summary>
    <ul class="plan-ladder-list">
      ${keys.map(k => `<li>${lockGlyph(10)}<b>${pwEscape(featureName(k))}</b> — ${pwEscape(FEATURES[k].why)}</li>`).join('')}
    </ul>
    <button type="button" class="btn btn-ghost" onclick="openUpgradeModal('${keys[0]}', { trigger:'plan_ladder' })">See ${pwEscape(PLANS[next].label)} ✦</button>
  </details>`;
}
