// Recording in the song (docs/research/RECORDING-UX.md, wave A2: app/src/input/recorder.js).
//   1. Node: the commit plans (planTake): Layer adds into the clip under the notes and makes clips only where there are
//      none; New take stacks passes as one take group (the last plays) and splits and mutes what it covers, in one undo
//      step; the loop pass map (passOf) across wraps.
//   2. The studio (Night Shift, 92 bpm, real key events against the running song): R at bar 5 with the count-in puts
//      notes at bar 5 (±1/32), a note in the count's last eighth on the downbeat; the New take mutes the covered part;
//      Layer over the demo's Beat adds into that clip; two loop passes give one clip (pads) or two takes (keys); the
//      punch ignores notes outside the loop; the killswitch during a take commits it; an agent's edit to the target
//      while recording is refused (and get_recording says so); a hum from a synthesized voice with the song playing
//      lands on its bar; the Inspector's input (device, channel 3 of a four-channel interface) is the one recorded;
//      Shift+R puts a played-along phrase in the song at its beats.
//   3. Fresh eyes 4, Node and the studio: a tune played on round the loop's end stays one take (joinSeams), a fragment
//      of a last pass never plays over a fuller one (pickActive), the toast says which, and Sketch's Takes lists each
//      pass once (the played phrase that went into the take isn't a second card).
//   4. Fresh eyes 5: takes are numbered in the order they were recorded (a complete first pass is Take 1 and plays, the
//      pass the stop cut short is Take 2); a note begun just before the loop comes round, in your own timing and held
//      over the wrap, is the next pass's downbeat, not a stub at the end of the pass before, and ⌘Z takes it out with
//      that pass ("(5 notes)").
//
//   node tools/record-test.js
import { open, tally } from './pw.js';
import { createStore } from '../app/src/core/store.js';
import { createProject, cleanProject } from '../app/src/core/project.js';
import { demoProject } from '../app/src/core/demo.js';
import { planTake, passRange, joinSeams, pickActive, createRecorder } from '../app/src/input/recorder.js';
import { newPartFor, kindOfTake, soundsFor, familyOf, SOUND_SETS } from '../app/src/core/sounds.js';
import { tuneOf } from '../app/src/input/tap.js';
import { takeFolders, takeNumber, planClipTrim } from '../app/src/core/arrangement.js';
import { passOf, passGrid } from '../app/src/input/capture.js';
import { phrase, render as renderVoice } from './hum-bench.js';

const t = tally('record');
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]])) : v));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------------ 1. Node: the plans */
{
  // the pass map: a take from beat 6 in the loop [4, 12): pass 0 is 6..12, then the loop again and again
  const span = { g0: 6, b0: 6, loop: { start: 4, end: 12 }, wrap: 12 };
  const at = (g) => { const w = passOf(g, span); return `${w.pass}:${w.beat}`; };
  const at4 = (g) => { const w = passOf(g, span); return `${w.pass}:${Math.round(w.beat * 1e4) / 1e4}`; };
  t.ok([6, 11.5, 12, 19.99, 20, 30].map(at4).join(' ') === '0:6 0:11.5 1:4 1:11.99 2:4 3:6', `passOf: the unwrapped grid to (pass, song beat) across wraps (${[6, 11.5, 12, 19.99, 20, 30].map(at4).join(' ')})`);
  t.ok(passGrid(0, span).join() === '6,12' && passGrid(2, span).join() === '20,28' && passGrid(0, { g0: 3, b0: 3, loop: null, wrap: Infinity }).join() === '3,Infinity', 'passGrid: the grid each pass covers');

  const song = cleanProject(demoProject());
  const drums = song.tracks.find((x) => x.name === 'Drums'), keys = song.tracks.find((x) => x.name === 'Keys');
  const beat = drums.clips[0];
  // Layer: hits over the Beat go into it, never a second clip, never a doubled hit
  const store = createStore(song);
  const before = canon(store.get().tracks);
  const dup = beat.notes[0];
  const lay = planTake(store.get(), { id: 'tk_test01', parts: [{ track: drums.id, kind: 'notes', mode: 'layer', drums: true, name: 'Tapped beat', span: { start: 0, end: 32 }, passes: [
    { n: 0, notes: [{ p: 39, t: 4.5, d: 0.25, v: 0.8 }, { p: dup.p, t: beat.start + dup.t, d: 0.25, v: 0.8 }] },
    { n: 1, notes: [{ p: 39, t: 4.5, d: 0.25, v: 0.9 }, { p: 39, t: 6.5, d: 0.25, v: 0.7 }] },
  ] }] });
  t.ok(lay.ops.length === 1 && lay.ops[0].type === 'notes.add' && lay.ops[0].clip === beat.id && lay.ops[0].notes.length === 2, `Layer: two passes' hits go into the Beat clip as one notes.add (${lay.ops.map((o) => o.type + ':' + (o.notes?.length ?? '')).join(', ')}): the repeat merges (louder wins), the hit already there isn't doubled`);
  t.ok(lay.ops[0].notes.find((n) => n.t === 4.5)?.v === 0.9 && /^Your beat is in: bars 1–2, 3 hits on Drums \(1 already there\)\.$/.test(lay.summary) && lay.parts[0].notes === 3, `and says so, counting your own hits and their own bars (the one on a hit already there merged, and said so): "${lay.summary}"`);
  // Layer onto an empty track: one clip over the take's span
  const s2 = createStore(createProject());
  const tr = s2.dispatch({ type: 'track.add', ref: 'd', track: { name: 'Beat', instrument: { device: 'core.drums' } } }).created.d;
  const lay2 = planTake(s2.get(), { id: 'tk_test02', parts: [{ track: tr, kind: 'notes', mode: 'layer', drums: true, span: { start: 0, end: 8 }, passes: [{ n: 0, notes: [{ p: 36, t: 0, d: 0.25, v: 0.8 }] }, { n: 1, notes: [{ p: 38, t: 5, d: 0.25, v: 0.8 }] }] }] });
  t.ok(lay2.ops.length === 1 && lay2.ops[0].type === 'clip.add' && lay2.ops[0].clip.start === 0 && lay2.ops[0].clip.length === 8 && lay2.ops[0].clip.notes.length === 2, `Layer on an empty track: one clip over the loop, bars 1–2, with both passes (${JSON.stringify(lay2.ops[0].clip && { start: lay2.ops[0].clip.start, length: lay2.ops[0].clip.length, notes: lay2.ops[0].clip.notes.length })})`);

  // New take over the Changes clip (beats 0–32), from bar 5: split at 16, the covered half muted into the take group,
  // two passes: the first muted, the last playing
  const take = planTake(store.get(), { id: 'tk_test03', parts: [{ track: keys.id, kind: 'notes', mode: 'take', passes: [
    { n: 0, clip: { start: 16, end: 32 }, notes: [{ p: 60, t: 16.5, d: 1, v: 0.8 }] },
    { n: 1, clip: { start: 16, end: 32 }, notes: [{ p: 64, t: 17, d: 1, v: 0.8 }] },
  ] }] });
  const r = store.dispatch(take.ops, { by: 'you', label: take.label });
  const k = store.track(keys.id);
  const group = k.clips.filter((c) => c.take === 'tk_test03');
  t.ok(r.ok && store.history.length === 1 && k.clips.length === 4 && group.length === 3, `one dispatch, one undo step: Keys has the first half, the covered half and two takes (${k.clips.map((c) => `${c.start}+${c.length}${c.mute ? ' muted' : ''}${c.take ? ' ' + c.take : ''}`).join(', ')})`);
  const playing = group.filter((c) => !c.mute);
  t.ok(playing.length === 1 && playing[0].name === 'Take 3' && playing[0].notes.length === 1 && playing[0].notes[0].p === 64 && playing[0].notes[0].t === 1, `the last pass plays ("${playing[0]?.name}"), the first pass and the covered half are kept, muted`);
  t.ok(/Take 3 is in on Keys, bars 5–8; Changes is muted\. One more underneath, muted\./.test(take.summary) && take.label === 'record take 3 on Keys', `"${take.summary}" (${take.label})`);
  t.ok(k.clips.find((c) => c.id === keys.clips[0].id).length === 16 && !k.clips.find((c) => c.id === keys.clips[0].id).mute, 'the part before bar 5 keeps playing');
  store.undo();
  t.ok(canon(store.get().tracks) === before, 'undo takes the whole take out and puts the clip back exactly');
  // the next take over a take group joins it
  store.dispatch(take.ops, { by: 'you' });
  const again = planTake(store.get(), { id: 'tk_other1', parts: [{ track: keys.id, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 16, end: 32 }, notes: [{ p: 67, t: 18, d: 1, v: 0.8 }] }] }] });
  store.dispatch(again.ops, { by: 'you' });
  const g2 = store.track(keys.id).clips.filter((c) => c.take === 'tk_test03');
  t.ok(g2.length === 4 && g2.filter((c) => !c.mute).length === 1 && g2.find((c) => !c.mute).name === 'Take 4', `recording over a take stack adds to it: ${g2.length} takes, one playing ("${g2.find((c) => !c.mute)?.name}")`);
  // nothing played: nothing planned
  t.ok(planTake(store.get(), { id: 'tk_none01', parts: [{ track: keys.id, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 0, end: 4 }, notes: [] }] }] }).ops.length === 0, 'an empty pass adds nothing');
  // no track to record onto: the plan makes one
  const s3 = createStore(createProject());
  const mk = planTake(s3.get(), { id: 'tk_new001', parts: [{ track: null, newTrack: { name: 'Keys', device: 'core.keys' }, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 0, end: 4 }, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] }] }] });
  const r3 = s3.dispatch(mk.ops, { by: 'you' });
  t.ok(r3.ok && s3.get().tracks.length === 1 && s3.get().tracks[0].clips.length === 1 && s3.get().tracks[0].clips[0].take === 'tk_new001', 'with no track, the take makes one (never a dead end)');

  /* ---- fresh eyes 2: a take silences only what it recorded; one folder per range; trims give back; counts are yours */
  const ns = (ts) => ts.map((x) => ({ p: 60, t: x, d: 0.5, v: 0.8 }));
  const span8 = { g0: 16, b0: 16, loop: { start: 0, end: 32 }, wrap: 32 };
  // R at bar 5 with the loop on bars 1–8, played in bars 5–6, stopped in bar 7: the take is bars 5–6, not 5–8
  const pr = passRange({ span: span8, stopPass: 0, stopBeat: 25.3 }, { n: 0, notes: ns([16.5, 19, 22.75]) }, 4);
  t.ok(pr.start === 16 && pr.end === 24 && !pr.complete, `a take ends where you stopped (the bar line before the stop), not at the loop's end: played bars 5–6, stopped at beat 25.3 -> ${pr.start}..${pr.end}`);
  const pr2 = passRange({ span: span8, stopPass: 0, stopBeat: 29.5 }, { n: 0, notes: ns([16.5]) }, 4);
  const pr3 = passRange({ span: span8, stopPass: 0, stopBeat: 24.6 }, { n: 0, notes: [{ p: 60, t: 22, d: 2.6, v: 0.8 }] }, 4);
  const pr4 = passRange({ span: span8, stopPass: 2, stopBeat: 5 }, { n: 1, notes: ns([3]) }, 4);
  t.ok(pr2.end === 28 && pr3.end === 28 && pr4.start === 0 && pr4.end === 32 && pr4.complete, `bars you passed through count, a note still sounding at the stop keeps its bar, a pass that ran round is the loop (${pr2.end}, ${pr3.end}, ${pr4.start}..${pr4.end})`);
  // the take over the demo's Changes (bars 1–8), bars 5–6: only bars 5–6 are muted
  const sk = createStore(cleanProject(demoProject()));
  const kid = sk.get().tracks.find((x) => x.name === 'Keys').id, before2 = canon(sk.get().tracks);
  const changes = JSON.parse(JSON.stringify(sk.track(kid).clips[0]));
  const heardAt = (st, a, b) => st.track(kid).clips.filter((c) => !c.mute).flatMap((c) => c.notes.map((n) => c.start + n.t)).filter((x) => x >= a - 1e-6 && x < b - 1e-6).length;
  const origIn = (a, b) => changes.notes.filter((n) => n.t >= a - 1e-6 && n.t < b - 1e-6).length;
  const t56 = planTake(sk.get(), { id: 'tk_fresh1', parts: [{ track: kid, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: pr.start, end: pr.end }, notes: ns([16.5, 19, 22.75]) }] }] });
  sk.dispatch(t56.ops, { by: 'you', label: t56.label });
  t.ok(heardAt(sk, 0, 16) === origIn(0, 16) && heardAt(sk, 24, 32) === origIn(24, 32) && heardAt(sk, 16, 24) === 3 && /Take 2 is in on Keys, bars 5–6; Changes is muted\.$/.test(t56.summary), `the original plays on in bars 1–4 and 7–8 (${heardAt(sk, 0, 16)} and ${heardAt(sk, 24, 32)} notes heard), only bars 5–6 are your take: "${t56.summary}"`);
  // loop bars 5–6: two passes and a third cut short by the stop, over the same bars: one folder, one entry per pass
  const tLoop = planTake(sk.get(), { id: 'tk_fresh2', parts: [{ track: kid, kind: 'notes', mode: 'take', active: 1, passes: [
    { n: 0, clip: { start: 16, end: 24 }, notes: ns([17]) }, { n: 1, clip: { start: 16, end: 24 }, notes: ns([18, 21.5]) }, { n: 2, clip: { start: 16, end: 20 }, notes: ns([16.25]) }] }] });
  sk.dispatch(tLoop.ops, { by: 'you', label: tLoop.label });
  const folders = () => takeFolders(sk.track(kid));
  const f56 = folders().find((x) => x.start === 16);
  const names = f56.clips.map((c) => c.name).join(',');
  t.ok(folders().length === 1 && f56.end === 24 && f56.clips.every((c) => c.start === 16 && c.length === 8) && names === 'Changes,Take 2,Take 3,Take 4,Take 5', `one take folder for bars 5–6, one entry per pass, every entry the same bars, numbered in folder order (${names})`);
  const act = f56.playing;
  // (numbered in the order they were recorded: the passes are Takes 3, 4 and 5, and the complete second one plays)
  const byName = (nm) => f56.clips.find((c) => c.name === nm);
  t.ok(byName('Take 3').notes.some((n) => n.t === 1) && act && act.name === 'Take 4' && act.notes.some((n) => n.t === 2) && byName('Take 5').notes.some((n) => n.t === 0.25) && /^Take 4 is in on Keys, bars 5–6; Take 2 is muted\. Three more underneath, muted, the pass you stopped in among them\.$/.test(tLoop.summary) && tLoop.label === 'record take 4 on Keys', `stopped mid-pass: the last complete pass plays (${act?.name}), the cut-short pass is stacked under it, the takes numbered in the order they were played; the toast, the label, the badge and "take k of n" agree: "${tLoop.summary}" (${tLoop.label}; ${f56.clips.length} takes, ${act?.name} is ${f56.clips.indexOf(act) + 1} of ${f56.clips.length})`);
  // a complete first pass, then a second the stop cut short: Take 1 is the first and plays, Take 2 the cut-short one
  // (fresh eyes 5: the complete first pass played as "Take 2", the later, cut-short pass was "Take 1")
  {
    const so = createStore(createProject());
    const to = so.dispatch({ type: 'track.add', ref: 't', track: { name: 'Keys', instrument: { device: 'core.keys' } } }).created.t;
    const N2 = (p, b) => ({ p, t: b, d: 0.5, v: 0.8 });
    const po = planTake(so.get(), { id: 'tk_order01', bpb: 4, parts: [{ track: to, kind: 'notes', mode: 'take', active: 0, natural: 0, passes: [
      { n: 0, complete: true, clip: { start: 0, end: 8, from: 0, to: 8 }, notes: [N2(60, 0), N2(62, 1), N2(64, 2), N2(65, 3)] },
      { n: 1, complete: false, clip: { start: 0, end: 4, from: 0, to: 2.5 }, notes: [N2(67, 0), N2(69, 1)] }] }] });
    so.dispatch(po.ops, { by: 'you', label: po.label });
    const fo = takeFolders(so.track(to))[0], seen = fo.clips.map((c) => `${c.name}${c.mute ? '' : '*'}:${c.notes.map((n) => n.p).join(',')}`);
    t.ok(seen.join(' | ') === 'Take 1*:60,62,64,65 | Take 2:67,69' && /^Take 1 is in on Keys, bars 1–2\. One more underneath, muted, the pass you stopped in among them\.$/.test(po.summary) && po.label === 'record take 1 on Keys', `takes are numbered in the order they were recorded: the complete first pass is Take 1 and plays, the cut-short second is Take 2 (${seen.join(' | ')}; "${po.summary}")`);
  }
  // the cut-short pass, picked, still plays the rest of the bars (what played there before fills it out)
  const frag = f56.clips.find((c) => c.name === 'Take 5');
  t.ok(frag.notes.some((n) => n.t >= 4), `picking the cut-short pass never leaves the rest of its bars silent (${frag.notes.length} notes over bars 5–6, ${frag.notes.filter((n) => n.t >= 4).length} of them from what played in bar 6)`);
  // a take over other bars that overlap the folder (bars 6–8): no empty leftover pieces, each folder covers one range
  const bar6 = heardAt(sk, 20, 24), bar8 = heardAt(sk, 28, 32);   // (what played there before this take)
  const tOver = planTake(sk.get(), { id: 'tk_fresh3', parts: [{ track: kid, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 20, end: 32 }, notes: ns([21]) }] }] });
  const rO = sk.dispatch(tOver.ops, { by: 'you', label: tOver.label });
  const fs = folders();
  const tidy = fs.every((f) => f.clips.every((c) => c.start === f.start && c.start + c.length === f.end) && f.clips.filter((c) => !c.mute).length === 1);
  const empties = sk.track(kid).clips.filter((c) => c.take && c.mute && !c.notes.length && takeNumber(c));
  t.ok(rO.ok && tidy && !empties.length && heardAt(sk, 0, 16) === origIn(0, 16), `recording over part of a folder: each folder still covers one range with one take playing, no empty leftovers (${fs.map((f) => `${f.start}–${f.end}: ${f.clips.map((c) => c.name + (c.mute ? '' : '*')).join(',')}`).join('; ')})`);
  // switching takes in any folder never leaves its bars silent where something played
  let silent = 0;
  for (const f of fs) for (const c of f.clips) { const pl = f.playing; if (pl.notes.length && !c.notes.length) silent++; }
  t.ok(!silent, `every take in every folder has the notes of its bars: switching never silences the range (${silent} empty)`);
  // Trim to the loop: the take cut to bars 7–8; what it no longer covers (bar 6) plays again
  const big = fs.find((f) => f.start === 20);
  const trim = planClipTrim(sk.get(), { track: kid, clip: big.playing.id, start: 24, end: 32 });
  sk.dispatch(trim.ops, { by: 'you', label: 'trim clip to the loop' });
  t.ok(bar6 > 0 ? heardAt(sk, 20, 24) === bar6 : false, `trimming a take un-mutes what it no longer covers: bar 6 plays what played there before again (${heardAt(sk, 20, 24)} of ${bar6} notes): "${trim.summary}"`);
  const leftEdge = planClipTrim(sk.get(), { track: kid, clip: folders().find((f) => f.start === 24).playing.id, start: 24, end: 28 });
  sk.dispatch(leftEdge.ops, { by: 'you', label: 'shorten clip' });
  t.ok(heardAt(sk, 28, 32) === bar8 && bar8 === origIn(28, 32), `and so does dragging its right edge in (bar 8: ${heardAt(sk, 28, 32)} of ${bar8} notes)`);
  while (sk.canUndo()) sk.undo();
  t.ok(canon(sk.get().tracks) === before2, 'and every step undoes exactly');
}

/* ------------------------------------------------------------------ 1b. Node: fresh eyes 3 (the commit's edges) */
{
  const heardOn = (st, tid, a, b) => st.track(tid).clips.filter((c) => !c.mute).flatMap((c) => (c.notes || []).map((n) => `${n.p}@${r4n(c.start + n.t)}`)).filter((x) => { const b0 = +x.split('@')[1]; return b0 >= a - 1e-6 && b0 < b - 1e-6; }).sort();
  const r4n = (x) => Math.round(x * 1e4) / 1e4;
  // a punch out inside a bar: the take is bars 5–7, but the rest of bar 7 after the stop is still what played there
  const sp = createStore(cleanProject(demoProject()));
  const kp = sp.get().tracks.find((x) => x.name === 'Keys').id;
  const before = heardOn(sp, kp, 25.5, 28), beforeIn = heardOn(sp, kp, 16, 18);
  const ps = { n: 0, notes: [{ p: 72, t: 17, d: 0.5, v: 0.8 }, { p: 74, t: 25, d: 0.25, v: 0.8 }] };
  const pr = passRange({ span: { g0: 16, b0: 16, loop: null, wrap: Infinity }, stopPass: 0, stopBeat: 25.5 }, ps, 4);
  const pl = planTake(sp.get(), { id: 'tk_punch1', parts: [{ track: kp, kind: 'notes', mode: 'take', passes: [{ ...ps, clip: pr }] }] });
  sp.dispatch(pl.ops, { by: 'you' });
  t.ok(pr.start === 16 && pr.end === 28 && pr.from === 16 && pr.to === 25.5 && before.length && heardOn(sp, kp, 25.5, 28).join() === before.join(), `a punch out at beat 25.5: the take is bars 5–7 (${pr.start}..${pr.end}, recorded ${pr.from}..${pr.to}), and what played after the stop still plays (${heardOn(sp, kp, 25.5, 28).length} of ${before.length} notes)`);
  // a punch in from a marker inside a bar: the beats before it are what played there
  sp.undo();
  const ps2 = { n: 0, notes: [{ p: 72, t: 19, d: 0.5, v: 0.8 }, { p: 74, t: 22, d: 0.5, v: 0.8 }] };
  const pr2 = passRange({ span: { g0: 18, b0: 18, loop: null, wrap: Infinity }, stopPass: 0, stopBeat: 26.2 }, ps2, 4);
  sp.dispatch(planTake(sp.get(), { id: 'tk_punch2', parts: [{ track: kp, kind: 'notes', mode: 'take', passes: [{ ...ps2, clip: pr2 }] }] }).ops, { by: 'you' });
  t.ok(pr2.start === 16 && pr2.from === 18 && beforeIn.length && heardOn(sp, kp, 16, 18).join() === beforeIn.join(), `a punch in at a marker on beat 18: the take starts at bar 5 but beats 16–18 still play what was there (${heardOn(sp, kp, 16, 18).length} of ${beforeIn.length} notes)`);
  // the bars a take is on are the ones it was played in (a meter changed mid-take ends it on the old bars)
  const sm = createStore(cleanProject(demoProject()));
  const km = sm.get().tracks.find((x) => x.name === 'Keys').id;
  sm.dispatch({ type: 'project.set', patch: { meter: [3, 4] } }, { by: 'you' });
  const pm = planTake(sm.get(), { id: 'tk_meter1', bpb: 4, parts: [{ track: km, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 16, end: 20, from: 16, to: 19 }, notes: [{ p: 60, t: 16.5, d: 0.5, v: 0.8 }] }] }] });
  t.ok(/Take 2 is in on Keys, bar 5; Changes is muted\./.test(pm.summary), `a take keeps the bars it was played in after a meter change ("${pm.summary}")`);

  // an audio take begun inside the loop and stopped just after the wrap: nothing it doesn't play over goes quiet
  const sa = createStore(createProject());
  const ga = sa.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio' } }).created.g;
  sa.dispatch({ type: 'clip.add', track: ga, clip: { kind: 'audio', start: 0, length: 16, asset: 'a_old', offset: 0, name: 'Rhythm' } });
  const pa = planTake(sa.get(), { id: 'tk_aud001', parts: [{ track: ga, kind: 'audio', mode: 'take', active: 0, passes: [
    { n: 0, audio: { asset: 'a_new', offset: 0, start: 8, length: 8 } }, { n: 1, audio: { asset: 'a_new', offset: 4, start: 0, length: 2 } }] }] });
  sa.dispatch(pa.ops, { by: 'you' });
  const au = sa.track(ga).clips.map((c) => `${c.name}@${c.start}+${c.length}${c.mute ? ' M' : ''}`);
  const playsAt = (b) => sa.track(ga).clips.filter((c) => !c.mute && b >= c.start && b < c.start + c.length).map((c) => c.asset);
  t.ok(playsAt(2).join() === 'a_old' && playsAt(5).join() === 'a_old' && playsAt(10).join() === 'a_new' && /bars 3–4/.test(pa.summary), `an audio take from bar 3 stopped after the wrap: bars 1–2 still play the old guitar, bars 3–4 the take (${au.join(', ')}; "${pa.summary}")`);
  // a looped audio take over the whole loop: the passes stack in one folder as before
  const pa2 = planTake(sa.get(), { id: 'tk_aud002', parts: [{ track: ga, kind: 'audio', mode: 'take', active: 1, passes: [
    { n: 0, audio: { asset: 'a_x', offset: 0, start: 0, length: 16 } }, { n: 1, audio: { asset: 'a_x', offset: 10, start: 0, length: 16 } }, { n: 2, audio: { asset: 'a_x', offset: 20, start: 0, length: 3 } }] }] });
  sa.dispatch(pa2.ops, { by: 'you' });
  const fx = takeFolders(sa.track(ga)).find((f) => f.clips.some((c) => c.asset === 'a_x'));
  t.ok(fx && fx.clips.filter((c) => c.asset === 'a_x').length === 3 && fx.playing?.asset === 'a_x' && fx.playing.start === 0 && fx.playing.length === 16 && playsAt(2).join() === 'a_x', `three passes over the whole loop: three takes in one folder, the complete one playing bars 1–4 (${fx ? fx.clips.map((c) => c.name + (c.mute ? '' : '*')).join(', ') : 'no folder'})`);

  // recording over a range that overlaps an earlier take folder: one name per entry, what played isn't a "Take N"
  const sn = createStore(cleanProject(demoProject()));
  const kn = sn.get().tracks.find((x) => x.name === 'Keys').id;
  const one = (st, a, b, p) => st.dispatch(planTake(st.get(), { id: newTk(), parts: [{ track: kn, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: a, end: b }, notes: [{ p, t: a + 0.5, d: 0.5, v: 0.8 }] }] }] }).ops, { by: 'you' });
  let tkN = 0;
  const newTk = () => 'tk_name' + String(++tkN).padStart(2, '0');
  one(sn, 16, 24, 72); one(sn, 16, 32, 74);
  const fo = takeFolders(sn.track(kn)).find((f) => f.start === 16 && f.end === 32);
  const nm = fo ? fo.clips.map((c) => c.name) : [];
  t.ok(fo && new Set(nm).size === nm.length && !takeNumber(fo.clips[0]) && nm.slice(1).every((x, i) => x === `Take ${i + 2}`), `a take over bars 5–8 after one over bars 5–6: every entry has its own name, what played first and not a "Take N" (${nm.join(', ')})`);
  // and fuzzed: overlapping takes never repeat a name in a folder
  let dupes = 0, tried = 0;
  for (let k = 0; k < 40; k++) {
    const a = 4 * Math.floor(((k * 7) % 6)), len = 4 * (1 + ((k * 5) % 3));
    one(sn, a, Math.min(32, a + len), 60 + (k % 12)); tried++;
    for (const f of takeFolders(sn.track(kn))) { const ns = f.clips.map((c) => c.name); if (new Set(ns).size !== ns.length) dupes++; }
  }
  t.ok(!dupes, `${tried} overlapping takes: no folder ever holds two entries of one name (${dupes} did)`);

  // a pitched note ringing over the take's end isn't struck again there
  const sl = createStore(createProject());
  const pd = sl.dispatch({ type: 'track.add', ref: 'k', track: { name: 'Pad', instrument: { device: 'core.keys' } } }).created.k;
  sl.dispatch({ type: 'clip.add', track: pd, clip: { kind: 'notes', start: 0, length: 32, name: 'Pad', notes: [{ p: 60, t: 20, d: 8, v: 0.8 }] } });
  sl.dispatch(planTake(sl.get(), { id: 'tk_tail02', parts: [{ track: pd, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 16, end: 24 }, notes: [{ p: 67, t: 17, d: 1, v: 0.8 }] }] }] }).ops, { by: 'you' });
  const ons = sl.track(pd).clips.filter((x) => !x.mute).flatMap((x) => x.notes.map((n) => `${n.p}@${x.start + n.t}`));
  t.ok(ons.join() === '67@17', `a note tied over the take's last bar line (C4 from beat 20) isn't struck again at beat 24 once the take replaces it (${ons.join(', ')})`);
}

/* ------------------------------------------------------------------ 1c. Node: fresh eyes 4 (a phrase over the loop's seam) */
{
  const lp = { start: 0, end: 8 };
  const N = (p, t, d = 0.25) => ({ p, t, d, v: 0.8 });
  const ph = [60, 62, 63, 65, 67, 68, 70, 72];
  // R in bar 1 of a 2-bar loop: recording starts at bar 2, the tune runs on round the loop: 4 notes, then 4 more
  const head = ph.slice(0, 4).map((p, i) => N(p, 5 + i * 0.75)), tail = ph.slice(4).map((p, i) => N(p, i * 0.75));
  const j1 = joinSeams([{ n: 0, notes: head }, { n: 1, notes: tail }], lp, 4);
  t.ok(j1.passes.length === 1 && j1.passes[0].n === 0 && j1.passes[0].notes.length === 8 && j1.passes[0].wrap && j1.joins.length === 1 && j1.joins[0].at === 'start' && j1.joins[0].notes === 4, `joinSeams: a tune played on over the loop's end stays one pass, its tail at the loop's start (${j1.passes.map((x) => `pass ${x.n}: ${x.notes.map((n) => n.p + '@' + n.t).join(' ')}`).join('; ')})`);
  // the pass it began in, wrapped, covers the whole loop: the take holds the tail too
  const span = { g0: 4, b0: 4, loop: lp, wrap: 8 };
  const pr = passRange({ span, stopPass: 2, stopBeat: 1 }, j1.passes[0], 4);
  t.ok(pr.start === 0 && pr.from === 0 && pr.end === 8 && pr.complete, `and its range is the whole loop, from the loop's start where the tail sits (${pr.start}..${pr.end}, recorded ${pr.from}..${pr.to})`);
  // a rest at the seam: two phrases, two passes
  const j2 = joinSeams([{ n: 0, notes: head }, { n: 1, notes: tail.map((x) => ({ ...x, t: x.t + 2.5 })) }], lp, 4);
  // playing that fills every pass (a riff each time round): no pass to fold into, a take per time round
  const riff = (n) => ({ n, notes: [0, 1, 2, 3, 4, 5, 6, 7].map((b) => N(60 + b, b)) });
  const j3 = joinSeams([riff(0), riff(1), riff(2)], lp, 4);
  // a phrase longer than the loop: neither side fits, it stays as played
  const j4 = joinSeams([{ n: 0, notes: [0, 1, 2, 3, 4, 5, 6, 7.5].map((b) => N(60, b)) }, { n: 1, notes: [0.5, 1.5].map((b) => N(62, b)) }], lp, 4);
  t.ok(j2.joins.length === 0 && j2.passes.length === 2 && j3.joins.length === 0 && j3.passes.length === 3 && j4.joins.length === 0, `and only then: a rest of 2.5 beats at the seam is two phrases (${j2.passes.length} passes), a riff filling every pass stays a take each (${j3.passes.length}), a phrase longer than the loop isn't folded onto itself (${j4.joins.length} joins)`);
  // an earlier try at the loop's start, then a pickup at its end into the next pass: the pickup goes on into that pass
  const j5 = joinSeams([{ n: 0, notes: [N(60, 0), N(62, 1), N(64, 2), N(67, 7), N(69, 7.5)] }, { n: 1, notes: [N(71, 0), N(72, 0.5), N(74, 1), N(76, 2)] }], lp, 4);
  t.ok(j5.joins.length === 1 && j5.joins[0].at === 'end' && j5.passes[0].notes.map((x) => x.p).join() === '60,62,64' && j5.passes[1].notes.map((x) => x.p).join() === '71,72,74,76,67,69', `a pickup before the seam goes on into the pass its phrase is in, when the pass it began in has another try at its start (${j5.passes.map((x) => x.notes.map((n) => n.p).join(',')).join(' | ')})`);
  // a tail still ringing at the phrase's first note is cut there, never over it
  const j6 = joinSeams([{ n: 0, notes: [N(60, 4), N(62, 6), N(64, 7.5)] }, { n: 1, notes: [N(65, 0), N(67, 3, 3)] }], lp, 4);
  const cut = j6.passes[0].notes.find((x) => x.p === 67);
  t.ok(j6.passes.length === 1 && cut && cut.d === 1, `a tail note ringing into the phrase's first note is cut there (G4 at 3 for ${cut?.d} beat, was 3)`);

  // the pass that plays: never a fragment over a fuller one
  const pa = pickActive([{ n: 0, complete: true, notes: new Array(7).fill(0) }, { n: 1, complete: true, notes: [0] }]);
  const pb = pickActive([{ n: 0, complete: true, notes: [0] }, { n: 1, complete: false, notes: [0] }]);
  const pc = pickActive([{ n: 0, complete: true, notes: [0, 0] }, { n: 1, complete: true, notes: new Array(8).fill(0) }, { n: 2, complete: false, notes: [0, 0, 0] }]);
  const pd = pickActive([{ n: 0, complete: true, notes: [0] }, { n: 1, complete: false, notes: new Array(8).fill(0) }]);
  t.ok(pa.n === 0 && pa.natural === 1 && pb.n === 0 && pc.n === 1 && pd.n === 1, `pickActive: a last pass of 1 note under one of 7 lets the 7 play (${pa.n}); passes alike still play the last complete one (${pb.n}, ${pc.n}); a cut-short pass that holds the whole tune plays over a 1-note one (${pd.n})`);

  // the plan says what happened, in plain words
  const song = cleanProject(demoProject());
  const s = createStore(song);
  const tune = s.dispatch({ type: 'track.add', ref: 't', track: { name: 'Tune', instrument: { device: 'core.keys' } } }, { by: 'you' }).created.t;
  const planOf = (passes, extra) => planTake(s.get(), { id: 'tk_seam01', bpb: 4, parts: [{ track: tune, kind: 'notes', mode: 'take', passes, ...extra }] });
  const whole = planOf([{ n: 0, complete: true, clip: pr, notes: j1.passes[0].notes }], { active: 0, natural: 0, joins: j1.joins });
  s.dispatch(whole.ops, { by: 'you' });
  const plays = s.track(tune).clips.filter((c) => !c.mute);
  t.ok(plays.length === 1 && plays[0].notes.length === 8 && plays[0].start === 0 && plays[0].length === 8 && whole.summary === "Take 1 is in on Tune, bars 1–2. Your phrase ran past the loop's end and is kept whole: its last 4 notes come round at bar 1.", `one take plays all 8 notes over bars 1–2: "${whole.summary}"`);
  s.undo();
  const fr = planOf([
    { n: 0, complete: true, clip: { start: 0, end: 8, from: 0, to: 8 }, notes: ph.slice(0, 7).map((p, i) => N(p, 4 + i * 0.5)) },
    { n: 1, complete: true, clip: { start: 0, end: 8, from: 0, to: 8 }, notes: [N(67, 7)] }], { active: 0, natural: 1 });
  s.dispatch(fr.ops, { by: 'you' });
  const fp = s.track(tune).clips.filter((c) => !c.mute);
  t.ok(fp.length === 1 && fp[0].notes.length === 7 && fr.summary === 'Take 1 is in on Tune, bars 1–2. One more underneath, muted. The last time round had only 1 note, so the fuller take plays (7 notes).', `the fuller pass plays and the toast says why, without calling the 1-note pass the one you stopped in: "${fr.summary}"`);
}

/* ------------------------------------------------------------------ 1d. Node: where a take goes (docs/INSTRUMENTS-UX.md 1.1, 1.2, 3.1) */
{
  // a recorder over a stub shell: the store, the selection, a view; nothing sounds
  const rig = (view, build) => {
    const store = createStore(createProject());
    const ids = build ? build(store) : {};
    const fns = new Map();
    const ui = { state: { selection: { track: null } }, on: (k, fn) => { if (!fns.has(k)) fns.set(k, new Set()); fns.get(k).add(fn); return () => fns.get(k).delete(fn); }, emit: (k, d) => { for (const fn of fns.get(k) || []) fn(d); }, toast() {}, announce() {} };
    ui.select = (x) => { Object.assign(ui.state.selection, x); ui.emit('select', ui.state.selection); };
    const app = { store, engine: { playing: false, on() {} }, ui, devices: { getDevice: () => null } };
    const events = [];
    const input = { emit: (k, d) => events.push([k, d]), capture: { add: () => null, flush() {} }, options: { grid: 0.25 } };
    const rec = createRecorder(app, input, { view });
    return { store, ui, rec, ids, events, input, name: (id) => store.track(id)?.name || null };
  };
  const add = (store, name, device, clips = []) => store.dispatch({ type: 'track.add', ref: 'x', track: { name, instrument: { device }, clips } }).created.x;
  // a take onto a track, as the commit leaves it: a clip, then the recorder told
  const takeOn = (R, kind, track, start = 0) => { R.store.dispatch({ type: 'clip.add', track, clip: { kind: 'notes', start, length: 8, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] } }); R.rec.took(kind, track); R.ui.select({ track }); };

  // newPartFor: one name and first sound per kind, then "Melody 2"
  t.ok(JSON.stringify(newPartFor('hum', createProject())) === '{"name":"Melody","device":"core.keys"}' && newPartFor('keys', null).name === 'Keys' && newPartFor('pads', null).device === 'core.drums' && newPartFor('beatbox', null).name === 'Drums', 'newPartFor: Melody, Keys, Drums (Lamp Tines, Lamp Tines, Gobo Kit)');
  t.ok(newPartFor('hum', { tracks: [{ name: 'Melody' }, { name: 'melody 2' }] }).name === 'Melody 3', 'and the next free name: Melody 3');
  // kindOfTake: a hum is a hum in any register (hum before bass)
  const line = (ps) => ps.map((p, i) => ({ p, t: i, d: 1 }));
  t.ok(kindOfTake({ src: 'hum', notes: line([60, 64, 67, 69]) }) === 'hum' && kindOfTake({ src: 'hum', notes: line([45, 47, 48]) }) === 'hum' && kindOfTake({ src: 'midi', notes: line([36, 40, 43]) }) === 'bass'
    && kindOfTake({ src: 'midi', notes: [0, 1, 2].flatMap((b) => [60, 64, 67].map((p) => ({ p, t: b, d: 1 }))) }) === 'chords' && kindOfTake({ kind: 'drums', src: 'tap', notes: [] }) === 'drums' && kindOfTake({ src: 'qwerty', notes: line([60, 62, 64]) }) === 'played',
  'kindOfTake: a hummed C4–A4 line and a hummed A2–C3 line are hums, a played low line is bass, triads are chords, a tapped beat is drums');
  // soundsFor: the hum set, its fallbacks, the current sound first, no doubles, every row a family
  const ids = (rs) => rs.map((r) => r.device + (r.preset ? ':' + r.preset : '')).join(',');
  const hs = soundsFor('hum');
  t.ok(ids(hs) === 'core.keys,core.wavetable,core.strings,claude.choir-loft' && hs.every((r) => r.family), `soundsFor hum: ${ids(hs)}`);
  t.ok(ids(soundsFor('hum', { has: (id) => id !== 'claude.choir-loft' })).endsWith('core.mallets'), 'without Choir Loft the fourth is Mallet Bag');
  const cw = soundsFor({ src: 'hum' }, { current: 'core.wavetable' });
  t.ok(cw.length === 4 && cw[0].device === 'core.wavetable' && cw[0].now && cw.filter((r) => r.device === 'core.wavetable').length === 1, `current first, kept to four: ${ids(cw)}`);
  const dk = soundsFor('drums', { current: 'core.drums', currentPreset: 'Studio kit' });
  t.ok(dk.filter((r) => r.device === 'core.drums' && r.preset === 'Studio kit').length === 1 && dk.every((r) => r.family), `a kit on Studio kit isn't listed twice: ${ids(dk)}`);
  t.ok(familyOf({ device: 'core.wavetable', preset: 'Low Key' }, { blurb: 'x', presets: [{ name: 'Low Key', blurb: 'Bass: deep and round' }] }) === 'Bass' && familyOf({}, { blurb: 'Electric piano with bark' }) === '', 'familyOf: the blurb\'s words before its colon');
  const { BUILTINS } = await import('../app/src/devices/builtin/index.js');
  const { LIBRARY } = await import('../app/src/devices/library/index.js');
  const findDef = (id) => [...BUILTINS, ...LIBRARY].find((d) => d && d.id === id) || null;
  const bad = Object.values(SOUND_SETS).flatMap((S) => [...S.rows, ...S.fallbacks]).filter((r) => { const d = findDef(r.device); return !d || (r.preset && !(d.presets || []).some((x) => x.name === r.preset)); });
  t.ok(!bad.length, `every id and preset in SOUND_SETS is a real device (${bad.map((r) => r.device + ':' + (r.preset || '')).join(', ') || 'all found'})`);

  // the simple view
  {
    const R = rig('simple', (s) => ({ drums: add(s, 'Drums', 'core.drums') }));
    const { drums } = R.ids;
    R.ui.select({ track: drums });
    t.ok(R.rec.aim('hum').track === null && R.rec.aim('hum').why === 'new' && R.rec.targetFor('keys') === null, `simple: Drums selected, a hum and the keys aim at a new track (${JSON.stringify(R.rec.aim('hum'))})`);
    t.ok(R.rec.aim('pads').track === drums, `the pads aim at the song's only kit (${JSON.stringify(R.rec.aim('pads'))})`);
    const mel = add(R.store, 'Melody', 'core.keys');
    takeOn(R, 'hum', mel);
    R.ui.select({ track: drums });
    t.ok(R.rec.aim('hum').track === mel && R.rec.aim('hum').why === 'last', `the second hum goes onto Melody, the last hum's track (${JSON.stringify(R.rec.aim('hum'))})`);
    const bass = add(R.store, 'Bass', 'core.bass', [{ kind: 'notes', start: 0, length: 4, notes: [{ p: 36, t: 0, d: 1 }] }]);
    R.ui.select({ track: bass });
    t.ok(R.rec.aim('hum').track === bass && R.rec.aim('hum').why === 'selected', 'selecting Bass after the last hum aims the next hum at Bass');
    R.rec.setAim('hum', drums);
    t.ok(R.rec.targetFor('hum')?.id === drums && R.rec.aim('hum').why === 'choice' && R.events.length >= 0, 'setAim(hum, Drums) puts a hum on Drums (a choice)');
    // 'new' is one-shot: once its take is in, the next goes onto that track, never a Melody 2
    R.rec.setAim('hum', 'new');
    t.ok(R.rec.aim('hum').track === null, 'setAim(hum, new): a new track');
    const m2 = add(R.store, newPartFor('hum', R.store.get()).name, 'core.keys');
    takeOn(R, 'hum', m2);
    R.ui.select({ track: drums });
    t.ok(R.rec.aim('hum').track === m2 && R.name(m2) === 'Melody 2', `after that take, the next hum's aim is that track (${R.name(R.rec.aim('hum').track)}), not another new one`);
    let aims = 0; R.rec.on('aim', () => aims++); R.rec.setAim('keys', null);
    t.ok(aims > 0, "setAim emits 'aim'");
  }
  {
    // pads after a reload (no last take): the only Drums, nothing selected; two kits and none picked: a new one
    const R = rig('simple', (s) => ({ drums: add(s, 'Drums', 'core.drums', [{ kind: 'notes', start: 0, length: 4, notes: [{ p: 36, t: 0, d: 0.25 }] }]) }));
    t.ok(R.rec.aim('pads').track === R.ids.drums && R.rec.aim('pads').why === 'only-kit', 'pads after a reload: onto the only drum track');
    add(R.store, 'Drums 2', 'core.drums');
    t.ok(R.rec.aim('pads').track === null, 'two kits, none picked or selected: a new one');
  }
  // the full studio: the armed track first; 'new' disarms; arming by hand clears the choice; no first-pitched fallback
  {
    const R = rig('full', (s) => ({ bass: add(s, 'Bass', 'core.bass'), keys: add(s, 'Keys', 'core.keys'), drums: add(s, 'Drums', 'core.drums') }));
    const { bass, keys, drums } = R.ids;
    R.ui.select({ track: drums });
    t.ok(R.rec.targetFor('hum') === null && R.rec.targetFor('keys')?.id === drums, `full: Drums selected, nothing armed: a hum aims at a new track, not at Bass (${R.name(R.rec.targetFor('hum')?.id)}); the keys play the selected Drums as before`);
    R.store.dispatch({ type: 'track.set', track: keys, patch: { arm: true } }, { by: 'you' });
    t.ok(R.rec.targetFor('hum')?.id === keys && R.rec.aim('hum').why === 'armed', 'an armed Keys takes the hum (today\'s rule)');
    R.input.sketchMode = 'hum';   // (Hum it open: R records the hum, so the lit R speaks for it)
    t.ok(R.rec.target === keys && R.rec.lands()?.id === keys, 'in Hum it the lit R is the armed Keys');
    R.rec.setAim('hum', 'new');
    t.ok(R.rec.targetFor('hum') === null && !R.store.get().tracks.some((x) => x.arm) && R.rec.target === null && R.rec.lands() === null && R.store.history.at(-1).label === 'record onto a new track' && R.store.history.at(-1).by === 'you', `setAim(hum, new) overrides it and disarms every track, one step by you ("${R.store.history.at(-1).label}"), and nothing is lit`);
    R.input.sketchMode = null;
    R.store.dispatch({ type: 'track.set', track: bass, patch: { arm: true } }, { by: 'you', label: 'arm Bass' });
    t.ok(R.rec.aim('hum').track === bass && R.rec.aim('hum').why === 'armed', `arming a track by hand afterwards clears the choice (${JSON.stringify(R.rec.aim('hum'))})`);
    R.rec.setAim('hum', keys);
    t.ok(R.store.track(keys).arm && !R.store.track(bass).arm && R.rec.aim('hum').track === keys, 'picking a track in Onto arms it, the other arm gives way');
    R.ui.select({ track: bass });
    t.ok(R.rec.aim('hum').why !== 'choice', 'selecting another track by hand is the newer act: the choice gives way');
  }
  // the commit plan: a take over other bars stacks nothing; over the same bars it says what it muted
  {
    const st = createStore(createProject());
    const mel = st.dispatch({ type: 'track.add', ref: 'm', track: { name: 'Melody', instrument: { device: 'core.keys' } } }).created.m;
    const take1 = planTake(st.get(), { id: 'tk_aim001', parts: [{ track: mel, kind: 'notes', mode: 'take', kinds: ['hum'], passes: [{ n: 0, clip: { start: 0, end: 8 }, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] }] }] });
    st.dispatch(take1.ops, { by: 'you' });
    const beside = planTake(st.get(), { id: 'tk_aim002', parts: [{ track: mel, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 8, end: 16 }, notes: [{ p: 64, t: 8, d: 1, v: 0.8 }] }] }] });
    const d2 = st.dispatch(beside.ops, { by: 'you' });
    t.ok(d2.ok && !beside.parts[0].stacked && st.track(mel).clips.every((c) => !c.mute) && !/muted/.test(beside.summary) && take1.parts[0].kinds.join() === 'hum', `a take over other bars is a clip beside the first, nothing muted ("${beside.summary}")`);
    const over = planTake(st.get(), { id: 'tk_aim003', parts: [{ track: mel, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 0, end: 8 }, notes: [{ p: 67, t: 0, d: 1, v: 0.8 }] }] }] });
    t.ok(over.parts[0].stacked && over.parts[0].stacked.names.join() === 'Take 1' && /^Take 2 is in on Melody, bars 1–2; Take 1 is muted\.$/.test(over.summary), `one over the same bars stacks as Take 2 and says so: "${over.summary}" (${JSON.stringify(over.parts[0].stacked)})`);
  }
  // Put it on its own track: one step, the take on a new Melody with the same sound, Take 1 playing again
  {
    const R = rig('simple', (s) => ({ mel: add(s, 'Melody', 'core.wavetable') }));
    const { mel } = R.ids;
    R.store.dispatch(planTake(R.store.get(), { id: 'tk_own001', parts: [{ track: mel, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 0, end: 8 }, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] }] }] }).ops, { by: 'you' });
    const pl = planTake(R.store.get(), { id: 'tk_own002', parts: [{ track: mel, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 0, end: 8 }, notes: [{ p: 64, t: 0, d: 1, v: 0.8 }] }] }] });
    const d = R.store.dispatch(pl.ops, { by: 'you' });
    const act = R.store.track(mel).clips.find((c) => !c.mute), was = R.store.track(mel).clips.find((c) => c.mute);
    const n0 = R.store.history.length;
    const own = R.rec.ownTrack({ track: mel, clip: act.id, kind: 'hum', names: ['Take 1'], unmute: pl.parts[0].stacked.unmute.map((u) => d.created[u] || u) });
    const nt = R.store.track(own.track), moved = nt && nt.clips[0];
    t.ok(own.ok && R.store.history.length === n0 + 1 && nt.name === 'Melody 2' && nt.instrument.device === 'core.wavetable' && moved && moved.id === act.id && !moved.take && !moved.mute && !R.store.track(mel).clips.find((c) => c.id === was.id).mute && R.rec.aim('hum').track === nt.id,
      `Put it on its own track: one undo step, ${nt?.name} on Light Table with the take, Take 1 playing again on Melody ("${own.text}")`);
    R.store.undo();
    t.ok(!R.store.track(own.track) && R.store.track(mel).clips.filter((c) => !c.mute).length === 1, 'and one undo puts the stack back');
  }
  // the keys' track: made when the keys start, selected, said
  {
    const R = rig('simple', (s) => ({ drums: add(s, 'Drums', 'core.drums') }));
    R.ui.select({ track: R.ids.drums });
    const k = R.rec.keysTrack();
    const said = R.events.find((e) => e[0] === 'keys:track');
    t.ok(k && k.name === 'Keys' && k.instrument.device === 'core.keys' && R.ui.state.selection.track === k.id && said && said[1].text === 'Keys play a new track, Keys (Lamp Tines). Undo takes it away.' && R.rec.keysTrack().id === k.id,
      `the keys aimed at a new track: keysTrack makes Keys (Lamp Tines), selected, said once ("${said?.[1].text}"), and the next call plays it`);
    R.ui.select({ track: R.ids.drums });
    t.ok(R.rec.targetFor('keys')?.id === k.id, 'selecting Drums afterwards: the keys still play Keys (a drum track is the keys\' only when picked)');
  }
  // the Beatbox catch: a hummed voice reads as a tune, noise bursts on the beat don't
  {
    const sr = 22050, voice = renderVoice(phrase([60, 64, 67, 69, 67, 64, 62, 60].map((m) => ({ m, beats: 1, gap: 0.1 })), { tempo: 90 }), sr);
    const x = voice.x || voice.samples || voice;
    const tn = tuneOf(x, sr, { tempo: 90 });
    const bursts = new Float32Array(sr * 4);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let b = 0; b < 8; b++) { const i0 = Math.round(b * 0.5 * sr); for (let i = 0; i < sr * 0.06; i++) bursts[i0 + i] = rnd() * 0.6 * Math.exp(-i / (sr * 0.015)); }
    const nb = tuneOf(bursts, sr, { tempo: 120 });
    t.ok(tn && tn.notes >= 6 && !nb, `tuneOf: a hum is a tune (${tn ? `${tn.notes} notes, confident on ${Math.round(tn.conf * 100)}%, ${tn.perBeat} onsets a beat` : 'not heard'}); beatbox bursts are not (${nb ? JSON.stringify({ n: nb.notes, c: nb.conf }) : 'none'})`);
  }
}

/* ------------------------------------------------------------------ 2. the studio */
const MIC_SHIM = `(() => {
  // the mic: a stream the test feeds (a synthesized voice; a two-input interface with a different tone on each input);
  // getUserMedia's constraints kept. (Chromium carries two channels through a page-made stream, not more.)
  window.__gum = [];
  window.__mic = null;
  const md = navigator.mediaDevices;
  md.getUserMedia = async (c) => {
    window.__gum.push(JSON.parse(JSON.stringify(c)));
    const app = window.overdub; await app.engine.start();
    const ctx = app.engine.ctx;
    if (!window.__mic || window.__mic.ctx !== ctx) window.__mic = { ctx, merge: ctx.createChannelMerger(2) };
    // (a fresh stream each time: closing the input stops the last one's track)
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 2; dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'discrete';
    window.__mic.merge.connect(dest);
    return dest.stream;
  };
})();`;

const { page, errors, close, shot } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
try {
  await page.addInitScript(MIC_SHIM);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await page.evaluate(async () => { const app = window.overdub; await app.engine.start(); app.ui.setOpen?.('bottom', true); });
  const ids = await page.evaluate(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
  const tempo = await page.evaluate(() => window.overdub.store.get().tempo);
  const spbMs = 60000 / tempo;
  // keydown beats as the page saw them (the audible beat at the event's timeStamp)
  await page.evaluate(() => { window.__kd = []; window.addEventListener('keydown', (e) => { const en = window.overdub.engine; window.__kd.push({ code: e.code, beat: en.playing ? en.beatAt(e.timeStamp) : null }); }, true); });
  const beatNow = () => page.evaluate(() => window.overdub.engine.beat);
  // wait until the audible beat (or, grid: the transport's unwrapped grid, across loop wraps) is `b` (a few ms early:
  // the key's own trip), then return it
  async function until(b, { grid = false } = {}) {
    for (let i = 0; i < 2000; i++) {
      const x = grid ? await page.evaluate(() => window.overdub.engine.gridBeat ?? -1e9) : await beatNow();
      if (x >= b - 0.015) return x;
      await page.waitForTimeout(Math.max(1, Math.min(250, (b - x) * spbMs - 25)));
    }
    return null;
  }
  const state = () => page.evaluate(() => window.overdub.input.recorder.state);
  async function idle() { for (let i = 0; i < 100 && (await state()) !== 'idle'; i++) await page.waitForTimeout(50); await page.waitForTimeout(80); }
  async function tapKey(code, ms = 120) { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); }
  const lastToast = () => page.evaluate(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');
  const reset = () => page.evaluate(() => { const app = window.overdub; app.engine.stop(); while (app.store.canUndo()) app.store.undo(); });

  /* ---- R at bar 5, with the count-in, musical typing on Keys */
  // (every note, where its key went down: Scale lock and the grid, on by default for the keys, are sketch-rec-test's)
  await page.evaluate(() => { const q = window.overdub.input.qwerty; q.setScaleLock(false); q.setQuantize(false); });
  await page.evaluate((k) => { const app = window.overdub; app.ui.select({ track: k }); app.engine.seek(16); }, ids.Keys);
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(150);
  const counting = await page.evaluate(() => ({ s: window.overdub.input.recorder.state, b: window.overdub.engine.beat, c: window.overdub.engine.counting }));
  t.ok(counting.s === 'count' && counting.c && counting.c.until === 16, `R starts the count-in: the song pre-rolls from bar 4 with the click (state ${counting.s}, beat ${counting.b.toFixed(2)}, until ${counting.c?.until})`);
  await until(15.8);
  await tapKey('KeyD', 100);                         // E4 in the count's last eighth: the downbeat
  await until(16.5);
  await tapKey('KeyA', 200);                         // C4 on the "and" of beat 1
  await until(18);
  await tapKey('KeyG', 200);                         // G4 on beat 3
  const live = await page.evaluate(() => window.overdub.input.recorder.live());
  t.ok(live.state === 'rec' && live.passes.length === 1 && live.passes[0].notes.length === 3, `while it records, live() has the notes so far (${live.passes[0]?.notes.map((n) => n.p + '@' + n.t).join(' ')})`);
  await shot('record-mid-take');

  /* ---- an agent edit to the target while recording is refused; another track is fine */
  const agent = await page.evaluate(async ({ keys, bass }) => {
    const tools = window.overdub.tools;
    const a = await tools.run('apply_ops', { label: 'add a note', reason: 'test', ops: [{ type: 'notes.add', track: keys, clip: window.overdub.store.get().tracks.find((x) => x.id === keys).clips[0].id, notes: 'C5@0:1' }] }, { by: 'mcp:probe' });
    const b = await tools.run('apply_ops', { label: 'faster', reason: 'test', ops: [{ type: 'project.set', patch: { tempo: 120 } }] }, { by: 'mcp:probe' });
    const c = await tools.run('apply_ops', { label: 'bass down', reason: 'test', ops: [{ type: 'track.set', track: bass, patch: { gain: -2 } }] }, { by: 'mcp:probe' });
    const g = await tools.run('get_recording', {}, { by: 'mcp:probe' });
    return { a, b, c, g, state: window.overdub.input.recorder.state };
  }, { keys: ids.Keys, bass: ids.Bass });
  t.ok(agent.a.error === 'recording' && /recording on Keys \(bars 1–8\)/.test(agent.a.hint), `an agent's edit to Keys while it records is refused: ${agent.a.error}: "${agent.a.hint}"`);
  t.ok(agent.b.error === 'recording' && agent.state === 'rec', 'so is a tempo change (the timeline), and the take keeps going');
  t.ok(!agent.c.error && agent.c.ok !== false, 'an edit to another track (Bass) goes through');
  t.ok(agent.g.state === 'rec' && agent.g.tracks?.[0]?.name === 'Keys' && agent.g.tracks[0].mode === 'take' && agent.g.from.bar === 5 && agent.g.notes_so_far === 3, `get_recording: ${JSON.stringify({ state: agent.g.state, tracks: agent.g.tracks, from: agent.g.from, pass: agent.g.pass, notes: agent.g.notes_so_far })}`);

  await page.keyboard.press('Space');
  await idle();
  const kd = await page.evaluate(() => window.__kd.filter((x) => x.code === 'KeyA' || x.code === 'KeyG'));
  const take1 = await page.evaluate((k) => {
    const app = window.overdub, tr = app.store.track(k), last = app.input.recorder.last;
    return { last: { ok: last.ok, label: last.label, summary: last.summary }, clips: tr.clips.map((c) => ({ id: c.id, start: c.start, length: c.length, mute: !!c.mute, take: c.take || null, notes: c.notes.map((n) => ({ p: n.p, t: n.t, by: n.by })), by: c.by })), playing: app.engine.playing, hist: app.store.history.slice(-1).map((x) => ({ by: x.by, label: x.label })) };
  }, ids.Keys);
  const tk = take1.clips.find((c) => c.take && !c.mute);
  const songBeat = (p) => tk.start + (tk.notes.find((n) => n.p === p)?.t ?? NaN);
  t.ok(tk && tk.start === 16 && near(songBeat(64), 16, 1e-6), `the note in the count's last eighth lands on the downbeat of bar 5 (E4 at beat ${songBeat(64)})`);
  // (the test presses a key from outside the page, a few ms off its aim; where the page heard the key go down is the truth)
  t.ok(Math.floor(songBeat(60) / 4) === 4 && Math.floor(songBeat(67) / 4) === 4 && near(songBeat(60), kd[0]?.beat, 1 / 32) && near(songBeat(67), kd[1]?.beat, 1 / 32), `the notes land in bar 5 where they were played, within 1/32: C4 at ${songBeat(60).toFixed(3)} (its key went down at ${kd[0]?.beat?.toFixed(3)}; aimed at 16.5), G4 at ${songBeat(67).toFixed(3)} (${kd[1]?.beat?.toFixed(3)}; aimed at 18)`);
  t.ok(near(songBeat(60), kd[0]?.beat, 0.005) && near(songBeat(67), kd[1]?.beat, 0.005), `each note sits where its key went down, to 5 ms of a beat (the event's timeStamp, not when the page got to it: ${(Math.abs(songBeat(60) - kd[0]?.beat) * 60000 / tempo).toFixed(1)} ms, ${(Math.abs(songBeat(67) - kd[1]?.beat) * 60000 / tempo).toFixed(1)} ms)`);
  const covered = take1.clips.filter((c) => c.take === tk.take && c.mute);
  t.ok(tk.length === 4 && covered.length === 1 && covered[0].start === 16 && covered[0].length === 4 && take1.clips.some((c) => c.start === 0 && c.length === 16 && !c.mute && !c.take) && take1.clips.some((c) => c.start === 20 && c.length === 12 && !c.mute && !c.take), `New take: played in bar 5 and stopped in it, the take is bar 5 and only bar 5 of Changes is muted; bars 1–4 and 6–8 play on (${take1.clips.map((c) => `${c.start}+${c.length}${c.mute ? ' muted' : ''}`).join(', ')})`);
  t.ok(take1.hist[0].by === 'you' && take1.hist[0].label === 'record take 2 on Keys' && !take1.playing, `one undo step by you ("${take1.hist[0].label}"); Space stopped the song`);
  t.ok(/Take 2 is in on Keys, bar 5; \S.* is muted\. Undo takes it back\./.test(await lastToast()), `the toast: "${await lastToast()}"`);
  const cap = await page.evaluate(() => window.overdub.input.capture.list().find((x) => x.rec));
  t.ok(cap && cap.notes.length === 3 && cap.beat === 16 && /^tk_/.test(cap.take) && cap.pass === 0, `the pass is in capture too (Sketch's Takes), marked in the song (${cap && cap.notes.length} notes from beat ${cap && cap.beat}, ${cap && cap.take} pass ${cap && cap.pass})`);
  await page.keyboard.press('Backquote');
  await reset();

  /* ---- Layer over the demo's Beat: pads into that clip */
  const beatBefore = await page.evaluate((d) => { const tr = window.overdub.store.track(d); return { clips: tr.clips.length, notes: tr.clips[0].notes.length, id: tr.clips[0].id }; }, ids.Drums);
  await page.evaluate((d) => { const app = window.overdub; app.ui.select({ track: d }); app.engine.seek(4); app.ui.show('sketch'); }, ids.Drums);
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyR');
  await until(4.5); await tapKey('KeyJ', 60);       // snare on the "and" of beat 1, bar 2 (the Beat has none there)
  await until(5.25); await tapKey('KeyL', 60);      // open hat on the second sixteenth of beat 2
  await page.waitForTimeout(150);
  const heard = await page.evaluate((d) => window.overdub.store.track(d).clips[0].notes.length, ids.Drums);
  await page.keyboard.press('Space');
  await idle();
  const beatAfter = await page.evaluate((d) => { const app = window.overdub, tr = app.store.track(d), c = tr.clips[0]; return { clips: tr.clips.length, notes: c.notes.length, id: c.id, mine: c.notes.filter((n) => n.by === 'you').map((n) => n.p + '@' + n.t), label: app.store.history.slice(-1)[0]?.label, hist: app.store.history.length }; }, ids.Drums);
  t.ok(beatAfter.clips === 1 && beatAfter.id === beatBefore.id && beatAfter.notes === beatBefore.notes + 2, `Layer: the hits go into the Beat clip, no second clip (${beatBefore.notes} → ${beatAfter.notes} notes; yours: ${beatAfter.mine.join(' ')})`);
  const padKd = await page.evaluate(() => window.__kd.filter((x) => x.code === 'KeyJ' || x.code === 'KeyL').slice(-2));
  const q16 = (b) => Math.round(b / 0.25) * 0.25;
  const wantPads = [`38@${q16(padKd[0]?.beat)}`, `46@${q16(padKd[1]?.beat)}`];
  t.ok(wantPads.every((x) => beatAfter.mine.includes(x)) && beatAfter.label === 'record Drums' && beatAfter.hist === 1, `quantized on input to the 1/16 grid (${wantPads.join(' ')}: played at ${padKd.map((x) => x.beat?.toFixed(3)).join(', ')}), signed by you, one undo step ("${beatAfter.label}")`);
  t.ok(heard === beatBefore.notes + 2, 'while recording, each hit was already in the clip (heard on the next pass), out of the history');
  t.ok(/Your beat is in: bar 2, 2 hits on Drums\./.test(await lastToast()), `your own hits and their own bars: "${await lastToast()}"`);
  await reset();

  /* ---- two loop passes: one clip (pads), two takes (keys) */
  await page.evaluate(() => { const app = window.overdub; app.store.dispatch([{ type: 'project.set', patch: { loop: { on: true, start: 0, end: 4 } } }, { type: 'track.add', ref: 'd', track: { name: 'Kit', instrument: { device: 'core.drums' } } }], { by: 'you', label: 'setup' }); });
  const kit = await page.evaluate(() => window.overdub.store.get().tracks.find((x) => x.name === 'Kit').id);
  await page.evaluate((d) => { const app = window.overdub; app.store.dispatch({ type: 'track.set', track: d, patch: { arm: true } }, { by: 'you' }); app.engine.seek(0); }, kit);
  await page.keyboard.press('KeyR');                // count-in below bar 1: clicks alone
  const below = await page.evaluate(() => { const c = window.overdub.engine.counting; return { beat: window.overdub.engine.beat, c }; });
  await until(1, { grid: true }); await tapKey('KeyF', 60);     // pass 1: kick on beat 2
  await until(6, { grid: true }); await tapKey('KeyJ', 60);     // pass 2 (grid 6 = song beat 2): snare on beat 3
  await until(8.5, { grid: true }); await tapKey('KeyK', 60);   // pass 3: hat on beat 1's "and"
  await page.waitForTimeout(100);
  await page.keyboard.press('Space');
  await idle();
  const pads = await page.evaluate((d) => { const app = window.overdub, tr = app.store.track(d); return tr.clips.map((c) => ({ start: c.start, length: c.length, take: c.take || null, notes: c.notes.map((n) => n.p + '@' + n.t) })); }, kit);
  t.ok(below.c && below.c.from === -4 && below.beat < 0.01, `below bar 1 the count is clicks alone, from beat -4 (beat ${below.beat.toFixed(2)})`);
  const loopKd = await page.evaluate(() => window.__kd.filter((x) => ['KeyF', 'KeyJ', 'KeyK'].includes(x.code)).slice(-3));
  const P_OF = { KeyF: 36, KeyJ: 38, KeyK: 42 };
  const wantLoop = loopKd.map((x) => ({ p: P_OF[x.code], t: Math.round(x.beat / 0.25) * 0.25 })).sort((a, b) => a.t - b.t || a.p - b.p).map((n) => n.p + '@' + n.t).join(' ');
  t.ok(pads.length === 1 && pads[0].start === 0 && pads[0].length === 4 && pads[0].notes.join(' ') === wantLoop, `pads, three passes of a one-bar loop: one clip with every pass layered (${JSON.stringify(pads)}; played ${loopKd.map((x) => x.beat?.toFixed(2)).join(', ')} in passes 1-3)`);
  // keys: two passes, two takes
  await page.evaluate(({ d, k }) => { const app = window.overdub; app.store.dispatch([{ type: 'track.set', track: d, patch: { arm: false } }, { type: 'track.set', track: k, patch: { arm: true } }], { by: 'you' }); app.engine.seek(0); }, { d: kit, k: ids.Keys });
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await until(1, { grid: true }); await tapKey('KeyA', 150);    // pass 1: C4
  await until(5, { grid: true }); await tapKey('KeyS', 150);    // pass 2: D4
  await until(7.5, { grid: true });
  await page.keyboard.press('Space');
  await idle();
  const keysTakes = await page.evaluate((k) => { const tr = window.overdub.store.track(k); return tr.clips.map((c) => ({ start: c.start, length: c.length, mute: !!c.mute, take: c.take || null, name: c.name, notes: c.notes.length > 4 ? c.notes.length : c.notes.map((n) => n.p + '@' + Math.round(n.t * 16) / 16) })); }, ids.Keys);
  const grp = keysTakes.filter((c) => c.take);
  t.ok(grp.length === 3 && grp.filter((c) => !c.mute).length === 1 && /^\["60@/.test(JSON.stringify(grp.find((c) => !c.mute).notes)) && grp.some((c) => c.mute && /^\["62@/.test(JSON.stringify(c.notes))) && grp.every((c) => c.start === 0 && c.length === 4), `keys, a pass and then one cut short by Space: the complete pass (C4) plays, the cut-short one (D4) and the covered bar are kept under it, muted (${grp.map((c) => `${c.name}${c.mute ? ' muted' : ''} ${JSON.stringify(c.notes)}`).join('; ')})`);
  await page.keyboard.press('Backquote');
  await reset();

  /* ---- the punch: the loop is the punch range (notes before it are left out of the take, kept in capture) */
  await page.evaluate((k) => { const app = window.overdub; app.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 8, end: 12 } } }, { by: 'you' }); app.ui.select({ track: k }); app.engine.seek(4); app.input.recorder.setCountIn(0); }, ids.Keys);
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await until(5); await tapKey('KeyA', 150);        // bar 2: before the loop (pre-roll)
  const pre = await state();
  await until(9); await tapKey('KeyG', 150);        // bar 3: in the loop
  await until(10.5);
  await page.keyboard.press('Space');
  await idle();
  const punch = await page.evaluate((k) => { const app = window.overdub; app.input.capture.flush(); const tr = app.store.track(k), c = tr.clips.find((x) => x.take && !x.mute); const cap = app.input.capture.list().filter((x) => !x.rec && (x.notes || []).some((n) => n.p === 60)).length; return { clip: c && { start: c.start, length: c.length, notes: c.notes.filter((n) => n.by === 'you').map((n) => n.p + '@' + Math.round(n.t * 16) / 16), fill: c.notes.filter((n) => n.by !== 'you').every((n) => c.start + n.t >= 10.4) }, cap }; }, ids.Keys);
  t.ok(pre === 'count' && punch.clip && punch.clip.start === 8 && punch.clip.length === 4 && punch.clip.notes.length === 1 && /^67@/.test(punch.clip.notes[0]) && punch.clip.fill, `punch: from bar 2 with the loop on bar 3, the pre-roll's C4 is left out; the take is bar 3 with G4 only, what played there before going on after the stop (${JSON.stringify(punch.clip)}; state before the loop: ${pre})`);
  t.ok(punch.cap >= 1, 'the note outside the loop is still in capture (never lose an idea)');
  await page.keyboard.press('Backquote');
  await page.evaluate(() => window.overdub.input.recorder.setCountIn(1));
  await reset();

  /* ---- the killswitch during a take commits it */
  await page.evaluate((k) => { const app = window.overdub; app.ui.select({ track: k }); app.engine.seek(16); }, ids.Keys);
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await until(16.25); await tapKey('KeyA', 150);
  await until(17); await tapKey('KeyF', 150);
  await page.keyboard.press('Shift+Escape');
  await idle();
  const kill = await page.evaluate((k) => { const app = window.overdub, tr = app.store.track(k), c = tr.clips.find((x) => x.take && !x.mute); return { playing: app.engine.playing, clip: c && c.notes.filter((n) => n.by === 'you').map((n) => n.p), last: app.input.recorder.last?.why }; }, ids.Keys);
  t.ok(!kill.playing && kill.last === 'silence' && JSON.stringify(kill.clip) === '[60,65]', `Shift+Esc silences and keeps the take (${JSON.stringify(kill)})`);
  t.ok(/^Silenced\. Take 2 kept on Keys \(bar 5\)\./.test(await lastToast()), `"${await lastToast()}"`);
  await page.keyboard.press('Backquote');
  await reset();

  /* ---- Shift+R: Put it in the song (a phrase played along, not recording) */
  await page.evaluate((b) => { const app = window.overdub; app.ui.select({ track: b }); app.engine.play(8); }, ids.Bass);
  await page.keyboard.press('Backquote');
  await until(9); await tapKey('KeyA', 150);
  await until(10); await tapKey('KeyD', 150);
  await page.keyboard.press('Backquote');
  await page.evaluate(() => window.overdub.engine.stop());
  await page.keyboard.press('Shift+KeyR');
  await page.waitForTimeout(100);
  const put = await page.evaluate((b) => { const app = window.overdub, tr = app.store.track(b), c = tr.clips.find((x) => x.by === 'you'); return { start: c.start, notes: c.notes.map((n) => ({ p: n.p, t: n.t })), label: app.store.history.slice(-1)[0]?.label }; }, ids.Bass);
  const putKd = await page.evaluate(() => window.__kd.filter((x) => x.code === 'KeyA' || x.code === 'KeyD').slice(-2));
  t.ok(put.start === 8 && put.notes.map((n) => n.p).join() === '60,64' && put.notes.every((n, i) => near(put.start + n.t, putKd[i]?.beat, 0.04)), `Shift+R puts what you just played in the song at the beats you played it (${put.notes.map((n, i) => `${n.p}@${(put.start + n.t).toFixed(3)} (played ${putKd[i]?.beat?.toFixed(3)})`).join(', ')}; "${put.label}")`);
  t.ok(/Put in the song: 2 notes on Bass at bar 3, where you played them\./.test(await lastToast()), `"${await lastToast()}"`);
  await reset();

  /* ---- a hum from a synthesized voice, with the song playing, into a take: lands on its bar */
  const ph = phrase([{ m: 57, beats: 1 }, { m: 60, beats: 1 }, { m: 64, beats: 2 }], { tempo, style: 'hum', range: 'tenor', seed: 5 });
  const voice = renderVoice(ph, 48000);
  const lead = ph.notes[0].t0;    // seconds before the first note
  const hum = await page.evaluate(async ({ k, x, lead }) => {
    const app = window.overdub, en = app.engine, ctx = en.ctx;
    app.ui.select({ track: k });
    app.engine.seek(4);
    await app.input.audio.open();                          // the shim's stream
    await app.input.recorder.record({ countIn: 0 });
    await new Promise((r) => setTimeout(r, 200));
    await app.input.toggleHum();                           // H, in the take
    const buf = ctx.createBuffer(1, x.length, 48000); buf.copyToChannel(Float32Array.from(x), 0);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const mic = window.__mic; src.connect(mic.merge, 0, 0);
    // sung so its first note is heard on bar 3 (beat 8)
    const spb = 60 / app.store.get().tempo, at = ctx.currentTime + (8 - en.beat) * spb - lead;
    src.start(at);
    await new Promise((r) => setTimeout(r, (at - ctx.currentTime + x.length / 48000 + 0.3) * 1000));
    const rec = app.input.hum.recording;
    const res = await app.input.recorder.stop();
    const tr = app.store.track(k), c = tr.clips.find((y) => y.take && !y.mute);
    return { rec, ok: res && res.ok, clip: c && { start: c.start, notes: c.notes.map((n) => ({ p: n.p, t: n.t, d: n.d })) } };
  }, { k: ids.Keys, x: Array.from(voice.x), lead });
  const hn = hum.clip ? hum.clip.notes : [];
  const first = hn.length ? hum.clip.start + hn[0].t : NaN;
  t.ok(hum.rec && hum.ok && hn.map((n) => n.p).join(',') === '57,60,64', `a hum (A3 C4 E4) sung with the song playing goes into the take (${hn.map((n) => n.p).join(',')})`);
  t.ok(Math.floor(first / 4) + 1 === 3 && near(first, 8, 0.125), `and lands on its bar: bar 3, its first note at beat ${first} (sung at 8)`);
  await reset();

  /* ---- fresh eyes 2: hum into the song on the natural path */
  // sing the voice so its first note is heard at song beat `b` (once the transport moves)
  const singAt = (b) => page.evaluate(async ({ x, lead, b }) => {
    const app = window.overdub, en = app.engine, ctx = en.ctx;
    for (let i = 0; i < 200 && !(en.playing && en.beat > -3.9); i++) await new Promise((r) => setTimeout(r, 25));
    const buf = ctx.createBuffer(1, x.length, 48000); buf.copyToChannel(Float32Array.from(x), 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(window.__mic.merge, 0, 0);
    const spb = 60 / app.store.get().tempo, at = ctx.currentTime + (b - en.beat) * spb - lead;
    src.start(at);
    return true;
  }, { x: Array.from(voice.x), lead, b });
  const humTake = (k) => page.evaluate((k) => { const app = window.overdub, tr = app.store.track(k), c = tr.clips.find((y) => y.take && !y.mute && y.by === 'you' && y.notes.some((n) => n.by === 'you')); return { toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '', clip: c && { start: c.start, length: c.length, notes: c.notes.map((n) => ({ p: n.p, t: c.start + n.t, d: n.d })) }, hum: app.input.hum.active, rec: app.input.recorder.state }; }, k);
  // 1. In Hum it, R: the count-in, then the mic into the song; Space while the last note still sounds keeps it
  await page.evaluate((k) => { const app = window.overdub; app.ui.show('sketch'); app.input.emit('sketch:mode', 'hum'); app.ui.select({ track: k }); app.engine.seek(4); app.input.recorder.setCountIn(1); }, ids.Keys);
  const humMode = await page.evaluate(() => window.overdub.input.sketchMode);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(200);
  const humOn = await page.evaluate(() => ({ s: window.overdub.input.recorder.state, hum: window.overdub.input.hum.active, rec: window.overdub.input.hum.recording, c: !!window.overdub.engine.counting }));
  await singAt(8);
  await until(11);                                   // E4 runs 10..12: still sounding
  await page.keyboard.press('Space');
  await idle();
  await page.waitForTimeout(300);
  const h1 = await humTake(ids.Keys);
  const h1n = h1.clip ? h1.clip.notes.filter((n) => n.t >= 8) : [];
  t.ok(humMode === 'hum' && humOn.s === 'count' && humOn.c && humOn.hum && humOn.rec, `in Hum it, R counts in and opens the mic into the take (${JSON.stringify(humOn)})`);
  t.ok(h1n.map((n) => n.p).join(',') === '57,60,64' && near(h1n[0].t, 8, 0.125) && h1.clip.start === 4 && /Take \d+ is in on Keys/.test(h1.toast), `the hum lands in the song at the beats it was sung, the note still sounding at Space kept (${h1n.map((n) => `${n.p}@${n.t}`).join(' ')}; clip from ${h1.clip?.start}; "${h1.toast}")`);
  await reset();
  // 2. H, then R: the hum already going is the take's; what was drawn lands on Space
  await page.evaluate((k) => { const app = window.overdub; app.ui.select({ track: k }); app.engine.seek(4); }, ids.Keys);
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(300);
  const h2pre = await page.evaluate(() => ({ hum: window.overdub.input.hum.active, rec: window.overdub.input.hum.recording }));
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(200);
  const h2mid = await page.evaluate(() => ({ s: window.overdub.input.recorder.state, rec: window.overdub.input.hum.recording }));
  await singAt(8);
  await until(12.5);
  await page.keyboard.press('Space');
  await idle();
  await page.waitForTimeout(300);
  const h2 = await humTake(ids.Keys);
  const h2n = h2.clip ? h2.clip.notes.filter((n) => n.t >= 8) : [];
  t.ok(h2pre.hum && !h2pre.rec && h2mid.rec && h2n.map((n) => n.p).join(',') === '57,60,64' && near(h2n[0].t, 8, 0.125) && !h2.hum, `H, then R: the hum joins the take and lands on Space, not just in Sketch (${JSON.stringify({ pre: h2pre, mid: h2mid })}; ${h2n.map((n) => `${n.p}@${n.t}`).join(' ')}; "${h2.toast}")`);
  await reset();
  // 3. H while the song plays (not recording), then keep: at the beats it was sung, not at the marker
  await page.evaluate(() => { const app = window.overdub; app.engine.seek(0); app.engine.play(4); });
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyH');
  await singAt(10);
  await until(14.5);
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(400);
  const h3 = await page.evaluate((b) => {
    const app = window.overdub; app.engine.stop();
    const tk = app.input.hum.take; if (!tk || !tk.capture) return { none: true, beat: tk && tk.beat };
    const r = app.input.capture.keep(tk.capture, { track: b });
    const c = r.ok ? app.store.clip(r.track, r.clip) : null;
    return { beat: tk.beat, notes: c ? c.notes.map((n) => ({ p: n.p, t: c.start + n.t })) : [], marker: app.transport?.marker?.beat };
  }, ids.Bass);
  t.ok(!h3.none && h3.notes.length >= 3 && near(h3.notes[0].t, 10, 0.125) && h3.notes[0].p === 57, `H during playback: the hum is kept at the beats it was sung (first note at ${h3.notes[0]?.t}, sung at 10; the marker at ${h3.marker})`);
  await reset();
  // 4. fresh eyes 5: a hum recorded with R is moved into the song's key as a hum on its own is, and says so the same
  // way: "Moved 1 note into A minor, the song's key." with Undo, which puts the note back as sung in the take (one undo
  // step of its own, the take still in) and turns Snap off for the hums after. (A3 C#4 E4: C# is outside A minor)
  {
    const sharp = phrase([{ m: 57, beats: 1 }, { m: 61, beats: 1 }, { m: 64, beats: 2 }], { tempo, style: 'hum', range: 'tenor', seed: 5 });
    const sv = renderVoice(sharp, 48000);
    await page.evaluate(() => { for (const x of document.querySelectorAll('.ew-toast')) x.remove(); });
    await page.evaluate((k) => { const app = window.overdub; app.ui.show('sketch'); app.input.emit('sketch:mode', 'hum'); app.ui.select({ track: k }); app.engine.seek(4); app.input.recorder.setCountIn(1); app.input.options.snapKey = true; }, ids.Keys);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(200);
    await page.evaluate(async ({ x, lead, b }) => {
      const app = window.overdub, en = app.engine, ctx = en.ctx;
      for (let i = 0; i < 200 && !(en.playing && en.beat > -3.9); i++) await new Promise((r) => setTimeout(r, 25));
      const buf = ctx.createBuffer(1, x.length, 48000); buf.copyToChannel(Float32Array.from(x), 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(window.__mic.merge, 0, 0);
      src.start(ctx.currentTime + (b - en.beat) * (60 / app.store.get().tempo) - lead);
    }, { x: Array.from(sv.x), lead: sharp.notes[0].t0, b: 8 });
    await until(12.5);
    await page.keyboard.press('Space');
    await idle();
    await page.waitForTimeout(300);
    const mv = await page.evaluate((k) => {
      const app = window.overdub, tr = app.store.track(k), c = tr.clips.find((y) => y.take && !y.mute && y.notes.some((n) => n.by === 'you'));
      const toasts = [...document.querySelectorAll('.ew-toast')].map((x) => ({ text: x.querySelector('.ew-toast-text')?.textContent || '', act: x.querySelector('.ew-toast-act')?.textContent || '' }));
      return { toasts, hist: app.store.history.length, notes: c ? c.notes.filter((n) => c.start + n.t >= 8).map((n) => n.p) : [], take: app.input.hum.take && { rec: app.input.hum.take.rec, moved: app.input.hum.take.result?.moved.length } };
    }, ids.Keys);
    const said = mv.toasts.find((x) => /^Moved/.test(x.text));
    t.ok(mv.take?.rec && mv.take.moved === 1 && mv.notes.length === 3 && mv.notes[0] === 57 && [60, 62].includes(mv.notes[1]) && mv.notes[2] === 64, `in Hum it, R: the hummed C#4 goes into the take moved into A minor (${mv.notes.join(', ')})`);
    t.ok(said && said.text === 'Moved 1 note into A minor, the song’s key.' && said.act === 'Undo' && mv.toasts.some((x) => /^Take \d+ is in on Keys/.test(x.text)), `and the take says so, as a hum on its own does: "${said?.text}" [${said?.act}], beside "${mv.toasts.find((x) => /^Take/.test(x.text))?.text || 'no take toast'}" (${mv.toasts.map((x) => x.text).join(' | ')})`);
    const un = await page.evaluate(async (k) => {
      const app = window.overdub, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('.ew-toast')].find((x) => /^Moved/.test(x.textContent.trim()))?.querySelector('.ew-toast-act');
      const h0 = app.store.history.length;
      b?.click();
      await wait(150);
      const tr = app.store.track(k), c = tr.clips.find((y) => y.take && !y.mute && y.notes.some((n) => n.by === 'you'));
      const top = app.store.history[app.store.history.length - 1];
      const out = { clicked: !!b, steps: app.store.history.length - h0, label: top?.label, by: top?.by, notes: c ? c.notes.filter((n) => c.start + n.t >= 8).map((n) => n.p) : [], snap: app.input.options.snapKey, said: document.querySelector('.ew-announce')?.textContent || '', status: document.querySelector('[data-panel="sketch"] .sk-status')?.textContent || '' };
      app.store.undo();
      const c2 = app.store.track(k).clips.find((y) => y.take && !y.mute && y.notes.some((n) => n.by === 'you'));
      out.undone = c2 ? c2.notes.filter((n) => c2.start + n.t >= 8).map((n) => n.p) : [];
      app.input.options.snapKey = true;
      return out;
    }, ids.Keys);
    t.ok(un.clicked && un.steps === 1 && un.by === 'you' && /back as sung/.test(un.label || '') && un.notes.join() === '57,61,64' && un.snap === false && /Back as you sang it/.test(un.said), `its Undo puts the note back as sung in the take (${un.notes.join(', ')}), one step of its own ("${un.label}"), and Snap is off for the next hum ("${un.said}")`);
    t.ok(mv.notes.length === 3 && un.undone.join() === mv.notes.join(), `and ⌘Z on that step puts the take back as it went in (${un.undone.join(', ')})`);
    await reset();
  }
  await page.evaluate(() => window.overdub.input.emit('sketch:mode', 'play'));

  /* ---- the Inspector's input: the device, and which input of the interface */
  await page.evaluate(() => {
    const mic = window.__mic, ctx = mic.ctx;
    const tone = (hz, ch) => { const o = ctx.createOscillator(); o.frequency.value = hz; const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(mic.merge, 0, ch); o.start(); return o; };
    window.__toneNodes = [tone(220, 0), tone(440, 1)];   // input 1: 220 Hz, input 2: 440 Hz
  });
  await page.evaluate((g) => { const app = window.overdub; app.input.audio.close(); app.ui.select({ track: g }); app.ui.setOpen?.('left', true); app.ui.show('inspector'); }, ids.Guitar);
  await page.waitForSelector('select[aria-label="Input channel"]', { timeout: 5000 });
  const devOpts = await page.evaluate(() => [...document.querySelector('select[aria-label="Input device"]').options].map((o) => o.value));
  const dev = devOpts.find((v) => v && v !== 'default') || null;
  // one take on the input the Inspector names: -> { hz, pk, secs, start } of what was recorded, or { none }
  async function takeOn(channel) {
    // (the Inspector redraws after a take lands: pick until the track says so)
    for (let i = 0; i < 10; i++) {
      await page.selectOption('select[aria-label="Input channel"]', String(channel));
      await page.waitForTimeout(80);
      if (await page.evaluate(({ g, ch }) => +window.overdub.store.track(g).input?.channel === ch, { g: ids.Guitar, ch: channel })) break;
    }
    await page.evaluate((g) => { window.__gum.length = 0; const app = window.overdub; app.ui.select({ track: g }); app.engine.seek(16); }, ids.Guitar);
    const n0 = await page.evaluate((g) => window.overdub.store.track(g).clips.length, ids.Guitar);
    await page.keyboard.press('KeyR');
    await until(19);
    await page.keyboard.press('Space');
    await idle();
    return page.evaluate(async ({ g, n0 }) => {
      const app = window.overdub, tr = app.store.track(g), st = app.input.audio.state;
      const out = { input: tr.input, gum: window.__gum.map((x) => x.audio), channel: st.channel, toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '' };
      if (tr.clips.length === n0) return { ...out, none: true };
      const c = tr.clips.filter((x) => x.kind === 'audio' && !x.mute).pop(), buf = await app.engine.assets.get(c.asset), d = buf.getChannelData(0);
      let pk = 0, zc = 0; for (let i = 1; i < d.length; i++) { pk = Math.max(pk, Math.abs(d[i])); if ((d[i] >= 0) !== (d[i - 1] >= 0)) zc++; }
      return { ...out, pk, hz: Math.round(zc / 2 / buf.duration), secs: buf.duration, start: c.start };
    }, { g: ids.Guitar, n0 });
  }
  if (dev) await page.selectOption('select[aria-label="Input device"]', dev);
  const in2 = await takeOn(2);
  t.ok(in2.input && in2.input.channel === 2 && (!dev || in2.input.device === dev), `the Inspector sets Guitar's input (${JSON.stringify(in2.input)})`);
  t.ok(in2.gum[0] && (!dev || in2.gum[0].deviceId?.exact === dev), `R opens the device the Inspector names (${JSON.stringify(in2.gum[0] && in2.gum[0].deviceId)})`);
  t.ok(!in2.none && in2.pk > 0.2 && Math.abs(in2.hz - 440) < 15 && in2.start >= 16 && in2.secs > 1.5, `and records its input 2: the 440 Hz on it, not input 1's 220 Hz (${in2.hz} Hz, peak ${in2.pk?.toFixed(2)}, ${in2.secs?.toFixed(2)} s from beat ${in2.start})`);
  const in1 = await takeOn(1);
  t.ok(!in1.none && Math.abs(in1.hz - 220) < 15, `input 1 records input 1 (${in1.hz} Hz; ${JSON.stringify({ input: in1.input, gum: in1.gum.length, channel: in1.channel })})`);
  // input 3 of an interface: the device is asked for that many channels, and a channel it doesn't have is silence
  // (never input 1 instead)
  const in3 = await takeOn(3);
  t.ok(in3.gum[0] && in3.gum[0].channelCount?.ideal >= 3 && in3.channel === '3', `input 3: the device is opened asking for 3 channels or more (${JSON.stringify(in3.gum[0] && in3.gum[0].channelCount)}; split to input ${in3.channel})`);
  t.ok(in3.none && /Nothing came in on input 3/.test(in3.toast), `and a two-input device has no input 3: nothing is recorded, rather than input 1 ("${in3.toast}")`);
  await page.evaluate(() => { for (const n of window.__toneNodes || []) { try { n.stop(); } catch (e) { /* ok */ } } });

  /* ---- a plugged-in interface shows up without a reload */
  const dc = await page.evaluate(async () => {
    let got = null;
    const off = window.overdub.input.on('devices', (l) => { got = l; });
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    await new Promise((r) => setTimeout(r, 300));
    off();
    return got && got.length;
  });
  t.ok(dc > 0, `devicechange: the input list is read again and announced (${dc} inputs)`);

  const own = errors.filter((e) => !/arranger|SRC_ICON|roundRect|trackIcon/.test(e));
  t.ok(!own.length, `no page errors${errors.length ? ` from recording (others' in-flight panels: ${errors.length - own.length})` : ''}${own.length ? ': ' + own.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  t.ok(false, 'the studio run threw: ' + (e && e.stack || e));
}
await close();

/* ------------------------------------------------------------------ 3. the studio: fresh eyes 3 (a take's edges) */
{
  const s3 = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const { page } = s3;
  try {
    await page.addInitScript(MIC_SHIM);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    const ev = (fn, a) => page.evaluate(fn, a);
    await ev(async () => { await window.overdub.engine.start(); });
    const wait = (ms) => page.waitForTimeout(ms);
    const grid = () => ev(() => window.overdub.engine.gridBeat ?? -1);
    const untilG = async (b) => { for (let i = 0; i < 1500; i++) { const x = await grid(); if (x >= b) return x; await wait(Math.max(5, Math.min(120, (b - x) * 300))); } return null; };
    const idleR = async () => { for (let i = 0; i < 100 && (await ev(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await wait(50); await wait(150); };
    const resetAll = () => ev(() => { const a = window.overdub; a.engine.stop(); while (a.store.canUndo()) a.store.undo(); a.store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you' }); });
    const ids3 = await ev(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
    const tone = (hz, secs) => ev(({ hz, secs }) => { const mic = window.__mic, ctx = mic.ctx; const o = ctx.createOscillator(); o.frequency.value = hz; const gn = ctx.createGain(); gn.gain.value = 0.4; o.connect(gn); gn.connect(mic.merge, 0, 0); o.start(); o.stop(ctx.currentTime + secs); }, { hz, secs });
    const toast = () => ev(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');
    await resetAll();

    /* ---- a ruler click (a seek) during a mic take keeps the take, ending where it was */
    await ev(async () => { await window.overdub.input.audio.ensureOpen(); });
    await ev(() => { const mic = window.__mic, ctx = mic.ctx; const o = ctx.createOscillator(); o.frequency.value = 220; const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(mic.merge, 0, 0); o.start(); window.__hold = o; });
    await ev((g) => { const a = window.overdub; a.ui.select({ track: g }); a.engine.seek(16); }, ids3.Guitar);
    const caps0 = await ev(() => window.overdub.input.capture.list({ all: true }).filter((x) => x.kind === 'audio').length);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await untilG(24);
    await ev(() => window.overdub.engine.seek(4));     // the ruler, on bar 2
    await idleR();
    const sk = await ev(({ g, caps0 }) => { const a = window.overdub, c = a.store.track(g).clips.find((x) => x.take && !x.mute); return { clip: c && { start: c.start, length: c.length }, caps: a.input.capture.list({ all: true }).filter((x) => x.kind === 'audio').length - caps0, last: a.input.recorder.last?.why }; }, { g: ids3.Guitar, caps0 });
    await ev(() => { try { window.__hold.stop(); } catch (e) { /* ok */ } window.overdub.engine.stop(); });
    t.ok(sk.clip && near(sk.clip.start, 16, 0.1) && sk.clip.length > 7 && sk.clip.length < 9 && sk.caps === 1 && sk.last === 'seek', `a seek back to bar 2 during a mic take from bar 5 keeps the take where it was played (${JSON.stringify(sk)})`);
    await resetAll();

    /* ---- and a seek during a looped keys take: the passes and the held note are kept as played */
    await ev((k) => { const a = window.overdub; a.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 16, end: 24 } } }, { by: 'you' }); a.ui.select({ track: k }); a.engine.seek(16); }, ids3.Keys);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    const tap = async (p, at, ms = 120) => { await untilG(at); await ev((p) => window.overdub.input.noteOn('t', p, 0.8), p); await wait(ms); await ev((p) => window.overdub.input.noteOff('t', p), p); };
    await tap(72, 17); await tap(74, 26.5); await untilG(35);
    await ev(() => window.overdub.input.noteOn('t', 77, 0.8));
    await untilG(36.5);
    await ev(() => window.overdub.engine.seek(16));
    await idleR();
    await ev(() => window.overdub.input.noteOff('t', 77));
    const lk = await ev((k) => { const a = window.overdub, tr = a.store.track(k); const f = tr.clips.filter((c) => c.take); const pl = f.find((c) => !c.mute); const held = f.flatMap((c) => c.notes.filter((n) => n.p === 77 && n.by === 'you')); return { range: [Math.min(...f.map((c) => c.start)), Math.max(...f.map((c) => c.start + c.length))], playing: pl && pl.notes.filter((n) => n.by === 'you').map((n) => n.p), held: held.map((n) => n.d) }; }, ids3.Keys);
    await ev(() => window.overdub.engine.stop());
    t.ok(lk.range.join() === '16,24' && lk.playing?.join() === '74' && lk.held.length === 1 && lk.held[0] > 1, `a seek three passes into a looped take: the folder is bars 5–6, the last complete pass plays, the held note keeps its length (${JSON.stringify(lk)})`);
    await resetAll();

    /* ---- ⌘Z during a take is the take's: the last pass comes out, the song's history stays */
    await ev((k) => { const a = window.overdub; a.ui.select({ track: k }); a.engine.seek(16); }, ids3.Keys);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await tap(72, 16.4); await untilG(20.2);
    await ev(() => window.overdub.input.recorder.stop()); await idleR();
    const h1 = await ev(() => window.overdub.store.history.map((x) => x.label));
    await ev((k) => { const a = window.overdub; a.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 16, end: 20 } } }, { by: 'you', label: 'loop' }); a.engine.seek(16); }, ids3.Keys);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await tap(76, 16.4); await untilG(16.9);
    await page.keyboard.press('Meta+KeyZ');            // the first pass, still running: nothing to take out
    await wait(120);
    const z1 = { state: await ev(() => window.overdub.input.recorder.state), hist: await ev(() => window.overdub.store.history.length), toast: await toast() };
    await tap(79, 20.5); await untilG(24.4);           // pass 1 (79), then into pass 2
    await page.keyboard.press('Meta+KeyZ');            // takes pass 1 out
    await wait(120);
    const z2 = { toast: await toast(), passes: await ev(() => window.overdub.input.recorder.passes().map((x) => x.n)) };
    await untilG(25.5);
    await ev(() => window.overdub.input.recorder.stop()); await idleR();
    const zz = await ev((k) => { const a = window.overdub, tr = a.store.track(k); return { hist: a.store.history.map((x) => x.label), mine: tr.clips.flatMap((c) => c.notes.filter((n) => n.by === 'you').map((n) => n.p)).sort() }; }, ids3.Keys);
    t.ok(z1.state === 'rec' && z1.hist === h1.length + 1 && /No finished pass/.test(z1.toast), `⌘Z in a take's first pass undoes nothing in the song ("${z1.toast}"; ${z1.hist} steps)`);
    t.ok(/^Pass 2 is out of the take \(1 note\)/.test(z2.toast) && !z2.passes.includes(1), `⌘Z after a pass takes that pass out of the take ("${z2.toast}")`);
    t.ok(zz.hist.length === h1.length + 2 && zz.hist[0] === h1[0] && zz.mine.join() === '72,76', `and the stop puts the take in after the first one, which stays: ${zz.hist.join(' / ')}; your notes ${zz.mine.join(', ')} (79 taken out)`);
    await resetAll();

    /* ---- a note begun just before the loop comes round is the next pass's downbeat, in your own timing too (fresh
       eyes 5, My timing: one 0.03 beats early and held over the wrap landed as a 0.03-beat stub at the end of the pass
       before, the next pass had no downbeat, and ⌘Z said "(4 notes)" of a pass of 5, leaving the early one behind).
       The notes go in on the recorder's grid as the hum's do, so where each lands is exact */
    await ev((k) => { const a = window.overdub; a.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 16, end: 20 } } }, { by: 'you', label: 'loop' }); a.ui.select({ track: k }); a.engine.seek(16); }, ids3.Keys);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await untilG(16.5);
    const ew = await ev(() => {
      const r = window.overdub.input.recorder, w = r.where(r.gridNow(true));
      // 0.03 beats before this pass ends, held a beat over the wrap; then four more in the next pass
      const n = r.addNotes([{ p: 72, g: w.g1 - 0.03, d: 1, v: 0.8 }, ...[74, 76, 77, 79].map((p, i) => ({ p, g: w.g1 + 0.5 + i * 0.5, d: 0.4, v: 0.8 }))], { src: 'hum' });
      return { pass: w.pass, g1: w.g1, added: n };
    });
    await untilG(ew.g1 + 4.4);                         // into the pass after
    const el = await ev(() => { const L = window.overdub.input.recorder.live(); return L.passes.flatMap((ps) => ps.notes.map((n) => ({ pass: ps.n, p: n.p, t: Math.round(n.t * 1000) / 1000, d: Math.round(n.d * 1000) / 1000 }))); });
    const early = el.filter((x) => x.p === 72);
    t.ok(ew.added === 5 && early.length === 1 && early[0].pass === ew.pass + 1 && early[0].t === 16 && Math.abs(early[0].d - 0.97) < 0.01 && !el.some((x) => x.pass === ew.pass && x.t > 19.8), `a note 0.03 beats before the loop's end, held over it, is the next pass's downbeat at bar 5 (${JSON.stringify(early)}), not a stub at the end of the pass before`);
    await page.keyboard.press('Meta+KeyZ');            // the pass it began: all five of its notes come out together
    await wait(150);
    const ez = { toast: await toast(), left: await ev(() => window.overdub.input.recorder.live().passes.flatMap((ps) => ps.notes.map((n) => n.p))) };
    await ev(() => window.overdub.input.recorder.cancel()); await idleR();
    t.ok(new RegExp(`^Pass ${ew.pass + 2} is out of the take \\(5 notes\\)`).test(ez.toast) && !ez.left.includes(72), `⌘Z takes that pass out whole, the early downbeat with it ("${ez.toast}"; left ${ez.left.join(', ') || 'none'})`);
    await resetAll();

    /* ---- MIDI with Drums selected records onto Drums, as R says */
    await ev((d) => { const a = window.overdub; a.ui.select({ track: d }); a.engine.seek(16); }, ids3.Drums);
    const tg = await ev(() => { const a = window.overdub; return { r: a.store.track(a.input.recorder.target)?.name, keys: a.input.target()?.name }; });
    const bass0 = await ev((b) => JSON.stringify(window.overdub.store.track(b).clips), ids3.Bass);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    for (const [p, at] of [[36, 16.5], [38, 17.5]]) { await untilG(at); await ev((p) => window.overdub.input.noteOn('midi', p, 0.9, 'midi'), p); await wait(60); await ev((p) => window.overdub.input.noteOff('midi', p, 'midi'), p); }
    await untilG(18.2);
    await ev(() => window.overdub.input.recorder.stop()); await idleR();
    const dr = await ev(({ d, b }) => { const a = window.overdub; return { summary: a.input.recorder.last?.summary, mine: a.store.track(d).clips.flatMap((c) => c.notes.filter((n) => n.by === 'you').map((n) => n.p)), bass: JSON.stringify(a.store.track(b).clips) }; }, { d: ids3.Drums, b: ids3.Bass });
    t.ok(tg.r === 'Drums' && tg.keys === 'Drums' && dr.mine.join() === '36,38' && dr.bass === bass0 && /Drums/.test(dr.summary), `with Drums selected, MIDI plays and records onto Drums, the track R names; Bass is untouched (${JSON.stringify({ ...tg, mine: dr.mine, summary: dr.summary })})`);
    await resetAll();

    /* ---- Hum it: R during the count-in calls the hum off too */
    await ev((k) => { const a = window.overdub; a.ui.select({ track: k }); a.engine.seek(16); a.ui.show?.('sketch'); a.input.emit('sketch:mode', 'hum'); }, ids3.Keys);
    await wait(300);
    await page.keyboard.press('KeyR');
    await wait(500);
    const hc0 = await ev(() => ({ st: window.overdub.input.recorder.state, hum: window.overdub.input.hum.active }));
    await page.keyboard.press('KeyR');
    await wait(400);
    const hc1 = await ev(() => ({ st: window.overdub.input.recorder.state, hum: window.overdub.input.hum.active, rec: window.overdub.input.hum.recording }));
    t.ok(hc0.st === 'count' && hc0.hum && hc1.st === 'idle' && !hc1.hum && !hc1.rec, `Hum it: R starts the hum with the count-in, R again calls both off (${JSON.stringify([hc0, hc1])})`);
    await resetAll();

    /* ---- H, then R: what was hummed before R stays in Sketch */
    await ev((k) => { const a = window.overdub; a.ui.select({ track: k }); a.engine.seek(16); a.input.emit('sketch:mode', 'play'); }, ids3.Keys);
    const hcap0 = await ev(() => window.overdub.input.capture.list({ all: true }).map((x) => x.id));
    await ev(() => window.overdub.input.toggleHum());
    await wait(300); await tone(220, 1.2); await wait(1500);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await wait(400); await tone(330, 1.0); await wait(1400);
    await ev(() => window.overdub.input.recorder.stop()); await idleR(); await wait(400);
    const hr = await ev(({ k, ids }) => { const a = window.overdub; const caps = a.input.capture.list({ all: true }).filter((x) => !ids.includes(x.id)); return { take: a.store.track(k).clips.filter((c) => c.take && !c.mute).flatMap((c) => c.notes.filter((n) => n.by === 'you').map((n) => n.p)), sketch: caps.filter((x) => x.src === 'hum' && !x.rec).flatMap((x) => (x.notes || []).map((n) => n.p)) }; }, { k: ids3.Keys, ids: hcap0 });
    t.ok(hr.take.includes(64) && hr.sketch.includes(57) && !hr.take.includes(57), `H, then R: the hum after R is the take (${hr.take.join(', ')}), the A3 hummed before it is kept in Sketch (${hr.sketch.join(', ')})`);
    await resetAll();

    const own3 = s3.errors.filter((e) => !/arranger|SRC_ICON|roundRect|trackIcon/.test(e));
    t.ok(!own3.length, `no page errors in the take's edges${own3.length ? ': ' + own3.slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    t.ok(false, 'the edges run threw: ' + (e && e.stack || e));
  }
  await s3.close();
}

/* ------------------------------------------------------------------ 4. the studio: fresh eyes 4 (a tune over the loop's seam) */
// The beginner and the phone: with the loop already playing, record waits for the next bar, so a tune starts near the
// loop's end and runs on round it. Real keys (musical typing), R and Space, and the Sketch panel's Record button.
{
  const s4 = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const { page } = s4;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    const ev = (fn, a) => page.evaluate(fn, a);
    const wait = (ms) => page.waitForTimeout(ms);
    const grid = () => ev(() => window.overdub.engine.gridBeat ?? -1);
    const untilG = async (b) => { for (let i = 0; i < 1500; i++) { const x = await grid(); if (x >= b - 0.01) return x; await wait(Math.max(5, Math.min(120, (b - x) * 300))); } return null; };
    const idleR = async () => { for (let i = 0; i < 100 && (await ev(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await wait(50); await wait(150); };
    const key = async (code, ms = 100) => { await page.keyboard.down(code); await wait(ms); await page.keyboard.up(code); };
    const toast = () => ev(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');
    await ev(async () => { const a = window.overdub; await a.engine.start(); a.ui.setOpen?.('bottom', true); a.ui.show('sketch'); const q = a.input.qwerty; q.setScaleLock(false); q.setQuantize(false); a.input.recorder.setCountIn(1); });
    // the first minute's shape: a 2-bar loop already playing, a new track to play a tune on
    const setup = () => ev(() => {
      const a = window.overdub; a.engine.stop();
      const r = a.store.dispatch([{ type: 'project.set', patch: { loop: { on: true, start: 0, end: 8 } } }, { type: 'track.add', ref: 't', track: { name: 'Tune', instrument: { device: 'core.keys' } } }], { by: 'you', label: 'setup' });
      a.ui.select({ track: r.created.t }); a.engine.play(0);
      return r.created.t;
    });
    const takeOf = (k) => ev((k) => { const a = window.overdub, tr = a.store.track(k); return { take: a.input.recorder.last?.take, clips: tr.clips.map((c) => ({ name: c.name, mute: !!c.mute, start: c.start, length: c.length, notes: c.notes.map((n) => ({ p: n.p, t: Math.round((c.start + n.t) * 100) / 100 })) })) }; }, k);
    // Sketch's Takes: the cards of this song, each with its phrase
    const takesList = (take) => ev((take) => {
      const a = window.overdub;
      return [...document.querySelectorAll('.sk-idea:not(.sk-other)')].map((c) => ({ c, p: a.input.capture.get(c.dataset.id) })).filter((x) => x.p && (x.p.take === take || x.p.inTake === take || (!x.p.rec && x.p.at > Date.now() - 60000)))
        .map(({ c, p }) => ({ rec: !!p.rec, notes: (p.notes || []).length, put: !!c.querySelector('.sk-put'), insong: c.querySelector('.sk-insong')?.textContent || '' }));
    }, take);
    const QW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];   // C4 D4 E4 F4 G4 A4 B4 C5
    await page.keyboard.press('Backquote');

    // 1. R in bar 1: recording starts at bar 2; an 8-note tune from bar 2 runs on round the loop; Space a pass later
    const k1 = await setup();
    await untilG(1.2);
    await page.keyboard.press('KeyR');
    for (let i = 0; i < 8; i++) { await untilG(5.2 + i * 0.75); await key(QW[i]); }
    await untilG(17);
    await page.keyboard.press('Space');
    await idleR();
    const a1 = await takeOf(k1), t1 = await toast();
    const play1 = a1.clips.filter((c) => !c.mute);
    await shot4('record-seam-whole');
    t.ok(play1.length === 1 && play1[0].notes.map((n) => n.p).join() === '67,69,71,72,60,62,64,65' && play1[0].start === 0 && play1[0].length === 8 && a1.clips.length === 1, `a tune played on round the loop's end is one take, all 8 notes playing, its last ones at bar 1 where they came round (${a1.clips.map((c) => `${c.name}${c.mute ? ' muted' : ''}: ${c.notes.map((n) => n.p + '@' + n.t).join(' ')}`).join('; ')})`);
    t.ok(/^Take 1 is in on Tune, bars 1–2\. Your phrase ran past the loop's end and is kept whole: its last 4 notes come round at bar 1\. Undo takes it back\./.test(t1), `the toast says so: "${t1}"`);
    await wait(2700);                                   // (the played phrase closes after its silence)
    const l1 = await takesList(a1.take);
    t.ok(l1.length === 1 && l1[0].rec && l1[0].notes === 8 && !l1[0].put && /in the song: Tune, bars 1–2/.test(l1[0].insong), `Takes lists the tune once, whole and in the song, with no second copy offering to put it in (${JSON.stringify(l1)})`);

    // 2. Sketch's Record button; 7 notes in the first pass, 1 late in the next; Space a pass later
    const k2 = await setup();
    await untilG(1.2);
    await page.click('.sk-recbtn');
    for (let i = 0; i < 7; i++) { await untilG(4.25 + i * 0.5); await key(QW[i], 80); }
    await untilG(15); await key('KeyG', 80);
    await untilG(17);
    await page.keyboard.press('Space');
    await idleR();
    const a2 = await takeOf(k2), t2 = await toast();
    const play2 = a2.clips.filter((c) => !c.mute);
    t.ok(play2.length === 1 && play2[0].notes.length === 7 && a2.clips.some((c) => c.mute && c.notes.length === 1), `a last pass of 1 note doesn't play over the 7 before it: the 7 play, the 1 is underneath (${a2.clips.map((c) => `${c.name}${c.mute ? ' muted' : ''}: ${c.notes.length}`).join('; ')})`);
    t.ok(/^Take 1 is in on Tune, bars 1–2\. One more underneath, muted\. The last time round had only 1 note, so the fuller take plays \(7 notes\)\./.test(t2), `and the toast says why: "${t2}"`);
    await wait(2700);
    const l2 = await takesList(a2.take);
    t.ok(l2.length === 2 && l2.every((x) => x.rec && !x.put) && l2.map((x) => x.notes).sort().join() === '1,7', `Takes: one card per pass, no copies of them (${JSON.stringify(l2)})`);
    await ev(() => window.overdub.engine.stop());
    await page.keyboard.press('Backquote');
    const own4 = s4.errors.filter((e) => !/arranger|SRC_ICON|roundRect|trackIcon/.test(e));
    t.ok(!own4.length, `no page errors over the seam${own4.length ? ': ' + own4.slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    t.ok(false, 'the seam run threw: ' + (e && e.stack || e));
  }
  async function shot4(name) { try { await s4.shot(name); } catch (e) { /* ok */ } }
  await s4.close();
}
t.done();
