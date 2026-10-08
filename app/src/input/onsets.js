// A guitar's notes from its audio [input]: where each one starts and what it is, for the Jam room's play-along
// (ui/tabs.js). An onset is a pick's attack (a jump in the signal's high-frequency energy over the few milliseconds
// before it, the way input/latency.js finds a hit) or, with no attack, a new pitch held under the finger (a hammer-on,
// a pull-off, a slide); its pitch is YIN's (input/pitch.js) on the 43 ms after the attack settles, with the next few
// periods YIN's difference function dips at (ps): a string still ringing from the note before, or a tracker's octave
// slip, puts the right pitch second, and a judge that knows what it expects (core/playalong.js) checks the few. One note
// at a time: a chord comes out as its onset and its pitches as best it can, all the play-along judges a chord by.
// Pure (no DOM, no audio graph): tools/tabs-test.js feeds it plucked strings and checks where and what it hears.
//
//   createNoteFinder({ sr, lo, hi, floorDb }) -> finder
//     finder.push(samples, frame0) -> [{ f (the onset's frame on the audio clock), p (MIDI), ps (the candidates, best
//         first), hz, conf, legato }]
//         blocks as audio.listen gives them (input/audioin.js: { f, d: [Float32Array] }); a block that doesn't follow
//         the last one starts afresh
//     finder.reset()

import { yin, ftom } from './pitch.js';

export function createNoteFinder({ sr = 48000, lo = 70, hi = 1300, floorDb = -52 } = {}) {
  const H = Math.max(32, Math.round(sr * 0.004)); // a hop: 4 ms
  const WIN = 2048 * Math.max(1, Math.round(sr / 48000)); // the YIN window (43 ms at 48 kHz: two periods of a low D)
  const SETTLE = Math.round(sr * 0.022); // past the pick's click before the pitch is read
  const REFRACT = Math.round(sr * 0.05); // two attacks closer than this are one
  const RN = 1 << 15; // the ring: the last 0.68 s at 48 kHz
  const ring = new Float32Array(RN);
  const win = new Float32Array(WIN),
    yo = {};
  const floor = Math.pow(10, floorDb / 20);
  let next = null; // the frame the next sample should be (a gap starts afresh)
  let hopE = 0,
    hopL = 0,
    hopN = 0,
    prevX = 0;
  const hist = []; // the last few hops' HF energy
  let lastOn = -Infinity,
    lastP = null,
    lastPs = [];
  const pending = []; // onsets waiting for their pitch window: { f, at, tries }
  let leg = { q: null, f: 0, n: 0 },
    legAt = 0;
  const out = [];

  const read = (endFrame) => {
    // the WIN samples ending at endFrame (exclusive), from the ring
    for (let i = 0; i < WIN; i++) win[i] = ring[(((endFrame - WIN + i) % RN) + RN) % RN];
    const y = yin(win, sr, { lo, hi, out: yo });
    if (!(y.hz > 0 && y.conf >= 0.45)) return null;
    const p = Math.round(ftom(y.hz));
    const ps = [p];
    for (const q of dips(win, sr, lo, hi))
      if (!ps.includes(q) && q >= p - 13 && q <= p + 24 && ps.length < 4) ps.push(q);
    return { hz: y.hz, conf: y.conf, p, ps };
  };
  function reset() {
    next = null;
    hopE = hopL = hopN = 0;
    prevX = 0;
    hist.length = 0;
    lastOn = -Infinity;
    lastP = null;
    lastPs = [];
    pending.length = 0;
    leg = { q: null, f: 0, n: 0 };
    legAt = 0;
  }
  function push(samples, frame0) {
    out.length = 0;
    if (!samples || !samples.length) return [];
    if (next != null && frame0 !== next) reset();
    for (let k = 0; k < samples.length; k++) {
      const fr = frame0 + k,
        x = samples[k];
      ring[((fr % RN) + RN) % RN] = x;
      const d = x - prevX;
      prevX = x;
      hopE += d * d;
      hopL += x * x;
      hopN++;
      if (hopN < H) continue;
      // a hop is in: an attack is a jump in HF energy well over the hops just before, loud enough to be a string
      const e = hopE / H,
        lvl = Math.sqrt(hopL / H);
      const base = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
      hist.push(e);
      if (hist.length > 10) hist.shift();
      hopE = hopL = hopN = 0;
      const at = fr - H + 1;
      if (lvl > floor && e > base * 6 + 1e-9 && at - lastOn >= REFRACT) {
        lastOn = at;
        pending.push({ f: at, at: at + SETTLE + WIN, tries: 0 });
        leg = { q: null, f: 0, n: 0 };
      }
      // the pitch of an attack, once its window is in (a second try 20 ms on if the first is unclear)
      while (pending.length && fr + 1 >= pending[0].at) {
        const pd = pending[0];
        const got = read(pd.at);
        if (got) {
          out.push({ f: pd.f, p: got.p, ps: got.ps, hz: got.hz, conf: got.conf, legato: false });
          lastP = got.p;
          lastPs = got.ps;
          pending.shift();
          continue;
        }
        if (pd.tries++ < 1) {
          pd.at += Math.round(sr * 0.02);
          break;
        }
        pending.shift();
      }
      // a new pitch with no attack (a hammer-on, a pull-off, a slide: a few frets along the string), read every 20 ms
      // while the string sounds and no attack is pending, and believed after three reads agree (two strings ringing
      // make a third pitch, their common one, that a single read can take for a note)
      if (!pending.length && lvl > floor && fr - lastOn > SETTLE + WIN && fr - legAt >= Math.round(sr * 0.02)) {
        legAt = fr;
        const got = read(fr + 1);
        const step = got && lastP != null ? Math.abs(got.p - lastP) : 0;
        if (got && got.conf >= 0.6 && step >= 1 && step <= 7 && !lastPs.includes(got.p)) {
          if (leg.q === got.p) {
            if (++leg.n >= 3) {
              out.push({ f: leg.f, p: got.p, ps: got.ps, hz: got.hz, conf: got.conf, legato: true });
              lastP = got.p;
              lastPs = got.ps;
              lastOn = leg.f;
              leg = { q: null, f: 0, n: 0 };
            }
          } else leg = { q: got.p, f: fr - WIN, n: 1 };
        } else leg = { q: null, f: 0, n: 0 };
      }
    }
    next = frame0 + samples.length;
    return out.slice();
  }
  return { push, reset, sr };
}

// The periods YIN's cumulative mean normalised difference dips at (input/pitch.js yin, at half rate), deepest first, as
// MIDI pitches: [p, ...]. A dip is a local minimum under 0.35.
const DIPS = new Map();
function dips(buf, sr, lo, hi) {
  const N = buf.length >> 1,
    s = sr / 2,
    W = N >> 1;
  const maxT = Math.min(W - 2, Math.floor(s / lo)),
    minT = Math.max(2, Math.floor(s / hi));
  if (maxT <= minT + 2) return [];
  let sc = DIPS.get(N);
  if (!sc) {
    sc = { x: new Float32Array(N), d: new Float32Array(W) };
    DIPS.set(N, sc);
  }
  const x = sc.x,
    d = sc.d;
  for (let i = 0; i < N; i++) x[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
  let sum = 0;
  d[0] = 1;
  for (let t = 1; t <= maxT + 1; t++) {
    let a = 0;
    for (let i = 0; i < W; i++) {
      const v = x[i] - x[i + t];
      a += v * v;
    }
    sum += a;
    d[t] = sum > 0 ? (a * t) / sum : 1;
  }
  const found = [];
  for (let t = minT; t <= maxT; t++) {
    if (!(d[t] < 0.35 && d[t] <= d[t - 1] && d[t] <= d[t + 1])) continue;
    const den = d[t - 1] - 2 * d[t] + d[t + 1];
    const T = t + (den > 0 ? (d[t - 1] - d[t + 1]) / (2 * den) : 0);
    found.push({ p: Math.round(ftom(s / T)), d: d[t] });
  }
  return found.sort((a, b) => a.d - b.d).map((x) => x.p);
}
