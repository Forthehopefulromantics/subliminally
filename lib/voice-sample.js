// What a voice sample has to be before it is worth sending to ElevenLabs.
//
// The page turns every recording and every uploaded file (audio or video) into
// one plain format before it leaves the device: 16-bit PCM WAV, mono. That is
// the one format every browser can produce from what it decoded and that
// ElevenLabs reads without question. It is also the one format this server can
// measure without ffmpeg — so the length check below is on the audio itself,
// not on a timer the page ran.

// Instant Voice Cloning wants a minute or more of clear speech; anything
// shorter gives a voice that does not sound like the person.
export const MIN_SAMPLE_SECONDS = 60;
// The page rounds; a recording stopped at 1:00 on the clock can decode to
// 59.9s. Half a second is not the difference between a good voice and a bad one.
export const MIN_SAMPLE_TOLERANCE = 0.5;
// Of that minute, at least this much has to be clearly above the room. Speech
// has pauses, so this is well under the length; silence or a muted mic is not.
export const MIN_VOICED_SECONDS = 15;

/* Header of a RIFF/WAVE file. Returns null for anything that is not PCM WAV.
   Chunks are walked rather than assumed at offset 36: some encoders put LIST
   or fact chunks before data. */
export function parseWav(buf) {
  if (!buf || buf.length < 44) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let off = 12, fmt = null, dataStart = -1, dataBytes = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        byteRate: buf.readUInt32LE(body + 8),
        blockAlign: buf.readUInt16LE(body + 12),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataStart = body;
      // A streamed WAV can say 0 or 0xFFFFFFFF here; trust what actually arrived.
      dataBytes = Math.min(size || Infinity, buf.length - body);
      break;
    }
    off = body + size + (size % 2);
  }
  if (!fmt || dataStart < 0) return null;
  if (fmt.format !== 1 || fmt.bitsPerSample !== 16 || !fmt.channels || !fmt.sampleRate) return null;
  const frames = Math.floor(dataBytes / (2 * fmt.channels));
  return { ...fmt, dataStart, dataBytes, frames, seconds: frames / fmt.sampleRate };
}

/* How many seconds of the first channel are clearly louder than a quiet room,
   in 20ms frames, and the loudest sample. Same measure the page uses. */
export function measureWav(buf, wav) {
  const frameLen = Math.max(1, Math.round(wav.sampleRate * 0.02));
  const step = wav.channels;
  let peak = 0, voiced = 0, sum = 0, n = 0;
  for (let i = 0; i < wav.frames; i++) {
    const v = buf.readInt16LE(wav.dataStart + i * 2 * step) / 32768;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sum += v * v; n++;
    if (n === frameLen) {
      if (Math.sqrt(sum / n) > 0.01) voiced++;
      sum = 0; n = 0;
    }
  }
  return { peak: +peak.toFixed(4), voicedSeconds: +(voiced * 0.02).toFixed(1) };
}

/* The whole check. { ok:true, seconds, voicedSeconds } or { ok:false, code, detail }. */
export function checkVoiceSample(buf) {
  const wav = parseWav(buf);
  if (!wav) return { ok: false, code: 'unsupported_format', detail: 'not 16-bit PCM WAV' };
  const seconds = +wav.seconds.toFixed(2);
  if (seconds < MIN_SAMPLE_SECONDS - MIN_SAMPLE_TOLERANCE) {
    return { ok: false, code: 'sample_too_short', detail: `${seconds}s of audio` };
  }
  const level = measureWav(buf, wav);
  if (level.peak < 0.01 || level.voicedSeconds < MIN_VOICED_SECONDS) {
    return { ok: false, code: 'sample_silent', detail: JSON.stringify({ seconds, ...level }) };
  }
  return { ok: true, seconds, voicedSeconds: level.voicedSeconds, sampleRate: wav.sampleRate, channels: wav.channels };
}
