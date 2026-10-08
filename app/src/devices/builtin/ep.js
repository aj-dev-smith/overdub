// @ts-check
// core.ep: Suitcase. Electric pianos built the way the real ones make their sound, not the way FM imitates it:
//   TINE   a struck steel tine (a near-sine, a short inharmonic ping at about 7x for the strike, and its tone bar a
//          hair apart, so long notes breathe), read by a magnetic pickup: the tine's tip swings through the pickup's
//          field, a soft and lopsided curve, and the coil puts out the rate of change of what it sees. VOICING moves
//          the tine off the pickup's centre, which is where the bark lives: centred is round (mostly odd harmonics,
//          and few of them), offset is the classic growl (strong 2nd and 3rd). Play harder and the tine swings further
//          into the curve, so velocity changes the colour, not just the level. Two-stage decay: a prompt bloom, then a
//          long aftersound, longer in the bass.
//   REED   a struck steel reed (its 6.27x cantilever mode is the clank) read by an electrostatic pickup: the reed
//          is one plate of a capacitor, so the curve is steeply lopsided (1 / distance) and the bark comes in sharply
//          as you dig in. Shorter sustain, and the tremolo is mono, as on the classic school-room piano.
//   FM     the 80s ballad electric piano: two operator stacks, one 1:1 (the body, its index falling as the note
//          settles) and one 14:1 (the tinkle on the strike). Lamp Tines plays the older, simpler version of this.
// The pickup is a degree-9 Chebyshev fit of the curve, so a sine through it makes harmonics 1-9 and nothing above:
// the bark can't alias below the top octave. Then the suitcase: a preamp that drives into a soft clip (2x
// oversampled), the speaker's roll-off, a treble control and the tremolo (stereo pan for TINE and FM, mono for REED).
// About -16 LUFS on the test phrase at defaults. tools/instruments2-test.js holds it to the roadmap's numbers
// (docs/research/INSTRUMENTS.md, 2.2).
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.ep', name: 'Suitcase', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'Tine and reed electric pianos that bark when you dig in',
  nod: 'tine and reed electric pianos through their pickups, a suitcase amp and tremolo (and the FM one)',
  params: [
    { key: 'voice', label: 'VOICE', opts: ['TINE', 'REED', 'FM'], def: 0, role: 'shape', desc: 'tine piano, reed piano, or the 80s FM one' },
    { key: 'voicing', label: 'VOICING', min: 0, max: 1, def: 0.5, role: 'drive', desc: 'round to barky: how far the tine or reed sits off the pickup' },
    { key: 'bright', label: 'BRIGHT', min: 0, max: 1, def: 0.5, role: 'tone', desc: 'the treble: dark and woolly to glassy, with more of the strike' },
    { key: 'decay', label: 'DECAY', min: 0.3, max: 2.5, def: 1, unit: 'x', role: 'decay', desc: 'how long notes ring' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.2, role: 'drive', desc: 'the suitcase preamp: clean to crunchy' },
    { key: 'trem', label: 'TREM', min: 0, max: 1, def: 0.25, role: 'depth', desc: 'tremolo depth (side to side for TINE and FM, in place for REED)' },
    { key: 'rate', label: 'RATE', min: 0.5, max: 9, def: 4.5, curve: 'log', unit: 'Hz', role: 'rate', desc: 'tremolo speed' },
    { key: 'release', label: 'RELEASE', min: 0.02, max: 2, def: 0.14, curve: 'log', unit: 's', role: 'release', desc: 'how fast the dampers stop a note' },
  ],
  presets: [
    { name: 'Suitcase', params: {} },
    { name: 'Stage', params: { voice: 0, voicing: 0.4, trem: 0 } },
    { name: 'Barky', params: { voice: 0, voicing: 0.85, bright: 0.6, drive: 0.45, trem: 0 } },
    { name: 'Wurli', params: { voice: 1, voicing: 0.5, drive: 0.5, trem: 0.3, rate: 5.5 } },
    { name: 'Dusty loop', params: { voice: 0, voicing: 0.2, bright: 0.3, trem: 0.15 } },
    { name: 'Ballad FM', params: { voice: 2, bright: 0.55, trem: 0.2, rate: 3.2 } },
  ],
  look: { color: '#26221f', ink: '#ece3cf', shape: 'wide', finish: 'flat', knob: 'chrome', label: 'script', led: '#ff7a45' },
  tail: 8,
  kernel: kernel(String.raw`
const DEG = 9, M = 40;
// the pickups, as curves of the tine or reed's excursion u (-1..1); each has slope 1 at rest
function tineCurve(v) {
  const a = 1 + 11 * v, o = (0.1 + 1.1 * v) / a, t0 = Math.tanh(a * o), s = a * (1 - t0 * t0);
  return (u) => (Math.tanh(a * (u + o)) - t0) / s;
}
function reedCurve(v) {
  const k = 0.2 + 0.55 * v, d = 1.6 + 2 * v;
  return (u) => Math.tanh(d * u / (1 - k * u)) / d;
}
return {
  poly: 16,
  create({ sr, seed }) {
    // Chebyshev fits of the two curves, refitted when VOICING moves (shared by every voice)
    const CT = new Float64Array(M * (DEG + 1)), XS = new Float64Array(M);
    for (let j = 0; j < M; j++) { XS[j] = Math.cos(Math.PI * (j + 0.5) / M); for (let k = 0; k <= DEG; k++) CT[j * (DEG + 1) + k] = Math.cos(Math.PI * k * (j + 0.5) / M); }
    const coefs = [new Float64Array(DEG + 1), new Float64Array(DEG + 1)], fitAt = [-1, -1];
    const fit = (kind, v) => {
      if (fitAt[kind] === v) return;
      fitAt[kind] = v;
      const f = kind ? reedCurve(v) : tineCurve(v), c = coefs[kind];
      c.fill(0);
      for (let j = 0; j < M; j++) { const y = f(XS[j]); for (let k = 0; k <= DEG; k++) c[k] += y * CT[j * (DEG + 1) + k]; }
      for (let k = 0; k <= DEG; k++) c[k] *= 2 / M;
    };
    fit(0, 0.5); fit(1, 0.5);
    // the suitcase
    const osL = os2(sat), osR = os2(sat);
    const spL = svf(sr), spR = svf(sr), shL = svf(sr), shR = svf(sr);
    const hpL = onepole(sr).set(35), hpR = onepole(sr).set(35);
    const trS = glide(30, sr), drS = glide(30, sr);
    let trPh = 0;
    return {
      voice(vi) {
        const r = rng((seed ^ 0xe1ec) + vi * 7919);
        let kind = 0, t = 0, f0 = 261.6, pan = [1, 1], rel = false, rk = 1, kr = 0.999, top = 0;
        // the tine / reed: main phase, the tone bar, the ping
        // oscillators are rotating phasors (x = cos, y = sin), kept on the unit circle once a block
        let px = 1, py = 0, rc = 1, rs = 0, phi = 0, dphi = 0, bar = 0, qx = 1, qy = 0, qc = 1, qs = 0, ping = 0, pk = 0;
        let ex = 0, af = 0, as = 0, df = 0, ds = 0, gp = 0, dn = 1, outG = 1, atk = 0, atkD = 1;
        const nz = rng((seed ^ 0x4a3) + vi * 104729);
        let hk = 0, hl = 0, ha = 0, hd = 1;
        // FM
        let c1 = 0, c2 = 0, d1 = 0, d2 = 0, d2b = 0, i1 = 0, i1k = 0, i1f = 0, i2 = 0, i2k = 0, a1f = 0, a1s = 0, a1fk = 0, a1sk = 0, a2 = 0, a2k = 0;
        return {
          start(p, v, P) {
            kind = P.voice | 0; t = 0; rel = false; rk = 1; top = 1;
            f0 = mtof(p);
            const hi = clamp((p - 60) / 36, -1, 1), dec = P.decay, br = P.bright;
            pan = panLR(clamp((p - 64) / 40, -0.45, 0.45));
            kr = coef(Math.max(0.01, P.release) / 4.6, sr);
            atk = 0; atkD = 1 / (0.0007 * sr);
            if (kind === 2) {
              c1 = 0; c2 = 0; px = 1; py = 0; rc = Math.cos(TAU * f0 / sr); rs = Math.sin(TAU * f0 / sr); qx = 1; qy = 0;
              d1 = f0 / sr; d2 = f0 * Math.pow(2, 2.5 / 1200) / sr; d2b = 14 * f0 < sr * 0.4 ? 14 * f0 / sr : 0; qc = Math.cos(TAU * d2b); qs = Math.sin(TAU * d2b);
              const reg = 1 - 0.45 * clamp(hi, 0, 1);
              i1 = (0.25 + 1.5 * Math.pow(v, 1.6) * (0.45 + 1.1 * br)) * reg; i1f = 1; i1k = coef(0.45, sr);
              i2 = d2b ? 1.1 * v * v * (0.35 + 1.3 * br) * (1 - 0.6 * clamp(hi, 0, 1)) : 0; i2k = coef(0.05, sr);
              const ts = 1.1 * Math.pow(2, -(p - 60) / 24) * dec;
              a1f = 0.35; a1s = 0.65; a1fk = coef(0.3 * dec, sr); a1sk = coef(ts, sr);
              a2 = 0.45; a2k = coef(0.35 * Math.pow(2, -(p - 60) / 30) * dec, sr);
              outG = 0.42 * (0.08 + 0.92 * Math.pow(v, 1.3));
              return;
            }
            fit(kind, P.voicing);
            px = 1; py = 0; rc = Math.cos(TAU * f0 / sr); rs = Math.sin(TAU * f0 / sr);
            // the tone bar sits a hair from the tine (seeded per key-voice), weak: a slow breathing on long notes
            phi = Math.PI / 2; dphi = TAU * f0 * (0.0009 + 0.0007 * (r() + 1) / 2) * (r() > 0 ? 1 : -1) / sr; bar = kind ? 0 : 0.06;
            // the strike's inharmonic mode: the tine's ~7.1x, the reed's 6.27x (cantilever), gone in tens of ms
            const pr = kind ? 6.27 : 7.1 * (1 + 0.004 * r());
            const dphp = pr * f0 < sr * 0.42 ? pr * f0 / sr : 0;
            qx = 1; qy = 0; qc = Math.cos(TAU * dphp); qs = Math.sin(TAU * dphp);
            ping = dphp ? (kind ? 0.16 : 0.42) * Math.pow(v, kind ? 1.5 : 2) * (0.35 + 1.3 * br) * (1 + 0.6 * clamp(hi, 0, 1)) : 0;
            pk = coef((kind ? 0.018 : 0.03) * (1 - 0.4 * clamp(hi, 0, 1)), sr);
            // the swing: harder goes further into the pickup's curve; short high tines swing less
            ex = (kind ? 0.9 : 0.95) * Math.pow(v, kind ? 0.9 : 0.65) * (1 - (kind ? 0.25 : 0.3) * clamp(hi, 0, 1));
            // two-stage decay: a prompt bloom, then the aftersound (longer in the bass)
            const ts = (kind ? 0.75 : 1.35) * Math.pow(2, -(p - 60) / (kind ? 22 : 24)) * dec;
            af = kind ? 0.5 : 0.6; as = 1 - af; df = coef((kind ? 0.18 : 0.24) * Math.sqrt(dec), sr); ds = coef(ts, sr);
            // the curve's value at rest (the series without its constant: -c2 + c4 - c6 + c8), so the first sample's
            // rate of change is the tine's, not a step from zero
            { const c = coefs[kind]; gp = -c[2] + c[4] - c[6] + c[8]; }
            dn = 1 / (2 * Math.sin(Math.PI * Math.min(f0, sr * 0.2) / sr));
            // level: harder is louder as well as brighter; the tine's bark makes the treble louder for the same swing, so a
            // gentle tilt (and a lift for the shortest tines) keeps the keyboard even, by loudness and by peak
            outG = (kind ? 0.68 : 0.8) * (kind ? 0.45 + 0.55 * v : 0.12 + 0.88 * Math.pow(v, 1.4)) * (kind ? 1 : Math.pow(2, -clamp(p - 60, -36, 24) / 144) * (1 + 0.5 * clamp((p - 84) / 12, 0, 1)));
            // the hammer: a short soft thump (neoprene on a tine, felt on a reed)
            hl = 0; hk = 1 - Math.exp(-TAU * (600 + 2400 * v * (0.5 + br)) / sr); ha = 0.25 * v * v * (0.4 + br); hd = coef(0.0016, sr);
          },
          release() { rel = true; },
          render(L, R, n, P) {
            if (kind === 2) {
              let lv = 0;
              for (let i = 0; i < n; i++, t++) {
                if (atk < 1) atk = Math.min(1, atk + atkD);
                c1 += d1; if (c1 >= 1) c1 -= 1;
                const nx = px * rc - py * rs; py = px * rs + py * rc; px = nx;
                c2 += d2; if (c2 >= 1) c2 -= 1;
                i1f *= i1k;
                let q = c1 + i1 * (0.3 + 0.7 * i1f) * py / TAU; q -= Math.floor(q);
                let y = sinT(q) * (a1f + a1s);
                let q2 = c2;
                if (i2) { const mx = qx * qc - qy * qs; qy = qx * qs + qy * qc; qx = mx; i2 *= i2k; if (i2 < 1e-4) i2 = 0; q2 += i2 * qy / TAU; q2 -= Math.floor(q2); }
                y += sinT(q2) * a2 * 0.55;
                a1f *= a1fk; a1s *= a1sk; a2 *= a2k;
                let e = a1f + a1s + a2 * 0.55;
                if (rel) { rk *= kr; y *= rk; e *= rk; }
                y *= atk * outG;
                L[i] += y * pan[0]; R[i] += y * pan[1];
                if (i === 0) lv = e;
              }
              top = lv * outG;
              { const m = Math.sqrt(px * px + py * py) || 1; px /= m; py /= m; const q = Math.sqrt(qx * qx + qy * qy) || 1; qx /= q; qy /= q; }
              return !(top < 2e-5 && t > 64);
            }
            const c = coefs[kind];
            const cb = Math.cos(phi), sb = Math.sin(phi); phi += dphi * n; if (phi > TAU) phi -= TAU; else if (phi < -TAU) phi += TAU;
            if (fitAt[kind] !== P.voicing) fit(kind, P.voicing);
            let lv = 0;
            for (let i = 0; i < n; i++, t++) {
              if (atk < 1) atk = Math.min(1, atk + atkD);
              const nx = px * rc - py * rs; py = px * rs + py * rc; px = nx;
              // the tine, and its tone bar a hair away in pitch (sin(a + phi), phi drifting slowly)
              const s = bar ? (py + bar * (py * cb + px * sb)) / (1 + bar) : py;
              af *= df; as *= ds;
              let a = ex * (af + as) * atk;
              if (rel) { rk *= kr; a *= rk; }
              let u = a * s; u = u > 1 ? 1 : u < -1 ? -1 : u;
              // Clenshaw: the curve's Chebyshev series at u (the constant term drops out of the derivative)
              const x2 = 2 * u;
              let b1 = c[DEG], b2 = 0;
              for (let k = DEG - 1; k >= 1; k--) { const b0 = x2 * b1 - b2 + c[k]; b2 = b1; b1 = b0; }
              const g = u * b1 - b2;
              // the coil: the rate of change of the field (normalised so the fundamental keeps its level)
              let y = (g - gp) * dn; gp = g;
              if (ping) { const mx = qx * qc - qy * qs; qy = qx * qs + qy * qc; qx = mx; y += qy * ping * (rel ? rk : 1); ping *= pk; if (ping < 1e-6) ping = 0; }
              if (ha) { hl += hk * (nz() - hl); y += hl * ha; ha *= hd; if (ha < 1e-6) ha = 0; }
              y *= outG;
              L[i] += y * pan[0]; R[i] += y * pan[1];
              if (i === 0) lv = a;
            }
            top = lv * outG;
            { const m = Math.sqrt(px * px + py * py) || 1; px /= m; py /= m; const q = Math.sqrt(qx * qx + qy * qy) || 1; qx /= q; qy /= q; }
            return !(top < 2e-5 && t > 64);
          },
        };
      },
      // the suitcase: preamp, speaker, treble, tremolo
      process(L, R, n, P) {
        const kind = P.voice | 0, br = P.bright;
        spL.set(4200 + 7000 * br * br, 0.75); spR.set(4200 + 7000 * br * br, 0.75);
        shL.shelfHi(2400, 0.6, (br - 0.5) * 10); shR.shelfHi(2400, 0.6, (br - 0.5) * 10);
        const dt = P.rate / sr, mono = kind === 1;
        for (let i = 0; i < n; i++) {
          const dg = 0.55 + 5 * Math.pow(drS.next(P.drive), 2), mk = Math.pow(0.55 / dg, 0.85) / 0.55;
          let l = osL(L[i] * dg) * mk, r = osR(R[i] * dg) * mk;
          l = hpL.hp(shL.eq(spL.tick(l))); r = hpR.hp(shR.eq(spR.tick(r)));
          trPh += dt; if (trPh >= 1) trPh -= 1;
          const d = trS.next(P.trem) * 0.9, s = sinT(trPh);
          if (mono) { const g = 1 - d * (0.5 + 0.5 * s); l *= g; r *= g; }
          else { l *= 1 - d * (0.5 + 0.5 * s); r *= 1 - d * (0.5 - 0.5 * s); }
          const OUT = 0.62 / (1 - 0.32 * d);
          L[i] = knee(l * OUT); R[i] = knee(r * OUT);
        }
      },
    };
  },
};
`),
});
