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
    higher: 'God', figure: 'Jesus', practice: 'prayer', text: 'the Bible',
    /* Said where the app would otherwise say something vague about the
       universe. Kept short, and never a promise about outcomes. */
    line: 'God wants this life for you.',
    habits: { morning:['Morning prayer','Read a chapter','Sit with a verse'], night:['Evening prayer','Gratitude to God','Examine the day'] },
  },
  {
    id: 'islam', label: 'Islam',
    higher: 'Allah', figure: 'the Prophet Muhammad ﷺ', practice: 'salah', text: 'the Qur’an',
    line: 'Allah has not brought you this far to leave you.',
    habits: { morning:['Fajr on time','Read Qur’an','Morning adhkar'], night:['Isha on time','Evening adhkar','Make du‘a'] },
  },
  {
    id: 'hinduism', label: 'Hinduism',
    higher: 'Brahman', figure: 'the divine in you', practice: 'puja', text: 'the Gita',
    line: 'What you are reaching for is already within you.',
    habits: { morning:['Morning puja','Japa','Read a verse'], night:['Evening aarti','Reflect on the day','Seva'] },
  },
  {
    id: 'universe', label: 'Universe / Manifestation',
    higher: 'the Universe', figure: 'your future self', practice: 'manifesting', text: 'your journal',
    line: 'What you are calling in is already on its way.',
    habits: { morning:['Morning intention','Read your affirmations','Visualise the day'], night:['Scripting','Gratitude list','Thank the day'] },
  },
  {
    id: 'psychology', label: 'Neutral / Psychology-based',
    /* Deliberately the neutral vocabulary: chosen by people who want the
       practice without the language around it. Everything else reads a blank
       answer the same way, so this simply makes that choice sayable. */
    higher: 'your potential', figure: 'the person you are becoming', practice: 'practice', text: 'your journal',
    line: 'Repetition is how a new thought becomes a familiar one.',
    habits: { morning:['Morning intention','Read your affirmations','Plan one priority'], night:['Reflect on the day','Note one win','Wind down'] },
  },
  {
    id: 'spirituality', label: 'Spiritual, not religious',
    higher: 'the Universe', figure: 'your higher self', practice: 'manifesting', text: 'your journal',
    line: 'The Universe is already moving toward you.',
    habits: { morning:['Morning meditation','Scripting','Set an intention'], night:['Gratitude list','Visualise it','Moon check-in'] },
  },
  {
    id: 'agnostic', label: 'Not sure',
    higher: null, figure: 'the person you are becoming', practice: 'practice', text: 'your journal',
    line: 'You are the one doing this. That is enough.',
    habits: { morning:['Sit quietly','Morning pages','Set an intention'], night:['Gratitude list','Wind down','Breathe'] },
  },
  {
    id: 'other', label: 'Something else', freeText: true,
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

async function loadFaith(){
  if (!sb || !currentUser) return;
  const d = (await myProfile()) || {};
  myFaith = { id: d.faith || null, own: d.faith_other || '' };
  mySpiritStance = spiritStanceFrom(d);
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
  if(msg){ msg.textContent='Saved. New subliminals and guidance will use these words.'; msg.className='save-msg ok'; }
}
