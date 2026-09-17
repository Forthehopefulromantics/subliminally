/* sanctuary.js — the home you build, and what is in it

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html.

   This file must load after light.js (it reads `light`) and after kaly.js
   (it calls avatarMarkup), and before boot.js. */

/* ---------- switched off ----------
   Kyla asked for the landscape and the house to come off the app while she
   keeps it simple: habits, and the higher self who helps you keep them. This
   file still loads and still works; nothing calls into it while this is false.
   Everything below, the migration and the artwork are untouched, so turning it
   back on is this one line. */
const SANCTUARY_ENABLED = false;

/* ---------- the rooms ----------
   `key` is what the database stores and what the artwork is named after, so a
   rename is a migration and a re-export, not a tidy-up. `art` being null means
   the background has not been drawn yet: the room still exists, still unlocks,
   still counts — it just cannot be entered, which is a far smaller problem than
   a room that quietly disappears from the plan.

   `opens` is a function of what someone has actually done. It is never stored.
   See the migration for why that is the mechanism rather than a shortcut. */
const SANCTUARY_ROOMS = [
  { key:'living',   name:'Living Room',   art:null,   /* 01-living-room-hub — not drawn yet */
    blurb:'Where you come in.', at:{ x:20, y:53 }, need:'Open from the first day.',
    opens: () => true },

  { key:'garden',   name:'Practice Garden', art:'07-practice-garden',
    blurb:'Habits, kept.', at:{ x:47, y:76 }, need:'Check off one habit.',
    opens: s => (s.habit || 0) > 0 },

  { key:'bedroom',  name:'Dreamscape',    art:'02-bedroom-dreamscape',
    blurb:'Rest, and the subconscious.', at:{ x:52, y:30 },
    need:'Play a subliminal, or finish a night ritual.',
    opens: s => (s.subliminal || 0) > 0 || (s.ritual_night || 0) > 0 },

  { key:'library',  name:'Library',       art:null,   /* 03-library-story-room — not drawn yet */
    blurb:'Your story, written down.', at:{ x:16, y:27 }, need:'Write or photograph one page.',
    opens: s => (s.journal || 0) > 0 },

  { key:'mirror',   name:'The Mirror',    art:'04-mirror-identity-room',
    blurb:'Who you are becoming.', at:{ x:71, y:26 }, need:'400 Light.',
    opens: (s, lifetime) => lifetime >= 400 },

  { key:'waters',   name:'The Waters',    art:'05-waters-bathroom',
    blurb:'Where feeling is let go of.', at:{ x:72, y:46 }, need:'800 Light.',
    opens: (s, lifetime) => lifetime >= 800 },

  { key:'studio',   name:'Vision Studio', art:null,   /* 06-creative-vision-studio — not drawn yet */
    blurb:'What you are making.', at:{ x:86, y:52 }, need:'1,400 Light.',
    opens: (s, lifetime) => lifetime >= 1400 },

  { key:'horizon',  name:'The Horizon',   art:null,   /* 08-horizon-balcony — not drawn yet */
    blurb:'Where you are going.', at:{ x:89, y:34 }, need:'2,200 Light.',
    opens: (s, lifetime) => lifetime >= 2200 },
];
function sanctuaryRoom(key){ return SANCTUARY_ROOMS.find(r => r.key === key) || null; }
function sanctuaryArtUrl(room){ return room && room.art ? `img/sanctuary-home/${room.art}.webp` : null; }

/* ---------- what can be earned ----------
   A const, like LEVELS and AVATARS, so rebalancing is a release and not a
   migration. `room` is where an object belongs; nothing can be placed in a room
   it was not made for, which is what keeps fixed slots from needing rules about
   scale and lighting for every possible combination. */
const SANCTUARY_ITEMS = {
  welcome_lamp:    { name:'Welcome Lamp',     room:'living',  glyph:'🕯', first:true,
                     note:'The first light in the house.' },
  memory_lantern:  { name:'Memory Lantern',   room:'living',  glyph:'🏮' },
  reflection_bench:{ name:'Reflection Bench', room:'garden',  glyph:'🪑' },
  moonflower_bed:  { name:'Moonflower Bed',   room:'garden',  glyph:'🌙' },
  first_seed:      { name:'First Seed',       room:'garden',  glyph:'🌱' },
  star_lights:     { name:'Star Lights',      room:'bedroom', glyph:'✨' },
  dream_catcher:   { name:'Dreamcatcher',     room:'bedroom', glyph:'🪶' },
  filled_shelf:    { name:'A Shelf of Pages', room:'library', glyph:'📚' },
  affirmation_card:{ name:'Affirmation Card', room:'mirror',  glyph:'🪞' },
  lotus_bowl:      { name:'Lotus Bowl',       room:'waters',  glyph:'🪷' },
};

/* Where objects may sit. Percentages of the artwork, not of the screen — the
   stage is exactly 9:16 and never crops, so these land on the same spot on
   every phone. Rooms whose art is not drawn yet have no slots, because the
   coordinates have to be read off a picture that exists. */
const SANCTUARY_SLOTS = {
  living: [],
  garden: [
    { key:'bed_left',  label:'The left planter',  x:16, y:62, scale:1 },
    { key:'bed_right', label:'The right planter', x:84, y:62, scale:1 },
    { key:'by_the_pool', label:'Beside the pool', x:50, y:52, scale:.8 },
  ],
  bedroom: [
    { key:'bedside',  label:'The bedside table', x:70, y:33, scale:.7 },
    { key:'over_bed', label:'Above the bed',     x:52, y:25, scale:.9 },
  ],
  mirror: [
    { key:'vanity',   label:'The vanity',        x:74, y:56, scale:.7 },
  ],
  waters: [
    { key:'tub_side', label:'Beside the bath',   x:26, y:66, scale:.7 },
  ],
  library: [], studio: [], horizon: [],
};

/* ---------- state ----------
   Loaded, never guessed. `sources` reaches back over the whole record rather
   than the ninety-two days light.js keeps, because a room that opened in March
   must not close in June. */
let sanctuary = {
  loaded:  false,
  ready:   false,           // false when the migration has not been run yet
  sources: {},              // 'habit' -> number of days
  grants:  [],              // [{ week_start, offered[], chosen, seed }]
  placed:  {},              // 'room' -> { slot: item_key }
  seen:    {},              // 'room' -> ISO string last opened
};

/* Every read is allowed to fail. Until the migration is run these tables do not
   exist, and Today has to render anyway — the same shrug loadLight() and
   loadHigherSelf() already make. A missing Sanctuary is a Sanctuary that has
   not been built yet, not an error worth showing anyone.

   The whole body is wrapped rather than only the checked error fields, because
   renderTodayPage() awaits this inside a Promise.all: one rejection there takes
   down the greeting, the ritual, the Journey and the day's page along with it.
   A returned error is not the only way this can go wrong — an offline phone, a
   permissions change, a response shaped differently than expected — and none of
   those are worth the rest of Today. There is no shape of failure here that
   should cost someone their morning. */
async function loadSanctuary(){
  try { await loadSanctuaryInner(); }
  catch (e){ console.warn('sanctuary:', e && e.message); sanctuary.ready = false; }
}
async function loadSanctuaryInner(){
  if (!SANCTUARY_ENABLED) return;   // don't spend four requests on a hidden screen
  if (!sb || !currentUser) return;
  sanctuary.loaded = true;

  const [srcRes, grantRes, placeRes, profRes] = await Promise.all([
    sb.rpc('my_light_sources'),
    sb.from('sanctuary_grants').select('week_start, offered, chosen, seed').order('week_start', { ascending:false }),
    sb.from('sanctuary_placements').select('room_key, slot_key, item_key'),
    sb.from('profiles').select('sanctuary_seen').eq('id', currentUser.id).maybeSingle(),
  ]);

  if (srcRes.error || grantRes.error || placeRes.error){
    console.warn('sanctuary: not set up yet —', (srcRes.error || grantRes.error || placeRes.error).message);
    sanctuary.ready = false;
    return;
  }
  sanctuary.ready = true;

  sanctuary.sources = {};
  for (const r of srcRes.data || []) sanctuary.sources[r.source] = Number(r.days || 0);

  sanctuary.grants = grantRes.data || [];

  sanctuary.placed = {};
  for (const p of placeRes.data || []){
    (sanctuary.placed[p.room_key] = sanctuary.placed[p.room_key] || {})[p.slot_key] = p.item_key;
  }

  sanctuary.seen = (profRes.data && profRes.data.sanctuary_seen) || {};
}

/* ---------- reading the state ----------
   One function, so no screen can disagree with another about whether a room is
   open. Unlocking is derived, so this is also the only place it is decided. */
function roomState(key){
  const room = sanctuaryRoom(key);
  if (!room) return 'locked';
  if (!sanctuary.ready) return key === 'living' ? 'unlocked' : 'locked';

  const open = !!room.opens(sanctuary.sources, light.lifetime || 0);
  if (!open) return 'locked';
  if (!room.art) return 'coming';               // earned, drawn later
  if (!sanctuary.seen[key]) return 'new';       // open, never walked into
  return 'unlocked';
}

/* What is owned and not yet put anywhere. An object waiting to be placed is the
   only reason to interrupt someone, so this is what a badge counts. */
function ownedItems(){
  return sanctuary.grants.filter(g => g.chosen).map(g => g.chosen);
}
function placedItems(){
  return Object.values(sanctuary.placed).flatMap(slots => Object.values(slots));
}
function unplacedItems(){
  const placed = placedItems();
  const left = placed.slice();
  return ownedItems().filter(k => {
    const i = left.indexOf(k);
    if (i === -1) return true;
    left.splice(i, 1);                 // one placement consumes one copy
    return false;
  });
}

/* How far along the house is, for the one line that appears on Today. Counts
   what is open rather than what is left, because the number should only ever
   go up. */
function sanctuaryProgress(){
  const total = SANCTUARY_ROOMS.length;
  const open  = SANCTUARY_ROOMS.filter(r => roomState(r.key) !== 'locked').length;
  return { open, total, waiting: unplacedItems().length };
}

/* ---------- the overview ----------
   One stage, reused. The overview and each room take turns inside it rather
   than being separate pages, so there is one route to keep working instead of
   nine, and moving between them is a swap rather than a navigation.

   Hotspots arrive in the next step; this renders the house and what is in it. */
let sanctuaryRoomOpen = null;       // null on the overview, otherwise a room key

function renderSanctuaryHome(){
  const stage = document.getElementById('sanctuaryStage');
  const below = document.getElementById('sanctuaryBelow');
  const back  = document.getElementById('sanctuaryBackdrop');
  if (!stage) return;
  sanctuaryRoomOpen = null;

  const art = 'img/sanctuary-home/00-home-overview.webp';
  const p = sanctuaryProgress();

  /* The backdrop is the same picture, blurred, filling whatever the stage does
     not on a wide screen. It is decorative and never tapped, so it is the one
     thing here allowed to crop. */
  if (back){ back.style.backgroundImage = `url("${art}")`; back.classList.add('on'); }

  /* Hotspots are buttons, not divs with click handlers. That is the whole of
     the keyboard support, the focus ring and the screen-reader announcement —
     a div would need all three written by hand and they would drift.

     Coordinates are percentages of the artwork. The stage is exactly the shape
     of the artwork and never crops, so they mean the same thing everywhere. */
  const spots = SANCTUARY_ROOMS.map(r => {
    /* A locked room is not a disabled button: tapping it says what opens it,
       which is the one thing someone standing in front of it wants. So no
       aria-disabled — that would promise a screen-reader user nothing happens,
       and something does. The state rides in the label instead. */
    const st = roomState(r.key);
    const say = st === 'locked' ? `locked. ${r.need}`
              : st === 'coming' ? 'open, still being drawn'
              : st === 'new'    ? 'open, not visited yet'
              : 'open';
    return `<button type="button" class="sanc-hot is-${st}"
        style="left:${r.at.x}%; top:${r.at.y}%"
        onclick="selectSanctuaryRoom('${r.key}')"
        aria-label="${r.name} — ${say}">
        <span class="sh-noise" aria-hidden="true"></span>
        <span class="sh-dot" aria-hidden="true"></span>
        <span class="sh-name" aria-hidden="true">${r.name}</span>
      </button>`;
  }).join('');

  stage.innerHTML = `
    <img class="sanc-art" src="${art}" alt="Your Sanctuary: a two-story home among floating islands and waterfalls">
    <div class="sanc-hots">${spots}</div>
    <div class="sanc-top">
      <div class="sanc-title">Your Sanctuary</div>
      <div class="sanc-sub">${p.open} of ${p.total} spaces open${p.waiting ? ` · ${p.waiting} waiting to be placed` : ''}</div>
    </div>`;

  renderSanctuaryList();
}

/* The list under the picture is not a duplicate of the hotspots — it is the
   readable version of them. Names over artwork need a scrim each to stay
   legible against a picture that changes; the same names underneath are
   readable by default, ordered, and reachable by tab without hunting. */
function renderSanctuaryList(selected){
  const below = document.getElementById('sanctuaryBelow');
  if (!below) return;
  below.innerHTML = `<ul class="sanc-rooms">${SANCTUARY_ROOMS.map(r => {
    const st = roomState(r.key);
    const note = st === 'locked' ? 'Not open yet'
               : st === 'coming' ? 'Being drawn'
               : st === 'new'    ? 'New'
               : 'Open';
    return `<li class="sanc-room is-${st}${selected === r.key ? ' is-picked' : ''}">
      <button type="button" onclick="selectSanctuaryRoom('${r.key}')">
        <span class="sr-name">${r.name}</span>
        <span class="sr-blurb">${st === 'locked' ? r.need : r.blurb}</span>
        <span class="sr-state">${note}</span>
      </button>
    </li>`;
  }).join('')}</ul>`;
}

/* Choosing a room from either the picture or the list. Entering one arrives in
   the next step; for now this is what tells you where you just tapped, which is
   also what a locked room has to do forever — say what opens it, without ever
   implying you did something wrong. */
function selectSanctuaryRoom(key){
  const stage = document.getElementById('sanctuaryStage');
  if (stage) stage.querySelectorAll('.sanc-hot').forEach(b =>
    b.classList.toggle('is-picked', b.getAttribute('aria-label').startsWith(sanctuaryRoom(key).name + ' ')));
  renderSanctuaryList(key);
  const li = document.querySelector('.sanc-room.is-picked');
  if (li) li.scrollIntoView({ block:'nearest',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/* Entering is a swap of what is on the stage, so there is nothing to undo on
   the way back out. Rooms themselves land in a later step; this exists now so
   the route and the back path are built and tested together. */
function showSanctuary(roomKey){
  if (!SANCTUARY_ENABLED){ goHome(); return; }
  if (!currentUser){ openAuthModal(); return; }
  document.body.setAttribute('data-view', 'sanctuary');
  window.scrollTo(0, 0);
  history.pushState({ page:'sanctuary' }, '', '#sanctuary');
  renderSanctuaryHome();
}

/* The way in, on Today. A thumbnail of the house and the count, so most days
   the answer arrives without going anywhere — opening it is for when you want
   to stand in it.

   Hidden rather than empty until the migration has run, because a row that
   says nothing is worse than no row. */
function renderTodaySanctuaryRow(){
  const host = document.getElementById('todaySanctuaryRow');
  if (!host) return;
  if (!SANCTUARY_ENABLED || !sanctuary.ready){ host.innerHTML = ''; return; }
  const p = sanctuaryProgress();
  host.innerHTML = `
    <button type="button" class="sanc-row" onclick="showSanctuary()">
      <span class="sanc-row-thumb"><img src="img/sanctuary-home/00-home-overview.webp" alt=""></span>
      <span class="sanc-row-txt">
        <b>My Sanctuary</b>
        <span>${p.open} of ${p.total} spaces open${p.waiting ? ` · ${p.waiting} to place` : ''}</span>
      </span>
      <span class="sanc-row-go" aria-hidden="true">›</span>
    </button>`;
}
