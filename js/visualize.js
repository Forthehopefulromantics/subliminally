/* visualize.js — Visualization: a future memory, written with you and narrated once

   Part of Subliminally. A plain script like its neighbours — it shares their
   global scope (sb, currentUser, API_BASE, openUpgradeModal, ...) and is loaded
   after them. Everything of its own lives inside one closure and is reached
   through `Viz`, so it cannot collide with the subliminal builder.

   THE SHAPE OF IT
     home     the invitation, and My Visualizations
     ask      one question at a time, at most five in all
     writing  one scene is written (a failure keeps every answer)
     editor   the story, editable; AI revisions; narration; sound layers

   WHAT IS SAVED WHEN
     * the first answer creates the row, and every answer after it is saved, so
       a refresh in the middle resumes at the same question;
     * a written story is saved before it is shown, and every edit after that is
       saved a moment after it is typed (and mirrored in localStorage until the
       save lands, in case the tab is closed first);
     * narration is made only by /api/visualization (action narrate) and only when
       the person presses Bring this story to life or Update narration. Nothing on
       this page — replaying, retuning, renaming, a new cover — can reach it. */
(function(){
'use strict';

const TABLE = 'visualizations';
const LIST_COLS = 'id,title,initial_desire,stage,script,script_hash,narration_path,narration_script_hash,narration_status,narration_duration_seconds,narration_generated_at,cover_path,created_at,updated_at';
const MAX_QUESTIONS = 5;
const SAVE_DELAY_MS = 700;
const MIRROR_KEY = 'subliminally_viz_unsaved_v1';

const PLACEHOLDERS = [
  'Getting the promotion', 'Waking up in my dream apartment', 'Being married to the love of my life',
  'Winning my championship', 'Making $50K a month', 'Traveling on my private jet',
  'Going viral', 'Moving into my first house',
];
const OPENING_QUESTION = 'What do you want to experience?';
/* Only used when the question writer cannot be reached, so the conversation
   never stops on a network error. Asked in this order, skipping any already asked. */
const FALLBACK_QUESTIONS = [
  'How do you want to feel in this moment?',
  'What are you doing when this happens?',
  'Who is there with you?',
  'What is one detail that would make this scene feel unmistakably yours?',
];
const PRESETS = [
  ['emotional', 'More emotional'], ['realistic', 'More realistic'], ['romantic', 'More romantic'],
  ['luxurious', 'More luxurious'], ['intimate', 'More intimate'], ['playful', 'More playful'],
  ['sensory', 'More sensory'], ['cinematic', 'More cinematic'], ['like-me', 'Make it sound more like me'],
];
const THETA_OPTIONS = [
  ['off', 'Off'], ['theta', 'Theta'], ['delta', 'Delta'], ['alpha', 'Alpha'],
];
const COVER_KEYS = ['night', 'sunrise', 'clouds', 'garden', 'bedroom', 'waters', 'mirror', 'home'];
const DEFAULT_COVER = 'builtin:night';
const WPM = 140;

/* ------------------------------------------------------------ state */
const S = {
  screen: 'home',
  list: null, listLoading: false, thumbs: {},
  row: null,
  ask: { index: 0, question: OPENING_QUESTION, busy: false, error: '' },
  write: { error: '' },
  usage: null, pending: [], maxWords: 700,
  revise: { busy: false, key: '', msg: '', err: false, undo: [] },
  narrating: false, narrateMsg: '', narrateErr: false, limitNotice: false,
  keepOld: {},
  saveState: 'saved',
  pendingPatch: null, saveTimer: null, saveChain: Promise.resolve(), retryTimer: null,
  urlCache: null,
  phTimer: null, phIndex: 0,
  pollTimer: null,
};
let root = null;

/* ------------------------------------------------------------ small helpers */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const $ = (sel, scope) => (scope || root).querySelector(sel);
const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch(e){ return 'UTC'; } };
const normalize = (t) => String(t == null ? '' : t).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const wordCount = (t) => { const n = normalize(t); return n ? n.split(/\s+/).length : 0; };
const fmtDuration = (sec) => { sec = Math.max(0, Math.round(Number(sec) || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const answeredQA = (row) => (row.qa || []).filter((e) => e && (e.s || (e.a != null && e.a !== ''))).map((e) => ({ question: e.q, answer: e.s ? '' : e.a }));
const pendingEntry = (row) => (row.qa || []).find((e) => e && !e.s && (e.a == null || e.a === ''));
const askedCount = (row) => 1 + (row.qa || []).filter((e) => e && (e.s || (e.a != null && e.a !== ''))).length;

function narrationState(r){
  if (!r || r.narration_status !== 'ready' || !r.narration_path) return 'none';
  return r.narration_script_hash && r.narration_script_hash === r.script_hash ? 'ready' : 'stale';
}
function statusOf(r){
  if (r.stage !== 'written') return { key: 'draft', label: 'In progress' };
  const n = narrationState(r);
  if (n === 'ready') return { key: 'ready', label: 'Ready to listen' };
  if (n === 'stale') return { key: 'stale', label: 'Narration needs updating' };
  return { key: 'story', label: 'Story only' };
}

async function api(action, payload){
  const session = sb && (await sb.auth.getSession()).data.session;
  const token = session && session.access_token;
  let res;
  try {
    res = await fetch(`${API_BASE}/api/visualization`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, tz: timeZone(), ...(payload || {}) }),
    });
  } catch (e){
    const err = new Error('network'); err.code = 'network'; throw err;
  }
  let body = null;
  try { body = await res.json(); } catch (e){ /* not json */ }
  if (!res.ok){
    const err = new Error((body && body.error) || `http_${res.status}`);
    err.status = res.status; err.body = body || {}; err.code = (body && body.error) || 'http_error';
    throw err;
  }
  return body;
}

/* ------------------------------------------------------------ saving */
/* What the browser holds until the database has it. Written on every keystroke
   (synchronously, so a closing tab cannot beat it) and cleared once the save
   that contained it comes back. */
function mirrorRead(){ try { return JSON.parse(localStorage.getItem(MIRROR_KEY) || '{}'); } catch(e){ return {}; } }
function mirrorWrite(id, patch){
  try {
    const all = mirrorRead();
    if (patch) all[id] = { ...(all[id] || {}), ...patch, at: Date.now() }; else delete all[id];
    localStorage.setItem(MIRROR_KEY, JSON.stringify(all));
  } catch(e){ /* private mode: the debounce still saves */ }
}

function paintSave(){
  const el = $('#vizSaveState');
  if (!el) return;
  el.textContent = { saved: 'Saved', saving: 'Saving…', error: 'Not saved yet — we\'ll keep trying' }[S.saveState] || '';
}

/* Edits are batched for a moment and sent as one update. The mirror makes the
   edit durable immediately; the network catches up. */
function scheduleSave(patch){
  if (!S.row || !S.row.id) return;
  // A patch belongs to the row it was typed in, even if another is opened before it is sent.
  if (S.pendingPatch && S.pendingId !== S.row.id) flushSave();
  S.pendingId = S.row.id;
  S.pendingPatch = { ...(S.pendingPatch || {}), ...patch };
  mirrorWrite(S.row.id, patch);
  S.saveState = 'saving'; paintSave();
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
}

function flushSave(){
  clearTimeout(S.saveTimer); S.saveTimer = null;
  if (!S.pendingPatch || !S.pendingId || !sb || !currentUser) return S.saveChain;
  const id = S.pendingId;
  const patch = S.pendingPatch;
  S.pendingPatch = null;
  const write = async () => {
    try {
      const { data, error } = await sb.from(TABLE).update(patch).eq('id', id).eq('user_id', currentUser.id)
        .select('id,script_hash,updated_at,narration_path,narration_script_hash,narration_status,narration_duration_seconds,narration_generated_at').single();
      if (error || !data) throw error || new Error('nothing was saved');
      // Only what the database decides is taken back. What the person typed in
      // the meantime is theirs, and a response must never overwrite it.
      if (S.row && S.row.id === id) Object.assign(S.row, data);
      if (!S.pendingPatch) { S.saveState = 'saved'; mirrorWrite(id, null); }
      else S.saveState = 'saving';
      clearTimeout(S.retryTimer);
    } catch (e){
      console.error('visualization save failed:', e);
      S.pendingPatch = { ...patch, ...(S.pendingPatch || {}) };   // nothing is dropped
      S.saveState = 'error';
      clearTimeout(S.retryTimer);
      S.retryTimer = setTimeout(flushSave, 8000);
    }
    paintSave(); paintCta(); paintMeta();
  };
  S.saveChain = S.saveChain.then(write, write);
  return S.saveChain;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
window.addEventListener('pagehide', () => flushSave());

/* ------------------------------------------------------------ data */
async function loadList(){
  if (!sb || !currentUser) return;
  if (S.listLoading) return;
  S.listLoading = true;
  try {
    const { data, error } = await sb.from(TABLE).select(LIST_COLS).eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false }).limit(100);
    if (error) throw error;
    S.list = data || [];
    S.listError = false;
  } catch (e){
    console.error('could not load visualizations:', e);
    S.listError = true;
    if (!S.list) S.list = [];
  }
  S.listLoading = false;
  if (S.screen === 'home') { paintList(); loadThumbs(); }
}

async function refreshUsage(){
  try {
    const out = await api('usage');
    S.usage = out.usage; S.pending = out.pending || []; if (out.maxWords) S.maxWords = out.maxWords;
  } catch (e){ /* the numbers are a courtesy; the server still enforces them */ }
  paintCta();
}

async function loadRow(id){
  const { data, error } = await sb.from(TABLE).select('*').eq('id', id).eq('user_id', currentUser.id).single();
  if (error || !data) throw error || new Error('not found');
  return data;
}

/* A cover is a built-in that ships with the app, or a picture of their own in
   the covers bucket, which needs a link that expires. */
function coverUrlSync(path){
  if (!path) return null;
  if (typeof builtinCoverUrl === 'function') { const b = builtinCoverUrl(path); if (b) return b; }
  return null;
}
async function coverUrl(path){
  const direct = coverUrlSync(path);
  if (direct || !path || !sb) return direct;
  const { data } = await sb.storage.from('covers').createSignedUrl(path, 3600);
  return data ? data.signedUrl : null;
}
async function loadThumbs(){
  for (const r of S.list || []){
    if (!r.cover_path || S.thumbs[r.cover_path] || coverUrlSync(r.cover_path)) continue;
    const url = await coverUrl(r.cover_path);
    if (url){ S.thumbs[r.cover_path] = url; const img = root && root.querySelector(`[data-thumb="${r.id}"]`); if (img) img.src = url; }
  }
}

/* A fresh link for the saved narration. Fetched before it is needed — on opening
   a story, and right after narrating — so that pressing Enter the scene can start
   the sound inside the tap, which iOS Safari insists on. */
async function narrationUrl(row, fresh){
  if (!row || !row.narration_path) return null;
  const c = S.urlCache;
  if (!fresh && c && c.path === row.narration_path && Date.now() - c.at < 4 * 3600 * 1000) return c.url;
  const { data, error } = await sb.storage.from('visualization-audio').createSignedUrl(row.narration_path, 6 * 3600);
  if (error || !data) return null;
  S.urlCache = { path: row.narration_path, url: data.signedUrl, at: Date.now() };
  return data.signedUrl;
}

/* ------------------------------------------------------------ rendering: shell */
function mount(){
  root = document.getElementById('vizRoot');
  return root;
}
function stopPlaceholders(){ clearInterval(S.phTimer); S.phTimer = null; }
function render(html){
  if (!mount()) return;
  stopPlaceholders();
  root.innerHTML = html;
  window.scrollTo(0, 0);
}
function icon(name){
  const p = {
    star: '<path d="M12 3l1.9 5.4L19 10l-5.1 1.6L12 17l-1.9-5.4L5 10l5.1-1.6z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 16l5-4 4 3 3-2 6 4"/><circle cx="9" cy="9" r="1.3"/>',
  }[name] || '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" aria-hidden="true">${p}</svg>`;
}

/* ------------------------------------------------------------ home */
function renderHome(){
  S.screen = 'home';
  render(`
    <div class="viz-hero">
      <div class="viz-eyebrow">Visualization</div>
      <h1 class="viz-h1">Visualize it <em>before</em> you live it.</h1>
      <p class="viz-sub">Tell me what you want to experience, and I’ll turn it into a scene you can step into.</p>
      <button class="btn btn-primary viz-btn" type="button" data-act="start">Create a visualization</button>
    </div>
    <div class="viz-list-head"><h2>My Visualizations</h2></div>
    <div class="viz-list" id="vizList" aria-live="polite"></div>`);
  paintList();
  loadList();
  refreshUsage();
}

function paintList(){
  const el = $('#vizList');
  if (!el) return;
  if (S.list === null){ el.innerHTML = '<div class="viz-skeleton"></div><div class="viz-skeleton"></div>'; return; }
  if (!S.list.length){
    el.innerHTML = `<div class="viz-empty">${S.listError ? 'Your visualizations could not be loaded just now. Pull down to try again.' : 'Nothing here yet. The first one starts with a single question.'}</div>`;
    return;
  }
  el.innerHTML = S.list.map((r) => {
    const st = statusOf(r);
    const cover = coverUrlSync(r.cover_path) || S.thumbs[r.cover_path] || '';
    const preview = r.stage === 'written' ? normalize(r.script).replace(/\n+/g, ' ') : (r.initial_desire || '');
    const when = r.updated_at ? new Date(r.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const created = r.created_at ? new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : when;
    return `<button class="viz-item" type="button" data-act="open" data-id="${esc(r.id)}">
      <span class="viz-thumb">${cover ? `<img data-thumb="${esc(r.id)}" src="${esc(cover)}" alt="" loading="lazy">` : `<img data-thumb="${esc(r.id)}" alt="" hidden>${icon('star')}`}</span>
      <span class="viz-item-body">
        <span class="viz-item-title" style="display:block">${esc(r.stage === 'written' ? r.title : (r.initial_desire || 'Untitled'))}</span>
        <span class="viz-item-prev">${esc(preview)}</span>
        <span class="viz-item-foot"><span class="viz-pill ${st.key}">${st.label}</span><span>${esc(created)}</span>${r.narration_duration_seconds && st.key !== 'story' && st.key !== 'draft' ? `<span>${fmtDuration(r.narration_duration_seconds)}</span>` : ''}</span>
      </span></button>`;
  }).join('');
}

/* ------------------------------------------------------------ asking */
function startNew(){
  S.row = null;
  S.ask = { index: 0, question: OPENING_QUESTION, busy: false, error: '' };
  S.write = { error: '' };
  renderAsk();
}

function renderAsk(prefill){
  S.screen = 'ask';
  const a = S.ask;
  const first = a.index === 0;
  const total = MAX_QUESTIONS;
  const dots = Array.from({ length: total }, (_, i) => `<i class="${i < a.index ? 'on' : i === a.index ? 'now' : ''}"></i>`).join('');
  render(`
    <button class="viz-back" type="button" data-act="home">‹ My Visualizations</button>
    <div class="viz-progress"><span class="viz-dots" aria-hidden="true">${dots}</span><span>${a.index + 1} of up to ${total}</span></div>
    <h2 class="viz-q" id="vizQuestion" tabindex="-1">${esc(a.question)}</h2>
    <textarea class="viz-input" id="vizAnswer" rows="${first ? 3 : 3}" maxlength="${first ? 1000 : 600}"
      aria-labelledby="vizQuestion" placeholder="${first ? esc(PLACEHOLDERS[0]) : 'A sentence is plenty'}"
      ${a.busy ? 'disabled' : ''}>${esc(prefill || '')}</textarea>
    <div class="viz-msg ${a.error ? 'err' : ''}" id="vizAskMsg" role="status">${esc(a.error)}</div>
    <div class="viz-ask-actions">
      <button class="btn btn-primary viz-btn" type="button" data-act="answer" ${a.busy ? 'disabled' : ''}>${a.busy ? '<span class="viz-spin"></span>' : (first ? 'Continue' : 'Continue')}</button>
      ${first ? '' : `<button class="viz-linkbtn" type="button" data-act="skip" ${a.busy ? 'disabled' : ''}>Skip this one</button>`}
    </div>`);
  const ta = $('#vizAnswer');
  if (first && ta) startPlaceholders(ta);
  if (ta && !a.busy && !/iPhone|iPad/.test(navigator.userAgent)) ta.focus();   // iOS only opens the keyboard from a tap
  if (ta) ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover:hover)').matches){ e.preventDefault(); Viz.answer(); }
  });
}

function startPlaceholders(ta){
  S.phIndex = 0;
  S.phTimer = setInterval(() => {
    if (!document.body.contains(ta) || ta.value) return;
    ta.classList.add('ph-fade');
    setTimeout(() => {
      S.phIndex = (S.phIndex + 1) % PLACEHOLDERS.length;
      ta.setAttribute('placeholder', PLACEHOLDERS[S.phIndex]);
      ta.classList.remove('ph-fade');
    }, 420);
  }, 3400);
}

async function createRow(desire){
  const { data, error } = await sb.from(TABLE).insert({
    user_id: currentUser.id, initial_desire: desire, qa: [], stage: 'questions',
    title: 'Untitled visualization', cover_path: DEFAULT_COVER, frequency_hz: 528, theta_wave: 'off', nature_sound: 'none',
  }).select('*').single();
  if (error || !data) throw error || new Error('could not save');
  return data;
}

async function saveQA(){
  if (!S.row) return;
  const { error } = await sb.from(TABLE).update({ qa: S.row.qa }).eq('id', S.row.id).eq('user_id', currentUser.id);
  if (error) throw error;
}

/* The one button on every question. Question one makes the row; later ones fill
   in the last entry; then it asks for the next question or writes the scene. */
async function answer(skipped){
  if (S.ask.busy) return;
  const ta = $('#vizAnswer');
  const text = ta ? ta.value.trim() : '';
  if (!skipped && !text){ S.ask.error = 'Say a little, or skip this one.'; if (S.ask.index === 0) S.ask.error = 'Tell me what you want to experience.'; setAskMsg(); return; }
  S.ask.error = ''; S.ask.busy = true; renderAsk(text);
  try {
    if (S.ask.index === 0){
      S.row = await createRow(text);
    } else {
      const entry = pendingEntry(S.row);
      if (entry){ if (skipped) entry.s = true; else entry.a = text; }
      await saveQA();
    }
  } catch (e){
    console.error('could not save the answer:', e);
    S.ask.busy = false; S.ask.error = 'That could not be saved just now. Check your connection and try again.';
    renderAsk(text); return;
  }
  await nextStep();
}

function setAskMsg(){
  const m = $('#vizAskMsg'); if (!m) return;
  m.textContent = S.ask.error; m.className = `viz-msg ${S.ask.error ? 'err' : ''}`;
}

/* Another question, or the scene. The ceiling is applied here as well as on the
   server: five questions in all, counting the first, however the AI answers. */
async function nextStep(){
  const row = S.row;
  if (askedCount(row) >= MAX_QUESTIONS) return writeStory();
  S.ask.busy = true; S.ask.index = askedCount(row); S.ask.question = 'Thinking of your next question…'; renderAsk();
  let question = null;
  try {
    const out = await api('question', { desire: row.initial_desire, qa: answeredQA(row) });
    if (out.done) return writeStory();
    question = out.question;
  } catch (e){
    console.warn('question writer unavailable, using a fallback:', e.code || e);
    const asked = new Set((row.qa || []).map((x) => x.q));
    question = FALLBACK_QUESTIONS.find((q) => !asked.has(q)) || null;
    if (!question || answeredQA(row).length >= 3) return writeStory();
  }
  row.qa = [...(row.qa || []), { q: question }];
  try { await saveQA(); } catch (e){ console.error(e); }
  S.ask = { index: askedCount(row), question, busy: false, error: '' };
  renderAsk();
}

/* ------------------------------------------------------------ writing the scene */
async function writeStory(){
  S.screen = 'writing'; S.write.error = '';
  renderWriting();
  const row = S.row;
  try {
    const out = await api('write', { id: row.id, desire: row.initial_desire, qa: answeredQA(row) });
    const patch = { title: out.title, script: out.script, generated_script: out.script, stage: 'written' };
    Object.assign(row, patch);
    S.revise = { busy: false, key: '', msg: '', err: false, undo: [] };
    mirrorWrite(row.id, { script: out.script, title: out.title });
    /* Saved before it is shown, and again and again if it has to be: the story
       is the one thing here that costs money to make. */
    let saved = false;
    for (let i = 0; i < 3 && !saved; i++){
      try {
        const { data, error } = await sb.from(TABLE).update(patch).eq('id', row.id).eq('user_id', currentUser.id).select('*').single();
        if (error || !data) throw error || new Error('nothing saved');
        Object.assign(row, data); saved = true; mirrorWrite(row.id, null);
      } catch (e){ await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
    }
    S.saveState = saved ? 'saved' : 'error';
    if (!saved){ S.pendingPatch = patch; flushSave(); }
    renderEditor();
    refreshUsage();
  } catch (e){
    console.error('writing failed:', e);
    S.write.error = 'We couldn’t finish writing your scene. Your answers are saved.';
    renderWriting();
  }
}

function renderWriting(){
  const failed = !!S.write.error;
  render(`
    <div class="viz-card viz-writing">
      ${failed ? '' : '<div class="viz-orb" aria-hidden="true"></div>'}
      <h2 class="viz-q">${failed ? esc(S.write.error) : 'Writing your scene…'}</h2>
      ${failed ? '' : '<p class="viz-sub" style="margin-bottom:0">One moment. I’m placing you inside it.</p>'}
      ${failed ? `<div class="viz-stack" style="margin-top:18px">
        <button class="btn btn-primary viz-btn" type="button" data-act="retry-write">Try again</button>
        <button class="viz-linkbtn" type="button" data-act="home">Back to My Visualizations</button></div>` : ''}
    </div>`);
}

/* ------------------------------------------------------------ the editor */
async function openVisualization(id){
  render('<div class="viz-skeleton"></div><div class="viz-skeleton" style="margin-top:12px"></div>');
  try {
    const row = await loadRow(id);
    S.row = row;
    S.revise = { busy: false, key: '', msg: '', err: false, undo: [] };
    S.limitNotice = false; S.narrateMsg = ''; S.narrateErr = false;
    if (row.stage !== 'written') return resumeDraft();
    // An edit that was typed but never reached the database before the tab closed.
    const mirrored = mirrorRead()[row.id];
    if (mirrored && (mirrored.script != null || mirrored.title != null) && mirrored.at > new Date(row.updated_at).getTime() - 1000){
      const patch = {};
      if (mirrored.script != null && normalize(mirrored.script) !== normalize(row.script)) patch.script = mirrored.script;
      if (mirrored.title != null && mirrored.title !== row.title) patch.title = mirrored.title;
      if (Object.keys(patch).length){ Object.assign(row, patch); scheduleSave(patch); }
    }
    renderEditor();
    refreshUsage().then(() => { if (S.row && S.pending.includes(S.row.id)) pollPending(); });
    if (narrationState(row) !== 'none') narrationUrl(row).then(() => paintCta());
  } catch (e){
    console.error('could not open visualization:', e);
    render(`<div class="viz-card viz-writing"><h2 class="viz-q">We couldn’t open that one.</h2>
      <div class="viz-stack"><button class="btn btn-primary viz-btn" type="button" data-act="home">Back to My Visualizations</button></div></div>`);
  }
}

/* A creation that was left in the middle: back to the question it was on, or on
   to writing if the answers are all in. */
function resumeDraft(){
  const row = S.row;
  S.write = { error: '' };
  const pending = pendingEntry(row);
  if (pending){
    S.ask = { index: askedCount(row), question: pending.q, busy: false, error: '' };
    return renderAsk();
  }
  if (askedCount(row) >= MAX_QUESTIONS || row.script) return writeStory();
  return nextStep();
}

function renderEditor(){
  S.screen = 'editor';
  const r = S.row;
  const cover = coverUrlSync(r.cover_path) || S.thumbs[r.cover_path] || '';
  render(`
    <button class="viz-back" type="button" data-act="home">‹ My Visualizations</button>
    <h1 class="viz-h2" style="margin-top:6px">Your visualization</h1>
    <p class="viz-sub" style="margin:0 0 16px;max-width:none">Make it feel exactly like you before bringing it to life.</p>

    <div class="viz-titlebar">
      <button class="viz-cover-btn" type="button" data-act="cover" aria-label="Change cover">
        ${cover ? `<img id="vizCoverImg" src="${esc(cover)}" alt="">` : `<span id="vizCoverImg">${icon('image')}</span>`}
        <span class="viz-cover-edit" aria-hidden="true">✎</span>
      </button>
      <div style="flex:1;min-width:0">
        <label class="viz-title-label" for="vizTitle">Title</label>
        <input class="viz-title-input" id="vizTitle" type="text" maxlength="120" value="${esc(r.title)}" autocomplete="off" enterkeyhint="done" style="width:100%">
      </div>
    </div>

    <textarea class="viz-input viz-script" id="vizScript" aria-label="Your visualization" spellcheck="true">${esc(r.script || '')}</textarea>
    <div class="viz-meta"><span id="vizWords"></span><span class="viz-save" id="vizSaveState" role="status"></span></div>

    <div class="viz-section-label">Change it with AI</div>
    <div class="viz-chips" id="vizPresets">${PRESETS.map(([k, l]) => `<button class="viz-chip" type="button" data-act="preset" data-key="${k}">${l}</button>`).join('')}</div>
    <div class="viz-revise">
      <textarea class="viz-input" id="vizInstruction" rows="1" maxlength="500" aria-label="Tell us what to change" placeholder="Tell us what to change"></textarea>
      <button class="btn btn-ghost" type="button" data-act="instruct" id="vizInstructBtn">Apply</button>
    </div>
    <div class="viz-msg" id="vizReviseMsg" role="status"></div>
    <button class="viz-linkbtn viz-undo" type="button" data-act="undo" id="vizUndo" hidden>Undo last AI change</button>

    <div id="vizCta"></div>
    <div id="vizLayersWrap"></div>

    <div class="viz-danger"><button class="viz-linkbtn" type="button" data-act="delete">Delete this visualization</button></div>`);
  const script = $('#vizScript'), title = $('#vizTitle'), inst = $('#vizInstruction');
  autosize(script); autosize(inst, 140);
  script.addEventListener('input', () => {
    autosize(script);
    S.row.script = script.value;
    scheduleSave({ script: script.value });
    paintMeta();
  });
  title.addEventListener('input', () => { S.row.title = title.value; scheduleSave({ title: title.value.trim() || 'Untitled visualization' }); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); title.blur(); } });
  inst.addEventListener('input', () => autosize(inst, 140));
  inst.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover:hover)').matches){ e.preventDefault(); Viz.instruct(); }
  });
  paintMeta(); paintSave(); paintCta(); paintLayers(); paintRevise();
}

function autosize(el, max){
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, max || 4000) + 'px';
}

function paintMeta(){
  const el = $('#vizWords');
  if (!el || !S.row) return;
  const w = wordCount(S.row.script);
  const over = w > S.maxWords;
  const mins = w / WPM;
  el.innerHTML = over
    ? `<span class="over">${w} words · over the 5-minute limit by ${w - S.maxWords}</span>`
    : `${w} words · ${mins < 1 ? 'under a minute' : `about ${Math.max(1, Math.round(mins))} min`} aloud`;
}

function paintRevise(){
  const rv = S.revise;
  $$('#vizPresets .viz-chip').forEach((b) => {
    b.disabled = rv.busy;
    b.classList.toggle('sel', rv.busy && rv.key === b.dataset.key);
    if (rv.busy && rv.key === b.dataset.key) b.innerHTML = `<span class="viz-spin"></span> ${esc(PRESETS.find((p) => p[0] === b.dataset.key)[1])}`;
    else b.textContent = (PRESETS.find((p) => p[0] === b.dataset.key) || [])[1] || b.textContent;
  });
  const ib = $('#vizInstructBtn'); if (ib){ ib.disabled = rv.busy; ib.innerHTML = rv.busy && rv.key === 'free' ? '<span class="viz-spin"></span>' : 'Apply'; }
  const m = $('#vizReviseMsg'); if (m){ m.textContent = rv.msg; m.className = `viz-msg ${rv.err ? 'err' : rv.msg ? 'ok' : ''}`; }
  const u = $('#vizUndo'); if (u) u.hidden = !rv.undo.length || rv.busy;
}
function $$(sel){ return root ? Array.from(root.querySelectorAll(sel)) : []; }

/* One revision at a time. Whatever comes back replaces the text, the previous
   text is kept for Undo, and a failure leaves the story exactly as it was. */
async function revise(key, instruction){
  if (S.revise.busy || !S.row) return;
  const script = ($('#vizScript') || {}).value || S.row.script;
  if (!normalize(script)){ S.revise.msg = 'Write a little first, then change it.'; S.revise.err = true; paintRevise(); return; }
  S.revise.busy = true; S.revise.key = key === 'free' ? 'free' : key; S.revise.msg = 'Rewriting…'; S.revise.err = false; paintRevise();
  try {
    const out = await api('revise', {
      script, ...(key === 'free' ? { instruction } : { preset: key }),
      desire: S.row.initial_desire, qa: answeredQA(S.row),
    });
    S.revise.undo.push(script);
    S.row.script = out.script;
    const ta = $('#vizScript'); if (ta){ ta.value = out.script; autosize(ta); }
    scheduleSave({ script: out.script });
    S.revise.msg = 'Updated. You can keep editing, or change something else.'; S.revise.err = false;
    if (key === 'free'){ const i = $('#vizInstruction'); if (i){ i.value = ''; autosize(i, 140); } }
  } catch (e){
    console.error('revision failed:', e);
    S.revise.msg = 'That didn’t go through, and your story is unchanged. Try again.'; S.revise.err = true;
  }
  S.revise.busy = false; paintRevise(); paintMeta();
}

function undoRevise(){
  const prev = S.revise.undo.pop();
  if (prev == null) return;
  S.row.script = prev;
  const ta = $('#vizScript'); if (ta){ ta.value = prev; autosize(ta); }
  scheduleSave({ script: prev });
  S.revise.msg = 'Back to the previous version.'; S.revise.err = false;
  paintRevise(); paintMeta();
}

/* What the database decides about a row, taken back without touching what the
   person has typed since: the script, the title and the sound settings on the
   page are theirs, and a response that raced their typing must not win. */
function mergeServerFields(fresh){
  if (!fresh || !S.row || fresh.id !== S.row.id) return;
  ['script_hash', 'updated_at', 'narration_path', 'narration_script_hash', 'narration_generated_at',
   'narration_duration_seconds', 'narration_status', 'faith_used'].forEach((k) => { S.row[k] = fresh[k]; });
}

/* ------------------------------------------------------------ the narration call */
function limitReached(){ return !!(S.usage && S.usage.remaining <= 0); }

function limitNoticeHtml(){
  return `<div class="viz-notice" role="status"><b>Your story is ready.</b>
    <p>You’ve used today’s Serenity narration. Save this visualization and bring it to life tomorrow. Your story is saved, and you can keep editing it.</p></div>`;
}

function paintCta(){
  const el = $('#vizCta');
  if (!el || !S.row) return;
  const r = S.row;
  const state = narrationState(r);
  const words = wordCount(r.script);
  const over = words > S.maxWords;
  const pendingElsewhere = S.pending.includes(r.id) && !S.narrating;
  let html = '';

  if (S.narrating || pendingElsewhere){
    html = `<div class="viz-cta"><button class="btn btn-primary viz-btn" type="button" disabled><span class="viz-spin"></span> Serenity is narrating…</button>
      <p class="viz-cta-note">This can take up to a minute. Your story is saved, and it’s safe to wait here.</p></div>`;
  } else if (state === 'none'){
    html = `<div class="viz-cta">
      ${over ? `<div class="viz-notice"><b>A little long for one narration</b><p>Serenity narrates up to 5 minutes, about ${S.maxWords} words. Yours is ${words}. Trim it a little, or ask for a shorter version above.</p></div>` : ''}
      ${S.limitNotice ? limitNoticeHtml() : ''}
      <button class="btn btn-primary viz-btn" type="button" data-act="narrate" ${over || !words ? 'disabled' : ''}>✦ Bring this story to life</button>
      <p class="viz-cta-note">Serenity will narrate your visualization. Up to 5 minutes.</p></div>`;
  } else {
    const stale = state === 'stale';
    const kept = stale && S.keepOld[r.id] === r.script_hash;
    html = `<div class="viz-cta">
      ${stale && !kept ? staleNoticeHtml(over, words) : ''}
      ${S.limitNotice && stale ? limitNoticeHtml() : ''}
      <button class="btn btn-primary viz-btn" type="button" data-act="enter">▶ Enter the scene</button>
      <p class="viz-cta-note">Narrated by Serenity${r.narration_duration_seconds ? ` · ${fmtDuration(r.narration_duration_seconds)}` : ''}${stale ? ' · <b>narration needs updating</b>' : ''}</p>
      ${kept ? '<button class="viz-linkbtn" type="button" data-act="update-narration">Update narration</button>' : ''}
    </div>`;
  }
  if (S.narrateMsg) html += `<div class="viz-msg ${S.narrateErr ? 'err' : 'ok'}" role="status" style="text-align:center">${esc(S.narrateMsg)}</div>`;
  el.innerHTML = html;
  paintLayers();
}

function staleNoticeHtml(over, words){
  const remaining = S.usage ? S.usage.remaining : null;
  const note = over
    ? `Your story is over the 5-minute limit (${words} words), so it needs a trim before it can be narrated again. Your current narration stays until then.`
    : remaining === 0
      ? `You’ve used today’s Serenity narration, so this one can be updated tomorrow. Your current narration stays until then.`
      : `Updating uses another narration generation${remaining != null ? ` (${remaining} left today)` : ''}. Your current narration stays until the new one is ready.`;
  return `<div class="viz-notice" role="status"><b>Your story has changed.</b>
    <p>Update Serenity’s narration to match?<br>${esc(note)}</p>
    <div class="row">
      <button class="btn btn-primary" type="button" data-act="update-narration" ${over ? 'disabled' : ''}>Update narration</button>
      <button class="btn btn-ghost" type="button" data-act="keep-narration">Keep current narration</button>
    </div></div>`;
}

async function narrate(replace){
  const r = S.row;
  /* The guard is taken in the same tick as the tap, before anything is awaited:
     two taps in a row must find it already taken. (Setting it after the first
     await would let both through.) */
  if (!r || S.narrateClaim || S.narrating) return;
  S.narrateClaim = true;
  try { await narrateClaimed(r, replace); } finally { S.narrateClaim = false; }
}

async function narrateClaimed(r, replace){
  if (narrationState(r) === 'ready') return enter();   // the audio already matches: nothing to make
  S.narrateMsg = ''; S.limitNotice = false;

  // Serenity is a Ritual feature; ask before anything is sent.
  if (typeof canUseFeature === 'function' && !(await canUseFeature('studio_voice'))){
    if (typeof openUpgradeModal === 'function') openUpgradeModal('studio_voice', { trigger: 'visualization_narration' });
    return;
  }
  if (limitReached()){ S.limitNotice = true; paintCta(); return; }

  S.narrating = true; paintCta();
  try {
    await flushSave();                                 // the server narrates what is saved, so save it first
    if (S.pendingPatch) throw Object.assign(new Error('unsaved'), { code: 'unsaved' });
    const out = await api('narrate', { id: r.id, replace: !!replace });
    S.usage = out.usage || S.usage;
    mergeServerFields(await loadRow(r.id));
    if (out.narration && out.narration.url) S.urlCache = { path: out.narration.path, url: out.narration.url, at: Date.now() };
    delete S.keepOld[r.id];
    S.narrateMsg = out.alreadyCurrent ? '' : 'Your narration is ready. Choose your sound layers, then enter the scene.';
    S.narrateErr = false;
    refreshUsage();
  } catch (e){
    S.narrateErr = true;
    const b = (e && e.body) || {};
    if (e.code === 'upgrade_required'){
      S.narrateMsg = '';
      if (typeof openUpgradeModal === 'function') openUpgradeModal('studio_voice', { trigger: 'visualization_narration' });
    } else if (e.code === 'daily_limit'){
      S.usage = b.usage || S.usage; S.limitNotice = true; S.narrateMsg = ''; S.narrateErr = false;
    } else if (e.code === 'confirm_replace'){
      mergeServerFields(await loadRow(r.id).catch(() => null)); S.narrateMsg = ''; S.narrateErr = false;
    } else if (e.code === 'already_generating'){
      S.narrateMsg = 'Serenity is already working on this one. It will appear here when it’s ready.';
      S.narrateErr = false; S.pending = [...new Set([...S.pending, r.id])]; pollPending();
    } else if (e.code === 'too_long'){
      S.narrateMsg = `Serenity narrates up to 5 minutes (about ${b.maxWords || S.maxWords} words). Yours is ${b.words || wordCount(r.script)}. Trim it a little and try again.`;
    } else if (e.code === 'unsaved'){
      S.narrateMsg = 'Your latest edits haven’t saved yet. Check your connection and try again.';
    } else if (e.code === 'no_script'){
      S.narrateMsg = 'Write a few lines first.';
    } else {
      S.narrateMsg = 'Serenity couldn’t finish your narration. Your story is safe. Try again.';
    }
  }
  S.narrating = false;
  paintCta(); paintMeta();
  if (S.row && narrationState(S.row) === 'ready') narrationUrl(S.row).catch(() => {});
}

/* Refreshed in the middle of a narration: the server still has it in flight, so
   say so, and look again until it lands. */
function pollPending(){
  clearTimeout(S.pollTimer);
  let tries = 0;
  const tick = async () => {
    if (S.screen !== 'editor' || !S.row || !S.pending.includes(S.row.id) || ++tries > 30) return;
    await refreshUsage();
    if (!S.pending.includes(S.row.id)){
      const fresh = await loadRow(S.row.id).catch(() => null);
      if (fresh){ mergeServerFields(fresh); S.narrateMsg = narrationState(fresh) === 'none' ? '' : 'Your narration is ready.'; S.narrateErr = false; paintCta(); }
      return;
    }
    S.pollTimer = setTimeout(tick, 4000);
  };
  S.pollTimer = setTimeout(tick, 4000);
}

/* ▶ Enter the scene. Starts the saved narration — no request to make audio is
   possible from here — inside the tap, using a link fetched earlier. */
async function enter(){
  const r = S.row;
  if (!r || narrationState(r) === 'none' || typeof VizPlayer === 'undefined') return;
  flushSave();   // not awaited: iOS wants the sound started inside the tap itself
  const cached = S.urlCache && S.urlCache.path === r.narration_path ? S.urlCache.url : null;
  VizPlayer.open(r, { url: cached, resolveUrl: () => narrationUrl(r, true), coverUrl: coverUrlSync(r.cover_path) || S.thumbs[r.cover_path] || null });
  if (!cached) narrationUrl(r).then((u) => { if (u) VizPlayer.setUrl(u); });
}

/* ------------------------------------------------------------ sound layers */
function frequencyOptions(){
  const list = typeof FREQS !== 'undefined' ? FREQS : [174, 285, 396, 417, 432, 528, 639, 741, 852, 963].map((hz) => ({ hz, word: '' }));
  return list;
}
function natureGroups(){
  const groups = typeof ambienceFamilies === 'function' ? ambienceFamilies() : [];
  if (groups.length) return groups.map((g) => ({ label: g.label, tracks: g.tracks.map((t) => ({ key: t.key, name: t.name })) }));
  return [{ label: 'Nature', tracks: [{ key: 'rain', name: 'Rain' }, { key: 'ocean', name: 'Ocean' }, { key: 'forest', name: 'Wind & forest' }] }];
}

/* The three layers, as one block of controls. Drawn both under the story and in
   the player's sheet, so it carries no ids — only data-vz-* attributes the
   handlers and syncLayerInputs() find it by. Every control here saves a setting
   on the visualization and nothing else. */
function layersHtml(r){
  const hz = r.frequency_hz || '';
  const nat = r.nature_sound || 'none';
  return `<div class="viz-layers">
    <div class="viz-layer">
      <div class="viz-layer-head"><span class="viz-layer-name">Serenity</span><span class="viz-layer-val" data-vz-val="narration_volume">${r.narration_volume}%</span></div>
      <input class="viz-range" type="range" min="0" max="100" value="${r.narration_volume}" aria-label="Serenity volume" data-vz-layer="narration_volume">
    </div>
    <div class="viz-layer">
      <div class="viz-layer-head"><span class="viz-layer-name">Frequency</span><span class="viz-layer-val" data-vz-val="frequency_volume">${r.frequency_volume}%</span></div>
      <select class="viz-select" aria-label="Frequency" data-vz-layer="frequency_hz">
        <option value="" ${hz ? '' : 'selected'}>No frequency</option>
        ${frequencyOptions().map((f) => `<option value="${f.hz}" ${Number(hz) === f.hz ? 'selected' : ''}>${f.hz} Hz${f.word ? ` · ${esc(f.word)}` : ''}</option>`).join('')}
      </select>
      <input class="viz-range" type="range" min="0" max="100" value="${r.frequency_volume}" aria-label="Frequency volume" data-vz-layer="frequency_volume">
      <div class="viz-section-label" style="margin:14px 0 8px">Theta wave</div>
      <div class="viz-seg" role="radiogroup" aria-label="Theta wave">${THETA_OPTIONS.map(([k, l]) => `<button type="button" class="viz-chip ${r.theta_wave === k ? 'sel' : ''}" role="radio" aria-checked="${r.theta_wave === k}" data-vz-theta="${k}">${l}</button>`).join('')}</div>
      <p class="viz-hint">A slow pulse underneath the frequency. Works best with headphones.</p>
    </div>
    <div class="viz-layer">
      <div class="viz-layer-head"><span class="viz-layer-name">Nature sounds</span><span class="viz-layer-val" data-vz-val="nature_volume">${r.nature_volume}%</span></div>
      <select class="viz-select" aria-label="Nature sound" data-vz-layer="nature_sound">
        <option value="none" ${nat === 'none' ? 'selected' : ''}>No nature sounds</option>
        ${natureGroups().map((g) => `<optgroup label="${esc(g.label)}">${g.tracks.map((t) => `<option value="${esc(t.key)}" ${nat === t.key ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <input class="viz-range" type="range" min="0" max="100" value="${r.nature_volume}" aria-label="Nature sound volume" data-vz-layer="nature_volume">
    </div>
  </div>`;
}

function paintLayers(){
  const wrap = $('#vizLayersWrap');
  if (!wrap || !S.row) return;
  if (narrationState(S.row) === 'none'){ wrap.innerHTML = ''; return; }
  if (wrap.dataset.built === S.row.id) return;      // already drawn; never rebuild under a thumb mid-drag
  wrap.dataset.built = S.row.id;
  wrap.innerHTML = `<div class="viz-section-label">Sound layers</div>
    <p class="viz-hint" style="margin:-4px 0 12px">Layer a frequency and nature sounds under Serenity. Changing any of this never uses another narration.</p>
    ${layersHtml(S.row)}`;
}

/* A control moved. Update the row, save it, tell the player if it is playing, and
   keep the other copy of the controls (page and player sheet) in step. */
function setLayer(field, rawValue){
  const r = S.row;
  if (!r) return;
  const numeric = ['narration_volume', 'frequency_volume', 'nature_volume'];
  let value = rawValue;
  if (numeric.includes(field)) value = Math.max(0, Math.min(100, Math.round(Number(rawValue) || 0)));
  else if (field === 'frequency_hz') value = rawValue === '' || rawValue == null ? null : Number(rawValue);
  r[field] = value;
  scheduleSave({ [field]: value });
  syncLayerInputs();
  if (typeof VizPlayer !== 'undefined' && VizPlayer.isOpen()) VizPlayer.apply(r);
}
function syncLayerInputs(){
  const scopes = [root, document.getElementById('vzSheetBody')].filter(Boolean);
  scopes.forEach((scope) => {
    scope.querySelectorAll('[data-vz-layer]').forEach((el) => {
      const v = S.row[el.dataset.vzLayer];
      if (document.activeElement !== el) el.value = v == null ? '' : v;
    });
    scope.querySelectorAll('[data-vz-val]').forEach((el) => { el.textContent = `${S.row[el.dataset.vzVal]}%`; });
    scope.querySelectorAll('[data-vz-theta]').forEach((el) => {
      const on = el.dataset.vzTheta === S.row.theta_wave;
      el.classList.toggle('sel', on); el.setAttribute('aria-checked', String(on));
    });
  });
}

/* ------------------------------------------------------------ cover */
function pickCover(){
  closeCoverPop();
  const pop = document.createElement('div');
  pop.className = 'viz-cover-pop'; pop.id = 'vizCoverPop';
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose a cover');
  pop.innerHTML = `<div class="viz-cover-grid">${COVER_KEYS.map((k) =>
    `<button type="button" class="${S.row.cover_path === 'builtin:' + k ? 'sel' : ''}" data-vz-cover="${k}" aria-label="${k}"><img src="img/covers/${k}.webp" alt="" loading="lazy"></button>`).join('')}</div>
    <div class="viz-cover-foot"><button type="button" class="viz-linkbtn" data-vz-cover-upload>Use my own picture…</button><button type="button" class="viz-linkbtn" data-vz-cover-close>Cancel</button></div>`;
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('click', coverOutside), 0);
}
function coverOutside(e){ const p = document.getElementById('vizCoverPop'); if (p && !p.contains(e.target)) closeCoverPop(); }
function closeCoverPop(){ const p = document.getElementById('vizCoverPop'); if (p) p.remove(); document.removeEventListener('click', coverOutside); }

function setCoverPath(path, url){
  S.row.cover_path = path;
  scheduleSave({ cover_path: path });
  S.thumbs[path] = url || S.thumbs[path];
  const slot = $('#vizCoverImg');
  const shown = url || coverUrlSync(path);
  if (slot && shown){
    if (slot.tagName === 'IMG') slot.src = shown; else { const img = document.createElement('img'); img.id = 'vizCoverImg'; img.alt = ''; img.src = shown; slot.replaceWith(img); }
  }
  if (typeof VizPlayer !== 'undefined' && VizPlayer.isOpen()) VizPlayer.setCover(shown);
}
function uploadCover(){
  closeCoverPop();
  let input = document.getElementById('vizCoverFile');
  if (!input){ input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.id = 'vizCoverFile'; input.style.display = 'none'; document.body.appendChild(input); }
  input.onchange = async () => {
    const file = input.files && input.files[0]; input.value = '';
    if (!file || !S.row) return;
    try {
      const blob = await squareCover(file);
      const path = `${currentUser.id}/viz-${S.row.id}.webp`;
      const { error } = await sb.storage.from('covers').upload(path, blob, { upsert: true, contentType: 'image/webp' });
      if (error) throw error;
      const { data } = await sb.storage.from('covers').createSignedUrl(path, 3600);
      setCoverPath(path, data && data.signedUrl);
    } catch (e){ console.error('cover upload failed:', e); alert('That picture could not be added. Try another.'); }
  };
  input.click();
}

/* ------------------------------------------------------------ delete */
async function remove(){
  const r = S.row;
  if (!r || !confirm('Delete this visualization and its narration? This can’t be undone.')) return;
  try {
    await api('delete', { id: r.id });
    mirrorWrite(r.id, null);
    S.list = null; S.row = null;
    renderHome();
  } catch (e){
    alert('That couldn’t be deleted just now. Please try again.');
  }
}

/* ------------------------------------------------------------ events */
function onClick(e){
  const t = e.target.closest('[data-act],[data-vz-theta],[data-vz-cover],[data-vz-cover-upload],[data-vz-cover-close]');
  if (!t) return;
  if (t.dataset.vzTheta){ setLayer('theta_wave', t.dataset.vzTheta); return; }
  if (t.dataset.vzCover){ closeCoverPop(); setCoverPath('builtin:' + t.dataset.vzCover); return; }
  if (t.hasAttribute('data-vz-cover-upload')){ uploadCover(); return; }
  if (t.hasAttribute('data-vz-cover-close')){ closeCoverPop(); return; }
  const act = t.dataset.act;
  switch (act){
    case 'start': startNew(); break;
    case 'home': backHome(); break;
    case 'open': openVisualization(t.dataset.id); break;
    case 'answer': answer(false); break;
    case 'skip': answer(true); break;
    case 'retry-write': writeStory(); break;
    case 'preset': revise(t.dataset.key); break;
    case 'instruct': instruct(); break;
    case 'undo': undoRevise(); break;
    case 'narrate': narrate(false); break;
    case 'update-narration': narrate(true); break;
    case 'keep-narration': S.keepOld[S.row.id] = S.row.script_hash; paintCta(); break;
    case 'enter': enter(); break;
    case 'cover': pickCover(); break;
    case 'delete': remove(); break;
  }
}
function onInput(e){
  const t = e.target;
  if (t.matches && t.matches('[data-vz-layer]')){
    if (t.type === 'range' || t.tagName === 'SELECT') setLayer(t.dataset.vzLayer, t.value);
  }
}
function instruct(){
  const i = $('#vizInstruction');
  const text = i ? i.value.trim() : '';
  if (!text){ S.revise.msg = 'Tell us what to change, like “Make my boyfriend funnier.”'; S.revise.err = true; paintRevise(); return; }
  revise('free', text);
}
function backHome(){
  flushSave();
  clearTimeout(S.pollTimer);
  if (typeof VizPlayer !== 'undefined' && VizPlayer.isOpen()) VizPlayer.close();
  S.row = null; S.screen = 'home';
  renderHome();
}

document.addEventListener('click', (e) => { if (root && (root.contains(e.target) || (e.target.closest && e.target.closest('#vizCoverPop, #vzSheetBody')))) onClick(e); });
document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('#vizRoot, #vzSheetBody')) onInput(e); });
document.addEventListener('change', (e) => { if (e.target.closest && e.target.closest('#vizRoot, #vzSheetBody')) onInput(e); });

/* ------------------------------------------------------------ entry */
/* The signed-in person changed (or signed out): nothing of the last person's is
   allowed to be on the screen or in memory for the next one. */
function syncUser(){
  const id = currentUser ? currentUser.id : null;
  if (S.userId === id) return false;
  Object.assign(S, { userId: id, screen: 'home', row: null, list: null, usage: null, pending: [], urlCache: null, thumbs: {}, keepOld: {} });
  if (typeof VizPlayer !== 'undefined' && VizPlayer.isOpen()) VizPlayer.close();
  if (mount()) root.innerHTML = '';
  return true;
}

function showVisualizePage(){
  if (!currentUser){ openAuthModal(); return; }
  syncUser();
  document.body.setAttribute('data-view', 'visualize');
  window.scrollTo(0, 0);
  if (location.hash !== '#visualize') history.pushState({ page: 'visualize' }, '', '#visualize');
  renderVisualizeState();
  // Back to the invitation unless something is half done, which stays exactly as it was left.
  if (S.screen === 'home') renderHome();
}

/* Safe to call as often as the app likes (it is called on every auth refresh):
   it draws only when there is nothing drawn, and never over somebody's typing. */
function renderVisualizeState(){
  if (!mount()) return;
  if (!currentUser){ syncUser(); return; }
  syncUser();
  if (!root.firstElementChild) renderHome();
}

const Viz = {
  show: showVisualizePage,
  render: renderVisualizeState,
  answer: () => answer(false),
  instruct,
  layersHtml: () => layersHtml(S.row),
  setLayer,
  syncLayerInputs,
  current: () => S.row,
  usage: () => S.usage,
  /* exposed for scripts/visualization-e2e.cjs */
  _state: S,
};
window.Viz = Viz;
window.showVisualizePage = showVisualizePage;
window.renderVisualizeState = renderVisualizeState;
})();
