/* billing.js — checkout, RevenueCat, tiers, and saving a subliminal

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------------- THE PLAN CATALOG ----------------
   One table, one place. Everything that decides *what a tier sells* lives
   here: the Stripe Payment Link the web sends you to, the price that link has
   to charge, the App Store / Play product the native apps buy, and the
   RevenueCat entitlement that proves you own it. Nothing else in the app
   keeps a second copy of any of these — read them from here.

   Keeping them on one row per tier and billing period is the point. These are
   opaque pasted-in strings; a link pasted onto the wrong row is invisible at a
   glance and just as invisible in a diff, and what it looks like in the wild
   is a plan whose button opens somebody else's checkout. Side by side with the
   tier and the price they belong to, a wrong paste has something to disagree
   with — and assertPlanCatalog() below refuses to let two rows share a link.

   amountCents is what the linked Stripe price must charge. The Stripe webhook
   (api/stripe-webhook.js) works out which tier a payment bought from the
   amount charged, so these numbers and AMOUNT_TO_PLAN over there are the two
   ends of one contract: change a price in Stripe and both have to move.

   priceId is the Stripe price each link is supposed to sell. Nothing reads it
   at runtime — a Payment Link carries its own price, and the webhook goes by
   the amount charged. It's written down because it's the only thing that says,
   in the repo, which Stripe object a row is claiming: the link is an opaque
   URL, and two rows quietly holding one price is a thing you can otherwise
   only find out from a customer. Leave a row's priceId null rather than guess
   at it — the check below reads null as "not written down yet" and says
   nothing, which is the honest state to be in.

   To wire or re-create a Payment Link: Stripe -> Payment Links. Each link's
   own page names the product and price it sells. Paste the buy.stripe.com URL
   onto that product's row here, and nowhere else. */
const PLANS = {
  whisper: {
    label: 'Whisper',
    entitlementId: 'whisper',   // RevenueCat -> Entitlements
    periods: {
      monthly: {
        amountCents: 555,       // $5.55/mo
        priceId: 'price_1UFRCkBiVHYI4vcXmZLmHBCH',
        link: 'https://buy.stripe.com/dRmfZgblY6gXfLNcT3gYU04',
        productId: 'com.fthr.subliminally.whisper.monthly',
      },
      annual: {
        amountCents: 5500,      // $55/yr
        priceId: 'price_1UFRDzBiVHYI4vcX8QFMCHuQ',
        link: 'https://buy.stripe.com/6oUfZg3TwdJp5795qBgYU05',
        productId: 'com.fthr.subliminally.whisper.annual',
      },
    },
  },
  ritual: {
    label: 'Ritual',
    entitlementId: 'ritual',
    periods: {
      monthly: {
        amountCents: 1111,      // $11.11/mo
        priceId: 'price_1UFRBTBiVHYI4vcXVfzNDr9I',
        link: 'https://buy.stripe.com/14AeVc75IaxdgPRg5fgYU03',
        productId: 'com.fthr.subliminally.ritual.monthly',
      },
      annual: {
        amountCents: 11100,     // $111/yr
        priceId: 'price_1UFREXBiVHYI4vcXXZ2sArIc',
        link: 'https://buy.stripe.com/bJecN4cq220H4356uFgYU06',
        productId: 'com.fthr.subliminally.ritual.annual',
      },
    },
  },
};

/* The one way to ask what a tier sells. Everything that opens a checkout —
   web or native — goes through this, so there is no second lookup to get
   wrong. Returns null for a tier or period that isn't sold. */
function planFor(tier, period){
  const plan = PLANS[tier];
  if (!plan) return null;
  return plan.periods[period || 'monthly'] || null;
}

/* Catches the ways the table above goes wrong in practice: a row left on its
   placeholder, and one link, store product or Stripe price sitting on two
   rows, which is how a tier quietly starts selling another tier's plan. Runs at
   load, so it surfaces in the console on the deploy that introduced it rather
   than in somebody's checkout. It can only catch a link used *twice* — a link
   that points at the wrong product and is used once looks fine from here, so
   the Stripe dashboard is still the thing that has the last word on which URL
   belongs on which row. */
function assertPlanCatalog(){
  const problems = [];
  const seenLink = new Map();
  const seenProduct = new Map();
  const seenPrice = new Map();
  for (const tier of Object.keys(PLANS)){
    for (const period of Object.keys(PLANS[tier].periods)){
      const row = PLANS[tier].periods[period];
      const where = tier + '/' + period;
      if (!row.link || row.link.startsWith('REPLACE_')){
        problems.push(where + ' has no Stripe Payment Link yet');
      } else if (seenLink.has(row.link)){
        problems.push(where + ' and ' + seenLink.get(row.link) + ' share one Stripe Payment Link (' + row.link + ') — one of them is selling the other one’s plan');
      } else {
        seenLink.set(row.link, where);
      }
      if (seenProduct.has(row.productId)) problems.push(where + ' and ' + seenProduct.get(row.productId) + ' share one store product (' + row.productId + ')');
      else seenProduct.set(row.productId, where);
      if (!row.priceId) continue;   // not written down yet — nothing to check
      if (seenPrice.has(row.priceId)) problems.push(where + ' and ' + seenPrice.get(row.priceId) + ' claim one Stripe price (' + row.priceId + '), which can only charge one amount on one interval');
      else seenPrice.set(row.priceId, where);
    }
  }
  if (problems.length) console.error('Plan catalog is wrong:\n  ' + problems.join('\n  '));
  return problems;
}
assertPlanCatalog();

/* ---------------- CHECKOUT LINKING ----------------
   Web keeps the existing Stripe Payment Links. The native apps can't use
   those — Apple/Google require subscriptions sold inside the app to go
   through their own billing — so on native this hands off to RevenueCat
   instead. See the RevenueCat block below for the purchase flow itself. */
/* The pricing cards open on the yearly price and toggle down to monthly. The
   static figures in index.html are rendered at this same period — they're what
   shows until someone touches the toggle, so the two have to agree. */
let billingPeriod = 'annual'; // 'monthly' | 'annual'

function setBillingPeriod(period){
  billingPeriod = period;
  document.querySelectorAll('#billingToggle button').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  document.querySelectorAll('.price-figure, .price-period').forEach(el => { el.textContent = el.dataset[period]; });
}

/* What we tell Stripe this checkout was *meant* to be. The user id is what the
   webhook needs to find the account; the plan tag after it is what lets the
   webhook compare the plan the button offered against the amount Stripe
   actually charged, and say so loudly when a Payment Link is pointed at the
   wrong product. Stripe allows letters, digits, dashes and underscores here,
   which is why the two halves are joined with a double underscore. */
function checkoutReference(userId, tier, period){
  return userId + '__' + tier + '_' + period;
}

function goToCheckout(evt, tier){
  evt.preventDefault();
  if (!currentUser){
    openAuthModal();
    document.getElementById('authSub').textContent = 'Create an account first, then tap the plan again — this is how we link your subscription to your account.';
    return false;
  }
  if (isNativeApp()){
    if (typeof trackPaywall === 'function') trackPaywall('checkout_started', { page: currentPageName(), feature: null, required_tier: tier, current_tier: lastKnownTier(), period: billingPeriod, via: 'revenuecat' });
    purchaseTier(tier, billingPeriod);
    return false;
  }
  const row = planFor(tier, billingPeriod);
  if (!row || !row.link || row.link.startsWith('REPLACE_')){
    const msg = document.getElementById('pricingPurchaseMsg');
    msg.textContent = "Checkout for this plan isn't connected yet — check back soon.";
    msg.className = 'save-msg err';
    return false;
  }
  if (typeof trackPaywall === 'function') trackPaywall('checkout_started', { page: currentPageName(), feature: null, required_tier: tier, current_tier: lastKnownTier(), period: billingPeriod, via: 'stripe' });
  window.open(row.link + '?client_reference_id=' + encodeURIComponent(checkoutReference(currentUser.id, tier, billingPeriod)), '_blank');
  return false;
}

/* ---------------- REVENUECAT (native subscription purchases) ----------------
   Currently set to a RevenueCat Test Store key — that's RevenueCat's sandbox
   for exercising the whole purchase flow with fake products before real
   App Store/Play Store subscriptions exist or have been approved. It's the
   same key for both platforms because Test Store isn't platform-specific.
   Once your real subscriptions are live in App Store Connect / Google Play
   Console, replace these with the real per-platform public keys from
   RevenueCat dashboard -> Project -> API keys -> "Public app-specific keys".
   All of these are public keys (safe to ship in the app), not secrets. */
const REVENUECAT_API_KEY_IOS = 'test_BFAnoyuXlkSVafvsTxJTgiStDoB';
const REVENUECAT_API_KEY_ANDROID = 'test_BFAnoyuXlkSVafvsTxJTgiStDoB';

// The store products and entitlements themselves live on each tier's row in
// PLANS at the top of this file — they have to be created to match in App
// Store Connect / Google Play Console / RevenueCat, and the entitlement ids
// are attached to both of a tier's products in the RevenueCat dashboard
// (Entitlements tab).

function initRevenueCat(){
  if (!isNativeApp() || !window.Capacitor.Plugins.Purchases) return;
  const { Purchases } = window.Capacitor.Plugins;
  const apiKey = window.Capacitor.getPlatform() === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
  if (!apiKey || apiKey.startsWith('YOUR_')) { console.warn('RevenueCat API key not set yet — native purchases are disabled.'); return; }
  Purchases.configure({ apiKey });
  // Apple requires a visible way to restore purchases in any app with subscriptions.
  ['restorePurchasesRow', 'profileRestoreRow'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = id === 'restorePurchasesRow' ? 'inline' : 'block'; });
}
async function restorePurchases(){
  const targets = ['pricingPurchaseMsg', 'restoreMsg'].map(id => document.getElementById(id)).filter(Boolean);
  const say = (text, cls) => targets.forEach(el => { el.textContent = text; el.className = 'save-msg' + (cls ? ' ' + cls : ''); });
  if (!isNativeApp() || !window.Capacitor.Plugins.Purchases){ say('Restore is only needed in the app.', 'err'); return; }
  say('Checking with the store…');
  try {
    const { customerInfo } = await window.Capacitor.Plugins.Purchases.restorePurchases();
    const active = Object.keys(customerInfo.entitlements.active);
    if (active.length){
      say(`Restored — ${TIER_LABEL[active.includes('ritual') ? 'ritual' : 'whisper']} is back on this device.`, 'ok');
      setTimeout(() => { forgetFetch('tier'); applyPricingVisibility(); }, 1500);
    } else {
      say('No active subscription found for this Apple ID / Google account.');
    }
  } catch (e){
    console.error('restorePurchases error:', e);
    say((e && e.message) || 'Could not restore right now — try again.', 'err');
  }
}
// Ties each purchase to the Supabase account rather than an anonymous
// RevenueCat-generated ID, so the webhook below can upsert `subscribers`
// straight off auth.uid().
async function syncRevenueCatIdentity(){
  if (!isNativeApp() || !window.Capacitor.Plugins.Purchases) return;
  const { Purchases } = window.Capacitor.Plugins;
  try {
    if (currentUser) await Purchases.logIn({ appUserID: currentUser.id });
    else await Purchases.logOut();
  } catch (e){ console.warn('RevenueCat identity sync failed:', e); }
}

async function purchaseTier(tier, period){
  const msg = document.getElementById('pricingPurchaseMsg');
  if (!window.Capacitor.Plugins.Purchases){ msg.textContent = 'Purchases are not available on this build yet.'; msg.className = 'save-msg err'; return; }
  const { Purchases } = window.Capacitor.Plugins;
  msg.textContent = 'Loading plan…'; msg.className = 'save-msg';
  try {
    const { current } = await Purchases.getOfferings();
    const row = planFor(tier, period);
    const pkg = row && current?.availablePackages.find(p => p.product.identifier === row.productId);
    if (!pkg){
      msg.textContent = "That plan isn't set up yet — check back soon.";
      msg.className = 'save-msg err';
      return;
    }
    msg.textContent = 'Opening purchase…'; msg.className = 'save-msg';
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    const entitlementId = PLANS[tier].entitlementId;
    if (customerInfo.entitlements.active[entitlementId]){
      msg.textContent = "You're in — welcome to " + TIER_LABEL[tier] + '.';
      msg.className = 'save-msg ok';
      if (typeof trackPaywall === 'function') trackPaywall('subscription_completed', { page: currentPageName(), feature: null, required_tier: tier, current_tier: tier, period: period, via: 'revenuecat' });
      // The RevenueCat webhook updates the subscribers table server-side;
      // give it a moment to land, then refresh what the pricing page shows.
      setTimeout(() => { forgetFetch('tier'); applyPricingVisibility(); }, 1500);
    } else {
      msg.textContent = 'Purchase completed, but the plan is taking a moment to activate — check back shortly.';
      msg.className = 'save-msg';
    }
  } catch (e){
    if (e && e.userCancelled) { msg.textContent = ''; return; }
    console.error('Purchase failed:', e);
    msg.textContent = (e && e.message) || 'Something went wrong with the purchase — try again.';
    msg.className = 'save-msg err';
  }
}

// Stripe's billing portal only knows about web subscriptions; App Store /
// Play Store subscriptions are managed in the platform's own screen instead.
function updateManageSubscriptionLinks(){
  let url = 'https://billing.stripe.com/p/login/28EdR8eyacFlczB6uFgYU00';
  let label = 'Manage your subscription →';
  if (isNativeApp()){
    const platform = window.Capacitor.getPlatform();
    url = platform === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';
    label = platform === 'ios' ? 'Manage in the App Store →' : 'Manage in Google Play →';
  }
  ['pricingManageSubLink', 'profileManageSubLink'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.href = url;
    el.textContent = label;
  });
}

/* ---------------- ACCOUNT-GATED SAVE ---------------- */
// Matches the durations promised on the pricing cards.
const TIER_ORDER = ['none','whisper','ritual'];
const TIER_LENGTH_SECONDS = { none: 1200, whisper: 7200, ritual: 28800 };
// Names come off the plan catalog, so a tier is called one thing everywhere.
const TIER_LABEL = Object.keys(PLANS).reduce((acc, tier) => { acc[tier] = PLANS[tier].label; return acc; }, { none: 'a free account' });
function tierAtLeast(myTier, requiredTier){
  return TIER_ORDER.indexOf(myTier) >= TIER_ORDER.indexOf(requiredTier);
}
/* Maps a chosen session length (in minutes, from the 5min–8hr slider) to the minimum
   tier that's allowed to actually generate/save a session that long. */
function requiredTierForMinutes(minutes){
  for (const tier of TIER_ORDER){ if (minutes*60 <= TIER_LENGTH_SECONDS[tier]) return tier; }
  return 'ritual';
}

async function getMyTier(){
  const subRow = await getMySubscriberRow();
  const validStatuses = ['active', 'trialing'];
  const tier = (subRow && validStatuses.includes(subRow.status) && subRow.tier) ? subRow.tier : 'none';
  // Reverie was retired; anyone still on it keeps everything they paid for.
  return tier === 'reverie' ? 'ritual' : tier;
}

/* Show pricing as an upsell only for tiers above what you already have.
   Ritual members see no marketing here at all — just account management. */
async function applyPricingVisibility(){
  const myTier = await getMyTier();
  const cards = { free: document.getElementById('priceCardFree'), whisper: document.getElementById('priceCardWhisper'), ritual: document.getElementById('priceCardRitual') };
  const head = document.getElementById('pricingHead');
  const grid = document.getElementById('pricingGrid');
  const toggle = document.getElementById('billingToggle');
  const thanks = document.getElementById('pricingRitualThanks');
  const footnote = document.getElementById('pricingFootnote');
  const manageSub = document.getElementById('pricingManageSub');
  if (!cards.whisper) return; // pricing markup not present yet

  Object.values(cards).forEach(c => c.style.display = '');
  const freeBtn = document.getElementById('priceCardFreeBtn');
  if (currentUser){ freeBtn.textContent = 'Your current plan'; freeBtn.disabled = true; }
  else { freeBtn.textContent = 'Create a free account'; freeBtn.disabled = false; }

  if (myTier === 'ritual'){
    head.style.display = 'none';
    grid.style.display = 'none';
    toggle.style.display = 'none';
    footnote.style.display = 'none';
    thanks.style.display = 'block';
    manageSub.style.display = 'block';
    return;
  }

  thanks.style.display = 'none';
  head.style.display = 'block';
  grid.style.display = 'grid';
  toggle.style.display = 'flex';
  footnote.style.display = 'block';

  if (myTier === 'whisper'){
    cards.free.style.display = 'none';
    cards.whisper.style.display = 'none';
    grid.classList.add('centered');
    document.getElementById('pricingHeading').textContent = 'Ritualize your mornings and nights';
    document.getElementById('pricingSub').textContent = 'All-night 8-hour sessions, unlimited saved subliminals, the habit tracker, EFT tapping, and visualization scripting are all still ahead of you on Ritual.';
    manageSub.style.display = 'block';
  } else {
    grid.classList.remove('centered');
    document.getElementById('pricingHeading').textContent = 'Your all in one wellness app';
    document.getElementById('pricingSub').textContent = 'Start free with personalized subliminals. Add your journal and manifestation practice on Whisper; ritualize your mornings and nights on Ritual.';
    manageSub.style.display = 'none';
  }
}


// Rough estimate: ~4 seconds per spoken affirmation line, looped or not.
// If the person picked a target length, that takes priority.
function estimateSessionSeconds(){
  if (state.targetLengthMinutes) return state.targetLengthMinutes * 60;
  return (state.affirmations.length || 1) * 4;
}

async function getMySubscriberRow(){
  if (!sb || !currentUser) return null;
  /* Which plan you are on is asked for constantly -- by the builder on every
     step, by each page as it opens, by the pricing block. It changes when you
     buy something and at almost no other time, so it is worth remembering for
     longer than anything else here. `forgetFetch('tier')` after a purchase. */
  return fetchOnce('tier', async () => {
    const { data } = await sb.from('subscribers').select('*').eq('user_id', currentUser.id).maybeSingle();
    return data; // null if they've never subscribed
  }, 300000);
}

const TIER_SUBLIMINAL_CAPS = { none: 2, whisper: 10, ritual: Infinity };

async function saveSubliminal(){
  const msg = document.getElementById('saveMsg');
  if (!currentUser){ openAuthModal(); return; }
  if (!sb){ msg.textContent = 'Accounts aren\'t connected yet.'; msg.className='save-msg err'; return; }

  const titleInput = document.getElementById('finalTitleInput');
  const titleMsg = document.getElementById('finalTitleMsg');
  const title = titleInput.value.trim();
  if (!title){
    titleInput.classList.add('needs-title');
    titleMsg.textContent = editingExistingId
      ? "Give this edited version its own title before saving — it'll be saved as a new subliminal."
      : 'Give it a title first.';
    titleMsg.className = 'length-msg err';
    titleInput.focus();
    return;
  }
  titleInput.classList.remove('needs-title');
  titleMsg.textContent = '';

  const seconds = estimateSessionSeconds();
  const myTier = await getMyTier();
  const cap = TIER_LENGTH_SECONDS[myTier];

  if (seconds > cap){
    msg.textContent = `${TIER_LABEL[myTier][0].toUpperCase()+TIER_LABEL[myTier].slice(1)} can save sessions up to ${formatSessionLength(cap/60)}. This one runs longer.`;
    msg.className = 'save-msg err';
    /* The sheet says what a longer session is *for*, which is the thing somebody
       about to save an eight-hour one already believes. It is the same sheet the
       locked length chip opens, from the same row of the feature table. */
    openUpgradeModal(featureCoveringMinutes(Math.ceil(seconds/60)), { tier: myTier, trigger: 'save_too_long' });
    return;
  }

  const { count } = await sb.from('subliminals').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
  const subCap = TIER_SUBLIMINAL_CAPS[myTier];
  /* Being full only ever stops a *new* save. Everything already in the library
     stays openable and playable — see renderLibraryPlanLimit, which says so on
     the library page itself rather than leaving it to be discovered here. */
  if ((count || 0) >= subCap){
    msg.textContent = `You've saved ${count} subliminals — that's the room a ${myTier === 'none' ? 'free account has' : TIER_LABEL[myTier] + ' has'}. Everything here keeps playing; it's saving another that needs more space.`;
    msg.className = 'save-msg err';
    openUpgradeModal('library_space', { tier: myTier, trigger: 'save_library_full' });
    return;
  }

  msg.textContent = 'Saving…'; msg.className = 'save-msg';

  let recordingUrls = null;
  let recordingUploadFailed = false;
  if (state.voiceMode === 'own' && recordings.some(r => r)){
    msg.textContent = 'Uploading your voice…'; msg.className = 'save-msg';
    const folder = `${currentUser.id}/${Date.now()}`;
    recordingUrls = [];
    let anyUploaded = false;
    for (let i = 0; i < recordings.length; i++){
      if (!recordings[i] || !recordings[i].blob){ recordingUrls.push(null); continue; }
      const mime = recordings[i].blob.type || 'audio/webm';
      const path = `${folder}/${i}.${extForMime(mime)}`;
      const { error: upErr } = await sb.storage.from('recordings').upload(path, recordings[i].blob, { contentType: mime });
      if (upErr){ console.error('recording upload failed for line', i, upErr); recordingUrls.push(null); continue; }
      recordingUrls.push(path); // store the storage path; we generate a signed URL when loading it back
      anyUploaded = true;
    }
    if (!anyUploaded) recordingUploadFailed = true;
    msg.textContent = 'Saving…'; msg.className = 'save-msg';
  }

  let customTrackStoragePath = null;
  if (customTrackBlob){
    msg.textContent = 'Uploading your track…'; msg.className = 'save-msg';
    const ext = (customTrackBlob.name || 'track.mp3').split('.').pop();
    const path = `${currentUser.id}/${Date.now()}.${ext}`;
    const { error: ctErr } = await sb.storage.from('custom-tracks').upload(path, customTrackBlob, { contentType: customTrackBlob.type || 'audio/mpeg' });
    if (!ctErr) customTrackStoragePath = path;
    else console.error('custom track upload failed:', ctErr);
    msg.textContent = 'Saving…'; msg.className = 'save-msg';
  }

  // Ritual-only second voice layer — same upload pattern as the primary voice.
  let layerRecordingUrls = null;
  if (layerVoiceEnabled && state.layerVoiceMode === 'own' && layerRecordings.some(r => r)){
    msg.textContent = 'Uploading your second voice layer…'; msg.className = 'save-msg';
    const layerFolder = `${currentUser.id}/${Date.now()}-layer`;
    layerRecordingUrls = [];
    for (let i = 0; i < layerRecordings.length; i++){
      if (!layerRecordings[i] || !layerRecordings[i].blob){ layerRecordingUrls.push(null); continue; }
      const mime = layerRecordings[i].blob.type || 'audio/webm';
      const path = `${layerFolder}/${i}.${extForMime(mime)}`;
      const { error: upErr } = await sb.storage.from('recordings').upload(path, layerRecordings[i].blob, { contentType: mime });
      if (upErr){ console.error('layer recording upload failed for line', i, upErr); layerRecordingUrls.push(null); continue; }
      layerRecordingUrls.push(path);
    }
    msg.textContent = 'Saving…'; msg.className = 'save-msg';
  }

  forgetFetch('todaySubs'); forgetFetch('todaySubCovers'); forgetFetch('myLibrary');
  const { error } = await sb.from('subliminals').insert({
    user_id: currentUser.id,
    title: title,
    frequency_hz: state.freq ? state.freq.hz : null,
    affirmations: state.affirmations,
    background: state.bg,
    duration_seconds: seconds,
    recording_urls: recordingUrls,
    custom_track_url: customTrackStoragePath,
    layer_affirmations: layerVoiceEnabled ? state.layerAffirmations : null,
    layer_voice_mode: layerVoiceEnabled ? state.layerVoiceMode : null,
    layer_recording_urls: layerRecordingUrls,
    eft_mode: state.eftMode || false,
    eft_repeat_count: state.eftMode ? state.eftRepeatCount : null,
    visualization_mode: state.visualizationMode || false,
    binaural_band: state.binauralBand || null,
    // Remember which voice built this one, so reopening it sounds the same.
    ai_voice_id: state.voiceMode === 'ai' ? (state.aiVoiceId || null) : null,
    layer_ai_voice_id: layerVoiceEnabled && state.layerVoiceMode === 'ai' ? (state.layerAiVoiceId || null) : null
  });
  if (error){
    console.error('saveSubliminal error:', error);
    msg.textContent = `Couldn't save: ${error.message}`;
    msg.className = 'save-msg err';
    return;
  }
  if (recordingUploadFailed){
    msg.textContent = 'Saved — but your voice recording failed to upload, so this one will replay with the AI voice. (If this keeps happening, the recordings storage bucket may not be set up yet.)';
    msg.className = 'save-msg err';
  } else {
    msg.textContent = 'Saved to your library.'; msg.className = 'save-msg ok';
  }
  // This is now its own saved subliminal — if they keep tweaking and save again,
  // treat it as a fresh save rather than an edit of the thing they just made.
  editingExistingId = null;
  contentAlreadySaved = true;
}

