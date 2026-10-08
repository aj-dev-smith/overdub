// The Jam room [jam]: core/jam.js, core/fretboard.js and ui/jam.js, and the engine's practice speed.
//   1. the chord timeline on known material: Night Shift's chords bar by bar; every jam style's progression back from
//      its own notes; a slash chord; two chords in a bar; a section in another key
//   2. the neck: every tuning's places; a fingering that keeps the hand in a span; tab out and back in
//   3. jam tracks: real songs in the asked key and tempo, the same every time for a seed, refused with a hint when
//      the asking is wrong; their levels measured in the page (the band, and a lick on the Guitar track)
//   4. tips that name frets, strings, bars and notes; a lick that stays in the box and lands on the change
//   5. the room in the page: it opens from its tab and the song keeps playing; the stage follows the playhead's chord;
//      the toggles, the tuning and left-handed change what the neck draws; a tone loads a rig onto the Guitar track as
//      ops signed by you; the loop; the practice speed (no op in History, the song's tempo unchanged, back at 100%
//      leaving the room); R records the keys onto the Guitar track
//   6. the tools: get_jam, make_jam_track, set_tone, show_on_fretboard, their results and their errors
//   7. a phone: the room stacks, the neck scrolls sideways, no page scroll sideways, 40 px targets, 12 px text
//   8. no page errors
//   9. on a laptop, with a guitar plugged in (a fake input playing a plucked string; fresh eyes, round 6): the detail
//      pane steps aside and comes back, the chord and the neck in view at 1280x800, the tab lane one line when empty,
//      ui.state.room for Sketch; chord names never clipped (1280 and 1440, the pane open); hearing a lick or a chord
//      edits nothing (Show me, show_on_fretboard play), and a lick waits for its bars on the grid; a new song with the
//      input open gets its guitar at once, monitored, one toast at most, and clears the last one's lick, line and
//      speed; one tone for both guitars; Match the band; the tuner shows settled readings only; musical typing and the
//      keys line; set_tone by name with its reason; the small copy and drawing fixes; tips that hold still
//  10. a phone (round 6): the sheet tucks and the neck is in view, Show brings it back, a thumb's swipe scrolls and
//      plays nothing, the picker's sizes, no sideways pan, 44 px targets, touch words; on its side, the chord and the
//      whole neck together; the Rig tab: the amp over a board that scrolls sideways, a thumb's swipe scrolls (the board
//      sideways, the room up and down) and a hold turns a knob
//  11. the rig (the Rig tab): the amp at its full face with knobs a finger and a mouse can turn, the cab and mics under
//      it, a knob one op; the pedalboard in signal order (your guitar, the pedals, Add a pedal, the amp's place, the
//      pedals after it); a footswitch bypasses; add, take off and move a pedal, on both guitars, one undo step each; all
//      of it on screen at 1280x800 and 1440x900. The Band level: the band down and the guitars as they were, measured
//      on the live meters; never the song, History or a render; shown in the room, back to 0 dB on leaving; Match the
//      band uses it when the fader's top can't put a quiet guitar 3 dB over the band
// usage: node tools/jam-test.js     (screenshots: tools/.out/jam-*.png; LEVELS=0 skips the level renders)
import { open, tally, OUTDIR, QUIET, TEXT } from './pw.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { startServer, ready } from '../server/serve.js';
import * as JAM from '../app/src/core/jam.js';
import * as FB from '../app/src/core/fretboard.js';
import { demoProject } from '../app/src/core/demo.js';
import { createProject } from '../app/src/core/project.js';
import { scalePcs } from '../app/src/core/music.js';

const T = tally('jam');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) =>
  /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);
// a check that can't run (a hook that isn't there) fails with why, and the run goes on
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    T.ok(
      false,
      `${name}: ${String((e && e.message) || e)
        .split('\n')[0]
        .slice(0, 160)}`,
    );
  }
};
// A guitar for the fake input: a plucked A2 (Karplus-Strong, seeded) every half second, four seconds, looped by the
// browser (--use-file-for-fake-audio-capture). Steady, so the monitor, the meter and Match the band have it to hear.
function fakeGuitar(file, level = 0.6) {
  const sr = 48000,
    n = sr * 4,
    x = new Float32Array(n);
  let seed = 3;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  for (let k = 0; k < 8; k++) {
    const t0 = (k * sr) / 2,
      N = Math.round(sr / 110),
      line = Float32Array.from({ length: N }, () => rnd() * 0.5);
    for (let i = t0, j = 0; i < Math.min(n, t0 + sr / 2); i++) {
      const y = line[j];
      line[j] = 0.5 * (y + line[(j + 1) % N]) * 0.998;
      j = (j + 1) % N;
      x[i] += y;
    }
  }
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * level * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
  return file;
}

/* ============================================================================ 1. the chord timeline */
{
  const ns = demoProject();
  const tl = JAM.chordTimeline(ns);
  const byBar = [1, 2, 3, 4, 5, 6, 7, 8].map((b) => JAM.chordAt(tl, (b - 1) * 4 + 0.01).chord?.name);
  T.ok(byBar.join(' ') === 'Am7 Fmaj7 C G7 Am7 Fmaj7 C G7', `Night Shift's chords, bar by bar: ${byBar.join(' ')}`);
  T.ok(
    tl.key.root === 'A' && tl.key.scale === 'minor' && tl.keyFrom === 'song',
    `its key is the song's: ${tl.key.root} ${tl.key.scale}`,
  );
  T.ok(
    tl.chords
      .slice(0, 4)
      .map((c) => c.roman)
      .join(' ') === 'i7 bVImaj7 bIII bVII7',
    `Roman numerals in A minor: ${tl.chords
      .slice(0, 4)
      .map((c) => c.roman)
      .join(' ')}`,
  );
  T.ok(
    tl.chords[0].tones.map((t) => `${t.note}:${t.name}`).join(' ') === 'A:R C:b3 E:5 G:b7',
    `Am7's tones by interval: ${tl.chords[0].tones.map((t) => `${t.note}:${t.name}`).join(' ')}`,
  );
  // every jam style's own progression comes back from the notes the band plays (power chords come back as power chords)
  const bad = [];
  for (const id of JAM.JAM_STYLE_IDS) {
    const r = JAM.jamTrack({ style: id });
    const x = JAM.chordTimeline(r.project);
    for (const c of r.chart) {
      const got = JAM.chordAt(x, c.a + 0.01).chord;
      const want = JAM.parseChord(c.name, r.key);
      const ok =
        got && (JAM.JAM_STYLES[id].power ? got.root === want.root && got.quality === '5' : got.name === c.name);
      if (!ok) {
        bad.push(`${id} bar ${c.bar}: ${c.name} read as ${got ? got.name : 'nothing'}`);
        break;
      }
    }
  }
  T.ok(
    !bad.length,
    `every jam style's progression is read back from its own notes (${JAM.JAM_STYLE_IDS.length} styles${bad.length ? ': ' + bad.join('; ') : ''})`,
  );
  // a slash chord: C over its third in the bass
  const p = createProject({
    title: 'Slash',
    tempo: 100,
    key: { root: 'C', scale: 'major' },
    tracks: [
      {
        name: 'Keys',
        kind: 'instrument',
        instrument: { device: 'core.keys' },
        clips: [
          {
            kind: 'notes',
            start: 0,
            length: 8,
            notes: [
              { p: 60, t: 0, d: 4 },
              { p: 64, t: 0, d: 4 },
              { p: 67, t: 0, d: 4 },
              { p: 55, t: 4, d: 4 },
              { p: 59, t: 4, d: 4 },
              { p: 62, t: 4, d: 4 },
            ],
          },
        ],
      },
      {
        name: 'Bass',
        kind: 'instrument',
        instrument: { device: 'core.bass' },
        clips: [
          {
            kind: 'notes',
            start: 0,
            length: 8,
            notes: [
              { p: 40, t: 0, d: 2 },
              { p: 40, t: 2, d: 2 },
              { p: 47, t: 4, d: 4 },
            ],
          },
        ],
      },
    ],
  });
  const sl = JAM.chordTimeline(p);
  T.ok(
    sl.chords.map((c) => c.name).join(' ') === 'C/E G/B',
    `slash chords from the bass: ${sl.chords.map((c) => c.name).join(' ')}`,
  );
  // two chords in a bar, and a key that moves in a section
  const two = JAM.jamTrack({ style: 'indie', key: 'C', progression: 'C G | Am F', bars: 4 });
  const t2 = JAM.chordTimeline(two.project);
  T.ok(
    ['C', 'G', 'Am', 'F'].every((n, i) => JAM.chordAt(t2, i * 2 + 0.01).chord?.name === n),
    `two chords to a bar ("C G | Am F"): ${[0, 2, 4, 6].map((b) => JAM.chordAt(t2, b + 0.01).chord?.name).join(' ')}`,
  );
  const mod = JAM.jamTrack({ style: 'indie', key: 'C', progression: 'C G Am F C G Am F D A Bm G D A Bm G' });
  mod.project.sections = [
    { id: 's_a', name: 'Verse', start: 0, length: 32 },
    { id: 's_b', name: 'Chorus', start: 32, length: 32 },
  ];
  const sk = JAM.sectionKeys(mod.project, JAM.chordTimeline(mod.project), mod.project.key);
  T.ok(
    sk && /^Chorus moves to D major \(bars 9–16\): F# and C# come in/.test(sk.text),
    `a section in another key is named: "${sk?.text}"`,
  );
  const blues = JAM.jamTrack({ style: 'blues' });
  T.ok(
    !JAM.sectionKeys(blues.project, JAM.chordTimeline(blues.project), blues.project.key),
    'a blues, every chord stepping out alike, is not a key change',
  );
}

/* ============================================================================ 2. the neck */
{
  // every tuning's open strings are its places at fret 0, and a few notes known by heart
  const open = FB.TUNING_IDS.every((id) =>
    FB.TUNINGS[id].strings.every((p, s) => FB.positionsOf(p, id).some((x) => x.s === s && x.f === 0)),
  );
  T.ok(open && FB.TUNING_IDS.length === 5, `5 tunings, each open string found at fret 0 (${FB.TUNING_IDS.join(', ')})`);
  const cases = [
    [
      'standard',
      'A4',
      [
        [5, 5],
        [4, 10],
        [3, 14],
        [2, 19],
      ],
    ],
    ['standard', 'E2', [[0, 0]]],
    ['drop-d', 'D2', [[0, 0]]],
    ['drop-d', 'E2', [[0, 2]]],
    [
      'half-down',
      'Eb4',
      [
        [5, 0],
        [4, 5],
        [3, 9],
        [2, 14],
        [1, 19],
      ],
    ],
    [
      'dadgad',
      'A3',
      [
        [4, 0],
        [3, 2],
        [2, 7],
        [1, 12],
        [0, 19],
      ],
    ],
    [
      'open-g',
      'G2',
      [
        [1, 0],
        [0, 5],
      ],
    ],
    [
      'open-g',
      'B3',
      [
        [4, 0],
        [3, 4],
        [2, 9],
        [1, 16],
        [0, 21],
      ],
    ],
  ];
  const wrong = [];
  for (const [tu, note, want] of cases) {
    const got = FB.positionsOf(note, tu)
      .map((x) => [x.s, x.f])
      .sort((a, b) => b[0] - a[0]);
    const w = want.slice().sort((a, b) => b[0] - a[0]);
    if (JSON.stringify(got) !== JSON.stringify(w)) wrong.push(`${note} in ${tu}: ${JSON.stringify(got)}`);
  }
  T.ok(
    !wrong.length,
    `notes land where they are played, in each tuning (${cases.length} cases${wrong.length ? ': ' + wrong.join('; ') : ''})`,
  );
  T.ok(
    !FB.positionsOf('D2', 'standard').length && FB.positionsOf('D2', 'drop-d').length === 1,
    'D2 is off the neck in standard and the open low string in drop D',
  );
  // the box run: one hand position, a fret a finger
  const run = 'A2 C3 D3 E3 G3 A3 C4 D4 E4 G4 A4 C5 A4 G4 E4'.split(' ').map((p, i) => ({ p, t: i * 0.5 }));
  const f = FB.fingering(run, 'standard', { near: 5, open: 0.6 });
  T.ok(
    f.position === 5 &&
      f.shifts === 0 &&
      FB.handSpan(f.notes) <= 4 &&
      f.notes.every((n) => n.finger >= 1 && n.finger <= 4),
    `a pentatonic run stays in one hand: position ${f.position}, ${f.shifts} shifts, span ${FB.handSpan(f.notes)} frets`,
  );
  // a line that has to move keeps every stretch in a span and moves as little as it must
  const climb = 'E3 G3 A3 C4 D4 E4 G4 A4 C5 D5 E5 G5 A5'.split(' ').map((p, i) => ({ p, t: i * 0.5 }));
  const fc = FB.fingering(climb, 'standard', { near: 5 });
  let pos = null,
    spanOk = true,
    moves = 0;
  for (const n of fc.notes) {
    if (!n.f) continue;
    const lo = n.f - n.finger + 1;
    if (pos == null || n.f < pos || n.f > pos + 3) {
      if (pos != null) moves++;
      pos = lo;
    }
    if (n.f - pos > 3 || n.f < pos) spanOk = false;
  }
  T.ok(
    spanOk && fc.shifts <= 2,
    `a two-octave climb moves the hand ${fc.shifts} time(s), every note under a finger of where it is`,
  );
  const am = FB.fingering(
    ['A2', 'E3', 'A3', 'C4', 'E4'].map((p) => ({ p, t: 0 })),
    'standard',
    { near: 1, open: -0.05 },
  );
  T.ok(
    am.notes.map((n) => `${FB.stringNumber(n.s)}:${n.f}`).join(' ') === '5:0 4:2 3:2 2:1 1:0',
    `an A minor chord is the open shape: ${am.notes.map((n) => `${FB.stringNumber(n.s)}:${n.f}`).join(' ')}`,
  );
  const seven = FB.fingering(
    'C3 C#3 D3 D#3 E3 F3 F#3'.split(' ').map((p) => ({ p, t: 0 })),
    'standard',
  );
  const low = FB.fingering([{ p: 'C2' }], 'standard');
  T.ok(
    /a guitar has 6 strings/.test(seven.error || '') && /off the neck/.test(low.error || '') && low.hint,
    `what can't be played says why: "${seven.error}"; "${low.error}"`,
  );
  // tab out and back in
  const tab = FB.formatTab(f.notes, { step: 0.5 });
  const back = FB.parseTab(tab, { step: 0.5 });
  T.ok(
    tab.split('\n').length === 6 && /^e \|/.test(tab) && /^E \|/.test(tab.split('\n')[5]),
    'tab has six lines, the high e on top',
  );
  T.ok(
    !back.errors.length &&
      back.notes.map((n) => `${n.p}@${n.t}`).join(' ') === f.notes.map((n) => `${n.p}@${n.t}`).join(' '),
    `tab read back gives the same notes at the same times (${back.notes.length})`,
  );
  const typed = FB.parseTab('e|-----0-|\nB|---1---|\nG|-2-----|\nD|-------|\nA|-------|\nE|-------|', { step: 0.5 });
  T.ok(
    typed.notes.map((n) => n.p).join(' ') === '57 60 64',
    `typed tab reads too: ${typed.notes.map((n) => n.p).join(' ')}`,
  );
}

/* ============================================================================ 3. jam tracks */
{
  const r = JAM.jamTrack({ style: 'blues', key: 'E', tempo: 70 });
  const p = r.project;
  const names = p.tracks.map((t) => t.name).join(', ');
  T.ok(
    p.title === 'Blues shuffle in E' && p.key.root === 'E' && p.key.scale === 'blues' && p.tempo === 70,
    `a slow blues in E: "${p.title}", ${p.key.root} ${p.key.scale}, ${p.tempo} BPM`,
  );
  T.ok(
    p.loop.on &&
      p.loop.start === 0 &&
      p.loop.end === 96 &&
      p.sections.map((s) => `${s.name}:${s.start}-${s.start + s.length}`).join(' ') === 'Chorus 1:0-48 Chorus 2:48-96',
    `24 bars, looped, two choruses: ${p.sections.map((s) => s.name).join(', ')}`,
  );
  const g = p.tracks.find((t) => t.name === 'Guitar');
  T.ok(
    names === 'Drums, Bass, Organ, Guitar' &&
      p.tracks.slice(0, 3).every((t) => t.clips.length === 1 && t.clips[0].notes.length > 40) &&
      g?.instrument.device === 'core.guitar' &&
      !g.clips.length,
    `a real song: ${names}; the band has notes, the Guitar track is DI Box and empty`,
  );
  T.ok(
    p.tracks.slice(0, 3).every((t) => t.by === 'overdub' && t.clips[0].notes.every((n) => n.by === 'overdub')) &&
      p.meta.jam?.style === 'blues',
    'the house band signs its parts, and the song keeps its recipe (meta.jam)',
  );
  // in the asked key: every pitched note of a diatonic style is in its key's scale (or a chord tone of its bar)
  const outOfKey = [];
  for (const id of ['indie', 'ballad', 'lofi', 'neosoul']) {
    for (const key of ['G', 'Bb', 'F# minor']) {
      const x = JAM.jamTrack({ style: id, key });
      const pcs = new Set(scalePcs(x.project.key));
      const extra = new Set(x.chart.flatMap((c) => JAM.parseChord(c.name, x.project.key).pcs));
      for (const t of x.project.tracks)
        if (!/drum/i.test(t.instrument?.device || ''))
          for (const c of t.clips)
            for (const n of c.notes)
              if (!pcs.has(n.p % 12) && !extra.has(n.p % 12)) outOfKey.push(`${id} in ${key}: ${t.name} ${n.p}`);
    }
  }
  T.ok(
    !outOfKey.length,
    `jam tracks are in the key asked for (4 styles x 3 keys${outOfKey.length ? ': ' + outOfKey.slice(0, 3).join('; ') : ''})`,
  );
  const again = JAM.jamTrack({ style: 'blues', key: 'E', tempo: 70 });
  const other = JAM.jamTrack({ style: 'blues', key: 'E', tempo: 70, seed: 2 });
  T.ok(
    JSON.stringify(again.project.tracks) === JSON.stringify(p.tracks) &&
      JSON.stringify(other.project.tracks[0].clips[0].notes) !== JSON.stringify(p.tracks[0].clips[0].notes),
    'the same recipe gives the same song, ids and all; another seed another take',
  );
  const errs = [
    [{ style: 'zydeco' }, /no jam style/],
    [{ style: 'blues', key: 'H minor' }, /can't read the key/],
    [{ style: 'blues', tempo: 400 }, /out of range/],
    [{ style: 'blues', progression: 'Q7 Z' }, /can't read/],
    [{ style: 'blues', bars: 500 }, /too long/],
  ];
  const errOk = errs.every(([o, re]) => {
    const x = JAM.jamTrack(o);
    return x.error && re.test(x.error) && x.hint;
  });
  T.ok(errOk, "a style, key, tempo, progression or length it can't use is refused with what would work");
  const pr = JAM.parseProgression('i7 | iv7 V7 | bVII % ', { root: 'A', scale: 'minor' });
  T.ok(
    pr.bars.map((b) => b.map((c) => c.name).join(' ')).join(' | ') === 'Am7 | Dm7 E7 | G G',
    `numerals in a key, | between bars, % again: ${pr.bars.map((b) => b.map((c) => c.name).join(' ')).join(' | ')}`,
  );
  const sy = ['C', 'Am7', 'F#m7b5', 'Bbmaj7', 'E5', 'G/B', 'Dsus4', 'Ebdim7']
    .map((s) => JAM.parseChord(s)?.name)
    .join(' ');
  T.ok(
    sy === 'C Am7 F#m7b5 A#maj7 E5 G/B Dsus4 D#dim7' || sy === 'C Am7 F#m7b5 Bbmaj7 E5 G/B Dsus4 Ebdim7',
    `chord names read: ${sy}`,
  );
}

/* ============================================================================ 4. tips */
{
  const ns = demoProject();
  const tips = JAM.jamTips(ns, JAM.chordTimeline(ns), { at: 0 });
  const k = Object.fromEntries(tips.map((t) => [t.kind, t]));
  T.ok(
    /^A minor pentatonic fits the whole song: A C D E G\. Start at the 5th fret/.test(k.scale?.text || ''),
    `the scale and where to start: "${k.scale?.text}"`,
  );
  T.ok(
    /^At bar 2 the chord moves to Fmaj7\. Land on F, its root/.test(k.target?.text || '') &&
      /fret, [A-Za-z ]+string/.test(k.target.text),
    `the note to land on at the change, with its fret and string: "${k.target?.text}"`,
  );
  const lick = k.lick?.lick;
  const fr = (lick?.notes || []).map((n) => n.f);
  const landed = lick?.notes.find((n) => n.t === 4);
  T.ok(
    lick &&
      Math.min(...fr) >= 4 &&
      Math.max(...fr) <= 9 &&
      FB.handSpan(lick.notes) <= 5 &&
      landed &&
      landed.p % 12 === 5,
    `a two-bar lick in the box (frets ${Math.min(...fr)}-${Math.max(...fr)}) that lands on F as Fmaj7 arrives`,
  );
  T.ok(
    lick && lick.tab.split('\n').length === 6 && /lands on F as Fmaj7 arrives/.test(lick.text),
    'the lick comes with its tab and says where it lands',
  );
  const fluff = tips.filter((t) => !/\b(\d+(st|nd|rd|th) fret|bar \d+|[A-G][#b]?\d?\b)/.test(t.text));
  T.ok(
    !fluff.length && tips.length >= 3,
    `every tip names a fret, a bar or a note (${tips.length} tips${fluff.length ? '; vague: ' + fluff.map((t) => t.kind).join(', ') : ''})`,
  );
  const b = JAM.jamTrack({ style: 'blues' });
  const bt = JAM.jamTips(b.project, JAM.chordTimeline(b.project), { at: 0 });
  const out = bt.find((t) => t.kind === 'outside');
  T.ok(
    out && /C# over A7, F# over D7, G# and B over E7/.test(out.text),
    `over a blues, the notes each chord brings, spelled from the chord: "${out?.text}"`,
  );
}

/* ============================================================================ 5-8. in the page */
const boot = async (opts = {}) => {
  const s = await open('/app/', { query: 'demo', ...opts });
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await s.page.waitForFunction(() => !!window.overdub.jam?.rigs, null, { timeout: 20000 });
  await s.page.evaluate(() => document.querySelector('.ar-welcome-x')?.click());
  await s.page.waitForTimeout(300);
  return s;
};
{
  const { page, errors, close } = await boot();
  const E = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: path.join(OUTDIR, `jam-${n}.png`) });

  // ---- it opens from its tab, and the song keeps playing across
  const tabs = await E(() =>
    [...document.querySelectorAll('.ew-region-center > .ew-tabs [role=tab]')].map((t) => ({
      name: t.textContent,
      shown: t.getClientRects().length > 0,
    })),
  );
  T.ok(
    tabs.map((t) => t.name).join(' ') === 'Arrange Jam' && tabs.every((t) => t.shown),
    `the center region shows two tabs: ${tabs.map((t) => t.name).join(', ')}`,
  );
  // ... in the arranger's toolbar row, so they take no height from the song
  const row = await E(() => {
    const t = document.querySelector('.ew-region-center > .ew-tabs').getBoundingClientRect(),
      b = document.querySelector('.ar-bar').getBoundingClientRect(),
      add = document.querySelector('.ar-bar > *').getBoundingClientRect();
    return {
      top: Math.round(t.top - b.top),
      bottom: Math.round(b.bottom - t.bottom),
      gap: Math.round(add.left - t.right),
    };
  });
  T.ok(
    row.top === 0 && row.bottom >= 0 && row.gap >= 8,
    `the tabs sit in the arranger's toolbar row, before its first control (${row.gap} px clear), not in a row of their own`,
  );
  await E(() => window.overdub.transport.playStop());
  await page.waitForFunction(() => window.overdub.engine.playing && window.overdub.engine.beat > 0.3, null, {
    timeout: 8000,
  });
  const b0 = await E(() => window.overdub.engine.beat);
  await page.click('#ew-tab-jam');
  await sleep(900);
  const sw = await E(() => ({
    playing: window.overdub.engine.playing,
    beat: window.overdub.engine.beat,
    room: !document.querySelector('[data-panel="jam"]').hidden,
    arr: !document.querySelector('[data-panel="arranger"]').hidden,
    chord: document.querySelector('.jm-now-name').textContent,
  }));
  T.ok(
    sw.room && !sw.arr && sw.playing && sw.beat > b0 + 0.5,
    `the Jam tab opens the room and the song plays on (beat ${b0.toFixed(2)} → ${sw.beat.toFixed(2)})`,
  );
  await page
    .waitForFunction(() => window.overdub.engine.beat > 4.3 && window.overdub.engine.beat < 7.5, null, {
      timeout: 8000,
    })
    .catch(() => {});
  const st2 = await E(() => ({
    beat: window.overdub.engine.beat,
    now: document.querySelector('.jm-now-name').textContent,
    next: document.querySelector('.jm-next-name').textContent,
    sec: document.querySelector('.jm-sec').textContent,
  }));
  T.ok(
    st2.now === 'Fmaj7' && st2.next === 'C' && st2.sec === 'Verse',
    `the stage follows the playhead: at beat ${st2.beat.toFixed(1)}, ${st2.now} now, ${st2.next} next, in the ${st2.sec}`,
  );
  await shot('playing');
  await page.click('#ew-tab-arranger');
  await sleep(500);
  const back = await E(() => ({
    playing: window.overdub.engine.playing,
    arr: !document.querySelector('[data-panel="arranger"]').hidden,
  }));
  T.ok(back.playing && back.arr, 'Arrange again: the arranger is back and the song still plays');
  await E(() => window.overdub.transport.playStop());
  await sleep(300);
  await page.click('#ew-tab-jam');
  await sleep(400);

  // ---- the stage follows the marker when stopped, and counts down to the change
  const at = async (beat) => {
    await E((b) => window.overdub.transport.marker.set(b), beat);
    await sleep(250);
    return E(() => ({
      now: document.querySelector('.jm-now-name').textContent,
      next: document.querySelector('.jm-next-name').textContent,
      cd: document.querySelector('.jm-next-in').textContent,
      pos: document.querySelector('.jm-pos').textContent,
    }));
  };
  const s8 = await at(8),
    s14 = await at(14);
  T.ok(
    s8.now === 'C' && s8.next === 'G7' && /bar 3 of 8/.test(s8.pos),
    `stopped at bar 3: ${s8.now}, then ${s8.next} (${s8.pos})`,
  );
  T.ok(
    s14.now === 'G7' && s14.next === 'Am7' && /^2\s*beats$/.test(s14.cd.trim()),
    `two beats before the change it counts them: "${s14.cd.trim()}"`,
  );
  await at(0);

  // ---- the toggles, the tuning and left-handed change what the neck draws
  const px = (s, f, dy = -2) =>
    E(
      ([s, f, dy]) => {
        const n = window.overdub.jam.neck,
          cv = document.querySelector('.jm-neck-cv'),
          g = cv.getContext('2d'),
          dpr = cv.width / n.geometry.W;
        const { x, y } = n.at(s, f);
        const d = g.getImageData(Math.round(x * dpr), Math.round((y + dy) * dpr), 1, 1).data;
        return [d[0], d[1], d[2]];
      },
      [s, f, dy],
    );
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const togOf = (label) => page.locator('.jm-togs .tog', { hasText: new RegExp(`^${label}$`) });
  // D on the A string at the 5th fret is in the pentatonic, not in Am7: a pencil dot with Pentatonic on, wood without
  const d1 = await px(1, 5);
  await togOf('Pentatonic').click();
  await sleep(200);
  const d0 = await px(1, 5);
  T.ok(
    lum(d1) > 80 && lum(d0) < 50,
    `Pentatonic off takes its dots away (D at the 5th fret, A string: ${lum(d1).toFixed(0)} → ${lum(d0).toFixed(0)})`,
  );
  await togOf('Pentatonic').click();
  // F on the low E (1st fret) is in A minor but not the pentatonic or Am7: Scale on draws its ring
  const f0 = await px(0, 1, -4);
  await togOf('Scale').click();
  await sleep(200);
  const f1 = await px(0, 1, -4);
  T.ok(
    lum(f1) > lum(f0) + 40,
    `Scale on rings the key's other notes (F at the 1st fret: ${lum(f0).toFixed(0)} → ${lum(f1).toFixed(0)})`,
  );
  await togOf('Scale').click();
  // A on the low E (5th fret) is Am7's root: a cream square; Chord tones off leaves the pentatonic's smaller square
  const a1 = await px(0, 5, -6);
  await togOf('Chord tones').click();
  await sleep(200);
  const a0 = await px(0, 5, -6);
  T.ok(
    lum(a1) > 200 && lum(a0) < 120,
    `Chord tones off takes the chord's marks away (the root at the 5th fret: ${lum(a1).toFixed(0)} → ${lum(a0).toFixed(0)})`,
  );
  await togOf('Chord tones').click();
  await page.selectOption('.jm-tuning', 'drop-d');
  await sleep(250);
  const dd = await E(() => ({
    low: window.overdub.jam.neck.geometry.T.strings[0],
    saved: JSON.parse(localStorage.getItem('overdub:jam')).tuning,
  }));
  // in drop D the root A of Am7 on the low string moves up to the 7th fret
  const dA = await px(0, 7, -6);
  T.ok(
    dd.low === 38 && dd.saved === 'drop-d' && lum(dA) > 200,
    `drop D tunes the low string to D: A on it is at the 7th fret now (kept in this browser)`,
  );
  await page.selectOption('.jm-tuning', 'standard');
  await sleep(200);
  await page.locator('.jm-togs .tog', { hasText: 'Left-handed' }).click();
  await sleep(250);
  const lefty = await E(() => {
    const n = window.overdub.jam.neck;
    return { nut: n.at(0, 0).x, fifth: n.at(0, 5).x, W: n.geometry.W };
  });
  T.ok(
    lefty.nut > lefty.fifth && lefty.nut > lefty.W - 60,
    `left-handed puts the nut on the right (open strings at x ${Math.round(lefty.nut)} of ${lefty.W})`,
  );
  await shot('lefty');
  await page.locator('.jm-togs .tog', { hasText: 'Left-handed' }).click();
  await sleep(200);

  // ---- a tone loads a rig onto the Guitar track, as ops signed by you (the Rig tab)
  await page.click('#jm-view-rig');
  await sleep(300);
  const before = await E(() => ({ h: window.overdub.store.history.length, guitar: window.overdub.jam.guitar()?.name }));
  await page.click('.jm-tone-row .jm-flip:last-child');
  await sleep(700);
  const tone = await E(() => {
    const o = window.overdub,
      t = o.jam.guitar(),
      last = o.store.history[o.store.history.length - 1],
      rig = o.jam.tone();
    return {
      track: t.name,
      devs: t.inserts.map((x) => x.device).join('>'),
      rig: rig?.name,
      chain: rig?.chain.map((s) => s.device).join('>'),
      by: last.by,
      label: last.label,
      n: o.store.history.length,
      name: document.querySelector('.jm-tone-name').textContent,
      faces: document.querySelectorAll('.jm-board .jm-fx, .jm-amp-face').length,
    };
  });
  T.ok(
    tone.rig &&
      tone.devs === tone.chain &&
      tone.by === 'you' &&
      tone.label === `${tone.track}: ${tone.rig}` &&
      tone.n === before.h + 1,
    `the next tone loads "${tone.rig}" onto ${tone.track}: its chain, one op set signed by you ("${tone.label}")`,
  );
  T.ok(
    tone.name === tone.rig && tone.faces === tone.chain.split('>').length,
    `the room names the tone and draws its chain, ${tone.faces} faces`,
  );
  await page.keyboard.press('Escape');
  await E(() => document.querySelector('.jm-tone-row').focus());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await sleep(700);
  const flips = await E(() => window.overdub.store.history.length);
  T.ok(
    flips === tone.n + 1,
    `flipping three tones quickly is one step in History, the one you rest on (${flips - tone.n})`,
  );
  await E(() => window.overdub.store.undo());
  await E(() => window.overdub.store.undo());
  const undone = await E(() =>
    window.overdub.jam
      .guitar()
      .inserts.map((x) => x.device)
      .join('>'),
  );
  T.ok(
    /pedal\.gate>pedal\.chorus>amp\.jangle>claude\.tidal-cathedral/.test(undone),
    `undo puts the song's own chain back (${undone})`,
  );
  await page.click('#jm-view-neck');
  await sleep(200);

  // ---- the loop: one tap loops the section you're in; again, it's off
  await page.click('.jm-loop');
  const lp = await E(() => {
    const o = window.overdub,
      l = o.store.get().loop,
      last = o.store.history[o.store.history.length - 1];
    return { l, by: last.by, label: last.label, text: document.querySelector('.jm-loop').textContent };
  });
  T.ok(
    lp.l.on &&
      lp.l.start === 0 &&
      lp.l.end === 16 &&
      lp.by === 'you' &&
      lp.label === 'loop Verse' &&
      /^Looping Verse/.test(lp.text),
    `Loop Verse loops bars 1-4 ("${lp.label}", ${lp.l.start}-${lp.l.end})`,
  );
  await page.click('.jm-loop');
  T.ok(!(await E(() => window.overdub.store.get().loop.on)), 'tapped again, the loop goes off');

  // ---- practice speed: the transport slows, the song doesn't change, nothing goes in History
  const h0 = await E(() => window.overdub.store.history.length);
  await page.$eval('.jm-speed', (el) => {
    el.value = '70';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const sp = await E(() => ({
    rate: window.overdub.engine.rate,
    tempo: window.overdub.store.get().tempo,
    h: window.overdub.store.history.length,
    val: document.querySelector('.jm-speed-val').textContent,
  }));
  T.ok(
    Math.abs(sp.rate - 0.7) < 1e-9 && sp.tempo === 92 && sp.h === h0 && sp.val === '70%, 64.4 BPM',
    `70%: the transport at ${sp.val}, the song still 92 BPM, nothing in History`,
  );
  await E(() => window.overdub.transport.playStop());
  await page.waitForFunction(() => window.overdub.engine.playing && window.overdub.engine.beat > 0.2, null, {
    timeout: 8000,
  });
  const r0 = await E(() => [performance.now(), window.overdub.engine.beat]);
  await sleep(2000);
  const r1 = await E(() => [performance.now(), window.overdub.engine.beat]);
  const bps = (r1[1] - r0[1]) / ((r1[0] - r0[0]) / 1000),
    want = (92 * 0.7) / 60;
  T.ok(
    Math.abs(bps / want - 1) < 0.08,
    `it plays at 70%: ${bps.toFixed(3)} beats a second (${want.toFixed(3)} wanted)`,
  );
  const reg = await E(async () => {
    const { renderProject } = await import('/app/src/engine/render.js');
    return window.overdub.engine.beatToSec(4);
  });
  T.ok(Math.abs(reg - (4 * 60) / 92) < 1e-9, "the song's own clock (beatToSec, renders, exports) is unchanged");
  await page.click('#ew-tab-arranger');
  await sleep(300);
  const out = await E(() => ({
    rate: window.overdub.engine.rate,
    playing: window.overdub.engine.playing,
    toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '),
  }));
  T.ok(
    out.rate === 1 && out.playing && /Back to full speed: 92 BPM/.test(out.toast),
    `leaving the room, the song goes back to full speed and plays on ("${out.toast.slice(0, 60)}")`,
  );
  await E(() => window.overdub.transport.playStop());
  await page.click('#ew-tab-jam');
  await sleep(300);

  // ---- the tools
  const run = (name, input, by = 'mcp:test') =>
    E(([n, i, b]) => window.overdub.tools.run(n, i, { by: b }), [name, input, by]);
  const gj = await run('get_jam', {});
  T.ok(
    gj.song.key === 'A minor' &&
      gj.chords[0].chord === 'Am7' &&
      gj.chords[0].bars === '1' &&
      gj.chords[1].chord === 'Fmaj7' &&
      gj.chords[0].tones === 'A (R) C (b3) E (5) G (b7)',
    `get_jam: the key and the chords, bar by bar, with their tones (${gj.chords
      .slice(0, 4)
      .map((c) => c.chord)
      .join(' ')})`,
  );
  T.ok(
    gj.now.bar === 1 &&
      gj.now.chord === 'Am7' &&
      gj.now.next.chord === 'Fmaj7' &&
      gj.scale.fits === 'A minor pentatonic' &&
      gj.scale.box === '5th fret',
    `get_jam: where you are (bar ${gj.now.bar}, ${gj.now.chord}, ${gj.now.next.chord} next in ${gj.now.next.in_beats} beats) and the box (${gj.scale.box})`,
  );
  T.ok(
    gj.rig.guitar_track?.name === 'Guitar' &&
      gj.fretboard.tuning.startsWith('Standard') &&
      gj.room.open &&
      gj.input.open === false &&
      gj.tips.length >= 3 &&
      gj.tips.some((t) => t.tab),
    `get_jam: the rig (${gj.rig.guitar_track?.name}, ${gj.rig.chain.length} effects), the neck, the input, ${gj.tips.length} tips, one with tab`,
  );
  const ss = await run('set_tone', { search: 'funk envelope' });
  T.ok(
    ss.matches?.length &&
      ss.matches.some((m) => m.id === 'gr-shakedown') &&
      (await E(() => window.overdub.store.history.length)) === h0,
    `set_tone search finds tones and changes nothing (${ss.matches
      .slice(0, 3)
      .map((m) => m.name)
      .join(', ')})`,
  );
  const st = await run('set_tone', { rig: 'gr-clucky' });
  const stx = await E(() => {
    const o = window.overdub,
      last = o.store.history[o.store.history.length - 1];
    return {
      by: last.by,
      devs: o.jam
        .guitar()
        .inserts.map((x) => x.device)
        .join('>'),
    };
  });
  T.ok(
    st.ok &&
      st.tone.name === 'Get Clucky' &&
      st.chain.length === 4 &&
      stx.by === 'mcp:test' &&
      stx.devs === 'pedal.gate>pedal.squish>amp.clean>pedal.lobsterplate',
    `set_tone loads a rig, signed by the agent (${st.chain.join(', ')})`,
  );
  const e1 = await run('set_tone', { rig: 'no such rig' }),
    e2 = await run('set_tone', { rig: 'blues', track: 'Nope' }),
    e3 = await run('set_tone', {});
  T.ok(
    /no tone/.test(e1.error) &&
      e1.hint &&
      /no track/.test(e2.error) &&
      /Drums/.test(e2.hint) &&
      /which tone/.test(e3.error),
    `set_tone's errors say what would work ("${e1.error}"; "${e2.error}")`,
  );
  const sh = await run('show_on_fretboard', {
    label: 'A minor pentatonic, box 1',
    scale: 'A minor pentatonic',
    frets: [5, 8],
  });
  const shown = await E(() => window.overdub.jam.state.shown);
  T.ok(
    sh.ok &&
      sh.visible &&
      sh.shown.places.length === 12 &&
      sh.shown.places.every((x) => x.fret >= 5 && x.fret <= 8) &&
      shown.by === 'mcp:test',
    `show_on_fretboard: the box at the 5th fret, 12 places, drawn for the agent`,
  );
  await sleep(150);
  const lbl = await E(() => document.querySelector('.jm-neck-label').textContent);
  T.ok(
    /A minor pentatonic, box 1/.test(lbl) && (await E(() => !!document.querySelector('.jm-neck-label .by.by-agent'))),
    `its label reads under the neck, signed in cool ink ("${lbl.slice(0, 50)}")`,
  );
  const sn = await run('show_on_fretboard', { label: 'the turnaround lick', notes: '6:5 6:8 5:5 5:7', play: true });
  T.ok(
    sn.ok &&
      sn.shown.places.map((x) => `${x.string}:${x.fret}:${x.note}`).join(' ') === '6:5:A2 6:8:C3 5:5:D3 5:7:E3' &&
      sn.played,
    `places as string:fret, in order, and played: ${sn.shown.places.map((x) => x.note).join(' ')}`,
  );
  const sc = await run('show_on_fretboard', { label: 'Fmaj7', chord: 'Fmaj7', frets: [0, 3] });
  T.ok(
    sc.ok &&
      sc.shown.places.some((x) => x.role === 'R' && x.note === 'F2') &&
      sc.shown.places.every((x) => ['R', '3', '5', '7'].includes(x.role)),
    `a chord's tones, marked by role (${sc.shown.places.length} places in frets 0-3)`,
  );
  const n1 = await run('show_on_fretboard', { scale: 'A minor' }),
    n2 = await run('show_on_fretboard', { label: 'x', chord: 'H#9' }),
    n3 = await run('show_on_fretboard', { label: 'x' }),
    n4 = await run('show_on_fretboard', { label: 'x', notes: '7:3 C9' });
  T.ok(
    /label/.test(n1.error) &&
      /chord/.test(n2.error) &&
      n2.hint &&
      /nothing to show/.test(n3.error) &&
      /can't place/.test(n4.error),
    `show_on_fretboard's errors say what would work ("${n2.error}"; "${n4.error}")`,
  );
  const cl = await run('show_on_fretboard', { clear: true });
  T.ok(cl.ok && cl.cleared && !(await E(() => window.overdub.jam.state.shown)), 'clear takes it off the neck');
  await page.click('#ew-tab-arranger');
  await sleep(200);
  const hid = await run('show_on_fretboard', { label: 'C major scale', scale: 'C major' });
  T.ok(
    hid.ok && hid.visible === false && /Jam tab is closed/.test(hid.hint),
    'with the room closed it still shows it, and says the Jam tab is closed',
  );
  await page.click('#ew-tab-jam');
  await sleep(200);
  await run('show_on_fretboard', { clear: true });
  // make_jam_track replaces the song the way opening one does, and signs the band as the agent who asked
  const mk = await run('make_jam_track', {
    style: 'blues',
    key: 'E',
    tempo: 70,
    reason: 'they asked for a slow blues in E',
  });
  const after = await E(() => {
    const o = window.overdub,
      p = o.store.get();
    return {
      title: p.title,
      tempo: p.tempo,
      key: p.key,
      recent: o.exporter.recent().map((r) => r.title),
      by: p.tracks[0].clips[0].by,
      guitar: o.jam.guitar()?.name,
      sel: o.ui.state.selection.track === o.jam.guitar()?.id,
      stage: document.querySelector('.jm-now-name').textContent,
    };
  });
  T.ok(
    mk.ok &&
      mk.title === 'Blues shuffle in E' &&
      mk.tempo === 70 &&
      mk.key === 'E blues' &&
      mk.sections.map((s) => s.name).join(' ') === 'Chorus 1 Chorus 2' &&
      /^E7 A7 E7 B7 A7 E7 B7$/.test(mk.sections[0].chords),
    `make_jam_track: "${mk.title}", ${mk.tempo} BPM, ${mk.sections[0].name}: ${mk.sections[0].chords}`,
  );
  T.ok(
    after.title === 'Blues shuffle in E' &&
      after.recent[0] === 'Night Shift' &&
      after.by === 'mcp:test' &&
      after.guitar === 'Guitar' &&
      after.sel &&
      after.stage === 'E7',
    `the song on screen is the jam track, Night Shift is in Recent songs, the band is signed by the agent, the keys play its Guitar (${after.stage} on stage)`,
  );
  const mk2 = await run('make_jam_track', { style: 'polka' }),
    mk3 = await run('make_jam_track', { style: 'funk', progression: 'Em7 Xq' });
  T.ok(
    /no style/.test(mk2.error) && /blues/.test(mk2.hint) && /can't read/.test(mk3.error) && mk3.hint,
    `make_jam_track's errors say what would work ("${mk2.error}"; "${mk3.error}")`,
  );
  // a song from a link isn't the person's yet: an agent's jam track doesn't put it away (agent/keep.js)
  const lst = await E(async () => {
    const o = window.overdub,
      t0 = o.store.get().title;
    o.share.listening = true;
    try {
      const r = await o.tools.run('make_jam_track', { style: 'funk' }, { by: 'mcp:test' });
      return { r, same: o.store.get().title === t0 };
    } finally {
      o.share.listening = false;
    }
  });
  T.ok(
    /came from a link/.test(lst.r.error || '') && lst.same,
    `on a song from a link, an agent's jam track doesn't replace it ("${lst.r.error}")`,
  );

  // what the heard line says: a chord tone, a passing note, the blue third over a dominant chord, the blue note
  const said = await E(() => {
    const j = window.overdub.jam,
      w = j.where();
    return {
      at: w.chord?.name,
      three: j.describe(68, w),
      blue3: j.describe(67, w),
      pass: j.describe(66, w),
      b5: j.describe(70, w),
    };
  });
  T.ok(
    said.at === 'E7' &&
      /^G#: the 3rd of E7/.test(said.three) &&
      /^G: the blue third over E7; bend it a little toward G#/.test(said.blue3) &&
      /^F#: from E major pentatonic; over E7, the 9th/.test(said.pass) &&
      /^Bb: the blue note, between A and B/.test(said.b5),
    `the heard line names what a note is over E7: "${said.three}"; "${said.blue3}"; "${said.pass}"; "${said.b5}"`,
  );

  // ---- R records what you play onto the Guitar track: in the room it's never a hum, even with Hum it open below (the
  // room tucks the detail pane away; pulled back up, Sketch shows under it)
  await E(() => {
    const o = window.overdub;
    o.ui.setOpen('bottom', true);
    o.ui.show('sketch');
    o.transport.click.set({ on: false });
    o.input.recorder.setCountIn(0);
    o.transport.marker.set(0);
    o.input.sketchMode = 'hum';
    document.activeElement?.blur?.();
  });
  const humOpen = await E(() => window.overdub.input.sketchMode === 'hum' && !!window.overdub.ui.visible('sketch'));
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.overdub.input.recorder.state === 'rec', null, { timeout: 8000 });
  await sleep(400);
  const humming = await E(() => !!window.overdub.input.hum?.active);
  T.ok(
    humOpen && !humming,
    `R in the room records the guitar without a hum, with Sketch showing Hum it below (hum ${humming ? 'started' : 'not started'})`,
  );
  for (const p of [64, 67, 69, 71]) {
    await E((q) => window.overdub.input.noteOn('test', q, 0.8, 'midi'), p);
    await sleep(220);
    await E((q) => window.overdub.input.noteOff('test', q, 'midi'), p);
    await sleep(80);
  }
  await E(() => window.overdub.input.recorder.stop());
  await sleep(500);
  const take = await E(() => {
    const o = window.overdub,
      g = o.jam.guitar();
    const c = g.clips[0];
    return c
      ? {
          n: c.notes.length,
          by: c.by,
          notesBy: c.notes.every((n) => (n.by || c.by) === 'you'),
          start: c.start,
          ps: c.notes.map((n) => n.p).join(' '),
        }
      : null;
  });
  T.ok(
    take && take.n === 4 && take.by === 'you' && take.notesBy && take.start === 0 && take.ps === '64 67 69 71',
    `R records the keys onto the Guitar track at the playhead: ${take ? `${take.n} notes (${take.ps}), signed by you` : 'nothing'}`,
  );
  await shot('jamtrack');
  await page.evaluate(() => {
    const p = document.querySelector('[data-panel="jam"]');
    p.scrollTop = p.scrollHeight;
  });
  await sleep(200);
  await shot('ideas');

  // ---- levels: every jam style's band, and a lick on its Guitar track (rendered in the page, measured)
  if (process.env.LEVELS !== '0') {
    const lv = await E(async () => {
      const o = window.overdub,
        M = await import('/app/src/audio/measure.js'),
        J = await import('/app/src/core/jam.js'),
        { renderProject } = await import('/app/src/engine/render.js');
      const out = [];
      for (const id of J.JAM_STYLE_IDS) {
        const r = J.jamTrack({ style: id, rig: (rid) => o.jam.rigs.rigById(rid)?.chain || null });
        const p = r.project,
          end = Math.min(p.loop.end, 32),
          g = p.tracks.find((t) => t.instrument?.device === 'core.guitar');
        const band = M.measure(
          await renderProject(p, {
            from: 0,
            to: end,
            tracks: p.tracks.filter((t) => t !== g).map((t) => t.id),
            tail: 1,
            assets: o.engine.assets,
          }),
        );
        const lick = J.makeLick(J.chordTimeline(p), { bar: 1 });
        const notes = [];
        for (let k = 0; k < end; k += 8)
          for (const n of lick.notes) notes.push({ id: 'n' + notes.length, p: n.p, t: n.t + k, d: n.d, v: n.v });
        g.clips = [{ id: 'c_lick', kind: 'notes', start: 0, length: end, notes }];
        const gl = M.measure(
          await renderProject(p, { from: 0, to: end, tracks: [g.id], tail: 1, assets: o.engine.assets }),
        );
        const all = M.measure(await renderProject(p, { from: 0, to: end, tail: 1, assets: o.engine.assets }));
        out.push({ id, band: band.lufs, tp: all.truePeak, guitar: gl.lufs });
      }
      return out;
    });
    const off = lv.filter(
      (x) => !(x.band > -19.5 && x.band < -15.5 && x.tp <= -1 && Math.abs(x.guitar - x.band) <= 2.5),
    );
    T.ok(
      !off.length,
      `every jam style measured: the band at ${Math.min(...lv.map((x) => x.band)).toFixed(1)} to ${Math.max(...lv.map((x) => x.band)).toFixed(1)} LUFS, a lick on the Guitar within 2.5 LU of it, true peak ≤ ${Math.max(...lv.map((x) => x.tp)).toFixed(1)} dBTP${off.length ? ': off ' + off.map((x) => `${x.id} band ${x.band.toFixed(1)} guitar ${x.guitar.toFixed(1)} tp ${x.tp.toFixed(1)}`).join('; ') : ''}`,
    );
  }
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no page errors on the desktop${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

/* ============================================================================ 9. on a laptop, a guitar plugged in */
{
  const wav = fakeGuitar(path.join(OUTDIR, 'jam-fake-guitar.wav'));
  const { page, errors, close } = await boot({ width: 1280, height: 800, fakeAudio: wav });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const run = (name, input, by = 'mcp:test') =>
    E(([n, i, b]) => window.overdub.tools.run(n, i, { by: b }), [name, input, by]);
  const clearToasts = () => E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  const toastsNow = () => E(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent));
  const song = () =>
    E(() => {
      const o = window.overdub,
        p = o.store.get();
      return { title: p.title, tracks: p.tracks.map((t) => t.name).join(', '), h: o.store.history.length };
    });
  const openDemo = async (id) => {
    await E((d) => window.overdub.exporter.openDemo(d), id);
    await sleep(700);
  };
  const jamTrack = async (style) => {
    await E((s) => window.overdub.jam.openTrack({ style: s }), style);
    await sleep(700);
  };
  await E(() => {
    window.__rooms = [];
    window.overdub.ui.on('room', (e) => window.__rooms.push(e && e.room ? e.room : 'none'));
  });

  // ---- the room on a laptop: the detail pane steps aside and comes back; the chord and the neck in view at 1280x800
  await step('the room on a laptop', async () => {
    const pane0 = await E(() => window.overdub.ui.isOpen('bottom'));
    await page.click('#ew-tab-jam');
    await sleep(800);
    const lap = await E(() => {
      const o = window.overdub,
        r = (s) => {
          const b = document.querySelector(s).getBoundingClientRect();
          return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
        };
      return {
        pane: o.ui.isOpen('bottom'),
        room: o.ui.state.room,
        vh: innerHeight,
        now: r('.jm-now-name'),
        neck: r('.jm-neck-scroll'),
        stage: r('.jm-stage'),
        views: r('.jm-views'),
        lane: r('.tb'),
        neckSec: r('.jm-neck'),
        tone: r('.jm-tone'),
        input: r('.jm-input'),
        practice: r('.jm-practice'),
        ideas: r('.jm-ideas'),
        laneText: document.querySelector('.tb').textContent.trim(),
      };
    });
    T.ok(
      pane0 && !lap.pane && lap.room === 'jam',
      `Jam opens with the detail pane out of the way (open before: ${pane0}, in the room: ${lap.pane})`,
    );
    T.ok(
      lap.now.top >= 0 && lap.now.bottom <= lap.vh && lap.neck.bottom <= lap.vh,
      `at 1280x800 the chord and the whole neck are on screen (the chord to ${lap.now.bottom} px, the neck to ${lap.neck.bottom}, of ${lap.vh})`,
    );
    T.ok(
      lap.stage.top < lap.views.top &&
        lap.views.top < lap.lane.top &&
        lap.lane.top < lap.neckSec.top &&
        lap.neckSec.top < lap.input.top &&
        lap.input.top === lap.practice.top &&
        lap.tone.h === 0 &&
        lap.ideas.top > Math.max(lap.input.top, lap.practice.top),
      'in order: the stage, the Neck and Rig tabs, the tab lane, the neck, then your guitar beside practice, then the ideas (the rig waits on its tab)',
    );
    T.ok(
      lap.lane.h <= 50 && /^Tab\s*No tab yet: suggest a riff for the Verse/.test(lap.laneText),
      `with no riff and no tab part the tab lane is one line (${lap.lane.h} px: "${lap.laneText.slice(0, 60)}")`,
    );
    await page.screenshot({ path: path.join(OUTDIR, 'jam-laptop-1280.png') });
    await page.click('#ew-tab-arranger');
    await sleep(300);
    const back = await E(() => ({
      pane: window.overdub.ui.isOpen('bottom'),
      room: window.overdub.ui.state.room,
      rooms: window.__rooms.join(','),
    }));
    T.ok(
      back.pane && back.room === null && back.rooms === 'jam,none',
      `leaving, the detail pane comes back; ui.state.room is 'jam' in the room and null after, with a 'room' event each way, for Sketch (${back.rooms})`,
    );
    // pulled up by hand in the room, it's yours: it stays up, then and after
    await page.click('#ew-tab-jam');
    await sleep(300);
    await page.click('.ew-t-panelBottom');
    await sleep(200);
    await page.click('#ew-tab-arranger');
    await sleep(200);
    await page.click('#ew-tab-jam');
    await sleep(200);
    const mine = await E(() => ({
      pane: window.overdub.ui.isOpen('bottom'),
      saved: JSON.parse(localStorage.getItem('overdub:jam')).pane,
    }));
    await page.click('.ew-t-panelBottom');
    await sleep(200);
    const kept = await E(() => ({ pane: window.overdub.ui.isOpen('bottom'), state: window.overdub.jam.state.pane }));
    T.ok(
      !mine.pane && mine.saved === 'tucked' && kept.pane && kept.state === 'kept',
      `the pane opened by hand in the room stays open: the room doesn't tuck it again (${kept.state}); each visit starts with it tucked (kept in overdub:jam: ${mine.saved})`,
    );
  });

  // ---- a chord name is never clipped: the detail pane open, at 1280x800 and 1440x900, Night Shift and Late Checkout
  await step('chord names', async () => {
    await E(() => window.overdub.ui.setOpen('bottom', true));
    const names = () =>
      E(async () => {
        const o = window.overdub,
          tl = o.jam.timeline(),
          out = [],
          seen = new Set();
        for (const c of tl.chords) {
          if (seen.has(c.name)) continue;
          seen.add(c.name);
          o.transport.marker.set(c.start + 0.01);
          await new Promise((r) => setTimeout(r, 140));
          const n = document.querySelector('.jm-now-name'),
            x = document.querySelector('.jm-next-name'),
            st = document.querySelector('.jm-stage').getBoundingClientRect(),
            nb = n.getBoundingClientRect();
          out.push({
            name: c.name,
            whole:
              n.textContent === c.name &&
              n.scrollWidth <= n.clientWidth + 1 &&
              nb.right <= st.right + 1 &&
              x.scrollWidth <= x.clientWidth + 1,
            fs: parseFloat(getComputedStyle(n).fontSize),
          });
        }
        return out;
      });
    const bad = [],
      all = [];
    for (const [w, hh] of [
      [1280, 800],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width: w, height: hh });
      for (const d of ['night-shift', 'late-checkout']) {
        await openDemo(d);
        const r = await names();
        all.push(...r);
        bad.push(...r.filter((x) => !x.whole).map((x) => `${x.name} at ${w}`));
      }
    }
    const long = all.find((x) => x.name === 'Bbmaj7/F');
    T.ok(
      !bad.length && all.length >= 20 && long,
      `every chord name whole on the stage, the detail pane open, at 1280x800 and 1440x900 (${all.length} names; Bbmaj7/F at ${long ? Math.round(long.fs) : '?'} px)${bad.length ? ': clipped ' + bad.join(', ') : ''}`,
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await E(() => window.overdub.ui.setOpen('bottom', false));
  });

  // ---- hearing isn't editing: Show me and show_on_fretboard's play sound on the room's own voice, never a track
  await step('hearing', async () => {
    await openDemo('dust-jacket');
    await clearToasts();
    const s0 = await song();
    await E(() => {
      const p = document.querySelector('[data-panel="jam"]');
      p.scrollTop = p.scrollHeight;
    });
    await sleep(200);
    await page
      .locator('.jm-tips button', { hasText: /^Show me$/ })
      .first()
      .click();
    await page
      .waitForFunction(() => window.overdub.engine.meters.master.peak > -60, null, { timeout: 10000 })
      .catch(() => {});
    await sleep(600);
    const s1 = await song();
    const heard = await E(() => ({
      peak: window.overdub.engine.meters.master.peak,
      voice: !!window.overdub.jam.voice?.strip,
      neck: (() => {
        const b = document.querySelector('.jm-neck-scroll').getBoundingClientRect(),
          p = document.querySelector('[data-panel="jam"]').getBoundingClientRect();
        return b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
      })(),
    }));
    const t1 = await toastsNow();
    T.ok(
      heard.voice &&
        heard.peak > -60 &&
        s1.tracks === s0.tracks &&
        s1.h === s0.h &&
        !t1.some((x) => /New track/.test(x)),
      `Show me on Dust Jacket (no DI guitar) plays the lick on the room's voice (the master at ${heard.peak} dBFS) and adds no track: ${s1.tracks}; History as it was`,
    );
    T.ok(heard.neck, 'Show me, pressed down in the ideas, brings the neck into view');
    const r = await run('show_on_fretboard', { label: 'Dm7 here', chord: 'Dm7', frets: [5, 8], play: true });
    await sleep(500);
    const s2 = await song();
    T.ok(
      r.ok &&
        r.played === true &&
        /no track was added/.test(r.heard_on || '') &&
        s2.tracks === s0.tracks &&
        s2.h === s0.h &&
        !(await toastsNow()).some((x) => /New track/.test(x)),
      `show_on_fretboard play: true sounds it and changes nothing in the song: nothing signed, no Undo toast ("${r.heard_on}")`,
    );
    await E(() => {
      const o = window.overdub;
      o.transport.click.set({ on: false });
      o.input.recorder.setCountIn(0);
      o.transport.marker.set(0);
    });
    await E(() => window.overdub.input.recorder.record({ hum: false }));
    await page.waitForFunction(() => window.overdub.input.recorder.state === 'rec', null, { timeout: 8000 });
    const shownBefore = await E(() => window.overdub.jam.state.shown?.label);
    const rr = await run('show_on_fretboard', { label: 'Dm7 again', chord: 'Dm7', play: true });
    const shownDuring = await E(() => window.overdub.jam.state.shown?.label);
    await E(() => window.overdub.input.recorder.cancel());
    await sleep(400);
    T.ok(
      rr.error === 'recording' && /show it without play/.test(rr.hint || '') && shownDuring === shownBefore,
      `with play, it's refused while the person records, and the neck is left as it was ("${rr.hint}")`,
    );
  });

  // ---- Show me while the song plays: on the grid, at its own bars (round the loop), or the next bar line, saying why
  await step('Show me on the grid', async () => {
    await openDemo('night-shift');
    const lickAt = (bar) =>
      E(async (bar) => {
        const o = window.overdub,
          J = await import('/app/src/core/jam.js');
        o.engine.stop();
        o.store.dispatch(
          { type: 'project.set', patch: { loop: { on: true, start: 0, end: 16 } } },
          { by: 'you', label: 'loop' },
        );
        o.transport.marker.set(0);
        const strip = o.jam.voice.strip,
          inst = strip.instance('instrument'),
          log = [],
          orig = inst.noteOn;
        inst.noteOn = function (p, v, t, x) {
          log.push(t);
          return orig.call(this, p, v, t, x);
        };
        try {
          await o.engine.play(0);
          while (o.engine.beat < 1) await new Promise((r) => setTimeout(r, 15));
          const lick = J.makeLick(o.jam.timeline(), { bar, meter: o.store.get().meter });
          // (what the voice was handed before this lick isn't this lick's: it starts at k0, once the lick is scheduled)
          const k0 = log.length,
            L = o.jam.playLick(lick),
            t0 = performance.now();
          while (!(L.t0 < Infinity) && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 15));
          await new Promise((r) => setTimeout(r, 150));
          const label = document.querySelector('.jm-neck-label').textContent;
          const first =
            log.length > k0 ? o.engine.clock.beatAt(log[k0] - (o.engine.latency.max || 0) + strip.latency()) : null;
          return { want: lick.start + lick.notes[0].t, first, label, waiting: !!o.jam.state.lick };
        } finally {
          inst.noteOn = orig;
        }
      }, bar);
    // (the voice is built by a first hearing)
    await E(() =>
      window.overdub.jam.playShown(window.overdub.jam.show({ chord: 'Am7', frets: [5, 8], label: 'warm up' }).shown),
    );
    await page.waitForFunction(() => window.overdub.jam.voice.strip && window.overdub.jam.voice.gain != null, null, {
      timeout: 10000,
    });
    const own = await lickAt(3);
    T.ok(
      own.first != null &&
        Math.abs(own.first - own.want) < 0.03 &&
        /plays at bar 3 \(in \d (bars|beats)\)/.test(own.label),
      `Show me while the song plays waits for its bars: asked in bar 1, the bars 3-4 lick starts on beat ${own.first?.toFixed(3)} (its first note's place: ${own.want}), and the neck says "${own.label.replace(/Clear$/, '').slice(0, 60)}"`,
    );
    const out = await lickAt(7);
    const stopped = await E(() => {
      window.overdub.engine.stop();
      return new Promise((r) => setTimeout(() => r(window.overdub.jam.state.lick), 100));
    });
    T.ok(
      out.first != null &&
        Math.abs(out.first - 4 - (out.want - 24)) < 0.03 &&
        /plays from bar 2, the next bar line.*since the loop doesn't reach bar 7/.test(out.label) &&
        stopped === null,
      `a lick the loop never reaches starts at the next bar line and says why ("${out.label.replace(/Clear$/, '').slice(18, 110)}"); a stop lets it go`,
    );
    await E(() =>
      window.overdub.store.dispatch(
        { type: 'project.set', patch: { loop: { on: false } } },
        { by: 'you', label: 'loop off' },
      ),
    );
  });

  // ---- a guitar plugged in: monitoring as the input decides it, one tone for both guitars, a new song with the input
  // open, where your guitar sits (3 dB over the band, measured; the master clean), the tuner
  await step('the input', async () => {
    const levelled = () => E(() => window.overdub.jam.levelled);
    await jamTrack('blues');
    await page.click('.jm-open');
    await page.waitForFunction(() => window.overdub.input.audio.state.open, null, { timeout: 8000 });
    await levelled();
    await sleep(300);
    const dflt = await E(() => ({
      mon: window.overdub.input.audio.state.monitoring,
      kind: window.overdub.input.audio.state.inputKind,
      line: window.overdub.input.audio.state.monitorLine,
      note: document.querySelector('.jm-input > .jm-note').textContent,
      offer: document.querySelector('.jm-matchnote').textContent,
      go: document.querySelector('.jm-match').classList.contains('btn-go'),
      gain: window.overdub.jam.guitars().audio?.gain,
    }));
    T.ok(
      !dflt.mon && dflt.line && dflt.note === dflt.line,
      `the browser's default input (a ${dflt.kind}) opens unmonitored, and the room says why in the input's words ("${dflt.note.slice(0, 60)}…")`,
    );
    const start = await E(() => window.overdub.jam.place({ ref: true }));
    T.ok(
      dflt.gain <= 6 &&
        Math.abs(dflt.gain - start.gain) < 0.25 &&
        (start.top ? dflt.gain === 6 : Math.abs(start.over - 3) <= 0.5),
      `Live guitar starts where a guitar at an interface's usual level sits 3 dB over the band, measured (${dflt.gain} dB: ${start.over} dB over${start.top ? ', the fader’s top' : ''}), not at a guessed -4`,
    );
    T.ok(
      /^Live guitar starts at [+−]?[\d.]+ dB, where a guitar at an interface's usual level sits over the band\. Match the band sets it from your own playing, 3 dB over the band/.test(
        dflt.offer,
      ) && dflt.go,
      `the input's first opening offers Match the band ("${dflt.offer.slice(0, 70)}…")`,
    );
    await page.locator('.jm-input .tog', { hasText: 'Monitor' }).click();
    await sleep(700);
    const on = await E(() => {
      const o = window.overdub,
        g = o.jam.guitars().audio;
      return {
        mon: o.input.audio.state.monitoring,
        note: document.querySelector('.jm-input > .jm-note').textContent,
        peak: (o.engine.meters.tracks[g.id] || {}).peak,
      };
    });
    T.ok(
      on.mon && /^Monitoring on: you hear your guitar through .+, on Live guitar\./.test(on.note) && on.peak > -60,
      `Monitor on: the room says through what you hear your guitar ("${on.note.slice(0, 80)}"; Live guitar at ${on.peak} dBFS)`,
    );
    // one tone for both guitars: the keys' Guitar and Live guitar, one step, both named
    const h0 = await E(() => window.overdub.store.history.length);
    await page.click('#jm-view-rig');
    await sleep(200);
    await page.click('.jm-tone-row .jm-flip:last-child');
    await sleep(700);
    const both = await E(() => {
      const o = window.overdub,
        g = o.jam.guitars(),
        last = o.store.history[o.store.history.length - 1],
        rig = o.jam.tone();
      return {
        keys: g.keys.inserts.map((x) => x.device).join('>'),
        live: g.audio.inserts.map((x) => x.device).join('>'),
        rig: rig?.chain.map((x) => x.device).join('>'),
        label: last.label,
        n: o.store.history.length,
        thru: document.querySelector('.jm-thru').textContent,
      };
    });
    T.ok(
      both.keys === both.rig &&
        both.live === both.rig &&
        both.n === h0 + 1 &&
        /^Guitar and Live guitar: /.test(both.label) &&
        /on Guitar \(the keys\) and Live guitar \(your guitar\)/.test(both.thru),
      `a tone goes on both guitars, the keys' and yours, in one step ("${both.label}"), and the room says so ("${both.thru}")`,
    );
    await page.click('#jm-view-neck');
    await sleep(200);
    // a new song with the input open and monitoring on: its guitar is there at once, armed and heard, and no toast
    const swap = async (go) => {
      await clearToasts();
      await go();
      await sleep(1200);
      await levelled();
      await sleep(300);
      return E(() => {
        const o = window.overdub,
          p = o.store.get(),
          g = o.jam.guitars(),
          auds = p.tracks.filter((t) => t.kind === 'audio');
        return {
          title: p.title,
          auds: auds.length,
          name: g.audio?.name,
          arm: !!g.audio?.arm,
          chain: g.audio ? g.audio.inserts.map((x) => x.device).join('>') : '',
          keys: g.keys ? g.keys.inserts.map((x) => x.device).join('>') : null,
          gain: g.audio?.gain,
          mon: o.input.audio.state.monitoring,
          waiting: o.input.audio.state.monitorWaiting,
          peak: g.audio ? (o.engine.meters.tracks[g.audio.id] || {}).peak : null,
          note: document.querySelector('.jm-input > .jm-note').textContent,
          rec: document.querySelector('.jm-recnote').textContent,
          toasts: [...document.querySelectorAll('.ew-toast')].filter((t) => /monitor/i.test(t.textContent)).length,
        };
      });
    };
    const was = await E(() =>
      window.overdub.jam
        .guitars()
        .audio.inserts.map((x) => x.device)
        .join('>'),
    );
    const funk = await swap(() => jamTrack('funk'));
    T.ok(
      funk.auds === 1 &&
        funk.name === 'Live guitar' &&
        funk.arm &&
        funk.mon &&
        !funk.waiting &&
        funk.peak > -60 &&
        funk.chain === funk.keys &&
        funk.toasts === 0,
      `a jam track opened with monitoring on: one Live guitar, armed, with the funk's tone, your guitar still heard through it (${funk.peak} dBFS), and no toast (${funk.toasts})`,
    );
    T.ok(
      /^Monitoring on: you hear your guitar through .+, on Live guitar\./.test(funk.note) &&
        funk.rec === 'R records your guitar onto Live guitar, from the playhead.',
      `the room names the track you hear and record through ("${funk.rec}")`,
    );
    // Match the band, on the funk: five seconds of your guitar against the band; 3 dB over it, one step by you
    await E(() => {
      const o = window.overdub,
        g = o.jam.guitars().audio;
      o.store.dispatch(
        { type: 'track.set', track: g.id, patch: { gain: -10 } },
        { by: 'you', label: 'down for the test' },
      );
    });
    const m0 = await E(() => ({
      gain: window.overdub.jam.guitars().audio.gain,
      h: window.overdub.store.history.length,
    }));
    await page.click('.jm-match');
    await page.waitForFunction(() => window.overdub.jam.state.match?.phase === 'done', null, { timeout: 30000 });
    const m1 = await E(() => {
      const o = window.overdub,
        last = o.store.history[o.store.history.length - 1];
      return {
        gain: o.jam.guitars().audio.gain,
        h: o.store.history.length,
        by: last.by,
        label: last.label,
        m: o.jam.state.match,
      };
    });
    const undone = await E(() => {
      const o = window.overdub;
      o.store.undo();
      const g = o.jam.guitars().audio.gain;
      o.store.redo();
      return g;
    });
    const M = m1.m || {};
    const landed = M.held
      ? /: level [+−]?[\d.]+ dB, held under the master’s clip$/.test(m1.label)
      : M.top
        ? m1.label === 'Live guitar: level +6 dB, the top of its fader'
        : /: level [+−]?[\d.]+ dB, 3 dB over the band$/.test(m1.label) && Math.abs(M.over - 3) <= 0.3;
    T.ok(
      m1.h === m0.h + 1 && m1.by === 'you' && landed && m1.gain !== m0.gain && m1.gain <= 6 && undone === m0.gain,
      `Match the band measures your guitar against the band and puts it 3 dB over (or at the fader's top, or under the master's clip), one step by you ("${m1.label}": ${M.over} dB over, from ${m0.gain} dB)`,
    );
    T.ok(
      M.tp <= -1 &&
        (M.held
          ? /any louder and the master would clip/.test(M.line)
          : M.top
            ? /the top of its fader/.test(M.line)
            : /^Live guitar now sits 3 dB over the band, at [+−][\d.]+ dB\./.test(M.line)),
      `it says where your guitar landed, plainly, and the master stays clean (${M.tp} dBTP): "${(M.line || '').slice(0, 90)}"`,
    );
    // the next song: its guitar placed from those five seconds, not carried over as a number
    const hal = await swap(() => openDemo('halation'));
    const placed = await E(() => window.overdub.jam.place());
    T.ok(
      hal.auds === 1 &&
        hal.arm &&
        hal.mon &&
        hal.peak > -60 &&
        hal.chain === funk.chain &&
        hal.chain !== was &&
        hal.toasts === 0 &&
        Math.abs(hal.gain - placed.gain) < 0.25 &&
        placed.tp <= -1,
      `a demo with no guitar: its audio guitar ("${hal.name}") is made at once with the funk's tone and placed from your five seconds (${hal.gain} dB, ${placed.over} dB against the band; the master ${placed.tp} dBTP); no toast`,
    );
    // the master stays clean with your guitar where the room puts it, measured on the two loudest demos
    const clean = [],
      banded = [];
    for (const d of ['vacancy', 'red-eye']) {
      await openDemo(d);
      await levelled();
      clean.push({ d, ...(await E(() => window.overdub.jam.place({ ref: true }))) });
      banded.push({ d, ...(await E(() => window.overdub.jam.place({ ref: true, band: true }))) });
    }
    T.ok(
      clean.every((x) => !x.error && x.tp <= -1 && x.gain <= 6),
      `with a guitar at an interface's usual level where the room puts it, the master stays clean on the loudest demos: ${clean.map((x) => `${x.d} ${x.tp} dBTP (the guitar at ${x.gain} dB, ${x.over} dB against the band)`).join('; ')}`,
    );
    // there the fader's top leaves that guitar under the band; the Band level (practice only) makes up the rest, measured:
    // the band rendered turned down as the live strips turn it down, until the guitar sits 3 dB over it
    T.ok(
      banded.length === 2 &&
        banded.every(
          (x) =>
            !x.error &&
            x.top &&
            x.short < 2.5 &&
            x.band < 0 &&
            x.band >= -24 &&
            Math.abs(x.over - 3) <= 0.5 &&
            x.tp <= -1 &&
            x.gain === 6,
        ),
      `where the fader's top leaves a guitar at an interface's usual level short, the Band level makes up the rest, measured: ${banded.map((x) => `${x.d} ${x.short} dB against the band at the fader's top, ${x.over} dB over with the band at ${x.band} dB (master ${x.tp} dBTP)`).join('; ')}`,
    );
    // the tuner: a note and its cents only once the pitch has settled, and only a guitar's
    const tuner = await E(async () => {
      const o = window.overdub,
        a = o.input.audio,
        read = () => ({
          note: document.querySelector('.jm-tuner-note').textContent,
          say: document.querySelector('.jm-tuner-say').textContent,
          jam: null,
        });
      const out = {},
        orig = a.tune;
      const at = async (k, tn) => {
        a.tune = () => tn;
        await new Promise((r) => setTimeout(r, 160));
        out[k] = read();
        out[k].jam = (await o.tools.run('get_jam', { tips: false }, { by: 'mcp:test' })).input.tuner;
      };
      try {
        await at('moving', { hz: 660, midi: 81.95, p: 64, cents: -1795, stable: false });
        await at('low', { hz: 41.2, midi: 28, p: 28, cents: 0, stable: true });
        await at('a2', { hz: 110.6, midi: 45.1, p: 45, cents: 10, stable: true });
      } finally {
        a.tune = orig;
      }
      return out;
    });
    T.ok(
      tuner.moving.note === '–' &&
        !/cents/.test(tuner.moving.say) &&
        tuner.moving.jam === null &&
        tuner.low.note === '–' &&
        tuner.low.jam === null,
      `the tuner shows nothing for a moving pitch or one under the guitar's range ("${tuner.moving.say}"), and get_jam reports none`,
    );
    T.ok(
      tuner.a2.note === 'A2' &&
        /^10 cents sharp: the 5th string, A2$/.test(tuner.a2.say) &&
        tuner.a2.jam?.note === 'A2' &&
        tuner.a2.jam?.cents === 10,
      `a settled A2 reads "${tuner.a2.say}", the note and the string from one pitch`,
    );
    // a take with your guitar plays at the song's tempo, and your practice speed comes back after it
    await E(() => {
      const o = window.overdub;
      o.jam.setSpeed(75, { say: false });
      o.transport.click.set({ on: false });
      o.input.recorder.setCountIn(0);
      o.transport.marker.set(0);
      document.activeElement?.blur?.();
    });
    await clearToasts();
    await page.keyboard.press('r');
    await page.waitForFunction(() => window.overdub.input.recorder.state === 'rec', null, { timeout: 8000 });
    const during = await E(() => window.overdub.engine.rate);
    await sleep(600);
    await E(() => window.overdub.input.recorder.stop());
    await page.waitForFunction(() => window.overdub.input.recorder.state === 'idle', null, { timeout: 8000 });
    await sleep(300);
    const after = await E(() => ({
      rate: window.overdub.engine.rate,
      toasts: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '),
    }));
    T.ok(
      during === 1 && Math.abs(after.rate - 0.75) < 1e-9 && /Back to 75% for practice/.test(after.toasts),
      `R at 75% records your guitar at full speed, then the speed comes back to 75% ("${(after.toasts.match(/Back to 75%[^|]*/) || [''])[0].trim()}")`,
    );
    await E(() => {
      const o = window.overdub;
      o.jam.setSpeed(100, { say: false });
    });
    await page.click('.jm-open'); // (closed: the keys are what plays from here)
    await sleep(300);
  });

  // ---- the keys: musical typing in the room plays its guitar; the keys line says what the keys play, by the neck
  await step('the keys', async () => {
    await openDemo('night-shift');
    const k0 = await E(() => ({
      line: document.querySelector('.jm-keys')?.hidden === false ? document.querySelector('.jm-keys').textContent : '',
      y: document.querySelector('.jm-keys')?.getBoundingClientRect().top,
      neck: document.querySelector('.jm-neck').getBoundingClientRect().bottom,
    }));
    await E(() => window.overdub.input.setMode('qwerty'));
    await sleep(300);
    const k1 = await E(() => {
      const o = window.overdub,
        g = o.jam.guitars().keys;
      return {
        keys: g?.name,
        dev: g?.instrument?.device,
        target: o.input.target()?.id === g?.id,
        hidden: document.querySelector('.jm-keys').hidden,
      };
    });
    await E(() => window.overdub.input.setMode(null));
    // (nothing selected: the keys play a new track when they start, not the first instrument: docs/INSTRUMENTS-UX.md 1.1)
    T.ok(
      /^The keys play a new track\. Give the keys a guitar$/.test(k0.line) && k0.y <= k0.neck,
      `on Night Shift (its Guitar is audio) the room says by the neck what the keys play ("${k0.line}")`,
    );
    T.ok(
      k1.keys === 'Keys guitar' && k1.dev === 'core.guitar' && k1.target && k1.hidden,
      'musical typing turned on in the room plays a guitar: a Keys guitar for the keys, and the line goes',
    );
    await jamTrack('blues');
    const k2 = await E(() => ({
      hidden: document.querySelector('.jm-keys').hidden,
      any: /The keys play/.test(document.querySelector('[data-panel="jam"]').textContent),
      target: window.overdub.input.target()?.name,
    }));
    T.ok(
      k2.hidden && !k2.any && k2.target === 'Guitar',
      `after a jam track opens, nothing says the keys play another track: they play its ${k2.target}`,
    );
  });

  // ---- another song: the last one's lick, line and speed go
  await step('another song', async () => {
    await E(async () => {
      const o = window.overdub;
      o.jam.show({ scale: 'A minor pentatonic', frets: [5, 8], label: 'box 1' });
      o.input.noteOn('test', 69, 0.8, 'qwerty');
      o.input.noteOff('test', 69, 'qwerty');
      o.jam.setSpeed(75, { say: false });
    });
    await clearToasts();
    await jamTrack('funk');
    const s = await E(() => ({
      shown: window.overdub.jam.state.shown,
      lick: window.overdub.jam.state.lick,
      heard: window.overdub.jam.state.heard,
      line: document.querySelector('.jm-heard').textContent,
      rate: window.overdub.engine.rate,
      toasts: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '),
    }));
    T.ok(
      s.shown === null &&
        s.lick === null &&
        s.heard === null &&
        /^Play: what you play lights up/.test(s.line) &&
        s.rate === 1 &&
        /Back to full speed: 104 BPM/.test(s.toasts),
      `a new song clears what the last one left on the neck and under it, and the speed goes back to 100% ("${(s.toasts.match(/Back to full speed[^|]*/) || [''])[0].trim()}")`,
    );
  });

  // ---- the agents: set_tone by name, with its reason; make_jam_track's word on the song it replaced; get_jam's bars
  await step('the tools', async () => {
    const st = await run('set_tone', { rig: 'gr-clucky', track: 'guitar', reason: 'cluckier for the verse' });
    const last = await E(() => {
      const o = window.overdub,
        l = o.store.history[o.store.history.length - 1];
      return { reason: l.reason, by: l.by };
    });
    T.ok(
      st.ok && st.track?.name === 'Guitar' && last.reason === 'cluckier for the verse' && last.by === 'mcp:test',
      `set_tone finds a track by its name, any case ("guitar": ${st.track?.name}), and History keeps the reason ("${last.reason}")`,
    );
    const mk = await run('make_jam_track', { style: 'rock' });
    T.ok(
      mk.ok &&
        /Only the person can bring it back: the Song menu's Recent songs, or the toast's Undo for a few seconds/.test(
          mk.replaced,
        ),
      `make_jam_track says only the person can bring the old song back ("${mk.replaced}")`,
    );
    const back = [await run('undo', {}), await run('revert_my_changes', {})];
    const after = await E(() => window.overdub.store.get().title);
    T.ok(
      mk.title && after === mk.title,
      `an agent can't reopen it: its undo and revert_my_changes leave "${after}" on screen (${back.map((x) => x.error || (x.undid ? `undid ${x.undid}` : `reverted ${x.reverted}`)).join('; ')})`,
    );
    const gj = await run('get_jam', { bars: [8, 2], tips: false });
    const bars = gj.chords.map((c) => parseInt(c.bars, 10));
    T.ok(
      gj.chords.length > 3 && Math.min(...bars) === 2 && Math.max(...bars) <= 8,
      `get_jam with bars [8, 2] reads bars 2 to 8 (${gj.chords.length} chords from bar ${Math.min(...bars)})`,
    );
  });

  // ---- small things: the chip names the section you're in; the first tap's toast; numbers sharing a place; the head
  // on a laptop; the chord tones' words
  await step('small things', async () => {
    await jamTrack('blues');
    await E(() => window.overdub.transport.marker.set(52));
    await sleep(500);
    const chip = await E(() => document.querySelector('.jm-ask')?.textContent || '');
    T.ok(
      /^What scale works over Chorus 2\?$/.test(chip.trim()),
      `the agent chip names the section you're in, as it's written ("${chip.trim()}")`,
    );
    await openDemo('dust-jacket');
    await clearToasts();
    await E(() => document.querySelector('.jm-neck-scroll').scrollIntoView({ block: 'center' }));
    await sleep(200);
    const xy = await E(() => {
      const n = window.overdub.jam.neck,
        cv = document.querySelector('.jm-neck-cv').getBoundingClientRect(),
        a = n.at(3, 2);
      return { x: cv.left + a.x, y: cv.top + a.y };
    });
    await page.mouse.click(xy.x, xy.y);
    await sleep(300);
    const tt = (await toastsNow()).find((x) => /^New track/.test(x)) || '';
    T.ok(
      /^New track: Guitar, so the neck and the keys play a guitar\./.test(tt),
      `the first tap on the neck says what it made, plainly ("${tt.replace(/Undo$/, '')}")`,
    );
    const sh = await run('show_on_fretboard', { label: 'back and forth', notes: '6:5 6:7 6:5 5:5' });
    const marks = await E(() =>
      window.overdub.jam.neck
        .marks()
        .map((m) => m.text)
        .join(' '),
    );
    T.ok(sh.ok && marks === '1,3 2 4', `a place the line comes back to carries both its numbers ("${marks}")`);
    await run('show_on_fretboard', { clear: true });
    const head = await E(() => {
      const lab = document.querySelector('.jm-over .jm-lab').getBoundingClientRect(),
        sp = document.querySelector('.jm-spec').getBoundingClientRect();
      return {
        lab: Math.round(lab.height),
        cut: [...document.querySelectorAll('.jm-specf')].filter((f) => {
          const b = f.getBoundingClientRect();
          return b.top < sp.bottom - 1 && (b.bottom > sp.bottom + 1 || b.right > sp.right + 1);
        }).length,
      };
    });
    T.ok(
      head.lab <= 18 && head.cut === 0,
      `at 1280 the head says "Playing over" on one line and no spec field is cut (${head.cut} cut)`,
    );
    const said = await E(() =>
      window.overdub.jam.describe(69, {
        chord: {
          name: 'C13',
          root: 0,
          quality: '13',
          tones: [
            { pc: 9, note: 'A', name: '13' },
            { pc: 1, note: 'Db', name: 'b9' },
          ],
        },
      }),
    );
    const said2 = await E(() =>
      window.overdub.jam.describe(61, {
        chord: { name: 'C7b9', root: 0, quality: '7b9', tones: [{ pc: 1, note: 'Db', name: 'b9' }] },
      }),
    );
    T.ok(
      said === 'A: the 13th of C13' && said2 === 'Db: the flat 9th of C7b9',
      `the heard line has words for the extended tones ("${said}"; "${said2}")`,
    );
  });

  // ---- the ideas hold still while you read them
  await step('tips hold still', async () => {
    await jamTrack('blues');
    const mark = () =>
      E(() => {
        document.querySelectorAll('.jm-tips li').forEach((x, i) => {
          x.__mark = i + 1;
        });
        window.__tipText = document.querySelector('.jm-tips').textContent;
      });
    const same = () =>
      E(() => ({
        rows: [...document.querySelectorAll('.jm-tips li')].every((x, i) => x.__mark === i + 1),
        text: document.querySelector('.jm-tips').textContent === window.__tipText,
      }));
    // Show doesn't rebuild the list under the button
    await E(() => window.overdub.transport.marker.set(4));
    await sleep(300);
    await mark();
    await E(() => [...document.querySelectorAll('.jm-tips button')].find((b) => b.textContent === 'Show').click());
    await sleep(300);
    const shown = await same();
    T.ok(shown.rows && shown.text, 'Show puts a tip on the neck without rebuilding the list under it');
    // the pointer over them holds them through a chord change; let go, they catch up
    await E(() => {
      window.overdub.transport.marker.set(14);
      document.querySelector('.jm-tips').scrollIntoView({ block: 'center' });
    });
    await sleep(400);
    const box = await E(() => {
      const b = document.querySelector('.jm-tips li .what').getBoundingClientRect();
      return { x: b.left + 30, y: b.top + 6 };
    });
    await page.mouse.move(box.x, box.y);
    await mark();
    await E(() => window.overdub.transport.playStop());
    await page.waitForFunction(() => window.overdub.engine.playing && window.overdub.engine.beat > 16.6, null, {
      timeout: 12000,
    });
    await sleep(500);
    const held = await same(),
      chord = await E(() => document.querySelector('.jm-now-name').textContent);
    await page.mouse.move(5, 5);
    await sleep(800);
    const moved = await E(() => ({
      text: document.querySelector('.jm-tips').textContent !== window.__tipText,
      kept: [...document.querySelectorAll('.jm-tips li')].some((x) => x.__mark),
    }));
    await E(() => window.overdub.transport.playStop());
    T.ok(
      held.rows && held.text,
      `the tips hold still while the pointer is over them, through a chord change (now ${chord}): the same rows, the same words`,
    );
    T.ok(moved.text && moved.kept, 'let go, they catch up with the song, keeping the rows whose words are the same');
  });

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no page errors on the laptop${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

/* ============================================================================ 7. a phone */
{
  const require = createRequire(import.meta.url);
  const tries = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core',
    path.join(os.homedir(), 'Code/xenobotany/node_modules/playwright-core'),
  ].filter(Boolean);
  let pw = null;
  for (const t of tries) {
    try {
      pw = require(t);
      break;
    } catch (e) {
      /* next */
    }
  }
  await ready;
  const srv = await startServer({ port: 0, quiet: true });
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const exe =
    process.env.CHROMIUM ||
    (fs.existsSync(base)
      ? fs
          .readdirSync(base)
          .filter((d) => d.startsWith('chromium_headless_shell'))
          .map((d) => path.join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'))
          .find((p) => fs.existsSync(p))
      : undefined);
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: exe,
    args: ['--autoplay-policy=no-user-gesture-required', ...QUIET, ...TEXT],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && (e.stack || e.message)) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) errors.push('console: ' + m.text());
  });
  const E = (fn, arg) => page.evaluate(fn, arg);
  await page.goto(srv.url + '/app/?demo', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(600);
  await E(() => document.querySelector('.ar-welcome-x')?.click());
  const sheet0 = await E(() => window.overdub.ui.isOpen('bottom'));
  await page.tap('#ew-tab-jam');
  await sleep(900);
  // round 6: the sheet tucks away as the room opens, so the neck (straight under the chord) is in view at once
  await step('phone: the neck in view', async () => {
    const v = await E(() => {
      const b = document.querySelector('.jm-neck-scroll').getBoundingClientRect(),
        s = document.querySelector('.ew-region-bottom').getBoundingClientRect(),
        st = document.querySelector('.jm-now-name').getBoundingClientRect();
      return {
        sheet: window.overdub.ui.isOpen('bottom'),
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        sheetTop: Math.round(s.top),
        chord: Math.round(st.top),
      };
    });
    T.ok(
      sheet0 && !v.sheet && v.chord >= 0 && v.top >= v.chord && v.bottom <= v.sheetTop,
      `phone: Jam tucks the sheet away and the whole neck is in view under the chord (the neck ${v.top}-${v.bottom} px, the sheet from ${v.sheetTop})`,
    );
  });
  const tabBox = await E(() => {
    const r = document.querySelector('#ew-tab-jam').getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)];
  });
  T.ok(tabBox[1] >= 44 && tabBox[0] >= 40, `phone: the Jam tab is a 44 px target (${tabBox.join('x')})`);
  const prow = await E(async () => {
    const tabs = document.querySelector('.ew-region-center > .ew-tabs'),
      panel = document.querySelector('[data-panel="jam"]');
    const t0 = tabs.getBoundingClientRect(),
      h = document.querySelector('.jm-head').getBoundingClientRect(),
      reg = document.querySelector('.ew-region-center').getBoundingClientRect();
    panel.scrollTop = 200;
    await new Promise((r) => setTimeout(r, 120));
    const t1 = tabs.getBoundingClientRect(),
      under = document.elementFromPoint(reg.left + reg.width - 20, t1.top + 10);
    panel.scrollTop = 0;
    return {
      full: Math.round(t0.width) === Math.round(reg.width),
      headBelow: Math.round(h.top - t0.bottom),
      still: Math.round(t1.top - t0.top),
      covers: !!under?.closest('.ew-tabs'),
    };
  });
  T.ok(
    prow.full && prow.headBelow >= 0 && prow.still === 0 && prow.covers,
    `phone: in the room the tabs have the top line to themselves and keep it while the room scrolls under them (head ${prow.headBelow} px below)`,
  );
  const lay = await E(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const sc = document.querySelector('.jm-neck-scroll');
    return {
      doc: document.documentElement.scrollWidth,
      vw: innerWidth,
      now: r('.jm-now'),
      next: r('.jm-next'),
      neckW: sc.scrollWidth,
      neckVis: sc.clientWidth,
      togs: [...document.querySelectorAll('.jm-togs .tog')].map((t) => Math.round(t.getBoundingClientRect().height)),
    };
  });
  T.ok(lay.doc <= lay.vw, `phone: no sideways page scroll (${lay.doc} px in ${lay.vw})`);
  T.ok(lay.neckW > lay.neckVis + 300, `phone: the neck scrolls sideways (${lay.neckW} px of neck in ${lay.neckVis})`);
  T.ok(
    lay.next.left >= lay.now.right - 1 && lay.next.top < lay.now.bottom && lay.next.bottom > lay.now.top,
    `phone: the stage is one line: the chord now, then the next and its count beside it (${Math.round(lay.now.right)} | ${Math.round(lay.next.left)} px)`,
  );
  T.ok(
    lay.togs.every((x) => x >= 40),
    `phone: the neck's toggles are 40 px targets (${lay.togs.join(', ')})`,
  );
  const scrollTo = async (sel) => {
    await E((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);
    await sleep(200);
  };
  const small = async () =>
    E(() => {
      const out = new Set(),
        root = document.querySelector('[data-panel="jam"]');
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode()); ) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        if (!el || el.closest('.ewf, .sr-only, [hidden], [aria-hidden="true"], svg, .ew-pop')) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.bottom <= 0 || b.top >= innerHeight) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 11.95) out.add(`${el.className || el.tagName} ${fs}px`);
      }
      return [...out];
    });
  const tiny = [];
  for (const sel of ['.jm-stage', '.jm-views', '.jm-neck', '.jm-input', '.jm-practice', '.jm-ideas']) {
    await scrollTo(sel);
    tiny.push(...(await small()));
  }
  T.ok(
    !tiny.length,
    `phone: no text under 12 px in the room${tiny.length ? ': ' + [...new Set(tiny)].slice(0, 5).join(', ') : ''}`,
  );
  const targets = [];
  for (const sel of [
    '.jm-song',
    '.jm-new',
    '.jm-view',
    '.jm-tuning',
    '.jm-loop',
    '.jm-rec',
    '.jm-open',
    '.jm-tips .btn-txt',
    '.jm-ask',
  ]) {
    await scrollTo(sel);
    const b = await E((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    }, sel);
    if (!b || b[1] < 40 || b[0] < 40) targets.push(`${sel} ${b ? b.join('x') : 'missing'}`);
  }
  T.ok(
    !targets.length,
    `phone: the room's controls are 40 px targets${targets.length ? ': ' + targets.join(', ') : ''}`,
  );
  // round 6: a thumb that scrolls the room over the neck plays nothing (real touch events: a swipe up, then down)
  await step('phone: a swipe on the neck', async () => {
    const cdp = await context.newCDPSession(page);
    await E(() => {
      const p = document.querySelector('[data-panel="jam"]');
      p.scrollTop = 0;
      window.__notes = 0;
      window.overdub.input.on('note', () => {
        window.__notes++;
      });
    });
    await sleep(200);
    const at = await E(() => {
      const b = document.querySelector('.jm-neck-cv').getBoundingClientRect();
      return { x: Math.round(b.left + 160), y: Math.round(b.top + b.height / 2) };
    });
    const swipe = async (dy) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
      for (let k = 1; k <= 12; k++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: at.x, y: at.y + (dy * k) / 12 }],
        });
        await sleep(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(500);
    };
    await swipe(-260);
    const up = await E(() => document.querySelector('[data-panel="jam"]').scrollTop);
    await swipe(160);
    const s = await E(() => ({
      top: document.querySelector('[data-panel="jam"]').scrollTop,
      notes: window.__notes,
      heard: window.overdub.jam.state.heard,
      keys: window.overdub.jam.guitars().keys?.name || null,
      held: window.overdub.input.held().length,
    }));
    T.ok(
      up > 60 && s.top < up && s.notes === 0 && !s.heard && !s.keys && !s.held,
      `phone: swipes that start on the neck scroll the room (to ${up} px, back to ${s.top}) and play nothing: ${s.notes} notes, nothing heard, no track made`,
    );
    await E(() => {
      document.querySelector('[data-panel="jam"]').scrollTop = 0;
    });
  });
  // a tap on the neck plays a guitar: the room gives the keys one, and the note lights where it falls
  await scrollTo('.jm-neck-scroll');
  const tap = await E(() => {
    const n = window.overdub.jam.neck,
      cv = document.querySelector('.jm-neck-cv').getBoundingClientRect(),
      a = n.at(3, 2);
    return { x: cv.left + a.x, y: cv.top + a.y };
  });
  await page.touchscreen.tap(tap.x, tap.y);
  await sleep(500);
  const tp = await E(() => {
    const o = window.overdub,
      g = o.jam.guitars().keys;
    return {
      keys: g?.name,
      dev: g?.instrument?.device,
      target: o.input.target()?.id === g?.id,
      heard: document.querySelector('.jm-heard').textContent,
    };
  });
  T.ok(
    tp.keys === 'Keys guitar' && tp.dev === 'core.guitar' && tp.target && /^You A: the root of Am7/.test(tp.heard),
    `phone: a tap on the neck (A, 2nd fret, G string) adds a guitar for the keys and plays it: "${tp.heard}"`,
  );
  await page.evaluate(() => {
    const p = document.querySelector('[data-panel="jam"]');
    p.scrollTop = 0;
  });
  await sleep(200);
  await page.screenshot({ path: path.join(OUTDIR, 'jam-phone.png') });
  await scrollTo('.jm-tone');
  await page.screenshot({ path: path.join(OUTDIR, 'jam-phone-tone.png') });

  /* ---------------------------------------------------------------------------- 10. a phone, round 6 */
  const inView = () =>
    E(() => {
      const b = document.querySelector('.jm-neck-scroll').getBoundingClientRect(),
        p = document.querySelector('[data-panel="jam"]').getBoundingClientRect();
      return b.top >= p.top - 1 && b.bottom <= Math.min(p.bottom, innerHeight) + 1;
    });
  await step('phone: Show brings the neck back', async () => {
    await scrollTo('.jm-tips');
    const away = await inView();
    const btn = await E(() => {
      const b = [...document.querySelectorAll('.jm-tips button')]
        .find((x) => x.textContent === 'Show')
        .getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.touchscreen.tap(btn.x, btn.y);
    await sleep(900);
    T.ok(
      !away && (await inView()) && (await E(() => !!window.overdub.jam.state.shown)),
      'phone: Show on a tip far below the neck brings the neck into view, lit',
    );
  });
  await step('phone: the room fits the screen', async () => {
    await scrollTo('.jm-tips');
    const pan = await E(() => {
      const p = document.querySelector('[data-panel="jam"]');
      return { sw: p.scrollWidth, cw: p.clientWidth, tab: !!document.querySelector('.jm-tab') };
    });
    T.ok(
      pan.tab && pan.sw <= pan.cw,
      `phone: the lick's tab doesn't widen the room: nothing pans sideways (${pan.sw} px in ${pan.cw})`,
    );
    const words = await E(() => {
      const t = document.querySelector('[data-panel="jam"]').innerText;
      return {
        brackets: /\[ and \]/.test(t),
        keys: /The keys play/.test(t),
        kbd: [...document.querySelectorAll('[data-panel="jam"] kbd')].filter((k) => k.getClientRects().length).length,
      };
    });
    T.ok(
      !words.brackets && !words.keys && !words.kbd,
      `phone: the room speaks to a finger: no "[ and ]", no "The keys play", no key hints (${words.kbd} shown)`,
    );
    const rec = await E(() => {
      const r = document.querySelector('.jm-neck-rec').getBoundingClientRect(),
        n = document.querySelector('.jm-neck-scroll').getBoundingClientRect();
      return { h: Math.round(r.height), gap: Math.round(r.top - n.bottom) };
    });
    T.ok(
      rec.h >= 44 && rec.gap >= 0 && rec.gap < 120,
      `phone: a Record by the neck (${rec.gap} px under it, ${rec.h} px tall)`,
    );
  });
  await step('phone: 44 px targets', async () => {
    await E(() => window.overdub.jam.setView('rig'));
    await sleep(400);
    await scrollTo('.jm-banks');
    const banks = await E(() =>
      [...document.querySelectorAll('.jm-bank')].map((b) => {
        const r = b.getBoundingClientRect();
        return Math.min(r.width, r.height);
      }),
    );
    await scrollTo('.jm-speed');
    const speedH = await E(() => document.querySelector('.jm-speed').getBoundingClientRect().height);
    await scrollTo('.jm-board .pd-sw');
    const sw = await E(() => {
      const s = document.querySelector('.jm-board .pd-sw:not(.pd-sw2)'),
        b = s.getBoundingClientRect(),
        cx = b.left + b.width / 2,
        cy = b.top + b.height / 2;
      return [
        [-21, 0],
        [21, 0],
        [0, -21],
        [0, 21],
      ].filter(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy) === s).length;
    });
    await E(() => window.overdub.jam.setView('neck'));
    await sleep(300);
    T.ok(
      banks.length && Math.min(...banks) >= 44 && speedH >= 44 && sw === 4,
      `phone: the bank words (${Math.round(Math.min(...banks))} px), the speed slider (${Math.round(speedH)} px) and a pedal's footswitch (a finger 21 px off its centre still takes it, ${sw} of 4 ways) are 44 px targets`,
    );
  });
  // the Rig tab on a phone: the amp stacks above the board; the board scrolls sideways and never up and down; a thumb's
  // swipe from a pedal's knob scrolls (along the board, or the room), and a hold turns it
  await step('phone: the rig', async () => {
    await page.tap('#jm-view-rig');
    await sleep(600);
    await E(() => {
      document.querySelector('[data-panel="jam"]').scrollTop = 0;
    });
    await sleep(200);
    const r = await E(() => {
      const b = (sel) => document.querySelector(sel).getBoundingClientRect(),
        board = document.querySelector('.jm-board');
      return {
        ampBottom: Math.round(b('.jm-amp-face').bottom),
        ampW: Math.round(b('.jm-amp-face').width),
        boardTop: Math.round(b('.jm-board').top),
        vw: innerWidth,
        doc: document.documentElement.scrollWidth,
        sw: board.scrollWidth,
        cw: board.clientWidth,
        sh: board.scrollHeight,
        ch: board.clientHeight,
        dial: Math.round(document.querySelector('.jm-amp-face .amp-knobs .kn-dial').getBoundingClientRect().width),
        stage: document.querySelector('.jm-stage').getClientRects().length,
      };
    });
    await page.screenshot({ path: path.join(OUTDIR, 'jam-phone-rig.png') });
    T.ok(
      r.ampBottom <= r.boardTop && r.ampW <= r.vw && r.sw > r.cw + 100 && r.sh <= r.ch + 1 && r.doc <= r.vw && !r.stage,
      `phone: the Rig tab stacks the amp (${r.ampW} px wide, knobs ${r.dial} px) above the pedalboard, which scrolls sideways (${r.sw} px in ${r.cw}) and never up and down; nothing pans the page`,
    );
    const tiny2 = [];
    for (const sel of ['.jm-tone', '.jm-amp', '.jm-floor']) {
      await scrollTo(sel);
      tiny2.push(...(await small()));
    }
    const t2 = [];
    for (const sel of ['.jm-flip', '.jm-cab-btn', '.jm-add', '.jm-grip', '.jm-fx-x', '.jm-band']) {
      await scrollTo(sel);
      const bx = await E((q) => {
        const el = document.querySelector(q);
        if (!el) return null;
        const rr = el.getBoundingClientRect();
        return [Math.round(rr.width), Math.round(rr.height)];
      }, sel);
      if (!bx || bx[1] < 44 || bx[0] < 44) t2.push(`${sel} ${bx ? bx.join('x') : 'missing'}`);
    }
    T.ok(
      !tiny2.length && !t2.length,
      `phone: the rig's text is 12 px or more and its controls 44 px targets (the flips, Cab & mics, Add a pedal, a pedal's tab and its ×, the Band fader)${tiny2.length || t2.length ? ': ' + [...new Set(tiny2)].slice(0, 3).concat(t2).join(', ') : ''}`,
    );
    // a thumb on a pedal's knob: a swipe along the board scrolls it, a swipe up scrolls the room, a hold turns it
    const cdp = await context.newCDPSession(page);
    const touch = async (pts, holdMs = 0) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
      if (holdMs) await sleep(holdMs);
      for (const p of pts.slice(1)) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
        await sleep(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(450);
    };
    const knob = async () => {
      await E(() => {
        const d = document.querySelector('.jm-board .jm-fx .kn-dial');
        d.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
      await sleep(250);
      return E(() => {
        const d = document.querySelector('.jm-board .jm-fx .kn-dial'),
          b = d.getBoundingClientRect(),
          o = window.overdub;
        return {
          x: Math.round(b.left + b.width / 2),
          y: Math.round(b.top + b.height / 2),
          kv: d.closest('.kn').style.getPropertyValue('--kv'),
          sl: document.querySelector('.jm-board').scrollLeft,
          st: document.querySelector('[data-panel="jam"]').scrollTop,
          h: o.store.history.length,
        };
      });
    };
    const line = (x0, y0, x1, y1, n = 12) =>
      Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
    await E(() => {
      document.querySelector('.jm-board').scrollLeft = 0;
    });
    const k0 = await knob();
    await touch(line(k0.x, k0.y, k0.x - 160, k0.y));
    const k1 = await E(() => ({
      sl: document.querySelector('.jm-board').scrollLeft,
      h: window.overdub.store.history.length,
      kv: document.querySelector('.jm-board .jm-fx .kn-dial').closest('.kn').style.getPropertyValue('--kv'),
    }));
    T.ok(
      k1.sl >= k0.sl + 60 && k1.h === k0.h && k1.kv === k0.kv,
      `phone: a thumb's swipe along the board from a pedal's knob scrolls the board (${k0.sl} → ${k1.sl} px) and turns nothing (${k1.h - k0.h} steps)`,
    );
    await E(() => {
      document.querySelector('.jm-board').scrollLeft = 0;
    });
    const k2 = await knob();
    await touch(line(k2.x, k2.y, k2.x, k2.y - 200));
    const k3 = await E(() => ({
      st: document.querySelector('[data-panel="jam"]').scrollTop,
      h: window.overdub.store.history.length,
      kv: document.querySelector('.jm-board .jm-fx .kn-dial').closest('.kn').style.getPropertyValue('--kv'),
    }));
    T.ok(
      Math.abs(k3.st - k2.st) >= 60 && k3.h === k2.h && k3.kv === k2.kv,
      `phone: a swipe up from a pedal's knob scrolls the room (${k2.st} → ${k3.st} px), not the board, and turns nothing`,
    );
    const k4 = await knob();
    await touch(line(k4.x, k4.y, k4.x, k4.y - 40, 8), 450);
    const k5 = await E(() => ({
      h: window.overdub.store.history.length,
      kv: document.querySelector('.jm-board .jm-fx .kn-dial').closest('.kn').style.getPropertyValue('--kv'),
      by: window.overdub.store.history[window.overdub.store.history.length - 1]?.by,
    }));
    T.ok(
      k5.h === k4.h + 1 && k5.kv !== k4.kv && k5.by === 'you',
      `phone: held still first, the pedal's knob turns (${k4.kv} → ${k5.kv}), one step by you`,
    );
    await E(() => {
      window.overdub.store.undo();
      document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
      window.overdub.jam.setView('neck');
      document.querySelector('[data-panel="jam"]').scrollTop = 0;
    });
    await sleep(400);
  });
  await step('phone: the picker', async () => {
    await E(() => {
      document.querySelector('[data-panel="jam"]').scrollTop = 0;
    });
    await sleep(200);
    await page.tap('.jm-new');
    await sleep(400);
    await E(() => {
      const d = document.querySelector('.jm-pop details.jm-make');
      if (d) d.open = true;
    });
    await sleep(200);
    const pk = await E(() => {
      const pop = document.querySelector('.jm-pop'),
        rows = [...pop.querySelectorAll('.jm-pick-row')],
        small = [];
      for (const el of pop.querySelectorAll('small, .jm-lab, .jm-pick-h, summary')) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (el.getClientRects().length && fs < 11.95) small.push(`${el.className || el.tagName} ${fs}`);
      }
      const fields = [...pop.querySelectorAll('.jm-mk .ew-input')].map((f) => ({
        h: f.getBoundingClientRect().height,
        fs: parseFloat(getComputedStyle(f).fontSize),
      }));
      const go = pop.querySelector('.jm-mk .btn-go').getBoundingClientRect().height;
      return {
        cols: new Set(rows.slice(0, 6).map((r) => Math.round(r.getBoundingClientRect().left))).size,
        rowH: Math.min(...rows.map((r) => r.getBoundingClientRect().height)),
        small,
        fields,
        go,
      };
    });
    await page.keyboard.press('Escape');
    T.ok(
      pk.cols === 1 && pk.rowH >= 44 && !pk.small.length,
      `phone: the Jam tracks picker is one column of 44 px rows, its text 12 px or more (rows ${Math.round(pk.rowH)} px${pk.small.length ? '; small: ' + pk.small.slice(0, 3).join(', ') : ''})`,
    );
    T.ok(
      pk.fields.length >= 5 && pk.fields.every((f) => f.h >= 44 && f.fs >= 16) && pk.go >= 44,
      `phone: Make your own's fields are 44 px with 16 px text (a phone's browser zooms into less), and its button 44 px (${pk.fields.map((f) => `${Math.round(f.h)}/${f.fs}`).join(' ')})`,
    );
  });
  await step('phone: leaving the room', async () => {
    await page.tap('#ew-tab-arranger');
    await sleep(400);
    const s = await E(() => ({ sheet: window.overdub.ui.isOpen('bottom'), room: window.overdub.ui.state.room }));
    T.ok(s.sheet && s.room === null, 'phone: leaving the room brings the sheet back');
    await page.tap('#ew-tab-jam');
    await sleep(500);
  });
  await step('phone: on its side', async () => {
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(1200);
    await E(() => {
      document.querySelector('[data-panel="jam"]').scrollTop = 0;
    });
    await sleep(300);
    const side = await E(() => {
      const g = window.overdub.jam.neck.geometry,
        n = document.querySelector('.jm-neck-scroll').getBoundingClientRect(),
        c = document.querySelector('.jm-now-name').getBoundingClientRect(),
        s = document.querySelector('.ew-region-bottom').getBoundingClientRect();
      return {
        phone: g.phone,
        gap: g.gap,
        chordTop: Math.round(c.top),
        neckTop: Math.round(n.top),
        neckBottom: Math.round(n.bottom),
        sheetTop: Math.round(s.top),
      };
    });
    await page.screenshot({ path: path.join(OUTDIR, 'jam-phone-side.png') });
    T.ok(
      side.phone && side.chordTop >= 0 && side.neckTop >= side.chordTop && side.neckBottom <= side.sheetTop,
      `phone on its side: the neck is a phone's (strings ${side.gap} px apart, frets a finger wide) and the chord and the whole neck are on screen together (the neck to ${side.neckBottom} px, the sheet from ${side.sheetTop})`,
    );
  });
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `phone: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  await srv.close();
}

/* ============================================================================ 11. the rig and the Band level */
{
  // a guitar quieter than the plucked one above (an interface's input turned down): too quiet for the fader's top alone
  const quiet = fakeGuitar(path.join(OUTDIR, 'jam-fake-guitar-quiet.wav'), 0.2);
  const { page, errors, close } = await boot({ width: 1280, height: 800, fakeAudio: quiet });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const hist = () =>
    E(() => {
      const h = window.overdub.store.history,
        l = h[h.length - 1];
      return { n: h.length, label: l?.label || '', by: l?.by || '' };
    });
  const pair = () =>
    E(() => {
      const g = window.overdub.jam.guitars();
      return [g.keys, g.audio].map((t) =>
        t ? t.inserts.map((x) => x.device + (x.on === false ? '(off)' : '')).join('>') : null,
      );
    });
  await page.click('#ew-tab-jam');
  await sleep(700);

  await step('the rig: the amp big', async () => {
    await page.click('#jm-view-rig');
    await sleep(500);
    const a = await E(() => {
      const r = (el) => el.getBoundingClientRect(),
        room = document.querySelector('[data-panel="jam"]');
      const face = document.querySelector('.jm-amp-face .ewf-ampface'),
        dials = [...document.querySelectorAll('.jm-amp-face .amp-knobs .kn-dial')];
      return {
        full: !!face && !face.classList.contains('ewf-compact'),
        w: Math.round(r(face).width),
        room: room.clientWidth,
        dial: Math.round(Math.min(...dials.map((d) => r(d).width))),
        n: dials.length,
        stage: document.querySelector('.jm-stage').getClientRects().length,
        neck: document.querySelector('.jm-neck').getClientRects().length,
        mini: document.querySelector('.jm-mini-now').textContent,
        now: document.querySelector('.jm-now-name').textContent,
        cab: document.querySelector('.jm-cab-btn')?.textContent || '',
        sel: document.querySelector('#jm-view-rig').getAttribute('aria-selected'),
        saved: JSON.parse(localStorage.getItem('overdub:jam')).view,
      };
    });
    T.ok(
      a.full && a.w >= 560 && a.dial >= 38 && a.n >= 5 && a.sel === 'true' && a.saved === 'rig',
      `the Rig tab draws the amp at its full face, ${a.w} px wide in a ${a.room} px room, its ${a.n} knobs ${a.dial} px across (on the board they were drawn at 0.62)`,
    );
    T.ok(
      !a.stage && !a.neck && a.mini === a.now && /^Cab & mics.+cab.+mic/.test(a.cab),
      `the stage and the neck step aside for it, the chord now stays in the tabs' row ("${a.mini}"), and the amp's cab and mics are named under it ("${a.cab.slice(0, 64)}")`,
    );
    await page.click('.jm-cab-btn');
    await sleep(200);
    const c = await E(() => ({
      open: document.querySelector('.jm-cab-btn').getAttribute('aria-expanded'),
      n: [...document.querySelectorAll('#jm-cab .kn-dial, #jm-cab select')].filter((x) => x.getClientRects().length)
        .length,
      under:
        document.querySelector('#jm-cab').getBoundingClientRect().top >=
        document.querySelector('.jm-amp-face .amp').getBoundingClientRect().bottom - 1,
    }));
    await page.click('.jm-cab-btn');
    await sleep(150);
    T.ok(
      c.open === 'true' && c.n >= 4 && c.under,
      `Adjust opens the cab and mics strip under the amp (${c.n} controls); again, it folds back to its line`,
    );
  });

  const fit = async (w, hh) => {
    await page.setViewportSize({ width: w, height: hh });
    await sleep(600);
    await E(() => {
      document.querySelector('[data-panel="jam"]').scrollTop = 0;
    });
    await sleep(200);
    const f = await E(() => {
      const vh = innerHeight,
        room = document.querySelector('[data-panel="jam"]').getBoundingClientRect(),
        bd = document.querySelector('.jm-board').getBoundingClientRect();
      const inView = (el) => {
        const b = el.getBoundingClientRect();
        return (
          b.width > 0 &&
          b.top >= room.top - 1 &&
          b.bottom <= vh + 1 &&
          b.left >= room.left - 1 &&
          b.right <= room.right + 1
        );
      };
      const knobs = [...document.querySelectorAll('.jm-amp-face .amp-knobs .kn-dial')],
        sws = [...document.querySelectorAll('.jm-board .pd-sw')].filter(
          (x) => x.getBoundingClientRect().right <= bd.right,
        );
      return {
        knobs: knobs.length,
        kIn: knobs.filter(inView).length,
        sws: sws.length,
        sIn: sws.filter(inView).length,
        name: inView(document.querySelector('.jm-tone-name')),
        add: inView(document.querySelector('.jm-add')),
        tabs: inView(document.querySelector('.jm-views')),
        pwr: inView(document.querySelector('.jm-amp-face .amp-pwr')),
        low: Math.round(Math.max(...sws.map((x) => x.getBoundingClientRect().bottom))),
      };
    });
    await page.screenshot({ path: path.join(OUTDIR, `jam-rig-${w}.png`) });
    T.ok(
      f.knobs >= 5 && f.kIn === f.knobs && f.pwr && f.sws >= 2 && f.sIn === f.sws && f.name && f.add && f.tabs,
      `at ${w}x${hh} the rig's name, every knob on the amp (${f.kIn} of ${f.knobs}) and its power, and the board's footswitches (${f.sIn} of ${f.sws}, the lowest at ${f.low} px) with Add a pedal are all on screen at once`,
    );
  };
  await step('the rig at 1440x900', () => fit(1440, 900));
  await step('the rig at 1280x800', () => fit(1280, 800));

  await step('the rig: a knob on the amp', async () => {
    const k = await E(() => {
      const d = document.querySelector('.jm-amp-face .amp-knobs .kn-dial'),
        r = d.getBoundingClientRect(),
        t = window.overdub.jam.guitar(),
        amp = t.inserts.find((x) => window.overdub.devices.getDevice(x.device)?.cat === 'amp');
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, amp: amp.id, before: JSON.stringify(amp.params) };
    });
    const h0 = await hist();
    await page.mouse.move(k.x, k.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(k.x, k.y - i * 4);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(250);
    const h1 = await hist(),
      after = await E(
        (id) => JSON.stringify(window.overdub.jam.guitar().inserts.find((x) => x.id === id).params),
        k.amp,
      );
    T.ok(
      h1.n === h0.n + 1 && h1.by === 'you' && after !== k.before && / gain$/.test(h1.label),
      `turning a knob on the big amp is one op, signed by you ("${h1.label}": ${after.slice(0, 40)})`,
    );
    await E(() => window.overdub.store.undo());
  });

  await step('the board in signal order', async () => {
    const b = await E(() => {
      const t = window.overdub.jam.guitar(),
        kids = [...document.querySelector('.jm-board').children];
      const add = kids.findIndex((x) => x.classList.contains('jm-add'));
      return {
        chain: t.inserts.map((x) => x.id).join(','),
        slots: kids
          .filter((x) => x.dataset.slot != null)
          .map((x) => x.dataset.fx || x.dataset.amp)
          .join(','),
        first: kids[0].className,
        last: kids[kids.length - 1].textContent,
        cables: kids.filter((x) => x.classList.contains('jm-cable')).length,
        stops: kids.filter((x) => !x.classList.contains('jm-cable')).length,
        addAmp: !!kids[add + 2]?.classList.contains('jm-ampstop'),
        alt: kids.every((x, i) => (i % 2 === 1) === x.classList.contains('jm-cable')),
        devs: t.inserts.map((x) => x.device).join('>'),
      };
    });
    T.ok(
      b.slots === b.chain && /jm-jack/.test(b.first) && b.addAmp && b.alt && b.cables === b.stops - 1,
      `the board runs in signal order, ${b.devs}: your guitar's jack, the pedals, Add a pedal, the amp's place, the pedals after it, out to the ${b.last} (${b.stops} stops, a cable between each)`,
    );
  });

  await step('the rig: bypass', async () => {
    const h0 = await hist();
    await page.click('.jm-board .jm-fx .pd-sw:not(.pd-sw2)');
    await sleep(200);
    const off = await E(() => ({
      on: window.overdub.jam.guitar().inserts[0].on,
      pressed: document.querySelector('.jm-board .jm-fx .pd-sw').getAttribute('aria-pressed'),
    }));
    const h1 = await hist();
    await page.click('.jm-board .jm-fx .pd-sw:not(.pd-sw2)');
    await sleep(200);
    const on = await E(() => window.overdub.jam.guitar().inserts[0].on);
    T.ok(
      off.on === false &&
        off.pressed === 'false' &&
        h1.n === h0.n + 1 &&
        / off$/.test(h1.label) &&
        h1.by === 'you' &&
        on === true,
      `a pedal's footswitch bypasses it, one op by you ("${h1.label}"); stomped again, it's back in`,
    );
  });

  await step('the rig: add, take off and move a pedal', async () => {
    // both guitars, one tone (the keys' and the live one): a rig with pedals before its amp
    const rig = await E(async () => {
      const j = window.overdub.jam;
      j.ensureKeysGuitar({ select: false });
      j.ensureAudioGuitar({ by: 'you' });
      await j.levelled;
      const r = j.rigs.RIGS.find((x) => x.chain.findIndex((c) => /^amp\./.test(c.device)) >= 2);
      j.setTone(r.id, { toast: false });
      return r.name;
    });
    await sleep(500);
    await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
    const p0 = await pair(),
      h0 = await hist();
    await page.click('.jm-board .jm-add');
    await sleep(350);
    const picked = await E(() => document.querySelector('.rk-picker .rk-prow span')?.textContent || null);
    await page.click('.rk-picker .rk-prow');
    await sleep(350);
    const p1 = await pair(),
      h1 = await hist();
    const a1 = await E(() => ({
      name: document.querySelector('.jm-tone-name').textContent,
      toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '),
      at: (() => {
        const t = window.overdub.jam.guitar();
        return t.inserts.findIndex((x) => /^amp\./.test(x.device)) - 1;
      })(),
    }));
    const added = (x) => x.split('>').length;
    T.ok(
      picked &&
        p1[0] === p1[1] &&
        added(p1[0]) === added(p0[0]) + 1 &&
        h1.n === h0.n + 1 &&
        h1.label === `add ${picked} to the board` &&
        h1.by === 'you' &&
        /before the amp, on .+ and .+\./.test(a1.toast) &&
        a1.name === `${rig}edited`,
      `Add a pedal opens Add an effect's picker; ${picked} goes on the board before the amp, on both guitars in one op by you ("${h1.label}"), and the rig reads "${a1.name.replace(/edited$/, ', edited')}"`,
    );
    await E((i) => document.querySelector(`.jm-board [data-slot="${i}"] .jm-fx-x`).click(), a1.at);
    await sleep(300);
    const p2 = await pair(),
      h2 = await hist();
    T.ok(
      p2[0] === p0[0] && p2[1] === p0[1] && h2.n === h1.n + 1 && h2.label === `take ${picked} off the board`,
      `its × takes it off both guitars, one op ("${h2.label}")`,
    );
    await page.focus('.jm-board .jm-fx .jm-grip');
    await page.keyboard.press('ArrowRight');
    await sleep(300);
    const p3 = await pair(),
      h3 = await hist(),
      focus = await E(() => document.activeElement?.closest('[data-slot]')?.dataset.slot);
    const sw = (x) => {
      const d = x.split('>');
      return [d[1], d[0], ...d.slice(2)].join('>');
    };
    T.ok(
      p3[0] === sw(p0[0]) &&
        p3[1] === sw(p0[1]) &&
        h3.n === h2.n + 1 &&
        /^move .+ on the board$/.test(h3.label) &&
        focus === '1',
      `a pedal's tab and the right arrow move it one place along, on both guitars, one op ("${h3.label}"); the tab keeps the focus`,
    );
    const g = await E(() => {
      const gs = [...document.querySelectorAll('.jm-board .jm-fx .jm-grip')],
        a = gs[1].getBoundingClientRect(),
        b = gs[0].closest('.jm-fx').getBoundingClientRect();
      return { x: a.left + a.width / 2, y: a.top + a.height / 2, tx: b.left + 6 };
    });
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(g.x + ((g.tx - g.x) * i) / 14, g.y - 4);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(300);
    const p4 = await pair(),
      h4 = await hist();
    T.ok(
      p4[0] === p0[0] && p4[1] === p0[1] && h4.n === h3.n + 1 && /^move .+ on the board$/.test(h4.label),
      `dragged by its tab back before the first, it moves there on both guitars, one op (${p4[0].split('>').slice(0, 2).join(', ')})`,
    );
    const back = [];
    for (let i = 0; i < 4; i++) {
      await E(() => window.overdub.store.undo());
      back.push((await pair())[0]);
    }
    T.ok(
      back[0] === p3[0] && back[1] === p2[0] && back[2] === p1[0] && back[3] === p0[0],
      'each of them is one undo step: the drag, the move, the take-off, the add, back in turn',
    );
  });

  await step('the Band level', async () => {
    // a band track's meter while the song plays, at 0 dB and at the Band's -12; the keys guitar's while it plays alone
    const ids = await E(() => {
      const o = window.overdub,
        g = o.jam.guitars(),
        keep = [g.keys?.id, g.audio?.id];
      const band = o.store.get().tracks.filter((t) => !keep.includes(t.id) && t.clips.length && !t.mute);
      return { band: band.map((t) => t.id), keys: g.keys.id };
    });
    const peakWhile = (arg) =>
      E(async ([kind, id, keys]) => {
        // (every meter reading, as the engine makes them: polling the latest one every 30 ms skipped some, and with them
        // a pluck's peak, on a slower machine)
        const o = window.overdub,
          e = o.engine;
        let pk = -120;
        const off = e.on('meters', (ms) => {
          const m = ms.tracks[id];
          if (m && m.peak > pk) pk = m.peak;
        });
        if (kind === 'band') {
          e.seek(0);
          await e.play(0);
        } else e.audition(keys, 52, 0.9, 2);
        await new Promise((r) => setTimeout(r, 1400));
        off();
        if (e.playing) e.stop();
        await new Promise((r) => setTimeout(r, 400));
        return Math.round(pk * 10) / 10;
      }, arg);
    const loud = await E((ids) => ids[0], ids.band);
    const b0 = await peakWhile(['band', loud]),
      g0 = await peakWhile(['keys', ids.keys, ids.keys]);
    const song0 = await E(() => ({
      json: JSON.stringify(window.overdub.store.get()),
      h: window.overdub.store.history.length,
    }));
    // the fader in the room, as a hand moves it
    await E(() => {
      const r = document.querySelector('.jm-band');
      r.value = '-12';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    const b1 = await peakWhile(['band', loud]),
      g1 = await peakWhile(['keys', ids.keys, ids.keys]);
    const lv = await E(() => window.overdub.engine.bandLevel);
    T.ok(
      lv.db === -12 && Math.abs(b0 - b1 - 12) <= 1.5 && Math.abs(g0 - g1) <= 1 && lv.keep.includes(ids.keys),
      `the Band fader turns the band down and leaves the guitars as they were, on the live meters: a band track ${b0} → ${b1} dBFS at −12 dB, the keys guitar ${g0} → ${g1}`,
    );
    const shown = await E(() => ({
      flag: document.querySelector('.jm-bandflag').hidden ? '' : document.querySelector('.jm-bandflag').textContent,
      val: document.querySelector('.jm-band-val').textContent,
      down: document.querySelector('.jm-band-field').classList.contains('jm-down'),
      note: document.querySelector('.jm-bandnote').textContent,
    }));
    const jam = await E(() => window.overdub.tools.run('get_jam', { tips: false }, { by: 'mcp:test' }));
    T.ok(
      /^Band−12 dB$/.test(shown.flag) &&
        shown.val === '−12 dB' &&
        shown.down &&
        /^The band is 12 dB down in the room/.test(shown.note) &&
        /^−12 dB \(practice only/.test(jam.room.band),
      `the room shows it plainly: "Band −12 dB" at the top of the room, the fader in the warning ink ("${shown.note.slice(0, 50)}…"), and get_jam says so`,
    );
    // never the song: no op, nothing in History, the document as it was, and a render the same sample for sample
    const r = await E(async () => {
      const o = window.overdub,
        e = o.engine,
        x = await e.render({ from: 0, to: 4, tail: 0.2 });
      const prev = e.bandLevel.db;
      o.jam.setBand(0, { say: false });
      const y = await e.render({ from: 0, to: 4, tail: 0.2 });
      o.jam.setBand(prev, { say: false });
      let d = 0;
      for (let c = 0; c < 2; c++) {
        const a = x.getChannelData(c),
          b = y.getChannelData(c);
        for (let i = 0; i < a.length; i++) {
          const v = Math.abs(a[i] - b[i]);
          if (v > d) d = v;
        }
      }
      return { d, n: x.length };
    });
    const song1 = await E(() => ({
      json: JSON.stringify(window.overdub.store.get()),
      h: window.overdub.store.history.length,
    }));
    T.ok(
      song1.json === song0.json && song1.h === song0.h && r.d < 1e-4,
      `the Band level never touches the song: no op, nothing in History, the document unchanged, and a render with it at −12 dB is the render at 0 dB (largest difference ${r.d.toExponential(1)} over ${r.n} samples)`,
    );
    // leaving the room puts it back
    await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
    await page.click('#ew-tab-arranger');
    await sleep(400);
    const left = await E(() => ({
      db: window.overdub.engine.bandLevel.db,
      toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '),
    }));
    await page.click('#ew-tab-jam');
    await sleep(400);
    const again = await E(() => ({
      flag: document.querySelector('.jm-bandflag').hidden,
      val: document.querySelector('.jm-band-val').textContent,
    }));
    T.ok(
      left.db === 0 && /The band is back to 0 dB/.test(left.toast) && again.flag && again.val === '0 dB',
      `leaving the room puts the band back to 0 dB and says so ("${left.toast.slice(0, 60)}"); back in, the fader reads 0 dB`,
    );
  });

  await step('Match the band uses the Band level', async () => {
    await E(() => window.overdub.exporter.openDemo('red-eye'));
    await sleep(1200);
    await page.click('.jm-open');
    await page.waitForFunction(() => window.overdub.input.audio.state.open, null, { timeout: 8000 });
    await E(() => window.overdub.jam.levelled);
    await sleep(300);
    const s0 = await E(() => ({
      json: JSON.stringify(window.overdub.store.get().tracks.map((t) => [t.id, t.gain])),
      h: window.overdub.store.history.length,
      g: window.overdub.jam.guitars().audio?.id,
    }));
    await page.click('.jm-match');
    await page.waitForFunction(() => window.overdub.jam.state.match?.phase === 'done', null, { timeout: 40000 });
    const m = await E(() => {
      const o = window.overdub;
      return {
        m: o.jam.state.match,
        band: o.engine.bandLevel,
        flag: document.querySelector('.jm-bandflag').hidden ? '' : document.querySelector('.jm-bandflag').textContent,
        gains: o.store.get().tracks.map((t) => [t.id, t.gain]),
        h: o.store.history.length,
      };
    });
    const M = m.m || {},
      others = m.gains.filter(([id]) => id !== s0.g),
      was = JSON.parse(s0.json).filter(([id]) => id !== s0.g);
    T.ok(
      M.top &&
        M.gain === 6 &&
        M.band < 0 &&
        m.band.db === M.band &&
        Math.abs(M.over - 3) <= 0.5 &&
        M.tp <= -1 &&
        JSON.stringify(others) === JSON.stringify(was) &&
        m.h <= s0.h + 1 &&
        /The band is down [\d.]+ dB in the room to make up the rest: practice only, the song’s mix is unchanged\./.test(
          M.line,
        ) &&
        m.flag.startsWith('Band'),
      `a quiet guitar on Red Eye: Match the band takes Live guitar's fader to its top (${M.short} dB against the band), then the Band level to ${M.band} dB, measured, so it sits ${M.over} dB over (the master ${M.tp} dBTP); no other fader moves, and the room says so ("${(M.line || '').slice(0, 70)}…")`,
    );
  });

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `the rig: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

T.done();
