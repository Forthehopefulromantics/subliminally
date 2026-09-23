#!/usr/bin/env node
/* prepare-ambience.js — turn a raw ambience recording into a loop master
 *
 * Part of Subliminally. Run once per track, when a new one joins the library.
 * The output is what ships: audio/ambience/<key>.mp3.
 *
 * WHY A RECORDING CANNOT JUST BE PLAYED ON REPEAT
 *
 * A session runs for twenty minutes or eight hours off a clip that is ten to
 * thirty seconds long, so the clip is heard hundreds of times in a row. Two
 * things make that audible, and both are fixed here rather than in the browser:
 *
 *   1. THE SEAM. The last sample of a clip and its first sample are not
 *      continuous, so every repeat lands a click, or a swell that stops dead.
 *      The fix is to fold the clip's own head onto its own tail: the file is
 *      cut at `xfade` seconds, the remainder is crossfaded with the piece that
 *      was cut off, and the result ends on exactly the material it begins with.
 *      Played end to end it is continuous, so the browser can loop it with no
 *      crossfade of its own and nothing to hear at the join.
 *
 *   2. THE LEVEL. These came in between -11.9 and -27.7 LUFS — a sixteen
 *      decibel spread, which is the difference between a whisper and a
 *      conversation. Switching from one to another at a fixed mixer position
 *      would have been a jump, so every master is normalised to the same
 *      integrated loudness before anything else happens.
 *
 * Trimming comes first, and only where a recording has a fade of its own: a
 * fade-in is silence to the crossfade, and folding silence onto the tail is a
 * dip once per loop.
 *
 * Usage:  node scripts/prepare-ambience.js <source-dir>
 *         FFMPEG=/path/to/ffmpeg node scripts/prepare-ambience.js <source-dir>
 *
 * Needs ffmpeg on PATH (or in $FFMPEG). Nothing at runtime needs it — this is
 * a build-time step whose output is committed.
 */
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const OUT_DIR = path.resolve(__dirname, '..', 'audio', 'ambience');

/* The loudness every master is brought to. Ambience is a bed underneath
   affirmations, not the thing being listened to, so it sits well below the
   -14 LUFS a music streaming service would target. The mixer's "Nature sounds"
   slider moves from here; what matters is that all five start from the same
   place, so moving between them is a change of scene and not of volume. */
const TARGET_LUFS = -20;
const TARGET_TRUE_PEAK = -1.5;

/* One entry per track. `trim` is [start, end] in seconds of the source, for
   recordings that fade in or out on their own; `xfade` is how much of the head
   is folded onto the tail, which is also how much shorter the master is than
   what it was cut from.

   A longer fold is a smoother seam and a shorter loop, and water hides a short
   fold better than a drone does — which is why the beach gets 1.5s and the
   pads get 3s. */
const TRACKS = [
  {
    key: 'deep-mind',
    match: /^fb18ba31-Deep_mind_relaxation/,
    xfade: 2.0,
  },
  {
    key: 'the-sanctuary',
    match: /^a0b2d353-Deep_ambient_meditat/,
    xfade: 3.0,
  },
  {
    key: 'ocean-escape',
    match: /^d18847b3-Ultra-realistic_beac/,
    // Fades up out of silence over the first second and a half, and back down
    // from 14.7s. Both would have been folded onto the seam as a gap.
    trim: [1.6, 14.6],
    xfade: 1.5,
  },
  {
    key: 'soft-asmr',
    match: /^fc5a6c09-realistic_ASMR_sound/,
    xfade: 3.0,
  },
  {
    key: 'inner-stillness',
    match: /^6ae77f3f-meditation/,
    xfade: 3.0,
  },
];

function ff(args) {
  return execFileSync(FFMPEG, ['-hide_banner', '-nostats', '-y', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 26,
  });
}
/* ffmpeg writes everything to stderr, including the measurements we want — and
   it exits 0 while doing it, so this reads the stream rather than an error. */
function ffErr(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-y', ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  return String((r.stderr || '') + (r.stdout || ''));
}

function durationOf(file) {
  const out = ffErr(['-i', file, '-f', 'null', '-']);
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`could not read the duration of ${file}`);
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

function integratedLoudness(file) {
  const out = ffErr(['-i', file, '-af', 'ebur128', '-f', 'null', '-']);
  const m = out.match(/Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+) LUFS/);
  return m ? parseFloat(m[1]) : null;
}

/* Pass one of loudnorm: measure. Pass two feeds these numbers back in, which
   is what makes the correction linear rather than the dynamic compression the
   single-pass form applies. A bed that is being compressed breathes. */
function measureLoudnorm(file, filterPrefix) {
  const chain = [filterPrefix, `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=11:print_format=json`]
    .filter(Boolean).join(',');
  const out = ffErr(['-i', file, '-af', chain, '-f', 'null', '-']);
  const json = out.slice(out.lastIndexOf('{'), out.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

function main() {
  const srcDir = process.argv[2];
  if (!srcDir) {
    console.error('usage: node scripts/prepare-ambience.js <source-dir>');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sources = fs.readdirSync(srcDir);

  for (const track of TRACKS) {
    const name = sources.find((f) => track.match.test(f));
    if (!name) {
      console.error(`! no source matching ${track.match} in ${srcDir} — skipping ${track.key}`);
      continue;
    }
    const src = path.join(srcDir, name);
    const out = path.join(OUT_DIR, `${track.key}.mp3`);
    const tmp = path.join(OUT_DIR, `.${track.key}.norm.wav`);

    const [start, end] = track.trim || [0, durationOf(src)];
    const trimmed = end - start;
    const xfade = track.xfade;
    if (xfade >= trimmed / 2) throw new Error(`${track.key}: the fold is longer than half the clip`);

    // 1. Trim, then normalise, at full float precision into a wav — so the
    //    fold in step 2 happens on already-matched material and the only lossy
    //    step is the last one.
    const trimFilter = `atrim=start=${start}:end=${end},asetpts=N/SR/TB`;
    const measured = measureLoudnorm(src, trimFilter);
    const norm =
      `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=11` +
      `:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
      `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}:linear=true`;
    ff(['-i', src, '-af', `${trimFilter},${norm},aresample=44100`, '-ar', '44100', '-ac', '2', tmp]);

    // 2. The fold. [body] is everything past the first `xfade` seconds; [head]
    //    is those seconds on their own. acrossfade lays the head over the end
    //    of the body, so the master finishes on the material it starts with.
    //    The same file is opened twice rather than split: acrossfade drains
    //    its first input completely before touching the second, so both
    //    branches of an asplit deadlock and ffmpeg writes an empty file.
    //    Two decoders, no shared buffer, no deadlock.
    //    qsin on both sides because the head and the tail are different
    //    material — a linear fade between two uncorrelated signals loses 3dB
    //    in the middle of the crossfade, which is a dip once per loop.
    const fold =
      `[0:a]atrim=start=${xfade},asetpts=N/SR/TB[body];` +
      `[1:a]atrim=end=${xfade},asetpts=N/SR/TB[head];` +
      `[body][head]acrossfade=d=${xfade}:c1=qsin:c2=qsin[out]`;
    ff([
      '-i', tmp, '-i', tmp,
      '-filter_complex', fold, '-map', '[out]',
      // 128k stereo is transparent for a bed of noise and water, and a third
      // of what these arrived as: the whole library loads in a moment.
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      // No cover art, no tags carried over from whatever made these.
      '-map_metadata', '-1',
      out,
    ]);
    fs.rmSync(tmp, { force: true });

    const loopSeconds = durationOf(out);
    const loudness = integratedLoudness(out);
    const bytes = fs.statSync(out).size;
    console.log(
      `${track.key.padEnd(16)} ${loopSeconds.toFixed(2)}s loop  ` +
      `${loudness === null ? '?' : loudness.toFixed(1)} LUFS  ` +
      `${(bytes / 1024).toFixed(0)} KB   (from ${name})`
    );
  }
}

main();
