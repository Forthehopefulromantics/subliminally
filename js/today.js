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
  await loadHabits({ silent: true, force: true });
  await loadJournalPhotos({ silent: true, force: true });
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
/* ---------- opening Today ----------
   This used to be one long await: fifteen questions to the database, five of
   them waiting on the one before, and nothing drawn until the last answer came
   back. At a desk that is a blink. On a phone, where a round trip can take a
   second or more, it is ten or twenty seconds of a screen that looks like the
   tap never landed -- so you tap again, and wait again.

   So it is in two halves now. `paintToday` draws the whole page from what is
   already in memory and returns straight away; `refreshToday` goes and asks,
   and paints again when the answers arrive. Coming back to Today, everything
   is already there and the refresh only corrects it. The one time you see an
   empty screen is the very first load, and that one is genuinely waiting on
   the network no matter what we do.

   `todayPainted` is what tells the two apart: before the first real data has
   landed we show the quiet placeholder rather than a page full of zeroes. */
let todayPainted = false;
let todayProfile = null, todayNewestSub = null;
/* Kept across launches so the very first paint puts the right cards up rather
   than flashing a member's cards at someone on the free plan, or the other way
   round. It only decides what is drawn for the second before the real answer
   lands -- what you are actually allowed to do is checked at the point you do
   it, and on the server. */
let todayTier = (function(){ try { return localStorage.getItem('fthr_tier') || 'ritual'; } catch(e){ return 'ritual'; } })();
let todayRefreshing = null;
function renderTodayPage(){
  if (!sb || !currentUser) return;
  paintToday();
  refreshToday();
}
/* Everything here reads memory only. No awaits, nothing that can fail on a bad
   connection -- so it always finishes inside the same frame as the tap. */
function paintToday(){
  const dateEl = document.getElementById('todayDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
  const name = (todayProfile && (todayProfile.full_name || todayProfile.username) || '').split(' ')[0];
  const greetEl = document.getElementById('todayGreeting');
  if (greetEl) greetEl.textContent = greetingForHour() + (name ? `, ${name}` : '');

  document.body.classList.toggle('today-loading', !todayPainted);
  renderTodaySession(todayNewestSub);
  const ritualCard = document.getElementById('todayRitualCard');
  if (tierAtLeast(todayTier, 'ritual')) renderTodayRitual();
  else if (ritualCard && todayPainted) ritualCard.style.display = 'none';
  renderWeekStrip();
  renderHigherSelfCard();
  renderLightStrip();
  renderTodaySanctuaryRow();
  const pageCard = document.getElementById('todayPageCard');
  if (tierAtLeast(todayTier, 'whisper')) renderTodayPage_Page();
  else if (pageCard && todayPainted) pageCard.style.display = 'none';
  renderTodayJourney();
}
function refreshToday(){
  // One refresh at a time. Tapping Today twice used to start the whole set of
  // questions over again on top of the set already in the air.
  if (todayRefreshing) return todayRefreshing;
  todayRefreshing = renderTodayPageFresh().finally(() => { todayRefreshing = null; });
  return todayRefreshing;
}
async function renderTodayPageFresh(){
  if (!sb || !currentUser) return;

  /* `loadTodaySubs` already fetches the newest three, newest first, so the
     newest one is the head of that list -- asking for it separately was a
     second trip for a row we were about to have anyway. */
  /* All of it at once. The habits and the photo log used to be a second round
     of waiting after this one, on the grounds that the plan decides whether to
     show them -- but the plan only decides what is *drawn*, not what is worth
     asking for, and the answer was already on its way for anyone on a paid
     plan, which is who is looking at this screen. One wait instead of two. */
  const [prof, myTier] = await Promise.all([
    myProfile(),
    getMyTier(),
    loadHigherSelf(),
    loadFaith(),
    loadLight(),
    loadGrace(),
    loadSanctuary(),
    loadTodaySubs(),
    loadReflections(),
    loadHabits({ silent: true }),
    loadJournalPhotos({ silent: true }),
  ]);
  todayProfile = prof || todayProfile;
  todayNewestSub = todaySubs[0] || todayNewestSub;
  todayTier = myTier;
  try { localStorage.setItem('fthr_tier', myTier); } catch(e){}

  todayPainted = true;
  paintToday();

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
  /* An empty circle means you did not practise that day, and while the week is
     still loading we do not know that about any of it. Saying it anyway, for
     the second before the answer lands, tells you that you missed Monday. So
     until the answer is here the whole week is drawn as unknown. */
  const days = weekStripDays().map(d => todayPainted ? d : { ...d, done:false, unknown:!d.future });
  const kept = days.filter(d => d.done).length;
  el.innerHTML = `
    <div class="week-days" role="group" aria-label="This week: ${kept} of 7 days practised">
      ${days.map(d => `
        <div class="week-day${d.done ? ' is-done' : ''}${d.isToday ? ' is-today' : ''}${d.future ? ' is-future' : ''}${d.unknown ? ' is-unknown' : ''}">
          <span class="wd-dot" role="img"
            aria-label="${d.full}${d.isToday ? ', today' : ''} — ${d.unknown ? 'loading' : d.future ? 'still to come' : d.done ? 'practised' : 'not yet'}">
            ${d.done ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </span>
          <span class="wd-letter" aria-hidden="true">${d.letter}</span>
        </div>`).join('')}
    </div>`;
  el.style.display = 'block';
}
