/* The "✦ Affirmation Layering" panel.

   One renderer for every place the panel lives (the immersive player, and the
   finished-subliminal screen before the first play). It owns no audio and no
   state: it reads state.voiceLayers and calls the functions in js/builder.js
   (setVoiceLayerCount, setVoiceLayerMode, ...). Re-rendering is structural only
   -- when the number of layers, the mode, the lines or their owners change --
   so dragging a slider is never interrupted by a repaint. */
(function (root) {
  'use strict';

  const SUBTITLE = 'Layer your affirmations to hear more of your intentions in every session.';

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  /* [0,1,2,3,7] -> "1–4, 8" */
  function rangeText(group) {
    const g = (group || []).slice().sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < g.length; i++) {
      let j = i;
      while (j + 1 < g.length && g[j + 1] === g[j] + 1) j++;
      out.push(j === i ? String(g[i] + 1) : (g[i] + 1) + '–' + (g[j] + 1));
      i = j;
    }
    return out.join(', ');
  }
  function deviceVoiceOnly() {
    return typeof state !== 'undefined' && state.voiceMode === 'ai'
      && (!state.aiVoiceId || state.aiVoiceId === (typeof DEVICE_VOICE !== 'undefined' ? DEVICE_VOICE : 'device'));
  }
  function structureKey(cfg, groups, total, blocked) {
    return [cfg.count, groups.map(g => g.join('.')).join('|'), total, blocked ? 1 : 0,
      (state.affirmations || []).join('\u0001')].join('~');
  }

  function panelHtml(cfg, groups, total, blocked, openState) {
    const k = groups.length;
    const lines = state.affirmations || [];
    const gains = cfg.volumes;
    const count = [1, 2, 3, 4].map(n =>
      `<button type="button" role="radio" class="vl-chip" data-vl-count="${n}" aria-checked="${n === cfg.count}" onclick="setVoiceLayerCount(${n})">${n}<span> layer${n > 1 ? 's' : ''}</span></button>`).join('');
    const mode = [['staggered', 'Staggered', 'Recommended'], ['simultaneous', 'Simultaneous', '']].map(([m, name, tag]) =>
      `<button type="button" role="radio" class="vl-chip vl-chip-wide" data-vl-mode="${m}" aria-checked="${m === cfg.mode}" onclick="setVoiceLayerMode('${m}')">${name}${tag ? `<small>${tag}</small>` : ''}</button>`).join('');
    const rows = groups.map((g, i) => {
      const id = 'vlVol' + i;
      const input = i === 0
        ? `<input type="range" id="${id}" min="0" max="100" data-listening-mix="mixVoice" aria-label="Voice 1 volume" oninput="setListeningMix('mixVoice',this.value)">`
        : `<input type="range" id="${id}" min="0" max="100" data-vl-vol="${i}" aria-label="Voice ${i + 1} volume" oninput="setVoiceLayerVolume(${i},this.value)">`;
      const out = i === 0 ? `<output data-listening-value="mixVoice"></output>` : `<output data-vl-out="${i}"></output>`;
      return `<label class="vl-row" for="${id}"><span class="vl-row-name">Voice ${i + 1}<small>${k > 1 ? 'Affirmations ' + esc(rangeText(g)) : 'All affirmations'}</small></span>${input}${out}</label>`;
    }).join('');
    const adv = lines.map((text, i) => {
      const owner = VoiceLayers.layerOf(groups, i);
      const opts = groups.map((_, n) => `<option value="${n}"${n === owner ? ' selected' : ''}>Voice ${n + 1}</option>`).join('');
      return `<li class="vl-adv-row"><span class="vl-adv-n">${i + 1}</span><span class="vl-adv-text">${esc(text)}</span><select aria-label="Voice for affirmation ${i + 1}" data-vl-line="${i}" onchange="assignVoiceLayerLine(${i},Number(this.value))">${opts}</select></li>`;
    }).join('');
    const notes = [];
    if (blocked) notes.push('The built-in device voice reads one line at a time, so layers need Record Your Own Voice or a studio voice. Your session will play as one voice.');
    else if (cfg.count > k) notes.push(`You have ${total} affirmation${total === 1 ? '' : 's'}, so ${k} layer${k === 1 ? ' is' : 's are'} in use.`);
    return `<details class="vl-panel"${openState.outer ? ' open' : ''}>
      <summary><span class="vl-star" aria-hidden="true">✦</span> Affirmation Layering</summary>
      <p class="vl-sub">${SUBTITLE}</p>
      <div class="vl-group"><span class="vl-label" id="vlCountLabel">Voice layers</span><div class="vl-chips" role="radiogroup" aria-labelledby="vlCountLabel">${count}</div></div>
      <div class="vl-group"><span class="vl-label" id="vlModeLabel">Playback timing</span><div class="vl-chips" role="radiogroup" aria-labelledby="vlModeLabel">${mode}</div></div>
      <label class="vl-row vl-stagger-row" data-vl-stagger><span class="vl-row-name">Stagger<small>Gap between voices</small></span><input type="range" min="2" max="4" step="0.5" data-vl-stagger-input aria-label="Seconds between voices" oninput="setVoiceLayerStagger(this.value*1000)"><output data-vl-stagger-out></output></label>
      <div class="vl-layers">${rows}</div>
      ${notes.map(n => `<p class="vl-note">${esc(n)}</p>`).join('')}
      <div class="vl-actions">
        <button type="button" class="vl-btn" onclick="previewVoiceLayersFromPanel()">Preview</button>
        <button type="button" class="vl-btn vl-btn-quiet" onclick="resetVoiceLayers()">Reset to recommended</button>
      </div>
      <p class="vl-status" data-vl-status role="status"></p>
      <details class="vl-advanced"${openState.adv ? ' open' : ''}>
        <summary>Advanced: choose each voice's affirmations</summary>
        <p class="vl-note">Each affirmation belongs to exactly one voice and keeps its order. Nothing is re-recorded or copied.</p>
        <button type="button" class="vl-btn vl-btn-quiet" onclick="balanceVoiceLayers()">Balance automatically</button>
        <ol class="vl-adv-list">${adv}</ol>
      </details>
      <p class="vl-note">In the list, the lit line is your main voice (Voice 1). Other voices show as a soft glow and a small label, and never move the list.</p>
      <p class="vl-note vl-fine">Layers play together, so four voices for twenty minutes is still twenty minutes of listening.</p>
    </details>`;
  }

  function paintValues(host, cfg) {
    host.querySelectorAll('[data-vl-vol]').forEach(el => {
      const i = Number(el.dataset.vlVol);
      if (root.document.activeElement !== el) el.value = cfg.volumes[i];
      const out = host.querySelector('[data-vl-out="' + i + '"]');
      if (out) out.textContent = cfg.volumes[i] + '%';
    });
    const st = host.querySelector('[data-vl-stagger-input]');
    if (st && root.document.activeElement !== st) st.value = cfg.staggerMs / 1000;
    const so = host.querySelector('[data-vl-stagger-out]');
    if (so) so.textContent = (cfg.staggerMs / 1000).toFixed(1) + ' s';
    const row = host.querySelector('[data-vl-stagger]');
    if (row) row.hidden = cfg.mode !== 'staggered' || cfg.count < 2;
    host.querySelectorAll('[data-vl-count]').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.vlCount) === cfg.count)));
    host.querySelectorAll('[data-vl-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.vlMode === cfg.mode)));
    if (typeof syncListeningMix === 'function') syncListeningMix();
  }

  function renderVoiceLayerPanels() {
    const hosts = root.document.querySelectorAll('[data-voice-layers-host]');
    if (!hosts.length || typeof state === 'undefined') return;
    const cfg = VoiceLayers.normalizeConfig(state.voiceLayers);
    const total = (state.affirmations || []).length;
    const groups = voiceLayerGroups();
    const blocked = deviceVoiceOnly() || (typeof voiceLayersSuppressed !== 'undefined' && voiceLayersSuppressed);
    const key = structureKey(cfg, voiceLayerGroupsRaw(cfg, total), total, blocked);
    hosts.forEach(host => {
      if (host.dataset.vlKey !== key) {
        const prev = host.querySelector('.vl-panel');
        const openState = { outer: !!(prev && prev.open), adv: !!(prev && prev.querySelector('.vl-advanced') && prev.querySelector('.vl-advanced').open) };
        const focused = root.document.activeElement && host.contains(root.document.activeElement) ? root.document.activeElement.getAttribute('data-vl-line') : null;
        host.innerHTML = panelHtml(cfg, groups, total, blocked, openState);
        host.dataset.vlKey = key;
        if (focused != null) { const el = host.querySelector('[data-vl-line="' + focused + '"]'); if (el) el.focus(); }
      }
      paintValues(host, cfg);
    });
  }
  /* The groups as configured, before recordings are taken into account, so the
     key does not change just because a take finished loading. */
  function voiceLayerGroupsRaw(cfg, total) { return VoiceLayers.resolveGroups(cfg, total); }

  root.previewVoiceLayersFromPanel = function () {
    const ok = typeof previewVoiceLayers === 'function' && previewVoiceLayers();
    root.document.querySelectorAll('[data-vl-status]').forEach(el => {
      el.textContent = ok ? 'Replaying the start of every voice.' : 'Press play first, then preview your layers.';
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.textContent = ''; }, 4000);
    });
  };
  root.renderVoiceLayerPanels = renderVoiceLayerPanels;
  root.VoiceLayersUI = { rangeText, panelHtml, SUBTITLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.VoiceLayersUI;
})(typeof window !== 'undefined' ? window : globalThis);
