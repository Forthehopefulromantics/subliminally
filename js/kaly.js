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
  'f1','f2','f3','f4','f5','f6','f7','f8','f9','f10',
  'm1','m2','m3','m4','m5','m6','m7','m8','m9','m10','m11','m12',
];
const HIGHER_SELF_DEFAULTS = { avatar:'f1' };

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

/* What she's doing while you're reading this. She's meant to be a step ahead
   of you, not a scoreboard — so a missed night reads as her waiting, never as
   a telling-off. Written without pronouns so any name fits. */
function higherSelfLine(name){
  const time = currentRitualTime();
  const st = routineStatusFor(time, localDateStr());
  if (st.state === 'full') return `${name} couldn't be prouder — that was the whole list.`;
  if (st.state === 'essentials') return `${name} counts that as kept. Rest now.`;
  if (st.state === 'partial') return `${name} is doing it alongside you.`;
  if (time === 'morning') return `${name} has already started the day. Come and join.`;
  return `${name} is already winding down for the night.`;
}

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

