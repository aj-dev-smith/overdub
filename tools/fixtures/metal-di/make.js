// The synthetic metal DIs (intent 0008, spec R33): songs, not audio. No CC0 or public-domain recording of a guitar DI
// *performance* could be verified, so the test and demo DIs are DI Box (core.guitar: a modelled string, electric body,
// bridge pickup) and Roundwound (core.ebass, Karoryfer's sampled five-string) playing fixed riffs, rendered by the
// canonical renderer when a test needs the audio. A real DI is still needed: these are deterministic stand-ins for
// measuring, not a player.
//   node tools/fixtures/metal-di/make.js      writes chug.json, tremolo.json, chords.json, lead.json, bass.json here
//
// The riffs (velocities under 0.35 are palm-muted: DI Box's MUTE SOFT):
//   chug     drop C, 132 bpm, 8 bars: palm-muted sixteenths on the open C with accented power chords (C5, D#5, F5,
//            F#5) on the off-beats, a gallop in bars 4 and 8
//   tremolo  B standard, 200 bpm, 8 bars: open, tremolo-picked sixteenths on a minor line on the low strings
//   chords   drop C, 132 bpm, 8 bars: open power chords (root, fifth, octave) a bar each, strummed
//   lead     drop C, 132 bpm, 8 bars: a single-note line around C4 to G5, held notes
//   bass     drop C, 132 bpm, 8 bars: the chug's roots an octave down, on Roundwound, picked eighths and sixteenths
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject } from '../../../app/src/core/project.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAMP = '2026-10-07T00:00:00.000Z';
// a fixed velocity wobble (+-0.03), so no two strokes are the same, the same every time
const wob = (i) => (((Math.imul(i + 1, 2654435761) >>> 0) % 61) - 30) / 1000;
const GUITAR = { body: 0, pick: 0.15, pickup: 0, tone: 0.7, decay: 1.2, strum: 6, mute: 1 };

function song(title, tempo, beats, device, params, notes) {
  return {
    ...createProject(), id: 'p_metal_' + title, title: 'metal DI: ' + title, tempo, key: null,
    meta: { created: STAMP, modified: STAMP, authors: {} }, loop: { on: false, start: 0, end: beats },
    tracks: [{ id: 't_di', name: 'DI', kind: 'instrument', instrument: { device, params }, inserts: [], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub',
      clips: [{ id: 'c_di', kind: 'notes', start: 0, length: beats, by: 'overdub', notes: notes.map((n, i) => ({ id: 'n' + (i + 1), p: n.p, t: +n.t.toFixed(4), d: +n.d.toFixed(4), v: +Math.max(0.05, Math.min(1, n.v + wob(i))).toFixed(3), by: 'overdub' })) }] }],
  };
}

const C2 = 36, PC = (r) => [r, r + 7, r + 12];
function chug() {
  const out = [];
  // per bar: 16 steps; 'm' a muted chug on C2, a number a power chord on that root, '.' rest (held from before)
  const bars = [
    'mmmm m3mm mmm5 m6mm', 'mmmm mm3. mmmm 0...', 'mmmm m3mm mmm5 m6mm', 'm.mm m.mm m.mm 3.5.',
    'mmmm m3mm mmm5 m6mm', 'mmmm mm3. mmmm 0...', 'mmmm m3mm mmm5 m6mm', 'm.mm m.mm 6.5. 3...',
  ];
  bars.forEach((b, bar) => {
    const steps = b.replace(/ /g, '');
    for (let s = 0; s < 16; s++) {
      const c = steps[s], t = bar * 4 + s / 4;
      if (c === 'm') out.push({ p: C2, t, d: 0.22, v: 0.3 });
      else if (c !== '.') {
        let len = 1; while (s + len < 16 && steps[s + len] === '.') len++;
        for (const p of PC(C2 + +c)) out.push({ p, t, d: len / 4 - 0.02, v: 0.82 });
      }
    }
  });
  return song('chug', 132, 32, 'core.guitar', GUITAR, out);
}
function tremolo() {
  const B1 = 35, line = [0, 0, 1, 0, 3, 0, 1, 0, 5, 3, 1, 0, 6, 5, 3, 1];
  const out = [];
  for (let bar = 0; bar < 8; bar++) for (let s = 0; s < 16; s++) {
    const p = B1 + 5 + line[(bar * 4 + (s >> 2)) % 16];
    out.push({ p, t: bar * 4 + s / 4, d: 0.24, v: s % 4 === 0 ? 0.72 : 0.6 });
  }
  return song('tremolo', 200, 32, 'core.guitar', { ...GUITAR, mute: 0 }, out);
}
function chords() {
  const roots = [0, 8, 10, 5, 0, 3, 5, 6];
  const out = [];
  roots.forEach((r, bar) => { for (const p of PC(C2 + r)) out.push({ p, t: bar * 4, d: 3.9, v: 0.8 }); });
  return song('chords', 132, 32, 'core.guitar', { ...GUITAR, mute: 0, strum: 12 }, out);
}
function lead() {
  const line = [[60, 1], [63, 0.5], [65, 0.5], [67, 2], [70, 1], [67, 1], [65, 2], [63, 1], [65, 1], [67, 1.5], [68, 0.5], [67, 2], [72, 1], [70, 1], [67, 4], [65, 2], [63, 2], [60, 4]];
  const out = [];
  let t = 0;
  for (const [p, d] of line) { out.push({ p, t, d: d - 0.05, v: 0.75 }); t += d; }
  return song('lead', 132, 32, 'core.guitar', { ...GUITAR, mute: 0, pickup: 0.1 }, out);
}
function bass() {
  const C1 = 24, out = [];
  const bars = ['xxxx x3xx xxx5 x6xx', 'xxxx xx3. xxxx 0...'];
  for (let bar = 0; bar < 8; bar++) {
    const steps = bars[bar % 2].replace(/ /g, '');
    for (let s = 0; s < 16; s++) {
      const c = steps[s], t = bar * 4 + s / 4;
      if (c === 'x') out.push({ p: C1, t, d: 0.22, v: 0.62 });
      else if (c !== '.') { let len = 1; while (s + len < 16 && steps[s + len] === '.') len++; out.push({ p: C1 + +c, t, d: len / 4 - 0.02, v: 0.85 }); }
    }
  }
  return song('bass', 132, 32, 'core.ebass', {}, out);
}

export const FIXTURES = { chug, tremolo, chords, lead, bass };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, fn] of Object.entries(FIXTURES)) {
    const s = fn();
    fs.writeFileSync(path.join(HERE, name + '.json'), JSON.stringify(s, null, 1) + '\n');
    console.log(`${name}.json: ${s.tracks[0].clips[0].notes.length} notes, ${s.tempo} bpm, ${s.tracks[0].instrument.device}`);
  }
}
