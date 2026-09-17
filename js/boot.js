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
  setupNativeDayRollover();
  setupPushNotifications();
  initRevenueCat();
  updateManageSubscriptionLinks();
  sb.auth.onAuthStateChange((event, session) => {
    const wasId = currentUser && currentUser.id;
    currentUser = session ? session.user : null;
    // Whoever is signed in now, nothing remembered for the last person is
    // allowed to survive into their screens.
    if (wasId !== (currentUser && currentUser.id)) forgetFetch();
    renderAccountArea();
    if (currentUser) applyPendingSignupProfile();
    if (currentUser && event === 'SIGNED_IN') promptOnboardingIfProfileIncomplete();
    if (currentUser) savePushToken();
    syncRevenueCatIdentity();
  });
  sb.auth.getSession().then(({ data }) => {
    currentUser = data.session ? data.session.user : null;
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
  });
} else {
  renderAccountArea();
}
/* library is now a static embed — nothing to fetch on load */
