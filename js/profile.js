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
  // Settings is one of the two places the voice card is drawn (the other is the
  // builder's "Use my voice" panel), so say which one before rendering it.
  mountVoiceClone('voiceCloneBody', 'voiceCloneMsg');
  if (typeof loadFaith === 'function') await loadFaith();
  if (typeof renderFaithSettings === 'function') renderFaithSettings();

  const prof = await myProfile();
  if (prof){
    document.getElementById('profileNameDisplay').textContent = prof.full_name || prof.username || currentUser.email.split('@')[0];
    document.getElementById('settingsUsername').value = prof.username || '';
    higherSelf = { name: prof.higher_self_name || '', avatar: avatarId(prof.higher_self_avatar) };
    higherSelfLoaded = true;
    document.getElementById('higherSelfNameInput').value = higherSelf.name;
    // Settings always opens showing the avatar you have, not the roster.
    if (typeof avatarPickerOpen !== 'undefined') avatarPickerOpen = false;
    renderHigherSelfMaker();
    document.getElementById('profileAvatarDisplay').innerHTML = avatarMarkup(higherSelf, { state:'hero', cut:'face' });
  }

  // getMyTier() already reads a retired tier as the one it is honoured as, so
  // a legacy Whisper subscriber sees the Ritual badge rather than their old one.
  const myTier = await getMyTier();
  const badge = document.getElementById('profileTierDisplay');
  badge.dataset.tier = myTier;
  badge.textContent = myTier === 'none' ? 'Free account' : (tierMark(myTier) + ' ' + TIER_LABEL[myTier] + ' member');
  const ladder = document.getElementById('profilePlanLadder');
  if (ladder) ladder.innerHTML = planLadderMarkup(myTier);

  // The Danger Zone's subscription half: which provider is charging, and the
  // link out to their cancel flow. Never a delete of the row here.
  if (typeof renderSubscriptionManagement === 'function') await renderSubscriptionManagement();
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

/* The storage line above the library. `used` of null means the fetch failed —
   an honest blank beats a wrong count. */
async function renderLibraryPlanLimit(used){
  const host = document.getElementById('myLibraryPlanLimit');
  if (!host) return;
  if (used == null || !currentUser){ host.innerHTML = ''; return; }
  host.innerHTML = planLimitMarkup(used, await getMyTier());
}

async function loadMyLibrary(options){
  if (!sb || !currentUser) return;
  const list = document.getElementById('myLibraryList');
  if (options && options.force) forgetFetch('myLibrary');
  // Only say "Loading" when there is nothing already on screen. Wiping a list
  // you were just looking at, to put the word Loading in its place, is how a
  // page that is about to be identical still feels slow.
  if (!list.querySelector('.profile-item')) list.innerHTML = '<div class="library-empty">Loading…</div>';
  const { data: subs, error } = await fetchOnce('myLibrary',
    () => sb.from('subliminals').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }));
  if (error) forgetFetch('myLibrary');
  /* How full the library is, said at the top before the list itself. Free
     accounts reaching their two do not lose anything here: every saved
     subliminal stays open and playable, and only saving another one is gated —
     which is what the note under the bar says. */
  renderLibraryPlanLimit(error ? null : (subs || []).length);
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
  await flushMixSave();
  const { data: s, error } = await sb.from('subliminals').select('*').eq('id', id).eq('user_id', currentUser.id).maybeSingle();
  if (error || !s) throw error || new Error('This subliminal could not be loaded.');
  if (finalPlaying) stopFinal();
  editingExistingId = id;
  state.playerTitle = s.title || 'Your Subliminal';
  const matchedFreq = FREQS.find(f => f.hz === s.frequency_hz) || null;
  state.freq = matchedFreq;
  state.affirmations = Array.isArray(s.affirmations) ? s.affirmations.slice() : [];
  state.bg = s.background || 'none';
  /* The layer lives in mix_settings. Only a sound from the other family is a
     layer; anything else is ignored rather than allowed to double one up. */
  const savedLayer = s.mix_settings && s.mix_settings.bgLayer;
  state.bgLayer = savedLayer && typeof ambienceFamily === 'function' && ambienceFamily(savedLayer)
    && ambienceFamily(savedLayer) !== ambienceFamily(state.bg) ? savedLayer : 'none';
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
    state.selectedVoice = VOICE_RECORD_OWN;
    if (recordingLoadErrors.length){
      console.warn('subliminal audio did not load:', recordingLoadErrors);
    }
  } else {
    recordingLoadErrors = [];
    // No recorded audio was saved for this one (or it was a studio voice
    // originally) — reloading plays it back in the voice it was built with.
    state.voiceMode = 'ai';
    state.aiVoiceId = s.ai_voice_id || DEVICE_VOICE;
    /* Reopening a saved subliminal has to put the voice picker back the way it
       was built, or Continue would fork on a blank answer -- and a blank answer
       used to mean the manual recorder. selectedVoiceFromState() reads it back
       out of the two fields this row actually stores. */
    state.selectedVoice = selectedVoiceFromState();
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
  paintLayerVoiceOptions();
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
  restoreMixSettings(id, s.mix_settings);
  activeCoverPath = s.cover_path || null;
  refreshListeningCover();
  if (!(opts && opts.stayHere)){
    showBuildPage();
    showStep(7);
  }
}

async function deleteMySubliminal(id){
  if (!sb || !currentUser) return;
  await sb.from('subliminals').delete().eq('id', id).eq('user_id', currentUser.id);
  forgetFetch('todaySubs'); forgetFetch('todaySubCovers');
  loadMyLibrary({ force: true });
}
/* ---------- cloning your voice ----------
   One sample, read once, and the studio can generate any line in that voice.
   Record it, listen back, record it again if it isn't right — nothing leaves the
   device until "Create my voice" is pressed with the confirmation ticked. Then
   the sample goes to /api/voice-clone and is never stored here; only the
   resulting voice, held server-side against this account, is kept. */
const VOICE_CLONE_SAMPLE = "I am becoming the person I said I would be. Not someday, and not once everything lines up — now, in the ordinary middle of things. I speak to myself the way I would speak to someone I love. I keep what I promised myself I would keep, on the days it is easy and on the days it is not.";
let voiceCloneRecorder = null, voiceCloneChunks = [], voiceCloneStream = null,
    voiceCloneTimer = null, voiceCloneStart = 0;
/* The finished recording, waiting to be listened to and confirmed:
   { blob, url, seconds }. Kept after a failed upload so trying again does not
   mean reading the passage again. */
let voiceCloneTake = null;
/* True while the sample is on its way to the provider. */
let voiceCloneBusy = false;
/* Ticked in this session, for this attempt. Never remembered: a new voice is a
   new confirmation, including when somebody records theirs again. */
let voiceCloneConsented = false;
/* True while replacing a voice that already exists, which is the only way a
   second clone is ever created. */
let voiceCloneReplacing = false;

/* Where this card is drawn. Settings is one mount point and the builder's
   "Use my voice" panel is the other; the recorder, the confirmation and the
   upload are the same code in both. */
let voiceCloneHost = { bodyId: 'voiceCloneBody', msgId: 'voiceCloneMsg' };
function mountVoiceClone(bodyId, msgId){
  voiceCloneHost = { bodyId, msgId };
  voiceCloneConsented = false;
  voiceCloneReplacing = false;
  renderVoiceClone();
}
function unmountVoiceClone(){
  if (voiceCloneRecorder) cancelVoiceClone();
  discardVoiceCloneTake();
  voiceCloneHost = { bodyId: 'voiceCloneBody', msgId: 'voiceCloneMsg' };
  voiceCloneConsented = false;
  voiceCloneReplacing = false;
}
function voiceCloneBodyEl(){ return document.getElementById(voiceCloneHost.bodyId); }
function voiceCloneMsgEl(){ return document.getElementById(voiceCloneHost.msgId); }
function sayVoiceClone(text, kind){
  const msg = voiceCloneMsgEl();
  if (!msg) return;
  msg.textContent = text || '';
  msg.className = 'save-msg' + (text && kind ? ' ' + kind : '');
}
function discardVoiceCloneTake(){
  if (voiceCloneTake && voiceCloneTake.url){ try { URL.revokeObjectURL(voiceCloneTake.url); } catch(e){} }
  voiceCloneTake = null;
}
function voiceCloneClock(secs){ return `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`; }

const VOICE_CLONE_HEADER = `
  <h4 class="voice-clone-title">Clone Your Voice</h4>
  <p class="voice-clone-sub">Create subliminals that sound like you.</p>
  <p class="voice-clone-tip">Find a quiet room, then read the passage below in your natural speaking voice — no music, TV or background noise. About 30 seconds is plenty.</p>`;

async function renderVoiceClone(){
  const body = voiceCloneBodyEl();
  if (!body) return;
  if (voiceCloneBusy){
    body.innerHTML = '<div class="voice-clone-actions"><span class="voice-rec-label">Creating your voice — this takes a moment…</span></div>';
    return;
  }
  if (voiceCloneRecorder){
    const secs = Math.floor((Date.now() - voiceCloneStart) / 1000);
    body.innerHTML = `
      <div class="voice-clone-sample">${VOICE_CLONE_SAMPLE}</div>
      <div class="voice-clone-actions">
        <span class="voice-rec-dot"></span>
        <span class="voice-rec-label">Recording… take your time.</span>
        <span class="voice-rec-time" id="voiceCloneTime">${voiceCloneClock(secs)}</span>
        <button class="mini-btn candlebtn" onclick="finishVoiceClone()">Stop Recording</button>
        <button class="mini-btn ghostbtn" onclick="cancelVoiceClone()">Cancel</button>
      </div>`;
    return;
  }
  const mine = await myVoiceProfile();
  if (mine && !voiceCloneReplacing && !voiceCloneTake){
    body.innerHTML = `
      <div class="voice-clone-have">
        <span><b>Your Voice is Ready ✦</b> — pick <b>${mine.name || 'My voice'}</b> when you choose a voice.</span>
        <button class="mini-btn ghostbtn" onclick="beginReplaceVoice()">Record it again</button>
        <button class="mini-btn ghostbtn" onclick="removeClonedVoice()">Remove it</button>
      </div>`;
    return;
  }
  if (voiceCloneTake){
    /* Listen back, then confirm. The button that sends it anywhere stays
       disabled until the confirmation is ticked — and the sentence ticked is the
       one the server checks the sample against. */
    const consent = await voiceConsentStatement();
    body.innerHTML = `
      ${VOICE_CLONE_HEADER}
      <div class="voice-clone-review">
        <audio controls preload="metadata" src="${voiceCloneTake.url}"></audio>
        <span class="voice-rec-time">${voiceCloneClock(voiceCloneTake.seconds)}</span>
      </div>
      <label class="voice-clone-consent">
        <input type="checkbox" id="voiceCloneConsent" ${voiceCloneConsented ? 'checked' : ''} onchange="setVoiceCloneConsent(this.checked)">
        <span>${consent}</span>
      </label>
      <div class="voice-clone-actions">
        <button class="mini-btn candlebtn" id="voiceCloneCreateBtn" ${voiceCloneConsented ? '' : 'disabled'} onclick="createVoiceClone()">Create My Voice</button>
        <button class="mini-btn ghostbtn" onclick="reRecordVoiceClone()">Re-record</button>
      </div>`;
    return;
  }
  body.innerHTML = `
    ${VOICE_CLONE_HEADER}
    <div class="voice-clone-sample">${VOICE_CLONE_SAMPLE}</div>
    <div class="voice-clone-actions">
      <button class="mini-btn candlebtn" onclick="startVoiceClone()">Start Recording</button>
      ${voiceCloneReplacing ? '<button class="mini-btn ghostbtn" onclick="cancelReplaceVoice()">Keep my current voice</button>' : ''}
    </div>`;
}

function setVoiceCloneConsent(checked){
  voiceCloneConsented = !!checked;
  const btn = document.getElementById('voiceCloneCreateBtn');
  if (btn) btn.disabled = !voiceCloneConsented;
  if (voiceCloneConsented) sayVoiceClone('');
}

/* Recording again replaces the voice at the provider, so it asks again rather
   than reusing the confirmation from the first time. */
function beginReplaceVoice(){
  voiceCloneReplacing = true;
  voiceCloneConsented = false;
  sayVoiceClone('');
  renderVoiceClone();
}
function cancelReplaceVoice(){
  voiceCloneReplacing = false;
  discardVoiceCloneTake();
  sayVoiceClone('');
  renderVoiceClone();
}
function reRecordVoiceClone(){
  discardVoiceCloneTake();
  voiceCloneConsented = false;
  sayVoiceClone('');
  startVoiceClone();
}

async function startVoiceClone(){
  sayVoiceClone('');
  if (!sb || !currentUser){ sayVoiceClone('Sign in first.', 'err'); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder){
    sayVoiceClone("This browser can't record audio.", 'err');
    renderVoiceClone();
    return;
  }
  try { voiceCloneStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(e){ sayVoiceClone('Microphone access is needed to record the sample.', 'err'); renderVoiceClone(); return; }
  const mime = pickRecordingMime();
  voiceCloneChunks = [];
  voiceCloneRecorder = mime ? new MediaRecorder(voiceCloneStream, { mimeType: mime }) : new MediaRecorder(voiceCloneStream);
  voiceCloneRecorder.ondataavailable = ev => { if (ev.data && ev.data.size) voiceCloneChunks.push(ev.data); };
  voiceCloneRecorder.start();
  voiceCloneStart = Date.now();
  renderVoiceClone();
  voiceCloneTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - voiceCloneStart) / 1000);
    const el = document.getElementById('voiceCloneTime');
    if (el) el.textContent = voiceCloneClock(secs);
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
/* Stopping keeps the take for listening back. Nothing is uploaded here. */
function finishVoiceClone(){
  if (!voiceCloneRecorder) return;
  const seconds = Math.round((Date.now() - voiceCloneStart) / 1000);
  const rec = voiceCloneRecorder;
  voiceCloneRecorder = null;
  rec.onstop = () => {
    const blob = new Blob(voiceCloneChunks, { type: rec.mimeType || 'audio/webm' });
    voiceCloneChunks = [];
    stopVoiceCloneStream();
    if (seconds < 8){
      sayVoiceClone('That was very short — read the whole passage so the voice has enough to work from.', 'err');
      renderVoiceClone();
      return;
    }
    discardVoiceCloneTake();
    voiceCloneTake = { blob, url: URL.createObjectURL(blob), seconds };
    voiceCloneConsented = false;
    renderVoiceClone();
  };
  try { rec.stop(); } catch(e){ stopVoiceCloneStream(); renderVoiceClone(); }
}
function createVoiceClone(){
  if (!voiceCloneTake || voiceCloneBusy) return;
  if (!voiceCloneConsented){
    sayVoiceClone('Tick the confirmation first — a voice is only ever made from your own.', 'err');
    return;
  }
  uploadVoiceClone(voiceCloneTake.blob);
}

/* What the routes answer with, in our own words. Never the provider's. */
const VOICE_CLONE_MESSAGES = {
  upgrade_required: null,   // filled in below, it quotes the price
  not_configured:   "Voice cloning isn't switched on yet.",
  consent_required: 'Tick the confirmation first — a voice is only ever made from your own.',
  sample_too_short: 'That recording was too short — read the sample paragraph all the way through.',
  sample_too_long:  'That recording is too long — about a minute is plenty.',
  quota_exceeded:   "The voice service is out of cloning credits this month — your recording wasn't used, and nothing was charged.",
  rate_limited:     'The voice service is busy — try again in a minute.',
  rejected:         "The voice service couldn't use that recording — try again somewhere quieter.",
  invalid_voice:    "The voice service couldn't use that recording — try again somewhere quieter.",
  timeout:          'The voice service took too long — try again in a moment.',
  network:          "Couldn't reach the voice service — try again in a moment.",
  not_signed_in:    'Sign in first.',
};
function voiceCloneErrorText(code){
  if (code === 'upgrade_required') return `Cloning your voice comes with Ritual — ${tierPriceText('ritual')}.`;
  return VOICE_CLONE_MESSAGES[code] || "Couldn't clone your voice — try again in a moment.";
}

async function uploadVoiceClone(blob){
  if (!sb || !currentUser){ sayVoiceClone('Sign in first.', 'err'); return; }
  voiceCloneBusy = true;
  sayVoiceClone('');
  renderVoiceClone();
  /* On any failure the take is still there, so the person can press Create
     again — or listen and re-record — without reading the passage again. */
  const failed = (text) => {
    voiceCloneBusy = false;
    sayVoiceClone(text, 'err');
    renderVoiceClone();
  };
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token){ failed(voiceCloneErrorText('not_signed_in')); return; }
    const headers = {
      'Content-Type': blob.type || 'audio/webm',
      Authorization: `Bearer ${token}`,
      // The confirmation travels with the sample, and the route checks it against
      // its own copy of the sentence before spending anything.
      'X-Voice-Consent': await voiceConsentStatement(),
    };
    if (voiceCloneReplacing) headers['X-Voice-Replace'] = '1';
    const res = await fetch(`${API_BASE}/api/voice-clone`, { method: 'POST', headers, body: blob });
    const out = await res.json().catch(() => ({}));
    if (!res.ok){ failed(voiceCloneErrorText(out.error)); return; }
    voiceCloneBusy = false;
    voiceCloneReplacing = false;
    voiceCloneConsented = false;
    discardVoiceCloneTake();
    forgetVoiceCatalogue();          // the picker asks again, and finds the voice
    await loadVoiceCatalogue();
    if (voiceCloneHost.bodyId === 'builderVoiceCloneBody' && typeof onMyVoiceReady === 'function'){
      // Recorded from the builder: the panel closes and the voice they just made
      // is the voice selected, which is what they were asking for.
      onMyVoiceReady();
      return;
    }
    sayVoiceClone('Your Voice is Ready ✦', 'ok');
    renderVoiceClone();
  } catch (e){
    console.error('voice clone failed:', e);
    failed("Couldn't reach the voice service — try again in a moment.");
  }
}
async function removeClonedVoice(){
  const msg = voiceCloneMsgEl();
  if (msg){ msg.textContent = 'Removing…'; msg.className = 'save-msg'; }
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const res = await fetch(`${API_BASE}/api/voice-clone`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('remove failed');
    voiceCloneReplacing = false;
    forgetVoiceCatalogue();
    await loadVoiceCatalogue();
    // Any subliminal set to "My voice" now falls back to the device voice.
    if (state.aiVoiceId === MY_CLONED_VOICE) state.aiVoiceId = DEVICE_VOICE;
    if (msg){ msg.textContent = 'Removed.'; msg.className = 'save-msg ok'; }
    renderVoiceClone();
    if (typeof renderVoiceCards === 'function' && document.getElementById('voiceClone')) renderVoiceCards();
  } catch (e){
    if (msg){ msg.textContent = "Couldn't remove it — try again in a moment."; msg.className = 'save-msg err'; }
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
  if (finalPlaying && libraryNowPlayingId === id){ toggleImmersivePlayback(); openImmersivePlayer(); return; }
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
/* ---------- cover art ----------
   Eight covers that ship with the app, cut from artwork Kyla already owns, and
   an upload for anyone who wants their own picture.

   The built-in ones are the main path on purpose. They need no storage bucket,
   no signed link and no network — "Bucket not found" was the whole of the
   upload experience until the migration is run, and a picture you choose from a
   shelf is a better first experience than one you have to go and find anyway.

   Both end up in the same column: a built-in is stored as `builtin:night`, an
   upload as the path to the file. The prefix is what tells them apart, so
   nothing else in the app has to care which kind it is. */
const BUILTIN_COVERS = [
  { key:'sunrise', name:'Sunrise' },
  { key:'night',   name:'Night sky' },
  { key:'clouds',  name:'Above the clouds' },
  { key:'garden',  name:'The garden' },
  { key:'bedroom', name:'The bedroom' },
  { key:'waters',  name:'The waters' },
  { key:'mirror',  name:'The mirror' },
  { key:'home',    name:'The whole house' },
];
const COVER_PX = 512;

function builtinCoverUrl(path){
  const key = String(path || '').slice('builtin:'.length);
  return BUILTIN_COVERS.some(c => c.key === key) ? `img/covers/${key}.webp` : null;
}

function pickCoverFor(id){
  closeCoverPicker();
  const pop = document.createElement('div');
  pop.className = 'cover-pop'; pop.id = 'coverPop';
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose a cover');
  pop.innerHTML = `
    <div class="cover-pop-grid">
      ${BUILTIN_COVERS.map(c => `
        <button type="button" onclick="setBuiltinCover('${id}','${c.key}')" title="${c.name}">
          <img src="img/covers/${c.key}.webp" alt="${c.name}" loading="lazy">
        </button>`).join('')}
    </div>
    <div class="cover-pop-foot">
      <button type="button" onclick="pickCoverUpload('${id}')">Use my own picture…</button>
      <button type="button" onclick="closeCoverPicker()">Cancel</button>
    </div>`;
  document.body.appendChild(pop);
  const first = pop.querySelector('button'); if (first) first.focus();
  setTimeout(() => document.addEventListener('click', coverPopOutside), 0);
}
function coverPopOutside(e){
  const pop = document.getElementById('coverPop');
  if (pop && !pop.contains(e.target)) closeCoverPicker();
}
function closeCoverPicker(){
  const pop = document.getElementById('coverPop');
  if (pop) pop.remove();
  document.removeEventListener('click', coverPopOutside);
}

async function setBuiltinCover(id, key){
  closeCoverPicker();
  const msg = document.getElementById('libTitleMsg-' + id);
  if (!sb || !currentUser) return;
  const { error } = await sb.from('subliminals')
    .update({ cover_path: 'builtin:' + key }).eq('id', id).eq('user_id', currentUser.id);
  if (error){ mixMessage(describeCoverError(error)); if(msg)msg.textContent=describeCoverError(error); return; }
  showCover(id, 'builtin:' + key, true);
  ['todaySubs','todaySubCovers','myLibrary'].forEach(forgetFetch);
  mixMessage('Cover saved');
}

/* The one error anyone actually hits, said in words that name the fix. */
function describeCoverError(e){
  const m = (e && e.message) || '';
  if (/column .*cover_path|cover_path .*does not exist/i.test(m))
    return 'Covers need one more database update — run 20260925 and this will stick.';
  if (/bucket not found/i.test(m))
    return 'Uploads need the covers bucket, which comes with 20260925. The covers above work without it.';
  return m || 'That cover could not be saved.';
}

function pickCoverUpload(id){
  closeCoverPicker();
  let input = document.getElementById('coverPicker');
  if (!input){
    input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.id = 'coverPicker';
    input.style.display = 'none';
    document.body.appendChild(input);
  }
  input.onchange = () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) uploadCover(id, file);
  };
  input.click();
}

/* Square, centre-cropped, WebP. Resized here rather than uploaded whole: a photo
   off a phone is three to six megabytes and is about to be drawn at forty-six
   pixels. Centre-cropped rather than squashed, because a portrait squeezed into
   a square makes a face look wrong in a way people notice without being able to
   say why. */
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
  const say = t => { if (msg) msg.textContent = t; mixMessage(t); };
  say('Adding the cover…');
  try {
    const blob = await squareCover(file);
    const path = `${currentUser.id}/${id}.webp`;
    const { error: upErr } = await sb.storage.from('covers')
      .upload(path, blob, { upsert: true, contentType: 'image/webp' });
    if (upErr) throw upErr;
    const { error: dbErr } = await sb.from('subliminals')
      .update({ cover_path: path }).eq('id', id).eq('user_id', currentUser.id);
    if (dbErr) throw dbErr;
    say('Cover saved');
    ['todaySubs','todaySubCovers','myLibrary'].forEach(forgetFetch);
    await showCover(id, path, true);
  } catch (e){
    say(describeCoverError(e));
  }
}

/* A built-in is a file that ships with the app, so it needs no round trip. An
   upload needs a signed link, which expires, so it is fetched at render time. */
async function showCover(id, path, bust){
  if(id===activeMixId){activeCoverPath=path;refreshListeningCover();}
  const img = document.getElementById('libCoverImg-' + id);
  if (!path || !img) return;
  const builtin = builtinCoverUrl(path);
  const wrap = document.getElementById('libCover-' + id);
  if (builtin){
    img.src = builtin; img.style.display = 'block';
    if (wrap) wrap.classList.add('has-art');
    return;
  }
  if (!sb) return;
  const { data, error } = await sb.storage.from('covers').createSignedUrl(path, 3600);
  if (error || !data) return;
  img.src = data.signedUrl + (bust ? '&t=' + Date.now() : '');
  img.style.display = 'block';
  if (wrap) wrap.classList.add('has-art');
}

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
    delete bar.dataset.built;
    document.body.classList.remove('has-now-bar');
    return;
  }
  const title = (typeof currentPlayerTitle === 'function' && currentPlayerTitle()) || currentSubliminalTitle() || 'Your subliminal';
  const line  = (document.getElementById('finalLine') || {}).textContent || '';
  /* Rebuilt every second, so a slider mid-drag must not be torn out from under
     the finger. Only the text changes on a tick; the controls are built once. */
  if (!bar.dataset.built){
    bar.innerHTML = `
      <div class="now-bar-in">
        <span class="nb-pulse" aria-hidden="true"></span>
        <button type="button" class="nb-txt" onclick="openImmersivePlayer()" aria-label="Open the full-screen player">
          <b id="nbTitle"></b>
          <span id="nbLine"></span>
        </button>
        <button type="button" class="nb-play" id="nbPlay" onclick="toggleImmersivePlayback()" aria-label="Pause"></button>
        <button type="button" class="nb-restart" onclick="restartListening()" aria-label="Start over">${svgIcon('restart')}<span>Start over</span></button>
      </div>`;
    bar.dataset.built = '1';
  }
  const tEl = document.getElementById('nbTitle');
  const lEl = document.getElementById('nbLine');
  if (tEl) tEl.textContent = title;
  if (lEl) lEl.textContent = String(line).slice(0, 90);
  /* One word for the state you are in, on both buttons, with the same mark the
     full-screen player shows. Never "Playing…", which named the state you were
     already in and left nothing to press. */
  const paused = !!finalPaused;
  const playButton = document.getElementById('nbPlay');
  if(playButton){playButton.innerHTML=svgIcon(paused?'play':'pause');playButton.setAttribute('aria-label',paused?'Play':'Pause');}
  const finalButton = document.getElementById('finalPlayBtn');
  if(finalButton){
    finalButton.disabled=false;
    finalButton.innerHTML=svgIcon(paused?'play':'pause')+'<span>'+(paused?'Play':'Pause')+'</span>';
    finalButton.classList.add('play-control');
  }
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


