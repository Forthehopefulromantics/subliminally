/* kaly.js — your higher self: who she is and what she says

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- who you are, and who you are becoming ----------
   Eighteen identities, each drawn twice. `hero` is you as you are today -- cargo
   trousers, headphones, a bag over the shoulder. `keeper` is the same person
   as your highest self, in the long starry robe, holding light. Same face,
   same hair, further along.

   Which one you see depends on what the screen is for. The nav chip is you, so
   it shows the hero. The card on Today is headed "Your higher self", so it
   shows the keeper. Milestones and encouragement are her speaking, so those
   are the keeper too.

   Only the identity is stored -- `box-braids`, not a path -- so the two states
   stay one choice, and a picture can be redrawn without touching anybody's
   profile. Never rename an id once it has shipped.

   The old roster -- twenty-two tinted busts and Kaly -- is gone, artwork and
   all. Profiles may still hold 'f3' or 'kaly', and normally that would be a
   reason to keep the files rather than turn somebody's choice into a broken
   image; here it isn't, because every path to a picture goes through
   avatarId(), which sends an id that is no longer offered to the default. A
   retired choice shows the first of the roster, not a gap, and there was
   nothing to migrate to make that true. */
const AVATAR_PACK = [
  { id:'box-braids',           label:'Long box braids',       look:'deep brown skin, long box braids, and warm brown eyes' },
  { id:'straight-black',       label:'Straight black hair',   look:'light olive skin, straight black middle-parted hair, and dark brown eyes' },
  { id:'tapered-afro',         label:'Tapered natural afro',  look:'rich dark skin, a short tapered natural afro, and deep brown eyes' },
  { id:'copper-waves',         label:'Copper waves',          look:'fair skin, freckles, copper-red wavy hair, and green eyes' },
  { id:'dark-blonde-ponytail', label:'Dark-blonde ponytail',  look:'medium tan skin, a sleek dark-blonde high ponytail, and dark brown eyes' },
  { id:'shoulder-locs',        label:'Shoulder-length locs',  look:'deep bronze skin, shoulder-length locs, and amber eyes' },
  { id:'curly-bob',            label:'Curly bob',             look:'light brown skin, a curly bob with a deep side part, and hazel eyes' },
  { id:'silver-lilac',         label:'Silver-lilac hair',     look:'medium brown skin, long straight silver-lilac hair, and soft grey eyes' },
  { id:'blonde-curls',         label:'Blonde curls',          look:'fair skin, blonde curls, and blue eyes' },
  { id:'lavender-hijab',       label:'Lavender hijab',        look:'a lavender hijab and headphones to match' },
  { id:'facial-piercings',     label:'Dark hair and piercings', look:'fair skin, dark hair, and subtle facial piercings' },
  { id:'east-asian',           label:'Dark hair, warm eyes',  look:'dark hair and warm dark eyes' },
  { id:'black-twists',         label:'Two-strand twists',     look:'deep brown skin, short two-strand twists, and warm brown eyes' },
  { id:'east-asian-crop',      label:'Textured black crop',   look:'light skin, a textured black crop, and dark brown eyes' },
  { id:'latino-waves',         label:'Dark wavy fade',        look:'warm tan skin, a dark wavy fade, and dark brown eyes' },
  { id:'south-asian-curls',    label:'Short dark curls',      look:'deep tan skin, short dark curls, and dark brown eyes' },
  { id:'blond-blue-eyes',      label:'Sandy-blond curls',     look:'fair skin, sandy-blond curls, and blue eyes' },
  { id:'androgynous-undercut', label:'Curly side undercut',   look:'brown skin, a curly side undercut, and dark brown eyes' },
];
const AVATARS = AVATAR_PACK.map(a => a.id);
const HIGHER_SELF_DEFAULTS = { avatar:'box-braids' };
const AVATAR_STATES = ['hero', 'keeper'];

let higherSelf = { name:'', ...HIGHER_SELF_DEFAULTS };
function avatarId(id){ return AVATARS.includes(id) ? id : HIGHER_SELF_DEFAULTS.avatar; }
function avatarEntry(id){ return AVATAR_PACK.find(a => a.id === avatarId(id)) || AVATAR_PACK[0]; }
/* Three cuts of each drawing. The full one is what she is -- head to trainers.
   The thumb is the same picture small, for the roster. The face is a separate
   crop, because a round chip 26 pixels across cannot show a full-length figure:
   squeezed she is a smudge, and cropped down the middle she is a torso. */
const AVATAR_CUTS = { full:'', thumb:'-t', face:'-face' };
function avatarSrc(id, state, cut){
  const st = AVATAR_STATES.includes(state) ? state : 'keeper';
  return `img/avatar/${avatarId(id)}-${st}${AVATAR_CUTS[cut] || ''}.webp`;
}
/* Alt text says which of the two this is, because on a page that shows both
   "a woman with box braids" twice tells you nothing about which is which. */
function avatarAlt(id, state){
  const a = avatarEntry(id);
  return state === 'hero' ? `You, with ${a.look}` : `Your higher self, with ${a.look}`;
}
/* Drawn full-length, so the box is portrait and the figure is fitted inside it
   rather than cropped to it -- no heads, hair, headphones, hands or feet cut
   off at any size. */
const AVATAR_CUT_SIZE = { full:[281,500], thumb:[146,260], face:[128,128] };
function avatarMarkup(look, opts){
  const o = opts === true ? { cut:'thumb' } : (opts || {});
  const cut = AVATAR_CUT_SIZE[o.cut] ? o.cut : 'full';
  const id = look && look.avatar;
  const state = o.state || 'keeper';
  const [w, h] = AVATAR_CUT_SIZE[cut];
  return `<img class="av av-${cut}" src="${avatarSrc(id, state, cut)}" alt="${o.alt === false ? '' : avatarAlt(id, state)}"
    width="${w}" height="${h}" loading="lazy" decoding="async">`;
}

/* The columns arrive with 20260919 and 20260920. Until those are run this
   select errors, and the rest of Today shouldn't fail with it — so it asks on
   its own and shrugs off a refusal. */
async function loadHigherSelf(){
  if (!sb || !currentUser) return;
  const d = (await myProfile()) || {};
  higherSelf = { name: d.higher_self_name || '', avatar: avatarId(d.higher_self_avatar) };
}

/* ---------- what she says ----------
   One service, not a scattering of strings, so the dialogue can get more
   sophisticated later without hunting through the app for every line.

   Rules are tried in order and the first that fits wins, so the more specific
   ones sit at the top. Each gets the same picture of the day, which keeps them
   honest with each other.

   Three things none of these lines will ever do: blame you for a day you
   missed, tell you that you failed, or imply you have let anyone down. A
   missed day is a day; tomorrow is the practice.

   She is written without pronouns throughout, so whatever name you give her
   fits without rewriting anything. */
function kalyState(){
  const today = localDateStr();
  const time = currentRitualTime();
  const hour = new Date().getHours();
  const st = routineStatusFor(time, today);
  const done = (habitDoneByDate[today] || new Set()).size;
  return {
    time, hour, st, done,
    part: hour < 12 ? 'morning' : hour < 17 ? 'midday' : 'evening',
    streak: routineStreak(time),
    consistency: (typeof consistency === 'function') ? consistency(30) : null,
    journalled: !!(typeof journalPhotosByDate !== 'undefined' && journalPhotosByDate[today]),
    listened: (typeof lightToday !== 'undefined') && lightToday.has(LIGHT_SOURCES.subliminal),
    grace: (typeof graceOffer === 'function') ? graceOffer(time) : null,
    yesterdayMissed: (typeof routineHeld === 'function')
      && !routineHeld(time, shiftDateStr(today, -1)),
  };
}

const KALY_RULES = [
  // Everything kept. Said plainly — overdoing it here makes the small days feel small.
  { when: s => s.st.state === 'full' && s.journalled && s.listened,
    say: (n, s) => `You showed up for yourself today. Every part of it.` },
  { when: s => s.st.state === 'full',
    say: (n, s) => `${n} couldn't be prouder — that was the whole list.` },
  { when: s => s.st.state === 'essentials',
    say: (n, s) => `${n} counts that as kept. Rest now.` },

  // A run worth naming.
  { when: s => s.streak >= 7 && s.st.state === 'partial',
    say: (n, s) => `${s.streak} days running. ${n} is keeping pace with you.` },

  // A missed day. Never a reprimand, and never the first thing said.
  { when: s => s.yesterdayMissed && s.grace,
    say: (n, s) => `Yesterday got away from you. A grace day can hold the ${s.grace.saves} behind it.` },
  { when: s => s.yesterdayMissed && s.done === 0 && s.part !== 'evening',
    say: (n, s) => `Tomorrow is another chance to practice — and so is today.` },

  // Mid-practice.
  { when: s => s.done >= 4,
    say: (n, s) => `You've kept ${s.done} promises to yourself today.` },
  { when: s => s.st.state === 'partial',
    say: (n, s) => `${n} is doing it alongside you.` },

  // Nothing done yet, by hour.
  { when: s => s.part === 'morning',
    say: (n, s) => `Good morning. Let's decide what kind of day we're creating.` },
  { when: s => s.part === 'midday' && s.done === 0,
    say: (n, s) => `${n} is waiting whenever you're ready to start.` },
  { when: s => s.part === 'evening',
    say: (n, s) => `Let's close out the day.` },
];

/* The line for right now. `name` is what she's been called; everything else is
   read off the day. */
function kalyMessage(name){
  const who = (name || '').trim() || 'Your higher self';
  const state = kalyState();
  for (const rule of KALY_RULES){
    try { if (rule.when(state)) return rule.say(who, state); } catch(e){ /* a rule that can't decide doesn't get a turn */ }
  }
  return state.time === 'morning'
    ? `${who} has already started the day. Come and join.`
    : `${who} is already winding down for the night.`;
}

/* Kept because the Today card and the old tests both call it. */
function higherSelfLine(name){ return kalyMessage(name); }

/* Off Today for now. What she says is still written and still tested -- it is
   what the check-in will say when its screen arrives -- so this stops short of
   drawing her rather than stops short of knowing what she would say. */
const HIGHER_SELF_ON_TODAY = false;
function renderHigherSelfCard(){
  const card = document.getElementById('higherSelfCard');
  if (!card) return;
  if (!HIGHER_SELF_ON_TODAY){ card.style.display = 'none'; return; }
  const name = (higherSelf.name || '').trim() || 'Your higher self';
  const art = document.getElementById('higherSelfArt');
  if (art) art.innerHTML = avatarMarkup(higherSelf, { state:'keeper' });
  card.dataset.sky = currentSky();
  document.getElementById('higherSelfName').textContent = name;
  /* What she says is read off today's check-ins, so before those have landed
     the only honest line is none. "Tomorrow is another chance" is a kind thing
     to say to someone who hasn't started; it is the wrong thing to say to
     someone who finished at seven this morning and is still waiting to see it. */
  const painted = (typeof todayPainted === 'undefined') || todayPainted;
  document.getElementById('higherSelfSub').textContent = painted ? higherSelfLine(name) : '';
  card.style.display = 'block';
}

/* Tapping her on Today drops you straight into the part of the profile that
   changes her, rather than at the top of a long settings page. */
function editHigherSelf(){
  showProfilePage();
  setTimeout(() => {
    const el = document.getElementById('higherSelfSettings');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
  }, 60);
}

/* ---------- choosing her ----------
   You are picking one person, not two, so the roster shows the everyday
   drawing -- that is the one you are deciding looks like you. The preview above
   it shows both, because the pair is the point: this is who you are, and this
   is the same person further along. */
function renderHigherSelfMaker(){
  const wrap = document.getElementById('higherSelfMaker');
  if (!wrap) return;
  const preview = document.getElementById('higherSelfPreview');
  if (preview) preview.innerHTML = `
    <div class="hs-pair">
      <figure><span class="hs-pair-art">${avatarMarkup(higherSelf, { state:'hero' })}</span><figcaption>You now</figcaption></figure>
      <figure><span class="hs-pair-art">${avatarMarkup(higherSelf, { state:'keeper' })}</span><figcaption>${(higherSelf.name || '').trim() || 'Your higher self'}</figcaption></figure>
    </div>`;
  wrap.innerHTML = `<div class="av-roster">${AVATAR_PACK.map(a =>
    `<button type="button" class="av-opt${a.id === higherSelf.avatar ? ' sel' : ''}" onclick="pickAvatar('${a.id}')"
       aria-pressed="${a.id === higherSelf.avatar}" title="${a.label}"
       aria-label="${a.label} — ${a.look}">${avatarMarkup({ avatar:a.id }, { state:'hero', cut:'thumb', alt:false })}</button>`).join('')}</div>`;
}

/* Everywhere she appears, repainted together. Choosing used to move the roster,
   Today and the nav chip but leave the circle at the top of the profile page --
   the one you are looking at while you choose -- showing the last one. */
function repaintAvatars(){
  renderHigherSelfMaker();
  renderHigherSelfCard();
  const circle = document.getElementById('profileAvatarDisplay');
  if (circle) circle.innerHTML = avatarMarkup(higherSelf, { state:'hero', cut:'face' });
  loadNavIdentity();
}

/* Paint first, save after: choosing should feel instant, and a slow round trip
   to the database shouldn't sit between the tap and the change. */
async function pickAvatar(id){
  higherSelf.avatar = avatarId(id);
  repaintAvatars();
  if (!sb || !currentUser) return;
  const msg = document.getElementById('higherSelfMsg');
  if (msg){ msg.textContent = 'Saving…'; msg.className = 'save-msg'; }
  const error = await saveProfile({ higher_self_avatar: higherSelf.avatar });
  if (!msg) return;
  if (error){ msg.textContent = describeSaveError(error); msg.className = 'save-msg err'; return; }
  msg.textContent = 'Saved.'; msg.className = 'save-msg ok';
}

async function updateHigherSelfName(){
  if (!sb || !currentUser) return;
  const msg = document.getElementById('higherSelfMsg');
  const name = document.getElementById('higherSelfNameInput').value.trim().slice(0, 24);
  msg.textContent = 'Saving…'; msg.className = 'save-msg';
  const error = await saveProfile({ higher_self_name: name || null });
  if (error){ msg.textContent = describeSaveError(error); msg.className = 'save-msg err'; return; }
  higherSelf.name = name;
  renderHigherSelfCard();
  msg.textContent = name ? `Saved — ${name} it is.` : 'Saved.';
  msg.className = 'save-msg ok';
}

