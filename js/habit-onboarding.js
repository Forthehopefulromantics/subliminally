/* habit-onboarding.js — the Habit Tracker's own setup

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html.

   Six slides, shown once, the first time somebody with Ritual opens the Habit
   tracker. It is not part of the account questionnaire and does not belong
   there: setting up a routine is a thing you do when you arrive at the tracker
   meaning to use it, not a thing you are asked in the middle of signing up.
   The two completions are stored separately and neither is read as the other.

   Your higher self carries it. Every slide is her speaking -- the greeting,
   the explanation, the encouragement -- and that is the only thing inside the
   bubble. The headline, the facts, the habit cards, the time buttons, the
   fields and the button at the bottom are the screen talking, and they sit
   outside it. She is whoever this person actually chose; nothing here has an
   avatar of its own. */

const HO_SLIDES = ['percent', 'start-small', 'foundation', 'rhythm', 'yours', 'next21'];

/* Which drawing of her each slide gets. The feeling changes at slide
   boundaries and nowhere else -- never mid-slide, never on a timer, never
   cycling -- so it reads as her responding to where you are rather than as an
   animation running behind the words. */
const HO_EMOTION = {
  percent:      'welcoming',
  'start-small':'reassuring',
  foundation:   'welcoming',
  rhythm:       'welcoming',
  yours:        'reassuring',
  next21:       'celebrating',
};

/* What she says, and only what she says. */
const HO_SPEECH = {
  percent:      "You don't have to change your whole life overnight. Let's just get 1% better every day.",
  'start-small':"Start with just 1–3 habits. We'll practice them for 21 days, then you'll unlock more room to grow.",
  foundation:   "Let's build your foundation. Here are three habits you could start with. Choose what feels right for you.",
  rhythm:       "Now let's decide where these habits fit naturally into your day.",
  yours:        "A routine should work with your life, not fight against it.",
  next21:       "This is where we start. You don't need to be perfect. Just keep showing up.",
};

const HO_CTA = {
  percent:      'Build My Routine',
  'start-small':'Choose My Habits',
  foundation:   'Continue',
  rhythm:       'Continue',
  yours:        'Continue',
  next21:       'Start Day 1',
};

/* The three offered to everyone, plus their own. The middle one is the only
   thing on this screen that changes with what somebody said about spirituality
   during onboarding, and it changes to exactly one other word. See
   faithPrefersPrayer() in faith.js: it reads the saved answer and nothing
   else -- not the avatar, not the name, not anything about who this person
   appears to be. */
function hoStarterCards(){
  const practice = (typeof faithPracticeHabit === 'function') ? faithPracticeHabit() : 'Meditation';
  return [
    { key:'journal',    name:'Journaling', icon:'📓', note:'A page a day, by hand.' },
    { key:'practice',   name:practice,     icon:practice === 'Prayer' ? '🙏' : '🧘',
      note: practice === 'Prayer' ? 'A few quiet minutes with it.' : 'A few quiet minutes with yourself.' },
    { key:'subliminal', name:'Subliminals', icon:'🎧', note:'One session, whenever it fits.' },
  ];
}

const HO_MAX_HABITS = 3;

let hoIndex = 0;
let hoGoingBack = false;
let hoSaving = false;
/* [{ key, name, icon, time, core }] -- the whole draft, in memory. Slides are
   drawn from this rather than read out of the DOM, which is what makes going
   back free: nothing typed or tapped lives only on a screen that has been
   redrawn. Nothing is written to the database until the last slide. */
let hoPicks = [];
/* Ids of habit rows this attempt already created. A save that fails after the
   habits landed but before the profile did must not insert them a second time
   when they tap Try again. */
let hoInsertedIds = [];
let hoOwnCounter = 0;

function hoEl(id){ return document.getElementById(id); }
function hoSlideName(){ return HO_SLIDES[hoIndex]; }
function hoIsOpen(){
  const el = hoEl('habitOnboardOverlay');
  return !!(el && el.classList.contains('open'));
}

/* ---------- whether to show it at all ----------
   Three things have to be true, and the profile row answers all three. A read
   that failed is not an answer: it comes back null with lastProfileFetchFailed
   set, and in that case nobody is shown anything, because opening a setup flow
   over somebody's existing routine because the network dropped is worse than
   not opening it at all. Subscription is decided where it always was. */
async function habitOnboardingNeeded(){
  if (!sb || !currentUser) return false;
  const prof = await myProfile();
  if (!prof) return false;                       // unreadable or brand new: leave it
  return prof.habit_onboarding_completed !== true;
}

async function maybeOpenHabitOnboarding(){
  if (hoIsOpen()) return;
  if (!(await habitOnboardingNeeded())) return;
  openHabitOnboarding();
}

async function openHabitOnboarding(){
  const overlay = hoEl('habitOnboardOverlay');
  if (!overlay || overlay.classList.contains('open')) return;
  hoIndex = 0; hoGoingBack = false; hoSaving = false;
  hoPicks = []; hoInsertedIds = []; hoOwnCounter = 0;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  hoPaintSky();
  hoShowSlide();
  /* Her face and her name both come off the profile row, and the row may not
     be in hand yet. The slide is drawn immediately with the skeleton where she
     stands, and redrawn the moment it lands -- so nothing generic is ever on
     screen, and the words are readable throughout either way. */
  if (!higherSelfLoaded){
    await loadHigherSelf();
    if (typeof loadFaith === 'function') await loadFaith();
    if (hoIsOpen()) hoShowSlide();
  } else if (typeof loadFaith === 'function'){
    await loadFaith();
    if (hoIsOpen()) hoShowSlide();
  }
}

function closeHabitOnboarding(){
  const overlay = hoEl('habitOnboardOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* Leaves it unfinished on purpose, the same way the account questionnaire's
   "I'll personalize later" does: nothing is written, the flag stays false, and
   it is waiting the next time they open the tracker rather than quietly never
   appearing again. The tracker itself is behind it either way, so nobody is
   held here to use something they are already paying for. */
function skipHabitOnboarding(){ closeHabitOnboarding(); }

/* Same fixed scatter as the account questionnaire, for the same reason:
   nothing twitches when a slide changes. */
function hoPaintSky(){
  const sky = hoEl('hoSky');
  if (!sky || sky.dataset.painted) return;
  const spots = [[9,12],[19,30],[28,8],[37,23],[45,5],[53,18],[62,10],[70,28],[78,15],[87,25],[93,7],[14,45],[32,51],[59,43],[73,54],[90,47]];
  sky.insertAdjacentHTML('beforeend', spots.map(([l,t],i) =>
    `<div class="ob-star" style="left:${l}%;top:${t}%;animation-delay:${(i % 5) * 0.7}s"></div>`).join(''));
  sky.dataset.painted = '1';
}

/* ---------- the slides ---------- */
function hoShowSlide(){
  const name = hoSlideName();
  const stage = hoEl('hoStage');
  if (!stage) return;

  /* Built detached, then swapped in -- and if the portrait is the same file as
     the one already on screen, the element itself is carried across rather than
     written again. Choosing a habit redraws this slide, and an <img> replaced
     with an identical <img> can blink even when the file is in cache. */
  const previous = stage.querySelector('.hsd-portrait');
  const slide = document.createElement('section');
  slide.className = 'ob-slide on' + (hoGoingBack ? ' back' : '');
  slide.innerHTML = hoSlideBody(name);
  const fresh = slide.querySelector('.hsd-portrait');
  if (previous && fresh && previous.src === fresh.src) fresh.replaceWith(previous);
  stage.replaceChildren(slide);
  hoGoingBack = false;
  stage.scrollTop = 0;

  const step = hoIndex + 1;
  hoEl('hoProgressFill').style.width = (step / HO_SLIDES.length * 100) + '%';
  hoEl('hoStep').textContent = step + '/' + HO_SLIDES.length;
  hoEl('hoBack').disabled = hoIndex === 0 || hoSaving;
  hoEl('hoSkip').style.display = hoSaving ? 'none' : 'block';
  const cta = hoEl('hoCta');
  cta.textContent = HO_CTA[name] || 'Continue';
  cta.classList.toggle('busy', hoSaving);
  hoEl('habitOnboardMsg').textContent = '';
  hoEl('habitOnboardMsg').className = 'auth-msg';
  hoRefreshGate();

  // The next slide's feeling, fetched while this one is being read. One
  // picture, not the roster: only ever the one about to be needed.
  const next = HO_SLIDES[hoIndex + 1];
  if (next && higherSelfLoaded) preloadHigherSelfEmotion(higherSelf.avatar, HO_EMOTION[next]);
}

/* The dialogue, then whatever this slide is asking. Every slide is built the
   same way round so the bubble is never something the layout has to make room
   for after the fact. */
/* The three slides that are mostly things to tap draw her smaller, so the
   choices are on screen with her rather than below the fold. */
const HO_COMPACT = ['foundation', 'rhythm', 'yours'];
function hoDialogue(name){
  return higherSelfDialogue({
    avatar: higherSelfChoice(),
    emotion: HO_EMOTION[name],
    message: HO_SPEECH[name],
    speaker: (higherSelf.name || '').trim(),
    size: HO_COMPACT.includes(name) ? 'sm' : 'md',
  });
}

function hoSlideBody(name){
  if (name === 'percent') return `
    <h2 class="ho-headline">1% better every day</h2>
    ${hoDialogue(name)}`;

  if (name === 'start-small') return `
    ${hoDialogue(name)}
    <ul class="ho-facts">
      <li><span class="ho-fact-key">1–3</span><span>habits to start</span></li>
      <li><span class="ho-fact-key">21</span><span>day practice cycle</span></li>
      <li><span class="ho-fact-key">+3</span><span>habit spaces after completion</span></li>
    </ul>
    <p class="ob-note">A practice cycle, not a deadline. Twenty-one days of practice is a start, not the day a habit becomes automatic.</p>`;

  if (name === 'foundation'){
    const cards = hoStarterCards().map(c => {
      const on = hoPicks.some(p => p.key === c.key);
      return `<button type="button" class="ho-card${on ? ' sel' : ''}" onclick="hoToggleStarter('${c.key}')"
        aria-pressed="${on}"><span class="ho-card-icon" aria-hidden="true">${c.icon}</span>
        <span class="ho-card-text"><span class="ho-card-name">${obEscape(c.name)}</span><span class="ho-card-note">${obEscape(c.note)}</span></span></button>`;
    }).join('');
    const own = hoPicks.filter(p => p.key.startsWith('own:')).map(p => `
      <div class="ho-own-row">
        <input type="text" class="ob-input" value="${obEscape(p.name)}" maxlength="80" placeholder="Name your habit"
          aria-label="Your own habit" oninput="hoRenameOwn('${p.key}', this.value)">
        <button type="button" class="ho-own-remove" onclick="hoRemovePick('${p.key}')" aria-label="Remove this habit">&times;</button>
      </div>`).join('');
    return `
      <h2 class="ho-headline">Your foundation</h2>
      ${hoDialogue(name)}
      <div class="ho-cards">${cards}</div>
      ${own}
      ${hoPicks.length < HO_MAX_HABITS ? `<button type="button" class="ho-add-own" onclick="hoAddOwn()">＋ Create my own habit</button>` : ''}
      <div class="ho-count" id="hoCount">${hoCountText()}</div>`;
  }

  if (name === 'rhythm') return `
    <h2 class="ho-headline">Build your rhythm</h2>
    ${hoDialogue(name)}
    <div class="ho-rhythm">${hoPicks.map(p => `
      <div class="ho-rhythm-row">
        <div class="ho-rhythm-name"><span aria-hidden="true">${p.icon}</span> ${obEscape(p.name)}</div>
        <div class="ho-times" role="group" aria-label="When ${obEscape(p.name)} fits">
          ${HABIT_TIMES.map(t => `<button type="button" class="ho-time${p.time === t ? ' sel' : ''}"
            onclick="hoSetTime('${p.key}','${t}')" aria-pressed="${p.time === t}">${HABIT_TIME_LABEL[t]}</button>`).join('')}
        </div>
      </div>`).join('')}</div>
    <p class="ob-note">One place each — choosing a time moves a habit, it never copies it or uses another space.</p>`;

  if (name === 'yours') return `
    <h2 class="ho-headline">Make it yours</h2>
    ${hoDialogue(name)}
    <div class="ho-tune">${hoPicks.map(p => `
      <div class="ho-tune-row">
        <div class="ho-tune-top">
          <button type="button" class="ho-tune-icon" onclick="hoCycleIcon('${p.key}')"
            aria-label="Change the picture for ${obEscape(p.name)}. Currently ${p.icon}">${p.icon}</button>
          <input type="text" class="ob-input" value="${obEscape(p.name)}" maxlength="80"
            aria-label="Name of this habit" oninput="hoRenamePick('${p.key}', this.value)">
        </div>
        <label class="ho-mins">
          <span>How long, roughly?</span>
          <span class="ho-mins-field">
            <input type="text" inputmode="numeric" maxlength="3" value="${p.minutes || ''}" placeholder="–"
              aria-label="Minutes ${obEscape(p.name)} usually takes"
              oninput="hoSetMinutes('${p.key}', this.value)">minutes
          </span>
        </label>
        ${habitTimeHasCore(p.time) ? `<label class="ho-core">
          <input type="checkbox" ${p.core ? 'checked' : ''} onchange="hoSetCore('${p.key}', this.checked)">
          <span>Non-negotiable — the one you'd still do on your worst day</span>
        </label>` : `<p class="ho-core-na">Anytime habits sit outside the morning and night routines, so there is no non-negotiable to set here.</p>`}
      </div>`).join('')}</div>
    <p class="ob-note">Leave the minutes blank if it varies — plenty of habits do not have a length. Doing just your non-negotiables still counts as keeping the routine, and all of this can be changed later.</p>`;

  if (name === 'next21'){
    const byTime = HABIT_TIMES.map(t => {
      const rows = hoPicks.filter(p => p.time === t);
      if (!rows.length) return '';
      return `<div class="ho-plan-group"><div class="ho-plan-head">${HABIT_TIME_LABEL[t]}</div>
        <ul class="ho-plan-list">${rows.map(p =>
          `<li><span aria-hidden="true">${p.icon}</span> ${obEscape(p.name)}`
          + (p.minutes ? ` <span class="ho-plan-mins">${p.minutes} min</span>` : '')
          + (p.core && habitTimeHasCore(p.time) ? ' <span class="ho-plan-core">✦</span>' : '') + `</li>`).join('')}</ul></div>`;
    }).join('');
    return `
      <h2 class="ho-headline">Your next 21 days</h2>
      <div class="ho-day">Day 1 of 21</div>
      ${hoDialogue(name)}
      <div class="ho-plan">${byTime}</div>`;
  }
  return '';
}

function hoCountText(){
  const n = hoPicks.length;
  if (!n) return 'Choose at least one.';
  if (n >= HO_MAX_HABITS) return "That's three — the most to start with.";
  return `${n} chosen · up to ${HO_MAX_HABITS - n} more.`;
}

/* ---------- choosing ---------- */
function hoAddPick(pick){
  if (hoPicks.length >= HO_MAX_HABITS) return false;
  hoPicks.push(pick);
  return true;
}
function hoToggleStarter(key){
  const at = hoPicks.findIndex(p => p.key === key);
  if (at > -1){ hoPicks.splice(at, 1); hoShowSlide(); return; }
  const card = hoStarterCards().find(c => c.key === key);
  if (!card) return;
  hoAddPick({ key, name:card.name, icon:card.icon, time:'anytime', core:false, minutes:null });
  hoShowSlide();
}
function hoAddOwn(){
  if (!hoAddPick({ key:`own:${++hoOwnCounter}`, name:'', icon:'○', time:'anytime', core:false, minutes:null })) return;
  hoShowSlide();
  // Straight into the field they just asked for.
  const fields = hoEl('hoStage').querySelectorAll('.ho-own-row .ob-input');
  const last = fields[fields.length - 1];
  if (last) last.focus();
}
function hoRemovePick(key){
  hoPicks = hoPicks.filter(p => p.key !== key);
  hoShowSlide();
}
/* Typed into, not redrawn from: re-rendering the slide on every keystroke
   would take the cursor with it. Only the gate and the counter move. */
function hoRenameOwn(key, value){
  const p = hoPicks.find(x => x.key === key);
  if (!p) return;
  p.name = value.slice(0, 80);
  hoRefreshGate();
}
function hoRenamePick(key, value){
  const p = hoPicks.find(x => x.key === key);
  if (!p) return;
  p.name = value.slice(0, 80);
  if (!p.icon || p.icon === '○') p.icon = habitIcon({ name:p.name });
  hoRefreshGate();
}
function hoSetTime(key, time){
  const p = hoPicks.find(x => x.key === key);
  if (!p || !HABIT_TIMES.includes(time)) return;
  p.time = time;
  hoShowSlide();
}
function hoSetCore(key, on){
  const p = hoPicks.find(x => x.key === key);
  if (p) p.core = !!on;
}
/* Typed into rather than redrawn from, like the name field beside it: this
   slide is not re-rendered on a keystroke, so the cursor stays put. */
function hoSetMinutes(key, value){
  const p = hoPicks.find(x => x.key === key);
  if (p) p.minutes = habitMinutes(value);
}
/* A picker would be a third thing on a slide that already has two. The same
   shelf of pictures the tracker uses, stepped through one tap at a time. */
function hoCycleIcon(key){
  const p = hoPicks.find(x => x.key === key);
  if (!p) return;
  const at = HABIT_ICON_CHOICES.indexOf(p.icon);
  p.icon = HABIT_ICON_CHOICES[(at + 1) % HABIT_ICON_CHOICES.length];
  hoShowSlide();
}

/* ---------- moving between them ---------- */
function hoNamedPicks(){ return hoPicks.filter(p => (p.name || '').trim()); }
function hoBlocked(){
  const name = hoSlideName();
  if (name === 'foundation' || name === 'rhythm' || name === 'yours' || name === 'next21'){
    const n = hoNamedPicks().length;
    return n < 1 || n > HO_MAX_HABITS;
  }
  return false;
}
function hoRefreshGate(){
  const cta = hoEl('hoCta');
  if (cta) cta.disabled = hoSaving || hoBlocked();
  const count = hoEl('hoCount');
  if (count) count.textContent = hoCountText();
}
function hoNext(){
  if (hoSaving || hoBlocked()) return;
  // An empty "create my own" row is a row they thought better of, not an error.
  if (hoSlideName() === 'foundation') hoPicks = hoNamedPicks();
  if (hoIndex >= HO_SLIDES.length - 1){ hoSubmit(); return; }
  hoIndex++;
  hoShowSlide();
}
function hoPrev(){
  if (hoSaving || hoIndex === 0) return;
  hoGoingBack = true;
  hoIndex--;
  hoShowSlide();
}

/* ---------- saving, once, at the end ----------
   Same rule as the account questionnaire: nothing moves until the database
   says yes, and a failure leaves every choice exactly where it was with
   something to read and a button to tap again.

   Two writes, in order, and the order matters. The habits go in first, in one
   statement. Then the profile row records that this happened and starts the
   cycle. If the second fails, the first is remembered in hoInsertedIds and is
   not repeated -- tapping again finishes the profile write against the rows
   that already exist, rather than creating a second copy of the routine. */
async function hoSubmit(){
  const msg = hoEl('habitOnboardMsg');
  const cta = hoEl('hoCta');
  if (hoSaving) return;
  if (!sb || !currentUser){ closeHabitOnboarding(); return; }

  const picks = hoNamedPicks();
  if (!picks.length || picks.length > HO_MAX_HABITS) return;

  hoSaving = true;
  cta.classList.add('busy'); cta.disabled = true;
  hoEl('hoBack').disabled = true;
  msg.textContent = 'Saving your routine…'; msg.className = 'auth-msg';

  const fail = (text) => {
    hoSaving = false;
    cta.classList.remove('busy');
    hoEl('hoBack').disabled = false;
    hoRefreshGate();
    msg.textContent = text; msg.className = 'auth-msg err';
  };

  if (!hoInsertedIds.length){
    // sort_order per list, so the routine opens in the order it was set up in.
    const perTime = {};
    const rows = picks.map(p => {
      const n = (perTime[p.time] = (perTime[p.time] || 0));
      perTime[p.time] = n + 1;
      return {
        user_id: currentUser.id,
        name: p.name.trim().slice(0, 80),
        time_of_day: p.time,
        icon: p.icon === '○' ? null : p.icon,
        is_core: habitTimeHasCore(p.time) && !!p.core,
        duration_minutes: p.minutes || null,
        sort_order: n,
      };
    });
    const { data, error } = await sb.from('habits').insert(rows).select();
    if (error){
      console.error('habit onboarding insert:', error);
      return fail(describeSaveError(error));
    }
    hoInsertedIds = (data || []).map(r => r.id);
  }

  const today = localDateStr();
  const error = await saveProfile({
    habit_onboarding_completed: true,
    habit_onboarding_completed_at: new Date().toISOString(),
    habit_cycle_started_on: today,
  });
  if (error){
    console.error('habit onboarding profile save:', error);
    return fail(describeSaveError(error));
  }

  // Read it back before moving, the same as the account questionnaire: a write
  // that reported no error but did not land is what sends somebody through a
  // setup flow they already finished.
  const saved = await myProfile({ force: true });
  if (!saved || saved.habit_onboarding_completed !== true)
    return fail("Saved, but we couldn't confirm it — tap again.");

  habitCycleStart = saved.habit_cycle_started_on || today;
  hoSaving = false;
  closeHabitOnboarding();
  forgetFetch('habits');
  await loadHabits({ force: true });
}
