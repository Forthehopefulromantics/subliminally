/* faith.js — whose words the app uses

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html.

   Asked once, when the account is made, and answerable with nothing at all.
   It changes what things are called and which habits get suggested. It does
   not change what anyone can do here, what anything costs, or what is on the
   screen otherwise — a person who skips it gets the neutral set, which is the
   same app with the same features.

   The neutral set is the default and the fallback, so an answer this file has
   never heard of behaves exactly like no answer. That matters for 'other',
   where the person writes their own word: we use it where a name is wanted and
   keep the neutral phrasing everywhere else, because we know what they call it
   and nothing else about it.

   Nothing here is a claim about anybody's faith. It is vocabulary. */

const FAITHS = [
  {
    id: 'christianity', label: 'Christianity',
    words: ['God','prayer','faith','grace','being led'],
    practices: ['prayer','scripture reading','gratitude','reflection'],
    higher: 'God', figure: 'Jesus', practice: 'prayer', text: 'the Bible',
    /* Said where the app would otherwise say something vague about the
       universe. Kept short, and never a promise about outcomes. */
    line: 'God wants this life for you.',
    habits: { morning:['Morning prayer','Read a chapter','Sit with a verse'], night:['Evening prayer','Gratitude to God','Examine the day'] },
  },
  {
    id: 'islam', label: 'Islam',
    words: ['Allah','prayer','du‘a','patience','gratitude'],
    practices: ['prayer','du‘a','reflection','gratitude'],
    higher: 'Allah', figure: 'the Prophet Muhammad ﷺ', practice: 'salah', text: 'the Qur’an',
    line: 'Allah has not brought you this far to leave you.',
    habits: { morning:['Fajr on time','Read Qur’an','Morning adhkar'], night:['Isha on time','Evening adhkar','Make du‘a'] },
  },
  {
    id: 'hinduism', label: 'Hinduism',
    words: ['the divine','dharma','stillness','devotion'],
    practices: ['meditation','prayer','reflection','gratitude'],
    higher: 'Brahman', figure: 'the divine in you', practice: 'puja', text: 'the Gita',
    line: 'What you are reaching for is already within you.',
    habits: { morning:['Morning puja','Japa','Read a verse'], night:['Evening aarti','Reflect on the day','Seva'] },
  },
  {
    id: 'universe', label: 'Universe / Manifestation',
    words: ['the Universe','alignment','manifestation','intention','energy'],
    practices: ['visualization','scripting','intention setting','gratitude'],
    higher: 'the Universe', figure: 'your future self', practice: 'manifesting', text: 'your journal',
    line: 'What you are calling in is already on its way.',
    habits: { morning:['Morning intention','Read your affirmations','Visualise the day'], night:['Scripting','Gratitude list','Thank the day'] },
  },
  {
    id: 'psychology', label: 'Neutral / Psychology-based',
    words: ['mindset','self-talk','habits','reflection','your own agency'],
    practices: ['reflection','journalling','habit practice','planning'],
    /* Deliberately the neutral vocabulary: chosen by people who want the
       practice without the language around it. Everything else reads a blank
       answer the same way, so this simply makes that choice sayable. */
    higher: 'your potential', figure: 'the person you are becoming', practice: 'practice', text: 'your journal',
    line: 'Repetition is how a new thought becomes a familiar one.',
    habits: { morning:['Morning intention','Read your affirmations','Plan one priority'], night:['Reflect on the day','Note one win','Wind down'] },
  },
  {
    id: 'spirituality', label: 'Spiritual, not religious',
    words: ['your higher self','intuition','energy','alignment','inner guidance'],
    practices: ['meditation','visualization','reflection','gratitude'],
    higher: 'the Universe', figure: 'your higher self', practice: 'manifesting', text: 'your journal',
    line: 'The Universe is already moving toward you.',
    habits: { morning:['Morning meditation','Scripting','Set an intention'], night:['Gratitude list','Visualise it','Moon check-in'] },
  },
  {
    id: 'agnostic', label: 'Not sure',
    words: ['what you are reaching for','steadiness','practice'],
    practices: ['reflection','meditation','gratitude','journalling'],
    higher: null, figure: 'the person you are becoming', practice: 'practice', text: 'your journal',
    line: 'You are the one doing this. That is enough.',
    habits: { morning:['Sit quietly','Morning pages','Set an intention'], night:['Gratitude list','Wind down','Breathe'] },
  },
  {
    id: 'other', label: 'Something else', freeText: true,
    words: ['what you are reaching for','steadiness','practice'],
    practices: ['reflection','meditation','gratitude','journalling'],
    higher: null, figure: 'the person you are becoming', practice: 'practice', text: 'your journal',
    line: 'You are the one doing this. That is enough.',
    habits: { morning:['Sit quietly','Morning pages','Set an intention'], night:['Gratitude list','Wind down','Breathe'] },
  },
];
const NEUTRAL_FAITH = FAITHS.find(f => f.id === 'agnostic');

/* { id, own } — `own` is only set for 'other', and only ever used as a name. */
let myFaith = { id: null, own: '' };

function faithById(id){ return FAITHS.find(f => f.id === id) || NEUTRAL_FAITH; }
function faithNow(){ return faithById(myFaith.id); }

/* What to call whatever is larger than you, in this person's words. Returns
   null when they have not said, so callers can leave the sentence out rather
   than fill it with a guess. */
function faithHigher(){
  const f = faithNow();
  if (f.id === 'other' && myFaith.own) return myFaith.own;
  return f.higher;
}
function faithLine(){
  const f = faithNow();
  /* No verb, because we do not know whether what they named is singular. "My
     ancestors is already with you" is the kind of sentence that tells someone
     the app was not written with them in mind. */
  if (f.id === 'other' && myFaith.own) return `${myFaith.own} — already with you in this.`;
  return f.line;
}
/* By time of day, because a night habit offered at seven in the morning is
   noise -- "wind down" was appearing in the morning list. */
function faithHabitIdeas(time){
  const h = faithNow().habits || {};
  if (time === 'morning' || time === 'night') return (h[time] || []).slice();
  return [...(h.morning || []), ...(h.night || [])];
}

/* The whole saved answer as one object, for anything that wants more than a
   single word out of it -- the vocabulary this person uses and the practices
   worth suggesting to them. `word` is the name they typed under 'Something
   else', and is null for every other answer.

   This and lib/faith-language.js are the two halves of the same question,
   keyed by the same ids: this one is what the interface says, that one is what
   the generating endpoints are told before they write. Add an answer to one
   and it belongs in the other. */
function faithPersonalization(){
  const f = faithNow();
  return {
    id: myFaith.id || null,
    label: f.label,
    word: (myFaith.id === 'other' && myFaith.own) ? myFaith.own : null,
    higher: faithHigher(),
    practice: f.practice,
    text: f.text,
    words: (f.words || []).slice(),
    practices: (f.practices || []).slice(),
  };
}

/* Rewrites a line written in the neutral vocabulary. Anything we do not have a
   word for is left exactly as it was, which is why every token has a neutral
   fallback rather than an empty string. */
function inMyWords(text){
  if (!text) return text;
  const f = faithNow();
  const higher = faithHigher();
  return String(text)
    .replace(/\{higher\}/g, higher || 'what you are reaching for')
    .replace(/\{figure\}/g, f.figure || 'the person you are becoming')
    .replace(/\{practice\}/g, f.practice || 'practice')
    .replace(/\{text\}/g, f.text || 'your journal');
}

/* Whether the saved answer has been read from the profile yet. A person who
   has answered and a person who has not both look like `myFaith.id === null`
   until it has, which is exactly the confusion that would send somebody's
   subliminals back in the neutral vocabulary without anybody noticing. */
let faithLoaded = false;

async function loadFaith(){
  if (!sb || !currentUser) return;
  const d = (await myProfile()) || {};
  myFaith = { id: d.faith || null, own: d.faith_other || '' };
  mySpiritStance = spiritStanceFrom(d);
  faithLoaded = true;
}

/* For callers that need the answer rather than a fresh copy of it -- the
   builder, before it asks for lines. Reads the profile once and then stops. */
async function ensureFaith(){
  if (faithLoaded || !sb || !currentUser) return;
  await loadFaith();
}

/* ---------- prayer, or meditation ----------
   The habit tracker offers one of two starting habits, and which one is a
   question about what this person said, not about what they look like, what
   they called their higher self, or which avatar they chose. Only the saved
   answer decides it, and the suggestion stays a suggestion: it can be
   unchecked, renamed, or swapped for their own habit, and changing the answer
   in Settings changes what is offered next time.

   Three of the traditions are unambiguous. The fourth answer, 'other', is
   written by two different questions -- "religion is important to me, and it
   is one you do not list" and "something else entirely" -- and only the first
   of those is a religion. So the stance is read as well, and 'other' alone is
   not treated as religious. Everything else -- spiritual, agnostic,
   psychology, manifestation, unanswered, unrecognised -- gets meditation. */
const RELIGIOUS_FAITHS = ['christianity', 'islam', 'hinduism'];
/* 'religion' | 'spiritual' | 'agnostic' | 'secular' | 'else' | null */
let mySpiritStance = null;

/* Onboarding saved the stance as its own id from 20261001 onwards. Rows
   written before that have only the label it showed on screen, so the label is
   matched back to the list as a fallback rather than left unanswered. */
function spiritStanceFrom(prof){
  const goals = (prof && prof.onboarding_goals) || {};
  if (goals.spirituality_id) return goals.spirituality_id;
  const label = goals.spirituality;
  if (!label || typeof OB_SPIRIT === 'undefined') return null;
  const match = OB_SPIRIT.find(x => x.label === label);
  return match ? match.id : null;
}

function faithPrefersPrayer(){
  if (RELIGIOUS_FAITHS.includes(myFaith.id)) return true;
  return myFaith.id === 'other' && mySpiritStance === 'religion';
}
/* The label, for the one habit card that changes with it. */
function faithPracticeHabit(){ return faithPrefersPrayer() ? 'Prayer' : 'Meditation'; }

/* ---------- asking ---------- */
function renderFaithChips(){
  const wrap = document.getElementById('obFaithChips');
  if (!wrap) return;
  wrap.innerHTML = FAITHS.map(f =>
    `<button type="button" class="length-chip${f.id === myFaith.id ? ' sel' : ''}"
       data-faith="${f.id}" onclick="pickFaith(this)">${f.label}</button>`).join('');
  const other = document.getElementById('obFaithOther');
  if (other) other.style.display = myFaith.id === 'other' ? 'block' : 'none';
}
function pickFaith(btn){
  const id = btn.dataset.faith;
  myFaith = { id, own: id === 'other' ? myFaith.own : '' };
  renderFaithChips();
}
function faithAnswerForSave(){
  const other = document.getElementById('obFaithOther');
  if (myFaith.id === 'other' && other) myFaith.own = other.value.trim().slice(0, 40);
  return { faith: myFaith.id || null, faith_other: myFaith.id === 'other' ? (myFaith.own || null) : null };
}


/* ---------- Settings: change spiritual language any time ---------- */
/* "What will change?" -- folded away on arrival. The four things a choice here
   touches are worth saying plainly, and they are four paragraphs: opened by
   default they would turn a settings card into a page of reading before the
   chips are even reached. */
function toggleFaithDetails(){
  const panel = document.getElementById('faithDetails');
  const btn = document.getElementById('faithDetailsToggle');
  if (!panel || !btn) return;
  const open = panel.hasAttribute('hidden');
  if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  const arrow = btn.querySelector('.faith-disclose-arrow');
  if (arrow) arrow.textContent = open ? '\u2191' : '\u2193';
}
function renderFaithSettings(){
  const wrap = document.getElementById('settingsFaithChips');
  if (!wrap) return;
  wrap.innerHTML = FAITHS.map(f =>
    `<button type="button" class="length-chip${f.id === myFaith.id ? ' sel' : ''}"
      data-faith="${f.id}" onclick="pickSettingsFaith(this)">${f.label}</button>`).join('');
  const other = document.getElementById('settingsFaithOther');
  if (other){
    other.style.display = myFaith.id === 'other' ? 'block' : 'none';
    other.value = myFaith.id === 'other' ? (myFaith.own || '') : '';
  }
}
function pickSettingsFaith(btn){
  const id = btn.dataset.faith;
  myFaith = { id, own: id === 'other' ? myFaith.own : '' };
  renderFaithSettings();
  /* Saved on the tap that made the choice, rather than on a second tap on a
     button underneath it. A chip that lights up and a row in the database were
     two different events, and the one in between was easy to walk away from --
     which is how somebody chooses Christianity, comes back a day later, and
     finds nothing selected at all.

     'Something else' is the one answer that still needs the button, because
     the word that goes with it is typed after the chip is tapped. */
  const msg = document.getElementById('faithSettingsMsg');
  if (id === 'other'){
    if (msg){ msg.textContent = 'Type what you call it, then tap Save preference.'; msg.className = 'save-msg'; }
    const other = document.getElementById('settingsFaithOther');
    if (other) other.focus();
    return;
  }
  saveFaithSettings();
}
async function saveFaithSettings(){
  const msg = document.getElementById('faithSettingsMsg');
  if (!sb || !currentUser) return;
  const other = document.getElementById('settingsFaithOther');
  if (myFaith.id === 'other' && other) myFaith.own = other.value.trim().slice(0,40);
  if (msg){ msg.textContent='Saving…'; msg.className='save-msg'; }
  const error = await saveProfile({
    faith: myFaith.id || null,
    faith_other: myFaith.id === 'other' ? (myFaith.own || null) : null,
  });
  if (error){ if(msg){ msg.textContent=describeSaveError(error); msg.className='save-msg err'; } return; }
  /* The habit tracker offers Prayer or Meditation off this answer, so say what
     changed rather than leaving it to be discovered. */
  const practice = (typeof faithPracticeHabit === 'function') ? faithPracticeHabit() : null;
  if(msg){
    msg.textContent = 'Saved.'
      + (practice ? ` Your habit tracker will suggest ${practice}, and new subliminals and guidance will use these words.` : ' New subliminals and guidance will use these words.');
    msg.className='save-msg ok';
  }
}
