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
    return `<div class="profile-item">
      <div class="profile-item-top">
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
          <div class="meta">${mins ? mins+' min · ' : ''}${affs.length} affirmations · saved ${when}</div>
        </div>
        <button onclick="loadSavedIntoBuilder('${s.id}')">Load &amp; adjust</button>
        <button onclick="deleteMySubliminal('${s.id}')">Delete</button>
      </div>
      ${affs.length ? `<div class="profile-item-affs">${affs.map(a=>`<p>"${String(a).replace(/</g,'&lt;')}"</p>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
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

async function loadSavedIntoBuilder(id){
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
    recordings = [];
    for (const path of s.recording_urls){
      if (!path){ recordings.push(null); continue; }
      const { data: signed, error: sErr } = await sb.storage.from('recordings').createSignedUrl(path, 3600);
      if (sErr || !signed){ recordings.push(null); continue; }
      try {
        const res = await fetch(signed.signedUrl);
        const blob = await res.blob();
        recordings.push({ url: URL.createObjectURL(blob), blob });
      } catch(e){ recordings.push(null); }
    }
    state.voiceMode = 'own';
  } else {
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

  showBuildPage();
  showStep(7);
  prepareFinal();
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

