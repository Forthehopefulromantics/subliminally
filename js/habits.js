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
/* Morning and night are the two ends of a day. Anytime is for the habits that
   do not belong to either -- water, a walk, a page of a book -- and it is a
   third list rather than a flag on a habit, so a habit lives in exactly one
   place and takes exactly one space. */
const HABIT_TIMES = ['morning', 'night', 'anytime'];
const HABIT_TIME_LABEL = { morning:'Morning', night:'Night', anytime:'Anytime' };
let habitSlotsExpanded = { morning: false, night: false, anytime: false };
let habitIdeasOpen = { morning: false, night: false, anytime: false };

/* ---------- the practice cycle ----------
   Somebody who sets up the tracker through its own onboarding starts with room
   for three habits across all three lists, and earns three more spaces each
   time they finish a cycle, up to the fifteen the tracker has always had.

   A cycle is twenty-one days practised, counted from the day the routine was
   saved. Practised means any habit checked off that day. Three things it
   deliberately is not:

     - it is not twenty-one days in a row. Nothing here asks for consecutive
       days and nothing here ever will; a missed day is a day that was not
       counted, not a day that undoes the ones before it;
     - it does not expire. The count only goes up, so a cycle picked up again
       after a month away carries every day already practised;
     - it does not take anything back. Spaces earned stay earned, check-ins
       stay on record, and Light already awarded is never recalculated.

   The whole thing is derived from the check-ins that are already stored, so
   there is no second tally that can disagree with them -- only the start date
   is written down.

   Everyone who was using the tracker before this existed has no start date and
   keeps all fifteen spaces in each list, which is what they already had. The
   progression is part of the new setup, not something applied backwards to
   people who never saw it. */
const HABIT_CYCLE_DAYS = 21;
const HABIT_SPACES_AT_START = 3;
const HABIT_SPACES_PER_CYCLE = 3;
let habitCycleStart = null;        // 'YYYY-MM-DD', or null for everyone before this

/* Where the counting starts. The cycle is dated from the first day a ritual is
   really due -- see the habit tracker's setup -- which can be tomorrow, for a
   morning ritual built in the evening. A habit ticked tonight is still practice
   and still counts, so the count runs from whichever came first: the cycle's
   own start, or the day the habits were created. It never reaches back before
   the tracker existed. */
function habitCountingStart(){
  if (!habitCycleStart) return null;
  let first = null;
  for (const h of habitsCache){
    const d = habitStartDateStr(h);
    if (d && (!first || d < first)) first = d;
  }
  return first && first < habitCycleStart ? first : habitCycleStart;
}
/* Days with at least one habit checked, on or after the cycle start. A day with
   nothing on it is simply not counted -- it is never subtracted, and a day
   before the ritual existed is not one of these days at all. */
function habitPractiseDays(){
  const start = habitCountingStart();
  if (!start) return 0;
  return Object.keys(habitDoneByDate)
    .filter(d => d >= start && habitDoneByDate[d] && habitDoneByDate[d].size)
    .length;
}
function habitCyclesDone(){
  return habitCycleStart ? Math.floor(habitPractiseDays() / HABIT_CYCLE_DAYS) : 0;
}
/* Which day of the current cycle they are on, 1-based, for "Day 4 of 21". */
function habitCycleDay(){
  if (!habitCycleStart) return null;
  return (habitPractiseDays() % HABIT_CYCLE_DAYS) + 1;
}
/* How many habits this person may hold in total, across all three lists.
   `null` means the old behaviour: fifteen in each list, no total. */
function habitSpacesTotal(){
  if (!habitCycleStart) return null;
  const earned = HABIT_SPACES_AT_START + HABIT_SPACES_PER_CYCLE * habitCyclesDone();
  // Never below what they already hold. If a habit was added some other way,
  // or these numbers are ever changed, nobody loses a habit over it.
  return Math.max(Math.min(earned, HABIT_SLOTS), habitsCache.length);
}
function habitSpacesLeft(){
  const total = habitSpacesTotal();
  if (total === null) return null;
  return Math.max(0, total - habitsCache.length);
}
/* What one list may hold: the total that is left plus what is already in it,
   or the flat fifteen for anyone not on the cycle. */
function habitSlotsFor(time){
  const total = habitSpacesTotal();
  if (total === null) return HABIT_SLOTS;
  return habitsCache.filter(h => h.time_of_day === time).length + habitSpacesLeft();
}
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
/* 'Read scripture' and 'Pray' used to sit in this list for everyone, which is
   both too specific for someone who does not pray and too vague for someone who
   does -- a Muslim reading this is not being offered Fajr, and an atheist is
   being offered something they have no use for. They come out of the shared
   list and arrive from the faith answer instead, in the words that faith uses.
   Someone who did not answer gets the shared list alone. */
const MORNING_HABIT_SUGGESTIONS = ['Meditate','Dance','Mirror work','Visualize your day','Practice presence','Go outside','Ground your feet','Journal','Read a book','Go on a walk','Listen to an audiobook','Eat breakfast'];
const NIGHT_HABIT_SUGGESTIONS = ['Turn off your phone','Shower','Red light therapy','Pick out an outfit for tomorrow','Write a to-do list for tomorrow','Wind down','Drink tea','Journal','Set an alarm','Read a book','Nighttime hygiene'];
/* The ones with no hour attached: done at some point, not at one end of the
   day. Kept separate rather than merging the two lists above, which would
   offer "set an alarm" to somebody filling in their afternoon. */
const ANYTIME_HABIT_SUGGESTIONS = ['Drink water','Go on a walk','Listen to a subliminal','Move your body','Read a page','Step outside','Eat something green','Text someone you love','Ten deep breaths','Tidy one surface'];
/* Two names for one habit -- "Meditate" from the shared list and "Meditation"
   from the faith answer -- read as two different suggestions and were offered
   side by side. Matched on a stem so the one the person's own answer chose is
   the one that shows. */
const HABIT_NAME_STEMS = [['meditat', 'meditation'], ['pray', 'prayer'], ['journal', 'journal']];
function habitSuggestionKey(name){
  const k = String(name).toLowerCase().replace(/[^a-z]/g, '');
  const stem = HABIT_NAME_STEMS.find(([s]) => k.includes(s));
  return stem ? stem[1] : k;
}
/* Journalling here means a physical journal, written by hand. The habit is
   completed by photographing the page -- see triggerHabitPageUpload() in
   journal.js, which puts it in the same private, per-user daily-log bucket the
   calendar already uses. Nobody is asked to type their journal into the app,
   and nothing about it is stored anywhere less private than that. */
function habitIsJournaling(h){
  return !!h && habitSuggestionKey(h.name) === 'journal';
}
/* Whatever the person's own answer offers goes first: it is the most specific
   thing we know about what their morning already looks like. */
function habitSuggestionsFor(time){
  const base = time === 'morning' ? MORNING_HABIT_SUGGESTIONS
             : time === 'anytime' ? ANYTIME_HABIT_SUGGESTIONS
             : NIGHT_HABIT_SUGGESTIONS;
  const faith = (typeof faithHabitIdeas === 'function') ? faithHabitIdeas(time) : [];
  /* The one habit that changes with the saved faith answer -- Prayer for a
     religion, Meditation for everyone else -- offered first, in the same words
     the tracker's own setup offers it in. Not guessed from anything else the
     person answered: see faithPrefersPrayer() in faith.js. */
  const practice = (typeof faithPracticeHabit === 'function' && time !== 'anytime') ? [faithPracticeHabit()] : [];
  const seen = new Set();
  return [...practice, ...faith, ...base].filter(s => {
    const k = habitSuggestionKey(s);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/* Habits show in the order you do them, not the order you typed them. Sorting
   client-side keeps working if sort_order hasn't been added yet, where every
   row reads as 0 and the list falls back to oldest-first. */
function sortHabitsCache(){
  habitsCache.sort((a, b) => {
    if (a.time_of_day !== b.time_of_day)
      return HABIT_TIMES.indexOf(a.time_of_day) - HABIT_TIMES.indexOf(b.time_of_day);
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
  await loadHabitCycle();
  habitCheckins = {};
  habitDoneByDate = {};
  (checkins || []).forEach(c => {
    (habitCheckins[c.habit_id] = habitCheckins[c.habit_id] || new Set()).add(c.done_on);
    (habitDoneByDate[c.done_on] = habitDoneByDate[c.done_on] || new Set()).add(c.habit_id);
  });
  if (!silent) renderHabits();
}
/* The start date, off the profile row everything else already reads. The
   column arrives with 20261001; until it is run there is no start date, which
   is exactly how every account that predates the cycle reads anyway. */
async function loadHabitCycle(){
  if (!sb || !currentUser) return;
  const d = (await myProfile()) || {};
  habitCycleStart = d.habit_cycle_started_on || null;
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
/* Non-negotiables are what makes a *routine* count on a short night -- see
   routineStatusFor, which is only ever asked about morning and night. An
   anytime habit is not part of either, so marking one would decide nothing.
   The control is not offered there rather than offered and ignored. */
const HABIT_CORE_TIMES = ['morning', 'night'];
function habitTimeHasCore(time){ return HABIT_CORE_TIMES.includes(time); }
/* Kept because shortRoutinesUsedBy still counts them for the weekly report, but
   it no longer decides whether a day counts: doing your non-negotiables does
   that, every day of the week. See routineKept. */
const SHORT_ROUTINE_ALLOWANCE = 2;

/* Weeks run Monday to Sunday, so a rough Sunday night doesn't spend an
   allowance that a fresh week is about to hand back anyway. */
function weekStartStr(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dow = (new Date(y, m-1, d).getDay() + 6) % 7;   // Monday = 0
  return shiftDateStr(dateStr, -dow);
}

/* ---------- occurrences: did this ritual exist on this day at all ----------
   A ritual you set up this evening was never going to happen this morning, and
   a day with no check-in on it is not the same thing as a day you let go. The
   tracker used to treat them as the same: every date was measured against the
   habits you hold *now*, so the morning after somebody built their first
   routine -- and, on the very first evening, the morning that had already
   passed before they signed up -- came back as a missed ritual, complete with
   the reflection asking what got in the way of something that did not exist.

   So an occurrence is worked out before anything is judged. For one ritual on
   one day it can be:

     not applicable - the ritual did not exist yet on that day, or the day is
                      not one of its days. Nothing to keep and nothing to miss
     upcoming       - the day has not arrived
     open           - the day is here and the window is still open
     missed         - the window closed and nothing was checked off
     kept           - something was checked off (partial, essentials or full)

   Everything below reads a day in the person's own timezone. Timestamps are
   stored as they always were; it is only the question "which local day was
   that, and had its window closed yet" that is answered here. */

/* When a ritual's window closes, as an hour of its own local day. Morning ends
   at midday -- a morning ritual is not still open at four in the afternoon --
   and the other two run to the end of the day. 24 is midnight at the end of
   this day, which is what `new Date(y, m, d, 24)` means.

   Nothing here decides when a habit may be *ticked*. A day can always be filled
   in later, from the calendar or from Today; the window only decides when an
   untouched occurrence has definitely gone by. */
const RITUAL_WINDOW_END_HOUR = { morning: 12, night: 24, anytime: 24 };

function ritualWindowEnd(time, dateStr){
  const [y, m, d] = dateStr.split('-').map(Number);
  const h = RITUAL_WINDOW_END_HOUR[time] == null ? 24 : RITUAL_WINDOW_END_HOUR[time];
  return new Date(y, m - 1, d, h, 0, 0, 0);
}
/* Has this occurrence's window closed for good? Local clock against a local
   window -- never UTC, or somebody west of Greenwich loses their evening. */
function ritualWindowPassed(time, dateStr){
  return new Date() >= ritualWindowEnd(time, dateStr);
}

/* The local calendar day a habit came into existence. `created_at` is stored in
   UTC; `new Date(...)` reads it back in whatever zone the person is in, which
   is the zone their morning actually happened in. Rows with no timestamp are
   from before this column existed and are treated as having always been there,
   so nobody's history is rewritten by this change. */
function habitCreatedAt(h){
  if (!h || !h.created_at) return null;
  const t = new Date(h.created_at);
  return isNaN(t.getTime()) ? null : t;
}
function habitStartDateStr(h){
  const t = habitCreatedAt(h);
  return t ? localDateStr(t) : null;
}
/* Is this one of the habit's days? `days_of_week` is 0=Sunday..6=Saturday and
   defaults to every day, so this is a no-op for everyone who has never edited
   a schedule -- and correct for anyone who has. */
function habitScheduledOn(h, dateStr){
  const days = h && h.days_of_week;
  if (!Array.isArray(days) || !days.length) return true;
  const [y, m, d] = dateStr.split('-').map(Number);
  return days.map(Number).includes(new Date(y, m - 1, d).getDay());
}
/* Did this habit exist for this day's occurrence?

   The day it was created is the only interesting case. If the window was still
   open when it was created, that day counts -- a night ritual built at seven in
   the evening still has its evening. If the window had already closed, it does
   not: the first occurrence is the next one. */
function habitExistedFor(h, dateStr){
  const start = habitStartDateStr(h);
  if (!start) return true;
  if (dateStr < start) return false;
  if (dateStr > start) return true;
  return habitCreatedAt(h) < ritualWindowEnd(h.time_of_day, dateStr);
}
function habitCheckedOn(h, dateStr){
  const days = habitCheckins[h.id];
  return !!(days && days.has(dateStr));
}
/* A habit is part of a day's ritual if it existed for that day and that day is
   one of its days. */
function habitAppliesOn(h, dateStr){
  return habitExistedFor(h, dateStr) && habitScheduledOn(h, dateStr);
}

/* The habits one ritual was made of on one day.

   Today is always the full list: the day is in front of you and anything on it
   can still be done, including a habit added ten minutes ago whose window has
   technically gone. A tick always counts too, whatever day it is on -- somebody
   who checked something off has said what happened, and no rule here gets to
   overrule them. */
function ritualRowsFor(time, dateStr){
  const today = localDateStr();
  return habitsCache.filter(h => {
    if (h.time_of_day !== time) return false;
    if (habitCheckedOn(h, dateStr)) return true;
    if (dateStr === today) return habitScheduledOn(h, dateStr);
    return habitAppliesOn(h, dateStr);
  });
}
/* Was there a real occurrence of this ritual on this day -- something that
   could have been kept or missed? This is the question the whole bug turned
   on, and it is asked before any day is called missed. */
function ritualApplies(time, dateStr){
  return habitsCache.some(h => h.time_of_day === time && habitAppliesOn(h, dateStr));
}

/* The first day a habit can really be asked about: the day it was created if
   its window was still open, otherwise the next one, and then forward to the
   next day the schedule allows. */
function ritualFirstOccurrenceFrom(time, at){
  const when = at || new Date();
  const day = localDateStr(when);
  return when < ritualWindowEnd(time, day) ? day : shiftDateStr(day, 1);
}
function habitFirstOccurrence(h){
  const created = habitCreatedAt(h);
  if (!created) return null;
  let d = ritualFirstOccurrenceFrom(h.time_of_day, created);
  for (let i = 0; i < 7 && !habitScheduledOn(h, d); i++) d = shiftDateStr(d, 1);
  return d;
}
/* The first day this ritual -- or the tracker as a whole -- was ever due.
   Nothing before it is counted, offered, or asked about. */
function ritualStartDate(time){
  let first = null;
  for (const h of habitsCache){
    if (time && h.time_of_day !== time) continue;
    const d = habitFirstOccurrence(h);
    if (d && (!first || d < first)) first = d;
  }
  return first;
}
function habitTrackerStart(){ return ritualStartDate(null); }

/* How one routine went on one day:
     none       - nothing on this list at all
     na         - no occurrence: the ritual did not exist yet, or it is not one
                  of its days. Not kept, not missed, not counted
     upcoming   - the day has not arrived
     full       - everything on the list
     essentials - every non-negotiable, but not the whole list
     partial    - something, but not all the non-negotiables
     open       - nothing yet, and the window has not closed
     missed     - nothing, and the window has closed

   `missed` is now the end of a chain rather than the default: it is only
   reached once the ritual existed for this day, this day was one of its days,
   and its window has gone by. A missing check-in on its own says nothing. */
function routineStatusFor(time, dateStr){
  const rows = ritualRowsFor(time, dateStr);
  const done = habitDoneByDate[dateStr] || new Set();
  const core = rows.filter(h => h.is_core);
  const coreDone = core.filter(h => done.has(h.id)).length;
  const allDone = rows.filter(h => done.has(h.id)).length;
  const applies = ritualApplies(time, dateStr);
  const windowPassed = ritualWindowPassed(time, dateStr);
  let state;
  if (!rows.length) state = habitsCache.some(h => h.time_of_day === time) ? 'na' : 'none';
  else if (allDone === rows.length) state = 'full';
  else if (core.length && coreDone === core.length) state = 'essentials';
  else if (allDone > 0) state = 'partial';
  else if (dateStr > localDateStr()) state = 'upcoming';
  else if (!applies) state = 'na';
  else if (!windowPassed) state = 'open';
  else state = 'missed';
  return { state, done: allDone, total: rows.length, coreDone, coreTotal: core.length,
           applies, windowPassed };
}

/* The one question everything else asks: was this a real occurrence that went
   by unkept? Four things have to be true, and "there is no check-in" is only
   the last of them. */
function routineMissed(time, dateStr){
  if (dateStr > localDateStr()) return false;          // has not happened yet
  if (!ritualApplies(time, dateStr)) return false;     // the ritual did not exist for this day
  if (!ritualWindowPassed(time, dateStr)) return false;// still open
  return !routineHeld(time, dateStr);                  // kept, bridged or won back?
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

/* Did this day keep the ritual? Your non-negotiables did it.

   This used to also require the short routine to be inside a weekly allowance,
   so keeping your non-negotiables on a third bad night in one week counted for
   nothing -- which is the opposite of what a non-negotiable is for. You named
   the few you would do on your worst day; doing them is the bar, and it is the
   bar every day of the week.

   With no non-negotiables named, the whole list is the bar, because there is
   nothing else it could be. */
function routineKept(time, dateStr){
  const st = routineStatusFor(time, dateStr);
  if (st.state === 'none' || st.state === 'na') return false;   // nothing was due
  if (st.state === 'upcoming') return false;
  if (!st.coreTotal) return st.state === 'full';
  return st.coreDone === st.coreTotal;
}

/* ---------- winning it back ----------
   A missed day is forgiven if you do the *entire* ritual the next day. Not the
   non-negotiables -- those are the everyday bar, and bridging a miss should
   cost more than an ordinary day does. So the day after a miss, the full list
   puts the run behind it back.

   One day, one bridge: two misses in a row cannot both be covered by a single
   full day, because only the day immediately after a miss is looked at. */
function redeemedByFullRitual(time, dateStr){
  const next = shiftDateStr(dateStr, 1);
  if (next > localDateStr()) return false;              // tomorrow has not happened
  if (!ritualApplies(time, dateStr)) return false;      // nothing was due: nothing to win back
  return routineStatusFor(time, next).state === 'full';
}

/* Days kept in a row, walking back from `dateStr`. A day with no occurrence on
   it -- before the ritual existed, or a day the schedule leaves out -- is
   stepped over rather than ending the count: there was nothing there to break.
   The walk stops at the first day the ritual was ever due, so it always ends.

   Kept is the only thing that counts. A bridged day -- one a Grace Day covered,
   or one won back by doing the whole ritual the next morning -- keeps the run
   alive without being a day of practice, because nothing was practised on it.
   Counting it was where the tracker's phantom day came from: finish your first
   full morning and the day before it, which you had never done anything on,
   was counted alongside it, so one day of practice read as "2 days" on Today.
   Nobody's record changes here -- every check-in is exactly where it was; only
   a day nothing happened on has stopped being counted as one that did. */
function runBehind(time, dateStr){
  /* Rows saved before `created_at` was recorded have no first day to stop at,
     so the walk is bounded by the check-ins that are loaded at all (400 days).
     Without a floor this would run backwards forever. */
  const start = ritualStartDate(time) || shiftDateStr(localDateStr(), -400);
  let n = 0, cursor = dateStr;
  while (start && cursor >= start){
    if (!ritualApplies(time, cursor)){ cursor = shiftDateStr(cursor, -1); continue; }
    if (!routineHeld(time, cursor)) break;              // a real occurrence, not kept
    if (routineKept(time, cursor)) n++;                 // bridged days hold the run, they don't add to it
    cursor = shiftDateStr(cursor, -1);
  }
  return n;
}
/* What you would have to do today to get yesterday back, or null if there is
   nothing to get back. */
function comebackOffer(time){
  const yesterday = shiftDateStr(localDateStr(), -1);
  // Only a day that was really missed can be won back. A day the ritual did not
  // exist for is not a debt, so there is nothing to offer.
  if (!routineMissed(time, yesterday) && !routineKept(time, yesterday)) return null;
  if (routineKept(time, yesterday) || graceBridged(time, yesterday)) return null;
  const st = routineStatusFor(time, localDateStr());
  if (st.state === 'none' || st.state === 'na') return null;   // no ritual to complete today
  const behind = runBehind(time, shiftDateStr(yesterday, -1));
  if (!behind) return null;                             // nothing behind it to save
  return { time, date: yesterday, saves: behind, done: st.done, total: st.total,
           alreadyBack: st.state === 'full' };
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
  return routineKept(time, dateStr) || graceBridged(time, dateStr)
      || redeemedByFullRitual(time, dateStr);
}

function routineStreak(time){
  let cursor = localDateStr();
  // Today not being done yet shouldn't read as the streak already being over.
  if (!routineHeld(time, cursor)) cursor = shiftDateStr(cursor, -1);
  // runBehind steps over the days that had no occurrence on them, so a run
  // cannot be ended by a day the ritual was never due.
  return runBehind(time, cursor);
}

/* Whether yesterday is the one thing standing between you and your old streak.
   Offered rather than taken: spending someone's Grace Day without telling them
   is worse than letting the number reset. */
function graceOffer(time){
  if (graceDays < 1) return null;
  const yesterday = shiftDateStr(localDateStr(), -1);
  if (!routineMissed(time, yesterday)) return null;        // nothing to bridge
  const n = runBehind(time, shiftDateStr(yesterday, -1));
  if (!n) return null;                                     // nothing behind it to save
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
  const asked = days || 30;
  /* Only days the tracker was actually here for. Counting somebody's first
     week against thirty days shows them 23% for a week they kept perfectly --
     the days before they arrived are not days they let go. */
  const start = habitTrackerStart();
  let span = asked;
  if (start){
    let back = 0;
    while (back < asked && shiftDateStr(localDateStr(), -back) >= start) back++;
    span = Math.max(1, back);
  }
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

/* Share of that day's habits that got checked off, 0–1, measured against the
   habits that day actually had. `null` means the day had none -- which is not
   the same as nought per cent, and is drawn as nothing rather than as a failure.

   It used to be measured against the habits you keep now, which quietly
   rewrote history in both directions: a day kept perfectly slid to two-thirds
   the moment a fourth habit was added weeks later, and every day before the
   tracker existed read as 0%. */
function habitCompletionFor(dateStr){
  const rows = habitsOnDate(dateStr);
  if (!rows.length) return null;           // nothing was due — not 0%
  const done = habitDoneByDate[dateStr] || new Set();
  return rows.filter(h => done.has(h.id)).length / rows.length;
}
/* Every habit that belonged to a day, across all three lists. The denominator
   for that day's percentage, and the count the calendar and the day modal read,
   so a day before the ritual existed is never scored out of habits it never
   had. */
function habitsOnDate(dateStr){
  return HABIT_TIMES.reduce((rows, t) => rows.concat(ritualRowsFor(t, dateStr)), []);
}
/* The three lists were two when the markup was written, so the ids read
   habitListMorning and habitListNight rather than being indexed by the value
   stored on the row. Anytime follows the same shape. */
function habitElId(prefix, time){ return prefix + time[0].toUpperCase() + time.slice(1); }

/* What "full" means depends on whether this person is on the cycle. Saying
   "15 of 15" to somebody holding three of three would be a lie, and saying
   "you have earned no more" to somebody who was here before the cycle existed
   would be a different one. */
function habitFullText(spacesTotal, inThisList){
  if (spacesTotal === null) return `${HABIT_SLOTS} of ${HABIT_SLOTS} — this ritual is full.`;
  if (spacesTotal >= HABIT_SLOTS) return `${spacesTotal} of ${HABIT_SLOTS} — every space earned.`;
  const left = HABIT_CYCLE_DAYS - ((habitCycleDay() || 1) - 1);
  return `${habitsCache.length} of ${spacesTotal} spaces used · ${HABIT_SPACES_PER_CYCLE} more after this cycle`
    + (left > 0 ? ` (${left} day${left === 1 ? '' : 's'} of practice to go)` : '');
}

function renderHabits(){
  const today = localDateStr();
  const week = Array.from({ length: 7 }, (_, i) => shiftDateStr(today, i - 6));
  let doneToday = 0;
  const spacesTotal = habitSpacesTotal();
  HABIT_TIMES.forEach(time => {
    const cap = habitSlotsFor(time);
    const rows = habitsCache.filter(h => h.time_of_day === time);
    const list = document.getElementById(habitElId('habitList', time));
    const count = document.getElementById(habitElId('habitCount', time));
    const suggestWrap = document.getElementById(habitElId('habitSuggest', time));
    if (!list || !count) return;
    const done = rows.filter(h => (habitCheckins[h.id] || new Set()).has(today)).length;
    doneToday += done;
    const coreCount = rows.filter(h => h.is_core).length;
    const streakHere = routineStreak(time);
    count.textContent = rows.length
      ? `${done} of ${rows.length} today`
        + (habitTimeHasCore(time) ? ` · ${coreCount}/${CORE_HABIT_MAX} non-negotiable` : '')
        + (streakHere > 1 ? ` · ${streakHere}-day streak` : '')
      : `0/${cap} added`;

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
          <label class="habit-mins${h.duration_minutes ? ' set' : ''}" title="How long this usually takes. Leave it blank if it varies.">
            <input type="text" inputmode="numeric" value="${h.duration_minutes || ''}" placeholder="–" maxlength="3"
              aria-label="Minutes ${safeName} usually takes"
              onkeydown="if(event.key==='Enter') this.blur();"
              onblur="setHabitDuration('${h.id}', this.value)"><span aria-hidden="true">m</span>
          </label>
          ${habitIsJournaling(h) ? `<button class="habit-page-btn" onclick="triggerHabitPageUpload('${h.id}')"
            title="Write in your physical journal, then upload a photo of your entry to complete this habit"
            aria-label="Upload a photo of today's journal page for ${safeName}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>` : ''}
          ${habitTimeHasCore(time) ? `<button class="habit-core-toggle${h.is_core ? ' on' : ''}" onclick="toggleCoreHabit('${h.id}')"
            aria-pressed="${h.is_core ? 'true' : 'false'}"
            title="${h.is_core ? 'A non-negotiable — tap to unmark' : 'Mark as non-negotiable'}"
            aria-label="${h.is_core ? 'Unmark' : 'Mark'} ${safeName} as non-negotiable">✦</button>` : ''}
          <button class="habit-delete" onclick="deleteHabit('${h.id}')" aria-label="Remove ${safeName}" title="Remove">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');

    // Matched the same way the suggestions are de-duplicated, so a list that
    // already has "Meditate" on it is not offered "Meditation" underneath.
    const already = new Set(rows.map(h => habitSuggestionKey(h.name)));
    const pool = habitSuggestionsFor(time).filter(s => !already.has(habitSuggestionKey(s)));
    // All 15 slots are there, but showing 15 empty boxes at once reads as a
    // chore list. Offer a few at a time and let people ask for the rest.
    const remaining = Math.max(0, cap - rows.length);
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
    const coreHint = habitTimeHasCore(time) && rows.length && !rows.some(h => h.is_core)
      ? `<p class="habit-core-hint">Tap ✦ on the few you'd still do on your worst day. Doing just those counts as keeping the ritual — twice a week.</p>`
      : '';
    /* Said where the habit is, because "journal" on its own reads as something
       you type into the app, and it isn't. */
    const journalHint = rows.some(habitIsJournaling)
      ? `<p class="habit-core-hint">Journal — write in your physical journal, then upload a photo of your entry to complete this habit. Nothing is typed in here.</p>`
      : '';
    list.innerHTML = coreHint + journalHint + realRowsHtml + blankRowsHtml + moreSlotsHtml;

    if (suggestWrap){
      suggestWrap.innerHTML = rows.length >= cap
        ? `<span class="habit-suggest-full">${habitFullText(spacesTotal, rows.length)}</span>`
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
  const kept = HABIT_TIMES
    .filter(t => habitsCache.some(h => h.time_of_day === t && h.is_core))
    .map(t => ({ t, n: routineStreak(t) }))
    .filter(x => x.n > 1)
    .map(x => `${x.n}-day ${x.t} streak`);
  const streakText = kept.length ? ` · ${kept.join(' · ')}`
    : practiceStreak > 1 ? ` · ${practiceStreak}-day practice streak` : '';
  stat.style.display = 'block';
  // Measured against what today actually asks for, which is the whole list
  // unless a habit's schedule leaves today out.
  const dueToday = habitsOnDate(localDateStr()).length;
  stat.textContent = dueToday && doneToday === dueToday
    ? `✦ Every ritual done today${streakText}`
    : `${doneToday} of ${dueToday} done today${streakText}`;
}
async function addHabit(time, name){
  if (!sb || !currentUser) return;
  name = (name || '').trim();
  if (!name) return;
  if (habitsCache.filter(h => h.time_of_day === time).length >= habitSlotsFor(time)) return;
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
    const rows = ritualRowsFor(time, dateStr);
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
    const rows = ritualRowsFor(t, dateStr);
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

/* ---------- how long it takes ----------
   Minutes, or nothing. Nothing is the honest default: plenty of habits do not
   have a length, and a number invented to fill the box is worse than a blank.
   Stored so it can be read back and shown -- not used to time anything, not
   used to nag, and not part of whether a day counted. */
const HABIT_MINUTES_MAX = 600;      // the database check agrees: 1..600
/* parseInt on the trimmed string, not the digits pulled out of it: stripping
   non-digits turns "12.5" into a hundred and twenty-five minutes and "-30"
   into half an hour. Reading left to right and stopping at the first thing
   that is not a digit gives 12 and nothing, which is what was meant. */
function habitMinutes(value){
  const n = parseInt(String(value == null ? '' : value).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, HABIT_MINUTES_MAX);
}
async function setHabitDuration(habitId, value){
  const mins = habitMinutes(value);
  const h = habitsCache.find(x => x.id === habitId);
  if (!h || h.duration_minutes === mins) return;      // a blur that changed nothing is not a write
  h.duration_minutes = mins;
  repaintHabitLists();
  if (!sb || !currentUser) return;
  const { error } = await sb.from('habits').update({ duration_minutes: mins })
    .eq('id', habitId).eq('user_id', currentUser.id);
  if (error) console.warn('habit duration:', error.message);
}

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
    if (reflectionsSeen[`${y}|${time}`]) continue;
    /* One question, and it is not "is there a check-in". A day is only asked
       about once it was a real occurrence -- the ritual existed for it, it was
       one of its days, and its window has closed -- and was not kept, bridged
       by a grace day, or won back. Somebody who set their ritual up last night
       is asked nothing this morning, because nothing of theirs went by. */
    if (!routineMissed(time, y)) continue;
    return { time, date: y };
  }
  return null;
}
