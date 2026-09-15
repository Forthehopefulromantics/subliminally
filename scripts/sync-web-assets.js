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

// Whole folders the site references. Without these the native apps bundle the
// markup but none of the pictures, and every <img> is a blank space in the app
// while looking fine on the website.
const DIRS_TO_COPY = ['img'];

fs.mkdirSync(WWW, { recursive: true });

for (const file of FILES_TO_COPY) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(WWW, file));
  console.log(`copied ${file} -> www/${file}`);
}

for (const dir of DIRS_TO_COPY) {
  const src = path.join(ROOT, dir);
  if (!fs.existsSync(src)) continue;
  fs.rmSync(path.join(WWW, dir), { recursive: true, force: true });
  fs.cpSync(src, path.join(WWW, dir), { recursive: true });
  const count = fs.readdirSync(src).length;
  console.log(`copied ${dir}/ -> www/${dir}/ (${count} files)`);
}

console.log('web assets synced into www/');
