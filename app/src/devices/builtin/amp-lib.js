// The guitar amp's DSP, shared by Half Stack (core.stack), Iso Cab (core.cab) and Y Cable (core.bassrig): kernel text
// the three devices interpolate (not `dsp` names, so it can change without touching the forever list; a change moves
// the devices' hashes, as any device change does), the tone stack's maths as a plain function (its source is in the
// kernels, so tools/stack-test.js checks the very code that runs), and the cab bank's hash and names.
//
// The chain, as Half Stack runs it (intent 0008, spec R23):
//   gate      before the gain: its key high-passed at 100 Hz, open above GATE, closed 6 dB under it once 30 ms have
//             passed, the gain moving in 0.5 ms and out over 60 ms
//   tight     a second-order high-pass at TIGHT (Butterworth): what the amp never sees, it can't turn to mud
//   boost     a green overdrive's shape (Electrosmash's Tube Screamer analysis): the clean signal plus a branch
//             high-passed at 720 Hz, amplified 12x to 118x by DRIVE and clipped by a diode pair, then a 4 kHz low-pass
//             and LEVEL. Its mids drive the amp; its lows go in at unity
//   preamp    three cascaded triode stages. Each is inverting, biased (even harmonics) and asymmetric: a firm knee where
//             the grid conducts, a longer, softer one at cutoff (x / sqrt(1 + x^2), an algebraic sigmoid: smooth to
//             every order, so its harmonics fall away fast and alias less than a clipper's). Between them a coupling
//             high-pass and a Miller low-pass; GAIN 0..10 is the pot after the first stage, 54 dB of travel
//   tone      a three-knob TMB stack, the circuit's own transfer function (Yeh & Smith, "Discretization of the '59
//             Fender Bassman tone stack", DAFx-06) with a modern high-gain lead's values (C1 470 pF, C2 = C3 22 nF,
//             R1 250k treble, R2 1M log bass, R3 25k mid, R4 47k), by the bilinear transform at the oversampled rate.
//             It scoops the mids at noon, as the real one does
//   power     MASTER drives a symmetric push-pull soft clip whose headroom SAG lowers on sustained loud playing (a
//             supply envelope, 8 ms in, 180 ms out); then DEPTH (a resonance bump near 90 Hz) and PRESENCE (a shelf
//             from 3.5 kHz), standing in for the negative feedback loop letting go at the ends of the band
// Steps boost to power run in one oversampled domain: 4x through dsp.oversample4x, or 8x with a further 2x stage inside
// it (a 7-tap half-band, flat to 24 kHz within 0.04 dB and 47 dB down where its images would land), the filters
// designed at that rate. Then the cab (CAB_LIB) and the cuts run at the host's rate.
export const CABS_HASH = 'sha256-7fd30c061e6b087e7694961ba78b953045f2ef0ac082a0fda6f21e370a8bc08e';

// the cab options, in the switch's order: the bank's six (tools/kits/jester-cabs.js), then the designed filter cab, then
// none (the amp's line out). LABELS go on the switch; NAMES are what they are, in words.
export const CAB_IDS = ['modern-close', 'modern-bright', 'modern-side', 'modern-two', 'british-dynamic', 'british-side'];
export const CAB_LABELS = ['MODERN CLOSE', 'MODERN BRIGHT', 'MODERN SIDE', 'MODERN 2 MICS', 'BRITISH', 'BRITISH SIDE', 'FILTER 4X12', 'OFF'];
export const CAB_NAMES = ['Modern 4x12, close dynamic', 'Modern 4x12, bright dynamic', 'Modern 4x12, side-address', 'Modern 4x12, two mics',
  'British 4x12, dynamic', 'British 4x12, side-address', 'Filter 4x12', 'Off (line out)'];
export const CAB_FILTER = 6, CAB_OFF = 7;
// what the rack and the pickers say while the bank is on its way, or isn't on this server (ui/rack.js dataLine): the
// amp is never silent, it plays the filter cab meanwhile
export const CAB_SAYS = {
  loading: ['Loading cabs…', 'Loading the cab impulse responses: the filter cab plays until they’re in'],
  missing: ['Cab file missing: playing the filter cab', 'The cab impulse responses aren’t on this server, so it plays the designed Filter 4x12'],
};

// The TMB tone stack. tmbAnalog: the circuit's transfer function H(s) = (b1 s + b2 s^2 + b3 s^3) / (1 + a1 s + a2 s^2 +
// a3 s^3) for knobs 0..10 (bass on an audio taper; a whisker of resistance at each end of every pot), into
// out = [b1, b2, b3, a1, a2, a3]. tmbCoefs: that, by the bilinear transform at rate fs, into out = [b0, b1, b2, b3, a1,
// a2, a3] (a0 = 1).
export function tmbAnalog(bass, mid, treble, out) {
  const R1 = 250e3, R2 = 1e6, R3 = 25e3, R4 = 47e3, C1 = 470e-12, C2 = 22e-9, C3 = 22e-9;
  const kb = bass < 0 ? 0 : bass > 10 ? 1 : bass / 10, km = mid < 0 ? 0 : mid > 10 ? 1 : mid / 10, kt = treble < 0 ? 0 : treble > 10 ? 1 : treble / 10;
  const l = 0.001 + 0.999 * (Math.exp(3.4 * kb) - 1) / (Math.exp(3.4) - 1), m = 0.001 + 0.998 * km, t = 0.001 + 0.998 * kt;
  out[0] = t * C1 * R1 + m * C3 * R3 + l * (C1 * R2 + C2 * R2) + (C1 * R3 + C2 * R3);
  out[1] = t * (C1 * C2 * R1 * R4 + C1 * C3 * R1 * R4) - m * m * (C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3)
    + m * (C1 * C3 * R1 * R3 + C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) + l * (C1 * C2 * R1 * R2 + C1 * C2 * R2 * R4 + C1 * C3 * R2 * R4)
    + l * m * (C1 * C3 * R2 * R3 + C2 * C3 * R2 * R3) + (C1 * C2 * R1 * R3 + C1 * C2 * R3 * R4 + C1 * C3 * R3 * R4);
  out[2] = l * m * (C1 * C2 * C3 * R1 * R2 * R3 + C1 * C2 * C3 * R2 * R3 * R4) - m * m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4)
    + m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4) + t * C1 * C2 * C3 * R1 * R3 * R4 - t * m * C1 * C2 * C3 * R1 * R3 * R4
    + t * l * C1 * C2 * C3 * R1 * R2 * R4;
  out[3] = (C1 * R1 + C1 * R3 + C2 * R3 + C2 * R4 + C3 * R4) + m * C3 * R3 + l * (C1 * R2 + C2 * R2);
  out[4] = m * (C1 * C3 * R1 * R3 - C2 * C3 * R3 * R4 + C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) + l * m * (C1 * C3 * R2 * R3 + C2 * C3 * R2 * R3)
    - m * m * (C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) + l * (C1 * C2 * R2 * R4 + C1 * C2 * R1 * R2 + C1 * C3 * R2 * R4 + C2 * C3 * R2 * R4)
    + (C1 * C2 * R1 * R4 + C1 * C3 * R1 * R4 + C1 * C2 * R3 * R4 + C1 * C2 * R1 * R3 + C1 * C3 * R3 * R4 + C2 * C3 * R3 * R4);
  out[5] = l * m * (C1 * C2 * C3 * R1 * R2 * R3 + C1 * C2 * C3 * R2 * R3 * R4) - m * m * (C1 * C2 * C3 * R1 * R3 * R3 + C1 * C2 * C3 * R3 * R3 * R4)
    + m * (C1 * C2 * C3 * R3 * R3 * R4 + C1 * C2 * C3 * R1 * R3 * R3 - C1 * C2 * C3 * R1 * R3 * R4) + l * C1 * C2 * C3 * R1 * R2 * R4
    + C1 * C2 * C3 * R1 * R3 * R4;
  return out;
}
export function tmbCoefs(bass, mid, treble, fs, out) {
  tmbAnalog(bass, mid, treble, out);
  const b1 = out[0], b2 = out[1], b3 = out[2], a1 = out[3], a2 = out[4], a3 = out[5];
  // bilinear: s = c (1 - 1/z) / (1 + 1/z), c = 2 fs
  const c = 2 * fs, c2 = c * c, c3 = c2 * c;
  const B0 = b1 * c + b2 * c2 + b3 * c3, B1 = b1 * c - b2 * c2 - 3 * b3 * c3, B2 = -b1 * c - b2 * c2 + 3 * b3 * c3, B3 = -b1 * c + b2 * c2 - b3 * c3;
  const A0 = 1 + a1 * c + a2 * c2 + a3 * c3, A1 = 3 + a1 * c - a2 * c2 - 3 * a3 * c3, A2 = 3 - a1 * c - a2 * c2 + 3 * a3 * c3, A3 = 1 - a1 * c + a2 * c2 - a3 * c3;
  out[0] = B0 / A0; out[1] = B1 / A0; out[2] = B2 / A0; out[3] = B3 / A0; out[4] = A1 / A0; out[5] = A2 / A0; out[6] = A3 / A0;
  return out;
}

// The amp's kernel text: needs lib.js's prelude (svf, onepole, dcblock, dbg, clamp, glide) before it. Defines
// makeAmp(sr, dsp) -> { set(P), tick(x) (one sample at the host's rate in, one out: gate, tight, then the oversampled
// chain), latency }. CAB_LIB defines makeCab(sr, dsp, bank) -> { set(cab, now?), process(x, n) (in place), plays(cab) }.
export const AMP_LIB = String.raw`
${tmbAnalog.toString()}
${tmbCoefs.toString()}
// the 2x stage inside the 4x one, for QUALITY 8X: a 7-tap half-band [c3, 0, c1, 1/2, c1, 0, c3] up and down (3 samples
// of delay each way at 8x), c1 = 9/32, c3 = -1/32
function over2(fn) {
  const C1 = 9 / 32, C3 = -1 / 32;
  let u1 = 0, u2 = 0, u3 = 0, a1 = 0, b1 = 0, b2 = 0, b3 = 0;
  return (u) => {
    const e = 2 * (C3 * (u + u3) + C1 * (u1 + u2)), o = u1;
    u3 = u2; u2 = u1; u1 = u;
    const a = fn(e), b = fn(o);
    const z = 0.5 * a1 + C1 * (b1 + b2) + C3 * (b + b3);
    a1 = a; b3 = b2; b2 = b1; b1 = b;
    return z;
  };
}

// The oversampled chain at rate fs: boost, three triodes, the tone stack, the power amp. set(P) once a block; tick(x)
// per oversampled sample, its state in plain locals (one-poles as y += k (x - y); a high-pass is x minus that).
function chain(fs, host) {
  const k1p = (fc) => 1 - Math.exp(-TAU * fc / fs);
  // the boost's 720 Hz branch high-pass and 4 kHz tone; the stages' coupling high-passes (c) and Miller low-passes
  // (m), a DC block after the last; the transformer's band
  const kBh = k1p(720), kBl = k1p(4000), kC1 = k1p(35), kM1 = k1p(14000), kC2 = k1p(90), kM2 = k1p(9500), kC3 = k1p(40), kM3 = k1p(6800), kDc = k1p(8);
  let bh = 0, bl = 0, c1 = 0, m1 = 0, c2 = 0, m2 = 0, c3 = 0, m3 = 0, dc = 0, oh = 0, ol = 0;
  // what follows the power amp's clip is linear, so it runs at the host's rate, after the oversampler: DEPTH and
  // PRESENCE, then the output transformer's band
  const hs = host, kOh = 1 - Math.exp(-TAU * 45 / hs), kOl = 1 - Math.exp(-TAU * 14000 / hs);
  // the triodes' cutoff sides (1 / K^2: K = 2.2, 1.6, 1.25) and biases
  const N1 = 1 / (2.2 * 2.2), N2 = 1 / (1.6 * 1.6), N3 = 1 / (1.25 * 1.25), B1 = 0.12, B2 = 0.18, B3 = 0.32;
  // the triode: a firm knee at +1 where the grid conducts, a softer cutoff out to -K (x / sqrt(1 + x^2) both ways)
  const tri = (u, n) => u / Math.sqrt(1 + u * u * (u >= 0 ? 1 : n));
  const T1 = tri(B1, N1), T2 = tri(B2, N2), T3 = tri(B3, N3);
  // first-order antiderivative anti-aliasing (Parker, Zavalishin and Le Bivic, DAFx-16) on every shaper: the shaper's
  // mean over the step from the last input to this one, (F(u) - F(u1)) / (u - u1), with F its antiderivative (zero at
  // 0); at the step's midpoint when the step is tiny. Half a sample of delay each, at the oversampled rate.
  function adaa(n) {
    let u1 = 0, F1 = 0;
    return (u) => {
      const F = u >= 0 ? Math.sqrt(1 + u * u) - 1 : (Math.sqrt(1 + n * u * u) - 1) / n, d = u - u1;
      const y = d > 1e-7 || d < -1e-7 ? (F - F1) / d : tri(0.5 * (u + u1), n);
      u1 = u; F1 = F;
      return y;
    };
  }
  const s1 = adaa(N1), s2 = adaa(N2), s3 = adaa(N3), s4 = adaa(1);
  // the tone stack: 3rd order, transposed direct form II, its coefficients set per block when a knob moved
  const tc = new Float64Array(7);
  let t0 = 0, t1 = 0, t2 = 0, t3 = 0, ta1 = 0, ta2 = 0, ta3 = 0, z1 = 0, z2 = 0, z3 = 0, lb = -1, lm = -1, lt = -1;
  // depth (a bell at 90 Hz) and presence (a shelf from 3.5 kHz): RBJ biquads, set per block
  let e0 = 1, e1 = 0, e2 = 0, ea1 = 0, ea2 = 0, f0 = 1, f1 = 0, f2 = 0, fa1 = 0, fa2 = 0;
  let d1 = 0, d2 = 0, p1 = 0, p2 = 0, env = 0, lastD = NaN, lastP = NaN;
  const eA = 1 - Math.exp(-1 / (0.008 * fs)), eR = 1 - Math.exp(-1 / (0.18 * fs));
  function rbj(type, fc, q, dB) {
    const A = Math.pow(10, dB / 40), w = TAU * fc / hs, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 0) { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    else { const r = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cs + r); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - r); a0 = (A + 1) - (A - 1) * cs + r; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - r; }
    tc[0] = b0 / a0; tc[1] = b1 / a0; tc[2] = b2 / a0; tc[3] = a1 / a0; tc[4] = a2 / a0;
  }
  // the per-block values
  let boost = 0, bG = 12, bLvl = 1, pot = 1, drv = 1, sag = 0, h = 1, ih = 1, hn = 0;
  const OS = Math.round(fs / host);
  return {
    set(P) {
      boost = P.boost ? 1 : 0;
      bG = 12 + 106 * P.boost_drive * P.boost_drive;
      bLvl = dbg(P.boost_level - 9);
      pot = dbg(-44 + 40 * clamp(P.gain, 0, 10) / 10);
      if (P.bass !== lb || P.mid !== lm || P.treble !== lt) {
        lb = P.bass; lm = P.mid; lt = P.treble; tmbCoefs(lb, lm, lt, fs, tc);
        t0 = tc[0]; t1 = tc[1]; t2 = tc[2]; t3 = tc[3]; ta1 = tc[4]; ta2 = tc[5]; ta3 = tc[6];
      }
      if (P.depth !== lastD) { lastD = P.depth; rbj(0, 90, 0.8, (P.depth - 5) * 1.3); e0 = tc[0]; e1 = tc[1]; e2 = tc[2]; ea1 = tc[3]; ea2 = tc[4]; }
      if (P.presence !== lastP) { lastP = P.presence; rbj(1, 3500, 0.6, (P.presence - 5) * 1.3); f0 = tc[0]; f1 = tc[1]; f2 = tc[2]; fa1 = tc[3]; fa2 = tc[4]; }
      drv = dbg(-6 + 2.2 * clamp(P.master, 0, 10));
      sag = clamp(P.sag, 0, 1) * 0.45 / 1.5;
    },
    tick(x) {
      // boost: the clean signal plus the branch (high-passed, amplified, clipped by the diodes at about 0.6), the
      // tone low-pass, the level
      if (boost) { bh += kBh * (x - bh); const v = (x - bh) * bG; bl += kBl * (x + v / Math.sqrt(1 + v * v * 2.7777778) - bl); x = bl * bLvl; }
      // preamp: three inverting stages, each biased and asymmetric
      let y = T1 - s1(4 * x + B1);
      c1 += kC1 * (y - c1); m1 += kM1 * (y - c1 - m1);
      y = T2 - s2(12 * pot * m1 + B2);
      c2 += kC2 * (y - c2); m2 += kM2 * (y - c2 - m2);
      y = T3 - s3(6 * m2 + B3);
      c3 += kC3 * (y - c3); m3 += kM3 * (y - c3 - m3);
      dc += kDc * (m3 - dc);
      // the tone stack (its own loss is about -9 dB through the middle), then the power amp's drive
      const v = m3 - dc;
      let z = t0 * v + z1; z1 = t1 * v - ta1 * z + z2; z2 = t2 * v - ta2 * z + z3; z3 = t3 * v - ta3 * z;
      y = z * 4 * drv;
      // sag: the supply's envelope, and the headroom it leaves (its reciprocal worked out once a host sample)
      const a = y < 0 ? -y : y;
      env += (a > env ? eA : eR) * (a - env);
      if (--hn <= 0) { hn = OS; h = 1 - sag * (env > 1.5 ? 1.5 : env); ih = 1 / h; }
      y = h * s4(y * ih);
      return y;
    },
    // at the host's rate, after the oversampler: depth and presence (where the feedback loop lets go, so they shape
    // what the power amp put out), then the transformer
    post(y) {
      let z = e0 * y + d1; d1 = e1 * y - ea1 * z + d2; d2 = e2 * y - ea2 * z; y = z;
      z = f0 * y + p1; p1 = f1 * y - fa1 * z + p2; p2 = f2 * y - fa2 * z;
      oh += kOh * (z - oh); ol += kOl * (z - oh - ol);
      return ol * 0.5;
    },
  };
}

function makeAmp(sr, dsp) {
  const gKey = svf(sr).set(100, 0.7071), tight = svf(sr);
  // gate: the key's peak (instant up, 10 ms down), a state with hysteresis and a hold, the gain's own ramps
  let gEnv = 0, gOpen = false, gHold = 0, gGain = 1;
  const gDown = Math.exp(-1 / (0.010 * sr)), gAt = 1 - Math.exp(-1 / (0.0005 * sr)), gRel = 1 - Math.exp(-1 / (0.060 * sr)), HOLD = Math.round(0.030 * sr);
  let thr = 0, gateOn = false;
  const os4 = dsp.oversample4x(), c4 = chain(sr * 4, sr), c8 = chain(sr * 8, sr), in8 = over2((u) => c8.tick(u));
  const f4 = (u) => c4.tick(u);
  let q8 = false;
  return {
    latency: 28,
    set(P) {
      gateOn = P.gate > -95.5; thr = dbg(P.gate);
      tight.set(P.tight, 0.7071);
      q8 = P.quality === 1;
      (q8 ? c8 : c4).set(P);
    },
    tick(x) {
      if (gateOn) {
        gKey.tick(x);
        const k = gKey.hp, a = k < 0 ? -k : k;
        gEnv = a > gEnv ? a : gEnv * gDown;
        if (gEnv > thr) { gOpen = true; gHold = HOLD; } else if (gOpen && gEnv < thr * 0.5) { if (gHold > 0) gHold--; else gOpen = false; }
        gGain += ((gOpen ? 1 : 0) - gGain) * (gOpen ? gAt : gRel);
        x *= gGain;
      }
      tight.tick(x);
      x = tight.hp;
      return q8 ? c8.post(os4.process(x, in8)) : c4.post(os4.process(x, f4));
    },
  };
}
`;

// The cab: the bank's IRs through dsp.convolver (direct: 128, so no latency), or the designed Filter 4x12, or nothing.
// A change of cab crossfades over 30 ms (two convolvers, the new one planned in place). Without the bank (loading, or
// not on this server) every IR choice plays the filter cab, at the IR cabs' level (spec R22).
// the filter cab's level (dB) against the IR cabs': within 1 LU of the close dynamic on the chug, the chords and the
// DI strum through Half Stack (measured: -0.4, -0.3 and +0.7 LU; tools/cab-test.js holds it)
export const FILTER_TRIM = -0.7;
export const CAB_LIB = String.raw`
const CAB_N = 6, CAB_FILTER = ${CAB_FILTER}, CAB_OFF = ${CAB_OFF}, CAB_TAPS = 4096;
function makeCab(sr, dsp, bank) {
  // the bank's taps (each x / 8388608 * gain); a bank at another rate than the host's is not used (the filter cab is)
  const taps = [];
  if (bank && bank.samples && bank.sr === sr) {
    for (let i = 0; i < CAB_N; i++) {
      const s = bank.samples[i];
      if (!s) { taps.push(null); continue; }
      const c = s.ch[0], g = (+s.gain || 1) / 8388608, h = new Float64Array(Math.min(CAB_TAPS, c.length));
      for (let k = 0; k < h.length; k++) h[k] = c[k] * g;
      taps.push(h);
    }
  }
  const have = (i) => i < CAB_N && !!taps[i];
  const conv = have(0) || have(1) || have(2) || have(3) || have(4) || have(5)
    ? [dsp.convolver(new Float64Array(CAB_TAPS), { direct: 128 }), dsp.convolver(new Float64Array(CAB_TAPS), { direct: 128 })] : null;
  // the filter cab: high-pass 80 Hz, +4 dB at 110 Hz, -3 dB at 400 Hz, +3 dB at 2.5 kHz, then 12 dB/oct from 5 kHz
  const fHp = svf(sr), fLo = svf(sr), fMid = svf(sr), fHi = svf(sr), fLp = svf(sr);
  fHp.set(80, 0.7071); fLo.bell(110, 1.4, 4); fMid.bell(400, 1.0, -3); fHi.bell(2500, 1.2, 3); fLp.set(5000, 0.7071);
  const FILTER_TRIM = dbg(${FILTER_TRIM});
  const filt = (x) => { fHp.tick(x); let y = fLo.eq(fHp.hp); y = fMid.eq(y); y = fHi.eq(y); return fLp.tick(y) * FILTER_TRIM; };
  // what plays: a slot (0, 1: a convolver; 2: the filter; 3: off), and the one fading out over 30 ms (linearly: two
  // cabs on one signal are nearly in phase, so an equal-power fade would swell)
  let A = new Float64Array(128), B = new Float64Array(128);
  let cur = -1, curSlot = 3, prevSlot = -1, fade = 0;
  const FADE = Math.round(0.03 * sr);
  const run = (slot, x, n) => {
    if (slot === 3) return;
    if (slot === 2) { for (let i = 0; i < n; i++) x[i] = filt(x[i]); return; }
    conv[slot].process(x, x, null, n);
  };
  return {
    // what a CAB choice plays here: 'ir' when the bank has it, else 'filter' (or 'off')
    plays(c) { return c === CAB_OFF ? 'off' : have(c) ? 'ir' : 'filter'; },
    set(c, now) {
      c = c | 0;
      if (c === cur) return;
      const first = cur < 0;
      cur = c;
      let slot;
      if (c === CAB_OFF) slot = 3;
      else if (!have(c)) slot = 2;
      else { slot = curSlot === 0 ? 1 : 0; conv[slot].reset(); conv[slot].set(taps[c]); }
      if (first || now) { curSlot = slot; prevSlot = -1; fade = 0; return; }
      prevSlot = curSlot; curSlot = slot; fade = FADE;
    },
    // x: n samples, in place
    process(x, n) {
      if (fade <= 0) { run(curSlot, x, n); return; }
      if (A.length < n) { A = new Float64Array(n); B = new Float64Array(n); }
      for (let i = 0; i < n; i++) { A[i] = x[i]; B[i] = x[i]; }
      run(curSlot, A, n); run(prevSlot, B, n);
      for (let i = 0; i < n; i++) {
        const g = fade > 0 ? fade / FADE : 0;
        if (fade > 0) fade--;
        x[i] = A[i] + (B[i] - A[i]) * g;
      }
    },
  };
}
`;
