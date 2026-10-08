// @ts-check
// The sampled-instrument kernel: plays a melodic kit (kernel data, docs/DEVICES.md "Kernel data" and "Melodic kits")
// across the keyboard. A device is `samplerKernel(opts)` plus its kit's hash; core.upright (Upright) is the first.
//
// What a melodic kit's samples carry (optional fields in the .odk header: old kits parse exactly as before):
//   key            the note the sample was recorded at (pitch_keycenter, MIDI)
//   lo, hi         the keys it plays (lokey, hikey; default key..key)
//   vlo, vhi       the velocities it plays, 0..127 (lovel, hivel; default 0..127)
//   rr             its round robin, 0-based, among the samples that share its keys and velocities (default 0)
//   trig           'attack' (default) or 'release': a release sample sounds when the key lifts
//   tune           cents, measured: added to the pitch (never fixed by resampling at build)
//   gain           dB back to the level the instrument wants (stored samples may be normalized)
//   start          the frame it starts from (default 0)
//   loop           { s, e, mode: 'continuous' | 'sustain' }: frames; 'sustain' loops while the key is held, then plays
//                  on to the end; any crossfade is already in the samples (the kernel jumps)
//   cutoff         Hz: a 2-pole low pass on this sample (SFZ fil_type=lpf_2p)
// and its meta: { kind: 'melodic', velcurve: [[vel, dB], ...] (the level a velocity plays at, through those points;
// default the SFZ curve, 40 log10(vel / 127)), env: { a, r } (seconds: the attack ramp and the release's T60),
// rt: { decay } (dB per second the key was held, off a release sample's level) }.
//
// How it plays:
//   pitch      by resampling with a 16-tap windowed sinc (Kaiser, beta 8, cut at 0.44 of the kit's rate), 512 phases
//              linearly interpolated. The table is computed in create() with + - * / and sqrt only (its own sine and
//              Bessel series), so it is the same numbers on every engine. Measured against the drum kit's 4-point
//              Hermite, a tone moved up 3 semitones: spurious content -78 / -91 / -85 / -80 dB at 1 / 5 / 10 / 15 kHz
//              (Hermite: -78 / -49 / -29 / -17), 1.1 dB droop at 18 kHz. Its limit: the cut is fixed, so moving a
//              sample up by r folds the kit's content above (kit rate / 2) / r back under Nyquist; within a zone (a
//              few semitones) that is above 20 kHz.
//   velocity   picks the layer; within `xfade` (velocity units) of a boundary between two layers both play, at
//              equal power or linearly (the device says which); the level follows the kit's velocity curve, scaled
//              by DYNAMICS
//   round robin  among a layer's samples by the instance's seed, never the same one twice running
//   envelope   a short attack ramp from the start point; at note-off an exponential release (RELEASE: seconds to
//              -60 dB); a release sample, if the kit has them, sounds at the level the note had decayed to
//   voices     the host's: poly of them, the oldest stolen (the host fades it in 5 ms); the sustain pedal is the
//              host's too (note-offs wait while it is down)
// Params it reads: tune (cents), release (s), dynamics (%), tone (%: a tilt around 900 Hz), level (dB).
import { kernel } from './lib.js';

// opts: { makeup (linear gain on the kit), poly, xfade (velocity units, 0..127), law: 'power' (layers that are
// unlike each other: equal power) | 'linear' (layers alike at the attack, whose amplitudes add) | 'aligned' (two
// samples of the same note that the kit's build lined up in time, their correlation there in the soft one's `align`:
// weights that keep the sum's power constant for that correlation, so linear at 1 and equal power at 0; any other
// pair, equal power) }
export function samplerKernel({ makeup = 1, poly = 32, xfade = 6, law = 'power' } = {}) {
  return kernel(String.raw`
const MAKEUP = ${JSON.stringify(makeup)};
const XF = ${JSON.stringify(xfade)};
const LAW = ${JSON.stringify(law)};
const KN = 1 / 32768;
// the windowed-sinc table, from + - * / and sqrt alone: the same numbers in every engine
const T = 16, HALF = 8, P = 512;
const dsin = (x) => {
  const k = Math.round(x / (2 * Math.PI)); x -= k * 2 * Math.PI;
  if (x > Math.PI / 2) x = Math.PI - x; else if (x < -Math.PI / 2) x = -Math.PI - x;
  const x2 = x * x; let term = x, s = x;
  for (let n = 1; n < 12; n++) { term *= -x2 / ((2 * n) * (2 * n + 1)); s += term; }
  return s;
};
const bi0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / 2 / k) * (x / 2 / k); s += t; } return s; };
function sincTable() {
  const tab = new Float64Array((P + 1) * T), FC = 0.44, BETA = 8, ib = bi0(BETA);
  for (let ph = 0; ph <= P; ph++) {
    const f = ph / P; let sum = 0;
    for (let j = 0; j < T; j++) {
      const x = j - (HALF - 1) - f, u = x / HALF;
      const w = u <= -1 || u >= 1 ? 0 : bi0(BETA * Math.sqrt(1 - u * u)) / ib;
      const v = (x === 0 ? 2 * FC : dsin(2 * Math.PI * FC * x) / (Math.PI * x)) * w;
      tab[ph * T + j] = v; sum += v;
    }
    for (let j = 0; j < T; j++) tab[ph * T + j] /= sum;
  }
  // whole positions read the sample itself, exactly
  for (const ph of [0, P]) for (let j = 0; j < T; j++) tab[ph * T + j] = j === (ph ? HALF : HALF - 1) ? 1 : 0;
  return tab;
}
const dbx = (d) => Math.pow(10, d / 20);

return {
  poly: ${JSON.stringify(poly)},
  create({ sr, seed, data }) {
    const kit = data && data.kit;
    if (!kit || !kit.samples || !kit.samples.length) return { voice() { return { start() {}, release() {}, render() { return false; } }; } };
    const TAB = sincTable();
    const meta = kit.meta || {}, RATE = kit.sr / sr;
    const VC = Array.isArray(meta.velcurve) && meta.velcurve.length > 1 ? meta.velcurve : null;
    const velDb = (v) => {
      if (!VC) return 40 * Math.log10((v < 1 ? 1 : v) / 127);
      if (v <= VC[0][0]) return VC[0][1];
      for (let i = 1; i < VC.length; i++) if (v <= VC[i][0]) { const u = (v - VC[i - 1][0]) / (VC[i][0] - VC[i - 1][0]); return VC[i - 1][1] + (VC[i][1] - VC[i - 1][1]) * u; }
      return VC[VC.length - 1][1];
    };
    const ATT = Math.max(1, Math.round(((meta.env && meta.env.a) || 0.001) * sr));
    const RT = (meta.rt && meta.rt.decay) || 0;
    // every sample as the kernel reads it
    const S = kit.samples.map((s) => {
      const key = s.key | 0, n = s.frames;
      const lp = s.cutoff > 0 && s.cutoff < sr * 0.45 ? (() => {
        // RBJ low pass, Q 0.707, at the host's rate (the filter runs on the output)
        const w = 2 * Math.PI * s.cutoff / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
        return { b0: (1 - cs) / 2 / a0, b1: (1 - cs) / a0, b2: (1 - cs) / 2 / a0, a1: -2 * cs / a0, a2: (1 - al) / a0 };
      })() : null;
      const loop = s.loop && s.loop.e > s.loop.s + 16 && s.loop.e <= n ? { s: s.loop.s, e: s.loop.e, sus: s.loop.mode === 'sustain' } : null;
      return { L: s.ch[0], R: s.ch[1] || s.ch[0], n, key, lo: s.lo == null ? key : s.lo, hi: s.hi == null ? key : s.hi,
        vlo: s.vlo == null ? 0 : s.vlo, vhi: s.vhi == null ? 127 : s.vhi, rr: s.rr | 0, rel: s.trig === 'release',
        tune: +s.tune || 0, g: dbx(+s.gain || 0), align: +s.align || 0, at: Number.isInteger(s.start) && s.start > 0 && s.start < n ? s.start : 0, loop, lp };
    });
    // per key: its layers in velocity order, each { vlo, vhi, rr: [sample, ...] } (attack samples), and its release
    // samples the same way
    const layersOf = (rel) => {
      const out = [];
      for (let k = 0; k < 128; k++) {
        const by = new Map();
        for (const s of S) if (s.rel === rel && k >= s.lo && k <= s.hi) {
          const id = s.vlo + ':' + s.vhi;
          if (!by.has(id)) by.set(id, { vlo: s.vlo, vhi: s.vhi, rr: [], last: -1 });
          by.get(id).rr.push(s);
        }
        const L = [...by.values()].sort((a, b) => a.vlo - b.vlo || a.vhi - b.vhi);
        for (const l of L) l.rr.sort((a, b) => a.rr - b.rr);
        out.push(L);
      }
      return out;
    };
    const KEYS = layersOf(false), RELS = layersOf(true);
    // the round robins: one seeded draw per pick, never the sample that played last on that layer
    const RR = new Uint32Array(1); RR[0] = (seed ^ 0x51ab) >>> 0 || 11;
    const draw = () => (RR[0] = (Math.imul(RR[0], 1664525) + 1013904223) >>> 0) / 4294967296;
    // (a layer is one key's: each key keeps its own last pick)
    const pick = (lay) => {
      const n = lay.rr.length;
      if (n === 1) return lay.rr[0];
      const q = lay.last < 0 ? Math.floor(draw() * n) : (lay.last + 1 + Math.floor(draw() * (n - 1))) % n;
      lay.last = q;
      return lay.rr[q];
    };
    // two layers at once: weights by the law (a layer's samples share their key, so its first one stands for it)
    const pair = (out, a, b, u) => {
      let wa = 1 - u, wb = u;
      if (LAW === 'power') { wa = Math.sqrt(wa); wb = Math.sqrt(wb); }
      else if (LAW === 'aligned') {
        const x = a.rr[0], y = b.rr[0], rho = x.key === y.key ? Math.min(1, Math.max(0, x.align || y.align || 0)) : 0;
        const k = 1 / Math.sqrt(wa * wa + wb * wb + 2 * wa * wb * rho);
        wa *= k; wb *= k;
      }
      out[0] = a; out[1] = wa; out[2] = b; out[3] = wb;
      return 2;
    };
    // the layers (and weights, by the law) a velocity plays on: [[layer, weight], ...] into out; returns the count
    const choose = (L, v, out) => {
      if (!L.length) return 0;
      let i = L.length - 1;
      for (let j = 0; j < L.length; j++) if (v <= L[j].vhi) { i = j; break; }
      const cur = L[i];
      if (XF > 0 && i > 0 && v < cur.vlo + XF && L[i - 1].vhi < cur.vlo) {
        const b = (L[i - 1].vhi + cur.vlo) / 2, u = Math.min(1, Math.max(0, (v - (b - XF)) / (2 * XF)));
        if (u < 1) return pair(out, L[i - 1], cur, u);
      }
      if (XF > 0 && i < L.length - 1 && v > cur.vhi - XF && L[i + 1].vlo > cur.vhi) {
        const b = (cur.vhi + L[i + 1].vlo) / 2, u = Math.min(1, Math.max(0, (v - (b - XF)) / (2 * XF)));
        if (u > 0) return pair(out, cur, L[i + 1], u);
      }
      out[0] = cur; out[1] = 1; return 1;
    };

    // one read of a sample: the interpolated frame at pos into rd.l, rd.r
    const readAt = (rd, s, pos, looping) => {
      const ip = Math.floor(pos), fr = pos - ip;
      const end = looping ? s.loop.e : s.n;
      if (fr === 0 && ip < end) { rd.l = s.L[ip]; rd.r = s.R[ip]; return; }
      const ph = fr * P, k = Math.floor(ph), a = ph - k, o0 = k * T, o1 = o0 + T, b = ip - HALF + 1;
      let l = 0, r = 0;
      if (b >= 0 && b + T <= end) {
        for (let j = 0; j < T; j++) { const c = TAB[o0 + j] + (TAB[o1 + j] - TAB[o0 + j]) * a, x = b + j; l += s.L[x] * c; r += s.R[x] * c; }
      } else {
        const span = looping ? s.loop.e - s.loop.s : 0;
        for (let j = 0; j < T; j++) {
          let x = b + j;
          if (looping) while (x >= end) x -= span;
          if (x < 0 || x >= s.n) continue;
          const c = TAB[o0 + j] + (TAB[o1 + j] - TAB[o0 + j]) * a;
          l += s.L[x] * c; r += s.R[x] * c;
        }
      }
      rd.l = l; rd.r = r;
    };

    // the tone tilt and the output's safety
    let lpL = 0, lpR = 0;
    const aLP = 1 - Math.exp(-2 * Math.PI * 900 / sr);

    function voice() {
      // up to three reads: two attack layers (a crossfade) and a release sample
      const mk = () => ({ s: null, g: 0, pos: 0, rate: 1, on: false, z1l: 0, z2l: 0, z1r: 0, z2r: 0, l: 0, r: 0 });
      const rd = [mk(), mk(), mk()];
      const tmp = [null, 0, null, 0];
      const EB = new Float64Array(1024);
      let key = 60, vel = 0, gVel = 1, held = false, relK = 1, env = 1, att = 0, heldFor = 0, on = false;
      const begin = (R, s, g) => { R.s = s; R.g = g * s.g; R.pos = s.at; R.on = true; R.z1l = R.z2l = R.z1r = R.z2r = 0; };
      return {
        start(pitch, v, p) {
          key = pitch < 0 ? 0 : pitch > 127 ? 127 : pitch | 0; vel = v < 0 ? 0 : v > 1 ? 1 : v;
          rd[0].on = rd[1].on = rd[2].on = false;
          on = false; held = true; env = 1; att = 0; heldFor = 0; relK = 1;
          const v127 = vel * 127;
          gVel = dbx(velDb(v127) * p.dynamics / 100);
          const n = choose(KEYS[key], v127, tmp);
          for (let k = 0; k < n; k++) begin(rd[k], pick(tmp[2 * k]), tmp[2 * k + 1]);
          on = n > 0;
        },
        release(p) {
          if (!held) return;
          held = false;
          relK = Math.exp(Math.log(0.001) / (Math.max(0.01, p.release) * sr));
          // a release sample, at the level the note had decayed to (rt decay, dB per second held)
          const L = RELS[key];
          if (L.length && on) {
            const n = choose(L, vel * 127, tmp);
            if (n) begin(rd[2], pick(tmp[0]), tmp[1] * dbx(-RT * heldFor / sr));
          }
        },
        stop() { on = false; rd[0].on = rd[1].on = rd[2].on = false; },
        render(Lo, Ro, n, p, t) {
          if (!on) return false;
          // the note's envelope for this block, shared by its attack reads: the ramp in, then the release
          let e = env, a = att;
          for (let i = 0; i < n; i++) { if (!held) e *= relK; let k = e; if (a < ATT) { k *= a / ATT; a++; } EB[i] = k; }
          env = e; att = a;
          const g0 = MAKEUP * KN * gVel * dbx(p.level);
          const shift = RATE * Math.pow(2, (p.tune / 100 + (t ? t.bend || 0 : 0)) / 12);
          let alive = false;
          for (let q = 0; q < 3; q++) {
            const R = rd[q];
            if (!R.on) continue;
            const s = R.s, lp = s.lp, rate = shift * Math.pow(2, (key - s.key + s.tune / 100) / 12), g = g0 * R.g, rel = q === 2;
            let pos = R.pos, z1l = R.z1l, z2l = R.z2l, z1r = R.z1r, z2r = R.z2r;
            for (let i = 0; i < n; i++) {
              const looping = s.loop !== null && (!s.loop.sus || held);
              if (looping && pos >= s.loop.e) pos -= s.loop.e - s.loop.s;
              if (pos >= s.n) { R.on = false; break; }
              readAt(R, s, pos, looping);
              let l = R.l, r = R.r;
              if (lp !== null) {
                const yl = lp.b0 * l + z1l; z1l = lp.b1 * l - lp.a1 * yl + z2l; z2l = lp.b2 * l - lp.a2 * yl; l = yl;
                const yr = lp.b0 * r + z1r; z1r = lp.b1 * r - lp.a1 * yr + z2r; z2r = lp.b2 * r - lp.a2 * yr; r = yr;
              }
              // (a release sample plays out at its own level; the attack reads follow the note's envelope)
              const k = rel ? g : g * EB[i];
              Lo[i] += l * k; Ro[i] += r * k;
              pos += rate;
            }
            R.pos = pos; R.z1l = z1l; R.z2l = z2l; R.z1r = z1r; R.z2r = z2r;
            if (R.on) alive = true;
          }
          if (held) heldFor += n;
          // the attack reads end 80 dB down their release; a release read, at its end
          if (!held && env < 1e-4) { rd[0].on = false; rd[1].on = false; alive = rd[2].on; }
          if (!alive) on = false;
          return alive;
        },
      };
    }
    return {
      voice,
      process(L, R, n, p) {
        const T2 = p.tone / 100;
        const gh = Math.pow(10, T2 * 6 / 20), gl = 1 / gh, flat = T2 > -1e-4 && T2 < 1e-4;
        for (let i = 0; i < n; i++) {
          let l = L[i], r = R[i];
          lpL += aLP * (l - lpL); lpR += aLP * (r - lpR);
          if (!flat) { l = lpL * gl + (l - lpL) * gh; r = lpR * gl + (r - lpR) * gh; }
          L[i] = knee(l); R[i] = knee(r);
        }
      },
    };
  },
};
`);
}

// The params samplerKernel reads, with a device's own defaults (keys are forever).
export function samplerParams({ release = 0.6, dynamics = 100, tone = 0, level = 0 } = {}) {
  return [
    { key: 'dynamics', label: 'DYNAMICS', min: 0, max: 150, def: dynamics, unit: '%', role: 'sens', group: 'play', desc: 'how far soft notes fall below hard ones: 100% is the instrument as sampled, 0% plays every velocity at one level' },
    { key: 'release', label: 'RELEASE', min: 0.05, max: 6, def: release, curve: 'log', unit: 's', role: 'release', group: 'play', desc: 'how long a note takes to die away once the key (and the pedal) lifts, seconds to -60 dB' },
    { key: 'tune', label: 'TUNE', min: -100, max: 100, def: 0, unit: 'ct', role: 'pitch', group: 'play', desc: 'the whole instrument up or down, cents (by resampling)' },
    { key: 'tone', label: 'TONE', min: -100, max: 100, def: tone, unit: '%', role: 'tone', group: 'out', desc: 'a tilt around 900 Hz: below 0 darker, above 0 brighter (up to 6 dB each way at the ends); 0 is the recording' },
    { key: 'level', label: 'LEVEL', min: -24, max: 6, def: level, unit: 'dB', role: 'level', group: 'out', desc: 'the whole instrument' },
  ];
}
