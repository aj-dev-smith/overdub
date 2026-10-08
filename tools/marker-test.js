// The start marker [ui-arrange] (app/src/ui/transport.js, the ruler in app/src/ui/arranger.js): work a song bar by
// bar. Real key and pointer events: select bar 4, Space, Space, and the playhead is back on bar 4; Shift+Space plays on
// from where it stopped; a click on the ruler or in a lane moves the marker; Home puts it at bar 1; with the loop on, Space
// still plays from the marker (it cycles once the playhead is in the loop); R records from the marker; the killswitch and an agent's play come back
// to it; it survives a reload; it is drawn on the ruler apart from the playhead, and its place is announced.
//   node tools/marker-test.js      (screenshot: tools/.out/marker-ruler.png)
import { open, tally } from './pw.js';

const T = tally('marker');
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g/.test(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    o.arranger.zoomTo?.(0, 48);
  });
  await page.waitForTimeout(200);

  const st = () =>
    E(() => {
      const o = window.overdub;
      return {
        marker: o.transport.marker.beat,
        beat: o.engine.beat,
        playing: o.engine.playing,
        from: document.querySelector('.tp-pos-unit')?.textContent,
        pos: document.querySelector('.tp-pos-bar')?.textContent,
        said: document.querySelector('.ew-announce')?.textContent || '',
        label: document.querySelector('.tp-pos')?.getAttribute('aria-label') || '',
      };
    });
  const bpb = await E(() => {
    const m = window.overdub.store.get().meter;
    return m[0] * (4 / m[1]);
  });
  const xOf = (b) => E((b) => window.overdub.arranger.xOf(b), b);
  const ruler = await page.$('.ar-rulerwrap').then((x) => x.boundingBox());
  const barY = ruler.y + ruler.height - 8; // the bar numbers' strip
  const neutral = async () => {
    await E(() => document.activeElement?.blur?.());
  };
  const waitStopped = async () => {
    for (let i = 0; i < 40 && (await E(() => window.overdub.engine.playing)); i++) await sleep(50);
    await sleep(120);
  };

  let r = await st();
  T.ok(
    r.marker === 0 && r.beat === 0 && /from bar 1/.test(r.from),
    `a new song plays from bar 1 (marker ${r.marker}, "${r.from}")`,
  );
  T.ok(
    await E(() => window.overdub.ui.keys.list().some((k) => k.key === 'Space' && k.mod === 'shift')),
    'Shift+Space is a declared key',
  );

  /* ---- select bar 4 (drag over it in a lane), Space, Space: back on bar 4 */
  const lane = await E((bpb) => {
    const o = window.overdub,
      p = o.store.get();
    // a track with no clip over bars 4-5, else the first track (a drag over a clip moves it, so find empty lane)
    const t = p.tracks.find((t) => !t.clips.some((c) => c.start < 5 * bpb && c.start + c.length > 3 * bpb)) || null;
    return t ? { id: t.id, y: o.arranger.yOf(t.id) } : null;
  }, bpb);
  T.ok(!!lane, `found an empty stretch of lane over bars 4-5 (${lane?.id})`);
  const x4 = await xOf(3 * bpb + 0.2),
    x5 = await xOf(4 * bpb - 0.2);
  await page.mouse.move(x4, lane.y);
  await page.mouse.down();
  await page.mouse.move((x4 + x5) / 2, lane.y, { steps: 3 });
  await page.mouse.move(x5, lane.y, { steps: 3 });
  await page.mouse.up();
  await sleep(150);
  r = await st();
  const range = await E(() => window.overdub.ui.state.selection.range);
  T.ok(range && Math.abs(range.from - 3 * bpb) < 1e-6, `dragging over bar 4 selects it (${JSON.stringify(range)})`);
  T.ok(
    r.marker === 3 * bpb && r.beat === 3 * bpb && r.pos?.startsWith('4'),
    `the selection puts the marker on its first bar, the playhead with it (marker ${r.marker}, position ${r.pos})`,
  );
  T.ok(
    /from bar 4/.test(r.from) && /Space plays from bar 4/.test(r.label),
    `the readout says where Space plays from ("${r.from}"; "${r.label}")`,
  );
  await neutral();
  await page.keyboard.press('Space');
  await sleep(1300);
  r = await st();
  T.ok(r.playing && r.beat > 3 * bpb + 0.5, `Space plays from bar 4 (beat ${r.beat.toFixed(2)})`);
  await page.keyboard.press('Space');
  await waitStopped();
  r = await st();
  const stoppedAt = await E(() => window.overdub.transport.marker.lastStop);
  T.ok(
    !r.playing && r.beat === 3 * bpb && r.marker === 3 * bpb && r.pos?.startsWith('4.1.1'),
    `Space again stops and the playhead goes back to bar 4 (beat ${r.beat}, ${r.pos}; it stopped at ${stoppedAt?.toFixed(2)})`,
  );

  /* ---- Shift+Space plays on from where it stopped */
  await page.keyboard.press('Shift+Space');
  await sleep(350);
  r = await st();
  T.ok(
    r.playing && r.beat > stoppedAt - 0.05 && r.marker === 3 * bpb,
    `Shift+Space plays on from ${stoppedAt.toFixed(2)} (now ${r.beat.toFixed(2)}), the marker stays on bar 4`,
  );
  await page.keyboard.press('Space');
  await waitStopped();
  r = await st();
  T.ok(r.beat === 3 * bpb, `and Space stops it back on the marker (beat ${r.beat})`);

  /* ---- the ruler: a click on bar 8 moves the marker (the bar, wherever in it you click) */
  await page.mouse.click(await xOf(7 * bpb + bpb * 0.6), barY);
  await sleep(150);
  r = await st();
  T.ok(
    r.marker === 7 * bpb && r.beat === 7 * bpb && !r.playing,
    `a click in bar 8 on the ruler puts the marker (and the stopped playhead) on bar 8 (${r.marker})`,
  );
  T.ok(r.said === 'Plays from bar 8', `the marker's place is announced ("${r.said}")`);
  // drawn on the ruler: a cream tab at the marker, distinct from the leader-green playhead
  const ink = await E((bpb) => {
    const o = window.overdub,
      cv = document.querySelector('.ar-ruler'),
      g = cv.getContext('2d');
    const rr = cv.getBoundingClientRect(),
      k = cv.width / rr.width;
    const mx = o.arranger.xOf(7 * bpb) - rr.left;
    const px = (x, y) => [...g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3);
    const cs = getComputedStyle(document.documentElement);
    return {
      tab: px(mx + 3, rr.height - 14),
      off: px(mx - 20, rr.height - 14),
      text: cs.getPropertyValue('--text').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
    };
  }, bpb);
  const lum = (c) => (c[0] + c[1] + c[2]) / 3;
  T.ok(
    lum(ink.tab) > 150 && lum(ink.off) < 90 && !(ink.tab[1] > ink.tab[0] + 40),
    `the marker is a cream tab on the ruler (rgb ${ink.tab}; beside it ${ink.off}), not the playhead's green`,
  );
  await shot('marker-ruler');

  /* ---- a click in a lane moves it to that bar; playing, the song plays on and stop comes back there */
  const lane2 = await E((bpb) => {
    const o = window.overdub,
      p = o.store.get();
    const t = p.tracks.find((t) => !t.clips.some((c) => c.start < 7 * bpb && c.start + c.length > 5 * bpb));
    return t ? { id: t.id, y: o.arranger.yOf(t.id) } : null;
  }, bpb);
  if (lane2) {
    await page.mouse.click(await xOf(5 * bpb + 2.5), lane2.y);
    await sleep(500); // past the double-click window
    r = await st();
    T.ok(
      r.marker === 5 * bpb && r.beat === 5 * bpb,
      `a click in a lane, mid-bar 6, puts the marker on bar 6 (${r.marker})`,
    );
  } else T.ok(false, 'found an empty lane over bars 6-7');
  await neutral();
  await page.keyboard.press('Space');
  await sleep(500);
  await page.mouse.click(await xOf(9 * bpb + 1), barY); // the ruler while playing: the song jumps there
  await sleep(400);
  r = await st();
  T.ok(
    r.playing && r.marker === 9 * bpb && r.beat >= 9 * bpb && r.beat < 10 * bpb + 1,
    `playing, a ruler click jumps there and moves the marker (beat ${r.beat.toFixed(2)}, marker ${r.marker})`,
  );
  await neutral();
  await page.keyboard.press('Space');
  await waitStopped();
  r = await st();
  T.ok(r.beat === 9 * bpb, `stop comes back to the new marker, bar 10 (${r.beat})`);

  /* ---- Home, and the stop key while stopped: bar 1 */
  await page.keyboard.press('Home');
  await sleep(150);
  r = await st();
  T.ok(r.marker === 0 && r.beat === 0 && r.said === 'Plays from bar 1', `Home puts the marker at bar 1 ("${r.said}")`);
  await E((b) => window.overdub.transport.marker.set(b), 2 * bpb);
  await page.click('[data-panel="transport"] .tp-g-play .tp-btn:first-child');
  await sleep(150);
  r = await st();
  T.ok(r.marker === 0 && r.beat === 0, 'the stop key while stopped puts it at bar 1 too');

  /* ---- the loop: Space plays from the marker, inside the loop or before it (it cycles once it gets there) */
  await E(
    (bpb) =>
      window.overdub.store.dispatch(
        { type: 'project.set', patch: { loop: { on: true, start: 4 * bpb, end: 8 * bpb } } },
        { by: 'you', label: 'set loop' },
      ),
    bpb,
  );
  await page.mouse.click(await xOf(1 * bpb + 1), barY); // bar 2: before the loop
  await sleep(100);
  await neutral();
  await page.keyboard.press('Space');
  await sleep(400);
  r = await st();
  T.ok(
    r.playing && r.beat >= 1 * bpb - 0.05 && r.beat < 3 * bpb,
    `the marker before the loop: Space plays from the marker, not the loop's start (beat ${r.beat.toFixed(2)})`,
  );
  await page.keyboard.press('Space');
  await waitStopped();
  r = await st();
  T.ok(r.beat === 1 * bpb && r.marker === 1 * bpb, `and stop comes back to the marker on bar 2 (${r.beat})`);
  await page.mouse.click(await xOf(6 * bpb + 1), barY); // bar 7: inside the loop
  await sleep(100);
  await neutral();
  await page.keyboard.press('Space');
  await sleep(400);
  r = await st();
  T.ok(
    r.playing && r.beat >= 6 * bpb - 0.05 && r.beat < 8 * bpb,
    `the marker inside the loop: Space plays from it (beat ${r.beat.toFixed(2)})`,
  );
  await page.keyboard.press('Space');
  await waitStopped();
  await E(() =>
    window.overdub.store.dispatch(
      { type: 'project.set', patch: { loop: { on: false } } },
      { by: 'you', label: 'loop off' },
    ),
  );

  /* ---- the killswitch and an agent's play come back to the marker too */
  await page.mouse.click(await xOf(2 * bpb + 1), barY); // bar 3
  await sleep(100);
  await E(() => window.overdub.engine.play(12 * 4)); // an agent playing the range it asked for
  await sleep(500);
  r = await st();
  T.ok(
    r.playing && r.beat >= 48 && r.marker === 2 * bpb,
    `an agent's play plays its range (beat ${r.beat.toFixed(2)}); the marker stays on bar 3`,
  );
  await neutral();
  await page.keyboard.press('Shift+Escape');
  await waitStopped();
  await sleep(300);
  r = await st();
  T.ok(!r.playing && r.beat === 2 * bpb, `the killswitch stops it, and the playhead is back on bar 3 (${r.beat})`);

  /* ---- R: the take starts at the marker */
  const take = await E(async (bpb) => {
    const o = window.overdub,
      rec = o.input?.recorder;
    if (!rec) return { skip: true };
    const t = o.store.get().tracks.find((t) => t.kind === 'instrument' && !/drum|beat|kit/i.test(t.name));
    o.ui.select({ track: t.id, clip: null, notes: [] });
    o.transport.marker.set(5 * bpb);
    rec.setCountIn?.(1);
    return { skip: false, track: t.name };
  }, bpb);
  if (!take.skip) {
    await neutral();
    await page.keyboard.press('KeyR');
    await sleep(300);
    const k = await E(() => {
      const o = window.overdub;
      return {
        state: o.input.recorder.state,
        until: o.engine.counting?.until ?? null,
        beat: o.engine.beat,
        playing: o.engine.playing,
      };
    });
    T.ok(
      k.state !== 'idle' && k.playing && (k.until === 5 * bpb || (k.until == null && k.beat >= 5 * bpb - 4)),
      `R records from the marker on bar 6 (count-in to beat ${k.until}, ${k.state})`,
    );
    await page.keyboard.press('Space');
    for (let i = 0; i < 60 && (await E(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await sleep(50);
    await sleep(250);
    r = await st();
    T.ok(!r.playing && r.beat === 5 * bpb, `after the take the playhead is back on the marker (${r.beat})`);
  }

  /* ---- a seek while stopped (the Notes ruler, an agent) moves the marker; it survives a reload */
  await E((b) => window.overdub.engine.seek(b), 5 * bpb);
  await sleep(400); // the marker is saved a moment after it moves
  const id = await E(() => window.overdub.store.get().id);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  r = await st();
  const same = await E(() => window.overdub.store.get().id);
  T.ok(
    same === id && r.marker === 5 * bpb && r.beat === 5 * bpb && r.pos?.startsWith('6.1.1'),
    `after a reload the song plays from bar 6 again (marker ${r.marker}, position ${r.pos})`,
  );
  await neutral();
  await page.keyboard.press('Space');
  await sleep(500);
  await page.keyboard.press('Space');
  await waitStopped();
  r = await st();
  T.ok(r.beat === 5 * bpb, `Space, Space after the reload: back on bar 6 (${r.beat})`);

  /* ---- the keys sheet lists it */
  const sheet = await E(() =>
    window.overdub.ui.keys
      .list()
      .filter((k) => k.key === 'Space' || k.key === 'Home')
      .map((k) => k.label),
  );
  T.ok(
    sheet.some((l) => /marker/.test(l)) && sheet.some((l) => /where it stopped/.test(l)),
    `the "?" sheet names the marker keys (${sheet.join('; ')})`,
  );

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  T.ok(false, 'marker test threw: ' + ((e && e.stack) || e));
} finally {
  await close();
}
T.done();
