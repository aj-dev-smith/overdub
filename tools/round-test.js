// The circle [round, a prototype]: ?view=round draws the section as a loop, a ring per track (app/src/ui/round.js).
//   - decideView: ?view=round is the simple view for that load, round: true, never written down
//   - a blank song: the Circle tab is open beside Arrange, no rings, the Ask line asleep
//   - Tap a beat (the door): a drum track, the loop on, the circle is the loop, one ring
//   - Night Shift: a ring per track, a row per ring, no two ring colours alike; Play in the middle and the doors in an
//     "Add a part" row; a tap on a ring selects its track (and a clip of it) without moving any ring, and unrolls it
//     beside the circle; a tap between the rings or in the middle does nothing; turning to the Verse takes the
//     selection's clip with it; paging and selecting never change the song; one Ask on a desktop (the Agent panel)
//   - Timeline view goes to Arrange and takes ?view=round off the address; the Circle tab comes back
//   - a phone (390x844): no sideways scroll, the doors under the circle, 40 px to the touch, the strip under the
//     circle, Ask chips that fit the selected track, and an Ask chip goes to the agent
//   - ?view=simple has no Circle
//   node tools/round-test.js      (screenshots: tools/.out/round/*.png)
import fs from 'node:fs';
import path from 'node:path';
import { open, tally, OUTDIR } from './pw.js';
import { decideView } from '../app/src/ui/workspace-view.js';

const T = tally('round');
const OUT = path.join(OUTDIR, 'round');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
const ignorable = (e) =>
  /favicon|ERR_CONNECTION|net::|AudioContext was not allowed|fonts\.g|Failed to load resource|getUserMedia|NotAllowedError|NotFoundError/i.test(
    e,
  );
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    T.ok(
      false,
      `${name}: ran to the end (${String((e && e.stack) || e)
        .split('\n')
        .slice(0, 3)
        .join(' ')})`,
    );
  }
};
const ready = (page) =>
  page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.overdub?.round?.geom?.(), null, {
    timeout: 30000,
  });
const songOf = (page) =>
  page.evaluate(() => {
    const p = structuredClone(overdub.store.get());
    delete p.meta;
    return JSON.stringify(p);
  });
// a point in the middle of ring i, at an angle (radians from 3 o'clock), in page coordinates
async function ringPoint(page, i, a = 0) {
  const g = await page.evaluate(() => overdub.round.geom());
  const box = await page.locator('.rd-cv').boundingBox();
  const r = g.rings[i],
    m = (r.r0 + r.r1) / 2;
  return { x: box.x + g.cx + Math.cos(a) * m, y: box.y + g.cy + Math.sin(a) * m, id: r.id, g, box };
}

/* ======================================================================== decideView */
{
  const d = decideView({ search: '?view=round', storage: null, webdriver: true });
  T.ok(
    d.view === 'simple' && d.round === true && d.persist === false && d.from === 'url',
    `?view=round is the simple view, round, this load only (${JSON.stringify(d)})`,
  );
  const s = decideView({ search: '?view=simple', storage: null, webdriver: true });
  T.ok(!s.round, '?view=simple is not round');
}

/* ======================================================================== a blank song, and Tap a beat */
await section('blank', async () => {
  const s = await open('/app/?view=round&new');
  const { page } = s;
  await ready(page);
  const st = await page.evaluate(() => ({
    active: overdub.ui.active('center'),
    view: overdub.ui.workspace?.view?.(),
    tabs: [...document.querySelectorAll('.ew-region-center > .ew-tabs [role=tab]')].map((t) => t.textContent),
    rings: overdub.round.rings().length,
    ask: document.querySelector('.rd-ask-in')?.disabled,
    doors: [...document.querySelectorAll('.rd-door')].map((b) => b.textContent),
  }));
  T.ok(st.active === 'round', `the Circle is the open center panel (${st.active})`);
  T.ok(st.view === 'simple', `under the simple view (${st.view})`);
  T.ok(
    JSON.stringify(st.tabs) === JSON.stringify(['Circle', 'Arrange']),
    `the center's tabs are Circle and Arrange (${st.tabs})`,
  );
  T.ok(st.rings === 0, 'a blank song has no rings');
  T.ok(st.ask === true, 'the Ask line is asleep until there is something to answer');
  T.ok(
    JSON.stringify(st.doors) === JSON.stringify(['Tap a beat', 'Hum it', 'Play the keys']),
    `the doors (${st.doors})`,
  );
  await shot(page, 'round-blank');

  await page.getByRole('button', { name: 'Tap a beat' }).click();
  await page.waitForFunction(() => overdub.store.get().tracks.length === 1 && overdub.store.get().loop.on, null, {
    timeout: 8000,
  });
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => ({
    rings: overdub.round.rings().map((r) => r.name),
    page: overdub.round.page()?.key,
    playing: overdub.engine.playing,
    active: overdub.ui.active('center'),
    ask: document.querySelector('.rd-ask-in').disabled,
  }));
  T.ok(t.rings.length === 1 && /drum/i.test(t.rings[0]), `Tap a beat: one drum ring (${t.rings})`);
  T.ok(t.page === 'loop', `the circle is the loop (${t.page})`);
  T.ok(t.active === 'round', 'the Circle stays open');
  T.ok(t.ask === false, 'the Ask line wakes up');
  await shot(page, 'round-tap');
  await page.evaluate(() => {
    overdub.onboard?.stop?.();
    overdub.engine.stop();
  });
  const errs = s.errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no errors on a blank song${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
});

/* ======================================================================== Night Shift */
await section('demo', async () => {
  const s = await open('/app/?view=round&demo=night-shift');
  const { page } = s;
  await ready(page);
  await page.waitForTimeout(300);
  const before = await songOf(page);
  const st = await page.evaluate(() => ({
    n: overdub.store.get().tracks.length,
    rings: overdub.round.rings().length,
    rows: document.querySelectorAll('.rd-row').length,
    pages: overdub.round.pages().map((p) => p.name),
  }));
  T.ok(
    st.rings === Math.min(8, st.n) && st.rows === st.rings,
    `a ring and a row per track (${st.rings} rings, ${st.rows} rows, ${st.n} tracks)`,
  );
  T.ok(st.pages.includes('Verse') && st.pages.includes('Chorus'), `the row names the song's sections (${st.pages})`);
  const look = await page.evaluate(() => {
    const cols = Object.values(overdub.round.colors()),
      d = (a, b) => {
        const x = a.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16)),
          y = b.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16));
        return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
      };
    let min = Infinity;
    cols.forEach((a, i) =>
      cols.forEach((b, j) => {
        if (i < j) min = Math.min(min, d(a, b));
      }),
    );
    const hub = document.querySelector('.rd-hub'),
      doors = document.querySelector('.rd-doors');
    return {
      min,
      cols: cols.length,
      hub: !!hub && !hub.hidden && /Play/.test(hub.textContent),
      doorsIn: doors?.parentElement?.className,
      ask: getComputedStyle(document.querySelector('.rd-ask')).display,
      cv: document.querySelector('.rd-cv').getAttribute('aria-label'),
    };
  });
  T.ok(look.min >= 40, `no two ring colours alike (closest pair ${Math.round(look.min)} apart, ${look.cols} rings)`);
  T.ok(look.hub, 'a song with parts has Play in the middle');
  T.ok(/rd-add/.test(look.doorsIn || ''), `and the doors in the Add a part row (${look.doorsIn})`);
  T.ok(look.ask === 'none', 'one Ask on a desktop: the Agent panel, not a second line under the circle');
  T.ok(/Drums/.test(look.cv || ''), `the circle says what it shows (${look.cv})`);
  const w0 = await page.evaluate(() => overdub.round.geom().rings.map((r) => [r.r0, r.r1]));

  // a tap on ring 3 selects its track, and a clip of that track
  const pt = await ringPoint(page, 2, 0.4);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => {
    const s = overdub.ui.state.selection,
      c = s.clip && overdub.store.findClip(s.clip);
    const g = overdub.round.geom(),
      w = g.rings.map((r) => r.r1 - r.r0);
    return {
      track: s.track,
      clipTrack: c ? c.track?.id || c.track : null,
      row: document.querySelector('.rd-row.sel')?.dataset.track,
      w,
      rr: g.rings.map((r) => [r.r0, r.r1]),
      strip: document.querySelector('.rd-sh')?.textContent,
    };
  });
  T.ok(sel.track === pt.id, `a tap on a ring selects its track (${sel.track} = ${pt.id})`);
  T.ok(!sel.clipTrack || sel.clipTrack === pt.id, 'and the clip it selects is on that track');
  T.ok(sel.row === pt.id, 'its row is printed selected');
  T.ok(JSON.stringify(sel.rr) === JSON.stringify(w0), `selecting moves no ring (${sel.w.map(Math.round)})`);
  T.ok(/on a line/.test(sel.strip || ''), `the ring is unrolled beside the circle (${sel.strip})`);
  await shot(page, 'round-demo');

  // a row selects too
  await page.locator('.rd-row').first().click();
  T.ok(
    await page.evaluate(() => overdub.ui.state.selection.track === overdub.round.rings()[0].id),
    'a row selects its track',
  );

  // the middle and the gaps do nothing
  const n0 = await page.evaluate(() => overdub.store.get().tracks.length);
  const g = pt.g,
    box = pt.box;
  T.ok(
    await page.evaluate(({ x, y }) => overdub.round.hit(x, y) === null, { x: g.cx + g.rIn * 0.85, y: g.cy }),
    'the middle is not a ring',
  );
  await page.mouse.click(box.x + g.cx + g.rIn * 0.85, box.y + g.cy);
  await page.waitForTimeout(250);
  T.ok(
    await page.evaluate(
      (n) => overdub.store.get().tracks.length === n && overdub.input?.recorder?.state === 'idle',
      n0,
    ),
    'a tap in the middle adds nothing and records nothing',
  );

  // another part of the song
  await page.getByRole('button', { name: 'Chorus', exact: true }).click();
  await page.getByRole('button', { name: 'Verse', exact: true }).click();
  const pg = await page.evaluate(() => {
    const pg = overdub.round.page(),
      s = overdub.ui.state.selection,
      f = s.clip && overdub.store.findClip(s.clip);
    return {
      name: pg?.name,
      pressed: document.querySelector('.rd-page[aria-pressed=true]')?.textContent,
      inPage: !f || (f.clip.start < pg.start + pg.len && f.clip.start + f.clip.length > pg.start),
    };
  });
  T.ok(pg.name === 'Verse' && pg.pressed === 'Verse', `the row turns the circle to the Verse (${JSON.stringify(pg)})`);
  T.ok(pg.inPage, "and the selection (the agent's scope) is a clip in the Verse");
  await shot(page, 'round-verse');
  T.ok((await songOf(page)) === before, 'looking, paging and selecting never change the song');

  // the way back
  await page.getByRole('button', { name: 'Timeline view' }).click();
  const back = await page.evaluate(() => ({ active: overdub.ui.active('center'), q: location.search }));
  T.ok(
    back.active === 'arranger' && !/view=round/.test(back.q),
    `Timeline view opens Arrange and leaves the address (${JSON.stringify(back)})`,
  );
  await shot(page, 'round-timeline');
  await page.getByRole('tab', { name: 'Circle' }).click();
  T.ok(await page.evaluate(() => overdub.ui.active('center') === 'round'), 'the Circle tab brings it back');
  const errs = s.errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no errors on Night Shift${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
});

/* ======================================================================== a phone */
await section('phone', async () => {
  const s = await open('/app/?view=round&demo=night-shift', { width: 390, height: 844 });
  const { page } = s;
  await ready(page);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const rd = document.querySelector('.rd'),
      cv = document.querySelector('.rd-cv').getBoundingClientRect();
    const doors = [...document.querySelectorAll('.rd-door')].map((b) => b.getBoundingClientRect());
    return {
      page: document.scrollingElement.scrollWidth,
      rd: rd.scrollWidth - rd.clientWidth,
      square: Math.abs(cv.width - cv.height),
      w: cv.width,
      doorsBelow: doors.every((d) => d.top >= cv.bottom - 1),
      tall: Math.min(...doors.map((d) => d.height)),
    };
  });
  T.ok(m.page <= 390 && m.rd <= 0, `no sideways scroll on a phone (${m.page}, ${m.rd})`);
  T.ok(m.square < 2 && m.w > 300, `the circle is square and wide (${Math.round(m.w)} px)`);
  T.ok(m.doorsBelow, 'the doors sit under the circle, not on it');
  T.ok(m.tall >= 40, `the doors are 40 px to the touch (${m.tall})`);
  const pt = await ringPoint(page, 1, 2.2);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  T.ok(
    await page.evaluate((id) => overdub.ui.state.selection.track === id, pt.id),
    'a tap on a ring selects it on a phone',
  );
  await page.waitForTimeout(500);
  const ph = await page.evaluate(() => {
    const cv = document.querySelector('.rd-cv').getBoundingClientRect(),
      st = document.querySelector('.rd-strip').getBoundingClientRect(),
      list = document.querySelector('.rd-list').getBoundingClientRect();
    return {
      under: st.top >= cv.bottom - 1 && st.bottom <= list.top + 1,
      seen: st.top < innerHeight && st.bottom > 0,
      chips: [...document.querySelectorAll('.rd-chip')].map((c) => c.textContent),
    };
  });
  T.ok(ph.under, 'on a phone the strip sits under the circle, above the list');
  T.ok(ph.seen, 'and a tap on a ring brings it into view');
  await page.locator('.rd-row').first().click();
  const drumChips = await page.evaluate(() => [...document.querySelectorAll('.rd-chip')].map((c) => c.textContent));
  T.ok(
    JSON.stringify(drumChips) !== JSON.stringify(ph.chips) && drumChips.some((c) => /beat/i.test(c)),
    `the Ask chips fit the selected track (${ph.chips.join(' / ')} | ${drumChips.join(' / ')})`,
  );
  await shot(page, 'round-phone');
  // Ask: a chip goes to the agent
  await page.getByRole('button', { name: 'What would you change?' }).click();
  await page.waitForTimeout(400);
  T.ok(
    await page.evaluate(
      () =>
        overdub.ui.isOpen('right') ||
        /agent/i.test(overdub.ui.active('right') || '') ||
        !!document.querySelector('[data-panel="agent"]')?.offsetParent,
    ),
    'an Ask chip opens the agent with it',
  );
  const errs = s.errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no errors on a phone${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
});

/* ======================================================================== only when asked */
await section('simple', async () => {
  const s = await open('/app/?view=simple');
  await s.page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
  T.ok(
    await s.page.evaluate(() => !overdub.ui.panels.has('round') && overdub.ui.active('center') === 'arranger'),
    '?view=simple has no Circle',
  );
  await s.close();
});

T.done();
