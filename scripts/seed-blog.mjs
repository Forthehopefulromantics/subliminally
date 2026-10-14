// Loads content/blog/*.md into the blog as DRAFTS.
//
//   node scripts/seed-blog.mjs            # dry run: prints what it would do
//   node scripts/seed-blog.mjs --apply    # writes to the database in the env
//
// Safety: refuses to write unless BLOG_SEED_TARGET_CONFIRM matches the host of
// SUPABASE_URL, so a stray shell with production credentials cannot seed
// production by accident. Never overwrites an article that already exists --
// your edits in the admin are not touched by a re-run. Status is always draft.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalisePost } from '../lib/blog/posts.js';
import { DEFAULT_AUTHOR, DEFAULT_CATEGORIES } from '../lib/blog/config.js';
import { store, usingFileStore } from '../lib/blog/store.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'blog');
const apply = process.argv.includes('--apply');

export function parseArticle(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error('missing front matter');
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (k === 'sources' || k === 'faq') v = JSON.parse(v || '[]');
    else if (/^".*"$/.test(v)) v = JSON.parse(v);
    fm[k] = v;
  }
  return { fm, body: m[2].trim() + '\n' };
}

export function articleInput(file, art, imageBase) {
  const { fm, body } = art;
  const slug = fm.slug;
  return {
    title: fm.title, slug, subtitle: fm.subtitle || '', summary: fm.summary || '', body_md: body,
    category: fm.category, tags: String(fm.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    featured: fm.featured === 'true',
    featured_image_url: `${imageBase}/img/blog/${slug}.jpg`, featured_image_alt: fm.alt || '',
    pin_image_url: `${imageBase}/img/blog/${slug}-pin.jpg`, og_image_url: `${imageBase}/img/blog/${slug}.jpg`,
    author_name: DEFAULT_AUTHOR.name, author_bio: DEFAULT_AUTHOR.bio,
    seo_title: fm.seo_title || '', seo_description: fm.seo_description || '',
    og_title: '', og_description: '', sources: fm.sources || [], faq: fm.faq || [],
    cta_key: fm.cta || 'none', editorial_notes: fm.notes || '',
  };
}

async function main() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const cats = usingFileStore() ? DEFAULT_CATEGORIES : await store.categories();
  if (apply && !usingFileStore()) {
    const host = new URL(process.env.SUPABASE_URL).host;
    if (process.env.BLOG_SEED_TARGET_CONFIRM !== host) {
      console.error(`Refusing to write. Set BLOG_SEED_TARGET_CONFIRM=${host} to confirm this is the intended database.`);
      process.exit(2);
    }
  }
  for (const f of files) {
    const art = parseArticle(fs.readFileSync(path.join(dir, f), 'utf8'));
    const { post, errors } = normalisePost(articleInput(f, art, ''), { categories: cats });
    if (errors.length) { console.error(`${f}: ${errors.join(' ')}`); process.exitCode = 1; continue; }
    const existing = await store.postBySlug(post.slug);
    if (existing) { console.log(`skip   ${post.slug} (already exists, status ${existing.status})`); continue; }
    if (!apply) { console.log(`would create draft: ${post.slug} (${post.reading_minutes} min)`); continue; }
    await store.insertPost({ ...post, status: 'draft' });
    console.log(`created draft: ${post.slug}`);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
