// @ts-check
// core.ducker: Dim Switch. The sidechain duck: the track it sits on dips under another track (its key: the insert's
// key, set in its window's Key menu or with insert.set { patch: { key: { track } } }), the way a bass makes room for
// the kick in every club record. It is the console's dim button, pressed by the kick.
//
// It hears its key (t.key: the key track after its inserts, before its fader, so a muted "ghost kick" track still
// keys it) through a band-pass, KEY LOW to KEY HIGH (24 dB per octave each side), so a whole drum track can key on
// its kick alone; a peak detector (instant up, 30 ms down) reads the band's level.
//   TRIGGER: each time that level rises past THRESH (and has fallen 6 dB under it since, at least 30 ms after the last
//            one), it fires one fixed shape, the same every time however loud the hit: down by DEPTH over ATTACK (a
//            raised cosine, from wherever it was), held for HOLD, back over RELEASE, straight in dB (an exponential in
//            level) with CURVE bending it (+ waits and then comes back fast, a harder pump; - comes back fast, then
//            eases in). RELEASE is the time to all the way back; it is within 1 dB of the way back at about 92% of it.
//   FOLLOW:  like a compressor listening to the key: down by however far the key is over THRESH, dB for dB, at most
//            DEPTH, at ATTACK; held HOLD after it falls; back with a time constant of RELEASE / 3.
// NO KEY (OFF, 1/4, 1/8, 1/2, 1 BAR): with no key wired (t.key.on false), TRIGGER fires on that grid of the song
// instead, while the transport plays: the pump without a kick. MIX blends the dry back in.
// No look-ahead and no latency: a kick's front is a few samples, and the duck starts on the sample the key crosses.
// At its defaults with no key (and NO KEY at OFF) its gain is exactly 1: the sound passes bit for bit.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export const PRESETS = [
  { name: 'Kick duck', tags: ['bass-music', 'pump'], blurb: 'Bass and pads dip 10 dB on the kick (30-150 Hz of the key), back in 160 ms',
    params: { mode: 'TRIGGER', depth: 10, attack: 1, hold: 15, release: 160, curve: 0.2, thresh: -30, key_lo: 30, key_hi: 150 } },
  { name: 'Kick and snare duck', tags: ['bass-music', 'dubstep', 'pump'], blurb: 'Dubstep\'s: the bass dips on the kick and the snare\'s body (30-400 Hz)',
    params: { mode: 'TRIGGER', depth: 9, attack: 1, hold: 20, release: 180, curve: 0.2, thresh: -28, key_lo: 30, key_hi: 400 } },
  { name: 'Gentle pump', tags: ['bass-music', 'melodic', 'pump'], blurb: 'Pads and chords breathe 5 dB with the kick, slow and round',
    params: { mode: 'TRIGGER', depth: 5, attack: 5, hold: 0, release: 260, curve: -0.3, thresh: -30, key_lo: 30, key_hi: 150 } },
  { name: 'Hard pump (riddim)', tags: ['bass-music', 'riddim', 'pump'], blurb: 'The bass all but gone on each kick and slammed back: the riddim gap',
    params: { mode: 'TRIGGER', depth: 30, attack: 0.5, hold: 45, release: 110, curve: 0.5, thresh: -30, key_lo: 30, key_hi: 150 } },
  { name: 'Bus breathe', tags: ['bass-music', 'bus'], blurb: 'Follows the key like a compressor: a music bus leans 4 dB out of the drums\' way',
    params: { mode: 'FOLLOW', depth: 4, attack: 8, hold: 10, release: 300, thresh: -24, key_lo: 20, key_hi: 20000 } },
  { name: 'Quarter pump (no key)', tags: ['bass-music', 'pump'], blurb: 'No key needed: dips 12 dB on every beat of the song',
    params: { mode: 'TRIGGER', depth: 12, attack: 1, hold: 10, release: 200, curve: 0.2, nokey: '1/4' } },
];

export default defineDevice({
  id: 'core.ducker', name: 'Dim Switch', kind: 'effect', cat: 'dynamics', by: 'overdub',
  blurb: 'Sidechain duck: dips under the kick, or any track you key it to',
  nod: 'the sidechain ducking (a compressor or a volume shaper keyed by the kick) under every club bass',
  key: true,
  params: [
    { key: 'mode', label: 'MODE', opts: ['TRIGGER', 'FOLLOW'], def: 0, role: 'shape',
      desc: 'TRIGGER: each hit in the key fires the same duck (a kick pump); FOLLOW: the duck follows how loud the key is, like a compressor' },
    { key: 'depth', label: 'DEPTH', min: 0, max: 48, def: 12, unit: 'dB', role: 'depth', desc: 'how far it dips: 4-6 dB breathes, 10-12 makes room for a kick, 24 and up all but cuts it' },
    { key: 'attack', label: 'ATTACK', min: 0.1, max: 50, def: 1, curve: 'log', unit: 'ms', role: 'attack', desc: 'how fast it gets down: 0.5-2 ms clears the kick\'s front, slower softens it' },
    { key: 'hold', label: 'HOLD', min: 0, max: 500, def: 20, unit: 'ms', role: 'time', desc: 'how long it stays down before it comes back' },
    { key: 'release', label: 'RELEASE', min: 10, max: 2000, def: 180, curve: 'log', unit: 'ms', role: 'release', desc: 'how long it takes to come all the way back: shorter pumps harder' },
    { key: 'curve', label: 'CURVE', min: -1, max: 1, def: 0, role: 'shape', desc: 'the way back: + waits, then comes back fast (a harder pump); - comes back fast, then eases in' },
    { key: 'thresh', label: 'THRESH', min: -60, max: 0, def: -30, unit: 'dB', role: 'level', desc: 'how loud the key has to get to set it off' },
    { key: 'key_lo', label: 'KEY LOW', min: 20, max: 20000, def: 20, curve: 'log', unit: 'Hz', role: 'tone', desc: 'what of the key it listens to, from here up: raise it to ignore rumble' },
    { key: 'key_hi', label: 'KEY HIGH', min: 20, max: 20000, def: 20000, curve: 'log', unit: 'Hz', role: 'tone', desc: 'what of the key it listens to, up to here: 150 Hz hears a drum track\'s kick and not its hats' },
    { key: 'nokey', label: 'NO KEY', opts: ['OFF', '1/4', '1/8', '1/2', '1 BAR'], def: 0, role: 'time', desc: 'with no key set, dip on this grid of the song instead (OFF: no key, no duck)' },
    { key: 'mix', label: 'MIX', min: 0, max: 100, def: 100, unit: '%', role: 'mix', desc: 'how much of the ducked sound you hear: lower blends the steady sound back in' },
  ],
  presets: PRESETS,
  // a console's dim switch: a dark panel, one amber lamp
  look: { color: '#23262b', ink: '#f1e6cf', shape: 'mini', finish: 'flat', knob: 'small', label: 'plate', led: '#ffb54a' },
  tail: 0,
  kernel: kernel(String.raw`
const GRID = [0, 1, 0.5, 2, 4];   // NO KEY: beats between dips
return {
  create({ sr }) {
    // the key's band: two 2nd-order high passes and two low passes (24 dB per octave each side), on the louder channel
    const h1 = svf(sr), h2 = svf(sr), l1 = svf(sr), l2 = svf(sr), H1 = svf(sr), H2 = svf(sr), L1 = svf(sr), L2 = svf(sr);
    const DEC = coef(0.03, sr), REARM = Math.round(0.03 * sr), HYST = Math.pow(10, -6 / 20);
    let env = 0, armed = true, since = REARM;
    // the duck: r dB of reduction now; phase 0 resting, 1 down, 2 holding, 3 back; t samples into the phase
    let r = 0, r0 = 0, phase = 0, t = 0, held = 0, lastK = null, gr = 0;
    const mS = glide(20, sr, 1);
    let flo = -1, fhi = -1;
    // the key's band at rest: once it has rung out (under 1e-20) and the key is exact silence, its filters aren't run
    // (left running on silence they settle into subnormal numbers and stay there, which x86 CPUs compute slowly)
    let rung = 0;
    const fire = () => { phase = 1; t = 0; r0 = r; };
    return {
      meter() { return gr; },
      process(L, R, n, P, T) {
        const key = T && T.key, on = !!(key && key.on), mode = P.mode | 0, D = P.depth;
        const A = Math.max(1, P.attack * 0.001 * sr), Hd = P.hold * 0.001 * sr, Rl = Math.max(1, P.release * 0.001 * sr), c = P.curve;
        const thr = Math.pow(10, P.thresh / 20);
        if (on && (P.key_lo !== flo || P.key_hi !== fhi)) {
          flo = P.key_lo; fhi = P.key_hi;
          const lo = Math.min(flo, fhi), hi = Math.max(flo, fhi);
          h1.set(lo, 0.7071); h2.set(lo, 0.7071); H1.set(lo, 0.7071); H2.set(lo, 0.7071);
          l1.set(hi, 0.7071); l2.set(hi, 0.7071); L1.set(hi, 0.7071); L2.set(hi, 0.7071);
        }
        // the grid, with no key: the beat each sample plays at (only while the transport plays)
        const div = !on && T && T.playing ? GRID[P.nokey | 0] || 0 : 0;
        const inc = T ? T.bpm / 60 / sr : 0, b0 = T ? T.beat : 0, near = 2.5 * inc;
        const aF = coef(P.attack * 0.001, sr), rF = coef(P.release * 0.001 / 3, sr);
        let lo = 1, still = false;
        if (on && rung < 1e-20) { still = true; for (let i = 0; i < n; i++) if (key.l[i] !== 0 || key.r[i] !== 0) { still = false; break; } }
        if (on && !still) rung = 0;
        for (let i = 0; i < n; i++) {
          let x = 0;
          if (on && still) { env *= DEC; if (env < 1e-12) env = 0; }
          else if (on) {
            // the key's band level
            h1.tick(key.l[i]); h2.tick(h1.hp); l1.tick(h2.hp); l2.tick(l1.lp);
            H1.tick(key.r[i]); H2.tick(H1.hp); L1.tick(H2.hp); L2.tick(L1.lp);
            const a = l2.lp < 0 ? -l2.lp : l2.lp, b = L2.lp < 0 ? -L2.lp : L2.lp;
            x = a > b ? a : b;
            if (x > rung) rung = x;
            env = x > env ? x : env * DEC;
            if (env < 1e-12) env = 0;
          }
          since++;
          if (mode === 0) {
            // TRIGGER: an onset is the level rising past THRESH, re-armed once it has fallen 6 dB under
            if (on) {
              if (armed && env > thr && since >= REARM) { fire(); armed = false; since = 0; }
              else if (!armed && env < thr * HYST) armed = true;
            } else if (div > 0) {
              const bt = b0 + i * inc, k = Math.floor(bt / div + 1e-9);
              if (k !== lastK) { if (bt - k * div < near) fire(); lastK = k; }
            }
            if (phase === 1) {
              t++;
              const u = t >= A ? 1 : t / A;
              r = r0 + (D - r0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
              if (t >= A) { phase = Hd > 0 ? 2 : 3; t = 0; }
            } else if (phase === 2) {
              r = D;
              if (++t >= Hd) { phase = 3; t = 0; }
            } else if (phase === 3) {
              t++;
              const u = t >= Rl ? 1 : t / Rl;
              const y = c > 0 ? Math.pow(u, 1 + 3 * c) : c < 0 ? 1 - Math.pow(1 - u, 1 - 3 * c) : u;
              r = D * (1 - y);
              if (t >= Rl) { phase = 0; r = 0; }
            }
          } else {
            // FOLLOW: the key's level over THRESH, dB for dB, at most DEPTH
            let want = 0;
            if (on && env > thr) { want = 8.685889638065035 * Math.log(env / thr); if (want > D) want = D; }
            if (want >= r) { r = want + (r - want) * aF; held = Hd; }
            else if (held > 0) held--;
            else { r = want + (r - want) * rF; if (r < 1e-6) r = 0; }
          }
          const m = mS.next(P.mix * 0.01);
          if (r !== 0 || phase !== 0) {
            const g = 1 - m * (1 - Math.pow(10, -r / 20));
            if (g < lo) lo = g;
            L[i] *= g; R[i] *= g;
          }
        }
        gr = lo < 1 ? 20 * Math.log10(lo) : 0;
      },
    };
  },
};
`),
});
