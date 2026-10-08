// Checks for "Build a band around it": the arranger (app/src/core/arrange.js), its agent tool and Sketch's Band button
// (app/src/agent/arrange-tool.js). The checks here don't trust the arranger's own report: key, strong-beat clashes,
// roots, the grid and the fills are recomputed from the notes.
//   node tools/arrange-around-test.js      (screenshots: tools/.out/band-picker.png, tools/.out/band-in.png)
import { arrangeAround, planArrangement, STYLES, STYLE_IDS, harmonyKeyOf, MAX_BEATS } from '../app/src/core/arrange.js';
import { parseNotes, scalePcs, beatsPerBar } from '../app/src/core/music.js';
import { createStore } from '../app/src/core/store.js';
import { createProject } from '../app/src/core/project.js';
import { getDevice } from '../app/src/devices/registry.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { measure } from '../app/src/audio/measure.js';
import { open, tally } from './pw.js';

const T = tally('arrange-around');
const MEL4 =
  'E4@0:0.5 D4@0.5:0.5 C4@1:1 E4@2:1 G4@3:1 A4@4:1.5 G4@5.5:0.5 E4@6:1 D4@7:1 C4@8:0.5 D4@8.5:0.5 E4@9:1 G4@10:2 A4@12:1 G4@13:1 E4@14:1 D4@15:0.5 C4@15.5:0.5';
const SEEDS = [
  { label: 'a 4-bar tune in C major', notes: MEL4, key: { root: 'C', scale: 'major' }, length: 16, meter: [4, 4] },
  {
    label: 'an 8-bar tune in A minor',
    notes:
      'E5@0:0.5 D5@0.5:0.5 C5@1:0.5 A4@1.5:1.5 G4@3:0.5 A4@3.5:0.5 C5@4:1 A4@5:0.5 C5@5.5:0.5 D5@6:1.5 C5@7.5:0.5 E5@8:1 D5@9:1 C5@10:1 B4@11:1 A4@12:3 E5@16:0.5 D5@16.5:0.5 C5@17:1 A4@18:2 F5@20:1 E5@21:1 D5@22:2 C5@24:1 B4@25:1 G4@26:2 A4@28:4',
    key: { root: 'A', scale: 'minor' },
    length: 32,
    meter: [4, 4],
  },
  {
    label: 'a 2-bar hum, a little late and low',
    notes: 'G3@0.06:0.5 A3@0.5:0.5 C4@1.03:1 E3@2.05:0.5 G3@2.5:1.5 E3@4:1 D3@5:1 C3@6:2',
    key: { root: 'C', scale: 'major' },
    length: 8,
    meter: [4, 4],
  },
  {
    label: 'a waltz in 3/4, D major',
    notes: 'A4@0:1 F#4@1:1 D4@2:1 E4@3:2 G4@5:1 F#4@6:3 A4@9:1 B4@10:1 C#5@11:1 D5@12:3',
    key: { root: 'D', scale: 'major' },
    length: 15,
    meter: [3, 4],
  },
];
const pc = (p) => ((p % 12) + 12) % 12;
const ic1 = (a, b) => {
  const x = (pc(a) - pc(b) + 12) % 12;
  return x === 1 || x === 11;
};
const sounds = (n, s) => n.t <= s + 0.125 && n.t + n.d > s + 0.02;
const strongs = (meter, length) => {
  const bpb = beatsPerBar(meter),
    offs = meter[0] === 4 ? [0, 2] : [0],
    out = [];
  for (let b = 0; b < length; b += bpb) for (const o of offs) if (b + o < length) out.push(b + o);
  return out;
};
const TOMS = new Set([45, 47, 50]);

/* ================================================================== the arranger, in Node */
T.ok(STYLE_IDS.join() === 'pop,rock,lofi,house,ballad', `five styles (${STYLE_IDS.join(', ')})`);
for (const sd of SEEDS) {
  const notes = parseNotes(sd.notes);
  const keyPcs = new Set(scalePcs(harmonyKeyOf(sd.key)));
  for (const style of STYLE_IDS) {
    const opts = {
      notes,
      start: 0,
      length: sd.length,
      key: sd.key,
      meter: sd.meter,
      tempo: 100,
      style,
      parts: ['chords', 'bass', 'drums', 'pad'],
    };
    const a = arrangeAround(opts),
      b = arrangeAround(opts),
      c = arrangeAround({ ...opts, seed: 7 });
    const tag = `${style}, ${sd.label}`;
    if (
      !T.ok(
        !a.error && a.parts.chords?.length && a.parts.bass?.length && a.parts.drums?.length && a.parts.pad?.length,
        `${tag}: chords, bass, drums and pad (${a.error || a.progression.join(' – ')})`,
      )
    )
      continue;
    T.ok(JSON.stringify(a.parts) === JSON.stringify(b.parts), `${tag}: the same seed gives the same band`);
    T.ok(JSON.stringify(a.parts) !== JSON.stringify(c.parts), `${tag}: another seed gives another take`);
    const pitched = ['chords', 'bass', 'pad'].flatMap((k) => a.parts[k].map((n) => ({ ...n, part: k })));
    const out = pitched.filter((n) => !keyPcs.has(pc(n.p)));
    T.ok(
      !out.length,
      `${tag}: every added note is in ${sd.key.root} ${sd.key.scale}${
        out.length
          ? ` (not: ${out
              .slice(0, 3)
              .map((n) => n.part + ' ' + n.p)
              .join(', ')})`
          : ''
      }`,
    );
    const clashes = [];
    for (const s of strongs(sd.meter, sd.length))
      for (const m of notes.filter((n) => sounds(n, s)))
        for (const o of pitched.filter((n) => sounds(n, s)))
          if (ic1(m.p, o.p)) clashes.push(`${o.part} ${o.p} vs ${m.p} @${s}`);
    T.ok(
      !clashes.length,
      `${tag}: nothing a semitone from the tune on a strong beat${clashes.length ? ` (${clashes.slice(0, 3).join(', ')})` : ''}`,
    );
    T.ok(a.check.ok, `${tag}: and the arranger's own check agrees`);
    const lap = ['chords', 'bass', 'pad'].flatMap((k) =>
      a.parts[k]
        .filter((n, i, xs) => xs.some((m, j) => j !== i && m.p === n.p && m.t > n.t + 1e-6 && m.t < n.t + n.d - 1e-6))
        .map((n) => `${k} ${n.p}@${n.t}`),
    );
    T.ok(
      !lap.length,
      `${tag}: no note is struck again while it still rings${lap.length ? ` (${lap.slice(0, 3).join(', ')})` : ''}`,
    );
    // the bass shares roots with the chords: at every change and downbeat, the bass's first note is the chord's root,
    // and the chord and pad notes in each segment are that chord's tones
    const bpb = beatsPerBar(sd.meter);
    const bad = [];
    for (const sg of a.segments) {
      const pts = [
        sg.a,
        ...Array.from({ length: Math.ceil(sd.length / bpb) }, (_, i) => i * bpb).filter((x) => x > sg.a && x < sg.b),
      ];
      for (const t of pts) {
        const f = a.parts.bass.find((n) => n.t >= t - 1e-6 && n.t < t + 1);
        if (!f || pc(f.p) !== sg.root) bad.push(`${sg.name}@${t}`);
      }
      const tones = new Set(sg.pcs);
      for (const n of [...a.parts.chords, ...a.parts.pad])
        if (n.t >= sg.a - 1e-6 && n.t < sg.b - 1e-6 && !tones.has(pc(n.p))) bad.push(`${n.p} in ${sg.name}`);
    }
    T.ok(
      !bad.length && a.segments.every((sg) => sg.bass === sg.root),
      `${tag}: the bass shares each chord's root on the changes and downbeats${bad.length ? ` (${bad.slice(0, 3).join(', ')})` : ''}`,
    );
    // the groove: on the style's grid (16ths, swung where the style swings), toms only in every 4th bar's fill
    const sw = (STYLES[style].swing || 0) * 0.25;
    const off = a.parts.drums.filter((n) => {
      const q = n.t * 4;
      if (Math.abs(q - Math.round(q)) < 1e-3) return sw > 0 && Math.round(q) % 2 === 1;
      const q2 = (n.t - sw) * 4;
      return !(Math.abs(q2 - Math.round(q2)) < 1e-3 && Math.round(q2) % 2 === 1);
    });
    T.ok(
      !off.length,
      `${tag}: every drum hit on the grid${sw ? ' (swung 16ths)' : ''}${
        off.length
          ? ` (off: ${off
              .slice(0, 3)
              .map((n) => n.t)
              .join(', ')})`
          : ''
      }`,
    );
    const bars = Math.ceil(sd.length / bpb);
    const fillBars = [
      ...new Set(
        a.parts.drums
          .filter(
            (n) =>
              TOMS.has(n.p) ||
              (n.p === 38 &&
                a.parts.drums.filter((x) => x.p === 38 && Math.floor(x.t / bpb) === Math.floor(n.t / bpb)).length >
                  (style === 'lofi' ? 5 : 3)),
          )
          .map((n) => Math.floor(n.t / bpb) + 1),
      ),
    ];
    const want = Array.from({ length: bars }, (_, i) => i + 1).filter((b) => b % 4 === 0);
    const tomBars = [...new Set(a.parts.drums.filter((n) => TOMS.has(n.p)).map((n) => Math.floor(n.t / bpb) + 1))];
    T.ok(
      JSON.stringify(a.fills) === JSON.stringify(want) &&
        tomBars.every((b) => want.includes(b)) &&
        want.every((b) => fillBars.includes(b) || style === 'house' || style === 'lofi'),
      `${tag}: a fill in bar ${want.join(', ') || '(none under 4 bars)'} and nowhere else`,
    );
    if (style === 'house' || style === 'lofi') {
      for (const fb of want) {
        const n = a.parts.drums.filter(
          (x) => Math.floor(x.t / bpb) + 1 === fb && x.t % bpb >= bpb - 2 && (x.p === 38 || x.p === 39),
        ).length;
        const n0 = a.parts.drums.filter(
          (x) => Math.floor(x.t / bpb) === 0 && x.t % bpb >= bpb - 2 && (x.p === 38 || x.p === 39),
        ).length;
        T.ok(n > n0, `${tag}: bar ${fb}'s last beats roll (${n} snare/clap hits vs ${n0})`);
      }
    }
    if (want.length > 1 || (want.length && bars > 4)) {
      const crash = a.parts.drums.some((n) => n.p === 49 && Math.abs(n.t - 4 * bpb) < 1e-6);
      T.ok(STYLES[style].drums.crash === 'none' || crash, `${tag}: a crash after the fill`);
    }
    // the bass rides the kick where the style says so
    if (STYLES[style].bass.mode === 'kick' && sd.meter[0] === 4) {
      const kicks = a.parts.drums.filter((n) => n.p === 36 && n.v >= 0.5).map((n) => n.t);
      const hit = kicks.filter((t) => a.parts.bass.some((n) => Math.abs(n.t - t) < 1e-6)).length;
      T.ok(hit / kicks.length >= 0.9, `${tag}: the bass lands with the kick (${hit}/${kicks.length})`);
    }
  }
}
// a chord seed and a beat seed
{
  const chords = parseNotes('C4@0:4 E4@0:4 G4@0:4 A3@4:4 C4@4:4 E4@4:4 F3@8:4 A3@8:4 C4@8:4 G3@12:4 B3@12:4 D4@12:4');
  const r = arrangeAround({
    notes: chords,
    start: 0,
    length: 16,
    key: { root: 'C', scale: 'major' },
    style: 'pop',
    parts: ['chords', 'bass', 'drums', 'pad'],
  });
  T.ok(
    r.kind === 'chords' && !r.parts.chords && r.skipped.some((s) => s.part === 'chords') && r.parts.bass && r.parts.pad,
    'a chord seed: no second chord part; bass, drums and pad follow it',
  );
  T.ok(
    r.progression.join() === 'C,Am,F,G' &&
      r.segments
        .filter((s) => s.change)
        .map((s) => s.root)
        .join() === '0,9,5,7',
    `it reads the chords (${r.progression.join(' – ')})`,
  );
  // chords are spelled for the key: Ab, Eb and Bb in C minor, never G#, D# or A#
  const sharpOrFlat = (key) =>
    STYLE_IDS.map((style) =>
      arrangeAround({
        notes: parseNotes('36@0:0.25 38@1:0.25 36@2:0.25 38@3:0.25'),
        start: 0,
        length: 16,
        key,
        style,
        drums: true,
      }),
    );
  const cm = sharpOrFlat({ root: 'C', scale: 'minor' });
  const cmNames = cm.flatMap((x) => x.segments.map((sg) => sg.name));
  T.ok(
    cmNames.some((n) => /^(Ab|Eb|Bb)/.test(n)) &&
      !cmNames.some((n) => /#/.test(n)) &&
      cm.every((x) => !/[A-G]#/.test(x.summary)) &&
      /Chords Cm – Ab/.test(cm.find((x) => x.style === 'pop').summary),
    `C minor is spelled with flats in every style's summary ("${cm.find((x) => x.style === 'pop').summary.match(/Chords [^;.]*/)?.[0]}")`,
  );
  const em = sharpOrFlat({ root: 'E', scale: 'major' });
  T.ok(
    em.every((x) => !/[A-G]b/.test(x.progression.join(' '))) && em.some((x) => /#/.test(x.progression.join(' '))),
    `E major is spelled with sharps (${em.find((x) => x.style === 'pop').progression.join(' – ')})`,
  );
  const beat = parseNotes(
    '36@0:0.25 42@0:0.25 42@0.5:0.25 38@1:0.25 36@1.75:0.25 36@2:0.25 42@2.5:0.25 38@3:0.25 36@4:0.25 38@5:0.25 36@5.75:0.25 36@6:0.25 38@7:0.25',
  );
  const d = arrangeAround({
    notes: beat,
    start: 0,
    length: 8,
    key: { root: 'E', scale: 'minor' },
    style: 'house',
    drums: true,
  });
  const kicks = beat.filter((n) => n.p === 36).map((n) => n.t);
  T.ok(
    d.kind === 'drums' && !d.parts.drums && d.parts.chords && d.parts.bass,
    'a beat seed: no second drum part; chords and bass around it',
  );
  const bt = d.parts.bass.map((n) => n.t);
  const offb = bt.filter((t) => Math.abs((t % 1) - 0.5) < 0.1).length;
  T.ok(
    offb / bt.length >= 0.6 &&
      d.segments
        .filter((s) => s.change)
        .every((s) => d.parts.bass.some((n) => Math.abs(n.t - s.a) < 1e-6 && n.p % 12 === s.root)),
    `house bass on the offbeats around the beat, roots on the changes (${offb}/${bt.length}: ${bt.slice(0, 6).join(' ')})`,
  );
  const dp = arrangeAround({
    notes: beat,
    start: 0,
    length: 8,
    key: { root: 'E', scale: 'minor' },
    style: 'pop',
    drums: true,
  });
  T.ok(
    kicks.every((t) => dp.parts.bass.some((n) => Math.abs(n.t - t) < 1e-6)),
    `pop bass locks to the seed's own kick (${kicks.join(' ')})`,
  );
}

// into ops: one dispatch adds the band, one undo takes all of it back; the seed is untouched; the seed leads in a render
{
  const p = createProject();
  p.tempo = 100;
  p.key = { root: 'C', scale: 'major' };
  p.tracks = [];
  const st = createStore(p, { getDevice });
  st.dispatch(
    [
      {
        type: 'track.add',
        ref: 't',
        track: { name: 'Hum', kind: 'instrument', instrument: { device: 'core.pluck', params: {} } },
      },
      {
        type: 'clip.add',
        track: '$t',
        ref: 'c',
        clip: { kind: 'notes', start: 0, length: 16, name: 'Hummed idea', notes: MEL4 },
      },
    ],
    { by: 'you' },
  );
  const before = JSON.stringify(st.get().tracks);
  const t = st.get().tracks[0];
  for (const style of STYLE_IDS) {
    const plan = planArrangement(st.get(), {
      track: t.id,
      clip: t.clips[0].id,
      style,
      parts: ['chords', 'bass', 'drums', 'pad'],
    });
    const h0 = st.history.length;
    const r = st.dispatch(plan.ops, { by: 'overdub', label: 'band' });
    const pr = st.get();
    const added = pr.tracks.slice(1);
    T.ok(
      r.ok &&
        st.history.length === h0 + 1 &&
        added.length === 4 &&
        added.every(
          (x) =>
            x.by === 'overdub' &&
            x.clips.length === 1 &&
            x.clips[0].by === 'overdub' &&
            x.clips[0].notes.every((n) => n.by === 'overdub'),
        ),
      `${style}: one step adds 4 tracks, signed overdub (${added.map((x) => `${x.name}/${x.instrument.device}`).join(', ')})`,
    );
    T.ok(
      new Set(pr.tracks.map((x) => x.color)).size === pr.tracks.length &&
        new Set(pr.tracks.map((x) => x.name)).size === pr.tracks.length,
      `${style}: each new track has its own name and colour`,
    );
    T.ok(
      JSON.stringify(pr.tracks[0]) === JSON.stringify(JSON.parse(before)[0]),
      `${style}: the seed track and its notes are untouched`,
    );
    if (style === 'pop' || style === 'lofi' || style === 'ballad') {
      const L = Object.fromEntries(
        pr.tracks.map((x) => [x.name, measure(renderSong(pr, { tracks: [x.id], from: 0, to: 16, tail: 0.3 })).lufs]),
      );
      const seedL = L.Hum,
        worst = Math.max(
          ...Object.entries(L)
            .filter(([k]) => k !== 'Hum')
            .map(([, v]) => v),
        );
      T.ok(
        seedL > worst + 1,
        `${style}: the seed leads in the canonical render (seed ${seedL.toFixed(1)} LUFS, loudest part ${worst.toFixed(1)})`,
      );
    }
    st.undo();
    T.ok(JSON.stringify(st.get().tracks) === before, `${style}: one undo takes the whole band back`);
  }
  T.ok(
    planArrangement(st.get(), { track: t.id, clip: t.clips[0].id, style: 'polka' }).error,
    'an unknown style is refused with the list',
  );
}

// a seed shorter than a bar gets a band that short: nothing written past the clip's end (it would be silent, and
// counted in the toast); a clip longer than MAX_BEATS is refused at once, not worked on for minutes
for (const start of [0, 1.5]) {
  const r = arrangeAround({
    start,
    length: 3,
    style: 'pop',
    parts: ['chords', 'bass', 'drums'],
    notes: parseNotes('C4@0:1 E4@1:1 G4@2:1'),
  });
  const past = Object.entries(r.parts || {}).flatMap(([k, ns]) =>
    ns.filter((n) => n.t >= 3 - 1e-9).map((n) => `${k}@${n.t}`),
  );
  T.ok(
    !r.error && r.parts.drums?.length && !past.length,
    `a 3-beat seed at beat ${start}: every part ends inside it (${past.join(' ') || 'nothing past beat 3'})`,
  );
}
{
  const t0 = performance.now();
  const r = arrangeAround({ length: 65536, style: 'pop', notes: parseNotes('C4@0:1 E4@1:1') });
  const ms = performance.now() - t0;
  T.ok(
    MAX_BEATS === 1024 && r.error && /16,384 bars long; a band is built over up to 256 bars/.test(r.error) && ms < 50,
    `a 16,384-bar clip is refused in ${ms.toFixed(1)} ms: "${r.error}"`,
  );
}

/* ================================================================== in the studio */
{
  const { page, errors, close, shot } = await open('/app/', { query: 'new' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(300);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const schema = await E(() => window.overdub.tools.schemas().find((t) => t.name === 'arrange_around'));
  T.ok(
    schema && schema.input_schema.properties.style.enum.length === 5 && /never touches/.test(schema.description),
    'arrange_around is registered with its five styles',
  );

  // a kept hum, the way Sketch keeps one
  const seed = await E((mel) => {
    const app = window.overdub;
    app.store.dispatch(
      { type: 'project.set', patch: { tempo: 100, key: { root: 'C', scale: 'major' } } },
      { by: 'you' },
    );
    const notes = mel.split(' ').map((tok) => {
      const [pp, rest] = tok.split('@');
      const [t, d] = rest.split(':');
      return { p: pp, t: +t, d: +d, v: 0.8 };
    });
    const ph = app.input.capture.add({
      src: 'hum',
      kind: 'notes',
      notes: notes.map((n) => ({ ...n, p: { C4: 60, D4: 62, E4: 64, G4: 67, A4: 69 }[n.p] })),
      tempo: 100,
    });
    const k = app.input.capture.keep(ph.id, { newTrack: { device: 'core.pluck' } });
    return { ...k, n: app.store.findClip(k.clip).clip.notes.length };
  }, MEL4);
  T.ok(seed.ok && seed.n === 18, `a hum kept as a clip (${seed.n} notes)`);
  await E(() => window.overdub.ui.show('sketch'));
  await page.waitForSelector('.sk-idea .band-btn', { timeout: 5000 }).catch(() => {});
  const btn = await page.$('.sk-idea .band-btn');
  T.ok(!!btn, 'the kept take has a Band button in Sketch');
  const h0 = await E(() => window.overdub.store.history.length);
  const tracks0 = await E(() => JSON.stringify(window.overdub.store.get().tracks));
  await page.waitForTimeout(300); // the Takes list repaints once after a keep
  await page.click('.sk-idea .band-btn');
  await page.waitForSelector('.band-pop', { timeout: 3000 }).catch(() => {});
  const chips = await page.$$eval('.band-pop [data-style]', (els) => els.map((e) => e.textContent));
  T.ok(chips.join() === 'Pop,Rock,Lo-fi,House,Ballad', `the picker offers the styles (${chips.join(', ')})`);
  await page.click('.band-pop [data-style="lofi"]');
  await page.waitForTimeout(200);
  await shot('band-picker');
  await page.click('.band-pop .band-go');
  await page.waitForFunction((n) => window.overdub.store.history.length > n, h0, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(200);
  const after = await E(() => {
    const s = window.overdub.store,
      h = s.history.at(-1);
    return {
      n: s.history.length,
      by: h.by,
      label: h.label,
      tracks: s
        .get()
        .tracks.map((t) => ({ id: t.id, name: t.name, by: t.by, gain: t.gain, dev: t.instrument?.device })),
    };
  });
  T.ok(
    after.n === h0 + 1 &&
      after.by === 'overdub' &&
      after.tracks.length === 4 &&
      after.tracks.slice(1).every((t) => t.by === 'overdub'),
    `Build the band: one undo step by the house ("${after.label}": ${after.tracks
      .slice(1)
      .map((t) => `${t.name} ${t.gain} dB`)
      .join(', ')})`,
  );
  const toast = await page.textContent('.ew-toasts');
  T.ok(
    /Band in: chords, bass and drums around your 18 notes\. One undo takes it back\./.test(toast || ''),
    `the toast, in the house voice ("${(toast || '').replace(/Undo$/, '').trim()}")`,
  );
  await shot('band-in');
  // levels, measured the way an agent would: engine.render per stem
  const lv = await E(async () => {
    const app = window.overdub,
      { measure } = await import('/app/src/audio/measure.js');
    const out = {};
    for (const t of app.store.get().tracks)
      out[t.name] = measure(await app.engine.render({ from: 0, to: 16, tracks: [t.id], tail: 0.3 })).lufs;
    return out;
  });
  // (a kept hum's new track is Melody: core/sounds.js newPartFor, docs/INSTRUMENTS-UX.md 1.2)
  const seedL = lv.Melody,
    rest = Object.entries(lv).filter(([k]) => k !== 'Melody');
  T.ok(
    rest.every(([, v]) => v < seedL - 1),
    `the seed leads by loudness in the render (Melody ${seedL.toFixed(1)} LUFS; ${rest.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')})`,
  );
  T.ok(
    rest.every(([, v]) => v > seedL - 14),
    'and the band is there to be heard (no part more than 14 LU under it)',
  );
  await E(() => window.overdub.store.undo());
  T.ok(
    (await E(() => JSON.stringify(window.overdub.store.get().tracks))) === tracks0,
    'one undo takes the whole band back',
  );

  // Shift+B on the selected clip opens the same picker; Escape closes it
  await E((s) => window.overdub.ui.select({ track: s.track, clip: s.clip, notes: [] }), seed);
  await page.mouse.click(700, 300).catch(() => {});
  await E(() => window.overdub.band.close());
  await E((s) => window.overdub.ui.select({ track: s.track, clip: s.clip, notes: [] }), seed);
  await page.keyboard.press('Shift+KeyB');
  const opened = await page
    .waitForSelector('.band-pop', { timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  T.ok(opened, 'Shift+B opens the picker on the selected clip');
  await page.keyboard.press('Escape');
  T.ok(!(await page.$('.band-pop')), 'Escape closes it');

  // the agent tool: applies as one step by the agent, says the person's notes are untouched, undoes cleanly
  const a = await E(
    (s) =>
      window.overdub.tools.run(
        'arrange_around',
        {
          target: { track: 'Melody', clip: s.clip },
          style: 'house',
          parts: ['chords', 'bass', 'drums', 'pad'],
          reason: 'a band to sing over',
        },
        { by: 'claude' },
      ),
    seed,
  );
  const last = await E(() => {
    const h = window.overdub.store.history.at(-1);
    return {
      by: h.by,
      reason: h.reason,
      tracks: window.overdub.store.get().tracks.length,
      signed: window.overdub.store
        .get()
        .tracks.slice(1)
        .every((t) => t.by === 'claude'),
    };
  });
  T.ok(
    a.ok && last.by === 'claude' && last.tracks === 5 && last.signed && last.reason === 'a band to sing over',
    `the agent's arrange_around: one step by claude (${a.summary})`,
  );
  T.ok(
    a.touches_human_notes === false &&
      /untouched/.test(a.note) &&
      a.checks.in_key &&
      a.checks.strong_beat_rubs === 0 &&
      a.checks.bass_on_roots &&
      a.checks.drums_on_grid,
    `it says what it left alone ("${a.note}") and its checks pass`,
  );
  T.ok(
    a.measured && a.tracks.every((t) => t.lu_vs_seed < 0),
    `its faders are measured: every part under the seed (${a.tracks.map((t) => `${t.part} ${t.lu_vs_seed} LU`).join(', ')})`,
  );
  const u = await E(() => window.overdub.tools.run('undo', {}, { by: 'claude' }));
  T.ok(u.ok && (await E(() => window.overdub.store.get().tracks.length)) === 1, "undo takes the agent's band back");
  const pr = await E(
    (s) =>
      window.overdub.tools.run(
        'arrange_around',
        { target: { track: s.track, clip: s.clip }, style: 'pop', mode: 'propose' },
        { by: 'claude' },
      ),
    seed,
  );
  T.ok(
    pr.proposal &&
      pr.variations.length === 2 &&
      pr.variations.map((v) => v.label).join() === 'pop band,ballad band' &&
      /untouched/.test(pr.hint) &&
      (await E(() => window.overdub.store.get().tracks.length)) === 1,
    `mode "propose": two styles as takes, nothing changed (${pr.variations?.map((v) => v.label).join(' / ')})`,
  );
  const vr = await E(
    (x) =>
      window.overdub.tools.run(
        'propose_variations',
        { title: x.title, target: x.target, variations: x.variations, wait_seconds: 0 },
        { by: 'claude' },
      ),
    pr,
  );
  T.ok(vr.status === 'pending' && !vr.error, 'propose_variations takes them as they are');
  await E((id) => window.overdub.tools.answer(id, 'original'), vr.id).catch(() => {});
  const bad = await E(() =>
    window.overdub.tools.run('arrange_around', { target: { track: 'Nope' } }, { by: 'claude' }),
  );
  T.ok(bad.error && bad.hint, `errors come back with a hint ("${bad.error}")`);

  const pe = errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g/.test(e));
  T.ok(!pe.length, 'no page errors' + (pe.length ? ': ' + pe.slice(0, 3).join(' | ') : ''));
  await close();
}
T.done();
