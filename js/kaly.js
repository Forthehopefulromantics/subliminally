/* kaly.js — your higher self: who she is and what she says

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- your higher self ----------
   One drawing for now; the others drop into this list as they're drawn and
   every screen picks them up from here. `id` is what's stored on the profile,
   so never renumber an entry once it has shipped. */
/* ---------- your higher self ----------
   The artwork is flat colour under black line art, so it ships as one mask per
   part plus the line art on top. Tinting a mask is just a background colour,
   which means skin, hair, eyes and lips are yours to choose rather than baked
   into a drawing. A hairstyle is a folder of those layers; adding one is a line
   here and a set of files. `id` is what's stored, so never rename one. */
/* Twenty-two drawn avatars. Each one ships with its own skin tone, hair
   texture and colour, so choosing between them is the customisation — tinting
   flat colour over this artwork measured as a visible loss (mean 16/255
   against the original), and the roster already covers the range that tinting
   was standing in for. `id` is what's stored, so never rename one. */
const AVATARS = [
  'kaly',                                    // Kyla's own character, and the default
  'f1','f2','f3','f4','f5','f6','f7','f8','f9','f10',
  'm1','m2','m3','m4','m5','m6','m7','m8','m9','m10','m11','m12',
];
/* Kaly is who a new member meets. The other twenty-two stay, because anyone who
   already picked one has that id stored in profiles.higher_self_avatar and a
   default is not a reason to change someone's choice underneath them. */
const HIGHER_SELF_DEFAULTS = { avatar:'kaly' };

let higherSelf = { name:'', ...HIGHER_SELF_DEFAULTS };
function avatarId(id){ return AVATARS.includes(id) ? id : HIGHER_SELF_DEFAULTS.avatar; }
function avatarSrc(id, thumb){ return `img/avatar/${avatarId(id)}${thumb ? '-t' : ''}.webp`; }
function avatarMarkup(look, thumb){
  return `<img class="av" src="${avatarSrc(look && look.avatar, thumb)}" alt="" width="512" height="512" loading="lazy">`;
}

/* The columns arrive with 20260919 and 20260920. Until those are run this
   select errors, and the rest of Today shouldn't fail with it — so it asks on
   its own and shrugs off a refusal. */
async function loadHigherSelf(){
  if (!sb || !currentUser) return;
  const { data, error } = await sb.from('profiles')
    .select('higher_self_name, higher_self_avatar').eq('id', currentUser.id).maybeSingle();
  if (error){ console.warn('higher self:', error.message); return; }
  const d = data || {};
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

function renderHigherSelfCard(){
  const card = document.getElementById('higherSelfCard');
  if (!card) return;
  const name = (higherSelf.name || '').trim() || 'Your higher self';
  const art = document.getElementById('higherSelfArt');
  if (art) art.innerHTML = avatarMarkup(higherSelf);
  card.dataset.sky = currentSky();
  document.getElementById('higherSelfName').textContent = name;
  document.getElementById('higherSelfSub').textContent = higherSelfLine(name);
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

/* ---------- choosing her ---------- */
function renderHigherSelfMaker(){
  const wrap = document.getElementById('higherSelfMaker');
  if (!wrap) return;
  const preview = document.getElementById('higherSelfPreview');
  if (preview) preview.innerHTML = avatarMarkup(higherSelf);
  wrap.innerHTML = `<div class="av-roster">${AVATARS.map(id =>
    `<button type="button" class="av-opt${id === higherSelf.avatar ? ' sel' : ''}" onclick="pickAvatar('${id}')"
       aria-pressed="${id === higherSelf.avatar}" aria-label="Avatar ${id}">${avatarMarkup({ avatar:id }, true)}</button>`).join('')}</div>`;
}

/* Paint first, save after: choosing should feel instant, and a slow round trip
   to the database shouldn't sit between the tap and the change. */
async function pickAvatar(id){
  higherSelf.avatar = avatarId(id);
  renderHigherSelfMaker();
  renderHigherSelfCard();
  loadNavIdentity();
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

