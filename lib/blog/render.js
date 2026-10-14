// HTML for every public page. Server-rendered, no client JS required to read.
import { BRAND, CTAS, SITE_URL, indexable, isStagingBanner } from './config.js';
import { esc, renderMarkdown } from './markdown.js';
import { displayDate } from './posts.js';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
const isoDate = (d) => d ? new Date(d).toISOString() : '';
const abs = (u) => !u ? '' : /^https?:/i.test(u) ? u : SITE_URL + (u.startsWith('/') ? '' : '/') + u;
export const postUrl = (p) => `${SITE_URL}/blog/${p.slug}`;

export function robotsContent() {
  return indexable() ? 'index, follow, max-image-preview:large' : 'noindex, nofollow, noarchive';
}

function shell({ title, description, canonical, ogType = 'website', ogImage, ogTitle, ogDescription, jsonld = [], body, bodyClass = '', extraHead = '', preview = false }) {
  const robots = preview ? 'noindex, nofollow, noarchive' : robotsContent();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots}">
<meta name="theme-color" content="#1E1744">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:site_name" content="${esc(BRAND.name)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(ogTitle || title)}">
<meta property="og:description" content="${esc(ogDescription || description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(abs(ogImage))}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(ogTitle || title)}">
<meta name="twitter:description" content="${esc(ogDescription || description)}">
${ogImage ? `<meta name="twitter:image" content="${esc(abs(ogImage))}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/blog.css?v=1">
${extraHead}
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body class="blog ${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${isStagingBanner() ? `<div class="staging" role="note"><strong>Private preview.</strong> Not public. Not indexed.</div>` : ''}
${header()}
<main id="main">
${body}
</main>
${footer()}
<script src="/js/blog.js?v=1" defer></script>
</body>
</html>`;
}

function header(active) {
  return `<header class="bhead"><div class="wrap">
  <a class="brand" href="/blog">${esc(BRAND.name)}</a>
  <nav class="bnav" aria-label="Journal"><a href="/blog"${active === 'home' ? ' aria-current="page"' : ''}>Journal home</a><a href="/blog#topics">Topics</a><a href="/blog#search">Search</a><a class="app-link" href="/">Open Subliminally</a></nav>
</div></header>`;
}

function footer() {
  return `<footer class="bfoot"><div class="wrap">
  <a class="brand" href="/blog">${esc(BRAND.name)}</a>
  <p class="tag">${esc(BRAND.tagline)}</p>
  <p>Education and personal reflection, not medical or mental health advice. If you are struggling, please talk with a qualified professional.</p>
  <p>A journal by <a href="/">Subliminally by FTHR</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/terms.html">Terms</a></p>
</div></footer>`;
}

function card(p, cats, { featured = false } = {}) {
  const cat = cats.find((c) => c.slug === p.category);
  return `<article class="card${featured ? ' featured' : ''}">
  ${p.featured_image_url ? `<img src="${esc(p.featured_image_url)}" alt="${esc(p.featured_image_alt)}" ${featured ? '' : 'loading="lazy" '}decoding="async" width="1200" height="630">` : ''}
  <div class="in">
    <span class="cat-tag">${esc(cat ? cat.name : p.category)}</span>
    <h3><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h3>
    <p>${esc(p.summary)}</p>
    <span class="meta">${p.reading_minutes} min read${displayDate(p) ? ' &middot; ' + fmtDate(displayDate(p)) : ''}</span>
  </div></article>`;
}

function catChips(cats, current) {
  return `<ul class="chips">${cats.map((c) => `<li><a href="/blog/category/${esc(c.slug)}"${c.slug === current ? ' aria-current="page"' : ''}>${esc(c.name)}</a></li>`).join('')}</ul>`;
}

function searchForm(q = '') {
  return `<form class="search" role="search" action="/blog" method="get" id="search"><label class="sr" for="q" style="position:absolute;left:-999px">Search the journal</label><input id="q" name="q" type="search" placeholder="Search articles" value="${esc(q)}" autocomplete="off"><button class="btn" type="submit">Search</button></form>`;
}

function crumbs(items) {
  return `<nav class="crumbs wrap" aria-label="Breadcrumb"><ol>${items.map((it, i) => i === items.length - 1 ? `<li aria-current="page">${esc(it.name)}</li>` : `<li><a href="${esc(it.href)}">${esc(it.name)}</a></li>`).join('')}</ol></nav>`;
}

function crumbsLd(items) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.href || '/blog') })) };
}

export function searchPosts(posts, q) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return posts;
  return posts.filter((p) => {
    const hay = `${p.title} ${p.subtitle} ${p.summary} ${(p.tags || []).join(' ')} ${p.body_md}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/* ----------------------------- pages ----------------------------- */
export function homePage({ posts, cats, q }) {
  const searching = !!(q && q.trim());
  const results = searching ? searchPosts(posts, q) : posts;
  const featured = !searching && (posts.find((p) => p.featured) || posts[0]);
  const rest = searching ? results : posts.filter((p) => p !== featured);
  const questions = posts.filter((p) => /\?$/.test(p.title)).slice(0, 6);
  const body = `
<section class="hero"><div class="wrap">
  <p class="eyebrow">Education for intentional living</p>
  <h1>${esc(BRAND.name)}</h1>
  <p class="tag">${esc(BRAND.tagline)}</p>
  <p class="mission">${esc(BRAND.mission)}</p>
  ${searchForm(q)}
</div></section>
${searching ? `<section class="sec"><div class="wrap"><h2>${results.length} result${results.length === 1 ? '' : 's'} for &ldquo;${esc(q)}&rdquo;</h2>
  ${results.length ? `<div class="grid">${results.map((p) => card(p, cats)).join('')}</div>` : emptyBox('Nothing matched that search.', 'Try a simpler word, or browse a topic below.', '/blog', 'See all articles')}
  </div></section>` : `
${featured ? `<section class="sec"><div class="wrap"><h2>Featured</h2>${card(featured, cats, { featured: true })}</div></section>` : `<section class="sec"><div class="wrap">${emptyBox('The first articles are on their way.', 'Check back soon, or explore the app in the meantime.', '/', 'Open Subliminally')}</div></section>`}
${rest.length ? `<section class="sec"><div class="wrap"><h2>Latest</h2><div class="grid three">${rest.slice(0, 9).map((p) => card(p, cats)).join('')}</div></div></section>` : ''}
${questions.length ? `<section class="sec"><div class="wrap"><h2>Start with one question</h2><ul class="qlist">${questions.map((p) => `<li><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></li>`).join('')}</ul></div></section>` : ''}`}
<section class="sec" id="topics"><div class="wrap"><h2>Browse by topic</h2>${catChips(cats)}</div></section>`;
  return shell({
    title: `${BRAND.name} | ${BRAND.tagline}`,
    description: BRAND.mission,
    canonical: `${SITE_URL}/blog`,
    ogImage: featured && featured.og_image_url || featured && featured.featured_image_url,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'Blog', name: BRAND.name, description: BRAND.mission, url: `${SITE_URL}/blog`, publisher: { '@type': 'Organization', name: 'Subliminally by FTHR', url: SITE_URL } }],
    body, bodyClass: 'home',
  });
}

export function categoryPage({ cat, posts, cats }) {
  const items = [{ name: 'Journal', href: '/blog' }, { name: cat.name, href: `/blog/category/${cat.slug}` }];
  const body = `${crumbs(items)}
<section class="hero"><div class="wrap"><p class="eyebrow">Topic</p><h1>${esc(cat.name)}</h1><p class="mission">${esc(cat.description)}</p></div></section>
<section class="sec"><div class="wrap">
${posts.length ? `<div class="grid three">${posts.map((p) => card(p, cats)).join('')}</div>` : emptyBox(`No ${cat.name} articles yet.`, 'New ones are being written. Try another topic in the meantime.', '/blog', 'Back to the journal')}
</div></section>
<section class="sec"><div class="wrap"><h2>All topics</h2>${catChips(cats, cat.slug)}</div></section>`;
  return shell({
    title: `${cat.name} | ${BRAND.name}`,
    description: cat.description,
    canonical: `${SITE_URL}/blog/category/${cat.slug}`,
    jsonld: [crumbsLd(items.map((i, n) => ({ ...i, href: n === 0 ? '/blog' : i.href })))],
    body,
  });
}

function emptyBox(h, p, href, label) {
  return `<div class="empty"><h2>${esc(h)}</h2><p>${esc(p)}</p><a class="btn" href="${esc(href)}">${esc(label)}</a></div>`;
}

export function notFoundPage({ cats = [] } = {}) {
  const body = `<section class="sec"><div class="wrap"><div class="empty"><h1>We could not find that page.</h1>
  <p>It may have moved, or it may not be published yet.</p><p><a class="btn" href="/blog">Back to the journal</a></p></div>
  ${cats.length ? `<h2 style="margin-top:2rem">Browse by topic</h2>${catChips(cats)}` : ''}</div></section>`;
  return shell({ title: `Page not found | ${BRAND.name}`, description: 'This page could not be found.', body, preview: true });
}

export function errorPage() {
  const body = `<section class="sec"><div class="wrap"><div class="empty"><h1>Something went wrong on our side.</h1>
  <p>Please try again in a moment.</p><p><a class="btn" href="/blog">Back to the journal</a></p></div></div></section>`;
  return shell({ title: `Something went wrong | ${BRAND.name}`, description: 'An error occurred.', body, preview: true });
}

export function articlePage({ post, cats, related, preview = false }) {
  const cat = cats.find((c) => c.slug === post.category) || { slug: post.category, name: post.category };
  const { html, toc } = renderMarkdown(post.body_md, { preview });
  const url = postUrl(post);
  const items = [{ name: 'Journal', href: '/blog' }, { name: cat.name, href: `/blog/category/${cat.slug}` }, { name: post.title, href: `/blog/${post.slug}` }];
  const cta = CTAS[post.cta_key];
  const published = post.published_at || post.scheduled_at;
  const updated = post.updated_at;
  const showUpdated = published && updated && Math.abs(new Date(updated) - new Date(published)) > 86400000;
  const shareImg = abs(post.pin_image_url || post.og_image_url || post.featured_image_url);
  const pinUrl = `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}${shareImg ? '&media=' + encodeURIComponent(shareImg) : ''}&description=${encodeURIComponent(post.title)}`;
  const tocItems = toc.filter((t) => t.level === 2);
  const showToc = tocItems.length >= 3 || post.reading_minutes >= 6;

  const ld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: post.title, description: post.seo_description || post.summary,
    mainEntityOfPage: url, url,
    image: post.og_image_url || post.featured_image_url ? [abs(post.og_image_url || post.featured_image_url)] : undefined,
    datePublished: isoDate(published) || undefined, dateModified: isoDate(updated) || undefined,
    author: { '@type': 'Person', name: post.author_name },
    publisher: { '@type': 'Organization', name: 'Subliminally by FTHR', url: SITE_URL },
    articleSection: cat.name, keywords: (post.tags || []).join(', ') || undefined,
    inLanguage: 'en-US', wordCount: post.body_md.split(/\s+/).length,
  };
  const faqLd = post.faq && post.faq.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: post.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) } : null;

  const body = `${crumbs(items)}
<article class="article">
<header>
  <p class="eyebrow"><a href="/blog/category/${esc(cat.slug)}" style="color:inherit">${esc(cat.name)}</a></p>
  <h1>${esc(post.title)}</h1>
  ${post.subtitle ? `<p class="sub">${esc(post.subtitle)}</p>` : ''}
  ${post.summary ? `<p class="lede">${esc(post.summary)}</p>` : ''}
  <p class="byline"><span>By ${esc(post.author_name)}</span>${published ? `<span>Published <time datetime="${isoDate(published)}">${fmtDate(published)}</time></span>` : '<span>Not yet published</span>'}${showUpdated ? `<span>Updated <time datetime="${isoDate(updated)}">${fmtDate(updated)}</time></span>` : ''}<span>${post.reading_minutes} min read</span></p>
</header>
${post.featured_image_url ? `<div class="hero-img"><img src="${esc(post.featured_image_url)}" alt="${esc(post.featured_image_alt)}" width="1200" height="630" fetchpriority="high"></div>` : ''}
<div class="qmode-bar"><button type="button" class="btn ghost" id="qmode-toggle" aria-pressed="false" data-label="Read one question at a time">Read one question at a time</button><span class="qprog" id="qprog" aria-live="polite"></span></div>
${showToc ? `<nav class="toc" aria-labelledby="toc-h"><h2 id="toc-h">In this article</h2><ol>${tocItems.map((t) => `<li><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`).join('')}</ol></nav>` : ''}
<div class="prose" data-qmode>
${html}
</div>
<div class="qnav"><button type="button" class="btn ghost" id="qback">Back</button><button type="button" class="btn" id="qnext">Next question</button></div>
${cta ? `<aside class="cta" aria-label="Try it in the app"><h2>${esc(cta.label)}</h2><p>${esc(cta.blurb)}</p><a class="btn" href="${esc(cta.href)}">${esc(cta.label)}</a></aside>` : ''}
${post.faq && post.faq.length ? `<section aria-labelledby="faq-h"><h2 id="faq-h" style="font-family:var(--serif);font-weight:500;color:var(--indigo)">Frequently asked questions</h2>${post.faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</section>` : ''}
${post.sources && post.sources.length ? `<section class="sources" aria-labelledby="src-h"><h2 id="src-h" style="font-family:var(--serif);font-weight:500;color:var(--indigo)">Sources</h2><ol>${post.sources.map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" rel="noopener noreferrer" target="_blank">${esc(s.title)}</a>` : esc(s.title)}${s.note ? ` &mdash; ${esc(s.note)}` : ''}</li>`).join('')}</ol></section>` : ''}
<div class="share" aria-label="Share this article"><strong>Share:</strong>
  <a href="${esc(pinUrl)}" target="_blank" rel="noopener noreferrer">Pinterest</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">Facebook</a>
  <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener noreferrer">X</a>
  <a href="mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(url)}">Email</a>
  <button type="button" data-share="copy" data-url="${esc(url)}" data-label="Copy link">Copy link</button>
  <button type="button" data-share="native" data-url="${esc(url)}" data-label="Share&hellip;">Share&hellip;</button>
</div>
<section class="author" aria-label="About the author"><div class="av" aria-hidden="true">${esc((post.author_name || 'S').trim().charAt(0).toUpperCase())}</div><div><p><strong>${esc(post.author_name)}</strong></p>${post.author_bio ? `<p>${esc(post.author_bio)}</p>` : ''}</div></section>
<p class="disclaimer">This article is for education and reflection. It is not medical, psychological or financial advice, and it does not promise any particular result.</p>
</article>
${related.length ? `<section class="sec"><div class="wrap"><h2>Keep exploring</h2><div class="grid three">${related.map((p) => card(p, cats)).join('')}</div></div></section>` : ''}`;

  return shell({
    title: post.seo_title || `${post.title} | ${BRAND.name}`,
    description: post.seo_description || post.summary,
    canonical: url, ogType: 'article',
    ogTitle: post.og_title || post.title, ogDescription: post.og_description || post.seo_description || post.summary,
    ogImage: post.og_image_url || post.featured_image_url,
    jsonld: [ld, crumbsLd(items), ...(faqLd ? [faqLd] : [])].map((j) => JSON.parse(JSON.stringify(j))),
    body, bodyClass: 'article-page', preview,
    extraHead: `${published ? `<meta property="article:published_time" content="${isoDate(published)}">` : ''}<meta property="article:modified_time" content="${isoDate(updated)}"><meta property="article:author" content="${esc(post.author_name)}"><meta property="article:section" content="${esc(cat.name)}">`,
  });
}

export function sitemapXml(posts, cats) {
  const urls = [`${SITE_URL}/blog`, ...cats.map((c) => `${SITE_URL}/blog/category/${c.slug}`), ...posts.map(postUrl)];
  const lastmod = (u) => { const p = posts.find((x) => postUrl(x) === u); return p ? `<lastmod>${isoDate(p.updated_at).slice(0, 10)}</lastmod>` : ''; };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc>${lastmod(u)}</url>`).join('\n')}\n</urlset>\n`;
}

export function adminPageHtml({ supabaseUrl, anonKey }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Journal admin</title><meta name="robots" content="noindex, nofollow, noarchive">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@500&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/blog.css?v=1"><link rel="stylesheet" href="/css/blog-admin.css?v=1">
</head><body class="blog admin" data-supabase-url="${esc(supabaseUrl)}" data-anon-key="${esc(anonKey)}" data-env="${esc(process.env.VERCEL_ENV || 'local')}">
<div id="app"><p style="padding:2rem">Loading&hellip;</p></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
<script src="/js/blog-admin.js?v=1"></script>
</body></html>`;
}
