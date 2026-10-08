// The engine's cost: 16 tracks with heavy chains at 48 kHz in real-time Chromium, measured the way clawd-o-matic's
// perf-check does it. For each scene it prints:
//   - each kind of kernel's share of the audio thread (timed inside the worklet scope by Date.now, which averages
//     right over thousands of calls), and how many are processing
//   - the audio thread's headroom: a probe worklet burns more and more time each render quantum until the audio clock
//     falls behind the wall clock; load = what is left unburnable (±10% on a busy machine)
//   - the main thread: script and task time a second (Chrome's Performance metrics) and the meters' rate
//   - the audio clock against the wall clock
// Scenes (SCENES=a,b,...; default heavy,idle-before,idle):
//   heavy        16 tracks (every built-in instrument in turn, a busy arrangement, looped), each through eq, comp,
//                drive, filter, chorus, delay, verb and width (every fourth a limiter too), comp + limiter on the master
//   idle         the same song, stopped: what the studio costs sitting there (kernels doze on silence)
//   idle-before  the same, with dozing switched off: how it was before (the before / after of that fix)
//   empty        the heavy graph with every insert an empty kernel (the host's own cost a device); empty-idle: stopped
//   auto         automation (docs/research/AUTOMATION.md 3.12): TRACKS tracks, each a probe kernel (tools/probe-kernel.js
//                PROBE64) with all 64 of its params on lanes that move every beat, plus a gain and a pan lane, looped;
//                auto-static is the same with no lanes. The difference per kernel is what evaluating 64 automated
//                params costs a block (the budget: under 1%)
//   song:<id>    a demo song (core/demos), played from its busiest 8 bars (the window with the most notes sounding);
//                songs: every demo. Each reports its worklets' share of the audio thread and the headroom
//   stress       16 tracks of the heaviest instruments (strings, choir, poly2, keys, pad, piano, brass, ep, drums ...),
//                each through eq, comp, chorus, delay and verb, with lanes on gain, pan, two instrument params and the
//                delay's feedback and the verb's mix, chords every two beats, looped: the worst song a person could make
// NODE=1 (or SCENES=node) first measures the canonical renderer in Node, where nothing else shares the thread: each
// demo song's whole render as a share of real time, each built-in and library device's cost (instruments: 1 and 16
// held voices; effects: on noise), and the stress song. Every share is also given at PHONE x (default 3: phones are
// 2-4x slower than an Apple Silicon Mac), against the audio thread's budget (a share over ~70% glitches in a browser,
// where the graph, the meters and the clock take the rest).
// The checks are loose (a busy machine is noisy): the studio runs at 48 kHz, every device builds, dozing takes the
// stopped studio's kernels to a small fraction of what they cost awake, and nothing errors.
//
//   node tools/perf-check.js
//   SCENES=heavy TRACKS=16 SECS=6 HEAD=0 (skip the headroom search) node tools/perf-check.js
//   NODE=1 SCENES=songs,stress node tools/perf-check.js     the before / after table of a performance pass
//   SCENES=node node tools/perf-check.js                    Node only, no browser (ONLY=core.verb,core.keys: those devices)
import { open, tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';
import { DEMOS, demoById } from '../app/src/core/demo.js';
import { INSTRUMENTS, EFFECTS } from '../app/src/devices/builtin/index.js';
import { LIB_INSTRUMENTS, LIB_EFFECTS } from '../app/src/devices/library/index.js';

const T = tally('perf');
const TRACKS = +(process.env.TRACKS || 16),
  SECS = +(process.env.SECS || 5),
  HEAD = process.env.HEAD !== '0';
const PHONE = +(process.env.PHONE || 3);
let SCENES = (process.env.SCENES || process.env.SCENE || 'heavy,idle-before,idle')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .flatMap((s) => (s === 'songs' ? DEMOS.map((d) => 'song:' + d.id) : [s]));
const NODE = process.env.NODE === '1' || SCENES.includes('node');
SCENES = SCENES.filter((s) => s !== 'node');

// ------------------------------------------------------------------------------------------------ the songs
// The stress song: the heaviest instruments (by the Node table below: 16 held voices), each through a five-device
// chain, every track with lanes, chords every two beats (drums: sixteenths), 8 bars looped.
const HEAVY = [
  'core.strings',
  'core.choir',
  'core.poly2',
  'core.keys',
  'core.pad',
  'core.piano',
  'core.brass',
  'core.ep',
  'core.drums',
  'core.poly',
  'claude.choir-loft',
  'core.organ',
  'core.strings',
  'core.choir',
  'core.poly2',
  'core.keys',
];
function stressSong(tracks = 16) {
  const STAMP = '2026-10-01T00:00:00.000Z';
  const lane = (pts) => ({ points: pts.map(([t, v, c]) => ({ t, v, ...(c != null ? { c } : {}) })) });
  const T = [];
  for (let i = 0; i < tracks; i++) {
    const dev = HEAVY[i % HEAVY.length],
      pad = String(i).padStart(2, '0'),
      notes = [];
    const root = (b) => 48 + ((i * 5 + (b >> 3) * 7) % 12);
    if (dev === 'core.drums')
      for (let b = 0; b < 64; b++) notes.push({ p: [36, 42, 38, 42][b % 4], t: b * 0.25, d: 0.2, v: 0.8 });
    else
      for (let b = 0; b < 32; b += 2)
        for (const iv of [0, 4, 7, 11]) notes.push({ p: root(b) + iv + (i % 3) * 12 - 12, t: b * 0.5, d: 1.9, v: 0.7 });
    const chain = ['core.eq', 'core.comp', 'core.chorus', 'core.delay', 'core.verb'];
    const inserts = chain.map((device, j) => ({
      id: `fx_${pad}${j}sts`,
      device,
      on: true,
      params: {},
      ...(device === 'core.delay'
        ? {
            auto: {
              feedback: lane([
                [0, 10],
                [16, 60, 0.5],
                [32, 10],
              ]),
            },
          }
        : {}),
      ...(device === 'core.verb'
        ? {
            auto: {
              mix: lane([
                [0, 0.1],
                [8, 0.4, -0.5],
                [24, 0.15],
                [32, 0.3],
              ]),
            },
          }
        : {}),
    }));
    T.push({
      id: `t_s${pad}xxx`,
      name: 'S' + i,
      kind: 'instrument',
      by: 'overdub',
      instrument: {
        device: dev,
        params: {},
        auto: {
          [i % 2 ? 'release' : 'decay']: lane([
            [0, 0.3],
            [16, 1.2, 0.3],
            [32, 0.4],
          ]),
        },
      },
      inserts,
      clips: [
        {
          id: `c_s${pad}xxx`,
          kind: 'notes',
          start: 0,
          length: 32,
          notes: notes.map((n, k) => ({ id: 'n' + k, ...n })),
        },
      ],
      gain: -18,
      pan: ((i % 5) - 2) / 3,
      mute: false,
      solo: false,
      auto: {
        gain: lane([
          [0, -24],
          [4, -16, 0.4],
          [16, -18],
          [32, -22],
        ]),
        pan: lane([
          [0, -0.6],
          [32, 0.6],
        ]),
      },
    });
  }
  return {
    ...createProject(),
    id: 'p_stress',
    title: 'stress',
    tempo: 120,
    key: null,
    meta: { created: STAMP, modified: STAMP, authors: {} },
    loop: { on: true, start: 0, end: 32 },
    tracks: T,
    master: {
      gain: 0,
      inserts: [
        { id: 'fx_mcomp', device: 'core.comp', on: true, params: {} },
        { id: 'fx_mlim1', device: 'core.limiter', on: true, params: {} },
      ],
    },
  };
}
// (a lane on a param the device doesn't have is dropped by lanesOf: instruments without decay / release just don't move)
// A demo's busiest 8 bars: the start beat of the window with the most note-beats sounding in it.
function busiest(p) {
  const bpb = (p.meter && p.meter[0]) || 4,
    W = 8 * bpb,
    ons = [];
  for (const t of p.tracks)
    for (const c of t.clips || [])
      if (c.kind === 'notes' && !c.mute)
        for (const n of c.notes || []) ons.push([c.start + n.t, c.start + n.t + (n.d || 0.25)]);
  let end = 0;
  for (const [, b] of ons) end = Math.max(end, b);
  let best = 0,
    at = 0;
  for (let s = 0; s + W <= end + bpb; s += bpb) {
    let x = 0;
    for (const [a, b] of ons) x += Math.max(0, Math.min(b, s + W) - Math.max(a, s));
    if (x > best) {
      best = x;
      at = s;
    }
  }
  return at;
}
const sceneSong = (scene) =>
  scene === 'stress' ? stressSong(TRACKS) : scene.startsWith('song:') ? demoById(scene.slice(5)) : null;

// ------------------------------------------------------------------------------------------------ Node
// The canonical renderer's cost: this thread's CPU time (process.threadCpuUsage: the render is synchronous) for the
// best of a few renders, as a share of the audio's own length.
const cpuMs = () => {
  const u = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1000;
};
function nodeShare(p, opts, reps = 2) {
  let best = Infinity,
    r;
  for (let k = 0; k < reps; k++) {
    const c0 = cpuMs();
    r = renderSong(p, opts);
    best = Math.min(best, cpuMs() - c0);
  }
  return { pct: best / (r.length / r.sr) / 10, secs: r.length / r.sr, graph: r.devices.graph };
}
const NODE_ROWS = [];
function nodeSection() {
  const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const phone = (x) => `${(x * PHONE).toFixed(0)}% at ${PHONE}x`;
  if (!ONLY) {
    console.log(`Node: each demo song rendered whole, as a share of real time (a phone at ${PHONE}x slower)`);
    for (const d of DEMOS) {
      const r = nodeShare(demoById(d.id), { tail: 0 });
      NODE_ROWS.push({ what: 'song:' + d.id, pct: r.pct });
      T.note(
        `${('song:' + d.id).padEnd(22)} ${r.secs.toFixed(0).padStart(3)} s  ${r.pct.toFixed(1).padStart(5)}%  (${phone(r.pct)})${r.graph ? `  (${r.graph} graph devices bypassed: Node can't run them)` : ''}`,
      );
    }
    const worst = NODE_ROWS.reduce((a, b) => (b.pct > a.pct ? b : a));
    T.ok(
      worst.pct * PHONE < 100,
      `every demo song renders in Node within a phone's real time (the worst, ${worst.what}: ${worst.pct.toFixed(1)}%, ${(worst.pct * PHONE).toFixed(0)}% at ${PHONE}x)`,
    );
    const st = nodeShare(stressSong(TRACKS), { from: 0, to: 32, tail: 0 }, 1);
    NODE_ROWS.push({ what: 'stress', pct: st.pct });
    T.note(
      `${'stress'.padEnd(22)} ${st.secs.toFixed(0).padStart(3)} s  ${st.pct.toFixed(1).padStart(5)}%  (${phone(st.pct)})`,
    );
  }
  // each device alone: instruments with 1 and 16 voices held 4 s (the drums: a busy bar of sixteenths and open hats),
  // effects on 4 s of noise, less the same render without it
  console.log('Node: each device alone, % of a core');
  const SR = 48000,
    SECS = 4,
    BEATS = 8;
  const song = (tracks, assets) => ({
    ...createProject(),
    id: 'p_bench',
    title: 'b',
    key: null,
    tempo: 120,
    tracks,
    assets: assets || {},
    master: { gain: 0, inserts: [] },
  });
  const held = (n) => Array.from({ length: n }, (_, i) => ({ id: 'n' + i, p: 40 + i * 2, t: 0, d: BEATS, v: 0.8 }));
  const beat = () =>
    Array.from({ length: 32 }, (_, b) => ({
      id: 'n' + b,
      p: [36, 42, 38, 42][b % 4],
      t: b * 0.25,
      d: 0.2,
      v: 0.8,
    })).concat(Array.from({ length: 8 }, (_, b) => ({ id: 'h' + b, p: 46, t: b + 0.5, d: 0.3, v: 0.6 })));
  const inst = (id, notes) =>
    song(
      id
        ? [
            {
              id: 't_bench',
              name: 'I',
              kind: 'instrument',
              instrument: { device: id, params: {} },
              inserts: [],
              clips: [{ id: 'c_bench', kind: 'notes', start: 0, length: BEATS, notes }],
              gain: -12,
              pan: 0,
              mute: false,
              solo: false,
            },
          ]
        : [],
    );
  const noise = new Float32Array(SR * SECS);
  {
    let z = 1;
    for (let i = 0; i < noise.length; i++) {
      z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
      noise[i] = (z / 4294967296 - 0.5) * 0.5 * Math.sin(i / 3000);
    }
  }
  const fx = (id) =>
    song(
      [
        {
          id: 't_bench',
          name: 'A',
          kind: 'audio',
          instrument: null,
          inserts: id ? [{ id: 'fx_bench', device: id, on: true, params: {} }] : [],
          clips: [{ id: 'c_a', kind: 'audio', start: 0, length: BEATS, asset: 'a_noise', offset: 0, gain: 0 }],
          gain: -12,
          pan: 0,
          mute: false,
          solo: false,
        },
      ],
      { a_noise: { kind: 'audio', name: 'noise', sr: SR, channels: 1, duration: SECS } },
    );
  const at = (p, assets) => nodeShare(p, { from: 0, to: BEATS, tail: 0, assets }, 3).pct;
  const A = { a_noise: { sr: SR, channels: [noise] } };
  const e0 = at(inst(null, [])),
    f0 = at(fx(null), A),
    rows = [];
  for (const d of [...INSTRUMENTS, ...LIB_INSTRUMENTS]) {
    if (ONLY && !ONLY.includes(d.id)) continue;
    if (d.cat === 'drums') {
      rows.push({ id: d.id, one: at(inst(d.id, beat())) - e0, note: 'a busy bar' });
      continue;
    }
    rows.push({ id: d.id, one: at(inst(d.id, held(1))) - e0, all: at(inst(d.id, held(16))) - e0 });
  }
  for (const d of [...EFFECTS, ...LIB_EFFECTS]) {
    if (ONLY && !ONLY.includes(d.id)) continue;
    rows.push({ id: d.id, one: at(fx(d.id), A) - f0, note: 'effect' });
  }
  rows.sort((a, b) => (b.all ?? b.one) - (a.all ?? a.one));
  for (const r of rows) {
    NODE_ROWS.push({ what: r.id, pct: r.all ?? r.one });
    T.note(
      `${r.id.padEnd(22)} ${r.all != null ? `16 voices ${r.all.toFixed(2).padStart(5)}%, 1 voice ${r.one.toFixed(2).padStart(5)}%, ${((r.all - r.one) / 15).toFixed(3)}% a voice more` : `${r.note.padEnd(10)} ${r.one.toFixed(2).padStart(5)}%`}`,
    );
  }
}
if (NODE) nodeSection();
if (!SCENES.length) {
  T.done();
  process.exit();
}

const INIT = () => {
  const P = (window.__perf = {});
  // every worklet processor is wrapped: its process() is timed and its name kept (kernels: their kind and param keys)
  const HOOK = `if(!globalThis.__pf){globalThis.__pf={list:[]};const RP=globalThis.registerProcessor;
globalThis.registerProcessor=function(name,C){if(name==='perf-probe')return RP(name,C);
class W extends C{constructor(o){super(o);const po=o&&o.processorOptions;const tag=po&&po.params?(po.kind||'')+':'+po.params.map((p)=>p.key).join(','):name;this.__s={name:tag,n:0,ms:0,dead:false};globalThis.__pf.list.push(this.__s);}
process(i,o,p){const t=Date.now();const r=super.process(i,o,p);const s=this.__s;s.ms+=Date.now()-t;s.n++;if(!r)s.dead=true;return r;}}
return RP(name,W);};
class Probe extends AudioWorkletProcessor{constructor(){super();this.burn=0;this.bms=0;this.bn=0;this.x=0;this.port.onmessage=(e)=>{const m=e.data;
if(m.t==='burn'){this.burn=m.n;this.bms=0;this.bn=0;this.port.postMessage({t:'ok'});}
if(m.t==='get'){this.port.postMessage({t:'stats',list:globalThis.__pf.list.map((s)=>Object.assign({},s)),bms:this.bms,bn:this.bn});}
if(m.t==='reset'){globalThis.__pf.list=globalThis.__pf.list.filter((s)=>!s.dead);for(const s of globalThis.__pf.list){s.n=0;s.ms=0;}this.port.postMessage({t:'ok'});}};}
process(){if(this.burn){const t=Date.now();let x=this.x;for(let i=0;i<this.burn;i++)x=Math.sqrt(x+i)*0.5;this.x=x;this.bms+=Date.now()-t;this.bn++;}return true;}}
RP('perf-probe',Probe);}
`;
  // (the hook goes in first on each context, as a module of its own: the studio's worklets are files, and this page,
  // tools/engine-test.html, has no policy, so a data: module loads here)
  const addM = AudioWorklet.prototype.addModule,
    hooked = new WeakMap();
  AudioWorklet.prototype.addModule = function (url, o) {
    if (!hooked.has(this))
      hooked.set(this, addM.call(this, 'data:text/javascript;charset=utf-8,' + encodeURIComponent(HOOK)));
    return hooked.get(this).then(() => addM.call(this, url, o));
  };
  // window.__noDoze: kernels made from now on never doze (the before of that fix)
  const AWN = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends AWN {
    constructor(c, n, o) {
      if (window.__noDoze && o && o.processorOptions)
        o = { ...o, processorOptions: { ...o.processorOptions, idle: false } };
      super(c, n, o);
    }
  };
  // the studio at 48 kHz
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(o) {
      super({ ...(o || {}), sampleRate: 48000 });
    }
  };
};

const { page, errors, close, context } = await open('/tools/engine-test.html');
await page.addInitScript(INIT);
await page.reload({ waitUntil: 'load' });
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () =>
  Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build the scene's song and engine in the page (window.__eng), playing unless the scene is an idle one.
const build = (scene) =>
  page.evaluate(
    async ({ TRACKS, scene, song, from }) => {
      const E = await import('/app/src/engine/engine.js');
      const S = await import('/app/src/core/store.js');
      const R = await import('/app/src/devices/registry.js');
      await import('/app/src/devices/builtin/index.js');
      await import('/app/src/devices/library/index.js'); // (the house shelf the demo songs use, and the pedals and amps)
      await import('/app/src/devices/guitar/index.js');
      // a song's own kernels (project.devices), as the studio registers them (main.js syncProjectDevices)
      for (const src of Object.values((song && song.devices) || {}))
        R.defineDevice({ ...src, source: 'project' }, { replace: true });
      window.__noDoze = /before/.test(scene);
      const { PROBE64 } = await import('/tools/probe-kernel.js');
      R.defineDevice(PROBE64, { replace: true });
      // kernel tags -> device ids (a tag is kind + its param keys, as the worklet hook names it)
      const tags = {};
      for (const d of R.listDevices())
        if (d.kernel) {
          const k = (d.kind || '') + ':' + d.params.map((p) => p.key).join(',');
          (tags[k] = tags[k] || []).push(d.id);
        }
      window.__tags = tags;
      const INST = ['core.poly', 'core.bass', 'core.keys', 'core.pluck', 'core.drums', 'core.pad'];
      let CHAIN = [
        'core.eq',
        'core.comp',
        'core.drive',
        'core.filter',
        'core.chorus',
        'core.delay',
        'core.verb',
        'core.width',
      ];
      const empty = scene.startsWith('empty');
      if (empty) {
        if (!R.getDevice('test.empty'))
          R.defineDevice({
            id: 'test.empty',
            name: 'Empty',
            kind: 'effect',
            params: [],
            kernel: '({ create() { return { process() {} }; } })',
          });
        CHAIN = CHAIN.map(() => 'test.empty');
      }
      const tracks = [];
      if (scene.startsWith('auto')) {
        const lanes = scene === 'auto';
        for (let i = 0; i < TRACKS; i++) {
          const pad = String(i).padStart(2, '0'),
            auto = {};
          if (lanes)
            for (let k = 0; k < 64; k++)
              auto['k' + k] = {
                points: Array.from({ length: 9 }, (_, b) => ({ t: b, v: ((b + k + i) % 3) / 2, c: (k % 3) - 1 })),
              };
          tracks.push({
            id: `t_p${pad}xxx`,
            name: 'T' + i,
            kind: 'audio',
            instrument: null,
            clips: [],
            gain: -30,
            pan: 0,
            mute: false,
            solo: false,
            inserts: [
              { id: `fx_${pad}prbx`, device: 'test.probe64', on: true, params: {}, ...(lanes ? { auto } : {}) },
            ],
            ...(lanes
              ? {
                  auto: {
                    gain: {
                      points: [
                        { t: 0, v: -40 },
                        { t: 4, v: -30 },
                        { t: 8, v: -40 },
                      ],
                    },
                    pan: {
                      points: [
                        { t: 0, v: -0.5 },
                        { t: 8, v: 0.5 },
                      ],
                    },
                  },
                }
              : {}),
          });
        }
      }
      for (let i = 0; i < (scene.startsWith('auto') || song ? 0 : TRACKS); i++) {
        // a busy arrangement: drums in eighths, bass in eighths, a pluck line in sixteenths, keys / poly / pad chords
        const inst = INST[i % INST.length],
          notes = [];
        const root = (b) => 48 + ((i * 5 + (b >> 2) * 7) % 12);
        if (inst === 'core.drums')
          for (let b = 0; b < 16; b++) notes.push({ p: [36, 42, 38, 42][b % 4], t: b * 0.5, d: 0.25, v: 0.8 });
        else if (inst === 'core.bass')
          for (let b = 0; b < 16; b++) notes.push({ p: root(b) - 12, t: b * 0.5, d: 0.45, v: 0.7 });
        else if (inst === 'core.pluck')
          for (let b = 0; b < 32; b++)
            notes.push({ p: root(b >> 1) + 12 + [0, 3, 7, 10][b % 4], t: b * 0.25, d: 0.2, v: 0.7 });
        else
          for (let b = 0; b < 16; b += 4)
            for (const iv of [0, 3, 7]) notes.push({ p: root(b) + iv, t: b * 0.5, d: 1.9, v: 0.7 });
        const pad = String(i).padStart(2, '0');
        const inserts = CHAIN.map((device, j) => ({ id: `fx_${pad}${j}xxx`, device, on: true, params: {} }));
        if (i % 4 === 3 && !empty) inserts.push({ id: `fx_${pad}limx`, device: 'core.limiter', on: true, params: {} });
        tracks.push({
          id: `t_p${pad}xxx`,
          name: 'T' + i,
          kind: 'instrument',
          instrument: { device: inst, params: {} },
          inserts,
          clips: [
            {
              id: `c_p${pad}xxx`,
              kind: 'notes',
              start: 0,
              length: 8,
              notes: notes.map((n, k) => ({ id: 'n' + k, ...n })),
            },
          ],
          gain: -14,
          pan: ((i % 5) - 2) / 3,
          mute: false,
          solo: false,
        });
      }
      const p = song || {
        format: 'overdub/0',
        id: 'p_perf01',
        title: 'perf',
        tempo: 120,
        meter: [4, 4],
        key: null,
        loop: { on: true, start: 0, end: 8 },
        tracks,
        sections: [],
        devices: {},
        assets: {},
        master: {
          gain: 0,
          inserts: [
            { id: 'fx_mcomp', device: 'core.comp', on: true, params: {} },
            { id: 'fx_mlim1', device: 'core.limiter', on: true, params: {} },
          ],
        },
        meta: {},
      };
      const engine = E.createEngine(S.createStore(p));
      window.__eng = engine;
      const errs = [];
      engine.on('error', (e) => errs.push(e.message));
      window.__meterN = 0;
      engine.on('meters', () => {
        window.__meterN++;
      });
      const t0 = performance.now();
      await engine.start();
      const built = performance.now() - t0;
      if (!/idle/.test(scene)) await engine.play(from || 0);
      // the probe (headroom) and the worklet hook's stats, on this context
      const c = engine.ctx,
        P = window.__perf;
      await c.audioWorklet.addModule('data:text/javascript;charset=utf-8,' + encodeURIComponent('/* probe */'));
      const n = new AudioWorkletNode(c, 'perf-probe', { numberOfInputs: 0, numberOfOutputs: 1 });
      const z = c.createGain();
      z.gain.value = 0;
      n.connect(z);
      z.connect(c.destination);
      P.pn = n;
      P.ask = (m) =>
        new Promise((res) => {
          P.pn.port.onmessage = (e) => res(e.data);
          P.pn.port.postMessage(m);
        });
      return {
        sr: c.sampleRate,
        built,
        tracks: p.tracks.length,
        inserts:
          p.tracks.reduce((a, t) => a + (t.inserts || []).length, 0) + ((p.master && p.master.inserts) || []).length,
        errs,
        latency: engine.latency.total,
      };
    },
    { TRACKS, scene, song: sceneSong(scene), from: scene.startsWith('song:') ? busiest(sceneSong(scene)) : 0 },
  );

// A measured window: worklets, the audio clock, the main thread.
async function measure(secs) {
  await page.evaluate(async () => {
    await window.__perf.ask({ t: 'reset' });
    window.__meterN = 0;
    window.__a0 = [window.__eng.ctx.currentTime, performance.now()];
  });
  const m0 = await metrics();
  await sleep(secs * 1000);
  const m1 = await metrics();
  const r = await page.evaluate(async () => {
    const st = await window.__perf.ask({ t: 'get' });
    const [a0, w0] = window.__a0,
      wall = (performance.now() - w0) / 1000,
      aud = window.__eng.ctx.currentTime - a0;
    const by = {};
    for (const s of st.list) {
      if (!s.n) continue;
      const ids = window.__tags[s.name] ? window.__tags[s.name].join('|') : s.name;
      const b = by[ids] || (by[ids] = { n: 0, ms: 0 });
      b.n++;
      b.ms += s.ms;
    }
    return { wall, clock: aud / wall, by, meters: window.__meterN / wall };
  });
  const wk = Object.entries(r.by)
    .map(([id, b]) => ({ id, n: b.n, pct: b.ms / r.wall / 10 }))
    .sort((a, b) => b.pct - a.pct);
  return {
    clock: r.clock,
    wk,
    wkPct: wk.reduce((a, b) => a + b.pct, 0),
    processing: wk.reduce((a, b) => a + b.n, 0),
    script: ((m1.ScriptDuration - m0.ScriptDuration) / r.wall) * 100,
    task: ((m1.TaskDuration - m0.TaskDuration) / r.wall) * 100,
    meters: r.meters,
  };
}

// The most a probe can burn each quantum while the audio clock keeps up (a binary search).
const headroom = () =>
  page.evaluate(async () => {
    const P = window.__perf,
      c = window.__eng.ctx,
      q = (128 / c.sampleRate) * 1000;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await P.ask({ t: 'burn', n: 20000 });
    await sleep(1200);
    const s = await P.ask({ t: 'get' });
    const perMs = 20000 / Math.max(1e-3, s.bms / Math.max(1, s.bn));
    const trial = async (ms) => {
      await P.ask({ t: 'burn', n: Math.round(ms * perMs) });
      await sleep(250);
      const t0 = performance.now(),
        a0 = c.currentTime;
      await sleep(1200);
      const r = (c.currentTime - a0) / ((performance.now() - t0) / 1000);
      const g = await P.ask({ t: 'get' });
      return { r, got: g.bms / Math.max(1, g.bn) };
    };
    let lo = 0,
      hi = q * 1.2,
      best = 0;
    for (let k = 0; k < 6; k++) {
      const mid = (lo + hi) / 2,
        t = await trial(mid);
      if (t.r > 0.995) {
        lo = mid;
        best = Math.max(best, t.got);
      } else hi = mid;
    }
    await P.ask({ t: 'burn', n: 0 });
    return { q, best, load: 100 * (1 - best / q) };
  });

const results = {};
for (const scene of SCENES) {
  const info = await build(scene);
  console.log(
    `${scene}: ${info.tracks || TRACKS} tracks, ${info.inserts} inserts, at ${info.sr} Hz; built in ${info.built.toFixed(0)} ms; plugin latency ${(info.latency * 1000).toFixed(2)} ms`,
  );
  T.ok(
    info.sr === 48000 && !info.errs.length,
    `${scene}: the studio runs at ${info.sr} Hz and every device built${info.errs.length ? ': ' + info.errs.slice(0, 3).join(' | ') : ''}`,
  );
  // (let it settle; stopped, long enough for every tail to have died away and the kernels to doze)
  await sleep(/idle/.test(scene) ? 11000 : 1500);
  const w = await measure(SECS);
  T.note(
    `${scene}: worklets ${w.wkPct.toFixed(1)}% of the audio thread (${w.processing} processing); the audio clock ran at ${(w.clock * 100).toFixed(2)}% of the wall clock`,
  );
  for (const x of w.wk.slice(0, /idle/.test(scene) ? 4 : 12))
    T.note(
      `  ${x.id.padEnd(34)} ${String(x.n).padStart(3)} x  ${x.pct.toFixed(2).padStart(6)}%  (${(x.pct / x.n).toFixed(3)}% each)`,
    );
  T.note(
    `${scene}: main thread: script ${w.script.toFixed(1)}%, tasks ${w.task.toFixed(1)}% of a core; meters ${w.meters.toFixed(1)}/s`,
  );
  if (HEAD) {
    const h = await headroom();
    w.load = h.load;
    T.note(
      `${scene}: headroom ${h.best.toFixed(3)} ms of a ${h.q.toFixed(3)} ms quantum: the audio thread is ~${h.load.toFixed(0)}% loaded (a phone at ${PHONE}x: ~${Math.round(h.load * PHONE)}%${h.load * PHONE > 100 ? ', over: it glitches' : ''})`,
    );
  }
  results[scene] = w;
  await page.evaluate(() => {
    window.__eng.stop();
    return window.__eng.dispose();
  });
}

if (results.idle && results['idle-before']) {
  const a = results['idle-before'],
    b = results.idle;
  T.ok(
    b.wkPct < a.wkPct / 3,
    `stopped, the kernels doze: ${a.wkPct.toFixed(1)}% of the audio thread -> ${b.wkPct.toFixed(1)}%${a.load != null ? ` (load ~${a.load.toFixed(0)}% -> ~${b.load.toFixed(0)}%)` : ''}`,
  );
}
if (results.auto && results['auto-static']) {
  const each = (w) => {
    const x = w.wk.find((k) => /test\.probe64/.test(k.id));
    return x ? x.pct / x.n : NaN;
  };
  const a = each(results['auto-static']),
    b = each(results.auto);
  T.ok(
    b - a < 1,
    `64 automated kernel params cost ${(b - a).toFixed(3)}% of a block (a probe kernel: ${a.toFixed(3)}% static, ${b.toFixed(3)}% with every param on a lane; budget 1%)`,
  );
}
// the summary: every scene's worklets and load, now and on a phone
const sum = Object.entries(results);
if (sum.length > 1 || NODE_ROWS.length) {
  console.log(`summary (a phone at ${PHONE}x slower)`);
  for (const [k, w] of sum)
    T.note(
      `${k.padEnd(22)} worklets ${w.wkPct.toFixed(1).padStart(5)}%${w.load != null ? `, load ~${w.load.toFixed(0).padStart(3)}% (phone ~${Math.round(w.load * PHONE)}%)` : ''}, clock ${(w.clock * 100).toFixed(1)}%`,
    );
}
if (results.heavy)
  T.ok(
    results.heavy.processing >= TRACKS * 9,
    `playing, every kernel is awake (${results.heavy.processing} processing)`,
  );
const pageErrors = errors.filter((e) => !/overdub engine:/.test(e));
T.ok(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.slice(0, 3).join(' | ') : ''}`);
await close();
T.done();
