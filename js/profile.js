/* profile.js — profile, library, cloning your voice, account settings

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

/* ---------- mobile nav ---------- */
function toggleMobileNav(){
  document.getElementById('navLinks').classList.toggle('open');
}
function closeMobileNav(){
  document.getElementById('navLinks').classList.remove('open');
}

function renderProfileState(){
  document.getElementById('profileLocked').style.display = currentUser ? 'none' : 'block';
  document.getElementById('profilePanel').style.display = currentUser ? 'block' : 'none';
  if (currentUser) loadProfile();
}
async function loadProfile(){
  if (!sb || !currentUser) return;
  document.getElementById('settingsEmail').value = currentUser.email || '';
  renderVoiceClone();

  const { data: prof } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if (prof){
    document.getElementById('profileNameDisplay').textContent = prof.full_name || prof.username || currentUser.email.split('@')[0];
    document.getElementById('settingsUsername').value = prof.username || '';
    higherSelf = { name: prof.higher_self_name || '', avatar: avatarId(prof.higher_self_avatar) };
    document.getElementById('higherSelfNameInput').value = higherSelf.name;
    renderHigherSelfMaker();
    document.getElementById('profileAvatarDisplay').innerHTML = avatarMarkup(higherSelf);
  }

  const myTier = await getMyTier();
  const tierIcons = { none: '', whisper: '✦ ', ritual: '★ ' };
  const badge = document.getElementById('profileTierDisplay');
  badge.dataset.tier = myTier;
  badge.textContent = myTier === 'none' ? 'Free account' : (tierIcons[myTier] + myTier[0].toUpperCase()+myTier.slice(1) + ' member');
}

/* ---------- change your username ---------- */
async function updateUsername(){
  const msg = document.getElementById('usernameSettingsMsg');
  if (!sb || !currentUser) return;
  const username = document.getElementById('settingsUsername').value.trim();
  if (!username){ msg.textContent = 'Enter a username.'; msg.className = 'save-msg err'; return; }
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(username)){ msg.textContent = 'Usernames are 3–24 characters — letters, numbers, dots, and underscores.'; msg.className = 'save-msg err'; return; }
  msg.textContent = 'Saving…'; msg.className = 'save-msg';
  const error = await saveProfile({ username });
  if (error){ msg.textContent = describeSaveError(error); msg.className = 'save-msg err'; return; }
  msg.textContent = 'Username updated.'; msg.className = 'save-msg ok';
  loadNavIdentity();
}

async function loadMyLibrary(){
  if (!sb || !currentUser) return;
  const list = document.getElementById('myLibraryList');
  list.innerHTML = '<div class="library-empty">Loading…</div>';
  const { data: subs, error } = await sb.from('subliminals').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (error || !subs || !subs.length){ list.innerHTML = '<div class="library-empty">Nothing saved yet — build one and hit "Save to my library."</div>'; return; }
  list.innerHTML = subs.map(s => {
    const mins = Math.round((s.duration_seconds||0)/60);
    const when = new Date(s.created_at).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    const affs = Array.isArray(s.affirmations) ? s.affirmations : [];
    const titleText = s.title || 'Untitled subliminal';
    const titleVal = (s.title || '').replace(/"/g,'&quot;');
    return `<div class="profile-item" id="libItem-${s.id}">
      <div class="profile-item-top">
        <span class="lib-cover" id="libCover-${s.id}">
          <img alt="" id="libCoverImg-${s.id}" style="display:none;">
          <button class="lib-play" id="libPlay-${s.id}" onclick="playFromLibrary('${s.id}')"
            aria-label="Play ${titleVal || 'this subliminal'}" title="Play">
            <span class="lib-play-icon" aria-hidden="true">▶</span>
          </button>
        </span>
        <div style="flex:1; min-width:0;">
          <div class="lib-title-view" id="libTitleView-${s.id}">
            <div class="lib-title-text">${titleText.replace(/</g,'&lt;')}</div>
            <button class="lib-title-edit-btn" onclick="startEditLibraryTitle('${s.id}')" aria-label="Edit title" title="Edit title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
          </div>
          <div class="lib-title-row" id="libTitleEdit-${s.id}" style="display:none;">
            <input type="text" class="lib-title-input" id="libTitle-${s.id}" value="${titleVal}" maxlength="60" placeholder="Untitled subliminal">
            <button class="lib-title-save-btn" onclick="renameLibraryItem('${s.id}')" aria-label="Save title" title="Save title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            </button>
            <button class="lib-title-cancel-btn" onclick="cancelEditLibraryTitle('${s.id}')" aria-label="Cancel">✕</button>
          </div>
          <div class="save-msg" id="libTitleMsg-${s.id}" style="margin-top:2px;"></div>
          <div class="meta">${mins ? mins+' min · ' : ''}${affs.length} affirmations</div>
          <div class="lib-now" id="libNow-${s.id}"></div>
        </div>
      </div>
      <div class="lib-actions">
        <button onclick="pickCoverFor('${s.id}')">Cover</button>
        <button onclick="loadSavedIntoBuilder('${s.id}')">Load &amp; adjust</button>
        <button onclick="deleteMySubliminal('${s.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
  // After the markup, not during: each one is a signed-link round trip, and the
  // list should be readable before the pictures arrive.
  subs.forEach(s => { if (s.cover_path) showCover(s.id, s.cover_path); });
}

function startEditLibraryTitle(id){
  document.getElementById(`libTitleView-${id}`).style.display = 'none';
  const editRow = document.getElementById(`libTitleEdit-${id}`);
  editRow.style.display = 'flex';
  const input = document.getElementById(`libTitle-${id}`);
  input.focus();
  input.select();
}
function cancelEditLibraryTitle(id){
  document.getElementById(`libTitleEdit-${id}`).style.display = 'none';
  document.getElementById(`libTitleView-${id}`).style.display = 'flex';
  document.getElementById(`libTitleMsg-${id}`).textContent = '';
}

/* Renaming in My Library updates the title in place — it's the one edit that doesn't
   need to fork a new subliminal, since the content itself hasn't changed. */
async function renameLibraryItem(id){
  if (!sb || !currentUser) return;
  const input = document.getElementById(`libTitle-${id}`);
  const msg = document.getElementById(`libTitleMsg-${id}`);
  const title = input.value.trim();
  if (!title){ msg.textContent = "Title can't be empty."; msg.className = 'save-msg err'; return; }
  msg.textContent = 'Saving…'; msg.className = 'save-msg';
  const { error } = await sb.from('subliminals').update({ title }).eq('id', id).eq('user_id', currentUser.id);
  if (error){ console.error('renameLibraryItem error:', error); msg.textContent = "Couldn't save."; msg.className = 'save-msg err'; return; }
  msg.textContent = '';
  document.getElementById(`libTitleView-${id}`).querySelector('.lib-title-text').textContent = title;
  document.getElementById(`libTitleEdit-${id}`).style.display = 'none';
  document.getElementById(`libTitleView-${id}`).style.display = 'flex';
}

/* `stayHere` is for playing from the library: the state is loaded exactly the
   same way, but you are not thrown onto the builder page to find a second
   button. Everything before this point is identical either way -- there is one
   loader, not two. */
async function loadSavedIntoBuilder(id, opts){
  if (!sb || !currentUser) return;
  const { data: s, error } = await sb.from('subliminals').select('*').eq('id', id).eq('user_id', currentUser.id).maybeSingle();
  if (error || !s) return;
  editingExistingId = id;
  const matchedFreq = FREQS.find(f => f.hz === s.frequency_hz) || null;
  state.freq = matchedFreq;
  state.affirmations = Array.isArray(s.affirmations) ? s.affirmations.slice() : [];
  state.bg = s.background || 'none';
  state.targetLengthMinutes = s.duration_seconds ? Math.max(1, Math.round(s.duration_seconds/60)) : 5;
  const restoredMinutes = Math.min(480, Math.max(5, state.targetLengthMinutes));
  document.getElementById('sessionLengthSlider').value = restoredMinutes;
  document.getElementById('sessionLengthVal').textContent = formatSessionLength(restoredMinutes);
  state.eftMode = !!s.eft_mode;
  state.eftRepeatCount = s.eft_repeat_count || null;
  state.visualizationMode = !!s.visualization_mode;
  state.binauralBand = s.binaural_band || null;

  const hasRealRecordings = Array.isArray(s.recording_urls) && s.recording_urls.some(p => p);
  if (hasRealRecordings){
    /* Every way this can fail used to end in `null`, which is the same value as
       "this line was never recorded". So a subliminal whose audio could not be
       fetched — an expired link, a storage rule, a phone that dropped off the
       network — came back looking like one you had never recorded, and the
       player said "go back and hold the record button", which was untrue and
       unfixable by doing what it asked. Load failures are now counted and told
       apart from lines that genuinely have no recording. */
    recordings = [];
    recordingLoadErrors = [];
    for (const path of s.recording_urls){
      if (!path){ recordings.push(null); continue; }   // never recorded: not an error
      const { data: signed, error: sErr } = await sb.storage.from('recordings').createSignedUrl(path, 3600);
      if (sErr || !signed){
        recordings.push(null);
        recordingLoadErrors.push((sErr && sErr.message) || 'could not get a link to the audio');
        continue;
      }
      try {
        const res = await fetch(signed.signedUrl);
        if (!res.ok) throw new Error('the audio file came back ' + res.status);
        const blob = await res.blob();
        if (!blob.size) throw new Error('the audio file is empty');
        recordings.push({ url: URL.createObjectURL(blob), blob });
      } catch(e){
        recordings.push(null);
        recordingLoadErrors.push((e && e.message) || 'the audio could not be downloaded');
      }
    }
    state.voiceMode = 'own';
    if (recordingLoadErrors.length){
      console.warn('subliminal audio did not load:', recordingLoadErrors);
    }
  } else {
    recordingLoadErrors = [];
    // No recorded audio was saved for this one (or it was a studio voice
    // originally) — reloading plays it back in the voice it was built with.
    state.voiceMode = 'ai';
    state.aiVoiceId = s.ai_voice_id || DEVICE_VOICE;
  }

  customTrackBlob = null;
  document.getElementById('customTrackName').textContent = '';
  if (s.custom_track_url){
    const { data: signed, error: sErr } = await sb.storage.from('custom-tracks').createSignedUrl(s.custom_track_url, 3600);
    if (!sErr && signed){
      try {
        const res = await fetch(signed.signedUrl);
        const blob = await res.blob();
        customTrackBlob = blob;
        document.getElementById('customTrackName').textContent = 'Your uploaded track';
      } catch(e){ console.error('custom track reload failed:', e); }
    }
  }

  // Ritual-only second voice layer, if this saved subliminal has one.
  state.layerAffirmations = Array.isArray(s.layer_affirmations) ? s.layer_affirmations.slice() : [];
  state.layerVoiceMode = s.layer_voice_mode || null;
  state.layerAiVoiceId = s.layer_ai_voice_id || DEVICE_VOICE;
  layerVoiceEnabled = !!(state.layerAffirmations.length && state.layerVoiceMode);
  layerVoiceMode = state.layerVoiceMode || 'ai';
  document.getElementById('layerVoiceToggle').checked = layerVoiceEnabled;
  document.getElementById('layerVoicePanel').classList.toggle('open', layerVoiceEnabled);
  document.getElementById('layerAffText').value = state.layerAffirmations.join('\n');
  document.querySelectorAll('.layer-voice-options button').forEach(b=>b.classList.toggle('sel', b.dataset.mode===layerVoiceMode));
  layerRecordings = [];
  const hasLayerRecordings = Array.isArray(s.layer_recording_urls) && s.layer_recording_urls.some(p => p);
  if (hasLayerRecordings){
    for (const path of s.layer_recording_urls){
      if (!path){ layerRecordings.push(null); continue; }
      const { data: signed, error: sErr } = await sb.storage.from('recordings').createSignedUrl(path, 3600);
      if (sErr || !signed){ layerRecordings.push(null); continue; }
      try {
        const res = await fetch(signed.signedUrl);
        const blob = await res.blob();
        layerRecordings.push({ url: URL.createObjectURL(blob), blob });
      } catch(e){ layerRecordings.push(null); }
    }
  }

  prepareFinal();
  if (!(opts && opts.stayHere)){
    showBuildPage();
    showStep(7);
  }
}

async function deleteMySubliminal(id){
  if (!sb || !currentUser) return;
  await sb.from('subliminals').delete().eq('id', id).eq('user_id', currentUser.id);
  loadMyLibrary();
}
/* ---------- cloning your voice ----------
   One sample, read once, and the studio can generate any line in that voice.
   The recording is sent straight to /api/voice-clone and never stored here —
   only the resulting voice id ends up on the profile. */
const VOICE_CLONE_SAMPLE = "I am becoming the person I said I would be. Not someday, and not once everything lines up — now, in the ordinary middle of things. I speak to myself the way I would speak to someone I love. I keep what I promised myself I would keep, on the days it is easy and on the days it is not.";
let voiceCloneRecorder = null, voiceCloneChunks = [], voiceCloneStream = null,
    voiceCloneTimer = null, voiceCloneStart = 0;

async function renderVoiceClone(){
  const body = document.getElementById('voiceCloneBody');
  if (!body) return;
  const cloned = await myClonedVoiceId();
  if (voiceCloneRecorder){
    const secs = Math.floor((Date.now() - voiceCloneStart) / 1000);
    body.innerHTML = `
      <div class="voice-clone-sample">${VOICE_CLONE_SAMPLE}</div>
      <div class="voice-clone-actions">
        <span class="voice-rec-dot"></span>
        <span class="voice-rec-label">Reading… take your time.</span>
        <span class="voice-rec-time" id="voiceCloneTime">${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}</span>
        <button class="mini-btn candlebtn" onclick="finishVoiceClone()">Done reading</button>
        <button class="mini-btn ghostbtn" onclick="cancelVoiceClone()">Cancel</button>
      </div>`;
    return;
  }
  if (cloned){
    body.innerHTML = `
      <div class="voice-clone-have">
        <span>✦ Your voice is ready — pick <b>My voice</b> when you choose a voice.</span>
        <button class="mini-btn ghostbtn" onclick="startVoiceClone()">Record it again</button>
        <button class="mini-btn ghostbtn" onclick="removeClonedVoice()">Remove it</button>
      </div>`;
    return;
  }
  body.innerHTML = `
    <div class="voice-clone-sample">${VOICE_CLONE_SAMPLE}</div>
    <div class="voice-clone-actions">
      <button class="mini-btn candlebtn" onclick="startVoiceClone()">Read this to clone my voice</button>
      <span class="voice-chip-desc">Somewhere quiet, normal speaking voice, about 30 seconds.</span>
    </div>`;
}

async function startVoiceClone(){
  const msg = document.getElementById('voiceCloneMsg');
  msg.textContent = ''; msg.className = 'save-msg';
  if (!sb || !currentUser) return;
  if (!navigator.mediaDevices || !window.MediaRecorder){
    msg.textContent = "This browser can't record audio."; msg.className = 'save-msg err'; return;
  }
  try { voiceCloneStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(e){ msg.textContent = 'Microphone access is needed to record the sample.'; msg.className = 'save-msg err'; return; }
  const mime = pickRecordingMime();
  voiceCloneChunks = [];
  voiceCloneRecorder = mime ? new MediaRecorder(voiceCloneStream, { mimeType: mime }) : new MediaRecorder(voiceCloneStream);
  voiceCloneRecorder.ondataavailable = ev => voiceCloneChunks.push(ev.data);
  voiceCloneRecorder.start();
  voiceCloneStart = Date.now();
  renderVoiceClone();
  voiceCloneTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - voiceCloneStart) / 1000);
    const el = document.getElementById('voiceCloneTime');
    if (el) el.textContent = `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
    if (secs >= 120) finishVoiceClone();  // well past what cloning needs
  }, 250);
}
function stopVoiceCloneStream(){
  clearInterval(voiceCloneTimer); voiceCloneTimer = null;
  if (voiceCloneStream){ voiceCloneStream.getTracks().forEach(t => t.stop()); voiceCloneStream = null; }
}
function cancelVoiceClone(){
  if (!voiceCloneRecorder) return;
  voiceCloneRecorder.onstop = null;
  try { voiceCloneRecorder.stop(); } catch(e){}
  voiceCloneRecorder = null; voiceCloneChunks = [];
  stopVoiceCloneStream();
  renderVoiceClone();
}
function finishVoiceClone(){
  if (!voiceCloneRecorder) return;
  const seconds = Math.round((Date.now() - voiceCloneStart) / 1000);
  const rec = voiceCloneRecorder;
  voiceCloneRecorder = null;
  rec.onstop = () => {
    const blob = new Blob(voiceCloneChunks, { type: rec.mimeType || 'audio/webm' });
    voiceCloneChunks = [];
    stopVoiceCloneStream();
    const msg = document.getElementById('voiceCloneMsg');
    if (seconds < 8){
      msg.textContent = 'That was very short — read the whole passage so the voice has enough to work from.';
      msg.className = 'save-msg err';
      renderVoiceClone();
      return;
    }
    uploadVoiceClone(blob);
  };
  try { rec.stop(); } catch(e){ stopVoiceCloneStream(); renderVoiceClone(); }
}
async function uploadVoiceClone(blob){
  const msg = document.getElementById('voiceCloneMsg');
  const body = document.getElementById('voiceCloneBody');
  body.innerHTML = '<div class="voice-clone-actions"><span class="voice-rec-label">Learning your voice — this takes a moment…</span></div>';
  msg.textContent = ''; msg.className = 'save-msg';
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const res = await fetch(`${API_BASE}/api/voice-clone`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm', Authorization: `Bearer ${token}` },
      body: blob,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok){
      msg.textContent = out.error === 'upgrade_required'
        ? 'Cloning your voice comes with Ritual — $11.11 a month, or $111 a year.'
        : out.error === 'not_configured'
          ? "Voice cloning isn't switched on yet."
          : (out.error || "Couldn't clone your voice — try again in a moment.");
      msg.className = 'save-msg err';
      renderVoiceClone();
      return;
    }
    clonedVoiceCache = out.voiceId;   // the picker reads this straight away
    msg.textContent = 'Your voice is ready.'; msg.className = 'save-msg ok';
    renderVoiceClone();
  } catch (e){
    console.error('voice clone failed:', e);
    msg.textContent = "Couldn't reach the voice service — try again in a moment.";
    msg.className = 'save-msg err';
    renderVoiceClone();
  }
}
async function removeClonedVoice(){
  const msg = document.getElementById('voiceCloneMsg');
  msg.textContent = 'Removing…'; msg.className = 'save-msg';
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const res = await fetch(`${API_BASE}/api/voice-clone`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('remove failed');
    clonedVoiceCache = null;
    // Any subliminal set to "My voice" now falls back to the device voice.
    if (state.aiVoiceId === MY_CLONED_VOICE) state.aiVoiceId = DEVICE_VOICE;
    msg.textContent = 'Removed.'; msg.className = 'save-msg ok';
    renderVoiceClone();
  } catch (e){
    msg.textContent = "Couldn't remove it — try again in a moment."; msg.className = 'save-msg err';
  }
}

async function updateEmail(){
  const msg = document.getElementById('emailSettingsMsg');
  const newEmail = document.getElementById('settingsEmail').value.trim();
  if (!sb || !newEmail){ return; }
  msg.textContent = 'Updating…'; msg.className = 'save-msg';
  const { error } = await sb.auth.updateUser({ email: newEmail });
  if (error){ msg.textContent = error.message; msg.className = 'save-msg err'; return; }
  msg.textContent = 'Check both your old and new inbox to confirm the change.'; msg.className = 'save-msg ok';
}
async function updatePassword(){
  const msg = document.getElementById('passwordSettingsMsg');
  const newPassword = document.getElementById('settingsPassword').value;
  if (!sb || !newPassword){ return; }
  if (newPassword.length < 6){ msg.textContent = 'Use at least 6 characters.'; msg.className = 'save-msg err'; return; }
  msg.textContent = 'Updating…'; msg.className = 'save-msg';
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error){ msg.textContent = error.message; msg.className = 'save-msg err'; return; }
  msg.textContent = 'Password updated.'; msg.className = 'save-msg ok';
  document.getElementById('settingsPassword').value = '';
}

/* ---------- contact support / share an idea ---------- */
let feedbackTab = 'support';
function setFeedbackTab(tab){
  feedbackTab = tab;
  document.querySelectorAll('[data-fbtab]').forEach(b => b.classList.toggle('active', b.dataset.fbtab === tab));
  document.getElementById('feedbackLabel').textContent = tab === 'support' ? "What's going on?" : "What's your idea?";
  document.getElementById('feedbackMessage').placeholder = tab === 'support'
    ? 'Tell us what happened, as much detail as helps.'
    : 'A feature, a tweak, a "what if" — we read all of these.';
  document.getElementById('feedbackSubmitBtn').textContent = tab === 'support' ? 'Send to support' : 'Send idea';
  document.getElementById('feedbackMsg').textContent = '';
}
async function submitFeedback(){
  const msg = document.getElementById('feedbackMsg');
  const message = document.getElementById('feedbackMessage').value.trim();
  if (!message){ msg.textContent = 'Write a bit first.'; msg.className = 'save-msg err'; return; }
  if (!sb){ msg.textContent = "Can't send right now — try emailing hello@subliminallybyfthr.com directly."; msg.className = 'save-msg err'; return; }
  msg.textContent = 'Sending…'; msg.className = 'save-msg';
  const { error } = await sb.from('feedback').insert({
    user_id: currentUser ? currentUser.id : null,
    type: feedbackTab,
    message,
    contact_email: currentUser ? currentUser.email : null
  });
  if (error){
    console.error('submitFeedback error:', error);
    msg.textContent = `Couldn't send: ${error.message} — or email hello@subliminallybyfthr.com directly.`;
    msg.className = 'save-msg err';
    return;
  }
  msg.textContent = "Sent — thank you. We read every one of these."; msg.className = 'save-msg ok';
  document.getElementById('feedbackMessage').value = '';
}


/* ---------- play it here ----------
   "Play" used to mean "load this into the builder and go to that page", which
   left you on a different screen looking for a second button before anything
   made a sound. It plays where you pressed it now.

   The engine is the one in builder.js: the same state, the same mixer, the same
   session. Only the way in is different — nothing about playback is duplicated
   here, because two players would drift and one of them would be the broken one. */
async function playFromLibrary(id){
  if (!sb || !currentUser){ openAuthModal(); return; }
  /* First thing, before anything is awaited: the tap is the only moment a
     browser will let audio begin, and loading the subliminal ends it. */
  primeAudio();
  const btn = document.getElementById('libPlay-' + id);
  const now = document.getElementById('libNow-' + id);

  // Pressing play on the one already playing stops it, the way a playlist does.
  if (finalPlaying && libraryNowPlayingId === id){ stopFinal(); return; }
  if (finalPlaying) stopFinal();

  libraryNowPlayingId = id;
  if (btn) btn.classList.add('is-loading');
  if (now) now.textContent = 'Loading…';

  try {
    await loadSavedIntoBuilder(id, { stayHere: true });
  } catch (e){
    if (now) now.textContent = 'Could not load this one.';
    if (btn) btn.classList.remove('is-loading');
    libraryNowPlayingId = null;
    return;
  }
  if (btn) btn.classList.remove('is-loading');
  playFinal();
  reflectLibraryPlaying();
}

let libraryNowPlayingId = null;

/* The card shows what the player is doing, so you do not have to go and look.
   Driven off finalPlaying rather than a second copy of the state. */
function reflectLibraryPlaying(){
  document.querySelectorAll('.lib-play').forEach(b => b.classList.remove('is-playing'));
  document.querySelectorAll('.lib-now').forEach(n => { n.textContent = ''; });
  if (!finalPlaying || !libraryNowPlayingId) return;
  const btn = document.getElementById('libPlay-' + libraryNowPlayingId);
  const now = document.getElementById('libNow-' + libraryNowPlayingId);
  if (btn) btn.classList.add('is-playing');
  if (now) now.textContent = document.getElementById('finalLine').textContent || 'Playing…';
}
setInterval(() => { if (libraryNowPlayingId) reflectLibraryPlaying(); }, 1000);

/* ---------- the bar that follows you ----------
   A session lasts up to eight hours. Before this, the only place that knew one
   was playing was whichever screen started it — walk to Journal and there was
   no title, no line, and no way to stop it short of finding your way back.

   It is one bar, driven off finalPlaying, and it renders nothing when nothing
   is playing. Not a second player: the stop button calls the same stopFinal()
   every other control does. */
function ensureNowBar(){
  let bar = document.getElementById('nowBar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'nowBar';
  bar.className = 'now-bar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  document.body.appendChild(bar);
  return bar;
}

function renderNowBar(){
  const bar = ensureNowBar();
  if (!finalPlaying){
    bar.classList.remove('on');
    bar.innerHTML = '';
    document.body.classList.remove('has-now-bar');
    return;
  }
  const title = (typeof state !== 'undefined' && state.title) || currentSubliminalTitle() || 'Your subliminal';
  const line  = (document.getElementById('finalLine') || {}).textContent || '';
  /* Rebuilt every second, so a slider mid-drag must not be torn out from under
     the finger. Only the text changes on a tick; the controls are built once. */
  if (!bar.dataset.built){
    bar.innerHTML = `
      <div class="now-bar-in">
        <span class="nb-pulse" aria-hidden="true"></span>
        <span class="nb-txt">
          <b id="nbTitle"></b>
          <span id="nbLine"></span>
        </span>
        <button type="button" class="nb-mix" onclick="toggleNowMixer()"
          aria-expanded="false" aria-controls="nbMixer" aria-label="Sound levels">Levels</button>
        <button type="button" class="nb-stop" onclick="stopFinal()" aria-label="Stop the session">Stop</button>
      </div>
      <div class="nb-mixer" id="nbMixer" hidden>${nowMixerRows()}</div>`;
    bar.dataset.built = '1';
  }
  const tEl = document.getElementById('nbTitle');
  const lEl = document.getElementById('nbLine');
  if (tEl) tEl.textContent = title;
  if (lEl) lEl.textContent = String(line).slice(0, 90);
  syncNowMixer();
  bar.classList.add('on');
  document.body.classList.add('has-now-bar');
}

/* The title of whatever is playing, wherever it was started from. */
function currentSubliminalTitle(){
  if (libraryNowPlayingId){
    const el = document.querySelector(`#libItem-${libraryNowPlayingId} .lib-title-text`);
    if (el) return el.textContent;
  }
  const t = document.getElementById('finalTitle');
  return t ? t.textContent : '';
}

/* One beat, cheap, and it stops mattering the moment nothing is playing. */
setInterval(renderNowBar, 1000);

/* ---------- cover art ----------
   A picture per subliminal, so the library is something you recognise rather
   than something you read.

   Resized here rather than uploaded whole. A photo off a phone is three to six
   megabytes and is about to be shown at 46 pixels; sending the original would
   cost the person their data and the library its loading time, for detail no
   screen will ever draw. */
const COVER_PX = 512;

function pickCoverFor(id){
  let input = document.getElementById('coverPicker');
  if (!input){
    input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.id = 'coverPicker';
    input.style.display = 'none';
    document.body.appendChild(input);
  }
  input.onchange = () => {
    const file = input.files && input.files[0];
    input.value = '';                    // so choosing the same file twice still fires
    if (file) uploadCover(id, file);
  };
  input.click();
}

/* Square, centre-cropped, WebP. Centre-cropped rather than squashed: a portrait
   squeezed into a square makes a face look wrong in a way people notice without
   being able to say why. */
function squareCover(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = COVER_PX;
      c.getContext('2d').drawImage(img,
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, COVER_PX, COVER_PX);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? resolve(b) : reject(new Error('could not read that image')),
               'image/webp', 0.85);
    };
    img.onerror = () => reject(new Error('that file is not an image this browser can open'));
    img.src = URL.createObjectURL(file);
  });
}

async function uploadCover(id, file){
  if (!sb || !currentUser) return;
  const msg = document.getElementById('libTitleMsg-' + id);
  const say = t => { if (msg) msg.textContent = t; };
  say('Adding the cover…');
  try {
    const blob = await squareCover(file);
    // Named after the subliminal inside a folder named after the person, which
    // is exactly what the storage policy checks, and means a new cover replaces
    // the old one rather than piling up.
    const path = `${currentUser.id}/${id}.webp`;
    const { error: upErr } = await sb.storage.from('covers')
      .upload(path, blob, { upsert: true, contentType: 'image/webp' });
    if (upErr) throw upErr;
    const { error: dbErr } = await sb.from('subliminals')
      .update({ cover_path: path }).eq('id', id).eq('user_id', currentUser.id);
    if (dbErr) throw dbErr;
    say('');
    await showCover(id, path, true);
  } catch (e){
    say((e && e.message) || 'That cover could not be saved.');
  }
}

/* Signed links expire, so they are fetched when the library renders rather than
   stored. `bust` forces the browser past a picture it is already holding, which
   it otherwise keeps showing after a replacement. */
async function showCover(id, path, bust){
  if (!path || !sb) return;
  const img = document.getElementById('libCoverImg-' + id);
  if (!img) return;
  const { data, error } = await sb.storage.from('covers').createSignedUrl(path, 3600);
  if (error || !data) return;
  img.src = data.signedUrl + (bust ? '&t=' + Date.now() : '');
  img.style.display = 'block';
  const wrap = document.getElementById('libCover-' + id);
  if (wrap) wrap.classList.add('has-art');
}

/* ---------- the mixer, where you are ----------
   The sliders live on the build page. Playing from the library gave you a
   session and no way to touch it: no affirmation volume, no nature sound, no
   frequency. This is the same four controls, in the bar, wherever you played
   from.

   They drive the originals rather than duplicating them — one source of truth,
   so the build page and the bar can never show different numbers, and
   applyLiveMixGain stays the only thing that talks to the audio graph. */
const NOW_MIX_ROWS = [
  { id:'mixVoice',    label:'Affirmations' },
  { id:'mixBg',       label:'Nature sound' },
  { id:'mixTone',     label:'Frequency' },
  { id:'mixSoothing', label:'Soothing' },
];

function nowMixerRows(){
  return NOW_MIX_ROWS.map(r => {
    const src = document.getElementById(r.id);
    if (!src) return '';
    return `<label class="nb-row">
      <span class="nb-row-name">${r.label}</span>
      <input type="range" min="0" max="100" id="nb-${r.id}" value="${src.value}"
        oninput="setNowMix('${r.id}', this.value)" aria-label="${r.label} volume">
      <span class="nb-row-val" id="nbv-${r.id}">${src.value}</span>
    </label>`;
  }).join('');
}

/* Moving one here moves the real control and the audio together. */
function setNowMix(id, value){
  const src = document.getElementById(id);
  if (src){
    src.value = value;
    const readout = document.getElementById(id + 'Val');
    if (readout) readout.value = value;
  }
  const mine = document.getElementById('nbv-' + id);
  if (mine) mine.textContent = value;
  applyLiveMixGain(id, value);
}

/* Keep the bar's sliders showing the truth if they were changed elsewhere —
   but never while one is being dragged. */
function syncNowMixer(){
  NOW_MIX_ROWS.forEach(r => {
    const mine = document.getElementById('nb-' + r.id);
    const src  = document.getElementById(r.id);
    if (!mine || !src || document.activeElement === mine) return;
    if (mine.value !== src.value){
      mine.value = src.value;
      const v = document.getElementById('nbv-' + r.id);
      if (v) v.textContent = src.value;
    }
  });
}

function toggleNowMixer(){
  const panel = document.getElementById('nbMixer');
  const btn = document.querySelector('.nb-mix');
  if (!panel) return;
  const open = panel.hasAttribute('hidden');
  if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('has-now-mixer', open);
}
