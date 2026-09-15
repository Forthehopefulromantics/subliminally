#!/usr/bin/env node
// Copies the static site (served from the repo root by Vercel) into www/,
// which is Capacitor's webDir. Keeping the site files at the repo root
// untouched means the existing Vercel deployment (root index.html + /api
// functions) keeps working exactly as before; this script just mirrors
// what the native apps need to bundle.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const FILES_TO_COPY = [
  'index.html',
  'privacy.html',
  'terms.html',
  'reset-password.html',
  'favicon.svg',
  'robots.txt',
  'sitemap.xml',
];

fs.mkdirSync(WWW, { recursive: true });

for (const file of FILES_TO_COPY) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(WWW, file));
  console.log(`copied ${file} -> www/${file}`);
}

console.log('web assets synced into www/');
