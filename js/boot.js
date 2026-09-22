/* boot.js — what runs once, when the page loads

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- boot ---------- */
/* ---------- the ambience library ----------
   Where each shared ambience track's audio actually lives. Overrides the copy
   bundled at audio/ambience/, which is what plays until this lands and if it
   never does -- so nothing on the page may wait on it, and nothing does: the
   URL is resolved at the moment a track is played, not when the picker is
   drawn. See ambienceUrl() in js/ambience.js.

   Rows without a url are ones the upload script has not put in the bucket yet.
   They are skipped rather than written as null, because writing null here
   would override the bundled copy with nothing. */
window.AMBIENCE_URLS = {};
if (sb){
  sb.from('ambience_tracks').select('key,url,is_active').then(({ data, error }) => {
    if (error || !data) return;   // the bundled copies carry it
    data.forEach(row => {
      if (row && row.url && row.is_active !== false) window.AMBIENCE_URLS[row.key] = row.url;
    });
  });
}

if (sb){
  setupNativeOAuthCallback();
  reportWebOAuthError();
  setupNativeDayRollover();
  setupPushNotifications();
  setupOnboarding();
  initRevenueCat();
  updateManageSubscriptionLinks();

  /* Authentication has to finish settling before anything decides where a
     person belongs. Until `getSession()` comes back, supabase-js has not
     restored the stored session yet, and a signed-in account looks exactly
     like no account at all -- so the page says "loading" and no routing runs.
     data-auth is on the body for anything that wants to wait on it. */
  document.body.setAttribute('data-auth', 'loading');
  let authSettled = false;

  sb.auth.onAuthStateChange((event, session) => {
    const wasId = currentUser && currentUser.id;
    currentUser = session ? session.user : null;
    // Whoever is signed in now, nothing remembered for the last person is
    // allowed to survive into their screens.
    if (wasId !== (currentUser && currentUser.id)){
      forgetFetch();
      // Including who their higher self is. Leaving the last person's choice
      // marked as loaded would draw it, once, to whoever signed in next.
      higherSelfLoaded = false;
      higherSelf = { name:'', ...HIGHER_SELF_DEFAULTS };
    }
    renderAccountArea();
    if (currentUser) applyPendingSignupProfile();
    // A sign-in that happens after the first load -- typing a password, coming
    // back from Google -- routes here. Before that, the block below does it
    // once, with the restored session in hand.
    //
    // Only when the person actually changed: supabase-js also reports
    // SIGNED_IN when it refreshes a token or a backgrounded tab comes back,
    // and someone halfway through their journal should not be thrown onto
    // Today for it.
    const isNewPerson = wasId !== (currentUser && currentUser.id);
    if (authSettled && isNewPerson && currentUser && event === 'SIGNED_IN') routeAfterAuth({ landOnToday: true });
    if (currentUser) savePushToken();
    syncRevenueCatIdentity();
  });

  sb.auth.getSession().then(async ({ data }) => {
    currentUser = data.session ? data.session.user : null;
    authSettled = true;
    document.body.setAttribute('data-auth', currentUser ? 'in' : 'out');
    renderAccountArea();
    if (currentUser && location.hash === '#profile') document.body.setAttribute('data-view','profile');
    if (location.hash === '#library'){ document.body.setAttribute('data-view','library'); renderMyLibraryState(); }
    if (location.hash === '#journal') document.body.setAttribute('data-view','journal');
    if (location.hash === '#rituals') document.body.setAttribute('data-view','rituals');
    if (location.hash === '#reprogram') document.body.setAttribute('data-view','reprogram');
    // Reopened on #sanctuary: set the view before rendering, so the stage is
    // measured while it is on screen rather than while it is still display:none.
    if (currentUser && location.hash === '#sanctuary' && SANCTUARY_ENABLED){ document.body.setAttribute('data-view','sanctuary'); renderSanctuaryHome(); }
    // Signed in with nowhere particular to be: open Today, not the sales page.
    if (currentUser && (!location.hash || location.hash === '#today')){ document.body.setAttribute('data-view','today'); renderTodayPage(); }
    // Session restored: now, and only now, ask the database whether this
    // account still owes us onboarding.
    if (currentUser) await routeAfterAuth();
    /* Coming back from Stripe. After onboarding routing, so nothing it opens
       lands on top of the "welcome to Ritual" this is about to show, and only
       once the session is in hand -- the plan belongs to an account. */
    handleCheckoutReturn();
  });
} else {
  document.body.setAttribute('data-auth', 'out');
  renderAccountArea();
}
/* library is now a static embed — nothing to fetch on load */
