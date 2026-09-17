/* light.js — Light, and the ten Higher Self levels

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- Light ----------
   Light is earned by doing the practice. The amounts and the once-a-day rule
   both live in the database (award_light), not here — this side asks for a
   payment and is told what it got, which is 0 when it had already been paid.
   These names are the contract with light_value(); don't rename one without
   the migration. */
const LIGHT_SOURCES = {
  habit:           'habit',
  morningRitual:   'ritual_morning',
  nightRitual:     'ritual_night',
  journal:         'journal',
  subliminal:      'subliminal',
  nonNegotiables:  'non_negotiables',
  perfectDay:      'perfect_day',
  weekStreak:      'week_streak',
};

/* Ten levels, by lifetime Light. Derived rather than stored, so the curve can
   be rebalanced without touching anyone's record. */
const LEVELS = [
  { name:'Seed',         at:0    },
  { name:'Bloom',        at:200  },
  { name:'Becoming I',   at:500  },
  { name:'Becoming II',  at:800  },
  { name:'Becoming III', at:1200 },
  { name:'Aligned I',    at:1500 },
  { name:'Aligned II',   at:2100 },
  { name:'Aligned III',  at:2900 },
  { name:'Radiant',      at:5000 },
  { name:'Higher Self',  at:8000 },
];
function levelFor(lifetime){
  let i = 0;
  for (let n = 0; n < LEVELS.length; n++) if (lifetime >= LEVELS[n].at) i = n;
  const next = LEVELS[i + 1] || null;
  return {
    index: i, name: LEVELS[i].name, at: LEVELS[i].at,
    next: next && next.name, nextAt: next && next.at,
    toNext: next ? next.at - lifetime : 0,
    // Progress through this level, not through the whole ladder.
    pct: next ? Math.max(0, Math.min(1, (lifetime - LEVELS[i].at) / (next.at - LEVELS[i].at))) : 1,
  };
}

/* The points are off. Kyla's reason is the right one: a number that goes up
   makes a day you missed into a number that did not, and the app should not be
   another place that keeps score of you.

   Hidden, not deleted. award_light still records every session and every habit,
   so the history is intact and turning this back on is one line -- nothing has
   to be re-earned. The streak stays, because "you have been here eight days" is
   a fact about your practice rather than a score. */
const POINTS_VISIBLE = false;

let light = { lifetime: 0, today: 0, loaded: false };
/* What has already been paid for today. The ledger is the only record of some
   of these — a subliminal played leaves no other trace — so the Journey reads
   its state from here rather than keeping a second copy that could disagree. */
let lightToday = new Set();
let lightByDate = {};          // 'YYYY-MM-DD' -> Set of sources earned that day

async function loadLight(){
  if (!sb || !currentUser) return;
  /* These two used to run one after the other, which made opening Today two
     round trips deep before anything else could start. Nothing in the second
     depends on the first, so they go together -- and the pair is remembered,
     because every page that draws a streak asks for them. */
  const [{ data, error }, { data: rows }] = await fetchOnce('light', () => Promise.all([
    sb.rpc('my_light', { p_on: localDateStr() }),
    sb.from('light_ledger')
      .select('source, earned_on').eq('user_id', currentUser.id)
      .gte('earned_on', shiftDateStr(localDateStr(), -92)),
  ]));
  if (error){ forgetFetch('light'); console.warn('light:', error.message); return; }   // migration not run yet
  const row = Array.isArray(data) ? data[0] : data;
  light = { lifetime: Number(row && row.lifetime || 0), today: Number(row && row.today || 0), loaded: true };
  // The last three months by day, not just today: the calendar has to be able
  // to say a session was played on a Tuesday in August, and nothing else
  // remembers that.
  lightByDate = {};
  for (const r of rows || []){
    (lightByDate[r.earned_on] = lightByDate[r.earned_on] || new Set()).add(r.source);
  }
  lightToday = lightByDate[localDateStr()] || new Set();
}

/* Ask for Light and show it only if it was actually granted. `near` is the
   element the mark drifts away from, so the credit appears where the thing you
   just did is, rather than somewhere you aren't looking. */
async function awardLight(source, ref, near){
  if (!sb || !currentUser) return 0;
  forgetFetch('light');   // the balance is about to change
  const { data, error } = await sb.rpc('award_light', {
    p_source: source, p_ref: ref || '', p_on: localDateStr(),
  });
  if (error){ console.warn('light:', error.message); return 0; }
  const amount = Number(data || 0);
  if (!amount) return 0;                    // already paid for today
  light.lifetime += amount; light.today += amount;
  lightToday.add(source);
  const d = localDateStr();
  (lightByDate[d] = lightByDate[d] || new Set()).add(source);
  showLightMark(amount, near);
  renderLightStrip();
  return amount;
}

/* A small mark that lifts and fades. Not a celebration — you get one of these
   for remembering to drink water. */
function showLightMark(amount, near){
  if (!POINTS_VISIBLE) return;
  const host = near && near.getBoundingClientRect ? near : document.getElementById('lightStrip');
  if (!host || !host.getBoundingClientRect) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = host.getBoundingClientRect();
  const mark = document.createElement('span');
  mark.className = 'light-mark';
  mark.textContent = `+${amount} ✦`;
  mark.style.left = (r.left + r.width / 2) + 'px';
  mark.style.top = (r.top + r.height / 2) + 'px';
  document.body.appendChild(mark);
  mark.addEventListener('animationend', () => mark.remove());
}

async function acceptGraceDay(time, dateStr){
  const ok = await useGraceDay(time, dateStr);
  if (!ok) return;
  renderLightStrip();
  if (typeof renderHigherSelfCard === 'function') renderHigherSelfCard();
  if (typeof renderTodayRitual === 'function') renderTodayRitual();
}

function renderLightStrip(){
  const el = document.getElementById('lightStrip');
  if (!el) return;
  const time = currentRitualTime();
  const streak = routineStreak(time);
  const note = document.getElementById('lightNote');

  if (!POINTS_VISIBLE){
    // Only the streak, and only once it is a run rather than a single day.
    el.innerHTML = streak > 1
      ? `<span class="ls-item" title="${streak} days of practice"><b>${streak}</b> day${streak === 1 ? '' : 's'}</span>`
      : '';
    el.style.display = streak > 1 ? 'flex' : 'none';
    if (note){
      /* A grace day is still offered -- that is the opposite of scorekeeping:
         it exists so one hard day does not undo a run. */
      const offer = (typeof graceOffer === 'function') ? graceOffer(time) : null;
      note.innerHTML = offer
        ? `Yesterday was missed. <button type="button" class="grace-offer" onclick="acceptGraceDay('${offer.time}','${offer.date}')">Use a grace day</button> to hold the ${offer.saves} behind it — you have ${graceDays}.`
        : '';
    }
    return;
  }

  const lv = levelFor(light.lifetime);
  const con = (typeof consistency === 'function') ? consistency(30) : null;
  el.innerHTML = `
    ${streak > 1 ? `<span class="ls-item" title="${streak} days of practice"><b>${streak}</b> day${streak === 1 ? '' : 's'}</span>` : ''}
    ${con && con.days ? `<span class="ls-item ls-con" title="${con.days} practice days in the last 30"><b>${con.days}</b>/30</span>` : ''}
    <span class="ls-item ls-light" title="${light.lifetime.toLocaleString()} Light earned in total">✦ <b>${light.lifetime.toLocaleString()}</b></span>
    <span class="ls-item ls-level">${lv.name}</span>
    <span class="ls-bar" role="img" aria-label="${lv.next ? `${lv.toNext} Light until ${lv.next}` : 'Higher Self reached'}"><i style="width:${Math.round(lv.pct * 100)}%"></i></span>`;
  el.style.display = 'flex';
  if (!note) return;
  const offer = (typeof graceOffer === 'function') ? graceOffer(time) : null;
  if (offer){
    note.innerHTML = `Yesterday was missed. <button type="button" class="grace-offer" onclick="acceptGraceDay('${offer.time}','${offer.date}')">Use a grace day</button> to hold the ${offer.saves} behind it — you have ${graceDays}.`;
    return;
  }
  note.textContent = lv.next ? `${lv.toNext.toLocaleString()} Light until ${lv.next}` : 'You have reached Higher Self.';
}
