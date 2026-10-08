// Checks for the timeline views [ui-arrange]: transport, arranger, piano roll, beat grid.
//   node tools/arrange-test.js      (screenshots: tools/.out/arrange-*.png)
import { open, tally } from './pw.js';

const T = tally('arrange');
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g/.test(e);

async function boot(opts = {}) {
  const s = await open('/app/', { query: 'demo', ...opts });
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await s.page.waitForTimeout(500);
  return s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================== desktop */
{
  const { page, errors, close, shot } = await boot();
  const E = (fn, arg) => page.evaluate(fn, arg);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  T.ok(await page.$('[data-panel="transport"] .tp-row'), 'transport mounts in the top bar');
  T.ok(await page.$('[data-panel="arranger"] .ar-lanes'), 'arranger mounts with a lane canvas');
  T.ok(
    (await page.$$('.ar-head')).length === (await E(() => overdub.store.get().tracks.length)),
    'one header per track',
  );
  T.ok((await page.textContent('.tp-title')).trim() === 'Night Shift', 'the song title shows');

  /* ---------------- transport */
  await page.click('.tp-play');
  await sleep(400);
  T.ok(await E(() => overdub.engine.playing), 'play button starts the transport');
  await page.click('.ar-hint'); // somewhere neutral (not a field)
  await page.keyboard.press('Space');
  await sleep(200);
  T.ok(!(await E(() => overdub.engine.playing)), 'Space stops');
  await E(() => overdub.engine.seek(4));
  await sleep(150);
  T.ok(
    (await page.textContent('.tp-pos-bar')).trim() === '2.1.1',
    'position reads bar.beat.sixteenth (beat 4 = 2.1.1)',
  );
  await page.keyboard.press('Enter');
  await sleep(150);
  T.ok((await E(() => overdub.engine.beat)) === 0, 'Enter returns to the start');

  await page.dblclick('.tp-tempo');
  await page.waitForSelector('.tp-tempo-input');
  await page.fill('.tp-tempo-input', '120');
  await page.keyboard.press('Enter');
  T.ok((await E(() => overdub.store.get().tempo)) === 120, 'typing a tempo sets it');
  const undoTitle = await page.getAttribute('.tp-undo', 'title');
  T.ok(/^Undo: tempo 120 — You/.test(undoTitle), `undo button names what and who ("${undoTitle}")`);
  await page.click('.tp-undo');
  T.ok((await E(() => overdub.store.get().tempo)) === 92, 'undo button restores the tempo');
  // drag tempo
  const tb = await page.$('.tp-tempo').then((x) => x.boundingBox());
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y - 20, { steps: 5 });
  await page.mouse.up();
  const t2 = await E(() => overdub.store.get().tempo);
  T.ok(t2 > 92, `dragging the tempo up raises it (${t2})`);
  const tempoTx = await E(() => overdub.store.history.filter((x) => x.label === 'tempo').length);
  T.ok(tempoTx === 1, 'a tempo drag is one undo step');
  await E(() => overdub.store.undo());
  // tap tempo
  for (let i = 0; i < 4; i++) {
    await page.click('.tp-tap');
    await sleep(500);
  }
  const tapped = await E(() => overdub.store.get().tempo);
  T.ok(tapped >= 105 && tapped <= 130, `tap tempo follows the taps (~120: ${tapped})`);
  await E(() => overdub.store.dispatch({ type: 'project.set', patch: { tempo: 92 } }));

  const loop0 = await E(() => overdub.store.get().loop.on);
  await page.keyboard.press('KeyL');
  T.ok((await E(() => overdub.store.get().loop.on)) === !loop0, 'L toggles the loop');
  await page.keyboard.press('KeyL');
  await page.keyboard.press('KeyK');
  T.ok(await E(() => overdub.engine.metronome), 'K toggles the metronome');
  await page.keyboard.press('KeyK');

  await page.click('.tp-key');
  await page.click('.tp-root:text-is("D")');
  T.ok((await E(() => overdub.store.get().key.root)) === 'D', 'the key picker sets the root');
  await page.click('.tp-scales .ek-item:has-text("Dorian")');
  T.ok((await E(() => overdub.store.get().key.scale)) === 'dorian', 'the key picker sets the scale');
  await page.keyboard.press('Escape');
  await E(() => {
    overdub.store.undo();
    overdub.store.undo();
  });
  T.ok((await E(() => JSON.stringify(overdub.store.get().key))) === '{"root":"A","scale":"minor"}', 'key changes undo');

  await page.click('.tp-title');
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.type('Night Shift (v2)');
  await page.keyboard.press('Enter');
  T.ok((await E(() => overdub.store.get().title)) === 'Night Shift (v2)', 'the title edits inline');
  await E(() => overdub.store.undo());

  /* ---------------- arranger */
  const lane = await page.$('.ar-scroll').then((x) => x.boundingBox());
  const geo = () =>
    E(() => ({
      ppb: overdub.ui.state.zoom.pxPerBeat,
      th: overdub.ui.state.zoom.trackH,
      sx: document.querySelector('.ar-scroll').scrollLeft,
      sy: document.querySelector('.ar-scroll').scrollTop,
    }));
  const clipPt = async (ti, ci, fx = 0.5, fy = 0.6) => {
    const g = await geo();
    const c = await E(
      ([a, b]) => {
        const c = overdub.store.get().tracks[a].clips[b];
        return { start: c.start, length: c.length };
      },
      [ti, ci],
    );
    return { x: lane.x + (c.start + c.length * fx) * g.ppb - g.sx, y: lane.y + ti * g.th + g.th * fy - g.sy };
  };
  const bass = () => E(() => overdub.store.get().tracks[1]);
  let p = await clipPt(1, 0, 0.3);
  await page.mouse.click(p.x, p.y);
  const walk = (await bass()).clips[0];
  T.ok((await E(() => overdub.ui.state.selection.clip)) === walk.id, 'clicking a clip selects it');

  // move it a bar later
  const fresh = async () => {
    await E(() => {
      const s = document.querySelector('.ar-scroll');
      s.scrollLeft = 0;
      s.scrollTop = 0;
    });
    await sleep(40);
    return geo();
  };
  let g0 = await geo();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + g0.ppb * 4 + 2, p.y, { steps: 8 });
  await page.mouse.up();
  // Walk moved onto Walk 2's place; find it by id
  const moved = await E((id) => overdub.store.findClip(id).clip.start, walk.id);
  T.ok(moved === 4, `dragging moves the clip by a bar, snapped (start ${moved})`);
  T.ok((await E(() => overdub.store.history.at(-1).label)).startsWith('move clip'), 'a clip drag is one transaction');
  await E(() => overdub.store.undo());

  // alt-drag copies
  const n0 = (await bass()).clips.length;
  p = await clipPt(1, 0, 0.3);
  await page.keyboard.down('Alt');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + g0.ppb * 32, p.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  T.ok((await bass()).clips.length === n0 + 1, 'alt-drag duplicates the clip');
  const copied = await E(() => overdub.ui.state.selection.clip);
  // Delete removes it
  await page.keyboard.press('Delete');
  T.ok(
    (await bass()).clips.length === n0 && !(await E((id) => !!overdub.store.findClip(id), copied)),
    'Delete removes the selected clip',
  );

  // mod+D duplicates after
  p = await clipPt(1, 1, 0.5);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press(`${mod}+KeyD`);
  const b2 = await bass();
  T.ok(b2.clips.length === n0 + 1 && b2.clips.some((c) => c.start === 32), 'mod+D duplicates after the clip');
  await E(() => overdub.store.undo());
  await E(() => {
    document.querySelector('.ar-scroll').scrollLeft = 0;
  });
  await sleep(50);

  g0 = await fresh();
  // resize the right edge (shorter by a bar)
  p = await clipPt(1, 1, 1);
  await page.mouse.move(p.x - 3, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 3 - g0.ppb * 4, p.y, { steps: 6 });
  await page.mouse.up();
  T.ok((await bass()).clips[1].length === 12, 'dragging the right edge resizes the clip');
  await E(() => overdub.store.undo());

  g0 = await fresh();
  // can't drop a notes clip on the audio track
  const before = JSON.stringify(await bass());
  p = await clipPt(1, 0, 0.3);
  const guitarRow = await E(() => overdub.store.get().tracks.findIndex((t) => t.kind === 'audio'));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y + (guitarRow - 1) * g0.th, { steps: 8 });
  await page.mouse.up();
  T.ok(JSON.stringify(await bass()) === before, 'a notes clip will not land on an audio track');

  g0 = await fresh();
  // move across tracks (Bass Walk -> Keys row is an instrument track: allowed)
  const keysId = await E(() => overdub.store.get().tracks[2].id);
  p = await clipPt(1, 0, 0.3);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + g0.ppb * 48, p.y + g0.th, { steps: 10 });
  await page.mouse.up();
  T.ok(
    (await E((id) => overdub.store.findClip(id).track.id, walk.id)) === keysId,
    'clips move across tracks (clip.move)',
  );
  await E(() => overdub.store.undo());

  g0 = await fresh();
  // double-click an empty lane makes a 4-bar clip
  const hookRow = 3;
  const hk0 = await E(() => overdub.store.get().tracks[3].clips.length);
  await page.mouse.dblclick(lane.x + g0.ppb * 2 - g0.sx, lane.y + hookRow * g0.th + g0.th / 2 - g0.sy);
  const hk = await E(() => overdub.store.get().tracks[3].clips);
  T.ok(
    hk.length === hk0 + 1 && hk.some((c) => c.start === 0 && c.length === 16 && c.by === 'you'),
    'double-clicking an empty lane makes a 4-bar clip by you',
  );

  g0 = await fresh();
  // drag across empty bars selects a range
  await page.mouse.move(lane.x + g0.ppb * 20 - g0.sx, lane.y + 5 * g0.th + 20 - g0.sy);
  await page.mouse.down();
  await page.mouse.move(lane.x + g0.ppb * 28 - g0.sx, lane.y + 5 * g0.th + 24 - g0.sy, { steps: 6 });
  await page.mouse.up();
  const range = await E(() => overdub.ui.state.selection.range);
  T.ok(
    range && range.from === 20 && range.to === 28,
    `dragging empty space selects bars for the agent (${JSON.stringify(range)})`,
  );

  g0 = await fresh();
  // sections: rename by double-click, add with +
  const ruler = await page.$('.ar-rulerwrap').then((x) => x.boundingBox());
  await page.mouse.dblclick(ruler.x + g0.ppb * 6 - g0.sx, ruler.y + 10);
  await page.waitForSelector('.ar-secinput');
  await page.fill('.ar-secinput', 'Intro');
  await page.keyboard.press('Enter');
  T.ok((await E(() => overdub.store.get().sections[0].name)) === 'Intro', 'double-click a section to rename it');
  const ns0 = await E(() => overdub.store.get().sections.length);
  await page.click('.ar-secadd');
  await page.waitForSelector('.ar-secinput');
  await page.keyboard.press('Escape');
  T.ok((await E(() => overdub.store.get().sections.length)) === ns0 + 1, '+ adds a section after the last');
  g0 = await fresh();
  // drag a section's right edge
  const s0 = await E(() => overdub.store.get().sections[0]);
  const sx1 = ruler.x + (s0.start + s0.length) * g0.ppb - g0.sx - 2;
  await page.mouse.move(sx1, ruler.y + 10);
  await page.mouse.down();
  await page.mouse.move(sx1 - g0.ppb * 4, ruler.y + 10, { steps: 6 });
  await page.mouse.up();
  T.ok((await E(() => overdub.store.get().sections[0].length)) === s0.length - 4, 'dragging a section edge resizes it');

  g0 = await fresh();
  // loop: draw a new one on the loop strip
  await E(() => overdub.store.dispatch({ type: 'project.set', patch: { loop: { on: false, start: 0, end: 4 } } }));
  await page.mouse.move(ruler.x + g0.ppb * 8 - g0.sx + 2, ruler.y + 26);
  await page.mouse.down();
  await page.mouse.move(ruler.x + g0.ppb * 16 - g0.sx + 2, ruler.y + 26, { steps: 6 });
  await page.mouse.up();
  const lp = await E(() => overdub.store.get().loop);
  T.ok(lp.on && lp.start === 8 && lp.end === 16, `dragging on the loop strip sets the loop (${JSON.stringify(lp)})`);

  g0 = await fresh();
  // click the bar ruler to seek
  await page.mouse.click(ruler.x + g0.ppb * 12 - g0.sx + 1, ruler.y + 42);
  T.ok(Math.abs((await E(() => overdub.engine.beat)) - 12) < 0.3, 'clicking the ruler seeks');

  // zoom with mod+wheel
  const z0 = g0.ppb;
  await page.mouse.move(lane.x + 300, lane.y + 100);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await sleep(100);
  T.ok((await geo()).ppb > z0, 'ctrl+wheel zooms in');

  g0 = await fresh();
  // track header: mute, rename, reorder
  await page.click('.ar-head >> nth=1 >> .ar-hb-mute');
  T.ok(await E(() => overdub.store.get().tracks[1].mute), 'M mutes the track');
  await page.click('.ar-head >> nth=1 >> .ar-hb-mute');
  await page.dblclick('.ar-head >> nth=2 >> .ar-hname');
  await page.fill('.ar-hinput', 'Rhodes');
  await page.keyboard.press('Enter');
  T.ok((await E(() => overdub.store.get().tracks[2].name)) === 'Rhodes', 'double-click renames a track');
  const order0 = await E(() =>
    overdub.store
      .get()
      .tracks.map((t) => t.name)
      .join(','),
  );
  const hb = await page.$('.ar-head >> nth=0').then((x) => x.boundingBox());
  await page.mouse.move(hb.x + 120, hb.y + 30);
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 30 + g0.th * 2.1, { steps: 8 });
  await page.mouse.up();
  const order1 = await E(() =>
    overdub.store
      .get()
      .tracks.map((t) => t.name)
      .join(','),
  );
  T.ok(order1 !== order0 && order1.split(',')[2] === 'Drums', `dragging a header reorders tracks (${order1})`);
  await E(() => overdub.store.undo());

  // + Track menu
  const nt = await E(() => overdub.store.get().tracks.length);
  await page.click('.ar-add');
  // each instrument's line is its blurb, or the blurb cut at a word with an ellipsis (it read "…vowels from t"); the
  // whole of it is the item's title
  const subs = await E(() =>
    [...document.querySelectorAll('.ek-pop .ek-item')]
      .filter((b) => b.title && b.querySelector('.ek-sub'))
      .map((b) => ({ sub: b.querySelector('.ek-sub').textContent, blurb: b.title })),
  );
  const cutBad = subs.filter(({ sub, blurb }) => {
    if (sub === blurb) return false;
    if (!sub.endsWith('…')) return true;
    const head = sub.slice(0, -1);
    return !blurb.startsWith(head) || /[\p{L}\p{N}]/u.test(blurb[head.length] || '') || /[\s,;:]$/.test(head);
  });
  const nCut = subs.filter((x) => x.sub !== x.blurb).length;
  T.ok(
    subs.length >= 8 && nCut > 0 && !cutBad.length,
    `the Add a track menu's ${subs.length} instrument lines read whole or end at a word with an ellipsis (${nCut} cut, e.g. "${subs.find((x) => x.sub !== x.blurb)?.sub}")${cutBad.length ? ': ' + cutBad.map((x) => `"${x.sub}"`).join(', ') : ''}`,
  );
  // every instrument the studio has is in it, by kind, in a menu that scrolls (it listed the first 14: Light Table,
  // Suitcase, Mallet Bag, Step Ladder, Brass Rail and Risers were never there)
  const every = await E(() => {
    const pop = document.querySelector('.ek-pop'),
      r = pop.getBoundingClientRect();
    const names = [...pop.querySelectorAll('.ek-item')].map((b) => b.querySelector('span')?.textContent);
    const heads = [...pop.querySelectorAll('.ek-head')].map((x) => x.textContent);
    const inst = overdub.devices.listDevices({ kind: 'instrument' }).map((d) => d.name);
    return {
      n: inst.length,
      missing: inst.filter((n) => !names.includes(n)),
      heads,
      scrolls: pop.scrollHeight > pop.clientHeight + 1,
      onScreen: r.top >= 0 && r.bottom <= innerHeight + 0.5,
    };
  });
  T.ok(
    !every.missing.length &&
      every.n >= 20 &&
      ['Synths', 'Keys', 'Drums', 'Bass', 'Audio'].every((x) => every.heads.includes(x)) &&
      every.scrolls &&
      every.onScreen,
    `Add a track lists every instrument (${every.n}${every.missing.length ? '; missing ' + every.missing.join(', ') : ''}), under their kinds (${every.heads.join(', ')}), in a menu that scrolls on screen`,
  );
  await page.click('.ek-pop .ek-item:has-text("Audio track")');
  T.ok(
    (await E(() => overdub.store.get().tracks.length)) === nt + 1,
    '+ Track adds an audio track' +
      ` (${await E(() =>
        overdub.store
          .get()
          .tracks.map((t) => t.name)
          .join(','),
      )}; was ${nt})`,
  );
  await E(() => overdub.store.undo());

  // an agent pointing past what's in view (docs/FRESH-EYES-6.md): bars 1-4 with bars 1-3 in view, its note is written
  // over the part in view (it ran off the edge); a target wholly out of view gets a marker on the edge it lies past,
  // naming it, with an arrow that way; the view never scrolls for either
  {
    const hl = await E(async () => {
      const o = overdub,
        sc = document.querySelector('.ar-scroll'),
        wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const t = o.store.get().tracks.find((x) => x.clips.length) || o.store.get().tracks[0];
      o.arranger.zoomTo(0, 12);
      await wait(150);
      sc.scrollLeft = 0;
      sc.scrollTop = 0;
      await wait(150);
      const W = sc.clientWidth,
        s0 = sc.scrollLeft;
      await o.tools.run(
        'highlight',
        { target: { track: t.name, bars: [1, 4] }, note: 'the arp, bars 1 to 4', seconds: 30 },
        { by: 'claude' },
      );
      await wait(250);
      const part = (o.arranger.presenceMarks?.() || []).find((m) => /bars 1 to 4/.test(m.text));
      await o.tools.run(
        'highlight',
        { target: { track: t.name, bars: [40, 44] }, note: 'the outro fill', seconds: 30 },
        { by: 'claude' },
      );
      await wait(250);
      const away = (o.arranger.presenceMarks?.() || []).find((m) => /outro fill/.test(m.text));
      const s1 = sc.scrollLeft;
      o.presence.clear('claude');
      return { W, part, away, scrolled: s1 !== s0 };
    });
    T.ok(
      hl.part && !hl.part.edge && hl.part.x >= 0 && hl.part.x + hl.part.w <= hl.W,
      `an agent's note over bars 1-4 with bars 1-3 in view is written in view (${hl.part ? `${Math.round(hl.part.x)}..${Math.round(hl.part.x + hl.part.w)} of ${hl.W} px` : 'not drawn'})`,
    );
    T.ok(
      hl.away &&
        hl.away.edge === 'right' &&
        /→$/.test(hl.away.text) &&
        hl.away.x >= 0 &&
        hl.away.x + hl.away.w <= hl.W &&
        !hl.scrolled,
      `a target past the right edge gets a marker there naming it ("${hl.away?.text}", ${hl.away?.edge}), and the view stays where it was`,
    );
    await shot('arrange-pointing');
  }

  // device drop onto a track
  const dropped = await page.evaluate(async () => {
    const dev = overdub.devices.listDevices({ kind: 'effect' })[0];
    if (!dev) return 'none';
    const dt = new DataTransfer();
    dt.setData('application/x-overdub-device', JSON.stringify({ id: dev.id, kind: 'effect' }));
    const lane = document.querySelector('.ar-lanewrap');
    const r = lane.getBoundingClientRect();
    const th = overdub.ui.state.zoom.trackH;
    // (the second track's middle, wherever the lanes are scrolled: a track added and undone above can leave them scrolled)
    const ev = (type) =>
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + 100,
        clientY: r.top + th * 1.5 - document.querySelector('.ar-scroll').scrollTop,
      });
    lane.dispatchEvent(ev('dragover'));
    lane.dispatchEvent(ev('drop'));
    return overdub.store.get().tracks[1].inserts.some((x) => x.device === dev.id) ? 'ok' : 'missing';
  });
  T.ok(dropped === 'ok' || dropped === 'none', `dropping an effect on a track adds it (${dropped})`);

  // an audio take on the guitar track draws its waveform
  const audioOk = await E(async () => {
    const sr = 24000,
      n = sr * 6,
      ch = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr,
        k = t % 0.65;
      ch[i] =
        Math.sin(2 * Math.PI * 196 * t) * Math.exp(-k * 5) * 0.7 +
        Math.sin(2 * Math.PI * 293 * t) * Math.exp(-k * 7) * 0.25;
    }
    try {
      await overdub.engine.assets.put('a_take01', { sr, channels: [ch] });
    } catch (e) {
      return 'put failed: ' + e.message;
    }
    const g = overdub.store.get().tracks.find((t) => t.kind === 'audio');
    const r = overdub.store.dispatch(
      {
        type: 'clip.add',
        track: g.id,
        clip: { kind: 'audio', asset: 'a_take01', start: 16, length: 9, name: 'Take 1' },
      },
      { by: 'you', label: 'record take' },
    );
    return r.ok ? 'ok' : r.error;
  });
  T.ok(audioOk === 'ok', `an audio clip lands on the audio track (${audioOk})`);
  // agent edit flashes + presence glows
  const agent = await E(() => {
    const t = overdub.store.get().tracks[3];
    const r = overdub.store.dispatch(
      {
        type: 'clip.add',
        track: t.id,
        clip: { start: 0, length: 16, name: 'Answer', notes: 'A4@0:1 C5@1:1 E5@2:2 D5@4:1 C5@5:1 A4@6:2' },
      },
      { by: 'claude', label: 'call-and-response answer' },
    );
    overdub.ui.state.presence = [
      {
        id: 'x1',
        by: 'claude',
        track: overdub.store.get().tracks[1].id,
        range: { from: 16, to: 32 },
        note: 'tightening the bass in the chorus',
        until: Date.now() + 60000,
      },
    ];
    overdub.ui.emit('presence', overdub.ui.state.presence);
    return r.ok;
  });
  T.ok(agent, 'an agent clip lands');
  await E(() => overdub.arranger.fitSong());
  await sleep(250);
  await shot('arrange-desk');
  T.ok(
    (await page.getAttribute('.tp-undo', 'title')).includes('Claude'),
    'the undo tooltip says Claude made the last change',
  );
  await E(() => {
    overdub.ui.state.presence = [];
    overdub.ui.emit('presence', []);
  });

  /* ---------------- piano roll (chromatic: Scale lock off; panes-test checks it on) */
  await E(() => {
    overdub.input.qwerty.setScaleLock(false);
    const t = overdub.store.get().tracks[1];
    overdub.ui.show('pianoroll');
    overdub.ui.select({ track: t.id, clip: t.clips[0].id, notes: [] });
  });
  await sleep(300);
  T.ok(await page.isVisible('[data-panel="pianoroll"] .pr-grid'), 'Notes shows the selected clip');
  const grid = await page.$('.pr-scroll').then((x) => x.boundingBox());
  const prv = () =>
    E(() => {
      const s = document.querySelector('.pr-scroll');
      const c = overdub.store.findClip(overdub.ui.state.selection.clip).clip;
      return { sx: s.scrollLeft, sy: s.scrollTop, n: c.notes.length, notes: c.notes };
    });
  // learn the geometry: rows are (127 - p) * rowH, beats * ppb
  const geoP = await E(() => {
    const s = document.querySelector('.pr-spacer');
    return { rowH: parseFloat(s.style.height) / 128, ppb: null };
  });
  const ppbP = await E(() => {
    const c = overdub.store.findClip(overdub.ui.state.selection.clip).clip;
    return parseFloat(document.querySelector('.pr-spacer').style.width) / (Math.ceil((c.length + 8) / 4) * 4);
  });
  const v0 = await prv();
  const ptOf = (t, pitch, v) => ({
    x: grid.x + t * ppbP - v.sx + 2,
    y: grid.y + (127 - pitch) * geoP.rowH - v.sy + geoP.rowH / 2,
  });
  // draw a note in the middle of the view at beat 3 (nothing sounds there)
  const P0 = 127 - Math.floor((v0.sy + grid.height / 2) / geoP.rowH);
  let q = ptOf(3, P0, v0);
  await page.mouse.click(q.x + 1, q.y);
  const v1 = await prv();
  const drawn = v1.notes.find((n) => n.p === P0 && Math.abs(n.t - 3) < 1e-6);
  T.ok(v1.n === v0.n + 1 && drawn && drawn.by === 'you', 'clicking empty grid draws a note by you');
  T.ok((await E(() => [...overdub.ui.state.selection.notes]))[0] === drawn?.id, 'the new note is selected');
  // transpose with arrow keys
  await page.keyboard.press('ArrowUp');
  T.ok((await prv()).notes.find((n) => n.id === drawn?.id)?.p === P0 + 1, '↑ transposes up a semitone');
  await page.keyboard.press('Shift+ArrowDown');
  T.ok((await prv()).notes.find((n) => n.id === drawn?.id)?.p === P0 - 11, 'shift+↓ transposes down an octave');
  await page.keyboard.press('Shift+ArrowUp');
  // drag the note right by a beat and up two
  q = ptOf(3, P0 + 1, await prv());
  await page.mouse.move(q.x + 4, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x + 4 + ppbP, q.y - geoP.rowH * 2, { steps: 6 });
  await page.mouse.up();
  const dn = (await prv()).notes.find((n) => n.id === drawn?.id) || {};
  T.ok(
    Math.abs(dn.t - 4) < 1e-6 && dn.p === P0 + 3,
    `dragging moves the note in time and pitch (t ${dn.t}, p ${dn.p})`,
  );
  // resize from the right edge
  const d0 = dn.d;
  q = ptOf(dn.t + dn.d, dn.p, await prv());
  await page.mouse.move(q.x - 4, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x - 4 + ppbP, q.y, { steps: 6 });
  await page.mouse.up();
  const dr = (await prv()).notes.find((n) => n.id === drawn?.id) || {};
  T.ok(dr.d > d0, `dragging the right edge lengthens the note (${d0} -> ${dr.d})`);
  // velocity lane
  const vel = await page.$('.pr-velwrap').then((x) => x.boundingBox());
  const vx = vel.x + dr.t * ppbP - (await prv()).sx + 1;
  await page.mouse.move(vx, vel.y + 30);
  await page.mouse.down();
  await page.mouse.move(vx, vel.y + vel.height - 8, { steps: 5 });
  await page.mouse.up();
  const vv = (await prv()).notes.find((n) => n.id === drawn?.id)?.v;
  T.ok(vv < 0.3, `dragging in the velocity lane sets velocity (${vv})`);
  // quantize: put a note off the grid, select it, Q
  await E(() => {
    const s = overdub.ui.state.selection;
    overdub.store.dispatch({
      type: 'notes.set',
      track: s.track,
      clip: s.clip,
      notes: [{ id: [...s.notes][0], t: 4.13 }],
    });
  });
  await page.keyboard.press('KeyQ');
  T.ok(
    Math.abs((await prv()).notes.find((n) => n.id === drawn?.id)?.t - 4.25) < 1e-6,
    'Q quantizes the selection to the grid',
  );
  // chord name for a selection
  await E(() => {
    const s = overdub.ui.state.selection;
    const r = overdub.store.dispatch({
      type: 'notes.add',
      track: s.track,
      clip: s.clip,
      notes: 'A3@8:1 C4@8:1 E4@8:1',
    });
    overdub.ui.select({ notes: r.created.notes });
  });
  await sleep(100);
  T.ok((await page.textContent('.pr-chord')).trim() === 'Am', 'the selected notes are named as a chord');
  // copy / paste at the playhead
  await E(() => overdub.engine.seek(12));
  await page.mouse.move(grid.x + 50, grid.y + 50);
  await page.keyboard.press(`${mod}+KeyC`);
  await page.keyboard.press(`${mod}+KeyV`);
  const pasted = (await prv()).notes.filter((n) => Math.abs(n.t - 12) < 1e-6 && [57, 60, 64].includes(n.p));
  T.ok(pasted.length === 3, 'mod+C / mod+V pastes the notes at the playhead');
  // select all + delete, then undo
  const nAll = (await prv()).n;
  await page.keyboard.press(`${mod}+KeyA`);
  T.ok((await E(() => overdub.ui.state.selection.notes.size)) === nAll, 'mod+A selects every note');
  await page.keyboard.press('Delete');
  T.ok((await prv()).n === 0, 'Delete removes the selected notes');
  await E(() => overdub.store.undo());
  T.ok((await prv()).n === nAll, 'undo brings them back');
  // marquee in the select tool
  await page.click('.pr-tool:has-text("Select")');
  const vm = await prv();
  const a = ptOf(0, 50, vm),
    bpt = ptOf(4, 30, vm);
  await page.mouse.move(Math.max(grid.x + 2, a.x), Math.max(grid.y + 2, a.y));
  await page.mouse.down();
  await page.mouse.move(bpt.x, Math.min(grid.y + grid.height - 4, bpt.y), { steps: 6 });
  await page.mouse.up();
  const msel = await E(() => overdub.ui.state.selection.notes.size);
  T.ok(msel > 0 && msel < nAll, `the marquee selects notes in its box (${msel})`);
  await page.click('.pr-tool:has-text("Draw")');
  // drag of many notes is one undo step
  const h0 = await E(() => overdub.store.history.length);
  const first = await E(() => {
    const c = overdub.store.findClip(overdub.ui.state.selection.clip).clip;
    const ids = overdub.ui.state.selection.notes;
    return c.notes.find((n) => ids.has(n.id));
  });
  q = ptOf(first.t + Math.min(0.1, first.d / 3), first.p, await prv());
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x + ppbP * 2, q.y, { steps: 10 });
  await page.mouse.up();
  T.ok((await E(() => overdub.store.history.length)) === h0 + 1, 'moving many notes is one undo step');
  await shot('arrange-notes');

  // 300+ notes stay smooth
  const fps = await E(async () => {
    const s = overdub.ui.state.selection;
    let txt = '';
    for (let i = 0; i < 320; i++) txt += `${48 + ((i * 7) % 24)}@${(i * 0.1).toFixed(2)}:0.1 `;
    overdub.store.dispatch({ type: 'notes.replace', track: s.track, clip: s.clip, notes: txt });
    overdub.ui.select({ notes: overdub.store.findClip(s.clip).clip.notes.map((n) => n.id) });
    await overdub.engine.play(0);
    const t0 = performance.now();
    let frames = 0;
    await new Promise((r) => {
      const f = () => {
        frames++;
        if (performance.now() - t0 < 1000) requestAnimationFrame(f);
        else r();
      };
      requestAnimationFrame(f);
    });
    overdub.engine.stop();
    return frames;
  });
  T.ok(fps >= 40, `320 notes while playing: ${fps} fps`);
  await E(() => overdub.store.undo());

  /* ---------------- beat grid */
  await E(() => overdub.ui.show('pianoroll'));
  await E(() => {
    const t = overdub.store.get().tracks.find((x) => x.instrument?.device === 'core.drums');
    overdub.ui.select({ track: t.id, clip: t.clips[0].id, notes: [] });
  });
  await sleep(200);
  T.ok((await E(() => overdub.ui.active('bottom'))) === 'drumgrid', 'selecting a drum clip shows the Beat tab');
  const cells = await page.$('.dg-cellwrap').then((x) => x.boundingBox());
  const dgeo = await E(() => {
    const W = document.querySelector('.dg-cellwrap').clientWidth,
      H = document.querySelector('.dg-cellwrap').clientHeight;
    return { W, H, per: overdub.drumgrid.perPage() };
  });
  const rowsN = await page.$$eval('.dg-row', (x) => x.length);
  const rh = Math.max(16, Math.min(34, Math.floor((dgeo.H - 20 - 4) / rowsN)));
  const cw = (dgeo.W - 12 * (dgeo.per - 1)) / (dgeo.per * 16);
  const cellPt = (row, step) => ({ x: cells.x + step * cw + cw / 2, y: cells.y + 20 + row * rh + rh / 2 });
  const drumClip = () => E(() => overdub.store.findClip(overdub.ui.state.selection.clip).clip.notes);
  const has = (ns, p, t) => ns.find((n) => n.p === p && Math.abs(n.t - t) < 0.13);
  // clap row (index 2): step 2 is empty
  let c = cellPt(2, 2);
  await page.mouse.click(c.x, c.y);
  let dn2 = await drumClip();
  T.ok(!!has(dn2, 39, 0.5), 'clicking an empty step adds a hit');
  await page.mouse.click(c.x, c.y);
  T.ok(!has(await drumClip(), 39, 0.5), 'clicking it again removes it');
  // paint a run across steps 8..11
  const c8 = cellPt(2, 8),
    c11 = cellPt(2, 11);
  await page.mouse.move(c8.x, c8.y);
  await page.mouse.down();
  await page.mouse.move(c11.x, c11.y, { steps: 8 });
  await page.mouse.up();
  dn2 = await drumClip();
  T.ok(
    [2, 2.25, 2.5, 2.75].every((t) => has(dn2, 39, t)),
    'dragging paints hits',
  );
  T.ok((await E(() => overdub.store.history.at(-1).label)) === 'add 4 hits', 'a paint drag is one transaction');
  // shift-click cycles velocity
  await page.keyboard.down('Shift');
  await page.mouse.click(c8.x, c8.y);
  const v1x = has(await drumClip(), 39, 2).v;
  await page.mouse.click(c8.x, c8.y);
  const v2x = has(await drumClip(), 39, 2).v;
  await page.keyboard.up('Shift');
  T.ok(
    Math.abs(v1x - 0.45) < 0.01 && Math.abs(v2x - 1) < 0.01,
    `shift-click cycles hit → ghost → accent (${v1x}, ${v2x})`,
  );
  // swing
  await page.$eval('.dg-swing', (el) => {
    el.value = 50;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.value = 60;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  dn2 = await drumClip();
  const off = dn2.filter((n) => Math.round(n.t / 0.25 - 0.25) % 2 === 1 && Math.floor(n.t / 0.25 + 0.25) % 2 === 1);
  T.ok(
    off.length > 0 && off.every((n) => Math.abs(n.t / 0.25 - Math.floor(n.t / 0.25 + 0.25) - 0.3) < 0.01),
    'swing delays the off-beat 16ths',
  );
  T.ok(
    (await E(() => overdub.store.history.at(-1).label)).startsWith('swing') &&
      (await E(() => overdub.store.history.filter((x) => x.label.startsWith('swing')).length)) === 1,
    'a swing gesture is one undo step',
  );
  await shot('arrange-beat');
  // the user's choice of Notes for a drum clip sticks
  await E(() => overdub.ui.show('pianoroll'));
  await E(() => {
    const t = overdub.store.get().tracks[1];
    overdub.ui.select({ track: t.id, clip: t.clips[0].id });
  });
  await E(() => {
    const t = overdub.store.get().tracks.find((x) => x.instrument?.device === 'core.drums');
    overdub.ui.select({ track: t.id, clip: t.clips[0].id });
  });
  T.ok((await E(() => overdub.ui.active('bottom'))) === 'pianoroll', 'picking Notes for a drum clip is respected');
  // a melodic clip in Beat flips back to Notes
  await E(() => overdub.ui.show('drumgrid'));
  await E(() => {
    const t = overdub.store.get().tracks[1];
    overdub.ui.select({ track: t.id, clip: t.clips[0].id });
  });
  T.ok((await E(() => overdub.ui.active('bottom'))) === 'pianoroll', 'a melodic clip opens in Notes');

  // double-click a drum clip opens Beat
  await E(() => overdub.ui.show('mixer'));
  const dRow = await E(() => overdub.store.get().tracks.findIndex((x) => x.instrument?.device === 'core.drums'));
  const gz = await geo();
  await page.mouse.dblclick(lane.x + 6 * gz.ppb - gz.sx, lane.y + dRow * gz.th + gz.th * 0.6 - gz.sy);
  T.ok((await E(() => overdub.ui.active('bottom'))) === 'drumgrid', 'double-clicking a drum clip opens the Beat tab');

  /* ---------------- empty song */
  await E(async () => {
    const m = await import('/app/src/core/project.js');
    overdub.store.load(m.createProject({ title: 'Untitled' }));
  });
  await sleep(300);
  T.ok(await page.isVisible('.ar-empty-card'), 'an empty song invites a hum, a tap or the agent');
  T.ok(
    (await page.isVisible('[data-panel="drumgrid"] .dg-empty-card')) ||
      (await page.isVisible('[data-panel="pianoroll"] .pr-empty-card')),
    'the editor explains what to do with no clip',
  );
  await shot('arrange-empty');

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(errs.length === 0, 'no page errors' + (errs.length ? ':\n    ' + errs.slice(0, 6).join('\n    ') : ''));
  await close();
}

/* ================================================================== the arranger in the Liner notes look
   (design/LINER-NOTES-KIT.md, DECISION.md amendments): no stripes, pills, sparkles or glows in its code; numbered
   headers with a square swatch, signed only where an agent built the device; on the canvas the selected clip's label in
   reverse, a muted clip in outline only, the agent's byline in cool ink and never on its notes, crop marks where an
   agent points; the first clip mute says the key in a toast */
{
  const fs = await import('node:fs');
  for (const f of ['app/src/ui/arranger.js', 'app/src/ui/arrange-kit.js']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    T.ok(
      !/inset\s+\d+(\.\d+)?px\s+0\s+0/.test(src) && !/99px|border-radius:\s*50%/.test(src),
      `${f}: no stripe (inset Npx 0 0) and no pill (99px, 50%)`,
    );
    T.ok(
      !/✦/.test(src) && !/'MUTED'/.test(src) && !/ar-auth|ar-welcome-edge|cool edge/.test(src),
      `${f}: no ✦, no MUTED tag, no author edge`,
    );
    T.ok(
      !/@keyframes ar-(pulse|flash)|Math\.sin\(now|shadowBlur = \d+ \* /.test(src),
      `${f}: no pulse, no flash glow, no shimmer`,
    );
  }
  const { page, errors, close, shot } = await boot();
  const E = (fn, arg) => page.evaluate(fn, arg);
  await E(() => window.overdub.welcome?.close?.());
  const hd = await E(() =>
    [...document.querySelectorAll('.ar-head')].map((r) => ({
      num: r.querySelector('.ar-hnum')?.textContent,
      sw: !!r.querySelector('.ar-swatch'),
      auth: !!r.querySelector('.ar-auth'),
      by: [...r.querySelectorAll('.by')].map((b) => `${b.className}:${b.textContent}`),
      name: r.querySelector('.ar-hname')?.textContent,
      text: r.textContent,
      tc: getComputedStyle(r).getPropertyValue('--tc').trim(),
    })),
  );
  T.ok(
    hd.length && hd.every((x, i) => x.num === String(i + 1).padStart(2, '0') && x.sw && !x.auth && x.tc),
    `every track header has its number, a square swatch in the track colour and no author edge (${hd.map((x) => `${x.num} ${x.name} ${x.tc}`).join(', ')})`,
  );
  const ff = hd.find((x) => x.name === 'Fireflies');
  T.ok(
    ff && ff.by.some((b) => /by-agent/.test(b) && /Claude/.test(b)) && /Firefly, by Claude/.test(ff.text),
    `the agent's device is signed on its track: "${ff?.text.replace(/[MSR]+$/, '')}"`,
  );
  T.ok(
    hd.filter((x) => x !== ff).every((x) => !x.by.length && !/house/i.test(x.text)),
    "the house's tracks are unsigned",
  );

  // a state for the canvas: Walk 2 selected, Hook muted, an agent's clip on Fireflies, the agent pointing at bars 2-3 of Keys
  const st = await E(() => {
    const o = window.overdub,
      tr = o.store.get().tracks;
    const bass = tr.find((t) => t.name === 'Bass'),
      hook = tr.find((t) => t.name === 'Hook'),
      ff = tr.find((t) => t.name === 'Fireflies'),
      keys = tr.find((t) => t.name === 'Keys');
    o.store.dispatch(
      { type: 'clip.set', track: hook.id, clip: hook.clips[0].id, patch: { mute: true } },
      { by: 'you', label: 'mute' },
    );
    const r = o.store.dispatch(
      {
        type: 'clip.add',
        track: ff.id,
        clip: {
          start: 0,
          length: 16,
          name: 'Answer',
          notes: 'A4@0:1 C5@1:1 E5@2:2 D5@4:1 C5@5:1 A4@6:2 E5@8:2 C5@10:2 A4@12:4',
        },
        ref: 'a',
      },
      { by: 'claude', label: 'answer' },
    );
    const w2 = bass.clips.find((c) => c.name === 'Walk 2');
    o.ui.select({ track: bass.id, clip: w2.id, notes: [] });
    o.arranger.selectClips([w2.id]);
    o.ui.state.presence = [
      {
        id: 'lp',
        by: 'claude',
        track: keys.id,
        range: { from: 4, to: 12 },
        note: '2 takes',
        until: Date.now() + 60000,
      },
    ];
    o.ui.emit('presence', o.ui.state.presence);
    o.arranger.zoomTo(0, 32);
    return { answer: r.created.a, w2: w2.id, hook: hook.clips[0].id, beat: tr[0].clips[0].id, keys: tr.indexOf(keys) };
  });
  await sleep(1800); // the agent's clip has arrived (its crop marks are gone)
  const look = await E((st) => {
    const o = window.overdub,
      cv = document.querySelector('.ar-lanes'),
      g = cv.getContext('2d'),
      d = cv.width / cv.clientWidth,
      sc = document.querySelector('.ar-scroll');
    const ppb = o.ui.state.zoom.pxPerBeat,
      TH = o.ui.state.zoom.trackH,
      rows = o.store.get().tracks.map((t) => t.id);
    const one = (x, y) => [...g.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data].slice(0, 3);
    const mid = (x, y) => {
      const a = [];
      for (let k = -3; k <= 3; k++) a.push(one(x + k, y));
      a.sort((p, q) => p[0] + p[1] + p[2] - q[0] - q[1] - q[2]);
      return a[3];
    };
    const rect = (id) => {
      const f = o.store.findClip(id);
      return {
        x: f.clip.start * ppb - sc.scrollLeft,
        y: rows.indexOf(f.track.id) * TH - sc.scrollTop + 4,
        w: f.clip.length * ppb,
        h: TH - 8,
      };
    };
    const cool = ([r, gg, b]) => b > 180 && r < 150 && gg > 120;
    const scan = (x0, y0, x1, y1) => {
      let n = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (cool(one(x, y))) n++;
      return n;
    };
    const w2 = rect(st.w2),
      hook = rect(st.hook),
      beat = rect(st.beat),
      ans = rect(st.answer);
    const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return {
      selLabel: mid(w2.x + w2.w / 2, w2.y + 8),
      selFrame: one(w2.x + w2.w / 2, w2.y + w2.h - 1),
      mutedLabel: mid(hook.x + hook.w / 2, hook.y + 8),
      beatLabel: mid(beat.x + beat.w / 2, beat.y + 8),
      ansByline: scan(
        Math.round(ans.x + ans.w - 50),
        Math.round(ans.y + 3),
        Math.round(ans.x + ans.w - 4),
        Math.round(ans.y + 14),
      ),
      ansNotes: scan(
        Math.round(ans.x + 4),
        Math.round(ans.y + 18),
        Math.round(ans.x + Math.min(ans.w, 300) - 4),
        Math.round(ans.y + ans.h - 3),
      ),
      beatByline: scan(
        Math.round(beat.x + beat.w - 60),
        Math.round(beat.y + 3),
        Math.round(beat.x + beat.w - 4),
        Math.round(beat.y + 14),
      ),
      crop: one(4 * ppb - sc.scrollLeft - 3 + 0.5, st.keys * TH - sc.scrollTop + 4 - 3 + 0.5),
      bg: tok('--bg'),
      text: tok('--text'),
      accent2: tok('--accent-2'),
    };
  }, st);
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const near = (a, b, tol = 14) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= tol);
  T.ok(
    near(look.selLabel, hex(look.text)) && near(look.selFrame, hex(look.text), 40),
    `the selected clip prints its label in reverse inside a cream frame (label ${look.selLabel}, frame ${look.selFrame}, --text ${look.text})`,
  );
  T.ok(
    near(look.mutedLabel, hex(look.bg), 8) && !near(look.beatLabel, hex(look.bg), 8),
    `a muted clip is printed in outline only, no fill (muted ${look.mutedLabel}, a playing clip ${look.beatLabel}, --bg ${look.bg})`,
  );
  T.ok(
    look.ansByline > 6 && look.beatByline === 0,
    `the agent's clip is signed in cool ink on its label line, the house's is not (${look.ansByline} cool px vs ${look.beatByline})`,
  );
  T.ok(
    look.ansNotes === 0,
    `cool ink stays off the agent's notes: they take the track colour (${look.ansNotes} cool px among them)`,
  );
  T.ok(
    near(look.crop, hex(look.accent2), 30),
    `the agent pointing at bars 2-3 of Keys gets a grease-pencil crop mark at its corner (${look.crop} vs ${look.accent2})`,
  );
  await shot('arrange-liner');

  // the first mute says the key, with Undo; after that, one line
  const toast = async () => {
    await sleep(120);
    return E(() => {
      const t = [...document.querySelectorAll('.ew-toast')].at(-1);
      return t
        ? {
            text: t.textContent,
            kbd: t.querySelector('kbd')?.textContent || '',
            undo: [...t.querySelectorAll('button')].some((b) => /Undo/.test(b.textContent)),
          }
        : null;
    });
  };
  await E((id) => {
    const o = window.overdub,
      f = o.store.findClip(id);
    o.arranger.selectClips([id]);
    o.ui.select({ track: f.track.id, clip: id, notes: [] });
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    document.querySelector('.ar-scroll').focus();
  }, st.beat);
  await page.keyboard.press('0');
  const t1 = await toast();
  T.ok(
    (await E((id) => window.overdub.store.findClip(id).clip.mute === true, st.beat)) &&
      t1 &&
      /Beat muted, bars 1–8\. It stays in the song/.test(t1.text) &&
      t1.kbd === '0' &&
      t1.undo,
    `the first clip mute says it stays and shows the key, with Undo ("${t1?.text}")`,
  );
  await page.keyboard.press('0');
  const t2 = await toast();
  T.ok(
    (await E((id) => !window.overdub.store.findClip(id).clip.mute, st.beat)) && t2 && /Beat plays again/.test(t2.text),
    `0 again unmutes it ("${t2?.text}")`,
  );
  await page.keyboard.press('0');
  const t3 = await toast();
  T.ok(
    t3 && /^Beat muted, bars 1–8\.\s*0 brings it back\./.test(t3.text) && !/stays in the song/.test(t3.text),
    `a later mute is one line, still with the key ("${t3?.text}")`,
  );
  await page.click('.ew-toast:last-child button');
  T.ok(await E((id) => !window.overdub.store.findClip(id).clip.mute, st.beat), 'Undo in the toast unmutes it');

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(
    errs.length === 0,
    'no page errors in the look checks' + (errs.length ? ':\n    ' + errs.slice(0, 6).join('\n    ') : ''),
  );
  await close();
}

/* ================================================================== dropping clips, moving take folders (FRESH-EYES round 5)
   A clip dropped onto another on the same track left both playing (21 notes where 10 belong), and a drag meant to select
   bars moved the playing piece of a comp away. A dropped clip takes the beats it covers on its track (what was under it
   is cut away there, one undo step with the move); a take folder moves whole; a drag across a comp's body selects bars,
   and its label line moves it */
{
  const { page, errors, close, shot } = await boot();
  const E = (fn, arg) => page.evaluate(fn, arg);
  await E(() => window.overdub.welcome?.close?.());
  const drag = async (x0, y0, x1, y1) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 10 });
    await page.mouse.up();
    await sleep(200);
  };
  // three tracks of our own at the top: Drop (A: bars 1–2, 10 notes; B: bars 5–6, 11 notes), Comp (a take folder over
  // bars 1–4, comped: Take 2 then Take 1), Takes (a take folder over bars 1–4, Take 2 playing over all of it)
  const ids = await E(async () => {
    const o = window.overdub,
      m = await import('/app/src/core/arrangement.js');
    const notes = (n, p) => Array.from({ length: n }, (_, i) => `${p + (i % 5)}@${(i * 0.7).toFixed(2)}:0.5`).join(' ');
    const r = o.store.dispatch(
      [
        {
          type: 'track.add',
          ref: 't',
          index: 0,
          track: { name: 'Drop', instrument: { device: 'core.keys', params: {} } },
        },
        { type: 'clip.add', track: '$t', ref: 'a', clip: { start: 0, length: 8, name: 'A', notes: notes(10, 60) } },
        { type: 'clip.add', track: '$t', ref: 'b', clip: { start: 16, length: 8, name: 'B', notes: notes(11, 72) } },
        {
          type: 'track.add',
          ref: 'c',
          index: 1,
          track: { name: 'Comp', instrument: { device: 'core.keys', params: {} } },
        },
        {
          type: 'track.add',
          ref: 'k',
          index: 2,
          track: { name: 'Takes', instrument: { device: 'core.keys', params: {} } },
        },
      ],
      { by: 'you', label: 'setup' },
    );
    const pass = (p) => Array.from({ length: 8 }, (_, i) => ({ p: p + i, t: i * 2, d: 1, v: 0.8 }));
    for (const [tid, take] of [
      [r.created.c, 'tk_ui000001'],
      [r.created.k, 'tk_ui000002'],
    ]) {
      o.store.dispatch(
        m.planTakeFolder(o.store.get(), {
          track: tid,
          kind: 'notes',
          start: 0,
          end: 16,
          take,
          passes: [
            { start: 0, end: 16, notes: pass(60) },
            { start: 0, end: 16, notes: pass(70) },
          ],
        }).ops,
        { by: 'you', label: 'two passes' },
      );
    }
    o.store.dispatch(
      m.planTakeComp(o.store.get(), { track: r.created.c, take: 'tk_ui000001', lane: 0, start: 8, end: 16 }).ops,
      { by: 'you', label: 'comp' },
    );
    o.arranger.zoomTo(0, 32);
    document.querySelector('.ar-scroll').scrollTop = 0;
    return { t: r.created.t, a: r.created.a, b: r.created.b, c: r.created.c, k: r.created.k };
  });
  await sleep(300);
  const at = (beat, track, dy = 0) =>
    E(([b, t, d]) => ({ x: window.overdub.arranger.xOf(b), y: window.overdub.arranger.yOf(t) + d }), [beat, track, dy]);
  const TH = await E(() => window.overdub.ui.state.zoom.trackH);
  // 1. A dropped onto B: only A plays in bars 5–6, and one undo puts both back
  let p0 = await at(4, ids.t),
    p1 = await at(20, ids.t);
  await drag(p0.x, p0.y, p1.x, p1.y);
  const dropped = await E((ids) => {
    const o = window.overdub,
      t = o.store.track(ids.t);
    const on = t.clips
      .filter((c) => !c.mute)
      .flatMap((c) => c.notes.filter((n) => n.t < c.length - 1e-9).map((n) => c.start + n.t))
      .filter((b) => b >= 16 && b < 24);
    return {
      n: on.length,
      a: o.store.findClip(ids.a)?.clip.start,
      b: !!o.store.findClip(ids.b),
      label: o.store.history.at(-1)?.label,
    };
  }, ids);
  T.ok(
    dropped.a === 16 && dropped.n === 10 && !dropped.b && /^move clip/.test(dropped.label || ''),
    `a clip dropped onto another on its track takes those beats: ${dropped.n} notes play in bars 5–6 (A's 10; B, covered whole, is gone; it was 21), in one step ("${dropped.label}")`,
  );
  const undone = await E((ids) => {
    const o = window.overdub;
    o.store.undo();
    return { a: o.store.findClip(ids.a)?.clip.start, b: o.store.findClip(ids.b)?.clip.notes.length };
  }, ids);
  T.ok(undone.a === 0 && undone.b === 11, `one undo puts A back at bar 1 and B back whole (${undone.b} notes)`);
  // a partial drop: B pulled back over the second half of A cuts A short where B begins
  p0 = await at(20, ids.t);
  p1 = await at(8, ids.t);
  await drag(p0.x, p0.y, p1.x, p1.y);
  const part = await E((ids) => {
    const o = window.overdub,
      a = o.store.findClip(ids.a)?.clip,
      b = o.store.findClip(ids.b)?.clip;
    return { a: a && [a.start, a.length, a.notes.filter((n) => n.t < a.length).length], b: b && [b.start, b.length] };
  }, ids);
  T.ok(
    part.b && part.b[0] === 4 && part.a && part.a[0] === 0 && part.a[1] === 4 && part.a[2] === 6,
    `dropped over half of A, B cuts A short where it begins (A ${part.a?.slice(0, 2)} with ${part.a?.[2]} notes, B ${part.b})`,
  );
  await E(() => window.overdub.store.undo());
  // 2. a comp's body: a drag across it selects bars and moves nothing
  const before = await E(
    (ids) => JSON.stringify(window.overdub.store.track(ids.c).clips.map((c) => [c.id, c.start, c.length, !!c.mute])),
    ids,
  );
  p0 = await at(1, ids.c, TH * 0.15);
  p1 = await at(5, ids.c, TH * 0.15);
  await drag(p0.x, p0.y, p1.x, p1.y);
  const sel = await E(
    (ids) => ({
      clips: JSON.stringify(window.overdub.store.track(ids.c).clips.map((c) => [c.id, c.start, c.length, !!c.mute])),
      range: window.overdub.ui.state.selection.range,
    }),
    ids,
  );
  T.ok(
    sel.clips === before && sel.range && sel.range.from <= 1 && sel.range.to >= 5,
    `a drag across a comp's body selects bars (${JSON.stringify(sel.range)}) and the playing piece stays where it is`,
  );
  // its label line moves the whole folder, every take with it
  p0 = await at(2, ids.c, -TH / 2 + 10);
  p1 = await at(18, ids.c, -TH / 2 + 10);
  await drag(p0.x, p0.y, p1.x, p1.y);
  const moved = await E(async (ids) => {
    const o = window.overdub,
      m = await import('/app/src/core/arrangement.js'),
      fs = m.takeFolders(o.store.track(ids.c));
    return {
      n: fs.length,
      f: fs[0] && {
        start: fs[0].start,
        end: fs[0].end,
        lanes: fs[0].lanes.length,
        comp: fs[0].comp.map((x) => `${x.start}-${x.end}:${x.lane}`).join(),
      },
      starts: o.store.track(ids.c).clips.map((c) => c.start),
    };
  }, ids);
  T.ok(
    moved.n === 1 &&
      moved.f.start === 16 &&
      moved.f.end === 32 &&
      moved.f.lanes === 2 &&
      moved.f.comp === '16-24:1,24-32:0' &&
      moved.starts.every((x) => x >= 16),
    `its label line moves the whole folder, both takes and the comp (${JSON.stringify(moved.f)})`,
  );
  // 3. a folder that isn't comped moves whole from anywhere on it: its muted take goes along
  p0 = await at(2, ids.k);
  p1 = await at(26, ids.k);
  await drag(p0.x, p0.y, p1.x, p1.y);
  const whole = await E(async (ids) => {
    const o = window.overdub,
      m = await import('/app/src/core/arrangement.js'),
      fs = m.takeFolders(o.store.track(ids.k));
    return {
      n: fs.length,
      starts: o.store.track(ids.k).clips.map((c) => [c.start, !!c.mute]),
      lanes: fs[0]?.lanes.length,
    };
  }, ids);
  T.ok(
    whole.n === 1 && whole.lanes === 2 && whole.starts.length === 2 && whole.starts.every(([s]) => s === 24),
    `dragging a take moves every take in its folder (${JSON.stringify(whole.starts)}), no muted take left behind`,
  );
  await shot('arrange-drop');
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(
    errs.length === 0,
    'no page errors in the drop checks' + (errs.length ? ':\n    ' + errs.slice(0, 6).join('\n    ') : ''),
  );
  await close();
}

/* ================================================================== phone width */
{
  const { page, errors, close, shot } = await boot({ width: 390, height: 844 });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  T.ok(wide <= 392, `no horizontal page scroll at 390 px (${wide})`);
  T.ok(await page.isVisible('.tp-play'), 'play is reachable on a phone');
  T.ok(await page.isVisible('.ar-lanes'), 'the arranger shows on a phone');
  await page.evaluate(() => {
    const t = overdub.store.get().tracks[1];
    overdub.ui.show('pianoroll');
    overdub.ui.select({ track: t.id, clip: t.clips[0].id });
  });
  await page.waitForTimeout(300);
  await shot('arrange-phone');
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(
    errs.length === 0,
    'no page errors at 390 px' + (errs.length ? ':\n    ' + errs.slice(0, 6).join('\n    ') : ''),
  );
  await close();
}

/* ================================================================== a song's colours are colours */
// A share link carries its song's track, clip and device colours, and they land in CSS (--tc, the swatches). A url()
// there was a read receipt: the browser fetched it the moment the link opened. Here a link whose colours all point at
// a beacon on another port opens, every view that draws a song colour draws, and nothing asks for the beacon. (The
// page's policy would refuse the fetch too, so a refusal fails this as well: the colour must never reach CSS.)
{
  const net = await import('node:net');
  const zlib = await import('node:zlib');
  const port = await new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  const beacon = `http://127.0.0.1:${port}/beacon.gif`,
    color = `url("${beacon}")`;
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  const gain =
    '({ create() { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] *= p.gain; R[i] *= p.gain; } } }; } })';
  const song = {
    format: 'overdub/0',
    id: 'p_beacon',
    title: 'Beacon',
    tempo: 120,
    meter: [4, 4],
    tracks: [
      {
        id: 't_keys',
        name: 'Keys',
        color,
        kind: 'instrument',
        instrument: { device: 'core.keys', params: {} },
        inserts: [{ id: 'fx_b', device: 'claude.beacon-gain', params: {}, on: true }],
        clips: [
          {
            id: 'c_keys',
            kind: 'notes',
            name: 'Hook',
            color,
            start: 0,
            length: 4,
            notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8 }],
          },
        ],
      },
      {
        id: 't_beat',
        name: 'Beat',
        color,
        kind: 'instrument',
        instrument: { device: 'core.drums', params: {} },
        inserts: [],
        clips: [
          {
            id: 'c_beat',
            kind: 'notes',
            name: 'Groove',
            color,
            start: 0,
            length: 4,
            notes: [{ id: 'n2', p: 36, t: 0, d: 0.25, v: 0.9 }],
          },
        ],
      },
    ],
    sections: [{ id: 's_a', name: 'A', start: 0, length: 16, color }],
    devices: {
      'claude.beacon-gain': {
        id: 'claude.beacon-gain',
        name: 'Beacon Gain',
        kind: 'effect',
        cat: 'utility',
        by: 'claude',
        blurb: 'a gain',
        params: [{ key: 'gain', label: 'GAIN', min: 0, max: 1, def: 0.8 }],
        look: { color, ink: color, led: color },
        kernel: gain,
      },
    },
    master: { gain: 0, inserts: [] },
    meta: { authors: {} },
  };
  const payload = JSON.stringify({
    f: 'overdub-share/0',
    at: '2026-10-02T00:00:00.000Z',
    from: { name: 'Mallory' },
    dropped: {},
    song,
  });
  const hash = '#s=' + zlib.deflateRawSync(Buffer.from(payload, 'utf8'), { level: 9 }).toString('base64url');

  const { page, context, base, errors, close, shot } = await open('/app/', { query: 'new' });
  const hits = [];
  await context.route(`http://127.0.0.1:${port}/**`, (r) => {
    hits.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`),
    );
  });
  await page.goto('about:blank');
  await page.goto(base + '/app/' + hash, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page
    .waitForFunction(() => window.overdub.store.get().title === 'Beacon', null, { timeout: 10000 })
    .catch(() => {});
  const E = (fn, arg) => page.evaluate(fn, arg);
  const step = (fn) => E(fn).then(() => sleep(250));
  await E(() => window.overdub.welcome?.close?.());
  // A link's colours are checked where it comes in (core/project.js isColor), so that alone would keep these out. The
  // views keep them out of CSS too: put them back in the song as one saved before that check could hold them (an
  // old autosave), redraw, and every view must still draw its fallback, not the url()
  const door = await E(() =>
    window.overdub.store
      .get()
      .tracks.map((t) => t.color)
      .join(' '),
  );
  await E((color) => {
    const o = window.overdub,
      p = o.store.get();
    for (const t of p.tracks) {
      t.color = color;
      for (const c of t.clips) c.color = color;
    }
    for (const x of p.sections) x.color = color;
    o.store.dispatch({ type: 'track.set', track: 't_beat', patch: { gain: -0.5 } }, { by: 'you', label: 'redraw' });
  }, color);
  await step(() => {
    const o = window.overdub;
    o.ui.select({ track: 't_keys', clip: 'c_keys' });
    o.ui.show('pianoroll');
  });
  await step(() => {
    const o = window.overdub;
    o.ui.select({ track: 't_beat', clip: 'c_beat' });
    o.ui.show('drumgrid');
  });
  await step(() => window.overdub.ui.show('mixer'));
  await step(() => {
    const o = window.overdub;
    o.ui.select({ track: 't_keys' });
    o.ui.show('rack');
  });
  await step(() => document.querySelector('[data-panel="rack"] .rk-track')?.click()); // the track picker: every track's dot
  const bg = (sel) =>
    E(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .map((el) => `${getComputedStyle(el).backgroundImage} ${getComputedStyle(el).backgroundColor}`)
          .join(' ') || 'none',
      sel,
    );
  const picker = await bg('.rk-menu .rk-dot');
  await step(() => {
    window.overdub.ui.setOpen?.('left', true);
    window.overdub.ui.show('browser');
  });
  await step(() => {
    const o = window.overdub;
    o.ui.select({ track: 't_keys' });
    o.input.qwerty.toggle(true);
  }); // musical typing's track dot
  const qwerty = await bg('.ew-qw-to i');
  await step(() => window.overdub.input.qwerty.toggle(false));
  await sleep(800);
  const seen = {
    picker,
    qwerty,
    head: await E(() => {
      const el = document.querySelector('.ar-head[data-track="t_keys"]');
      return el ? getComputedStyle(el).getPropertyValue('--tc').trim() : '';
    }),
    swatch: await bg('.ar-head[data-track="t_keys"] :is(.ar-swatch, .ar-hsw)'),
    chip: await bg('.mx-strip[data-track="t_keys"] .mx-chip'),
    roll: await bg('.pr-dot'),
    beat: await bg('.dg-dot'),
    rack: await bg('[data-panel="rack"] .rk-track .rk-dot'),
    browser: await bg('.br-target i'),
  };
  const opened = await E(() => ({
    title: window.overdub.store.get().title,
    tracks: window.overdub.store
      .get()
      .tracks.map((t) => t.id)
      .join(','),
  }));
  const all = JSON.stringify(seen);
  await shot('arrange-beacon');
  const refused = await E(() => window.__csp.filter((v) => /beacon/.test(v)));
  T.ok(
    opened.title === 'Beacon' && opened.tracks === 't_keys,t_beat' && !/url\(/.test(door),
    `a link whose colours are url() beacons opens (${opened.title}: ${opened.tracks}), its colours dropped at the door (${door})`,
  );
  T.ok(
    seen.head && Object.values(seen).every((v) => v !== 'none'),
    `the arranger, mixer, notes, beat grid, devices (and its track picker), musical typing and browser all draw a song colour: ${all.slice(0, 400)}`,
  );
  T.ok(
    !hits.length && !refused.length && !/url\(/.test(all),
    `no song colour reaches CSS as a url(): nothing asked for the beacon (${hits.length} requests${refused.length ? `, ${refused.length} refused by the policy: ${refused[0]}` : ''}); --tc is ${seen.head}`,
  );
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(
    errs.length === 0,
    'no page errors with the beacon song' + (errs.length ? ':\n    ' + errs.slice(0, 6).join('\n    ') : ''),
  );
  await close();
}

T.done();
