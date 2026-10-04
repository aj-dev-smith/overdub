// vendored verbatim from clawd-o-matic/web/pedals/20-fuzz.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: fuzz. docs/PEDALS.md says how a pack works; 00-classic.js has the Big Crab (the scooped wall).
   The classic circuits (the round germanium and silicon faces, the three-transistor British fuzz, the starved sixties
   brass buzz, the octave-up rectifier, the super fuzz, the starved "velcro" fuzz, the unstable factory, the doom
   sludge) and three only a browser could do: a square-wave synth that tracks your pitch, a bitcrushed fuzz, and a fuzz
   that pulses in time with the band. Levels measured with tools/pedal-check.js (the trims). */
{
// A dead zone, then linear out to the rails: a transistor that's starved or biased off lets nothing through until the
// signal clears a threshold, so a note sputters and breaks up as it decays (w: the zone, in the curve's [-1, 1]).
const fzDead = (w) => (u) => Math.sign(u) * Math.max(0, Math.abs(u) - w) / (1 - w);
// the kit's shaper as a function: tanh at drive d with an asymmetry b, normalised to ±1 and centred
const fzTanh = (d, b = 0) => { const t0 = Math.tanh(d * b), nm = Math.max(Math.tanh(d * (1 + b)) - t0, t0 - Math.tanh(d * (b - 1))); return (u) => (Math.tanh(d * (u + b)) - t0) / nm; };
// A shaper with a movable bias: a DC offset added to its input pushes it off-centre (hot germanium, a starved battery,
// a gate trim). The same offset's output is taken off again after it, so a knob move or the pedal starting up puts no
// step through the coupling filters (no thump): only the signal feels the bias. bias(x, v) sets it (glides).
function fzBiased(k, fn, over = '2x') {
  const input = k.G(1), output = k.G(1), dc = k.constant(0), undo = k.constant(0), sh = k.curve(fn, over);
  // (the undo goes through a straight-line shaper with the same oversampling: the same latency, so they cancel)
  dc.connect(input); k.chain(input, sh, output); k.chain(undo, k.curve((u) => u, over), output);
  return { input, output, bias(x, v) { x.to(dc.offset, v); x.to(undo.offset, -fn(Math.max(-1, Math.min(1, v)))); } };
}

/* ---- Urchin Face: the round germanium two-transistor fuzz. Its gain follows how hard you hit it (the circuit's low
   input impedance loads the pickup: roll the guitar's volume back and it cleans up), and a hard hit shoves the bias
   off-centre for a moment (the splatty "blocking" of old germanium). TEMP is the transistors' temperature: cold is
   tight and bright; hot leaks, sags, sputters and goes dark. */
pedalDef({
  id: 'urchinface', name: 'Urchin Face', kind: 'GERMANIUM FUZZ', cat: 'fuzz', where: 'pre', color: '#5b2a86', ink: '#f6ecff', trim: -11.5,
  nod: 'the round sixties germanium fuzz',
  blurb: 'Warm, round fuzz that cleans up when you pick softly',
  look: { shape: 'round', finish: 'sparkle', knob: 'chrome', label: 'script', led: '#ff9a3c' },
  worklets: { 'pfx-env': PFX.ENV },
  knobs: [['fuzz', 'FUZZ', 0, 10, 7], ['temp', 'TEMP', 0, 10, 5, 0, (v) => Math.round(4 + v * 4.2) + '°C'], ['level', 'VOLUME', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), ge = fzBiased(k, fzTanh(2.4, 0.18)), sag = k.G(0), sens = k.G(0), tone = k.F('lowpass', 4000, 0), level = k.G(1);
    const env = k.envelope({ attack: 0.003, release: 0.14 });
    k.chain(input, k.F('highpass', 70, 0), k.F('lowpass', 5200, 0), pre, ge.input); k.chain(ge.output, k.F('highpass', 28, 0), tone, level);
    if (env) { input.connect(env); env.connect(sens); sens.connect(pre.gain); env.connect(sag); sag.connect(ge.input); }
    return { input, output: level, set(v, x) {
      const t = v.temp / 10, base = k.dB(6 + v.fuzz * 2.6 - t * 4); // cold transistors have more gain
      // softly picked, a fifth of the gain; a hard hit (env about 0.3), all of it
      if (env) { x.to(pre.gain, base * 0.2); x.to(sens.gain, base * 2.7); } else x.to(pre.gain, base);
      ge.bias(x, t * 0.3); x.to(sag.gain, 0.4 + t * 2.2);
      x.to(tone.frequency, 6500 * Math.pow(0.45, t)); // 6.5 kHz cold to 2.9 kHz hot
      x.to(level.gain, k.dB((v.level - 5) * 2.4));
    } };
  },
});

/* ---- Puffer Face: the same circuit on silicon. More gain, a harder knee, brighter, and it cleans up less. VOICE: the
   late-sixties transistors (darker) or the seventies ones (bright and raspy). */
pedalDef({
  id: 'pufferface', name: 'Puffer Face', kind: 'SILICON FUZZ', cat: 'fuzz', where: 'pre', color: '#2f78d0', ink: '#fff6d6', trim: -25,
  nod: 'the round fuzz rebuilt on silicon transistors in the late sixties',
  blurb: 'Brighter, spikier, more gain: the face that screams',
  look: { shape: 'round', finish: 'flat', knob: 'black', label: 'block', led: '#9fe8ff' },
  worklets: { 'pfx-env': PFX.ENV },
  knobs: [['fuzz', 'FUZZ', 0, 10, 7], ['level', 'VOLUME', 0, 10, 5], { key: 'voice', label: 'VOICE', opts: ['60s', '70s'], def: 1 }],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), sens = k.G(0), tone = k.F('lowpass', 7000, 0), pres = k.F('peaking', 2800, 0.9, 0), level = k.G(1);
    const env = k.envelope({ attack: 0.002, release: 0.1 });
    k.chain(input, k.F('highpass', 110, 0), pre, k.shaper(4.5, 0.06), k.F('highpass', 30, 0), pres, tone, level);
    if (env) { input.connect(env); env.connect(sens); sens.connect(pre.gain); }
    return { input, output: level, set(v, x) {
      const base = k.dB(14 + v.fuzz * 2.8);
      if (env) { x.to(pre.gain, base * 0.45); x.to(sens.gain, base * 1.8); } else x.to(pre.gain, base);
      x.to(tone.frequency, v.voice ? 8000 : 5200); x.to(pres.gain, v.voice ? 4 : 0);
      x.to(level.gain, k.dB((v.level - 5) * 2.4));
    } };
  },
});

/* ---- Shell Bender: the three-transistor British fuzz of the mid sixties: a lot more gain than the faces, two stages
   clipping differently, and a forward, grinding midrange. TONE rolls the top off. */
pedalDef({
  id: 'shellbender', name: 'Shell Bender', kind: 'BRITISH FUZZ', cat: 'fuzz', where: 'pre', color: '#8a8f97', ink: '#141619', trim: -21,
  nod: 'the three-transistor British fuzz of the mid sixties',
  blurb: 'Gritty, singing, mid-forward sustain for lead lines',
  look: { shape: 'box', finish: 'hammer', knob: 'chicken', label: 'plate', led: '#ffd23c' },
  knobs: [['attack', 'ATTACK', 0, 10, 7], ['tone', 'TONE', 0, 10, 6], ['level', 'LEVEL', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), tone = k.F('lowpass', 5000, 0), level = k.G(1);
    k.chain(input, k.F('highpass', 120, 0), pre, k.shaper(3, 0.25), k.G(k.dB(14)), k.shaper(2.5, -0.1), k.F('highpass', 45, 0),
      k.F('peaking', 950, 0.8, 4), tone, level);
    return { input, output: level, set(v, x) {
      x.to(pre.gain, k.dB(6 + v.attack * 3.2));
      x.to(tone.frequency, 1200 * Math.pow(2, v.tone * 0.25)); // 1.2 to 6.8 kHz
      x.to(level.gain, k.dB((v.level - 5) * 2.4));
    } };
  },
});

/* ---- Satisfishin': the first fuzz you could buy, run on a tiny battery. The transistors are starved, so the clipping
   is lopsided and the notes buzz like a brass section and then sputter out as they die. Very little bass. */
pedalDef({
  id: 'satisfishin', name: 'Satisfishin’', kind: 'VINTAGE BUZZ', cat: 'fuzz', where: 'pre', color: '#c79a3c', ink: '#2a1a06', trim: -21.5,
  nod: 'the brassy fuzz-tone of 1965’s biggest riff',
  blurb: 'Thin, brassy buzz that sputters out as notes die',
  look: { shape: 'box', finish: 'brushed', knob: 'cream', label: 'plate', led: '#ff4a2e' },
  knobs: [['attack', 'ATTACK', 0, 10, 7], ['level', 'VOLUME', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), level = k.G(1), dz = fzDead(0.05);
    // starved and lopsided: nothing inside the dead zone, the positive side slams into a low ceiling, the negative more
    const buzz = k.curve((u) => { const d = dz(u) * 10; return d > 0 ? Math.min(1, d) : Math.max(-0.55, d * 0.7); }, '4x');
    k.chain(input, k.F('highpass', 280, 0), pre, buzz, k.F('highpass', 70, 0), k.F('peaking', 1250, 1.3, 6), k.F('lowpass', 4200, 0), level);
    return { input, output: level, set(v, x) {
      x.to(pre.gain, k.dB(8 + v.attack * 2.2));
      x.to(level.gain, k.dB((v.level - 5) * 2.4));
    } };
  },
});

/* ---- Octopia: the octave-up fuzz. A phase splitter and two diodes rectify the guitar (full wave: every other half
   cycle flipped over, so the pitch doubles), then a fuzz stage. Loudest and ringiest on single notes up the neck;
   chords turn into a ring-modulated snarl. OCTAVE blends the rectified signal against the plain one. */
pedalDef({
  id: 'octopia', name: 'Octopia', kind: 'OCTAVE-UP FUZZ', cat: 'fuzz', where: 'pre', color: '#ff6a3d', ink: '#1c0a05', trim: -22,
  nod: 'the octave-doubling fuzz from the late-sixties psychedelic stage',
  blurb: 'A ringing octave above every note, then fuzz',
  look: { shape: 'box', finish: 'stripe', knob: 'small', label: 'stencil', led: '#fff15a' },
  knobs: [['boost', 'BOOST', 0, 10, 6], ['oct', 'OCTAVE', 0, 10, 8], ['level', 'LEVEL', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), split = k.G(3), octG = k.G(1), plain = k.G(0), sum = k.G(1), boost = k.G(1), level = k.G(1);
    // germanium diodes: a small knee before they conduct
    const rect = k.curve((u) => Math.max(0, Math.abs(u) - 0.01), '4x');
    k.chain(input, k.F('highpass', 90, 0), k.F('lowpass', 2600, 0), split);
    k.chain(split, rect, octG, sum); k.chain(split, plain, sum);
    k.chain(sum, k.F('highpass', 60, 0), boost, k.shaper(3.2, 0.1), k.F('highpass', 30, 0), k.F('lowpass', 5500, 0), level);
    return { input, output: level, set(v, x) {
      x.to(octG.gain, v.oct / 10 * 1.6); x.to(plain.gain, 1 - v.oct / 10); // (the rectified half is quieter: made up)
      x.to(boost.gain, k.dB(8 + v.boost * 2.8));
      x.to(level.gain, k.dB((v.level - 5) * 2.4));
    } };
  },
});

/* ---- Sub Mariner: the seventies super fuzz with an octave below. A flip-flop (a worklet) toggles on every other
   cycle of the guitar and multiplies it, as the analogue dividers do, for a note an octave down; that and the guitar
   go through two hard stages. TONE is the super fuzz's switch: flat, or a deep mid scoop (on the second footswitch). */
const SUB_DIV = `class SubMarinerDiv extends AudioWorkletProcessor {
  constructor() { super(); this.l1 = 0; this.l2 = 0; this.env = 0; this.hi = false; this.ff = 1; this.sm = 1;
    this.a = 1 - Math.exp(-2 * Math.PI * 500 / sampleRate); this.rel = Math.exp(-1 / (0.05 * sampleRate)); this.e = 1 - Math.exp(-2 * Math.PI * 3000 / sampleRate); }
  process(ins, outs) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); this.env = 0; return true; }
    let { l1, l2, env, hi, ff, sm } = this; const a = this.a, rel = this.rel, e = this.e;
    for (let n = 0; n < o.length; n++) {
      l1 += (i[n] - l1) * a; l2 += (l1 - l2) * a; // (two poles at 500 Hz: find the fundamental)
      const av = l2 < 0 ? -l2 : l2; env = av > env ? av : env * rel;
      const th = env * 0.3;
      if (!hi && l2 > th) { hi = true; ff = -ff; } else if (hi && l2 < -th) hi = false; // (a Schmitt trigger into the flip-flop)
      sm += (ff - sm) * e;
      o[n] = env > 1e-4 ? sm * l2 : 0;
    }
    this.l1 = l1; this.l2 = l2; this.env = env; this.hi = hi; this.ff = ff; this.sm = sm;
    return true;
  }
}
registerProcessor('submariner-div', SubMarinerDiv);`;
pedalDef({
  id: 'submariner', name: 'Sub Mariner', kind: 'OCTAVE-DOWN FUZZ', cat: 'fuzz', where: 'pre', color: '#f2c230', ink: '#10131a', trim: -24,
  nod: 'the hard seventies octave-switch fuzz, plus a sub octave',
  blurb: 'Huge, hard fuzz with a growling octave underneath',
  look: { shape: 'wide', finish: 'flat', knob: 'chrome', label: 'stencil', led: '#39d5ff', foot2: 'tone' },
  worklets: { 'submariner-div': SUB_DIV },
  knobs: [['fuzz', 'FUZZ', 0, 10, 6], ['sub', 'SUB', 0, 10, 6], ['level', 'VOLUME', 0, 10, 5], { key: 'tone', label: 'TONE', opts: ['FLAT', 'SCOOP'], def: 0 }],
  build(c, k) {
    const input = k.G(1), hp = k.F('highpass', 70, 0), sum = k.G(1), subG = k.G(0), pre = k.G(1), scoop = k.F('peaking', 750, 0.7, 0), level = k.G(1);
    const div = k.worklet('submariner-div', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    k.chain(input, hp, sum);
    if (div) k.chain(hp, div, subG, sum);
    k.chain(sum, pre, k.shaper(5, 0.1), k.G(k.dB(10)), k.shaper(3, 0), k.F('highpass', 40, 0), scoop, k.F('lowpass', 6000, 0), level);
    return { input, output: level, set(v, x) {
      x.to(pre.gain, k.dB(10 + v.fuzz * 2.6));
      x.to(subG.gain, v.sub / 10 * 3); // (the divider's output sits well under the guitar: 3x at the top)
      x.to(scoop.gain, v.tone ? -13 : 0);
      x.to(level.gain, k.dB((v.level - 5) * 2.4 + (v.tone ? 3 : 0))); // (a scoop sounds quieter: made up)
    } };
  },
});

/* ---- Starving Hermit: a fuzz on a dying battery. VOLTS starves it: the gate opens higher (a dead zone the signal has
   to clear), the bias slides off-centre, and the headroom drops, so notes spit, sputter and die in a splat. */
pedalDef({
  id: 'hermit', name: 'Starving Hermit', kind: 'GATED FUZZ', cat: 'fuzz', where: 'pre', color: '#8f3f1f', ink: '#ffe6cf', trim: -15.9,
  nod: 'the voltage-starved, sputtering fuzz with a sag knob',
  blurb: 'Starve it and it spits, sputters and dies mid-note',
  look: { shape: 'box', finish: 'flat', knob: 'small', label: 'script', led: '#9aff5a' },
  knobs: [['fuzz', 'FUZZ', 0, 10, 6], ['volts', 'VOLTS', 0, 10, 7, 0, (v) => (1 + v * 0.8).toFixed(1) + ' V'], ['level', 'VOLUME', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), A = k.G(1), st = fzBiased(k, fzDead(0.1)), B = k.G(1), level = k.G(1);
    k.chain(input, k.F('highpass', 90, 0), A, st.input); k.chain(st.output, B, k.shaper(3, 0.3), k.F('highpass', 25, 0), k.F('lowpass', 5000, 0), level);
    return { input, output: level, set(v, x) {
      const s = 1 - v.volts / 10; // how starved: 0 at 9 V, 1 at 1 V
      // the same gain overall, split so the gate's threshold (0.1 / A) climbs from -34 dBFS to -20 as it starves
      x.to(A.gain, k.dB(6 + v.fuzz * 1.4 - s * 14)); x.to(B.gain, k.dB(10 + v.fuzz * 1.4 + s * 14));
      st.bias(x, s * 0.06);
      x.to(level.gain, k.dB((v.level - 5) * 2.4 + s * 3)); // (a starved fuzz has less headroom: that part made up)
    } };
  },
});

/* ---- Claw Factory: the unstable fuzz with every trim pot on the front. DRIVE and COMP set the two stages, GATE biases
   the first off so notes sputter shut, and STAB feeds the output back into the input: at the top it's stable; turn it
   down and it squeals, then oscillates on its own (a pitch that moves with GATE and COMP). */
pedalDef({
  id: 'clawfactory', name: 'Claw Factory', kind: 'UNSTABLE FUZZ', cat: 'fuzz', where: 'pre', color: '#b6f03c', ink: '#14170a', trim: -24.5,
  drone: true, // (STAB low self-oscillates: that's the point of it. At its defaults it's stable.)
  nod: 'the hand-built fuzz with a stability knob that makes it scream',
  blurb: 'Gated spit, squeals and radio-static drones',
  look: { shape: 'wide', finish: 'check', knob: 'chicken', label: 'block', led: '#ff3cbe' },
  knobs: [['level', 'VOL', 0, 10, 5], ['gate', 'GATE', 0, 10, 2], ['comp', 'COMP', 0, 10, 5], ['drive', 'DRIVE', 0, 10, 6], ['stab', 'STAB', 0, 10, 10]],
  build(c, k) {
    const input = k.G(1), drive = k.G(1), comp = k.G(1), level = k.G(1);
    const sh2 = k.shaper(3, 0), bp = k.F('bandpass', 1500, 4), loop = k.delay(0.05, 0.004), fb = k.G(0);
    const dz = fzDead(0.04), sh1 = fzBiased(k, (u) => Math.tanh(5 * dz(u)) / Math.tanh(5)), sum = sh1.input;
    k.chain(input, k.F('highpass', 60, 0), drive, sum); k.chain(sh1.output, comp, sh2, k.F('highpass', 30, 0), k.F('lowpass', 6500, 0), level);
    k.chain(sh2, bp, loop, fb, sum); // (the feedback: at least a render quantum around the loop, so ~2.7 ms or more)
    return { input, output: level, set(v, x) {
      x.to(drive.gain, k.dB(6 + v.drive * 2.6));
      x.to(comp.gain, k.dB(1 + v.comp * 1.6));
      sh1.bias(x, v.gate * 0.05);
      const u = Math.max(0, (7 - v.stab) / 7); // STAB 7 and up: no feedback at all
      x.to(fb.gain, 0.5 * u * u, 0.05);
      x.to(bp.frequency, 500 + (10 - v.stab) * 220, 0.05);
      x.to(loop.delayTime, 0.003 + v.gate * 0.0005 + v.comp * 0.0004, 0.05);
      x.to(level.gain, k.dB((v.level - 5) * 2.4));
    } };
  },
});

/* ---- Kraken Sludge: doom fuzz. Two stages with a fat shelf between, a scooped middle, and LOWS: a shelf after the
   clipping, so the low end is huge without the fuzz farting out. TONE is a sweepable low-pass, from mud to fizz. */
pedalDef({
  id: 'kraken', name: 'Kraken Sludge', kind: 'DOOM FUZZ', cat: 'fuzz', where: 'pre', color: '#2f4a2a', ink: '#c9f27a', trim: -14,
  nod: 'the stoner-doom fuzz with a room-shaking bass knob',
  blurb: 'Down-tuned doom: a wall of fuzz with a bottomless low end',
  look: { shape: 'box', finish: 'hammer', knob: 'black', label: 'stencil', led: '#8cff3c' },
  knobs: [['fuzz', 'FUZZ', 0, 10, 7], ['lows', 'LOWS', 0, 10, 5], ['tone', 'TONE', 0, 10, 6], ['level', 'VOLUME', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), lows = k.F('lowshelf', 110, null, 0), tone = k.F('lowpass', 1500, 2), level = k.G(1);
    k.chain(input, k.F('highpass', 45, 0), pre, k.shaper(4, 0.12), k.F('lowshelf', 180, null, 6), k.G(k.dB(8)), k.shaper(3, 0.05),
      k.F('highpass', 32, 0), lows, k.F('peaking', 650, 0.8, -3), tone, level);
    return { input, output: level, set(v, x) {
      x.to(pre.gain, k.dB(12 + v.fuzz * 2.6));
      x.to(lows.gain, v.lows * 1.2); // 0 to +12 dB
      x.to(tone.frequency, 450 * Math.pow(2, v.tone * 0.38)); // 450 Hz to 6 kHz
      x.to(level.gain, k.dB((v.level - 5) * 2 - v.lows * 0.6));
    } };
  },
});

/* ---- Square Squid (weird): a square-wave synth that follows your playing. A worklet finds each cycle of the guitar
   (a Schmitt trigger on a low-passed copy, timing the rising edges), glides a band-limited pulse oscillator to that
   pitch (an octave up or down if you like), and gives it your picking's envelope. Single notes sing like a monosynth;
   chords make it hunt and warble. MIX blends it against a plain fuzz of the guitar. */
const SQUID_OSC = `class SquareSquidOsc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'glide', defaultValue: 0.03, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'oct', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
    { name: 'duty', defaultValue: 0.5, minValue: 0.05, maxValue: 0.5, automationRate: 'k-rate' }]; }
  constructor() { super(); this.l1 = 0; this.l2 = 0; this.env = 0; this.hi = false; this.since = 0; this.per = 0; this.tgt = 0; this.ph = 0; this.amp = 0;
    this.a = 1 - Math.exp(-2 * Math.PI * 900 / sampleRate); this.rel = Math.exp(-1 / (0.08 * sampleRate)); this.ag = 1 - Math.exp(-1 / (0.006 * sampleRate));
    this.lo = sampleRate / 1400; this.hiP = sampleRate / 38; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const gl = p.glide[0], g = gl < 0.001 ? 1 : 1 - Math.exp(-1 / (gl * sampleRate)), oc = p.oct[0], mul = oc > 0.5 ? 2 : oc < -0.5 ? 0.5 : 1, duty = p.duty[0];
    let { l1, l2, env, hi, since, per, tgt, ph, amp } = this; const a = this.a, rel = this.rel, ag = this.ag, lo = this.lo, hiP = this.hiP;
    const blep = (t, dt) => { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; };
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      l1 += (x - l1) * a; l2 += (l1 - l2) * a;
      const av = l2 < 0 ? -l2 : l2; env = av > env ? av : env * rel;
      since++;
      const th = env * 0.35 + 1e-5;
      if (!hi && l2 > th) { hi = true; if (since >= lo && since <= hiP) { tgt = since; if (per === 0) per = since; } since = 0; }
      else if (hi && l2 < -th) hi = false;
      if (since > 4 * hiP) since = 4 * hiP; // (no overflow in a long silence)
      if (per > 0) per += (tgt - per) * g;
      const want = env > 0.003 ? Math.min(1, Math.sqrt(env) * 1.3) : 0;
      amp += (want - amp) * ag;
      if (per > 0 && amp > 1e-5) {
        const dt = mul / per; ph += dt; if (ph >= 1) ph -= 1;
        let s = ph < duty ? 1 : -1;
        s += blep(ph, dt); let t2 = ph - duty; if (t2 < 0) t2 += 1; s -= blep(t2, dt);
        o[n] = s * amp * 0.5;
      } else o[n] = 0;
    }
    if (amp < 1e-5) amp = 0;
    this.l1 = l1; this.l2 = l2; this.env = env; this.hi = hi; this.since = since; this.per = per; this.tgt = tgt; this.ph = ph; this.amp = amp;
    return true;
  }
}
registerProcessor('squaresquid-osc', SquareSquidOsc);`;
pedalDef({
  id: 'squaresquid', name: 'Square Squid', kind: 'SYNTH FUZZ', cat: 'fuzz', where: 'pre', color: '#141a2b', ink: '#36f5d5', trim: -7,
  nod: 'the guitar synths that turned strings into square waves',
  blurb: 'Your notes as a gliding square-wave synth',
  look: { shape: 'rack', finish: 'brushed', knob: 'small', label: 'block', led: '#36f5d5' },
  worklets: { 'squaresquid-osc': SQUID_OSC },
  knobs: [['tone', 'TONE', 0, 10, 6], ['pulse', 'PULSE', 0, 10, 10, 0, (v) => Math.round(10 + v * 4) + '%'], ['glide', 'GLIDE', 0, 10, 2],
    ['mix', 'MIX', 0, 10, 8], { key: 'oct', label: 'OCTAVE', opts: ['DOWN', 'UNI', 'UP'], def: 1 }],
  build(c, k) {
    const input = k.G(1), out = k.G(1), synth = k.G(0), fuzz = k.G(1), filt = k.F('lowpass', 2000, 6);
    const osc = k.worklet('squaresquid-osc', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    if (osc) k.chain(input, osc, k.F('highpass', 30, 0), filt, synth, out);
    k.chain(input, k.F('highpass', 90, 0), k.G(k.dB(26)), k.shaper(4, 0.1), k.F('lowpass', 4000, 0), fuzz, out);
    return { input, output: out, set(v, x) {
      if (osc) {
        const P = osc.parameters;
        x.to(P.get('glide'), v.glide * v.glide * 0.004); // 0 to 0.4 s
        x.to(P.get('duty'), 0.1 + v.pulse * 0.04); P.get('oct').setValueAtTime(v.oct - 1, x.t);
      }
      x.to(filt.frequency, 200 * Math.pow(2, v.tone * 0.55)); // 200 Hz to 9 kHz
      const m = osc ? v.mix / 10 : 0;
      x.to(synth.gain, m * 1.8); x.to(fuzz.gain, 1 - m);
    } };
  },
});

/* ---- 8-Bit Barnacle (weird): fuzz into a bit crusher. BITS drops the resolution (and anything quieter than the
   smallest step vanishes: it gates itself), RATE holds each sample for longer (aliasing: the chiptune hash). */
const BARN_CRUSH = `class Barnacle8Crush extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'drive', defaultValue: 10, minValue: 1, maxValue: 400, automationRate: 'k-rate' },
    { name: 'bits', defaultValue: 4, minValue: 1, maxValue: 12, automationRate: 'k-rate' },
    { name: 'down', defaultValue: 4, minValue: 1, maxValue: 64, automationRate: 'k-rate' }]; }
  constructor() { super(); this.ph = 0; this.held = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const dr = p.drive[0], q = Math.pow(2, p.bits[0] - 1), down = p.down[0];
    let ph = this.ph, held = this.held;
    for (let n = 0; n < o.length; n++) {
      if (++ph >= down) { ph -= down; held = Math.round(Math.tanh(dr * (i ? i[n] : 0)) * q) / q; }
      o[n] = held;
    }
    this.ph = ph; this.held = held;
    return true;
  }
}
registerProcessor('barnacle8-crush', Barnacle8Crush);`;
pedalDef({
  id: 'barnacle8', name: '8-Bit Barnacle', kind: 'BITCRUSH FUZZ', cat: 'fuzz', where: 'pre', color: '#7a5cff', ink: '#eaff5a', trim: -18.5,
  nod: 'the chiptune crushers that shrink sound to a few bits',
  blurb: 'Fuzz crushed to a handful of bits: a video-game guitar',
  look: { shape: 'box', finish: 'flat', knob: 'cream', label: 'plate', led: '#eaff5a' },
  worklets: { 'barnacle8-crush': BARN_CRUSH },
  knobs: [['fuzz', 'FUZZ', 0, 10, 6], ['bits', 'BITS', 1, 12, 4, 1, (v) => Math.round(v) + '-bit'],
    ['rate', 'RATE', 0, 10, 4, 0, (v) => (48 / (1 + v * v * 0.4)).toFixed(1) + 'k'], ['level', 'VOLUME', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), level = k.G(1), smooth = k.F('lowpass', 12000, 0);
    const cr = k.worklet('barnacle8-crush', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const pre = k.G(1), fb = cr ? null : k.shaper(5, 0); // (no worklet: a plain fuzz)
    k.chain(input, k.F('highpass', 80, 0), pre, cr || fb, k.F('highpass', 25, 0), smooth, level);
    return { input, output: level, set(v, x) {
      if (cr) {
        const P = cr.parameters;
        x.to(P.get('drive'), k.dB(8 + v.fuzz * 3)); x.to(P.get('bits'), v.bits); x.to(P.get('down'), 1 + v.rate * v.rate * 0.4);
      } else x.to(pre.gain, k.dB(8 + v.fuzz * 3) / 5);
      x.to(level.gain, k.dB((v.level - 5) * 2.4));
    } };
  },
});

/* ---- Pump Fish (weird): a fuzz whose gain throbs in time with the band. An oscillator at a note value of the
   song's tempo swings the drive from nearly clean to full fuzz: SHAPE is a smooth pulse on the beat, a pump (clean on
   the beat, swelling back: sidechain-style) or a chop. Live, it lines its phase up with the band's bars. */
pedalDef({
  id: 'pumpfish', name: 'Pump Fish', kind: 'FUZZ · IN TIME', cat: 'fuzz', where: 'pre', color: '#ff5fd2', ink: '#2a0624', trim: -17,
  nod: 'the tremolo-into-fuzz trick, locked to the drummer',
  blurb: 'Fuzz that throbs and pumps in time with the band',
  look: { shape: 'box', finish: 'sparkle', knob: 'chrome', label: 'script', led: '#7afcff' },
  knobs: [['fuzz', 'FUZZ', 0, 10, 6], ['depth', 'DEPTH', 0, 10, 7], ['rate', 'RATE', 0, 5, 1, 1, PFX.noteFmt], { key: 'shape', label: 'SHAPE', opts: ['PULSE', 'PUMP', 'CHOP'], def: 0 }],
  build(c, k) {
    const input = k.G(1), pre = k.G(0), depth = k.G(0), rest = k.constant(1), smooth = k.F('lowpass', 28, 0), base = k.G(1), level = k.G(1);
    k.chain(input, k.F('highpass', 80, 0), pre, k.shaper(4.5, 0.1), k.F('highpass', 30, 0), k.F('lowpass', 5500, 0), level);
    // The drive swings in decibels, not linearly (a fuzz is saturated over most of a linear swing, so it would hardly
    // move): u = (1 - depth) + depth × wave, then a curve turns u into gain, 0 dB at u = 1 down to -42 dB at u = -1.
    const exp = k.curve((u) => Math.pow(10, (21 * (u - 1)) / 20), 'none', 1024);
    k.chain(smooth, depth, exp); rest.connect(exp); k.chain(exp, base, pre.gain);
    // the waves, with the beat at phase 0: a cosine (loudest on the beat), a rising ramp (quietest on it), a square
    const H = 16, waves = [0, 1, 2].map((s) => {
      const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
      for (let n = 1; n <= H; n++) {
        if (s === 0) re[1] = 1;
        else if (s === 1) im[n] = -1 / n;
        else if (n % 2) im[n] = 1 / n;
      }
      return c.createPeriodicWave(re, im);
    });
    let osc = null, shape = -1, hz = 4, period = 0.25;
    // a new oscillator starting at `at` (its phase 0 is the beat then), taking over from the old one
    const start = (at) => {
      const o = c.createOscillator(), old = osc;
      o.setPeriodicWave(waves[Math.max(0, shape)]); o.frequency.value = hz; o.connect(smooth);
      o.start(at); o.t0 = at; k.own(o);
      if (old) { try { old.stop(at); } catch (e) { /* stopped */ } }
      osc = o;
    };
    start(c.currentTime);
    // Live, with the band playing: line the pulses up with its bars (checked every second; the band may start, stop,
    // loop or jump). Straight notes divide a bar, so a bar line is a beat; dotted ones don't, so they're left to run.
    let synced = null;
    const sync = () => {
      try {
        const clk = typeof PLUG !== 'undefined' && PLUG._bus && PLUG._bus.c === c ? PLUG.clock : null;
        if (clk && clk.playing()) {
          const bar = clk.bar(), next = clk.barTime(Math.floor(bar) + 1), b0 = clk.barTime(Math.floor(bar)), barLen = next - b0;
          const even = barLen > 0 && Math.abs(barLen / period - Math.round(barLen / period)) < 1e-3;
          const ph = (((c.currentTime - osc.t0) / period) % 1 + 1) % 1, want = (((c.currentTime - b0) / period) % 1 + 1) % 1;
          const off = Math.min(Math.abs(ph - want), 1 - Math.abs(ph - want));
          if (next > c.currentTime + 0.02 && ((even && off > 0.03) || synced === null)) { start(next); synced = next; }
        } else synced = null;
      } catch (e) { /* no clock: free-running */ }
      k.later(sync, 1000);
    };
    if (!(typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext)) k.later(sync, 200);
    return { input, output: level, set(v, x) {
      period = x.note(v.rate); hz = 1 / period;
      if (v.shape !== shape) { shape = v.shape; osc.setPeriodicWave(waves[shape]); }
      if (osc.frequency.value !== hz) { x.to(osc.frequency, hz, 0.02); if (!x.first) synced = null; }
      const d = v.depth / 10;
      x.to(base.gain, k.dB(10 + v.fuzz * 2.6)); x.to(depth.gain, d); x.to(rest.offset, 1 - d);
    } };
  },
});
}
