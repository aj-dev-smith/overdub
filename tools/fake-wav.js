// Fake microphone input for the browser checks (Chromium's --use-file-for-fake-audio-capture, tools/pw.js open's
// fakeAudio): 16-bit mono WAVs written to disk. Shared by tools/instruments-repro.js and tools/pick-sound-test.js.
//
//   humWav(file, { notes?, dur?, gap?, tail? }) -> file   a hummed line: C4 E4 G4 A4 G4 E4 D4 C4 by default, 0.42 s a
//                                                         note with a breath, a voice-ish tone (three harmonics)
//   beatboxWav(file, { beats?, bpm?, tail? }) -> file     noise bursts on the beat: a low thump on 1 and 3, a hiss on 2
//                                                         and 4 (pitchless, so it reads as a beat, not a tune)
//   writeWav(file, samples, sr?)                          Float32Array in -1..1 -> a WAV on disk
// Deterministic: the noise is seeded, never Math.random.
import fs from 'node:fs';
import path from 'node:path';

export const SR = 48000;

export function writeWav(file, buf, sr = SR) {
  const n = buf.length;
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pcm);
  return file;
}

export const HUM_NOTES = [60, 64, 67, 69, 67, 64, 62, 60];

export function humWav(file, { notes = HUM_NOTES, dur = 0.42, gap = 0.06, tail = 3 } = {}) {
  const total = Math.ceil(SR * (notes.length * (dur + gap) + tail));
  const buf = new Float32Array(total);
  notes.forEach((m, i) => {
    const f = 440 * 2 ** ((m - 69) / 12), s0 = Math.round(SR * i * (dur + gap)), n = Math.round(SR * dur);
    for (let k = 0; k < n; k++) { const t = k / SR, env = Math.min(1, k / 600, (n - k) / 600); buf[s0 + k] = env * 0.35 * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.2 * Math.sin(6 * Math.PI * f * t)); }
  });
  return writeWav(file, buf);
}

export function beatboxWav(file, { beats = 16, bpm = 120, tail = 2 } = {}) {
  const beat = 60 / bpm, total = Math.ceil(SR * (beats * beat + tail));
  const buf = new Float32Array(total);
  let s = 0x9e3779b9;
  const noise = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 31 - 1; };
  for (let b = 0; b < beats; b++) {
    const s0 = Math.round(SR * b * beat), kick = b % 2 === 0;
    const n = Math.round(SR * (kick ? 0.12 : 0.09));
    let lp = 0;
    for (let k = 0; k < n; k++) {
      const env = Math.exp(-k / (SR * (kick ? 0.03 : 0.02))) * Math.min(1, k / 48);
      const w = noise();
      lp += (w - lp) * (kick ? 0.04 : 0.9);   // a thump is mostly low noise, a hiss the whole band
      buf[s0 + k] = env * (kick ? 2.2 * lp : 0.5 * (w - lp * 0.5));
    }
  }
  return writeWav(file, buf);
}
