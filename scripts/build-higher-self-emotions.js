#!/usr/bin/env node
/* build-higher-self-emotions.js — turns a supplied emotion pack into the files
   the app actually loads, and regenerates the map that says which of them exist.

   The packs arrive as ~2,200 x 2,900 transparent WebP portraits, 400-750 KB
   each. Nothing in the app draws one larger than about 300 CSS pixels tall, so
   shipping them at full size would send a phone five times the pixels its
   screen can show. They are resized by height alone -- aspect ratio, alpha and
   the full silhouette all untouched -- to 1200px, which still covers a 400px
   portrait on a 3x screen, and re-encoded at quality 88 with lossless alpha.

   The pack names its identities `woman-box-braids`, `man-black-twists` and so
   on. The app has stored `box-braids` and `black-twists` in
   profiles.higher_self_avatar since the roster shipped, and those ids are not
   allowed to change. EMOTION_PACK_IDS below is that mapping, written out one
   line per identity rather than derived by stripping a prefix, because a rule
   that happens to work today is how somebody's saved choice quietly becomes
   somebody else's face. Note the thirteenth: the app calls her
   `long-straight-black`, the pack calls her `13-deep-ebony-straight-black`.

   Usage:  node scripts/build-higher-self-emotions.js <extracted-pack-dir>...

   Each directory is one unzipped pack: a manifest.json and women/ or men/
   folders. Passing several at once is normal -- they are one collection split
   across downloads. Re-running is safe, and running it again when the
   remaining packs arrive picks them up and rewrites the map.                */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'img', 'avatar', 'emotion');
const MAP_FILE = path.join(ROOT, 'js', 'avatar-emotions.js');
const EMOTIONS = ['welcoming', 'celebrating', 'reassuring'];
const TARGET_HEIGHT = 1200;
const QUALITY = 88;

/* app avatar id (what is stored, and what every path to a picture goes
   through) -> the identity id printed in the pack's manifest.json. */
const EMOTION_PACK_IDS = {
  'box-braids':           'woman-box-braids',
  'straight-black':       'woman-straight-black',
  'tapered-afro':         'woman-tapered-afro',
  'copper-waves':         'woman-copper-waves',
  'dark-blonde-ponytail': 'woman-dark-blonde-ponytail',
  'shoulder-locs':        'woman-shoulder-locs',
  'curly-bob':            'woman-curly-bob',
  'silver-lilac':         'woman-silver-lilac',
  'blonde-curls':         'woman-blonde-curls',
  'lavender-hijab':       'woman-lavender-hijab',
  'facial-piercings':     'woman-facial-piercings',
  'east-asian':           'woman-east-asian',
  'long-straight-black':  'woman-deep-ebony-straight-black',
  'black-twists':         'man-black-twists',
  'east-asian-crop':      'man-east-asian-crop',
  'latino-waves':         'man-latino-waves',
  'south-asian-curls':    'man-south-asian-curls',
  'blond-blue-eyes':      'man-blond-blue-eyes',
  'androgynous-undercut': 'androgynous-undercut',
};

function die(msg){ console.error(msg); process.exit(1); }

const packDirs = process.argv.slice(2);
if (!packDirs.length) die('usage: node scripts/build-higher-self-emotions.js <extracted-pack-dir>...');

let sharp;
try { sharp = require('sharp'); }
catch(e){ die('This script needs sharp: npm install --no-save sharp'); }

/* One identity id -> { group, stem } gathered from every manifest handed in.
   The packs repeat the same manifest, so later ones simply agree. */
const packIdentities = new Map();
for (const dir of packDirs){
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)){ console.warn(`skipped ${dir} — no manifest.json`); continue; }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const ident of manifest.identities || []){
    packIdentities.set(ident.id, { group: ident.group, stem: ident.stem });
  }
}
if (!packIdentities.size) die('none of those directories held a manifest.json with identities');

/* Where a given identity's file for an emotion is, across every pack handed
   in: the collection is split by download, so an identity's three emotions may
   or may not be in the same folder. */
function findSource(ident, emotion){
  const file = `${ident.stem}-${emotion}.webp`;
  for (const dir of packDirs){
    const p = path.join(dir, ident.group, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const available = {};       // app id -> emotions actually written
  const missing = [];
  let written = 0, bytes = 0;

  for (const [appId, packId] of Object.entries(EMOTION_PACK_IDS)){
    const ident = packIdentities.get(packId);
    if (!ident){ missing.push(`${appId}: not in any manifest (pack id ${packId})`); continue; }
    const got = [];
    for (const emotion of EMOTIONS){
      const src = findSource(ident, emotion);
      const out = path.join(OUT_DIR, `${appId}-${emotion}.webp`);
      if (!src){
        // Already built by an earlier run from a pack not passed this time.
        if (fs.existsSync(out)){
          const meta = await sharp(out).metadata();
          got.push([emotion, meta.width, meta.height]);
          continue;
        }
        missing.push(`${appId}: ${emotion} not supplied (looked for ${ident.group}/${ident.stem}-${emotion}.webp)`);
        continue;
      }
      // Already built from this same source: read its size and leave it alone.
      // Re-encoding thirty-nine portraits to find out what is already on disk
      // is two minutes to learn nothing.
      if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs){
        const meta = await sharp(out).metadata();
        got.push([emotion, meta.width, meta.height]);
        continue;
      }
      const buf = await sharp(src)
        .resize({ height: TARGET_HEIGHT, withoutEnlargement: true })
        .webp({ quality: QUALITY, alphaQuality: 100, effort: 6 })
        .toBuffer();
      fs.writeFileSync(out, buf);
      const meta = await sharp(buf).metadata();
      got.push([emotion, meta.width, meta.height]);
      written++; bytes += buf.length;
    }
    if (got.length) available[appId] = got;
  }

  // The generated map. The app reads it to know what it may ask for, so that a
  // missing emotion falls back deliberately rather than by failed request.
  const rows = Object.keys(EMOTION_PACK_IDS).map(id => {
    const got = available[id] || [];
    const body = got.map(([e, w, h]) => `${e}:[${w},${h}]`).join(', ');
    return `  ${JSON.stringify(id)}: {${body ? ' ' + body + ' ' : ''}},`;
  }).join('\n');
  fs.writeFileSync(MAP_FILE, `/* avatar-emotions.js — GENERATED. Do not edit by hand.

   Written by scripts/build-higher-self-emotions.js from the supplied Higher
   Self emotion packs. One entry per avatar id the app offers: the emotions
   whose artwork is actually in img/avatar/emotion/, each with the [width,
   height] of that file. An identity with an empty entry has no emotion artwork
   yet and falls back to its existing keeper drawing -- never to somebody
   else's face. Re-run the script when the remaining packs arrive and this file
   is rewritten.

   The sizes are here because the packs are not one shape: the portraits run
   anywhere from 1882x3344 to 2366x2660 before resizing, and every one keeps
   its own ratio. A single assumed size on the <img> would reserve the wrong
   box and shift the whole slide the moment the real picture arrived.

   Part of Subliminally. A plain script, loaded before kaly.js. */
const AVATAR_EMOTIONS = ['${EMOTIONS.join("', '")}'];
const AVATAR_EMOTION_ART = {
${rows}
};
`);

  console.log(`wrote ${written} portraits (${Math.round(bytes/1024)} KB) -> img/avatar/emotion/`);
  console.log(`regenerated js/avatar-emotions.js`);
  const complete = Object.keys(EMOTION_PACK_IDS).filter(id => (available[id] || []).length === EMOTIONS.length);
  console.log(`${complete.length}/${Object.keys(EMOTION_PACK_IDS).length} identities resolve all three emotions`);
  if (missing.length){
    console.log('\nstill missing:');
    missing.forEach(m => console.log('  ' + m));
  }
})();
