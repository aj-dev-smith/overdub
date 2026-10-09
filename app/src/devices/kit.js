// The graph DSP kit: what a graph device's build(c, kit) gets. A port of clawd-o-matic's PFX (web/pedals.js, the pedal
// platform of AJ's Guitar Studio: app/vendor/clawd/pedals.js is the original), so the hundred-odd pedals ported from
// there run unchanged, and Overdub's own graph devices get the same tools.
//
//   PFX                         the context-free helpers: dB, toDb, clamp, rng, noteSec, noteFmt, NOTES, ENV, END
//   makeKit(c, { uid, seed, clock })   -> kit (below) plus kit.release() (stops what it started: devices/graph.js calls it)
//   loadWorklet(c, name, url)   load an AudioWorkletProcessor's module (a file on this origin) once per context, behind
//                               END: Promise<boolean>
//   workletsReady(c, worklets)  true if every { name: url } is in (build now), else a Promise of their loading
//   workletLoaded(c, name)      true / false / undefined (not asked for yet)
//   endWorklet(node)            tell a processor loaded by loadWorklet to stop (it returns false from then on)
//   glide(c, param, v, dur, at) move an AudioParam along a raised cosine (no click at either end)
//   isOffline(c)
//
// The kit (k.G, k.F, ...): the same names and meanings as clawd-o-matic's (docs/PEDALS.md there, "The kit"):
//   G(v) F(type, f, Q?, gain?) chain(...nodes) curve(fn, over, n) shaper(k, bias, over) delay(max, t) lfo(rate, shape)
//   constant(v) noise({ secs, seed, color, channels }) noiseSource(opts) ir({ secs, pre, seed, tail, damp, darken,
//   width, channels }) convolver(buffer?) merge(L, R) pan(v) envelope({ attack, release }) worklet(name, opts)
//   later(fn, ms) own(node) onDispose(fn) dB toDb clamp rng noteSec noteFmt NOTES uid seed clock c sr
// Lowpass/highpass Q is Web Audio's (resonance in dB). Everything random is seeded: renders are the same every time.

// The delay notes a tempo-synced knob steps through: [label, quarter notes].
export const NOTES = [['1/16', 0.25], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2]];

// The envelope follower's processor (clawd-o-matic's PFX_ENV): audio in, its envelope out (0 to about 1, one channel).
// ENV is its module's URL (devices/worklets/env.js): a def calling kit.envelope() lists worklets: { 'pfx-env': ENV }.
export const ENV = new URL('./worklets/env.js', import.meta.url).href;

// The module every worklet goes in behind (devices/worklets/end.js, loaded once per context before the first): a
// processor whose node has been let go is sent { __pfxEnd } and returns false from then on (one returning true would
// otherwise be processed every render quantum for ever). Same message as clawd-o-matic's, so its pedals' own port
// handlers already ignore it.
export const END = new URL('./worklets/end.js', import.meta.url).href;

export const dB = (d) => Math.pow(10, d / 20);
export const toDb = (g) => 20 * Math.log10(Math.max(1e-12, Math.abs(g)));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// a seeded random in [-1, 1): the same numbers every time
export const rng = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; };
// a NOTES index (or a label like '1/8.') in seconds at bpm
export const noteSec = (note, bpm) => {
  const n = typeof note === 'string' ? NOTES.find((d) => d[0] === note) : NOTES[clamp(Math.round(note), 0, NOTES.length - 1)];
  return ((n ? n[1] : 1) * 60) / (bpm || 120);
};
export const noteFmt = (v) => NOTES[clamp(Math.round(v), 0, NOTES.length - 1)][0];
export const PFX = { dB, toDb, clamp, rng, noteSec, noteFmt, NOTES, ENV, END };

export const isOffline = (c) => typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;

/* ---- worklets: a def's worklets map each processor name to its module's URL, a file on the page's own origin (the
   pages' policy refuses data: and blob: scripts, so a worklet can't be made from a string). Each is loaded once per
   context, behind END (once per context, first). A processor name is one per context, so the first module to load
   under a name keeps it. */
const BOX = new WeakMap(); // context -> { end: Promise<bool>, p: { name: Promise<bool> }, ok: { name: bool } }
const box = (c) => { let b = BOX.get(c); if (!b) BOX.set(c, (b = { end: null, p: {}, ok: {} })); return b; };
export function loadWorklet(c, name, url) {
  if (!c || !c.audioWorklet) return Promise.resolve(false);
  const b = box(c);
  if (!b.p[name]) {
    const add = (u) => c.audioWorklet.addModule(u).then(() => true, () => false);
    if (typeof url !== 'string' || !url || /\s/.test(url)) {
      console.error(`worklet "${name}": a def's worklets give its module's URL (a .js file on this origin), not its source`);
      b.p[name] = Promise.resolve((b.ok[name] = false));
    } else {
      if (!b.end) b.end = add(END);
      b.p[name] = b.end.then((ok) => ok && add(url)).then((ok) => (b.ok[name] = ok));
    }
  }
  return b.p[name];
}
export const workletLoaded = (c, name) => box(c).ok[name];
export function workletsReady(c, worklets) {
  const names = Object.keys(worklets || {});
  const b = box(c);
  if (names.every((n) => n in b.ok)) return true;
  return Promise.all(names.map((n) => loadWorklet(c, n, worklets[n]))).then(() => true);
}
export function endWorklet(n) { try { if (n && n.port) n.port.postMessage({ __pfxEnd: true }); } catch { /* gone */ } }

// Move an AudioParam to v along a raised cosine over dur seconds, from audio time `at` (or now). Live it starts from
// where the param is; offline (scheduled ahead) from `from` if given.
export function glide(c, param, v, dur, at, from) {
  const live = !isOffline(c);
  const t = live ? Math.max(c.currentTime + 0.003, at || 0) : Math.max(c.currentTime, at || 0);
  const f0 = from != null ? from : param.value, n = 24, cv = new Float32Array(n);
  if (Math.abs(f0 - v) < 1e-9) { param.cancelScheduledValues(t); param.setValueAtTime(v, t); return; }
  for (let i = 0; i < n; i++) cv[i] = f0 + (v - f0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
  if (live) { param.cancelScheduledValues(0); param.setValueAtTime(f0, c.currentTime); } else { param.cancelScheduledValues(t); param.setValueAtTime(f0, t); }
  try { param.setValueCurveAtTime(cv, t, dur); } catch { param.setTargetAtTime(v, t, dur / 4); }
}

const NOISE = new WeakMap();
// The kit for one device instance on context c. own: what it started (stopped by release()).
export function makeKit(c, { uid = 'device', seed = 1, clock = null } = {}) {
  const own = { src: [], timers: [], fns: [], wk: [] };
  const G = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
  const F = (type, f, q, g) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; if (g != null) n.gain.value = g; return n; };
  const chain = (...ns) => { for (let i = 0; i + 1 < ns.length; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };
  const curve = (fn, over = '2x', N = 4096) => {
    const n = c.createWaveShaper(), cv = new Float32Array(N);
    for (let i = 0; i < N; i++) cv[i] = fn((i / (N - 1)) * 2 - 1);
    n.curve = cv; n.oversample = over; return n;
  };
  // tanh at k with a bias b (asymmetry: even harmonics), normalised to ±1 and centred (no DC at rest)
  const shaper = (k, b = 0, over = '2x') => {
    const t0 = Math.tanh(k * b), norm = Math.max(Math.tanh(k * (1 + b)) - t0, t0 - Math.tanh(k * (b - 1)));
    return curve((x) => (Math.tanh(k * (x + b)) - t0) / norm, over);
  };
  const start = (n) => { n.start(); own.src.push(n); return n; };
  const lfo = (rate, shape = 'sine') => {
    const o = c.createOscillator();
    if (Array.isArray(shape)) { const re = new Float32Array(shape.length + 1), im = new Float32Array(shape.length + 1); shape.forEach((a, i) => (im[i + 1] = a)); o.setPeriodicWave(c.createPeriodicWave(re, im)); }
    else o.type = shape;
    o.frequency.value = rate; return start(o);
  };
  const constant = (v = 0) => { const n = c.createConstantSource(); n.offset.value = v; return start(n); };
  const delay = (max, t = 0) => { const n = c.createDelay(max); n.delayTime.value = t; return n; };
  // a deterministic noise buffer, cached per context
  const noise = ({ secs = 2, seed = 1, color = 'white', channels = 1 } = {}) => {
    let cache = NOISE.get(c); if (!cache) NOISE.set(c, (cache = {}));
    const key = [secs, seed, color, channels].join();
    if (cache[key]) return cache[key];
    const n = Math.round(secs * c.sampleRate), b = c.createBuffer(channels, n, c.sampleRate), r = rng(seed);
    for (let ch = 0; ch < channels; ch++) {
      const d = b.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, br = 0;
      for (let i = 0; i < n; i++) {
        const w = r();
        if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
        else if (color === 'brown') { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.5; }
        else d[i] = w;
      }
    }
    return (cache[key] = b);
  };
  const noiseSource = (opts) => { const s = c.createBufferSource(); s.buffer = noise(opts); s.loop = true; return start(s); };
  // a reverb tail: decaying noise that darkens as it goes, -60 dB at secs (deterministic for a seed)
  const ir = ({ secs = 2, pre = 0.012, seed = 1, tail = 1.2, damp = 0.25, darken = 0.7, width = 1, channels = 2 } = {}) => {
    const sr = c.sampleRate, n = Math.round(sr * secs * tail), p0 = Math.round(sr * pre), b = c.createBuffer(channels, n, sr), rnd = rng(seed);
    for (let ch = 0; ch < channels; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr, dark = damp + darken * Math.min(1, t / secs);
        lp += (rnd() - lp) * (1 - dark);
        d[i] = lp * Math.exp((-6.9 * t) / secs);
      }
    }
    if (channels === 2 && width < 1) {
      const L = b.getChannelData(0), R = b.getChannelData(1);
      for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = ((L[i] - R[i]) / 2) * width; L[i] = m + s; R[i] = m - s; }
    }
    return b;
  };
  // A convolver whose IR can change under a ringing tail: live, a new .buffer fades in a new ConvolverNode over 50 ms
  // while the old one fades out over 300 ms (a plain ConvolverNode drops its tail: a click). Offline: one node.
  const later = (fn, ms) => { const id = setTimeout(fn, ms); own.timers.push(id); return id; };
  const convolver = (buffer) => {
    const live = !isOffline(c);
    const inp = G(1), out = G(1), link = (a, b) => AudioNode.prototype.connect.call(a, b), unlink = (a, b) => { try { AudioNode.prototype.disconnect.call(a, b); } catch { /* gone */ } };
    let norm = true;
    const add = (b) => { const n = c.createConvolver(), g = G(1); n.normalize = norm; if (b) n.buffer = b; link(inp, n); n.connect(g); g.connect(out); return { n, g }; };
    let cur = add(buffer);
    const fade = (param, from, to, t, dur) => { const k = 24, cv = new Float32Array(k); for (let i = 0; i < k; i++) cv[i] = from + (to - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (k - 1))); param.cancelScheduledValues(0); param.setValueAtTime(from, c.currentTime); param.setValueCurveAtTime(cv, t, dur); };
    Object.defineProperty(inp, 'buffer', { configurable: true, get: () => cur.n.buffer, set(b) {
      if (!live || !cur.n.buffer) { cur.n.buffer = b; return; }
      const old = cur, t = c.currentTime + 0.003;
      cur = add(b);
      fade(cur.g.gain, 0, 1, t, 0.05); fade(old.g.gain, old.g.gain.value, 0, t, 0.3);
      later(() => { unlink(inp, old.n); old.n.disconnect(); old.g.disconnect(); }, 400);
    } });
    Object.defineProperty(inp, 'normalize', { configurable: true, get: () => norm, set(v) { norm = !!v; cur.n.normalize = norm; } });
    inp.connect = (...a) => out.connect(...a);
    inp.disconnect = (...a) => out.disconnect(...a);
    return inp;
  };
  // an AudioWorkletNode for a processor the def's worklets loaded (null if it couldn't load: pass the signal through)
  const worklet = (name, opts) => { if (!workletLoaded(c, name)) return null; const n = new AudioWorkletNode(c, name, opts); own.wk.push(n); return n; };
  // the envelope follower (needs worklets: { 'pfx-env': PFX.ENV } in the def): null without worklets
  const envelope = ({ attack = 0.005, release = 0.12 } = {}) => {
    const n = worklet('pfx-env', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    if (n) { n.parameters.get('attack').value = attack; n.parameters.get('release').value = release; }
    return n;
  };
  const merge = (L, R) => { const m = c.createChannelMerger(2); L.connect(m, 0, 0); (R || L).connect(m, 0, 1); return m; };
  const pan = (v = 0) => { const n = c.createStereoPanner(); n.pan.value = v; return n; };
  const kit = { c, sr: c.sampleRate, G, F, chain, curve, shaper, lfo, constant, delay, noise, noiseSource, ir, convolver, worklet, envelope, merge, pan, later,
    own: (n) => { own.src.push(n); return n; }, onDispose: (fn) => own.fns.push(fn), dB, toDb, clamp, rng, noteSec, noteFmt, NOTES, ENV, uid, seed, clock,
    loaded: (name) => !!workletLoaded(c, name) };
  // stop what this kit started, clear its timers, run its cleanups, let its worklets go
  Object.defineProperty(kit, 'release', { enumerable: false, value() {
    for (const t of own.timers) clearTimeout(t);
    for (const s of own.src) { try { s.stop(); } catch { /* not started */ } try { s.disconnect(); } catch { /* gone */ } }
    for (const fn of own.fns) { try { fn(); } catch { /* its business */ } }
    for (const n of own.wk) endWorklet(n);
    own.src = []; own.timers = []; own.fns = []; own.wk = [];
  } });
  return kit;
}
