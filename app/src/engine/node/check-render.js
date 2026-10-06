// The render process of the Node device check (engine/node/check.js starts it; nothing else should). It is the only
// place the device's kernel runs: it reads jobs from stdin and writes samples to stdout, as frames (frames.js), and
// that is all. It renders the way the Node renderer does (engine/node/render.js): the studio's KernelCore with the
// same dsp stdlib, in 128-frame blocks, an effect on the wet path alone (kernel/host.js's wiring with the effect on).
//
// The kernel shares this process, so everything here is the kernel's to change: what this process sends back is
// treated as the kernel speaking. The checker keeps only samples of the length it asked for and measures them itself.
//
//   in:  { type: 'job', id, def: { id, kind, kernel, params, poly, tail }, secs, sr, bpm, seed, params, notes,
//          allOffAt, stats, inFrames } + the input (L then R, inFrames each; effects)
//   out: { type: 'hi' }                                               once, at start, before any kernel has run
//        { type: 'ready', id }                                        create() returned; the render starts
//        { type: 'done', id, errors, stats, latency, poly } + L, R    secs * sr frames each (latency in samples)
//        { type: 'done', id, compileError, line }                    it didn't compile, or create() threw
import { kernelCore, kernelCompiler } from '../../kernel/worklet.js';
import { kernelSpecs } from '../../kernel/host.js';
import { makeDsp } from '../../kernel/dsp.js';
import { paramValues } from '../../devices/registry.js';
import { frame, reader } from './frames.js';

const Q = 128;
const cores = new Map();
const coreAt = (sr) => { let K = cores.get(sr); if (!K) { K = kernelCore(sr, makeDsp(sr), kernelCompiler); cores.set(sr, K); } return K; };
const out = process.stdout;
const send = (header, chans) => out.write(frame(header, chans));

function run(h, payload) {
  const sr = +h.sr, def = h.def || {}, kind = def.kind === 'instrument' ? 'instrument' : 'effect';
  const specs = kernelSpecs(def), values = paramValues({ params: specs }, h.params || {});
  const errors = [];
  let ready = null, stats = null;
  const post = (m) => {
    if (!m) return;
    if (m.type === 'error') { if (errors.length < 50) errors.push({ stage: m.stage, message: String(m.message), line: m.line ?? null }); }
    else if (m.type === 'ready') ready = m;
    else if (m.type === 'stats') stats = { maxVoices: m.maxVoices, steals: m.steals };
  };
  const K = coreAt(sr);
  const core = new K({ source: def.kernel, kind, params: specs, values, poly: def.poly, seed: h.seed >>> 0,
    transport: { bpm: h.bpm, playing: true, beat: 0, time: 0 }, tail: def.tail }, post);
  if (!ready) {
    const c = errors.find((e) => e.stage === 'compile');
    send({ type: 'done', id: h.id, compileError: c ? c.message : 'the kernel did not start', line: c ? c.line : null });
    return;
  }
  send({ type: 'ready', id: h.id });
  // what kernel/host.js posts before an offline render starts: the params (snapped), the notes, an allOff
  core.msg({ type: 'params', values, jump: true });
  for (const n of h.notes || []) {
    core.msg({ type: 'on', p: n.p | 0, v: +n.v, time: +n.t });
    core.msg({ type: 'off', p: n.p | 0, time: +n.t + +n.d });
  }
  if (h.allOffAt != null) core.msg({ type: 'alloff', time: +h.allOffAt });
  const frames = Math.round(h.secs * sr), inFrames = h.inFrames | 0;
  const inL = inFrames ? new Float32Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + inFrames * 4)) : null;
  const inR = inFrames ? new Float32Array(payload.buffer.slice(payload.byteOffset + inFrames * 4, payload.byteOffset + inFrames * 8)) : null;
  const L = new Float32Array(frames), R = new Float32Array(frames);
  const iL = new Float32Array(Q), iR = new Float32Array(Q), bL = new Float32Array(Q), bR = new Float32Array(Q);
  for (let f = 0; f < frames; f += Q) {
    const m = Math.min(Q, frames - f);
    if (kind === 'effect') {
      iL.fill(0); iR.fill(0);
      if (inL && f < inFrames) { iL.set(inL.subarray(f, Math.min(f + Q, inFrames))); iR.set(inR.subarray(f, Math.min(f + Q, inFrames))); }
      core.block(iL, iR, bL, bR, f);
    } else core.block(null, null, bL, bR, f);
    L.set(bL.subarray(0, m), f); R.set(bR.subarray(0, m), f);
  }
  if (h.stats) core.msg({ type: 'stats' });
  core.msg({ type: 'end' });
  send({ type: 'done', id: h.id, errors, stats, latency: ready.latency, poly: ready.poly }, [L, R]);
}

const rd = reader({
  allow: (h) => (h && h.type === 'job' ? (h.inFrames | 0) * 8 : 0),
  onFrame: (h, payload) => { if (h && h.type === 'job') run(h, payload); },
  onError: () => process.exit(2),
  maxHeader: 4 << 20,
});
process.stdin.on('data', (b) => rd.push(b));
coreAt(48000); // (the check's rate: made now, so the first job's cpu time is the kernel's, not the stdlib's setup)
send({ type: 'hi' });
process.stdin.on('end', () => process.exit(0));
