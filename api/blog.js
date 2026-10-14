// /api/blog — the whole Journal in ONE serverless function.
//
// One function on purpose: the project already has twelve under api/, which is
// the Vercel Hobby ceiling, and a thirteenth would fail the deploy.
//
// Public reads (GET, routed by vercel.json rewrites):
//   /blog                      -> ?view=home
//   /blog/category/:slug       -> ?view=category&slug=:slug
//   /blog/:slug                -> ?view=post&slug=:slug
//   /blog-sitemap.xml          -> ?view=sitemap
//   /blog-admin                -> ?view=admin   (HTML shell only; no data)
// Admin operations (POST, ?op=...): every one verifies the caller's Supabase
// token server-side AND looks the user up in blog_admins before doing anything.
//
// If BLOG_ENABLED is not "true" every one of these answers a bare 404, so this
// file can sit on production, unused, until launch.

import { whoIsCalling, bearerToken } from '../lib/supabase-auth.js';
import { blogEnabled, indexable, CTAS, SITE_URL } from '../lib/blog/config.js';
import { store, usingFileStore } from '../lib/blog/store.js';
import { normalisePost, publishProblems, isLive } from '../lib/blog/posts.js';
import { articlePage, homePage, categoryPage, notFoundPage, errorPage, sitemapXml, adminPageHtml, robotsContent } from '../lib/blog/render.js';

export const config = { maxDuration: 15 };

const HTML = 'text/html; charset=utf-8';

function send(res, status, type, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('X-Robots-Tag', robotsContent());
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', indexable() ? 'public, s-maxage=60, stale-while-revalidate=300' : 'private, no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(body);
}
const json = (res, status, obj) => send(res, status, 'application/json', JSON.stringify(obj), { 'Cache-Control': 'private, no-store' });

function bareNotFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('Not found');
}

async function adminFromRequest(req) {
  const token = bearerToken(req);
  if (!token) return null;
  let user;
  if (usingFileStore()) user = token === 'test-admin' ? { id: 'test-admin' } : null;
  else user = await whoIsCalling(token);
  if (!user) return null;
  return (await store.isAdmin(user.id)) ? user : null;
}

function related(post, posts) {
  const others = posts.filter((p) => p.id !== post.id);
  const score = (p) => (p.category === post.category ? 2 : 0) + (p.tags || []).filter((t) => (post.tags || []).includes(t)).length;
  return others.sort((a, b) => score(b) - score(a)).slice(0, 3);
}

/* ------------------------------ public ------------------------------ */
async function handlePublic(req, res, q) {
  const view = q.view || 'home';
  if (view === 'admin') {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    return send(res, 200, HTML, adminPageHtml({ supabaseUrl, anonKey }));
  }
  const cats = await store.categories();
  if (view === 'sitemap') {
    // Published posts only, and only once the blog is deliberately indexable.
    if (!indexable()) return bareNotFound(res);
    return send(res, 200, 'application/xml; charset=utf-8', sitemapXml(await store.livePosts(), cats));
  }
  if (view === 'category') {
    const cat = cats.find((c) => c.slug === q.slug);
    if (!cat) return send(res, 404, HTML, notFoundPage({ cats }));
    const posts = (await store.livePosts()).filter((p) => p.category === cat.slug);
    return send(res, 200, HTML, categoryPage({ cat, posts, cats }));
  }
  if (view === 'post') {
    const post = await store.liveBySlug(String(q.slug || ''));
    if (!post) return send(res, 404, HTML, notFoundPage({ cats }));
    return send(res, 200, HTML, articlePage({ post, cats, related: related(post, await store.livePosts()) }));
  }
  const posts = await store.livePosts();
  return send(res, 200, HTML, homePage({ posts, cats, q: String(q.q || '').slice(0, 80) }));
}

/* ------------------------------- admin ------------------------------- */
const PREVIEW_BANNER = (what) => `<div class="staging" style="background:#4F3200" role="note"><strong>Admin preview &mdash; ${what}.</strong> Visible only to you. Nothing here is published.</div>`;
const PREVIEW_SCRIPT = `<script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(h&&h.charAt(0)==='/'&&h.indexOf('/blog')===0){e.preventDefault();parent.postMessage({blogPreviewNav:h},'*');}else if(h&&h.charAt(0)==='#'){}else if(h&&h.charAt(0)==='/'){e.preventDefault();}},true);document.addEventListener('submit',function(e){e.preventDefault();var q=e.target.querySelector('input[name=q]');if(q)parent.postMessage({blogPreviewNav:'/blog?q='+encodeURIComponent(q.value)},'*');},true);</script>`;

function decoratePreview(html, what) {
  return html.replace('<main id="main">', PREVIEW_BANNER(what) + '<main id="main">').replace('</body>', PREVIEW_SCRIPT + '</body>');
}

const sniff = (b) => {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ['image/png', 'png'];
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  return null;
};

async function handleAdmin(req, res, q) {
  const admin = await adminFromRequest(req);
  // Same answer for "not signed in" and "signed in but not an admin".
  if (!admin) return json(res, 403, { error: 'Not authorized.' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const cats = await store.categories();
  const op = q.op;

  if (op === 'me') return json(res, 200, { ok: true, cats, ctas: Object.keys(CTAS), siteUrl: SITE_URL, store: usingFileStore() ? 'file' : 'supabase', env: process.env.VERCEL_ENV || 'local' });

  if (op === 'list') {
    const posts = (await store.allPosts()).map(({ body_md, ...rest }) => ({ ...rest, live: isLive(rest) }));
    return json(res, 200, { posts });
  }
  if (op === 'get') {
    const post = await store.postById(String(body.id || ''));
    return post ? json(res, 200, { post: { ...post, live: isLive(post) } }) : json(res, 404, { error: 'Not found.' });
  }
  if (op === 'create' || op === 'save') {
    const { post, errors } = normalisePost(body.post || {}, { categories: cats });
    const existing = op === 'save' ? await store.postById(String(body.id || '')) : null;
    if (op === 'save' && !existing) return json(res, 404, { error: 'Article not found.' });
    if (errors.length) return json(res, 422, { error: errors.join(' '), errors });
    const clash = await store.postBySlug(post.slug);
    if (clash && (!existing || clash.id !== existing.id)) return json(res, 409, { error: `The slug "${post.slug}" is already used by another article.` });
    // Autosave must never silently rewrite what readers are looking at.
    if (existing && body.autosave && isLive(existing)) return json(res, 409, { error: 'Live articles are saved manually.' });
    const row = { ...post, updated_by: admin.id === 'test-admin' ? null : admin.id };
    const saved = existing ? await store.updatePost(existing.id, row) : await store.insertPost(row);
    return json(res, 200, { post: saved });
  }
  if (op === 'status') {
    const post = await store.postById(String(body.id || ''));
    if (!post) return json(res, 404, { error: 'Article not found.' });
    const action = body.action;
    if (action === 'publish' || action === 'schedule') {
      const problems = publishProblems(post);
      if (problems.length) return json(res, 422, { error: 'Not ready to publish.', problems });
      if (action === 'schedule') {
        const when = new Date(body.scheduled_at);
        if (isNaN(when) || when <= new Date()) return json(res, 422, { error: 'Pick a future date and time.' });
        return json(res, 200, { post: await store.updatePost(post.id, { status: 'scheduled', scheduled_at: when.toISOString(), published_at: post.published_at || when.toISOString() }) });
      }
      return json(res, 200, { post: await store.updatePost(post.id, { status: 'published', published_at: post.published_at || new Date().toISOString(), scheduled_at: null }) });
    }
    if (action === 'unpublish') return json(res, 200, { post: await store.updatePost(post.id, { status: 'draft', scheduled_at: null }) });
    if (action === 'archive') return json(res, 200, { post: await store.updatePost(post.id, { status: 'archived', scheduled_at: null }) });
    return json(res, 400, { error: 'Unknown action.' });
  }
  if (op === 'delete') {
    const post = await store.postById(String(body.id || ''));
    if (!post) return json(res, 404, { error: 'Not found.' });
    if (post.status !== 'draft' && post.status !== 'archived') return json(res, 409, { error: 'Only drafts and archived articles can be deleted. Archive or unpublish first.' });
    await store.deletePost(post.id);
    return json(res, 200, { ok: true });
  }
  if (op === 'category') {
    const c = body.category || {};
    const name = String(c.name || '').trim().slice(0, 60);
    if (!name) return json(res, 422, { error: 'Name is required.' });
    const saved = await store.saveCategory({ slug: String(c.slug || ''), name, description: String(c.description || '').trim().slice(0, 300) });
    return saved ? json(res, 200, { category: saved }) : json(res, 404, { error: 'Category not found.' });
  }
  if (op === 'upload') {
    const buf = Buffer.from(String(body.data || ''), 'base64');
    if (!buf.length || buf.length > 3 * 1024 * 1024) return json(res, 413, { error: 'Images must be under 3 MB.' });
    const kind = sniff(buf);
    if (!kind) return json(res, 415, { error: 'Use a PNG, JPG or WebP image.' });
    const base = String(body.name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'image';
    const url = await store.uploadImage(`${Date.now()}-${base}.${kind[1]}`, kind[0], buf);
    return json(res, 200, { url });
  }
  if (op === 'preview') {
    const view = body.view || 'article';
    const everything = (await store.allPosts()).filter((p) => p.status !== 'archived');
    const live = everything.filter((p) => isLive(p));
    const pool = body.includeDrafts ? everything.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)) : live;
    if (view === 'home') return send(res, 200, HTML, decoratePreview(homePage({ posts: pool, cats, q: String(body.q || '') }), 'homepage'), { 'Cache-Control': 'private, no-store' });
    if (view === 'category') {
      const cat = cats.find((c) => c.slug === body.category) || cats[0];
      return send(res, 200, HTML, decoratePreview(categoryPage({ cat, posts: pool.filter((p) => p.category === cat.slug), cats }), 'category'), { 'Cache-Control': 'private, no-store' });
    }
    // Article: from the saved row, or from unsaved editor content when supplied.
    let post;
    if (body.draft) {
      const { post: n } = normalisePost(body.draft, { categories: cats });
      const base = body.id ? await store.postById(String(body.id)) : null;
      post = { id: body.id || 'unsaved', status: base ? base.status : 'draft', published_at: base && base.published_at, scheduled_at: base && base.scheduled_at, updated_at: new Date().toISOString(), ...n };
    } else {
      post = await store.postById(String(body.id || '')) || (body.slug && await store.postBySlug(String(body.slug)));
    }
    if (!post) return send(res, 404, HTML, decoratePreview(notFoundPage({ cats }), 'not found'), { 'Cache-Control': 'private, no-store' });
    return send(res, 200, HTML, decoratePreview(articlePage({ post, cats, related: related(post, pool), preview: true }), post.status === 'published' ? 'live article' : `${post.status} article`), { 'Cache-Control': 'private, no-store' });
  }
  return json(res, 400, { error: 'Unknown operation.' });
}

export default async function handler(req, res) {
  try {
    if (!blogEnabled()) return bareNotFound(res);
    const q = req.query || {};
    if (q.op) {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only.' });
      return await handleAdmin(req, res, q);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return bareNotFound(res);
    return await handlePublic(req, res, q);
  } catch (err) {
    console.error('blog error', err && err.message);
    if (req.query && req.query.op) return json(res, 500, { error: 'Something went wrong.' });
    return send(res, 500, HTML, errorPage());
  }
}
