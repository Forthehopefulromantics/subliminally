// Is this buffer a whole, playable mp3 for the words it was meant to say?
//
// Generated speech used to be stored the moment the provider answered 200. A
// body that was empty, cut off, or an error page with a 200 status was uploaded,
// recorded as a finished clip and then served from the cache forever — which
// sounds exactly like "plays for a second and stops". Nothing is stored or
// called ready now unless it passes here.

/* Rough speech rate: even slow, deliberate affirmations run well above 6
   characters a second. A clip far shorter than the words need was cut off. */
const MIN_CHARS_PER_SECOND = 6;
const MAX_CHARS_PER_SECOND_FLOOR = 0.4; // a long clip for few words is not "truncated", just slow
const MIN_BYTES = 1500;
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const SAMPLE_RATES_V1 = [44100, 48000, 32000];

function skipId3(buf) {
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    return 10 + size;
  }
  return 0;
}

/* Walks the frame headers and adds up real duration. Falls back to a bitrate
   estimate for streams that use MPEG-2 sample rates. Returns null for anything
   that is not mp3 at all. */
export function inspectMp3(buf) {
  if (!buf || !buf.length) return { ok: false, reason: 'empty' };
  let pos = skipId3(buf);
  let frames = 0;
  let samples = 0;
  let sampleRate = 0;
  let firstFrame = -1;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) {
      if (firstFrame < 0 && pos < buf.length - 4 && pos < skipId3(buf) + 4096) { pos += 1; continue; }
      break;
    }
    const version = (buf[pos + 1] >> 3) & 3;     // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[pos + 1] >> 1) & 3;       // 1 = layer III
    const bitrateIdx = (buf[pos + 2] >> 4) & 15;
    const srIdx = (buf[pos + 2] >> 2) & 3;
    const padding = (buf[pos + 2] >> 1) & 1;
    if (layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3 || version === 1) break;
    const mpeg1 = version === 3;
    const rate = SAMPLE_RATES_V1[srIdx] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (mpeg1 ? BITRATES_V1_L3[bitrateIdx] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][bitrateIdx]) * 1000;
    const spf = mpeg1 ? 1152 : 576;
    const len = Math.floor((spf / 8) * bitrate / rate) + padding;
    if (len < 4) break;
    if (firstFrame < 0) firstFrame = pos;
    frames += 1; samples += spf; sampleRate = rate;
    pos += len;
  }
  if (frames < 3) return { ok: false, reason: 'not_mp3' };
  // A final partial frame is tolerated; a body that ends well short of its last frame is not.
  const truncatedBytes = Math.max(0, pos - buf.length);
  if (truncatedBytes > 2048) return { ok: false, reason: 'truncated' };
  return { ok: true, frames, durationMs: Math.round((samples / sampleRate) * 1000), sampleRate };
}

/* `text` is the line this clip is supposed to say. */
export function validateSpeechClip(buf, text) {
  if (!buf || buf.length < MIN_BYTES) return { ok: false, reason: 'too_small', bytes: buf ? buf.length : 0 };
  const info = inspectMp3(buf);
  if (!info.ok) return { ...info, bytes: buf.length };
  const chars = String(text || '').trim().length;
  const minMs = Math.min(3000, Math.max(400, (chars / 20) * 1000 * 0.6)); // never demand more than 3s
  if (info.durationMs < minMs) return { ok: false, reason: 'too_short', bytes: buf.length, durationMs: info.durationMs };
  return { ok: true, bytes: buf.length, durationMs: info.durationMs };
}

export const _internals = { MIN_CHARS_PER_SECOND, MAX_CHARS_PER_SECOND_FLOOR, MIN_BYTES };
