/* Journal admin. Talks only to /api/blog?op=... with a Supabase access token;
   the server decides who is an admin. Nothing here is trusted for access. */
(function () {
  var body = document.body, app = document.getElementById('app');
  var SB_URL = body.dataset.supabaseUrl, SB_KEY = body.dataset.anonKey, ENV = body.dataset.env;
  var sb = (SB_URL && SB_KEY && window.supabase) ? window.supabase.createClient(SB_URL, SB_KEY, { auth: { storageKey: 'journal-admin-auth' } }) : null;
  var token = null, meta = null, state = { posts: [], filter: 'all', q: '' };

  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || document).querySelector(sel); }

  async function api(op, payload, raw) {
    var res = await fetch('/api/blog?op=' + op, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload || {}) });
    if (raw) return res;
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(data.error || 'Request failed'); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  /* ---------- sign in ---------- */
  async function start() {
    if (sb) {
      var s = await sb.auth.getSession();
      token = s.data.session && s.data.session.access_token;
      sb.auth.onAuthStateChange(function (_e, sess) { token = sess && sess.access_token; });
    } else { token = sessionStorage.getItem('journal-test-token'); }
    if (!token) return loginView();
    try { meta = await api('me'); } catch (e) { return loginView(e.status === 403 ? 'This account is not an authorized Journal admin.' : e.message); }
    listView();
  }

  function loginView(err) {
    app.innerHTML = '<div class="login a-card f"><h1 style="font-family:var(--serif);margin-top:0">Journal admin</h1>' +
      (err ? '<div class="msg err" role="alert">' + h(err) + '</div>' : '') +
      (sb ? '<form id="lf"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"><p class="hint">Leave the password blank to get a one-time sign-in link by email.</p><p><button class="a-btn primary" type="submit">Sign in</button></p></form>'
        : '<p>Local test mode (no Supabase configured).</p><button id="tl" class="a-btn primary">Sign in as test admin</button>') + '</div>';
    if (!sb) { $('#tl').onclick = function () { sessionStorage.setItem('journal-test-token', 'test-admin'); start(); }; return; }
    $('#lf').onsubmit = async function (ev) {
      ev.preventDefault();
      var em = $('#em').value.trim(), pw = $('#pw').value;
      if (pw) { var r = await sb.auth.signInWithPassword({ email: em, password: pw }); if (r.error) return loginView(r.error.message); start(); }
      else { var o = await sb.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + '/blog-admin', shouldCreateUser: false } }); loginView(o.error ? o.error.message : null); if (!o.error) $('.login').insertAdjacentHTML('afterbegin', '<div class="msg ok">Check your email for the sign-in link.</div>'); }
    };
  }

  function topbar(extra) {
    return '<div class="a-top"><h1>The Subliminally Journal &middot; Admin</h1><span class="env">' + h(ENV === 'production' ? 'PRODUCTION' : ENV === 'preview' ? 'PREVIEW / STAGING' : 'LOCAL') + '</span>' + (extra || '') +
      '<button class="a-btn" id="signout" style="color:var(--indigo)">Sign out</button></div>';
  }
  function bindSignout() {
    $('#signout').onclick = async function () { if (sb) await sb.auth.signOut(); sessionStorage.removeItem('journal-test-token'); token = null; loginView(); };
  }

  /* ---------- dashboard ---------- */
  function fmt(d) { return d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
  function catName(slug) { var c = meta.cats.find(function (x) { return x.slug === slug; }); return c ? c.name : slug; }

  async function listView(msg) {
    var data = await api('list'); state.posts = data.posts;
    var counts = { all: 0, draft: 0, scheduled: 0, published: 0, archived: 0 };
    state.posts.forEach(function (p) { counts.all++; counts[p.status]++; });
    var rows = state.posts.filter(function (p) { return (state.filter === 'all' || p.status === state.filter) && (!state.q || (p.title + ' ' + p.slug).toLowerCase().includes(state.q.toLowerCase())); });
    app.innerHTML = topbar('<button class="a-btn primary" id="new">New article</button><button class="a-btn" id="pv-all" style="color:var(--indigo)">Preview site</button><button class="a-btn" id="cats" style="color:var(--indigo)">Categories</button>') +
      '<div class="a-main">' + (msg ? '<div class="msg ok">' + h(msg) + '</div>' : '') +
      '<div class="a-card"><div class="a-row f"><div class="tabs" role="group" aria-label="Filter by status">' +
      ['all', 'draft', 'scheduled', 'published', 'archived'].map(function (s) { return '<button data-f="' + s + '" aria-pressed="' + (state.filter === s) + '">' + s[0].toUpperCase() + s.slice(1) + ' (' + counts[s] + ')</button>'; }).join('') +
      '</div><input type="text" id="fq" placeholder="Filter by title" value="' + h(state.q) + '" style="max-width:16rem" aria-label="Filter by title"></div>' +
      (rows.length ? '<table class="a-table"><thead><tr><th>Title</th><th>Status</th><th>Category</th><th>Published</th><th>Last edited</th></tr></thead><tbody>' +
        rows.map(function (p) { return '<tr><td class="t"><a href="#" data-id="' + h(p.id) + '">' + h(p.title) + '</a><br><small>/blog/' + h(p.slug) + '</small></td><td><span class="pill ' + p.status + '">' + p.status + '</span>' + (p.status === 'scheduled' ? '<br><small>' + fmt(p.scheduled_at) + '</small>' : '') + '</td><td>' + h(catName(p.category)) + '</td><td>' + fmt(p.status === 'published' ? p.published_at : null) + '</td><td>' + fmt(p.updated_at) + '</td></tr>'; }).join('') + '</tbody></table>'
        : '<p>No articles here yet.</p>') + '</div></div>';
    bindSignout();
    $('#new').onclick = function () { editView(null); };
    $('#pv-all').onclick = sitePreviewView;
    $('#cats').onclick = catsView;
    $('#fq').oninput = function (e) { state.q = e.target.value; listView(); setTimeout(function () { var f = $('#fq'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 0); };
    app.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { state.filter = b.dataset.f; listView(); }; });
    app.querySelectorAll('[data-id]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); editView(a.dataset.id); }; });
  }

  async function catsView() {
    app.innerHTML = topbar('<button class="a-btn" id="back" style="color:var(--indigo)">Back</button>') + '<div class="a-main"><div class="a-card f"><h2 style="margin-top:0">Categories</h2><p class="hint">Rename a category or change its description. Slugs (URLs) stay fixed so links never break.</p>' +
      meta.cats.map(function (c, i) { return '<div class="list-edit item" data-i="' + i + '"><strong>' + h(c.slug) + '</strong><label>Name</label><input type="text" value="' + h(c.name) + '" class="cn"><label>Description</label><textarea class="cd">' + h(c.description) + '</textarea><p><button class="a-btn primary save">Save</button> <span class="ok"></span></p></div>'; }).join('') + '</div></div>';
    bindSignout(); $('#back').onclick = function () { listView(); };
    app.querySelectorAll('.item').forEach(function (el) {
      $('.save', el).onclick = async function () {
        var c = meta.cats[+el.dataset.i];
        try { var r = await api('category', { category: { slug: c.slug, name: $('.cn', el).value, description: $('.cd', el).value } }); meta.cats[+el.dataset.i] = r.category; $('.ok', el).textContent = 'Saved'; } catch (e) { $('.ok', el).textContent = e.message; }
      };
    });
  }

  /* ---------- site preview (home / category / article, desktop & mobile) ---------- */
  async function sitePreviewView() {
    var st = { view: 'home', category: meta.cats[0].slug, device: 'mobile', drafts: true, slug: null };
    app.innerHTML = topbar('<button class="a-btn" id="back" style="color:var(--indigo)">Back</button>') +
      '<div class="a-main"><div class="a-card f"><div class="a-row"><div class="tabs" id="vt"></div><div class="tabs" id="dt"></div></div>' +
      '<div class="a-row"><label style="margin:0"><input type="checkbox" id="dr" checked> Include drafts and scheduled articles</label><select id="catsel" aria-label="Category">' + meta.cats.map(function (c) { return '<option value="' + h(c.slug) + '">' + h(c.name) + '</option>'; }).join('') + '</select></div>' +
      '<p class="hint">Click around inside the preview. Articles open as drafts. Nothing is published by previewing.</p>' +
      '<div class="frame-wrap"><iframe class="frame mobile" id="fr" title="Preview" sandbox="allow-scripts"></iframe></div></div></div>';
    bindSignout(); $('#back').onclick = function () { window.removeEventListener('message', onMsg); listView(); };
    function draw() {
      $('#vt').innerHTML = [['home', 'Homepage'], ['category', 'Category'], ['article', 'Article']].map(function (v) { return '<button data-v="' + v[0] + '" aria-pressed="' + (st.view === v[0]) + '">' + v[1] + '</button>'; }).join('');
      $('#dt').innerHTML = [['mobile', 'iPhone'], ['tablet', 'iPad'], ['desktop', 'Desktop']].map(function (v) { return '<button data-d="' + v[0] + '" aria-pressed="' + (st.device === v[0]) + '">' + v[1] + '</button>'; }).join('');
      $('#fr').className = 'frame ' + st.device;
      $('#vt').querySelectorAll('button').forEach(function (b) { b.onclick = function () { st.view = b.dataset.v; if (st.view === 'article' && !st.slug) st.slug = (state.posts[0] || {}).slug; draw(); load(); }; });
      $('#dt').querySelectorAll('button').forEach(function (b) { b.onclick = function () { st.device = b.dataset.d; draw(); }; });
    }
    async function load() {
      var payload = { view: st.view, category: st.category, includeDrafts: st.drafts, slug: st.slug, q: st.q };
      var res = await api('preview', payload, true); $('#fr').srcdoc = await res.text();
    }
    function onMsg(ev) {
      var href = ev.data && ev.data.blogPreviewNav; if (!href) return;
      var m;
      if ((m = /^\/blog\/category\/([a-z0-9-]+)/.exec(href))) { st.view = 'category'; st.category = m[1]; $('#catsel').value = m[1]; }
      else if (/^\/blog\?q=/.test(href)) { st.view = 'home'; st.q = decodeURIComponent(href.split('q=')[1]); }
      else if ((m = /^\/blog\/([a-z0-9-]+)/.exec(href))) { st.view = 'article'; st.slug = m[1]; }
      else { st.view = 'home'; st.q = ''; }
      draw(); load();
    }
    window.addEventListener('message', onMsg);
    $('#dr').onchange = function (e) { st.drafts = e.target.checked; load(); };
    $('#catsel').onchange = function (e) { st.category = e.target.value; if (st.view === 'category') load(); };
    draw(); load();
  }

  /* ---------- editor ---------- */
  var EMPTY = { title: '', slug: '', subtitle: '', summary: '', body_md: '', category: 'subliminals-101', tags: [], featured: false, featured_image_url: '', featured_image_alt: '', pin_image_url: '', og_image_url: '', author_name: 'The Subliminally Team', author_bio: '', seo_title: '', seo_description: '', og_title: '', og_description: '', sources: [], faq: [], cta_key: 'none', editorial_notes: '' };

  async function editView(id) {
    var rec = id ? (await api('get', { id: id })).post : null;
    var P = Object.assign({}, EMPTY, rec || {}); P.tags = (P.tags || []).slice(); P.sources = JSON.parse(JSON.stringify(P.sources || [])); P.faq = JSON.parse(JSON.stringify(P.faq || []));
    var st = { id: rec && rec.id, status: rec ? rec.status : 'draft', dirty: false, slugTouched: !!rec, timer: null, pdev: 'mobile', saving: false };
    var autosaves = !rec || !rec.live;
    var draftKey = 'journal-draft-' + (st.id || 'new');

    function catOpts() { return meta.cats.map(function (c) { return '<option value="' + h(c.slug) + '"' + (c.slug === P.category ? ' selected' : '') + '>' + h(c.name) + '</option>'; }).join(''); }
    function ctaOpts() { var lab = { none: 'No call to action', builder: 'Create Your Own Subliminal (builder)', affirmations: 'Affirmation writing (builder)', sleep: 'Saved subliminals (library)', habits: 'Habit tracker', collections: 'Library collections' }; return meta.ctas.concat(['none']).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a) { return a === 'none' ? -1 : 0; }).map(function (k) { return '<option value="' + k + '"' + (k === P.cta_key ? ' selected' : '') + '>' + h(lab[k] || k) + '</option>'; }).join(''); }
    function inp(name, label, opts) { opts = opts || {}; return '<label for="f-' + name + '">' + label + '</label>' + (opts.area ? '<textarea id="f-' + name + '" data-k="' + name + '">' + h(P[name]) + '</textarea>' : '<input id="f-' + name + '" type="' + (opts.type || 'text') + '" data-k="' + name + '" value="' + h(P[name] == null ? '' : P[name]) + '">') + (opts.hint ? '<div class="hint">' + opts.hint + '</div>' : ''); }

    app.innerHTML = topbar('<span class="saved" id="savedstate" aria-live="polite"></span><button class="a-btn" id="back" style="color:var(--indigo)">Back</button>') +
      '<div class="a-main"><div class="ed"><div><div class="a-card f">' +
      '<div class="a-row"><span class="pill ' + st.status + '" id="stpill">' + st.status + '</span><span class="hint" id="meta"></span></div>' +
      inp('title', 'Title (H1)') + inp('subtitle', 'Subtitle (optional)') + inp('summary', 'Short introductory summary', { area: true, hint: 'Shown under the headline and on cards. Aim for 1–2 sentences.' }) +
      '<label for="f-slug">URL slug</label><input id="f-slug" type="text" data-k="slug" value="' + h(P.slug) + '"><div class="hint" id="urlhint"></div>' +
      '<label for="f-category">Category</label><select id="f-category" data-k="category">' + catOpts() + '</select>' +
      inp('tags', 'Tags (comma separated)') +
      '<label><input type="checkbox" data-k="featured" ' + (P.featured ? 'checked' : '') + '> Feature on the Journal homepage</label>' +
      '<label for="f-body_md">Article body (Markdown)</label>' +
      '<div class="mini" role="toolbar" aria-label="Formatting"><button data-ins="## |Question heading|">H2</button><button data-ins="### |Sub-heading|">H3</button><button data-ins="**|bold|**">Bold</button><button data-ins="*|italic|*">Italic</button><button data-ins="[|link text|](https://)">Link</button><button data-ins="- |List item|">List</button><button data-ins="> |A quote worth keeping|">Quote</button><button data-ins=":::example\n|Write the example here.|\n:::">Example box</button><button data-ins=":::evidence\n|What the research says.|\n:::">Evidence box</button><button data-ins=":::experience\n|Personal experience.|\n:::">Experience box</button><button data-ins=":::belief\n|Belief or spiritual practice.|\n:::">Belief box</button><button data-ins=":::try\n|A small thing to try.|\n:::">Try-it box</button><button data-ins="[[VERIFY: |what must be checked|]]">Flag to verify</button><button id="insimg">Insert image</button></div>' +
      '<textarea id="f-body_md" class="body" data-k="body_md" spellcheck="true">' + h(P.body_md) + '</textarea>' +
      '<div class="hint">Use <code>##</code> for question-style sections and <code>###</code> inside them. Reading time and the table of contents are automatic.</div>' +
      '</div>' +
      '<div class="a-card f"><h2 style="margin-top:0">Images</h2>' + inp('featured_image_url', 'Featured image URL') +
      '<div class="a-row"><input type="file" id="up" accept="image/png,image/jpeg,image/webp" aria-label="Upload featured image"><span class="hint">PNG/JPG/WebP, under 3 MB. 1200×630 works best.</span></div>' +
      inp('featured_image_alt', 'Featured image alt text', { hint: 'Describe the image for someone who cannot see it. Required to publish when an image is set.' }) +
      inp('pin_image_url', 'Pinterest / share image URL (optional)', { hint: 'Tall 2:3 artwork (1000×1500) pins best.' }) + inp('og_image_url', 'Social preview image URL (optional)', { hint: 'Defaults to the featured image.' }) + '</div>' +
      '<div class="a-card f"><h2 style="margin-top:0">SEO &amp; social</h2>' + inp('seo_title', 'SEO title', { hint: '<span class="count" id="c-seo_title"></span> Aim for under 60 characters.' }) + inp('seo_description', 'Meta description', { area: true, hint: '<span class="count" id="c-seo_description"></span> Aim for 120–155 characters.' }) + inp('og_title', 'Social title (optional)') + inp('og_description', 'Social description (optional)', { area: true }) + '</div>' +
      '<div class="a-card f"><h2 style="margin-top:0">Author, sources, FAQ, call to action</h2>' + inp('author_name', 'Author name') + inp('author_bio', 'Author bio', { area: true }) +
      '<label for="f-cta_key">Call to action</label><select id="f-cta_key" data-k="cta_key">' + ctaOpts() + '</select>' +
      '<h3>Sources</h3><div id="sources" class="list-edit"></div><button class="a-btn" id="addsrc">Add source</button>' +
      '<h3>FAQ (optional)</h3><div id="faq" class="list-edit"></div><button class="a-btn" id="addfaq">Add question</button>' +
      inp('editorial_notes', 'Private editorial notes', { area: true, hint: 'Never shown to readers.' }) + '</div></div>' +
      '<div class="pv"><div class="a-card f"><div id="msgs"></div><div class="a-row"><button class="a-btn primary" id="save">Save</button><button class="a-btn" id="pvbtn">Refresh preview</button></div>' +
      '<div class="a-row" id="statusbtns" style="margin-top:.6rem"></div><div class="tabs" id="pd" style="margin-top:.75rem"></div>' +
      '<div class="frame-wrap"><iframe class="frame mobile" id="fr" title="Article preview" sandbox="allow-scripts"></iframe></div></div></div></div></div>';
    bindSignout();

    function setMsg(t, kind) { $('#msgs').innerHTML = t ? '<div class="msg ' + (kind || 'ok') + '" role="' + (kind === 'err' ? 'alert' : 'status') + '">' + t + '</div>' : ''; }
    function count(k, lo, hi) { var el = $('#c-' + k); if (!el) return; var n = (P[k] || '').length; el.textContent = n + ' characters. '; el.className = 'count' + (n > hi ? ' bad' : ''); }
    function metaLine() { $('#meta').textContent = rec || st.id ? 'Last edited ' + fmt(P.updated_at) + (P.published_at && st.status === 'published' ? ' · Published ' + fmt(P.published_at) : '') + (st.status === 'scheduled' ? ' · Goes live ' + fmt(P.scheduled_at) : '') : 'Not saved yet'; $('#urlhint').textContent = 'Public URL once live: ' + meta.siteUrl + '/blog/' + (P.slug || '…'); }
    function renderLists() {
      $('#sources').innerHTML = P.sources.map(function (s, i) { return '<div class="item"><label>Title / citation</label><input type="text" data-s="' + i + '" data-f="title" value="' + h(s.title) + '"><label>Link (optional)</label><input type="url" data-s="' + i + '" data-f="url" value="' + h(s.url) + '"><label>Note (optional)</label><input type="text" data-s="' + i + '" data-f="note" value="' + h(s.note) + '"><p><button class="a-btn danger" data-rs="' + i + '">Remove</button></p></div>'; }).join('');
      $('#faq').innerHTML = P.faq.map(function (s, i) { return '<div class="item"><label>Question</label><input type="text" data-q="' + i + '" data-f="q" value="' + h(s.q) + '"><label>Answer</label><textarea data-q="' + i + '" data-f="a">' + h(s.a) + '</textarea><p><button class="a-btn danger" data-rq="' + i + '">Remove</button></p></div>'; }).join('');
      app.querySelectorAll('[data-s]').forEach(function (el) { el.oninput = function () { P.sources[+el.dataset.s][el.dataset.f] = el.value; touch(); }; });
      app.querySelectorAll('[data-q]').forEach(function (el) { el.oninput = function () { P.faq[+el.dataset.q][el.dataset.f] = el.value; touch(); }; });
      app.querySelectorAll('[data-rs]').forEach(function (b) { b.onclick = function () { P.sources.splice(+b.dataset.rs, 1); renderLists(); touch(); }; });
      app.querySelectorAll('[data-rq]').forEach(function (b) { b.onclick = function () { P.faq.splice(+b.dataset.rq, 1); renderLists(); touch(); }; });
    }
    function statusButtons() {
      var s = st.status, out = [];
      if (!st.id) { $('#statusbtns').innerHTML = '<span class="hint">Save once to unlock publishing controls. New articles are always drafts.</span>'; return; }
      if (s !== 'published') out.push('<button class="a-btn primary" data-act="publish">Publish now</button>');
      if (s === 'draft' || s === 'scheduled') out.push('<input type="datetime-local" id="when" aria-label="Schedule for" style="min-height:44px"><button class="a-btn" data-act="schedule">Schedule</button>');
      if (s === 'published' || s === 'scheduled') out.push('<button class="a-btn" data-act="unpublish">Unpublish</button>');
      if (s !== 'archived') out.push('<button class="a-btn" data-act="archive">Archive</button>');
      if (s === 'draft' || s === 'archived') out.push('<button class="a-btn danger" data-act="delete">Delete</button>');
      $('#statusbtns').innerHTML = out.join('');
      app.querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { act(b.dataset.act); }; });
    }
    function draftPayload() { var c = Object.assign({}, P); return c; }
    async function save(auto) {
      if (st.saving) return; st.saving = true;
      try {
        var r = await api(st.id ? 'save' : 'create', { id: st.id, post: draftPayload(), autosave: !!auto });
        st.id = r.post.id; st.status = r.post.status; P.updated_at = r.post.updated_at; P.published_at = r.post.published_at; P.scheduled_at = r.post.scheduled_at;
        st.dirty = false; try { localStorage.removeItem(draftKey); } catch (e) {}
        if (!$('#savedstate')) return true;
        $('#savedstate').textContent = (auto ? 'Autosaved ' : 'Saved ') + new Date().toLocaleTimeString([], { timeStyle: 'short' });
        if (!auto) setMsg('Saved. This did not publish anything.', 'ok');
        statusButtons(); metaLine(); return true;
      } catch (e) { var ss = $('#savedstate'); if (!ss) return false; if (!auto) setMsg(h(e.message), 'err'); ss.textContent = 'Not saved: ' + e.message; return false; }
      finally { st.saving = false; }
    }
    function touch() {
      st.dirty = true; $('#savedstate').textContent = 'Unsaved changes';
      try { localStorage.setItem(draftKey, JSON.stringify(P)); } catch (e) {}
      clearTimeout(st.timer);
      if (autosaves && P.title.trim()) st.timer = setTimeout(function () { save(true); }, 3000);
      else if (!autosaves) $('#savedstate').textContent = 'Unsaved — live articles are saved manually';
    }
    async function act(a) {
      if (st.dirty && !(await save(false))) return;
      var payload = { id: st.id, action: a };
      if (a === 'delete') { if (!confirm('Delete this article permanently?')) return; try { await api('delete', { id: st.id }); listView('Article deleted.'); } catch (e) { setMsg(h(e.message), 'err'); } return; }
      if (a === 'publish' && !confirm('Publish this article? It becomes visible to readers on this site.')) return;
      if (a === 'unpublish' && !confirm('Unpublish this article? It goes back to draft and disappears for readers.')) return;
      if (a === 'schedule') { var w = $('#when').value; if (!w) return setMsg('Pick a date and time first.', 'err'); payload.scheduled_at = new Date(w).toISOString(); }
      try {
        var r = await api('status', payload); st.status = r.post.status; P.published_at = r.post.published_at; P.scheduled_at = r.post.scheduled_at; P.updated_at = r.post.updated_at;
        $('#stpill').className = 'pill ' + st.status; $('#stpill').textContent = st.status; autosaves = st.status !== 'published' && !(st.status === 'scheduled' && new Date(P.scheduled_at) <= new Date());
        setMsg('Status is now ' + h(st.status) + '.', 'ok'); statusButtons(); metaLine(); preview();
      } catch (e) { setMsg(h(e.message) + (e.data && e.data.problems ? '<ul>' + e.data.problems.map(function (p) { return '<li>' + h(p) + '</li>'; }).join('') + '</ul>' : ''), 'err'); }
    }
    async function preview(slug) {
      var res = await api('preview', slug ? { view: 'article', slug: slug } : { view: 'article', id: st.id, draft: draftPayload() }, true);
      $('#fr').srcdoc = await res.text();
    }
    function drawDev() {
      $('#pd').innerHTML = [['mobile', 'iPhone'], ['tablet', 'iPad'], ['desktop', 'Desktop']].map(function (v) { return '<button data-d="' + v[0] + '" aria-pressed="' + (st.pdev === v[0]) + '">' + v[1] + '</button>'; }).join('');
      $('#fr').className = 'frame ' + st.pdev;
      $('#pd').querySelectorAll('button').forEach(function (b) { b.onclick = function () { st.pdev = b.dataset.d; drawDev(); }; });
    }

    app.querySelectorAll('[data-k]').forEach(function (el) {
      var k = el.dataset.k;
      el.oninput = el.onchange = function () {
        if (el.type === 'checkbox') P[k] = el.checked;
        else if (k === 'tags') P.tags = el.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
        else P[k] = el.value;
        if (k === 'title' && !st.slugTouched) { P.slug = el.value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90); $('#f-slug').value = P.slug; }
        if (k === 'slug') st.slugTouched = true;
        if (k === 'seo_title' || k === 'seo_description') count(k);
        metaLine(); touch();
      };
    });
    $('#f-tags').value = (P.tags || []).join(', ');
    $('#f-body_md').addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(false); } });
    app.querySelectorAll('[data-ins]').forEach(function (b) {
      b.onclick = function () {
        var ta = $('#f-body_md'), parts = b.dataset.ins.replace(/\\n/g, '\n').split('|');
        var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || parts[1];
        ta.setRangeText(parts[0] + sel + parts[2], ta.selectionStart, ta.selectionEnd, 'end');
        P.body_md = ta.value; touch(); ta.focus();
      };
    });
    async function uploadFile(file) {
      if (!file) return null;
      var buf = await file.arrayBuffer(), bin = '', bytes = new Uint8Array(buf);
      for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      var r = await api('upload', { name: file.name, data: btoa(bin) }); return r.url;
    }
    $('#up').onchange = async function (e) { try { var u = await uploadFile(e.target.files[0]); if (u) { P.featured_image_url = u; $('#f-featured_image_url').value = u; touch(); setMsg('Image uploaded. Add alt text below.', 'ok'); } } catch (er) { setMsg(h(er.message), 'err'); } };
    $('#insimg').onclick = function () {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp';
      inp.onchange = async function () { try { var u = await uploadFile(inp.files[0]); var alt = prompt('Describe this image for readers who cannot see it (alt text):', ''); var ta = $('#f-body_md'); ta.setRangeText('\n![' + (alt || '') + '](' + u + ')\n', ta.selectionStart, ta.selectionEnd, 'end'); P.body_md = ta.value; touch(); } catch (er) { setMsg(h(er.message), 'err'); } };
      inp.click();
    };
    $('#addsrc').onclick = function () { P.sources.push({ title: '', url: '', note: '' }); renderLists(); touch(); };
    $('#addfaq').onclick = function () { P.faq.push({ q: '', a: '' }); renderLists(); touch(); };
    $('#save').onclick = async function () { if (await save(false)) preview(); };
    $('#pvbtn').onclick = function () { preview(); };
    $('#back').onclick = async function () { clearTimeout(st.timer); if (st.dirty && autosaves && P.title.trim()) await save(true); else if (st.dirty && !confirm('Leave without saving changes?')) return; window.removeEventListener('message', onMsg); listView(); };
    function onMsg(ev) { var href = ev.data && ev.data.blogPreviewNav; var m = href && /^\/blog\/([a-z0-9-]+)$/.exec(href); if (m) preview(m[1]); else if (href) preview(); }
    window.addEventListener('message', onMsg);
    try { var local = localStorage.getItem(draftKey); if (local && rec && rec.live && local !== JSON.stringify(rec)) setMsg('You have unsaved local edits from earlier. <button class="a-btn" id="restore">Restore them</button>', 'ok'); var rb = $('#restore'); if (rb) rb.onclick = function () { P = Object.assign(P, JSON.parse(local)); editViewReload(); }; } catch (e) {}
    function editViewReload() { editView(st.id); }
    renderLists(); statusButtons(); drawDev(); metaLine(); count('seo_title'); count('seo_description');
    if (P.title) preview();
  }

  start();
})();
