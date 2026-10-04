// vendored verbatim from clawd-o-matic/web/pedals/10-drive.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: drives, boosts and distortions. docs/PEDALS.md says how a pack works. */
// The classic circuits of the category (the Clawdrive in 00-classic.js is the green screamer, so there's none here),
// then three only a browser would build. Each one's comment says where the real circuit clips and what its tone
// control does, because that's what makes it sound like its kind. Levels (trim) measured with tools/pedal-check.js.
{
  // A hard diode clip with a small knee (silicon diodes to ground, or an op-amp slamming its rails): linear below about
  // a quarter of full scale, flat above. knee: higher is harder. Normalised so ±1 in is ±1 out.
  const drvHard = (k, knee = 6, bias = 0) => {
    const f = (x) => { const y = 4 * (x + bias); return y / Math.pow(1 + Math.pow(Math.abs(y), knee), 1 / knee); };
    const f0 = f(0), n = Math.max(f(1) - f0, f0 - f(-1));
    return k.curve((x) => (f(x) - f0) / n);
  };
  // A first-order high-pass (6 dB/octave, like a single coupling capacitor), which a biquad can't do.
  const drvHp1 = (k, fc) => {
    const K = Math.tan((Math.PI * fc) / k.sr), b0 = 1 / (1 + K);
    return k.c.createIIRFilter([b0, -b0], [1, (K - 1) / (K + 1)]);
  };
  // The output stage's supply rails: untouched up to 0.7 of `ceil`, then rounded off to it. For pedals whose EQ and
  // output knobs together could otherwise swing far past anything a real 9-18 V box can put out.
  const drvRail = (k, ceil) => [k.G(1 / ceil), k.curve((x) => { const a = Math.abs(x); return Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3)); }), k.G(ceil)];
  // a LEVEL knob: unity at its default, 2.4 dB a step
  const drvLvl = (k, v, d) => k.dB((v - d) * 2.4);

  // Seahorse: the transparent gold overdrive. Its clean path and its clipped path are summed, and the GAIN knob is ganged
  // so the clean part falls as the dirt rises. Germanium diodes clip softly and early; the TREBLE is an active shelf
  // after the sum; the output has buckets of headroom, so it's as much a boost as a drive.
  pedalDef({
    id: 'seahorse', name: 'Seahorse', kind: 'TRANSPARENT OD', cat: 'drive', where: 'pre', color: '#d9b25a', ink: '#2a1a05', trim: -5,
    nod: 'the gold horse-man overdrive with a clean blend',
    blurb: 'Your amp, only more so: dirt with the clean left in',
    look: { shape: 'box', finish: 'brushed', knob: 'cream', label: 'script', led: '#ffd27a' },
    knobs: [['gain', 'GAIN', 0, 10, 3], ['treble', 'TREBLE', 0, 10, 5], ['out', 'OUTPUT', 0, 10, 5]],
    build(c, k) {
      const input = k.G(1), clean = k.G(1), pre = k.G(1), dirt = k.G(1), sum = k.G(1), out = k.G(1);
      const treb = k.F('highshelf', 1800, null, 0);
      k.chain(input, k.F('highpass', 30, 0), clean, sum);
      // the drive side: a little low cut and a gentle hump near 1 kHz before the diodes, a soft top after them
      k.chain(input, k.F('highpass', 160, -3), k.F('peaking', 1000, 0.7, 3), pre, k.shaper(1.4, 0.04), k.F('lowpass', 5200, -3), dirt, sum);
      const output = k.chain(sum, treb, out, ...drvRail(k, 3));
      return { input, output, set(v, x) {
        const g = v.gain / 10;
        x.to(pre.gain, k.dB(4 + g * 34));
        x.to(dirt.gain, 0.25 + g * 0.35);
        x.to(clean.gain, 1 - g * 0.75); // (the ganged pot: clean falls as gain rises)
        x.to(treb.gain, (v.treble - 5) * 2.2);
        x.to(out.gain, k.dB((v.out - 5) * 2.4));
      } };
    },
  });

  // Ratfish: the rodent op-amp distortion. The op-amp's gain climbs with frequency (the low end gets less of it), its
  // slow slew rate darkens it more the harder it's pushed, silicon diodes clip it hard to ground, and FILTER is a low-pass
  // that gets darker as you turn it up.
  pedalDef({
    id: 'ratfish', name: 'Ratfish', kind: 'DISTORTION', cat: 'drive', where: 'pre', color: '#1c1c1f', ink: '#f4f4f4', trim: -22,
    nod: 'the black rodent box with the backwards filter',
    blurb: 'Snarling, hard-clipped chunk; filter shaves the fizz',
    look: { shape: 'box', finish: 'hammer', knob: 'black', label: 'stencil', led: '#ff2d2d' },
    knobs: [['dist', 'DIST', 0, 10, 5], ['filter', 'FILTER', 0, 10, 4], ['vol', 'VOLUME', 0, 10, 5]],
    build(c, k) {
      const input = k.G(1), pre = k.G(1), gbw = k.F('lowpass', 8000, -3), filt = k.F('lowpass', 5000, -2), vol = k.G(1);
      k.chain(input, k.F('highpass', 40, 0), k.F('lowshelf', 400, null, -10), pre, gbw, drvHard(k, 7), filt, k.F('highpass', 60, -3), vol);
      return { input, output: vol, set(v, x) {
        const gdB = 12 + v.dist * 3.3; // 12 to 45 dB
        x.to(pre.gain, k.dB(gdB));
        x.to(gbw.frequency, Math.min(18000, 600000 / k.dB(gdB))); // (gain-bandwidth: more gain, less top)
        x.to(filt.frequency, 16000 * Math.pow(2, -v.filter * 0.5)); // 16 kHz to 500 Hz
        x.to(vol.gain, drvLvl(k, v.vol, 5));
      } };
    },
  });

  // Orange Roughy: the orange compact distortion every punk kid starts on. A transistor booster, then an op-amp into
  // hard diodes, then the tone: a low-pass and a high-pass blended, so the mids between them drop out (the scoop).
  pedalDef({
    id: 'roughy', name: 'Orange Roughy', kind: 'DISTORTION', cat: 'drive', where: 'pre', color: '#ff7a1a', ink: '#1a0d00', trim: -20,
    nod: 'the orange compact distortion on every first board',
    blurb: 'Buzzsaw punk crunch, straight out of the garage',
    look: { shape: 'box', finish: 'flat', knob: 'black', label: 'block', led: '#ff2020' },
    knobs: [['tone', 'TONE', 0, 10, 6], ['level', 'LEVEL', 0, 10, 5], ['dist', 'DIST', 0, 10, 6]],
    build(c, k) {
      const input = k.G(1), pre = k.G(1), lo = k.G(0.5), hi = k.G(0.5), level = k.G(1);
      const clip = k.chain(input, k.F('highpass', 35, 0), k.shaper(1.2, 0.1), k.F('highpass', 180, -3), pre, drvHard(k, 5, 0.03), k.F('lowpass', 7500, -3));
      k.chain(clip, k.F('lowpass', 900, -3), lo, level);
      k.chain(clip, k.F('highpass', 600, -3), hi, level);
      const output = k.chain(level, k.F('highpass', 70, -3));
      return { input, output, set(v, x) {
        x.to(pre.gain, k.dB(10 + v.dist * 3));
        x.to(lo.gain, 1 - v.tone / 12); x.to(hi.gain, 0.15 + v.tone / 10);
        x.to(level.gain, drvLvl(k, v.level, 5));
      } };
    },
  });

  // Blue Tang: the blue amp-like overdrive. Two soft, lopsided discrete stages (even harmonics, like a valve), so it
  // cleans up when you pick lightly and compresses like an amp when you dig in. TONE tilts, not just cuts.
  pedalDef({
    id: 'bluetang', name: 'Blue Tang', kind: 'AMP-LIKE OD', cat: 'drive', where: 'pre', color: '#1f63c4', ink: '#ffe14d', trim: -17,
    nod: 'the blue overdrive that acts like a cranked combo',
    blurb: 'Clean when you’re gentle, hairy when you dig in',
    look: { shape: 'box', finish: 'stripe', knob: 'black', label: 'script', led: '#66ccff' },
    knobs: [['gain', 'GAIN', 0, 10, 4], ['tone', 'TONE', 0, 10, 5], ['level', 'LEVEL', 0, 10, 5]],
    build(c, k) {
      const input = k.G(1), pre = k.G(1), mid = k.G(1), level = k.G(1), lo = k.F('lowshelf', 500, null, 0), hi = k.F('highshelf', 1800, null, 0);
      k.chain(input, k.F('highpass', 70, -3), pre, k.shaper(1.3, 0.28), k.F('lowpass', 6500, -3), mid, k.shaper(1.8, 0.12), k.F('highpass', 40, -3), lo, hi, level);
      const output = k.chain(level, ...drvRail(k, 8));
      return { input, output, set(v, x) {
        x.to(pre.gain, k.dB(v.gain * 3.4)); // 0 to 34 dB
        x.to(mid.gain, k.dB(2 + v.gain * 0.6));
        x.to(lo.gain, -(v.tone - 5) * 1.2); x.to(hi.gain, (v.tone - 5) * 1.8);
        x.to(level.gain, drvLvl(k, v.level, 5));
      } };
    },
  });

  // Compulsive Clam: the obsessive-compulsive drive. MOSFETs clip it (harder than diodes' tanh, softer than a brick
  // wall), and its HP/LP switch changes the op-amp's feedback: HP is louder, more open, more bass; LP is rounder,
  // compressed, a bit vintage. TONE is a plain low-pass.
  pedalDef({
    id: 'clamocd', name: 'Compulsive Clam', kind: 'OVERDRIVE · HP/LP', cat: 'drive', where: 'pre', color: '#ece6d8', ink: '#1c1c1c', trim: -19.5,
    nod: 'the cream drive with the HP/LP switch',
    blurb: 'From edge-of-breakup to full stack, and a switch to go big',
    look: { shape: 'wide', finish: 'flat', knob: 'chicken', label: 'stencil', led: '#ff2a2a', foot2: 'mode' },
    knobs: [['vol', 'VOLUME', 0, 10, 5], ['drive', 'DRIVE', 0, 10, 5], ['tone', 'TONE', 0, 10, 6], { key: 'mode', label: 'MODE', opts: ['LP', 'HP'], def: 1 }],
    build(c, k) {
      const input = k.G(1), pre = k.G(1), lpG = k.G(0), hpG = k.G(1), sum = k.G(1), tone = k.F('lowpass', 4000, -2), vol = k.G(1);
      const mos = k.curve((x) => { const y = 3 * x; return (y / Math.pow(1 + Math.pow(Math.abs(y), 2.6), 1 / 2.6)) / (3 / Math.pow(1 + Math.pow(3, 2.6), 1 / 2.6)); });
      k.chain(input, k.F('highpass', 45, 0), pre);
      // (the two feedback voicings run side by side; the switch picks one)
      k.chain(pre, k.F('lowpass', 2400, -3), k.F('highpass', 160, -3), lpG, sum);
      k.chain(pre, k.F('highpass', 80, -3), hpG, sum);
      k.chain(sum, mos, k.F('highpass', 50, -3), tone, vol);
      return { input, output: vol, set(v, x) {
        x.to(pre.gain, k.dB(4 + v.drive * 3.4));
        x.to(hpG.gain, v.mode ? k.dB(3) : 0); x.to(lpG.gain, v.mode ? 0 : k.dB(-1));
        x.to(tone.frequency, 900 * Math.pow(2, v.tone * 0.33)); // 900 Hz to 8.9 kHz
        x.to(vol.gain, drvLvl(k, v.vol, 5));
      } };
    },
  });

  // Mantis Boost: the germanium treble booster from the sixties blues-rock stacks. A small input capacitor (a first-order
  // high-pass) means only the top goes in to be boosted; one germanium transistor adds a lopsided grit near the top of
  // BOOST. RANGE moves the cap: TREB (the original), MID, FULL.
  pedalDef({
    id: 'mantisboost', name: 'Mantis Boost', kind: 'TREBLE BOOSTER', cat: 'drive', where: 'pre', color: '#7f9c8f', ink: '#101a15', trim: -15,
    nod: 'the germanium treble booster of sixties stacks',
    blurb: 'Cuts through: a bright kick that makes the amp bite',
    look: { shape: 'mini', finish: 'hammer', knob: 'chrome', label: 'plate', led: '#ffb347' },
    knobs: [['boost', 'BOOST', 0, 10, 6], { key: 'range', label: 'RANGE', opts: ['TREB', 'MID', 'FULL'], def: 0 }],
    build(c, k) {
      const input = k.G(1), pre = k.G(1), out = k.G(1), sel = [k.G(1), k.G(0), k.G(0)];
      [2000, 700, 90].forEach((f, i) => k.chain(input, drvHp1(k, f), sel[i], pre));
      k.chain(input, k.G(0.18), pre); // (a little of the low end leaks through the transistor)
      k.chain(pre, k.shaper(1.1, 0.35), k.F('lowpass', 9000, -3), out);
      return { input, output: out, set(v, x) {
        sel.forEach((g, i) => x.to(g.gain, i === v.range ? [1, 0.8, 0.55][i] : 0));
        x.to(pre.gain, k.dB(v.boost * 2.6)); // 0 to 26 dB, into the transistor
        x.to(out.gain, k.dB(v.range === 0 ? 3 : 0));
      } };
    },
  });

  // Barnacle Boost: a clean boost, pure gain with lots of headroom (nothing in it clips), to push the amp or to jump out
  // for a solo. VOICE: FLAT, FAT (a low shelf) or BRITE (a high shelf).
  pedalDef({
    id: 'barnacle', name: 'Barnacle Boost', kind: 'CLEAN BOOST', cat: 'drive', where: 'pre', color: '#c3cad3', ink: '#16181c', trim: 0,
    nod: 'the clean boost with a big dial and headroom',
    blurb: 'Pure, clean volume: push the amp, or jump out for a solo',
    look: { shape: 'mini', finish: 'brushed', knob: 'small', label: 'block', led: '#39ff88' },
    knobs: [['boost', 'BOOST', 0, 15, 2.5, 0.5, (v) => '+' + (+v).toFixed(1) + ' dB'], { key: 'voice', label: 'VOICE', opts: ['FLAT', 'FAT', 'BRITE'], def: 0 }],
    build(c, k) {
      const input = k.G(1), lo = k.F('lowshelf', 160, null, 0), hi = k.F('highshelf', 3200, null, 0), out = k.G(1);
      k.chain(input, lo, hi, out);
      return { input, output: out, set(v, x) {
        x.to(lo.gain, v.voice === 1 ? 4 : 0); x.to(hi.gain, v.voice === 2 ? 4 : 0);
        x.to(out.gain, k.dB(v.boost - (v.voice ? 2.5 : 0)));
      } };
    },
  });

  // Plexi Prawn: the British stack in a box. A bright cap (treble past the gain pot, fading as it goes up), two lopsided
  // valve-ish stages with a coupling cap between them, and the passive tone stack (whose mids never quite come back).
  pedalDef({
    id: 'plexiprawn', name: 'Plexi Prawn', kind: 'AMP IN A BOX', cat: 'drive', where: 'pre', color: '#2a2019', ink: '#e8c878', trim: -24,
    nod: 'the British plexi stack squeezed into a box',
    blurb: 'Stadium crunch from a stompbox: chords that roar',
    look: { shape: 'wide', finish: 'check', knob: 'cream', label: 'plate', led: '#ffcf4a' },
    knobs: [['gain', 'GAIN', 0, 10, 6], ['bass', 'BASS', 0, 10, 5], ['mid', 'MIDDLE', 0, 10, 6], ['treble', 'TREBLE', 0, 10, 6], ['vol', 'VOLUME', 0, 10, 5]],
    build(c, k) {
      const input = k.G(1), bright = k.F('highshelf', 2200, null, 6), pre = k.G(1), v2 = k.G(1), vol = k.G(1);
      const bass = k.F('lowshelf', 110, null, 0), mid = k.F('peaking', 650, 0.8, 0), treb = k.F('highshelf', 2600, null, 0);
      k.chain(input, k.F('highpass', 70, -3), bright, pre, k.shaper(2, 0.22), k.F('highpass', 110, -3), k.F('lowpass', 7000, -3), v2, k.shaper(1.6, -0.12),
        bass, mid, treb, k.F('lowpass', 7500, -3), vol);
      return { input, output: vol, set(v, x) {
        x.to(bright.gain, 7 - v.gain * 0.5);
        x.to(pre.gain, k.dB(6 + v.gain * 2.8));
        x.to(v2.gain, k.dB(4 + v.gain * 0.8));
        x.to(bass.gain, (v.bass - 5) * 1.6);
        x.to(mid.gain, -6 + v.mid * 0.9); // (-6 to +3 dB: the stack scoops the mids even flat out)
        x.to(treb.gain, (v.treble - 5) * 1.8);
        x.to(vol.gain, drvLvl(k, v.vol, 5));
      } };
    },
  });

  // Moray Zone: the metal distortion with the mad parametric mid. A tight low cut, two stages, the second hard, then a
  // three-band EQ whose mid is a narrow, sweepable ±15 dB bell. The output op-amp's rails round off whatever the EQ
  // throws at it.
  pedalDef({
    id: 'moray', name: 'Moray Zone', kind: 'METAL DISTORTION', cat: 'drive', where: 'pre', color: '#2c3136', ink: '#ff6a1f', trim: -19.5,
    nod: 'the black metal box with the wild parametric mid',
    blurb: 'Saturated metal with a mid knob that goes anywhere',
    look: { shape: 'wide', finish: 'brushed', knob: 'black', label: 'stencil', led: '#ff6a1f' },
    knobs: [['level', 'LEVEL', 0, 10, 5], ['dist', 'DIST', 0, 10, 6],
      ['low', 'LOW', -15, 15, 4, 0.5, (v) => (v > 0 ? '+' : '') + (+v).toFixed(1) + ' dB'], ['high', 'HIGH', -15, 15, 2, 0.5, (v) => (v > 0 ? '+' : '') + (+v).toFixed(1) + ' dB'],
      ['mid', 'MID', -15, 15, -6, 0.5, (v) => (v > 0 ? '+' : '') + (+v).toFixed(1) + ' dB'],
      ['freq', 'MID FREQ', 0, 10, 4, 0, (v) => { const f = 200 * Math.pow(25, v / 10); return f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz'; }]],
    build(c, k) {
      const input = k.G(1), pre = k.G(1), low = k.F('lowshelf', 120, null, 0), mid = k.F('peaking', 800, 2.2, 0), high = k.F('highshelf', 3500, null, 0), level = k.G(1);
      k.chain(input, k.F('highpass', 110, -3), pre, k.shaper(3, 0.06), k.F('lowpass', 8000, -3), k.F('highpass', 160, -3), k.G(k.dB(16)), drvHard(k, 5),
        k.F('lowpass', 6000, 0), low, mid, high, k.G(0.3), k.shaper(1.4), level);
      return { input, output: level, set(v, x) {
        x.to(pre.gain, k.dB(8 + v.dist * 3));
        x.to(low.gain, v.low); x.to(high.gain, v.high); x.to(mid.gain, v.mid);
        x.to(mid.frequency, 200 * Math.pow(25, v.freq / 10)); // 200 Hz to 5 kHz
        x.to(level.gain, drvLvl(k, v.level, 5));
      } };
    },
  });

  // Screamin' Hydra: the green screamer stacked three deep. Each head is the whole circuit (the clean signal plus a
  // clipped copy of its mids), and each hump sits a little higher, so the mids pile up into one enormous honk.
  pedalDef({
    id: 'hydra', name: 'Screamin Hydra', kind: 'OD × 3 CASCADE', cat: 'drive', where: 'pre', color: '#13705f', ink: '#d8ffb0', trim: -13,
    nod: 'three green mid-hump overdrives chained end to end',
    blurb: 'Three green drives in a row: grow a head, get more honk',
    look: { shape: 'box', finish: 'flat', knob: 'chicken', label: 'script', led: '#b6ff3d' },
    knobs: [['drive', 'DRIVE', 0, 10, 5], ['tone', 'TONE', 0, 10, 5], ['level', 'LEVEL', 0, 10, 5], { key: 'heads', label: 'HEADS', opts: ['ONE', 'TWO', 'THREE'], def: 2 }],
    build(c, k) {
      const input = k.G(1), tone = k.F('lowpass', 3000, -2), level = k.G(1), pres = [], dry = [], wet = [];
      let at = input;
      [720, 900, 1150].forEach((hump, i) => {
        const pre = k.G(1), out = k.G(1), lp = k.F('lowpass', 5500 - i * 800, -3);
        k.chain(at, k.F('highpass', hump, -2), pre, k.shaper(3, 0.02), k.G(0.4), lp);
        k.chain(at, k.G(0.7), lp); // (the clean part, as in the real one)
        const d = k.G(0), w = k.G(1); // (heads two and three: stomped in or wired past)
        if (i) { at.connect(d); d.connect(out); }
        k.chain(lp, w, out);
        pres.push(pre); dry.push(d); wet.push(w);
        at = out;
      });
      k.chain(at, k.F('highpass', 60, -3), tone, level);
      return { input, output: level, set(v, x) {
        pres.forEach((p, i) => x.to(p.gain, k.dB(6 + v.drive * (2.4 - i * 0.4))));
        for (let i = 1; i < 3; i++) { const on = i <= v.heads; x.to(wet[i].gain, on ? 1 : 0); x.to(dry[i].gain, on ? 0 : 1); }
        x.to(tone.frequency, 900 * Math.pow(2, v.tone * 0.28));
        x.to(level.gain, k.dB((v.level - 5) * 2.4 + [5, 2.5, 0][v.heads]));
      } };
    },
  });

  // Puffer Blowout: a blown speaker in a box. The lows are the cone: one way it slams into the magnet (a hard stop),
  // the other it flaps (soft), and as it heats up with loud notes its rest point wanders (the pick envelope shifts the
  // bias), so it sputters and farts. RATTLE is the torn paper buzzing, only while the cone's slapping.
  pedalDef({
    id: 'puffer', name: 'Puffer Blowout', kind: 'BLOWN SPEAKER', cat: 'drive', where: 'pre', color: '#f2cf3e', ink: '#3b1f0a', trim: -17,
    nod: 'a practice amp with a torn cone, played anyway',
    blurb: 'A torn, farting speaker: sputters and rattles on hits',
    look: { shape: 'round', finish: 'check', knob: 'chicken', label: 'block', led: '#ff5b2e' },
    worklets: { 'pfx-env': PFX.ENV },
    knobs: [['blow', 'BLOW', 0, 10, 6], ['rattle', 'RATTLE', 0, 10, 4], ['vol', 'VOLUME', 0, 10, 5]],
    build(c, k) {
      const input = k.G(1), pre = k.G(1), sum = k.G(1), out = k.G(1), rat = k.G(0), buzz = k.G(0), sag = k.G(0);
      // the cone: asymmetric, a hard stop one way and a soft flap the other
      const cone = k.curve((x) => (x > 0 ? 0.42 * Math.tanh(x / 0.42) * (1 - 0.3 * Math.max(0, x - 0.42)) : Math.tanh(x * 1.6) / Math.tanh(1.6)));
      k.chain(input, k.F('highpass', 45, 0), pre, sum, cone, k.F('highpass', 30, 0), k.F('peaking', 1300, 1.2, 6), k.F('lowpass', 4200, -1), out);
      const env = k.envelope({ attack: 0.02, release: 0.25 });
      if (env) k.chain(input, env, sag, sum); // (a louder note shifts the cone's rest point: it starves and farts)
      // the rattle: noise gated by how far the lows overshoot (the paper slapping)
      const over = k.curve((x) => Math.max(0, Math.abs(x) - 0.35) * 1.5);
      k.chain(pre, k.F('lowpass', 300, 0), over, buzz.gain);
      k.chain(k.noiseSource({ seed: 11, secs: 1 }), k.F('highpass', 2200, 0), buzz, rat, out);
      return { input, output: out, set(v, x) {
        x.to(pre.gain, k.dB(4 + v.blow * 2.6));
        x.to(sag.gain, -v.blow * 0.35);
        x.to(rat.gain, v.rattle * 0.12);
        x.to(out.gain, drvLvl(k, v.vol, 5));
      } };
    },
  });

  // Pistol Shrimp: a drive that follows your picking. The pick's envelope sets the gain into the clipper: pick lightly
  // and it's clean, dig in and it snaps to fuzz. SNAP is how hard you have to dig, FUZZ how far it goes, BLOOM how long
  // a hard note stays dirty. FLIP turns it inside out: soft notes fuzz, hard ones come through clean.
  pedalDef({
    id: 'pistolshrimp', name: 'Pistol Shrimp', kind: 'DYNAMIC DRIVE', cat: 'drive', where: 'pre', color: '#d63a2f', ink: '#fff0e8', trim: -8.5,
    nod: 'a valve amp cleaning up under a light touch',
    blurb: 'Clean when you pick soft, fuzz when you snap the string',
    look: { shape: 'wide', finish: 'sparkle', knob: 'chrome', label: 'block', led: '#fff27a', foot2: 'mode' },
    worklets: { 'pfx-env': PFX.ENV },
    knobs: [['snap', 'SNAP', 0, 10, 6], ['fuzz', 'FUZZ', 0, 10, 6], ['bloom', 'BLOOM', 0, 10, 4], ['level', 'LEVEL', 0, 10, 5], { key: 'mode', label: 'MODE', opts: ['DIG', 'FLIP'], def: 0 }],
    build(c, k) {
      const input = k.G(1), vca = k.G(0), base = k.constant(0.05), sens = k.G(1), depth = k.G(1), dig = k.G(1), flip = k.G(0), level = k.G(1);
      // the clean guitar, always there, plus the clipper, whose gain the envelope drives (so a soft note isn't lost)
      const hp = k.chain(input, k.F('highpass', 60, -3)), sum = k.G(1);
      k.chain(hp, k.G(0.8), sum);
      k.chain(hp, vca, k.shaper(4, 0.1), k.G(0.45), sum);
      k.chain(sum, k.F('highpass', 40, -3), k.F('lowpass', 6000, -3), level);
      base.connect(vca.gain);
      const env = k.envelope({ attack: 0.002, release: 0.15 });
      if (env) {
        // the envelope (about 0 to 0.3 for this strum) -> SNAP -> a curve for each mode -> FUZZ -> the clipper's gain
        const up = k.curve((u) => Math.pow(Math.max(0, u), 1.4)), down = k.curve((u) => 1 - Math.pow(Math.max(0, u), 0.6));
        k.chain(input, env, sens);
        k.chain(sens, up, dig, depth); k.chain(sens, down, flip, depth);
        depth.connect(vca.gain);
      } else base.offset.value = 3; // (no worklet: a plain drive)
      return { input, output: level, set(v, x) {
        if (env) {
          x.to(env.parameters.get('release'), 0.03 + v.bloom * 0.07);
          x.to(sens.gain, 1 + v.snap * 0.6);
          x.to(depth.gain, 1 + v.fuzz * 1.6);
          x.to(dig.gain, v.mode ? 0 : 1); x.to(flip.gain, v.mode ? 1 : 0);
        }
        x.to(level.gain, drvLvl(k, v.level, 5));
      } };
    },
  });
}
