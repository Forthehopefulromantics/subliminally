/* Per-subliminal mixer state. Saving never regenerates voice audio. */
const MIX_DEFAULTS = {mixTone:30,mixBg:50,mixVoice:65,mixSoothing:45,mixCustom:50,mixLayerVoice:35};
let activeMixId = null, restoringMix = false, mixSaveTimer = null;
let mixWriteQueue = Promise.resolve(), mixRevision = 0;
let activeCoverPath = null;
let pendingMixSave = null;
/* True while the Adjust Sounds sheet is open: what is on it is a preview until
   Save Changes writes every layer at once (js/audio-editor.js). */
let mixAutosavePaused = false;
const SOOTHING_VARIANTS = ['pad','chimes','hum'];
/* The cover the player is wearing. A built-in ships with the app and needs no
   round trip; an upload needs a signed link, which expires, so it is fetched
   each time the player opens. The placeholder is what you press when there is
   no cover yet, so choosing one is never a hidden feature. */
function showListeningCover(cover){
  const img=document.getElementById('listeningCover'),empty=document.getElementById('listeningCoverEmpty');
  if(img){
    if(cover){
      /* Same file the picker and the cards use. The player cover is small, so the
         browser takes the 512px copy; it only reaches for the 1254px one on a
         larger or denser display. If it will not load, the placeholder shows and
         the saved choice is left alone. */
      img.onerror=()=>{ img.hidden=true; if(empty)empty.hidden=false; };
      if(cover.srcset) applyCoverToImg(img,cover,'58px');
      else { img.removeAttribute('srcset'); img.removeAttribute('width'); img.removeAttribute('height'); img.src=cover.src; }
      img.hidden=false;
    } else { img.onerror=null; img.removeAttribute('srcset'); img.removeAttribute('src'); img.hidden=true; }
  }
  if(empty)empty.hidden=!!cover;
  if(typeof finalPlaying!=='undefined'&&finalPlaying&&typeof refreshMediaSessionMetadata==='function')refreshMediaSessionMetadata();
}
async function refreshListeningCover(){
  const path=activeCoverPath,id=activeMixId;
  if(!document.getElementById('listeningCover'))return;
  showListeningCover(null);
  if(!path)return;
  let cover=builtinCover(path);
  if(!cover && sb){
    const {data,error}=await sb.storage.from('covers').createSignedUrl(path,3600);
    if(error || !data)return;
    cover={src:data.signedUrl,srcset:''};
  }
  if(id!==activeMixId || path!==activeCoverPath)return;
  if(cover)showListeningCover(cover);
}
/* ---------------- what a saved subliminal remembers ----------------
   Every adjustment a person can make to how a subliminal SOUNDS, in one object
   saved on its row (mix_settings), so reopening it — on this phone or any
   other — restores all of it and nothing is renegotiated with defaults:

     the six faders                 mixTone mixBg mixVoice mixSoothing mixCustom mixLayerVoice
     what is playing under the voice  bg, bgLayer (nature + meditation), soothingLayer
     the tone                       freqHz, binauralBand
     the voice's pace               pace (key), gapMs  -- speed is derived from pace
     how it plays                   loopMode, durationMinutes

   Absent keys mean "not saved yet", never "reset to default": older rows are
   read with the defaults filled in, and a write only ever sends the keys that
   changed (see flushMixSave), so moving one fader cannot reset another. */
const MIX_SCHEMA_VERSION = 2;
const MIX_CACHE_PREFIX = 'subliminally.mix.v1.';
const mixBaseline = {};      // id -> the mix last known to be on the server
const mixServerRev = {};     // id -> the audio_rev that mix came with
let mixRetryTimer = null, mixRetryCount = 0;
const MIX_RETRY_MS = [2000, 5000, 15000, 45000, 120000];

function mixClone(v){ return JSON.parse(JSON.stringify(v)); }
function mixCacheKey(userId, id){ return MIX_CACHE_PREFIX + userId + '.' + id; }
/* The device keeps a copy of every adjustment the moment it is made, marked
   unsaved until the server confirms. If the network, the tab or the phone goes
   first, the copy is still here and is re-sent on the next open. */
function mixCacheWrite(userId, id, mix, dirty){
  if (!userId || !id) return;
  try { localStorage.setItem(mixCacheKey(userId, id), JSON.stringify({ mix, dirty: !!dirty, at: Date.now() })); } catch(e){}
}
function mixCacheRead(userId, id){
  if (!userId || !id) return null;
  try { return JSON.parse(localStorage.getItem(mixCacheKey(userId, id)) || 'null'); } catch(e){ return null; }
}
function readMixSettings(){
  const mix = { v: MIX_SCHEMA_VERSION };
  Object.entries(MIX_DEFAULTS).forEach(([id,fallback]) => {
    const el = document.getElementById(id);
    const value = el ? Number(el.value) : fallback;
    mix[id] = Number.isFinite(value) ? Math.max(0,Math.min(100,value)) : fallback;
  });
  if (typeof state !== 'undefined' && state){
    /* Always written, including 'none': with merge-style saves an omitted key
       would leave the old value on the server, so taking a layer off has to say so. */
    mix.bg = state.bg || 'none';
    mix.bgLayer = state.bgLayer && state.bgLayer !== 'none' ? state.bgLayer : 'none';
    mix.soothingLayer = SOOTHING_VARIANTS.includes(state.soothingLayer) ? state.soothingLayer : 'none';
    mix.freqHz = state.freq ? state.freq.hz : null;
    mix.binauralBand = state.binauralBand || null;
    if (state.targetLengthMinutes) mix.durationMinutes = state.targetLengthMinutes;
  }
  if (typeof affirmationPace !== 'undefined'){
    mix.pace = affirmationPace;
    mix.gapMs = affirmationGapMs;
  }
  if (typeof getPlayerLoopMode === 'function') mix.loopMode = getPlayerLoopMode();
  return mix;
}
function mixMessage(text){
  document.querySelectorAll('[data-mix-status]').forEach(el => { el.textContent = text; });
}
/* The saved mix to open a row with: the server's, with any adjustment this
   device made but never got confirmed laid over it. */
function resolveSavedMix(id, row){
  const server = (row && row.mix_settings && typeof row.mix_settings === 'object') ? row.mix_settings : {};
  mixBaseline[id] = mixClone(server);
  mixServerRev[id] = (row && Number.isFinite(row.audio_rev)) ? row.audio_rev : 0;
  const cached = currentUser ? mixCacheRead(currentUser.id, id) : null;
  const serverAt = row && row.audio_updated_at ? Date.parse(row.audio_updated_at) : 0;
  if (cached && cached.dirty && cached.mix && cached.at > serverAt){
    return { mix: { ...server, ...cached.mix }, unsynced: true };
  }
  return { mix: server, unsynced: false };
}
/* Pace is part of what the voice SOUNDS like (speed is sent to the voice
   provider), so it is restored before anything is generated or fetched. */
function applyPaceSettings(mix){
  if (typeof AFFIRMATION_PACES === 'undefined') return;
  const p = AFFIRMATION_PACES.find(x => x.key === (mix && mix.pace)) || AFFIRMATION_PACES.find(x => x.key === DEFAULT_PACE);
  affirmationPace = p.key;
  state.pace = p.key;
  const gapMs = mix && Number.isFinite(mix.gapMs) ? mix.gapMs : Math.round(p.gap * 1000);
  setAffirmationGap(Math.max(100, Math.min(10000, gapMs)) / 1000);
  if (typeof renderPaceChips === 'function') renderPaceChips();
}
function restoreMixSettings(id, settings, opts){
  flushMixSave();
  activeMixId = id || null;
  if(!id){ activeCoverPath=null; refreshListeningCover(); }
  mixRevision++;
  restoringMix = true;
  Object.entries(MIX_DEFAULTS).forEach(([key,fallback]) => {
    const raw = settings && settings[key];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0,Math.min(100,raw)) : fallback;
    const slider = document.getElementById(key), number = document.getElementById(key+'Val');
    if(slider) slider.value = value;
    if(number) number.value = value;
    applyLiveMixGain(key,value);
  });
  restoringMix = false;
  syncListeningMix();
  mixMessage(id ? 'Your saved sound levels' : 'Sound levels will be included when you save this subliminal.');
  // Adjustments this device made but never confirmed: send them now.
  if (id && opts && opts.unsynced){
    pendingMixSave = {id,userId:currentUser && currentUser.id,mix:settings,revision:++mixRevision};
    mixMessage('Saving sound levels…');
    mixSaveTimer = setTimeout(flushMixSave, 300);
  }
}
function queueMixSave(){
  if(restoringMix) return;
  syncListeningMix();
  if(mixAutosavePaused){ if(typeof paintAudioEditor==='function') paintAudioEditor(); return; }
  if(!activeMixId){ mixMessage('Sound levels will be included when you save this subliminal.'); return; }
  const mix = readMixSettings();
  pendingMixSave = {id:activeMixId,userId:currentUser && currentUser.id,mix,revision:++mixRevision};
  mixCacheWrite(pendingMixSave.userId, activeMixId, mix, true);   // on this device before anything else
  mixMessage('Saving sound levels…');
  clearTimeout(mixSaveTimer);
  mixSaveTimer=setTimeout(flushMixSave,300);
}
function saveMixAdjustments(){
  if(!activeMixId || !sb || !currentUser){
    mixMessage('Save this subliminal to your library first.');
    return Promise.resolve(false);
  }
  const mix = readMixSettings();
  pendingMixSave={id:activeMixId,userId:currentUser.id,mix,revision:++mixRevision};
  mixCacheWrite(currentUser.id, activeMixId, mix, true);
  return flushMixSave();
}
function mixDiff(base, next){
  const out = {};
  Object.keys(next).forEach(k => { if (JSON.stringify(base ? base[k] : undefined) !== JSON.stringify(next[k])) out[k] = next[k]; });
  return out;
}
function scheduleMixRetry(){
  if (mixRetryCount >= MIX_RETRY_MS.length) return;
  clearTimeout(mixRetryTimer);
  mixRetryTimer = setTimeout(() => {
    mixRetryCount++;
    const cached = activeMixId && currentUser ? mixCacheRead(currentUser.id, activeMixId) : null;
    if (cached && cached.dirty && !pendingMixSave){
      pendingMixSave = {id:activeMixId,userId:currentUser.id,mix:cached.mix,revision:++mixRevision};
      flushMixSave();
    }
  }, MIX_RETRY_MS[mixRetryCount]);
}
function flushMixSave(){
  clearTimeout(mixSaveTimer);
  if(!pendingMixSave)return mixWriteQueue;
  const {id,userId,mix,revision}=pendingMixSave;
  pendingMixSave=null;
  mixMessage('Saving sound levels…');
  const write = async () => {
    try {
      if(!sb || !userId) throw new Error('not signed in');
      /* Only what changed is sent, and the database merges it into what is
         there, so a late write from an old screen cannot put back a value some
         other adjustment has since replaced. Where the merge function is not
         installed yet, the full object goes through an ordinary update. */
      const patch = mixDiff(mixBaseline[id], mix);
      let merged = null, rev = null, usedRpc = false;
      if (Object.keys(patch).length || !mixBaseline[id]){
        try {
          const rpc = await sb.rpc('patch_subliminal_audio', { p_id: id, p_patch: patch, p_base_rev: mixServerRev[id] == null ? null : mixServerRev[id] });
          const row = rpc && !rpc.error && Array.isArray(rpc.data) ? rpc.data[0] : (rpc && !rpc.error ? rpc.data : null);
          if (row && row.mix_settings){ merged = row.mix_settings; rev = row.audio_rev; usedRpc = true; }
        } catch(e){ /* fall through to the plain update */ }
        if (!usedRpc){
          const full = { ...(mixBaseline[id] || {}), ...mix };
          const {data,error} = await sb.from('subliminals').update({mix_settings:full})
            .eq('id',id).eq('user_id',userId).select('id').single();
          if(error || !data) throw error || new Error('No saved subliminal was updated.');
          merged = full;
        }
      } else { merged = mixBaseline[id]; }
      mixBaseline[id] = mixClone(merged);
      if (rev != null) mixServerRev[id] = rev;
      // Confirmed. The device copy is only marked clean if nothing newer was typed meanwhile.
      if (mixRevision === revision) mixCacheWrite(userId, id, mix, false);
      mixRetryCount = 0; clearTimeout(mixRetryTimer);
      ['todaySubs','todaySubCovers','myLibrary'].forEach(forgetFetch);
      if(activeMixId===id && mixRevision===revision) mixMessage('Sound levels saved');
      return true;
    } catch(error){
      console.error('Saving sound levels failed:',error);
      if(activeMixId===id){
        mixMessage('Couldn\'t save just now — your changes are kept on this device and will be sent again automatically.');
        scheduleMixRetry();
      }
      return false;
    }
  };
  mixWriteQueue = mixWriteQueue.then(write,write);
  return mixWriteQueue;
}
window.addEventListener('online', () => { mixRetryCount = 0; scheduleMixRetry(); });
function listeningMixMarkup(){
  const names = {mixTone:'Frequency',mixBg:'Nature sounds',mixVoice:'Affirmations',mixSoothing:'Soothing layer',mixCustom:'Your track',mixLayerVoice:'Second voice'};
  return Object.keys(MIX_DEFAULTS).map(id => `<label class="listening-mix-row"><span>${names[id]}</span><input type="range" min="0" max="100" data-listening-mix="${id}" aria-label="${names[id]} volume" oninput="setListeningMix('${id}',this.value)"><output data-listening-value="${id}"></output></label>`).join('');
}
function setListeningMix(id,value){
  if(!Object.hasOwn(MIX_DEFAULTS,id)) return;
  const n = Math.max(0,Math.min(100,Number(value)||0));
  document.getElementById(id).value=n;
  document.getElementById(id+'Val').value=n;
  applyLiveMixGain(id,n);
}
function syncListeningMix(){
  document.querySelectorAll('[data-listening-mix]').forEach(el=>{
    const id=el.dataset.listeningMix,src=document.getElementById(id);
    if(!src)return;
    if(document.activeElement!==el)el.value=src.value;
    const row=el.closest('label');
    const original=src.closest('.mix-row');
    if(row && original)row.hidden=original.style.display==='none';
    document.querySelectorAll('[data-listening-value="'+id+'"]').forEach(out=>{out.textContent=src.value+'%';});
  });
}
function restartListening(){ stopFinal(); playFinal(); renderNowBar(); }
function chooseListeningCover(){
  /* Before the first save there is no row to write to; the choice waits in
     activeCoverPath and the save stores it with the new subliminal. */
  pickCoverFor(activeMixId || null);
}
/* A refresh, a close, or a swipe away must not lose the fader you just moved:
   both events flush the pending write, and flushMixSave is a no-op when there
   is nothing pending, so firing twice costs nothing. */
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushMixSave();});
window.addEventListener('pagehide',()=>flushMixSave());
