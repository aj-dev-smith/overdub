// Light Table's window (core.wavetable). docs/research/LIGHT-TABLE.md is the synth's design note: section 2 is the
// param map this editor is built on, section 7 what it draws. The window around it (ui/plugin.js) brings the presets,
// A/B, the scope and the keyboard; this is its body, built from the window's ctx like any editor.
//
//   Osc A, Osc B   The table, drawn as a stack of its 49 frames in perspective and cut at the frame POS plays: the
//                  frames behind the cut solid, the ones in front as hairlines. Or the frame flat, or its harmonics.
//                  Drag on it (or use the arrow keys) for POS. The warp is drawn into every frame (wavetable.js
//                  warpCycle: the kernel's phase maps). The table's name opens the picker, each table drawn small with
//                  a few words on what it sounds like. Unison is drawn as its voices across the stereo field and in
//                  pitch (unisonVoices). Octave, semitone, fine, level, pan, and whether it goes through the filter.
//   Filter         Its curve is the exact small-signal response of the kernel's filters (filterResponse: the same
//                  coefficients, and each filter is a zero-delay one, so its response is its prototype's at the
//                  prewarped frequency). Drag on it: across is the cutoff, up and down the resonance. FLT DRIVE has no
//                  frequency response: its saturation is the small curve in the corner (driveCurve).
//   Envelopes      Three, in tabs, drawn with the kernel's segment law (envSegment), with a handle for each point and
//                  one for the curve. Each segment is as wide as its knob's travel, at a knob's scale (180 px for the
//                  whole travel) or what fits; a point dragged moves its value at a knob's rate, under the pointer.
//   LFOs           Four, in tabs: the shape (lfoShape), the rate or the note value, the mode.
//   Matrix         The eight slots as sentences ("LFO 1 → A POS, +35%"), each part a control.
//   Macros, FX     The four macros big; drive, chorus, delay and room compact; the voicing.
//
// Drag to modulate. Every source has a jack: the envelopes and LFOs on their tabs, each macro under its knob, and
// velocity, note, the mod wheel and random beside the macros. Drag one onto a knob (or click it and then a knob; or
// Enter on it and Enter on a knob) and the first free slot gets that source and that knob: one undo step, signed you.
// The knob then wears a ring whose arc is the amount, exactly, in the knob's travel (wavetable.js DEST_TARGETS), and
// keeps room for it, so the ring never covers the knob's name or value. Drag the ring for the amount; right-click it
// (or Delete) to empty the slot. PITCH, FINE, AMP and PAN move the whole voice and have no knob: they are jacks in
// Voice. While a cable is out, the knobs it can reach are marked, and tabs open when it rests on them.
//
// History and touch. Every change made here is named in History in words with its value ("Light Table: LFO 1 →
// Cutoff, +4.0 oct"), never by a param's key. On a touch screen the window says tap, slide and the matrix's ×, never
// right-click, click or drag. A screen under 890 px tall (a 1280 x 800 laptop) gets the same bands drawn tighter, so the
// matrix and the macros sit above the window's keyboard.
//
// Movement you can see. While notes play (the song's, the window's keyboard, MIDI and musical typing on this track),
// the editor works out the newest note's modulation on the main thread from the params, the notes and the transport
// (envAt, lfoShape, lfoFree, modMatrix, cutoffAt): where POS has gone shows as a frame in grease pencil, the filter's
// curve where the cutoff is now, a tick on every ring, a dot on the envelope and the LFO. It is exact where the song
// decides (the envelopes, a synced LFO in FREE, velocity, note, the macros) and close where the kernel keeps state the
// page can't see (a free LFO's phase, each note's random values, the kernel's smoothing). Nothing comes back from the
// kernel: there is no channel for it.
//
// Drawing. Everything draws on the kit's canvases, from the window's frame, and only when it changed (or moves). The
// 3D stack is projected once per table, warp and size, and rendered to a cached layer per cut; a frame of playing
// draws that layer and one line over it. root.__lt is for tools/wavetable-ui-test.js: each view's state, the frame times.

import { h, css, clamp } from '../dom.js';
import { popover, gestureLabel } from '../rack.js';
import { lightTables } from '../../devices/builtin/wavetables.js';
import {
  SOURCES, DESTS, FILTERS, LFO_SYNCS, DEST_TARGETS, warpCycle, filterResponse, cutoffAt, driveCurve,
  envSegment, envAt, lfoShape, lfoFree, lfoHz, unisonVoices, modMatrix,
} from '../../devices/builtin/wavetable.js';

/* ================================================================ the tables */
// a few words on what each table sounds like (LIGHT-TABLE.md section 3, "reach for it for"), and where its landmarks
// are along POS
const WORDS = ['the analogue basics', 'pulse width, swept', 'opens like a filter', 'sung vowels, talking leads', 'the hard-sync sweep', 'bells, mallets, struck plucks',
  'drawbar organ', 'a digital edge, FM basses', 'hollow, square-like leads', 'lo-fi and crushed', 'glassy pads, shimmer', 'the talking bass growl', 'woodwinds and clavs', 'eight-bit leads and arps'];
const MARKS = [
  [[0, 'sine'], [1 / 3, 'triangle'], [2 / 3, 'saw'], [1, 'square']],
  [[0, '50%'], [0.5, '27%'], [1, '4%']],
  [[0, '1 harmonic'], [0.5, '25'], [1, '49']],
  [[0, 'A'], [0.25, 'E'], [0.5, 'I'], [0.75, 'O'], [1, 'U']],
  [[0, '1×'], [0.4, '3×'], [0.8, '5×'], [1, '6×']],
  [[0, 'soft'], [1, 'clang']],
  [[0, '008400000'], [0.5, '888800000'], [1, '888888888']],
  [[0, 'index 0'], [0.5, '2.3'], [1, '6.5']],
  [[0, 'hollow'], [1, 'saw']],
  [[0, '64 steps'], [1, '3 steps']],
  [[0, 'low sparkle'], [1, 'high']],
  [[0, 'closed'], [1, 'open']],
  [[0, 'clarinet'], [1, 'oboe']],
  [[0, '12.5%'], [1 / 3, '25%'], [2 / 3, '50%'], [1, '4-bit']],
];
let LTS = null;
const LT = () => (LTS ||= lightTables());
const FR = 49, VIEW_N = 128, SRC_N = 256, HI_N = 1024;
// every frame of a table at n points (LT.frames: a few milliseconds a table, so each is built once a page)
const framesCache = new Map();
function framesOf(t, n = SRC_N) {
  const k = t + ':' + n;
  if (!framesCache.has(k)) framesCache.set(k, LT().frames(t, n));
  return framesCache.get(k);
}
const hiCache = new Map();
function frameHi(t, f) {
  const k = t + ':' + f;
  if (!hiCache.has(k)) { if (hiCache.size > 160) hiCache.delete(hiCache.keys().next().value); hiCache.set(k, LT().frame(t, f / (FR - 1), HI_N)); }
  return hiCache.get(k);
}
// the frame the kernel reads at POS x: between its two nearest frames, linearly (Osc.run)
function frameAt(t, x, hi = false, out = null) {
  const fp = clamp(x, 0, 1) * (FR - 1), f0 = Math.min(FR - 2, Math.floor(fp)), w = fp - f0;
  const a = hi ? frameHi(t, f0) : framesOf(t)[f0], b = hi ? frameHi(t, f0 + 1) : framesOf(t)[f0 + 1];
  const o = out || new Float32Array(a.length);
  for (let i = 0; i < o.length; i++) o[i] = a[i] + (b[i] - a[i]) * w;
  return o;
}
// the picker's thumbnails: nine frames of each table at 64 points
const thumbCache = new Map();
function thumbFrames(t) {
  if (!thumbCache.has(t)) { const out = []; for (let i = 0; i <= 8; i++) out.push(LT().frame(t, i / 8, 64)); thumbCache.set(t, out); }
  return thumbCache.get(t);
}

/* ================================================================ sources and destinations */
const spaced = (s) => String(s).replace(/^(ENV|LFO)(\d)/, '$1 $2');
const SRC_NAME = SOURCES.map(spaced);
const DEST_NAME = DESTS.map((d) => spaced(d).replace(/^M(\d) AMT$/, 'M$1 amount'));
const SRC_SHORT = SOURCES.map((s) => ({ VELOCITY: 'Velocity', NOTE: 'Note', 'MOD WHEEL': 'Wheel', RANDOM: 'Random' }[s] || spaced(s)));
// the sources that swing both ways (-1..1): the LFOs, NOTE and RANDOM; the rest run 0..1
const BIPOLAR = new Set([4, 5, 6, 7, 9, 15]);
// an amount a new patch starts at: a semitone on a pitch, a quarter of the travel elsewhere (25 cents on FINE)
const startAmount = (d) => (d === 3 || d === 9 || d === 18 ? 1 / 24 : 0.25);
// a destination's index for a knob's key (the jacks: '@18' etc.)
const DEST_OF = new Map();
DEST_TARGETS.forEach((t, d) => { if (t) DEST_OF.set(t.key || '@' + d, d); });
const JACKS = [[18, 'Pitch', '24 semitones'], [19, 'Fine', '1 semitone'], [20, 'Amp', 'twice the level'], [21, 'Pan', 'one side at 0.5']];
const pct = (a) => `${a > 0 ? '+' : a < 0 ? '−' : ''}${Math.round(Math.abs(a) * 100)}%`;
// what an amount means at a destination, in its own units
function amountWords(d, a) {
  const x = Math.abs(a), s = a < 0 ? '−' : '+';
  if (d === 15) return `${s}${(x * 10).toFixed(x * 10 < 10 ? 1 : 0)} oct`;
  if (d === 3 || d === 9 || d === 18) return `${s}${(x * 24).toFixed(x * 24 < 10 ? 1 : 0)} st`;
  if (d === 19) return `${s}${Math.round(x * 100)} ct`;
  return pct(a);
}
// History's words (the editor's said(): "Light Table: LFO 1 → Cutoff, +4.0 oct", "Light Table: osc A position 0.525"):
// a source and a destination by name, every other param by what it moves
const SRC_WORD = SOURCES.map((s, i) => { const w = s.replace(/^(ENV|LFO)(\d)$/, '$1 $2'); return i === 0 ? 'nothing' : w.startsWith('LFO') ? w : w.charAt(0) + w.slice(1).toLowerCase(); });
const OSC_PART = { POS: 'position', WARP: 'warp', PITCH: 'pitch', LEVEL: 'level', PAN: 'pan', DETUNE: 'detune' };
const DEST_WORD = DESTS.map((d) => {
  let m;
  if ((m = /^([AB]) (\w+)$/.exec(d))) return `Osc ${m[1]} ${OSC_PART[m[2]]}`;
  if ((m = /^LFO(\d) RATE$/.exec(d))) return `LFO ${m[1]} rate`;
  if ((m = /^M(\d) AMT$/.exec(d))) return `Slot ${m[1]} amount`;
  return { OFF: 'nothing', 'FLT DRIVE': 'Filter drive', RESO: 'Resonance', FINE: 'Fine tune', 'VERB MIX': 'Room mix' }[d] || d.charAt(0) + d.slice(1).toLowerCase();
});
const OSC_KEY = { pos: 'position', warp: 'warp', warp_amt: 'warp amount', unison: 'voices', detune: 'detune', blend: 'blend', spread: 'spread', oct: 'octave', semi: 'semitones', fine: 'fine tune', level: 'level', pan: 'pan' };
const KEY_WORD = {
  sub_shape: 'sub wave', sub_oct: 'sub octave', sub_level: 'sub level', noise_level: 'noise level', noise_color: 'noise colour',
  flt_type: 'filter', flt_cutoff: 'cutoff', flt_res: 'resonance', flt_drive: 'filter drive', flt_key: 'key track', flt_env: 'filter envelope', flt_vel: 'filter velocity',
  fx_drive: 'drive', fx_drive_mix: 'drive mix', fx_chorus_depth: 'chorus depth', fx_chorus_mix: 'chorus mix', fx_delay_time: 'delay time', fx_delay_fb: 'delay feedback',
  fx_delay_mix: 'delay mix', fx_verb_size: 'room size', fx_verb_mix: 'room mix', voice_mode: 'voices', voice_glide: 'glide', voice_level: 'volume',
};
// [what it belongs to, what it is] for a param key: ['amp', 'decay'], ['LFO 1', 'sync'], ['osc A', 'position']
function keyWords(k) {
  let m;
  if ((m = /^([ab])_(.+)$/.exec(k))) return [`osc ${m[1].toUpperCase()}`, OSC_KEY[m[2]] || m[2]];
  if ((m = /^env([123])_(.+)$/.exec(k))) return [m[1] === '1' ? 'amp' : `env ${m[1]}`, m[2] === 'vel' ? 'velocity' : m[2]];
  if ((m = /^lfo([1-4])_(.+)$/.exec(k))) return [`LFO ${m[1]}`, m[2]];
  if ((m = /^macro([1-4])$/.exec(k))) return ['', `macro ${m[1]}`];
  return ['', KEY_WORD[k] || k.replace(/_/g, ' ')];
}
// a switch's option as words: SAW UP is "saw up", 1 BAR "1 bar"; the filters' and warps' names stay (LP24, HP, FM, S&H)
const optWord = (s) => String(s).replace(/[A-Z]{2,}/g, (w) => (/^(LP|HP|BP|FM|PW)$/.test(w) ? w : w.toLowerCase()));

/* ================================================================ drawing helpers */
const A0 = Math.PI * 0.75, SPAN = Math.PI * 1.5;   // a knob's travel: from 135° (lower left) round to 45° (lower right)
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return `rgba(236,230,214,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function arcPath(cx, cy, r, a, b) {
  if (Math.abs(b - a) < 0.004) return '';
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const x1 = cx + r * Math.cos(lo), y1 = cy + r * Math.sin(lo), x2 = cx + r * Math.cos(hi), y2 = cy + r * Math.sin(hi);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${hi - lo > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}
const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : Math.round(f) + ' Hz');
const hash01 = (n) => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; return (x >>> 8) / 16777216; };
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

let uid = 0;

/* ================================================================ the editor */
export function mount(el, ctx) {
  css('plugin-wavetable', CSS);
  const { app, def, kit } = ctx;
  const ui = app.ui, store = app.store, track = ctx.addr.track;
  const name = def.name || 'Light Table';
  const id = 'lt' + (++uid);
  const S = (ui.state.wavetableEditor ||= { view: { a: '3d', b: '3d' }, env: 0, lfo: 0, bot: 'mx', tab: 'osca' });
  const PHONE = window.matchMedia('(max-width: 900px)');
  // a touch screen gets touch words: tap, slide, the × in the matrix (no right-click, Alt, click or drag)
  const COARSE = window.matchMedia('(pointer: coarse)');
  const touch = () => COARSE.matches;
  let P = ctx.params();
  let alive = true;
  const offs = [];
  const root = h('div.lt', { dataset: { tab: S.tab } });
  // inks: the device's own colours for its displays, the room's for the rest
  const style = getComputedStyle(el.closest('.pw') || document.documentElement);
  const tokv = (n, d) => (style.getPropertyValue(n) || '').trim() || d;
  const INK = { ground: tokv('--pw-pc', '#1d2a33'), ink: tokv('--pw-pi', '#ece6d6'), pencil: tokv('--accent-2', '#f1dc8a'), agent: tokv('--agent', '#4cc3ff'), text3: tokv('--text-3', '#9a8f7c') };
  const MONO = (style.getPropertyValue('--font-mono') || 'monospace').trim();
  const phone = () => PHONE.matches;
  const fontPx = () => (phone() ? 12 : 10.5);

  /* ---------------------------------------------------------------- frame timing (root.__lt.stats) */
  const times = [];          // the last frames' cost, ms: the editor's frame() plus its canvases' draws
  let acc = 0;               // this frame's draws so far
  const parts = new Map();   // what each canvas has cost since the stats were reset: name -> { ms, n, max }
  const tally_ = (name, ms) => { const x = parts.get(name) || { ms: 0, n: 0, max: 0 }; x.ms += ms; x.n++; x.max = Math.max(x.max, ms); parts.set(name, x); };
  const timed = (fn, name) => (g, o) => { const t0 = performance.now(); try { fn(g, o); } finally { const ms = performance.now() - t0; acc += ms; tally_(name, ms); } };
  const canvases = [];
  const cv = (o) => {
    const name = o.className || 'canvas';
    const c = kit.canvas({ ...o, draw: o.draw ? timed(o.draw, name) : null });
    const set = c.set;
    c.set = (x = {}) => set(x.draw ? { ...x, draw: timed(x.draw, name) } : x);
    canvases.push(c);
    return c;
  };

  /* ---------------------------------------------------------------- bound controls */
  const p = (k) => ctx.param(k);
  const sentence = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };

  /* ---------------------------------------------------------------- History's words */
  // What History calls a change made here: words and the value, never a param's key ("Light Table: osc A position
  // 0.525", "Light Table: LFO 1 → Cutoff, +4.0 oct", "Light Table: amp decay 0.33 s, sustain 0.800"). The window's own
  // gestures pass them to ctx.set (put), whose frame renames a drag's one entry with each move, so it ends on the value
  // let go at. The knobs, switches and lists made with ctx.control are named by the frame from their printed labels
  // ("Light Table: M1 amount 0.40"): an entry one of those makes here gets this window's words for it instead
  // (nameEntry, on the store's change), a slot's amount as its sentence.
  function saidOf(patch) {
    const keys = Object.keys(patch).filter((k) => p(k));
    if (!keys.length) return 'a change';
    // one slot of the matrix: its sentence once changed
    const ns = new Set(keys.map((k) => /^m(\d)_/.exec(k)?.[1]));
    if (ns.size === 1 && !ns.has(undefined)) {
      const n = [...ns][0], at = (f) => patch[`m${n}_${f}`] ?? P[`m${n}_${f}`];
      const src = at('src') | 0, dst = at('dst') | 0, amt = +at('amt') || 0;
      if (!src && !dst) return keys.length > 1 ? `slot ${n} emptied` : `slot ${n} amount ${pct(amt)}`;
      return `${SRC_WORD[src]} → ${DEST_WORD[dst]}, ${dst ? amountWords(dst, amt) : pct(amt)}`;
    }
    if (keys.length > 3) return `${keys.length} controls`;
    let head = null;
    return keys.map((k) => {
      const v = patch[k], sp = p(k);
      let m;
      if ((m = /^([ab])_table$/.exec(k))) return `osc ${m[1].toUpperCase()} on ${LT().TABLES[v | 0]?.name || v}`;
      if ((m = /^flt_(a|b|sub|noise)$/.exec(k))) return `${{ a: 'osc A', b: 'osc B', sub: 'the sub', noise: 'the noise' }[m[1]]} ${(v | 0) ? 'through' : 'around'} the filter`;
      const [of, what] = keyWords(k), val = sp.opts ? optWord(sp.opts[v | 0] ?? v) : kit.text(sp, v);
      // (an envelope's point names its envelope once: "amp decay 0.33 s, sustain 0.800")
      const words = of && of === head ? what : [of, what].filter(Boolean).join(' ');
      head = of || null;
      return `${words} ${val}`;
    }).join(', ');
  }
  // the editor's own ctx.set: its label is the words for the patch (or the one given, for a patch made or emptied)
  const put = (patch, { gesture = 'end', fresh = false, label = null } = {}) => ctx.set(patch, { gesture, fresh, label: label || `${name}: ${saidOf(patch)}` });
  // an entry just made or added to, when it's a change made here with a control made by ctx.control and still carries
  // the frame's label for it (rack.js gestureLabel, renewed before each move of a drag is dispatched, the last one
  // included): this window's words for the same values. (From the store's every change: a drag's last dispatch often
  // changes no value, and then the window hears nothing.)
  function nameEntry(txn) {
    if (!txn || txn.by !== 'you' || !Array.isArray(txn.ops)) return;
    let op = null;
    for (let i = txn.ops.length - 1; i >= 0 && !op; i--) { const o = txn.ops[i]; if (o && o.type === 'instrument.set' && o.track === track && o.params && !o.device) op = o; }
    if (!op) return;
    const keys = Object.keys(op.params).filter((k) => p(k));
    if (!keys.length || txn.label !== gestureLabel(name, keys.map((k) => ({ label: p(k).label, text: kit.text(p(k), op.params[k]) })))) return;
    const label = `${name}: ${saidOf(op.params)}`.slice(0, 120);
    if (txn.label === label) return;
    txn.label = label;
    ui.emit?.('history:annotate', { txn });
  }
  // a bound control (ctx.control: menus, lane marks, the agent's flash) with a short label of its own and the full
  // name for a screen reader
  function ctl(key, { size = 28, kind = null, label = null, aria = null, tall = false } = {}) {
    const e = ctx.control(key, { size, kind, label: label || undefined });
    if (!e) return h('span');
    if (e.classList.contains('pk-knob') && !tall) e.classList.add('lt-hk');
    const spoken = aria || `${name} ${sentence(p(key).label)}`;
    for (const t of e.querySelectorAll('[role=slider], [role=radiogroup], select')) t.setAttribute('aria-label', spoken);
    if (DEST_OF.has(key)) targetOf(key, e);
    return e;
  }
  // a switch drawn as small glyphs (LFO shapes, the sub's wave): the kit's segmented, its words swapped for drawings
  function glyphs(key, paths, label, aria) {
    const e = ctl(key, { kind: 'segmented', label, aria });
    e.classList.add('lt-glyphs');
    const spec = p(key);
    e.querySelectorAll('.pk-seg-b').forEach((b, i) => {
      b.classList.add('lt-gly');
      b.setAttribute('aria-label', sentence(spec.opts[i]));
      b.title = sentence(spec.opts[i]);
      b.innerHTML = `<svg viewBox="0 0 20 12" width="20" height="12" aria-hidden="true"><path d="${paths[i]}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    });
    return e;
  }
  const SHAPE_GLYPHS = ['M1 6 C4 -1.5 7 -1.5 10 6 S16 13.5 19 6', 'M1 6 L5.5 1 L14.5 11 L19 6', 'M1 11 L19 1 L19 11', 'M1 1 L19 11 L19 1', 'M1 11 L1 1 L10 1 L10 11 L19 11 L19 1', 'M1 8 L5 8 L5 2 L9 2 L9 10 L14 10 L14 4 L19 4', 'M1 7 C4 1 6 2 8 6 S13 11 15 6 S18 3 19 4'];
  const SUB_GLYPHS = ['M1 6 C4 -1.5 7 -1.5 10 6 S16 13.5 19 6', 'M1 6 L5.5 1 L14.5 11 L19 6', 'M1 11 L1 1 L10 1 L10 11 L19 11 L19 1'];

  /* ================================================================ rings: a knob's modulations */
  // A knob that is a destination is a target: while a cable is out it can take it, and each slot aimed at it draws a
  // ring outside its dial: the arc is the amount in the knob's travel (bipolar sources swing both ways), the square at
  // its end drags it, a tick on it moves with the source while notes play. A knob wearing rings keeps room round its
  // dial for them (--lt-room: out to the outermost ring's handle and three pixels more), so no ring or handle lands on its
  // name, its value or a neighbour's. The handle answers a press in an 18 px circle (44 on a phone), which may reach the
  // edge of the knob's name (inert text: the knob's menu is on its dial); the dials sit above the rings, so a press on
  // a dial always turns it.
  const targets = new Map();   // key -> target
  function targetOf(key, ctlEl) {
    const d = DEST_OF.get(key);
    const dial = ctlEl.querySelector('.pk-dial');
    const t = { key, d, el: ctlEl, dial, rings: new Map(), box: null, svg: null, size: 0 };
    ctlEl.dataset.ltTarget = key;
    ctlEl.classList.add('lt-tgt');
    targets.set(key, t);
    return t;
  }
  // which slots aim where: [{ j (0..7), src, dst, amt }]
  const slots = () => { const out = []; for (let j = 0; j < 8; j++) out.push({ j, src: P[`m${j + 1}_src`] | 0, dst: P[`m${j + 1}_dst`] | 0, amt: +P[`m${j + 1}_amt`] || 0 }); return out; };
  const used = (s) => s.src !== 0 || s.dst !== 0;
  const freeSlot = () => slots().find((s) => !used(s)) || null;
  const valueOf = (t) => (t.key.startsWith('@') ? 0.5 : kit.pos(p(t.key), P[t.key]));
  function ringGeo(t) {
    const size = t.dial ? t.dial.offsetWidth || 34 : 34;
    return { size, r: (i) => size / 2 + 4 + 4.5 * i };
  }
  function drawRings(t, { flash = null } = {}) {
    const want = slots().filter((s) => s.dst === t.d && s.dst > 0);
    if (!want.length && !t.box) return;
    if (!t.box) {
      t.box = h('div.lt-rings');
      t.svg = svgEl('svg', { class: 'lt-rings-svg', 'aria-hidden': 'true' });
      t.box.append(t.svg);
      t.el.append(t.box);
    }
    const n = want.length;
    // the room first (the knob's name and value step out of the way), then the rings round the dial where it is now
    if (n) { const g0 = ringGeo(t); t.el.style.setProperty('--lt-room', Math.ceil(g0.r(n - 1) - g0.size / 2 + 4 + 3) + 'px'); }
    else t.el.style.removeProperty('--lt-room');
    t.el.classList.toggle('lt-modded', n > 0);
    const g = ringGeo(t), pad = Math.ceil(4 + 4.5 * Math.max(0, n - 1) + 8), W = g.size + 2 * pad, c = W / 2;
    t.box.style.width = t.box.style.height = W + 'px';
    t.box.style.left = (t.dial ? t.dial.offsetLeft : 0) - pad + 'px';
    t.box.style.top = (t.dial ? t.dial.offsetTop : 0) - pad + 'px';
    t.svg.setAttribute('viewBox', `0 0 ${W} ${W}`); t.svg.setAttribute('width', W); t.svg.setAttribute('height', W);
    const x = valueOf(t), travel = DEST_TARGETS[t.d].travel;
    const seen = new Set();
    want.forEach((s, i) => {
      seen.add(s.j);
      let r = t.rings.get(s.j);
      if (!r) r = makeRing(t, s.j);
      const R = g.r(i), amt = clamp(s.amt, -1, 1) * travel, bi = BIPOLAR.has(s.src);
      const lo = clamp(bi ? x - Math.abs(amt) : Math.min(x, x + amt), 0, 1), hi = clamp(bi ? x + Math.abs(amt) : Math.max(x, x + amt), 0, 1);
      r.track.setAttribute('d', arcPath(c, c, R, A0, A0 + SPAN));
      r.hit.setAttribute('d', arcPath(c, c, R, A0, A0 + SPAN));
      r.arc.setAttribute('d', arcPath(c, c, R, A0 + SPAN * lo, A0 + SPAN * hi));
      const tip = A0 + SPAN * clamp(x + amt, 0, 1);
      r.handle.style.left = (c + R * Math.cos(tip)) + 'px';
      r.handle.style.top = (c + R * Math.sin(tip)) + 'px';
      r.R = R; r.c = c; r.slot = s; r.x = x;
      const words = `${SRC_NAME[s.src] || 'Nothing'} → ${DEST_NAME[t.d]}, ${amountWords(t.d, s.amt)}`;
      r.handle.setAttribute('aria-valuenow', String(+s.amt.toFixed(3)));
      r.handle.setAttribute('aria-valuetext', `${amountWords(t.d, s.amt)} (${pct(s.amt)} of its travel)`);
      r.handle.setAttribute('aria-label', `Slot ${s.j + 1}: ${SRC_NAME[s.src] || 'nothing'} to ${DEST_NAME[t.d]}, amount${touch() ? '' : '. Delete empties the slot'}`);
      r.handle.title = touch() ? `${words}. Slide up or down for the amount; × in the matrix takes it off` : `${words}. Drag for the amount; right-click to take it off`;
      r.g.dataset.src = String(s.src);
      if (flash && flash.has(s.j)) { r.g.classList.remove('lt-flash'); void r.g.getBBox?.(); r.g.classList.add('lt-flash'); r.handle.classList.remove('lt-flash'); void r.handle.offsetWidth; r.handle.classList.add('lt-flash'); r.flashUntil = performance.now() + 1700; }
    });
    for (const [j, r] of t.rings) if (!seen.has(j)) { r.g.remove(); r.handle.remove(); t.rings.delete(j); }
    // a jack's readout: what moves it, summed
    if (t.key.startsWith('@')) { const v = t.el.querySelector('.pk-v'); if (v) v.textContent = want.length ? want.map((s) => amountWords(t.d, s.amt)).join(' ') : 'none'; }
    if (!t.rings.size) { t.box.remove(); t.box = null; t.svg = null; }
  }
  function makeRing(t, j) {
    const g = svgEl('g', { class: 'lt-ring' });
    const track = svgEl('path', { class: 'lt-ring-trk' }), arc = svgEl('path', { class: 'lt-ring-arc' }), tick = svgEl('rect', { class: 'lt-ring-tick', width: 3, height: 3, x: 0, y: 0, display: 'none' }), hit = svgEl('path', { class: 'lt-ring-hit' });
    g.append(track, arc, tick, hit);
    t.svg.append(g);
    const handle = h('div.lt-ring-h', { role: 'slider', tabindex: 0, 'aria-valuemin': -1, 'aria-valuemax': 1 });
    t.box.append(handle);
    const r = { g, track, arc, tick, hit, handle, j, slot: null };
    t.rings.set(j, r);
    // drag (on the ring or its square): up for more, Shift fine; one undo step
    const start = (e) => {
      if (e.button === 2) return;
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const k = `m${r.slot.j + 1}_amt`, spec = p(k), a0 = r.slot.amt, y0 = e.clientY;
      const tgt = e.currentTarget;
      try { tgt.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      handle.focus({ preventScroll: true });
      let moved = false, v = a0, fine = e.shiftKey, base = a0, yb = y0;
      const mv = (ev) => {
        if (ev.shiftKey !== fine) { fine = ev.shiftKey; base = v; yb = ev.clientY; }
        const dy = ev.clientY - yb;
        if (!moved && Math.abs(dy) < 2) return;
        moved = true;
        v = kit.snap(spec, clamp(base - dy / (fine ? 600 : 120), -1, 1));
        put({ [k]: v }, { gesture: 'move' });
        say(`${SRC_NAME[r.slot.src]} → ${DEST_NAME[t.d]}: ${amountWords(t.d, v)}`, { announce: false });
      };
      const up = () => { tgt.removeEventListener('pointermove', mv); tgt.removeEventListener('pointerup', up); tgt.removeEventListener('pointercancel', up); if (moved) put({ [k]: v }, { gesture: 'end' }); };
      tgt.addEventListener('pointermove', mv); tgt.addEventListener('pointerup', up); tgt.addEventListener('pointercancel', up);
    };
    const remove = (e) => { e.preventDefault(); e.stopPropagation(); clearSlot(r.slot.j); };
    for (const x of [hit, handle]) {
      x.addEventListener('pointerdown', start);
      x.addEventListener('contextmenu', remove);
      x.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); put({ [`m${r.slot.j + 1}_amt`]: 0 }); });
      x.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); const k = `m${r.slot.j + 1}_amt`; put({ [k]: kit.snap(p(k), clamp(r.slot.amt - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.01), -1, 1)) }, { gesture: 'move' }); }, { passive: false });
    }
    handle.addEventListener('keydown', (e) => {
      const k = `m${r.slot.j + 1}_amt`, spec = p(k);
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key], big = { PageUp: 1, PageDown: -1 }[e.key];
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); clearSlot(r.slot.j); return; }
      if (step == null && big == null) return;
      e.preventDefault(); e.stopPropagation();
      put({ [k]: kit.snap(spec, clamp(r.slot.amt + (step != null ? step * (e.shiftKey ? 0.001 : 0.01) : big * 0.1), -1, 1)) }, { gesture: 'end' });
    });
    return r;
  }
  function clearSlot(j) {
    const s = slots()[j];
    const words = s.dst ? `${SRC_NAME[s.src] || 'nothing'} off ${DEST_NAME[s.dst]}` : `slot ${j + 1} cleared`;
    put({ [`m${j + 1}_src`]: 0, [`m${j + 1}_dst`]: 0, [`m${j + 1}_amt`]: 0 }, { fresh: true, label: `${name}: ${s.dst ? `${SRC_WORD[s.src]} off ${DEST_WORD[s.dst]} (slot ${j + 1} emptied)` : `slot ${j + 1} emptied`}` });
    say(`Slot ${j + 1} is empty: ${words}.`);
  }
  const ringsDirty = new Set();
  const allRings = () => { for (const t of targets.values()) ringsDirty.add(t.key); };

  /* ================================================================ patching: the cable */
  const cable = svgEl('svg', { class: 'lt-cable', 'aria-hidden': 'true' });
  const cablePath = svgEl('path', { class: 'lt-cable-p' }), cableEnd = svgEl('rect', { class: 'lt-cable-end', width: 7, height: 7 });
  cable.append(cablePath, cableEnd);
  // What patching says goes in the window's own line (where it says what an agent changed), and to a screen reader;
  // root.__lt.said is the last of it, for the tests
  let said = '';
  function say(text, { announce = true } = {}) {
    said = text || '';
    ctx.status(said);
    if (said && announce) ui.announce?.(said);
  }
  const cableSay = svgEl('text', { class: 'lt-cable-say' });   // (at the cable's end, when there's no slot for it)
  cable.append(cableSay);
  let patch = null;   // { src, socket, drag: bool, x, y, over: target | null, full: bool, hoverTab, hoverAt }
  const FULL = () => `All 8 mod slots are in use. Empty one first: ${touch() ? 'tap × beside a slot in the matrix' : 'right-click a ring, or × in the matrix'}.`;
  // how a ring moves, in the words for the hand that's on it
  const ringHow = (it) => (touch() ? `Slide ${it} up or down` : `Drag ${it}`);
  function eligible(on) {
    for (const t of targets.values()) t.el.classList.toggle('lt-can', !!on);
    root.classList.toggle('lt-patching', !!on);
  }
  function startPatch(src, socket, { drag = false } = {}) {
    endPatch();
    const full = !freeSlot();
    patch = { src, socket, drag, over: null, full, x: 0, y: 0, hoverTab: null, hoverAt: 0 };
    socket.setAttribute('aria-pressed', 'true');
    root.dataset.hlSrc = String(src);
    if (full) say(FULL());
    else { eligible(true); say(drag ? `${SRC_NAME[src]}: drop it on a knob to modulate it.` : touch() ? `${SRC_NAME[src]}: tap a knob to modulate it. Tap the jack again to stop.` : `${SRC_NAME[src]}: click a knob (or Enter on one) to modulate it. Esc stops.`); }
    root.__lt.message = full ? FULL() : '';
  }
  // a patch left without a knob: nothing changed, and the window's line says so (it said how to patch a moment ago)
  const letGo = () => { const src = patch?.src, full = patch?.full; endPatch(); if (src != null && !full) say(`${SRC_NAME[src]} isn’t on a knob: nothing changed.`, { announce: false }); };
  function endPatch() {
    if (!patch) return;
    patch.socket.setAttribute('aria-pressed', 'false');
    if (patch.over) patch.over.el.classList.remove('lt-over');
    patch = null;
    eligible(false);
    delete root.dataset.hlSrc;
    cable.classList.remove('on');
  }
  // the knob under a point (looking through whatever floats over the window there: a toast, a menu)
  function targetAt(x, y) {
    for (const e of document.elementsFromPoint(x, y)) {
      if (!root.contains(e)) continue;
      const c = e.closest('[data-lt-target]');
      return c ? targets.get(c.dataset.ltTarget) || null : null;
    }
    return null;
  }
  function connect(t) {
    if (!patch || !t) return false;
    const src = patch.src;
    endPatch();
    const dup = slots().find((s) => s.src === src && s.dst === t.d);
    if (dup) { say(`${SRC_NAME[src]} already moves ${DEST_NAME[t.d]} (slot ${dup.j + 1}). ${ringHow('its ring')} to change how far.`); return false; }
    const s = freeSlot();
    if (!s) { say(FULL()); root.__lt.message = FULL(); return false; }
    const n = s.j + 1, amt = startAmount(t.d);
    const r = put({ [`m${n}_src`]: src, [`m${n}_dst`]: t.d, [`m${n}_amt`]: amt }, { fresh: true, label: `${name}: ${SRC_WORD[src]} → ${DEST_WORD[t.d]}, ${amountWords(t.d, amt)}` });
    if (r && r.ok) say(`Slot ${n}: ${SRC_NAME[src]} → ${DEST_NAME[t.d]}, ${amountWords(t.d, amt)}. ${ringHow('the ring')} for more or less.`);
    return !!(r && r.ok);
  }
  const pendingFlash = new Map();
  function drawCable() {
    if (!patch || !patch.drag || !patch.socket.isConnected) { cable.classList.remove('on'); return; }
    const rr = root.getBoundingClientRect(), sr = patch.socket.getBoundingClientRect();
    const x0 = sr.left + sr.width / 2 - rr.left, y0 = sr.top + sr.height / 2 - rr.top, x1 = patch.x - rr.left, y1 = patch.y - rr.top;
    const dist = Math.hypot(x1 - x0, y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + Math.min(80, dist * 0.22);
    cablePath.setAttribute('d', `M${x0.toFixed(1)},${y0.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`);
    cableEnd.setAttribute('x', (x1 - 3.5).toFixed(1)); cableEnd.setAttribute('y', (y1 - 3.5).toFixed(1));
    cable.classList.add('on');
    cable.classList.toggle('full', patch.full);
    cableSay.textContent = patch.full ? 'All 8 slots are in use' : '';
    if (patch.full) { const right = x1 < rr.width - 180; cableSay.setAttribute('x', (right ? x1 + 10 : x1 - 10).toFixed(1)); cableSay.setAttribute('y', (y1 - 9).toFixed(1)); cableSay.setAttribute('text-anchor', right ? 'start' : 'end'); }
  }
  // a source's jack: drag it out, or click it (Enter) and then a knob; on a touch screen, tap it and then a knob
  const jacks = [];
  function jackWords(b, src) {
    b.setAttribute('aria-label', touch() ? `Modulate with ${SRC_NAME[src]}: tap it, then tap a knob` : `Modulate with ${SRC_NAME[src]}: drag it onto a knob, or press Enter and then Enter on a knob`);
    b.title = touch() ? `${SRC_NAME[src]}: tap it, then a knob, to modulate the knob` : `${SRC_NAME[src]}: drag onto a knob to modulate it`;
  }
  function socket(src) {
    const b = h('button.lt-sock', { type: 'button', 'aria-pressed': 'false', dataset: { src: String(src) } });
    jackWords(b, src);
    jacks.push([b, src]);
    b.innerHTML = '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="1.75" fill="currentColor"/></svg>';
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      const x0 = e.clientX, y0 = e.clientY;
      let dragging = false;
      const mv = (ev) => {
        if (!dragging) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return; dragging = true; startPatch(src, b, { drag: true }); }
        if (!patch) return;
        patch.x = ev.clientX; patch.y = ev.clientY;
        const t = patch.full ? null : targetAt(ev.clientX, ev.clientY);
        if (t !== patch.over) { patch.over?.el.classList.remove('lt-over'); patch.over = t; t?.el.classList.add('lt-over'); }
        // a tab under the cable opens after a moment (a spring-loaded tab)
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => root.contains(x));
        const tabEl = under?.closest?.('[data-spring]') || null;
        if (tabEl !== patch.hoverTab) { patch.hoverTab = tabEl; patch.hoverAt = performance.now(); }
      };
      const up = (ev) => {
        b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up);
        if (!dragging) { if (patch && patch.src === src) letGo(); else startPatch(src, b); return; }
        if (!patch) return;
        const t = ev.type === 'pointerup' && !patch.full ? targetAt(ev.clientX, ev.clientY) : null;
        if (t) connect(t); else letGo();
      };
      b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation();
      if (patch && patch.src === src) letGo(); else startPatch(src, b);
    });
    // pointing at a jack picks out that source's rings on the knobs it moves (a macro shows what it's wired to)
    const hl = (on) => { if (patch) return; if (on) root.dataset.hlSrc = String(src); else delete root.dataset.hlSrc; };
    b.addEventListener('pointerenter', () => hl(true));
    b.addEventListener('pointerleave', () => hl(false));
    b.addEventListener('focus', () => hl(true));
    b.addEventListener('blur', () => hl(false));
    return b;
  }
  // in patch mode, a press or Enter on a knob connects it (and doesn't turn it)
  root.addEventListener('pointerdown', (e) => {
    if (!patch || patch.drag) return;
    if (e.target.closest('.lt-sock')) return;
    const c = e.target.closest('[data-lt-target]');
    if (c && !patch.full) { e.preventDefault(); e.stopPropagation(); connect(targets.get(c.dataset.ltTarget)); }
    else if (!e.target.closest('[data-spring]')) letGo();
  }, true);
  root.addEventListener('keydown', (e) => {
    if (!patch || patch.drag || (e.key !== 'Enter' && e.key !== ' ')) return;
    const c = e.target.closest?.('[data-lt-target]');
    if (!c || patch.full) return;
    e.preventDefault(); e.stopPropagation();
    connect(targets.get(c.dataset.ltTarget));
  }, true);
  offs.push(ui.keys.add({ key: 'Escape', first: true, global: true, when: () => !!patch, run: () => letGo(), label: 'Stop patching a modulation source', group: 'Devices', hidden: true }));

  /* ================================================================ tabs (the bottom band, the phone's sections) */
  function tabs(list, { label, get, set, cls = '' }) {
    const btns = list.map((t, i) => h('button.lt-tab', { type: 'button', role: 'tab', id: `${id}-${label.replace(/\W+/g, '')}-${i}`, 'aria-selected': 'false', tabindex: -1, dataset: { spring: '1' }, onclick: () => set(t.id) }, t.label));
    const bar = h('div.lt-tabs' + cls, { role: 'tablist', 'aria-label': label }, btns);
    bar.addEventListener('keydown', (e) => {
      const i = btns.indexOf(e.target);
      if (i < 0) return;
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const j = d != null ? (i + d + btns.length) % btns.length : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : null;
      if (j == null) return;
      e.preventDefault(); e.stopPropagation();
      set(list[j].id); btns[j].focus();
    });
    const sync = () => { const cur = get(); list.forEach((t, i) => { const on = t.id === cur; btns[i].setAttribute('aria-selected', String(on)); btns[i].tabIndex = on ? 0 : -1; btns[i].classList.toggle('on', on); }); };
    sync();
    return { bar, btns, sync };
  }
  // The envelopes' and LFOs' pickers: a word for each, the shown one pressed, and the source's jack beside each word,
  // so any of them can be patched without opening it
  function picks(list, { label, get, set }) {
    const btns = list.map((t) => h('button.lt-tab', { type: 'button', 'aria-pressed': 'false', dataset: { spring: '1' }, title: t.title || null, onclick: () => set(t.id) }, t.label));
    const bar = h('div.lt-tabs', { role: 'group', 'aria-label': label });
    list.forEach((t, i) => bar.append(h('span.lt-pk', btns[i], t.jack)));
    const sync = () => { const cur = get(); list.forEach((t, i) => { const on = t.id === cur; btns[i].setAttribute('aria-pressed', String(on)); btns[i].classList.toggle('on', on); }); };
    sync();
    return { bar, btns, sync };
  }

  /* ================================================================ oscillators */
  function buildOsc(o) {
    const O = o.toUpperCase(), K = (k) => `${o}_${k}`;
    const sec = h('section.lt-sec.lt-osc', { dataset: { sec: 'osc' + o }, 'aria-label': `Oscillator ${O}` });
    // the display: the instrument's screen, in the device's own colours
    const disp = h('div.lt-disp.lt-tv');
    const view = cv({ className: 'lt-tv-cv', label: `Osc ${O}'s table` });
    view.el.setAttribute('role', 'slider');
    view.el.tabIndex = 0;
    view.el.setAttribute('aria-valuemin', '0'); view.el.setAttribute('aria-valuemax', '1');
    const pickBtn = h('button.lt-pick', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
    const letter = h('b.lt-letter', { 'aria-hidden': 'true' }, O);
    const views = [['3d', '3D'], ['wave', 'Wave'], ['harm', 'Harmonics']];
    const vbtns = views.map(([v, w]) => h('button.lt-vbtn', { type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: -1, dataset: { v }, onclick: () => setView(v) }, w));
    const vgroup = h('div.lt-views', { role: 'radiogroup', 'aria-label': `Osc ${O}: how the table is drawn` }, vbtns);
    vgroup.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (d == null) return;
      e.preventDefault(); e.stopPropagation();
      const i = views.findIndex(([v]) => v === S.view[o]), j = (i + d + views.length) % views.length;
      setView(views[j][0]); vbtns[j].focus();
    });
    const where = h('span.lt-where');
    const quiet = h('span.lt-quiet', 'level 0: silent');
    const warpSw = ctl(K('warp'), { kind: 'segmented', label: 'WARP', aria: `${name} osc ${O} warp` });
    warpSw.classList.add('lt-warpw');
    disp.append(view.el, h('div.lt-tv-top', letter, pickBtn, h('div.lt-tv-right', vgroup, h('span.lt-disp-t', quiet))), h('div.lt-tv-meta.lt-disp-t', where), h('div.lt-tv-foot', warpSw));
    // the knobs beside it
    const routeKey = `flt_${o}`;
    const route = routeTog(routeKey, `osc ${O}`);
    // under the display: the table's knobs, then the unison's; beside it: the unison drawn, the route, the pitch
    const uni = cv({ className: 'lt-uni-cv', label: `Osc ${O}'s unison voices: across the stereo field and in pitch` });
    const left = h('div.lt-osc-l', disp,
      h('div.lt-grid4', ctl(K('pos'), { label: 'POS', aria: `${name} osc ${O} position` }), ctl(K('warp_amt'), { label: 'WARP', aria: `${name} osc ${O} warp amount` }), ctl(K('level'), { label: 'LEVEL', aria: `${name} osc ${O} level` }), ctl(K('pan'), { label: 'PAN', aria: `${name} osc ${O} pan` })),
      h('div.lt-grid4', ctl(K('unison'), { label: 'VOICES', aria: `${name} osc ${O} unison voices` }), ctl(K('detune'), { label: 'DETUNE', aria: `${name} osc ${O} unison detune` }), ctl(K('blend'), { label: 'BLEND', aria: `${name} osc ${O} unison blend` }), ctl(K('spread'), { label: 'SPREAD', aria: `${name} osc ${O} unison spread` })));
    const right = h('div.lt-osc-r', h('div.lt-uni', h('span.lt-cap', 'Unison'), uni.el), route,
      ctl(K('oct'), { label: 'OCT', aria: `${name} osc ${O} octave` }), ctl(K('semi'), { label: 'SEMI', aria: `${name} osc ${O} semitones` }), ctl(K('fine'), { label: 'FINE', aria: `${name} osc ${O} fine tune` }));
    sec.append(h('div.lt-osc-grid', left, right));
    const st = { o, O, sec, disp, view, pickBtn, where, quiet, route, routeKey, uni, vbtns,
      // the cached drawing: projected frames per (table, warp, size), and the layer per cut
      geo: null, layer: null, layerSig: '', frames: null, framesSig: '', lit: null, ghost: null, ghostPos: null, ghostAmt: null, litPts: null, dirty: true, hi: null, hiSig: '', spec: null, specSig: '' };
    function setView(v) { S.view[o] = v; syncViews(); st.dirty = true; view.dirty(); }
    function syncViews() { vbtns.forEach((b) => { const on = b.dataset.v === S.view[o]; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('sel-print', on); }); }
    syncViews();
    st.words = () => view.el.setAttribute('aria-label', `${name} osc ${O} position in its table: ${touch() ? 'slide up or down' : 'drag up or down, or use the arrow keys'}`);
    st.words();
    // POS from the display: drag up or down (Shift: fine), the arrow keys a frame at a time, the wheel
    const posKey = K('pos'), posSpec = p(posKey);
    view.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { view.el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      view.el.focus({ preventScroll: true });
      let y0 = e.clientY, base = P[posKey], v = base, fine = e.shiftKey, moved = false;
      const H = Math.max(80, view.size.h || 150);
      const mv = (ev) => {
        if (ev.shiftKey !== fine) { fine = ev.shiftKey; base = v; y0 = ev.clientY; }
        const dy = ev.clientY - y0;
        if (!moved && Math.abs(dy) < 2) return;
        moved = true;
        v = kit.snap(posSpec, clamp(base - dy / (H * (fine ? 5 : 1.1)), 0, 1));
        put({ [posKey]: v }, { gesture: 'move' });
      };
      const up = () => { view.el.removeEventListener('pointermove', mv); view.el.removeEventListener('pointerup', up); view.el.removeEventListener('pointercancel', up); if (moved) put({ [posKey]: v }, { gesture: 'end' }); };
      view.el.addEventListener('pointermove', mv); view.el.addEventListener('pointerup', up); view.el.addEventListener('pointercancel', up);
    });
    view.el.addEventListener('dblclick', () => put({ [posKey]: posSpec.def }));
    view.el.addEventListener('wheel', (e) => { e.preventDefault(); put({ [posKey]: kit.snap(posSpec, clamp(P[posKey] - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 1 / 48), 0, 1)) }, { gesture: 'move' }); }, { passive: false });
    view.el.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key], big = { PageUp: 12, PageDown: -12 }[e.key];
      let v = null;
      // a frame at a time (from between two, to the next one that way), a quarter of the table with Page Up and Down
      // (from the frame it is at: POS snaps to 0.005, a quarter of a frame, so a frame's own place reads a little off it)
      const f = P[posKey] * 48, at = Math.abs(f - Math.round(f)) < 0.3 ? Math.round(f) : null;
      const next = (n) => ((at ?? (n > 0 ? Math.floor(f) : Math.ceil(f))) + n) / 48;
      if (d != null) v = e.shiftKey ? P[posKey] + d * 0.002 : next(d);
      else if (big != null) v = next(big);
      else if (e.key === 'Home') v = 0; else if (e.key === 'End') v = 1;
      if (v == null) return;
      e.preventDefault(); e.stopPropagation();
      put({ [posKey]: kit.snap(posSpec, clamp(v, 0, 1)) });
    });
    kit.menuOn(view.el, (anchor, e) => ctx.menu(posKey, e && e.clientX != null ? e : anchor));
    // the picker
    pickBtn.addEventListener('click', () => openPicker(st));
    kit.menuOn(pickBtn, (anchor, e) => ctx.menu(K('table'), e && e.clientX != null ? e : anchor));
    pickBtn.classList.add('pk-ctl'); pickBtn.dataset.key = K('table');
    view.set({ draw: (g, sz) => drawTable(st, g, sz) });
    uni.set({ draw: (g, sz) => drawUnison(st, g, sz) });
    return st;
  }

  /* ---------------------------------------------------------------- the 3D table: geometry, the cached layer */
  // The stack recedes up and to the right. Frame f sits at depth z = f / 48: shrunk toward the back by perspective
  // (1 / (1 + 0.5 z)) and shifted by the depth's share of the slant.
  function geometry(w, hh, { thumb = false } = {}) {
    const wide = w / hh > 2.2;
    const fx0 = w * 0.04, fw = w * (wide ? 0.5 : 0.6), fy = hh * (thumb ? 0.72 : 0.66), fh = hh * 0.2, dx = w * (wide ? 0.27 : 0.29), dy = hh * (thumb ? 0.47 : 0.4), k = 0.5, kz = 1 - 1 / (1 + k);
    const span = fx0 + dx + fw / (1 + k);   // the back frame's right edge
    const ox = Math.max(0, (w - (span + fx0) - (thumb ? 0 : 0.12 * w)) / 2);
    return {
      w, hh,
      P(u, y, z, out) { const s = 1 / (1 + k * z), zz = (1 - s) / kz; out[0] = ox + fx0 + dx * zz + u * fw * s; out[1] = fy - dy * zz - y * fh * s; return out; },
    };
  }
  // the frames as drawn: each frame of the table through the warp, VIEW_N points (cached on table, warp and the other
  // oscillator for FM)
  function viewFrames(st) {
    const o = st.o, t = P[`${o}_table`] | 0, mode = P[`${o}_warp`] | 0, amt = P[`${o}_warp_amt`];
    const fmSig = mode === 5 ? fmSig_(o) : '';
    const sig = `${t}|${mode}|${mode ? amt : 0}|${fmSig}`;
    if (st.framesSig === sig && st.frames) return st.frames;
    const src = framesOf(t), cycles = LT().TABLES[t].cycles, fm = mode === 5 ? fmOf(o) : null;
    st.frames = src.map((f) => warpCycle(f, mode, amt, { cycles, out: new Float32Array(VIEW_N), fm }));
    st.framesSig = sig;
    st.layerSig = '';
    return st.frames;
  }
  // FM: the other oscillator's sum (its own warp, unless it is FM too), at this one's note cycles
  const pitchOf = (o) => 12 * (P[`${o}_oct`] | 0) + (+P[`${o}_semi`] || 0) + (+P[`${o}_fine`] || 0) / 100;
  function fmSig_(o) { const q = o === 'a' ? 'b' : 'a'; return [P[`${q}_table`], P[`${q}_pos`], P[`${q}_warp`], P[`${q}_warp_amt`], pitchOf(q) - pitchOf(o)].join(','); }
  function fmOf(o, posOverride = null) {
    const q = o === 'a' ? 'b' : 'a', t = P[`${q}_table`] | 0, cyc = LT().TABLES[t].cycles, mode = P[`${q}_warp`] | 0;
    const src = frameAt(t, posOverride ?? P[`${q}_pos`], true);
    const cycle = mode && mode !== 5 ? warpCycle(src, mode, P[`${q}_warp_amt`], { cycles: cyc, out: new Float32Array(HI_N) }) : src;
    const r = Math.pow(2, (pitchOf(q) - pitchOf(o)) / 12), n = cycle.length;
    return (tt) => { let u = (tt * r) / cyc; u -= Math.floor(u); const x = u * n, k = x | 0, f = x - k; return cycle[k] + (cycle[(k + 1) % n] - cycle[k]) * f; };
  }
  // the lit frame (what POS plays), through the warp
  function litFrame(st, pos, amt = P[`${st.o}_warp_amt`], n = VIEW_N) {
    const o = st.o, t = P[`${o}_table`] | 0, mode = P[`${o}_warp`] | 0, cycles = LT().TABLES[t].cycles;
    const src = frameAt(t, pos, n > VIEW_N);
    return warpCycle(src, mode, amt, { cycles, out: new Float32Array(n), fm: mode === 5 ? fmOf(o) : null });
  }
  function pathOf(g, geo, arr, z, tmp) {
    const n = arr.length;
    g.beginPath();
    for (let i = 0; i <= n; i++) { geo.P(i / n, arr[i % n], z, tmp); if (i) g.lineTo(tmp[0], tmp[1]); else g.moveTo(tmp[0], tmp[1]); }
  }
  const tmp2 = [0, 0];
  // the stack, cut at POS: behind the cut solid (each frame hides what's behind it), the cut in full ink, in front of
  // it hairlines; rendered to a layer kept until the table, the warp, the size or the cut moves
  function renderLayer(st, w, hh, dpr) {
    const pos = P[`${st.o}_pos`], frames = viewFrames(st);
    const sig = `${st.framesSig}|${w}x${hh}@${dpr}|${pos}|${P[`${st.o}_level`] > 0 ? 1 : 0}`;
    if (st.layer && st.layerSig === sig) return st.layer;
    const c = st.layer || document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const geo = geometry(w, hh), quietA = P[`${st.o}_level`] > 0 ? 1 : 0.55;
    st.geo = geo;
    const cut = pos * (FR - 1);
    // the rails: the cycle's start and end along the table, and the landmarks on the near rail
    g.lineWidth = 1; g.strokeStyle = rgba(INK.ink, 0.2 * quietA);
    for (const u of [0, 1]) { g.beginPath(); geo.P(u, 0, 0, tmp2); g.moveTo(tmp2[0], tmp2[1]); geo.P(u, 0, 1, tmp2); g.lineTo(tmp2[0], tmp2[1]); g.stroke(); }
    const ground = INK.ground;
    const lower = -1.25;
    const solid = (arr, z, alpha, lw) => {
      pathOf(g, geo, arr, z, tmp2);
      geo.P(1, lower, z, tmp2); g.lineTo(tmp2[0], tmp2[1]); geo.P(0, lower, z, tmp2); g.lineTo(tmp2[0], tmp2[1]); g.closePath();
      g.fillStyle = ground; g.fill();
      pathOf(g, geo, arr, z, tmp2);
      g.strokeStyle = rgba(INK.ink, alpha * quietA); g.lineWidth = lw; g.stroke();
    };
    for (let f = FR - 1; f > cut; f--) { const z = f / (FR - 1); solid(frames[f], z, 0.62 - 0.38 * z, 0.75); }
    // the cut: the frame POS plays, between its neighbours
    const lit = litFrame(st, pos);
    st.lit = lit;
    solid(lit, pos, 1, 1.75);
    for (let f = Math.floor(cut - 1e-9); f >= 0; f--) {
      if (f >= cut) continue;
      const z = f / (FR - 1);
      pathOf(g, geo, frames[f], z, tmp2);
      g.strokeStyle = rgba(INK.ink, (0.08 + 0.12 * (1 - (cut - f) / Math.max(1, cut))) * quietA); g.lineWidth = 0.75; g.stroke();
    }
    // the landmarks: small marks on the far rail, their names beside them
    const t = P[`${st.o}_table`] | 0;
    g.font = `${fontPx()}px ${MONO}`; g.textBaseline = 'middle';
    for (const [x, label] of MARKS[t] || []) {
      geo.P(1, 0, x, tmp2);
      const px = tmp2[0], py = tmp2[1];
      g.strokeStyle = rgba(INK.ink, 0.35 * quietA); g.beginPath(); g.moveTo(px + 2, py); g.lineTo(px + 6, py); g.stroke();
      g.lineWidth = 3; g.strokeStyle = ground; g.strokeText(label, px + 10, py);
      g.fillStyle = rgba(INK.ink, (Math.abs(x - pos) < 0.02 ? 0.95 : 0.55) * quietA);
      g.fillText(label, px + 10, py);
    }
    st.layer = c; st.layerSig = sig;
    // where the lit frame is drawn (for the test: points along it)
    st.litPts = [];
    for (let i = 0; i < 8; i++) { const u = (i + 0.5) / 8, k = Math.floor(u * VIEW_N); geo.P(k / VIEW_N, lit[k], pos, tmp2); st.litPts.push([tmp2[0], tmp2[1], lit[k]]); }
    return c;
  }
  function drawTable(st, g, { w, h: hh, dpr }) {
    st.dirty = false;
    const o = st.o, v = S.view[o], pos = P[`${o}_pos`];
    g.fillStyle = INK.ground; g.fillRect(0, 0, w, hh);
    if (v === '3d') {
      const layer = renderLayer(st, w, hh, dpr);
      g.drawImage(layer, 0, 0, w, hh);
      if (st.ghostPos != null && Math.abs(st.ghostPos - pos) > 1e-4 || (st.ghostAmt != null && Math.abs(st.ghostAmt - P[`${o}_warp_amt`]) > 1e-4)) {
        const gp = st.ghostPos ?? pos, gf = litFrame(st, gp, st.ghostAmt ?? P[`${o}_warp_amt`]);
        st.ghost = gp;
        pathOf(g, st.geo, gf, gp, tmp2);
        g.strokeStyle = INK.pencil; g.lineWidth = 1.5; g.stroke();
      } else st.ghost = null;
    } else if (v === 'wave') drawFlat(st, g, w, hh);
    else drawHarmonics(st, g, w, hh);
  }
  // the frame flat: the warped frame in ink over the plain one in pencil (when there's a warp), the playing one in
  // grease pencil while it moves
  function drawFlat(st, g, w, hh) {
    const o = st.o, pos = P[`${o}_pos`], mode = P[`${o}_warp`] | 0, t = P[`${o}_table`] | 0, quietA = P[`${o}_level`] > 0 ? 1 : 0.55;
    const n = 512, x0 = 10, x1 = w - 10, mid = hh * 0.52, amp = hh * 0.36;
    g.strokeStyle = rgba(INK.ink, 0.18); g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, Math.round(mid) + 0.5); g.lineTo(x1, Math.round(mid) + 0.5); g.stroke();
    g.setLineDash([2, 3]);
    for (const yy of [mid - amp, mid + amp]) { g.beginPath(); g.moveTo(x0, Math.round(yy) + 0.5); g.lineTo(x1, Math.round(yy) + 0.5); g.stroke(); }
    g.setLineDash([]);
    const cycles = LT().TABLES[t].cycles;
    for (let c = 1; c < cycles; c++) { const x = x0 + (x1 - x0) * c / cycles; g.beginPath(); g.moveTo(x + 0.5, mid - amp); g.lineTo(x + 0.5, mid + amp); g.stroke(); }
    const line = (arr, color, lw) => { g.beginPath(); for (let i = 0; i <= arr.length; i++) { const x = x0 + (x1 - x0) * i / arr.length, y = mid - arr[i % arr.length] * amp; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.strokeStyle = color; g.lineWidth = lw; g.stroke(); };
    const sig = `${t}|${pos}|${mode}|${P[`${o}_warp_amt`]}|${mode === 5 ? fmSig_(o) : ''}`;
    if (st.hiSig !== sig) { st.hi = litFrame(st, pos, P[`${o}_warp_amt`], n); st.plain = mode ? frameAt(t, pos, true) : null; st.hiSig = sig; }
    if (st.plain) line(st.plain, rgba(INK.ink, 0.28 * quietA), 1);
    line(st.hi, rgba(INK.ink, quietA), 1.75);
    st.lit = st.hi;
    if (st.ghostPos != null && (Math.abs(st.ghostPos - pos) > 1e-4 || Math.abs((st.ghostAmt ?? 0) - P[`${o}_warp_amt`]) > 1e-4)) { line(litFrame(st, st.ghostPos, st.ghostAmt ?? P[`${o}_warp_amt`], 256), INK.pencil, 1.25); st.ghost = st.ghostPos; } else st.ghost = null;
  }
  // its harmonics: the warped frame's spectrum (an FFT of what's drawn flat), harmonics of the note on a log axis, dB
  const FFT_RE = new Float64Array(HI_N), FFT_IM = new Float64Array(HI_N);
  function harmonicsOf(arr) {
    FFT_RE.set(arr); FFT_IM.fill(0);
    LT().fft(FFT_RE, FFT_IM, HI_N, false);
    const mags = new Float64Array(HI_N / 2);
    for (let k = 1; k < HI_N / 2; k++) mags[k] = 2 * Math.hypot(FFT_RE[k], FFT_IM[k]) / HI_N;
    return mags;
  }
  function drawHarmonics(st, g, w, hh) {
    const o = st.o, pos = P[`${o}_pos`], t = P[`${o}_table`] | 0, cycles = LT().TABLES[t].cycles, quietA = P[`${o}_level`] > 0 ? 1 : 0.55;
    const sig = `${t}|${pos}|${P[`${o}_warp`]}|${P[`${o}_warp_amt`]}|${(P[`${o}_warp`] | 0) === 5 ? fmSig_(o) : ''}`;
    if (st.specSig !== sig) { st.spec = harmonicsOf(litFrame(st, pos, P[`${o}_warp_amt`], HI_N)); st.specSig = sig; }
    const mags = st.spec;
    let top = 1e-9; for (let k = 1; k < mags.length; k++) if (mags[k] > top) top = mags[k];
    const x0 = 12, x1 = w - 12, y0 = 24, y1 = hh - 22, KMAX = 256 * cycles;
    const X = (k) => x0 + (x1 - x0) * Math.log(k / cycles) / Math.log(KMAX / cycles);   // note harmonics 1..256
    const Y = (db) => y0 + (y1 - y0) * clamp(-db / 72, 0, 1);
    g.strokeStyle = rgba(INK.ink, 0.16); g.lineWidth = 1;
    for (const db of [0, -24, -48, -72]) { const y = Math.round(Y(db)) + 0.5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
    g.font = `${fontPx()}px ${MONO}`; g.fillStyle = rgba(INK.ink, 0.5); g.textBaseline = 'top';
    for (const hk of [1, 2, 4, 8, 16, 32, 64, 128]) { const x = X(hk * cycles); g.fillText(String(hk), x - 3, y1 + 6); }
    g.strokeStyle = rgba(INK.ink, quietA); g.lineWidth = 1.25;
    g.beginPath();
    for (let k = 1; k <= Math.min(KMAX, mags.length - 1); k++) {
      const db = 20 * Math.log10(mags[k] / top + 1e-12);
      if (db < -72) continue;
      const x = Math.round(X(k)) + 0.5;
      g.moveTo(x, y1); g.lineTo(x, Y(db));
    }
    g.stroke();
    st.lit = null; st.ghost = null;
  }
  function drawUnison(st, g, { w, h: hh }) {
    const o = st.o, n = P[`${o}_unison`] | 0, det = P[`${o}_detune`];
    const vs = unisonVoices(n, det, P[`${o}_blend`], P[`${o}_spread`], P[`${o}_pan`]);
    const edgeCt = det * det * 100;
    g.strokeStyle = rgba(INK.ink, 0.22); g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.round(w / 2) + 0.5, 3); g.lineTo(Math.round(w / 2) + 0.5, hh - 3); g.moveTo(3, Math.round(hh / 2) + 0.5); g.lineTo(w - 3, Math.round(hh / 2) + 0.5); g.stroke();
    // pitch on a scale that keeps a few cents visible: the edge voice at up to 0.42 of the height
    const yScale = (hh / 2 - 5) / Math.max(12, edgeCt * 1.15);
    const wmax = Math.max(...vs.map((v) => v.w));
    for (const v of vs) {
      const x = w / 2 + v.pan * (w / 2 - 6), y = hh / 2 - v.st * 100 * yScale, len = 4 + 10 * (v.w / (wmax || 1));
      g.fillStyle = rgba(INK.ink, 0.35 + 0.65 * v.w / (wmax || 1));
      g.fillRect(x - len / 2, y - 1.25, len, 2.5);
    }
    st.uniText = `${vs.length} voice${vs.length === 1 ? '' : 's'}, ±${edgeCt < 10 ? edgeCt.toFixed(1) : Math.round(edgeCt)} ct`;
    st.uni.el.setAttribute('aria-label', `Osc ${st.O}'s unison: ${st.uniText}, spread ${Math.round(P[`${o}_spread`] * 100)}%`);
    st.uni.el.title = st.uniText;
  }
  function syncOscText(st) {
    const o = st.o, t = P[`${o}_table`] | 0, pos = P[`${o}_pos`];
    const tname = LT().TABLES[t].name;
    st.pickBtn.replaceChildren(h('span.lt-pick-n', tname), h('span.lt-pick-w', WORDS[t]));
    st.pickBtn.setAttribute('aria-label', `${name} osc ${st.O} table: ${tname}, ${WORDS[t]}. Choose a table`);
    st.pickBtn.title = LT().TABLES[t].desc;
    const f = Math.round(pos * 48) + 1;
    st.where.textContent = `frame ${f} of ${FR}`;
    st.view.el.setAttribute('aria-valuenow', String(+(+pos).toFixed(4)));
    st.view.el.setAttribute('aria-valuetext', `frame ${f} of ${FR}, ${tname}`);
    st.quiet.hidden = !(P[`${o}_level`] <= 0);
    st.sec.classList.toggle('lt-silent', P[`${o}_level`] <= 0);
  }

  /* ---------------------------------------------------------------- the table picker */
  let picker = null;
  function openPicker(st) {
    if (picker) { picker.close(); return; }
    const key = `${st.o}_table`, cur = P[key] | 0;
    const items = LT().TABLES.map((tb, i) => {
      const th = cv({ className: 'lt-thumb', label: '' });
      th.el.setAttribute('aria-hidden', 'true'); th.el.removeAttribute('role');
      th.set({ draw: (g, sz) => drawThumb(i, g, sz) });
      const b = h('button.lt-opt' + (i === cur ? '.sel-print' : ''), { type: 'button', role: 'option', 'aria-selected': String(i === cur), tabindex: i === cur ? 0 : -1, dataset: { t: String(i) }, title: tb.desc, onclick: () => { picker?.close(); if (i !== (P[key] | 0)) put({ [key]: i }); } },
        th.el, h('span.lt-opt-t', h('b', tb.name), h('small', WORDS[i])));
      return { b, th };
    });
    const grid = h('div.lt-grid', { role: 'listbox', 'aria-label': `Osc ${st.O}'s table` }, items.map((x) => x.b));
    grid.addEventListener('keydown', (e) => {
      const i = items.findIndex((x) => x.b === document.activeElement);
      if (i < 0) return;
      const cols = phone() ? 2 : 3;
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      const j = d != null ? clamp(i + d, 0, items.length - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
      if (j == null) return;
      e.preventDefault(); e.stopPropagation();
      items.forEach((x, k) => { x.b.tabIndex = k === j ? 0 : -1; });
      items[j].b.focus();
    });
    st.pickBtn.setAttribute('aria-expanded', 'true');
    picker = popover(st.pickBtn, h('div.lt-picker', h('p.lt-picker-h', `Osc ${st.O}: a table`), grid), { className: 'lt-pop', label: `Osc ${st.O}'s table`, onClose: () => { st.pickBtn.setAttribute('aria-expanded', 'false'); for (const x of items) x.th.destroy(); picker = null; } });
    picker.items = items;
    items[cur].b.focus({ preventScroll: true });
    // thumbnails build a few a frame, so opening never stalls
    thumbQueue = items.map((x, i) => [i, x.th]);
  }
  let thumbQueue = [];
  function drawThumb(t, g, { w, h: hh }) {
    if (!thumbCache.has(t)) return;
    const fr = thumbFrames(t), geo = geometry(w, hh, { thumb: true });
    g.fillStyle = INK.ground; g.fillRect(0, 0, w, hh);
    for (let i = fr.length - 1; i >= 0; i--) {
      const z = i / (fr.length - 1);
      pathOf(g, geo, fr[i], z, tmp2);
      geo.P(1, -1.25, z, tmp2); g.lineTo(tmp2[0], tmp2[1]); geo.P(0, -1.25, z, tmp2); g.lineTo(tmp2[0], tmp2[1]); g.closePath();
      g.fillStyle = INK.ground; g.fill();
      pathOf(g, geo, fr[i], z, tmp2);
      g.strokeStyle = rgba(INK.ink, i === 0 ? 0.95 : 0.55 - 0.3 * z); g.lineWidth = i === 0 ? 1.25 : 0.75; g.stroke();
    }
  }

  /* ================================================================ sub and noise */
  // a source's route: through the filter (the lamp lit) or around it, straight to the amp; bound by hand (a lamp is no
  // kit control): its menu, the agent's flash (routes, below), its value from update()
  const routes = new Map();   // key -> [buttons]
  function routeTog(key, words) {
    const b = h('button.tog.lt-route.pk-ctl', { type: 'button', 'aria-pressed': 'true', dataset: { key }, 'aria-label': `${name}: ${words} through the filter`, title: `Lit: ${words} goes through the filter. Out: around it, straight to the amp` }, 'Through the filter');
    b.addEventListener('click', () => put({ [key]: (P[key] | 0) ? 0 : 1 }));
    kit.menuOn(b, (anchor, e) => ctx.menu(key, e && e.clientX != null ? e : anchor));
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push(b);
    return b;
  }
  const subSec = h('section.lt-sec.lt-subn', { dataset: { sec: 'filter' }, 'aria-label': 'Sub and noise' },
    h('div.lt-part', h('h3.lt-h', 'Sub'), glyphs('sub_shape', SUB_GLYPHS, 'WAVE', `${name} sub wave`), h('div.lt-row', ctl('sub_oct', { kind: 'segmented', label: 'OCT', aria: `${name} sub octave` }), ctl('sub_level', { label: 'LEVEL', aria: `${name} sub level` }))),
    h('div.lt-part', h('h3.lt-h', 'Noise'), h('div.lt-row', ctl('noise_level', { label: 'LEVEL', aria: `${name} noise level` }), ctl('noise_color', { label: 'COLOR', aria: `${name} noise colour` }))));
  // the filter's way in: which sources go through it (the rest go around it, straight to the amp)
  const short = (key, word, words) => { const b = routeTog(key, words); b.textContent = word; return b; };
  const fltIn = h('div.lt-in', { role: 'group', 'aria-label': 'What goes through the filter' }, h('span.lt-cap', 'in'), short('flt_a', 'A', 'osc A'), short('flt_b', 'B', 'osc B'), short('flt_sub', 'Sub', 'the sub'), short('flt_noise', 'Noise', 'the noise'));
  const fltType = ctl('flt_type', { kind: 'segmented', label: 'TYPE', aria: `${name} filter type` });
  fltType.classList.add('lt-warpw');

  /* ================================================================ the filter */
  const fltView = cv({ className: 'lt-flt-cv', label: 'The filter' });
  fltView.el.setAttribute('role', 'slider'); fltView.el.tabIndex = 0;
  fltView.el.setAttribute('aria-label', `${name} filter: left and right for the cutoff, up and down for the resonance`);
  fltView.el.setAttribute('aria-valuemin', '0'); fltView.el.setAttribute('aria-valuemax', '1');
  const fltSec = h('section.lt-sec.lt-flt', { dataset: { sec: 'filter' }, 'aria-label': 'Filter' },
    h('div.lt-head', h('h3.lt-h', 'Filter'), fltIn),
    h('div.lt-disp.lt-fd', fltView.el, h('div.lt-fd-top', fltType)),
    h('div.lt-grid3', ctl('flt_cutoff', { label: 'CUTOFF' }), ctl('flt_res', { label: 'RESO' }), ctl('flt_drive', { label: 'DRIVE', aria: `${name} filter drive` }),
      ctl('flt_key', { label: 'KEY', aria: `${name} filter key track` }), ctl('flt_env', { label: 'ENV 2', aria: `${name} filter envelope amount (envelope 2)` }), ctl('flt_vel', { label: 'VEL', aria: `${name} filter velocity` })));
  const flt = { live: null, curve: null, curveSig: '', liveCurve: null, liveSig: '', freqs: null, handle: null, layer: null, layerSig: '' };
  // the display's x axis is the cutoff knob's own travel (20 Hz to 20 kHz on a log scale), so a drag moves it 1:1
  const fx = (f, w) => 6 + (w - 12) * Math.log(f / 20) / Math.log(1000);
  const DB_TOP = 30, DB_BOT = -42, FTOP = 26;
  const fy = (db, hh) => FTOP + (hh - FTOP - 6) * clamp((DB_TOP - db) / (DB_TOP - DB_BOT), 0, 1);
  // The grid, the curve, its handle and the drive's curve change with the params, not with the music: they are drawn
  // once into a layer, and a frame of playing draws the layer and the curve where the cutoff is now
  function filterLayer(w, hh, dpr) {
    const type = P.flt_type | 0, fc = P.flt_cutoff, res = P.flt_res;
    if (!flt.freqs || flt.freqs.length !== Math.max(32, Math.round(w / 2))) { const n = Math.max(32, Math.round(w / 2)); flt.freqs = Array.from({ length: n }, (_, i) => 20 * Math.pow(1000, i / (n - 1))); flt.liveSig = ''; }
    const sig = `${type}|${fc}|${res}|${P.flt_drive}|${w}x${hh}@${dpr}`;
    if (flt.layer && flt.layerSig === sig) return flt.layer;
    const c = flt.layer || document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = INK.ground; g.fillRect(0, 0, w, hh);
    g.strokeStyle = rgba(INK.ink, 0.13); g.lineWidth = 1;
    g.font = `${fontPx()}px ${MONO}`; g.textBaseline = 'bottom';
    for (const [f, lab] of [[100, '100'], [1000, '1k'], [10000, '10k']]) { const x = Math.round(fx(f, w)) + 0.5; g.beginPath(); g.moveTo(x, FTOP - 2); g.lineTo(x, hh - 4); g.stroke(); g.fillStyle = rgba(INK.ink, 0.42); g.fillText(lab, x + 3, hh - 3); }
    const y0 = Math.round(fy(0, hh)) + 0.5; g.strokeStyle = rgba(INK.ink, 0.24); g.beginPath(); g.moveTo(4, y0); g.lineTo(w - 4, y0); g.stroke();
    flt.curve = filterResponse(type, fc, res, flt.freqs); flt.curveSig = `${type}|${fc}|${res}`;
    traceCurve(g, flt.curve, w, hh); g.lineTo(w - 6, hh); g.lineTo(6, hh); g.closePath(); g.fillStyle = rgba(INK.ink, 0.08); g.fill();
    traceCurve(g, flt.curve, w, hh); g.strokeStyle = INK.ink; g.lineWidth = 1.6; g.stroke();
    // the handle: the cutoff across, the resonance up
    const hx = fx(clamp(fc, 20, 20000), w), hy = FTOP + (hh - FTOP - 6) * (1 - res);
    g.setLineDash([2, 3]); g.strokeStyle = rgba(INK.ink, 0.35); g.beginPath(); g.moveTo(Math.round(hx) + 0.5, hy); g.lineTo(Math.round(hx) + 0.5, hh - 4); g.stroke(); g.setLineDash([]);
    g.fillStyle = INK.ink; g.fillRect(hx - 4, hy - 4, 8, 8);
    flt.handle = [hx, hy];
    // FLT DRIVE's curve, bottom left: what the filter gets for an input
    const dw = 22, dx0 = 8, dy0 = hh - dw - 7;
    g.strokeStyle = rgba(INK.ink, 0.2); g.strokeRect(dx0 + 0.5, dy0 + 0.5, dw, dw);
    g.beginPath();
    for (let i = 0; i <= 26; i++) { const xin = -1.4 + 2.8 * i / 26, yo = driveCurve(type, P.flt_drive, xin, res) / 1.4; const x = dx0 + dw * i / 26, y = dy0 + dw / 2 - clamp(yo, -1, 1) * dw / 2; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.strokeStyle = rgba(INK.ink, P.flt_drive > 0.001 ? 0.95 : 0.45); g.lineWidth = 1.2; g.stroke();
    flt.layer = c; flt.layerSig = sig;
    return c;
  }
  function traceCurve(g, curve, w, hh) {
    const n = curve.length;
    g.beginPath();
    for (let i = 0; i < n; i++) { const x = 6 + (w - 12) * i / (n - 1), y = fy(curve[i], hh); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  }
  function drawFilter(g, { w, h: hh, dpr }) {
    g.drawImage(filterLayer(w, hh, dpr), 0, 0, w, hh);
    // where it is now, while notes play
    if (flt.live) {
      const type = P.flt_type | 0, ls = `${type}|${flt.live.fc.toFixed(1)}|${flt.live.res.toFixed(3)}|${flt.freqs.length}`;
      if (flt.liveSig !== ls) { flt.liveCurve = filterResponse(type, flt.live.fc, flt.live.res, flt.freqs); flt.liveSig = ls; }
      traceCurve(g, flt.liveCurve, w, hh); g.strokeStyle = INK.pencil; g.lineWidth = 1.25; g.stroke();
    }
  }
  fltView.set({ draw: drawFilter });
  function syncFilterText() {
    fltView.el.setAttribute('aria-valuenow', String(+kit.pos(p('flt_cutoff'), P.flt_cutoff).toFixed(4)));
    syncFilterNow();
  }
  // while notes play, where the cutoff is now: drawn as a second curve, and said to a screen reader on the display
  function syncFilterNow() {
    const txt = `${FILTERS[P.flt_type | 0]}, cutoff ${fmtHz(P.flt_cutoff)}${flt.live ? ` (now ${fmtHz(flt.live.fc)})` : ''}, reso ${P.flt_res.toFixed(2)}`;
    if (fltView.el.getAttribute('aria-valuetext') !== txt) fltView.el.setAttribute('aria-valuetext', txt);
  }
  {
    const cSpec = p('flt_cutoff'), rSpec = p('flt_res');
    fltView.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { fltView.el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      fltView.el.focus({ preventScroll: true });
      const { w, h: hh } = fltView.size;
      let x0 = e.clientX, y0 = e.clientY, c0 = kit.pos(cSpec, P.flt_cutoff), r0 = P.flt_res, fine = e.shiftKey, moved = false, cv_ = P.flt_cutoff, rv = r0;
      const mv = (ev) => {
        if (ev.shiftKey !== fine) { fine = ev.shiftKey; x0 = ev.clientX; y0 = ev.clientY; c0 = kit.pos(cSpec, cv_); r0 = rv; }
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.hypot(dx, dy) < 2) return;
        moved = true;
        const f = fine ? 0.25 : 1;
        cv_ = kit.snap(cSpec, kit.val(cSpec, clamp(c0 + f * dx / Math.max(40, w - 12), 0, 1)));
        rv = kit.snap(rSpec, clamp(r0 - f * dy / Math.max(30, hh - FTOP - 6), 0, 1));
        put({ flt_cutoff: cv_, flt_res: rv }, { gesture: 'move' });
      };
      const up = () => { fltView.el.removeEventListener('pointermove', mv); fltView.el.removeEventListener('pointerup', up); fltView.el.removeEventListener('pointercancel', up); if (moved) put({ flt_cutoff: cv_, flt_res: rv }, { gesture: 'end' }); };
      fltView.el.addEventListener('pointermove', mv); fltView.el.addEventListener('pointerup', up); fltView.el.addEventListener('pointercancel', up);
    });
    fltView.el.addEventListener('keydown', (e) => {
      const st = e.shiftKey ? 0.002 : 0.01;
      const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      const patchP = {};
      if (d[0]) patchP.flt_cutoff = kit.snap(cSpec, kit.val(cSpec, clamp(kit.pos(cSpec, P.flt_cutoff) + d[0], 0, 1)));
      if (d[1]) patchP.flt_res = kit.snap(rSpec, clamp(P.flt_res + d[1], 0, 1));
      put(patchP);
    });
    kit.menuOn(fltView.el, (anchor, e) => ctx.menu('flt_cutoff', e && e.clientX != null ? e : anchor));
  }

  /* ================================================================ envelopes */
  const ENVS = [1, 2, 3];
  const envView = cv({ className: 'lt-env-cv', label: 'The envelope' });
  const envField = h('div.lt-disp.lt-ed', envView.el);
  const envHandles = {};
  const envKnobs = h('div.lt-grid3');
  const envTabs = picks(ENVS.map((n) => ({ id: n - 1, label: `Env ${n}`, jack: socket(n), title: ['Envelope 1: the amp', 'Envelope 2: the filter\'s too (FLT ENV)', 'Envelope 3: free'][n - 1] })), { label: 'Envelopes', get: () => S.env, set: (i) => { S.env = i; envTabs.sync(); showEnv(); placeEnvHandles(); envView.dirty(); } });
  const envNote = h('span.lt-cap.lt-env-note');
  const envSec = h('section.lt-sec.lt-env', { dataset: { sec: 'env' }, 'aria-label': 'Envelopes' }, h('div.lt-head', envTabs.bar, envNote), envField, envKnobs);
  // every envelope's knobs exist from the start (each param keeps its control, so a lane's mark and an agent's flash
  // find it): the shown one's in the row, the others kept aside, out of sight
  const stash = h('div.lt-stash', { 'aria-hidden': 'true' });
  const envCtls = new Map(ENVS.map((n) => {
    const K = (k) => `env${n}_${k}`, who = n === 1 ? 'amp' : `envelope ${n}`;
    const list = [ctl(K('attack'), { label: 'ATTACK', aria: `${name} ${who} attack` }), ctl(K('decay'), { label: 'DECAY', aria: `${name} ${who} decay` }), ctl(K('sustain'), { label: 'SUSTAIN', aria: `${name} ${who} sustain` }), ctl(K('release'), { label: 'RELEASE', aria: `${name} ${who} release` }), ctl(K('curve'), { label: 'CURVE', aria: `${name} ${who} curve` })];
    if (n === 1) list.push(ctl('env1_vel', { label: 'VEL', aria: `${name} amp velocity` }));
    return [n, list];
  }));
  function showEnv() {
    const n = S.env + 1;
    envZoom = null;
    for (const [m, list] of envCtls) if (m !== n) stash.append(...list);
    envKnobs.replaceChildren(...envCtls.get(n));
    envNote.textContent = n === 1 ? 'the amp' : n === 2 ? 'and FLT ENV' : 'free';
    allRings();
  }
  // The time axis: each segment as wide as its knob's travel, all at one scale (Q px for a knob's whole travel): a
  // knob's own, KNOB_PX (the kit's knobs turn their whole travel in 180 px), when the three fit beside the sustain's
  // fixed hold, and as much as fits when they don't. While a point is dragged the scale holds, and is a knob's if it was
  // less (the drawing stretches round the point under the pointer): the point stays under the pointer and its value
  // moves at a knob's rate. Let go and it eases back to fit (envZoom, from frame()).
  const KNOB_PX = 180;
  let envZoom = null;   // { Q, off } for a drag; { ease: { t0, Q0, off0 } } as it eases back
  function envFit(w, n) {
    const tr = (k) => kit.pos(p(`env${n}_${k}`), P[`env${n}_${k}`]);
    const hold = Math.max(18, Math.round(0.08 * w));
    return { hold, Q: Math.min(KNOB_PX, (w - 20 - hold) / Math.max(0.05, tr('attack') + tr('decay') + tr('release'))) };
  }
  function envGeo(w, hh) {
    const n = S.env + 1, e = { attack: P[`env${n}_attack`], decay: P[`env${n}_decay`], sustain: P[`env${n}_sustain`], release: P[`env${n}_release`], curve: P[`env${n}_curve`] };
    const PAD = 10, top = 9, bot = hh - 9, fit = envFit(w, n), hold = fit.hold;
    let Q = fit.Q, off = 0;
    if (envZoom && envZoom.ease) { const k = clamp((performance.now() - envZoom.ease.t0) / 160, 0, 1), s = k * k * (3 - 2 * k); Q = envZoom.ease.Q0 + (fit.Q - envZoom.ease.Q0) * s; off = envZoom.ease.off0 * (1 - s); }
    else if (envZoom) { Q = envZoom.Q; off = envZoom.off; }
    const tr = (k) => kit.pos(p(`env${n}_${k}`), e[k]);
    const wa = Math.max(3, tr('attack') * Q), wd = Math.max(3, tr('decay') * Q), wr = Math.max(3, tr('release') * Q);
    const x0 = PAD + off, xa = x0 + wa, xd = xa + wd, xs = xd + hold, xr = xs + wr;
    return { n, e, PAD, Q, fit: fit.Q, off, top, bot, x0, xa, xd, xs, xr, wa, wd, wr, hold, Y: (v) => bot - (bot - top) * v };
  }
  function envPath(g, G) {
    const { e, x0, xa, xd, xs, xr, wa, wd, wr, Y } = G, N = 28;
    g.beginPath(); g.moveTo(x0, Y(0));
    for (let i = 1; i <= N; i++) { const t = i / N; g.lineTo(x0 + wa * t, Y(envSegment('attack', e.curve, t))); }
    for (let i = 1; i <= N; i++) { const t = i / N; g.lineTo(xa + wd * t, Y(1 - (1 - e.sustain) * envSegment('decay', e.curve, t))); }
    g.lineTo(xs, Y(e.sustain));
    for (let i = 1; i <= N; i++) { const t = i / N; g.lineTo(xs + wr * t, Y(e.sustain * (1 - envSegment('release', e.curve, t)))); }
  }
  let envDot = null;   // { seg, at, v } for the newest note
  function drawEnv(g, { w, h: hh }) {
    const G = envGeo(w, hh);
    g.fillStyle = INK.ground; g.fillRect(0, 0, w, hh);
    g.strokeStyle = rgba(INK.ink, 0.16); g.lineWidth = 1; g.beginPath(); g.moveTo(4, Math.round(G.bot) + 0.5); g.lineTo(w - 4, Math.round(G.bot) + 0.5); g.stroke();
    g.setLineDash([2, 3]); g.beginPath(); g.moveTo(Math.round(G.xd) + 0.5, G.top); g.lineTo(Math.round(G.xd) + 0.5, G.bot); g.moveTo(Math.round(G.xs) + 0.5, G.top); g.lineTo(Math.round(G.xs) + 0.5, G.bot); g.stroke(); g.setLineDash([]);
    envPath(g, G); g.lineTo(G.xr, G.bot); g.lineTo(G.x0, G.bot); g.closePath(); g.fillStyle = rgba(INK.ink, 0.08); g.fill();
    envPath(g, G); g.strokeStyle = INK.ink; g.lineWidth = 1.6; g.stroke();
    if (envDot) {
      const { seg, at, v } = envDot;
      const x = seg === 'attack' ? G.x0 + G.wa * at : seg === 'decay' ? G.xa + G.wd * at : seg === 'sustain' ? G.xd + G.hold * 0.5 : seg === 'release' ? G.xs + G.wr * at : G.xr;
      g.fillStyle = INK.pencil; g.fillRect(x - 3, G.Y(v) - 3, 6, 6);
      envDot.x = x; envDot.y = G.Y(v);
    }
    root.__lt && (root.__lt.envGeo = G);
  }
  envView.set({ draw: drawEnv });
  // the handles: the attack's peak, the decay's end (up and down: the sustain), the release's end, and the curve on the
  // longest segment; each a slider for the keyboard. A drag sends the same params every move: one undo step.
  const ENV_HOW = { attack: ['Attack: drag sideways', 'Attack: slide sideways'], decay: ['Decay: sideways; the sustain: up and down', 'Decay: slide sideways; the sustain: up and down'], release: ['Release: drag sideways', 'Release: slide sideways'], curve: ['Curve: drag up for snappier, down for a slow swell', 'Curve: slide up for snappier, down for a slow swell'] };
  function envHandle(kind) {
    // (named from the start: a screen reader meets it before its first value arrives)
    const el2 = h('div.lt-eh' + (kind === 'curve' ? '.lt-eh-c' : ''), { role: 'slider', tabindex: 0, title: ENV_HOW[kind][touch() ? 1 : 0], 'aria-label': `Envelope ${S.env + 1} ${kind}`, 'aria-valuemin': 0, 'aria-valuemax': 1, dataset: { kind } });
    envField.append(el2);
    const keysOf = () => { const n = S.env + 1; return kind === 'decay' ? [`env${n}_decay`, `env${n}_sustain`] : [`env${n}_${kind}`]; };
    el2.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      try { el2.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      el2.focus({ preventScroll: true });
      const { w, h: hh } = envView.size, ks = keysOf(), G = envGeo(w, hh);
      // a time point: the scale holds for the gesture, a knob's if the drawing's is under it, offset so the point stays
      // where it was grabbed (taken up at the first move: a click stretches nothing)
      let hold = null;
      if (kind !== 'curve') {
        const xOf = (g) => (kind === 'attack' ? g.xa : kind === 'decay' ? g.xd : g.xr), was = envZoom;
        envZoom = { Q: G.Q < KNOB_PX * 0.8 ? KNOB_PX : G.Q, off: 0 };
        envZoom.off = xOf(G) - xOf(envGeo(w, hh));
        hold = envZoom; envZoom = was;
      }
      const Qd = hold ? hold.Q : G.Q;
      let x0 = e.clientX, y0 = e.clientY, fine = e.shiftKey, moved = false;
      let at = Object.fromEntries(ks.map((k) => [k, k.endsWith('sustain') || k.endsWith('curve') ? P[k] : kit.pos(p(k), P[k])]));
      let cur = Object.fromEntries(ks.map((k) => [k, P[k]]));
      const mv = (ev) => {
        if (ev.shiftKey !== fine) { fine = ev.shiftKey; x0 = ev.clientX; y0 = ev.clientY; at = Object.fromEntries(ks.map((k) => [k, k.endsWith('sustain') || k.endsWith('curve') ? cur[k] : kit.pos(p(k), cur[k])])); }
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.hypot(dx, dy) < 2) return;
        if (!moved && hold) { envZoom = hold; envView.dirty(); placeEnvHandlesSoon = true; }
        moved = true;
        const f = fine ? 0.25 : 1;
        for (const k of ks) {
          const sp = p(k);
          if (k.endsWith('sustain')) cur[k] = kit.snap(sp, clamp(at[k] - f * dy / Math.max(20, G.bot - G.top), 0, 1));
          else if (k.endsWith('curve')) cur[k] = kit.snap(sp, clamp(at[k] - f * 2 * dy / Math.max(20, G.bot - G.top), -1, 1));
          else cur[k] = kit.snap(sp, kit.val(sp, clamp(at[k] + f * dx / Qd, 0, 1)));
        }
        put({ ...cur }, { gesture: 'move' });
      };
      const up = () => {
        el2.removeEventListener('pointermove', mv); el2.removeEventListener('pointerup', up); el2.removeEventListener('pointercancel', up);
        if (moved) put({ ...cur }, { gesture: 'end' });
        if (envZoom && envZoom === hold) { envZoom = { ease: { t0: performance.now(), Q0: hold.Q, off0: hold.off } }; envView.dirty(); }
      };
      el2.addEventListener('pointermove', mv); el2.addEventListener('pointerup', up); el2.addEventListener('pointercancel', up);
    });
    el2.addEventListener('dblclick', () => { const ks = keysOf(); put(Object.fromEntries(ks.map((k) => [k, p(k).def]))); });
    el2.addEventListener('keydown', (e) => {
      const ks = keysOf(), d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (d == null) return;
      e.preventDefault(); e.stopPropagation();
      const st = e.shiftKey ? 0.002 : 0.02;
      const k = kind === 'decay' ? (e.key === 'ArrowUp' || e.key === 'ArrowDown' ? ks[1] : ks[0]) : ks[0], sp = p(k);
      const v = k.endsWith('sustain') ? clamp(P[k] + d * st, 0, 1) : k.endsWith('curve') ? clamp(P[k] + d * st * 2, -1, 1) : kit.val(sp, clamp(kit.pos(sp, P[k]) + d * st, 0, 1));
      put({ [k]: kit.snap(sp, v) });
    });
    kit.menuOn(el2, (anchor, e) => ctx.menu(keysOf()[0], e && e.clientX != null ? e : anchor));
    envHandles[kind] = el2;
  }
  for (const kind of ['attack', 'decay', 'release', 'curve']) envHandle(kind);
  function placeEnvHandles() {
    const { w, h: hh } = envView.size;
    if (!w || !hh) return;
    const G = envGeo(w, hh), n = G.n, e = G.e;
    // (a point the stretched drawing pushes out of the display while another is dragged waits out of sight)
    const place = (k, x, y, key, text) => { const el2 = envHandles[k]; el2.style.left = x + 'px'; el2.style.top = y + 'px'; el2.style.visibility = x < -2 || x > w + 2 ? 'hidden' : ''; el2.setAttribute('aria-valuenow', String(+(+P[key]).toFixed(4))); el2.setAttribute('aria-valuetext', text); el2.setAttribute('aria-label', `${name} envelope ${n} ${k === 'decay' ? 'decay and sustain' : k}`); };
    place('attack', G.xa, G.top, `env${n}_attack`, kit.text(p(`env${n}_attack`), e.attack));
    place('decay', G.xd, G.Y(e.sustain), `env${n}_decay`, `${kit.text(p(`env${n}_decay`), e.decay)}, sustain ${kit.text(p(`env${n}_sustain`), e.sustain)}`);
    place('release', G.xr, G.bot, `env${n}_release`, kit.text(p(`env${n}_release`), e.release));
    // the curve's handle on the widest of the three segments, at its middle
    const segs = [['attack', G.x0, G.wa, (t) => envSegment('attack', e.curve, t)], ['decay', G.xa, G.wd, (t) => 1 - (1 - e.sustain) * envSegment('decay', e.curve, t)], ['release', G.xs, G.wr, (t) => e.sustain * (1 - envSegment('release', e.curve, t))]];
    const best = segs.reduce((a, b) => (b[2] > a[2] ? b : a));
    place('curve', best[1] + best[2] / 2, G.Y(best[3](0.5)), `env${n}_curve`, `${e.curve.toFixed(2)}: ${e.curve < -0.3 ? 'a slow swell' : e.curve > 0.3 ? 'snappy' : 'analogue'}`);
  }

  /* ================================================================ LFOs */
  const lfoView = cv({ className: 'lt-lfo-cv', label: 'The LFO' });
  const lfoRead = h('span.lt-lfo-read.lt-disp-t');
  const lfoTabs = picks([0, 1, 2, 3].map((l) => ({ id: l, label: `LFO ${l + 1}`, jack: socket(4 + l) })), { label: 'LFOs', get: () => S.lfo, set: (l) => { S.lfo = l; lfoTabs.sync(); showLfo(); lfoView.dirty(); } });
  const lfoCtls = new Map();
  const lfoBox = h('div.lt-lfo-ctl');
  const lfoSec = h('section.lt-sec.lt-lfo', { dataset: { sec: 'lfo' }, 'aria-label': 'LFOs' }, h('div.lt-head', lfoTabs.bar), h('div.lt-disp.lt-ld', lfoView.el, lfoRead), lfoBox);
  for (let l = 0; l < 4; l++) {
    const n = l + 1, K = (k) => `lfo${n}_${k}`;
    // (the studio's hertz readout is whole hertz, right for a cutoff and wrong for a 0.08 Hz LFO: this window's own
    // spec of each rate reads its decimals, for its knob and for the line that says what an agent set)
    const rs = ctx.param(K('rate'));
    if (rs) rs.fmt = (v) => `${v < 1 ? (+v).toFixed(2) : v < 10 ? (+v).toFixed(1) : Math.round(v)} Hz`;
    lfoCtls.set(l, h('div.lt-lfo-set', glyphs(K('shape'), SHAPE_GLYPHS, 'SHAPE', `${name} LFO ${n} shape`), ctl(K('mode'), { kind: 'segmented', label: 'MODE', aria: `${name} LFO ${n} mode` }), h('div.lt-row', ctl(K('rate'), { label: 'RATE', aria: `${name} LFO ${n} rate` }), ctl(K('sync'), { kind: 'select', label: 'SYNC', aria: `${name} LFO ${n} sync to the song` }))));
  }
  function showLfo() { for (const [l, set] of lfoCtls) if (l !== S.lfo) stash.append(set); lfoBox.replaceChildren(lfoCtls.get(S.lfo)); syncLfoText(); allRings(); }
  let lfoDot = null;   // { ph, n } of the shown LFO for the newest note (or the song)
  function lfoWindow(l) { const sh = P[`lfo${l + 1}_shape`] | 0; return sh >= 5 ? 6 : (P[`lfo${l + 1}_mode`] | 0) === 2 ? 1 : 2; }
  function drawLfo(g, { w, h: hh }) {
    const l = S.lfo, n = l + 1, sh = P[`lfo${n}_shape`] | 0, mode = P[`lfo${n}_mode`] | 0, cycles = lfoWindow(l);
    g.fillStyle = INK.ground; g.fillRect(0, 0, w, hh);
    const x0 = 8, x1 = w - 8, mid = hh / 2, amp = hh / 2 - 9;
    g.strokeStyle = rgba(INK.ink, 0.16); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, Math.round(mid) + 0.5); g.lineTo(x1, Math.round(mid) + 0.5); g.stroke();
    const span = mode === 2 ? 1.6 : cycles;   // ENV: one cycle, then it holds
    for (let c = 1; c < cycles; c++) { const x = Math.round(x0 + (x1 - x0) * c / span) + 0.5; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, 6); g.lineTo(x, hh - 6); g.stroke(); g.setLineDash([]); }
    // S&H and DRIFT: the cycles' own values (FREE: the ones the song plays from here; RETRIG and ENV: a note's)
    const base = lfoDot ? lfoDot.n - (lfoDot.n % cycles + cycles) % cycles : 977 * n;
    const N = Math.max(60, Math.round(w));
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const tt = (i / N) * span, c = Math.floor(tt), ph = tt - c;
      const v = mode === 2 && tt >= 1 ? lfoShape(sh, 0.999999, base) : lfoShape(sh, mode === 2 && tt >= 1 ? 0.999999 : ph, base + c);
      const x = x0 + (x1 - x0) * i / N, y = mid - v * amp;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = INK.ink; g.lineWidth = 1.6; g.stroke();
    if (lfoDot) {
      const k = mode === 2 ? Math.min(1, lfoDot.ph + (lfoDot.done ? 1 : 0)) : (((lfoDot.n - base) % cycles) + cycles) % cycles + lfoDot.ph;
      const v = lfoShape(sh, lfoDot.ph, lfoDot.n), x = x0 + (x1 - x0) * k / span, y = mid - v * amp;
      g.fillStyle = INK.pencil; g.fillRect(x - 3, y - 3, 6, 6);
      lfoDot.x = x; lfoDot.y = y;
    }
  }
  lfoView.set({ draw: drawLfo });
  function syncLfoText() {
    const l = S.lfo, n = l + 1, sync = P[`lfo${n}_sync`] | 0, bpm = store.get().tempo || 120, hz = lfoHz(P, l, bpm);
    lfoRead.textContent = sync ? `${LFO_SYNCS[sync]} at ${Math.round(bpm)} bpm, ${(1 / hz).toFixed(2)} s` : `${hz >= 10 ? hz.toFixed(1) : hz.toFixed(2)} Hz, ${(1 / hz).toFixed(hz > 2 ? 3 : 2)} s`;
    lfoCtls.get(l).querySelector(`[data-key="lfo${n}_rate"]`)?.classList.toggle('lt-dim', sync > 0);
  }

  /* ================================================================ the matrix */
  const mxRows = [];
  const mxList = h('ol.lt-mx', { 'aria-label': 'Mod matrix: eight slots' });
  for (let j = 0; j < 8; j++) {
    const n = j + 1;
    const src = ctl(`m${n}_src`, { kind: 'select', label: 'SOURCE', aria: `${name} slot ${n} source` });
    const dst = ctl(`m${n}_dst`, { kind: 'select', label: 'DEST', aria: `${name} slot ${n} destination` });
    for (const [e, names] of [[src, SRC_NAME], [dst, DEST_NAME]]) e.querySelectorAll('option').forEach((op, i) => { op.textContent = names[i]; });
    const amt = ctl(`m${n}_amt`, { size: 22, label: 'AMOUNT', aria: `${name} slot ${n} amount`, tall: true });
    const words = h('output.lt-mx-amt');
    const x = h('button.lt-mx-x', { type: 'button', 'aria-label': `Empty slot ${n}`, title: `Empty slot ${n}`, onclick: () => clearSlot(j) });
    x.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4"/></svg>';
    const row = h('li.lt-mx-row', { dataset: { slot: String(n) } }, h('span.lt-mx-n', String(n)), src, h('span.lt-mx-to', { 'aria-hidden': 'true' }, '→'), dst, amt, words, x);
    mxRows.push({ row, words, x });
    mxList.append(row);
  }
  const mxCount = h('span.lt-count');
  function syncMatrix() {
    const ss = slots();
    let n = 0;
    ss.forEach((s, j) => {
      const r = mxRows[j], on = used(s);
      if (on) n++;
      const say_ = on ? `${SRC_NAME[s.src] || 'nothing'} → ${DEST_NAME[s.dst] || 'nowhere'}, ${s.dst ? amountWords(s.dst, s.amt) : pct(s.amt)}` : 'empty';
      r.row.dataset.say = say_;
      r.row.setAttribute('aria-label', `Slot ${j + 1}: ${on ? say_.replace('→', 'to') : 'empty'}`);
      r.row.classList.toggle('lt-empty', !on);
      r.words.textContent = on ? (s.dst ? amountWords(s.dst, s.amt) : pct(s.amt)) : '';
      r.x.disabled = !on;
    });
    mxCount.textContent = `${n} of 8`;
    botTabs.btns[0].setAttribute('aria-label', `Mod matrix, ${n} of 8 slots in use`);
    // the macros say what they move
    for (let m = 0; m < 4; m++) {
      const list = ss.filter((s) => s.src === 11 + m && s.dst).map((s) => `${DEST_NAME[s.dst]} ${amountWords(s.dst, s.amt)}`);
      macroSays[m].textContent = list.length ? list.join(', ') : '';
      macroSays[m].title = list.length ? `Macro ${m + 1} moves ${list.join(', ')}` : `Macro ${m + 1} moves nothing yet: ${touch() ? 'tap its jack, then a knob' : 'drag its jack onto a knob'}`;
    }
  }

  /* ================================================================ FX, voice, macros */
  const fxSec = h('section.lt-pane.lt-fx', { dataset: { sec: 'fx' }, 'aria-label': 'Effects' },
    h('div.lt-grp', h('h3.lt-h', 'Drive'), h('div.lt-row', ctl('fx_drive', { label: 'DRIVE', aria: `${name} output drive` }), ctl('fx_drive_mix', { label: 'MIX', aria: `${name} drive mix` }))),
    h('div.lt-grp', h('h3.lt-h', 'Chorus'), h('div.lt-row', ctl('fx_chorus_depth', { label: 'DEPTH', aria: `${name} chorus depth` }), ctl('fx_chorus_mix', { label: 'MIX', aria: `${name} chorus mix` }))),
    h('div.lt-grp', h('h3.lt-h', 'Delay'), h('div.lt-row', ctl('fx_delay_time', { kind: 'select', label: 'TIME', aria: `${name} delay time` }), ctl('fx_delay_fb', { label: 'FEEDBACK', aria: `${name} delay feedback` }), ctl('fx_delay_mix', { label: 'MIX', aria: `${name} delay mix` }))),
    h('div.lt-grp', h('h3.lt-h', 'Room'), h('div.lt-row', ctl('fx_verb_size', { label: 'SIZE', aria: `${name} room size` }), ctl('fx_verb_mix', { label: 'MIX', aria: `${name} room mix` }))));
  // the whole voice's destinations, which no knob holds: jacks a cable can land on
  function jackEl(d, word, means) {
    const key = '@' + d;
    const dial = h('div.pk-dial.lt-jack-d', { 'aria-hidden': 'true' });
    dial.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="lt-jack-trk"/><line class="lt-jack-mid" x1="50" y1="9" x2="50" y2="19"/><circle class="lt-jack-in" cx="50" cy="50" r="12"/></svg>';
    dial.querySelector('.lt-jack-trk').setAttribute('d', arcPath(50, 50, 40, A0, A0 + SPAN));
    const e = h('div.pk-ctl.pk-knob.lt-jack', { role: 'group', 'aria-label': `${word}: the whole voice (an amount of 1 is ${means}). Drop a source here`, title: `${word}, the whole voice: an amount of 1 is ${means}` }, h('span.pk-l', h('span.pk-l-t', word.toUpperCase())), dial, h('output.pk-v', { 'aria-hidden': 'true' }, 'none'));
    e.style.setProperty('--pk-size', '30px');
    targetOf(key, e);
    return e;
  }
  const voiceSec = h('section.lt-pane.lt-voice', { dataset: { sec: 'fx' }, 'aria-label': 'Voicing' },
    h('div.lt-grp', h('h3.lt-h', 'Voices'), h('div.lt-row', ctl('voice_mode', { kind: 'segmented', label: 'MODE', aria: `${name} voices` }), ctl('voice_glide', { label: 'GLIDE' }), ctl('voice_level', { label: 'VOLUME' }))),
    h('div.lt-grp', h('h3.lt-h', 'The whole voice'), h('div.lt-row', JACKS.map(([d, w, m]) => jackEl(d, w, m)))));
  const mxSec = h('section.lt-pane.lt-mxs', { dataset: { sec: 'mod' }, 'aria-label': 'Mod matrix' }, mxList);
  const botPanes = { mx: mxSec, fx: fxSec, voice: voiceSec };
  const botTabs = tabs([{ id: 'mx', label: 'Mod matrix' }, { id: 'fx', label: 'FX' }, { id: 'voice', label: 'Voice' }], { label: 'Matrix, effects and voicing', get: () => S.bot, set: (v) => { S.bot = v; botTabs.sync(); syncBot(); } });
  botTabs.btns[0].append(mxCount);
  function syncBot() { for (const [k, e] of Object.entries(botPanes)) e.classList.toggle('on', S.bot === k); allRings(); }
  const botSec = h('div.lt-bot', h('div.lt-head.lt-bot-head', botTabs.bar), mxSec, fxSec, voiceSec);
  const macroSays = [];
  // the macros, each with its jack beside its name and what it moves under it; and the sources a note brings
  const macSec = h('section.lt-sec.lt-mac', { dataset: { sec: 'mod' }, 'aria-label': 'Macros and performance sources' },
    h('div.lt-perf', { role: 'group', 'aria-label': 'What each note brings, and the mod wheel' }, [8, 9, 10, 15].map((s) => h('span.lt-perf-s', socket(s), h('span', SRC_SHORT[s])))),
    h('div.lt-macros', [1, 2, 3, 4].map((m) => {
      const say_ = h('small.lt-mac-say'); macroSays.push(say_);
      const k = ctl(`macro${m}`, { size: 40, label: `MACRO ${m}`, tall: true });
      return h('div.lt-macro', k, h('div.lt-mac-jack', socket(10 + m), say_));
    })));

  /* ================================================================ the phone's sections, the layout */
  const PH_TABS = [['osca', 'Osc A'], ['oscb', 'Osc B'], ['filter', 'Filter'], ['env', 'Env'], ['lfo', 'LFO'], ['mod', 'Mod'], ['fx', 'FX']];
  const phTabs = tabs(PH_TABS.map(([v, w]) => ({ id: v, label: w })), { label: `${name} sections`, cls: '.lt-ptabs', get: () => S.tab, set: (v) => { S.tab = v; root.dataset.tab = v; phTabs.sync(); if (v === 'mod') S.bot = 'mx'; if (v === 'fx') S.bot = 'fx'; syncBot(); botTabs.sync(); dirtyAll(); el.scrollTop = 0; } });
  const oscA = buildOsc('a'), oscB = buildOsc('b');
  const OSCS = [oscA, oscB];
  root.append(phTabs.bar,
    h('div.lt-band.lt-band1', oscA.sec, oscB.sec),
    h('div.lt-band.lt-band2', subSec, fltSec, envSec, lfoSec),
    h('div.lt-band.lt-band3', h('section.lt-sec.lt-botsec', { dataset: { sec: 'mod fx' } }, botSec), macSec),
    cable, stash);
  el.append(root);
  S.env = clamp(S.env | 0, 0, 2); S.lfo = clamp(S.lfo | 0, 0, 3);
  envTabs.sync(); showEnv();
  lfoTabs.sync(); showLfo(); syncBot();

  /* ================================================================ live: the notes and what they move */
  // The track's notes (the song's, in beats), rebuilt when the song changes; the keys held now (the window's keyboard,
  // MIDI, musical typing)
  let songNotes = null, songSig = '';
  function noteIndex() {
    const pj = store.get(), t = pj.tracks.find((x) => x.id === track);
    const sig = t ? t.clips.map((c) => `${c.id}:${c.start}:${c.length}:${c.mute ? 1 : 0}:${c.notes?.length || 0}`).join('|') : '';
    if (songNotes && sig === songSig) return songNotes;
    songSig = sig; songNotes = [];
    for (const c of t?.clips || []) {
      if (c.kind !== 'notes' || !Array.isArray(c.notes) || c.mute) continue;
      const cs = +c.start || 0, ce = cs + (+c.length || 0);
      for (const n of c.notes) { if (!n || !Number.isFinite(n.p) || !Number.isFinite(n.t) || n.t < 0) continue; const at = cs + n.t; if (at >= ce) continue; songNotes.push({ at, off: Math.min(at + Math.max(0.001, +n.d || 0.25), ce), p: n.p, v: Number.isFinite(n.v) ? n.v : 0.8 }); }
    }
    songNotes.sort((a, b) => a.at - b.at);
    return songNotes;
  }
  const held = new Map();   // pitch -> { p, v, t0, off }
  const liveOn = (pp, v, on) => { const now = performance.now() / 1000; if (on) held.set(pp, { p: pp, v: v ?? 0.8, t0: now, off: null }); else { const x = held.get(pp); if (x && x.off == null) x.off = now; } };
  offs.push(ctx.keyboard.on(({ p: pp, v, on }) => liveOn(pp, v, on)));
  if (app.input?.on) {
    offs.push(app.input.on('note', (n) => { if (n && n.track === track) liveOn(n.p, n.v, !!n.on); }));
    offs.push(app.input.on('expr', (x) => { if (x && (x.track === track || x.track == null) && Number.isFinite(x.mod)) wheel = x.mod; }));
  }
  let wheel = 0;
  // the newest sounding note: { p, vel, age (s since it started), off (s after the start that it was let go, or null), key }
  function newestNote() {
    const now = performance.now() / 1000, rel = Math.max(P.env1_release, P.env2_release, P.env3_release);
    let best = null;
    for (const [k, x] of held) {
      if (x.off != null && now - x.off > rel) { held.delete(k); continue; }
      if (!best || x.t0 > best.t0) best = { p: x.p, vel: x.v, t0: x.t0, age: now - x.t0, off: x.off == null ? null : x.off - x.t0, key: 'k' + k + ':' + x.t0 };
    }
    const eng = app.engine;
    if (eng && eng.playing && Number.isFinite(eng.beat) && eng.beat >= 0) {
      const beat = eng.beat, bpm = store.get().tempo || 120, spb = 60 / bpm, list = noteIndex();
      // the last note to start at or before the beat, and its neighbours still sounding (or releasing)
      let lo = 0, hi = list.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].at <= beat) lo = m + 1; else hi = m; }
      for (let i = lo - 1; i >= 0 && i >= lo - 64; i--) {
        const n = list[i];
        if (beat > n.off + rel / spb) continue;
        const age = (beat - n.at) * spb;
        const cand = { p: n.p, vel: n.v, t0: now - age, age, off: beat >= n.off ? (n.off - n.at) * spb : null, key: 's' + n.at + ':' + n.p };
        if (!best || cand.t0 > best.t0) best = cand;
        break;
      }
    }
    return best;
  }
  const SRCV = new Float64Array(16), DST = new Float64Array(38), FXM = new Float64Array(4);
  let liveState = null;   // what the views show while notes play
  function liveModel(now) {
    const note = newestNote();
    if (!note) { if (liveState) { liveState = null; return true; } return false; }
    const eng = app.engine, playing = !!(eng && eng.playing), beat = playing ? eng.beat : null, bpm = store.get().tempo || 120;
    const env = (n) => envAt({ attack: P[`env${n}_attack`], decay: P[`env${n}_decay`], sustain: P[`env${n}_sustain`], release: P[`env${n}_release`], curve: P[`env${n}_curve`] }, note.age, note.off);
    const e1 = env(1), e2 = env(2), e3 = env(3);
    SRCV.fill(0);
    SRCV[1] = e1.v; SRCV[2] = e2.v; SRCV[3] = e3.v;
    // (the kernel draws each note's salt and RANDOM from its seeded generator, which the page can't follow: these come
    // from the note itself, so they hold still for its length)
    let kh = 0; for (let i = 0; i < note.key.length; i++) kh = Math.imul(kh ^ note.key.charCodeAt(i), 16777619) >>> 0;
    const salt = Math.floor(hash01(kh) * 100000);
    const lfos = [];
    for (let l = 0; l < 4; l++) {
      const n = l + 1, mode = P[`lfo${n}_mode`] | 0, sync = P[`lfo${n}_sync`] | 0, sh = P[`lfo${n}_shape`] | 0;
      let ph, cyc, done = false;
      if (mode === 0) {
        if (sync && playing) ({ ph, n: cyc } = lfoFree(l, sync, beat));
        else { const b = (now / 1000) * lfoHz(P, l, bpm); cyc = Math.floor(b); ph = b - cyc; cyc += 977 * n; }
      } else {
        const hz = lfoHz(P, l, bpm, DST[22 + l]), b = note.age * hz;
        if (mode === 2 && b >= 1) { ph = 0.999999; cyc = salt; done = true; } else { cyc = Math.floor(b) + salt; ph = b - Math.floor(b); }
      }
      SRCV[4 + l] = lfoShape(sh, ph, cyc);
      lfos.push({ ph, n: cyc, done });
    }
    SRCV[8] = note.vel; SRCV[9] = (note.p - 60) / 48; SRCV[10] = wheel;
    SRCV[11] = P.macro1; SRCV[12] = P.macro2; SRCV[13] = P.macro3; SRCV[14] = P.macro4;
    SRCV[15] = hash01(salt + 7) * 2 - 1;
    const mm = modMatrix(P, SRCV, DST, FXM);
    liveState = { note, e: [e1, e2, e3], lfos, src: SRCV, D: mm.D, fx: mm.fx, A: mm.A };
    return true;
  }

  /* ================================================================ updates */
  function dirtyAll() { for (const st of OSCS) { st.dirty = true; st.view.dirty(); st.uni.dirty(); } fltView.dirty(); envView.dirty(); lfoView.dirty(); allRings(); placeEnvHandlesSoon = true; }
  let placeEnvHandlesSoon = true;
  function apply(keys, { by = null, kind = null } = {}) {
    const ks = new Set(keys || []);
    const any = (re) => [...ks].some((k) => re.test(k));
    for (const st of OSCS) {
      const o = st.o;
      if (!keys || any(new RegExp(`^(${o}_|flt_${o}$|${o === 'a' ? 'b' : 'a'}_(table|pos|warp|warp_amt|oct|semi|fine)$)`))) { st.dirty = true; st.view.dirty(); syncOscText(st); }
      if (!keys || any(new RegExp(`^${o}_(unison|detune|blend|spread|pan)$`))) st.uni.dirty();
    }
    for (const [k, bs] of routes) if (!keys || ks.has(k)) for (const b of bs) b.setAttribute('aria-pressed', String((P[k] | 0) === 1));
    // (the controls bound by hand flash like the kit's when an agent turns them: the routes and the tables' names)
    if (keys && kind === 'do' && by && ctx.isAgent(by)) {
      for (const [k, bs] of routes) if (ks.has(k)) for (const b of bs) ctx.flash(b);
      for (const st of OSCS) if (ks.has(`${st.o}_table`)) ctx.flash(st.pickBtn);
    }
    if (!keys || any(/^flt_/)) { fltView.dirty(); syncFilterText(); }
    if (!keys || any(/^env\d_/)) { envView.dirty(); placeEnvHandlesSoon = true; }
    if (!keys || any(/^lfo\d_/)) { lfoView.dirty(); syncLfoText(); }
    if (!keys || any(/^m\d_|^macro/)) syncMatrix();
    // rings: every target whose value moved, and all of them when a slot changed
    if (!keys || any(/^m\d_/)) allRings();
    else for (const k of ks) if (targets.has(k)) ringsDirty.add(k);
    // an agent writing a slot: its ring flashes in the agent's ink
    if (keys && kind === 'do' && by && ctx.isAgent(by)) {
      const js = new Set([...ks].map((k) => /^m(\d)_/.exec(k)).filter(Boolean).map((m) => +m[1] - 1));
      for (const j of js) {
        const s = slots()[j];
        const tk = s.dst ? DEST_TARGETS[s.dst]?.key || '@' + s.dst : null;
        if (tk && targets.has(tk)) { pendingFlash.set(tk, new Set([...(pendingFlash.get(tk) || []), j])); ringsDirty.add(tk); ctx.flash(targets.get(tk).el); }
      }
    }
  }
  function update(evt) {
    if (!alive || !evt) return;
    if (evt.type === 'params') { P = evt.params || ctx.params(); apply(evt.keys, evt); }
    else if (evt.type === 'lanes') { P = ctx.params(); apply(null); }
  }
  apply(null);
  offs.push(store.on('change', (e) => { if (alive && e && e.kind === 'do' && e.by === 'you') nameEntry(e.txn); }));
  // the words a touch screen gets, whenever the pointer changes (a laptop's screen folded back)
  const onPointer = () => {
    for (const [b, src] of jacks) jackWords(b, src);
    for (const st of OSCS) st.words();
    for (const [kind, el2] of Object.entries(envHandles)) el2.title = ENV_HOW[kind][touch() ? 1 : 0];
    syncMatrix(); allRings();
  };
  COARSE.addEventListener?.('change', onPointer);
  offs.push(() => COARSE.removeEventListener?.('change', onPointer));

  /* ================================================================ the frame */
  let lastLive = false;
  function frame(now) {
    if (!alive) return;
    const t0 = performance.now();
    if (acc > 0) { times.push(acc); if (times.length > 600) times.shift(); acc = 0; }
    // what plays: the newest note's modulation
    const moving = liveModel(now);
    if (moving || lastLive) {
      lastLive = !!liveState;
      const L = liveState;
      for (const st of OSCS) {
        const o = st.o, dPos = o === 'a' ? 1 : 7, dWarp = o === 'a' ? 2 : 8;
        const gp = L ? clamp(P[`${o}_pos`] + L.D[dPos], 0, 1) : null, ga = L ? clamp(P[`${o}_warp_amt`] + L.D[dWarp], 0, 1) : null;
        if (gp !== st.ghostPos || ga !== st.ghostAmt) { st.ghostPos = gp; st.ghostAmt = ga; st.dirty = true; st.view.dirty(); }
      }
      if (L) {
        const fc = cutoffAt(P, { p: L.note.p, vel: L.note.vel, e2: L.e[1].v, d: L.D[15] }), res = clamp(P.flt_res + L.D[16], 0, 1);
        if (!flt.live || Math.abs(flt.live.fc - fc) > 0.05 || Math.abs(flt.live.res - res) > 1e-4) { flt.live = { fc, res }; fltView.dirty(); syncFilterNow(); }
        const e = L.e[S.env];
        envDot = { seg: e.seg, at: e.at, v: e.v }; envView.dirty();
        const ld = L.lfos[S.lfo];
        lfoDot = { ph: ld.ph, n: ld.n, done: ld.done }; lfoView.dirty();
      } else { flt.live = null; envDot = null; lfoDot = null; fltView.dirty(); envView.dirty(); lfoView.dirty(); syncFilterNow(); }
      // the ticks on the rings
      for (const t of targets.values()) ticks(t);
    }
    // a synced FREE LFO runs with the song even between notes
    if (!liveState && app.engine?.playing) {
      const l = S.lfo, n = l + 1, sync = P[`lfo${n}_sync`] | 0, mode = P[`lfo${n}_mode`] | 0;
      if (mode === 0 && sync && Number.isFinite(app.engine.beat)) { const f = lfoFree(l, sync, Math.max(0, app.engine.beat)); lfoDot = { ph: f.ph, n: f.n }; lfoView.dirty(); }
    } else if (!liveState && lfoDot) { lfoDot = null; lfoView.dirty(); }
    if (ringsDirty.size) { for (const k of ringsDirty) { const t = targets.get(k); if (t && t.el.isConnected && t.el.getClientRects().length) drawRings(t, { flash: pendingFlash.get(k) }); pendingFlash.delete(k); } ringsDirty.clear(); }
    // an envelope let go: its drawing eases back to fit (envGeo reads the time)
    if (envZoom && envZoom.ease) { if (performance.now() - envZoom.ease.t0 >= 160) envZoom = null; envView.dirty(); placeEnvHandlesSoon = true; }
    if (placeEnvHandlesSoon && envView.size.w) { placeEnvHandlesSoon = false; placeEnvHandles(); }
    // the cable, the spring-loaded tabs, the body scrolling under it
    if (patch && patch.drag) {
      drawCable();
      if (patch.hoverTab && performance.now() - patch.hoverAt > 450 && patch.hoverTab.getAttribute('aria-selected') !== 'true' && patch.hoverTab.getAttribute('aria-pressed') !== 'true') { patch.hoverTab.click(); patch.hoverAt = performance.now() + 1e9; }
      const r = el.getBoundingClientRect();
      if (patch.y > r.bottom - 28) el.scrollTop += 8; else if (patch.y < r.top + 28) el.scrollTop -= 8;
    }
    // the picker's thumbnails, a few a frame
    if (thumbQueue.length) { const t1 = performance.now(); while (thumbQueue.length && performance.now() - t1 < 4) { const [t, th] = thumbQueue.shift(); thumbFrames(t); th.dirty(); } }
    const ms = performance.now() - t0;
    acc += ms; tally_('frame', ms);
  }
  function ticks(t) {
    if (!t.rings.size) return;
    const L = liveState, x = valueOf(t), travel = DEST_TARGETS[t.d].travel;
    for (const r of t.rings.values()) {
      if (!L || !r.R) { r.tick.setAttribute('display', 'none'); continue; }
      r.tick.removeAttribute('display');
      const a = clamp(L.A ? L.A[r.slot.j] : r.slot.amt, -1, 1), sv = L.src[r.slot.src] || 0;
      const at = A0 + SPAN * clamp(x + a * sv * travel, 0, 1);
      r.tick.setAttribute('x', (r.c + r.R * Math.cos(at) - 1.5).toFixed(1)); r.tick.setAttribute('y', (r.c + r.R * Math.sin(at) - 1.5).toFixed(1));
    }
  }

  /* ================================================================ phone */
  const onPhone = () => { root.classList.toggle('lt-phone', phone()); dirtyAll(); };
  PHONE.addEventListener?.('change', onPhone);
  offs.push(() => PHONE.removeEventListener?.('change', onPhone));
  onPhone();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { allRings(); placeEnvHandlesSoon = true; }) : null;
  ro?.observe(root);

  /* ================================================================ the test's window */
  root.__lt = {
    message: '',
    said: () => said,
    stats() { const xs = times.slice().sort((a, b) => a - b); const q = (f) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(f * xs.length))] : 0; return { n: xs.length, mean: xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0, p95: q(0.95), max: xs.length ? xs[xs.length - 1] : 0 }; },
    resetStats() { times.length = 0; acc = 0; parts.clear(); },
    parts() { return Object.fromEntries([...parts].map(([k, x]) => [k, { mean: +(x.ms / x.n).toFixed(3), max: +x.max.toFixed(2), n: x.n }])); },
    osc(o) { const st = o === 'b' ? oscB : oscA; return { view: S.view[st.o], table: P[`${st.o}_table`] | 0, pos: P[`${st.o}_pos`], lit: st.lit ? Array.from(st.lit) : null, litPts: st.litPts, ghost: st.ghost, ghostPos: st.ghostPos, layerSig: st.layerSig, canvas: st.view.el }; },
    filter() { return { curve: flt.curve ? Array.from(flt.curve) : null, freqs: flt.freqs, live: flt.live, handle: flt.handle }; },
    env() { return { tab: S.env, dot: envDot }; },
    lfo() { return { tab: S.lfo, dot: lfoDot ? { ...lfoDot } : null }; },
    live() { return liveState ? { note: liveState.note, D: Array.from(liveState.D) } : null; },
    rings(key) { const t = targets.get(key); return t ? [...t.rings.values()].map((r) => ({ slot: r.slot.j + 1, src: r.slot.src, amt: r.slot.amt, d: r.arc.getAttribute('d'), flash: r.g.classList.contains('lt-flash') })) : []; },
    targets: () => [...targets.keys()],
    patching: () => (patch ? { src: patch.src, full: patch.full, drag: patch.drag } : null),
    tab: () => S.tab,
  };

  return {
    update,
    frame,
    unmount() {
      alive = false;
      endPatch();
      picker?.close();
      for (const off of offs) { try { off(); } catch (e) { /* gone */ } }
      ro?.disconnect();
      for (const c of canvases) c.destroy();
      root.remove();
    },
  };
}

/* ================================================================ styles */
const CSS = `
/* Light Table's window (ui/editors/wavetable.js): three bands under hairlines; the displays in the device's own colours
   (--pw-pc its ground, --pw-pi its ink), as a screen set into the instrument; modulation in grease pencil */
.lt { position: relative; display: flex; flex-direction: column; width: 1092px; max-width: 100%; min-width: 0; color: var(--text); }
.lt-band { display: flex; min-width: 0; border-top: var(--rule); }
.lt-band1 { border-top: 0; }
.lt-band > * { min-width: 0; }
.lt-band > * + * { border-left: var(--rule); }
.lt-sec { min-width: 0; padding: 10px 14px; }
.lt-band1 .lt-osc { flex: 1 1 0; }
.lt-band2 .lt-subn { flex: 0 0 180px; }
.lt-band2 .lt-flt { flex: 1.1 1 0; }
.lt-band2 .lt-env { flex: 1 1 0; }
.lt-band2 .lt-lfo { flex: 1.05 1 0; }
.lt-band3 .lt-botsec { flex: 1 1 0; padding-bottom: 8px; }
.lt-band3 .lt-mac { flex: 0 0 300px; }
.lt-h { margin: 0; font: 600 12.5px/1.2 var(--font-ui); color: var(--text-2); }
.lt-head { display: flex; align-items: center; gap: 8px; min-height: 26px; margin-bottom: 6px; }
.lt-cap { font: 400 11px/1.2 var(--font-ui); color: var(--text-3); }
.lt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; }
.lt-stash { display: none; }
/* a knob, compact: the dial, and beside it its label over its value, like a spec sheet */
.lt .pk-knob.lt-hk { display: inline-grid; grid-template-columns: auto minmax(0, auto); grid-template-areas: "d l" "d v"; column-gap: 7px; row-gap: 0; align-items: center; justify-items: start; min-width: 0; }
.lt .lt-hk > .pk-l { grid-area: l; align-self: end; font-size: 10.5px; }
.lt .lt-hk > .pk-dial { grid-area: d; }
.lt .lt-hk > .pk-v { grid-area: v; align-self: start; text-align: left; font-size: 11.5px; }
.lt-grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, auto)); justify-content: space-between; gap: 6px 8px; }
.lt-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, auto)); justify-content: space-between; gap: 6px 8px; }
/* the displays: square, the device's ground, no rule around them */
.lt-disp { position: relative; min-width: 0; background: var(--pw-pc, #1d2a33); color: var(--pw-pi, #ece6d6); }
.lt-disp canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
.lt-disp canvas:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.lt-disp-t { font: 400 10.5px/1.2 var(--font-mono); color: color-mix(in srgb, var(--pw-pi) 62%, transparent); }
/* the oscillators: the display and its knobs, and beside them the unison drawn, the route and the pitch */
.lt-osc-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 14px; }
.lt-osc-l { display: grid; gap: 7px; min-width: 0; }
.lt-osc-r { display: grid; align-content: start; justify-items: start; gap: 5px; }
.lt-tv { height: 120px; }
.lt-tv .lt-tv-cv { cursor: ns-resize; }
.lt-tv-top { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px 0 10px; pointer-events: none; }
.lt-tv-top > * { pointer-events: auto; }
.lt-letter { font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 125%; font-variation-settings: var(--font-display-vars); font-size: 24px; line-height: 1; color: var(--pw-pi); pointer-events: none; }
.lt .lt-pick { display: grid; justify-items: start; gap: 1px; margin-top: 1px; padding: 1px 4px 2px; border: 0; border-radius: var(--r-press); background: var(--pw-pc); color: var(--pw-pi); text-align: left; cursor: pointer; }
.lt .lt-pick:hover { background: color-mix(in srgb, var(--pw-pi) 10%, transparent); }
.lt .lt-pick:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.lt-pick-n { font: 700 12.5px/1.15 var(--font-ui); letter-spacing: .02em; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--pw-pi) 40%, transparent); text-underline-offset: 3px; }
.lt-pick-w { font: 400 11px/1.2 var(--font-ui); color: color-mix(in srgb, var(--pw-pi) 70%, transparent); }
.lt-tv-right { display: grid; justify-items: end; gap: 3px; margin-left: auto; }
.lt-tv-right .lt-disp-t { padding: 0 3px; background: var(--pw-pc); }
.lt-views { display: inline-flex; background: var(--pw-pc); }
.lt-vbtn { height: 20px; padding: 0 6px; border: 0; border-radius: var(--r-press); background: none; color: color-mix(in srgb, var(--pw-pi) 72%, transparent); font: 600 11px/1 var(--font-ui); cursor: pointer; }
.lt-vbtn:hover { color: var(--pw-pi); }
.lt-vbtn.sel-print { background: var(--pw-pi); color: var(--pw-pc); }
.lt-vbtn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.lt-tv-meta { position: absolute; right: 7px; bottom: 5px; display: flex; gap: 10px; padding: 1px 2px; background: var(--pw-pc); pointer-events: none; }
.lt-quiet[hidden] { display: none; }
.lt-tv-foot { position: absolute; left: 4px; bottom: 3px; display: flex; padding: 1px 2px; background: var(--pw-pc); pointer-events: none; }
.lt-tv-foot > * { pointer-events: auto; }
/* the warp: the kit's switch, set small on the display */
.lt .lt-warpw { display: inline-flex; flex-direction: row; align-items: center; gap: 4px; }
.lt .lt-warpw > .pk-l { font: 400 10.5px/1 var(--font-mono); color: color-mix(in srgb, var(--pw-pi) 62%, transparent); margin-right: 2px; }
.lt .lt-warpw .pk-seg-b { min-width: 0; height: 20px; margin: 0; padding: 0 5px; border: 0; border-radius: var(--r-press); background: none; color: color-mix(in srgb, var(--pw-pi) 72%, transparent); font: 600 10.5px/1 var(--font-ui); }
.lt .lt-warpw .pk-seg-b:hover { color: var(--pw-pi); }
.lt .lt-warpw .pk-seg-b.sel-print { background: var(--pw-pi); color: var(--pw-pc); }
.lt-uni { display: grid; gap: 3px; }
.lt-uni canvas { display: block; width: 112px; height: 38px; background: var(--pw-pc, #1d2a33); }
.lt .lt-route { display: inline-flex; justify-items: initial; height: 26px; padding: 0 2px; }
.lt-silent .lt-tv { opacity: .84; }
/* a switch or a list: its label beside it */
.lt .pk-seg, .lt .pk-sel { grid-auto-flow: column; align-items: center; justify-items: start; gap: 7px; }
.lt .pk-seg > .pk-l, .lt .pk-sel > .pk-l { font-size: 10.5px; }
/* sub and noise (room in a row for LEVEL's rings beside COLOR) */
.lt-subn { display: grid; align-content: start; gap: 10px; padding-left: 12px; padding-right: 12px; }
.lt-part { display: grid; justify-items: start; gap: 6px; }
.lt .lt-gly { min-width: 0; padding: 0 5px; }
.lt-gly svg { display: block; }
.lt .pk-seg .pk-seg-b { height: 26px; }
.lt .pk-select { height: 26px; }
/* the filter: its type, its curve, what goes through it, its knobs */
.lt-fd { height: 86px; }
.lt-fd-top { position: absolute; left: 6px; top: 3px; right: 6px; display: flex; pointer-events: none; }
.lt-fd-top > * { pointer-events: auto; }
.lt-fd-top .pk-l-t { display: none; }
.lt .lt-fd-top .pk-seg-b { padding: 0 4px; }
.lt-fd canvas { cursor: move; }
.lt-in { display: flex; flex-wrap: wrap; align-items: center; gap: 0 2px; margin-left: auto; }
.lt-in .lt-cap { margin-right: 4px; }
.lt .lt-in .lt-route { height: 24px; padding: 0 5px 0 2px; gap: 5px; }
.lt-flt .lt-grid3, .lt-env .lt-grid3 { margin-top: 6px; }
/* envelopes */
.lt-ed { height: 72px; }
.lt-eh { position: absolute; z-index: 2; width: 10px; height: 10px; margin: -5px 0 0 -5px; background: var(--pw-pi); border-radius: var(--r-press); cursor: grab; touch-action: none; outline: none; }
.lt-eh.lt-eh-c { width: 8px; height: 8px; margin: -4px 0 0 -4px; background: var(--pw-pc); border: 1.5px solid var(--pw-pi); cursor: ns-resize; }
.lt-eh:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.lt-env-note { margin-left: auto; white-space: nowrap; }
/* the envelopes' and LFOs' words (the shown one underlined in cream), each with its source's jack */
.lt-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 0 2px; min-width: 0; }
.lt-pk { display: inline-flex; align-items: center; }
.lt-tab { height: 24px; padding: 0 4px; border: 0; background: none; color: var(--text-3); font: 600 12px/1 var(--font-ui); white-space: nowrap; cursor: pointer; box-shadow: inset 0 -2px 0 transparent; }
.lt-tab:hover { color: var(--text-2); }
.lt-tab.on { color: var(--text); box-shadow: inset 0 -2px 0 var(--text); }
.lt-tab:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.lt-count { margin-left: 6px; font: 400 11px/1 var(--font-mono); color: var(--text-3); }
/* a source's jack: a socket to pull a cable from */
.lt-sock { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 4px; padding: 0; border: 0; border-radius: var(--r-press); background: none; color: var(--text-3); cursor: grab; touch-action: none; }
.lt-sock:hover, .lt-sock[aria-pressed="true"] { color: var(--accent-2); }
.lt-sock:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.lt-sock svg { display: block; }
/* LFOs */
.lt-ld { height: 56px; }
.lt-lfo-read { position: absolute; left: 6px; bottom: 4px; padding: 1px 2px; background: var(--pw-pc); pointer-events: none; }
.lt-lfo-set { display: grid; justify-items: start; gap: 6px; margin-top: 7px; }
.lt-lfo-set .pk-seg-b { min-width: 0; padding: 0 6px; }
.lt-lfo-set .pk-sel { grid-auto-flow: column; align-items: center; gap: 6px; }
.lt-lfo-set .pk-select { max-width: 96px; }
.lt-dim .pk-dial, .lt-dim .pk-v { opacity: .4; }
/* the bottom band: the matrix, FX and voicing in tabs; the macros and the performance sources beside them */
.lt-bot { min-width: 0; }
.lt-bot .lt-tabs { margin-bottom: 4px; }
.lt-pane { display: none; }
.lt-pane.on { display: flex; }
.lt-mxs.on { display: block; }
.lt-fx.on, .lt-voice.on { flex-wrap: wrap; gap: 10px 28px; padding-top: 4px; }
.lt-grp { display: grid; align-content: start; justify-items: start; gap: 6px; }
.lt-grp .lt-row { gap: 8px 12px; }
.lt-grp .pk-sel { grid-auto-flow: column; align-items: center; gap: 6px; }
.lt-mx { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-auto-flow: column; grid-template-rows: repeat(4, auto); gap: 0 22px; margin: 0; padding: 0; list-style: none; }
.lt-mx-row { display: grid; grid-template-columns: 12px minmax(0, 1fr) 12px minmax(0, 1.15fr) 30px 54px 22px; align-items: center; gap: 0 5px; min-height: 28px; border-bottom: var(--rule); }
.lt-mx-row.lt-empty .pk-knob, .lt-mx-row.lt-empty .lt-mx-to { visibility: hidden; }
.lt .lt-mx-row.lt-empty .pk-select { color: var(--text-3); font-weight: 400; }
.lt-mx-n { font: 400 11px/1 var(--font-mono); color: var(--text-3); }
.lt-mx-to { color: var(--text-3); font-size: 12px; text-align: center; }
.lt-mx-row .pk-l, .lt-mx-row .pk-v { display: none; }
.lt-mx-row .pk-sel { display: block; min-width: 0; }
.lt .lt-mx-row .pk-select { width: 100%; max-width: none; height: 24px; padding: 0 2px; border-color: transparent; background: none; font-weight: 600; text-overflow: ellipsis; }
.lt .lt-mx-row .pk-select:hover { border-color: var(--line-2); }
.lt-mx-row .pk-knob { min-width: 0; justify-self: center; }
.lt-mx-amt { font: 400 11.5px/1 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text); text-align: right; white-space: nowrap; }
.lt-mx-x { display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: var(--r-press); background: none; color: var(--text-3); cursor: pointer; }
.lt-mx-x:hover:not(:disabled) { color: var(--text); background: var(--bg-3); }
.lt-mx-x:disabled { visibility: hidden; }
.lt-mx-x:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
/* macros */
.lt-mac .lt-perf { flex-wrap: nowrap; margin: 0 0 6px; padding: 0 0 6px; border-top: 0; border-bottom: var(--rule); }
.lt-macros { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; }
.lt-macro { display: grid; justify-items: center; gap: 0; min-width: 0; }
.lt-mac-jack { display: flex; align-items: center; justify-content: center; gap: 0; min-width: 0; max-width: 100%; }
.lt-mac-jack .lt-sock { flex: none; margin: 0; }
.lt-mac-say { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 10.5px/1.25 var(--font-ui); color: var(--text-3); }
.lt-perf { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; margin-top: 6px; padding-top: 5px; border-top: var(--rule); }
.lt-perf-s { display: inline-flex; align-items: center; font: 600 11.5px/1 var(--font-ui); color: var(--text-2); }
.lt-perf-s .lt-sock { margin-right: 1px; }
/* the whole voice's jacks: a dashed track where a knob would be */
.lt-jack-d { cursor: default; }
.lt-jack-trk { fill: none; stroke: var(--line-2); stroke-width: 5; stroke-dasharray: 3 4; }
.lt-jack-mid { stroke: var(--text-3); stroke-width: 1.5; }
.lt-jack-in { fill: none; stroke: var(--line-2); stroke-width: 3; }
.lt-jack .pk-v { color: var(--text-3); }
/* rings: a slot's amount around its knob, in grease pencil; its square drags it; the tick moves with the source */
.lt-tgt { position: relative; }
.lt-rings { position: absolute; z-index: 2; pointer-events: none; }
.lt-rings-svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.lt-ring-trk { fill: none; stroke: var(--line-2); stroke-width: 1; }
.lt-ring-arc { fill: none; stroke: var(--accent-2); stroke-width: 2.25; }
.lt-ring-hit { fill: none; stroke: transparent; stroke-width: 7; pointer-events: stroke; cursor: ns-resize; }
.lt-ring-tick { fill: var(--text); }
.lt-ring-h { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; background: var(--accent-2); border-radius: 1px; pointer-events: auto; cursor: ns-resize; touch-action: none; outline: none; }
.lt-ring-h::before { content: ''; position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; border-radius: 50%; transform: translate(-50%, -50%); }
.lt-ring-h:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
/* a knob wearing rings keeps --lt-room round its dial (drawRings): its name and value step aside, and its neighbour on
   the left; every dial sits over the rings (its round face, not its drawing's square), so a press on a dial turns it */
.lt .pk-dial { position: relative; z-index: 3; }
.lt .pk-dial svg { pointer-events: none; }
.lt .lt-hk.lt-modded { column-gap: max(7px, var(--lt-room, 7px)); }
.lt .lt-hk.lt-modded:not(:first-child) { padding-left: max(0px, calc(var(--lt-room, 8px) - 8px)); }
.lt .lt-jack { row-gap: 12px; min-width: 54px; }
.lt .lt-jack.lt-modded { row-gap: max(12px, var(--lt-room, 12px)); min-width: calc(var(--pk-size, 30px) + 2 * var(--lt-room, 12px)); }
.lt-ring.lt-flash .lt-ring-arc { animation: lt-agent 1.6s var(--ease) both; }
.lt-ring-h.lt-flash { animation: lt-agent-h 1.6s var(--ease) both; }
@keyframes lt-agent { 0%, 35% { stroke: var(--agent); stroke-width: 3; } 100% { stroke: var(--accent-2); } }
@keyframes lt-agent-h { 0%, 35% { background: var(--agent); } 100% { background: var(--accent-2); } }
/* a source's own rings stand out while its cable is out */
.lt[data-hl-src] .lt-ring .lt-ring-arc { opacity: .35; }
.lt[data-hl-src="1"] .lt-ring[data-src="1"] .lt-ring-arc, .lt[data-hl-src="2"] .lt-ring[data-src="2"] .lt-ring-arc, .lt[data-hl-src="3"] .lt-ring[data-src="3"] .lt-ring-arc,
.lt[data-hl-src="4"] .lt-ring[data-src="4"] .lt-ring-arc, .lt[data-hl-src="5"] .lt-ring[data-src="5"] .lt-ring-arc, .lt[data-hl-src="6"] .lt-ring[data-src="6"] .lt-ring-arc,
.lt[data-hl-src="7"] .lt-ring[data-src="7"] .lt-ring-arc, .lt[data-hl-src="8"] .lt-ring[data-src="8"] .lt-ring-arc, .lt[data-hl-src="9"] .lt-ring[data-src="9"] .lt-ring-arc,
.lt[data-hl-src="10"] .lt-ring[data-src="10"] .lt-ring-arc, .lt[data-hl-src="11"] .lt-ring[data-src="11"] .lt-ring-arc, .lt[data-hl-src="12"] .lt-ring[data-src="12"] .lt-ring-arc,
.lt[data-hl-src="13"] .lt-ring[data-src="13"] .lt-ring-arc, .lt[data-hl-src="14"] .lt-ring[data-src="14"] .lt-ring-arc, .lt[data-hl-src="15"] .lt-ring[data-src="15"] .lt-ring-arc { opacity: 1; }
/* while a cable is out: the knobs it can reach, dashed; the one under it, solid */
.lt-can .pk-dial { outline: 1.5px dashed var(--accent-2); outline-offset: 5px; border-radius: 50%; }
.lt-can.lt-over .pk-dial { outline-style: solid; outline-width: 2px; }
.lt-patching .lt-tgt:not(.lt-can) .pk-dial { opacity: .5; }
.lt-cable { position: absolute; left: 0; top: 0; z-index: 30; width: 100%; height: 100%; overflow: visible; pointer-events: none; display: none; }
.lt-cable.on { display: block; }
.lt-cable-p { fill: none; stroke: var(--accent-2); stroke-width: 1.75; }
.lt-cable-end { fill: var(--accent-2); }
.lt-cable.full .lt-cable-p { stroke: var(--text-3); stroke-dasharray: 4 4; }
.lt-cable.full .lt-cable-end { fill: var(--text-3); }
.lt-cable-say { font: 600 12px var(--font-ui); fill: var(--text); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
/* the table picker */
.ew-pop.lt-pop { max-width: min(600px, calc(100vw - 16px)); padding: 10px; }
.lt-picker-h { margin: 0 0 8px; font: 600 12.5px/1.2 var(--font-ui); color: var(--text-2); }
.lt-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.lt-opt { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 44px; padding: 4px 6px 4px 4px; border: 0; border-radius: var(--r-press); background: none; color: var(--text); text-align: left; cursor: pointer; }
.lt-opt:hover { background: var(--bg-2); }
.lt-opt.sel-print:hover { background: var(--text); }
.lt-opt:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.lt-opt canvas { display: block; width: 64px; height: 38px; }
.lt-opt-t { display: grid; gap: 2px; min-width: 0; }
.lt-opt-t b { font: 700 12px/1.1 var(--font-ui); letter-spacing: .02em; }
.lt-opt-t small { font: 400 11px/1.25 var(--font-ui); color: var(--text-3); }
.lt-opt.sel-print small { color: var(--bg); }
/* the phone's section tabs (on a phone only) */
.lt-ptabs { display: none; }
/* a narrower window: the second band wraps under the sub and noise */
@media (min-width: 901px) and (max-width: 1130px) { .lt-band2 { flex-wrap: wrap; } .lt-band2 .lt-subn { flex: 1 1 100%; display: flex; flex-wrap: wrap; gap: 8px 30px; border-bottom: var(--rule); } .lt-band2 .lt-subn .lt-part { grid-auto-flow: column; align-items: center; } .lt-band2 .lt-flt { border-left: 0; } }
/* a short screen (a 1280 x 800 laptop): the same three bands drawn tighter, so the matrix and the macros sit above the
   window's keyboard with nothing to scroll; the oscillator's own route lamp gives way to the filter's "in" row, the same
   switch */
@media (min-width: 901px) and (max-height: 889px) {
  .lt-sec { padding-top: 7px; padding-bottom: 7px; }
  .lt-tv { height: 96px; }
  .lt-osc-l { gap: 5px; }
  .lt-osc-r { gap: 4px; }
  .lt-osc-r > .lt-route { display: none; }
  .lt-uni canvas { height: 30px; }
  .lt-head { min-height: 24px; margin-bottom: 4px; }
  .lt-fd { height: 66px; }
  .lt-ed { height: 58px; }
  .lt-ld { height: 40px; }
  .lt-flt .lt-grid3, .lt-env .lt-grid3 { margin-top: 4px; }
  .lt-lfo-set { gap: 3px; margin-top: 5px; }
  .lt-subn { gap: 6px; }
  .lt-part { gap: 4px; }
  .lt-subn .lt-row { row-gap: 4px; }
  .lt-band3 .lt-botsec, .lt-band3 .lt-mac { padding-top: 6px; padding-bottom: 4px; }
  .lt-bot .lt-tabs { margin-bottom: 2px; }
  .lt-mx-row { min-height: 23px; }
  .lt-mac .lt-perf { margin-bottom: 3px; padding-bottom: 3px; }
  .lt-macro .pk-dial { width: 34px; height: 34px; }
}
/* a phone (under 900 px): one section at a time, under a row of tabs; 44 px targets, 12 px text */
.pw-phone .lt { width: 100%; }
.pw-phone .lt-ptabs { position: sticky; top: 0; z-index: 25; display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 0; padding: 0 6px; background: var(--panel); border-bottom: var(--rule); scrollbar-width: none; }
.pw-phone .lt-ptabs .lt-tab { flex: 0 0 auto; min-width: 44px; height: 44px; padding: 0 10px; font-size: 13px; }
.pw-phone .lt-band { display: contents; }
.pw-phone .lt-sec { display: none; padding: 14px 16px; border: 0; }
.pw-phone .lt[data-tab="osca"] .lt-osc[data-sec="osca"], .pw-phone .lt[data-tab="oscb"] .lt-osc[data-sec="oscb"],
.pw-phone .lt[data-tab="filter"] .lt-flt, .pw-phone .lt[data-tab="env"] .lt-env, .pw-phone .lt[data-tab="lfo"] .lt-lfo,
.pw-phone .lt[data-tab="mod"] .lt-botsec, .pw-phone .lt[data-tab="mod"] .lt-mac, .pw-phone .lt[data-tab="fx"] .lt-botsec { display: block; }
.pw-phone .lt[data-tab="filter"] .lt-subn { display: flex; flex-wrap: wrap; gap: 14px 32px; }
.pw-phone .lt-bot-head { display: none; }
.pw-phone .lt .pk-seg > .pk-l, .pw-phone .lt .pk-sel > .pk-l, .pw-phone .lt .pk-seg > .pk-l .pk-l-t { font-size: 12px; }
.pw-phone .lt .lt-gly, .pw-phone .lt .pk-seg-b { min-width: 44px; }
.pw-phone .lt-mx-row.lt-empty { grid-template-areas: "n s to d x"; padding-bottom: 4px; }
.pw-phone .lt-mx-row.lt-empty > .pk-knob, .pw-phone .lt-mx-row.lt-empty > .lt-mx-amt { display: none; }
.pw-phone .lt-osc-grid { grid-template-columns: minmax(0, 1fr); row-gap: 12px; }
.pw-phone .lt-osc-r { grid-template-columns: auto auto; justify-content: start; align-items: center; gap: 10px 16px; }
.pw-phone .lt-osc-r .lt-uni { grid-column: 1 / -1; }
.pw-phone .lt-grid4, .pw-phone .lt-grid3 { grid-template-columns: repeat(2, minmax(0, auto)); justify-content: start; gap: 10px 22px; }
.pw-phone .lt-tv { height: auto; }
.pw-phone .lt-tv canvas { height: 200px; }
.pw-phone .lt-tv-meta { bottom: auto; top: 176px; }
.pw-phone .lt-uni canvas { width: 160px; height: 54px; }
.pw-phone .lt-fd { height: 150px; }
.pw-phone .lt-ed { height: 150px; }
.pw-phone .lt-ld { height: 130px; }
.pw-phone .lt-disp-t, .pw-phone .lt-cap, .pw-phone .lt-pick-w, .pw-phone .lt-mac-say, .pw-phone .lt-mx-n, .pw-phone .lt .lt-hk > .pk-l, .pw-phone .lt .lt-hk > .pk-v, .pw-phone .lt .lt-warpw > .pk-l, .pw-phone .lt-count { font-size: 12px; }
.pw-phone .lt-h { font-size: 13px; }
.pw-phone .lt .lt-pick { min-height: 44px; }
.pw-phone .lt-pick-n { font-size: 13px; }
.pw-phone .lt-vbtn, .pw-phone .lt .lt-warpw .pk-seg-b { min-width: 44px; height: 44px; font-size: 12px; }
.pw-phone .lt-tv-foot { position: static; display: block; padding: 6px 4px 4px; background: var(--pw-pc); }
.pw-phone .lt .lt-warpw { flex-wrap: wrap; }
.pw-phone .lt-tab { min-width: 44px; height: 44px; font-size: 13px; }
.pw-phone .lt-sock { width: 44px; height: 44px; margin-right: 0; }
.pw-phone .lt .lt-route, .pw-phone .lt-in .lt-route { height: 44px; min-width: 44px; font-size: 13px; }
.pw-phone .lt .pk-seg .pk-seg-b, .pw-phone .lt .pk-select { height: 44px; min-height: 44px; }
.pw-phone .lt-eh::before, .pw-phone .lt-ring-h::before { content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
.pw-phone .lt-mx { grid-template-columns: minmax(0, 1fr); grid-auto-flow: row; grid-template-rows: none; }
.pw-phone .lt-mx-row { grid-template-columns: 18px minmax(0, 1fr) 14px minmax(0, 1fr) 44px; grid-template-areas: "n s to d x" ". k k w w"; padding: 4px 0 8px; }
.pw-phone .lt-mx-row > .lt-mx-n { grid-area: n; } .pw-phone .lt-mx-row > .lt-mx-to { grid-area: to; }
.pw-phone .lt-mx-row > .lt-mx-x { grid-area: x; width: 44px; height: 44px; }
.pw-phone .lt-mx-row > .pk-knob { grid-area: k; justify-self: start; }
.pw-phone .lt-mx-row > .lt-mx-amt { grid-area: w; text-align: left; font-size: 12px; }
.pw-phone .lt .lt-mx-row .pk-select { height: 44px; font-size: 16px; }
.pw-phone .lt-macros { gap: 8px; }
.pw-phone .lt-perf-s { font-size: 12px; }
.pw-phone .lt-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pw-phone .lt[data-tab="mod"] .lt-mxs { display: block; }
.pw-phone .lt[data-tab="mod"] .lt-fx, .pw-phone .lt[data-tab="mod"] .lt-voice, .pw-phone .lt[data-tab="fx"] .lt-mxs { display: none; }
.pw-phone .lt[data-tab="fx"] .lt-fx, .pw-phone .lt[data-tab="fx"] .lt-voice { display: flex; flex-wrap: wrap; gap: 14px 28px; margin-bottom: 18px; }
@media (prefers-reduced-motion: reduce) { .lt-ring.lt-flash .lt-ring-arc, .lt-ring-h.lt-flash { animation-duration: .01s; } }
`;
