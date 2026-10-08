// @ts-check
// core.drumbus: Drum Riser. The processing a produced record puts on its drum bus, as one insert on the drum track (a
// kit is one instrument on one track, and the studio has no sends, so the parallel paths live inside the device):
//
//   1. a transient shaper: ATTACK and SUSTAIN (-100 to +100%) on the difference of a fast envelope (0.5 ms on, 20 ms
//      off) and a slow one (20 ms on, 200 ms off), stereo-linked: where the fast one leads, a hit is starting (ATTACK
//      lifts or softens it); where the slow one leads, it is ringing (SUSTAIN);
//   2. a punch compressor: SQUASH 0-1 sets the threshold (-6 to -30 dB) and the ratio (2:1 to 8:1) together; COMP ATK
//      1-50 ms (10 lets the stick through) and COMP REL 20-400 ms; the detector Squeeze Box's design, written again
//      here: the lows high-passed out of it at 70 Hz (so the kick doesn't duck the cymbals), half peak and half RMS,
//      linked, a soft knee, smoothing in decibels with a release that slows while it keeps working, and a slow makeup
//      that gives back what it takes on average, so SQUASH changes the shape, not the level;
//   3. saturation and a clip: DRIVE 0-1 (up to 18 dB into it, the level given back after) and CLIP SOFT or HARD, 4x
//      oversampled (two 2x half-band stages, 23 samples of latency in all);
//   4. two parallel paths, fed the input and delayed to line up with the main path, mixed after the clip:
//      ROOM: the kit room (kitroom.js, Rusty Sticks' room) on the whole kit, with ROOM SIZE;
//      CRUSH: a mono copy, high-passed at 120 Hz, through a fast brick-wall compressor and a hard drive: the crushed
//      room-mic sound of a modern record, under the kit;
//   5. MIX (dry to all of it) and OUTPUT.
// It declares 23 samples of latency: the dry path and both parallel paths are delayed to match.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { KITROOM } from './kitroom.js';

export default defineDevice({
  id: 'core.drumbus',
  name: 'Drum Riser',
  kind: 'effect',
  cat: 'dynamics',
  by: 'overdub',
  blurb: 'A drum bus: shape the hits, squash, clip, and a room and a crush underneath',
  nod: 'the drum bus of a modern rock or metal record: a transient designer, a punchy bus compressor, a clipper, and parallel room and crushed-room mics',
  params: [
    {
      key: 'attack',
      label: 'ATTACK',
      min: -100,
      max: 100,
      def: 0,
      unit: '%',
      role: 'attack',
      group: 'shape',
      desc: 'the start of each hit: up for more stick and beater, down to soften it',
    },
    {
      key: 'sustain',
      label: 'SUSTAIN',
      min: -100,
      max: 100,
      def: 0,
      unit: '%',
      role: 'decay',
      group: 'shape',
      desc: 'the ring after each hit: down to dry the kit up, up to open it',
    },
    {
      key: 'squash',
      label: 'SQUASH',
      min: 0,
      max: 1,
      def: 0.25,
      role: 'depth',
      group: 'comp',
      desc: 'the bus compressor: 0 off, then a lower threshold and a higher ratio together (2:1 to 8:1)',
    },
    {
      key: 'comp_attack',
      label: 'COMP ATK',
      min: 1,
      max: 50,
      def: 10,
      curve: 'log',
      unit: 'ms',
      role: 'attack',
      group: 'comp',
      desc: 'how fast it clamps: 10 lets the stick through, faster flattens it',
    },
    {
      key: 'comp_release',
      label: 'COMP REL',
      min: 20,
      max: 400,
      def: 80,
      curve: 'log',
      unit: 'ms',
      role: 'release',
      group: 'comp',
      desc: 'how fast it lets go: short pumps with the beat, long glues',
    },
    {
      key: 'drive',
      label: 'DRIVE',
      min: 0,
      max: 1,
      def: 0.1,
      role: 'drive',
      group: 'clip',
      desc: 'into the clipper: warmth, then a flattened, louder kit',
    },
    {
      key: 'clip',
      label: 'CLIP',
      opts: ['SOFT', 'HARD'],
      def: 0,
      role: 'shape',
      group: 'clip',
      desc: 'a round clip, or a hard one that keeps the attack and cuts the peak',
    },
    {
      key: 'room',
      label: 'ROOM',
      min: -40,
      max: 6,
      def: -40,
      unit: 'dB',
      role: 'mix',
      group: 'parallel',
      desc: 'a live room under the kit (-40 is off)',
    },
    {
      key: 'room_size',
      label: 'ROOM SIZE',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'size',
      group: 'parallel',
      desc: 'a tight booth (0) to a big live room (1): 0.5 to 1.4 s',
    },
    {
      key: 'crush',
      label: 'CRUSH',
      min: -40,
      max: 6,
      def: -40,
      unit: 'dB',
      role: 'mix',
      group: 'parallel',
      desc: 'a crushed mono copy under the kit, its lows taken out (-40 is off)',
    },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', group: 'out', desc: 'the dry kit to all of it' },
    {
      key: 'output',
      label: 'OUTPUT',
      min: -18,
      max: 12,
      def: 0,
      unit: 'dB',
      role: 'level',
      group: 'out',
      desc: 'the level out',
    },
  ],
  presets: [
    {
      name: 'Modern',
      params: {
        attack: 20,
        sustain: -25,
        squash: 0.65,
        comp_attack: 8,
        comp_release: 80,
        drive: 0.5,
        clip: 0,
        room: -24,
        crush: -12,
      },
      blurb: 'punch, the stick forward, a crushed room under it',
    },
    {
      name: 'Room',
      params: { attack: 10, squash: 0.35, room: -14, room_size: 0.6, crush: -40 },
      blurb: 'the kit in a live room',
    },
    {
      name: 'Smash',
      params: { attack: 15, squash: 0.8, comp_attack: 5, comp_release: 60, drive: 0.5, clip: 1, crush: -4, room: -30 },
      blurb: 'flattened and loud, the crush up',
    },
    {
      name: 'Glue',
      params: { squash: 0.3, comp_attack: 30, comp_release: 200, drive: 0.1, mix: 0.85 },
      blurb: 'gentle: holds the kit together',
    },
  ],
  look: {
    color: '#3b1f1f',
    ink: '#f2e3d0',
    shape: 'rack',
    finish: 'hammer',
    knob: 'black',
    label: 'block',
    led: '#ff4a2e',
  },
  latency: 23 / 48000,
  tail: 2,
  kernel: kernel(String.raw`
${KITROOM}
const LAT = 23;          // the 4x clip: 15 samples (the outer 2x stage) + 7.5 (the inner, at 2x) + a half-sample step
const ROOM_GAIN = 3;     // the room's level at ROOM 0 dB (as Rusty Sticks', on the snare)
const CRUSH_GAIN = 0.5;  // measured: CRUSH 0 dB is about as loud as the dry kit on the test drum loop
// level back after the clip, dB, at DRIVE 0, 0.1 .. 1: what the clip adds, measured on a Rusty Sticks groove at
// -15.5 LUFS (SQUASH 0), so DRIVE changes how flat the kit is, not how loud
const DCOMP = [0, 1.73, 3.41, 4.94, 6.33, 7.58, 8.70, 9.72, 10.66, 11.53, 12.34];
return {
  create({ sr, seed }) {
    // 1. the transient shaper's followers (linked), and its gain smoothed over 0.2 ms
    const fa = 1 - Math.exp(-1 / (0.0005 * sr)), fr = 1 - Math.exp(-1 / (0.02 * sr));
    const sa = 1 - Math.exp(-1 / (0.02 * sr)), srl = 1 - Math.exp(-1 / (0.2 * sr)), ga = 1 - Math.exp(-1 / (0.0002 * sr));
    let ef = 0, es = 0, gs = 1;
    // 2. the compressor
    const scL = svf(sr).set(70, 0.6), scR = svf(sr).set(70, 0.6);
    let env = 0, gr = 0, busy = 0, avg = 0;
    const rmsA = coef(0.005, sr), busyA = coef(0.4, sr), avgA = coef(0.6, sr);
    // 3. the 4x clip: two half-band stages, the inner one stepped half a sample so the whole is 23
    let soft = true;
    const shape = (x) => {
      if (soft) { const a = x < 0 ? -x : x; if (a <= 0.5) return x; const y = 0.5 + 0.5 * Math.tanh((a - 0.5) / 0.5); return x < 0 ? -y : y; }
      return x > 1 ? 1 : x < -1 ? -1 : x;
    };
    const stepped = (inner) => { let z = 0; return (v) => { const y = z; z = inner(v); return y; }; };
    const cL = os2(stepped(os2(shape))), cR = os2(stepped(os2(shape)));
    // the dry and the parallel feeds, delayed to the main path
    const dL = delayLine(64), dR = delayLine(64);
    // 4. the room, and the crush (mono: high-passed at 120 Hz, a fast brick-wall compressor, a hard drive)
    const room = kitRoom(sr, seed);
    let roomSize = -1;
    const cH1 = onepole(sr).set(120), cH2 = onepole(sr).set(120);
    let cEnv = 0;
    const cAt = 1 - Math.exp(-1 / (0.0001 * sr)), cRel = 1 - Math.exp(-1 / (0.05 * sr));
    const S = { attack: glide(20, sr), sustain: glide(20, sr), mix: glide(20, sr, 1), out: glide(20, sr, 1), room: glide(20, sr), crush: glide(20, sr), din: glide(30, sr, 1), dout: glide(30, sr, 1) };
    return {
      latency: LAT,
      process(L, R, n, P) {
        soft = (P.clip | 0) === 0;
        if (P.room_size !== roomSize) { roomSize = P.room_size; room.set(roomSize); }
        const sq = P.squash, on = sq > 0.001;
        const th = -6 - 24 * sq, ratio = 2 + 6 * sq, slope = on ? 1 - 1 / ratio : 0, knee = 6;
        const at = coef(P.comp_attack / 1000, sr), relFast = coef(P.comp_release / 1000, sr), relSlow = coef(P.comp_release * 4 / 1000, sr);
        const dx = clamp(P.drive, 0, 1) * 10, dk = Math.min(9, dx | 0), df = dx - dk;
        const gin = Math.pow(10, P.drive * 18 / 20), gout = Math.pow(10, -(DCOMP[dk] + (DCOMP[dk + 1] - DCOMP[dk]) * df) / 20);
        const rTarget = P.room <= -39.9 ? 0 : Math.pow(10, P.room / 20) * ROOM_GAIN, cTarget = P.crush <= -39.9 ? 0 : Math.pow(10, P.crush / 20) * CRUSH_GAIN;
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          // 1. shape
          const a = Math.max(xl < 0 ? -xl : xl, xr < 0 ? -xr : xr);
          ef += (a > ef ? fa : fr) * (a - ef); es += (a > es ? sa : srl) * (a - es);
          const d = ef > 1e-6 && es > 1e-6 ? 20 * Math.log10(ef / es) : 0;
          const at_ = S.attack.next(P.attack) / 100, su = S.sustain.next(P.sustain) / 100;
          let gdb = d > 0 ? at_ * d * 0.8 : su * -d * 0.5;
          gdb = gdb > 15 ? 15 : gdb < -15 ? -15 : gdb;
          gs += ga * (Math.pow(10, gdb / 20) - gs);
          let yl = xl * gs, yr = xr * gs;
          // 2. squash
          scL.tick(yl); scR.tick(yr);
          const hl = scL.hp, hr = scR.hp;
          const pk = Math.max(hl < 0 ? -hl : hl, hr < 0 ? -hr : hr);
          env = (hl * hl + hr * hr) * 0.5 + (env - (hl * hl + hr * hr) * 0.5) * rmsA;
          const lev = 0.5 * pk + 0.5 * Math.sqrt(env * 2);
          const ldb = lev > 1e-6 ? 20 * Math.log10(lev) : -120, o = ldb - th;
          let want = 0;
          if (2 * o > knee) want = o * slope;
          else if (2 * o > -knee) { const k = o + knee / 2; want = slope * k * k / (2 * knee); }
          if (want > gr) gr = want + (gr - want) * at;
          else { const rk = relFast + (relSlow - relFast) * busy; gr = want + (gr - want) * rk; }
          busy = (gr > 2 ? 1 : gr / 2) + (busy - (gr > 2 ? 1 : gr / 2)) * busyA;
          avg = gr + (avg - gr) * avgA;
          const gc = Math.pow(10, (avg - gr) / 20);
          yl *= gc; yr *= gc;
          // 3. drive and clip, 4x (23 samples late)
          const gi = S.din.next(gin), go = S.dout.next(gout);
          yl = cL(yl * gi) * go; yr = cR(yr * gi) * go;
          // the dry signal and the parallel feeds, 23 samples late too
          const ql = dL.tap(LAT), qr = dR.tap(LAT);
          dL.write(xl); dR.write(xr);
          // 4. the room and the crush on the input
          const rg = S.room.next(rTarget), cg = S.crush.next(cTarget), m = (ql + qr) * 0.5;
          if (rg > 0) { room.tick(m); yl += room.l * rg; yr += room.r * rg; }
          if (cg > 0) {
            const h = cH2.hp(cH1.hp(m)), ah = h < 0 ? -h : h;
            cEnv += (ah > cEnv ? cAt : cRel) * (ah - cEnv);
            const lim = 0.03 / Math.max(0.03, cEnv);            // a brick wall at -30 dBFS
            const c = sat(h * lim * 18) * 0.6 * cg;            // made up, then driven hard
            yl += c; yr += c;
          }
          // 5. mix and output
          const mx = S.mix.next(P.mix), g = S.out.next(Math.pow(10, P.output / 20));
          L[i] = (ql + (yl - ql) * mx) * g; R[i] = (qr + (yr - qr) * mx) * g;
        }
      },
    };
  },
};
`),
});
