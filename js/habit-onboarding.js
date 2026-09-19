/* habit-onboarding.js — the Habit Tracker's own first run, and the 21-day cycle

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html.

   This is NOT main onboarding. Main onboarding is account.js, it asks who you
   are, and it writes `onboarding_completed`. This one asks nothing about you:
   it is shown the first time somebody opens the Habit Tracker, it builds their
   first routine, and it writes `habit_onboarding_completed`. The two columns
   never read each other -- somebody can be all the way through the first and
   have never seen the second.

   What it reads from main onboarding, it only reads: the avatar they chose, so
   she is the one standing here, and their answer about spirituality, so the
   second recommendation is Prayer or Meditation rather than a question they
   have already answered. Nothing here writes to either. */

const HABIT_CYCLE_DAYS = 21;
const HABIT_SLOT_STEP = 3;     // spaces unlocked by finishing a cycle
const HABIT_SLOT_MAX = 15;     // and the most anyone can ever hold
const HABIT_FIRST_CYCLE_MAX = 3;

/* What the tracker knows about the cycle right now. Loaded with the habits,
   so anything drawing the list can ask without a round trip. The default is
   deliberately the maximum: until the profile row is read, nothing should be
   refused for a limit we have not actually looked up. */
let habitCycle = { number: 0, startedOn: null, slots: HABIT_SLOT_MAX, onboarded: true };

function habitCycleFromProfile(prof){
  return {
    number: (prof && prof.habit_cycle_number) || 0,
    startedOn: (prof && prof.habit_cycle_started_on) || null,
    slots: (prof && prof.habit_slots) || HABIT_SLOT_STEP,
    onboarded: !!(prof && prof.habit_onboarding_completed === true),
  };
}

/* Which day of the cycle today is, counting from 1. Calendar days, not days
   kept: missing a day costs a streak and nothing else. */
function habitCycleDay(cycle){
  const c = cycle || habitCycle;
  if (!c.startedOn) return 0;
  const [y, m, d] = c.startedOn.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const today = new Date();
  const days = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - start) / 864e5);
  return days + 1;
}

/* Avatar customization is the reward for finishing the first 21 days, so it is
   true once the person is in cycle 2 or later. Derived from the cycle rather
   than kept as a second flag, because two records of one fact drift apart --
   and it is read from the database, never from this browser. */
function avatarCustomizationUnlocked(){
  return habitCycle.number >= 2;
}

/* A cycle ends because 21 days have passed, not because anybody came back to
   look. Somebody away for two months returns to the right cycle and the right
   allowance, worked out in one pass and written once. */
async function advanceHabitCycleIfDue(){
  if (!sb || !currentUser) return;
  const prof = await myProfile();
  if (!prof || prof.habit_onboarding_completed !== true || !prof.habit_cycle_started_on) return;

  let startedOn = prof.habit_cycle_started_on;
  let number = prof.habit_cycle_number || 1;
  let slots = prof.habit_slots || HABIT_SLOT_STEP;
  let moved = false;
  // Guarded rather than `while (true)`: a clock set wrongly into the future
  // must not spin here.
  for (let guard = 0; guard < 400; guard++){
    if (habitCycleDay({ startedOn }) <= HABIT_CYCLE_DAYS) break;
    startedOn = shiftDateStr(startedOn, HABIT_CYCLE_DAYS);
    number += 1;
    slots = Math.min(HABIT_SLOT_MAX, slots + HABIT_SLOT_STEP);
    moved = true;
  }
  if (!moved) return;
  const error = await saveProfile({
    habit_cycle_number: number,
    habit_cycle_started_on: startedOn,
    habit_slots: slots,
  });
  if (error){ console.warn('habit cycle:', error.message); return; }
  habitCycle = { number, startedOn, slots, onboarded: true };
}

/* ---------- Prayer or Meditation ----------
   Read, never asked again. The stance answered in main onboarding is the first
   word: "Religion is important to me" is the one answer that means prayer
   whichever tradition was named under it. Failing that -- an older account that
   answered only the tradition question in Settings -- the tradition itself
   says it. Everything else, and anyone who never answered, gets Meditation. */
const HABIT_PRAYER_FAITHS = ['christianity', 'islam', 'hinduism'];

function habitFaithPractice(prof){
  const goals = prof && prof.onboarding_goals;
  const stance = (goals && !Array.isArray(goals) && goals.spirituality) ? String(goals.spirituality).toLowerCase() : '';
  if (stance.includes('religion is important')) return 'prayer';
  if (stance) return 'meditation';                       // they answered, and it was not that
  if (prof && HABIT_PRAYER_FAITHS.includes(prof.faith)) return 'prayer';
  return 'meditation';
}

/* The three we suggest, in the order they are shown. Suggested is all they
   are: none of them starts out selected. */
function habitRecommendations(prof){
  const prayer = habitFaithPractice(prof) === 'prayer';
  return [
    { key:'journal', name:'Journaling', icon:'✎',
      blurb:'Clear your mind. Meet yourself on paper.' },
    prayer
      ? { key:'prayer', name:'Prayer', icon:'☽',
          blurb:'Create intentional time to connect with your faith.' }
      : { key:'meditation', name:'Meditation', icon:'❋',
          blurb:'Create a few quiet minutes to reconnect with yourself.' },
    { key:'subliminals', name:'Subliminals', icon:'♪',
      blurb:"Give your mind intentional repetition aligned with who you're becoming." },
  ];
}

/* ---------- the slideshow ---------- */
const HT_SLIDES = ['why', 'cycle', 'habits', 'rhythm', 'tune', 'preview'];
const HT_CTA = {
  why: 'Build My Routine',
  cycle: 'Choose My Habits',
  preview: 'Start Day 1',
};
const HT_TIMES = [
  { id:'morning', icon:'☀️', label:'Morning' },
  { id:'night',   icon:'🌙', label:'Night' },
  { id:'anytime', icon:'✨', label:'Anytime' },
];
const HT_DURATIONS = [5, 10, 15, 20, 30];
const HT_DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const HT_ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/* Everything the person has chosen lives here and nowhere else, which is what
   makes the back button free: a slide is drawn from this, never from what is
   already on screen, so going back and forward again cannot lose a thing. */
let htOb = { index: 0, back: false, saving: false, picks: [], profile: null };

function htEl(id){ return document.getElementById(id); }
function htSlideName(){ return HT_SLIDES[htOb.index]; }
function htIsOpen(){
  const el = htEl('habitObOverlay');
  return !!(el && el.classList.contains('open'));
}
function htPick(key){ return htOb.picks.find(p => p.key === key); }

/* The Habit Tracker asks the database, once, whether this account has been
   here before -- not this browser, and not whether they happen to have habits.
   Returns true when it took over the screen. */
async function maybeOpenHabitOnboarding(){
  if (!sb || !currentUser) return false;
  if (htIsOpen()) return true;
  const prof = await myProfile();
  // A refused read is not a new person. Guessing wrong here would walk
  // somebody through building a routine they already have.
  if (!prof && lastProfileFetchFailed) return false;
  if (prof && prof.habit_onboarding_completed === true) return false;
  openHabitOnboarding(prof);
  return true;
}

function openHabitOnboarding(prof){
  const overlay = htEl('habitObOverlay');
  if (!overlay || overlay.classList.contains('open')) return;
  htOb = { index: 0, back: false, saving: false, picks: [], profile: prof || null };
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  htPaintSky();
  htRenderRecommendations();
  htShowSlide();
}

function closeHabitOnboarding(){
  const overlay = htEl('habitObOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* Stars, scattered once, the same way main onboarding does it. */
function htPaintSky(){
  const sky = htEl('htObSky');
  if (!sky || sky.dataset.painted) return;
  const spots = [[10,12],[21,30],[29,8],[38,26],[47,7],[55,18],[64,12],[71,28],[79,15],[88,25],[94,9],[15,44],[33,51],[60,42],[74,54],[90,47]];
  sky.insertAdjacentHTML('beforeend', spots.map(([l, t], i) =>
    `<div class="ob-star" style="left:${l}%;top:${t}%;animation-delay:${(i % 5) * 0.7}s"></div>`).join(''));
  sky.dataset.painted = '1';
}

/* Her, as chosen in main onboarding. Never a hardcoded avatar: `higherSelf` is
   filled from the profile row, and the row is what this overlay was opened
   with. */
function htAvatarInto(id, cut){
  const el = htEl(id);
  if (!el || typeof avatarMarkup !== 'function') return;
  const avatar = (htOb.profile && htOb.profile.higher_self_avatar)
    || (typeof higherSelf !== 'undefined' && higherSelf.avatar)
    || null;
  el.innerHTML = avatarMarkup({ avatar: typeof avatarId === 'function' ? avatarId(avatar) : avatar },
    { state:'hero', cut: cut || 'full', alt:false });
}

function htShowSlide(){
  const name = htSlideName();
  document.querySelectorAll('#htObStage .ob-slide').forEach(el => {
    const on = el.dataset.htOb === name;
    el.classList.toggle('back', htOb.back);
    el.classList.toggle('on', on);
  });
  htOb.back = false;
  htEl('htObStage').scrollTop = 0;

  const step = htOb.index + 1;
  htEl('htObProgressFill').style.width = (step / HT_SLIDES.length * 100) + '%';
  htEl('htObStep').textContent = step + '/' + HT_SLIDES.length;
  htEl('htObBack').disabled = htOb.index === 0;

  const cta = htEl('htObCta');
  cta.textContent = HT_CTA[name] || 'Continue';
  cta.classList.remove('busy');
  htEl('habitObMsg').textContent = '';
  htEl('habitObMsg').className = 'auth-msg';

  if (name === 'why') htAvatarInto('htObWhyHero');
  if (name === 'habits') htRenderRecommendations();
  if (name === 'rhythm') htRenderRhythm();
  if (name === 'tune') htRenderTune();
  if (name === 'preview'){ htRenderPreview(); htAvatarInto('htObPreviewHero'); }
  htRefreshGate();
}

function htBlocked(){
  if (htSlideName() === 'habits') return htOb.picks.length < 1;
  return false;
}
function htRefreshGate(){
  htEl('htObCta').disabled = htOb.saving || htBlocked();
}

function htNext(){
  if (htOb.saving || htBlocked()) return;
  if (htOb.index >= HT_SLIDES.length - 1){ submitHabitOnboarding(); return; }
  htOb.index++;
  htShowSlide();
}
function htPrev(){
  if (htOb.saving || htOb.index === 0) return;
  htOb.back = true;
  htOb.index--;
  htShowSlide();
}

/* ---------- slide 3: which habits ---------- */
function htRenderRecommendations(){
  const wrap = htEl('htObHabitCards');
  if (!wrap) return;
  const recs = habitRecommendations(htOb.profile);
  const own = htOb.picks.filter(p => p.own);
  const cards = recs.map(r => {
    const chosen = !!htPick(r.key);
    const full = !chosen && htOb.picks.length >= HABIT_FIRST_CYCLE_MAX;
    return `
    <button type="button" class="ht-card${chosen ? ' sel' : ''}${full ? ' full' : ''}"
      onclick="htToggleHabit('${r.key}')" aria-pressed="${chosen}">
      <span class="ht-card-icon" aria-hidden="true">${r.icon}</span>
      <span class="ht-card-body">
        <span class="ht-card-tag">Subliminally recommended</span>
        <span class="ht-card-name">${r.name}</span>
        <span class="ht-card-blurb">${r.blurb}</span>
      </span>
      <span class="ht-card-tick" aria-hidden="true">${chosen ? '✓' : ''}</span>
    </button>`;
  }).join('');

  const ownCards = own.map(p => `
    <div class="ht-card sel ht-card-own">
      <span class="ht-card-icon" aria-hidden="true">✧</span>
      <span class="ht-card-body">
        <span class="ht-card-tag">Yours</span>
        <span class="ht-card-name">${obEscape(p.name)}</span>
      </span>
      <button type="button" class="ht-card-remove" onclick="htRemoveHabit('${p.key}')"
        aria-label="Remove ${obEscape(p.name)}">×</button>
    </div>`).join('');

  const roomLeft = htOb.picks.length < HABIT_FIRST_CYCLE_MAX;
  const ownAdder = roomLeft
    ? `<div class="ht-own-row">
         <input type="text" class="ob-input" id="htObOwnName" maxlength="80" enterkeyhint="done"
           placeholder="+ Create my own habit" onkeydown="if(event.key==='Enter'){ event.preventDefault(); htAddOwnHabit(); }">
         <button type="button" class="ht-own-add" onclick="htAddOwnHabit()">Add</button>
       </div>`
    : '';

  wrap.innerHTML = cards + ownCards + ownAdder;
  htEl('htObCount').textContent = `${htOb.picks.length} of ${HABIT_FIRST_CYCLE_MAX} selected`;
  htRefreshGate();
}

function htSay(text){
  const msg = htEl('habitObMsg');
  msg.textContent = text;
  msg.className = text ? 'auth-msg err' : 'auth-msg';
}

function htToggleHabit(key){
  if (htOb.saving) return;
  const at = htOb.picks.findIndex(p => p.key === key);
  if (at > -1){ htOb.picks.splice(at, 1); htSay(''); htRenderRecommendations(); return; }
  if (htOb.picks.length >= HABIT_FIRST_CYCLE_MAX){
    htSay(`Three is the most for this first cycle — finish 21 days and three more spaces open up.`);
    htRenderRecommendations();
    return;
  }
  const rec = habitRecommendations(htOb.profile).find(r => r.key === key);
  if (!rec) return;
  htOb.picks.push({ key, name: rec.name, icon: rec.icon, own: false, time: 'anytime', minutes: null, days: HT_ALL_DAYS.slice(), reminder: '' });
  htSay('');
  htRenderRecommendations();
}

function htAddOwnHabit(){
  const input = htEl('htObOwnName');
  if (!input) return;
  const name = (input.value || '').trim().slice(0, 80);
  if (!name) return;
  if (htOb.picks.length >= HABIT_FIRST_CYCLE_MAX){
    htSay(`Three is the most for this first cycle — finish 21 days and three more spaces open up.`);
    return;
  }
  if (htOb.picks.some(p => p.name.toLowerCase() === name.toLowerCase())){
    htSay('That one is already on your list.');
    return;
  }
  htOb.picks.push({ key: 'own-' + Date.now(), name, icon: '✧', own: true, time: 'anytime', minutes: null, days: HT_ALL_DAYS.slice(), reminder: '' });
  input.value = '';
  htSay('');
  htRenderRecommendations();
}

function htRemoveHabit(key){
  const at = htOb.picks.findIndex(p => p.key === key);
  if (at > -1) htOb.picks.splice(at, 1);
  htSay('');
  htRenderRecommendations();
}

/* ---------- slide 4: morning, night or anytime ---------- */
function htTimeButtons(pick, compact){
  return `<div class="ht-times${compact ? ' compact' : ''}" role="group" aria-label="When ${obEscape(pick.name)} fits">`
    + HT_TIMES.map(t => `
      <button type="button" class="ht-time${pick.time === t.id ? ' sel' : ''}"
        onclick="htSetTime('${pick.key}','${t.id}')" aria-pressed="${pick.time === t.id}">
        <span aria-hidden="true">${t.icon}</span> ${t.label}
      </button>`).join('')
    + '</div>';
}

function htRenderRhythm(){
  const wrap = htEl('htObRhythm');
  if (!wrap) return;
  wrap.innerHTML = htOb.picks.map(p => `
    <div class="ht-rhythm-row">
      <div class="ht-rhythm-name">${obEscape(p.name)}</div>
      ${htTimeButtons(p)}
    </div>`).join('');
}

function htSetTime(key, time){
  const p = htPick(key);
  if (!p) return;
  p.time = time;
  if (htSlideName() === 'rhythm') htRenderRhythm();
  else htRenderTune();
}

/* ---------- slide 5: make it yours ---------- */
function htRenderTune(){
  const wrap = htEl('htObTune');
  if (!wrap) return;
  wrap.innerHTML = htOb.picks.map(p => `
    <div class="ht-tune-card">
      <input type="text" class="ob-input ht-tune-name" value="${obEscape(p.name)}" maxlength="80"
        aria-label="Habit name" onchange="htSetName('${p.key}', this.value)"
        onkeydown="if(event.key==='Enter') this.blur();">
      <div class="ht-tune-label">Schedule</div>
      ${htTimeButtons(p, true)}
      <div class="ht-tune-label">How long <span>optional</span></div>
      <div class="ht-mins">
        ${HT_DURATIONS.map(m => `<button type="button" class="ht-min${p.minutes === m ? ' sel' : ''}"
            onclick="htSetMinutes('${p.key}', ${m})" aria-pressed="${p.minutes === m}">${m}m</button>`).join('')}
        <button type="button" class="ht-min${p.minutes == null ? ' sel' : ''}"
          onclick="htSetMinutes('${p.key}', null)" aria-pressed="${p.minutes == null}">—</button>
      </div>
      <div class="ht-tune-label">Days</div>
      <div class="ht-days" role="group" aria-label="Days for ${obEscape(p.name)}">
        ${HT_DAY_LETTERS.map((letter, i) => `
          <button type="button" class="ht-day${p.days.includes(i) ? ' sel' : ''}"
            onclick="htToggleDay('${p.key}', ${i})" aria-pressed="${p.days.includes(i)}"
            aria-label="${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]}">${letter}</button>`).join('')}
      </div>
      <div class="ht-tune-label">Remind me at <span>optional</span></div>
      <input type="time" class="ob-input ht-time-input" value="${p.reminder || ''}"
        aria-label="Reminder time for ${obEscape(p.name)}" onchange="htSetReminder('${p.key}', this.value)">
    </div>`).join('');
}

function htSetName(key, value){
  const p = htPick(key);
  if (!p) return;
  const name = (value || '').trim().slice(0, 80);
  if (name) p.name = name;
  htRenderTune();
}
function htSetMinutes(key, minutes){
  const p = htPick(key);
  if (!p) return;
  p.minutes = minutes;
  htRenderTune();
}
function htToggleDay(key, day){
  const p = htPick(key);
  if (!p) return;
  const at = p.days.indexOf(day);
  if (at > -1){
    // A habit on no days at all is not a habit. The last one stays.
    if (p.days.length > 1) p.days.splice(at, 1);
  } else {
    p.days.push(day);
    p.days.sort();
  }
  htRenderTune();
}
function htSetReminder(key, value){
  const p = htPick(key);
  if (!p) return;
  p.reminder = value || '';
}

/* ---------- slide 6: the next 21 days ---------- */
function htRenderPreview(){
  const wrap = htEl('htObPreview');
  if (!wrap) return;
  const groups = HT_TIMES.map(t => ({
    t,
    rows: htOb.picks.filter(p => p.time === t.id),
  })).filter(g => g.rows.length);
  const heads = { morning:'Your morning', night:'Your night', anytime:'Anytime' };
  wrap.innerHTML = groups.map(g => `
    <div class="ht-preview-group">
      <div class="ht-preview-head">${heads[g.t.id]}</div>
      ${g.rows.map(p => `
        <div class="ht-preview-row">
          <span class="ht-preview-icon" aria-hidden="true">${g.t.icon}</span>
          <span class="ht-preview-name">${obEscape(p.name)}</span>
          <span class="ht-preview-min">${p.minutes ? p.minutes + ' min' : ''}</span>
        </div>`).join('')}
    </div>`).join('');
}

/* ---------- saving, once, at the end ----------
   The same rule main onboarding follows: nothing moves until the database says
   yes. The habits are written first and the flag last, so a half-finished save
   leaves the onboarding still owed rather than a person marked done with no
   routine. Re-running it is safe -- a habit whose name is already there is not
   written twice. */
async function submitHabitOnboarding(){
  if (htOb.saving) return;
  if (!sb || !currentUser){ closeHabitOnboarding(); return; }
  if (!htOb.picks.length) return;

  htOb.saving = true;
  const cta = htEl('htObCta');
  cta.classList.add('busy');
  cta.disabled = true;
  htEl('htObBack').disabled = true;
  const msg = htEl('habitObMsg');
  msg.textContent = 'Saving your routine…';
  msg.className = 'auth-msg';

  const fail = (text) => {
    htOb.saving = false;
    cta.classList.remove('busy');
    htEl('htObBack').disabled = false;
    htRefreshGate();
    msg.textContent = text;
    msg.className = 'auth-msg err';
  };

  // What is already there, so a second attempt after a failed one does not
  // give anybody two Journalings.
  const { data: existing, error: readErr } = await sb.from('habits')
    .select('id, name, archived').eq('user_id', currentUser.id);
  if (readErr){ fail(describeSaveError(readErr)); return; }
  const taken = new Set((existing || []).map(h => (h.name || '').toLowerCase()));

  const today = localDateStr();
  const rows = htOb.picks
    .filter(p => !taken.has(p.name.toLowerCase()))
    .map((p, i) => ({
      user_id: currentUser.id,
      name: p.name,
      time_of_day: p.time,
      sort_order: i,
      duration_minutes: p.minutes,
      days_of_week: p.days,
      reminder_at: p.reminder || null,
    }));

  if (rows.length){
    const { error } = await sb.from('habits').insert(rows);
    if (error){ fail(describeSaveError(error)); console.error('Habit onboarding save failed:', error); return; }
  }

  const error = await saveProfile({
    habit_onboarding_completed: true,
    habit_onboarding_completed_at: new Date().toISOString(),
    habit_cycle_number: 1,
    habit_cycle_started_on: today,
    habit_slots: HABIT_FIRST_CYCLE_MAX,
  });
  if (error){ fail(describeSaveError(error)); console.error('Habit onboarding flag failed:', error); return; }

  // Read it back before moving, the way main onboarding does: a write that
  // reported no error but did not land is how an onboarding comes back.
  const saved = await myProfile({ force: true });
  if (!saved || saved.habit_onboarding_completed !== true){
    fail("Saved, but we couldn't confirm it — tap again.");
    return;
  }

  habitCycle = habitCycleFromProfile(saved);
  htOb.saving = false;
  closeHabitOnboarding();
  await loadHabits({ force: true });
}
