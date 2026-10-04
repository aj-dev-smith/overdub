// core.organ: Rotor Cabinet. A tonewheel organ through a rotating speaker.
//   WHEELS    nine footages per key (16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1'), each a sine tuned to the
//             equal-tempered note the real drawbar plays (so the fifths and thirds are tempered and beat slowly against
//             the octaves, as on the real thing), folded back an octave at the ends of the wheel set. REGISTER picks a
//             drawbar setting.
//   KEYS      the nine contacts close a fraction of a millisecond apart, each at whatever phase its wheel is in: that
//             is the key click, and CLICK adds the contacts' crackle. Playing harder clicks more and pulls the upper
//             footages up a touch (a real tonewheel has no velocity; this one lets a keyboard's touch through).
//   PERC      the classic percussion: the 4' or 2 2/3' wheel struck and decaying, only when no other key is held
//             (single trigger), so legato lines don't retrigger it.
//   CABINET   the tube preamp (DRIVE, 2x oversampled), then the rotating speaker: an 800 Hz crossover, a horn and a
//             drum spinning at their own speeds with their own inertia (the horn gets to speed in about a second, the
//             drum takes several), each with Doppler (a swept delay) and its throw (level), two mics left and right.
//             ROTOR switches SLOW, FAST or BRAKE (stopped); the change ramps like the motors do.
// About -16 LUFS on the test phrase at defaults. tools/instruments-test.js measures the rest.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.organ', name: 'Rotor Cabinet', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'Tonewheel organ: drawbars, percussion, a spinning cabinet',
  nod: 'a tonewheel organ with a rotating speaker cabinet',
  params: [
    { key: 'reg', label: 'REGISTER', opts: ['FLUTE', 'BALLAD', 'JAZZ', 'GOSPEL', 'FULL'], def: 2, role: 'shape', desc: 'drawbar settings: 008400000, 688600000, 888000000, 888800008, 888888888' },
    { key: 'perc', label: 'PERC', opts: ['OFF', '2ND', '3RD'], def: 0, role: 'shape', desc: 'percussion: a struck, decaying 4\' or 2 2/3\' on the first note of a phrase' },
    { key: 'click', label: 'CLICK', min: 0, max: 1, def: 0.4, role: 'tone', desc: 'the key contacts\' click at the start of each note' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.3, role: 'drive', desc: 'the preamp: clean to growling' },
    { key: 'rotor', label: 'ROTOR', opts: ['SLOW', 'FAST', 'BRAKE'], def: 0, role: 'rate', desc: 'the speaker\'s spin: switch it and the horn and drum ramp' },
    { key: 'cab', label: 'CABINET', min: 0, max: 1, def: 0.85, role: 'mix', desc: 'straight line out to the full rotating cabinet' },
    { key: 'tone', label: 'TONE', min: 0, max: 1, def: 0.55, role: 'tone', desc: 'the expression pedal\'s treble: dark to bright' },
  ],
  presets: [
    { name: 'Gospel', params: { reg: 'GOSPEL', perc: 'OFF', drive: 0.35, rotor: 'FAST' } },
    { name: 'Rock', params: { reg: 'FULL', drive: 0.6, rotor: 'FAST', click: 0.6 } },
    { name: 'Jazz', params: { reg: 'JAZZ', perc: '3RD', drive: 0.15, rotor: 'SLOW' } },
    { name: 'Reggae bubble', params: { reg: 'BALLAD', perc: '2ND', drive: 0, rotor: 'SLOW' } },
  ],
  look: { color: '#5a2f1c', ink: '#f6e2c2', shape: 'wide', finish: 'brushed', knob: 'chicken', label: 'script', led: '#ff9a3d' },
  tail: 1,
  kernel: kernel(String.raw`
// drawbar footages as semitones from the played key, and the registrations (0..8 per drawbar)
const FOOT = [-12, 7, 0, 12, 19, 24, 28, 31, 36];
const REGS = [[0, 0, 8, 4, 0, 0, 0, 0, 0], [6, 8, 8, 6, 0, 0, 0, 0, 0], [8, 8, 8, 0, 0, 0, 0, 0, 0], [8, 8, 8, 8, 0, 0, 0, 0, 8], [8, 8, 8, 8, 8, 8, 8, 8, 8]];
const TRIM = [-1.15, -2.8, -2.75, -4.7, -6.1].map((d) => Math.pow(10, d / 20));   // each registration to the same loudness
const LEVEL = (d) => (d <= 0 ? 0 : Math.pow(2, (d - 8) / 2));     // each drawbar step is 3 dB
return {
  poly: 16,
  create({ sr, seed }) {
    const shared = { held: 0 };
    // the tonewheels: 91 sines, C1 (32.7 Hz) to F#8 (5.9 kHz), turning all the time, every key tapping the same wheels
    // (so two keys that share a footage are phase-locked, as on the real thing). A wheel is a two-multiply sine
    // oscillator, and only the wheels some key is using are turned: one block of each, shared by every key.
    const NW = 91, W0 = 24, B = 128;
    const wc = new Float64Array(NW), wy1 = new Float64Array(NW), wy2 = new Float64Array(NW), wref = new Int32Array(NW);
    const WB = new Float64Array(NW * B);
    const wr = rng(seed ^ 0x3ee1);
    for (let w = 0; w < NW; w++) {
      const om = TAU * mtof(W0 + w) / sr, ph = (wr() + 1) * Math.PI;
      wc[w] = 2 * Math.cos(om); wy1[w] = Math.sin(ph); wy2[w] = Math.sin(ph - om);
    }
    // the wheel a footage plays: the wheel set's ends fold back an octave
    const wheel = (q) => { while (q < W0) q += 12; while (q > W0 + NW - 1) q -= 12; return q - W0; };
    // which stretch of time the wheels' buffers hold. Voices render the same stretch one after another, so a new stretch
    // starts after process(), after a key goes down or up, or when a voice comes round a second time.
    const bank = { range: 0, m: 0, fresh: true };
    function advance(m) {
      bank.range++; bank.m = m; bank.fresh = false;
      for (let w = 0; w < NW; w++) {
        if (!wref[w]) continue;
        const c = wc[w], o = w * B;
        let a = wy1[w], b = wy2[w];
        for (let i = 0; i < m; i++) { const y = c * a - b; b = a; a = y; WB[o + i] = y; }
        wy1[w] = a; wy2[w] = b;
      }
    }
    // the preamp
    let drv = 1, dn = 1;
    const shape = os2((x) => sat(x * drv) / dn);
    const tl = svf(sr);
    // the rotating speaker: crossover, horn and drum delays, their rotors
    const xo = svf(sr);
    const hd = delayLine(Math.ceil(0.006 * sr)), dd = delayLine(Math.ceil(0.006 * sr));
    const hlpA = onepole(sr).set(3800), hlpB = onepole(sr).set(3800);
    let hph = 0.13, dph = 0.61, hHz = 0.8, dHz = 0.7;
    const cabS = glide(30, sr);
    const room = fdn(sr, seed ^ 0x0a6a);
    room.set(0.32, 0.9, 0.5);
    const dc1 = dcblock(sr), dc2 = dcblock(sr);
    const ms = sr / 1000;
    return {
      voice(vi) {
        const r = rng((seed ^ 0x7e3d) + vi * 104729);
        const wi = new Int32Array(9), amp = new Float64Array(9), delay = new Int32Array(9);
        const buf = new Float64Array(B);
        let t = 0, rel = false, relT = 0, g = 0, pAmp = 0, pK = 1, pw = -1, held = false, cl = 0, clK = 0, seen = -1, used = false;
        let ready = 0;   // samples until every contact has closed
        const clf = svf(sr);
        const atkN = 0.0009 * sr;
        const unuse = () => {
          if (used) { for (let k = 0; k < 9; k++) wref[wi[k]]--; used = false; }
          if (pw >= 0) { wref[pw]--; pw = -1; }
        };
        return {
          start(p, v, P) {
            unuse();
            t = 0; rel = false; relT = 0; bank.fresh = true;
            const reg = REGS[P.reg | 0] || REGS[2];
            let norm = 0, last = 0;
            for (let k = 0; k < 9; k++) {
              wi[k] = wheel(p + FOOT[k]);
              wref[wi[k]]++;
              const up = k >= 4 ? 0.75 + 0.5 * v : 1;
              amp[k] = LEVEL(reg[k]) * up;
              norm += amp[k] * amp[k];
              delay[k] = Math.round((0.0002 + 0.0011 * (r() + 1) / 2) * sr);   // contacts close one by one
              if (delay[k] > last) last = delay[k];
            }
            used = true;
            ready = last + Math.ceil(atkN) + 1;
            // a full registration is louder, but not 9 drawbars' worth louder
            g = (0.55 + 0.45 * v) / (0.35 + 0.65 * Math.sqrt(norm)) * (TRIM[P.reg | 0] || 1);
            // percussion: single trigger, struck from the 4' or 2 2/3' wheel
            const pk = P.perc | 0;
            if (pk && shared.held === 0) {
              pw = wheel(p + (pk === 1 ? 12 : 19)); wref[pw]++; pAmp = 0.9; pK = coef(0.5 / 6.91, sr);
            } else pAmp = 0;
            if (!held) { held = true; shared.held++; }
            // the click: a short crackle from the contacts, brighter for higher keys
            cl = P.click * (0.35 + 0.65 * v) * 0.6; clK = coef(0.0035, sr);
            clf.set(clamp(1800 + 20 * mtof(p) / 10, 1800, 6000), 1.4);
          },
          release() { rel = true; bank.fresh = true; if (held) { held = false; shared.held = Math.max(0, shared.held - 1); } },
          render(L, R, n, P) {
            if (bank.fresh || seen === bank.range || bank.m !== n) advance(n);
            seen = bank.range;
            const relK = 1 / (0.006 * sr);
            for (let i = 0; i < n; i++) buf[i] = 0;
            // the drawbars: each footage's wheel, through its contact once it has closed
            for (let k = 0; k < 9; k++) {
              const a = amp[k];
              if (a === 0) continue;
              const o = wi[k] * B;
              if (t >= ready) { for (let i = 0; i < n; i++) buf[i] += WB[o + i] * a; continue; }
              const d = delay[k];
              for (let i = 0; i < n; i++) { let e = (t + i - d) / atkN; e = e < 0 ? 0 : e > 1 ? 1 : e; buf[i] += WB[o + i] * a * e; }
            }
            if (pw >= 0) {
              const o = pw * B;
              for (let i = 0; i < n; i++) { const e = t + i < atkN ? (t + i) / atkN : 1; buf[i] += WB[o + i] * pAmp * e; pAmp *= pK; }
              if (pAmp < 1e-5) { wref[pw]--; pw = -1; pAmp = 0; }
            }
            let alive = true;
            for (let i = 0; i < n; i++) {
              let x = buf[i] * g;
              if (cl > 1e-5) { clf.tick(r()); x += clf.bp * cl; cl *= clK; }
              if (rel) {
                relT += relK;
                if (relT >= 1) { alive = false; x = 0; } else x *= 1 - relT;
              }
              L[i] += x * 0.2; R[i] += x * 0.2;
            }
            t += n;
            if (!alive) unuse();
            return alive;
          },
          stop() { unuse(); if (held) { held = false; shared.held = Math.max(0, shared.held - 1); } },
        };
      },
      process(L, R, n, P) {
        bank.fresh = true;
        // the preamp and the treble (the expression pedal's tone)
        const d = P.drive;
        drv = 1 + 5 * d * d; dn = Math.tanh(Math.min(3, drv * 0.6)) / 0.6 || 1;
        const mk = Math.pow(10, -4.7 * Math.pow(d, 1.7) / 20);
        const tc = 1500 * Math.pow(2, 3.4 * P.tone);
        tl.set(tc, 0.6);
        // the rotors: target speeds, then inertia (horn light, drum heavy)
        const sp = P.rotor | 0;
        const hT = sp === 1 ? 6.8 : sp === 0 ? 0.83 : 0, dT = sp === 1 ? 5.9 : sp === 0 ? 0.68 : 0;
        const hk = 1 - Math.exp(-n / (sr * (hT > hHz ? 0.35 : 0.55))), dk = 1 - Math.exp(-n / (sr * (dT > dHz ? 1.6 : 2.2)));
        hHz += (hT - hHz) * hk; dHz += (dT - dHz) * dk;
        xo.set(800, 0.5);
        const hInc = hHz / sr, dInc = dHz / sr;
        for (let i = 0; i < n; i++) {
          const cab = cabS.next(P.cab);
          const m = (L[i] + R[i]) * 0.5;
          const y = tl.tick(shape(m));
          // crossover
          xo.tick(y);
          const lo = xo.lp, hi = y - lo;
          hph += hInc; if (hph >= 1) hph -= 1;
          dph += dInc; if (dph >= 1) dph -= 1;
          const hs = sinT(hph), hc = sinT(hph + 0.25 >= 1 ? hph - 0.75 : hph + 0.25);
          const ds = sinT(dph), dcs = sinT(dph + 0.25 >= 1 ? dph - 0.75 : dph + 0.25);
          hd.write(hi); dd.write(lo);
          // horn: the mics at left and right see opposite Doppler and throw
          const hL = hd.cubic(2.2 * ms + 0.32 * ms * hs), hR = hd.cubic(2.2 * ms - 0.32 * ms * hs);
          const aL = 0.62 + 0.38 * hc, aR = 0.62 - 0.38 * hc;
          const hornL = hlpA.lp(hL) * (1 - aL) * 0.6 + hL * aL, hornR = hlpB.lp(hR) * (1 - aR) * 0.6 + hR * aR;
          // drum: mostly throw, a little Doppler
          const dL = dd.cubic(2.4 * ms + 0.08 * ms * ds), dR = dd.cubic(2.4 * ms - 0.08 * ms * dcs);
          const drumL = dL * (0.78 + 0.22 * dcs), drumR = dR * (0.78 - 0.22 * ds);
          let wl = hornL * 1.05 + drumL, wr = hornR * 1.05 + drumR;
          const cx = 0.16 * (wr - wl); wl += cx; wr -= cx;          // the mics hear a little of each other's side
          room.tick(wl, wr);
          wl += room.l * 0.16; wr += room.r * 0.16;
          const ol = dc1(y * (1 - cab) * 0.62 + wl * cab), or = dc2(y * (1 - cab) * 0.62 + wr * cab);
          L[i] = knee(ol * mk); R[i] = knee(or * mk);
        }
      },
    };
  },
};
`),
});
