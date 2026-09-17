/* today.js — the Today page and rolling over at midnight

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- Today ----------
   The one screen a member should be able to open, act on, and close. Three
   cards at most: the session, the ritual that fits the hour, today's page. */
let todayRitualTime = null;       // 'morning' | 'night' — null means follow the clock
let todayEssentialsOnly = false;  // the short-routine view, for the nights you have nothing left
function currentRitualTime(){
  return todayRitualTime || (new Date().getHours() < 16 ? 'morning' : 'night');
}
function greetingForHour(){
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ---------- rolling over at midnight ----------
   This is a bedtime app: you check your night ritual off in bed and open it
   again the next morning, without ever reloading. The date used to be worked
   out once when the page loaded and never again, so last night's ticks stayed
   on screen all morning and the day only appeared to "reset" when the page
   happened to refresh. Watch the real date instead — on a slow timer, and every
   time the app comes back to the foreground, which is how a phone actually
   returns to it — and turn the page over in place when it changes.

   Nothing is erased by this. Each check-in is stored against its own date, so
   yesterday keeps its ticks in the calendar and its place in the streak; today
   simply starts empty. */
let currentDayStr = localDateStr();
async function rollOverDayIfNeeded(){
  const now = localDateStr();
  if (now === currentDayStr) return;
  currentDayStr = now;
  todayRitualTime = null;      // a new day follows the clock again, not last night's choice
  todayEssentialsOnly = false; // and opens on the full list again

  const dateEl = document.getElementById('todayDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });

  if (!sb || !currentUser) return;
  // Refetch rather than trusting what's in memory — the day may also have been
  // logged on another device before this one woke up.
  await loadHabits({ silent: true });
  await loadJournalPhotos({ silent: true });
  if (document.body.getAttribute('data-view') === 'today'){
    const greetEl = document.getElementById('todayGreeting');
    if (greetEl) greetEl.textContent = greetingForHour() + (greetEl.textContent.includes(',') ? ',' + greetEl.textContent.split(',').slice(1).join(',') : '');
    renderTodayRitual();
    renderWeekStrip();
    renderTodayPage_Page();
    applySky();              // yesterday's choice of sky expires with yesterday
    renderHigherSelfCard();  // and what she says is read off the new day's list
  }
  if (document.getElementById('habitsPanel').style.display !== 'none') renderHabits();
  renderPhotoCalendar();
  renderWeekReport();
  renderDailyLogReward();
}
// Half a minute is often enough to turn over within moments of midnight, and
// cheap enough to leave running all night.
setInterval(rollOverDayIfNeeded, 30000);
// The clock crosses into day or night without the date changing, so the sky
// is checked on its own beat as well as at rollover.
setInterval(applySky, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) rollOverDayIfNeeded(); });
window.addEventListener('focus', rollOverDayIfNeeded);
async function renderTodayPage(){
  if (!sb || !currentUser) return;
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });

  const [{ data: prof }, { data: subs }, myTier] = await Promise.all([
    sb.from('profiles').select('username, full_name').eq('id', currentUser.id).maybeSingle(),
    sb.from('subliminals').select('id, title, duration_seconds').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(1),
    getMyTier(),
    loadHigherSelf(),
    loadLight(),
    loadGrace(),
    loadSanctuary(),
    loadTodaySubs(),
    loadReflections(),
  ]);
  const name = (prof && (prof.full_name || prof.username) || '').split(' ')[0];
  document.getElementById('todayGreeting').textContent = greetingForHour() + (name ? `, ${name}` : '');

  renderTodaySession(subs && subs[0]);
  // Habits first: both the strip's streak and what she has to say read off them.
  if (tierAtLeast(myTier, 'ritual')){ await loadHabits({ silent: true }); renderTodayRitual(); }
  else document.getElementById('todayRitualCard').style.display = 'none';
  renderWeekStrip();
  renderHigherSelfCard();
  renderLightStrip();
  renderTodaySanctuaryRow();
  if (tierAtLeast(myTier, 'whisper')){ await loadJournalPhotos({ silent: true }); renderTodayPage_Page(); }
  else document.getElementById('todayPageCard').style.display = 'none';
  renderTodayJourney();   // last, so the journal load has landed and its state is real

  /* After the page is drawn, not during: a modal that arrives while Today is
     still assembling itself feels like an error rather than a question. */
  const due = (typeof reflectionDue === 'function') ? reflectionDue() : null;
  if (due) setTimeout(() => openReflection(due.time, due.date), 900);
}

/* ---------- the week, at a glance ----------
   Seven circles at the top of Today, the way Calm does it. It answers one
   question before you have read anything else: have I been here this week.

   Filled means you practised — a habit ticked or a page written, which is the
   same test the calendar and the streak already use, so no screen can disagree
   with another about whether a day counted.

   Days ahead of today are drawn but empty. They are not failures yet, and a
   week that shows four blanks the moment it starts on Monday reads as being
   four behind rather than four to come. */
function weekStripDays(){
  const today = localDateStr();
  const d = new Date(today + 'T00:00:00');
  // Monday first. getDay() is 0 for Sunday, which would put Sunday at the front.
  const back = (d.getDay() + 6) % 7;
  const monday = shiftDateStr(today, -back);
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftDateStr(monday, i);
    return {
      date,
      letter: ['M','T','W','T','F','S','S'][i],
      full: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i],
      isToday: date === today,
      future: date > today,
      done: date <= today && practisedOn(date),
    };
  });
}

function renderWeekStrip(){
  const el = document.getElementById('weekStrip');
  if (!el) return;
  const days = weekStripDays();
  const kept = days.filter(d => d.done).length;
  el.innerHTML = `
    <div class="week-days" role="group" aria-label="This week: ${kept} of 7 days practised">
      ${days.map(d => `
        <div class="week-day${d.done ? ' is-done' : ''}${d.isToday ? ' is-today' : ''}${d.future ? ' is-future' : ''}">
          <span class="wd-dot" role="img"
            aria-label="${d.full}${d.isToday ? ', today' : ''} — ${d.future ? 'still to come' : d.done ? 'practised' : 'not yet'}">
            ${d.done ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </span>
          <span class="wd-letter" aria-hidden="true">${d.letter}</span>
        </div>`).join('')}
    </div>`;
  el.style.display = 'block';
}
