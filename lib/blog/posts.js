// Validation and normalisation of an article before it is stored.
import { CTA_KEYS, DEFAULT_AUTHOR } from './config.js';
import { readingMinutes, safeUrl, verifyMarkers } from './markdown.js';

const str = (v, max) => String(v ?? '').trim().slice(0, max);

export function cleanSlug(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

export const RESERVED_SLUGS = new Set(['category', 'search', 'preview', 'tag', 'feed', 'sitemap']);

/* Take whatever the editor sent and return a row we are willing to store, or a
   list of problems. Never trusts status/published_at from the client: those are
   changed only by the dedicated publish actions. */
export function normalisePost(input, { categories }) {
  const errors = [];
  const p = {};
  p.title = str(input.title, 160);
  if (!p.title) errors.push('Title is required.');
  p.slug = cleanSlug(input.slug || p.title);
  if (!p.slug) errors.push('A URL slug is required.');
  if (RESERVED_SLUGS.has(p.slug)) errors.push(`"${p.slug}" is reserved; choose another slug.`);
  p.subtitle = str(input.subtitle, 240);
  p.summary = str(input.summary, 600);
  p.body_md = String(input.body_md ?? '').slice(0, 120000);
  p.category = str(input.category, 60);
  if (!categories.some((c) => c.slug === p.category)) errors.push('Choose a valid category.');
  p.tags = (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(','))
    .map((t) => str(t, 40).toLowerCase()).filter(Boolean).slice(0, 12);
  p.featured = !!input.featured;
  p.featured_image_url = safeUrl(input.featured_image_url) || null;
  p.featured_image_alt = str(input.featured_image_alt, 300);
  p.pin_image_url = safeUrl(input.pin_image_url) || null;
  p.og_image_url = safeUrl(input.og_image_url) || null;
  p.author_name = str(input.author_name, 80) || DEFAULT_AUTHOR.name;
  p.author_bio = str(input.author_bio, 400);
  p.seo_title = str(input.seo_title, 70);
  p.seo_description = str(input.seo_description, 170);
  p.og_title = str(input.og_title, 90);
  p.og_description = str(input.og_description, 200);
  p.sources = (Array.isArray(input.sources) ? input.sources : []).slice(0, 30).map((s) => ({
    title: str(s && s.title, 240), url: safeUrl(s && s.url), note: str(s && s.note, 300),
  })).filter((s) => s.title);
  p.faq = (Array.isArray(input.faq) ? input.faq : []).slice(0, 20).map((f) => ({
    q: str(f && f.q, 200), a: str(f && f.a, 1200),
  })).filter((f) => f.q && f.a);
  p.cta_key = CTA_KEYS.includes(input.cta_key) ? input.cta_key : 'none';
  p.editorial_notes = str(input.editorial_notes, 4000);
  p.reading_minutes = readingMinutes(p.body_md);
  return { post: p, errors };
}

/* Everything that must be true before an article goes live. */
export function publishProblems(post) {
  const problems = [];
  if (!post.summary) problems.push('Add a short introductory summary.');
  if (!post.seo_description) problems.push('Add a meta description.');
  if (post.featured_image_url && !post.featured_image_alt) problems.push('Add alt text for the featured image.');
  if (!post.body_md || post.body_md.length < 400) problems.push('The article body is too short to publish.');
  const marks = verifyMarkers(post.body_md);
  if (marks.length) problems.push(`${marks.length} [[VERIFY: ...]] editorial marker(s) still in the text. Verify the claim and remove the marker.`);
  return problems;
}

/* A post is live to readers only if published (or scheduled and due). */
export function isLive(post, now = new Date()) {
  if (post.status === 'published') return !post.published_at || new Date(post.published_at) <= now;
  if (post.status === 'scheduled') return !!post.scheduled_at && new Date(post.scheduled_at) <= now;
  return false;
}

export function displayDate(post) {
  return post.status === 'scheduled' ? post.scheduled_at : post.published_at;
}
