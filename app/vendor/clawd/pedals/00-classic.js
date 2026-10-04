// vendored verbatim from clawd-o-matic/web/pedals/00-classic.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: the classic six (the board Plug in started with). docs/PEDALS.md says how a pack works. */
// The flat, black-knobbed look is theirs: the first board's. Levels measured with tools/plug-level.js and pedal-check.js.

pedalDef({
  id: 'gate', name: 'Snapper', kind: 'NOISE GATE', cat: 'dynamics', where: 'pre', color: '#2a2340', ink: '#f5d547',
  nod: 'the little noise suppressor on every hi-gain board', blurb: 'Snaps shut between chords: no hiss, tight stops',
  look: { finish: 'flat', knob: 'black', label: 'script' },
  worklets: { 'clawd-gate': PLUG_GATE },
  knobs: [['th', 'THRESHOLD', -100, -30, -62, 1, (v) => (v <= -99 ? 'open' : Math.round(v) + ' dB')]],
  build(c, k) {
    const node = k.worklet('clawd-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const io = node || k.G(1);
    return { input: io, output: io, node, set(v, x) { if (node) x.to(node.parameters.get('threshold'), v.th); } };
  },
});

// Clawdrive, the green screamer: the clean signal plus a clipped copy of its mids, then a treble-cut tone and level
pedalDef({
  id: 'drive', name: 'Clawdrive', kind: 'OVERDRIVE', cat: 'drive', where: 'pre', color: '#3ddc84', ink: '#10150f', trim: -10,
  nod: 'the green mid-hump overdrive', blurb: 'Pushes the amp: tighter lows, singing mids',
  look: { finish: 'flat', knob: 'black', label: 'script' },
  knobs: [['drive', 'DRIVE', 0, 10, 4], ['tone', 'TONE', 0, 10, 6], ['level', 'LEVEL', 0, 10, 6]],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), tone = k.F('lowpass', 3000, 0.5), level = k.G(1);
    k.chain(input, k.F('highpass', 720, 0.5), pre, k.shaper(3, 0), k.G(0.4), tone);
    k.chain(input, tone); // (the clean part)
    k.chain(tone, level);
    return { input, output: level, set(v, x) {
      x.to(pre.gain, k.dB(8 + v.drive * 3.2));
      x.to(tone.frequency, 700 * Math.pow(2, v.tone * 0.3)); // 700 Hz to 5.6 kHz
      x.to(level.gain, k.dB((v.level - 6) * 2.4));
    } };
  },
});

// Big Crab: two hard stages and a scooped tone (lows or highs, the mids fall out between)
pedalDef({
  id: 'fuzz', name: 'Big Crab', kind: 'FUZZ', cat: 'fuzz', where: 'pre', color: '#ff4c9a', ink: '#1a0b12', trim: -17.5,
  nod: 'the three-knob violet fuzz and its scooped wall of sound', blurb: 'Two hard clipping stages and a scooped tone',
  look: { finish: 'flat', knob: 'black', label: 'script' },
  knobs: [['sustain', 'SUSTAIN', 0, 10, 6], ['tone', 'TONE', 0, 10, 5], ['level', 'VOLUME', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), pre = k.G(1), lo = k.G(0.5), hi = k.G(0.5), level = k.G(1);
    const mid = k.chain(input, k.F('highpass', 90, 0.7), pre, k.shaper(8, 0.15), k.F('highpass', 120, 0.7), k.G(k.dB(12)), k.shaper(5, 0.05));
    k.chain(mid, k.F('lowpass', 650, 0.7), lo, level);
    k.chain(mid, k.F('highpass', 1100, 0.7), hi, level);
    const output = k.chain(level, k.F('lowpass', 7000, 0.7));
    return { input, output, set(v, x) {
      x.to(pre.gain, k.dB(14 + v.sustain * 2.8));
      x.to(lo.gain, 1 - v.tone / 10); x.to(hi.gain, v.tone / 10);
      x.to(level.gain, k.dB((v.level - 5) * 2.4));
    } };
  },
});

// Tidepool: two short delays swept in opposite directions, one each side (it makes the guitar stereo)
pedalDef({
  id: 'chorus', name: 'Tidepool', kind: 'CHORUS', cat: 'mod', where: 'post', color: '#39d5ff', ink: '#08161c', stereo: true,
  nod: 'the sky-blue compact chorus of every 90s clean tone', blurb: 'Watery stereo shimmer for cleans and arpeggios',
  look: { finish: 'flat', knob: 'black', label: 'script' },
  knobs: [['rate', 'RATE', 0, 10, 3], ['depth', 'DEPTH', 0, 10, 5], ['mix', 'MIX', 0, 10, 5]],
  build(c, k) {
    const input = k.G(1), output = k.G(1), dry = k.G(1), wet = k.G(0);
    const lfo = k.lfo(0.8), dL = k.delay(0.05, 0.012), dR = k.delay(0.05, 0.012), depL = k.G(0), depR = k.G(0);
    k.chain(lfo, depL, dL.delayTime); k.chain(lfo, depR, dR.delayTime);
    input.connect(dL); input.connect(dR);
    k.chain(k.merge(dL, dR), wet, output);
    k.chain(input, dry, output);
    return { input, output, set(v, x) {
      x.to(lfo.frequency, 0.15 * Math.pow(2, v.rate * 0.45)); // 0.15 to 3.4 Hz
      x.to(depL.gain, 0.0004 * v.depth); x.to(depR.gain, -0.0004 * v.depth);
      x.to(wet.gain, 0.09 * v.mix, 0.02); x.to(dry.gain, 1 - 0.02 * v.mix, 0.02);
    } };
  },
});

// Echo Reef: dark, filtered repeats at a note value of the song's tempo
pedalDef({
  id: 'delay', name: 'Echo Reef', kind: 'DELAY · IN TIME', cat: 'time', where: 'post', trails: true, color: '#2b4fd8', ink: '#f2f2ff',
  drone: true, // (REPEATS near 10 runs away, as an analogue delay's does: its filters' Q, in dB here, peak the loop over 0.97)
  nod: 'a warm analogue-voiced delay with tap tempo', blurb: 'Dark repeats locked to the band’s tempo',
  look: { finish: 'flat', knob: 'black', label: 'script' },
  knobs: [['time', 'TIME', 0, 5, 2, 1, PFX.noteFmt], ['fb', 'REPEATS', 0, 10, 4], ['mix', 'MIX', 0, 10, 4]],
  build(c, k) {
    const input = k.G(1), dl = k.delay(2.5), fb = k.G(0.3), wet = k.G(0);
    k.chain(input, dl, k.F('lowpass', 3200, 0.6), k.F('highpass', 160, 0.6), fb, dl);
    k.chain(dl, wet);
    return { input, output: wet, set(v, x) {
      x.to(dl.delayTime, Math.min(2.4, x.note(v.time)), 0.05);
      x.to(fb.gain, 0.085 * v.fb);
      x.to(wet.gain, 0.07 * v.mix);
    } };
  },
});

// Deep Trench: a convolver on a generated tail (a new one when DECAY settles)
pedalDef({
  id: 'verb', name: 'Deep Trench', kind: 'REVERB', cat: 'ambient', where: 'post', trails: true, color: '#e8b53a', ink: '#1a1405', stereo: true,
  nod: 'a big digital hall in a small box', blurb: 'A hall that rings on after you stomp it off',
  look: { finish: 'flat', knob: 'black', label: 'script' },
  knobs: [['decay', 'DECAY', 0, 10, 4], ['tone', 'TONE', 0, 10, 5], ['mix', 'MIX', 0, 10, 3]],
  build(c, k) {
    const input = k.G(1), conv = k.convolver(), tone = k.F('lowpass', 6000, 0.5), wet = k.G(0);
    k.chain(input, k.F('highpass', 220, 0.6), conv, tone, wet);
    let decay = -1, timer = 0;
    const make = (d) => { const secs = 0.4 + d * 0.36; conv.buffer = k.ir({ secs, seed: 1 + Math.round(d * 97), pre: 0.012, tail: 1.2 }); };
    return { input, output: wet, set(v, x) {
      if (v.decay !== decay) { decay = v.decay; clearTimeout(timer); if (!conv.buffer) make(decay); else timer = k.later(() => make(decay), 120); }
      x.to(tone.frequency, 1500 * Math.pow(2, v.tone * 0.25)); // 1.5 to 8.5 kHz
      x.to(wet.gain, 0.19 * v.mix);
    } };
  },
});
