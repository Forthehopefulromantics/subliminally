#!/usr/bin/env node
/* ritual-state-test.js — what counts as a missed ritual, and what does not

   Not part of the site: scripts/ is excluded from the deploy and from what the
   native apps bundle. It loads the real js/dates.js and js/habits.js into a
   sandbox, freezes the clock, and asks the ritual state model the questions
   somebody's first day asks it.

   The bug it pins: a ritual created on Saturday evening used to come back as
   Saturday's *missed* morning ritual, because a day with no check-in on it was
   read as a day that was let go. A day before the ritual existed is not a day
   anybody missed.

     npm run test:rituals
     TZ=Pacific/Kiritimati node scripts/ritual-state-test.js

   Run it under a few zones. Every date here is the person's own local day, and
   a model that only works in UTC is the other half of this bug. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');

const ctx = {
  console,
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], body: { getAttribute: () => '' },
              addEventListener(){}, removeEventListener(){} },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  window: {}, navigator: {}, setTimeout, clearTimeout, Date, Math, JSON, Set, Object, Array,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['js/dates.js', 'js/habits.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

// --- the world the bug happened in ---------------------------------------
// "I created my morning ritual approximately 5 minutes ago" — Saturday 7:03 PM.
const SAT = '2026-09-19', SUN = '2026-09-20', MON = '2026-09-21';
const createdSatEvening = new Date(2026, 8, 19, 19, 3, 0);   // local Saturday 7:03 PM

function setUp(habits, checkins, nowIso){
  // habits.js declares these with `let`, so they live in the context's lexical
  // scope and can't be reached by setting a property on the global object.
  const byHabit = {}, byDate = {};
  for (const [habitId, days] of Object.entries(checkins || {}))
    for (const d of days){
      (byHabit[habitId] = byHabit[habitId] || []).push(d);
      (byDate[d] = byDate[d] || []).push(habitId);
    }
  ctx.__in = { habits, byHabit, byDate };
  vm.runInContext(`
    habitsCache = __in.habits;
    habitCheckins = {}; habitDoneByDate = {};
    for (const k of Object.keys(__in.byHabit)) habitCheckins[k] = new Set(__in.byHabit[k]);
    for (const k of Object.keys(__in.byDate)) habitDoneByDate[k] = new Set(__in.byDate[k]);
    graceDays = 0; graceUsed = new Set(); reflectionsSeen = {}; habitCycleStart = null;
  `, ctx);
  // Freeze "now"
  const Real = Date;
  class Frozen extends Real {
    constructor(...a){ return a.length ? new Real(...a) : new Real(nowIso); }
    static now(){ return new Real(nowIso).getTime(); }
  }
  ctx.Date = Frozen;
}
const morning = { id:'m1', time_of_day:'morning', is_core:false, created_at: createdSatEvening.toISOString() };
const night   = { id:'n1', time_of_day:'night',   is_core:false, created_at: createdSatEvening.toISOString() };

let failures = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(got)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
}

console.log(`\n== TZ ${Intl.DateTimeFormat().resolvedOptions().timeZone} ==`);

// 1. Five minutes after creating a morning ritual on Saturday evening.
setUp([morning], {}, new Date(2026, 8, 19, 19, 8, 0));
check('Sat 7:08pm — Saturday morning state', ctx.routineStatusFor('morning', SAT).state, 'na');
check('Sat 7:08pm — Saturday morning missed?', ctx.routineMissed('morning', SAT), false);
check('Sat 7:08pm — first occurrence is Sunday', ctx.habitFirstOccurrence(morning), SUN);
check('Sat 7:08pm — reflection due?', ctx.reflectionDue(), null);
check('Sat 7:08pm — streak', ctx.routineStreak('morning'), 0);

// 2. Sunday morning: available, not missed, still no reflection about Saturday.
setUp([morning], {}, new Date(2026, 8, 20, 8, 0, 0));
check('Sun 8am — Sunday morning state', ctx.routineStatusFor('morning', SUN).state, 'open');
check('Sun 8am — Saturday still not missed', ctx.routineMissed('morning', SAT), false);
check('Sun 8am — reflection due?', ctx.reflectionDue(), null);

// 3. Sunday evening, nothing logged: the window has closed → missed.
setUp([morning], {}, new Date(2026, 8, 20, 20, 0, 0));
check('Sun 8pm — Sunday morning state', ctx.routineStatusFor('morning', SUN).state, 'missed');
check('Sun 8pm — Sunday missed?', ctx.routineMissed('morning', SUN), true);
check('Sun 8pm — reflection still only asks about yesterday', ctx.reflectionDue(), null);

// 4. Monday: now the reflection may legitimately ask about Sunday.
setUp([morning], {}, new Date(2026, 8, 21, 9, 0, 0));
check('Mon 9am — reflection due', ctx.reflectionDue(), { time:'morning', date: SUN });

// 5. Sunday logged → Monday asks nothing.
setUp([morning], { m1:[SUN] }, new Date(2026, 8, 21, 9, 0, 0));
check('Mon 9am (Sunday kept) — reflection due?', ctx.reflectionDue(), null);
check('Mon 9am (Sunday kept) — streak', ctx.routineStreak('morning'), 1);

// 6. A night ritual created the same Saturday evening: tonight is still its own.
setUp([night], {}, new Date(2026, 8, 19, 19, 8, 0));
check('Sat 7:08pm — Saturday night state', ctx.routineStatusFor('night', SAT).state, 'open');
check('Sat 7:08pm — Saturday night first occurrence', ctx.habitFirstOccurrence(night), SAT);
check('Sat 7:08pm — Saturday night missed?', ctx.routineMissed('night', SAT), false);
// ...and on Sunday, an unkept Saturday night is a real miss.
setUp([night], {}, new Date(2026, 8, 20, 9, 0, 0));
check('Sun 9am — Saturday night missed?', ctx.routineMissed('night', SAT), true);
check('Sun 9am — reflection due', ctx.reflectionDue(), { time:'night', date: SAT });

// 7. Percentages and days before the ritual existed.
setUp([morning], {}, new Date(2026, 8, 20, 20, 0, 0));
check('completion % for the Friday before', ctx.habitCompletionFor('2026-09-18'), null);
check('habits on the Friday before', ctx.habitsOnDate('2026-09-18').length, 0);
check('30-day consistency span is days lived', ctx.consistency(30).of, 1);

// 8. A schedule that leaves a day out is not a missed day.
const weekdays = Object.assign({}, morning, { id:'w1', created_at: new Date(2026, 8, 1, 6, 0, 0).toISOString(),
                                              days_of_week: [1,2,3,4,5] });
setUp([weekdays], { w1:['2026-09-17','2026-09-18'] }, new Date(2026, 8, 21, 9, 0, 0));  // Mon
check('Sat (not a scheduled day) missed?', ctx.routineMissed('morning', SAT), false);
check('Sun (not a scheduled day) missed?', ctx.routineMissed('morning', SUN), false);
// Thu + Fri kept, and the Wednesday before is won back by Thursday's full
// ritual (the tracker's existing redemption rule), so the run reads 3.
check('streak survives the weekend', ctx.routineStreak('morning'), 3);
check('reflection due on Monday?', ctx.reflectionDue(), null);

// 9. An explicit tick always wins, even on a day the window had gone.
setUp([morning], { m1:[SAT] }, new Date(2026, 8, 20, 9, 0, 0));
check('Saturday ticked by hand — state', ctx.routineStatusFor('morning', SAT).state, 'full');
check('Saturday ticked by hand — missed?', ctx.routineMissed('morning', SAT), false);


// 10. Someone who has had the tracker for weeks is unaffected.
const oldMorning = { id:'o1', time_of_day:'morning', is_core:false,
                     created_at: new Date(2026, 7, 1, 6, 0, 0).toISOString() };
setUp([oldMorning], { o1:['2026-09-18'] }, new Date(2026, 8, 20, 9, 0, 0));   // Sunday
check('long-time user — Saturday really was missed', ctx.routineMissed('morning', SAT), true);
check('long-time user — reflection due', ctx.reflectionDue(), { time:'morning', date: SAT });
ctx.__set = () => {}; vm.runInContext('graceDays = 1;', ctx);
// Friday was kept, and Thursday is won back by Friday's full ritual, so the
// run a grace day would hold reads 2 — the tracker's existing redemption rule.
check('long-time user — grace offered for Saturday', ctx.graceOffer('morning'), { time:'morning', date: SAT, saves: 2 });

// 11. Day one: no grace day and no comeback offered for a day that never was.
setUp([morning], {}, new Date(2026, 8, 20, 9, 0, 0));
vm.runInContext('graceDays = 3;', ctx);
check('day one — grace offer', ctx.graceOffer('morning'), null);
check('day one — comeback offer', ctx.comebackOffer('morning'), null);

// 12. A row from before created_at was recorded is treated as always present.
const legacy = { id:'l1', time_of_day:'morning', is_core:false };
setUp([legacy], {}, new Date(2026, 8, 20, 9, 0, 0));
check('legacy row — Saturday missed?', ctx.routineMissed('morning', SAT), true);
setUp([legacy], { l1:[SAT, '2026-09-18'] }, new Date(2026, 8, 20, 9, 0, 0));
// Sat + Fri kept, plus the Thursday Friday's full ritual wins back.
check('legacy row — streak still counts', ctx.routineStreak('morning'), 3);

// 13. The 21-day cycle starts at the first real occurrence and skips nothing.
setUp([morning], { m1:[SUN, MON] }, new Date(2026, 8, 21, 21, 0, 0));
vm.runInContext(`habitCycleStart = '${SUN}';`, ctx);
check('cycle — practise days', ctx.habitPractiseDays(), 2);
check('cycle — day of 21', ctx.habitCycleDay(), 3);
check('cycle — Saturday (not applicable) not counted', ctx.habitPractiseDays(), 2);
// A habit ticked on the evening it was created still counts, even though the
// cycle's first morning is the next day.
setUp([morning], { m1:[SAT] }, new Date(2026, 8, 19, 21, 0, 0));
vm.runInContext(`habitCycleStart = '${SUN}';`, ctx);
check('cycle — the evening it was set up still counts', ctx.habitPractiseDays(), 1);

// 14. First occurrence from a moment, as the setup flow works it out.
check('setup 7:03pm — morning starts tomorrow',
  ctx.ritualFirstOccurrenceFrom('morning', new Date(2026, 8, 19, 19, 3, 0)), SUN);
check('setup 7:03pm — night starts tonight',
  ctx.ritualFirstOccurrenceFrom('night', new Date(2026, 8, 19, 19, 3, 0)), SAT);
check('setup 7:03pm — anytime starts today',
  ctx.ritualFirstOccurrenceFrom('anytime', new Date(2026, 8, 19, 19, 3, 0)), SAT);
check('setup 6:00am — morning starts today',
  ctx.ritualFirstOccurrenceFrom('morning', new Date(2026, 8, 19, 6, 0, 0)), SAT);

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
