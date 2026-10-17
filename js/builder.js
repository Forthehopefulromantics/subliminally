/* builder.js — the subliminal builder: flow, affirmations, voices, recording, ambience, playback

   Part of Subliminally. These are plain scripts, not modules, loaded in
   order: they share one global scope, which is what lets the inline
   onclick handlers in index.html keep working, and what lets each file
   see the ones loaded before it. Order matters — see index.html. */

function goTo(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }

/* ---------------- DATA ---------------- */
const FREQS = [
  { hz:174, word:"foundation", guide:"Sometimes called the body's 'natural anesthetic' — traditionally associated with easing physical and emotional pain, lowering stress, and giving your organs a felt sense of safety. A grounded foundation to build the rest of the session on." },
  { hz:285, word:"restoration", guide:"Traditionally one of the more physically-oriented tones in the set, associated with supporting the body's own sense of repair in wounds, tissue, and general recovery. A gentle choice after physical strain or a long week." },
  { hz:396, word:"grounding", guide:"Traditionally linked to the root chakra — the body's base energy center, associated with safety and stability. Believed to help clear stress and let go of heavier emotions like fear and guilt, and to leave you feeling more grounded." },
  { hz:417, word:"transitions", guide:"Known as the 'frequency of transformation' — traditionally associated with clearing negative energy, releasing emotional blockages, and easing the transition into something new. Linked to the sacral chakra, the energy center associated with creativity and emotional flow." },
  { hz:432, word:"harmony", guide:"Sometimes called 'natural tuning' — a standard concert pitch a touch lower than the now-common 440 Hz. Believers say it aligns more naturally with patterns found in nature, and associate it with a lower heart rate and eased anxiety. It isn't part of the traditional Solfeggio set, but alongside 528 Hz it's the alternative people ask for most." },
  { hz:528, word:"renewal", guide:"Often called the 'love frequency' — the most-requested of the set. A small number of preliminary studies have looked at whether 528 Hz audio affects stress markers like cortisol and oxytocin, though the evidence is still early. Traditionally linked to the heart chakra and the solar plexus chakra, for emotional healing and personal transformation. A warm default." },
  { hz:639, word:"connection", guide:"Associated with connection, love, and relationship harmony — traditionally used to help work through interpersonal conflict and clear emotional blockages between people, including the relationship with yourself." },
  { hz:741, word:"expression", guide:"Linked to the throat chakra — the energy center associated with truth and self-expression. Often used during meditation to help clear mental noise, work through a problem, and speak more honestly." },
  { hz:852, word:"insight", guide:"Associated with intuition and the 'third eye' — traditionally tied to inner wisdom and quieting mental chatter. Some listeners, including people who find their mind especially busy, say a steady tone like this one helps settle racing thoughts. Good on overthinking nights." },
  { hz:963, word:"reflection", guide:"Sometimes called the 'frequency of the gods' — traditionally linked to the crown chakra and a sense of universal oneness. The stillest of the set, associated with deep reflection and letting go." },
];
const INTENTIONS = [
  ["confidence","Confidence"],["love","Love"],["wealth","Wealth"],["healing","Healing"],
  ["discipline","Discipline"],["sleep","Sleep"],["selfworth","Self-worth"],["creativity","Creativity"]
];
const FALLBACK_BANK = {
  confidence: ["I trust myself.","I move through life confidently.","My presence is enough.","I speak and my voice carries.","I meet challenges with steadiness."],
  love: ["I am easy to love.","I give and receive love freely.","Warmth finds me everywhere.","I am open and I am safe.","My heart rests tonight."],
  wealth: ["I make grounded decisions with money.","Opportunities move toward me.","I build slowly and surely.","I am resourceful and calm.","Abundance feels natural to me."],
  healing: ["My body deserves rest.","I release what today carried.","I am gentle with myself.","Every breath softens me.","I am mending, quietly."],
  discipline: ["I keep the promises I make to myself.","Small steps, every day.","My focus is a form of self-respect.","I begin before I feel ready.","Rest is part of my discipline."],
  sleep: ["My body deserves rest.","The day is complete.","I let my thoughts settle like dusk.","Sleep comes easily to me.","I am safe to let go."],
  selfworth: ["I am allowed to take up space.","My worth is not up for debate.","I treat myself as someone I love.","I am whole as I am.","I belong to myself."],
  creativity: ["Ideas visit me easily.","I make things without judging them.","My imagination rests and refills.","I trust the first draft.","Creation is my natural state."],
};
/* The ambience library — its names, its categories, where its audio lives and
   the one object allowed to play it — is js/ambience.js, loaded before this
   file. Nothing about a background lives here any more except how to build the
   generated ones (buildAmbience, further down) and how to draw the picker. */
/* Binaural beats: a slightly different pure tone in each ear, which the brain perceives
   as a single pulsing "beat" at the difference between the two frequencies. That part is
   real, measurable audio physics. Which beat speed does what to your mental state is far
   less settled — the ranges below are the commonly cited associations, framed as such,
   not as guarantees. Requires stereo headphones; over speakers, both ears hear the same
   mix and the effect disappears entirely. */
const BINAURAL_BANDS = {
  delta: { label:'Delta', hz:2,  range:'0.5–4 Hz',  guide:'Often associated with deep, dreamless sleep. A common choice for the tail end of a long session.' },
  theta: { label:'Theta', hz:6,  range:'4–8 Hz',    guide:'Often associated with deep relaxation, meditation, and the drowsy state right before sleep.' },
  alpha: { label:'Alpha', hz:10, range:'8–13 Hz',   guide:'Often associated with calm, relaxed focus — awake but unhurried.' },
  beta:  { label:'Beta',  hz:20, range:'13–30 Hz',  guide:'Often associated with alert, active concentration. A less common choice for a nightly ritual, more suited to daytime focus.' },
  gamma: { label:'Gamma', hz:40, range:'30–50 Hz',  guide:'Often associated with high-level focus and cognitive processing.' },
};
/* The full 11-line EFT structure used here: line 0 is the Setup Statement (said on the
   Karate Chop point, repeated 3x), and lines 1-10 are a 10-tap round that starts and
   ends on Karate Chop, covering all eight core points (including Top of Head) in
   between. */
/* ---------- the round, as Kyla runs it ----------
   It opens before any tapping: one line taking responsibility for your own
   well-being, said still. Then the Karate Chop carries two setup statements
   rather than one repeated three times -- love and accept, then honour -- each
   naming a different feeling, because naming two is how you get underneath the
   first one. The cycle then runs from the forehead down and finishes on the
   crown, and every round closes the same way: in body, mind and spirit.

   `isStill` means do not tap yet. `isSetup` means the Karate Chop. */
const EFT_LINE_POINTS = [
  { key:'responsibility', label:'Before you tap', where:'sit still for this one — hands down', isStill:true },
  { key:'kcA', label:'Karate Chop — accept', where:'the outer edge of either hand, below the pinky', isSetup:true },
  { key:'kcB', label:'Karate Chop — honour', where:'the outer edge of either hand, below the pinky', isSetup:true },
  { key:'forehead', label:'Forehead', where:'the centre of your forehead, above the brow' },
  { key:'eyebrow', label:'Eyebrow', where:'the inner edge of one eyebrow, near the bridge of your nose' },
  { key:'sideeye', label:'Side of the Eye', where:'the bone at the outer corner of your eye' },
  { key:'undereye', label:'Under the Eye', where:'the bone directly under your eye' },
  { key:'undernose', label:'Under the Nose', where:'the small area between your nose and upper lip' },
  { key:'chin', label:'Chin', where:'the crease between your lower lip and chin' },
  { key:'collarbone', label:'Collarbone', where:'just below where your collarbones meet' },
  { key:'underarm', label:'Under the Arm', where:'your side, about four inches below your armpit' },
  { key:'crown', label:'Top of the Head', where:'the crown, centre top of your head' },
  { key:'close', label:'Closing', where:'rest your hands — this is the close', isStill:true },
];
const EFT_LINE_COUNT = EFT_LINE_POINTS.length;
const EFT_OPENING_LINE = 'Take responsibility for your own well-being.';
const EFT_CLOSING_LINE = 'In body, mind and spirit.';
/* Once each. You used to be asked up front how many times every line should
   repeat -- five, six or seven -- which is a decision about a session you have
   not had yet. Tapping is done by feel: the line is said, you tap it as long as
   it takes, and the round comes back round again for as long as you stay. */
function eftRepeatsForIndex(i){ return 1; }

/* ---------------- FLOW STATE ---------------- */
let step = 0;
const TOTAL_STEPS = 8;

/* ---------------- WHOSE VOICE: the three answers, named ----------------
   There are exactly three answers to "whose voice tonight?", and every one of
   them means a different route out of the voice step. They are named here, once,
   and nothing downstream is allowed to infer the route from anything else.

   Why this exists: the route used to be read off `voiceMode`/`aiVoiceId`, which
   are the *storage* fields -- what gets written to the subliminals row and handed
   to the player. 'ai' covers both Serenity and a cloned voice, and null covers
   both "not answered yet" and "the paywall stopped them", so the one question
   the flow actually has to answer -- does this person record, or not -- was being
   reconstructed from fields that were never about that. Falling back to
   recording was the default, and it is the worst possible default: it is the
   long path, and it is the one nobody who chose an AI voice asked for.

   So: `state.selectedVoice` is the answer to the question on the screen, and
   `voiceMode`/`aiVoiceId` stay exactly what they were, derived from it. Nothing
   in billing.js, profile.js or the player changes. */
const VOICE_RECORD_OWN = 'record_own';   // record the lines yourself, one by one
const VOICE_SERENITY   = 'serenity';     // the catalogue's AI voice reads them
const VOICE_CLONE      = 'clone_voice';  // an AI version of this person's voice
const VOICE_CHOICES = [VOICE_RECORD_OWN, VOICE_SERENITY, VOICE_CLONE];

let state = { freq:null, freqLayers:[], intention:null, goal:'', tone:null, intensity:'bold', count:5, affirmations:[], selectedVoice:null, voiceMode:null, aiVoiceId:null, bg:'none', bgLayer:'none', targetLengthMinutes:5, soothingLayer:'none', layerAffirmations:[], layerVoiceMode:null, layerAiVoiceId:null, affirmationGapMs:2400, pace:'steady', eftMode:false, visualizationMode:false, binauralBand:null, playerTitle:null };

/* Three phases rather than eight bars: choosing everything (frequency through
   ambience), recording it, and hearing it. The line after the current phase
   fills as you move through that phase's steps. */
const FLOW_PHASES = [
  { label:'Create', first:0, last:5 },
  { label:'Refine', first:6, last:6 },
  { label:'Align',  first:7, last:7 },
];
function renderProgress(){
  const bar = document.getElementById('flowProgress'); bar.innerHTML='';
  bar.classList.add('flow-phases');
  bar.setAttribute('aria-label', 'Build progress');
  FLOW_PHASES.forEach((phase, i) => {
    const current = step >= phase.first && step <= phase.last;
    const done = step > phase.last;
    const item = document.createElement('div');
    item.className = 'flow-phase' + (current ? ' current' : '') + (done ? ' done' : '');
    if (current) item.setAttribute('aria-current', 'step');
    const dot = document.createElement('span'); dot.className = 'flow-phase-dot';
    const label = document.createElement('span'); label.className = 'flow-phase-label';
    label.textContent = (i + 1) + '. ' + phase.label;
    item.appendChild(dot); item.appendChild(label);
    if (i < FLOW_PHASES.length - 1){
      const line = document.createElement('span'); line.className = 'flow-phase-line';
      const span = phase.last - phase.first + 1;
      const fill = done ? 1 : current ? (step - phase.first + 1) / (span + 1) : 0;
      line.setAttribute('style', '--fill:' + fill);
      item.appendChild(line);
    }
    bar.appendChild(item);
  });
}
function showStep(n){
  document.querySelectorAll('.flow-step').forEach(s=>s.classList.remove('active'));
  document.querySelector(`.flow-step[data-step="${n}"]`).classList.add('active');
  step = n; renderProgress();
  if (n === 1){ updateSessionLengthHint(); renderDurationChips(); }
  if (n === 1 || n === 5) applyBuilderLocks();
  /* The record panel is drawn as it opens, every time, from whatever the lines
     and the index currently are. This is what makes the "..." placeholder in
     index.html unreachable rather than merely unlikely: there is no route onto
     step 6, present or future, that can skip it. */
  if (n === 6) showRecordLine();
  /* The three voice cards are always on screen, so their locks — and the demo
     the Serenity one can play — are drawn as the step opens rather than as a
     side effect of picking something. */
  if (n === 4){
    paintVoiceLimitNote();
    /* Draw what is chosen before anything is awaited, so coming back to this
       screen never shows three blank cards for a beat. */
    paintVoiceCards();
    renderVoiceCards();
    restoreVoiceChoice();
  }
  else stopSerenityPreview();   // the demo does not follow you to the next screen
  /* Opening the ambience step: draw both states from scratch — what is chosen
     and what, if anything, is being auditioned — and start the download of the
     chosen track so pressing play later does not wait on it. Leaving it stops
     the preview, for the same reason the voice demo does not follow you. */
  if (n === 5){
    ambienceCandidate = state.bg;
    paintBgCards();
    warmAmbience(state.bg); warmAmbience(state.bgLayer);
  }
  else stopAmbiencePreview();
  if (n === 1 && pendingRitualMode){
    const chip = document.querySelector(`#ritualModeChips .length-chip[data-mode="${pendingRitualMode}"]`);
    pendingRitualMode = null;
    if (chip) pickRitualMode(chip);
  }
  if (n === 7){ renderFinalFreqPicker(); renderFinalAmbiencePicker(); renderFinalPlaylist(); }
  if (n === 0) checkRecordingDraft();
}
/* The session-length slider runs from 5 minutes to 8 hours with no restriction on
   dragging — nothing is gated until they try to actually generate/save a session
   longer than their tier allows (see generateAffirmations). This hint just tells
   free/underpowered accounts what a given length would require, so it isn't a
   surprise later. Paid accounts that already qualify see nothing extra. */
function formatSessionLength(minutes){
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes/60), m = minutes%60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
async function onSessionLengthInput(){
  const minutes = parseInt(document.getElementById('sessionLengthSlider').value, 10);
  state.targetLengthMinutes = minutes;
  document.getElementById('sessionLengthVal').textContent = formatSessionLength(minutes);
  syncDurationChips();
  await updateSessionLengthHint();
  updateSessionTimerLabel();
}
async function updateSessionLengthHint(){
  const hintEl = document.getElementById('lengthMsg');
  if (!hintEl) return;
  const minutes = state.targetLengthMinutes || parseInt(document.getElementById('sessionLengthSlider').value, 10);
  const requiredTier = requiredTierForMinutes(minutes);
  if (requiredTier === 'none'){ hintEl.textContent = ''; hintEl.className = 'length-msg'; return; }
  const myTier = currentUser ? await getMyTier() : 'none';
  if (tierAtLeast(myTier, requiredTier)){ hintEl.textContent = ''; hintEl.className = 'length-msg'; return; }
  hintEl.innerHTML = `${formatSessionLength(minutes)} needs ${TIER_LABEL[requiredTier]} or higher — <a href="#" onclick="openUpgradeModal('${featureCoveringMinutes(minutes)}', { trigger:'length_hint' }); return false;">see what it unlocks</a>. You can still build this, you'll just be asked to upgrade before generating or saving it.`;
  hintEl.className = 'length-msg err';
}

/* ---------------- the lengths, as chips ----------------
   The slider is the whole range and always was; these are the five lengths
   people actually choose, sitting above it so the choice is a tap rather than a
   drag to a number. Every one of them is drawn for everybody — a free account
   sees 8 hours, muted, with a lock and the word RITUAL under it, because a
   length you cannot see is a length you cannot want.

   Which plan each one needs is not decided here. `featureForMinutes` finds the
   row in the feature table, and that row reads its tier off
   requiredTierForMinutes — the same function the slider's hint and the save
   check already use, so the chip, the hint and the save can never disagree. */
const DURATION_PRESETS = [20, 60, 120, 240, 480];
async function renderDurationChips(){
  const wrap = document.getElementById('durationChips');
  if (!wrap) return;
  const tier = currentUser ? await getMyTier() : 'none';
  wrap.innerHTML = DURATION_PRESETS.map(m =>
    `<button type="button" class="length-chip" data-minutes="${m}" onclick="pickDuration(${m})">${formatSessionLength(m)}</button>`
  ).join('') +
    `<button type="button" class="length-chip" data-custom="1" onclick="pickCustomDuration()">Custom<span>any length</span></button>`;
  wrap.querySelectorAll('[data-minutes]').forEach(chip => {
    const key = featureForMinutes(parseInt(chip.dataset.minutes, 10));
    if (key) lockedControl(chip, key, tier);
  });
  syncDurationChips();
}
/* Which chip is lit: the preset that matches the slider exactly, or Custom for
   any other number. Called on every drag, so it only moves a class. */
function syncDurationChips(){
  const wrap = document.getElementById('durationChips');
  if (!wrap) return;
  const minutes = state.targetLengthMinutes || parseInt(document.getElementById('sessionLengthSlider').value, 10);
  const exact = DURATION_PRESETS.includes(minutes);
  syncSelection('#durationChips .length-chip',
    c => c.dataset.custom ? !exact : parseInt(c.dataset.minutes, 10) === minutes);
}
/* Tapping a length past your plan does not move the slider and does not scold.
   It opens the one contextual sheet for that length and leaves the choice
   exactly where it was. */
async function pickDuration(minutes){
  const key = featureForMinutes(minutes);
  const tier = currentUser ? await getMyTier() : 'none';
  if (key && !tierHasFeature(tier, key)){
    openUpgradeModal(key, { tier, trigger: 'duration_chip' });
    return;
  }
  const slider = document.getElementById('sessionLengthSlider');
  slider.value = minutes;
  state.targetLengthMinutes = minutes;
  document.getElementById('sessionLengthVal').textContent = formatSessionLength(minutes);
  syncDurationChips();
  await updateSessionLengthHint();
  updateSessionTimerLabel();
}
/* ---------------- the premium layers, drawn as locked ----------------
   Tapping, visualization, the soothing pad, your own track and the second voice
   all stay on the screen for everybody. This is the one pass that marks whichever
   of them this account cannot reach yet, off the feature table — so the chip, its
   badge and the sheet it opens are all reading the same row.

   It runs when a step that holds one of them opens, because the plan can change
   under a page that is already loaded (a purchase in another tab, a restore). */
async function applyBuilderLocks(){
  const tier = currentUser ? await getMyTier() : 'none';
  const MODE_FEATURE = { eft:'eft', visualization:'visualization' };
  document.querySelectorAll('#ritualModeChips .length-chip').forEach(chip => {
    const key = MODE_FEATURE[chip.dataset.mode];
    if (key) lockedControl(chip, key, tier);
  });
  document.querySelectorAll('#soothingChips .length-chip').forEach(chip => {
    if (chip.dataset.variant !== 'none') lockedControl(chip, 'soothing_layer', tier);
  });
  lockSlot('lockSoothing', 'soothing_layer', tier);
  lockSlot('lockCustomTrack', 'custom_track', tier);
  lockSlot('lockLayerVoice', 'layer_voice', tier);
}

/* Custom is not a sixth length — it is the slider, which was already there. */
function pickCustomDuration(){
  syncSelection('#durationChips .length-chip', c => !!c.dataset.custom);
  document.getElementById('sessionLengthSlider').focus({ preventScroll: true });
}
/* The fewest lines a subliminal is built from. Five is enough for a loop to
   read as a practice rather than one sentence on repeat, and few enough that
   somebody who has five true things to say is not padding to reach a number.
   Two places have to agree with this and both do: the "how many affirmations"
   slider in index.html starts here, and this is the check for the review step,
   where lines can still be deleted after they have been generated. */
const MIN_AFFIRMATIONS = AffirmationKit.MIN_AFFIRMATIONS;
function affirmationShortfall(){
  /* EFT is a fixed round of lines, one per tapping point, and a visualization
     is a single script. Neither is a list anybody adds to, so neither is
     measured against this. */
  if (state.eftMode || state.visualizationMode) return 0;
  const have = state.affirmations.filter(a => String(a).trim().length > 0).length;
  return Math.max(0, MIN_AFFIRMATIONS - have);
}
function nextStep(serenityCleared){
  /* Before any plan check: a voice that cannot carry this many lines is a
     reason to stop, not something to pay for first. The lines are left alone. */
  if (step === 4){
    const problem = voiceLimitProblem();
    if (problem){ sayInVoicePicker(''); paintVoiceLimitNote(); return; }
  }
  if (step === 4 && serenityCleared !== true && selectedVoiceFromState() === VOICE_SERENITY){
    serenityAllowedToContinue().then(ok => { if (ok && step === 4) nextStep(true); });
    return;
  }
  if (step === 3){
    const msg = document.getElementById('affListMsg');
    const short = affirmationShortfall();
    if (short){
      if (msg){
        msg.textContent = `A subliminal is built from at least ${MIN_AFFIRMATIONS} affirmations — add ${short} more line${short === 1 ? '' : 's'}, or regenerate.`;
        msg.className = 'save-msg err';
      }
      return;
    }
    if (msg){ msg.textContent = ''; msg.className = 'save-msg'; }
  }
  /* THE BUG THIS LINE FIXES, because it caused both of the ones reported.

     Step 5 is the last screen before the flow forks: record your own lines
     (step 6) or go straight to assembly (step 7). `startNextPhase()` is the
     fork, and the Continue button called it -- but three other things on step 5
     called plain `nextStep()` instead, and plain `nextStep()` is step+1, which
     is step 6 unconditionally. Picking a background did it, and picking a
     background is the most ordinary thing anybody does on that screen.

     So somebody who chose Serenity tapped "Rain" and landed in the manual
     recorder. And because nothing routed them there, nothing had *prepared*
     them there either: showRecordLine() never ran, so the panel still held the
     literal "..." and a hard-coded count that sit in index.html as placeholders, and
     `recordings` was never sized to the affirmations. One missing fork, two
     bugs.

     step+1 is right for every other screen. From step 5 the only way on is the
     fork. */
  if (step === 5){ startNextPhase(); return; }
  showStep(step+1);
}
function prevStep(){ showStep(Math.max(0,step-1)); }
function resetFlow(){
  stopFinal();
  state = { freq:null, freqLayers:[], intention:null, goal:'', tone:null, intensity:'bold', count:5, affirmations:[], selectedVoice:null, voiceMode:null, aiVoiceId:null, bg:'none', bgLayer:'none', targetLengthMinutes:5, soothingLayer:'none', layerAffirmations:[], layerVoiceMode:null, layerAiVoiceId:null, affirmationGapMs:2400, pace:'steady', eftMode:false, visualizationMode:false, binauralBand:null, playerTitle:null };
  affirmationMode = 'generate';
  affirmationGenerateCount = 5;
  /* Clearing through the one helper rather than stripping the class by hand:
     that left every chip on the page still announcing itself as pressed. */
  clearSelection('.sel');
  /* Intensity is part of state too: leaving it out of the object above made it
     undefined after a reset, so a second build generated with no intensity at
     all and none of the three cards was lit. */
  paintIntensityCards();
  paintFrequencyUi();
  frequencyNote('');
  forgetVoiceChoice();
  paintVoiceCards();
  document.getElementById('quizGoal').value='';
  document.getElementById('toStep1').disabled = true;
  document.getElementById('toStep5').disabled = true;
  
  document.getElementById('sessionLengthSlider').value = 5;
  document.getElementById('sessionLengthVal').textContent = '5 min';
  renderDurationChips();
  syncSelectionByData('#soothingChips .length-chip', 'variant', state.soothingLayer);
  state.binauralBand = null;
  syncSelectionByData('#binauralChips .length-chip', 'band', 'none');
  stopAmbiencePreview();
  ambienceCandidate = null;
  paintBgCards();
  document.getElementById('binauralGuideText').style.display = 'none';
  document.getElementById('soothingMixRow').style.display = 'none';
  document.getElementById('soothingMsg').textContent = '';
  document.getElementById('lengthMsg').textContent = '';
  document.getElementById('sessionTarget').textContent = '';
  customTrackBlob = null;
  document.getElementById('customTrackName').textContent = '';
  document.getElementById('customTrackMsg').textContent = '';
  document.getElementById('customMixRow').style.display = 'none';
  /* The previous subliminal's own-voice takes, too -- a subliminal opened with
     Load & adjust leaves its recordings here, and a new one must not inherit them. */
  recordings = []; recordingLoadErrors = []; recIndex = 0;
  layerVoiceEnabled = false; layerVoiceMode = 'ai'; layerRecordings = []; recordTarget = 'primary';
  document.getElementById('layerVoiceToggle').checked = false;
  document.getElementById('layerVoicePanel').classList.remove('open');
  document.getElementById('layerAffText').value = '';
  document.getElementById('layerVoiceMsg').textContent = '';
  paintLayerVoiceOptions();
  document.getElementById('layerVoiceMixRow').style.display = 'none';
  affirmationPace = DEFAULT_PACE;
  setAffirmationGap(DEFAULT_GAP_SECONDS);
  renderPaceChips();
  document.getElementById('mixTone').value = 30; document.getElementById('mixToneVal').value = 30;
  document.getElementById('mixBg').value = 50; document.getElementById('mixBgVal').value = 50;
  document.getElementById('mixVoice').value = 65; document.getElementById('mixVoiceVal').value = 65;
  state.eftMode = false;
  state.visualizationMode = false;
  paintRitualModeChips();
  document.getElementById('eftGuidePanel').style.display = 'none';
  document.getElementById('visualizationGuidePanel').style.display = 'none';
  document.getElementById('ritualModeMsg').textContent = '';
  document.getElementById('countRow').style.display = 'block';
  /* Reset affirmation mode UI */
  selectAffirmationMode('generate');
  selectAffirmationCount(5);
  if (document.getElementById('affirmationPasteText')) document.getElementById('affirmationPasteText').value = '';
  if (document.getElementById('fileUploadMsg')) document.getElementById('fileUploadMsg').textContent = '';
  if (document.getElementById('affirmationFileInput')) document.getElementById('affirmationFileInput').value = '';
  switchAffirmationTab('paste');
  updateAffirmationButtonText();
  applyModeCopy('subliminal');
  const lengthQ = document.getElementById('sessionLengthRow');
  if (lengthQ) lengthQ.style.display = '';
  editingExistingId = null;
  restoreMixSettings(null, null);
  contentAlreadySaved = false;
  document.getElementById('finalTitleInput').value = '';
  document.getElementById('finalTitleMsg').textContent = '';
  document.getElementById('finalTitleInput').classList.remove('needs-title');
  showStep(0);
}

/* ---- step 0: frequency ----
   Up to four tones can be layered. The answer is state.freqLayers -- an ordered
   list of { hz, vol } -- and state.freq stays what it always was, the first of
   them, because the saved row's frequency_hz column, the title and the older
   screens read that. Every card, chip and slider on every screen is drawn from
   the list (paintFrequencyUi), never from the tap that changed it. */
const FREQ_HZ_LIST = FREQS.map(f => f.hz);
const freqChips = document.getElementById('freqChips');
function frequencyByHz(hz){ return FREQS.find(f => f.hz === hz) || null; }
/* Which cards are lit, derived from state.freqLayers. */
function paintFreqCards(){
  const chosen = new Set((state.freqLayers || []).map(l => String(l.hz)));
  const full = chosen.size >= FrequencyLayers.MAX_FREQUENCY_LAYERS;
  syncSelection('#freqChips .freq-card3', el => chosen.has(el.dataset.hz));
  document.querySelectorAll('#freqChips .freq-card3').forEach(el => {
    const on = chosen.has(el.dataset.hz);
    const badge = el.querySelector('.fc-order');
    const idx = (state.freqLayers || []).findIndex(l => String(l.hz) === el.dataset.hz);
    if (badge) badge.textContent = on ? String(idx + 1) : '';
    // A fifth tone is refused with a message, so the card says so as well.
    el.setAttribute('aria-disabled', (!on && full) ? 'true' : 'false');
    el.classList.toggle('fc-locked', !on && full);
  });
}
FREQS.forEach(f=>{
  const c = document.createElement('button'); c.className='freq-card3';
  c.type = 'button';
  c.dataset.hz = f.hz;
  c.setAttribute('role', 'checkbox');
  c.setAttribute('aria-checked', 'false');
  c.innerHTML = `<span class="fc-order" aria-hidden="true"></span><div class="hz">${f.hz} Hz</div><div class="word">${f.word}</div>`;
  c.onclick = ()=>{ toggleFrequency(f.hz, { source:'builder' }); };
  freqChips.appendChild(c);
});
paintFreqCards();

/* ---- the frequency layers: one model, every screen ---- */
const frequencyMixer = new FrequencyLayers.FrequencyMixer();
function frequencyLayerList(){ return Array.isArray(state.freqLayers) ? state.freqLayers : []; }
function frequencyLabel(){
  const layers = frequencyLayerList();
  if (!layers.length) return 'none';
  return layers.map(l => { const f = frequencyByHz(l.hz); return f ? `${f.hz} Hz, ${f.word}` : `${l.hz} Hz`; }).join(' + ');
}
/* "528 Hz · renewal", or "528 + 432 Hz · renewal + harmony" for a stack. */
function frequencyTitle(){
  const layers = frequencyLayerList();
  if (!layers.length) return '';
  const words = layers.map(l => (frequencyByHz(l.hz) || {}).word).filter(Boolean);
  return `${layers.map(l => l.hz).join(' + ')} Hz · ${words.join(' + ')}`;
}
function frequencyNote(msg){
  document.querySelectorAll('[data-fl-note]').forEach(el => { el.textContent = msg || ''; });
}
/* The single place the layer list is written. It keeps state.freq in step with
   it, redraws every screen that shows it, hands the change to the live engine
   (which fades, never jumps) and queues the save for a subliminal that has one. */
function setFrequencyLayers(layers, opts){
  const o = opts || {};
  state.freqLayers = FrequencyLayers.normalizeFrequencyLayers(layers, FREQ_HZ_LIST);
  state.freq = state.freqLayers.length ? frequencyByHz(state.freqLayers[0].hz) : null;
  const next = document.getElementById('toStep1');
  if (next) next.disabled = !state.freqLayers.length;
  paintFrequencyUi();
  applyFrequencyToEngine();
  const title = document.getElementById('finalTitle');
  if (title) title.textContent = frequencyTitle();
  if (!o.silent && typeof queueMixSave === 'function') queueMixSave();
  if (typeof renderPlayerSelectionState === 'function') renderPlayerSelectionState();
  if (typeof paintAudioEditor === 'function') paintAudioEditor();
}
function toggleFrequency(hz, opts){
  const r = FrequencyLayers.toggleFrequencyLayer(frequencyLayerList(), hz);
  if (!r.changed){
    frequencyNote(`You can layer up to ${FrequencyLayers.MAX_FREQUENCY_LAYERS} frequencies. Remove one to add ${hz} Hz.`);
    return false;
  }
  frequencyNote('');
  const f = frequencyByHz(hz);
  if (r.action === 'added' && f){
    const guide = document.getElementById('freqGuideText');
    if (guide) guide.textContent = '"' + f.guide + '"';
  }
  setFrequencyLayers(r.layers, opts);
  return true;
}
function removeFrequency(hz){
  frequencyNote('');
  setFrequencyLayers(FrequencyLayers.removeFrequencyLayer(frequencyLayerList(), hz));
}
function setFrequencyVolume(hz, vol){
  state.freqLayers = FrequencyLayers.setFrequencyLayerVolume(frequencyLayerList(), hz, vol);
  /* Move the readout and the warning in place. Rebuilding the rows here would
     tear down the slider that is being dragged. */
  const v = FrequencyLayers.normalizeFrequencyLayers(state.freqLayers).find(l => l.hz === hz);
  document.querySelectorAll(`[data-fl-vol="${hz}"]`).forEach(el => {
    if (document.activeElement !== el || el.value !== String(v.vol)) el.value = v.vol;
    el.setAttribute('aria-valuetext', v.vol + ' percent');
  });
  document.querySelectorAll(`[data-fl-out="${hz}"]`).forEach(el => { el.textContent = v.vol + '%'; });
  paintFrequencyWarnings();
  applyFrequencyToEngine();
  if (typeof queueMixSave === 'function') queueMixSave();
  if (typeof paintAudioEditor === 'function') paintAudioEditor();
}
function frequencyMixInputs(){
  const num = id => { const el = document.getElementById(id); return el ? Number(el.value) : undefined; };
  return { master: num('mixTone'), voice: num('mixVoice') };
}
function paintFrequencyWarnings(){
  const warns = FrequencyLayers.assessFrequencyMix(frequencyLayerList(), frequencyMixInputs());
  document.querySelectorAll('[data-fl-warn]').forEach(el => {
    const text = warns.map(w => w.message).join(' ');
    el.textContent = text;
    el.hidden = !text;
  });
  return warns;
}
function frequencyRowsMarkup(){
  const layers = frequencyLayerList();
  if (!layers.length) return '<p class="fl-empty">No frequency chosen yet.</p>';
  return `<ul class="fl-list" aria-label="Chosen frequencies">${layers.map(l => {
    const f = frequencyByHz(l.hz) || { hz:l.hz, word:'' };
    return `<li class="fl-row" data-hz="${l.hz}">
      <span class="fl-name"><b>${f.hz} Hz</b><small>${f.word}</small></span>
      <input type="range" min="0" max="100" value="${l.vol}" data-fl-vol="${l.hz}" aria-label="${f.hz} Hz volume" aria-valuetext="${l.vol} percent"
             oninput="setFrequencyVolume(${l.hz}, this.value)">
      <output data-fl-out="${l.hz}" aria-hidden="true">${l.vol}%</output>
      <button type="button" class="fl-remove" onclick="removeFrequency(${l.hz})" aria-label="Remove ${f.hz} Hz">&times;</button>
    </li>`;
  }).join('')}</ul>`;
}
/* Draws every frequency tray on the page. A tray is any element carrying
   data-fl-panel. The rows are rebuilt only when the chosen set changed. */
function paintFrequencyUi(){
  const layers = frequencyLayerList();
  const signature = layers.map(l => l.hz).join(',');
  document.querySelectorAll('[data-fl-panel]').forEach(panel => {
    if (panel.dataset.flSig !== signature){
      panel.dataset.flSig = signature;
      panel.innerHTML = `<div class="fl-rows">${frequencyRowsMarkup()}</div>
        <p class="fl-count" role="status">${layers.length} of ${FrequencyLayers.MAX_FREQUENCY_LAYERS} frequencies</p>
        <p class="fl-note" data-fl-note role="status"></p>
        <p class="fl-warn" data-fl-warn role="status" hidden></p>`;
    } else {
      panel.querySelectorAll('[data-fl-vol]').forEach(el => {
        const l = layers.find(x => String(x.hz) === el.dataset.flVol);
        if (l && document.activeElement !== el) el.value = l.vol;
      });
      panel.querySelectorAll('[data-fl-out]').forEach(el => {
        const l = layers.find(x => String(x.hz) === el.dataset.flOut);
        if (l) el.textContent = l.vol + '%';
      });
      const count = panel.querySelector('.fl-count');
      if (count) count.textContent = `${layers.length} of ${FrequencyLayers.MAX_FREQUENCY_LAYERS} frequencies`;
    }
  });
  const chosen = new Set(layers.map(l => String(l.hz)));
  const full = layers.length >= FrequencyLayers.MAX_FREQUENCY_LAYERS;
  document.querySelectorAll('[data-fl-chips]').forEach(box => {
    if (!box.dataset.flBuilt){
      box.dataset.flBuilt = '1';
      const cls = box.dataset.flChips || 'fl-chip';
      box.innerHTML = FREQS.map(f => `<button type="button" class="${cls}" role="checkbox" aria-checked="false" data-hz="${f.hz}" onclick="toggleFrequency(${f.hz})"><b>${f.hz} Hz</b><small>${f.word}</small></button>`).join('');
    }
    const btns = box.querySelectorAll('button');
    syncSelection(btns, el => chosen.has(el.dataset.hz));
    btns.forEach(el => el.setAttribute('aria-disabled', (!chosen.has(el.dataset.hz) && full) ? 'true' : 'false'));
  });
  paintFreqCards();
  paintFrequencyWarnings();
  const sel = document.getElementById('finalFreqPicker');
  if (sel) sel.style.display = layers.length ? 'block' : 'none';
  if (typeof syncListeningMix === 'function') syncListeningMix();
}
/* The live engine follows the list. Called on every change and a no-op while
   nothing is playing (Play builds the tones from the same list). */
function applyFrequencyToEngine(){
  if (!finalPlaying || !frequencyMixer.attached) return;
  frequencyMixer.sync(state.freqLayers, { band: currentBinauralBand() });
}
function currentBinauralBand(){
  return state.binauralBand && BINAURAL_BANDS[state.binauralBand] ? { hz: BINAURAL_BANDS[state.binauralBand].hz } : null;
}

/* ---- step 1: quiz ---- */
const intentionChips = document.getElementById('intentionChips');
function paintIntentionChips(){ syncSelectionByData('#intentionChips .chip', 'key', state.intention); }
INTENTIONS.forEach(([k,label])=>{
  const c = document.createElement('button'); c.className='chip'; c.textContent = label;
  c.dataset.key = k; c.setAttribute('role', 'radio');
  c.onclick = ()=>{ state.intention = k; paintIntentionChips(); };
  intentionChips.appendChild(c);
});
paintIntentionChips();

// Intensity cards
const intensityData = [
  { id: 'grounded', label: 'Grounded', description: 'Believable, supportive affirmations that still feel within reach.' },
  { id: 'bold', label: 'Bold', description: 'Big, confident affirmations that stretch what feels possible.' },
  { id: 'delusional', label: 'Delusional ✦', description: 'Dream-life energy. Wildly ambitious, unapologetic, and larger than life.' }
];
const intensityCards = document.getElementById('intensityCards');
function paintIntensityCards(){ syncSelectionByData('#intensityCards .intensity-card', 'intensity', state.intensity); }
intensityData.forEach(item => {
  const card = document.createElement('button');
  card.className = 'intensity-card';
  card.type = 'button';
  card.setAttribute('data-intensity', item.id);
  card.setAttribute('role', 'radio');
  card.setAttribute('aria-checked', state.intensity === item.id);
  card.innerHTML = `<h5>${item.label}</h5><p class="intensity-label">Intensity</p><p>${item.description}</p>`;
  card.onclick = () => {
    state.intensity = item.id;
    paintIntensityCards();
  };
  intensityCards.appendChild(card);
});
paintIntensityCards();

const toneChips = document.getElementById('toneChips');
function paintToneChips(){ syncSelectionByData('#toneChips .chip', 'key', state.tone); }
[["gentle","Gentle & nurturing"],["bold","Bold & direct"],["calm","Calm & neutral"]].forEach(([k,label])=>{
  const c = document.createElement('button'); c.className='chip'; c.textContent=label;
  c.dataset.key = k; c.setAttribute('role', 'radio');
  c.onclick=()=>{ state.tone = k; paintToneChips(); };
  toneChips.appendChild(c);
});
paintToneChips();
const countRange = document.getElementById('countRange');
countRange.addEventListener('input', ()=>{ selectAffirmationCount(parseInt(countRange.value, 10), { fromRange: true }); });

/* ---- Ritual-only: subliminal + EFT tapping mode ---- */
const eftPointsList = document.getElementById('eftPointsList');
// Skip index 0 (the Setup Statement) here — it's described separately above the list.
// This shows the 9-point round: Karate Chop -> ... -> Karate Chop again.
EFT_LINE_POINTS.forEach((p, i) => {
  const li = document.createElement('li');
  li.innerHTML = `<b>${p.label}</b> — ${p.where}`;
  eftPointsList.appendChild(li);
});
/* Which mode is lit, off the two booleans that actually decide the build. */
function currentRitualMode(){
  if (state.eftMode) return 'eft';
  if (state.visualizationMode) return 'visualization';
  return 'subliminal';
}
function paintRitualModeChips(){
  syncSelectionByData('#ritualModeChips .length-chip', 'mode', currentRitualMode());
}
async function pickRitualMode(btn){
  const msg = document.getElementById('ritualModeMsg');
  const mode = btn.dataset.mode;
  msg.textContent = '';
  /* Both of these are Ritual features, and both stay tappable for everybody:
     the tap is how somebody asks what they are, and the sheet answers with what
     the mode is for rather than with a price. The mode itself is not selected,
     so nothing about the session changes behind the explanation. */
  if (mode === 'eft' || mode === 'visualization'){
    const myTier = currentUser ? await getMyTier() : 'none';
    if (!tierHasFeature(myTier, mode)){
      openUpgradeModal(mode, { tier: myTier, trigger: 'mode_chip' });
      return;
    }
  }
  state.eftMode = (mode === 'eft');
  state.visualizationMode = (mode === 'visualization');
  paintRitualModeChips();
  document.getElementById('eftGuidePanel').style.display = state.eftMode ? 'block' : 'none';
  document.getElementById('visualizationGuidePanel').style.display = state.visualizationMode ? 'block' : 'none';
  document.getElementById('countRow').style.display = (state.eftMode || state.visualizationMode) ? 'none' : 'block';
  applyModeCopy(mode);

  if (state.eftMode){
    state.count = EFT_LINE_COUNT;
    // EFT works best with a real pause to repeat the line while tapping — default to 5s.
    setAffirmationGap(5);
    /* No length is set for tapping. You are not deciding in advance how long a
       round will take you; the round comes back round for as long as you stay,
       and you stop when you are done. */
    state.targetLengthMinutes = 0;
  } else if (state.visualizationMode){
    state.count = 1; // one continuous script, not discrete lines
    setAffirmationGap(1.5);
  } else {
    state.count = affirmationGenerateCount;
    setAffirmationGap(DEFAULT_GAP_SECONDS);
  }
  // The length question is not asked for tapping, so it comes off the screen
  // rather than sitting there greyed out.
  const lengthQ = document.getElementById('sessionLengthRow');
  if (lengthQ) lengthQ.style.display = state.eftMode ? 'none' : '';
  answered(btn);
}
/* ---------------- starting a premium session from outside the builder ----------------
   The Science page explains tapping and visualization scripting and then has to
   offer a way in. Both are Ritual modes, so both cards do one of two things: on
   Ritual they open the builder already in that mode with the theme sitting in
   the prompt, and on anything else they open the sheet that says what the mode
   is for. What they never do is nothing.

   The mode is applied when step 1 opens rather than now: the mode chips live on
   step 1, and selecting one while it is off screen scrolls a hidden element and
   skips the frequency the session still needs. */
let pendingRitualMode = null;
async function startPremiumSession(mode, seed){
  const tier = currentUser ? await getMyTier() : 'none';
  if (!tierHasFeature(tier, mode)){
    openUpgradeModal(mode, { tier, trigger: 'session_category' });
    return;
  }
  showBuildPage();
  resetFlow();
  showStep(0);
  pendingRitualMode = mode;
  const goal = document.getElementById('quizGoal');
  if (goal) goal.value = seed || '';
}

/* ---------------- the session categories on the Science page ----------------
   Starting points, not a second catalog: each one is a line of prompt text the
   builder would have asked for anyway. Everybody sees all of them; the lock and
   the badge are what change with the plan. */
const SESSION_CATEGORIES = {
  eft: [
    { title:'Release Anxiety',  body:'Name the worry out loud and tap the charge out of it, point by point.',
      seed:'I want to stop feeling anxious about everything I cannot control, and trust that I can handle what actually arrives.' },
    { title:'Self Worth',       body:'The setup statement most people need first: even though this is here, I accept myself.',
      seed:'I want to stop measuring my worth by what I produce, and believe I am enough as I already am.' },
    { title:'Abundance',        body:'For the tightness that shows up around money before any number does.',
      seed:'I want to release the fear I feel around money and believe there is more than enough coming to me.' },
    { title:'Confidence',       body:'For the moment before the thing — the room, the call, the conversation.',
      seed:'I want to walk into rooms without shrinking, and trust that I belong wherever I have been invited.' },
  ],
  visualization: [
    { title:'Dream Life',       body:'An ordinary Tuesday in the life you are building. The details are the point.',
      seed:'It is an ordinary Tuesday morning a year from now. Describe where I wake up, what the light is like, what I do first, and how it feels to be this version of me.' },
    { title:'Confidence',       body:'Rehearse the moment in first-hand detail so the real one feels familiar.',
      seed:'I walk into the room where I have to speak. Describe what I see, what I hear, how steady my hands are, and how it goes.' },
    { title:'Love',             body:'The relationship as it actually feels day to day, not as a wish.',
      seed:'Describe an evening with the person I am calling in — what we talk about, how safe it feels, what we do at the end of the night.' },
    { title:'Abundance',        body:'What it is like to stop checking, and simply have enough.',
      seed:'Describe the morning I stop checking my balance before I do anything else, and what I do with the room that gives me.' },
    { title:'Career',           body:'The work, the room, and the moment it lands.',
      seed:'Describe the day the work I have been building is recognised — where I am, who tells me, and what I feel in my chest when they do.' },
    { title:'Custom Visualization', body:'A blank page. Write the scene entirely yourself.', seed:'' },
  ],
};
async function renderSessionCategories(){
  const tier = currentUser ? await getMyTier() : 'none';
  [['eft','eftCategoryGrid'], ['visualization','visualizationCategoryGrid']].forEach(([mode, id]) => {
    const host = document.getElementById(id);
    if (!host) return;
    const locked = !tierHasFeature(tier, mode);
    host.innerHTML = SESSION_CATEGORIES[mode].map(c => lockedCard(mode, {
      title: c.title,
      body: c.body,
      locked,
      openLabel: 'Start',
      trigger: 'session_category',
      onOpen: `startPremiumSession('${mode}', ${JSON.stringify(c.seed)})`,
    })).join('');
  });
}

/* Swaps the quiz-step copy (prompt label, generate button, loading/review titles)
   to match whichever of the three modes is active. */
function applyModeCopy(mode){
  const goalLabel = document.getElementById('quizGoalLabel');
  const generateBtn = document.getElementById('generateBtn');
  const regenerateBtn = document.getElementById('regenerateBtn');
  const loadingTitle = document.getElementById('loadingTitle');
  const loadingSub = document.getElementById('loadingSub');
  const reviewTitle = document.getElementById('reviewTitle');
  const reviewSub = document.getElementById('reviewSub');
  if (mode === 'visualization'){
    goalLabel.textContent = 'Describe your desire — and the moment you would know it had become real';
    document.getElementById('quizGoal').placeholder = 'e.g. I receive the message that the opportunity is mine. My sister is beside me, I read it twice, and I finally feel the relief of knowing the work mattered...';
    generateBtn.textContent = 'Continue to my script ✦';
    regenerateBtn.textContent = '↻ Get a new draft';
    loadingTitle.textContent = 'Turning your desire into a scene…';
    loadingSub.textContent = 'Writing a future memory you can step inside.';
    reviewTitle.textContent = 'Your visualization script';
    reviewSub.textContent = 'Write it yourself, edit the draft, or both — this is entirely yours.';
  } else if (mode === 'eft'){
    goalLabel.textContent = 'Describe what you want, in your own words';
    document.getElementById('quizGoal').placeholder = "e.g. I want to feel less anxious about money and actually believe I'm capable of building something stable...";
    generateBtn.textContent = 'Generate my affirmations ✦';
    regenerateBtn.textContent = '↻ Regenerate';
    loadingTitle.textContent = 'Writing your affirmations…';
    loadingSub.textContent = 'Shaping them around what you told us.';
    reviewTitle.textContent = 'Your affirmations';
    reviewSub.textContent = 'See every line before it\'s ever recorded or played. Edit or remove anything.';
  } else {
    goalLabel.textContent = 'Describe what you want, in your own words';
    document.getElementById('quizGoal').placeholder = "e.g. I want to feel less anxious about money and actually believe I'm capable of building something stable...";
    generateBtn.textContent = 'Generate my affirmations ✦';
    regenerateBtn.textContent = '↻ Regenerate';
    loadingTitle.textContent = 'Writing your affirmations…';
    loadingSub.textContent = 'Shaping them around what you told us.';
    reviewTitle.textContent = 'Your affirmations';
    reviewSub.textContent = 'See every line before it\'s ever recorded or played. Edit or remove anything.';
  }
}


/* ---------------- AFFIRMATION GENERATION ---------------- */
async function generateAffirmations(){
  /* Handle import mode first — if user pasted affirmations, use those */
  if (affirmationMode === 'import'){
    if (handleAffirmationInputBeforeGenerate()) return;
    const msg = document.getElementById('fileUploadMsg') || document.getElementById('affListMsg');
    if (msg){
      msg.textContent = 'Please paste affirmations or upload a file.';
      msg.className = 'save-msg err';
    }
    return;
  }

  const msg = document.getElementById('lengthMsg');
  const minutes = state.targetLengthMinutes || parseInt(document.getElementById('sessionLengthSlider').value, 10);
  const requiredTier = requiredTierForMinutes(minutes);
  if (requiredTier !== 'none'){
    if (!currentUser){
      msg.innerHTML = `${formatSessionLength(minutes)} needs an account — <a href="#" onclick="openAuthModal('signup'); return false;">create a free account</a> first.`;
      msg.className = 'length-msg err';
      return;
    }
    const myTier = await getMyTier();
    if (!tierAtLeast(myTier, requiredTier)){
      msg.innerHTML = `${formatSessionLength(minutes)} needs ${TIER_LABEL[requiredTier]} or higher — or drag the slider back down to build at your current plan.`;
      msg.className = 'length-msg err';
      openUpgradeModal(featureCoveringMinutes(minutes), { tier: myTier, trigger: 'generate_blocked' });
      return;
    }
  }
  msg.textContent = '';

  state.goal = document.getElementById('quizGoal').value.trim();
  state.count = state.eftMode ? EFT_LINE_COUNT : (state.visualizationMode ? 1 : affirmationGenerateCount);
  showStep(2);

  /* The words these lines come back in are the ones chosen in Settings, so the
     answer has to be in hand before anything is asked for. Today and the
     profile page both load it, but somebody who opened the builder straight
     from a link has been through neither -- and a missing answer is
     indistinguishable from the neutral one, so it would have gone unnoticed. */
  if (typeof ensureFaith === 'function') await ensureFaith();

  if (state.visualizationMode){
    // Nothing typed in the prompt = blank page, write it entirely yourself.
    // Something typed = get a full draft to rewrite, trim, or keep.
    if (!state.goal){
      state.affirmations = [''];
    } else {
      let script = null;
      try{ script = await callClaudeForVisualizationScript(); }catch(err){ script = null; }
      state.affirmations = [script || buildVisualizationFallback()];
    }
    renderAffList();
    showStep(3);
    return;
  }

  let lines = null;
  try{ lines = state.eftMode ? await callClaudeForEftAffirmations() : await callClaudeForAffirmations(); }catch(err){ lines = null; }
  if (!lines || !lines.length) lines = state.eftMode ? buildEftFallbackList() : buildFallbackList();
  state.affirmations = lines.slice(0, state.count);
  renderAffList();
  showStep(3);
}
/* What the three generating endpoints are told about the saved faith answer:
   the id, and for 'other' the word this person typed for what they reach
   toward. The framing itself is written server-side, in lib/faith-language.js
   -- the browser sends which answer it is, never the language to use. */
function faithForGenerator(){
  if (typeof myFaith === 'undefined' || !myFaith || !myFaith.id) return {};
  return { faith: myFaith.id, faithWord: myFaith.id === 'other' ? (myFaith.own || null) : null };
}
async function callClaudeForAffirmations(){
  const toneLabel = {gentle:"gentle and nurturing", bold:"bold and direct", calm:"calm and neutral"}[state.tone] || "warm";
  const freqLabel = state.freq ? frequencyLabel() : 'none';
  const response = await fetch(API_BASE + "/api/generate-affirmations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: state.count, freqLabel, toneLabel, goal: state.goal, intensity: state.intensity, ...faithForGenerator() })
  });
  if (!response.ok) return null;
  const data = await response.json();
  return Array.isArray(data.affirmations) ? data.affirmations : null;
}
/* Builds the 11-line EFT structure: setup statement (from setupFeeling), then the
   10-tap round (Karate Chop, 8 core points including Top of Head, Karate Chop again —
   the kcReminder line
   is reused for both the opening and closing tap). Hits its own endpoint so it never
   touches /api/generate-affirmations, which the regular flow still uses untouched. */
async function callClaudeForEftAffirmations(){
  const toneLabel = {gentle:"gentle and nurturing", bold:"bold and direct", calm:"calm and neutral"}[state.tone] || "warm";
  const freqLabel = state.freq ? frequencyLabel() : 'none';
  const response = await fetch(API_BASE + "/api/generate-eft-affirmations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: state.goal, toneLabel, freqLabel, ...faithForGenerator() })
  });
  if (!response.ok) return null;
  const data = await response.json();
  /* The endpoint used to return one feeling and one reused Karate Chop line.
     It returns two feelings now, and nine reminders instead of eight, because
     the cycle gained the forehead and lost the closing Karate Chop. An older
     deployment that still answers the old shape is handled rather than
     rejected -- a stale function should cost the second setup line, not the
     whole session. */
  if (!data) return null;
  const nine = Array.isArray(data.pointReminders) ? data.pointReminders : null;
  const feelingA = data.feelingA || data.setupFeeling;
  if (!feelingA || !nine || nine.length < 8) return null;
  return eftLinesFrom({
    feelingA,
    feelingB: data.feelingB || 'the weight of carrying it on my own',
    pointReminders: nine,
  });
}
function buildFallbackList(){
  const bank = FALLBACK_BANK[state.intention] || FALLBACK_BANK.sleep;
  let lines = [...bank];
  if (state.goal){
    const short = state.goal.length>60 ? state.goal.slice(0,60)+'…' : state.goal;
    lines.push(`What I named tonight — "${short}" — is already softening.`);
  }
  if (state.tone==='bold') lines.push("I don't wait for permission to feel this way.");
  if (state.tone==='gentle') lines.push("I am patient with however tonight goes.");
  if (state.tone==='calm') lines.push("I don't need to force any of this.");
  /* Up to a hundred lines can be asked for and this is what answers when the
     writer cannot be reached, so it has to make a hundred *different* ones: every
     wrapper is tried on every base line once, in turn, and nothing repeats. */
  const wrappers = [
    "Tonight, I remember: %s","Quietly, I know this: %s","Even now, %s","It's simple: %s",
    "Today, I let it be true: %s","With every breath, %s","I give myself permission: %s","Right here, right now, %s",
    "I am learning that %s","In my own time, %s","I choose to believe that %s","Deep down, I know that %s",
    "Each morning, %s","Without effort, %s","I notice how %s","All the way through, %s",
    "I allow it to be so: %s","More and more, %s","Gently, %s","As I rest, %s",
  ];
  const seen = new Set(lines.map(l => l.toLowerCase()));
  for (const wrap of wrappers){
    for (const base of bank){
      if (lines.length >= state.count) break;
      const line = wrap.replace('%s', base.replace(/\.$/,'').toLowerCase());
      if (!seen.has(line.toLowerCase())){ seen.add(line.toLowerCase()); lines.push(line); }
    }
    if (lines.length >= state.count) break;
  }
  return lines.slice(0, state.count);
}
/* Offline fallback for EFT mode if the API call fails — same 11-line shape, generic
   but usable, built entirely client-side. Every line is a full sentence, matching how
   real EFT scripts read (not clipped phrases). */
function buildEftFallbackList(){
  /* Whatever goes here follows the word "feel", so it has to read as a feeling
     and not as a noun: "even though I feel this feeling" is not a sentence. */
  const feeling = state.goal
    ? (state.goal.length > 50 ? state.goal.slice(0,50)+'…' : state.goal)
    : 'this way about it';
  return eftLinesFrom({
    feelingA: feeling,
    feelingB: 'the weight of carrying it on my own',
    pointReminders: [
      "I am releasing this, one breath at a time.",
      "I'm allowed to let this go.",
      "It's safe for me to feel calm right now.",
      "I choose to soften instead of holding on.",
      "This doesn't have to stay with me.",
      "I am capable of moving through this.",
      "I am already easing, even now.",
      "I am settling into this moment as it is.",
      "I am steady, and I am here.",
    ],
  });
}
/* One place that knows the shape of a round, so the written script and the
   generated one can never drift apart. Nine reminders: forehead through crown. */
function eftLinesFrom(parts){
  const nine = (parts.pointReminders || []).slice(0, 9);
  while (nine.length < 9) nine.push('I am steady, and I am here.');
  return [
    EFT_OPENING_LINE,
    `Even though I feel ${parts.feelingA}, I still completely love and accept myself.`,
    `Even though I feel ${parts.feelingB}, I still completely love and honor myself.`,
    ...nine,
    EFT_CLOSING_LINE,
  ];
}

/* Ritual-only: a full narrative visualization script, written in second person
   present tense, built from whatever the person typed in the prompt. This is meant to
   be a starting draft — the review step gives them one large, freely-editable box, so
   whatever comes back here is just raw material for them to rewrite. */
async function callClaudeForVisualizationScript(){
  const toneLabel = {gentle:"gentle and nurturing", bold:"bold and direct", calm:"calm and neutral"}[state.tone] || "warm";
  const freqLabel = state.freq ? frequencyLabel() : 'none';
  const response = await fetch(API_BASE + "/api/generate-visualization-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: state.goal, toneLabel, freqLabel, ...faithForGenerator() })
  });
  if (!response.ok) return null;
  const data = await response.json();
  return (data && typeof data.script === 'string' && data.script.trim()) ? data.script.trim() : null;
}
/* Offline fallback if that call fails — generic but usable, built entirely client-side. */
function buildVisualizationFallback(){
  const goal = state.goal || 'the moment you\'ve been working toward';
  return `You are standing right at the edge of it — ${goal}. Take a slow breath in, and notice how steady you feel.\n\nYour body already knows what to do here. Every rep, every rehearsal, every quiet hour you put in is right here with you now, backing you up. You feel calm, focused, and completely ready.\n\nAs it unfolds exactly the way you pictured it, notice how natural it feels. Not forced — just you, doing the thing you were always capable of.\n\nAnd when it's done, you feel that unmistakable click of knowing: this is who you are.`;
}

/* ---------------- review/edit ----------------
   Up to AffirmationKit.MAX_AFFIRMATIONS (100) lines can be written here. Which of
   them a voice can carry is decided later, on the voice screen: Record Your Own
   Voice takes all 100, Serenity and Clone Your Voice take 10. Nothing on this
   screen or the next deletes a line because of the voice picked -- see
   voiceLimitProblem(). */
let importTrimNote = '';
/* Pasted or uploaded text -> lines. A list longer than the most any subliminal
   holds is cut at that number, and the cut is announced (importTrimNote), not
   hidden. */
function importAffirmations(text){
  const all = parseAffirmationsFromText(text);
  const max = AffirmationKit.MAX_AFFIRMATIONS;
  if (all.length > max){
    importTrimNote = `Your list had ${all.length} lines. The first ${max} were added, because ${max} is the most one subliminal holds. Nothing else was changed.`;
    return all.slice(0, max);
  }
  importTrimNote = '';
  return all;
}
function nonEmptyAffirmationCount(){ return (state.affirmations || []).filter(a => String(a).trim().length > 0).length; }
function paintAffirmationCount(){
  const el = document.getElementById('affCount');
  if (!el) return;
  const n = state.affirmations.length;
  const max = AffirmationKit.MAX_AFFIRMATIONS;
  el.textContent = state.eftMode || state.visualizationMode ? '' : AffirmationKit.countLabel(n, max) + ' affirmations';
  const hint = document.getElementById('affCountHint');
  if (hint){
    hint.textContent = state.eftMode || state.visualizationMode ? '' : (n > AffirmationKit.AFFIRMATION_LIMITS.serenity
      ? `Record Your Own Voice reads up to ${AffirmationKit.AFFIRMATION_LIMITS.own}. Serenity and Clone Your Voice read up to ${AffirmationKit.AFFIRMATION_LIMITS.serenity}, so with this many you will want your own voice.`
      : `Up to ${AffirmationKit.AFFIRMATION_LIMITS.own} with Record Your Own Voice, ${AffirmationKit.AFFIRMATION_LIMITS.serenity} with Serenity or Clone Your Voice.`);
  }
  const add = document.getElementById('addAffBtn');
  if (add) add.disabled = n >= max;
}
function renderAffList(){
  const list = document.getElementById('affList'); list.innerHTML='';
  const fixedShape = state.eftMode || state.visualizationMode;
  state.affirmations.forEach((line,i)=>{
    const row = document.createElement('div'); row.className='aff-row';
    if (state.visualizationMode) row.classList.add('aff-row-script');
    const num = document.createElement('div'); num.className='num';
    if (state.visualizationMode){
      num.textContent = 'Your script';
    } else {
      num.textContent = state.eftMode && EFT_LINE_POINTS[i] ? (i+1)+'. '+EFT_LINE_POINTS[i].label : (i+1)+'.';
    }
    const ta = document.createElement('textarea'); ta.value=line;
    ta.setAttribute('aria-label', `Affirmation ${i+1}`);
    if (state.visualizationMode){
      ta.rows = 12;
      ta.placeholder = 'Write it however you want — as detailed as you can. This is entirely yours.';
      ta.oninput = ()=>{ state.affirmations[i]=ta.value; ta.style.height='auto'; ta.style.height=(ta.scrollHeight+4)+'px'; };
      setTimeout(()=>{ ta.style.height='auto'; ta.style.height=(ta.scrollHeight+4)+'px'; }, 0);
    } else {
      ta.rows = 1;
      ta.oninput = ()=>{ state.affirmations[i]=ta.value; };
    }
    row.appendChild(num); row.appendChild(ta);
    if (!fixedShape){
      // Reordering and removing would break the one-line-per-tapping-point
      // mapping, so both are left out in EFT mode, where the count stays at eleven.
      const mk = (cls, label, text, onclick, disabled) => {
        const b = document.createElement('button'); b.type='button'; b.className=cls; b.textContent=text;
        b.setAttribute('aria-label', label); b.disabled = !!disabled; b.onclick = onclick; return b;
      };
      const tools = document.createElement('div'); tools.className = 'aff-tools';
      tools.appendChild(mk('aff-move', `Move affirmation ${i+1} up`, '↑', () => moveAffirmation(i, -1), i === 0));
      tools.appendChild(mk('aff-move', `Move affirmation ${i+1} down`, '↓', () => moveAffirmation(i, 1), i === state.affirmations.length-1));
      tools.appendChild(mk('aff-remove', `Remove affirmation ${i+1}`, '✕', ()=>{ state.affirmations.splice(i,1); renderAffList(); }));
      row.appendChild(tools);
    }
    list.appendChild(row);
  });
  document.getElementById('addAffBtn').style.display = fixedShape ? 'none' : '';
  paintAffirmationCount();
  // Once there are enough lines again, stop saying there aren't.
  const listMsg = document.getElementById('affListMsg');
  if (listMsg && importTrimNote){ listMsg.textContent = importTrimNote; listMsg.className = 'save-msg'; importTrimNote = ''; }
  else if (listMsg && !affirmationShortfall()){ listMsg.textContent = ''; listMsg.className = 'save-msg'; }
}
function addAffirmation(){
  const max = AffirmationKit.MAX_AFFIRMATIONS;
  if (state.affirmations.length >= max){
    const msg = document.getElementById('affListMsg');
    if (msg){ msg.textContent = `That is the most one subliminal holds (${AffirmationKit.countLabel(max, max)}). Remove a line to add another.`; msg.className = 'save-msg err'; }
    return;
  }
  state.affirmations.push("I am...");
  renderAffList();
  const rows = document.querySelectorAll('#affList .aff-row textarea');
  const last = rows[rows.length - 1];
  if (last){ try { last.focus(); last.select(); } catch(e){} }
}
function moveAffirmation(i, dir){
  const to = i + dir;
  if (to < 0 || to >= state.affirmations.length) return;
  state.affirmations = AffirmationKit.moveItem(state.affirmations, i, to);
  renderAffList();
  const btn = document.querySelectorAll('#affList .aff-row')[to];
  const again = btn && btn.querySelector(dir < 0 ? '.aff-move:first-child' : '.aff-move:nth-child(2)');
  if (again && !again.disabled) again.focus();
}

/* ---- affirmation mode: generate or import ---- */
let affirmationMode = 'generate';
let affirmationGenerateCount = 5;

function updateAffirmationButtonText(){
  const btn = document.getElementById('generateBtn');
  if (btn){
    btn.textContent = affirmationMode === 'generate' ? 'Generate my affirmations ✦' : 'Continue →';
  }
}

function selectAffirmationMode(mode){
  affirmationMode = mode;
  state.goal = '';
  state.affirmations = [];
  document.querySelectorAll('.affirmation-choice-card').forEach(c => c.classList.remove('sel'));
  document.querySelector(`[data-mode="${mode}"]`).classList.add('sel');
  const generateSection = document.getElementById('affirmationGenerateSection');
  const importSection = document.getElementById('affirmationImportSection');
  if (mode === 'generate'){
    if (generateSection) generateSection.classList.add('active');
    if (importSection) importSection.classList.remove('active');
  } else {
    if (generateSection) generateSection.classList.remove('active');
    if (importSection) importSection.classList.add('active');
    if (document.getElementById('affirmationPasteTab')) document.getElementById('affirmationPasteTab').classList.add('active');
    if (document.getElementById('affirmationUploadTab')) document.getElementById('affirmationUploadTab').classList.remove('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('sel'));
    document.querySelector('[data-tab="paste"]').classList.add('sel');
  }
  // Intensity, tone, tag and line count only steer the generator.
  const fineTune = document.getElementById('fineTuneOptions');
  if (fineTune){
    fineTune.hidden = mode !== 'generate';
    if (fineTune.hidden) fineTune.open = false;
  }
  updateAffirmationButtonText();
  answered(event && event.target);
}

/* How many lines to write. The five quick picks and the custom box all end up
   here, and so does the slider under "Fine-tune", so they cannot disagree. The
   count is the number of lines to *write*; which voice can read that many is the
   voice screen's business (see voiceLimitProblem), and nothing here costs
   anything but a few seconds of the writer's time -- no voice is generated until
   a voice is chosen and the person says go. */
function selectAffirmationCount(count, opts){
  const n = AffirmationKit.clampCount(count);
  if (n == null) return;
  affirmationGenerateCount = n;
  state.count = n;
  const preset = AffirmationKit.COUNT_PRESETS.includes(n);
  document.querySelectorAll('#affirmationCountChips .chip[data-count]').forEach(c => {
    const on = preset && Number(c.dataset.count) === n && !(opts && opts.custom);
    c.classList.toggle('sel', on); c.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const custom = document.getElementById('affirmationCountCustom');
  const box = document.getElementById('affirmationCountCustomInput');
  const customOn = !!(opts && opts.custom) || !preset;
  if (custom){ custom.classList.toggle('sel', customOn); custom.setAttribute('aria-checked', customOn ? 'true' : 'false'); }
  if (box && !(opts && opts.fromBox)) box.value = customOn ? String(n) : '';
  const range = document.getElementById('countRange');
  if (range && !(opts && opts.fromRange)){ range.value = n; }
  const val = document.getElementById('countVal');
  if (val) val.textContent = String(n);
  paintAffirmationCountHint(n);
}
/* The custom box: typing is free, the number is checked when it is committed
   (leaving the box, or Enter), so "5" on the way to "50" is not corrected out
   from under the keyboard. */
function commitCustomAffirmationCount(){
  const box = document.getElementById('affirmationCountCustomInput');
  if (!box) return;
  const n = AffirmationKit.clampCount(box.value);
  if (n == null){ box.value = ''; selectAffirmationCount(affirmationGenerateCount); return; }
  box.value = String(n);
  selectAffirmationCount(n, { custom: true, fromBox: true });
}
function paintAffirmationCountHint(n){
  const el = document.getElementById('affirmationCountHint');
  if (!el) return;
  const L = AffirmationKit.AFFIRMATION_LIMITS;
  el.textContent = n > L.serenity
    ? `${n} lines is for Record Your Own Voice. Serenity and Clone Your Voice read up to ${L.serenity}, and your lines are never cut to fit — you choose the voice after you've seen them.`
    : `Record Your Own Voice takes up to ${L.own}; Serenity and Clone Your Voice take up to ${L.serenity}.`;
}

function switchAffirmationTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('sel'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('sel');
  document.querySelectorAll('.affirmation-tab-content').forEach(t => t.classList.remove('active'));
  if (tab === 'paste') document.getElementById('affirmationPasteTab')?.classList.add('active');
  else document.getElementById('affirmationUploadTab')?.classList.add('active');
}

function parseAffirmationsFromText(text){
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n');
  const affirmations = [];
  for (const line of lines){
    let clean = line.trim();
    if (!clean) continue;
    clean = clean.replace(/^[\d]+[\.\)\s]+/, '');
    clean = clean.replace(/^[-•*]\s+/, '');
    clean = clean.trim();
    if (clean) affirmations.push(clean);
  }
  return affirmations;
}

function handleAffirmationFileDrop(event){
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) handleAffirmationFileUpload(files[0]);
}

function handleAffirmationFileSelect(event){
  const file = event.target?.files?.[0];
  if (file) handleAffirmationFileUpload(file);
}

async function handleAffirmationFileUpload(file){
  const msgEl = document.getElementById('fileUploadMsg');
  if (!file) return;
  const isText = file.type === 'text/plain';
  const isPdf = file.type === 'application/pdf';
  const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (!isText && !isPdf && !isDocx){
    if (msgEl){
      msgEl.textContent = 'Please upload a .txt, .pdf, or .docx file.';
      msgEl.className = 'save-msg err';
    }
    return;
  }
  try {
    let text = '';
    if (isText){
      text = await file.text();
    } else if (isPdf){
      text = await extractAffirmationsFromPDF(file);
    } else if (isDocx){
      text = await extractAffirmationsFromDOCX(file);
    }
    if (!text || !text.trim()){
      if (msgEl){
        msgEl.textContent = 'No text found in file. Please try another file or paste your affirmations instead.';
        msgEl.className = 'save-msg err';
      }
      return;
    }
    state.affirmations = importAffirmations(text);
    if (state.affirmations.length < MIN_AFFIRMATIONS){
      if (msgEl){
        msgEl.textContent = `Only found ${state.affirmations.length} affirmation${state.affirmations.length === 1 ? '' : 's'} — need at least ${MIN_AFFIRMATIONS}. Please paste more or upload another file.`;
        msgEl.className = 'save-msg err';
      }
      return;
    }
    if (msgEl){
      msgEl.textContent = `Loaded ${state.affirmations.length} affirmation${state.affirmations.length === 1 ? '' : 's'} from your file.`;
      msgEl.className = 'save-msg';
    }
    showStep(3);
    renderAffList();
  } catch (err){
    if (msgEl){
      msgEl.textContent = 'Error reading file. Please try another file or paste your affirmations instead.';
      msgEl.className = 'save-msg err';
    }
  }
}

async function extractAffirmationsFromPDF(file){
  try {
    const arrayBuffer = await file.arrayBuffer();
    if (typeof pdfjsLib !== 'undefined'){
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }
      return text;
    }
    return '';
  } catch (err){
    return '';
  }
}

async function extractAffirmationsFromDOCX(file){
  try {
    const arrayBuffer = await file.arrayBuffer();
    if (typeof JSZip !== 'undefined'){
      const zip = await JSZip.loadAsync(arrayBuffer);
      const docXml = await zip.file('word/document.xml')?.async('text');
      if (!docXml) return '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(docXml, 'text/xml');
      const texts = Array.from(doc.querySelectorAll('w\\:t, w\\:p')).map(el => {
        if (el.tagName.endsWith(':t')) return el.textContent;
        return Array.from(el.querySelectorAll('w\\:t')).map(t => t.textContent).join('') + '\n';
      });
      return texts.join('');
    }
    return '';
  } catch (err){
    return '';
  }
}

function loadAndConfigureAffirmationInput(){
  const pasted = document.getElementById('affirmationPasteText')?.value.trim();
  if (affirmationMode === 'generate'){
    state.goal = document.getElementById('quizGoal').value.trim();
    state.count = affirmationGenerateCount;
  } else if (affirmationMode === 'import' && pasted){
    state.affirmations = importAffirmations(pasted);
    if (state.affirmations.length < MIN_AFFIRMATIONS){
      const msg = document.getElementById('affListMsg');
      if (msg){
        msg.textContent = `Need at least ${MIN_AFFIRMATIONS} affirmations — found ${state.affirmations.length}.`;
        msg.className = 'save-msg err';
      }
      return false;
    }
    showStep(3);
    renderAffList();
    return true;
  }
  return true;
}

/* After generateAffirmations() is called, check if we're in import mode and handle pasted text */
function handleAffirmationInputBeforeGenerate(){
  if (affirmationMode === 'import'){
    const pasted = document.getElementById('affirmationPasteText')?.value.trim();
    if (pasted){
      state.affirmations = importAffirmations(pasted);
      if (state.affirmations.length < MIN_AFFIRMATIONS){
        const msg = document.getElementById('affListMsg');
        if (msg){
          msg.textContent = `Need at least ${MIN_AFFIRMATIONS} affirmations — found ${state.affirmations.length}. Paste more or switch to Generate.`;
          msg.className = 'save-msg err';
        }
        return false;
      }
      state.count = state.affirmations.length;
      showStep(3);
      renderAffList();
      return true;
    }
  }
  return false;
}

/* ---------------- step 4: voice choice ----------------
   One question, three answers, one card each:

     Record your own voice   free on every account, never touches ElevenLabs
     Serenity                premium to USE, free to HEAR
     Clone your voice        premium

   The middle one is the one worth being careful about, because it is two things
   wearing one name:

     the DEMO  — one short pre-generated file of Serenity saying a fixed line.
                 Anybody may play it, free account or none at all. It is served
                 by /api/voice-preview, which reads a file back and does not
                 generate anything. Pressing it is not choosing Serenity.
     the VOICE — Serenity reading YOUR affirmations, generated per line by
                 /api/tts. That costs money, so it is premium, and the route
                 refuses a free account before a character reaches the provider.

   Keeping them apart is the whole point: somebody deciding whether to pay for a
   voice has to be able to hear it, and hearing it must not be a way to get it.

   When a generated voice isn't configured — or the person's plan lapsed — the
   app falls back to the device's own speech synthesis, which is how it has
   always worked, so nothing breaks. */
/* What the page stores is a *key* — 'serenity', 'mine', 'device' — and never a
   provider voice id. The ids live on the server (lib/voices.js), which is also
   the only place that decides whether a requested voice exists, so the page
   cannot ask for a voice nobody is paying for and nobody reading the page source
   learns which voices we use.

   V1 offers one AI voice, Serenity. The six voices the picker used to list are
   retired: they are not offered here and /api/voices no longer returns them, but
   the server still resolves them so a subliminal saved with one keeps playing.
   See LEGACY_PRESET_VOICES in lib/voices.js.

   The names come from /api/voices for anybody signed in, so a voice added to the
   catalogue later can appear without this file changing. The list below is the
   fallback for a visitor who has not signed in yet. */
const FALLBACK_PRESET_VOICES = [
  { key: 'serenity', name: 'Serenity', desc: 'Calm, warm AI voice' },
];
const SERENITY_VOICE = 'serenity';
const DEVICE_VOICE = 'device';   // the browser's own speechSynthesis
const MY_CLONED_VOICE = 'mine';  // resolved to this person's own voice, server-side
/* Shown if the catalogue cannot be reached. The server holds the real one and
   accepts nothing else, so a stale copy here fails the clone rather than cloning
   on the wrong words. */
const VOICE_CONSENT_FALLBACK = 'I confirm this recording is my own voice, that I have permission to clone it, and that I consent to Subliminally creating an AI version of my voice. I am not uploading anyone else\'s voice.';

let voiceCatalogue = { presets: FALLBACK_PRESET_VOICES, myVoice: null, consentStatement: VOICE_CONSENT_FALLBACK, provider: null, loaded: false };
let voiceCataloguePromise = null;
const VOICE_CATALOGUE_TIMEOUT_MS = 10000;
async function loadVoiceCatalogue(){
  if (voiceCataloguePromise) return voiceCataloguePromise;
  voiceCataloguePromise = (async () => {
    if (!sb || !currentUser) return voiceCatalogue;
    /* Never waits forever: the clone card and the picker both await this, and
       a hung request here used to leave whatever was on screen there for good. */
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), VOICE_CATALOGUE_TIMEOUT_MS);
    try {
      const session = await Promise.race([
        sb.auth.getSession(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('auth_timeout')), VOICE_CATALOGUE_TIMEOUT_MS)),
      ]);
      const token = session && session.data && session.data.session && session.data.session.access_token;
      if (!token) return voiceCatalogue;
      // POST rather than GET so the native app's cross-origin preflight is the
      // same shape as every other call it makes.
      const res = await fetch(`${API_BASE}/api/voices`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
      if (!res.ok){ console.error('[voices] catalogue answered', res.status); return voiceCatalogue; }
      const out = await res.json();
      voiceCatalogue = {
        presets: (out.presets && out.presets.length) ? out.presets : FALLBACK_PRESET_VOICES,
        myVoice: out.myVoice || null,
        consentStatement: out.consentStatement || VOICE_CONSENT_FALLBACK,
        provider: out.provider || null,
        loaded: true,
      };
    } catch (e){
      // Keep the fallback names; previews read on the device.
      console.error('[voices] catalogue unavailable:', e && (e.name === 'AbortError' ? 'timed out' : e.message));
    } finally { clearTimeout(timer); }
    return voiceCatalogue;
  })();
  const pending = voiceCataloguePromise;
  // A catalogue that never arrived is asked for again next time, not kept.
  pending.then(c => { if (!c.loaded && voiceCataloguePromise === pending) voiceCataloguePromise = null; });
  return pending;
}
/* Called after a voice is cloned or removed, so the picker stops being wrong. */
function forgetVoiceCatalogue(){ voiceCataloguePromise = null; }
/* A clone the server has just confirmed saved. Written straight into the
   catalogue rather than asked for again, so the result is on screen at once and
   a slow or failed catalogue request afterwards cannot make it look undone. */
function noteMyVoiceCreated(name){
  voiceCatalogue = { ...voiceCatalogue, myVoice: { ...(voiceCatalogue.myVoice || {}), key: MY_CLONED_VOICE, name: name || 'My voice' } };
  voiceCataloguePromise = Promise.resolve(voiceCatalogue);
}
async function myVoiceProfile(){ return (await loadVoiceCatalogue()).myVoice; }
async function voiceConsentStatement(){ return (await loadVoiceCatalogue()).consentStatement; }

/* Choosing is the answer to the question on the screen, so it moves on. It used
   to only light the card up and enable a Continue button further down, which
   reads as the tap not having worked -- something flashes and the page stays
   where it was.

   'own' moves straight on: there is nothing else to decide. 'ai' does not,
   because it has just asked a second question -- which voice -- and answering
   the first by skipping the second would be worse. */
const STEP_ADVANCE_MS = 260;          // long enough to see what you picked

function advanceAfterPick(){
  setTimeout(() => { if (step === 4) nextStep(); }, STEP_ADVANCE_MS);
}

/* ---------- a pick is an answer, so it moves you on ----------
   Every one of these buttons used to light up and then sit there. On a phone
   the next question is below the fold, so the tap looked like it had failed --
   and the obvious thing to do with a button that did nothing is press it
   again. Three of them behaved this way and one (the voice cards) did not,
   which made it read as broken rather than as a choice.

   So answering moves you to whatever comes next: the next question on this
   screen, or the next screen when this was the last one. Same rule everywhere,
   whether that question is on step 0 or step 5. */
/* A question is any block holding one label and its answers. They are not all
   called .quiz-q -- step 5's are .soothing-picker, .own-track-picker and so on
   -- so the rule is the shape, not one class name. */
const QUESTION_BLOCKS = '.quiz-q, .soothing-picker';
function nextQuestionAfter(el){
  // `el` is sometimes a global event's target (see selectAffirmationMode), which is not always an element -- document and window have no closest().
  const here = el && typeof el.closest === 'function' && el.closest(QUESTION_BLOCKS);
  if (!here) return null;
  let n = here.nextElementSibling;
  while (n){
    if (n.matches && n.matches(QUESTION_BLOCKS) && n.offsetParent !== null) return n;
    n = n.nextElementSibling;
  }
  return null;
}
function answered(el){
  setTimeout(() => {
    const next = nextQuestionAfter(el);
    if (next){
      next.scrollIntoView({ behavior:'smooth', block:'center' });
      // A moment of glow, so it is obvious where the tap took you.
      next.classList.remove('q-next');
      void next.offsetWidth;
      next.classList.add('q-next');
      setTimeout(() => next.classList.remove('q-next'), 1400);
      return;
    }
    // Nothing else to answer here. The continue button is the honest next step
    // on the quiz screen -- it is what gates generating -- so go to it rather
    // than skipping a screen the person has not finished.
    const card = el && typeof el.closest === 'function' && el.closest('.flow-step');
    const cta = card && card.querySelector('.flow-nav .mini-btn:not([disabled])');
    if (cta){
      cta.scrollIntoView({ behavior:'smooth', block:'center' });
      cta.classList.remove('q-next'); void cta.offsetWidth; cta.classList.add('q-next');
      setTimeout(() => cta.classList.remove('q-next'), 1400);
      return;
    }
    if (step === 5) nextStep();
  }, STEP_ADVANCE_MS);
}

/* ---------- the three cards ----------
   Record your own voice, Serenity, Clone your voice. One tap is the whole
   answer, so a card that can be chosen chooses and moves on.

   Serenity and a cloned voice are premium; recording yourself is free on every
   account. A free account tapping Clone gets the existing upgrade sheet and
   keeps whatever it had chosen. Serenity is selected for anybody; the upgrade
   sheet waits until they try to continue with it (serenityAllowedToContinue),
   so continuing can still never send somebody into a voice they cannot use.

   The Serenity demo is the exception, and it is not on this path at all: it is a
   separate control inside the card (toggleSerenityPreview) which plays one
   pre-generated file and does nothing else. */
function chooseVoice(choice){
  if (choice === 'own' || choice === VOICE_RECORD_OWN) return chooseOwnVoice();
  if (choice === 'serenity' || choice === VOICE_SERENITY) return chooseSerenity();
  if (choice === 'clone' || choice === VOICE_CLONE) return chooseClonedVoice();
}

/* ---------------- the answer, and the two fields it derives ----------------
   ONE place writes the voice choice. It writes `selectedVoice` -- the answer --
   and derives `voiceMode`/`aiVoiceId` from it, so the thing the flow routes on
   and the thing the row is saved with can never disagree.

   It is synchronous on purpose, and it repaints before it returns. A tap has to
   light the card up in the same frame it happened in; anything that has to be
   checked first (a plan, whether a clone exists) is checked by the caller, and
   the caller repaints from state either way. */
function setSelectedVoice(choice){
  state.selectedVoice = choice;
  if (choice === VOICE_RECORD_OWN){
    state.voiceMode = 'own';
    state.aiVoiceId = null;
  } else if (choice === VOICE_SERENITY){
    state.voiceMode = 'ai';
    state.aiVoiceId = SERENITY_VOICE;
  } else if (choice === VOICE_CLONE){
    state.voiceMode = 'ai';
    state.aiVoiceId = MY_CLONED_VOICE;
  } else {
    state.voiceMode = null;
    state.aiVoiceId = null;
  }
  rememberVoiceChoice(choice);
  paintVoiceCards();
  paintVoiceLimitNote();
  const cta = document.getElementById('toStep5');
  if (cta) cta.disabled = !choice;
}

/* The other direction: what a subliminal loaded out of the library, or reopened
   mid-build, was built in. profile.js writes voiceMode/aiVoiceId straight from
   the saved row and knows nothing about selectedVoice, so the picker reads the
   answer back out of them rather than coming up blank and defaulting to
   recording. */
function selectedVoiceFromState(){
  if (state.selectedVoice) return state.selectedVoice;
  if (state.voiceMode === 'own') return VOICE_RECORD_OWN;
  if (state.voiceMode === 'ai'){
    if (state.aiVoiceId === MY_CLONED_VOICE) return VOICE_CLONE;
    if (state.aiVoiceId === SERENITY_VOICE) return VOICE_SERENITY;
  }
  return null;
}

/* ---------------- remembering it across a refresh ----------------
   The builder itself does not survive a reload -- a half-built subliminal is not
   a thing worth restoring -- but the voice is a preference, not a step, and
   coming back to the picker having silently forgotten it is how somebody ends up
   in the recording flow they did not choose.

   Stored against the account id, because the next person to sign in on this
   device did not choose anything. 'record_own' is the exception and is kept for
   a signed-out visitor too: it needs no account and no plan. */
const VOICE_CHOICE_KEY = 'fthr_voice_choice';
function voiceChoiceOwner(){ return (currentUser && currentUser.id) || 'anon'; }
function rememberVoiceChoice(choice){
  try {
    if (!choice) localStorage.removeItem(VOICE_CHOICE_KEY);
    else localStorage.setItem(VOICE_CHOICE_KEY, JSON.stringify({ choice, user: voiceChoiceOwner() }));
  } catch(e){ /* private mode: the choice still works for this visit */ }
}
function rememberedVoiceChoice(){
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_CHOICE_KEY) || 'null');
    if (!raw || !VOICE_CHOICES.includes(raw.choice)) return null;
    // Somebody else's choice is not a default to fall into.
    if (raw.user !== voiceChoiceOwner() && raw.choice !== VOICE_RECORD_OWN) return null;
    return raw.choice;
  } catch(e){ return null; }
}
function forgetVoiceChoice(){ try { localStorage.removeItem(VOICE_CHOICE_KEY); } catch(e){} }

/* Put the remembered answer back as the voice step opens, but only if it is
   still true: a plan that lapsed, or a cloned voice that was deleted, must not
   come back as a selected card that cannot be used. Nothing is restored over an
   answer already made in this build. */
async function restoreVoiceChoice(){
  if (state.selectedVoice) return;
  if (selectedVoiceFromState()) return;   // loaded from a saved subliminal
  const choice = rememberedVoiceChoice();
  if (!choice) return;
  if (choice === VOICE_RECORD_OWN){ setSelectedVoice(VOICE_RECORD_OWN); return; }
  if (!currentUser) return;
  const tier = await getMyTier();
  const feature = choice === VOICE_SERENITY ? 'studio_voice' : 'my_voice';
  if (!tierHasFeature(tier, feature)){ forgetVoiceChoice(); return; }
  if (choice === VOICE_CLONE && !(await myVoiceProfile())){ forgetVoiceChoice(); return; }
  if (state.selectedVoice) return;        // they answered while we were asking
  setSelectedVoice(choice);
}

function voicePickerMsgEl(){ return document.getElementById('voicePickerMsg'); }
function sayInVoicePicker(text, kind){
  const msg = voicePickerMsgEl();
  if (!msg) return;
  msg.textContent = text || '';
  msg.className = 'save-msg' + (text && kind ? ' ' + kind : '');
}

/* The one answer that is recorded and moved on from. 'own' means this device
   never asks the server for a voice at all -- no plan to check, so nothing to
   await, so the card lights up in the frame the tap arrived in. */
function chooseOwnVoice(){
  closeMyVoicePanel();
  sayInVoicePicker('');
  setSelectedVoice(VOICE_RECORD_OWN);
  advanceAfterPick();
}

/* ---------------- the highlight does not wait for the network ----------------
   Serenity and Clone both have a plan to check first, and getMyTier() can be a
   round trip. The old handlers awaited it before touching the screen, so on a
   slow connection a tap did nothing at all for a moment -- which reads as a
   broken button, and the obvious thing to do with a broken button is press it
   again.

   So the tap paints immediately, optimistically, and then the check either
   commits the answer or repaints from the real state. `paintVoiceCards()` only
   ever draws what `state` actually says, so the revert is not a second code
   path that could disagree with the first -- it is the same render, run again
   over unchanged state. A refused tap therefore cannot leave the screen showing
   a voice the account does not have. */
function previewVoicePick(choice){
  sayInVoicePicker('');
  paintVoiceCards(choice);
}

/* Tapping the Serenity CARD selects Serenity, for every account, in the frame the
   tap arrived in. Choosing is not using: the plan is checked when somebody tries
   to go on with it (serenityAllowedToContinue), not here -- a free account that
   was refused here saw the card flash and go dark, which read as a dead button.
   Pressing the small Preview button is a different handler entirely and never
   comes here. */
async function chooseSerenity(){
  closeMyVoicePanel();
  sayInVoicePicker('');
  setSelectedVoice(VOICE_SERENITY);
  if (!currentUser) return;
  // Only an account that can use it is moved on; anybody else continues when
  // they choose to, and meets the paywall then.
  if (tierHasFeature(await getMyTier(), 'studio_voice') && state.selectedVoice === VOICE_SERENITY) advanceAfterPick();
}

/* The paywall for Serenity sits on going on with it, not on choosing it. The
   choice is left exactly as it is either way -- nobody is quietly moved back to
   recording their own voice. */
async function serenityAllowedToContinue(){
  if (!currentUser){
    sayInVoicePicker('Create a free account first, then Serenity can read your affirmations.', 'err');
    return false;
  }
  const tier = await getMyTier();
  if (tierHasFeature(tier, 'studio_voice')) return true;
  openUpgradeModal('studio_voice', { tier, trigger: 'voice_continue' });
  return false;
}

/* A personal AI version of someone's own voice. Premium, and — the first time —
   a passage to read before anything is created, which is the panel below rather
   than a step of its own. */
async function chooseClonedVoice(){
  if (!currentUser){
    sayInVoicePicker('Create a free account first, then your voice can be one of the voices here.', 'err');
    return;
  }
  previewVoicePick(VOICE_CLONE);
  const tier = await getMyTier();
  if (!tierHasFeature(tier, 'my_voice')){
    paintVoiceCards();
    openUpgradeModal('my_voice', { tier, trigger: 'voice_card' });
    return;
  }
  const mine = await myVoiceProfile();
  /* No voice of their own yet, so the setup comes first -- the passage to read,
     the confirmation, the upload. What it is NOT is the affirmation-by-
     affirmation recorder: cloning is one passage read once.

     The card stays lit while the panel is open, because "clone my voice" is what
     they asked for and the panel is the answer to it. The *voice* is still not
     committed -- voiceMode/aiVoiceId stay untouched, so nothing can generate in
     a voice that does not exist yet, and Continue stays disabled until
     onMyVoiceReady() commits it. */
  if (!mine){
    /* The answer is recorded -- they asked for their own cloned voice -- but the
       VOICE is not, because it does not exist yet. That split is deliberate:
       selectedVoice is what the fork reads, so a Continue pressed from here is
       sent back to finish the clone; voiceMode/aiVoiceId stay empty, so nothing
       can try to generate in a voice that was never made. */
    state.selectedVoice = VOICE_CLONE;
    rememberVoiceChoice(VOICE_CLONE);
    paintVoiceCards();
    openMyVoicePanel();
    return;
  }
  closeMyVoicePanel();
  setSelectedVoice(VOICE_CLONE);
  // Already made once, so it is never asked for again -- it is simply chosen.
  sayInVoicePicker('Your voice is ready ✦', 'ok');
  advanceAfterPick();
}

/* What the three cards look like right now: which one is chosen, and which of
   them this account has to pay for. Nothing is ever removed from a free
   account's screen — the same rule as every other premium control in the app —
   it is drawn with a lock and explains itself when tapped. */
/* WHICH CARD IS LIT. Synchronous, derived entirely from `state`, and safe to run
   as often as anything likes -- which is the point: it runs on the tap, on the
   step opening, after a plan check, after a clone is created, and after a
   restore, and every one of those produces the same answer for the same state.

   `showing` is an optional override for the one frame between a tap and the plan
   check coming back. It changes nothing in state; leaving it out means "draw the
   truth", which is how every refusal path reverts. */
function paintVoiceCards(showing){
  const own = document.getElementById('voiceOwn');
  const serenity = document.getElementById('voiceSerenity');
  const clone = document.getElementById('voiceClone');
  if (!own || !serenity || !clone) return;
  const chosen = showing || selectedVoiceFromState();
  setSelected(own, chosen === VOICE_RECORD_OWN);
  setSelected(serenity, chosen === VOICE_SERENITY);
  setSelected(clone, chosen === VOICE_CLONE);
  /* The Serenity card is a div holding two buttons, so the face is what a
     screen reader is actually on -- it carries the state, not the wrapper. */
  const face = serenity.querySelector('.voice-card-face');
  if (face) setSelected(face, chosen === VOICE_SERENITY);
}

async function renderVoiceCards(){
  const own = document.getElementById('voiceOwn');
  const serenity = document.getElementById('voiceSerenity');
  const clone = document.getElementById('voiceClone');
  if (!own || !serenity || !clone) return;

  paintVoiceCards();

  /* The lock and the RITUAL badge come off the same feature table as the rest.
     Both cards are locked on what the plan allows rather than on what exists, so
     a lapsed member's own cloned voice is drawn honestly: still theirs, not
     usable until the plan is back. */
  const tier = currentUser ? await getMyTier() : 'none';
  /* The lock goes on Serenity's FACE, not on the card: the card also holds the
     Preview button, and the demo is free. A lock drawn across the whole card
     would say the opposite of what this screen is for. */
  lockedControl(serenity.querySelector('.voice-card-face') || serenity, 'studio_voice', tier);
  lockedControl(clone, 'my_voice', tier);

  /* Once a voice of their own exists, the card stops offering to make one and
     starts naming the one they have. */
  const cat = await loadVoiceCatalogue();
  const cloneTitle = clone.querySelector('h4');
  const cloneDesc = clone.querySelector('p');
  if (cloneTitle) cloneTitle.textContent = cat.myVoice ? (cat.myVoice.name || 'My voice') : 'Clone your voice';
  if (cloneDesc) cloneDesc.textContent = cat.myVoice ? 'Your voice is ready ✦' : 'Create an AI version of your voice';

  primeSerenityPreview();
  renderMyVoicePanel();
}

/* ---------------- the Serenity demo ----------------
   THE COST RULE for the demo, in one place: it is ONE pre-generated file. The
   same bytes for everybody, free account or not, signed in or not. Pressing
   Preview twenty times is twenty reads of that file out of the browser cache —
   see api/voice-preview.js, which generates it once for the life of the app and
   reads it back after that. No press of this button has ever reached ElevenLabs,
   and none ever should.

   It is deliberately not previewVoice(): that one asks /api/tts to read *your*
   affirmations in a voice, which costs money and is premium. The demo and the
   premium generation are two routes on the server for exactly this reason. */
/* Read at press time, not at load time: API_BASE is declared in js/account.js,
   which the page loads after this file. */
function serenityPreviewSrc(){ return `${API_BASE}/api/voice-preview`; }
/* Has to match PREVIEW_TEXT in lib/voice-preview.js — it is only read aloud here
   when the file itself cannot be played, so that a tap is never silent. */
const SERENITY_PREVIEW_LINE = "Your thoughts are becoming calmer, clearer, and more aligned with the person you're becoming.";

/* Stop the demo if it is the thing playing. Answers whether it was, so the one
   button can be both play and stop without asking twice. */
function stopSerenityPreview(){
  const el = document.getElementById('voicePreview');
  if (!el || el.dataset.kind !== 'serenity-demo') return false;
  const wasPlaying = !el.paused && !el.ended;
  if (wasPlaying){
    el.pause();
    try { el.currentTime = 0; } catch(e){}
  }
  setSerenityPreviewLabel(false);
  return wasPlaying;
}

/* The same two marks the player uses, drawn here rather than borrowed from
   player.js: the builder must stand up on its own, and it is loaded first. */
const PREVIEW_PLAY_MARK  = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
const PREVIEW_PAUSE_MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';

function setSerenityPreviewLabel(playing){
  const btn = document.getElementById('serenityPreviewBtn');
  if (!btn) return;
  btn.innerHTML = (playing ? PREVIEW_PAUSE_MARK : PREVIEW_PLAY_MARK)
    + `<span>${playing ? 'Pause' : 'Preview'}</span>`;
  btn.classList.toggle('is-playing', !!playing);
  btn.setAttribute('aria-label', playing ? 'Pause the Serenity preview' : 'Play a short Serenity preview');
}

/* Point the player at the file as the step opens, so the first tap plays rather
   than waits. One small file, fetched from the CDN and then cached for a year. */
function primeSerenityPreview(){
  const el = document.getElementById('voicePreview');
  if (!el || el.dataset.kind === 'serenity-demo') return;
  el.dataset.kind = 'serenity-demo';
  el.preload = 'auto';
  el.src = serenityPreviewSrc();
  setSerenityPreviewLabel(false);
}

/* THE PREVIEW BUTTON. It plays the demo and does nothing else: it does not
   choose Serenity, it does not open the paywall, and it does not call
   ElevenLabs.

   Note what is *not* in here: an await before play(). A browser only lets audio
   start inside the gesture that asked for it, and awaiting a plan lookup or a
   round trip first spends that gesture — which is why the old preview did
   nothing at all on a phone and said nothing about why. So the src is set ahead
   of time and this handler is synchronous right up to play(). */
function toggleSerenityPreview(ev){
  if (ev){ ev.stopPropagation(); ev.preventDefault(); }
  const el = document.getElementById('voicePreview');
  if (!el) return;
  sayInVoicePicker('');

  if (stopSerenityPreview()) return;   // it was playing; that press was "stop"
  stopAmbiencePreview();
  if (typeof stopPlayerAmbiencePreview === 'function') stopPlayerAmbiencePreview();

  try { window.speechSynthesis.cancel(); } catch(e){}
  if (el.dataset.kind !== 'serenity-demo'){
    // previewVoice() borrows this element for a cloned voice; take it back.
    el.dataset.kind = 'serenity-demo';
    el.src = serenityPreviewSrc();
  }
  try { el.currentTime = 0; } catch(e){}
  setSerenityPreviewLabel(true);
  el.onended = () => setSerenityPreviewLabel(false);
  el.onerror = () => setSerenityPreviewLabel(false);
  const started = el.play();
  if (started && started.catch){
    started.catch(() => {
      /* No signal, or the demo has never been generated. It is a courtesy, not a
         feature to apologise for, so this device reads the same line instead. */
      setSerenityPreviewLabel(false);
      sayInVoicePicker('Hearing a sample on this device — Serenity itself is a moment away.');
      speakWithDeviceVoice(SERENITY_PREVIEW_LINE);
    });
  }
}

/* ---------------- "Use my voice" ----------------
   A personal AI version of someone's own voice is not a setting to flip past, so
   the first time it is chosen this panel says what it is and asks them to confirm
   it is their voice and theirs to use. The recorder itself is the one in Settings
   (js/profile.js) mounted here, so there is one recording flow, one consent
   checkbox and one upload — not a second copy of all three. */
function myVoicePanelOpen(){
  const panel = document.getElementById('myVoicePanel');
  return !!(panel && panel.dataset.open === '1');
}
function renderMyVoicePanel(){
  const panel = document.getElementById('myVoicePanel');
  if (!panel || panel.dataset.open !== '1') return;
  panel.innerHTML = `
    <div class="voice-clone-card">
      <div class="voice-clone-body" id="builderVoiceCloneBody"></div>
      <div class="save-msg" id="builderVoiceCloneMsg"></div>
      <p class="voice-clone-intro" style="margin:14px 0 0;">A personal AI version of your voice is created for your account — after that every subliminal you build can be read in it, without recording line by line. The recording is used to create the voice and is never kept.</p>
    </div>`;
  mountVoiceClone('builderVoiceCloneBody', 'builderVoiceCloneMsg');
}
function closeMyVoicePanel(){
  const panel = document.getElementById('myVoicePanel');
  if (!panel) return;
  panel.dataset.open = '0';
  panel.innerHTML = '';
  if (typeof unmountVoiceClone === 'function') unmountVoiceClone();
}
/* Called by the recorder once a voice exists. The person asked for their voice by
   tapping the card, so the card is what they get back — selected, panel closed,
   rather than a message telling them to tap it again. */
async function onMyVoiceReady(){
  if (!document.getElementById('voiceClone')) return;
  closeMyVoicePanel();
  /* The clone now exists, so the choice they made when they tapped the card is
     finally committable -- and from here Continue takes them to the next build
     step, never to the affirmation-by-affirmation recorder. */
  setSelectedVoice(VOICE_CLONE);    // lights the card and enables Continue
  /* Nothing is read in the new voice here. ElevenLabs is only asked for speech
     when the subliminal is generated (prepareStudioVoice), never for a preview. */
  sayInVoicePicker('✓ Your AI voice is ready', 'ok');
  // Redrawing the cards checks the plan again; a failure there must not take
  // back the voice that was just made, or the message saying so.
  try { await renderVoiceCards(); }
  catch(e){ console.error('[voice-clone] could not redraw the voice cards:', e); }
}
async function openMyVoicePanel(){
  const panel = document.getElementById('myVoicePanel');
  if (!panel) return;
  panel.dataset.open = '1';
  renderMyVoicePanel();
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* Resolve what the picker stores into the key the API wants. Returns null when
   the line should be read by this device instead — no account, no voice of their
   own yet, or the device voice chosen on purpose. */
async function resolveVoiceKey(picked){
  if (!picked || picked === DEVICE_VOICE) return null;
  if (!currentUser) return null;
  /* Every voice past this point is generated, which means it is premium — this
     one included when it is a subliminal saved on Ritual being opened by an
     account that has since lapsed, or one of the retired voices that is still
     named in an older row. The server would refuse it anyway; returning null
     here means this device reads the session instead of a round trip that ends
     in an error message over somebody's affirmations. */
  if (!tierHasFeature(await getMyTier(), 'studio_voice')) return null;
  if (picked === MY_CLONED_VOICE) return (await myVoiceProfile()) ? MY_CLONED_VOICE : null;
  return picked;
}

/* A *generated* preview: one of your own lines, read by a voice you are paying
   for. This is /api/tts and it costs money, so resolveVoiceKey has already
   refused it for anybody without a plan. Used after a voice is cloned, so the
   first thing that happens is hearing it.

   The Serenity demo does not come through here — see toggleSerenityPreview. */
async function previewVoice(picked){
  const msg = document.getElementById('voicePickerMsg');
  if (msg){ msg.textContent = ''; msg.className = 'save-msg'; }
  const line = (state.affirmations && state.affirmations[0]) || 'I am safe, and I am becoming who I said I would be.';
  const voiceKey = await resolveVoiceKey(picked);
  if (!voiceKey && picked === MY_CLONED_VOICE){
    // Clone Your Voice has no stand-in: say why, and read nothing.
    if (msg){ msg.textContent = clonedVoiceErrorText(currentUser ? 'no_cloned_voice' : 'not_signed_in'); msg.className = 'save-msg err'; }
    return;
  }
  if (!voiceKey){
    if (msg && picked !== DEVICE_VOICE && !currentUser){
      msg.textContent = 'Sign in to hear Serenity — this device reads it for now.';
    }
    speakWithDeviceVoice(line);
    return;
  }
  if (msg) msg.textContent = 'Loading the voice…';
  try {
    const url = await synthesizeLine(line, voiceKey);
    if (msg) msg.textContent = '';
    const el = document.getElementById('voicePreview');
    if (!el) return;
    /* The player is shared with the Serenity demo; say who is using it, so a
       press of Preview afterwards puts the demo back rather than replaying
       somebody's affirmation. */
    el.dataset.kind = 'generated';
    el.onended = null;
    setSerenityPreviewLabel(false);
    el.src = url; el.play().catch(()=>{});
  } catch (e){
    if (voiceKey === MY_CLONED_VOICE){
      if (msg){ msg.textContent = clonedVoiceErrorText(e && e.message); msg.className = 'save-msg err'; }
      return;
    }
    if (msg){ msg.textContent = ttsErrorText(e); msg.className = 'save-msg'; }
    speakWithDeviceVoice(line);
  }
}
function speakWithDeviceVoice(line){
  try { window.speechSynthesis.cancel(); } catch(e){}
  const u = new SpeechSynthesisUtterance(line);
  u.rate = 0.92; u.pitch = 1.0;
  window.speechSynthesis.speak(u);
}

/* ---------------- what went wrong, in our own words ----------------
   The routes answer with a code, never a provider message: "voice_not_found" or a
   quota object with our account in it is no use to somebody trying to fall asleep.
   This is the one place those codes become something a person can read, and every
   one of them ends the same way — the session still plays, in this device's voice. */
const TTS_MESSAGES = {
  not_signed_in:    'Sign in to use Serenity — this device reads it for now.',
  upgrade_required: 'Serenity comes with Ritual — using this device\'s voice for now.',
  not_configured:   'Serenity isn\'t switched on yet — using this device\'s voice.',
  no_cloned_voice:  'Your voice hasn\'t been created yet — pick "Clone your voice" and give it a minute of your voice.',
  invalid_voice:    'That voice isn\'t available any more — choose another one, or this device reads it.',
  consent_required: 'Tick the confirmation first, then your voice can be created.',
  quota_exceeded:   'Serenity has run out of time this month — this device reads it for now, and it\'ll be back.',
  rate_limited:     'The voice service is busy — give it a minute and try again. This device reads it for now.',
  too_fast:         'That\'s a lot of generating at once — give it a minute. This device reads it for now.',
  hourly_limit:     'You\'ve built a lot this hour. Serenity comes back shortly; this device reads it until then.',
  daily_limit:      'You\'ve built a lot today. Serenity comes back tomorrow; this device reads it until then.',
  timeout:          'The voice service took too long — this device reads it for now.',
  network:          'Couldn\'t reach the voice service — this device reads it for now.',
  too_long:         'That line is too long to read as one clip — shorten it, or this device reads it.',
  too_many_lines:   'That\'s more lines than one session can hold — trim a few.',
};
function ttsErrorText(e){
  const code = (e && e.message) || '';
  return TTS_MESSAGES[code] || 'That voice is unavailable right now — using this device\'s voice.';
}

/* Clone Your Voice gets its own words, because the ones above all end "this
   device reads it" -- and for a cloned voice that is never true. If it cannot
   be generated, nothing plays in its place: not the device voice, not Serenity,
   not another ElevenLabs voice. The person is told, and Play tries again. */
const CLONE_RETRY = ' Nothing was played in another voice — tap Play to try again.';
const CLONE_TTS_MESSAGES = {
  not_signed_in:    'Sign in to hear this in your cloned voice.',
  upgrade_required: 'Your cloned voice comes with Ritual.',
  no_cloned_voice:  'Your voice hasn\'t been created yet — give it a minute of your voice and it will be ready.',
  invalid_voice:    'Your cloned voice couldn\'t be found — create it again from the voice step.',
  nothing_to_say:   'There are no affirmations to read yet — go back and add at least one.',
  too_long:         'One of your affirmations is too long to read as one clip — shorten it and generate again.',
  too_many_lines:   'That\'s more lines than one session can hold — trim a few.',
  not_configured:   'Your cloned voice isn\'t switched on yet.' + CLONE_RETRY,
  quota_exceeded:   'The voice service is out of credit for now.' + CLONE_RETRY,
  rate_limited:     'The voice service is busy — give it a minute.' + CLONE_RETRY,
  too_fast:         'That\'s a lot of generating at once — give it a minute.' + CLONE_RETRY,
  hourly_limit:     'You\'ve built a lot this hour — give it a little while.' + CLONE_RETRY,
  daily_limit:      'You\'ve built a lot today — it will be back tomorrow.' + CLONE_RETRY,
  timeout:          'The voice service took too long.' + CLONE_RETRY,
  network:          'Couldn\'t reach the voice service.' + CLONE_RETRY,
};
function clonedVoiceErrorText(code){
  return CLONE_TTS_MESSAGES[code || ''] || ('Your cloned voice couldn\'t be generated just now.' + CLONE_RETRY);
}

/* ---------------- generated speech, once ----------------
   THE COST RULE, in one place: a subliminal's affirmations are generated exactly
   once, at their natural length, however long the session is set to run. Twenty
   minutes, an hour, four, eight or a custom length are all the *same* audio; the
   player loops it locally (see the loop in playFinal) and nothing is generated per
   minute of playback.

   On top of that, nothing is generated twice. The server keeps every clip against
   the person, the voice and the words, so rebuilding the same subliminal tomorrow
   — or opening it on a phone instead of a laptop — reads back what already exists.
   This map is the same saving one step nearer: within a session, the URL for a line
   is fetched once and the decoded audio is reused for every repeat. */
const ttsCache = new Map();          // "voiceKey|speed|line" -> Promise<url>
/* loadClip caches its decoded audio on the object it's handed, so each generated
   line needs one stable handle rather than a fresh literal per repeat. Once a
   line has been downloaded and checked, the handle also HOLDS THE AUDIO (`blob`),
   so playing it never depends on a link that can expire or a network that can
   drop -- which is also what lets it carry on with the screen locked. */
const studioClipHandles = new Map();
function studioClipHandle(url){
  if (!studioClipHandles.has(url)) studioClipHandles.set(url, { url });
  return studioClipHandles.get(url);
}
/* How many lines one request carries. The route accepts up to 25, but a serverless
   function has a wall-clock limit and a line takes a second or two to generate, so
   a twenty-line subliminal goes as four short requests rather than one long one
   that might be cut off. They run one after another, so the total wait is the same
   — and a batch that did land is kept, so a failure part-way costs nothing twice. */
const TTS_LINES_PER_REQUEST = 6;
/* Has to match normalizeLine() in lib/tts-store.js: the server answers with the
   line as *it* normalized it, and that is the key the player looks up. */
function ttsLineText(text){ return String(text == null ? '' : text).replace(/\s+/g, ' ').trim(); }
function ttsLineKey(voiceKey, speed, text){ return voiceKey + '|' + speed + '|' + ttsLineText(text); }

/* ---- bounded retries ----
   A dropped connection, a provider timeout or a 5xx is worth another go, a few
   times, with a growing pause. A quota, a key, a limit or a bad voice is not: it
   fails the same way every time, and trying again only makes a rate limit worse. */
const TTS_ATTEMPTS = 3;
const TTS_REQUEST_TIMEOUT_MS = 65000;      // the route's own limit is 60s
const TTS_RETRYABLE = new Set(['timeout', 'network', 'provider_failed', 'bad_audio', 'upload_failed', 'index_failed', 'generation_failed']);
function ttsCodeRetryable(code){ return TTS_RETRYABLE.has(code) || /^tts_failed_5\d\d$/.test(String(code)); }
function ttsBackoffMs(attempt){ return Math.round(700 * Math.pow(2, attempt - 1) * (0.75 + Math.random() * 0.5)); }
function ttsSleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

async function ttsRequest(lines, voiceKey, speed, opts){
  /* THE COST RULE for long lists. Only a voice you record yourself reads more
     than ten lines; every line Serenity or a cloned voice reads is a paid
     generation. The voice screen already holds anyone who tries (see
     voiceLimitProblem); this is the same rule at the last door, so no path --
     a reopened subliminal, a changed voice, a stale tab -- can send a long list
     to the provider. */
  /* A saved subliminal is exempt: it was built under whatever limit applied then
     (some Serenity ones hold 13 and 43 lines), its audio is already stored, and
     reading stored clips back costs nothing. The route's own hourly/daily ceilings
     still bound anything that does need generating. */
  if (!editingExistingId && !state.eftMode && !state.visualizationMode && nonEmptyAffirmationCount() > AffirmationKit.AFFIRMATION_LIMITS.serenity){
    throw new Error('too_many_lines_for_ai_voice');
  }
  const token = sb && (await sb.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error('not_signed_in');
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = abort ? setTimeout(() => abort.abort(), TTS_REQUEST_TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // The pace is part of the reading, not just the gap after it, so it is part
      // of what identifies a clip. `repair` asks for the lines to be made again
      // because the stored copy would not play.
      body: JSON.stringify({ voiceKey, speed, lines, repair: !!(opts && opts.repair) }),
      signal: abort ? abort.signal : undefined,
    });
  } catch (e){
    throw new Error(e && e.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
  let out = {};
  try { out = await res.json(); } catch(e){}
  if (!res.ok) throw new Error(out.error || `tts_failed_${res.status}`);
  return out;
}

/* One line, on its own. Used by the voice preview and as the safety net for a
   line the sequence request did not cover. */
async function synthesizeLine(text, voiceKey){
  const speed = paceNow().speed;
  const key = ttsLineKey(voiceKey, speed, text);
  if (ttsCache.has(key)) return ttsCache.get(key);
  const promise = (async () => {
    const out = await ttsRequest([ttsLineText(text)], voiceKey, speed);
    const clip = (out.clips || [])[0];
    if (!clip || !clip.url) throw new Error((clip && clip.error) || out.warning || 'generation_failed');
    return clip.url;
  })();
  ttsCache.set(key, promise);
  // A failed line shouldn't be cached as permanently broken.
  promise.catch(() => ttsCache.delete(key));
  return promise;
}

/* Every line of a sequence, in as few requests as possible. Lines already in hand
   are not asked for again, and the request is skipped entirely when there is
   nothing new — which is what makes pressing Generate twice cost nothing.

   A batch that fails for a reason that can pass is asked again (only the lines
   still missing), up to TTS_ATTEMPTS times; the server answers the lines that
   did land from storage, so a retry never pays for them twice. */
async function fetchSequenceAudio(lines, voiceKey, opts){
  const o = opts || {};
  const speed = paceNow().speed;
  const wanted = [];
  (lines || []).forEach(l => {
    const line = ttsLineText(l);
    if (line && !wanted.includes(line) && (o.repair || !ttsCache.has(ttsLineKey(voiceKey, speed, line)))) wanted.push(line);
  });
  if (!wanted.length) return { ok: true, code: null };
  let failure = null;
  for (let i = 0; i < wanted.length && !failure; i += TTS_LINES_PER_REQUEST){
    let pending = wanted.slice(i, i + TTS_LINES_PER_REQUEST);
    let lastCode = null;
    for (let attempt = 0; attempt < TTS_ATTEMPTS && pending.length && !failure; attempt++){
      if (attempt) await ttsSleep(ttsBackoffMs(attempt));
      let out;
      try {
        // Only the first request of a repair repairs; a retry of it must not forget again.
        out = await ttsRequest(pending, voiceKey, speed, { repair: o.repair && attempt === 0 });
      } catch (e){
        lastCode = (e && e.message) || 'generation_failed';
        if (!ttsCodeRetryable(lastCode)) failure = lastCode;
        continue;
      }
      const still = [];
      (out.clips || []).forEach(c => {
        if (c.url){ ttsCache.set(ttsLineKey(voiceKey, speed, c.text), Promise.resolve(c.url)); return; }
        if (!c.error || c.error === 'empty') return;
        lastCode = c.error;
        if (ttsCodeRetryable(c.error) && c.retryable !== false) still.push(c.text);
        else failure = failure || c.error;
      });
      if (out.warning && !ttsCodeRetryable(out.warning)) failure = failure || out.warning;
      pending = still;
    }
    if (!failure && pending.length) failure = lastCode || 'generation_failed';
    if (!failure && o.onProgress) o.onProgress(Math.min(wanted.length, i + TTS_LINES_PER_REQUEST), wanted.length);
  }
  return { ok: !failure, code: failure };
}

/* One prepare per sequence, however many times it is asked for. This is what a
   second tap on Generate lands on: the promise already running, not a second run
   of it. */
const sequencePrepares = new Map();
function prepareSequenceAudio(lines, voiceKey, opts){
  const key = voiceKey + '|' + paceNow().speed + '|' + (lines || []).map(ttsLineText).join('\u0001');
  if (sequencePrepares.has(key)) return sequencePrepares.get(key);
  const promise = fetchSequenceAudio(lines, voiceKey, opts);
  sequencePrepares.set(key, promise);
  // Only a run that worked is worth remembering; a failed one should be retryable.
  promise.then(r => { if (!r.ok) sequencePrepares.delete(key); }).catch(() => sequencePrepares.delete(key));
  return promise;
}

/* ---------------- is the audio really there? ----------------
   A 200 from the route means the server stored something. It does not mean this
   device can fetch it, that it is not empty or cut short, that it decodes, or
   that it is not silence. Each of those has happened to somebody's session
   somewhere, and each used to surface as a subliminal that "plays" with no voice.

   So before a voice session is marked ready every line is downloaded and checked
   here: reachable, big enough, an audio file, decodable, audible. The downloaded
   bytes are kept on the line's handle, which is what playback then uses. */
const STUDIO_MIN_CLIP_BYTES = 1500;
const STUDIO_MIN_CLIP_SECONDS = 0.15;
const STUDIO_MIN_PEAK = 0.002;

function elementCanPlay(blob){
  return new Promise(resolve => {
    let el = null, url = null, done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      try { el.removeAttribute('src'); el.load(); } catch(e){}
      if (url) { try { URL.revokeObjectURL(url); } catch(e){} }
      resolve(ok);
    };
    try {
      el = new Audio(); url = URL.createObjectURL(blob);
      el.preload = 'auto'; el.src = url;
      el.oncanplaythrough = () => finish(true);
      el.onerror = () => finish(false);
      setTimeout(() => finish(false), 8000);
      el.load();
    } catch(e){ finish(false); }
  });
}
/* Decoded length and loudest sample, or null where this browser cannot decode
   offline (the size and header checks still apply). Safari sometimes refuses an
   mp3 here that an <audio> element plays, and loadClip has that fallback, so the
   element gets the same chance before the clip is called undecodable. */
async function probeStudioAudio(blob){
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) return null;
  let buffer;
  try {
    const off = new Offline(1, 1, 44100);
    const data = await blob.arrayBuffer();
    buffer = await new Promise((resolve, reject) => {
      const p = off.decodeAudioData(data, resolve, reject);
      if (p && p.catch) p.catch(reject);
    });
  } catch (e){
    if (await elementCanPlay(blob)) return null;
    throw new Error('audio_undecodable');
  }
  let peak = 0;
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i += 16){ const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  return { seconds: buffer.duration, peak };
}
async function verifyStudioClip(url){
  const handle = studioClipHandle(url);
  if (handle.verified) return handle;
  let blob = null;
  for (let attempt = 0; attempt < TTS_ATTEMPTS && !blob; attempt++){
    if (attempt) await ttsSleep(ttsBackoffMs(attempt));
    try {
      const res = await fetch(url);
      if (res.ok) blob = await res.blob();
      else if (res.status >= 400 && res.status < 500) break;   // expired or gone: the same link will not come back
    } catch(e){ /* offline for a moment: try again */ }
  }
  if (!blob) throw new Error('audio_unreachable');
  if (blob.size < STUDIO_MIN_CLIP_BYTES) throw new Error('audio_empty');
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const frameSync = head[0] === 0xFF && (head[1] & 0xE0) === 0xE0;
  if (!sniffAudioMime(head) && !frameSync) throw new Error('audio_undecodable');
  const probe = await probeStudioAudio(blob);
  if (probe){
    if (!(probe.seconds >= STUDIO_MIN_CLIP_SECONDS)) throw new Error('audio_empty');
    if (!(probe.peak >= STUDIO_MIN_PEAK)) throw new Error('audio_silent');
  }
  handle.blob = blob;
  handle.verified = true;
  return handle;
}
const STUDIO_CONTENT_FAULTS = new Set(['audio_empty', 'audio_undecodable', 'audio_silent']);

/* Check every line of the plan, a few at a time. A line whose LINK is bad (expired,
   gone) is asked for again, which gets a fresh link or a regenerated clip; a line
   whose CONTENT is bad is asked for again with `repair`, which makes the stored
   copy again. Either gets exactly one second chance, then the session fails
   loudly instead of playing with a hole in it. */
async function verifyStudioPlan(jobs){
  const speed = paceNow().speed;
  const entries = [];
  jobs.forEach(([lines, voiceKey]) => lines.forEach(line => {
    if (!entries.some(e => e.voiceKey === voiceKey && e.line === line)) entries.push({ voiceKey, line });
  }));
  async function checkAll(list){
    const bad = [];
    let next = 0;
    const worker = async () => {
      while (next < list.length){
        const e = list[next++];
        try {
          const pending = ttsCache.get(ttsLineKey(e.voiceKey, speed, e.line));
          if (!pending) throw new Error('generation_failed');
          await verifyStudioClip(await pending);
        } catch (err){ e.code = (err && err.message) || 'audio_unreachable'; bad.push(e); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return bad;
  }
  let bad = await checkAll(entries);
  if (!bad.length) return;
  bad.forEach(e => reportStudioFailure(e.code, 'verify'));
  sequencePrepares.clear();
  for (const voiceKey of Array.from(new Set(bad.map(e => e.voiceKey)))){
    for (const repair of [false, true]){
      const group = bad.filter(e => e.voiceKey === voiceKey && STUDIO_CONTENT_FAULTS.has(e.code) === repair);
      if (!group.length) continue;
      group.forEach(e => ttsCache.delete(ttsLineKey(e.voiceKey, speed, e.line)));
      const r = await fetchSequenceAudio(group.map(e => e.line), voiceKey, { repair });
      if (!r.ok) throw new Error(r.code || 'generation_failed');
    }
  }
  bad = await checkAll(bad);
  if (bad.length) throw new Error(bad[0].code);
}

/* Tell the server what only the browser can see. Codes only, never words or
   audio; best effort, and it can never get in the way of the session. */
function reportStudioFailure(code, stage){
  try {
    if (!sb || !code) return;
    Promise.resolve(sb.auth.getSession()).then(r => {
      const token = r && r.data && r.data.session && r.data.session.access_token;
      if (!token) return;
      return fetch(`${API_BASE}/api/tts-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code, stage, voiceKey: state.aiVoiceId || null }),
      });
    }).catch(() => {});
  } catch(e){}
}

/* ---------------- the voice session: one plan, one ready flag ----------------
   Serenity and Clone Your Voice are the same thing to the player: audio that is
   generated once, checked, held, and only then played. There is no device-voice
   stand-in for either -- the device's speech is silent on an iPhone the moment
   Web Audio is running, which is exactly when a session plays, so "falling back"
   to it was how a failure turned into a session of silence. If the audio is not
   there, the session says so and Retry Audio (or Play) makes it again.

   The plan is the main voice's lines plus the second voice's, each with its voice
   key. `studioReadyKey` is the plan that has been generated AND checked; Play
   compares against it and nothing else. */
function studioMainKey(){
  return state.voiceMode === 'ai' && state.aiVoiceId && state.aiVoiceId !== DEVICE_VOICE ? state.aiVoiceId : null;
}
/* The second voice follows the clone when the main voice is the clone; otherwise
   it is whatever it was set to. Null means it is read by this device or recorded. */
function studioLayerKey(){
  if (!layerVoiceEnabled || state.layerVoiceMode !== 'ai') return null;
  if (studioMainKey() === MY_CLONED_VOICE) return MY_CLONED_VOICE;
  const k = state.layerAiVoiceId;
  return k && k !== DEVICE_VOICE ? k : null;
}
function studioMainLines(){ return studioMainKey() ? (state.affirmations || []).map(ttsLineText).filter(Boolean) : []; }
function studioLayerLines(){ return studioLayerKey() ? (state.layerAffirmations || []).map(ttsLineText).filter(Boolean) : []; }
function isStudioVoiceSession(){ return !!studioMainKey() || studioLayerLines().length > 0; }
function isClonedVoiceSession(){ return state.voiceMode === 'ai' && state.aiVoiceId === MY_CLONED_VOICE; }
function studioSequenceKey(){
  return [paceNow().speed, studioMainKey(), studioMainLines().join('\u0001'), studioLayerKey(), studioLayerLines().join('\u0001')].join('|');
}
function studioClipUrl(voiceKey, line){
  return ttsCache.get(ttsLineKey(voiceKey, paceNow().speed, line)) || null;
}
let studioReadyKey = null;
let studioPreparing = null;
let studioStatus = { state: 'idle', code: null };

/* ---- what the person is told ---- */
const STUDIO_RETRY = ' Nothing was played in another voice — tap Play to try again.';
const SERENITY_TTS_MESSAGES = {
  not_signed_in:    'Sign in to hear Serenity read this.',
  upgrade_required: 'Serenity comes with Ritual. Upgrade to hear it, or switch this subliminal to Record Your Own Voice.',
  nothing_to_say:   'There are no affirmations to read yet — go back and add at least one.',
  too_long:         'One of your affirmations is too long to read as one clip — shorten it and try again.',
  too_many_lines:   'That\'s more lines than one session can hold — trim a few.',
  too_many_lines_for_ai_voice: 'Serenity reads up to 10 affirmations. Use Record Your Own Voice for a longer list.',
  invalid_voice:    'Serenity isn\'t available right now.' + STUDIO_RETRY,
  not_configured:   'Serenity isn\'t switched on yet.' + STUDIO_RETRY,
  quota_exceeded:   'Serenity is unavailable for a little while.' + STUDIO_RETRY,
  rate_limited:     'The voice service is busy — give it a minute.' + STUDIO_RETRY,
  too_fast:         'That\'s a lot of generating at once — give it a minute.' + STUDIO_RETRY,
  hourly_limit:     'You\'ve built a lot this hour — give it a little while.' + STUDIO_RETRY,
  daily_limit:      'You\'ve built a lot today — it will be back tomorrow.' + STUDIO_RETRY,
  timeout:          'The voice service took too long.' + STUDIO_RETRY,
  network:          'Couldn\'t reach the voice service.' + STUDIO_RETRY,
  audio_unreachable:'Your voice audio couldn\'t be downloaded.' + STUDIO_RETRY,
  audio_empty:      'The voice audio came back incomplete and couldn\'t be repaired just now.' + STUDIO_RETRY,
  audio_undecodable:'The voice audio couldn\'t be read by this device.' + STUDIO_RETRY,
  audio_silent:     'The voice audio came back silent and couldn\'t be repaired just now.' + STUDIO_RETRY,
  playback_failed:  'The voice audio stopped playing.' + STUDIO_RETRY,
};
function studioVoiceErrorText(code){
  if (isClonedVoiceSession() && CLONE_TTS_MESSAGES[code]) return CLONE_TTS_MESSAGES[code];
  if (SERENITY_TTS_MESSAGES[code]) return SERENITY_TTS_MESSAGES[code];
  return (isClonedVoiceSession() ? 'Your cloned voice' : 'Serenity') + ' couldn\'t be generated just now.' + STUDIO_RETRY;
}
/* Retry Audio is for failures a second try can fix. Not for "sign in", "upgrade",
   "no affirmations", a list that is too long, or a voice that does not exist. */
const STUDIO_NOT_RECOVERABLE = new Set(['not_signed_in', 'upgrade_required', 'no_cloned_voice', 'nothing_to_say', 'too_long', 'too_many_lines', 'too_many_lines_for_ai_voice', 'invalid_voice', 'not_configured']);
const STUDIO_STATUS_TEXT = { generating: 'Generating Voice…', saving: 'Saving Audio…', ready: 'Ready to Play', failed: 'Failed' };

/* The four states, and the only thing that draws them. 'saving' is the stage after
   the server has made the audio: it is being downloaded back and checked, and
   nothing is called ready until that has passed. */
function setStudioStatus(name, code, progress){
  studioStatus = { state: name, code: code || null };
  const lineEl = document.getElementById('finalLine');
  const box = document.getElementById('voiceStatus');
  const text = document.getElementById('voiceStatusText');
  const retry = document.getElementById('retryAudioBtn');
  if (box){
    box.hidden = !STUDIO_STATUS_TEXT[name];
    box.setAttribute('data-state', name);
    if (text) text.textContent = (STUDIO_STATUS_TEXT[name] || '') + (progress && name === 'generating' ? ` (${progress})` : '');
  }
  if (retry) retry.hidden = !(name === 'failed' && !STUDIO_NOT_RECOVERABLE.has(code));
  if (name === 'failed' && lineEl) lineEl.textContent = studioVoiceErrorText(code);
}

/* Anything played in a voice session that failed to load: drop what is held so the
   retry asks the server again (which answers from its stored clips, not from the
   provider, when they already exist). */
function forgetStudioVoiceAudio(){
  studioReadyKey = null;
  const speed = paceNow().speed;
  studioMainLines().forEach(l => ttsCache.delete(ttsLineKey(studioMainKey(), speed, l)));
  studioLayerLines().forEach(l => ttsCache.delete(ttsLineKey(studioLayerKey(), speed, l)));
  sequencePrepares.clear();
  studioClipHandles.clear();
}
function retryStudioAudio(){
  if (studioPreparing) return;
  studioReadyKey = null;
  sequencePrepares.clear();
  if (isStudioVoiceSession()) prepareStudioVoice();
}
function prepareStudioVoice(){
  if (studioPreparing) return studioPreparing;
  studioPreparing = runStudioPrepare().finally(() => { studioPreparing = null; });
  return studioPreparing;
}

/* Called as the final screen opens, for a freshly built subliminal and for one
   loaded out of the library. The session's voice is generated here, once, before
   anybody presses play — so the first loop doesn't stutter while it waits, and the
   loops after it are free. Resolves to whether the audio is ready. */
let preparingSessionVoice = false;
async function prepareSessionVoice(){
  if (!isStudioVoiceSession()) return true;
  return prepareStudioVoice();
}
async function runStudioPrepare(){
  const playBtn = document.getElementById('finalPlayBtn');
  const mainKey = studioMainKey(), layerKey = studioLayerKey();
  const mainLines = studioMainLines(), layerLines = studioLayerLines();
  const key = studioSequenceKey();
  if (studioReadyKey === key){ setStudioStatus('ready'); return true; }
  if (mainKey && !mainLines.length){ setStudioStatus('failed', 'nothing_to_say'); return false; }
  preparingSessionVoice = true;
  if (playBtn) playBtn.disabled = true;
  setStudioStatus('generating');
  try {
    if (!currentUser) throw new Error('not_signed_in');
    let tierNow;
    try { tierNow = await getMyTierChecked(); }
    catch (e){ throw new Error('network'); }   // could not ask is not "not subscribed"
    if (!tierHasFeature(tierNow, 'studio_voice')) throw new Error('upgrade_required');
    if ((mainKey === MY_CLONED_VOICE || layerKey === MY_CLONED_VOICE) && !(await myVoiceProfile())) throw new Error('no_cloned_voice');
    const jobs = [];
    if (mainKey) jobs.push([mainLines, mainKey]);
    if (layerKey) jobs.push([layerLines, layerKey]);
    for (const [lines, voiceKey] of jobs){
      const r = await prepareSequenceAudio(lines, voiceKey, { onProgress: (done, total) => setStudioStatus('generating', null, `${done} of ${total}`) });
      if (!r.ok) throw new Error(r.code || 'generation_failed');
    }
    setStudioStatus('saving');
    await verifyStudioPlan(jobs);
    // Every line has to be in hand, or the session would have gaps to fill.
    if (!jobs.every(([lines, voiceKey]) => lines.every(l => studioClipUrl(voiceKey, l)))) throw new Error('generation_failed');
    studioReadyKey = key;
    setStudioStatus('ready');
    return true;
  } catch (e){
    const code = (e && e.message) || 'generation_failed';
    setStudioStatus('failed', code);
    if (code === 'network' || code === 'timeout') reportStudioFailure(code, 'prepare');
    /* No voice to read in: back to the Phase 1 setup, not to another voice. */
    if (code === 'no_cloned_voice' && document.getElementById('voiceClone')){
      state.selectedVoice = VOICE_CLONE;
      showStep(4);
      paintVoiceCards(VOICE_CLONE);
      sayInVoicePicker('One more step — give us at least 1 minute of your voice below and it will be ready.', 'err');
      openMyVoicePanel();
    }
    return false;
  } finally {
    preparingSessionVoice = false;
    if (playBtn) playBtn.disabled = false;
  }
}

/* ---------------- step 5: ambience + mixer ----------------

   AUDITIONING IS NOT CHOOSING. Every other picker in this app answers its
   question on the tap, because every other picker can be judged by looking at
   it. Ambience cannot: the only way to know whether Ocean Escape is the one is
   to hear it, and hearing five of them in a row used to mean answering the
   question five times and being marched to the next step by the last one.

   So this screen has two states rather than one, and they are kept strictly
   apart:

     state.bg            THE ANSWER. What gets saved, what the session plays,
                         and the only thing the persistent highlight is
                         derived from. Nothing but confirmAmbience() writes it.
     ambienceCandidate   WHAT IS BEING LISTENED TO. Never saved, never played
                         by a session, and drawn as a different thing entirely.

   Tapping a card auditions it. The card that is *chosen* keeps its ring the
   whole time, so at no point is the screen unable to say what the answer
   currently is — which is the rule in js/selectable.js, and the reason the
   preview had to be built as a second state instead of as a tap that gets
   undone. The confirm button is the only thing that moves one into the
   other. */
const bgGrid = document.getElementById('bgGrid');
/* Its own bed, its own context: a preview must not be able to disturb a
   session, and the one-at-a-time rule in ambience.js means it cannot layer
   over one either. */
const previewBed = new AmbienceBed('preview');
/* The other family's pick, under the one being auditioned, so a preview sounds
   like the layered session will. Same group, so the two do not stop each other. */
const previewLayerBed = new AmbienceBed('preview-layer', 'preview');
let previewCtx = null;
let previewTimer = null;
let ambienceCandidate = null;   // null means "nothing is being auditioned"
/* Previews end on their own. Somebody who taps one and then wanders off to
   read the copy underneath should not still be listening to rain ten minutes
   later. */
const AMBIENCE_PREVIEW_MS = 25000;

/* LAYERING: one meditation sound and one nature sound can play together.
   state.bg is still the main answer (saved as `background`, read everywhere);
   state.bgLayer is the other family's pick, or 'none'. These two are the only
   way either is written, so the pair is always in the same shape: bg set
   whenever anything is, bgLayer only when both families are, and never two of
   one family. */
function ambiencePicks(){
  const picks = { meditation: null, nature: null };
  [state.bg, state.bgLayer].forEach(key => {
    const family = ambienceFamily(key);
    if (family && !picks[family]) picks[family] = key;
  });
  return picks;
}
function setAmbiencePicks(picks){
  // The family already on the main bed stays there, so adding a layer never
  // moves the sound that is already playing onto the other bed.
  const main = ambienceFamily(state.bg) || 'meditation';
  const other = main === 'meditation' ? 'nature' : 'meditation';
  state.bg = picks[main] || picks[other] || 'none';
  state.bgLayer = picks[main] && picks[other] ? picks[other] : 'none';
}
/* Choose one sound: it takes its family's place and keeps the other family's.
   None clears both. A key outside the families (an older player catalogue key)
   replaces everything, as choosing an ambience always used to. */
function chooseAmbience(key){
  const family = ambienceFamily(key);
  if (!family){ state.bg = key || 'none'; state.bgLayer = 'none'; return; }
  const picks = ambiencePicks();
  picks[family] = key;
  setAmbiencePicks(picks);
}
function removeAmbience(key){
  const family = ambienceFamily(key);
  if (!family) return;
  const picks = ambiencePicks();
  if (picks[family] === key) picks[family] = null;
  setAmbiencePicks(picks);
}
function ambienceSummary(){
  const keys = [state.bg, state.bgLayer].filter(k => k && k !== 'none');
  return keys.length ? keys.map(ambienceName).join(' + ') : 'None';
}
/* Both session beds follow the answer. Called whenever it changes mid-session. */
function applySessionAmbience(opts){
  if (!finalPlaying || !finalCtx) return;
  sessionBed.to(state.bg, opts);
  sessionLayerBed.to(state.bgLayer || 'none', opts);
}

/* THE ONE PAINT. Both states, re-derived from scratch, every time anything
   about either of them changes.

   The chosen card gets .sel and the ARIA, off state.bg, exactly as before.
   The card being auditioned gets data-auditioning, which is a different mark
   in a different colour — it is deliberately not .sel, because a second card
   wearing the chosen treatment is the bug the whole selectable system exists
   to stop. */
function paintBgCards(){
  const chosen = [state.bg, state.bgLayer].filter(k => k && k !== 'none');
  if (!chosen.length) chosen.push('none');
  syncSelectionByDataIn('#bgGrid .bg-card', 'key', chosen);
  /* The card is a wrapper holding two buttons, so the face is what a screen
     reader is on: it carries the state, not the div around it. */
  syncSelectionByDataIn('#bgGrid .bg-card-face', 'key', chosen);
  document.querySelectorAll('#bgGrid .bg-card').forEach(card => {
    const auditioning = !!ambienceCandidate && card.dataset.key === ambienceCandidate;
    card.toggleAttribute('data-auditioning', auditioning);
  });
  document.querySelectorAll('#bgGrid .bg-preview-btn').forEach(btn => {
    const live = previewBed.playing() && btn.dataset.key === previewBed.key;
    btn.classList.toggle('is-playing', live);
    btn.setAttribute('aria-label', `${live ? 'Pause' : 'Play'} a preview of ${ambienceName(btn.dataset.key)}`);
    btn.innerHTML = (live ? PREVIEW_PAUSE_MARK : PREVIEW_PLAY_MARK)
      + `<span>${live ? 'Pause' : 'Preview'}</span>`;
  });
  paintAmbienceConfirm();
}

/* The confirm button says what pressing it would do, and is inert when it
   would do nothing. "Use Ocean Escape" is a sentence; "Confirm" is a dare. */
function paintAmbienceConfirm(){
  const btn = document.getElementById('ambienceConfirmBtn');
  const note = document.getElementById('ambienceConfirmNote');
  if (!btn) return;
  const chosen = [state.bg, state.bgLayer].filter(k => k && k !== 'none');
  const candidate = ambienceCandidate || state.bg || 'none';
  const candidateChosen = candidate === 'none' ? !chosen.length : chosen.includes(candidate);
  // Selecting a card commits immediately. The primary action must never become
  // disabled simply because a sound is already selected. This stranded users
  // on mobile after tapping a card, particularly when Nature is optional.
  btn.disabled = false;
  btn.textContent = 'Continue with ' + ambienceSummary();
  if (note) note.textContent = candidateChosen
    ? (chosen.length ? 'Selected: ' + ambienceSummary() + '. You can also add a Nature or Meditation sound.' : 'No background sound selected. You can continue without one.')
    : 'Previewing ' + ambienceName(candidate) + '. Tap its card to select it, or continue with ' + ambienceSummary() + '.';
  const remove = document.getElementById('ambienceRemoveBtn');
  if (remove){
    const canRemove = candidateChosen && chosen.length > 1 && candidate !== 'none';
    remove.hidden = !canRemove;
    if (canRemove) remove.textContent = 'Remove ' + ambienceName(candidate);
  }
}

function renderBgGrid(){
  if (!bgGrid) return;
  bgGrid.innerHTML = '';
  /* By family, because that is what can be layered: one from Meditation, one
     from Nature. Within a family the recorded tracks are one list and the
     generated ones a compact grid under them. */
  const addRow = (tracks, cls) => {
    if (!tracks.length) return;
    const row = document.createElement('div');
    row.className = 'bg-row' + (cls ? ' ' + cls : '');
    tracks.forEach(track => row.appendChild(bgCard(track)));
    bgGrid.appendChild(row);
  };
  const addHeading = (text, hint) => {
    const heading = document.createElement('div');
    heading.className = 'bg-section-label';
    heading.textContent = text;
    if (hint){ const small = document.createElement('span'); small.className = 'bg-section-hint'; small.textContent = hint; heading.appendChild(small); }
    bgGrid.appendChild(heading);
  };
  ambienceFamilies().forEach(group => {
    addHeading(group.label, 'Choose one');
    addRow(group.tracks.filter(t => isRecordedAmbience(t.key)), 'bg-row-recorded');
    addRow(group.tracks.filter(t => !isRecordedAmbience(t.key)), 'bg-row-generated');
  });
  addHeading('No ambience');
  addRow([AMBIENCE_NONE]);
  paintBgCards();
}

function bgCard(track){
  const card = document.createElement('div');
  card.className = 'bg-card bg-card-split';
  card.dataset.key = track.key;

  const face = document.createElement('button');
  face.type = 'button';
  face.className = 'bg-card-face';
  face.dataset.key = track.key;
  face.setAttribute('role', 'radio');
  /* Built as nodes rather than a template string: the name and the icon are
     data, and data does not go through innerHTML. */
  const ic = document.createElement('span');
  ic.className = 'ic'; ic.textContent = track.ic;
  const label = document.createElement('span');
  label.className = 'bg-name'; label.textContent = track.name;
  const art = {'deep-mind':'night','inner-stillness':'mirror','the-sanctuary':'clouds','ocean-escape':'waters','soft-asmr':'bedroom'}[track.key];
  if (art){ const image = document.createElement('img'); image.src = '/img/covers/' + art + '.webp'; image.alt = ''; image.className = 'ambience-art'; face.appendChild(image); }
  else face.appendChild(ic);
  face.appendChild(label);
  if (track.blurb){ const desc = document.createElement('span'); desc.className = 'ambience-description'; desc.textContent = track.blurb; face.appendChild(desc); }
  if (track.blurb) face.setAttribute('title', track.blurb);
  face.onclick = () => selectAmbienceFromCard(track.key);
  card.appendChild(face);

  /* None has nothing to hear. Every other sound, recorded or generated on the
     spot, gets the same small Preview control. */
  if (track.key !== 'none'){
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'bg-preview-btn';
    play.dataset.key = track.key;
    play.innerHTML = PREVIEW_PLAY_MARK + '<span>Preview</span>';
    play.onclick = (ev) => toggleAmbiencePreview(ev, track.key);
    card.appendChild(play);
  }
  return card;
}

/* Tapping a card. Writes the candidate, repaints, and starts listening — in
   that order, and the first two synchronously, so the mark lands in the frame
   the tap happened in rather than whenever the mp3 arrives. */
/* Selecting a card must actually select it. Preview remains a separate control. */
function selectAmbienceFromCard(key){
  stopAmbiencePreview();
  ambienceCandidate = key;
  if (key === 'none') {
    state.bg = 'none';
    state.bgLayer = 'none';
  } else {
    chooseAmbience(key);
    warmAmbience(state.bg);
    warmAmbience(state.bgLayer);
  }
  paintBgCards();
  // Keep the choice visible in assistive technology as well as visually.
  const status = document.getElementById('ambienceMsg');
  if (status) status.textContent = key === 'none'
    ? 'No background sound selected.'
    : ambienceName(key) + ' selected. You can add one from the other category or continue.';
}

function auditionAmbience(key){
  ambienceCandidate = key;
  paintBgCards();
  if (key === 'none'){ stopAmbiencePreview(); return; }
  startAmbiencePreview(key);
}

function toggleAmbiencePreview(ev, key){
  if (ev){ ev.stopPropagation(); ev.preventDefault(); }
  if (previewBed.playing() && previewBed.key === key){ stopAmbiencePreview(); return; }
  ambienceCandidate = key;
  paintBgCards();
  startAmbiencePreview(key);
}

/* A preview needs a context, and on iOS a context may only be opened and
   unlocked inside the gesture that asked for it — so this is deliberately not
   async before the context exists. audioOut() and the silent keeper are the
   same ones the session uses: on a phone with the ringer switch off, Web Audio
   is silenced and a media element is not, and a preview that cannot be heard
   is worse than no preview at all. */
function startAmbiencePreview(key){
  stopSerenityPreview();
  if (typeof stopPlayerAmbiencePreview === 'function') stopPlayerAmbiencePreview();
  const msg = document.getElementById('ambienceMsg');
  if (msg) msg.textContent = '';
  if (finalPlaying){
    // A session is running. Auditioning would have to stop its ambience to
    // honour one-track-at-a-time, and silently pulling the bed out from under
    // a session nobody asked to interrupt is not a preview.
    if (msg) msg.textContent = 'Stop the session first — ambience previews and a running session share the speaker.';
    return;
  }
  try {
    if (!previewCtx || previewCtx.state === 'closed'){
      previewCtx = new (window.AudioContext || window.webkitAudioContext)();
      previewBed.attach(previewCtx, audioOut(previewCtx));
    }
    if (previewCtx.state === 'suspended') previewCtx.resume().catch(()=>{});
    startSilentKeeper();
  } catch(e){
    if (msg) msg.textContent = 'This device would not open the speaker for a preview.';
    return;
  }
  if (!previewLayerBed.ctx || previewLayerBed.ctx !== previewCtx) previewLayerBed.attach(previewCtx, audioOut(previewCtx));
  previewBed.setLevel(0.85);
  previewLayerBed.setLevel(0.85);
  // One preview at a time: the last one is cut, not crossfaded under this one.
  previewBed.stop({ fade: 0 });
  previewBed.to(key).then(() => paintBgCards());
  // Heard with the other family's pick, the way the session will play them.
  const family = ambienceFamily(key);
  const partner = family ? ambiencePicks()[family === 'meditation' ? 'nature' : 'meditation'] : null;
  previewLayerBed.to(partner || 'none');
  paintBgCards();

  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => stopAmbiencePreview(), AMBIENCE_PREVIEW_MS);
}

function stopAmbiencePreview(){
  clearTimeout(previewTimer); previewTimer = null;
  previewBed.stop({ fade: 0 });
  previewBed.detach(); // invalidates pending downloads before they can start
  previewLayerBed.stop({ fade: 0 });
  previewLayerBed.detach();
  const ctx = previewCtx; previewCtx = null;
  if (ctx){ closeAudioOut(ctx); try { ctx.close(); } catch(e){} }
  paintBgCards();
  if (!finalPlaying) stopSilentKeeper();
}


/* THE ONLY WRITE TO state.bg FROM THIS SCREEN. */
function confirmAmbience(){
  stopAmbiencePreview();
  // Card taps are immediate selections; Preview never silently overwrites them.
  // The explicit Continue control always progresses, whether the user chose
  // one sound, layered two families, or selected no background sound.
  if (step === 5) nextStep();
}

/* Take one layer off, leaving the other. */
function removeAmbienceLayer(){
  stopAmbiencePreview();
  if (!ambienceCandidate) return;
  removeAmbience(ambienceCandidate);
  ambienceCandidate = state.bg;
  paintBgCards();
}

renderBgGrid();

/* ---------------- Ritual-only: second, layered voice ---------------- */
let layerVoiceEnabled = false;
let layerVoiceMode = 'ai'; // 'ai' | 'own'
async function toggleLayerVoice(checked){
  const panel = document.getElementById('layerVoicePanel');
  const msg = document.getElementById('layerVoiceMsg');
  const toggle = document.getElementById('layerVoiceToggle');
  msg.textContent = '';
  if (!checked){ layerVoiceEnabled = false; panel.classList.remove('open'); return; }
  const myTier = currentUser ? await getMyTier() : 'none';
  if (!tierHasFeature(myTier, 'layer_voice')){
    toggle.checked = false;
    openUpgradeModal('layer_voice', { tier: myTier, trigger: 'layer_voice_toggle' });
    return;
  }
  layerVoiceEnabled = true;
  panel.classList.add('open');
}
function paintLayerVoiceOptions(){
  syncSelectionByData('.layer-voice-options button', 'mode', layerVoiceMode);
}
function pickLayerVoiceMode(btn){
  layerVoiceMode = btn.dataset.mode;
  paintLayerVoiceOptions();
  answered(btn);
}

function startNextPhase(serenityCleared){
  if (serenityCleared !== true && selectedVoiceFromState() === VOICE_SERENITY){
    serenityAllowedToContinue().then(ok => { if (ok && step === 5) startNextPhase(true); });
    return;
  }
  /* Blank lines are dropped (they have nothing to say); no line with words in it is. */
  state.affirmations = state.affirmations.filter(a=>a.trim().length>0);
  if (!state.affirmations.length){
    if (state.visualizationMode) state.affirmations = [buildVisualizationFallback()];
    else if (state.eftMode) state.affirmations = buildEftFallbackList();
    else state.affirmations = buildFallbackList();
  }

  state.layerAffirmations = layerVoiceEnabled
    ? document.getElementById('layerAffText').value.split('\n').map(l=>l.trim()).filter(Boolean)
    : [];
  if (layerVoiceEnabled && !state.layerAffirmations.length) state.layerAffirmations = state.affirmations.slice();
  state.layerVoiceMode = layerVoiceEnabled ? layerVoiceMode : null;

  /* ---------------- THE FORK ----------------
     Read off the answer to the question on the voice screen, and nothing else.
     Three answers, three routes, stated rather than inferred:

       record_own   -> the affirmation-by-affirmation recorder (step 6)
       serenity     -> straight to assembly; Serenity reads the lines (step 7)
       clone_voice  -> straight to assembly in their own cloned voice (step 7),
                       or back to the clone setup if the clone is not made yet

     The layered second voice is a separate question with its own answer, and it
     is the only other thing that can need the recorder. */
  const voice = selectedVoiceFromState();

  /* No answer at all. Continue is disabled until there is one, so this is only
     reachable if something went wrong -- and the wrong thing to do about it is
     guess. It used to fall through to a build with no voice; before that, to
     the recorder. Neither is what anybody asked for, so ask. */
  if (!voice){
    showStep(4);
    paintVoiceCards();
    sayInVoicePicker('Choose whose voice reads your affirmations, and this is ready to build.', 'err');
    return;
  }

  /* Chose their own voice as a clone but never finished making it. They are not
     sent to the line-by-line recorder for it -- that is a different feature and
     not what they asked for. Back to the picker, with the setup open. */
  if (voice === VOICE_CLONE && state.aiVoiceId !== MY_CLONED_VOICE){
    showStep(4);
    paintVoiceCards(VOICE_CLONE);
    sayInVoicePicker('One more step — give us at least 1 minute of your voice below and it will be ready.', 'err');
    openMyVoicePanel();
    return;
  }

  const limitProblem = voiceLimitProblem();
  if (limitProblem){
    showStep(4);
    paintVoiceCards();
    sayInVoicePicker('');
    paintVoiceLimitNote();
    return;
  }
  const needsPrimaryRecording = voice === VOICE_RECORD_OWN;
  const needsLayerRecording = layerVoiceEnabled && layerVoiceMode === 'own';

  if (needsPrimaryRecording){
    beginRecordingPass('primary');
  } else if (needsLayerRecording){
    beginRecordingPass('layer');
  } else {
    prepareFinal(); showStep(7);
  }
}

/* Opening the recorder is one operation: which pass, from the top, with an
   answers-shaped array to record into and the copy that goes with it. Every
   caller goes through here, so there is no way to arrive on step 6 with the
   index, the array and the lines disagreeing. */
function beginRecordingPass(target){
  recordTarget = target;
  recIndex = 0;
  if (target === 'layer') layerRecordings = new Array(state.layerAffirmations.length).fill(null);
  else reconcileRecordings();
  setRecordStepCopy(target);
  showStep(6);   // showStep draws the line; see showRecordLine()
}

function setRecordStepCopy(target){
  const title = document.getElementById('recordFlowTitle');
  const sub = document.getElementById('recordFlowSub');
  const breath = document.getElementById('recordBreathNote');
  const tap = typeof recTapMode === 'function' && recTapMode();
  const how = tap ? 'tap to start, speak the line, tap again to finish — and you can pause in the middle' : 'press and hold, speak the line, then release';
  if (target === 'layer'){
    title.textContent = "Record your second, layered voice";
    sub.textContent = `This plays quietly underneath your main voice — ${how}.`;
    breath.style.display = 'none';
  } else if (state.visualizationMode){
    title.textContent = "Read your visualization out loud";
    sub.textContent = tap ? "Tap to start, read through the whole script in one take, and tap again when you're done. You can pause in the middle." : "Press and hold, read through the whole script in one take, then release when you're done.";
    breath.style.display = '';
  } else {
    title.textContent = "Record in your own voice";
    sub.textContent = tap ? 'Tap to start, speak the line, tap again to finish. You can pause in the middle.' : 'Press and hold, speak the line, then release.';
    breath.style.display = '';
  }
}

/* ---------------- step 6: recording (own voice) ---------------- */
let recIndex = 0; let recordings = [];
/* How many affirmations in a row the device voice failed to say. Reset by any
   line that actually speaks. See deviceSpeak. */
let deviceSpeechFailures = 0;
/* Why the recordings for a saved subliminal could not be fetched, if they
   couldn't. Empty means nothing went wrong — which is not the same as there
   being nothing to play. See loadSavedIntoBuilder. */
let recordingLoadErrors = [];
let recordTarget = 'primary'; // 'primary' | 'layer'
let layerRecordings = [];
const waveform = document.getElementById('waveform'); const bars = [];
for (let i=0;i<20;i++){ const d=document.createElement('div'); d.style.height='4px'; waveform.appendChild(d); bars.push(d); }

function activeRecordLines(){ return recordTarget === 'layer' ? state.layerAffirmations : state.affirmations; }
function activeRecordArray(){ return recordTarget === 'layer' ? layerRecordings : recordings; }

/* WHAT THE RECORD SCREEN SAYS, derived from the lines and the index and nothing
   else -- the same rule as the voice cards. It runs whenever step 6 opens (see
   showStep) as well as on every advance, so the screen cannot be reached in a
   state it has not drawn.

   The reported bug was the first line reading "..." under a correct dynamic count.
   Both of those strings are the placeholders in index.html: the screen had been
   opened without this function ever running (see nextStep), so nothing had
   replaced either. The counter looked right purely because the placeholder
   happened to say the same thing the first line would have. Nothing here was
   ever off by one -- recIndex starts at 0 and `lines[recIndex]` is line one --
   it simply was not called.

   The guard below is the other half: a line can only be drawn once there are
   lines. Rather than printing "..." over missing data, it says what is actually
   happening and leaves the controls alone until there is something to record. */
function recordLinesReady(){
  const lines = activeRecordLines();
  return Array.isArray(lines) && lines.length > 0;
}
function showRecordLine(){
  const counterEl = document.getElementById('recCounter');
  const lineEl = document.getElementById('recLine');
  if (!counterEl || !lineEl) return;

  const lines = activeRecordLines(); const arr = activeRecordArray();
  if (!recordLinesReady()){
    counterEl.textContent = '';
    lineEl.textContent = 'Preparing your affirmations…';
    lineEl.classList.add('record-line-loading');
    document.getElementById('recTapHint').style.display = 'none';
    document.getElementById('recStatus').textContent = 'one moment';
    document.getElementById('nextLineBtn').disabled = true;
    document.getElementById('skipBtn').disabled = true;
    return;
  }
  lineEl.classList.remove('record-line-loading');
  document.getElementById('skipBtn').disabled = false;
  paintRecAuto();
  /* An index past the end is a bug somewhere upstream, but it must not show up
     here as the word "undefined" in quotes. */
  if (recIndex < 0 || recIndex >= lines.length) recIndex = 0;

  const isEftPoint = state.eftMode && recordTarget === 'primary' && EFT_LINE_POINTS[recIndex];
  const isScript = state.visualizationMode && recordTarget === 'primary';
  const ownList = recordTarget === 'primary' && !isEftPoint && !isScript;
  const doneCount = arr.reduce((c, r, i) => c + (i < lines.length && r ? 1 : 0), 0);
  counterEl.textContent = isEftPoint
    ? `Line ${recIndex+1} of 11 — ${EFT_LINE_POINTS[recIndex].label}`
    : (isScript ? 'Your full script — one continuous take'
      : recordTarget === 'layer' ? `Second voice · ${recIndex+1} of ${lines.length}`
      : `Recording ${recIndex+1} of ${lines.length} · ${doneCount} recorded`);
  const prog = document.getElementById('recProgress');
  if (prog){
    prog.hidden = !ownList;
    const pct = lines.length ? Math.round(doneCount / lines.length * 100) : 0;
    prog.setAttribute('aria-valuenow', String(pct));
    prog.setAttribute('aria-valuetext', `${doneCount} of ${lines.length} affirmations recorded`);
    const fill = document.getElementById('recProgressFill'); if (fill) fill.style.width = pct + '%';
  }
  lineEl.textContent = '"'+lines[recIndex]+'"';
  document.getElementById('recTapHint').textContent = isEftPoint
    ? (EFT_LINE_POINTS[recIndex].isSetup
        ? `Tap continuously: ${EFT_LINE_POINTS[recIndex].where}`
        : `Tap: ${EFT_LINE_POINTS[recIndex].where}`)
    : '';
  document.getElementById('recTapHint').style.display = isEftPoint ? 'block' : 'none';
  document.getElementById('recLine').classList.toggle('record-line-script', isScript);
  if (!recBusy()) document.getElementById('recStatus').textContent = recTapMode() ? 'tap to start recording' : 'press and hold to record';
  const nextBtn = document.getElementById('nextLineBtn');
  nextBtn.disabled = !arr[recIndex];
  nextBtn.textContent = recIndex >= lines.length - 1 ? 'Finish →' : 'Next line →';
  paintRecordManager();
}
function skipLine(){ advanceLine(); }
function nextLine(){ advanceLine(); }
function advanceLine(){
  const lines = activeRecordLines();
  if (recIndex < lines.length-1){ recIndex++; showRecordLine(); return; }
  // Finished this pass. If we just finished the primary voice and a layer recording
  // is still needed, seamlessly continue into the layer pass instead of leaving step 6.
  if (recordTarget === 'primary' && layerVoiceEnabled && layerVoiceMode === 'own'){
    beginRecordingPass('layer');
    return;
  }
  prepareFinal(); showStep(7);
}

/* ---------------- the recording manager ----------------
   Every affirmation, with what it needs: view it, edit it, move it, delete it,
   record it, record it again. It sits under the hold-to-record button and works
   on the same two arrays the player reads -- state.affirmations and recordings,
   index for index -- so what is on this list is what will play.

   A take remembers the words it was recorded for (take.text). Edit a line after
   recording it and the take is kept, not thrown away, but the row says the words
   have changed so you can re-record it. Nothing here deletes anything the
   person did not ask to delete. */
let recEditingIndex = -1;
function recManagerEditable(){ return !state.eftMode && !state.visualizationMode; }
function recTakeStatus(i){
  const take = recordings[i];
  if (!take) return 'none';
  return take.text != null && take.text !== state.affirmations[i] ? 'stale' : 'ok';
}
function fmtTakeLength(ms){
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/* The recordings, made to line up with the affirmations again after anything
   that changed the list (editing it in step 3, a regenerate, a reopen). A take
   follows its words: matched first by identical text, so moving or deleting a
   line in step 3 never attaches a take to the wrong sentence. A take whose line
   was only edited in place keeps its slot, marked as changed. */
function reconcileRecordings(){
  const old = Array.isArray(recordings) ? recordings.slice() : [];
  const used = new Set();
  const lines = state.affirmations || [];
  const next = lines.map((text, i) => {
    const same = old[i];
    if (same && same.text === text && !used.has(same)){ used.add(same); return same; }
    const found = old.find(r => r && !used.has(r) && r.text === text);
    if (found){ used.add(found); return found; }
    return null;
  });
  if (old.length === lines.length){
    next.forEach((r, i) => { if (!r && old[i] && !used.has(old[i])){ next[i] = old[i]; used.add(old[i]); } });
  }
  recordings = next;
}
/* Where each take is on its way to the person's account. Taken from the take
   itself (see js/take-sync.js), never remembered separately, so the label can
   only say what is true. */
function recSyncState(take){
  if (!take || !take.blob) return take && take.path ? 'synced' : 'none';
  if (take.path) return 'synced';
  if (take._sync) return 'syncing';
  if (take.syncError) return 'failed';
  return 'local';
}
let recRepaintQueued = false;
function scheduleRecordRepaint(){
  if (recRepaintQueued) return;
  recRepaintQueued = true;
  (window.requestAnimationFrame || setTimeout)(() => {
    recRepaintQueued = false;
    if (step === 6) { paintRecordManager(); updateRecordProgress(); }
  });
}
function updateRecordProgress(){
  const lines = activeRecordLines(); const arr = activeRecordArray();
  if (!recordLinesReady() || recordTarget !== 'primary' || state.eftMode || state.visualizationMode) return;
  const doneCount = arr.reduce((c, r, i) => c + (i < lines.length && r ? 1 : 0), 0);
  const counterEl = document.getElementById('recCounter');
  if (counterEl) counterEl.textContent = `Recording ${recIndex+1} of ${lines.length} · ${doneCount} recorded`;
  const pct = lines.length ? Math.round(doneCount / lines.length * 100) : 0;
  const prog = document.getElementById('recProgress');
  if (prog){ prog.setAttribute('aria-valuenow', String(pct)); prog.setAttribute('aria-valuetext', `${doneCount} of ${lines.length} affirmations recorded`); }
  const fill = document.getElementById('recProgressFill'); if (fill) fill.style.width = pct + '%';
}
let lastPaintedRecIndex = -1;
let recScrollListToCurrent = false;
function paintRecordManager(){
  const box = document.getElementById('recManager');
  if (!box) return;
  const show = recordTarget === 'primary' && state.voiceMode === 'own';
  box.hidden = !show;
  if (!show) return;
  const max = AffirmationKit.MAX_AFFIRMATIONS;
  const n = state.affirmations.length;
  const done = state.affirmations.filter((_, i) => recordings[i]).length;
  const syncing = recordings.filter(r => r && recSyncState(r) === 'syncing').length;
  const failed = recordings.filter(r => r && recSyncState(r) === 'failed').length;
  document.getElementById('recMgrCount').textContent = AffirmationKit.countLabel(n, max);
  document.getElementById('recMgrSummary').textContent = `${done} of ${n} recorded`
    + (syncing ? ` · saving ${syncing} to your account…` : '')
    + (failed ? ` · ${failed} not uploaded yet` : '');
  const retryAll = document.getElementById('recRetryAll');
  if (retryAll) retryAll.hidden = !failed;
  const editable = recManagerEditable();
  const addBtn = document.getElementById('recMgrAdd');
  addBtn.hidden = !editable;
  addBtn.disabled = n >= max;
  addBtn.textContent = n >= max ? `${AffirmationKit.countLabel(n, max)} — that is the most one subliminal holds` : `+ Add an affirmation (${AffirmationKit.countLabel(n, max)})`;
  const list = document.getElementById('recMgrList');
  /* Rebuilt on every change, so the scroll position is carried across: a person
     on line 71 who records it must not be thrown back to line 1. */
  const keepTop = list.scrollTop;
  /* ...and by the first visible row rather than by pixels, because rows change
     height as their status text changes ("saving…" -> "saved") and a pixel
     offset would drift off the row the person was looking at. */
  let anchor = null;
  if (list.children.length){
    const top0 = list.getBoundingClientRect().top;
    for (const child of list.children){
      const r = child.getBoundingClientRect();
      if (r.bottom > top0 + 1){ anchor = { i: Number(child.dataset.i), off: r.top - top0 }; break; }
    }
  }
  list.textContent = '';
  const mk = (cls, label, text, onclick, disabled) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text;
    b.setAttribute('aria-label', label); b.disabled = !!disabled; b.onclick = onclick; return b;
  };
  state.affirmations.forEach((line, i) => {
    const st = recTakeStatus(i);
    const sync = recSyncState(recordings[i]);
    const li = document.createElement('li');
    li.className = 'rm-row' + (i === recIndex ? ' current' : '') + (st !== 'none' ? ' recorded' : '');
    if (i === recIndex) li.setAttribute('aria-current', 'true');
    li.dataset.i = String(i);
    const num = document.createElement('span'); num.className = 'rm-num'; num.textContent = String(i + 1);
    li.appendChild(num);
    const body = document.createElement('div'); body.className = 'rm-body';
    if (recEditingIndex === i){
      const ta = document.createElement('textarea'); ta.className = 'rm-edit'; ta.value = line; ta.rows = 2;
      ta.setAttribute('aria-label', `Edit affirmation ${i + 1}`);
      ta.onkeydown = (ev) => { if (ev.key === 'Escape'){ recEditingIndex = -1; paintRecordManager(); } };
      body.appendChild(ta);
      const row = document.createElement('div'); row.className = 'rm-edit-actions';
      row.appendChild(mk('rm-btn rm-primary', 'Save this change', 'Save', () => recSaveEdit(i, ta.value)));
      row.appendChild(mk('rm-btn', 'Cancel editing', 'Cancel', () => { recEditingIndex = -1; paintRecordManager(); }));
      body.appendChild(row);
      setTimeout(() => { try { ta.focus(); } catch (e) {} }, 0);
    } else {
      const t = document.createElement('button'); t.type = 'button'; t.className = 'rm-text';
      t.textContent = line;
      t.setAttribute('aria-label', `Affirmation ${i + 1}: ${line}. Select to record this line.`);
      t.onclick = () => recSelect(i);
      body.appendChild(t);
      const status = document.createElement('small'); status.className = 'rm-status ' + st + (sync === 'syncing' || sync === 'failed' ? ' ' + sync : '');
      const where = sync === 'synced' ? ' · saved' : sync === 'syncing' ? ' · saving…' : sync === 'failed' ? ' · not uploaded yet — saved on this device'
        : (currentUser ? ' · saved on this device' : ' · saved on this device (sign in to keep it in your account)');
      status.textContent = st === 'none' ? 'Not recorded yet'
        : st === 'stale' ? 'Words changed since recording — re-record to match'
        : `Recorded${recordings[i].durationMs ? ' · ' + fmtTakeLength(recordings[i].durationMs) : ''}${where}`;
      body.appendChild(status);
    }
    li.appendChild(body);
    if (recEditingIndex !== i){
      const actions = document.createElement('div'); actions.className = 'rm-actions';
      actions.appendChild(mk('rm-btn rm-primary', `${st === 'none' ? 'Record' : 'Re-record'} affirmation ${i + 1}`, st === 'none' ? 'Record' : 'Re-record', () => recSelect(i, true)));
      if (st !== 'none') actions.appendChild(mk('rm-btn', recPlayingIndex === i ? `Stop playing affirmation ${i + 1}` : `Play your recording of affirmation ${i + 1}`, recPlayingIndex === i ? 'Stop' : 'Play', () => recPlayTake(i)));
      if (sync === 'failed') actions.appendChild(mk('rm-btn', `Retry saving affirmation ${i + 1} to your account`, 'Retry save', () => { syncTake(recordings[i]); scheduleRecordRepaint(); }));
      if (st !== 'none') actions.appendChild(mk('rm-btn', `Remove the recording of affirmation ${i + 1} (keeps the words)`, 'Remove recording', () => recDeleteTake(i)));
      if (editable){
        actions.appendChild(mk('rm-btn', `Edit affirmation ${i + 1}`, 'Edit', () => { recEditingIndex = i; paintRecordManager(); }));
        actions.appendChild(mk('rm-btn rm-icon', `Move affirmation ${i + 1} up`, '↑', () => recMove(i, -1), i === 0));
        actions.appendChild(mk('rm-btn rm-icon', `Move affirmation ${i + 1} down`, '↓', () => recMove(i, 1), i === n - 1));
        actions.appendChild(mk('rm-btn rm-danger', `Delete affirmation ${i + 1}`, 'Delete', () => recRemove(i), n <= MIN_AFFIRMATIONS));
      }
      li.appendChild(actions);
    }
    list.appendChild(li);
  });
  list.scrollTop = keepTop;
  if (anchor && list.children[anchor.i]){
    const drift = (list.children[anchor.i].getBoundingClientRect().top - list.getBoundingClientRect().top) - anchor.off;
    if (Math.abs(drift) > 0.5) list.scrollTop += drift;
  }
  if (recScrollListToCurrent || (lastPaintedRecIndex !== recIndex && lastPaintedRecIndex !== -1)){
    recScrollListToCurrent = false;
    const cur = list.children[recIndex];
    if (cur){ const top = cur.offsetTop - Math.max(0, (list.clientHeight - cur.offsetHeight) / 2); list.scrollTop = Math.max(0, top); }
  }
  lastPaintedRecIndex = recIndex;
}
function recBusy(){ return recPressed || recOpening; }
function recSelect(i, scroll){
  if (recBusy() || i < 0 || i >= state.affirmations.length) return;
  recEditingIndex = -1;
  recIndex = i;
  showRecordLine();
  if (scroll){ const panel = document.querySelector('.record-panel'); if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}
let recPlayback = null; let recPlayingIndex = -1;
function recStopPlayback(){
  recPlayingIndex = -1;
  if (!recPlayback) return;
  try { recPlayback.pause(); } catch (e) {}
  recPlayback = null;
}
/* Preview a take. Pressing Play on the one that is playing stops it. */
function recPlayTake(i){
  const wasPlaying = recPlayingIndex === i;
  recStopPlayback();
  if (wasPlaying){ scheduleRecordRepaint(); return; }
  const take = recordings[i];
  if (!take || !take.url) return;
  const a = new Audio(take.url);
  recPlayback = a; recPlayingIndex = i;
  const over = () => { if (recPlayback === a){ recPlayback = null; recPlayingIndex = -1; scheduleRecordRepaint(); } };
  a.onended = over; a.onerror = over;
  const p = a.play(); if (p && p.catch) p.catch(over);
  scheduleRecordRepaint();
}
/* Give a take back: its picture of the audio, its place in the upload queue,
   and -- when it never became part of a saved subliminal -- its uploaded file.
   A saved subliminal's files are never touched (see TakeSync.discard). The
   copy on this device is removed by the next draft save, after the new state is
   written, so a crash in between never leaves a draft pointing at nothing. */
function releaseTake(take){
  if (!take) return;
  if (take.url && String(take.url).startsWith('blob:')) { try { URL.revokeObjectURL(take.url); } catch(e){} }
  take._clip = null;
  if (take.blob) { try { takeSync.discard(take); } catch(e){} }
}
/* Remove just the recording of a line; the words stay and can be recorded again. */
function recDeleteTake(i){
  if (recBusy() || !recordings[i]) return;
  if (!window.confirm(`Remove your recording of affirmation ${i + 1}? The words stay, so you can record it again.`)) return;
  recStopPlayback();
  releaseTake(recordings[i]);
  recordings[i] = null;
  showRecordLine(); saveRecordingDraft();
}
function recJump(value){
  const n = state.affirmations.length;
  const k = parseInt(String(value || '').trim(), 10);
  const status = document.getElementById('recStatus');
  if (!Number.isFinite(k) || k < 1 || k > n){ if (status) status.textContent = `Pick a line from 1 to ${n}.`; return; }
  recScrollListToCurrent = true;
  recSelect(k - 1, true);
}
function recJumpNextUnrecorded(){
  const n = state.affirmations.length;
  for (let step = 1; step <= n; step++){
    const j = (recIndex + step) % n;
    if (!recordings[j]){ recScrollListToCurrent = true; recSelect(j, true); return; }
  }
  document.getElementById('recStatus').textContent = 'Every line has a recording.';
}
function recRetrySync(){
  takeSync.setFolder(syncFolder());
  recordings.forEach(t => { if (t && t.blob && !t.path) syncTake(t); });
  scheduleRecordRepaint();
}
/* Move, delete and add keep `recordings` in step with `state.affirmations`
   by doing the same thing to both. */
function recMove(i, dir){
  if (recBusy()) return;
  const to = i + dir;
  if (to < 0 || to >= state.affirmations.length) return;
  state.affirmations = AffirmationKit.moveItem(state.affirmations, i, to);
  recordings = AffirmationKit.moveItem(recordings, i, to);
  if (recIndex === i) recIndex = to; else if (recIndex === to) recIndex = i;
  recEditingIndex = -1;
  paintRecordManager(); showRecordLine(); saveRecordingDraft();
  const btn = document.querySelector(`#recMgrList .rm-row[data-i="${to}"] [aria-label^="Move affirmation ${to + 1} ${dir < 0 ? 'up' : 'down'}"]`);
  if (btn && !btn.disabled) btn.focus();
}
function recRemove(i){
  if (recBusy() || state.affirmations.length <= MIN_AFFIRMATIONS) return;
  const had = !!recordings[i];
  if (had && !window.confirm(`Delete affirmation ${i + 1} and its recording? This cannot be undone.`)) return;
  state.affirmations.splice(i, 1);
  const [gone] = recordings.splice(i, 1);
  recStopPlayback();
  releaseTake(gone);
  if (recIndex > i || recIndex >= state.affirmations.length) recIndex = Math.max(0, recIndex - 1);
  recEditingIndex = -1;
  showRecordLine(); saveRecordingDraft();
}
function recAdd(){
  if (recBusy()) return;
  const max = AffirmationKit.MAX_AFFIRMATIONS;
  if (state.affirmations.length >= max) return;
  state.affirmations.push('I am...');
  recordings.push(null);
  recIndex = state.affirmations.length - 1;
  recEditingIndex = recIndex;
  showRecordLine(); saveRecordingDraft();
  const list = document.getElementById('recMgrList');
  if (list && list.lastElementChild && list.lastElementChild.scrollIntoView) list.lastElementChild.scrollIntoView({ block: 'nearest' });
}
function recSaveEdit(i, text){
  const clean = String(text || '').trim();
  if (!clean){ recEditingIndex = -1; paintRecordManager(); return; }
  state.affirmations[i] = clean;
  recEditingIndex = -1;
  showRecordLine(); saveRecordingDraft();
}

/* ---------------- an unfinished recording survives a refresh ---------------- */
function draftOwner(){ return (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null; }
let draftSaveTimer = null;
/* Which take records the draft on this device currently holds, so a take that
   has been replaced or deleted can be dropped from disk once the draft that no
   longer mentions it has been written. */
let draftStoredIds = new Set();
let draftChain = Promise.resolve();
function saveRecordingDraft(){
  if (state.voiceMode !== 'own' || typeof DraftStore === 'undefined') return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => { draftChain = draftChain.then(flushRecordingDraft).catch(() => {}); }, 250);
}
/* Audio first, then the list that points at it, so the draft never names a take
   that is not on disk. Only takes that are new are written: line 90 is a single
   small write, not lines 1 to 90 again. */
async function flushRecordingDraft(){
  const owner = draftOwner();
  if (state.voiceMode !== 'own') return;
  const takes = state.affirmations.map((_, i) => recordings[i] || null);
  if (!takes.some(Boolean)){ await DraftStore.clear(owner); draftStoredIds = new Set(); return; }
  for (const t of takes){
    if (t && t.blob && !t._stored){
      TakeSyncKit.TakeSync.ensureId(t);
      t._stored = await DraftStore.putTake(owner, t.id, t);
    }
  }
  const ids = takes.map(t => (t && t._stored ? t.id : null));
  await DraftStore.saveMeta(owner, {
    affirmations: state.affirmations.slice(),
    takeIds: ids,
    freqLayers: FrequencyLayers.serializeFrequencyLayers(state.freqLayers),
    binauralBand: state.binauralBand || null,
    bg: state.bg, bgLayer: state.bgLayer, soothingLayer: state.soothingLayer,
    targetLengthMinutes: state.targetLengthMinutes,
    eftMode: !!state.eftMode, visualizationMode: !!state.visualizationMode,
  });
  const keep = new Set(ids.filter(Boolean));
  for (const id of draftStoredIds) if (!keep.has(id)) await DraftStore.deleteTake(owner, id);
  draftStoredIds = keep;
}
/* Remove uploaded recordings that no saved subliminal points at. This is the
   only way anything in the recordings bucket is ever deleted from the app, and
   it asks first: a file that any of this person's subliminals lists is kept, and
   if that list cannot be read nothing is removed at all. A leftover file costs a
   few kilobytes; a deleted recording is gone. */
async function removeUnreferencedRecordings(paths){
  const list = [...new Set((paths || []).filter(Boolean))];
  if (!list.length || typeof sb === 'undefined' || !sb || typeof currentUser === 'undefined' || !currentUser) return;
  try {
    const { data, error } = await sb.from('subliminals').select('recording_urls, layer_recording_urls').eq('user_id', currentUser.id);
    if (error || !Array.isArray(data)) return;
    const used = new Set();
    data.forEach(r => [].concat(r.recording_urls || [], r.layer_recording_urls || []).forEach(p => { if (p) used.add(p); }));
    const doomed = list.filter(p => !used.has(p));
    if (doomed.length) await sb.storage.from('recordings').remove(doomed);
  } catch(e){ /* see above: when in doubt, keep it */ }
}
/* `purge`: also remove what this draft uploaded to the person's account -- only
   uploads that never became part of a saved subliminal (see above). */
function discardRecordingDraft(opts){
  clearTimeout(draftSaveTimer);
  if (opts && opts.purge){
    (recordings || []).forEach(t => { try { takeSync.discard(t); } catch(e){} });   // waits for an upload still in flight
    const extra = (opts.paths || []).filter(p => !(recordings || []).some(t => t && t.path === p));
    if (extra.length) removeUnreferencedRecordings(extra);
  }
  draftStoredIds = new Set();
  draftChain = draftChain.then(() => (typeof DraftStore !== 'undefined' ? DraftStore.clear(draftOwner()) : undefined)).catch(() => {});
}
let pendingDraft = null;
async function checkRecordingDraft(){
  const banner = document.getElementById('draftBanner');
  if (!banner || typeof DraftStore === 'undefined') return;
  const d = await DraftStore.load(draftOwner());
  const has = d && Array.isArray(d.takes) && d.takes.some(t => t && t.blob) && Array.isArray(d.affirmations) && d.affirmations.length;
  // Only offered on an empty builder: never over something being built.
  const idle = !state.affirmations.length && !editingExistingId && step === 0;
  pendingDraft = has ? d : null;
  banner.hidden = !(has && idle);
  if (has && idle){
    const recorded = d.takes.filter(t => t && t.blob).length;
    document.getElementById('draftBannerText').textContent =
      `You have an unfinished recording: ${recorded} of ${d.affirmations.length} affirmations recorded.`;
  }
}
function resumeRecordingDraft(){
  const d = pendingDraft;
  if (!d) return;
  document.getElementById('draftBanner').hidden = true;
  state.affirmations = d.affirmations.slice();
  recordings = d.takes.map((t, i) => t && t.blob
    ? { id: t.id || TakeSyncKit.makeId(), url: URL.createObjectURL(t.blob), blob: t.blob, durationMs: t.durationMs || undefined, text: t.text != null ? t.text : d.affirmations[i], path: t.path || null, committed: false, _stored: !!t.id }
    : null);
  draftStoredIds = new Set(recordings.filter(r => r && r._stored).map(r => r.id));
  state.eftMode = !!d.eftMode; state.visualizationMode = !!d.visualizationMode;
  state.bg = d.bg || 'none'; state.bgLayer = d.bgLayer || 'none'; state.soothingLayer = d.soothingLayer || 'none';
  state.binauralBand = d.binauralBand || null;
  if (d.targetLengthMinutes) state.targetLengthMinutes = d.targetLengthMinutes;
  setFrequencyLayers(FrequencyLayers.normalizeFrequencyLayers(d.freqLayers, FREQ_HZ_LIST), { silent:true });
  if (!state.freqLayers.length) setFrequencyLayers([{ hz: 528, vol: 100 }], { silent:true });
  setSelectedVoice(VOICE_RECORD_OWN);
  beginRecordingPass('primary');
  const firstOpen = recordings.findIndex(r => !r);
  recIndex = firstOpen >= 0 ? firstOpen : 0;
  recScrollListToCurrent = true;
  showRecordLine();
  // An older draft is rewritten in the new layout; anything not yet in the
  // account is sent now.
  saveRecordingDraft();
  syncPendingTakes();
}
function dismissRecordingDraft(){
  document.getElementById('draftBanner').hidden = true;
  const paths = pendingDraft ? DraftStore.paths(pendingDraft) : [];
  pendingDraft = null;
  discardRecordingDraft({ purge: true, paths });
}

/* ---------------- saving each recording as it is made ----------------
   Every take goes to the person's own private folder in the recordings bucket
   the moment it exists (js/take-sync.js). Signed out, it simply stays on the
   device and goes up at sign-in or at Save. */
const takeSync = new TakeSyncKit.TakeSync({
  upload: (path, blob, mime) => sb.storage.from('recordings').upload(path, blob, { contentType: mime }),
  remove: (paths) => removeUnreferencedRecordings(paths),
  extFor: (mime) => extForMime(mime),
  onChange: () => scheduleRecordRepaint(),
});
function syncFolder(){ return typeof sb !== 'undefined' && sb && typeof currentUser !== 'undefined' && currentUser && currentUser.id ? `${currentUser.id}/takes` : null; }
function syncTake(take){
  if (!take || !take.blob) return Promise.resolve(false);
  takeSync.setFolder(syncFolder());
  const owner = draftOwner();
  return takeSync.enqueue(take).then(ok => {
    if (ok && take.id && typeof DraftStore !== 'undefined' && take._stored) DraftStore.patchTake(owner, take.id, { path: take.path });
    scheduleRecordRepaint();
    return ok;
  });
}
function syncPendingTakes(){
  if (!syncFolder()) return;
  recordings.forEach(t => { if (t && t.blob && !t.path) syncTake(t); });
}
/* The connection came back, or somebody signed in: whatever is waiting goes up. */
window.addEventListener('online', () => { recordings.forEach(t => { if (t) t.syncError = null; }); syncPendingTakes(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncPendingTakes(); });

/* ---------------- how many lines each voice can carry ----------------
   Chosen after the lines are written, so a person can arrive at the voice screen
   holding more lines than the voice they pick will read. The answer is never to
   cut them: the continue is held, the reason is said, and the lines are exactly
   as they were. Switching back to Record Your Own Voice lifts the hold. */
function voiceLimitProblem(){
  if (state.eftMode || state.visualizationMode) return '';
  return AffirmationKit.overLimitMessage(nonEmptyAffirmationCount(), state.selectedVoice || selectedVoiceFromState());
}
function paintVoiceLimitNote(){
  const note = document.getElementById('voiceLimitNote');
  if (!note) return;
  const n = nonEmptyAffirmationCount();
  const fixed = state.eftMode || state.visualizationMode;
  const problem = voiceLimitProblem();
  const over = n > AffirmationKit.AFFIRMATION_LIMITS.serenity && !fixed;
  note.hidden = !over;
  note.className = 'voice-limit-note' + (problem ? ' blocked' : '');
  note.textContent = !over ? '' : (problem || `You have ${n} affirmations. Record Your Own Voice reads up to ${AffirmationKit.AFFIRMATION_LIMITS.own}; Serenity and Clone Your Voice read up to ${AffirmationKit.AFFIRMATION_LIMITS.serenity}.`);
  const fix = document.getElementById('voiceLimitFix');
  if (fix) fix.hidden = !problem;
}
/* What is saved for each line, alongside the audio: its place in the order, how
   long the take is, where it falls in a pass at the current pace, and the words
   it was recorded for. null when the voice is not a recording (there is no take
   to time). */
function buildAffirmationMeta(){
  if (!state || state.voiceMode !== 'own' || !Array.isArray(state.affirmations) || !state.affirmations.length) return null;
  const durations = state.affirmations.map((_, i) => (recordings[i] && recordings[i].durationMs) || 0);
  const plan = AffirmationKit.planTimings(durations, { gapMs: affirmationGapMs, repeats: eftRepeatsForIndex });
  return state.affirmations.map((text, i) => ({
    order: i,
    durationMs: durations[i],
    startMs: plan[i].startMs,
    endMs: plan[i].endMs,
    recordedText: recordings[i] ? (recordings[i].text != null ? recordings[i].text : text) : null,
  }));
}

/* Recording format. Chrome and Android record WebM/Opus; Safari records MP4/AAC.
   decodeAudioData on Safari cannot read WebM at all, so a library recorded on a
   laptop used to play back as pure silence on an iPhone — the decode promise
   rejected and nothing caught it. Record in whatever this browser supports, keep
   the real content type with the file, and fall back to an <audio> element
   (which understands far more than decodeAudioData) when decoding fails. */
function pickRecordingMime(){
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const candidates = ['audio/webm;codecs=opus','audio/webm','audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/ogg;codecs=opus'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}
function extForMime(mime){
  const m = (mime || '').toLowerCase();
  if (m.indexOf('webm') !== -1) return 'webm';
  if (m.indexOf('mp4') !== -1 || m.indexOf('m4a') !== -1 || m.indexOf('aac') !== -1) return 'm4a';
  if (m.indexOf('ogg') !== -1) return 'ogg';
  if (m.indexOf('wav') !== -1) return 'wav';
  if (m.indexOf('mpeg') !== -1 || m.indexOf('mp3') !== -1) return 'mp3';
  return 'webm';
}
/* Clips saved before the fix all claim to be audio/webm whether they are or not,
   so trust the bytes rather than the label when handing one to an <audio> tag. */
function sniffAudioMime(bytes){
  if (bytes.length > 4 && bytes[0]===0x1A && bytes[1]===0x45 && bytes[2]===0xDF && bytes[3]===0xA3) return 'audio/webm';
  if (bytes.length > 12 && bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70) return 'audio/mp4';
  if (bytes.length > 4 && bytes[0]===0x4F && bytes[1]===0x67 && bytes[2]===0x67 && bytes[3]===0x53) return 'audio/ogg';
  if (bytes.length > 4 && bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46) return 'audio/wav';
  if (bytes.length > 3 && bytes[0]===0x49 && bytes[1]===0x44 && bytes[2]===0x33) return 'audio/mpeg';
  return '';
}

/* Turn a recording into something playable on THIS device, once per session.
   Returns {kind:'buffer'} where decodeAudioData works, {kind:'element'} where it
   doesn't. Rejects — loudly — when neither can play it, so the session can say so
   instead of running silently for twenty minutes. */
async function loadClip(ctx, rec){
  if (rec._clip && rec._clipCtx === ctx) return rec._clip;
  const raw = rec.blob || await (await fetch(rec.url)).blob();
  const bytes = new Uint8Array(await raw.slice(0, 16).arrayBuffer());
  const trueMime = sniffAudioMime(bytes) || raw.type || 'audio/webm';
  const blob = raw.type === trueMime ? raw : new Blob([raw], { type: trueMime });
  let clip = null;
  try {
    const buf = await blob.arrayBuffer();
    clip = { kind: 'buffer', buffer: await ctx.decodeAudioData(buf) };
  } catch (e){
    const el = new Audio();
    const objectUrl = URL.createObjectURL(blob);
    el.src = objectUrl;
    el.preload = 'auto';
    await new Promise((resolve, reject) => {
      el.oncanplaythrough = resolve;
      el.onerror = () => reject(new Error('unplayable recording (' + trueMime + ')'));
      el.load();
    });
    clip = { kind: 'element', el, objectUrl };
  }
  rec._clip = clip; rec._clipCtx = ctx;
  // The length of the take, kept with it: it is saved as the line's timing metadata.
  const dur = clip.kind === 'buffer' ? clip.buffer.duration : clip.el.duration;
  if (Number.isFinite(dur) && dur > 0) rec.durationMs = Math.round(dur * 1000);
  return clip;
}

/* A hundred recordings decoded at once is a hundred seconds of uncompressed
   audio held in memory for the whole session -- on a phone, that is what gets a
   long subliminal killed in the background. Past this many lines, only the line
   being spoken and the one after it stay decoded; the rest are let go and decoded
   again when the loop comes round (a few milliseconds each), and the next line
   is decoded ahead of time so the gap between lines does not change. Short lists
   are left exactly as they were. */
const CLIP_WINDOW_OVER = 24;
function releaseClip(rec){
  const c = rec && rec._clip;
  if (!c) return;
  rec._clip = null; rec._clipCtx = null;
  if (c.kind === 'element'){
    try { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); } catch(e){}
    if (c.objectUrl) { try { URL.revokeObjectURL(c.objectUrl); } catch(e){} }
  }
}
function keepClipsNear(ctx, recorded, idx){
  if (recorded.length <= CLIP_WINDOW_OVER) return;
  const next = recorded[(idx + 1) % recorded.length].r;
  const keep = new Set([recorded[idx].r, next]);
  recorded.forEach(x => { if (!keep.has(x.r) && x.r._clip) releaseClip(x.r); });
  // A decode that finishes after the session has been stopped must not be kept.
  loadClip(ctx, next).then(() => { if (!finalPlaying || finalCtx !== ctx) releaseClip(next); }).catch(() => {});
}

/* Play one loaded clip through `gainValue`, calling onended when it finishes.
   `meta.index`, when given, is the affirmation this clip IS: the timeline is told
   when its sound actually begins and when it actually ends. The quiet second
   voice passes no meta, so it can never light a line. */
function playClip(ctx, clip, gainValue, extraDest, onended, meta){
  const lineIndex = meta && Number.isInteger(meta.index) ? meta.index : null;
  if (clip.kind === 'buffer'){
    const g = ctx.createGain(); g.gain.value = gainValue;
    g.connect(audioOut(ctx));
    if (extraDest && extraDest !== audioOut(ctx)) g.connect(extraDest);
    const src = ctx.createBufferSource(); src.buffer = clip.buffer;
    src.connect(g);
    liveVoiceGains.add(g);
    src.onended = () => { liveVoiceGains.delete(g); if (lineIndex !== null) lineEnded(lineIndex); if (onended) onended(); };
    src.start();
    if (lineIndex !== null) lineStarted(lineIndex);
    return;
  }
  // createMediaElementSource can only ever be called once per <audio> element,
  // so the element's graph is built once and reused for every repeat.
  if (!clip.gain){
    clip.gain = ctx.createGain();
    ctx.createMediaElementSource(clip.el).connect(clip.gain);
    clip.gain.connect(audioOut(ctx));
    if (extraDest && extraDest !== audioOut(ctx)) clip.gain.connect(extraDest);
  }
  clip.gain.gain.value = gainValue;
  liveVoiceGains.add(clip.gain);
  liveVoiceElements.add(clip.el);
  let started = false;
  // `playing` is when the element is really sounding -- including after a pause
  // that landed before it began, which resumeFinal answers with a fresh play().
  clip.el.onplaying = () => { if (!started && lineIndex !== null){ started = true; lineStarted(lineIndex); } };
  const done = () => { liveVoiceGains.delete(clip.gain); liveVoiceElements.delete(clip.el); clip.el.onplaying = null; if (lineIndex !== null && started) lineEnded(lineIndex); if (onended) onended(); };
  clip.el.onended = done;
  try { clip.el.currentTime = 0; } catch(e){}
  const p = clip.el.play();
  if (p && p.catch) p.catch(() => {
    // Refused because a pause landed first: resumeFinal plays it on from here.
    if (finalPaused && liveVoiceElements.has(clip.el)) return;
    done();
  });
}

let mediaRecorder, audioChunks=[], holdStart=0, micStream, recCtx, analyser, dataArray, animId;
/* True from the instant a press lands until the release, which is not the same
   as "the button is showing as recording": the microphone has to be opened
   first, and that is an await.

   The gap mattered. A press on a phone fires touchstart and, on plenty of
   browsers, a mouse event behind it; a double tap does the same. Both landed
   inside that await, so two MediaRecorders started on two microphone streams
   and both pushed into the one `audioChunks` array -- one line recorded twice,
   overlapping, which is what came back doubled on playback. A flag set
   synchronously closes the gap: the second press has nothing to start. */
let recPressed = false;
let recOpening = false;
const recBtn = document.getElementById('recBtn');

/* TWO WAYS TO RECORD. Hold the button (the original) or tap to start, tap to
   finish -- which is what makes Pause and Resume possible, and what a long
   line or a long session is more comfortable with. The choice is remembered on
   this device. */
const REC_MODE_KEY = 'fthr_rec_mode';
const REC_AUTO_KEY = 'fthr_rec_auto_next';
let recModePref = 'hold';
try { recModePref = localStorage.getItem(REC_MODE_KEY) === 'tap' ? 'tap' : 'hold'; } catch(e){}
function recTapMode(){ return recModePref === 'tap'; }
function setRecMode(mode){
  if (recBusy()) return;
  recModePref = mode === 'tap' ? 'tap' : 'hold';
  try { localStorage.setItem(REC_MODE_KEY, recModePref); } catch(e){}
  paintRecMode();
  if (step === 6) showRecordLine();
}
function paintRecMode(){
  document.querySelectorAll('#recModeRow .rec-mode-btn').forEach(b => {
    const on = b.dataset.mode === recModePref;
    b.classList.toggle('sel', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  if (!recBtn.classList.contains('recording')) recBtn.textContent = recTapMode() ? 'TAP' : 'HOLD';
  setRecordStepCopy(recordTarget);
}
/* Move on by itself after each recording. Off by default for a short list, on
   for a long one, unless the person has said which they want. */
function recAutoNext(){
  let pref = null;
  try { pref = localStorage.getItem(REC_AUTO_KEY); } catch(e){}
  if (pref === '1') return true;
  if (pref === '0') return false;
  return recordTarget === 'primary' && state.affirmations.length > 10;
}
function setRecAutoNext(on){ try { localStorage.setItem(REC_AUTO_KEY, on ? '1' : '0'); } catch(e){} }
function paintRecAuto(){ const box = document.getElementById('recAutoNext'); if (box) box.checked = recAutoNext(); }

/* The take being recorded right now. Pause time is kept out of its length; a
   cancelled take is thrown away instead of saved. */
let recTake = null;
function recTakeHeldMs(t, now){
  return Math.max(0, (now - t.started) - t.pausedTotal - (t.pausedAt ? now - t.pausedAt : 0));
}
function paintTapControls(){
  const box = document.getElementById('recTapControls');
  if (!box) return;
  const live = !!recTake && recBtn.classList.contains('recording') && recTapMode();
  box.hidden = !live;
  const pause = document.getElementById('recPauseBtn');
  if (pause){
    pause.textContent = recTake && recTake.pausedAt ? 'Resume' : 'Pause';
    pause.hidden = !(recTake && recTake.recorder && typeof recTake.recorder.pause === 'function');
  }
  recBtn.classList.toggle('paused', !!(recTake && recTake.pausedAt));
}
function toggleRecPause(){
  const t = recTake;
  if (!t || !t.recorder || t.recorder.state === 'inactive') return;
  const status = document.getElementById('recStatus');
  try {
    if (!t.pausedAt && t.recorder.state === 'recording'){
      t.recorder.pause(); t.pausedAt = Date.now();
      cancelAnimationFrame(animId);
      bars.forEach(b=>{ b.style.height='4px'; b.classList.remove('live'); });
      status.textContent = 'paused — tap Resume to carry on, or tap the button to finish';
    } else if (t.pausedAt && t.recorder.state === 'paused'){
      t.recorder.resume(); t.pausedTotal += Date.now() - t.pausedAt; t.pausedAt = 0;
      status.textContent = "listening… tap the button when you're done";
      if (analyser) animateBars();
    }
  } catch(e){ status.textContent = 'Could not pause — tap the button to finish this take.'; }
  paintTapControls();
}
/* Throw this take away without touching any recording that is already saved
   for the line. */
function cancelRecTake(){
  if (!recTake) return;
  recTake.cancelled = true;
  stopRec();
}

async function startRec(e){
  if (e && e.preventDefault) e.preventDefault();
  if (recPressed || recOpening || recBtn.classList.contains('recording')) return;
  recPressed = true;
  stopAmbiencePreview();
  stopSerenityPreview();
  if (typeof stopPlayerAmbiencePreview === 'function') stopPlayerAmbiencePreview();
  recStopPlayback();
  if (finalPlaying) stopFinal();
  recOpening = true;
  try{ micStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, channelCount:1}}); }
  catch(err){ recPressed = false; document.getElementById('recStatus').textContent="Microphone access is needed — check your browser permissions. Nothing you have recorded is affected."; return; }
  finally { recOpening = false; }
  /* Let go while the microphone was still opening. Nothing was recorded, so
     the stream is handed straight back rather than left running. */
  if (!recPressed){
    micStream.getTracks().forEach(t=>t.stop());
    document.getElementById('recStatus').textContent = recTapMode() ? 'Cancelled — tap again to record.' : 'Too quick — hold a little longer.';
    return;
  }
  // Timed from when the microphone is actually live, so the wait for a
  // permission prompt is never mistaken for a long recording.
  holdStart = Date.now(); audioChunks=[];
  const recMime = pickRecordingMime();
  let takeRecorder;
  try { takeRecorder = recMime ? new MediaRecorder(micStream, { mimeType: recMime }) : new MediaRecorder(micStream); }
  catch(err){
    micStream.getTracks().forEach(t=>t.stop());
    recPressed = false;
    document.getElementById('recStatus').textContent = "This device couldn't start recording just now. Try this line again — your other recordings are safe.";
    return;
  }
  mediaRecorder = takeRecorder;
  const takeStream = micStream, takeChunks = [];
  const take = recTake = { recorder: takeRecorder, started: holdStart, pausedAt: 0, pausedTotal: 0, cancelled: false, failed: false };
  const takeIndex = recIndex, takeRecords = activeRecordArray(), takeTarget = recordTarget;
  const takeText = activeRecordLines()[takeIndex];
  takeRecorder.ondataavailable = ev=>{ if (ev.data && ev.data.size) takeChunks.push(ev.data); };
  /* A recorder that fails ends THIS take only. The microphone is given back,
     the line is left exactly as it was, and the person is told to try again --
     nothing else in the session is touched. */
  takeRecorder.onerror = () => {
    take.failed = true;
    resetRecButton();
    document.getElementById('recStatus').textContent = `Something interrupted recording line ${takeIndex + 1}. Tap to try it again — nothing else was affected.`;
    try { if (takeRecorder.state !== 'inactive') takeRecorder.stop(); } catch(e){}
  };
  takeRecorder.onstop = ()=>{
    takeStream.getTracks().forEach(t=>t.stop());
    if (recTake === take) recTake = null;
    const status = document.getElementById('recStatus');
    if (take.cancelled){ status.textContent = 'Take cancelled — this line is as it was.'; paintTapControls(); return; }
    if (take.failed){ paintTapControls(); return; }
    const held = recTakeHeldMs(take, Date.now());
    const blob = new Blob(takeChunks, {type: takeRecorder.mimeType || recMime || 'audio/webm'});
    if (!(held > 400 && blob.size > 0)){
      status.textContent = recTapMode() ? 'That was very short — tap and speak a little longer.' : 'Too quick — hold a little longer.';
      paintTapControls();
      return;
    }
    const url = URL.createObjectURL(blob);
    /* The words travel with the take: they are what lets an edited or moved
       line be told apart from one that still matches its recording. */
    const replaced = takeRecords[takeIndex];
    const saved = { id: TakeSyncKit.makeId(), url, blob, durationMs: held, text: takeText, committed: false };
    takeRecords[takeIndex] = saved;
    // The take it replaces is no longer reachable: give its audio back.
    if (replaced && replaced !== saved) releaseTake(replaced);
    showRecordLine();
    document.getElementById('nextLineBtn').disabled = !activeRecordArray()[recIndex];
    let message = 'Saved — record again to redo it.';
    if (takeTarget === 'primary'){
      message = currentUser ? 'Saved — sending it to your account…' : 'Saved on this device.';
      saveRecordingDraft();                                    // on this device, right away
      // ...and on to the account once the device copy is written, so the
      // draft always knows the upload's path. Recording carries on meanwhile.
      draftChain = draftChain.then(flushRecordingDraft).catch(() => {}).then(() => syncTake(saved)).then(ok => {
        const st = document.getElementById('recStatus');
        if (!st || recBusy() || recIndex !== takeIndex || recordings[takeIndex] !== saved) return;
        if (ok) st.textContent = 'Saved to your account — record again to redo it.';
        else if (syncFolder()) st.textContent = 'Saved on this device. Your account could not be reached yet — it keeps trying.';
      });
    }
    status.textContent = message;
    // A long list should not need a tap per line to move along.
    if (takeTarget === recordTarget && takeIndex === recIndex && recAutoNext() && recIndex < activeRecordLines().length - 1){
      recIndex++; recScrollListToCurrent = true; showRecordLine();
      status.textContent = `Saved line ${takeIndex + 1}. ${recTapMode() ? 'Tap' : 'Hold'} to record line ${recIndex + 1}.`;
    }
    paintTapControls();
  };
  takeRecorder.start();
  recBtn.classList.add('recording'); recBtn.textContent = recTapMode() ? '■' : '●';
  document.getElementById('recStatus').textContent = recTapMode() ? "listening… tap the button when you're done" : "listening… release when you're done";
  paintTapControls();
  recCtx = new (window.AudioContext||window.webkitAudioContext)();
  const src = recCtx.createMediaStreamSource(micStream);
  analyser = recCtx.createAnalyser(); analyser.fftSize=64; src.connect(analyser);
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  animateBars();
}
function animateBars(){
  analyser.getByteFrequencyData(dataArray);
  bars.forEach((bar,i)=>{ const v=dataArray[i%dataArray.length]||0; bar.style.height=Math.max(4,(v/255)*22)+'px'; bar.classList.add('live'); });
  animId = requestAnimationFrame(animateBars);
}
/* Everything about the button that says "recording", put back. */
function resetRecButton(){
  recPressed = false;
  recBtn.classList.remove('recording','paused'); recBtn.textContent = recTapMode() ? 'TAP' : 'HOLD';
  cancelAnimationFrame(animId);
  bars.forEach(b=>{ b.style.height='4px'; b.classList.remove('live'); });
  if (recCtx){ try{ recCtx.close(); }catch(e){} recCtx = null; }
  const box = document.getElementById('recTapControls'); if (box) box.hidden = true;
}
function stopRec(){
  // Released, whether or not the microphone ever opened -- startRec checks
  // this after its await and gives the stream back if it did not.
  if (!recPressed) return;
  if (!recBtn.classList.contains('recording')){ recPressed = false; return; }
  resetRecButton();
  if (mediaRecorder && mediaRecorder.state!=='inactive') mediaRecorder.stop();
}
/* Hold mode: down starts, up ends. Tap mode: a tap starts, the next tap ends,
   and leaving the button or lifting the finger means nothing. */
function recDown(e){
  if (recTapMode()){
    if (e && e.preventDefault) e.preventDefault();
    if (recPressed || recBtn.classList.contains('recording')){ stopRec(); return; }
    startRec(e);
    return;
  }
  startRec(e);
}
function recUp(e){ if (!recTapMode()) stopRec(e); }
/* Pointer events where they exist, which is one event per press however the
   press was made. The mouse/touch pair below is the fallback, and only one of
   the two sets is ever attached -- a browser that has both used to report a
   single tap as a touch and a mouse press. */
if (window.PointerEvent){
  recBtn.addEventListener('pointerdown', recDown);
  recBtn.addEventListener('pointerup', recUp);
  recBtn.addEventListener('pointercancel', recUp);
  recBtn.addEventListener('pointerleave', recUp);
} else {
  recBtn.addEventListener('mousedown', recDown);
  recBtn.addEventListener('mouseup', recUp);
  recBtn.addEventListener('mouseleave', recUp);
  recBtn.addEventListener('touchstart', recDown);
  recBtn.addEventListener('touchend', recUp);
  recBtn.addEventListener('touchcancel', recUp);
}
/* Keyboard: Space or Enter does what a tap does (tap mode) -- hold mode has no
   keyboard equivalent for "hold", so there it starts on press and ends on release. */
recBtn.addEventListener('keydown', e => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  if (e.repeat){ e.preventDefault(); return; }
  e.preventDefault(); recDown(e);
});
recBtn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); recUp(e); } });
paintRecMode();

/* ---------------- AMBIENCE ENGINE (synthesized, no audio files) ---------------- */
function makeNoiseBuffer(ctx, seconds, color){
  const bufferSize = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (color === 'brown'){
    let last = 0;
    for (let i=0;i<bufferSize;i++){ const white = Math.random()*2-1; last = (last + 0.02*white) / 1.02; data[i] = last * 3.2; }
  } else {
    for (let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
  }
  return buffer;
}
/* The generated backgrounds, and only those. A recorded track never reaches
   this function — it is fetched, decoded, level-matched and looped by the bed
   in js/ambience.js, which is also what fades between them. This used to carry
   a branch that played a recorded file if one existed for the key, with no
   fade, no level matching and a loop that ticked once per pass; the bed
   replaced all of it. */
function buildAmbience(ctx, key, destination){
  const nodes = []; const timers = [];
  if (key === 'none' || isRecordedAmbience(key)) return { stop(){} };
  const master = ctx.createGain(); master.gain.value = 1; master.connect(destination); nodes.push(master);

  function noiseLayer(color, hp, lp, gainVal){
    const src = ctx.createBufferSource(); src.buffer = makeNoiseBuffer(ctx, 4, color); src.loop = true;
    const hpF = ctx.createBiquadFilter(); hpF.type='highpass'; hpF.frequency.value = hp;
    const lpF = ctx.createBiquadFilter(); lpF.type='lowpass'; lpF.frequency.value = lp;
    const g = ctx.createGain(); g.gain.value = gainVal;
    src.connect(hpF).connect(lpF).connect(g).connect(master);
    src.start();
    nodes.push(src);
    return { src, filter:lpF, gain:g };
  }
  function pluck(freq, t, dest){
    const o = ctx.createOscillator(); o.type='triangle'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t+0.02); g.gain.exponentialRampToValueAtTime(0.0001, t+1.4);
    o.connect(g).connect(dest); o.start(t); o.stop(t+1.5);
  }
  function chirp(t, dest){
    const o = ctx.createOscillator(); o.type='sine';
    const base = 1800 + Math.random()*1400;
    o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base*1.4, t+0.08); o.frequency.exponentialRampToValueAtTime(base*0.8, t+0.16);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.06,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.2);
    o.connect(g).connect(dest); o.start(t); o.stop(t+0.25);
  }

  if (key === 'rain'){ noiseLayer('white', 1200, 6500, 0.28); }
  else if (key === 'waterfall'){ noiseLayer('white', 400, 7000, 0.36); }
  else if (key === 'ocean'){
    const layer = noiseLayer('white', 200, 2200, 0.3);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.16;
    lfo.connect(lfoGain).connect(layer.gain.gain); lfo.start(); nodes.push(lfo);
  }
  else if (key === 'forest'){
    noiseLayer('white', 300, 1800, 0.14);
    const id = setInterval(()=>{ if (Math.random()<0.5) chirp(ctx.currentTime + Math.random()*0.3, master); }, 1400);
    timers.push(id);
  }
  else if (key === 'birds'){
    const id = setInterval(()=>{ chirp(ctx.currentTime + Math.random()*0.2, master); if (Math.random()<0.4) chirp(ctx.currentTime+0.3, master); }, 900);
    timers.push(id);
  }
  else if (key === 'thunder'){
    noiseLayer('brown', 40, 500, 0.18);
    const id = setInterval(()=>{
      if (Math.random() < 0.3){
        const o = ctx.createBufferSource(); o.buffer = makeNoiseBuffer(ctx, 1.2, 'brown');
        const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=180;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.3, ctx.currentTime+0.3); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+2.2);
        o.connect(lp).connect(g).connect(master); o.start(); o.stop(ctx.currentTime+2.3);
      }
    }, 4000);
    timers.push(id);
  }
  else if (key === 'brown'){ noiseLayer('brown', 20, 1200, 0.4); }

  return { stop(){ timers.forEach(clearInterval); try{ master.disconnect(); }catch(e){} } };
}

/* ---------------- step 7: final assembly & playback ---------------- */
// Tracks whether the subliminal on screen is a fresh build or an edit of something
// already saved — if it's an edit, saving must produce a new row with a new title,
// rather than silently overwriting the original.
let editingExistingId = null;
// True once this content has been saved at least once in the current session — even
// a fresh build that was just saved needs a new title if it's changed again afterward
// (e.g. re-recording), same as anything reopened via "Load & adjust".
let contentAlreadySaved = false;
function prepareFinal(){
  document.getElementById('finalTitle').textContent = frequencyTitle();
  document.getElementById('finalLine').textContent = '"'+(state.affirmations[0]||'')+'"';
  document.getElementById('finalLine').classList.toggle('final-line-script', !!state.visualizationMode);
  document.getElementById('customMixRow').style.display = customTrackBlob ? 'flex' : 'none';
  document.getElementById('layerVoiceMixRow').style.display = layerVoiceEnabled ? 'flex' : 'none';
  document.getElementById('finalNote').textContent = "Subliminally plays here on the website, and soon in the app — sessions aren't downloadable files, so your ritual stays part of your membership rather than sitting forgotten in a downloads folder.";
  document.getElementById('rerecordBtn').style.display = (state.voiceMode === 'own') ? 'inline-flex' : 'none';
  renderFinalFreqPicker();
  renderFinalAmbiencePicker();
  /* Start the ambience download now, while somebody is reading this screen and
     naming their subliminal, rather than in the second after they press play. */
  warmAmbience(state.bg); warmAmbience(state.bgLayer);
  updateFinalPointTag(0);

  const titleInput = document.getElementById('finalTitleInput');
  const titleMsg = document.getElementById('finalTitleMsg');
  titleMsg.textContent = '';
  titleInput.classList.remove('needs-title');
  if (editingExistingId){
    // A saved subliminal is edited in place: it keeps its title, and Save
    // updates the same row. "Save as new" is the only way to make a copy.
    titleInput.value = state.playerTitle || '';
    titleInput.placeholder = 'Name this subliminal';
  } else {
    titleInput.value = '';
    titleInput.placeholder = state.freq ? `e.g. "${frequencyTitle().replace(' · ', ' — ')}"` : 'Name this subliminal';
  }
  paintFinalSaveButtons();

  /* The one place the session's voice is generated: as this screen opens, for a
     subliminal just built and for one loaded out of the library. Not per play, and
     not per minute of the length they chose. */
  prepareSessionVoice();
}
/* Which save the final screen offers: a fresh build saves to the library; a
   saved one saves its changes in place, and can be copied on purpose. */
function paintFinalSaveButtons(){
  const editing = !!editingExistingId;
  const save = document.getElementById('saveBtn');
  const label = document.getElementById('saveBtnLabel');
  if (label) label.textContent = editing ? 'Save changes' : 'Save to my library';
  if (save) save.setAttribute('aria-label', editing ? 'Save changes to this subliminal' : 'Save to my library');
  ['saveAsNewBtn','finalAdjustBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = editing ? 'inline-flex' : 'none';
  });
}
/* Sends you back to the recording step to redo your voice on this subliminal.
   Existing recordings come along, so lines you don't touch stay exactly as they
   were — only the ones you actually hold-record again get replaced. */
function rerecordVoice(){
  if (state.voiceMode !== 'own') return;
  stopFinal();
  recordTarget = 'primary';
  recIndex = 0;
  reconcileRecordings();
  setRecordStepCopy('primary');
  showStep(6);
}
/* Shows which tapping point (or the setup statement) the currently-playing line
   belongs to, whenever this subliminal was built in EFT mode. */
function updateFinalPointTag(index){
  const tag = document.getElementById('finalPointTag');
  if (!tag) return;
  if (state.eftMode && EFT_LINE_POINTS[index]){
    const p = EFT_LINE_POINTS[index];
    tag.style.display = 'inline-block';
    tag.textContent = p.isSetup
      ? `Setup Statement · tap ${p.where}`
      : `Line ${index+1} of 11 — ${p.label} · tap ${p.where}`;
  } else {
    tag.style.display = 'none';
  }
}

/* ---------------- THE THREE LAYERS, AND WHY THEY NEVER TOUCH ----------------

   A finished session is three things playing at once, and all three can be
   changed on this screen without the other two noticing:

     the affirmation voice   generated once, per person, and cached — the one
                             expensive thing in the app
     the ambience            a shared recording, looped by sessionBed
     the frequency layer     two oscillators, free, retuned in place

   The rule this screen exists to hold: CHANGING THE AMBIENCE, THE FREQUENCY
   OR THE SESSION LENGTH MUST NEVER REGENERATE THE VOICE. Not "should rarely" —
   never. Somebody who decides at 11pm that they want the ocean instead of the
   pad is changing the background of a recording that already exists; if that
   cost them another pass through the speech provider it would be slow, it
   would cost money, and on a metered plan it could fail outright and leave
   them with silence where their affirmations were.

   Which is why the three functions below are the whole of it. None of them
   calls prepareFinal(), prepareSessionVoice(), or anything that leads there:

     changeFinalFrequency    retunes the live oscillators
     changeSessionAmbience   crossfades the bed
     pickDuration / the length slider   move a number and a label

   prepareSessionVoice() is called from exactly one place — prepareFinal(),
   when this screen opens — and that is the only place it should ever be
   called from. */

/* You can change the frequency right on the finished/loaded subliminal — no need to
   rebuild the whole thing from scratch. Works for a freshly-built one and for anything
   reloaded via "Load & adjust" in My Library. */
function renderFinalFreqPicker(){
  const wrap = document.getElementById('finalFreqPicker');
  if (!wrap) return;
  wrap.style.display = frequencyLayerList().length ? 'block' : 'none';
  paintFrequencyUi();
}
/* Set the tone to one frequency: the older single-choice entry point, kept for
   anything that still thinks in one frequency. It replaces the stack. */
function changeFinalFrequency(hzStr){
  const hz = parseInt(hzStr, 10);
  if (!frequencyByHz(hz)) return;
  setFrequencyLayers([{ hz, vol: FrequencyLayers.DEFAULT_LAYER_VOLUME }]);
}

/* The brainwave (binaural) layer, changed on a finished subliminal. The mixer
   retunes the right ear in place between two bands, and fades each tone out and
   its replacement in when the beat is switched on or off, so a session no
   longer restarts to change it. */
function changeFinalBrainwave(prevBand){
  if (!finalPlaying || !finalCtx || !frequencyMixer.attached) return;
  frequencyMixer.setBand(currentBinauralBand());
}

/* The same idea for the ambience: a second picker on the finished subliminal,
   so the background can be changed on the way to sleep without rebuilding
   anything. Both ways round are handled here and there is nothing else to it:

     playing    the bed crossfades — out, in, one track audible at any moment
     not playing  the key is recorded and the next play starts on it

   Drawn as a select for the same reason the frequency picker is: it is a
   small change to a finished thing, not the choosing screen again. */
function renderFinalAmbiencePicker(){
  const wrap = document.getElementById('finalAmbiencePicker');
  const sel = document.getElementById('finalAmbienceSelect');
  if (!wrap || !sel) return;
  sel.innerHTML = ambienceSections().map(section =>
    `<optgroup label="${section.category}">` +
    section.tracks.map(t => `<option value="${t.key}">${t.name}</option>`).join('') +
    `</optgroup>`
  ).join('');
  sel.value = state.bg;
  wrap.style.display = 'block';
}

function changeSessionAmbience(key){
  if (!ambienceTrack(key)) return;
  chooseAmbience(key);                  // the answer, written first (keeps a layer from the other family)
  /* The ambience step is behind this screen and will be seen again. Moving its
     candidate with the answer is what stops it reopening with a confirm button
     offering to choose something they have already moved on from. */
  ambienceCandidate = key;
  paintBgCards();                       // the ambience step, still derived from it
  const sel = document.getElementById('finalAmbienceSelect');
  if (sel && sel.value !== key) sel.value = key;
  warmAmbience(key);
  /* Mid-session: the bed fades the old one out, starts the new one and fades
     it in, and guarantees the two are never both up. Not playing: nothing to
     fade, and the next play will pick this up off state.bg. */
  applySessionAmbience();
  saveAmbienceLayer();
}

let finalCtx=null, finalPlaying=false, finalRecorder=null, finalChunks=[], finalStream=null, finalTimeouts=[];
/* The session's ambience. One object, for the whole life of the page: it
   outlives the AudioContext, which is opened per play and closed after, so the
   ambience somebody chose is still the ambience when they press play again.
   See js/ambience.js for why exactly one of these is allowed to be audible. */
const sessionBed = new AmbienceBed('session');
/* The layer under it: the other family's pick (state.bgLayer). Same group, so
   the two play together; same level, from the one ambience slider. */
const sessionLayerBed = new AmbienceBed('session-layer', 'session');
/* A saved subliminal keeps its layer in mix_settings (see readMixSettings), so
   changing it mid-session is remembered the way a moved slider is. */
function saveAmbienceLayer(){
  if (typeof activeMixId !== 'undefined' && activeMixId && typeof queueMixSave === 'function') queueMixSave();
}
let finalStartTime=null, finalTimerInterval=null, finalPremiumPad=null;
/* No liveBgGain among these: the ambience level lives on sessionBed, because a
   handle on the gain node of whichever track happens to be playing is lost the
   moment the bed swaps it for another one. */
let finalPaused=false, finalPauseStarted=null, finalPausedTotal=0, finalFadeEnding=false;
let finalAffirmationIndex=0, finalRequestedIndex=null;
let finalPauseWaiters=[];
/* Bumped on every play, stop and finish. A callback carries the number it was
   made under, so a clip, a voice line or a timer left over from an earlier
   session can never play into the next one -- that was the second voice. */
let finalSession=0;
/* Which affirmation is being spoken, stamped on the session clock. The sounds
   report in (lineStarted / lineEnded) and the lyrics list reads it back out;
   nothing else decides what is highlighted. See js/affirmation-timeline.js. */
const affTimeline = new AffirmationKit.AffirmationTimeline({ now: () => getFinalElapsedMs() });
function lineStarted(index){ affTimeline.lineStart(index); }
function lineEnded(index){ affTimeline.lineEnd(index); }
/* Back to "nothing has played": a new play, Start Over, Stop, or the end. */
function resetAffTimeline(){
  affTimeline.reset();
  affTimeline.setCount((state.affirmations || []).length);
}
let liveToneGain=null, liveSoothingGain=null, liveCustomGain=null, customTrackSource=null, liveLayerVoiceGain=null;
/* Every gain node a voice line is currently playing through. A line is its own
   node that dies when the line ends, so unlike the tone and the background
   there is no single handle to hold — the set is what is live right now, and
   finished nodes are dropped as they end. Without this, dragging the voice
   volume did nothing until the *next* line started, which on a long line with
   gaps between repeats is indistinguishable from a broken slider. */
let liveVoiceGains = new Set();
let liveVoiceElements = new Set();
function voiceMixValue(){
  const el = document.getElementById('mixVoice');
  return el ? el.value/100 : 1;
}

/* Player time excludes pauses so the UI, completion record and timer agree. */
function getFinalElapsedMs(){
  if (!finalStartTime) return 0;
  const pendingPause = finalPaused && finalPauseStarted ? Date.now() - finalPauseStarted : 0;
  return Math.max(0, Date.now() - finalStartTime - finalPausedTotal - pendingPause);
}
function waitWhileFinalPaused(resume){
  if (!finalPaused) return false;
  if (!finalPauseWaiters.includes(resume)) finalPauseWaiters.push(resume);
  return true;
}
/* Pause is authoritative. Every callback the sequence is driven by -- a clip
   ending, a line finishing, a gap timer -- goes through this: from an earlier
   session it is dropped; while paused it is held, once, until resume, so
   nothing moves the affirmation on while the player says it is paused. */
function finalCallback(fn){
  if (fn && fn.__finalGuarded) return fn;   // one callback is held once, however it arrives
  const session = finalSession;
  let held = false;
  const guarded = function(...args){
    if (!finalPlaying || session !== finalSession) return;
    if (finalPaused){
      if (!held){ held = true; finalPauseWaiters.push(() => { held = false; guarded(...args); }); }
      return;
    }
    fn(...args);
  };
  guarded.__finalGuarded = true;
  return guarded;
}
/* A timer that belongs to the session: cleared by stop and finish, dropped
   from the list once it has fired, and held by a pause like any callback. */
function finalLater(fn, ms){
  const run = finalCallback(fn);
  const t = setTimeout(() => {
    const i = finalTimeouts.indexOf(t); if (i >= 0) finalTimeouts.splice(i, 1);
    run();
  }, ms);
  finalTimeouts.push(t);
  return t;
}
function pauseFinal(){
  if (!finalPlaying || finalPaused) return;
  finalPaused = true; finalPauseStarted = Date.now();
  affTimeline.pause();
  try { if (finalCtx && finalCtx.state !== 'closed'){ const p = finalCtx.suspend(); if (p && p.catch) p.catch(()=>{}); } } catch(e){}
  // The iOS route out of the graph, then every clip element mid-line.
  try { if (finalCtx && finalCtx.__outEl) finalCtx.__outEl.pause(); } catch(e){}
  liveVoiceElements.forEach(el => { try { el.pause(); } catch(e){} });
  try { window.speechSynthesis.pause(); } catch(e){}
  /* Some browsers accept pause() and go on speaking. There the line is cut
     instead; the utterance's own handler holds it and says it again on resume. */
  setTimeout(() => {
    try {
      const synth = window.speechSynthesis;
      if (finalPaused && synth && synth.speaking && !synth.paused) synth.cancel();
    } catch(e){}
  }, 150);
  stopSilentKeeper();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  updateMediaSessionPosition();
}
function resumeFinal(){
  if (!finalPlaying || !finalPaused) return;
  if (finalPauseStarted) finalPausedTotal += Date.now() - finalPauseStarted;
  finalPauseStarted = null; finalPaused = false;
  affTimeline.resume();
  startSilentKeeper();
  try { if (finalCtx && finalCtx.state !== 'closed' && finalCtx.state !== 'running'){ const p = finalCtx.resume(); if (p && p.catch) p.catch(()=>{}); } } catch(e){}
  try { if (finalCtx && finalCtx.__outEl){ const p = finalCtx.__outEl.play(); if (p && p.catch) p.catch(()=>{}); } } catch(e){}
  try { window.speechSynthesis.resume(); } catch(e){}
  // The same elements, from where they stopped: nothing new is created here.
  liveVoiceElements.forEach(el => {
    try {
      const p = el.play();
      if (p && p.catch) p.catch(() => { if (!finalPaused && typeof el.onended === 'function') el.onended(); });
    } catch(e){}
  });
  const waiters = finalPauseWaiters.splice(0);
  const session = finalSession;
  waiters.forEach(fn => { const t = setTimeout(() => { if (session === finalSession) fn(); }, 0); finalTimeouts.push(t); });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  updateMediaSessionPosition();
}
function seekFinalAffirmation(delta){
  const lines = state.affirmations || [];
  if (!lines.length) return;
  finalRequestedIndex = (finalAffirmationIndex + delta + lines.length) % lines.length;
  affTimeline.request(finalRequestedIndex);
}
/* Tap on a line in the list: it plays next, at the next line boundary. */
function seekFinalToIndex(index){
  const lines = state.affirmations || [];
  if (!finalPlaying || !Number.isInteger(index) || index < 0 || index >= lines.length) return;
  finalRequestedIndex = index;
  affTimeline.request(index);
}
function showFinalAffirmation(text, index){
  finalAffirmationIndex = Number.isInteger(index) ? index : finalAffirmationIndex;
  const el = document.getElementById('finalLine');
  if (el) el.textContent = '"'+(text || '')+'"';
  updateFinalPointTag(finalAffirmationIndex);
  if (typeof showImmersiveAffirmation === 'function') showImmersiveAffirmation(text || '');
}
/* The affirmations on the finished screen: every line, before anything is
   played, after recording, and when a saved subliminal is reopened. While it
   plays, the same timeline that drives the player lights the line being spoken. */
function renderFinalPlaylist(){
  const wrap = document.getElementById('finalPlaylistWrap');
  const list = document.getElementById('finalPlaylist');
  if (!wrap || !list) return;
  const lines = state.affirmations || [];
  wrap.hidden = !lines.length || !!state.visualizationMode;
  list.textContent = '';
  lines.forEach((text, i) => {
    const li = document.createElement('li');
    li.dataset.i = String(i);
    li.textContent = text;
    list.appendChild(li);
  });
  const count = document.getElementById('finalPlaylistCount');
  if (count) count.textContent = AffirmationKit.countLabel(lines.length, Math.max(lines.length, AffirmationKit.limitFor(state.selectedVoice || selectedVoiceFromState())));
  paintFinalPlaylist(affTimeline.snapshot());
}
function paintFinalPlaylist(snap){
  const list = document.getElementById('finalPlaylist');
  if (!list) return;
  Array.from(list.children).forEach((li, i) => {
    const st = (snap.states && snap.states[i]) || 'upcoming';
    if (li.dataset.state !== st) li.dataset.state = st;
    if (st === 'active') li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
  });
}
affTimeline.on(paintFinalPlaylist);

/* Swap only the ambience graph. Voice clips and the TTS cache are untouched. */
function changeFinalAmbience(key){
  chooseAmbience(key || 'none');
  applySessionAmbience();
  saveAmbienceLayer();
}

/* ---------- soothing layer picker ---------- */
/* ---------- custom track upload (Ritual only) ---------- */
let customTrackBlob = null;
async function triggerCustomTrackUpload(){
  const msg = document.getElementById('customTrackMsg');
  msg.textContent = '';
  const myTier = currentUser ? await getMyTier() : 'none';
  if (!tierHasFeature(myTier, 'custom_track')){
    openUpgradeModal('custom_track', { tier: myTier, trigger: 'custom_track_button' });
    return;
  }
  document.getElementById('customTrackFile').click();
}
document.addEventListener('DOMContentLoaded', () => {
  const f = document.getElementById('customTrackFile');
  if (f){
    f.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      customTrackBlob = file;
      document.getElementById('customTrackName').textContent = file.name;
    });
  }
});

/* Binaural beats are just audio physics, so unlike the soothing layer/custom track/
   layered voice, this isn't gated to any tier — it's available to everyone. */
function pickBinauralBand(btn){
  const band = btn.dataset.band;
  state.binauralBand = band === 'none' ? null : band;
  syncSelectionByData('#binauralChips .length-chip', 'band', state.binauralBand || 'none');
  answered(btn);
  const guideEl = document.getElementById('binauralGuideText');
  if (state.binauralBand){
    const b = BINAURAL_BANDS[state.binauralBand];
    guideEl.style.display = 'block';
    guideEl.textContent = `${b.label} (${b.range}) — ${b.guide}`;
  } else {
    guideEl.style.display = 'none';
  }
}
async function pickSoothingLayer(btn){
  const msg = document.getElementById('soothingMsg');
  const variant = btn.dataset.variant;
  msg.textContent = '';

  if (variant !== 'none'){
    const myTier = currentUser ? await getMyTier() : 'none';
    if (!tierHasFeature(myTier, 'soothing_layer')){
      openUpgradeModal('soothing_layer', { tier: myTier, trigger: 'soothing_chip' });
      return;
    }
  }

  setSoothingLayer(variant);
  answered(btn);
}
/* The answer, its chips, its fader row and the live pad, together — shared by
   the builder step, a reopened subliminal and the Adjust Sounds sheet. */
function setSoothingLayer(variant){
  state.soothingLayer = variant && variant !== 'none' ? variant : 'none';
  syncSelectionByData('#soothingChips .length-chip', 'variant', state.soothingLayer);
  const row = document.getElementById('soothingMixRow');
  if (row) row.style.display = state.soothingLayer === 'none' ? 'none' : 'flex';
  if (finalPlaying) restartSoothingLayer();
}
function restartSoothingLayer(){
  if (finalPremiumPad){ finalPremiumPad.stop(); finalPremiumPad = null; }
  if (state.soothingLayer && state.soothingLayer !== 'none' && finalCtx){
    const g = finalCtx.createGain();
    g.gain.value = document.getElementById('mixSoothing').value/100 * 0.4;
    g.connect(audioOut(finalCtx));
    liveSoothingGain = g;
    finalPremiumPad = addPremiumPadLayer(finalCtx, audioOut(finalCtx), state.soothingLayer, g);
  }
}

/* ---------- pace ----------
   This was a slider measured in seconds that started at 0.1, which meant every
   session opened with the lines running straight into each other, read at one
   unvarying speed, with no breath anywhere. That is the robotic sound: not the
   voice, the metronome behind it.

   So there is a pace to choose now, and it sets three things at once -- how long
   the silence between lines is, how fast the voice reads, and how much that
   silence is allowed to vary. The seconds control is still underneath for
   anyone who wants to set it exactly; picking a pace moves it.

   `jitter` is the part that matters most and costs least. A gap that is exactly
   2.2 seconds every single time is a click track. The same gap wandering by a
   fifth of itself is someone talking. */
const AFFIRMATION_PACES = [
  { key:'close',   label:'Close together', sub:'barely a breath', gap:0.8, speed:1.0,  jitter:0.10 },
  { key:'steady',  label:'Steady',         sub:'room to land',    gap:2.4, speed:0.92, jitter:0.18 },
  { key:'drifting',label:'Drifting',       sub:'for falling asleep', gap:4.5, speed:0.82, jitter:0.22 },
];
const DEFAULT_PACE = 'steady';
const DEFAULT_GAP_SECONDS = AFFIRMATION_PACES.find(p => p.key === DEFAULT_PACE).gap;
let affirmationPace = DEFAULT_PACE;
let affirmationGapMs = Math.round(DEFAULT_GAP_SECONDS * 1000);
function paceNow(){ return AFFIRMATION_PACES.find(p => p.key === affirmationPace) || AFFIRMATION_PACES[1]; }
/* What the player actually waits. Same gap, slightly different every time. */
function gapForNextLine(){
  const j = paceNow().jitter;
  return Math.round(affirmationGapMs * (1 + (Math.random() * 2 - 1) * j));
}
function setAffirmationGap(seconds){
  const v = Math.max(0.1, Math.min(10, seconds));
  affirmationGapMs = Math.round(v * 1000);
  state.affirmationGapMs = affirmationGapMs;
  const el = document.getElementById('lineGap');
  const readout = document.getElementById('lineGapVal');
  if (el) el.value = v;
  if (readout) readout.value = v;
}
function pickPace(btn){
  const p = AFFIRMATION_PACES.find(x => x.key === btn.dataset.pace);
  if (!p) return;
  affirmationPace = p.key;
  state.pace = p.key;
  syncSelectionByData('#paceChips .length-chip', 'pace', state.pace);
  setAffirmationGap(p.gap);
}
function renderPaceChips(){
  const wrap = document.getElementById('paceChips');
  if (!wrap) return;
  wrap.innerHTML = AFFIRMATION_PACES.map(p =>
    `<button type="button" role="radio" class="length-chip${p.key === affirmationPace ? ' sel' : ''}"
       aria-checked="${p.key === affirmationPace}"
       data-pace="${p.key}" onclick="pickPace(this)">${p.label}<span>${p.sub}</span></button>`).join('');
}
(function wireLineGap(){
  const el = document.getElementById('lineGap');
  const readout = document.getElementById('lineGapVal');
  if (!el || !readout) return;
  function apply(vSeconds){
    vSeconds = Math.max(0.1, Math.min(10, vSeconds));
    affirmationGapMs = Math.round(vSeconds * 1000);
    state.affirmationGapMs = affirmationGapMs;
  }
  el.addEventListener('input', ()=>{ readout.value = el.value; apply(parseFloat(el.value)); });
  readout.addEventListener('input', ()=>{
    let v = parseFloat(readout.value);
    if (isNaN(v)) return;
    v = Math.max(0.1, Math.min(10, v));
    el.value = v; apply(v);
  });
  readout.addEventListener('blur', ()=>{
    let v = parseFloat(readout.value);
    if (isNaN(v)) v = parseFloat(el.value);
    v = Math.max(0.1, Math.min(10, Math.round(v*10)/10));
    readout.value = v; el.value = v; apply(v);
  });
})();

/* Live volume readouts + real-time gain updates while a session is playing.
   Each row now has a slider AND a typeable percentage input, kept in sync both ways. */
/* The healing tone fades in over 2.5 seconds, and an AudioParam with a ramp
   still scheduled on it ignores a plain assignment to .value — so moving that
   slider during the fade did nothing at all, and felt broken. Clearing the
   schedule first makes the slider authoritative the moment you move it. */
function setLiveGain(node, v){
  if (!node || !finalCtx) return;
  const t = finalCtx.currentTime;
  try { node.gain.cancelScheduledValues(t); } catch(e){}
  try { node.gain.setValueAtTime(v, t); } catch(e){ node.gain.value = v; }
}
function applyLiveMixGain(id, value){
  if (typeof queueMixSave === 'function') queueMixSave();
  if (!finalPlaying) return;
  if (id==='mixTone'){ if (frequencyMixer.attached) frequencyMixer.setMasterLevel(FrequencyLayers.masterGainValue(value)); paintFrequencyWarnings(); }
  if (id==='mixVoice') paintFrequencyWarnings();
  /* The ambience level is the bed's, not a node's: it has to survive the bed
     swapping one track for another underneath it, which a handle on the gain
     node of the track that is currently playing does not. */
  if (id==='mixBg'){ sessionBed.setLevel(value/100); sessionLayerBed.setLevel(value/100); }
  if (id==='mixSoothing') setLiveGain(liveSoothingGain, value/100 * 0.4);
  if (id==='mixCustom') setLiveGain(liveCustomGain, value/100 * 0.6);
  if (id==='mixLayerVoice') setLiveGain(liveLayerVoiceGain, value/100);
  /* The affirmation volume reaches whatever is sounding right now as well as
     every line after it. It used to only be read when a line started. */
  if (id==='mixVoice') liveVoiceGains.forEach(g => setLiveGain(g, value/100));
}
['mixTone','mixBg','mixVoice','mixSoothing','mixCustom','mixLayerVoice'].forEach(id=>{
  const el = document.getElementById(id);
  const readout = document.getElementById(id+'Val');
  if (!el || !readout) return;
  el.addEventListener('input', ()=>{
    readout.value = el.value;
    applyLiveMixGain(id, el.value);
  });
  readout.addEventListener('input', ()=>{
    let v = parseInt(readout.value, 10);
    if (isNaN(v)) return;
    v = Math.max(0, Math.min(100, v));
    el.value = v;
    applyLiveMixGain(id, v);
  });
  readout.addEventListener('blur', ()=>{
    let v = parseInt(readout.value, 10);
    if (isNaN(v)) v = parseInt(el.value, 10);
    v = Math.max(0, Math.min(100, v));
    readout.value = v; el.value = v;
    applyLiveMixGain(id, v);
  });
});

// A slow, warm, evolving pad — three detuned low sines with a breathing volume swell.
// Sits quietly under everything else so the overall mix feels softer and less clinical.
// A generic "premium ambience" layer for paid tiers, not a copy of any specific track.
function addPremiumPadLayer(ctx, destination, variant, gainNode){
  const padGain = gainNode || ctx.createGain();
  if (!gainNode){ padGain.gain.value = 0; padGain.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 4); padGain.connect(destination); }

  if (variant === 'chimes'){
    const timers = [];
    const notes = [523.3, 587.3, 659.3, 784.0, 880.0];
    const id = setInterval(()=>{
      if (Math.random() < 0.5){
        const hz = notes[Math.floor(Math.random()*notes.length)];
        const o = ctx.createOscillator(); o.type='sine'; o.frequency.value = hz;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.3, ctx.currentTime+0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+3.5);
        o.connect(g).connect(padGain); o.start(); o.stop(ctx.currentTime+3.6);
      }
    }, 2600);
    timers.push(id);
    return { stop(){ timers.forEach(clearInterval); } };
  }

  if (variant === 'hum'){
    const o = ctx.createOscillator(); o.type='sine'; o.frequency.value = 55;
    const filter = ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=180;
    o.connect(filter).connect(padGain); o.start();
    return { stop(){ try{ o.stop(); }catch(e){} } };
  }

  // default: 'pad' — a warm, slow-moving three-voice drone
  const padFilter = ctx.createBiquadFilter(); padFilter.type='lowpass'; padFilter.frequency.value = 900;
  padFilter.connect(padGain);
  const voices = [110, 165, 220].map((hz, i) => {
    const o = ctx.createOscillator(); o.type='sine'; o.frequency.value = hz + i*0.6;
    o.connect(padFilter); o.start();
    return o;
  });
  const lfo = ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain).connect(padGain.gain); lfo.start();
  return { stop(){ [...voices, lfo].forEach(n => { try{ n.stop(); }catch(e){} }); } };
}

function startCustomTrackPlayback(){
  if (!customTrackBlob || !finalCtx) return;
  const g = finalCtx.createGain();
  g.gain.value = document.getElementById('mixCustom').value/100 * 0.6;
  g.connect(audioOut(finalCtx));
  liveCustomGain = g;
  customTrackBlob.arrayBuffer().then(buf => finalCtx.decodeAudioData(buf)).then(audioBuf => {
    if (!finalPlaying) return; // stopped before it finished decoding
    const src = finalCtx.createBufferSource();
    src.buffer = audioBuf; src.loop = true;
    src.connect(g); src.start();
    customTrackSource = src;
  }).catch(e => console.error('custom track playback failed:', e));
}

/* ---------- unlocking the speaker ----------
   A browser only lets audio start inside the tap that asked for it, and an
   `await` ends that tap. Playing from the library loads the recordings first,
   which means by the time the player started, the gesture was over: iOS handed
   back a suspended context, refused to resume it, and every oscillator and
   every clip played into nothing. The timer is a setInterval, so it counted up
   happily over total silence — which is exactly what it looked like.

   So the context is opened and unlocked in the tap itself, before anything is
   awaited. A one-sample silent buffer is what actually unlocks iOS; resume()
   alone is not enough there. */
/* ---------- the silent keeper ----------
   Kyla's sound check came back: she heard the <audio> tone and not the Web
   Audio one. That is the whole diagnosis. On an iPhone, Web Audio plays in the
   "ambient" category, which the ringer switch silences; an <audio> element
   plays in "playback", which it does not. Every oscillator, every recording and
   every nature sound in this app went through the first one, so a phone on
   silent ran an entire session making no sound at all — with the timer counting,
   because nothing was broken, it was just muted.

   A media element that is actually playing moves the whole app into the
   playback category, and Web Audio comes with it. So a silent loop runs for as
   long as the session does. It costs nothing audible and it is the difference
   between the app working and not working for anyone whose phone is on silent —
   which, for a thing you use at bedtime, is most people. */
/* The keeper is the session's one real, file-backed media element: the thing iOS
   holds on to when the screen locks or another app comes forward, and the
   element the lock screen's controls attach to. It used to be a two-sample
   file, which loops so fast that iOS can decide nothing is playing; it is now
   a few seconds long, with a signal a single bit above digital silence. */
function buildSilentWavUri(seconds, rate){
  const n = Math.floor(seconds * rate), bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, i % 2 ? 2 : -2, true);
  let bin = ''; for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  return 'data:audio/wav;base64,' + btoa(bin);
}
let silentKeeper = null;

function startSilentKeeper(){
  try {
    if (!silentKeeper){
      silentKeeper = new Audio(buildSilentWavUri(4, 8000));
      silentKeeper.loop = true;
      silentKeeper.volume = 0.05;   // not 0: iOS treats a truly silent element as nothing playing
      silentKeeper.setAttribute('playsinline', '');
      silentKeeper.addEventListener('pause', handleUnexpectedMediaPause);
    }
    const p = silentKeeper.play();
    if (p && p.catch) p.catch(() => {});
  } catch(e){}
}

/* ---------- interruptions ----------
   Nothing in this app pauses a session because the page was hidden, locked or
   navigated away from: the engine lives at the top of the page and the session
   is only ended by stopFinal / finishFinal. What *can* happen is that the
   system pauses the media elements itself (a call, Siri, an alarm, headphones
   unplugged) and the context goes with them. That is treated as a real pause,
   so the lock-screen Play button and the in-app one both resume the same
   session -- same elements, same position -- instead of there being a timer
   running over silence. */
function handleUnexpectedMediaPause(ev){
  // A pause event is queued, so one left over from a stop that a restart has since
  // answered (or from a retired output element) must not pause the new session.
  const el = ev && ev.target;
  if (el && (!el.paused || (el !== silentKeeper && el !== (finalCtx && finalCtx.__outEl)))) return;
  if (finalPlaying && !finalPaused) pauseFinal();
}
let finalRecoverTimer = null;
function recoverFinalAudio(){
  if (!finalPlaying || finalPaused) return;
  try { if (finalCtx && finalCtx.state !== 'closed' && finalCtx.state !== 'running'){ const p = finalCtx.resume(); if (p && p.catch) p.catch(()=>{}); } } catch(e){}
  [silentKeeper, finalCtx && finalCtx.__outEl].forEach(el => {
    if (!el || !el.paused) return;
    try { const p = el.play(); if (p && p.catch) p.catch(()=>{}); } catch(e){}
  });
  // Still not running a moment later: the system refused. Say so, so Play can resume it.
  clearTimeout(finalRecoverTimer);
  finalRecoverTimer = setTimeout(() => {
    if (finalPlaying && !finalPaused && finalCtx && finalCtx.state !== 'running') pauseFinal();
  }, 1500);
}
/* Coming back to the page is only a moment to look at the session, never a
   reason to restart it: the clock is wall time, so the position is right. */
function syncFinalAfterForeground(){
  if (!finalPlaying) return;
  recoverFinalAudio();
  updateSessionTimerLabel();
  if (typeof updateImmersivePlayer === 'function') updateImmersivePlayer();
  updateMediaSessionPosition();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncFinalAfterForeground(); });
window.addEventListener('pageshow', syncFinalAfterForeground);

/* ---------- lock screen ---------- */
function mediaSessionTotalSeconds(){
  return Math.max(60, (state.targetLengthMinutes || (typeof playerPrefs !== 'undefined' && playerPrefs.duration) || 20) * 60);
}
function updateMediaSessionPosition(){
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !finalPlaying) return;
  const total = mediaSessionTotalSeconds();
  try {
    navigator.mediaSession.setPositionState({ duration: total, playbackRate: 1, position: Math.min(total, getFinalElapsedMs() / 1000) });
  } catch(e){}
}
/* Lock-screen scrubbing moves the session clock; the voice carries on from where
   it is, and no layer is restarted. */
function seekFinalTo(seconds){
  if (!finalPlaying) return;
  const target = Math.max(0, Math.min(mediaSessionTotalSeconds(), Number(seconds) || 0)) * 1000;
  finalPausedTotal += getFinalElapsedMs() - target;
  updateSessionTimerLabel();
  if (typeof updateImmersivePlayer === 'function') updateImmersivePlayer();
  updateMediaSessionPosition();
}
function stopSilentKeeper(){
  if (!silentKeeper) return;
  try { silentKeeper.pause(); silentKeeper.currentTime = 0; } catch(e){}
}

/* ---------- the way out to the speaker ----------
   The sound check settled it: she hears an <audio> element and not Web Audio.
   On an iPhone, Web Audio plays in the "ambient" category, which the ringer
   switch silences; a media element plays in "playback", which it does not.
   Every layer in this app went straight to ctx.destination, so the whole
   session was ambient and the switch turned all of it off.

   A silent loop alongside it was not enough -- it is a separate element, and
   iOS was still free to treat the Web Audio graph as ambient. So the graph
   itself now leaves through a media element: one bus, into a
   MediaStreamDestination, into an <audio> that is genuinely playing.

   That route used to run *alongside* ctx.destination, on the theory that the
   same sound cannot play louder for leaving two ways. It does not play louder
   — it plays twice. A MediaStream element is a buffered pipeline and starts
   tens of milliseconds behind the direct path, so every voice, every line and
   every layer arrived once dry and once late: the echo and the doubling people
   heard on their own recordings and on the finished subliminal. Lowering a
   volume would have hidden it; there is only ever one route out of here now.

   iOS uses the media element exclusively. If playback is refused, disconnect
   that route before connecting the direct fallback; never wait for a playing
   event with both routes connected. */
function needsMediaElementOutput(){
  // iPhones and iPads, in the browser and inside the wrapped app. iPadOS 13+
  // reports itself as a Mac, so a Mac with a touchscreen counts as one too.
  if (typeof isNativeApp === 'function' && isNativeApp() && window.Capacitor.getPlatform() === 'ios') return true;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

function audioOut(ctx){
  if (!ctx) return null;
  if (ctx.__outBus) return ctx.__outBus;
  const bus = ctx.createGain();
  bus.gain.value = 1;
  ctx.__outDirect = false;
  ctx.__outBus = bus;
  /* The last stop before the speaker is a soft limiter (see softLimiterCurve in
     js/frequency-layers.js): identity below 0.8, rounded off above, so a pile-up
     of loud layers is shaped rather than clipped. Where the context cannot make
     one the bus goes straight out, as it always did. */
  let tail = bus;
  if (typeof ctx.createWaveShaper === 'function' && typeof FrequencyLayers !== 'undefined'){
    try {
      const pre = ctx.createGain(); pre.gain.value = 0.5;
      const shaper = ctx.createWaveShaper(); shaper.curve = FrequencyLayers.softLimiterCurve(); shaper.oversample = '2x';
      const post = ctx.createGain(); post.gain.value = 2;
      bus.connect(pre); pre.connect(shaper); shaper.connect(post);
      tail = post;
    } catch(e){ tail = bus; }
  }
  ctx.__outTail = tail;
  const useDirect = () => {
    if (ctx.__outClosed || ctx.__outDirect) return;
    if (ctx.__outMd) { try { tail.disconnect(ctx.__outMd); } catch(e){} }
    tail.connect(ctx.destination); ctx.__outDirect = true;
  };
  if (!needsMediaElementOutput()){ useDirect(); return bus; }
  try {
    const md = ctx.createMediaStreamDestination();
    const el = new Audio();
    el.srcObject = md.stream;
    el.setAttribute('playsinline', '');
    el.autoplay = true;
    el.addEventListener('pause', handleUnexpectedMediaPause);
    tail.connect(md);
    ctx.__outEl = el; ctx.__outMd = md;
    const p = el.play();
    if (p && p.catch) p.catch(useDirect);
  } catch(e){ useDirect(); }
  return bus;
}
function closeAudioOut(ctx){
  if (!ctx) return;
  ctx.__outClosed = true;
  const tail = ctx.__outTail || ctx.__outBus;
  if (tail){ try { tail.disconnect(); } catch(e){} }
  if (ctx.__outBus){ try { ctx.__outBus.disconnect(); } catch(e){} }
  if (!ctx.__outEl) return;
  try { ctx.__outEl.pause(); ctx.__outEl.srcObject = null; } catch(e){}
  ctx.__outEl = null;
  if (ctx.__outMd){ try { tail.disconnect(ctx.__outMd); } catch(e){} ctx.__outMd = null; }

}

function primeAudio(){
  // A paused session stays paused: only resumeFinal wakes its context.
  const holdPaused = finalPlaying && finalPaused;
  // Before the context, so the category is already right when it opens.
  if (!holdPaused) startSilentKeeper();
  if (!finalCtx || finalCtx.state === 'closed'){
    finalCtx = new (window.AudioContext||window.webkitAudioContext)();
    const ownCtx = finalCtx;
    ownCtx.onstatechange = () => { if (ownCtx === finalCtx && ownCtx.state !== 'running') recoverFinalAudio(); };
  }
  if (finalCtx.state === 'suspended' && !holdPaused) finalCtx.resume().catch(()=>{});
  try {
    const s = finalCtx.createBufferSource();
    s.buffer = finalCtx.createBuffer(1, 1, 22050);
    s.connect(audioOut(finalCtx));
    s.start(0);
  } catch(e){}
  return finalCtx;
}

function playFinal(){
  if (finalPlaying) return;
  /* A generated voice (Serenity or a clone) plays only audio that has already
     been generated AND checked. When it has not (still being made, the
     generation failed, or the words changed), this press waits for it -- or is
     the retry -- and then plays. The context is opened now, inside the tap, so
     the browser still lets it make a sound once the audio arrives. */
  if (isStudioVoiceSession() && studioReadyKey !== studioSequenceKey()){
    primeAudio();
    prepareStudioVoice().then(ready => {
      if (ready && !finalPlaying) playFinal();
      else if (!ready) stopSilentKeeper();
    });
    return;
  }
  stopAmbiencePreview();
  stopSerenityPreview();
  if (typeof stopPlayerAmbiencePreview === 'function') stopPlayerAmbiencePreview();
  const hasVoice = state.voiceMode === 'own' ? recordings.some(r=>r) : true;
  if (!hasVoice){
    /* Tell the truth about which of the two this is. Telling someone to record
       lines they already recorded sends them to do the one thing that cannot
       help. */
    document.getElementById('finalLine').textContent = recordingLoadErrors.length
      ? 'Your recordings are saved, but this device could not download them — ' +
        recordingLoadErrors[0] + '. Check your connection and open it again.'
      : 'No lines were recorded — go back and hold the record button on at least one.';
    return;
  }

  if (typeof openImmersivePlayer === 'function') openImmersivePlayer();
  finalPlaying = true;
  finalStartTime = Date.now();
  finalPaused = false; finalPauseStarted = null; finalPausedTotal = 0; finalFadeEnding = false;
  finalPauseWaiters = [];
  finalAffirmationIndex = 0; finalRequestedIndex = null;
  resetAffTimeline();
  const session = ++finalSession;
  const alive = () => finalPlaying && session === finalSession;
  deviceSpeechFailures = 0;
  deviceVoiceSilent = false;
  document.getElementById('finalPlayBtn').disabled = false;
  document.getElementById('finalPlayBtn').innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:6px;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Playing…';
  updateSessionTimerLabel();
  finalTimerInterval = setInterval(() => { updateSessionTimerLabel(); updateMediaSessionPosition(); }, 1000);
  if (typeof setupMediaSession === 'function') setupMediaSession();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  updateMediaSessionPosition();

  // Reuses the context opened by the tap when there is one, rather than making
  // a fresh suspended one that will never be allowed to start.
  primeAudio();
  startCustomTrackPlayback();
  /* The frequency layers. One mixer owns every tone: attaching it to a context
     it is already attached to does nothing, and each Hz is looked up before it
     is made, so there is never a second copy of a tone. The master gain is the
     Frequency fader and fades in over 2.5 seconds, as the single tone always did;
     each tone then glides to its own level. */
  const toneGain = frequencyMixer
    .attach(finalCtx, audioOut(finalCtx), { fadeIn: 2.5, level: FrequencyLayers.masterGainValue(document.getElementById('mixTone').value) })
    .master;
  frequencyMixer.sync(state.freqLayers && state.freqLayers.length ? state.freqLayers : [{ hz: 528, vol: 100 }], { band: currentBinauralBand() });
  liveToneGain = toneGain;

  /* The ambience, on its own graph with its own lifetime. It is started here
     and never rebuilt for the rest of the session: changing the frequency,
     dragging a slider or letting the loop come round again does not touch it,
     and switching to a different track (changeSessionAmbience) crossfades this
     same bed rather than restarting anything. */
  sessionBed.attach(finalCtx, audioOut(finalCtx));
  sessionBed.setLevel(document.getElementById('mixBg').value/100);
  sessionBed.to(state.bg, { fade: 2.5 });   // in with the tone, not on top of it
  sessionLayerBed.attach(finalCtx, audioOut(finalCtx));
  sessionLayerBed.setLevel(document.getElementById('mixBg').value/100);
  sessionLayerBed.to(state.bgLayer || 'none', { fade: 2.5 });
  const bgGain = sessionBed.out;

  // The soothing layer only plays if the person actually chose one in the ambience step
  // (and their tier allows it — see pickSoothingLayer). Not automatic.
  restartSoothingLayer();

  let destForRecording = audioOut(finalCtx);
  if (state.voiceMode === 'own' && window.MediaRecorder){
    const dest = finalCtx.createMediaStreamDestination();
    toneGain.connect(dest); bgGain.connect(dest); sessionLayerBed.out.connect(dest);
    finalStream = dest.stream;
    destForRecording = dest;
  }

  // Ritual-only: a second, quieter voice layered underneath the main one, looping on
  // its own independent cycle so the two don't read as a single flat voice.
  if (layerVoiceEnabled && state.layerAffirmations && state.layerAffirmations.length){
    const layerGain = finalCtx.createGain();
    layerGain.gain.value = document.getElementById('mixLayerVoice').value/100;
    layerGain.connect(audioOut(finalCtx));
    if (destForRecording !== audioOut(finalCtx)) layerGain.connect(destForRecording);
    liveLayerVoiceGain = layerGain;
    runLayerSequence();
  }
  function runLayerSequence(){
    let idx = 0;
    const useOwn = state.layerVoiceMode === 'own' && layerRecordings.some(r=>r);
    const layerKey = !useOwn ? studioLayerKey() : null;
    function playNextLayerLine(){
      if (!alive()) return;
      if (waitWhileFinalPaused(playNextLayerLine)) return;
      const lines = state.layerAffirmations;
      const next = finalCallback(() => { idx++; finalLater(playNextLayerLine, gapForNextLine()); });
      if (useOwn){
        const recorded = layerRecordings.map((r,i)=>({r,i})).filter(x=>x.r);
        if (!recorded.length) return;
        if (idx >= recorded.length) idx = 0; // loops independently, doesn't need to match the main track's length
        const { r } = recorded[idx];
        loadClip(finalCtx, r).then(finalCallback(clip=>{
          playClip(finalCtx, clip, liveLayerVoiceGain.gain.value, null, next);
        })).catch(e=>{
          console.error('could not play layered line', e);
          next();
        });
      } else {
        if (idx >= lines.length) idx = 0;
        const line = lines[idx];
        const deviceSpeak = ()=>{
          if (!alive()) return;
          if (waitWhileFinalPaused(deviceSpeak)) return;
          const utter = new SpeechSynthesisUtterance(line);
          utter.rate = 0.85; utter.pitch = 0.85; // slightly slower and lower, so it reads as a distinct underlying voice
          // Cut off by a pause: say the same line again on resume, not the next one.
          utter.onend = () => { if (finalPaused) waitWhileFinalPaused(deviceSpeak); else next(); };
          window.speechSynthesis.speak(utter);
        };
        if (layerKey){
          // Only what was generated and checked; a line that is not in hand is skipped, never spoken by the device.
          const url = ttsLineText(line) ? studioClipUrl(layerKey, ttsLineText(line)) : null;
          if (!url){ next(); return; }
          url.then(u => loadClip(finalCtx, studioClipHandle(u)))
            .then(finalCallback(clip => { playClip(finalCtx, clip, liveLayerVoiceGain.gain.value, null, next); }))
            .catch(() => { if (alive()) next(); });
          return;
        }
        deviceSpeak();
      }
    }
    // Starts a beat after the main voice so the two voices don't land on top of each other.
    finalLater(playNextLayerLine, 2200);
  }

  function runSequence(onDone){
    // A new pass (the first, or the loop coming round): every line is upcoming again.
    affTimeline.beginPass();
    if (state.voiceMode === 'own'){
      const recorded = recordings.map((r,i)=>({r,i})).filter(x=>x.r);
      let idx = 0;
      function playNext(){
        if (!alive()) return;
        if (waitWhileFinalPaused(playNext)) return;
        if (finalRequestedIndex !== null){
          const requestedRecorded = recorded.findIndex(x => x.i === finalRequestedIndex);
          finalRequestedIndex = null;
          if (requestedRecorded >= 0) idx = requestedRecorded;
        }
        if (idx >= recorded.length){ onDone(recorded.length > 0); return; }
        const { r, i } = recorded[idx];
        keepClipsNear(finalCtx, recorded, idx);
        showFinalAffirmation(state.affirmations[i], i);
        const repeatsForThisLine = eftRepeatsForIndex(i);
        loadClip(finalCtx, r).then(finalCallback(clip=>{
          let rep = 0;
          function playOnce(){
            if (!alive()) return;
            if (waitWhileFinalPaused(playOnce)) return;
            playClip(finalCtx, clip, document.getElementById('mixVoice').value/100, destForRecording, finalCallback(()=>{
              rep++;
              if (rep < repeatsForThisLine){
                // Short beat between repeats of the same line, timed to a single tap.
                finalLater(playOnce, 700);
              } else {
                if (!(typeof getPlayerLoopMode === 'function' && getPlayerLoopMode() === 'current')) idx++;
                finalLater(playNext, gapForNextLine());
              }
            }), { index: i });
          }
          playOnce();
        })).catch(e=>{
          if (!alive()) return;
          // Never fail silently — a session that plays no voice should say why.
          console.error('could not play recorded line', i, e);
          document.getElementById('finalLine').textContent = "This device can't play the voice recording saved with this subliminal. Re-record it here and save it again.";
          finalCallback(() => { idx++; finalLater(playNext, gapForNextLine()); })();
        });
      }
      playNext();
    } else {
      const lines = state.affirmations;
      let idx = 0;
      /* A generated voice (Serenity, a clone) plays only the checked audio that
         prepareStudioVoice() left in hand, and never falls back to the device:
         the device's speech is silent on an iPhone once Web Audio is running,
         which turned every failure into a session of silence. A line that cannot
         be played stops the session and says so; Play and Retry Audio try again.
         The device voice reads only a subliminal built with the device voice. */
      const studioKey = studioMainKey();
      function studioVoiceFailed(code){
        if (!alive()) return;
        forgetStudioVoiceAudio();
        stopFinal();
        setStudioStatus('failed', code || 'playback_failed');
        reportStudioFailure(code || 'playback_failed', 'playback');
      }
      function speakNext(){
        if (!alive()) return;
        if (waitWhileFinalPaused(speakNext)) return;
        if (finalRequestedIndex !== null){ idx = finalRequestedIndex; finalRequestedIndex = null; }
        if (idx >= lines.length){ onDone(lines.length > 0); return; }
        showFinalAffirmation(lines[idx], idx);
        const repeatsForThisLine = eftRepeatsForIndex(idx);
        let rep = 0;
        // Held by a pause like every other callback: the index only moves while playing.
        const advance = finalCallback(function(){
          rep++;
          if (rep < repeatsForThisLine){
            finalLater(speakOnce, 700);
          } else {
            if (!(typeof getPlayerLoopMode === 'function' && getPlayerLoopMode() === 'current')) idx++;
            finalLater(speakNext, gapForNextLine());
          }
        });
        /* The device's own voice is the one thing here that can fail without
           saying anything. speak() resolves to nothing at all on an iPhone in a
           saved-to-home-screen web app, and on any browser where an AudioContext
           is already running it can be refused outright — and when that happens
           `onend` never fires. The old code hung on that forever: no line, no
           error, no next affirmation, just a session that looked like it was
           playing and made no sound for however long it was set to run.

           So: every utterance is watched. If it neither starts nor ends, it is
           treated as failed rather than waited on, and enough failures in a row
           stop the session and say so. Eight hours of silence is the worst
           outcome this code can produce, and it was the likeliest one. */
        function deviceSpeak(){
          if (!alive()) return;
          if (waitWhileFinalPaused(deviceSpeak)) return;
          const lineIdx = idx;
          if (deviceVoiceSilent){
            // Known not to speak here: keep the lines moving with the music
            // rather than stalling four seconds on each one. The line is shown
            // for exactly that long, so the highlight still has a start and end.
            lineStarted(lineIdx);
            finalLater(() => { lineEnded(lineIdx); advance(); }, 2600);
            return;
          }
          const utter = new SpeechSynthesisUtterance(lines[idx]);
          utter.rate = 0.92; utter.pitch = 1.0;

          let settled = false, watchdog = null;
          const settle = (spoke) => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog);
            lineEnded(lineIdx);
            if (spoke) deviceSpeechFailures = 0;
            else deviceSpeechFailures++;
            if (deviceSpeechFailures >= 3 && !deviceVoiceSilent) reportNoDeviceVoice();
            advance();
          };
          /* Ended or errored while paused: the pause cut it (or a browser that
             cannot pause speech cancelled it). Not a failure and not the end of
             the line -- the same line is said again when the session resumes. */
          const cutByPause = () => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog);
            lineEnded(lineIdx);
            waitWhileFinalPaused(deviceSpeak);
          };

          utter.onstart = () => { deviceSpeechFailures = 0; lineStarted(lineIdx); };
          utter.onend   = () => { if (finalPaused) cutByPause(); else settle(true); };
          utter.onerror = () => { if (finalPaused) cutByPause(); else settle(false); };

          // Generous: a long affirmation at 0.92 rate still starts within a
          // second or two. This only fires when nothing happened at all, and
          // time spent paused does not count against it.
          const budget = 4000 + lines[idx].length * 90;
          const armWatchdog = () => {
            if (settled || !alive()) return;
            watchdog = setTimeout(() => {
              if (settled || !alive()) return;
              if (finalPaused){ finalPauseWaiters.push(armWatchdog); return; }
              try { window.speechSynthesis.cancel(); } catch(e){}
              settle(false);
            }, budget);
            finalTimeouts.push(watchdog);
          };
          armWatchdog();

          try { window.speechSynthesis.speak(utter); }
          catch(e){ settle(false); }
        }
        function speakOnce(){
          if (!alive()) return;
          if (waitWhileFinalPaused(speakOnce)) return;
          const line = lines[idx];
          if (studioKey){
            if (!ttsLineText(line)){ advance(); return; }   // a blank field is never read
            const url = studioClipUrl(studioKey, ttsLineText(line));
            if (!url){ studioVoiceFailed('generation_failed'); return; }
            url.then(u => loadClip(finalCtx, studioClipHandle(u)))
              .then(finalCallback(clip => {
                playClip(finalCtx, clip, document.getElementById('mixVoice').value/100, destForRecording, advance, { index: idx });
              }))
              .catch(() => studioVoiceFailed('playback_failed'));
            return;
          }
          deviceSpeak();
        }
        speakOnce();
      }
      speakNext();
    }
  }

  if (state.voiceMode === 'own' && window.MediaRecorder){
    finalChunks = [];
    finalRecorder = new MediaRecorder(finalStream);
    finalRecorder.ondataavailable = ev=>finalChunks.push(ev.data);
    finalRecorder.start();
  }

  // A pass that plays nothing returns instantly, and looping straight back into
  // another one used to recurse synchronously until the stack gave out — which
  // killed every script on the page, so nothing on the screen responded any
  // more. Two guards: a pass that played nothing stops rather than looping, and
  // the loop always goes through the event loop even when it did play.
  /* A context that is still suspended a moment after starting was refused, and
     nothing anyone does with the mixer will make it audible. Better to say so
     than to run a timer over silence. */
  const silenceCheck = setTimeout(() => {
    // A context suspended by the pause button was not refused.
    if (alive() && !finalPaused && finalCtx && finalCtx.state !== 'running'){
      stopFinal();
      document.getElementById('finalLine').textContent =
        'This browser blocked the sound. Tap play once more — and check the silent switch on the side of your phone.';
    }
  }, 1200);
  finalTimeouts.push(silenceCheck);

  let passesWithNoAudio = 0;
  runSequence(function loopCheck(playedSomething){
    const targetMs = (state.targetLengthMinutes || 0) * 60 * 1000;
    const elapsed = getFinalElapsedMs();
    const stillBuildingTowardTarget = targetMs && elapsed < targetMs;
    /* Tapping has no set length, so it keeps coming back round until you stop
       it. That is the whole point of not asking how long first. */
    const selectedLoopMode = typeof getPlayerLoopMode === 'function' ? getPlayerLoopMode() : (document.getElementById('loopToggle').checked ? 'entire' : 'none');
    const manualLoop = selectedLoopMode === 'entire' || state.eftMode;
    if (playedSomething) passesWithNoAudio = 0; else passesWithNoAudio++;
    if (passesWithNoAudio >= 1){
      const why = state.voiceMode === 'own'
        ? 'No recordings are saved for these affirmations yet. Record them in the previous step, then play.'
        : 'There are no affirmations to play yet. Go back a step and add some.';
      finishFinal();
      document.getElementById('finalLine').textContent = why;  // after, or finishFinal overwrites it
      return;
    }
    if (alive() && selectedLoopMode !== 'none' && (stillBuildingTowardTarget || manualLoop)){
      finalLater(() => runSequence(loopCheck), 0);
    } else {
      finishFinal();
    }
  });
}

/* Every way out of this ends the session. A player that cannot make a sound
   should not keep a timer running as though it can. */
/* Once this device has proved it will not speak, remember it. Otherwise every
   subliminal built from typed text costs another thirteen seconds of hope
   before the same sentence appears. */
const NO_DEVICE_VOICE_KEY = 'fthr_no_device_voice';
/* Cleared on load. It was written when every layer went out through Web Audio,
   which the ringer switch silenced, so it is a verdict on a version of this app
   that no longer exists. Keeping it would have kept punishing phones that work
   now. */
try { localStorage.removeItem(NO_DEVICE_VOICE_KEY); } catch(e){}
const DEVICE_VOICE_MESSAGE =
  "This device won't let the built-in voice speak inside the app — it's a limit " +
  "of the browser, not of your subliminal. Record the lines in your own voice, " +
  "or pick Serenity, and it will play.";

/* The device voice failing is not the session failing. The tone, the nature
   sound and the soothing layer are all still playing and all still worth
   listening to, so this stops waiting on speech and lets the rest run. It used
   to call finishFinal, which ended everything -- and that is why pressing play
   looked like it did nothing at all. */
let deviceVoiceSilent = false;
function reportNoDeviceVoice(){
  deviceVoiceSilent = true;
  const el = document.getElementById('finalLine');
  if (el) el.textContent = DEVICE_VOICE_MESSAGE;
}

function fmtClock(totalSec){
  const s = Math.max(0, Math.round(totalSec));
  const hh = Math.floor(s/3600), mm = Math.floor((s%3600)/60), ss = s%60;
  return `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}
function updateSessionTimerLabel(){
  const el = document.getElementById('sessionTarget');
  const progressWrap = document.getElementById('sessionProgress');
  const fill = document.getElementById('sessionProgressFill');
  const elapsedEl = document.getElementById('sessionElapsed');
  const remainingEl = document.getElementById('sessionRemaining');
  if (!el) return;
  const targetMin = state.targetLengthMinutes;
  if (!finalPlaying || !targetMin){
    el.textContent = targetMin ? `Session length: ${targetMin >= 60 ? (targetMin/60)+' hr' : targetMin+' min'}` : '';
    if (progressWrap) progressWrap.style.display = 'none';
    return;
  }
  const elapsedSec = Math.floor(getFinalElapsedMs()/1000);
  const targetSec = targetMin * 60;
  const remaining = Math.max(0, targetSec - elapsedSec);
  const mm = Math.floor(remaining/60), ss = remaining%60;
  el.textContent = remaining > 0 ? `Playing…` : `Wrapping up this loop…`;
  // Music-app style scrubber line: elapsed time on the left, remaining (as a countdown) on the right.
  if (progressWrap && fill && elapsedEl && remainingEl){
    progressWrap.style.display = 'block';
    const pct = targetSec ? Math.min(100, (elapsedSec/targetSec)*100) : 0;
    fill.style.width = pct + '%';
    elapsedEl.textContent = fmtClock(elapsedSec);
    remainingEl.textContent = remaining > 0 ? '-' + fmtClock(remaining) : (document.getElementById('loopToggle').checked ? 'looping' : '-0:00:00');
  }
  if (remaining <= 0 && !finalFadeEnding) fadeOutAndFinishFinal();
}

function fadeOutAndFinishFinal(){
  if (!finalPlaying || finalFadeEnding) return;
  finalFadeEnding = true;
  const now = finalCtx ? finalCtx.currentTime : 0;
  [liveToneGain,sessionBed.out,sessionLayerBed.out,liveSoothingGain,liveCustomGain,liveLayerVoiceGain,...liveVoiceGains].forEach(node => {
    if (!node || !node.gain || !finalCtx) return;
    try {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(Math.max(.0001,node.gain.value),now);
      node.gain.exponentialRampToValueAtTime(.0001,now+1.5);
    } catch(e){}
  });
  // Held by a pause like everything else, so a paused fade does not end the session.
  finalLater(finishFinal, 1600);
}

function finishFinal(){
  // A session only counts once it has actually run for a while; starting and
  // stopping shouldn't pay, and the database won't pay twice in a day anyway.
  const listenedSeconds = Math.floor(getFinalElapsedMs()/1000);
  if (finalPlaying && finalStartTime && listenedSeconds > 60){
    awardLight(LIGHT_SOURCES.subliminal, '', document.getElementById('finalPlayBtn'));
  }
  finalPlaying = false; finalSession++;
  finalPaused = false; finalPauseStarted = null; finalFadeEnding = false;
  finalPauseWaiters = [];
  resetAffTimeline();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  if (typeof recordPlayerSession === 'function') recordPlayerSession(true, listenedSeconds);
  try { window.speechSynthesis.cancel(); } catch(e){}
  stopSilentKeeper();
  closeAudioOut(finalCtx);
  // The context is gone, so decoded copies of the takes (tied to it) are only memory.
  (recordings || []).forEach(t => { if (t && t._clip && t._clipCtx === finalCtx) releaseClip(t); });
  if (finalTimerInterval){ clearInterval(finalTimerInterval); finalTimerInterval = null; }
  clearTimeout(finalRecoverTimer);
  finalTimeouts.forEach(clearTimeout); finalTimeouts = [];
  updateSessionTimerLabel();
  document.getElementById('finalPlayBtn').disabled = false;
  document.getElementById('finalPlayBtn').innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:6px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>Play my subliminal';
  document.getElementById('finalLine').textContent = '"'+(state.affirmations[0]||'')+'"';
  if (finalRecorder && finalRecorder.state !== 'inactive'){
    finalRecorder.onstop = ()=>{ window._subliminallyDownloadBlob = new Blob(finalChunks, { type:'audio/webm' }); };
    finalRecorder.stop();
  } else if (finalChunks.length){
    window._subliminallyDownloadBlob = new Blob(finalChunks, { type:'audio/webm' });
  }
  frequencyMixer.detach();
  if (finalPremiumPad){ finalPremiumPad.stop(); finalPremiumPad = null; }
  // The ending fade has finished; detach now so restarting cannot reuse a closed bus.
  sessionBed.stop({ fade: 0 });
  sessionLayerBed.stop({ fade: 0 });
  if (customTrackSource){ try{ customTrackSource.stop(); }catch(e){} customTrackSource=null; }
  if (finalCtx){
    const closing = finalCtx;
    finalCtx = null;
    sessionBed.detach();
    sessionLayerBed.detach();
    try { closing.close(); } catch(e){}
  }
  liveToneGain = null; liveSoothingGain = null; liveCustomGain = null; liveLayerVoiceGain = null;
  finalStream = null;
  liveVoiceElements.forEach(el => { try { el.pause(); } catch(e){} });
  liveVoiceGains.clear();
  liveVoiceElements.clear();
}

function stopFinal(){
  const listenedSeconds = Math.floor(getFinalElapsedMs()/1000);
  finalPlaying = false; finalSession++;
  finalPaused = false; finalPauseStarted = null; finalFadeEnding = false;
  finalPauseWaiters = [];
  resetAffTimeline();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  if (typeof recordPlayerSession === 'function') recordPlayerSession(false, listenedSeconds);
  stopSilentKeeper();
  closeAudioOut(finalCtx);
  // The context is gone, so decoded copies of the takes (tied to it) are only memory.
  (recordings || []).forEach(t => { if (t && t._clip && t._clipCtx === finalCtx) releaseClip(t); });
  if (finalTimerInterval){ clearInterval(finalTimerInterval); finalTimerInterval = null; }
  clearTimeout(finalRecoverTimer);
  updateSessionTimerLabel();
  finalTimeouts.forEach(clearTimeout); finalTimeouts = [];
  try { window.speechSynthesis.cancel(); } catch(e){}
  frequencyMixer.detach();
  if (finalPremiumPad){ finalPremiumPad.stop(); finalPremiumPad = null; }
  /* Stop means stop: the context closes on the next line, so there is nothing
     to fade into and nothing that could still be running afterwards. The key
     the bed is on survives, which is what makes pressing play again come back
     on the same ambience. */
  sessionBed.detach();
  sessionLayerBed.detach();
  if (customTrackSource){ try{ customTrackSource.stop(); }catch(e){} customTrackSource=null; }
  if (finalRecorder && finalRecorder.state !== 'inactive'){
    finalRecorder.onstop = ()=>{ window._subliminallyDownloadBlob = new Blob(finalChunks, {type:'audio/webm'}); };
    finalRecorder.stop();
  }
  if (finalCtx){ try{ finalCtx.close(); }catch(e){} finalCtx=null; }
  liveToneGain = null; liveSoothingGain = null; liveCustomGain = null; liveLayerVoiceGain = null;
  finalStream = null;
  liveVoiceElements.forEach(el => { try { el.pause(); } catch(e){} });
  liveVoiceGains.clear();
  liveVoiceElements.clear();
  const btn = document.getElementById('finalPlayBtn');
  if (btn){ btn.disabled=false; btn.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:6px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>Play my subliminal'; }
}


/* ---------- sound check ----------
   Three attempts at playing a plain tone, so a phone that makes no sound can
   say which layer is failing instead of everyone guessing:

     1. Web Audio, the engine the whole session runs on.
     2. An <audio> element. On an iPhone the ringer switch silences Web Audio
        but not media playback, so hearing this and not the first names the
        cause exactly.
     3. The device's own speech, which is the other thing a subliminal can use.

   Whatever comes back, it is evidence rather than another theory. */
function toneWavDataUri(seconds, hz){
  const rate = 8000, n = Math.floor(rate * seconds);
  const bytes = 44 + n * 2, buf = new ArrayBuffer(bytes), v = new DataView(buf);
  const ascii = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  ascii(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ascii(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++){
    // Faded at both ends so it is a note rather than a click.
    const fade = Math.min(1, i / (rate * 0.05), (n - i) / (rate * 0.05));
    v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * hz * (i / rate)) * 0.35 * fade * 32767, true);
  }
  let bin = ''; const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

function soundCheckSay(html){
  const el = document.getElementById('soundCheckMsg');
  if (el) el.innerHTML = html;
}

async function runSoundCheck(){
  const wait = ms => new Promise(r => setTimeout(r, ms));
  soundCheckSay('<b>1 of 3 — Web Audio.</b> Listen for a low tone…');

  // 1. Web Audio, unlocked inside this tap.
  let ctxState = 'none';
  try {
    const ctx = primeAudio();
    const g = ctx.createGain(); g.gain.value = 0.25; g.connect(audioOut(ctx));
    const o = ctx.createOscillator(); o.frequency.value = 330; o.connect(g); o.start();
    await wait(1600); o.stop(); ctxState = ctx.state;
  } catch(e){ ctxState = 'failed: ' + (e && e.message); }
  await wait(400);

  // 2. An <audio> element.
  soundCheckSay('<b>2 of 3 — media playback.</b> Listen for a higher tone…');
  let elResult = 'no';
  try {
    const el = new Audio(toneWavDataUri(1.5, 520));
    el.volume = 1;
    await el.play();
    elResult = 'started';
    await wait(1700);
  } catch(e){ elResult = 'blocked: ' + (e && e.name); }
  await wait(400);

  // 3. The device's own voice.
  soundCheckSay('<b>3 of 3 — the device voice.</b> Listen for a word…');
  let spoke = false;
  try {
    const u = new SpeechSynthesisUtterance('Testing');
    u.onstart = () => { spoke = true; };
    window.speechSynthesis.speak(u);
    await wait(2200);
    window.speechSynthesis.cancel();
  } catch(e){}

  soundCheckSay(`Done. Tell me which of the three you heard — that is the whole answer.
    <br><span class="sc-detail">Engine: ${ctxState} · media: ${elResult} · device voice: ${spoke ? 'started' : 'never started'}</span>`);
}

/* Last, deliberately: the pace constants are declared partway down this file,
   and a `const` cannot be read before its declaration has run. Called from the
   top, this threw on load and took every function below it with it. */
renderPaceChips();

// Preview audio belongs to the builder view, never to the next page.
function stopBuilderPreviews(){
  stopAmbiencePreview();
  stopSerenityPreview();
  if (typeof stopPlayerAmbiencePreview === 'function') stopPlayerAmbiencePreview();
  stopRec();
}
if (typeof window.addEventListener === 'function'){
  window.addEventListener('hashchange', stopBuilderPreviews);
  window.addEventListener('pagehide', stopBuilderPreviews);
}
/* Most ways out of the builder change body[data-view] through pushState, which
   fires no hashchange — so watch the view itself. */
if (typeof MutationObserver === 'function' && document.body){
  new MutationObserver(() => {
    if (document.body.getAttribute('data-view') !== 'build') stopBuilderPreviews();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
}
