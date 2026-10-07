// The kernel processor: one AudioWorkletProcessor ('overdub-kernel') that hosts ANY kernel by source string.
// kernel/host.js loads kernel/processor.js (this module's processor with the dsp stdlib, a file on the page's own
// origin) once per AudioContext and makes the nodes. This module is also evaluated in the AudioWorkletGlobalScope, so
// its top level uses nothing of the page's (no window, no document).
//
// processorOptions: { source, kind: 'effect' | 'instrument', params: [ParamSpec], values: { key: value }, poly, seed,
//                     transport?: { bpm, playing, beat, time }, idle?: bool, tail?: seconds, data? }
//   data (kernel data, docs/DEVICES.md "Kernel data"): { [name]: { hash, bytes? } | null }, what the def's `data`
//   names. The processor decodes each file once per audio context (kernel/odk.js; bytes come with the first node that
//   needs them, the hash alone after; a node whose hash comes before those bytes is created again when they land) and
//   the kernel's create() gets { [name]: decoded | null }. KernelCore itself takes the decoded objects (the Node
//   renderer reads the same files from disk).
//   idle (live only; renders never set it): a kernel with nothing coming in (an effect fed exact silence, an
//   instrument with no voices and no notes due) whose output has stayed under -100 dBFS for max(0.5 s, min(tail, 10 s))
//   dozes: it outputs silence without running until something comes in again (the same block). Silence costs nothing.
// Messages in (node.port):
//   { type: 'params', values, jump? }          new targets (continuous params glide ~10 ms; stepped ones snap)
//   { type: 'on', p, v, time } / { type: 'off', p, time } / { type: 'alloff', time }   AudioContext seconds
//   { type: 'cancel', p, time, off? }         take back the note-on at `time` (and its note-off at `off`): still
//                                              queued, it never sounds; already playing, it is released at once
//   { type: 'cancel', p, time, off?, to }     move a playing note's release from `off` to `to`
//   { type: 'flush', time }                    drop every queued note-on and note-off at or after `time` (the
//                                              transport stopped: what the lookahead handed over never happens;
//                                              the 'alloff' that follows releases what is sounding)
//   { type: 'watch', open: { pitch: n }, time, ring }   the watchdog (live, sent by the host while the transport is
//                                              stopped): a held voice beyond the host's open notes for its pitch
//                                              (started before `time`, no pedal holding it, no off still queued)
//                                              is released; a released voice still going `ring` s after its
//                                              release is faded out. Each is reported: { type: 'stuck', why, p, n }
//   { type: 'transport', bpm, playing, beat, time }   the song position at AudioContext time `time`
//   { type: 'expr', bend?, mod?, sustain?, time }      the channel's expression from `time` (instruments; kernel/expr.js):
//                                              bend in semitones, mod 0..1, sustain (note-offs wait for it to lift)
//   an 'on' may carry x: { bend?, mod? }       the note's own expression (seconds from its start; kernel/expr.js)
//   { type: 'auto', key, time, end, a, b, c, start? }   automation (docs/research/AUTOMATION.md 3.5): param `key`
//                                              follows one segment of its lane from `start` (default `time`) until a
//                                              later-starting one takes over. a, b: knob travel 0..1 at `time` and `end`
//                                              (AudioContext seconds); c: the bend (-1..1, 0 straight) or 'step'. Past
//                                              `end` it holds b. Evaluated at the start of every 128-frame block, then
//                                              smoothed like any target (10 ms), so a jump never clicks. A key that has
//                                              had one ignores 'params' (the value is kept for when automation stops)
//   { type: 'auto.clear', key?, from, release? }   drop `key`'s (no key: every key's) segments starting at or after
//                                              `from` (seconds); release: the key(s) go back to the 'params' value
//   { type: 'auto.stop' }                      drop every segment and release every key (the transport stopped)
//   { type: 'code', source, id }               hot reload: compile, then crossfade old -> new over 20 ms
//   { type: 'data', data }                     the kernel data arrived (it was loading): create() again with it, the
//                                              same source, crossfading from what played before (silence) over 20 ms
//   { type: 'sleep', on }                      skip the kernel and output silence (bypassed effects)
//   { type: 'sync', id }                       answered with { type: 'synced', id } (everything before it is in)
//   { type: 'stats' }                          ask for { type: 'stats', voices, held, maxVoices, steals, notes, faulted,
//                                              dozing, stuck, list, frame } (held: voices whose note is still down;
//                                              stuck: voices the watchdog let go; list: the sounding voices, each
//                                              { p, held, sus, on, rel } with the frames it started and was let go
//                                              (-1: not yet); frame: the block it was asked in)
//   { type: 'end' }                            process() returns false: the node can be collected
// Messages out:
//   { type: 'ready', id?, latency, poly, version }       compiled and running (latency in samples)
//   { type: 'error', stage: 'compile' | 'process', message, line?, id? }   compile errors keep the old kernel;
//        a process error (a throw, NaN/Infinity, or an exploding output) silences the node until a reload
//   { type: 'log', args }                      console.log from a kernel (the first 20)

import { decodeOdk } from './odk.js';

// Compile a kernel source string into its object. compile() evaluates the kernel and runs only where kernels run:
// the worklet and the Node renderer. The main thread uses parse() alone (host.compileKernel), which never calls
// what it built. The kernel sees `dsp`, a frozen Math whose random() throws, a tiny console, and nothing else on
// purpose: the names below are shadowed. (This guards against accidents, it is not a security boundary:
// `[].constructor.constructor` still reaches the realm's Function. That is why kernels are evaluated only in the
// AudioWorkletGlobalScope, which has no DOM, no storage and no network, and never in the page. The Node renderer has
// no such scope: there a kernel runs with the process's privileges, so tools/render.js and tools/bench/run.js render
// a song or ops log from outside under Node's permission model, tools/node-permissions.js.)
export function kernelCompiler(scope) {
  const SHADOW = ['globalThis', 'self', 'window', 'document', 'sampleRate', 'currentTime', 'currentFrame', 'registerProcessor',
    'AudioWorkletProcessor', 'AudioWorkletGlobalScope', 'Date', 'performance', 'Function', 'port', 'fetch', 'XMLHttpRequest',
    'WebSocket', 'Worker', 'importScripts', 'localStorage', 'indexedDB', 'navigator', 'location', 'setTimeout', 'setInterval',
    'queueMicrotask', 'postMessage', 'WebAssembly', 'require', 'process'];
  const mathProps = {};
  for (const k of Object.getOwnPropertyNames(Math)) mathProps[k] = Math[k];
  mathProps.random = () => { throw new Error('Math.random is not allowed in a kernel (renders must repeat): use dsp.rng(seed) or dsp.noise(seed)'); };
  const SAFE_MATH = Object.freeze(mathProps);
  const PRE = '"use strict";\nreturn (\n';
  const HEAD = 4; // lines before the kernel's line 1: "function anonymous(...", ") {", and PRE's two lines

  // (the trailing spaces and semicolons go by a walk back from the end: /[\s;]+$/ takes the square of a long run of
  // spaces that isn't at the end, and a kernel of 256 KB of them held the page about 45 s)
  const clean = (src) => {
    const s = String(src || '').replace(/^\s*export\s+default\s+/, '');
    let n = s.length;
    while (n > 0 && (s[n - 1] === ';' || /\s/.test(s[n - 1]))) n--;
    return s.slice(0, n);
  };
  const build = (body) => new Function('dsp', 'Math', 'console', ...SHADOW, body);

  // Which line holds a syntax error: the shortest prefix (in lines) that fails the same way the whole does. Each
  // prefix is a parse, so a line-by-line walk costs the square of the source: it gets a budget of characters parsed
  // (about 60 ms), and past that the rest is bisected (a parse per halving), so a long kernel with a late error can't
  // hold the page. Past 256 KB there's no search at all: the error comes without a line.
  function syntaxLine(src, message) {
    if (src.length > 256 * 1024) return null;
    const lines = src.split('\n');
    const same = (n) => { try { build(PRE + lines.slice(0, n).join('\n') + '\n)'); return false; } catch (e) { return e.message === message; } };
    let budget = 3.5e6, n = 1, at = 0;
    for (; n <= lines.length; n++) {
      at += lines[n - 1].length + 1;
      budget -= at;
      if (budget < 0) break;
      if (same(n)) return n;
    }
    if (n > lines.length) return null;
    let lo = n, hi = lines.length; // the whole fails this way: the first prefix that does is in [lo, hi]
    while (lo < hi) { const mid = (lo + hi) >> 1; if (same(mid)) hi = mid; else lo = mid + 1; }
    return same(lo) ? lo : null;
  }
  // The kernel line a runtime error came from (from its stack), or null.
  function runtimeLine(err) {
    const m = /<anonymous>:(\d+):(\d+)/.exec(String(err && err.stack || ''));
    return m ? Math.max(1, +m[1] - HEAD) : null;
  }
  function fail(message, line) { return { ok: false, error: line ? `line ${line}: ${message}` : message, line: line || null, kernel: null }; }

  // Parse only: builds the function and never calls it, so nothing in the source runs. This is all the main thread
  // ever does with a kernel (host.compileKernel); evaluating it is compile()'s job, and only the worklet calls that.
  function parse(source) {
    const src = clean(source);
    if (!src) return { ...fail('the kernel source is empty: it must be one expression, ({ create({ sr, seed, dsp }) { ... } })'), fn: null };
    try { return { ok: true, error: null, line: null, fn: build(PRE + src + '\n)') }; } catch (e) {
      const line = syntaxLine(src, e.message);
      return { ...fail(`${e.name}: ${e.message}`, line), fn: null };
    }
  }

  function compile(source, kind, consoleImpl) {
    const pr = parse(source);
    if (!pr.ok) return { ok: false, error: pr.error, line: pr.line, kernel: null };
    const fn = pr.fn;
    let k;
    try { k = fn(scope.dsp, SAFE_MATH, consoleImpl || scope.console || null); } catch (e) {
      return fail(`evaluating the kernel threw ${e.name}: ${e.message}`, runtimeLine(e));
    }
    if (!k || typeof k !== 'object') return fail(`the kernel must evaluate to an object like ({ create({ sr, seed, dsp }) { ... } }), got ${k === null ? 'null' : typeof k}`);
    if (typeof k.create !== 'function') return fail('the kernel object has no create({ sr, seed, dsp }) function');
    if (k.poly != null && !(Number.isInteger(k.poly) && k.poly >= 1 && k.poly <= 64)) return fail(`poly must be an integer 1..64 (got ${k.poly})`);
    return { ok: true, error: null, line: null, kernel: k };
  }

  // Check what create() returned against the kind. Returns an error string or null.
  function shape(inst, kind) {
    if (!inst || typeof inst !== 'object') return `create() must return an object (got ${inst === null ? 'null' : typeof inst})`;
    if (kind === 'instrument') {
      if (typeof inst.voice !== 'function') return 'an instrument\'s create() must return { voice(), process?() }: voice() is missing';
      if (inst.process != null && typeof inst.process !== 'function') return 'process must be a function (L, R, n, p, t)';
    } else if (typeof inst.process !== 'function') return 'an effect\'s create() must return { process(L, R, n, p, t) }: process is missing';
    return null;
  }
  function voiceShape(v) {
    if (!v || typeof v !== 'object') return 'voice() must return an object { start(pitch, vel, p), release(p), render(L, R, n, p, t) }';
    for (const m of ['start', 'release', 'render']) if (typeof v[m] !== 'function') return `voice() returned an object without ${m}()`;
    return null;
  }
  return { parse, compile, shape, voiceShape, runtimeLine, HEAD };
}

// The host's logic, free of the AudioWorklet: one KernelCore per node holds the compiled kernel, its voices, the note
// queue, param smoothing and the transport, and renders one block at a time. The worklet processor below wraps it
// (kernel/processor.js), and the canonical Node renderer (engine/node/) runs the very same class, so a
// note, a glide or a stolen voice happens on the same frame in both. Returns the KernelCore class for a sample rate.
//   new KernelCore(processorOptions, post)   post(msg): where messages out go
//   core.msg(d)                               a message in (the same ones node.port takes)
//   core.block(iL, iR, L, R, frame)           render L/R (n = L.length) for the block starting at absolute `frame`
//                                             (iL/iR: the effect's input, or null); false once ended
export function kernelCore(SR, dsp, kernelCompiler) {
  const FADE = Math.round(0.02 * SR);       // hot reload crossfade
  const STEAL = Math.round(0.005 * SR);     // a stolen voice fades out over 5 ms
  const QUIET = Math.round(0.25 * SR);      // a released voice that stays under -100 dBFS this long is freed
  const MAXOUT = 1000;                      // +60 dBFS: past this the kernel has exploded
  const SILENT = { run() {}, allOff() {} };
  // a note's bend or mod at `sec` seconds into it: a number, or a flat [sec, v, sec, v, ...] curve (linear between)
  function curveAt(c, sec) {
    if (c == null) return 0;
    if (typeof c === 'number') return c === c ? c : 0;
    const n = c.length;
    if (n < 2) return 0;
    if (sec <= c[0]) return +c[1] || 0;
    for (let i = 2; i < n; i += 2) {
      if (sec < c[i]) { const a = c[i - 2], b = c[i], u = b > a ? (sec - a) / (b - a) : 1; return (c[i - 1] + (c[i + 1] - c[i - 1]) * u) || 0; }
    }
    return +c[n - 1] || 0;
  }

  class Kernel {
    // One compiled kernel instance and (for instruments) its voices.
    constructor(proc, k, seed) {
      this.proc = proc; this.k = k; this.kind = proc.kind;
      this.inst = k.create({ sr: SR, seed, dsp, params: proc.specs, poly: proc.poly, data: proc.data });
      const bad = proc.C.shape(this.inst, this.kind);
      if (bad) throw new Error(bad);
      this.latency = +this.inst.latency || 0;
      this.voices = [];
      if (this.kind === 'instrument') {
        this.poly = k.poly || proc.poly || 8;
        const n = this.poly + 2; // two spares so a stolen voice can fade while the new one starts
        for (let i = 0; i < n; i++) {
          const v = this.inst.voice(i);
          const vb = proc.C.voiceShape(v);
          if (vb) throw new Error(vb);
          this.voices.push({ v, alive: false, held: false, sus: false, pitch: -1, age: 0, rel: 0, fade: 0, quiet: 0, x: null, f0: 0, onF: 0, relF: -1 });
        }
      }
      this.clock = 0;
    }
    live() { let c = 0; for (const s of this.voices) if (s.alive && !s.fade) c++; return c; }
    noteOn(pitch, vel, p, e) {
      const V = this.voices, pr = this.proc;
      if (this.live() >= this.poly) {
        // steal: the oldest released (or pedal-held) voice, else the oldest
        let pick = null;
        for (const s of V) if (s.alive && !s.fade && (!s.held || s.sus) && (!pick || s.rel < pick.rel)) pick = s;
        if (!pick) for (const s of V) if (s.alive && !s.fade && (!pick || s.age < pick.age)) pick = s;
        if (pick) { pick.fade = STEAL; pick.held = false; pick.sus = false; pr.steals++; }
      }
      let slot = null;
      for (const s of V) if (!s.alive) { slot = s; break; }
      if (!slot) { // every spare is still fading: take the quietest fading one
        for (const s of V) if (s.fade && (!slot || s.fade < slot.fade)) slot = s;
        if (!slot) slot = V[0];
        if (slot.v.stop) slot.v.stop();
      }
      slot.alive = true; slot.held = true; slot.sus = false; slot.pitch = pitch; slot.age = ++this.clock; slot.fade = 0; slot.quiet = 0;
      slot.x = (e && e.x) || null; slot.f0 = e ? e.frame : 0; slot.onF = e ? e.frame : pr.f0; slot.relF = -1;
      if (slot.x) this.exprFor(slot, slot.f0, pr.t);
      slot.v.start(pitch, vel, p);
      if (slot.x) { pr.t.bend = pr.x.bend; pr.t.mod = pr.x.mod; }
      pr.notes++;
    }
    noteOff(pitch, p) {
      let pick = null;
      for (const s of this.voices) if (s.alive && s.held && !s.sus && !s.fade && s.pitch === pitch && (!pick || s.age < pick.age)) pick = s;
      if (!pick) return;
      if (this.proc.x.sustain) { pick.sus = true; pick.rel = ++this.clock; return; } // the pedal holds it
      pick.held = false; pick.rel = ++this.clock; pick.relF = this.proc.f0; pick.v.release(p);
    }
    allOff(p) {
      for (const s of this.voices) if (s.alive && s.held) { s.held = false; s.sus = false; s.rel = ++this.clock; s.relF = this.proc.f0; s.v.release(p); }
    }
    // The watchdog (see 'watch' in the header). F: the frame it looks from. Returns [{ why, p, n }].
    watch(open, F, ring, queuedOff, p) {
      const out = [], by = new Map(), sus = this.proc.x.sustain;
      for (const s of this.voices) {
        if (!s.alive || s.fade) continue;
        if (s.held) {
          if ((s.sus && sus) || s.onF > F || queuedOff(s.pitch)) continue;
          if (!by.has(s.pitch)) by.set(s.pitch, []);
          by.get(s.pitch).push(s);
        } else if (ring > 0 && s.relF >= 0 && F - s.relF > ring * SR) {
          s.fade = STEAL; s.sus = false;
          out.push({ why: 'ring', p: s.pitch, n: 1 });
        }
      }
      for (const [pitch, vs] of by) {
        const extra = vs.length - (+open[pitch] || 0);
        if (extra <= 0) continue;
        vs.sort((a, b) => a.age - b.age);
        for (let i = 0; i < extra; i++) { const s = vs[i]; s.held = false; s.sus = false; s.rel = ++this.clock; s.relF = this.proc.f0; s.v.release(p); }
        out.push({ why: 'held', p: pitch, n: extra });
      }
      return out;
    }
    // the channel's expression changes (an 'x' event): the pedal lifting releases what it held
    expr(e, p) {
      const pr = this.proc, x = pr.x;
      if (e.bend !== undefined) x.bend = e.bend;
      if (e.mod !== undefined) x.mod = e.mod;
      if (e.sustain !== undefined) {
        x.sustain = e.sustain;
        if (!x.sustain) for (const s of this.voices) if (s.alive && s.sus) { s.sus = false; s.held = false; s.rel = ++this.clock; s.relF = this.proc.f0; s.v.release(p); }
      }
      pr.t.bend = x.bend; pr.t.mod = x.mod; pr.t.sustain = x.sustain;
    }
    // t.bend / t.mod for one voice at absolute frame F: the channel's plus the note's own curve
    exprFor(s, F, t) {
      const x = this.proc.x, sec = (F - s.f0) / SR;
      t.bend = x.bend + curveAt(s.x.bend, sec);
      const m = x.mod + curveAt(s.x.mod, sec);
      t.mod = m < 0 ? 0 : m > 1 ? 1 : m;
    }
    // Render voices into L/R over frames [a, b) (L/R are the block's buffers, already holding earlier frames).
    voicesInto(L, R, a, b, p, t) {
      const m = b - a, pr = this.proc, sl = pr.sL, sr = pr.sR, V = this.voices, F = pr.f0 + a;
      let xs = false;
      for (let vi = 0; vi < V.length; vi++) {
        const s = V[vi];
        if (!s.alive) continue;
        for (let i = 0; i < m; i++) { sl[i] = 0; sr[i] = 0; }
        if (s.x) { this.exprFor(s, F, t); xs = true; } else if (xs) { t.bend = pr.x.bend; t.mod = pr.x.mod; xs = false; }
        const more = s.v.render(sl, sr, m, p, t);
        let pk = 0;
        if (s.fade) {
          for (let i = 0; i < m; i++) {
            const g = s.fade > 0 ? s.fade / STEAL : 0;
            if (s.fade > 0) s.fade--;
            const x = sl[i] * g, y = sr[i] * g;
            L[a + i] += x; R[a + i] += y;
          }
          if (s.fade <= 0) { s.alive = false; s.fade = 0; s.sus = false; if (s.v.stop) s.v.stop(); }
          continue;
        }
        for (let i = 0; i < m; i++) {
          const x = sl[i], y = sr[i];
          L[a + i] += x; R[a + i] += y;
          const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
          if (ax > pk) pk = ax; if (ay > pk) pk = ay;
        }
        if (more === false || (more !== true && more !== undefined && !more)) { s.alive = false; s.held = false; s.sus = false; continue; }
        if (!s.held) {
          if (pk < 1e-5) { s.quiet += m; if (s.quiet >= QUIET) { s.alive = false; } } else s.quiet = 0;
        }
      }
      if (xs) { t.bend = pr.x.bend; t.mod = pr.x.mod; }
    }
    // A whole block of this kernel into L/R (effects: L/R hold the input; instruments: L/R are zero).
    run(L, R, n, p, t, events) {
      if (this.kind === 'effect') { this.inst.process(L, R, n, p, t); return; }
      let pos = 0;
      if (events) {
        const q = events.q;
        while (events.i < q.length && q[events.i].f < n) {
          const e = q[events.i++];
          const at = e.f < 0 ? 0 : e.f;
          if (at > pos) { this.voicesInto(L, R, pos, at, p, t); pos = at; }
          if (e.type === 'on') this.noteOn(e.p, e.v, p, e);
          else if (e.type === 'off') this.noteOff(e.p, p);
          else if (e.type === 'x') this.expr(e, p);
          else this.allOff(p);
        }
      }
      if (pos < n) this.voicesInto(L, R, pos, n, p, t);
      if (this.inst.process) this.inst.process(L, R, n, p, t);
      let c = 0; const V = this.voices;
      for (let vi = 0; vi < V.length; vi++) if (V[vi].alive) c++;
      if (c > this.proc.maxVoices) this.proc.maxVoices = c;
    }
  }

  class KernelCore {
    constructor(o, post) {
      o = o || {};
      this.post = post;
      this.kind = o.kind === 'instrument' ? 'instrument' : 'effect';
      this.specs = o.params || [];
      this.poly = o.poly || 0;
      this.seed = (o.seed >>> 0) || 1;
      this.logs = 0;
      const self = this;
      this.console = { log(...a) { self.log(a); }, warn(...a) { self.log(a); }, error(...a) { self.log(a); } };
      this.C = kernelCompiler({ dsp, console: this.console });
      // params: current (smoothed) values in p, targets in tgt
      this.p = {}; this.tgt = {}; this.cont = []; this.logc = [];
      for (const s of this.specs) {
        const v = o.values && o.values[s.key] != null ? +o.values[s.key] : s.def;
        this.p[s.key] = this.tgt[s.key] = this.fit(s, v);
        if (!(s.step > 0) && !s.opts) { this.cont.push(s.key); this.logc.push(s.curve === 'log' && s.min > 0); }
      }
      // automation: key -> { q: [segments by start frame], cur, done, s: spec, log, snap }; stat: the 'params' value of
      // an automated key (what it returns to when released)
      this.au = new Map(); this.stat = {};
      this.blockA = 0;
      this.nextF = 0;    // the first frame of the next block (where a release asked for now lands)
      // transport
      const tr = o.transport || {};
      this.t = { bpm: tr.bpm || 120, playing: !!tr.playing, beat: tr.beat || 0, bend: 0, mod: 0, sustain: false };
      this.x = { bend: 0, mod: 0, sustain: false }; // the channel's expression (t carries it, per voice in render)
      this.f0 = 0;       // the absolute frame of the block being rendered
      this.anchor = { bpm: this.t.bpm, playing: this.t.playing, beat: this.t.beat, time: tr.time || 0 };
      // event queue (frames)
      this.ev = { q: [], i: 0 };
      this.steals = 0; this.maxVoices = 0; this.notes = 0; this.stuck = 0;
      this.sL = new Float32Array(128); this.sR = new Float32Array(128);
      this.fL = new Float32Array(128); this.fR = new Float32Array(128);
      this.cur = null; this.old = null; this.fade = 0; this.faulted = false; this.ended = false; this.sleeping = false;
      this.idle = !!o.idle; this.dozing = false; this.quiet = 0;
      this.data = o.data || null; this.source = null;
      this.hold = Math.round(Math.max(0.5, Math.min(10, o.tail == null ? 2 : +o.tail || 0)) * SR);
      this.version = 0;
      this.load(o.source, null);
    }
    // insert an event in (frame, ord) order after the read index
    enqueue(e) {
      const q = this.ev.q, f = e.frame, ord = e.ord;
      if (this.ev.i > 64) { q.splice(0, this.ev.i); this.ev.i = 0; }
      let j = q.length;
      while (j > this.ev.i && (q[j - 1].frame > f || (q[j - 1].frame === f && q[j - 1].ord > ord))) j--;
      q.splice(j, 0, e);
    }
    log(args) {
      if (this.logs++ >= 20) return;
      try { this.post({ type: 'log', args: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))) }); } catch (e) { /* unclonable */ }
    }
    fit(s, v) {
      if (!Number.isFinite(v)) v = s.def;
      const lo = Math.min(s.min, s.max), hi = Math.max(s.min, s.max);
      v = v < lo ? lo : v > hi ? hi : v;
      if (s.step > 0) v = s.min + Math.round((v - s.min) / s.step) * s.step;
      return v;
    }
    load(source, id) {
      const r = this.C.compile(source, this.kind, this.console);
      if (!r.ok) { this.post({ type: 'error', stage: 'compile', message: r.error, line: r.line, id }); return false; }
      let k;
      try { k = new Kernel(this, r.kernel, this.seed); } catch (e) {
        const line = this.C.runtimeLine(e);
        this.post({ type: 'error', stage: 'compile', message: (line ? `line ${line}: ` : '') + `create() failed: ${e.message}`, line, id });
        return false;
      }
      if (this.cur && !this.faulted) {
        this.old = this.cur; this.old.allOff(this.p); this.fade = FADE; // (a reload mid-fade drops the oldest)
      } else if (this.cur) { this.old = SILENT; this.fade = FADE; } // back from a fault: fade in from silence
      this.cur = k; this.faulted = false; this.version++; this.source = source;
      this.post({ type: 'ready', id, latency: k.latency, poly: k.poly || 0, version: this.version });
      return true;
    }
    msg(d) {
      if (!d || typeof d !== 'object') return;
      switch (d.type) {
        case 'params': {
          const vals = d.values || {};
          for (const s of this.specs) if (vals[s.key] != null) {
            const v = this.fit(s, +vals[s.key]);
            if (this.au.has(s.key)) { this.stat[s.key] = v; continue; } // (its lane plays: kept for later)
            this.tgt[s.key] = v;
            if (d.jump || s.step > 0 || s.opts) this.p[s.key] = v; // switches and stepped params snap
          }
          break;
        }
        case 'on': case 'off': case 'alloff': {
          const f = Math.round((+d.time || 0) * SR);
          const ord = d.type === 'alloff' ? 0 : d.type === 'off' ? 1 : 2;
          const ev = { type: d.type, p: d.p | 0, v: d.v == null ? 0.8 : +d.v, frame: f, ord, f: 0, x: null };
          if (d.type === 'on' && d.x && typeof d.x === 'object' && (d.x.bend != null || d.x.mod != null)) ev.x = { bend: d.x.bend, mod: d.x.mod };
          this.enqueue(ev);
          break;
        }
        case 'expr': {
          const e = { type: 'x', p: 0, v: 0, frame: Math.round((+d.time || 0) * SR), ord: 0.5, f: 0, bend: undefined, mod: undefined, sustain: undefined };
          if (typeof d.bend === 'number' && d.bend === d.bend) e.bend = d.bend < -48 ? -48 : d.bend > 48 ? 48 : d.bend;
          if (typeof d.mod === 'number' && d.mod === d.mod) e.mod = d.mod < 0 ? 0 : d.mod > 1 ? 1 : d.mod;
          if (d.sustain != null) e.sustain = !!d.sustain;
          if (this.kind === 'effect') { // (effects see the channel's expression in t from the next block)
            if (e.bend !== undefined) this.x.bend = e.bend;
            if (e.mod !== undefined) this.x.mod = e.mod;
            if (e.sustain !== undefined) this.x.sustain = e.sustain;
            this.t.bend = this.x.bend; this.t.mod = this.x.mod; this.t.sustain = this.x.sustain;
          } else this.enqueue(e);
          break;
        }
        case 'cancel': {
          const q = this.ev.q, p = d.p | 0, f = Math.round((+d.time || 0) * SR);
          const find = (type, fr) => { for (let j = this.ev.i; j < q.length; j++) if (q[j].type === type && q[j].p === p && q[j].frame === fr) return j; return -1; };
          const fo = d.off == null ? null : Math.round(+d.off * SR);
          const jo = fo == null ? -1 : find('off', fo);
          if (jo >= 0) q.splice(jo, 1);
          // `to`: only its release moves
          if (d.to != null) { this.enqueue({ type: 'off', p, v: 0, frame: Math.max(this.nextF, Math.round(+d.to * SR)), ord: 1, f: 0 }); break; }
          const j = find('on', f);
          if (j >= 0) { q.splice(j, 1); break; } // (still queued: it never sounds)
          // already sounding: release it now
          this.enqueue({ type: 'off', p, v: 0, frame: this.nextF, ord: 1, f: 0 });
          break;
        }
        case 'flush': {
          // (expression events stay: the channel's pedal and wheels keep their state)
          const q = this.ev.q, f = Math.round((+d.time || 0) * SR);
          for (let j = q.length - 1; j >= this.ev.i; j--) if (q[j].frame >= f && q[j].type !== 'x') q.splice(j, 1);
          break;
        }
        case 'watch': {
          const k = this.cur;
          if (!k || this.faulted || k.kind !== 'instrument' || this.anchor.playing) break;
          const q = this.ev.q, i0 = this.ev.i;
          const queuedOff = (pitch) => { for (let j = i0; j < q.length; j++) if ((q[j].type === 'off' && q[j].p === pitch) || q[j].type === 'alloff') return true; return false; };
          const got = k.watch(d.open || {}, Math.round((+d.time || 0) * SR), +d.ring || 0, queuedOff, this.p);
          for (const g of got) { this.stuck += g.n; this.post({ type: 'stuck', why: g.why, p: g.p, n: g.n }); }
          if (got.length) { this.dozing = false; this.quiet = 0; }
          break;
        }
        case 'auto': this.autoAdd(d); break;
        case 'auto.clear': {
          const f = Math.round((+d.from || 0) * SR);
          for (const [k, A] of this.au) {
            if (d.key != null && k !== d.key) continue;
            if (d.release) { this.autoRelease(k); continue; }
            A.q = A.q.filter((g) => g.s < f);
          }
          break;
        }
        case 'auto.stop': for (const k of [...this.au.keys()]) this.autoRelease(k); break;
        case 'transport':
          this.anchor = { bpm: +d.bpm || 120, playing: !!d.playing, beat: +d.beat || 0, time: +d.time || 0 };
          break;
        case 'code': this.load(d.source, d.id); break;
        case 'data': this.data = d.data || null; if (this.source != null) this.load(this.source, null); break;
        case 'sleep': this.sleeping = !!d.on; break;
        case 'stats':
          this.post({ type: 'stats', voices: this.cur ? this.cur.voices.filter((s) => s.alive).length : 0, held: this.cur ? this.cur.voices.filter((s) => s.alive && s.held && !s.fade).length : 0, stuck: this.stuck, maxVoices: this.maxVoices, steals: this.steals, notes: this.notes, faulted: this.faulted, version: this.version, dozing: this.dozing,
            list: this.cur ? this.cur.voices.filter((s) => s.alive && !s.fade).map((s) => ({ p: s.pitch, held: s.held, sus: s.sus, on: s.onF, rel: s.relF })) : [], frame: this.f0 });
          break;
        case 'sync': this.post({ type: 'synced', id: d.id }); break;
        case 'end': this.ended = true; break;
        default: break;
      }
    }
    // an 'auto' message: a segment in frames, queued by its start (ties: in arrival order)
    autoAdd(d) {
      const s = this.specs.find((x) => x.key === d.key);
      if (!s) return;
      let A = this.au.get(s.key);
      if (!A) {
        // snap: the param isn't smoothed (any step), its value lands as it is; steps: its lane only steps (a switch, or a
        // whole-number param of up to 24 steps: core/automation.js discrete, transcribed)
        A = { q: [], cur: null, done: false, s, log: s.curve === 'log' && s.min > 0 && s.max > s.min, snap: s.step > 0 || !!s.opts,
          steps: !!s.opts || (s.step >= 1 && Math.floor(s.step) === s.step && Math.abs(s.max - s.min) / s.step <= 24) };
        this.au.set(s.key, A);
        this.stat[s.key] = this.tgt[s.key];
      }
      const f0 = Math.round((+d.time || 0) * SR), f1 = Math.max(f0, Math.round((d.end == null ? +d.time || 0 : +d.end) * SR));
      const st = d.start == null ? f0 : Math.round(+d.start * SR);
      const num = (x) => { x = +x; return x === x ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0; };
      const c = d.c === 'step' || A.steps ? 'step' : (typeof d.c === 'number' && d.c === d.c ? (d.c < -1 ? -1 : d.c > 1 ? 1 : d.c) : 0);
      const g = { s: st, f0, f1, a: num(d.a), b: num(d.b), c };
      const q = A.q;
      let j = q.length;
      while (j > 0 && q[j - 1].s > st) j--;
      q.splice(j, 0, g);
    }
    autoRelease(k) {
      const A = this.au.get(k);
      if (!A) return;
      this.au.delete(k);
      const v = this.stat[k];
      delete this.stat[k];
      if (v != null) { this.tgt[k] = v; if (A.snap) this.p[k] = v; }
    }
    // Each automated key's target at frame F (the start of the block): the latest segment that has started, at F.
    autoRun(F) {
      for (const A of this.au.values()) {
        const q = A.q;
        let moved = false;
        while (q.length && q[0].s <= F) { A.cur = q.shift(); moved = true; }
        const g = A.cur;
        if (!g || (A.done && !moved)) continue;
        let pos;
        if (F >= g.f1) { pos = g.b; A.done = true; } else {
          A.done = false;
          const x = F <= g.f0 ? 0 : (F - g.f0) / (g.f1 - g.f0), c = g.c;
          const y = c === 'step' ? 0 : c > 0 ? Math.pow(x, 1 + 3 * c) : c < 0 ? 1 - Math.pow(1 - x, 1 - 3 * c) : x;
          pos = g.a + (g.b - g.a) * y;
        }
        const s = A.s, v = this.fit(s, A.log ? s.min * Math.pow(s.max / s.min, pos) : s.min + pos * (s.max - s.min));
        this.tgt[s.key] = v;
        if (A.snap) this.p[s.key] = v;
      }
    }
    smoothParams(n) {
      const a = 1 - Math.exp(-n / (0.01 * SR)), p = this.p, tg = this.tgt, keys = this.cont, lg = this.logc;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i], v = p[k], t = tg[k];
        if (v === t) continue;
        let nv = lg[i] ? v * Math.pow(t / v, a) : v + a * (t - v);
        if (Math.abs(nv - t) <= Math.abs(t) * 1e-5 + 1e-9) nv = t;
        p[k] = nv;
      }
    }
    fault(e, what) {
      this.faulted = true;
      const line = e ? this.C.runtimeLine(e) : null;
      const message = (line ? `line ${line}: ` : '') + (e ? `${what} threw ${e.name}: ${e.message}` : what);
      this.post({ type: 'error', stage: 'process', message, line });
    }
    block(iL, iR, L, R, f0) {
      if (this.ended) return false;
      const n = L.length;
      if (this.sL.length < n) { this.sL = new Float32Array(n); this.sR = new Float32Array(n); this.fL = new Float32Array(n); this.fR = new Float32Array(n); }
      // transport at the start of this block
      const an = this.anchor, t = this.t, now = f0 / SR;
      t.bpm = an.bpm; t.playing = an.playing;
      t.beat = an.playing ? an.beat + (now - an.time) * an.bpm / 60 : an.beat;
      this.nextF = f0 + n; this.f0 = f0;
      if (this.au.size) this.autoRun(f0);
      // event frames relative to this block
      const q = this.ev.q;
      for (let j = this.ev.i; j < q.length; j++) q[j].f = q[j].frame - f0;
      if (this.faulted || this.sleeping || !this.cur) {
        L.fill(0); if (R !== L) R.fill(0);
        // keep the queue moving so stale notes don't fire later
        while (this.ev.i < q.length && q[this.ev.i].f < n) {
          const e = q[this.ev.i++];
          if (e.type === 'x') { const x = this.x; if (e.bend !== undefined) x.bend = e.bend; if (e.mod !== undefined) x.mod = e.mod; if (e.sustain !== undefined) x.sustain = e.sustain; t.bend = x.bend; t.mod = x.mod; t.sustain = x.sustain; }
        }
        return true;
      }
      const eff = this.cur.kind === 'effect';
      // idle: is anything coming in? (dozing, nothing is: silence out, nothing run)
      let busy = true;
      if (this.idle && !this.old) {
        if (eff) {
          busy = false;
          if (iL) for (let i = 0; i < n; i++) if (iL[i] !== 0 || iR[i] !== 0) { busy = true; break; }
        } else {
          busy = this.ev.i < q.length && q[this.ev.i].f < n;
          if (!busy) { const V = this.cur.voices; for (let vi = 0; vi < V.length; vi++) if (V[vi].alive) { busy = true; break; } }
        }
        if (busy) { this.dozing = false; this.quiet = 0; } else if (this.dozing) { L.fill(0); if (R !== L) R.fill(0); return true; }
      }
      this.smoothParams(n);
      const p = this.p;
      if (eff) { if (iL) { L.set(iL); if (R !== L) R.set(iR); } else { L.fill(0); if (R !== L) R.fill(0); } }
      else { L.fill(0); if (R !== L) R.fill(0); }
      if (this.old) {
        const fl = this.fL, fr = this.fR;
        if (eff && iL) { fl.set(iL); fr.set(iR); } else { fl.fill(0); fr.fill(0); }
        try { this.old.run(fl, fr, n, p, t, null); } catch (e) { this.old = null; }
      }
      try {
        this.cur.run(L, R, n, p, t, eff ? null : this.ev);
      } catch (e) {
        this.fault(e, eff ? 'process()' : 'render()/process()');
        L.fill(0); if (R !== L) R.fill(0); this.old = null;
        return true;
      }
      if (this.old) {
        const fl = this.fL, fr = this.fR;
        for (let i = 0; i < n; i++) {
          const g = this.fade > 0 ? 1 - this.fade / FADE : 1;
          if (this.fade > 0) this.fade--;
          L[i] = L[i] * g + fl[i] * (1 - g);
          if (R !== L) R[i] = R[i] * g + fr[i] * (1 - g);
        }
        if (this.fade <= 0) this.old = null;
      }
      // NaN / Infinity / explosion guard
      let pk = 0;
      for (let i = 0; i < n; i++) {
        const a = L[i], b = R[i];
        if (a !== a || b !== b) { pk = Infinity; break; }
        const x = a < 0 ? -a : a, y = b < 0 ? -b : b;
        if (x > pk) pk = x; if (y > pk) pk = y;
      }
      if (!(pk <= MAXOUT)) {
        this.fault(null, pk === Infinity ? 'the output went NaN or Infinity (check divisions, feedback, filter settings)' : 'the output exploded past +60 dBFS (runaway feedback or an unstable filter?)');
        L.fill(0); if (R !== L) R.fill(0); this.old = null;
      }
      if (!busy) { if (pk < 1e-5) { this.quiet += n; if (this.quiet >= this.hold) this.dozing = true; } else this.quiet = 0; }
      return true;
    }
  }
  return KernelCore;
}

// The processor. Runs inside the AudioWorkletGlobalScope (kernel/processor.js calls it there): a thin wrapper that
// hands each render quantum to a KernelCore.
export function overdubKernelWorklet(overdubDsp, kernelCompiler, kernelCore) {
  const KernelCore = kernelCore(sampleRate, overdubDsp(sampleRate), kernelCompiler);
  // kernel data, decoded once in this audio context: hash -> the decoded file (or null: it didn't decode)
  const DATA = new Map();
  // Processors that were handed a hash whose bytes haven't landed: the first node to need a file carries its bytes, the
  // rest only its hash, and messages on different nodes' ports keep no order between them, so a second kit track's
  // hash can arrive before the first one's bytes. hash -> the processors waiting; each is given its data again (its
  // kernel created again) when the bytes land.
  const WAIT = new Map();
  // { out: { [name]: decoded | null }, fresh: [hashes decoded just now] }
  const open = (d, proc) => {
    const fresh = [];
    if (!d || typeof d !== 'object') return { out: null, fresh };
    const out = {};
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (!v || typeof v.hash !== 'string') { out[k] = null; continue; }
      if (!DATA.has(v.hash)) {
        if (v.bytes) { let x = null; try { x = decodeOdk(v.bytes); } catch (e) { /* not a kit file: nothing */ } DATA.set(v.hash, x); fresh.push(v.hash); }
        else if (proc) { let w = WAIT.get(v.hash); if (!w) WAIT.set(v.hash, (w = new Set())); w.add(proc); }
      }
      out[k] = DATA.get(v.hash) || null;
    }
    return { out, fresh };
  };
  const landed = (hashes) => {
    for (const h of hashes) {
      const w = WAIT.get(h);
      if (!w) continue;
      WAIT.delete(h);
      for (const p of w) p.give(p.raw);
    }
  };
  class OverdubKernel extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const port = this.port;
      const o = (options && options.processorOptions) || {};
      this.raw = o.data || null;
      const r = o.data ? open(o.data, this) : null;
      this.core = new KernelCore(r ? { ...o, data: r.out } : o, (m) => port.postMessage(m));
      if (r) landed(r.fresh);
      port.onmessage = (e) => { const d = e.data; if (d && d.type === 'data') this.give(d.data); else this.core.msg(d); };
    }
    // (new) kernel data: decode what came with it, create the kernel again with it, and wake whoever waited on it
    give(raw) {
      this.raw = raw || null;
      const r = open(this.raw, this);
      this.core.msg({ type: 'data', data: r.out });
      landed(r.fresh);
    }
    process(inputs, outputs) {
      const core = this.core;
      if (core.ended) return false;
      const out = outputs[0];
      if (!out || !out.length) return true;
      const inp = inputs[0];
      return core.block(inp && inp[0], inp && (inp[1] || inp[0]), out[0], out[1] || out[0], currentFrame);
    }
  }
  registerProcessor('overdub-kernel', OverdubKernel);
}
