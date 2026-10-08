// The instrument platform: expression into kernels, presets on device defs, and core.guitar (DI Box).
//   1. Expression (kernel/expr.js, kernel/worklet.js's KernelCore): t.bend / t.mod / t.sustain reach a kernel's voices
//      and process; the channel's (instance.expr) lands on its frame; a note's own bend and mod (from note data) are
//      evaluated per block and added to the channel's; the host holds note-offs while the pedal is down; a kernel that
//      never reads them is bit-identical with or without them (every built-in instrument). Note data survives
//      normalising and notes.add; the Node render plays it (and a chased note starts its curve where it is).
//   2. MIDI in (input/midi.js): the bend wheel (14 bits times the range), RPN 0, the mod wheel (CC 1 + 33), the pedal
//      (CC 64) and CC 121 reach input.expr.
//   3. Presets (devices/registry.js): checked, filled in, clamped, by label; list_devices / get_device show them;
//      instrument.set with a preset's params is that sound; every new built-in has some, and each renders cleanly.
//   4. core.guitar: house level for every body, tuning, velocity colour, decay by register, the pick notch, the loss
//      filter keeping the top, palm mute, strum offsets to the sample, bends, release, CPU.
//   5. The browser (the AudioWorklet): the same expression through kernel/host.js renders like the Node renderer, and
//      the studio's engine and input take the wheels.
//
//   node tools/platform-test.js
import { open, tally } from './pw.js';
import { kernelCore, kernelCompiler } from '../app/src/kernel/worklet.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { noteExpr, normCurve, chanExpr } from '../app/src/kernel/expr.js';
import { kernelSpecs } from '../app/src/kernel/host.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject, cleanProject } from '../app/src/core/project.js';
import { normNote } from '../app/src/core/music.js';
import { createStore } from '../app/src/core/store.js';
import { measure } from '../app/src/audio/measure.js';
import { phrase, PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import * as registry from '../app/src/devices/registry.js';
import { INSTRUMENTS } from '../app/src/devices/builtin/index.js';
import { TOOLS } from '../app/src/agent/tools.js';

const t = tally('platform');
const SR = 48000,
  Q = 128,
  BEAT = 0.5;
const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------------ helpers: a KernelCore, a song */
const K = kernelCore(SR, makeDsp(SR), kernelCompiler);
function core(source, { kind = 'instrument', poly = 4, def = null, params = {} } = {}) {
  const posts = [];
  const specs = def ? kernelSpecs(def) : [];
  const values = def ? registry.paramValues(def, params) : {};
  const c = new K(
    { source, kind, params: specs, values, poly, seed: 7, transport: { bpm: 120, playing: true, beat: 0, time: 0 } },
    (m) => posts.push(m),
  );
  c.posts = posts;
  return c;
}
// run a core for `frames`, messages posted at their block (a block ahead, as the Node renderer posts them)
function run(c, frames, msgs = []) {
  const n = Math.ceil(frames / Q) * Q,
    L = new Float32Array(n),
    R = new Float32Array(n),
    bl = new Float32Array(Q),
    br = new Float32Array(Q);
  const q = msgs.slice().sort((a, b) => (a.time || 0) - (b.time || 0));
  let mi = 0;
  for (let f0 = 0; f0 < n; f0 += Q) {
    while (mi < q.length && Math.round((q[mi].time || 0) * SR) < f0 + 2 * Q) c.msg(q[mi++]);
    c.block(null, null, bl, br, f0);
    L.set(bl, f0);
    R.set(br, f0);
  }
  return { L, R };
}
const song = (device, notes, { params = {}, beats = 8, tempo = 120 } = {}) => ({
  ...createProject(),
  id: 'p_plat',
  title: 'platform',
  tempo,
  key: null,
  tracks: [
    {
      id: 't_plat',
      name: 'Inst',
      kind: 'instrument',
      instrument: { device, params },
      inserts: [],
      clips: [
        {
          id: 'c_plat',
          kind: 'notes',
          start: 0,
          length: beats,
          notes: notes.map((n, i) => ({ id: 'n' + (i + 1), v: 0.8, ...n })),
        },
      ],
      gain: 0,
      pan: 0,
      mute: false,
      solo: false,
    },
  ],
});
// notes in seconds -> the canonical render
function play(device, notes, params = {}, secs = 4, tail = 0.5, from = 0) {
  const beats = Math.ceil(secs / BEAT);
  const t0 = performance.now();
  const r = renderSong(
    song(
      device,
      notes.map((n) => ({ ...n, t: n.t / BEAT, d: n.d / BEAT })),
      { params, beats },
    ),
    { from, to: beats, tail },
  );
  r.ms = performance.now() - t0;
  return r;
}
function goertzel(x, a, len, f) {
  const w = (2 * Math.PI * f) / SR,
    c = 2 * Math.cos(w);
  let s1 = 0,
    s2 = 0;
  for (let i = 0; i < len; i++) {
    const s = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1))) + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) * 4) / len;
}
function peakFreq(x, a, len, f, span = 0.03) {
  let best = 0,
    bf = f;
  for (let k = -80; k <= 80; k++) {
    const ff = f * (1 + (span * k) / 80),
      m = goertzel(x, a, len, ff);
    if (m > best) {
      best = m;
      bf = ff;
    }
  }
  const step = (f * span) / 80;
  for (let k = -20; k <= 20; k++) {
    const ff = bf + (step * k) / 20,
      m = goertzel(x, a, len, ff);
    if (m > best) {
      best = m;
      bf = ff;
    }
  }
  return bf;
}
const cents = (f, ref) => 1200 * Math.log2(f / ref);
function rms(x, a, b) {
  let s = 0;
  const i0 = Math.round(a * SR),
    i1 = Math.round(b * SR);
  for (let i = i0; i < i1; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, i1 - i0));
}
function t60(x, frame = 0.01) {
  const fl = Math.round(frame * SR),
    env = [];
  for (let a = 0; a + fl <= x.length; a += fl) {
    let s = 0;
    for (let i = a; i < a + fl; i++) s += x[i] * x[i];
    env.push(10 * Math.log10(s / fl + 1e-24));
  }
  const pk = Math.max(...env),
    i6 = env.findIndex((e) => e < pk - 6),
    i36 = env.findIndex((e) => e < pk - 36);
  return i6 >= 0 && i36 > i6 ? (i36 - i6) * frame * 2 : Infinity;
}
const slice = (r, a, b) => ({
  sr: r.sr,
  channels: r.channels.map((x) => x.subarray(Math.round(a * r.sr), Math.round(b * r.sr))),
});

/* ------------------------------------------------------------------ 1. expression */
console.log('expression: the kernel core');
{
  // a probe: each voice adds its t.bend to L and t.mod to R; process adds 1000 x the channel's sustain to R
  const probe = (poly) => `({ poly: ${poly}, create() { return {
    voice() { let rel = false; return {
      start() { rel = false; }, release() { rel = true; },
      render(L, R, n, p, t) { if (rel) return false; for (let i = 0; i < n; i++) { L[i] += t.bend; R[i] += t.mod; } return true; },
    }; },
    process(L, R, n, p, t) { if (t.sustain) for (let i = 0; i < n; i++) R[i] += 1000; },
  }; } })`;
  const PROBE = probe(4);
  // a note's own curve: 0 -> 2 semitones over 10 ms, mod 0.25 throughout
  let c = core(PROBE);
  let o = run(c, 2048, [{ type: 'on', p: 60, v: 0.8, time: 0, x: { bend: [0, 0, 0.01, 2], mod: 0.25 } }]);
  const want = (f) => 2 * Math.min(1, f / 480);
  const atBlocks = [0, 128, 256, 384, 512, 1024].map((f) => [o.L[f], want(f)]);
  t.ok(
    atBlocks.every(([g, w]) => near(g, w, 1e-6)),
    `a note's bend curve is evaluated at each block start: ${atBlocks.map(([g]) => fmt(g, 3)).join(' ')} st (want ${atBlocks.map(([, w]) => fmt(w, 3)).join(' ')})`,
  );
  t.ok(
    near(o.R[700], 0.25, 1e-7) && o.L[127] === o.L[0],
    `t.mod is the note's 0.25; t stays put inside a block (${fmt(o.R[700], 3)})`,
  );
  // the channel adds, from its frame (the block is split there), and process sees the channel's alone
  c = core(PROBE);
  o = run(c, 2048, [
    { type: 'on', p: 60, v: 0.8, time: 0, x: { bend: 1 } },
    { type: 'expr', bend: -3, mod: 0.5, time: 300 / SR },
  ]);
  t.ok(
    o.L[299] === 1 && o.L[300] === -2 && near(o.R[300], 0.5, 1e-7) && o.R[299] === 0,
    `instance.expr lands on its frame: bend ${o.L[299]} -> ${o.L[300]} st (channel -3 plus the note's +1), mod ${o.R[299]} -> ${fmt(o.R[300], 2)} at frame 300`,
  );
  c = core(PROBE);
  o = run(c, 1024, [
    { type: 'on', p: 60, v: 0.8, time: 0, x: { mod: 0.8 } },
    { type: 'expr', mod: 0.5, time: 0 },
  ]);
  t.ok(near(o.R[10], 1, 1e-7), `t.mod is the channel's plus the note's, clamped to 1 (${fmt(o.R[10], 3)})`);
  t.ok(
    chanExpr({ bend: 99, mod: -1, sustain: 1 }).bend === 48 &&
      chanExpr({ mod: -1 }).mod === 0 &&
      chanExpr({ sustain: 1 }).sustain === true,
    'channel values are clamped: bend +-48 st, mod 0..1, sustain a boolean',
  );
  // the pedal: a note-off while it is down is held until it lifts; process sees t.sustain
  c = core(PROBE);
  o = run(c, 4096, [
    { type: 'on', p: 60, v: 0.8, time: 0, x: { bend: 1 } },
    { type: 'expr', sustain: true, time: 300 / SR },
    { type: 'off', p: 60, time: 500 / SR },
    { type: 'expr', sustain: false, time: 2000 / SR },
  ]);
  // (process runs once a block, after its events: it sees the pedal from the block it went down in)
  t.ok(
    o.R[255] === 0 && o.R[256] === 1000 && o.L[1999] === 1 && o.L[2000] === 0 && o.R[2100] === 0,
    `sustain: the note-off at frame 500 waits for the pedal; it lifts at 2000 and the note goes there (voice ${o.L[1999]} -> ${o.L[2000]}; process saw t.sustain from the block holding frame 300)`,
  );
  c = core(probe(2));
  o = run(c, 4096, [
    { type: 'on', p: 60, v: 0.8, time: 0, x: { bend: 1 } },
    { type: 'on', p: 62, v: 0.8, time: 0, x: { bend: 2 } },
    { type: 'expr', sustain: true, time: 0 },
    { type: 'off', p: 60, time: 256 / SR },
    { type: 'on', p: 64, v: 0.8, time: 512 / SR, x: { bend: 4 } },
  ]);
  // poly 2: the third note steals; the pedal-held note (60, bend 1) goes before the key still down (62, bend 2)
  t.ok(
    o.L[400] === 3 && o.L[2000] === 6,
    `a pedal-held voice is stolen before a held key: ${o.L[400]} -> ${o.L[2000]} (62 and 64 left, 60 stolen)`,
  );
  c = core(PROBE);
  o = run(c, 2048, [
    { type: 'on', p: 60, v: 0.8, time: 0 },
    { type: 'expr', sustain: true, time: 0 },
    { type: 'alloff', time: 256 / SR },
  ]);
  t.ok(
    o.R[300] === 1000 && o.L[300] === 0 && c.cur.voices.every((s) => !s.alive),
    'all-off releases every voice, the pedal-held ones too',
  );
  // a kernel that never heard of it: t has the fields, at rest
  c = core(
    `({ create() { return { voice() { return { start() {}, release() {}, render(L, R, n, p, t) { L[0] += (t.bend === 0 && t.mod === 0 && t.sustain === false) ? 1 : -1; return false; } }; } }; } })`,
  );
  o = run(c, 256, [{ type: 'on', p: 60, v: 0.8, time: 0 }]);
  t.ok(o.L[0] === 1, 't = { bpm, playing, beat, bend: 0, mod: 0, sustain: false } when nobody moves a wheel');
  t.ok(!c.posts.some((m) => m.type === 'error'), 'no errors from the probes');
}

console.log('expression: existing instruments are bit-identical with the wheels at rest');
{
  const ph = phrase()
    .slice(0, 40)
    .map((n) => ({ ...n, t: n.t * BEAT, d: n.d * BEAT }));
  const frames = Math.round((ph.reduce((m, n) => Math.max(m, n.t + n.d), 0) + 0.5) * SR);
  const bad = [];
  for (const def of INSTRUMENTS) {
    const notes = [];
    for (const n of ph) {
      notes.push({ type: 'on', p: n.p, v: n.v, time: n.t });
      notes.push({ type: 'off', p: n.p, time: n.t + n.d });
    }
    const a = run(core(def.kernel, { def, poly: def.poly }), frames, notes);
    // the same with the wheels sent home over and over, and a zero curve on every note
    const b = run(core(def.kernel, { def, poly: def.poly }), frames, [
      ...notes.map((m) => (m.type === 'on' ? { ...m, x: { bend: 0, mod: 0 } } : m)),
      ...Array.from({ length: 20 }, (_, k) => ({ type: 'expr', bend: 0, mod: 0, time: (k * 139 * Q) / SR })),
    ]); // (on block starts: notes split blocks, and so does a wheel; a kernel that does its work once a block may move by a hair there, so this checks the values alone)
    let same = true;
    for (let i = 0; i < a.L.length && same; i++) if (a.L[i] !== b.L[i] || a.R[i] !== b.R[i]) same = false;
    if (!same) bad.push(def.id);
  }
  t.ok(
    !bad.length,
    `${INSTRUMENTS.length} built-in instruments render the same samples with bend 0 and mod 0 posted as without${bad.length ? ': differs: ' + bad.join(', ') : ''}`,
  );
}

console.log('expression: note data');
{
  t.ok(
    normCurve(0, -48, 48) === undefined && normCurve(2.123456, -48, 48) === 2.1235 && normCurve(60, -48, 48) === 48,
    'a constant bend: 0 is stored as nothing, values rounded and clamped',
  );
  const c = normCurve(
    [
      [1, 2],
      [0, 0],
      ['x', 1],
      [0.5, 9],
    ],
    -2,
    2,
  );
  t.ok(JSON.stringify(c) === '[[0,0],[0.5,2],[1,2]]', `a curve is sorted, clamped and cleaned: ${JSON.stringify(c)}`);
  t.ok(
    normCurve(
      [
        [0, 0],
        [1, 0],
      ],
      -48,
      48,
    ) === undefined,
    'a curve that never leaves 0 is stored as nothing',
  );
  const n = normNote({
    p: 'E4',
    t: 0,
    d: 1,
    bend: [
      [0, 0],
      [0.5, 1],
    ],
    mod: 0.3,
  });
  t.ok(
    JSON.stringify(n.bend) === '[[0,0],[0.5,1]]' && n.mod === 0.3,
    `normNote keeps bend and mod: ${JSON.stringify({ bend: n.bend, mod: n.mod })}`,
  );
  t.ok(!('bend' in normNote({ p: 60, t: 0, bend: 0 })), 'a note without expression stays as it was (no new fields)');
  const x = noteExpr(
    {
      bend: [
        [0, 0],
        [1, 2],
      ],
      mod: 0.5,
    },
    0.5,
  );
  t.ok(
    JSON.stringify(x) === '{"bend":[0,0,0.5,2],"mod":0.5}',
    `noteExpr: beats to seconds at 120 BPM ${JSON.stringify(x)}`,
  );
  const xc = noteExpr(
    {
      bend: [
        [0, 0],
        [1, 2],
      ],
    },
    0.5,
    0.5,
  );
  t.ok(
    JSON.stringify(xc.bend) === '[-0.25,0,0.25,2]',
    `a chased note's curve starts where the note is: ${JSON.stringify(xc.bend)}`,
  );
  t.ok(noteExpr({ p: 60 }, 0.5) === null, 'a plain note sends no expression');
  // through the store: notes.add keeps it, undo removes it
  const store = createStore(cleanProject(song('core.guitar', [], { beats: 4 })), { getDevice: registry.getDevice });
  const r = store.dispatch(
    {
      type: 'notes.add',
      track: 't_plat',
      clip: 'c_plat',
      notes: [
        {
          p: 57,
          t: 0,
          d: 2,
          bend: [
            [0, 0],
            [1, 2],
          ],
          mod: 0.2,
        },
      ],
    },
    { by: 'claude' },
  );
  const got = store.get().tracks[0].clips[0].notes[0];
  t.ok(
    r.ok && JSON.stringify(got.bend) === '[[0,0],[1,2]]' && got.mod === 0.2,
    `notes.add (an agent's) keeps a note's bend and mod: ${JSON.stringify({ bend: got.bend, mod: got.mod })}`,
  );
  // the Node render plays it: a held bend to +2 lands on B3 from A3; mod 1 makes vibrato
  const bent = play(
    'core.guitar',
    [
      {
        p: 57,
        t: 0,
        d: 2,
        bend: [
          [0, 0],
          [0.5, 2],
        ],
      },
    ],
    {},
    2,
    0,
  );
  const f = peakFreq(bent.channels[0], Math.round(0.6 * SR), 16384, mtof(59));
  t.ok(
    near(cents(f, mtof(59)), 0, 3),
    `the canonical render bends: A3 with a bend curve to +2 sounds at B3 ${fmt(cents(f, mtof(59)), 2)} cents after it`,
  );
  const pb = play('core.poly', [{ p: 57, t: 0, d: 2, bend: -12 }], {}, 2, 0);
  const fp = peakFreq(pb.channels[0], Math.round(0.4 * SR), 16384, mtof(45));
  t.ok(
    near(cents(fp, mtof(45)), 0, 8),
    `core.poly follows a note's bend: A3 bent -12 sounds at A2 (${fmt(cents(fp, mtof(45)), 1)} cents, its oscillators drift a little)`,
  );
  // chased from mid-note: the curve is where the note is, not at its start
  const whole = play(
    'core.guitar',
    [
      {
        p: 57,
        t: 0,
        d: 3,
        bend: [
          [0, 0],
          [2, 4],
        ],
      },
    ],
    {},
    3,
    0,
  );
  const chased = play(
    'core.guitar',
    [
      {
        p: 57,
        t: 0,
        d: 3,
        bend: [
          [0, 0],
          [2, 4],
        ],
      },
    ],
    {},
    3,
    0,
    4,
  ); // from beat 4 (2 s): bend 4 already
  const fw = peakFreq(whole.channels[0], Math.round(2.05 * SR), 8192, mtof(61)),
    fc = peakFreq(chased.channels[0], Math.round(0.05 * SR), 8192, mtof(61));
  t.ok(
    near(cents(fw, mtof(61)), 0, 5) && near(cents(fc, mtof(61)), 0, 5),
    `a render from mid-note starts the bend where it is: ${fmt(cents(fc, mtof(61)), 1)} cents from C#4 (the whole render: ${fmt(cents(fw, mtof(61)), 1)})`,
  );
}

/* ------------------------------------------------------------------ 2. MIDI */
console.log('MIDI: wheels and the pedal');
{
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  if (typeof globalThis.document === 'undefined') globalThis.document = { hidden: false, addEventListener() {} };
  const { createMidi } = await import('../app/src/input/midi.js');
  const got = [],
    notes = [];
  const input = {
    emit() {},
    noteOn: (src, p, v) => notes.push(['on', p, v]),
    noteOff: (src, p) => notes.push(['off', p]),
    expr: (src, x) => got.push(x),
  };
  const midi = createMidi({ ui: {} }, input);
  midi.message([0xe0, 0x00, 0x40]); // centre
  midi.message([0xe0, 0x7f, 0x7f]); // full up
  midi.message([0xe0, 0x00, 0x00]); // full down
  t.ok(
    got[0].bend === 0 && got[1].bend === 2 && got[2].bend === -2 && midi.state.bendRange === 2,
    `the bend wheel: centre 0, full up +${got[1].bend}, full down ${got[2].bend} st (range ${midi.state.bendRange})`,
  );
  midi.message([0xb0, 101, 0]);
  midi.message([0xb0, 100, 0]);
  midi.message([0xb0, 6, 12]);
  t.ok(
    midi.state.bendRange === 12 && got[got.length - 1].bend === -12,
    `RPN 0 sets the bend range to 12, and the held bend follows (${got[got.length - 1].bend})`,
  );
  midi.setBendRange(7);
  t.ok(
    midi.state.bendRange === 7 && JSON.parse(mem.get('overdub:midi')).bendRange === 7,
    'midi.setBendRange(7) is kept for next time',
  );
  got.length = 0;
  midi.message([0xb0, 1, 64]);
  midi.message([0xb0, 33, 127]);
  t.ok(
    near(got[0].mod, (64 * 128) / 16383, 1e-3) && near(got[1].mod, (64 * 128 + 127) / 16383, 1e-3),
    `the mod wheel: CC 1 ${fmt(got[0].mod, 3)}, with CC 33's fine bits ${fmt(got[1].mod, 4)}`,
  );
  got.length = 0;
  notes.length = 0;
  midi.message([0x90, 60, 100]);
  midi.message([0xb0, 64, 127]);
  midi.message([0x80, 60, 0]);
  const heldOk = got.length === 1 && got[0].sustain === true && !notes.some((n) => n[0] === 'off');
  midi.message([0xb0, 64, 0]);
  t.ok(
    heldOk && got[1].sustain === false && notes[notes.length - 1][0] === 'off',
    `the pedal reaches the instrument (sustain ${got[0] && got[0].sustain} then ${got[1] && got[1].sustain}) and still holds the key until it lifts`,
  );
  got.length = 0;
  midi.message([0xe0, 0x7f, 0x7f]);
  midi.message([0xb0, 121, 0]);
  const last = got[got.length - 1];
  t.ok(
    last.bend === 0 && last.mod === 0 && midi.state.bend === 0 && midi.state.mod === 0,
    'CC 121 puts the wheels back to rest',
  );
}

/* ------------------------------------------------------------------ 3. presets */
console.log('presets');
{
  const P = (presets) =>
    registry.normPresets('you.test', presets, [
      { key: 'tone', min: 0, max: 1, def: 0.5, step: 0 },
      { key: 'mode', opts: ['A', 'B', 'C'], min: 0, max: 2, def: 0, step: 1 },
      { key: 'n', min: 1, max: 9, def: 3, step: 2 },
    ]);
  const p = P([{ name: '  Dark  room ', params: { tone: -4, mode: 'c', n: 6 } }]);
  t.ok(
    JSON.stringify(p) === '[{"name":"Dark room","params":{"tone":0,"mode":2,"n":7}}]',
    `a preset is filled in, clamped, snapped, and a switch is named by its label: ${JSON.stringify(p)}`,
  );
  const throws = (x, re) => {
    try {
      P(x);
      return false;
    } catch (e) {
      return re.test(e.message);
    }
  };
  t.ok(
    throws([{ name: 'X', params: { cutoff: 1 } }], /sets "cutoff", which is not a param/),
    'a preset that sets an unknown param is refused, naming it',
  );
  t.ok(
    throws(
      [
        { name: 'X', params: {} },
        { name: 'x', params: {} },
      ],
      /two presets are called/,
    ),
    'two presets of one name (any case) are refused',
  );
  t.ok(
    throws([{ name: 'X', params: { mode: 'Z' } }], /one of A, B, C/) &&
      throws([{ name: '', params: {} }], /needs a name/),
    'a bad switch label and a missing name are refused with what to do',
  );
  t.ok(
    registry.normPresets('x', undefined, []).length === 0 && registry.getDevice('core.poly').presets.length === 0,
    'a device without presets has none (older defs need no change)',
  );
  const g = registry.getDevice('core.guitar');
  t.ok(
    registry.presetParams(g, 'nylon').body === 1 && registry.presetParams('core.guitar', 'Nope') === null,
    'presetParams finds one by name in any case',
  );
  const NEW = ['core.piano', 'core.organ', 'core.strings', 'core.bassguitar', 'core.guitar'];
  const counts = NEW.map((id) => [id, (registry.getDevice(id)?.presets || []).length]);
  t.ok(
    counts.every(([, n]) => n >= 2),
    `the new built-ins carry presets: ${counts.map(([id, n]) => `${id} ${n}`).join(', ')}`,
  );
  // agents see them
  const app = { devices: registry, store: null };
  const list = TOOLS.find((x) => x.name === 'list_devices').run({ query: 'DI Box' }, { app });
  const one = TOOLS.find((x) => x.name === 'get_device').run({ id: 'core.guitar' }, { app });
  t.ok(
    /presets: Clean single-coil, Crunch rhythm, Nylon, Dreadnought, Funk muted/.test(list.devices),
    'list_devices names the presets',
  );
  t.ok(
    one.presets &&
      one.presets.length === g.presets.length &&
      Object.keys(one.presets[2].params).length === g.params.length &&
      /instrument\.set/.test(one.preset_hint),
    `get_device gives each preset's whole params and how to apply it (${one.presets && one.presets.map((x) => x.name).join(', ')})`,
  );
  // instrument.set with a preset's params is that sound
  const store = createStore(
    cleanProject(song('core.guitar', [{ p: 52, t: 0, d: 1 }], { beats: 4, params: { tone: 0.1, strum: 30 } })),
    { getDevice: registry.getDevice },
  );
  const r = store.dispatch(
    { type: 'instrument.set', track: 't_plat', params: one.presets[2].params },
    { by: 'claude' },
  );
  const sorted = (o) =>
    JSON.stringify(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    );
  t.ok(
    r.ok && sorted(store.get().tracks[0].instrument.params) === sorted(registry.presetParams(g, 'Nylon')),
    'instrument.set { params: <preset> } sets the whole sound (the earlier tweaks are replaced)',
  );
  // each preset of each new built-in renders clean
  const ph = phrase().map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT }));
  const rows = [];
  for (const id of NEW)
    for (const pr of registry.getDevice(id).presets) {
      const m = measure(
        play(
          id,
          id === 'core.bassguitar' ? ph.map((n) => ({ ...n, p: n.p - 24 })) : ph,
          pr.params,
          PHRASE_BEATS * BEAT,
          2,
        ),
      );
      rows.push([id, pr.name, m.lufs, m.truePeak]);
    }
  const off = rows.filter(([, , l, tp]) => !(l >= -28 && l <= -11) || tp > -1 || !Number.isFinite(l));
  t.ok(
    !off.length,
    `every preset of the new built-ins renders the test phrase between -28 and -11 LUFS (a palm-muted one is quieter on long notes) with true peaks at or under -1 dBTP (${rows.length} presets${off.length ? '; off: ' + off.map((r) => `${r[0]} ${r[1]} ${r[2]} LUFS ${r[3]} dBTP`).join(', ') : ''})`,
  );
  t.note(rows.map((r) => `${r[0]} "${r[1]}" ${r[2]} LUFS ${r[3]} dBTP`).join(' | '));
}

/* ------------------------------------------------------------------ 4. core.guitar */
console.log('core.guitar: DI Box');
{
  const ID = 'core.guitar';
  const g = registry.getDevice(ID);
  t.ok(
    g && g.kind === 'instrument' && g.params.length === 7 && INSTRUMENTS.includes(g),
    `registered: ${g && g.name}, ${g && g.params.length} params (${g && g.params.map((p) => p.key).join(' ')})`,
  );
  const ph = phrase().map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT }));
  for (const [body, name, vr] of [
    [0, 'ELECTRIC', 1.3],
    [1, 'NYLON', 1.15],
    [2, 'STEEL', 1.3],
  ]) {
    const a = play(ID, ph, { body }, PHRASE_BEATS * BEAT, 2),
      b = play(ID, ph, { body }, PHRASE_BEATS * BEAT, 2);
    const m = measure({ sr: a.sr, channels: a.channels });
    let same = true;
    for (let i = 0; i < a.channels[0].length && same; i++) if (a.channels[0][i] !== b.channels[0][i]) same = false;
    t.ok(
      m.lufs >= -18.5 && m.lufs <= -13.5 && m.truePeak <= -1 && same,
      `${name}: the test phrase at ${m.lufs} LUFS, ${m.truePeak} dBTP (house: -18.5..-13.5, <= -1), bit-identical twice`,
    );
    const tune = [40, 52, 64, 76, 88].map((p) => {
      const x = play(ID, [{ p, v: 0.8, t: 0, d: 1.5 }], { body }, 1.6, 0).channels[0];
      return cents(peakFreq(x, Math.round(0.3 * SR), 16384, mtof(p), 0.02), mtof(p));
    });
    t.ok(
      tune.every((c) => Math.abs(c) <= 2),
      `${name}: in tune within 2 cents from E2 to E6 (${tune.map((c) => fmt(c, 2)).join(' ')})`,
    );
    const cent = [0.3, 0.6, 1].map(
      (v) => measure(slice(play(ID, [{ p: 64, v, t: 0, d: 1.5 }], { body }, 2, 0.2), 0, 0.5)).centroid,
    );
    t.ok(
      cent[1] > cent[0] && cent[2] > cent[1] && cent[2] >= vr * cent[0],
      `${name}: harder is brighter: centroid ${cent.map(Math.round).join(' / ')} Hz at velocity 0.3 / 0.6 / 1 (x${fmt(cent[2] / cent[0], 2)}, want x${vr})`,
    );
    const d = [40, 64, 76].map((p) => t60(play(ID, [{ p, v: 0.8, t: 0, d: 8 }], { body }, 8, 0).channels[0], 0.02));
    t.ok(
      d[0] > d[1] && d[1] > d[2] && d[2] > 0.5,
      `${name}: low strings ring longest: T60 ${d.map((x) => fmt(x, 2)).join(' / ')} s at E2 / E4 / E5`,
    );
  }
  // the pick notch: struck a fifth of the way along (STEEL, no pickup comb), the 5th harmonic goes missing
  const pick = (0.2 - 0.06) / 0.24;
  const pn = play(ID, [{ p: 45, v: 0.8, t: 0, d: 1 }], { body: 2, pick }, 1, 0).channels[0];
  const h = [4, 5, 6].map((k) => dB(goertzel(pn, 2400, 8192, mtof(45) * k)));
  t.ok(
    h[1] < h[0] - 12 && h[1] < h[2] - 1,
    `the pick notch: plucked at 1/5, harmonic 5 is ${fmt(h[1])} dB against ${fmt(h[0])} and ${fmt(h[2])} for 4 and 6`,
  );
  // the loss filter keeps the top on high strings: STEEL, TONE 1, E5: partials up to the 10th within 40 dB
  const hi = play(ID, [{ p: 76, v: 1, t: 0, d: 1 }], { body: 2, tone: 1 }, 1, 0).channels[0];
  const hs = Array.from({ length: 10 }, (_, k) => dB(goertzel(hi, 0, 4096, mtof(76) * (k + 1))));
  t.ok(
    hs.every((x) => x > hs[0] - 40),
    `a high string stays bright: E5's partials 1-10 within 40 dB of the fundamental (${hs.map((x) => fmt(x - hs[0], 0)).join(' ')})`,
  );
  // palm mute
  const pm = t60(play(ID, [{ p: 45, v: 0.8, t: 0, d: 2 }], { mute: 2 }, 2, 0).channels[0]);
  const soft = t60(play(ID, [{ p: 45, v: 0.3, t: 0, d: 2 }], { mute: 1 }, 2, 0).channels[0]),
    hard = t60(play(ID, [{ p: 45, v: 0.8, t: 0, d: 2 }], { mute: 1 }, 2, 0).channels[0]);
  t.ok(
    pm < 0.3 && soft < 0.3 && hard > 1,
    `palm mute: T60 ${fmt(pm, 3)} s (ALL); SOFT mutes a soft note (${fmt(soft, 3)} s) and lets a hard one ring (${fmt(hard, 2)} s)`,
  );
  // strum: each string STRUM after the last, down then up, found by changing one note's velocity (the rest of the
  // render is the same up to the sample where that string starts)
  for (const strum of [20, 7.3]) {
    const chord = (j, k) =>
      [0, 1.2].flatMap((t0, c) => [40, 52, 64].map((p, i) => ({ p, v: c === k && i === j ? 0.5 : 0.8, t: t0, d: 1 })));
    const base = play(ID, chord(-1, -1), { strum }, 3, 0).channels[0];
    const at = (j, k) => {
      const y = play(ID, chord(j, k), { strum }, 3, 0).channels[0];
      for (let i = 0; i < y.length; i++) if (y[i] !== base[i]) return i - (k ? Math.round(1.2 * SR) : 0);
      return -1;
    };
    const down = [0, 1, 2].map((j) => at(j, 0)),
      up = [0, 1, 2].map((j) => at(j, 1));
    const s = (strum * SR) / 1000;
    t.ok(
      down.every((x, i) => Math.abs(x - i * s) <= 1) && up.every((x, i) => Math.abs(x - (2 - i) * s) <= 1),
      `STRUM ${strum} ms: the down strum starts E2 E3 E4 at ${down.join(' / ')} samples, the next chord up at ${up.join(' / ')} (want ${fmt(s, 1)} apart, within a sample)`,
    );
  }
  // the wheels: the channel's bend through a KernelCore (as the live MIDI wheel sends it), and vibrato from mod
  {
    const c = core(g.kernel, { def: g, poly: 10 });
    const o = run(c, Math.round(1.6 * SR), [
      { type: 'on', p: 57, v: 0.8, time: 0 },
      { type: 'expr', bend: -2, time: 0.2 },
    ]);
    const fb = peakFreq(o.L, Math.round(0.5 * SR), 16384, mtof(55), 0.02);
    t.ok(
      near(cents(fb, mtof(55)), 0, 3),
      `the bend wheel bends the string: A3 with the wheel at -2 sounds at G3 (${fmt(cents(fb, mtof(55)), 2)} cents)`,
    );
    const vib = play(ID, [{ p: 69, v: 0.8, t: 0, d: 2, mod: 1 }], {}, 2, 0).channels[0];
    const tr = [];
    for (let k = 0; k < 8; k++) tr.push(cents(peakFreq(vib, Math.round((0.3 + k * 0.024) * SR), 2048, 440, 0.06), 440));
    const sw = Math.max(...tr) - Math.min(...tr);
    t.ok(
      sw > 25 && sw < 110,
      `the mod wheel adds finger vibrato: the pitch swings ${fmt(sw, 0)} cents over 0.2 s at mod 1`,
    );
  }
  const rr = play(ID, [{ p: 64, v: 0.8, t: 0, d: 1 }], {}, 3, 0.5);
  const drop = dB(rms(rr.channels[0], 0.8, 0.98)) - dB(rms(rr.channels[0], 1.6, 1.8));
  t.ok(drop >= 40, `let go and the string is damped: ${fmt(drop)} dB down 0.6 s after release`);
  // CPU: 16 strings held, against core.keys (GRAND) as the reference, as tools/instruments-test.js does
  const sixteen = Array.from({ length: 16 }, (_, k) => ({ p: 40 + k * 2, v: 0.8, t: 0, d: 4 }));
  const time = (id, params) => {
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
      const r = play(id, sixteen, params, 4, 0);
      best = Math.min(best, (r.ms / ((r.length / r.sr) * 1000)) * 100);
    }
    return best;
  };
  const ref = time('core.keys', { voice: 1 }),
    me = time(ID, {}),
    budget = 6 * Math.max(1, ref / 3.3);
  t.ok(
    me <= budget,
    `16 strings ringing for 4 s render at ${fmt(me, 2)}% of real time (budget ${fmt(budget, 1)}%: 6% when the reference takes 3.3%; it took ${fmt(ref, 2)}%)`,
  );
}

/* ------------------------------------------------------------------ 5. the browser */
console.log('the browser: the AudioWorklet and the studio');
{
  const { page, close, errors } = await open('/app/');
  try {
    await page.waitForFunction(() => window.overdub && window.overdub.engine && window.overdub.input, null, {
      timeout: 20000,
    });
    const r = await page.evaluate(async () => {
      const { getDevice } = await import('/app/src/devices/registry.js');
      const { kernelInstance, ensureKernelWorklet } = await import('/app/src/kernel/host.js');
      const def = getDevice('core.guitar');
      const SR = 48000,
        c = new OfflineAudioContext(2, SR * 2, SR);
      await ensureKernelWorklet(c);
      const inst = await kernelInstance(c, def, { seed: 99, bpm: 120 });
      await inst.ready;
      inst.output.connect(c.destination);
      inst.noteOn(57, 0.8, 0.1, { bend: [0, 0, 0.3, 2], mod: 0.2 });
      inst.noteOn(64, 0.8, 0.1);
      inst.expr({ bend: -1 }, 0.6);
      inst.expr({ sustain: true }, 0.7);
      inst.noteOff(57, 0.8);
      inst.noteOff(64, 0.8);
      inst.expr({ sustain: false }, 1.4);
      const b = await c.startRendering();
      inst.dispose();
      const app = window.overdub;
      return {
        L: Array.from(b.getChannelData(0)),
        hasLive: typeof app.engine.liveExpr === 'function',
        hasInput: typeof app.input.expr === 'function',
      };
    });
    // the same in the Node core (the canonical render's code)
    const def = registry.getDevice('core.guitar');
    const K2 = new K(
      {
        source: def.kernel,
        kind: 'instrument',
        params: kernelSpecs(def),
        values: registry.paramValues(def, {}),
        seed: 99,
        transport: { bpm: 120, playing: true, beat: 0, time: 0 },
      },
      () => {},
    );
    const o = run(K2, SR * 2, [
      { type: 'on', p: 57, v: 0.8, time: 0.1, x: { bend: [0, 0, 0.3, 2], mod: 0.2 } },
      { type: 'on', p: 64, v: 0.8, time: 0.1 },
      { type: 'expr', bend: -1, time: 0.6 },
      { type: 'expr', sustain: true, time: 0.7 },
      { type: 'off', p: 57, time: 0.8 },
      { type: 'off', p: 64, time: 0.8 },
      { type: 'expr', sustain: false, time: 1.4 },
    ]);
    let worst = 0,
      pk = 0;
    for (let i = 0; i < r.L.length; i++) {
      worst = Math.max(worst, Math.abs(r.L[i] - o.L[i]));
      pk = Math.max(pk, Math.abs(r.L[i]));
    }
    const held = rms(Float32Array.from(r.L), 1.2, 1.35),
      after = rms(Float32Array.from(r.L), 1.8, 1.95);
    t.ok(
      pk > 0.05 && dB(worst) <= -90,
      `the AudioWorklet plays a note's bend curve, the channel's bend and the pedal like the Node renderer: they differ by at most ${worst ? fmt(dB(worst)) : '-inf'} dBFS (peak ${fmt(dB(pk))} dBFS)`,
    );
    t.ok(
      dB(held) - dB(after) > 30,
      `the pedal held the strings past their key-up (${fmt(dB(held))} dBFS at 1.2 s) and lifting it damped them (${fmt(dB(after))} dBFS at 1.8 s)`,
    );
    t.ok(r.hasLive && r.hasInput, 'the studio has engine.liveExpr and input.expr for the wheels');
    // the wheels in the studio: a MIDI bend reaches the selected track's live instrument
    const live = await page.evaluate(async () => {
      const app = window.overdub;
      const track = app.input.target();
      if (!track) return { skipped: 'no instrument track' };
      await app.engine.start?.();
      const seen = [];
      const strips = app.engine.liveInstance ? null : null;
      // watch what reaches the instrument instance
      const orig = app.engine.liveExpr;
      app.engine.liveExpr = (id, x) => {
        seen.push({ id, x });
        return orig(id, x);
      };
      app.input.midi.message([0xe0, 0x7f, 0x7f], 'test');
      app.input.midi.message([0xb0, 1, 127], 'test');
      app.input.midi.message([0xb0, 121, 0], 'test');
      app.engine.liveExpr = orig;
      return { track: track.id, seen };
    });
    t.ok(
      live.skipped ||
        (live.seen.length >= 3 &&
          live.seen.every((s) => s.id === live.track) &&
          live.seen[0].x.bend > 0 &&
          live.seen[1].x.mod > 0.99 &&
          live.seen[live.seen.length - 1].x.bend === 0),
      `a MIDI keyboard's wheels reach the target track's instrument: ${live.skipped || live.seen.map((s) => JSON.stringify(s.x)).join(' ')}`,
    );
    const mine = errors.filter((e) => /kernel\/|input\/midi|devices\/builtin\/guitar|registry/.test(e));
    t.ok(!mine.length, `no page errors from the platform${mine.length ? ': ' + mine.join(' | ') : ''}`);
  } finally {
    await close();
  }
}
t.done();
