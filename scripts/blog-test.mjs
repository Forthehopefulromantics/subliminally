// End-to-end checks for the Journal, against a throwaway file store.
//   node scripts/blog-test.mjs
// Starts api/blog.js behind scripts/blog-dev-server.mjs on a free port.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../lib/blog/markdown.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blogtest-'));
const storeFile = path.join(tmp, 'blog.json');
const PORT = 3200 + Math.floor(Math.random() * 500);
const base = `http://localhost:${PORT}`;
let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };

function startServer(env) {
  return spawn('node', ['scripts/blog-dev-server.mjs', String(PORT)], { cwd: root, env: { ...process.env, BLOG_STORE: 'file', BLOG_STORE_FILE: storeFile, ...env }, stdio: 'ignore' });
}
async function waitUp() { for (let i = 0; i < 50; i++) { try { await fetch(base + '/favicon.svg'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error('server did not start'); }
const admin = async (op, body, token = 'test-admin') => fetch(`${base}/api/blog?op=${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
const get = (p) => fetch(base + p);

// ---- markdown safety (no server needed)
{
  const { html } = renderMarkdown('## Hi <script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](https://example.com) ![a](javascript:evil) <img src=x onerror=alert(1)>');
  assert(!/<script/i.test(html) && !/javascript:/i.test(html) && !/<img src=x/i.test(html));
  ok('markdown escapes raw HTML and blocks javascript: URLs');
}

// ---- kill switch: blog off => every route 404, including admin API
let srv = startServer({ BLOG_ENABLED: 'false' });
await waitUp();
for (const p of ['/blog', '/blog/anything', '/blog/category/affirmations', '/blog-sitemap.xml', '/blog-admin']) assert.equal((await get(p)).status, 404, p);
assert.equal((await admin('list')).status, 404);
ok('BLOG_ENABLED off: all public, admin-page, sitemap and admin-API routes return 404');
srv.kill();

// ---- blog on
srv = startServer({ BLOG_ENABLED: 'true' });
await waitUp();
try {
  // seed drafts using the real seeding script
  await new Promise((res, rej) => spawn('node', ['scripts/seed-blog.mjs', '--apply'], { cwd: root, env: { ...process.env, BLOG_STORE: 'file', BLOG_STORE_FILE: storeFile }, stdio: 'ignore' }).on('exit', (c) => (c === 0 ? res() : rej(new Error('seed failed')))));
  const seeded = JSON.parse(fs.readFileSync(storeFile, 'utf8')).posts;
  assert.equal(seeded.length, 10); assert(seeded.every((p) => p.status === 'draft'));
  ok('10 starter articles seeded, all draft');

  const slug = seeded[0].slug;
  // draft privacy
  assert.equal((await get('/blog/' + slug)).status, 404);
  const home = await (await get('/blog')).text();
  assert(!home.includes(seeded[0].title) && /first articles are on their way/.test(home));
  assert.equal((await get('/blog-sitemap.xml')).status, 404);
  assert(!(await (await get('/blog/category/subliminals-101')).text()).includes(seeded[0].title));
  assert.equal((await get('/blog?q=subliminals')).status, 200);
  assert(!(await (await get('/blog?q=subliminals')).text()).includes('/blog/' + slug));
  ok('drafts invisible on article URL, home, category, search and sitemap; helpful empty state shown');

  // admin API protection
  for (const t of [null, 'junk', 'not-admin']) assert.equal((await admin('list', {}, t)).status, 403);
  assert.equal((await fetch(`${base}/api/blog?op=list`)).status, 405);
  assert.equal((await admin('list')).status, 200);
  ok('admin API: no token / bad token / non-admin => 403; GET => 405; admin => 200');

  // noindex everywhere on staging
  const r = await get('/blog');
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.match(await r.text(), /<meta name="robots" content="noindex, nofollow/);
  ok('noindex, nofollow in header and meta when not production');

  // editor: create / save / slug clash
  const created = await (await admin('create', { post: { title: 'Test post', body_md: '## A question?\n\nBody.', category: 'affirmations' } })).json();
  assert.equal(created.post.status, 'draft'); assert.equal(created.post.slug, 'test-post');
  assert.equal((await admin('create', { post: { title: 'Test post', category: 'affirmations' } })).status, 409);
  assert.equal((await admin('create', { post: { title: 'x', slug: 'category', category: 'affirmations' } })).status, 422);
  assert.equal((await admin('create', { post: { title: 'x', category: 'nope' } })).status, 422);
  ok('create is always draft; duplicate and reserved slugs and bad category rejected');

  // client cannot smuggle status
  const sneaky = await (await admin('save', { id: created.post.id, post: { title: 'Test post', category: 'affirmations', status: 'published', published_at: '2020-01-01' } })).json();
  assert.equal(sneaky.post.status, 'draft'); assert.equal(sneaky.post.published_at, null);
  assert.equal((await get('/blog/test-post')).status, 404);
  ok('save cannot change status or published_at');

  // publish gate
  let pub = await admin('status', { id: created.post.id, action: 'publish' });
  assert.equal(pub.status, 422);
  const withMarker = await (await admin('save', { id: created.post.id, post: { title: 'Test post', category: 'affirmations', summary: 'A summary.', seo_description: 'A description.', body_md: '## One?\n\n' + 'Word '.repeat(120) + '[[VERIFY: check this]]', featured_image_url: '/img/blog/x.jpg' } })).json();
  pub = await admin('status', { id: created.post.id, action: 'publish' });
  const problems = (await pub.json()).problems.join(' ');
  assert(/VERIFY/.test(problems) && /alt text/.test(problems));
  ok('publish blocked by missing summary/description/alt text/short body and unresolved [[VERIFY]] markers');

  // preview shows marker, public does not
  const pv = await (await admin('preview', { view: 'article', id: created.post.id })).text();
  assert(/Needs verification/.test(pv) && /Admin preview/.test(pv) && /noindex/.test(pv));
  assert.equal((await admin('preview', { view: 'article', id: created.post.id }, null)).status, 403);
  ok('admin preview renders drafts (with verify flag); preview without token => 403');

  // fix and publish
  await admin('save', { id: created.post.id, post: { title: 'Test post', category: 'affirmations', summary: 'A summary.', seo_description: 'A description.', body_md: '## One?\n\n' + 'Word '.repeat(120), featured_image_url: '/img/blog/x.jpg', featured_image_alt: 'Alt text', faq: [{ q: 'Q?', a: 'A.' }], sources: [{ title: 'Src', url: 'https://example.com' }], cta_key: 'builder' } });
  pub = await (await admin('status', { id: created.post.id, action: 'publish' })).json();
  assert.equal(pub.post.status, 'published');
  const page = await (await get('/blog/test-post')).text();
  assert(page.includes('<h1>Test post</h1>') && page.includes('alt="Alt text"') && page.includes('rel="canonical" href="https://www.subliminallybyfthr.com/blog/test-post"'));
  assert(page.includes('"@type":"BlogPosting"') && page.includes('"@type":"BreadcrumbList"') && page.includes('"@type":"FAQPage"'));
  assert(page.includes('href="/#build"') && page.includes('property="og:image"') && page.includes('pinterest.com/pin/create'));
  assert(!page.includes('Needs verification') && !page.includes('Admin preview'));
  assert.equal((await get('/blog-sitemap.xml')).status, 404);
  ok('publish works; article has canonical, BlogPosting/Breadcrumb/FAQ JSON-LD, OG tags, Pinterest share, real CTA route; sitemap still closed while not indexable');

  // live article: autosave refused, manual save allowed
  assert.equal((await admin('save', { id: created.post.id, autosave: true, post: { title: 'Test post', category: 'affirmations' } })).status, 409);
  assert.equal((await admin('save', { id: created.post.id, post: { title: 'Test post v2', slug: 'test-post', category: 'affirmations', summary: 'A summary.', seo_description: 'd', body_md: '## One?\n\n' + 'Word '.repeat(120) } })).status, 200);
  ok('autosave never overwrites a live article; manual save does');

  // search / category / related on live content
  assert((await (await get('/blog?q=word')).text()).includes('/blog/test-post'));
  assert((await (await get('/blog/category/affirmations')).text()).includes('/blog/test-post'));
  assert(!(await (await get('/blog?q=zzzznothing')).text()).includes('/blog/test-post'));
  assert.match(await (await get('/blog?q=zzzznothing')).text(), /Nothing matched/);
  assert.equal((await get('/blog/category/nope')).status, 404);
  ok('search, category listing, no-results and unknown-category states');

  // unpublish / archive / schedule
  await admin('status', { id: created.post.id, action: 'unpublish' });
  assert.equal((await get('/blog/test-post')).status, 404);
  const past = await admin('status', { id: created.post.id, action: 'schedule', scheduled_at: '2020-01-01T00:00:00Z' });
  assert.equal(past.status, 422);
  const future = new Date(Date.now() + 3600e3).toISOString();
  const sched = await (await admin('status', { id: created.post.id, action: 'schedule', scheduled_at: future })).json();
  assert.equal(sched.post.status, 'scheduled');
  assert.equal((await get('/blog/test-post')).status, 404);
  const db = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  db.posts.find((p) => p.id === created.post.id).scheduled_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(storeFile, JSON.stringify(db));
  assert.equal((await get('/blog/test-post')).status, 200);
  ok('unpublish hides; scheduling needs a future time; scheduled post stays hidden until due, then goes live');
  await admin('status', { id: created.post.id, action: 'archive' });
  assert.equal((await get('/blog/test-post')).status, 404);
  assert.equal((await admin('delete', { id: created.post.id })).status, 200);
  const live = await (await admin('create', { post: { title: 'Live one', category: 'affirmations', summary: 's', seo_description: 'd', body_md: 'Word '.repeat(120) } })).json();
  await admin('status', { id: live.post.id, action: 'publish' });
  assert.equal((await admin('delete', { id: live.post.id })).status, 409);
  ok('archive hides; archived can be deleted; a live article cannot be deleted');

  // uploads
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  assert.equal((await admin('upload', { name: 'a.png', data: png.toString('base64') })).status, 200);
  assert.equal((await admin('upload', { name: 'a.png', data: Buffer.from('<svg onload=alert(1)>').toString('base64') })).status, 415);
  assert.equal((await admin('upload', { name: 'a.png', data: png.toString('base64') }, null)).status, 403);
  ok('uploads accept real images only, admin only');

  // static assets referenced exist
  for (const p of ['/css/blog.css', '/js/blog.js', '/js/blog-admin.js', '/css/blog-admin.css', `/img/blog/${slug}.jpg`, `/img/blog/${slug}-pin.jpg`]) assert.equal((await get(p)).status, 200, p);
  ok('blog assets served');
} finally { srv.kill(); }
console.log(`\n${passed} checks passed`);
