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
   Journal tabs need Whisper; habits need Ritual. */
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
/* Journal page — gratitude and manifesting, both Whisper features. */
async function renderJournalState(){
  const locked = document.getElementById('journalLocked');
  const upgrade = document.getElementById('journalUpgrade');
  const panel = document.getElementById('journalPanel');
  const philosophy = document.getElementById('journalPhilosophy');
  panel.style.display = 'none';
  upgrade.style.display = 'none';
  // The 3D/4D/5D explainer is a Whisper feature — it only appears once the
  // tier check below has passed and the Manifesting tab is open.
  philosophy.style.display = 'none';
  locked.style.display = currentUser ? 'none' : 'block';
  if (!currentUser) return;

  if (!tierAtLeast(await getMyTier(), 'whisper')){ upgrade.style.display = 'block'; return; }

  panel.style.display = 'block';
  philosophy.style.display = journalTab === 'manifesting' ? 'block' : 'none';
  loadJournalEntries();
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
  const calendarPanel = document.getElementById('journalPhotoPanel');
  const habitsPanel = document.getElementById('habitsPanel');
  calendarPanel.style.display = 'none';
  habitsPanel.style.display = 'none';
  upgrade.style.display = 'none';
  locked.style.display = currentUser ? 'none' : 'block';
  if (!currentUser) return;

  const myTier = await getMyTier();
  const requiredTier = ritualsTab === 'habits' ? 'ritual' : 'whisper';
  if (!tierAtLeast(myTier, requiredTier)){
    const isHabits = ritualsTab === 'habits';
    document.getElementById('ritualsUpgradeTitle').textContent = isHabits ? 'The habit tracker is part of Ritual' : 'The daily log is part of Whisper';
    document.getElementById('ritualsUpgradeText').textContent = isHabits
      ? 'Morning and night rituals, EFT tapping, and visualization scripting come with Ritual — $11.11 a month, or $111 a year.'
      : 'Daily Journaling — writing by hand and logging each page here — comes with Whisper, $5.55 a month or $55 a year.';
    document.getElementById('ritualsUpgradeBtn').textContent = isHabits ? 'Get Ritual' : 'Get Whisper';
    upgrade.style.display = 'block';
    return;
  }

  // Both tabs want habit data: the calendar colours each day by how much of
  // that day's ritual was kept, so it loads habits too.
  if (ritualsTab === 'habits'){ habitsPanel.style.display = 'block'; loadHabits(); }
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

async function loadJournalPhotos(options){
  if (!sb || !currentUser) return;
  const silent = options && options.silent;   // Today loads the photos without drawing the calendar
  const { data, error } = await sb.from('journal_photos').select('*').eq('user_id', currentUser.id);
  if (error){ console.error('loadJournalPhotos error:', error); return; }
  const rows = data || [];
  const urlByPath = {};
  if (rows.length){
    const { data: signed } = await sb.storage.from('journal-photos').createSignedUrls(rows.map(p => p.storage_path), 3600);
    (signed || []).forEach(s => { if (s.signedUrl) urlByPath[s.path] = s.signedUrl; });
  }
  journalPhotosByDate = {};
  rows.forEach(p => { journalPhotosByDate[p.entry_date] = { ...p, url: urlByPath[p.storage_path] || '' }; });
  if (silent) return;
  renderPhotoCalendar();
  renderDailyLogReward();
}

function shiftPhotoMonth(delta){
  photoCalendarViewDate = new Date(photoCalendarViewDate.getFullYear(), photoCalendarViewDate.getMonth() + delta, 1);
  renderPhotoCalendar();
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
    const pct = isFuture ? null : habitCompletionFor(dateStr);
    const bar = pct !== null && pct > 0
      ? `<span class="cal-day-bar"><i style="width:${Math.round(pct * 100)}%"></i></span>`
      : '';
    const title = isFuture ? '' : ` title="${dayNum}${pct !== null ? ` — ${Math.round(pct * 100)}% of habits kept` : ''}"`;
    html += `<button type="button" class="${classes.join(' ')}"${style}${title} ${isFuture ? 'disabled' : `onclick="openDayDetail('${dateStr}')"`}>
      <span class="cal-day-num">${dayNum}</span>
      ${!entry && !isFuture ? '<span class="cal-day-plus">+</span>' : ''}
      ${bar}
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
  const done = (habitDoneByDate[localDateStr()] || new Set()).size;
  habitLine.style.display = 'block';
  habitLine.textContent = pct === 1
    ? `Every habit kept today — all ${habitsCache.length}.`
    : `${done} of ${habitsCache.length} habits kept today · ${Math.round(pct * 100)}%`;
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
  const pageHtml = entry
    ? `<img class="day-modal-photo" src="${entry.url}" alt="Journal page from ${dayLabel(dateStr)}">
      <label class="day-modal-label">Summary of the page</label>
      <textarea id="dayModalCaption" rows="3" maxlength="200" placeholder="What this page was about…">${(entry.caption || '').replace(/</g,'&lt;')}</textarea>
      <div class="day-modal-actions">
        <button class="mini-btn candlebtn" onclick="saveDayCaption('${dateStr}')">Save summary</button>
        <button class="mini-btn ghostbtn" onclick="triggerCheckIn('${dateStr}')">Replace photo</button>
        <button class="habit-delete" onclick="deleteDayEntry('${dateStr}')" aria-label="Delete this day's page" title="Delete">${trashIconSvg()}</button>
      </div>`
    : `<p class="journal-empty">No page logged for this day yet.</p>
      <button class="mini-btn candlebtn" onclick="triggerCheckIn('${dateStr}')">Check in — add a photo</button>`;

  body.innerHTML = pageHtml + dayHabitsHtml(dateStr) + `<div class="save-msg" id="dayModalMsg"></div>`;
}
/* The day's habits, checkable right from the calendar — so a day you forgot
   to tick off can be filled in later, same as a page you photograph late. */
function dayHabitsHtml(dateStr){
  if (!habitsCache.length) return '';
  const done = habitDoneByDate[dateStr] || new Set();
  const block = (time, label) => {
    const rows = habitsCache.filter(h => h.time_of_day === time);
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
    <label class="day-modal-label">Habits kept — ${done.size} of ${habitsCache.length}${pct !== null ? ` (${Math.round(pct * 100)}%)` : ''}</label>
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
  await loadJournalPhotos();
  if (dateStr === localDateStr()) await awardLight(LIGHT_SOURCES.journal, dateStr, null);
  if (document.body.getAttribute('data-view') === 'today') renderTodayJourney();
  if (document.getElementById('dayModalOverlay').classList.contains('open')) dayModalContent(dateStr);
}
async function saveDayCaption(dateStr){
  const msg = document.getElementById('dayModalMsg');
  const caption = document.getElementById('dayModalCaption').value.trim() || null;
  msg.textContent = 'Saving…'; msg.className = 'save-msg';
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
  loadJournalPhotos();
}

