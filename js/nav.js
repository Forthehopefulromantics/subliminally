/* nav.js — which page you are on, and how you get between them

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- profile ---------- */
/* ---------- page toggle: home / profile / my-library (all one file, no separate pages to keep in sync) ---------- */
function showProfilePage(){
  if (!currentUser){ openAuthModal(); return; }
  document.body.setAttribute('data-view', 'profile');
  window.scrollTo(0,0);
  history.pushState({ page:'profile' }, '', '#profile');
  /* Settings used to be drawn once, when the session settled, and never again.
     Anything answered after that -- a faith chosen in onboarding, a plan bought
     ten seconds ago -- was still showing the state of the page at sign-in when
     somebody came here to check it. It is a cached read in every case that
     matters, so redrawing on open costs nothing and is never stale. */
  renderProfileState();
}
function showLibraryPage(){
  document.body.setAttribute('data-view', 'library');
  window.scrollTo(0,0);
  history.pushState({ page:'library' }, '', '#library');
  // Your own subliminals are the reason you opened this — the ready-made ones
  // are a browse, not a destination. Signed out there's nothing of yours to show.
  setLibraryTab(currentUser ? 'mine' : 'premade');
}
function setLibraryTab(tab){
  document.querySelectorAll('.journal-tabs [data-libtab]').forEach(b => b.classList.toggle('active', b.dataset.libtab === tab));
  document.getElementById('libraryTabPremade').style.display = tab === 'premade' ? 'block' : 'none';
  document.getElementById('libraryTabMine').style.display = tab === 'mine' ? 'block' : 'none';
  if (tab === 'mine') renderMyLibraryState();
}
function renderMyLibraryState(){
  document.body.setAttribute('data-signed-in', currentUser ? 'yes' : 'no');
  document.getElementById('myLibraryLocked').style.display = currentUser ? 'none' : 'block';
  document.getElementById('myLibraryPanel').style.display = currentUser ? 'block' : 'none';
  if (currentUser) loadMyLibrary();
}
/* ---------- interactive science quiz ---------- */
const REPROGRAM_ANSWERS = {
  sleep: `<b>On sleep specifically:</b> the research on the pre-sleep window is genuinely one of the stronger pieces here. As you drift toward sleep, the brain shifts out of tight critical-analysis mode — it's the same territory where racing, looping thoughts tend to feel loudest. A calm, repeated line in your own voice, layered under a steady tone, gives that same drowsy window something gentler to loop on instead. Try a longer Ritual session timed right as you're winding down, not after you're already trying to force sleep.`,
  confidence: `<b>On confidence:</b> this leans hardest on the self-referential processing point — information framed as being about you, in your own voice, tends to get encoded more deeply than the same words from someone else. That's a real finding behind why journaling and self-talk work as tools at all. Repetition strengthens whichever pathway gets used, so the actual mechanism here is closer to "practice" than "magic" — which is honestly a better guarantee.`,
  anxiety: `<b>On anxious, looping thoughts:</b> the honest framing is that this won't out-argue a racing mind mid-spiral — nothing bypasses your conscious mind that easily, despite what "subliminal" branding often implies. What it can do is give the pre-sleep window, when filtering naturally eases, something calmer to loop on instead of the same worry track. Pair a grounding frequency with a slower, present-tense line, and keep expectations realistic: this is a nightly practice, not a single-session fix.`,
  relationships: `<b>On relationships — with others or with yourself:</b> repetition and self-talk research both point to the same place: how you talk to yourself, repeatedly, shapes the baseline you bring into other relationships. There's nothing here that replaces communication or therapy where that's needed — but a consistent, calm, self-directed practice is a reasonable complement to that work, not a substitute for it.`
};
function answerReprogramQuiz(btn, key){
  document.querySelectorAll('#reprogramQuizChips .length-chip').forEach(c => c.classList.remove('sel'));
  btn.classList.add('sel');
  const result = document.getElementById('reprogramQuizResult');
  result.innerHTML = REPROGRAM_ANSWERS[key] || '';
  result.classList.add('show');
}

function showJournalPage(tab){
  document.body.setAttribute('data-view', 'journal');
  window.scrollTo(0,0);
  history.pushState({ page:'journal' }, '', '#journal');
  if (tab) setJournalTab(tab);
}
function showRitualsPage(tab){
  document.body.setAttribute('data-view', 'rituals');
  window.scrollTo(0,0);
  history.pushState({ page:'rituals' }, '', '#rituals');
  setRitualsTab(tab || ritualsTab);
}
function showReprogramPage(){
  document.body.setAttribute('data-view', 'reprogram');
  window.scrollTo(0,0);
  history.pushState({ page:'reprogram' }, '', '#reprogram');
  /* The tapping and visualization tabs each carry a row of starting points whose
     locks depend on the plan, so they are drawn when the page opens rather than
     once at load — a purchase or a sign-in in between would otherwise leave the
     wrong locks on them. */
  renderSessionCategories();
}
function setScienceTab(tab){
  document.querySelectorAll('[data-scitab]').forEach(b => b.classList.toggle('active', b.dataset.scitab === tab));
  document.getElementById('scienceTabSubliminals').style.display = tab === 'subliminals' ? 'block' : 'none';
  document.getElementById('scienceTabEft').style.display = tab === 'eft' ? 'block' : 'none';
  document.getElementById('scienceTabVisualization').style.display = tab === 'visualization' ? 'block' : 'none';
  if (tab === 'eft' || tab === 'visualization') renderSessionCategories();
}
const scienceEftPointsList = document.getElementById('scienceEftPointsList');
if (scienceEftPointsList){
  EFT_LINE_POINTS.slice(1).forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${p.label}</b> — ${p.where}`;
    scienceEftPointsList.appendChild(li);
  });
}
const scienceFreqGuideList = document.getElementById('scienceFreqGuideList');
if (scienceFreqGuideList){
  FREQS.forEach(f => {
    const card = document.createElement('div'); card.className = 'freq-guide-card';
    card.innerHTML = `<div class="hz">${f.hz} Hz<span>${f.word}</span></div><p>${f.guide}</p>`;
    scienceFreqGuideList.appendChild(card);
  });
}
const scienceBinauralGuideList = document.getElementById('scienceBinauralGuideList');
if (scienceBinauralGuideList){
  Object.values(BINAURAL_BANDS).forEach(b => {
    const card = document.createElement('div'); card.className = 'freq-guide-card';
    card.innerHTML = `<div class="hz">${b.label}<span>${b.range}</span></div><p>${b.guide}</p>`;
    scienceBinauralGuideList.appendChild(card);
  });
}
/* The marketing page — hero, science, the builder, pricing. Anything that
   scrolls to a section down there (goTo) has to come through here first. */
/* The builder is a room you walk into, not something you scroll past on the way
   down the homepage. It used to live inside the marketing page, which meant a
   first-time visitor met a grid of ten frequencies before deciding anything, and
   "Start" on Today threw you out to the marketing page and scroll-jumped. */
function showBuildPage(){
  document.body.setAttribute('data-view', 'build');
  window.scrollTo(0,0);
  history.pushState({ page:'build' }, '', '#build');
}
function showMarketingHome(){
  document.body.removeAttribute('data-view');
  window.scrollTo(0,0);
  history.pushState({ page:'home' }, '', location.pathname);
}
/* "Home" means Today once you're signed in, and the marketing page if not. */
function goHome(){
  if (currentUser){ showTodayPage(); return; }
  showMarketingHome();
}
function showTodayPage(){
  if (!currentUser){ showMarketingHome(); return; }
  document.body.setAttribute('data-view', 'today');
  window.scrollTo(0,0);
  history.pushState({ page:'today' }, '', '#today');
  renderTodayPage();
}

