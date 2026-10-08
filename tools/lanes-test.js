// Automation lanes in the arranger [ui-arrange] (app/src/ui/lanes.js, the rows in app/src/ui/arranger.js): real pointer
// and key events. E shows a track's lanes and the tracks below move down; a click adds a point (and the first one a
// point at bar 1 with the knob's value); dragging a point moves it on the snap grid; Alt-drag bends a segment and
// Alt-double-click straightens it; double-click deletes; Draw paints freehand and thins it; dragging across empty lane
// selects bars, and the menu's shapes write over them; arrows and Delete work the points from the keyboard;
// showLane() (a knob's Automate) opens an instrument param's lane; held, agent-written and recording lanes look like the
// kit says; moving a clip takes the lane under it along; clips under open lanes are still hit where they're drawn;
// every gesture is one undo step, signed by you. Then a phone: a tap adds a point, a finger drags it, a hold opens
// the point's menu.
//   node tools/lanes-test.js      (screenshots: tools/.out/lanes.png, tools/.out/lanes-phone.png)
import { open, tally, OUTDIR } from './pw.js';
import path from 'node:path';

const T = tally('lanes');
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g/.test(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ←/→ in Node (lanes.js stepIndex): a jump (two points at one beat, from Hold here, Pulse, a recorded touch or
// time.remove) is one stop, and → walks on past it; with nothing after the selection it stays on the last point
{
  const { stepIndex } = await import('../app/src/ui/lanes.js');
  const pts = [
    { t: 0, v: -20 },
    { t: 4, v: -20 },
    { t: 4, v: 0 },
    { t: 8, v: 0 },
  ];
  let sel = { from: 0, to: 0 };
  const walk = [];
  for (let k = 0; k < 4; k++) {
    const i = stepIndex(pts, sel, 1);
    sel = { from: pts[i].t, to: pts[i].t };
    walk.push(pts[i].t);
  }
  const back = [];
  for (let k = 0; k < 3; k++) {
    const i = stepIndex(pts, sel, -1);
    sel = { from: pts[i].t, to: pts[i].t };
    back.push(pts[i].t);
  }
  T.ok(
    walk.join() === '4,8,8,8' && back.join() === '4,0,0',
    `→ walks past a jump (beats ${walk.join(', ')}), ← walks back over it (${back.join(', ')})`,
  );
  T.ok(
    stepIndex(pts, { from: 6, to: 9 }, 1) === 3 &&
      stepIndex(pts, { from: 2, to: 5 }, 1) === 3 &&
      stepIndex(pts, { from: 2, to: 5 }, -1) === 1,
    '→ from a range with no point after it stays on the last point (not back to the first); ← from a range picks its first point',
  );
}

// A gain lane above the drawn top (+6 dB; an agent's +12, up to the +24 the mixer takes), in Node: moving a point
// sideways keeps its value, ↑/↓ and a drag move it from where it is (never pulled down to +6), and the shapes read
// the lane at its real level (a Swell over a +12 hold is no 6 dB cut)
{
  const { moveValue, nudgeValue, shapeLane } = await import('../app/src/ui/lanes.js');
  const { MIXER, normPoints, formatPoints, paramSpec, discrete } = await import('../app/src/core/automation.js');
  const G = MIXER.gain;
  const up = nudgeValue(G, 12, 1),
    dn = nudgeValue(G, 12, -1),
    dnBig = nudgeValue(G, 12, -1, true);
  T.ok(
    moveValue(G, 12, 0) === 12 &&
      up === 12 &&
      dn < 12 &&
      dn > 11 &&
      dnBig < dn &&
      dnBig > 6 &&
      moveValue(G, 24, 0.2) === 24 &&
      moveValue(G, 0, 0.5) === 6,
    `a +12 dB gain point: sideways stays +12, ↑ stays +12 (the top is its own), ↓ ${dn.toFixed(2)}, Shift+↓ ${dnBig.toFixed(2)} (was +6 for all three); a 0 dB point still stops at +6`,
  );
  const h12 = normPoints(
    [
      { t: 0, v: 12 },
      { t: 16, v: 12 },
    ],
    G,
  );
  const sh = (n) => shapeLane(n, h12, G, 4, 8, 0);
  const vals = (pts) => pts.filter((x) => x.t >= 4 && x.t <= 8);
  const is12 = (x) => Math.abs(x.v - 12) < 1e-6;
  T.ok(
    vals(sh('swell')).every(is12) &&
      vals(sh('hold')).every(is12) &&
      vals(sh('dip')).every((x) => x.v <= 12 + 1e-6) &&
      vals(sh('dip')).some((x) => x.v < 6) &&
      sh('dip')
        .filter((x) => x.t === 4 || x.t === 8)
        .every(is12),
    `shapes on a +12 dB hold join it at +12: Swell ${formatPoints(vals(sh('swell')))}, Hold ${formatPoints(vals(sh('hold')))}, Dip ${formatPoints(vals(sh('dip')))} (Swell was a 6 dB cut)`,
  );
  const ru = vals(sh('ramp-up'));
  T.ok(
    is12(ru[ru.length - 1]) && ru.every((x) => x.v <= 12 + 1e-6 && x.v > -6),
    `Ramp up on a +12 hold rises to +12 (${formatPoints(ru)}; it fell to -12)`,
  );
  const l2 = normPoints(
    [
      { t: 0, v: -6 },
      { t: 8, v: 12 },
      { t: 16, v: 12 },
      { t: 24, v: -6 },
    ],
    G,
  );
  const sw2 = shapeLane('swell', l2, G, 10, 14, 0).filter((x) => x.t >= 8 && x.t <= 16);
  T.ok(sw2.every(is12), `a Swell inside a +12 stretch leaves it at +12 (${formatPoints(sw2)})`);
  // ↑/↓ on a switch or a few-setting param: at least one setting a press (a 2-way switch never moved)
  const sw = paramSpec({ key: 'mode', opts: ['A', 'B'] }),
    five = paramSpec({ key: 'reg', opts: ['1', '2', '3', '4', '5'] }),
    div = paramSpec({ key: 'div', min: 0, max: 40, step: 1 });
  const moves = [
    nudgeValue(sw, 0, 1),
    nudgeValue(sw, 0, 1, true),
    nudgeValue(sw, 1, -1),
    nudgeValue(sw, 1, 1),
    nudgeValue(five, 2, 1),
    nudgeValue(five, 2, -1, true),
    nudgeValue(div, 10, 1),
  ];
  T.ok(
    moves.join() === '1,1,0,1,3,1,11' && discrete(sw),
    `↑/↓ move a switch or a stepped param a setting at a time (${moves.join(', ')}); the top stays the top`,
  );
  const cut = paramSpec({ key: 'cut', min: 20, max: 20000, curve: 'log', unit: 'Hz', step: 1 });
  T.ok(
    nudgeValue(cut, 1000, 1) > 1050 && nudgeValue(cut, 1000, 1) < 1100,
    `a knob still moves a hundredth of its travel (${nudgeValue(cut, 1000, 1).toFixed(0)} Hz from 1000)`,
  );
}

// The value tip: an LFO's rate and a fast attack under 10 Hz / 10 ms keep their decimals
{
  const { fmtValue } = await import('../app/src/ui/lanes.js');
  const rate = { unit: 'Hz', min: 0.5, max: 9, step: 0 },
    att = { unit: 'ms', min: 0.1, max: 100, step: 0 },
    lfo = { unit: 'Hz', min: 0.02, max: 20, step: 0 };
  const got = [
    fmtValue(rate, 0.5),
    fmtValue(rate, 1.4),
    fmtValue(att, 0.4),
    fmtValue(lfo, 0.02),
    fmtValue(att, 12),
    fmtValue({ unit: 'Hz', min: 20, max: 20000 }, 440),
    fmtValue({ unit: 'ms', min: 0, max: 2000, step: 1 }, 5),
  ];
  T.ok(
    got.join('|') === '0.50 Hz|1.4 Hz|0.40 ms|0.02 Hz|12 ms|440 Hz|5 ms',
    `the tip reads sub-unit rates and times (${got.join(', ')}; they were 1 Hz, 1 Hz, 0 ms, 0 Hz)`,
  );
}

const s = await open('/app/', { query: 'demo' });
const { page, errors, close, shot } = s;
const E = (fn, a) => page.evaluate(fn, a);
try {
  await E(() => {
    localStorage.setItem('overdub:welcomed', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  await E(() => {
    const o = window.overdub;
    o.store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you', label: 'loop off' });
    o.arranger.zoomTo(0, 48);
    o.ui.state.snap = 1;
  });
  await page.waitForTimeout(200);

  const info = await E(() => {
    const o = window.overdub,
      p = o.store.get();
    const bpb = p.meter[0] * (4 / p.meter[1]);
    const t = p.tracks.find((x) => x.kind === 'instrument' && x.instrument);
    return {
      bpb,
      tracks: p.tracks.map((x) => x.id),
      t: t.id,
      i: p.tracks.indexOf(t),
      TH: o.ui.state.zoom.trackH,
      ys: p.tracks.map((x) => o.arranger.yOf(x.id)),
      lanes: o.arranger.laneRows().length,
    };
  });
  const { bpb, TH } = info;
  const tid = info.t;
  T.ok(
    info.lanes === 0 && info.ys.every((y, i) => i === 0 || Math.abs(y - info.ys[i - 1] - TH) < 0.5),
    `no lanes open: every track is one row, ${TH} px apart, as before`,
  );
  const lane = (addr) =>
    E((a) => {
      const o = window.overdub,
        p = o.store.get(),
        t = p.tracks.find((x) => x.id === a.track);
      const host = a.insert ? (a.insert === 'instrument' ? t.instrument : t.inserts.find((x) => x.id === a.insert)) : t;
      return host?.auto?.[a.param] ? JSON.parse(JSON.stringify(host.auto[a.param])) : null;
    }, addr);
  const lastTxn = () =>
    E(() => {
      const h = window.overdub.store.history;
      const x = h[h.length - 1];
      return x ? { by: x.by, label: x.label, n: (x.ops || []).length } : null;
    });
  const xOf = (b) => E((b) => window.overdub.arranger.xOf(b), b);
  const rowOf = async (key) => (await E(() => window.overdub.arranger.laneRows())).find((r) => r.key === key);
  const yAt = (key, v) => E(([k, v]) => window.overdub.arranger.laneY(k, v), [key, v]);
  const undo = () => E(() => window.overdub.store.undo({ by: 'you' }));
  const redo = () => E(() => window.overdub.store.redo({ by: 'you' }));
  const gainKey = `${tid}/gain`;
  const G = { track: tid, param: 'gain' };

  /* ---- E shows the selected track's lanes: its Level lane, and the tracks below move down a lane's height */
  await E((id) => {
    const o = window.overdub;
    o.ui.select({ track: id, clip: null, notes: [] });
    o.ui.state.focus = 'arranger';
    document.activeElement?.blur?.();
  }, tid);
  await page.keyboard.press('e');
  await sleep(150);
  let rows = await E(() => window.overdub.arranger.laneRows());
  const head = await E((k) => {
    const el = document.querySelector(`.ar-lhead[data-lane="${k}"]`);
    return el
      ? { text: el.textContent, h: el.getBoundingClientRect().height, name: el.querySelector('.ar-lname')?.textContent }
      : null;
  }, gainKey);
  T.ok(
    rows.length === 1 && rows[0].key === gainKey && head?.name === 'Level',
    `E opens the track's Level lane under it (${JSON.stringify(rows.map((r) => r.key))}, header "${head?.name}")`,
  );
  const ys2 = await E(() => window.overdub.store.get().tracks.map((x) => window.overdub.arranger.yOf(x.id)));
  const LH = rows[0].h;
  T.ok(LH === 40 && Math.abs(head.h - LH) < 1, `a lane row is 40 px, its header too (${LH}, ${head?.h})`);
  T.ok(
    ys2.every((y, i) => Math.abs(y - info.ys[i] - (i > info.i ? LH : 0)) < 0.5),
    'the tracks below it move down by one lane; the ones above stay',
  );
  T.ok(
    await E(() => document.querySelectorAll('.ar-head').length === window.overdub.store.get().tracks.length),
    'still one .ar-head per track (lane headers are their own rows)',
  );
  T.ok(
    await E((id) => !!document.querySelector(`.ar-head[data-track="${id}"] .ar-hb-auto.on`), tid),
    'the track header shows a lit A key while its lanes show',
  );

  /* ---- a click adds a point; the first one also puts one at bar 1 with the fader's value */
  let r = await rowOf(gainKey);
  const fader = await E((id) => window.overdub.store.get().tracks.find((t) => t.id === id).gain, tid);
  let x = await xOf(2 * bpb + 0.1),
    y = await yAt(gainKey, -24);
  await page.mouse.click(x, y);
  await sleep(150);
  let L = await lane(G);
  T.ok(
    L &&
      L.points.length === 2 &&
      L.points[0].t === 0 &&
      Math.abs(L.points[0].v - fader) < 1e-6 &&
      L.points[1].t === 2 * bpb,
    `a click at bar 3 makes a point there (snapped to the beat) and one at bar 1 with the fader's ${fader} dB (${JSON.stringify(L?.points)})`,
  );
  T.ok(
    L && Math.abs(L.points[1].v - -24) < 2.5 && L.by === 'you',
    `its value is where the click was (${L?.points[1]?.v?.toFixed(1)} dB, wanted about -24), signed by you`,
  );
  await undo();
  await sleep(80);
  T.ok(!(await lane(G)), 'one undo takes the whole click back (no lane left)');
  await redo();
  await sleep(80);
  T.ok((await lane(G))?.points.length === 2, 'and redo puts it back');

  /* ---- drag a point: to bar 5 and lower, on the snap grid (a while after the click, or it's a double-click) */
  await sleep(450);
  x = await xOf(2 * bpb);
  y = await yAt(gainKey, (await lane(G)).points[1].v);
  const x5 = await xOf(4 * bpb + 0.3),
    yLow = await yAt(gainKey, -48);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move((x + x5) / 2, (y + yLow) / 2, { steps: 4 });
  await page.mouse.move(x5, yLow, { steps: 4 });
  await page.mouse.up();
  await sleep(150);
  L = await lane(G);
  T.ok(
    L.points.length === 2 && L.points[1].t === 4 * bpb && Math.abs(L.points[1].v - -48) < 3,
    `dragging the point moves it to bar 5 (on the beat grid) and down to about -48 dB (${JSON.stringify(L.points[1])})`,
  );
  await undo();
  await sleep(80);
  L = await lane(G);
  T.ok(L.points[1].t === 2 * bpb, `one undo puts the point back at bar 3 (${L.points[1].t})`);
  await redo();
  await sleep(80);

  /* ---- click on the line adds a point on it; Alt-drag the segment bends it; Alt-double-click straightens it */
  L = await lane(G);
  const midB = 2 * bpb;
  x = await xOf(midB + 0.5);
  y = await yAt(
    gainKey,
    await E(
      ([tid, b]) =>
        import('/app/src/core/automation.js').then((A) => {
          const p = window.overdub.store.get();
          const t = p.tracks.find((x) => x.id === tid);
          return A.valueAt(t.auto.gain, b, A.MIXER.gain);
        }),
      [tid, midB + 0.5],
    ),
  );
  await sleep(450);
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 10, { steps: 3 });
  await page.mouse.move(x, y - 18, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await sleep(150);
  L = await lane(G);
  T.ok(
    L.points.length === 2 && typeof L.points[0].c === 'number' && L.points[0].c !== 0,
    `Alt-drag on the line bends the segment (c ${L.points[0].c}), no point added`,
  );
  await sleep(450);
  await page.keyboard.down('Alt');
  await page.mouse.dblclick(x, y);
  await page.keyboard.up('Alt');
  await sleep(150);
  L = await lane(G);
  T.ok(
    L.points.length === 2 && L.points[0].c === undefined,
    `Alt-double-click straightens it (${JSON.stringify(L.points[0])})`,
  );

  // a click on the line, between the points: a point on the line's value there
  const vAt3 = await E(
    ([tid, b]) =>
      import('/app/src/core/automation.js').then((A) => {
        const t = window.overdub.store.get().tracks.find((x) => x.id === tid);
        return A.valueAt(t.auto.gain, b, A.MIXER.gain);
      }),
    [tid, 2 * bpb],
  );
  x = await xOf(2 * bpb);
  y = await yAt(gainKey, vAt3);
  await sleep(450);
  await page.mouse.click(x, y + 3);
  await sleep(450);
  L = await lane(G);
  const mid = L.points.find((p) => p.t === 2 * bpb);
  T.ok(
    L.points.length === 3 && mid && Math.abs(mid.v - vAt3) < 0.01,
    `a click on the line adds a point with the line's value there (${mid?.v?.toFixed(2)} vs ${vAt3.toFixed(2)})`,
  );

  /* ---- double-click a point: it goes */
  await page.mouse.dblclick(x, y);
  await sleep(150);
  L = await lane(G);
  T.ok(
    L.points.length === 2 && !L.points.some((p) => p.t === 2 * bpb),
    `double-click deletes the point (${L.points.length} left)`,
  );
  await sleep(450);

  /* ---- Draw: paint freehand across bars 6-8, thinned on release, one undo step */
  const before = (await lane(G)).points.length;
  await page.click(`.ar-lhead[data-lane="${gainKey}"] .ar-ldraw`);
  T.ok(
    await E(
      (k) => document.querySelector(`.ar-lhead[data-lane="${k}"] .ar-ldraw`)?.getAttribute('aria-pressed') === 'true',
      gainKey,
    ),
    "the lane's Draw lamp lights",
  );
  r = await rowOf(gainKey);
  const xa = await xOf(5 * bpb),
    xb = await xOf(8 * bpb);
  // a slow rise, then a fall: a hand on a fader, drawn with the mouse
  await page.mouse.move(xa, r.bottom - 8);
  await page.mouse.down();
  let raw = 0;
  for (let k = 1; k <= 80; k++) {
    const f = k / 80,
      xx = xa + (xb - xa) * f;
    await page.mouse.move(xx, r.bottom - 8 - (r.bottom - r.top - 16) * (f < 0.7 ? f / 0.7 : (1 - f) / 0.3));
    raw++;
  }
  await page.mouse.up();
  await sleep(150);
  L = await lane(G);
  const drawn = L.points.filter((p) => p.t >= 5 * bpb - 0.01 && p.t <= 8 * bpb + 0.01);
  T.ok(
    drawn.length >= 3 && drawn.length < raw / 4,
    `Draw paints the lane and thins it (${raw} moves, ${drawn.length} points kept)`,
  );
  const lt = await lastTxn();
  T.ok(!!lt && lt.by === 'you' && lt.n === 1 && /Level/.test(lt.label), `one auto.write by you ("${lt?.label}")`);
  await undo();
  await sleep(80);
  T.ok((await lane(G)).points.length === before, 'one undo takes the whole stroke back');
  await page.click(`.ar-lhead[data-lane="${gainKey}"] .ar-ldraw`);

  /* ---- drag across empty lane: selects bars; the menu's shapes write over them */
  r = await rowOf(gainKey);
  const lv = await E(
    ([tid, b]) =>
      import('/app/src/core/automation.js').then((A) => {
        const t = window.overdub.store.get().tracks.find((x) => x.id === tid);
        return A.valueBefore(t.auto.gain, b, A.MIXER.gain);
      }),
    [tid, 8 * bpb],
  );
  const farY = (await yAt(gainKey, lv)) > r.mid ? r.top + 6 : r.bottom - 6;
  const xs = await xOf(8 * bpb + 0.2),
    xe = await xOf(10 * bpb - 0.2);
  await page.mouse.move(xs, farY);
  await page.mouse.down();
  await page.mouse.move((xs + xe) / 2, farY, { steps: 3 });
  await page.mouse.move(xe, farY, { steps: 3 });
  await page.mouse.up();
  await sleep(120);
  const sel = await E(() => window.overdub.arranger.laneSel());
  T.ok(
    sel && sel.key === gainKey && Math.abs(sel.from - 8 * bpb) < 1e-6 && Math.abs(sel.to - 10 * bpb) < 1e-6,
    `dragging across empty lane selects bars 9-10 (${JSON.stringify(sel)})`,
  );
  await page.mouse.click((xs + xe) / 2, farY, { button: 'right' });
  await sleep(150);
  const items = await E(() => [...document.querySelectorAll('.ek-pop .ek-item')].map((b) => b.textContent));
  T.ok(
    ['Ramp up', 'Ramp down', 'Swell', 'Dip', 'Hold here', 'Pulse'].every((w) => items.some((t) => t.startsWith(w))),
    `the lane's menu offers the shapes on those bars (${items.slice(0, 8).join(', ')})`,
  );
  await page.locator('.ek-pop .ek-item', { hasText: 'Swell' }).click();
  await sleep(150);
  L = await lane(G);
  const sw = await E(
    ([tid, a, b]) =>
      import('/app/src/core/automation.js').then((A) => {
        const t = window.overdub.store.get().tracks.find((x) => x.id === tid);
        const sp = A.MIXER.gain;
        return [A.valueAt(t.auto.gain, a, sp), A.valueAt(t.auto.gain, (a + b) / 2, sp), A.valueAt(t.auto.gain, b, sp)];
      }),
    [tid, 8 * bpb, 10 * bpb],
  );
  T.ok(
    sw[1] > sw[0] + 3 && sw[1] > sw[2] + 3,
    `Swell rises to the middle of the bars and comes back (${sw.map((v) => v.toFixed(1)).join(' → ')} dB)`,
  );
  T.ok(Math.abs(sw[0] - lv) < 0.01, "and joins the lane's value going in");
  // the rest, through the same path the menu uses: ramps go the way they say, Hold is flat, Pulse steps every beat
  const shapes = {};
  for (const sh of ['ramp-up', 'ramp-down', 'dip', 'hold', 'pulse']) {
    await E(
      ([tid, sh, a, b]) => window.overdub.arranger.laneShape(tid, { param: 'gain' }, sh, a, b),
      [tid, sh, 12 * bpb, 14 * bpb],
    );
    shapes[sh] = await E(
      ([tid, a, b]) =>
        import('/app/src/core/automation.js').then((A) => {
          const t = window.overdub.store.get().tracks.find((x) => x.id === tid);
          const sp = A.MIXER.gain;
          return [a, a + 0.5, a + 1.5, (a + b) / 2, b - 0.01].map((x) => A.valueAt(t.auto.gain, x, sp));
        }),
      [tid, 12 * bpb, 14 * bpb],
    );
    await undo();
  }
  T.ok(
    shapes['ramp-up'][4] > shapes['ramp-up'][0] + 3 && shapes['ramp-down'][4] < shapes['ramp-down'][0] - 3,
    `Ramp up rises, Ramp down falls (${shapes['ramp-up'][0].toFixed(1)}→${shapes['ramp-up'][4].toFixed(1)}, ${shapes['ramp-down'][0].toFixed(1)}→${shapes['ramp-down'][4].toFixed(1)})`,
  );
  T.ok(
    shapes.dip[3] < shapes.dip[0] - 3 && Math.max(...shapes.hold) - Math.min(...shapes.hold) < 1e-6,
    'Dip dips in the middle; Hold here is flat',
  );
  T.ok(
    Math.abs(shapes.pulse[1] - shapes.pulse[2]) > 1,
    `Pulse steps between two values every beat (${shapes.pulse.map((v) => v.toFixed(1)).join(', ')})`,
  );

  /* ---- the keyboard: a selected point, arrows walk the points and move the value, Delete removes it */
  L = await lane(G);
  const p0 = L.points[0];
  x = await xOf(p0.t);
  y = await yAt(gainKey, p0.v);
  await page.mouse.click(x + 1, y);
  await sleep(450);
  T.ok((await E(() => window.overdub.arranger.laneSel()))?.from === p0.t, 'a click on a point selects it');
  await page.keyboard.press('ArrowRight');
  await sleep(60);
  const s1 = await E(() => window.overdub.arranger.laneSel());
  T.ok(s1 && s1.from === L.points[1].t, `→ selects the next point (beat ${s1?.from})`);
  const vb = (await lane(G)).points[1].v;
  await page.keyboard.press('ArrowUp');
  await sleep(60);
  T.ok(
    (await lane(G)).points[1].v > vb,
    `↑ raises it (${vb.toFixed(2)} → ${(await lane(G)).points[1].v.toFixed(2)} dB)`,
  );
  const n0 = (await lane(G)).points.length;
  await page.keyboard.press('Delete');
  await sleep(80);
  T.ok((await lane(G)).points.length === n0 - 1, 'Delete removes the selected point (not the clips)');
  T.ok(await E(() => window.overdub.ui.keys.list().some((k) => k.key === 'KeyE' && !k.mod)), 'E is a declared key');
  // from the keyboard alone: Tab to the lane's name, Enter picks the point at the playhead, → walks on
  await E(() => {
    window.overdub.arranger.laneSel && window.overdub.engine.seek?.(0);
  });
  await page.focus(`.ar-lhead[data-lane="${gainKey}"] .ar-lname`);
  await page.keyboard.press('Enter');
  await sleep(80);
  const kp = await E(() => ({
    sel: window.overdub.arranger.laneSel(),
    focus: document.activeElement?.className || '',
  }));
  T.ok(
    kp.sel && kp.sel.key === gainKey && /ar-scroll/.test(kp.focus),
    `Enter on the lane's name picks a point and hands the arrows to the lanes (${JSON.stringify(kp.sel)}, focus ${kp.focus})`,
  );
  await page.keyboard.press('ArrowRight');
  await sleep(60);
  const kp2 = await E(() => window.overdub.arranger.laneSel());
  T.ok(kp2 && kp2.from > kp.sel.from, `→ then walks to the next point (${kp.sel?.from} → ${kp2?.from})`);
  T.ok(
    /click adds a point/.test(await E(() => document.querySelector('.ar-hint')?.textContent || '')),
    "the arranger's hint says what a lane takes",
  );

  /* ---- showLane: a knob's Automate opens an instrument param's lane, named in sentence case with its device */
  const ip = await E((id) => {
    const o = window.overdub,
      t = o.store.get().tracks.find((x) => x.id === id),
      d = o.devices.getDevice(t.instrument.device);
    const q = d.params.find((x) => !x.opts && x.auto !== false && !(x.step > 0)) || d.params[0];
    return { key: q.key, label: q.label, def: q.def, min: q.min, max: q.max, dev: d.name };
  }, tid);
  const opened = await E(
    ([id, k]) => window.overdub.arranger.showLane(id, { insert: 'instrument', param: k }),
    [tid, ip.key],
  );
  await sleep(200);
  const ikey = `${tid}/instrument/${ip.key}`;
  const ih = await E((k) => {
    const el = document.querySelector(`.ar-lhead[data-lane="${k}"]`);
    return el
      ? {
          name: el.querySelector('.ar-lname')?.textContent,
          dev: el.querySelector('.ar-ldev')?.textContent,
          val: el.querySelector('.ar-lval')?.textContent,
        }
      : null;
  }, ikey);
  T.ok(
    opened?.key === ikey &&
      ih &&
      ih.dev === ip.dev &&
      ih.name &&
      ih.name[0] === ih.name[0].toUpperCase() &&
      ih.name.slice(1) ===
        ih.name
          .slice(1)
          .toLowerCase()
          .replace(/lfo|eq|hp|lp/gi, (m) => m.toUpperCase()),
    `showLane opens ${ip.label} as "${ih?.name}", ${ih?.dev}, value ${ih?.val}`,
  );
  T.ok(
    (await E(() => window.overdub.arranger.showLane('nope', { param: 'gain' }))) === null &&
      (await E((id) => window.overdub.arranger.showLane(id, { insert: 'instrument', param: 'no_such' }), tid)) === null,
    "showLane says null for a track or param that isn't there",
  );
  // a click on it writes the instrument param's lane
  r = await rowOf(ikey);
  await page.mouse.click(await xOf(3 * bpb), r.top + 10);
  await sleep(150);
  L = await lane({ track: tid, insert: 'instrument', param: ip.key });
  T.ok(
    L && L.points.length === 2 && L.points[1].v > ip.min + (ip.max - ip.min) * 0.5,
    `a click near the top of it writes a high ${ip.key} (${JSON.stringify(L?.points)})`,
  );

  /* ---- held: dashed, the name struck, "held"; Back to the lane gives it back */
  await E(
    (id) =>
      window.overdub.store.dispatch(
        { type: 'auto.set', track: id, param: 'gain', patch: { off: true } },
        { by: 'you', label: 'hold' },
      ),
    tid,
  );
  await sleep(150);
  const hh = await E((k) => {
    const el = document.querySelector(`.ar-lhead[data-lane="${k}"]`);
    return {
      struck: !!el?.querySelector('.ar-lname.struck'),
      held: el?.querySelector('.ar-lheld')?.textContent,
      back: !!el?.querySelector('.ar-lback'),
    };
  }, gainKey);
  T.ok(
    hh.struck && hh.held === 'held' && hh.back,
    'a held lane: the name struck, "held" where the byline was, Back to the lane',
  );
  await page.click(`.ar-lhead[data-lane="${gainKey}"] .ar-lback`);
  await sleep(120);
  T.ok(!(await lane(G)).off, 'Back to the lane gives it back');

  /* ---- Clear (the lane's menu): the knob keeps the lane's value at the playhead, the lane goes, one undo step */
  const IA = { track: tid, insert: 'instrument', param: ip.key };
  const vHere = await E(
    ([tid, k]) => {
      const o = window.overdub;
      o.engine.seek(12);
      return import('/app/src/core/automation.js').then((A) => {
        const t = o.store.get().tracks.find((x) => x.id === tid);
        return A.valueAt(t.instrument.auto[k], 12);
      });
    },
    [tid, ip.key],
  );
  r = await rowOf(ikey);
  await page.mouse.click(await xOf(20), r.mid, { button: 'right' });
  await sleep(150);
  await page.locator('.ek-pop .ek-item', { hasText: 'Clear' }).click();
  await sleep(150);
  const cl = await E(
    ([tid, k]) => {
      const t = window.overdub.store.get().tracks.find((x) => x.id === tid);
      return { lane: !!t.instrument.auto?.[k], v: t.instrument.params[k] };
    },
    [tid, ip.key],
  );
  T.ok(
    !cl.lane && Math.abs(cl.v - vHere) < 1e-6 && !!(await rowOf(ikey)),
    `Clear removes the lane and the knob keeps its value at the playhead (${cl.v} = ${vHere}); the row stays, empty`,
  );
  await undo();
  await sleep(80);
  T.ok(!!(await lane(IA)), 'one undo brings the lane back');
  await E(() => window.overdub.engine.seek(0));

  /* ---- an agent's lane is signed with a byline */
  await E(
    (id) =>
      window.overdub.store.dispatch(
        { type: 'auto.write', track: id, param: 'pan', points: '0:-0.5 16:0.5' },
        { by: 'claude', label: 'pan sweep' },
      ),
    tid,
  );
  await E((id) => window.overdub.arranger.showLane(id, { param: 'pan' }), tid);
  await sleep(150);
  const by = await E((k) => {
    const el = document.querySelector(`.ar-lhead[data-lane="${k}"]`);
    return [...(el?.querySelectorAll('.by') || [])].map((b) => `${b.className}:${b.textContent}`);
  }, `${tid}/pan`);
  T.ok(
    by.length === 1 && /by-agent/.test(by[0]) && /Claude/.test(by[0]),
    `the agent's lane carries its byline (${by})`,
  );
  T.ok(
    await E((k) => window.overdub.arranger.laneFlashing(k), `${tid}/pan`),
    "and arrives with crop marks in the agent's ink",
  );
  T.ok(
    !(await E((k) => document.querySelector(`.ar-lhead[data-lane="${k}"] .by`), gainKey)),
    "yours is unsigned on the lane (it's your song)",
  );

  /* ---- recording: the stretch being written is in record ink */
  await E((id) => window.overdub.arranger.recLanes([{ track: id, param: 'pan', from: 0, to: 8 }]), tid);
  await sleep(120);
  r = await rowOf(`${tid}/pan`);
  const red = await E(
    ([top, bottom, x0, x1]) => {
      const cv = document.querySelector('.ar-lanes'),
        b = cv.getBoundingClientRect(),
        k = cv.width / b.width,
        g = cv.getContext('2d');
      const img = g.getImageData(
        Math.round((x0 - b.left) * k),
        Math.round((top - b.top) * k),
        Math.max(1, Math.round((x1 - x0) * k)),
        Math.round((bottom - top) * k),
      ).data;
      let n = 0;
      for (let i = 0; i < img.length; i += 4) if (img[i] > 200 && img[i + 1] < 110 && img[i + 2] < 110) n++;
      return n;
    },
    [r.top, r.bottom, await xOf(0.5), await xOf(7.5)],
  );
  T.ok(red > 40, `the lane being written is drawn in record ink (${red} red pixels)`);
  await E(() => window.overdub.arranger.recLanes(null));

  /* ---- recording automation for real (input/autorec.js): a control held while R records opens its lane, and the
     stretch it is writing, from where the hand took it to the playhead, is in record ink while it is still held (before
     anything is in autorec.writes()) */
  const redIn = (top, bottom, x0, x1) =>
    E(
      ([top, bottom, x0, x1]) => {
        const cv = document.querySelector('.ar-lanes'),
          b = cv.getBoundingClientRect(),
          k = cv.width / b.width,
          g = cv.getContext('2d');
        const img = g.getImageData(
          Math.round((x0 - b.left) * k),
          Math.round((top - b.top) * k),
          Math.max(1, Math.round((x1 - x0) * k)),
          Math.max(1, Math.round((bottom - top) * k)),
        ).data;
        let n = 0;
        for (let i = 0; i < img.length; i += 4) if (img[i] > 200 && img[i + 1] < 110 && img[i + 2] < 110) n++;
        return n;
      },
      [top, bottom, x0, x1],
    );
  const recState = await E(async (id) => {
    const o = window.overdub;
    o.arranger.hideLane(id, { param: 'pan' });
    await o.engine.start();
    o.input.recorder.setCountIn(0);
    o.ui.select({ track: id, clip: null, notes: [] });
    o.transport.marker.set(4);
    o.engine.seek(4);
    o.transport.record();
    for (let i = 0; i < 60 && o.input.recorder.state !== 'rec'; i++) await new Promise((r) => setTimeout(r, 50));
    return { state: o.input.recorder.state, open: o.arranger.laneRows().some((r) => r.key === `${id}/pan`) };
  }, tid);
  // a hand on the pan control: a move every 60 ms (a gesture stays held while it keeps moving)
  let heldView = null;
  for (let i = 0; i < 22; i++) {
    const v = await E(
      ([id, i]) => {
        const o = window.overdub;
        o.store.dispatch(
          { type: 'track.set', track: id, patch: { pan: Math.round(Math.sin(i / 3) * 80) / 100 } },
          { by: 'you', coalesce: `track:${id}:pan` },
        );
        return {
          beat: o.engine.beat,
          touching: o.input.autorec.touching().length,
          writes: o.input.autorec.writes().length,
          rows: o.arranger.laneRows().filter((r) => r.key === `${id}/pan`),
        };
      },
      [tid, i],
    );
    if (!heldView) heldView = { ...v, from: v.beat };
    heldView = { ...heldView, now: v.beat, touching: v.touching, writes: v.writes, row: v.rows[0] || null };
    await sleep(60);
  }
  await sleep(60);
  const hr = heldView.row;
  const heldRed = hr
    ? await redIn(
        hr.top,
        hr.bottom,
        await xOf(heldView.from + 0.25),
        await xOf(Math.max(heldView.from + 0.5, heldView.now - 0.25)),
      )
    : 0;
  const redBefore = hr
    ? await redIn(hr.top, hr.bottom, (await xOf(0)) + 2, await xOf(Math.max(0.5, heldView.from - 0.75)))
    : 0;
  await shot('lanes-autorec-held');
  T.ok(
    recState.state === 'rec' && !recState.open && hr,
    `R records and a control held writes its lane: the hidden Pan lane opens under its track (${JSON.stringify({ ...recState, row: !!hr })})`,
  );
  T.ok(
    heldView.touching === 1 && heldView.writes === 0 && heldRed > 40 && redBefore < 6,
    `while it is still held (nothing in writes() yet) the stretch from where the hand took it (beat ${heldView.from.toFixed(2)}) to the playhead is in record ink (${heldRed} red pixels; ${redBefore} before it)`,
  );
  await E(async () => {
    const o = window.overdub;
    o.input.recorder.cancel?.();
    o.engine.stop();
    await new Promise((r) => setTimeout(r, 150));
  });
  T.ok(
    await E(() => window.overdub.input.recorder.state === 'idle' && !window.overdub.input.autorec.recording),
    'cancelled, nothing records',
  );

  /* ---- clips under open lanes are hit where they're drawn; moving one takes the lane under it along */
  const mv = await E(() => {
    const o = window.overdub,
      p = o.store.get();
    const t = p.tracks.find((x) => x.kind === 'instrument' && x.clips.some((c) => !c.mute && c.length >= 4));
    const c = t.clips.filter((c) => !c.mute && c.length >= 4).sort((a, b) => a.start - b.start)[0];
    return { t: t.id, c: c.id, start: c.start, len: c.length };
  });
  const mvG = { track: mv.t, param: 'gain' };
  await E(
    ([t, a, b]) =>
      window.overdub.store.dispatch(
        { type: 'auto.write', track: t, param: 'gain', points: `${a + 1}:-30 ${b - 1}:-6` },
        { by: 'you', label: 'a fade' },
      ),
    [mv.t, mv.start, mv.start + mv.len],
  );
  await E((t) => window.overdub.arranger.toggleLanes(t, true), mv.t);
  await sleep(150);
  const yClip = await E((t) => window.overdub.arranger.yOf(t), mv.t);
  const xc = await xOf(mv.start + Math.min(2, mv.len / 2)),
    xTo = await xOf(mv.start + Math.min(2, mv.len / 2) + 4 * bpb);
  await page.mouse.move(xc, yClip + 6);
  await page.mouse.down();
  await page.mouse.move((xc + xTo) / 2, yClip + 6, { steps: 4 });
  await page.mouse.move(xTo, yClip + 6, { steps: 4 });
  await page.mouse.up();
  await sleep(200);
  const moved = await E((c) => window.overdub.store.findClip(c)?.clip.start, mv.c);
  L = await lane(mvG);
  T.ok(
    moved === mv.start + 4 * bpb,
    `the clip (below open lanes) is grabbed where it's drawn and moves a bar on (start ${mv.start} → ${moved})`,
  );
  T.ok(
    L &&
      L.points.some((p) => Math.abs(p.t - (mv.start + 1 + 4 * bpb)) < 1e-6 && Math.abs(p.v - -30) < 1e-6) &&
      L.points.some((p) => Math.abs(p.t - (mv.start + mv.len - 1 + 4 * bpb)) < 1e-6),
    `the lane under it goes along (${JSON.stringify(L?.points)})`,
  );
  const lt2 = await lastTxn();
  await undo();
  await sleep(100);
  L = await lane(mvG);
  T.ok(
    lt2 && /^move clip/.test(lt2.label) && lt2.n > 1,
    `the move and its lane are one step ("${lt2?.label}", ${lt2?.n} ops)`,
  );
  T.ok(
    (await E((c) => window.overdub.store.findClip(c)?.clip.start, mv.c)) === mv.start &&
      L.points.some((p) => Math.abs(p.t - (mv.start + 1)) < 1e-6),
    'one undo brings back both the clip and its lane',
  );
  // Lanes follow clips off: the lane stays put
  await E(() => window.overdub.arranger.lanesFollow(false));
  await page.mouse.move(xc, yClip + 6);
  await page.mouse.down();
  await page.mouse.move((xc + xTo) / 2, yClip + 6, { steps: 4 });
  await page.mouse.move(xTo, yClip + 6, { steps: 4 });
  await page.mouse.up();
  await sleep(200);
  L = await lane(mvG);
  T.ok(
    (await E((c) => window.overdub.store.findClip(c)?.clip.start, mv.c)) === mv.start + 4 * bpb &&
      L.points.some((p) => Math.abs(p.t - (mv.start + 1)) < 1e-6),
    'with Lanes follow clips off, the clip moves and the lane stays',
  );
  await undo();
  await E(() => window.overdub.arranger.lanesFollow(true));
  T.ok(
    await E(() => JSON.parse(localStorage.getItem('overdub:arrange') || '{}').followLanes === true),
    'the choice is kept per browser (overdub:arrange)',
  );

  /* ---- Hide, and E again hides them all; the layout goes back to one row a track */
  await page.click(`.ar-lhead[data-lane="${tid}/pan"] .ar-lhide`);
  await sleep(100);
  T.ok(!(await rowOf(`${tid}/pan`)) && !!(await rowOf(gainKey)), 'Hide hides one lane (the others stay)');
  await shot('lanes');
  await E((id) => {
    const o = window.overdub;
    o.ui.select({ track: id, clip: null, notes: [] });
    o.ui.state.focus = 'arranger';
    document.activeElement?.blur?.();
  }, tid);
  await page.keyboard.press('e');
  await E((t) => window.overdub.arranger.toggleLanes(t, false), mv.t);
  await sleep(120);
  const ys3 = await E(() => window.overdub.store.get().tracks.map((x) => window.overdub.arranger.yOf(x.id)));
  T.ok(
    (await E(() => window.overdub.arranger.laneRows())).length === 0 &&
      ys3.every((y, i) => Math.abs(y - info.ys[i]) < 0.5),
    'E again hides them: every track is back on its row',
  );

  /* ---- the budget (AUTOMATION.md 3.12): a dozen open lanes and 2,000 points in view draw well inside a frame */
  const cost = await E(() => {
    const o = window.overdub,
      p = o.store.get(),
      ops = [];
    o.arranger.zoomTo(0, 32);
    const ts = p.tracks.slice(0, 8);
    const per = Math.ceil(2000 / (ts.length * 2));
    for (const t of ts)
      for (const param of ['gain', 'pan']) {
        const pts = [];
        for (let k = 0; k < per; k++)
          pts.push({
            t: (k * 32) / per,
            v: param === 'gain' ? -30 + 20 * Math.sin(k / 5) : Math.sin(k / 7) * 0.8,
            ...(k % 3 ? { c: 0.4 } : {}),
          });
        ops.push({ type: 'auto.write', track: t.id, param, points: pts });
      }
    o.store.dispatch(ops, { by: 'you', label: 'perf lanes' });
    for (const t of ts) o.arranger.toggleLanes(t.id, true);
    const ms = [];
    for (let i = 0; i < 12; i++) ms.push(o.arranger.drawMs());
    ms.sort((a, b) => a - b);
    return { lanes: o.arranger.laneRows().length, pts: per * ts.length * 2, med: ms[6] };
  });
  T.ok(
    cost.lanes >= 12 && cost.med < 12,
    `${cost.lanes} open lanes (every track's Level and Pan) with ${cost.pts.toLocaleString('en-US')} points in view draw in ${cost.med.toFixed(2)} ms (median of 12)`,
  );
  await undo();
  await E(() => {
    const o = window.overdub;
    for (const t of o.store.get().tracks) o.arranger.toggleLanes(t.id, false);
    o.arranger.zoomTo(0, 48);
  });

  /* ---- the keyboard: Enter on an empty lane's name puts a first point at the playhead (the knob's value: nothing
     jumps) and the arrows take it from there; Shift+F10 opens the lane's menu (the selected point's curve, the shapes
     on the playhead's bar, a point at the playhead), from the lane's name and from the arrangement */
  const kt = await E(() => {
    const o = window.overdub,
      p = o.store.get();
    o.store.undo({ by: 'you' });
    for (const t of p.tracks) o.arranger.toggleLanes(t.id, false);
    const t = p.tracks.find((x) => x.kind === 'instrument' && x.instrument && !x.auto?.gain);
    o.engine.seek(8);
    o.arranger.zoomTo(0, 48);
    return t.id;
  });
  await E((id) => window.overdub.arranger.showLane(id, { param: 'gain' }), kt);
  await sleep(150);
  const kName = `.ar-lhead[data-lane="${kt}/gain"] .ar-lname`;
  const kG = { track: kt, param: 'gain' };
  const kStat = await E((id) => window.overdub.store.track(id).gain ?? 0, kt);
  await page.focus(kName);
  await page.keyboard.press('Enter');
  await sleep(120);
  let KL = await lane(kG);
  const kFocus = await E(() => document.activeElement?.className || '');
  T.ok(
    KL &&
      KL.points.length === 1 &&
      KL.points[0].t === 8 &&
      Math.abs(KL.points[0].v - kStat) < 1e-6 &&
      /ar-scroll/.test(kFocus),
    `Enter on an empty lane's name puts a first point at the playhead with the knob's value (${JSON.stringify(KL?.points)}, the knob at ${kStat}) and the arrangement takes the arrows`,
  );
  await page.keyboard.press('ArrowUp');
  await sleep(80);
  KL = await lane(kG);
  T.ok(KL && KL.points.length === 1 && KL.points[0].v > kStat, `then ↑ raises it (${KL?.points[0]?.v})`);
  await page.keyboard.press('Shift+F10');
  await sleep(120);
  const kItems = await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item, .ek-pop .ek-head')].map((b) => b.textContent),
  );
  T.ok(
    ['Delete the point', 'Ease in', 'Step', 'Ramp up', 'Swell', 'A point at the playhead'].every((w) =>
      kItems.some((x) => x.startsWith(w)),
    ) && kItems.some((x) => /^Shapes, bar 3/.test(x)),
    `Shift+F10 on the selected point opens the lane's menu: its curve, the shapes on its bar, a point at the playhead (${kItems.slice(0, 4).join(' | ')} …)`,
  );
  await page.keyboard.press('Escape');
  await sleep(80);
  await page.focus(kName);
  await page.keyboard.press('Shift+F10');
  await sleep(120);
  const kHead = await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item, .ek-pop .ek-head')].map((b) => b.textContent),
  );
  const ramp = await E(() => {
    const b = [...document.querySelectorAll('.ek-pop .ek-item')].find((x) => x.textContent.startsWith('Ramp up'));
    if (!b) return false;
    b.focus();
    return document.activeElement === b;
  });
  if (ramp) await page.keyboard.press('Enter');
  await sleep(120);
  KL = await lane(kG);
  const kTx = await lastTxn();
  T.ok(
    kHead.some((x) => x.startsWith('Ramp up')) && ramp && KL && KL.points.length >= 2 && /ramp/i.test(kTx?.label || ''),
    `Shift+F10 on the lane's name opens it too, and Enter on Ramp up writes the shape (${KL?.points.length} points, "${kTx?.label}")`,
  );
  await E((id) => {
    const o = window.overdub;
    o.store.undo({ by: 'you' });
    o.store.undo({ by: 'you' });
    o.store.undo({ by: 'you' });
    o.engine.seek(0);
    o.arranger.toggleLanes(id, false);
  }, kt);

  /* ---- a held lane's header: Back to the lane and Hide both inside the column, Hide clickable */
  const hk = await E(() => {
    const o = window.overdub,
      p = o.store.get();
    const t = p.tracks.find((x) => x.name === 'Guitar') || p.tracks[p.tracks.length - 1];
    o.store.dispatch(
      [
        { type: 'auto.write', track: t.id, param: 'gain', points: '0:-4 16:-8' },
        { type: 'auto.set', track: t.id, param: 'gain', patch: { off: true } },
      ],
      { by: 'you', label: 'a held lane' },
    );
    o.arranger.toggleLanes(t.id, true);
    return t.id;
  });
  await sleep(150);
  const hm = await E((id) => {
    const head = document.querySelector(`.ar-lhead[data-lane="${id}/gain"]`),
      r = head.getBoundingClientRect();
    const box = (sel) => {
      const b = head.querySelector(sel);
      if (!b) return null;
      const q = b.getBoundingClientRect();
      const hitEl = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return { l: q.left, r: q.right, w: q.width, hit: !!hitEl && b.contains(hitEl) };
    };
    return {
      held: head.classList.contains('held'),
      r: r.right,
      l: r.left,
      over: head.scrollWidth - head.clientWidth,
      back: box('.ar-lback'),
      hide: box('.ar-lhide'),
    };
  }, hk);
  T.ok(
    hm.held &&
      hm.back &&
      hm.hide &&
      hm.over <= 0 &&
      hm.back.r <= hm.r + 0.5 &&
      hm.hide.r <= hm.r + 0.5 &&
      hm.hide.hit &&
      hm.back.hit,
    `a held lane's header fits its column: Back to the lane (${Math.round(hm.back?.l)}–${Math.round(hm.back?.r)}) and Hide (${Math.round(hm.hide?.l)}–${Math.round(hm.hide?.r)}) end inside it (${Math.round(hm.r)}), and Hide takes the click`,
  );
  await E((id) => {
    const o = window.overdub;
    o.store.undo({ by: 'you' });
    o.arranger.toggleLanes(id, false);
  }, hk);

  /* ==== fresh eyes 3 (docs/FRESH-EYES-3.md): editing with the value in view, finding lanes, credit, copy, the master ==== */
  // a clean Level lane on the first instrument track: -30 dB at bars 1, 5 and 9 (a flat line well under unity)
  const fe = await E((id) => {
    const o = window.overdub,
      p = o.store.get(),
      t = p.tracks.find((x) => x.id === id);
    const ops = [];
    if (t.auto?.gain) ops.push({ type: 'auto.clear', track: id, param: 'gain' });
    if (t.auto?.pan) ops.push({ type: 'auto.clear', track: id, param: 'pan' });
    ops.push({ type: 'auto.write', track: id, param: 'gain', points: '0:-30 16:-30 32:-30' });
    o.store.dispatch(ops, { by: 'you', label: 'a flat lane' });
    o.engine.seek(0);
    o.arranger.zoomTo(0, 48);
    o.ui.state.snap = 1;
    o.arranger.showLane(id, { param: 'gain' });
    return o.store.history.length;
  }, tid);
  await sleep(250);
  // 1. a value tip at the cursor: hovering a point, hovering empty lane, dragging
  let x1 = await xOf(16),
    y1 = await yAt(gainKey, -30);
  await page.mouse.move(x1 - 40, y1 - 2);
  await page.mouse.move(x1, y1, { steps: 3 });
  await sleep(80);
  let tip = await E(() => {
    const t = document.querySelector('.ar-ltip');
    return t && !t.hidden
      ? { text: t.textContent, x: t.getBoundingClientRect().left, y: t.getBoundingClientRect().top }
      : null;
  });
  T.ok(
    tip &&
      /^-30\.0 dB/.test(tip.text) &&
      /bar 5/.test(tip.text) &&
      Math.abs(tip.x - (x1 + 14)) < 30 &&
      Math.abs(tip.y - (y1 - 28)) < 30,
    `hovering a point shows its value at the cursor ("${tip?.text}" at ${Math.round(tip?.x)}, ${Math.round(tip?.y)}; cursor ${Math.round(x1)}, ${Math.round(y1)})`,
  );
  const yHigh = await yAt(gainKey, 0);
  await page.mouse.move(await xOf(9), yHigh, { steps: 3 });
  await sleep(60);
  tip = await E(() => document.querySelector('.ar-ltip:not([hidden])')?.textContent || '');
  T.ok(
    /^[-+]?0\.\d dB|^-0\.\d dB|^\+?0\.0 dB/.test(tip) || /^[-+]?[0-1]\.\d dB/.test(tip),
    `over empty lane at unity height it says what a click there writes ("${tip}")`,
  );
  // the very top of the gain lane is the fader's +6 dB, not +24
  const rr = await rowOf(gainKey);
  await sleep(450);
  await page.mouse.click(await xOf(8), rr.top + 2);
  await sleep(150);
  L = await lane(G);
  const top8 = L.points.find((p) => p.t === 8);
  T.ok(
    top8 && Math.abs(top8.v - 6) < 0.05,
    `a click at the very top of a Level lane writes the fader's top, +6 dB (${top8?.v?.toFixed(2)} dB; it went to +24)`,
  );
  await undo();
  await sleep(80);
  // dragging: the tip follows with the value as it changes
  await sleep(450);
  x1 = await xOf(16);
  y1 = await yAt(gainKey, -30);
  const yM12 = await yAt(gainKey, -12);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1, (y1 + yM12) / 2, { steps: 3 });
  await page.mouse.move(x1, yM12, { steps: 3 });
  const dragTip = await E(() => document.querySelector('.ar-ltip:not([hidden])')?.textContent || '');
  await page.mouse.up();
  await sleep(120);
  L = await lane(G);
  const v16 = L.points.find((p) => p.t === 16)?.v;
  T.ok(
    /dB/.test(dragTip) && Math.abs(parseFloat(dragTip.replace('−', '-')) - v16) < 0.06,
    `dragging a point, the tip reads its value as it goes ("${dragTip}"; landed at ${v16?.toFixed(2)} dB)`,
  );
  // the keyboard: → picks the next point and the tip sits on it
  await page.keyboard.press('ArrowRight');
  await sleep(80);
  tip = await E(() => document.querySelector('.ar-ltip:not([hidden])')?.textContent || '');
  T.ok(/^-30\.0 dB/.test(tip) && /bar 9/.test(tip), `a point picked from the keyboard shows its value too ("${tip}")`);
  await undo();
  await sleep(80);
  // a 0 dB guide on a gain lane: a dotted pencil hairline at unity, nothing a few pixels under it
  const guide = await E(
    ([k]) => {
      const o = window.overdub,
        cv = document.querySelector('canvas.ar-lanes'),
        g = cv.getContext('2d'),
        r = cv.getBoundingClientRect(),
        dpr = cv.width / r.width;
      const y0 = Math.round(o.arranger.laneY(k, 0) - r.top);
      const lit = (yy) => {
        const d = g.getImageData(0, Math.round(yy * dpr), cv.width, 1).data,
          bg = [d[0], d[1], d[2]];
        let n = 0,
          all = 0;
        for (let i = 0; i < d.length; i += 4 * Math.round(dpr)) {
          all++;
          if (Math.abs(d[i] - 20) + Math.abs(d[i + 1] - 18) + Math.abs(d[i + 2] - 16) > 30) n++;
        }
        return n / all;
      };
      return { at: Math.max(lit(y0), lit(y0 + 1), lit(y0 - 1)), below: lit(y0 + 5) };
    },
    [gainKey],
  );
  T.ok(
    guide.at > 0.2 && guide.at > guide.below * 2,
    `a Level lane draws a 0 dB guide (${Math.round(guide.at * 100)}% of the row at unity is inked, ${Math.round(guide.below * 100)}% just under it)`,
  );

  // 1. a lane's lower edge drags its height, remembered for that lane (across a reload)
  rows = await E(() => window.overdub.arranger.laneRows());
  const r0 = rows.find((r) => r.key === gainKey);
  const ysBefore = await E(() => window.overdub.store.get().tracks.map((x) => window.overdub.arranger.yOf(x.id)));
  const grip = await E((k) => {
    const g = document.querySelector(`.ar-lhead[data-lane="${k}"] .ar-lsize`);
    const r = g?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, gainKey);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x, grip.y + 15, { steps: 3 });
  await page.mouse.move(grip.x, grip.y + 30, { steps: 3 });
  await page.mouse.up();
  await sleep(150);
  rows = await E(() => window.overdub.arranger.laneRows());
  const r1 = rows.find((r) => r.key === gainKey);
  const hh1 = await E(
    (k) => document.querySelector(`.ar-lhead[data-lane="${k}"]`)?.getBoundingClientRect().height,
    gainKey,
  );
  const ysAfter = await E(() => window.overdub.store.get().tracks.map((x) => window.overdub.arranger.yOf(x.id)));
  T.ok(
    r1 &&
      r1.h === r0.h + 30 &&
      Math.abs(hh1 - r1.h) < 1 &&
      ysAfter.every((y, i) => i <= info.i || Math.abs(y - ysBefore[i] - 30) < 0.5),
    `dragging a lane's lower edge 30 px down makes it ${r1?.h} px (was ${r0.h}); its header follows (${hh1}) and the tracks below move down 30`,
  );
  T.ok(
    await E((k) => JSON.parse(localStorage.getItem('overdub:lanes') || '{}').h?.[k] === 70, gainKey),
    'the height is remembered for that lane (overdub:lanes)',
  );
  T.ok(
    await E((k) => !!document.querySelector(`.ar-lhead[data-lane="${k}"] .ar-lsize[role="separator"]`), gainKey),
    'the edge is a separator from the keyboard too',
  );
  // …and from the keyboard it keeps going: the headers are rebuilt as the height lands, and the focus stays on the edge
  await page.focus(`.ar-lhead[data-lane="${gainKey}"] .ar-lsize`);
  const kh = [];
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('ArrowDown');
    await sleep(60);
    kh.push((await rowOf(gainKey)).h);
  }
  const gripFocus = await E(
    (k) =>
      document.activeElement?.classList.contains('ar-lsize') &&
      document.activeElement.closest('.ar-lhead')?.dataset.lane === k,
    gainKey,
  );
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('ArrowUp');
    await sleep(60);
  }
  const kBack = (await rowOf(gainKey)).h;
  T.ok(
    kh.join() === `${r1.h + 8},${r1.h + 16},${r1.h + 24}` && gripFocus && kBack === r1.h,
    `↓ on a lane's edge, three times: ${kh.join(', ')} px, the focus still on the edge; ↑ three times back to ${kBack} (it stopped after one press)`,
  );

  // 2. a dragged point stays between its neighbours: the bar-1 point dragged to bar 7 stops a beat short of bar 5
  await sleep(450);
  x1 = await xOf(0);
  y1 = await yAt(gainKey, -30);
  const x7 = await xOf(24);
  await page.mouse.move(x1 + 1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x7) / 2, y1, { steps: 4 });
  await page.mouse.move(x7, y1, { steps: 4 });
  await page.mouse.up();
  await sleep(150);
  L = await lane(G);
  T.ok(
    L.points.length === 3 && L.points[0].t === 15 && L.points[1].t === 16 && L.points[1].v === -30,
    `a point dragged past its neighbour stops a grid step short of it (${JSON.stringify(L.points.map((p) => p.t))}); the neighbour stays`,
  );
  await undo();
  await sleep(80);
  T.ok((await lane(G)).points[0].t === 0, 'one undo puts it back');
  // a gain point above the drawn top (+6 dB): the agent's +12 moved sideways stays +12, ↑ leaves it, ↓ takes it down
  // from +12 (all three made it +6)
  const g12 = await lane(G);
  await E(
    (id) =>
      window.overdub.store.dispatch(
        { type: 'auto.write', track: id, param: 'gain', points: '0:-6 8:12 16:12 24:-6' },
        { by: 'claude', label: 'up' },
      ),
    tid,
  );
  await sleep(450);
  {
    const xa = await xOf(16),
      xb = await xOf(18),
      yy = await yAt(gainKey, 12);
    await page.mouse.move(xa, yy + 1);
    await page.mouse.down();
    await page.mouse.move((xa + xb) / 2, yy + 1, { steps: 4 });
    await page.mouse.move(xb, yy + 1, { steps: 4 });
    await page.mouse.up();
  }
  await sleep(150);
  const side = (await lane(G)).points.map((q) => `${q.t}:${Math.round(q.v * 100) / 100}`).join(' ');
  await page.keyboard.press('ArrowUp');
  await sleep(60);
  const afterUp = (await lane(G)).points.find((q) => q.t === 18)?.v;
  await page.keyboard.press('ArrowDown');
  await sleep(60);
  const afterDn = (await lane(G)).points.find((q) => q.t === 18)?.v;
  T.ok(
    side.startsWith('0:-6 8:12 18:12 24:-6') && afterUp === 12 && afterDn > 11 && afterDn < 12,
    `the agent's +12 dB point dragged sideways stays +12 (${side}); ↑ leaves it at ${afterUp}, ↓ makes it ${afterDn?.toFixed(2)} (they made it +6)`,
  );
  await undo();
  await undo();
  await E(() => window.overdub.store.undo({ by: 'claude' }));
  await sleep(100);
  T.ok(JSON.stringify(await lane(G)) === JSON.stringify(g12), 'undo puts the lane back');

  // 3. finding lanes: the lane's name is a chooser (device and param); "+ lane" opens one more; E with no track
  await page.click(`.ar-lhead[data-lane="${gainKey}"] .ar-lname`);
  await sleep(120);
  const chooser = await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item, .ek-pop .ek-head')].map((b) =>
      b.className.includes('ek-head') ? '#' + b.textContent : b.textContent,
    ),
  );
  T.ok(
    chooser[0]?.startsWith('#Level on') &&
      chooser.some((x) => x.startsWith('Pan')) &&
      chooser.filter((x) => x.startsWith('#')).length >= 2,
    `clicking the lane's name lists the params to show, by device (${chooser.slice(0, 6).join(' | ')} …)`,
  );
  await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item')].find((b) => b.textContent.startsWith('Pan'))?.click(),
  );
  await sleep(150);
  rows = await E(() => window.overdub.arranger.laneRows());
  T.ok(
    rows.some((r) => r.key === `${tid}/pan`) && !rows.some((r) => r.key === gainKey) && !!(await lane(G)),
    `picking Pan shows Pan in its place; Level is hidden and still plays (${rows.map((r) => r.key).join(', ')})`,
  );
  const addBtn = await E((id) => {
    const b = [...document.querySelectorAll('.ar-lhead .ar-ladd')].find((x) =>
      x.closest('.ar-lhead').dataset.lane.startsWith(id + '/'),
    );
    return b ? `.ar-lhead[data-lane="${b.closest('.ar-lhead').dataset.lane}"] .ar-ladd` : '.none';
  }, tid);
  T.ok(await E((s) => !!document.querySelector(s), addBtn), 'the track\'s last lane has "+ lane"');
  await page.click(addBtn);
  await sleep(120);
  await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item')].find((b) => b.textContent.startsWith('Level'))?.click(),
  );
  await sleep(150);
  rows = await E(() => window.overdub.arranger.laneRows());
  T.ok(
    rows.some((r) => r.key === gainKey) && rows.some((r) => r.key === `${tid}/pan`),
    `+ lane opens Level again beside Pan (${rows.map((r) => r.key).join(', ')})`,
  );
  await E(() => {
    const o = window.overdub;
    o.ui.select({ track: null, clip: null, notes: [], range: null });
    o.ui.state.focus = 'arranger';
    document.activeElement?.blur?.();
  });
  await page.keyboard.press('e');
  await sleep(150);
  const eToast = await E(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '));
  T.ok(/Select a track first/.test(eToast), `E with no track selected says so ("${eToast.slice(0, 80)}")`);

  // 4. credit per point: you drew the fade-in, the agent the fade-out; the header says both
  await E((id) => {
    const o = window.overdub;
    o.store.dispatch(
      { type: 'auto.write', track: id, param: 'gain', from: 32, to: 48, points: '32:-30 48:-60' },
      { by: 'claude', label: 'fade out' },
    );
  }, tid);
  await sleep(200);
  L = await lane(G);
  const credit = await E(
    (k) =>
      [...(document.querySelector(`.ar-lhead[data-lane="${k}"] .ar-lby`)?.querySelectorAll('.by') || [])]
        .map((b) => b.textContent)
        .join(' and '),
    gainKey,
  );
  const lby = await E((k) => document.querySelector(`.ar-lhead[data-lane="${k}"] .ar-lby`)?.textContent || '', gainKey);
  T.ok(
    L.by === 'claude' &&
      L.points.filter((p) => p.by === 'you').length === 3 &&
      L.points.filter((p) => !p.by).length === 1 &&
      /you and Claude/.test(lby),
    `a lane you and the agent both wrote keeps your points yours (${L.points.map((p) => `${p.t}:${p.by || L.by}`).join(' ')}) and reads "${lby}" (${credit})`,
  );
  await E(() => window.overdub.store.undo({ by: 'claude' }));
  await sleep(150);
  T.ok(
    !(await lane(G)).points.some((p) => 'by' in p) &&
      (await lane(G)).by === 'you' &&
      !(await E((k) => document.querySelector(`.ar-lhead[data-lane="${k}"] .ar-lby`), gainKey)),
    "undo takes the agent's points back and the lane is yours alone again",
  );

  // 5. ⌘C / ⌘V: points copied, pasted at the playhead in one undo step
  await E(
    ([id]) => {
      const o = window.overdub;
      o.store.dispatch(
        { type: 'auto.write', track: id, param: 'gain', from: 0, to: 16, points: '0:-30 4:-6 8:-24 16:-30' },
        { by: 'you', label: 'a shape' },
      );
    },
    [tid],
  );
  await sleep(120);
  await E((id) => {
    window.overdub.arranger.selectLaneRange(id, { param: 'gain' }, 0, 8);
  }, tid);
  await E(() => {
    window.overdub.ui.state.focus = 'arranger';
    document.querySelector('.ar-scroll')?.focus();
  });
  await page.keyboard.press('Meta+c');
  await sleep(100);
  await E(() => window.overdub.engine.seek(40));
  const nHist = await E(() => window.overdub.store.history.length);
  await page.keyboard.press('Meta+v');
  await sleep(150);
  L = await lane(G);
  const pasted = L.points
    .filter((p) => p.t >= 40 && p.t <= 48)
    .map((p) => `${p.t}:${Math.round(p.v)}`)
    .join(' ');
  const hist2 = await E(() => window.overdub.store.history.length);
  T.ok(
    /40:-30 44:-6 48:-24/.test(pasted) && hist2 === nHist + 1,
    `⌘C then ⌘V pastes the selected points at the playhead (bar 11: ${pasted}), one undo step`,
  );
  await undo();
  await sleep(100);
  T.ok(!(await lane(G)).points.some((p) => p.t === 44), 'one undo takes the paste back');
  // a selection left on a lane that has since been hidden: ⌘V never writes there. With only another track's Level
  // lane showing, the points land on that one, and the toast names the track
  {
    const other = await E(
      (id) =>
        window.overdub.store
          .get()
          .tracks.find((t) => t.id !== id && !t.auto && !t.instrument?.auto && !(t.inserts || []).some((x) => x.auto))
          ?.id,
      tid,
    );
    const before = JSON.stringify(await lane(G));
    await E((id) => {
      window.overdub.arranger.selectLaneRange(id, { param: 'gain' }, 4, 4);
    }, tid);
    await E(
      ([a, b]) => {
        const o = window.overdub;
        o.arranger.toggleLanes(a, false);
        o.arranger.toggleLanes(b, true);
        o.engine.seek(64);
        o.ui.state.focus = 'arranger';
        document.querySelector('.ar-scroll')?.focus();
      },
      [tid, other],
    );
    await sleep(150);
    const showing = (await E(() => window.overdub.arranger.laneRows())).map((r) => r.key);
    await page.keyboard.press('Meta+v');
    await sleep(150);
    const hidden = JSON.stringify(await lane(G)),
      onOther = await lane({ track: other, param: 'gain' });
    const oname = await E((id) => window.overdub.store.track(id)?.name, other);
    const ptoast = await E(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '));
    T.ok(
      showing.join() === `${other}/gain` &&
        hidden === before &&
        onOther &&
        onOther.points.filter((q) => q.t >= 64).length > 1 &&
        ptoast.includes(`${oname}'s Level lane`),
      `⌘V with the selection on a lane since hidden leaves that lane alone (${hidden === before ? 'unchanged' : 'CHANGED'}) and pastes on the one lane showing, ${oname}'s (${onOther ? onOther.points.length : 0} points; "${ptoast.slice(0, 90)}")`,
    );
    if (onOther) await undo();
    await E(
      ([a, b]) => {
        const o = window.overdub;
        o.arranger.toggleLanes(b, false);
        o.arranger.toggleLanes(a, true);
      },
      [tid, other],
    );
    await sleep(100);
  }

  // 5. the master's lanes: from Add a lane… (Master level), a block under the last track, a click writes the master
  await E((id) => window.overdub.arranger.toggleLanes(id, true), tid);
  await sleep(100);
  await E(() => document.querySelector('.ar-lhead .ar-ladd')?.click());
  await sleep(120);
  const madd = await E(() => [...document.querySelectorAll('.ek-pop .ek-head')].map((b) => b.textContent));
  await E(() => document.querySelector('.ek-pop')?.remove());
  await E((id) => {
    const o = window.overdub;
    const t = o.store.get().tracks.find((x) => x.id === id);
    return o.arranger.showLane('master', { param: 'gain' });
  }, tid);
  await sleep(250);
  const mrow = (await E(() => window.overdub.arranger.laneRows())).find((r) => r.key === 'master/gain');
  const mhead = await E(() => document.querySelector('.ar-mhead')?.textContent || '');
  T.ok(
    mrow && mrow.track === 'master' && /Master/.test(mhead),
    `the master gets a block of its own under the last track: "${mhead}", its Level lane at ${Math.round(mrow?.top || 0)} px`,
  );
  await E(() => {
    const o = window.overdub;
    const r = o.arranger.laneRows().find((x) => x.key === 'master/gain');
    document.querySelector('.ar-scroll').scrollTop += Math.max(
      0,
      r.bottom - (document.querySelector('.ar-scroll').getBoundingClientRect().bottom - 20),
    );
  });
  await sleep(200);
  const mr2 = (await E(() => window.overdub.arranger.laneRows())).find((r) => r.key === 'master/gain');
  await sleep(450);
  await page.mouse.click(await xOf(8), await yAt('master/gain', -40));
  await sleep(150);
  const ml = await E(() => JSON.parse(JSON.stringify(window.overdub.store.get().master.auto?.gain || null)));
  T.ok(
    ml && ml.points.some((p) => p.t === 8 && Math.abs(p.v + 40) < 4) && ml.by === 'you',
    `a click on it writes the master fader's lane (${JSON.stringify(ml?.points)}); the menu lists the master too (${madd.join(', ')})`,
  );
  await undo();
  await sleep(100);
  await E(() => window.overdub.arranger.toggleLanes('master', false));

  // 6. Pulse has a rate and a depth
  await E((id) => {
    const o = window.overdub;
    document.querySelector('.ar-scroll').scrollTop = 0;
    o.arranger.showLane(id, { param: 'gain' });
    o.arranger.selectLaneRange(id, { param: 'gain' }, 16, 32);
  }, tid);
  await sleep(200);
  rows = await E(() => window.overdub.arranger.laneRows());
  const gr = rows.find((r) => r.key === gainKey);
  await page.mouse.click(await xOf(20), gr.top + gr.h / 2, { button: 'right' });
  await sleep(120);
  const hasPulse = await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item')].some((b) => b.textContent.startsWith('Pulse…')),
  );
  const menu1 = await E(() => [...document.querySelectorAll('.ek-pop .ek-head')].map((b) => b.textContent).join(' | '));
  // (a right-click on the selection keeps it: the shapes are on bars 5–8)
  await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item')].find((b) => b.textContent.startsWith('Pulse…'))?.click(),
  );
  await sleep(150);
  const rates = await E(() => [...document.querySelectorAll('.ek-pop .ek-item')].map((b) => b.textContent));
  await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item')].find((b) => b.textContent.startsWith('1/8'))?.click(),
  );
  await sleep(150);
  L = await lane(G);
  const inP = L.points.filter((p) => p.t > 16 && p.t < 32);
  const gaps = new Set(inP.slice(1).map((p, i) => p.t - inP[i].t));
  T.ok(
    hasPulse &&
      rates.some((x) => x.startsWith('1/16')) &&
      rates.some((x) => x.startsWith('100%')) &&
      inP.length >= 28 &&
      gaps.size === 1 &&
      gaps.has(0.5),
    `Pulse… offers a rate and a depth; 1/8 steps every half beat (${inP.length} points, gaps ${[...gaps].join(',')}; ${menu1})`,
  );
  const span1 = Math.max(...inP.map((p) => p.v)) - Math.min(...inP.map((p) => p.v));
  await page.mouse.click(await xOf(20), gr.top + gr.h / 2, { button: 'right' });
  await sleep(120);
  await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item')].find((b) => b.textContent.startsWith('Pulse…'))?.click(),
  );
  await sleep(150);
  await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item')].find((b) => b.textContent.startsWith('100%'))?.click(),
  );
  await sleep(150);
  L = await lane(G);
  const inP2 = L.points.filter((p) => p.t > 16 && p.t < 32);
  const span2 = Math.max(...inP2.map((p) => p.v)) - Math.min(...inP2.map((p) => p.v));
  const tx2 = await lastTxn();
  T.ok(
    span2 > span1 + 5 && inP2.length === inP.length && /pulse, 1\/8 at 100%/.test(tx2?.label || ''),
    `depth 100% swings further (${span1.toFixed(1)} → ${span2.toFixed(1)} dB) at the same rate ("${tx2?.label}")`,
  );
  await E(() => {
    const o = window.overdub;
    o.store.undo({ by: 'you' });
    o.store.undo({ by: 'you' });
    o.store.undo({ by: 'you' });
  });
  await E((id) => window.overdub.arranger.toggleLanes(id, false), tid);
  await sleep(100);

  /* ---- the kit: no stripes, no pills in the lanes' CSS */
  const cssText = await E(() =>
    [...document.querySelectorAll('style')]
      .map((s) => s.textContent)
      .join('\n')
      .split('\n')
      .filter((l) => /ar-l(head|row|name|dev|by|held|acts|val)|ar-hb-auto/.test(l))
      .join('\n'),
  );
  T.ok(
    cssText.length > 0 &&
      !/inset\s+\d+px\s+0\s+0/.test(cssText) &&
      !/99px|50%\s*;/.test(cssText.replace(/max-width: 60%/, '')),
    "the lanes' CSS has no stripe and no pill",
  );

  const bad = errors.filter((e) => !ignorable(e));
  T.ok(!bad.length, `no console errors (${bad.slice(0, 3).join(' | ')})`);

  /* ---- a phone: a 48 px lane, a tap adds a point, a finger drags it, a hold opens the point's menu */
  const ctx = await s.browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    permissions: ['microphone'],
  });
  const ph = await ctx.newPage();
  const perr = [];
  ph.on('pageerror', (e) => perr.push(String(e)));
  await ph.goto(s.base + '/app/?demo', { waitUntil: 'load' });
  await ph.evaluate(() => localStorage.setItem('overdub:welcomed', '1'));
  await ph.reload({ waitUntil: 'load' });
  await ph.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await ph.waitForTimeout(600);
  const PE = (fn, a) => ph.evaluate(fn, a);
  const pt = await PE(() => {
    const o = window.overdub,
      p = o.store.get();
    const t = p.tracks[0];
    o.arranger.zoomTo(0, 16);
    o.ui.state.snap = 1;
    return { id: t.id, bpb: p.meter[0] * (4 / p.meter[1]) };
  });
  const ok1 = await PE((id) => window.overdub.arranger.showLane(id, { param: 'gain' }), pt.id);
  await ph.waitForTimeout(200);
  const pr = (await PE(() => window.overdub.arranger.laneRows()))[0];
  T.ok(ok1 && pr && pr.h === 48, `on a phone a lane is 48 px (${pr?.h})`);
  // its header is all one target: the name's button (Draw and Hide aren't shown here), not a 29x14 word
  const phHead = await PE((k) => {
    const head = document.querySelector(`.ar-lhead[data-lane="${k}"]`),
      r = head.getBoundingClientRect();
    let n = 0,
      on = 0;
    for (let x = r.left + 3; x < r.right - 2; x += 6)
      for (let y = r.top + 3; y < r.bottom - 2; y += 6) {
        n++;
        if (document.elementFromPoint(x, y)?.closest('.ar-lname')) on++;
      }
    return { w: Math.round(r.width), h: Math.round(r.height), n, on };
  }, pr.key);
  T.ok(
    phHead.n > 50 && phHead.on === phHead.n,
    `on a phone the whole lane header (${phHead.w}x${phHead.h}) is the name's button: ${phHead.on} of ${phHead.n} points on it`,
  );
  const cdp = await ctx.newCDPSession(ph);
  const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map(([x, y]) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 })),
    });
  const pxOf = (b) => PE((b) => window.overdub.arranger.xOf(b), b);
  const tx = await pxOf(pt.bpb * 1 + 0.1),
    ty = pr.top + 12;
  await touch('touchStart', [[tx, ty]]);
  await sleep(60);
  await touch('touchEnd', []);
  await ph.waitForTimeout(250);
  let PL = await PE(
    (id) => JSON.parse(JSON.stringify(window.overdub.store.get().tracks.find((t) => t.id === id).auto?.gain || null)),
    pt.id,
  );
  T.ok(
    PL && PL.points.length === 2 && PL.points[1].t === pt.bpb,
    `a tap on the lane adds a point at bar 2 (${JSON.stringify(PL?.points)})`,
  );
  // a finger on the point, dragged at once, scrolls (as on a clip): the point stays
  const px0 = await pxOf(pt.bpb),
    py0 = await PE(([k, v]) => window.overdub.arranger.laneY(k, v), [pr.key, PL.points[1].v]);
  const px1 = await pxOf(2 * pt.bpb + 0.2);
  const before1 = JSON.stringify(PL);
  await ph.waitForTimeout(450);
  await touch('touchStart', [[px0 + 4, py0 + 4]]);
  for (let k = 1; k <= 8; k++) {
    await touch('touchMove', [[px0 + 4 + ((px1 - px0) * k) / 8, py0 + 4]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await ph.waitForTimeout(250);
  PL = await PE(
    (id) => JSON.parse(JSON.stringify(window.overdub.store.get().tracks.find((t) => t.id === id).auto?.gain || null)),
    pt.id,
  );
  T.ok(
    JSON.stringify(PL) === before1,
    `a finger dragged straight off a point scrolls and leaves it where it was (${JSON.stringify(PL?.points[1])})`,
  );
  await PE(() => window.overdub.arranger.zoomTo(0, 16));
  await ph.waitForTimeout(200);
  // held still, the point is picked up (its menu opens); a drag from there moves it a bar on
  const qx0 = await pxOf(pt.bpb),
    qx1 = await pxOf(2 * pt.bpb + 0.2);
  await ph.waitForTimeout(450);
  await touch('touchStart', [[qx0 + 4, py0 + 4]]);
  await sleep(700);
  const liftMenu = await PE(() => document.querySelectorAll('.ek-pop .ek-item').length);
  for (let k = 1; k <= 8; k++) {
    await touch('touchMove', [[qx0 + 4 + ((qx1 - qx0) * k) / 8, py0 + 4]]);
    await sleep(16);
  }
  const menuAfter = await PE(() => document.querySelectorAll('.ek-pop .ek-item').length);
  await touch('touchEnd', []);
  await ph.waitForTimeout(250);
  PL = await PE(
    (id) => JSON.parse(JSON.stringify(window.overdub.store.get().tracks.find((t) => t.id === id).auto?.gain || null)),
    pt.id,
  );
  T.ok(
    liftMenu > 0 && menuAfter === 0 && PL && PL.points.length === 2 && PL.points[1].t === 2 * pt.bpb,
    `a finger held on the point (a 40 px reach) picks it up, its menu open (${liftMenu} items); dragged from there, the menu goes and the point moves to bar 3 (${JSON.stringify(PL?.points[1])})`,
  );
  // touch and hold the point: its menu
  const hx = await pxOf(2 * pt.bpb),
    hy = await PE(([k, v]) => window.overdub.arranger.laneY(k, v), [pr.key, PL.points[1].v]);
  await ph.waitForTimeout(450);
  await touch('touchStart', [[hx + 3, hy - 3]]);
  await sleep(700);
  await touch('touchEnd', []);
  await ph.waitForTimeout(200);
  const pitems = await PE(() => [...document.querySelectorAll('.ek-pop .ek-item')].map((b) => b.textContent));
  T.ok(
    ['Delete the point', 'Straight', 'Ease in', 'Ease out', 'Step'].every((w) => pitems.some((t) => t.startsWith(w))) &&
      pitems.some((t) => t.startsWith('Ramp up')),
    `holding a point opens its menu: curve and shapes (${pitems.slice(0, 6).join(', ')})`,
  );
  // a dense lane (a point on every beat) is a field of 40 px targets: a vertical swipe across it scrolls the arranger
  // and moves nothing (it used to grab a point and push Level to +24 dB)
  await PE(
    () =>
      document.querySelector('.ek-pop') &&
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  await PE((id) => {
    const o = window.overdub;
    const pts = [];
    for (let b = 0; b <= 32; b++) pts.push(`${b}:${(-6 + 4 * Math.sin(b)).toFixed(2)}`);
    o.store.dispatch(
      { type: 'auto.write', track: id, param: 'gain', points: pts.join(' ') },
      { by: 'claude', label: 'dense' },
    );
    o.arranger.zoomTo(0, 16);
  }, pt.id);
  await ph.waitForTimeout(300);
  const dense0 = await PE((id) => {
    const sc = document.querySelector('.ar-scroll');
    sc.scrollTop = 0;
    const o = window.overdub;
    return {
      pts: JSON.stringify(o.store.get().tracks.find((t) => t.id === id).auto.gain.points),
      hist: o.store.history.length,
      room: sc.scrollHeight - sc.clientHeight,
    };
  }, pt.id);
  const dr = (await PE(() => window.overdub.arranger.laneRows()))[0];
  const sx2 = await pxOf(2),
    sy2 = dr.top + dr.h / 2;
  await ph.waitForTimeout(450);
  await touch('touchStart', [[sx2, sy2]]);
  for (let k = 1; k <= 10; k++) {
    await touch('touchMove', [[sx2, sy2 - 15 * k]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await ph.waitForTimeout(250);
  const dense1 = await PE((id) => {
    const o = window.overdub;
    return {
      pts: JSON.stringify(o.store.get().tracks.find((t) => t.id === id).auto.gain.points),
      hist: o.store.history.length,
      top: document.querySelector('.ar-scroll').scrollTop,
    };
  }, pt.id);
  T.ok(
    dense0.room > 20 && dense1.top > 20 && dense1.pts === dense0.pts && dense1.hist === dense0.hist,
    `a one-finger swipe up across a dense lane scrolls the arranger (scrollTop ${dense1.top} of ${dense0.room}) and leaves every point where it was (${dense1.pts === dense0.pts ? 'unchanged' : 'MOVED'}, ${dense1.hist - dense0.hist} new edits)`,
  );
  await ph.screenshot({ path: path.join(OUTDIR, 'lanes-phone.png') });
  T.ok(!perr.length, `no page errors on the phone (${perr.slice(0, 2).join(' | ')})`);
  await ctx.close();
} catch (e) {
  T.ok(false, 'lanes test threw: ' + ((e && e.stack) || e));
} finally {
  await close();
  T.done();
}
