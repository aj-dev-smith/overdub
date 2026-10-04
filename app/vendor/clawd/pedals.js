// vendored verbatim from clawd-o-matic/web/pedals.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ================================================================ Claw'd-o-Matic: the pedal platform (plug in) */
// Concatenated in the app's scope after amps.js; pedals/*.js (the pedal packs) follow it, then pedalboard.js (the board
// and the library you see), ampui.js, presets.js and plugin.js. docs/PEDALS.md says how to write a pedal.
//   pedalDef(def)      registers a pedal (a pack calls it once per pedal, at load)
//   PFX                the DSP kit: helpers, and PFX.kit(c) is what a pedal's build(c, kit) gets
//   pfxWorklet(c,n,s)  loads an AudioWorkletProcessor's source once per context
//   board helpers      the board is an ordered list: [{ uid, id, on, ...knobs }, ..., { id: 'amp' }, ...]
//   pedalRig(c, amp)   the sound of a board around an amp: rebuilt as pedals come and go, click-free
//   plugKnob(...)      the rotary knob (the amp's face uses it too)
// Every pedal gets its bypass from here: an 'insert' pedal crossfades dry to wet (8 ms, click-free); a 'trails' pedal
// (delays, reverbs) keeps the dry at unity and switches its send, so its tail rings on after you stomp it off.

// The delay notes a tempo-synced knob steps through: [label, quarter notes].
const DELAY_NOTES = [['1/16', 0.25], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2]];
// Categories, in the order the library shows them; RANK is where a new pedal goes along the board (lower is earlier;
// 'pre' pedals sit before the amp, 'post' after, and a new one goes after the last pedal of its rank or lower).
const PEDAL_CATS = [['dynamics', 'Dynamics'], ['filter', 'Filter & wah'], ['pitch', 'Pitch'], ['drive', 'Drive'], ['fuzz', 'Fuzz'], ['synth', 'Synth'],
  ['mod', 'Modulation'], ['time', 'Delay'], ['ambient', 'Ambient'], ['glitch', 'Glitch'], ['utility', 'Utility']];
const PEDAL_RANK = { dynamics: 0, utility: 0.5, filter: 1, pitch: 2, synth: 2.5, drive: 3, fuzz: 4, glitch: 4.5, mod: 5, time: 6, ambient: 7 };
const BOARD_MAX = 14; // pedals on the board (the amp not counted)
const PEDAL_DEFS = {}; // id -> def (normalised)
const PEDAL_LIST = []; // defs in the order they registered

/* ---- the gate's worklet (the Snapper, pedals/00-classic.js; plugGate in plugin.js makes one bare) */
const PLUG_GATE = `class ClawdGate extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'threshold', defaultValue: -62, minValue: -100, maxValue: 0, automationRate: 'k-rate' }]; }
  constructor() { super(); this.env = 0; this.g = 0; this.hold = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const th = p.threshold[0], open = Math.pow(10, th / 20), shut = open * 0.5, off = th <= -99;
    const rel = Math.exp(-1 / (0.06 * sampleRate)), up = 1 - Math.exp(-1 / (0.001 * sampleRate)), down = 1 - Math.exp(-1 / (0.07 * sampleRate)), holdN = 0.05 * sampleRate;
    for (let n = 0; n < o.length; n++) {
      const a = Math.abs(i[n]);
      this.env = a > this.env ? a : this.env * rel;
      if (off || this.env > open) this.hold = holdN;
      else if (this.env < shut && this.hold > 0) this.hold--;
      const want = off || this.hold > 0 ? 1 : 0;
      this.g += (want - this.g) * (want > this.g ? up : down);
      o[n] = i[n] * this.g;
    }
    return true;
  }
}
registerProcessor('clawd-gate', ClawdGate);`;
// The kit's envelope follower: audio in, its envelope out (0 to about 1, linear, one channel) as a control signal to
// connect through a GainNode (the depth) into any AudioParam. attack and release are in seconds.
const PFX_ENV = `class PfxEnv extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'attack', defaultValue: 0.005, minValue: 0.0001, maxValue: 2, automationRate: 'k-rate' }, { name: 'release', defaultValue: 0.12, minValue: 0.001, maxValue: 5, automationRate: 'k-rate' }]; }
  constructor() { super(); this.e = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], inp = ins[0];
    if (!o) return true;
    const a = 1 - Math.exp(-1 / (p.attack[0] * sampleRate)), r = 1 - Math.exp(-1 / (p.release[0] * sampleRate));
    for (let n = 0; n < o.length; n++) {
      let x = 0;
      if (inp) for (let ch = 0; ch < inp.length; ch++) x = Math.max(x, Math.abs(inp[ch][n]));
      this.e += (x - this.e) * (x > this.e ? a : r);
      o[n] = this.e < 1e-9 ? 0 : this.e;
    }
    return true;
  }
}
registerProcessor('pfx-env', PfxEnv);`;

// Load an AudioWorkletProcessor's source on a context, once per context per name: a promise of true (loaded) or false.
// A data: URL loads from file:// too (a blob: one doesn't there); blob: for a page whose policy refuses data:.
// Every source goes in behind PFX_END: a processor whose node has been let go (a pedal disposed, pfxEnd) is sent
// { __pfxEnd } and its process() returns false from then on. (Otherwise one returning true is called every render
// quantum for ever, disconnected or not: every preset change leaked the old pedals' worklets onto the audio thread.)
const PFX_END = `if (!globalThis.__pfxEnd) { globalThis.__pfxEnd = true; const rp = globalThis.registerProcessor;
  globalThis.registerProcessor = (name, C) => rp(name, class extends C {
    constructor(o) { super(o); this.__end = false; this.port.addEventListener('message', (e) => { if (e.data && e.data.__pfxEnd) this.__end = true; }); this.port.start(); }
    process(i, o, p) { return this.__end ? false : super.process(i, o, p); } }); }
`;
// Let a worklet node made from a pfxWorklet source go: it stops being processed once it's out of the graph.
function pfxEnd(n) { try { if (n && n.port) n.port.postMessage({ __pfxEnd: true }); } catch (e) { /* gone */ } }
function pfxWorklet(c, name, src) {
  if (!c || !c.audioWorklet) return Promise.resolve(false);
  const box = c.__pfx || (c.__pfx = { p: {}, ok: {} });
  if (!box.p[name]) {
    src = PFX_END + src;
    const add = (url) => c.audioWorklet.addModule(url).then(() => true, () => false);
    box.p[name] = add('data:text/javascript;charset=utf-8,' + encodeURIComponent(src))
      .then((ok) => ok || add(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))))
      .then((ok) => (box.ok[name] = ok));
  }
  return box.p[name];
}
// Have a def's worklets loaded on c (true: build now; a promise: they're on their way)?
function pfxReady(c, def) {
  const names = Object.keys(def.worklets || {});
  const box = c.__pfx;
  if (names.every((n) => box && n in box.ok)) return true;
  return Promise.all(names.map((n) => pfxWorklet(c, n, def.worklets[n])));
}

// Move an AudioParam from where it is to v along a raised cosine over dur seconds (smooth at both ends: no click).
// (at: start no sooner than this audio time, holding where it is till then: a switch scheduled onto a bar line, scenes.js)
function pfxGlide(c, param, v, dur, at) {
  const from = param.value, t = Math.max(c.currentTime + 0.003, at || 0), n = 24, cv = new Float32Array(n);
  if (Math.abs(from - v) < 1e-9) { param.cancelScheduledValues(0); param.setValueAtTime(v, c.currentTime); return; }
  for (let i = 0; i < n; i++) cv[i] = from + (v - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
  param.cancelScheduledValues(0);
  param.setValueAtTime(from, c.currentTime);
  try { param.setValueCurveAtTime(cv, t, dur); } catch (e) { param.setTargetAtTime(v, t, dur / 4); }
}

/* ---- the DSP kit. PFX has the context-free helpers; PFX.kit(c) the node makers a pedal's build(c, kit) gets. Sources
   the kit starts (lfo, constant, noise) and timers it sets (later) are stopped when the pedal leaves the board. */
const PFX = (() => {
  const dB = (d) => Math.pow(10, d / 20);
  const toDb = (g) => 20 * Math.log10(Math.max(1e-12, Math.abs(g)));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // a seeded random in [-1, 1) (the same numbers every time: renders are deterministic)
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; };
  // a DELAY_NOTES index (or a label like '1/8.') in seconds at bpm
  const noteSec = (note, bpm) => {
    const n = typeof note === 'string' ? DELAY_NOTES.find((d) => d[0] === note) : DELAY_NOTES[clamp(Math.round(note), 0, DELAY_NOTES.length - 1)];
    return ((n ? n[1] : 1) * 60) / (bpm || 120);
  };
  const noteFmt = (v) => DELAY_NOTES[clamp(Math.round(v), 0, DELAY_NOTES.length - 1)][0];
  function kit(c, own) {
    own = own || { src: [], timers: [], fns: [], wk: [] };
    const G = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
    const F = (type, f, q, g) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; if (g != null) n.gain.value = g; return n; };
    const chain = (...ns) => { for (let i = 0; i + 1 < ns.length; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };
    // a WaveShaper from fn(x) over [-1, 1]
    const curve = (fn, over = '2x', N = 4096) => {
      const n = c.createWaveShaper(), cv = new Float32Array(N);
      for (let i = 0; i < N; i++) cv[i] = fn((i / (N - 1)) * 2 - 1);
      n.curve = cv; n.oversample = over; return n;
    };
    // tanh at k with a bias b (asymmetry: even harmonics), normalised to ±1 and centred (no DC at rest).
    // (2x oversampling: 128 samples of latency to 4x's 192; the amp measured no audible difference)
    const shaper = (k, b = 0, over = '2x') => {
      const t0 = Math.tanh(k * b), norm = Math.max(Math.tanh(k * (1 + b)) - t0, t0 - Math.tanh(k * (b - 1)));
      return curve((x) => (Math.tanh(k * (x + b)) - t0) / norm, over);
    };
    const start = (n) => { n.start(); own.src.push(n); return n; };
    // an oscillator at rate Hz, ±1: 'sine', 'triangle', 'square', 'sawtooth', or [harmonic amplitudes] (a custom wave)
    const lfo = (rate, shape = 'sine') => {
      const o = c.createOscillator();
      if (Array.isArray(shape)) { const re = new Float32Array(shape.length + 1), im = new Float32Array(shape.length + 1); shape.forEach((a, i) => (im[i + 1] = a)); o.setPeriodicWave(c.createPeriodicWave(re, im)); }
      else o.type = shape;
      o.frequency.value = rate; return start(o);
    };
    const constant = (v = 0) => { const n = c.createConstantSource(); n.offset.value = v; return start(n); };
    const delay = (max, t = 0) => { const n = c.createDelay(max); n.delayTime.value = t; return n; };
    // a noise buffer (cached per context): { secs, seed, color: 'white' | 'pink' | 'brown', channels }
    const noise = ({ secs = 2, seed = 1, color = 'white', channels = 1 } = {}) => {
      const key = [secs, seed, color, channels].join(), box = c.__pfxNoise || (c.__pfxNoise = {});
      if (box[key]) return box[key];
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
      return (box[key] = b);
    };
    // a looping noise source (started)
    const noiseSource = (opts) => { const s = c.createBufferSource(); s.buffer = noise(opts); s.loop = true; return start(s); };
    // A reverb tail: decaying noise that darkens as it goes (the Deep Trench's, generalised). Deterministic.
    //  secs: the decay to -60 dB; pre: pre-delay (s); seed; tail: the buffer is secs × tail long; damp: how dark it
    //  starts (0 bright to 1 dark, a one-pole on the noise) and darken: how much darker it gets by secs; width: 1 two
    //  independent channels, 0 mono; channels: 1 or 2.
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
    // A convolver whose IR can change under a ringing tail. A ConvolverNode given a new buffer drops what it was
    // ringing at once: a click (a preset change that moves a reverb's DECAY, tools/scenes-test.js measures it). Live,
    // a new IR goes into a new ConvolverNode that fades in over 50 ms while the old one, still fed, fades out over
    // 300 ms and is then let go. It passes for the ConvolverNode: connect into it and on from it, set .buffer and
    // .normalize. (Offline, and for the first IR, it's one ConvolverNode, as it always was: a unity gain after it.)
    const convolver = (buffer) => {
      const live = !(typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext);
      const inp = G(1), out = G(1), link = (a, b) => AudioNode.prototype.connect.call(a, b), unlink = (a, b) => { try { AudioNode.prototype.disconnect.call(a, b); } catch (e) { /* gone */ } };
      let norm = true;
      const add = (b) => { const n = c.createConvolver(), g = G(1); n.normalize = norm; if (b) n.buffer = b; link(inp, n); n.connect(g); g.connect(out); return { n, g }; };
      let cur = add(buffer);
      const glide = (param, from, to, t, dur) => { const k = 24, cv = new Float32Array(k); for (let i = 0; i < k; i++) cv[i] = from + (to - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (k - 1))); param.cancelScheduledValues(0); param.setValueAtTime(from, c.currentTime); param.setValueCurveAtTime(cv, t, dur); };
      Object.defineProperty(inp, 'buffer', { configurable: true, get: () => cur.n.buffer, set(b) {
        if (!live || !cur.n.buffer) { cur.n.buffer = b; return; }
        const old = cur, t = c.currentTime + 0.003;
        cur = add(b);
        glide(cur.g.gain, 0, 1, t, 0.05); glide(old.g.gain, old.g.gain.value, 0, t, 0.3);
        later(() => { unlink(inp, old.n); old.n.disconnect(); old.g.disconnect(); }, 400);
      } });
      Object.defineProperty(inp, 'normalize', { configurable: true, get: () => norm, set(v) { norm = !!v; cur.n.normalize = norm; } });
      inp.connect = (...a) => out.connect(...a);
      inp.disconnect = (...a) => out.disconnect(...a);
      return inp;
    };
    // an AudioWorkletNode for a processor the def's worklets loaded (null if it couldn't load: pass the signal through)
    const worklet = (name, opts) => { if (!(c.__pfx && c.__pfx.ok[name])) return null; const n = new AudioWorkletNode(c, name, opts); if (own.wk) own.wk.push(n); return n; };
    // the envelope follower (needs worklets: { 'pfx-env': PFX.ENV } in the def): null without worklets
    const envelope = ({ attack = 0.005, release = 0.12 } = {}) => {
      const n = worklet('pfx-env', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      if (n) { n.parameters.get('attack').value = attack; n.parameters.get('release').value = release; }
      return n;
    };
    const merge = (L, R) => { const m = c.createChannelMerger(2); L.connect(m, 0, 0); (R || L).connect(m, 0, 1); return m; };
    const pan = (v = 0) => { const n = c.createStereoPanner(); n.pan.value = v; return n; };
    // a timer that's cleared when the pedal leaves (for work off the audio thread, like a new IR after a knob settles)
    const later = (fn, ms) => { const id = setTimeout(fn, ms); own.timers.push(id); return id; };
    return { c, sr: c.sampleRate, G, F, chain, curve, shaper, lfo, constant, delay, noise, noiseSource, ir, convolver, worklet, envelope, merge, pan, later,
      own: (n) => { own.src.push(n); return n; }, onDispose: (fn) => own.fns.push(fn), dB, toDb, clamp, rng, noteSec, noteFmt, NOTES: DELAY_NOTES };
  }
  // refused: the defs pedalDef turned down, { id, name, why } (tools/pedal-check.js fails on any); worklets: processor
  // name -> { id (the first pedal to declare it), src }
  return { dB, toDb, clamp, rng, noteSec, noteFmt, NOTES: DELAY_NOTES, ENV: PFX_ENV, GATE: PLUG_GATE, kit, refused: [], worklets: {} };
})();

/* ---- the registry */
// Knobs: [key, label, min, max, default, step?, fmt?], or { key, label, opts: ['LO', 'MID', 'HI'], def: 0 } for a mini
// switch (its value is the index), or { key, label, tap: true } for a tap-tempo button. Everything is normalised to { key, label, min, max, def, step, fmt, type }.
function pedalKnob(k) {
  if (Array.isArray(k)) { const [key, label, min, max, def, step, fmt] = k; return { key, label, min, max, def, step: step || 0, fmt: fmt || null, type: 'knob' }; }
  // { key, label, tap: true }: a TAP button: its value is the tapped tempo in bpm, 0 = follow the song
  if (k && k.tap) return { key: k.key, label: k.label || 'TAP', min: 0, max: 300, def: 0, step: 0, fmt: (v) => (v >= 40 ? Math.round(v) + ' BPM' : 'SONG'), type: 'tap' };
  if (k && Array.isArray(k.opts)) return { key: k.key, label: k.label || '', min: 0, max: k.opts.length - 1, def: k.def || 0, step: 1, fmt: (v) => k.opts[Math.round(v)] || '', type: 'switch', opts: k.opts };
  return Object.assign({ step: 0, fmt: null, type: 'knob' }, k);
}
function pedalDef(def) {
  const bad = (why, loud) => { const t = `pedalDef(${def && def.id}): ${why}; skipped`; if (loud) console.error(t); else console.warn(t); PFX.refused.push({ id: def && def.id, name: def && def.name, why }); return null; };
  if (!def || typeof def !== 'object') return bad('not an object');
  if (!/^[a-z][a-z0-9-]{1,23}$/.test(def.id || '') || def.id === 'amp') return bad('id: 2-24 of a-z 0-9 -, not "amp"');
  // (two packs with one id: the first keeps it, never silently replaced: saves and presets mean the first one)
  if (PEDAL_DEFS[def.id]) return bad(`the id is taken (by ${PEDAL_DEFS[def.id].name}): pick another`, true);
  if (typeof def.build !== 'function') return bad('no build(c, kit)');
  const knobs = (def.knobs || []).map(pedalKnob);
  for (const k of knobs) {
    if (!/^[a-zA-Z]\w{0,15}$/.test(k.key || '') || ['uid', 'id', 'on'].includes(k.key)) return bad(`knob key "${k.key}"`);
    if (!(k.max > k.min) || !(k.def >= k.min && k.def <= k.max)) return bad(`knob ${k.key}: min < max, and its default between`);
  }
  if (knobs.length > 6) return bad('six knobs at most');
  // a processor name is one per context: another pack's different source under the same name would never load
  const wl = PFX.worklets;
  for (const [n, src] of Object.entries(def.worklets || {})) if (wl[n] && wl[n].src !== src) return bad(`worklet "${n}" is already ${wl[n].id}'s, with other code: prefix it with your id`, true);
  for (const [n, src] of Object.entries(def.worklets || {})) if (!wl[n]) wl[n] = { id: def.id, src };
  const d = Object.assign({ name: def.id, kind: '', cat: 'utility', nod: '', blurb: '', color: '#666', ink: '#fff', look: {}, where: 'pre', trails: false, trim: 0 }, def, { knobs });
  if (!PEDAL_RANK.hasOwnProperty(d.cat)) d.cat = 'utility';
  if (d.where !== 'post') d.where = 'pre';
  PEDAL_DEFS[d.id] = d; PEDAL_LIST.push(d);
  return d;
}
const pedalKnobs = (id) => (PEDAL_DEFS[id] ? PEDAL_DEFS[id].knobs : []);

/* ---- the board: an ordered list of pedals with the amp in it once. [{ uid, id, on, ...knob values }, { id: 'amp' }] */
const BOARD_CLASSIC = ['gate', 'drive', 'fuzz', 'amp', 'chorus', 'delay', 'verb'];
// a pedal's entry at its default knobs
function boardEntry(id, uid, on) {
  const def = PEDAL_DEFS[id], e = { uid: uid || id, id, on: on != null ? !!on : true };
  for (const k of def.knobs) e[k.key] = k.def;
  return e;
}
// a uid for another id on the board: the id itself, then id2, id3...
function boardUid(board, id) {
  const has = new Set(board.map((e) => e.uid));
  if (!has.has(id)) return id;
  let n = 2; while (has.has(id + n)) n++;
  return id + n;
}
// The classic board: gate, drive, fuzz, the amp, chorus, delay, reverb (the ones that are registered), at defaults.
function boardDefault() {
  return BOARD_CLASSIC.filter((id) => id === 'amp' || PEDAL_DEFS[id]).map((id) => (id === 'amp' ? { id: 'amp' } : boardEntry(id, id, id === 'gate')));
}
// Anything to a good board: unknown pedals dropped, knobs clamped, uids made unique, the amp once (if it's missing: the
// pre pedals, the amp, the post pedals), at most BOARD_MAX pedals. A pedal that doesn't say on or off is on.
function boardClean(raw) {
  if (!Array.isArray(raw)) return boardDefault();
  const out = [];
  let amp = false;
  for (const r0 of raw.slice(0, 64)) {
    const r = typeof r0 === 'string' ? { id: r0 } : r0;
    if (!r || typeof r !== 'object') continue;
    if (r.id === 'amp') { if (!amp) out.push({ id: 'amp' }); amp = true; continue; }
    const def = PEDAL_DEFS[r.id];
    if (!def || out.length - amp >= BOARD_MAX) continue;
    const uid = typeof r.uid === 'string' && /^[a-z][\w-]{0,31}$/.test(r.uid) && !out.some((e) => e.uid === r.uid) ? r.uid : boardUid(out, r.id);
    const e = boardEntry(r.id, uid, typeof r.on === 'boolean' ? r.on : true);
    for (const k of def.knobs) if (Number.isFinite(+r[k.key]) && r[k.key] !== null && r[k.key] !== '') e[k.key] = Math.max(k.min, Math.min(k.max, +r[k.key]));
    out.push(e);
  }
  // no amp in it: the pre pedals (in the order given), the amp, then the post ones
  if (!amp) return out.filter((e) => PEDAL_DEFS[e.id].where !== 'post').concat({ id: 'amp' }, out.filter((e) => PEDAL_DEFS[e.id].where === 'post'));
  return out;
}
// The old shape, { gate: { on, th }, drive: {...}, ... }, as a board in the classic order. preset: a pedal it lists is on
// unless it says on: false, and one it doesn't list is off (presets.js); a save: its own on, or the pedal's default.
function boardFromFx(fx, preset) {
  fx = fx && typeof fx === 'object' ? fx : {};
  return boardClean(BOARD_CLASSIC.map((id) => {
    if (id === 'amp') return 'amp';
    const s = fx[id] && typeof fx[id] === 'object' ? fx[id] : null;
    const e = Object.assign({ id }, s || {});
    e.on = preset ? !!s && s.on !== false : s && typeof s.on === 'boolean' ? s.on : id === 'gate';
    return e;
  }));
}
// Where a new pedal goes: pre or post the amp by its where, after the last pedal of its rank or lower on that side.
function boardPlace(board, id) {
  const def = PEDAL_DEFS[id], a = board.findIndex((e) => e.id === 'amp'), rank = PEDAL_RANK[def.cat];
  const [lo, hi] = def.where === 'post' ? [a + 1, board.length] : [0, a];
  let at = lo;
  for (let i = lo; i < hi; i++) if (PEDAL_RANK[PEDAL_DEFS[board[i].id].cat] <= rank) at = i + 1;
  return at;
}
const boardCount = (board) => board.filter((e) => e.id !== 'amp').length;

/* ---- the sound of a board around an amp. set(P, bpm) takes the amp's settings and P.board; pedals are built as they
   join (after their worklets load: ready() resolves when every one on the board is built), kept while they stay, and
   dropped when they go. A change of order rewires behind a short fade of the chain's output. */
function pedalRig(c, amp) {
  const K = PFX.kit(c), input = K.G(1), fadeIn = K.G(1), fade = K.G(1), output = K.G(1);
  input.connect(fadeIn); fade.connect(output);
  const live = !(typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext);
  const inst = new Map(); // uid -> { def, uid, w (the wrapper), key (the settings it last had), first }
  let wired = null, cur = null, bpm = 120, waiting = [], rewire = 0, dying = [];

  /* ---- the clock: where the band's bar lines fall, for pedals that lock to them. While the band plays on this context
     it's PLUG.clock (plugin.js; a tempo map, loops and jumps included); otherwise a free grid of bars from audio time 0
     at the rig's tempo (so offline renders are the same every time). useClock(src) swaps in another source shaped like
     PLUG.clock ({ playing(), bpm(), bar(), barTime(b), beatsPerBar()? }), or null for the free grid always. */
  let clockSrc; // undefined: the band's, when it's on this context
  const band = () => {
    let s = clockSrc;
    if (s === undefined) { if (!live) return null; try { s = PLUG._bus && PLUG._bus.c === c ? PLUG.clock : null; } catch (e) { s = null; } } // (PLUG: plugin.js, later in the page)
    try { return s && s.playing() ? s : null; } catch (e) { return null; }
  };
  // the fractional bar at audio time t (from the bar the source says it's in, stepping to the one t is in)
  const barAt = (s, t) => {
    if (!s) return (t * bpm) / 240;
    let b = Math.floor(+s.bar() || 0), k = 0;
    while (s.barTime(b) > t && k++ < 512) b--;
    while (s.barTime(b + 1) <= t && k++ < 512) b++;
    const a = s.barTime(b), z = s.barTime(b + 1);
    return b + (z > a ? (t - a) / (z - a) : 0);
  };
  const clock = {
    get playing() { return !!band(); },
    get beatsPerBar() { const s = band(); let n = 4; try { if (s && s.beatsPerBar) n = +s.beatsPerBar() || 4; } catch (e) { /* 4 */ } return n; }, // (the app's bars are all 4/4)
    get bpm() { const s = band(); if (!s) return bpm; const b = Math.floor(barAt(s, c.currentTime)), len = s.barTime(b + 1) - s.barTime(b); return len > 0 ? (clock.beatsPerBar * 60) / len : bpm; },
    barTime: (b) => { const s = band(); return s ? s.barTime(b) : (b * 240) / bpm; },
    barAt: (t) => barAt(band(), t == null ? c.currentTime : t),
    bar: () => clock.barAt(c.currentTime),
    // where t is in a cycle of `bars` bars, 0 to 1 (bars: 1 a bar, 2 two bars from an even one, 1/4 a beat in 4/4)
    phaseAt: (t, bars = 1) => { const x = clock.barAt(t) / (bars || 1); return x - Math.floor(x); },
    // the first bar line after t (default now): { bar, time, len (that bar's length in seconds) }
    next: (t) => { const s = band(), b = Math.floor(barAt(s, t == null ? c.currentTime : t)) + 1, time = clock.barTime(b); return { bar: b, time, len: clock.barTime(b + 1) - time }; },
  };
  // A pedal's sync(x) hears about the clock: 'build' (once, after its first set), 'start' / 'stop' (the band), 'tempo',
  // 'jump' (the grid moved: a seek, a loop that isn't a whole number of bars) and 'bar' (each new bar, about a bar ahead).
  function syncOne(n, why) {
    if (!n.w.p.sync) return;
    const nx = clock.next(), x = { why, playing: clock.playing, bpm: clock.bpm, beatsPerBar: clock.beatsPerBar, bar: nx.bar, next: nx.time, barLen: nx.len, now: c.currentTime,
      phaseAt: clock.phaseAt, barTime: clock.barTime, barAt: clock.barAt, clock };
    try { n.w.p.sync(x); } catch (e) { if (!n.syncErr) console.error('pedal ' + n.def.id + ' sync:', e); n.syncErr = true; }
  }
  // Live: one watcher for the whole board (so pedals don't each run timers), ten times a second while any pedal syncs.
  let grid = null, watchT = 0;
  function watch() {
    watchT = 0;
    if (!live || c.state === 'closed') return;
    const who = [...inst.values()].filter((n) => n.w.p.sync);
    if (!who.length) { grid = null; return; }
    const nx = clock.next(), g = { playing: clock.playing, bpm: clock.bpm, time: nx.time, len: nx.len };
    let why = null;
    if (grid) {
      if (g.playing !== grid.playing) why = g.playing ? 'start' : 'stop';
      else if (Math.abs(g.bpm - grid.bpm) > 1e-6) why = 'tempo';
      else if (Math.abs(g.time - grid.time) <= 0.002) why = null;
      else why = Math.abs(g.time - (grid.time + grid.len)) <= 0.002 ? 'bar' : 'jump';
    }
    grid = g;
    if (why) for (const n of who) syncOne(n, why);
    watchT = setTimeout(watch, 100);
  }
  const watching = () => { if (live && !watchT) watchT = setTimeout(watch, 0); };
  // a stable number per instance (FNV-1a of its uid): kit.seed, for pedals that want their own random-ish but repeatable
  const seedOf = (uid) => { let h = 2166136261; for (const ch of String(uid)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h || 1; };

  // A pedal in its bypass wrapper.
  function make(def, uid) {
    const own = { src: [], timers: [], fns: [], wk: [] }, kit = PFX.kit(c, own);
    kit.uid = uid; kit.seed = seedOf(uid); kit.clock = clock;
    let p;
    try { p = def.build(c, kit); } catch (e) { console.error('pedal ' + def.id + ':', e); p = null; }
    if (!p || !p.input || !p.output) { const n = K.G(1); p = { input: n, output: n, set() {} }; }
    // insert: in -> dry -> out, in -> pedal -> wet (its trim when on) -> out. trails: in -> dry (always) -> out,
    // in -> wet (the send) -> pedal -> its trim -> out.
    const i = K.G(1), o = K.G(1), dry = K.G(1), wet = K.G(0), trim = PFX.dB(def.trim || 0);
    i.connect(dry); dry.connect(o);
    let fed = false;
    const feed = (on) => { if (on && !fed) { i.connect(p.input); fed = true; } else if (!on && fed) { try { i.disconnect(p.input); } catch (e) { /* gone */ } fed = false; } };
    if (def.trails) { const post = K.G(trim); i.connect(wet); wet.connect(p.input); p.output.connect(post); post.connect(o); }
    else { p.output.connect(wet); wet.connect(o); }
    let offAt = 0;
    // the footswitch: a 10 ms raised-cosine crossfade (the first time: straight there)
    const sw = (param, v, ctx) => { if (ctx.first) param.setValueAtTime(v, ctx.t); else pfxGlide(c, param, v, 0.01, ctx.t); };
    const w = { input: i, output: o, p, on: false,
      set(v, ctx) {
        try { p.set && p.set(v, ctx); } catch (e) { console.error('pedal ' + def.id + ' set:', e); }
        const on = !!v.on;
        if (!def.trails) {
          // an insert pedal off for a moment stops being fed (it costs nothing), and is fed again as it comes on
          clearTimeout(offAt);
          if (on) feed(true);
          else if (ctx.first) feed(false);
          else { const quiet = Math.max(c.currentTime, ctx.t) + 0.02, off = () => { if (w.on) return; if (c.currentTime < quiet && c.state === 'running') offAt = setTimeout(off, 10); else feed(false); }; offAt = setTimeout(off, 80); }
          sw(dry.gain, on ? 0 : 1, ctx); sw(wet.gain, on ? trim : 0, ctx);
        } else sw(wet.gain, on ? 1 : 0, ctx);
        w.on = on;
      },
      get latency() { return !def.trails && w.on ? p.latency || 0 : 0; },
      dispose() {
        clearTimeout(offAt);
        for (const t of own.timers) clearTimeout(t);
        for (const s of own.src) { try { s.stop(); } catch (e) { /* not started */ } try { s.disconnect(); } catch (e) { /* gone */ } }
        for (const fn of own.fns) { try { fn(); } catch (e) { /* its business */ } }
        try { p.dispose && p.dispose(); } catch (e) { console.error('pedal ' + def.id + ' dispose:', e); }
        try { i.disconnect(); o.disconnect(); p.output.disconnect(); } catch (e) { /* gone */ }
        for (const n of own.wk) pfxEnd(n); // (its worklets stop being processed: pfxWorklet)
      } };
    return w;
  }
  // Connect input -> the board in order (the amp where it is) -> fade.
  function wire(list) {
    fadeIn.disconnect();
    for (const n of wired || []) { try { n.output.disconnect(); } catch (e) { /* gone */ } }
    let at = fadeIn;
    for (const n of list) { at.connect(n.input); at = n.output; }
    at.connect(fade);
    wired = list;
  }
  // at (optional, live only): the audio time the change lands at, a little ahead (scenes.js: on the bar line). Knobs
  // glide and switches fade from then; a rewire's dip starts then. Until then the sound is as it was.
  function set(P, songBpm, at) {
    cur = P;
    const tempoMoved = !!songBpm && songBpm !== bpm;
    if (songBpm) bpm = songBpm;
    at = live && at > c.currentTime ? Math.min(at, c.currentTime + 1) : 0;
    amp.set(P, at);
    const board = Array.isArray(P.board) ? P.board : boardDefault();
    // who's on the board now (built, or waiting for their worklets)
    const want = [];
    for (const e of board) {
      if (e === 'amp' || (e && e.id === 'amp')) { want.push(amp); continue; }
      const def = e && PEDAL_DEFS[e.id];
      if (!def) continue;
      const uid = e.uid || e.id;
      let n = inst.get(uid);
      if (n && n.def !== def) { n.w.dispose(); inst.delete(uid); n = null; }
      if (!n) {
        const ok = pfxReady(c, def);
        if (ok !== true) { waiting.push(ok.then(() => cur && set(cur))); continue; }
        n = { def, uid, w: make(def, uid), key: null, first: true };
        inst.set(uid, n);
      }
      const key = JSON.stringify(e);
      if (key !== n.key || tempoMoved) {
        const first = n.first, t = at || c.currentTime;
        const to = (param, v, tc) => { if (first) param.setValueAtTime(v, t); else param.setTargetAtTime(v, t, tc || 0.015); };
        // a trails pedal switched off (a preset change: its knobs change too) keeps the knobs its tail is ringing
        // with: a delay's time or a reverb's size moved under a tail warps it (a chirp you can measure). The new
        // ones go in when it's next on.
        const hold = !first && def.trails && !e.on && n.w.on && n.set ? Object.assign({}, n.set, { on: false }) : null;
        n.w.set(hold || e, { bpm, first, t, to, note: (x) => PFX.noteSec(x, bpm), clock, phaseAt: clock.phaseAt });
        n.key = key; n.first = false; n.set = Object.assign({}, hold || e);
        if (first && n.w.p.sync) { syncOne(n, 'build'); watching(); }
      }
      want.push(n.w);
    }
    const gone = [...inst.values()].filter((n) => !want.includes(n.w));
    for (const n of gone) inst.delete(n.uid);
    const same = wired && wired.length === want.length && wired.every((n, i) => n === want[i]);
    if (same) return;
    // first time, or rendering offline before it starts: straight in. Live: fade the chain's input and output out,
    // rewire, let it settle, fade both back in (so what's inside only ever switches between silences). Raised-cosine
    // fades, smooth at both ends (an exponential one starts with a kink you can measure). About 70 ms of dip.
    if (!wired || !live) { wire(want); for (const n of gone) n.w.dispose(); return; }
    for (const n of gone) dying.push(n.w); // (disposed once they're out of the chain: a quick second change mustn't lose them)
    clearTimeout(rewire);
    const t0 = at || c.currentTime;
    ramp(0, t0);
    // (by the audio clock, not the wall's: on a starved audio thread 30 ms of wall time can be less of audio, and a
    // rewire before the fade is down is a click)
    const quiet = t0 + 0.022;
    const go = () => {
      if (c.currentTime < quiet && c.state === 'running') { rewire = setTimeout(go, 5); return; }
      wire(want);
      for (const w of dying.splice(0)) w.dispose();
      // back in 23 ms after the dip is down, by the audio clock (so a change scheduled onto a bar line comes back on
      // time), and at least 12 ms after the rewire (which reaches the audio thread a render quantum or two later)
      ramp(1, Math.max(c.currentTime + 0.012, quiet + 0.023));
    };
    rewire = setTimeout(go, Math.max(30, (quiet - c.currentTime) * 1000 + 2));
  }
  // both fades to v over 15 ms, from audio time `at` (or now)
  function ramp(v, at) { pfxGlide(c, fadeIn.gain, v, 0.015, at); pfxGlide(c, fade.gain, v, 0.015, at); }
  return {
    input, output, set,
    // the song's tempo moved (tempo-synced pedals follow it)
    tempo(b) { if (cur && b && b !== bpm) set(cur, b); },
    // resolves once every pedal on the board is built (worklets loaded)
    async ready() { while (waiting.length) { const w = waiting; waiting = []; await Promise.all(w); } },
    // a pedal's build() result by uid (tests: its nodes)
    pedal: (uid) => (inst.get(uid) ? inst.get(uid).w.p : null),
    get latency() { let s = amp.latency || 0; for (const n of inst.values()) s += n.w.latency; return s; },
    // the bar clock pedals lock to (above), and a different source for it (undefined: the band's; null: the free grid)
    clock,
    useClock(s) { clockSrc = s; grid = null; for (const n of inst.values()) syncOne(n, 'jump'); watching(); },
    // unplugged: every pedal's dispose (their LFOs, timers), and the clock's watcher stops
    dispose() {
      clearTimeout(watchT); watchT = 0; clearTimeout(rewire);
      for (const n of inst.values()) n.w.dispose();
      for (const w of dying.splice(0)) w.dispose();
      inst.clear(); cur = null;
      try { if (amp && amp.dispose) amp.dispose(); } catch (e) { /* gone */ }
      try { input.disconnect(); output.disconnect(); } catch (e) { /* gone */ }
    },
  };
}

/* ---- what a board costs on this device: renders `secs` of it (a 110 Hz tone in, the amp as it's set if plugAmp is
   there, the pedals as they're set, on or off) offline and times it, as a percentage of real time on one core. The
   board UI shows it (pedalboard.js) because 14 heavy pedals on a slow phone can be more than its audio thread manages
   (measured on an M-series Mac: the fourteen costliest pedals together, about 11%). Resolves null if it can't. */
async function pedalLoad(P, secs = 0.25) {
  if (typeof OfflineAudioContext === 'undefined') return null;
  try {
    const sr = 48000, c = new OfflineAudioContext(2, Math.round(sr * secs), sr), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 110; g.gain.value = 0.2; o.connect(g);
    let amp = null;
    try { amp = typeof plugAmp === 'function' ? plugAmp(c) : null; } catch (e) { amp = null; } // (plugin.js, later in the page)
    if (!amp) { const n = c.createGain(); amp = { input: n, output: n, set() {}, latency: 0 }; }
    const r = pedalRig(c, amp);
    r.set(P, 120); await r.ready(); r.set(P, 120);
    g.connect(r.input); r.output.connect(c.destination); o.start();
    const t0 = performance.now();
    await c.startRendering();
    return ((performance.now() - t0) / 1000 / secs) * 100;
  } catch (e) { return null; }
}

/* ---- the rotary knob: drag up or right (Shift for fine), arrow keys, double-click for its default; its value pops up
   while you turn it. (--kv on it: where it is, 0 to 1, for faces that draw it their own way, like a treadle) */
function plugKnob({ label, min, max, step, value, def, fmt, onInput, name }) {
  const w = document.createElement('div');
  w.className = 'kn';
  const f = fmt || ((v) => (+v).toFixed(1));
  w.innerHTML = `<div class="kn-dial" role="slider" tabindex="0" aria-label="${name ? name + ' ' : ''}${label.toLowerCase()}" aria-valuemin="${min}" aria-valuemax="${max}"><div class="kn-cap"><i></i></div></div><span class="kn-l">${label}</span><output class="kn-v"></output><span class="kn-tip" aria-hidden="true"></span>`;
  const dial = w.firstChild, cap = dial.firstChild, out = w.querySelector('.kn-v'), tip = w.querySelector('.kn-tip');
  dial.title = 'Drag up or down to turn (Shift: fine). Double-click: reset';
  let v = value;
  const snap = (x) => { x = Math.max(min, Math.min(max, x)); return step ? Math.round(x / step) * step : Math.round(x * 10) / 10; };
  const draw = () => {
    cap.style.transform = `rotate(${-135 + (270 * (v - min)) / (max - min)}deg)`;
    w.style.setProperty('--kv', ((v - min) / (max - min)).toFixed(3));
    dial.setAttribute('aria-valuenow', v); dial.setAttribute('aria-valuetext', f(v)); out.textContent = tip.textContent = f(v);
  };
  const put = (x) => { x = snap(x); if (x === v) return; v = x; draw(); onInput(v); };
  let drag = null;
  dial.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, v, fine: e.shiftKey }; dial.setPointerCapture(e.pointerId); dial.focus({ preventScroll: true }); w.classList.add('drag'); e.preventDefault(); });
  dial.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // Shift mid-drag goes fine from where the knob is (no jump)
    if (e.shiftKey !== drag.fine) drag = { x: e.clientX, y: e.clientY, v, fine: e.shiftKey };
    const px = (e.clientX - drag.x) - (e.clientY - drag.y), span = drag.fine ? 600 : 150;
    put(drag.v + (px / span) * (max - min));
  });
  const end = () => { drag = null; w.classList.remove('drag'); };
  dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
  dial.addEventListener('dblclick', () => put(def));
  dial.addEventListener('keydown', (e) => {
    if (e.altKey) return; // (Alt+arrows move the pedal)
    const s = step || (max - min) / 100, big = step ? step : (max - min) / 10;
    const d = { ArrowUp: s, ArrowRight: s, ArrowDown: -s, ArrowLeft: -s, PageUp: big, PageDown: -big }[e.key];
    if (d != null) { e.preventDefault(); put(v + d); } else if (e.key === 'Home') { e.preventDefault(); put(min); } else if (e.key === 'End') { e.preventDefault(); put(max); }
  });
  draw();
  w.setValue = (x) => { v = snap(x); draw(); };
  return w;
}
