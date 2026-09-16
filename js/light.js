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

let light = { lifetime: 0, today: 0, loaded: false };
/* What has already been paid for today. The ledger is the only record of some
   of these — a subliminal played leaves no other trace — so the Journey reads
   its state from here rather than keeping a second copy that could disagree. */
let lightToday = new Set();

async function loadLight(){
  if (!sb || !currentUser) return;
  const { data, error } = await sb.rpc('my_light', { p_on: localDateStr() });
  if (error){ console.warn('light:', error.message); return; }   // migration not run yet
  const row = Array.isArray(data) ? data[0] : data;
  light = { lifetime: Number(row && row.lifetime || 0), today: Number(row && row.today || 0), loaded: true };
  const { data: rows } = await sb.from('light_ledger')
    .select('source').eq('user_id', currentUser.id).eq('earned_on', localDateStr());
  lightToday = new Set((rows || []).map(r => r.source));
}

/* Ask for Light and show it only if it was actually granted. `near` is the
   element the mark drifts away from, so the credit appears where the thing you
   just did is, rather than somewhere you aren't looking. */
async function awardLight(source, ref, near){
  if (!sb || !currentUser) return 0;
  const { data, error } = await sb.rpc('award_light', {
    p_source: source, p_ref: ref || '', p_on: localDateStr(),
  });
  if (error){ console.warn('light:', error.message); return 0; }
  const amount = Number(data || 0);
  if (!amount) return 0;                    // already paid for today
  light.lifetime += amount; light.today += amount; lightToday.add(source);
  showLightMark(amount, near);
  renderLightStrip();
  return amount;
}

/* A small mark that lifts and fades. Not a celebration — you get one of these
   for remembering to drink water. */
function showLightMark(amount, near){
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

function renderLightStrip(){
  const el = document.getElementById('lightStrip');
  if (!el) return;
  const lv = levelFor(light.lifetime);
  const streak = routineStreak(currentRitualTime());
  el.innerHTML = `
    ${streak > 1 ? `<span class="ls-item" title="${streak} days of practice"><b>${streak}</b> day${streak === 1 ? '' : 's'}</span>` : ''}
    <span class="ls-item ls-light" title="${light.lifetime.toLocaleString()} Light earned in total">✦ <b>${light.lifetime.toLocaleString()}</b></span>
    <span class="ls-item ls-level">${lv.name}</span>
    <span class="ls-bar" role="img" aria-label="${lv.next ? `${lv.toNext} Light until ${lv.next}` : 'Higher Self reached'}"><i style="width:${Math.round(lv.pct * 100)}%"></i></span>`;
  el.style.display = 'flex';
  const note = document.getElementById('lightNote');
  if (note) note.textContent = lv.next ? `${lv.toNext.toLocaleString()} Light until ${lv.next}` : 'You have reached Higher Self.';
}

