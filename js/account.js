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
async function myProfile(opts){
  if (!sb || !currentUser) return null;
  if (opts && opts.force) forgetFetch('profileRow');
  const { data, error } = await fetchOnce('profileRow', () =>
    sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle(), 300000);
  if (error){ forgetFetch('profileRow'); console.warn('profile:', error.message); return null; }
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

function setupNativeOAuthCallback(){
  if (!isNativeApp() || !sb || !window.Capacitor.Plugins.App) return;
  window.Capacitor.Plugins.App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || url.indexOf('login-callback') === -1) return;
    if (window.Capacitor.Plugins.Browser){ try { await window.Capacitor.Plugins.Browser.close(); } catch(e){} }
    const { error } = await sb.auth.exchangeCodeForSession(url);
    if (!error) closeAuthModal();
  });
}

// Google sign-in creates the auth user but skips our username/avatar
// questionnaire, so send anyone who lands here without one through onboarding.
async function promptOnboardingIfProfileIncomplete(){
  if (!sb || !currentUser) return;
  const prof = await myProfile();
  if (prof && !prof.username) openOnboardingModal();
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
  setTimeout(() => {
    closeAuthModal();
    if (wasSignup) openOnboardingModal();
    else showTodayPage();
  }, 600);
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

/* ---------------- ONBOARDING: username ---------------- */
function openOnboardingModal(){
  document.getElementById('onboardOverlay').classList.add('open');
  // Both of these are drawn from lists in JS, so they are empty until asked for.
  if (typeof renderFaithChips === 'function') renderFaithChips();
  renderOnboardAvatars();
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
/* Held until Finish setup, rather than written on every tap: there is no
   account row worth writing to yet, and the whole modal saves at once. */
function pickOnboardAvatar(id){
  higherSelf.avatar = avatarId(id);
  renderOnboardAvatars();
}
function closeOnboardingModal(){ document.getElementById('onboardOverlay').classList.remove('open'); }
function skipOnboarding(){ closeOnboardingModal(); }

async function submitOnboarding(){
  const msg = document.getElementById('onboardMsg');
  if (!sb || !currentUser){ closeOnboardingModal(); return; }
  const username = document.getElementById('obUsername').value.trim();
  const patch = {
    full_name: document.getElementById('obName').value.trim() || null,
    username: username || null,
    phone: document.getElementById('obPhone').value.trim() || null,
    referral_source: document.getElementById('obSource').value || null,
    signup_reason: document.getElementById('obReason').value.trim() || null,
    onboarding_desires: Array.from(document.querySelectorAll('[name="obDesire"]')).map(el => el.value.trim()).filter(Boolean).slice(0,3),
    onboarding_struggle: document.getElementById('obStruggle').value.trim() || null,
    onboarding_goal: document.getElementById('obGoal').value.trim() || null,
    higher_self_name: document.getElementById('obHigherSelfName').value.trim().slice(0,24) || null,
    higher_self_avatar: higherSelf.avatar,
    ...(typeof faithAnswerForSave === 'function' ? faithAnswerForSave() : {}),
  };
  msg.textContent = 'Saving…'; msg.className = 'auth-msg';
  const error = await saveProfile(patch);
  if (error){
    if (error.message && error.message.toLowerCase().includes('duplicate')){
      msg.textContent = 'That username is taken — try another.'; msg.className = 'auth-msg err';
    } else {
      msg.textContent = "Couldn't save — you can skip for now."; msg.className = 'auth-msg err';
    }
    return;
  }
  higherSelf.name = patch.higher_self_name || '';
  closeOnboardingModal();
}
async function logOut(){
  if (!sb) return;
  // Don't carry one account's cloned voice or generated lines into the next.
  clonedVoiceCache = undefined;
  ttsCache.clear(); studioClipHandles.clear();
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
  avatarEl.innerHTML = avatarMarkup(higherSelf, { state:'hero', cut:'face', alt:false });
}

