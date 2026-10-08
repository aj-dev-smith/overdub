// core.shaper: Scribble Strip. Draw a shape over a beat or a bar and it moves the volume, a filter or the pan in time
// with the song: the pumping sidechain feel without a sidechain, trance gates, stutters, slow swells and auto-pan.
// Three lanes (volume, filter cutoff with resonance, pan), each with its own shape, rate and depth, then one smoothing
// control for the edges and a dry/wet mix. Its window is ui/editors/shaper.js (editor: 'shaper'); the design note is
// docs/research/SHAPER.md.
//
// The shape is params, so it undoes, travels in a song, flips with A/B and is read and written by agents like any knob:
//   <lane>_n           how many points the shape uses (1..16); lanes are vol, flt and pan
//   <lane><i>_x        where point i sits in one pass of the shape, 0 (its start) .. 1 (its end)
//   <lane><i>_y        its level, 0 (the bottom) .. 1 (the top)
//   <lane><i>_c        the bend of the line that leaves it, -1..1: > 0 starts slow, < 0 starts fast (as lanes bend)
//   <lane><i>_s        1: a step (it holds its level, then jumps at the next point); 0: a line
// The points may sit in any order: the shape is them sorted by x (a tie keeps the param order). It loops: after the
// last point the line runs on to the first one in the next pass. What the top and bottom mean: volume, full level and
// the level pulled down by its depth (100%: silence); filter, the cutoff and the cutoff closed by its depth (100%: eight
// octaves lower); pan, hard right and hard left at 100% depth (0.5 is the middle). Why points as params (and not one
// text param): docs/research/SHAPER.md. The text form agents read back ("0:0~-0.35 0.6:1 1:1", the automation lanes'
// own format) is describe() below, which core/project.js summarize prints in place of the params.
//
// Timing: a pass is one RATE (1/32 to 2 bars, triplets and dotted), locked to the song's beat from the transport
// (process()'s 5th argument): beat 0 starts a pass, so a quarter-note pump dips on every beat. Stopped, it runs on at
// the tempo. A bar is four beats (a kernel isn't told the meter; Keyhole and Echo Reel do the same). The smoothing is a
// two-pole low-pass on what each lane applies, whose time is the edge's rise (10% to 90%; the bottom of the range,
// 0.1 ms, is none at all); the shape is read half that time ahead, so a smoothed edge is centred where it is drawn
// (there is no latency to pay for it: the shape is known ahead). Lanes switch on and off over 10 ms, and a new rate or a
// new point smooths over at least 8 ms for a moment, so nothing about changing it clicks; the smoothing control decides
// whether the shape itself does. At the defaults (the volume lane flat at the top, the others off, mix 100%) the output
// is the input, bit for bit.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export const NP = 16; // points a shape holds
export const OCTAVES = 8; // how far the filter closes at 100% depth
export const RATES = [
  '1/32',
  '1/16T',
  '1/16',
  '1/16D',
  '1/8T',
  '1/8',
  '1/8D',
  '1/4T',
  '1/4',
  '1/4D',
  '1/2T',
  '1/2',
  '1/2D',
  '1 BAR',
  '2 BARS',
];
export const RATE_BEATS = [0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 4 / 3, 2, 3, 4, 8];
// The lanes, in the order the window shows them. rest: a point's level where the lane does nothing (its default)
export const LANES = [
  { id: 'vol', name: 'Volume', word: 'volume', rest: 1, rate: 8, depth: 100, on: 1 },
  { id: 'flt', name: 'Filter', word: 'filter', rest: 1, rate: 5, depth: 50, on: 0 },
  { id: 'pan', name: 'Pan', word: 'pan', rest: 0.5, rate: 11, depth: 100, on: 0 },
];
export const laneOf = (id) => LANES.find((l) => l.id === id) || null;
export const pkey = (lane, i, f) => `${lane}${i}_${f}`; // i is 1-based: pkey('vol', 3, 'x') -> 'vol3_x'
// a point slot's own defaults: the first at the start, the rest at the end, all at the lane's rest level, straight
export const slotDefault = (lane, i) => ({ x: i === 1 ? 0 : 1, y: laneOf(lane)?.rest ?? 1, c: 0, s: 0 });

/* ------------------------------------------------------------------------------------------------ reading a shape */
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (v, d) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
// The shape a lane's params hold, sorted by x (a tie keeps the param order): [{ i, x, y, c, s }], i the 1-based slot
export function pointsOf(params = {}, lane = 'vol') {
  const L = laneOf(lane);
  if (!L) return [];
  const n = cl(Math.round(num(params[`${lane}_n`], 2)), 1, NP);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const d = slotDefault(lane, i);
    out.push({
      i,
      x: cl(num(params[pkey(lane, i, 'x')], d.x), 0, 1),
      y: cl(num(params[pkey(lane, i, 'y')], d.y), 0, 1),
      c: cl(num(params[pkey(lane, i, 'c')], 0), -1, 1),
      s: num(params[pkey(lane, i, 's')], 0) >= 0.5 ? 1 : 0,
    });
  }
  return out.sort((a, b) => a.x - b.x || a.i - b.i);
}
// 0..1 -> 0..1 along a line of bend c (core/automation.js bend, without the step)
export function bend(u, c) {
  if (!c) return u;
  return c > 0 ? Math.pow(u, 1 + 3 * c) : 1 - Math.pow(1 - u, 1 - 3 * c);
}
// The segment a phase falls in: { j0, j1, x0, x1 } (x0 may be below 0 and x1 above 1: the line across the loop)
export function segmentAt(pts, ph) {
  const n = pts.length;
  let k = -1;
  for (let j = 0; j < n; j++) {
    if (pts[j].x <= ph) k = j;
    else break;
  }
  if (k < 0) return { j0: n - 1, j1: 0, x0: pts[n - 1].x - 1, x1: pts[0].x };
  if (k === n - 1) return { j0: k, j1: 0, x0: pts[k].x, x1: pts[0].x + 1 };
  return { j0: k, j1: k + 1, x0: pts[k].x, x1: pts[k + 1].x };
}
// The shape's level at a phase (0..1 of a pass): the kernel's own reading, for the window and the checks
export function valueAt(pts, ph) {
  if (!pts.length) return 1;
  ph -= Math.floor(ph);
  const g = segmentAt(pts, ph),
    a = pts[g.j0],
    b = pts[g.j1];
  if (a.s) return a.y;
  const len = g.x1 - g.x0;
  const u = len > 1e-9 ? cl((ph - g.x0) / len, 0, 1) : 1;
  return a.y + (b.y - a.y) * bend(u, a.c);
}
// What a lane applies at a level y (its own units): volume -> linear gain, filter -> cutoff Hz, pan -> -1..1
export function applied(params, lane, y) {
  const d = cl(num(params[`${lane}_depth`], laneOf(lane)?.depth ?? 100), 0, 100) / 100;
  if (lane === 'vol') return 1 - d * (1 - y);
  if (lane === 'flt') return num(params.flt_cut, 8000) * Math.pow(2, -d * OCTAVES * (1 - y));
  return d * (2 * y - 1);
}

/* ------------------------------------------------------------------------------------------------ writing a shape */
// The params that put these points in a lane: its count, every point's slot (in the order given) and the unused slots
// back at their defaults, so one shape is always written the same way (and a preset reads as itself)
export function lanePatch(lane, points) {
  const pts = (points || []).slice(0, NP);
  const out = { [`${lane}_n`]: Math.max(1, pts.length) };
  for (let i = 1; i <= NP; i++) {
    const p = pts[i - 1] || slotDefault(lane, i);
    out[pkey(lane, i, 'x')] = r4(cl(num(p.x, 0), 0, 1));
    out[pkey(lane, i, 'y')] = r4(cl(num(p.y, 1), 0, 1));
    out[pkey(lane, i, 'c')] = p.s ? 0 : r4(cl(num(p.c, 0), -1, 1));
    out[pkey(lane, i, 's')] = p.s ? 1 : 0;
  }
  return out;
}
const r4 = (x) => {
  const r = Math.round(x * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
};
// [[x, y, c?, 'step'?], ...] -> points (how the presets are written below)
const pts = (list) => list.map(([x, y, c = 0, s = 0]) => ({ x, y, c: s ? 0 : c, s: s ? 1 : 0 }));
const shape = (lane, list) => lanePatch(lane, pts(list));

/* ------------------------------------------------------------------------------------------------ the text form */
const r3 = (x) => {
  const r = Math.round(x * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};
// "0:0~-0.35 0.6:1 1:1": x:y per point in order, ~bend or ~step after it (the automation lanes' text form)
export const shapeText = (points) =>
  (points || []).map((p) => `${r3(p.x)}:${r3(p.y)}${p.s ? '~step' : p.c ? `~${r3(p.c)}` : ''}`).join(' ');
const hz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`);
const isRest = (lane, pts) =>
  pts.length === 2 &&
  pts.every((p) => !p.s && !p.c && Math.abs(p.y - laneOf(lane).rest) < 1e-6) &&
  pts[0].x === 0 &&
  pts[1].x === 1;
// One line for get_project: what each lane does, in words and the text form, and how the params spell it
export function describe(params = {}) {
  const v = { ...DEFAULTS, ...params };
  const lane = (L) => {
    const p = pointsOf(v, L.id),
      on = num(v[`${L.id}_on`], 0) >= 0.5;
    const rate = RATES[cl(Math.round(num(v[`${L.id}_rate`], L.rate)), 0, RATES.length - 1)];
    const extra = L.id === 'flt' ? `, cutoff ${hz(num(v.flt_cut, 8000))}, reso ${r3(num(v.flt_res, 0.25))}` : '';
    if (!on) return `${L.word} off${isRest(L.id, p) ? '' : ` (every ${rate}: ${shapeText(p)})`}`;
    return `${L.word} every ${rate}, depth ${r3(num(v[`${L.id}_depth`], L.depth))}%${extra}: ${shapeText(p)}`;
  };
  return `${LANES.map(lane).join('; ')}; smooth ${r3(num(v.smooth, 2))} ms, mix ${r3(num(v.mix, 100))}% (points x:y~bend, ~step holds then jumps; params <lane><i>_x _y _c _s and <lane>_n, lanes vol flt pan)`;
}

/* ------------------------------------------------------------------------------------------------ the params */
const lanePoints = (L) => {
  const out = [
    {
      key: `${L.id}_n`,
      label: `${L.id} points`,
      min: 1,
      max: NP,
      def: 2,
      step: 1,
      hidden: true,
      auto: false,
      desc:
        L.id === 'vol'
          ? `how many points the volume shape uses: vol1 … vol${NP}. Point i is vol<i>_x (where in one pass, 0..1), vol<i>_y (0 bottom … 1 top: the level, or pulled down by VOL DEPTH), vol<i>_c (the bend to the next point, -1..1: > 0 starts slow) and vol<i>_s (1: hold, then jump at the next point). The shape loops`
          : L.id === 'flt'
            ? 'how many points the filter shape uses: flt1 … fltN, as vol_n says; 1 is the cutoff, 0 the cutoff closed by FLT DEPTH'
            : 'how many points the pan shape uses: pan1 … panN, as vol_n says; 0.5 is the middle, 1 right and 0 left (at 100% PAN DEPTH)',
    },
  ];
  for (let i = 1; i <= NP; i++) {
    const d = slotDefault(L.id, i),
      one = i === 1 && L.id === 'vol';
    out.push(
      {
        key: pkey(L.id, i, 'x'),
        label: `${L.id} ${i} x`,
        min: 0,
        max: 1,
        def: d.x,
        quantum: 1e-4,
        hidden: true,
        auto: false,
        ...(one ? { desc: 'point 1: where it sits in one pass of the shape, 0 (start) .. 1 (end)' } : {}),
      },
      {
        key: pkey(L.id, i, 'y'),
        label: `${L.id} ${i} y`,
        min: 0,
        max: 1,
        def: d.y,
        quantum: 1e-4,
        hidden: true,
        auto: false,
        ...(one ? { desc: 'point 1: its level, 0 (bottom) .. 1 (top)' } : {}),
      },
      {
        key: pkey(L.id, i, 'c'),
        label: `${L.id} ${i} bend`,
        min: -1,
        max: 1,
        def: 0,
        quantum: 1e-3,
        hidden: true,
        auto: false,
        ...(one ? { desc: 'point 1: the bend of the line to the next point: > 0 starts slow, < 0 starts fast' } : {}),
      },
      {
        key: pkey(L.id, i, 's'),
        label: `${L.id} ${i} step`,
        opts: ['LINE', 'STEP'],
        def: 0,
        hidden: true,
        auto: false,
        ...(one ? { desc: 'point 1: STEP holds its level, then jumps at the next point' } : {}),
      },
    );
  }
  return out;
};
const PARAMS = [
  {
    key: 'vol_on',
    label: 'VOLUME',
    opts: ['OFF', 'ON'],
    def: 1,
    desc: 'the volume lane: its shape moves the level in time',
  },
  {
    key: 'vol_depth',
    label: 'VOL DEPTH',
    min: 0,
    max: 100,
    def: 100,
    unit: '%',
    role: 'depth',
    desc: 'how far the shape pulls the level down: at 100% the bottom of the shape is silence',
  },
  {
    key: 'vol_rate',
    label: 'VOL RATE',
    opts: RATES,
    def: 8,
    role: 'rate',
    desc: 'one pass of the volume shape as a note length, locked to the song (a bar is 4 beats)',
  },
  {
    key: 'flt_on',
    label: 'FILTER',
    opts: ['OFF', 'ON'],
    def: 0,
    desc: 'the filter lane: its shape moves a resonant low-pass',
  },
  {
    key: 'flt_depth',
    label: 'FLT DEPTH',
    min: 0,
    max: 100,
    def: 50,
    unit: '%',
    role: 'depth',
    desc: `how far the shape closes the filter: at 100% the bottom of the shape is ${OCTAVES} octaves under CUTOFF`,
  },
  {
    key: 'flt_rate',
    label: 'FLT RATE',
    opts: RATES,
    def: 5,
    role: 'rate',
    desc: 'one pass of the filter shape as a note length, locked to the song',
  },
  {
    key: 'flt_cut',
    label: 'CUTOFF',
    min: 40,
    max: 18000,
    def: 8000,
    curve: 'log',
    unit: 'Hz',
    role: 'tone',
    desc: 'where the filter sits at the top of the shape',
  },
  { key: 'flt_res', label: 'RESO', min: 0, max: 1, def: 0.25, role: 'tone', desc: 'a singing peak at the cutoff' },
  {
    key: 'pan_on',
    label: 'PAN',
    opts: ['OFF', 'ON'],
    def: 0,
    desc: 'the pan lane: its shape moves the sound between the speakers',
  },
  {
    key: 'pan_depth',
    label: 'PAN DEPTH',
    min: 0,
    max: 100,
    def: 100,
    unit: '%',
    role: 'width',
    desc: 'how far it pans: at 100% the top of the shape is hard right and the bottom hard left',
  },
  {
    key: 'pan_rate',
    label: 'PAN RATE',
    opts: RATES,
    def: 11,
    role: 'rate',
    desc: 'one pass of the pan shape as a note length, locked to the song',
  },
  {
    key: 'smooth',
    label: 'SMOOTH',
    min: 0.1,
    max: 100,
    def: 2,
    curve: 'log',
    unit: 'ms',
    role: 'attack',
    desc: "how long the shape's edges take: 0.1 ms is a hard edge (it clicks, on purpose), 2-5 ms is clean, 30 ms and up rounds a gate into a swell",
  },
  { key: 'mix', label: 'MIX', min: 0, max: 100, def: 100, unit: '%', role: 'mix', desc: 'dry to all shaped' },
  ...LANES.flatMap(lanePoints),
];
const DEFAULTS = Object.fromEntries(PARAMS.map((p) => [p.key, p.def]));

/* ------------------------------------------------------------------------------------------------ the presets */
// Each is the whole device (a preset is the whole sound): the lane it is about on and drawn, the others off and flat.
export const PRESETS = [
  {
    name: 'Pump (quarter notes)',
    blurb: 'ducks on every beat and breathes back, like a kick on the sidechain',
    params: {
      vol_rate: 8,
      vol_depth: 85,
      smooth: 4,
      ...shape('vol', [
        [0, 0, -0.35],
        [0.6, 1],
        [1, 1],
      ]),
    },
  },
  {
    name: 'Pump (eighths)',
    blurb: 'a quicker duck on every eighth',
    params: {
      vol_rate: 5,
      vol_depth: 75,
      smooth: 3,
      ...shape('vol', [
        [0, 0, -0.3],
        [0.7, 1],
        [1, 1],
      ]),
    },
  },
  {
    name: 'Gate (sixteenths)',
    blurb: 'chops every sixteenth: on, then off',
    params: {
      vol_rate: 2,
      vol_depth: 100,
      smooth: 1.5,
      ...shape('vol', [
        [0, 1, 0, 1],
        [0.55, 0, 0, 1],
      ]),
    },
  },
  {
    name: 'Stutter',
    blurb: 'two beats open, then sixteenth and thirty-second chops into the next bar',
    params: {
      vol_rate: 13,
      vol_depth: 100,
      smooth: 1,
      ...shape('vol', [
        [0, 1, 0, 1],
        [0.5625, 0, 0, 1],
        [0.625, 1, 0, 1],
        [0.6875, 0, 0, 1],
        [0.75, 1, 0, 1],
        [0.78125, 0, 0, 1],
        [0.8125, 1, 0, 1],
        [0.84375, 0, 0, 1],
        [0.875, 1, 0, 1],
        [0.90625, 0, 0, 1],
        [0.9375, 1, 0, 1],
        [0.96875, 0, 0, 1],
      ]),
    },
  },
  {
    name: 'Swell over a bar',
    blurb: 'rises from nothing to full across each bar',
    params: {
      vol_rate: 13,
      vol_depth: 100,
      smooth: 6,
      ...shape('vol', [
        [0, 0, 0.45],
        [0.92, 1],
        [1, 1],
      ]),
    },
  },
  {
    name: 'Auto-pan',
    blurb: 'sways left and right every half note',
    params: {
      vol_on: 0,
      pan_on: 1,
      pan_rate: 11,
      pan_depth: 80,
      smooth: 10,
      ...shape('pan', [
        [0, 0.5, -0.2],
        [0.25, 1, 0.2],
        [0.5, 0.5, -0.2],
        [0.75, 0, 0.2],
      ]),
    },
  },
  {
    name: 'Filter wobble (eighths)',
    blurb: 'a resonant low-pass that opens and closes every eighth',
    params: {
      vol_on: 0,
      flt_on: 1,
      flt_rate: 5,
      flt_depth: 70,
      flt_cut: 3200,
      flt_res: 0.6,
      smooth: 5,
      ...shape('flt', [
        [0, 0, 0.2],
        [0.25, 0.5, -0.2],
        [0.5, 1, 0.2],
        [0.75, 0.5, -0.2],
      ]),
    },
  },
  {
    name: 'Half-time duck',
    blurb: 'a deep, slow duck on beats one and three',
    params: {
      vol_rate: 11,
      vol_depth: 90,
      smooth: 5,
      ...shape('vol', [
        [0, 0, -0.25],
        [0.45, 1],
        [1, 1],
      ]),
    },
  },
];
// the lane a preset is about (the one it turns on that does something): its drawing in the window
export function presetLane(pr) {
  const p = { ...DEFAULTS, ...(pr?.params || {}) };
  return LANES.find((L) => num(p[`${L.id}_on`], 0) >= 0.5 && !isRest(L.id, pointsOf(p, L.id)))?.id || 'vol';
}

/* ------------------------------------------------------------------------------------------------ the kernel */
const BODY = String.raw`
const RATES = [${RATE_BEATS.join(', ')}];
const NP = ${NP}, OCT = ${OCTAVES}, RISE = 3.36, SQ2 = Math.SQRT2;
// a lane: its keys (made once), its points sorted every block, where its pass is, its smoother and the segment the
// phase is in (a .. b, and how to read it)
function lane(name, neutral) {
  const kx = [], ky = [], kc = [], ks = [];
  for (let i = 1; i <= NP; i++) { kx.push(name + i + '_x'); ky.push(name + i + '_y'); kc.push(name + i + '_c'); ks.push(name + i + '_s'); }
  return {
    kOn: name + '_on', kDepth: name + '_depth', kRate: name + '_rate', kN: name + '_n', kx, ky, kc, ks, neutral,
    rx: new Float64Array(NP), ord: new Int32Array(NP),
    X: new Float64Array(NP), Y: new Float64Array(NP), C: new Float64Array(NP), S: new Uint8Array(NP), n: 1,
    ph: 0, dph: 0, ahead: 0, rate: -1, sig: -1, settle: 0, depth: 0, want: 0, on: 0, fresh: true,
    a: 2, b: -1, x0: 0, il: 0, y0: 0, dy: 0, e: 1, dir: 0, hold: 0, s1: neutral, s2: neutral,
  };
}
// the points from the params, sorted by x (insertion sort; a tie keeps the param order). -> a signature of what jumps
// when it changes (the count and which points step), so a change to it smooths over
function load(A, p) {
  let n = Math.round(p[A.kN]); n = n < 1 ? 1 : n > NP ? NP : n;
  const rx = A.rx, o = A.ord;
  for (let i = 0; i < n; i++) { const x = p[A.kx[i]]; rx[i] = x < 0 ? 0 : x > 1 ? 1 : x; o[i] = i; }
  for (let i = 1; i < n; i++) { const v = o[i], xv = rx[v]; let j = i - 1; while (j >= 0 && rx[o[j]] > xv) { o[j + 1] = o[j]; j--; } o[j + 1] = v; }
  let steps = 0;
  for (let k = 0; k < n; k++) {
    const i = o[k], y = p[A.ky[i]], c = p[A.kc[i]];
    A.X[k] = rx[i]; A.Y[k] = y < 0 ? 0 : y > 1 ? 1 : y; A.C[k] = c < -1 ? -1 : c > 1 ? 1 : c;
    A.S[k] = p[A.ks[i]] >= 0.5 ? 1 : 0;
    if (A.S[k]) steps |= 1 << k;
  }
  A.n = n; A.a = 2; A.b = -1;
  return n * 65536 + steps;
}
// the segment phase ph falls in, and how to read it
function seek(A, ph) {
  const n = A.n, X = A.X;
  let k = -1;
  for (let j = 0; j < n; j++) { if (X[j] <= ph) k = j; else break; }
  let j0, j1, x0, x1;
  if (k < 0) { j0 = n - 1; j1 = 0; x0 = X[n - 1] - 1; x1 = X[0]; A.a = 0; A.b = X[0]; }
  else if (k === n - 1) { j0 = k; j1 = 0; x0 = X[k]; x1 = X[0] + 1; A.a = X[k]; A.b = 1; }
  else { j0 = k; j1 = k + 1; x0 = X[k]; x1 = X[k + 1]; A.a = x0; A.b = x1; }
  const len = x1 - x0, c = A.C[j0];
  A.x0 = x0; A.il = len > 1e-9 ? 1 / len : 0;
  A.y0 = A.Y[j0]; A.dy = A.Y[j1] - A.Y[j0]; A.hold = A.S[j0];
  A.dir = c > 1e-6 ? 1 : c < -1e-6 ? -1 : 0; A.e = 1 + 3 * (c < 0 ? -c : c);
}
function value(A, ph) {
  if (ph < A.a || ph >= A.b) seek(A, ph);
  if (A.hold) return A.y0;
  let u = A.il ? (ph - A.x0) * A.il : 1; u = u < 0 ? 0 : u > 1 ? 1 : u;
  return A.y0 + A.dy * (A.dir > 0 ? Math.pow(u, A.e) : A.dir < 0 ? 1 - Math.pow(1 - u, A.e) : u);
}
// the shape where the smoothed output will be half a smoothing time from now
function shape(A) { let q = A.ph + A.ahead; if (q >= 1) q -= Math.floor(q); return value(A, q); }
// a two-pole smoother; its first reading lands as it is
function smooth(A, tg, k) {
  if (A.fresh) { A.fresh = false; A.s1 = A.s2 = tg; return tg; }
  A.s1 += (tg - A.s1) * k; A.s2 += (A.s1 - A.s2) * k;
  if (A.s2 !== tg && Math.abs(A.s2 - tg) < 1e-7 && Math.abs(A.s1 - tg) < 1e-7) A.s1 = A.s2 = tg;
  return A.s2;
}
return {
  create({ sr }) {
    const V = lane('vol', 1), F = lane('flt', 0), P = lane('pan', 0), LN = [V, F, P];
    const fl = svf(sr), fr = svf(sr);
    const mixS = glide(20, sr, 1);
    const RAMP = 1 / (0.01 * sr), SETTLE = Math.round(0.04 * sr);
    let started = false, fset = false, cnt = 0;
    return {
      process(L, R, n, p, t) {
        const bpm = t && t.bpm > 0 ? t.bpm : 120, playing = !!(t && t.playing), beat = t && t.beat === t.beat ? +t.beat : 0;
        // the bottom of SMOOTH's range is no smoothing at all: a hard edge, if that's what you're after
        const hard = !(p.smooth > 0.1001), T = hard ? 0 : p.smooth;
        const kS = hard ? 1 : 1 - Math.exp(-RISE / (T * 0.001 * sr)), kSet = 1 - Math.exp(-RISE / ((T > 8 ? T : 8) * 0.001 * sr));
        for (let li = 0; li < 3; li++) {
          const A = LN[li];
          const sig = load(A, p);
          let ri = Math.round(p[A.kRate]); ri = ri < 0 ? 0 : ri > RATES.length - 1 ? RATES.length - 1 : ri;
          const cyc = RATES[ri];
          if (started && (sig !== A.sig || ri !== A.rate)) A.settle = SETTLE;
          A.sig = sig; A.rate = ri;
          A.dph = bpm / 60 / sr / cyc;
          A.ahead = (T * 0.0005 * bpm / 60) / cyc;
          if (playing) { const q = beat / cyc; A.ph = q - Math.floor(q); }
          A.depth = p[A.kDepth] * 0.01;
          A.want = p[A.kOn] >= 0.5 ? 1 : 0;
          if (!started) A.on = A.want;
        }
        const fc0 = p.flt_cut, q = 0.6 + p.flt_res * p.flt_res * 10, rc = 1 / (1 + p.flt_res * 0.6), mxT = p.mix * 0.01;
        for (let i = 0; i < n; i++) {
          const dl = L[i], dr = R[i];
          let xl = dl, xr = dr;
          // the filter lane: a resonant low-pass, crossfaded in and out with the lane
          if (F.on > 0 || F.want) {
            if (F.on !== F.want) F.on = F.want ? (F.on + RAMP > 1 ? 1 : F.on + RAMP) : (F.on - RAMP < 0 ? 0 : F.on - RAMP);
            const oct = smooth(F, -F.depth * OCT * (1 - shape(F)), F.settle > 0 ? kSet : kS);
            if (!fset || (cnt & 7) === 0) {
              let fc = fc0 * Math.pow(2, oct); fc = fc < 20 ? 20 : fc > sr * 0.45 ? sr * 0.45 : fc;
              const g = Math.tan(Math.PI * fc / sr);
              fl.setG(g, q); fr.setG(g, q); fset = true;
            }
            fl.tick(xl); fr.tick(xr);
            xl += (fl.lp * rc - xl) * F.on; xr += (fr.lp * rc - xr) * F.on;
            if (F.on === 0 && !F.want) { fl.reset(); fr.reset(); fset = false; }
          }
          // the volume lane: a gain, 1 at the top of the shape
          if (V.on > 0 || V.want || V.s2 !== 1) {
            if (V.on !== V.want) V.on = V.want ? (V.on + RAMP > 1 ? 1 : V.on + RAMP) : (V.on - RAMP < 0 ? 0 : V.on - RAMP);
            const g = smooth(V, 1 - V.depth * (1 - shape(V)) * V.on, V.settle > 0 ? kSet : kS);
            xl *= g; xr *= g;
          }
          // the pan lane: the middle panned with an equal-power law, the sides narrowing as it goes out
          if (P.on > 0 || P.want || P.s2 !== 0) {
            if (P.on !== P.want) P.on = P.want ? (P.on + RAMP > 1 ? 1 : P.on + RAMP) : (P.on - RAMP < 0 ? 0 : P.on - RAMP);
            const pos = smooth(P, P.depth * (2 * shape(P) - 1) * P.on, P.settle > 0 ? kSet : kS);
            if (pos !== 0) {
              const m = 0.5 * (xl + xr), s = 0.5 * (xl - xr), a = (pos + 1) * 0.125;
              const gr = sinT(a) * SQ2, gl = sinT(a + 0.25) * SQ2, k = gl < gr ? gl : gr;
              xl = m * gl + s * k; xr = m * gr - s * k;
            }
          }
          const mx = mixS.next(mxT);
          if (mx !== 1) { xl = dl + (xl - dl) * mx; xr = dr + (xr - dr) * mx; }
          L[i] = xl; R[i] = xr;
          V.ph += V.dph; if (V.ph >= 1) V.ph -= 1;
          F.ph += F.dph; if (F.ph >= 1) F.ph -= 1;
          P.ph += P.dph; if (P.ph >= 1) P.ph -= 1;
          if (V.settle > 0) V.settle--;
          if (F.settle > 0) F.settle--;
          if (P.settle > 0) P.settle--;
          cnt++;
        }
        started = true;
      },
    };
  },
};
`;

export default defineDevice({
  id: 'core.shaper',
  name: 'Scribble Strip',
  kind: 'effect',
  cat: 'mod',
  by: 'overdub',
  blurb: 'Draw shapes that move volume, filter and pan in time',
  nod: 'a drawable, tempo-synced volume, filter and pan shaper: sidechain-style pumping without the sidechain',
  editor: 'shaper',
  params: PARAMS,
  presets: PRESETS,
  look: {
    color: '#e8dfc8',
    ink: '#211e1a',
    shape: 'rack',
    finish: 'flat',
    knob: 'black',
    label: 'script',
    led: '#3fb68b',
  },
  tail: 0.1,
  describe,
  kernel: kernel(BODY),
});
