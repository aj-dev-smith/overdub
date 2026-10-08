// The translator lexicon: musical words -> perceptual axes -> concrete parameter moves. docs/UX-RESEARCH.md §4.
//
// This is a PRIOR, not the truth. "Warm" means different things to different people (SocialEQ: most taught word, 10th
// for agreement), and the same move means different things on different sources. So every move here is checked by
// measurement (render_and_measure / adjust) and always shown to the human as the exact params it changed.
//
//   resolveWord('warmer')            -> { word: 'warmer', axis: 'warmth', dir: 1, ask: true, root: 'warm', rootDir: 1, ... } | null
//   READINGS.warm                    -> the two audible readings offered as A/B cards (agent/lexicon-personal.js keeps the pick)
//   AXES.brightness                  -> { label, measure, params: [matchers], eq: [band moves], insert? }
//   planMoves(axisId, amount, devs)  -> [{ where, device, key, label, from, to, unit }]  (params on devices present;
//                                    a three-band compressor, core.multiband, answers "punch" and "squash" with its
//                                    depth: isMultiband)
//   eqPlan(axisId, amount, eqDef, stored) -> params patch for an EQ insert (core.eq when present; on a banded EQ,
//                                    core.eq8, the band doing that job, or a free one placed there)
//   amountOf('a_bit')                -> 0.66
//   glossBands(deltas)               -> ['low-mid +4.1 dB vs before: muddier', ...]
//
// Pure data and functions: works in Node (the MCP server imports the tool catalog, which imports this).

export const AMOUNTS = { a_touch: 0.33, a_bit: 0.66, a_lot: 1 };
export function amountOf(a) {
  if (typeof a === 'number' && Number.isFinite(a)) return Math.max(0.05, Math.min(1.5, Math.abs(a)));
  const k = String(a || 'a_bit')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return AMOUNTS[k] ?? (/(touch|tiny|little|slight)/.test(k) ? 0.33 : /(lot|much|way|very|heaps)/.test(k) ? 1 : 0.66);
}

// Bands as measure() reports them (audio/measure.js BANDS), with the words musicians use for "more" and "less".
export const BANDS = {
  sub: { label: 'sub', hz: [20, 60], up: 'more weight (sub you feel more than hear)', down: 'less sub weight' },
  low: { label: 'low', hz: [60, 250], up: 'fuller, boomier bottom', down: 'thinner, tighter bottom' },
  lowmid: { label: 'low-mid', hz: [250, 500], up: 'muddier / warmer', down: 'cleaner, less mud (can get thin)' },
  mid: { label: 'mid', hz: [500, 2000], up: 'more forward, honkier', down: 'scooped, further back' },
  highmid: {
    label: 'high-mid',
    hz: [2000, 4000],
    up: 'more bite / edge (harsh if pushed)',
    down: 'softer edge, smoother',
  },
  presence: { label: 'presence', hz: [4000, 8000], up: 'more present, crisper', down: 'darker, more distant' },
  air: { label: 'air', hz: [8000, 20000], up: 'airier, more sheen', down: 'duller, less air' },
};

// Perceptual axes. Each says how to MEASURE it (what should move, which way) and how to MOVE it:
//   params: matchers tried against every param of the devices on the target, first match per device wins.
//     { role?, unit?, key?: RegExp (tested on key and label), not?: RegExp (same, excludes), cat?: RegExp (device cat), dir: +1|-1, step?: 0..1 }
//     step is the normalised travel for amount 1 (default 0.18; log params move in log space).
//   eq: moves for an EQ insert when no param fits (band: low | lowmid | mid | highmid | high | air, db at amount 1, hz).
//   insert: a device to add when the move needs one (space -> core.verb, punch -> core.comp, width -> core.width).
// A low cut (high-pass) is a "cut" in Hz too, but moving it doesn't change brightness: top-end matchers skip it.
const LOW_CUT = /low.?cut|lo.?cut|hpf|hi.?pass|high.?pass/;
export const AXES = {
  brightness: {
    label: 'brightness',
    family: 'timbre',
    measure: { centroid: +1, bands: { presence: +1, air: +1 } },
    params: [
      { role: 'tone', unit: 'Hz', key: /cut|freq|tone|lpf|filter/, not: LOW_CUT, dir: +1, step: 0.16 },
      { role: 'tone', key: /bright|treble|presence|tone|high|tilt/, dir: +1, step: 0.2 },
    ],
    eq: [
      { band: 'high', db: 4, hz: 6000 },
      { band: 'highmid', db: 1.5, hz: 3500 },
    ],
  },
  warmth: {
    label: 'warmth',
    family: 'timbre',
    ask: true,
    root: 'warm',
    measure: { bands: { low: +1, lowmid: +1, air: -1, presence: -1 } },
    params: [
      { role: 'tone', unit: 'Hz', key: /cut|freq|tone|lpf|filter/, not: LOW_CUT, dir: -1, step: 0.1 },
      { role: 'tone', key: /bright|treble|presence|high/, dir: -1, step: 0.15 },
      { role: 'tone', key: /bass|low|warm|body/, dir: +1, step: 0.15 },
      { role: 'drive', key: /drive|sat|tape|warm|gain/, dir: +1, step: 0.1 },
    ],
    eq: [
      { band: 'low', db: 2.5, hz: 180 },
      { band: 'high', db: -2.5, hz: 7000 },
    ],
  },
  air: {
    label: 'air',
    family: 'timbre',
    measure: { bands: { air: +1 } },
    params: [{ role: 'tone', key: /air|sheen|high|treble/, dir: +1, step: 0.2 }],
    eq: [{ band: 'air', db: 3.5, hz: 11000 }],
  },
  mud: {
    label: 'mud (low-mid build-up)',
    family: 'timbre',
    measure: { bands: { lowmid: +1 } },
    params: [{ role: 'tone', key: /low.?mid|mud|body/, dir: +1, step: 0.2 }],
    eq: [{ band: 'lowmid', db: 5, hz: 300 }],
  },
  boom: {
    label: 'boom (low end)',
    family: 'timbre',
    measure: { bands: { low: +1, sub: +1 } },
    params: [
      { role: 'tone', key: /bass|low|boom/, dir: +1, step: 0.2 },
      { role: 'level', key: /sub/, dir: +1, step: 0.2 },
    ],
    eq: [{ band: 'low', db: 4, hz: 110 }],
  },
  body: {
    label: 'body / fullness',
    family: 'timbre',
    measure: { bands: { low: +1, lowmid: +1 } },
    params: [
      { role: 'level', key: /sub|body/, dir: +1, step: 0.2 },
      { role: 'width', key: /detune|unison/, dir: +1, step: 0.15 },
      { role: 'drive', dir: +1, step: 0.1 },
    ],
    eq: [{ band: 'low', db: 3, hz: 200 }],
  },
  harshness: {
    label: 'harshness',
    family: 'timbre',
    measure: { bands: { highmid: +1 } },
    params: [
      { role: 'tone', key: /bite|edge|presence|treble/, dir: +1, step: 0.18 },
      { role: 'drive', dir: +1, step: 0.15 },
    ],
    eq: [{ band: 'highmid', db: 3.5, hz: 3000 }],
  },
  honk: {
    label: 'honk (mid resonance)',
    family: 'timbre',
    measure: { bands: { mid: +1 } },
    params: [{ role: 'tone', key: /mid/, dir: +1, step: 0.2 }],
    eq: [{ band: 'mid', db: 3.5, hz: 700 }],
  },
  grit: {
    label: 'grit / drive',
    family: 'texture',
    measure: { crest: -1, bands: { highmid: +1 } },
    params: [
      { role: 'drive', dir: +1, step: 0.2 },
      { role: 'mix', cat: /drive|fuzz|glitch/, dir: +1, step: 0.2 },
    ],
    insert: { device: 'core.drive', params: {} },
  },
  punch: {
    label: 'punch',
    family: 'dynamics',
    measure: { crest: +1 },
    params: [
      { role: 'attack', cat: /dynamics/, dir: +1, step: 0.2 },
      { role: 'attack', unit: 's', dir: -1, step: 0.15 },
      { role: 'decay', key: /f\.?decay|fdecay/, dir: -1, step: 0.15 },
    ],
    insert: { device: 'core.comp', params: {} },
  },
  squash: {
    label: 'compression (squash)',
    family: 'dynamics',
    measure: { crest: -1, lra: -1 },
    params: [
      { role: 'depth', cat: /dynamics/, key: /ratio|amount|squash|comp|thresh/, dir: +1, step: 0.2 },
      { role: 'drive', cat: /dynamics/, dir: +1, step: 0.2 },
    ],
    insert: { device: 'core.comp', params: {} },
  },
  space: {
    label: 'space (reverb)',
    family: 'space',
    measure: { width: -1 },
    params: [
      { role: 'mix', cat: /ambient|verb/, dir: +1, step: 0.18 },
      { role: 'size', dir: +1, step: 0.15 },
      { role: 'decay', cat: /ambient|verb/, dir: +1, step: 0.15 },
    ],
    insert: { device: 'core.verb', params: {} },
  },
  distance: {
    label: 'distance',
    family: 'space',
    measure: { bands: { presence: -1, air: -1 }, lufs: -1 },
    params: [
      { role: 'mix', cat: /ambient|verb|time/, dir: +1, step: 0.2 },
      { role: 'tone', unit: 'Hz', key: /cut|tone/, not: LOW_CUT, dir: -1, step: 0.08 },
    ],
    eq: [{ band: 'high', db: -3, hz: 5000 }],
    insert: { device: 'core.verb', params: {} },
  },
  width: {
    label: 'stereo width',
    family: 'space',
    measure: { width: -1 },
    params: [
      { role: 'width', dir: +1, step: 0.2 },
      { role: 'depth', cat: /mod/, dir: +1, step: 0.15 },
    ],
    insert: { device: 'core.width', params: {} },
  },
  length: {
    label: 'note length / tail (tightness, as control)',
    family: 'dynamics',
    measure: { silencePct: -1 },
    params: [
      { role: 'release', dir: +1, step: 0.18 },
      { role: 'decay', dir: +1, step: 0.15 },
    ],
  },
  level: {
    label: 'level',
    family: 'mix',
    measure: { lufs: +1 },
    params: [],
  },
  // time feel: these move notes, not params (adjust handles them with notes.set on the target clip)
  swing: { label: 'swing', family: 'time', notes: 'swing', measure: {} },
  laid_back: { label: 'laid-back (behind the beat)', family: 'time', notes: 'late', measure: {} },
  tight_timing: { label: 'tight timing (quantise)', family: 'time', notes: 'quantize', measure: {} },
  dynamics: { label: 'velocity / intensity', family: 'performance', notes: 'velocity', measure: { lufs: +1 } },
};

// Words -> axes. dir +1 means "more of the axis". ask: low inter-person agreement or two meanings: offer A/B first.
export const WORDS = {
  bright: ['brightness', +1],
  brighter: ['brightness', +1],
  crisp: ['brightness', +1],
  shiny: ['brightness', +1],
  sparkly: ['brightness', +1],
  dark: ['brightness', -1],
  darker: ['brightness', -1],
  dull: ['brightness', -1],
  mellow: ['brightness', -1],
  muffled: ['brightness', -1],
  warm: [
    'warmth',
    +1,
    { ask: true, root: 'warm', note: 'low agreement between people: offer two audible versions and learn the pick' },
  ],
  warmer: ['warmth', +1, { ask: true, root: 'warm' }],
  cold: ['warmth', -1, { ask: true, root: 'warm', sign: -1 }],
  colder: ['warmth', -1, { ask: true, root: 'warm', sign: -1 }],
  airy: ['air', +1],
  air: ['air', +1],
  breathy: ['air', +1],
  muddy: ['mud', +1],
  mud: ['mud', +1],
  clean: ['mud', -1],
  clearer: ['mud', -1],
  clear: ['mud', -1],
  'less muddy': ['mud', -1],
  boomy: ['boom', +1],
  boom: ['boom', +1],
  thin: ['body', -1],
  thinner: ['body', -1],
  full: ['body', +1],
  fuller: ['body', +1],
  fat: ['body', +1, { ask: true, root: 'fat', note: '"fat" can mean layered: ask' }],
  fatter: ['body', +1, { ask: true, root: 'fat' }],
  thick: ['body', +1],
  beefy: ['body', +1],
  boxy: ['honk', +1],
  honky: ['honk', +1],
  nasal: ['honk', +1],
  harsh: ['harshness', +1],
  harsher: ['harshness', +1],
  tinny: ['harshness', +1, { note: 'tinny = thin + edgy: cut 2-5 kHz and add 100-300 Hz' }],
  shrill: ['harshness', +1],
  smooth: ['harshness', -1],
  smoother: ['harshness', -1],
  softer: ['harshness', -1],
  crunchy: ['grit', +1],
  gritty: ['grit', +1],
  dirty: ['grit', +1],
  fuzzy: ['grit', +1],
  distorted: ['grit', +1],
  dirtier: ['grit', +1],
  cleaner: ['grit', -1],
  punchy: ['punch', +1],
  punchier: ['punch', +1],
  snappy: ['punch', +1],
  'more punch': ['punch', +1],
  squashed: ['squash', +1],
  glued: ['squash', +1],
  glue: ['squash', +1],
  compressed: ['squash', +1],
  pumping: ['squash', +1],
  dynamic: ['squash', -1],
  open: ['squash', -1],
  lush: ['space', +1],
  spacious: ['space', +1],
  roomy: ['space', +1],
  wet: ['space', +1],
  ethereal: ['space', +1, { note: 'imagery word: long reverb plus shimmer; try it and listen' }],
  big: ['space', +1],
  dry: ['space', -1],
  intimate: ['space', -1],
  close: ['space', -1],
  closer: ['space', -1],
  distant: ['distance', +1],
  far: ['distance', +1],
  'further away': ['distance', +1],
  wide: ['width', +1],
  wider: ['width', +1],
  narrow: ['width', -1],
  mono: ['width', -1],
  tight: [
    'length',
    -1,
    { ask: true, root: 'tight', note: 'two meanings: timing (quantise) or control (shorter tails). Ask which.' },
  ],
  tighter: ['length', -1, { ask: true, root: 'tight' }],
  loose: ['tight_timing', -1],
  sloppy: ['tight_timing', -1],
  quantised: ['tight_timing', +1],
  quantized: ['tight_timing', +1],
  'on the grid': ['tight_timing', +1],
  swing: ['swing', +1],
  swingy: ['swing', +1],
  shuffle: ['swing', +1],
  straight: ['swing', -1],
  'laid-back': ['laid_back', +1],
  laidback: ['laid_back', +1],
  lazy: ['laid_back', +1],
  lazier: ['laid_back', +1],
  behind: ['laid_back', +1],
  pushing: ['laid_back', -1],
  urgent: ['laid_back', -1],
  louder: ['level', +1],
  quieter: ['level', -1],
  softly: ['dynamics', -1],
  gentle: ['dynamics', -1],
  tender: ['dynamics', -1],
  aggressive: ['dynamics', +1, { note: 'Juslin: louder, sharper, more staccato, slightly ahead' }],
  harder: ['dynamics', +1],
};

// Words people disagree on, and the two audible readings the studio offers for each (A/B, hold to hear). The pick is
// stored as that person's meaning (agent/lexicon-personal.js) and used from then on without asking. Keyed by root word:
// "warmer" and "colder" both resolve to "warm" (colder = the other way). Each reading is a move on one axis, written for
// "more of the word"; `opposite` names it the other way ("less warm", "colder"). Ids are forever (they are stored).
export const READINGS = {
  warm: [
    {
      id: 'darker_top',
      label: 'Darker top',
      opposite: 'Brighter top',
      axis: 'brightness',
      dir: -1,
      why: 'less sparkle: presence and air come down',
    },
    {
      id: 'fuller_lowmid',
      label: 'Fuller low-mid',
      opposite: 'Leaner low-mid',
      axis: 'body',
      dir: +1,
      why: 'more body around 150-500 Hz',
    },
  ],
  fat: [
    {
      id: 'fuller_low',
      label: 'Fuller low end',
      opposite: 'Leaner low end',
      axis: 'body',
      dir: +1,
      why: 'more weight under the part',
    },
    {
      id: 'wider_layered',
      label: 'Wider, layered',
      opposite: 'Narrower, single',
      axis: 'width',
      dir: +1,
      why: 'spread out, like a double',
    },
  ],
  tight: [
    {
      id: 'on_the_grid',
      label: 'On the grid',
      opposite: 'Looser timing',
      axis: 'tight_timing',
      dir: +1,
      why: 'notes pulled toward the beat',
    },
    {
      id: 'shorter_tails',
      label: 'Shorter tails',
      opposite: 'Longer tails',
      axis: 'length',
      dir: -1,
      why: 'notes and decays stop sooner',
    },
  ],
};
export function readingsFor(root) {
  return (root && READINGS[root]) || null;
}
// The reading as the move actually made: label for "more", opposite for "less"/"colder" (rootDir -1).
export function readingLabel(r, rootDir = 1) {
  return rootDir < 0 ? r.opposite || `less: ${r.label.toLowerCase()}` : r.label;
}

// -> { word, axis, dir, ask, root?, rootDir?, ...the axis }. rootDir: +1 when the word means more of its root ("warmer",
// "warm"), -1 when it means less ("colder", "less warm"); only set for words with READINGS.
export function resolveWord(word) {
  if (!word) return null;
  const w = String(word).toLowerCase().trim();
  if (AXES[w]) return { word: w, axis: w, dir: 1, ...AXES[w], rootDir: 1 };
  const alias = {
    brightness: 'brightness',
    warmth: 'warmth',
    reverb: 'space',
    compression: 'squash',
    drive: 'grit',
    distortion: 'grit',
    stereo: 'width',
    loudness: 'level',
    volume: 'level',
    timing: 'tight_timing',
    groove: 'swing',
  };
  if (alias[w]) return { word: w, axis: alias[w], dir: 1, ...AXES[alias[w]], rootDir: 1 };
  const e = WORDS[w] || WORDS[w.replace(/^(more|less|a bit|bit)\s+/, '')] || WORDS[w.replace(/(er|ier)$/, '')];
  if (e) {
    const neg = /^less\s/.test(w) ? -1 : 1;
    return {
      word: w,
      axis: e[0],
      dir: e[1] * neg,
      ...(e[2] || {}),
      ...AXES[e[0]],
      ask: !!(e[2]?.ask || AXES[e[0]].ask),
      root: e[2]?.root || AXES[e[0]].root,
      rootDir: (e[2]?.sign ?? 1) * neg,
    };
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- param moves */
const isLog = (p) => p.curve === 'log' && p.min > 0 && p.max > 0;
const toNorm = (p, v) =>
  isLog(p) ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min || 1);
const fromNorm = (p, n) => {
  n = Math.max(0, Math.min(1, n));
  return isLog(p) ? p.min * Math.pow(p.max / p.min, n) : p.min + n * (p.max - p.min);
};
const tidy = (p, v) =>
  p.step ? Math.round(v / p.step) * p.step : Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000;

function matches(m, p, def) {
  if (p.opts) return false; // switches are choices, not amounts
  if (m.role && p.role !== m.role) return false;
  if (m.unit && p.unit !== m.unit) return false;
  if (m.cat && !m.cat.test(def.cat || '') && !m.cat.test(def.id)) return false;
  if (m.key && !m.key.test(String(p.key).toLowerCase()) && !m.key.test(String(p.label || '').toLowerCase()))
    return false;
  if (m.not && (m.not.test(String(p.key).toLowerCase()) || m.not.test(String(p.label || '').toLowerCase())))
    return false;
  return true;
}

// A three-band upward and downward compressor (core.multiband, Gaffer Tape: DEPTH, TIME and per band <band>_attack,
// <band>_down_thresh, <band>_up_thresh for low, mid and high) gets a plan of its own. "Punch" and "squash" are its
// DEPTH: more depth lifts the quiet between hits and holds the loud parts, so it measures denser (a lower crest factor)
// on drums, a bass and a mix: "squashed", "glued" and "compressed" turn it up, "punchier" and "more dynamic" down
// (tools/multiband-test.js measures both through adjust). Every other word leaves it alone: it is dynamics, not tone,
// and its many dB and ms params would otherwise answer words they don't mean. At a depth near 0 it plans nothing (it
// isn't working), so adjust does what it did without it.
const MB_KEYS = ['low', 'mid', 'high'];
export function isMultiband(def) {
  const keys = new Set((def?.params || []).map((p) => p.key));
  return (
    keys.has('depth') &&
    keys.has('time') &&
    MB_KEYS.every((b) => keys.has(`${b}_attack`) && keys.has(`${b}_down_thresh`) && keys.has(`${b}_up_thresh`))
  );
}
function multibandPlan(axisId, amount, d, dir) {
  if (axisId !== 'punch' && axisId !== 'squash') return [];
  const p = d.def.params.find((q) => q.key === 'depth');
  const from = Number(d.values?.depth ?? p.def),
    sign = axisId === 'punch' ? -dir : dir;
  if (from < p.min + 0.05 * (p.max - p.min)) return [];
  const to = tidy(p, Math.max(p.min, Math.min(p.max, from + sign * amount * 0.25 * (p.max - p.min)))); // a_bit: about 16 points
  return Math.abs(to - from) < 1e-9
    ? []
    : [{ where: d.where, device: d.def.id, key: 'depth', label: p.label, unit: p.unit || '', from, to }];
}

// devs: [{ where: 'instrument' | insertId, def, values (the full current values) }]. Returns concrete moves.
export function planMoves(axisId, amount, devs, dir = 1) {
  const ax = AXES[axisId];
  if (!ax || !ax.params) return [];
  const out = [];
  for (const d of devs) {
    if (!d.def || !d.def.params) continue;
    if (isMultiband(d.def)) {
      out.push(...multibandPlan(axisId, amount, d, dir));
      continue;
    }
    const used = new Set();
    for (const m of ax.params) {
      const p = d.def.params.find((q) => !used.has(q.key) && matches(m, q, d.def));
      if (!p) continue;
      used.add(p.key);
      const from = Number(d.values?.[p.key] ?? p.def);
      const n0 = toNorm(p, from);
      const to = tidy(p, fromNorm(p, n0 + m.dir * dir * amount * (m.step ?? 0.18)));
      if (Math.abs(to - from) < 1e-9) continue;
      out.push({ where: d.where, device: d.def.id, key: p.key, label: p.label, unit: p.unit || '', from, to });
    }
  }
  return out;
}

// Scale an existing set of moves (for the measure-and-correct pass): factor 1.6 pushes further, 0.5 pulls back.
export function scaleMoves(moves, factor, defs) {
  return moves.map((mv) => {
    const p = defs(mv.device)?.params.find((q) => q.key === mv.key);
    if (!p) return mv;
    const a = toNorm(p, mv.from),
      b = toNorm(p, mv.to);
    return { ...mv, to: tidy(p, fromNorm(p, a + (b - a) * factor)) };
  });
}

// EQ band moves onto whatever EQ device is present (core.eq when it lands). Finds band gain params by key/label words.
const BAND_WORDS = {
  low: /^(low|bass|ls|lo)(?!.*mid)|low.?shelf|lowgain|low_gain/,
  lowmid: /low.?mid|lmid/,
  mid: /^mid|^(peak|bell)|mid.?gain/,
  highmid: /high.?mid|hmid|upper.?mid/,
  high: /^(high|hi|treble|hs)(?!.*mid)|high.?shelf|highgain/,
  air: /air|^hs|high.?shelf|high/,
};
// A banded parametric EQ (core.eq8, Slide Rule: b<n>_on, b<n>_type, b<n>_freq, b<n>_gain, b<n>_q, the type a BELL, LOW
// SHELF or HIGH SHELF among others): a move goes to a band already doing that job near that frequency (its gain moves:
// a bell within two thirds of an octave, a shelf within one), else to a free band (off, every setting at its default),
// the one parked nearest, switched on as a bell or a shelf there with Q 1. 'low' is a low shelf, 'high' and 'air' a high
// shelf, the rest bells. Placing a band (on, type, frequency) is fixed under the measure-and-correct pass (eqFreq); its
// gain scales. Every band busy: no moves (the caller adds another EQ).
const BANDED = /^b(\d+)_(on|type|freq|gain|q)$/;
function bandedPlan(ax, amount, eqDef, stored, dir) {
  const P = new Map(eqDef.params.map((p) => [p.key, p]));
  const nums = [...new Set(eqDef.params.map((p) => BANDED.exec(p.key)?.[1]).filter(Boolean))]
    .map(Number)
    .filter((n) => ['on', 'type', 'freq', 'gain', 'q'].every((k) => P.has(`b${n}_${k}`)));
  if (nums.length < 2 || !P.get(`b${nums[0]}_type`).opts) return null;
  const val = (k) => {
    const p = P.get(k),
      v = stored[k];
    if (typeof v === 'string' && p.opts) return p.opts.findIndex((o) => String(o).toLowerCase() === v.toLowerCase());
    return Number(v ?? p.def);
  };
  const opts = P.get(`b${nums[0]}_type`).opts.map((o) => String(o).toUpperCase());
  const BELL = opts.indexOf('BELL'),
    LS = opts.indexOf('LOW SHELF'),
    HS = opts.indexOf('HIGH SHELF');
  if (BELL < 0 || LS < 0 || HS < 0) return null;
  const isDefault = (n) =>
    ['on', 'type', 'freq', 'gain', 'q'].every((k) => Math.abs(val(`b${n}_${k}`) - P.get(`b${n}_${k}`).def) < 1e-9);
  const patch = {},
    moves = [],
    taken = new Set();
  for (const mv of ax.eq) {
    const want = mv.band === 'low' ? LS : mv.band === 'high' || mv.band === 'air' ? HS : BELL;
    const oct = (f) => Math.abs(Math.log2(f / mv.hz));
    let n = nums
      .filter(
        (m) =>
          !taken.has(m) &&
          val(`b${m}_on`) >= 0.5 &&
          Math.round(val(`b${m}_type`)) === want &&
          oct(val(`b${m}_freq`)) <= (want === BELL ? 0.67 : 1),
      )
      .sort((a, b) => oct(val(`b${a}_freq`)) - oct(val(`b${b}_freq`)))[0];
    const fresh = n == null;
    if (fresh)
      n = nums
        .filter((m) => !taken.has(m) && isDefault(m))
        .sort((a, b) => oct(P.get(`b${a}_freq`).def) - oct(P.get(`b${b}_freq`).def))[0];
    if (n == null) continue;
    taken.add(n);
    const gk = `b${n}_gain`,
      gp = P.get(gk),
      from = val(gk);
    const to = Math.round(Math.max(gp.min, Math.min(gp.max, from + mv.db * amount * dir)) * 10) / 10;
    if (to === from) continue;
    if (fresh) {
      const fk = `b${n}_freq`,
        fp = P.get(fk),
        f = Math.max(fp.min, Math.min(fp.max, mv.hz)),
        tk = `b${n}_type`,
        qk = `b${n}_q`;
      patch[`b${n}_on`] = 1;
      patch[tk] = want;
      patch[fk] = f;
      patch[qk] = 1;
      moves.push({ key: `b${n}_on`, label: P.get(`b${n}_on`).label, unit: '', from: 0, to: 1, eqFreq: true });
      if (want !== P.get(tk).def)
        moves.push({ key: tk, label: P.get(tk).label, unit: '', from: P.get(tk).def, to: want, eqFreq: true });
      if (Math.abs(f - fp.def) > 0.5) moves.push({ key: fk, label: fp.label, unit: 'Hz', from: fp.def, to: f });
      if (Math.abs(1 - P.get(qk).def) > 1e-9)
        moves.push({ key: qk, label: P.get(qk).label, unit: '', from: P.get(qk).def, to: 1, eqFreq: true });
    }
    patch[gk] = to;
    moves.push({ key: gk, label: gp.label, unit: 'dB', from, to });
  }
  return { patch, moves };
}
export function eqPlan(axisId, amount, eqDef, stored = {}, dir = 1) {
  const ax = AXES[axisId];
  if (!ax?.eq || !eqDef) return null;
  const banded = bandedPlan(ax, amount, eqDef, stored || {}, dir);
  if (banded) return banded;
  const patch = {},
    moves = [];
  const gains = eqDef.params.filter(
    (p) => p.unit === 'dB' && !/^(out|output|trim|level|master|gain|makeup)$/i.test(p.key),
  );
  for (const mv of ax.eq) {
    const re = BAND_WORDS[mv.band];
    let p = gains.find((q) => re.test(q.key.toLowerCase()) || re.test(String(q.label).toLowerCase()));
    if (!p && (mv.band === 'lowmid' || mv.band === 'highmid'))
      p = gains.find((q) => BAND_WORDS.mid.test(q.key.toLowerCase()));
    if (!p) continue;
    const from = Number(stored[p.key] ?? p.def);
    const to = Math.round(Math.max(p.min, Math.min(p.max, from + mv.db * amount * dir)) * 10) / 10;
    if (to === from) continue;
    patch[p.key] = to;
    moves.push({ key: p.key, label: p.label, unit: 'dB', from, to });
    // a matching frequency param for a sweepable band (mid bells): point it at the band's centre
    const stem = p.key.replace(/gain|_g$|g$/i, '');
    const f = eqDef.params.find(
      (q) => q.unit === 'Hz' && q.key !== p.key && stem && q.key.toLowerCase().startsWith(stem.toLowerCase()),
    );
    if (f && mv.hz && /mid|bell|peak/.test(p.key)) {
      const hz = Math.max(f.min, Math.min(f.max, mv.hz));
      const fFrom = Number(stored[f.key] ?? f.def);
      if (Math.abs(fFrom - hz) > 1) {
        patch[f.key] = hz;
        moves.push({ key: f.key, label: f.label, unit: 'Hz', from: fFrom, to: hz });
      }
    }
  }
  return moves.length ? { patch, moves } : null;
}

/* ---------------------------------------------------------------------------------------------- glosses */
const f1 = (x) => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(1);
// deltas: { bands: { lowmid: 4.1, ... }, bandsAbs?, bandLevels?, lufs, truePeak, centroid (ratio or Hz delta), width, crest }
// With bandsAbs (tools.js deltas()) bands are glossed from their own energy, not their share of the total: cutting the
// loudest band doesn't read as boosts everywhere else. A band more than 40 dB under the total, before and after, isn't
// heard and isn't glossed; when every audible band moved by the same amount it was a level change (the LU line says it).
export const AUDIBLE_BAND_DB = -40;
export function glossDeltas(d, { ref = 'before' } = {}) {
  const out = [];
  if (!d) return out;
  if (d.bandsAbs) {
    const heard = Object.entries(d.bandsAbs).filter(
      ([k, v]) => Number.isFinite(v) && (d.bandLevels?.[k] ?? 0) > AUDIBLE_BAND_DB,
    );
    const vals = heard.map(([, v]) => v);
    const uniform = vals.length && Math.max(...vals) - Math.min(...vals) < 1.5;
    if (!uniform)
      for (const [k, v] of heard) {
        if (Math.abs(v) < 1.5) continue;
        const b = BANDS[k];
        if (b) out.push(`${b.label} ${f1(v)} dB vs ${ref}: ${v > 0 ? b.up : b.down}`);
      }
  } else if (d.bands) {
    for (const [k, v] of Object.entries(d.bands)) {
      if (!Number.isFinite(v) || Math.abs(v) < 1.5) continue;
      const b = BANDS[k];
      if (b) out.push(`${b.label} ${f1(v)} dB vs ${ref}: ${v > 0 ? b.up : b.down}`);
    }
  }
  if (Number.isFinite(d.lufs) && Math.abs(d.lufs) >= 0.7)
    out.push(
      `${f1(d.lufs)} LU vs ${ref}: ${d.lufs > 0 ? 'louder' : 'quieter'}${Math.abs(d.lufs) >= 3 ? ' (clearly)' : ''}`,
    );
  if (Number.isFinite(d.centroidPct) && Math.abs(d.centroidPct) >= 8)
    out.push(
      `brightness centre ${d.centroidPct > 0 ? '+' : '−'}${Math.abs(Math.round(d.centroidPct))}%: ${d.centroidPct > 0 ? 'brighter' : 'darker'}`,
    );
  if (Number.isFinite(d.crest) && Math.abs(d.crest) >= 1.2)
    out.push(
      `crest ${f1(d.crest)} dB: ${d.crest > 0 ? 'punchier, more dynamic transients' : 'more squashed / denser'}`,
    );
  if (Number.isFinite(d.width) && Math.abs(d.width) >= 0.06)
    out.push(
      `stereo correlation ${d.width > 0 ? '+' : '−'}${Math.abs(d.width).toFixed(2)}: ${d.width < 0 ? 'wider' : 'narrower, more mono'}`,
    );
  if (Number.isFinite(d.onsetsPerSec) && Math.abs(d.onsetsPerSec) >= 0.8)
    out.push(`${d.onsetsPerSec > 0 ? 'busier' : 'sparser'} (${f1(d.onsetsPerSec)} onsets/s)`);
  return out;
}

// One-line musician glosses for a single measurement (no baseline). { track: true }: one track on its own, whose LUFS
// is a track level (how it sits needs the rest of the mix: render_and_measure per_track), not a mix or master level.
export function glossLevels(m, { track = false } = {}) {
  const out = [];
  if (!m) return out;
  if (m.silencePct > 90)
    out.push('almost silent here: is the track muted, empty in this range, or the audio not loaded?');
  if (track && m.lufs > -120)
    out.push(
      `${m.lufs} LUFS for this track on its own (a track level, not a mix level: per_track: true shows how it sits against the rest)`,
    );
  else if (m.lufs > -120) {
    if (m.lufs > -9) out.push(`${m.lufs} LUFS: very loud (club-master territory)`);
    else if (m.lufs > -16) out.push(`${m.lufs} LUFS: around streaming loudness (-14)`);
    else if (m.lufs > -26) out.push(`${m.lufs} LUFS: a healthy mix level, room left for mastering`);
    else out.push(`${m.lufs} LUFS: quiet`);
  }
  if (m.truePeak > -1) out.push(`true peak ${m.truePeak} dBTP: over -1, risks clipping once exported`);
  if (m.clipped > 0) out.push(`${m.clipped} samples at or over full scale: it is clipping`);
  if (m.bands) {
    const top = Object.entries(m.bands).sort((a, b) => b[1] - a[1])[0];
    if (top) out.push(`most energy in the ${BANDS[top[0]]?.label || top[0]} band`);
    if (m.bands.lowmid > -6 && m.bands.lowmid > (m.bands.mid ?? -99) + 3)
      out.push('low-mids are heavy: could read as muddy');
  }
  if (Number.isFinite(m.correlation) && m.channels > 1)
    out.push(
      m.correlation > 0.95
        ? 'essentially mono'
        : m.correlation < 0.3
          ? 'very wide (check it in mono)'
          : 'some stereo width',
    );
  return out;
}

// A short summary of the lexicon for the system prompt.
export function lexiconSummary() {
  const byAxis = {};
  for (const [w, [ax, dir]] of Object.entries(WORDS))
    (byAxis[ax] ||= { more: [], less: [] })[dir > 0 ? 'more' : 'less'].push(w);
  return Object.entries(byAxis)
    .map(
      ([ax, v]) =>
        `- ${ax}: more = ${v.more.slice(0, 7).join(', ') || '—'}${v.less.length ? `; less = ${v.less.slice(0, 6).join(', ')}` : ''}${AXES[ax]?.ask ? ' (ASK: low agreement / two meanings)' : ''}`,
    )
    .join('\n');
}
