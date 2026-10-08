// @ts-check
// Three devices written the way an agent writes them (kernel source against the public dsp stdlib, in a session,
// from a plain-language request), shipped inside the demo song as project devices signed by Claude. They show the
// luthier loop: someone describes a sound, the agent writes the DSP, the studio checks it, and a face appears.
//
//   "Make my guitar sound like it's underwater in a cathedral."      -> claude.tidal-cathedral (effect)
//   "Something glassy that twinkles over the chorus, like fireflies." -> claude.firefly (instrument)
//   "Make the keys sound like an old cassette on the night bus."     -> claude.night-bus (effect)
//
// Levels were measured with kernel/check.js (see tools/showcase-test.js), not guessed.

export const TIDAL_CATHEDRAL = {
  id: 'claude.tidal-cathedral',
  name: 'Tidal Cathedral',
  kind: 'effect',
  cat: 'ambient',
  by: 'claude',
  version: 1,
  blurb: 'A vast stone room under the sea: the tail sways with the tide',
  nod: 'a long cathedral reverb heard through water',
  request: "Make my guitar sound like it's underwater in a cathedral.",
  params: [
    {
      key: 'depth',
      label: 'DEPTH',
      min: 0,
      max: 1,
      def: 0.55,
      role: 'tone',
      desc: 'how far under: darker and more wobbly as it rises',
    },
    { key: 'size', label: 'NAVE', min: 0, max: 1, def: 0.85, role: 'size', desc: 'the size of the room' },
    {
      key: 'decay',
      label: 'DECAY',
      min: 1,
      max: 20,
      def: 7,
      curve: 'log',
      unit: 's',
      role: 'decay',
      desc: 'how long the stone rings',
    },
    {
      key: 'tide',
      label: 'TIDE',
      opts: ['2 BT', '1 BAR', '2 BAR', '4 BAR'],
      def: 2,
      role: 'rate',
      desc: 'one swell of the tide, in time with the song',
    },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 0.45, role: 'mix', desc: 'how much of the room you hear' },
  ],
  look: {
    color: '#123c55',
    ink: '#bdf3ff',
    shape: 'wide',
    finish: 'hammer',
    knob: 'chrome',
    label: 'script',
    led: '#5ff2ff',
  },
  tail: 20,
  kernel: `({
  create({ sr, seed, dsp }) {
    const verb = dsp.fdn(0.9, 7, 0.5, seed);
    const sway = dsp.chorus(0.6, 0.2);
    const tide = dsp.lfo('sine', 0.1, seed);
    const wetL = dsp.svf(), wetR = dsp.svf(), dryL = dsp.svf(), dryR = dsp.svf();
    const lowL = dsp.onepole(140), lowR = dsp.onepole(140);
    const PRE = Math.round(sr * 0.045);
    const preL = dsp.delay(PRE + 8), preR = dsp.delay(PRE + 8);
    const gw = dsp.smooth(40, 0), gd = dsp.smooth(40, 1);
    let size = -1, decay = -1, depth = -1;
    return {
      process(L, R, n, p, t) {
        if (p.size !== size || p.decay !== decay || p.depth !== depth) {
          size = p.size; decay = p.decay; depth = p.depth;
          verb.set(0.5 + 0.5 * size, decay, 0.3 + 0.45 * depth);
          sway.set(0.2 + 0.8 * depth, 0.12 + 0.25 * depth);
        }
        tide.sync([2, 4, 8, 16][p.tide | 0], t);
        const wetFc = 9000 * Math.pow(420 / 9000, depth), dryFc = 18000 * Math.pow(2200 / 18000, depth);
        const wetG = 2.7 * p.mix, dryG = 1 - 0.3 * p.mix;
        for (let i = 0; i < n; i++) {
          const s = tide.next();
          if ((i & 15) === 0) {
            const fc = wetFc * Math.pow(2, 1.1 * depth * s);
            wetL.set(fc, 0.9); wetR.set(fc, 0.9);
            dryL.set(dryFc, 0.6); dryR.set(dryFc, 0.6);
          }
          const xl = L[i], xr = R[i];
          // the send: no mud, a short pre-delay, the stone, then the water
          const sl = preL.read(PRE), sr2 = preR.read(PRE);
          preL.write(lowL.hp(xl)); preR.write(lowR.hp(xr));
          verb.tick(sl, sr2);
          sway.tick(verb.l, verb.r);
          const wl = wetL.lp(verb.l * 0.55 + sway.l * 0.75), wr = wetR.lp(verb.r * 0.55 + sway.r * 0.75);
          const w = gw.tick(wetG), d = gd.tick(dryG);
          L[i] = dryL.lp(xl) * d + wl * w;
          R[i] = dryR.lp(xr) * d + wr * w;
        }
      },
    };
  },
})`,
};

export const FIREFLY = {
  id: 'claude.firefly',
  name: 'Firefly',
  kind: 'instrument',
  cat: 'keys',
  by: 'claude',
  version: 1,
  blurb: 'Glass bells that glow and flicker: twinkles over a chorus',
  nod: 'a celesta crossed with a glass harmonica',
  request: 'Something glassy that twinkles over the chorus, like fireflies.',
  params: [
    {
      key: 'glow',
      label: 'GLOW',
      min: 0,
      max: 1,
      def: 0.55,
      role: 'tone',
      desc: 'brightness: more of the high partials',
    },
    {
      key: 'flicker',
      label: 'FLICKER',
      min: 0,
      max: 1,
      def: 0.35,
      role: 'depth',
      desc: 'each note pulses on its own, like a firefly',
    },
    {
      key: 'decay',
      label: 'DECAY',
      min: 0.3,
      max: 8,
      def: 2.6,
      curve: 'log',
      unit: 's',
      role: 'decay',
      desc: 'how long a bell rings',
    },
    {
      key: 'release',
      label: 'RELEASE',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'release',
      desc: 'how much it keeps ringing after you let go',
    },
    {
      key: 'width',
      label: 'WIDTH',
      min: 0,
      max: 1,
      def: 0.6,
      role: 'width',
      desc: 'partials spread across the stereo field',
    },
  ],
  look: {
    color: '#2a2350',
    ink: '#ffe9a8',
    shape: 'rack',
    finish: 'sparkle',
    knob: 'cream',
    label: 'script',
    led: '#ffd84a',
  },
  tail: 8,
  kernel: `({
  poly: 12,
  create({ sr, seed, dsp }) {
    // a struck glass bar: slightly inharmonic partials, the high ones dying first
    const RATIOS = [1, 2.0, 2.76, 4.07, 5.4, 6.98];
    const DECAYS = [1, 0.62, 0.42, 0.28, 0.2, 0.13];
    const r = dsp.rng(seed ^ 0xf1ef1e);
    return {
      voice(i) {
        const bank = dsp.modal(RATIOS.map((x) => 440 * x), DECAYS.map((d) => d * 2.6), RATIOS.map(() => 0.2));
        const shimmer = dsp.modal([440 * 3.01, 440 * 4.97], [0.5, 0.35], [0.1, 0.08]);
        const flick = dsp.lfo('sine', 4 + 4 * r(), (seed + i * 977) >>> 0);
        const damp = dsp.smooth(30, 1);
        const MAL = Math.max(4, Math.round(sr * 0.0006));   // a hard felt mallet: a 0.6 ms pulse, not a click
        let vel = 0, on = false, pan = 0, decay = -1, glow = -1, gl = 1, gr = 1, hit = MAL, hitAmp = 0, airAmp = 0;
        return {
          start(pitch, v, p) {
            vel = v; on = true;
            const ratio = dsp.mtof(pitch) / 440;
            bank.tune(ratio); shimmer.tune(ratio);
            if (p.decay !== decay || p.glow !== glow) {
              decay = p.decay; glow = p.glow;
            }
            bank.damp(decay / 2.6); shimmer.damp(decay / 2.6);
            damp.reset(1);
            pan = (((pitch * 7) % 12) / 11 - 0.5) * p.width;
            gl = Math.cos((pan + 0.5) * Math.PI / 2) * 1.41; gr = Math.sin((pan + 0.5) * Math.PI / 2) * 1.41;
            hit = 0; hitAmp = (v * (0.6 + 0.4 * v) * 2) / MAL; airAmp = (v * p.glow * 0.8 * 2) / MAL;
          },
          release(p) { on = false; },
          render(L, R, n, p, t) {
            const target = on ? 1 : 0.15 + 0.85 * p.release;
            const fl = p.flicker * 0.45, brite = 0.35 + 0.65 * p.glow;
            for (let i = 0; i < n; i++) {
              const k = damp.tick(target);
              let x = 0;
              if (hit < MAL) { x = 0.5 - 0.5 * Math.cos((2 * Math.PI * hit) / MAL); hit++; }
              const body = bank.tick(x * hitAmp), air = shimmer.tick(x * airAmp) * brite;
              const y = (body + air) * (1 - fl + fl * flick.uni()) * (0.55 + 0.45 * k) * 1.0;
              L[i] += y * gl; R[i] += y * gr;
            }
            if (!on) { bank.damp((decay / 2.6) * (0.25 + 0.75 * p.release)); shimmer.damp((decay / 2.6) * (0.25 + 0.75 * p.release)); }
            return hit < MAL || bank.active() || shimmer.active();
          },
        };
      },
      // after the voices are summed: a soft knee, linear up to -6 dBFS, that never quite reaches -1.9 dBFS
      process(L, R, n) {
        for (let i = 0; i < n; i++) {
          let a = L[i], b = R[i];
          if (a > 0.5 || a < -0.5) a = (a > 0 ? 1 : -1) * (0.5 + 0.3 * dsp.tanh((Math.abs(a) - 0.5) / 0.3));
          if (b > 0.5 || b < -0.5) b = (b > 0 ? 1 : -1) * (0.5 + 0.3 * dsp.tanh((Math.abs(b) - 0.5) / 0.3));
          L[i] = a; R[i] = b;
        }
      },
    };
  },
})`,
};

export const NIGHT_BUS = {
  id: 'claude.night-bus',
  name: 'Night Bus',
  kind: 'effect',
  cat: 'mod',
  by: 'claude',
  version: 1,
  blurb: 'A worn cassette on the last bus home: wow, hiss and warmth',
  nod: 'a portable tape deck with tired batteries',
  request: 'Make the keys sound like an old cassette on the night bus.',
  params: [
    {
      key: 'age',
      label: 'AGE',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'tone',
      desc: 'older tape: darker, hissier, more flutter',
    },
    {
      key: 'wow',
      label: 'WOW',
      min: 0,
      max: 1,
      def: 0.4,
      role: 'depth',
      desc: 'the slow pitch sway of a stretched tape',
    },
    {
      key: 'warmth',
      label: 'WARMTH',
      min: 0,
      max: 1,
      def: 0.45,
      role: 'drive',
      desc: 'tape saturation and a little low-end bump',
    },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', desc: 'how much of the tape you hear' },
  ],
  look: {
    color: '#3b2a24',
    ink: '#ffcf8f',
    shape: 'box',
    finish: 'stripe',
    knob: 'chicken',
    label: 'stencil',
    led: '#ff9a3d',
  },
  kernel: `({
  create({ sr, seed, dsp }) {
    const BASE = Math.round(sr * 0.008), MAX = Math.round(sr * 0.02);
    const dl = dsp.delay(MAX + 8), dr = dsp.delay(MAX + 8);
    const wow = dsp.lfo('drift', 0.55, seed), flutter = dsp.lfo('sine', 7.3, seed + 1), wander = dsp.lfo('drift', 0.17, seed + 2);
    const hiss = dsp.noise(seed + 3, 'pink'), hissR = dsp.noise(seed + 4, 'pink');
    const osL = dsp.oversample2x(), osR = dsp.oversample2x();
    const toneL = dsp.svf(), toneR = dsp.svf(), bumpL = dsp.biquad(), bumpR = dsp.biquad();
    let drive = 1, comp = 1;
    const tape = (x) => dsp.tanh(x * drive) * comp;
    const gm = dsp.smooth(30, 1);
    // the hiss is the tape moving past the head: it stops with the transport (stopped, the deck is silent; it had put
    // a constant -62 dBFS of pink hiss, most of it under 60 Hz, on the track). Playing, and in every render, it is 1.
    const run = dsp.smooth(40, 1);
    let age = -1, warmth = -1;
    return {
      latency: BASE,
      process(L, R, n, p, t) {
        if (p.age !== age || p.warmth !== warmth) {
          age = p.age; warmth = p.warmth;
          const fc = 14000 * Math.pow(3600 / 14000, age);
          toneL.set(fc, 0.62); toneR.set(fc, 0.62);
          bumpL.set('lowshelf', 95, 0.7, 3 * warmth); bumpR.set('lowshelf', 95, 0.7, 3 * warmth);
          drive = 1 + 3.5 * warmth; comp = 1 / Math.pow(drive, 0.72);
        }
        const wowAmt = sr * 0.0021 * p.wow, flAmt = sr * 0.00018 * (0.3 + age), hissAmt = 0.0035 * age * age;
        const rolling = t.playing === false ? 0 : 1;
        for (let i = 0; i < n; i++) {
          const h = run.tick(rolling);
          const mod = BASE + wow.next() * wowAmt * (0.7 + 0.3 * wander.next()) + flutter.next() * flAmt;
          const xl = L[i], xr = R[i];
          // read everything before writing this sample: the dry is delayed by BASE too, so both paths line up
          const yl0 = dl.cubic(mod), yr0 = dr.cubic(mod + 0.6), dxl = dl.read(BASE), dxr = dr.read(BASE);
          dl.write(xl); dr.write(xr);
          const yl = toneL.lp(bumpL.tick(osL.process(yl0, tape))) + hiss.next() * hissAmt * h;
          const yr = toneR.lp(bumpR.tick(osR.process(yr0, tape))) + hissR.next() * hissAmt * h;
          const m = gm.tick(p.mix);
          L[i] = dxl + (yl - dxl) * m;
          R[i] = dxr + (yr - dxr) * m;
        }
      },
    };
  },
})`,
};

export const SHOWCASE = [TIDAL_CATHEDRAL, FIREFLY, NIGHT_BUS];
