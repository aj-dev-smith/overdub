// Tabs [jam]: tab as a view of notes, the house riff writer, the agents' tab tools and the Jam room's tab lane.
//   1. tab text round-trips (standard and drop D, with timing: onsets and lengths, chords, ties over a bar line, bends,
//      triplets, a capo, two-digit frets) and reads tab people type, saying when the rhythm is a guess
//   2. notes keep their place (s, f) and clips their tuning and capo through ops, undo and redo, a split, a share link
//      and a save; a note without one is fingered; a stale one (its pitch moved) is fingered again
//   3. the riff writer: deterministic; every note in key; chord tones on beats 1 and 3; every note playable in the
//      tuning; one hand position, four frets; for every style and difficulty, over every jam track and Night Shift
//   4. the play-along judge (core/playalong.js): hits, early, late, missed, a wrong note, a chord by its lowest note,
//      the line after a pass; the guitar's note finder (input/onsets.js) on plucked strings
//   5. in the page: the lane under the stage; Suggest a riff (the house writer) -> takes; Hold to hear; Another; Keep;
//      the lane follows the playhead; Loop the riff; feedback from a fake pitch stream and from musical typing; Learn it
//      waits on each note; Copy tab; the neck lights the riff's note
//   6. the tools: tab_for, write_tab (a clip in free bars, a card over notes, propose, a song from a link, recording,
//      errors), suggest_riff (takes, the lane shows them, keep), the demo agent's riff scene
//   7. a phone: the lane scrolls with the playhead, 44 px targets, 12 px text, no sideways page scroll
//   8. no page errors
// usage: node tools/tabs-test.js     (screenshots: tools/.out/tabs-*.png)
import { open, tally, OUTDIR } from './pw.js';
import path from 'node:path';
import * as FB from '../app/src/core/fretboard.js';
import * as RIFF from '../app/src/core/riff.js';
import * as JAM from '../app/src/core/jam.js';
import * as PA from '../app/src/core/playalong.js';
import { createNoteFinder } from '../app/src/input/onsets.js';
import { createStore } from '../app/src/core/store.js';
import { createProject, cleanProject } from '../app/src/core/project.js';
import { encodeShare, decodeShare, listenCopy } from '../app/src/core/share.js';
import { demoProject } from '../app/src/core/demo.js';

const T = tally('tabs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);
const r4 = (x) => Math.round(x * 10000) / 10000;

/* ============================================================================ 1. tab text */
{
  const sig = (ns) => ns.map((n) => `${n.p}/${n.s}:${n.f}@${r4(n.t)}~${r4(n.d)}${n.bend ? `b${Math.round(n.bend.reduce((m, x) => Math.max(m, x[1]), 0))}` : ''}`).sort().join(' ');
  const trip = (notes, opts) => {
    const pl = FB.placeNotes(notes, opts);
    const text = FB.tabText(pl.notes, { ...opts, title: 'Riff' });
    const back = FB.parseTab(text);
    return { pl, text, back, same: sig(pl.notes) === sig(back.notes) };
  };
  // standard: eighths and quarters, a chord, a note held over a bar line, a bend, sixteenths with two-digit frets
  const std = [
    { p: 40, t: 0, d: 0.5 }, { p: 47, t: 0, d: 0.5 }, { p: 52, t: 0, d: 0.5 },          // E5 power chord
    { p: 45, t: 1, d: 0.5 }, { p: 48, t: 1.5, d: 0.25 }, { p: 50, t: 1.75, d: 0.25 },
    { p: 52, t: 2, d: 1 }, { p: 55, t: 3, d: 2 },                                         // held over the bar line
    { p: 57, t: 5, d: 1, bend: [[0, 0], [0.25, 2]] },                                     // a whole-step bend
    { p: 69, t: 6, d: 0.25 }, { p: 71, t: 6.25, d: 0.25 }, { p: 72, t: 6.5, d: 0.25 }, { p: 74, t: 6.75, d: 0.25 }, { p: 76, t: 7, d: 1 },
  ];
  const a = trip(std, { tuning: 'standard' });
  T.ok(a.same && a.back.tuning === 'standard' && !a.back.errors.length && !a.back.warnings.length, `standard tuning round-trips with its timing: ${a.back.notes.length} notes, chords, a tie over the bar line, a bend, 16ths on two-digit frets`);
  T.ok(/^e \|/m.test(a.text) && /^ {2}\|1/m.test(a.text) && /One column per 16th/.test(a.text) && /7b9|b\d+/.test(a.text), 'the text has the high e on top, a count line, the bend written 7b9, and says how to read it');
  // drop D, read back from its labels alone (no tuning given)
  const dd = [{ p: 38, t: 0, d: 0.25 }, { p: 38, t: 0.25, d: 0.25 }, { p: 41, t: 0.5, d: 0.5 }, { p: 43, t: 1, d: 0.5 }, { p: 38, t: 1.5, d: 0.25 }, { p: 45, t: 2, d: 2 }, { p: 50, t: 2, d: 2 }];
  const b = trip(dd, { tuning: 'drop-d' });
  const labels = FB.formatTab(b.pl.notes, { tuning: 'drop-d' }).split('\n').map((l) => l.slice(0, 2).trim()).join(' ');
  const noWords = FB.parseTab(FB.formatTab(b.pl.notes, { tuning: 'drop-d' }));
  T.ok(b.same && b.back.tuning === 'drop-d' && labels === 'e B G D A D' && noWords.tuning === 'drop-d', `drop D round-trips, and its labels alone (${labels}) say the tuning`);
  // a shuffle on the triplet grid, and a capo (numbers from the capo, the note's own f from the nut)
  const sh = trip([{ p: 45, t: 0, d: 2 / 3 }, { p: 49, t: 2 / 3, d: 1 / 3 }, { p: 52, t: 1, d: 2 / 3 }, { p: 54, t: 5 / 3, d: 1 / 3 }].map((n) => ({ ...n, t: r4(n.t), d: r4(n.d) })), {});
  T.ok(sh.same && Math.abs(sh.back.step - 1 / 3) < 1e-9 && /One column per 8th-note triplet/.test(sh.text), 'a shuffle round-trips on the 8th-note triplet grid');
  const cp = trip([{ p: 42, t: 0, d: 1 }, { p: 47, t: 1, d: 1 }, { p: 54, t: 2, d: 1 }], { capo: 2 });
  const firstFret = cp.pl.notes.find((n) => n.p === 42);
  T.ok(cp.same && cp.back.capo === 2 && /capo 2/.test(cp.text) && firstFret.f === 2 && /E \|0/.test(cp.text), 'with a capo the numbers count from it (F#2 is 0 at capo 2), the text says capo 2, and it reads back');
  // tab people type: no count line, no = marks: read, with the guess said
  const typed = FB.parseTab('e|-------0---|\nB|-----1-----|\nG|---2-------|\nD|-2---------|\nA|0----------|\nE|-----------|');
  T.ok(typed.notes.map((n) => n.p).join(' ') === '45 52 57 60 64' && typed.guessed && typed.warnings.some((w) => /guess/.test(w)), `tab typed by hand reads (${typed.notes.map((n) => n.p).join(' ')}), and says the lengths are a guess`);
  const bad = FB.parseTab('e|--5--|\nB|--5--|'), none = FB.parseTab('just words');
  T.ok(/expected 6 lines/.test(bad.errors[0] || '') && /no lines of tab/.test(none.errors[0] || ''), `what can't be read says why ("${bad.errors[0]}")`);
}

/* ============================================================================ 2. notes keep their places */
{
  const p = createProject({ tracks: [{ id: 't_g', name: 'Guitar', kind: 'instrument', instrument: { device: 'core.guitar', params: {} }, inserts: [], clips: [], by: 'you' }] });
  const s = createStore(p);
  let r = s.dispatch({ type: 'clip.add', track: 't_g', ref: 'c', clip: { start: 0, length: 8, tuning: 'drop-d', capo: 2, notes: [{ p: 40, t: 0, d: 1, s: 0, f: 2 }, { p: 45, t: 1, d: 1, s: 1, f: 0 }, { p: 50, t: 4, d: 1 }, { p: 52, t: 5, d: 1, s: 'x', f: 1 }] } });
  const cid = r.created.c, c = () => s.clip('t_g', cid);
  const placeOf = (n) => (n.s == null ? '-' : `${n.s}:${n.f}`);
  T.ok(r.ok && c().tuning === 'drop-d' && c().capo === 2 && c().notes.map(placeOf).join(' ') === '0:2 1:0 - -', `clip.add keeps s, f, tuning and capo (a malformed place is dropped): ${c().notes.map(placeOf).join(' ')}`);
  r = s.dispatch({ type: 'notes.set', track: 't_g', clip: cid, notes: [{ id: 'n3', s: 2, f: 0 }] });
  const set = placeOf(c().notes[2]);
  s.undo(); const undone = placeOf(c().notes[2]);
  s.redo(); const redone = placeOf(c().notes[2]);
  const off = s.dispatch({ type: 'notes.set', track: 't_g', clip: cid, notes: [{ id: 'n1', s: null, f: null }] });
  const cleared = placeOf(c().notes[0]);
  s.undo(); const back = placeOf(c().notes[0]);
  T.ok(r.ok && set === '2:0' && undone === '-' && redone === '2:0' && off.ok && cleared === '-' && back === '0:2', 'notes.set sets and clears a place, and undo and redo put back exactly what was there');
  const half = s.dispatch({ type: 'notes.set', track: 't_g', clip: cid, notes: [{ id: 'n2', s: 3 }] });
  T.ok(!half.ok && /s and f go together/.test(half.error), `a place is s and f together ("${(half.error || '').slice(0, 70)}…")`);
  const cs = s.dispatch({ type: 'clip.set', track: 't_g', clip: cid, patch: { tuning: 'open-g', capo: 0 } });
  const after = [c().tuning, c().capo];
  s.undo();
  const badT = s.dispatch({ type: 'clip.set', track: 't_g', clip: cid, patch: { tuning: 'banjo' } });
  T.ok(cs.ok && after[0] === 'open-g' && after[1] === undefined && c().tuning === 'drop-d' && c().capo === 2 && /tuning is one of standard, drop-d/.test(badT.error), 'clip.set changes the tuning and the capo (0: none), undo puts them back, an unknown tuning is refused');
  r = s.dispatch({ type: 'clip.split', track: 't_g', clip: cid, at: 2 });
  const halves = s.get().tracks[0].clips.map((x) => `${x.tuning}/${x.capo}:${x.notes.map(placeOf).join(',')}`).join(' ');
  T.ok(r.ok && halves === 'drop-d/2:0:2,1:0 drop-d/2:2:0,-', `a split keeps the tuning, the capo and every place on both sides: ${halves}`);
  const saved = cleanProject(JSON.parse(JSON.stringify(s.get())));
  const enc = await encodeShare(s.get());
  const shared = cleanProject(listenCopy(await decodeShare(enc.hash), {}).song);
  const look = (q) => q.tracks[0].clips.map((x) => `${x.tuning}/${x.capo}:${x.notes.map(placeOf).join(',')}`).join(' ');
  T.ok(look(saved) === halves && look(shared) === halves, 'a save and load, and a share link, keep them too');
  // the pitch is the truth: a place that no longer plays its note is fingered again; a note with none is fingered
  const pl = FB.placeNotes([{ p: 45, t: 0, s: 1, f: 0 }, { p: 47, t: 1, s: 1, f: 0 }, { p: 50, t: 2 }], { tuning: 'standard' });
  T.ok(pl.notes[0].kept && pl.notes[0].s === 1 && pl.notes[0].f === 0 && !pl.notes[1].kept && FB.placeOk(pl.notes[1], 'standard') && FB.placeOk(pl.notes[2], 'standard'), 'a stored place that plays its pitch is kept; a stale one (the note moved) and a note with none are fingered');
  const low = FB.placeNotes([{ p: 40, t: 0 }], { tuning: 'standard', capo: 3 });
  T.ok(/off the neck in Standard tuning with a capo at the 3rd fret \(G2 to/.test(low.error || '') && low.hint, `a note under the capo says so ("${low.error}")`);
}

/* ============================================================================ 3. the riff writer */
{
  const songs = JAM.JAM_STYLE_IDS.map((id) => ({ name: id, p: JAM.jamTrack({ style: id }).project }));
  songs.push({ name: 'Night Shift', p: demoProject() });
  const problems = [], counts = {};
  let n = 0;
  for (const { name, p } of songs) {
    const tl = JAM.chordTimeline(p);
    for (const sec of p.sections.slice(0, 2)) for (const style of RIFF.RIFF_STYLE_IDS) for (const difficulty of RIFF.DIFFICULTIES) for (const tuning of ['standard', 'drop-d']) {
      const r = RIFF.writeRiff(p, { timeline: tl, section: sec.id, style, difficulty, seed: 3, tuning });
      n++;
      if (r.error) { problems.push(`${name}/${sec.name}/${style}/${difficulty}/${tuning}: ${r.error}`); continue; }
      const c = r.checks;
      counts[style] = (counts[style] || 0) + 1;
      if (!c.inKey) problems.push(`${name} ${style} ${difficulty}: out of key ${c.outside.map((x) => `${x.p}@${x.t}`).join(',')}`);
      if (!c.strong) problems.push(`${name} ${style} ${difficulty}: off a chord tone on a strong beat ${c.offStrong.map((x) => `${x.p}@${x.t}`).join(',')}`);
      if (!c.playable) problems.push(`${name} ${style} ${difficulty}: unplayable ${c.unplayable.map((x) => `${x.p}@${x.t}`).join(',')}`);
      if (!c.oneHand || c.shifts) problems.push(`${name} ${style} ${difficulty}: span ${c.span}, ${c.shifts} shifts`);
      if (!(r.bars >= 1 && r.bars <= 4)) problems.push(`${name} ${style}: ${r.bars} bars`);
      // checked independently of the writer's own checks: in the key's scale, a tone of the chord, or a blues' sweet side
      for (const x of r.notes) {
        const ch = JAM.chordAt(tl, r.start + x.t + 0.01).chord;
        const pc = ((x.p % 12) + 12) % 12;
        if (!RIFF.fitsOver(pc, tl.key, ch)) problems.push(`${name} ${style}: ${x.p} at ${x.t} fits nothing`);
        if (!FB.placeOk(x, tuning)) problems.push(`${name} ${style}: ${x.p} at string ${x.s} fret ${x.f} doesn't play in ${tuning}`);
      }
    }
  }
  T.ok(!problems.length, `${n} riffs over ${songs.length} songs, every style, difficulty and both tunings: in key, chord tones on beats 1 and 3, playable, one hand within four frets${problems.length ? ':\n       ' + problems.slice(0, 6).join('\n       ') : ''}`);
  const ns = demoProject(), tl = JAM.chordTimeline(ns);
  const x1 = RIFF.writeRiff(ns, { timeline: tl, section: 'Verse', style: 'rock', seed: 4 }), x2 = RIFF.writeRiff(ns, { timeline: tl, section: 'Verse', style: 'rock', seed: 4 }), x3 = RIFF.writeRiff(ns, { timeline: tl, section: 'Verse', style: 'rock', seed: 5 });
  T.ok(JSON.stringify(x1.notes) === JSON.stringify(x2.notes) && x1.tab === x2.tab && JSON.stringify(x1.notes) !== JSON.stringify(x3.notes), 'deterministic: the same seed writes the same riff, the next seed another');
  // a motif, repeated and varied: bar 2's rhythm is bar 1's up to its answer, on another chord
  const rhythm = (r, k) => r.notes.filter((x) => x.t >= k * 4 && x.t < (k + 1) * 4).map((x) => r4(x.t - k * 4));
  const b1 = rhythm(x1, 0), b3 = rhythm(x1, 2);
  T.ok(x1.bars === 4 && JSON.stringify(b1) === JSON.stringify(b3) && x1.notes.some((x) => x.t >= 4 && x.t < 8), `a motif comes back: Night Shift's verse (${x1.chords.join(' ')}) gets a ${x1.bars}-bar riff whose 1st and 3rd bars share a rhythm`);
  T.ok(/^Rock 8ths over the Verse, bars 1–4 \(Am7, Fmaj7, C, G7\)/.test(x1.text) && /Every note on beats 1 and 3 is a chord tone/.test(x1.text) && x1.label.length <= 48, `it says what it is and what it checked: "${x1.text.slice(0, 140)}…"`);
  const tk = RIFF.riffTakes(ns, { timeline: tl, section: 'Verse', style: 'rock', seed: 1 }, 3);
  T.ok(tk.takes.length === 3 && new Set(tk.takes.map((x) => x.motif)).size === 3 && new Set(tk.takes.map((x) => x.label)).size === 3, `three takes, three motifs, three labels: ${tk.takes.map((x) => x.label).join('; ')}`);
  const hard = RIFF.writeRiff(JAM.jamTrack({ style: 'blues' }).project, { timeline: JAM.chordTimeline(JAM.jamTrack({ style: 'blues' }).project), style: 'blues', difficulty: 'hard', motif: 'call', seed: 2 });
  T.ok(hard.notes.some((x) => x.bend) && /bend in bar \d+ goes up a whole step/.test(hard.text), `hard adds bends, and the text names them: "${(hard.text.match(/The bend[^.]*|and the bend[^.]*/) || [''])[0]}"`);
  const easy = RIFF.writeRiff(ns, { timeline: tl, section: 'Verse', style: 'funk', difficulty: 'easy', seed: 1 });
  T.ok(easy.notes.every((x) => Math.abs(x.t * 2 - Math.round(x.t * 2)) < 1e-6) && !easy.notes.some((x) => x.bend), 'easy keeps to eighths and leaves bends out');
  const errs = [
    RIFF.writeRiff(ns, { timeline: tl, section: 'Coda' }), RIFF.writeRiff(ns, { timeline: tl, style: 'polka' }), RIFF.writeRiff(ns, { timeline: tl, difficulty: 'insane' }),
    RIFF.writeRiff({ ...ns, meter: [5, 4] }, { timeline: tl }), RIFF.writeRiff(createProject({ key: null }), { timeline: JAM.chordTimeline(createProject({ key: null })) }),
  ];
  T.ok(errs.every((e) => e.error && e.hint) && /no section "Coda"/.test(errs[0].error) && /Verse/.test(errs[0].hint) && /4\/4/.test(errs[3].error) && /no chords/.test(errs[4].error), `what it can't write says why ("${errs[0].error}"; "${errs[4].error}")`);
  const tonic = RIFF.writeRiff(createProject({ key: { root: 'E', scale: 'minor' } }), { timeline: JAM.chordTimeline(createProject({ key: { root: 'E', scale: 'minor' } })), bars: [1, 2], style: 'metal' });
  T.ok(!tonic.error && tonic.chordsTonic && /the key's own chord: no chords are read there/.test(tonic.text), 'a song with a key and no parts gets a riff over the key\'s own chord, and it says so');
}

/* ============================================================================ 4. the judge and the guitar's notes */
{
  const notes = [{ p: 45, t: 0, d: 0.5 }, { p: 48, t: 0.5, d: 0.5 }, { p: 50, t: 1, d: 0.5 }, { p: 52, t: 2, d: 1, bend: [[0, 0], [0.25, 2]] }, { p: 40, t: 3, d: 1 }, { p: 47, t: 3, d: 1 }, { p: 52, t: 3, d: 1 }];
  const gs = PA.groupsOf(notes, { start: 32, bpb: 4 });
  T.ok(gs.length === 5 && gs[4].n === 3 && gs[4].p === 40 && gs[3].bend === 2 && gs[0].bar === 9 && gs[3].beat === 3, 'a part\'s onsets: a chord is one, by its lowest note; bars and beats are the song\'s');
  const mpb = 500;   // 120 BPM
  const f = PA.createFollow(gs, { msPerBeat: mpb });
  const h = (p, beat, src = 'keys', ps = null) => f.hear({ p, beat: 32 + beat, src, ps });
  const r1 = h(45, 0.02), r2 = h(48, 0.5 - 0.2), r3 = h(52, 2 + 0.24), r5 = h(40, 3.01, 'guitar'), r6 = h(47, 3.03, 'guitar');
  f.passed(32 + 5);
  const lone = PA.createFollow(gs, { msPerBeat: mpb }).hear({ p: 47, beat: 35.01, src: 'keys' });
  T.ok(r1.mark === 'hit' && r2.mark === 'early' && r3.mark === 'late' && r5.mark === 'hit' && r6 === null && lone.wrong, `on time is a hit, 100 ms ahead early, 120 ms behind late; a chord is struck by its lowest note (its other strings are part of it, alone they aren't it): ${[r1, r2, r3, r5].map((x) => x.mark).join(', ')}`);
  T.ok(f.marks.get(2).mark === 'missed', 'a note that went by unheard is missed');
  const s1 = f.summary();
  T.ok(s1.line === '2 of 5, the bend in bar 9 is late.', `the line after a pass: "${s1.line}"`);
  const g2 = PA.createFollow(gs, { msPerBeat: mpb });
  const w = g2.hear({ p: 47, beat: 32.51, src: 'keys' });
  g2.hear({ p: 45, beat: 32, src: 'keys' }); g2.hear({ p: 50, beat: 33, src: 'keys' }); g2.hear({ p: 52, beat: 34, src: 'keys' }); g2.hear({ p: 40, beat: 35, src: 'keys' });
  g2.passed(40);
  T.ok(w.wrong && g2.summary().line === '4 of 5, the C on the and of 1 of bar 9 came out as B.', `a wrong note where one was due is named: "${g2.summary().line}"`);
  const flat = PA.groupsOf(notes.filter((x) => !x.bend), { start: 32, bpb: 4 });
  const g3 = PA.createFollow(flat, { msPerBeat: mpb }), g3b = PA.createFollow(flat, { msPerBeat: mpb });
  for (const x of flat) { g3.hear({ p: x.p, beat: x.t + 0.2, src: 'keys' }); g3b.hear({ p: x.p, beat: x.t + 0.08, src: 'keys' }); }
  T.ok(g3.summary().line === '0 of 4, running about 100 ms late.' && g3b.summary().line === '4 of 4, all in time.', `a steady lean is said once ("${g3.summary().line}"), and 40 ms is in time`);
  const g4 = PA.createFollow(gs, { msPerBeat: mpb });
  for (const x of gs) g4.hear({ p: x.p, beat: x.t, src: 'keys' });
  T.ok(g4.summary().line === '5 of 5, all in time.' && PA.matchPitch(gs[0], 57, 'guitar') && !PA.matchPitch(gs[0], 57, 'keys') && PA.matchPitch(gs[0], 43, 'guitar', [43, 45]) && PA.matchPitch(gs[3], 54, 'keys'), 'all in time says so; the guitar\'s octave slips and second candidates count, the keys\' don\'t; a bend counts where it lands');
  // the guitar: plucked strings (Karplus-Strong) at known times and pitches, read by the note finder
  const sr = 48000;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };
  const pluck = (buf, midi, t, dur) => {
    const N = Math.round(sr / (440 * Math.pow(2, (midi - 69) / 12))), line = new Float32Array(N);
    for (let i = 0; i < N; i++) line[i] = rnd() * 0.4;
    let k = 0;
    const a = Math.round(t * sr), b = Math.min(buf.length, a + Math.round(dur * sr));
    for (let i = a; i < b; i++) { const y = line[k]; line[k] = 0.5 * (y + line[(k + 1) % N]) * 0.996; k = (k + 1) % N; buf[i] += y * (i > b - 480 ? (b - i) / 480 : 1); }
  };
  const want = [[40, 0.3], [45, 0.8], [52, 1.25], [55, 1.6], [57, 2.0], [64, 2.4], [69, 2.7], [76, 3.0], [47, 3.4], [43, 3.9]];
  const buf = new Float32Array(sr * 5);
  for (const [m, t] of want) pluck(buf, m, t, 0.45);
  for (let i = 0; i < buf.length; i++) buf[i] += rnd() * 0.0005;
  const nf = createNoteFinder({ sr }), got = [];
  for (let i = 0; i < buf.length; i += 2048) got.push(...nf.push(buf.subarray(i, i + 2048), 1000 + i));
  const onTime = want.every(([, t]) => got.some((e) => Math.abs((e.f - 1000) / sr - t) < 0.006));
  const heard = want.every(([m, t]) => got.some((e) => Math.abs((e.f - 1000) / sr - t) < 0.006 && (e.p === m || e.ps.includes(m))));
  T.ok(got.length === want.length && onTime && heard, `the guitar's notes: ${got.length} onsets for ${want.length} plucks, each within 6 ms, each pitch heard (first, or among its candidates while the string before still rings)`);
  const b2 = new Float32Array(sr * 2);
  pluck(b2, 52, 0.2, 0.4);
  for (let i = Math.round(0.6 * sr); i < Math.round(1.2 * sr); i++) { const t = (i - 0.6 * sr) / sr; b2[i] += 0.12 * Math.exp(-t * 3) * (Math.sin(2 * Math.PI * 185 * t) + 0.5 * Math.sin(2 * Math.PI * 370 * t)); }
  const nf2 = createNoteFinder({ sr }), g5 = [];
  for (let i = 0; i < b2.length; i += 2048) g5.push(...nf2.push(b2.subarray(i, i + 2048), i));
  T.ok(g5.length === 2 && g5[1].legato && g5[1].p === 54 && Math.abs(g5[1].f / sr - 0.6) < 0.06, `a new pitch with no attack (a hammer-on) is a note too: ${g5.map((e) => `${e.p}${e.legato ? ' legato' : ''}`).join(', ')}`);
}

/* ============================================================================ 5-8. in the page */
const boot = async (opts = {}) => {
  const s = await open('/app/', { query: 'demo', ...opts });
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await s.page.waitForFunction(() => !!window.overdub.jam?.rigs && !!window.overdub.tabs, null, { timeout: 20000 });
  await s.page.evaluate(() => document.querySelector('.ar-welcome-x')?.click());
  await s.page.waitForTimeout(300);
  return s;
};
// warm pixels (the --human ink) in a box on the lane's canvas, around a note's place
const warmIn = (page, t, s, half = 9) => page.evaluate(([t, s, half]) => {
  const lane = window.overdub.tabs, cv = document.querySelector('.tb-cv'), g = cv.getContext('2d');
  const geo = lane.geometry, dpr = cv.width / geo.W;
  const x = geo.xOf(t), y = geo.yOf(s);
  const human = getComputedStyle(document.documentElement).getPropertyValue('--human').trim();
  const m = /#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(human) || [];
  const hr = parseInt(m[1], 16), hg = parseInt(m[2], 16), hb = parseInt(m[3], 16);
  const d = g.getImageData(Math.round((x - half) * dpr), Math.round((y - half) * dpr), Math.round(2 * half * dpr), Math.round(2 * half * dpr)).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - hr) < 40 && Math.abs(d[i + 1] - hg) < 40 && Math.abs(d[i + 2] - hb) < 40) n++;
  return n;
}, [t, s, half]);
if (process.env.NODE_ONLY !== '1') {
  const { page, errors, close } = await boot();
  const E = (fn, arg) => page.evaluate(fn, arg);
  // (the pictures leave out the toasts, so the lane under them shows)
  const clearToasts = () => E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  const shot = async (n) => { await clearToasts(); await page.screenshot({ path: path.join(OUTDIR, `tabs-${n}.png`) }); };
  const run = (name, input, by = 'mcp:test') => E(([n, i, b]) => window.overdub.tools.run(n, i, { by: b }), [name, input, by]);
  // the tab lane's API exposes the lane's geometry through the room's mount
  await page.click('#ew-tab-jam');
  await sleep(700);
  await E(() => { window.overdub.transport.click.set({ on: false }); window.overdub.input.recorder.setCountIn(0); });

  // ---- the lane: under the stage, above the neck; empty until there's a part
  const order = await E(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { stage: r('.jm-stage').bottom, lane: r('.tb').top, laneB: r('.tb').bottom, neck: r('.jm-neck').top }; });
  T.ok(order.lane >= order.stage - 1 && order.laneB <= order.neck + 1, 'the tab lane sits under the stage and above the neck');
  const empty = await E(() => { const tb = document.querySelector('.tb'), r = tb.getBoundingClientRect(); return { h: Math.round(r.height), text: tb.querySelector('.tb-title').textContent, none: tb.classList.contains('tb-blank'), go: !!tb.querySelector('.tb-suggest')?.getClientRects().length, practice: !!tb.querySelector('.tb-practice')?.getClientRects().length }; });
  T.ok(empty.none && empty.h <= 50 && empty.go && !empty.practice && /^No tab yet: suggest a riff for the Verse, or record one with R\.$/.test(empty.text), `with no riff and no tab part the lane is one line (${empty.h} px), saying what to do: "${empty.text}"`);

  // ---- Suggest a riff: the house writer's three takes, the first on the lane
  const h0 = await E(() => window.overdub.store.history.length);
  await page.click('.tb-suggest');
  await sleep(500);
  // (the room's new Keys guitar has its level measured: wait for it, so its step doesn't land after the Keep below)
  await E(() => window.overdub.jam.levelled);
  const tk = await E(() => { const t = window.overdub.tabs, s = t.state.takes; return { n: s?.items.length, from: s?.from, letters: [...document.querySelectorAll('.tb-take .tb-letter')].map((x) => x.textContent).join(''), shows: t.describe().shows, line: document.querySelector('.tb-line').textContent, keys: window.overdub.jam.guitars().keys?.name, h: window.overdub.store.history.length, clips: window.overdub.jam.guitars().keys?.clips.length, since: window.overdub.store.history.slice(-2).map((t) => t.label) }; });
  T.ok(tk.n === 3 && tk.from === 'house' && tk.letters === 'ABC' && /^Take A: /.test(tk.shows) && /3 riffs from the house riff writer/.test(tk.line), `Suggest a riff: three takes from the house riff writer, take A on the lane ("${tk.shows}")`);
  const opened = await E(() => { const tb = document.querySelector('.tb'); return { none: tb.classList.contains('tb-blank'), h: Math.round(tb.getBoundingClientRect().height), staff: !!tb.querySelector('.tb-scroll')?.getClientRects().length }; });
  T.ok(!opened.none && opened.staff && opened.h > 150, `with a riff to show, the lane opens up to its staff and practice (${opened.h} px)`);
  // (its level is one step with it when the renders are quick, its own step when they aren't)
  const steps = tk.h - h0, made = tk.since.slice(-steps);
  T.ok(tk.keys === 'Keys guitar' && tk.clips === 0 && steps >= 1 && steps <= 2 && /^add Keys guitar for the keys$/.test(made[0] || '') && (steps === 1 || /^Keys guitar: level [+-]?[\d.]+ dB, measured against the song$/.test(made[1] || '')), `nothing of the riffs is in the song yet: only the room's Guitar track for the keys, made so a take plays through the rig (${made.join('; ')})`);
  await shot('takes');

  // ---- Hold to hear: the take plays on the Guitar track, as a preview; let go and it's gone
  const box = await E(() => { const r = document.querySelector('.tb-take[data-i="1"] .tb-hold').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await sleep(700);
  const heldNow = await E(() => ({ clips: window.overdub.jam.guitars().keys.clips.length, playing: window.overdub.engine.playing, hist: window.overdub.store.history.length, label: document.querySelector('.tb-take[data-i="1"] .tb-hold').textContent, shows: window.overdub.tabs.describe().shows }));
  await page.mouse.up();
  await page.waitForFunction(() => !window.overdub.engine.playing && window.overdub.jam.guitars().keys.clips.length === 0, null, { timeout: 4000 }).catch(() => {});
  const letGo = await E(() => ({ clips: window.overdub.jam.guitars().keys.clips.length, playing: window.overdub.engine.playing, hist: window.overdub.store.history.length }));
  T.ok(heldNow.clips === 1 && heldNow.playing && heldNow.label === 'Hearing B' && /^Take B/.test(heldNow.shows) && heldNow.hist === tk.h, `Hold to hear plays take B on the Guitar track (a preview, nothing in History): "${heldNow.label}"`);
  T.ok(letGo.clips === 0 && !letGo.playing && letGo.hist === tk.h, `letting go takes it back out and stops${letGo.clips === 0 && !letGo.playing && letGo.hist === tk.h ? '' : ` (clips ${letGo.clips}, playing ${letGo.playing}, history ${letGo.hist} of ${tk.h})`}`);
  // a quick tap: let go before the transport has even started, and it still stops
  const tap = await E(async () => { const t = window.overdub.tabs; t.hold(2, true); t.hold(2, false); await new Promise((r) => setTimeout(r, 1200)); return { clips: window.overdub.jam.guitars().keys.clips.length, playing: window.overdub.engine.playing }; });
  T.ok(tap.clips === 0 && !tap.playing, `a tap on Hold to hear lets go cleanly too (clips ${tap.clips}, playing ${tap.playing})`);

  // ---- Another: three new riffs (the next seeds), not the same notes
  const before = await E(() => window.overdub.tabs.state.takes.items.map((x) => x.riff.notes.map((n) => `${n.p}@${n.t}`).join(' ')));
  await page.click('.tb-another');
  await sleep(300);
  const after = await E(() => ({ notes: window.overdub.tabs.state.takes.items.map((x) => x.riff.notes.map((n) => `${n.p}@${n.t}`).join(' ')), seed: window.overdub.tabs.state.takes.seed }));
  T.ok(after.notes.length === 3 && after.seed === 4 && after.notes.every((x) => !before.includes(x)), `Another writes three more from the next seeds (seed ${after.seed}), none of them the same`);

  // ---- Keep: the riff lands on the Guitar track, notes with their places, signed by the house, kept by you
  await page.click('.tb-take[data-i="0"] .tb-take-pick');
  const label0 = await E(() => window.overdub.tabs.state.takes.items[0].label);
  await page.click('.tb-keep');
  await sleep(400);
  const kept = await E(() => {
    const o = window.overdub, g = o.jam.guitars().keys, c = g.clips[0], last = o.store.history[o.store.history.length - 1];
    return { n: c?.notes.length, places: c?.notes.every((n) => Number.isInteger(n.s) && Number.isInteger(n.f)), tuning: c?.tuning, by: c?.by, label: last.label, keptBy: last.keptBy, takes: o.tabs.state.takes, shows: o.tabs.describe().shows, start: c?.start };
  });
  T.ok(kept.n > 8 && kept.places && kept.tuning === 'standard' && kept.by === 'overdub' && kept.label === `Riff: ${label0}` && kept.keptBy === 'you' && kept.start === 0, `Keep puts the riff on the Guitar track: ${kept.n} notes with their strings and frets, the tuning, the house's signature, kept by you ("${kept.label}")`);
  T.ok(!kept.takes && /^Keys guitar, Riff, Rock 8ths, bars 1–4$/.test(kept.shows), `and the lane shows it from the song now ("${kept.shows}")`);
  const undone = await E(() => { const o = window.overdub; o.store.undo(); const n = o.jam.guitars().keys?.clips.length || 0; o.store.redo(); return { n, back: o.jam.guitars().keys.clips.length }; });
  T.ok(undone.n === 0 && undone.back === 1, 'one undo takes the riff out, redo puts it back');

  // ---- Loop the riff, play: the lane follows the playhead, the note now lit, the neck too
  await page.click('.tb-loop');
  const lp = await E(() => ({ loop: window.overdub.store.get().loop, label: window.overdub.store.history[window.overdub.store.history.length - 1].label, pressed: document.querySelector('.tb-loop').getAttribute('aria-pressed') }));
  T.ok(lp.loop.on && lp.loop.start === 0 && lp.loop.end === 16 && lp.label === 'loop the riff, bars 1–4' && lp.pressed === 'true', 'Loop the riff loops its bars, one step by you');
  await E(() => window.overdub.transport.playStop());
  await page.waitForFunction(() => window.overdub.engine.playing && window.overdub.engine.beat > 1.2, null, { timeout: 8000 });
  const follow = await E(async () => {
    const o = window.overdub, out = [];
    for (let k = 0; k < 4; k++) {
      await new Promise((r) => setTimeout(r, 330));
      const beat = o.engine.beat, geo = o.tabs.geometry, cv = document.querySelector('.tb-cv'), g = cv.getContext('2d'), dpr = cv.width / geo.W;
      // the playhead's column, under the bottom string (where nothing else is drawn): leader green
      const x = geo.xOf(beat), y = geo.yOf(0) + 5;
      let best = 0;
      for (let dx = -10; dx <= 10; dx++) { const d = g.getImageData(Math.round((x + dx) * dpr), Math.round(y * dpr), 1, 1).data; best = Math.max(best, d[1] - d[2]); }
      const part = o.tabs.part(), now = part.notes.filter((n) => beat >= part.start + n.t - 0.06 && beat < part.start + n.t + Math.max(0.12, n.d) + 0.06).map((n) => `${n.s}:${n.f}`);
      const neck = (o.jam.state.tabNow || []).map((x) => `${x.s}:${x.f}`);
      out.push({ beat, green: best, nowOk: !neck.length || neck.every((k2) => now.includes(k2)) });
    }
    return out;
  });
  T.ok(follow.every((f) => f.green > 60) && follow.every((f) => f.nowOk), `the lane's playhead follows the transport (beats ${follow.map((f) => f.beat.toFixed(2)).join(', ')}), and the neck lights the riff's note sounding now`);

  // ---- feedback, from a fake pitch stream on the song's beats: hit, early, late, and the rest unheard
  const gs = await E(() => window.overdub.tabs.part().groups.map((g) => ({ i: g.i, t: g.t, p: g.p, s: null })));
  const nPasses = await E(() => window.overdub.tabs.passes.length);
  await page.waitForFunction(() => window.overdub.engine.beat < 1, null, { timeout: 20000 });   // (the start of a pass)
  const fed = await E(async (gs) => {
    const o = window.overdub, mpb = 60000 / o.store.get().tempo, plan = [[0, 0], [1, -110 / mpb], [2, 120 / mpb]];   // a hit, early, late
    const out = [];
    for (const [k, off] of plan) {
      const g = gs[k];
      while (o.engine.beat < g.t + Math.max(0, off) + 0.05) await new Promise((r) => setTimeout(r, 15));
      out.push(o.tabs.hear({ p: g.p, beat: g.t + off, src: 'guitar' }));
    }
    return out;
  }, gs);
  await sleep(250);
  const marks = await E(() => [...window.overdub.tabs.follow.marks].map(([i, m]) => `${i}:${m.mark}`).join(' '));
  T.ok(fed.map((x) => x?.mark).join(' ') === 'hit early late', `heard notes are judged: ${fed.map((x) => `${x?.mark} (${x?.ms} ms)`).join(', ')}`);
  // warm where it was hit, a ring where early or late, plain where missed
  const parts = await E(() => { const pt = window.overdub.tabs.part(); return pt.notes.map((n) => ({ t: pt.start + n.t, s: n.s })); });
  const w0 = await warmIn(page, parts[0].t, parts[0].s), w1 = await warmIn(page, parts[1].t, parts[1].s, 13), w4 = await warmIn(page, parts[4].t, parts[4].s);
  T.ok(w0 > 6 && w1 > 6 && w4 === 0, `the lane marks them: warm on the hit (${w0} px), a warm ring on the early one (${w1} px), nothing on one that went by (${w4} px): ${marks.split(' ').slice(0, 6).join(' ')}`);
  await shot('desktop-playing');
  // the pass ends at the loop's wrap: the line says how it went
  await page.waitForFunction((n) => window.overdub.tabs.passes.length > n, nPasses, { timeout: 20000 });
  const pass = await E(() => ({ p: window.overdub.tabs.passes[window.overdub.tabs.passes.length - 1], line: document.querySelector('.tb-line').textContent }));
  T.ok(pass.p.hit === 1 && pass.p.early === 1 && pass.p.late === 1 && /^1 of \d+, /.test(pass.line) && pass.line === pass.p.line, `after the pass, a quiet line: "${pass.line}"`);
  await shot('desktop-pass');
  // musical typing: the keys play along too
  await page.waitForFunction(() => window.overdub.engine.beat < 1.5, null, { timeout: 20000 });
  const typed = await E(async (gs) => {
    const o = window.overdub, g = gs.find((x) => x.t >= 2) || gs[3];
    while (o.engine.beat < g.t - 0.02) await new Promise((r) => setTimeout(r, 4));
    o.input.noteOn('test', g.p, 0.8, 'qwerty');
    await new Promise((r) => setTimeout(r, 120));
    o.input.noteOff('test', g.p, 'qwerty');
    return { i: g.i, mark: o.tabs.follow.marks.get(g.i) };
  }, gs);
  T.ok(typed.mark && ['hit', 'early', 'late'].includes(typed.mark.mark) && Math.abs(typed.mark.ms) < 150, `musical typing is heard the same way: ${typed.mark?.mark} (${typed.mark?.ms} ms)`);
  await E(() => window.overdub.transport.playStop());
  await sleep(300);

  // ---- Learn it: the transport waits on each note until it's played, then moves on
  await page.click('.tb-learn');
  await E(() => window.overdub.transport.marker.set(0));
  await page.click('.tb-play');
  await page.waitForFunction(() => window.overdub.tabs.learning.waiting, null, { timeout: 12000 });
  const w1s = await E(() => ({ l: window.overdub.tabs.learning, playing: window.overdub.engine.playing, hushed: window.overdub.engine.hushed, line: document.querySelector('.tb-line').textContent, clip: window.overdub.tabs.part().clipId }));
  const g0 = gs[0], g1 = gs[1];
  T.ok(!w1s.playing && w1s.l.i === 0 && Math.abs(w1s.l.at - g0.t) < 1e-6 && w1s.hushed.includes(w1s.clip) && /^Waiting on the (chord on beat 1 of bar 1 \(its lowest note, )?[A-G][#b]?: (open|\d+(st|nd|rd|th) fret), /.test(w1s.line), `Learn it: the song stops at the first note and waits, the riff itself silent ("${w1s.line}")`);
  const wrong = await E((p) => window.overdub.tabs.hear({ p: p + 1, src: 'keys' }), g0.p);
  await sleep(300);
  const still = await E(() => ({ waiting: window.overdub.tabs.learning.waiting, playing: window.overdub.engine.playing, line: document.querySelector('.tb-line').textContent }));
  T.ok(wrong.wrong && still.waiting && !still.playing && /^That was .+\. Waiting on/.test(still.line), `a wrong note doesn't move it: "${still.line}"`);
  await E((p) => { window.overdub.input.noteOn('test', p, 0.8, 'qwerty'); window.overdub.input.noteOff('test', p, 'qwerty'); }, g0.p);
  await page.waitForFunction(() => window.overdub.tabs.learning.i === 1, null, { timeout: 4000 }).catch(() => {});
  const moved = await E(() => ({ l: window.overdub.tabs.learning, playing: window.overdub.engine.playing || window.overdub.engine.starting }));
  await page.waitForFunction((t) => window.overdub.tabs.learning.waiting && Math.abs(window.overdub.tabs.learning.at - t) < 1e-6, g1.t, { timeout: 8000 }).catch(() => {});
  const next = await E(() => window.overdub.tabs.learning);
  T.ok(moved.l.i === 1 && moved.playing && next.waiting && Math.abs(next.at - g1.t) < 1e-6, `the right note moves it on, and it waits again at the next one (beat ${next.at})`);
  await page.click('.tb-learn');
  const freed = await E(() => window.overdub.engine.hushed.length);
  T.ok(freed === 0, 'Learn it off: the riff is heard again');
  await E(() => { if (window.overdub.engine.playing) window.overdub.transport.playStop(); });

  // ---- Copy tab: the text, as a guitarist reads it
  const txt = await E(() => window.overdub.tabs.text());
  const back = FB.parseTab(txt);
  T.ok(/^Keys guitar, Riff, Rock 8ths, bars 1–4\. Standard tuning \(E A D G B E\), 92 BPM\./.test(txt) && back.notes.length === kept.n && /One column per 16th/.test(txt), `Copy tab copies the riff as text that reads back (${back.notes.length} notes): "${txt.split('\n')[0]}"`);
  await page.click('.tb-copy');
  await sleep(300);
  const toast = await E(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '));
  T.ok(/Tab copied: bars 1–4, Standard tuning|clipboard/.test(toast), `Copy tab says what it copied ("${toast.slice(0, 80)}")`);

  // ---- the tools: tab_for
  const tf = await run('tab_for', { track: 'Keys guitar' });
  T.ok(tf.tab && /Standard tuning/.test(tf.tab) && tf.notes.length === kept.n && tf.notes.every((n) => n.string >= 1 && n.string <= 6 && n.fret >= 0 && n.bar >= 1 && n.beat >= 1) && tf.fingering.places_kept === kept.n && tf.grid === 'one column per 16th', `tab_for reads the part back: ${tf.notes.length} notes with string, fret, bar and beat, its places kept (${tf.fingering.places_kept})`);
  const tfb = await run('tab_for', { track: 'Hook' });
  T.ok(tfb.tab && tfb.fingering.places_fingered === tfb.notes.length, `a part with no places (the Hook) is fingered: ${tfb.notes.length} notes, ${tfb.fingering.position}`);
  const te = await Promise.all([run('tab_for', {}), run('tab_for', { track: 'Nope' }), run('tab_for', { track: 'Guitar' }), run('tab_for', { track: 'Drums' })]);
  T.ok(/missing "track"/.test(te[0].error) && /no track/.test(te[1].error) && /tracks:/.test(te[1].hint) && /audio track/.test(te[2].error) && /drum track/.test(te[3].error), `tab_for's errors say what would work ("${te[2].error}"; "${te[3].error}")`);

  // ---- write_tab: free bars land as a clip; bars with notes go to the person as a card
  const RIFF_TAB = `  |1e+a2e+a3e+a4e+a|1e+a2e+a3e+a4e+a|
e |----------------|----------------|
B |----------------|----------------|
G |--------2===----|----------------|
D |----2=3=----2=0=|2=======--------|
A |0===--------3=--|----------------|
E |----------------|----------------|`;
  const wt = await run('write_tab', { tab: RIFF_TAB, at_bar: 5, name: 'Chorus riff', reason: 'a riff for the chorus' });
  const wtc = await E((id) => { const f = window.overdub.store.findClip(id); return f ? { track: f.track.name, start: f.clip.start, by: f.clip.by, n: f.clip.notes.length, places: f.clip.notes.map((n) => `${n.s}:${n.f}`).join(' '), shows: window.overdub.tabs.describe().shows } : null; }, wt.clip?.id);
  T.ok(wt.ok && wt.landed === 'clip' && wtc && wtc.track === 'Keys guitar' && wtc.start === 16 && wtc.by === 'mcp:test' && wtc.n === 8 && wtc.places.startsWith('1:0 2:2') && wt.bars.join('-') === '5-6', `write_tab puts it in free bars as a clip with its places, signed by the agent: ${wtc?.n} notes at bar 5 (${wtc?.places})`);
  T.ok(/Chorus riff, bars 5–6/.test(wtc.shows) && /tab lane shows it/.test(wt.shown), `the lane shows what landed ("${wtc.shows}")`);
  const wc = await run('write_tab', { tab: RIFF_TAB, at_bar: 1 });
  const card = await E((id) => { const o = window.overdub, r = o.tools.requests.get(id); return { keep: !!r?.keep, fine: r?.keep?.fine, lane: o.tabs.state.takes?.from, by: o.tabs.state.takes?.by, panel: !!document.querySelector(`.ag-asks[data-id="${id}"]`), clips: o.jam.guitars().keys.clips.length }; }, wc.id);
  T.ok(wc.offered && wc.status === 'pending' && wc.landed === 'card' && /replace what's in bars 1–2 on Keys guitar/.test(wc.why) && card.lane === 'agent' && card.by === 'mcp:test' && /would replace/.test(card.fine) && card.clips === 2, `over notes it changes nothing and goes to the person as a card ("${wc.why}"), shown on the lane too`);
  await page.click('.tb-keep');
  await sleep(400);
  const wk = await run('get_variation_result', { id: wc.id });
  const wkc = await E(() => { const g = window.overdub.jam.guitars().keys; return { clips: g.clips.map((c) => `${c.start}:${c.by}:${c.notes.length}`).join(' '), shows: window.overdub.tabs.describe().shows }; });
  T.ok(wk.kept === true && /^0:mcp:test:8/.test(wkc.clips) && /Riff, bars 1–2/.test(wkc.shows), `Keep on the lane keeps it: the agent's riff replaces bars 1–2, the rest of the house riff after it (${wkc.clips})`);
  const wp = await run('write_tab', { tab: RIFF_TAB, at_bar: 7, mode: 'propose' });
  T.ok(wp.offered && wp.landed === 'card' && wp.why === 'mode propose', 'mode propose makes a card even in free bars');
  await E((id) => window.overdub.tools.answer(id, -1), wp.id);
  // a song from a link: free bars still take an add; bars with notes wait for the person
  const linked = await E(async (tab) => {
    const o = window.overdub; o.share.listening = true;
    try {
      const a = await o.tools.run('write_tab', { tab, at_bar: 7 }, { by: 'mcp:test' });
      const b = await o.tools.run('write_tab', { tab, at_bar: 1 }, { by: 'mcp:test' });
      return { a: { ok: a.ok, landed: a.landed }, b: { offered: b.offered, landed: b.landed } };
    } finally { o.share.listening = false; }
  }, RIFF_TAB);
  T.ok(linked.a.ok && linked.a.landed === 'clip' && linked.b.offered && linked.b.landed === 'card', 'on a song from a link, a riff in free bars lands (an add), one over notes waits on a card');
  await E(() => { for (const r of window.overdub.tools.requests.values()) if (r.status === 'pending') window.overdub.tools.answer(r.id, -1); });
  const we = await Promise.all([run('write_tab', { tab: 'nothing like tab', at_bar: 1 }), run('write_tab', { tab: RIFF_TAB }), run('write_tab', { tab: RIFF_TAB, at_bar: 1, track: 'Guitar' }), run('write_tab', { tab: RIFF_TAB, at_bar: 1, tuning: 'banjo' }), run('write_tab', { tab: RIFF_TAB.split('\n').slice(0, 4).join('\n'), at_bar: 1 })]);
  T.ok(/can't read the tab: no lines of tab/.test(we[0].error) && /six lines/.test(we[0].hint) && /at_bar/.test(we[1].error) && /audio track/.test(we[2].error) && /no tuning "banjo"/.test(we[3].error) && /expected 6 lines/.test(we[4].error), `write_tab's errors say what would work ("${we[0].error}"; "${we[4].error}")`);

  // ---- suggest_riff: the house writer's riffs as takes, on the Agent tab's card and the lane
  const sr = await run('suggest_riff', { section: 'Chorus', style: 'funk', takes: 3, reason: 'riffs for the chorus' });
  // the pane draws the card on its next frame (a busy machine runs a few behind)
  await page.waitForFunction((id) => document.querySelectorAll(`.ag-vars[data-id="${id}"] .ag-letter.num`).length >= 3, sr.id, { timeout: 5000 }).catch(() => {});
  const srs = await E((id) => {
    const o = window.overdub, r = o.tools.requests.get(id);
    // the letters each take goes by, on the lane and on the Agent tab's card, by label
    const lane = (o.tabs.state.takes?.items || []).map((x) => `${x.letter}:${x.label}`).sort().join(' | ');
    const card = [...document.querySelectorAll(`.ag-vars[data-id="${id}"] .ag-take`)].filter((el) => el.querySelector('.ag-letter.num')).map((el) => `${el.querySelector('.ag-letter.num').textContent.trim()}:${el.querySelector('.ag-take-h b')?.textContent}`).sort().join(' | ');
    return { cards: r?.cards.length, lane: o.tabs.state.takes?.from, n: o.tabs.state.takes?.items.length, letters: (o.tabs.state.takes?.items || []).map((x) => x.letter).join(''), laneBy: lane, cardBy: card };
  }, sr.id);
  T.ok(sr.status === 'pending' && sr.takes.length === 3 && sr.takes.every((x) => x.tab.split('\n').length >= 7 && x.text) && sr.bars.join('-') === '5-8' && sr.style === 'funk' && /house riff writer/.test(sr.from) && sr.next_seed === 4, `suggest_riff offers three riffs for the Chorus as tab (${sr.takes.map((x) => x.label).join('; ')})`);
  T.ok(srs.cards === 4 && srs.lane === 'agent' && srs.n === 3, 'they are takes on a card (and "as it was"), and on the lane');
  T.ok(srs.letters === 'ABC' && srs.laneBy === srs.cardBy, `each take has the same letter on the lane as on the Agent tab's card (${srs.letters.split('').join(', ')})${srs.laneBy === srs.cardBy ? '' : `: lane ${srs.laneBy}; card ${srs.cardBy}`}`);
  await shot('agent-takes');
  await page.click('.tb-take[data-i="1"] .tb-take-pick');
  await page.click('.tb-keep');
  await sleep(400);
  const srk = await run('get_variation_result', { id: sr.id });
  const srkc = await E(() => { const o = window.overdub, c = o.jam.guitars().keys.clips.find((x) => x.start === 16); return c ? { by: c.by, name: c.name, places: c.notes.every((n) => Number.isInteger(n.s)) } : null; });
  T.ok(srk.picked && srk.index >= 0 && srkc && srkc.by === 'mcp:test' && /^Riff, Funk 16ths$/.test(srkc.name) && srkc.places, `keeping one on the lane lands it, signed by the agent that offered it ("${srkc?.name}")`);
  const se = await Promise.all([run('suggest_riff', { section: 'Coda' }), run('suggest_riff', { style: 'polka' }), run('suggest_riff', { takes: 7 }), run('suggest_riff', { difficulty: 'brutal' })]);
  T.ok(/no section "Coda"/.test(se[0].error) && /Verse, Chorus/.test(se[0].hint) && /no riff style/.test(se[1].error) && /blues/.test(se[1].hint) && /takes: 2 to 4/.test(se[2].error) && /no difficulty/.test(se[3].error), `suggest_riff's errors say what would work ("${se[0].error}"; "${se[1].error}")`);
  // recording: the Guitar track is being written, so a riff waits
  await E(() => { const o = window.overdub; o.transport.marker.set(0); o.ui.select({ track: o.jam.guitars().keys.id }); });
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.overdub.input.recorder.state === 'rec', null, { timeout: 8000 });
  const rec = await Promise.all([run('write_tab', { tab: RIFF_TAB, at_bar: 7 }), run('suggest_riff', {})]);
  await E(() => window.overdub.input.recorder.cancel ? window.overdub.input.recorder.cancel() : window.overdub.input.recorder.stop());
  await sleep(500);
  T.ok(rec[0].error === 'recording' && rec[1].error === 'recording' && /recording/.test(rec[0].hint), `while the person records on the Guitar track, write_tab and suggest_riff are refused ("${rec[0].hint.slice(0, 60)}…")`);

  // ---- the demo agent: "give me a riff for the chorus" is the house writer's riffs, and it says so
  await E(() => { window.overdub.agent.useMock(true); });
  await E(() => window.overdub.ui.emit('agent:compose', { text: 'give me a riff for the chorus', send: true }));
  await page.waitForFunction(() => [...window.overdub.tools.requests.values()].some((r) => r.riff && r.status === 'pending' && r.by === 'claude'), null, { timeout: 30000 });
  await sleep(1200);
  const mock = await E(() => ({ text: [...document.querySelectorAll('.ag-agent .ag-text')].map((x) => x.textContent).join(' '), lane: window.overdub.tabs.state.takes?.from, by: window.overdub.tabs.state.takes?.by }));
  T.ok(/riffs for the chorus/.test(mock.text) && /from the house riff writer: a seeded program in the studio, not me/.test(mock.text) && mock.lane === 'agent' && mock.by === 'claude', `the demo agent answers with the house writer's riffs as takes and says whose they are: "${(mock.text.match(/Here are[^.]*\.[^.]*\./) || [''])[0].slice(0, 160)}"`);
  await E(() => { for (const r of window.overdub.tools.requests.values()) if (r.status === 'pending') window.overdub.tools.answer(r.id, -1); window.overdub.agent.stop(); window.overdub.agent.useMock(false); });

  // ---- the Notes panel's Tab view: the clip as tab, the same notes; pick a fret, change string, type a fret
  const STD = [40, 45, 50, 55, 59, 64], AMIN = new Set([9, 11, 0, 2, 4, 5, 7]);
  const noteNow = (id) => E((id) => { const o = window.overdub, c = o.store.findClip(o.ui.state.selection.clip).clip, n = c.notes.find((x) => x.id === id); return { p: n.p, s: n.s, f: n.f, by: n.by, h: o.store.history.length, label: o.store.history[o.store.history.length - 1].label, msg: document.querySelector('.prt-msg').textContent }; }, id);
  // (the Guitar track's longest clip: the riff kept from the lane, or the tab write_tab put there)
  await E(() => { const o = window.overdub; if (o.engine.playing) o.transport.playStop(); const g = o.jam.guitars().keys, c = g.clips.filter((x) => x.kind === 'notes').sort((a, b) => b.notes.length - a.notes.length)[0]; o.ui.select({ track: g.id, clip: c.id, notes: [] }); o.ui.show('pianoroll'); });
  await sleep(500);
  const tv = await E(() => { const o = window.overdub, pt = o.pianoroll.tab.part(); return { on: o.pianoroll.tabOn(), cls: document.querySelector('.pr').classList.contains('pr-istab'), shown: getComputedStyle(document.querySelector('.prt')).display, n: pt?.notes.length, placed: pt?.notes.every((n) => Number.isInteger(n.s)), pressed: document.querySelector('.pr-tabbtn').getAttribute('aria-pressed'), pos: document.querySelector('.prt-pos').textContent }; });
  T.ok(tv.on && tv.cls && tv.shown === 'flex' && tv.pressed === 'true' && tv.n >= 6 && tv.placed, `a part written as tab opens in Notes as tab: ${tv.n} notes on strings ("${tv.pos}")`);
  const pick = await E((T) => {
    const o = window.overdub, pt = o.pianoroll.tab.part();
    const free = (n) => n.s < 5 && n.p - T[n.s + 1] >= 0 && !pt.notes.some((x) => x !== n && x.s === n.s + 1 && x.t < n.t + Math.max(0.06, n.d) && n.t < x.t + Math.max(0.06, x.d));
    const n = pt.notes.find(free);
    if (n) document.querySelector('.prt-scroll').scrollLeft = Math.max(0, o.pianoroll.tab.at(n.id).x - document.querySelector('.prt-scroll').getBoundingClientRect().left - 200);
    return n ? { id: n.id, p: n.p, s: n.s, f: n.f } : null;
  }, STD);
  const pickAt = await E((id) => window.overdub.pianoroll.tab.at(id), pick.id);
  await page.mouse.click(pickAt.x, pickAt.y);
  await sleep(150);
  const picked = await E(() => ({ sel: [...(window.overdub.ui.state.selection.notes || [])], line: document.querySelector('.prt-sel').textContent }));
  T.ok(picked.sel.length === 1 && picked.sel[0] === pick.id && /^[A-G][#b]?-?\d: (open|\d+(st|nd|rd|th) fret), .*string\.$/.test(picked.line), `a click on a fret number picks its note, in the roll's selection too ("${picked.line}")`);
  await page.keyboard.press('ArrowUp');
  await sleep(150);
  const up = await noteNow(pick.id);
  T.ok(up.p === pick.p && up.s === pick.s + 1 && up.f === pick.p - STD[pick.s + 1] && up.by === 'you', `↑ moves it to the string above at the same pitch (string ${pick.s}, fret ${pick.f} to string ${up.s}, fret ${up.f}: "${up.label}")`);
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit0');
  await sleep(150);
  const typedTo = await noteNow(pick.id);
  T.ok(typedTo.f === 10 && typedTo.s === up.s && typedTo.p === STD[up.s] + 10 && typedTo.h === up.h + 1 && /^a fret typed on the /.test(typedTo.label), `typing 1 then 0 puts it on the 10th fret of its string, the pitch going with it (${pick.p} to ${typedTo.p}), one undo ("${typedTo.label}")`);
  await sleep(1000);
  const outFret = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((f) => !AMIN.has((STD[up.s] + f) % 12));
  await page.keyboard.press(`Digit${outFret}`);
  await sleep(150);
  const locked = await noteNow(pick.id);
  T.ok(locked.f === 10 && locked.p === typedTo.p && locked.h === typedTo.h && /is outside A minor, and Scale lock is on/.test(locked.msg), `with Scale lock on, a fret outside the key is refused and says why ("${locked.msg.slice(0, 70)}…")`);
  const undoTyped = await E((id) => { const o = window.overdub; o.store.undo(); const c = o.store.findClip(o.ui.state.selection.clip).clip, n = c.notes.find((x) => x.id === id); return { p: n.p, s: n.s, f: n.f }; }, pick.id);
  T.ok(undoTyped.p === pick.p && undoTyped.s === up.s && undoTyped.f === up.f, 'one undo takes the typed fret back, both digits');
  // the clip's tuning: Drop D re-fingers what the low string can't keep; no pitch moves
  const pitches0 = await E(() => window.overdub.store.findClip(window.overdub.ui.state.selection.clip).clip.notes.map((n) => n.p).join(','));
  await page.selectOption('.prt-tuning', 'drop-d');
  await sleep(200);
  const dd = await E(() => { const o = window.overdub, c = o.store.findClip(o.ui.state.selection.clip).clip, pt = o.pianoroll.tab.part(); return { tuning: c.tuning, pitches: c.notes.map((n) => n.p).join(','), low: pt.notes.filter((n) => n.s === 0).every((n) => n.f === n.p - 38), all: pt.notes.every((n) => [38, 45, 50, 55, 59, 64][n.s] + n.f === n.p), label: o.store.history[o.store.history.length - 1].label }; });
  T.ok(dd.tuning === 'drop-d' && dd.pitches === pitches0 && dd.low && dd.all, `the Tuning menu sets the clip's tuning: the tab follows (the low string from D), no pitch moves ("${dd.label}")`);
  await E(() => window.overdub.store.undo());
  await page.click('.pr-tabbtn');
  await sleep(200);
  const offTab = await E(() => ({ on: window.overdub.pianoroll.tabOn(), cls: document.querySelector('.pr').classList.contains('pr-istab'), main: getComputedStyle(document.querySelector('.pr-main')).visibility, pref: window.overdub.ui.state.prTab }));
  T.ok(!offTab.on && !offTab.cls && offTab.main === 'visible' && offTab.pref === false, 'the Tab switch turns it back to the roll, and stays where you put it');
  await page.click('.pr-tabbtn');
  await sleep(300);
  await shot('roll');
  const drumTab = await E(() => { const o = window.overdub, d = o.store.get().tracks.find((t) => /drum|kit|beat/i.test(t.name) && t.clips.some((c) => c.kind === 'notes')); if (!d) return null; o.ui.select({ track: d.id, clip: d.clips.find((c) => c.kind === 'notes').id, notes: [] }); return { hidden: document.querySelector('.pr-tabbtn').hidden, on: o.pianoroll.tabOn() }; });
  T.ok(drumTab && drumTab.hidden && !drumTab.on, 'a drum clip has no Tab switch');

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no page errors on the desktop${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

/* ============================================================================ 7. a phone */
if (process.env.NODE_ONLY !== '1') {
  const { page, errors, close } = await boot({ width: 390, height: 844 });
  const E = (fn, arg) => page.evaluate(fn, arg);
  await page.setViewportSize({ width: 390, height: 844 });
  await E(() => { const o = window.overdub; o.transport.click.set({ on: false }); });
  await page.click('#ew-tab-jam');
  await sleep(700);
  // a phone: the chord on one line, then the neck, then the tab lane (one line while it has nothing to show)
  const porder = await E(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const tb = r('.tb'); return { stage: Math.round(r('.jm-stage').bottom), neck: Math.round(r('.jm-neck-scroll').top), neckEnd: Math.round(r('.jm-neck').bottom), lane: Math.round(tb.top), h: Math.round(tb.height), head: Math.round(r('.tb-head').height), none: document.querySelector('.tb').classList.contains('tb-blank'), text: document.querySelector('.tb').textContent.replace(/\s+/g, ' ').trim() }; });
  T.ok(porder.neck >= porder.stage - 1 && porder.lane >= porder.neckEnd - 1 && porder.none && porder.h <= porder.head + 16 && /^Tab\s*No tab yet/.test(porder.text), `phone: the neck comes straight under the chord, the tab lane after it, one line while it's empty (${porder.h} px: "${porder.text.slice(0, 40)}")`);
  await E(() => document.querySelector('.tb').scrollIntoView({ block: 'start' }));
  await E(() => window.overdub.tabs.suggest({ agent: false }));
  await sleep(400);
  await E(() => document.querySelector('.tb').scrollIntoView({ block: 'start' }));
  await sleep(200);
  await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(OUTDIR, 'tabs-phone-takes.png') });
  const lay = await E(() => {
    const out = { doc: document.documentElement.scrollWidth, vw: innerWidth, small: [], targets: [] };
    const root = document.querySelector('.tb');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('[hidden], .sr-only')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11.95) out.small.push(`${el.className || el.tagName} ${fs}px`);
    }
    for (const el of root.querySelectorAll('button, select')) {
      if (el.closest('[hidden]') || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) out.targets.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  T.ok(lay.doc <= lay.vw, `phone: no sideways page scroll (${lay.doc} px in ${lay.vw})`);
  T.ok(!lay.small.length, `phone: no text in the lane under 12 px${lay.small.length ? ': ' + [...new Set(lay.small)].slice(0, 4).join(', ') : ''}`);
  T.ok(!lay.targets.length, `phone: the lane's controls are 44 px targets${lay.targets.length ? ': ' + lay.targets.slice(0, 4).join(', ') : ''}`);
  await E(() => window.overdub.tabs.keep(0));
  await E(() => window.overdub.tabs.loopRiff());
  await E(() => window.overdub.transport.playStop());
  await page.waitForFunction(() => window.overdub.engine.playing && window.overdub.engine.beat > 0.5, null, { timeout: 8000 });
  const sc = [];
  for (let k = 0; k < 4; k++) { await sleep(700); sc.push(await E(() => { const s = document.querySelector('.tb-scroll'); return { left: s.scrollLeft, w: s.scrollWidth, c: s.clientWidth, beat: window.overdub.engine.beat }; })); }
  const lefts = sc.map((x) => Math.round(x.left));
  T.ok(sc[0].w > sc[0].c + 300 && new Set(lefts).size >= 3 && lefts[3] > lefts[0], `phone: the lane is wider than the screen and scrolls with the playhead (${lefts.join(', ')} px at beats ${sc.map((x) => x.beat.toFixed(1)).join(', ')})`);
  // a hit on the phone, from the fake stream, for the picture
  await E(() => { const o = window.overdub, g = o.tabs.part().groups.find((x) => x.t > o.engine.beat + 0.3); if (g) setTimeout(() => o.tabs.hear({ p: g.p, beat: g.t, src: 'guitar' }), 0); });
  await sleep(900);
  await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(OUTDIR, 'tabs-phone-playing.png') });
  await E(() => window.overdub.transport.playStop());
  // the Notes panel's Tab view on a phone: 44 px targets, nothing under 12 px
  await E(() => { const o = window.overdub, g = o.jam.guitars().keys, c = g.clips.find((x) => x.start === 0); o.ui.select({ track: g.id, clip: c.id, notes: [c.notes[0].id] }); o.ui.show('pianoroll'); });
  await sleep(500);
  const roll = await E(() => {
    const out = { on: window.overdub.pianoroll.tabOn(), doc: document.documentElement.scrollWidth, vw: innerWidth, small: [], targets: [] };
    const root = document.querySelector('.prt');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('[hidden], .sr-only') || !el.getClientRects().length || getComputedStyle(el).display === 'none') continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11.95) out.small.push(`${el.className || el.tagName} ${fs}px`);
    }
    for (const el of root.querySelectorAll('button, select')) {
      if (el.closest('[hidden]') || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) out.targets.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  T.ok(roll.on && roll.doc <= roll.vw && !roll.small.length && !roll.targets.length, `phone: the Notes panel's Tab view fits, its text 12 px or more, its controls 44 px targets${roll.small.length || roll.targets.length ? ': ' + [...roll.small, ...roll.targets].slice(0, 4).join(', ') : ''}`);
  await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(OUTDIR, 'tabs-phone-roll.png') });
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `phone: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

T.done();
