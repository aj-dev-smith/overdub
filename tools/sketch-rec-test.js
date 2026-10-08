// Sketch as the record strip and the beat ruler (docs/research/RECORDING-UX.md 3.6 and 3.13, wave B3: app/src/ui/sketch.js).
// In the studio (Night Shift, 92 bpm), with real key events against the running song:
//   1. the record strip in every mode: Record (Stop while it records), the track it records onto, Each pass: Layer or
//      New take, the count-in and the click; With song and Tap's Done are gone; Record from the strip counts in and
//      Cancel takes it back.
//   2. tapping along with the playing demo: the canvas follows the song (its bars, from the bar it started at), each
//      tap is a tick at the beat its key went down and the cell it snapped to, drawn on the canvas where they fell.
//   3. the pass readout: after the pass, "Pass 1: 3 hits, N ms late on average", its numbers from the taps' own beats.
//   4. a looped take: pass 1 dimmed under pass 2 on the ruler, a line after each pass.
//   5. Shift+R puts a take played along with the song at the bar it was played, and the card says "in the song: Keys,
//      bar 5"; a card's Put it in the song does the same for an older take.
//   6. Record's input picker writes the record track's Input (track.input), the one the recorder opens: one picker.
//   7. on a phone, Record is in the footer pinned to the bottom of the sheet, and reachable.
//   8. the sheet's layout at 1440 × 900 and 1280 × 720 (docs/FRESH-EYES-2.md: labels drawn over each other): the
//      canvas keeps its minimum, the caption, the pass line and the canvas are separate lines, the drum rows are tall
//      enough for one label each, the hum's spiral is a spiral, the docked typing strip shows all its keys, the
//      footer covers none of it, Record stays on top of a toast, and a two-digit take number fits beside its byline.
//   9. leaving Play it turns musical typing off; the first-minute tour gives back the loop (and typing) it set when it
//      ends.
//  10. a phone: Each pass, the count-in and the click are a row of 40 px targets under the canvas; the beat's lamps sit over the pads
//      and follow the song; the keyboard starts in the playing track's register (Bass, not A4) with Record right above
//      it; the tour's card is one line while a take records, and never says "press R".
//  14. fresh eyes 5, a phone: Sketch opens with the ways in and "Allow the mic and hum" in view; the pinned row stays one
//      row while a take records ("Recording onto Drums, pass 1." over the pads) and after a hum (the dial, what the hum
//      became and Keep on screen, nothing off the edge); Keep goes where Record's picker says (one picker); a 3-bar hum
//      over a 2-bar beat is still offered "Make it 8 bars".
//  15. the hum dial and musical typing spell the song's key: C minor's Eb, Ab and Bb, never D# G# A#.
//  16. capture-timing (AJ, 2026-10-05: "it's just HARD to do in time"), each on a blank song in the simple view, played
//      by a sloppy human (tools/sloppy.js): Tap a beat with the beat where the eyes are (the band: lamps in the head,
//      lit on the beat, the count-in counting up with them, 1 2 3 4, the beat waited out dimmer), R late in a bar still
//      counting a whole bar and starting at the 2-bar loop's top, two passes
//      tapped late, early and rushed, a miss in the first replaced by the second, the take and the Drums it was made
//      for one undo step, and Tight / Loose / As played after; Tap it with the click off: no count, taps in their own
//      time and drifting, the song's tempo and beat built from them, one undo step; Hum it with the click off: a sloppy
//      hum (the fake mic) comes back with the rhythm sung, at the tempo hummed, on a new Melody; Hum it with the click:
//      a bar of count-in, the hum on a new Melody, nothing sung in the count stacked on beat 1. 16e: a beat played 130
//      to 175 ms behind the click lands on its beats (the take's lean out) and says so; As played puts the lean back.
//  0, 12, 12b, 13. fresh eyes 5: the keys snap by default, and the line over them says so ("Snapping to 1/16, in C
//      minor"): its words for every state (Node), docked in Play it and in view while R records; each part a click that
//      turns its helper off ("Your timing", "every note") and on, announced and kept across a reload, floating too, with
//      no key ("in C major, no key set"), the grid as the arranger names it; on a phone, the same line over the touch
//      keys, its parts 40 px to a finger, in view while a take records.
//
//   node tools/sketch-rec-test.js
import { open, tally, OUTDIR } from './pw.js';
import path from 'node:path';
import { perform, sloppyHum, wav } from './sloppy.js';

const t = tally('sketch-rec');
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const lineOf = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

/* ---- 0. the line's words (input/qwerty.js snapWords): what the grid and Scale lock do to what the keys play, in every
   state (fresh eyes 5: notes moved and nothing on screen said they would) */
{
  const qm = await import('../app/src/input/qwerty.js');
  const sw = typeof qm.snapWords === 'function' ? qm.snapWords : null;
  const line = (o) => {
    if (!sw) return null;
    const w = sw(o);
    return `${w.grid.text}, ${w.key.text}${w.key.aside ? `, ${w.key.aside}` : ''}`;
  };
  const cm = { root: 'C', scale: 'minor' };
  const states = [
    [{ key: cm }, 'Snapping to 1/16, in C minor'],
    [{ key: cm, quantize: false }, 'Your timing, in C minor'],
    [{ key: cm, scaleLock: false }, 'Snapping to 1/16, every note'],
    [{ key: cm, quantize: false, scaleLock: false }, 'Your timing, every note'],
    [{ key: null }, 'Snapping to 1/16, in C major, no key set'],
    [{ key: null, scaleLock: false }, 'Snapping to 1/16, every note'],
    [{ key: cm, grid: 0.5 }, 'Snapping to 1/8, in C minor'],
    [{ key: cm, grid: 1 / 3 }, 'Snapping to 1/8T, in C minor'],
    [{ key: { root: 'Eb', scale: 'major' }, grid: 1 / 6 }, 'Snapping to 1/16T, in Eb major'],
  ];
  const got = states.map(([o]) => line(o));
  t.ok(
    states.every(([, want], i) => got[i] === want),
    `the line's words for each state: ${got.map((x) => `"${x}"`).join(', ')}`,
  );
  const w = sw?.({ key: cm }),
    off = sw?.({ key: cm, quantize: false, scaleLock: false }),
    tw = sw?.({ key: cm, touch: true }),
    nk = sw?.({ key: null });
  t.ok(
    !!w &&
      w.grid.on &&
      w.key.on &&
      !off.grid.on &&
      !off.key.on &&
      w.grid.title === 'On the grid: what you play lands on the 1/16 grid. Click to keep your own timing.' &&
      w.key.title === 'Scale lock: the keys play only C minor, so no note sounds wrong. Click to play every note.' &&
      /^Tap to keep/.test(tw.grid.title.split('. ').pop()) &&
      /no key, so the keys play C major/.test(nk.key.title),
    `each part says what it does and what a click does, "Tap" on a touch screen ("${w?.grid.title}" | "${w?.key.title}" | "${nk?.key.title}")`,
  );
}

const { page, browser, url, errors, close, shot } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await page.evaluate(async () => {
    const app = window.overdub;
    await app.engine.start();
    app.ui.setOpen?.('bottom', true);
    app.ui.show('sketch');
  });
  await page.waitForSelector('.sk-strip', { timeout: 8000 });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const ids = await E(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
  const tempo = await E(() => window.overdub.store.get().tempo);
  const spbMs = 60000 / tempo;
  // where the page heard each key go down (the audible beat at the event's timeStamp)
  await E(() => {
    window.__kd = [];
    window.addEventListener(
      'keydown',
      (e) => {
        const en = window.overdub.engine;
        window.__kd.push({ code: e.code, beat: en.playing ? en.beatAt(e.timeStamp) : null });
      },
      true,
    );
  });
  const beatNow = () => E(() => window.overdub.engine.beat);
  async function until(b) {
    for (let i = 0; i < 2000; i++) {
      const x = await beatNow();
      if (x >= b - 0.015) return x;
      await page.waitForTimeout(Math.max(1, Math.min(250, (b - x) * spbMs - 25)));
    }
    return null;
  }
  async function tapKey(code, ms = 60) {
    await page.keyboard.down(code);
    await page.waitForTimeout(ms);
    await page.keyboard.up(code);
  }
  const state = () => E(() => window.overdub.input.recorder.state);
  async function idle() {
    for (let i = 0; i < 100 && (await state()) !== 'idle'; i++) await page.waitForTimeout(50);
    await page.waitForTimeout(80);
  }
  const lastToast = () => E(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');

  /* ---- 1. the strip, in every mode */
  await E((k) => window.overdub.ui.select({ track: k }), ids.Keys);
  const modes = {};
  for (const m of ['hum', 'tap', 'play', 'rec']) {
    await E((mm) => window.overdub.input.emit('sketch:mode', mm), m);
    await page.waitForTimeout(120);
    modes[m] = await E(() => {
      const s = document.querySelector('.sk-strip');
      return {
        inStage: !!s && !!s.closest('.sk-stage'),
        rec: s?.querySelector('.sk-recbtn .sk-recbtn-l')?.textContent,
        onto: [...(s?.querySelectorAll('.sk-target option') || [])].map((o) => o.textContent),
        target: s?.querySelector('.sk-target')?.selectedOptions[0]?.textContent,
        each: [...(s?.querySelectorAll('.sk-each button') || [])]
          .map((b) => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : ''))
          .join(' '),
        count: s?.querySelector('.sk-countin')?.textContent,
        click: s?.querySelector('.sk-click')?.textContent,
        chips: [...document.querySelectorAll('.sk-opts .sk-chip')].map((c) => c.textContent),
        buttons: [...document.querySelectorAll('.sk-foot button')].map((b) => b.textContent.trim()),
      };
    });
  }
  t.ok(
    Object.values(modes).every(
      (x) => x.inStage && x.rec === 'Record' && /^Count-in: 1 bar$/.test(x.count) && x.click === 'Click',
    ),
    `every mode ends in the record strip: Record, Onto, Each pass, the count-in, the click (${Object.entries(modes)
      .map(([k, v]) => `${k}: ${v.rec}, ${v.count}`)
      .join('; ')})`,
  );
  // (Onto: "A new track" first; a track whose take would stack over the one there reads "Keys, a new take")
  t.ok(
    modes.tap.target === 'Drums' &&
      modes.tap.each === 'Layer* New take' &&
      /^Keys(, a new take)?$/.test(modes.play.target) &&
      modes.play.each === 'Layer New take*',
    `the strip names the track and how each pass records: Tap onto ${modes.tap.target} (${modes.tap.each}), Play onto ${modes.play.target} (${modes.play.each})`,
  );
  t.ok(
    ['hum', 'tap', 'play'].every((m) => modes[m].onto[0] === 'A new track'),
    `Onto offers "A new track" first in every way in (${['hum', 'tap', 'play'].map((m) => `${m}: ${modes[m].onto.join(', ')}`).join('; ')})`,
  );
  t.ok(
    !modes.play.onto.includes('Drums') && !modes.tap.onto.includes('Keys'),
    `keys never list the drums, pads never list the keys (Play: ${modes.play.onto.join(', ')}; Tap: ${modes.tap.onto.join(', ')})`,
  );
  t.ok(
    !modes.hum.chips.some((c) => /With song/.test(c)) && !modes.tap.buttons.includes('Done'),
    `With song and Tap's Done are gone (hum chips: ${modes.hum.chips.join(', ')}; tap foot: ${modes.tap.buttons.join(', ')})`,
  );
  // the strip's Each pass sets the recorder's mode for that track
  await E(() => window.overdub.input.emit('sketch:mode', 'play'));
  await page.waitForTimeout(80);
  await page.click('.sk-each button:first-child');
  const lay = await E((k) => window.overdub.input.recorder.modeFor(k), ids.Keys);
  await page.click('.sk-each button:last-child');
  const tk = await E((k) => window.overdub.input.recorder.modeFor(k), ids.Keys);
  t.ok(
    lay === 'layer' && tk === 'take',
    `Each pass: Layer and New take set the recorder's mode for Keys (${lay}, then ${tk})`,
  );
  // the count-in steps 1 → 2 → none → 1, and the recorder hears it
  const counts = [];
  for (let i = 0; i < 3; i++) {
    await page.click('.sk-countin');
    counts.push(
      await E(() => `${document.querySelector('.sk-countin').textContent}=${window.overdub.input.recorder.countIn}`),
    );
  }
  t.ok(
    counts.join(', ') === 'Count-in: 2 bars=2, Count-in: none=0, Count-in: 1 bar=1',
    `the count-in toggle steps through 2 bars, none and 1 bar (${counts.join(', ')})`,
  );
  const clk0 = await E(() => !!window.overdub.engine.metronome);
  await page.click('.sk-click');
  const clk1 = await E(() => ({
    on: !!window.overdub.engine.metronome,
    pressed: document.querySelector('.sk-click').getAttribute('aria-pressed'),
  }));
  await page.click('.sk-click');
  t.ok(
    clk1.on === !clk0 && clk1.pressed === String(clk1.on),
    `Click turns the metronome ${clk1.on ? 'on' : 'off'} and back`,
  );
  // Record from the strip: the count-in, then Cancel takes it back (nothing recorded)
  const h0 = await E(() => window.overdub.store.history.length);
  await E((k) => {
    window.overdub.ui.select({ track: k });
    window.overdub.engine.seek(16);
  }, ids.Keys);
  await page.click('.sk-recbtn');
  await page.waitForTimeout(150);
  const cnt = await E(() => ({
    s: window.overdub.input.recorder.state,
    label: document.querySelector('.sk-recbtn-l').textContent,
    note: document.querySelector('.sk-recnote').textContent,
    r: window.overdub.sketch.ruler(),
  }));
  await shot('sketch-rec-countin');
  await page.click('.sk-recbtn');
  await idle();
  const h1 = await E(() => window.overdub.store.history.length);
  t.ok(
    cnt.s === 'count' &&
      cnt.label === 'Cancel' &&
      /Counting in/.test(cnt.note) &&
      cnt.r.following &&
      cnt.r.from === 0 &&
      cnt.r.to === 32,
    `the strip's Record counts in (${cnt.s}: "${cnt.label}", "${cnt.note}"); the ruler is the take's loop, bars ${cnt.r.from / 4 + 1}–${cnt.r.to / 4}`,
  );
  t.ok(
    h1 === h0 && !(await E(() => window.overdub.engine.playing)),
    'Cancel during the count-in records nothing and stops',
  );

  /* ---- 2. tap along with the playing demo: ticks at the beats they were tapped */
  await E((d) => {
    const app = window.overdub;
    app.store.dispatch(
      { type: 'project.set', patch: { loop: { ...app.store.get().loop, on: false } } },
      { by: 'you', label: 'loop off' },
    );
    app.ui.select({ track: d });
    app.engine.seek(8);
  }, ids.Drums);
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(100);
  await E(() => window.overdub.engine.play(8));
  await until(8.98);
  await tapKey('KeyF'); // kick on beat 2 of bar 3
  // on the canvas, right away (before the page turns): a cream tick in the kick row where it fell
  const kick0 = await E(() => window.overdub.sketch.ruler().marks.find((m) => m.row === 'kick')?.raw ?? 9);
  // (read after the next frames have drawn: a loaded machine can be a frame or two behind)
  const pxAt = (raw) =>
    E(
      async ({ raw }) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const cv = document.querySelector('.sk-grid'),
          g = cv.getContext('2d'),
          geo = window.overdub.sketch.geom(),
          dpr = cv.width / geo.w;
        const X = (b) => geo.L + ((b - geo.from) / (geo.to - geo.from)) * (geo.R - geo.L);
        const y = Math.round((geo.T + geo.rh * 0.5) * dpr),
          row = g.getImageData(0, y, cv.width, 1).data;
        // (opaque only: the canvas is transparent and its empty cells are a faint wash, which getImageData reports at full
        // brightness with an alpha of a few units; read without alpha, a probe a fraction of a pixel onto a cell saw a tick)
        const cream = (x) => {
          const i = Math.round(x * dpr) * 4;
          return row[i + 3] > 128 && row[i] > 215 && row[i + 1] > 205 && row[i + 2] > 180;
        };
        const x0 = X(raw);
        const at = (x) => {
          const i = Math.round(x * dpr) * 4;
          return row.slice(i, i + 4).join(',');
        };
        return {
          tick: [-1, 0, 1].some((d) => cream(x0 + d)),
          away: cream(X(raw + 1.5)),
          x: Math.round(x0),
          px: [-2, -1, 0, 1, 2].map((d) => at(x0 + d)).join(' '),
          geo: `${geo.kind} ${geo.from}-${geo.to} T${geo.T} rh${geo.rh.toFixed(1)} w${geo.w}`,
          marks: window.overdub.sketch.ruler().marks.length,
        };
      },
      { raw },
    );
  let px = await pxAt(kick0);
  for (let i = 0; i < 10 && !px.tick; i++) {
    await page.waitForTimeout(50);
    px = await pxAt(kick0);
  }
  t.ok(
    px.tick && !px.away,
    `the kick's tick is drawn on the canvas where it fell (x ${px.x}), and nowhere it didn't${px.tick && !px.away ? '' : ` (${JSON.stringify(px)})`}`,
  );
  await until(10.02);
  await tapKey('KeyJ'); // snare on beat 3
  await until(11.48);
  await tapKey('KeyK'); // hat on the "and" of beat 4
  await page.waitForTimeout(60);
  const along = await E(() => ({ r: window.overdub.sketch.ruler(), g: window.overdub.sketch.geom() }));
  const kd = await E(() => window.__kd.filter((x) => ['KeyF', 'KeyJ', 'KeyK'].includes(x.code)).slice(-3));
  const ms = along.r.marks.filter((m) => m.kind === 'drums');
  t.ok(
    along.r.following && along.r.from === 8 && along.r.to === 16 && along.g?.kind === 'drums',
    `with the song playing (loop off), Tap's canvas is the ruler: bars 3–4 from where it started (${along.r.from}–${along.r.to}, ${along.g?.kind})`,
  );
  t.ok(
    ms.length === 3 && ms.map((m) => m.row).join() === 'kick,snare,hat',
    `each tap is on the ruler as it lands (${ms.map((m) => `${m.row}@${m.raw.toFixed(3)}`).join(', ')})`,
  );
  t.ok(
    ms.length === 3 && ms.every((m, i) => near(m.raw, kd[i]?.beat, 0.006)),
    `each tick is at the beat its key went down, within 6 ms of a beat (${ms.map((m, i) => `${m.raw.toFixed(3)} vs ${kd[i]?.beat?.toFixed(3)}`).join(', ')})`,
  );
  t.ok(
    ms.length === 3 &&
      ms.every((m) => near(m.t, Math.round(m.raw * 4) / 4, 1e-9)) &&
      ms.map((m) => m.t).join() === '9,10,11.5',
    `and the cell it snapped to, on the 1/16 grid (${ms.map((m) => m.t).join(', ')})`,
  );
  await shot('sketch-rec-along');

  /* ---- 3. the pass readout */
  await E(() => window.overdub.engine.stop());
  await page.waitForTimeout(120);
  const ro = await E(() => ({
    r: window.overdub.sketch.ruler().readout,
    text: document.querySelector('.sk-pass')?.textContent || '',
    shown: !document.querySelector('.sk-pass')?.hidden,
  }));
  const want = ms.reduce((a, m) => a + (m.raw - m.t) * spbMs, 0) / Math.max(1, ms.length);
  const mm =
    /^Pass 1: 3 hits, (?:(\d+) ms (late|early)|on the grid) on average(?:; (\d+) nudged into place, (\d+) ms at most)?$/.exec(
      ro.text,
    );
  const said = mm ? (mm[1] ? +mm[1] * (mm[2] === 'late' ? 1 : -1) : 0) : NaN;
  t.ok(
    ro.shown && !!mm && ro.r?.hits === 3 && ro.r?.pass === 1,
    `after the pass, one line under the ruler: "${ro.text}"`,
  );
  t.ok(
    near(said, want, 1) && near(ro.r?.ms, want, 0.15),
    `its number is the taps' mean distance from the grid: ${said} ms said, ${want.toFixed(1)} ms from where the keys went down`,
  );

  /* ---- 4. a looped take: pass 1 dimmed under pass 2, a line after each pass */
  await E((d) => {
    const app = window.overdub;
    app.store.dispatch(
      { type: 'project.set', patch: { loop: { on: true, start: 0, end: 4 } } },
      { by: 'you', label: 'loop bar 1' },
    );
    app.ui.select({ track: d });
    app.engine.seek(0);
  }, ids.Drums);
  await page.keyboard.press('KeyR'); // one bar of clicks, then bar 1 round and round
  await until(0.98);
  await tapKey('KeyF');
  await until(1.98);
  await tapKey('KeyJ');
  let g = await E(() => window.overdub.engine.gridBeat);
  for (let i = 0; i < 200 && g < 4.6; i++) {
    await page.waitForTimeout(40);
    g = await E(() => window.overdub.engine.gridBeat);
  }
  const p1 = await E(() => ({
    r: window.overdub.sketch.ruler(),
    text: document.querySelector('.sk-pass')?.textContent || '',
    note: document.querySelector('.sk-recnote')?.textContent,
  }));
  await until(2.98);
  await tapKey('KeyK');
  await page.waitForTimeout(80);
  const p2 = await E(() => window.overdub.sketch.ruler());
  await shot('sketch-rec-passes');
  await page.keyboard.press('Space');
  await idle();
  const p3 = await E(() => ({
    r: window.overdub.sketch.ruler(),
    text: document.querySelector('.sk-pass')?.textContent || '',
  }));
  t.ok(
    /^Pass 1: 2 hits, /.test(p1.text) && p1.r.pass === 1 && /pass 2/.test(p1.note),
    `after the wrap the line says how pass 1 went ("${p1.text}"), and the strip says "${p1.note}"`,
  );
  t.ok(
    p2.from === 0 &&
      p2.to === 4 &&
      p2.pass === 1 &&
      p2.marks.filter((m) => m.pass === 0).length === 2 &&
      p2.marks.filter((m) => m.pass === 1).length === 1,
    `the ruler is the loop (beats ${p2.from}–${p2.to}): pass 1's two hits stay (dimmed) under pass 2's (${p2.marks.map((m) => `${m.pass + 1}:${m.row}@${m.t}`).join(' ')})`,
  );
  t.ok(
    /^Pass 2: 1 hit, /.test(p3.text) &&
      p3.r.readouts
        .slice(-2)
        .map((x) => x.pass)
        .join() === '1,2',
    `and at the stop, the last pass's line ("${p3.text}")`,
  );
  await E(() => {
    const app = window.overdub;
    app.store.undo();
    app.store.undo();
  }); // the take, the loop

  /* ---- 5. Shift+R: a take played along goes in at the bar it was played */
  await E((k) => {
    const app = window.overdub;
    app.store.dispatch(
      { type: 'project.set', patch: { loop: { ...app.store.get().loop, on: false } } },
      { by: 'you', label: 'loop off' },
    );
    app.ui.select({ track: k });
    app.engine.seek(16);
  }, ids.Keys);
  await E(() => window.overdub.input.emit('sketch:mode', 'play'));
  // (every note, in my own timing: this is where a take lands, not what the defaults do to it; section 11 has those)
  await E(() => {
    const q = window.overdub.input.qwerty;
    q.setScaleLock(false);
    q.setQuantize(false);
  });
  await page.keyboard.press('Backquote');
  await E(() => window.overdub.engine.play(16));
  await until(16.98);
  await tapKey('KeyA', 150);
  await until(17.98);
  await tapKey('KeyD', 150);
  await until(18.98);
  await tapKey('KeyG', 150);
  const pl = await E(() => window.overdub.sketch.ruler());
  await E(() => window.overdub.engine.stop());
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(100);
  const kdK = await E(() => window.__kd.filter((x) => ['KeyA', 'KeyD', 'KeyG'].includes(x.code)).slice(-3));
  t.ok(
    pl.marks
      .filter((m) => m.kind === 'pitch')
      .map((m) => m.p)
      .join() === '60,64,67' && pl.from === 16,
    `notes played along are on the ruler too, bars 5–6 (${pl.marks.map((m) => `${m.p}@${m.raw.toFixed(2)}`).join(' ')})`,
  );
  const before = await E((k) => window.overdub.store.track(k).clips.map((c) => c.id), ids.Keys);
  await page.keyboard.press('Shift+KeyR');
  await page.waitForTimeout(250);
  const put = await E(
    ({ k, before }) => {
      const app = window.overdub,
        tr = app.store.track(k),
        c = tr.clips.find((x) => !before.includes(x.id));
      const card = document.querySelector('.sk-idea.sk-new');
      return {
        clip: c && { start: c.start, notes: c.notes.map((n) => ({ p: n.p, t: n.t })) },
        by: app.store.history.slice(-1)[0]?.by,
        label: card?.querySelector('.sk-insong')?.textContent || '',
        put: !!card?.querySelector('.sk-put'),
      };
    },
    { k: ids.Keys, before },
  );
  const at = (p) => (put.clip ? put.clip.start + (put.clip.notes.find((n) => n.p === p)?.t ?? NaN) : NaN);
  t.ok(
    put.clip && put.clip.start === 16 && put.by === 'you',
    `Shift+R puts it on Keys at bar 5, where it was played (clip at beat ${put.clip?.start}, by ${put.by})`,
  );
  t.ok(
    [60, 64, 67].every((p, i) => near(at(p), kdK[i]?.beat, 1 / 32)),
    `each note at the beat its key went down, within 1/32 (${[60, 64, 67].map((p, i) => `${at(p).toFixed(3)} vs ${kdK[i]?.beat?.toFixed(3)}`).join(', ')})`,
  );
  t.ok(
    /^Put in the song: 3 notes on Keys at bar 5, where you played them\./.test(await lastToast()),
    `"${(await lastToast()).slice(0, 80)}"`,
  );
  t.ok(
    put.label === 'in the song: Keys, bar 5' && !put.put,
    `its card says "${put.label}" in place of Put it in the song`,
  );
  await E(() => {
    const q = window.overdub.input.qwerty;
    q.setScaleLock(true);
    q.setQuantize(true);
  });
  await page.click('.sk-idea.sk-new .sk-insong');
  const shown = await E(() => window.overdub.ui.state.selection);
  t.ok(shown.track === ids.Keys && !!shown.clip, 'clicking that label selects the clip in the arranger');
  // a card's Put it in the song: undo the keep, the card offers Put again, and it goes back at bar 5
  await E(() => window.overdub.store.undo());
  await page.waitForTimeout(150);
  const again = await E(() => ({
    put: document.querySelector('.sk-idea.sk-new .sk-put')?.textContent || '',
    go: document.querySelector('.sk-idea.sk-new .sk-put')?.classList.contains('btn-go'),
    gos: [...document.querySelectorAll('[data-panel="sketch"] .btn-go')].filter((b) => b.getClientRects().length)
      .length,
    keep: document.querySelector('.sk-idea.sk-new .sk-keep')?.textContent.trim(),
  }));
  t.ok(
    /^Put it in the song/.test(again.put) && again.go && again.gos === 1 && again.keep === 'Keep on…',
    `once undone, the card's first action is Put it in the song, the one primary in Sketch (${again.gos}), with Keep on… after it`,
  );
  await page.click('.sk-idea.sk-new .sk-put');
  await page.waitForTimeout(200);
  const put2 = await E(
    ({ k, before }) =>
      window.overdub.store
        .track(k)
        .clips.filter((x) => !before.includes(x.id))
        .map((c) => c.start),
    { k: ids.Keys, before },
  );
  t.ok(put2.join() === '16', `the card's Put it in the song puts it back at bar 5 (${put2.join()})`);
  await E(() => {
    const app = window.overdub;
    app.store.undo();
    app.store.undo();
  });

  /* ---- 6. one input picker: Record's device and channel are the record track's Input */
  const pick = await E(async () => {
    const app = window.overdub,
      st = app.store;
    st.dispatch({ type: 'track.add', ref: 'g', track: { kind: 'audio', name: 'Gtr', arm: true } }, { by: 'you' });
    app.input.emit('sketch:mode', 'rec');
    await new Promise((r) => setTimeout(r, 150));
    return {
      id: st.get().tracks.find((x) => x.name === 'Gtr').id,
      onto: document.querySelector('.sk-target')?.selectedOptions[0]?.textContent,
      each: [...document.querySelectorAll('.sk-each button')]
        .map((b) => `${b.textContent}${b.disabled ? '(off)' : ''}`)
        .join(' '),
    };
  });
  await page.selectOption('.sk-inch', '2');
  await page.waitForTimeout(100);
  const w1 = await E((id) => {
    const app = window.overdub,
      tr = app.store.track(id),
      h = app.store.history.slice(-1)[0];
    return {
      input: tr.input,
      by: h.by,
      label: h.label,
      of: app.input.audio.inputOf(tr),
      picker: app.input.audio.state.channel,
    };
  }, pick.id);
  await page.selectOption('.sk-inch', 'both');
  await page.waitForTimeout(100);
  const w2 = await E((id) => {
    const app = window.overdub,
      tr = app.store.track(id);
    return { input: tr.input, of: app.input.audio.inputOf(tr), shown: document.querySelector('.sk-inch').value };
  }, pick.id);
  t.ok(
    pick.onto === 'Gtr' && /Layer\(off\) New take/.test(pick.each),
    `Record's strip records onto the audio track, and an audio take always stacks (${pick.onto}: ${pick.each})`,
  );
  t.ok(
    w1.input?.channel === 2 && w1.by === 'you' && w1.of.channel === '2' && w1.of.from === 'track',
    `the channel picked in Sketch is Gtr's Input (track.input ${JSON.stringify(w1.input)}, by ${w1.by}: "${w1.label}"), the one the recorder opens (${JSON.stringify(w1.of)})`,
  );
  t.ok(
    w2.input?.channel === 'both' && w2.of.channel === 'both' && w2.shown === 'both',
    `Both (mono) is kept on the track too (${JSON.stringify(w2.of)})`,
  );
  await E(() => {
    const app = window.overdub;
    app.store.undo();
    app.store.undo();
    app.store.undo();
  });

  /* ---- 8. the sheet's layout at 1440 × 900 and 1280 × 720: nothing drawn over anything */
  const meets = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  const inside = (a, p) => !!a && !!p && a.t >= p.t - 0.5 && a.b <= p.b + 0.5 && a.l >= p.l - 0.5 && a.r <= p.r + 0.5;
  const layout = () =>
    E(() => {
      const r = (el) => {
        if (!el || !el.getClientRects().length) return null;
        const b = el.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
      };
      const sk = document.querySelector('[data-panel="sketch"]'),
        q = (sel) => r(sk.querySelector(sel));
      const rb = sk.querySelector('.sk-recbtn'),
        rr = r(rb),
        hit = rr && document.elementFromPoint(rr.l + rr.w / 2, rr.t + rr.h / 2);
      const n = sk.querySelector('.sk-idea.sk-new .sk-idea-n'),
        pass = sk.querySelector('.sk-pass');
      return {
        panel: r(sk),
        cv: q('.sk-cv'),
        cap: q('.sk-cap'),
        pass: pass && !pass.hidden ? r(pass) : null,
        passText: pass && !pass.hidden ? pass.textContent : '',
        spiral: q('.sk-spiral'),
        foot: q('.sk-foot'),
        strip: q('.sk-strip'),
        qw: q('.sk-qwdock'),
        ewqw: q('.ew-qw'),
        rec: rr,
        recOnTop: !!hit && rb.contains(hit),
        n: r(n),
        nText: n?.textContent,
        nFits: !!n && n.scrollWidth <= n.clientWidth + 1,
        who: q('.sk-idea.sk-new .sk-idea-who'),
        geom: window.overdub.sketch.geom(),
        over: sk.scrollHeight - sk.clientHeight,
      };
    });
  await E(() => {
    const c = window.overdub.input.capture;
    for (let i = 0; i < 16; i++)
      c.add({
        src: 'tap',
        kind: 'drums',
        notes: [
          { p: 36, t: 0, d: 0.25, v: 0.8 },
          { p: 38, t: 1, d: 0.25, v: 0.8 },
        ],
        tempo: 92,
      });
  });
  for (const [w, hh] of [
    [1440, 900],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width: w, height: hh });
    // Hum it before the mic is allowed: its explainer fits over the roll, its primary button whole and clickable
    await E(() => {
      for (const x of document.querySelectorAll('.ew-toast')) x.remove();
      try {
        localStorage.removeItem('overdub:mic-ok');
      } catch (e) {
        /* ok */
      }
      const a = window.overdub;
      a.input.emit('sketch:mode', 'tap');
      a.input.emit('sketch:mode', 'hum');
    });
    await page.waitForTimeout(300);
    const exm = await E(() => {
      const sk = document.querySelector('[data-panel="sketch"]'),
        ex = sk.querySelector('.sk-explain');
      if (!ex || !ex.getClientRects().length) return null;
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
      };
      const btn = [...ex.querySelectorAll('button')].find((b) => /Allow the mic/.test(b.textContent)),
        br = r(btn),
        hit = document.elementFromPoint(br.l + br.w / 2, br.t + br.h / 2);
      return {
        ex: r(ex),
        btn: br,
        hit: !!hit && btn.contains(hit),
        hitEl: hit && (hit.className || hit.tagName) + ' < ' + (hit.parentElement?.className || ''),
        over: ex.scrollHeight - ex.clientHeight,
        foot: r(sk.querySelector('.sk-foot')),
        title: btn.title,
      };
    });
    t.ok(
      exm &&
        inside(exm.btn, exm.ex) &&
        exm.hit &&
        exm.over <= 1 &&
        !meets(exm.btn, exm.foot) &&
        /The sound stays on this device; an agent you’ve connected can read the notes/.test(exm.title),
      `${w}×${hh}, Hum it before the mic is allowed: "Allow the mic and hum" (${exm && Math.round(exm.btn.t)}–${exm && Math.round(exm.btn.b)}) is whole inside its explainer (${exm && Math.round(exm.ex.t)}–${exm && Math.round(exm.ex.b)}, overflow ${exm?.over} px) and takes the click; what didn't fit is its title${exm && !exm.hit ? ` (covered by ${exm.hitEl})` : ''}`,
    );
    await E((d) => {
      const app = window.overdub;
      app.store.dispatch(
        { type: 'project.set', patch: { loop: { ...app.store.get().loop, on: false } } },
        { by: 'you', label: 'loop off' },
      );
      app.ui.select({ track: d });
      app.input.emit('sketch:mode', 'tap');
      app.engine.play(8);
    }, ids.Drums);
    await page.waitForTimeout(250);
    for (const k of ['KeyF', 'KeyJ', 'KeyK']) {
      await tapKey(k);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(150);
    const fol = await layout();
    await E(() => window.overdub.engine.stop());
    await page.waitForTimeout(250);
    const tapped = await layout();
    await shot(`sketch-layout-${w}-tap`);
    t.ok(
      fol.geom?.kind === 'drums' && fol.geom.rh >= 13 && fol.cv?.h >= 70 && !meets(fol.foot, fol.cv) && fol.over <= 1,
      `${w}×${hh}, tapping along: the ruler's four rows are ${fol.geom?.rh.toFixed(1)} px, one label each, in a ${Math.round(fol.cv?.h)} px canvas the footer doesn't cover (sheet overflow ${fol.over} px)`,
    );
    t.ok(
      /^Pass 1: 3 hits/.test(tapped.passText) &&
        !meets(tapped.pass, tapped.cv) &&
        !meets(tapped.cap, tapped.cv) &&
        !meets(tapped.cap, tapped.pass) &&
        !meets(tapped.foot, tapped.pass) &&
        tapped.over <= 1,
      `${w}×${hh}, stopped: "${tapped.passText}" is a line under the canvas, the caption a line over it, neither drawn on it (${JSON.stringify({ cap: tapped.cap && Math.round(tapped.cap.b), cv: tapped.cv && [Math.round(tapped.cv.t), Math.round(tapped.cv.b)], pass: tapped.pass && Math.round(tapped.pass.t) })})`,
    );
    await E(async () => {
      const a = window.overdub;
      a.input.emit('sketch:mode', 'hum');
      const sr = 48000,
        ps = [60, 62, 64, 67, 64, 62, 60],
        seg = 0.4,
        x = new Float32Array(Math.round(sr * seg * ps.length + sr * 0.3));
      let ph = 0;
      ps.forEach((p, i) => {
        const f = 440 * 2 ** ((p - 69) / 12);
        for (let n = 0; n < sr * seg * 0.9; n++) {
          ph += (2 * Math.PI * f) / sr;
          x[Math.round(i * seg * sr) + n] = 0.3 * Math.sin(ph) + 0.1 * Math.sin(2 * ph);
        }
      });
      await a.input.hum.fromSamples(x, sr);
    });
    await page.waitForTimeout(300);
    const hm = await layout();
    await shot(`sketch-layout-${w}-hum`);
    t.ok(
      hm.spiral?.h >= 90 &&
        hm.spiral?.w >= 90 &&
        !meets(hm.cap, hm.cv) &&
        !meets(hm.foot, hm.spiral) &&
        !meets(hm.foot, hm.cv) &&
        !hm.pass &&
        hm.over <= 1,
      `${w}×${hh}, after a hum: the pitch wheel is ${Math.round(hm.spiral?.w)} px, "Your hum is in" is its own line, Again is under it, and no pass line from Tap (overflow ${hm.over} px)`,
    );
    await E(() => {
      const a = window.overdub;
      a.input.emit('sketch:mode', 'play');
      a.input.qwerty.toggle(true);
    });
    await page.waitForTimeout(300);
    const pl2 = await layout();
    await shot(`sketch-layout-${w}-play`);
    t.ok(
      inside(pl2.ewqw, pl2.qw) && !meets(pl2.foot, pl2.ewqw) && pl2.over <= 1,
      `${w}×${hh}, Play it with musical typing: the strip's keys are all in view (${Math.round(pl2.ewqw?.h)} px in ${Math.round(pl2.qw?.h)} px), none under the footer`,
    );
    await E(() => {
      const a = window.overdub;
      a.input.qwerty.toggle(false);
      a.ui.toast('Take 2 is in on Wall, bars 2–5. One more underneath, muted. Undo takes it back.', {
        action: { label: 'Undo', run() {} },
      });
    });
    await page.waitForTimeout(250);
    const ts = await layout();
    t.ok(ts.recOnTop && inside(ts.rec, ts.panel), `${w}×${hh}: with a toast up, Record is in the pane and on top`);
    t.ok(
      ts.nText?.length >= 2 && ts.nFits && !meets(ts.n, ts.who),
      `${w}×${hh}: take ${ts.nText}'s number fits its column, clear of "played by"`,
    );
    t.ok(w !== 1440 || ts.strip?.h <= 40, `${w}×${hh}: the record strip is one line (${Math.round(ts.strip?.h)} px)`);
    await E(() => {
      for (const x of document.querySelectorAll('.ew-toast')) x.remove();
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  /* ---- 9. leaving Play it turns musical typing off; the tour gives back its loop and typing */
  const typing = {};
  for (const to of ['tap', 'hum']) {
    await E(() => {
      const a = window.overdub;
      a.input.emit('sketch:mode', 'play');
      a.input.qwerty.toggle(true);
    });
    await page.waitForTimeout(80);
    const on = await E(() => window.overdub.input.qwerty.on);
    await E((m) => window.overdub.input.emit('sketch:mode', m), to);
    await page.waitForTimeout(80);
    typing[to] = `${on}→${await E(() => window.overdub.input.qwerty.on)}`;
  }
  await E(() => window.overdub.input.emit('sketch:mode', 'play'));
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyH'); // (H plays a note while typing is on: Hum it comes forward only through the rail)
  const stays = await E(() => window.overdub.input.qwerty.on);
  await E(() => window.overdub.input.qwerty.toggle(false));
  t.ok(
    typing.tap === 'true→false' && typing.hum === 'true→false' && stays,
    `leaving Play it turns musical typing off (to Tap: ${typing.tap}, to Hum: ${typing.hum}); staying in it keeps it on`,
  );
  const tour = await E(async () => {
    const app = window.overdub,
      st = app.store,
      wait = (ms) => new Promise((r) => setTimeout(r, ms));
    st.dispatch(
      { type: 'project.set', patch: { loop: { on: true, start: 0, end: 32 } } },
      { by: 'you', label: 'loop the song' },
    );
    app.transport?.marker?.set?.(16);
    const before = JSON.stringify(st.get().loop);
    await app.onboard.firstMinute('tap');
    await wait(150);
    const lent = JSON.stringify(st.get().loop);
    await app.onboard.keysOver();
    await wait(150);
    const typed = app.input.qwerty.on;
    app.engine.stop();
    app.onboard.stop();
    await wait(100);
    const after = JSON.stringify(st.get().loop),
      typingAfter = app.input.qwerty.on;
    // the same, ended by reaching "That's an overdub"
    await app.onboard.firstMinute('tap');
    await wait(150);
    const lent2 = JSON.stringify(st.get().loop);
    app.engine.stop();
    for (let i = 0; i < 6 && app.onboard.step !== 'done'; i++) app.onboard.skip();
    await wait(80);
    const atDone = JSON.stringify(st.get().loop),
      step = app.onboard.step;
    app.onboard.stop();
    return { before, lent, typed, after, typingAfter, lent2, atDone, step };
  });
  t.ok(
    tour.lent !== tour.before && tour.typed && tour.after === tour.before && !tour.typingAfter,
    `the first minute lends a 2-bar loop (${tour.lent}) and typing, and Close gives both back (loop ${tour.after}, typing ${tour.typingAfter})`,
  );
  t.ok(
    tour.lent2 !== tour.before && tour.step === 'done' && tour.atDone === tour.before,
    `reaching "That's an overdub" gives the loop back too (${tour.atDone})`,
  );
  await E(() => {
    const a = window.overdub;
    a.store.dispatch(
      { type: 'project.set', patch: { loop: { on: false, start: 0, end: 32 } } },
      { by: 'you', label: 'loop off' },
    );
  });

  t.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);

  /* ---- 7. a phone: Record pinned to the bottom of the sheet */
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    permissions: ['microphone'],
  });
  const ph = await ctx.newPage();
  const perr = [];
  ph.on('pageerror', (e) => perr.push(String(e)));
  await ph.goto(url, { waitUntil: 'load' });
  await ph.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await ph.evaluate(() => {
    const app = window.overdub;
    app.onboard?.skip?.();
    app.ui.show('sketch');
    app.input.emit('sketch:mode', 'tap');
  });
  await ph.waitForTimeout(400);
  const phone = await ph.evaluate(async () => {
    const b = document.querySelector('.sk-recbtn'),
      s = document.querySelector('.sk-strip');
    const sc =
      s &&
      (() => {
        let p = s.parentElement;
        while (p && p !== document.body) {
          const o = getComputedStyle(p).overflowY;
          if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
          p = p.parentElement;
        }
        return null;
      })();
    const top0 = sc ? sc.scrollTop : 0;
    if (sc) sc.scrollTop = Math.max(0, (sc.scrollHeight - sc.clientHeight) / 2);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = b?.getBoundingClientRect(),
      hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const out = {
      touch: !!document.querySelector('.sk.touch'),
      pos: b && getComputedStyle(b.closest('.sk-foot')).position,
      h: r ? Math.round(r.height) : 0,
      inView: !!r && r.bottom <= innerHeight + 1 && r.top >= 0,
      reach: !!hit && b.contains(hit),
      scrolled: !!sc,
    };
    if (sc) sc.scrollTop = top0;
    return out;
  });
  t.ok(
    phone.touch && phone.pos === 'sticky' && phone.h >= 44 && phone.inView && phone.reach,
    `on a phone the footer with Record is pinned: Record is ${phone.h} px tall, in view and on top (${JSON.stringify(phone)})`,
  );
  await ph.screenshot({ path: new URL('./.out/sketch-rec-phone.png', import.meta.url).pathname });

  /* ---- 10. a phone: the take's options, the beat over the pads, the keys in the track's register, the tour's line */
  const PE = (fn, a) => ph.evaluate(fn, a);
  const opts = await PE(async () => {
    const g = document.querySelector('.sk-body .sk-recopts');
    const out = { inHead: !!g, parts: [] };
    for (const sel of ['.sk-each button:last-child', '.sk-countin', '.sk-click']) {
      const b = g?.querySelector(sel);
      if (!b) {
        out.parts.push(`${sel}: missing`);
        continue;
      }
      b.scrollIntoView({ block: 'center' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = b.getBoundingClientRect(),
        hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out.parts.push(`${b.textContent.trim()}: ${Math.round(r.height)}px${b.contains(hit) ? '' : ' (covered)'}`);
    }
    return out;
  });
  t.ok(
    opts.inHead && opts.parts.length === 3 && opts.parts.every((x) => /: (4\d|[5-9]\d)px$/.test(x)),
    `phone: Each pass, the count-in and the click are a row of their own, 40 px and reachable (${opts.parts.join('; ')})`,
  );
  await PE(async () => {
    const a = window.overdub;
    await a.engine.start();
    a.input.emit('sketch:mode', 'tap');
    a.engine.seek(0);
    a.engine.play(0);
  });
  const beat = [];
  for (let i = 0; i < 3; i++) {
    await ph.waitForTimeout(260);
    beat.push(
      await PE(() => {
        const b = document.querySelector('.sk-beats'),
          p = document.querySelector('.sk-pads'),
          e = window.overdub.engine;
        const rb = b?.getBoundingClientRect(),
          rp = p?.getBoundingClientRect();
        return {
          lit: b ? +b.dataset.beat : NaN,
          want: ((Math.floor(e.beat) % 4) + 4) % 4,
          beat: e.beat,
          above: !!rb && !!rp && rb.bottom <= rp.top + 1 && rb.height >= 14,
          now: b?.querySelectorAll('i.now').length,
        };
      }),
    );
  }
  await PE(() => window.overdub.engine.stop());
  t.ok(
    beat.every((x) => x.above && x.now === 1 && (x.lit === x.want || x.lit === (x.want + 3) % 4)) &&
      new Set(beat.map((x) => x.lit)).size >= 2,
    `phone: the beat's lamps sit over the pads and step with the song (${beat.map((x) => `${x.beat.toFixed(2)}→${x.lit}`).join(', ')})`,
  );
  await ph.screenshot({ path: new URL('./.out/sketch-rec-phone-tap.png', import.meta.url).pathname });
  const kb = await PE(async () => {
    const a = window.overdub,
      bass = a.store.get().tracks.find((x) => x.name === 'Bass');
    const ps = bass.clips.flatMap((c) => (c.notes || []).map((n) => n.p)).sort((x, y) => x - y);
    a.ui.select({ track: bass.id, clip: null, notes: [] });
    a.input.emit('sketch:mode', 'play');
    await new Promise((r) => setTimeout(r, 300));
    const keys = [...document.querySelectorAll('.sk-tk-k')].map((k) => +k.dataset.p);
    const seen = [];
    const was = a.input.noteOn;
    a.input.noteOn = function (src, p, ...rest) {
      seen.push(p);
      return was.call(this, src, p, ...rest);
    };
    const k0 = document.querySelector('.sk-tk-k'),
      r0 = k0.getBoundingClientRect(),
      o = { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: r0.left + 5, clientY: r0.top + r0.height / 2 };
    k0.dispatchEvent(new PointerEvent('pointerdown', o));
    k0.dispatchEvent(new PointerEvent('pointerup', o));
    a.input.noteOn = was;
    const strip = document.querySelector('.sk-strip'),
      rs = strip.getBoundingClientRect(),
      rk = document.querySelector('.sk-tk-keys').getBoundingClientRect(),
      rb = strip.querySelector('.sk-recbtn').getBoundingClientRect();
    const hit = document.elementFromPoint(rb.left + rb.width / 2, rb.top + rb.height / 2);
    return {
      lo: ps[0],
      hi: ps[ps.length - 1],
      mid: ps[Math.floor(ps.length / 2)],
      keys: [keys[0], keys[keys.length - 1]],
      label: document.querySelector('.sk-tk-oct')?.textContent,
      played: seen[0],
      above: rs.bottom <= rk.top + 1,
      inBody: !!strip.closest('.sk-body'),
      recIn: rb.top >= 0 && rb.bottom <= innerHeight,
      keysIn: rk.bottom <= innerHeight + 1,
      reach: !!hit && strip.querySelector('.sk-recbtn').contains(hit),
    };
  });
  await ph.screenshot({ path: new URL('./.out/sketch-rec-phone-keys.png', import.meta.url).pathname });
  t.ok(
    kb.played >= kb.lo - 2 && kb.keys[0] <= kb.mid && kb.keys[1] >= kb.mid,
    `phone: Bass's keyboard starts in its register, ${kb.label} around its part's ${kb.lo}–${kb.hi} (its lowest key played MIDI ${kb.played}, not A4's 69)`,
  );
  t.ok(
    kb.inBody && kb.above && kb.recIn && kb.keysIn && kb.reach,
    `phone: Record sits right above the keys, both on screen (${JSON.stringify({ above: kb.above, recIn: kb.recIn, keysIn: kb.keysIn, reach: kb.reach })})`,
  );
  const ob = await PE(async () => {
    const a = window.overdub,
      wait = (ms) => new Promise((r) => setTimeout(r, ms));
    a.input.capture.flush?.(); // (the key tapped above is a take of its own, not the tour's)
    await wait(50);
    a.input.emit('sketch:mode', 'tap');
    a.input.recorder.setCountIn(0);
    await a.onboard.firstMinute('tap');
    await wait(300);
    const idleText = document.querySelector('.ob')?.textContent || '';
    await a.input.recorder.record();
    // (counting in: the card is one line already)
    for (let i = 0; i < 40 && a.input.recorder.state !== 'count'; i++) await wait(25);
    const counting = {
      st: a.input.recorder.state,
      mini: !!document.querySelector('.ob')?.classList.contains('ob-mini'),
    };
    for (let i = 0; i < 160 && a.input.recorder.state !== 'rec'; i++) await wait(50);
    await wait(120);
    const c = document.querySelector('.ob'),
      r = c?.getBoundingClientRect(),
      line = c?.querySelector('.ob-line');
    const out = {
      counting,
      idleText,
      mini: !!c?.classList.contains('ob-mini'),
      h: r ? Math.round(r.height) : 0,
      text: c?.textContent || '',
      oneLine: !!line && line.getBoundingClientRect().height <= 24,
      state: a.input.recorder.state,
    };
    a.input.recorder.cancel?.();
    a.engine.stop();
    await wait(150);
    out.after = !!document.querySelector('.ob')?.classList.contains('ob-mini');
    a.onboard.stop();
    a.input.recorder.setCountIn(1);
    return out;
  });
  t.ok(
    ob.state === 'rec' &&
      ob.mini &&
      ob.h <= 64 &&
      ob.oneLine &&
      /pass 1|time 1 round|round 1/i.test(ob.text) &&
      !ob.after &&
      (ob.counting.st !== 'count' || ob.counting.mini),
    `phone: counting in and recording, the tour's card is one line, ${ob.h} px ("${ob.text.slice(0, 70)}"), and whole again after`,
  );
  t.ok(
    !/press R|Space/.test(ob.idleText) && /tap ●/i.test(ob.idleText),
    `phone: the tour says tap ●, never "press R" ("${ob.idleText.replace(/^.*?Tap a beat\./, '').slice(0, 150)}")`,
  );
  t.ok(!perr.length, `no page errors on the phone${perr.length ? ': ' + perr.slice(0, 2).join(' | ') : ''}`);
  await ctx.close();

  /* ---- 11. a beginner's route (docs/FRESH-EYES-3.md): in key and in time, and Sketch holding together while it records */
  const SIZES = [
    [1440, 900, false],
    [1280, 720, false],
    [390, 844, true],
  ];
  for (const [w, hh, mobile] of SIZES) {
    const tag = `${w}×${hh}`;
    const c11 = await browser.newContext({
      viewport: { width: w, height: hh },
      ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
      permissions: ['microphone'],
    });
    const pg = await c11.newPage();
    const perr11 = [];
    pg.on('pageerror', (e) => perr11.push(String(e)));
    await pg.goto(url.replace(/\?.*$/, ''));
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const P = (fn, a) => pg.evaluate(fn, a);
    // a blank song (C minor), the first minute's Tap a beat, R, taps, Space: what a newcomer does
    await P(async () => {
      const app = window.overdub;
      await app.exporter.newSong();
      await app.engine.start();
      for (const x of document.querySelectorAll('.ew-toast')) x.remove();
    });
    await pg.waitForTimeout(300);
    await P(() => window.overdub.onboard.firstMinute('tap'));
    await pg.waitForTimeout(500);
    if (mobile) await pg.tap('.sk-recbtn');
    else await pg.keyboard.press('KeyR');
    for (let i = 0; i < 60 && (await P(() => window.overdub.input.recorder.state)) !== 'rec'; i++)
      await pg.waitForTimeout(100);
    if (mobile) {
      for (const r of ['kick', 'hat', 'snare', 'hat', 'kick', 'hat']) {
        await pg.tap(`.sk-pad[data-row="${r}"]`);
        await pg.waitForTimeout(260);
      }
    } else
      for (const k of ['KeyF', 'KeyK', 'KeyJ', 'KeyK', 'KeyF', 'KeyK']) {
        await pg.keyboard.press(k);
        await pg.waitForTimeout(260);
      }
    // the record strip while it records: every control whole, none over the next ("Drums ⌄Layer New ta■Count-in")
    const strip = await P(() => {
      const s = document.querySelector('.sk-strip');
      const els = [...s.querySelectorAll('.sk-recbtn, .sk-target, .sk-each button, .sk-countin, .sk-click')].filter(
        (x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden',
      );
      const rs = els.map((x) => {
        const r = x.getBoundingClientRect();
        return {
          t: x.textContent.trim(),
          l: r.left,
          r: r.right,
          top: r.top,
          b: r.bottom,
          cut: x.scrollWidth > x.clientWidth + 1,
        };
      });
      const over = [];
      for (let i = 0; i < rs.length; i++)
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i],
            b = rs[j];
          if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.top < b.b - 0.5 && b.top < a.b - 0.5) over.push(`${a.t}/${b.t}`);
        }
      // (the line it records onto: the strip's last word on a computer, over the pads on a phone)
      const note = document.querySelector('.sk-recnote'),
        nr = note.getBoundingClientRect();
      // a phone: the pinned row is one row, the line over the pads, every pad whole above the row (it wrapped to two
      // rows and covered the pads' bottom: a low tap on Kick hit Beatbox and turned the mic on)
      const foot = document.querySelector('.sk-foot'),
        fr = foot.getBoundingClientRect();
      const rowTops = [
        ...new Set(
          [...foot.querySelectorAll('button, select')]
            .filter((x) => x.getClientRects().length && !x.closest('[hidden]'))
            .map((x) => Math.round(x.getBoundingClientRect().top / 10)),
        ),
      ];
      const pads = [...document.querySelectorAll('.sk-pad')]
        .filter((x) => x.getClientRects().length)
        .map((x) => x.getBoundingClientRect());
      const padTop = pads.length ? Math.min(...pads.map((r) => r.top)) : null;
      return {
        n: rs.length,
        over,
        cut: rs.filter((x) => x.cut).map((x) => x.t),
        rec: window.overdub.input.recorder.state,
        note: note.textContent,
        noteOver: rs
          .filter(
            (x) => nr.width > 0 && x.l < nr.right - 0.5 && nr.left < x.r - 0.5 && x.top < nr.bottom && nr.top < x.b,
          )
          .map((x) => x.t),
        rows: rowTops.length,
        inFoot: foot.contains(note),
        noteAbove: padTop != null && nr.height > 0 && nr.bottom <= padTop + 0.5,
        padsWhole: pads.length === 4 && pads.every((r) => r.bottom <= fr.top + 0.5 && r.top >= 0),
      };
    });
    await pg.screenshot({ path: new URL(`./.out/sketch-beginner-${w}-rec.png`, import.meta.url).pathname });
    t.ok(
      strip.rec === 'rec' &&
        strip.n >= (mobile ? 2 : 3) &&
        !strip.over.length &&
        !strip.cut.length &&
        !strip.noteOver.length,
      `${tag}, recording: the record strip's ${strip.n} controls sit side by side, none over the next or cut (${strip.over.join(', ') || 'no overlap'}; "${strip.note}")`,
    );
    if (mobile)
      t.ok(
        strip.rows === 1 &&
          !strip.inFoot &&
          strip.noteAbove &&
          strip.padsWhole &&
          /^Recording onto Drums, pass \d+\.$/.test(strip.note),
        `${tag}, recording: the pinned row stays one row (${strip.rows}), "${strip.note}" sits over the pads, and every pad is whole above the row (${JSON.stringify({ inFoot: strip.inFoot, noteAbove: strip.noteAbove, padsWhole: strip.padsWhole })})`,
      );
    if (mobile) await pg.tap('.sk-recbtn');
    else await pg.keyboard.press('Space');
    for (let i = 0; i < 40 && (await P(() => window.overdub.input.recorder.state)) !== 'idle'; i++)
      await pg.waitForTimeout(100);
    await P(() => window.overdub.engine.stop());
    await pg.waitForTimeout(500);
    // after the beat is kept: the Tap grid has its rows and draws that beat (it showed nothing, in 5 px rows)
    const grid = await P(() => {
      const app = window.overdub,
        g = app.sketch.geom(),
        cv = document.querySelector('.sk-grid'),
        r = cv.getBoundingClientRect();
      const t = app.store.get().tracks.find((x) => /drum/i.test(x.instrument?.device || '')),
        inSong = t ? t.clips.reduce((n, c) => n + c.notes.length, 0) : 0;
      const cap = document.querySelector('.sk-capline .sk-cap, .sk-rollwrap .sk-cap');
      return {
        kind: g?.kind,
        rh: g?.rh,
        hits: g?.hits,
        inSong,
        h: r.height,
        cap: cap && cap.getClientRects().length ? cap.textContent : '',
        pass: document.querySelector('.sk-pass:not([hidden])')?.textContent || '',
      };
    });
    await pg.screenshot({ path: new URL(`./.out/sketch-beginner-${w}-kept.png`, import.meta.url).pathname });
    t.ok(
      grid.kind === 'tap' && grid.rh >= 12 && grid.hits >= 4 && grid.hits === grid.inSong,
      `${tag}, the beat is in: the Tap grid shows its ${grid.hits} hits (${grid.inSong} in the song) in four ${grid.rh?.toFixed(1)} px rows (${Math.round(grid.h)} px canvas; "${grid.pass || grid.cap}")`,
    );
    // Hum it before the mic is allowed, after a font lands late: the sentence wraps again, and the button stays whole
    const hum = await P(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms)),
        a = window.overdub;
      try {
        localStorage.removeItem('overdub:mic-ok');
      } catch (e) {
        /* ok */
      }
      a.input.emit('sketch:mode', 'tap');
      a.input.emit('sketch:mode', 'hum');
      await wait(200);
      const ex = document.querySelector('.sk-explain');
      if (!ex) return null;
      for (const x of ex.querySelectorAll('p')) x.style.fontSize = '16px'; // (what a late webfont does to its lines)
      await wait(250);
      const btn = [...ex.querySelectorAll('button')].find((b) => /Allow the mic/.test(b.textContent));
      btn.scrollIntoView({ block: 'center' });
      await wait(150); // (a phone's sheet scrolls)
      const br = btn.getBoundingClientRect(),
        er = ex.getBoundingClientRect();
      const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      return {
        inside: br.top >= er.top - 0.5 && br.bottom <= er.bottom + 0.5,
        over: ex.scrollHeight - ex.clientHeight,
        hit: !!hit && btn.contains(hit),
        cls: ex.className,
      };
    });
    t.ok(
      hum && hum.inside && hum.over <= 1 && hum.hit,
      `${tag}, Hum it: "Allow the mic and hum" stays whole when its sentence rewraps (${JSON.stringify(hum)})`,
    );
    // the Beat tab's head: the clip's name and its byline, never "by yo"
    await P(() => {
      const a = window.overdub,
        t = a.store.get().tracks.find((x) => /drum/i.test(x.instrument?.device || ''));
      a.ui.select({ track: t.id, clip: t.clips[0].id });
      a.ui.show('drumgrid');
    });
    await pg.waitForTimeout(400);
    const head = await P(() => {
      const c = document.querySelector('.dg-clip'),
        by = c.querySelector('.dg-by'),
        b = c.querySelector('b'),
        bar = document.querySelector('.dg-bar').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.dg-bar .dg-btn')]
        .filter((x) => x.getClientRects().length)
        .map((x) => x.getBoundingClientRect());
      return {
        by: by?.textContent,
        byW: by ? by.getBoundingClientRect().width : 0,
        byCut: by
          ? by.scrollWidth > by.clientWidth + 1 ||
            by.getBoundingClientRect().right > c.getBoundingClientRect().right + 0.5
          : true,
        nameW: b.getBoundingClientRect().width,
        out: btns.filter((r) => r.right > bar.right + 0.5 || r.bottom > bar.bottom + 0.5).length,
        empty: btns.filter((r) => r.width < 8).length,
      };
    });
    await pg.screenshot({ path: new URL(`./.out/sketch-beginner-${w}-beat.png`, import.meta.url).pathname });
    t.ok(
      head.by === ' by you' && !head.byCut && head.nameW >= 20 && !head.out && !head.empty,
      `${tag}, the Beat tab's head reads the clip's name (${Math.round(head.nameW)} px) and "${head.by?.trim()}" whole, every tool in the bar (${JSON.stringify(head)})`,
    );
    t.ok(!perr11.length, `${tag}: no page errors${perr11.length ? ': ' + perr11.slice(0, 2).join(' | ') : ''}`);
    await c11.close();
  }

  /* ---- 12. in key and on the grid by default; Esc hands the keys back */
  {
    const c12 = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
    const pg = await c12.newPage();
    const perr12 = [];
    pg.on('pageerror', (e) => perr12.push(String(e)));
    await pg.goto(url.replace(/\?.*$/, ''));
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const P = (fn, a) => pg.evaluate(fn, a);
    await P(async () => {
      const app = window.overdub;
      await app.exporter.newSong();
      await app.engine.start();
      for (const x of document.querySelectorAll('.ew-toast')) x.remove();
    });
    await P(() => window.overdub.onboard.keysOver()); // Keys, musical typing on, the 2-bar loop playing
    await pg.waitForTimeout(400);
    // (fresh eyes 5: the producer's notes moved and nothing on screen said so; the docked strip's line does, where the
    // chips "Scale lock" and "My timing" were)
    const seeLine = (sel) =>
      P((sel) => {
        const s = document.querySelector(sel),
          r = s?.getBoundingClientRect(),
          hit =
            r && r.width ? document.elementFromPoint(r.left + Math.min(24, r.width / 2), r.top + r.height / 2) : null;
        return {
          line: s ? s.textContent.replace(/\s+/g, ' ').trim() : '',
          docked: !!s?.closest('.sk-qwdock .ew-qw.docked'),
          on: !!r && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && !!hit && s.contains(hit),
          st: window.overdub.input.recorder.state,
        };
      }, sel);
    const lock = await P(() => {
      const a = window.overdub,
        q = a.input.qwerty;
      return {
        lock: q.scaleLock,
        quant: q.quantize,
        key: a.store.get().key,
        chips: [...document.querySelectorAll('.sk-opts .sk-chip')].map((c) => c.textContent),
      };
    });
    const dl = await seeLine('.ew-qw .ew-snap');
    t.ok(
      lock.lock &&
        lock.quant &&
        lock.key &&
        dl.docked &&
        dl.on &&
        dl.line === 'Snapping to 1/16, in C minor' &&
        !lock.chips.length,
      `a first visit: the grid and Scale lock are on for the keys, and the docked strip's line says so: "${dl.line}" (docked ${dl.docked}, in view ${dl.on}; ${lock.key?.root} ${lock.key?.scale}; no chips beside it: ${lock.chips.join(', ') || 'none'})`,
    );
    await P(() => {
      window.__on = [];
      const e = window.overdub.engine,
        on = e.liveNoteOn.bind(e);
      e.liveNoteOn = (t, p, v) => {
        window.__on.push(p);
        return on(t, p, v);
      };
    });
    // a take with R: eight keys, a little off the beat
    await pg.keyboard.press('KeyR');
    // (R while the loop plays counts in a whole bar, and waits for the loop's top when that is at most a bar more)
    for (let i = 0; i < 160 && (await P(() => window.overdub.input.recorder.state)) !== 'rec'; i++)
      await pg.waitForTimeout(50);
    // (a pass recorded with R is snapped as it records: the line stays in view, saying so, while it does)
    const rl = await seeLine('.ew-qw .ew-snap');
    t.ok(
      rl.st === 'rec' && rl.docked && rl.on && rl.line === 'Snapping to 1/16, in C minor',
      `while R records, the line stays in view over the keys: "${rl.line}" (${rl.st}, in view ${rl.on})`,
    );
    for (const k of ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK']) {
      await pg.keyboard.down(k);
      await pg.waitForTimeout(90 + Math.round(Math.random() * 60));
      await pg.keyboard.up(k);
      await pg.waitForTimeout(70 + Math.round(Math.random() * 80));
    }
    await pg.keyboard.press('Space');
    for (let i = 0; i < 40 && (await P(() => window.overdub.input.recorder.state)) !== 'idle'; i++)
      await pg.waitForTimeout(100);
    const took = await P(() => {
      const a = window.overdub,
        key = a.store.get().key,
        pcs = new Set(a.music.scalePcs(key));
      const t = a.store.get().tracks.find((x) => x.name === 'Keys'),
        notes = t.clips.flatMap((c) => c.notes.map((n) => ({ p: n.p, t: c.start + n.t, d: n.d })));
      const ph = a.input.capture.list({ all: true }).find((p) => p.rec && p.kind === 'notes');
      return {
        played: window.__on,
        inKey: window.__on.every((p) => pcs.has(p % 12)),
        n: notes.length,
        onGrid: notes.every(
          (n) => Math.abs(n.t * 4 - Math.round(n.t * 4)) < 1e-6 && Math.abs(n.d * 4 - Math.round(n.d * 4)) < 1e-6,
        ),
        raw: (ph?.raw || []).some((r) => Math.abs(r * 4 - Math.round(r * 4)) > 0.02),
      };
    });
    t.ok(
      took.played.length === 8 && took.inKey,
      `with Scale lock on, every key plays the song's key (MIDI ${took.played.join(', ')})`,
    );
    t.ok(
      took.n >= 6 && took.onGrid && took.raw,
      `the take with R lands on the 1/16 grid (${took.n} notes, starts and lengths on it), the timing as played kept beside it`,
    );
    // Esc with a clip selected: musical typing goes off first (S was a D4 while it was on; off, S solos the track, as in
    // Logic), and the bar's lamp says Esc
    const lamp = await P(() => document.querySelector('.tp-hold')?.textContent || '');
    await P(() => {
      const a = window.overdub,
        t = a.store.get().tracks.find((x) => x.name === 'Keys');
      a.ui.select({ track: t.id, clip: t.clips[0].id });
      a.ui.state.focus = 'arranger';
      a.engine.stop();
    });
    await pg.keyboard.press('Backquote'); // (on again: keysOver lent it, the stop may have let it go)
    if (!(await P(() => window.overdub.input.qwerty.on))) await pg.keyboard.press('Backquote');
    // first a menu open: Esc closes it and the keys stay
    await P(() => document.querySelector('.sk-idea .sk-keep')?.click());
    await pg.waitForTimeout(100);
    const menuOpen = await P(() => !!document.querySelector('.sk-menu'));
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(100);
    const afterMenu = await P(() => ({
      menu: !!document.querySelector('.sk-menu'),
      on: window.overdub.input.qwerty.on,
    }));
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(150);
    const esc = await P(() => ({
      on: window.overdub.input.qwerty.on,
      lamp: !document.querySelector('.tp-hold') || document.querySelector('.tp-hold').hidden,
      sel: window.overdub.ui.state.selection.clip,
    }));
    const n0 = await P(() => window.__on.length);
    await pg.keyboard.press('KeyS');
    await pg.waitForTimeout(150);
    const n1 = await P(() => window.__on.length);
    t.ok(/Esc to stop/.test(lamp), `the top bar's lamp says how to hand the keys back ("${lamp}")`);
    t.ok(
      menuOpen && !afterMenu.menu && afterMenu.on,
      `Esc closes an open menu first, and the keys stay musical (${JSON.stringify(afterMenu)})`,
    );
    t.ok(
      !esc.on && esc.lamp && !!esc.sel && n1 === n0,
      `then Esc turns musical typing off, ahead of clearing the selection, the lamp goes, and S plays nothing (${JSON.stringify(esc)}, notes ${n0}→${n1})`,
    );
    // scale lock off: the keys out of the key are dimmed on the strip; the choice is kept
    await P(() => {
      const q = window.overdub.input.qwerty;
      q.setScaleLock(false);
      q.toggle(true);
    });
    await pg.waitForTimeout(100);
    const dim = await P(() => ({
      out: [...document.querySelectorAll('.ew-qw-k.out')].map((k) => k.querySelector('small').textContent),
      all: [...document.querySelectorAll('.ew-qw-k small')].map((x) => x.textContent).filter(Boolean),
      saved: JSON.parse(localStorage.getItem('overdub:qwerty') || '{}'),
    }));
    await P(() => {
      const q = window.overdub.input.qwerty;
      q.toggle(false);
      q.setScaleLock(true);
    });
    t.ok(
      dim.out.length >= 3 &&
        dim.out.every((n) => /^(Db|E|Gb|A|B)\d/.test(n)) &&
        dim.saved.lockSet === true &&
        dim.saved.scaleLock === false,
      `Scale lock off: the strip dims the keys outside C minor (${dim.out.join(' ')}), spelled for it, and the choice is kept`,
    );
    // every key spelled for the song's key, as the piano roll spells it: C minor's Eb, Ab, Bb, never D#, G#, A#
    t.ok(
      ['Eb', 'Ab', 'Bb'].every((x) => dim.all.some((n) => n.startsWith(x))) && !dim.all.some((n) => /#/.test(n)),
      `musical typing spells C minor's notes Eb, Ab and Bb, never D# G# A# (${dim.all.join(' ')})`,
    );
    // a phrase played free (no song running) is kept on the grid too
    const free = await P(async () => {
      const a = window.overdub,
        wait = (ms) => new Promise((r) => setTimeout(r, ms)),
        q = a.input.qwerty;
      a.engine.stop();
      q.toggle(true);
      for (const [code, ms] of [
        ['KeyA', 130],
        ['KeyD', 210],
        ['KeyG', 170],
      ]) {
        q.press(code);
        await wait(90);
        q.release(code);
        await wait(ms);
      }
      q.toggle(false);
      a.input.capture.flush();
      await wait(50);
      const ph = a.input.capture.list({ all: true }).find((p) => p.src === 'qwerty' && !p.rec),
        pn = a.input.capture.phraseNotes(ph.id);
      return { snap: ph.snap, ts: pn.notes.map((n) => n.t), raw: ph.notes.map((n) => n.t) };
    });
    t.ok(
      free.snap === 0.25 &&
        free.ts.every((x) => Math.abs(x * 4 - Math.round(x * 4)) < 1e-6) &&
        free.raw.some((x) => Math.abs(x * 4 - Math.round(x * 4)) > 0.02),
      `played free, the phrase is kept on the grid (${free.ts.join(', ')}), as played underneath (${free.raw.join(', ')})`,
    );
    t.ok(!perr12.length, `no page errors${perr12.length ? ': ' + perr12.slice(0, 2).join(' | ') : ''}`);
    await c12.close();
  }

  /* ---- 12b. the line's two parts: each click turns its helper off, says what's on instead and is announced, and the
     choice is kept across a reload; the strip floating (Sketch hidden) and docked; R recording with it floating; no key
     in the song; the grid as the arranger names it; a keyboard keeps its focus on the part it pressed */
  {
    const cb = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
    const pg = await cb.newPage();
    const perrb = [];
    pg.on('pageerror', (e) => perrb.push(String(e)));
    await pg.goto(url);
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const P = (fn, a) => pg.evaluate(fn, a);
    const ready = async () => {
      await P(async () => {
        const a = window.overdub;
        await a.engine.start();
        document.querySelector('.ar-welcome-x')?.click();
        a.onboard?.stop?.();
        for (const x of document.querySelectorAll('.ew-toast')) x.remove();
        a.ui.setOpen?.('bottom', true);
        a.ui.show('mixer');
      });
      await pg.waitForTimeout(250);
    };
    await ready();
    const look = () =>
      P(() => {
        const s = document.querySelector('.ew-qw:not([hidden]) .ew-snap'),
          r = s?.getBoundingClientRect(),
          hit =
            r && r.width ? document.elementFromPoint(r.left + Math.min(24, r.width / 2), r.top + r.height / 2) : null;
        const q = window.overdub.input.qwerty;
        let saved = {};
        try {
          saved = JSON.parse(localStorage.getItem('overdub:qwerty') || '{}');
        } catch (e) {
          /* none */
        }
        return {
          line: s ? s.textContent.replace(/\s+/g, ' ').trim() : '',
          floating: !!s && !s.closest('.ew-qw.docked'),
          on: !!r && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && !!hit && s.contains(hit),
          grid: s?.querySelector('.ew-snap-grid')?.dataset.on,
          key: s?.querySelector('.ew-snap-key')?.dataset.on,
          q: { quantize: q.quantize, scaleLock: q.scaleLock },
          saved: { quantize: saved.quantize, scaleLock: saved.scaleLock },
          said: document.querySelector('.ew-announce')?.textContent || '',
        };
      });
    await pg.keyboard.press('Backquote');
    await pg.waitForTimeout(250);
    const f0 = await look();
    t.ok(
      f0.floating && f0.on && f0.line === 'Snapping to 1/16, in A minor' && f0.grid === 'true' && f0.key === 'true',
      `floating (Sketch hidden), the strip's line says what the keys do: "${f0.line}" (in view ${f0.on})`,
    );
    await pg.click('.ew-qw .ew-snap-grid', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(150);
    const f1 = await look();
    await pg.click('.ew-qw .ew-snap-key', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(150);
    const f2 = await look();
    t.ok(
      f1.line === 'Your timing, in A minor' &&
        !f1.q.quantize &&
        f1.q.scaleLock &&
        f1.saved.quantize === false &&
        f1.grid === 'false' &&
        /^Your timing: nothing snaps to the grid$/.test(f1.said),
      `a click on "Snapping to 1/16" turns the grid off: "${f1.line}", announced ("${f1.said}"), kept (${JSON.stringify(f1.saved)})`,
    );
    t.ok(
      f2.line === 'Your timing, every note' &&
        !f2.q.scaleLock &&
        f2.saved.scaleLock === false &&
        f2.key === 'false' &&
        /^Every note: Scale lock off$/.test(f2.said),
      `a click on "in A minor" turns Scale lock off: "${f2.line}", announced ("${f2.said}"), kept (${JSON.stringify(f2.saved)})`,
    );
    // a reload: both still off, and the line says so
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await ready();
    await pg.keyboard.press('Backquote');
    await pg.waitForTimeout(250);
    const f3 = await look();
    t.ok(
      f3.line === 'Your timing, every note' && !f3.q.quantize && !f3.q.scaleLock && f3.on,
      `after a reload both are still off, and the line says so: "${f3.line}"`,
    );
    // again: back on, announced
    await pg.click('.ew-qw .ew-snap-grid', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(120);
    const f4a = await look();
    await pg.click('.ew-qw .ew-snap-key', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(150);
    const f4 = await look();
    t.ok(
      f4.line === 'Snapping to 1/16, in A minor' &&
        f4.q.quantize &&
        f4.q.scaleLock &&
        f4.saved.quantize === true &&
        f4.saved.scaleLock === true &&
        /^Snapping to 1\/16: the keys land on the grid$/.test(f4a.said) &&
        /^In A minor: Scale lock on$/.test(f4.said),
      `a click again turns each back on: "${f4.line}" ("${f4a.said}", "${f4.said}")`,
    );
    // R with the strip floating: the line stays in view while it records
    await P(() => {
      const a = window.overdub;
      a.input.recorder.setCountIn(0);
      a.engine.seek(0);
    });
    await pg.keyboard.press('KeyR');
    for (let i = 0; i < 60 && (await P(() => window.overdub.input.recorder.state)) !== 'rec'; i++)
      await pg.waitForTimeout(50);
    await pg.waitForTimeout(300);
    const fr = { ...(await look()), st: await P(() => window.overdub.input.recorder.state) };
    await pg.keyboard.press('KeyR');
    for (let i = 0; i < 60 && (await P(() => window.overdub.input.recorder.state)) !== 'idle'; i++)
      await pg.waitForTimeout(50);
    await P(() => {
      const a = window.overdub;
      a.engine.stop();
      while (a.store.canUndo()) a.store.undo();
    });
    t.ok(
      fr.st === 'rec' && fr.floating && fr.on && fr.line === 'Snapping to 1/16, in A minor',
      `while R records with the strip floating, the line stays in view: "${fr.line}" (${fr.st}, in view ${fr.on})`,
    );
    // no key in the song: it says what Scale lock plays instead
    await P(() => {
      const a = window.overdub;
      a.store.dispatch({ type: 'project.set', patch: { key: null } }, { by: 'you', label: 'no key' });
    });
    await pg.waitForTimeout(150);
    const nk = await look();
    await P(() => window.overdub.store.undo());
    // the grid as the arranger names it (Hum it's and Tap it's grid is the keys' grid too)
    const gridLine = (g) =>
      P(async (g) => {
        const a = window.overdub,
          q = a.input.qwerty;
        a.input.options.grid = g;
        q.toggle(false);
        q.toggle(true);
        await new Promise((r) => setTimeout(r, 80));
        return document.querySelector('.ew-qw .ew-snap-grid')?.textContent || '';
      }, g);
    const g8 = await gridLine(0.5),
      g8t = await gridLine(1 / 3);
    await gridLine(0.25);
    t.ok(
      nk.line === 'Snapping to 1/16, in C major, no key set' && g8 === 'Snapping to 1/8' && g8t === 'Snapping to 1/8T',
      `with no key, it says what Scale lock plays: "${nk.line}"; the grid named as the arranger names it: "${g8}", "${g8t}"`,
    );
    // the keyboard: Enter on a part turns it off and the focus stays on it (the strip repaints around it)
    await pg.focus('.ew-qw .ew-snap-grid', { timeout: 3000 }).catch(() => {});
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(120);
    const kf = await P(() => ({
      focus: document.activeElement?.classList.contains('ew-snap-grid'),
      text: (document.activeElement?.textContent || '').trim().slice(0, 40),
      quantize: window.overdub.input.qwerty.quantize,
    }));
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(120);
    const kf2 = await P(() => ({
      focus: document.activeElement?.classList.contains('ew-snap-grid'),
      quantize: window.overdub.input.qwerty.quantize,
    }));
    t.ok(
      kf.focus && kf.text === 'Your timing' && !kf.quantize && kf2.focus && kf2.quantize,
      `from the keyboard: Enter on a part turns it off and back on, the focus staying on it (${JSON.stringify([kf, kf2])})`,
    );
    // docked in Play it: the same line, the same clicks
    await pg.keyboard.press('Backquote');
    await P(() => {
      const a = window.overdub;
      a.ui.show('sketch');
      a.input.emit('sketch:mode', 'play');
    });
    await pg.waitForTimeout(200);
    await pg.keyboard.press('Backquote');
    await pg.waitForTimeout(250);
    const d0 = await P(() => {
      const s = document.querySelector('.ew-qw .ew-snap'),
        r = s?.getBoundingClientRect();
      return {
        line: s ? s.textContent.replace(/\s+/g, ' ').trim() : '',
        docked: !!s?.closest('.sk-qwdock .ew-qw.docked'),
        shown: !!r && r.width > 0 && getComputedStyle(s).display !== 'none',
      };
    });
    await pg.click('.ew-qw.docked .ew-snap-key', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(150);
    const d1 = await P(() => ({
      line: (document.querySelector('.ew-qw .ew-snap')?.textContent || '').replace(/\s+/g, ' ').trim(),
      lock: window.overdub.input.qwerty.scaleLock,
    }));
    await pg.click('.ew-qw.docked .ew-snap-key', { timeout: 3000 }).catch(() => {});
    t.ok(
      d0.docked &&
        d0.shown &&
        d0.line === 'Snapping to 1/16, in A minor' &&
        d1.line === 'Snapping to 1/16, every note' &&
        !d1.lock,
      `docked in Play it, the line shows and clicks the same: "${d0.line}", then "${d1.line}"`,
    );
    await pg.screenshot({ path: new URL('./.out/sketch-line-docked.png', import.meta.url).pathname });
    t.ok(!perrb.length, `the line: no page errors${perrb.length ? ': ' + perrb.slice(0, 2).join(' | ') : ''}`);
    await cb.close();
  }

  /* ---- 13. a phone's keys: in key by default; Scale lock off gives every note, the ones out of the key dimmed */
  {
    const c13 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      permissions: ['microphone'],
    });
    const pg = await c13.newPage();
    await pg.goto(url.replace(/\?.*$/, ''));
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const P = (fn, a) => pg.evaluate(fn, a);
    await P(async () => {
      const app = window.overdub;
      await app.exporter.newSong();
      await app.engine.start();
      for (const x of document.querySelectorAll('.ew-toast')) x.remove();
    });
    await P(() => window.overdub.onboard.keysOver());
    await pg.waitForTimeout(400);
    // what's over the keys: the line (musical typing's), in view where a finger is, and each part's reach to a finger
    const keysOf = () =>
      P(() => {
        const s = document.querySelector('.sk-tk-bar .ew-snap'),
          r = s?.getBoundingClientRect(),
          sc = document.querySelector('.sk-scroll')?.getBoundingClientRect(),
          foot = document.querySelector('[data-panel="sketch"] .sk-foot')?.getBoundingClientRect();
        const hit =
          r && r.width ? document.elementFromPoint(r.left + Math.min(24, r.width / 2), r.top + r.height / 2) : null;
        const reach = [...(s?.querySelectorAll('.ew-snap-p') || [])].map((b) => {
          const q = b.getBoundingClientRect(),
            x = q.left + q.width / 2,
            y = q.top + q.height / 2;
          return [y - 19, y + 19].every((yy) => {
            const e = document.elementFromPoint(x, yy);
            return !!e && (e === b || b.contains(e));
          });
        });
        return {
          ps: [...document.querySelectorAll('.sk-tk-k')].map((k) => +k.dataset.p),
          out: document.querySelectorAll('.sk-tk-k.out').length,
          chips: document.querySelectorAll('.sk-opts .sk-chip').length,
          line: s ? s.textContent.replace(/\s+/g, ' ').trim() : '',
          inBar: !!s?.closest('.sk-tk-bar'),
          on:
            !!r &&
            r.width > 0 &&
            r.top >= (sc ? sc.top : 0) - 0.5 &&
            r.bottom <= Math.min(innerHeight, foot && foot.top > r.top ? foot.top : innerHeight) + 0.5 &&
            !!hit &&
            s.contains(hit),
          reach,
          q: { quantize: window.overdub.input.qwerty.quantize, scaleLock: window.overdub.input.qwerty.scaleLock },
          pcs: window.overdub.music.scalePcs(window.overdub.store.get().key),
        };
      });
    const k1 = await keysOf();
    await pg.tap('.sk-tk-bar .ew-snap-key', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(200);
    const k2 = await keysOf();
    t.ok(
      k1.inBar &&
        k1.on &&
        k1.line === 'Snapping to 1/16, in C minor' &&
        !k1.chips &&
        k1.ps.length === 8 &&
        k1.ps.every((p) => k1.pcs.includes(p % 12)) &&
        !k1.out,
      `phone: the keys are an octave of the song's key, and the line over them says what they do: "${k1.line}" (${k1.ps.join(' ')})`,
    );
    t.ok(
      k2.ps.length === 13 && k2.out === 5 && k2.line === 'Snapping to 1/16, every note' && !k2.q.scaleLock,
      `phone: a tap on "in C minor" turns Scale lock off: every note of the octave, the five out of the key dimmed (${k2.ps.length} keys, ${k2.out} dimmed), and the line says "${k2.line}"`,
    );
    await pg.tap('.sk-tk-bar .ew-snap-grid', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(200);
    const k3 = await keysOf();
    t.ok(
      k3.line === 'Your timing, every note' &&
        !k3.q.quantize &&
        k3.reach.length === 2 &&
        k3.reach.every(Boolean) &&
        k1.reach.every(Boolean),
      `phone: a tap on "Snapping to 1/16" keeps your timing ("${k3.line}"), and each part is 40 px to a finger (${JSON.stringify(k3.reach)})`,
    );
    await pg.screenshot({ path: new URL('./.out/sketch-line-phone.png', import.meta.url).pathname });
    // kept across a reload
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await P(() => {
      const a = window.overdub;
      a.onboard?.stop?.();
      a.ui.setOpen('bottom', true);
      a.ui.show('sketch');
      a.input.emit('sketch:mode', 'play');
    });
    await pg.waitForTimeout(400);
    const k4 = await keysOf();
    t.ok(
      k4.line === 'Your timing, every note' && k4.ps.length === 13 && !k4.q.quantize && !k4.q.scaleLock,
      `phone: after a reload, still "${k4.line}", every note on the keys`,
    );
    // both back on, then a take: the line stays in view over the keys while it records
    await pg.tap('.sk-tk-bar .ew-snap-key', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(150);
    await pg.tap('.sk-tk-bar .ew-snap-grid', { timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(150);
    await P(async () => {
      const a = window.overdub;
      await a.engine.start();
      a.input.recorder.setCountIn(0);
      a.engine.seek(0);
    });
    await pg.tap('[data-panel="sketch"] .sk-recbtn');
    for (let i = 0; i < 60 && (await P(() => window.overdub.input.recorder.state)) !== 'rec'; i++)
      await pg.waitForTimeout(50);
    await pg.waitForTimeout(250);
    const k5 = { ...(await keysOf()), st: await P(() => window.overdub.input.recorder.state) };
    await pg.screenshot({ path: new URL('./.out/sketch-line-phone-rec.png', import.meta.url).pathname });
    await pg.tap('[data-panel="sketch"] .sk-recbtn');
    for (let i = 0; i < 60 && (await P(() => window.overdub.input.recorder.state)) !== 'idle'; i++)
      await pg.waitForTimeout(50);
    t.ok(
      k5.st === 'rec' && k5.on && k5.line === 'Snapping to 1/16, in C minor',
      `phone: while a take records, the line stays in view over the keys: "${k5.line}" (${k5.st}, in view ${k5.on})`,
    );
    await c13.close();
  }

  /* ---- 14. fresh eyes 5, a phone: Sketch opens with the ways in and "Allow the mic and hum" in view; after a hum the
     pinned row is still one row (it grew to three and hid the dial and the line saying what the hum became), nothing
     runs off its right edge, and Keep goes where Record's picker says (one picker, not two); a short song is still
     offered 8 bars after a 3-bar hum */
  {
    const c14 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      permissions: ['microphone'],
    });
    const pg = await c14.newPage();
    const perr14 = [];
    pg.on('pageerror', (e) => perr14.push(String(e)));
    await pg.goto(url.replace(/\?.*$/, ''));
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const P = (fn, a) => pg.evaluate(fn, a);
    // a new song with the first minute's beat (2 bars on Drums); Sketch opened on Hum it, the mic not allowed yet
    await P(async () => {
      const app = window.overdub;
      try {
        localStorage.removeItem('overdub:mic-ok');
        localStorage.setItem('overdub:sketch-mode', 'hum');
      } catch (e) {
        /* ok */
      }
      app.onboard?.stop?.();
      await app.exporter.newSong();
      await app.engine.start();
      for (const x of document.querySelectorAll('.ew-toast')) x.remove();
      const d = app.store.dispatch(
        {
          type: 'track.add',
          ref: 'd',
          track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} } },
        },
        { by: 'you', label: 'add a track' },
      ).created.d;
      app.store.dispatch(
        {
          type: 'clip.add',
          track: d,
          clip: {
            kind: 'notes',
            start: 0,
            length: 8,
            name: 'Tapped beat',
            notes: [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ p: b % 2 ? 38 : 36, t: b, d: 0.25, v: 0.8 })),
          },
        },
        { by: 'you', label: 'tapped beat' },
      );
      app.ui.setOpen('bottom', true);
      app.ui.show('sketch');
    });
    await pg.waitForTimeout(800);
    // what's on screen in the sheet: whole, above the pinned row, and the one a finger there would hit
    const look = () =>
      P(() => {
        const foot = document.querySelector('[data-panel="sketch"] .sk-foot'),
          fr = foot.getBoundingClientRect();
        const sc = document.querySelector('.sk-scroll'),
          vr = sc ? sc.getBoundingClientRect() : { top: 0 };
        const seen = (sel) => {
          const e = [...document.querySelectorAll(sel)].find(
            (x) => x.getClientRects().length && !x.closest('[hidden]'),
          );
          if (!e) return null;
          const r = e.getBoundingClientRect(),
            hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12));
          return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            on:
              r.top >= vr.top - 1 &&
              r.bottom <= fr.top + 1 &&
              r.right <= innerWidth + 0.5 &&
              !!hit &&
              (e.contains(hit) || hit.contains(e)),
          };
        };
        const btns = [...foot.querySelectorAll('button, select')].filter(
          (x) => x.getClientRects().length && !x.closest('[hidden]'),
        );
        const sheet = document.querySelector('[data-panel="sketch"]');
        const offRight = [...sheet.querySelectorAll('button, select')]
          .filter(
            (x) =>
              x.getClientRects().length && !x.closest('[hidden]') && x.getBoundingClientRect().right > innerWidth + 0.5,
          )
          .map((x) => x.textContent.trim());
        const pickers = [...sheet.querySelectorAll('select')].filter(
          (x) => x.getClientRects().length && !x.closest('[hidden]') && getComputedStyle(x).visibility !== 'hidden',
        );
        return {
          rows: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top / 10))).size,
          row: btns.map((b) => (b.tagName === 'SELECT' ? b.selectedOptions[0]?.textContent : b.textContent).trim()),
          modes: seen('.sk-modes'),
          allow: seen('.sk-explain .btn-go'),
          dial: seen('.sk-spiral'),
          line: seen('.sk-take .sk-status'),
          keep: seen('.sk-take .btn-go'),
          keepText: document.querySelector('.sk-take .btn-go')?.innerText.trim(),
          pickers: pickers.map((x) => x.selectedOptions[0]?.textContent),
          offRight,
          sw: document.documentElement.scrollWidth,
        };
      });
    const o14 = await look();
    await pg.screenshot({ path: new URL('./.out/sketch-phone-open.png', import.meta.url).pathname });
    t.ok(
      o14.modes?.on && o14.allow?.on && o14.dial?.on && o14.rows === 1,
      `phone: Sketch opens with the ways in, "Allow the mic and hum" and the dial in view over a one-row pinned row, so Hum's mic prompt never comes before the explanation (${JSON.stringify({ modes: o14.modes, allow: o14.allow, dial: o14.dial, row: o14.row })})`,
    );
    // the tester's tune, hummed over the beat (no key chosen: kept as sung, its key heard)
    await P(async () => {
      const sr = 48000,
        mel = [
          [64, 1],
          [64, 1],
          [67, 1],
          [69, 2],
          [69, 1],
          [67, 1],
          [64, 1],
          [62, 1],
          [64, 2],
        ],
        spb = 0.5;
      let tot = 0.3;
      const sched = mel.map(([m, b]) => {
        const s = { m, t0: tot, t1: tot + b * spb };
        tot += b * spb;
        return s;
      });
      const x = new Float32Array(Math.ceil((tot + 0.4) * sr));
      let ph = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr,
          k = sched.findIndex((s) => t >= s.t0 && t < s.t1);
        let m = 60,
          a = 0;
        if (k >= 0) {
          const s = sched[k],
            into = t - s.t0;
          m = s.m;
          a = 0.3 * Math.min(1, into / 0.03) * Math.min(1, (s.t1 - t) / 0.04 + 0.5);
        }
        ph += (2 * Math.PI * 440 * 2 ** ((m - 69) / 12)) / sr;
        x[i] = a * (Math.sin(ph) + 0.35 * Math.sin(2 * ph));
      }
      await window.overdub.input.hum.fromSamples(x, sr);
    });
    await pg.waitForTimeout(900);
    const h14 = await look();
    await pg.screenshot({ path: new URL('./.out/sketch-phone-hum.png', import.meta.url).pathname });
    t.ok(
      h14.rows === 1 && h14.dial?.on && h14.line?.on && h14.keep?.on && !h14.offRight.length && h14.sw <= 390,
      `phone, after a hum: the pinned row is one row (${h14.row.join(' | ')}), the dial, the line saying what the hum became and Keep are on screen, nothing past the right edge (${JSON.stringify({ dial: h14.dial, line: h14.line, keep: h14.keep, off: h14.offRight })})`,
    );
    t.ok(
      h14.pickers.length === 1 && h14.pickers[0] === 'A new track' && h14.keepText === 'Keep on a new track',
      `phone: one track picker, Record's ("${h14.pickers.join('", "')}"), and Keep says where it goes by it ("${h14.keepText}")`,
    );
    // Keep: onto the picker's track (a new one: a hum's is Melody), and the song (3 bars over a 2-bar beat) is offered 8 bars
    await pg.tap('.sk-take .btn-go');
    await pg.waitForTimeout(300);
    const k14 = await P(() => {
      const a = window.overdub,
        t = a.store.get().tracks.find((x) => x.name === 'Melody'),
        toast = [...document.querySelectorAll('.ew-toast')].pop();
      return {
        device: t?.instrument?.device,
        offer: [...(toast?.querySelectorAll('button') || [])].map((b) => b.textContent),
        plan: a.song.longerPlan({ bars: 8 }),
      };
    });
    t.ok(
      k14.device === 'core.keys' && k14.offer.includes('Make it 8 bars') && k14.plan.ok,
      `phone: Keep puts the hum on a new track, Melody (Lamp Tines), as the picker said, and the toast still offers "Make it 8 bars" over a 3-bar song (${JSON.stringify({ device: k14.device, offer: k14.offer, plan: k14.plan.summary || k14.plan.error })})`,
    );
    const m14 = await P(() => {
      const a = window.overdub,
        b = [...document.querySelectorAll('.ew-toast button')].find((x) => x.textContent === 'Make it 8 bars');
      b?.click();
      const ts = a.store.get().tracks;
      const span = (t) =>
        t.clips
          .filter((c) => !c.mute)
          .map((c) => `${c.start}+${c.length}`)
          .join(',');
      return {
        drums: span(ts.find((x) => x.name === 'Drums')),
        hum: span(ts.find((x) => x.name === 'Melody')),
        toast: [...document.querySelectorAll('.ew-toast')]
          .map((x) => x.querySelector('.ew-toast-text')?.textContent || '')
          .pop(),
      };
    });
    t.ok(
      m14.drums === '0+8,8+8,16+8,24+8' &&
        m14.hum === '0+12,16+12' &&
        /^It’s 8 bars now: Drums plays 4 times and Melody twice, bars 1–8\./.test(m14.toast),
      `"Make it 8 bars": the beat four times under all of it, the 3-bar hum on each 4-bar phrase (Drums ${m14.drums}; Melody ${m14.hum}; "${m14.toast}")`,
    );
    t.ok(!perr14.length, `phone: no page errors${perr14.length ? ': ' + perr14.slice(0, 2).join(' | ') : ''}`);
    await c14.close();
  }

  /* ---- 15. the hum dial spells the key (C minor: Eb Ab Bb, as the piano roll does, never D# G# A#) */
  {
    const said = await E(async () => {
      const a = window.overdub,
        drawn = new Set(),
        orig = CanvasRenderingContext2D.prototype.fillText;
      a.store.dispatch(
        { type: 'project.set', patch: { key: { root: 'C', scale: 'minor' } } },
        { by: 'you', label: 'key C minor' },
      );
      a.ui.show('sketch');
      a.input.emit('sketch:mode', 'tap');
      a.input.emit('sketch:mode', 'hum');
      CanvasRenderingContext2D.prototype.fillText = function (s, ...r) {
        if (this.canvas.closest?.('.ew-spiral')) drawn.add(String(s));
        return orig.call(this, s, ...r);
      };
      await new Promise((r) => setTimeout(r, 400));
      CanvasRenderingContext2D.prototype.fillText = orig;
      a.store.undo();
      return [...drawn];
    });
    t.ok(
      ['Eb', 'Ab', 'Bb'].every((x) => said.includes(x)) && !said.some((x) => /^(D#|G#|A#)/.test(x)),
      `the hum dial spells C minor's notes Eb, Ab and Bb, never D# G# A# (${said.join(' ')})`,
    );
  }

  /* ---- 16. a new idea is a new track (docs/INSTRUMENTS-UX.md 2.1, 2.2, 2.7): the keep select, the sound card's place
     and its Keep, Tap it after a beat, the Beatbox catch. The sound card itself (ui/sounds.js) is stood in for here by
     a stub that records what Sketch asks of it */
  {
    await page.setViewportSize({ width: 1440, height: 900 });
    await E(() => {
      const a = window.overdub,
        log = (window.__snd = { offers: [], backs: [], host: null, trying: null });
      a.sounds = {
        setHost: (fn) => {
          log.host = fn;
        },
        offer: (o) => {
          log.offers.push(o);
          return { ok: true };
        },
        trying: () => log.trying,
        back: (o) => {
          log.backs.push(o || {});
          log.trying = null;
          return true;
        },
        keep: () => null,
        keepIfTrying: () => false,
      };
      for (const x of document.querySelectorAll('.ew-toast')) x.remove();
      a.ui.show('sketch');
      a.input.emit('sketch:mode', 'tap');
      a.input.emit('sketch:mode', 'hum');
    });
    const hum16 = async () =>
      E(async () => {
        const sr = 48000,
          ps = [60, 64, 67, 69, 67, 64],
          seg = 0.4,
          x = new Float32Array(Math.round(sr * seg * ps.length + sr * 0.3));
        let ph = 0;
        ps.forEach((p, i) => {
          const f = 440 * 2 ** ((p - 69) / 12);
          for (let n = 0; n < sr * seg * 0.9; n++) {
            ph += (2 * Math.PI * f) / sr;
            x[Math.round(i * seg * sr) + n] = 0.3 * Math.sin(ph) + 0.1 * Math.sin(2 * ph);
          }
        });
        await window.overdub.input.hum.fromSamples(x, sr);
      });
    await hum16();
    await page.waitForTimeout(300);
    const k16 = await E(() => {
      const s = document.querySelector('[data-panel="sketch"] .sk-acts .sk-destwrap select'),
        log = window.__snd,
        h = log.host && log.host({});
      return {
        opts: s ? [...s.options].map((o) => o.textContent) : [],
        value: s?.selectedOptions[0]?.textContent,
        host: !h,
        keepTake: typeof window.overdub.sketch?.keepTake === 'function',
        offer: log.offers[log.offers.length - 1] || null,
        cap: window.overdub.input.hum.take?.capture,
        sounds: !!document.querySelector('.sk-acts .sk-sounds:not([hidden])'),
      };
    });
    t.ok(
      k16.opts[0] === 'A new track' &&
        k16.opts.length > 1 &&
        k16.opts.slice(1).every((o) => /^On /.test(o)) &&
        !k16.opts.some((o) => /Pluck|On Drums/.test(o)),
      `a hum's keep select: "A new track" first, then the pitched tracks, no instrument in it ("${k16.opts.join('", "')}", now "${k16.value}")`,
    );
    // (on a computer the stage is a strip too short for the card's rows: it floats by the track's header instead, with
    // a Keep of its own for the take, app.sketch.keepTake; only the phone's split sheet hosts it)
    t.ok(
      k16.host && k16.keepTake && k16.offer?.from === 'take' && k16.offer?.take?.capture === k16.cap && k16.sounds,
      `on a computer Sketch doesn't host the sound card (it floats, its Keep keeps the take: app.sketch.keepTake) and offers it the take before Keep, with Sounds on the take line (${JSON.stringify(k16.offer && { track: k16.offer.track, from: k16.offer.from, take: k16.offer.take })})`,
    );
    // the card trying Light Table on the take's new track: the take's Keep makes the track with it, one undo step
    const n0 = await E(() => window.overdub.store.history.length);
    await E(() => {
      const s = document.querySelector('[data-panel="sketch"] .sk-acts .sk-destwrap select');
      s.value = 'new';
      s.dispatchEvent(new Event('change'));
      window.__snd.trying = { track: 't_preview', device: 'core.wavetable', newTrack: true, was: 'core.keys' };
    });
    await page.click('[data-panel="sketch"] .sk-acts .btn-go');
    await page.waitForTimeout(300);
    const kept16 = await E((n0) => {
      const a = window.overdub,
        ts = a.store.get().tracks,
        m = ts[ts.length - 1];
      return {
        name: m.name,
        device: m.instrument?.device,
        clips: m.clips.length,
        steps: a.store.history.length - n0,
        backs: window.__snd.backs,
        offer: window.__snd.offers[window.__snd.offers.length - 1],
      };
    }, n0);
    t.ok(
      /^Melody( \d+)?$/.test(kept16.name) &&
        kept16.device === 'core.wavetable' &&
        kept16.clips === 1 &&
        kept16.steps >= 1 &&
        kept16.backs.some((b) => b.why === 'kept') &&
        kept16.offer?.track &&
        kept16.offer.take?.kept,
      `the take's Keep carries the sound on trial: a new track, ${kept16.name}, on ${kept16.device}, with the take (the preview let go first; the card offered the new track after)`,
    );
    for (let i = 0; i < kept16.steps; i++) await E(() => window.overdub.store.undo());
    // Tap it: its mic button says what it is; a beat in the song ends its take line "Hum a tune over it?"
    await E(() => {
      const c = window.overdub.input.capture;
      c.add({
        src: 'tap',
        kind: 'drums',
        notes: [
          { p: 36, t: 0, d: 0.25, v: 0.8 },
          { p: 38, t: 1, d: 0.25, v: 0.8 },
          { p: 36, t: 2, d: 0.25, v: 0.8 },
        ],
        tempo: 92,
      });
      window.overdub.input.emit('sketch:mode', 'hum');
      window.overdub.input.emit('sketch:mode', 'tap');
    });
    await page.waitForTimeout(200);
    await page.click('[data-panel="sketch"] .sk-capline .btn-go');
    await page.waitForTimeout(300);
    const t16 = await E(() => {
      const o = document.querySelector('.sk-over');
      return {
        bb: document.querySelector('.sk-bb')?.title,
        over: o && !o.hidden && o.getClientRects().length ? o.textContent : null,
      };
    });
    t.ok(
      t16.bb === 'Beatbox: the mic as drums. To hum a tune, use Hum it.' &&
        t16.over === 'Hum a tune over it? Hum over it',
      `Tap it: Beatbox's title says it's the mic as drums ("${t16.bb}"); a beat in the song ends the take line "${t16.over}"`,
    );
    // the Beatbox catch: a beatbox that sounded like a tune asks, Keep the beat focused (Enter keeps the beat); Make it a
    // melody puts its notes on a new track
    await E(() => {
      const a = window.overdub,
        tap = a.input.tap,
        on0 = tap.on;
      tap.on = function (k, fn) {
        if (k === 'tune') window.__tune = fn;
        return on0.call(this, k, fn);
      };
      a.input.emit('sketch:mode', 'hum');
      a.input.emit('sketch:mode', 'tap');
      tap.on = on0;
    });
    const segs = [60, 64, 67, 69, 67, 64, 62].map((m, i) => ({
      t0: i * 0.4,
      t1: i * 0.4 + 0.35,
      midi: m + 0.1,
      conf: 0.9,
      db: -18,
      cents: 10,
    }));
    const fire = () => E((sg) => window.__tune?.({ segs: sg }), segs);
    await fire();
    await page.waitForTimeout(200);
    const c16 = await E(() => {
      const el = document.querySelector('.sk-catch');
      return el && !el.hidden
        ? {
            text: el.querySelector('.sk-catch-l')?.textContent,
            btns: [...el.querySelectorAll('button')].map((b) => b.textContent),
            focus: document.activeElement?.textContent,
            tracks: window.overdub.store.get().tracks.length,
          }
        : null;
    });
    t.ok(
      c16 &&
        c16.text === 'That sounded like a tune: 7 notes. Keep it as a melody?' &&
        c16.btns.join() === 'Keep the beat,Make it a melody' &&
        c16.focus === 'Keep the beat',
      `the Beatbox catch: "${c16?.text}" with ${c16?.btns.join(' and ')}, Keep the beat focused`,
    );
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const e16 = await E(() => ({
      shown: !document.querySelector('.sk-catch')?.hidden,
      tracks: window.overdub.store.get().tracks.length,
    }));
    t.ok(
      !e16.shown && e16.tracks === c16?.tracks,
      `Enter keeps the beat: the offer goes and nothing is added (${e16.tracks} tracks)`,
    );
    await fire();
    await page.waitForTimeout(200);
    const h0 = await E(() => window.overdub.store.history.length);
    await page.click('.sk-catch .sk-melody');
    await page.waitForTimeout(300);
    const m16 = await E((h0) => {
      const a = window.overdub,
        ts = a.store.get().tracks,
        m = ts[ts.length - 1];
      return {
        name: m.name,
        notes: m.clips.reduce((n, c) => n + c.notes.length, 0),
        steps: a.store.history.length - h0,
        take: !!a.input.capture.list({ all: true }).find((p) => p.src === 'hum' && p.label === 'From the beatbox'),
      };
    }, h0);
    t.ok(
      /^Melody( \d+)?$/.test(m16.name) && m16.notes === 7 && m16.take,
      `Make it a melody: ${m16.notes} notes on a new track, ${m16.name}, and the tune is in Takes too`,
    );
    for (let i = 0; i < m16.steps; i++) await E(() => window.overdub.store.undo());
    await E(() => {
      delete window.overdub.sounds;
    });
  }
} catch (e) {
  t.ok(false, 'threw: ' + ((e && e.stack) || e));
} finally {
  await close();
}

/* ---- 16. capture-timing: forgiving capture, on a blank song in the simple view */
async function blank({ fakeAudio = null } = {}) {
  const s = await open('/app/', { query: 'view=simple&new', width: 1440, height: 900, fakeAudio });
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await s.page.evaluate(async () => {
    await window.overdub.engine.start();
  });
  const ev = (f, a) => s.page.evaluate(f, a);
  // the blank song's door (ui/start.js): Tap a beat with a click is the stage's "Play to a click instead", and Hum it in
  // your own time is Hum a tune's "No beat; I'll hum freely" (Sketch's Hum)
  const VIA = {
    'Tap a beat': ['Tap a beat', 'Play to a click instead'],
    'Hum it': ['Hum a tune', 'No beat; I’ll hum freely'],
  };
  const door = async (label) => {
    const [way, then] = VIA[label] || [label, null];
    await ev(
      (l) =>
        [...document.querySelectorAll('.ar-empty-actions button')].find((b) => b.textContent.trim() === l)?.click(),
      way,
    );
    if (then) {
      await s.page.waitForTimeout(250);
      await ev(
        (l) => [...document.querySelectorAll('.st-stage button')].find((b) => b.textContent.trim() === l)?.click(),
        then,
      );
    }
  };
  const song = () =>
    ev(() => {
      const a = window.overdub,
        p = a.store.get();
      return {
        tempo: p.tempo,
        hist: a.store.history.length,
        labels: a.store.history.map((x) => x.label),
        tracks: p.tracks.map((t) => ({
          name: t.name,
          device: t.instrument?.device,
          clips: t.clips
            .filter((c) => !c.mute)
            .map((c) => ({
              start: c.start,
              length: c.length,
              notes: c.notes.map((n) => ({ p: n.p, t: n.t, d: n.d })),
            })),
        })),
      };
    });
  return { ...s, ev, door, song };
}
const NAME = { 36: 'K', 38: 'S', 42: 'h' },
  KEY = { 36: 'KeyF', 38: 'KeyJ', 42: 'KeyK' };
const notesText = (ns) =>
  ns
    .map((n) => `${NAME[n.p] || n.p}@${n.t}`)
    .sort()
    .join(' ');

// 16a. Tap a beat: the band, a whole count-in, sloppy passes, a miss replaced, one undo, Tight / Loose / As played
{
  const s = await blank();
  const { page, ev, door, song } = s;
  try {
    const spbMs = await ev(() => 60000 / window.overdub.store.get().tempo);
    const untilGrid = async (g) => {
      for (let i = 0; i < 4000; i++) {
        const x = await ev(() => window.overdub.engine.gridBeat ?? -1e9);
        if (x >= g - 0.006) return x;
        await page.waitForTimeout(Math.max(1, Math.min(120, (g - x) * spbMs - 14)));
      }
      return null;
    };
    await door('Tap a beat');
    await page.waitForTimeout(1200);
    // the band: in the stage's head, four lamps (bar 1 wider) you can see from across the room, lit on the beat you hear
    const lamps = [];
    for (let i = 0; i < 6; i++) {
      lamps.push(
        await ev(() => {
          const b = document.querySelector('.sk-band .sk-beats'),
            e = window.overdub.engine,
            r = b?.querySelector('i:not(.one)')?.getBoundingClientRect(),
            one = b?.querySelector('i.one')?.getBoundingClientRect();
          return {
            inHead: !!b?.closest('.sk-head'),
            lit: +b?.dataset.beat,
            want: ((Math.floor(e.beat + 1e-6) % 4) + 4) % 4,
            w: r?.width,
            h: r?.height,
            one: one?.width,
            n: b?.querySelectorAll('i.now').length,
          };
        }),
      );
      await page.waitForTimeout(170);
    }
    t.ok(
      lamps.every((x) => x.inHead && x.h >= 28 && x.w >= 30 && x.one > x.w && x.n === 1) &&
        lamps.filter((x) => x.lit === x.want).length >= 5,
      `the beat where the eyes are: four lamps in Sketch's head, ${Math.round(lamps[0].w)}×${Math.round(lamps[0].h)} px (bar 1 ${Math.round(lamps[0].one)} wide; they were 18×12 at the window's foot), the lit one the beat you hear (${lamps.map((x) => `${x.lit}/${x.want}`).join(' ')})`,
    );
    // R late in bar 2 (3.7 beats in): a whole bar still counts in (it used to be 171 ms here), and the take starts at the
    // 2-bar loop's top (what you play first is bar 1). The numerals count up with the lamps, 1 2 3 4, bright in the
    // count-in's own bar; the beat waited out before it is counted dimmer (it used to show nothing, then 4 3 2 1)
    const base = await ev(() => {
      const e = window.overdub.engine;
      return e.gridBeat - e.beat;
    });
    let gR = base + 7.7;
    const g0n = await ev(() => window.overdub.engine.gridBeat);
    while (gR < g0n + 0.4) gR += 8;
    await untilGrid(gR);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(30);
    const c0 = await ev(() => {
      const L = window.overdub.input.recorder.live(),
        n = document.querySelector('.sk-band .sk-counting');
      return {
        st: L.state,
        left: L.counting?.beats,
        from: L.from,
        num: n?.textContent,
        wait: !!n?.classList.contains('wait'),
        click: window.overdub.engine.click.on,
        line: document.querySelector('.sk-band .sk-where')?.textContent,
      };
    });
    const g0 = (await ev(() => window.overdub.engine.gridBeat)) + c0.left;
    const nums = [];
    let lastLine = '';
    for (let g = g0 - 3.75; g < g0 - 0.2; g += 0.5) {
      await untilGrid(g);
      nums.push(
        await ev(() => {
          const n = document.querySelector('.sk-band .sk-counting');
          return (n?.textContent || '-') + (n?.classList.contains('wait') ? '·' : '');
        }),
      );
    }
    lastLine = await ev(() => document.querySelector('.sk-band .sk-where')?.textContent || '');
    t.ok(
      c0.st === 'count' &&
        c0.left >= 3.75 &&
        c0.click &&
        c0.from === 0 &&
        c0.num === '4' &&
        c0.wait &&
        /loop’s top/.test(c0.line) &&
        nums.join('') === '11223344' &&
        /come in right after the 4/.test(lastLine),
      `R late in bar 2 counts a whole bar with the click (${c0.left.toFixed(2)} beats to the downbeat), from the loop's top (bar ${c0.from / 4 + 1}); the beat waited out is a dim ${c0.num} ("${c0.line}"), then the count goes up with the lamps (${nums.join(' ')}): "${lastLine}"`,
    );
    // two passes, played sloppily: kick 1 3, snare 2 4 (two bars), each hit off by up to ±35 ms and the snares rushed 30 ms;
    // in the first time round the snare on beat 2 is 160 ms late (past what the grid forgives: it lands a sixteenth on), and pass 2 plays it again in time
    const pat = [
      [0, 36],
      [1, 38],
      [2, 36],
      [3, 38],
      [4, 36],
      [5, 38],
      [6, 36],
      [7, 38],
    ];
    const passes = [
      perform(pat, { bpm: 120, bars: 1, bpb: 8, jitter: 0.02, rush: { 38: 0.03 }, start: 0, seed: 3 }),
      perform(pat, { bpm: 120, bars: 1, bpb: 8, jitter: 0.02, rush: { 38: 0.03 }, start: 0, seed: 4 }),
    ];
    passes[0].find((h) => h.want === 1).t += 0.16;
    const plan = [];
    passes.forEach((ps, k) => ps.forEach((h) => plan.push({ g: g0 + k * 8 + h.t / (spbMs / 1000), code: KEY[h.p] })));
    plan.sort((a, b) => a.g - b.g);
    await ev(() => {
      window.__kd = [];
      window.addEventListener(
        'keydown',
        (e) => {
          const en = window.overdub.engine;
          if (!e.repeat) window.__kd.push(en.gridBeat + (en.beatAt(e.timeStamp) - en.beat));
        },
        true,
      );
    });
    // The hits are played in the page, each when the grid the take counts on (beatAt, from the key's timeStamp) reaches
    // it: from here, a poll and a key press a hit landed late enough on a slower machine that a second hit missed and
    // the pass line counted two misses replaced, not one
    await ev(
      async ({ plan, spbMs }) => {
        // (the grid at a time: what beatAt says passed since the audio clock's last step, a loop wrap in between taken out)
        const en = window.overdub.engine,
          lp = window.overdub.store.get().loop,
          len = lp && lp.on ? lp.end - lp.start : 0;
        const gridAt = (ms) => {
          let d = en.beatAt(ms) - en.beat;
          if (len > 0 && Math.abs(d) > len / 2) d -= Math.sign(d) * len;
          return en.gridBeat + d;
        };
        const key = (type, code) =>
          (document.activeElement || document.body).dispatchEvent(
            new KeyboardEvent(type, { code, key: code.slice(3).toLowerCase(), bubbles: true, cancelable: true }),
          );
        for (const x of plan) {
          for (let now = performance.now(), g = gridAt(now); g < x.g; now = performance.now(), g = gridAt(now)) {
            await new Promise((r) => setTimeout(r, Math.min(100, Math.max(0, (x.g - g) * spbMs - 1))));
          }
          key('keydown', x.code);
          setTimeout(() => key('keyup', x.code), 20);
        }
      },
      { plan, spbMs },
    );
    const kd = await ev(() => window.__kd);
    await untilGrid(g0 + 16.2);
    const ro = await ev(() => window.overdub.sketch.ruler().readouts.map((r) => r.text));
    await page.keyboard.press('Space');
    await page.waitForTimeout(900);
    const a1 = await song();
    const offs = kd.map((g, i) => Math.round((g - Math.round(g * 2) / 2) * spbMs));
    t.ok(
      a1.tracks.length === 1 &&
        a1.tracks[0].name === 'Drums' &&
        a1.tracks[0].clips.length === 1 &&
        notesText(a1.tracks[0].clips[0].notes) === notesText(pat.map(([b, p]) => ({ p, t: b }))),
      `what was meant comes out: K S K S on the beats of bars 1–2 (${notesText(a1.tracks[0]?.clips[0]?.notes || [])}), from 16 taps up to ${Math.max(...offs.map(Math.abs))} ms off (${offs.join(' ')} ms), the late one replaced by its second go`,
    );
    t.ok(
      ro.some((x) => /replaced a miss/.test(x)) && ro.every((x) => /^Pass \d: \d+ hits, /.test(x)),
      `and the pass line says so, measured from where each hit went in (${ro.join(' | ')}; the hits went in ${offs.join(' ')} ms off)`,
    );
    t.ok(
      a1.hist === 2,
      `the take and the Drums it was made for are one undo step (History: the loop, then the take: ${a1.hist})`,
    );
    // Tight / Loose / As played
    const tl = await ev(async () => {
      const a = window.overdub,
        at = () => a.store.get().tracks[0].clips[0].notes.map((n) => n.t);
      const b = document.querySelector('.sk-band .sk-timing'),
        btn = (l) => [...b.querySelectorAll('button')].find((x) => x.textContent === l);
      const out = { shown: !!b && !!btn('Tight'), tight: at() };
      btn('As played').click();
      await new Promise((r) => setTimeout(r, 60));
      out.played = at();
      btn('Loose').click();
      await new Promise((r) => setTimeout(r, 60));
      out.loose = at();
      btn('Tight').click();
      await new Promise((r) => setTimeout(r, 60));
      out.back = at();
      out.hist = a.store.history.slice(-3).map((x) => x.label);
      return out;
    });
    const dev = (xs) => Math.max(...xs.map((x, i) => Math.abs(x - tl.tight[i])));
    t.ok(
      tl.shown &&
        dev(tl.played) > 0.03 &&
        Math.abs(dev(tl.loose) - dev(tl.played) / 2) < 0.02 &&
        dev(tl.back) < 1e-6 &&
        tl.hist.join() === 'timing: as played,timing: loose,timing: tight',
      `after the take, its timing: As played puts the hits back where they fell (up to ${dev(tl.played).toFixed(2)} beats off), Loose half way, Tight on the grid again, each an undo step (${tl.hist.join(', ')})`,
    );
    for (let i = 0; i < 4; i++) await ev(() => window.overdub.store.undo());
    const u = await song();
    t.ok(
      u.tracks.length === 0 && u.hist === 1,
      `one undo after the timing steps takes the take and its Drums out together (${u.tracks.length} tracks; ${u.hist} left in History, the loop)`,
    );
    t.ok(!s.errors.length, `16a: no page errors${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
  } catch (e) {
    t.ok(false, '16a threw: ' + ((e && e.stack) || e));
  } finally {
    await s.close();
  }
}

// 16e. the player who waits to hear the click (the capture review: 85 to 180 ms late, every hit on an "and"): a take of
// kick and snare, each hit 150 ms behind the click (with 25 ms of slop), lands on the beats, and the take says so; As
// played puts the lean back, Loose keeps the feel without it. Hits are handed in on the take's grid (recorder.hit with g),
// so the check doesn't hang on the page's timers.
{
  const s = await blank();
  const { page, ev, door, song } = s;
  try {
    await door('Tap a beat');
    await page.waitForTimeout(1000);
    await page.keyboard.press('KeyR');
    // (the count-in waited out on the page, not in 120 round trips of 50 ms and more: on a CI runner the take hadn't
    // started when the hits went in, and none landed)
    await page
      .waitForFunction(() => window.overdub.input.recorder.state === 'rec', null, { timeout: 15000 })
      .catch(() => {});
    const offs = [0.31, 0.26, 0.33, 0.27, 0.3, 0.35, 0.28, 0.3]; // (beats at 120: 130 to 175 ms late)
    const r = await ev(async (offs) => {
      const a = window.overdub,
        rec = a.input.recorder,
        e = a.engine,
        L = rec.live(),
        g0 = e.gridBeat - (L.now - L.from),
        st = rec.state;
      offs.forEach((o, b) => rec.hit(b % 2 ? 'snare' : 'kick', 0.8, { g: g0 + b + o }));
      const res = await rec.stop();
      const at = () =>
        (a.store.get().tracks.find((t) => /Drums/.test(t.name))?.clips || [])
          .filter((c) => !c.mute)
          .flatMap((c) => c.notes.map((n) => ({ p: n.p, t: +(c.start + n.t).toFixed(3) })));
      const out = { st, tight: at(), summary: res?.summary || '', lean: res?.lean || null, status: '' };
      await new Promise((ok) => setTimeout(ok, 300));
      out.status = document.querySelector('.sk-status')?.textContent || '';
      out.readout = a.sketch.ruler().readout?.text || '';
      out.played = (rec.retime('played'), at());
      out.loose = (rec.retime('loose'), at());
      rec.retime('tight');
      return out;
    }, offs);
    const txt = (ns) =>
      ns
        .map((n) => `${n.p === 36 ? 'K' : 'S'}@${n.t}`)
        .sort()
        .join(' ');
    t.ok(
      txt(r.tight) === 'K@0 K@2 K@4 K@6 S@1 S@3 S@5 S@7' && r.lean && r.lean.ms >= 130 && r.lean.ms <= 170,
      `a beat played 130 to 175 ms behind the click lands on its beats (${txt(r.tight)}; it used to land every hit on an "and"), the lean found: ${r.lean?.ms} ms${r.st === 'rec' ? '' : ` (the recorder was "${r.st}" when the hits went in)`}`,
    );
    t.ok(
      /You played about 1[3-7]0 ms behind the click, so your hits are on their beats; As played puts them back\./.test(
        r.summary,
      ) &&
        /behind the click/.test(r.status) &&
        /behind the click/.test(r.readout),
      `and says so, with the number, in the toast ("${r.summary}"), under the pads ("${r.status}") and on the pass line ("${r.readout}")`,
    );
    const late = r.played.every((n) => n.t % 1 > 0.2 && n.t % 1 < 0.4),
      loose = r.loose.every((n) => Math.abs(n.t - Math.round(n.t)) < 0.05);
    t.ok(
      late && loose,
      `As played puts every hit back where it was played (${r.played.map((n) => n.t).join(' ')}); Loose keeps each one's feel but not the lean (${r.loose.map((n) => n.t).join(' ')})`,
    );
    t.ok(!s.errors.length, `16e: no page errors${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
  } catch (e) {
    t.ok(false, '16e threw: ' + ((e && e.stack) || e));
  } finally {
    await s.close();
  }
}

// 16b. Tap it, the click off: in your own time, the grid follows you
{
  const s = await blank();
  const { page, ev, song } = s;
  try {
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(300);
    await page.click('.sk-band .sk-bclick');
    await page.waitForTimeout(100);
    const b0 = await ev(() => ({
      cc: window.overdub.input.recorder.captureClick,
      free: window.overdub.input.recorder.wouldBeFree(),
      line: document.querySelector('.sk-band')?.title,
    }));
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(150);
    const r0 = await ev(() => ({
      st: window.overdub.input.recorder.state,
      free: window.overdub.input.recorder.free,
      playing: window.overdub.engine.playing,
      tracks: window.overdub.store.get().tracks.map((x) => x.name),
    }));
    // a beat at 92 BPM, slowing 6% as it goes, 25 ms of slop: kick, snare and eighth hats, a kick on 3-and
    const pat = [
      [0, 36],
      [0, 42],
      [0.5, 42],
      [1, 38],
      [1, 42],
      [1.5, 42],
      [2, 36],
      [2, 42],
      [2.5, 36],
      [2.5, 42],
      [3, 38],
      [3, 42],
      [3.5, 42],
    ];
    const hits = perform(pat, { bpm: 92, bars: 2, jitter: 0.025, drift: -0.06, start: 0.3, seed: 21 });
    const t0 = Date.now();
    for (const h of hits) {
      const w = t0 + h.t * 1000 - Date.now();
      if (w > 0) await page.waitForTimeout(w);
      await page.keyboard.down(KEY[h.p]);
      await page.keyboard.up(KEY[h.p]);
    }
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    const a = await song(),
      last = await ev(() => {
        const l = window.overdub.input.recorder.last;
        return { summary: l?.summary, bpm: l?.bpm };
      });
    const want = notesText(
      hits
        .map((h) => ({ p: h.p, t: h.want }))
        .filter((x, i, xs) => xs.findIndex((y) => y.p === x.p && y.t === x.t) === i),
    );
    t.ok(
      !b0.cc &&
        b0.free &&
        /your own time/.test(b0.line) &&
        r0.st === 'rec' &&
        r0.free &&
        !r0.playing &&
        r0.tracks.join() === 'Drums',
      `the click off, over a blank song: R records at once in your own time, no count and nothing playing ("${b0.line}"; ${r0.st}, free ${r0.free})`,
    );
    t.ok(
      a.tracks.length === 1 && a.tracks[0].clips[0] && notesText(a.tracks[0].clips[0].notes) === want,
      `the beat they meant comes out on the song's own bars (${notesText(a.tracks[0]?.clips[0]?.notes || [])})`,
    );
    t.ok(
      Math.abs(a.tempo - 89) <= 3 && /The song is at \d+ BPM now, the tempo you played\./.test(last.summary),
      `and the song's tempo is the one they played, ${a.tempo} BPM (92 slowing to 86), said so: "${last.summary}"`,
    );
    await ev(() => window.overdub.store.undo());
    const u = await song();
    t.ok(
      u.tracks.length === 0 && u.tempo === 120 && u.hist === 0,
      `one undo: the beat, its Drums and the tempo all go (${u.tracks.length} tracks, ${u.tempo} BPM)`,
    );
    t.ok(!s.errors.length, `16b: no page errors${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
  } catch (e) {
    t.ok(false, '16b threw: ' + ((e && e.stack) || e));
  } finally {
    await s.close();
  }
}

// 16c and 16d. Hum it, with the fake mic: a sloppy hum (onsets up to 60 ms off, notes let go early) at 100 BPM
{
  const MEL = [
    [60, 1],
    [64, 1],
    [67, 0.5],
    [69, 0.5, 1],
    [67, 1],
    [64, 0.5],
    [62, 0.5],
    [60, 2],
  ];
  const h = sloppyHum(MEL, { tempo: 100, sloppy: 0.06, seed: 3 });
  const file = path.join(OUTDIR, 'sketch-sloppy-hum.wav');
  const secs = wav(h.x, h.sr, file, { lead: 0.6, tail: 1.6 });
  // 16c. the click off: hum in your own time
  {
    const s = await blank({ fakeAudio: file });
    const { page, ev, door, song } = s;
    try {
      await door('Hum it');
      await page.waitForTimeout(400);
      await page.click('.sk-band .sk-bclick');
      await page.click('.sk-hum');
      await page.waitForTimeout(secs * 1000 - 600);
      await page.click('.sk-hum');
      await page.waitForTimeout(1200);
      const a = await song(),
        last = await ev(() => window.overdub.input.recorder.last?.summary || '');
      const mel = a.tracks[0]?.clips[0]?.notes || [];
      const got = mel.map((n) => `${n.p}@${n.t}`).join(' '),
        want = h.want.map((w) => `${w.m}@${w.beat}`).join(' ');
      // (where each note was heard, from the first sample the mic gave: 0.90 1.57 2.12 2.45 3.27 3.88 4.23 4.55 s on a
      // Mac at a desk, idle or busy; if these move, the fake mic's timing moved, not the hum)
      const heard = await ev(() => (window.overdub.input.hum.take?.segs || []).map((g) => g.t0.toFixed(2)).join(' '));
      t.ok(
        a.tracks.length === 1 && a.tracks[0].name === 'Melody' && a.tracks[0].device === 'core.keys' && got === want,
        `a hum in your own time comes back with the rhythm sung, on a new Melody (${got}; sung ${want}; heard at ${heard} s)`,
      );
      t.ok(
        Math.abs(a.tempo - 100) <= 4 && /Your hum is in: 8 notes on Melody/.test(last),
        `at the tempo hummed: ${a.tempo} BPM ("${last}")`,
      );
      await ev(() => window.overdub.store.undo());
      const u = await song();
      t.ok(
        u.tracks.length === 0 && u.tempo === 120,
        `one undo takes the hum, its track and the tempo (${u.tracks.length} tracks, ${u.tempo} BPM)`,
      );
      t.ok(!s.errors.length, `16c: no page errors${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
    } catch (e) {
      t.ok(false, '16c threw: ' + ((e && e.stack) || e));
    } finally {
      await s.close();
    }
  }
  // 16d. with the click: a bar of count-in, then the hum; it lands on its own new track by itself
  {
    const s = await blank({ fakeAudio: file });
    const { page, ev, door, song } = s;
    try {
      await door('Hum it');
      await page.waitForTimeout(400);
      await page.click('.sk-hum');
      await page.waitForTimeout(120);
      const c = await ev(() => ({
        st: window.overdub.input.recorder.state,
        click: window.overdub.engine.click.on,
        label: document.querySelector('.sk-hum .sk-big-l')?.textContent,
        line: document.querySelector('.sk-band')?.title,
      }));
      await page.waitForTimeout(secs * 1000 + 1200);
      await page.click('.sk-hum');
      await page.waitForTimeout(1500);
      const a = await song(),
        last = await ev(() => ({
          summary: window.overdub.input.recorder.last?.summary || '',
          status: document.querySelector('.sk-status')?.textContent || '',
        }));
      const mel = a.tracks[0]?.clips || [];
      const at0 = mel.flatMap((cl) => cl.notes.filter((n) => cl.start + n.t === 0)).length;
      t.ok(
        c.st === 'count' && c.click && c.label === 'Cancel' && /Count-in/.test(c.line),
        `Hum it counts in a bar with the click (${c.st}, click ${c.click}, "${c.label}", "${c.line}")`,
      );
      t.ok(
        a.tracks.length === 1 &&
          a.tracks[0].name === 'Melody' &&
          mel.length >= 1 &&
          mel[0].start === 0 &&
          at0 <= 1 &&
          a.hist - (/heard in your hum/.test(a.labels[1] || '') ? 1 : 0) === 1 &&
          /Take 1 is in on Melody/.test(last.summary) &&
          /Take 1 is in on Melody/.test(last.status),
        `then the hum goes into the song by itself, on a new Melody from bar 1, one undo step (the key heard in it is its own, after it), nothing sung in the count stacked on beat 1 (${at0} there; ${mel.map((cl) => cl.notes.length).join('+')} notes; ${a.labels.join(' / ')}; "${last.status}")`,
      );
      t.ok(!s.errors.length, `16d: no page errors${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
    } catch (e) {
      t.ok(false, '16d threw: ' + ((e && e.stack) || e));
    } finally {
      await s.close();
    }
  }
}
t.done();
