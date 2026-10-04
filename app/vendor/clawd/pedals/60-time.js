// vendored verbatim from clawd-o-matic/web/pedals/60-time.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: time and space. Delays (tape, bucket-brigade, digital, ping-pong, reverse, slapback) and reverbs
   (spring, plate, hall, shimmer, granular cloud), plus three odd ones: a dub siren delay, a delay whose batteries are
   dying and a freeze. Every one is a trails pedal (wet only out: the platform keeps the dry at unity), so tails ring on
   after a stomp. Levels measured with tools/pedal-check.js; every IR comes from kit.ir with a fixed seed. */
{
const tmMs = (v) => Math.round(v) + ' ms';

/* ---- the worklets (each processor name starts with its pedal's id) */
// Reverse: records a chunk (a note value long), then plays it back to front while it records the next one. Smooth
// fades at the chunk edges hide the seams; REPEATS feeds the reversed sound back in (so a repeat plays forwards again).
const TM_REV = `class SidewaysRev extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'len', defaultValue: 0.5, minValue: 0.05, maxValue: 4, automationRate: 'k-rate' }, { name: 'fb', defaultValue: 0, minValue: 0, maxValue: 0.9, automationRate: 'k-rate' }]; }
  constructor() { super(); let n = 1; while (n < sampleRate * 8.5) n <<= 1; this.b = new Float32Array(n); this.m = n - 1; this.w = 0; this.j = 0; this.N = 0; this.pS = 0; this.pN = 0; this.F = Math.round(0.012 * sampleRate); }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const b = this.b, m = this.m, fb = p.fb[0], F = this.F;
    if (!this.N) this.N = Math.max(4 * F, Math.round(p.len[0] * sampleRate));
    for (let n = 0; n < o.length; n++) {
      let y = 0;
      const j = this.j, pN = this.pN;
      if (j < pN) { const e = Math.min(1, j / F, (pN - 1 - j) / F); y = b[(this.pS + pN - 1 - j) & m] * e * e * (3 - 2 * e); }
      b[this.w] = (i ? i[n] : 0) + fb * y;
      o[n] = y;
      this.w = (this.w + 1) & m;
      if (++this.j >= this.N) { this.pN = this.N; this.pS = (this.w - this.N) & m; this.N = Math.max(4 * F, Math.round(p.len[0] * sampleRate)); this.j = 0; }
    }
    return true;
  }
}
registerProcessor('sideways-rev', SidewaysRev);`;

// A two-tap delay-line pitch shifter (the shimmer's octave): each tap's delay sweeps at (1 - ratio) samples a sample,
// so it reads at ratio times speed, and the taps take turns under a sine window. Grainy on its own; lovely in a reverb.
const TM_PITCH = `class HaloPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 2, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() { super(); this.b = new Float32Array(16384); this.w = 0; this.ph = 0; this.W = Math.min(12000, Math.round(0.07 * sampleRate)); }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const b = this.b, M = 16383, W = this.W, step = (1 - p.ratio[0]) / W;
    let ph = this.ph, w = this.w;
    for (let n = 0; n < o.length; n++) {
      b[w] = i ? i[n] : 0;
      ph += step; ph -= Math.floor(ph);
      const q2 = ph + 0.5 - Math.floor(ph + 0.5);
      const r1 = w - 2 - ph * W, a1 = Math.floor(r1), f1 = r1 - a1, x1 = b[a1 & M], y1 = b[(a1 + 1) & M];
      const r2 = w - 2 - q2 * W, a2 = Math.floor(r2), f2 = r2 - a2, x2 = b[a2 & M], y2 = b[(a2 + 1) & M];
      o[n] = 0.8 * ((x1 + (y1 - x1) * f1) * Math.sin(Math.PI * ph) + (x2 + (y2 - x2) * f2) * Math.sin(Math.PI * q2));
      w = (w + 1) & M;
    }
    this.ph = ph; this.w = w;
    return true;
  }
}
registerProcessor('halojelly-pitch', HaloPitch);`;

// A granular cloud: the input (and some of the cloud, fed back) goes into a few seconds of buffer; grains a GRAIN
// long start at random points up to SMEAR back, each slightly detuned (and at high DRIFT sometimes an octave up or
// down), panned at random under a Hann window. Seeded, so it's the same cloud every time.
const TM_GRAINS = `class PlanktonGrains extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'size', defaultValue: 0.2, minValue: 0.02, maxValue: 0.6, automationRate: 'k-rate' },
    { name: 'spread', defaultValue: 1, minValue: 0, maxValue: 2.6, automationRate: 'k-rate' },
    { name: 'drift', defaultValue: 10, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
    { name: 'oct', defaultValue: 0, minValue: 0, maxValue: 0.5, automationRate: 'k-rate' },
    { name: 'fb', defaultValue: 0.4, minValue: 0, maxValue: 0.85, automationRate: 'k-rate' }]; }
  constructor(o) {
    super(); let n = 1; while (n < sampleRate * 4.5) n <<= 1; this.b = new Float32Array(n); this.m = n - 1; this.w = 0;
    this.s = ((o && o.processorOptions && o.processorOptions.seed) || 7) >>> 0;
    const V = this.V = 24; this.pos = new Float64Array(V); this.inc = new Float64Array(V); this.len = new Float64Array(V); this.age = new Float64Array(V);
    this.gl = new Float32Array(V); this.gr = new Float32Array(V); this.on = new Uint8Array(V); this.next = 0;
    this.hann = new Float32Array(1025); for (let j = 0; j <= 1024; j++) this.hann[j] = 0.5 - 0.5 * Math.cos((6.283185307 * j) / 1024); // (a table: no cos per grain per sample)
  }
  r() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const sr = sampleRate, b = this.b, m = this.m, V = this.V, size = p.size[0], len = Math.max(64, size * sr), sp = p.spread[0] * sr;
    const drift = p.drift[0], oct = p.oct[0], fb = p.fb[0], every = (len / 6), norm = 1 / Math.sqrt(6 * 0.375);
    for (let n = 0; n < oL.length; n++) {
      if (--this.next <= 0) {
        this.next = every * (0.5 + this.r());
        for (let v = 0; v < V; v++) if (!this.on[v]) {
          let c = drift * (this.r() * 2 - 1); const u = this.r();
          if (u < oct) c += u < oct / 2 ? 1200 : -1200;
          const inc = Math.pow(2, c / 1200), pan = 0.1 + 0.8 * this.r();
          this.on[v] = 1; this.inc[v] = inc; this.len[v] = len; this.age[v] = 0;
          this.pos[v] = this.w - (len * Math.max(1, inc) + 128 + this.r() * sp);
          this.gl[v] = Math.cos(pan * 1.5708); this.gr[v] = Math.sin(pan * 1.5708);
          break;
        }
      }
      let L = 0, R = 0;
      for (let v = 0; v < V; v++) {
        if (!this.on[v]) continue;
        const win = this.hann[(this.age[v] * 1024 / this.len[v]) | 0];
        const q = this.pos[v], q0 = Math.floor(q), f = q - q0, x0 = b[q0 & m], x1 = b[(q0 + 1) & m], s = (x0 + (x1 - x0) * f) * win;
        L += s * this.gl[v]; R += s * this.gr[v];
        this.pos[v] = q + this.inc[v];
        if (++this.age[v] >= this.len[v]) this.on[v] = 0;
      }
      L *= norm; R *= norm;
      b[this.w] = (i ? i[n] : 0) + fb * 0.7071 * (L + R);
      this.w = (this.w + 1) & m;
      oL[n] = L; oR[n] = R;
    }
    return true;
  }
}
registerProcessor('planktoncloud-grains', PlanktonGrains);`;

// The freeze: it always keeps the last second of what it hears. HOLD copies the last 0.7 s out and plays it as an
// endless pad (five overlapping Hann grains from random points in it, panned about) that swells in; letting go fades it.
const TM_FREEZE = `class FrostbiteFreeze extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'hold', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor() {
    super(); let n = 1; while (n < sampleRate * 1.1) n <<= 1; this.b = new Float32Array(n); this.m = n - 1; this.w = 0;
    this.F = Math.round(0.7 * sampleRate); this.fz = new Float32Array(this.F); this.G = Math.round(0.3 * sampleRate);
    this.V = 5; this.pos = new Float64Array(5); this.age = new Float64Array(5); this.s = 12345; this.was = false; this.env = 0;
    this.up = 1 - Math.exp(-1 / (0.35 * sampleRate)); this.down = 1 - Math.exp(-1 / (1.8 * sampleRate));
  }
  r() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const hold = p.hold[0] > 0.5, F = this.F, G = this.G, V = this.V, b = this.b, m = this.m, fz = this.fz;
    if (hold && !this.was) {
      for (let k = 0; k < F; k++) fz[k] = b[(this.w - F + k) & m];
      for (let v = 0; v < V; v++) { this.age[v] = (v * G) / V; this.pos[v] = this.r() * (F - G - 1); }
    }
    this.was = hold;
    const want = hold ? 1 : 0, rate = hold ? this.up : this.down, norm = 1 / Math.sqrt(V * 0.375);
    for (let n = 0; n < oL.length; n++) {
      b[this.w] = i ? i[n] : 0; this.w = (this.w + 1) & m;
      this.env += (want - this.env) * rate;
      if (this.env < 1e-5) { oL[n] = 0; oR[n] = 0; continue; }
      let L = 0, R = 0;
      for (let v = 0; v < V; v++) {
        const a = this.age[v] / G, s = fz[Math.floor(this.pos[v] + this.age[v])] * (0.5 - 0.5 * Math.cos(6.283185307 * a));
        if (v & 1) { L += s * 0.45; R += s * 0.89; } else { L += s * 0.89; R += s * 0.45; }
        if (++this.age[v] >= G) { this.age[v] = 0; this.pos[v] = this.r() * (F - G - 1); }
      }
      const e = this.env * norm;
      oL[n] = L * e; oR[n] = R * e;
    }
    return true;
  }
}
registerProcessor('frostbite-freeze', FrostbiteFreeze);`;

// A reverb IR that rebuilds (off the audio thread's critical moment: once the knob settles) when its key changes.
const tmIR = (k, conv, make) => {
  let key = null, timer = 0;
  return (next) => {
    if (next === key) return;
    key = next; clearTimeout(timer);
    if (!conv.buffer) conv.buffer = make(); else timer = k.later(() => (conv.buffer = make()), 120);
  };
};

/* ================================================================ time */

// Tape Crab: one loop of tape, a record head and three playback heads at 1, 2 and 3 times the RATE. The record head
// saturates, so INTENSITY past about 8 runs away into a howl that stays musical instead of exploding.
pedalDef({
  id: 'tapecrab', name: 'Tape Crab', kind: 'TAPE ECHO', cat: 'time', where: 'post', trails: true, drone: true,
  color: '#4a5d3a', ink: '#f3e9c8', look: { shape: 'wide', finish: 'hammer', knob: 'chicken', label: 'plate', led: '#ff4d2e', foot2: 'heads' },
  nod: 'the seventies multi-head tape echo with the loop of tape inside', blurb: 'Warbly tape repeats; crank INTENSITY and it runs away',
  knobs: [['time', 'RATE', 0, 5, 1, 1, PFX.noteFmt], ['int', 'INTENSITY', 0, 10, 4], ['age', 'TAPE AGE', 0, 10, 4], ['mix', 'ECHO', 0, 14, 5],
    { key: 'heads', label: 'HEADS', opts: ['1', '1+2', '1+2+3'], def: 1 }, { key: 'tap', label: 'TAP', tap: true }],
  build(c, k) {
    const input = k.G(1), rec = k.G(0.8), sat = k.curve((x) => Math.tanh(2.2 * x) / 2.2), sum = k.G(1);
    const heads = [0, 1, 2].map(() => k.delay(4.2, 0.25)), hg = heads.map(() => k.G(0));
    const lp = k.F('lowpass', 5000, -3), hp = k.F('highpass', 110, -3), fb = k.G(0.3), wet = k.G(0);
    k.chain(input, rec, sat);
    heads.forEach((d, i) => k.chain(sat, d, hg[i], sum));
    k.chain(sum, lp, hp, wet); k.chain(hp, fb, sat); // (the loop skips rec's pad: INTENSITY is the loop's gain)
    // wow (the capstan, slow) and flutter (the pinch roller, fast), both on the one tape so on every head
    const wowG = k.G(0), flG = k.G(0);
    k.chain(k.lfo(0.53), wowG); k.chain(k.lfo(6.1, 'triangle'), flG);
    for (const d of heads) { wowG.connect(d.delayTime); flG.connect(d.delayTime); }
    return { input, output: wet, set(v, x) {
      const t = v.tap >= 40 ? PFX.noteSec(v.time, v.tap) : x.note(v.time), n = v.heads + 1; // (TAP: its own tempo, else the song's)
      heads.forEach((d, i) => x.to(d.delayTime, Math.min(4, t * (i + 1)), 0.08));
      hg.forEach((g, i) => x.to(g.gain, i < n ? 1 / Math.sqrt(n) : 0, 0.02));
      // the loop's gain: gentle to 6, then it climbs past unity near 8 (the saturation holds the runaway)
      x.to(fb.gain, v.int <= 6 ? v.int * 0.1 : 0.6 + (v.int - 6) * 0.19);
      x.to(lp.frequency, 6500 * Math.pow(2, -v.age * 0.17)); // 6.5 kHz new to 2 kHz worn
      x.to(wowG.gain, 0.0002 + v.age * 0.00018); x.to(flG.gain, 0.00004 + v.age * 0.000012);
      x.to(wet.gain, v.mix * 0.105);
    } };
  },
});

// Mud Shrimp: a bucket-brigade delay. Short (600 ms at most), and the longer you set it the darker it gets (the chip's
// clock slows, so its filters close); the repeats wobble with a little chorus and smear as they soft-clip.
pedalDef({
  id: 'mudshrimp', name: 'Mud Shrimp', kind: 'ANALOG DELAY', cat: 'time', where: 'post', trails: true,
  color: '#7a4b2a', ink: '#ffe4b8', look: { shape: 'box', finish: 'flat', knob: 'cream', label: 'stencil', led: '#ffb347' },
  nod: 'the bucket-brigade chip delays: dark, warm and a bit seasick', blurb: 'Murky, wobbly repeats that sit behind you',
  knobs: [['time', 'TIME', 20, 600, 320, 1, tmMs], ['fb', 'REPEATS', 0, 10, 4], ['mix', 'MIX', 0, 10, 5], ['mod', 'MOD', 0, 10, 3]],
  build(c, k) {
    const input = k.G(1), aa = k.F('lowpass', 2500, -3), sum = k.G(1), sat = k.curve((x) => Math.tanh(1.8 * x) / 1.8), dl = k.delay(0.7, 0.32);
    const rc = k.F('lowpass', 2500, -3), rc2 = k.F('lowpass', 3500, -3), hp = k.F('highpass', 80, -3), fb = k.G(0.3), wet = k.G(0);
    k.chain(input, aa, sum, sat, dl, rc, rc2, hp, wet); k.chain(hp, fb, sum);
    const lfo = k.lfo(0.8, 'triangle'), dep = k.G(0);
    k.chain(lfo, dep, dl.delayTime);
    return { input, output: wet, set(v, x) {
      const t = v.time / 1000, fc = k.clamp(2600 * Math.sqrt(0.3 / t), 1100, 7500);
      x.to(dl.delayTime, t, 0.06);
      x.to(aa.frequency, fc); x.to(rc.frequency, fc); x.to(rc2.frequency, fc * 1.4);
      x.to(fb.gain, v.fb * 0.088);
      x.to(lfo.frequency, 0.4 + v.mod * 0.35); x.to(dep.gain, v.mod * 0.00035 * Math.min(1, t / 0.1));
      x.to(wet.gain, v.mix * 0.14);
    } };
  },
});

// Glass Claw: a clean digital delay, up to 2 s. SYNC takes a note value at the band's tempo; FREE takes TIME in ms.
// The top of REPEATS still falls at least 1.6 dB a second, however long the time (a wash, not a runaway).
pedalDef({
  id: 'glassclaw', name: 'Glass Claw', kind: 'DIGITAL DELAY', cat: 'time', where: 'post', trails: true,
  color: '#0b1d2b', ink: '#7fe0ff', look: { shape: 'wide', finish: 'flat', knob: 'chrome', label: 'block', led: '#29b6ff', foot2: 'mode' },
  nod: 'the crystal-clear digital delays of the eighties rack and the compact boxes after them', blurb: 'Pristine repeats in time with the band, or free in ms',
  knobs: [{ key: 'mode', label: 'MODE', opts: ['SYNC', 'FREE'], def: 0 }, ['note', 'NOTE', 0, 5, 3, 1, PFX.noteFmt], ['ms', 'TIME', 20, 2000, 450, 1, tmMs],
    ['fb', 'REPEATS', 0, 10, 3.5], ['mix', 'LEVEL', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), sum = k.G(1), dl = k.delay(2.1, 0.5), hc = k.F('lowpass', 13000, -3), lc = k.F('highpass', 50, -3), fb = k.G(0.3), wet = k.G(0);
    k.chain(input, sum, dl, hc, lc, wet); k.chain(lc, fb, sum);
    return { input, output: wet, set(v, x) {
      const t = v.mode ? v.ms / 1000 : Math.min(2, x.note(v.note));
      x.to(dl.delayTime, t, 0.04);
      x.to(fb.gain, (v.fb / 10) * Math.min(0.94, Math.pow(10, (-1.6 * t) / 20)));
      x.to(wet.gain, v.mix * 0.06);
    } };
  },
});

// Ping Pong Prawn: the repeats bounce left, right, left. WIDTH narrows it back towards the middle.
pedalDef({
  id: 'pingprawn', name: 'Ping Pong Prawn', kind: 'STEREO DELAY', cat: 'time', where: 'post', trails: true, stereo: true,
  color: '#ff7a59', ink: '#1c0a04', look: { shape: 'wide', finish: 'check', knob: 'small', label: 'script', led: '#fffb7a' },
  nod: 'the studio ping-pong delay, left to right and back', blurb: 'Repeats that bounce from speaker to speaker',
  knobs: [['time', 'TIME', 0, 5, 1, 1, PFX.noteFmt], ['fb', 'REPEATS', 0, 10, 4], ['tone', 'TONE', 0, 10, 6], ['width', 'WIDTH', 0, 10, 8], ['mix', 'MIX', 0, 10, 4]],
  build(c, k) {
    const input = k.G(1), dL = k.delay(2.1, 0.25), dR = k.delay(2.1, 0.25), lpL = k.F('lowpass', 5000, -3), lpR = k.F('lowpass', 5000, -3);
    const cross = k.G(0.6), fb = k.G(0.6), aL = k.G(1), bL = k.G(0), aR = k.G(1), bR = k.G(0), wet = k.G(0);
    k.chain(input, k.F('highpass', 100, -3), dL, lpL, cross, dR, lpR, fb, dL);
    const oL = k.G(1), oR = k.G(1);
    lpL.connect(aL); aL.connect(oL); lpR.connect(bL); bL.connect(oL);
    lpR.connect(aR); aR.connect(oR); lpL.connect(bR); bR.connect(oR);
    k.chain(k.merge(oL, oR), wet);
    return { input, output: wet, set(v, x) {
      const t = x.note(v.time), f = Math.sqrt(v.fb * 0.09) * Math.min(1, Math.pow(10, (-1.6 * t) / 20)), // (each bounce; the top still falls 1.6 dB/s)
        w = v.width / 10, lp = 1500 * Math.pow(2, v.tone * 0.3);
      x.to(dL.delayTime, t, 0.05); x.to(dR.delayTime, t, 0.05);
      x.to(cross.gain, f); x.to(fb.gain, f);
      x.to(lpL.frequency, lp); x.to(lpR.frequency, lp);
      x.to(aL.gain, (1 + w) / 2); x.to(aR.gain, (1 + w) / 2); x.to(bL.gain, (1 - w) / 2); x.to(bR.gain, (1 - w) / 2);
      x.to(wet.gain, v.mix * 0.14);
    } };
  },
});

// Sideways Crab: a reverse delay. What you played a note value ago comes back to front, swelling in.
pedalDef({
  id: 'sideways', name: 'Sideways Crab', kind: 'REVERSE DELAY', cat: 'time', where: 'post', trails: true,
  color: '#6a2ce0', ink: '#f4ecff', look: { shape: 'box', finish: 'stripe', knob: 'black', label: 'stencil', led: '#66ffcc' },
  nod: 'the backwards-tape trick of psychedelic records, in a box', blurb: 'Your riff played backwards, in time, behind you',
  worklets: { 'sideways-rev': TM_REV },
  knobs: [['time', 'TIME', 0, 5, 3, 1, PFX.noteFmt], ['fb', 'REPEATS', 0, 10, 3], ['mix', 'MIX', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), wet = k.G(0);
    const node = k.worklet('sideways-rev', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    if (node) k.chain(input, node, k.F('lowpass', 7000, -3), k.F('highpass', 90, -3), wet); // (no worklet: no wet, just the dry)
    return { input, output: wet, node, set(v, x) {
      if (node) { x.to(node.parameters.get('len'), Math.min(4, x.note(v.time)), 0.001); x.to(node.parameters.get('fb'), v.fb * 0.07); }
      x.to(wet.gain, v.mix * 0.08);
    } };
  },
});

// Quiff Crab: one quick slap off the tape, darkish, a touch of wobble: the rockabilly echo.
pedalDef({
  id: 'quiffcrab', name: 'Quiff Crab', kind: 'SLAPBACK', cat: 'time', where: 'post', trails: true,
  color: '#d11f3f', ink: '#fff3da', look: { shape: 'round', finish: 'sparkle', knob: 'chicken', label: 'script', led: '#ffe066' },
  nod: 'the fifties tape-machine slap on every rockabilly record', blurb: 'One fat slap right behind every note',
  knobs: [['time', 'SLAP', 40, 220, 110, 1, tmMs], ['level', 'LEVEL', 0, 10, 5], ['tone', 'TONE', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), sum = k.G(1), dl = k.delay(0.3, 0.11), lp = k.F('lowpass', 3500, -3), hp = k.F('highpass', 160, -3), fb = k.G(0.1), wet = k.G(0);
    k.chain(input, k.G(0.9), k.curve((x) => Math.tanh(1.6 * x) / 1.6), sum, dl, lp, hp, wet); k.chain(hp, fb, sum);
    const wob = k.G(0.00025); k.chain(k.lfo(0.7), wob, dl.delayTime);
    return { input, output: wet, set(v, x) {
      x.to(dl.delayTime, v.time / 1000, 0.03);
      x.to(lp.frequency, 1800 * Math.pow(2, v.tone * 0.2)); // 1.8 to 7.2 kHz
      x.to(wet.gain, v.level * 0.11);
    } };
  },
});

/* ================================================================ ambient */

// Springy Squid: a spring tank. Two springs, each a delay loop through a chain of allpass filters: they delay some
// frequencies more than others (dispersion), so every trip round smears a click into the drippy chirp springs make.
// DWELL drives the tank's driver valve: dig in and it saturates, and the springs crash and boing.
pedalDef({
  id: 'springsquid', name: 'Springy Squid', kind: 'SPRING REVERB', cat: 'ambient', where: 'post', trails: true, stereo: true,
  color: '#1d6f7a', ink: '#eafffb', look: { shape: 'box', finish: 'hammer', knob: 'cream', label: 'plate', led: '#ff9f1c' },
  nod: 'the sixties outboard valve spring tank surf guitarists drench everything in', blurb: 'Drippy, boingy surf splash; hit it hard for the crash',
  knobs: [['dwell', 'DWELL', 0, 10, 5], ['tone', 'TONE', 0, 10, 5], ['mix', 'MIX', 0, 10, 4]],
  build(c, k) {
    const input = k.G(1), dwell = k.G(1), wet = k.G(0), tone = k.F('lowpass', 4000, -3);
    const drv = k.chain(input, k.F('highpass', 300, -3), k.F('lowpass', 4500, -3), dwell, k.shaper(2.5), k.G(0.5));
    const spring = (len, fa, fb, loop) => {
      const sum = k.G(1), d = k.delay(0.1, len);
      let at = k.chain(drv, sum, d);
      for (let i = 0; i < 12; i++) at = k.chain(at, k.F('allpass', i % 2 ? fb : fa, 1.6));
      k.chain(at, k.F('lowpass', 3800, -3), k.F('highpass', 120, -3), k.G(loop), sum);
      return at;
    };
    k.chain(k.merge(spring(0.029, 650, 1400, 0.86), spring(0.041, 760, 1650, 0.85)), tone, wet);
    return { input, output: wet, set(v, x) {
      x.to(dwell.gain, k.dB(-14 + v.dwell * 2.2));
      x.to(tone.frequency, 2000 * Math.pow(2, v.tone * 0.2)); // 2 to 8 kHz
      x.to(wet.gain, v.mix * 0.12);
    } };
  },
});

// Lobster Plate: a studio plate. Dense straight away (no echoes first), bright, smooth.
pedalDef({
  id: 'lobsterplate', name: 'Lobster Plate', kind: 'PLATE REVERB', cat: 'ambient', where: 'post', trails: true, stereo: true,
  color: '#2a2a2e', ink: '#ff6b4a', look: { shape: 'rack', finish: 'brushed', knob: 'small', label: 'plate', led: '#ff3b30' },
  nod: 'the big steel studio plate hung in a back room', blurb: 'The shiny, dense studio reverb on classic vocals',
  knobs: [['decay', 'DECAY', 0, 10, 4], ['tone', 'TONE', 0, 10, 6], ['pre', 'PREDELAY', 0, 150, 20, 1, tmMs], ['mix', 'MIX', 0, 10, 3]],
  build(c, k) {
    const input = k.G(1), pre = k.delay(0.2, 0.02), conv = k.convolver(), tone = k.F('lowpass', 8000, -3), wet = k.G(0);
    k.chain(input, k.F('highpass', 180, -3), pre, conv, tone, wet);
    let d = 4;
    const ir = tmIR(k, conv, () => k.ir({ secs: 0.6 + d * 0.54, pre: 0.001, seed: 31 + Math.round(d * 10), tail: 1.15, damp: 0.06, darken: 0.45 }));
    return { input, output: wet, set(v, x) {
      d = v.decay; ir(d);
      x.to(pre.delayTime, v.pre / 1000);
      x.to(tone.frequency, 2500 * Math.pow(2, v.tone * 0.23)); // 2.5 to 12 kHz
      x.to(wet.gain, v.mix * 0.18);
    } };
  },
});

// Kraken Hall: a big hall, or a cathedral. The IR gets early reflections off the walls and a slow build before its
// long tail (a cathedral: further walls, a slower build, darker, 1.6 times as long).
pedalDef({
  id: 'krakenhall', name: 'Kraken Hall', kind: 'HALL · CATHEDRAL', cat: 'ambient', where: 'post', trails: true, stereo: true, tail: 13,
  color: '#101a3a', ink: '#dfe6ff', look: { shape: 'wide', finish: 'sparkle', knob: 'chrome', label: 'stencil', led: '#8fa8ff', foot2: 'space' },
  nod: 'the huge concert-hall and cathedral programs of the big studio reverbs', blurb: 'A vast stone room: long, slow, enormous',
  knobs: [['size', 'SIZE', 0, 10, 5], ['tone', 'TONE', 0, 10, 4], ['pre', 'PREDELAY', 0, 120, 30, 1, tmMs], ['mix', 'MIX', 0, 10, 3],
    { key: 'space', label: 'SPACE', opts: ['HALL', 'CATH'], def: 0 }],
  build(c, k) {
    const input = k.G(1), pre = k.delay(0.15, 0.03), conv = k.convolver(), tone = k.F('lowpass', 5000, -3), wet = k.G(0);
    k.chain(input, k.F('highpass', 150, -3), pre, conv, tone, wet);
    let s = 5, cath = 0;
    const make = () => {
      const secs = (1.8 + 0.62 * s) * (cath ? 1.6 : 1), sr = k.sr, seed = 51 + Math.round(s * 10) + cath * 7;
      const b = k.ir({ secs, pre: 0.004, seed, tail: 1.12, damp: cath ? 0.3 : 0.2, darken: cath ? 0.6 : 0.65 /* (damp + darken < 1, or the noise's filter blows up) */ });
      const L = b.getChannelData(0), R = b.getChannelData(1), build = cath ? 0.09 : 0.05, rnd = k.rng(seed + 1);
      // the slow build (a hall's tail swells in), then early reflections off the walls, alternating sides
      for (let i = 0, n = Math.min(L.length, Math.round(sr * build * 6)); i < n; i++) { const g = 1 - Math.exp(-i / (sr * build)); L[i] *= g; R[i] *= g; }
      for (let e = 0; e < 10; e++) {
        const i = Math.round(sr * (0.006 + (e + 0.5 + rnd() * 0.4) * (cath ? 0.012 : 0.0075))), g = 0.35 * Math.exp(-e * 0.22) * (rnd() < 0 ? -1 : 1);
        if (i < L.length) { (e & 1 ? R : L)[i] += g; (e & 1 ? L : R)[i] += g * 0.4; }
      }
      return b;
    };
    const ir = tmIR(k, conv, make);
    return { input, output: wet, set(v, x) {
      s = v.size; cath = v.space; ir(s + ':' + cath);
      x.to(pre.delayTime, v.pre / 1000);
      x.to(tone.frequency, 1800 * Math.pow(2, v.tone * 0.25)); // 1.8 to 10 kHz
      x.to(wet.gain, v.mix * 0.2);
    } };
  },
});

// Halo Jelly: a shimmer. A reverb whose tail goes through an octave-up (or a fifth-up) pitch shifter and back into
// itself, so it climbs as it rings, like an organ over your chord. Each trip goes up and the top filter lets it go.
pedalDef({
  id: 'halojelly', name: 'Halo Jelly', kind: 'SHIMMER REVERB', cat: 'ambient', where: 'post', trails: true, stereo: true, tail: 8,
  color: '#f5d8ef', ink: '#3a1238', look: { shape: 'wide', finish: 'sparkle', knob: 'cream', label: 'script', led: '#ffffff', foot2: 'intv' },
  nod: 'the octave-shimmer reverbs of the ambient and post-rock crowd', blurb: 'Choir-of-angels reverb that climbs an octave as it rings',
  worklets: { 'halojelly-pitch': TM_PITCH },
  knobs: [['decay', 'DECAY', 0, 10, 5], ['shim', 'SHIMMER', 0, 10, 5], ['tone', 'TONE', 0, 10, 6], ['mix', 'MIX', 0, 10, 3.5],
    { key: 'intv', label: 'INTERVAL', opts: ['OCT', '5TH'], def: 0 }],
  build(c, k) {
    const input = k.G(1), sum = k.G(1), conv = k.convolver(), tone = k.F('lowpass', 7000, -3), wet = k.G(0), shim = k.G(0);
    k.chain(input, k.F('highpass', 200, -3), sum, conv, tone, wet);
    const ps = k.worklet('halojelly-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    if (ps) k.chain(conv, ps, k.F('highpass', 400, -3), k.F('lowpass', 7000, -3), shim, k.curve(Math.tanh), k.delay(0.1, 0.03), sum); // (tanh: a safety net) // (no worklet: a plain reverb)
    let d = 5;
    const ir = tmIR(k, conv, () => k.ir({ secs: 1.5 + d * 0.65, pre: 0.02, seed: 71 + Math.round(d * 10), tail: 1.1, damp: 0.1, darken: 0.5 }));
    return { input, output: wet, node: ps, set(v, x) {
      d = v.decay; ir(d);
      if (ps) x.to(ps.parameters.get('ratio'), v.intv ? 1.5 : 2, 0.001);
      x.to(shim.gain, v.shim * (v.intv ? 0.24 : 0.45)); // (measured: the loop stays under unity at 10 with DECAY at 10; a fifth stays in band longer)
      x.to(tone.frequency, 2500 * Math.pow(2, v.tone * 0.25));
      x.to(wet.gain, v.mix * 0.14);
    } };
  },
});

// Plankton Cloud: granular. Your playing torn into grains, scattered back up to SMEAR seconds, detuned (DRIFT: at the
// top some grains leap an octave), fed back into itself (DECAY) and then into a big dark room. Huge and smeared.
pedalDef({
  id: 'planktoncloud', name: 'Plankton Cloud', kind: 'GRANULAR CLOUD', cat: 'ambient', where: 'post', trails: true, stereo: true, tail: 8,
  color: '#7de3b5', ink: '#0b2a1f', look: { shape: 'wide', finish: 'flat', knob: 'small', label: 'block', led: '#ff5ec4' },
  nod: 'the granular cloud machines of ambient music, as a stompbox', blurb: 'Tears your playing into a glittering, smeared cloud',
  worklets: { 'planktoncloud-grains': TM_GRAINS },
  knobs: [['size', 'GRAIN', 0, 10, 5], ['smear', 'SMEAR', 0, 10, 6], ['drift', 'DRIFT', 0, 10, 3], ['decay', 'DECAY', 0, 10, 5], ['mix', 'MIX', 0, 10, 4]],
  build(c, k) {
    const input = k.G(1), wet = k.G(0), direct = k.G(0.6), room = k.G(0.8), conv = k.convolver(k.ir({ secs: 4.5, pre: 0.03, seed: 91, tail: 1.1, damp: 0.35, darken: 0.6 }));
    const gr = k.worklet('planktoncloud-grains', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit', processorOptions: { seed: 424242 } });
    if (gr) { k.chain(input, k.F('highpass', 150, -3), gr); k.chain(gr, direct, wet); k.chain(gr, conv, room, wet); }
    const P = (n) => gr && gr.parameters.get(n);
    return { input, output: wet, node: gr, set(v, x) {
      if (gr) {
        x.to(P('size'), 0.03 + v.size * 0.045, 0.05); x.to(P('spread'), 0.05 + v.smear * 0.24, 0.05);
        x.to(P('drift'), v.drift * 5); x.to(P('oct'), Math.max(0, (v.drift - 5) * 0.06)); x.to(P('fb'), v.decay * 0.075);
      }
      x.to(wet.gain, v.mix * 0.13);
    } };
  },
});

/* ================================================================ the odd ones */

// Siren Squid: a dub delay. The repeats go round through a resonant filter that sweeps (FREQ, SWEEP, RATE) and a
// saturator; FEEDBACK past about 9 tips the loop over unity and it wails on its own, held in check by the saturator.
pedalDef({
  id: 'sirensquid', name: 'Siren Squid', kind: 'DUB DELAY', cat: 'time', where: 'post', trails: true, drone: true,
  color: '#ffd400', ink: '#111111', look: { shape: 'rack', finish: 'stripe', knob: 'chicken', label: 'stencil', led: '#ff0033' },
  nod: 'the dub sound-system echo units, played like an instrument', blurb: 'Swooping filtered echoes; crank FEEDBACK and it wails',
  knobs: [['time', 'TIME', 0, 5, 2, 1, PFX.noteFmt], ['fb', 'FEEDBACK', 0, 10, 6], ['freq', 'FREQ', 0, 10, 5, 0, (v) => Math.round(250 * Math.pow(2, v * 0.45)) + ' Hz'],
    ['sweep', 'SWEEP', 0, 10, 5], ['rate', 'RATE', 0, 10, 4], ['mix', 'MIX', 0, 10, 4]],
  build(c, k) {
    const input = k.G(1), sum = k.G(1), dl = k.delay(2.5, 0.375), filt = k.F('lowpass', 1200, 2), sat = k.curve((x) => Math.tanh(2 * x) / 2), fb = k.G(0.4), wet = k.G(0);
    k.chain(input, k.F('highpass', 120, -3), sum, dl, filt, sat, k.F('highpass', 90, -3), fb, sum);
    k.chain(sat, wet);
    const lfo = k.lfo(0.3, 'triangle'), dep = k.G(0);
    k.chain(lfo, dep, filt.detune);
    return { input, output: wet, set(v, x) {
      x.to(dl.delayTime, Math.min(2.4, x.note(v.time)), 0.08);
      x.to(fb.gain, v.fb <= 8 ? v.fb * 0.08 : 0.64 + (v.fb - 8) * 0.12); // unity round the loop (the filter's peak) near 9.2
      x.to(filt.frequency, 250 * Math.pow(2, v.freq * 0.45));
      x.to(dep.gain, v.sweep * 240); // cents: up to two octaves either way
      x.to(lfo.frequency, 0.05 * Math.pow(2, v.rate * 0.65));
      x.to(wet.gain, v.mix * 0.16);
    } };
  },
});

// Low-Batt Limpet: a warm bucket-brigade delay running on a dying 9-volt. BATTERY runs it down: the clock sags and
// wanders (the repeats go seasick), the chip starves (crackly, gated, lopsided clipping), the repeats sputter and go
// dark. MOTOR to STOP spins the repeats down like a tape machine switched off; RUN spins them back up.
pedalDef({
  id: 'lowbatt', name: 'Low-Batt Limpet', kind: 'DYING DELAY', cat: 'time', where: 'post', trails: true,
  color: '#3b3f45', ink: '#9dff5a', look: { shape: 'wide', finish: 'brushed', knob: 'black', label: 'block', led: '#9dff5a', foot2: 'stop' },
  nod: 'the classic analogue echo with modulation, fed from a battery on its last legs', blurb: 'Sagging, sputtering, seasick echoes; stop the motor',
  knobs: [['time', 'TIME', 60, 700, 380, 1, tmMs], ['fb', 'REPEATS', 0, 10, 4], ['batt', 'BATTERY', 0, 10, 5, 0, (v) => Math.round(100 - v * 9.5) + '%'], ['mix', 'MIX', 0, 10, 5],
    { key: 'stop', label: 'MOTOR', opts: ['RUN', 'STOP'], def: 0 }],
  build(c, k) {
    const input = k.G(1), starve = c.createWaveShaper(), sum = k.G(1), dl = k.delay(2, 0.38), lp = k.F('lowpass', 2500, -3), hp = k.F('highpass', 180, -3);
    const fb = k.G(0.3), sp = k.G(1), stopG = k.G(1), wet = k.G(0);
    starve.oversample = '2x';
    k.chain(input, starve, sum, dl, lp, hp, sp, stopG, wet); k.chain(hp, fb, sum);
    // the clock wandering: two slow waves at unrelated rates and a flutter
    const wob = k.G(0), fl = k.G(0);
    k.chain(k.lfo(0.13), wob); k.chain(k.lfo(0.71, 'triangle'), wob); k.chain(k.lfo(5.3), fl);
    wob.connect(dl.delayTime); fl.connect(dl.delayTime);
    // sputter: a pulse wave whose depth comes and goes with a slow one (a product of two LFOs into the gain)
    const pulse = k.G(0), slowD = k.G(0);
    k.chain(k.lfo(6.7, [1, 0, 0.33, 0, 0.2]), pulse, sp.gain);
    k.chain(k.lfo(0.23), slowD, pulse.gain);
    let batt = -1, stopped = null;
    const starveCurve = (s) => {
      const N = 2048, cv = new Float32Array(N), dz = 0.03 * s, top = 1 - 0.6 * s;
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1, a = Math.max(0, Math.abs(x) - dz) / (1 - dz), y = Math.sign(x) * a;
        cv[i] = y > 0 ? top * Math.tanh(y / top) : Math.tanh(y);
      }
      return cv;
    };
    return { input, output: wet, set(v, x) {
      const s = v.batt / 10, t = v.time / 1000;
      if (v.batt !== batt) { batt = v.batt; starve.curve = starveCurve(s); }
      x.to(lp.frequency, 3400 * Math.pow(2, -s * 1.4)); // 3.4 kHz fresh to 1.3 kHz dying
      x.to(wob.gain, 0.0005 + s * 0.006 * Math.min(1, t / 0.3)); x.to(fl.gain, s * 0.0004);
      x.to(sp.gain, 1 - 0.3 * s); x.to(slowD.gain, 0.35 * s);
      x.to(fb.gain, v.fb * 0.08);
      x.to(wet.gain, v.mix * 0.17);
      const p = dl.delayTime;
      if (v.stop && stopped !== true) {
        stopped = true;
        if (x.first) stopG.gain.setValueAtTime(0, x.t);
        else {
          // the tape slowing to a stop: the delay grows as t²/2T, so the pitch falls from 1 to 0 over T, and fades
          const T = 1.1, n = 32, cv = new Float32Array(n), d0 = p.value;
          for (let i = 0; i < n; i++) { const u = (i / (n - 1)) * T; cv[i] = Math.min(1.95, d0 + (u * u) / (2 * T)); }
          p.cancelScheduledValues(x.t); p.setValueAtTime(d0, x.t); p.setValueCurveAtTime(cv, x.t + 0.003, T);
          stopG.gain.cancelScheduledValues(x.t); stopG.gain.setValueAtTime(stopG.gain.value, x.t); stopG.gain.setTargetAtTime(0, x.t, T / 3);
        }
      } else if (!v.stop && stopped !== false) {
        const wasStopped = stopped; stopped = false;
        if (wasStopped) { p.cancelScheduledValues(x.t); p.setValueAtTime(p.value, x.t); p.setTargetAtTime(t, x.t + 0.01, 0.25); stopG.gain.cancelScheduledValues(x.t); stopG.gain.setTargetAtTime(1, x.t, 0.2); }
        else x.to(p, t, 0.1);
      } else if (!v.stop) x.to(p, t, 0.1);
    } };
  },
});

// Frostbite Crab: a reverb with a freeze. HOLD grabs what's ringing and holds it for ever as a pad you play over (it
// keeps going when the pedal is stomped off, too: only letting go of HOLD fades it).
pedalDef({
  id: 'frostbite', name: 'Frostbite Crab', kind: 'FREEZE REVERB', cat: 'ambient', where: 'post', trails: true, stereo: true, drone: true,
  color: '#e9f7ff', ink: '#1b4a73', look: { shape: 'wide', finish: 'brushed', knob: 'chrome', label: 'stencil', led: '#35d4ff', foot2: 'hold' },
  nod: 'the infinite-sustain freeze pedals that hold a chord for ever', blurb: 'Freeze a chord into an endless pad, then solo over it',
  worklets: { 'frostbite-freeze': TM_FREEZE },
  knobs: [['decay', 'DECAY', 0, 10, 5], ['tone', 'TONE', 0, 10, 5], ['mix', 'MIX', 0, 10, 3], ['pad', 'FREEZE', 0, 10, 6],
    { key: 'hold', label: 'HOLD', opts: ['OFF', 'HOLD'], def: 0 }],
  build(c, k) {
    const input = k.G(1), conv = k.convolver(), tone = k.F('lowpass', 5000, -3), verb = k.G(0), pad = k.G(0), wet = k.G(1);
    k.chain(input, k.F('highpass', 150, -3), conv, tone, verb, wet);
    const fz = k.worklet('frostbite-freeze', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit' });
    if (fz) { k.chain(tone, fz); k.chain(input, k.G(0.5), fz); k.chain(fz, pad, wet); }
    let d = 5;
    const ir = tmIR(k, conv, () => k.ir({ secs: 1 + d * 0.7, pre: 0.015, seed: 111 + Math.round(d * 10), tail: 1.15, damp: 0.2, darken: 0.6 }));
    return { input, output: wet, node: fz, set(v, x) {
      d = v.decay; ir(d);
      if (fz) x.to(fz.parameters.get('hold'), v.hold, 0.001);
      x.to(tone.frequency, 1800 * Math.pow(2, v.tone * 0.25));
      x.to(verb.gain, v.mix * 0.2); x.to(pad.gain, v.pad * 0.12);
    } };
  },
});
}
