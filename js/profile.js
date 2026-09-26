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
  // builder's "Use my voice" panel), so say which one before rendering it --
  // unless the builder has it in use and this is only an auth event redrawing
  // Settings in the background.
  if (!voiceCloneHeldElsewhere('voiceCloneBody')) mountVoiceClone('voiceCloneBody', 'voiceCloneMsg');
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
  const tier = await getMyTier();
  /* Only a plan with a ceiling gets the bar. An unlimited plan has nothing to
     count, and its "Unlimited subliminals" card sat above the saved list looking
     like a button that did nothing. */
  if (!(tierLibraryCap(tier) < Infinity)){ host.innerHTML = ''; return; }
  host.innerHTML = planLimitMarkup(used, tier);
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
  const createCard = document.getElementById('myLibraryCreate');
  if (error){
    if (createCard) createCard.style.display = '';
    list.innerHTML = '<div class="library-empty">Your subliminals couldn\'t load just now — try again in a moment.</div>';
    return;
  }
  /* Empty is its own welcome with its own button, so the card above steps aside
     rather than asking the same thing twice. */
  if (createCard) createCard.style.display = (subs && subs.length) ? '' : 'none';
  if (!subs || !subs.length){
    list.innerHTML = `<div class="lib-first">
      <h3>Your subliminals will live here <span aria-hidden="true">✦</span></h3>
      <p>Create your first personalized subliminal and come back anytime to listen or make adjustments.</p>
      <button type="button" class="btn btn-primary" onclick="startNewSubliminal()">Create My First Subliminal</button>
    </div>`;
    return;
  }
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
   At least a minute of somebody's own voice — recorded here, or taken from an
   audio or video file they already have — and the studio can generate any line
   in that voice. Nothing leaves the device until "Create My Voice" is pressed
   with the confirmation ticked.

   Every sample, recorded or uploaded, is decoded here and turned into one plain
   format before it is sent: 16-bit PCM WAV, mono, 22.05 kHz, at most 90 seconds
   (see prepareVoiceSample). That is what ElevenLabs reads without question, it
   fits under the 4.5 MB a Vercel function will accept, and it is what
   /api/voice-clone measures to check the minute is really there. The sample is
   never stored; only the resulting voice, held server-side against this
   account, is kept.

   Every step that waits on something — the microphone, the recorder handing
   over its audio, decoding, the network — has a time limit, and every path ends
   in the next screen or in a message with a way forward. Nothing here can leave
   the card on a spinner. */
const VOICE_CLONE_SAMPLE = "I am becoming the person I said I would be. Not someday, and not once everything lines up — now, in the ordinary middle of things. I speak to myself the way I would speak to someone I love. I keep what I promised myself I would keep, on the days it is easy and on the days it is not. I am allowed to take up space. I am allowed to rest without earning it. The life I want is not waiting somewhere far away; I build it in small choices, one after another, and I notice every one of them. When I stumble, I begin again, gently, without keeping score. I trust myself a little more each day, because I keep showing up.";
/* Instant Voice Cloning needs at least a minute of speech to sound like the
   person. The server checks the same minute on the audio it receives. */
const VOICE_CLONE_MIN_SECONDS = 60;
const VOICE_CLONE_MIN_TOLERANCE = 0.5;   // 1:00 on the clock can decode to 59.9s
const VOICE_CLONE_MIN_VOICED = 15;       // seconds clearly above the room, of that minute
const VOICE_CLONE_SEND_SECONDS = 90;     // more than this does not improve an instant clone
const VOICE_CLONE_RATE = 22050;
const VOICE_CLONE_MAX_RECORD_SECONDS = 180;
/* An upload is decoded whole, in memory. These keep a long 4K video from
   taking the tab down on a phone. */
const VOICE_CLONE_MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const VOICE_CLONE_MAX_UPLOAD_SECONDS = 10 * 60;
/* Time limits. Past these something is wrong, and saying so beats waiting. */
const VOICE_CLONE_MIC_TIMEOUT_MS = 20000;      // includes the permission prompt
const VOICE_CLONE_STOP_TIMEOUT_MS = 5000;      // recorder handing over its audio
const VOICE_CLONE_DECODE_TIMEOUT_MS = 45000;
const VOICE_CLONE_UPLOAD_TIMEOUT_MS = 80000;   // the route gives ElevenLabs 50s of its 60
const VOICE_CLONE_AUTH_TIMEOUT_MS = 10000;
const VOICE_CLONE_SHORT_TEXT = 'We need at least 1 minute of your voice to create your AI voice. Keep recording or choose a longer file.';

let voiceCloneRecorder = null, voiceCloneStream = null,
    voiceCloneTimer = null, voiceCloneStart = 0;
/* 'record' or 'upload': which of the two ways in is open. */
let voiceCloneSource = 'record';
/* True while the microphone is being opened — which on a phone is a permission
   prompt, and a second press of Start during it used to open a second stream. */
let voiceCloneStarting = false;
/* What is being worked on between Stop (or choosing a file) and the take being
   ready, shown as the label; null when nothing is. */
let voiceCloneChecking = null;
/* The finished, prepared sample, waiting to be listened to and confirmed:
   { blob (WAV), url, seconds, voicedSeconds, source, fileName }. Kept after a
   failed upload so trying again does not mean recording again. A take under a
   minute is kept too, so it can be listened to, but cannot be sent. */
let voiceCloneTake = null;
/* True while the sample is on its way to the provider. */
let voiceCloneBusy = false;
/* Ticked in this session, for this attempt. Never remembered: a new voice is a
   new confirmation, including when somebody records theirs again. */
let voiceCloneConsented = false;
/* True while replacing a voice that already exists, which is the only way a
   second clone is ever created. */
let voiceCloneReplacing = false;
/* renderVoiceClone awaits the catalogue; a newer render makes an older one moot. */
let voiceCloneRenderSeq = 0;
/* Bumped by anything that throws away the take in progress (Cancel, Record
   Again, Remove, the card closing), so a decode still running for the old one
   cannot land on top of the new one. */
let voiceCloneAttempt = 0;

/* Where this card is drawn. Settings is one mount point and the builder's
   "Use my voice" panel is the other; the recorder, the confirmation and the
   upload are the same code in both, and only one of them is live at a time. */
let voiceCloneHost = { bodyId: 'voiceCloneBody', msgId: 'voiceCloneMsg' };
function mountVoiceClone(bodyId, msgId){
  if (voiceCloneHost.bodyId !== bodyId){
    /* Moving the card: the old copy is emptied, so there is never a second set
       of controls on the page answering to the same state. The take moves with
       it; the confirmation does not. */
    const oldBody = voiceCloneBodyEl(), oldMsg = voiceCloneMsgEl();
    if (oldBody) oldBody.innerHTML = '';
    if (oldMsg){ oldMsg.textContent = ''; oldMsg.className = 'save-msg'; }
    voiceCloneHost = { bodyId, msgId };
    voiceCloneConsented = false;
    if (!voiceCloneTake && !voiceCloneRecorder && !voiceCloneStarting) voiceCloneReplacing = false;
  }
  /* Redrawing where it already is keeps the take and the tick — the panel is
     redrawn whenever the voice step is, and that is not a reason to lose either. */
  renderVoiceClone();
}
/* Settings redraws on every auth event, including the "signed in" supabase-js
   reports when a backgrounded tab or a permission prompt hands focus back. That
   must not pull the card out from under somebody using it in the builder. */
function voiceCloneHeldElsewhere(bodyId){
  if (voiceCloneHost.bodyId === bodyId) return false;
  const el = voiceCloneBodyEl();
  return !!(el && el.isConnected && document.body.getAttribute('data-view') !== 'profile');
}
function unmountVoiceClone(){
  if (voiceCloneRecorder) cancelVoiceClone();
  voiceCloneAttempt++;
  voiceCloneChecking = null;
  discardVoiceCloneTake();
  voiceCloneHost = { bodyId: 'voiceCloneBody', msgId: 'voiceCloneMsg' };
  voiceCloneConsented = false;
  voiceCloneReplacing = false;
}
function voiceCloneBodyEl(){ return document.getElementById(voiceCloneHost.bodyId); }
function voiceCloneMsgEl(){ return document.getElementById(voiceCloneHost.msgId); }
/* Controls are looked up inside the live card, never by a page-wide id. */
function voiceClonePart(name){
  const body = voiceCloneBodyEl();
  return body ? body.querySelector(`[data-vc="${name}"]`) : null;
}
function sayVoiceClone(text, kind){
  const msg = voiceCloneMsgEl();
  if (!msg) return;
  msg.textContent = text || '';
  msg.className = 'save-msg' + (text && kind ? ' ' + kind : '');
}
function discardVoiceCloneTake(){
  const el = voiceClonePart('preview');
  if (el){ try { el.pause(); el.removeAttribute('src'); el.load(); } catch(e){} }
  voiceCloneAudioSession(null);
  if (voiceCloneTake && voiceCloneTake.url){ try { URL.revokeObjectURL(voiceCloneTake.url); } catch(e){} }
  voiceCloneTake = null;
}
function voiceCloneClock(secs){
  secs = Math.max(0, Math.floor(secs));
  return `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
}
function voiceCloneLongEnough(seconds){ return seconds >= VOICE_CLONE_MIN_SECONDS - VOICE_CLONE_MIN_TOLERANCE; }
function voiceCloneCanCreate(){
  return !!(voiceCloneTake && voiceCloneTake.ok && voiceCloneConsented && !voiceCloneBusy);
}
/* A promise that gives up. `code` is what it rejects with, so the caller can
   say which step it was. */
function voiceCloneWithin(ms, promise, code){
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => { const e = new Error(code); e.code = code; reject(e); }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
function voiceCloneEscape(text){
  return String(text || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

const VOICE_CLONE_HEADER = `
  <h4 class="voice-clone-title">Create Your AI Voice</h4>
  <p class="voice-clone-sub">Give us at least 1 minute of your natural speaking voice so we can create your personal AI voice.</p>
  <p class="voice-clone-tip">Find a quiet space and speak naturally. Avoid music, TV, other people talking, heavy background noise, or audio effects.</p>`;

function voiceCloneOptionsHtml(){
  const rec = voiceCloneSource === 'record';
  return `
    <div class="voice-clone-options" role="tablist">
      <button class="mini-btn ${rec ? 'candlebtn' : 'ghostbtn'}" role="tab" aria-selected="${rec}" onclick="setVoiceCloneSource('record')">🎙 Record Your Voice</button>
      <button class="mini-btn ${rec ? 'ghostbtn' : 'candlebtn'}" role="tab" aria-selected="${!rec}" onclick="setVoiceCloneSource('upload')">⬆ Upload Audio or Video</button>
    </div>`;
}
function setVoiceCloneSource(source){
  if (voiceCloneBusy || voiceCloneRecorder || voiceCloneStarting || voiceCloneChecking) return;
  if (source === voiceCloneSource) return;
  voiceCloneSource = source === 'upload' ? 'upload' : 'record';
  voiceCloneAttempt++;
  discardVoiceCloneTake();
  voiceCloneConsented = false;
  sayVoiceClone('');
  renderVoiceClone();
}

async function renderVoiceClone(){
  const seq = ++voiceCloneRenderSeq;
  const body = voiceCloneBodyEl();
  if (!body) return;
  if (voiceCloneBusy){
    body.innerHTML = `${VOICE_CLONE_HEADER}<div class="voice-clone-actions"><span class="voice-rec-dot"></span><span class="voice-rec-label">Creating your voice — this usually takes under a minute…</span></div>`;
    return;
  }
  if (voiceCloneChecking){
    body.innerHTML = `${VOICE_CLONE_HEADER}<div class="voice-clone-actions"><span class="voice-rec-label">${voiceCloneEscape(voiceCloneChecking)}</span></div>`;
    return;
  }
  if (voiceCloneRecorder || voiceCloneStarting){
    const secs = voiceCloneRecorder ? (Date.now() - voiceCloneStart) / 1000 : 0;
    body.innerHTML = `
      ${VOICE_CLONE_HEADER}
      <div class="voice-clone-sample">${VOICE_CLONE_SAMPLE}</div>
      <p class="voice-clone-tip">Read the passage, then keep talking naturally — about your day, anything — until the timer passes 1:00.</p>
      <div class="voice-clone-actions">
        ${voiceCloneRecorder ? `
        <span class="voice-rec-dot"></span>
        <span class="voice-rec-label">Recording…</span>
        <span class="voice-rec-time" data-vc="time">${voiceCloneTimerText(secs)}</span>
        <button class="mini-btn candlebtn" data-vc="stop" onclick="finishVoiceClone()">${voiceCloneLongEnough(secs) ? 'Done — review it' : 'Stop'}</button>
        <button class="mini-btn ghostbtn" onclick="cancelVoiceClone()">Cancel</button>` : `
        <span class="voice-rec-label">Waiting for the microphone…</span>`}
      </div>`;
    return;
  }
  if (voiceCloneTake){
    /* Listen back, then confirm. The button that sends it anywhere stays
       disabled until the sample is long enough and the confirmation is ticked —
       and the sentence ticked is the one the server checks the sample against. */
    const consent = await voiceConsentStatement();
    if (seq !== voiceCloneRenderSeq || !voiceCloneTake) return;
    const live = voiceCloneBodyEl();
    if (!live) return;
    const t = voiceCloneTake;
    const upload = t.source === 'upload';
    live.innerHTML = `
      ${VOICE_CLONE_HEADER}
      ${voiceCloneOptionsHtml()}
      ${upload ? `<div class="voice-clone-file"><span class="voice-clone-file-name">${voiceCloneEscape(t.fileName)}</span><span class="voice-rec-time">${voiceCloneClock(Math.round(t.seconds))}</span></div>` : ''}
      <div class="voice-clone-review">
        <audio controls preload="auto" playsinline data-vc="preview"></audio>
        <span class="voice-rec-time">${t.ok ? voiceCloneClock(Math.round(t.seconds)) : `${voiceCloneClock(Math.round(t.seconds))} / 1:00 minimum`}</span>
      </div>
      <label class="voice-clone-consent">
        <input type="checkbox" data-vc="consent" ${voiceCloneConsented ? 'checked' : ''} ${t.ok ? '' : 'disabled'} onchange="setVoiceCloneConsent(this.checked)">
        <span>${voiceCloneEscape(consent)}</span>
      </label>
      <div class="voice-clone-actions">
        <button class="mini-btn candlebtn" data-vc="create" ${voiceCloneCanCreate() ? '' : 'disabled'} onclick="createVoiceClone()">Create My Voice</button>
        ${upload
          ? '<button class="mini-btn ghostbtn" onclick="removeVoiceCloneUpload()">Remove and choose another</button>'
          : '<button class="mini-btn ghostbtn" onclick="reRecordVoiceClone()">Record Again</button>'}
        ${voiceCloneReplacing ? '<button class="mini-btn ghostbtn" onclick="cancelReplaceVoice()">Keep my current voice</button>' : ''}
      </div>`;
    wireVoiceClonePreview(live.querySelector('[data-vc="preview"]'));
    return;
  }
  const mine = await myVoiceProfile();
  if (seq !== voiceCloneRenderSeq) return;
  const live = voiceCloneBodyEl();
  if (!live) return;
  if (mine && !voiceCloneReplacing){
    live.innerHTML = `
      <div class="voice-clone-have">
        <span><b>Your voice is ready ✓</b> — pick <b>${voiceCloneEscape(mine.name || 'My voice')}</b> when you choose a voice.</span>
        <button class="mini-btn ghostbtn" data-vc="test" onclick="testClonedVoice()">Hear a test affirmation</button>
        <button class="mini-btn ghostbtn" onclick="beginReplaceVoice()">Record it again</button>
        <button class="mini-btn ghostbtn" onclick="removeClonedVoice()">Remove it</button>
      </div>
      <audio data-vc="test-audio" playsinline preload="none"></audio>`;
    return;
  }
  const keep = voiceCloneReplacing ? '<button class="mini-btn ghostbtn" onclick="cancelReplaceVoice()">Keep my current voice</button>' : '';
  if (voiceCloneSource === 'upload'){
    live.innerHTML = `
      ${VOICE_CLONE_HEADER}
      ${voiceCloneOptionsHtml()}
      <p class="voice-clone-tip">Choose a recording or a video of you speaking — at least 1 minute, just your voice. From a video only the sound is used; the video itself is never uploaded.</p>
      <input type="file" data-vc="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.mp4,.mov,.webm,.ogg,.oga,.flac,.caf,.3gp" hidden onchange="chooseVoiceCloneFile(this)">
      <div class="voice-clone-actions">
        <button class="mini-btn candlebtn" onclick="pickVoiceCloneFile()">Choose a file</button>
        ${keep}
      </div>`;
    return;
  }
  live.innerHTML = `
    ${VOICE_CLONE_HEADER}
    ${voiceCloneOptionsHtml()}
    <div class="voice-clone-sample">${VOICE_CLONE_SAMPLE}</div>
    <div class="voice-clone-actions">
      <button class="mini-btn candlebtn" onclick="startVoiceClone()">Start Recording</button>
      <span class="voice-rec-time">0:00 / 1:00 minimum</span>
      ${keep}
    </div>`;
}
function voiceCloneTimerText(secs){
  return voiceCloneLongEnough(secs) ? `${voiceCloneClock(secs)} ✓` : `${voiceCloneClock(secs)} / 1:00 minimum`;
}

/* ---------- listening back ----------
   The player on the card is given the take and nothing else: its own element,
   the take's own URL, full volume, not muted. Pressing it quiets anything else
   the app might be playing, so what is heard is only the recording. What plays
   is the WAV that will be sent — so what they approve is what the voice is made
   from. */
function wireVoiceClonePreview(el){
  if (!el || !voiceCloneTake) return;
  el.src = voiceCloneTake.url;
  el.defaultMuted = false;
  el.muted = false;
  el.volume = 1;
  el.addEventListener('play', () => {
    if (!voiceCloneTake || el.src !== voiceCloneTake.url){ el.pause(); return; }
    el.muted = false; el.volume = 1;
    if (typeof stopSerenityPreview === 'function') stopSerenityPreview();
    if (typeof stopAmbiencePreview === 'function') stopAmbiencePreview();
    if (typeof stopPlayerAmbiencePreview === 'function') stopPlayerAmbiencePreview();
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch(e){}
    voiceCloneAudioSession('playback');
  });
  el.addEventListener('ended', () => voiceCloneAudioSession(null));
  el.addEventListener('error', () => {
    console.error('[voice-clone] the prepared sample would not play back', el.error && el.error.code);
  });
  el.load();
}
/* iPhone and iPad: once the microphone has been open, WebKit can leave audio
   routed as a phone call — to the earpiece, quietly — so a take played straight
   after recording is barely audible, or not at all. Asking for plain playback
   while the preview plays puts it back on the speaker. Put back as it was after,
   so the next recording can open the microphone. Nothing else in the app is
   touched; browsers without navigator.audioSession skip all of this. */
let voiceClonePriorSession = null;
function voiceCloneAudioSession(type){
  const session = navigator.audioSession;
  if (!session || !('type' in session)) return;
  try {
    if (type === null){
      if (voiceClonePriorSession !== null){ session.type = voiceClonePriorSession; voiceClonePriorSession = null; }
      return;
    }
    if (voiceClonePriorSession === null) voiceClonePriorSession = session.type;
    session.type = type;
  } catch(e){}
}

function setVoiceCloneConsent(checked){
  voiceCloneConsented = !!checked;
  const btn = voiceClonePart('create');
  if (btn) btn.disabled = !voiceCloneCanCreate();
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
  if (voiceCloneBusy) return;
  voiceCloneReplacing = false;
  voiceCloneAttempt++;
  discardVoiceCloneTake();
  sayVoiceClone('');
  renderVoiceClone();
}
function reRecordVoiceClone(){
  if (voiceCloneBusy || voiceCloneChecking) return;
  voiceCloneAttempt++;
  discardVoiceCloneTake();
  voiceCloneConsented = false;
  sayVoiceClone('');
  startVoiceClone();
}

/* ---------- recording ----------
   The recorder's own format does not matter much any more — every take is
   decoded and re-encoded as WAV before it goes anywhere — but it does have to be
   one this browser can decode. Safari (every browser on iPhone and iPad, and the
   app itself there) records AAC in MP4 natively and decodes it; its WebM output
   often will not decode in its own Web Audio. So on WebKit MP4 comes first;
   everywhere else WebM/Opus. */
function voiceCloneIsWebKit(){
  return /^Apple/.test(navigator.vendor || '') || /iPad|iPhone|iPod/.test(navigator.userAgent || '');
}
function pickVoiceCloneMime(){
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const probe = document.createElement('audio');
  const playable = t => !probe.canPlayType || probe.canPlayType(t.split(';')[0]) !== '';
  const mp4 = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
  const opus = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const order = voiceCloneIsWebKit() ? mp4.concat(opus) : opus.concat(mp4);
  return order.find(t => MediaRecorder.isTypeSupported(t) && playable(t)) || '';
}

async function startVoiceClone(){
  if (voiceCloneRecorder || voiceCloneStarting || voiceCloneBusy || voiceCloneChecking) return;
  sayVoiceClone('');
  if (!sb || !currentUser){ sayVoiceClone('Sign in first.', 'err'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder){
    sayVoiceClone("This browser can't record audio — choose Upload Audio or Video instead.", 'err');
    renderVoiceClone();
    return;
  }
  voiceCloneSource = 'record';
  voiceCloneAudioSession(null);   // a session left on "playback" can keep the microphone shut
  voiceCloneStarting = true;
  const attempt = ++voiceCloneAttempt;
  renderVoiceClone();
  let stream;
  try {
    stream = await voiceCloneWithin(VOICE_CLONE_MIC_TIMEOUT_MS,
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }),
      'mic_timeout');
  } catch(e){
    voiceCloneStarting = false;
    console.error('[voice-clone] microphone refused:', e && (e.code || e.name), e && e.message);
    sayVoiceClone(e && e.code === 'mic_timeout'
      ? "The microphone didn't start — check nothing else is using it, then try again."
      : 'Microphone access is needed to record — allow it in your browser or device settings, then try again.', 'err');
    renderVoiceClone();
    return;
  }
  voiceCloneStarting = false;
  if (attempt !== voiceCloneAttempt){ stream.getTracks().forEach(t => t.stop()); return; }
  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState !== 'live'){
    stream.getTracks().forEach(t => t.stop());
    console.error('[voice-clone] no live microphone track', track && track.readyState);
    sayVoiceClone("Your microphone didn't start — check nothing else is using it, then try again.", 'err');
    renderVoiceClone();
    return;
  }
  const mime = pickVoiceCloneMime();
  let rec;
  try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
  catch(e){
    try { rec = new MediaRecorder(stream); }
    catch(e2){
      stream.getTracks().forEach(t => t.stop());
      console.error('[voice-clone] MediaRecorder could not start:', e2);
      sayVoiceClone("This browser can't record audio — choose Upload Audio or Video instead.", 'err');
      renderVoiceClone();
      return;
    }
  }
  /* Everything about this take lives with this take, so a cancelled or replaced
     recorder can never add its audio to the next one. */
  const chunks = [];
  rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  rec.onerror = ev => {
    console.error('[voice-clone] recorder error:', ev && (ev.error || ev));
    // A recorder that errors stops by itself; take what it has rather than wait.
    if (voiceCloneRecorder === rec) finishVoiceClone();
  };
  rec._chunks = chunks;
  rec._mime = mime;
  // The microphone going away mid-take (a call, another app) ends the take there.
  track.onended = () => { if (voiceCloneRecorder === rec) finishVoiceClone(); };
  voiceCloneStream = stream;
  voiceCloneRecorder = rec;
  try { rec.start(); }
  catch(e){
    voiceCloneRecorder = null;
    stopVoiceCloneStream();
    console.error('[voice-clone] recorder would not start:', e);
    sayVoiceClone("Recording couldn't start on this device — try again, or choose Upload Audio or Video.", 'err');
    renderVoiceClone();
    return;
  }
  voiceCloneStart = Date.now();
  renderVoiceClone();
  voiceCloneTimer = setInterval(() => {
    const secs = (Date.now() - voiceCloneStart) / 1000;
    const el = voiceClonePart('time');
    if (el) el.textContent = voiceCloneTimerText(secs);
    const stop = voiceClonePart('stop');
    if (stop) stop.textContent = voiceCloneLongEnough(secs) ? 'Done — review it' : 'Stop';
    if (secs >= VOICE_CLONE_MAX_RECORD_SECONDS) finishVoiceClone();  // well past what cloning needs
  }, 250);
}
function stopVoiceCloneStream(){
  clearInterval(voiceCloneTimer); voiceCloneTimer = null;
  if (voiceCloneStream){ voiceCloneStream.getTracks().forEach(t => { t.onended = null; t.stop(); }); voiceCloneStream = null; }
}
function cancelVoiceClone(){
  if (!voiceCloneRecorder) return;
  const rec = voiceCloneRecorder;
  voiceCloneRecorder = null;
  voiceCloneAttempt++;
  rec.onstop = null; rec.ondataavailable = null; rec.onerror = null;
  try { if (rec.state !== 'inactive') rec.stop(); } catch(e){}
  stopVoiceCloneStream();
  renderVoiceClone();
}
/* Stopping keeps the take for listening back, once it has been decoded, checked
   for actual sound and turned into the WAV that will be sent. Nothing is
   uploaded here.

   This is where the card used to hang on "Checking your recording…". The
   handler that did the checking was only ever reached through the recorder's
   stop event, and had no time limit and no catch: a recorder that had already
   stopped by itself (iOS does this on an interruption) never fires stop again;
   decoding a take can stall in WebKit; and anything that threw left the card
   on that label for good. Now the recorder gets a few seconds to hand over its
   audio, the decode has its own limit, and every outcome lands somewhere. */
function finishVoiceClone(){
  if (!voiceCloneRecorder) return;
  const timedSeconds = (Date.now() - voiceCloneStart) / 1000;
  const rec = voiceCloneRecorder;
  voiceCloneRecorder = null;
  clearInterval(voiceCloneTimer); voiceCloneTimer = null;
  const attempt = voiceCloneAttempt;
  voiceCloneChecking = 'Checking your recording…';
  renderVoiceClone();

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    rec.onstop = null;
    stopVoiceCloneStream();
    const chunks = rec._chunks || [];
    const declared = rec.mimeType || rec._mime || '';
    const blob = new Blob(chunks, declared ? { type: declared } : undefined);
    console.log('[voice-clone] recording finished', { bytes: blob.size, type: declared, chunks: chunks.length, timedSeconds: +timedSeconds.toFixed(1) });
    acceptVoiceCloneMedia(blob, { source: 'record', timedSeconds, attempt });
  };
  rec.onstop = settle;
  // If stop never comes, go with whatever audio was handed over.
  const watchdog = setTimeout(() => {
    console.warn('[voice-clone] the recorder did not report stopping; using what it handed over');
    settle();
  }, VOICE_CLONE_STOP_TIMEOUT_MS);
  try {
    if (rec.state === 'inactive') settle();   // stopped already; stop() would fire nothing
    else rec.stop();
  } catch(e){
    console.error('[voice-clone] recorder would not stop:', e);
    settle();
  }
}

/* ---------- uploading a file ---------- */
function pickVoiceCloneFile(){
  if (voiceCloneBusy || voiceCloneChecking) return;
  const input = voiceClonePart('file');
  if (input){ input.value = ''; input.click(); }
}
function chooseVoiceCloneFile(input){
  const file = input && input.files && input.files[0];
  if (!file || voiceCloneBusy || voiceCloneChecking) return;
  sayVoiceClone('');
  console.log('[voice-clone] file chosen', { name: file.name, bytes: file.size, type: file.type });
  if (!file.size){
    sayVoiceClone('That file is empty — choose another one.', 'err');
    return;
  }
  if (file.size > VOICE_CLONE_MAX_UPLOAD_BYTES){
    sayVoiceClone('That file is too large to use on this device — choose a shorter clip (a few minutes at most).', 'err');
    return;
  }
  voiceCloneSource = 'upload';
  discardVoiceCloneTake();
  voiceCloneConsented = false;
  const attempt = ++voiceCloneAttempt;
  voiceCloneChecking = /^video\//.test(file.type) || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name || '')
    ? `Getting the audio from ${file.name || 'your video'}…`
    : `Checking ${file.name || 'your file'}…`;
  renderVoiceClone();
  acceptVoiceCloneMedia(file, { source: 'upload', fileName: file.name || 'Your file', attempt });
}
function removeVoiceCloneUpload(){
  if (voiceCloneBusy || voiceCloneChecking) return;
  voiceCloneAttempt++;
  discardVoiceCloneTake();
  voiceCloneConsented = false;
  sayVoiceClone('');
  renderVoiceClone();
  // Straight back to the picker: removing it is nearly always to choose another.
  setTimeout(pickVoiceCloneFile, 0);
}

/* Recording or file, the same road: decode, check, convert, then the review
   screen or a message. Always clears the "checking" state, whatever happens. */
async function acceptVoiceCloneMedia(media, { source, timedSeconds, fileName, attempt }){
  let result;
  try {
    result = await prepareVoiceSample(media, { source, timedSeconds });
  } catch(e){
    result = { ok: false, reason: (e && e.code) || 'sample_unreadable', detail: (e && e.message) || String(e) };
  } finally {
    if (attempt === voiceCloneAttempt) voiceCloneChecking = null;
  }
  if (attempt !== voiceCloneAttempt) return;   // cancelled or replaced meanwhile
  if (!result.ok && !result.blob){
    console.error('[voice-clone] sample rejected:', result.reason, result.detail || '');
    sayVoiceClone(voiceCloneErrorText(result.reason, source), 'err');
    renderVoiceClone();
    return;
  }
  discardVoiceCloneTake();
  voiceCloneTake = {
    ok: result.ok, blob: result.blob, url: URL.createObjectURL(result.blob),
    seconds: result.seconds, voicedSeconds: result.voicedSeconds, source, fileName,
  };
  voiceCloneConsented = false;
  console.log('[voice-clone] sample ready', { ok: result.ok, seconds: result.seconds, voicedSeconds: result.voicedSeconds, wavBytes: result.blob.size });
  if (!result.ok){
    console.error('[voice-clone] sample rejected:', result.reason, result.detail || '');
    sayVoiceClone(voiceCloneErrorText(result.reason, source), 'err');
  } else {
    sayVoiceClone('');
  }
  renderVoiceClone();
}

/* ---------- turning anything into a sample ----------
   Decoded here, in the browser: a recording from MediaRecorder (MP4/AAC on
   iPhone, WebM/Opus elsewhere) or any audio or video file this browser can
   play. Video is handled the same way — decoding a video file gives its sound
   track — so the video itself never leaves the device.

   Out comes { ok, blob (WAV), seconds, voicedSeconds } — ok:false with a blob
   for a take that is real but under a minute (so it can still be listened to),
   or { ok:false, reason } with no blob when there is nothing usable. */
async function prepareVoiceSample(media, { source, timedSeconds } = {}){
  if (!media || !media.size){
    return { ok: false, reason: 'sample_empty', detail: `${media ? media.size : 0} bytes` };
  }
  /* A file says how long it is before it is decoded, so a clip that is plainly
     too short or too long is turned away without reading it all into memory. */
  if (source === 'upload'){
    const meta = await probeVoiceCloneDuration(media);
    console.log('[voice-clone] file duration from metadata:', meta);
    if (meta && meta > VOICE_CLONE_MAX_UPLOAD_SECONDS){
      return { ok: false, reason: 'upload_too_long', detail: `${meta}s` };
    }
    if (meta && !voiceCloneLongEnough(meta)){
      return { ok: false, reason: 'sample_too_short', detail: `${meta}s from metadata` };
    }
  }
  let bytes;
  try { bytes = await voiceCloneWithin(VOICE_CLONE_DECODE_TIMEOUT_MS, media.arrayBuffer(), 'decode_timeout'); }
  catch(e){ return { ok: false, reason: e && e.code === 'decode_timeout' ? 'decode_timeout' : 'sample_unreadable', detail: String(e) }; }
  if (!bytes || bytes.byteLength < 1024){
    return { ok: false, reason: 'sample_empty', detail: `${bytes ? bytes.byteLength : 0} bytes` };
  }
  let decoded;
  try { decoded = await voiceCloneWithin(VOICE_CLONE_DECODE_TIMEOUT_MS, decodeVoiceCloneAudio(bytes), 'decode_timeout'); }
  catch(e){
    console.error('[voice-clone] could not decode', source, media.type || '(no type)', media.size, 'bytes:', e && (e.code || e.name), e && e.message);
    return { ok: false, reason: e && e.code === 'decode_timeout' ? 'decode_timeout' : (source === 'upload' ? 'upload_unreadable' : 'sample_unreadable'), detail: String(e) };
  }
  if (!decoded || !decoded.length || !decoded.duration){
    return { ok: false, reason: source === 'upload' ? 'upload_no_audio' : 'sample_empty', detail: 'decoded to nothing' };
  }
  const seconds = decoded.duration;
  console.log('[voice-clone] decoded', { seconds: +seconds.toFixed(2), rate: decoded.sampleRate, channels: decoded.numberOfChannels, timedSeconds });
  if (source === 'upload' && seconds > VOICE_CLONE_MAX_UPLOAD_SECONDS){
    return { ok: false, reason: 'upload_too_long', detail: `${seconds}s` };
  }
  const mono = await voiceCloneMono(decoded);
  const level = measureVoiceCloneLevel(mono, VOICE_CLONE_RATE);
  if (level.peak < 0.01 || level.voicedSeconds < 1){
    return { ok: false, reason: source === 'upload' ? 'upload_no_audio' : 'sample_silent', detail: JSON.stringify(level) };
  }
  /* Where the voice starts: a video that opens on ten seconds of nothing should
     not spend ten of the ninety seconds sent on it. Only trimmed when what is
     left is still over the minute, so the length the server measures is never
     less than the length shown here. */
  let start = Math.max(0, level.firstVoicedSample - Math.round(0.3 * VOICE_CLONE_RATE));
  if (!voiceCloneLongEnough((mono.length - start) / VOICE_CLONE_RATE)) start = 0;
  const end = Math.min(mono.length, start + VOICE_CLONE_SEND_SECONDS * VOICE_CLONE_RATE);
  const blob = encodeVoiceCloneWav(mono.subarray(start, end), VOICE_CLONE_RATE);
  const out = { blob, seconds, voicedSeconds: level.voicedSeconds };
  if (!voiceCloneLongEnough(seconds)) return { ...out, ok: false, reason: 'sample_too_short', detail: `${seconds.toFixed(1)}s` };
  if (level.voicedSeconds < VOICE_CLONE_MIN_VOICED) return { ok: false, reason: 'sample_silent', detail: JSON.stringify(level) };
  return { ...out, ok: true };
}
/* A file's length from its own header, via the media element. null when this
   device will not say (it still gets decoded and measured properly). */
function probeVoiceCloneDuration(file){
  return new Promise(resolve => {
    const isVideo = /^video\//.test(file.type) || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name || '');
    const el = document.createElement(isVideo ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = v => {
      if (done) return; done = true; clearTimeout(timer);
      try { el.removeAttribute('src'); el.load(); } catch(e){}
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 8000);
    el.muted = true;
    el.preload = 'metadata';
    el.setAttribute('playsinline', '');
    el.onloadedmetadata = () => finish(isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => finish(null);
    el.src = url;
    try { el.load(); } catch(e){ finish(null); }
  });
}
/* Decoded straight at the rate that is sent where the browser allows it, which
   also keeps a long file's decoded size down. */
function decodeVoiceCloneAudio(buffer){
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return Promise.reject(new Error('no OfflineAudioContext'));
  let ctx;
  try { ctx = new Ctx(1, VOICE_CLONE_RATE, VOICE_CLONE_RATE); }
  catch(e){ ctx = new Ctx(1, 44100, 44100); }
  return new Promise((resolve, reject) => {
    // The callback form too: older Safari never returns the promise.
    const p = ctx.decodeAudioData(buffer, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}
/* One channel at VOICE_CLONE_RATE: channels averaged, then resampled by the
   browser where it can (it filters properly), by hand where it cannot. */
async function voiceCloneMono(audio){
  const n = audio.numberOfChannels, len = audio.length;
  let mono = new Float32Array(len);
  for (let c = 0; c < n; c++){
    const d = audio.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / n;
  }
  if (audio.sampleRate === VOICE_CLONE_RATE) return mono;
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const outLen = Math.ceil(len * VOICE_CLONE_RATE / audio.sampleRate);
  try {
    const ctx = new Ctx(1, outLen, VOICE_CLONE_RATE);
    const src = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, len, audio.sampleRate);
    buf.getChannelData(0).set(mono);
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    const rendered = await voiceCloneWithin(VOICE_CLONE_DECODE_TIMEOUT_MS, new Promise((resolve, reject) => {
      const p = ctx.startRendering();
      ctx.oncomplete = e => resolve(e.renderedBuffer);
      if (p && p.then) p.then(resolve, reject);
    }), 'decode_timeout');
    return rendered.getChannelData(0);
  } catch(e){
    console.warn('[voice-clone] resampling by hand:', e && (e.message || e));
    const ratio = audio.sampleRate / VOICE_CLONE_RATE;
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++){
      // Average the source samples this one covers: a crude low-pass, enough for speech.
      const a = Math.floor(i * ratio), b = Math.min(len, Math.max(a + 1, Math.floor((i + 1) * ratio)));
      let s = 0; for (let j = a; j < b; j++) s += mono[j];
      out[i] = s / (b - a);
    }
    return out;
  }
}
/* The loudest moment, how many seconds are clearly above the room, and where
   the first of them is. /api/voice-clone measures the WAV the same way. */
function measureVoiceCloneLevel(data, rate){
  const frame = Math.max(1, Math.round(rate * 0.02));
  let peak = 0, voicedFrames = 0, firstVoicedSample = 0, seen = false;
  for (let i = 0; i < data.length; i += frame){
    let sum = 0;
    const end = Math.min(data.length, i + frame);
    for (let j = i; j < end; j++){ const v = data[j]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
    if (Math.sqrt(sum / (end - i)) > 0.01){
      voicedFrames++;
      if (!seen){ seen = true; firstVoicedSample = i; }
    }
  }
  return { peak: +peak.toFixed(4), voicedSeconds: +(voicedFrames * 0.02).toFixed(1), firstVoicedSample };
}
/* 16-bit PCM WAV, mono. */
function encodeVoiceCloneWav(samples, rate){
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2){
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function createVoiceClone(){
  if (!voiceCloneTake || voiceCloneBusy) return;
  if (!voiceCloneTake.ok){
    sayVoiceClone(VOICE_CLONE_SHORT_TEXT, 'err');
    return;
  }
  if (!voiceCloneConsented){
    sayVoiceClone('Tick the confirmation first — a voice is only ever made from your own.', 'err');
    return;
  }
  uploadVoiceClone(voiceCloneTake);
}

/* What the routes answer with, in our own words. Never the provider's — the
   actual reason is in the console and the server log. */
const VOICE_CLONE_MESSAGES = {
  upgrade_required:      null,   // filled in below, it quotes the price
  not_configured:        "Voice cloning isn't switched on yet.",
  consent_required:      'Tick the confirmation first — a voice is only ever made from your own.',
  sample_empty:          "That recording came out empty — tap Record Again and try once more.",
  sample_silent:         "We couldn't hear enough of your voice in that. Check your microphone isn't muted or in use by another app, speak close to it, and try again.",
  sample_unreadable:     "This device couldn't read that recording — tap Record Again, or choose Upload Audio or Video.",
  upload_unreadable:     "We couldn't read the audio in that file — try an MP3, M4A, WAV, MP4 or MOV.",
  upload_no_audio:       "That file doesn't seem to have any sound we can use — choose one with you speaking.",
  upload_too_long:       'That file is longer than 10 minutes — trim it to a few minutes of you speaking, or choose another.',
  decode_timeout:        'Getting the audio ready took too long on this device — try again, or use a shorter file.',
  unsupported_format:    "The recording couldn't be prepared in a format the voice service reads — try again.",
  sample_too_short:      VOICE_CLONE_SHORT_TEXT,
  sample_too_long:       'That sample was too large to send — try again with a shorter recording.',
  quota_exceeded:        "The voice service is out of cloning credits right now — your recording wasn't used, and nothing was charged.",
  rate_limited:          'The voice service is busy — try again in a minute.',
  rejected:              "The voice service couldn't use that recording — try again somewhere quieter.",
  invalid_voice:         "The voice service couldn't use that recording — try again somewhere quieter.",
  provider_auth:         "Voice cloning is unavailable right now (a sign-in problem on our side). Your recording is kept — try again later.",
  plan_not_allowed:      "Voice cloning isn't available on our voice service right now. Your recording is kept — try again later.",
  verification_required: "The voice service wants an extra verification step for this voice. Your recording is kept — contact support and we'll sort it out.",
  voice_limit_reached:   "The voice service has no room for another voice right now. Your recording is kept — contact support and we'll sort it out.",
  save_failed:           "Your voice was made but couldn't be saved to your account, so nothing was kept. Your recording is still here — press Create My Voice to try again.",
  provider_failed:       'The voice service had a problem creating your voice — press Create My Voice to try again.',
  timeout:               "Creating your voice took too long, so we stopped waiting. Your recording is kept — press Create My Voice to try again.",
  network:               "Couldn't reach the voice service — check your connection, then press Create My Voice to try again.",
  not_signed_in:         'Your sign-in has expired — sign in again, then press Create My Voice.',
};
function voiceCloneErrorText(code, source){
  if (code === 'upgrade_required') return `Cloning your voice comes with Ritual — ${tierPriceText('ritual')}.`;
  if (code === 'sample_silent' && source === 'upload') return VOICE_CLONE_MESSAGES.upload_no_audio;
  return VOICE_CLONE_MESSAGES[code] || "Couldn't create your voice — press Create My Voice to try again.";
}
/* A route that died before it could answer in JSON still has a status to go by. */
function voiceCloneCodeForStatus(status){
  if (status === 413) return 'sample_too_long';
  if (status === 401) return 'not_signed_in';
  if (status === 504 || status === 408) return 'timeout';
  return 'clone_failed';
}
/* The session token, without waiting forever: supabase-js can hold getSession()
   behind its own lock while it refreshes. */
async function voiceCloneToken(){
  const out = await voiceCloneWithin(VOICE_CLONE_AUTH_TIMEOUT_MS, sb.auth.getSession(), 'auth_timeout');
  return out && out.data && out.data.session && out.data.session.access_token;
}

/* The request itself. Always resolves: { ok:true } or { code }. */
async function sendVoiceCloneSample(take){
  let token;
  try { token = await voiceCloneToken(); }
  catch(e){ console.error('[voice-clone] no session token:', e && (e.code || e.message)); }
  if (!token) return { code: 'not_signed_in' };
  const headers = {
    'Content-Type': 'audio/wav',
    Authorization: `Bearer ${token}`,
    // The confirmation travels with the sample, and the route checks it against
    // its own copy of the sentence before spending anything.
    'X-Voice-Consent': await voiceConsentStatement(),
  };
  if (voiceCloneReplacing) headers['X-Voice-Replace'] = '1';
  console.log('[voice-clone] sending sample', { bytes: take.blob.size, seconds: +take.seconds.toFixed(1), replacing: voiceCloneReplacing });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), VOICE_CLONE_UPLOAD_TIMEOUT_MS);
  const started = Date.now();
  try {
    let res;
    try { res = await fetch(`${API_BASE}/api/voice-clone`, { method: 'POST', headers, body: take.blob, signal: abort.signal }); }
    catch(e){
      const code = e && e.name === 'AbortError' ? 'timeout' : 'network';
      console.error('[voice-clone] request failed:', code, e && e.message, `after ${Date.now() - started}ms`);
      return { code };
    }
    // Reading the body is covered by the same abort, so it cannot hang either.
    const text = await res.text().catch(e => { console.error('[voice-clone] response unreadable:', e); return ''; });
    let out = {};
    try { out = JSON.parse(text); } catch(e){}
    if (!res.ok){
      console.error('[voice-clone] /api/voice-clone answered', res.status, text.slice(0, 400));
      return { code: out.error || voiceCloneCodeForStatus(res.status) };
    }
    if (!out.created && !out.reused){
      console.error('[voice-clone] /api/voice-clone answered', res.status, 'without a voice:', text.slice(0, 400));
      return { code: 'clone_failed' };
    }
    console.log('[voice-clone] voice created', res.status, out, `in ${Date.now() - started}ms`);
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

/* One upload at a time: the flag is set before the first await and only cleared
   in finally, and the button is gone while it is set, so a second tap cannot
   start a second clone. */
async function uploadVoiceClone(take){
  if (voiceCloneBusy) return;
  if (!sb || !currentUser){ sayVoiceClone('Sign in first.', 'err'); return; }
  if (!take || !take.ok || !take.blob || take.blob.size < 1024){
    sayVoiceClone(voiceCloneErrorText(take && !take.ok ? 'sample_too_short' : 'sample_empty'), 'err');
    return;
  }
  voiceCloneBusy = true;
  sayVoiceClone('');
  renderVoiceClone();
  let outcome;
  try { outcome = await sendVoiceCloneSample(take); }
  catch(e){
    console.error('[voice-clone] clone failed unexpectedly:', e);
    outcome = { code: 'clone_failed' };
  } finally {
    voiceCloneBusy = false;
  }

  if (!outcome || !outcome.ok){
    /* The take is still there, so the person can press Create again — or
       listen and record again — without recording the minute again. The tick
       stays too: nothing about what they agreed to has changed. */
    renderVoiceClone();
    sayVoiceClone(voiceCloneErrorText(outcome && outcome.code), 'err');
    return;
  }
  voiceCloneReplacing = false;
  voiceCloneConsented = false;
  discardVoiceCloneTake();
  forgetVoiceCatalogue();          // the picker asks again, and finds the voice
  try { await loadVoiceCatalogue(); } catch(e){ console.error('[voice-clone] catalogue reload failed:', e); }
  if (voiceCloneHost.bodyId === 'builderVoiceCloneBody' && typeof onMyVoiceReady === 'function'){
    // Recorded from the builder: the panel closes and the voice they just made
    // is the voice selected, with Continue ready.
    try { await onMyVoiceReady(); }
    catch(e){ console.error('[voice-clone] could not select the new voice:', e); }
    return;
  }
  await renderVoiceClone();
  sayVoiceClone('Your voice is ready ✓', 'ok');
}

/* One line, generated in the voice just made, so it can be heard working. */
let voiceCloneTesting = false;
async function testClonedVoice(){
  if (voiceCloneTesting) return;
  const btn = voiceClonePart('test');
  const el = voiceClonePart('test-audio');
  if (typeof synthesizeLine !== 'function' || !el) return;
  voiceCloneTesting = true;
  if (btn) btn.disabled = true;
  sayVoiceClone('Generating a test affirmation in your voice…');
  try {
    const url = await voiceCloneWithin(45000, synthesizeLine('I am safe, and I am becoming who I said I would be.', MY_CLONED_VOICE), 'timeout');
    el.src = url;
    voiceCloneAudioSession('playback');
    el.onended = () => voiceCloneAudioSession(null);
    await el.play().catch(() => {});
    sayVoiceClone('Your voice is ready ✓', 'ok');
  } catch(e){
    console.error('[voice-clone] test affirmation failed:', e && (e.code || e.message));
    sayVoiceClone(typeof clonedVoiceErrorText === 'function' ? clonedVoiceErrorText(e && (e.code || e.message)) : "Couldn't generate a test just now.", 'err');
  } finally {
    voiceCloneTesting = false;
    if (btn) btn.disabled = false;
  }
}
async function removeClonedVoice(){
  const msg = voiceCloneMsgEl();
  if (msg){ msg.textContent = 'Removing…'; msg.className = 'save-msg'; }
  try {
    const token = await voiceCloneToken();
    const res = await fetch(`${API_BASE}/api/voice-clone`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('remove failed');
    voiceCloneReplacing = false;
    forgetVoiceCatalogue();
    await loadVoiceCatalogue();
    /* A subliminal set to "My voice" keeps asking for it: it is sent back to the
       voice setup when it is next generated, never read by the device instead. */
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


