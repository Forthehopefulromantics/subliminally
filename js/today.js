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
  ]);
  const name = (prof && (prof.full_name || prof.username) || '').split(' ')[0];
  document.getElementById('todayGreeting').textContent = greetingForHour() + (name ? `, ${name}` : '');

  renderTodaySession(subs && subs[0]);
  // Habits first: both the strip's streak and what she has to say read off them.
  if (tierAtLeast(myTier, 'ritual')){ await loadHabits({ silent: true }); renderTodayRitual(); }
  else document.getElementById('todayRitualCard').style.display = 'none';
  renderHigherSelfCard();
  renderLightStrip();
  renderTodaySanctuaryRow();
  if (tierAtLeast(myTier, 'whisper')){ await loadJournalPhotos({ silent: true }); renderTodayPage_Page(); }
  else document.getElementById('todayPageCard').style.display = 'none';
  renderTodayJourney();   // last, so the journal load has landed and its state is real
}
