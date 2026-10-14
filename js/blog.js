/* Reader-side enhancements for The Subliminally Journal. Everything here is
   optional: the article reads fully without it. */
(function () {
  document.documentElement.classList.add('js');

  // Copy link / native share
  document.querySelectorAll('[data-share]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-url') || location.href;
      if (btn.dataset.share === 'native' && navigator.share) {
        navigator.share({ title: document.title, url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { btn.textContent = 'Link copied'; setTimeout(function () { btn.textContent = btn.dataset.label; }, 2000); });
      }
    });
    if (btn.dataset.share === 'native' && !navigator.share) btn.hidden = true;
  });

  // One question at a time: wrap each H2 section, show one, offer Next/Back.
  var prose = document.querySelector('.prose[data-qmode]');
  var toggle = document.getElementById('qmode-toggle');
  if (!prose || !toggle) return;
  var kids = Array.prototype.slice.call(prose.children), sections = [], cur = null;
  kids.forEach(function (el) {
    if (el.tagName === 'H2') { cur = document.createElement('section'); cur.setAttribute('data-q', ''); prose.insertBefore(cur, el); sections.push(cur); }
    if (cur) cur.appendChild(el);
  });
  if (sections.length < 2) { toggle.hidden = true; return; }
  var idx = 0;
  var prog = document.getElementById('qprog');
  var back = document.getElementById('qback');
  var next = document.getElementById('qnext');
  function show(i) {
    idx = Math.max(0, Math.min(sections.length - 1, i));
    sections.forEach(function (s, n) { s.classList.toggle('on', n === idx); });
    prog.textContent = 'Question ' + (idx + 1) + ' of ' + sections.length;
    back.disabled = idx === 0; next.disabled = idx === sections.length - 1;
    var h = sections[idx].querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); h.scrollIntoView({ block: 'start' }); }
  }
  toggle.addEventListener('click', function () {
    var on = document.body.classList.toggle('qmode');
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggle.textContent = on ? 'Show the whole article' : 'Read one question at a time';
    if (!on) { sections.forEach(function (s) { s.classList.remove('on'); }); prog.textContent = ''; }
    else show(0);
  });
  back.addEventListener('click', function () { show(idx - 1); });
  next.addEventListener('click', function () { show(idx + 1); });
  // TOC links jump to that question while in the mode
  document.querySelectorAll('.toc a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function () {
      if (!document.body.classList.contains('qmode')) return;
      var target = document.getElementById(a.getAttribute('href').slice(1));
      sections.forEach(function (s, n) { if (s.contains(target)) show(n); });
    });
  });
})();
