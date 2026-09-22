/* Immersive player UI. Audio remains in builder.js: one engine, two independent layers. */
const PLAYER_PREFS_KEY = 'subliminally_player_preferences_v1';
const PLAYER_CATEGORIES = ['All','Frequency','Nature','Ambient','Sleep','Focus','Meditation','Favorites'];
const PLAYER_AMBIENCE = [
  ...[174,285,396,417,432,528,639,741,852].map(hz => ({ key:`freq-${hz}`, name:`${hz} Hz`, category:'Frequency', kind:'frequency', hz })),
  { key:'none', name:'No ambience', category:'Ambient', kind:'ambience' },
  { key:'rain', name:'Rain', category:'Nature', kind:'ambience' },
  { key:'ocean', name:'Ocean', category:'Nature', kind:'ambience' },
  { key:'thunder', name:'Thunderstorm', category:'Nature', kind:'ambience' },
  { key:'forest', name:'Forest', category:'Nature', kind:'ambience' },
  { key:'fireplace', name:'Fireplace', category:'Nature', kind:'ambience' },
  { key:'night', name:'Night sounds', category:'Nature', kind:'ambience' },
  { key:'celestial', name:'Celestial', category:'Ambient', kind:'ambience' },
  { key:'dreamscape', name:'Dreamscape', category:'Ambient', kind:'ambience' },
  { key:'sanctuary', name:'Sanctuary', category:'Ambient', kind:'ambience' },
  { key:'deep-space', name:'Deep Space', category:'Ambient', kind:'ambience' },
  { key:'soft-piano', name:'Soft Piano', category:'Ambient', kind:'ambience' },
  { key:'brown', name:'Brown Noise', category:'Sleep', kind:'ambience' },
  { key:'pink-noise', name:'Pink Noise', category:'Sleep', kind:'ambience' },
  { key:'white-noise', name:'White Noise', category:'Sleep', kind:'ambience' },
  { key:'deep-sleep', name:'Deep Sleep', category:'Sleep', kind:'ambience' },
  { key:'focus-flow', name:'Focus Flow', category:'Focus', kind:'ambience' },
  { key:'still-mind', name:'Still Mind', category:'Meditation', kind:'ambience' },
];
const SYNTH_AMBIENCE_KEYS = new Set(['none','rain','ocean','thunder','forest','birds','waterfall','brown']);
let playerPrefs = { ambience:'rain', frequency:528, favorites:[], balance:58, loopMode:'entire', duration:20, favoriteSubliminals:[] };
let playerCategory = 'All', playerPendingTrack = null, playerPreview = null, playerPreviewCtx = null;
let playerAffirmationText = '', playerUiTimer = null, playerSaveTimer = null, playerSessionSaved = false;

function loadPlayerPrefs(){
  try { playerPrefs = { ...playerPrefs, ...JSON.parse(localStorage.getItem(PLAYER_PREFS_KEY) || '{}') }; } catch(e){}
  if (!Array.isArray(playerPrefs.favorites)) playerPrefs.favorites = [];
  if (!Array.isArray(playerPrefs.favoriteSubliminals)) playerPrefs.favoriteSubliminals = [];
}
function persistPlayerPrefs(){
  try { localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify(playerPrefs)); } catch(e){}
  clearTimeout(playerSaveTimer);
  playerSaveTimer = setTimeout(async () => {
    if (!sb || !currentUser) return;
    try { await sb.from('profiles').update({ player_preferences:playerPrefs }).eq('id',currentUser.id); } catch(e){}
  }, 500);
}
async function hydratePlayerPrefs(){
  loadPlayerPrefs();
  if (sb && currentUser){
    try {
      const { data } = await sb.from('profiles').select('player_preferences').eq('id',currentUser.id).maybeSingle();
      if (data && data.player_preferences) playerPrefs = { ...playerPrefs, ...data.player_preferences };
    } catch(e){}
  }
  applyPlayerPrefs();
}
function getPlayerLoopMode(){ return playerPrefs.loopMode || 'entire'; }
function playerElapsedSeconds(){ return typeof getFinalElapsedMs === 'function' ? Math.floor(getFinalElapsedMs()/1000) : 0; }
function currentPlayerTitle(){
  const input = document.getElementById('finalTitleInput');
  return (state && state.playerTitle) || (input && input.value.trim()) || (state && state.freq ? `${state.freq.hz} Hz · ${state.freq.word}` : 'Your Subliminal');
}
function currentAmbienceLabel(){
  const bg = PLAYER_AMBIENCE.find(x => x.key === playerPrefs.ambience);
  const freq = state && state.freq ? `${state.freq.hz} Hz` : '';
  return [freq, bg && bg.key !== 'none' && bg.name].filter(Boolean).join(' + ') || 'No ambience';
}
function trackIsAvailable(track){
  if (track.kind === 'frequency') return true;
  return SYNTH_AMBIENCE_KEYS.has(track.key) || !!(window.AMBIENCE_URLS && window.AMBIENCE_URLS[track.key]);
}
function svgIcon(name){
  const icons = {
    close:'<path d="M6 6l12 12M18 6L6 18"/>', heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5a5.5 5.5 0 0 0 1.1-8.9z"/>',
    back:'<path d="M15 18l-6-6 6-6"/><path d="M5 5v14"/>', next:'<path d="M9 18l6-6-6-6"/><path d="M19 5v14"/>',
    loop:'<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', share:'<circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 11l8-5M8 13l8 5"/>',
    play:'<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>', pause:'<path d="M8 5v14M16 5v14"/>', sound:'<path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M17 9c1.4 1.6 1.4 4.4 0 6"/>',
    // Start over is a circle turned back on itself, not a skip-to-previous arrow:
    // it restarts the session rather than stepping to another affirmation.
    restart:'<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4h4"/>',
    // The cover affordance: a framed picture with a small star, the same
    // celestial mark the ambience artwork uses.
    image:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 16l5-4 4 3 3-2 6 4"/><circle cx="9" cy="9" r="1.3"/>',
    star:'<path d="M12 3l1.9 5.4L19 10l-5.1 1.6L12 17l-1.9-5.4L5 10l5.1-1.6z"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||''}</svg>`;
}
function mountImmersivePlayer(){
  if (document.getElementById('immersivePlayer')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <section class="immersive-player" id="immersivePlayer" aria-hidden="true" aria-label="Subliminal player">
      <div class="ip-sky"><div class="ip-stars"></div><div class="ip-moon"></div><div class="ip-cloud one"></div><div class="ip-cloud two"></div></div>
      <div class="ip-shell">
        <div class="ip-top"><button class="ip-icon-btn" onclick="closeImmersivePlayer()" aria-label="Minimize player">${svgIcon('close')}</button><span class="ip-kicker">Sanctuary at night</span><button class="ip-icon-btn" onclick="openPlayerMenu()" aria-label="More options">•••</button></div>
        <div class="ip-hero" id="ipAffirmationViewport" aria-live="polite" aria-atomic="true"><div class="ip-affirmation-stream" id="ipAffirmationStream"></div></div>
        <div class="ip-lower">
          <div class="ip-track-copy">
            <button class="ip-cover" id="listeningCoverBtn" onclick="chooseListeningCover()" aria-label="Choose a cover photo" title="Choose a cover photo">
              <img id="listeningCover" alt="" hidden>
              <span class="ip-cover-empty" id="listeningCoverEmpty">${svgIcon('image')}</span>
              <span class="ip-cover-edit" aria-hidden="true">${svgIcon('star')}</span>
            </button>
            <span class="ip-track-text"><small>Your Subliminal</small><h2 id="ipTitle">Your Subliminal</h2></span>
          </div>
          <button class="ip-ambience-card" onclick="openAmbienceLibrary()"><span class="ip-ambience-mark">${svgIcon('sound')}</span><span class="ip-ambience-copy"><small>Ambience</small><b id="ipAmbience">528 Hz + Rain</b></span><span class="ip-change">Change ›</span></button>
          <details class="listening-mix"><summary>Sound adjustments</summary>${listeningMixMarkup()}<button class="ps-use" onclick="saveMixAdjustments()">Save adjustments</button><p data-mix-status role="status"></p></details>
          <div><div class="ip-progress-track"><div class="ip-progress-fill" id="ipProgress"></div></div><div class="ip-times"><span id="ipElapsed">0:00</span><span id="ipRemaining">−20:00</span></div></div>
          <div class="ip-controls">
            <button class="ip-main-play" id="ipPlay" onclick="toggleImmersivePlayback()" aria-label="Pause">${svgIcon('pause')}</button>
            <button class="ip-control" onclick="restartListening()">${svgIcon('restart')}<span>Start over</span></button>
          </div>
        </div>
      </div>
    </section>
    <div class="player-sheet" id="ambienceSheet" role="dialog" aria-modal="true" aria-label="Choose your ambience"><div class="ps-panel" style="position:relative">
      <div class="ps-head"><h3>Choose your ambience</h3><button class="ps-close" onclick="closePlayerSheets()" aria-label="Close">✕</button></div>
      <div class="ps-categories" id="ambienceCategories"></div><div class="ps-list" id="ambienceList"></div>
      <div class="ps-confirm"><div class="ps-selected"><small>Selected</small><b id="ambiencePending">Rain</b></div><button class="ps-use" onclick="usePendingAmbience()">Use this ambience</button></div>
    </div></div>
    <div class="player-sheet" id="playerMenuSheet" role="dialog" aria-modal="true" aria-label="Player options"><div class="ps-panel"><div class="ps-head"><h3>Player options</h3><button class="ps-close" onclick="closePlayerSheets()" aria-label="Close">✕</button></div><div class="ps-simple"><button class="ps-option" onclick="closePlayerSheets();openLoopSheet()"><span>Loop mode</span><span>›</span></button><button class="ps-option" onclick="closePlayerSheets();openTimerSheet()"><span>Session timer</span><span>›</span></button></div></div></div>
    <div class="player-sheet" id="loopSheet" role="dialog" aria-modal="true" aria-label="Loop mode"><div class="ps-panel"><div class="ps-head"><h3>Loop mode</h3><button class="ps-close" onclick="closePlayerSheets()">✕</button></div><div class="ps-simple" id="loopOptions"></div></div></div>
    <div class="player-sheet" id="timerSheet" role="dialog" aria-modal="true" aria-label="Session timer"><div class="ps-panel"><div class="ps-head"><h3>Session timer</h3><button class="ps-close" onclick="closePlayerSheets()">✕</button></div><div class="ps-simple" id="timerOptions"></div></div></div>
  `);
  document.querySelectorAll('.player-sheet').forEach(sheet => sheet.addEventListener('click', e => { if (e.target === sheet) closePlayerSheets(); }));
  const source = document.getElementById('finalLine');
  if (source) new MutationObserver(() => showImmersiveAffirmation(source.textContent)).observe(source,{childList:true,subtree:true,characterData:true});
  hydratePlayerPrefs();
}
function applyPlayerPrefs(){
  // Per-subliminal levels, ambience and duration are authoritative. The global
  // Voice/Ambience balance is gone: it moved two of the six faders behind one
  // slider and overwrote a loaded mix. Preferences must never touch the levels.
  renderPlayerSelectionState();
}
function openImmersivePlayer(){
  mountImmersivePlayer(); playerSessionSaved = false;
  if (state && state.bg) playerPrefs.ambience = state.bg;
  if (state && state.freq) playerPrefs.frequency = state.freq.hz;
  if (state && state.targetLengthMinutes) playerPrefs.duration = state.targetLengthMinutes;
  const el = document.getElementById('immersivePlayer'); el.classList.add('open'); el.setAttribute('aria-hidden','false');
  document.body.classList.add('player-open');
  document.getElementById('ipTitle').textContent = currentPlayerTitle();
  showImmersiveAffirmation((document.getElementById('finalLine')||{}).textContent || (state.affirmations||[])[0] || 'Breathe in. Your session is beginning.');
  refreshListeningCover(); syncListeningMix(); renderPlayerSelectionState(); updateImmersivePlayer();
  clearInterval(playerUiTimer); playerUiTimer = setInterval(updateImmersivePlayer,500);
}
function closeImmersivePlayer(){
  const el=document.getElementById('immersivePlayer'); if(el){el.classList.remove('open');el.setAttribute('aria-hidden','true');}
  document.body.classList.remove('player-open'); closePlayerSheets(); stopAmbiencePreview(); clearInterval(playerUiTimer); playerUiTimer=null;
}
function showImmersiveAffirmation(text){
  const stream=document.getElementById('ipAffirmationStream'); if(!stream) return;
  text=String(text||'').replace(/^['“"]|['”"]$/g,'').trim();
  if(!text||(text===playerAffirmationText&&stream.querySelector('.ip-affirmation.current')))return;
  playerAffirmationText=text;

  const departing=stream.querySelector('.ip-affirmation.departing');
  if(departing){ departing.classList.replace('departing','leaving'); setTimeout(()=>departing.remove(),950); }
  const current=stream.querySelector('.ip-affirmation.current');
  if(current){ current.classList.replace('current','departing'); current.setAttribute('aria-hidden','true'); }

  const next=document.createElement('div');
  next.className='ip-affirmation entering'; next.textContent=text;
  stream.appendChild(next);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ next.classList.remove('entering'); next.classList.add('current'); }));
  setTimeout(()=>{
    stream.querySelectorAll('.ip-affirmation.leaving').forEach(el=>el.remove());
    [...stream.querySelectorAll('.ip-affirmation')].slice(0,-2).forEach(el=>el.remove());
  },1000);
}
function fmtPlayerTime(sec){ sec=Math.max(0,Math.round(sec)); const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60; return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`; }
function updateImmersivePlayer(){
  if(!document.getElementById('immersivePlayer'))return;
  const elapsed=playerElapsedSeconds(), total=Math.max(60,(state.targetLengthMinutes||playerPrefs.duration||20)*60), rem=Math.max(0,total-elapsed);
  document.getElementById('ipElapsed').textContent=fmtPlayerTime(elapsed); document.getElementById('ipRemaining').textContent='−'+fmtPlayerTime(rem);
  document.getElementById('ipProgress').style.width=Math.min(100,elapsed/total*100)+'%';
  const play=document.getElementById('ipPlay'); if(play){play.innerHTML=svgIcon(finalPlaying&&!finalPaused?'pause':'play');play.setAttribute('aria-label',finalPlaying&&!finalPaused?'Pause':'Play');}
  if ('mediaSession' in navigator && state && state.affirmations){ try { navigator.mediaSession.setPositionState({duration:total,playbackRate:1,position:Math.min(total,elapsed)}); } catch(e){} }
}
function renderPlayerSelectionState(){
  const amb=document.getElementById('ipAmbience'); if(amb)amb.textContent=currentAmbienceLabel();
}
function currentPlayerKey(){ return editingExistingId || currentPlayerTitle(); }
function toggleImmersivePlayback(){ if(!finalPlaying){playFinal();return;} finalPaused?resumeFinal():pauseFinal(); updateImmersivePlayer(); renderNowBar(); }

function renderAmbienceLibrary(){
  const cats=document.getElementById('ambienceCategories'); if(!cats)return;
  cats.innerHTML=PLAYER_CATEGORIES.map(c=>`<button class="ps-chip${c===playerCategory?' sel':''}" aria-pressed="${c===playerCategory}" onclick="setAmbienceCategory('${c}')">${c}</button>`).join('');
  const favorites=new Set(playerPrefs.favorites), selectedKey=(playerPendingTrack&&playerPendingTrack.key)||playerPrefs.ambience;
  let tracks=PLAYER_AMBIENCE.filter(t=>playerCategory==='All'||t.category===playerCategory||(playerCategory==='Favorites'&&favorites.has(t.key)));
  document.getElementById('ambienceList').innerHTML=tracks.map(t=>{const available=trackIsAvailable(t),previewing=playerPreview&&playerPreview.key===t.key,isSelected=selectedKey===t.key||(`${t.key}`===`freq-${playerPrefs.frequency}`);return `<div class="ps-track${isSelected?' sel':''}${available?'':' unavailable'}" data-track="${t.key}">
    <button class="ps-preview" ${available?'':'disabled'} onclick="previewAmbience('${t.key}')" aria-label="${previewing?'Stop':'Preview'} ${t.name}">${svgIcon(previewing?'pause':'play')}</button>
    <button class="ps-track-copy" style="border:0;background:none;color:inherit;text-align:left" ${available?'':'disabled'} onclick="selectPendingAmbience('${t.key}')"><b>${t.name}</b><small>${t.category}${available?'':' · Add audio to enable'}</small></button>
    <button class="ps-heart${favorites.has(t.key)?' sel':''}" onclick="toggleAmbienceFavorite('${t.key}')" aria-label="Favorite ${t.name}">${svgIcon('heart')}</button><span class="ps-check">${isSelected?'✓':''}</span></div>`}).join('') || '<p style="padding:28px;color:#b9aacd;text-align:center">No favorites yet.</p>';
  const pending=playerPendingTrack||PLAYER_AMBIENCE.find(t=>t.key===playerPrefs.ambience); document.getElementById('ambiencePending').textContent=pending?pending.name:'None';
}
function openAmbienceLibrary(){ playerPendingTrack=PLAYER_AMBIENCE.find(t=>t.key===playerPrefs.ambience)||null;renderAmbienceLibrary();document.getElementById('ambienceSheet').classList.add('open'); }
function setAmbienceCategory(c){playerCategory=c;renderAmbienceLibrary();}
function selectPendingAmbience(key){const t=PLAYER_AMBIENCE.find(x=>x.key===key);if(!t||!trackIsAvailable(t))return;playerPendingTrack=t;renderAmbienceLibrary();}
function toggleAmbienceFavorite(key){const s=new Set(playerPrefs.favorites);s.has(key)?s.delete(key):s.add(key);playerPrefs.favorites=[...s];persistPlayerPrefs();renderAmbienceLibrary();}
function usePendingAmbience(){
  if(!playerPendingTrack)return;
  if(playerPendingTrack.kind==='frequency'){const f=FREQS.find(x=>x.hz===playerPendingTrack.hz);if(f){playerPrefs.frequency=f.hz;state.freq=f;changeFinalFrequency(String(f.hz));}}
  else {playerPrefs.ambience=playerPendingTrack.key;state.bg=playerPendingTrack.key;if(typeof changeFinalAmbience==='function')changeFinalAmbience(state.bg);}
  persistPlayerPrefs();renderPlayerSelectionState();closePlayerSheets();stopAmbiencePreview();
}
function stopAmbiencePreview(){
  if(playerPreview&&playerPreview.audio){playerPreview.audio.pause();playerPreview.audio.src='';}
  if(playerPreview&&playerPreview.engine)playerPreview.engine.stop();
  if(playerPreviewCtx){try{playerPreviewCtx.close();}catch(e){}playerPreviewCtx=null;}
  playerPreview=null;
}
function previewAmbience(key){
  const t=PLAYER_AMBIENCE.find(x=>x.key===key);if(!t||!trackIsAvailable(t))return;
  if(playerPreview&&playerPreview.key===key){stopAmbiencePreview();renderAmbienceLibrary();return;}
  stopAmbiencePreview();
  if(window.AMBIENCE_URLS&&window.AMBIENCE_URLS[key]){const audio=new Audio(window.AMBIENCE_URLS[key]);audio.loop=true;audio.volume=.45;audio.play().catch(()=>{});playerPreview={key,audio};}
  else {playerPreviewCtx=new (window.AudioContext||window.webkitAudioContext)();const g=playerPreviewCtx.createGain();g.gain.value=.25;g.connect(playerPreviewCtx.destination);let engine;if(t.kind==='frequency'){const o=playerPreviewCtx.createOscillator();o.type='sine';o.frequency.value=t.hz;o.connect(g);o.start();engine={stop(){try{o.stop();}catch(e){}}};}else engine=buildAmbience(playerPreviewCtx,key,g);playerPreview={key,engine};}
  renderAmbienceLibrary();
}
function closePlayerSheets(){document.querySelectorAll('.player-sheet').forEach(x=>x.classList.remove('open'));stopAmbiencePreview();}

function openLoopSheet(){const options=[['entire','Loop entire subliminal'],['current','Loop current affirmation'],['none','No loop']];document.getElementById('loopOptions').innerHTML=options.map(([k,l])=>`<button class="ps-option${playerPrefs.loopMode===k?' sel':''}" onclick="setPlayerLoopMode('${k}')"><span>${l}</span><span>${playerPrefs.loopMode===k?'✓':''}</span></button>`).join('');document.getElementById('loopSheet').classList.add('open');}
function setPlayerLoopMode(mode){playerPrefs.loopMode=mode;persistPlayerPrefs();renderPlayerSelectionState();openLoopSheet();setTimeout(closePlayerSheets,220);}
function openTimerSheet(){const choices=[[20,'20 min'],[60,'1 hour'],[240,'4 hours'],[480,'8 hours'],['custom','Custom']];document.getElementById('timerOptions').innerHTML=choices.map(([v,l])=>`<button class="ps-option${playerPrefs.duration===v?' sel':''}" onclick="${v==='custom'?'showCustomTimer()':`setPlayerDuration(${v})`}"><span>${l}</span><span>${playerPrefs.duration===v?'✓':''}</span></button>`).join('')+`<div class="ps-custom" id="customTimer"><input type="number" min="1" max="720" id="customTimerMinutes" placeholder="Minutes"><button class="ps-use" onclick="setPlayerDuration(document.getElementById('customTimerMinutes').value)">Set timer</button></div>`;document.getElementById('timerSheet').classList.add('open');}
function showCustomTimer(){document.getElementById('customTimer').classList.add('open');document.getElementById('customTimerMinutes').focus();}
function setPlayerDuration(minutes){minutes=Math.max(1,Math.min(720,Number(minutes)||20));playerPrefs.duration=minutes;state.targetLengthMinutes=minutes;persistPlayerPrefs();renderPlayerSelectionState();closePlayerSheets();}
function openPlayerMenu(){closePlayerSheets();document.getElementById('playerMenuSheet').classList.add('open');}
async function shareCurrentSubliminal(){const data={title:currentPlayerTitle(),text:`I’m listening to “${currentPlayerTitle()}” in Subliminally.`,url:'https://www.subliminallybyfthr.com/'};try{if(navigator.share)await navigator.share(data);else await navigator.clipboard.writeText(`${data.text} ${data.url}`);}catch(e){} }
async function recordPlayerSession(completed,elapsedSeconds){
  if(playerSessionSaved||!elapsedSeconds)return;playerSessionSaved=true;
  if(sb&&currentUser){try{await sb.from('listening_sessions').insert({user_id:currentUser.id,subliminal_id:editingExistingId||null,seconds_listened:Math.round(elapsedSeconds),completed:!!completed,ambience_key:state.bg||null,loop_mode:playerPrefs.loopMode});}catch(e){}}
}
function setupMediaSession(){
  if(!('mediaSession'in navigator))return;
  try{navigator.mediaSession.metadata=new MediaMetadata({title:currentPlayerTitle(),artist:'Your Subliminal',album:'Subliminally'});}catch(e){}
  const handlers={play:()=>{if(finalPaused)resumeFinal();else if(!finalPlaying)playFinal();},pause:()=>pauseFinal(),stop:()=>stopFinal(),previoustrack:()=>seekFinalAffirmation(-1),nexttrack:()=>seekFinalAffirmation(1)};
  Object.entries(handlers).forEach(([a,h])=>{try{navigator.mediaSession.setActionHandler(a,h);}catch(e){}});
}
document.addEventListener('DOMContentLoaded',mountImmersivePlayer);
