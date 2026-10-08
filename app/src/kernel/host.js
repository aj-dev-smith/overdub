// @ts-check
// The main-thread side of kernels: load the processor once per context, make Instances, check source.
//
//   ensureKernelWorklet(c)            Promise<true>: the kernel processor (kernel/processor.js, with the dsp stdlib)
//                                     on AudioContext or OfflineAudioContext `c`, loaded once, from its file
//   kernelInstance(c, def, opts)      Promise<Instance> (docs/ARCHITECTURE.md "Instance"); registry.instantiate()
//                                     calls this for every def with a `kernel` string
//   compileKernel(source)             { ok, error, line }: a fast main-thread syntax check with a message an agent
//                                     can act on ("line 12: SyntaxError: Unexpected token ')'"). Parse only: it never
//                                     runs the kernel. Shape errors (no create(), bad poly, Math.random) come from
//                                     the worklet, as a compile-stage error that rejects `ready`.
//
// Kernel code is evaluated only inside the AudioWorklet (and the Node renderer), never on the page: a kernel can
// arrive from a share link, a device file or an agent, and the worklet scope has no DOM, no localStorage (the
// person's songs and settings) and no network. The shadowed names in worklet.js are not a boundary; that scope is.
//
// Instance extras beyond the contract: errors (every error the worklet reported), faulted, version,
// on('error' | 'log' | 'ready' | 'stuck', fn) -> off, stats() -> Promise<{ voices, held, maxVoices, steals, notes, stuck }>,
// flush(time) (every queued note at or after `time` is dropped: the engine's stop, before allOff), stuck (how many
// voices the watchdog let go).
//
// The watchdog (instruments, live). The host keeps a ledger of the notes it has handed the worklet (ons, offs, allOffs,
// cancels and flushes, by time), so it knows which notes are still open. While the transport is stopped and nothing
// is in flight, it sends the worklet the open notes every 250 ms; a held voice beyond them is released with its
// normal release, and a released voice still sounding well past its release (the device's tail or its release
// param, whichever is longer, plus 1 s) is faded out. Neither should ever happen (stop flushes and releases, note-offs
// are never dropped): it is the last resort, and each catch is a 'stuck' event, logged on a dev host.
// Automation (docs/research/AUTOMATION.md 3.5): auto({ key, time, end, a, b, c, start? }) hands one lane segment
// (AudioContext seconds, a and b in knob travel) to the worklet, evaluated per block inside KernelCore; while a key
// follows a lane, set() leaves it alone. autoClear(key | null, from, release?) drops what was queued from `from`
// (release: the key goes back to set()'s value); autoStop() drops everything and releases every key.
// Keys (docs/DEVICES.md "Keys"): an effect whose def says key: true gets keyInput (a GainNode into the worklet's second
// input, which the engine connects another track's sound to) and setKey(on) (whether a key is wired: t.key.on).
// Expression (kernel/expr.js, docs/DEVICES.md "Expression"): noteOn(pitch, vel, time, x) takes the note's own
// { bend, mod } (from noteExpr), and expr({ bend?, mod?, sustain? }, time) sets the channel's.
// Kernel data (docs/DEVICES.md "Kernel data"): a def whose `data` names files ({ kit: 'sha256-<hex>' }) gets them in
// create({ data }). They're fetched when the first instance is built (kernel/data.js). An offline context waits for
// them before it renders (nothing streams mid-render); a live one starts at once with data null (silence) and the
// kernel is created again when they arrive. inst.data = { state: 'loading' | 'ready' | 'missing', hashes };
// on('data', fn) hears it change. A missing file stays missing: the kernel gets null and plays nothing.
import { kernelCompiler } from './worklet.js';
import { normParam, paramValues, seedOf } from '../devices/registry.js';
import { chanExpr } from './expr.js';
import { loadData, peekData } from './data.js';
import { normData } from './odk.js';

const loaded = new WeakMap();
// the watchdog's catches go to the console on a dev host (they mean a stop or a note-off went wrong somewhere)
const DEV = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname || '');
// The kernel processor's module: a file on the page's own origin, as every worklet module is (the pages' policy
// refuses data: and blob: scripts, so a worklet can't be made from a string)
const PROCESSOR = new URL('./processor.js', import.meta.url).href;

export function ensureKernelWorklet(c) {
  if (!c || !c.audioWorklet)
    return Promise.reject(new Error('kernels need AudioWorklet (a current browser, in a secure context)'));
  let p = loaded.get(c);
  if (!p) {
    p = c.audioWorklet.addModule(PROCESSOR).then(
      () => true,
      (e) => {
        loaded.delete(c);
        throw new Error('could not load the kernel worklet: ' + (e && e.message));
      },
    );
    loaded.set(c, p);
  }
  return p;
}

let compiler = null;
// Syntax check on the main thread: parse only. Never evaluate untrusted kernel source here (see the header).
export function compileKernel(source) {
  if (!compiler) compiler = kernelCompiler({ dsp: null, console: null });
  const r = compiler.parse(source);
  return { ok: r.ok, error: r.error, line: r.line };
}

const isOffline = (c) => typeof c.startRendering === 'function';

// Which data files each context's worklet has been sent (the first node to need one carries the bytes; the worklet
// keeps them for every node after, so 30 MB isn't copied per track).
const sent = new WeakMap();
// processorOptions.data for these files: { [name]: { hash, bytes? } | null }
function dataOptions(c, files, have) {
  let s = sent.get(c);
  if (!s) {
    s = new Set();
    sent.set(c, s);
  }
  const out = {};
  for (const [k, hash] of Object.entries(files)) {
    const bytes = have[k];
    if (!bytes) {
      out[k] = null;
      continue;
    }
    if (s.has(hash)) out[k] = { hash };
    else {
      out[k] = { hash, bytes };
      s.add(hash);
    }
  }
  return out;
}

// Offline renders: an OfflineAudioContext renders without yielding, so messages posted just before startRendering()
// (notes, params) can land after the frames they were meant for. Every offline context that hosts kernels gets one
// suspend at time 0; there we wait until each kernel has acknowledged everything posted to it, then resume. (So
// don't schedule your own suspend at exactly 0 on a context that hosts kernels.)
const barriers = new WeakMap();
function offlineBarrier(c, inst) {
  let b = barriers.get(c);
  if (!b) {
    b = { insts: new Set() };
    barriers.set(c, b);
    try {
      c.suspend(0).then(
        async () => {
          await Promise.all([...b.insts].map((i) => i.sync()));
          await c.resume();
        },
        () => {},
      );
    } catch (e) {
      /* already rendering: nothing to line up */
    }
  }
  b.insts.add(inst);
  return () => b.insts.delete(inst);
}

// The param specs a KernelCore takes (processorOptions.params), from a def. Shared with the Node renderer.
export function kernelSpecs(def) {
  return (def.params || [])
    .map(normParam)
    .map(({ key, min, max, def: d, step, curve, opts: o }) => ({
      key,
      min,
      max,
      def: d,
      step,
      curve,
      opts: o ? o.length : undefined,
    }));
}

// opts: { uid, seed, clock, params, on = true, bpm? }
export async function kernelInstance(c, def, opts = {}) {
  await ensureKernelWorklet(c);
  const kind = def.kind === 'instrument' ? 'instrument' : 'effect';
  const specs = kernelSpecs(def);
  const ndef = { params: specs };
  const values = paramValues(ndef, opts.params || {});
  const seed = (opts.seed != null ? opts.seed : seedOf(opts.uid || def.id)) >>> 0;
  const clock = opts.clock || null;
  const offline = isOffline(c);
  const transport = () => {
    const now = c.currentTime;
    let bpm = opts.bpm || 120,
      playing = offline,
      beat = 0;
    try {
      if (clock) {
        if (clock.bpm) bpm = +clock.bpm() || bpm;
        if (clock.playing) playing = !!clock.playing();
        if (clock.beatAt) beat = +clock.beatAt(now) || 0;
        else if (clock.barAt) beat = (+clock.barAt(now) || 0) * (clock.beatsPerBar ? +clock.beatsPerBar() || 4 : 4);
      }
    } catch (e) {
      /* a clock mid-rebuild: keep the defaults */
    }
    return { bpm, playing, beat, time: now };
  };

  // kernel data: what's here now (an offline render waits for all of it; live, what is still loading comes later)
  const files = normData(def.data);
  const have = {};
  let waiting = null;
  if (files) {
    for (const [k, hash] of Object.entries(files)) have[k] = peekData(hash);
    const missing = Object.entries(files).filter(([k]) => !have[k]);
    if (missing.length) {
      const all = Promise.all(
        missing.map(([k, hash]) =>
          loadData(hash).then((b) => {
            have[k] = b;
          }),
        ),
      );
      if (offline) await all;
      else waiting = all;
    }
  }
  const dataNow = () => {
    if (!files) return null;
    const vals = Object.keys(files).map((k) => have[k]);
    return { state: vals.every(Boolean) ? 'ready' : waiting ? 'loading' : 'missing', hashes: { ...files } };
  };

  // a keyed effect (def.key: true) has a second input, its key: the engine wires another track's sound to
  // inst.keyInput and says so with inst.setKey(true) (t.key.on in the kernel)
  const keyed = kind === 'effect' && def.key === true;
  const node = new AudioWorkletNode(c, 'overdub-kernel', {
    numberOfInputs: kind === 'effect' ? (keyed ? 2 : 1) : 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      source: def.kernel,
      kind,
      params: specs,
      values,
      poly: def.poly,
      seed,
      transport: transport(),
      idle: !offline,
      tail: def.tail,
      ...(keyed ? { key: true, keyOn: false } : {}),
      ...(files ? { data: dataOptions(c, files, have) } : {}),
    },
  });

  const listeners = {
    error: new Set(),
    log: new Set(),
    ready: new Set(),
    stats: new Set(),
    stuck: new Set(),
    data: new Set(),
  };
  const emit = (type, d) => {
    for (const fn of listeners[type] || []) {
      try {
        fn(d);
      } catch (e) {
        console.error(e);
      }
    }
  };
  const pending = new Map(); // reload ids -> { resolve, reject }
  const syncs = new Map();
  let reqId = 0,
    latencySamples = 0,
    version = 0;

  let readyRes, readyRej;
  const ready = new Promise((res, rej) => {
    readyRes = res;
    readyRej = rej;
  });
  ready.catch(() => {}); // a compile error is reported through `ready` / errors; never an unhandled rejection

  const inst = {
    def,
    uid: opts.uid || null,
    ready,
    data: null,
    input: null,
    output: null,
    errors: [],
    faulted: false,
    version: 0,
    // (bypassed, an effect is its dry path: delayed by the declared latency, whatever the kernel reports)
    get latency() {
      return kind === 'effect' && !on ? +def.latency || 0 : (latencySamples || 0) / c.sampleRate || +def.latency || 0;
    },
  };

  node.port.onmessage = (e) => {
    const d = e.data || {};
    if (d.type === 'ready') {
      latencySamples = d.latency || 0;
      version = d.version;
      inst.version = version;
      inst.faulted = false;
      inst.poly = d.poly || 0;
      if (d.id != null && pending.has(d.id)) {
        pending.get(d.id).resolve(d);
        pending.delete(d.id);
      }
      if (d.version === 1) readyRes(inst);
      emit('ready', d);
    } else if (d.type === 'error') {
      const err = { stage: d.stage, message: d.message, line: d.line || null, at: c.currentTime };
      inst.errors.push(err);
      if (inst.errors.length > 50) inst.errors.shift();
      if (d.stage === 'process') inst.faulted = true;
      if (d.id != null && pending.has(d.id)) {
        pending.get(d.id).reject(Object.assign(new Error(d.message), err));
        pending.delete(d.id);
      } else if (d.stage === 'compile' && version === 0) readyRej(Object.assign(new Error(d.message), err));
      emit('error', err);
    } else if (d.type === 'log') emit('log', d.args);
    else if (d.type === 'stats') emit('stats', d);
    else if (d.type === 'synced') {
      const r = syncs.get(d.id);
      if (r) {
        syncs.delete(d.id);
        r(true);
      }
    } else if (d.type === 'stuck') {
      inst.stuck += d.n || 1;
      if (DEV)
        console.warn(
          `overdub: the watchdog let go of ${d.n || 1} ${d.why === 'ring' ? 'ringing' : 'stuck'} voice${d.n > 1 ? 's' : ''} (pitch ${d.p}) on ${def.id}${opts.uid ? ' (' + opts.uid + ')' : ''}`,
        );
      emit('stuck', d);
    }
  };

  const out = c.createGain();
  inst.output = out;
  const post = (m) => {
    try {
      node.port.postMessage(m);
    } catch (e) {
      /* closed */
    }
  };
  let on = opts.on !== false,
    wet = null,
    dry = null,
    feed = null,
    dryDelay = null;

  if (kind === 'effect') {
    const input = c.createGain();
    feed = c.createGain();
    wet = c.createGain();
    dry = c.createGain();
    feed.gain.value = on ? 1 : 0;
    wet.gain.value = on ? 1 : def.trails ? 1 : 0;
    dry.gain.value = on ? 0 : 1;
    input.connect(feed);
    feed.connect(node);
    node.connect(wet);
    wet.connect(out);
    input.connect(dry);
    const lat = +def.latency || 0; // seconds, declared: line the dry path up with the wet one
    if (lat > 0) {
      dryDelay = c.createDelay(Math.max(1, lat * 2));
      dryDelay.delayTime.value = lat;
      dry.connect(dryDelay);
      dryDelay.connect(out);
    } else dry.connect(out);
    inst.input = input;
    if (keyed) {
      const k = c.createGain();
      k.connect(node, 0, 1);
      inst.keyInput = k;
      inst.keyOn = false;
      inst.setKey = (v) => {
        v = !!v;
        if (v !== inst.keyOn) {
          inst.keyOn = v;
          post({ type: 'key', on: v });
        }
      };
    }
  } else {
    node.connect(out);
  }

  let sleepTimer = null;
  let lastValues = values;
  inst.set = (params, x = {}) => {
    const v = paramValues(ndef, params || {});
    lastValues = v;
    post({ type: 'params', values: v, jump: !!x.first });
    if (x.bpm) {
      opts.bpm = x.bpm;
      post({ type: 'transport', ...transport() });
    }
  };
  inst.auto = (g) =>
    post({
      type: 'auto',
      key: g.key,
      time: tOf(g.time),
      end: tOf(g.end == null ? g.time : g.end),
      a: +g.a,
      b: +g.b,
      c: g.c == null ? 0 : g.c,
      start: g.start == null ? null : +g.start,
    });
  inst.autoClear = (key, from, release = false) =>
    post({ type: 'auto.clear', key: key == null ? null : key, from: tOf(from), release: !!release });
  inst.autoStop = () => post({ type: 'auto.stop' });
  inst.setOn = (next, at) => {
    if (kind !== 'effect') return;
    next = !!next;
    if (next === on) return;
    on = next;
    const t = Math.max(at == null ? 0 : at, c.currentTime),
      tc = 0.01 / 3; // ~10 ms to settle
    const ramp = (g, v) => {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.setTargetAtTime(v, t, tc);
    };
    if (sleepTimer) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
    if (on) {
      post({ type: 'sleep', on: false });
      ramp(feed, 1);
      ramp(wet, 1);
      ramp(dry, 0);
    } else {
      ramp(dry, 1);
      if (def.trails)
        ramp(feed, 0); // the tail rings out through the still-open wet path
      else {
        ramp(wet, 0);
        ramp(feed, 0);
        // once faded (and whatever was in the kernel has died away), stop running it
        if (!offline)
          sleepTimer = setTimeout(
            () => {
              if (!on) post({ type: 'sleep', on: true });
            },
            1000 * Math.max(0.1, Math.min(5, +def.tail || 0.25)),
          );
      }
    }
  };
  const tOf = (time) => (time == null ? 0 : +time);
  // the ledger (see the watchdog in the header): what was handed over, in time order (k: 0 allOff, 1 off, 2 on)
  const led = { base: new Map(), ev: [], last: 0 };
  const ledAdd = (k, p, t) => {
    const e = { k, p, t: Math.max(t, 0) },
      q = led.ev;
    let j = q.length;
    while (j > 0 && (q[j - 1].t > e.t || (q[j - 1].t === e.t && q[j - 1].k > k))) j--;
    q.splice(j, 0, e);
    if (e.t > led.last) led.last = e.t;
    if (c.currentTime > led.last) led.last = c.currentTime;
  };
  const ledApply = (m, e) => {
    if (e.k === 0) m.clear();
    else if (e.k === 2) m.set(e.p, (m.get(e.p) || 0) + 1);
    else {
      const n = (m.get(e.p) || 0) - 1;
      if (n > 0) m.set(e.p, n);
      else m.delete(e.p);
    }
  };
  // the open notes at time `now` ({ pitch: n }); events more than a second old fold into the base
  const ledOpen = (now) => {
    const q = led.ev;
    let i = 0;
    while (i < q.length && q[i].t < now - 1) ledApply(led.base, q[i++]);
    if (i) q.splice(0, i);
    const m = new Map(led.base);
    for (const e of q) {
      if (e.t > now) break;
      ledApply(m, e);
    }
    const o = {};
    for (const [p, n] of m) o[p] = n;
    return o;
  };
  // how many notes of pitch `p` are open just before an off at `t` would land: what the worklet plays before it, which
  // is every earlier event and, at `t` itself, an allOff and every off already handed over for `t` (offs first at one
  // frame, in the order they came: one at `t` already lets go of what was open, and leaves nothing for this one);
  // and whether a note-on of `p` is handed over for exactly `t` (the same frame)
  const ledOpenBefore = (p, t) => {
    const eps = 0.5 / c.sampleRate;
    let n = led.base.get(p) || 0;
    for (const e of led.ev) {
      if (e.t > t + eps) break;
      if (e.k === 2 && e.t > t - eps) continue; // (at the same frame, the ons come after every off)
      if (e.k === 0) n = 0;
      else if (e.p === p) n += e.k === 2 ? 1 : -1;
      if (n < 0) n = 0;
    }
    return n;
  };
  const ledOnAt = (p, t) => led.ev.some((e) => e.k === 2 && e.p === p && Math.abs(e.t - t) < 0.5 / c.sampleRate);
  const ledDrop = (k, p, t) => {
    const q = led.ev;
    for (let j = q.length - 1; j >= 0; j--)
      if (q[j].k === k && q[j].p === p && Math.abs(q[j].t - t) < 0.5 / c.sampleRate) {
        q.splice(j, 1);
        return true;
      }
    return false;
  };
  inst.noteOn = (pitch, vel = 0.8, time, x) => {
    if (kind === 'instrument') ledAdd(2, pitch | 0, tOf(time));
    post(
      x && (x.bend != null || x.mod != null)
        ? { type: 'on', p: pitch | 0, v: +vel, time: tOf(time), x: { bend: x.bend, mod: x.mod } }
        : { type: 'on', p: pitch | 0, v: +vel, time: tOf(time) },
    );
  };
  // the channel's expression from `time`: bend (semitones), mod (0..1), sustain (bool); fields left out stay
  inst.expr = (x, time) => post({ type: 'expr', ...chanExpr(x), time: tOf(time) });
  // A note-off at its own note-on's time would land before it (offs come first at one frame, so a note ending where
  // the next one starts lets go before that one sounds) and release nothing, leaving the note held with no off to come:
  // a key tapped and let go inside one render quantum (live notes are both stamped currentTime), a blur or Cmd letting
  // go of a key just pressed, a pad sending its on and off together. When nothing of that pitch is open before `time`
  // and an on for it sits at `time`, the off goes one frame later, after its on. (Nothing open counts the offs already
  // at `time`: a key held from an earlier quantum, let go now, then pressed and let go again inside this one sends two
  // offs at `time`; the first takes the earlier note, so the second goes after the new note-on, or it would be held.)
  inst.noteOff = (pitch, time) => {
    const p = pitch | 0;
    let t = tOf(time);
    if (kind === 'instrument') {
      if (ledOpenBefore(p, t) === 0 && ledOnAt(p, t)) t += 1 / c.sampleRate;
      ledAdd(1, p, t);
    }
    post({ type: 'off', p, time: t });
  };
  inst.allOff = (time) => {
    if (kind === 'instrument') ledAdd(0, 0, tOf(time));
    post({ type: 'alloff', time: tOf(time) });
  };
  // drop every note queued at or after `time` (the engine's stop and seek, before allOff): note-ons in the lookahead
  // never sound, and their note-offs can't be lost
  inst.flush = (time) => {
    const t = tOf(time);
    led.ev = led.ev.filter((e) => e.t < t - 0.5 / c.sampleRate);
    post({ type: 'flush', time: t });
  };
  // take back a scheduled note (the engine, when a note inside its lookahead is moved or deleted): still queued, it
  // never sounds; already sounding, it is released at once. off: the note-off already sent for it, if any. With `to`,
  // only that note-off moves (to `to`).
  inst.cancel = (pitch, time, off, to) => {
    const p = pitch | 0;
    if (kind === 'instrument') {
      if (off != null) ledDrop(1, p, +off);
      if (to != null) ledAdd(1, p, +to);
      else if (!ledDrop(2, p, tOf(time))) ledAdd(1, p, c.currentTime); // (its on long gone: released now)
    }
    post({ type: 'cancel', p, time: tOf(time), off: off == null ? null : +off, to: to == null ? null : +to });
  };
  inst.reload = (source) =>
    new Promise((resolve, reject) => {
      const id = ++reqId;
      pending.set(id, {
        resolve: () => {
          def = Object.assign({}, def, { kernel: source });
          inst.def = def;
          resolve(inst);
        },
        reject,
      });
      post({ type: 'code', source, id });
    });
  // Resolves once the worklet has handled everything posted before this call.
  inst.sync = () =>
    new Promise((resolve) => {
      const id = ++reqId;
      syncs.set(id, resolve);
      post({ type: 'sync', id });
      setTimeout(() => {
        if (syncs.delete(id)) resolve(false);
      }, 2000);
    });
  inst.on = (type, fn) => {
    (listeners[type] || (listeners[type] = new Set())).add(fn);
    return () => listeners[type].delete(fn);
  };
  inst.stuck = 0;
  inst.stats = () =>
    new Promise((resolve) => {
      const off = inst.on('stats', (d) => {
        off();
        clearTimeout(to);
        resolve(d);
      });
      const to = setTimeout(() => {
        off();
        resolve(null);
      }, 1000);
      post({ type: 'stats' });
    });

  // transport: post the song position now and every 50 ms (the worklet extrapolates between)
  let tick = null;
  if (!offline) {
    let last = '',
      n = 0;
    // the watchdog's ring limit: the device's tail or its release param, whichever is longer, plus a second
    const ring = () => {
      let r = +def.tail || 4;
      for (const s of def.params || [])
        if (s.role === 'release') {
          const v = +(lastValues || {})[s.key];
          if (v > r) r = v;
        }
      return Math.min(60, r) + 1;
    };
    const send = () => {
      const tr = transport(),
        key = tr.bpm + '|' + tr.playing;
      if (key !== last || tr.playing) {
        last = key;
        post({ type: 'transport', ...tr });
      }
      // (stopped, and the last note handed over is 200 ms behind us)
      if (kind === 'instrument' && !tr.playing && ++n % 5 === 0 && tr.time > led.last + 0.2)
        post({ type: 'watch', open: ledOpen(tr.time), time: tr.time, ring: ring() });
    };
    tick = setInterval(send, 50);
  }

  inst.data = dataNow();
  if (waiting) {
    waiting.then(() => {
      if (!node.port.onmessage) return; // disposed while it loaded
      waiting = null;
      inst.data = dataNow();
      if (inst.data.state === 'ready') post({ type: 'data', data: dataOptions(c, files, have) });
      emit('data', inst.data);
    });
  }

  const unbarrier = offline ? offlineBarrier(c, inst) : null;
  inst.dispose = () => {
    if (unbarrier) unbarrier();
    if (tick) clearInterval(tick);
    if (sleepTimer) clearTimeout(sleepTimer);
    post({ type: 'end' });
    try {
      node.port.onmessage = null;
      node.port.close();
    } catch (e) {
      /* closed */
    }
    for (const n of [node, out, wet, dry, feed, dryDelay, inst.input, inst.keyInput]) {
      try {
        if (n) n.disconnect();
      } catch (e) {
        /* gone */
      }
    }
    for (const p of pending.values()) p.reject(new Error('disposed'));
    pending.clear();
  };
  inst.node = node;
  return inst;
}
