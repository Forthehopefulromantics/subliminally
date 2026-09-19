/* boot.js — what runs once, when the page loads

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- boot ---------- */
window.AMBIENCE_URLS = {};
if (sb){
  sb.from('ambience_tracks').select('*').then(({ data }) => {
    if (data) data.forEach(row => { window.AMBIENCE_URLS[row.key] = row.url; });
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
    if (wasId !== (currentUser && currentUser.id)) forgetFetch();
    renderAccountArea();
    if (currentUser) applyPendingSignupProfile();
    // Once the first read has settled, this attribute has to keep up with
    // every sign-in and sign-out that follows, or it goes on saying "out"
    // while somebody is signed in -- and it is the flag the rest of the page
    // is told to wait on.
    if (authSettled) document.body.setAttribute('data-auth', currentUser ? 'in' : 'out');
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
  });
} else {
  document.body.setAttribute('data-auth', 'out');
  renderAccountArea();
}
/* library is now a static embed — nothing to fetch on load */
