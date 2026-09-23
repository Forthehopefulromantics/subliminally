/* sky.js — the day and night sky

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- day and night ----------
   The sky follows the clock on its own. Tapping the switch overrides it, but
   only until tomorrow — otherwise one tap at lunchtime leaves you on a blue
   sky at midnight with no obvious way back. */
const SKY_KEY = 'fthr_sky';
function skyByClock(){ return new Date().getHours() >= 6 && new Date().getHours() < 18 ? 'day' : 'night'; }
function skyOverride(){
  try {
    const raw = localStorage.getItem(SKY_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && o.date === localDateStr() && (o.mode === 'day' || o.mode === 'night')) ? o.mode : null;
  } catch(e){ return null; }
}
/* Light by default. It used to follow the clock, which meant the app was dark
   for most of the hours anyone opens it, and dark was never the decision — it
   was just what 6pm did. The switch still works, and still lasts until
   tomorrow. */
function currentSky(){ return skyOverride() || 'day'; }

const SUN_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z"/></svg>';

const CLOUD_SVG = `<svg viewBox="0 0 200 92" xmlns="http://www.w3.org/2000/svg">
  <path class="a" d="M22 90C8 90 0 80 0 68 0 55 10 46 23 49 25 30 42 19 59 26 68 7 93 3 108 16 119 3 142 4 150 19 171 13 189 26 187 47 197 51 202 64 197 76 193 87 182 90 172 90Z"/>
  <path class="b" d="M172 90H22c-8 0-14-3-18-8h186c-4 5-10 8-18 8Z" opacity=".45"/>
</svg>`;

/* Clouds at different depths — small and pale high up, bigger and slower near
   the horizon, so the sky reads as having depth rather than as a pattern. */
/* Opacities are lower than they were because there are now two clouds in each
   band rather than one, and the sky should weigh the same as the one Kyla
   drew -- twice the clouds at the old opacity is a different, heavier sky. */
const CLOUD_LAYERS = [
  { top:'3%',  w:'46%',  op:.38, dur:132, delay:-40 },
  { top:'12%', w:'70%',  op:.62, dur:104, delay:-88 },
  { top:'27%', w:'38%',  op:.33, dur:150, delay:-15 },
  { top:'41%', w:'86%',  op:.58, dur:118, delay:-70 },
  { top:'56%', w:'52%',  op:.38, dur:142, delay:-110 },
  /* Keep the lower half airy: the original illustrated clouds remain, but
     smaller/lighter so the blue sky reads all the way down the page. */
  { top:'72%', w:'72%',  op:.42, dur:112, delay:-30 },
  { top:'89%', w:'48%',  op:.32, dur:138, delay:-95 },
];

/* Dealt once at startup. Seeded rather than random so the stars land in the
   same places on every load and the sky doesn't reshuffle under you. */
function buildSky(){
  const clouds = document.getElementById('skyClouds');
  const stars = document.getElementById('skyStars');
  if (!clouds || !stars || clouds.childElementCount) return;
  /* Two per band, half a lap apart. One cloud per band spends part of its run
     entering or leaving, so there were moments with nothing much in that stripe
     of sky; with a second one trailing it by half the cycle there is always one
     well inside the frame. */
  clouds.innerHTML = CLOUD_LAYERS.map(l => [0, -l.dur / 2].map(offset =>
    `<div class="cloud drift" style="top:${l.top};width:${l.w};opacity:${l.op};animation-duration:${l.dur}s;animation-delay:${(l.delay + offset).toFixed(1)}s">${CLOUD_SVG}</div>`
  ).join('')).join('');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  stars.innerHTML = Array.from({ length: 42 }, () => {
    const d = 1.4 + rnd() * 2.2;
    return `<i style="left:${(rnd()*100).toFixed(1)}%;top:${(rnd()*72).toFixed(1)}%;width:${d}px;height:${d}px;animation:twinkle ${(2.6+rnd()*3.4).toFixed(1)}s ease-in-out ${(rnd()*4).toFixed(1)}s infinite"></i>`;
  }).join('');
}

/* Paint the sky and label the switch with where it would take you, not where
   you already are. */
function applySky(){
  const mode = currentSky();
  document.body.setAttribute('data-sky', mode);
  buildSky();
  const btn = document.getElementById('skyToggle');
  if (btn){
    const next = mode === 'day' ? 'night' : 'day';
    btn.innerHTML = next === 'day' ? SUN_ICON : MOON_ICON;
    btn.setAttribute('aria-label', `Switch to the ${next} sky`);
    btn.title = `Switch to the ${next} sky`;
  }
  const card = document.getElementById('higherSelfCard');
  if (card) card.dataset.sky = mode;
}
// The sky belongs to every page, so it goes up as soon as the document does
// rather than waiting for anyone to sign in.
document.addEventListener('DOMContentLoaded', applySky);

function toggleSky(){
  const next = currentSky() === 'day' ? 'night' : 'day';
  // Matching the clock again is the same as having no choice stored, so the
  // sky goes back to following it by itself.
  try {
    if (next === 'day') localStorage.removeItem(SKY_KEY);   // 'day' is the default, so it needs nothing stored
    else localStorage.setItem(SKY_KEY, JSON.stringify({ mode: next, date: localDateStr() }));
  } catch(e){}
  applySky();
}

