// Where articles live. Two backends behind one interface:
//
//  - supabase: the real thing, over PostgREST with the service-role key. Reads
//    for the public site are filtered to live articles IN THE QUERY, so a draft
//    never even reaches the renderer for an anonymous request.
//  - file: a JSON file, for local tests only. It refuses to run on Vercel.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CATEGORIES } from './config.js';
import { isLive } from './posts.js';

const SUPABASE_URL = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = (extra) => ({ apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json', ...(extra || {}) });

export function usingFileStore() {
  return process.env.BLOG_STORE === 'file' && !process.env.VERCEL;
}

/* ------------------------------ file store ------------------------------ */
function fileDb() {
  const f = process.env.BLOG_STORE_FILE;
  if (!f) throw new Error('BLOG_STORE_FILE not set');
  if (!fs.existsSync(f)) return { posts: [], categories: DEFAULT_CATEGORIES, admins: ['test-admin'] };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
const fileSave = (db) => fs.writeFileSync(process.env.BLOG_STORE_FILE, JSON.stringify(db, null, 2));

const fileStore = {
  async categories() { return fileDb().categories; },
  async saveCategory(c) {
    const db = fileDb();
    const i = db.categories.findIndex((x) => x.slug === c.slug);
    if (i < 0) return null;
    db.categories[i] = { ...db.categories[i], name: c.name, description: c.description };
    fileSave(db); return db.categories[i];
  },
  async livePosts() { return fileDb().posts.filter((p) => isLive(p)); },
  async liveBySlug(slug) { return fileDb().posts.find((p) => p.slug === slug && isLive(p)) || null; },
  async allPosts() { return fileDb().posts; },
  async postById(id) { return fileDb().posts.find((p) => p.id === id) || null; },
  async postBySlug(slug) { return fileDb().posts.find((p) => p.slug === slug) || null; },
  async insertPost(row) {
    const db = fileDb();
    const post = { id: randomUUID(), status: 'draft', published_at: null, scheduled_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
    db.posts.push(post); fileSave(db); return post;
  },
  async updatePost(id, patch) {
    const db = fileDb();
    const i = db.posts.findIndex((p) => p.id === id);
    if (i < 0) return null;
    db.posts[i] = { ...db.posts[i], ...patch, updated_at: new Date().toISOString() };
    fileSave(db); return db.posts[i];
  },
  async deletePost(id) { const db = fileDb(); db.posts = db.posts.filter((p) => p.id !== id); fileSave(db); },
  async isAdmin(userId) { return fileDb().admins.includes(userId); },
  async uploadImage(name, type, buf) {
    const dir = path.join(path.dirname(process.env.BLOG_STORE_FILE), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    return `/uploads/${name}`;
  },
};

/* ---------------------------- supabase store ---------------------------- */
async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL()}/rest/v1/${pathAndQuery}`, { ...init, headers: H(init.headers) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`supabase ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const LIVE_FILTER = () => {
  const now = encodeURIComponent(new Date().toISOString());
  return `or=(and(status.eq.published,published_at.lte.${now}),and(status.eq.scheduled,scheduled_at.lte.${now}))`;
};

const sbStore = {
  async categories() {
    try { return await rest('blog_categories?select=*&order=sort_order.asc'); } catch { return DEFAULT_CATEGORIES; }
  },
  async saveCategory(c) {
    const rows = await rest(`blog_categories?slug=eq.${encodeURIComponent(c.slug)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: c.name, description: c.description }),
    });
    return rows && rows[0];
  },
  async livePosts() { return rest(`blog_posts?select=*&${LIVE_FILTER()}&order=published_at.desc.nullslast`); },
  async liveBySlug(slug) {
    const rows = await rest(`blog_posts?select=*&slug=eq.${encodeURIComponent(slug)}&${LIVE_FILTER()}&limit=1`);
    return rows[0] || null;
  },
  async allPosts() { return rest('blog_posts?select=*&order=updated_at.desc'); },
  async postById(id) { const r = await rest(`blog_posts?select=*&id=eq.${encodeURIComponent(id)}&limit=1`); return r[0] || null; },
  async postBySlug(slug) { const r = await rest(`blog_posts?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`); return r[0] || null; },
  async insertPost(row) {
    const r = await rest('blog_posts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    return r[0];
  },
  async updatePost(id, patch) {
    const r = await rest(`blog_posts?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    return r[0] || null;
  },
  async deletePost(id) { await rest(`blog_posts?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  async isAdmin(userId) {
    const r = await rest(`blog_admins?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    return r.length > 0;
  },
  async uploadImage(name, type, buf) {
    const res = await fetch(`${SUPABASE_URL()}/storage/v1/object/blog-images/${name}`, {
      method: 'POST', headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': type, 'x-upsert': 'true' }, body: buf,
    });
    if (!res.ok) throw new Error(`upload failed (${res.status})`);
    return `${SUPABASE_URL()}/storage/v1/object/public/blog-images/${name}`;
  },
};

export const store = new Proxy({}, {
  get: (_, k) => (usingFileStore() ? fileStore : sbStore)[k],
});
