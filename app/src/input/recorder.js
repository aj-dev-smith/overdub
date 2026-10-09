// The recorder: one Record into the song (docs/research/RECORDING-UX.md, 3.2). R arms nothing new and asks nothing:
// a count-in you can hear (the song's previous bar pre-rolls with the click; below bar 1, clicks only), then whatever
// you play lands on its track at the bars where you played it. Keys (MIDI, musical typing), pads (F J K L, on-screen,
// beatbox), hum and the mic are sources over the existing modules; the recorder places each event on the transport's
// unwrapped grid, so loop passes and wraps never lose or reorder anything. Space (or R, or the killswitch) ends the
// take: ONE store.dispatch by 'you', one undo step, and every pass also goes to capture (never lose an idea). Knobs and
// faders held while it records write their lanes (input/autorec.js, app.input.autorec): those auto.writes go in the
// same dispatch.
//
//   recorder = app.input.recorder
//   recorder.state                        'idle' | 'count' | 'rec'
//   recorder.aim(kind) -> { track, why }  where the next take of a kind ('hum' | 'keys' | 'pads') goes: a track id, or
//                                         null for a new track (docs/INSTRUMENTS-UX.md 1.1). why: 'choice' (picked in
//                                         Onto; 'new' is one-shot: once its take is in, the choice is spent and the track it made is the last take's),
//                                         'selected', 'last' (the last take of that kind went there), 'only-kit' (pads:
//                                         the song's one drum track), 'armed' (the full studio), 'new'. Session state,
//                                         never the song; another song starts with none
//   recorder.setAim(kind, track | 'new' | null)   Onto's pick (null clears it); in the full studio a track is armed and
//                                         'new' disarms every track, so the lit R says the same. Emits 'aim'
//   recorder.targetFor(kind)              kind 'keys' | 'hum' | 'pads' | 'audio' -> the track that source records onto,
//                                         or null (a new track). Simple view: Onto's choice, the track selected since
//                                         that kind's last take, the last take's track, (pads) the only drum track.
//                                         Full studio: Onto's choice, an armed track that fits (hum and keys: pitched
//                                         first, then drums), the selected one (a hum never onto unarmed drums), (pads)
//                                         the only drum track. Arming a track by hand there clears every choice, as does
//                                         selecting another track: the newest deliberate act wins. audio: armed, selected
//   recorder.target                       the track id R records onto first: in the full studio the armed one, else the
//                                         selected one (the arranger's lit R), unless Onto chose; in the simple view the
//                                         aim of what R records now (Hum it, Tap it, the keys)
//   recorder.humming()                    R records the hum: Hum it is open or a hum is going (and no audio track is the
//                                         target, which records the mic as it is), or the take running has one
//   recorder.lands() -> track | null      where R's take lands, as the top bar's "Onto", the record key, the count-in's
//                                         numeral and live().track say it (null: a new track)
//   recorder.onto() -> [track]            the tracks "Onto" offers: those R can record onto now (a hum: the pitched ones,
//                                         and a drum track chosen or armed on purpose)
//   recorder.keysTrack() -> track | null  the keys' track, made now when the keys are aimed at a new track (the keys are
//                                         heard where they'll be recorded): one track.add by you, selected, emitted on
//                                         app.input as 'keys:track' { track, name, device, text }
//   recorder.ownTrack(stacked?) -> dispatch result   a take that muted what played under it, onto a track of its own
//                                         with the same instrument, what it muted playing again: one undo step
//   recorder.took(kind, track)            a take of that kind went onto track (capture's Keep says so too)
//   recorder.modeFor(track) / setMode(track, 'layer' | 'take')   each loop pass layers into one clip (drum tracks) or
//                                         stacks a new take (everything else, audio always); a choice sticks per track
//   recorder.countIn / setCountIn(bars)   0, 1 (default) or 2 bars (localStorage overdub:record)
//   recorder.record({ countIn?, audio?, quantize? }) -> Promise<take | null>   stopped: the count-in from the playhead;
//                                         playing: recording starts at a bar line with a whole bar to come in on (a loop
//                                         of 2 bars or less: its top; quantize: false, now), the wait counted ('count',
//                                         live().counting); before the loop, at its start
//   recorder.stop({ keepPlaying?, why?, at? }) -> Promise<commit | null>  the take into the song (R punches out and
//                                         keeps playing; Space stops; the killswitch, a seek or a hidden tab commit too;
//                                         a seek ends the take where it was, not where the playhead jumped: at)
//   recorder.toggle()                     R: idle -> record, count -> cancel, rec -> punch out
//   recorder.cancel()                     during the count-in: nothing is recorded (a hum R started stops; one you started
//                                         with H is yours again)
//   recorder.capture(id?) -> result       Shift+R, Put it in the song: a captured phrase onto its target, at the beats
//                                         it was played on (free time: the playhead's bar)
//   recorder.live() -> { state, track, tracks, from, now, pass, counting, passes: [{ n, track, notes, raw }], peaks, trace }
//   recorder.passes() -> the passes so far ; recorder.undoPass() takes the last completed one out (kept in capture):
//                                         ⌘Z while a take runs (input/index.js), never the song's undo
//   recorder.takeNow() -> the take id a note played now goes into, or null (capture's copy of it says so)
//   recorder.addNotes(notes, { src, left? }) the hum's and the beatbox's notes on the grid; left gets the ones the take
//                                         didn't take (hummed before R), for capture. A note's `was` is the pitch it had
//                                         before its source moved it (the hum's snap into the key): the commit says how
//                                         many went in moved, with the ops that put them back as played (`sung`), and
//                                         input/hum.js says so with Undo, as a hum on its own does
//   recorder.last                         the last commit: { take, label, summary, parts, ok, sung?, lean? } (lean: the
//                                         take's steady offset against the click, taken out at the stop, input/timing.js
//                                         placeTake: { beats, ms, by, moved, opening, words })
//   recorder.on('state' | 'pass' | 'note' | 'commit' | 'aim', fn) -> off   (also app.input 'record' { state })
//
// In Hum it (Sketch showing its Hum mode), R also records the mic as a hum into the take (with the count-in); a hum
// already going when R starts (H, then R) becomes the take's too, so whatever it draws lands on the stop.
//
// Pure (Node too): planTake(project, take) -> { ops, label, summary, parts }: the commit as ordinary ops (core/ops.js).
// Layer adds into the clip under each note (notes.add; a hit on one already there is merged, and counted as such) and
// makes new clips only where there is none. New take is one take folder over the beats the passes recorded
// (core/arrangement.js planTakeFolder): what played there is muted under it, never past it, and the last complete
// pass plays (pickActive: never a fragment over a fuller pass); a phrase played on over the loop's end stays in one pass
// (joinSeams: its tail at the loop's start, where it came round); a note begun just before the loop's end (inside
// EARLY_WRAP: early on the downbeat, often held over it) is the next pass's downbeat, grid or no grid (your timing), never
// a stub at the end of the pass before; a pass's start and end inside its bars (a punch
// from a marker, a stop mid-bar) leave the rest of those bars to what played there before. An audio take's folder is
// the beats the pass that plays covers (audio can't be filled out). passRange(rec, pass, bpb) -> { start, end,
// complete, from, to }: the bars a pass recorded (it ends where you stopped, not at the loop's end) and the beats it
// really did. take.bpb: the take's own bars. The passes are numbered in the order they were recorded (Take 1 is the
// first time round, whichever of them plays).
// parts[].notes and .bars are your own: the notes or hits you played, their bars. A pass's note with `was` (its pitch
// before a source moved it) can be found again after the commit: parts[].sung, [{ clip | ref, p, t (clip beats), was }].
// A take stacks over what plays on its track only where its bars overlap it (planTakeFolder mutes nothing past them):
// parts[].stacked, { names (what played there, now muted), unmute: [clip id | ref] } says what it muted, and the summary
// says so ("Take 2 is in on Melody, bars 1–2; Take 1 is muted."). parts[].kinds: the aims ('hum' | 'keys' | 'pads') the
// part's notes came from (part.kinds, passed through).

import { beatsPerBar } from '../core/music.js';
import { newId } from '../core/project.js';
import { planTakeFolder } from '../core/arrangement.js';
import { passOf, passGrid } from './capture.js';
import { ROW } from './tap.js';
import { createAutorec } from './autorec.js';
import { snapGentle, tightness, blend, leanOf, placeTake } from './timing.js';
import { newPartFor } from '../core/sounds.js';

const SAVE = 'overdub:record';
const EPS = 1e-6, MIN_CLIP = 0.25, MIN_NOTE = 1 / 64;
const EARLY = 0.5;          // a note in the count-in's last eighth counts as the downbeat (people anticipate it)
const MISS = 0.35;          // two hits on one drum, in different passes, this close (beats) as played: one meant hit
const EARLY_WRAP = 1 / 8;   // a note begun less than a 32nd before the loop's end is early on the next pass's downbeat
                            // (the grid's rounding does the same with the grid on; a 32nd pickup stays where it was)
const r4 = (x) => Math.round(x * 10000) / 10000;
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
// what a take's lean was, and what was done about it: "You played about 140 ms behind the click, so your hits are on
// their beats; As played puts them back." (x: relean's { ms, kind: 'hit' | 'note' (a hum's: "You sang"), opening, lean })
export function leanWords(x) {
  const ms = Math.abs(Math.round((x.ms || 0) / 10) * 10), them = x.kind === 'note' ? 'notes' : 'hits';
  const a = x.lean ? `You ${x.kind === 'note' ? 'sang' : 'played'} about ${ms} ms ${x.ms > 0 ? 'behind' : 'ahead of'} the click, so your ${them} are on their beats; As played puts them back.` : '';
  const b = x.opening ? ` Your first ${x.opening === 1 ? x.kind : `${x.opening} ${them}`} came in late and ${x.opening === 1 ? 'is' : 'are'} on ${x.opening === 1 ? 'its beat' : 'their beats'}.` : '';
  return (a + b).trim();
}

export const isDrumTrack = (t) => !!t && t.kind === 'instrument' && /drum|kit|beat/i.test(`${t.instrument?.device || ''} ${t.name || ''}`);

// "bars 5–8" for song beats [a, b)
export function barsOf(bpb, a, b) {
  const x = Math.floor(a / bpb + 1e-9) + 1, y = Math.max(x, Math.ceil(b / bpb - 1e-9));
  return y > x ? `bars ${x}–${y}` : `bar ${x}`;
}

/* ------------------------------------------------------------------------------------------------ the commit plan */

// The beats a pass recorded (rec: { span, stopPass, stopBeat }, the take's pass map and where it stopped; ps: { n,
// notes (song beats) }): from where it began (the bar the take began in, on the first pass; the loop's start after a
// wrap) to the loop's end when it ran round, else to where you stopped: the bar line before the stop, or further when
// a note was played there (or still rang more than half a beat past it). Never the rest of the loop. from and to are
// the beats it really recorded (where it began, where it stopped): a punch in or out inside a bar leaves the rest of
// that bar to what played there before (planTakeFolder fills the take out with it).
//   -> { start, end, complete, from, to }
export function passRange(rec, ps, bpb) {
  const lp = rec.span.loop;
  // (a pass whose phrase ran over the loop's end holds its last notes at the loop's start, where they were played:
  // joinSeams. It recorded the whole loop, the start too)
  const start = ps.n || (ps.wrap && lp) ? lp.start : Math.max(lp ? lp.start : 0, Math.floor(rec.span.b0 / bpb + 1e-9) * bpb);
  const first = Math.min(...ps.notes.map((x) => x.t));
  const from = r4(Math.max(start, Math.min(first, ps.n || (ps.wrap && lp) ? lp.start : Math.max(lp ? lp.start : 0, rec.span.b0))));
  const complete = !!lp && ps.n < (rec.stopPass ?? 0);
  if (complete) return { start, end: lp.end, complete, from, to: lp.end };
  const on = Math.max(...ps.notes.map((x) => x.t)), off = Math.max(...ps.notes.map((x) => x.t + x.d));
  const played = Math.ceil(Math.max(on + MIN_NOTE, off - 0.5) / bpb - 1e-9) * bpb;
  const stopped = ps.n === (rec.stopPass ?? 0) && Number.isFinite(rec.stopBeat);
  const passed = stopped ? Math.floor(rec.stopBeat / bpb + 1e-9) * bpb : start;
  let end = Math.max(played, passed);
  if (lp) end = Math.min(end, lp.end);
  end = Math.max(end, start + MIN_CLIP);
  const to = stopped ? r4(Math.min(end, Math.max(rec.stopBeat, on + MIN_NOTE, off))) : end;
  return { start, end, complete, from, to: Math.max(to, from) };
}

// A phrase played over the loop's seam stays in one take. R while the loop plays starts at the next bar, so a tune
// often begins near the loop's end and runs on round it: its head in one pass, its tail in the next. passes: one New
// take part's passes, [{ n, notes: [{ p, t, d, ... }] (song beats), ... }] in pass order; loop: { start, end }. Where
// the playing runs on over the seam (the gap from the last note before it to the first after it is no longer than the
// phrase's own: twice its usual note-to-note time, at least a beat, at most a bar), the notes on each side of the seam
// that belong to the phrase (each within that gap of the next) are one phrase, and it goes where it fits: the notes
// after the seam back into the pass it started in, when they come before that pass's first note (they wrap round to
// the loop's start, where they were played; a tail still ringing at that note is cut there; the pass is marked wrap:
// it holds the loop's start too); else the notes before it on into the next pass, when they come after all of its
// notes. A phrase longer than the loop doesn't fit either way, and stays a pass per time round, as does playing that
// fills every pass. A pass left empty goes. Pure: the notes are moved, not copied or changed (but the cut tail).
//   -> { passes: [{ ...pass, notes, wrap? }], joins: [{ into, from, notes (how many moved), at: 'start' | 'end', a, b }] }
export function joinSeams(passes, loop, bpb = 4) {
  const out = (passes || []).map((ps) => ({ ...ps, notes: ps.notes.slice().sort((x, y) => x.t - y.t || x.p - y.p) }));
  const joins = [];
  if (!loop || !(loop.end > loop.start) || out.length < 2) return { passes: out, joins };
  const gaps = (ns) => { const on = [...new Set(ns.map((x) => r4(x.t)))].sort((x, y) => x - y), g = []; for (let i = 1; i < on.length; i++) if (on[i] - on[i - 1] > 1 / 16) g.push(on[i] - on[i - 1]); return g; };
  for (let i = 0; i + 1 < out.length; i++) {
    const A = out[i], B = out[i + 1];
    if (B.n !== A.n + 1 || !A.notes.length || !B.notes.length) continue;
    const g = [...gaps(A.notes), ...gaps(B.notes)].sort((x, y) => x - y);
    const usual = g.length ? g[Math.floor(g.length / 2)] : 0.5;
    const most = Math.min(bpb, Math.max(1, 2 * usual)) + 1e-6;
    const lastA = A.notes[A.notes.length - 1], firstB = B.notes[0];
    if ((loop.end - lastA.t) + (firstB.t - loop.start) > most) continue;     // a rest at the seam: two phrases
    // the phrase's notes on each side of the seam
    let a = A.notes.length - 1;
    while (a > 0 && A.notes[a].t - A.notes[a - 1].t <= most) a--;
    let b = 0;
    while (b + 1 < B.notes.length && B.notes[b + 1].t - B.notes[b].t <= most) b++;
    const before = A.notes.slice(a), after = B.notes.slice(0, b + 1);
    const headA = A.notes[0].t, endB = B.notes[B.notes.length - 1].t;
    if (after[after.length - 1].t < headA - 1 / 64) {
      // the tail wraps round to the loop's start, in the pass the phrase began in
      A.notes = [...after.map((x) => (x.t + x.d > headA ? { ...x, d: r4(Math.max(MIN_NOTE, headA - x.t)) } : x)), ...A.notes];
      A.wrap = true;
      B.notes = B.notes.slice(b + 1);
      joins.push({ into: A.n, from: B.n, notes: after.length, at: 'start', a: after[0].t, b: after[after.length - 1].t });
      if (!B.notes.length) out.splice(i + 1, 1);
    } else if (before[0].t > endB + 1 / 64) {
      // the head goes on into the next pass, at the loop's end, where it was played
      B.notes = [...B.notes, ...before];
      A.notes = A.notes.slice(0, a);
      joins.push({ into: B.n, from: A.n, notes: before.length, at: 'end', a: before[0].t, b: before[before.length - 1].t });
      if (!A.notes.length) { out.splice(i, 1); i--; }
    }
  }
  return { passes: out, joins };
}

// The pass that plays: the last complete one (a pass the stop cut short is kept under it), else the last one; but a
// fragment (fewer than half the notes of the fullest pass) never plays over a fuller one: the last pass that isn't a
// fragment plays instead, a complete one first. passes: [{ n, complete, notes }].
//   -> { n, natural } (natural: the pass the old rule would have played)
export function pickActive(passes) {
  const last = (xs) => xs[xs.length - 1];
  const most = Math.max(0, ...passes.map((x) => x.notes.length));
  const full = (x) => x.notes.length * 2 >= most;
  const done = passes.filter((x) => x.complete);
  const natural = done.length ? last(done) : last(passes);
  const pick = last(done.filter(full)) || last(passes.filter(full)) || natural;
  return { n: pick.n, natural: natural.n };
}

// take: { id: 'tk_…', parts: [{ track, kind: 'notes' | 'audio', mode: 'layer' | 'take', name?, drums?, newTrack?,
//   span: { start, end } (where a new Layer clip may go), passes: [{ n, clip: { start, end }, notes?: [{ p, t, d, v }]
//   (song beats), audio?: { asset, offset (s), start, length (beats) } }] }] }
// part.newTrack: { name, device } adds the track first (no track to record onto: never a dead end).
export function planTake(p, take) {
  const bpb = take.bpb > 0 ? take.bpb : beatsPerBar(p.meter);   // (the take's own bars: a meter changed mid-take ends it)
  const ops = [], parts = [];
  let refN = 0;
  const ref = () => 'rk' + (++refN);
  for (const part of take.parts || []) {
    let t = p.tracks.find((x) => x.id === part.track) || null, tid = t ? t.id : null;
    const passes = (part.passes || []).filter((ps) => (ps.notes && ps.notes.length) || ps.audio);
    if (!passes.length) continue;
    if (!t) {
      if (!part.newTrack) continue;
      const r = ref();
      ops.push({ type: 'track.add', ref: r, track: { name: part.newTrack.name, kind: part.kind === 'audio' ? 'audio' : 'instrument', ...(part.kind === 'audio' ? {} : { instrument: { device: part.newTrack.device, params: {} } }) } });
      tid = '$' + r;
      t = { id: tid, name: part.newTrack.name, clips: [], kind: part.kind === 'audio' ? 'audio' : 'instrument' };
    }
    const kind = part.kind === 'audio' ? 'audio' : 'notes';
    const live = t.clips.filter((c) => c.kind === kind && !c.mute);
    const info = { track: tid, name: t.name, bpb, mode: part.mode, drums: !!part.drums, notes: 0, played: 0, there: 0, passes: passes.length, from: Infinity, to: -Infinity, takes: 0, under: 0, into: [], refs: [], sung: [], kinds: part.kinds || [] };
    if (part.mode === 'layer' && kind === 'notes') {
      // every pass's notes in one set (two hits of one note on one step: the louder stays)
      const seen = new Map();
      for (const ps of passes) for (const n of ps.notes) {
        const k = n.p + '@' + r4(n.t);
        if (!seen.has(k) || seen.get(k).v < n.v) seen.set(k, n);
      }
      const all = [...seen.values()].sort((a, b) => a.t - b.t || a.p - b.p);
      const into = new Map(), loose = [];
      for (const n of all) {
        const c = live.find((x) => n.t >= x.start - EPS && n.t < x.start + x.length - EPS);
        if (!c) { loose.push(n); continue; }
        const rel = r4(n.t - c.start);
        info.played++; span(info, n.t, n.t + MIN_NOTE);
        if (c.notes.some((x) => x.p === n.p && Math.abs(x.t - rel) < 1e-3)) { info.there++; continue; } // already there: merged, not doubled
        if (!into.has(c)) into.set(c, []);
        into.get(c).push({ p: n.p, t: rel, d: r4(Math.max(MIN_NOTE, Math.min(n.d, c.start + c.length - n.t))), v: n.v });
        if (n.was != null) info.sung.push({ clip: c.id, p: n.p, t: rel, was: n.was });
      }
      for (const [c, ns] of into) { ops.push({ type: 'notes.add', track: tid, clip: c.id, notes: ns }); info.notes += ns.length; info.into.push(c.id); }
      if (!loose.length && !into.size) { info.bars = barsOf(bpb, info.from, info.to); info.added = 0; info.notes = info.played; parts.push(info); continue; }
      // the rest: new clips in the take's span, never over a clip that's there
      const sp = part.span || { start: Math.floor(all[0].t / bpb) * bpb, end: Math.ceil((all[all.length - 1].t + 0.01) / bpb) * bpb };
      for (let i = 0; i < loose.length;) {
        const n = loose[i];
        const prevEnd = Math.max(0, ...live.filter((x) => x.start + x.length <= n.t + EPS).map((x) => x.start + x.length));
        const nextStart = Math.min(Infinity, ...live.filter((x) => x.start > n.t + EPS).map((x) => x.start));
        const s = r4(Math.max(prevEnd, n.t >= sp.start - EPS ? Math.floor(sp.start / bpb + 1e-9) * bpb : Math.floor(n.t / bpb + 1e-9) * bpb));
        let e = Math.min(nextStart, Math.ceil(Math.max(sp.end, n.t + MIN_NOTE) / bpb - 1e-9) * bpb);
        if (e - s < MIN_CLIP) e = s + MIN_CLIP;
        const group = [];
        while (i < loose.length && loose[i].t < e - EPS) group.push(loose[i++]);
        const rf = ref();
        ops.push({ type: 'clip.add', track: tid, ref: rf, clip: { kind: 'notes', start: s, length: r4(e - s), name: part.name || 'Recorded', notes: group.map((x) => ({ p: x.p, t: r4(x.t - s), d: r4(Math.max(MIN_NOTE, Math.min(x.d, e - x.t))), v: x.v })) } });
        info.notes += group.length; info.played += group.length; info.refs.push(rf); for (const x of group) span(info, x.t, x.t + MIN_NOTE);
        for (const x of group) if (x.was != null) info.sung.push({ ref: rf, p: x.p, t: r4(x.t - s), was: x.was });
      }
      info.added = info.notes; info.notes = info.played;   // (your own hits, counted: the ones merged too)
    } else {
      // New take: the passes are one take folder over the range they recorded (core/arrangement.js planTakeFolder):
      // the active one plays (the last complete pass), the others and what played there before are kept, muted
      let ps2 = passes, ai = passes.findIndex((ps) => ps.n === part.active);
      if (ai < 0) ai = passes.length - 1;
      if (kind === 'audio') {
        // audio can't be filled out with what played before, so the folder is the beats the take that plays covers:
        // the other passes keep their part of those beats, and what is past them (a pass begun before a take that
        // started inside the loop) stays in capture, never muting bars nothing plays over
        const act = passes[ai].audio, A = act.start, B = act.start + act.length, spb = 60 / (+p.tempo || 120);
        const ai0 = ai;
        ps2 = [];
        passes.forEach((ps, i) => {
          if (i === ai0) { ai = ps2.length; ps2.push(ps); return; }
          const s0 = Math.max(A, ps.audio.start), e0 = Math.min(B, ps.audio.start + ps.audio.length);
          if (e0 - s0 < MIN_CLIP - EPS) return;
          ps2.push(Math.abs(s0 - ps.audio.start) < EPS && Math.abs(e0 - s0 - ps.audio.length) < EPS ? ps : { ...ps, audio: { ...ps.audio, start: r4(s0), length: r4(e0 - s0), offset: r4((+ps.audio.offset || 0) + (s0 - ps.audio.start) * spb) } });
        });
      }
      // a notes pass: the folder is the bars it recorded, the pass the beats it really did (from, to)
      const spans = ps2.map((ps) => (kind === 'audio' ? [ps.audio.start, ps.audio.start + ps.audio.length] : [ps.clip.start, ps.clip.end]));
      const a = Math.min(...spans.map((x) => x[0])), b = Math.max(...spans.map((x) => x[1]));
      const tf = planTakeFolder(p, {
        track: tid, kind, start: a, end: b, take: take.id, drums: !!part.drums, active: ai, refPrefix: ref() + '_',
        passes: ps2.map((ps, i) => ({ start: kind === 'audio' ? spans[i][0] : ps.clip.from ?? spans[i][0], end: kind === 'audio' ? spans[i][1] : ps.clip.to ?? spans[i][1], notes: ps.notes, audio: ps.audio })),
      });
      inRecordedOrder(tf, ps2.length);
      ops.push(...tf.ops);
      // what played here before and is muted under the take now: the take line says so, and offers it a track of its own
      if (kind === 'notes') {
        const before = live.filter((c) => Math.min(c.start + c.length, b) - Math.max(c.start, a) >= MIN_CLIP - EPS);
        if (before.length) {
          const ids = new Set(before.map((c) => c.id)), unmute = [];
          for (const op of tf.ops) {
            if (op.type === 'clip.set' && ids.has(op.clip) && op.patch && op.patch.mute === true) unmute.push(op.clip);
            else if (op.type === 'clip.add' && !op.ref && op.clip && op.clip.id && op.clip.mute && op.clip.take === tf.group && !/^Take \d+$/.test(op.clip.name || '')) unmute.push(op.clip.id);
          }
          if (unmute.length) info.stacked = { names: [...new Set(before.map((c) => c.name || 'what played'))], unmute };
        }
      }
      // (a pass's clip starts at the folder's start and holds its own notes from where the pass began: there at their song
      // beat less that)
      if (kind === 'notes') {
        ps2.forEach((ps, i) => {
          const from = Math.max(a, ps.clip.from ?? spans[i][0]);
          for (const n of ps.notes || []) if (n.was != null && n.t >= from - EPS && n.t < b - EPS) info.sung.push({ ref: tf.refs[i], p: n.p, t: r4(n.t - a), was: n.was });
        });
      }
      info.refs.push(...tf.refs.filter((x, i) => i !== ai), tf.active.ref);
      info.notes = tf.active.notes;
      info.takes = tf.active.num;
      info.under = tf.under;
      info.total = tf.total;
      const act = ps2[ai];
      // (the pass you stopped in is the one that isn't complete; without that word, the last one)
      const known = ps2.some((ps) => typeof ps.complete === 'boolean');
      info.cut = ps2.length > 1 && (known ? ps2.some((ps, i) => i !== ai && ps.complete === false) : act !== ps2[ps2.length - 1]);
      // a phrase over the loop's seam kept whole in the take that plays (joinSeams), and a fragment that would have
      // played stepping aside for a fuller pass (pickActive): both said in the toast
      info.wrapped = (part.joins || []).filter((j) => j.into === act.n);
      const nat = Number.isInteger(part.natural) && part.natural !== act.n ? ps2.find((ps) => ps.n === part.natural) : null;
      if (nat && nat.notes) info.frag = { had: nat.notes.length, plays: act.notes.length };
      span(info, a, b);
    }
    info.bars = barsOf(bpb, info.from, info.to);
    parts.push(info);
  }
  const names = [...new Set(parts.map((x) => x.name))];
  const label = !parts.length ? '' : parts.every((x) => x.mode === 'layer') ? `record ${names.join(' and ')}` : `record take ${Math.max(...parts.map((x) => x.takes || 1))} on ${names.join(' and ')}`;
  return { ops, parts, label, summary: parts.map((x) => summaryOf(x)).join(' ') };
}
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
function span(info, a, b) { info.from = Math.min(info.from, a); info.to = Math.max(info.to, b); }
// A take folder's passes are numbered in the order they were recorded: the first time round is the lowest number
// whichever of them plays (planTakeFolder names the one that plays last, so a complete first pass stopped in the
// middle of the second read "Take 2" over a "Take 1" recorded after it). tf: planTakeFolder's plan for n passes, in
// the order played; its clip names, names and active are renumbered in place.
function inRecordedOrder(tf, n) {
  const base = tf.total - n;
  const name = new Map(tf.refs.map((ref, i) => [ref, `Take ${base + i + 1}`]));
  for (const op of tf.ops) if (op.type === 'clip.add' && name.has(op.ref)) op.clip.name = name.get(op.ref);
  tf.names = tf.refs.map((ref) => name.get(ref));
  const k = tf.refs.indexOf(tf.active.ref);
  if (k >= 0) tf.active = { ...tf.active, num: base + k + 1, name: name.get(tf.active.ref) };
}
function summaryOf(x) {
  if (x.mode === 'layer') {
    // what you played, counted: a hit on one already there is merged, and said so
    const there = x.there ? ` (${x.there === x.played ? (x.played === 1 ? 'it was' : 'all were') : x.there} already there)` : '';
    return x.drums || /drum|beat/i.test(x.name) ? `Your beat is in: ${x.bars}, ${plural(x.played, 'hit')} on ${x.name}${there}.` : `${plural(x.played, 'note')} layered into ${x.name}, ${x.bars}${there}.`;
  }
  // (what played there, muted under it, said by name: "Take 1 is muted"; the take's own other passes as a count)
  const st = x.stacked && x.stacked.names.length ? x.stacked.names : null;
  const rest = st ? Math.max(0, (x.under || 0) - 1) : x.under || 0;
  const under = rest ? ` ${NUM[rest] || rest} more underneath, muted${x.cut ? ', the pass you stopped in among them' : ''}.` : '';
  const muted = st ? `; ${andList(st)} ${st.length === 1 ? 'is' : 'are'} muted` : '';
  const bpb = x.bpb || 4;
  const wrapped = (x.wrapped || []).map((j) => (j.at === 'start'
    ? ` Your phrase ran past the loop's end and is kept whole: its last ${plural(j.notes, 'note')} come round at ${barsOf(bpb, j.a, j.b + MIN_NOTE)}.`
    : ` Your phrase began just before the loop's end and is kept whole: its first ${plural(j.notes, 'note')} stay at ${barsOf(bpb, j.a, j.b + MIN_NOTE)}.`)).join('');
  const frag = x.frag ? ` The last time round had only ${plural(x.frag.had, 'note')}, so the fuller take plays (${plural(x.frag.plays, 'note')}).` : '';
  return `Take ${x.takes} is in on ${x.name}, ${x.bars}${muted}.${under}${wrapped}${frag}`;
}

/* ------------------------------------------------------------------------------------------------ live */

export function createRecorder(app, input, opts = {}) {
  const { store, engine } = app;
  const fns = new Map();
  const emit = (t, d) => { for (const fn of fns.get(t) || []) { try { fn(d); } catch (e) { console.error('recorder listener', t, e); } } if (t === 'state') input.emit('record', d); };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SAVE) || '{}') || {}; } catch { saved = {}; }
  const modes = new Map();   // track id -> 'layer' | 'take' (this song, while it's open)
  let R = null;              // the take in progress
  let last = null;

  const P = () => store.get();
  const bpbNow = () => beatsPerBar(P().meter);
  const spbNow = () => 60 / (+P().tempo || 120);
  // the bars a take was played in (the meter when it began: changing it ends the take, which goes in on those bars)
  const bpbOf = (r) => { const m = String(r?.meter || '').split('/').map(Number); return m.length === 2 && m.every((x) => x > 0) ? beatsPerBar(m) : bpbNow(); };
  // The selected track, as the record target reads it: the last one selected, still. Clearing the selection (a click
  // on empty arranger space puts the marker there) never moves the target; selecting another track, or deleting this
  // one, does. Another song starts with none.
  let lastSel = null;
  const inSong = (id) => !!id && P().tracks.some((t) => t.id === id);
  const sel = () => {
    const s = app.ui?.state?.selection?.track || null;
    if (inSong(s)) { lastSel = s; return s; }
    return inSong(lastSel) ? lastSel : null;
  };

  /* ---- the aim: where each kind's next take goes (docs/INSTRUMENTS-UX.md 1.1). Session state: never the song, never
     storage. choice: Onto's pick (a track id, or 'new': one-shot); last / lastAt: the track the last take of that kind
     went onto, and when (an order, not a clock); selAt: when the selected track was selected */
  const KINDS = ['hum', 'keys', 'pads'];
  const none = () => ({ hum: null, keys: null, pads: null });
  const A = { choice: none(), last: none(), lastAt: { hum: 0, keys: 0, pads: 0 } };
  let seq = 0, selAt = 0, selTrack = null, mine = 0;   // mine: our own selects and arms, which aren't the person's acts
  const kindOf = (k) => (k === 'pads' || k === 'drums' || k === 'tap' || k === 'beatbox' ? 'pads' : k === 'hum' ? 'hum' : k === 'keys' || k === 'midi' || k === 'qwerty' || k === 'touch' ? 'keys' : null);
  // the view: the shell's workspace (ui/workspace.js), else what the caller said (the Node checks), else the full studio
  const viewOf = () => { try { const v = app.ui?.workspace?.view?.(); if (v) return v; } catch { /* no shell */ } const v = typeof opts.view === 'function' ? opts.view() : opts.view; return v === 'simple' ? 'simple' : 'full'; };
  const ownSelect = (s) => { mine++; try { app.ui?.select?.(s); } catch { /* ok */ } finally { mine--; } };
  function aimChanged(kind = null) { emit('aim', { kind, view: viewOf() }); }
  function clearChoices() { if (KINDS.some((k) => A.choice[k] != null)) { A.choice = none(); return true; } return false; }
  try {
    app.ui?.on?.('select', (x) => {
      if (!inSong(x?.track)) return;
      const moved = x.track !== selTrack;
      lastSel = selTrack = x.track;
      if (!moved) return;
      selAt = ++seq;
      // the full studio: selecting another track is aiming at it (a header click lights its R), so Onto's choice gives way
      if (!mine && viewOf() === 'full') clearChoices();
      aimChanged();
    });
  } catch { /* no shell (Node) */ }

  // Where a take of this kind goes: { track (or null: a new track), why }
  function resolve(kind) {
    const p = P(), s = sel();
    if (kind === 'audio') { const au = p.tracks.filter((t) => t.kind === 'audio'); const t = au.find((x) => x.arm) || au.find((x) => x.id === s) || null; return { track: t, why: t ? (t.arm ? 'armed' : 'selected') : 'new' }; }
    const k = kindOf(kind) || 'keys';
    const ins = p.tracks.filter((t) => t.kind === 'instrument');
    const byId = (id) => (id ? ins.find((t) => t.id === id) || null : null);
    const fits = (t) => !!t && (k === 'pads' ? isDrumTrack(t) : !isDrumTrack(t));
    // Onto's choice: a drum track for a hum or the keys too (pads on a controller, a hum on purpose)
    const c = A.choice[k];
    if (c === 'new') return { track: null, why: 'choice' };
    const ct = byId(c);
    if (ct && (k !== 'pads' || isDrumTrack(ct))) return { track: ct, why: 'choice' };
    const kits = ins.filter(isDrumTrack);
    if (viewOf() === 'simple') {
      const st = byId(s);
      if (fits(st) && (!A.lastAt[k] || selAt > A.lastAt[k])) return { track: st, why: 'selected' };
      const lt = byId(A.last[k]);
      if (fits(lt)) return { track: lt, why: 'last' };
      if (k === 'pads' && kits.length === 1) return { track: kits[0], why: 'only-kit' };
      return { track: null, why: 'new' };
    }
    // the full studio: the lit R first (full-studio users record onto the armed track and rely on it)
    const armed = ins.filter((t) => t.arm);
    const at = k === 'pads' ? armed.find(isDrumTrack) : armed.find((t) => !isDrumTrack(t)) || armed[0];
    if (at) return { track: at, why: 'armed' };
    // (keys and MIDI play a drum track you selected, as R and its lamp say: pads on a controller, the kit's GM map; a
    // hum is pitched, so it never goes onto drums unless they're armed or chosen)
    const st = byId(s);
    if (st && (k === 'pads' ? isDrumTrack(st) : k === 'keys' || !isDrumTrack(st))) return { track: st, why: 'selected' };
    if (k === 'pads' && kits.length === 1) return { track: kits[0], why: 'only-kit' };
    return { track: null, why: 'new' };
  }
  const targetFor = (kind) => resolve(kind).track;
  function aim(kind) { const k = kindOf(kind); if (!k) return null; const r = resolve(k); return { track: r.track ? r.track.id : null, why: r.why }; }

  // What R records now, for the lit R and Onto: the hum (Hum it), the pads (Tap it) or the keys
  const tapNow = () => input.mode === 'tap' || (input.sketchMode === 'tap' && (!app.ui?.visible || !app.ui.panels?.has?.('sketch') || !!app.ui.visible('sketch')));
  const kindNow = () => (humming() ? 'hum' : tapNow() ? 'pads' : 'keys');
  // The track R records onto first. The full studio: Onto's choice, else an armed one, else the selected one (selecting
  // a track lights its R; clearing the selection leaves it: sel), else keys' target. The simple view: the aim of what R
  // records now. Everything that says where R goes reads this: the lit R in the arranger, the top bar's record key and
  // its "Onto", the count-in's numeral, what is announced.
  function primary() {
    const p = P(), k = kindNow();
    if (viewOf() === 'simple') return targetFor('audio') || targetFor(k);
    const c = A.choice[k];
    if (c === 'new') return null;
    if (c && inSong(c)) return targetFor(k);
    const s = sel();
    return p.tracks.find((t) => t.arm) || p.tracks.find((t) => t.id === s && (t.kind === 'audio' || t.kind === 'instrument')) || targetFor('keys');
  }
  // R records the hum: a take running that has one (R started it in Hum it, or one already going joined it); idle, Hum it
  // open or a hum going, unless an audio track is the target (R records the mic onto it as it is, not as a hum)
  function humming() {
    const r = R;
    if (r) return !!(r.hum || r.joined || r.humOn);
    if (targetFor('audio')) return false;
    return humArmed() || !!(input.hum?.active && !input.hum.recording);
  }
  // Where R's take lands, said beside the record key and over the lane: the target, but a hum goes where a hum goes (a
  // drum track only when armed or chosen; null: a new track). In the full studio the lit R stays primary() (fresh eyes
  // 5: making it follow the hum broke "clicking a header arms it")
  const lands = () => (humming() ? targetFor('hum') : primary());
  // the tracks "Onto" offers: where R can record now (a hum: the pitched tracks, and a drum track armed or chosen on
  // purpose; in the simple view, the tracks that fit what R records)
  function onto() {
    const ts = P().tracks.filter((t) => t.kind === 'audio' || t.kind === 'instrument'), k = kindNow(), aimed = targetFor(k);
    if (viewOf() === 'simple') return ts.filter((t) => t.kind === 'instrument' && ((k === 'pads' ? isDrumTrack(t) : !isDrumTrack(t)) || t === aimed));
    return humming() ? ts.filter((t) => t.kind === 'instrument' && (!isDrumTrack(t) || t.arm || t === aimed)) : ts;
  }
  // Onto's pick. The full studio's lit R agrees: a track is armed (an arm on another instrument track gives way), 'new'
  // disarms every track. null clears the choice
  function setAim(kind, v) {
    const k = kindOf(kind);
    if (!k) return null;
    let t = null;
    if (v === 'new') A.choice[k] = 'new';
    else if (v == null || v === '') A.choice[k] = null;
    else {
      t = store.track(v);
      if (!t || t.kind !== 'instrument') return { error: `no instrument track "${v}"`, ...aim(k) };
      if (k === 'pads' && !isDrumTrack(t)) return { error: `${t.name} isn't a drum track`, ...aim(k) };
      A.choice[k] = t.id;
    }
    if (viewOf() === 'full' && v != null && v !== '') {
      const ts = P().tracks;
      const ops = v === 'new'
        ? ts.filter((x) => x.arm).map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } }))
        : [...ts.filter((x) => x.arm && x.id !== t.id && x.kind === 'instrument').map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } })), ...(t.arm ? [] : [{ type: 'track.set', track: t.id, patch: { arm: true } }])];
      if (ops.length) { mine++; try { store.dispatch(ops, { by: 'you', label: v === 'new' ? 'record onto a new track' : `arm ${t.name}` }); } finally { mine--; } }
    }
    aimChanged(k);
    return aim(k);
  }
  // A take of this kind went onto track: the next one of its kind follows it (last), and a one-shot 'new' is spent. It
  // clears rather than becoming a choice of that track, so a track clicked after the take still wins (a choice would
  // outrank the selection and send the next hum somewhere the person had clicked away from)
  function took(kind, track) {
    const k = kindOf(kind);
    if (!k || !inSong(track)) return;
    if (A.choice[k] === 'new') A.choice[k] = null;
    A.last[k] = track;
    A.lastAt[k] = ++seq;
    aimChanged(k);
  }
  const kindsOf = (pt) => [...new Set([...pt.srcs].map((x) => (x === 'pads' ? 'pads' : kindOf(x))).filter(Boolean))];
  // The keys are heard where they'll be recorded: aimed at a new track, the track is made when they start (typing on, a
  // touch key, the first MIDI note, R): one track.add by you, selected, said once
  function keysTrack() {
    const t = targetFor('keys');
    if (t) return t;
    const np = newPartFor('keys', P());
    const d = store.dispatch({ type: 'track.add', ref: 'k', track: { name: np.name, kind: 'instrument', instrument: { device: np.device, params: {} } } }, { by: 'you', label: `add ${np.name} for the keys` });
    if (!d.ok) return null;
    const id = d.created.k;
    ownSelect({ track: id, clip: null, notes: [] });
    took('keys', id);   // (a one-shot "A new track" for the keys is this one now)
    let dev = 'Lamp Tines';
    try { dev = app.devices?.getDevice?.(np.device)?.name || dev; } catch { /* ok */ }
    const text = `Keys play a new track, ${np.name} (${dev}). Undo takes it away.`;
    try { app.ui?.announce?.(text); } catch { /* ok */ }
    input.emit('keys:track', { track: id, name: np.name, device: np.device, text });
    return store.track(id);
  }
  const modeFor = (tr) => { const t = typeof tr === 'string' ? store.track(tr) : tr; if (!t) return 'take'; if (t.kind === 'audio') return 'take'; return modes.get(t.id) || (isDrumTrack(t) ? 'layer' : 'take'); };

  /* ---- time: every event on the transport's unwrapped grid (engine.gridBeat: what is heard now) */
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  // when the event being handled happened (keys and MIDI carry a timeStamp: main-thread lag mustn't push a note late),
  // as a performance.now() time; null outside an event
  function eventTime() {
    try {
      const ev = globalThis.event, ts = ev && ev.timeStamp, now = performance.now();
      return fin(ts) && ts > 0 && now - ts >= 0 && now - ts < 150 ? ts : null;
    } catch { return null; }
  }
  // The grid at an event (or now): engine.gridBeat, moved by what engine.beatAt says passed between the audio clock's
  // last step and the event (beatAt is continuous; a wrap in between is taken back out)
  function gridNow(r = R, at = null) {
    if (!r) return null;
    if (!engine.playing || !fin(engine.gridBeat)) return r.lastG ?? r.span.g0;
    let g = engine.gridBeat - (r.offset ?? 0);
    if (typeof engine.beatAt === 'function') {
      let d = engine.beatAt(at ?? performance.now()) - engine.beat;
      const lp = P().loop, len = lp && lp.on ? lp.end - lp.start : 0;
      if (len > 0 && Math.abs(d) > len / 2) d -= Math.sign(d) * len;
      if (fin(d) && Math.abs(d) < 1) g += d;
    }
    return g;
  }
  const where = (g, r = R) => passOf(g, r.span);

  /* ---- parts and passes */
  function partOf(r, track, kind, extra = {}) {
    const key = track ? track.id : '+' + (extra.src === 'hum' ? 'hum' : kind);
    let pt = r.parts.get(key);
    if (!pt) {
      const mode = kind === 'audio' ? 'take' : track ? modeFor(track) : kind === 'drums' ? 'layer' : 'take';
      pt = { track: track ? track.id : null, kind: kind === 'audio' ? 'audio' : 'notes', drums: kind === 'drums', mode, passes: new Map(), name: extra.name || null, srcs: new Set(), previews: [] };
      // (no track to record onto: a new one, named and sounded as every new track is: core/sounds.js newPartFor)
      if (!track) pt.newTrack = newPartFor(kind === 'drums' ? 'pads' : extra.part || (extra.src === 'hum' ? 'hum' : 'keys'), P());
      r.parts.set(key, pt);
    }
    return pt;
  }
  // A miss is replaced, not added (layered drums): when a pass is over, a hit an earlier pass played on the same drum
  // within a third of a beat of one of this pass's (as played), that landed in another cell, and that this pass didn't
  // play again, was the same hit, missed: this pass's stays and the earlier one goes (its preview too). A pattern that
  // fills both cells (hats in sixteenths) plays both again, so both stay. -> how many were replaced
  function settleMisses(r, pt, n) {
    if (pt.mode !== 'layer' || !pt.drums) return 0;
    const ps = pt.passes.get(n);
    if (!ps || !ps.notes.length) return 0;
    const len = r.span.loop ? r.span.loop.end - r.span.loop.start : 0;
    const dist = (a, b) => { const x = Math.abs(a - b); return len > 0 ? Math.min(x, Math.abs(len - x)) : x; };
    const here = (p, t) => ps.notes.some((x) => x.p === p && Math.abs(x.t - t) < 1e-6);
    let k = 0;
    for (const [n2, ps2] of pt.passes) {
      if (n2 >= n) continue;
      ps2.notes = ps2.notes.filter((x) => {
        const hit = ps.notes.find((y) => y.p === x.p && Math.abs(y.t - x.t) > 1e-6 && dist(x.raw, y.raw) < MISS);
        if (!hit || here(x.p, x.t)) return true;
        k++;
        return false;
      });
    }
    // (the misses' previews go: every preview of the part again, last first, since they stack)
    if (k && R === r) repreview(r, pt);
    ps.replaced = (ps.replaced || 0) + k;
    return k;
  }
  function passIn(pt, n) { if (!pt.passes.has(n)) pt.passes.set(n, { n, notes: [] }); return pt.passes.get(n); }

  // Where a note begun at grid g lands: its pass and song beat (quant: the grid it snaps to, 0 for your own timing). A
  // note in the count's last eighth is the downbeat; one begun just before the loop's end (the grid rounds it there, or
  // with your own timing it is inside EARLY_WRAP) is the next pass's downbeat, early, not a stub at the end of this one.
  //   -> { w (passOf), beat, raw, early (beats it came early on the wrap, 0 if it didn't) }
  function landing(r, g, quant = 0, snap = null) {
    if (g < r.span.g0) g = r.span.g0;
    let w = where(g, r), beat = w.beat, early = 0;
    const raw = beat;
    if (quant > 0) {
      beat = snap ? snap(beat) : Math.round(beat / quant) * quant;
      if (r.span.loop && beat >= w.to - EPS) { early = Math.max(0, w.to - raw); w = where(w.g1 + EPS, r); beat = w.from; }
      if (beat < r.span.b0 - EPS && !w.pass) beat = Math.ceil(r.span.b0 / quant - 1e-9) * quant;
    } else if (r.span.loop && w.to - beat < EARLY_WRAP - EPS) {
      early = w.to - beat; w = where(w.g1 + EPS, r); beat = w.from;
    }
    return { w, beat, raw, early };
  }
  // A note (grid g, grid length dg) onto a part; was: its pitch before its source moved it (a hum snapped into the key)
  // gentle: snapGentle's options when the note was placed by the forgiving grid (pads, a hum against the click): the
  // stop places it again with the take's lean out (relean)
  function addNote(r, pt, { p, v, g, dg, quant = 0, snap = null, src, was = null, graw = null, gentle = null }) {
    if (g < r.span.g0 - EARLY - EPS) return null;      // the count-in (kept in capture, not in the take)
    const { w, beat, raw: raw0, early } = landing(r, g, quant, snap);
    if (r.dropped?.has(w.pass)) return null;            // a pass taken out with ⌘Z (kept in capture)
    // (early on the wrap and held over it: it still ends where you let go)
    if (early && !quant && dg > early) dg -= early;
    const d = Math.max(MIN_NOTE, Math.min(dg, Math.max(MIN_NOTE, w.to - beat)));
    // raw: where it really began (a hum's note comes in already placed: graw is where it was sung)
    const raw = Number.isFinite(graw) ? raw0 + (graw - g) : raw0;
    const note = { p, t: r4(beat), d: r4(d), v: r4(v), raw: r4(raw), src };
    if (Number.isFinite(was) && was !== p) note.was = was;
    // (where it was played on the take's grid, before any clamping: the lean is measured from it)
    if (gentle) Object.defineProperty(note, 'gen', { value: { opts: gentle, gu: Number.isFinite(graw) ? graw : g, d: dg, quant }, enumerable: false, writable: true });
    const ps = passIn(pt, w.pass);
    ps.notes.push(note);
    pt.srcs.add(src);
    if (pt.mode === 'layer') note.pv = preview(r, pt, note);
    emit('note', { track: pt.track, pass: w.pass, note });
    return note;
  }

  // Layer: each note is heard on the next pass (a preview: in the song, not in the history, until the commit)
  function preview(r, pt, n) {
    if (!pt.track || typeof store.preview !== 'function') return;
    const t = store.track(pt.track);
    if (!t) return;
    const c = t.clips.find((x) => x.kind === 'notes' && !x.mute && n.t >= x.start - EPS && n.t < x.start + x.length - EPS);
    let pv;
    if (c) {
      if (c.notes.some((x) => x.p === n.p && Math.abs(x.t - (n.t - c.start)) < 1e-3)) return;
      pv = store.preview({ type: 'notes.add', track: t.id, clip: c.id, notes: [{ p: n.p, t: r4(n.t - c.start), d: n.d, v: n.v }] }, { by: 'you' });
    } else {
      const sp = r.newSpan(), bpb = bpbNow();
      const prevEnd = Math.max(0, ...t.clips.filter((x) => !x.mute && x.start + x.length <= n.t + EPS).map((x) => x.start + x.length));
      const nextStart = Math.min(Infinity, ...t.clips.filter((x) => !x.mute && x.start > n.t + EPS).map((x) => x.start));
      const s = Math.max(prevEnd, n.t >= sp.start - EPS ? Math.floor(sp.start / bpb + 1e-9) * bpb : Math.floor(n.t / bpb + 1e-9) * bpb);
      const e = Math.min(nextStart, Math.ceil(Math.max(sp.end, n.t + 0.01) / bpb - 1e-9) * bpb);
      if (e - s < MIN_CLIP) return;
      pv = store.preview({ type: 'clip.add', track: t.id, clip: { kind: 'notes', start: s, length: e - s, name: pt.name || 'Recorded', notes: [{ p: n.p, t: r4(n.t - s), d: n.d, v: n.v }] } }, { by: 'you' });
    }
    if (pv && pv.ok) { pt.previews.push(pv); return pv; }
    return null;
  }
  // a part's previews again, from its notes as they are now (previews are a stack: they go back last first, all of them)
  function repreview(r, pt) {
    if (pt.mode !== 'layer') return;
    for (const pv of pt.previews.splice(0).reverse()) { try { pv.release(); } catch { /* the commit puts it right */ } }
    for (const ps of [...pt.passes.values()].sort((a, b) => a.n - b.n)) for (const n of ps.notes) n.pv = preview(r, pt, n);
  }
  function releasePreviews(r) {
    for (const pt of r.parts.values()) { for (const pv of pt.previews.splice(0).reverse()) { try { pv.release(); } catch { /* the commit puts it right */ } } }
  }

  /* ---- sources: keys and MIDI (input.noteOn/noteOff), pads (tap.hit), beatbox and hum (their stop), the mic */
  function noteOn(src, p, v, trackId, kind = 'midi') {
    const r = R;
    if (!r || !trackId || r.closing || r.free) return;
    const g = gridNow(r, eventTime());
    if (g == null) return;
    r.held.set(src + ':' + p, { p, v, g, track: trackId, kind });
  }
  function noteOff(src, p) {
    const r = R;
    if (!r || r.closing || r.free) return;
    const h = r.held.get(src + ':' + p);
    if (!h) return;
    r.held.delete(src + ':' + p);
    const g = gridNow(r, eventTime());
    closeHeld(r, h, g);
  }
  function closeHeld(r, h, g) {
    const t = store.track(h.track);
    if (!t) return;
    const pt = partOf(r, t, isDrumTrack(t) ? 'drums' : 'notes', { name: isDrumTrack(t) ? 'Played beat' : null });
    // musical typing and the touch keys land on the Sketch grid while On the grid is on (input/qwerty.js), a whole cell
    // at least; a MIDI keyboard keeps its player's timing
    const dg = Math.max(MIN_NOTE, (g ?? h.g) - h.g), q = (h.kind === 'qwerty' || h.kind === 'touch') && input.qwerty?.quantize ? input.options?.grid || 0.25 : 0;
    addNote(r, pt, { p: h.p, v: h.v, g: h.g, dg: q ? Math.max(q, Math.round(dg / q) * q) : dg, quant: q, src: h.kind || 'midi' });
  }
  // a pad: quantized on input to the Sketch grid (raw timing kept)
  function hit(row, v = 0.8, { g = null, src = 'pads' } = {}) {
    const r = R;
    if (!r || r.free || (g == null && r.closing)) return null;
    const rw = ROW[row];
    if (!rw) return null;
    const gg = g ?? gridNow(r, eventTime());
    if (gg == null) return null;
    const t = targetFor('pads');
    const q = input.options?.grid || 0.25;
    const pt = partOf(r, t, 'drums', { name: src === 'beatbox' ? 'Beatboxed beat' : 'Tapped beat' });
    // forgiving: an eighth when the hit is near one, else the grid's cell (input/timing.js snapGentle), with the take's
    // lean so far taken out (a player 150 ms behind the click is on the beat from the fourth hit; the stop places every
    // hit again with the whole take's lean: relean)
    const gentle = { coarse: Math.max(q, 0.5), fine: q }, lean = r.lean || 0;
    const n = addNote(r, pt, { p: rw.p, v, g: gg, dg: q, quant: q, snap: (b) => snapGentle(b - lean, gentle), src, gentle });
    // (the lean found so far moved: the hits already in go where it says too, heard there on the next pass)
    if (n) { const l2 = leanOf(gentleHits(r, pt)).lean; if (Math.abs(l2 - lean) > 0.02) { r.lean = l2; relean(r, { only: pt }); } }
    return n;
  }
  // a part's notes placed by the forgiving grid, as played: { p (a drum's note; one value for a hum), b (the take's
  // beats from its start, unwrapped) }, and the notes themselves
  function gentleNotes(pt) { const out = []; for (const ps of pt.passes.values()) for (const n of ps.notes) if (n.gen) out.push({ n, ps }); return out; }
  function gentleHits(r, pt, items = gentleNotes(pt)) { return items.length < 4 ? [] : items.map(({ n }) => ({ p: pt.drums ? n.p : 0, b: r.span.b0 + (n.gen.gu - r.span.g0) })); }
  // At the stop: every note the forgiving grid placed, placed again with the whole take's lean out (input/timing.js
  // placeTake: one steady offset, the median distance to the beat, so a player who is always 150 ms late lands on the
  // beat and not on the "and"; a drum's nervous first hits, late coming in, on their beats). A hum's notes move only when
  // there is a lean (its own placing, input/hum.js, is the same grid). -> { lean, by, ms, moved, opening, n, kind } | null
  function relean(r, { only = null } = {}) {
    let out = null;
    for (const pt of r.parts.values()) {
      if (only && pt !== only) continue;
      const items = gentleNotes(pt);
      if (items.length < 3) continue;
      const hum = !pt.drums;
      const hits = items.map(({ n }) => ({ p: pt.drums ? n.p : 0, b: r.span.b0 + (n.gen.gu - r.span.g0) }));
      const pl = placeTake(hits, items[0].n.gen.opts, { from: r.span.b0, opening: !hum });
      if (hum && !pl.lean) continue;
      let moved = 0;
      const touched = new Set();
      items.forEach(({ n, ps }, i) => {
        n.gen.lean = pl.lean;
        let g = r.span.g0 + (pl.t[i] - r.span.b0);
        if (g < r.span.g0) g = r.span.g0;
        let w = where(g + 1e-7, r), beat = r4(w.beat);
        if (r.span.loop && beat >= w.to - EPS) { w = where(w.g1 + EPS, r); beat = w.from; }
        if (w.pass === ps.n && Math.abs(beat - n.t) < 1e-6) return;
        moved++;
        ps.notes.splice(ps.notes.indexOf(n), 1);
        touched.add(ps);
        if (r.dropped?.has(w.pass)) return;
        n.t = beat;
        n.d = r4(Math.max(MIN_NOTE, Math.min(hum ? n.d : n.gen.d, w.to - beat)));
        const to = passIn(pt, w.pass);
        to.notes.push(n);
        touched.add(to);
      });
      // (heard where they go now, while the take runs)
      if (only && moved) repreview(r, pt);
      for (const ps of touched) { ps.notes.sort((a, b) => a.t - b.t || a.p - b.p); if (ps.captured) recapture(r, pt, ps, ps.notes); }
      const spb = 60 / (+r.tempo || 120);
      if (!out || Math.abs(pl.lean) > Math.abs(out.lean)) out = { lean: pl.lean, by: pl.by, ms: Math.round(pl.lean * spb * 1000), moved, opening: pl.opening, n: items.length, kind: pt.drums ? 'hit' : 'note' };
    }
    return out;
  }

  /* ---- the mic: blocks from the capture worklet, placed by a (ctx time, grid) pair */
  async function startAudio(r, track) {
    const audio = input.audio;
    try { await audio.openFor(track); } catch (e) {
      const blocked = /allow|NotAllowed/i.test(String(e && e.message));
      app.ui?.toast?.(blocked ? 'The mic is blocked. Allow it from the address bar, then press R again. Keys and pads still record.' : e.message, { kind: 'bad' });
      return;
    }
    if (R !== r) return;
    r.audioTrack = track.id;
    const a = r.audio = { track: track.id, chunks: [], len: 0, f0: null, sr: audio.ctx.sampleRate, snap: null, peaks: [] };
    a.off = audio.listen((blk) => {
      if (R !== r || r.audio !== a) return;
      if (a.f0 == null) a.f0 = blk.f;
      const d = blk.d[0];
      a.chunks.push(d); a.len += d.length;
      let pk = 0; for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); if (x > pk) pk = x; }
      a.peaks.push(Math.round(pk * 1000) / 1000);
      snapAudio(r);
    });
    audio._recording(true);
  }
  // a (ctx time, grid) pair once the playhead really moves (engine.beat holds still for the start delay and the output
  // latency after play()); the take is placed from it
  function snapAudio(r) {
    const a = r.audio, c = input.audio.ctx;
    if (!a || a.snap || !c || !engine.playing || !fin(engine.gridBeat)) return;
    if (a.b1 == null) { a.b1 = engine.beat; return; }
    if (Math.abs(engine.beat - a.b1) > 0.02) a.snap = { ctxT: c.currentTime, g: engine.gridBeat - (r.offset ?? 0) };
  }
  // the take's audio, cut into its passes: one asset, each pass a clip at its offset
  async function finishAudio(r, stopG) {
    const a = r.audio;
    if (!a) return null;
    a.off && a.off();
    r.audio = null;
    input.audio._recording(false);
    if (!a.len || a.f0 == null) { app.ui?.toast?.('Nothing was recorded (the input sent no audio).', { kind: 'bad' }); return null; }
    const sr = a.sr, spb = spbNow(), L = input.audio.latency.get(), out = input.audio.outLatency();
    const x = new Float32Array(a.len); let w = 0; for (const c of a.chunks) { x.set(c, w); w += c.length; }
    // the grid of input frame f: played to what was scheduled L earlier, heard `out` after that
    const snap = a.snap || { ctxT: a.f0 / sr, g: r.span.g0 };
    const frameOf = (g) => Math.round((snap.ctxT + (g - snap.g) * spb + L - out) * sr) - a.f0;
    const passes = [];
    let quiet = 0;
    for (let n = 0; n < 4096; n++) {
      const [g0, g1raw] = passGrid(n, r.span);
      if (g0 >= stopG - 1e-6) break;
      const g1 = Math.min(g1raw, stopG);
      const i0 = Math.max(0, frameOf(g0)), i1 = Math.min(x.length, frameOf(g1));
      let pk = 0; for (let i = i0; i < i1; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
      if (r.dropped?.has(n)) continue;   // (taken out with ⌘Z while it recorded)
      // (a pass with nothing in it adds nothing: shorter than 50 ms, or under -80 dBFS throughout)
      if (i1 - i0 >= sr * 0.05 && pk > 1e-4) passes.push({ n, g0, g1, i0, i1 });
      else if (i1 - i0 >= sr * 0.05) quiet++;
      if (g1raw === Infinity) break;
    }
    if (!passes.length) {
      const st = input.audio.state;
      app.ui?.toast?.(quiet ? `Nothing came in on input ${st.channel} of ${st.label || 'the interface'}. Check the cable and the input's gain, or pick another input.` : 'That take was too short to keep.', { kind: quiet ? 'bad' : 'info' });
      return null;
    }
    const first = passes[0].i0, lastI = passes[passes.length - 1].i1;
    // a pass that starts later than its grid (the first frames were before the mic opened) starts its clip later too
    const data = Float32Array.from(x.subarray(first, lastI));
    const asset = 'a_' + Date.now().toString(36).slice(-6) + Math.floor(performance.now() % 1296).toString(36);
    try { await engine.assets.put(asset, { sr, channels: [data] }); } catch (e) { app.ui?.toast?.('Could not keep the audio: ' + e.message, { kind: 'bad' }); return null; }
    return {
      asset, seconds: data.length / sr, latency: L,
      passes: passes.map((ps) => {
        const startG = ps.g0 + Math.max(0, ps.i0 - frameOf(ps.g0)) / sr / spb;
        const w0 = where(startG, r);
        return { n: ps.n, audio: { asset, offset: (ps.i0 - first) / sr, start: r4(w0.beat), length: r4(Math.max(MIN_CLIP, (ps.i1 - ps.i0) / sr / spb)) } };
      }),
    };
  }

  /* ---- the count-in and the transport */
  function newSpan(r) {
    const bpb = bpbOf(r);
    const lp = r.span.loop;
    if (lp) return { start: Math.max(lp.start, Math.floor(r.span.b0 / bpb + 1e-9) * bpb), end: lp.end };
    return { start: Math.floor(r.span.b0 / bpb + 1e-9) * bpb, end: Math.max(r.span.b0 + 0.25, (r.lastBeat ?? r.span.b0)) };
  }
  // the engine's count-in: the song's previous bars pre-roll with the click (below bar 1, clicks alone); 'countin-end'
  // at the audible downbeat. From the playhead: when that is before the loop, the song pre-rolls up to the loop's
  // start and recording starts there (the loop is the punch range; tick() turns 'count' into 'rec')
  async function startTransport(r, beats) {
    try { engine.recording = true; } catch { /* ok */ }
    await engine.play(r.startBeat, beats ? { countIn: { beats, preroll: true } } : null);
  }

  function setState(r, s) { if (r.state === s) return; r.state = s; emit('state', { state: s, take: r.id }); }

  // the light timer while a take runs: count -> rec at the downbeat, a pass closing at each wrap, the stop's grid
  function tick() {
    const r = R;
    if (!r) return;
    if (engine.playing && fin(engine.gridBeat)) {
      if (r.offset == null && engine.beat < (r.span.loop ? r.span.loop.end : Infinity)) r.offset = engine.gridBeat - engine.beat;
      const g = gridNow(r);
      r.lastG = g; r.lastT = performance.now(); r.lastBeat = engine.beat;
      if (r.state === 'count' && g >= r.span.g0 - 1e-3) setState(r, 'rec');
      if (r.state === 'rec') {
        const n = where(g, r).pass;
        while (r.pass < n) { closePass(r, r.pass); r.pass++; emit('pass', { n: r.pass, take: r.id }); }
      }
      snapAudio(r);
    }
  }
  // a completed pass goes to capture now (never lose one, even if the tab dies before the stop)
  function closePass(r, n) {
    for (const pt of r.parts.values()) settleMisses(r, pt, n);
    for (const pt of r.parts.values()) {
      const ps = pt.passes.get(n);
      if (!ps || ps.captured || !ps.notes.length) continue;
      ps.captured = captureOf(r, pt, ps);
    }
  }
  // a pass's notes as capture holds them: from the bar of its first one
  function capturedNotes(notes) {
    const bpb = bpbNow(), ns = notes.slice().sort((a, b) => a.t - b.t || a.p - b.p), beat = Math.floor(ns[0].t / bpb + 1e-9) * bpb;
    return { beat, notes: ns.map((x) => ({ p: x.p, t: r4(x.t - beat), d: x.d, v: x.v })), raw: ns.map((x) => x.raw) };
  }
  function captureOf(r, pt, ps) {
    try {
      const src = pt.srcs.has('hum') ? 'hum' : pt.srcs.has('beatbox') ? 'beatbox' : pt.srcs.has('pads') ? 'tap' : pt.srcs.has('qwerty') ? 'qwerty' : 'midi';
      const c = input.capture.add({ src, kind: pt.drums ? 'drums' : 'notes', ...capturedNotes(ps.notes), tempo: P().tempo, track: pt.track, take: r.id, pass: ps.n, rec: true });
      return c ? c.id : true;
    } catch { return true; }
  }
  // a pass whose notes a joined phrase moved (joinSeams): its capture entry holds what it has now; one left empty is
  // hidden (kept: its notes are in the pass they were joined to, whose entry has them)
  function recapture(r, pt, ps, notes) {
    try {
      const id = typeof ps.captured === 'string' ? ps.captured : null;
      if (!notes.length) { if (id) input.capture.hide(id); else ps.captured = true; return; }
      if (id) input.capture.update(id, capturedNotes(notes));
      else ps.captured = captureOf(r, pt, { ...ps, notes });
    } catch { /* capture is best effort here: the take still goes in */ }
  }

  /* ---- record, stop, cancel */
  // Hum it is open: R records the mic into the song as a hum (with the count-in), the way tapping records the pads
  const humArmed = () => input.sketchMode === 'hum' && (!app.ui?.visible || !app.ui.panels?.has?.('sketch') || !!app.ui.visible('sketch'));
  // Sketch's Tap it or Hum it on screen: a take from there is a capture take. Its click is the transport's click for
  // takes (ui/transport.js clickSettings: on unless turned off, borrowed for the take); with the click off altogether
  // and nothing in the song to play along to, it is a free take: no transport and no count, you play in your own time,
  // and the grid follows you (finishFree)
  const sketchShown = () => !app.ui?.visible || !app.ui.panels?.has?.('sketch') || !!app.ui.visible('sketch');
  const tapArmed = () => input.sketchMode === 'tap' && sketchShown();
  const silentSong = () => P().tracks.every((t) => !(t.clips || []).some((c) => !c.mute));
  // a track for a take that needs one before it starts (the pads sound on a drum track; the keys on theirs): made now,
  // selected, and its adding is one undo step with the take (store.dispatch join)
  function makePart(kind) {
    const np = newPartFor(kind, P());
    const d = store.dispatch({ type: 'track.add', ref: 'n', track: { name: np.name, kind: 'instrument', instrument: { device: np.device, params: {} } } }, { by: 'you', label: `add ${np.name} to record on` });
    if (!d.ok) return null;
    ownSelect({ track: d.created.n, clip: null, notes: [] });
    took(kind, d.created.n);   // (the kind's aim is this track now, as a commit would make it)
    return { track: d.created.n, txn: d.txn?.id || null, name: np.name };
  }
  // the track made for a take that put nothing in it goes again (only while its adding is the newest change)
  function unmake(r) {
    const m = r && r.made;
    if (!m || !m.txn) return;
    const h = store.history, lastTx = h[h.length - 1], t = store.track(m.track);
    if (lastTx && lastTx.id === m.txn && t && !t.clips.length) { try { store.undo({ id: m.txn, redo: false }); } catch { /* ok */ } }
  }
  async function record({ countIn = rec.countIn, audio = null, quantize = true, hum = humArmed(), free = null } = {}) {
    if (R) return R;
    const au = audio ? store.track(audio) : targetFor('audio');
    // A sound on trial on a track this take records onto is kept first, said before it happens (the instrument change
    // and the take are two undo steps, in that order: docs/INSTRUMENTS-UX.md 1.3)
    let keeps = null;
    try {
      const tr = app.sounds?.trying?.();
      if (tr && tr.track && !tr.newTrack) {
        const onto = new Set([au?.id, hum ? targetFor('hum')?.id : null, kindNow() === 'pads' ? targetFor('pads')?.id : targetFor('keys')?.id].filter(Boolean));
        const t = store.track(tr.track);
        if (t && onto.has(t.id)) {
          const def = app.devices?.getDevice?.(tr.device);
          keeps = `Recording keeps ${(def && def.name) || tr.device}${tr.preset ? `, ${tr.preset}` : ''} on ${t.name}.`;
          app.sounds.keepIfTrying?.(t.id, { why: 'record' });
          app.ui?.announce?.(keeps);
        }
      }
    } catch { /* the take still records */ }
    const capture = !au && (hum || tapArmed());
    // no track to record onto is never a dead end: Tap it makes Drums now (so the pads sound), the keys make Keys now,
    // at the count-in (they sound on it, and this press records onto it, never "press R again"), a hum makes Melody
    // when it lands (newPartFor, core/sounds.js). Either is one undo step with the take (store.dispatch join)
    let made = null;
    if (!au && !hum && tapArmed() && !targetFor('pads')) made = makePart('pads');
    else if (!au && !hum && kindNow() === 'keys' && !targetFor('keys')) {
      const kt = keysTrack(), h = store.history, lastTx = h[h.length - 1];
      if (kt && lastTx && lastTx.ops.length === 1 && lastTx.ops[0].type === 'track.add' && !kt.clips.length) made = { track: kt.id, txn: lastTx.id, name: kt.name };
    }
    // (a track made for this take just before it, by someone else's button: the first minute's Drums. Its adding is the
    // newest change and it is empty: the take joins it too, so one undo takes the take and the track it was made for)
    if (!made) {
      const h = store.history, lastTx = h[h.length - 1], inv = lastTx && lastTx.inverse && lastTx.inverse[0];
      const tid = inv && inv.type === 'track.remove' ? inv.track : null, tr = tid && store.track(tid);
      const aimed = tid && [targetFor('pads'), targetFor('keys'), hum ? targetFor('hum') : null].some((x) => x && x.id === tid);
      if (lastTx && lastTx.by === 'you' && lastTx.ops.length === 1 && lastTx.ops[0].type === 'track.add' && tr && !tr.clips.length && aimed) made = { track: tid, txn: lastTx.id, name: tr.name };
    }
    const isFree = free ?? (capture && !rec.captureClick && !engine.playing && silentSong());
    if (isFree) return recordFree({ hum, made });
    const p = P();
    const bpb = beatsPerBar(p.meter), playing = !!engine.playing;
    const b0 = playing ? engine.beat : Math.max(0, +(engine.beat ?? 0) || 0);
    const lp = p.loop && p.loop.on && p.loop.end - p.loop.start >= 1 / 64 && b0 < p.loop.end - EPS ? { start: +p.loop.start, end: +p.loop.end } : null;
    // where recording starts (start, a song beat) and how far ahead that is as heard (ahead, beats): the loop is the
    // punch range, so before it, its start; R while playing (a quantized launch, like a clip in Ableton), a bar line
    // with at least the count-in's bars to come in on (a whole bar, less a sixteenth: R a hair after a bar line counts
    // that bar), the loop's start after its end. It used to count only what was left of this bar: 171 ms of warning
    // when R came late in the bar, and none in its last sixteenth
    let start = b0, ahead = 0;
    if (lp && b0 < lp.start - EPS) { start = lp.start; ahead = lp.start - b0; }
    else if (playing && quantize) {
      const want = Math.max(0, (+countIn || 0) * bpb - 0.25);
      // (a loop of 2 bars or less, the first minute's: the take starts at its top, so what you play first is its first
      // bar and a 2-bar beat lands as played, not its second bar then its first; a longer loop would wait too long)
      const top = !!lp && b0 >= lp.start - EPS && lp.end - lp.start <= 2 * bpb + EPS;
      // (the bar lines ahead, as heard: on to the loop's end, then round from its start)
      const lines = [];
      let pos = b0, acc = 0, next = Math.ceil((b0 - 1e-3) / bpb) * bpb;
      for (let guard = 0; guard < 64 && !lines.length; guard++) {
        if (lp && next >= lp.end - EPS) { acc += lp.end - pos; pos = lp.start; } else { acc += next - pos; pos = next; }
        if (acc >= want - 1e-9 && (!top || Math.abs(pos - lp.start) < EPS)) lines.push({ at: pos, ahead: acc });
        next = Math.ceil((pos + 1e-3) / bpb) * bpb;
      }
      // the first with a whole count before it
      const pick = lines[0] || { at: b0, ahead: 0 };
      start = pick.at; ahead = pick.ahead;
    }
    const g0 = (playing && fin(engine.gridBeat) ? engine.gridBeat : b0) + ahead;
    // (whether this take has a hum is known before its first 'state': the sound card reads humming() on it)
    const humOn = !au && !!input.hum && (input.hum.active ? !input.hum.recording : !!hum);
    const r = {
      id: newId('tk'), state: 'count', at: Date.now(), parts: new Map(), held: new Map(), pass: 0, lastG: null,
      span: { g0, b0: start, loop: lp, wrap: lp ? g0 + (lp.end - start) : Infinity },
      startBeat: b0, tempo: p.tempo, meter: p.meter.join('/'), loopKey: JSON.stringify(p.loop || null),
      offset: playing ? 0 : null, started: playing, wasPlaying: playing, newSpan: () => newSpan(r), keeps, humOn, made, capture,
    };
    R = r;
    const beats = playing ? 0 : Math.max(0, (+countIn || 0) * bpb);   // (whole bars: 3.5 beats a bar in 7/8, not 4)
    if ((playing || !beats) && ahead <= EPS) setState(r, 'rec'); else emit('state', { state: 'count', take: r.id });
    r.timer = setInterval(tick, 30);
    if (au) startAudio(r, au);
    // the hum: one already going (H, then R) is this take's from here on; in Hum it, R starts one
    if (!au && input.hum) {
      if (input.hum.active && !input.hum.recording) r.joined = input.hum.join();
      else if (hum && !input.hum.active) {
        r.hum = true;
        r.humStart = input.hum.start({ rec: true }).catch((e) => {
          const blocked = /allow|NotAllowed|denied/i.test(String(e && e.message));
          app.ui?.toast?.(blocked ? 'The mic is blocked, so this take has no hum. Allow it from the address bar; keys and pads still record.' : 'No hum in this take: ' + (e && e.message), { kind: 'bad' });
        });
      }
    }
    if (!playing) {
      try { await startTransport(r, beats); } catch (e) { app.ui?.toast?.('Could not start: ' + e.message, { kind: 'bad' }); }
      if (R !== r) return null;
      r.started = true;
      if (!beats && ahead <= EPS) setState(r, 'rec');
    } else { try { engine.recording = true; } catch { /* ok */ } }
    tick();
    return r;
  }

  // A free take (no click, nothing playing): no transport and no count, it records from the first tap or note. The
  // pads keep their own take (input/tap.js, each hit's time), a hum its own (input/hum.js start({ free: true })); at
  // the stop the pulse is found in what was played and the take lands on its own track (finishFree).
  function recordFree({ hum, made }) {
    const p = P();
    const r = {
      id: newId('tk'), free: true, state: 'rec', at: Date.now(), parts: new Map(), held: new Map(), pass: 0, lastG: 0,
      span: { g0: 0, b0: 0, loop: null, wrap: Infinity }, startBeat: 0, tempo: p.tempo, meter: p.meter.join('/'),
      loopKey: JSON.stringify(p.loop || null), offset: 0, started: true, wasPlaying: false, newSpan: () => ({ start: 0, end: 0 }), made, capture: true,
    };
    R = r;
    try { input.tap?.flush?.(); } catch { /* ok */ }   // (an earlier phrase of taps is its own take)
    setState(r, 'rec');
    if (hum && input.hum && !input.hum.active) {
      r.hum = true;
      r.humStart = input.hum.start({ free: true }).catch((e) => {
        const blocked = /allow|NotAllowed|denied/i.test(String(e && e.message));
        app.ui?.toast?.(blocked ? 'The mic is blocked. Allow it from the address bar, then press Hum again.' : 'No hum: ' + (e && e.message), { kind: 'bad' });
        if (R === r) cancel();
      });
    }
    return Promise.resolve(r);
  }

  // A free take ends: what was played, counted on its own pulse (input/timing.js), goes in on its own track as one undo
  // step (with the track made for it): a beat onto the song's only drum track or a new Drums, a hum onto a new Melody.
  // A song with nothing in it takes the tempo you played; one with parts keeps its own, and your beats become its beats.
  async function finishFree(r, why) {
    let cap = null, fit = null, planned = [];
    const kind = r.hum ? 'hum' : 'pads';
    if (r.hum) {
      try { await r.humStart; } catch { /* said */ }
      const tk = input.hum?.active ? await input.hum.stop() : null;
      if (tk && tk.capture) { cap = tk.capture; fit = tk.free || null; planned = (tk.result?.notes || []).map((n) => ({ p: n.p, t: n.t, raw: Number.isFinite(n.tr) ? n.tr : n.t })); }
    } else {
      const c = input.tap?.flush?.({ free: true }) || null;
      if (c && c.id) { cap = c.id; fit = c.free || null; planned = c.planned || []; }
    }
    R = null;
    setState(r, 'idle');
    if (!cap) {
      unmake(r);
      const text = r.hum ? 'Heard nothing, so the song is as it was. Hum a little louder, or closer to the mic.' : 'Nothing played in that take, so the song is as it was.';
      try { app.ui?.toast?.(text, { ms: 4000 }); app.ui?.announce?.(text); } catch { /* ok */ }
      const res = { ok: true, take: r.id, empty: true, why, free: true, parts: [], summary: '' };
      last = res; emit('commit', res);
      return res;
    }
    const p = P(), bpb = beatsPerBar(p.meter);
    const t = kind === 'pads' ? targetFor('pads') : targetFor('hum');
    const tempo = fit && fit.bpm && silentSong() ? Math.max(40, Math.min(240, Math.round(fit.bpm))) : null;
    const np = t ? null : newPartFor(kind, p);
    const k = input.capture.keep(cap, { track: t ? t.id : null, newTrack: np, tempo, join: r.made?.txn || null, label: kind === 'pads' ? 'record your beat, in your own time' : 'record your hum, in your own time' });
    if (!k.ok) {
      app.ui?.toast?.('The take could not go in: ' + k.error + '. Sketch kept it.', { kind: 'bad' });
      const res = { ok: false, take: r.id, error: k.error, why, free: true };
      last = res; emit('commit', res);
      return res;
    }
    const c = store.clip(k.track, k.clip), tr = store.track(k.track), n = c?.notes?.length || 0;
    const bars = c ? barsOf(bpb, c.start, c.start + c.length) : '';
    const word = kind === 'pads' ? 'hit' : 'note';
    const at = tempo ? ` The song is at ${tempo} BPM now, the tempo ${kind === 'pads' ? 'you played' : 'it heard in your hum'}.` : fit ? ` You ${kind === 'pads' ? 'played' : 'hummed'} at ${Math.round(fit.bpm)} BPM; it plays at the song's ${p.tempo}.` : '';
    const summary = `${kind === 'pads' ? 'Your beat is in' : 'Your hum is in'}: ${plural(n, word)} on ${tr ? tr.name : 'a new track'}, ${bars}.${at}`;
    timing = timingOf([{ track: k.track, clip: k.clip }], planned, 0, kind);
    const h = store.history, txn = h[h.length - 1]?.id || null;
    const res = { ok: true, take: r.id, capture: cap, why, free: true, tempo: tempo || null, bpm: fit ? fit.bpm : null, fit: fit ? fit.fit : null, drift: fit ? fit.drift : null, label: h[h.length - 1]?.label || '', summary, txn,
      parts: [{ track: k.track, name: tr ? tr.name : '', mode: kind === 'pads' ? 'layer' : 'take', drums: kind === 'pads', notes: n, played: n, bars, clips: [k.clip] }], clips: [k.clip] };
    last = res;
    app.ui?.toast?.(`${summary} Undo takes it back.`, { kind: 'ok', ms: 6000, action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    try { app.ui?.announce?.(summary); } catch { /* ok */ }
    emit('commit', res);
    return res;
  }

  // The take's timing, for its Tight / Loose / As played (retime): each note it put in the song, where the gentle grid
  // put it (tight) and where it was played (raw), in its clip's beats. made: [{ track, clip | clips }]; planned:
  // [{ p, t, raw }] in song beats (less `base`, the beat planned t are counted from minus the clip's start)
  let timing = null;
  function timingOf(made, planned, base = null, kind = 'keys') {
    const pool = new Map();
    for (const x of planned) { if (!pool.has(x.p)) pool.set(x.p, []); pool.get(x.p).push({ ...x, used: false }); }
    const clips = [];
    for (const m of made) {
      for (const cid of m.clips || [m.clip]) {
        const c = store.clip(m.track, cid);
        if (!c || c.kind !== 'notes') continue;
        const off = base == null ? c.start : base;
        const notes = [];
        for (const n of c.notes || []) {
          const q = (pool.get(n.p) || []).find((x) => !x.used && Math.abs(x.t - off - n.t) < 1e-3);
          if (!q) continue;
          q.used = true;
          notes.push({ id: n.id, tight: n.t, raw: r4(q.raw - off), lean: q.lean || 0 });
        }
        if (notes.length) clips.push({ track: m.track, clip: cid, length: c.length, notes });
      }
    }
    return clips.length ? { level: 'tight', clips, kind } : null;
  }
  // Tight (where the gentle grid put each note), Loose (half way back to how it was played) or As played: one undo
  // step, by you. -> dispatch result
  const LEVEL_WORD = { tight: 'tight', loose: 'loose', played: 'as played' };
  function retime(level) {
    const tm = timing;
    if (!tm || !LEVEL_WORD[level]) return { ok: false, error: 'no take to tighten' };
    const s = tightness(level), ops = [];
    for (const c of tm.clips) {
      const clip = store.clip(c.track, c.clip);
      if (!clip) continue;
      const ids = new Set((clip.notes || []).map((n) => n.id));
      // (Loose is half way back to how it was played, the lean left out: a player 150 ms behind the click keeps the feel
      // of each hit, not the 150 ms; As played is where each was played)
      const notes = c.notes.filter((n) => ids.has(n.id)).map((n) => ({ id: n.id, t: r4(Math.max(0, Math.min(clip.length - MIN_NOTE, blend(s > 0 ? n.raw - (n.lean || 0) : n.raw, n.tight, s)))) }));
      if (notes.length) ops.push({ type: 'notes.set', track: c.track, clip: c.clip, notes });
    }
    if (!ops.length) { timing = null; return { ok: false, error: 'the take is no longer in the song' }; }
    const d = store.dispatch(ops, { by: 'you', label: `timing: ${LEVEL_WORD[level]}` });
    if (d.ok) tm.level = level;
    return d;
  }

  // at: the grid it stopped at, when the transport has already moved on (a seek or a play() jumps the grid to the new
  // place before its event: the take ends where it was, not where the playhead went)
  async function stop({ keepPlaying = false, why = 'stop', at = null } = {}) {
    const r = R;
    if (!r) return null;
    if (r.closing) return r.closing;
    if (r.free) { r.closing = finishFree(r, why); return r.closing; }
    if (r.state === 'count') { cancel({ stopTransport: !keepPlaying }); return null; }
    r.closing = (async () => {
      if (!fin(at)) tick();
      const stopG = fin(at) ? at : engine.playing ? gridNow(r) : (r.stopG ?? r.lastG ?? r.span.g0);
      r.stopG = stopG;
      const ws = where(Math.max(stopG, r.span.g0), r);
      r.lastBeat = Math.max(r.lastBeat ?? r.span.b0, ws.beat);
      r.stopPass = ws.pass; r.stopBeat = ws.beat;
      clearInterval(r.timer);
      if (!keepPlaying && engine.playing) engine.stop();
      for (const h of r.held.values()) closeHeld(r, h, stopG);
      r.held.clear();
      // the sources that finish on their own: the hum (transcribed now), the beatbox (its hits found now)
      try { if (input.hum?.active && input.hum.recording) await input.hum.stop(); } catch { /* ok */ }
      try { if (input.tap?.beatboxing && input.tap.recording) await input.tap.stopBeatbox(); } catch { /* ok */ }
      const audioRes = await finishAudio(r, stopG);
      r.leaned = relean(r);
      for (const pt of r.parts.values()) settleMisses(r, pt, r.stopPass ?? r.pass);   // (the pass it stopped in)
      R = null;
      try { engine.recording = false; } catch { /* ok */ }
      releasePreviews(r);
      setState(r, 'idle');
      const res = commit(r, audioRes, why);
      if (!res || !res.ok || res.empty) unmake(r);
      emit('commit', res);
      return res;
    })();
    return r.closing;
  }

  function commit(r, audioRes, why) {
    const bpb = bpbOf(r), sp = newSpan(r);
    const take = { id: r.id, bpb, parts: [] };
    // the phrase played into the take ends with it (capture's copy of it, all in this take, isn't listed twice; what
    // you play after the take is a phrase of its own)
    try { input.capture.flush?.(); } catch { /* ok */ }
    for (const pt of r.parts.values()) {
      let own = [...pt.passes.values()].filter((ps) => ps.notes.length).sort((a, b) => a.n - b.n), joins = [];
      // New take in a loop: a phrase played over the seam stays in the pass it began in (or the next), whole
      if (pt.mode === 'take' && r.span.loop) ({ passes: own, joins } = joinSeams(own, r.span.loop, bpb));
      const passes = own.map((ps) => {
        const { start, end, complete, from, to } = passRange(r, ps, bpb);   // (r: { span, stopPass, stopBeat })
        // (a note a source moved keeps what it was, so the commit can say so and put it back: planTake's parts[].sung)
        return { n: ps.n, complete, clip: { start, end, from, to }, notes: ps.notes.map(({ p, t, d, v, was }) => (was != null ? { p, t, d, v, was } : { p, t, d, v })) };
      });
      // capture has each pass as it closed: the passes a phrase was joined across say what they hold now (one left
      // empty is hidden: its notes are in the other's), the rest go in as they are
      const moved = new Set(joins.flatMap((j) => [j.into, j.from]));
      for (const ps of pt.passes.values()) {
        if (!ps.notes.length) continue;
        if (moved.has(ps.n)) recapture(r, pt, ps, own.find((x) => x.n === ps.n)?.notes || []);
        else if (!ps.captured) ps.captured = captureOf(r, pt, ps);
      }
      if (!passes.length) continue;
      // the take that plays: the last complete pass (a pass the stop cut short is kept under it), else the last one;
      // never a fragment over a fuller pass (pickActive)
      const pick = pickActive(passes);
      // (where a new Layer clip may go: to the loop's end, or to the bar line before the stop, further when a note was
      // played past it; a stop a hair into a bar with nothing played there doesn't add that bar)
      const lastOn = Math.max(...own.flatMap((ps) => ps.notes.map((x) => x.t)));
      const end = r.span.loop ? sp.end : Math.max(Math.ceil((lastOn + MIN_NOTE) / bpb - 1e-9) * bpb, Math.floor(sp.end / bpb + 1e-9) * bpb, sp.start + bpb);
      take.parts.push({ track: pt.track, kind: 'notes', mode: pt.mode, name: pt.name || undefined, drums: pt.drums, newTrack: pt.newTrack, kinds: kindsOf(pt), span: { start: sp.start, end }, passes, active: pick.n, natural: pick.natural, joins });
    }
    if (audioRes) {
      const t = store.track(r.audioTrack) || targetFor('audio');
      const done = audioRes.passes.filter((ps) => r.span.loop && ps.n < (r.stopPass ?? 0));
      if (t) take.parts.push({ track: t.id, kind: 'audio', mode: 'take', passes: audioRes.passes, active: (done.length ? done[done.length - 1] : audioRes.passes[audioRes.passes.length - 1])?.n });
      try { input.capture.add({ src: 'rec', kind: 'audio', audio: audioRes.asset, seconds: audioRes.seconds, beat: audioRes.passes[0]?.audio.start ?? r.span.b0, track: t ? t.id : null, tempo: P().tempo, notes: [], take: r.id, pass: 0, rec: true }); } catch { /* ok */ }
    }
    // the knobs and faders moved while it recorded (input/autorec.js): their lanes go in with the take, one undo step
    const auto = input.autorec ? input.autorec.finish(r) : null;
    const plan = planTake(P(), take);
    // a lean taken out (relean): said, with the number, and that As played puts it back
    const lean = r.leaned && (r.leaned.lean || r.leaned.opening) ? r.leaned : null;
    if (lean && plan.ops.length) plan.summary = `${plan.summary} ${leanWords(lean)}`;
    if (auto && auto.ops.length) {
      plan.ops.push(...auto.ops);
      plan.label = plan.label ? `${plan.label}; ${auto.label}` : auto.label;
      plan.summary = [plan.summary, auto.summary].filter(Boolean).join(' ');
      plan.lanes = auto.lanes;
    }
    if (!plan.ops.length) {
      // nothing new: nothing played, or every hit landed on one already there (merged, and said so)
      const merged = plan.parts.filter((x) => x.played);
      const res = { ok: true, take: r.id, empty: true, why, parts: merged, summary: merged.length ? plan.summary : '' };
      last = res;
      const text = merged.length ? `${plan.summary} Nothing new to add.` : 'Nothing played in that take, so the song is as it was.';
      if (!(r.audioTrack && !audioRes)) { try { app.ui?.toast?.(text, { ms: 4000 }); } catch { /* ok */ } }   // (the mic said why already)
      try { app.ui?.announce?.(text); } catch { /* ok */ }
      return res;
    }
    // (a track made for this take at its start, and the take, are one undo step)
    const d = store.dispatch(plan.ops, { by: 'you', label: plan.label, join: r.made?.txn || null });
    if (!d.ok) {
      app.ui?.toast?.('The take could not go in: ' + d.error + '. Sketch kept it.', { kind: 'bad' });
      const res = { ok: false, take: r.id, error: d.error, why, parts: plan.parts };
      last = res;
      return res;
    }
    const made = plan.parts.map(({ sung, ...x }) => ({ ...x, track: typeof x.track === 'string' && x.track.startsWith('$') ? d.created[x.track.slice(1)] : x.track, clips: [...x.into, ...x.refs.map((rf) => d.created[rf])].filter(Boolean) }));
    const clips = made.flatMap((x) => x.clips);
    // a take onto a new track: its passes in Sketch's Takes say where they went ("in the song: Melody"), as a take onto
    // a track already there does (the capture entries were made before the track was)
    try {
      for (const pt of r.parts.values()) {
        if (pt.track && store.track(pt.track)) continue;
        const i = plan.parts.findIndex((x) => typeof x.track === 'string' && x.track.startsWith('$') && !!x.drums === !!pt.drums);
        const tid = i >= 0 ? made[i].track : null;
        if (!tid) continue;
        for (const ps of pt.passes.values()) if (typeof ps.captured === 'string') input.capture.update(ps.captured, { track: tid });
      }
    } catch { /* best effort: the take is in */ }
    const res = { ok: true, take: r.id, why, label: plan.label, summary: plan.summary, parts: made, clips, lanes: plan.lanes || [], txn: d.txn?.id, audio: audioRes ? { asset: audioRes.asset, seconds: audioRes.seconds } : null, ...(lean ? { lean: { beats: lean.lean, ms: lean.ms, by: lean.by, moved: lean.moved, opening: lean.opening, words: leanWords(lean) } } : {}) };
    // the notes a source moved on their way in (a hum snapped into the key), found in the song now, and the ops that put
    // them back as played (one notes.set per clip, one undo step): input/hum.js says how many, with Undo
    const sung = sungOf(plan.parts, made, d.created);
    if (sung) res.sung = sung;
    // its timing, for Tight / Loose / As played: every note this take put in, tidy and as played (song beats)
    const planned = [];
    for (const pt of r.parts.values()) for (const ps of pt.passes.values()) for (const n of ps.notes) planned.push({ p: n.p, t: n.t, raw: n.raw, lean: n.gen?.lean || 0 });
    const srcs = new Set([...r.parts.values()].flatMap((pt) => [...pt.srcs]));
    timing = timingOf(made, planned, null, srcs.has('hum') ? 'hum' : [...r.parts.values()].some((pt) => pt.drums) ? 'pads' : 'keys');
    last = res;
    const playing = made.find((x) => x.mode === 'take') || made[0];
    const au = made.find((x) => store.track(x.track)?.kind === 'audio');
    if (audioRes && au) {
      const ac = au.clips[au.clips.length - 1];
      input.emit('take', { track: au.track, clip: ac, asset: audioRes.asset, seconds: audioRes.seconds, startBeat: store.clip(au.track, ac)?.start, latency: audioRes.latency });
    }
    // the track the take went onto is selected (the next take, and the keys, follow the idea you just made), and each
    // kind's aim follows it: a one-shot "A new track" is spent, and that track is the last take's
    // (a take of only automation, a knob moved while it recorded, has no part: the selection stays)
    if (playing) ownSelect({ track: playing.track, clip: clips[clips.length - 1] || null, notes: [] });
    for (const x of made) for (const k of x.kinds || []) took(k, x.track);
    try { app.arranger?.show?.(clips, 'you'); } catch { /* no arranger */ }
    // a take that muted what played under it: "Put it on its own track" (both play, each on its own sound)
    const st = made.find((x) => x.stacked && x.mode === 'take' && store.track(x.track)?.kind === 'instrument');
    if (st) {
      const active = st.clips[st.clips.length - 1];
      res.stacked = { track: st.track, clip: active, kind: (st.kinds || [])[0] || 'keys', names: st.stacked.names, unmute: st.stacked.unmute.map((u) => d.created[u] || u).filter(Boolean) };
    }
    const text = why === 'silence' ? `Silenced. ${made.map((x) => (x.mode === 'layer' ? `${x.name} kept (${x.bars}).` : `Take ${x.takes} kept on ${x.name} (${x.bars}).`)).join(' ')}` : `${plan.summary} Undo takes it back.`;
    // (a short song: "Make it 8 bars" beside it, ui/sketch.js app.song.offer)
    const more = why === 'silence' ? null : app.song?.offer?.({ bars: 8 }) || null;
    const own = res.stacked && why !== 'silence' ? ownOffer(res.stacked) : null;
    // the sound card's line ("What should it sound like? Sounds"), when ui/sounds.js has one for this take
    let line = null;
    try { line = app.sounds?.toastLine?.(res) || null; } catch { line = null; }
    const parts = [text, more ? ' ' : null, more, own ? ' ' : null, own, line ? ' ' : null, line].filter(Boolean);
    app.ui?.toast?.(parts.length > 1 ? parts : text, { kind: 'ok', ms: 6000, action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    return res;
  }

  // A take stacked over what played on its track, onto a track of its own: a track from newPartFor with the same
  // instrument, the take moved there out of its folder, what it muted playing again. One dispatch by you, one undo step.
  // s: commit's res.stacked { track, clip, kind, unmute }
  function ownTrack(s = last?.stacked) {
    const t = s && store.track(s.track), c = t && store.clip(t.id, s.clip);
    if (!c) return { ok: false, error: 'that take isn’t on its track any more' };
    const np = newPartFor(s.kind, P()), inst = t.instrument ? JSON.parse(JSON.stringify(t.instrument)) : { device: np.device, params: {} };
    const ops = [
      { type: 'track.add', ref: 'own', index: P().tracks.indexOf(t) + 1, track: { name: np.name, kind: 'instrument', instrument: { device: inst.device, params: inst.params || {} } } },
      { type: 'clip.move', track: t.id, clip: c.id, toTrack: '$own' },
      { type: 'clip.set', track: '$own', clip: c.id, patch: { take: null, ...(c.mute ? { mute: false } : {}) } },
      ...(s.unmute || []).filter((id) => store.clip(t.id, id)?.mute).map((id) => ({ type: 'clip.set', track: t.id, clip: id, patch: { mute: false } })),
    ];
    const d = store.dispatch(ops, { by: 'you', label: `${c.name || 'the take'} onto its own track` });
    if (!d.ok) { app.ui?.toast?.(`Couldn’t put it on its own track: ${d.error}`, { kind: 'bad' }); return d; }
    const id = d.created.own;
    ownSelect({ track: id, clip: c.id, notes: [] });
    took(s.kind, id);
    const text = `${c.name || 'The take'} is on ${np.name} now, and ${andList(s.names || ['what it covered'])} ${(s.names || []).length > 1 ? 'play' : 'plays'} again on ${t.name}.`;
    app.ui?.toast?.(text, { kind: 'ok', action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    return { ...d, track: id, clip: c.id, text };
  }
  function ownOffer(s) {
    try {
      if (typeof document === 'undefined') return null;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-txt ew-toast-act rec-own';
      b.textContent = 'Put it on its own track';
      b.addEventListener('click', (e) => { ownTrack(s); e.currentTarget.closest('.ew-toast')?.remove(); });
      return b;
    } catch { return null; }
  }

  // parts: planTake's (each with its sung locators), made: the same with their tracks' ids, created: the dispatch's refs
  //   -> { notes, ops: [notes.set] } | null
  function sungOf(parts, made, created) {
    const groups = new Map();
    let n = 0;
    parts.forEach((x, i) => {
      const tid = made[i]?.track, used = new Set();
      for (const s of x.sung || []) {
        const cid = s.clip || created[s.ref], c = tid && cid ? store.clip(tid, cid) : null;
        const nt = c && (c.notes || []).find((m) => !used.has(m.id) && m.p === s.p && Math.abs(m.t - s.t) < 1e-3);
        if (!nt) continue;
        used.add(nt.id);
        if (!groups.has(cid)) groups.set(cid, { type: 'notes.set', track: tid, clip: cid, notes: [] });
        groups.get(cid).notes.push({ id: nt.id, p: s.was });
        n++;
      }
    });
    return n ? { notes: n, ops: [...groups.values()] } : null;
  }

  function cancel({ stopTransport = true } = {}) {
    const r = R;
    if (!r) return;
    R = null;
    clearInterval(r.timer);
    if (r.free) {
      try { if (r.hum) Promise.resolve(r.humStart).then(() => { if (!R && input.hum?.active) input.hum.cancel(); }).catch(() => {}); } catch { /* ok */ }
      try { input.tap?.discard?.(); } catch { /* ok */ }
      unmake(r);
      setState(r, 'idle');
      return;
    }
    if (r.audio) { r.audio.off && r.audio.off(); r.audio = null; input.audio._recording(false); }
    releasePreviews(r);
    if (input.autorec) input.autorec.finish(r, { cancel: true });
    try { engine.recording = false; } catch { /* ok */ }
    if (stopTransport && (engine.playing || engine.starting)) engine.stop();   // (a count still waiting to start too)
    // the hum: one R started goes with the take (the mic closes; nothing was recorded); one you started yourself (H,
    // then R) is yours again, and H stops it into Sketch as before
    if (input.hum) {
      if (r.hum) Promise.resolve(r.humStart).then(() => { if (!R && input.hum.active) input.hum.cancel(); }).catch(() => {});
      else if (r.joined && input.hum.active) input.hum.leave?.();
    }
    setState(r, 'idle');
    unmake(r);
  }

  /* ---- the transport and the song moving under a take */
  try {
    engine.on('transport', (e) => {
      const r = R;
      if (!r || !e || r.free) return;
      if (e.why === 'stop' && !e.playing) {
        r.stopG = r.lastG;
        // (the killswitch emits 'silence' right after this stop: it commits with its own words)
        setTimeout(() => { if (R === r) (r.state === 'count' ? cancel({ stopTransport: false }) : stop({ keepPlaying: true, why: r.silenced ? 'silence' : 'stop' })); }, 0);
      } else if ((e.why === 'seek' || e.why === 'play') && r.started && !r.closing) {
        // (the grid has already jumped to where the playhead went: the take ends where it was, the last tick's grid
        // moved on by the time since it)
        const at = fin(r.lastG) && fin(r.lastT) ? r.lastG + Math.max(0, Math.min(0.5, (performance.now() - r.lastT) / 1000 / spbNow())) : null;
        stop({ keepPlaying: true, why: 'seek', at });
      }
      else tick();
    });
    engine.on('silence', () => { if (R) R.silenced = true; });
  } catch { /* no engine (Node) */ }
  // tempo, meter or the loop changing mid-take: the take so far goes in (it was placed on the old timeline)
  store.on('change', (e) => {
    if (e && e.kind === 'load') {
      // (another song: its own target, and its own aim)
      lastSel = selTrack = null; selAt = 0;
      A.choice = none(); A.last = none(); A.lastAt = { hum: 0, keys: 0, pads: 0 };
      aimChanged();
    } else if (e && e.kind !== 'preview' && (e.ops || []).some((o) => o && (/^track\./.test(o.type) || o.type === 'instrument.set'))) {
      // the full studio: an arm set or cleared by hand is the newest deliberate act, so Onto's choice gives way to it
      if (!mine && e.kind === 'do' && e.by === 'you' && viewOf() === 'full' && e.ops.some((o) => o.type === 'track.set' && o.patch && 'arm' in o.patch)) clearChoices();
      aimChanged();
    }
    const r = R;
    if (!r || !e || e.kind === 'preview') return;
    const p = P();
    if (e.kind === 'load') { cancel(); return; }
    if (r.free) return;   // (a free take has no timeline to move under it)
    if (p.tempo !== r.tempo || p.meter.join('/') !== r.meter || JSON.stringify(p.loop || null) !== r.loopKey) stop({ keepPlaying: true, why: 'time' });
  });
  try { document.addEventListener('visibilitychange', () => { if (document.hidden && R) (R.state === 'count' ? cancel() : stop({ why: 'hidden' })); }); } catch { /* node */ }

  /* ---- Shift+R: Put it in the song */
  function captureToSong(id = null) {
    const cap = input.capture;
    cap.flush?.();
    try { if (input.tap?.take) input.tap.flush(); } catch { /* ok */ }
    const ph = id ? cap.get(id) : [...cap.phrases].reverse().find((x) => !x.hidden && !x.rec && x.kind !== 'audio' && (x.notes || []).length);
    if (!ph) { app.ui?.toast?.('Nothing played yet. Play, tap or hum something, then Shift+R puts it in the song.'); return { ok: false, error: 'nothing captured' }; }
    const t = ph.kind === 'drums' ? targetFor('pads') : targetFor(ph.src === 'hum' ? 'hum' : 'keys');
    const r = cap.keep(ph.id, t ? { track: t.id } : { newTrack: newPartFor(ph.kind === 'drums' ? 'pads' : ph.src === 'hum' ? 'hum' : 'keys', P()) });
    if (!r.ok) { app.ui?.toast?.(r.error, { kind: 'bad' }); return r; }
    const c = store.clip(r.track, r.clip), tr = store.track(r.track), n = c && c.notes ? c.notes.length : 0;
    const bars = c ? barsOf(bpbNow(), c.start, c.start + c.length) : '';
    app.ui?.toast?.(`Put in the song: ${plural(n, ph.kind === 'drums' ? 'hit' : 'note')} on ${tr ? tr.name : 'the track'} at ${bars}${ph.beat != null ? ', where you played them' : ''}.`, { kind: 'ok', action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    return { ...r, bars, notes: n };
  }

  const rec = {
    get state() { return R ? R.state : 'idle'; },
    get active() { return !!R; },
    get target() { return primary()?.id || null; },
    humming, lands, onto,
    get last() { return last; },
    get countIn() { return Number.isFinite(saved.countIn) ? saved.countIn : 1; },
    // the click a take hears: the click, or the transport's click for takes (ui/transport.js: on unless turned off).
    // Off altogether, over a song with nothing in it, a take from Tap it or Hum it is free: the grid follows you.
    // setCaptureClick(false) turns both off; (true) turns the click for takes on
    get captureClick() { const c = app.transport?.click?.get?.(); return c ? !!(c.on || c.takes) : saved.captureClick !== false; },
    setCaptureClick(on) {
      const c = app.transport?.click;
      if (c?.set) c.set(on ? { takes: true } : { takes: false, on: false });
      else { saved.captureClick = !!on; try { localStorage.setItem(SAVE, JSON.stringify(saved)); } catch { /* ok */ } }
      emit('state', { state: rec.state, captureClick: !!on });
      return !!on;
    },
    // a take now would be free (no click, nothing in the song to play along to, nothing playing)
    wouldBeFree: () => !R && !rec.captureClick && !engine.playing && silentSong(),
    get free() { return !!(R && R.free); },
    // the last take's timing (Tight, Loose, As played): { level, kind ('pads' | 'hum' | 'keys'), notes } or null while
    // its notes are in the song; retime(level) moves it
    get timing() { return timing && timing.clips.some((c) => store.clip(c.track, c.clip)) ? { level: timing.level, kind: timing.kind, notes: timing.clips.reduce((a, c) => a + c.notes.length, 0) } : null; },
    retime: (level) => retime(level),
    setCountIn(bars) { saved.countIn = Math.max(0, Math.min(4, Math.round(+bars || 0))); try { localStorage.setItem(SAVE, JSON.stringify(saved)); } catch { /* ok */ } emit('state', { state: rec.state, countIn: saved.countIn }); return saved.countIn; },
    targetFor, modeFor, primary, aim, setAim, took, keysTrack,
    ownTrack: (s) => ownTrack(s),
    // what R records now ('hum' | 'pads' | 'keys'): the kind the lit R and Onto speak for
    kindNow: () => kindNow(),
    view: () => viewOf(),
    // a select made for the person (a take kept, a track made): the selection follows it, and it isn't their act
    select: (x) => ownSelect(x),
    setMode(track, mode) { const t = typeof track === 'string' ? store.track(track) : track; if (t && (mode === 'layer' || mode === 'take')) modes.set(t.id, mode); return t ? modeFor(t) : null; },
    // the tracks a take in progress records onto
    get tracks() { return R ? [...new Set([...[...R.parts.values()].map((x) => x.track), R.audioTrack].filter(Boolean))] : []; },
    record: (o) => record(o),
    stop: (o) => stop(o),
    cancel: () => cancel(),
    // R during the count cancels it: the song stops if R started it, and plays on if it was already playing
    toggle() { if (!R) return record(); if (R.state === 'count') { cancel({ stopTransport: !R.wasPlaying }); return Promise.resolve(null); } return stop({ keepPlaying: true, why: 'punch' }); },
    capture: (id) => captureToSong(id),
    noteOn, noteOff, hit,
    // the hum and the beatbox hand their notes in on the grid (input/hum.js, input/tap.js)
    // left: an array that gets the notes the take didn't take (before it began, or no take any more), each with its
    // song beat (null when there's no take to place it by), so the caller keeps them in capture
    addNotes(notes, { src = 'hum', left = null } = {}) {
      const r = R;
      if (!r) { if (left) left.push(...notes.map((n) => ({ ...n, beat: null }))); return 0; }
      const t = src === 'beatbox' ? null : targetFor(src === 'hum' ? 'hum' : 'keys');
      let k = 0;
      for (const n of notes) {
        if (src === 'beatbox') { if (hit(n.row, n.v, { g: n.g, src })) k++; continue; }
        const pt = partOf(r, t, 'notes', { name: src === 'hum' ? 'Hummed' : null, src, part: src === 'hum' ? 'hum' : 'keys' });
        // (a hum against the click was placed by the forgiving grid, input/hum.js, unless you keep your own timing)
        const gentle = src === 'hum' && Number.isFinite(n.graw) && !input.hum?.options?.keepTiming ? { coarse: 0.5, fine: input.hum?.options?.grid || 0.25, tol: 0.35, fineTol: 0.3 } : null;
        if (addNote(r, pt, { p: n.p, v: n.v ?? 0.8, g: n.g, dg: n.d, src, was: n.was, graw: n.graw, gentle })) k++;
        else if (left) left.push({ ...n, beat: r4(where(n.g, r).beat) });
      }
      return k;
    },
    // the take a note played now goes into (an R take recording, or in the count's last eighth), or null: capture marks
    // its own copy of the note so (input/capture.js), and a phrase that is all in a take isn't listed twice
    takeNow() {
      const r = R;
      if (!r || r.closing) return null;
      if (r.state === 'rec') return r.id;
      const g = gridNow(r, eventTime());
      return g != null && g >= r.span.g0 - EARLY - EPS ? r.id : null;
    },
    // the take's grid now; atClock: the grid that goes with ctx.currentTime (for a (ctx time, grid) pair: hum, beatbox)
    gridNow: (atClock = false) => (R && atClock && engine.playing && fin(engine.gridBeat) ? engine.gridBeat - (R.offset ?? 0) : gridNow()),
    where: (g) => (R ? where(g) : null),
    live() {
      const r = R;
      if (!r) return null;
      if (r.free) return { state: r.state, take: r.id, free: true, track: lands()?.id || null, tracks: [], from: 0, now: 0, pass: 0, loop: null, counting: null, passes: [], held: [], peaks: [], trace: input.hum?.active ? input.hum.trace().slice(-400) : [] };
      const g = gridNow(r), w = g == null ? null : where(Math.max(g, r.span.g0), r);
      const passes = [];
      for (const pt of r.parts.values()) for (const ps of pt.passes.values()) passes.push({ n: ps.n, track: pt.track, mode: pt.mode, drums: pt.drums, notes: ps.notes.map(({ p, t, d, v }) => ({ p, t, d, v })), raw: ps.notes.map((x) => x.raw), replaced: ps.replaced || 0 });
      // (a key held from just before the loop's end is drawn where it will land: the next pass's downbeat)
      const held = [...r.held.values()].map((h) => { const x = landing(r, h.g); return { p: h.p, t: x.beat, d: Math.max(0, (g ?? h.g) - Math.max(h.g, r.span.g0) - x.early), v: h.v, track: h.track, held: true }; });
      return {
        state: r.state, take: r.id, track: lands()?.id || null, tracks: rec.tracks, from: r.span.b0, keeps: r.keeps || null, now: engine.beat, pass: w ? w.pass : 0,
        loop: r.span.loop, counting: r.state === 'count' ? { until: r.span.b0, beats: Math.max(0, r.span.g0 - (g ?? r.span.g0)) } : null,
        passes: passes.sort((a, b) => a.n - b.n), held, peaks: r.audio ? r.audio.peaks.slice(-600) : [], trace: input.hum?.active ? input.hum.trace().slice(-400) : [],
      };
    },
    passes() { const r = R; if (!r) return []; const out = []; for (const pt of r.parts.values()) for (const ps of pt.passes.values()) out.push({ n: ps.n, track: pt.track, notes: ps.notes.length }); return out.sort((a, b) => a.n - b.n); },
    // ⌘Z while recording: the last completed pass comes out of the take (capture keeps it)
    // (again: the pass before that one; a pass taken out stays out, its audio too)
    undoPass() {
      const r = R;
      if (!r || !r.pass) return null;
      r.dropped = r.dropped || new Set();
      let n = r.pass - 1;
      while (n >= 0 && r.dropped.has(n)) n--;
      if (n < 0) return null;
      r.dropped.add(n);
      let k = 0;
      for (const pt of r.parts.values()) {
        const ps = pt.passes.get(n);
        if (!ps) continue;
        k += ps.notes.length;
        pt.passes.delete(n);
        if (pt.mode === 'layer') {
          // its previews come out too: release all, then hear the passes that stay
          releasePreviews({ parts: new Map([[0, pt]]) });
          for (const q of pt.passes.values()) for (const x of q.notes) preview(r, pt, x);
        }
      }
      const moves = input.autorec ? input.autorec.undoPass(n) : 0;   // (and its knob moves, input/autorec.js)
      return { pass: n, notes: k, moves };
    },
    on(t, fn) { if (!fns.has(t)) fns.set(t, new Set()); fns.get(t).add(fn); return () => fns.get(t).delete(fn); },
  };
  input.autorec = createAutorec(app, input, rec);
  return rec;
}
