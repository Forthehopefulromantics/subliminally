/* test-auth-flow.mjs — what happens when somebody comes back from an email link.

   No dependencies and no network: the URL shapes Supabase really sends, run
   against the real handlers out of js/account.js and reset-password.html with a
   stubbed client and a stubbed DOM.

     node scripts/test-auth-flow.mjs

   The other half of this flow lives in the database, where the profile save was
   being refused by RLS; that part is checked by scripts/verify-auth-flow.sql. */
import fs from 'fs';
import vm from 'vm';

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + extra}`);
};

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const accountSrc = read('../js/account.js');
const homeCode = accountSrc.slice(
  accountSrc.indexOf('/* ---------- coming back from an email link'),
  accountSrc.indexOf('/* ---------------- SIGNUP: username'));

const resetScript = read('../reset-password.html')
  .match(/<script>([\s\S]*?)<\/script>/g).pop().replace(/^<script>|<\/script>$/g, '');
// just the part that opens the link; submitNewPassword wants a real form
const resetCode = resetScript.slice(
  resetScript.indexOf('const msgEl'),
  resetScript.indexOf('async function submitNewPassword'));

/* ---------- the home page, js/account.js ---------- */
function runHome(href, { session = null, verifyOtpError = null } = {}){
  const st = { verifyOtpCalledWith: null, modalOpened: false, msgHtml: '', msgClass: '', replacedTo: null, finalUrl: null };
  const msgEl = {
    set innerHTML(v){ st.msgHtml = v; }, get innerHTML(){ return st.msgHtml; },
    set textContent(v){ st.msgHtml = v; }, set className(v){ st.msgClass = v; },
  };
  const url = new URL(href);
  const sandbox = {
    console, URL, URLSearchParams,
    sb: { auth: {
      verifyOtp: async (args) => { st.verifyOtpCalledWith = args; return { error: verifyOtpError }; },
      getSession: async () => ({ data: { session } }),
    }},
    window: { location: { href, search: url.search, hash: url.hash, pathname: url.pathname,
                          replace: (to) => { st.replacedTo = to; } } },
    document: { getElementById: () => msgEl },
    history: { replaceState: (a, b, u) => { st.finalUrl = u; } },
    openAuthModal: () => { st.modalOpened = true; },
  };
  vm.createContext(sandbox);
  vm.runInContext(homeCode + '\n;globalThis.__run = handleAuthRedirect();', sandbox);
  return sandbox.__run.then(() => st);
}

/* ---------- the reset page ---------- */
function runReset(href, { session = null, verifyOtpError = null } = {}){
  const st = { msg: '', cls: '', shown: [], verifyOtpCalledWith: null, finalUrl: null };
  const url = new URL(href);
  const els = {
    msg: { set textContent(v){ st.msg = v; }, set className(v){ st.cls = v; } },
    formWrap: { style: { set display(v){ st.shown.push('formWrap:' + v); } } },
    backLink: { style: { set display(v){ st.shown.push('backLink:' + v); } } },
  };
  const sandbox = {
    console, URL, URLSearchParams,
    sb: { auth: {
      verifyOtp: async (a) => { st.verifyOtpCalledWith = a; return { error: verifyOtpError }; },
      getSession: async () => ({ data: { session } }),
    }},
    document: { getElementById: (id) => els[id] },
    window: { location: { href, search: url.search, hash: url.hash, pathname: url.pathname } },
    history: { replaceState: (a, b, u) => { st.finalUrl = u; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(resetCode, sandbox); // the page's IIFE; give it turns to settle
  return new Promise((r) => setImmediate(() => setImmediate(() => r(st))));
}

const SITE = 'https://www.subliminallybyfthr.com';
const RESET = SITE + '/reset-password.html';

(async () => {
  console.log('coming home from an email link');
  let s = await runHome(`${SITE}/#today`);
  check('a normal page load is left alone', !s.modalOpened && s.finalUrl === null && !s.verifyOtpCalledWith, JSON.stringify(s));

  s = await runHome(`${SITE}/?token_hash=pkce_abc123&type=email`);
  check('a token_hash signup link is verified', s.verifyOtpCalledWith &&
    s.verifyOtpCalledWith.token_hash === 'pkce_abc123' && s.verifyOtpCalledWith.type === 'email', JSON.stringify(s));
  check('a verified link opens no error modal', !s.modalOpened, JSON.stringify(s));
  check('the token is stripped from the address bar', s.finalUrl === '/', String(s.finalUrl));

  s = await runHome(`${SITE}/?token_hash=dead&type=email`, { verifyOtpError: { message: 'Token has expired' } });
  check('an expired token_hash is reported, with a way out', s.modalOpened &&
    /expired/i.test(s.msgHtml) && /Resend confirmation/.test(s.msgHtml), JSON.stringify(s));

  s = await runHome(`${SITE}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
  check('an error in the fragment is read and explained', s.modalOpened && /expired/i.test(s.msgHtml), JSON.stringify(s));
  check('the error is cleared from the address bar', s.finalUrl === '/', String(s.finalUrl));

  s = await runHome(`${SITE}/?token_hash=rec_1&type=recovery`);
  check('a recovery link is forwarded to the reset page',
    s.replacedTo === '/reset-password.html?token_hash=rec_1&type=recovery', String(s.replacedTo));
  check('a forwarded recovery link is not verified here', !s.verifyOtpCalledWith, JSON.stringify(s));

  s = await runHome(`${SITE}/?code=abc`, { session: null });
  check('a code with no session says log in, and does not offer a resend',
    s.modalOpened && /log in here once/.test(s.msgHtml) && !/Resend/.test(s.msgHtml), JSON.stringify(s));
  check('that message is not styled as an error', s.msgClass === 'auth-msg ok', s.msgClass);

  s = await runHome(`${SITE}/?code=abc`, { session: { user: { id: 'u' } } });
  check('a code that was exchanged is silent', !s.modalOpened, JSON.stringify(s));
  check('the code is stripped after a good exchange', s.finalUrl === '/', String(s.finalUrl));

  console.log('\nsetting a new password');
  s = await runReset(`${RESET}?token_hash=rec_abc&type=recovery`);
  check('a token_hash recovery link is verified', s.verifyOtpCalledWith &&
    s.verifyOtpCalledWith.token_hash === 'rec_abc' && s.verifyOtpCalledWith.type === 'recovery', JSON.stringify(s));
  check('the form stays up for a good link', !s.shown.includes('formWrap:none'), JSON.stringify(s.shown));
  check('the token is stripped from the address bar', s.finalUrl === '/reset-password.html', String(s.finalUrl));

  s = await runReset(`${RESET}?token_hash=dead&type=recovery`, { verifyOtpError: { message: 'expired' } });
  check('an expired token_hash hides the form and explains',
    /expired/i.test(s.msg) && s.shown.includes('formWrap:none'), JSON.stringify(s));

  s = await runReset(`${RESET}#error=access_denied&error_code=otp_expired`);
  check('an error fragment hides the form', /expired/i.test(s.msg) && s.shown.includes('formWrap:none'), JSON.stringify(s));
  check('an error fragment is not sent to verifyOtp', !s.verifyOtpCalledWith, JSON.stringify(s));

  s = await runReset(`${RESET}#access_token=xyz&type=recovery`, { session: { user: { id: 'u' } } });
  check('an implicit-flow recovery link still works', !s.shown.includes('formWrap:none') && s.msg === '', JSON.stringify(s));

  s = await runReset(`${RESET}?code=abc`, { session: null });
  check('a code with no verifier says which browser to use',
    /different browser/i.test(s.msg) && s.shown.includes('formWrap:none'), JSON.stringify(s));

  s = await runReset(`${RESET}?code=abc`, { session: { user: { id: 'u' } } });
  check('a code that was exchanged opens the form', !s.shown.includes('formWrap:none'), JSON.stringify(s));

  s = await runReset(RESET, { session: null });
  check('landing with nothing at all is refused', /invalid or has expired/i.test(s.msg), JSON.stringify(s));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
