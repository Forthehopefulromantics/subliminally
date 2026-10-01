/* Adjust Sounds — the audio layers of a saved subliminal, edited in place.

   A saved subliminal is a project with layers:

     affirmations   the words. Never touched here.
     voice          the recorded or generated audio of those words. Reused as
                    it is: nothing on this sheet can reach /api/tts, the
                    recorder, or the voice cloner.
     brainwave      the binaural band under the tone
     frequency      the tone itself
     ambience       one meditation sound and/or one nature sound
     soothing       the optional pad
     volume mix     every layer's level

   Only the last five change here, and Save Changes writes them onto the SAME
   row (frequency_hz, binaural_band, background, mix_settings). Nothing is
   inserted unless "Save as new" is pressed on purpose.

   While the sheet is open the mixer's autosave is paused, so what is on the
   sheet is a preview until it is saved — and closing without saving puts every
   layer back exactly as it was. */
let audioEditorId = null;
let audioEditorSnapshot = null;
let audioEditorSaving = false;

const AE_SOOTHING = [['none','None'],['pad','Warm pad'],['chimes','Soft chimes'],['hum','Low hum']];

/* Everything this sheet can change, as one comparable value. */
function audioLayerSnapshot(){
  return {
    freqHz: state.freq ? state.freq.hz : null,
    band: state.binauralBand || null,
    bg: state.bg || 'none',
    bgLayer: state.bgLayer || 'none',
    soothing: state.soothingLayer || 'none',
    mix: readMixSettings()
  };
}
/* The columns a saved subliminal keeps its sound in. Affirmations, voice,
   recordings, title and cover are deliberately absent. */
function savedAudioPayload(){
  return {
    frequency_hz: state.freq ? state.freq.hz : null,
    binaural_band: state.binauralBand || null,
    background: state.bg || 'none',
    mix_settings: readMixSettings()
  };
}
function audioEditorDirty(){
  return !!audioEditorSnapshot && JSON.stringify(audioLayerSnapshot()) !== JSON.stringify(audioEditorSnapshot);
}

function mountAudioEditor(){
  if (document.getElementById('audioEditorSheet')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="player-sheet audio-editor" id="audioEditorSheet" role="dialog" aria-modal="true" aria-labelledby="aeHeading">
      <div class="ps-panel ae-panel">
        <div class="ps-head">
          <div class="ae-head-copy"><small>Adjust Sounds</small><h3 id="aeHeading">Your subliminal</h3></div>
          <button class="ps-close" onclick="closeAudioEditor()" aria-label="Close">✕</button>
        </div>
        <div class="ae-body" id="aeBody"></div>
        <div class="ae-foot">
          <p class="ae-status" id="aeStatus" role="status"></p>
          <div class="ae-new-row" id="aeNewRow" hidden>
            <input type="text" id="aeNewTitle" maxlength="60" placeholder="Name the new version" aria-label="Title for the new subliminal">
            <button class="ps-use" onclick="saveAudioEditsAsNew()">Save as new</button>
            <button class="ae-ghost" onclick="toggleAudioEditorNewRow(false)">Cancel</button>
          </div>
          <div class="ae-actions">
            <button class="ae-ghost ae-preview" id="aePreviewBtn" onclick="previewAudioEdits()"></button>
            <button class="ae-ghost" id="aeSaveNewBtn" onclick="toggleAudioEditorNewRow(true)">Save as new…</button>
            <button class="ps-use" id="aeSaveBtn" onclick="saveAudioEdits()">Save Changes</button>
          </div>
        </div>
      </div>
    </div>`);
  const sheet = document.getElementById('audioEditorSheet');
  sheet.addEventListener('click', e => { if (e.target === sheet) closeAudioEditor(); });
}

function setAudioEditorStatus(text, kind){
  const el = document.getElementById('aeStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'ae-status' + (kind ? ' ' + kind : '');
}

/* Opens on the subliminal that is loaded, or loads the one asked for first —
   loading is the same loader Play and "Open in builder" use, so the sheet
   always starts from what was last saved, never from defaults. */
async function openAudioEditor(id){
  if (!sb || !currentUser){ openAuthModal(); return; }
  id = id || activeMixId;
  if (!id){ mixMessage('Save this subliminal to your library first, then you can adjust its sounds.'); return; }
  mountAudioEditor();
  const sheet = document.getElementById('audioEditorSheet');
  document.getElementById('aeBody').innerHTML = '<p class="ae-loading">Loading your current sounds…</p>';
  setAudioEditorStatus('');
  toggleAudioEditorNewRow(false);
  sheet.classList.add('open');
  document.body.classList.add('audio-editor-open');
  if (activeMixId !== id || editingExistingId !== id){
    try {
      if (finalPlaying) stopFinal();
      await loadSavedIntoBuilder(id, { stayHere: true });
      if (typeof libraryNowPlayingId !== 'undefined') libraryNowPlayingId = id;
    } catch (e){
      console.error('openAudioEditor load failed:', e);
      document.getElementById('aeBody').innerHTML = '<p class="ae-loading">This subliminal could not be loaded just now. Please try again in a moment.</p>';
      return;
    }
  } else {
    await flushMixSave();
  }
  audioEditorId = id;
  audioEditorSnapshot = audioLayerSnapshot();
  mixAutosavePaused = true;
  renderAudioEditor();
}

function renderAudioEditor(){
  const body = document.getElementById('aeBody');
  if (!body) return;
  document.getElementById('aeHeading').textContent = state.playerTitle || 'Your subliminal';
  const bands = [['none','None',''], ...Object.entries(BINAURAL_BANDS).map(([k,b]) => [k, b.label, b.range])];
  const families = ambienceFamilies();
  const card = (t) => `<button type="button" class="ae-card" role="checkbox" data-key="${t.key}" onclick="aeChooseAmbience('${t.key}')"><b>${escapeAe(t.name)}</b>${t.category ? `<small>${escapeAe(t.category)}</small>` : ''}</button>`;
  body.innerHTML = `
    <p class="ae-intro">Your affirmations, voice recording, title and cover stay exactly as they are. Change any layer below, preview it, then save.</p>
    <section class="ae-section">
      <h4>Brainwave layer</h4><p class="ae-hint">A binaural beat under the tone — best with headphones.</p>
      <div class="ae-chips" id="aeBands" role="radiogroup" aria-label="Brainwave layer">
        ${bands.map(([k,label,range]) => `<button type="button" class="ae-chip" role="radio" data-band="${k}" onclick="aeChooseBand('${k}')">${label}${range ? `<span>${range}</span>` : ''}</button>`).join('')}
      </div>
    </section>
    <section class="ae-section">
      <h4>Frequency</h4>
      <div class="ae-grid" id="aeFreqs" role="radiogroup" aria-label="Frequency">
        ${FREQS.map(f => `<button type="button" class="ae-card" role="radio" data-hz="${f.hz}" onclick="aeChooseFreq(${f.hz})"><b>${f.hz} Hz</b><small>${escapeAe(f.word)}</small></button>`).join('')}
      </div>
    </section>
    <section class="ae-section">
      <h4>Nature &amp; ambience</h4><p class="ae-hint">One meditation sound and one nature sound can play together. Tap a chosen sound again to take it off.</p>
      <div id="aeAmbience">
        ${families.map(g => `<div class="ae-family"><span class="ae-family-label">${g.label}</span><div class="ae-grid">${g.tracks.map(card).join('')}</div></div>`).join('')}
        <div class="ae-family"><div class="ae-grid">${card({ key:'none', name:'No ambience', category:'' })}</div></div>
      </div>
    </section>
    <section class="ae-section">
      <h4>Soothing layer</h4>
      <div class="ae-chips" id="aeSoothing" role="radiogroup" aria-label="Soothing layer">
        ${AE_SOOTHING.map(([k,label]) => `<button type="button" class="ae-chip" role="radio" data-variant="${k}" onclick="aeChooseSoothing('${k}')">${label}</button>`).join('')}
      </div>
    </section>
    <section class="ae-section">
      <h4>Volume mix</h4><p class="ae-hint">Voice, frequency, ambience and every other layer, each on its own.</p>
      <div class="listening-mix ae-mix">${listeningMixMarkup()}</div>
    </section>`;
  paintAudioEditor();
}
function escapeAe(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* The one paint: every highlight re-derived from state, the same rule as
   js/selectable.js. Opening the sheet therefore shows the saved choices lit. */
function paintAudioEditor(){
  if (!document.getElementById('aeBody')) return;
  syncSelectionByData('#aeBands .ae-chip', 'band', state.binauralBand || 'none');
  syncSelection('#aeFreqs .ae-card', el => !!state.freq && el.dataset.hz === String(state.freq.hz));
  const chosen = [state.bg, state.bgLayer].filter(k => k && k !== 'none');
  syncSelectionByDataIn('#aeAmbience .ae-card', 'key', chosen.length ? chosen : ['none']);
  syncSelectionByData('#aeSoothing .ae-chip', 'variant', state.soothingLayer || 'none');
  syncListeningMix();
  const preview = document.getElementById('aePreviewBtn');
  if (preview){
    const live = finalPlaying && !finalPaused;
    preview.textContent = live ? 'Pause preview' : 'Preview mix';
    preview.setAttribute('aria-pressed', String(live));
  }
  const dirty = audioEditorDirty();
  const save = document.getElementById('aeSaveBtn');
  if (save){ save.disabled = !dirty || audioEditorSaving; save.textContent = dirty ? 'Save Changes' : 'Saved'; }
  if (dirty && !audioEditorSaving) setAudioEditorStatus('Unsaved changes — press Save Changes to keep this mix.');
}

/* ---------- the layers. None of these lead to prepareSessionVoice(). ---------- */
function aeChooseBand(band){
  const prev = state.binauralBand || null;
  state.binauralBand = band === 'none' ? null : band;
  syncSelectionByData('#binauralChips .length-chip', 'band', state.binauralBand || 'none');
  changeFinalBrainwave(prev);
  paintAudioEditor();
}
function aeChooseFreq(hz){
  changeFinalFrequency(String(hz));
  renderFinalFreqPicker();
  if (typeof paintFreqCards === 'function') paintFreqCards();
  paintAudioEditor();
}
function aeChooseAmbience(key){
  const chosen = [state.bg, state.bgLayer].filter(k => k && k !== 'none');
  if (key === 'none'){ state.bg = 'none'; state.bgLayer = 'none'; }
  else if (chosen.includes(key) && chosen.length > 1) removeAmbience(key);
  else chooseAmbience(key);
  ambienceCandidate = state.bg;
  paintBgCards();
  const sel = document.getElementById('finalAmbienceSelect');
  if (sel) sel.value = state.bg;
  warmAmbience(state.bg); warmAmbience(state.bgLayer);
  applySessionAmbience();
  if (typeof renderPlayerSelectionState === 'function') renderPlayerSelectionState();
  paintAudioEditor();
}
async function aeChooseSoothing(variant){
  if (variant !== 'none'){
    const tier = currentUser ? await getMyTier() : 'none';
    if (!tierHasFeature(tier, 'soothing_layer')){
      setAudioEditorStatus('The soothing layer comes with Ritual.', 'err');
      openUpgradeModal('soothing_layer', { tier, trigger: 'audio_editor_soothing' });
      return;
    }
  }
  setSoothingLayer(variant);
  paintAudioEditor();
}

/* Preview is the real session engine, so what you hear is what will be saved. */
function previewAudioEdits(){
  primeAudio();
  toggleImmersivePlayback();
  paintAudioEditor();
}

/* Puts every layer back the way the snapshot says — used when the sheet is
   closed without saving. */
function restoreAudioLayers(snap){
  if (!snap) return;
  const freq = FREQS.find(f => f.hz === snap.freqHz) || null;
  if (freq) changeFinalFrequency(String(freq.hz)); else state.freq = null;
  renderFinalFreqPicker();
  const prevBand = state.binauralBand || null;
  state.binauralBand = snap.band;
  syncSelectionByData('#binauralChips .length-chip', 'band', state.binauralBand || 'none');
  changeFinalBrainwave(prevBand);
  state.bg = snap.bg; state.bgLayer = snap.bgLayer;
  ambienceCandidate = state.bg;
  paintBgCards(); renderFinalAmbiencePicker(); applySessionAmbience();
  setSoothingLayer(snap.soothing);
  restoreMixSettings(activeMixId, snap.mix);
  if (typeof renderPlayerSelectionState === 'function') renderPlayerSelectionState();
}

function closeAudioEditor(){
  if (audioEditorSaving) return;
  if (audioEditorDirty()){
    if (!window.confirm('Discard the sound changes you have not saved?')) return;
    restoreAudioLayers(audioEditorSnapshot);
  }
  mixAutosavePaused = false;
  audioEditorSnapshot = null;
  const sheet = document.getElementById('audioEditorSheet');
  if (sheet) sheet.classList.remove('open');
  document.body.classList.remove('audio-editor-open');
  mixMessage(activeMixId ? 'Your saved sound levels' : '');
}

function toggleAudioEditorNewRow(show){
  const row = document.getElementById('aeNewRow');
  if (!row) return;
  row.hidden = !show;
  if (show){
    const input = document.getElementById('aeNewTitle');
    input.value = `${state.playerTitle || 'Your Subliminal'} — new mix`.slice(0, 60);
    input.focus(); input.select();
  }
}

/* SAVE CHANGES: the same row, updated. Never an insert. */
async function saveAudioEdits(){
  const id = audioEditorId;
  if (!id || !sb || !currentUser || audioEditorSaving) return;
  audioEditorSaving = true;
  setAudioEditorStatus('Saving…');
  paintAudioEditor();
  try {
    const { data, error } = await sb.from('subliminals').update(savedAudioPayload())
      .eq('id', id).eq('user_id', currentUser.id).select('id').single();
    if (error || !data) throw error || new Error('No saved subliminal was updated.');
    ['todaySubs','todaySubCovers','myLibrary'].forEach(forgetFetch);
    audioEditorSnapshot = audioLayerSnapshot();
    setAudioEditorStatus('Saved. This subliminal will always open with this mix.', 'ok');
  } catch (e){
    console.error('saveAudioEdits failed:', e);
    setAudioEditorStatus("Your changes couldn't be saved just now. Please try again.", 'err');
  } finally {
    audioEditorSaving = false;
    paintAudioEditor();
  }
}

/* SAVE AS NEW: only when asked for. A copy of the saved row — the same
   affirmations, the same voice files (the storage paths are reused, nothing is
   re-recorded or regenerated) — with this mix and its own title. The original
   is left exactly as it was last saved. */
async function saveAudioEditsAsNew(){
  const id = audioEditorId;
  if (!id || !sb || !currentUser || audioEditorSaving) return;
  const title = document.getElementById('aeNewTitle').value.trim();
  if (!title){ setAudioEditorStatus('Give the new version a title first.', 'err'); return; }
  audioEditorSaving = true;
  setAudioEditorStatus('Saving a new copy…');
  try {
    const tier = await getMyTier();
    const { count } = await sb.from('subliminals').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
    if ((count || 0) >= TIER_SUBLIMINAL_CAPS[tier]){
      setAudioEditorStatus('Your library is full, so this can only be saved as changes to this subliminal.', 'err');
      openUpgradeModal('library_space', { tier, trigger: 'audio_editor_save_new' });
      return;
    }
    const { data: row, error: readErr } = await sb.from('subliminals').select('*').eq('id', id).eq('user_id', currentUser.id).maybeSingle();
    if (readErr || !row) throw readErr || new Error('The original could not be read.');
    const copy = { ...row, ...savedAudioPayload(), title };
    delete copy.id; delete copy.created_at; delete copy.updated_at;
    const { data: saved, error } = await sb.from('subliminals').insert(copy).select('id').single();
    if (error || !saved) throw error || new Error('The new copy was not saved.');
    ['todaySubs','todaySubCovers','myLibrary'].forEach(forgetFetch);
    /* From here on the sheet, the player and Save Changes all point at the new
       one, so further tweaks never quietly land on the original. */
    editingExistingId = saved.id;
    activeMixId = saved.id;
    audioEditorId = saved.id;
    state.playerTitle = title;
    if (typeof libraryNowPlayingId !== 'undefined') libraryNowPlayingId = saved.id;
    audioEditorSnapshot = audioLayerSnapshot();
    toggleAudioEditorNewRow(false);
    document.getElementById('aeHeading').textContent = title;
    const ipTitle = document.getElementById('ipTitle');
    if (ipTitle) ipTitle.textContent = title;
    setAudioEditorStatus(`Saved as a new subliminal, “${title}”. The original is unchanged.`, 'ok');
    if (document.getElementById('myLibraryList') && typeof loadMyLibrary === 'function') loadMyLibrary({ force: true });
  } catch (e){
    console.error('saveAudioEditsAsNew failed:', e);
    setAudioEditorStatus("The new copy couldn't be saved just now. Please try again.", 'err');
  } finally {
    audioEditorSaving = false;
    paintAudioEditor();
  }
}

/* Play / pause from anywhere else keeps the Preview button honest. */
setInterval(() => {
  const sheet = document.getElementById('audioEditorSheet');
  if (!sheet || !sheet.classList.contains('open')) return;
  const preview = document.getElementById('aePreviewBtn');
  const live = finalPlaying && !finalPaused;
  if (preview && preview.getAttribute('aria-pressed') !== String(live)) paintAudioEditor();
}, 700);
