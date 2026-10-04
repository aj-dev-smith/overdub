// vendored verbatim from clawd-o-matic/web/pedals/70-glitch.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: the glitch shelf (cat 'glitch'). docs/PEDALS.md says how a pack works. */
// The weird ones: pedals a browser can do and a soldering iron mostly can't. Most are an AudioWorklet each (lean,
// seeded, nothing allocated in process()), and the tempo-synced ones share a beat grid: the song's bpm as a k-rate
// param, and, while the band plays, where its bars start (posted once it changes), so a repeat lands on the band's beat.
// Levels measured with tools/pedal-check.js against the synthetic DI strum.
{
// Every processor here starts with this: a seeded LCG (never Math.random: renders are the same every time) and the
// band's beat. t0 is the audio time of a bar line (mod one bar), 0 until the band plays: offline, the grid starts with
// the render.
const GL_BASE = `
class GlBase extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const po = (o && o.processorOptions) || {};
    this.s = (po.seed >>> 0) || 1; this.t0 = 0;
    this.port.onmessage = (e) => { if (e.data && Number.isFinite(e.data.t0)) this.t0 = e.data.t0; };
  }
  rnd() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  beat(bpm) { return ((currentFrame / sampleRate - this.t0) * bpm) / 60; }
}
`;
// A two-tap delay-line pitch shifter (Crab Walk, Shellac Clam): taps half a window apart, sawing through the window at
// (1 - ratio), Hann-crossfaded so one is always silent as it jumps. At a ratio of 1 the phase settles at 0.5 (one tap
// only) rather than sitting where it stopped, which would leave two taps and a comb.
const GL_SHIFT = `
class GlShift {
  constructor(W) { this.b = new Float32Array(8192); this.w = 0; this.ph = 0.5; this.W = W; }
  run(x, r, e) {
    const b = this.b, W = this.W;
    b[this.w] = x;
    let ph = this.ph;
    if (Math.abs(1 - r) < 1e-6) ph += (0.5 - ph) * 0.00005;
    else { ph += (1 - r) / W; ph -= Math.floor(ph); }
    this.ph = ph;
    const p2 = ph >= 0.5 ? ph - 0.5 : ph + 0.5, g = 0.5 - 0.5 * Math.cos(6.283185307 * ph);
    const y = this.tap(ph * W + e + 1) * g + this.tap(p2 * W + e + 1) * (1 - g);
    this.w = (this.w + 1) & 8191;
    return y;
  }
  tap(d) { const p = this.w - d, i = Math.floor(p), f = p - i, b = this.b; return b[i & 8191] * (1 - f) + b[(i + 1) & 8191] * f; }
}
`;
const glProc = (name, cls, body) => GL_BASE + body + `\nregisterProcessor('${name}', ${cls});`;

// A worklet node, mono in (a stereo pedal before it is summed), with its own seed: the nth of these on a context gets n
// (a fresh context per render offline, so the same every time; two of a pedal on a board don't glitch in lockstep).
const glNode = (c, k, name, chans, extra) => {
  c.__glSeed = (c.__glSeed || 0) + 1;
  return k.worklet(name, Object.assign({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [chans || 1], channelCount: 1, channelCountMode: 'explicit',
    processorOptions: { seed: 0x9e3779b1 ^ (c.__glSeed * 2654435761) } }, extra || {}));
};
// Keep a worklet's beat grid on the band's bars while it plays (a live context only; checked twice a second).
const glSync = (c, k, node) => {
  if (!node || !node.port || (typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext)) return;
  let last = null;
  const tick = () => {
    try {
      if (typeof PLUG !== 'undefined' && PLUG.clock.playing() && (!PLUG._bus || PLUG._bus.c === c)) {
        const bar = PLUG.clock.barTime(Math.floor(PLUG.clock.bar())), len = (240 / PLUG.clock.bpm()) || 2, t0 = ((bar % len) + len) % len;
        // (circular distance: a grid that only moved by whole bars hasn't moved)
        const moved = last == null ? 1 : Math.min(Math.abs(t0 - last), len - Math.abs(t0 - last));
        if (Number.isFinite(t0) && moved > 0.002) { node.port.postMessage({ t0 }); last = t0; }
      }
    } catch (e) { /* no band yet */ }
    k.later(tick, 500);
  };
  tick();
};
const glP = (n, key) => (n && n.parameters ? n.parameters.get(key) : null);
// a switch-like param: straight there (a glide through 1.5 would mean something)
const glSet = (x, prm, v) => { if (prm) { prm.cancelScheduledValues(x.t); prm.setValueAtTime(v, x.t); } };
const glTo = (x, prm, v) => { if (prm) x.to(prm, v); };
// dry and wet at an equal-power blend (m 0 to 1)
const glMix = (x, dry, wet, m, wetGain) => { x.to(dry.gain, Math.cos((m * Math.PI) / 2)); x.to(wet.gain, Math.sin((m * Math.PI) / 2) * (wetGain || 1)); };
const GL_BEATS = ['1/4', '1/8', '1/16', '1/32'], GL_BEAT_Q = [1, 0.5, 0.25, 0.125];
const glBeatFmt = (v) => GL_BEATS[Math.max(0, Math.min(3, Math.round(v)))];

/* ---- Bit Reef: a bitcrusher and sample-rate reducer, with a jittery clock */
const BITREEF = glProc('bitreef-crush', 'BitReef', `
class BitReef extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bits', defaultValue: 6, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
    { name: 'rate', defaultValue: 8000, minValue: 50, maxValue: 96000, automationRate: 'k-rate' },
    { name: 'jitter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.ph = 0; this.h = 0; this.next = 1; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    if (!x) { o.fill(0); return true; }
    // (the converter sees the guitar about 10 dB hotter than it is: a DI peaks near -10 dBFS, so BITS means bits)
    const q = Math.pow(2, p.bits[0] - 1), inc = Math.min(1, p.rate[0] / sampleRate), j = p.jitter[0];
    for (let n = 0; n < o.length; n++) {
      this.ph += inc;
      if (this.ph >= this.next) { this.ph -= this.next; const v = x[n] * 3; this.h = v > 1 ? 1 : v < -1 ? -1 : v; this.next = 1 + j * (this.rnd() - 0.5) * 1.6; }
      o[n] = Math.round(this.h * q) / (q * 3);
    }
    return true;
  }
}`);
const glRateHz = (v) => 48000 * Math.pow(2, -v * 0.6);
pedalDef({
  id: 'bitreef', name: 'Bit Reef', kind: 'BITCRUSHER', cat: 'glitch', where: 'pre', color: '#18203f', ink: '#5cf2c7',
  nod: 'the crunchy sample-rate crushers of early samplers and lo-fi boxes', blurb: 'Crush your tone to 8-bit grit and aliased fizz',
  look: { shape: 'box', finish: 'check', knob: 'small', label: 'block', led: '#5cf2c7' },
  worklets: { 'bitreef-crush': BITREEF }, trim: 1.3,
  knobs: [['bits', 'BITS', 2, 16, 6, 1, (v) => Math.round(v) + '-bit'], ['rate', 'RATE', 0, 10, 5, 0, (v) => (glRateHz(v) / 1000).toFixed(1) + 'k'],
    ['jit', 'JITTER', 0, 10, 2], ['mix', 'MIX', 0, 10, 8]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), dry = k.G(0), wet = k.G(1), n = glNode(c, k, 'bitreef-crush');
    // (after it: the DC and the very top taken off, nothing more; the aliasing is the point)
    k.chain(input, n || k.G(1), k.F('highpass', 25, 0), k.F('lowpass', 14000, 0), wet, output);
    k.chain(input, dry, output);
    return { input, output, set(v, x) {
      glTo(x, glP(n, 'bits'), v.bits); glTo(x, glP(n, 'rate'), glRateHz(v.rate)); glTo(x, glP(n, 'jitter'), v.jit / 10);
      glMix(x, dry, wet, v.mix / 10);
    } };
  },
});

/* ---- Krill Roll: a beat repeat. On a beat, now and then, it grabs the slice you just played and loops it for the beat,
   each repeat shorter (the roll) and quieter (the decay) than the last. */
const KRILL = glProc('krillroll-rep', 'KrillRoll', `
class KrillRoll extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'slice', defaultValue: 0.25, minValue: 0.05, maxValue: 1, automationRate: 'k-rate' },
    { name: 'chance', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'roll', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'decay', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.N = Math.round(sampleRate * 4); this.buf = new Float32Array(this.N); this.w = 0; this.cell = null; this.ev = 0; this.st = 0; this.len = 1; this.cur = 1; this.pos = 0; this.g = 1; this.m = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const N = this.N, buf = this.buf, bpm = p.bpm[0], spb = (60 / bpm) * sampleRate, db = 1 / spb, sl = p.slice[0];
    const chance = p.chance[0], shrink = 1 - p.roll[0] * 0.5, fall = 1 - p.decay[0] * 0.35, F = Math.round(sampleRate * 0.002), mk = 1 / Math.round(sampleRate * 0.0015);
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const v = x ? x[n] : 0;
      buf[this.w] = v;
      const cell = Math.floor(b);
      if (cell !== this.cell) {
        const first = this.cell === null, r = this.rnd();
        this.cell = cell;
        if (!first && this.ev <= 0 && r < chance) {
          // the slice that ends now, looped for a beat (two when the slice is a whole beat)
          const len = Math.max(F * 4, Math.min(N >> 1, Math.round(sl * spb)));
          this.st = (this.w - len + 1 + N) % N; this.len = this.cur = len; this.pos = 0; this.g = 1;
          this.ev = Math.round(spb * (sl > 0.9 ? 2 : 1));
        }
      }
      let y = 0;
      if (this.ev > 0) {
        const e = Math.min(1, this.pos / F, (this.cur - this.pos) / F, this.ev / F);
        y = buf[(this.st + this.pos) % N] * this.g * e;
        this.ev--;
        if (++this.pos >= this.cur) { this.pos = 0; this.g *= fall; this.cur = Math.max(F * 2 + 8, Math.round(this.len / 16), Math.round(this.cur * shrink)); }
      }
      const t = this.ev > 0 ? 1 : 0;
      this.m += t > this.m ? Math.min(mk, t - this.m) : Math.max(-mk, t - this.m);
      o[n] = v * (1 - this.m) + y * this.m;
      this.w = this.w + 1 === N ? 0 : this.w + 1;
    }
    return true;
  }
}`);
pedalDef({
  id: 'krillroll', name: 'Krill Roll', kind: 'BEAT REPEAT', cat: 'glitch', where: 'pre', color: '#ff6a3d', ink: '#1c0904',
  nod: 'the beat-repeat and stutter effects of laptop producers and DJ mixers', blurb: 'Grabs a slice of you and rolls it, locked to the band',
  look: { shape: 'box', finish: 'stripe', knob: 'chicken', label: 'stencil', led: '#fff04d' },
  worklets: { 'krillroll-rep': KRILL },
  knobs: [['slice', 'SLICE', 0, 3, 2, 1, glBeatFmt], ['chance', 'CHANCE', 0, 10, 3], ['roll', 'ROLL', 0, 10, 3], ['decay', 'DECAY', 0, 10, 2]],
  build(c, k) {
    const n = glNode(c, k, 'krillroll-rep'), io = n || k.G(1);
    glSync(c, k, n);
    return { input: io, output: io, node: n, set(v, x) {
      glTo(x, glP(n, 'bpm'), x.bpm); glSet(x, glP(n, 'slice'), GL_BEAT_Q[Math.round(v.slice)]);
      glTo(x, glP(n, 'chance'), v.chance / 10); glTo(x, glP(n, 'roll'), v.roll / 10); glTo(x, glP(n, 'decay'), v.decay / 10);
    } };
  },
});

/* ---- Tape Snail: a tape stop. The reel brakes to a halt over TIME and spins back up over SPIN: on the last beat of
   every bar or four (AUTO), or when you hold the second footswitch on STOP. */
const SNAIL = glProc('tapesnail-vs', 'TapeSnail', `
class TapeSnail extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'stop', defaultValue: 1, minValue: 0.0625, maxValue: 4, automationRate: 'k-rate' },
    { name: 'spin', defaultValue: 0.25, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    { name: 'auto', defaultValue: 0, minValue: 0, maxValue: 64, automationRate: 'k-rate' },
    { name: 'hold', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.N = Math.round(sampleRate * 6); this.buf = new Float32Array(this.N); this.w = 0; this.rd = 0; this.sp = 1; this.dir = 1; this.xf = 1; this.lp = -1; this.brk = false; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const N = this.N, buf = this.buf, bpm = p.bpm[0], spbS = 60 / bpm, db = bpm / 60 / sampleRate;
    const stopB = p.stop[0], dec = 1 / Math.max(64, stopB * spbS * sampleRate), inc = p.spin[0] > 0.01 ? 1 / (p.spin[0] * spbS * sampleRate) : 1;
    const per = p.auto[0], hold = p.hold[0] > 0.5, xinc = 1 / (0.006 * sampleRate);
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const v = x ? x[n] : 0, wi = this.w % N;
      buf[wi] = v;
      // AUTO: brake stop beats before the end of every per beats; let go on the bar line
      if (per > 0) {
        const ph = ((b % per) + per) % per, at = per - stopB;
        if (this.lp >= 0) { if (this.lp < at && ph >= at) this.brk = true; if (ph < this.lp) this.brk = false; }
        this.lp = ph;
      } else { this.brk = false; this.lp = -1; }
      const want = hold || this.brk ? -1 : 1;
      if (want !== this.dir) {
        if (want < 0 && this.xf >= 1) { this.rd = this.w; this.xf = 0; } // (from the live signal: the tape is it, so no seam)
        if (want > 0 && this.sp <= 0) this.rd = this.w; // (from a standstill: spin up on what's coming in now)
        this.dir = want;
      }
      this.sp = this.dir < 0 ? Math.max(0, this.sp - dec) : Math.min(1, this.sp + inc);
      let tape = 0;
      if (this.xf < 1) {
        if (this.w - this.rd > N - 4) this.rd = this.w - N + 4;
        const i = Math.floor(this.rd), f = this.rd - i, a = buf[i % N], c = buf[(i + 1) % N];
        // (the level falls with the speed at the very end: a stopped reel is silence, not a thump)
        tape = (a + (c - a) * f) * Math.min(1, this.sp * 3);
        this.rd = Math.min(this.w, this.rd + this.sp);
        if (this.dir > 0 && this.sp >= 1) this.xf = Math.min(1, this.xf + xinc);
      }
      o[n] = v * this.xf + tape * (1 - this.xf);
      this.w++;
      if (this.xf >= 1) this.rd = this.w;
    }
    return true;
  }
}`);
const GL_SPIN = ['snap', '1/16', '1/8', '1/4', '1/2'], GL_SPIN_Q = [0, 0.25, 0.5, 1, 2];
pedalDef({
  id: 'tapesnail', name: 'Tape Snail', kind: 'TAPE STOP', cat: 'glitch', where: 'pre', color: '#d8cbb0', ink: '#3a2716',
  nod: 'a hand on the tape reel: the stop at the end of every drop', blurb: 'Grinds to a halt at the end of the bar and spins back',
  look: { shape: 'wide', finish: 'brushed', knob: 'cream', label: 'plate', led: '#ff3b30', foot2: 'stop' },
  worklets: { 'tapesnail-vs': SNAIL },
  knobs: [['time', 'TIME', 0, 5, 3, 1, PFX.noteFmt], ['spin', 'SPIN', 0, 4, 1, 1, (v) => GL_SPIN[Math.round(v)] || 'snap'],
    { key: 'auto', label: 'AUTO', opts: ['FOOT', '1 BAR', '4 BAR'], def: 2 }, { key: 'stop', label: 'REEL', opts: ['PLAY', 'STOP'], def: 0 }],
  build(c, k) {
    const n = glNode(c, k, 'tapesnail-vs'), io = n || k.G(1);
    glSync(c, k, n);
    return { input: io, output: io, node: n, set(v, x) {
      glTo(x, glP(n, 'bpm'), x.bpm);
      glSet(x, glP(n, 'stop'), DELAY_NOTES[Math.round(v.time)][1]); glSet(x, glP(n, 'spin'), GL_SPIN_Q[Math.round(v.spin)]);
      glSet(x, glP(n, 'auto'), [0, 4, 16][Math.round(v.auto)]); glSet(x, glP(n, 'hold'), v.stop ? 1 : 0);
    } };
  },
});

/* ---- Coral FM: a transistor radio that won't stay tuned. Your amp is the station; the dial wanders off it into static
   and a heterodyne whistle (which falls to nothing as it finds the station again, as a real one does). All native nodes:
   the dial is two slow waves, and wave shapers turn where it is into how clear the station is. */
pedalDef({
  id: 'coralfm', name: 'Coral FM', kind: 'RADIO TUNER', cat: 'glitch', where: 'post', color: '#8a4b2d', ink: '#ffe9c2',
  nod: 'a transistor radio drifting off its station late at night', blurb: 'You’re the station on a radio that won’t stay tuned',
  look: { shape: 'rack', finish: 'hammer', knob: 'chrome', label: 'plate', led: '#ffb347' },
  worklets: { 'pfx-env': PFX.ENV }, trim: 2.9,
  knobs: [['tune', 'DRIFT', 0, 10, 4], ['speed', 'WANDER', 0, 10, 4], ['stat', 'STATIC', 0, 10, 4], { key: 'band', label: 'BAND', opts: ['AM', 'SW', 'FM'], def: 0 }],
  build(c, k) {
    const input = k.G(1), output = k.G(1);
    // the station: a small radio's band and its little output stage, fading in and out (the ionosphere)
    const hp = k.F('highpass', 300, 0), lp = k.F('lowpass', 2800, 0), mid = k.F('peaking', 1500, 1, 3), sat = k.shaper(2, 0.1), sig = k.G(0), fade = k.G(0.88);
    k.chain(input, hp, lp, mid, sat, sig, fade, output);
    k.chain(k.lfo(0.23), k.G(0.12), fade.gain);
    // the dial: two slow waves that never line up, times DRIFT
    const d1 = k.lfo(0.08, [1, 0, 0.35, 0.2]), d2 = k.lfo(0.03, 'triangle'), d2g = k.G(0.45), depth = k.G(0);
    d1.connect(depth); k.chain(d2, d2g, depth);
    // how clear it is (never quite gone), and how much static there is (a little even on the station)
    const clear = k.curve((u) => 0.12 + 0.88 * Math.exp(-((u / 0.28) ** 2)), 'none'), fuzzy = k.curve((u) => 0.1 + 0.9 * (1 - Math.exp(-((u / 0.28) ** 2))), 'none');
    depth.connect(clear); depth.connect(fuzzy);
    clear.connect(sig.gain);
    // static and the whistle only while you play (they fade with your notes, so the radio's quiet when you are)
    const env = k.envelope({ attack: 0.01, release: 0.45 });
    if (env) {
      input.connect(env);
      const nz = k.noiseSource({ secs: 3, seed: 71, color: 'white' }), sN = k.G(0), sE = k.G(0), stat = k.G(0);
      k.chain(nz, k.F('bandpass', 2600, 0.5), k.F('highpass', 700, 0), sN, sE, output);
      fuzzy.connect(sN.gain); k.chain(env, stat, sE.gain);
      // the whistle: the beat between the carrier and where the dial is (0 Hz on the station)
      const wh = k.lfo(0, 'sine'), wN = k.G(0), wE = k.G(0), whL = k.G(0);
      k.chain(depth, k.G(2400), wh.frequency);
      k.chain(wh, wN, wE, whL, output);
      fuzzy.connect(wN.gain); env.connect(wE.gain);
      return { input, output, set: (v, x) => set(v, x, stat, whL) };
    }
    return { input, output, set: (v, x) => set(v, x, null, null) };
    function set(v, x, stat, whL) {
      const band = Math.round(v.band);
      x.to(depth.gain, v.tune * 0.07); // (DRIFT 10: the dial swings right off the station)
      const r = 0.02 * Math.pow(2, v.speed * 0.45); // 0.02 to 0.45 Hz
      x.to(d1.frequency, r); x.to(d2.frequency, r * 0.37);
      x.to(hp.frequency, [300, 450, 90][band]); x.to(lp.frequency, [2800, 2300, 9000][band]); x.to(mid.gain, [3, 6, 0][band]);
      if (stat) x.to(stat.gain, (v.stat / 10) * [0.5, 0.65, 0.25][band]);
      if (whL) x.to(whL.gain, (v.stat / 10) * [0.25, 0.4, 0.05][band]);
    }
  },
});

/* ---- Hermit Hold: the random stepped filter. A worklet makes a new random value on each note of the band's tempo
   (with SMOOTH, it slides there), which moves a resonant 24 dB low-pass in cents. */
const HERMIT = glProc('hermithold-sh', 'HermitHold', `
class HermitHold extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'beats', defaultValue: 0.5, minValue: 0.0625, maxValue: 4, automationRate: 'k-rate' },
    { name: 'slew', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.v = 0; this.t = 0; this.cell = null; }
  process(ins, outs, p) {
    const o = outs[0][0];
    if (!o) return true;
    const bpm = p.bpm[0], sl = p.beats[0], db = bpm / 60 / sampleRate;
    // (never an instant step: a resonant filter jumping clicks. 1.5 ms at least)
    const secs = Math.max(0.0015, p.slew[0] * sl * (60 / bpm) * 0.7), k = 1 - Math.exp(-1 / (secs * sampleRate));
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const cell = Math.floor(b / sl);
      if (cell !== this.cell) { this.cell = cell; this.t = this.rnd() * 2 - 1; }
      this.v += (this.t - this.v) * k;
      o[n] = this.v;
    }
    return true;
  }
}`);
pedalDef({
  id: 'hermithold', name: 'Hermit Hold', kind: 'SAMPLE & HOLD', cat: 'glitch', where: 'pre', color: '#6d35f0', ink: '#f4edff',
  nod: 'the random sample-and-hold filter of seventies modular synths', blurb: 'A filter that leaps somewhere new on every step',
  look: { shape: 'wide', finish: 'flat', knob: 'black', label: 'script', led: '#39ffec' },
  worklets: { 'hermithold-sh': HERMIT }, trim: 9.3,
  knobs: [['rate', 'RATE', 0, 5, 1, 1, PFX.noteFmt], ['range', 'RANGE', 0, 10, 6], ['freq', 'FREQ', 0, 10, 5], ['reso', 'RESO', 0, 10, 5], ['smooth', 'SMOOTH', 0, 10, 1], ['mix', 'MIX', 0, 10, 9]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), dry = k.G(0), wet = k.G(1);
    const f1 = k.F('lowpass', 900, 0), f2 = k.F('lowpass', 900, 6), cents = k.G(0);
    const n = k.worklet('hermithold-sh', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { seed: 0x51f15eed ^ ((c.__glSeed = (c.__glSeed || 0) + 1) * 2654435761) } });
    if (n) { k.chain(n, cents); cents.connect(f1.detune); cents.connect(f2.detune); glSync(c, k, n); }
    k.chain(input, f1, f2, wet, output);
    k.chain(input, dry, output);
    return { input, output, node: n, set(v, x) {
      glTo(x, glP(n, 'bpm'), x.bpm); glSet(x, glP(n, 'beats'), DELAY_NOTES[Math.round(v.rate)][1]); glTo(x, glP(n, 'slew'), v.smooth / 10);
      x.to(cents.gain, v.range * 180); // ±1800 cents (1.5 octaves) at 10
      const base = 180 * Math.pow(2, v.freq * 0.45); // 180 Hz to 4 kHz
      x.to(f1.frequency, base); x.to(f2.frequency, base);
      x.to(f2.Q, v.reso * 1.8); // (dB of resonance: 0 to 18)
      glMix(x, dry, wet, v.mix / 10);
    } };
  },
});

/* ---- Chewed Cable: the cable every band has and nobody bins. It cuts out (and the contact chatters as it goes and as it
   comes back), it crackles when you play, and the ground lifts with a hum. Everything rides your playing, so a quiet
   guitar is a quiet cable. */
const CHEWED = glProc('chewedcable-dsp', 'ChewedCable', `
class ChewedCable extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'broke', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'crackle', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'hum', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.el = 0; this.drop = 0; this.chat = 0; this.tick = 0; this.tgt = 1; this.g = 1; this.cr = 0; this.crL = 1; this.ca = 0; this.hp = 0; this.hl = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const br = p.broke[0], ck = p.crackle[0], hm = p.hum[0], sr = sampleRate;
    const pDrop = br > 0.001 ? (0.3 + 6 * br * br) / sr : 0, pCr = (ck * (0.3 + br) * 70) / sr;
    const rel = Math.exp(-1 / (0.6 * sr)), hk = 1 - Math.exp(-1 / (0.006 * sr)), dw = (6.283185307 * 60) / sr;
    for (let n = 0; n < o.length; n++) {
      const v = x ? x[n] : 0, a = Math.abs(v);
      this.el = a > this.el ? a : this.el * rel;
      // a dropout now and then; the contact chatters for a few ms each way
      if (this.drop > 0) { if (--this.drop === 0) this.chat = Math.round(sr * (0.002 + 0.01 * this.rnd())); }
      else if (this.rnd() < pDrop) { this.drop = Math.round(sr * (0.008 + this.rnd() * this.rnd() * (0.06 + 0.4 * br))); this.chat = Math.round(sr * (0.002 + 0.008 * this.rnd())); }
      if (this.chat > 0) { this.chat--; if (--this.tick <= 0) { this.tick = Math.round(sr * (0.0004 + 0.0018 * this.rnd())); this.tgt = this.rnd() < 0.5 ? 0 : 1; } }
      else this.tgt = this.drop > 0 ? 0 : 1;
      this.g += (this.tgt - this.g) * 0.25;
      let y = v * this.g;
      // crackle: short scratchy bursts, as loud as you're playing
      if (this.cr > 0) { this.cr--; y += this.ca * (this.rnd() * 2 - 1) * (this.cr / this.crL); }
      else if (this.rnd() < pCr) { this.cr = this.crL = Math.round(sr * (0.0003 + 0.002 * this.rnd())); this.ca = this.el * (0.4 + this.rnd()) * ck; }
      // the hum: loud while the ground's gone (a dropout), a whisper otherwise
      const ht = (this.drop > 0 ? 1 : 0.1 * br) * hm * Math.min(1, this.el * 6);
      this.hl += (ht - this.hl) * hk;
      this.hp += dw; if (this.hp > 6.283185307) this.hp -= 6.283185307;
      const s = Math.sin(this.hp);
      o[n] = y + this.hl * 0.09 * (s + 0.45 * (1 - 2 * s * s));
    }
    return true;
  }
}`);
pedalDef({
  id: 'chewedcable', name: 'Chewed Cable', kind: 'BROKEN CABLE', cat: 'glitch', where: 'pre', color: '#232323', ink: '#ffd60a',
  nod: 'the one cable every band has and nobody throws away', blurb: 'Crackles, cuts out and hums: the cable you should bin',
  look: { shape: 'round', finish: 'hammer', knob: 'small', label: 'stencil', led: '#ff9500' },
  worklets: { 'chewedcable-dsp': CHEWED }, trim: 0.3,
  knobs: [['broke', 'BROKEN', 0, 10, 4], ['crackle', 'CRACKLE', 0, 10, 5], ['hum', 'HUM', 0, 10, 3]],
  build(c, k) {
    const n = glNode(c, k, 'chewedcable-dsp'), io = n || k.G(1);
    return { input: io, output: io, node: n, set(v, x) { glTo(x, glP(n, 'broke'), v.broke / 10); glTo(x, glP(n, 'crackle'), v.crackle / 10); glTo(x, glP(n, 'hum'), v.hum / 10); } };
  },
});

/* ---- Data Kraken: a databender. On each chunk of the band's grid, by CHAOS, it replays the chunk you just played
   backwards, half speed, double speed or worse (WILD opens up the stranger speeds); otherwise you pass through. */
const KRAKEN = glProc('databend-dsp', 'DataKraken', `
const SPEEDS = [-1, 0.5, 1, 2, -2, -0.5, 1.5, 0.25];
class DataKraken extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'beats', defaultValue: 0.5, minValue: 0.0625, maxValue: 4, automationRate: 'k-rate' },
    { name: 'chaos', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'wild', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.N = Math.round(sampleRate * 4); this.buf = new Float32Array(this.N); this.w = 0; this.cell = null; this.left = 0; this.pos = 0; this.rd = 0; this.sp = 1; this.m = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const N = this.N, buf = this.buf, bpm = p.bpm[0], db = bpm / 60 / sampleRate, sl = p.beats[0], chaos = p.chaos[0], nS = 2 + Math.round(p.wild[0] * 6);
    const F = Math.round(sampleRate * 0.002), mk = 1 / Math.round(sampleRate * 0.0015);
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const v = x ? x[n] : 0;
      buf[this.w % N] = v;
      const cell = Math.floor(b / sl);
      if (cell !== this.cell) {
        const first = this.cell === null, r = this.rnd(), s = SPEEDS[Math.min(nS - 1, Math.floor(this.rnd() * nS))];
        this.cell = cell; this.left = 0;
        if (!first && r < chaos) {
          const len = Math.max(F * 4, Math.min(Math.round(sampleRate * 0.9), Math.round((sl * 60 / bpm) * sampleRate)));
          this.sp = s; this.left = len; this.pos = 0;
          // start where the read never overtakes the write: backwards from now, or far enough back to finish at now
          this.rd = s < 0 ? this.w - 1 : this.w - Math.max(1, s) * len;
        }
      }
      let y = 0;
      if (this.left > 0) {
        const e = Math.min(1, this.pos / F, this.left / F);
        if (this.rd < this.w - N + 4) this.rd = this.w - N + 4;
        if (this.rd < 0) this.rd = 0;
        const i = Math.floor(this.rd), f = this.rd - i, a = buf[i % N], c = buf[(i + 1) % N];
        y = (a + (c - a) * f) * e;
        this.rd = Math.min(this.w, this.rd + this.sp); this.pos++; this.left--;
      }
      const t = this.left > 0 ? 1 : 0;
      this.m += t > this.m ? Math.min(mk, t - this.m) : Math.max(-mk, t - this.m);
      o[n] = v * (1 - this.m) + y * this.m;
      this.w++;
    }
    return true;
  }
}`);
pedalDef({
  id: 'databend', name: 'Data Kraken', kind: 'DATA BENDER', cat: 'glitch', where: 'pre', color: '#16a37f', ink: '#eafff7',
  nod: 'circuit-bent toys and corrupted-file databending', blurb: 'Chops your playing up, backwards and at the wrong speed',
  look: { shape: 'box', finish: 'flat', knob: 'chrome', label: 'block', led: '#ff2bd6' },
  worklets: { 'databend-dsp': KRAKEN },
  knobs: [['chaos', 'CHAOS', 0, 10, 4], ['size', 'SIZE', 0, 5, 1, 1, PFX.noteFmt], ['wild', 'WILD', 0, 10, 5]],
  build(c, k) {
    const n = glNode(c, k, 'databend-dsp'), io = n || k.G(1);
    glSync(c, k, n);
    return { input: io, output: io, node: n, set(v, x) {
      glTo(x, glP(n, 'bpm'), x.bpm); glSet(x, glP(n, 'beats'), DELAY_NOTES[Math.round(v.size)][1]);
      glTo(x, glP(n, 'chaos'), v.chaos / 10); glTo(x, glP(n, 'wild'), v.wild / 10);
    } };
  },
});

const glBaud = (v) => Math.pow(2, v * 0.55); // 1 to 45 hops a second
/* ---- Modem Mantis: a ring modulator whose carrier hops between dial-up handshake tones, and which your guitar
   frequency-modulates (the screech). Under it, the carrier itself whines as loud as you play. */
const MANTIS = glProc('modemmantis-dsp', 'ModemMantis', `
const TONES = [1070, 1270, 2025, 2225, 1200, 2400, 980, 1180, 1650, 1850, 2100, 1300, 2300];
class ModemMantis extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'screech', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'baud', defaultValue: 8, minValue: 0.5, maxValue: 60, automationRate: 'k-rate' },
    { name: 'pitch', defaultValue: 1, minValue: 0.1, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.ph = 0; this.f = 1200; this.ft = 1200; this.hop = 0; this.e = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const sr = sampleRate, sc = p.screech[0], hopN = sr / p.baud[0], pitch = p.pitch[0], TAU = 6.283185307;
    const gl = 1 - Math.exp(-1 / (0.003 * sr)), at = 1 - Math.exp(-1 / (0.002 * sr)), rl = 1 - Math.exp(-1 / (0.15 * sr));
    for (let n = 0; n < o.length; n++) {
      const v = x ? x[n] : 0, a = Math.abs(v);
      if (--this.hop <= 0) { this.hop = hopN * (0.6 + 0.8 * this.rnd()); this.ft = TONES[Math.floor(this.rnd() * TONES.length)] * pitch; }
      this.f += (this.ft - this.f) * gl;
      this.e += (a - this.e) * (a > this.e ? at : rl);
      this.ph += (TAU * (this.f + sc * v * 4000)) / sr;
      this.ph -= TAU * Math.floor(this.ph / TAU);
      const cr = Math.sin(this.ph);
      o[n] = v * cr * 1.6 + cr * this.e * sc * 0.35;
    }
    return true;
  }
}`);
pedalDef({
  id: 'modemmantis', name: 'Modem Mantis', kind: 'DIAL-UP RING MOD', cat: 'glitch', where: 'pre', color: '#cdc6b1', ink: '#1f2e38',
  nod: 'the dial-up modem handshake, and the ring modulator', blurb: 'Your riff, screeching like a dial-up handshake',
  look: { shape: 'rack', finish: 'flat', knob: 'black', label: 'block', led: '#39ff14' },
  worklets: { 'modemmantis-dsp': MANTIS }, trim: -0.5,
  knobs: [['screech', 'SCREECH', 0, 10, 4], ['baud', 'BAUD', 0, 10, 4, 0, (v) => Math.round(glBaud(v) * 10) / 10 + '/s'], ['pitch', 'CARRIER', 0, 10, 5], ['mix', 'MIX', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), dry = k.G(0), wet = k.G(1), n = glNode(c, k, 'modemmantis-dsp');
    k.chain(input, n || k.G(0), k.F('highpass', 180, 0), k.F('lowpass', 7500, 0), wet, output);
    k.chain(input, dry, output);
    return { input, output, node: n, set(v, x) {
      glTo(x, glP(n, 'screech'), v.screech / 10); glTo(x, glP(n, 'baud'), glBaud(v.baud)); glTo(x, glP(n, 'pitch'), Math.pow(2, (v.pitch - 5) * 0.3));
      glMix(x, dry, wet, v.mix / 10);
    } };
  },
});

/* ---- Pixel Prawn: an 8-bit arcade voice. It tracks your pitch (a light YIN on a quarter-rate copy), locks it to the
   nearest semitone an octave up, and plays it as a pulse wave arpeggiated on the band's grid, with a 4-bit volume that
   follows your picking and a burst of noise-channel crunch on each pick. */
const PRAWN = glProc('pixelprawn-chip', 'PixelPrawn', `
const CHORDS = [[0, 12], [0, 4, 7, 12], [0, 3, 7, 12]];
class PixelPrawn extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'arp', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'chord', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    { name: 'duty', defaultValue: 0.25, minValue: 0.05, maxValue: 0.5, automationRate: 'k-rate' }]; }
  constructor(o) {
    super(o);
    this.db = new Float32Array(1024); this.di = 0; this.acc = 0; this.cnt = 0; this.lp = 0; this.hop = 0; this.yd = new Float32Array(320);
    this.semi = -1; this.env = 0; this.slow = 0; this.ph = 0; this.cell = null; this.step = 0; this.lf = 1; this.nz = 0; this.nb = 0; this.cool = 0; this.nt = 0;
  }
  track() {
    if (this.env < 0.004) return;
    const B = this.db, W = 200, T = 300, s0 = (this.di - (W + T) + 4096) & 1023, d = this.yd;
    let run = 0, found = 0;
    for (let tau = 1; tau < T; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) { const a = B[(s0 + j) & 1023] - B[(s0 + j + tau) & 1023]; sum += a * a; }
      run += sum; d[tau] = run > 0 ? (sum * tau) / run : 1;
      if (tau > 17 && d[tau - 1] < 0.18 && d[tau] > d[tau - 1]) { found = tau - 1; break; }
    }
    if (!found) return;
    const a = d[found - 1], b = d[found], c = d[found + 1], den = a - 2 * b + c, per = found + (den ? (a - c) / (2 * den) : 0);
    const f = sampleRate / 4 / per;
    if (f > 40 && f < 1400) this.semi = Math.round(69 + 12 * Math.log2(f / 440));
  }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const sr = sampleRate, bpm = p.bpm[0], db = bpm / 60 / sr, ab = p.arp[0], ch = CHORDS[Math.round(p.chord[0])] || CHORDS[0], duty = p.duty[0], dc = 2 * duty - 1;
    const at = 1 - Math.exp(-1 / (0.002 * sr)), rl = 1 - Math.exp(-1 / (0.09 * sr)), sk = 1 - Math.exp(-1 / (0.03 * sr)), NB = Math.round(sr * 0.035);
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const v = x ? x[n] : 0, a = Math.abs(v);
      // a quarter-rate copy to track (one-pole low-pass, then the mean of four)
      this.lp += (v - this.lp) * 0.35; this.acc += this.lp;
      if (++this.cnt === 4) { this.db[this.di] = this.acc * 0.25; this.di = (this.di + 1) & 1023; this.acc = 0; this.cnt = 0; if (++this.hop >= 256) { this.hop = 0; this.track(); } }
      this.env += (a - this.env) * (a > this.env ? at : rl);
      this.slow += (this.env - this.slow) * sk;
      // a pick: the noise channel crunches
      if (this.cool > 0) this.cool--;
      else if (this.env > this.slow * 1.7 + 0.01) { this.nb = NB; this.cool = Math.round(sr * 0.1); }
      if (ab > 0) { const cell = Math.floor(b / ab); if (cell !== this.cell) { this.cell = cell; this.step++; } } else this.step = 0;
      const vol = Math.round(Math.min(1, this.env * 2.5) * 15) / 15;
      let y = 0;
      if (this.semi >= 0) {
        const note = this.semi + 12 + ch[this.step % ch.length];
        this.ph += (440 * Math.pow(2, (note - 69) / 12)) / sr;
        if (this.ph >= 1) this.ph -= Math.floor(this.ph);
        y = ((this.ph < duty ? 1 : -1) - dc) * vol * 0.5;
      }
      if (this.nb > 0) {
        if (--this.nt <= 0) { this.nt = 6; const bit = (this.lf ^ (this.lf >> 1)) & 1; this.lf = (this.lf >> 1) | (bit << 14); this.nz = this.lf & 1 ? 1 : -1; }
        y += this.nz * (this.nb / NB) * vol * 0.35; this.nb--;
      }
      o[n] = y;
    }
    return true;
  }
}`);
pedalDef({
  id: 'pixelprawn', name: 'Pixel Prawn', kind: '8-BIT ARCADE', cat: 'glitch', where: 'post', color: '#e4003a', ink: '#fff6e0',
  nod: 'the pulse-wave arpeggios of eight-bit game consoles', blurb: 'Turns your notes into an arcade chiptune arpeggio',
  look: { shape: 'box', finish: 'check', knob: 'cream', label: 'block', led: '#00e5ff' },
  worklets: { 'pixelprawn-chip': PRAWN }, trim: -2,
  knobs: [['arp', 'ARP', 0, 3, 2, 1, (v) => ['off', '1/8', '1/16', '1/32'][Math.round(v)] || 'off'], { key: 'chord', label: 'CHORD', opts: ['OCT', 'MAJ', 'MIN'], def: 0 },
    { key: 'duty', label: 'DUTY', opts: ['12%', '25%', '50%'], def: 1 }, ['mix', 'MIX', 0, 10, 6]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), dry = k.G(0), wet = k.G(1), n = glNode(c, k, 'pixelprawn-chip');
    // (a little of the edge off: the pulse aliases like the real chip, but a guitar amp after it would fizz)
    k.chain(input, n || k.G(0), k.F('highpass', 70, 0), k.F('lowpass', 6500, 0), wet, output);
    k.chain(input, dry, output);
    glSync(c, k, n);
    return { input, output, node: n, set(v, x) {
      glTo(x, glP(n, 'bpm'), x.bpm); glSet(x, glP(n, 'arp'), [0, 0.5, 0.25, 0.125][Math.round(v.arp)]);
      glSet(x, glP(n, 'chord'), Math.round(v.chord)); glSet(x, glP(n, 'duty'), [0.125, 0.25, 0.5][Math.round(v.duty)]);
      glMix(x, dry, wet, v.mix / 10);
    } };
  },
});

/* ---- Crab Walk: pitch that walks sideways. On each step of the band's grid it scuttles a random 1-3 semitones up or
   down (bouncing off ±SPREAD, never standing still at unison), and across the stereo field, side to side. */
const CRAB = glProc('crabwalk-shift', 'CrabWalk', GL_SHIFT + `
class CrabWalk extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'beats', defaultValue: 0.5, minValue: 0.0625, maxValue: 4, automationRate: 'k-rate' },
    { name: 'spread', defaultValue: 5, minValue: 0, maxValue: 12, automationRate: 'k-rate' },
    { name: 'width', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.sh = new GlShift(Math.round(sampleRate * 0.045)); this.cell = null; this.to = 0; this.st = 0; this.side = 1; this.pan = 0; this.gl = Math.SQRT1_2; this.gr = Math.SQRT1_2; }
  process(ins, outs, p) {
    const L = outs[0][0], R = outs[0][1], x = ins[0] && ins[0][0];
    if (!L) return true;
    const bpm = p.bpm[0], sl = p.beats[0], sp = Math.round(p.spread[0]), wd = p.width[0], nf = L.length;
    const b = this.beat(bpm), cell = Math.floor((b + (nf * bpm) / 60 / sampleRate) / sl);
    // a step lands in this block: a new interval and the other side (checked per block: 3 ms is plenty for a scuttle)
    if (cell !== this.cell) {
      const first = this.cell === null;
      this.cell = cell;
      if (!first && sp >= 1) {
        let t = this.to + (this.rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(this.rnd() * 3));
        if (t > sp) t = 2 * sp - t; if (t < -sp) t = -2 * sp - t;
        if (t > sp || t < -sp) t = 0;
        if (t === 0) t = this.to > 0 ? -1 : 1;
        this.to = Math.max(-sp, Math.min(sp, t)); this.side = -this.side;
      } else if (sp < 1) this.to = 0;
    }
    const k = 1 - Math.exp(-nf / (0.012 * sampleRate)), kp = 1 - Math.exp(-nf / (0.03 * sampleRate));
    this.st += (this.to - this.st) * k; this.pan += (this.side * wd - this.pan) * kp;
    const r = Math.pow(2, this.st / 12), q = ((this.pan + 1) * Math.PI) / 4, gl1 = Math.cos(q), gr1 = Math.sin(q);
    for (let n = 0; n < nf; n++) {
      const u = n / nf, y = this.sh.run(x ? x[n] : 0, r, 0);
      L[n] = y * (this.gl + (gl1 - this.gl) * u); if (R) R[n] = y * (this.gr + (gr1 - this.gr) * u);
    }
    this.gl = gl1; this.gr = gr1;
    return true;
  }
}`);
pedalDef({
  id: 'crabwalk', name: 'Crab Walk', kind: 'SIDEWAYS SHIFTER', cat: 'glitch', where: 'pre', color: '#ff3d2e', ink: '#fff2e6', stereo: true,
  nod: 'a pitch-shift pedal with a mind of its own, and how crabs get about', blurb: 'Scuttles your pitch sideways, a random step at a time',
  look: { shape: 'box', finish: 'flat', knob: 'chicken', label: 'script', led: '#ffd23f' },
  worklets: { 'crabwalk-shift': CRAB }, trim: 0.7,
  knobs: [['step', 'STEP', 0, 5, 1, 1, PFX.noteFmt], ['spread', 'SPREAD', 0, 12, 5, 1, (v) => '±' + Math.round(v) + ' st'], ['side', 'SIDEWAYS', 0, 10, 6], ['mix', 'MIX', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), dry = k.G(0), wet = k.G(1), n = glNode(c, k, 'crabwalk-shift', 2);
    if (n) k.chain(input, n, wet, output);
    k.chain(input, dry, output);
    glSync(c, k, n);
    return { input, output, node: n, set(v, x) {
      glTo(x, glP(n, 'bpm'), x.bpm); glSet(x, glP(n, 'beats'), DELAY_NOTES[Math.round(v.step)][1]);
      glSet(x, glP(n, 'spread'), Math.round(v.spread)); glTo(x, glP(n, 'width'), v.side / 10);
      if (n) glMix(x, dry, wet, v.mix / 10); else x.to(dry.gain, 1);
    } };
  },
});

/* ---- Shellac Clam: an old record. Wow at the platter's turn and a flutter on top (a wobbling delay), SLOW to drag it
   down in pitch (the shifter), dust (pops, ticks and a hiss that ride your playing, the needle in the groove), and AGE
   narrowing the band like a worn 78's. */
const SHELLAC = glProc('shellac-disc', 'ShellacClam', GL_SHIFT + `
class ShellacClam extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'wow', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'dust', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'slow', defaultValue: 0, minValue: 0, maxValue: 12, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.sh = new GlShift(Math.round(sampleRate * 0.03)); this.t = 0; this.el = 0; this.pop = 0; this.pa = 0; this.hs = 0; this.ra = 1; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const sr = sampleRate, wow = p.wow[0], du = p.dust[0], TAU = 6.283185307;
    const rt = Math.pow(2, -p.slow[0] / 12);
    this.ra += (rt - this.ra) * (1 - Math.exp(-o.length / (0.15 * sr))); // (the platter slows; it doesn't jump)
    const A = wow * 0.0012 * sr, Af = wow * 0.00004 * sr, rel = Math.exp(-1 / (0.5 * sr)), pPop = (du * 5) / sr, pTick = (du * 160) / sr, pd = Math.exp(-1 / (0.00025 * sr));
    for (let n = 0; n < o.length; n++) {
      const v = x ? x[n] : 0, a = Math.abs(v);
      this.el = a > this.el ? a : this.el * rel;
      this.t += 1 / sr; if (this.t > 1000) this.t -= 1000;
      // wow at 33 1/3 rpm (0.55 Hz, a touch off-centre so it has a second harmonic) and a flutter at 7 Hz
      const s = Math.sin(TAU * 0.555 * this.t), e = A * (1 + s + 0.25 * s * s) + Af * (1 + Math.sin(TAU * 7.1 * this.t));
      let y = this.sh.run(v, this.ra, e);
      // the needle: pops, ticks and a hiss, as long as there's music in the groove
      const nd = Math.min(1, this.el * 8) * du;
      if (this.rnd() < pPop) this.pa = (this.rnd() < 0.5 ? -1 : 1) * (0.05 + 0.2 * this.rnd());
      else if (this.rnd() < pTick) this.pa = (this.rnd() - 0.5) * 0.05;
      this.pop = this.pop * pd + this.pa; this.pa = 0;
      this.hs += ((this.rnd() * 2 - 1) - this.hs) * 0.4;
      o[n] = y + (this.pop * 0.5 + this.hs * 0.006) * nd;
    }
    return true;
  }
}`);
pedalDef({
  id: 'shellac', name: 'Shellac Clam', kind: 'VINYL · 78 RPM', cat: 'glitch', where: 'post', color: '#1d1a16', ink: '#e8c872',
  nod: 'a worn 78 on a wind-up gramophone', blurb: 'Wow, dust and the worn-out tone of an old record',
  look: { shape: 'box', finish: 'brushed', knob: 'chrome', label: 'script', led: '#ffb000' },
  worklets: { 'shellac-disc': SHELLAC }, trim: -2, latency: 0.016,
  knobs: [['wow', 'WOW', 0, 10, 4], ['dust', 'DUST', 0, 10, 4], ['age', 'AGE', 0, 10, 5], ['slow', 'SLOW', 0, 12, 0, 0.5, (v) => (v > 0 ? '−' + v.toFixed(1) + ' st' : 'none')]],
  build(c, k) {
    const input = k.G(1), n = glNode(c, k, 'shellac-disc');
    // the old-record band: no deep lows, a little horn honk in the mids, the top going with AGE
    const hp = k.F('highpass', 110, 0), mid = k.F('peaking', 1300, 0.9, 2), lp = k.F('lowpass', 6000, 0), lp2 = k.F('lowpass', 6000, 0);
    const output = k.chain(input, n || k.G(1), hp, mid, lp, lp2);
    return { input, output, node: n, set(v, x) {
      glTo(x, glP(n, 'wow'), v.wow / 10); glTo(x, glP(n, 'dust'), v.dust / 10); glTo(x, glP(n, 'slow'), v.slow);
      const top = 14000 * Math.pow(2, -v.age * 0.24); // 14 kHz to 2.6 kHz
      x.to(lp.frequency, top); x.to(lp2.frequency, top); x.to(hp.frequency, 60 + v.age * 18); x.to(mid.gain, 0.5 + v.age * 0.5);
    } };
  },
});
}
