/* journal.js — gratitude and manifesting, and the calendar of handwritten pages

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- journal ----------
   Four tabs share this page. 'received' and 'manifesting' are the written
   gratitude/manifestation entries (journal_entries); 'photos' is the daily
   log of photographed handwritten pages (journal_photos + storage bucket);
   'habits' is the morning/night habit tracker (habits + habit_checkins).
   Every tab here needs Ritual — it is the one paid plan. */
const JOURNAL_TAB_COPY = {
  received:     { placeholder: 'I am so grateful for…',      prompt: "A good morning practice: write down three things you're grateful for, right when you wake up." },
  manifesting:  { placeholder: 'I am so grateful now that…', prompt: "Try one thing you're grateful for that hasn't arrived yet — write it, or say it out loud, as if it already has." },
};
function setJournalTab(cat){
  journalTab = cat;
  document.querySelectorAll('#journal .journal-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.cat===cat));
  const copy = JOURNAL_TAB_COPY[cat];
  document.getElementById('journalPrompt').textContent = copy.prompt;
  document.getElementById('journalInput').placeholder = copy.placeholder;
  document.getElementById('journalAddMsg').textContent = '';
  renderJournalState();
}
/* Journal page — gratitude and manifesting, both Ritual features. */
async function renderJournalState(){
  const locked = document.getElementById('journalLocked');
  const upgrade = document.getElementById('journalUpgrade');
  const panel = document.getElementById('journalPanel');
  const philosophy = document.getElementById('journalPhilosophy');
  const preview = document.getElementById('journalPreview');
  panel.style.display = 'none';
  upgrade.style.display = 'none';
  if (preview) preview.style.display = 'none';
  // The 3D/4D/5D explainer is a Ritual feature — it only appears once the
  // tier check below has passed and the Manifesting tab is open.
  philosophy.style.display = 'none';
  locked.style.display = currentUser ? 'none' : 'block';
  if (!currentUser) return;

  const journalTier = await getMyTier();
  if (!tierAtLeast(journalTier, featureRequiredTier('journal'))){
    // Same as the rituals panel: the figure comes off the plan catalog rather
    // than being typed into the markup where a price change cannot reach it.
    document.getElementById('journalUpgradeText').textContent =
      `Gratitude Journal, Daily Journaling, and the Manifestation tracker come with Ritual — ${tierPriceText('ritual')}.`;
    upgrade.style.display = 'block';
    renderJournalPreview(journalTier);
    return;
  }

  panel.style.display = 'block';
  philosophy.style.display = journalTab === 'manifesting' ? 'block' : 'none';
  loadJournalEntries();
}

/* ---------------- what the journal is, when you cannot open it yet ----------------
   The journal is a Ritual feature in full, so the gate above stays a gate —
   the subscription structure requires it and this is not the task that
   changes that. What it should not be is a page that says only "this is part of
   Ritual" and nothing about what "this" is.

   Every card here points at something that genuinely exists behind the gate: the
   two tabs, spoken entries, and the 3D/4D/5D explainer. Nothing is described
   that a Ritual member would then go looking for and not find.

   The blurred paragraph is the real explainer, read out of the DOM it is already
   sitting in. A mock-up would have been easier and would have been a lie. */
const JOURNAL_PREVIEW_CARDS = [
  { feature:'journal',       title:'Gratitude, first thing ✦',
    body:'Three lines the moment you wake up, in present tense, kept where you can read them back on the mornings you need to.' },
  { feature:'manifestation', title:'Future Self ✦',
    body:"Write from the perspective of the person you're becoming — \u201cI am so grateful now that\u2026\u201d — and watch the entries turn from asking into remembering." },
  { feature:'journal_voice', title:'Say it out loud ✦',
    body:'Some mornings you do not want to type. Record it in your own voice instead and it is kept exactly the same way.' },
];
function renderJournalPreview(tier){
  const host = document.getElementById('journalPreview');
  if (!host) return;
  host.innerHTML = `
    <div class="locked-preview-head">
      <h4>What the journal holds</h4>
      <p>${pwEscape(tierPriceText('ritual'))}</p>
    </div>
    <div class="locked-grid">
      ${JOURNAL_PREVIEW_CARDS.map(c => lockedCard(c.feature, { title:c.title, body:c.body, locked: !tierHasFeature(tier, c.feature), trigger:'journal_preview_card' })).join('')}
    </div>
    ${journalPhilosophyPeek()}`;
  host.style.display = 'block';
}
/* The first paragraph of the real 3D/4D/5D explainer, blurred. It is taken from
   the page rather than written out again here, so it cannot drift from the copy
   a member actually reads. If the explainer is ever removed, this quietly
   renders nothing instead of showing a stale quote. */
function journalPhilosophyPeek(){
  const para = document.querySelector('#journalPhilosophy .journal-philosophy-body p');
  const text = para ? para.textContent.trim().slice(0, 260) : '';
  if (!text) return '';
  return `<button type="button" class="locked-card is-locked locked-peek" style="margin-top:10px;"
      onclick="openUpgradeModal('manifestation', { trigger:'journal_philosophy_peek' })"
      aria-label="Why hasn't this shown up yet — locked, Ritual">
    <span class="lc-top" style="position:relative; z-index:1;">
      <span class="lc-title">Why hasn't this shown up yet? ${lockGlyph(11)}</span>
      ${premiumBadge('ritual', { small:true })}
    </span>
    <span class="lp-body" aria-hidden="true" style="font-size:12.5px; line-height:1.6; display:block; text-align:left;">${pwEscape(text)}…</span>
    <span class="lc-cta" style="position:relative; z-index:1;">Unlock →</span>
  </button>`;
}

/* ---------------- the tracker, shown as a progression ----------------
   The habit tracker is the one place where the thing being sold and the thing
   motivating the sale are the same: three habits now, three more every
   twenty-one days practised, up to fifteen. So the preview is the ladder itself,
   drawn from the constants in js/habits.js rather than from numbers typed again
   here — change HABIT_SPACES_PER_CYCLE and this moves with it.

   Her line at the bottom is the only place in this work she speaks about a plan,
   and she does it the way she speaks about everything else: as the next stretch
   of the same road. It is her real saved face, or no face at all until the
   profile row has landed — never a stand-in. */
async function renderRitualsPreview(tier, tab){
  const host = document.getElementById('ritualsPreview');
  if (!host) return;
  const isHabits = tab === 'habits';
  /* Her face comes off the profile row, and somebody who opened this page
     directly may not have read that row yet. Waiting on it is a cached lookup
     in every case that matters, and it is the difference between her actual
     saved drawing and a skeleton standing there instead. */
  if (isHabits && typeof loadHigherSelf === 'function') { try { await loadHigherSelf(); } catch(e){} }
  const cards = isHabits
    ? [
        { feature:'habit_tracker',  title:'Morning and night ✦' },
        { feature:'habit_cycles',   title:'Twenty-one day cycles ✦' },
        { feature:'habit_insights', title:'Your whole run, in colour ✦' },
      ]
    : [
        { feature:'daily_log',      title:'The page you wrote by hand ✦' },
        { feature:'journal',        title:'Gratitude, first thing ✦' },
        { feature:'manifestation',  title:'Future Self ✦' },
      ];
  host.innerHTML = `
    <div class="locked-preview-head">
      <h4>${isHabits ? 'Build your 1% better routine ✦' : 'Keep the record, keep the practice ✦'}</h4>
      <p>${pwEscape(tierPriceText('ritual'))}</p>
    </div>
    ${isHabits ? habitProgressionPeek() : ''}
    <div class="locked-grid">
      ${cards.map(c => lockedCard(c.feature, { title:c.title, locked: !tierHasFeature(tier, c.feature), trigger:'rituals_preview_card' })).join('')}
    </div>
    ${isHabits ? higherSelfUpgradeNote() : ''}`;
  host.style.display = 'block';
}
/* The ladder, with the numbers the tracker itself uses. */
function habitProgressionPeek(){
  const perCycle = HABIT_SPACES_PER_CYCLE, start = HABIT_SPACES_AT_START, days = HABIT_CYCLE_DAYS, max = HABIT_SLOTS;
  const steps = [];
  for (let spaces = start, cycle = 0; spaces < max; spaces = Math.min(max, spaces + perCycle), cycle++){
    steps.push(cycle === 0
      ? `${spaces} habits to start`
      : `+${perCycle} at ${cycle * days} days`);
    if (steps.length >= 4) break;
  }
  steps.push(`up to ${max}`);
  return `<div class="locked-progress">
    <div class="locked-progress-title">Day 1 of ${days}</div>
    <div class="locked-progress-track" role="img" aria-label="A cycle is ${days} days practised"><span class="locked-progress-fill" style="width:6%"></span></div>
    <div class="locked-progress-steps">
      ${steps.map((t, i) => `<span class="locked-progress-step" data-state="${i === 0 ? 'open' : 'ahead'}">${pwEscape(t)}</span>`).join('')}
    </div>
    <p style="font-size:12.5px; color:var(--haze); line-height:1.6; margin:0;">A cycle is ${days} days practised, not ${days} in a row — a missed day is a day that did not count, never a day that undoes the ones before it.</p>
  </div>`;
}
/* Her one line about going deeper. Progression, not a pitch, and not repeated
   anywhere else: she says this on the page somebody opened looking for the
   tracker, and nowhere they did not ask. */
function higherSelfUpgradeNote(){
  if (typeof higherSelfDialogue !== 'function') return '';
  // No face until we actually know which one is theirs. `null` is "no
  // character", which is honest; a stand-in would be somebody else's face.
  if (!higherSelfLoaded) return '';
  const name = (higherSelf.name || '').trim();
  return higherSelfDialogue({
    message: `Ready to go deeper? Ritual unlocks the morning and night we keep together — longer sessions, and more tools for the version of you we're building.`,
    speaker: name,
    avatar: higherSelfChoice(),
    emotion: 'welcoming',
    size: 'sm',
  });
}

/* Rituals page — the daily log calendar and the habit lists that fill it in. */
let ritualsTab = 'calendar';
const RITUALS_TAB_COPY = {
  calendar: "Write today's entry by hand, then photograph the page — the app keeps the record, your journal keeps the practice.",
  habits:   'A ritual is just a habit you decided to keep. Check each one off as you do it; the streak takes care of itself.',
};
function setRitualsTab(tab){
  ritualsTab = tab;
  document.querySelectorAll('#rituals .journal-tabs button').forEach(b => b.classList.toggle('active', b.dataset.rtab === tab));
  document.getElementById('ritualsPrompt').textContent = RITUALS_TAB_COPY[tab];
  renderRitualsState();
}
async function renderRitualsState(){
  const locked = document.getElementById('ritualsLocked');
  const upgrade = document.getElementById('ritualsUpgrade');
  const preview = document.getElementById('ritualsPreview');
  const calendarPanel = document.getElementById('journalPhotoPanel');
  const habitsPanel = document.getElementById('habitsPanel');
  calendarPanel.style.display = 'none';
  habitsPanel.style.display = 'none';
  upgrade.style.display = 'none';
  if (preview) preview.style.display = 'none';
  locked.style.display = currentUser ? 'none' : 'block';
  if (!currentUser) return;

  const myTier = await getMyTier();
  /* Which plan this tab needs, named once and then used for the panel copy, the
     button and the preview underneath — rather than three places each deciding
     for themselves which tier the tab belongs to. */
  const feature = ritualsTab === 'habits' ? 'habit_tracker' : 'daily_log';
  const requiredTier = featureRequiredTier(feature);
  if (!tierAtLeast(myTier, requiredTier)){
    const isHabits = ritualsTab === 'habits';
    document.getElementById('ritualsUpgradeTitle').textContent = isHabits ? 'The habit tracker is part of Ritual' : 'The daily log is part of Ritual';
    // The price comes off the plan catalog now, so a change in Stripe does not
    // leave a stale figure sitting on this panel.
    document.getElementById('ritualsUpgradeText').textContent = isHabits
      ? `Morning and night rituals, EFT tapping, and visualization scripting come with Ritual — ${tierPriceText('ritual')}.`
      : `Daily Journaling — writing by hand and logging each page here — comes with Ritual, ${tierPriceText('ritual')}.`;
    const btn = document.getElementById('ritualsUpgradeBtn');
    btn.textContent = 'See what it unlocks ✦';
    btn.onclick = () => openUpgradeModal(feature, { tier: myTier, trigger: 'rituals_panel' });
    upgrade.style.display = 'block';
    renderRitualsPreview(myTier, ritualsTab);
    return;
  }

  // Both tabs want habit data: the calendar colours each day by how much of
  // that day's ritual was kept, so it loads habits too.
  if (ritualsTab === 'habits'){
    habitsPanel.style.display = 'block';
    await loadHabits();
    /* First time here with a subscription that reaches the tracker: set the
       routine up before showing an empty one. It is checked after the gate
       above and never before it, so the setup flow cannot become a way around
       the subscription. Its own completion flag decides whether it opens --
       finishing the account questionnaire says nothing about this. */
    if (typeof maybeOpenHabitOnboarding === 'function') maybeOpenHabitOnboarding();
  }
  else {
    calendarPanel.style.display = 'block';
    if (tierAtLeast(myTier, 'ritual')) await loadHabits({ silent: true });
    loadJournalPhotos();
  }
}

/* Local calendar date as YYYY-MM-DD — habits and journal days are the
   person's own day, not UTC's. */
/* Consecutive days (ending today, or yesterday if today isn't done yet)
   present in a Set of YYYY-MM-DD strings. */
async function loadJournalEntries(){
  if (!sb || !currentUser) return;
  const list = document.getElementById('journalEntries');
  const stat = document.getElementById('journalStat');
  list.innerHTML = '<div class="journal-empty">Loading…</div>';
  stat.style.display = 'none';
  const { data, error } = await sb
    .from('journal_entries')
    .select('*')
    .eq('category', journalTab)
    .order('created_at', { ascending: false });
  if (error){ list.innerHTML = `<div class="journal-empty">Couldn't load entries.</div>`; return; }

  if (journalTab === 'received'){
    const fulfilledCount = data.filter(e => e.original_category === 'manifesting').length;
    if (fulfilledCount > 0){
      stat.style.display = 'block';
      stat.textContent = `✦ ${fulfilledCount} manifestation${fulfilledCount === 1 ? '' : 's'} you called in ${fulfilledCount === 1 ? 'has' : 'have'} made it into your 3D.`;
    }
  }

  if (!data.length){ list.innerHTML = '<div class="journal-empty">Nothing here yet — add your first entry above.</div>'; return; }

  // Spoken entries live in a private bucket, so sign them all in one round trip
  // rather than one request per card.
  const audioUrlByPath = {};
  const audioPaths = data.filter(e => e.audio_path).map(e => e.audio_path);
  if (audioPaths.length){
    const { data: signed } = await sb.storage.from('voice-notes').createSignedUrls(audioPaths, 3600);
    (signed || []).forEach(x => { if (x.signedUrl) audioUrlByPath[x.path] = x.signedUrl; });
  }

  list.innerHTML = data.map(e => {
    // Only entries that originally started in "On its way" can ever move — once
    // something's written straight into "Already mine," it stays put for good.
    const canMove = e.original_category === 'manifesting';
    const showBadge = journalTab === 'received' && canMove;
    const moveTarget = journalTab === 'received' ? 'manifesting' : 'received';
    const moveTargetLabel = journalTab === 'received' ? 'On its way' : 'Already mine';
    return `
    <div class="journal-entry">
      ${showBadge ? `<div class="journal-entry-badge" title="Made it from On its way to Already mine">✦ 2D → 3D</div>` : ''}
      ${e.audio_path ? `
        <div class="journal-entry-spoken">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 19v3"/></svg>
          Spoken${e.audio_seconds ? ` · ${Math.floor(e.audio_seconds/60)}:${String(e.audio_seconds%60).padStart(2,'0')}` : ''}
        </div>
        ${audioUrlByPath[e.audio_path]
          ? `<audio controls preload="none" src="${audioUrlByPath[e.audio_path]}"></audio>`
          : `<p style="color:var(--haze); font-size:13px;">This recording couldn't be loaded right now.</p>`}
      ` : ''}
      ${e.content ? `<p>"${e.content.replace(/</g,'&lt;')}"</p>` : ''}
      <div class="date">${new Date(e.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}${showBadge ? ' · in my 3D now' : ''}</div>
      <div class="journal-entry-actions">
        ${canMove ? `<button class="journal-entry-move" onclick="toggleMoveConfirm('${e.id}')" aria-label="Move" title="Move">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/></svg>
        </button>` : ''}
        <button class="journal-entry-delete" onclick="deleteJournalEntry('${e.id}')" aria-label="Delete entry" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
      ${canMove ? `<div class="journal-move-confirm" id="moveConfirm-${e.id}" style="display:none;">
        <span>Move this to "${moveTargetLabel}"?</span>
        <button class="mini-btn candlebtn" onclick="moveJournalEntry('${e.id}','${moveTarget}')">Yes, move it</button>
        <button class="mini-btn ghostbtn" onclick="toggleMoveConfirm('${e.id}')">Cancel</button>
      </div>` : ''}
    </div>`;
  }).join('');
}
function toggleMoveConfirm(id){
  document.querySelectorAll('.journal-move-confirm').forEach(el => {
    if (el.id !== `moveConfirm-${id}`) el.style.display = 'none';
  });
  const el = document.getElementById(`moveConfirm-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

/* Moves an entry between "On its way" and "Already mine" — only ever allowed for
   entries whose original_category is "manifesting" (enforced both by hiding the
   button client-side and by the caller only wiring it up for those entries).
   original_category itself never changes after creation, so it always tells you
   where something started, no matter how many times it's moved since. */
async function moveJournalEntry(id, targetCategory){
  if (!sb || !currentUser) return;
  const { error } = await sb.from('journal_entries')
    .update({ category: targetCategory })
    .eq('id', id)
    .eq('user_id', currentUser.id)
    .eq('original_category', 'manifesting');
  if (error){ console.error('moveJournalEntry error:', error); return; }
  loadJournalEntries();
}
async function deleteJournalEntry(id){
  if (!sb || !currentUser) return;
  // Look up the audio first — once the row is gone there's nothing pointing at
  // the file, and it would sit in storage forever.
  const { data: entry } = await sb.from('journal_entries')
    .select('audio_path').eq('id', id).eq('user_id', currentUser.id).maybeSingle();
  const { error } = await sb.from('journal_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);
  if (error){ console.error('deleteJournalEntry error:', error); return; }
  if (entry && entry.audio_path) await sb.storage.from('voice-notes').remove([entry.audio_path]);
  loadJournalEntries();
}
/* ---------- spoken gratitude & manifesting entries ----------
   Some things are easier said than written, and saying an affirmation out loud
   is the practice anyway. A spoken entry is stored as audio in the voice-notes
   bucket with no text; everything else about it behaves like a written one. */
let voiceEntryRecorder = null, voiceEntryChunks = [], voiceEntryStream = null,
    voiceEntryTimer = null, voiceEntryStart = 0;
const VOICE_ENTRY_MAX_SECONDS = 180;

function voiceEntryUI(recording){
  document.getElementById('journalVoiceRec').style.display = recording ? 'flex' : 'none';
  document.querySelector('.journal-add').style.display = recording ? 'none' : 'flex';
}
async function startVoiceEntry(){
  const msg = document.getElementById('journalAddMsg');
  if (!sb || !currentUser) return;
  if (voiceEntryRecorder) return;
  if (!navigator.mediaDevices || !window.MediaRecorder){
    msg.textContent = "This browser can't record audio — you can still type your entry.";
    msg.className = 'save-msg err'; return;
  }
  try { voiceEntryStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(e){
    msg.textContent = 'Microphone access is needed to speak your entry — check your browser permissions.';
    msg.className = 'save-msg err'; return;
  }
  msg.textContent = ''; msg.className = 'save-msg';
  const mime = pickRecordingMime();
  voiceEntryChunks = [];
  voiceEntryRecorder = mime ? new MediaRecorder(voiceEntryStream, { mimeType: mime }) : new MediaRecorder(voiceEntryStream);
  voiceEntryRecorder.ondataavailable = ev => voiceEntryChunks.push(ev.data);
  voiceEntryRecorder.start();
  voiceEntryStart = Date.now();
  voiceEntryUI(true);
  voiceEntryTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - voiceEntryStart) / 1000);
    document.getElementById('journalVoiceTime').textContent = `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
    // Long enough for anything worth saying, short enough to stay a quick habit.
    if (secs >= VOICE_ENTRY_MAX_SECONDS) finishVoiceEntry();
  }, 250);
}
function stopVoiceEntryStream(){
  clearInterval(voiceEntryTimer); voiceEntryTimer = null;
  if (voiceEntryStream){ voiceEntryStream.getTracks().forEach(t => t.stop()); voiceEntryStream = null; }
  document.getElementById('journalVoiceTime').textContent = '0:00';
  voiceEntryUI(false);
}
function cancelVoiceEntry(){
  if (!voiceEntryRecorder) return;
  voiceEntryRecorder.onstop = null;
  try { voiceEntryRecorder.stop(); } catch(e){}
  voiceEntryRecorder = null; voiceEntryChunks = [];
  stopVoiceEntryStream();
  document.getElementById('journalAddMsg').textContent = '';
}
function finishVoiceEntry(){
  if (!voiceEntryRecorder) return;
  const seconds = Math.max(1, Math.round((Date.now() - voiceEntryStart) / 1000));
  const rec = voiceEntryRecorder;
  voiceEntryRecorder = null;
  rec.onstop = () => {
    const blob = new Blob(voiceEntryChunks, { type: rec.mimeType || 'audio/webm' });
    voiceEntryChunks = [];
    stopVoiceEntryStream();
    if (seconds < 1 || !blob.size){
      document.getElementById('journalAddMsg').textContent = 'That was too short to save — try again.';
      document.getElementById('journalAddMsg').className = 'save-msg err';
      return;
    }
    saveVoiceEntry(blob, seconds);
  };
  try { rec.stop(); } catch(e){ stopVoiceEntryStream(); }
}
async function saveVoiceEntry(blob, seconds){
  const msg = document.getElementById('journalAddMsg');
  msg.textContent = 'Saving your recording…'; msg.className = 'save-msg';
  const mime = blob.type || 'audio/webm';
  const path = `${currentUser.id}/${Date.now()}.${extForMime(mime)}`;
  const { error: upErr } = await sb.storage.from('voice-notes').upload(path, blob, { contentType: mime });
  if (upErr){
    console.error('voice entry upload failed:', upErr);
    msg.textContent = "Couldn't upload that recording — try again in a moment.";
    msg.className = 'save-msg err'; return;
  }
  const { error } = await sb.from('journal_entries').insert({
    user_id: currentUser.id, category: journalTab, original_category: journalTab,
    content: null, audio_path: path, audio_seconds: seconds,
  });
  if (error){
    console.error('voice entry insert error:', error);
    // Don't leave the orphaned file sitting in storage if the row didn't land.
    await sb.storage.from('voice-notes').remove([path]);
    msg.textContent = "Couldn't save that entry — try again in a moment.";
    msg.className = 'save-msg err'; return;
  }
  msg.textContent = '';
  loadJournalEntries();
}

async function addJournalEntry(){
  const msg = document.getElementById('journalAddMsg');
  if (!sb || !currentUser) return;
  const input = document.getElementById('journalInput');
  const content = input.value.trim();
  if (!content) return;
  msg.textContent = 'Saving…'; msg.className = 'save-msg';
  const { error } = await sb.from('journal_entries').insert({ user_id: currentUser.id, category: journalTab, original_category: journalTab, content });
  if (error){
    console.error('journal insert error:', error);
    msg.textContent = "Couldn't save that entry — try again in a moment.";
    msg.className = 'save-msg err';
    return;
  }
  input.value = '';
  msg.textContent = '';
  loadJournalEntries();
}

/* ---------- daily log: calendar of handwritten pages ----------
   One photo per day (journal_photos has a unique constraint on
   user_id+entry_date — see the "one per day" migration). Tapping a day opens
   a modal: check in with a photo if the day is empty, or view/replace the
   photo and edit its summary if it already has one. */
let journalPhotosByDate = {};
let photoCalendarViewDate = new Date();
let pendingCheckInDate = null;

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('photoFile');
  if (fileInput) fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && pendingCheckInDate) uploadJournalPhoto(file, pendingCheckInDate);
    e.target.value = '';
  });
});

/* Signed links are good for an hour, so signing every photo you have ever
   taken each time a page opens is an hour's work thrown away every time. Keep
   them until they are nearly up and only ask for the ones that are missing. */
const SIGNED_PHOTO_URLS = {};   // storage_path -> { url, until }
let signingPhotos = null;       // two callers at once must not both go and sign
async function signPhotoPaths(paths){
  const now = Date.now();
  const need = paths.filter(p => !(SIGNED_PHOTO_URLS[p] && SIGNED_PHOTO_URLS[p].until > now + 60000));
  if (need.length){
    if (signingPhotos) await signingPhotos;   // one already in the air — take its answers
    const still = need.filter(p => !(SIGNED_PHOTO_URLS[p] && SIGNED_PHOTO_URLS[p].until > Date.now() + 60000));
    if (still.length){
      signingPhotos = sb.storage.from('journal-photos').createSignedUrls(still, 3600)
        .then(({ data: signed }) => {
          (signed || []).forEach(s => { if (s.signedUrl) SIGNED_PHOTO_URLS[s.path] = { url: s.signedUrl, until: Date.now() + 3600000 }; });
        })
        .finally(() => { signingPhotos = null; });
      await signingPhotos;
    }
  }
  const out = {};
  paths.forEach(p => { if (SIGNED_PHOTO_URLS[p]) out[p] = SIGNED_PHOTO_URLS[p].url; });
  return out;
}
async function loadJournalPhotos(options){
  if (!sb || !currentUser) return;
  const silent = options && options.silent;   // Today loads the photos without drawing the calendar
  if (options && options.force) forgetFetch('journalPhotos');
  const { data, error } = await fetchOnce('journalPhotos',
    () => sb.from('journal_photos').select('*').eq('user_id', currentUser.id));
  if (error){ forgetFetch('journalPhotos'); console.error('loadJournalPhotos error:', error); return; }
  const rows = data || [];
  journalPhotosByDate = {};
  rows.forEach(p => { journalPhotosByDate[p.entry_date] = { ...p, url: (SIGNED_PHOTO_URLS[p.storage_path] || {}).url || '' }; });
  /* Signing the links is a second round trip, and which days have a photo --
     which is all Today and the streak need to know -- is already answered by
     the rows above. So the pictures are fetched after, not before. */
  const unsigned = rows.filter(p => !journalPhotosByDate[p.entry_date].url);
  if (unsigned.length) signPhotoPaths(unsigned.map(p => p.storage_path)).then(urls => {
    let changed = false;
    unsigned.forEach(p => { if (urls[p.storage_path]){ journalPhotosByDate[p.entry_date].url = urls[p.storage_path]; changed = true; } });
    if (!changed) return;
    if (document.body.getAttribute('data-view') === 'today') renderTodayPage_Page();
    if (document.getElementById('photoCalendarTitle')) renderPhotoCalendar();
  });
  if (silent) return;
  renderPhotoCalendar();
  renderWeekReport();
  renderDailyLogReward();
}

function shiftPhotoMonth(delta){
  photoCalendarViewDate = new Date(photoCalendarViewDate.getFullYear(), photoCalendarViewDate.getMonth() + delta, 1);
  renderPhotoCalendar();
  renderWeekReport();
}
/* ---------- what a day was ----------
   One record, read by the calendar square, the day you open, and the weekly
   report. Three readings of the same day that disagreed with each other would
   be worse than not showing it at all. */
function dayRecord(dateStr){
  const done = habitDoneByDate[dateStr] || new Set();
  const sources = (typeof lightByDate !== 'undefined' && lightByDate[dateStr]) || new Set();
  /* `null` means this ritual had no occurrence on this day -- it did not exist
     yet, or the day is not one of its days. A null ritual is left out of the
     day's score and out of the week's counts rather than counted as a nought,
     so days before the ritual existed can't drag a percentage down. */
  const ritual = t => {
    const rows = ritualRowsFor(t, dateStr);
    if (!rows.length) return null;
    const st = routineStatusFor(t, dateStr);
    return { kept: st.state === 'full' || st.state === 'essentials', done: st.done,
             total: st.total, state: st.state };
  };
  const rec = {
    date: dateStr,
    morning: ritual('morning'),
    night: ritual('night'),
    journal: !!journalPhotosByDate[dateStr],
    subliminal: sources.has(typeof LIGHT_SOURCES !== 'undefined' ? LIGHT_SOURCES.subliminal : 'subliminal'),
    habitsDone: done.size,
    habitsTotal: habitsOnDate(dateStr).length,
  };
  // Aligned is the average of whatever that day actually had to offer. A ritual
  // scores how much of it you kept; journal and a session are yes or no. Days
  // with no rituals set up aren't marked down for not having them.
  const parts = [];
  if (rec.morning) parts.push(rec.morning.total ? rec.morning.done / rec.morning.total : 0);
  if (rec.night) parts.push(rec.night.total ? rec.night.done / rec.night.total : 0);
  parts.push(rec.journal ? 1 : 0);
  parts.push(rec.subliminal ? 1 : 0);
  rec.aligned = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100) : 0;
  rec.marks = [
    rec.morning && rec.morning.kept ? 'morning' : null,
    rec.night && rec.night.kept ? 'night' : null,
    rec.journal ? 'journal' : null,
    rec.subliminal ? 'subliminal' : null,
  ].filter(Boolean);
  return rec;
}

/* A day, in a few words. Never a grade — "you showed up" is the whole point,
   and a quiet day is still a day you came back. */
function dayVerdict(rec){
  if (rec.aligned >= 90) return 'A day you gave everything to.';
  if (rec.aligned >= 70) return 'A day you showed up.';
  if (rec.aligned >= 40) return 'A day you kept some of it.';
  if (rec.aligned > 0) return 'A day you came back.';
  return 'A quiet day.';
}

/* ---------- the week behind you ----------
   Her brief asked for a report, not a verdict. It counts what happened, names
   the practice that held best and the one that slipped, and says so without
   grading anyone. Everything here is read off dayRecord, so it can't tell a
   different story from the calendar above it. */
function weekRecords(){
  const out = [];
  for (let i = 6; i >= 0; i--) out.push(dayRecord(shiftDateStr(localDateStr(), -i)));
  return out;
}

function renderWeekReport(){
  const card = document.getElementById('weekReport');
  if (!card) return;
  const days = weekRecords();
  const practised = days.filter(d => d.habitsDone > 0 || d.journal || d.subliminal).length;
  if (!practised){ card.style.display = 'none'; return; }

  const aligned = Math.round(days.reduce((a, d) => a + d.aligned, 0) / days.length);
  const count = k => days.filter(k).length;
  const mornings = count(d => d.morning && d.morning.kept);
  const nights   = count(d => d.night && d.night.kept);
  const pages    = count(d => d.journal);
  const sessions = count(d => d.subliminal);
  // Best and worst of the four, so the note has something true to point at.
  const practices = [
    days.some(d => d.morning) ? { name:'your morning ritual', n:mornings } : null,
    days.some(d => d.night)   ? { name:'your night ritual',   n:nights }   : null,
    { name:'journalling', n:pages },
    { name:'your sessions', n:sessions },
  ].filter(Boolean).sort((a, b) => b.n - a.n);
  const best = practices[0], slipped = practices[practices.length - 1];

  const name = (typeof higherSelf !== 'undefined' && (higherSelf.name || '').trim()) || 'Your higher self';
  const cap = t => t[0].toUpperCase() + t.slice(1);
  let note;
  if (aligned >= 85) note = `A week you held onto. ${name} noticed.`;
  else if (best && slipped && best.n > slipped.n)
    note = `<b>${cap(best.name)}</b> held best this week. <b>${cap(slipped.name)}</b> had less of you — that's information, not a failing.`;
  else note = `Seven days, and you came back to ${practised} of them.`;

  card.style.display = 'block';
  card.innerHTML = `
    <div class="week-head">
      <h3>Your week</h3>
      <div class="week-aligned">${aligned}%<span style="font-size:12px; color:var(--haze); font-family:var(--sans); margin-left:5px;">aligned</span></div>
    </div>
    <div class="week-grid">
      <div class="week-stat"><b>${practised}/7</b><span>days you practised</span></div>
      ${days.some(d => d.morning) ? `<div class="week-stat"><b>${mornings}</b><span>morning ritual${mornings === 1 ? '' : 's'}</span></div>` : ''}
      ${days.some(d => d.night) ? `<div class="week-stat"><b>${nights}</b><span>night ritual${nights === 1 ? '' : 's'}</span></div>` : ''}
      <div class="week-stat"><b>${pages}</b><span>page${pages === 1 ? '' : 's'} logged</span></div>
      <div class="week-stat"><b>${sessions}</b><span>session${sessions === 1 ? '' : 's'} played</span></div>
    </div>
    <p class="week-note">${note}</p>`;
}

function renderPhotoCalendar(){
  const year = photoCalendarViewDate.getFullYear(), month = photoCalendarViewDate.getMonth();
  document.getElementById('photoCalendarTitle').textContent = photoCalendarViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const today = localDateStr();
  let html = '';
  for (let i = 0; i < totalCells; i++){
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth){ html += `<div class="cal-day cal-day-empty"></div>`; continue; }
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
    const entry = journalPhotosByDate[dateStr];
    const isFuture = dateStr > today;
    const classes = ['cal-day'];
    if (entry) classes.push('has-entry');
    if (isFuture) classes.push('is-future');
    if (dateStr === today) classes.push('is-today');
    const style = entry && entry.url ? ` style="background-image:url('${entry.url}')"` : '';
    const rec = isFuture ? null : dayRecord(dateStr);
    // Four small marks: the two rituals, a page, a session. Enough to read a
    // month at a glance without turning the square into a chart.
    const marks = rec && rec.marks.length
      ? `<span class="cal-day-marks" aria-hidden="true">${rec.marks.map(m => `<i class="cm cm-${m}"></i>`).join('')}</span>`
      : '';
    const bar = rec && rec.aligned > 0
      ? `<span class="cal-day-bar"><i style="width:${rec.aligned}%"></i></span>`
      : '';
    const title = isFuture ? ''
      : ` title="${dayNum} — ${rec.aligned}% aligned${rec.marks.length ? ', ' + rec.marks.join(', ') : ''}"`;
    html += `<button type="button" class="${classes.join(' ')}"${style}${title} ${isFuture ? 'disabled' : `onclick="openDayDetail('${dateStr}')"`}>
      <span class="cal-day-num">${dayNum}</span>
      ${!entry && !isFuture ? '<span class="cal-day-plus">+</span>' : ''}
      ${marks}${bar}
    </button>`;
  }
  document.getElementById('photoCalendarGrid').innerHTML = html;
}
function renderDailyLogReward(){
  const days = new Set(Object.keys(journalPhotosByDate));
  const streak = streakFromDays(days);
  let msg;
  if (streak === 0) msg = days.size ? "Log today to start a new streak." : "Photograph today's page to start your streak.";
  else if (streak < 3) msg = 'Off to a good start.';
  else if (streak < 7) msg = 'Building the habit.';
  else if (streak < 14) msg = "A full week — that's a real practice now.";
  else if (streak < 30) msg = 'Two weeks and still showing up.';
  else msg = "A month of showing up. That's who you are now.";
  document.getElementById('logRewardStreak').textContent = streak > 0 ? `${streak}-day streak` : `${days.size} day${days.size === 1 ? '' : 's'} logged`;
  document.getElementById('logRewardMsg').textContent = msg;

  // Second line: how much of today's ritual is kept so far.
  const habitLine = document.getElementById('logRewardHabits');
  const pct = habitCompletionFor(localDateStr());
  if (pct === null){ habitLine.style.display = 'none'; return; }
  const todayRows = habitsOnDate(localDateStr());
  const ticks = habitDoneByDate[localDateStr()] || new Set();
  const done = todayRows.filter(h => ticks.has(h.id)).length;
  const total = todayRows.length;
  habitLine.style.display = 'block';
  habitLine.textContent = pct === 1
    ? `Every habit kept today — all ${total}.`
    : `${done} of ${total} habits kept today · ${Math.round(pct * 100)}%`;
}

function dayLabel(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric' });
}
function trashIconSvg(){
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
}
function dayModalContent(dateStr){
  document.getElementById('dayModalDate').textContent = dayLabel(dateStr);
  const body = document.getElementById('dayModalBody');
  const entry = journalPhotosByDate[dateStr];
  if (dateStr > localDateStr()){ body.innerHTML = `<p class="journal-empty">This day hasn't happened yet.</p>`; return; }
  const rec = dayRecord(dateStr);
  const practice = [
    rec.morning ? { label:'Morning ritual', on:rec.morning.kept, detail:`${rec.morning.done} of ${rec.morning.total}` } : null,
    { label:'Journal', on:rec.journal, detail: rec.journal ? 'Logged' : '—' },
    { label:'Subliminal', on:rec.subliminal, detail: rec.subliminal ? 'Played' : '—' },
    rec.night ? { label:'Night ritual', on:rec.night.kept, detail:`${rec.night.done} of ${rec.night.total}` } : null,
  ].filter(Boolean);
  const memory = `
    <p class="day-verdict">${dayVerdict(rec)}</p>
    <p class="day-aligned"><b>${rec.aligned}%</b> aligned</p>
    <ul class="day-practice">${practice.map(p => `
      <li class="${p.on ? 'on' : ''}"><span class="dp-tick" aria-hidden="true">${p.on ? '✓' : ''}</span>
        <span class="dp-label">${p.label}</span><span class="dp-detail">${p.detail}</span></li>`).join('')}</ul>`;

  const pageHtml = memory + (entry
    ? `<img class="day-modal-photo" src="${entry.url}" alt="Journal page from ${dayLabel(dateStr)}">
      <label class="day-modal-label">Summary of the page</label>
      <textarea id="dayModalCaption" rows="3" maxlength="200" placeholder="What this page was about…">${(entry.caption || '').replace(/</g,'&lt;')}</textarea>
      <div class="day-modal-actions">
        <button class="mini-btn candlebtn" onclick="saveDayCaption('${dateStr}')">Save summary</button>
        <button class="mini-btn ghostbtn" onclick="triggerCheckIn('${dateStr}')">Replace photo</button>
        <button class="habit-delete" onclick="deleteDayEntry('${dateStr}')" aria-label="Delete this day's page" title="Delete">${trashIconSvg()}</button>
      </div>`
    : `<p class="journal-empty">No page logged for this day yet.</p>
      <button class="mini-btn candlebtn" onclick="triggerCheckIn('${dateStr}')">Check in — add a photo</button>`);

  body.innerHTML = pageHtml + dayHabitsHtml(dateStr) + `<div class="save-msg" id="dayModalMsg"></div>`;
}
/* The day's habits, checkable right from the calendar — so a day you forgot
   to tick off can be filled in later, same as a page you photograph late. */
function dayHabitsHtml(dateStr){
  const dayRows = habitsOnDate(dateStr);
  const dayTotal = dayRows.length;
  if (!dayTotal) return '';
  const done = habitDoneByDate[dateStr] || new Set();
  const dayDone = dayRows.filter(h => done.has(h.id)).length;
  const block = (time, label) => {
    // Only the habits that day actually had, so an older day isn't listed with
    // habits that were created after it.
    const rows = ritualRowsFor(time, dateStr);
    if (!rows.length) return '';
    const st = routineStatusFor(time, dateStr);
    const verdict = st.state === 'full' ? ' · full routine'
      : st.state === 'essentials' ? ' · non-negotiables kept'
      : st.state === 'partial' ? ' · partly done' : '';
    return `<div class="day-habit-time">${label}${verdict}</div><div class="day-habit-list">` + rows.map(h => {
      const isDone = done.has(h.id);
      return `<button type="button" class="day-habit${isDone ? ' done' : ''}${h.is_core ? ' core' : ''}" onclick="toggleHabitOnDate('${h.id}','${dateStr}')" aria-pressed="${isDone}">
        <span class="day-habit-check">✓</span>${h.name.replace(/</g,'&lt;')}${h.is_core ? '<span class="day-habit-core" title="Non-negotiable">✦</span>' : ''}
      </button>`;
    }).join('') + `</div>`;
  };
  const pct = habitCompletionFor(dateStr);
  return `<div class="day-modal-section">
    <label class="day-modal-label">Habits kept — ${dayDone} of ${dayTotal}${pct !== null ? ` (${Math.round(pct * 100)}%)` : ''}</label>
    ${block('morning','Morning')}${block('night','Night')}
  </div>`;
}
function openDayDetail(dateStr){
  if (dateStr > localDateStr()) return;
  dayModalContent(dateStr);
  document.getElementById('dayModalOverlay').classList.add('open');
}
function closeDayDetail(){ document.getElementById('dayModalOverlay').classList.remove('open'); }
function triggerCheckIn(dateStr){
  pendingCheckInDate = dateStr;
  document.getElementById('photoFile').click();
}
async function uploadJournalPhoto(file, dateStr){
  const msg = document.getElementById('dayModalMsg');
  if (!sb || !currentUser || !dateStr) return;
  if (file.size > 15 * 1024 * 1024){ if (msg){ msg.textContent = 'That photo is over 15 MB — try a smaller one.'; msg.className = 'save-msg err'; } return; }
  if (msg){ msg.textContent = 'Uploading your page…'; msg.className = 'save-msg'; }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${currentUser.id}/${dateStr}.${ext}`;
  const { error: upErr } = await sb.storage.from('journal-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
  if (upErr){ console.error('photo upload error:', upErr); if (msg){ msg.textContent = "Couldn't upload that photo — try again."; msg.className = 'save-msg err'; } return; }
  // Caption is deliberately left out of this upsert payload so replacing a
  // photo never wipes out a summary already written for that day.
  const { error } = await sb.from('journal_photos').upsert({ user_id: currentUser.id, storage_path: path, entry_date: dateStr }, { onConflict: 'user_id,entry_date' });
  if (error){ console.error('journal_photos upsert error:', error); if (msg){ msg.textContent = "Uploaded, but couldn't save — try again."; msg.className = 'save-msg err'; } return; }
  await loadJournalPhotos({ force: true });
  if (dateStr === localDateStr()) await awardLight(LIGHT_SOURCES.journal, dateStr, null);
  if (document.body.getAttribute('data-view') === 'today') renderTodayJourney();
  if (document.getElementById('dayModalOverlay').classList.contains('open')) dayModalContent(dateStr);
}
async function saveDayCaption(dateStr){
  const msg = document.getElementById('dayModalMsg');
  const caption = document.getElementById('dayModalCaption').value.trim() || null;
  msg.textContent = 'Saving…'; msg.className = 'save-msg';
  forgetFetch('journalPhotos');
  const { error } = await sb.from('journal_photos').update({ caption }).eq('user_id', currentUser.id).eq('entry_date', dateStr);
  if (error){ console.error('saveDayCaption error:', error); msg.textContent = "Couldn't save — try again."; msg.className = 'save-msg err'; return; }
  if (journalPhotosByDate[dateStr]) journalPhotosByDate[dateStr].caption = caption;
  msg.textContent = 'Saved.'; msg.className = 'save-msg ok';
}
async function deleteDayEntry(dateStr){
  const entry = journalPhotosByDate[dateStr];
  if (!sb || !currentUser || !entry) return;
  const { error } = await sb.from('journal_photos').delete().eq('user_id', currentUser.id).eq('entry_date', dateStr);
  if (error){ console.error('deleteDayEntry error:', error); return; }
  await sb.storage.from('journal-photos').remove([entry.storage_path]);
  closeDayDetail();
  loadJournalPhotos({ force: true });
}

