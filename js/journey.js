/* journey.js — Today's Journey, and the cards under it

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- Today's Journey ----------
   The question this answers is "what should I do next", so it reads the day,
   works out the one thing that is most worth doing now, and makes that the
   button. Everything else is a quiet list underneath it. */
function journeyQuests(){
  const today = localDateStr();
  const ritual = t => {
    const rows = ritualRowsFor(t, today);
    if (!rows.length) return null;
    const st = routineStatusFor(t, today);
    return { done: st.state === 'full' || st.state === 'essentials', st, rows };
  };
  const morning = ritual('morning'), night = ritual('night');
  /* Three things, in the order a day happens. Journal and the habit count came
     off: the habits are already the two rituals, so they were counted twice,
     and a list that is mostly bookkeeping stops being a list of what to do. */
  /* Morning, night, then the subliminal — it is last because it is the thing
     you fall asleep to, so it is the only one that does not end with you doing
     something else. */
  const list = [];
  if (morning) list.push({ key:'morning', label:'Morning ritual', done:morning.done,
    detail:`${morning.st.done} of ${morning.st.total}`, go:() => openRitualOnToday('morning') });
  if (night) list.push({ key:'night', label:'Night ritual', done:night.done,
    detail:`${night.st.done} of ${night.st.total}`, go:() => openRitualOnToday('night') });
  list.push({ key:'subliminal', label:'Subliminal', done: lightToday.has(LIGHT_SOURCES.subliminal),
    detail: lightToday.has(LIGHT_SOURCES.subliminal) ? 'Played' : 'Not yet',
    play: true, go:() => playTodaySubliminal() });
  return list;
}

/* The next thing worth doing. Morning before the afternoon, night after it, and
   the practice you have actually left undone before either. */
function nextQuest(quests){
  const undone = quests.filter(q => !q.done);
  if (!undone.length) return null;
  const evening = currentRitualTime() === 'night';
  const order = evening ? ['night','subliminal','morning'] : ['morning','night','subliminal'];
  for (const key of order){ const q = undone.find(u => u.key === key); if (q) return q; }
  return undone[0];
}

function renderTodayJourney(){
  const card = document.getElementById('todayJourneyCard');
  if (!card) return;
  const quests = journeyQuests();
  if (!quests.length){ card.style.display = 'none'; return; }
  if (!todayPainted && !habitsCache.length){
    card.style.display = 'block';
    card.innerHTML = todayPlaceholder("Today's journey");
    return;
  }
  const done = quests.filter(q => q.done).length;
  const next = nextQuest(quests);
  const evening = currentRitualTime() === 'night';
  card.style.display = 'block';
  card.innerHTML = `
    <div class="today-card-label">${evening ? "Tonight's journey" : "Today's journey"}</div>
    <h3>${done === quests.length ? 'Every part of today is done.' : `${done} of ${quests.length} complete`}</h3>
    <div class="today-progress"><i style="width:${Math.round(done / quests.length * 100)}%"></i></div>
    ${next ? `<button class="btn btn-primary" onclick="journeyGo('${next.key}')">${next.done ? 'Open' : (next.key.includes('ritual') || next.key === 'morning' || next.key === 'night') ? `Continue ${next.label.toLowerCase()}` : next.label}</button>` : ''}
    <ul class="journey-list">${quests.map(q => `
      <li class="journey-q${q.done ? ' done' : ''}${next && q.key === next.key ? ' next' : ''}">
        <button type="button" class="jq-main" onclick="journeyGo('${q.key}')">
          <span class="jq-tick" aria-hidden="true">${q.done ? '✓' : ''}</span>
          <span class="jq-label">${q.label}</span>
          <span class="jq-detail">${q.detail}</span>
          ${q.play ? `<span class="jq-play" aria-hidden="true">${finalPlaying ? '❚❚' : '▶'}</span>` : ''}
        </button>
        ${q.play && finalPlaying ? `<button type="button" class="jq-edit" onclick="openSoundLevels()"
            aria-label="Adjust the sound levels" title="Sound levels">${MIXER_ICON}</button>` : ''}
      </li>`).join('')}</ul>`;
}
/* "Continue morning ritual" used to swap which ritual the card below was
   showing and leave you where you were. The card is off the bottom of a phone
   screen, so the tap looked like it had done nothing at all -- and the obvious
   next move is to press it again. It does the same thing as before; it just
   takes you to the list as well, which is what the word "continue" promised. */
function openRitualOnToday(time){
  todayRitualTime = time;
  renderTodayRitual();
  renderTodayJourney();
  const card = document.getElementById('todayRitualCard');
  if (!card) return;
  card.scrollIntoView({ behavior:'smooth', block:'center' });
  // A moment of glow, so it is obvious which card just answered you.
  card.classList.remove('just-opened');
  void card.offsetWidth;                  // restart the animation on a repeat tap
  card.classList.add('just-opened');
  setTimeout(() => card.classList.remove('just-opened'), 1400);
}
/* The three things you can do with a session, given the same weight and the
   same shape. "Build a new one" and "All my subliminals" were grey text under
   the button, which reads as small print rather than as the other two thirds of
   the choice -- and on a phone a line of grey text is the hardest thing on the
   card to hit. Each carries a mark cut to match the play triangle on the cover
   art above it. */
const PLAY_MARK  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.87l10.4-6.4a1 1 0 0 0 0-1.74L9.5 4.73A1 1 0 0 0 8 5.6Z"/></svg>';
// Two bars, because the button says Pause: your place is kept.
const PAUSE_MARK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.4"/><rect x="14" y="4" width="4" height="16" rx="1.4"/></svg>';
const PLUS_MARK  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const STACK_MARK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="13" height="13" rx="2.5"/><path d="M7 4h11a3 3 0 0 1 3 3v11"/></svg>';

/* Faders. It is the one picture that reads as "change how this sounds" without
   a word next to it, and it is the same mark the levels panel uses. */
const MIXER_ICON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
  <path d="M6 20v-7M6 9V4M12 20v-10M12 6V4M18 20v-4M18 12V4"/>
  <circle cx="6" cy="11" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="18" cy="14" r="2"/></svg>`;

/* Opens the levels from wherever you are, rather than only from the player --
   which is the one place you are not looking when you are halfway down your
   morning list. The six faders now live in the player's Sound adjustments
   panel, because that is where they save with the subliminal, so this raises
   the player and opens that panel rather than a second copy of the sliders. */
function openSoundLevels(){
  if (typeof openImmersivePlayer === 'function') openImmersivePlayer();
  const panel = document.querySelector('#immersivePlayer .listening-mix');
  if (!panel) return;
  panel.open = true;
  if (typeof syncListeningMix === 'function') syncListeningMix();
  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function journeyGo(key){
  const q = journeyQuests().find(x => x.key === key);
  if (q) q.go();
}

/* ---------- tonight's session ----------
   The last three, side by side, the way Calm puts its sessions on the home
   screen. It used to be one card naming whichever you saved most recently,
   which is a guess about tonight rather than a choice about it.

   `lastSub` is still the argument renderTodayPage passes, and is still what is
   chosen when nothing else has been -- the newest is a good default, it is just
   not the only option any more. */
function renderTodaySession(lastSub){
  const card = document.getElementById('todaySessionCard');
  if (!card) return;
  const evening = new Date().getHours() >= 16;

  if (!todaySubs.length && !todayPainted){
    card.innerHTML = todayPlaceholder(evening ? 'Tonight' : 'Today');
    return;
  }
  if (!todaySubs.length){
    card.innerHTML = `
      <div class="today-card-label">${evening ? 'Tonight' : 'Today'}</div>
      <h3>Build your first subliminal</h3>
      <p>Pick a frequency, say what you're working through, and record it in your own voice. It takes about five minutes.</p>
      <button class="btn btn-primary" onclick="showBuildPage()">Start</button>`;
    return;
  }
  if (!todaySubChosen) todaySubChosen = (lastSub && lastSub.id) || todaySubs[0].id;

  card.innerHTML = `
    <div class="today-card-label">${evening ? 'Tonight' : 'Today'}</div>
    <h3>What are you listening to?</h3>
    <div class="sess-row" role="radiogroup" aria-label="Choose tonight's subliminal">
      ${todaySubs.map(s => {
        const mins = Math.round((s.duration_seconds || 0) / 60);
        const on = s.id === todaySubChosen;
        const playing = finalPlaying && libraryNowPlayingId === s.id;
        return `<button type="button" class="sess-card${on ? ' sel' : ''}" role="radio"
            aria-checked="${on}" onclick="chooseTodaySub('${s.id}')">
          <span class="sess-art" id="sessArt-${s.id}">
            <span class="sess-play" aria-hidden="true">${playing ? '❚❚' : '▶'}</span>
          </span>
          <span class="sess-name">${(s.title || 'Untitled').replace(/</g,'&lt;')}</span>
          <span class="sess-len">${mins ? formatSessionLength(mins) : ''}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="sess-actions">
      <button class="btn btn-primary" onclick="playTodaySubliminal()">
        <span class="sess-btn-mark" aria-hidden="true">${finalPlaying && !finalPaused ? PAUSE_MARK : PLAY_MARK}</span>
        ${finalPlaying ? (finalPaused ? 'Resume' : 'Pause') : 'Play it'}</button>
      <button class="btn btn-ghost" onclick="resetFlow(); showBuildPage(); showStep(0);">
        <span class="sess-btn-mark" aria-hidden="true">${PLUS_MARK}</span>Build a new one</button>
      <button class="btn btn-ghost" onclick="showLibraryPage(); setLibraryTab('mine');">
        <span class="sess-btn-mark" aria-hidden="true">${STACK_MARK}</span>All my subliminals</button>
    </div>`;
  todaySubs.forEach(s => { if (s.cover_path) showTodaySubCover(s.id, s.cover_path); });
}

/* Empty and not-loaded-yet look identical from in here, and they should not
   read the same on screen. "Nothing set yet" is a true thing to say about a
   new account and a wrong thing to flash at someone with a six-item morning
   while their list is still on its way. Until the first real answer has
   landed, say nothing instead. */
function todayPlaceholder(label){
  return `<div class="today-card-label">${label}</div>
    <div class="card-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>
    <span class="sr-only">Loading</span>`;
}
function renderTodayRitual(){
  const card = document.getElementById('todayRitualCard');
  if (!habitsCache.length && !todayPainted){
    card.style.display = 'block';
    card.innerHTML = todayPlaceholder('Your ritual');
    return;
  }
  if (!habitsCache.length){
    card.style.display = 'block';
    card.innerHTML = `
      <div class="today-card-label">Your ritual</div>
      <h3>Nothing set yet</h3>
      <p>Choose the handful of things that start and end your day well — they'll be waiting here each morning and night.</p>
      <button class="btn btn-ghost" onclick="showRitualsPage('habits')">Set up my rituals</button>`;
    return;
  }
  const time = currentRitualTime();
  const other = time === 'morning' ? 'night' : 'morning';
  const today = localDateStr();
  const rows = ritualRowsFor(time, today);
  const done = habitDoneByDate[today] || new Set();
  const doneCount = rows.filter(h => done.has(h.id)).length;
  const core = rows.filter(h => h.is_core);
  const extras = rows.filter(h => !h.is_core);
  const st = routineStatusFor(time, today);

  const streak = routineStreak(time);
  // On a short night the rest of the list is out of the way by default, so the
  // screen doesn't open on nine things you already know you aren't doing.
  const shortMode = todayEssentialsOnly && core.length > 0;

  // Numbered by where the habit actually sits in the ritual, not by where it
  // falls in what's on screen — so on a short night the gaps show you what
  // you're skipping rather than quietly renumbering around it.
  //
  // The number is a grip, so the order can be changed here rather than only on
  // the Rituals page: this is the list you actually look at every morning, and
  // it is the one where you notice you are doing things in the wrong order. It
  // shares the drag engine in habits.js rather than owning a second copy.
  //
  // It cannot be a button inside the tick button — that is invalid, and a
  // screen reader would find two controls where there is one row — so the row
  // is a wrapper holding a grip and a tick side by side.
  //
  // No grip in short mode. The numbers there are positions in the full ritual
  // while only some rows are on screen, so a drag would be reordering a list
  // nobody can see all of.
  const habitBtn = h => {
    const isDone = done.has(h.id);
    const n = rows.indexOf(h) + 1;
    const tick = `<button type="button" class="day-habit${isDone ? ' done' : ''}${h.is_core ? ' core' : ''}" onclick="toggleHabitOnDate('${h.id}','${today}')" aria-pressed="${isDone}">
      <span class="day-habit-check">✓</span>${h.name.replace(/</g,'&lt;')}${h.is_core ? '<span class="day-habit-core" title="Non-negotiable">✦</span>' : ''}
    </button>`;
    if (shortMode || rows.length < 2){
      return `<div class="day-habit-row"><span class="day-habit-n" aria-hidden="true">${n}</span>${tick}</div>`;
    }
    const safeName = h.name.replace(/"/g,'&quot;');
    return `<div class="day-habit-row" data-habit-row data-habit-id="${h.id}" data-time="${time}">
      <button type="button" class="day-habit-n day-habit-grip" data-habit-grip data-habit-id="${h.id}"
        onkeydown="habitOrderKey(event,'${h.id}')"
        aria-label="${safeName} is number ${n}. Drag, or use the arrow keys, to move it."
        title="Drag to reorder">${n}</button>${tick}</div>`;
  };

  // The headline is the whole point: finishing your non-negotiables has to read
  // as having kept the ritual, not as having fallen short of the long list.
  let headline;
  if (!rows.length) headline = 'Nothing on this list yet.';
  else if (st.state === 'full') headline = 'All done — nicely held.';
  else if (st.state === 'essentials') headline = 'Your non-negotiables are done. That counts.';
  else if (core.length) headline = `${st.coreDone} of ${core.length} non-negotiables`;
  else headline = `${doneCount} of ${rows.length} so far`;

  /* The note answers one question: where do I stand. A day you can still win
     back is the most useful thing it can say, so that goes first. */
  const comeback = (typeof comebackOffer === 'function') ? comebackOffer(time) : null;
  let note = '';
  if (comeback && comeback.alreadyBack){
    note = `That's the whole list — yesterday is back, and so is the ${comeback.saves}-day run behind it.`;
  } else if (comeback){
    note = `Yesterday got away from you. Finish the whole ${time} today and you get it back, along with the ${comeback.saves} days behind it — ${comeback.done} of ${comeback.total} so far.`;
  } else if (st.state === 'essentials'){
    note = `Your non-negotiables are done, so the day is kept. The rest is yours if you want it.`;
  } else if (core.length && st.state !== 'full'){
    note = `Short on time? The ${core.length} marked ✦ are enough to keep the day.`;
  }

  card.style.display = 'block';
  card.innerHTML = `
    <div class="today-card-label">${time === 'morning' ? 'Morning ritual' : 'Night ritual'}${streak > 1 ? ` · ${streak} days of non-negotiables` : ''}</div>
    <h3>${headline}</h3>
    ${rows.length ? `
      <div class="today-ritual-list">${(shortMode ? core : rows).map(habitBtn).join('')}</div>
      ${core.length && extras.length && shortMode
        ? `<button class="today-ritual-more" onclick="todayEssentialsOnly=false; renderTodayRitual();">Show the rest of my ${time} (${extras.filter(h=>done.has(h.id)).length} of ${extras.length} done) →</button>` : ''}
      ${note ? `<p class="today-ritual-note">${note}</p>` : ''}
      <div class="today-progress"><i style="width:${Math.round(doneCount / rows.length * 100)}%"></i></div>
      ${core.length && extras.length && !shortMode && st.state !== 'full'
        ? `<button class="today-ritual-more" onclick="todayEssentialsOnly=true; renderTodayRitual();">Tired tonight? Just the non-negotiables →</button>` : ''}
    ` : '<p>Nothing on this list yet. <button class="today-ritual-more" onclick="showRitualsPage(\'habits\')">Set it up →</button></p>'}
    <button class="today-ritual-more" onclick="todayRitualTime='${other}'; todayEssentialsOnly=false; renderTodayRitual();">Show my ${other} ritual →</button>`;
}
function renderTodayPage_Page(){
  const card = document.getElementById('todayPageCard');
  const today = localDateStr();
  const entry = journalPhotosByDate[today];
  const streak = streakFromDays(new Set(Object.keys(journalPhotosByDate)));
  card.style.display = 'block';
  if (entry){
    card.innerHTML = `
      <div class="today-quiet">
        <div class="today-quiet-main">
          <div class="today-card-label">Today's page</div>
          <h3>Logged${streak > 1 ? ` · ${streak}-day streak` : ''}</h3>
          <p>${entry.caption ? entry.caption.replace(/</g,'&lt;') : 'Tap to add a summary of what you wrote.'}</p>
        </div>
        <img class="today-thumb" src="${entry.url}" alt="Today's journal page">
      </div>
      <button class="today-ritual-more" onclick="showRitualsPage('calendar')">Open the calendar →</button>`;
  } else {
    card.innerHTML = `
      <div class="today-card-label">Today's page</div>
      <h3>Not logged yet</h3>
      <p>Write your entry by hand, then photograph the page — that's the whole practice.${streak > 0 ? ` You're ${streak} day${streak === 1 ? '' : 's'} in.` : ''}</p>
      <button class="btn btn-ghost" onclick="showRitualsPage('calendar'); setTimeout(() => openDayDetail(localDateStr()), 250);">Check in</button>`;
  }
}
window.addEventListener('popstate', (e) => {
  const page = e.state && e.state.page;
  if (page === 'profile') document.body.setAttribute('data-view','profile');
  else if (page === 'library'){ document.body.setAttribute('data-view','library'); renderMyLibraryState(); }
  else if (page === 'journal') document.body.setAttribute('data-view','journal');
  else if (page === 'rituals'){ document.body.setAttribute('data-view','rituals'); renderRitualsState(); }
  else if (page === 'today'){ document.body.setAttribute('data-view','today'); renderTodayPage(); }
  else if (page === 'reprogram') document.body.setAttribute('data-view','reprogram');
  else if (page === 'build') document.body.setAttribute('data-view','build');
  else document.body.removeAttribute('data-view');
});


/* ---------- the last three ----------
   Under the Journey, so choosing what to play tonight is one tap from the
   screen you already opened rather than a trip to another page.

   Three, not all of them: this is "what am I listening to tonight", and the
   full shelf is what the Subliminals tab is for. */
let todaySubs = [];
let todaySubChosen = null;

async function loadTodaySubs(){
  if (!sb || !currentUser){ todaySubs = []; return; }
  /* Two queries rather than one. cover_path arrives with 20260925 and that
     migration has not been run, so asking for it in the same select failed the
     whole thing and the row came back empty -- with no error anywhere, because
     I had written the empty case as the quiet fallback. A missing cover must
     cost the cover, not the list. */
  const { data, error } = await fetchOnce('todaySubs', () => sb.from('subliminals')
    .select('id, title, duration_seconds')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false }).limit(3));
  if (error){ forgetFetch('todaySubs'); console.warn('subliminals:', error.message); todaySubs = []; return; }
  todaySubs = (data || []).map(s => ({ ...s }));
  if (!todaySubChosen && todaySubs.length) todaySubChosen = todaySubs[0].id;
  /* The cover art is a second question, and the page does not need its answer
     to be useful -- the titles, the lengths and the play button are all here
     already. So it is not waited for: it goes and gets them, and paints them
     over the cards when they arrive. This is what kept opening the app a whole
     round trip slower than it needed to be. */
  if (todaySubs.length) loadTodaySubCovers();
}
async function loadTodaySubCovers(){
  const ids = todaySubs.map(s => s.id);
  if (!ids.length) return;
  const { data: art } = await fetchOnce('todaySubCovers', () => sb.from('subliminals')
    .select('id, cover_path').in('id', ids));
  if (!art) return;
  let changed = false;
  for (const a of art){
    const row = todaySubs.find(s => s.id === a.id);
    if (row && row.cover_path !== a.cover_path){ row.cover_path = a.cover_path; changed = true; }
  }
  if (changed && document.body.getAttribute('data-view') === 'today') renderTodaySession(todayNewestSub);
}

async function showTodaySubCover(id, path){
  const host = document.getElementById('sessArt-' + id);
  if (!host || !path) return;
  const builtin = (typeof builtinCoverUrl === 'function') ? builtinCoverUrl(path) : null;
  if (builtin){
    host.style.backgroundImage = `url("${builtin}")`;
    host.classList.add('has-art');
    return;
  }
  if (!sb) return;
  const { data, error } = await sb.storage.from('covers').createSignedUrl(path, 3600);
  if (error || !data) return;
  host.style.backgroundImage = `url("${data.signedUrl}")`;
  host.classList.add('has-art');
}

function chooseTodaySub(id){
  todaySubChosen = id;
  renderTodaySession(null);
}

/* Play whichever is chosen, without leaving Today. The tick comes from
   light_ledger like every other quest — playing it is what checks it off, and
   awardLight already refuses to pay twice in a day. */
function playTodaySubliminal(){
  /* Pause, not stop. Everywhere else in the app the second press on a playing
     session pauses it and keeps your place; this card used to be the one
     button that threw the session away. */
  if (finalPlaying){ toggleImmersivePlayback(); renderTodaySession(null); renderTodayJourney(); return; }
  if (typeof primeAudio === 'function') primeAudio();   // inside the tap
  const id = todaySubChosen || (todaySubs[0] && todaySubs[0].id);
  if (!id){ showBuildPage(); return; }
  /* Loading a saved subliminal takes a moment, and a button that looks
     unchanged for that moment reads as a button that did nothing. */
  const card = document.getElementById('todaySessionCard');
  const btn = card && card.querySelector('.btn-primary');
  if (btn){ btn.textContent = 'Starting…'; btn.disabled = true; }
  if (typeof playFromLibrary === 'function'){
    playFromLibrary(id);
    setTimeout(() => { renderTodaySession(null); renderTodayJourney(); }, 900);
  } else showBuildPage();
}
