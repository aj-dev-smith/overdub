// vendored verbatim from clawd-o-matic/web/pedals/30-dynfilter.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: dynamics, filters and utility (compressors, a gate, EQs, wahs, a swell, a talk box, a buffer, and
   a dubstep wobble and a riser locked to the band). docs/PEDALS.md says how a pack works. Levels measured with
   tools/pedal-check.js; everything here sits within ±1.5 LU of bypass at its defaults with the Clean and Punk amps. */
{
// Note values for the tempo-synced filters: [label, quarter notes per cycle]
const DYN_NOTES = [['1/1', 4], ['1/2', 2], ['1/4', 1], ['1/4T', 2 / 3], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125]];
const dynNoteFmt = (v) => DYN_NOTES[Math.max(0, Math.min(DYN_NOTES.length - 1, Math.round(v)))][0];
const dynSm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }; // smoothstep
const dynDbFmt = (v) => (v > 0 ? '+' : '') + (Math.round(v * 2) / 2) + ' dB';
const dynHzFmt = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v) + ' Hz');

// The band's beat now (fractional quarter notes from bar 0) if it's playing on this pedal's context, else null. The
// tempo-synced filters lock their phase to it, so a wobble lands on the beat and a riser peaks on the bar line.
function dynBeat(c) {
  try { return typeof PLUG !== 'undefined' && typeof ctx !== 'undefined' && ctx === c && PLUG.clock.playing() ? PLUG.clock.bar() * 4 : null; }
  catch (e) { return null; }
}

// A looping control wave: one cycle of shape fn(phase) -> value, as a buffer played at hz, whose phase we can place
// (a plain oscillator can't be re-phased or shaped freely). shapes: [fn...]; out: a GainNode carrying the wave.
// Tracks its own phase so a shape or rate change carries on from where it is, and sync() locks it to the band.
function dynCycle(k, shapes, N = 2048) {
  const c = k.c, sr = c.sampleRate, out = k.G(1);
  const bufs = shapes.map((fn) => { const b = c.createBuffer(1, N, sr), d = b.getChannelData(0); for (let i = 0; i < N; i++) d[i] = fn(i / N); return b; });
  let src = null, shape = 0, hz = 1, t0 = 0, ph0 = 0;
  const phase = () => { const p = ph0 + (c.currentTime - t0) * hz; return p - Math.floor(p); };
  const start = (ph) => {
    if (src) { try { src.stop(); src.disconnect(); } catch (e) { /* gone */ } }
    src = c.createBufferSource(); src.buffer = bufs[shape]; src.loop = true;
    src.playbackRate.value = (hz * N) / sr;
    src.connect(out);
    t0 = c.currentTime; ph0 = ph;
    src.start(t0, (ph * N) / sr);
    k.own(src);
  };
  k.onDispose(() => { if (src) { try { src.stop(); } catch (e) { /* gone */ } } });
  return { out, phase,
    // shape index, cycles a second: restart only if the shape changed (keeping the phase); a rate change just rebases
    set(s, h) {
      const p = src ? phase() : 0;
      if (h !== hz) { t0 = c.currentTime; ph0 = p; hz = h; if (src) src.playbackRate.setValueAtTime((hz * N) / sr, c.currentTime); }
      if (!src || s !== shape) { shape = s; start(p); }
    },
    restart(ph = 0) { start(ph); },
    // lock to the band: want is where the phase should be now; re-phase if it's off by more than 2% of a cycle
    sync(want) { const d = want - phase(), e = d - Math.round(d); if (Math.abs(e) > 0.02) { start(want - Math.floor(want)); return true; } return false; },
  };
}

// The wah's filter, shared by the treadle wah and the cocked one. An inductor wah is a resonant low-pass (a peak
// 10-15 dB up, rolling off above it) whose peak sweeps about 350 Hz to 2.2 kHz, while the low end thins out as you rock
// toward the toe: so here a resonant low-pass after a high-pass that follows it at a third of its frequency. The
// inductor's Q is highest at the heel. pos 0..1 heel to toe, along the pot's taper.
const DYN_WAH_VOICES = [[350, 2200, 15, 0.25, 0.45], [430, 2700, 12, 0.3, 0.5], [220, 1700, 16, 0.2, 0.4]]; // VINT, MOD, LOW: lo, hi, peak dB, high-pass ratio, leak
function dynWahCore(k) {
  const input = k.G(1), hp = k.F('highpass', 120, -4), lp = k.F('lowpass', 700, 14), leak = k.G(0.2), output = k.G(1), even = k.G(1);
  k.chain(input, hp, lp, even, output);
  k.chain(hp, leak, even); // (the circuit's direct path: above the peak the response levels off rather than vanishing)
  return { input, output, set(x, pos, peak, voice) {
    const [lo, hi, res, hr, lk] = DYN_WAH_VOICES[voice] || DYN_WAH_VOICES[0];
    x.to(leak.gain, lk);
    // the reverse-log pot: most of the travel spent low, a quick last lunge to the top
    const f = lo * Math.pow(hi / lo, Math.pow(pos, 1.35));
    x.to(lp.frequency, f); x.to(hp.frequency, f * hr);
    x.to(lp.Q, res * (0.5 + peak / 10) * (1.1 - 0.2 * pos));
    x.to(even.gain, k.dB(-8 * pos ** 4)); // (the toe's last lunge lets everything through: even it out, heel to toe)
  } };
}

/* ======== dynamics */

// Squish Squid: the orange-box OTA compressor. A fast, hard knee that squashes the pick and pulls the note back up as it
// fades (the country chicken-picking sustain), a touch of OTA grit, and the slightly dull top those have.
pedalDef({
  id: 'squish', name: 'Squish Squid', kind: 'COMPRESSOR', cat: 'dynamics', where: 'pre', color: '#e8502e', ink: '#fff4e8', trim: 0, latency: 0.006, // (the compressor's look-ahead)
  nod: 'the little orange OTA compressor of every Nashville board', blurb: 'Squashes the pick, sustains the note: chicken pickin’',
  look: { shape: 'box', finish: 'flat', knob: 'black', label: 'block', led: '#ffd23f' },
  knobs: [['sustain', 'SUSTAIN', 0, 10, 6], ['attack', 'ATTACK', 0, 10, 3], ['tone', 'TONE', 0, 10, 5], ['level', 'LEVEL', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), comp = c.createDynamicsCompressor(), grit = k.shaper(1.6, 0.08), tone = k.F('lowpass', 6000, 0), level = k.G(1), pre = k.G(1);
    comp.knee.value = 3; comp.ratio.value = 12; comp.release.value = 0.22;
    k.chain(input, pre, comp, k.G(0.8), grit, tone, level);
    return { input, output: level, set(v, x) {
      x.to(comp.threshold, -12 - v.sustain * 3.4); // -12 to -46 dB
      x.to(comp.attack, 0.0008 * Math.pow(2, v.attack * 0.55)); // 0.8 ms (the pick flattened) to 36 ms (it clicks through)
      x.to(tone.frequency, 2500 * Math.pow(2, v.tone * 0.25)); // 2.5 to 14 kHz
      x.to(level.gain, k.dB((v.level - 5) * 2 - 2.3 - v.sustain * 0.7));
    } };
  },
});

// Pearl Press: the studio optical leveller. A soft knee, a slow program-dependent release, and a BLEND for parallel
// compression (the dry path delayed to line up with the compressor's look-ahead, so the blend doesn't comb).
pedalDef({
  id: 'pearl', name: 'Pearl Press', kind: 'OPTO COMP', cat: 'dynamics', where: 'post', color: '#d9dce1', ink: '#1a1d24', trim: 0, latency: 0.006,
  nod: 'the grey studio tube leveller with the glowing light cell', blurb: 'Smooth, transparent squeeze; blend in the dry for punch',
  look: { shape: 'rack', finish: 'brushed', knob: 'chrome', label: 'plate', led: '#ffb347' },
  knobs: [['peak', 'PEAK RED', 0, 10, 5], ['gain', 'GAIN', -12, 12, 0, 0.5, dynDbFmt], ['blend', 'BLEND', 0, 10, 6], { key: 'mode', label: 'MODE', opts: ['COMP', 'LIMIT'], def: 0 }],
  build(c, k) {
    const input = k.G(1), output = k.G(1), comp = c.createDynamicsCompressor(), wet = k.G(1), dry = k.G(0), dd = k.delay(0.05, 0.006);
    comp.knee.value = 24; comp.attack.value = 0.01;
    k.chain(input, comp, wet, output);
    k.chain(input, dd, dry, output);
    return { input, output, set(v, x) {
      x.to(comp.threshold, -6 - v.peak * 3.6);
      x.to(comp.ratio, v.mode ? 20 : 3.5);
      x.to(comp.knee, v.mode ? 8 : 24);
      x.to(comp.release, v.mode ? 0.35 : 0.6 + v.peak * 0.08); // (deeper squeeze, slower light cell)
      const b = v.blend / 10, g = k.dB(v.gain);
      x.to(wet.gain, g * b * k.dB(-v.peak * 0.45)); x.to(dry.gain, g * (1 - b));
    } };
  },
});

// Clam Shut: a noise suppressor with a smart decay. Its key is high-passed (low chugs don't hold it open), and its
// release follows how hard you hit: a big chord rings out and fades naturally, a palm-muted chug slams shut. CHUG mode
// is the metal one: near-instant open and close, surgical stops between sixteenths.
const DYN_GATE = `class ClamShutGate extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'threshold', defaultValue: -58, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
    { name: 'decay', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
    { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor() { super(); this.e = 0; this.g = 0; this.hold = 0; this.pk = 0; this.x1 = 0; this.y1 = 0; this.isOpen = false; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const sr = sampleRate, chug = p.mode[0] >= 0.5, th = p.threshold[0], off = th <= -99, open = Math.pow(10, th / 20), shut = open * (chug ? 0.6 : 0.5);
    const envRel = Math.exp(-1 / ((chug ? 0.004 : 0.02) * sr)), up = 1 - Math.exp(-1 / ((chug ? 0.0003 : 0.0008) * sr));
    const holdN = (chug ? 0.004 : 0.025) * sr, hpA = Math.exp(-2 * Math.PI * 180 / sr), dec = p.decay[0];
    // the release: CHUG 3 to 33 ms; smart: 20 to 370 ms, times up to 3 by how far over the threshold the note was
    const baseRel = chug ? 0.003 + dec * 0.003 : 0.02 + dec * 0.035;
    const rel = chug ? baseRel : baseRel * (1 + Math.min(2, Math.log2(Math.max(1, this.pk / open)) / 4));
    const down = 1 - Math.exp(-1 / (rel * sr * 0.25));
    for (let n = 0; n < o.length; n++) {
      const x = i[n], hp = hpA * (this.y1 + x - this.x1); this.x1 = x; this.y1 = hp;
      const a = Math.abs(hp) + Math.abs(x) * 0.25;
      this.e = a > this.e ? a : this.e * envRel;
      if (off || this.e > open) { if (!this.isOpen) this.pk = 0; this.isOpen = true; this.hold = holdN; if (this.e > this.pk) this.pk = this.e; }
      else if (this.e < shut) { if (this.hold > 0) this.hold--; else this.isOpen = false; }
      const want = off || this.isOpen ? 1 : 0;
      this.g += (want - this.g) * (want > this.g ? up : down);
      o[n] = x * this.g;
    }
    if (this.y1 < 1e-20 && this.y1 > -1e-20) this.y1 = 0;
    return true;
  }
}
registerProcessor('clamshut-gate', ClamShutGate);`;
pedalDef({
  id: 'clamshut', name: 'Clam Shut', kind: 'NOISE SUPPRESSOR', cat: 'dynamics', where: 'pre', color: '#1c1e22', ink: '#ff4040', trim: 0,
  nod: 'the smart-decay suppressor and the razor gates of metal rigs', blurb: 'Kills hiss, keeps your tails; CHUG slams shut on mutes',
  look: { shape: 'box', finish: 'hammer', knob: 'small', label: 'stencil', led: '#ff4040' },
  worklets: { 'clamshut-gate': DYN_GATE },
  knobs: [['th', 'THRESH', -100, -30, -58, 1, (v) => (v <= -99 ? 'open' : Math.round(v) + ' dB')], ['decay', 'DECAY', 0, 10, 5], { key: 'mode', label: 'MODE', opts: ['SMART', 'CHUG'], def: 0 }],
  build(c, k) {
    const node = k.worklet('clamshut-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const io = node || k.G(1);
    return { input: io, output: io, node, set(v, x) {
      if (!node) return;
      x.to(node.parameters.get('threshold'), v.th); x.to(node.parameters.get('decay'), v.decay); x.to(node.parameters.get('mode'), v.mode);
    } };
  },
});

// Jelly Swell: a volume pedal (the treadle) with a swell: pick a note and it fades in by itself, no pedal work, the
// bowed-violin swell for ambient pads. It hears each new pick (a fast envelope jumping over a slow one), ducks in a few
// ms and rises along an S-curve. SWELL at 0 is a plain volume pedal.
const DYN_SWELL = `class JellySwell extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'attack', defaultValue: 0.3, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    { name: 'sens', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'k-rate' }]; }
  constructor() { super(); this.f = 0; this.s = 0; this.r = 1; this.g = 1; this.since = 1e9; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const sr = sampleRate, att = p.attack[0], on = att > 0.005, step = on ? 1 / (att * sr) : 1;
    const floor = Math.pow(10, (-66 + p.sens[0] * 3) / 20), jump = 2.2 - p.sens[0] * 0.08, gap = 0.07 * sr;
    const fa = 1 - Math.exp(-1 / (0.001 * sr)), fr = 1 - Math.exp(-1 / (0.012 * sr)), sa = 1 - Math.exp(-1 / (0.06 * sr)), sr2 = 1 - Math.exp(-1 / (0.25 * sr));
    const duck = 1 - Math.exp(-1 / (0.003 * sr));
    for (let n = 0; n < o.length; n++) {
      const a = Math.abs(i[n]);
      this.f += (a - this.f) * (a > this.f ? fa : fr);
      this.s += (a - this.s) * (a > this.s ? sa : sr2);
      this.since++;
      if (on && this.f > floor && this.f > this.s * jump && this.since > gap) { this.r = 0; this.since = 0; }
      if (this.r < 1) this.r = Math.min(1, this.r + step);
      const t = on ? this.r * this.r * (3 - 2 * this.r) : 1;
      this.g = t < this.g ? this.g + (t - this.g) * duck : t;
      o[n] = i[n] * this.g;
    }
    return true;
  }
}
registerProcessor('jellyswell-swell', JellySwell);`;
pedalDef({
  id: 'jellyswell', name: 'Jelly Swell', kind: 'VOLUME · SWELL', cat: 'dynamics', where: 'pre', color: '#6d4dff', ink: '#f4f0ff', trim: 0,
  nod: 'the volume pedal and the auto-swell boxes of ambient players', blurb: 'Rock it for volume; turn up SWELL and notes fade in',
  look: { shape: 'wah', treadle: 'vol', finish: 'sparkle', knob: 'small', label: 'script', led: '#c9b8ff' },
  worklets: { 'jellyswell-swell': DYN_SWELL },
  knobs: [['vol', 'VOLUME', 0, 10, 10], ['swell', 'SWELL', 0, 10, 0, 0, (v) => (v <= 0 ? 'off' : (0.04 * Math.pow(2, v * 0.55)).toFixed(v < 5 ? 2 : 1) + ' s')], ['sens', 'SENS', 0, 10, 5]],
  build(c, k) {
    const node = k.worklet('jellyswell-swell', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const input = node || k.G(1), vol = k.G(1);
    input.connect(vol);
    return { input, output: vol, node, set(v, x) {
      // an audio-taper pot: half way down is about -18 dB, the heel is silence
      const p = v.vol / 10;
      x.to(vol.gain, p <= 0 ? 0 : Math.pow(p, 3));
      if (node) { x.to(node.parameters.get('attack'), v.swell <= 0 ? 0 : 0.04 * Math.pow(2, v.swell * 0.55)); x.to(node.parameters.get('sens'), v.sens); }
    } };
  },
});

/* ======== filter: EQs */

// Coral Ladder: the graphic EQ. Six constant-Q bands an octave-and-a-bit apart, ±15 dB each (the platform has six
// knobs, so six bands rather than the classic seven; the top one sits where the sixth and seventh would share).
const DYN_GEQ = [['b100', '100', 100], ['b220', '220', 220], ['b500', '500', 500], ['b1k', '1.1K', 1100], ['b2k', '2.4K', 2400], ['b5k', '5.2K', 5200]];
const DYN_GEQ_DEF = { b100: 1, b220: -1.5, b500: -1, b1k: 2, b2k: 1.5, b5k: -1 }; // (a gentle mid-forward lift: cut the woof, push the cut-through)
pedalDef({
  id: 'coral', name: 'Coral Ladder', kind: 'GRAPHIC EQ', cat: 'filter', where: 'post', color: '#ff7a59', ink: '#1e0c06', trim: -0.5,
  nod: 'the seven-slider graphic EQ box', blurb: 'Six bands of tone surgery: scoop, push or fix',
  look: { shape: 'wide', finish: 'stripe', knob: 'small', label: 'block', led: '#fff066' },
  knobs: DYN_GEQ.map(([key, label]) => [key, label, -15, 15, DYN_GEQ_DEF[key], 0.5, (v) => (v > 0 ? '+' : '') + Math.round(v * 2) / 2]), // (bare numbers: six fit across)
  build(c, k) {
    const input = k.G(1), bands = DYN_GEQ.map(([, , f]) => k.F('peaking', f, 1.3, 0));
    const output = k.chain(input, ...bands, k.G(1));
    return { input, output, set(v, x) { DYN_GEQ.forEach(([key], i) => x.to(bands[i].gain, v[key])); } };
  },
});

// Mantis Mid: a parametric mid: one sweepable bell (the frequency, how much, how wide) and a level. The honk that
// cuts a mix, or the scoop that fattens a chug.
pedalDef({
  id: 'mantismid', name: 'Mantis Mid', kind: 'PARAMETRIC MID', cat: 'filter', where: 'pre', color: '#12a39a', ink: '#effffd', trim: -1,
  nod: 'the sweepable mid boost and the studio parametric', blurb: 'Dial in exactly the mids that cut, or scoop them',
  look: { shape: 'box', finish: 'brushed', knob: 'chrome', label: 'plate', led: '#7dfff0' },
  knobs: [['freq', 'FREQ', 150, 5000, 800, 10, dynHzFmt], ['gain', 'GAIN', -15, 15, 5, 0.5, dynDbFmt], ['q', 'WIDTH', 0, 10, 5, 0, (v) => 'Q ' + (0.4 * Math.pow(2, v * 0.4)).toFixed(1)], ['level', 'LEVEL', -12, 12, 0, 0.5, dynDbFmt]],
  build(c, k) {
    const input = k.G(1), bell = k.F('peaking', 800, 1.2, 5), level = k.G(1);
    k.chain(input, bell, level);
    return { input, output: level, set(v, x) {
      x.to(bell.frequency, v.freq); x.to(bell.gain, v.gain); x.to(bell.Q, 0.4 * Math.pow(2, v.q * 0.4)); // Q 0.4 to 6.4
      x.to(level.gain, k.dB(v.level));
    } };
  },
});

/* ======== filter: wahs */

// Wailing Whale: the treadle wah. Rock the pedal (drag the treadle); PEAK is how vocal the resonance is; VOICE picks
// the classic sweep, a brighter modern one, or a low one for down-tuned riffs.
pedalDef({
  id: 'wah', name: 'Wailing Whale', kind: 'WAH', cat: 'filter', where: 'pre', color: '#18181c', ink: '#eaeaea', trim: 7.7,
  nod: 'the black inductor wah of every funk and solo record', blurb: 'Rock it heel to toe: the vocal wail of a wah',
  look: { shape: 'wah', treadle: 'pos', finish: 'flat', knob: 'chrome', label: 'script', led: '#ff3b30' },
  knobs: [['pos', 'TREADLE', 0, 10, 5], ['peak', 'PEAK', 0, 10, 5], { key: 'voice', label: 'VOICE', opts: ['VINT', 'MOD', 'LOW'], def: 0 }],
  build(c, k) {
    const w = dynWahCore(k);
    return { input: w.input, output: w.output, set(v, x) { w.set(x, v.pos / 10, v.peak, v.voice); } };
  },
});

// Stuck Shrimp: the wah parked half way, for good. That nasal, honking seventies lead tone, without a foot on it.
pedalDef({
  id: 'stuckwah', name: 'Stuck Shrimp', kind: 'FIXED WAH', cat: 'filter', where: 'pre', color: '#ff8fb1', ink: '#3a0a1a', trim: 7.8,
  nod: 'the half-cocked wah of seventies glam and metal leads', blurb: 'A wah parked mid-way: honky, nasal lead tone',
  look: { shape: 'mini', finish: 'check', knob: 'cream', label: 'block', led: '#ffe45c' },
  knobs: [['pos', 'PARK', 0, 10, 5.5, 0, (v) => dynHzFmt(350 * Math.pow(2200 / 350, Math.pow(v / 10, 1.35)))], ['peak', 'PEAK', 0, 10, 5]],
  build(c, k) {
    const w = dynWahCore(k);
    return { input: w.input, output: w.output, set(v, x) { w.set(x, v.pos / 10, v.peak, 0); } };
  },
});

// Squid Quack: the seventies envelope filter. Your pick opens it (or, DOWN, closes it); LP, BP or HP; a resonant peak
// that squelches. The sweep is exponential (the envelope drives the filter's detune in cents), so it quacks evenly.
pedalDef({
  id: 'quack', name: 'Squid Quack', kind: 'ENVELOPE FILTER', cat: 'filter', where: 'pre', color: '#ffc93c', ink: '#2b1800', trim: 6,
  nod: 'the seventies envelope filter with the up/down and mode switches', blurb: 'Funk quack that follows your pick: up, down, LP/BP/HP',
  look: { shape: 'wide', finish: 'flat', knob: 'chicken', label: 'script', led: '#7dffb8' },
  worklets: { 'pfx-env': PFX.ENV },
  knobs: [['sens', 'SENS', 0, 10, 6], ['peak', 'PEAK', 0, 10, 5], ['decay', 'DECAY', 0, 10, 4],
    { key: 'mode', label: 'MODE', opts: ['LP', 'BP', 'HP'], def: 0 }, { key: 'dir', label: 'SWEEP', opts: ['UP', 'DOWN'], def: 0 }, { key: 'range', label: 'RANGE', opts: ['LO', 'HI'], def: 0 }],
  build(c, k) {
    const input = k.G(1), output = k.G(1), f1 = k.F('bandpass', 300, 4), f2 = k.F('lowpass', 8000, 0), mk = k.G(1), dryish = k.G(0);
    const env = k.envelope({ attack: 0.003, release: 0.15 }), sens = k.G(4), depth = k.G(0);
    // the envelope, soft-limited to 1 (a hard pick and a medium one both reach the top, differently fast)
    const sat = k.curve((x) => (x <= 0 ? 0 : Math.tanh(2 * x) / Math.tanh(2)), 'none', 1024);
    if (env) k.chain(input, env, sens, sat, depth, f1.detune);
    k.chain(input, f1, f2, mk, output);
    k.chain(input, dryish, output);
    return { input, output, set(v, x) {
      const type = ['lowpass', 'bandpass', 'highpass'][v.mode], down = v.dir === 1;
      if (f1.type !== type) f1.type = type;
      const lo = v.range ? 450 : 220, span = 3.2; // octaves swept
      x.to(f1.frequency, down ? lo * Math.pow(2, span) : lo);
      x.to(depth.gain, (down ? -1 : 1) * span * 1200);
      x.to(sens.gain, 0.5 + v.sens * 1.1);
      if (env) x.to(env.parameters.get('release'), 0.04 + v.decay * 0.05);
      x.to(f1.Q, v.mode === 1 ? 1.5 + v.peak * 1.1 : v.peak * 2); // (band-pass: plain Q; LP and HP: resonance in dB)
      // level by mode: the band-pass throws away the most; HP keeps a little lowpassed dry so it isn't all fizz
      x.to(mk.gain, [1, 2.9, 0.5][v.mode] * (down ? 3.5 : 1) * k.dB(-v.peak * (v.mode === 1 ? 0.3 : 0.9)));
      x.to(dryish.gain, v.mode === 2 ? 0.12 : 0);
    } };
  },
});

// Mouthy Mollusc: the talk box without the tube in your mouth. Three formant band-passes glide along a-e-i-o-u (a
// waveshaper maps one control signal to each formant's frequency), driven by an LFO or by your picking.
const DYN_VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]]; // a e i o u: F1 F2 F3
const dynVowelFmt = (v) => { const i = Math.floor(v + 1e-6), f = v - i, L = 'AEIOU'; return f < 0.15 || i >= 4 ? L[Math.min(4, i)] : f > 0.85 ? L[i + 1] : L[i] + '–' + L[i + 1]; };
pedalDef({
  id: 'mollusc', name: 'Mouthy Mollusc', kind: 'TALK BOX · VOWEL', cat: 'filter', where: 'post', color: '#e0457b', ink: '#fff0f6', trim: 6, stereo: false,
  nod: 'the talk box of eighties rock and robot funk', blurb: 'Makes your guitar talk: a-e-i-o-u by LFO or by pick',
  look: { shape: 'wide', finish: 'sparkle', knob: 'cream', label: 'script', led: '#ffd1e3' },
  worklets: { 'pfx-env': PFX.ENV },
  knobs: [['vowel', 'VOWEL', 0, 4, 0, 0, dynVowelFmt], ['depth', 'DEPTH', 0, 10, 6], ['rate', 'RATE', 0, 10, 3, 0, (v) => (0.15 * Math.pow(2, v * 0.55)).toFixed(1) + ' Hz'],
    { key: 'src', label: 'BY', opts: ['LFO', 'PICK'], def: 0 }, ['peak', 'PEAK', 0, 10, 5], ['mix', 'MIX', 0, 10, 9]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), ctl = k.G(1), wet = k.G(1), dry = k.G(0);
    const off = k.constant(-1), lfo = k.lfo(0.5, 'triangle'), lfoG = k.G(0), env = k.envelope({ attack: 0.01, release: 0.25 }), envG = k.G(0);
    off.connect(ctl); k.chain(lfo, lfoG, ctl);
    if (env) k.chain(input, env, envG, ctl);
    // a little grit first: a talk box is usually fed a driven amp, and the formants need harmonics to shape
    const grit = k.chain(input, k.F('highpass', 110, 0), k.G(2), k.shaper(1.8, 0.05));
    const gains = [1, 0.7, 0.4], bps = DYN_VOWELS[0].map((f, j) => {
      const bp = k.F('bandpass', 0, 8), map = k.curve((x) => { const p = Math.max(0, Math.min(4, (x + 1) * 2)), i = Math.min(3, Math.floor(p)), t = p - i; return (DYN_VOWELS[i][j] * (1 - t) + DYN_VOWELS[i + 1][j] * t) / 4000; }, 'none', 1024);
      k.chain(ctl, map, k.G(4000), bp.frequency);
      k.chain(grit, bp, k.G(gains[j]), wet);
      return bp;
    });
    k.chain(wet, output); k.chain(input, dry, output);
    return { input, output, set(v, x) {
      // (the control is -1..1 across a-u, half a unit a vowel: the LFO or the pick sweeps up from VOWEL by DEPTH)
      const d = v.depth / 10;
      x.to(off.offset, v.vowel / 2 - 1 + (v.src ? 0 : d));
      x.to(lfoG.gain, v.src ? 0 : d); x.to(envG.gain, v.src ? d * 7 : 0);
      x.to(lfo.frequency, 0.15 * Math.pow(2, v.rate * 0.55));
      bps.forEach((bp, j) => x.to(bp.Q, (5 + j * 2.5) * (0.5 + v.peak / 10)));
      x.to(wet.gain, (v.mix / 10) * k.dB(-v.peak * 0.4)); x.to(dry.gain, 1 - v.mix / 10);
    } };
  },
});

/* ======== utility */

// Barnacle Buffer: the plain, useful box. A clean buffer with a level, a CABLE knob that puts back (or takes away) the
// treble a long cable eats, a polarity flip and a mono sum (a stereo pedal into a mono amp, or a phase check).
pedalDef({
  id: 'buffer', name: 'Barnacle Buffer', kind: 'BUFFER · UTILITY', cat: 'utility', where: 'pre', color: '#8e9187', ink: '#14150f', trim: 0,
  nod: 'the humble buffer, clean boost and phase box', blurb: 'Clean level, cable tone, polarity flip, mono sum',
  look: { shape: 'box', finish: 'hammer', knob: 'small', label: 'stencil', led: '#9dff5c' },
  knobs: [['level', 'LEVEL', -12, 12, 0, 0.5, dynDbFmt], ['cable', 'CABLE', 0, 10, 0, 0, (v) => (v <= 0 ? 'buffered' : Math.round(v * 3) + ' m')],
    { key: 'pol', label: 'POLARITY', opts: ['+', '−'], def: 0 }, { key: 'sum', label: 'SUM', opts: ['STEREO', 'MONO'], def: 0 }],
  build(c, k) {
    // two paths, one switched on: stereo straight through, or a GainNode forced to one channel (the average of L and R)
    const input = k.G(1), st = k.G(1), mono = k.G(0), output = k.G(1), cab = k.F('lowpass', 20000, 0);
    mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    k.chain(input, st, cab); k.chain(input, mono, cab); k.chain(cab, output);
    return { input, output, set(v, x) {
      const g = k.dB(v.level) * (v.pol ? -1 : 1);
      x.to(st.gain, v.sum ? 0 : g); x.to(mono.gain, v.sum ? g : 0);
      // a guitar pickup into cable capacitance: the resonant roll-off falls from 20 kHz (none) to about 3.5 kHz at 30 m
      x.to(cab.frequency, v.cable <= 0 ? 20000 : 20000 * Math.pow(2, -v.cable * 0.25));
      x.to(cab.Q, v.cable <= 0 ? 0 : 1.5 + v.cable * 0.2);
    } };
  },
});

/* ======== filter: the weird ones */

// Wub Leviathan: the dubstep wobble. The guitar is driven hard (the growl), through a resonant 24 dB low-pass whose
// cutoff an LFO in time with the band sweeps across several octaves, then clipped again after the filter so the
// resonance snarls. Shapes: WUB (sine), WOB (a decaying saw), CHOP (square), YOI (up, dip, up, down: the talking one),
// RISE (a saw up), RIDDIM (four steps). With the band playing, the LFO locks to its beat.
const DYN_WUB = [
  ['WUB', (p) => 0.5 - 0.5 * Math.cos(2 * Math.PI * p)],
  ['WOB', (p) => (p < 0.04 ? dynSm(p / 0.04) : Math.pow(1 - (p - 0.04) / 0.96, 1.8))],
  ['CHOP', (p) => (p < 0.03 ? dynSm(p / 0.03) : p < 0.5 ? 1 : p < 0.53 ? 1 - dynSm((p - 0.5) / 0.03) : 0)],
  ['YOI', (p) => (p < 0.22 ? dynSm(p / 0.22) : p < 0.45 ? 1 - 0.6 * dynSm((p - 0.22) / 0.23) : p < 0.68 ? 0.4 + 0.5 * dynSm((p - 0.45) / 0.23) : 0.9 * (1 - dynSm((p - 0.68) / 0.3)))],
  ['RISE', (p) => (p < 0.95 ? Math.pow(p / 0.95, 1.5) : 1 - dynSm((p - 0.95) / 0.05))],
  ['RIDDIM', (p) => { const s = [1, 0.25, 0.7, 0.1], i = Math.floor(p * 4), f = p * 4 - i, nx = s[(i + 1) % 4]; return f > 0.9 ? s[i] + (nx - s[i]) * dynSm((f - 0.9) / 0.1) : s[i]; }],
];
pedalDef({
  id: 'wub', name: 'Wub Leviathan', kind: 'WOBBLE · IN TIME', cat: 'filter', where: 'post', color: '#0d1020', ink: '#39ff88', trim: -5,
  nod: 'the wobble bass of dubstep, made from a guitar', blurb: 'Growling filter wobble locked to the band: wub, wob, yoi',
  look: { shape: 'wide', finish: 'stripe', knob: 'chicken', label: 'stencil', led: '#39ff88' },
  knobs: [['rate', 'RATE', 0, DYN_NOTES.length - 1, 4, 1, dynNoteFmt], ['shape', 'SHAPE', 0, DYN_WUB.length - 1, 0, 1, (v) => DYN_WUB[Math.round(v)][0]],
    ['depth', 'DEPTH', 0, 10, 7], ['cutoff', 'CUTOFF', 0, 10, 3, 0, (v) => dynHzFmt(70 * Math.pow(2, v * 0.45))], ['res', 'RES', 0, 10, 6], ['growl', 'GROWL', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), lp1 = k.F('lowpass', 150, 8), lp2 = k.F('lowpass', 150, 0), yoi = k.F('peaking', 600, 3, 0), post = k.G(1), level = k.G(1), comp = k.G(1);
    const drive = k.shaper(4, 0.12), snarl = k.shaper(2.2, 0.05);
    const cyc = dynCycle(k, DYN_WUB.map((s) => s[1])), depth = k.G(0);
    cyc.out.connect(depth); depth.connect(lp1.detune); depth.connect(lp2.detune); depth.connect(yoi.detune);
    // (a quieter closed filter gets a little makeup: louder when dark, so the wobble pumps less than it wubs)
    const dark = k.constant(1), darkG = k.G(1); cyc.out.connect(k.G(-1)).connect(darkG); dark.connect(darkG); darkG.connect(comp.gain);
    k.chain(input, k.F('highpass', 60, 0), pre, drive, lp1, lp2, yoi, post, snarl, comp, level);
    let rate = -1, beats = 0.5;
    const tick = () => { const b = dynBeat(c); if (b != null) cyc.sync(b / beats); k.later(tick, 250); };
    k.later(tick, 250);
    return { input, output: level, cyc, set(v, x) {
      beats = DYN_NOTES[Math.round(v.rate)][1];
      const hz = x.bpm / 60 / beats;
      cyc.set(Math.round(v.shape), hz);
      if (v.rate !== rate) { rate = v.rate; const b = dynBeat(c); if (b != null) cyc.sync(b / beats); }
      const base = 70 * Math.pow(2, v.cutoff * 0.45); // 70 Hz to 1.6 kHz closed
      x.to(lp1.frequency, base); x.to(lp2.frequency, base * 1.1); x.to(yoi.frequency, base * 2.2);
      x.to(depth.gain, v.depth * 720); // up to 6 octaves of sweep, in cents
      x.to(lp1.Q, v.res * 2.2); // resonance in dB
      x.to(yoi.gain, Math.round(v.shape) === 3 ? 9 : 3); // (YOI leans on a vowel-ish formant riding above the peak)
      x.to(pre.gain, k.dB(2 + v.growl * 2.4)); x.to(post.gain, k.dB(v.growl * 0.8 - v.res * 0.5));
      x.to(darkG.gain, 0.1 + v.depth * 0.04); // closed: up to 1.5x
      x.to(level.gain, k.dB(-8 - v.growl * 1.1));
    } };
  },
});

// Rising Tide: the EDM riser. A resonant low-pass opens from dark to wide open over 1 to 16 bars, the resonance
// climbing and the low end thinning as it goes, then snaps shut on the drop (LOOP), or opens once and stays (ONCE:
// stomp it, or flip MODE with its second footswitch, to start again). With the band playing, LOOP peaks on the bar line.
const DYN_BARS = [1, 2, 4, 8, 16];
pedalDef({
  id: 'riser', name: 'Rising Tide', kind: 'RISER · IN BARS', cat: 'filter', where: 'post', color: '#ff9f1c', ink: '#1e1000', trim: -2,
  nod: 'the filter sweep build-up before every EDM drop', blurb: 'A filter that builds over N bars and drops on the one',
  look: { shape: 'wide', finish: 'sparkle', knob: 'black', label: 'plate', led: '#fff3a3', foot2: 'mode' },
  knobs: [['bars', 'BARS', 0, DYN_BARS.length - 1, 1, 1, (v) => DYN_BARS[Math.round(v)] + (Math.round(v) ? ' bars' : ' bar')], ['from', 'FROM', 0, 10, 4, 0, (v) => dynHzFmt(60 * Math.pow(2, v * 0.45))],
    ['res', 'RES', 0, 10, 5], ['thin', 'THIN', 0, 10, 4], { key: 'mode', label: 'MODE', opts: ['LOOP', 'ONCE'], def: 0 }],
  build(c, k) {
    const input = k.G(1), lp1 = k.F('lowpass', 200, 0), lp2 = k.F('lowpass', 200, 0), hp = k.F('highpass', 20, 0), comp = k.G(0), level = k.G(1);
    // the control: 0 (shut) to 1 (open). LOOP: a looping ramp; ONCE: a ConstantSource ramped from the stomp
    const cyc = dynCycle(k, [(p) => (p < 0.985 ? p / 0.985 : 1 - dynSm((p - 0.985) / 0.015))]), loopG = k.G(1), once = k.constant(0), ctl = k.G(1);
    cyc.out.connect(loopG); loopG.connect(ctl); once.connect(ctl);
    const sweep = k.G(0), resG = k.G(0), thinG = k.G(0), darkG = k.G(0), dark = k.constant(1);
    ctl.connect(sweep); sweep.connect(lp1.detune); sweep.connect(lp2.detune);
    ctl.connect(resG); resG.connect(lp1.Q);
    const sq = k.curve((x) => Math.max(0, x) ** 3, 'none', 1024); ctl.connect(sq); sq.connect(thinG); thinG.connect(hp.frequency);
    ctl.connect(k.G(-1)).connect(darkG); dark.connect(darkG); darkG.connect(comp.gain); // (makeup while it's dark)
    comp.gain.value = 1;
    k.chain(input, lp1, lp2, hp, comp, level);
    let on = false, mode = -1, secs = 4, bars = 2;
    const fire = () => { const t = c.currentTime; once.offset.cancelScheduledValues(0); once.offset.setValueAtTime(0, t); once.offset.linearRampToValueAtTime(1, t + secs); };
    const tick = () => { const b = dynBeat(c); if (b != null && mode === 0) cyc.sync(b / (4 * bars)); k.later(tick, 400); };
    k.later(tick, 400);
    return { input, output: level, cyc, set(v, x) {
      bars = DYN_BARS[Math.round(v.bars)]; secs = (bars * 4 * 60) / x.bpm;
      cyc.set(0, 1 / secs);
      const from = 60 * Math.pow(2, v.from * 0.45), oct = Math.log2(18000 / from);
      x.to(lp1.frequency, from); x.to(lp2.frequency, from);
      x.to(sweep.gain, oct * 1200);
      x.to(lp1.Q, 1 + v.res * 0.4); x.to(resG.gain, v.res * 1.4); // resonance climbs to about 20 dB at the top
      x.to(thinG.gain, v.thin * 55); // the low end thins to 20 + 550 Hz by the peak
      x.to(darkG.gain, 0.9 - v.from * 0.05); // (so it still grows louder as it opens: tension)
      // LOOP runs the ramp; ONCE mutes it and starts the one-shot (again on each stomp or flip to ONCE)
      const was = mode; mode = v.mode;
      x.to(loopG.gain, mode ? 0 : 1, 0.005);
      if (mode === 1 && (was !== 1 || (v.on && !on))) fire();
      if (mode === 0) { once.offset.cancelScheduledValues(0); once.offset.setValueAtTime(0, c.currentTime); if (was !== 0) { const b = dynBeat(c); if (b != null) cyc.sync(b / (4 * bars)); } }
      on = !!v.on; // (the one place a pedal here looks at on: a stomp restarts the one-shot rise)
    } };
  },
});
}
