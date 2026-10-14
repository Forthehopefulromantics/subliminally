// A small, dependency-free Markdown renderer for article bodies.
//
// Safety: raw HTML is never passed through. Every piece of text is escaped, and
// links/images are limited to http(s), mailto and same-site paths, so an article
// body cannot inject script no matter who wrote it.
//
// Supported: ## / ### headings, paragraphs, **bold**, *italic*, `code`, links,
// images ![alt](url "caption"), - and 1. lists, > quotes, --- rules, and
// labelled boxes:
//     :::evidence | :::experience | :::belief | :::example | :::try
//     text...
//     :::
// plus the editorial marker [[VERIFY: note]], shown only in previews.

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'section';
}

export function safeUrl(u) {
  const url = String(u || '').trim();
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^\/(?!\/)/.test(url) || /^#/.test(url)) return url;
  return '';
}

const BOXES = {
  evidence: 'What the research says',
  experience: 'Personal experience',
  belief: 'Belief & spiritual practice',
  example: 'Example',
  try: 'Try it',
};

export const VERIFY_RE = /\[\[VERIFY:([^\]]*)\]\]/g;

function inline(text, { preview }) {
  let t = esc(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const raw = href.replace(/&amp;/g, '&');
    const safe = safeUrl(raw);
    if (!safe) return label;
    const external = /^https?:/i.test(safe);
    return `<a href="${esc(safe)}"${external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${label}</a>`;
  });
  t = t.replace(/\[\[VERIFY:([^\]]*)\]\]/g, (m, note) =>
    preview ? `<mark class="verify" title="Editorial verification needed">Needs verification:${note}</mark>` : '');
  return t;
}

export function renderMarkdown(md, { preview = false } = {}) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const toc = [];
  const used = new Set();
  let i = 0;

  const uniqueId = (text) => {
    let base = slugify(text), id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
  };

  function block(stop) {
    const html = [];
    while (i < lines.length) {
      const line = lines[i];
      if (stop && stop(line)) break;
      if (!line.trim()) { i++; continue; }

      let m;
      if ((m = /^:::(\w+)\s*$/.exec(line)) && BOXES[m[1]]) {
        const kind = m[1];
        i++;
        const inner = block((l) => /^:::\s*$/.test(l));
        if (i < lines.length) i++;
        html.push(`<aside class="box box-${kind}"><p class="box-label">${BOXES[kind]}</p>${inner}</aside>`);
        continue;
      }
      if ((m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line))) {
        const level = m[1].length;
        const text = m[2];
        const id = uniqueId(text.replace(VERIFY_RE, ''));
        toc.push({ level, id, text: text.replace(VERIFY_RE, '').replace(/[*`]/g, '') });
        html.push(`<h${level} id="${id}">${inline(text, { preview })}</h${level}>`);
        i++; continue;
      }
      if (/^---+\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
      if ((m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line))) {
        const src = safeUrl(m[2]);
        if (src) {
          const alt = m[1];
          html.push(`<figure><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">${m[3] ? `<figcaption>${esc(m[3])}</figcaption>` : ''}</figure>`);
        }
        i++; continue;
      }
      if (/^>\s?/.test(line)) {
        const q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        html.push(`<blockquote>${q.map((l) => inline(l, { preview })).join('<br>')}</blockquote>`);
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
        html.push(`<ul>${items.map((x) => `<li>${inline(x, { preview })}</li>`).join('')}</ul>`);
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
        html.push(`<ol>${items.map((x) => `<li>${inline(x, { preview })}</li>`).join('')}</ol>`);
        continue;
      }
      const p = [];
      while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|---+\s*$|>|:::|\s*[-*]\s+|\s*\d+[.)]\s+|!\[)/.test(lines[i])) { p.push(lines[i]); i++; }
      if (!p.length) { p.push(lines[i]); i++; }
      html.push(`<p>${inline(p.join(' '), { preview })}</p>`);
    }
    return html.join('\n');
  }

  const html = block(null);
  return { html, toc };
}

export function plainText(md) {
  return String(md || '')
    .replace(VERIFY_RE, '')
    .replace(/^:::.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readingMinutes(md) {
  const words = plainText(md).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function verifyMarkers(md) {
  return [...String(md || '').matchAll(VERIFY_RE)].map((m) => m[1].trim());
}
