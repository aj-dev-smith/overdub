// Studio A (core.drumroom, app/src/devices/builtin/drumroom.js): the acoustic kit. Nobody building it can listen, so
// it is held to what makes a recorded kit sound recorded, measured on the canonical Node render
// (app/src/engine/node/render.js), then checked in Chromium the way define_device checks a kernel:
//
//   the map     every note of NOTE_MAP is a piece and an articulation the kit has, every articulation has a note; the
//               names in core/music.js (DRUM_MAP, DRUM_NAMES) cover it, and the names that were there keep their numbers
//               (and formatGrid its names); every param has a role, a desc and its piece's prefix
//   pieces      every note sounds, in its piece's part of the spectrum (kick low, hats high, ...), chokes included; every
//               General MIDI note DRUM_MAP names plays
//   velocity    harder is louder (4..22 dB from 0.4 to 1.0) and brighter at the onset (kick x1.5, snare x1.3, toms and
//               cymbals and the hat x1.15: timbre-test's measure); a ghost stroke is darker than a backbeat
//   humanity    repeated strokes at one velocity differ (no two alike) but stay within 1.5 dB and 15% of brightness of
//               each other; HUMAN 0 makes them more alike; two renders are bit-identical
//   hi-hat      a closed or pedal note chokes an open hat's ring (>= 12 dB less after it); 1/4 < 1/2 < open in ring
//   overheads   the toms go left to right in order, by the time and the level between the overheads (drummer's view),
//               mirrored in the audience's
//   mics        all four faders at -40 is silence; each alone sounds; the room fader carries the tail, the overheads the
//               crashes (no close mic), BLEED the crashes in the close mics, CRUSH a squashed room
//   low end     the kick's low end is in phase (correlation under 120 Hz >= 0.9) at the default mics, on Vacancy's drum
//               settings and from the room pair alone; Vacancy's drum track loses under 0.5 dB in mono there; above
//               150 Hz the kit is as wide as before the room went mono there (docs/FRESH-EYES-6.md, Broken 5)
//   physics     a tom shakes the snare wires (the 3-9 kHz band up >= 20 dB with them on, still >= 30 dB under the tom);
//               WIRES 0 takes the wires out; tune and decay move what they say; a flam is two strokes about 24 ms
//               apart, a drag three, a held roll rolls until it ends
//   levels      the GM drum phrase at house level (-18.5..-13.5 LUFS) at true peak <= -1 dBTP, every kit and preset
//               within -20..-13 LUFS and <= -1 dBTP
//   CPU         a busy groove (16th hats, a fill, three cymbals ringing) in CPU time against Gobo Kit's on the same notes
//   Chromium    checkDevice (kernel/check.js) passes with no warnings at the defaults (full mode) and on every kit and
//               preset (quick), with its declared latency where the onset lands
//
//   node tools/studioa-test.js            NODE_ONLY=1 skips Chromium
import crypto from 'node:crypto';
import { tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';
import { measure, lufs } from '../app/src/audio/measure.js';
import { drumPhrase, DRUM_PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import { INSTRUMENTS } from '../app/src/devices/builtin/index.js';
import { DRUM_MAP, DRUM_NAMES, formatGrid, parseGrid } from '../app/src/core/music.js';
import { demoById } from '../app/src/core/demo.js';
import kit, { NOTE_MAP, PIECES, ARTS, KITS } from '../app/src/devices/builtin/drumroom.js';

const t = tally('studioa');
const SR = 48000,
  BPM = 120,
  BEAT = 60 / BPM,
  ID = 'core.drumroom';
const STAMP = '2026-10-02T00:00:00.000Z';
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const db = (x) => 10 * Math.log10(x + 1e-30);

// ------------------------------------------------------------------------------------------------ rendering
function project(id, notes, params, beats) {
  return {
    ...createProject(),
    id: 'p_studioa',
    title: id,
    key: null,
    tempo: BPM,
    meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [
      {
        id: 't_studioa',
        name: 'Kit',
        kind: 'instrument',
        instrument: { device: id, params },
        inserts: [],
        clips: [
          {
            id: 'c_studioa',
            kind: 'notes',
            start: 0,
            length: beats,
            notes: notes.map((n, i) => ({ id: 'n' + (i + 1), by: 'overdub', d: 0.1, v: 0.8, ...n })),
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
const cpuNow = () => {
  const u = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage();
  return u.user + u.system;
};
// notes in beats -> { L, R, m (mono), cpuMs }
function play(notes, params = {}, beats = 2, tail = 0.5, id = ID) {
  const c0 = cpuNow();
  const r = renderSong(project(id, notes, params, beats), { from: 0, to: beats, tail });
  const [L, R] = r.channels,
    m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (L[i] + R[i]);
  return { L, R, m, cpuMs: (cpuNow() - c0) / 1000, warnings: r.warnings };
}
const hit = (p, v = 0.8, params = {}, tail = 1) => play([{ p, t: 0, d: 0.25, v }], params, 2, tail);
// timbre-test's measures: a Hann-windowed power spectrum, the onset (the first 1 ms frame within 40 dB of the loudest)
function power(x, at, N) {
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[at + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let q = re[i];
      re[i] = re[j];
      re[j] = q;
      q = im[i];
      im[i] = im[j];
      im[j] = q;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const a = (-2 * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a),
      h = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < h; j++) {
        const k = i + j + h,
          vr = re[k] * cr - im[k] * ci,
          vi = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - vr;
        im[k] = im[i + j] - vi;
        re[i + j] += vr;
        im[i + j] += vi;
        const q = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = q;
      }
    }
  }
  const P = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
  return P;
}
function onset(x) {
  const fr = 48;
  let pk = 0;
  const e = [];
  for (let a = 0; a + fr <= x.length; a += fr) {
    let s = 0;
    for (let i = a; i < a + fr; i++) s += x[i] * x[i];
    e.push(s);
    if (s > pk) pk = s;
  }
  for (let i = 0; i < e.length; i++) if (e[i] > pk * 1e-4) return i * fr;
  return 0;
}
function centroid(x, at, N) {
  const P = power(x, at, N);
  let a = 0,
    b = 0;
  for (let k = 1; k < P.length; k++) {
    a += k * P[k];
    b += P[k];
  }
  return b > 1e-30 ? ((a / b) * SR) / N : 0;
}
function band(x, at, N, lo, hi) {
  const P = power(x, at, N);
  let s = 0;
  for (let k = 1; k < P.length; k++) {
    const f = (k * SR) / N;
    if (f >= lo && f < hi) s += P[k];
  }
  return db(s);
}
const energy = (x, a, b) => {
  let s = 0;
  for (let i = Math.round(a * SR), e = Math.min(x.length, Math.round(b * SR)); i < e; i++) s += x[i] * x[i];
  return db(s);
};
const loud = (r, a, b) => {
  const on = onset(r.m),
    i0 = on + Math.round(a * SR),
    i1 = on + Math.round(b * SR);
  return lufs({ sr: SR, channels: [r.L.subarray(i0, i1), r.R.subarray(i0, i1)] });
};
const hash = (r) =>
  crypto
    .createHash('sha256')
    .update(Buffer.from(r.L.buffer))
    .update(Buffer.from(r.R.buffer))
    .digest('hex')
    .slice(0, 16);

// ================================================================================================ the map
console.log('the definition and the note map');
{
  t.ok(
    INSTRUMENTS.includes(kit) && kit.id === ID && kit.cat === 'drums' && kit.kind === 'instrument',
    `${ID} (${kit.name}) is a built-in instrument on the drums shelf`,
  );
  const ROLES = [
    'tone',
    'level',
    'drive',
    'mix',
    'time',
    'feedback',
    'rate',
    'depth',
    'size',
    'decay',
    'attack',
    'release',
    'pitch',
    'shape',
    'width',
    'gate',
    'sens',
  ];
  const bad = kit.params.filter((p) => !ROLES.includes(p.role) || !(p.desc && p.desc.length >= 20) || !p.group);
  t.ok(
    !bad.length,
    `all ${kit.params.length} params have a role, a desc an agent can act on and a group${bad.length ? ': not ' + bad.map((p) => p.key).join(', ') : ''}`,
  );
  const pieceKeys = kit.params.filter((p) => PIECES.includes(p.group));
  t.ok(
    pieceKeys.length >= 30 && pieceKeys.every((p) => p.key.startsWith(p.group + '_')),
    `the ${pieceKeys.length} per-piece params are keyed by their piece (kick_*, snare_*, hat_*, tom1_* ...)`,
  );
  for (const k of ['mix_close', 'mix_oh', 'mix_room', 'mix_crush', 'bleed', 'room_size'])
    t.ok(
      kit.params.some((p) => p.key === k),
      `the mic mix has ${k}`,
    );
  for (const piece of [
    'kick',
    'snare',
    'hat',
    'tom1',
    'tom2',
    'tom3',
    'tom4',
    'ride',
    'crash1',
    'crash2',
    'china',
    'splash',
  ]) {
    t.ok(
      ['tune', 'decay', 'level'].every((s) => kit.params.some((p) => p.key === `${piece}_${s}`)),
      `${piece}: tune, decay and level`,
    );
  }
  const kitOpt = kit.params.find((p) => p.key === 'kit');
  t.ok(kitOpt.opts.join() === KITS.join() && KITS.length === 5, `KIT offers ${KITS.join(', ')}`);
  t.ok(
    kit.presets.length >= 8 && KITS.every((_, k) => kit.presets.some((pr) => pr.params.kit === k)),
    `${kit.presets.length} presets, one for every kit and a few mixes (${kit.presets.map((p) => p.name).join(', ')})`,
  );
  const notes = NOTE_MAP.map((r) => r[0]);
  t.ok(
    new Set(notes).size === notes.length && notes.every((p) => p >= 0 && p <= 127),
    `${notes.length} notes in the map, each once`,
  );
  const wrong = NOTE_MAP.filter(([, piece, art]) => !PIECES.includes(piece) || !ARTS[piece].includes(art));
  t.ok(
    !wrong.length,
    `every note plays a piece and an articulation the kit has${wrong.length ? ': not ' + wrong.map((r) => r[0]).join(', ') : ''}`,
  );
  const missing = PIECES.flatMap((piece) =>
    ARTS[piece].filter((art) => !NOTE_MAP.some((r) => r[1] === piece && r[2] === art)).map((art) => piece + ' ' + art),
  );
  t.ok(!missing.length, `every articulation has a note${missing.length ? ': not ' + missing.join(', ') : ''}`);
  const GM = {
    35: 'kick',
    36: 'kick',
    37: 'snare',
    38: 'snare',
    39: 'clap',
    40: 'snare',
    41: 'tom4',
    42: 'hat',
    43: 'tom4',
    44: 'hat',
    45: 'tom3',
    46: 'hat',
    47: 'tom2',
    48: 'tom1',
    49: 'crash1',
    50: 'tom1',
    51: 'ride',
    52: 'china',
    53: 'ride',
    54: 'tamb',
    55: 'splash',
    56: 'cowbell',
    57: 'crash2',
    59: 'ride',
    69: 'shaker',
    70: 'shaker',
  };
  const gmOff = Object.entries(GM).filter(([p, piece]) => NOTE_MAP.find((r) => r[0] === +p)?.[1] !== piece);
  t.ok(
    !gmOff.length,
    `General MIDI notes play what GM names (35-59, and the tambourine, cowbell, cabasa and maracas)${gmOff.length ? ': not ' + gmOff.map((g) => g[0]).join(', ') : ''}`,
  );
  const unnamed = notes.filter((p) => !DRUM_NAMES[p]);
  t.ok(
    !unnamed.length,
    `DRUM_NAMES labels every note of the map${unnamed.length ? ' (not ' + unnamed.join(', ') + ')' : ''}`,
  );
  const strays = Object.entries(DRUM_MAP).filter(([, p]) => !notes.includes(p));
  t.ok(
    !strays.length,
    `every DRUM_MAP name is a note Studio A plays${strays.length ? ' (not ' + strays.map((s) => s.join('=')).join(', ') + ')' : ''}`,
  );
  const beyond = NOTE_MAP.filter((r) => r[0] < 35 || r[0] > 81).filter((r) => r[0] !== 82);
  const named = beyond.filter((r) => Object.values(DRUM_MAP).includes(r[0]));
  t.ok(
    named.length === beyond.length,
    `the ${beyond.length} articulations beyond GM have DRUM_MAP names (${beyond
      .map(
        (r) =>
          Object.keys(DRUM_MAP)
            .filter((k) => DRUM_MAP[k] === r[0])
            .pop() +
          '=' +
          r[0],
      )
      .join(' ')})`,
  );
  // additive only: the names that were there keep their numbers, and grids print the same names
  const OLD = {
    kick: 36,
    bd: 36,
    rim: 37,
    side: 37,
    snare: 38,
    sd: 38,
    clap: 39,
    cp: 39,
    hat: 42,
    hh: 42,
    ch: 42,
    closed: 42,
    pedal: 44,
    ph: 44,
    open: 46,
    oh: 46,
    tom1: 50,
    hitom: 50,
    tom2: 47,
    midtom: 47,
    tom3: 45,
    lotom: 45,
    floor: 43,
    crash: 49,
    cy: 49,
    ride: 51,
    rd: 51,
    bell: 53,
    cowbell: 56,
    cb: 56,
    shaker: 70,
    sh: 70,
    tamb: 54,
  };
  const moved = Object.entries(OLD).filter(([k, p]) => DRUM_MAP[k] !== p);
  t.ok(
    !moved.length,
    `the ${Object.keys(OLD).length} names that were there keep their numbers${moved.length ? ' (moved: ' + moved.map((m) => m[0]).join(', ') + ')' : ''}`,
  );
  const OLD_NAMES = {
    36: 'Kick',
    37: 'Rim',
    38: 'Snare',
    39: 'Clap',
    42: 'Hat',
    44: 'Pedal hat',
    46: 'Open hat',
    43: 'Floor tom',
    45: 'Low tom',
    47: 'Mid tom',
    50: 'High tom',
    49: 'Crash',
    51: 'Ride',
    53: 'Bell',
    54: 'Tamb',
    56: 'Cowbell',
    70: 'Shaker',
  };
  t.ok(
    Object.entries(OLD_NAMES).every(([p, n]) => DRUM_NAMES[p] === n),
    'DRUM_NAMES keeps every label it had',
  );
  const grid = formatGrid(Object.values(OLD).map((p, i) => ({ p, t: (i % 16) * 0.25, d: 0.25, v: 0.8 })));
  const WAS = [
    'kick',
    'side',
    'snare',
    'clap',
    'hat',
    'pedal',
    'open',
    'hitom',
    'midtom',
    'lotom',
    'floor',
    'crash',
    'ride',
    'bell',
    'cowbell',
    'shaker',
    'tamb',
  ];
  t.ok(
    Object.keys(grid.rows).sort().join() === WAS.sort().join(),
    `formatGrid names the old notes as before (${Object.keys(grid.rows).join(' ')})`,
  );
  const back = parseGrid({
    steps: 4,
    rows: { rimshot: 'x...', half: '.x..', flam: '..x.', rideedge: '...x', tom4: 'x...' },
  })
    .map((n) => n.p)
    .join();
  t.ok(back === '40,24,31,59,43', `grids take the new names (rimshot half flam rideedge tom4 -> ${back})`);
}

// ================================================================================================ the pieces
console.log('every note sounds, in its part of the spectrum');
const REGION = {
  kick: [20, 250],
  snare: [700, 6000],
  hat: [2500, 16000],
  tom1: [60, 900],
  tom2: [60, 700],
  tom3: [50, 500],
  tom4: [40, 400],
  crash1: [2500, 12000],
  crash2: [2500, 12000],
  ride: [1800, 9000],
  china: [1500, 7000],
  splash: [3000, 14000],
  tamb: [4000, 14000],
  cowbell: [350, 1600],
  shaker: [4000, 14000],
  clap: [900, 4500],
};
const ART_REGION = {
  'snare sidestick': [500, 4000],
  'hat pedal': [1000, 7000],
  'ride bell': [800, 3000],
  'hat edge': [1500, 9000],
};
const sounds = {};
for (const [p, piece, art, name] of NOTE_MAP) {
  const r = hit(p, 0.9, { humanize: 0 }, 1),
    on = onset(r.m);
  const l = loud(r, 0, 0.4),
    c = centroid(r.m, on, 16384),
    [lo, hi] = ART_REGION[piece + ' ' + art] || REGION[piece];
  sounds[p] = { l, c };
  t.ok(
    l > -40 && c >= lo && c <= hi,
    `${p} ${name}: ${fmt(l)} LUFS (400 ms), centroid ${Math.round(c)} Hz (${piece}: ${lo}..${hi})`,
  );
}
{
  const gm = [...new Set(Object.values(DRUM_MAP))].filter((p) => p >= 35 && p <= 81).sort((a, b) => a - b);
  const silent = gm.filter((p) => !(sounds[p] && sounds[p].l > -40));
  t.ok(
    gm.length >= 20 && !silent.length,
    `every General MIDI note DRUM_MAP names plays (${gm.length} notes${silent.length ? '; silent: ' + silent.join(', ') : ''})`,
  );
  // chokes: the hit, then the hand: much shorter than the open hit
  for (const [c, h, name, end] of [
    [27, 49, 'crash', 1.5],
    [28, 57, 'crash 2', 1.5],
    [29, 52, 'china', 1.5],
    [30, 55, 'splash', 0.8],
    [25, 51, 'ride', 1.5],
  ]) {
    const a = hit(h, 0.9, { humanize: 0, mix_room: -40 }, 1.5),
      b = hit(c, 0.9, { humanize: 0, mix_room: -40 }, 1.5);
    const tail = (r) => energy(r.m, 0.3, end);
    t.ok(
      tail(a) - tail(b) >= 20,
      `the ${name} choke is the hit, then grabbed: ${fmt(tail(a) - tail(b))} dB less ring 0.3-${end} s after it`,
    );
  }
  // a note the kit has no piece for still makes a sound (quietly: the side stick)
  const other = hit(64, 1, { humanize: 0 });
  t.ok(
    loud(other, 0, 0.4) > -40 && loud(other, 0, 0.4) < sounds[37].l,
    `a note outside the map plays the side stick, quietly (${fmt(loud(other, 0, 0.4))} LUFS)`,
  );
}

// ================================================================================================ velocity
console.log('velocity changes the sound');
for (const [p, name, want] of [
  [36, 'kick', 1.5],
  [38, 'snare', 1.3],
  [47, 'rack tom 2', 1.15],
  [43, 'floor tom', 1.15],
  [42, 'closed hat', 1.15],
  [51, 'ride', 1.15],
  [49, 'crash', 1.1],
]) {
  const a = hit(p, 0.4, { humanize: 0 }),
    b = hit(p, 1, { humanize: 0 });
  const dl = loud(b, 0, 0.4) - loud(a, 0, 0.4),
    dc = centroid(b.m, onset(b.m), 2048) / centroid(a.m, onset(a.m), 2048);
  t.ok(
    dl >= 4 && dl <= 22 && dc >= want,
    `${name}: 0.4 -> 1.0 is ${fmt(dl)} dB louder (4..22) and brighter at the onset, centroid x${fmt(dc, 2)} (>= ${want})`,
  );
}
{
  const ghost = hit(38, 0.25, { humanize: 0 }),
    back = hit(38, 1, { humanize: 0 });
  const cg = centroid(ghost.m, onset(ghost.m), 4096),
    cb2 = centroid(back.m, onset(back.m), 4096);
  t.ok(
    cg <= 0.75 * cb2,
    `a ghost stroke (0.25) is darker than a backbeat: onset centroid ${Math.round(cg)} Hz against ${Math.round(cb2)} Hz`,
  );
  const soft = play([{ p: 38, t: 0, v: 0.6 }], { velocity: -1, humanize: 0 }),
    hard = play([{ p: 38, t: 0, v: 0.6 }], { velocity: 1, humanize: 0 });
  t.ok(
    loud(hard, 0, 0.4) - loud(soft, 0, 0.4) >= 6,
    `VEL: the same note is ${fmt(loud(hard, 0, 0.4) - loud(soft, 0, 0.4))} dB louder with a heavy hand (VEL 1) than a light touch (VEL -1)`,
  );
}

// ================================================================================================ humanity
console.log('no machine-gun');
{
  const eight = (h) =>
    play(
      Array.from({ length: 8 }, (_, k) => ({ p: 38, t: k, v: 0.8 })),
      { humanize: h, mix_room: -40 },
      8,
      0.5,
    );
  const stats = (r) => {
    const seg = (k) => r.m.subarray(Math.round((k * BEAT + 0.002) * SR), Math.round((k * BEAT + 0.12) * SR));
    let maxCorr = 0,
      minCorr = 1;
    const lv = [],
      cs = [];
    for (let k = 0; k < 8; k++) {
      const a = seg(k);
      lv.push(energy(a, 0, a.length / SR));
      cs.push(centroid(a, 0, 4096));
      if (k) {
        const b = seg(k - 1);
        let ab = 0,
          aa = 0,
          bb = 0;
        for (let i = 0; i < a.length; i++) {
          ab += a[i] * b[i];
          aa += a[i] * a[i];
          bb += b[i] * b[i];
        }
        const c = ab / Math.sqrt(aa * bb);
        if (c > maxCorr) maxCorr = c;
        if (c < minCorr) minCorr = c;
      }
    }
    return { maxCorr, minCorr, dl: Math.max(...lv) - Math.min(...lv), dc: Math.max(...cs) / Math.min(...cs) };
  };
  const h1 = stats(eight(1)),
    h0 = stats(eight(0));
  t.ok(
    h1.maxCorr < 0.995 && h1.dl <= 1.5 && h1.dc <= 1.15,
    `eight snare strokes at one velocity are never alike (consecutive waveforms correlate ${fmt(h1.minCorr, 3)}..${fmt(h1.maxCorr, 3)}), within ${fmt(h1.dl)} dB and x${fmt(h1.dc, 2)} in brightness of each other`,
  );
  t.ok(
    h0.minCorr > h1.minCorr,
    `HUMAN 0 makes them more alike (lowest correlation ${fmt(h0.minCorr, 3)}, against ${fmt(h1.minCorr, 3)} at HUMAN 1)`,
  );
  const a = play(drumPhrase(), {}, DRUM_PHRASE_BEATS, 1),
    b = play(drumPhrase(), {}, DRUM_PHRASE_BEATS, 1);
  t.ok(hash(a) === hash(b), `the drum phrase renders bit-identically twice (${hash(a)})`);
}

// ================================================================================================ the hi-hat
console.log('the hi-hat');
{
  const open = play([{ p: 46, t: 0, v: 0.9 }], { humanize: 0 }, 2, 1);
  const tail = (r) => energy(r.m, 0.35, 0.9);
  for (const [p, name] of [
    [42, 'closed'],
    [44, 'pedal'],
    [22, 'closed edge'],
  ]) {
    const c = play(
      [
        { p: 46, t: 0, v: 0.9 },
        { p, t: 0.5, v: 0.6 },
      ],
      { humanize: 0 },
      2,
      1,
    );
    t.ok(
      tail(open) - tail(c) >= 12,
      `a ${name} note chokes the open hat: ${fmt(tail(open) - tail(c))} dB less 0.35-0.9 s after it (with its own stroke)`,
    );
  }
  const ring = (p) => {
    const r = hit(p, 0.8, { humanize: 0, mix_room: -40 }, 2);
    return energy(r.m, 0.15, 1.5);
  };
  const q = ring(23),
    h = ring(24),
    o = ring(46),
    c = ring(42);
  t.ok(
    c < q && q < h && h < o,
    `the hats ring longer as they open: closed ${fmt(c)} < 1/4 ${fmt(q)} < 1/2 ${fmt(h)} < open ${fmt(o)} dB (0.15-1.5 s)`,
  );
  const modOpen = play([{ p: 42, t: 0, v: 0.8, mod: 0.6 }], { humanize: 0, mix_room: -40 }, 2, 2);
  t.ok(
    energy(modOpen.m, 0.15, 1.5) > ring(42) + 6,
    `a closed note with mod 0.6 plays the hats 60% open (${fmt(energy(modOpen.m, 0.15, 1.5))} dB against ${fmt(ring(42))})`,
  );
  const fs = ring(21);
  t.ok(fs > c + 6, `the foot splash rings after the chick (${fmt(fs)} dB against a closed hat's ${fmt(c)})`);
}

// ================================================================================================ the overheads
console.log('the overheads');
{
  function itd(L, R, maxMs = 2.5) {
    const n = Math.round(0.08 * SR),
      K = Math.round(maxMs * 0.001 * SR);
    let best = -Infinity,
      bl = 0;
    for (let lag = -K; lag <= K; lag++) {
      let s = 0;
      for (let i = K; i < n - K; i++) s += L[i] * R[i + lag];
      if (s > best) {
        best = s;
        bl = lag;
      }
    }
    return (bl / SR) * 1000;
  }
  for (const [view, side] of [
    [0, "the drummer's"],
    [1, "the audience's"],
  ]) {
    const pts = [50, 47, 45, 43].map((p) => {
      const r = hit(p, 0.9, { mix_close: -40, mix_room: -40, bleed: 0, humanize: 0, view }, 0.5);
      const n = Math.round(0.3 * SR);
      return { p, itd: itd(r.L, r.R), ild: energy(r.L, 0, n / SR) - energy(r.R, 0, n / SR) };
    });
    const dir = view ? 1 : -1,
      mono = (k) => pts.every((x, i) => i === 0 || (x[k] - pts[i - 1][k]) * dir > 0);
    t.ok(
      mono('itd') && mono('ild'),
      `${side} view: rack tom 1, rack tom 2, floor tom 1, floor tom 2 go ${view ? 'right to left' : 'left to right'} by time (${pts.map((x) => fmt(x.itd, 2)).join(', ')} ms, R after L) and level (${pts.map((x) => fmt(x.ild)).join(', ')} dB, L over R)`,
    );
  }
}

// ================================================================================================ the mics
console.log('the mic mix');
{
  const ph = drumPhrase().filter((n) => n.t < 8);
  const off = { mix_close: -40, mix_oh: -40, mix_room: -40, mix_crush: -40 };
  const L = (params) => measure({ sr: SR, channels: (({ L, R }) => [L, R])(play(ph, params, 8, 1)) }).lufs;
  t.ok(L(off) === -120, 'all four faders at -40: silence');
  for (const k of ['mix_close', 'mix_oh', 'mix_room', 'mix_crush']) {
    const v = L({ ...off, [k]: 0 });
    t.ok(v > -40, `${k} alone: ${fmt(v)} LUFS`);
  }
  // the room carries the tail
  const sn = (params) => energy(hit(38, 0.9, { humanize: 0, ...params }, 2).m, 0.35, 1.5);
  const withRoom = sn({ mix_room: -4 }),
    noRoom = sn({ mix_room: -40 });
  t.ok(
    withRoom - noRoom >= 15,
    `the room fader carries the tail: ${fmt(withRoom - noRoom)} dB more 0.35-1.5 s after a snare with it up`,
  );
  // the crash has no close mic: the overheads (and the room) are where it is
  const cr = (params) => energy(hit(49, 0.9, { humanize: 0, ...params }, 1).m, 0, 1);
  const crAll = cr({}),
    crNoOH = cr({ mix_oh: -40, mix_room: -40 });
  t.ok(
    crAll - crNoOH >= 10,
    `the crash lives in the overheads: ${fmt(crAll - crNoOH)} dB less with the overheads and room down`,
  );
  // bleed: the crash in the close mics
  const cb = (b) => energy(hit(49, 0.9, { humanize: 0, mix_oh: -40, mix_room: -40, bleed: b }, 1).m, 0, 1);
  const b0 = cb(0),
    b1 = cb(1);
  t.ok(
    b0 < -100 && b1 > -60,
    `BLEED puts the crash in the close mics: ${b0 < -100 ? 'none' : fmt(b0) + ' dB'} at 0, ${fmt(b1)} dB at 1`,
  );
  // crush: a room squashed flat (a lower crest than the room alone)
  const crest = (params) =>
    measure({ sr: SR, channels: (({ L, R }) => [L, R])(play(ph, { ...off, ...params }, 8, 1)) }).crest;
  const cRoom = crest({ mix_room: 0 }),
    cCrush = crest({ mix_crush: 0 });
  t.ok(cCrush <= cRoom - 3, `CRUSH is a squashed room: crest ${fmt(cCrush)} dB against the room's ${fmt(cRoom)} dB`);
  // the view mirrors the picture
  const hh = (view) => {
    const r = hit(42, 0.9, { humanize: 0, view }, 0.5);
    return energy(r.L, 0, 0.3) - energy(r.R, 0, 0.3);
  };
  t.ok(
    hh(0) > 2 && hh(1) < -2,
    `VIEW: the hat is left from the drummer's seat (${fmt(hh(0))} dB) and right from out front (${fmt(hh(1))} dB)`,
  );
}

// ================================================================================================ the low end
console.log('the low end: the room is mono under 120 Hz');
{
  // A producer measured the kick's low end out of phase between left and right (docs/FRESH-EYES-6.md, Broken 5): the
  // room's reflections reach its two mics at different times and alternate in sign, and its tail differs on each side.
  // Correlation under 120 Hz was -0.20 from the room pair alone, 0.76 at the default mics, 0.26 on Vacancy's drum track
  // (2.0 dB lost in mono). Measured their way: each channel through two one-pole low passes at 120 Hz, then the
  // correlation of the two; the mono loss is the middle's level against the two sides'.
  const lp = (x, fc) => {
    const a = Math.exp((-2 * Math.PI * fc) / SR),
      y = new Float64Array(x.length);
    let p1 = 0,
      p2 = 0;
    for (let i = 0; i < x.length; i++) {
      p1 = (1 - a) * x[i] + a * p1;
      p2 = (1 - a) * p1 + a * p2;
      y[i] = p2;
    }
    return y;
  };
  // a fourth-order Butterworth high pass (two RBJ biquads), for the width above 150 Hz
  const biquad = (x, fc, q) => {
    const w = (2 * Math.PI * fc) / SR,
      c = Math.cos(w),
      al = Math.sin(w) / (2 * q),
      a0 = 1 + al,
      a1 = (-2 * c) / a0,
      a2 = (1 - al) / a0,
      b0 = (1 + c) / 2 / a0,
      b1 = -(1 + c) / a0;
    const y = new Float64Array(x.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    return y;
  };
  const hp4 = (x, fc) => biquad(biquad(x, fc, 0.5412), fc, 1.3066);
  const pair = (L, R) => {
    let lr = 0,
      ll = 0,
      rr = 0,
      mm = 0,
      ss = 0;
    for (let i = 0; i < L.length; i++) {
      lr += L[i] * R[i];
      ll += L[i] * L[i];
      rr += R[i] * R[i];
      const m = L[i] + R[i],
        s = L[i] - R[i];
      mm += m * m;
      ss += s * s;
    }
    return {
      corr: lr / Math.sqrt(ll * rr),
      mono: 10 * Math.log10(mm / 4 / (0.5 * (ll + rr))),
      side: 10 * Math.log10(ss / mm),
    };
  };
  const low = (r) => pair(lp(r.L, 120), lp(r.R, 120)),
    high = (r) => pair(hp4(r.L, 150), hp4(r.R, 150));
  const vac = demoById('vacancy'),
    vd = vac.tracks.find((x) => x.instrument?.device === ID);
  const kicks = Array.from({ length: 8 }, (_, k) => ({ p: 36, t: k, d: 0.25, v: 0.9 }));
  for (const [name, params] of [
    ['the default mics', {}],
    ["Vacancy's drum settings", vd.instrument.params],
    ['the room pair alone', { mix_close: -40, mix_oh: -40, mix_crush: -40 }],
  ]) {
    const x = low(play(kicks, params, 8, 1.5));
    t.ok(
      x.corr >= 0.9,
      `the kick's low end is in phase with ${name}: correlation under 120 Hz ${fmt(x.corr, 2)} (>= 0.9), ${fmt(-x.mono)} dB lost in mono`,
    );
  }
  // Vacancy's drum track as the song plays it
  const song = renderSong(vac, { tracks: [vd.id], from: 0, to: vac.loop.end, tail: 2 }),
    vr = { L: song.channels[0], R: song.channels[1] };
  const vl = low(vr),
    vh = high(vr);
  t.ok(
    vl.corr >= 0.9 && vl.mono > -0.5,
    `Vacancy's drum track: correlation under 120 Hz ${fmt(vl.corr, 2)} (>= 0.9), ${fmt(-vl.mono)} dB lost in mono there (< 0.5)`,
  );
  // above 150 Hz the kit keeps its width: the side's level under the middle and the correlation, against what they were
  // before the room went mono under 120 Hz (283b44a: the drum phrase -6.71 dB and 0.649, Vacancy's drum track -3.12 dB
  // and 0.347; within 0.5 dB and 0.03)
  const ph = high(play(drumPhrase(), {}, DRUM_PHRASE_BEATS, 2));
  for (const [name, x, was] of [
    ['the drum phrase at the defaults', ph, { side: -6.71, corr: 0.649 }],
    ["Vacancy's drum track", vh, { side: -3.12, corr: 0.347 }],
  ]) {
    t.ok(
      Math.abs(x.side - was.side) <= 0.5 && Math.abs(x.corr - was.corr) <= 0.03,
      `above 150 Hz ${name} is as wide as it was: the side ${fmt(x.side, 2)} dB under the middle (was ${was.side}), correlation ${fmt(x.corr, 3)} (was ${was.corr})`,
    );
  }
}

// ================================================================================================ the physics
console.log('the physics');
{
  const close = { humanize: 0, mix_oh: -40, mix_room: -40 };
  const buzz = (p, wires) => {
    const r = hit(p, 1, { ...close, snare_wires: wires }, 0.5);
    return {
      b: band(r.m, Math.round(0.02 * SR), 32768, 3000, 9000),
      all: band(r.m, Math.round(0.02 * SR), 32768, 20, 20000),
    };
  };
  for (const [p, name] of [
    [43, 'floor tom 2'],
    [47, 'rack tom 2'],
  ]) {
    const a = buzz(p, 0),
      b = buzz(p, 0.6);
    t.ok(
      b.b - a.b >= 20 && b.all - b.b >= 30,
      `${name} shakes the snare wires: the 3-9 kHz band ${fmt(b.b - a.b)} dB up with them on, ${fmt(b.all - b.b)} dB under the whole hit`,
    );
  }
  const wires = (w) => {
    const r = hit(38, 0.9, { ...close, snare_wires: w }, 0.5);
    return band(r.m, onset(r.m), 16384, 4000, 10000);
  };
  t.ok(
    wires(0.6) - wires(0) >= 10,
    `WIRES 0 takes the wires out: ${fmt(wires(0.6) - wires(0))} dB less 4-10 kHz in a snare stroke`,
  );
  const peakHz = (r, from, N = 16384) => {
    const P = power(r.m, from, N);
    let b = 1;
    for (let k = 2; k < N / 4; k++) if (P[k] > P[b]) b = k;
    return (b * SR) / N;
  };
  const k0 = peakHz(hit(36, 0.8, { humanize: 0, mix_room: -40 }), 2400),
    k12 = peakHz(hit(36, 0.8, { humanize: 0, mix_room: -40, kick_tune: 12 }), 2400);
  t.ok(
    k12 / k0 > 1.85 && k12 / k0 < 2.15,
    `kick_tune +12 moves the kick an octave: ${Math.round(k0)} -> ${Math.round(k12)} Hz`,
  );
  const ringT = (params) => energy(hit(45, 0.9, { humanize: 0, mix_room: -40, ...params }, 2).m, 0.3, 1.5);
  t.ok(
    ringT({}) - ringT({ tom3_decay: 0.3 }) >= 10,
    `tom3_decay 0.3 damps floor tom 1: ${fmt(ringT({}) - ringT({ tom3_decay: 0.3 }))} dB less ring after 0.3 s`,
  );
  t.ok(
    hit(54, 0.9, { perc_level: -40 }).m.every((v) => v === 0),
    'perc_level -40 silences the tambourine',
  );
  // (a level is a fader before the output's limiter: under it a move is the move; a full stroke the limiter was holding
  // gives back some of it)
  const lv = (v, params) => loud(hit(38, v, { humanize: 0, ...params }), 0, 0.4);
  const d3 = lv(0.3, {}) - lv(0.3, { snare_level: -6 }),
    d9 = lv(0.9, {}) - lv(0.9, { snare_level: -6 });
  t.ok(
    Math.abs(d3 - 6) < 0.6 && d9 >= 3,
    `snare_level -6 takes the snare down ${fmt(d3)} dB at 0.3 (under the limiter), ${fmt(d9)} dB at 0.9`,
  );
  // each kit is its own kit
  const sig = KITS.map(
    (_, k) =>
      Math.round(peakHz(hit(38, 0.8, { humanize: 0, kit: k, mix_room: -40 }), 2400)) +
      '/' +
      Math.round(peakHz(hit(36, 0.8, { humanize: 0, kit: k, mix_room: -40 }), 2400)),
  );
  t.ok(
    new Set(sig).size === KITS.length,
    `every kit tunes its own drums (snare / kick peak: ${KITS.map((k, i) => k + ' ' + sig[i]).join(', ')} Hz)`,
  );
  // flams, drags, rolls
  // strokes: rises in the high band (a stick's attack; the head's low ring beats in 1 ms frames and would fool it)
  const strokes = (r, from = 0, to = 0.3) => {
    const fr = Math.round(0.001 * SR),
      e = [];
    for (let a = Math.max(1, Math.round(from * SR)); a + fr <= Math.round(to * SR); a += fr) {
      let s = 0;
      for (let i = a; i < a + fr; i++) {
        const d = r.m[i] - r.m[i - 1];
        s += d * d;
      }
      e.push(db(s));
    }
    const mx = Math.max(...e),
      out = [];
    for (let i = 2; i < e.length; i++)
      if (e[i] - e[i - 2] > 9 && e[i] > mx - 30 && (!out.length || i - out[out.length - 1] > 10)) out.push(i);
    return out;
  };
  const flam = strokes(hit(31, 0.9, { humanize: 0, mix_room: -40 }));
  t.ok(
    flam.length === 2 && flam[1] - flam[0] >= 18 && flam[1] - flam[0] <= 32,
    `a flam is two strokes ${flam.length === 2 ? flam[1] - flam[0] + ' ms' : '(' + flam.length + ' found)'} apart, the grace note first`,
  );
  const drag = strokes(hit(32, 0.9, { humanize: 0, mix_room: -40 }));
  t.ok(drag.length === 3, `a drag is three strokes (${drag.length} found at ${drag.join(', ')} ms)`);
  const roll = play([{ p: 33, t: 0, d: 2, v: 0.8 }], { humanize: 0, mix_room: -40 }, 4, 1);
  const env = [];
  for (let a = 0.05; a < 0.95; a += 0.05) env.push(energy(roll.m, a, a + 0.05));
  const after = energy(roll.m, 1.5, 2);
  t.ok(
    Math.max(...env) - Math.min(...env) < 8 && Math.min(...env) - after > 25,
    `a held roll keeps rolling (its 50 ms windows within ${fmt(Math.max(...env) - Math.min(...env))} dB while held) and stops with the note (${fmt(Math.min(...env) - after)} dB down 0.5 s after)`,
  );
}

// ================================================================================================ levels
console.log('levels');
{
  const m = measure({ sr: SR, channels: (({ L, R }) => [L, R])(play(drumPhrase(), {}, DRUM_PHRASE_BEATS, 2)) });
  t.ok(
    m.lufs >= -18.5 && m.lufs <= -13.5 && m.truePeak <= -1,
    `the GM drum phrase at defaults: ${m.lufs} LUFS (house: -18.5..-13.5), ${m.truePeak} dBTP (<= -1), crest ${m.crest} dB`,
  );
  for (const pr of kit.presets) {
    const r = play(drumPhrase(), pr.params, DRUM_PHRASE_BEATS, 2),
      mm = measure({ sr: SR, channels: [r.L, r.R] });
    t.ok(
      mm.lufs >= -20 && mm.lufs <= -13 && mm.truePeak <= -1 && !r.warnings.length,
      `preset ${pr.name}: ${mm.lufs} LUFS, ${mm.truePeak} dBTP`,
    );
  }
  for (const k of [1, 2, 3, 4]) {
    const r = play(drumPhrase(), { kit: k }, DRUM_PHRASE_BEATS, 2),
      mm = measure({ sr: SR, channels: [r.L, r.R] });
    t.ok(
      mm.lufs >= -20 && mm.lufs <= -13 && mm.truePeak <= -1,
      `kit ${KITS[k]} at the default mix: ${mm.lufs} LUFS, ${mm.truePeak} dBTP`,
    );
  }
}

// ================================================================================================ CPU
console.log('CPU');
if (process.env.CPU !== '0') {
  const N = [],
    add = (p, tt, v = 0.8) => N.push({ p, t: tt, d: 0.1, v });
  for (let b = 0; b < 8; b++) {
    const o = b * 4;
    for (let s = 0; s < 16; s++) {
      const tt = o + s * 0.25;
      if (s === 14) add(46, tt, 0.75);
      else add(42, tt, s % 4 === 0 ? 0.9 : s % 2 ? 0.45 : 0.65);
    }
    [0, 1.5, 2.5, 2.75].forEach((x) => add(36, o + x, x === 0 ? 1 : 0.8));
    add(38, o + 1, 0.95);
    add(38, o + 3, 1);
    add(38, o + 1.75, 0.3);
    add(38, o + 3.5, 0.28);
    if (b % 2 === 1) [50, 50, 47, 47, 45, 45, 43, 43].forEach((p, k) => add(p, o + 2 + k * 0.25, 0.8));
    if (b % 4 === 0) {
      add(49, o, 0.95);
      add(57, o + 2, 0.8);
    }
    add(51, o + 0.5, 0.6);
    add(51, o + 2.5, 0.6);
    add(52, o + 3.75, 0.7);
  }
  let mine = Infinity,
    gobo = Infinity;
  for (let k = 0; k < 3; k++) {
    mine = Math.min(mine, play(N, {}, 32, 1).cpuMs);
    gobo = Math.min(gobo, play(N, {}, 32, 1, 'core.drums').cpuMs);
  }
  const secs = 32 * BEAT + 1;
  t.ok(
    mine <= gobo * 1.25,
    `a busy groove (${N.length} notes: 16th hats, a fill every other bar, crash, ride and china ringing) costs ${fmt(mine / (secs * 10), 2)}% of a core, Gobo Kit ${fmt(gobo / (secs * 10), 2)}% (x${fmt(mine / gobo, 2)}; budget x1.25)`,
  );
}

// ================================================================================================ Chromium
if (!process.env.NODE_ONLY) {
  console.log('the device check in Chromium');
  const { open } = await import('./pw.js');
  const { page, errors, close } = await open('/app/');
  try {
    const run = (over, quick) =>
      page.evaluate(
        async ({ over, quick }) => {
          const { getDevice } = await import('/app/src/devices/registry.js');
          const { checkDevice, summarize } = await import('/app/src/kernel/check.js');
          const d = getDevice('core.drumroom');
          const def = { ...d, params: d.params.map((p) => (p.key in over ? { ...p, def: over[p.key] } : p)) };
          const r = await checkDevice(def, { quick });
          return { ok: r.ok, warnings: r.warnings, errors: r.errors, s: summarize(r), lat: r.latency };
        },
        { over, quick },
      );
    const full = await run({}, false);
    t.ok(full.ok && !full.warnings.length, `checkDevice at the defaults (full mode): ${full.s}`);
    t.ok(
      full.lat && full.lat.samples === full.lat.declared && full.lat.declared > 0,
      `the onset lands where the declared latency says (${full.lat && full.lat.samples} / ${full.lat && full.lat.declared} samples: the limiter's look-ahead)`,
    );
    for (const pr of kit.presets) {
      const r = await run(pr.params, true);
      t.ok(r.ok && !r.warnings.length, `checkDevice (quick) with preset ${pr.name}: ${r.s}`);
    }
    for (const k of [1, 2, 3, 4]) {
      const r = await run({ kit: k }, true);
      t.ok(r.ok && !r.warnings.length, `checkDevice (quick) on kit ${KITS[k]}: ${r.s}`);
    }
    const mine = errors.filter((e) => /drumroom|builtin/.test(e));
    t.ok(!mine.length, `no page errors from the kit${mine.length ? ': ' + mine.join(' | ') : ''}`);
  } finally {
    await close();
  }
}
t.done();
