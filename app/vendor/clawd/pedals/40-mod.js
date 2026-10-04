// vendored verbatim from clawd-o-matic/web/pedals/40-mod.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: modulation. Phasers, a flanger, a photocell vibe, tremolos, a rotary speaker, vibrato, a dimension
   chorus, an auto-pan and a ring modulator, then the weird ones: a seasick tape warble, a slicer locked to the band and a
   swarm of six choruses. docs/PEDALS.md says how a pack works; Tidepool (the chorus) is in 00-classic.js. */
{
// The phaser worklet (Nautilus and the Urchin Vibe): a chain of first-order all-pass stages swept by an LFO, with
// feedback round the chain. Native biquads can't do this: a feedback loop in Web Audio needs a 128-sample delay in it.
//  processorOptions: { mul: [ratio per stage] } spreads the stages (a photocell vibe's odd capacitors; all 1 if absent),
//  lamp: true drives the sweep through a lamp and a light-dependent resistor instead of a plain sine or triangle.
//  Two channels out when the input is stereo or width > 0 asks for it (outputChannelCount); R's LFO leads by width/4.
const MOD_PHASE = `class NautilusPhase extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });
    return [k('rate', 0.5, 0.01, 20), k('depth', 0.8, 0, 1), k('lo', 200, 10, 8000), k('hi', 3000, 20, 16000), k('fb', 0, -0.95, 0.95),
      k('mix', 0.5, 0, 1), k('stages', 4, 1, 12), k('shape', 0, 0, 1), k('width', 0, 0, 1), k('throb', 0, 0, 1)];
  }
  constructor(o) {
    super();
    const q = (o && o.processorOptions) || {};
    this.lamp = !!q.lamp; this.uni = !q.mul; this.mul = new Float64Array(12).fill(1);
    if (q.mul) for (let i = 0; i < 12 && i < q.mul.length; i++) this.mul[i] = q.mul[i];
    this.x1 = [new Float64Array(12), new Float64Array(12)]; this.y1 = [new Float64Array(12), new Float64Array(12)];
    this.last = new Float64Array(2); this.lb = new Float64Array(2); this.lg = new Float64Array(2); this.ph = 0;
    const sr = sampleRate, c = (s) => 1 - Math.exp(-1 / (s * sr));
    // the lamp heats fast and cools slower; the cell follows it faster up than down: a lopsided, throbbing sweep
    this.lu = c(0.006); this.ld = c(0.028); this.gu = c(0.01); this.gd = c(0.045);
  }
  process(ins, outs, p) {
    const inp = ins[0], out = outs[0];
    if (!out || !out.length) return true;
    const N = out[0].length, sr = sampleRate, inc = p.rate[0] / sr;
    if (!inp || !inp.length) { for (const y of out) y.fill(0); this.ph = (this.ph + N * inc) % 1; return true; }
    const depth = p.depth[0], lo = p.lo[0], lr = Math.log(Math.max(p.hi[0], lo + 1) / lo), fb = p.fb[0], mix = p.mix[0], st = Math.round(p.stages[0]);
    const tri = p.shape[0] > 0.5, width = p.width[0], throb = p.throb[0], lamp = this.lamp, uni = this.uni, mul = this.mul, fmax = 0.45 * sr, K = Math.PI / sr;
    const base = this.ph;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch], xs = this.x1[ch & 1], ys = this.y1[ch & 1];
      let ph = base + (ch ? width * 0.25 : 0), last = this.last[ch & 1], b = this.lb[ch & 1], g = this.lg[ch & 1];
      ph -= Math.floor(ph);
      for (let n = 0; n < N; n++) {
        ph += inc; if (ph >= 1) ph -= 1;
        let pos, m;
        if (lamp) {
          const d = 0.5 + 0.5 * Math.sin(6.283185307179586 * ph), heat = d * d;
          b += (heat - b) * (heat > b ? this.lu : this.ld);
          g += (b - g) * (b > g ? this.gu : this.gd);
          m = g; pos = g * depth;
        } else {
          m = tri ? (ph < 0.5 ? 2 * ph : 2 - 2 * ph) : 0.5 - 0.5 * Math.cos(6.283185307179586 * ph);
          pos = 0.5 + (m - 0.5) * depth;
        }
        const t = Math.tan(K * Math.min(fmax, lo * Math.exp(lr * pos)));
        let u = x[n] + fb * last;
        for (let i = 0; i < st; i++) {
          const w = uni ? t : Math.min(20, t * mul[i]), a = (w - 1) / (w + 1), v = a * u + xs[i] - a * ys[i];
          xs[i] = u; ys[i] = v; u = v;
        }
        last = u;
        y[n] = x[n] * (1 - mix) + u * mix * (1 - throb * (1 - m));
      }
      if (Math.abs(last) < 1e-20) last = 0;
      this.last[ch & 1] = last; this.lb[ch & 1] = b; this.lg[ch & 1] = g;
    }
    this.ph = (base + N * inc) % 1;
    return true;
  }
}
registerProcessor('nautilus-phase', NautilusPhase);`;

// The flanger worklet (Jet Ray): a short delay swept by a triangle, its repeats darkened like a bucket brigade's and fed
// back (REGEN, either polarity), mixed half and half with the dry for the notches.
const MOD_FLANGE = `class JetrayFlange extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });
    return [k('manual', 0.003, 0.0001, 0.02), k('width', 0.6, 0, 1), k('rate', 0.3, 0.01, 10), k('regen', 0.5, -0.92, 0.92), k('mix', 0.5, 0, 1)];
  }
  constructor() {
    super();
    this.buf = [new Float32Array(4096), new Float32Array(4096)]; this.w = 0; this.ph = 0; this.z = new Float64Array(2);
    this.lpc = 1 - Math.exp((-2 * Math.PI * 6500) / sampleRate);
  }
  process(ins, outs, p) {
    const inp = ins[0], out = outs[0];
    if (!out || !out.length) return true;
    const N = out[0].length, sr = sampleRate, inc = p.rate[0] / sr;
    if (!inp || !inp.length) { for (const y of out) y.fill(0); this.ph = (this.ph + N * inc) % 1; return true; }
    const man = p.manual[0], wd = p.width[0] * 3.5, rg = p.regen[0], mix = p.mix[0], norm = 1 - 0.45 * Math.abs(rg), lpc = this.lpc, mask = 4095;
    const lo = 0.00005 * sr, hi = Math.min(0.02 * sr, 4000);
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch], bf = this.buf[ch & 1];
      let ph = this.ph, w = this.w, z = this.z[ch & 1];
      for (let n = 0; n < N; n++) {
        ph += inc; if (ph >= 1) ph -= 1;
        const tr = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        let ds = man * sr * Math.pow(2, wd * tr);
        ds = ds < lo ? lo : ds > hi ? hi : ds;
        // (w is where this sample goes, so w - ds is ds samples ago: between i0 and the newer i0 + 1)
        const r = w - ds, i0 = Math.floor(r), f = r - i0, a = bf[i0 & mask], v = a + (bf[(i0 + 1) & mask] - a) * f;
        z += (v - z) * lpc;
        let s = x[n] + rg * z;
        s = s > 3 ? 3 : s < -3 ? -3 : s;
        bf[w] = s; w = (w + 1) & mask;
        y[n] = (x[n] * (1 - mix) + z * mix) * norm;
      }
      if (Math.abs(z) < 1e-20) z = 0;
      this.z[ch & 1] = z;
      if (ch === out.length - 1) { this.w = w; this.ph = ph; }
    }
    return true;
  }
}
registerProcessor('jetray-flange', JetrayFlange);`;

const modLive = (c) => !(typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext);
// The band's transport, if it's playing on this context (a live one): tempo-locked pedals line their loops up with it.
const modClock = (c) => { try { return modLive(c) && typeof PLUG !== 'undefined' && PLUG.clock && PLUG.clock.playing() ? PLUG.clock : null; } catch (e) { return null; } };

// A control shape that loops every `beats` beats (8: two bars of 4/4, which every note value we offer divides), as a
// looping buffer on out (chans channels, discrete). make(bpm, fn(beat, ch)) builds it and swaps it in, keeping its place
// in the loop. While the band plays, it lines beat 0 up with an even bar (it checks every 0.7 s, so it catches the band
// starting, and drift). A buffer at 12 kHz: the edges we draw are softer than that, and it's cheap to build.
const modGrid = (k, chans = 1, beats = 8) => {
  const c = k.c, SR = 12000, out = k.G(1);
  out.channelCount = chans; out.channelCountMode = 'explicit'; out.channelInterpretation = 'discrete';
  let src = null, buf = null, dur = 1, t0 = 0;
  const want = (when) => { // where beat 0 should be, if the band is playing
    const ck = modClock(c);
    if (!ck) return null;
    const b = Math.floor(ck.bar());
    return ck.barTime(b - (((b % 2) + 2) % 2));
  };
  const start = (when, newDur) => {
    const a = want(when);
    const frac = a != null ? (((when - a) / newDur) % 1 + 1) % 1 : src ? (((when - t0) / dur) % 1 + 1) % 1 : 0;
    const s = c.createBufferSource();
    s.buffer = buf; s.loop = true; s.loopStart = 0; s.loopEnd = newDur; s.connect(out);
    s.start(when, frac * newDur);
    if (src) { const o = src; try { o.stop(when); } catch (e) { /* stopped */ } o.onended = () => { try { o.disconnect(); } catch (e) { /* gone */ } }; }
    src = s; dur = newDur; t0 = when - frac * newDur;
  };
  const make = (bpm, fn) => {
    const d = (beats * 60) / (bpm || 120), n = Math.ceil(d * SR) + 2;
    buf = c.createBuffer(chans, n, SR);
    for (let ch = 0; ch < chans; ch++) { const a = buf.getChannelData(ch); for (let i = 0; i < n; i++) a[i] = fn(((i / SR) * (bpm || 120)) / 60, ch); }
    start(c.currentTime + (src ? 0.01 : 0), d);
  };
  if (modLive(c)) {
    const poll = () => {
      const a = src && want(c.currentTime);
      if (a != null) {
        const err = ((((t0 - a) / dur) % 1) + 1.5) % 1 - 0.5; // (in loops, -0.5 to 0.5)
        if (Math.abs(err * dur) > 0.004) start(c.currentTime + 0.04, dur);
      }
      k.later(poll, 700);
    };
    k.later(poll, 700);
  }
  k.onDispose(() => { if (src) { try { src.stop(); } catch (e) { /* stopped */ } try { src.disconnect(); } catch (e) { /* gone */ } } });
  return { out, make, get t0() { return t0; }, get dur() { return dur; } }; // (t0, dur: tests check the lock)
};
// One pass of an asymmetric one-pole over a looped shape (twice round, so it settles): an optical cell's softening.
const modSmooth = (a, up, down) => {
  let z = a[a.length - 1];
  for (let r = 0; r < 2; r++) for (let i = 0; i < a.length; i++) { z += (a[i] - z) * (a[i] > z ? up : down); if (r) a[i] = z; }
  return a;
};
// Note values for the tempo-locked pedals: [label, quarter notes]
const MOD_TREM = [['1/2', 2], ['1/4', 1], ['1/4T', 2 / 3], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6]];
const MOD_PAN = [['2 BARS', 8], ['1 BAR', 4], ['1/2', 2], ['1/4', 1], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25]];
const modPick = (list, v) => list[Math.max(0, Math.min(list.length - 1, Math.round(v)))];
const modHz = (f) => (f < 10 ? f.toFixed(1) : Math.round(f)) + ' Hz';
// Linkwitz-Riley at f: two Butterworth sections (Q in dB for these: -3.01 is 0.707). The low and high halves sum flat.
const modLR = (k, type, f) => { const a = k.F(type, f, -3.01), b = k.F(type, f, -3.01); a.connect(b); return [a, b]; };

/* 1. Prawn Phase: the little orange four-stage phaser, script-logo version (no feedback: a smooth, vocal swirl). Two
   all-pass biquads at Q 0.5 are exactly four first-order stages; the LFO sweeps them in cents (an exponential sweep, as
   the JFETs give), and the dry half against the shifted half makes the two notches. One knob. */
pedalDef({
  id: 'prawnphase', name: 'Prawn Phase', kind: 'PHASER · 4-STAGE', cat: 'mod', where: 'pre', color: '#f26a1b', ink: '#1c0d04',
  nod: 'the little orange four-stage phaser with the script logo', blurb: 'One knob of swirl: slow and vocal or fast and wet',
  look: { shape: 'mini', finish: 'flat', knob: 'black', label: 'script', led: '#ff3b3b' },
  trim: 2.3,
  knobs: [['speed', 'SPEED', 0, 10, 3.5, 0, (v) => modHz(0.1 * Math.pow(2, v * 0.62))]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), dry = k.G(0.5), wet = k.G(0.5);
    const a1 = k.F('allpass', 720, 0.5), a2 = k.F('allpass', 720, 0.5), lfo = k.lfo(0.5, 'triangle'), dep = k.G(1900);
    k.chain(lfo, dep); dep.connect(a1.detune); dep.connect(a2.detune);
    k.chain(input, a1, a2, wet, output); k.chain(input, dry, output);
    return { input, output, set(v, x) { x.to(lfo.frequency, 0.1 * Math.pow(2, v.speed * 0.62)); } }; // 0.1 to 7.3 Hz
  },
});

/* 2. Nautilus: a big multi-stage phaser, up to twelve stages (six notches), with resonance round the chain and the
   right side's sweep a little ahead of the left's (stereo). */
pedalDef({
  id: 'nautilus', name: 'Nautilus', kind: 'PHASER · 12-STAGE', cat: 'mod', where: 'post', color: '#4a2877', ink: '#f6ebff', stereo: true,
  nod: 'the big multi-stage studio phasers with a resonance knob', blurb: 'Deep, liquid sweeps that ring when you push RES',
  look: { shape: 'wide', finish: 'sparkle', knob: 'chrome', label: 'plate', led: '#c49bff' },
  worklets: { 'nautilus-phase': MOD_PHASE },
  trim: 3.4,
  knobs: [['rate', 'RATE', 0, 10, 3, 0, (v) => modHz(0.05 * Math.pow(2, v * 0.7))], ['depth', 'DEPTH', 0, 10, 7], ['res', 'RES', 0, 10, 4],
    ['width', 'STEREO', 0, 10, 5], { key: 'stages', label: 'STAGES', opts: ['4', '8', '12'], def: 2 }],
  build(c, k) {
    const n = k.worklet('nautilus-phase', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    if (!n) { const g = k.G(1); return { input: g, output: g, set() {} }; }
    const P = (name) => n.parameters.get(name);
    return { input: n, output: n, set(v, x) {
      x.to(P('rate'), 0.05 * Math.pow(2, v.rate * 0.7)); // 0.05 to 6.5 Hz
      x.to(P('depth'), v.depth / 10); x.to(P('lo'), 160); x.to(P('hi'), 4200);
      // resonance: more stages ring harder for the same feedback, so it comes down as they go up
      x.to(P('fb'), (v.res / 10) * [0.8, 0.72, 0.66][v.stages]);
      x.to(P('mix'), 0.5); x.to(P('stages'), [4, 8, 12][v.stages]); x.to(P('width'), v.width / 10);
    } };
  },
});

/* 3. Jet Ray: the bucket-brigade flanger. MANUAL sets where the sweep sits (low: metallic zing; high: a slow comb),
   WIDTH how far it goes, REGEN feeds it back for the jet (below zero: hollow and nasal). */
pedalDef({
  id: 'jetray', name: 'Jet Ray', kind: 'FLANGER', cat: 'mod', where: 'pre', color: '#8a95a3', ink: '#0f1318',
  nod: 'the grey-box analogue jet flanger with a manual knob', blurb: 'Jet-plane whoosh, from shimmer to metal scream',
  look: { shape: 'box', finish: 'brushed', knob: 'black', label: 'block', led: '#ff3b3b' },
  worklets: { 'jetray-flange': MOD_FLANGE },
  trim: 4.2,
  knobs: [['manual', 'MANUAL', 0, 10, 5, 0, (v) => (0.35 * Math.pow(2, v * 0.45)).toFixed(1) + ' ms'], ['width', 'WIDTH', 0, 10, 6],
    ['speed', 'SPEED', 0, 10, 3, 0, (v) => modHz(0.05 * Math.pow(2, v * 0.6))], ['regen', 'REGEN', -10, 10, 5, 0, (v) => (v > 0 ? '+' : '') + v.toFixed(1)]],
  build(c, k) {
    const n = k.worklet('jetray-flange', { numberOfInputs: 1, numberOfOutputs: 1 });
    if (!n) { const g = k.G(1); return { input: g, output: g, set() {} }; }
    const P = (name) => n.parameters.get(name);
    return { input: n, output: n, set(v, x) {
      x.to(P('manual'), 0.00035 * Math.pow(2, v.manual * 0.45)); // 0.35 to 8 ms at the middle of the sweep
      x.to(P('width'), v.width / 10);
      x.to(P('rate'), 0.05 * Math.pow(2, v.speed * 0.6)); // 0.05 to 3.2 Hz
      x.to(P('regen'), v.regen * 0.09); x.to(P('mix'), 0.5);
    } };
  },
});

/* 4. Urchin Vibe (uni is Japanese for sea urchin): the sixties photocell vibe. Four phase-shift stages with wildly
   different capacitors, swept by a lamp shining on light-dependent resistors, so the sweep is lopsided and throbs.
   CHO blends the dry in (the throbbing chorus); VIB is the shifted signal alone (a watery pitch wobble). Its speed is
   on a rocker pedal, as the original's was. */
pedalDef({
  id: 'urchinvibe', name: 'Urchin Vibe', kind: 'PHOTOCELL VIBE', cat: 'mod', where: 'pre', color: '#1f5a45', ink: '#f5ead0',
  nod: 'the sixties photocell chorus-vibrato with the throbbing lamp and a speed pedal', blurb: 'The lopsided throb: rock the pedal to speed it up',
  look: { shape: 'wah', treadle: 'speed', finish: 'hammer', knob: 'chicken', label: 'stencil', led: '#ffb13b' },
  worklets: { 'nautilus-phase': MOD_PHASE },
  trim: 1.9,
  knobs: [['speed', 'SPEED', 0, 10, 4, 0, (v) => modHz(0.5 * Math.pow(2, v * 0.43))], ['depth', 'INTENSE', 0, 10, 7],
    { key: 'mode', label: 'MODE', opts: ['CHO', 'VIB'], def: 0 }],
  build(c, k) {
    // (the four stages' capacitors: 15 nF, 220 nF, 470 pF and 4.7 nF, as ratios of the first's corner frequency)
    const n = k.worklet('nautilus-phase', { numberOfInputs: 1, numberOfOutputs: 1, processorOptions: { lamp: true, mul: [1, 0.068, 3.2, 0.32] } });
    if (!n) { const g = k.G(1); return { input: g, output: g, set() {} }; }
    const P = (name) => n.parameters.get(name), bass = k.F('lowshelf', 180, 0, 2), output = k.chain(n, bass);
    return { input: n, output, set(v, x) {
      x.to(P('rate'), 0.5 * Math.pow(2, v.speed * 0.43)); // 0.5 to 9.9 Hz
      x.to(P('depth'), 0.35 + v.depth * 0.065); x.to(P('lo'), 90); x.to(P('hi'), 3200); x.to(P('stages'), 4); x.to(P('fb'), 0.12);
      x.to(P('mix'), v.mode ? 1 : 0.5); x.to(P('throb'), v.mode ? 0.12 : 0.3);
    } };
  },
});

/* 5. Jelly Pulse: the optical tremolo, in time with the band. The shape is drawn one loop at a time and softened the
   way a light cell softens a lamp: quick to brighten, slower to fade, so even SQR chops without a click. */
pedalDef({
  id: 'jellypulse', name: 'Jelly Pulse', kind: 'TREMOLO · IN TIME', cat: 'mod', where: 'post', color: '#7de6c4', ink: '#082019',
  nod: 'the optical and bias-wobble tremolos built into old amps', blurb: 'Pulses in time with the band: sine, triangle or chop',
  look: { shape: 'round', finish: 'sparkle', knob: 'cream', label: 'script', led: '#ff4fd8' },
  trim: 1.9,
  knobs: [['rate', 'RATE', 0, 6, 3, 1, (v) => modPick(MOD_TREM, v)[0]], ['depth', 'DEPTH', 0, 10, 6],
    { key: 'shape', label: 'SHAPE', opts: ['SINE', 'TRI', 'SQR'], def: 0 }],
  build(c, k) {
    const input = k.G(1), amp = k.G(1), dep = k.G(0), grid = modGrid(k, 1);
    k.chain(grid.out, dep, amp.gain);
    k.chain(input, amp);
    let key = '';
    return { input, output: amp, grid, set(v, x) {
      x.to(dep.gain, v.depth / 10);
      const kk = [v.rate, v.shape, x.bpm].join();
      if (kk === key) return;
      key = kk;
      const q = modPick(MOD_TREM, v.rate)[1], sh = v.shape;
      // u: 1 loud, 0 quiet (the loud part lands on the beat); the buffer holds u - 1 and DEPTH scales it
      const a = new Float32Array(Math.ceil((8 * 60 * 12000) / x.bpm) + 2);
      for (let i = 0; i < a.length; i++) {
        const ph = ((i / 12000) * x.bpm) / 60 / q % 1;
        a[i] = sh === 0 ? 0.5 + 0.5 * Math.cos(2 * Math.PI * ph) : sh === 1 ? Math.abs(2 * ph - 1) : ph < 0.5 ? 1 : 0;
      }
      modSmooth(a, 1 - Math.exp(-1 / (0.0025 * 12000)), 1 - Math.exp(-1 / (0.008 * 12000)));
      grid.make(x.bpm, (b) => a[Math.min(a.length - 1, Math.round((b * 60 * 12000) / x.bpm))] - 1);
    } };
  },
});

/* 6. Brown Crab: the harmonic tremolo of the early-sixties brown amps. The guitar is split into lows and highs and the
   two pulse in turn, so it throbs and swims rather than just getting quieter. SPLIT moves the crossover. */
pedalDef({
  id: 'browncrab', name: 'Brown Crab', kind: 'HARMONIC TREM', cat: 'mod', where: 'post', color: '#7b4a2b', ink: '#f4e4c4',
  nod: 'the harmonic vibrato of early-sixties brown-panel amps', blurb: 'Lows and highs pulse in turn: a swimming throb',
  look: { shape: 'box', finish: 'stripe', knob: 'cream', label: 'plate', led: '#ffcf6b' },
  trim: 2.2,
  knobs: [['speed', 'SPEED', 0, 10, 4, 0, (v) => modHz(0.8 * Math.pow(2, v * 0.33))], ['depth', 'INTENSE', 0, 10, 6],
    ['split', 'SPLIT', 0, 10, 5, 0, (v) => Math.round(250 * Math.pow(2, v * 0.28)) + ' Hz']],
  build(c, k) {
    const input = k.G(1), output = k.G(1), lo = k.G(1), hi = k.G(1), dLo = k.G(0), dHi = k.G(0), lfo = k.lfo(2);
    const [l1, l2] = modLR(k, 'lowpass', 800), [h1, h2] = modLR(k, 'highpass', 800);
    k.chain(input, l1); k.chain(l2, lo, output);
    k.chain(input, h1); k.chain(h2, hi, output);
    k.chain(lfo, dLo, lo.gain); k.chain(lfo, dHi, hi.gain); // (in opposite directions: the depths have opposite signs)
    return { input, output, set(v, x) {
      x.to(lfo.frequency, 0.8 * Math.pow(2, v.speed * 0.33)); // 0.8 to 7.9 Hz
      const d = v.depth / 20;
      x.to(lo.gain, 1 - d); x.to(hi.gain, 1 - d); x.to(dLo.gain, d); x.to(dHi.gain, -d);
      const f = 250 * Math.pow(2, v.split * 0.28); // 250 Hz to 1.7 kHz
      for (const n of [l1, l2, h1, h2]) x.to(n.frequency, f, 0.05);
    } };
  },
});

/* 7. Spin Lobster: the spinning two-rotor speaker cabinet. A treble horn and a bass drum turn at their own speeds (the
   heavy drum takes longer to get there when you switch), each heard by two mics: level from which way it's facing,
   pitch from how fast it's coming or going (the doppler), and so it's wide. The second footswitch flips SLOW/FAST;
   RAMP is how quickly the rotors catch up; DRIVE is the cabinet's valve amp breaking up. */
pedalDef({
  id: 'spinlobster', name: 'Spin Lobster', kind: 'ROTARY SPEAKER', cat: 'mod', where: 'post', color: '#a8322b', ink: '#fff0d8', stereo: true,
  nod: 'the spinning two-rotor organ speaker cabinet', blurb: 'Stomp for fast: the horn whirls, the drum catches up',
  look: { shape: 'wide', finish: 'hammer', knob: 'chrome', label: 'script', led: '#ffcf3b', foot2: 'speed' },
  trim: -0.6,
  knobs: [{ key: 'speed', label: 'SPEED', opts: ['SLOW', 'FAST'], def: 0 }, ['ramp', 'RAMP', 0, 10, 5], ['drive', 'DRIVE', 0, 10, 2],
    ['bal', 'HORN', 0, 10, 5], ['width', 'WIDTH', 0, 10, 7]],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), post = k.G(1), L = k.G(1), R = k.G(1), hornG = k.G(1), drumG = k.G(1);
    k.chain(input, pre, k.shaper(1.4, 0.06), post);
    const [h1, h2] = modLR(k, 'highpass', 800), [l1, l2] = modLR(k, 'lowpass', 800);
    k.chain(post, h1); k.chain(h2, k.F('lowpass', 7000, -3), hornG);
    k.chain(post, l1); k.chain(l2, drumG);
    // an oscillator giving cos(θ - phase): each mic's view of a rotor. Started together, the pair stays locked.
    const wave = (ph) => c.createPeriodicWave(new Float32Array([0, Math.cos(ph)]), new Float32Array([0, Math.sin(ph)]), { disableNormalization: true });
    const rotor = (ph) => { const o = c.createOscillator(); o.setPeriodicWave(wave(ph)); o.frequency.value = 0.8; o.start(); return k.own(o); };
    // a mic on a rotor: a delay swung by the rotor (doppler) into a gain swung by it (facing: loud; away: quiet)
    const mic = (src, osc, am, swing, to) => {
      const d = k.delay(0.01, 0.0015), g = k.G(1 - am), sw = k.G(-swing), a = k.G(am);
      k.chain(osc, sw, d.delayTime); k.chain(osc, a, g.gain);
      k.chain(src, d, g, to);
    };
    const hL = rotor(0), hR = rotor(2), dL = rotor(0), dR = rotor(-2);
    mic(hornG, hL, 0.34, 0.00035, L); mic(hornG, hR, 0.34, 0.00035, R);
    mic(drumG, dL, 0.16, 0.00008, L); mic(drumG, dR, 0.16, 0.00008, R);
    const output = k.merge(L, R);
    let w = -1;
    return { input, output, set(v, x) {
      const s = Math.pow(2, (5 - v.ramp) * 0.25); // (RAMP 0: 2.4x slower; 10: 2.4x quicker)
      const fast = v.speed === 1;
      for (const o of [hL, hR]) x.to(o.frequency, fast ? 6.8 : 0.8, 0.35 * s);
      for (const o of [dL, dR]) x.to(o.frequency, fast ? 5.9 : 0.66, 1.5 * s);
      x.to(pre.gain, k.dB(v.drive * 2.4)); x.to(post.gain, k.dB(-v.drive * 1.9));
      x.to(hornG.gain, Math.min(1, v.bal / 5) * 1.05); x.to(drumG.gain, Math.min(1, (10 - v.bal) / 5));
      if (v.width !== w) { w = v.width; const ph = 0.3 + (v.width / 10) * 2.6; hR.setPeriodicWave(wave(ph)); dR.setPeriodicWave(wave(-ph)); }
    } };
  },
});

/* 8. Wobble Eel: pure vibrato, pitch only (no dry). A delay line swept by an LFO; DEPTH is in cents whatever the RATE,
   so the delay swings less as it speeds up, as a player's finger would. */
pedalDef({
  id: 'wobbleeel', name: 'Wobble Eel', kind: 'VIBRATO', cat: 'mod', where: 'pre', color: '#6c3fc2', ink: '#f2ecff',
  nod: 'the purple bucket-brigade vibrato box', blurb: 'Pitch wobble only: warped records to seasick bends',
  look: { shape: 'box', finish: 'flat', knob: 'small', label: 'stencil', led: '#7dffb8' },
  trim: 0,
  knobs: [['rate', 'RATE', 0, 10, 5, 0, (v) => modHz(0.5 * Math.pow(2, v * 0.4))], ['depth', 'DEPTH', 0, 10, 4, 0, (v) => Math.round(v * 6) + ' ct'],
    { key: 'wave', label: 'WAVE', opts: ['SINE', 'TRI'], def: 0 }],
  build(c, k) {
    const input = k.G(1), d = k.delay(0.05, 0.002), lfo = k.lfo(2), sw = k.G(0);
    k.chain(lfo, sw, d.delayTime); k.chain(input, d);
    let lat = 0.002;
    return { input, output: d, get latency() { return lat; }, set(v, x) {
      const f = 0.5 * Math.pow(2, v.rate * 0.4), dev = Math.pow(2, (v.depth * 6) / 1200) - 1; // 0.5 to 8 Hz; 0 to 60 cents
      lfo.type = v.wave ? 'triangle' : 'sine';
      const A = Math.min(0.022, dev / ((v.wave ? 4 : 2 * Math.PI) * f)); // (the peak slope of the wave is the pitch swing)
      lat = A + 0.0008;
      x.to(lfo.frequency, f); x.to(sw.gain, A, 0.05); x.to(d.delayTime, lat, 0.05);
    } };
  },
});

/* 9. Mantis Shrimp: the four-button studio dimension box. Two delay lines swept in opposite directions by one slow
   triangle, each side getting one line minus a little of the other, so the movement cancels in mono and all that's
   left is width. Very subtle at 1, a gentle chorus by 4. */
pedalDef({
  id: 'mantis', name: 'Mantis Shrimp', kind: 'DIMENSION', cat: 'mod', where: 'post', color: '#dde1e6', ink: '#1a1c21', stereo: true,
  nod: 'the four-button studio dimension box and the first stereo chorus', blurb: 'Wide and still: stereo space without the wobble',
  look: { shape: 'rack', finish: 'brushed', knob: 'black', label: 'block', led: '#3bff8a' },
  trim: -0.9,
  knobs: [['mode', 'MODE', 1, 4, 2, 1, (v) => String(Math.round(v))], ['mix', 'WIDTH', 0, 10, 6]],
  build(c, k) {
    const input = k.G(1), lfo = k.lfo(0.3, 'triangle'), dA = k.delay(0.03, 0.007), dB = k.delay(0.03, 0.007), sA = k.G(0), sB = k.G(0);
    k.chain(lfo, sA, dA.delayTime); k.chain(lfo, sB, dB.delayTime);
    // (the wet lines lose their lows, so the bass stays solid and centred, and their far top, as bucket brigades do)
    const band = k.chain(input, k.F('highpass', 220, -3), k.F('lowpass', 7500, -3)), wA = k.chain(band, dA), wB = k.chain(band, dB);
    const L = k.G(1), R = k.G(1), aL = k.G(0), bL = k.G(0), aR = k.G(0), bR = k.G(0);
    input.connect(L); input.connect(R);
    k.chain(wA, aL, L); k.chain(wB, bL, L); k.chain(wA, aR, R); k.chain(wB, bR, R);
    return { input, output: k.merge(L, R), set(v, x) {
      const m = Math.round(v.mode) - 1, dep = [0.00022, 0.00038, 0.00056, 0.0008][m], w = (v.mix / 10) * 0.75;
      x.to(lfo.frequency, [0.25, 0.3, 0.42, 0.55][m]);
      x.to(sA.gain, dep); x.to(sB.gain, -dep);
      x.to(aL.gain, w); x.to(bL.gain, -0.45 * w); x.to(bR.gain, w); x.to(aR.gain, -0.45 * w);
    } };
  },
});

/* 10. Sidestep Crab: the auto-pan, in time with the band: the guitar walks side to side like a crab. SQR hops (a
   softened hop, no click). */
pedalDef({
  id: 'sidestep', name: 'Sidestep Crab', kind: 'AUTO-PAN · IN TIME', cat: 'mod', where: 'post', color: '#0f8b8d', ink: '#effffd', stereo: true,
  nod: 'the studio auto-panner, as a stomp', blurb: 'Walks your guitar side to side in time with the band',
  look: { shape: 'box', finish: 'check', knob: 'black', label: 'block', led: '#ff5a2e' },
  trim: 3,
  knobs: [['rate', 'RATE', 0, 6, 2, 1, (v) => modPick(MOD_PAN, v)[0]], ['width', 'WIDTH', 0, 10, 7],
    { key: 'shape', label: 'SHAPE', opts: ['SINE', 'SQR'], def: 0 }],
  build(c, k) {
    const input = k.G(1), pan = k.pan(0), wd = k.G(0), grid = modGrid(k, 1);
    k.chain(grid.out, wd, pan.pan); k.chain(input, pan);
    let key = '';
    return { input, output: pan, set(v, x) {
      x.to(wd.gain, v.width / 10);
      const kk = [v.rate, v.shape, x.bpm].join();
      if (kk === key) return;
      key = kk;
      const q = modPick(MOD_PAN, v.rate)[1], sq = v.shape === 1;
      const a = new Float32Array(Math.ceil((8 * 60 * 12000) / x.bpm) + 2);
      for (let i = 0; i < a.length; i++) { const ph = ((i / 12000) * x.bpm) / 60 / q % 1; a[i] = sq ? (ph < 0.5 ? -1 : 1) : -Math.cos(2 * Math.PI * ph); }
      if (sq) modSmooth(a, 1 - Math.exp(-1 / (0.006 * 12000)), 1 - Math.exp(-1 / (0.006 * 12000)));
      grid.make(x.bpm, (b) => a[Math.min(a.length - 1, Math.round((b * 60 * 12000) / x.bpm))]);
    } };
  },
});

/* 11. Ringed Seal: the ring modulator. The guitar times a carrier: every note splits into two, above and below, clangy
   and out of key (that's the point). An LFO sweeps the carrier; under 20 Hz or so it turns into a stuttering tremolo. */
pedalDef({
  id: 'ringseal', name: 'Ringed Seal', kind: 'RING MODULATOR', cat: 'mod', where: 'pre', color: '#353b42', ink: '#9ef8ff',
  nod: 'the lab ring modulators of sci-fi soundtracks and krautrock', blurb: 'Bells, robots and broken radios from every note',
  look: { shape: 'wide', finish: 'hammer', knob: 'chrome', label: 'stencil', led: '#43f0ff' },
  trim: 3.4,
  knobs: [['freq', 'FREQ', 0, 10, 5, 0, (v) => modHz(30 * Math.pow(2, v * 0.6))], ['lfo', 'LFO', 0, 10, 3, 0, (v) => modHz(0.1 * Math.pow(2, v * 0.6))],
    ['sweep', 'SWEEP', 0, 10, 2], ['mix', 'MIX', 0, 10, 6], { key: 'wave', label: 'WAVE', opts: ['SINE', 'SQR'], def: 0 }],
  build(c, k) {
    const input = k.G(1), output = k.G(1), ring = k.G(0), wet = k.G(0), dry = k.G(1), car = c.createOscillator(), lfo = k.lfo(0.3), sw = k.G(0);
    car.frequency.value = 240; car.start(); k.own(car);
    k.chain(lfo, sw, car.detune); car.connect(ring.gain);
    k.chain(input, ring, wet, output); k.chain(input, dry, output);
    return { input, output, set(v, x) {
      car.type = v.wave ? 'square' : 'sine';
      x.to(car.frequency, 30 * Math.pow(2, v.freq * 0.6)); // 30 Hz to 1.9 kHz
      x.to(lfo.frequency, 0.1 * Math.pow(2, v.lfo * 0.6)); // 0.1 to 6.4 Hz
      x.to(sw.gain, v.sweep * 240); // up to two octaves each way, in cents
      const m = v.mix / 10;
      x.to(wet.gain, m * (v.wave ? 0.8 : 1.3)); x.to(dry.gain, 1 - m); // (a sine carrier halves the power; a square's doesn't)
    } };
  },
});

/* 12. Seasick Squid: tape wow and flutter gone mad. The delay wanders on a smooth random walk (WOW, with the odd
   lurch), plus a fast jitter (FLUTTER); DRIFT is how fast it wanders, AGE how worn the tape sounds. Seeded, so the
   same every time. */
pedalDef({
  id: 'seasick', name: 'Seasick Squid', kind: 'WOW & FLUTTER', cat: 'mod', where: 'post', color: '#a3c43c', ink: '#1a2305',
  nod: 'a warped cassette deck with a dying capstan', blurb: 'Wobbly, warped, wandering pitch: a tape left in the sun',
  look: { shape: 'wide', finish: 'sparkle', knob: 'cream', label: 'script', led: '#b8ff3b' },
  trim: 0.9,
  knobs: [['wow', 'WOW', 0, 10, 5], ['flutter', 'FLUTTER', 0, 10, 3], ['drift', 'DRIFT', 0, 10, 5], ['age', 'AGE', 0, 10, 4], ['mix', 'MIX', 0, 10, 10]],
  build(c, k) {
    const SR = 3000, r = k.rng(0x5ea5), input = k.G(1), output = k.G(1), d = k.delay(0.06, 0.008), wet = k.G(1), dry = k.G(0);
    // a smooth random walk through random points (cubic), with the odd big lurch; and a fast, jittery one
    const walk = (secs, every, lurch) => {
      const n = Math.round(secs / every), pts = [];
      for (let i = 0; i < n; i++) pts.push(r() * (r() > 1 - lurch * 2 ? 1 : 0.45));
      const b = c.createBuffer(1, Math.round(secs * SR), SR), a = b.getChannelData(0), per = every * SR;
      for (let i = 0; i < a.length; i++) {
        const t = i / per, j = Math.floor(t), f = t - j, p0 = pts[(j - 1 + n) % n], p1 = pts[j % n], p2 = pts[(j + 1) % n], p3 = pts[(j + 2) % n];
        a[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
      }
      const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return k.own(s);
    };
    const wow = walk(24, 0.45, 0.12), flut = walk(4, 1 / 14, 0);
    const wG = k.G(0), fG = k.G(0);
    k.chain(wow, wG, d.delayTime); k.chain(flut, fG, d.delayTime);
    const hp = k.F('highpass', 60, -3), lp = k.F('lowpass', 9000, -3);
    k.chain(input, d, hp, lp, wet, output); k.chain(input, dry, output);
    let lat = 0.008;
    return { input, output, get latency() { return lat; }, set(v, x) {
      const W = v.wow * 0.0011, F = v.flutter * 0.00007; // (the walks reach about ±1)
      lat = W + F + 0.0015;
      x.to(wG.gain, W, 0.1); x.to(fG.gain, F, 0.1); x.to(d.delayTime, lat, 0.1);
      const rate = 0.35 * Math.pow(2, v.drift * 0.3); // 0.35x to 2.8x
      x.to(wow.playbackRate, rate, 0.2); x.to(flut.playbackRate, 0.6 + rate * 0.4, 0.2);
      x.to(lp.frequency, 14000 * Math.pow(2, -v.age * 0.27)); x.to(hp.frequency, 40 + v.age * 14);
      x.to(wet.gain, v.mix / 10); x.to(dry.gain, 1 - v.mix / 10);
    } };
  },
});

/* 13. Claw Chopper: the trance gate. A two-bar pattern of sixteenths (or triplets) chops the guitar in time with the
   band; PING throws alternate chops left and right. LENGTH is how much of each step stays open. */
const MOD_CHOP = [
  ['1/8', 8, 'xxxxxxxxxxxxxxxx'], ['1/16', 16, 'x'.repeat(32)], ['GALLOP', 16, 'x-xxx-xxx-xxx-xx'.repeat(2)],
  ['SKANK', 8, '.x.x.x.x.x.x.x.x'], ['TRANCE', 16, 'x.xx.xx.x.xx.xxx' + 'x.x.xx.xx.xx.x.x'], ['STUTTER', 16, 'x-x-x-x-xxxxxxxx' + 'x---x---x.x.xxxx'],
  ['WOBBLE', 12, 'x'.repeat(24)], ['RANDOM', 16, null]];
pedalDef({
  id: 'clawchop', name: 'Claw Chopper', kind: 'SLICER · IN TIME', cat: 'mod', where: 'post', color: '#16131a', ink: '#ff3ba0', stereo: true,
  nod: 'the trance gate from dance records, locked to the band', blurb: 'Chops your chords into rhythms, in time with the band',
  look: { shape: 'box', finish: 'stripe', knob: 'small', label: 'stencil', led: '#ff3ba0' },
  trim: 2,
  knobs: [['pat', 'PATTERN', 0, 7, 1, 1, (v) => MOD_CHOP[Math.round(v)][0]], ['depth', 'DEPTH', 0, 10, 9], ['len', 'LENGTH', 0, 10, 6],
    { key: 'st', label: 'STEREO', opts: ['MONO', 'PING'], def: 0 }],
  build(c, k) {
    const input = k.G(1), gL = k.G(1), gR = k.G(1), dL = k.G(0), dR = k.G(0), grid = modGrid(k, 2), sp = c.createChannelSplitter(2);
    grid.out.connect(sp); sp.connect(dL, 0); sp.connect(dR, 1); dL.connect(gL.gain); dR.connect(gR.gain);
    input.connect(gL); input.connect(gR);
    // the random pattern: seeded, so it's the same pattern every time
    const rnd = k.rng(0xc1a3);
    let rp = '';
    for (let i = 0; i < 32; i++) { const u = rnd(); rp += u > 0.1 ? 'x' : i && rp[i - 1] !== '.' && u > -0.4 ? '-' : '.'; }
    let key = '';
    return { input, output: k.merge(gL, gR), grid, set(v, x) {
      x.to(dL.gain, v.depth / 10); x.to(dR.gain, v.depth / 10);
      const kk = [v.pat, v.len, v.st, x.bpm].join();
      if (kk === key) return;
      key = kk;
      const [, per, p0] = MOD_CHOP[Math.round(v.pat)], pat = p0 || rp, step = 4 / per; // (in beats)
      // notes: [start beat, length in beats, which one]
      const notes = [];
      for (let i = 0; i < pat.length; i++) if (pat[i] === 'x') { let j = i + 1; while (pat[j] === '-') j++; notes.push([i * step, (j - i) * step, notes.length]); }
      const SR = 12000, n = Math.ceil((8 * 60 * SR) / x.bpm) + 2, bs = (60 * SR) / x.bpm, env = [new Float32Array(n), new Float32Array(n)];
      const att = 0.0015 * SR, rel = 0.005 * SR, frac = 0.15 + v.len * 0.085;
      for (const [s, l, idx] of notes) {
        const a = Math.round(s * bs), open = Math.max(att + rel, l * bs * frac), e = Math.min(n, Math.round(a + open));
        for (const ch of v.st ? [idx % 2] : [0, 1]) {
          const E = env[ch];
          for (let i = a; i < e; i++) { const t = i - a, left = e - i; E[i] = Math.max(E[i], Math.min(1, t / att, left / rel)); }
        }
      }
      grid.make(x.bpm, (b, ch) => env[ch][Math.min(n - 1, Math.round(b * bs))] - 1);
    } };
  },
});

/* 14. Krill Swarm: six chorus voices at once, each on its own delay, its own slow LFO and its own place in the stereo
   field. A choir of slightly-wrong guitars: huge and a bit queasy. */
pedalDef({
  id: 'krillswarm', name: 'Krill Swarm', kind: 'CHORUS × 6', cat: 'mod', where: 'post', color: '#ff7b6a', ink: '#2a0a07', stereo: true,
  nod: 'the ensemble chorus of string machines, times six', blurb: 'Six detuned guitars around you: huge, lush, queasy',
  look: { shape: 'box', finish: 'hammer', knob: 'cream', label: 'block', led: '#ffe14d' },
  trim: 0.6,
  knobs: [['rate', 'RATE', 0, 10, 4], ['depth', 'DEPTH', 0, 10, 5], ['spread', 'SPREAD', 0, 10, 8], ['mix', 'MIX', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), wet = k.G(0), dry = k.G(1);
    const V = [[0.0071, 0.21, -1], [0.0093, 0.33, 0.6], [0.0118, 0.47, -0.2], [0.0134, 0.61, 1], [0.0162, 0.83, -0.6], [0.0195, 1.07, 0.2]];
    const voices = V.map(([t, f, p], i) => {
      const d = k.delay(0.04, t), lfo = k.lfo(f, i % 2 ? 'triangle' : 'sine'), sw = k.G(0), pan = k.pan(p);
      k.chain(lfo, sw, d.delayTime); k.chain(input, d, pan, wet);
      return { lfo, sw, pan, f, p, sign: i % 3 ? 1 : -1 };
    });
    k.chain(wet, output); k.chain(input, dry, output);
    return { input, output, set(v, x) {
      const rf = 0.3 * Math.pow(2, v.rate * 0.4); // 0.3x to 4.8x
      for (const o of voices) { x.to(o.lfo.frequency, o.f * rf); x.to(o.sw.gain, o.sign * v.depth * 0.00018 / Math.sqrt(rf)); x.to(o.pan.pan, o.p * v.spread / 10); }
      x.to(wet.gain, (v.mix / 10) * 0.62); x.to(dry.gain, 1 - v.mix / 20);
    } };
  },
});
}
