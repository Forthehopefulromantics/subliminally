// Any audio or video a phone or browser can hand over, turned into the one format
// a voice sample is checked and sent in: 16-bit PCM WAV, mono.
//
// The page normally does this itself (js/profile.js prepareVoiceSample) and sends
// WAV. This is for everything else that reaches /api/voice-clone:
//   * an iPhone app built before the page converted — it sends Safari's own
//     MediaRecorder output, AAC in a fragmented MP4, as it was recorded;
//   * a browser that could not decode its own recording, or an uploaded file,
//     and sent the original bytes instead (M4A, MP4, MOV, MP3, WAV, WebM, …).
// Those used to be refused as unsupported_format before anything was tried.
//
// ffmpeg reads from a temp file, not a pipe: an MP4 or MOV whose index (moov)
// sits at the end cannot be read front to back. It writes to a temp file too, so
// the WAV header carries real sizes rather than a streaming placeholder.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

// Same rate the page encodes at, so every sample ElevenLabs receives is alike.
export const SAMPLE_RATE = 22050;
// More than this does not improve an instant clone (the page sends at most 90s too).
export const MAX_SECONDS = 90;
const TRANSCODE_TIMEOUT_MS = 20000;

export class TranscodeError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;       // 'sample_no_audio' | 'unsupported_format' | 'transcode_unavailable'
    this.detail = detail || '';
  }
}

/* What the bytes actually are, from their first bytes — never from the name or
   the declared type alone, which is how an MP4 once went out labelled WebM. */
export function sniffContainer(buf) {
  if (!buf || buf.length < 12) return null;
  const at = (s, e) => buf.toString('latin1', s, e);
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { type: 'audio/webm', ext: 'webm' };
  if (at(4, 8) === 'ftyp') {
    const brand = at(8, 12);
    if (brand === 'qt  ') return { type: 'video/quicktime', ext: 'mov' };
    if (/^M4[AB]/.test(brand)) return { type: 'audio/mp4', ext: 'm4a' };
    return { type: 'video/mp4', ext: 'mp4' };
  }
  // A QuickTime file without ftyp starts straight on one of its atoms.
  if (/^(moov|mdat|wide|free|skip)$/.test(at(4, 8))) return { type: 'video/quicktime', ext: 'mov' };
  if (at(0, 4) === 'RIFF' && at(8, 12) === 'WAVE') return { type: 'audio/wav', ext: 'wav' };
  if (at(0, 4) === 'OggS') return { type: 'audio/ogg', ext: 'ogg' };
  if (at(0, 4) === 'fLaC') return { type: 'audio/flac', ext: 'flac' };
  if (at(0, 4) === 'caff') return { type: 'audio/x-caf', ext: 'caf' };
  if (at(0, 3) === 'ID3') return { type: 'audio/mpeg', ext: 'mp3' };
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return { type: 'audio/aac', ext: 'aac' };   // ADTS
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return { type: 'audio/mpeg', ext: 'mp3' };  // MPEG audio frame
  return null;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let child;
    try { child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) { reject(new TranscodeError('transcode_unavailable', (e && e.message) || String(e))); return; }
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, TRANSCODE_TIMEOUT_MS);
    child.stderr.on('data', (c) => { if (stderr.length < 4000) stderr += c; });
    child.on('error', (e) => { clearTimeout(timer); reject(new TranscodeError('transcode_unavailable', (e && e.message) || String(e))); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else if (signal) reject(new TranscodeError('unsupported_format', `ffmpeg killed (${signal}) after ${TRANSCODE_TIMEOUT_MS}ms`));
      else if (/matches no streams|does not contain any stream|Output file #0 does not contain/i.test(stderr)) {
        reject(new TranscodeError('sample_no_audio', stderr.trim().slice(-400)));
      } else reject(new TranscodeError('unsupported_format', stderr.trim().slice(-400)));
    });
  });
}

/* The first audio track of `buf` as 16-bit PCM WAV, mono, SAMPLE_RATE, at most
   MAX_SECONDS. Video is dropped here, on the server; only its sound is kept. */
export async function transcodeToWav(buf, { ext } = {}) {
  if (!ffmpegPath) throw new TranscodeError('transcode_unavailable', 'no ffmpeg binary for this platform');
  const dir = await mkdtemp(join(tmpdir(), 'voice-'));
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext || '') ? ext : 'bin';
  const input = join(dir, `in.${safeExt}`);
  const output = join(dir, 'out.wav');
  try {
    await writeFile(input, buf);
    await runFfmpeg([
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-i', input,
      '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le',
      '-t', String(MAX_SECONDS),
      '-fflags', '+bitexact', '-flags:a', '+bitexact',
      '-f', 'wav', output,
    ]);
    return await readFile(output);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
