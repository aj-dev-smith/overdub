// @ts-check
// Small shared helpers for the engine: dB, sample-frame times, click-free parameter moves, waiting on the audio clock.

export const dbToGain = (d) => (d <= -120 ? 0 : Math.pow(10, d / 20));
export const gainToDb = (g) => (g > 1e-6 ? 20 * Math.log10(g) : -120);

// A time on the context's sample-frame grid (so sources start on a frame and renders are exact).
export const frame = (c, t) => Math.round(t * c.sampleRate) / c.sampleRate;

export const isOffline = (c) => typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;

// The earliest time a change made now can be scheduled for without a jump. The audio thread renders ahead of
// currentTime (by up to a hardware buffer), so automation that starts "now" has partly happened already when it
// arrives, and the param steps to catch up: a click. Measured with tools/engine-test.js (the masterTap click check).
export function soon(c) {
  if (isOffline(c)) return c.currentTime;
  return c.currentTime + Math.max(SAFETY.min, (c.baseLatency || 0) * SAFETY.k);
}
export const SAFETY = { min: 0.012, k: 2 };

// Move a param to v, smoothly: an exponential approach (time constant dur / 4, so it is within 2% after dur and
// within -70 dB after 2 dur) starting at soon(c). Offline before rendering it just sets it.
// (Not cancelAndHoldAtTime + a linear ramp: measured in Chrome, the ramp then starts from the previous event, so the
// param moves at once, and jumps if that event was a setValueAtTime. setTargetAtTime starts from wherever the param
// is at its start time, so moves made in quick succession, a fader drag, chain smoothly.)
export function ramp(c, param, v, dur = 0.015, at = 0) {
  if (!Number.isFinite(v)) return;
  const now = c.currentTime;
  if (isOffline(c) && now === 0 && !at) { param.cancelScheduledValues(0); param.setValueAtTime(v, 0); return; }
  const t = Math.max(soon(c), at || 0);
  try {
    param.cancelScheduledValues(t);
    param.setTargetAtTime(v, t, Math.max(0.0005, dur / 4));
  } catch (e) { /* closed */ }
  return t + dur;
}

// Set a param right now with no smoothing (graph building).
export function setNow(c, param, v) {
  if (!Number.isFinite(v)) return;
  param.cancelScheduledValues(0);
  param.value = v;
  try { param.setValueAtTime(v, c.currentTime); } catch (e) { /* closed */ }
}

// Call fn once the audio clock has passed t (or right away if the context isn't running: nothing is audible then).
export function afterAudio(c, t, fn) {
  const chk = () => {
    if (c.state !== 'running' || c.currentTime >= t) { try { fn(); } catch (e) { console.warn('engine:', e); } return; }
    setTimeout(chk, 4);
  };
  if (c.state !== 'running' || isOffline(c)) return chk();
  setTimeout(chk, Math.max(0, (t - c.currentTime) * 1000));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A promise that rejects if p takes longer than ms.
export function within(p, ms, what) {
  let to;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(to)),
    new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`${what} was not ready after ${ms} ms`)), ms); }),
  ]);
}

// Quarter-note beats in a bar: [4,4] -> 4, [3,4] -> 3, [6,8] -> 3, [7,8] -> 3.5.
export const beatsPerBarOf = (meter) => {
  const [n, d] = Array.isArray(meter) ? meter : [4, 4];
  return (Number(n) || 4) * 4 / (Number(d) || 4);
};

// A tiny event emitter.
export function emitter() {
  const map = new Map();
  return {
    on(type, fn) { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); return () => map.get(type).delete(fn); },
    emit(type, detail) {
      for (const fn of map.get(type) || []) { try { fn(detail); } catch (e) { console.warn('engine listener', type, e); } }
    },
    has(type) { return !!(map.get(type) && map.get(type).size); },
  };
}

// Stable string of a params object (key order independent) for "did it change?" checks.
export function sig(o) {
  if (o == null || typeof o !== 'object') return JSON.stringify(o);
  const keys = Object.keys(o).sort();
  let s = '{';
  for (const k of keys) s += JSON.stringify(k) + ':' + sig(o[k]) + ',';
  return s + '}';
}
