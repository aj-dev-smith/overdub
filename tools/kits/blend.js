// The multi-mic drum builder, for recipes that mix each stroke from several microphones (tools/kits/<name>.js with
// `mics` on its pieces): Rusty Sticks (tools/kits/big-rusty-sticks.js) is the first. tools/fetch-kits.js calls it. Where
// the plain drum builder takes one stereo file per stroke (an overhead pair), this one mixes a stroke from its close
// mic, panned, and the overhead pair, at gains the recipe fixes by measurement. Integer gains and one fixed order of
// arithmetic throughout, so the same upstream bytes always build the same .odk.
//
// What a piece gives:
//   id                 the piece the kernel plays
//   N                  how many velocity layers upstream has (a layer's `vel`, MIDI 0-127, is round(127 v / N) unless
//                      the layer gives its own)
//   layers             [{ v, vel?, rr? }]: the upstream layer, and which round robins (default the piece's `rr`)
//   rr                 the round robins taken, by upstream number
//   mics               [{ path, db, pan?, invert? }]: `path` with {v} and {r} for the layer and the round robin; a mono
//                      file is panned at `pan` (-1 left .. 1 right, constant power), a stereo one taken as it is; `db`
//                      its gain; `invert` flips its polarity
//   trim               dBFS (default -64): the tail is cut after the last 960-frame window at or above it (either
//                      channel), then faded over 480 frames
//   max, fadeMs        seconds: a longer stroke is cut there, the last `fadeMs` faded out (a cymbal's tail, for size)
//   hp                 { f, n }: a high-pass at f Hz, n Butterworth biquads (Q 0.707) in a row, on the mixed stroke: the
//                      low rumble a close mic under a cymbal or a hi-hat hears (the kick through the floor, the pedal),
//                      which a mix takes out
//   pol                true: each stroke's `pol` (+1 or -1): the sign that puts a synthesized sub in phase with it (below)
//
// Every stroke of a piece is scaled by one factor so the piece's loudest peak sits at -1 dBFS (the velocity layers keep
// their recorded distance), and each stroke's `start` is 1.0 ms before its attack (the first frame within 20 dB of
// its peak, either channel): the kernel declares that millisecond as latency, so the attack lands on the note.
import crypto from 'node:crypto';
import { decodeFlac } from '../flac.js';
import { qaSample, qaInstrument } from './qa.js';
import { encodeOdk } from '../../app/src/kernel/odk.js';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const WIN = 960,
  FADE = 480;
const fill = (p, v, r) => p.replace('{v}', String(v)).replace('{r}', String(r));

// every upstream file a recipe's pieces name, in order (the recipe's `files` must pin each one)
export function blendFiles(recipe) {
  const out = [];
  for (const pc of recipe.pieces)
    for (const L of pc.layers) for (const r of L.rr || pc.rr) for (const m of pc.mics) out.push(fill(m.path, L.v, r));
  return out;
}

// constant-power pan as Q15 integers: [left, right]
function panQ(db, pan = 0, invert = false) {
  const g = Math.pow(10, db / 20) * (invert ? -1 : 1),
    a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.round(32768 * g * Math.cos(a)), Math.round(32768 * g * Math.sin(a))];
}

export async function buildBlended(recipe, fetchFile) {
  const lic = await fetchFile(recipe, recipe.licenceFile.path, recipe.licenceFile.sha256);
  if (!/CC0 1\.0 Universal/.test(lic.toString('utf8'))) throw new Error('the pinned LICENSE is not CC0 1.0 Universal');
  for (const f of blendFiles(recipe)) if (!recipe.files[f]) throw new Error(`the recipe names ${f} but doesn't pin it`);
  const sr = recipe.sr,
    PRE = Math.round(0.001 * sr);
  const out = [],
    rows = [];
  let inFrames = 0,
    outFrames = 0,
    n = 0;
  const total = recipe.pieces.reduce((s, pc) => s + pc.layers.reduce((t, L) => t + (L.rr || pc.rr).length, 0), 0);
  for (const [pi, pc] of recipe.pieces.entries()) {
    // 1. each stroke mixed from its mics, at full precision (Q15 gains on 16-bit samples: exact integers in a double)
    const strokes = [];
    let peak = 0;
    for (const [li, L] of pc.layers.entries()) {
      for (const r of L.rr || pc.rr) {
        let acc = null,
          frames = 0,
          hash = null;
        for (const m of pc.mics) {
          const file = fill(m.path, L.v, r),
            b = await fetchFile(recipe, file);
          const d = decodeFlac(b);
          if (d.sr !== sr) throw new Error(`${file}: ${d.sr} Hz, the kit is ${sr} Hz`);
          if (d.bits !== 16) throw new Error(`${file}: ${d.bits}-bit; this builder mixes 16-bit sources`);
          if (!hash) hash = sha256(b);
          inFrames += d.frames;
          if (!acc) {
            frames = d.frames;
            acc = [new Float64Array(frames), new Float64Array(frames)];
          }
          const k = Math.min(frames, d.frames);
          if (d.channels.length === 1) {
            const [gl, gr] = panQ(m.db, m.pan || 0, m.invert),
              x = d.channels[0];
            for (let i = 0; i < k; i++) {
              acc[0][i] += x[i] * gl;
              acc[1][i] += x[i] * gr;
            }
          } else {
            const g = Math.round(32768 * Math.pow(10, m.db / 20)) * (m.invert ? -1 : 1);
            for (let i = 0; i < k; i++) {
              acc[0][i] += d.channels[0][i] * g;
              acc[1][i] += d.channels[1][i] * g;
            }
          }
        }
        for (const c of acc)
          for (let i = 0; i < frames; i++) {
            const a = c[i] < 0 ? -c[i] : c[i];
            if (a > peak) peak = a;
          }
        strokes.push({ li, r, L, acc, frames, hash });
        if (process.stdout.isTTY) process.stdout.write(`\r  ${++n}/${total} ${pc.id.padEnd(12)}`);
      }
    }
    // 2. the piece to -1 dBFS at its loudest as mixed (so a high-pass takes its lows away without moving its level),
    // then its high-pass, then 16-bit; the QA reads the mix before any cut
    if (pc.hp) for (const s of strokes) for (const c of s.acc) highpass(c, pc.hp.f, pc.hp.n || 1, sr);
    const scale = (32767 * 0.8912509381337456) / peak; // (-1 dBFS: a literal, so no engine's pow can move a rounding)
    const thr = Math.round(32768 * Math.pow(10, (pc.trim ?? -64) / 20)),
      T2 = thr * thr * WIN;
    const M = pc.max ? Math.round(pc.max * sr) : 0,
      F = Math.round(((pc.fadeMs ?? 50) * sr) / 1000);
    for (const s of strokes) {
      const ch = s.acc.map((c) => {
        const o = new Int16Array(s.frames);
        for (let i = 0; i < s.frames; i++) {
          const v = Math.round(c[i] * scale);
          o[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
        }
        return o;
      });
      rows.push({
        id: `${pc.id}.${s.li}.${s.r}`,
        key: pi,
        layer: s.li,
        rr: s.r,
        hash: s.hash,
        qa: qaSample({ ch: ch.map((c) => Int32Array.from(c)), bits: 16, sr }, { key: 60, tuning: false }),
      });
      // the tail: after the last window at or above the trim, a 480-frame fade; a cymbal past `max`, its own fade
      let end = 0;
      for (let a = Math.floor(s.frames / WIN) * WIN; a >= 0 && !end; a -= WIN) {
        let el = 0,
          er = 0;
        for (let i = a; i < Math.min(s.frames, a + WIN); i++) {
          el += ch[0][i] * ch[0][i];
          er += ch[1][i] * ch[1][i];
        }
        if (el >= T2 || er >= T2) end = Math.min(s.frames, a + WIN);
      }
      let frames = Math.min(s.frames, end + FADE);
      const cut = ch.map((c) => c.slice(0, frames));
      for (const c of cut) for (let i = end; i < frames; i++) c[i] = Math.round((c[i] * (frames - i)) / (FADE + 1));
      if (M && frames > M) {
        frames = M;
        for (let k = 0; k < 2; k++) {
          cut[k] = cut[k].slice(0, M);
          for (let i = M - F; i < M; i++) cut[k][i] = Math.round((cut[k][i] * (M - i)) / (F + 1));
        }
      }
      // the attack: the first frame within 20 dB of the stroke's peak, either channel; the start 1.0 ms before it
      let pk = 0;
      for (const c of cut)
        for (let i = 0; i < frames; i++) {
          const a = c[i] < 0 ? -c[i] : c[i];
          if (a > pk) pk = a;
        }
      let att = 0;
      while (att < frames && Math.abs(cut[0][att]) * 10 < pk && Math.abs(cut[1][att]) * 10 < pk) att++;
      const start = Math.max(0, att - PRE);
      const e = {
        id: `${pc.id}.${s.li}.${s.r}`,
        piece: pc.id,
        layer: s.li,
        rr: s.r - 1,
        vel: s.L.vel ?? Math.round((127 * s.L.v) / pc.N),
        start,
      };
      if (pc.pol) e.pol = polarity(cut, att, sr);
      out.push({ ...e, src: fill(pc.mics[0].path, s.L.v, s.r), ch: cut });
      outFrames += frames;
    }
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  // the round robins as the kernel indexes them: 0, 1, ... within each layer, in the recipe's order
  const seen = {};
  for (const s of out) {
    const k = s.piece + ':' + s.layer;
    s.rr = seen[k] = k in seen ? seen[k] + 1 : 0;
  }
  const meta = {
    kind: 'drums',
    source: recipe.source,
    repo: recipe.repo,
    commit: recipe.commit,
    licence: recipe.licence,
    credit: recipe.credit,
    trim: recipe.trimNote,
    blend: recipe.blendNote,
    onset: 'each stroke starts 1.0 ms before its attack (the first frame within 20 dB of its peak)',
  };
  const bytes = encodeOdk({ name: recipe.name, sr, bits: 16, channels: 2, meta, samples: out });
  return {
    bytes,
    hash: 'sha256-' + sha256(bytes),
    count: out.length,
    inFrames: inFrames / 2,
    outFrames,
    qa: qaInstrument(rows, recipe.waive || [], { drums: true }),
  };
}

// An RBJ high-pass (Q 0.707), n in a row, in place. The coefficients are rounded to 2^-40, so an engine whose cos or
// sin differs in the last bit still builds the same bytes; the filtering is plain IEEE arithmetic in a fixed order.
function highpass(x, f, n, sr) {
  const q = (v) => Math.round(v * 1099511627776) / 1099511627776;
  const w = (2 * Math.PI * f) / sr,
    cs = Math.cos(w),
    al = Math.sin(w) / (2 * 0.7071067811865476),
    a0 = 1 + al;
  const b0 = q((1 + cs) / 2 / a0),
    b1 = q(-(1 + cs) / a0),
    a1 = q((-2 * cs) / a0),
    a2 = q((1 - al) / a0);
  for (let k = 0; k < n; k++) {
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      x[i] = v;
    }
  }
}

// The sign that puts a synthesized sub in phase with the stroke: the stroke's mono sum, low-passed (two one-poles at
// 150 Hz), against the trigger's sub as the kernel makes it at its default pitch (52 Hz, from an octave up, falling over
// 12 ms), over the 20 ms from the attack; the sign of their correlation.
function polarity(ch, att, sr) {
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sr),
    to = Math.min(ch[0].length, att + Math.round(0.02 * sr)),
    gk = Math.exp(-1 / (0.004 * sr));
  let y1 = 0,
    y2 = 0,
    xy = 0,
    ph = 0,
    gl = 1;
  for (let i = Math.max(0, att - Math.round(0.002 * sr)); i < to; i++) {
    y1 += a * (ch[0][i] + ch[1][i] - y1);
    y2 += a * (y1 - y2);
    if (i >= att) {
      ph += (52 * Math.pow(2, gl)) / sr;
      gl *= gk;
      xy += y2 * Math.sin(2 * Math.PI * ph);
    }
  }
  return xy < 0 ? -1 : 1;
}
