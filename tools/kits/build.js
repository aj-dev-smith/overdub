// The melodic-kit builder for recipes that lay out their own regions (tools/kits/<name>.js: a `regions` list instead
// of an upstream SFZ, for sources whose SFZ leans on ARIA opcodes, or that have none). tools/fetch-kits.js calls it;
// Parlour Upright keeps its own SFZ path there (its kit is pinned byte for byte). Integer arithmetic on the samples and
// a fixed order throughout, so the same upstream bytes always build the same .odk.
//
// What a recipe gives (beyond the pins every recipe has: repo, commit, licenceFile, docs, files):
//   sr                 the source's rate; every file must be at it (the kit keeps it: the kernel resamples anyway)
//   channels           2, or 1: the mid, (L + R) / 2, rounded
//   regions            [{ file, key, lo, hi, vlo, vhi, layer, rr?, trig?, tune? }]: layer is the velocity layer's index
//                      (0 the softest), for the QA and the levels
//   cut                { db | rel, cap: [[upToKey, seconds], ...], fade }: each sample ends at the first 100 ms after
//                      its loudest whose RMS is under `db` dBFS (24-bit scale, either channel) or `rel` dB under its
//                      own attack, or `cap(key)` seconds after its onset, whichever is sooner, then fades out over
//                      `fade` seconds, squared (so the cut reads as a faster decay, not an edit); a sample that reaches
//                      neither keeps its recording, cut after its last 20 ms over -70 dBFS and faded over 10 ms
//   head               dB under the peak where a sample's start sits (2 ms before it first gets there; default -20, as
//                      the drum kit); a slow attack (a bow) wants it low, so the start isn't late
//   loop               { from, min, max?, by?, xfade } | { file: true }: seconds. A sustain loop for every attack sample, starting at
//                      least `from` after the onset and ending by `by`: the search (the 100 ms before the loop's end
//                      against the 100 ms before its start, on a 20 ms grid, then to the frame), its
//                      crossfade baked into the samples (linear, integers), the sample cut at the loop's end. file: the
//                      loop the recording carries in its smpl chunk, as its author made it (nothing searched or baked)
//   level              { mode: 'key' | 'flat', measure: 'attack' | 'body' }: the gain each sample gets. 'key': every
//                      layer of a key moves by the same dB, onto one quadratic across the keys through the top layer's
//                      levels (the layers keep their recorded distance: the source has its dynamics). 'flat': each
//                      sample onto that curve (a normalized source: the velocity curve makes the dynamics).
//                      'attack' measures the 150 ms from the onset, 'body' the second after the first 0.3 s, 'loop'
//                      the sustain loop (a looped sample's steady level); across: 'even' sets every key to one level
//                      instead of the quadratic (an ensemble whose sections were recorded at different gains)
//   tune               'measure': a sample read 5 to 25 cents off its note (both windows agreeing) gets a `tune`
//                      that puts it back; otherwise each region's own `tune`, if any
//   align              true: each layer's start lined up with the next layer up of its key (and `align` kept), for
//                      the kernel's 'aligned' crossfade
//   meta               merged into the kit's meta (velcurve, env, rt ...)
import { decodeFlac } from '../flac.js';
import { encodeOdk } from '../../app/src/kernel/odk.js';
import { qaSample, qaInstrument, pitchAt } from './qa.js';

// A RIFF WAVE file's samples as integers: { sr, bits, frames, channels: [Int32Array, ...], loops: [{ s, e }] }. 16- and
// 24-bit PCM; 32-bit float is rounded onto the 24-bit scale (bits 24). loops: the `smpl` chunk's, if any (e exclusive).
export function decodeWavInt(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a WAVE file');
  let o = 12,
    fmt = null,
    data = null;
  const loops = [];
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4),
      size = buf.readUInt32LE(o + 4);
    // (WAVE_FORMAT_EXTENSIBLE carries the real format in the first two bytes of its sub-format GUID)
    if (id === 'fmt ') {
      const t = buf.readUInt16LE(o + 8);
      fmt = {
        tag: t === 0xfffe && size >= 26 ? buf.readUInt16LE(o + 32) : t,
        nc: buf.readUInt16LE(o + 10),
        sr: buf.readUInt32LE(o + 12),
        bits: buf.readUInt16LE(o + 22),
      };
    }
    if (id === 'data') data = buf.subarray(o + 8, Math.min(buf.length, o + 8 + size));
    // the sampler chunk's loops (the recording's own sustain loops: start and end frames, the end inclusive)
    if (id === 'smpl' && size >= 36) {
      const nl = buf.readUInt32LE(o + 8 + 28);
      for (let k = 0; k < nl && o + 8 + 36 + 24 * (k + 1) <= buf.length; k++) {
        const q = o + 8 + 36 + 24 * k;
        loops.push({ s: buf.readUInt32LE(q + 8), e: buf.readUInt32LE(q + 12) + 1 });
      }
    }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAVE: no fmt or data chunk');
  const float = fmt.tag === 3;
  if (fmt.tag !== 1 && !float) throw new Error(`WAVE: format ${fmt.tag} isn't PCM or float`);
  const bps = fmt.bits / 8,
    n = Math.floor(data.length / (bps * fmt.nc));
  const ch = Array.from({ length: fmt.nc }, () => new Int32Array(n));
  for (let i = 0, p = 0; i < n; i++) {
    for (let c = 0; c < fmt.nc; c++, p += bps) {
      let v;
      if (float && fmt.bits === 32)
        v = Math.max(-8388608, Math.min(8388607, Math.round(data.readFloatLE(p) * 8388608)));
      else if (fmt.bits === 16) v = data.readInt16LE(p);
      else if (fmt.bits === 24) v = data.readIntLE(p, 3);
      else throw new Error(`WAVE: ${fmt.bits}-bit ${float ? 'float' : 'PCM'} isn't read here`);
      ch[c][i] = v;
    }
  }
  return { sr: fmt.sr, bits: float ? 24 : fmt.bits, frames: n, channels: ch, loops };
}

const decode = (file, b) => (/\.flac$/i.test(file) ? decodeFlac(b) : decodeWavInt(b));

// y ~ a + b x + c x^2, least squares, as fetch-kits.js fits Parlour Upright
export function quadFit(xs, ys) {
  let n = 0,
    sx = 0,
    sx2 = 0,
    sx3 = 0,
    sx4 = 0,
    sy = 0,
    sxy = 0,
    sx2y = 0;
  xs.forEach((x0, i) => {
    const x = (x0 - 64) / 32,
      y = ys[i];
    n++;
    sx += x;
    sx2 += x * x;
    sx3 += x ** 3;
    sx4 += x ** 4;
    sy += y;
    sxy += x * y;
    sx2y += x * x * y;
  });
  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [
      [n, sx, sx2],
      [sx, sx2, sx3],
      [sx2, sx3, sx4],
    ],
    D = det3(M),
    Y = [sy, sxy, sx2y];
  if (n < 3 || Math.abs(D) < 1e-9) {
    const m = sy / Math.max(1, n);
    return () => m;
  }
  const col = (k) => det3(M.map((row, i) => row.map((v, j) => (j === k ? Y[i] : v)))) / D;
  const a = col(0),
    b = col(1),
    c = col(2);
  return (x0) => {
    const x = (x0 - 64) / 32;
    return a + b * x + c * x * x;
  };
}

// the first frame within `db` dB of the peak (either channel)
function onsetOf(L, R, n, db) {
  let pk = 0;
  for (let i = 0; i < n; i++) {
    const a = L[i] < 0 ? -L[i] : L[i],
      b = R[i] < 0 ? -R[i] : R[i];
    if (a > pk) pk = a;
    if (b > pk) pk = b;
  }
  const lim = pk * Math.pow(10, db / 20);
  let on = 0;
  while (on < n && Math.abs(L[on]) < lim && Math.abs(R[on]) < lim) on++;
  return on;
}

// RMS level, dB on a 24-bit scale, of x[a .. b) (both channels' mean power)
function rmsDb(L, R, a, b) {
  let e = 0;
  for (let i = a; i < b; i++) e += (L[i] * L[i] + R[i] * R[i]) / 2;
  return 20 * Math.log10(Math.sqrt(e / Math.max(1, b - a)) / 8388608 + 1e-12);
}

// where the cut falls: [end, fade frames] (fade 0: the recording's own end)
function cutAt(L, R, n, sr, on, key, cut) {
  const W = Math.round(0.02 * sr),
    K = 5; // 20 ms windows, 100 ms of them
  // the threshold: `db` dBFS, or `rel` dB under the sample's own attack (the RMS of the 150 ms from its onset)
  const db = cut.rel != null ? rmsDb(L, R, on, Math.min(n, on + Math.round(0.15 * sr))) + cut.rel : cut.db;
  const T = 8388608 * Math.pow(10, db / 20),
    T2 = T * T * W * K;
  // from the loudest 100 ms on: a note swells before it decays (a bow, a pad), so the search starts at its peak
  const nw = Math.floor((n - on) / W);
  const eL = new Float64Array(nw),
    eR = new Float64Array(nw);
  for (let w = 0; w < nw; w++) {
    let a = 0,
      b = 0;
    for (let i = on + w * W, e = i + W; i < e; i++) {
      a += L[i] * L[i];
      b += R[i] * R[i];
    }
    eL[w] = a;
    eR[w] = b;
  }
  let best = 0,
    bw = 0;
  for (let w = 0; w + K <= nw; w++) {
    let s = 0;
    for (let k = 0; k < K; k++) s += eL[w + k] + eR[w + k];
    if (s > best) {
      best = s;
      bw = w;
    }
  }
  let end = 0;
  for (let w = bw; w + K <= nw && !end; w++) {
    let a = 0,
      b = 0;
    for (let k = 0; k < K; k++) {
      a += eL[w + k];
      b += eR[w + k];
    }
    if (a < T2 && b < T2) end = on + (w + K) * W;
  }
  let capS = Infinity;
  for (const [upTo, s] of cut.cap || [])
    if (key <= upTo) {
      capS = s;
      break;
    }
  const capEnd = Number.isFinite(capS) ? on + Math.round(capS * sr) : Infinity;
  if (!end && capEnd >= n) {
    // neither: the recording's own end, after its last 20 ms window at or above -70 dBFS (as the drum kit)
    const T70 = 2653 * 2653 * W;
    for (let a = Math.floor(n / W) * W; a >= 0; a -= W) {
      let el = 0,
        er = 0;
      for (let i = a; i < Math.min(n, a + W); i++) {
        el += L[i] * L[i];
        er += R[i] * R[i];
      }
      if (el >= T70 || er >= T70)
        return [Math.min(n, a + W), Math.min(n - Math.min(n, a + W), Math.round(0.01 * sr)), 'end'];
    }
    return [n, 0, 'end'];
  }
  const e = Math.min(end || Infinity, capEnd, n);
  return [e, Math.min(e - on - 1, Math.round(cut.fade * sr)), e === capEnd ? 'cap' : 'level'];
}

// The sustain loop: the end e and start s (e - s >= min) whose 100 ms before each match best (the correlation of the
// mono sums, what a crossfade there needs), searched on a 20 ms grid, then to the frame around the best ten.
export function findLoop(L, R, n, sr, on, { from, min, max = 1e9, by = 1e9, xfade }) {
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) m[i] = L[i] + R[i];
  const W = Math.round(0.1 * sr),
    X = Math.round(xfade * sr),
    G = Math.round(0.02 * sr);
  const lo = on + Math.round(from * sr),
    MIN = Math.round(min * sr),
    MAX = Math.round(max * sr);
  // the score: the correlation of the 100 ms before each end, less 0.1 per dB the loop's last 100 ms and its first
  // differ (the level step at every pass: a loop that pulses is worse than one that blurs)
  const corr = (a, b, step) => {
    let xy = 0,
      xx = 0,
      yy = 0,
      ee = 0,
      ss = 0;
    for (let i = 0; i < W; i += step) {
      const x = m[a - W + i],
        y = m[b - W + i],
        z = m[b + i];
      xy += x * y;
      xx += x * x;
      yy += y * y;
      ss += z * z;
    }
    ee = xx;
    return xy / Math.sqrt(xx * yy || 1) - 0.1 * Math.abs(10 * Math.log10((ee || 1) / (ss || 1)));
  };
  const cands = [];
  for (let e = Math.min(n, on + Math.round(by * sr)) - G; e - MIN >= lo + Math.max(W, X); e -= G) {
    for (let s = e - MIN; s >= lo + Math.max(W, X) && e - s <= MAX; s -= G) cands.push([corr(e, s, 3), s, e]);
  }
  if (!cands.length) throw new Error('loop: the sample is too short for a loop of ' + min + ' s after ' + from + ' s');
  cands.sort((a, b) => b[0] - a[0] || b[2] - a[2] || a[1] - b[1]);
  let best = null;
  const R2 = Math.round(0.01 * sr);
  for (const [, s0, e] of cands.slice(0, 10)) {
    for (let s = s0 - R2; s <= s0 + R2; s++) {
      if (s - Math.max(W, X) < lo || e - s < MIN) continue;
      const c = corr(e, s, 1);
      if (!best || c > best[0]) best = [c, s, e];
    }
  }
  const [, s, e] = best;
  let xy = 0,
    xx = 0,
    yy = 0;
  for (let i = 0; i < W; i++) {
    const x = m[e - W + i],
      y = m[s - W + i];
    xy += x * y;
    xx += x * x;
    yy += y * y;
  }
  return { s, e, corr: xy / Math.sqrt(xx * yy || 1) };
}

// the correlation of the 100 ms before a loop's two ends (mono), as findLoop scores it, for a loop it didn't pick
function loopCorr(L, R, sr, s, e) {
  const W = Math.min(Math.round(0.1 * sr), s);
  let xy = 0,
    xx = 0,
    yy = 0;
  for (let i = 0; i < W; i++) {
    const x = L[e - W + i] + R[e - W + i],
      y = L[s - W + i] + R[s - W + i];
    xy += x * y;
    xx += x * x;
    yy += y * y;
  }
  return xy / Math.sqrt(xx * yy || 1);
}

// bake the loop's crossfade: the X frames before e fade from themselves into the X frames before s, so a jump from e
// to s is seamless. The weights keep the sum's power constant for the two ends' correlation rho (linear when they are
// alike, equal power when they are unrelated: the kernel's 'aligned' law), from + - * / and sqrt only
function bakeLoop(ch, s, e, X, rho) {
  const r = rho < 0 ? 0 : rho > 1 ? 1 : rho;
  for (const x of ch) {
    for (let i = 0; i < X; i++) {
      const p = e - X + i,
        q = s - X + i,
        b = i / X,
        a = 1 - b,
        k = 1 / Math.sqrt(a * a + b * b + 2 * a * b * r);
      x[p] = Math.round((x[p] * a + x[q] * b) * k);
    }
  }
}

// check 14 for one loop: { corr, drift (dB, the loop's first 100 ms against its last), cents (the pitch at its start
// against its end) }
function loopQa(L, R, sr, s, e, key, corr) {
  const W = Math.round(0.1 * sr);
  const drift = rmsDb(L, R, e - W, e) - rmsDb(L, R, s, s + W);
  const len = Math.min(Math.round(0.4 * sr), Math.floor((e - s) / 2));
  const mono = new Float64Array(e - s);
  for (let i = 0; i < e - s; i++) mono[i] = L[s + i] + R[s + i];
  const f0 = 440 * Math.pow(2, (key - 69) / 12);
  const a = pitchAt(mono, sr, 0, len, f0),
    b = pitchAt(mono, sr, e - s - len, len, f0);
  return {
    corr: +corr.toFixed(3),
    drift: +drift.toFixed(2),
    cents: a.edge || b.edge ? null : +(b.cents - a.cents).toFixed(1),
    seconds: +((e - s) / sr).toFixed(2),
  };
}

export async function buildInstrument(recipe, fetchFile) {
  // the licence first, then any other pinned document that has to say so
  for (const doc of [recipe.licenceFile, ...(recipe.docs || [])]) {
    const b = await fetchFile(recipe, doc.path, doc.sha256);
    if (doc.must && !doc.must.test(b.toString('utf8')))
      throw new Error(`the pinned ${doc.path} no longer says ${doc.must}`);
  }
  const C = recipe.channels || 2,
    sr = recipe.sr,
    out = [],
    rows = [];
  let inFrames = 0,
    outFrames = 0;
  for (let [n, r] of recipe.regions.entries()) {
    if (!recipe.files[r.file]) throw new Error(`the recipe maps ${r.file} without pinning it`);
    const d = decode(r.file, await fetchFile(recipe, r.file));
    if (d.sr !== sr) throw new Error(`${r.file}: ${d.sr} Hz, the kit is ${sr} Hz`);
    const N = d.frames;
    // on the 24-bit scale from here on
    const up = 1 << (24 - d.bits);
    const src = d.channels.length > 1 ? d.channels.slice(0, 2) : [d.channels[0], d.channels[0]];
    let [L, R] = src.map((x) => {
      const y = new Int32Array(N);
      for (let i = 0; i < N; i++) y[i] = x[i] * up;
      return y;
    });
    if (C === 1) {
      const M = new Int32Array(N);
      for (let i = 0; i < N; i++) M[i] = Math.round((L[i] + R[i]) / 2);
      L = M;
      R = M;
    }
    const looped = !!recipe.loop && (r.trig || 'attack') === 'attack';
    const qa = qaSample({ ch: [L, R], bits: 24, sr }, { key: r.key, looped });
    // recipe.tune 'measure': a note read off pitch by 5 to 25 cents, both windows agreeing within 3, is tuned back by
    // a `tune` field (the rubric's check 11: never by resampling); anything else is left as recorded
    if (recipe.tune === 'measure' && !r.trig) {
      const [a, b] = qa.cents;
      if (a != null && b != null && Math.abs(a - b) <= 3 && Math.abs((a + b) / 2) > 5 && Math.abs((a + b) / 2) <= 25)
        r = { ...r, tune: Math.round((-10 * (a + b)) / 2) / 10 };
    }
    // tuning is judged as it plays: the recording's cents plus the recipe's `tune` (the raw reading kept beside it)
    if (r.tune) {
      qa.centsRaw = qa.cents;
      qa.cents = qa.cents.map((c) => (c == null ? null : +(c + r.tune).toFixed(1)));
    }
    const on = onsetOf(L, R, N, recipe.head ?? -20);
    let end,
      fade = 0,
      how = 'end',
      loop;
    if (looped) {
      // (a region may move its loop: a soft layer that swells for longer loops later)
      const lp = { ...recipe.loop, ...(r.loop || {}) };
      // (lp.file: the recording's own loop, from its smpl chunk, taken as its author made it: no search, nothing baked)
      const own = lp.file && d.loops && d.loops[0];
      if (lp.file && !own) throw new Error(`${r.file}: the recipe takes the file's own loop, and it has none`);
      const f = own
        ? { s: own.s, e: Math.min(N, own.e), corr: loopCorr(L, R, sr, own.s, Math.min(N, own.e)) }
        : findLoop(L, R, N, sr, on, lp);
      qa.loop = loopQa(L, R, sr, f.s, f.e, r.key, f.corr);
      if (!own) bakeLoop([L, R].slice(0, C), f.s, f.e, Math.round(lp.xfade * sr), f.corr);
      loop = { s: f.s, e: f.e, mode: 'continuous' };
      end = f.e;
      how = 'loop';
    } else [end, fade, how] = cutAt(L, R, N, sr, on, r.key, recipe.cut || { db: -200, fade: 0.01 });
    // the level the gain is set from
    const lv =
      recipe.level && recipe.level.measure === 'loop' && loop
        ? rmsDb(L, R, loop.s, loop.e)
        : recipe.level && recipe.level.measure === 'body'
          ? rmsDb(L, R, Math.min(end - 1, on + Math.round(0.3 * sr)), Math.min(end, on + Math.round(1.3 * sr)))
          : rmsDb(L, R, on, Math.min(end, on + Math.round(0.15 * sr)));
    const ch = [L, R].slice(0, C).map((x) => {
      const y = new Int16Array(end);
      for (let i = 0; i < end; i++) {
        let v = x[i];
        // the fade: linear over the recording's own end; over a cut, squared, so it reads as a faster decay
        if (fade > 0 && i >= end - fade) {
          const u = (end - i) / (fade + 1);
          v = Math.round(how === 'end' ? v * u : v * u * u);
        }
        v = Math.round(v / 256);
        y[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
      return y;
    });
    inFrames += N;
    outFrames += end;
    const start = Math.max(0, on - Math.round(0.002 * sr));
    const id = r.id || r.file.replace(/^.*\//, '').replace(/\.(flac|wav)$/i, '');
    rows.push({
      id,
      key: r.key,
      layer: r.layer | 0,
      src: r.file,
      qa: { ...qa, attack: +lv.toFixed(2) },
      cut: how,
      seconds: +((end - start) / sr).toFixed(2),
    });
    out.push({
      id,
      key: r.key,
      lo: r.lo,
      hi: r.hi,
      vlo: r.vlo,
      vhi: r.vhi,
      ...(r.rr ? { rr: r.rr } : {}),
      ...(r.trig && r.trig !== 'attack' ? { trig: r.trig } : {}),
      ...(loop ? { loop } : {}),
      tune: r.tune || 0,
      gain: 0,
      start,
      src: r.file,
      ch,
    });
    if (process.stdout.isTTY)
      process.stdout.write(`\r  ${n + 1}/${recipe.regions.length} ${r.file.slice(-44).padEnd(44)}`);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  // the layers of one key, lined up (recipe.align): a soft attack crosses the start threshold later than a hard one, so
  // each layer's start moves to where it lines up best with the next layer up of the same key (the lag, within 10 ms,
  // that maximizes their correlation over the first half second, mono), and keeps that correlation in `align`, which
  // the kernel's 'aligned' crossfade reads for the pair. As Parlour Upright's build does, on the 16-bit samples.
  if (recipe.align) {
    const W2 = Math.round(0.01 * sr);
    // from the top layer down, so each layer lines up with one already in place
    const order = [...out.keys()].sort((x, y) => rows[y].layer - rows[x].layer || x - y);
    for (const i of order) {
      const a = out[i];
      if (a.trig) continue;
      const la = rows[i].layer;
      const ups = out
        .map((h, j) => [h, rows[j]])
        .filter(([h, rj]) => !h.trig && h.key === a.key && !(h.rr | 0) && rj.layer > la)
        .sort((x, y) => x[1].layer - y[1].layer);
      if (!ups.length) continue;
      const h = ups[0][0],
        A0 = a.ch[0],
        A1 = a.ch[C - 1],
        H0 = h.ch[0],
        H1 = h.ch[C - 1];
      const N2 = Math.min(Math.round(0.5 * sr), A0.length - a.start - W2 - 1, H0.length - h.start - 1);
      let best = 0,
        lag = 0;
      for (let l = -W2; l <= W2; l++) {
        if (a.start + l < 0) continue;
        let xy = 0,
          xx = 0,
          yy = 0;
        for (let k = 0; k < N2; k++) {
          const x = A0[a.start + l + k] + A1[a.start + l + k],
            y = H0[h.start + k] + H1[h.start + k];
          xy += x * y;
          xx += x * x;
          yy += y * y;
        }
        const c = xy / Math.sqrt(xx * yy || 1);
        if (c > best) {
          best = c;
          lag = l;
        }
      }
      a.start += lag;
      a.align = Math.round(100 * best) / 100;
      rows[i].align = a.align;
    }
  }
  // the gains: the attack samples onto one quadratic across the keys, through the top layer's levels
  const att = rows.map((r, i) => [r, out[i]]).filter(([, o]) => !o.trig);
  const top = Math.max(...att.map(([r]) => r.layer));
  const tops = att.filter(([r]) => r.layer === top);
  // (across: 'even' puts every key at the top layer's mean level instead: sections recorded at different gains, which
  // an ensemble patch evens out)
  const fit =
    recipe.level && recipe.level.across === 'even'
      ? (
          (m) => () =>
            m
        )(tops.reduce((a, [r]) => a + r.qa.attack, 0) / tops.length)
      : quadFit(
          tops.map(([r]) => r.key),
          tops.map(([r]) => r.qa.attack),
        );
  const mode = (recipe.level && recipe.level.mode) || 'flat';
  for (const [r, o] of att) {
    // 'key': the gain the key's top-layer sample gets (its round robins' mean), for every layer of the key
    const ref = mode === 'key' ? tops.filter(([x]) => x.key === r.key).map(([x]) => x.qa.attack) : [r.qa.attack];
    const g = fit(r.key) - ref.reduce((a, b) => a + b, 0) / ref.length;
    o.gain = Math.round(100 * g) / 100;
    r.gain = o.gain;
  }
  // a release sample takes its key's gain, plus its recipe's own level (rt: a release is quieter than its note)
  for (const [i, o] of out.entries())
    if (o.trig === 'release') {
      const mate = out.find((x) => !x.trig && o.key >= x.lo && o.key <= x.hi);
      o.gain = Math.round(100 * ((mate ? mate.gain : 0) + (recipe.regions[i].gain || 0))) / 100;
      rows[i].gain = o.gain;
    }
  const qa = qaInstrument(
    rows.filter((r, i) => !out[i].trig),
    recipe.waive || [],
  );
  // the release samples: clipping only (their pitch and level are noise's)
  const rels = rows.filter((r, i) => out[i].trig === 'release');
  if (rels.length) {
    const flat = rels.filter((r) => r.qa.flatTops),
      runs = rels.filter((r) => r.qa.clipRuns && !r.qa.flatTops);
    qa.verdicts.push([
      '2 clipping, releases',
      flat.length ? 'reject' : runs.length ? 'review' : 'accept',
      `${rels.length - flat.length - runs.length} accept, ${runs.length} review, ${flat.length} reject of ${rels.length}${flat.length ? '; flat tops: ' + flat.map((r) => r.id).join(', ') : ''}${runs.length ? '; runs at 0 dBFS: ' + runs.map((r) => r.id).join(', ') : ''}`,
    ]);
  }
  const loops = rows.filter((r) => r.qa.loop);
  if (loops.length) qa.verdicts.push(loopVerdict(loops, recipe.waive || []));
  const meta = {
    kind: 'melodic',
    source: recipe.source,
    repo: recipe.repo,
    commit: recipe.commit,
    licence: recipe.licence,
    credit: recipe.credit,
    ...(recipe.meta || {}),
    build: recipe.build,
  };
  const bytes = encodeOdk({ name: recipe.name, sr, bits: 16, channels: C, meta, samples: out });
  return { bytes, count: out.length, inFrames, outFrames, qa, rows };
}

// check 14, for the instrument: every loop's correlation, drift and pitch
function loopVerdict(rows, waive) {
  const v = rows.map((r) => {
    const l = r.qa.loop,
      bad = [];
    let k = l.corr >= 0.9 ? 0 : l.corr >= 0.8 ? 1 : 2;
    if (l.corr < 0.9) bad.push(`corr ${l.corr}`);
    if (Math.abs(l.drift) > 0.5) {
      k = Math.max(k, 1);
      bad.push(`${l.drift} dB drift`);
    }
    if (l.cents != null && Math.abs(l.cents) > 2) {
      k = Math.max(k, 1);
      bad.push(`${l.cents} cents`);
    }
    return [r, ['accept', 'review', 'reject'][k], bad.join(', ')];
  });
  const rej = v.filter((x) => x[1] === 'reject'),
    rev = v.filter((x) => x[1] === 'review');
  const name = (list) =>
    list
      .slice(0, 6)
      .map(([r, , w]) => `${r.id} (${w})`)
      .join(', ') + (list.length > 6 ? ', ...' : '');
  const cs = rows.map((r) => r.qa.loop.corr);
  let why = `${v.length - rej.length - rev.length} accept, ${rev.length} review, ${rej.length} reject of ${v.length}; correlation ${Math.min(...cs).toFixed(3)} to ${Math.max(...cs).toFixed(3)}, loops ${Math.min(...rows.map((r) => r.qa.loop.seconds))} to ${Math.max(...rows.map((r) => r.qa.loop.seconds))} s`;
  if (rej.length) why += `; rejected: ${name(rej)}`;
  if (rev.length) why += `; review: ${name(rev)}`;
  let verdict = rej.length > 0.1 * v.length ? 'reject' : rej.length || rev.length ? 'review' : 'accept';
  const w = waive.find((x) => x.check === '14 loop quality');
  if (verdict !== 'accept' && w) {
    verdict = 'waived';
    why += ` (waived: ${w.why})`;
  }
  return ['14 loop quality', verdict, why];
}
