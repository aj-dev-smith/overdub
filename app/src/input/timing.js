// Playing in time is hard; this makes it forgiving. Pure (Node and the browser): nothing here touches the song.
//
// Two jobs, both about what the person meant rather than where their hand landed:
//
// 1. Against the click (a take with R): each hit or sung note goes to the nearest eighth when it is near one, else to
//    the nearest sixteenth, else (a hum) it keeps its timing. A beginner who is 80 ms late on a beat at 120 BPM is on
//    the beat; a sixteenth pickup played on purpose stays a sixteenth.
//      snapGentle(beat, { coarse = 0.5, fine = 0.25, tol = 0.35, fineTol = 0.5 }) -> beat
//      tightness(level) -> 0..1          'tight' 1, 'loose' 0.5, 'played' 0 (the take's timing control, ui/sketch.js)
//      blend(raw, tight, s) -> beat      as played (s 0) to tight (s 1)
//
// 2. In free time (no click, nothing in the song to play along to): the grid follows the human. The pulse is found in
//    the onsets themselves: the tatum is the period whose lattice they all sit on best (preferring steps in twos), each
//    onset is counted on it with the tempo tracked as it drifts and counted again against a curve through the whole
//    take, the first onset is the downbeat, and the song's beats are built around what was played. Measured on
//    simulated playing in input-test (jittered, drifting and rushed taps, a hum with sloppy onsets).
//      findPulse(seconds[], { lo = 60, hi = 180, prefer = 105, halves = true, minTatum = 0.09, snap }) ->
//        { bpm, sub, tatum, k[], moments[], beats[], raw[], beatOf(t), rawOf(t), fit, drift } | null (under 3 moments)
//        k: each moment's step on the count (halves for a lone note squarely between two; quarters on a count in
//        quarters), sub: steps a beat, beats / beatOf: tidy beats from the downbeat, raw / rawOf: where each fell by the
//        fitted line (as played), fit: 0..1 how well a steady pulse explains them, drift: the tempo's change, in %
//      fitHits(hits [{ t (s), p, v }], { bpb, grid }) -> { bpm, notes [{ p, t, d, v, raw }], bars, fit, drift, sub } | null
//      fitSegs(segs [{ t0, t1, ... }], opts) -> { bpm, starts[], ends[], raws[], fit, drift, sub } | null   (a hum's notes:
//        no tatum under 200 ms, no half steps; ends as long as they were sung, run on to the next note when nearly legato)
//
// Mixed with the song when the song has something in it already: the human's beats become the song's beats (the
// phrase plays at the song's tempo, its rhythm intact), which ui/sketch.js says ("you played at 88").

const r4 = (x) => Math.round(x * 10000) / 10000;

export function snapGentle(b, { coarse = 0.5, fine = 0.25, tol = 0.35, fineTol = 0.5 } = {}) {
  if (!Number.isFinite(b)) return b;
  const c = Math.round(b / coarse) * coarse;
  if (Math.abs(b - c) <= tol * coarse + 1e-9) return r4(c);
  const f = Math.round(b / fine) * fine;
  if (Math.abs(b - f) <= fineTol * fine + 1e-9) return r4(f);
  return Math.round(b * 64) / 64;
}

// A steady lean (against the click): the player who waits to hear the click and then hits is late by the same 100 to
// 200 ms every time; one who rushes is early by as much. Past the gentle grid's reach (0.175 beat) every hit goes to
// the wrong eighth, all of them the same way. The lean is the one offset the whole take shares, found in what was
// played and taken out before snapping. A drum whose hits keep one place in the beat (kick and snare on the beats, a
// hum's notes) is measured against the beat, so a lean up to 0.4 beat (200 ms at 120) comes out: of the drums that do,
// the ones that agree, the kick counting most and the snare next (they carry the beat; hats on the "and"s keep their
// own place). With none, the take is measured against the eighth, up to 0.2 beat. The circular mean finds where the
// hits sit, the median of what is left steadies it (a nervous first two hits don't move the rest). Under 0.08 beat
// (40 ms at 120) it is none: the gentle grid has that.
//   hits: [{ p, b }] (b: where each was played, in beats; p a drum's note, any one value for a hum)
//   -> { lean (beats, + late), by: 'beat' | 'eighth' | null, n }
const WEIGHT = { 35: 3, 36: 3, 38: 2, 40: 2 };   // (the kick most of all: it is on the 1)
const circ = (bs, P) => {
  let C = 0, S = 0;
  for (const b of bs) { C += Math.cos((2 * Math.PI * b) / P); S += Math.sin((2 * Math.PI * b) / P); }
  return { m: (Math.atan2(S, C) / (2 * Math.PI)) * P, R: Math.hypot(C, S) / (bs.length || 1) };
};
const wrapP = (x, P) => x - P * Math.round(x / P);
export function leanOf(hits, { min = 0.08 } = {}) {
  const hs = (hits || []).filter((x) => Number.isFinite(x.b));
  const none = { lean: 0, by: null, n: hs.length };
  if (hs.length < 3) return none;
  // each drum that keeps one place in the beat: 4 hits or more, 70% of them within 0.2 beat of where they sit
  const by = new Map();
  for (const x of hs) { if (!by.has(x.p)) by.set(x.p, []); by.get(x.p).push(x.b); }
  const locked = [];
  for (const [p, bs] of by) {
    if (bs.length < 4) continue;
    const { m } = circ(bs, 1);
    if (bs.filter((b) => Math.abs(wrapP(b - m, 1)) <= 0.2).length / bs.length >= 0.7) locked.push({ p, m, bs, w: bs.length * (WEIGHT[p] || 1) });
  }
  // the ones that agree (within 0.2 beat), the heaviest group; a tie to the one nearest the beat
  let best = null;
  for (const a of locked) {
    const g = locked.filter((x) => Math.abs(wrapP(x.m - a.m, 1)) <= 0.2);
    const w = g.reduce((s, x) => s + x.w, 0), bs = g.flatMap((x) => x.bs), m = circ(bs, 1).m;
    if (!best || w > best.w + 1e-9 || (Math.abs(w - best.w) < 1e-9 && Math.abs(m) < Math.abs(best.m))) best = { w, bs, m };
  }
  let P = 0, bs = null, m = 0;
  if (best && best.bs.length >= 4) { P = 1; bs = best.bs; m = best.m; }
  else if (hs.length >= 4) { const c = circ(hs.map((x) => x.b), 0.5); if (c.R >= 0.7) { P = 0.5; bs = hs.map((x) => x.b); m = c.m; } }
  if (!P) return none;
  const res = bs.map((b) => wrapP(b - m, P)).sort((x, y) => x - y);
  const med = res.length % 2 ? res[(res.length - 1) / 2] : (res[res.length / 2 - 1] + res[res.length / 2]) / 2;
  const lean = wrapP(m + med, P);
  if (Math.abs(lean) < min || Math.abs(lean) > (P === 1 ? 0.4 : 0.2) + 1e-9) return none;
  return { lean: r4(lean), by: P === 1 ? 'beat' : 'eighth', n: hs.length };
}

// Where each hit of a take goes, against the click: its lean out (leanOf), then the gentle grid. And a nervous start:
// the take's first hits, in its first two beats and before any lands on a beat, that sit 0.25 to 0.5 beat after a
// beat (late coming in, not an "and" played on purpose), on a drum whose other hits are on the beat, go to that beat.
//   hits: [{ p, b }] -> { lean, by, t: [beat] (in the hits' order), opening: how many the nervous-start rule moved }
//   snap: snapGentle's options; from: the beat the take came in on (a pickup before it is never moved); opening: false
//   leaves the first hits be (a hum: a phrase may well start on the "and")
export function placeTake(hits, snap = {}, { from = -Infinity, opening: open = true } = {}) {
  const L = leanOf(hits);
  const xs = hits.map((h) => h.b - L.lean);
  const t = xs.map((x) => snapGentle(x, snap));
  const order = hits.map((h, i) => i).sort((i, j) => xs[i] - xs[j]);
  const tol = (snap.tol ?? 0.35) * (snap.coarse ?? 0.5);
  const onBeat = (x) => Math.abs(x - Math.round(x)) <= tol + 1e-9;
  const share = new Map();
  hits.forEach((h, i) => { const s = share.get(h.p) || { n: 0, on: 0 }; s.n++; if (onBeat(xs[i])) s.on++; share.set(h.p, s); });
  const first = Number.isFinite(from) ? from : xs[order[0]] ?? 0;
  let opening = 0;
  for (const i of open ? order : []) {
    const x = xs[i], f = x - Math.floor(x), s = share.get(hits[i].p);
    if (onBeat(x) || x >= first + 2) break;     // (the first on a beat: the take has come in)
    if (x >= first - 1e-9 && s.n >= 3 && (s.on / (s.n - 1)) >= 0.7 && f >= 0.25 - 1e-9 && f <= 0.5 + 1e-9) { t[i] = r4(Math.floor(x)); opening++; }
  }
  return { lean: L.lean, by: L.by, t, opening };
}

export const LEVELS = ['tight', 'loose', 'played'];
export function tightness(level) { return level === 'loose' ? 0.5 : level === 'played' ? 0 : 1; }
export function blend(raw, tight, s) { return r4(raw + (tight - raw) * s); }

// Onsets within 40 ms are one moment (a kick and a hat struck together): the pulse is found from moments.
function moments(ts) {
  const t = ts.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const out = [];
  for (const x of t) if (!out.length || x - out[out.length - 1] > 0.04) out.push(x);
  return out;
}

export function findPulse(ts, { lo = 60, hi = 180, prefer = 105, halves = true, minTatum = 0.09, snap = {} } = {}) {
  const m = moments(ts);
  if (m.length < 3) return null;
  // (a gap under 90 ms is a flam, not a step: it says nothing about the tatum)
  const iois = [];
  for (let i = 1; i < m.length; i++) if (m[i] - m[i - 1] >= 0.09) iois.push(m[i] - m[i - 1]);
  if (iois.length < 2) return null;
  // the tatum: the period whose lattice the onsets sit on best, every onset at once (not gap by gap: a gap carries two
  // onsets' slop). For each period: count the onsets on it from the first, fit the line through them (its place and
  // its slope, so a drifting tempo still fits), count again; how near each onset sits to its step, in steps (the same
  // slop is more of a smaller step, so half the tatum scores lower), with a nudge towards steps of 1, 2 and 4 between
  // onsets over 3s and 5s (people play and hum in twos), and a near tie going to the longer period
  const SIG = 0.16;
  const lattice = (T) => {
    let ic = m[0], sl = T, k = m.map((t) => Math.round((t - ic) / sl));
    for (let it = 0; it < 2; it++) {
      const n = k.length, mk = k.reduce((x, y) => x + y, 0) / n, mt = m.reduce((x, y) => x + y, 0) / n;
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (k[i] - mk) * (m[i] - mt); sxx += (k[i] - mk) ** 2; }
      if (sxx > 0) sl = Math.max(T * 0.9, Math.min(T * 1.1, sxy / sxx));
      ic = mt - sl * mk;
      k = m.map((t) => Math.round((t - ic) / sl));
    }
    let s = 0;
    for (let i = 0; i < m.length; i++) {
      const r = (m[i] - ic - sl * k[i]) / sl;
      let w = Math.exp(-(r * r) / (2 * SIG * SIG));
      if (i) { const st = k[i] - k[i - 1]; if (st === 0 && m[i] - m[i - 1] > 0.09) w *= 0.05; else if (st === 3 || st === 6) w *= 0.75; else if (st === 5 || st === 7) w *= 0.6; else if (st > 8) w *= 0.7; }
      s += w;
    }
    return { s: s / m.length, k: k.map((x) => x - k[0]) };
  };
  let best = null;
  for (let T = minTatum; T <= 1.25; T += 0.002) {
    const L = lattice(T), s = L.s * (1 + 0.03 * Math.log2(T / 0.09));
    if (!best || s > best.s) best = { T, s, k: L.k };
  }
  // refined: each gap that counts cleanly gives its own step; their mean is the tatum
  let num = 0, den = 0;
  for (const g of iois) { const x = g / best.T, n = Math.round(x); if (n >= 1 && Math.abs(x - n) < 0.25) { num += g; den += n; } }
  const T = den ? num / den : best.T;
  // each onset counted on the tatum: where the line through the last few onsets says the next steps fall (so one
  // onset's jitter is all that can mislead it, never a gap's, which is two onsets' worth), the tempo tracked as it
  // drifts; one half way between two steps is a half step (a lone sixteenth between eighths), so one quick note never
  // pushes everything after it a step late; one a hair after the last is the same moment (a flam)
  const halfStep = (x) => halves && Math.abs(x - Math.floor(x) - 0.5) < 0.12;
  // (a count in quarters, 350 ms or more a step: a sixteenth is a quarter step, squarely there)
  const quarterStep = (x) => { if (!halves || T < 0.35) return null; const f = x - Math.floor(x); return Math.abs(f - 0.25) < 0.1 ? 0.25 : Math.abs(f - 0.75) < 0.1 ? 0.75 : null; };
  // (two moments played apart are never one step: the later goes on by the smallest step the count allows)
  const minStep = !halves ? 1 : T >= 0.35 ? 0.25 : 0.5;
  const kA = [0];
  for (let i = 1, k = kA; i < m.length; i++) {
    const j0 = Math.max(0, i - 8);
    let sl = T, ic = m[i - 1] - T * k[i - 1];
    // (a few onsets in, the slope is the tatum and only the line's place is fitted; past six, the slope too, so a
    // drifting tempo is followed)
    const ks = k.slice(j0, i), ms = m.slice(j0, i), mk = ks.reduce((a, b) => a + b, 0) / ks.length, mt = ms.reduce((a, b) => a + b, 0) / ms.length;
    if (ks.length >= 6) {
      let sxy = 0, sxx = 0;
      for (let q = 0; q < ks.length; q++) { sxy += (ks[q] - mk) * (ms[q] - mt); sxx += (ks[q] - mk) ** 2; }
      if (sxx > 0) sl = Math.max(T * 0.85, Math.min(T * 1.18, sxy / sxx));
    }
    ic = mt - sl * mk;
    const x = (m[i] - ic) / sl, last = k[i - 1];
    let kk;
    if (x - last < 0.3 && m[i] - m[i - 1] < 0.12) kk = last;
    else if (halfStep(x)) kk = Math.floor(x) + 0.5;   // (squarely between: a half step)
    else if (quarterStep(x) != null) kk = Math.floor(x) + quarterStep(x);
    else kk = Math.round(x);
    k.push(kk > last ? kk : m[i] - m[i - 1] < 0.12 ? last : last + minStep);
  }
  // a second look with the whole take in view: a curve through every (k, t) (a tempo that drifts evenly), and each
  // onset counted again against it, so an early onset the first few points misjudged is put right. Done for the count
  // made onset by onset and for the lattice's own (whole-take) count; the one the curve fits better stays (a few
  // sloppy notes can mislead the first, a tempo that drifts far the second)
  // (the curves and the line go through the moments on whole steps: a pickup a sixteenth early would bend them)
  const onWhole = (k) => { const ix = k.map((x, i) => i).filter((i) => k[i] % 1 === 0); return ix.length >= 3 ? ix : k.map((x, i) => i); };
  const quadOf = (k) => { const ix = onWhole(k); return quad(ix.map((i) => k[i]), ix.map((i) => m[i])); };
  const settle = (k0) => {
    const k = k0.slice();
    const curve = quadOf(k);
    if (curve) {
      for (let i = 1; i < m.length; i++) {
        const sl = curve.b + 2 * curve.c * k[i];
        if (!(sl > 0)) continue;
        const x = k[i] + (m[i] - (curve.a + curve.b * k[i] + curve.c * k[i] * k[i])) / sl, last = k[i - 1];
        let kk;
        if (x - last < 0.3 && m[i] - m[i - 1] < 0.12) kk = last;
        else if (halfStep(x)) kk = Math.floor(x) + 0.5;
        else if (quarterStep(x) != null) kk = Math.floor(x) + quarterStep(x);
        else kk = Math.round(x);
        k[i] = kk > last ? kk : m[i] - m[i - 1] < 0.12 ? last : last + minStep;
      }
    }
    const c2 = quadOf(k) || null;
    let e = 0;
    for (let i = 0; i < m.length; i++) { const sl = c2 ? c2.b + 2 * c2.c * k[i] : T; const pr = c2 ? c2.a + c2.b * k[i] + c2.c * k[i] * k[i] : m[0] + T * k[i]; e += ((m[i] - pr) / (sl > 0 ? sl : T)) ** 2; }
    const halfs = k.filter((x) => x % 1).length;
    return { k, e: Math.sqrt(e / m.length) + 0.04 * halfs };
  };
  const A = settle(kA), B = settle(best.k);
  const k = (B.e < A.e - 1e-9 ? B : A).k;
  // a straight line through (k, t): its slope is the average tatum, its curve the drift
  const n = k.length, wi = onWhole(k), mk = wi.reduce((a, i) => a + k[i], 0) / wi.length, mt = wi.reduce((a, i) => a + m[i], 0) / wi.length;
  let sxy = 0, sxx = 0;
  for (const i of wi) { sxy += (k[i] - mk) * (m[i] - mt); sxx += (k[i] - mk) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : T, icpt = mt - slope * mk;
  // the beat: 1, 2 or 4 tatums, whichever tempo is in range and nearest a comfortable one
  let sub = 1, bd = Infinity;
  for (const s of [1, 2, 4]) {
    const bpm = 60 / (slope * s);
    if (bpm < lo - 1e-9 || bpm > hi + 1e-9) continue;
    const d = Math.abs(Math.log2(bpm / prefer));
    if (d < bd) { bd = d; sub = s; }
  }
  if (!Number.isFinite(bd)) sub = 60 / slope > hi ? 4 : 1;
  const bpm = 60 / (slope * sub);
  // how well a steady pulse explains it: the residuals against the line, in tatums
  let res = 0;
  for (let i = 0; i < n; i++) res += ((m[i] - (icpt + slope * k[i])) / slope) ** 2;
  const fit = Math.max(0, Math.min(1, 1 - Math.sqrt(res / n) / 0.35));
  // drift: the tempo of the second half against the first, from the local steps
  const half = Math.floor(n / 2);
  const rate = (a, b) => (k[b] > k[a] ? (m[b] - m[a]) / (k[b] - k[a]) : slope);
  const drift = n >= 6 ? Math.round((rate(0, half) / rate(half, n - 1) - 1) * 1000) / 10 : 0;
  // where each moment falls: its step on the count (the first moment is the downbeat). Two moments the count put on
  // one step though they were played apart (a sixteenth pickup just before a kick on a count in quarters) are read
  // off the take's own tempo map instead, the count's curve (the tempo as it drifted), and snapped gently: an eighth
  // when near one, else a sixteenth.
  const shared = (i) => (i > 0 && k[i] === k[i - 1] && m[i] - m[i - 1] > 0.09) || (i < m.length - 1 && k[i] === k[i + 1] && m[i + 1] - m[i] > 0.09);
  const clean = m.map((_, i) => i).filter((i) => !shared(i));
  const cw = clean.filter((i) => k[i] % 1 === 0), cu = cw.length >= 6 ? cw : clean;
  const curve = quad(cu.map((i) => k[i]), cu.map((i) => m[i]));
  const kAt = (t) => {
    if (curve && Math.abs(curve.c) > 1e-12) {
      const A = curve.c, B = curve.b, C = curve.a - t, D = B * B - 4 * A * C;
      if (D >= 0) { const r1 = (-B + Math.sqrt(D)) / (2 * A), r2 = (-B - Math.sqrt(D)) / (2 * A), kl = (t - icpt) / slope; return Math.abs(r1 - kl) < Math.abs(r2 - kl) ? r1 : r2; }
    }
    return curve ? (t - curve.a) / curve.b : (t - icpt) / slope;
  };
  const k0 = kAt(m[0]);
  const tidy = (t) => {
    const i = m.indexOf(t);
    if (i >= 0 && !shared(i)) return r4(k[i] / sub);
    return snapGentle((kAt(t) - k0) / sub, { coarse: 0.5, fine: 0.25, tol: 0.35, fineTol: 0.5, ...snap });
  };
  // every original onset (not only the moments): its moment's place
  const momentOf = (t) => { let j = 0; for (let i = 0; i < m.length; i++) if (Math.abs(m[i] - t) <= Math.abs(m[j] - t)) j = i; return m[j]; };
  const t0 = icpt;   // (the fitted downbeat: the first moment as the line puts it)
  return {
    bpm: Math.round(bpm * 10) / 10, sub, tatum: slope, fit: Math.round(fit * 100) / 100, drift,
    moments: m, k,
    beatOf: (t) => tidy(momentOf(t)),                        // tidy: on the take's own beats
    rawOf: (t) => r4((t - t0) / (slope * sub)),              // as played: by the line
    beats: m.map((t) => tidy(t)), raw: m.map((t) => r4((t - t0) / (slope * sub))),
  };
}

// Tapped hits in free time -> drum notes on the human's own beats. hits: [{ t (s), p (GM note), v }] in any order.
//   -> { bpm, notes: [{ p, t, d, v, raw }], bars, fit, drift, sub } | null (fewer than 3 moments: no pulse to find)
export function fitHits(hits, { bpb = 4, grid = 0.25, ...o } = {}) {
  const pl = findPulse(hits.map((h) => h.t), o);
  if (!pl) return null;
  const seen = new Map();
  for (const h of hits) {
    const t = snapGentle(pl.beatOf(h.t), { coarse: 0.5, fine: grid });
    const k = h.p + '@' + t;
    if (!seen.has(k) || seen.get(k).v < h.v) seen.set(k, { p: h.p, t, d: grid, v: Math.round((h.v ?? 0.8) * 100) / 100, raw: pl.rawOf(h.t) });
  }
  const notes = [...seen.values()].sort((a, b) => a.t - b.t || a.p - b.p);
  const end = Math.max(...notes.map((x) => x.t + x.d));
  return { bpm: pl.bpm, notes, bars: Math.max(1, Math.ceil(end / bpb - 1e-9)), fit: pl.fit, drift: pl.drift, sub: pl.sub };
}

// A hum's notes in free time: each note's start on the human's count, its end as long as it was sung (in the local
// beat), tidied gently (an eighth when near one, else as sung) and run on to the next note when the gap is under a
// sixteenth (sung legato). segs: [{ t0, t1 }] (seconds).
//   -> { bpm, starts[], ends[], raws[], fit, drift } | null
export function fitSegs(segs, o = {}) {
  // (a hummed tune moves in eighths at the quickest, and a lone sixteenth is more often a sloppy eighth: no tatum under
  // 200 ms. A hum's onsets are soft, so 60 ms of slop is common, and on two eighths that can make a gap of 190 ms: the
  // count that fits those gaps closest can be 75 BPM in sixteenths when 120 in eighths was sung. So a few counts are
  // read (the quickest tatum without half steps, a slower one with them), each two ways (its own steps, and where its
  // line puts each onset snapped gently, an eighth when near one), and the one kept is the one whose notes sit nearest
  // where they were sung (in seconds, over 40 ms), with a sixteenth costing as much as 40 ms more, a note out of order
  // five times that, and a tempo far from 100 a little.)
  const ts = segs.map((s) => s.t0);
  let best = null;
  for (const [minTatum, halves] of [[0.2, false], [0.3, true], [0.2, true]]) {
    const pl = findPulse(ts, { minTatum, halves, ...o });
    if (!pl) continue;
    const spb = pl.tatum * pl.sub;
    for (const beats of [pl.beats.slice(), pl.raw.map((x) => snapGentle(x, { coarse: 0.5, fine: 0.25, tol: 0.35, fineTol: 0.5 }))]) {
      let e = 0, six = 0, back = 0;
      beats.forEach((x, i) => { e += ((pl.raw[i] - x) * spb) ** 2; if (Math.abs(x * 2 - Math.round(x * 2)) > 1e-6) six++; if (i && x <= beats[i - 1] + 1e-9 && ts[i] - ts[i - 1] > 0.09) back++; });
      const score = Math.sqrt(e / beats.length) / 0.04 + six + 5 * back + 0.5 * Math.abs(Math.log2(pl.bpm / 100));
      if (!best || score < best.score - 1e-9) best = { pl, beats, score };
    }
  }
  if (!best) return null;
  const { pl } = best, spbeat = pl.tatum * pl.sub;
  // (each onset's beat: a moment's, so notes sung together share it)
  const starts = segs.map((s) => best.beats[pl.moments.indexOf(pl.moments.reduce((m, x) => (Math.abs(x - s.t0) < Math.abs(m - s.t0) ? x : m), pl.moments[0]))]);
  const ends = segs.map((s, i) => {
    const e0 = starts[i] + (s.t1 - s.t0) / spbeat;
    let e = snapGentle(e0, { coarse: 0.5, fine: 0.25, tol: 0.4, fineTol: 0.5 });
    if (e - starts[i] < 0.25) e = starts[i] + 0.25;
    const next = starts.slice(i + 1).find((x) => x > starts[i] + 1e-9);
    if (next != null && (e > next || next - e < 0.25 + 1e-9)) e = next;
    return r4(e);
  });
  return { bpm: pl.bpm, starts, ends, raws: segs.map((s) => pl.rawOf(s.t0)), fit: pl.fit, drift: pl.drift, sub: pl.sub };
}

// least squares t = a + b k + c k² (null under 6 points or a degenerate spread)
function quad(k, t) {
  const n = k.length;
  if (n < 6) return null;
  let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) { const x = k[i], x2 = x * x; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2; y0 += t[i]; y1 += x * t[i]; y2 += x2 * t[i]; }
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const A = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]], D = det(A);
  if (!(Math.abs(D) > 1e-9)) return null;
  const col = (j, v) => A.map((r, i) => r.map((x, q) => (q === j ? v[i] : x)));
  const Y = [y0, y1, y2];
  return { a: det(col(0, Y)) / D, b: det(col(1, Y)) / D, c: det(col(2, Y)) / D };
}
