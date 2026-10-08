// "Boiler Room": modern metal, 32 bars in C minor (drop C) at 132 bpm (0:58): an intro, the riff, a chorus, a beat of
// silence, a half-time breakdown and the riff again to the last hit. The boiler room is the loudest room in any
// building. Every part of it is an op, dispatched through the store as an agent's would be (lib.js built), on the
// devices the genre guide names (get_guide "genres", metal):
//   - Rusty Sticks (core.metalkit), Modern: the kick in unison with the riff's chugs (djent unison), double kick
//     under the chorus, the snare on two and four, then on three in the breakdown, the China riding it, a tom fill
//     into the chorus. Drum Riser (Modern) on the kit.
//   - Two DI Box rhythm guitars, each its own performance (a different seed and feel, never a copy), hard left and
//     hard right, palm-muted chugs on the low C and power chords, each into Half Stack (Modern) and a Slide Rule that
//     takes the fizz off.
//   - Roundwound (core.ebass) on the chugs' roots an octave down, into Y Cable (Modern): a clean, mono low end under
//     a driven top.
// The house played that. Claude played over it: the lead in the chorus and the last bars (DI Box through Half Stack's
// Lead preset, a delay that opens on each phrase's last held note, and a room), and the breakdown's dissonant hits on
// the second guitar.
// The master: Slide Rule, Gatefold (mono under 120 Hz, STEEP), Clip Lamp (Master clip +3), then Red Line at -1 dBTP, a clean ceiling (master.clip 'clean').
// Measured on the canonical Node render (tools/genre-demos-test.js holds it to TARGETS.metal and the rhythm guitars to
// the spec's bands); the numbers are in that test's table, not repeated here where they would drift.

import { HOUSE, AGENT, demo, built, preset, groove } from './lib.js';

export const META = {
  id: 'boiler-room',
  title: 'Boiler Room',
  genre: 'Metal',
  line: 'drop C riffs on Half Stack, Rusty Sticks, a half-time breakdown; the lead by Claude',
  tempo: 132,
  key: 'C minor',
  targets: 'metal',
};

const TEMPO = 132,
  BARS = 32;
export const FORM = [
  ['Intro', 0, 4],
  ['Riff', 4, 8],
  ['Chorus', 12, 8],
  ['Breakdown', 20, 8],
  ['Riff 2', 28, 4],
];
// the heavy section (the loudest 8 bars), for the measuring: [name, first bar, bars]
export const DROPS = [['Chorus', 12, 8]];

const C2 = 36;
const n = (p, t, d, v) => ({ p, t, d, v });
const PC = (r) => [r, r + 7, r + 12]; // a power chord: root, fifth, octave
// One bar of riff from 16 steps: m a palm-muted chug on the low C (soft: DI Box mutes it), a letter a chord over C2
// (a = C5 ... power chords by the semitones in ROOTS), '.' held, '-' rest. hits: where a note starts (the kick's).
const ROOTS = { a: 0, b: 3, c: 5, d: 6, e: 7, f: 8, g: 10, x: 0, A: 0, F: 8, G: 10 };
// a capital rings the whole chord, its third on top (C minor, Ab major, Bb major): the intro's open chords
const THIRD = { A: 15, F: 16, G: 16 };
function riffBar(row, bar, { mute = 0.28, chord = 0.82, low = C2 } = {}) {
  const steps = row.replace(/ /g, ''),
    out = [],
    hits = [];
  for (let s = 0; s < 16; s++) {
    const c = steps[s],
      t = bar * 4 + s / 4;
    if (c === 'm') {
      out.push(n(low, t, 0.22, mute));
      hits.push([t, 'm']);
    } else if (ROOTS[c] != null) {
      let len = 1;
      while (s + len < 16 && steps[s + len] === '.') len++;
      const voice =
        c === 'x'
          ? [low, low + 6, low + 12]
          : THIRD[c]
            ? [...PC(low + ROOTS[c]), low + ROOTS[c] + THIRD[c]]
            : PC(low + ROOTS[c]); // x: the tritone hit
      for (const p of voice) out.push(n(p, t, len / 4 - 0.03, chord));
      hits.push([t, c]);
    }
  }
  return { out, hits };
}
const RIFF = ['m-mm -m-m m-b. m-mm', 'm-mm -m-m c.d. b...', 'm-mm -m-m m-b. m-mm', 'mmmm m-m- g.f. e...'];
const BREAK = ['a... ..m. -m-- m-m-', '---- m-m- --m- b...', 'a... ..m. -m-- m-m-', '---- m-m- x... ....'];
// the chorus: open power chords, struck on the beat and the "and" of two and four, ringing
const CHORUS = ['f... ...f ..f. ...f', 'g... ...g ..g. ...g', 'a... ...a ..a. ...a', 'b... ...b ..g. ....'];

function guitars(seed) {
  const out = [],
    kick = [];
  const put = (row, bar, o) => {
    const r = riffBar(row, bar, o);
    out.push(...r.out);
    kick.push(...r.hits);
  };
  // the intro: the chorus chords, let ring, then the riff's last bar as a pickup
  for (let b = 0; b < 3; b++)
    put(['A... .... .... ....', 'F... .... .... ....', 'G... .... .... ....'][b], b, { chord: 0.62 });
  put(RIFF[3], 3);
  for (let b = 4; b < 12; b++) put(RIFF[(b - 4) % 4], b);
  for (let b = 12; b < 20; b++) put(b === 19 ? 'b... ...b ..g. ----' : CHORUS[(b - 12) % 4], b, { chord: 0.85 });
  for (let b = 20; b < 28; b++) put(BREAK[(b - 20) % 4], b, { mute: 0.32 });
  for (let b = 28; b < 31; b++) put(RIFF[(b - 28) % 4], b);
  put('A... .... .... ....', 31, { chord: 0.9 });
  return { notes: groove(out, { seed, vel: 0.05, time: 0.004 }), kick };
}

// -------------------------------------------------------------------------------------------------- drums
// Studio A's note map: 36 kick, 38 snare, 42 closed hat, 46 open, 49 crash, 57 sizzle crash, 52 China, 51 ride,
// 48/45/43 toms
const K = 36,
  S = 38,
  H = 42,
  CR = 49,
  CR2 = 57,
  CH = 52,
  RD = 51,
  T1 = 48,
  T2 = 45,
  T3 = 43;
function drums(kicks) {
  const out = [];
  const bar = (b) => b * 4;
  // kicks in unison with the guitar's hits in the riffs and the breakdown
  for (const [t] of kicks) {
    const b = Math.floor(t / 4);
    if ((b >= 3 && b < 12) || (b >= 20 && b < 31)) out.push(n(K, t, 0.2, 0.9));
  }
  // the intro: floor toms and crashes on the chords
  for (let b = 0; b < 3; b++) {
    out.push(n(CR, bar(b), 1, 0.7), n(K, bar(b), 0.2, 0.75));
    for (let i = 0; i < 4; i++) out.push(n(T3, bar(b) + i, 0.2, 0.4 + 0.08 * i));
  }
  out.push(n(S, bar(3) + 1, 0.2, 0.9), n(S, bar(3) + 3, 0.2, 0.9));
  for (let i = 0; i < 4; i++) out.push(n(H, bar(3) + i, 0.1, 0.7));
  // the riff: snare on two and four, the hat in eighths, a crash on each phrase
  for (let b = 4; b < 12; b++) {
    out.push(n(S, bar(b) + 1, 0.2, 0.95), n(S, bar(b) + 3, 0.2, 0.95));
    for (let i = 0; i < 8; i++) out.push(n(H, bar(b) + i * 0.5, 0.1, i % 2 ? 0.55 : 0.8));
    if (b % 4 === 0) out.push(n(CR, bar(b), 1, 0.9));
  }
  // a fill into the chorus: sixteenths down the toms over the last two beats
  const fill = [S, S, T1, T1, T2, T2, T3, T3];
  out.splice(
    out.findIndex((x) => x.p === S && x.t === bar(11) + 3),
    1,
  );
  fill.forEach((p, i) => out.push(n(p, bar(11) + 2 + i * 0.25, 0.2, 0.75 + 0.03 * i)));
  // the chorus: double kick in sixteenths, the snare on two and four, the crash riding eighths, a China on the
  // first beat of each phrase; a beat of silence before the breakdown
  for (let b = 12; b < 20; b++) {
    const end = b === 19 ? 12 : 16;
    for (let s = 0; s < end; s++) out.push(n(K, bar(b) + s / 4, 0.15, s % 4 === 0 ? 0.9 : 0.8));
    out.push(n(S, bar(b) + 1, 0.2, 1));
    if (b !== 19) out.push(n(S, bar(b) + 3, 0.2, 1));
    for (let i = 0; i < (b === 19 ? 6 : 8); i++)
      out.push(n(i % 4 === 0 ? CR : CR2, bar(b) + i * 0.5, 0.4, i % 2 ? 0.6 : 0.8));
    if (b % 4 === 0) out.push(n(CH, bar(b), 1, 0.9));
  }
  // the breakdown: half time, the China on the beat, the snare on three
  for (let b = 20; b < 28; b++) {
    out.push(n(S, bar(b) + 2, 0.2, 1));
    for (let i = 0; i < 4; i++) out.push(n(CH, bar(b) + i, 0.4, i === 0 ? 0.95 : 0.75));
  }
  // the riff again, the ride's bell instead of the hat, to the last hit
  for (let b = 28; b < 31; b++) {
    out.push(n(S, bar(b) + 1, 0.2, 0.95), n(S, bar(b) + 3, 0.2, 0.95));
    for (let i = 0; i < 8; i++) out.push(n(RD, bar(b) + i * 0.5, 0.2, i % 2 ? 0.55 : 0.8));
  }
  out.push(
    n(CR, bar(28), 1, 0.95),
    n(CR, bar(31), 2, 1),
    n(CH, bar(31), 2, 0.9),
    n(K, bar(31), 0.2, 1),
    n(S, bar(31), 0.2, 1),
  );
  return groove(out, { seed: 132, push: { 38: 0.004, 42: -0.003 }, vel: 0.04, time: 0.002 });
}

// the bass: the guitar's roots an octave down, its chugs as picked notes
function bass(gtr) {
  const out = [];
  for (const x of gtr)
    if (
      x.p === C2 ||
      (x.v > 0.5 && [0, 3, 5, 6, 7, 8, 10].includes(x.p - C2) && !gtr.some((y) => y.t === x.t && y.p < x.p))
    )
      out.push({ ...x, p: x.p - 12, v: x.v < 0.5 ? 0.7 : 0.85 });
  return out;
}

// Claude's lead: a line over the chorus (C minor, from G4 up to C6) and an answer over the last bars
const LEAD = [
  [67, 0, 1.5],
  [68, 1.5, 0.5],
  [70, 2, 2],
  [72, 4, 1.5],
  [70, 5.5, 0.5],
  [68, 6, 1],
  [67, 7, 1],
  [75, 8, 2],
  [74, 10, 1],
  [72, 11, 1],
  [74, 12, 3],
  [70, 15, 1],
  [67, 16, 1.5],
  [68, 17.5, 0.5],
  [70, 18, 2],
  [72, 20, 1.5],
  [75, 21.5, 0.5],
  [77, 22, 2],
  [79, 24, 1.5],
  [77, 25.5, 0.5],
  [75, 26, 1],
  [74, 27, 1],
  [72, 28, 3],
];
const lead = (bar, v = 0.8) =>
  groove(
    LEAD.map(([p, t, d]) => n(p, bar * 4 + t, d - 0.06, v)),
    { seed: 77, vel: 0.04, time: 0.003 },
  );

const GTR = { body: 0, pick: 0.15, pickup: 0, tone: 0.7, decay: 1.2, strum: 6, mute: 1 };
const GTR_EQ = {
  b1_on: 1,
  b1_type: 4,
  b1_freq: 90,
  b4_on: 1,
  b4_type: 0,
  b4_freq: 400,
  b4_gain: -2,
  b4_q: 1.2,
  b8_on: 1,
  b8_type: 6,
  b8_freq: 9500,
};

export function make() {
  const base = demo({
    title: 'Boiler Room',
    tempo: TEMPO,
    key: { root: 'C', scale: 'minor' },
    sections: [],
    tracks: [],
    bars: BARS,
  });
  const sections = FORM.map(([name, start, length]) => ({
    type: 'section.add',
    section: { name, start: start * 4, length: length * 4 },
  }));
  const clipOf = (track, start, bars, notes) => ({
    type: 'clip.add',
    track,
    clip: {
      id: `c_${track.slice(2)}${start}`,
      start: start * 4,
      length: bars * 4,
      notes: notes
        .filter((x) => x.t >= start * 4 - 0.05 && x.t < (start + bars) * 4 - 0.05)
        .map((x) => ({ ...x, t: +Math.max(0, x.t - start * 4).toFixed(4) })),
    },
  });
  const left = guitars(1),
    right = guitars(2);
  // Claude's breakdown hits are on the right guitar only: take them off the house's take
  const isHit = (x) => x.t >= 80 && x.t < 112 && x.v > 0.5;
  const rightHouse = right.notes.filter((x) => !isHit(x)),
    rightClaude = right.notes.filter(isHit);
  const D = drums(left.kick);
  const B = bass(left.notes);
  const stack = (track, id) => [
    {
      type: 'insert.add',
      track,
      insert: { id: id + 'amp', device: 'core.stack', params: preset('core.stack', 'Modern', { level: 10 }) },
    },
    { type: 'insert.add', track, insert: { id: id + 'eq', device: 'core.eq8', params: GTR_EQ } },
  ];
  const house = [
    ...sections,
    {
      type: 'track.add',
      track: {
        id: 't_drums',
        name: 'Drums',
        color: 'var(--c-1)',
        instrument: { device: 'core.metalkit', params: preset('core.metalkit', 'Modern', { sub: -13 }) },
      },
    },
    ...FORM.map(([, s, l]) => clipOf('t_drums', s, l, D)),
    {
      type: 'insert.add',
      track: 't_drums',
      insert: { id: 'fx_dbus', device: 'core.drumbus', params: preset('core.drumbus', 'Modern') },
    },

    {
      type: 'track.add',
      track: {
        id: 't_gtl',
        name: 'Guitar L',
        color: 'var(--c-4)',
        instrument: { device: 'core.guitar', params: GTR },
        pan: -1,
        gain: 0,
      },
    },
    ...FORM.map(([, s, l]) => clipOf('t_gtl', s, l, left.notes)),
    ...stack('t_gtl', 'fx_l'),
    {
      type: 'track.add',
      track: {
        id: 't_gtr',
        name: 'Guitar R',
        color: 'var(--c-3)',
        instrument: { device: 'core.guitar', params: { ...GTR, pick: 0.17, tone: 0.68 } },
        pan: 1,
        gain: 0,
      },
    },
    ...FORM.map(([, s, l]) => clipOf('t_gtr', s, l, rightHouse)),
    ...stack('t_gtr', 'fx_r'),

    {
      type: 'track.add',
      track: {
        id: 't_bass',
        name: 'Bass',
        color: 'var(--c-5)',
        instrument: { device: 'core.ebass', params: preset('core.ebass', 'Even') },
        gain: -3.5,
      },
    },
    ...FORM.map(([, s, l]) => clipOf('t_bass', s, l, B)),
    {
      type: 'insert.add',
      track: 't_bass',
      insert: { id: 'fx_brig', device: 'core.bassrig', params: preset('core.bassrig', 'Modern', { low: 0 }) },
    },

    {
      type: 'insert.add',
      track: 'master',
      insert: {
        id: 'fx_meq',
        device: 'core.eq8',
        params: {
          b1_on: 1,
          b1_type: 4,
          b1_freq: 35,
          b2_on: 1,
          b2_type: 0,
          b2_freq: 140,
          b2_gain: 1.5,
          b2_q: 0.8,
          b8_on: 1,
          b8_type: 2,
          b8_freq: 10000,
          b8_gain: -1.5,
        },
      },
    },
    { type: 'auto.write', track: 't_gtl', param: 'gain', points: '0:-12 12:-8 16:0~0.5' },
    { type: 'auto.write', track: 't_gtr', param: 'gain', points: '0:-12 12:-8 16:0~0.5' },
    {
      type: 'insert.add',
      track: 'master',
      insert: { id: 'fx_mmono', device: 'core.width', params: { monobass: 120, mono_mode: 1 } },
    },
    {
      type: 'insert.add',
      track: 'master',
      insert: { id: 'fx_mclip', device: 'core.clipper', params: preset('core.clipper', 'Master clip (+3)') },
    },
    {
      type: 'insert.add',
      track: 'master',
      insert: { id: 'fx_mlim', device: 'core.limiter', params: { gain: 4, ceiling: -1, release: 80 } },
    },
    { type: 'master.set', patch: { clip: 'clean' } },
  ];
  const claude = [
    {
      type: 'notes.add',
      track: 't_gtr',
      clip: 'c_gtr20',
      notes: rightClaude.map((x) => ({ ...x, t: +(x.t - 80).toFixed(4) })),
    },
    {
      type: 'track.add',
      track: {
        id: 't_lead',
        name: 'Lead',
        color: 'var(--c-2)',
        instrument: { device: 'core.guitar', params: { ...GTR, mute: 0, pickup: 0.1, decay: 1.4 } },
        gain: -1.5,
      },
    },
    clipOf('t_lead', 12, 8, lead(12)),
    clipOf(
      't_lead',
      28,
      4,
      lead(28, 0.75).filter((x) => x.t < 124),
    ),
    {
      type: 'insert.add',
      track: 't_lead',
      insert: { id: 'fx_ldamp', device: 'core.stack', params: preset('core.stack', 'Lead', { level: 6 }) },
    },
    {
      type: 'insert.add',
      track: 't_lead',
      insert: {
        id: 'fx_ldly',
        device: 'core.delay',
        params: { div: 7, mode: 1, feedback: 0.25, tone: 3000, lowcut: 400, wow: 0.05, mix: 0.18 },
      },
    },
    // the echo opens on each phrase's last held note
    {
      type: 'auto.write',
      track: 't_lead',
      insert: 'fx_ldly',
      param: 'mix',
      points: '48:0.12 59:0.12 60:0.3 63:0.3 64:0.12 75:0.12 76:0.32 80:0.12 112:0.12 120:0.3~0.3 128:0.35',
    },
    {
      type: 'insert.add',
      track: 't_lead',
      insert: { id: 'fx_lverb', device: 'core.verb', params: { size: 0.6, decay: 1.6, mix: 0.14 } },
    },
  ];
  return built(base, [
    [HOUSE, 'the house plays Boiler Room', house],
    [AGENT, 'Claude plays the lead and the breakdown hits', claude],
  ]);
}
export default make;
