// The device check in Node, with the kernel in a process of its own. checkDevice (kernel/check.js) renders in the
// page's AudioWorklet, a realm apart from the one that writes the report. Node has no such realm: a kernel run in the
// process that writes its report can rewrite the report, or print one of its own and exit ([].constructor.constructor
// reaches `process`). So here the kernel runs only in a child process (check-render.js) that is sent the def and each
// test job and sends back samples; this process never evaluates kernel code. checkDevice measures those samples here,
// with audio/measure.js: level, peaks, NaN, tails, determinism, and cpu as wall time timed on this side, from writing
// the job to the samples arriving (so compiling and create() count as render time; the child starts and sends 'hi'
// before any kernel runs, so starting it doesn't).
//
//   import { checkDeviceNode } from './engine/node/check.js';
//   const report = await checkDeviceNode(def, { quick, signal, timeout })     the same report as checkDevice's
//
// What the child says besides samples (errors it hit, its latency, poly, voice counts) can only add to a report: an
// error makes the device fail, and a claim out of range is dropped (kernel/check.js, accept). A child that sends
// anything but the frames asked for, or ends before the check does, fails the check ('render: ...'). At the deadline
// or on `signal` the child is killed, so a process() that never returns costs nothing after the check. The child runs
// under Node's permission model: it can read app/src (the code that renders), can't write files or start processes or
// threads, and can reach the network (Node 24's model has no network permission). It can also read app/kits/, the
// kernel data a def may name (engine/node/data.js).
//
// What this keeps out is a kernel rewriting the report in the process that writes it. It doesn't make the samples the
// checker's: the kernel shares the child, so everything the child sends (samples, claims, when its frames go out) is
// the kernel's to shape, and one written to fool the check can send quiet samples while it plays loud. Passing means
// only that the device behaved in the measured ways while it was checked; reading the kernel is what tells you what
// it does.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDevice } from '../../kernel/check.js';
import { frame, reader } from './frames.js';
import { KITS } from './data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../..'); // app/src
const CHILD = path.join(HERE, 'check-render.js');
const fault = (m) => Object.assign(new Error(m), { name: 'RenderFault' });
// (what the child wrote to stderr is the kernel's text: one line of it, plain, trimmed)
const tidy = (s) => String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(-300);

// A renderer for checkDevice ({ render, close }); the child starts on the first render.
export function nodeRenderer({ node = process.execPath } = {}) {
  let child = null, dead = null, cur = null, seq = 0, err = '', hi = null, gone = null;
  let chain = Promise.resolve();
  const die = (msg) => {
    if (dead) return;
    dead = msg;
    if (child) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    if (cur) { const c = cur; cur = null; c.reject(fault(msg)); }
    if (gone) { const g = gone; gone = null; g(fault(msg)); }
  };
  const start = () => {
    if (!process.allowedNodeEnvironmentFlags.has('--permission')) throw new Error(`this Node (${process.version}) has no --permission flag; the device check needs Node 22 or later`);
    // (it reads app/src, the code that renders, and app/kits, the kernel data a def may name)
    child = spawn(node, ['--permission', `--allow-fs-read=${SRC}`, `--allow-fs-read=${KITS}`, CHILD], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    // 'hi': the child has started and loaded the renderer, before any kernel has run in it (so it's the child's own)
    let greet;
    hi = new Promise((res) => { greet = res; });
    child.on('error', (e) => die(`the render process didn't start (${e.message})`));
    child.on('close', (code, sig) => die(`the render process ended (${sig || 'exit ' + code}) before the check finished${err ? ': ' + tidy(err) : ''}`));
    child.stdin.on('error', () => {});
    child.stderr.on('data', (b) => { err = (err + b).slice(-2000); });
    const rd = reader({
      maxHeader: 64 * 1024,
      allow(h) {
        if (greet && h && h.type === 'hi') return 0;
        if (!cur || !h || typeof h !== 'object' || h.id !== cur.id) throw new Error('a frame for no render that was asked for');
        if (h.type === 'ready' && !cur.started) return 0;
        if (h.type === 'done' && h.compileError != null && !cur.started) return 0;
        if (h.type === 'done' && cur.started) return cur.frames * 8;
        throw new Error(`a "${String(h.type).slice(0, 20)}" frame out of turn`);
      },
      onFrame(h, payload) {
        if (h.type === 'hi') { const g = greet; greet = null; return g(); }
        const c = cur;
        // (when 'ready' arrives is the kernel's to choose, so it only says create() returned; cpu is timed from the
        // job going out, which nothing in the child can move earlier)
        if (h.type === 'ready') { c.started = true; c.hooks.created?.(); return; }
        const ms = c.started ? performance.now() - c.t0 : 0;
        cur = null;
        if (h.compileError != null) return c.resolve({ compileError: String(h.compileError), line: h.line });
        const ab = new ArrayBuffer(payload.length);
        new Uint8Array(ab).set(payload);
        const latency = (Number.isFinite(h.latency) ? h.latency : 0) / c.sr || +c.def.latency || 0;
        c.resolve({ channels: [new Float32Array(ab, 0, c.frames), new Float32Array(ab, c.frames * 4, c.frames)], ms, errors: h.errors, stats: h.stats, latency, poly: h.poly });
      },
      onError: (m) => die(`the render process sent something that isn't a render (${m})`),
    });
    child.stdout.on('data', (b) => rd.push(b));
  };
  const run = async (def, job, hooks) => {
    if (dead) throw fault(dead);
    if (!child) start();
    await Promise.race([hi, new Promise((res, rej) => { if (dead) rej(fault(dead)); gone = rej; })]).finally(() => { gone = null; });
    return send(def, job, hooks);
  };
  const send = (def, job, hooks) => new Promise((resolve, reject) => {
    if (dead) return reject(fault(dead));
    const frames = Math.round(job.secs * job.sr);
    const input = job.input ? [job.input[0], job.input[1] || job.input[0]] : null;
    const inFrames = input ? input[0].length : 0;
    // a keyed effect's key (def.key: true), after the input
    const key = job.key && def.key === true ? [job.key[0], job.key[1] || job.key[0]] : null;
    const keyFrames = key ? key[0].length : 0;
    cur = { id: ++seq, frames, sr: job.sr, def, hooks: hooks || {}, started: false, t0: 0, resolve, reject };
    const d = { id: def.id, kind: def.kind, kernel: def.kernel, params: def.params, poly: def.poly, tail: def.tail, data: def.data, key: def.key === true };
    const header = { type: 'job', id: cur.id, def: d, secs: job.secs, sr: job.sr, bpm: job.bpm, seed: job.seed, params: job.params,
      notes: job.notes, allOffAt: job.allOffAt, stats: !!job.stats, inFrames, keyFrames };
    const chans = input ? [Float32Array.from(input[0]), Float32Array.from(input[1]).subarray(0, inFrames)] : [];
    if (key) chans.push(Float32Array.from(key[0]), Float32Array.from(key[1]).subarray(0, keyFrames));
    const f = frame(header, chans);
    cur.t0 = performance.now();
    child.stdin.write(f);
  });
  return {
    // one render at a time: the child renders in order, and cpu is timed one render alone
    render(def, job, hooks) { const p = chain.then(() => run(def, job, hooks)); chain = p.catch(() => {}); return p; },
    close() { die('closed'); },
  };
}

export async function checkDeviceNode(def, opts = {}) {
  const renderer = nodeRenderer(opts);
  try { return await checkDevice(def, { ...opts, renderer }); } finally { renderer.close(); }
}
