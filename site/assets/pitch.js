// "Hum into it": the mic (only after a click), a light YIN pitch tracker, and a stream of float MIDI notes.
// The studio's real tracker lives in app/src/input/pitch.js; this is the landing page's own small copy so the page
// stays fast and stands alone.
//
//   const mic = await startMic({ onPitch(midi | null, timeSec, { hz, clarity, db }) {} })   // throws a readable Error
//   mic.stop()

// YIN (de Cheveigné & Kawahara 2002), on a decimated window: about 0.2 M multiply-adds per call, cheap on a phone.
export function yin(buf, sr, { threshold = 0.14, fmin = 65, fmax = 1100 } = {}) {
  const N = buf.length,
    W = N >> 1;
  const tauMin = Math.max(2, Math.floor(sr / fmax)),
    tauMax = Math.min(W - 1, Math.ceil(sr / fmin));
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  // cumulative mean normalised difference
  d[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // parabolic interpolation around the dip
  const a = d[tau - 1] ?? d[tau],
    b = d[tau],
    c = d[tau + 1] ?? d[tau];
  const den = a + c - 2 * b;
  const shift = den ? (a - c) / (2 * den) : 0;
  const hz = sr / (tau + shift);
  return { hz, clarity: 1 - b };
}

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

export async function startMic({ onPitch, rate = 30 } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    throw new Error('This browser has no microphone access. Try Chrome on a laptop or phone.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    throw new Error(
      denied
        ? 'The microphone is blocked. Allow it from the address bar, then press Hum into it again.'
        : 'No microphone was found. Plug one in and try again.',
    );
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  src.connect(an); // listened to, never played back (no feedback through the speakers)
  const raw = new Float32Array(an.fftSize);
  const dec = ctx.sampleRate >= 44100 ? 2 : 1;
  const small = new Float32Array(raw.length / dec);
  const sr = ctx.sampleRate / dec;
  let timer = 0,
    stopped = false;
  const tick = () => {
    if (stopped) return;
    an.getFloatTimeDomainData(raw);
    let e = 0;
    for (let i = 0, j = 0; j < small.length; j++, i += dec) {
      const v = dec === 2 ? (raw[i] + raw[i + 1]) * 0.5 : raw[i];
      small[j] = v;
      e += v * v;
    }
    const db = 10 * Math.log10(e / small.length + 1e-12);
    const t = performance.now() / 1000;
    let m = null,
      info = { db, hz: 0, clarity: 0 };
    if (db > -52) {
      const r = yin(small, sr);
      if (r && r.clarity > 0.8) {
        m = hzToMidi(r.hz);
        info = { db, hz: r.hz, clarity: r.clarity };
      }
    }
    onPitch && onPitch(m, t, info);
  };
  timer = setInterval(tick, 1000 / rate);
  return {
    ctx,
    sampleRate: ctx.sampleRate,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try {
        src.disconnect();
      } catch {
        /* gone */
      }
      stream.getTracks().forEach((tr) => tr.stop());
      ctx.close().catch(() => {});
    },
  };
}
