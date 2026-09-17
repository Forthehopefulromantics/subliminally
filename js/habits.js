/* habits.js — habits, non-negotiables, reordering, undo

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- habit tracker: morning & night rituals ----------
   Each time-of-day always shows 15 slots: real habits first, then blank
   fill-in rows for the rest. Typing into a blank row (Enter or blur) creates
   the habit; suggestion chips below do the same in one tap. */
const HABIT_SLOTS = 15;
const HABIT_BLANKS_VISIBLE = 3;   // empty slots shown before "+ more slots"
let habitSlotsExpanded = { morning: false, night: false };
let habitIdeasOpen = { morning: false, night: false };
function renderHabitUndoBar(){
  const bar = document.getElementById('habitUndoBar');
  if (!bar) return;
  const u = document.getElementById('habitUndoBtn');
  const r = document.getElementById('habitRedoBtn');
  u.disabled = !habitUndoStack.length;
  r.disabled = !habitRedoStack.length;
  bar.style.display = (habitUndoStack.length || habitRedoStack.length) ? 'flex' : 'none';
}
function expandHabitSlots(time){ habitSlotsExpanded[time] = true; renderHabits(); }
function toggleHabitIdeas(time){ habitIdeasOpen[time] = !habitIdeasOpen[time]; renderHabits(); }
const MORNING_HABIT_SUGGESTIONS = ['Meditate','Dance','Mirror work','Visualize your day','Practice presence','Go outside','Ground your feet','Journal','Read scripture','Pray','Read a book','Go on a walk','Listen to an audiobook','Eat breakfast'];
const NIGHT_HABIT_SUGGESTIONS = ['Turn off your phone','Shower','Red light therapy','Pick out an outfit for tomorrow','Write a to-do list for tomorrow','Wind down','Drink tea','Journal','Set an alarm','Read a book','Nighttime hygiene'];

/* Habits show in the order you do them, not the order you typed them. Sorting
   client-side keeps working if sort_order hasn't been added yet, where every
   row reads as 0 and the list falls back to oldest-first. */
function sortHabitsCache(){
  habitsCache.sort((a, b) => {
    if (a.time_of_day !== b.time_of_day) return a.time_of_day === 'morning' ? -1 : 1;
    const d = (a.sort_order || 0) - (b.sort_order || 0);
    if (d) return d;
    return (a.created_at || '') < (b.created_at || '') ? -1 : 1;
  });
}

let habitsCache = [];        // rows from `habits`
let habitCheckins = {};      // habit_id -> Set of YYYY-MM-DD
let habitDoneByDate = {};    // YYYY-MM-DD -> Set of habit_id (what the calendar colours by)
async function loadHabits(options){
  if (!sb || !currentUser) return;
  const silent = options && options.silent;   // calendar loads habits quietly, in the background
  /* Today, Rituals and the calendar all want this, and moving between them used
     to ask for the whole list again each time. `force` is for after a write. */
  if (options && options.force) forgetFetch('habits');
  const since = shiftDateStr(localDateStr(), -400);
  const [{ data: habits, error: hErr }, { data: checkins, error: cErr }] = await fetchOnce('habits', () => Promise.all([
    sb.from('habits').select('*').eq('user_id', currentUser.id).eq('archived', false).order('created_at', { ascending: true }),
    sb.from('habit_checkins').select('habit_id, done_on').eq('user_id', currentUser.id).gte('done_on', since),
  ]));
  const msg = document.getElementById('habitsMsg');
  if (hErr || cErr){ forgetFetch('habits'); if (!silent){ msg.textContent = "Couldn't load your habits."; msg.className = 'save-msg err'; } return; }
  habitsCache = habits || [];
  sortHabitsCache();
  habitCheckins = {};
  habitDoneByDate = {};
  (checkins || []).forEach(c => {
    (habitCheckins[c.habit_id] = habitCheckins[c.habit_id] || new Set()).add(c.done_on);
    (habitDoneByDate[c.done_on] = habitDoneByDate[c.done_on] || new Set()).add(c.habit_id);
  });
  if (!silent) renderHabits();
}
/* ---------- non-negotiables, and the short routine ----------
   Most people don't fall out of a ritual because it was too hard. They fall out
   because they built a nine-item evening, missed three items once, decided they
   had blown it, and stopped. So each routine gets a handful of non-negotiables:
   the ones you do even on the night you have nothing left. Doing just those
   still counts as keeping the ritual — twice a week, which is enough to cover a
   bad week without quietly becoming the whole routine.

   None of this needs storing. Whether a day was a full routine, a short one, or
   a miss is worked out from the check-ins already on record, so there is no
   second source of truth to fall out of step. */
const CORE_HABIT_MAX = 5;
const SHORT_ROUTINE_ALLOWANCE = 2;   // short routines per week, per routine

/* Weeks run Monday to Sunday, so a rough Sunday night doesn't spend an
   allowance that a fresh week is about to hand back anyway. */
function weekStartStr(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dow = (new Date(y, m-1, d).getDay() + 6) % 7;   // Monday = 0
  return shiftDateStr(dateStr, -dow);
}

/* How one routine went on one day:
     full       - everything on the list
     essentials - every non-negotiable, but not the whole list
     partial    - something, but not all the non-negotiables
     missed     - nothing                                        */
function routineStatusFor(time, dateStr){
  const rows = habitsCache.filter(h => h.time_of_day === time);
  const done = habitDoneByDate[dateStr] || new Set();
  const core = rows.filter(h => h.is_core);
  const coreDone = core.filter(h => done.has(h.id)).length;
  const allDone = rows.filter(h => done.has(h.id)).length;
  let state = 'missed';
  if (!rows.length) state = 'none';
  else if (allDone === rows.length) state = 'full';
  else if (core.length && coreDone === core.length) state = 'essentials';
  else if (allDone > 0) state = 'partial';
  return { state, done: allDone, total: rows.length, coreDone, coreTotal: core.length };
}

/* Short routines already spent in the week containing dateStr, counting up to
   and including that day. */
function shortRoutinesUsedBy(time, dateStr){
  const start = weekStartStr(dateStr);
  let used = 0;
  for (let i = 0; i < 7; i++){
    const d = shiftDateStr(start, i);
    if (d > dateStr) break;
    if (routineStatusFor(time, d).state === 'essentials') used++;
  }
  return used;
}
function shortRoutinesLeft(time, dateStr){
  return Math.max(0, SHORT_ROUTINE_ALLOWANCE - shortRoutinesUsedBy(time, dateStr || localDateStr()));
}

/* Did this day keep the ritual? A full routine always does. A short one does
   too, as long as there was still an allowance left that week. */
function routineKept(time, dateStr){
  const { state } = routineStatusFor(time, dateStr);
  if (state === 'full') return true;
  if (state !== 'essentials') return false;
  return shortRoutinesUsedBy(time, dateStr) <= SHORT_ROUTINE_ALLOWANCE;
}

/* Consecutive days the ritual was kept — short nights included. This is the
   number that should be hard to break, because it's the one people are
   protecting when they push through a night they should have shortened. */
/* ---------- grace days ----------
   A streak a single hard day can wipe out is measuring luck, not practice. A
   Grace Day bridges one missed day so the run behind it stays intact. Which
   days have been bridged is loaded from the database, not decided here, so the
   same day can't be bridged twice and the balance can't drain invisibly. */
let graceDays = 0;                 // held and unspent
let graceUsed = new Set();         // `${date}|${time}` for days already bridged

async function loadGrace(){
  if (!sb || !currentUser) return;
  const [prof, { data: used }] = await Promise.all([
    myProfile(),
    fetchOnce('graceUsed', () => sb.from('grace_used').select('used_on, time_of_day').eq('user_id', currentUser.id)),
  ]);
  graceDays = Number((prof && prof.grace_days) || 0);
  graceUsed = new Set((used || []).map(r => `${r.used_on}|${r.time_of_day}`));
}

function graceBridged(time, dateStr){ return graceUsed.has(`${dateStr}|${time}`); }

/* Spend one to bridge a day. Recorded before anything is shown, so what the
   screen says and what the database holds can't disagree. */
async function useGraceDay(time, dateStr){
  if (!sb || !currentUser || graceDays < 1) return false;
  forgetFetch('graceUsed'); forgetFetch('profileRow');
  const { data, error } = await sb.rpc('spend_grace_day', { p_on: dateStr, p_time: time });
  if (error || !data){ console.warn('grace:', error && error.message); return false; }
  graceUsed.add(`${dateStr}|${time}`);
  graceDays = Math.max(0, graceDays - 1);
  return true;
}

/* A day counts toward the streak if the routine was kept, or if a Grace Day
   has already been spent on it. */
function routineHeld(time, dateStr){
  return routineKept(time, dateStr) || graceBridged(time, dateStr);
}

function routineStreak(time){
  let cursor = localDateStr();
  // Today not being done yet shouldn't read as the streak already being over.
  if (!routineHeld(time, cursor)) cursor = shiftDateStr(cursor, -1);
  let n = 0;
  while (routineHeld(time, cursor)){ n++; cursor = shiftDateStr(cursor, -1); }
  return n;
}

/* Whether yesterday is the one thing standing between you and your old streak.
   Offered rather than taken: spending someone's Grace Day without telling them
   is worse than letting the number reset. */
function graceOffer(time){
  if (graceDays < 1) return null;
  const yesterday = shiftDateStr(localDateStr(), -1);
  if (routineHeld(time, yesterday)) return null;          // nothing to bridge
  const before = shiftDateStr(yesterday, -1);
  if (!routineHeld(time, before)) return null;            // nothing behind it to save
  let n = 0, cursor = before;
  while (routineHeld(time, cursor)){ n++; cursor = shiftDateStr(cursor, -1); }
  return { time, date: yesterday, saves: n };
}

/* ---------- consistency ----------
   The streak answers "am I on a run". This answers "how have I been doing",
   and a missed day never takes anything away from it. Any day you checked
   something off or logged a page is a day you practised. */
function practisedOn(dateStr){
  if ((habitDoneByDate[dateStr] || new Set()).size) return true;
  return !!(typeof journalPhotosByDate !== 'undefined' && journalPhotosByDate[dateStr]);
}
function consistency(days){
  const span = days || 30;
  let n = 0;
  for (let i = 0; i < span; i++) if (practisedOn(shiftDateStr(localDateStr(), -i))) n++;
  return { days: n, of: span, pct: Math.round(n / span * 100) };
}

/* Mark a habit as one of the non-negotiables, or take the mark off again. */
async function toggleCoreHabit(habitId){
  if (!sb || !currentUser) return;
  const habit = habitsCache.find(h => h.id === habitId);
  if (!habit) return;
  const msg = document.getElementById('habitsMsg');
  const turningOn = !habit.is_core;
  if (turningOn){
    const already = habitsCache.filter(h => h.time_of_day === habit.time_of_day && h.is_core).length;
    if (already >= CORE_HABIT_MAX){
      msg.textContent = `${CORE_HABIT_MAX} non-negotiables is the most for one routine — that's the point of them. Take one off first.`;
      msg.className = 'save-msg';
      return;
    }
  }
  msg.textContent = '';
  pushHabitUndo();
  habit.is_core = turningOn;
  renderHabits();
  // Checking something off is the moment she has something new to say.
  if (document.body.getAttribute('data-view') === 'today'){ renderTodayRitual(); renderHigherSelfCard(); renderLightStrip(); renderTodayJourney(); }
  const { error } = await sb.from('habits').update({ is_core: turningOn }).eq('id', habitId).eq('user_id', currentUser.id);
  if (error){
    console.error('toggleCoreHabit error:', error);
    msg.textContent = "Couldn't save that — try again."; msg.className = 'save-msg err';
    loadHabits({ force: true });
  }
}

/* Share of that day's habits that got checked off, 0–1. Measured against the
   habits you keep now, so the calendar reads as "how much of my ritual did I
   keep" rather than a moving target. */
function habitCompletionFor(dateStr){
  if (!habitsCache.length) return null;
  const done = habitDoneByDate[dateStr];
  return (done ? done.size : 0) / habitsCache.length;
}
function renderHabits(){
  const today = localDateStr();
  const week = Array.from({ length: 7 }, (_, i) => shiftDateStr(today, i - 6));
  let doneToday = 0;
  ['morning','night'].forEach(time => {
    const rows = habitsCache.filter(h => h.time_of_day === time);
    const list = document.getElementById(time === 'morning' ? 'habitListMorning' : 'habitListNight');
    const count = document.getElementById(time === 'morning' ? 'habitCountMorning' : 'habitCountNight');
    const suggestWrap = document.getElementById(time === 'morning' ? 'habitSuggestMorning' : 'habitSuggestNight');
    const done = rows.filter(h => (habitCheckins[h.id] || new Set()).has(today)).length;
    doneToday += done;
    const coreCount = rows.filter(h => h.is_core).length;
    const shortLeft = shortRoutinesLeft(time, today);
    count.textContent = rows.length
      ? `${done} of ${rows.length} today · ${coreCount}/${CORE_HABIT_MAX} non-negotiable · ${shortLeft} short ${time}${shortLeft === 1 ? '' : 's'} left this week`
      : `0/${HABIT_SLOTS} added`;

    const realRowsHtml = rows.map((h, i) => {
      const days = habitCheckins[h.id] || new Set();
      const isDone = days.has(today);
      const streak = streakFromDays(days);
      const dots = week.map(d => `<span class="habit-dot${days.has(d) ? ' on' : ''}${d === today ? ' today' : ''}" title="${d}"></span>`).join('');
      const safeName = h.name.replace(/"/g,'&quot;');
      return `
      <div class="habit-row${isDone ? ' done-today' : ''}" data-habit-row data-habit-id="${h.id}" data-time="${time}">
        <button class="habit-order" data-habit-grip data-habit-id="${h.id}" onkeydown="habitOrderKey(event,'${h.id}')"
          aria-label="${safeName} is number ${i + 1}. Drag, or use the arrow keys, to move it."
          title="Drag to reorder">${i + 1}</button>
        <button class="habit-check${isDone ? ' done' : ''}" onclick="toggleHabitToday('${h.id}')" aria-label="${isDone ? 'Undo' : 'Done'}: ${safeName}" aria-pressed="${isDone}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <input type="text" class="habit-name" value="${safeName}" maxlength="80" aria-label="Habit name"
          onkeydown="if(event.key==='Enter') this.blur();"
          onblur="renameHabit('${h.id}', this.value)">
        <div class="habit-week" aria-hidden="true">${dots}</div>
        <div class="habit-streak${streak ? '' : ' zero'}">${streak ? `${streak}-day streak` : 'no streak yet'}</div>
        <div class="habit-actions">
          <button class="habit-core-toggle${h.is_core ? ' on' : ''}" onclick="toggleCoreHabit('${h.id}')"
            aria-pressed="${h.is_core ? 'true' : 'false'}"
            title="${h.is_core ? 'A non-negotiable — tap to unmark' : 'Mark as non-negotiable'}"
            aria-label="${h.is_core ? 'Unmark' : 'Mark'} ${safeName} as non-negotiable">✦</button>
          <button class="habit-delete" onclick="deleteHabit('${h.id}')" aria-label="Remove ${safeName}" title="Remove">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');

    const already = new Set(rows.map(h => h.name.toLowerCase()));
    const pool = (time === 'morning' ? MORNING_HABIT_SUGGESTIONS : NIGHT_HABIT_SUGGESTIONS).filter(s => !already.has(s.toLowerCase()));
    // All 15 slots are there, but showing 15 empty boxes at once reads as a
    // chore list. Offer a few at a time and let people ask for the rest.
    const remaining = Math.max(0, HABIT_SLOTS - rows.length);
    const blanksShown = habitSlotsExpanded[time] ? remaining : Math.min(HABIT_BLANKS_VISIBLE, remaining);
    const blankRowsHtml = Array.from({ length: blanksShown }, (_, i) => {
      const example = pool.length ? `e.g. ${pool[i % pool.length]}` : `Habit #${rows.length + i + 1}`;
      return `
      <div class="habit-row habit-row-blank">
        <span class="habit-slot-num">${rows.length + i + 1}</span>
        <input type="text" class="habit-blank-input" placeholder="${example}" maxlength="80"
          onkeydown="if(event.key==='Enter'){ addHabit('${time}', this.value); this.value=''; this.blur(); }"
          onblur="if(this.value.trim()){ addHabit('${time}', this.value); this.value=''; }">
      </div>`;
    }).join('');
    const hiddenSlots = remaining - blanksShown;
    const moreSlotsHtml = hiddenSlots > 0
      ? `<button type="button" class="habit-more-slots" onclick="expandHabitSlots('${time}')">+ ${hiddenSlots} more slot${hiddenSlots === 1 ? '' : 's'}</button>`
      : '';

    // Said once, where the decision is actually made.
    const coreHint = rows.length && !rows.some(h => h.is_core)
      ? `<p class="habit-core-hint">Tap ✦ on the few you'd still do on your worst day. Doing just those counts as keeping the ritual — twice a week.</p>`
      : '';
    list.innerHTML = coreHint + realRowsHtml + blankRowsHtml + moreSlotsHtml;

    if (suggestWrap){
      suggestWrap.innerHTML = rows.length >= HABIT_SLOTS
        ? `<span class="habit-suggest-full">15 of 15 — this ritual is full.</span>`
        : pool.length
          ? `<button type="button" class="habit-ideas-toggle" onclick="toggleHabitIdeas('${time}')" aria-expanded="${habitIdeasOpen[time]}">Need ideas?</button>`
            + (habitIdeasOpen[time] ? `<div class="habit-ideas-chips">${pool.map(s => `<button type="button" class="habit-suggest-chip" onclick="addHabit('${time}','${s}')">${s}</button>`).join('')}</div>` : '')
          : '';
    }
  });
  renderHabitUndoBar();
  const stat = document.getElementById('habitsStat');
  if (!habitsCache.length){ stat.style.display = 'none'; return; }
  const allDays = new Set();
  habitsCache.forEach(h => (habitCheckins[h.id] || new Set()).forEach(d => allDays.add(d)));
  const practiceStreak = streakFromDays(allDays);
  // If non-negotiables are set, the streak worth showing is the one they protect
  // — kept on the short nights as well as the full ones.
  const kept = ['morning','night']
    .filter(t => habitsCache.some(h => h.time_of_day === t && h.is_core))
    .map(t => ({ t, n: routineStreak(t) }))
    .filter(x => x.n > 1)
    .map(x => `${x.n}-day ${x.t} streak`);
  const streakText = kept.length ? ` · ${kept.join(' · ')}`
    : practiceStreak > 1 ? ` · ${practiceStreak}-day practice streak` : '';
  stat.style.display = 'block';
  stat.textContent = doneToday === habitsCache.length
    ? `✦ Every ritual done today${streakText}`
    : `${doneToday} of ${habitsCache.length} done today${streakText}`;
}
async function addHabit(time, name){
  if (!sb || !currentUser) return;
  name = (name || '').trim();
  if (!name) return;
  if (habitsCache.filter(h => h.time_of_day === time).length >= HABIT_SLOTS) return;
  const msg = document.getElementById('habitsMsg');
  pushHabitUndo();
  const sortOrder = habitsCache.filter(h => h.time_of_day === time).length;
  /* Ask for the saved row back rather than adding it and then fetching the
     whole list again to find out what its id is. Same one trip to the
     database, and the habit is on screen the moment it lands instead of one
     more wait later. */
  const { data, error } = await sb.from('habits')
    .insert({ user_id: currentUser.id, name, time_of_day: time, sort_order: sortOrder })
    .select().single();
  if (error){ console.error('addHabit error:', error); msg.textContent = "Couldn't add that habit — try again."; msg.className = 'save-msg err'; return; }
  msg.textContent = '';
  forgetFetch('habits');
  if (data){
    habitsCache.push(data);
    sortHabitsCache();
    repaintHabitLists();
    if (document.body.getAttribute('data-view') === 'today') renderTodayJourney();
  } else {
    loadHabits({ force: true });   // older Supabase, or the row came back empty
  }
}
function toggleHabitToday(habitId){ return toggleHabitOnDate(habitId, localDateStr()); }
/* Check a habit off for any day — today from the habit list, or an earlier
   day from its calendar square. */
/* Light for a day's practice, asked for after a check-in lands. Un-checking
   never takes Light back: the database won't pay twice for the same day, so a
   refund would let someone tick, untick and tick again forever. What you did
   happened, even if you change your mind about the tick. */
async function awardLightForDay(dateStr, near){
  if (dateStr !== localDateStr()) return;              // only today pays
  for (const time of ['morning','night']){
    const rows = habitsCache.filter(h => h.time_of_day === time);
    if (!rows.length) continue;
    const st = routineStatusFor(time, dateStr);
    if (st.state === 'full'){
      await awardLight(time === 'morning' ? LIGHT_SOURCES.morningRitual : LIGHT_SOURCES.nightRitual, time, near);
    }
    if (st.coreTotal && st.coreDone === st.coreTotal){
      await awardLight(LIGHT_SOURCES.nonNegotiables, time, null);
    }
  }
  const bothFull = ['morning','night'].every(t => {
    const rows = habitsCache.filter(h => h.time_of_day === t);
    return rows.length && routineStatusFor(t, dateStr).state === 'full';
  });
  if (bothFull) await awardLight(LIGHT_SOURCES.perfectDay, '', null);
  if (routineStreak(currentRitualTime()) >= 7) await awardLight(LIGHT_SOURCES.weekStreak, weekStartStr(dateStr), null);
  // Earning is recalculated rather than incremented, so the balance can't drift.
  if (sb && currentUser){
    forgetFetch('profileRow');
    const { data } = await sb.rpc('refresh_grace_days');
    if (typeof data === 'number') graceDays = data;
  }
}

async function toggleHabitOnDate(habitId, dateStr){
  if (!sb || !currentUser || dateStr > localDateStr()) return;
  const days = habitCheckins[habitId] = habitCheckins[habitId] || new Set();
  const dayDone = habitDoneByDate[dateStr] = habitDoneByDate[dateStr] || new Set();
  const wasDone = days.has(dateStr);
  // Flip locally first so the tap feels instant; reload only if the save fails.
  if (wasDone){ days.delete(dateStr); dayDone.delete(habitId); }
  else { days.add(dateStr); dayDone.add(habitId); }
  if (document.getElementById('habitsPanel').style.display !== 'none') renderHabits();
  if (document.getElementById('dayModalOverlay').classList.contains('open')) dayModalContent(dateStr);
  // Habits are checked off straight from Today as well as from the Rituals page,
  // so that card has to repaint too — otherwise the tick never appears and the
  // tap reads as broken even though it saved.
  // Checking something off is the moment she has something new to say.
  if (document.body.getAttribute('data-view') === 'today'){ renderTodayRitual(); renderHigherSelfCard(); renderLightStrip(); renderTodayJourney(); }
  renderPhotoCalendar();
  renderWeekReport();
  renderDailyLogReward();
  const { error } = wasDone
    ? await sb.from('habit_checkins').delete().eq('habit_id', habitId).eq('user_id', currentUser.id).eq('done_on', dateStr)
    : await sb.from('habit_checkins').insert({ user_id: currentUser.id, habit_id: habitId, done_on: dateStr });
  // The tick is already right in memory; drop the remembered copy so that a
  // reload later in the session doesn't put the old answer back over it.
  forgetFetch('habits');
  if (error){
    // The tick was flipped locally a moment ago; if the save didn't land, put it
    // back and say so, rather than letting it silently disappear on the next load.
    console.error('toggleHabitOnDate error:', error);
    const msg = document.getElementById('habitsMsg');
    if (msg){ msg.textContent = "Couldn't save that check-in — check your connection and tap it again."; msg.className = 'save-msg err'; }
    loadHabits({ force: true });
    return;
  }
  // Only once the check-in is really saved, so Light can't be earned for a tick
  // that didn't land.
  if (!wasDone){
    const near = document.querySelector(`.day-habit[onclick*="${habitId}"], .habit-row[data-habit-id="${habitId}"] .habit-check`);
    // Neither of these is on screen -- the tick was drawn the moment you tapped
    // -- so they do not need to queue behind each other.
    await Promise.all([
      awardLight(LIGHT_SOURCES.habit, habitId, near),
      awardLightForDay(dateStr, near),
    ]);
  }
}
/* ---------- undo and redo ----------
   Reordering, renaming, archiving and marking non-negotiables are all easy to
   do by accident and tedious to put back by hand. Rather than tracking an
   inverse for each kind of change, every change records what the list looked
   like beforehand; undo simply puts one of those back. Check-offs aren't part
   of this — a tick is one tap to undo on its own, and mixing the two would make
   the button mean two different things.

   Deleting archives the row rather than removing it, so undoing a delete brings
   back the habit *and* every check-in ever made against it. */
let habitUndoStack = [], habitRedoStack = [];
const HABIT_UNDO_LIMIT = 40;

function habitSnapshot(){
  return habitsCache.map(h => ({
    id: h.id, name: h.name, time_of_day: h.time_of_day,
    is_core: !!h.is_core, sort_order: h.sort_order || 0,
  }));
}
function pushHabitUndo(){
  habitUndoStack.push(habitSnapshot());
  if (habitUndoStack.length > HABIT_UNDO_LIMIT) habitUndoStack.shift();
  habitRedoStack = [];   // a fresh change forks the history; the old redos are gone
}

/* Put the list back exactly as a snapshot had it. Only rows that actually
   differ are written, so undoing a single rename is a single update. */
async function applyHabitSnapshot(snap){
  if (!sb || !currentUser) return;
  const inSnap = new Set(snap.map(h => h.id));
  const updates = [];
  // Anything added after the snapshot goes away again.
  habitsCache.forEach(h => { if (!inSnap.has(h.id)) updates.push({ id: h.id, fields: { archived: true } }); });
  snap.forEach(sv => {
    const cur = habitsCache.find(h => h.id === sv.id);
    if (cur && cur.name === sv.name && !!cur.is_core === sv.is_core && (cur.sort_order || 0) === sv.sort_order) return;
    updates.push({ id: sv.id, fields: { name: sv.name, is_core: sv.is_core, sort_order: sv.sort_order, archived: false } });
  });
  for (const u of updates){
    const { error } = await sb.from('habits').update(u.fields).eq('id', u.id).eq('user_id', currentUser.id);
    if (error) console.error('undo/redo failed for habit', u.id, error);
  }
  await loadHabits({ force: true });
  // Checking something off is the moment she has something new to say.
  if (document.body.getAttribute('data-view') === 'today'){ renderTodayRitual(); renderHigherSelfCard(); renderLightStrip(); renderTodayJourney(); }
}

async function undoHabits(){
  if (!habitUndoStack.length) return;
  const before = habitUndoStack.pop();
  habitRedoStack.push(habitSnapshot());
  await applyHabitSnapshot(before);
}
async function redoHabits(){
  if (!habitRedoStack.length) return;
  const after = habitRedoStack.pop();
  habitUndoStack.push(habitSnapshot());
  await applyHabitSnapshot(after);
}

/* ---------- dragging a habit into place ----------
   Pointer events rather than HTML5 drag-and-drop, because drag-and-drop does
   nothing at all on a touchscreen and this is a phone app first. The row
   follows your finger, its neighbours slide out of the way as you pass their
   midpoints, and the new order is saved once on release. The arrow keys do the
   same job for anyone using a keyboard or a screen reader.

   This works off data attributes rather than the habits panel's own class
   names, because two lists show the same habits — the panel on Rituals and the
   ritual card on Today — and reordering has to mean the same thing in both. A
   second copy of this for Today would drift from this one within a month.
   Anything that marks itself [data-habit-row] with a [data-habit-grip] inside
   is draggable, whatever it looks like. */
let habitDrag = null;

function startHabitDrag(e){
  const grip = e.target.closest('[data-habit-grip]');
  if (!grip || e.button > 0) return;
  const row = grip.closest('[data-habit-row]');
  const list = row && row.parentElement;
  if (!row || !list) return;
  e.preventDefault();

  const rows = [...list.querySelectorAll('[data-habit-row]')];
  habitDrag = {
    row, list, rows,
    time: row.dataset.time,
    startY: e.clientY,
    height: row.getBoundingClientRect().height,
  };
  row.classList.add('dragging');
  grip.setPointerCapture(e.pointerId);
  document.body.classList.add('habit-dragging');
}

/* The rows are reordered in the DOM as you drag, so the numbers have to keep
   up — otherwise you'd be dropping a row labelled 4 into position 2. */
function renumberHabitList(list){
  [...list.querySelectorAll('[data-habit-row] [data-habit-grip]')]
    .forEach((el, i) => { el.textContent = i + 1; });
}

function moveHabitDrag(e){
  if (!habitDrag) return;
  e.preventDefault();
  const { row, startY } = habitDrag;
  const dy = e.clientY - startY;
  row.style.transform = `translateY(${dy}px)`;

  // Swap with whichever neighbour the pointer has moved past the middle of.
  const mid = row.getBoundingClientRect().top + habitDrag.height / 2;
  const siblings = [...habitDrag.list.querySelectorAll('[data-habit-row]')].filter(r => r !== row);
  for (const other of siblings){
    const box = other.getBoundingClientRect();
    const otherMid = box.top + box.height / 2;
    const before = other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (before && mid < otherMid){ habitDrag.list.insertBefore(row, other); habitDrag.startY = e.clientY; row.style.transform = ''; renumberHabitList(habitDrag.list); break; }
    if (!before && mid > otherMid){ habitDrag.list.insertBefore(row, other.nextSibling); habitDrag.startY = e.clientY; row.style.transform = ''; renumberHabitList(habitDrag.list); break; }
  }
}

async function endHabitDrag(){
  if (!habitDrag) return;
  const { row, list, time } = habitDrag;
  habitDrag = null;
  row.classList.remove('dragging');
  row.style.transform = '';
  document.body.classList.remove('habit-dragging');

  const orderedIds = [...list.querySelectorAll('[data-habit-row]')].map(r => r.dataset.habitId);
  const current = habitsCache.filter(h => h.time_of_day === time);
  const ordered = orderedIds.map(id => current.find(h => h.id === id)).filter(Boolean);
  if (ordered.length !== current.length){ repaintHabitLists(); return; }   // something's out of step; repaint from truth
  if (ordered.every((h, i) => h === current[i])){ repaintHabitLists(); return; }  // nothing actually moved
  pushHabitUndo();
  await persistHabitOrder(time, ordered);
}

document.addEventListener('pointerdown', startHabitDrag);
document.addEventListener('pointermove', moveHabitDrag, { passive: false });
document.addEventListener('pointerup', endHabitDrag);
document.addEventListener('pointercancel', endHabitDrag);

/* ---------- putting habits in order ---------- */
async function persistHabitOrder(time, ordered){
  ordered.forEach((h, i) => { h.sort_order = i; });
  sortHabitsCache();
  renderHabits();
  // Checking something off is the moment she has something new to say.
  if (document.body.getAttribute('data-view') === 'today'){ renderTodayRitual(); renderHigherSelfCard(); renderLightStrip(); renderTodayJourney(); }
  for (const h of ordered){
    const { error } = await sb.from('habits').update({ sort_order: h.sort_order }).eq('id', h.id).eq('user_id', currentUser.id);
    if (error){
      console.error('persistHabitOrder error:', error);
      const msg = document.getElementById('habitsMsg');
      if (msg){ msg.textContent = "Couldn't save the new order — check your connection."; msg.className = 'save-msg err'; }
      loadHabits({ force: true });
      return;
    }
  }
}

/* Nudge one habit up or down its own routine. */
/* Dragging is a pointer gesture, so the arrow keys keep the list reorderable
   without putting the arrow buttons back on screen. */
function habitOrderKey(e, habitId){
  const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
  if (!dir) return;
  e.preventDefault();
  moveHabit(habitId, dir).then(() => {
    const el = document.querySelector(`.habit-order[data-habit-id="${habitId}"]`);
    if (el) el.focus();
  });
}

async function moveHabit(habitId, dir){
  if (!sb || !currentUser) return;
  const habit = habitsCache.find(h => h.id === habitId);
  if (!habit) return;
  const siblings = habitsCache.filter(h => h.time_of_day === habit.time_of_day);
  const from = siblings.indexOf(habit);
  const to = from + dir;
  if (to < 0 || to >= siblings.length) return;
  pushHabitUndo();
  siblings.splice(to, 0, siblings.splice(from, 1)[0]);
  await persistHabitOrder(habit.time_of_day, siblings);
}

/* Rename in place — edit the habit's text and it saves on blur or Enter,
   keeping every check-in attached to it. */
async function renameHabit(habitId, name){
  if (!sb || !currentUser) return;
  name = (name || '').trim();
  const habit = habitsCache.find(h => h.id === habitId);
  if (!habit || !name || name === habit.name){ renderHabits(); return; }
  pushHabitUndo();
  habit.name = name;
  renderHabits();
  const { error } = await sb.from('habits').update({ name }).eq('id', habitId).eq('user_id', currentUser.id);
  if (error){ console.error('renameHabit error:', error); loadHabits({ force: true }); }
}
/* Archived, not deleted: the row and its check-ins stay put, so Undo can bring
   the whole history back rather than an empty habit with the same name. */
async function deleteHabit(habitId){
  if (!sb || !currentUser) return;
  pushHabitUndo();
  // Off the screen first, the same way a tick goes on first. Undo puts it back
  // whether or not the save landed, and a failed save reloads the truth.
  const removed = habitsCache.find(h => h.id === habitId);
  habitsCache = habitsCache.filter(h => h.id !== habitId);
  repaintHabitLists();
  if (document.body.getAttribute('data-view') === 'today'){ renderTodayRitual(); renderHigherSelfCard(); renderLightStrip(); renderTodayJourney(); }
  forgetFetch('habits');
  const { error } = await sb.from('habits').update({ archived: true }).eq('id', habitId).eq('user_id', currentUser.id);
  if (error){
    console.error('deleteHabit error:', error);
    if (removed) habitsCache.push(removed);
    await loadHabits({ force: true });
    repaintHabitLists();
  }
}
/* Library is now a direct YouTube playlist embed — see #library in the HTML.
   No Supabase fetch needed for it anymore. */


/* Both places habits appear repaint together. Reordering on Today has to show
   up on Rituals and the other way round, and the panel being closed is not a
   reason to leave it stale behind you. */
function repaintHabitLists(){
  if (typeof renderHabits === 'function') renderHabits();
  if (typeof renderTodayRitual === 'function' &&
      document.body.getAttribute('data-view') === 'today') renderTodayRitual();
}

/* ---------- a picture for each habit ----------
   Stored in habits.icon when someone picks one, guessed from the name when they
   have not. The guess matters more than the picker: every habit that already
   exists gets a picture the moment the migration runs, rather than a list of
   blanks waiting to be filled in one at a time.

   Longest match wins, so "cold shower" is not claimed by "shower", and the
   check runs over the whole name so "morning walk" still finds "walk". */
const HABIT_ICON_GUESSES = [
  ['cold shower','🚿'], ['shower','🚿'], ['bath','🛁'], ['brush','🪥'], ['floss','🦷'],
  ['skincare','🧴'], ['skin','🧴'], ['moisturis','🧴'], ['moisturiz','🧴'], ['sunscreen','🧴'],
  ['water','💧'], ['hydrat','💧'], ['tea','🍵'], ['coffee','☕'], ['smoothie','🥤'],
  ['vitamin','💊'], ['supplement','💊'], ['medicat','💊'], ['protein','🥤'],
  ['breakfast','🍳'], ['lunch','🥗'], ['dinner','🍽'], ['meal','🍽'], ['eat','🍽'],
  ['gym','🏋'], ['workout','🏋'], ['lift','🏋'], ['train','🏋'], ['exercis','🏋'],
  ['run','🏃'], ['walk','🚶'], ['steps','🚶'], ['yoga','🧘'], ['stretch','🤸'], ['pilates','🧘'],
  ['meditat','🧘'], ['breath','🌬'], ['pray','🙏'], ['gratitude','🙏'], ['grateful','🙏'],
  ['journal','📓'], ['write','✍'], ['read','📖'], ['book','📖'], ['study','📚'], ['learn','📚'],
  ['affirm','✨'], ['mirror','🪞'], ['visuali','🌟'], ['manifest','🌙'], ['subliminal','🎧'],
  ['sleep','😴'], ['bed','🛏'], ['nap','😴'], ['wake','🌅'], ['sunrise','🌅'], ['sunset','🌇'],
  ['phone','📵'], ['screen','📵'], ['social','📵'], ['scroll','📵'],
  ['clean','🧹'], ['tidy','🧹'], ['laundry','🧺'], ['dish','🧼'], ['make the bed','🛏'],
  ['plan','🗓'], ['budget','💰'], ['money','💰'], ['save','💰'], ['work','💼'],
  ['music','🎵'], ['sing','🎤'], ['dance','💃'], ['art','🎨'], ['draw','🎨'], ['create','🎨'],
  ['sun','☀'], ['outside','🌿'], ['nature','🌿'], ['plant','🪴'], ['garden','🪴'],
  ['call','📞'], ['text','💬'], ['friend','💛'], ['family','💛'], ['love','💛'],
];
function habitIcon(h){
  if (h && h.icon) return h.icon;
  const name = ((h && h.name) || '').toLowerCase();
  let best = '', bestLen = 0;
  for (const [needle, glyph] of HABIT_ICON_GUESSES){
    if (name.includes(needle) && needle.length > bestLen){ best = glyph; bestLen = needle.length; }
  }
  return best || '○';
}

/* The set someone can choose from. Kept short: a grid of three hundred emoji is
   a worse experience than a shelf of forty that were picked on purpose. */
const HABIT_ICON_CHOICES = [
  '💧','🍵','☕','🥤','💊','🍳','🥗','🍽','🏋','🏃','🚶','🧘','🤸','🌬','🙏',
  '📓','✍','📖','📚','✨','🪞','🌟','🌙','🎧','😴','🛏','🌅','🌇','📵','🧹',
  '🧺','🧼','🚿','🛁','🪥','🧴','🗓','💰','💼','🎵','🎤','💃','🎨','☀','🌿',
  '🪴','📞','💬','💛','○',
];

async function setHabitIcon(habitId, glyph){
  const h = habitsCache.find(x => x.id === habitId);
  if (h) h.icon = glyph;
  closeHabitIconPicker();
  repaintHabitLists();
  if (!sb || !currentUser) return;
  const { error } = await sb.from('habits').update({ icon: glyph })
    .eq('id', habitId).eq('user_id', currentUser.id);
  // The column arrives with 20260926. Until then the picture is this session
  // only, which is better than refusing to show one.
  if (error) console.warn('habit icon:', error.message);
}

function openHabitIconPicker(habitId){
  closeHabitIconPicker();
  const anchor = document.querySelector(`[data-habit-row][data-habit-id="${habitId}"] .habit-icon`)
              || document.querySelector(`.habit-icon[data-habit-id="${habitId}"]`);
  const pop = document.createElement('div');
  pop.className = 'icon-pop'; pop.id = 'habitIconPop'; pop.setAttribute('role','dialog');
  pop.setAttribute('aria-label','Choose a picture for this habit');
  pop.innerHTML = HABIT_ICON_CHOICES.map(g =>
    `<button type="button" onclick="setHabitIcon('${habitId}','${g}')" aria-label="${g}">${g}</button>`).join('');
  (anchor ? anchor.parentElement : document.body).appendChild(pop);
  const first = pop.querySelector('button'); if (first) first.focus();
  setTimeout(() => document.addEventListener('click', habitIconOutside), 0);
}
function habitIconOutside(e){
  const pop = document.getElementById('habitIconPop');
  if (pop && !pop.contains(e.target)) closeHabitIconPicker();
}
function closeHabitIconPicker(){
  const pop = document.getElementById('habitIconPop');
  if (pop) pop.remove();
  document.removeEventListener('click', habitIconOutside);
}

/* ---------- a small ask ----------
   One modal for a question that needs an answer before anything happens. Two
   things use it: confirming a log out, and the reflection after a missed
   ritual. */
let askOnClose = null;

function openAsk(title, bodyHtml, onClose){
  const o = document.getElementById('askOverlay');
  if (!o) return;
  document.getElementById('askTitle').textContent = title;
  document.getElementById('askBody').innerHTML = bodyHtml;
  askOnClose = onClose || null;
  o.classList.add('open');
  const first = o.querySelector('button:not(.modal-close)');
  if (first) first.focus();
}
function closeAsk(){
  const o = document.getElementById('askOverlay');
  if (o) o.classList.remove('open');
  const fn = askOnClose; askOnClose = null;
  if (fn) fn();
}

/* Logging out on a shared or borrowed device is one tap from losing your place,
   and there is no undo for it. */
function confirmLogOut(){
  openAsk('Log out?', `
    <div class="ask-text">You'll need to sign in again to get back to your rituals and your subliminals. Nothing is deleted.</div>
    <div class="ask-row">
      <button class="btn btn-ghost" onclick="closeAsk()">Stay signed in</button>
      <button class="btn btn-primary" onclick="closeAsk(); logOut();">Log out</button>
    </div>`);
}

/* ---------- the reflection ----------
   Asked once, the day after a ritual was not kept, and never again for that
   day. Every part of it is optional, and the wording is the whole design: a
   missed day is a thing that happened, not a thing you failed. "Why did you
   skip it" would be an interrogation; "what got in the way" is a question about
   the day rather than about the person. */
const MISS_REASONS = [
  'Too tired', 'No time', 'Wasn\u2019t home', 'Forgot',
  'Didn\u2019t feel like it', 'Unwell', 'Something came up', 'Needed a break',
];
const MISS_FEELINGS = [
  'Fine about it', 'A bit disappointed', 'Relieved',
  'Frustrated', 'Didn\u2019t notice', 'Ready to go again',
];
/* Neither list can cover a real day, and a list that pretends to makes people
   pick the nearest wrong answer. "Something else" opens a box. */
const ASK_OTHER = 'Something else';
let reflection = { on:null, time:null, reason:null, feeling:null };

function pickAskChip(kind, value, el){
  const group = el.parentElement;
  const off = reflection[kind] === value;
  reflection[kind] = off ? null : value;
  group.querySelectorAll('.ask-chip').forEach(c => c.classList.remove('sel'));
  if (!off) el.classList.add('sel');
  // The box appears under whichever list "Something else" was picked in, and
  // takes the focus, because opening a field nobody is typing in is just a
  // field in the way.
  const box = document.getElementById('askOther-' + kind);
  if (box){
    const want = !off && value === ASK_OTHER;
    box.style.display = want ? 'block' : 'none';
    if (want){ box.value = ''; box.focus(); }
  }
}
/* What is typed replaces the chip's own text, so the answer that is stored is
   the answer that was given. */
function askOtherInput(kind, value){
  reflection[kind] = value.trim() || ASK_OTHER;
}

function openReflection(time, dateStr){
  reflection = { on: dateStr, time, reason: null, feeling: null };
  const when = time === 'morning' ? 'morning ritual' : 'night ritual';
  const day = new Date(dateStr + 'T00:00:00')
    .toLocaleDateString(undefined, { weekday:'long' });
  openAsk(`${day}\u2019s ${when}`, `
    <div class="ask-text">It didn\u2019t happen, and that\u2019s allowed. If you want to say what got in the way, it helps to see the pattern later \u2014 and if you don\u2019t, skip it.</div>
    <button type="button" class="ask-did" onclick="goLogRitual()">
      I did do it — take me there to log it
    </button>
    <div class="ask-label">What got in the way</div>
    <div class="ask-chips">${MISS_REASONS.concat([ASK_OTHER]).map(r =>
      `<button type="button" class="ask-chip" onclick="pickAskChip('reason','${r.replace(/'/g,"\\'")}',this)">${r}</button>`).join('')}
      <input type="text" class="ask-other" id="askOther-reason" style="display:none"
        maxlength="120" placeholder="In your own words…"
        oninput="askOtherInput('reason', this.value)" aria-label="What got in the way">
    </div>
    <div class="ask-label">How you feel about it</div>
    <div class="ask-chips">${MISS_FEELINGS.concat([ASK_OTHER]).map(f =>
      `<button type="button" class="ask-chip" onclick="pickAskChip('feeling','${f.replace(/'/g,"\\'")}',this)">${f}</button>`).join('')}
      <input type="text" class="ask-other" id="askOther-feeling" style="display:none"
        maxlength="120" placeholder="In your own words…"
        oninput="askOtherInput('feeling', this.value)" aria-label="How you feel about it">
    </div>
    <div class="ask-row">
      <button class="btn btn-primary" onclick="saveReflection()">Save</button>
    </div>
    <div style="margin-top:12px; text-align:center;">
      <button class="ask-skip" onclick="dismissReflection()">Skip this</button>
    </div>`);
}

/* Skipping still writes the row. Otherwise the same day is asked about every
   morning until it is answered, which turns a gentle question into nagging. */
async function dismissReflection(){
  await writeReflection({ reason:null, feeling:null });
  closeAsk();
}
async function saveReflection(){
  await writeReflection({ reason: reflection.reason, feeling: reflection.feeling });
  closeAsk();
}
/* Answered days are remembered on the device as well as in the database.
   Until 20260927 is run the table does not exist, so the write fails and the
   only record was a variable that dies with the page -- which is why the same
   question came back on every refresh. The device is not the source of truth,
   it is the thing that stops it asking twice. */
const ANSWERED_KEY = 'fthr_reflections';
function rememberAnswered(key){
  reflectionsSeen[key] = true;
  try {
    const all = JSON.parse(localStorage.getItem(ANSWERED_KEY) || '{}');
    all[key] = Date.now();
    // A month is longer than anything is ever asked about, and keeps this small.
    const cutoff = Date.now() - 31 * 864e5;
    for (const k of Object.keys(all)) if (all[k] < cutoff) delete all[k];
    localStorage.setItem(ANSWERED_KEY, JSON.stringify(all));
  } catch(e){}
}

async function writeReflection(fields){
  const { on, time } = reflection;
  if (!on) return;
  rememberAnswered(`${on}|${time}`);
  if (!sb || !currentUser) return;
  forgetFetch('reflections');
  const { error } = await sb.from('ritual_reflections').upsert({
    user_id: currentUser.id, missed_on: on, time_of_day: time,
    reason: fields.reason, feeling: fields.feeling,
  }, { onConflict: 'user_id,missed_on,time_of_day' });
  if (error) console.warn('reflection:', error.message);
}

/* "I did it, I just forgot" opens that day so it can be logged, rather than
   ticking everything off on the person's behalf. Nobody does every item every
   time, and a day filled in automatically is a record of what the app assumed
   rather than of what happened -- which is worse than a gap, because it looks
   like the truth.

   The question is marked answered either way, so it is not asked again whether
   they log the whole thing, some of it, or close the day and walk off. */
function goLogRitual(){
  const { on, time } = reflection;
  closeAsk();
  if (!on) return;
  rememberAnswered(`${on}|${time}`);
  if (typeof openDayDetail === 'function') openDayDetail(on);
}

let reflectionsSeen = {};
async function loadReflections(){
  reflectionsSeen = {};
  try {
    const all = JSON.parse(localStorage.getItem(ANSWERED_KEY) || '{}');
    for (const k of Object.keys(all)) reflectionsSeen[k] = true;
  } catch(e){}
  if (!sb || !currentUser) return;
  const { data, error } = await fetchOnce('reflections', () => sb.from('ritual_reflections')
    .select('missed_on, time_of_day')
    .gte('missed_on', shiftDateStr(localDateStr(), -14)));
  if (error){ forgetFetch('reflections'); console.warn('reflections:', error.message); return; }   // the device still remembers
  for (const r of data || []) reflectionsSeen[`${r.missed_on}|${r.time_of_day}`] = true;
}

/* Yesterday only, and only a ritual that had habits in it to miss. Asking about
   a week ago is asking someone to remember a Tuesday, and asking about an empty
   list is asking about nothing. */
function reflectionDue(){
  const y = shiftDateStr(localDateStr(), -1);
  for (const time of ['morning', 'night']){
    if (!habitsCache.some(h => h.time_of_day === time)) continue;
    if (reflectionsSeen[`${y}|${time}`]) continue;
    if (routineHeld(time, y)) continue;          // kept, or bridged by a grace day
    return { time, date: y };
  }
  return null;
}
