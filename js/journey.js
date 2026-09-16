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
    const rows = habitsCache.filter(h => h.time_of_day === t);
    if (!rows.length) return null;
    const st = routineStatusFor(t, today);
    return { done: st.state === 'full' || st.state === 'essentials', st, rows };
  };
  const morning = ritual('morning'), night = ritual('night');
  const list = [];
  if (morning) list.push({ key:'morning', label:'Morning ritual', done:morning.done,
    detail:`${morning.st.done} of ${morning.st.total}`, go:() => { todayRitualTime='morning'; renderTodayRitual(); renderTodayJourney(); } });
  list.push({ key:'journal', label:'Journal', done: !!journalPhotosByDate[today],
    detail: journalPhotosByDate[today] ? 'Logged' : 'Not yet', go:() => showRitualsPage('calendar') });
  list.push({ key:'subliminal', label:'Subliminal', done: lightToday.has(LIGHT_SOURCES.subliminal),
    detail: lightToday.has(LIGHT_SOURCES.subliminal) ? 'Played' : 'Not yet', go:() => showBuildPage() });
  if (night) list.push({ key:'night', label:'Night ritual', done:night.done,
    detail:`${night.st.done} of ${night.st.total}`, go:() => { todayRitualTime='night'; renderTodayRitual(); renderTodayJourney(); } });
  return list;
}

/* The next thing worth doing. Morning before the afternoon, night after it, and
   the practice you have actually left undone before either. */
function nextQuest(quests){
  const undone = quests.filter(q => !q.done);
  if (!undone.length) return null;
  const evening = currentRitualTime() === 'night';
  const order = evening ? ['night','journal','subliminal','morning'] : ['morning','subliminal','journal','night'];
  for (const key of order){ const q = undone.find(u => u.key === key); if (q) return q; }
  return undone[0];
}

function renderTodayJourney(){
  const card = document.getElementById('todayJourneyCard');
  if (!card) return;
  const quests = journeyQuests();
  if (!quests.length){ card.style.display = 'none'; return; }
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
        <button type="button" onclick="journeyGo('${q.key}')">
          <span class="jq-tick" aria-hidden="true">${q.done ? '✓' : ''}</span>
          <span class="jq-label">${q.label}</span>
          <span class="jq-detail">${q.detail}</span>
        </button>
      </li>`).join('')}</ul>`;
}
function journeyGo(key){
  const q = journeyQuests().find(x => x.key === key);
  if (q) q.go();
}

function renderTodaySession(lastSub){
  const card = document.getElementById('todaySessionCard');
  const evening = new Date().getHours() >= 16;
  if (lastSub){
    const mins = Math.round((lastSub.duration_seconds || 0) / 60);
    card.innerHTML = `
      <div class="today-card-label">${evening ? 'Tonight' : 'Today'}</div>
      <h3>${(lastSub.title || 'Your subliminal').replace(/</g,'&lt;')}</h3>
      <p>${mins ? `${formatSessionLength(mins)} · ` : ''}the last one you saved. Put your headphones in and press play.</p>
      <button class="btn btn-primary" onclick="loadSavedIntoBuilder('${lastSub.id}')">Play it</button>
      <div class="today-links" style="justify-content:flex-start; margin-top:14px;">
        <button onclick="showBuildPage()">Build a new one</button>
      </div>`;
  } else {
    card.innerHTML = `
      <div class="today-card-label">${evening ? 'Tonight' : 'Today'}</div>
      <h3>Build your first subliminal</h3>
      <p>Pick a frequency, say what you're working through, and record it in your own voice. It takes about five minutes.</p>
      <button class="btn btn-primary" onclick="showBuildPage()">Start</button>`;
  }
}
function renderTodayRitual(){
  const card = document.getElementById('todayRitualCard');
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
  const rows = habitsCache.filter(h => h.time_of_day === time);
  const today = localDateStr();
  const done = habitDoneByDate[today] || new Set();
  const doneCount = rows.filter(h => done.has(h.id)).length;
  const core = rows.filter(h => h.is_core);
  const extras = rows.filter(h => !h.is_core);
  const st = routineStatusFor(time, today);
  const left = shortRoutinesLeft(time, today);
  const streak = routineStreak(time);
  // On a short night the rest of the list is out of the way by default, so the
  // screen doesn't open on nine things you already know you aren't doing.
  const shortMode = todayEssentialsOnly && core.length > 0;

  // Numbered by where the habit actually sits in the ritual, not by where it
  // falls in what's on screen — so on a short night the gaps show you what
  // you're skipping rather than quietly renumbering around it.
  const habitBtn = h => {
    const isDone = done.has(h.id);
    const n = rows.indexOf(h) + 1;
    return `<button type="button" class="day-habit${isDone ? ' done' : ''}${h.is_core ? ' core' : ''}" onclick="toggleHabitOnDate('${h.id}','${today}')" aria-pressed="${isDone}">
      <span class="day-habit-n" aria-hidden="true">${n}</span><span class="day-habit-check">✓</span>${h.name.replace(/</g,'&lt;')}${h.is_core ? '<span class="day-habit-core" title="Non-negotiable">✦</span>' : ''}
    </button>`;
  };

  // The headline is the whole point: finishing your non-negotiables has to read
  // as having kept the ritual, not as having fallen short of the long list.
  let headline;
  if (!rows.length) headline = 'Nothing on this list yet.';
  else if (st.state === 'full') headline = 'All done — nicely held.';
  else if (st.state === 'essentials') headline = 'Your non-negotiables are done. That counts.';
  else if (core.length) headline = `${st.coreDone} of ${core.length} non-negotiables`;
  else headline = `${doneCount} of ${rows.length} so far`;

  let note = '';
  if (st.state === 'essentials'){
    note = left > 0
      ? `A short ${time}, and your streak holds. ${left} more left this week.`
      : `That's both short ${time}s this week — your streak still holds today.`;
  } else if (core.length && st.state !== 'full'){
    note = left > 0
      ? `Short on time? The ${core.length} marked ✦ are enough to keep the ritual. ${left} left this week.`
      : `You've used both short ${time}s this week — tonight it's the full list that keeps the streak.`;
  }

  card.style.display = 'block';
  card.innerHTML = `
    <div class="today-card-label">${time === 'morning' ? 'Morning ritual' : 'Night ritual'}${streak > 1 ? ` · ${streak}-day streak` : ''}</div>
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

