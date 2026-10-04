// Following a part as someone plays it [core]: which of its notes they hit, early or late, and which went by unheard,
// judged by pitch and onset; a chord by when it is struck and its lowest note only, because a pitch tracker hears one
// note at a time (input/pitch.js, input/onsets.js) and a judge that marked a chord wrong for notes it couldn't hear would
// be lying. A line after each pass says it plainly ("11 of 14, the bend in bar 10 is late"). Pure (no DOM, no clock:
// every time comes in as a song beat), so the Jam room's tab lane (ui/tabs.js) and tools/tabs-test.js share the rules.
//
//   groupsOf(notes, { start, bpb, key }) -> [{ i, t (song beat), d, p (the lowest pitch), ps, n, bend, s, f, bar, beat }]
//       the part's onsets: notes that start within 30 ms-ish (0.03 beats) of each other are one chord
//   createFollow(groups, { msPerBeat }) -> follow
//     follow.hear({ p, beat, src, ps }) -> { i, mark: 'hit' | 'early' | 'late', ms } | { wrong: true, i, p } | null
//     follow.passed(beat) -> [i, ...] the groups gone by unheard since the last call (marked 'missed')
//     follow.marks: Map(i -> { mark, ms, p }) ; follow.wrongs: [{ i, p }] ; follow.reset() ; follow.summary(opts)
//     follow.msPerBeat (settable: the practice speed changes it)
//   matchPitch(group, p, src, ps) -> does p play this group (its lowest note; a bend's landing; an octave off for the
//       guitar, where trackers slip; or one of the guitar's other candidates for that onset, ps)
//   windowsOf(groups, i, msPerBeat) -> { hit, late } in ms: on time within `hit`, early or late out to `late`
//   passLine(groups, marks, wrongs, { key }) -> the line after a pass
//   describeGroup(g, key) -> "the bend in bar 10", "the chord on beat 1 of bar 9", "the A on the and of 2 of bar 9"

import { beatsPerBar, spellPc, noteName } from './music.js';

const TOGETHER = 0.03;
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;
const bendTop = (b) => (typeof b === 'number' ? b : Array.isArray(b) ? b.reduce((m, x) => (Math.abs(x[1]) > Math.abs(m) ? x[1] : m), 0) : 0);

export function groupsOf(notes, { start = 0, bpb = 4 } = {}) {
  const ns = (notes || []).filter((n) => Number.isFinite(+n.p) && Number.isFinite(+n.t)).map((n) => ({ ...n, at: start + +n.t })).sort((a, b) => a.at - b.at || a.p - b.p);
  const out = [];
  for (const n of ns) {
    const g = out[out.length - 1];
    if (g && n.at - g.t <= TOGETHER) { g.ps.push(Math.round(n.p)); g.n++; g.d = Math.max(g.d, +n.d || 0); continue; }
    out.push({ i: out.length, t: n.at, d: +n.d || 0.25, p: Math.round(n.p), ps: [Math.round(n.p)], n: 1, bend: n.bend ? Math.round(bendTop(n.bend)) : 0, s: n.s, f: n.f });
  }
  for (const g of out) {
    g.p = Math.min(...g.ps);
    const bar = Math.floor(g.t / bpb + 1e-6);
    g.bar = bar + 1;
    g.beat = Math.round((g.t - bar * bpb) * 1000) / 1000 + 1;   // 1-based, fractional
  }
  return out;
}

// On time within `hit` ms; early or late out to `late`. Tighter where notes come thick and fast (a 16th run), never
// tighter than 35 ms (what an input event's timing can promise) nor looser than 75 / 200.
export function windowsOf(groups, i, msPerBeat) {
  const g = groups[i];
  const gaps = [groups[i - 1], groups[i + 1]].filter(Boolean).map((x) => Math.abs(x.t - g.t) * msPerBeat);
  const gap = gaps.length ? Math.min(...gaps) : Infinity;
  const hit = Math.max(35, Math.min(75, gap * 0.35));
  const late = Math.max(hit + 25, Math.min(200, gap * 0.6));
  return { hit, late };
}

// ps: the guitar's other candidates for the same onset (input/onsets.js): a string still ringing from the note before
// can put the right pitch second, and that is the guitarist's note, not a wrong one
export function matchPitch(g, p, src = 'keys', ps = null) {
  const one = (x) => {
    const q = Math.round(x);
    if (q === g.p) return true;
    if (g.bend && q === g.p + g.bend) return true;          // heard after the bend landed
    if (src === 'guitar' && Math.abs(q - g.p) === 12) return true;   // a tracker's octave slip, never a wrong note
    return false;
  };
  return one(p) || (src === 'guitar' && Array.isArray(ps) && ps.some(one));
}

export function createFollow(groups, { msPerBeat = 500 } = {}) {
  const f = {
    groups, msPerBeat,
    marks: new Map(),
    wrongs: [],
    gone: 0,   // the groups passed() has looked at
    reset() { f.marks = new Map(); f.wrongs = []; f.gone = 0; },
    hear({ p, beat, src = 'keys', ps = null }) {
      if (!Number.isFinite(beat) || !Number.isFinite(+p)) return null;
      let best = null;
      for (const g of groups) {
        const ms = (beat - g.t) * f.msPerBeat;
        const w = windowsOf(groups, g.i, f.msPerBeat);
        if (Math.abs(ms) > w.late) continue;
        // a note of a chord that has been heard already (its other strings, a doubled pick) is part of it
        if (f.marks.has(g.i)) { if (g.ps.includes(Math.round(p)) || matchPitch(g, p, src, ps)) return null; continue; }
        if (!matchPitch(g, p, src, ps)) continue;
        if (!best || Math.abs(ms) < Math.abs(best.ms)) best = { g, ms, w };
      }
      if (best) {
        const mark = Math.abs(best.ms) <= best.w.hit ? 'hit' : best.ms < 0 ? 'early' : 'late';
        f.marks.set(best.g.i, { mark, ms: Math.round(best.ms), p: Math.round(p) });
        return { i: best.g.i, mark, ms: Math.round(best.ms) };
      }
      // a wrong note where a note was due (not noodling between them): said in the line if it's what went wrong
      const due = groups.find((g) => !f.marks.has(g.i) && Math.abs((beat - g.t) * f.msPerBeat) <= windowsOf(groups, g.i, f.msPerBeat).hit + 30);
      if (due) { f.wrongs.push({ i: due.i, p: Math.round(p) }); return { wrong: true, i: due.i, p: Math.round(p) }; }
      return null;
    },
    // the groups the playhead has gone past without being heard (each once)
    passed(beat) {
      const out = [];
      for (const g of groups) {
        if (f.marks.has(g.i)) continue;
        if (beat - g.t > windowsOf(groups, g.i, f.msPerBeat).late / f.msPerBeat) { f.marks.set(g.i, { mark: 'missed', ms: null, p: null }); out.push(g.i); }
      }
      return out;
    },
    summary(opts = {}) {
      const count = (m) => [...f.marks.values()].filter((x) => x.mark === m).length;
      return { total: groups.length, hit: count('hit'), early: count('early'), late: count('late'), missed: groups.length - count('hit') - count('early') - count('late'), wrong: f.wrongs.length, line: passLine(groups, f.marks, f.wrongs, opts) };
    },
  };
  return f;
}

const BEAT_WORD = { 0: '', 0.25: 'the e of ', 0.5: 'the and of ', 0.75: 'the a of ' };
function beatWords(g) {
  const b = Math.floor(g.beat + 1e-6), frac = Math.round((g.beat - b) * 100) / 100;
  const w = BEAT_WORD[frac];
  return w == null ? `beat ${b}` : w ? `${w}${b}` : `beat ${b}`;
}
export function describeGroup(g, key = null) {
  if (g.bend) return `the bend in bar ${g.bar}`;
  if (g.n > 1) return `the chord on ${beatWords(g)} of bar ${g.bar}`;
  const name = key ? spellPc(pcOf(g.p), key) : noteName(g.p).replace(/-?\d+$/, '');
  return `the ${name} on ${beatWords(g)} of bar ${g.bar}`;
}
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

// "11 of 14, the bend in bar 10 is late." The count is the notes on time; then the one thing most worth saying: a bend
// off the beat, a steady lean early or late, the note furthest off, a wrong note where one was due, what wasn't heard.
export function passLine(groups, marks, wrongs = [], { key = null } = {}) {
  const total = groups.length;
  if (!total) return '';
  const of = (m) => groups.filter((g) => marks.get(g.i)?.mark === m);
  const hit = of('hit'), early = of('early'), late = of('late');
  const heard = hit.length + early.length + late.length, missed = total - heard;
  const head = `${hit.length} of ${total}`;
  if (hit.length === total) return `${head}, all in time.`;
  if (!heard) return `Nothing heard this pass: ${total === 1 ? 'the note' : `all ${total} notes`} went by.`;
  const off = [...early, ...late];
  const bend = off.find((g) => g.bend);
  if (bend) return `${head}, ${describeGroup(bend, key)} is ${marks.get(bend.i).mark}.`;
  if (off.length >= 3) {
    const ms = off.map((g) => marks.get(g.i).ms), m = median(ms);
    if (ms.every((x) => Math.sign(x) === Math.sign(m)) && Math.abs(m) >= 30) return `${head}, running about ${Math.round(Math.abs(m) / 10) * 10} ms ${m > 0 ? 'late' : 'early'}${missed ? `, ${missed} not heard` : ''}.`;
  }
  if (off.length) {
    const worst = off.reduce((a, b) => (Math.abs(marks.get(b.i).ms) > Math.abs(marks.get(a.i).ms) ? b : a));
    const more = off.length > 1 ? ` (${off.length} off the beat in all)` : '';
    return `${head}, ${describeGroup(worst, key)} is ${marks.get(worst.i).mark}${more}${missed ? `, ${missed} not heard` : ''}.`;
  }
  const w = wrongs.find((x) => marks.get(x.i)?.mark === 'missed' || !marks.has(x.i));
  if (w) { const g = groups[w.i]; return `${head}, ${describeGroup(g, key)} came out as ${key ? spellPc(pcOf(w.p), key) : noteName(w.p).replace(/-?\d+$/, '')}${missed > 1 ? `, ${missed} not heard` : ''}.`; }
  if (missed === 1) { const g = groups.find((x) => marks.get(x.i)?.mark !== 'hit'); return `${head}, ${describeGroup(g, key)} wasn't heard.`; }
  return `${head}, ${missed} not heard.`;
}

// Learn it (the room's wait mode): does a played note play the group the transport is waiting on?
export const learnStep = (groups, i, p, src, ps = null) => !!groups[i] && matchPitch(groups[i], p, src, ps);
export { beatsPerBar };
