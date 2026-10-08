// @ts-check
// core.eq8: Slide Rule. An eight-band parametric EQ you shape by dragging its bands over a live spectrum
// (ui/editors/eq8.js). Each band is a bell, a low or high shelf, a low or high cut (12, 24 or 48 dB per octave), a
// notch or a band pass, with its own frequency, gain and Q; an output gain and auto gain come after (a trim guessed
// from the curve at once, then matched to what plays over a few seconds, too slowly to pump).
//
// The filters are the Audio EQ Cookbook's biquads (eq8-curve.js, the same functions the window draws its curve with),
// run in Direct Form I in double precision. Nothing jumps: the host glides frequency, gain and Q each block, and the
// coefficients are interpolated sample by sample across the block; a band switched on or off, or changed to another
// shape, crossfades over 12 ms (a new shape waits for the old one to fade out, then comes in fresh). At its defaults
// every band is off and the output is the input, sample for sample.
//
// Bands are parked across the spectrum (eq8-curve.js EQ_PARK: 60, 150, 300, 700 Hz, 1.5, 3, 6, 12 kHz) as bells at
// 0 dB, so turning one on changes nothing until its gain moves. `solo` is monitoring: the window sets it on the live
// instance only (never in the song), to play just one band's region of the input.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { EQ_SOURCE, EQ_TYPES, EQ_PARK, EQ_BANDS, eqSections, eqBandPow, EQ_STRIDE } from './eq8-curve.js';

const WHERE = [
  'the low end: kick and bass weight',
  'the bottom of the low mids: body, boom',
  'the low mids: mud',
  'the mids: boxiness, honk',
  'the upper mids: definition',
  'presence and bite',
  'brilliance, sibilance',
  'air',
];
const SHAPES_DESC =
  'BELL boosts or cuts around FREQ by GAIN; LOW SHELF / HIGH SHELF lift or lower everything below / above FREQ by GAIN; LOW CUT / HIGH CUT 12, 24 or 48 remove what is below / above FREQ at that many dB per octave (GAIN unused); NOTCH takes out a narrow band at FREQ (Q sets how narrow); BAND PASS keeps only the region around FREQ';

// (a Q reads as a plain number: "1.40", "12.0")
const qText = (v) => (+v < 10 ? (+v).toFixed(2) : (+v).toFixed(1));
const params = [];
for (let n = 1; n <= EQ_BANDS; n++) {
  const group = `Band ${n}`,
    park = EQ_PARK[n - 1],
    face = false; // (the bands live in the window; the face shows the curve)
  const at = park >= 1000 ? `${park / 1000} kHz` : `${park} Hz`;
  params.push(
    {
      key: `b${n}_on`,
      label: `BAND ${n} ON`,
      opts: ['OFF', 'ON'],
      def: 0,
      group,
      face,
      desc: `band ${n} in (ON) or out (OFF: it does nothing, whatever its settings)`,
    },
    {
      key: `b${n}_type`,
      label: `BAND ${n} TYPE`,
      opts: EQ_TYPES,
      def: 0,
      group,
      face,
      desc: n === 1 ? `band 1's shape. ${SHAPES_DESC}` : `band ${n}'s shape (the same choices as b1_type)`,
    },
    {
      key: `b${n}_freq`,
      label: `BAND ${n} FREQ`,
      min: 20,
      max: 20000,
      def: park,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      group,
      face,
      desc: `band ${n}'s frequency (parked at ${at}, ${WHERE[n - 1]})`,
    },
    {
      key: `b${n}_gain`,
      label: `BAND ${n} GAIN`,
      min: -24,
      max: 24,
      def: 0,
      unit: 'dB',
      role: 'tone',
      group,
      face,
      desc: `band ${n}'s boost (+) or cut (-) for a bell or a shelf: 2-4 dB is a clear move; cuts, notch and band pass ignore it`,
    },
    {
      key: `b${n}_q`,
      label: `BAND ${n} Q`,
      min: 0.1,
      max: 24,
      def: 1,
      curve: 'log',
      unit: 'x',
      role: 'shape',
      group,
      face,
      fmt: qText,
      desc: `band ${n}'s width: 1 is about two octaves wide, 4-10 narrow and surgical, 0.5 broad; on a shelf or a cut, the bump at its corner instead (1 none, 2 a 6 dB bump, up to 4)`,
    },
  );
}
params.push(
  {
    key: 'out_gain',
    label: 'OUTPUT',
    min: -18,
    max: 18,
    def: 0,
    unit: 'dB',
    role: 'level',
    group: 'Output',
    desc: 'the level after the EQ: bring a boost back down or make up for cuts (auto gain does it by itself when ON)',
  },
  {
    key: 'out_auto',
    label: 'AUTO GAIN',
    opts: ['OFF', 'ON'],
    def: 0,
    role: 'level',
    group: 'Output',
    desc: 'ON holds the loudness where it was, so a move is judged at the same level: a trim guessed from the curve at once, then matched to what plays over a few seconds (K-weighted, as a loudness meter hears), too slowly to pump',
  },
  {
    key: 'solo',
    label: 'SOLO',
    opts: ['OFF', ...Array.from({ length: EQ_BANDS }, (_, i) => `BAND ${i + 1}`)],
    def: 0,
    auto: false,
    hidden: true,
    desc: "monitoring only: the window's Solo sets it on the playing device (never in the song) to hear one band's region alone. Leave it OFF",
  },
);

// presets: starting points, each a few bands; params left out stay at their defaults (bands off, parked)
const band = (n, type, freq, gain, q = 1) => ({
  [`b${n}_on`]: 1,
  [`b${n}_type`]: type,
  [`b${n}_freq`]: freq,
  [`b${n}_gain`]: gain,
  [`b${n}_q`]: q,
});
const presets = [
  {
    name: 'Clean up the low end',
    blurb: 'Rumble out below 40 Hz (24 dB/oct), 3 dB of mud out at 280 Hz',
    params: { ...band(1, 'LOW CUT 24', 40, 0), ...band(3, 'BELL', 280, -3, 1.2) },
  },
  {
    name: 'Vocal presence',
    blurb: 'Low cut at 90 Hz, less mud at 300 Hz, +3 dB at 3 kHz, air from 10 kHz',
    params: {
      ...band(1, 'LOW CUT 12', 90, 0),
      ...band(3, 'BELL', 300, -2.5, 1.4),
      ...band(6, 'BELL', 3000, 3, 1),
      ...band(8, 'HIGH SHELF', 10000, 2),
    },
  },
  {
    name: 'Air',
    blurb: 'A high shelf from 10 kHz, +3.5 dB: sheen on top without the bite',
    params: { ...band(8, 'HIGH SHELF', 10000, 3.5) },
  },
  {
    name: 'Telephone',
    blurb: 'Only 400 Hz to 3 kHz, a honk at 1.4 kHz, auto gain holding the level',
    params: {
      ...band(1, 'LOW CUT 24', 400, 0),
      ...band(5, 'BELL', 1400, 5, 1.2),
      ...band(8, 'HIGH CUT 24', 3000, 0),
      out_auto: 1,
    },
  },
  {
    name: 'Kick: thump and click',
    blurb: 'Sub rumble out, +4 dB at 60 Hz, the box out at 350 Hz, click at 3.5 kHz',
    params: {
      ...band(1, 'LOW CUT 24', 28, 0),
      ...band(2, 'BELL', 60, 4, 1.2),
      ...band(4, 'BELL', 350, -4, 1.5),
      ...band(6, 'BELL', 3500, 4, 1.4),
    },
  },
  {
    name: 'Bass: weight and definition',
    blurb: 'Rumble out, +2.5 dB at 80 Hz, less mud at 250 Hz, +2.5 dB at 800 Hz',
    params: {
      ...band(1, 'LOW CUT 24', 30, 0),
      ...band(2, 'BELL', 80, 2.5, 1.2),
      ...band(3, 'BELL', 250, -3, 1.4),
      ...band(5, 'BELL', 800, 2.5, 1.2),
    },
  },
  {
    name: 'Tame the harsh edge',
    blurb: '3 dB out around 3.2 kHz, narrow, and a gentle 1.5 dB dip at 7 kHz',
    params: { ...band(6, 'BELL', 3200, -3, 2), ...band(7, 'BELL', 7000, -1.5, 1.5) },
  },
];

// what the library page plays it at (app/library.html: def.demo), as numbers (a demo isn't normalised as presets are)
const demo = {
  params: Object.fromEntries(
    Object.entries(presets[1].params).map(([k, v]) => [k, typeof v === 'string' ? EQ_TYPES.indexOf(v) : v]),
  ),
};

// The face's screen in the rack (ui/faces.js): the curve, drawn from the same functions the kernel runs. Called with a
// 2D context already scaled to CSS pixels, its size and the params; colours from the face.
function screen(g, { w, h, ink, dim }, values) {
  const sr = 48000,
    c = new Float64Array(EQ_BANDS * EQ_STRIDE),
    ns = new Int32Array(EQ_BANDS),
    on = [];
  for (let n = 1; n <= EQ_BANDS; n++) {
    const v = (k, d) => (Number.isFinite(+values[`b${n}_${k}`]) ? +values[`b${n}_${k}`] : d);
    on[n - 1] = v('on', 0) >= 0.5;
    ns[n - 1] = eqSections(
      Math.round(v('type', 0)),
      v('freq', EQ_PARK[n - 1]),
      v('gain', 0),
      v('q', 1),
      sr,
      c,
      (n - 1) * EQ_STRIDE,
    );
  }
  const lo = Math.log(20),
    hi = Math.log(20000),
    range = 18,
    mid = h / 2;
  g.strokeStyle = dim;
  g.lineWidth = 1;
  for (const f of [100, 1000, 10000]) {
    const x = Math.round(((Math.log(f) - lo) / (hi - lo)) * w) + 0.5;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, Math.round(mid) + 0.5);
  g.lineTo(w, Math.round(mid) + 0.5);
  g.stroke();
  g.strokeStyle = ink;
  g.lineWidth = 1.5;
  g.beginPath();
  for (let x = 0; x <= w; x += 1) {
    const wv = (2 * Math.PI * Math.exp(lo + ((hi - lo) * x) / w)) / sr,
      cw = Math.cos(wv),
      c2w = Math.cos(2 * wv),
      sw = Math.sin(wv),
      s2w = Math.sin(2 * wv);
    let p = 1;
    for (let b = 0; b < EQ_BANDS; b++) if (on[b]) p *= eqBandPow(c, b * EQ_STRIDE, ns[b], cw, c2w, sw, s2w);
    const db = 10 * Math.log10(Math.max(p, 1e-12)),
      y = mid - (Math.max(-range, Math.min(range, db)) / range) * (mid - 2);
    if (x) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
}

export default defineDevice({
  id: 'core.eq8',
  name: 'Slide Rule',
  kind: 'effect',
  cat: 'eq',
  by: 'overdub',
  blurb: 'Eight EQ bands you drag over a live spectrum',
  nod: 'the big-screen parametric EQs mixers draw on, and the console channel EQ before them',
  editor: 'eq8',
  screen,
  params,
  presets,
  demo,
  // a slide rule: yellowed bamboo under celluloid, engraved in black
  look: {
    color: '#d4b16a',
    ink: '#1c1913',
    shape: 'rack',
    finish: 'flat',
    knob: 'black',
    label: 'plate',
    led: '#f3e6c2',
  },
  tail: 0.5,
  kernel: kernel(String.raw`
// The filter math (devices/builtin/eq8-curve.js): the same functions the device window draws its curve with.
${EQ_SOURCE}
const NB = 8, ST = 20;   // bands; coefficient numbers per band (four sections of five)
return {
  create({ sr }) {
    const keys = [];
    for (let b = 1; b <= NB; b++) keys.push(['b' + b + '_on', 'b' + b + '_type', 'b' + b + '_freq', 'b' + b + '_gain', 'b' + b + '_q']);
    const tgt = new Float64Array(NB * ST), cur = new Float64Array(NB * ST), inc = new Float64Array(NB * ST);
    const ns = new Int32Array(NB), ty = new Int32Array(NB).fill(-1), live = new Uint8Array(NB), onv = new Uint8Array(NB);
    const mix = new Float64Array(NB), last = new Float64Array(NB * 4).fill(-1);
    const zl = new Float64Array(NB * 16), zr = new Float64Array(NB * 16);   // Direct Form I: x1 x2 y1 y2 per section
    // the solo: one band's region, from the input
    const sTgt = new Float64Array(ST), sCur = new Float64Array(ST), sInc = new Float64Array(ST), sLast = new Float64Array(2).fill(-1);
    const szl = new Float64Array(16), szr = new Float64Array(16);
    let sNs = 0, sKey = 0, sMix = 0, sLive = 0;
    let dL = new Float32Array(128), dR = new Float32Array(128), iL = new Float32Array(128), iR = new Float32Array(128);
    const RAMP = Math.round(0.012 * sr);
    // auto gain: the curve's first guess (eqAutoGainDb), then a slow correction by what it hears. The input and the
    // output (with the guess applied) are K-weighted and averaged over about 3 s; the correction follows their ratio
    // over about 2 s, held while nothing plays or a band is soloed. Moving a band moves the guess at once, so the
    // level holds through a move and the correction only takes up what the guess got wrong for this material.
    const autoT = eqAutoTables(sr, 48), kc = new Float64Array(10), kz = new Float64Array(32);
    eqKCoefs(sr, kc);
    let autoDb = 0, autoDirty = true, autoWait = 0, onSig = -1, autoWas = 0, pIn = 0, pOut = 0, corr = 0, heard = 0;
    // the output gain glides through two one-poles in a row (about 25 ms all told), so even its slope never jumps
    const outA = Math.exp(-1 / (0.012 * sr));
    let g1 = 1, g2 = 1;
    let first = true;
    // the K-weighted energy of a block (X untouched), its filter state at kz[z..z+7]
    function kEnergy(X, n, z) {
      const b0 = kc[0], b1 = kc[1], b2 = kc[2], a1 = kc[3], a2 = kc[4], c0 = kc[5], c1 = kc[6], c2 = kc[7], d1 = kc[8], d2 = kc[9];
      let x1 = kz[z], x2 = kz[z + 1], y1 = kz[z + 2], y2 = kz[z + 3], u1 = kz[z + 4], u2 = kz[z + 5], v1 = kz[z + 6], v2 = kz[z + 7], e = 0;
      for (let i = 0; i < n; i++) {
        const x = X[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        const v = c0 * y + c1 * u1 + c2 * u2 - d1 * v1 - d2 * v2;
        u2 = u1; u1 = y; v2 = v1; v1 = v;
        e += v * v;
      }
      if (y1 < 1e-30 && y1 > -1e-30) y1 = 0; if (y2 < 1e-30 && y2 > -1e-30) y2 = 0;
      if (v1 < 1e-30 && v1 > -1e-30) v1 = 0; if (v2 < 1e-30 && v2 > -1e-30) v2 = 0;
      kz[z] = x1; kz[z + 1] = x2; kz[z + 2] = y1; kz[z + 3] = y2; kz[z + 4] = u1; kz[z + 5] = u2; kz[z + 6] = v1; kz[z + 7] = v2;
      return e;
    }
    // run one section over a block (in place), its coefficients stepping by inc when it moves
    function section(X, Y, n, c, o, z, zx, zy, moving, d) {
      let b0 = c[o], b1 = c[o + 1], b2 = c[o + 2], a1 = c[o + 3], a2 = c[o + 4];
      let x1 = zx[z], x2 = zx[z + 1], y1 = zx[z + 2], y2 = zx[z + 3];
      let u1 = zy[z], u2 = zy[z + 1], v1 = zy[z + 2], v2 = zy[z + 3];
      if (moving) {
        const d0 = d[o], d1 = d[o + 1], d2 = d[o + 2], d3 = d[o + 3], d4 = d[o + 4];
        for (let i = 0; i < n; i++) {
          b0 += d0; b1 += d1; b2 += d2; a1 += d3; a2 += d4;
          const x = X[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y; X[i] = y;
          const u = Y[i], v = b0 * u + b1 * u1 + b2 * u2 - a1 * v1 - a2 * v2;
          u2 = u1; u1 = u; v2 = v1; v1 = v; Y[i] = v;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const x = X[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y; X[i] = y;
          const u = Y[i], v = b0 * u + b1 * u1 + b2 * u2 - a1 * v1 - a2 * v2;
          u2 = u1; u1 = u; v2 = v1; v1 = v; Y[i] = v;
        }
      }
      // (a long silence decays the state toward subnormals: flush it)
      if (y1 < 1e-30 && y1 > -1e-30) y1 = 0; if (y2 < 1e-30 && y2 > -1e-30) y2 = 0;
      if (v1 < 1e-30 && v1 > -1e-30) v1 = 0; if (v2 < 1e-30 && v2 > -1e-30) v2 = 0;
      zx[z] = x1; zx[z + 1] = x2; zx[z + 2] = y1; zx[z + 3] = y2;
      zy[z] = u1; zy[z + 1] = u2; zy[z + 2] = v1; zy[z + 3] = v2;
    }
    return {
      process(L, R, n, P) {
        if (dL.length < n) { dL = new Float32Array(n); dR = new Float32Array(n); iL = new Float32Array(n); iR = new Float32Array(n); }
        const soloP = P.solo | 0, auto = P.out_auto >= 0.5 ? 1 : 0;
        if (soloP > 0 || sMix > 0) for (let i = 0; i < n; i++) { iL[i] = L[i]; iR[i] = R[i]; }
        // (auto gain switched on starts its listening afresh)
        if (auto && !autoWas) { kz.fill(0); pIn = 0; pOut = 0; corr = 0; heard = 0; }
        const listen = auto && soloP === 0 && sMix <= 0;
        const eIn = listen ? kEnergy(L, n, 0) + kEnergy(R, n, 8) : 0;
        let changed = false, sig = 0;
        for (let b = 0; b < NB; b++) {
          const k = keys[b], o = b * ST, lo = b * 4;
          const on = P[k[0]] >= 0.5 ? 1 : 0, type = P[k[1]] | 0, f = P[k[2]], g = P[k[3]], q = P[k[4]];
          onv[b] = on; if (on) sig |= 1 << b;
          // another shape waits until this one has faded out, then starts fresh
          if (type !== ty[b] && (first || mix[b] <= 0)) { ty[b] = type; live[b] = 0; last[lo] = -1; }
          const want = on && type === ty[b] ? 1 : 0;
          if (!want && mix[b] <= 0) { live[b] = 0; continue; }
          let moving = false;
          if (last[lo] !== f || last[lo + 1] !== g || last[lo + 2] !== q || last[lo + 3] !== ty[b]) {
            last[lo] = f; last[lo + 1] = g; last[lo + 2] = q; last[lo + 3] = ty[b];
            ns[b] = eqSections(ty[b], f, g, q, sr, tgt, o);
            changed = true;
            const m = ns[b] * 5;
            if (first || !live[b]) for (let j = 0; j < m; j++) cur[o + j] = tgt[o + j];
            else { moving = true; for (let j = 0; j < m; j++) inc[o + j] = (tgt[o + j] - cur[o + j]) / n; }
          }
          if (!live[b]) { for (let j = 0; j < 16; j++) { zl[b * 16 + j] = 0; zr[b * 16 + j] = 0; } live[b] = 1; }
          const m0 = first ? want : mix[b];
          let m1 = want ? m0 + n / RAMP : m0 - n / RAMP;
          m1 = m1 < 0 ? 0 : m1 > 1 ? 1 : m1;
          mix[b] = m1;
          const blend = m0 < 1 || m1 < 1;
          if (blend) for (let i = 0; i < n; i++) { dL[i] = L[i]; dR[i] = R[i]; }
          for (let s = 0; s < ns[b]; s++) section(L, R, n, cur, o + 5 * s, b * 16 + 4 * s, zl, zr, moving, inc);
          if (moving) for (let j = 0; j < ns[b] * 5; j++) cur[o + j] = tgt[o + j];
          if (blend) for (let i = 0; i < n; i++) { let mm = m0 + (m1 - m0) * (i + 1) / n; mm = mm * mm * (3 - 2 * mm); L[i] = dL[i] + mm * (L[i] - dL[i]); R[i] = dR[i] + mm * (R[i] - dR[i]); }
        }
        const eOut = listen ? kEnergy(L, n, 16) + kEnergy(R, n, 24) : 0;
        // solo: one band's region of the input, crossfaded in over the EQ. Another band, or this band in another
        // shape, waits for it to fade out (sKey is the band and its shape: band * 16 + type).
        const soloK = soloP > 0 ? soloP * 16 + (P[keys[soloP - 1][1]] | 0) : 0;
        if (soloK !== sKey && (first || sMix <= 0)) { sKey = soloK; sLive = 0; sLast[0] = -1; }
        const sWant = sKey > 0 && soloK === sKey ? 1 : 0;
        if (sWant || sMix > 0) {
          const k = keys[(sKey >> 4) - 1], type = sKey & 15, f = P[k[2]], q = P[k[4]];
          let moving = false;
          if (sLast[0] !== f || sLast[1] !== q) {
            sNs = eqSoloSections(type, f, q, sr, sTgt, 0);
            sLast[0] = f; sLast[1] = q;
            if (first || !sLive) for (let j = 0; j < sNs * 5; j++) sCur[j] = sTgt[j];
            else { moving = true; for (let j = 0; j < sNs * 5; j++) sInc[j] = (sTgt[j] - sCur[j]) / n; }
          }
          if (!sLive) { szl.fill(0); szr.fill(0); sLive = 1; }
          for (let s = 0; s < sNs; s++) section(iL, iR, n, sCur, 5 * s, 4 * s, szl, szr, moving, sInc);
          if (moving) for (let j = 0; j < sNs * 5; j++) sCur[j] = sTgt[j];
          const m0 = first ? sWant : sMix;
          let m1 = sWant ? m0 + n / RAMP : m0 - n / RAMP;
          m1 = m1 < 0 ? 0 : m1 > 1 ? 1 : m1;
          sMix = m1;
          for (let i = 0; i < n; i++) { let mm = m0 + (m1 - m0) * (i + 1) / n; mm = mm * mm * (3 - 2 * mm); L[i] += mm * (iL[i] - L[i]); R[i] += mm * (iR[i] - R[i]); }
        }
        // the output: its gain, and auto gain: the curve's guess (worked out at most every fourth block while bands
        // move) and the correction, from what was heard while something played (a block over -80 dB, K-weighted)
        if (changed || sig !== onSig || auto !== autoWas) { autoDirty = true; onSig = sig; autoWas = auto; }
        if (auto && autoDirty && autoWait <= 0) { autoDb = eqAutoGainDb(tgt, ns, onv, NB, autoT); autoDirty = false; autoWait = 4; }
        if (autoWait > 0) autoWait--;
        if (listen && eIn > n * 1e-8) {
          const a = Math.exp(-n / (3 * sr));
          pIn = pIn * a + (1 - a) * eIn / n;
          pOut = pOut * a + (1 - a) * Math.pow(10, autoDb / 10) * eOut / n;
          heard += n;
          if (heard > sr / 2 && pOut > 1e-14) {
            const want = 10 * Math.log10(pIn / pOut);
            corr = want + (corr - want) * Math.exp(-n / (2 * sr));
            corr = corr < -18 ? -18 : corr > 18 ? 18 : corr;
          }
        }
        // (it starts where it is set, and lands exactly on its target, so 0 dB is the input sample for sample)
        const trim = autoDb + corr < -24 ? -24 : autoDb + corr > 24 ? 24 : autoDb + corr;
        const gT = dbg(P.out_gain + (auto ? trim : 0));
        if (first || (g2 !== gT && Math.abs(g1 - gT) <= 1e-9 * gT && Math.abs(g2 - gT) <= 1e-9 * gT)) { g1 = gT; g2 = gT; }
        if (g2 !== 1 || gT !== 1) for (let i = 0; i < n; i++) { g1 = gT + (g1 - gT) * outA; g2 = g1 + (g2 - g1) * outA; L[i] *= g2; R[i] *= g2; }
        first = false;
      },
    };
  },
};
`),
});
