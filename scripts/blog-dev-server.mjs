// Local harness for the Journal: serves the static site, applies the same
// rewrites as vercel.json, and calls api/blog.js directly. File-backed store,
// so it never touches Supabase.
//
//   BLOG_ENABLED=true BLOG_STORE=file BLOG_STORE_FILE=/tmp/blog.json \
//     node scripts/blog-dev-server.mjs 3000

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rewrites = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).rewrites || [];
const { default: blog } = await import('../api/blog.js');
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html', '.webp': 'image/webp' };

function rewrite(url) {
  const u = new URL(url, 'http://x');
  for (const r of rewrites) {
    const names = [];
    const re = new RegExp('^' + r.source.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const m = re.exec(u.pathname);
    if (!m) continue;
    let dest = r.destination;
    names.forEach((n, i) => { dest = dest.replace(':' + n, m[i + 1]); });
    const d = new URL(dest, 'http://x');
    u.searchParams.forEach((v, k) => { if (!d.searchParams.has(k)) d.searchParams.set(k, v); });
    return d;
  }
  return null;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const target = u.pathname.startsWith('/api/blog') ? u : rewrite(req.url);
  if (target) {
    let raw = '';
    for await (const c of req) raw += c;
    req.query = Object.fromEntries(target.searchParams);
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    res.status = (c) => { res.statusCode = c; return res; };
    return blog(req, res);
  }
  const uploads = process.env.BLOG_STORE_FILE && path.join(path.dirname(process.env.BLOG_STORE_FILE));
  let f = path.join(root, decodeURIComponent(u.pathname));
  if (u.pathname.startsWith('/uploads/') && uploads) f = path.join(uploads, u.pathname);
  if (!f.startsWith(root) && !(uploads && f.startsWith(uploads)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(+process.argv[2] || 3000, () => console.log('journal dev server on', process.argv[2] || 3000));
