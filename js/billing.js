/* billing.js — checkout, RevenueCat, tiers, and saving a subliminal

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------------- CHECKOUT LINKING ----------------
   Web keeps the existing Stripe Payment Links. The native apps can't use
   those — Apple/Google require subscriptions sold inside the app to go
   through their own billing — so on native this hands off to RevenueCat
   instead. See the RevenueCat block below for the purchase flow itself. */
// Stripe Payment Links, one per plan + billing period. Create these in
// Stripe -> Payment Links (subscription, recurring monthly or yearly) and
// paste the buy.stripe.com URLs here. The matching Price IDs also go into
// PRICE_TO_TIER in api/stripe-webhook.js so the webhook knows which tier
// a checkout was for.
const STRIPE_LINKS = {
  whisper: {
    monthly: 'https://buy.stripe.com/14AeVc75IaxdgPRg5fgYU03',   // $5.55/mo
    annual:  'https://buy.stripe.com/bJecN4cq220H4356uFgYU06',   // $55/yr
  },
  ritual: {
    monthly: 'https://buy.stripe.com/dRmfZgblY6gXfLNcT3gYU04',   // $11.11/mo
    annual:  'https://buy.stripe.com/6oUfZg3TwdJp5795qBgYU05',   // $111/yr
  },
};
let billingPeriod = 'monthly'; // 'monthly' | 'annual'

function setBillingPeriod(period){
  billingPeriod = period;
  document.querySelectorAll('#billingToggle button').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  document.querySelectorAll('.price-figure, .price-period').forEach(el => { el.textContent = el.dataset[period]; });
}

function goToCheckout(evt, tier){
  evt.preventDefault();
  if (!currentUser){
    openAuthModal();
    document.getElementById('authSub').textContent = 'Create an account first, then tap the plan again — this is how we link your subscription to your account.';
    return false;
  }
  if (isNativeApp()){
    purchaseTier(tier, billingPeriod);
    return false;
  }
  const link = STRIPE_LINKS[tier] && STRIPE_LINKS[tier][billingPeriod];
  if (!link || link.startsWith('REPLACE_')){
    const msg = document.getElementById('pricingPurchaseMsg');
    msg.textContent = "Checkout for this plan isn't connected yet — check back soon.";
    msg.className = 'save-msg err';
    return false;
  }
  window.open(link + '?client_reference_id=' + encodeURIComponent(currentUser.id), '_blank');
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

// Product identifiers to create — matching — in App Store Connect / Google
// Play Console / RevenueCat. Each tier is an auto-renewable subscription
// with a monthly and a yearly product. Entitlement identifiers are set in
// the RevenueCat dashboard (Entitlements tab) and attached to both of a
// tier's products there.
const TIER_PRODUCT_IDS = {
  whisper: { monthly: 'com.fthr.subliminally.whisper.monthly', annual: 'com.fthr.subliminally.whisper.annual' },
  ritual:  { monthly: 'com.fthr.subliminally.ritual.monthly',  annual: 'com.fthr.subliminally.ritual.annual' },
};
const TIER_ENTITLEMENT_IDS = {
  whisper: 'whisper',
  ritual: 'ritual',
};

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
      setTimeout(applyPricingVisibility, 1500);
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
    const productId = TIER_PRODUCT_IDS[tier][period || 'monthly'];
    const pkg = current?.availablePackages.find(p => p.product.identifier === productId);
    if (!pkg){
      msg.textContent = "That plan isn't set up yet — check back soon.";
      msg.className = 'save-msg err';
      return;
    }
    msg.textContent = 'Opening purchase…'; msg.className = 'save-msg';
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    const entitlementId = TIER_ENTITLEMENT_IDS[tier];
    if (customerInfo.entitlements.active[entitlementId]){
      msg.textContent = "You're in — welcome to " + TIER_LABEL[tier] + '.';
      msg.className = 'save-msg ok';
      // The RevenueCat webhook updates the subscribers table server-side;
      // give it a moment to land, then refresh what the pricing page shows.
      setTimeout(applyPricingVisibility, 1500);
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
const TIER_LABEL = { none: 'a free account', whisper: 'Whisper', ritual: 'Ritual' };
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
    msg.innerHTML = `${TIER_LABEL[myTier][0].toUpperCase()+TIER_LABEL[myTier].slice(1)} can save sessions up to ${formatSessionLength(cap/60)}. This one runs longer — <a href="#pricing" onclick="closeAuthModal();">upgrade to save it</a>.`;
    msg.className = 'save-msg err';
    return;
  }

  const { count } = await sb.from('subliminals').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
  const subCap = TIER_SUBLIMINAL_CAPS[myTier];
  if ((count || 0) >= subCap){
    msg.innerHTML = myTier === 'whisper'
      ? `You've saved ${count} subliminals — that's the limit on Whisper. <a href="#pricing" onclick="closeAuthModal();">Upgrade to Ritual for unlimited</a>.`
      : `You've saved ${count} subliminals — that's the limit on a free account. <a href="#pricing" onclick="closeAuthModal();">Whisper holds 10, Ritual is unlimited</a>.`;
    msg.className = 'save-msg err';
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

