/* account.js — waitlist, Supabase, sign-in, sign-up, onboarding, deleting an account

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------------- WAITLIST ---------------- */
const waitlistForm = document.getElementById('waitlistForm');
const waitlistMsg = document.getElementById('waitlistMsg');
const waitlistCount = document.getElementById('waitlistCount');
let realWaitlistCount = null;
function updateCount(){
  const shown = realWaitlistCount !== null ? realWaitlistCount : 214;
  waitlistCount.innerHTML = `<b>${shown}</b> hopeful romantics on the list`;
}
async function refreshWaitlistCount(){
  if (!sb) return;
  const { data, error } = await sb.rpc('get_waitlist_count');
  if (!error && typeof data === 'number') { realWaitlistCount = data; updateCount(); }
}
updateCount();
waitlistForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const input = document.getElementById('waitlistEmail');
  const email = input.value.trim();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!valid){ waitlistMsg.textContent="That doesn't look like a valid email — try again."; waitlistMsg.className='waitlist-msg err'; return; }
  if (!sb){ waitlistMsg.textContent="Waitlist isn't connected yet — try again shortly."; waitlistMsg.className='waitlist-msg err'; return; }

  waitlistMsg.textContent = "Joining…"; waitlistMsg.className = 'waitlist-msg';
  const { error } = await sb.from('waitlist_signups').insert({ email });
  if (error){
    if (error.message && error.message.toLowerCase().includes('duplicate')){
      waitlistMsg.textContent="You're already on the list. We'll be in touch."; waitlistMsg.className='waitlist-msg ok';
    } else {
      waitlistMsg.textContent="Something went wrong — try again."; waitlistMsg.className='waitlist-msg err';
    }
    return;
  }
  waitlistMsg.textContent="You're in. Be more hopeful — check your inbox soon."; waitlistMsg.className='waitlist-msg ok';
  input.value=''; refreshWaitlistCount();
});

renderProgress();

/* ================================================================
   SUPABASE — accounts, journal, library
   Swap in your real values below once your project is created:
   Settings -> API -> Project URL / anon public key
   ================================================================ */
const SUPABASE_URL = 'https://eiqylxcgexndzopesvhd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1g7zbin7PEQhi2e0Y-QM8Q_-0TAfubb';

function isNativeApp(){
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
// Where the website (and its /api functions) live. The native app is served
// from its own bundle, not from this domain, so anything that calls /api has
// to spell out the full address. Change this if the site moves domains.
const SITE_ORIGIN = 'https://www.subliminallybyfthr.com';
const API_BASE = isNativeApp() ? SITE_ORIGIN : '';

// In the native iOS/Android app, back the login session with Capacitor's
// Preferences plugin (native storage) instead of plain WebView localStorage,
// which iOS in particular can quietly evict — that used to mean people got
// logged out for no reason. On the regular web site window.Capacitor doesn't
// exist, so this just returns undefined and supabase-js falls back to its
// normal localStorage-backed session storage.
function nativeSessionStorage(){
  const Preferences = window.Capacitor && window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
  if (!Preferences) return undefined;
  return {
    async getItem(key){ const { value } = await Preferences.get({ key }); return value; },
    async setItem(key, value){ await Preferences.set({ key, value }); },
    async removeItem(key){ await Preferences.remove({ key }); },
  };
}

let sb = null;
try {
  if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && window.supabase){
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: nativeSessionStorage(),
        flowType: 'pkce',
      },
    });
  } else {
    console.warn('Supabase client library did not load — accounts/journal/library will be disabled.');
  }
} catch (e){
  console.error('Supabase init failed:', e);
}

let currentUser = null;
let authMode = 'login'; // 'login' | 'signup' | 'reset'
let journalTab = 'received';

// Where Supabase sends people after they click a password-reset email link.
// This always points at the web site (not a custom app:// scheme) because the
// link opens in the system browser/mail app, never inside the wrapped native
// app — same pattern as the sign-up email-confirmation link.
const PASSWORD_RESET_REDIRECT_URL = 'https://www.subliminallybyfthr.com/reset-password.html';

/* ---------- your profile row ----------
   One row in `profiles` holds your username, your real name, what you call
   your higher self and which picture she is, how many Grace Days you have
   left, and the questionnaire answers from signing up. Six different places
   were each asking the database for their own two columns of it, which is six
   round trips for one row -- and on a phone that is most of a second each.
   They all go through here now, and the answer is shared.

   `select('*')` rather than naming columns on purpose: a column that a
   migration hasn't added yet fails a named select outright and takes the whole
   row down with it, which is how the subliminal covers broke the Today list.
   Asking for everything returns whatever is actually there. */
/* Set when the last read of the profile row was refused rather than empty.
   Only the onboarding router reads it. */
let lastProfileFetchFailed = false;

async function myProfile(opts){
  if (!sb || !currentUser) return null;
  if (opts && opts.force) forgetFetch('profileRow');
  const { data, error } = await fetchOnce('profileRow', () =>
    sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle(), 300000);
  if (error){
    // A refusal and an empty account look identical from the outside -- both
    // come back null -- and routing has to tell them apart, or a dropped
    // connection sends someone who finished onboarding back through it.
    lastProfileFetchFailed = true;
    forgetFetch('profileRow'); console.warn('profile:', error.message); return null;
  }
  lastProfileFetchFailed = false;
  return data;
}

/* Writing part of it. Every caller that changes a profile field goes through
   this, so there is one place that knows the row is keyed by `id` and one
   place that drops the remembered copy afterwards.

   It returns the error rather than throwing, because that is what the five
   callers were already written to expect: `const error = await saveProfile(…)`
   and then a message on screen. */
async function saveProfile(patch){
  if (!sb) return { message: 'Not signed in.' };
  // The header and a settings save used to disagree about whether a session
  // existed. Ask Supabase for the authoritative session before refusing a save.
  if (!currentUser){
    const { data } = await sb.auth.getSession();
    currentUser = data && data.session ? data.session.user : null;
  }
  if (!currentUser) return { message: 'Not signed in.' };
  const { error } = await sb.from('profiles')
    .upsert({ id: currentUser.id, ...patch }, { onConflict: 'id' });
  // Whether it saved or not, what is remembered is no longer trustworthy.
  forgetFetch('profileRow');
  return error || null;
}

/* What to put on screen when a save fails. Postgres speaks in constraint
   names; this says the one thing the person can act on. */
function describeSaveError(error){
  if (!error) return '';
  const text = String(error.message || error.details || error).toLowerCase();
  if (text.includes('duplicate') || text.includes('unique')) return 'That username is already taken — try another.';
  if (text.includes('row-level security') || text.includes('permission')) return "You're signed out — sign in again and retry.";
  if (text.includes('failed to fetch') || text.includes('network')) return "Couldn't reach the server — check your connection and try again.";
  if (text.includes('check constraint') || text.includes('violates')) return "That doesn't look right — check it and try again.";
  return "Couldn't save that — try again.";
}

/* ---------- auth modal ---------- */
/* Opens on log in unless a caller explicitly wants the sign-up form — most
   people reaching this modal already have an account, and the ones who don't
   get "New here? Create a free account" right underneath. */
function openAuthModal(mode){
  authMode = mode === 'signup' ? 'signup' : 'login';
  document.getElementById('authOverlay').classList.add('open');
  updateAuthModalUI();
}
function closeAuthModal(){
  document.getElementById('authOverlay').classList.remove('open');
  document.getElementById('authMsg').textContent = '';
}

/* ---------- Google sign-in (Supabase OAuth) ----------
   Requires a Google provider enabled in the Supabase dashboard
   (Authentication -> Sign In / Providers -> Google) with a Google Cloud
   OAuth client's ID + secret pasted in there. Nothing Google-specific lives
   in this file — Supabase brokers the whole exchange. */
// Custom URL scheme the native apps register (see capacitor.config.json /
// Info.plist / AndroidManifest.xml) so Google can hand control back to the
// app instead of leaving people stranded in the system browser.
const GOOGLE_OAUTH_NATIVE_CALLBACK = 'com.fthr.subliminally://login-callback';

async function signInWithGoogle(){ return startOAuthSignIn('google'); }

/* Browser-based OAuth round trip used by Google on web and in the native apps. */
async function startOAuthSignIn(provider){
  if (!sb){ document.getElementById('authMsg').textContent = 'Accounts aren\'t connected yet — check back soon.'; document.getElementById('authMsg').className='auth-msg err'; return; }
  const msg = document.getElementById('authMsg');
  const native = isNativeApp();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: native ? GOOGLE_OAUTH_NATIVE_CALLBACK : window.location.origin + '/',
      skipBrowserRedirect: native, // on native we open it ourselves, in an in-app browser tab
      // Always show the account chooser. Without this, anyone already signed
      // into one Google account is pushed straight through it with no say.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error){
    msg.textContent = error.message || 'Could not start Google sign-in — try again.';
    msg.className = 'auth-msg err';
    return;
  }
  if (native && data && data.url && window.Capacitor.Plugins.Browser){
    await window.Capacitor.Plugins.Browser.open({ url: data.url });
  }
  // On web, signInWithOAuth already redirected the page — nothing left to do here.
}

// Native only: Google/Supabase redirect back into the app via the custom URL
// scheme above; Capacitor's App plugin surfaces that as an appUrlOpen event.
/* On a phone the app is almost never reloaded — it's backgrounded overnight and
   reopened in the morning, which is exactly when the day needs to turn over.
   visibilitychange covers most of this, but Capacitor's own resume event is the
   reliable signal on native. */
function setupNativeDayRollover(){
  if (!isNativeApp() || !window.Capacitor.Plugins.App) return;
  window.Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) rollOverDayIfNeeded();
  });
}

/* Pulls a named value out of an OAuth return address, whether the provider put
   it in the query string (`?code=…`, the PKCE flow) or the fragment
   (`#error=…`, which is where Supabase puts failures). Hand-parsed rather than
   `new URL()` because the native return address uses a custom scheme. */
function oauthParam(url, name){
  const match = String(url || '').match(new RegExp('[?&#]' + name + '=([^&#]*)'));
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
}

/* What to say when Google (or Supabase) hands back a failure instead of a
   session. `error_description` is written for developers; these are the two
   cases a person can actually do something about. */
function describeOAuthError(code, description){
  const text = (String(code || '') + ' ' + String(description || '')).toLowerCase();
  if (text.includes('access_denied') || text.includes('cancel')) return 'Google sign-in was cancelled.';
  if (text.includes('provider is not enabled') || text.includes('unsupported provider')) return "Google sign-in isn't switched on yet — use your email and password for now.";
  return description || 'Google sign-in did not complete — try again.';
}

function showOAuthError(code, description){
  openAuthModal('login');
  const msg = document.getElementById('authMsg');
  msg.textContent = describeOAuthError(code, description);
  msg.className = 'auth-msg err';
  console.warn('OAuth sign-in failed:', code, description);
}

/* Web: Supabase sends people back to the address we asked for, and on a failure
   that address carries `error` / `error_description` instead of a `code`.
   supabase-js quietly ignores those, so without this the person lands back on
   the home page signed out with nothing said — which is exactly what a failing
   Google sign-in looked like. */
function reportWebOAuthError(){
  const code = oauthParam(window.location.search, 'error') || oauthParam(window.location.hash, 'error');
  if (!code) return;
  const description = oauthParam(window.location.search, 'error_description') || oauthParam(window.location.hash, 'error_description');
  showOAuthError(code, description);
  // Don't leave the failure in the address bar to fire again on a refresh.
  try { history.replaceState({}, document.title, window.location.pathname); } catch(e){}
}

function setupNativeOAuthCallback(){
  if (!isNativeApp() || !sb || !window.Capacitor.Plugins.App) return;
  window.Capacitor.Plugins.App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || url.indexOf('login-callback') === -1) return;
    if (window.Capacitor.Plugins.Browser){ try { await window.Capacitor.Plugins.Browser.close(); } catch(e){} }
    const failure = oauthParam(url, 'error');
    if (failure){ showOAuthError(failure, oauthParam(url, 'error_description')); return; }
    // exchangeCodeForSession takes the authorization code itself, not the whole
    // return address — handing it the URL is why the native round trip never
    // produced a session.
    const code = oauthParam(url, 'code');
    if (!code){ showOAuthError(null, 'Google sent us back without a sign-in code.'); return; }
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error){ showOAuthError(null, error.message); return; }
    closeAuthModal();
    // Where they land -- Today, or onboarding -- is the SIGNED_IN handler's
    // call in boot.js, off the profile row, same as every other way in.
  });
}

/* ---------- where a signed-in person goes ----------

   One question decides it, and the answer comes from the database: has this
   account finished onboarding? Not what this browser remembers, not whether
   Google just redirected, not whether a username happens to be filled in --
   which is what it used to read, and why anyone who left that field blank was
   marched through onboarding again on every single login.

   The row is keyed by auth.users.id, so the answer follows the person to any
   browser, any device, and back from any provider. */
function onboardingIsDone(prof){
  return !!(prof && prof.onboarding_completed === true);
}

/* Returns 'today' | 'onboarding' | 'unknown'. 'unknown' means we could not
   read the profile -- offline, a refused request -- and in that case nobody is
   sent anywhere, because guessing wrong here is what makes a finished account
   redo onboarding. */
async function resolveOnboardingRoute(){
  if (!sb || !currentUser) return 'unknown';
  const prof = await myProfile();
  if (!prof && lastProfileFetchFailed) return 'unknown';
  return onboardingIsDone(prof) ? 'today' : 'onboarding';
}

/* Called once authentication has settled and never before it: an undefined
   profile must not be mistaken for an unfinished one. */
async function routeAfterAuth(opts){
  const route = await resolveOnboardingRoute();
  if (route === 'onboarding'){ openOnboardingModal(); return route; }
  if (route === 'today' && opts && opts.landOnToday) showTodayPage();
  return route;
}

// Kept under its old name because boot.js and the native callback both call it.
async function promptOnboardingIfProfileIncomplete(){
  return routeAfterAuth();
}

/* ---------- push notifications (native only) ----------
   Needs a Firebase project's google-services.json (android/app/) and
   GoogleService-Info.plist (ios/App/App/) in place before device
   registration will actually succeed — see MOBILE_APP notes. Also expects a
   `push_tokens` table in Supabase: user_id uuid, token text unique,
   platform text, updated_at timestamptz default now(), RLS restricting
   reads/writes to auth.uid() = user_id. */
let lastPushToken = null;
async function savePushToken(){
  if (!sb || !currentUser || !lastPushToken) return;
  await sb.from('push_tokens').upsert({
    user_id: currentUser.id,
    token: lastPushToken,
    platform: window.Capacitor.getPlatform(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'token' });
}
// Off for v1: nothing sends pushes yet, and asking for permission with nothing
// behind it is an App Review flag. Flip to true once Firebase is configured.
const PUSH_NOTIFICATIONS_ENABLED = false;
function setupPushNotifications(){
  if (!PUSH_NOTIFICATIONS_ENABLED || !isNativeApp() || !window.Capacitor.Plugins.PushNotifications) return;
  const { PushNotifications } = window.Capacitor.Plugins;
  PushNotifications.addListener('registration', (token) => { lastPushToken = token.value; savePushToken(); });
  PushNotifications.addListener('registrationError', (err) => console.warn('Push registration failed:', err));
  PushNotifications.addListener('pushNotificationReceived', (n) => console.log('Push received in foreground:', n));
  PushNotifications.addListener('pushNotificationActionPerformed', (a) => console.log('Push tapped:', a));
  PushNotifications.checkPermissions().then((res) => {
    if (res.receive === 'granted') PushNotifications.register();
    else PushNotifications.requestPermissions().then((r) => { if (r.receive === 'granted') PushNotifications.register(); });
  });
}

function toggleAuthMode(){
  authMode = authMode === 'signup' ? 'login' : 'signup';
  updateAuthModalUI();
}
function enterResetMode(){
  authMode = 'reset';
  updateAuthModalUI();
}
function updateAuthModalUI(){
  const msg = document.getElementById('authMsg');
  msg.textContent = ''; msg.className = 'auth-msg';
  document.getElementById('authPassword').value = '';

  if (authMode === 'reset'){
    document.getElementById('authTitle').textContent = 'Reset your password';
    document.getElementById('authSub').textContent = "We'll email you a link to set a new one.";
    document.getElementById('authSubmitBtn').textContent = 'Send reset link';
    document.querySelector('#authPassword').closest('.auth-field').style.display = 'none';
    document.getElementById('confirmPwField').style.display = 'none';
    document.getElementById('signupUsernameField').style.display = 'none';
    document.getElementById('authToggle').innerHTML = `<button onclick="toggleAuthModeFromReset()">Back to log in</button>`;
    document.getElementById('googleAuthRow').style.display = 'none';
    return;
  }

  document.getElementById('googleAuthRow').style.display = 'block';
  document.getElementById('authTitle').textContent = authMode === 'signup' ? 'Create your account' : 'Welcome back';
  document.getElementById('authSub').textContent = 'Save your sessions, keep a journal, and build your library.';
  document.getElementById('authSubmitBtn').textContent = authMode === 'signup' ? 'Create a free account' : 'Log in';
  document.querySelector('#authPassword').closest('.auth-field').style.display = 'block';
  const signupOnly = authMode === 'signup' ? 'block' : 'none';
  document.getElementById('confirmPwField').style.display = signupOnly;
  document.getElementById('signupUsernameField').style.display = signupOnly;
  document.getElementById('forgotPwRow').style.display = authMode === 'login' ? 'block' : 'none';
  document.getElementById('authToggle').innerHTML = authMode === 'signup'
    ? `Already have an account? <button onclick="toggleAuthMode()">Log in</button>`
    : `New here? <button onclick="toggleAuthMode()">Create a free account</button>`;
}
function toggleAuthModeFromReset(){
  authMode = 'login';
  updateAuthModalUI();
}
function togglePwVisibility(inputId, btn){
  const input = document.getElementById(inputId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.innerHTML = showing ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
}
async function submitAuth(){
  if (!sb){ document.getElementById('authMsg').textContent = 'Accounts aren\'t connected yet — check back soon.'; document.getElementById('authMsg').className='auth-msg err'; return; }
  const email = document.getElementById('authEmail').value.trim();
  const msg = document.getElementById('authMsg');

  if (authMode === 'reset'){
    if (!email){ msg.textContent = 'Enter the email on your account.'; msg.className = 'auth-msg err'; return; }
    msg.textContent = 'Sending…'; msg.className = 'auth-msg';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: PASSWORD_RESET_REDIRECT_URL });
    if (error){
      msg.textContent = (error.message || 'Something went wrong — try again in a moment.');
      msg.className = 'auth-msg err';
      return;
    }
    msg.textContent = 'Check your email for a link to set a new password.';
    msg.className = 'auth-msg ok';
    return;
  }

  const password = document.getElementById('authPassword').value;
  if (!email || !password){ msg.textContent = 'Enter an email and password.'; msg.className = 'auth-msg err'; return; }
  let signupUsername = '';
  if (authMode === 'signup'){
    const confirmPw = document.getElementById('authPasswordConfirm').value;
    if (password.length < 6){ msg.textContent = 'Password needs at least 6 characters.'; msg.className = 'auth-msg err'; return; }
    if (password !== confirmPw){ msg.textContent = "Passwords don't match — check both fields."; msg.className = 'auth-msg err'; return; }
    signupUsername = document.getElementById('signupUsername').value.trim();
    if (!signupUsername){ msg.textContent = 'Pick a username.'; msg.className = 'auth-msg err'; return; }
    if (!/^[a-zA-Z0-9_\.]{3,24}$/.test(signupUsername)){ msg.textContent = 'Usernames are 3–24 characters — letters, numbers, dots, and underscores.'; msg.className = 'auth-msg err'; return; }
  }
  msg.textContent = 'Working on it…'; msg.className = 'auth-msg';
  const wasSignup = authMode === 'signup';
  let data, error;
  try {
    const result = wasSignup
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });
    data = result.data; error = result.error;
  } catch (e){
    error = e;
  }
  if (error){
    console.error('Auth error (full object):', error);
    const readable = (error && typeof error.message === 'string' && error.message.length)
      ? error.message
      : 'Something went wrong — check your connection and try again.';
    if (!wasSignup && /invalid login credentials|email not confirmed/i.test(readable)){
      msg.innerHTML = 'We could not sign you in. If you just created this account, confirm your email first.<br><button type="button" class="auth-inline-btn" onclick="resendSignupConfirmation()">Resend confirmation email</button>';
    } else {
      msg.textContent = readable;
    }
    msg.className = 'auth-msg err';
    return;
  }

  if (wasSignup){
    // Stash the chosen username/avatar so we can apply it once there's a real session
    // (which may be now, or after they click the email confirmation link and log in).
    rememberPendingSignupProfile({ username: signupUsername, email });
  }

  // Signed up, but Supabase requires clicking an email link before there's a real session.
  if (wasSignup && !data.session){
    msg.innerHTML = 'Account created. Check your email and click the confirmation link before logging in.<br><button type="button" class="auth-inline-btn" onclick="resendSignupConfirmation()">Resend confirmation email</button><br><small>Also check spam or junk if it does not arrive within a few minutes.</small>';
    msg.className = 'auth-msg ok';
    return;
  }

  msg.textContent = 'You\'re in.'; msg.className = 'auth-msg ok';
  // Where they go next is not decided here. The SIGNED_IN handler in boot.js
  // asks the database whether this account has finished onboarding and routes
  // on the answer, so email, Google and a restored session all land the same
  // way and there is only ever one thing making that decision.
  setTimeout(closeAuthModal, 600);
}

async function resendSignupConfirmation(emailOverride){
  if (!sb) return;
  const msg = document.getElementById('authMsg');
  const email = (emailOverride || document.getElementById('authEmail').value || '').trim();
  if (!email){ msg.textContent='Enter the email you signed up with first.'; msg.className='auth-msg err'; return; }
  msg.textContent='Sending a new confirmation email…'; msg.className='auth-msg';
  const { error } = await sb.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: window.location.origin + '/' }
  });
  if (error){ msg.textContent = error.message || 'Could not resend the confirmation email.'; msg.className='auth-msg err'; return; }
  msg.innerHTML='Confirmation email sent. Check your inbox and spam/junk folder.';
  msg.className='auth-msg ok';
}

/* ---------------- SIGNUP: username ----------------
   There's no avatar to choose here any more: your higher self is the picture
   of you in this app, and she's made on the profile page where there's room
   for it. */
let pendingSignupProfile = (() => {
  try { return JSON.parse(localStorage.getItem('subliminally_pending_signup_profile') || 'null'); }
  catch(e){ return null; }
})();
function rememberPendingSignupProfile(profile){
  pendingSignupProfile = profile;
  try { localStorage.setItem('subliminally_pending_signup_profile', JSON.stringify(profile)); } catch(e){}
}
function clearPendingSignupProfile(){
  pendingSignupProfile = null;
  try { localStorage.removeItem('subliminally_pending_signup_profile'); } catch(e){}
}

// Applies the username/avatar chosen during signup, once a real session exists.
async function applyPendingSignupProfile(){
  if (!pendingSignupProfile || !sb || !currentUser) return;
  const pending = pendingSignupProfile;
  const error = await saveProfile({ username: pending.username });
  if (!error) clearPendingSignupProfile();
  if (error && error.message && error.message.toLowerCase().includes('duplicate')){
    // Username collided — let them fix it in the questionnaire/profile rather than blocking login.
    console.warn('Username taken; user can set another in onboarding.');
  }
}

/* ---------------- ONBOARDING: one question to a screen ----------------

   A slideshow, not a form. Every slide lives in the markup from the start and
   is shown or hidden, which is what makes going backwards free: the inputs
   still hold what was typed, and the chip lists are drawn from `obAnswers`, so
   what is on screen and what will be saved cannot drift apart.

   Nothing is written to the database until the last slide. Up to that point
   this is all in memory -- there is one row per person and it is written once,
   with everything in it. */

/* The middle of the flow used to ask the same question three times over --
   desires, then struggles, then "what would you most like to change" -- and
   got three versions of one answer for it. What replaces them is four things
   the app cannot work out on its own (when to speak, how to speak, whose
   words to use, and how long a session can honestly be), with the two short
   teaching slides between them. */
const OB_SLIDES = ['welcome','name','higher','avatar','intro','desires','teach-mind','when','voice','spirit','teach-percent','time','finish'];

/* The wording on the button changes with the slide; the work it does does not. */
const OB_CTA = {
  welcome: "Let's begin",
  'teach-mind': 'I understand',
  'teach-percent': 'I understand',
  finish: 'Begin My Journey',
};

const OB_DESIRES = [
  { id:'confidence',  icon:'✦', label:'Confidence' },
  { id:'wealth',      icon:'◈', label:'Wealth' },
  { id:'love',        icon:'♡', label:'Love' },
  { id:'career',      icon:'➚', label:'Career' },
  { id:'health',      icon:'✚', label:'Health & Body' },
  { id:'peace',       icon:'❋', label:'Peace' },
  { id:'creativity',  icon:'✷', label:'Creativity' },
  { id:'spiritual',   icon:'☾', label:'Spiritual Growth' },
  { id:'other',       icon:'✎', label:'Other' },
];
const OB_DESIRE_COUNT = 3;   // three exactly, not up to three

const OB_WHEN = [
  { id:'wake',    icon:'☀', label:'When I wake up' },
  { id:'work',    icon:'✎', label:'During work or school' },
  { id:'before',  icon:'▲', label:'Before something stressful' },
  { id:'unwind',  icon:'☾', label:"When I'm winding down" },
  { id:'sleep',   icon:'☁', label:'While I sleep' },
];

const OB_VOICE = [
  { id:'gentle',      label:'Gentle & reassuring' },
  { id:'direct',      label:'Confident & direct' },
  { id:'motivating',  label:'Motivating & energetic' },
  { id:'calm',        label:'Calm & grounded' },
  { id:'mix',         label:'A mix depending on what I need' },
];

/* `faith` is the id faith.js already knows this answer by, so the stance
   question feeds the vocabulary the rest of the app reads without a second
   system behind it. 'religion' is the one that decides nothing on its own --
   it opens the tradition list instead. */
const OB_SPIRIT = [
  { id:'religion',   label:'Religion is important to me',      faith:null },
  { id:'spiritual',  label:"I'm spiritual, but not religious", faith:'spirituality' },
  { id:'agnostic',   label:"I'm agnostic / still exploring",   faith:'agnostic' },
  { id:'secular',    label:'I prefer a secular approach',      faith:'psychology' },
  { id:'else',       label:'Something else',                   faith:'other' },
];
/* Which of faith.js's existing chips belong under "religion is important to
   me". The rest of its list answers the stance question above instead, so it
   is hidden there rather than removed from a file Settings shares. */
const OB_RELIGIONS = ['christianity','islam','hinduism','other'];

const OB_TIME = [
  { id:'5',   label:'5 minutes',   minutes:5,  start:'One 5-minute session a day' },
  { id:'10',  label:'10 minutes',  minutes:10, start:'Two 5-minute sessions a day' },
  { id:'20',  label:'20 minutes',  minutes:20, start:'Two 10-minute sessions a day' },
  { id:'30',  label:'30+ minutes', minutes:30, start:'Three 10-minute sessions a day' },
];

let obIndex = 0;
let obGoingBack = false;
let obSaving = false;
let obAnswers = { desires: [], when:null, voice:null, spirit:null, time:null };

function obSlideName(){ return OB_SLIDES[obIndex]; }
function obEl(id){ return document.getElementById(id); }

function openOnboardingModal(){
  // Already in it: leave them where they are. A token refresh reported as a
  // fresh sign-in must not throw anybody back to the first slide.
  if (obEl('onboardOverlay').classList.contains('open')) return;
  obIndex = 0;
  obSaving = false;
  obAvatarPicked = false;
  obAnswers = { desires: [], when:null, voice:null, spirit:null, time:null };
  obEl('onboardOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  obPaintSky();
  obRenderChips();
  if (typeof renderFaithChips === 'function') renderFaithChips();
  obAvatarPreviewOpen = false;
  renderOnboardAvatars();
  renderOnboardAvatarPreview();
  obShowSlide();
}
function closeOnboardingModal(){
  obEl('onboardOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
/* Onboarding holds an unsaved name and avatar in the same `higherSelf` the rest
   of the app reads, so anything that refills that object from the database has
   to know when not to. */
function onboardingIsOpen(){
  const el = document.getElementById('onboardOverlay');
  return !!(el && el.classList.contains('open'));
}
/* "I'll personalize later" leaves onboarding unfinished on purpose: the row
   still says onboarding_completed = false, so it will be waiting next time
   rather than quietly never appearing again. */
function skipOnboarding(){ closeOnboardingModal(); }

/* Stars, scattered once. Fixed positions rather than random on every render,
   so nothing twitches when a slide changes. */
function obPaintSky(){
  const sky = obEl('obSky');
  if (!sky || sky.dataset.painted) return;
  const spots = [[8,14],[18,32],[27,9],[36,24],[44,6],[52,19],[61,11],[69,29],[77,16],[86,26],[92,8],[13,46],[31,52],[58,44],[72,55],[89,48]];
  sky.insertAdjacentHTML('beforeend', spots.map(([l,t],i) =>
    `<div class="ob-star" style="left:${l}%;top:${t}%;animation-delay:${(i % 5) * 0.7}s"></div>`).join(''));
  sky.dataset.painted = '1';
}

/* ---------- the slides ---------- */
function obShowSlide(){
  const name = obSlideName();
  document.querySelectorAll('#obStage .ob-slide').forEach(el => {
    const on = el.dataset.ob === name;
    el.classList.toggle('back', obGoingBack);
    el.classList.toggle('on', on);
  });
  obGoingBack = false;
  obCancelAdvance();          // a slide change outruns any pending auto-advance
  obEl('obStage').scrollTop = 0;

  const step = obIndex + 1;
  obEl('obProgressFill').style.width = (step / OB_SLIDES.length * 100) + '%';
  obEl('obStep').textContent = step + '/' + OB_SLIDES.length;
  obEl('obBack').disabled = obIndex === 0;
  obEl('obSkip').style.display = obIndex === 0 ? 'none' : 'block';

  const cta = obEl('obCta');
  cta.textContent = OB_CTA[name] || 'Continue';
  cta.classList.remove('busy');
  obEl('onboardMsg').textContent = '';
  obEl('onboardMsg').className = 'auth-msg';

  obPersonalize();
  obRefreshGate();

  // Give a text slide its field straight away, but never on a phone's first
  // paint of a slide it has to scroll -- that yanks the keyboard up over the
  // question. Desktop only, where there is room for both.
  if (window.matchMedia('(min-width:700px)').matches){
    const field = { name:'obName', higher:'obHigherSelfName' }[name];
    if (field) setTimeout(() => { const f = obEl(field); if (f) f.focus(); }, 60);
  }
}

/* Their name, once we have it, everywhere it belongs. */
function obPersonalize(){
  const name = (obEl('obName').value || '').trim();
  const her = (obEl('obHigherSelfName').value || '').trim();
  obEl('obHigherQ').textContent = name ? `Hi ${name}, who are you becoming?` : 'Who are you becoming?';
  obEl('obAvatarQ').textContent = her ? `Who does ${her} look like?` : 'Who does she look like?';
  obEl('obVoiceQ').textContent = her
    ? `How do you want ${her} to speak to you?`
    : 'How do you want your higher self to speak to you?';

  /* Her introduction and her sign-off, both through the one avatar-and-bubble
     component. The greeting and "you're ready" are headings; what she says is
     in the bubble. This slide is the once that her name is established -- she
     says it here, and no bubble after it is labelled with it again. */
  obEl('obIntroQ').textContent = name ? `Hi, ${name}.` : 'Hi there.';
  const intro = obEl('obIntroDialogue');
  if (intro && typeof higherSelfDialogue === 'function'){
    obPaintDialogue(intro, {
      avatar: obChosenAvatar(),
      emotion: 'welcoming',
      message: `I'm ${her || 'your higher self'}. Let's build the version of you you've been imagining.`,
      speaker: her,
    });
    if (obChosenAvatar()) preloadHigherSelfEmotion(higherSelf.avatar, 'celebrating');
  }

  obEl('obFinishQ').textContent = name ? `You're ready, ${name}.` : "You're ready.";
  const finish = obEl('obFinishDialogue');
  if (finish && typeof higherSelfDialogue === 'function'){
    obPaintDialogue(finish, {
      avatar: obChosenAvatar(),
      emotion: 'celebrating',
      message: her
        ? `${her} is waiting. Everything you just told me is saved to your account — on every device you sign in from.`
        : 'Everything you just told me is saved to your account — on every device you sign in from.',
      speaker: her,
    });
  }
  obRenderFinishSummary();
}

/* What the dialogue should draw during the questionnaire: the identity in the
   draft once one has actually been tapped, and `null` -- nobody, deliberately
   -- until then. `higherSelf.avatar` holds the first of the roster from the
   moment the page loads, so reading it directly would introduce somebody the
   person has never seen and may not have chosen. */
function obChosenAvatar(){ return obAvatarPicked ? avatarId(higherSelf.avatar) : null; }

/* obPersonalize() runs on every slide change and on every keystroke in the two
   name fields, so writing the dialogue out each time would rebuild an <img>
   several times a second while somebody types. Written only when what it would
   say or show has actually changed. */
function obPaintDialogue(el, opts){
  const html = higherSelfDialogue(opts);
  if (el.dataset.painted === html) return;
  el.dataset.painted = html;
  el.innerHTML = html;
}

/* Their own answers, read back before they commit to them. Only the rows they
   actually answered: a half-finished list is worse than a short one. */
function obRenderFinishSummary(){
  const el = obEl('obFinishSummary');
  if (!el) return;
  const when = (OB_WHEN.find(w => w.id === obAnswers.when) || {}).label;
  const time = OB_TIME.find(t => t.id === obAnswers.time);
  const desires = obDesireLabels();
  const rows = [
    desires.length ? ['Your three', desires.join(' · ')] : null,
    when ? ['Best time', when] : null,
    time ? ['Start with', time.start] : null,
  ].filter(Boolean);
  el.innerHTML = rows.map(([k, v]) =>
    `<div class="ob-summary-row"><dt>${k}</dt><dd>${obEscape(v)}</dd></div>`).join('');
  el.style.display = rows.length ? 'block' : 'none';
}

function obEscape(text){
  return String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

/* Continue is refused only where the screen has nothing to carry forward: a
   name, the three desires, and an unanswered question. Everything else can be
   left alone and changed later. */
function obBlocked(){
  const name = obSlideName();
  if (name === 'name') return !(obEl('obName').value || '').trim();
  if (name === 'desires') return obAnswers.desires.length !== OB_DESIRE_COUNT;
  if (name === 'when') return !obAnswers.when;
  if (name === 'voice') return !obAnswers.voice;
  if (name === 'time') return !obAnswers.time;
  if (name === 'spirit'){
    if (!obAnswers.spirit) return true;
    // Naming a tradition is the whole of that answer, so it is asked for.
    return obAnswers.spirit === 'religion' && !(typeof myFaith !== 'undefined' && myFaith.id);
  }
  return false;
}
function obRefreshGate(){
  obEl('obCta').disabled = obSaving || obBlocked();
}

function obNext(){
  obCancelAdvance();
  if (obSaving || obBlocked()) return;
  if (obIndex >= OB_SLIDES.length - 1){ submitOnboarding(); return; }
  obIndex++;
  obShowSlide();
}
function obPrev(){
  obCancelAdvance();
  if (obSaving || obIndex === 0) return;
  obGoingBack = true;
  obIndex--;
  obShowSlide();
}

/* ---------- the chip lists ---------- */
function obChipMarkup(item, selected, dimmed){
  return `<button type="button" class="ob-chip${selected ? ' sel' : ''}${dimmed ? ' full' : ''}"
     data-id="${item.id}" aria-pressed="${selected}">${item.icon ? `<span class="ob-chip-icon">${item.icon}</span>` : ''}<span>${item.label}</span></button>`;
}

function obRenderChips(){
  const full = obAnswers.desires.length >= OB_DESIRE_COUNT;
  obEl('obDesireChips').innerHTML = OB_DESIRES.map(d =>
    obChipMarkup(d, obAnswers.desires.includes(d.id), full && !obAnswers.desires.includes(d.id))).join('');
  const left = OB_DESIRE_COUNT - obAnswers.desires.length;
  obEl('obDesireCount').textContent = left === 0 ? "That's your three." : `${left} more to choose.`;
  obEl('obDesireOther').style.display = obAnswers.desires.includes('other') ? 'block' : 'none';

  obRenderOneList('obWhenChips', OB_WHEN, obAnswers.when);
  obRenderOneList('obVoiceChips', OB_VOICE, obAnswers.voice);
  obRenderOneList('obSpiritChips', OB_SPIRIT, obAnswers.spirit);
  obRenderOneList('obTimeChips', OB_TIME, obAnswers.time);
  obRenderFaithBranch();
}

function obRenderOneList(listId, list, chosen){
  const wrap = obEl(listId);
  if (wrap) wrap.innerHTML = list.map(x => obChipMarkup(x, x.id === chosen, false)).join('');
}

/* "Religion is important to me" opens the tradition list faith.js already
   draws for Settings -- same chips, same ids, same save -- with the answers
   that are stances rather than religions hidden, since the question above
   just asked those. Nothing in faith.js changes. */
function obRenderFaithBranch(){
  const branch = obEl('obFaithPick');
  if (!branch) return;
  const religious = obAnswers.spirit === 'religion';
  branch.style.display = religious ? 'block' : 'none';
  if (religious && typeof renderFaithChips === 'function'){ renderFaithChips(); obFilterFaithChips(); }
  // faith.js opens its own words field for 'other'; before the stance is
  // answered there is nothing for it to belong to.
  const other = obEl('obFaithOther');
  if (other && !obAnswers.spirit) other.style.display = 'none';
}
function obFilterFaithChips(){
  document.querySelectorAll('#obFaithChips [data-faith]').forEach(btn => {
    btn.style.display = OB_RELIGIONS.includes(btn.dataset.faith) ? '' : 'none';
  });
}

/* One listener per list rather than an onclick per chip: the chips are redrawn
   on every tap, and a handler bound to the container survives that. It also
   means the whole card takes the tap -- icon, label and the gap between. */
function obSetupChipTaps(){
  const multi = { obDesireChips:'desires' };
  const single = { obWhenChips:'when', obVoiceChips:'voice', obSpiritChips:'spirit', obTimeChips:'time' };
  Object.keys(multi).forEach(listId => {
    const wrap = obEl(listId);
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.ob-chip');
      if (!chip || obSaving) return;
      obToggleChoice(multi[listId], chip.dataset.id);
    });
  });
  Object.keys(single).forEach(listId => {
    const wrap = obEl(listId);
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.ob-chip');
      if (!chip || obSaving) return;
      obPickOne(single[listId], chip.dataset.id);
    });
  });
  // faith.js's own chips re-render themselves on a tap, which puts back the
  // ones hidden above -- so the filter and the gate are re-applied after it.
  const faithWrap = obEl('obFaithChips');
  if (faithWrap) faithWrap.addEventListener('click', () => { obFilterFaithChips(); obRefreshGate(); });
}

function obToggleChoice(field, id){
  const chosen = obAnswers[field];
  const at = chosen.indexOf(id);
  if (at > -1) chosen.splice(at, 1);
  else if (chosen.length >= OB_DESIRE_COUNT) return;   // three means three
  else chosen.push(id);
  obRenderChips();
  obRefreshGate();
}

/* A single answer answers the whole screen, so the gold lands on the card and
   the screen moves on by itself -- long enough to see the choice register,
   short enough not to feel like waiting. Two answers open something else on
   the same screen instead, and those wait for Continue. */
let obAdvanceTimer = null;
function obCancelAdvance(){ if (obAdvanceTimer){ clearTimeout(obAdvanceTimer); obAdvanceTimer = null; } }

function obPickOne(field, id){
  obAnswers[field] = id;
  if (field === 'spirit') obApplySpirit(id);
  obRenderChips();
  obRefreshGate();
  const holds = field === 'spirit' && (id === 'religion' || id === 'else');
  if (holds || obBlocked()) return;
  obCancelAdvance();
  const from = obIndex;
  obAdvanceTimer = setTimeout(() => {
    obAdvanceTimer = null;
    if (obIndex === from) obNext();     // not if they went back in the meantime
  }, 420);
}

/* The stance maps straight onto the vocabulary faith.js already has, so
   answering it here is the same answer Settings reads and writes later. */
function obApplySpirit(id){
  const pick = OB_SPIRIT.find(x => x.id === id) || {};
  if (typeof myFaith === 'undefined') return;
  myFaith = { id: pick.faith || null, own: pick.faith === 'other' ? (myFaith.own || '') : '' };
  if (typeof renderFaithChips === 'function') renderFaithChips();   // shows the "in your own words" field for 'other'
}

/* The same roster as the profile page, at the moment it actually matters --
   you are deciding who you are here, so it belongs with your name, not three
   screens into settings. */
function renderOnboardAvatars(){
  const wrap = document.getElementById('obAvatarRoster');
  if (!wrap || typeof AVATAR_PACK === 'undefined') return;
  wrap.innerHTML = AVATAR_PACK.map(a =>
    `<button type="button" class="av-opt${a.id === higherSelf.avatar ? ' sel' : ''}"
       onclick="pickOnboardAvatar('${a.id}')" aria-pressed="${a.id === higherSelf.avatar}"
       title="${a.label}" aria-label="${a.label} — ${a.look}">${avatarMarkup({ avatar:a.id }, { state:'hero', cut:'thumb', alt:false })}</button>`).join('');
}
/* The enlarged look at whoever is chosen, above the grid. Closed until the
   first tap, and left open after it -- tapping somebody else swaps who is in
   it rather than shutting it, which is what makes comparing two faces one tap
   each instead of three. */
let obAvatarPreviewOpen = false;
/* Whether the roster has actually been tapped. The avatar slide can be walked
   past without choosing, and in that case there is no chosen identity to draw
   -- not the default one standing in for it. */
let obAvatarPicked = false;

function renderOnboardAvatarPreview(){
  const wrap = document.getElementById('obAvatarPreview');
  if (!wrap || typeof avatarEntry !== 'function') return;
  if (!obAvatarPreviewOpen){ wrap.hidden = true; wrap.innerHTML = ''; return; }
  const a = avatarEntry(higherSelf.avatar);
  /* The full drawing as it ships, head to trainers, and nothing else: no face
     crop and no written description. Who she is reads off the picture, so the
     label is carried on the group rather than printed under it -- a screen
     reader still hears which one is standing here. */
  wrap.setAttribute('aria-label', a.label + ', enlarged');
  wrap.innerHTML = `
    <button type="button" class="ob-avatar-close" onclick="closeOnboardAvatarPreview()" aria-label="Close this preview and keep browsing">&times;</button>
    <div class="ob-avatar-art">
      ${avatarMarkup({ avatar:a.id }, { state:'hero', cut:'full', alt:false })}
    </div>
    <button type="button" class="ob-avatar-pick" onclick="obNext()">Choose this avatar</button>`;
  wrap.hidden = false;
}

function closeOnboardAvatarPreview(){
  obAvatarPreviewOpen = false;
  renderOnboardAvatarPreview();
}

/* Held until the last slide, rather than written on every tap: the whole row
   saves at once, so there is nothing to write yet. */
function pickOnboardAvatar(id){
  higherSelf.avatar = avatarId(id);
  obAvatarPicked = true;
  obAvatarPreviewOpen = true;
  // The next two slides are her speaking; fetch the first of those drawings
  // while the roster is still on screen.
  if (typeof preloadHigherSelfEmotion === 'function') preloadHigherSelfEmotion(higherSelf.avatar, 'welcoming');
  renderOnboardAvatars();
  renderOnboardAvatarPreview();
  // The preview sits above the grid, so opening it pushes the row that was
  // just tapped down the page. `nearest` brings it back into view on the tap
  // that opens it and does nothing on the taps after, when it is already there.
  const wrap = document.getElementById('obAvatarPreview');
  if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

/* Typing is the other way a slide changes: the name feeds later headlines, and
   an empty name keeps Continue shut. */
function obSetupInputs(){
  ['obName','obHigherSelfName'].forEach(id => {
    const el = obEl(id);
    if (el) el.addEventListener('input', () => { obPersonalize(); obRefreshGate(); });
  });
  // Enter moves on, the way the on-screen keyboard's "next" key implies.
  ['obName','obHigherSelfName','obFaithOther','obDesireOther'].forEach(id => {
    const el = obEl(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); obNext(); } });
  });
}

function setupOnboarding(){
  if (!document.getElementById('onboardOverlay')) return;
  obSetupChipTaps();
  obSetupInputs();
}

/* ---------- saving, once, at the end ----------
   The rule here is that nothing moves until the database says yes. A failed
   save leaves them on this slide with their answers intact and something to
   read, because the alternative -- closing onboarding on a write that did not
   land -- is exactly the bug that sent people back through it every login. */
function obLabelsFor(list, ids){
  return ids.map(id => (list.find(x => x.id === id) || {}).label).filter(Boolean);
}
/* "Other" is saved as whatever they typed, not as the word "Other". */
function obDesireOwnWords(){
  return ((obEl('obDesireOther') || {}).value || '').trim().slice(0, 80);
}
function obDesireLabels(){
  const own = obDesireOwnWords();
  return obAnswers.desires
    .map(id => id === 'other' ? (own || 'Other') : (OB_DESIRES.find(d => d.id === id) || {}).label)
    .filter(Boolean);
}

async function submitOnboarding(){
  const msg = obEl('onboardMsg');
  const cta = obEl('obCta');
  if (obSaving) return;                       // a second tap while saving does nothing
  if (!sb || !currentUser){ closeOnboardingModal(); return; }

  obSaving = true;
  cta.classList.add('busy');
  cta.disabled = true;
  obEl('obBack').disabled = true;
  msg.textContent = 'Saving…'; msg.className = 'auth-msg';

  const higherName = (obEl('obHigherSelfName').value || '').trim().slice(0, 24);
  const displayName = (obEl('obName').value || '').trim().slice(0, 40);
  const patch = {
    full_name: displayName || null,
    display_name: displayName || null,
    higher_self_name: higherName || null,
    higher_self_avatar: higherSelf.avatar,
    onboarding_desires: obDesireLabels(),
    onboarding_goal: obAnswers.desires.includes('other') ? (obDesireOwnWords() || null) : null,
    /* The four new answers go in the jsonb column that already holds what
       somebody said during onboarding, keyed, rather than four columns this
       change is not allowed to add. The two retired questions are cleared with
       the same write, so nobody carries a stale answer to a question that is
       no longer asked. */
    onboarding_goals: {
      support_when: (OB_WHEN.find(w => w.id === obAnswers.when) || {}).label || null,
      voice: (OB_VOICE.find(v => v.id === obAnswers.voice) || {}).label || null,
      spirituality: (OB_SPIRIT.find(x => x.id === obAnswers.spirit) || {}).label || null,
      /* The id as well as the label. The habit tracker has to tell "religion
         is important to me, and it is not on your list" apart from "something
         else entirely" -- both of which set faith to 'other' -- and matching a
         display label back to a list is not a thing to build a person's
         starting habits on. See faithPrefersPrayer(). */
      spirituality_id: obAnswers.spirit || null,
      daily_minutes: (OB_TIME.find(t => t.id === obAnswers.time) || {}).minutes || null,
    },
    onboarding_struggles: [],
    onboarding_struggle: null,
    onboarding_completed: true,
    onboarding_completed_at: new Date().toISOString(),
    ...(typeof faithAnswerForSave === 'function' ? faithAnswerForSave() : {}),
  };

  const error = await saveProfile(patch);
  if (error){
    obSaving = false;
    cta.classList.remove('busy');
    obEl('obBack').disabled = false;
    obRefreshGate();
    msg.textContent = describeSaveError(error);
    msg.className = 'auth-msg err';
    console.error('Onboarding save failed:', error);
    return;
  }

  // Read it back before moving. A write that reported no error but did not
  // land is the whole reason this screen used to come back every time.
  const saved = await myProfile({ force: true });
  if (!saved || saved.onboarding_completed !== true){
    obSaving = false;
    cta.classList.remove('busy');
    obEl('obBack').disabled = false;
    obRefreshGate();
    msg.textContent = "Saved, but we couldn't confirm it — tap again.";
    msg.className = 'auth-msg err';
    return;
  }

  higherSelf.name = higherName;
  higherSelf.avatar = avatarId(saved.higher_self_avatar);
  higherSelfLoaded = true;
  obSaving = false;
  closeOnboardingModal();
  showTodayPage();
}

async function logOut(){
  if (!sb) return;
  // Don't carry one account's cloned voice or generated lines into the next.
  forgetVoiceCatalogue();
  voiceCatalogue = { presets: FALLBACK_PRESET_VOICES, myVoice: null, consentStatement: VOICE_CONSENT_FALLBACK, provider: null, loaded: false };
  ttsCache.clear(); studioClipHandles.clear(); sequencePrepares.clear();
  await sb.auth.signOut();
}
/* Apple requires in-app account deletion for any app with sign-up. The heavy
   lifting (storage, rows, the auth user itself) happens in /api/delete-account
   with the service role key; the browser only proves who's asking. */
async function deleteMyAccount(){
  const msg = document.getElementById('deleteAccountMsg');
  if (!sb || !currentUser) return;
  const { data } = await sb.auth.getSession();
  const token = data.session && data.session.access_token;
  if (!token){ msg.textContent = 'Log in again, then retry.'; msg.className = 'save-msg err'; return; }
  document.getElementById('deleteAccountConfirm').style.display = 'none';
  msg.textContent = 'Deleting your account…'; msg.className = 'save-msg';
  try {
    const res = await fetch(API_BASE + '/api/delete-account', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok){
      const body = await res.json().catch(() => ({}));
      msg.textContent = body.error || "Couldn't delete your account — email hello@subliminallybyfthr.com and we'll do it by hand.";
      msg.className = 'save-msg err';
      return;
    }
  } catch (e){
    msg.textContent = "Couldn't reach the server — check your connection and try again.";
    msg.className = 'save-msg err';
    return;
  }
  await sb.auth.signOut();
  goHome();
  alert('Your account and everything in it has been deleted.');
}

function renderAccountArea(){
  const area = document.getElementById('authArea');
  if (currentUser){
    area.innerHTML = `<div class="account-chip"><button class="nav-identity" onclick="showProfilePage()" title="Your profile"><span class="nav-avatar" id="navAvatar">🌙</span><b id="navChipName">${currentUser.email.split('@')[0]}</b></button><button onclick="confirmLogOut()">Log out</button></div>`;
    loadNavIdentity();
  } else {
    area.innerHTML = `<button class="nav-cta" onclick="openAuthModal()">Log in</button>`;
  }
  renderNavLinks();
  // Logging out from Today would leave you staring at a hidden page.
  if (!currentUser && document.body.getAttribute('data-view') === 'today') showMarketingHome();
  renderJournalState();
  renderRitualsState();
  renderProfileState();
  renderMyLibraryState();
  applyPricingVisibility();
  if (document.body.getAttribute('data-view') === 'today') renderTodayPage();
}
/* Two different navs for two different people. A member gets the four places
   the practice lives; a visitor gets the marketing set. Pricing and the
   science stay reachable for members — from Profile and the Today links —
   they're just not the furniture they see every day. */
function renderNavLinks(){
  const links = currentUser
    ? [
        ['Today', 'showTodayPage()'],
        ['Rituals', 'showRitualsPage()'],
        ['Journal', 'showJournalPage()'],
        ['Subliminals', 'showLibraryPage()'],
      ]
    : [
        ['Build yours', 'showBuildPage()'],
        ['Subliminals', 'showLibraryPage()'],
        ['The Science', 'showReprogramPage()'],
        ['Pricing', "showMarketingHome(); goTo('pricing')"],
      ];
  document.getElementById('navLinks').innerHTML = links
    .map(([label, action]) => `<button onclick="${action}; closeMobileNav();">${label}</button>`)
    .join('');
}
async function loadNavIdentity(){
  if (!sb || !currentUser) return;
  const prof = await myProfile();
  const nameEl = document.getElementById('navChipName');
  const avatarEl = document.getElementById('navAvatar');
  if (!nameEl || !avatarEl) return; // nav may have re-rendered already
  if (prof) nameEl.textContent = prof.username || prof.full_name || currentUser.email.split('@')[0];
  // The chip is you, not her: the everyday drawing rather than the robed one.
  // Use the avatar from the profile, not the global higherSelf which may not be initialized yet.
  if (prof) avatarEl.innerHTML = avatarMarkup({ avatar: avatarId(prof.higher_self_avatar) }, { state:'hero', cut:'face', alt:false });
}

