#!/usr/bin/env node
/* faith-language-test.js — the saved faith answer, from the card to the prompt

   Not part of the site: scripts/ is excluded from the deploy and from what the
   native apps bundle. It loads the real js/faith.js into a sandbox with a
   small stand-in for the Settings card, and reads lib/faith-language.js and
   the migration as text.

     npm run test:faith

   The bugs it pins:
     - Two answers on screen -- Universe / Manifestation and the neutral,
       psychology-based one -- were not in the column's check constraint, so
       choosing either lit the chip, failed the save, and was gone by the next
       load. Every answer offered has to be an answer the database accepts.
     - A saved answer that does not come back highlighted is the whole reason
       the selected state exists, and it is easy to lose to a repaint.
     - js/faith.js and lib/faith-language.js are two halves of one question,
       keyed by the same ids. An answer added to one belongs in the other, or
       somebody's subliminals quietly come back in the neutral vocabulary. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* Just enough of an element for what faith.js touches. */
function el(){
  return { innerHTML:'', value:'', style:{}, attrs:{}, arrow:{ textContent:'↓' },
    hasAttribute(n){ return n in this.attrs; },
    setAttribute(n,v){ this.attrs[n] = v; },
    removeAttribute(n){ delete this.attrs[n]; },
    getAttribute(n){ return this.attrs[n]; },
    querySelector(){ return this.arrow; }, focus(){} };
}
const nodes = {};
['settingsFaithChips','settingsFaithOther','faithDetails','faithDetailsToggle','faithSettingsMsg']
  .forEach(id => { nodes[id] = el(); });
nodes.faithDetails.setAttribute('hidden', '');
nodes.faithDetailsToggle.setAttribute('aria-expanded', 'false');

const ctx = { console, document: { getElementById: id => nodes[id] || null },
  sb: null, currentUser: null, myProfile: async () => ({}),
  saveProfile: async () => null, describeSaveError: () => '' };
vm.createContext(ctx);
vm.runInContext(read('js/faith.js'), ctx);
/* `const` and `let` at the top of a script are lexical: the browser sees them
   as globals, a vm context does not, so they are handed out deliberately. */
vm.runInContext(`globalThis.api = { FAITHS, renderFaithSettings, toggleFaithDetails,
  faithPersonalization, faithHigher,
  get myFaith(){ return myFaith; }, set myFaith(v){ myFaith = v; } };`, ctx);
const api = ctx.api;

let failures = 0;
const check = (name, pass) => { console.log((pass ? 'PASS  ' : 'FAIL  ') + name); if (!pass) failures++; };

const constraint = read('supabase/migrations/20261004_faith_language_options.sql');
const server = read('lib/faith-language.js');

api.FAITHS.forEach(f => {
  check(`'${f.id}' is an answer the column accepts`, constraint.includes(`'${f.id}'`));
  check(`'${f.id}' has framing for the generators`, new RegExp(`\\n  ${f.id}: \\{`).test(server));

  // Saved, and back again: exactly one chip marked, and it is theirs.
  api.myFaith = { id: f.id, own: f.id === 'other' ? 'my ancestors' : '' };
  api.renderFaithSettings();
  const html = nodes.settingsFaithChips.innerHTML;
  const marked = (html.match(/length-chip sel"[\s\S]*?data-faith="([a-z]+)"/) || [])[1];
  check(`saved '${f.id}' comes back highlighted`,
    marked === f.id && (html.match(/length-chip sel/g) || []).length === 1);
});

api.myFaith = { id:'other', own:'my ancestors' }; api.renderFaithSettings();
check("'Something else' shows the field its word is typed in",
  nodes.settingsFaithOther.style.display === 'block' && nodes.settingsFaithOther.value === 'my ancestors');
api.myFaith = { id:'islam', own:'' }; api.renderFaithSettings();
check('every other answer hides it', nodes.settingsFaithOther.style.display === 'none');

// "What will change?" -- closed on arrival, and a tap either way.
check('the explanation starts folded away', nodes.faithDetails.hasAttribute('hidden'));
api.toggleFaithDetails();
check('a tap opens it', !nodes.faithDetails.hasAttribute('hidden')
  && nodes.faithDetailsToggle.getAttribute('aria-expanded') === 'true'
  && nodes.faithDetailsToggle.arrow.textContent === '↑');
api.toggleFaithDetails();
check('a second tap closes it', nodes.faithDetails.hasAttribute('hidden')
  && nodes.faithDetailsToggle.getAttribute('aria-expanded') === 'false'
  && nodes.faithDetailsToggle.arrow.textContent === '↓');

// What the rest of the app reads off the answer.
api.myFaith = { id:'universe', own:'' };
const uni = api.faithPersonalization();
check('the answer carries its own vocabulary and practices',
  uni.id === 'universe' && uni.higher === 'the Universe'
  && uni.words.includes('alignment') && uni.practices.includes('visualization'));
api.myFaith = { id:'other', own:'my ancestors' };
check("a word typed under 'Something else' is used as a name and nothing else",
  api.faithPersonalization().word === 'my ancestors' && api.faithHigher() === 'my ancestors');
api.myFaith = { id:null, own:'' };
check('no answer is the neutral set, not a guess',
  api.faithPersonalization().id === null && api.faithHigher() === null);

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
