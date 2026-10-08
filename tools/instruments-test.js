// The four acoustic-model instruments: core.piano (Baby Grand), core.organ (Rotor Cabinet), core.strings (Music
// Stands) and core.bassguitar (Flatwound). Nobody building this can listen, so each is held to the signatures that make
// it sound like what it is, measured on the canonical Node render (app/src/engine/node/render.js):
//
//   all       the test phrase at house level (-18.5..-13.5 LUFS, true peak <= -1 dBTP), no NaN, no denormals, two
//             renders bit-identical, playing harder raises the spectral centroid, a released note goes quiet, 16
//             voices at once within the CPU budget (25% of one core, the device check's own line)
//   piano     inharmonicity B by register (the stiff-string stretch), T60 falling up the keyboard, a two-stage decay,
//             dampers that stop a note and a top octave and a half that has none
//   organ     drawbar spectra (each registration's footages, tempered, folded back), the rotor's spin (the horn's
//             amplitude modulation at about 0.8 Hz slow and 6.8 Hz fast), single-trigger percussion
//   strings   a bowed attack (tenths of a second, faster when played harder), orchestral seating (violins left,
//             cellos right), a stereo section
//   bass      pick brighter than fingers, the bridge pickup brighter than the neck, the string stopping on release
//
// Then each passes checkDevice (kernel/check.js, full mode) in Chromium with no warnings.
//   node tools/instruments-test.js            NODE_ONLY=1 skips the browser
import { tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';
import { measure } from '../app/src/audio/measure.js';
import { phrase, bassPhrase, PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import { INSTRUMENTS } from '../app/src/devices/builtin/index.js';

const t = tally('instruments');
const SR = 48000,
  BPM = 120,
  BEAT = 60 / BPM;
const IDS = ['core.piano', 'core.organ', 'core.strings', 'core.bassguitar'];
const STAMP = '2026-09-30T00:00:00.000Z';
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));

function project(id, notes, params = {}, beats = PHRASE_BEATS) {
  return {
    ...createProject(),
    id: 'p_inst',
    title: id,
    key: null,
    tempo: BPM,
    meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [
      {
        id: 't_inst',
        name: 'Inst',
        kind: 'instrument',
        instrument: { device: id, params },
        inserts: [],
        clips: [
          {
            id: 'c_inst',
            kind: 'notes',
            start: 0,
            length: beats,
            notes: notes.map((n, i) => ({ id: 'n' + (i + 1), by: 'overdub', ...n })),
            by: 'overdub',
          },
        ],
        gain: 0,
        pan: 0,
        mute: false,
        solo: false,
        arm: false,
        by: 'overdub',
      },
    ],
  };
}
// notes in seconds -> a render
function play(id, notes, params = {}, secs = 4, tail = 0.5) {
  const beats = Math.ceil(secs / BEAT);
  const t0 = performance.now();
  const r = renderSong(
    project(
      id,
      notes.map((n) => ({ p: n.p, v: n.v ?? 0.8, t: n.t / BEAT, d: n.d / BEAT })),
      params,
      beats,
    ),
    { from: 0, to: beats, tail },
  );
  r.ms = performance.now() - t0;
  return r;
}
const slice = (r, a, b) => ({
  sr: r.sr,
  channels: r.channels.map((x) => x.subarray(Math.round(a * r.sr), Math.round(b * r.sr))),
});
function rms(x, a, b) {
  let s = 0;
  const i0 = Math.round(a * SR),
    i1 = Math.round(b * SR);
  for (let i = i0; i < i1; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, i1 - i0));
}
function goertzel(x, a, len, f) {
  const w = (2 * Math.PI * f) / SR,
    c = 2 * Math.cos(w);
  let s1 = 0,
    s2 = 0;
  for (let i = 0; i < len; i++) {
    const s = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1))) + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) * 4) / len;
}
function peakFreq(x, a, len, f, span = 0.02) {
  let best = 0,
    bf = f;
  for (let k = -80; k <= 80; k++) {
    const ff = f * (1 + (span * k) / 80),
      m = goertzel(x, a, len, ff);
    if (m > best) {
      best = m;
      bf = ff;
    }
  }
  const step = (f * span) / 80;
  for (let k = -20; k <= 20; k++) {
    const ff = bf + (step * k) / 20,
      m = goertzel(x, a, len, ff);
    if (m > best) {
      best = m;
      bf = ff;
    }
  }
  return bf;
}
// the RMS envelope in dB, 20 ms frames
function envelope(x, frame = 0.02) {
  const fl = Math.round(frame * SR),
    out = [];
  for (let a = 0; a + fl <= x.length; a += fl) {
    let s = 0;
    for (let i = a; i < a + fl; i++) s += x[i] * x[i];
    out.push(10 * Math.log10(s / fl + 1e-24));
  }
  return out;
}
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

// ------------------------------------------------------------------------------------------------ all four
console.log('the house rules, on the canonical render');
const defs = Object.fromEntries(INSTRUMENTS.filter((d) => IDS.includes(d.id)).map((d) => [d.id, d]));
t.ok(
  IDS.every((id) => defs[id]),
  `builtin/index.js registers ${IDS.filter((id) => defs[id]).join(', ')}`,
);
// the velocity test: one note in the instrument's own register, soft then hard, first half second
const VEL = { 'core.piano': 60, 'core.organ': 60, 'core.strings': 64, 'core.bassguitar': 40 };
const VEL_RISE = { 'core.piano': 1.25, 'core.organ': 1.02, 'core.strings': 1.2, 'core.bassguitar': 1.1 };
const BUDGET = 25;
// CPU on a shared machine moves with everything else running, so each instrument is timed next to a reference (Lamp
// Tines' GRAND, 16 voices: 3.3% of real time on an idle Apple Silicon core) and the budget scales with how slow the
// reference is right now. Best of two runs each.
const REF_IDLE = 2.1; // it was 3.3% until the 2026-10-01 performance pass made GRAND about 44% cheaper, bit-exact; recalibrated to 2.1% measured on a quiet machine
const sixteen = (id) =>
  Array.from({ length: 16 }, (_, k) => ({ p: (id === 'core.bassguitar' ? 28 : 36) + k * 3, v: 0.8, t: 0, d: 4 }));
function cpuOf(id) {
  const time = (dev, params) => {
    let best = Infinity,
      r = null;
    for (let i = 0; i < 2; i++) {
      r = play(dev, sixteen(id), params, 4, 0);
      best = Math.min(best, (r.ms / ((r.length / r.sr) * 1000)) * 100);
    }
    return { pct: best, r };
  };
  const ref = time('core.keys', { voice: 1 }).pct,
    me = time(id, {});
  return { cpu: me.pct, ref, budget: BUDGET * Math.max(1, ref / REF_IDLE), r: me.r };
}
const table = [];
for (const id of IDS) {
  const def = defs[id];
  if (!def) continue;
  const ph = (id === 'core.bassguitar' ? bassPhrase() : phrase()).map((n) => ({
    p: n.p,
    v: n.v,
    t: n.t * BEAT,
    d: n.d * BEAT,
  }));
  const a = play(id, ph, {}, PHRASE_BEATS * BEAT, 2),
    b = play(id, ph, {}, PHRASE_BEATS * BEAT, 2);
  const m = measure({ sr: a.sr, channels: a.channels });
  let nan = 0,
    den = 0,
    same = a.length === b.length;
  for (let c = 0; c < 2; c++) {
    const x = a.channels[c],
      y = b.channels[c];
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (!Number.isFinite(v)) nan++;
      else if (v !== 0 && Math.abs(v) < 1.2e-38) den++;
      if (same && v !== y[i]) same = false;
    }
  }
  t.ok(
    m.lufs >= -18.5 && m.lufs <= -13.5,
    `${id}: the ${id === 'core.bassguitar' ? 'bass ' : ''}test phrase at ${m.lufs} LUFS (house: -18.5..-13.5)`,
  );
  t.ok(m.truePeak <= -1, `${id}: true peak ${m.truePeak} dBTP (want <= -1)`);
  t.ok(!nan && !den, `${id}: no NaN (${nan}) and no denormals (${den}) in ${a.length * 2} samples`);
  t.ok(same, `${id}: two renders are bit-identical`);
  // velocity
  const cent = [0.25, 0.6, 0.95].map((v) => {
    const r = play(id, [{ p: VEL[id], v, t: 0, d: 1.5 }], {}, 2, 0.2);
    return measure(slice(r, 0, 0.5)).centroid;
  });
  t.ok(
    cent[1] > cent[0] && cent[2] > cent[1] && cent[2] >= cent[0] * VEL_RISE[id],
    `${id}: harder is brighter: centroid ${cent.map(Math.round).join(' / ')} Hz at velocity 0.25 / 0.6 / 0.95 (want rising, x${VEL_RISE[id]} or more)`,
  );
  // release: a held note, let go at 1 s
  const rp = VEL[id] + (id === 'core.bassguitar' ? 0 : 0),
    rr = play(
      id,
      [{ p: rp, v: 0.8, t: 0, d: 1 }],
      { ...(id === 'core.piano' ? { room: 0 } : id === 'core.strings' ? { hall: 0 } : {}) },
      3,
      0.5,
    );
  const held = rms(rr.channels[0], 0.8, 0.98),
    after = rms(rr.channels[0], 1.6, 1.8);
  t.ok(
    dB(held) - dB(after) >= 40,
    `${id}: let go of a note and it stops: ${fmt(dB(held) - dB(after))} dB down 0.6 s after release (want >= 40)`,
  );
  // 16 voices at once
  const { cpu, ref, budget, r: cr } = cpuOf(id);
  const mc = measure({ sr: cr.sr, channels: cr.channels });
  t.ok(
    cpu <= budget && mc.truePeak <= 0,
    `${id}: 16 notes held for 4 s render at ${fmt(cpu)}% of real time (budget ${fmt(budget)}%: ${BUDGET}% on an idle machine, where the reference renders at ${REF_IDLE}%; it took ${fmt(ref)}% now), true peak ${mc.truePeak} dBTP`,
  );
  table.push([
    id,
    def.name,
    m.lufs,
    m.truePeak,
    m.centroid,
    m.correlation,
    cent.map(Math.round).join('/'),
    fmt(cpu) + '%',
  ]);
}
console.log(
  '\n  ' +
    ['id', 'name', 'LUFS', 'dBTP', 'centroid', 'corr', 'centroid by vel', 'cpu@16'].join(' | ') +
    '\n' +
    table.map((r) => '  ' + r.join(' | ')).join('\n') +
    '\n',
);

// ------------------------------------------------------------------------------------------------ piano
console.log('core.piano: strings, hammers and dampers');
if (defs['core.piano']) {
  const Bdesign = (p) =>
    p >= 48 ? 1.3e-4 * Math.pow(2, ((p - 48) / 12) * 1.15) : 1.3e-4 * Math.pow(2, ((48 - p) / 12) * 0.62);
  const t60 = {};
  for (const p of [33, 60, 84, 96]) {
    const secs = p < 50 ? 24 : 12;
    const r = play('core.piano', [{ p, v: 0.7, t: 0, d: secs }], { room: 0 }, secs, 0.1),
      x = r.channels[0];
    const env = envelope(x),
      pk = Math.max(...env),
      ip = env.indexOf(pk);
    const at = (d) => {
      for (let i = ip; i < env.length; i++) if (env[i] < pk - d) return i * 0.02;
      return Infinity;
    };
    t60[p] = { early: at(10) * 6, late: (at(40) - at(25)) * 4 };
    if (p === 33 || p === 60) {
      // B from the first eight partials (stretched against the measured fundamental)
      const f0 = mtof(p),
        fs = [];
      for (let k = 1; k <= 8; k++) fs.push([k, peakFreq(x, 2400, 24000, f0 * k * Math.sqrt(1 + Bdesign(p) * k * k))]);
      let B = 1e-6,
        best = 1e-6,
        err = Infinity;
      for (; B < 0.02; B *= 1.01) {
        let e = 0;
        for (const [k, f] of fs) {
          const pr = k * fs[0][1] * Math.sqrt((1 + B * k * k) / (1 + B));
          e += ((f - pr) / f) ** 2;
        }
        if (e < err) {
          err = e;
          best = B;
        }
      }
      const ratio = best / Bdesign(p);
      t.ok(
        ratio > 0.65 && ratio < 1.5,
        `piano p${p}: inharmonicity B ${best.toExponential(2)} measured from partials 1-8 (designed ${Bdesign(p).toExponential(2)}; real grands ~1e-4..4e-4 here); partial 8 sits ${fmt(1200 * Math.log2(fs[7][1] / (8 * fs[0][1])))} cents sharp of 8 x f1`,
      );
    }
  }
  t.note(
    `piano T60 (early from the first 10 dB, late from -25 to -40 dB): ${Object.entries(t60)
      .map(([p, v]) => `p${p} ${fmt(v.early)}/${fmt(v.late)} s`)
      .join(', ')}`,
  );
  t.ok(
    t60[33].late > t60[60].late && t60[60].late > t60[84].late && t60[84].late > t60[96].late,
    'piano: notes ring shorter up the keyboard (late T60 falls from p33 to p96)',
  );
  t.ok(
    t60[33].late >= 12 && t60[60].late >= 5 && t60[60].late <= 16 && t60[96].late <= 3,
    `piano: T60 in a grand's range (bass ${fmt(t60[33].late)} s >= 12, middle C ${fmt(t60[60].late)} s in 5..16, C7 ${fmt(t60[96].late)} s <= 3)`,
  );
  t.ok(
    t60[60].late > 1.8 * t60[60].early,
    `piano: a two-stage decay at middle C (prompt ${fmt(t60[60].early)} s, aftersound ${fmt(t60[60].late)} s)`,
  );
  // dampers: none above p88
  const up = (d) => play('core.piano', [{ p: 96, v: 0.7, t: 0, d }], { room: 0 }, 2, 0.2).channels[0];
  const hx = up(1.6),
    rx = up(0.5);
  const diff = dB(rms(hx, 0.9, 1.1)) - dB(rms(rx, 0.9, 1.1));
  t.ok(
    Math.abs(diff) < 1,
    `piano: the top strings have no dampers (C7 let go at 0.5 s is within ${fmt(Math.abs(diff), 2)} dB of one held)`,
  );
  const low = (d) => play('core.piano', [{ p: 40, v: 0.7, t: 0, d }], { room: 0 }, 2, 0.2).channels[0];
  const lh = low(1.6),
    lr = low(0.5);
  t.ok(
    dB(rms(lh, 0.9, 1.1)) - dB(rms(lr, 0.9, 1.1)) > 30,
    `piano: the dampers stop an E2 (${fmt(dB(rms(lh, 0.9, 1.1)) - dB(rms(lr, 0.9, 1.1)))} dB quieter 0.5 s after letting go than held)`,
  );
  // the player's seat
  const sideOf = (p) => {
    const r = play('core.piano', [{ p, v: 0.7, t: 0, d: 1 }], { room: 0 }, 1.5, 0.2);
    return dB(rms(r.channels[1], 0, 1)) - dB(rms(r.channels[0], 0, 1));
  };
  const lo = sideOf(36),
    hi = sideOf(90);
  t.ok(lo < -1 && hi > 1, `piano: low notes left (${fmt(lo)} dB R-L), high notes right (${fmt(hi)} dB)`);
}

// ------------------------------------------------------------------------------------------------ organ
console.log('core.organ: drawbars, percussion and the rotor');
if (defs['core.organ']) {
  // the drawbar spectra, straight out (no cabinet), C3
  const p = 48,
    f0 = mtof(p),
    len = 24000;
  const foot = [-12, 7, 0, 12, 19, 24, 28, 31, 36];
  const spec = (reg) => {
    const x = play('core.organ', [{ p, v: 0.8, t: 0, d: 1.5 }], { reg, cab: 0, drive: 0, click: 0 }, 2, 0.2)
      .channels[0];
    const ref = goertzel(x, 9600, len, f0);
    return { x, lv: foot.map((s) => dB(goertzel(x, 9600, len, f0 * Math.pow(2, s / 12))) - dB(ref)) };
  };
  const jazz = spec(2),
    full = spec(4),
    flute = spec(0);
  t.note(
    `organ drawbar levels vs 8' (dB), C3: JAZZ ${jazz.lv.map((v) => fmt(v, 0)).join(' ')} | FULL ${full.lv.map((v) => fmt(v, 0)).join(' ')} | FLUTE ${flute.lv.map((v) => fmt(v, 0)).join(' ')}`,
  );
  t.ok(
    Math.abs(jazz.lv[0]) < 2 && Math.abs(jazz.lv[1]) < 2 && jazz.lv[3] < -40 && jazz.lv[8] < -40,
    `organ JAZZ (888000000): 16' and 5 1/3' level with 8' (${fmt(jazz.lv[0])}, ${fmt(jazz.lv[1])} dB), nothing at 4' or 1'`,
  );
  t.ok(
    full.lv.slice(3).every((v) => v > -6),
    `organ FULL (888888888): every footage within 6 dB of 8' (${full.lv.map((v) => fmt(v, 0)).join(' ')})`,
  );
  t.ok(
    flute.lv[0] < -40 && flute.lv[3] > -14 && flute.lv[3] < -10,
    `organ FLUTE (008400000): no 16', 4' at ${fmt(flute.lv[3])} dB (drawbar 4 is four 3 dB steps under 8)`,
  );
  // the 2 2/3' is the tempered fifth (19 semitones), not a pure 3rd harmonic
  const f3 = peakFreq(full.x, 9600, 48000, f0 * 2.9966, 0.004);
  const c = 1200 * Math.log2(f3 / (3 * f0));
  t.ok(
    c < -1.2 && c > -2.8,
    `organ: the 2 2/3' wheel is the tempered fifth, ${fmt(c, 2)} cents under a pure 3rd harmonic (ET: -1.96)`,
  );
  // percussion: struck on a detached note, not on a legato one
  const h2 = (notes, perc) => {
    const x = play('core.organ', notes, { perc, cab: 0, drive: 0, click: 0, reg: 2 }, 2.5, 0.2).channels[0];
    return (at, f) => dB(goertzel(x, Math.round(at * SR), 2400, f));
  };
  const off = h2([{ p: 60, t: 0, d: 1 }], 0),
    on = h2([{ p: 60, t: 0, d: 1 }], 1);
  const pDb = on(0.01, mtof(72)) - off(0.01, mtof(72));
  t.ok(pDb > 10, `organ PERC 2ND: the 4' is struck (${fmt(pDb)} dB more at the octave in the first 60 ms)`);
  const lg = h2(
      [
        { p: 48, t: 0, d: 2 },
        { p: 60, t: 1, d: 1 },
      ],
      1,
    ),
    lg0 = h2(
      [
        { p: 48, t: 0, d: 2 },
        { p: 60, t: 1, d: 1 },
      ],
      0,
    );
  const lDb = lg(1.01, mtof(72)) - lg0(1.01, mtof(72));
  t.ok(Math.abs(lDb) < 3, `organ PERC: single trigger, a note played over a held one isn't struck (${fmt(lDb)} dB)`);
  // the rotor: the horn's throw shows as amplitude modulation of the top end, ~0.8 Hz slow, ~6.8 Hz fast
  const amRate = (rotor) => {
    const r = play(
      'core.organ',
      [
        { p: 72, t: 0, d: 10 },
        { p: 76, t: 0, d: 10 },
        { p: 79, t: 0, d: 10 },
      ],
      { reg: 4, rotor, cab: 1 },
      10,
      0,
    );
    const x = r.channels[0],
      fl = 480,
      env = [];
    let prev = 0;
    for (let a = Math.round(4 * SR); a + fl <= Math.round(10 * SR); a += fl) {
      let s = 0;
      for (let i = a; i < a + fl; i++) {
        const h = x[i] - prev;
        prev = x[i];
        s += h * h;
      }
      env.push(Math.sqrt(s / fl));
    }
    const mean = env.reduce((u, v) => u + v, 0) / env.length,
      e = env.map((v) => v - mean),
      fr = 100;
    let best = 0,
      bf = 0;
    for (let f = 0.3; f <= 10; f += 0.02) {
      let re = 0,
        im = 0;
      for (let i = 0; i < e.length; i++) {
        re += e[i] * Math.cos((2 * Math.PI * f * i) / fr);
        im += e[i] * Math.sin((2 * Math.PI * f * i) / fr);
      }
      const m = re * re + im * im;
      if (m > best) {
        best = m;
        bf = f;
      }
    }
    return { hz: bf, depth: dB(Math.max(...env)) - dB(Math.min(...env)) };
  };
  const slow = amRate(0),
    fast = amRate(1);
  t.ok(
    slow.hz > 0.6 && slow.hz < 1.0,
    `organ ROTOR SLOW: the horn throws the top end at ${fmt(slow.hz, 2)} Hz (${fmt(slow.depth)} dB swing; target 0.83)`,
  );
  t.ok(
    fast.hz > 6.2 && fast.hz < 7.4,
    `organ ROTOR FAST: ${fmt(fast.hz, 2)} Hz (${fmt(fast.depth)} dB swing; target 6.8)`,
  );
}

// ------------------------------------------------------------------------------------------------ strings
console.log('core.strings: bows and seating');
if (defs['core.strings']) {
  const attack = (v) => {
    // the power envelope averaged over six notes, so the players' slow beating (the section's swell) averages out
    let env = null;
    for (const p of [55, 60, 64, 67, 72, 76]) {
      const e = envelope(play('core.strings', [{ p, v, t: 0, d: 2.5 }], { hall: 0 }, 3, 0.2).channels[0], 0.01);
      env = env ? env.map((u, i) => u + Math.pow(10, e[i] / 10)) : e.map((u) => Math.pow(10, u / 10));
    }
    env = env.map((u) => 10 * Math.log10(u / 6));
    // the held level: the mean power from 0.4 to 1.2 s (the section's own beating swells around it)
    const held = 10 * Math.log10(env.slice(40, 120).reduce((u, e) => u + Math.pow(10, e / 10), 0) / 80);
    const on = env.findIndex((e) => e > held - 40),
      at = env.findIndex((e) => e > held - 3);
    return (at - on) * 0.01;
  };
  const soft = attack(0.35),
    hard = attack(0.95);
  t.ok(
    soft >= 0.1 && soft <= 0.5 && hard < soft * 0.85,
    `strings: the bows come in over ${fmt(soft, 2)} s played softly, ${fmt(hard, 2)} s hard (onset to within 3 dB of the held level; real sections take 0.1-0.4 s)`,
  );
  const lr = (p) => {
    const r = play('core.strings', [{ p, v: 0.7, t: 0, d: 1.5 }], { hall: 0 }, 2, 0.2);
    return dB(rms(r.channels[1], 0.3, 1.5)) - dB(rms(r.channels[0], 0.3, 1.5));
  };
  const vio = lr(84),
    cel = lr(40);
  t.ok(
    vio < -1 && cel > 1,
    `strings: violins sit left (${fmt(vio)} dB R-L at C6), cellos right (${fmt(cel)} dB at E2)`,
  );
  const sec = play('core.strings', [{ p: 64, v: 0.7, t: 0, d: 2 }], { hall: 0 }, 2.5, 0.2),
    ms = measure(slice(sec, 0.5, 2));
  t.ok(
    ms.correlation < 0.97 && ms.correlation > 0.3,
    `strings: one note is a section, not a point (L/R correlation ${ms.correlation}, side ${ms.sideDb} dB, no hall)`,
  );
}

// ------------------------------------------------------------------------------------------------ bass guitar
console.log('core.bassguitar: hands and pickups');
if (defs['core.bassguitar']) {
  const c = (params, v = 0.8) =>
    measure(slice(play('core.bassguitar', [{ p: 40, v, t: 0, d: 1.5 }], params, 2, 0.2), 0, 0.5)).centroid;
  const fing = c({ style: 0 }),
    pick = c({ style: 1 }),
    neck = c({ pickup: 0 }),
    bridge = c({ pickup: 1 });
  t.ok(
    pick > fing * 1.3,
    `bass: a pick is brighter than fingers (centroid ${Math.round(pick)} vs ${Math.round(fing)} Hz)`,
  );
  t.ok(
    bridge > neck * 1.05,
    `bass: the bridge pickup is brighter than the neck (${Math.round(bridge)} vs ${Math.round(neck)} Hz)`,
  );
  const ring = (style) => {
    const x = play('core.bassguitar', [{ p: 33, v: 0.8, t: 0, d: 3 }], { style }, 3.5, 0.2).channels[0];
    return dB(rms(x, 0.05, 0.25)) - dB(rms(x, 2, 2.2));
  };
  const open = ring(0),
    muted = ring(2);
  t.ok(
    open < 25 && muted > 40,
    `bass: a held A1 rings (${fmt(open)} dB down after 2 s), a palm-muted one dies (${fmt(muted)} dB down)`,
  );
  const centred = measure(
    play(
      'core.bassguitar',
      bassPhrase().map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT })),
      {},
      16,
      1,
    ),
  );
  t.ok(centred.correlation > 0.99, `bass: in the centre, as engineers put it (L/R correlation ${centred.correlation})`);
}

// ------------------------------------------------------------------------------------------------ the device check, in Chromium
if (!process.env.NODE_ONLY) {
  console.log('checkDevice in Chromium (full mode)');
  const { open } = await import('./pw.js');
  const { page, errors, close } = await open('/app/');
  try {
    for (const id of IDS) {
      const r = await page.evaluate(async (id) => {
        const { getDevice } = await import('/app/src/devices/registry.js');
        const { checkDevice, summarize } = await import('/app/src/kernel/check.js');
        await import('/app/src/devices/builtin/index.js');
        const rep = await checkDevice(getDevice(id));
        return {
          ok: rep.ok,
          errors: rep.errors,
          warnings: rep.warnings,
          sum: summarize(rep),
          voices: rep.voices,
          worst: rep.extremes && rep.extremes.worstPeak,
          failed: rep.extremes && rep.extremes.failed,
        };
      }, id);
      t.ok(r.ok, `${id}: checkDevice ok: ${r.sum}${r.ok ? '' : ' | ' + r.errors.join(' | ')}`);
      t.ok(!r.warnings.length, `${id}: no check warnings${r.warnings.length ? ': ' + r.warnings.join(' | ') : ''}`);
      t.ok(
        !(r.failed && r.failed.length),
        `${id}: every param at min and max renders (worst raw peak ${r.worst} dBFS)`,
      );
    }
    const mine = errors.filter((e) => /devices\/builtin\/(piano|organ|strings|bassguitar)/.test(e));
    t.ok(!mine.length, `no page errors from these instruments${mine.length ? ': ' + mine.join(' | ') : ''}`);
  } finally {
    await close();
  }
}
t.done();
