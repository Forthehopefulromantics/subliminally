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
function readMixSettings(){
  const mix = {};
  Object.entries(MIX_DEFAULTS).forEach(([id,fallback]) => {
    const el = document.getElementById(id);
    const value = el ? Number(el.value) : fallback;
    mix[id] = Number.isFinite(value) ? Math.max(0,Math.min(100,value)) : fallback;
  });
  // The ambience layered under the main one (a meditation sound under a nature
  // sound, or the other way round) travels with the mix, like the levels do.
  if (typeof state !== 'undefined' && state && state.bgLayer && state.bgLayer !== 'none') mix.bgLayer = state.bgLayer;
  // So does the soothing pad, which had nowhere to be saved before.
  if (typeof state !== 'undefined' && state && SOOTHING_VARIANTS.includes(state.soothingLayer)) mix.soothingLayer = state.soothingLayer;
  return mix;
}
function mixMessage(text){
  document.querySelectorAll('[data-mix-status]').forEach(el => { el.textContent = text; });
}
function restoreMixSettings(id, settings){
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
}
function queueMixSave(){
  if(restoringMix) return;
  syncListeningMix();
  if(mixAutosavePaused){ if(typeof paintAudioEditor==='function') paintAudioEditor(); return; }
  if(!activeMixId){ mixMessage('Sound levels will be included when you save this subliminal.'); return; }
  pendingMixSave = {id:activeMixId,userId:currentUser && currentUser.id,mix:readMixSettings(),revision:++mixRevision};
  mixMessage('Saving sound levels…');
  clearTimeout(mixSaveTimer);
  mixSaveTimer=setTimeout(flushMixSave,300);
}
function saveMixAdjustments(){
  if(!activeMixId || !sb || !currentUser){
    mixMessage('Save this subliminal to your library first.');
    return Promise.resolve(false);
  }
  pendingMixSave={id:activeMixId,userId:currentUser.id,mix:readMixSettings(),revision:++mixRevision};
  return flushMixSave();
}
function flushMixSave(){
  clearTimeout(mixSaveTimer);
  if(!pendingMixSave)return mixWriteQueue;
  const {id,userId,mix,revision}=pendingMixSave;
  pendingMixSave=null;
  mixMessage('Saving sound levels…');
  const write = async () => {
    try {
      const {data,error} = await sb.from('subliminals').update({mix_settings:mix})
        .eq('id',id).eq('user_id',userId).select('id').single();
      if(error || !data) throw error || new Error('No saved subliminal was updated.');
      ['todaySubs','todaySubCovers','myLibrary'].forEach(forgetFetch);
      if(activeMixId===id && mixRevision===revision) mixMessage('Sound levels saved');
      return true;
    } catch(error){
      if(activeMixId===id && mixRevision===revision) mixMessage('Sound levels could not be saved. Please try Save adjustments again.');
      console.error('Saving sound levels failed:',error);
      return false;
    }
  };
  mixWriteQueue = mixWriteQueue.then(write,write);
  return mixWriteQueue;
}
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
