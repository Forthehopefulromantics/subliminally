// Renders the starter article artwork (1200x630 cover + 1000x1500 Pinterest pin)
// from the article front matter, into img/blog/. Needs Playwright + Chromium
// (dev machine only; the generated PNGs are committed).
//
//   NODE_PATH=/opt/node-tools/node_modules node scripts/make-blog-art.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArticle } from './seed-blog.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'img', 'blog');
fs.mkdirSync(outDir, { recursive: true });

const THEMES = {
  'subliminals-101': ['#2B2260', '#6B58C9', '#E9E2F8'],
  'affirmations': ['#4A2A6B', '#B8709A', '#F7E4EB'],
  'sleep-rituals': ['#14123A', '#3B3A8C', '#C9C3F0'],
  'self-concept': ['#3B2A66', '#C77FA6', '#F7E4EB'],
  'manifestation': ['#2A2457', '#8A6516', '#F4E3B8'],
  'mind-science': ['#1B2A5C', '#4A66C2', '#DDE6FA'],
};

function stars(w, h, n, seed) {
  let s = seed, out = '';
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h * 0.8, r = 0.8 + rnd() * 2;
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="${rnd() > 0.7 ? '#E3BE7F' : '#fff'}" opacity="${(0.4 + rnd() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

function scene(w, h, theme, seed, withTitle) {
  const [a, b, c] = theme;
  const mx = w * 0.72, my = h * (withTitle ? 0.2 : 0.34), mr = Math.min(w, h) * (withTitle ? 0.1 : 0.16);
  const cloud = (cx, cy, s, o) => `<g opacity="${o}" fill="${c}"><ellipse cx="${cx}" cy="${cy}" rx="${150 * s}" ry="${42 * s}"/><ellipse cx="${cx - 90 * s}" cy="${cy + 8 * s}" rx="${90 * s}" ry="${34 * s}"/><ellipse cx="${cx + 100 * s}" cy="${cy + 10 * s}" rx="${100 * s}" ry="${32 * s}"/><ellipse cx="${cx + 10 * s}" cy="${cy - 26 * s}" rx="${80 * s}" ry="${40 * s}"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#FFF3CF" stop-opacity=".55"/><stop offset="1" stop-color="#FFF3CF" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>${stars(w, h, withTitle ? 90 : 60, seed)}
<circle cx="${mx}" cy="${my}" r="${mr * 2.6}" fill="url(#glow)"/>
<circle cx="${mx}" cy="${my}" r="${mr}" fill="#FFF3CF"/><circle cx="${mx + mr * 0.42}" cy="${my - mr * 0.18}" r="${mr * 0.92}" fill="${a}"/>
${cloud(w * 0.25, h * (withTitle ? 0.93 : 0.82), withTitle ? 1.5 : 1.7, 0.9)}${cloud(w * 0.78, h * (withTitle ? 0.97 : 0.9), withTitle ? 1.3 : 1.5, 0.7)}
</svg>`;
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function html(w, h, svg, title, kicker, withTitle) {
  return `<html><head><style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@500&family=Outfit:wght@500;600&display=swap');
body{margin:0;width:${w}px;height:${h}px;position:relative;overflow:hidden;font-family:Outfit,sans-serif}
svg{position:absolute;inset:0}
.brand{position:absolute;left:${w * 0.06}px;top:${h * (withTitle ? 0.05 : 0.07)}px;color:#fff;font-size:${withTitle ? 30 : 24}px;letter-spacing:.04em;text-shadow:0 1px 6px #0006}
.brand b{color:#E3BE7F;font-weight:600}
.t{position:absolute;left:${w * 0.08}px;right:${w * 0.08}px;top:${h * 0.34}px;color:#fff}
.k{font-size:30px;letter-spacing:.16em;text-transform:uppercase;color:#E3BE7F;font-weight:600;margin-bottom:28px}
h1{font:500 ${withTitle ? 92 : 60}px/1.12 Fraunces,Georgia,serif;margin:0;text-shadow:0 2px 14px #0007}
</style></head><body>${svg}${withTitle ? `<div class="t"><div class="k">${esc(kicker)}</div><h1>${esc(title)}</h1></div>` : ''}
<div class="brand">The Subliminally <b>Journal</b></div></body></html>`;
}

const CATNAMES = { 'subliminals-101': 'Subliminals 101', affirmations: 'Affirmations', 'sleep-rituals': 'Sleep & Rituals', 'self-concept': 'Self-Concept', manifestation: 'Manifestation', 'mind-science': 'Mind & Science' };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const dir = path.join(root, 'content', 'blog');
let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
  const { fm } = parseArticle(fs.readFileSync(path.join(dir, f), 'utf8'));
  const theme = THEMES[fm.category];
  n++;
  for (const [suffix, w, h, withTitle] of [['', 1200, 630, false], ['-pin', 1000, 1500, true]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(html(w, h, scene(w, h, theme, 1000 + n * 37 + (withTitle ? 5 : 0), withTitle), fm.title, CATNAMES[fm.category], withTitle), { waitUntil: 'networkidle' }).catch(() => {});
    await page.screenshot({ path: path.join(outDir, `${fm.slug}${suffix}.jpg`), type: 'jpeg', quality: 80 });
    await page.close();
  }
  console.log('art', fm.slug);
}
await browser.close();
