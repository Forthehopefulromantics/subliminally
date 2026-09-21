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
const BACKGROUNDS = [
  { key:'none', label:'None', ic:'—' }, { key:'rain', label:'Rain', ic:'🌧' },
  { key:'ocean', label:'Ocean', ic:'🌊' }, { key:'waterfall', label:'Waterfall', ic:'💧' },
  { key:'forest', label:'Wind & forest', ic:'🌲' }, { key:'birds', label:'Birds', ic:'🐦' },
  { key:'thunder', label:'Distant storm', ic:'⛈' },
  { key:'brown', label:'Brown noise', ic:'▮' },
];
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
let state = { freq:null, intention:null, goal:'', tone:null, count:14, affirmations:[], voiceMode:null, aiVoiceId:null, bg:'none', targetLengthMinutes:5, soothingLayer:'none', layerAffirmations:[], layerVoiceMode:null, layerAiVoiceId:null, affirmationGapMs:2400, pace:'steady', eftMode:false, visualizationMode:false, binauralBand:null };

function renderProgress(){
  const bar = document.getElementById('flowProgress'); bar.innerHTML='';
  for (let i=0;i<TOTAL_STEPS;i++){ const d=document.createElement('div'); if(i<=step) d.classList.add('done'); bar.appendChild(d); }
}
function showStep(n){
  document.querySelectorAll('.flow-step').forEach(s=>s.classList.remove('active'));
  document.querySelector(`.flow-step[data-step="${n}"]`).classList.add('active');
  step = n; renderProgress();
  if (n === 1){ updateSessionLengthHint(); renderDurationChips(); }
  if (n === 1 || n === 5) applyBuilderLocks();
  if (n === 1 && pendingRitualMode){
    const chip = document.querySelector(`#ritualModeChips .length-chip[data-mode="${pendingRitualMode}"]`);
    pendingRitualMode = null;
    if (chip) pickRitualMode(chip);
  }
  if (n === 7) renderFinalFreqPicker();
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
  wrap.querySelectorAll('.length-chip').forEach(c => {
    const isSel = c.dataset.custom ? !exact : parseInt(c.dataset.minutes, 10) === minutes;
    c.classList.toggle('sel', isSel);
  });
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
  document.querySelectorAll('#durationChips .length-chip').forEach(c => c.classList.toggle('sel', !!c.dataset.custom));
  document.getElementById('sessionLengthSlider').focus({ preventScroll: true });
}
/* The fewest lines a subliminal is built from. Five is enough for a loop to
   read as a practice rather than one sentence on repeat, and few enough that
   somebody who has five true things to say is not padding to reach a number.
   Two places have to agree with this and both do: the "how many affirmations"
   slider in index.html starts here, and this is the check for the review step,
   where lines can still be deleted after they have been generated. */
const MIN_AFFIRMATIONS = 5;
function affirmationShortfall(){
  /* EFT is a fixed round of lines, one per tapping point, and a visualization
     is a single script. Neither is a list anybody adds to, so neither is
     measured against this. */
  if (state.eftMode || state.visualizationMode) return 0;
  const have = state.affirmations.filter(a => String(a).trim().length > 0).length;
  return Math.max(0, MIN_AFFIRMATIONS - have);
}
function nextStep(){
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
  showStep(step+1);
}
function prevStep(){ showStep(Math.max(0,step-1)); }
function resetFlow(){
  stopFinal();
  state = { freq:null, intention:null, goal:'', tone:null, count:14, affirmations:[], voiceMode:null, aiVoiceId:null, bg:'none', targetLengthMinutes:5, soothingLayer:'none', layerAffirmations:[], layerVoiceMode:null, layerAiVoiceId:null, affirmationGapMs:2400, pace:'steady', eftMode:false, visualizationMode:false, binauralBand:null };
  document.querySelectorAll('.sel').forEach(c=>c.classList.remove('sel'));
  document.getElementById('quizGoal').value='';
  document.getElementById('toStep1').disabled = true;
  document.getElementById('toStep5').disabled = true;
  document.getElementById('countRange').value = 14; document.getElementById('countVal').textContent = 14;
  document.getElementById('sessionLengthSlider').value = 5;
  document.getElementById('sessionLengthVal').textContent = '5 min';
  renderDurationChips();
  const defaultSoothing = document.querySelector('#soothingChips .length-chip[data-variant="none"]');
  if (defaultSoothing) defaultSoothing.classList.add('sel');
  state.binauralBand = null;
  document.querySelectorAll('#binauralChips .length-chip').forEach(c=>c.classList.toggle('sel', c.dataset.band==='none'));
  document.getElementById('binauralGuideText').style.display = 'none';
  document.getElementById('soothingMixRow').style.display = 'none';
  document.getElementById('soothingMsg').textContent = '';
  document.getElementById('lengthMsg').textContent = '';
  document.getElementById('sessionTarget').textContent = '';
  customTrackBlob = null;
  document.getElementById('customTrackName').textContent = '';
  document.getElementById('customTrackMsg').textContent = '';
  document.getElementById('customMixRow').style.display = 'none';
  layerVoiceEnabled = false; layerVoiceMode = 'ai'; layerRecordings = []; recordTarget = 'primary';
  document.getElementById('layerVoiceToggle').checked = false;
  document.getElementById('layerVoicePanel').classList.remove('open');
  document.getElementById('layerAffText').value = '';
  document.getElementById('layerVoiceMsg').textContent = '';
  document.querySelectorAll('.layer-voice-options button').forEach(b=>b.classList.toggle('sel', b.dataset.mode==='ai'));
  document.getElementById('layerVoiceMixRow').style.display = 'none';
  affirmationPace = DEFAULT_PACE;
  setAffirmationGap(DEFAULT_GAP_SECONDS);
  renderPaceChips();
  document.getElementById('mixTone').value = 30; document.getElementById('mixToneVal').value = 30;
  document.getElementById('mixBg').value = 50; document.getElementById('mixBgVal').value = 50;
  document.getElementById('mixVoice').value = 65; document.getElementById('mixVoiceVal').value = 65;
  state.eftMode = false;
  state.visualizationMode = false;
  document.querySelectorAll('#ritualModeChips .length-chip').forEach(c=>c.classList.toggle('sel', c.dataset.mode==='subliminal'));
  document.getElementById('eftGuidePanel').style.display = 'none';
  document.getElementById('visualizationGuidePanel').style.display = 'none';
  document.getElementById('ritualModeMsg').textContent = '';
  document.getElementById('countRow').style.display = 'block';
  applyModeCopy('subliminal');
  const lengthQ = document.getElementById('sessionLengthRow');
  if (lengthQ) lengthQ.style.display = '';
  editingExistingId = null;
  contentAlreadySaved = false;
  document.getElementById('finalTitleInput').value = '';
  document.getElementById('finalTitleMsg').textContent = '';
  document.getElementById('finalTitleInput').classList.remove('needs-title');
  showStep(0);
}

/* ---- step 0: frequency ---- */
const freqChips = document.getElementById('freqChips');
FREQS.forEach(f=>{
  const c = document.createElement('button'); c.className='freq-card3';
  c.innerHTML = `<div class="hz">${f.hz} Hz</div><div class="word">${f.word}</div>`;
  c.onclick = ()=>{
    document.querySelectorAll('.freq-card3').forEach(x=>x.classList.remove('sel'));
    c.classList.add('sel'); state.freq = f;
    document.getElementById('freqGuideText').textContent = '"'+f.guide+'"';
    document.getElementById('toStep1').disabled = false;
  };
  freqChips.appendChild(c);
});

/* ---- step 1: quiz ---- */
const intentionChips = document.getElementById('intentionChips');
INTENTIONS.forEach(([k,label])=>{
  const c = document.createElement('button'); c.className='chip'; c.textContent = label;
  c.onclick = ()=>{ document.querySelectorAll('#intentionChips .chip').forEach(x=>x.classList.remove('sel')); c.classList.add('sel'); state.intention=k; };
  intentionChips.appendChild(c);
});
const toneChips = document.getElementById('toneChips');
[["gentle","Gentle & nurturing"],["bold","Bold & direct"],["calm","Calm & neutral"]].forEach(([k,label])=>{
  const c = document.createElement('button'); c.className='chip'; c.textContent=label;
  c.onclick=()=>{ document.querySelectorAll('#toneChips .chip').forEach(x=>x.classList.remove('sel')); c.classList.add('sel'); state.tone=k; };
  toneChips.appendChild(c);
});
const countRange = document.getElementById('countRange');
countRange.addEventListener('input', ()=>{ document.getElementById('countVal').textContent = countRange.value; state.count = parseInt(countRange.value); });

/* ---- Ritual-only: subliminal + EFT tapping mode ---- */
const eftPointsList = document.getElementById('eftPointsList');
// Skip index 0 (the Setup Statement) here — it's described separately above the list.
// This shows the 9-point round: Karate Chop -> ... -> Karate Chop again.
EFT_LINE_POINTS.forEach((p, i) => {
  const li = document.createElement('li');
  li.innerHTML = `<b>${p.label}</b> — ${p.where}`;
  eftPointsList.appendChild(li);
});
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
  document.querySelectorAll('#ritualModeChips .length-chip').forEach(c=>c.classList.remove('sel'));
  btn.classList.add('sel');
  state.eftMode = (mode === 'eft');
  state.visualizationMode = (mode === 'visualization');
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
    state.count = parseInt(countRange.value, 10);
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
    goalLabel.textContent = 'Describe what you want to happen, in as much detail as you can';
    document.getElementById('quizGoal').placeholder = 'e.g. I\'m walking out onto the court for the championship game. The crowd is loud, I can feel my heartbeat, but my hands are steady...';
    generateBtn.textContent = 'Continue to my script ✦';
    regenerateBtn.textContent = '↻ Get a new draft';
    loadingTitle.textContent = 'Setting up your script…';
    loadingSub.textContent = 'One moment.';
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
  state.count = state.eftMode ? EFT_LINE_COUNT : (state.visualizationMode ? 1 : parseInt(countRange.value));
  showStep(2);

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
async function callClaudeForAffirmations(){
  const toneLabel = {gentle:"gentle and nurturing", bold:"bold and direct", calm:"calm and neutral"}[state.tone] || "warm";
  const freqLabel = state.freq ? state.freq.hz+' Hz, '+state.freq.word : 'none';
  const response = await fetch(API_BASE + "/api/generate-affirmations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: state.count, freqLabel, toneLabel, goal: state.goal })
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
  const freqLabel = state.freq ? state.freq.hz+' Hz, '+state.freq.word : 'none';
  const response = await fetch(API_BASE + "/api/generate-eft-affirmations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: state.goal, toneLabel, freqLabel })
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
  const wrappers = ["Tonight, I remember: %s","Quietly, I know this: %s","Even now, %s","It's simple: %s"];
  let i = 0;
  while (lines.length < state.count){
    const base = bank[i % bank.length];
    lines.push(wrappers[i % wrappers.length].replace('%s', base.replace(/\.$/,'').toLowerCase()));
    i++;
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
  const freqLabel = state.freq ? state.freq.hz+' Hz, '+state.freq.word : 'none';
  const response = await fetch(API_BASE + "/api/generate-visualization-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: state.goal, toneLabel, freqLabel })
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

/* ---------------- review/edit ---------------- */
function renderAffList(){
  const list = document.getElementById('affList'); list.innerHTML='';
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
    if (!state.eftMode && !state.visualizationMode){
      // Removing a line would break the one-line-per-tapping-point mapping, so it's
      // disabled in EFT mode — the count has to stay at exactly nine.
      const rm = document.createElement('button'); rm.className='aff-remove'; rm.textContent='✕';
      rm.onclick = ()=>{ state.affirmations.splice(i,1); renderAffList(); };
      row.appendChild(rm);
    }
    list.appendChild(row);
  });
  document.getElementById('addAffBtn').style.display = (state.eftMode || state.visualizationMode) ? 'none' : '';
  // Once there are enough lines again, stop saying there aren't.
  const listMsg = document.getElementById('affListMsg');
  if (listMsg && !affirmationShortfall()){ listMsg.textContent = ''; listMsg.className = 'save-msg'; }
}
function addAffirmation(){ state.affirmations.push("I am..."); renderAffList(); }

/* ---------------- step 4: voice choice ----------------
   Two things are being chosen here: whether to record yourself or not, and — if
   not — which voice reads the lines. The studio voices are generated by
   /api/tts; when that isn't configured (or the person isn't on a paid plan) the
   app falls back to the device's own speech synthesis, which is how it has
   always worked, so nothing breaks. */
const AI_VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah',     desc: 'warm, calm' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', desc: 'soft, low' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice',     desc: 'clear, steady' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily',      desc: 'bright' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel',    desc: 'deep, grounding' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George',    desc: 'measured' },
];
const DEVICE_VOICE = 'device';   // the browser's own speechSynthesis
const MY_CLONED_VOICE = 'mine';  // resolved to the profile's cloned_voice_id at play time

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
  const here = el && el.closest(QUESTION_BLOCKS);
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
    const card = el && el.closest('.flow-step');
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

function chooseVoice(mode){
  state.voiceMode = mode;
  document.getElementById('voiceOwn').classList.toggle('sel', mode==='own');
  document.getElementById('voiceAI').classList.toggle('sel', mode==='ai');
  document.getElementById('voicePicker').style.display = mode === 'ai' ? 'block' : 'none';
  if (mode === 'ai') renderVoiceChips();
  document.getElementById('toStep5').disabled = false;
  if (mode === 'own') advanceAfterPick();
}

function pickAiVoice(id){
  const first = state.aiVoiceId !== id;
  state.aiVoiceId = id;
  renderVoiceChips();
  previewVoice(id);
  // Moving on the first pick only: tapping through voices to hear them should
  // not throw you off the screen you are comparing them on.
  if (first && !pickAiVoice._moved){ pickAiVoice._moved = true; advanceAfterPick(); }
}

async function renderVoiceChips(){
  const wrap = document.getElementById('voiceChips');
  if (!state.aiVoiceId) state.aiVoiceId = AI_VOICES[0].id;
  const cloned = await myClonedVoiceId();
  const chips = AI_VOICES.map(v => ({ id: v.id, name: v.name, desc: v.desc, mine: false }));
  if (cloned) chips.unshift({ id: MY_CLONED_VOICE, name: 'My voice', desc: 'cloned', mine: true });
  chips.push({ id: DEVICE_VOICE, name: 'This device', desc: 'built-in', mine: false });
  wrap.innerHTML = chips.map(c => `
    <button type="button" class="voice-chip${state.aiVoiceId === c.id ? ' sel' : ''}${c.mine ? ' mine' : ''}" onclick="pickAiVoice('${c.id}')">
      ${c.name} <span class="voice-chip-desc">${c.desc}</span>
    </button>`).join('');
}

/* The cloned voice id lives on the profile; cached so the picker doesn't refetch
   it every repaint. */
let clonedVoiceCache;
async function myClonedVoiceId(){
  if (clonedVoiceCache !== undefined) return clonedVoiceCache;
  if (!sb || !currentUser){ clonedVoiceCache = null; return null; }
  const data = await myProfile();
  clonedVoiceCache = (data && data.cloned_voice_id) || null;
  return clonedVoiceCache;
}

/* Resolve what the picker stores into the id the API actually wants. Returns
   null when the line should be spoken by the device instead. */
async function resolveVoiceId(picked){
  if (!picked || picked === DEVICE_VOICE) return null;
  if (picked === MY_CLONED_VOICE) return await myClonedVoiceId();
  return picked;
}

async function previewVoice(picked){
  const msg = document.getElementById('voicePickerMsg');
  msg.textContent = ''; msg.className = 'save-msg';
  const line = (state.affirmations && state.affirmations[0]) || 'I am safe, and I am becoming who I said I would be.';
  const voiceId = await resolveVoiceId(picked);
  if (!voiceId){ speakWithDeviceVoice(line); return; }
  msg.textContent = 'Loading the voice…';
  try {
    const url = await synthesizeLine(line, voiceId);
    msg.textContent = '';
    const el = document.getElementById('voicePreview');
    el.src = url; el.play().catch(()=>{});
  } catch (e){
    msg.textContent = ttsErrorText(e);
    msg.className = 'save-msg';
    speakWithDeviceVoice(line);
  }
}
function speakWithDeviceVoice(line){
  try { window.speechSynthesis.cancel(); } catch(e){}
  const u = new SpeechSynthesisUtterance(line);
  u.rate = 0.92; u.pitch = 1.0;
  window.speechSynthesis.speak(u);
}
function ttsErrorText(e){
  const m = (e && e.message) || '';
  if (m === 'upgrade_required') return 'Studio voices come with Ritual — using this device\'s voice for now.';
  if (m === 'not_configured') return 'Studio voices aren\'t switched on yet — using this device\'s voice.';
  return 'That voice is unavailable right now — using this device\'s voice.';
}

/* Generate one spoken line and hand back an object URL. Each line is only ever
   generated once per session: the same words in the same voice always sound the
   same, and every repeat after that is free. */
const ttsCache = new Map();
/* loadClip caches its decoded audio on the object it's handed, so each generated
   line needs one stable handle rather than a fresh literal per repeat. */
const studioClipHandles = new Map();
function studioClipHandle(url){
  if (!studioClipHandles.has(url)) studioClipHandles.set(url, { url });
  return studioClipHandles.get(url);
}
async function synthesizeLine(text, voiceId){
  // The speed is baked into the audio, so it is part of what identifies a clip.
  const key = voiceId + '|' + paceNow().speed + '|' + text;
  if (ttsCache.has(key)) return ttsCache.get(key);
  const promise = (async () => {
    const token = sb && (await sb.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('not_signed_in');
    const res = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // The pace is part of the reading, not just the gap after it.
      body: JSON.stringify({ text, voiceId, speed: paceNow().speed }),
    });
    if (!res.ok){
      let body = {};
      try { body = await res.json(); } catch(e){}
      throw new Error(body.error || `tts_failed_${res.status}`);
    }
    return URL.createObjectURL(await res.blob());
  })();
  ttsCache.set(key, promise);
  // A failed line shouldn't be cached as permanently broken.
  promise.catch(() => ttsCache.delete(key));
  return promise;
}

/* ---------------- step 5: background + mixer ---------------- */
const bgGrid = document.getElementById('bgGrid');
BACKGROUNDS.forEach(b=>{
  const c = document.createElement('button'); c.className='bg-card'+(b.key==='none'?' sel':'');
  c.innerHTML = `<span class="ic">${b.ic}</span>${b.label}`;
  c.onclick = ()=>{
    document.querySelectorAll('.bg-card').forEach(x=>x.classList.remove('sel'));
    c.classList.add('sel'); state.bg = b.key;
    // Same as the voice cards: the pick is the answer, so it moves on.
    setTimeout(() => { if (step === 5) nextStep(); }, STEP_ADVANCE_MS);
  };
  bgGrid.appendChild(c);
});

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
function pickLayerVoiceMode(btn){
  document.querySelectorAll('.layer-voice-options button').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  layerVoiceMode = btn.dataset.mode;
  answered(btn);
}

function startNextPhase(){
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

  const needsPrimaryRecording = state.voiceMode === 'own';
  const needsLayerRecording = layerVoiceEnabled && layerVoiceMode === 'own';

  if (needsPrimaryRecording){
    recordTarget = 'primary';
    recIndex = 0; recordings = new Array(state.affirmations.length).fill(null);
    setRecordStepCopy('primary');
    showRecordLine(); showStep(6);
  } else if (needsLayerRecording){
    recordTarget = 'layer';
    recIndex = 0; layerRecordings = new Array(state.layerAffirmations.length).fill(null);
    setRecordStepCopy('layer');
    showRecordLine(); showStep(6);
  } else {
    prepareFinal(); showStep(7);
  }
}

function setRecordStepCopy(target){
  const title = document.getElementById('recordFlowTitle');
  const sub = document.getElementById('recordFlowSub');
  const breath = document.getElementById('recordBreathNote');
  if (target === 'layer'){
    title.textContent = "Record your second, layered voice";
    sub.textContent = "This plays quietly underneath your main voice — press and hold, speak the line, then release.";
    breath.style.display = 'none';
  } else if (state.visualizationMode){
    title.textContent = "Read your visualization out loud";
    sub.textContent = "Press and hold, read through the whole script in one take, then release when you're done.";
    breath.style.display = '';
  } else {
    title.textContent = "Record in your own voice";
    sub.textContent = "Press and hold, speak the line, then release.";
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

function showRecordLine(){
  const lines = activeRecordLines(); const arr = activeRecordArray();
  const isEftPoint = state.eftMode && recordTarget === 'primary' && EFT_LINE_POINTS[recIndex];
  const isScript = state.visualizationMode && recordTarget === 'primary';
  document.getElementById('recCounter').textContent = isEftPoint
    ? `Line ${recIndex+1} of 11 — ${EFT_LINE_POINTS[recIndex].label}`
    : (isScript ? 'Your full script — one continuous take' : `${recIndex+1} of ${lines.length}`);
  document.getElementById('recLine').textContent = '"'+lines[recIndex]+'"';
  document.getElementById('recTapHint').textContent = isEftPoint
    ? (EFT_LINE_POINTS[recIndex].isSetup
        ? `Tap continuously: ${EFT_LINE_POINTS[recIndex].where}`
        : `Tap: ${EFT_LINE_POINTS[recIndex].where}`)
    : '';
  document.getElementById('recTapHint').style.display = isEftPoint ? 'block' : 'none';
  document.getElementById('recLine').classList.toggle('record-line-script', isScript);
  document.getElementById('recStatus').textContent = 'press and hold to record';
  document.getElementById('nextLineBtn').disabled = !arr[recIndex];
}
function skipLine(){ advanceLine(); }
function nextLine(){ advanceLine(); }
function advanceLine(){
  const lines = activeRecordLines();
  if (recIndex < lines.length-1){ recIndex++; showRecordLine(); return; }
  // Finished this pass. If we just finished the primary voice and a layer recording
  // is still needed, seamlessly continue into the layer pass instead of leaving step 6.
  if (recordTarget === 'primary' && layerVoiceEnabled && layerVoiceMode === 'own'){
    recordTarget = 'layer';
    recIndex = 0; layerRecordings = new Array(state.layerAffirmations.length).fill(null);
    setRecordStepCopy('layer');
    showRecordLine();
    return;
  }
  prepareFinal(); showStep(7);
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
    el.src = URL.createObjectURL(blob);
    el.preload = 'auto';
    await new Promise((resolve, reject) => {
      el.oncanplaythrough = resolve;
      el.onerror = () => reject(new Error('unplayable recording (' + trueMime + ')'));
      el.load();
    });
    clip = { kind: 'element', el };
  }
  rec._clip = clip; rec._clipCtx = ctx;
  return clip;
}

/* Play one loaded clip through `gainValue`, calling onended when it finishes. */
function playClip(ctx, clip, gainValue, extraDest, onended){
  if (clip.kind === 'buffer'){
    const g = ctx.createGain(); g.gain.value = gainValue;
    g.connect(audioOut(ctx));
    if (extraDest && extraDest !== audioOut(ctx)) g.connect(extraDest);
    const src = ctx.createBufferSource(); src.buffer = clip.buffer;
    src.connect(g);
    liveVoiceGains.add(g);
    src.onended = () => { liveVoiceGains.delete(g); if (onended) onended(); };
    src.start();
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
  const done = () => { liveVoiceGains.delete(clip.gain); if (onended) onended(); };
  clip.el.onended = done;
  try { clip.el.currentTime = 0; } catch(e){}
  const p = clip.el.play();
  if (p && p.catch) p.catch(done);
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
const recBtn = document.getElementById('recBtn');
async function startRec(e){
  if (e && e.preventDefault) e.preventDefault();
  if (recPressed || recBtn.classList.contains('recording')) return;
  recPressed = true;
  try{ micStream = await navigator.mediaDevices.getUserMedia({audio:true}); }
  catch(err){ recPressed = false; document.getElementById('recStatus').textContent="Microphone access is needed — check your browser permissions."; return; }
  /* Let go while the microphone was still opening. Nothing was recorded, so
     the stream is handed straight back rather than left running. */
  if (!recPressed){
    micStream.getTracks().forEach(t=>t.stop());
    document.getElementById('recStatus').textContent='Too quick — hold a little longer.';
    return;
  }
  // Timed from when the microphone is actually live, so the wait for a
  // permission prompt is never mistaken for a long recording.
  holdStart = Date.now(); audioChunks=[];
  const recMime = pickRecordingMime();
  mediaRecorder = recMime ? new MediaRecorder(micStream, { mimeType: recMime }) : new MediaRecorder(micStream);
  mediaRecorder.ondataavailable = ev=>audioChunks.push(ev.data);
  mediaRecorder.onstop = ()=>{
    const blob = new Blob(audioChunks, {type: mediaRecorder.mimeType || recMime || 'audio/webm'});
    const url = URL.createObjectURL(blob);
    micStream.getTracks().forEach(t=>t.stop());
    const held = Date.now()-holdStart;
    if (held > 400){
      activeRecordArray()[recIndex] = { url, blob };
      document.getElementById('recStatus').textContent='Saved — hold again to redo it.';
      document.getElementById('nextLineBtn').disabled=false;
    } else {
      document.getElementById('recStatus').textContent='Too quick — hold a little longer.';
    }
  };
  mediaRecorder.start();
  recBtn.classList.add('recording'); recBtn.textContent='●';
  document.getElementById('recStatus').textContent="listening… release when you're done";
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
function stopRec(){
  // Released, whether or not the microphone ever opened -- startRec checks
  // this after its await and gives the stream back if it did not.
  if (!recPressed) return;
  recPressed = false;
  if (!recBtn.classList.contains('recording')) return;
  recBtn.classList.remove('recording'); recBtn.textContent='HOLD';
  cancelAnimationFrame(animId);
  bars.forEach(b=>{ b.style.height='4px'; b.classList.remove('live'); });
  if (mediaRecorder && mediaRecorder.state!=='inactive') mediaRecorder.stop();
  if (recCtx){ try{ recCtx.close(); }catch(e){} recCtx = null; }
}
/* Pointer events where they exist, which is one event per press however the
   press was made. The mouse/touch pair below is the fallback, and only one of
   the two sets is ever attached -- a browser that has both used to report a
   single tap as a touch and a mouse press. */
if (window.PointerEvent){
  recBtn.addEventListener('pointerdown', startRec);
  recBtn.addEventListener('pointerup', stopRec);
  recBtn.addEventListener('pointercancel', stopRec);
  recBtn.addEventListener('pointerleave', stopRec);
} else {
  recBtn.addEventListener('mousedown', startRec);
  recBtn.addEventListener('mouseup', stopRec);
  recBtn.addEventListener('mouseleave', stopRec);
  recBtn.addEventListener('touchstart', startRec);
  recBtn.addEventListener('touchend', stopRec);
  recBtn.addEventListener('touchcancel', stopRec);
}

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
function buildAmbience(ctx, key, destination){
  const nodes = []; const timers = [];
  if (key === 'none') return { stop(){} };
  const master = ctx.createGain(); master.gain.value = 1; master.connect(destination); nodes.push(master);

  // If a real recorded track has been uploaded for this key (see Supabase ambience_tracks
  // table), use it instead of the synthesized version below.
  if (window.AMBIENCE_URLS && window.AMBIENCE_URLS[key]){
    let stopped = false;
    let src = null;
    fetch(window.AMBIENCE_URLS[key])
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(audioBuf => {
        if (stopped) return;
        src = ctx.createBufferSource(); src.buffer = audioBuf; src.loop = true;
        src.connect(master); src.start();
      })
      .catch(e => console.error('ambience track failed to load, no fallback for this key:', key, e));
    return { stop(){ stopped = true; if (src){ try{ src.stop(); }catch(e){} } } };
  }

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
  document.getElementById('finalTitle').textContent = `${state.freq ? state.freq.hz+' Hz · '+state.freq.word : ''}`;
  document.getElementById('finalLine').textContent = '"'+(state.affirmations[0]||'')+'"';
  document.getElementById('finalLine').classList.toggle('final-line-script', !!state.visualizationMode);
  document.getElementById('customMixRow').style.display = customTrackBlob ? 'flex' : 'none';
  document.getElementById('layerVoiceMixRow').style.display = layerVoiceEnabled ? 'flex' : 'none';
  document.getElementById('finalNote').textContent = "Subliminally plays here on the website, and soon in the app — sessions aren't downloadable files, so your ritual stays part of your membership rather than sitting forgotten in a downloads folder.";
  document.getElementById('rerecordBtn').style.display = (state.voiceMode === 'own') ? 'inline-flex' : 'none';
  renderFinalFreqPicker();
  updateFinalPointTag(0);

  const titleInput = document.getElementById('finalTitleInput');
  const titleMsg = document.getElementById('finalTitleMsg');
  titleMsg.textContent = '';
  titleInput.classList.remove('needs-title');
  if (editingExistingId || contentAlreadySaved){
    // Any change to something already saved has to be re-titled and saved as its own,
    // new subliminal — so the field starts empty rather than inheriting the old title.
    titleInput.value = '';
    titleInput.placeholder = "You've changed this one — give it a new title to save it";
  } else {
    titleInput.value = '';
    titleInput.placeholder = state.freq ? `e.g. "${state.freq.hz} Hz — ${state.freq.word}"` : 'Name this subliminal';
  }
}
/* Sends you back to the recording step to redo your voice on this subliminal.
   Existing recordings come along, so lines you don't touch stay exactly as they
   were — only the ones you actually hold-record again get replaced. */
function rerecordVoice(){
  if (state.voiceMode !== 'own') return;
  stopFinal();
  recordTarget = 'primary';
  recIndex = 0;
  if (!Array.isArray(recordings) || recordings.length !== state.affirmations.length){
    recordings = new Array(state.affirmations.length).fill(null);
  }
  setRecordStepCopy('primary');
  showRecordLine();
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

/* You can change the frequency right on the finished/loaded subliminal — no need to
   rebuild the whole thing from scratch. Works for a freshly-built one and for anything
   reloaded via "Load & adjust" in My Library. */
function renderFinalFreqPicker(){
  const wrap = document.getElementById('finalFreqPicker');
  const sel = document.getElementById('finalFreqSelect');
  if (!wrap || !sel || !state.freq) { if (wrap) wrap.style.display = 'none'; return; }
  sel.innerHTML = FREQS.map(f => `<option value="${f.hz}" ${f.hz===state.freq.hz?'selected':''}>${f.hz} Hz — ${f.word}</option>`).join('');
  wrap.style.display = 'block';
}
function changeFinalFrequency(hzStr){
  const hz = parseInt(hzStr, 10);
  const match = FREQS.find(f => f.hz === hz);
  if (!match) return;
  state.freq = match;
  document.getElementById('finalTitle').textContent = `${match.hz} Hz · ${match.word}`;
  // If it's currently playing, retune the live tone in place instead of restarting the session.
  if (finalPlaying && finalTone){
    const now = finalCtx.currentTime;
    finalTone.frequency.linearRampToValueAtTime(match.hz, now + 1.2);
    if (finalToneLayer2){
      const delta = (state.binauralBand && BINAURAL_BANDS[state.binauralBand]) ? BINAURAL_BANDS[state.binauralBand].hz : null;
      finalToneLayer2.frequency.linearRampToValueAtTime(delta !== null ? match.hz + delta : match.hz * 1.003, now + 1.2);
    }
  }
}

let finalCtx=null, finalTone=null, finalToneLayer2=null, finalAmbience=null, finalPlaying=false, finalRecorder=null, finalChunks=[], finalStream=null, finalTimeouts=[];
let finalStartTime=null, finalTimerInterval=null, finalPremiumPad=null;
let liveToneGain=null, liveBgGain=null, liveSoothingGain=null, liveCustomGain=null, customTrackSource=null, liveLayerVoiceGain=null;
/* Every gain node a voice line is currently playing through. A line is its own
   node that dies when the line ends, so unlike the tone and the background
   there is no single handle to hold — the set is what is live right now, and
   finished nodes are dropped as they end. Without this, dragging the voice
   volume did nothing until the *next* line started, which on a long line with
   gaps between repeats is indistinguishable from a broken slider. */
let liveVoiceGains = new Set();
function voiceMixValue(){
  const el = document.getElementById('mixVoice');
  return el ? el.value/100 : 1;
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
  document.querySelectorAll('#binauralChips .length-chip').forEach(c => c.classList.remove('sel'));
  btn.classList.add('sel');
  answered(btn);
  const band = btn.dataset.band;
  state.binauralBand = band === 'none' ? null : band;
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

  document.querySelectorAll('#soothingChips .length-chip').forEach(c => c.classList.remove('sel'));
  btn.classList.add('sel');
  answered(btn);
  state.soothingLayer = variant;
  document.getElementById('soothingMixRow').style.display = variant === 'none' ? 'none' : 'flex';
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
  document.querySelectorAll('#paceChips .length-chip').forEach(c => c.classList.remove('sel'));
  btn.classList.add('sel');
  setAffirmationGap(p.gap);
}
function renderPaceChips(){
  const wrap = document.getElementById('paceChips');
  if (!wrap) return;
  wrap.innerHTML = AFFIRMATION_PACES.map(p =>
    `<button type="button" class="length-chip${p.key === affirmationPace ? ' sel' : ''}"
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
  if (!finalPlaying) return;
  if (id==='mixTone') setLiveGain(liveToneGain, value/100 * 0.10);
  if (id==='mixBg') setLiveGain(liveBgGain, value/100);
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
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQQAAAAAAAAA';
let silentKeeper = null;

function startSilentKeeper(){
  try {
    if (!silentKeeper){
      silentKeeper = new Audio(SILENT_WAV);
      silentKeeper.loop = true;
      silentKeeper.volume = 0.02;   // not 0: iOS treats a truly silent element as nothing playing
      silentKeeper.setAttribute('playsinline', '');
    }
    const p = silentKeeper.play();
    if (p && p.catch) p.catch(() => {});
  } catch(e){}
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

   Which route depends on the device, because only one of them has a problem to
   solve. On iOS the element is the one that survives the ringer switch, so iOS
   gets the element and the direct path is let go the moment the element is
   genuinely playing — if it never plays, the direct path is still there and
   nothing is lost. Everywhere else ctx.destination is exactly right and no
   element is created at all. */
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
  bus.connect(ctx.destination);
  ctx.__outDirect = true;
  ctx.__outBus = bus;
  if (!needsMediaElementOutput()) return bus;
  try {
    const md = ctx.createMediaStreamDestination();
    const el = new Audio();
    el.srcObject = md.stream;
    el.setAttribute('playsinline', '');
    el.autoplay = true;
    /* The handover, at the only moment it can be made safely: the element is
       making sound, so letting the direct path go cannot leave silence — and
       keeping it would be the second copy. */
    el.addEventListener('playing', () => {
      if (!ctx.__outDirect) return;
      try { bus.disconnect(ctx.destination); ctx.__outDirect = false; } catch(e){}
    });
    bus.connect(md);
    const p = el.play();
    if (p && p.catch) p.catch(() => {});   // refused: the direct path still carries it
    ctx.__outEl = el;
    ctx.__outMd = md;
  } catch(e){ /* not supported here; the direct connection above still carries it */ }
  return bus;
}
function closeAudioOut(ctx){
  if (!ctx || !ctx.__outEl) return;
  try { ctx.__outEl.pause(); ctx.__outEl.srcObject = null; } catch(e){}
  ctx.__outEl = null;
  if (ctx.__outMd){ try { ctx.__outBus.disconnect(ctx.__outMd); } catch(e){} ctx.__outMd = null; }
  /* The element was carrying the sound; with it gone the direct path is the
     only way out again. Contexts are normally closed right after this, but a
     reused one must not come back mute. */
  if (ctx.__outBus && !ctx.__outDirect){
    try { ctx.__outBus.connect(ctx.destination); ctx.__outDirect = true; } catch(e){}
  }
}

function primeAudio(){
  // Before the context, so the category is already right when it opens.
  startSilentKeeper();
  if (!finalCtx || finalCtx.state === 'closed'){
    finalCtx = new (window.AudioContext||window.webkitAudioContext)();
  }
  if (finalCtx.state === 'suspended') finalCtx.resume().catch(()=>{});
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

  finalPlaying = true;
  finalStartTime = Date.now();
  deviceSpeechFailures = 0;
  deviceVoiceSilent = false;
  document.getElementById('finalPlayBtn').disabled = true;
  document.getElementById('finalPlayBtn').innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:6px;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Playing…';
  updateSessionTimerLabel();
  finalTimerInterval = setInterval(updateSessionTimerLabel, 1000);

  // Reuses the context opened by the tap when there is one, rather than making
  // a fresh suspended one that will never be allowed to start.
  primeAudio();
  startCustomTrackPlayback();
  const toneGain = finalCtx.createGain();
  const targetToneVol = document.getElementById('mixTone').value/100 * 0.10;
  toneGain.gain.setValueAtTime(0, finalCtx.currentTime);
  toneGain.gain.linearRampToValueAtTime(targetToneVol, finalCtx.currentTime + 2.5); // gentle fade-in, no hard onset
  const toneFilter = finalCtx.createBiquadFilter();
  toneFilter.type = 'lowpass'; toneFilter.frequency.value = 2600; toneFilter.Q.value = 0.4; // softens harsh upper harmonics
  toneFilter.connect(toneGain).connect(audioOut(finalCtx));
  const baseHz = state.freq ? state.freq.hz : 528;
  if (state.binauralBand && BINAURAL_BANDS[state.binauralBand]){
    // Binaural mode: left ear gets the base frequency, right ear gets base+delta.
    // Needs the toneFilter to receive a true stereo signal, so each oscillator gets
    // its own hard-panned channel instead of both summing to the center.
    const delta = BINAURAL_BANDS[state.binauralBand].hz;
    const panL = finalCtx.createStereoPanner(); panL.pan.value = -1;
    const panR = finalCtx.createStereoPanner(); panR.pan.value = 1;
    finalTone = finalCtx.createOscillator(); finalTone.type='sine'; finalTone.frequency.value = baseHz;
    finalTone.connect(panL).connect(toneFilter); finalTone.start();
    const toneLayer2 = finalCtx.createOscillator(); toneLayer2.type='sine'; toneLayer2.frequency.value = baseHz + delta;
    toneLayer2.connect(panR).connect(toneFilter);
    toneLayer2.start();
    finalToneLayer2 = toneLayer2;
  } else {
    finalTone = finalCtx.createOscillator(); finalTone.type='sine'; finalTone.frequency.value = baseHz;
    finalTone.connect(toneFilter); finalTone.start();
    // A second, quieter, very slightly detuned voice removes the "piercing" quality of one isolated pure tone
    const toneLayer2 = finalCtx.createOscillator(); toneLayer2.type='sine'; toneLayer2.frequency.value = baseHz * 1.003;
    const layer2Gain = finalCtx.createGain(); layer2Gain.gain.value = 0.4;
    toneLayer2.connect(layer2Gain).connect(toneFilter);
    toneLayer2.start();
    finalToneLayer2 = toneLayer2;
  }
  liveToneGain = toneGain;

  const bgGain = finalCtx.createGain(); bgGain.gain.value = document.getElementById('mixBg').value/100;
  bgGain.connect(audioOut(finalCtx));
  finalAmbience = buildAmbience(finalCtx, state.bg, bgGain);
  liveBgGain = bgGain;

  // The soothing layer only plays if the person actually chose one in the ambience step
  // (and their tier allows it — see pickSoothingLayer). Not automatic.
  restartSoothingLayer();

  let destForRecording = audioOut(finalCtx);
  if (state.voiceMode === 'own' && window.MediaRecorder){
    const dest = finalCtx.createMediaStreamDestination();
    toneGain.connect(dest); bgGain.connect(dest);
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
    function playNextLayerLine(){
      if (!finalPlaying) return;
      const lines = state.layerAffirmations;
      if (useOwn){
        const recorded = layerRecordings.map((r,i)=>({r,i})).filter(x=>x.r);
        if (!recorded.length) return;
        if (idx >= recorded.length) idx = 0; // loops independently, doesn't need to match the main track's length
        const { r } = recorded[idx];
        loadClip(finalCtx, r).then(clip=>{
          if (!finalPlaying) return;
          playClip(finalCtx, clip, liveLayerVoiceGain.gain.value, null, ()=>{
            idx++; const t = setTimeout(playNextLayerLine, gapForNextLine()); finalTimeouts.push(t);
          });
        }).catch(e=>{
          console.error('could not play layered line', e);
          idx++; const t = setTimeout(playNextLayerLine, gapForNextLine()); finalTimeouts.push(t);
        });
      } else {
        if (idx >= lines.length) idx = 0;
        const line = lines[idx];
        const advance = ()=>{ idx++; const t = setTimeout(playNextLayerLine, gapForNextLine()); finalTimeouts.push(t); };
        const deviceSpeak = ()=>{
          if (!finalPlaying) return;
          const utter = new SpeechSynthesisUtterance(line);
          utter.rate = 0.85; utter.pitch = 0.85; // slightly slower and lower, so it reads as a distinct underlying voice
          utter.onend = advance;
          window.speechSynthesis.speak(utter);
        };
        resolveVoiceId(state.layerAiVoiceId).catch(()=>null).then(voiceId => {
          if (!finalPlaying) return;
          if (!voiceId){ deviceSpeak(); return; }
          return synthesizeLine(line, voiceId)
            .then(url => loadClip(finalCtx, studioClipHandle(url)))
            .then(clip => {
              if (!finalPlaying) return;
              playClip(finalCtx, clip, liveLayerVoiceGain.gain.value, null, advance);
            })
            .catch(deviceSpeak);
        }).catch(deviceSpeak);
      }
    }
    // Starts a beat after the main voice so the two voices don't land on top of each other.
    const t0 = setTimeout(playNextLayerLine, 2200);
    finalTimeouts.push(t0);
  }

  function runSequence(onDone){
    if (state.voiceMode === 'own'){
      const recorded = recordings.map((r,i)=>({r,i})).filter(x=>x.r);
      let idx = 0;
      function playNext(){
        if (!finalPlaying) return;
        if (idx >= recorded.length){ onDone(recorded.length > 0); return; }
        const { r, i } = recorded[idx];
        document.getElementById('finalLine').textContent = '"'+state.affirmations[i]+'"'; updateFinalPointTag(i);
        const repeatsForThisLine = eftRepeatsForIndex(i);
        loadClip(finalCtx, r).then(clip=>{
          if (!finalPlaying) return;
          let rep = 0;
          function playOnce(){
            if (!finalPlaying) return;
            playClip(finalCtx, clip, document.getElementById('mixVoice').value/100, destForRecording, ()=>{
              rep++;
              if (rep < repeatsForThisLine){
                // Short beat between repeats of the same line, timed to a single tap.
                const t = setTimeout(playOnce, 700); finalTimeouts.push(t);
              } else {
                idx++; const t = setTimeout(playNext, gapForNextLine()); finalTimeouts.push(t);
              }
            });
          }
          playOnce();
        }).catch(e=>{
          // Never fail silently — a session that plays no voice should say why.
          console.error('could not play recorded line', i, e);
          document.getElementById('finalLine').textContent = "This device can't play the voice recording saved with this subliminal. Re-record it here and save it again.";
          idx++; const t = setTimeout(playNext, gapForNextLine()); finalTimeouts.push(t);
        });
      }
      playNext();
    } else {
      const lines = state.affirmations;
      let idx = 0;
      // Resolved once per session: a studio voice id, or null to use the voice
      // built into this device. Anything that goes wrong with a studio voice
      // falls back to the device rather than leaving the session silent.
      const voicePromise = resolveVoiceId(state.aiVoiceId).catch(() => null);
      function speakNext(){
        if (!finalPlaying){ return; }
        if (idx >= lines.length){ onDone(lines.length > 0); return; }
        document.getElementById('finalLine').textContent = '"'+lines[idx]+'"'; updateFinalPointTag(idx);
        const repeatsForThisLine = eftRepeatsForIndex(idx);
        let rep = 0;
        function advance(){
          rep++;
          if (rep < repeatsForThisLine){
            const t = setTimeout(speakOnce, 700); finalTimeouts.push(t);
          } else {
            idx++; const t = setTimeout(speakNext, gapForNextLine()); finalTimeouts.push(t);
          }
        }
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
          if (!finalPlaying) return;
          if (deviceVoiceSilent){
            // Known not to speak here: keep the lines moving with the music
            // rather than stalling four seconds on each one.
            const t = setTimeout(advance, 2600); finalTimeouts.push(t);
            return;
          }
          const utter = new SpeechSynthesisUtterance(lines[idx]);
          utter.rate = 0.92; utter.pitch = 1.0;

          let settled = false;
          const settle = (spoke) => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog);
            if (spoke) deviceSpeechFailures = 0;
            else deviceSpeechFailures++;
            if (deviceSpeechFailures >= 3 && !deviceVoiceSilent) reportNoDeviceVoice();
            advance();
          };

          utter.onstart = () => { deviceSpeechFailures = 0; };
          utter.onend   = () => settle(true);
          utter.onerror = () => settle(false);

          // Generous: a long affirmation at 0.92 rate still starts within a
          // second or two. This only fires when nothing happened at all.
          const watchdog = setTimeout(() => {
            try { window.speechSynthesis.cancel(); } catch(e){}
            settle(false);
          }, 4000 + lines[idx].length * 90);
          finalTimeouts.push(watchdog);

          try { window.speechSynthesis.speak(utter); }
          catch(e){ settle(false); }
        }
        function speakOnce(){
          if (!finalPlaying) return;
          const line = lines[idx];
          voicePromise.then(voiceId => {
            if (!finalPlaying) return;
            if (!voiceId){ deviceSpeak(); return; }
            return synthesizeLine(line, voiceId)
              .then(url => loadClip(finalCtx, studioClipHandle(url)))
              .then(clip => {
                if (!finalPlaying) return;
                playClip(finalCtx, clip, document.getElementById('mixVoice').value/100, destForRecording, advance);
              })
              .catch(() => deviceSpeak());
          }).catch(deviceSpeak);
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
    if (finalPlaying && finalCtx && finalCtx.state !== 'running'){
      stopFinal();
      document.getElementById('finalLine').textContent =
        'This browser blocked the sound. Tap play once more — and check the silent switch on the side of your phone.';
    }
  }, 1200);
  finalTimeouts.push(silenceCheck);

  let passesWithNoAudio = 0;
  runSequence(function loopCheck(playedSomething){
    const targetMs = (state.targetLengthMinutes || 0) * 60 * 1000;
    const elapsed = Date.now() - finalStartTime;
    const stillBuildingTowardTarget = targetMs && elapsed < targetMs;
    /* Tapping has no set length, so it keeps coming back round until you stop
       it. That is the whole point of not asking how long first. */
    const manualLoop = document.getElementById('loopToggle').checked || state.eftMode;
    if (playedSomething) passesWithNoAudio = 0; else passesWithNoAudio++;
    if (passesWithNoAudio >= 1){
      const why = state.voiceMode === 'own'
        ? 'No recordings are saved for these affirmations yet. Record them in the previous step, then play.'
        : 'There are no affirmations to play yet. Go back a step and add some.';
      finishFinal();
      document.getElementById('finalLine').textContent = why;  // after, or finishFinal overwrites it
      return;
    }
    if (finalPlaying && (stillBuildingTowardTarget || manualLoop)){
      const t = setTimeout(() => runSequence(loopCheck), 0); finalTimeouts.push(t);
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
  "or pick a studio voice, and it will play.";

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
  const elapsedSec = Math.floor((Date.now() - finalStartTime)/1000);
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
}

function finishFinal(){
  // A session only counts once it has actually run for a while; starting and
  // stopping shouldn't pay, and the database won't pay twice in a day anyway.
  if (finalPlaying && finalStartTime && Date.now() - finalStartTime > 60000){
    awardLight(LIGHT_SOURCES.subliminal, '', document.getElementById('finalPlayBtn'));
  }
  finalPlaying = false;
  stopSilentKeeper();
  closeAudioOut(finalCtx);
  if (finalTimerInterval){ clearInterval(finalTimerInterval); finalTimerInterval = null; }
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
  if (finalTone){ try{ finalTone.stop(); }catch(e){} }
  if (finalToneLayer2){ try{ finalToneLayer2.stop(); }catch(e){} }
  if (finalPremiumPad){ finalPremiumPad.stop(); finalPremiumPad = null; }
  if (finalAmbience){ finalAmbience.stop(); }
  if (customTrackSource){ try{ customTrackSource.stop(); }catch(e){} customTrackSource=null; }
  if (finalCtx){ setTimeout(()=>{ try{ finalCtx.close(); }catch(e){} }, 300); }
  liveToneGain = null; liveBgGain = null; liveCustomGain = null; liveLayerVoiceGain = null;
  liveVoiceGains.clear();
}

function stopFinal(){
  finalPlaying = false;
  stopSilentKeeper();
  closeAudioOut(finalCtx);
  if (finalTimerInterval){ clearInterval(finalTimerInterval); finalTimerInterval = null; }
  updateSessionTimerLabel();
  finalTimeouts.forEach(clearTimeout); finalTimeouts = [];
  window.speechSynthesis.cancel();
  if (finalTone){ try{ finalTone.stop(); }catch(e){} finalTone=null; }
  if (finalToneLayer2){ try{ finalToneLayer2.stop(); }catch(e){} finalToneLayer2=null; }
  if (finalPremiumPad){ finalPremiumPad.stop(); finalPremiumPad = null; }
  if (finalAmbience){ finalAmbience.stop(); finalAmbience=null; }
  if (customTrackSource){ try{ customTrackSource.stop(); }catch(e){} customTrackSource=null; }
  if (finalRecorder && finalRecorder.state !== 'inactive'){
    finalRecorder.onstop = ()=>{ window._subliminallyDownloadBlob = new Blob(finalChunks, {type:'audio/webm'}); };
    finalRecorder.stop();
  }
  if (finalCtx){ try{ finalCtx.close(); }catch(e){} finalCtx=null; }
  liveToneGain = null; liveBgGain = null; liveCustomGain = null; liveLayerVoiceGain = null;
  liveVoiceGains.clear();
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
