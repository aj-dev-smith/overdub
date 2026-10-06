// Cymbal candidates for the two drum kits (Gobo Kit, core.drums; Studio A, core.drumroom), as kernel source each kit
// puts in front of its own. Each kit's `cym_model` param picks them: 0 CLASSIC is the kit's own cymbals, unchanged
// (so every old song plays as it did); 1 FDN and 2 MODAL are these. They come from the drum audit and the synthesis
// research (overdub-private docs/sound/2026-10-05-drum-audit.md, 2026-10-05-drum-synthesis-research.md): the shipped
// crashes and rides swelled in over tens of ms, were filtered noise rather than metal, never darkened as they rang, and
// were cut off at a fixed length; the rides were pitched and had no stick ping; the bells were dull.
//
// One model per cymbal, kept between strokes (a stroke adds to what is already ringing, so a ride's wash builds):
//   FDN    16 short delay lines under a Hadamard mix: a dense field of inharmonic modes at a fixed cost, each line damped
//          by a one-pole set from its gain at DC and at Nyquist, so the top dies first. A stick (a raised cosine whose
//          length is the contact time) and a short noise burst go in, low-passed by how hard it is hit; a direct path
//          carries the stick (without it the network takes tens of ms to build); two sign patterns are the two mics.
//   MODAL  N two-pole modes spread evenly across the band (stratified: no beating pairs, no accidental pitch), each
//          ringing for T60(f) = A (f/4k)^-b e^-(c (f/16k)^2), heard by two mics with their own gains (the mode's shape
//          from two places: stereo for free). The stick's contact time sets the bright edge of each stroke (a harder,
//          shorter contact reaches higher modes); a wash of noise follows the bank's level under a falling low-pass.
// Both: a stick "ping" (high-passed noise, a few ms) on top, and the ride's bell: near-harmonic partials (read off the
// public-domain OSD ride bell) that a bell stroke rings hard and a bow stroke barely. Every stroke peaks within a few ms;
// the ring time falls with frequency; the model goes quiet on its own (no fixed length) and stops costing anything then.
// Deterministic: every noise and every per-instance draw comes from the seed the kit hands it.
//
// The kit drives a model through its piece interface (Studio A's): push a stroke into ev[] / nev ({ at, art, F, r, tc,
// w }: frame in the block, articulation, force 0..1, -, contact ms, -), params(tm, dm) once a block (tuning and ring
// multipliers), render(n) -> near (close mic, mono), far / farR (the overhead pair). art: ride 0 bow, 1 bell, 2 edge,
// 3 choke; the others 0 hit, 1 choke (the hit, then a hand grabs it 110 ms later).

// The designs, fitted against real one-shots (tools/drum-lab, then tools/cym-lab in overdub-private, in the kits).
// fdn and modal: one design per kind, 0 crash, 1 ride, 2 china, 3 splash. Times in s unless named ms, frequencies Hz.
//   fdn    loMs..hiMs the delay lines' spread, t60lo / t60hi the ring at DC / Nyquist, burstMs / burst the noise burst,
//          fcSoft..fcHard the stick's low-pass from soft to hard, direct the stick heard straight, ping [Hz, ms, level],
//          spread how wide the pair is (0 mono .. 1 independent)
//   modal  modes, cascadeMs (the bloom: how long the stroke takes to reach the top modes), lo..hi the band, A, b, c the
//          ring law T60(f) = A (f/4k)^-b e^-(c (f/16k)^2) capped at cap, tilt and body (under bodyHz) the levels,
//          fcSoft..fcHard (^fcCurve) the stick's bright edge, ping, wash (its level, washHp, the low-pass falling from
//          washFrom to washTo over washTau; washAtk ms how fast it rises with the bank), spread
//   bell   the ride's bell: its main partial (Hz, on a 20" ride), T60, its tilt and cap, level by engine, and [ratio, dB]
//          partials read off the public-domain OSD ride bell
//   zones  how a stroke excites the ride, by engine: [body, bell, ping, brightness x] for bow, bell and edge
//   bellTrim  a bell stroke's level by engine, set so the bell sits 5.7 LU over the bow (the OSD ride)
// Each kit carries its own trims (MTRIM), matching every piece's loudness to its CLASSIC cymbal.
export const METAL_SPEC = {
  fdn: [
    { loMs: 1.92, hiMs: 2.75, t60lo: 4.5, t60hi: 0.494, burstMs: 2.88, burst: 5.01, fcSoft: 9460, fcHard: 14000, direct: 1.53, ping: [4000, 6, 0.0369], spread: 0.6 }, // crash
    { loMs: 0.472, hiMs: 5.41, t60lo: 4.2, t60hi: 0.837, burstMs: 3.46, burst: 2.25, fcSoft: 14000, fcHard: 26000, direct: 1.7, ping: [6500, 4, 3], spread: 0.35 }, // ride
    { loMs: 1.6, hiMs: 3.6, t60lo: 3.2, t60hi: 0.3, burstMs: 7, burst: 3.6, fcSoft: 7000, fcHard: 11000, direct: 1, ping: [3000, 6, 0.2], spread: 0.6 }, // china
    { loMs: 0.9, hiMs: 1.7, t60lo: 1.9, t60hi: 0.5, burstMs: 3, burst: 2.2, fcSoft: 13000, fcHard: 20000, direct: 1.2, ping: [6000, 4, 0.3], spread: 0.5 }, // splash
  ],
  modal: [
    { modes: 192, washAtk: 0.7, cascadeMs: 2.5, lo: 140, hi: 18500, A: 5, b: 0.8, c: 0.5, cap: 4.5, tilt: 0.256, bodyHz: 650, body: 0.838, fcSoft: 4770, fcHard: 6480, fcCurve: 1.5, ping: [4000, 6, 0.8], wash: 0.303, washHp: 267, washFrom: 20000, washTo: 2500, washTau: 0.635, spread: 0.6 }, // crash
    { modes: 192, washAtk: 8, cascadeMs: 2.29, lo: 220, hi: 18500, A: 3.2, b: 0.6, c: 0.7, cap: 4.2, tilt: 0.473, bodyHz: 600, body: 1.64, fcSoft: 3300, fcHard: 37100, fcCurve: 1.2, ping: [6500, 4, 0.145], wash: 0.342, washHp: 2190, washFrom: 16000, washTo: 6000, washTau: 0.779, spread: 0.35 }, // ride
    { modes: 128, washAtk: 0.7, cascadeMs: 4, lo: 160, hi: 14000, A: 2.6, b: 0.7, c: 0.6, cap: 3.2, tilt: 0.1, bodyHz: 700, body: 1.3, fcSoft: 3500, fcHard: 8000, fcCurve: 1.5, ping: [3000, 6, 0.2], wash: 0.7, washHp: 500, washFrom: 14000, washTo: 2000, washTau: 0.3, spread: 0.6 }, // china
    { modes: 96, washAtk: 0.7, cascadeMs: 1.5, lo: 400, hi: 18500, A: 1.6, b: 0.8, c: 0.5, cap: 2.2, tilt: 0.25, bodyHz: 900, body: 1.1, fcSoft: 6000, fcHard: 14000, fcCurve: 1.5, ping: [6000, 4, 0.12], wash: 0.3, washHp: 800, washFrom: 19000, washTo: 4000, washTau: 0.3, spread: 0.5 }, // splash
  ],
  bell: { hz: 2432, t60: 3.8, tilt: -0.55, cap: 4.5, level: [0.377, 1.23], parts: [[0.141, -10], [0.484, -15], [0.631, -15], [0.848, -17], [1, 0], [1.122, -9], [1.414, -8], [1.435, -9], [1.472, -6], [1.632, -6], [1.951, -10], [2.066, -12], [2.371, -15], [2.847, -12], [3.14, -14]] },
  zones: [[[1, 0.06, 1, 1], [0.566, 1, 0.768, 0.982], [1.25, 0.03, 0.45, 0.7]], [[1, 0.06, 1, 1], [1.58, 1, 0.4, 0.681], [1.25, 0.03, 0.45, 0.7]]],
  bellTrim: [2.34, 1],
};

export const metalSource = (spec = METAL_SPEC) => String.raw`
// ------------------------------------------------------------------------------------------------ metal (cym_model)
const MSPEC = ${JSON.stringify(spec)};
// the house's zero-delay state-variable filter, as a class
class MSV {
  constructor(sr) { this.sr = sr; this.ic1 = 0; this.ic2 = 0; this.k = 1; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  set(fc, q) { const g = Math.tan(Math.PI * Math.min(Math.max(fc, 5), this.sr * 0.49) / this.sr), k = 1 / q, a1 = 1 / (1 + g * (g + k)), a2 = g * a1; this.k = k; this.a1 = a1; this.a2 = a2; this.a3 = g * a2; return this; }
  tick(v0) {
    const ic1 = this.ic1, ic2 = this.ic2, a2 = this.a2;
    const v3 = v0 - ic2, v1 = this.a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - ic1; this.ic2 = 2 * v2 - ic2;
    this.lp = v2; this.bp = v1; this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
  reset() { this.ic1 = this.ic2 = 0; this.lp = this.bp = this.hp = 0; }
}
// a seeded draw, 0..1 (lib's rng step, its state in a typed array)
function mdraw(S) { const v = (Math.imul(S[0], 1664525) + 1013904223) >>> 0; S[0] = v; return v / 4294967296; }
const MLN1000 = 6.907755278982137;
// a stick's force spectrum: a second-order fall past fc
const mstick = (f, fc) => 1 / Math.sqrt(1 + (f / fc) * (f / fc) * (f / fc) * (f / fc));

// A bank of two-pole modes heard by two mics. f, t (T60), amp, gl / gr (mic gains) per mode; run() adds into L and R.
// A stroke is an impulse into the state (strike): the output at the stroke's frame gains e_k, exactly an impulse.
class MBank {
  constructor(N) {
    this.N = N; this.n = 0;
    this.f = new Float64Array(N); this.t = new Float64Array(N); this.amp = new Float64Array(N); this.ml = new Float64Array(N); this.mr = new Float64Array(N);
    this.a1 = new Float64Array(N); this.a2 = new Float64Array(N); this.gl = new Float64Array(N); this.gr = new Float64Array(N);
    this.y1 = new Float64Array(N); this.y2 = new Float64Array(N); this.on = new Uint8Array(N); this.live = 0;
    this.fm = -1; this.dm = -1;
  }
  set(sr, fm, dm) {
    if (fm === this.fm && dm === this.dm) return;
    this.fm = fm; this.dm = dm;
    const top = sr * 0.46;
    for (let k = 0; k < this.n; k++) {
      let f = this.f[k] * fm; if (f > top) f = top;
      const w = TAU * f / sr, r = Math.exp(-MLN1000 / (Math.max(0.004, this.t[k] * dm) * sr)), s = Math.sin(w);
      this.a1[k] = 2 * r * Math.cos(w); this.a2[k] = r * r;
      this.gl[k] = this.amp[k] * this.ml[k] * s; this.gr[k] = this.amp[k] * this.mr[k] * s;
    }
  }
  strike(k, e) { if (e === 0) return; this.y2[k] -= e / this.a2[k]; this.on[k] = 1; }
  run(L, R, a, e) {
    const A1 = this.a1, A2 = this.a2, GL = this.gl, GR = this.gr, Y1 = this.y1, Y2 = this.y2, ON = this.on;
    for (let k = 0; k < this.n; k++) {
      if (!ON[k]) continue;
      const p = A1[k], q = A2[k], gl = GL[k], gr = GR[k];
      let u1 = Y1[k], u2 = Y2[k];
      for (let i = a; i < e; i++) { const v = p * u1 - q * u2; u2 = u1; u1 = v; L[i] += gl * v; R[i] += gr * v; }
      Y1[k] = u1; Y2[k] = u2;
    }
  }
  prune() {
    let live = 0;
    const Y1 = this.y1, Y2 = this.y2, ON = this.on;
    for (let k = 0; k < this.n; k++) {
      if (!ON[k]) continue;
      // about 120 dB under a stroke: gone
      if (Y1[k] * Y1[k] + Y2[k] * Y2[k] < 1e-12) { Y1[k] = 0; Y2[k] = 0; ON[k] = 0; } else live++;
    }
    return (this.live = live);
  }
  clear() { this.y1.fill(0); this.y2.fill(0); this.on.fill(0); this.live = 0; }
}

// One cymbal. kind 0 crash, 1 ride, 2 china, 3 splash; engine 1 FDN, 2 MODAL.
class Metal {
  constructor(sr, seed, kind, engine) {
    this.sr = sr; this.kind = kind; this.engine = engine;
    this.D = engine === 1 ? MSPEC.fdn[kind] : MSPEC.modal[kind];
    this.seed0 = (seed >>> 0) || 0x5bd1e995; this.S = new Uint32Array(1); this.S[0] = this.seed0;
    this.ns = ((seed ^ 0x2545f491) >>> 0) || 0x9e3779b9;
    this.near = new Float64Array(128); this.far = new Float64Array(128); this.farR = new Float64Array(128);
    this.E = this.near; this.body = this.near;   // (Studio A gives every piece these when blocks grow; unused here)
    this.ev = []; for (let i = 0; i < 16; i++) this.ev.push({ at: 0, art: 0, F: 0, r: 0, tc: 1, w: 0 });
    this.nev = 0; this.on = false; this.lvl = -1;
    this.tm = 1; this.dm = 1; this.choke = 1; this.grabAt = -1; this.fs = 1; this.ts = 1; this.bright = 1;
    // the stick and its ping, the bell, the wash: shared by both engines
    this.pp = new Float64Array(4); this.pl = new Float64Array(4); this.pa = new Float64Array(4); this.pn = 0;
    this.pE = 0; this.pK = Math.exp(-1 / (this.D.ping[1] * 0.001 * sr));
    this.phL = new MSV(sr).set(this.D.ping[0], 0.7); this.phR = new MSV(sr).set(this.D.ping[0], 0.7);
    this.pingG = this.D.ping[2];
    this.bell = null;
    if (kind === 1) { const B = MSPEC.bell; this.bell = new MBank(B.parts.length); }
    this.quiet = 0; this.pq = 0;
    if (engine === 1) this.initNet(); else this.initModes();
    this.configure(null);
  }
  // ---- the FDN
  initNet() {
    const D = this.D, sr = this.sr, R = this.S;
    // 16 lengths (at 48 kHz, unscaled), log-spread between loMs and hiMs, jittered, none sharing a small factor
    this.base = new Float64Array(16);
    const used = [];
    for (let i = 0; i < 16; i++) {
      let m = Math.round(48 * D.loMs * Math.pow(D.hiMs / D.loMs, (i + mdraw(R)) / 16));
      const ok = (m) => { for (const p of [2, 3, 5, 7, 11, 13]) if (m % p === 0 && m !== p) return false; return used.indexOf(m) < 0; };
      while (!ok(m)) m++;
      used.push(m); this.base[i] = m;
    }
    // the longest a line can be: tuned 12 st down, the biggest cymbal (fs 0.6), at this rate
    let size = 1; while (size < Math.ceil(D.hiMs * 48 * (sr / 48000) * 2 / 0.6) + 8) size <<= 1;
    this.SZ = size; this.MK = size - 1; this.buf = new Float64Array(16 * size); this.wp = 0;
    this.len = new Int32Array(16); this.lenTm = -1;
    this.b = new Float64Array(16); this.a = new Float64Array(16); this.z = new Float64Array(16); this.x = new Float64Array(16);
    this.inS = new Float64Array(16); this.oL = new Float64Array(16); this.oR = new Float64Array(16);
    for (let i = 0; i < 16; i++) { this.inS[i] = mdraw(R) < 0.5 ? -1 : 1; this.oL[i] = mdraw(R) < 0.5 ? -1 : 1; this.oR[i] = mdraw(R) < 0.5 ? -1 : 1; }
    this.bE = 0; this.bK = Math.exp(-1 / (D.burstMs * 0.001 * sr));
    this.xl = new MSV(sr).set(D.fcHard, 0.6); this.dh = new MSV(sr).set(2000, 0.7); this.idle = 96;
    this.dset = -1;
  }
  lengths() {
    const k = (this.sr / 48000) / (this.fs * this.tm);
    for (let i = 0; i < 16; i++) this.len[i] = Math.max(2, Math.min(this.SZ - 2, Math.round(this.base[i] * k)));
    this.lenTm = this.tm; this.dset = -1;
  }
  damping() {
    const D = this.D, d = this.dm * this.ts * this.choke, sr = this.sr;
    const lo = Math.max(0.01, D.t60lo * d), hi = Math.max(0.005, D.t60hi * d);
    for (let i = 0; i < 16; i++) {
      const m = this.len[i], g0 = Math.pow(10, -3 * m / (sr * lo)), gp = Math.pow(10, -3 * m / (sr * hi)), a = (g0 - gp) / (g0 + gp);
      this.a[i] = a; this.b[i] = g0 * (1 - a);
    }
    this.dset = d;
  }
  // ---- the modes
  initModes() {
    const D = this.D, N = D.modes;
    this.bank = new MBank(N); this.bank.n = N;
    this.wl = new MSV(this.sr); this.wr = new MSV(this.sr); this.whl = new MSV(this.sr).set(D.washHp, 0.7); this.whr = new MSV(this.sr).set(D.washHp, 0.7);
    this.wf = 0; this.wfK = 1 - Math.exp(-TAU * 20 / this.sr); this.wfA = 1 - Math.exp(-1 / (D.washAtk * 0.001 * this.sr)); this.sw = 0; this.swK = Math.exp(-32 / (D.washTau * this.sr)); this.swC = 0;
    // the energy cascade: a stroke rings the low modes first and reaches the top over a few ms (the bloom a real cymbal
    // has in its first milliseconds), as MG groups of modes struck in turn; the strokes still to come wait in pq
    this.MG = 6; this.pqAt = new Float64Array(48); this.pqG = new Int32Array(48); this.pqA = new Float64Array(48); this.pqFc = new Float64Array(48); this.pq = 0;
  }
  // strike group g of the modes (amplitude A, the stick's bright edge fc)
  strikeGroup(g, A, fc) {
    const B = this.bank, fm = this.tm, k0 = Math.floor(g * B.n / this.MG), k1 = Math.floor((g + 1) * B.n / this.MG);
    for (let k = k0; k < k1; k++) B.strike(k, A * mstick(B.f[k] * fm, fc));
  }
  // c: Studio A's cymbal spec [size ("), peak (Hz), t60 (s), bright] or null (the reference cymbal)
  configure(c) {
    const kind = this.kind, REF = [[17, 3.6], [20, 5.5], [18, 2.5], [10, 1.3]][kind];
    this.fs = c ? Math.pow(REF[0] / c[0], 0.7) : 1;
    this.ts = c ? Math.min(1.5, Math.max(0.55, c[2] / REF[1])) : 1;
    this.bright = c ? c[3] : 1;
    const R = this.S;
    R[0] = (this.seed0 ^ 0x1234567) >>> 0 || 1;   // the same cymbal for the same kit, whatever came before
    if (this.engine === 2) {
      const D = this.D, B = this.bank, N = D.modes, fs = this.fs;
      for (let k = 0; k < N; k++) {
        const f = (D.lo + (D.hi - D.lo) * (k + 0.15 + 0.7 * mdraw(R)) / N) * fs;
        B.f[k] = f;
        const t60 = D.A * Math.pow(f / 4000, -D.b) * Math.exp(-D.c * (f / 16000) * (f / 16000));
        B.t[k] = Math.min(D.cap, t60) * (0.8 + 0.4 * mdraw(R)) * this.ts;
        B.amp[k] = (0.35 + 0.65 * mdraw(R)) * Math.pow(f / 1000, D.tilt) * (f < D.bodyHz * fs ? D.body : 1) / Math.sqrt(N);
        // two mics: the same magnitude an angle apart, sometimes opposite in sign
        const th = (mdraw(R) - 0.5) * Math.PI * D.spread, flip = mdraw(R) < 0.5 * D.spread ? -1 : 1;
        B.ml[k] = Math.cos(Math.PI / 4 + th) * Math.SQRT2; B.mr[k] = Math.sin(Math.PI / 4 + th) * Math.SQRT2 * flip;
      }
      B.fm = -1;
    } else this.lenTm = -1;
    if (this.bell) {
      const Bd = MSPEC.bell, B = this.bell, fb = Bd.hz * this.fs, lv = Bd.level[this.engine - 1];
      for (let k = 0; k < Bd.parts.length; k++) {
        const f = fb * Bd.parts[k][0] * (0.995 + 0.01 * mdraw(R));
        B.f[k] = f; B.t[k] = Math.min(Bd.cap, Bd.t60 * Math.pow(f / 2432, Bd.tilt)) * this.ts; B.amp[k] = Math.pow(10, Bd.parts[k][1] / 20) * lv;
        const pan = 0.08 * (mdraw(R) - 0.5); B.ml[k] = 1 + pan; B.mr[k] = 1 - pan;
      }
      B.n = Bd.parts.length; B.fm = -1;
    }
  }
  params(tm, dm) { this.tm = tm; this.dm = dm; }
  ensure(n) { if (this.far.length < n || this.farR.length < n || this.near.length < n) { this.near = new Float64Array(n); this.far = new Float64Array(n); this.farR = new Float64Array(n); } }
  // a stroke at frame e.at of this block
  strike(e) {
    const art = e.art, kind = this.kind, D = this.D, sr = this.sr;
    const grab = (kind === 1 && art === 3) || (kind !== 1 && art === 1);
    this.choke = 1; this.grabAt = grab ? e.at + Math.round(0.11 * sr) : -1;
    const Z = MSPEC.zones[this.engine - 1][kind === 1 ? (art === 1 ? 1 : art === 2 ? 2 : 0) : 0];
    // A: the stroke's amplitude (a kit may pass its own law in w; a bell stroke has its own level, bellTrim)
    const F = e.F, A = F * (e.w > 0 ? e.w : 1) * (kind === 1 && art === 1 ? MSPEC.bellTrim[this.engine - 1] : 1), bx = this.bright * Z[3];
    const fc = (this.engine === 1 ? D.fcSoft + (D.fcHard - D.fcSoft) * F * F : D.fcSoft + (D.fcHard - D.fcSoft) * Math.pow(Math.min(1, F), D.fcCurve)) * bx;
    if (this.engine === 1) {
      if (this.lenTm !== this.tm) this.lengths();
      if (this.dset !== this.dm * this.ts * this.choke) this.damping();
      // the stick: a raised cosine of the contact time (up to four overlapping), and the burst
      if (this.pn >= 4) { for (let k = 1; k < 4; k++) { this.pp[k - 1] = this.pp[k]; this.pl[k - 1] = this.pl[k]; this.pa[k - 1] = this.pa[k]; } this.pn = 3; }
      const k = this.pn++; this.pp[k] = 0; this.pl[k] = Math.max(2, e.tc * 0.001 * sr); this.pa[k] = A * Z[0];
      this.bE += D.burst * A * Z[0]; this.idle = 0;
      this.xl.set(Math.min(fc, sr * 0.45), 0.6);
    } else {
      this.bank.set(sr, this.tm, this.dm * this.choke);
      const w0 = A * Z[0], MG = this.MG;
      this.strikeGroup(0, w0, fc);
      for (let g = 1; g < MG; g++) {
        if (this.pq >= 48) break;
        const q = this.pq++; this.pqAt[q] = e.at + Math.round(D.cascadeMs * 0.001 * sr * g / (MG - 1)); this.pqG[q] = g; this.pqA[q] = w0; this.pqFc[q] = fc;
      }
      this.sw = 1;
    }
    if (this.bell) {
      const B = this.bell;
      B.set(sr, this.tm, this.dm * this.choke);
      const w0 = A * Z[1];
      for (let k = 0; k < B.n; k++) B.strike(k, w0 * mstick(B.f[k] * this.tm, fc * 1.5));
    }
    this.pE += this.pingG * A * Math.pow(Math.max(F, 0.01), -0.2) * Z[2];
    this.on = true; this.quiet = 0;
  }
  // render sample a..e of this block into far / farR
  seg(a, e) {
    const L = this.far, R = this.farR, sr = this.sr;
    for (let i = a; i < e; i++) { L[i] = 0; R[i] = 0; }
    let ns = this.ns, pE = this.pE;
    const pK = this.pK, phL = this.phL, phR = this.phR;
    if (this.engine === 1) {
      const buf = this.buf, SZ = this.SZ, MK = this.MK, len = this.len, bb = this.b, aa = this.a, z = this.z, x = this.x, inS = this.inS, oL = this.oL, oR = this.oR;
      const xl = this.xl, dh = this.dh, dir = this.D.direct, bK = this.bK, sp = this.D.spread;
      let wp = this.wp, bE = this.bE;
      // the excitation (the stick pulses and the burst, low-passed by how hard it was hit, and its direct path) runs
      // while a stroke is under way and 2 ms after; then its filters rest
      let idle = this.idle;
      for (let i = a; i < e; i++) {
        let xs = 0, d = 0;
        if (idle < 96) {
          let u = 0;
          for (let k = 0; k < this.pn; k++) { const p = this.pp[k]; if (p < this.pl[k]) { const s = Math.sin(Math.PI * (p + 0.5) / this.pl[k]); u += this.pa[k] * s * s; this.pp[k] = p + 1; } }
          ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; u += (ns * 4.656612873077393e-10 - 1) * bE; bE *= bK;
          xs = xl.tick(u); dh.tick(xs); d = dh.hp * dir;
          if (bE < 1e-7 && (this.pn === 0 || this.pp[this.pn - 1] >= this.pl[this.pn - 1])) { if (++idle === 96) { xl.reset(); dh.reset(); bE = 0; } } else idle = 0;
        }
        // the lines: read, damp
        for (let j = 0; j < 16; j++) { const y = buf[j * SZ + ((wp - len[j]) & MK)]; const v = bb[j] * y + aa[j] * z[j]; z[j] = v; x[j] = v; }
        let l = 0, r = 0;
        for (let j = 0; j < 16; j++) { l += oL[j] * x[j]; r += oR[j] * x[j]; }
        // a 16-point Walsh-Hadamard mix (x 1/4: lossless), then back into the lines with the excitation
        for (let h = 1; h < 16; h <<= 1) for (let j0 = 0; j0 < 16; j0 += h << 1) for (let j = j0; j < j0 + h; j++) { const p = x[j], q = x[j + h]; x[j] = p + q; x[j + h] = p - q; }
        for (let j = 0; j < 16; j++) buf[j * SZ + wp] = x[j] * 0.25 + inS[j] * xs;
        wp = (wp + 1) & MK;
        const m = (l + r) * 0.125, s = (l - r) * 0.125 * sp;
        L[i] = m + s + d; R[i] = m - s + d;
      }
      this.idle = idle;
      let j = 0;
      for (let k = 0; k < this.pn; k++) if (this.pp[k] < this.pl[k]) { this.pp[j] = this.pp[k]; this.pl[j] = this.pl[k]; this.pa[j] = this.pa[k]; j++; }
      this.pn = j;
      this.wp = wp; this.bE = bE < 1e-12 ? 0 : bE;
    } else {
      this.bank.run(L, R, a, e);
      const D = this.D, wl = this.wl, wr = this.wr, whl = this.whl, whr = this.whr, wfK = this.wfK, wash = D.wash;
      let wf = this.wf, sw = this.sw, swC = this.swC;
      const wfA = this.wfA;
      for (let i = a; i < e; i++) {
        if ((swC++ & 31) === 0) { const c = D.washTo + (D.washFrom - D.washTo) * sw; wl.set(Math.min(c * this.fs, sr * 0.45), 0.6); wr.set(Math.min(c * this.fs, sr * 0.45), 0.6); sw *= this.swK; }
        const l = L[i], r = R[i];
        const lv = (l < 0 ? -l : l) + (r < 0 ? -r : r);
        wf += (lv - wf) * (lv > wf ? wfA : wfK);   // the bank's level (up in washAtk ms, down at 20 Hz): the wash follows it
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const n1 = ns * 4.656612873077393e-10 - 1;
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const n2 = ns * 4.656612873077393e-10 - 1;
        whl.tick(n1); wl.tick(whl.hp); whr.tick(n2); wr.tick(whr.hp);
        L[i] = l + wl.lp * wf * wash; R[i] = r + wr.lp * wf * wash;
      }
      this.wf = wf; this.sw = sw; this.swC = swC;
    }
    if (this.bell) this.bell.run(L, R, a, e);
    // the ping: the stick's tip, high-passed noise for a few ms
    if (pE > 1e-9) {
      for (let i = a; i < e; i++) {
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; phL.tick(ns * 4.656612873077393e-10 - 1);
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; phR.tick(ns * 4.656612873077393e-10 - 1);
        L[i] += phL.hp * pE; R[i] += phR.hp * pE; pE *= pK;
      }
    }
    this.ns = ns; this.pE = pE < 1e-9 ? 0 : pE;
  }
  render(n) {
    this.ensure(n);
    // (a retune reaches the delay lines at the next stroke, or once it rests: moving them while it rings would click)
    if (this.engine === 1) { if (this.lenTm !== this.tm && !this.on) this.lengths(); if (this.dset !== this.dm * this.ts * this.choke) this.damping(); }
    else this.bank.set(this.sr, this.tm, this.dm * this.choke);
    if (this.bell) this.bell.set(this.sr, this.tm, this.dm * this.choke);
    let pos = 0, k = 0;
    while (pos < n || k < this.nev) {
      const ea = k < this.nev ? Math.min(n, Math.max(pos, this.ev[k].at)) : n, ga = this.grabAt >= 0 && this.grabAt < n ? Math.max(pos, this.grabAt) : n;
      // the cascade's next group due
      let qa = n, qi = -1;
      for (let q = 0; q < this.pq; q++) if (this.pqAt[q] < qa) { qa = Math.max(pos, this.pqAt[q]); qi = q; }
      let at = ea < ga ? ea : ga; if (qa < at) at = qa;
      if (at > pos) { this.seg(pos, at); pos = at; }
      if (qi >= 0 && qa === pos) {
        this.strikeGroup(this.pqG[qi], this.pqA[qi], this.pqFc[qi]);
        const l = --this.pq; this.pqAt[qi] = this.pqAt[l]; this.pqG[qi] = this.pqG[l]; this.pqA[qi] = this.pqA[l]; this.pqFc[qi] = this.pqFc[l];
        continue;
      }
      if (ga === pos && this.grabAt >= 0 && this.grabAt < n) {
        // the hand closes on it
        this.grabAt = -1; this.choke = 0.025;
        if (this.engine === 1) this.damping(); else this.bank.set(this.sr, this.tm, this.dm * this.choke);
        if (this.bell) this.bell.set(this.sr, this.tm, this.dm * this.choke);
        continue;
      }
      if (k < this.nev && ea === pos) { this.strike(this.ev[k++]); continue; }
      if (pos >= n) break;
    }
    this.nev = 0;
    if (this.grabAt >= n) this.grabAt -= n;
    if (this.engine === 2) for (let q = 0; q < this.pq; q++) this.pqAt[q] -= n;
    // near: the close mic (mono); far, farR: the overhead pair
    const L = this.far, R = this.farR, N = this.near;
    let pk = 0;
    for (let i = 0; i < n; i++) { const l = L[i], r = R[i]; N[i] = 0.5 * (l + r); const a = (l < 0 ? -l : l) + (r < 0 ? -r : r); if (a > pk) pk = a; }
    // quiet for a while and nothing still to come: rest (and stop costing anything)
    let live = this.pn > 0 || this.bE > 0 || this.pE > 0 || (this.engine === 2 && this.pq > 0);
    if (this.engine === 2) { if (this.bank.prune() > 0) live = true; }
    if (this.bell && this.bell.prune() > 0) live = true;
    if (pk < 1e-5 && !(this.engine === 2 && live)) this.quiet += n; else this.quiet = 0;
    if (this.engine === 1 && this.quiet > this.sr * 0.05 && !(this.pn > 0 || this.bE > 0 || this.pE > 0)) {
      this.buf.fill(0); this.z.fill(0); this.xl.reset(); this.dh.reset(); this.idle = 96; this.quiet = 0; this.on = false;
      if (this.bell) { if (this.bell.live) this.on = true; else this.bell.clear(); }
    } else if (this.engine === 2) this.on = live;
    else this.on = true;
    return this.on;
  }
  // stop at once (the kit switched model, or rests): silence, no state left
  clear() {
    if (this.engine === 1) { this.buf.fill(0); this.z.fill(0); this.xl.reset(); this.dh.reset(); this.bE = 0; this.idle = 96; } else { this.bank.clear(); this.wf = 0; }
    if (this.bell) this.bell.clear();
    this.pn = 0; this.pE = 0; this.on = false; this.nev = 0; if (this.engine === 2) this.pq = 0; this.grabAt = -1; this.choke = 1; this.quiet = 0;
  }
}
`;
