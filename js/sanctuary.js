/* sanctuary.js — the home you build, and what is in it

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html.

   This file must load after light.js (it reads `light`) and after kaly.js
   (it calls avatarMarkup), and before boot.js. */

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
    blurb:'Where you come in.',
    opens: () => true },

  { key:'garden',   name:'Practice Garden', art:'07-practice-garden',
    blurb:'Habits, kept.',
    opens: s => (s.habit || 0) > 0 },

  { key:'bedroom',  name:'Dreamscape',    art:'02-bedroom-dreamscape',
    blurb:'Rest, and the subconscious.',
    opens: s => (s.subliminal || 0) > 0 || (s.ritual_night || 0) > 0 },

  { key:'library',  name:'Library',       art:null,   /* 03-library-story-room — not drawn yet */
    blurb:'Your story, written down.',
    opens: s => (s.journal || 0) > 0 },

  { key:'mirror',   name:'The Mirror',    art:'04-mirror-identity-room',
    blurb:'Who you are becoming.',
    opens: (s, lifetime) => lifetime >= 400 },

  { key:'waters',   name:'The Waters',    art:'05-waters-bathroom',
    blurb:'Where feeling is let go of.',
    opens: (s, lifetime) => lifetime >= 800 },

  { key:'studio',   name:'Vision Studio', art:null,   /* 06-creative-vision-studio — not drawn yet */
    blurb:'What you are making.',
    opens: (s, lifetime) => lifetime >= 1400 },

  { key:'horizon',  name:'The Horizon',   art:null,   /* 08-horizon-balcony — not drawn yet */
    blurb:'Where you are going.',
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
