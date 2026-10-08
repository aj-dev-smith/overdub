// Checks for the musical transforms and infill (app/src/core/transforms.js), the `transform` agent tool
// (app/src/agent/transforms-tool.js) and the piano roll's Transform menu / the inspector's quick buttons.
//   node tools/transforms-test.js      (screenshot: tools/.out/transforms-menu.png)
import {
  TRANSFORMS,
  transform,
  planTransform,
  runTransform,
  guessKey,
  findTransform,
  catalog,
} from '../app/src/core/transforms.js';
import { parseNotes, inScale, formatNotes } from '../app/src/core/music.js';
import { createStore } from '../app/src/core/store.js';
import { open, tally } from './pw.js';

const T = tally('transforms');
const key = { root: 'A', scale: 'minor' };
const ids = (ns, pre) => ns.map((n, i) => ({ ...n, id: pre + i, by: 'you' }));
const MEL = ids(
  parseNotes(
    'E5@0:0.5 D5@0.5:0.5 C5@1:0.5 A4@1.5:1.5 G4@3:0.5 A4@3.5:0.5 C5@4:1 A4@5:0.5 C5@5.5:0.5 D5@6:1.5 C5@7.5:0.5',
  ),
  'm',
);
const CHORDS = ids(
  parseNotes('A3@0:4 C4@0:4 E4@0:4 F3@4:4 A3@4:4 C4@4:4 C3@8:4 E3@8:4 G3@8:4 G3@12:4 B3@12:4 D4@12:4'),
  'c',
);
const GAP = ids(parseNotes('A4@0:0.5 C5@0.5:0.5 D5@1:0.5 E5@1.5:0.5 C5@2:1 E5@8:0.5 D5@8.5:0.5 C5@9:1'), 'g');
const LOOSE = ids(parseNotes('A4@0.04:0.5 C5@0.52:0.5 E5@0.97:0.5 D5@1.55:0.4 C5@2.02:1'), 'l');
const DRUMS = ids(
  parseNotes(
    '36@0:0.25 42@0:0.25 42@0.5:0.25*0.45 38@1:0.25 42@1:0.25 42@1.5:0.25*0.45 36@2:0.25 42@2:0.25 38@3:0.25 42@3.5:0.25*0.45',
  ),
  'd',
);
const SRC = { strum: CHORDS, arpeggiate: CHORDS, melody_from_chords: CHORDS, fill_the_gap: GAP, quantize: LOOSE };
const src = (name) => SRC[name] || MEL;
const ctx = { key, tempo: 92, meter: [4, 4], start: 0 };
const fmt = (ns) => formatNotes(ns) + '|' + ns.map((n) => n.id || '+').join(',');
const allIn = (ns) => ns.every((n) => inScale(n.p, key));
const inRange = (ns) => ns.every((n) => n.p >= 0 && n.p <= 127 && n.t >= 0 && n.d > 0 && n.v > 0 && n.v <= 1);

/* ================================================================== the transforms, in Node */
T.ok(TRANSFORMS.length === 16, `16 transforms (${TRANSFORMS.map((t) => t.name).join(', ')})`);
T.ok(
  TRANSFORMS.every((t) => t.blurb && t.blurb.length < 140 && t.presets.length >= 2 && typeof t.describe === 'function'),
  'each has a one-line blurb, a describe() and at least two presets (the menu and the second take)',
);
T.ok(catalog().split('\n').length === TRANSFORMS.length, 'the catalog lists one line each');
T.ok(
  findTransform('fill-the-gap')?.name === 'fill_the_gap' &&
    findTransform('harmonize')?.name === 'chords_from_melody' &&
    findTransform('Chords from melody')?.name === 'chords_from_melody',
  'names are forgiving (hyphens, spaces, aliases)',
);
const gk = guessKey(CHORDS);
T.ok(
  ['A minor', 'C major'].includes(`${gk.root} ${gk.scale}`),
  `guessKey hears A minor or its relative major (${gk.root} ${gk.scale})`,
);

const COUNT = {
  // [min, max] notes out, for n notes in
  humanize: (n, m) => m === n,
  quantize: (n, m) => m === n,
  strum: (n, m) => m === n,
  legato: (n, m) => m === n,
  staccato: (n, m) => m === n,
  transpose: (n, m) => m === n,
  invert: (n, m) => m === n,
  retrograde: (n, m) => m === n,
  double: (n, m) => m === 2 * n,
  thin: (n, m) => m > 0 && m < n,
  ornament: (n, m) => m > n && m <= n * 4,
  arpeggiate: (n, m) => m >= n && m <= 16 * 4 + 4,
  chords_from_melody: (n, m) => m > n && m <= n + 16 * 4,
  melody_from_chords: (n, m) => m > n && m <= n + 16 * 3,
  continue: (n, m) => m > n && m <= n * 3,
  fill_the_gap: (n, m) => m > n && m <= n + 24,
};
const SEEDED = { arpeggiate: { pattern: 'random' }, fill_the_gap: { style: 'run' } };
const PITCHED_KEEP = new Set([
  'humanize',
  'quantize',
  'strum',
  'legato',
  'staccato',
  'retrograde',
  'thin',
  'arpeggiate',
]);
for (const t of TRANSFORMS) {
  const ns = src(t.name);
  let a,
    b,
    err = null;
  try {
    a = transform(t.name, ns, {}, ctx);
    b = transform(t.name, ns, {}, ctx);
  } catch (e) {
    err = e;
  }
  if (!T.ok(!err, `${t.name} runs on its example${err ? ': ' + err.message : ''}`)) continue;
  T.ok(fmt(a.notes) === fmt(b.notes), `${t.name}: same input, same seed → the same notes`);
  T.ok(COUNT[t.name](ns.length, a.notes.length), `${t.name}: ${ns.length} → ${a.notes.length} notes`);
  T.ok(inRange(a.notes), `${t.name}: every note in range (pitch 0..127, t ≥ 0, d > 0, v 0..1)`);
  T.ok(
    allIn(a.notes),
    `${t.name}: stays in ${key.root} ${key.scale}${PITCHED_KEEP.has(t.name) ? ' (keeps the pitches)' : ''}`,
  );
  T.ok(
    typeof a.summary === 'string' && a.summary.length > 8 && !/undefined|NaN/.test(a.summary),
    `${t.name} says what it did: "${a.summary}"`,
  );
  if ('seed' in t.params) {
    const sp = SEEDED[t.name] || {}; // the setting where chance plays a part
    const one = fmt(transform(t.name, ns, { ...sp, seed: 1 }, ctx).notes);
    const others = [2, 3, 4, 5].map((s) => fmt(transform(t.name, ns, { ...sp, seed: s }, ctx).notes));
    T.ok(
      others.some((x) => x !== one),
      `${t.name}: another seed gives another take`,
    );
    T.ok(fmt(transform(t.name, ns, { ...sp, seed: 3 }, ctx).notes) === others[1], `${t.name}: seed 3 is repeatable`);
  }
}

// musical specifics
{
  const tr = transform('transpose', MEL, { steps: 2 }, ctx).notes;
  T.ok(
    tr.every((n, i) => n.p > MEL[i].p && n.p - MEL[i].p <= 4),
    'transpose +2 steps moves each note up a third (3 or 4 semitones)',
  );
  const oct = transform('transpose', MEL, { steps: 7 }, ctx).notes;
  T.ok(
    oct.every((n, i) => n.p - MEL[i].p === 12),
    'transpose 7 steps = an octave',
  );
  const inv = transform('invert', MEL, {}, ctx).notes;
  T.ok(
    inv[0].p === MEL[0].p && inv[1].p > MEL[0].p,
    'invert mirrors around the first note (the first stays, the second goes the other way)',
  );
  const twice = transform('invert', inv, {}, ctx).notes;
  T.ok(fmt(twice) === fmt(MEL), 'inverting twice gives the line back');
  const rt = transform('retrograde', MEL, {}, ctx).notes.sort((x, y) => x.t - y.t);
  T.ok(rt[0].p === MEL[MEL.length - 1].p && rt[rt.length - 1].p === MEL[0].p, 'retrograde: the last note comes first');
  const rp = transform('retrograde', MEL, { mode: 'pitches' }, ctx).notes;
  T.ok(
    rp.map((n) => n.t).join() === MEL.map((n) => n.t).join() && rp[0].p === MEL[MEL.length - 1].p,
    'retrograde "pitches" keeps the rhythm, reverses the line',
  );
  const st = transform('strum', CHORDS, { direction: 'up', ms: 30 }, ctx)
    .notes.filter((n) => n.t < 1)
    .sort((x, y) => x.t - y.t);
  T.ok(
    st[0].p < st[1].p && st[1].p < st[2].p && st[1].t > 0 && st[2].t > st[1].t,
    'strum up: low to high, a few ms apart',
  );
  T.ok(Math.abs(st[1].t - st[0].t - (30 * 92) / 60000) < 0.002, 'strum: 30 ms between strings at 92 bpm');
  const sd = transform('strum', CHORDS, { direction: 'down' }, ctx)
    .notes.filter((n) => n.t < 1)
    .sort((x, y) => x.t - y.t);
  T.ok(sd[0].p > sd[2].p, 'strum down: high to low');
  const ar = transform('arpeggiate', CHORDS, { pattern: 'up', rate: 0.5 }, ctx)
    .notes.filter((n) => n.t < 4)
    .sort((x, y) => x.t - y.t);
  T.ok(
    ar.length === 8 && ar[0].p === 57 && ar[1].p === 60 && ar[2].p === 64 && ar[3].p === 57,
    `arpeggiate up in 8ths: A C E A … (${formatNotes(ar.slice(0, 4))})`,
  );
  const ad = transform('arpeggiate', CHORDS, { pattern: 'updown', rate: 0.5 }, ctx)
    .notes.filter((n) => n.t < 4)
    .sort((x, y) => x.t - y.t);
  T.ok(
    ad
      .slice(0, 5)
      .map((n) => n.p)
      .join() === '57,60,64,60,57',
    'arpeggiate updown: A C E C A',
  );
  const lg = transform('legato', LOOSE, {}, ctx).notes.sort((x, y) => x.t - y.t);
  T.ok(
    lg.slice(0, -1).every((n, i) => Math.abs(n.t + n.d - lg[i + 1].t) < 1e-3),
    'legato: each note ends where the next begins',
  );
  const sc = transform('staccato', MEL, { length: 0.5 }, ctx).notes;
  T.ok(
    sc.every((n, i) => Math.abs(n.d - MEL[i].d / 2) < 1e-3),
    'staccato 50% halves every length',
  );
  const q = transform('quantize', LOOSE, { grid: 0.5 }, ctx).notes;
  T.ok(
    q.every((n) => Math.abs(n.t * 2 - Math.round(n.t * 2)) < 1e-6),
    'quantize to 1/8 lands every onset on an 8th',
  );
  const q2 = transform('quantize', LOOSE, { grid: 0.5, strength: 0.5 }, ctx).notes;
  T.ok(
    q2.some((n) => Math.abs(n.t * 2 - Math.round(n.t * 2)) > 1e-3),
    'quantize at 50% strength only goes halfway',
  );
  const hu = transform('humanize', MEL, { amount: 0.5 }, ctx).notes;
  T.ok(
    hu.every((n, i) => Math.abs(n.t - MEL[i].t) <= ((4 + 22 * 0.5) * 1.25 * 92) / 60000 + 1e-3) &&
      hu.some((n, i) => n.t !== MEL[i].t),
    'humanize moves notes, but by no more than its ±ms',
  );
  const th = transform('thin', MEL, { every: 3 }, ctx).notes;
  T.ok(th.length === 4, `thin every 3rd keeps 4 of 11 (${th.length})`);
  const dbl = transform('double', MEL, { octave: -1 }, ctx).notes;
  T.ok(
    dbl.filter((n) => !n.id).every((n) => MEL.some((m) => m.p - 12 === n.p && m.t === n.t)),
    'double -1 adds the line an octave down',
  );
  T.ok(
    transform('double', dbl, { octave: -1 }, ctx).notes.length === dbl.length + MEL.length,
    'double skips doubles that already exist',
  );
  const ch = transform('chords_from_melody', MEL, { every: 'half' }, ctx).notes.filter((n) => !n.id);
  const starts = [...new Set(ch.map((n) => n.t))];
  T.ok(
    starts.every((t) => t % 2 === 0) && starts.length === 4,
    `chords from melody: one chord per half bar (${starts.join(', ')})`,
  );
  T.ok(
    starts.every((t) => {
      const c = ch.filter((n) => n.t === t);
      const mel = MEL.filter((n) => n.t < t + 2 && n.t + n.d > t);
      return c.length === 3 && Math.max(...c.map((n) => n.p)) < Math.min(...mel.map((n) => n.p));
    }),
    'chords are triads voiced under the melody',
  );
  const ch7 = transform('chords_from_melody', MEL, { kind: 'sevenths', every: 'bar' }, ctx).notes.filter((n) => !n.id);
  T.ok(
    ch7.length >= 6 && ch7.length <= 8 && new Set(ch7.map((n) => n.t)).size === 2,
    'sevenths per bar: two four-note chords',
  );
  const mel = transform('melody_from_chords', CHORDS, {}, ctx).notes.filter((n) => !n.id);
  T.ok(
    mel.every((n) => n.p >= 55 && n.p <= 84) &&
      Math.max(...mel.map((n) => n.p)) - Math.min(...mel.map((n) => n.p)) <= 17,
    `melody from chords stays singable (${formatNotes([mel.reduce((a, b) => (b.p < a.p ? b : a))])}…, within a 10th)`,
  );
  const onBeats = mel.filter((n) => Number.isInteger(n.t));
  T.ok(
    onBeats.every((n) => CHORDS.some((c) => c.p % 12 === n.p % 12 && c.t <= n.t + 0.01 && c.t + c.d > n.t)),
    'melody from chords: every on-beat note is a tone of the chord under it',
  );
  const leaps = mel
    .sort((a, b) => a.t - b.t)
    .slice(1)
    .map((n, i) => Math.abs(n.p - mel[i].p));
  T.ok(
    leaps.every((x) => x <= 12) && leaps.filter((x) => x <= 2).length >= leaps.length / 3,
    `melody from chords moves mostly by step, never more than an octave (largest ${Math.max(...leaps)})`,
  );
  const co = transform('continue', MEL, { bars: 2 }, ctx)
    .notes.filter((n) => !n.id)
    .sort((a, b) => a.t - b.t);
  T.ok(co[0].t >= 8 && co[co.length - 1].t < 16, 'continue writes the next 2 bars (beats 8–16)');
  const last = co[co.length - 1];
  T.ok(
    [9, 0, 4].includes(last.p % 12) && last.t + last.d >= 15.99,
    `continue ends on the tonic chord, ringing to the bar line (${formatNotes([last])})`,
  );
  const co4 = transform('continue', MEL, { bars: 4 }, ctx).notes;
  T.ok(co4.length > transform('continue', MEL, { bars: 2 }, ctx).notes.length, 'continue 4 bars writes more than 2');
  const fg = transform('fill_the_gap', GAP, {}, ctx)
    .notes.filter((n) => !n.id)
    .sort((a, b) => a.t - b.t);
  T.ok(
    fg.length && fg[0].t >= 3 - 1e-6 && fg.every((n) => n.t + n.d <= 8 + 1e-6),
    'fill the gap stays inside the gap (beats 3–8)',
  );
  T.ok(
    Math.abs(fg[fg.length - 1].p - 76) <= 2,
    `fill the gap leads into the next phrase by step (${formatNotes([fg[fg.length - 1]])} → E5)`,
  );
  const run = transform('fill_the_gap', GAP, { style: 'run' }, ctx)
    .notes.filter((n) => !n.id)
    .sort((a, b) => a.t - b.t);
  T.ok(
    run.length >= 4 && run.slice(1).every((n, i) => Math.abs(n.p - run[i].p) <= 4),
    `fill the gap "run": a scale run (${run.length} notes)`,
  );
  const orn = transform('ornament', MEL, { density: 1, kind: 'turn' }, ctx).notes;
  T.ok(orn.length >= MEL.length + 6, 'ornament density 1 ornaments nearly everything');
  // drums
  let threw = '';
  try {
    transform('transpose', DRUMS, {}, { ...ctx, drums: true });
  } catch (e) {
    threw = e.message;
  }
  T.ok(/drums/.test(threw), 'pitch transforms refuse drum parts');
  const dc = transform('continue', DRUMS, { bars: 1 }, { ...ctx, drums: true }).notes;
  T.ok(
    dc.filter((n) => !n.id).every((n) => [36, 38, 42].includes(n.p)),
    'continue on drums keeps the kit pieces (no pitch moves)',
  );
  let e2 = '';
  try {
    transform('fill_the_gap', MEL, {}, ctx);
  } catch (e) {
    e2 = e.message + ' ' + e.hint;
  }
  T.ok(/gap/.test(e2), `fill the gap with no gap says so ("${e2.slice(0, 60)}")`);
}

// planning: ops, one transaction, the right author, undo
{
  const s = createStore();
  const r = s.dispatch(
    [
      { type: 'project.set', patch: { key, tempo: 92 } },
      { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
      {
        type: 'clip.add',
        track: '$k',
        ref: 'c',
        clip: {
          start: 0,
          length: 8,
          notes:
            'E5@0:0.5 D5@0.5:0.5 C5@1:0.5 A4@1.5:1.5 G4@3:0.5 A4@3.5:0.5 C5@4:1 A4@5:0.5 C5@5.5:0.5 D5@6:1.5 C5@7.5:0.5',
        },
      },
    ],
    { by: 'you', label: 'setup' },
  );
  const track = r.created.k,
    clip = r.created.c;
  const before = JSON.stringify(s.get().tracks[0].clips[0]);
  const n0 = s.history.length;
  const p1 = planTransform('transpose', s.clip(track, clip).notes, { key, track, clip, params: { steps: 1 } });
  const p2 = planTransform('transpose', s.clip(track, clip).notes, { key, track, clip, params: { steps: 1 } });
  T.ok(
    JSON.stringify(p1.ops) === JSON.stringify(p2.ops) && p1.ops.length === 1 && p1.ops[0].type === 'notes.set',
    'planTransform: a pitch move is one notes.set, the same every time',
  );
  const ex = runTransform(s, { track, clip, name: 'continue', params: { bars: 2 }, by: 'you' });
  T.ok(
    ex.ok && s.history.length === n0 + 1 && s.history[s.history.length - 1].by === 'you',
    'runTransform: one undo step, signed by you',
  );
  T.ok(
    s.clip(track, clip).length === 16,
    `continue lengthens the clip to fit (8 → ${s.clip(track, clip).length} beats) in the same step`,
  );
  s.undo();
  T.ok(JSON.stringify(s.get().tracks[0].clips[0]) === before, 'one undo puts the clip back exactly');
  const sel = s
    .clip(track, clip)
    .notes.slice(0, 4)
    .map((n) => n.id);
  const ar = runTransform(s, { track, clip, ids: sel, name: 'staccato', by: 'claude' });
  const after = s.clip(track, clip).notes;
  T.ok(
    ar.ok &&
      after.filter((n) => sel.includes(n.id)).every((n) => n.by === 'claude') &&
      after.filter((n) => !sel.includes(n.id)).every((n) => n.by === 'you'),
    'a selection is all it touches; the touched notes are signed by who ran it',
  );
  s.undo();
  const no = runTransform(s, { track, clip, name: 'legato', by: 'you' });
  T.ok(
    !no.ok && /nothing/.test(no.error) && s.history.length === n0,
    `a transform that changes nothing adds no undo step ("${no.error}")`,
  );
}

/* ================================================================== in the studio */
{
  const { page, errors, close, shot } = await open('/app/', { query: 'demo' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(400);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const run = (input, by = 'claude') =>
    page.evaluate(([i, b]) => window.overdub.tools.run('transform', i, { by: b }), [input, by]);

  const schema = await E(() => window.overdub.tools.schemas().find((t) => t.name === 'transform'));
  T.ok(
    schema && /chords_from_melody/.test(schema.description) && schema.input_schema.properties.name.enum.length === 16,
    'the transform tool is registered, with every transform in its description',
  );

  // the agent on house notes: applies, one step, signed by the agent
  const ids = await E(() => {
    const p = window.overdub.store.get();
    const k = p.tracks.find((t) => t.name === 'Keys');
    const hk = p.tracks.find((t) => t.name === 'Hook');
    return { keys: k.id, kc: k.clips[0].id, hook: hk.id, hc: hk.clips[0].id };
  });
  let h0 = await E(() => window.overdub.store.history.length);
  const a1 = await run({
    name: 'strum',
    target: { track: 'Keys', clip: ids.kc, bars: [1, 2] },
    params: { direction: 'down', ms: 25 },
    reason: 'a softer entrance',
  });
  T.ok(a1.ok && /strummed/.test(a1.summary), `agent strums the Keys, bars 1–2: "${a1.summary}"`);
  let last = await E(() => {
    const h = window.overdub.store.history;
    return { n: h.length, by: h[h.length - 1].by, label: h[h.length - 1].label, reason: h[h.length - 1].reason };
  });
  T.ok(
    last.n === h0 + 1 && last.by === 'claude' && /strum/.test(last.label) && last.reason === 'a softer entrance',
    `one undo step by claude ("${last.label}")`,
  );
  await E(() => window.overdub.tools.run('undo', {}, { by: 'claude' }));
  T.ok((await E(() => window.overdub.store.history.length)) === h0, "undo takes the agent's transforms back");

  // into another track: chords from the Hook land on Keys as a new clip
  h0 = await E(() => window.overdub.store.history.length);
  const a2 = await run({
    name: 'chords_from_melody',
    target: { track: 'Hook', clip: ids.hc },
    params: { every: 'bar' },
    into_track: 'Keys',
  });
  const kc = await E((id) => window.overdub.store.get().tracks.find((t) => t.id === id).clips.length, ids.keys);
  T.ok(
    a2.ok && a2.into?.track === 'Keys' && kc === 2 && (await E(() => window.overdub.store.history.length)) === h0 + 1,
    `chords from the Hook go to a new clip on Keys in one step (${a2.summary})`,
  );
  await E(() => window.overdub.store.undo());

  // the human's notes: a proposal, nothing changes; propose_variations takes it as is
  const mine = await E(() => {
    const s = window.overdub.store,
      p = s.get(),
      hk = p.tracks.find((t) => t.name === 'Hook');
    const r = s.dispatch(
      {
        type: 'clip.add',
        track: hk.id,
        ref: 'm',
        clip: { start: 0, length: 8, name: 'Mine', notes: 'A4@0:1 C5@1:1 E5@2:1 D5@3:1 C5@4:2 A4@6:2' },
      },
      { by: 'you', label: 'my line' },
    );
    return r.created.m;
  });
  h0 = await E(() => window.overdub.store.history.length);
  const pr = await run({ name: 'invert', target: { track: 'Hook', clip: mine } });
  T.ok(
    pr.proposal &&
      !pr.ok &&
      pr.rewrites_human_notes === 4 &&
      pr.variations.length === 2 &&
      (await E(() => window.overdub.store.history.length)) === h0,
    `on the human's notes it proposes instead (${pr.variations.map((v) => v.label).join(' / ')})`,
  );
  const vp = page.evaluate(
    (x) =>
      window.overdub.tools.run(
        'propose_variations',
        { title: x.title, target: x.target, variations: x.variations, wait_seconds: 0 },
        { by: 'claude' },
      ),
    pr,
  );
  const vr = await vp;
  T.ok(vr.status === 'pending' && !vr.error, 'the proposal goes straight into propose_variations');
  await E((id) => {
    const r = [...window.overdub.tools.requests.values()].find((q) => q.id === id);
    const card = r.cards.find((c) => !c.original);
    window.overdub.tools.answer(id, card.index);
  }, vr.id);
  last = await E(() => {
    const h = window.overdub.store.history;
    return { n: h.length, by: h[h.length - 1].by, picked: h[h.length - 1].pickedBy };
  });
  T.ok(last.n === h0 + 1 && last.by === 'claude' && last.picked === 'you', 'picking a take applies it as one step');
  await E(() => window.overdub.store.undo());
  const ap = await run({ name: 'double', target: { track: 'Hook', clip: mine }, params: { octave: 1 } });
  T.ok(
    ap.ok && ap.added === 6 && ap.changed === 0,
    "adding to the human's notes (double) just happens: nothing of theirs is rewritten",
  );
  await E(() => window.overdub.store.undo());
  const force = await run({ name: 'invert', target: { track: 'Hook', clip: mine }, mode: 'apply' });
  T.ok(
    force.ok && (await E(() => window.overdub.store.history.at(-1).by)) === 'claude',
    'mode "apply" rewrites them when asked',
  );
  await E(() => window.overdub.store.undo());
  const bad = await run({ name: 'transpose', target: { track: 'Drums' } });
  T.ok(bad.error && bad.hint, `errors come back with a hint ("${bad.error}")`);
  const bad2 = await run({ name: 'nope' });
  T.ok(bad2.error && /transforms:/.test(bad2.hint || ''), 'an unknown transform lists the real ones');
  // a param it can't read is refused with the options, not quietly swapped for the default ("down" would double UP)
  h0 = await E(() => window.overdub.store.history.length);
  const bp = await run({ name: 'double', target: { track: 'Hook', clip: mine }, params: { octave: 'down' } });
  const bo = await run({ name: 'retrograde', target: { track: 'Hook', clip: mine }, params: { mode: 'pitch' } });
  const bk = await run({ name: 'double', target: { track: 'Hook', clip: mine }, params: { octaves: -1 } });
  const okNum = await run({ name: 'double', target: { track: 'Hook', clip: mine }, params: { octave: '-1' } });
  T.ok(
    bp.error &&
      /octave: a number -2 to 2/.test(bp.hint || '') &&
      bo.error &&
      /mode: time \| pitches/.test(bo.hint || '') &&
      bk.error &&
      /no param "octaves"/.test(bk.error) &&
      okNum.ok &&
      (await E(() => window.overdub.store.history.length)) === h0 + 1,
    `a bad param is refused with what it takes ("${bp.error}"; ${bp.hint}), a number as text still works`,
  );
  await E(() => window.overdub.store.undo());
  const bb = await run({
    name: 'transpose',
    target: { track: 'Hook', clip: mine, bars: [40, 41] },
    params: { steps: 1 },
  });
  T.ok(
    bb.error && /song's, 1-based: the clip covers bars 1–2/.test(bb.hint || ''),
    `bars outside the clip say they are song bars ("${bb.hint}")`,
  );

  // the human: the piano roll's Transform menu
  await E(
    (x) => {
      window.overdub.ui.select({ track: x.hook, clip: x.mine, notes: [] });
      window.overdub.ui.show('pianoroll');
    },
    { ...ids, mine },
  );
  await page.waitForTimeout(300);
  const btn =
    (await page.$('[data-panel="pianoroll"] .pr-tool:has-text("Transform")')) ||
    (await page.$('.pr-tool:has-text("Transform")'));
  T.ok(!!btn, 'the piano roll has a Transform button');
  await btn.click();
  await page.waitForSelector('.pr-txpop');
  const rows = await page.$$eval('.pr-txpop .pr-txgo', (els) => els.map((e) => e.textContent));
  T.ok(
    rows.length === 15 && rows.includes('Chords from melody') && rows.includes('Fill the gap'),
    `the menu lists the transforms (${rows.length}; Quantize keeps its own button)`,
  );
  T.ok((await page.$$('.pr-txpop select.pr-txsel')).length >= 14, 'each with its main setting');
  await page.waitForTimeout(250); // let the popover finish fading in
  await shot('transforms-menu');
  h0 = await E(() => window.overdub.store.history.length);
  await page.selectOption('.pr-txrow:has([data-transform="transpose"]) select', { index: 1 });
  await page.click('.pr-txpop [data-transform="transpose"]');
  await page.waitForTimeout(150);
  last = await E(() => {
    const h = window.overdub.store.history;
    return { n: h.length, by: h[h.length - 1].by, label: h[h.length - 1].label };
  });
  const ps = await E(
    (m) =>
      window.overdub.store
        .findClip(m)
        .clip.notes.map((n) => n.p)
        .join(),
    mine,
  );
  T.ok(
    last.n === h0 + 1 && last.by === 'you' && /transpose/.test(last.label),
    `the menu's transform is one undo step by you ("${last.label}")`,
  );
  T.ok(ps === '72,76,79,77,76,72', `transpose +2 steps (a 3rd) from the menu: ${ps}`);
  const toast = await page.textContent('body');
  T.ok(/Moved 6 notes up 2 steps in A minor\./.test(toast), 'a toast says what changed');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyZ' : 'Control+KeyZ').catch(() => {});
  await E(() => {
    if (window.overdub.store.history.at(-1)?.label?.startsWith('transpose')) window.overdub.store.undo();
  });
  T.ok(
    (await E(
      (m) =>
        window.overdub.store
          .findClip(m)
          .clip.notes.map((n) => n.p)
          .join(),
      mine,
    )) === '69,72,76,74,72,69',
    'undo puts the line back',
  );
  // a selection only
  const sel = await E((m) => {
    const c = window.overdub.store.findClip(m).clip;
    const ids = c.notes.slice(0, 3).map((n) => n.id);
    window.overdub.ui.select({ notes: ids });
    return ids;
  }, mine);
  h0 = await E(() => window.overdub.store.history.length);
  await E(() => window.overdub.pianoroll.transform('ornament', { density: 1, kind: 'grace' }));
  const o = await E((m) => {
    const c = window.overdub.store.findClip(m).clip;
    return {
      n: c.notes.length,
      sel: window.overdub.ui.state.selection.notes.size,
      by: window.overdub.store.history.at(-1).by,
      tail: c.notes
        .filter((x) => x.t >= 3)
        .map((x) => x.by + x.p)
        .join(),
    };
  }, mine);
  T.ok(
    o.n === 9 && o.by === 'you' && o.sel === 6 && (await E(() => window.overdub.store.history.length)) === h0 + 1,
    `ornamenting 3 selected notes adds 3 graces in one step, and selects the result (${o.n} notes, ${o.sel} selected)`,
  );
  T.ok(sel.length === 3 && o.tail === 'you74,you72,you69', 'notes outside the selection are untouched');
  await E(() => window.overdub.store.undo());

  // the inspector's quick buttons
  await E((x) => {
    const c = window.overdub.store.findClip(x).clip;
    window.overdub.ui.select({
      track: window.overdub.store.findClip(x).track.id,
      clip: x,
      notes: c.notes.map((n) => n.id),
    });
    window.overdub.ui.show('inspector');
  }, mine);
  await page.waitForTimeout(250);
  const qb = await page.$$eval('[data-panel="inspector"] [data-transform]', (els) => els.map((e) => e.textContent));
  T.ok(qb.join() === 'Humanize,Legato', `the inspector has two quick transforms (${qb.join(', ')})`);
  h0 = await E(() => window.overdub.store.history.length);
  await page.click('[data-panel="inspector"] [data-transform="humanize"]');
  await page.waitForTimeout(150);
  last = await E(() => {
    const h = window.overdub.store.history;
    return { n: h.length, by: h[h.length - 1].by, label: h[h.length - 1].label };
  });
  T.ok(
    last.n === h0 + 1 && last.by === 'you' && /humanize/.test(last.label),
    `Humanize in the inspector is one step by you ("${last.label}")`,
  );

  const bad3 = errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g/.test(e));
  T.ok(!bad3.length, 'no page errors' + (bad3.length ? ': ' + bad3.slice(0, 3).join(' | ') : ''));
  await close();
}
T.done();
