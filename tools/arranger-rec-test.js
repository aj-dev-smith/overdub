// The arranger while recording (docs/research/RECORDING-UX.md, wave B2), with real key and pointer events against
// the running demo (Night Shift):
//   - the welcome insert's main action is "Make your own" (the first minute on a new song, tools/onboard-test.js);
//   - clicking a track arms it (its R lit, the recorder's target), ⌘-click arms one more, a plain click moves it back;
//     a click on empty arranger space (the marker moves, the selection clears) never moves it: R's count-in lands on
//     the track that was armed, and the top bar's record key and its "Onto" name it, following it as it moves;
//   - tap a beat at bar 5: the count-in numeral (4 3 2 1) over the Drums lane, then the recording region in record
//     ink growing from bar 5 with the hits drawn in the lane as they land; the band goes when Space puts it in;
//   - two loop passes on keys: the punch line on the ruler, the first pass dimmed under the second; then a take stack
//     with a "3 takes" badge, the muted takes not drawn (and not hit), the badge's menu;
//   - ⌘↑ / ⌘↓ switch takes: one clip.set mute pair, one undo step; Flatten and Delete in the menu, each one step;
//   - the armed header's input meter; no stripes or pills in what the arranger injects.
//
//   node tools/arranger-rec-test.js
import { open, tally } from './pw.js';

const t = tally('arranger-rec');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { page, errors, close, shot } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  const E = (fn, a) => page.evaluate(fn, a);

  /* ---- the welcome insert: "Make your own" is its main action (the first minute on a new song: tools/onboard-test.js) */
  const wel = await E(() => { const el = document.querySelector('.ar-welcome'); const b = el && el.querySelector('.ar-welcome-acts .btn'); return el ? { main: b?.textContent, cls: b?.className, links: [...el.querySelectorAll('.ar-link')].map((x) => x.textContent) } : null; });
  t.ok(wel && wel.main === 'Make your own' && /ar-welcome-own/.test(wel.cls) && wel.links.includes('the tour') && wel.links.includes('ask the agent'), `the welcome's main action is "Make your own", the tour and the agent beside it (${JSON.stringify(wel)})`);
  await E(async () => { await window.overdub.engine.start(); });
  await page.click('.ar-welcome-x');
  await page.waitForTimeout(250);
  await E(() => { const app = window.overdub; app.engine.stop(); app.ui.setOpen?.('bottom', true); });
  await page.waitForTimeout(250);

  const ids = await E(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
  const tempo = await E(() => window.overdub.store.get().tempo);
  const spbMs = 60000 / tempo;
  const head = (name) => `.ar-head[data-track="${ids[name]}"]`;
  const armedNames = () => E(() => { const app = window.overdub; return app.arranger.armed().map((id) => app.store.track(id)?.name).sort(); });
  const lit = () => E(() => [...document.querySelectorAll('.ar-head')].filter((r) => r.querySelector('.ar-hb-arm')?.getAttribute('aria-pressed') === 'true').map((r) => r.querySelector('.ar-hname')?.textContent).sort());
  const clickHead = async (name, mods = []) => { const b = await page.$(head(name) + ' .ar-hname').then((x) => x.boundingBox()); await page.mouse.move(b.x + 4, b.y + b.height / 2); for (const m of mods) await page.keyboard.down(m); await page.mouse.down(); await page.mouse.up(); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(120); };

  /* ---- clicking a track arms it; ⌘-click arms one more; a plain click moves it */
  const hist0 = await E(() => window.overdub.store.history.length);
  await clickHead('Bass');
  const a1 = { armed: await armedNames(), lit: await lit(), target: await E(() => window.overdub.store.track(window.overdub.input.recorder.target)?.name), hist: await E(() => window.overdub.store.history.length) };
  t.ok(a1.armed.join() === 'Bass' && a1.lit.join() === 'Bass' && a1.target === 'Bass' && a1.hist === hist0, `clicking Bass's header selects and arms it: its R lit, R records there, nothing in the history (${JSON.stringify(a1)})`);
  await clickHead('Keys', ['Meta']);
  const a2 = { armed: await armedNames(), lit: await lit(), stored: await E(() => window.overdub.store.get().tracks.filter((x) => x.arm).map((x) => x.name).sort()), sel: await E(() => window.overdub.store.track(window.overdub.ui.state.selection.track)?.name) };
  t.ok(a2.armed.join() === 'Bass,Keys' && a2.lit.join() === 'Bass,Keys' && a2.stored.join() === 'Bass,Keys' && a2.sel === 'Bass', `⌘-click on Keys arms one more: Bass and Keys both armed (track.arm), the selection stays (${JSON.stringify(a2)})`);
  await clickHead('Drums');
  const a3 = { armed: await armedNames(), stored: await E(() => window.overdub.store.get().tracks.filter((x) => x.arm).map((x) => x.name)), label: await E(() => window.overdub.store.history.slice(-1)[0]?.label) };
  t.ok(a3.armed.join() === 'Drums' && !a3.stored.length && a3.label === 'arm Drums', `a plain click on Drums moves the arm there (the others give way, "${a3.label}") (${JSON.stringify(a3)})`);
  // the R key on a header: this track alone, on purpose; ⌘ adds
  await page.click(head('Guitar') + ' .ar-hb-arm');
  await page.waitForTimeout(100);
  const a4 = { armed: await armedNames(), stored: await E(() => window.overdub.store.get().tracks.filter((x) => x.arm).map((x) => x.name)) };
  await page.click(head('Guitar') + ' .ar-hb-arm');
  await page.waitForTimeout(100);
  const a5 = await armedNames();
  t.ok(a4.armed.join() === 'Guitar' && a4.stored.join() === 'Guitar' && a5.join() === 'Drums', `the R key arms its track on purpose, alone (${a4.armed}); again disarms it and the selected Drums is the target again (${a5})`);
  // the armed header's input meter
  const meter = await E(() => { const r = document.querySelector('.ar-head.armed'); const m = r && r.querySelector('.ar-hin'); const cs = m && getComputedStyle(m); const fill = m && getComputedStyle(m.firstElementChild); return r ? { track: r.dataset.track, shown: cs.display !== 'none', h: m.getBoundingClientRect().height, bottom: Math.round(r.getBoundingClientRect().bottom - m.getBoundingClientRect().bottom), grad: /gradient/.test(fill.backgroundImage), others: [...document.querySelectorAll('.ar-head:not(.armed) .ar-hin')].every((x) => getComputedStyle(x).display === 'none') } : null; });
  t.ok(meter && meter.track === ids.Drums && meter.shown && meter.h === 2 && meter.bottom <= 1 && meter.grad && meter.others, `the armed header has a 2 px input meter along its bottom edge (ok, warn, bad), the others none (${JSON.stringify(meter)})`);

  /* ---- tap a beat at bar 5: the count-in numeral, then the region and the hits drawn as they land */
  async function until(b, { grid = false } = {}) {
    for (let i = 0; i < 2000; i++) {
      const x = await E((g) => (g ? window.overdub.engine.gridBeat ?? -1e9 : window.overdub.engine.beat), grid);
      if (x >= b - 0.015) return x;
      await page.waitForTimeout(Math.max(1, Math.min(250, (b - x) * spbMs - 25)));
    }
    return null;
  }
  const state = () => E(() => window.overdub.input.recorder.state);
  async function idle() { for (let i = 0; i < 100 && (await state()) !== 'idle'; i++) await page.waitForTimeout(50); await page.waitForTimeout(120); }
  async function tapKey(code, ms = 60) { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); }
  const view = () => E(() => window.overdub.arranger.recView());
  // a pixel of the lanes (or the ruler) canvas, at view coordinates
  const pixel = (sel, x, y) => E(({ sel, x, y }) => { const cv = document.querySelector(sel); const k = cv.width / cv.clientWidth; const d = cv.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data; return [d[0], d[1], d[2]]; }, { sel, x, y });
  const ink = (n) => E((n) => { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); const m = /^#(..)(..)(..)/.exec(v); return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : null; }, n);
  const close3 = (a, b, tol = 40) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const REC = await ink('--rec');

  /* ---- deselecting never moves where R records (fresh eyes 5: Audio armed, a click on empty arranger space to move the
     marker, R, and the count-in landed on another track); the top bar says where R records, beside the record key */
  {
    await clickHead('Guitar');
    const g0 = { target: await E(() => window.overdub.store.track(window.overdub.input.recorder.target)?.name), lit: await lit() };
    const spot = await E(() => { const hs = [...document.querySelectorAll('.ar-head')], last = hs[hs.length - 1].getBoundingClientRect(), sc = document.querySelector('.ar-scroll').getBoundingClientRect(); return { x: sc.left + Math.min(260, sc.width / 2), y: Math.min(sc.bottom - 12, last.bottom + 40), marker: window.overdub.transport.marker.beat }; });
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(200);
    const g1 = await E(() => { const a = window.overdub, rb = document.querySelector('.tp-rec'); return { sel: a.ui.state.selection.track, marker: a.transport.marker.beat, target: a.store.track(a.input.recorder.target)?.name, onto: document.querySelector('.tp-recto-v')?.textContent, title: rb.title, label: rb.getAttribute('aria-label') }; });
    g1.lit = await lit();
    t.ok(g0.target === 'Guitar' && g0.lit.join() === 'Guitar' && g1.sel === null && g1.marker !== spot.marker && g1.target === 'Guitar' && g1.lit.join() === 'Guitar', `a click on empty arranger space moves the marker (beat ${spot.marker} → ${g1.marker}) and clears the selection, and R still records onto Guitar, its R still lit (${JSON.stringify({ before: g0, after: { sel: g1.sel, target: g1.target, lit: g1.lit } })})`);
    t.ok(g1.onto === 'Guitar' && /onto Guitar/.test(g1.title) && /onto Guitar/.test(g1.label), `the top bar says where R records, beside the record key ("Onto ${g1.onto}"), and the key's title says the same ("${g1.title}")`);
    await page.keyboard.press('KeyR');
    let cnt = null;
    for (let i = 0; i < 50 && !cnt; i++) { const v = await view(); if (v && v.state === 'count' && v.count) cnt = v; else await page.waitForTimeout(60); }
    const lv = await E(() => { const a = window.overdub; return { track: a.store.track(a.input.recorder.live()?.track)?.name, onto: document.querySelector('.tp-recto-v')?.textContent }; });
    await page.keyboard.press('KeyR');   // (R in the count calls it off: nothing recorded)
    await idle();
    t.ok(cnt && cnt.track === ids.Guitar && lv.track === 'Guitar', `then R: the count-in's numeral is over Guitar's lane and the take is Guitar's (${JSON.stringify({ count: cnt && cnt.count, lane: cnt && Object.keys(ids).find((k) => ids[k] === cnt.track), take: lv.track, onto: lv.onto })})`);
    // the key's title follows the target the moment it moves (a tester read "onto Bass" while the take went onto Hum)
    const said = () => E(() => ({ title: document.querySelector('.tp-rec').title, onto: document.querySelector('.tp-recto-v')?.textContent }));
    await clickHead('Bass');
    const tb = await said();
    await clickHead('Keys');
    const tk = await said();
    t.ok(/onto Bass/.test(tb.title) && tb.onto === 'Bass' && /onto Keys/.test(tk.title) && tk.onto === 'Keys', `the record key's title and "Onto" follow the target: "${tb.title}", then "${tk.title}"`);
    await clickHead('Drums');   // (the take below starts from Drums, selected)
  }

  /* ---- fresh eyes 5: in Hum it with a drum track selected, "Onto" names where the hum really lands (the first pitched
     track: a hum goes onto drums only when they're armed), and so do the record key, its menu and the count-in's
     numeral; clicking a header still arms that track (its R lit, the recorder's target) */
  {
    await E(() => { const a = window.overdub; a.ui.show('sketch'); a.input.emit('sketch:mode', 'hum'); });
    await page.waitForTimeout(150);
    await clickHead('Guitar');   // (a click on the selected track's name renames it: Drums is selected, so another first)
    await clickHead('Drums');
    const said = () => E(() => { const a = window.overdub, rb = document.querySelector('.tp-rec'); return { onto: document.querySelector('.tp-recto-v')?.textContent, title: rb.title, label: rb.getAttribute('aria-label'), target: a.store.track(a.input.recorder.target)?.name }; });
    const d1 = { ...(await said()), armed: await armedNames(), lit: await lit() };
    t.ok(d1.armed.join() === 'Drums' && d1.lit.join() === 'Drums' && d1.target === 'Drums', `in Hum it, clicking the Drums header still arms it: its R lit, the recorder's target (${JSON.stringify({ armed: d1.armed, lit: d1.lit, target: d1.target })})`);
    t.ok(d1.onto === 'Bass' && /your hum onto Bass/.test(d1.title) && /onto Bass/.test(d1.label), `and "Onto" names where the hum lands: Bass, the first pitched track, not the drums ("Onto ${d1.onto}"; "${d1.title}")`);
    await page.click('.tp-recto');
    await page.waitForTimeout(150);
    const m1 = await E(() => { const m = document.querySelector('[role=menu]'); return m ? { head: m.querySelector('.ek-head')?.textContent || '', items: [...m.querySelectorAll('.ek-item')].map((b) => b.textContent) } : null; });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    t.ok(m1 && m1.head === 'R records your hum onto' && m1.items.some((x) => /^Bass●?$/.test(x)) && !m1.items.some((x) => /^Drums/.test(x)), `its menu offers the tracks a hum goes onto, Bass marked, no drums (${JSON.stringify(m1)})`);
    await page.keyboard.press('KeyR');
    let cnt = null;
    for (let i = 0; i < 50 && !cnt; i++) { const v = await view(); if (v && v.state === 'count' && v.count) cnt = v; else await page.waitForTimeout(60); }
    const lv = await E(() => { const a = window.overdub; return { track: a.store.track(a.input.recorder.live()?.track)?.name, onto: document.querySelector('.tp-recto-v')?.textContent }; });
    await page.keyboard.press('KeyR');   // (R in the count calls it off, the hum with it)
    await idle();
    t.ok(cnt && cnt.track === ids.Bass && lv.track === 'Bass' && lv.onto === 'Bass', `R: the count-in's numeral is over Bass's lane, where the hum will land (${JSON.stringify({ lane: cnt && Object.keys(ids).find((k) => ids[k] === cnt.track), take: lv.track, onto: lv.onto })})`);
    // out of Hum it the drums are where R records again; in it, a pitched track clicked is where the hum goes
    await E(() => window.overdub.input.emit('sketch:mode', 'tap'));
    await page.waitForTimeout(150);
    const d2 = await said();
    await E(() => window.overdub.input.emit('sketch:mode', 'hum'));
    await clickHead('Keys');
    const d3 = { ...(await said()), lit: await lit() };
    t.ok(d2.onto === 'Drums' && d3.onto === 'Keys' && d3.lit.join() === 'Keys', `out of Hum it, "Onto" says Drums again ("${d2.onto}"); in it, Keys clicked is where the hum goes ("${d3.onto}", R lit on ${d3.lit.join()})`);
    await E(() => window.overdub.input.emit('sketch:mode', 'tap'));
    await clickHead('Drums');
  }

  await E(() => { const app = window.overdub; app.input.recorder.setCountIn(1); app.engine.seek(16); app.arranger.zoomTo(8, 40); });
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(120);
  const counts = new Set();
  let cv0 = null;
  for (let i = 0; i < 60; i++) {
    const v = await view();
    if (v && v.state === 'count' && v.count) { counts.add(v.count); if (!cv0) cv0 = v; }
    if (v && v.state === 'rec') break;
    if (v && v.count === 3 && !counts.has(-3)) { counts.add(-3); await shot('arranger-rec-countin'); }
    await page.waitForTimeout(90);
  }
  t.ok(cv0 && cv0.track === ids.Drums && [...counts].filter((k) => k > 0).every((k) => k >= 1 && k <= 4) && counts.size >= 3, `the count-in numeral counts down over the Drums lane (${[...counts].filter((k) => k > 0).join(' ')}), before anything records`);
  await until(16.5); await tapKey('KeyJ');    // snare on the "and" of beat 1, bar 5
  await page.waitForTimeout(60);
  const v1 = await view();
  await until(17.25); await tapKey('KeyK');   // hat on beat 2's second sixteenth
  await until(17.6);
  const v2 = await view();
  await shot('arranger-rec-mid-take');
  const band = v2 && v2.bands.find((b) => b.track === ids.Drums);
  t.ok(v2 && v2.state === 'rec' && band && band.from === 16 && band.to > 17.25 && band.x1 > band.x0, `while it records, the region grows on Drums from bar 5 to the playhead (${band && `${band.from}–${band.to.toFixed(2)}, ${band.x0}–${band.x1} px`})`);
  t.ok(v1 && v1.marks >= 1 && v2.marks >= 2, `each hit is drawn in the lane as it lands (${v1 && v1.marks} after the first tap, ${v2 && v2.marks} after the second)`);
  if (band) {
    const top = await pixel('.ar-lanes', Math.round((band.x0 + band.x1) / 2), band.y);
    t.ok(close3(top, REC), `the region's edge is record ink (${top} vs ${REC})`);
    // a hit: the snare row, at its beat (the third of four drum rows from the top)
    const hx = await E((b) => { const a = window.overdub.arranger; return a.xOf(b) - document.querySelector('.ar-lanes').getBoundingClientRect().left; }, 16.5);
    const ry = band.y + 3 + ((band.h - 6) / 4) * 2.5;
    const hp = await pixel('.ar-lanes', hx + 2, ry);
    const bg = await pixel('.ar-lanes', hx + 2, band.y + band.h - 6 - ((band.h - 6) / 4) * 3);
    t.ok(hp && bg && hp.reduce((s, x, i) => s + Math.abs(x - bg[i]), 0) > 60, `the snare hit is there in the lane at beat 16.5 (pixel ${hp}, the empty row above it ${bg})`);
  }
  await page.keyboard.press('Space');
  await idle();
  const after = await E((d) => { const app = window.overdub, tr = app.store.track(d); return { view: app.arranger.recView(), mine: tr.clips.flatMap((c) => c.notes.filter((n) => n.by === 'you').map((n) => n.p + '@' + (c.start + n.t))) }; }, ids.Drums);
  t.ok(!after.view && after.mine.length === 2 && after.mine.some((x) => /^38@16\.5$/.test(x)), `Space puts it in: the region goes and the hits are in Drums (${after.mine.join(' ')})`);
  await page.keyboard.press('KeyT');
  await E(() => { const app = window.overdub; app.engine.stop(); while (app.store.canUndo()) app.store.undo(); });

  /* ---- two loop passes on keys: the punch line, the first pass dimmed; then a take stack */
  await clickHead('Keys');
  await E(() => { const app = window.overdub; app.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 0, end: 4 } } }, { by: 'you', label: 'loop bar 1' }); app.engine.seek(0); app.arranger.zoomTo(0, 12); });
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await until(1, { grid: true }); await tapKey('KeyA', 150);    // pass 1: C4
  await until(5, { grid: true }); await tapKey('KeyS', 150);    // pass 2: D4
  await until(6, { grid: true });
  const vp = await view();
  const loopPx = await E(() => { const a = window.overdub.arranger, r = document.querySelector('.ar-ruler').getBoundingClientRect(); return { x: (a.xOf(0) + a.xOf(4)) / 2 - r.left }; });
  const punchPx = await pixel('.ar-ruler', loopPx.x, 21.5);
  t.ok(vp && vp.punch && close3(punchPx, REC), `the loop is the punch range: a record-ink line on the ruler's loop (${punchPx})`);
  t.ok(vp && vp.state === 'rec' && vp.marks >= 2 && vp.bands[0]?.from === 0, `pass 2 draws over the loop with pass 1's note still there, dimmed (${vp && vp.marks} marks)`);
  await shot('arranger-rec-pass2');
  await until(7.5, { grid: true });
  await page.keyboard.press('Space');
  await idle();
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(200);
  const stack = await E((k) => { const app = window.overdub, tr = app.store.track(k); const playing = tr.clips.find((c) => c.take && !c.mute); return { playing: playing?.id, name: playing?.name, takes: playing && app.arranger.takes(playing.id), badge: playing && app.arranger.badgeAt(playing.id) }; }, ids.Keys);
  t.ok(stack.takes && stack.takes.n === 3 && stack.takes.takes.filter((x) => x.playing).length === 1 && stack.takes.takes.filter((x) => x.hidden).length === 2, `two passes on keys make a stack of 3 takes (the covered bar and two passes), one playing, two muted and not drawn (${JSON.stringify(stack.takes && stack.takes.takes.map((x) => `${x.name}${x.playing ? ' playing' : ''}${x.hidden ? ' hidden' : ''}`))})`);
  t.ok(!!stack.badge, `the playing take carries the "3 takes" badge on its label line (${JSON.stringify(stack.badge)})`);
  // the badge, the menu and the recorder's toast count the same takes
  const said3 = await E(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '));
  const tn = /Take (\d+) is in/.exec(said3);
  // (stopped in the second time round: the takes are numbered in the order they were played, so the complete first pass
  // is Take 2 and plays, after what played there, and the pass you stopped in is Take 3; fresh eyes 5 had them the other
  // way round)
  const third = stack.takes && stack.takes.takes.find((x) => x.name === 'Take 3');
  t.ok(tn && `Take ${tn[1]}` === stack.name && stack.name === 'Take 2' && third && !third.playing && /Two more underneath, muted, the pass you stopped in among them/.test(said3) && stack.takes.n === 3, `the toast names the take that plays and counts the others the badge counts, the takes numbered in the order played ("${said3.slice(0, 120)}"; playing ${stack.name} of ${stack.takes.n})`);
  await shot('arranger-rec-stack');
  // a click where the clips sit hits the playing take, never a muted one under it
  const hitId = await E(({ k }) => { const a = window.overdub.arranger; const loc = a.locate(a.xOf(2), a.yOf(k) + 8); return loc; }, { k: ids.Keys });
  await page.mouse.click(await E(() => window.overdub.arranger.xOf(2)), await E((k) => window.overdub.arranger.yOf(k) + 10, ids.Keys));
  await page.waitForTimeout(100);
  const selAfter = await E(() => window.overdub.ui.state.selection.clip);
  t.ok(hitId && selAfter === stack.playing, `a click on the stack selects the playing take (${selAfter === stack.playing ? stack.name : selAfter})`);

  /* ---- ⌘↑ / ⌘↓: a clip.set mute pair, one undo step */
  const h0 = await E(() => window.overdub.store.history.length);
  await page.keyboard.press('Meta+ArrowUp');
  await page.waitForTimeout(150);
  const up = await E(({ k, was }) => { const app = window.overdub, tr = app.store.track(k), last = app.store.history.slice(-1)[0]; const playing = tr.clips.find((c) => c.take && !c.mute); return { n: app.store.history.length, ops: last.ops.map((o) => `${o.type}:${o.patch && 'mute' in o.patch ? o.patch.mute : ''}`), label: last.label, playing: playing?.name, wasMuted: !!tr.clips.find((c) => c.id === was)?.mute, sel: app.ui.state.selection.clip === playing?.id }; }, { k: ids.Keys, was: stack.playing });
  t.ok(up.n === h0 + 1 && up.ops.sort().join() === 'clip.set:false,clip.set:true' && up.wasMuted && up.playing !== stack.name && up.sel, `⌘↑ plays the take before (${stack.name} → ${up.playing}): one undo step of a clip.set mute pair ("${up.label}"; ${up.ops.join(', ')}; n ${up.n - h0}, was muted ${up.wasMuted}, selected ${up.sel})`);
  await page.keyboard.press('Meta+ArrowDown');
  await page.waitForTimeout(150);
  const down = await E((k) => window.overdub.store.track(k).clips.find((c) => c.take && !c.mute)?.name, ids.Keys);
  t.ok(down === stack.name, `⌘↓ goes back to ${down}`);
  await E(() => { window.overdub.store.undo(); window.overdub.store.undo(); });
  const undone = await E((k) => ({ n: window.overdub.store.history.length, playing: window.overdub.store.track(k).clips.find((c) => c.take && !c.mute)?.name }), ids.Keys);
  t.ok(undone.n === h0 && undone.playing === stack.name, `two undos put it back as it was (${undone.playing})`);
  // ⌘D on the playing take: the copy is an ordinary clip, not one more piece of the folder (Delete Take 2 there would
  // otherwise take the copy with it)
  const dup = await E(async ({ k, id }) => {
    const app = window.overdub, { takeFolders } = await import('/app/src/core/arrangement.js');
    const before = app.store.track(k).clips.length;
    app.arranger.duplicateClip(id);
    const tr = app.store.track(k), copy = tr.clips.find((c) => c.id === app.ui.state.selection.clip);
    const r = { added: tr.clips.length - before, copyTake: copy ? copy.take ?? null : 'none', copyOf: copy?.name, folders: takeFolders(tr).map((f) => `${f.start}-${f.end}:${f.lanes.length}`) };
    app.store.undo();
    return r;
  }, { k: ids.Keys, id: stack.playing });
  t.ok(dup.added === 1 && dup.copyTake === null && dup.folders.length === 1, `⌘D on the playing take copies it as an ordinary clip; the folder stays as it was (${dup.copyOf}: take ${dup.copyTake}; folders ${dup.folders.join(', ')})`);

  /* ---- comping: the badge opens the take lanes; a drag across a take's lane plays it there (FRESH-EYES-3 problem 4) */
  await page.waitForTimeout(100);
  const bpos = await E((id) => window.overdub.arranger.badgeAt(id), stack.playing);
  if (bpos) await page.mouse.click(bpos.x, bpos.y);
  await page.waitForTimeout(200);
  const lanesOpen = await E(() => ({ rows: window.overdub.arranger.takeRows(), heads: [...document.querySelectorAll('.ar-takehead')].map((x) => x.textContent) }));
  t.ok(lanesOpen.rows.length === 3 && lanesOpen.heads.length === 3 && lanesOpen.rows.map((r) => r.name).slice(1).join() === 'Take 2,Take 3' && /plays$/.test(lanesOpen.heads[1]) && /not playing/.test(lanesOpen.heads[2]), `a click on the "3 takes" badge opens the folder: a lane per take under the clip, headed with who played it and where it plays (${lanesOpen.heads.join(' | ')})`);
  const folder = () => E(async (k) => { const { takeFolders } = await import('/app/src/core/arrangement.js'); const tr = window.overdub.store.track(k); const f = takeFolders(tr).find((x) => x.lanes.length === 3); return f ? { id: f.id, cuts: f.cuts, comp: f.comp.map((x) => x.lane), pieces: f.lanes.map((l) => l.clips.length), names: f.lanes.map((l) => l.name) } : null; }, ids.Keys);
  const f0 = await folder();
  const h2 = await E(() => window.overdub.store.history.length);
  // drag across Take 3's lane (the pass the stop cut short) from beat 0.5 to 1.5, over its D4 (the snap grid takes it
  // to those beats)
  const lane2 = lanesOpen.rows[2];
  const x2 = await E(() => window.overdub.arranger.xOf(0.52)), x3 = await E(() => window.overdub.arranger.xOf(1.48));
  await page.mouse.move(x2, lane2.mid); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x2 + (x3 - x2) * i / 6, lane2.mid);
  await shot('arranger-comp-drag');
  await page.mouse.up();
  await page.waitForTimeout(200);
  const f1 = await folder();
  const c1 = await E(() => { const app = window.overdub, last = app.store.history.slice(-1)[0]; return { n: app.store.history.length, by: last.by, label: last.label, toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '', heads: [...document.querySelectorAll('.ar-takehead')].map((x) => x.textContent) }; });
  t.ok(f1 && f1.cuts.join() === `${f0.cuts[0]},0.5,1.5,${f0.cuts[1]}` && f1.comp.join() === '1,2,1' && f1.pieces.every((n) => n === 3), `dragging across Take 3's lane over beats 0.5–1.5 makes Take 3 play there and Take 2 around it: every take is cut there (${JSON.stringify(f1)})`);
  t.ok(c1.n === h2 + 1 && c1.by === 'you' && /Take 3 plays 1\.1\.3–1\.2\.3 on Keys/.test(c1.label) && /Take 3 plays 1\.1\.3–1\.2\.3 on Keys/.test(c1.toast), `one undo step, signed by you, said in the toast and the history ("${c1.label}")`);
  t.ok(/Take 3.*plays 1\.1\.3–1\.2\.3$/.test(c1.heads[2]) && /Take 2.*plays 1\.1–1\.1\.3, 1\.2\.3–2\.1$/.test(c1.heads[1]), `the lane heads say which take plays where, in bar.beat (${c1.heads.slice(1).join(' | ')})`);
  // the folder's top shows the comp: what plays at each beat, named
  const top = await E((k) => { const tr = window.overdub.store.track(k); return [0.25, 1, 3].map((b) => tr.clips.find((c) => c.take && !c.mute && c.start <= b && c.start + c.length > b)?.name); }, ids.Keys);
  const badges = await E((k) => window.overdub.store.track(k).clips.filter((c) => c.take && !c.mute).map((c) => !!window.overdub.arranger.badgeAt(c.id)), ids.Keys);
  await shot('arranger-comp');
  t.ok(top.join() === 'Take 2,Take 3,Take 2' && badges.filter(Boolean).length === 1, `the folder's own row shows the comp (${top.join(' | ')}) with one "3 takes" badge, not one per piece`);
  // ⌘↑ on the middle piece: the take before it plays there, the rest of the comp stays
  const mid = await E((k) => window.overdub.store.track(k).clips.find((c) => c.take && !c.mute && c.start === 0.5).id, ids.Keys);
  await E((id) => { const app = window.overdub, f = app.store.findClip(id); app.arranger.selectClips([id]); app.ui.select({ track: f.track.id, clip: id, notes: [], range: null }); app.ui.state.focus = 'arranger'; document.querySelector('.ar-scroll').focus(); }, mid);
  await page.keyboard.press('Meta+ArrowUp');
  await page.waitForTimeout(150);
  const f2 = await folder();
  t.ok(f2 && f2.cuts.length === 2 && f2.comp.join() === '1' && f2.pieces.every((n) => n === 1), `⌘↑ on Take 3's piece plays Take 2 there again, and the cuts join up: one clip per take (${JSON.stringify(f2)})`);
  await E(() => window.overdub.store.undo());
  // a click on Take 2's lane in that stretch does the same (the stretch under the pointer)
  const lane3 = (await E(() => window.overdub.arranger.takeRows()))[1];
  await E(() => document.querySelectorAll('.ew-toast').forEach((x) => x.remove()));   // (the toasts sit over the lanes' right half)
  await page.mouse.click(await E(() => window.overdub.arranger.xOf(1)), lane3.mid);
  await page.waitForTimeout(150);
  const f3 = await folder();
  t.ok(f3 && f3.comp.join() === '1' && f3.pieces.every((n) => n === 1), `a click on Take 2's lane in Take 3's stretch plays Take 2 there (${JSON.stringify(f3 && f3.comp)})`);
  await E(() => window.overdub.store.undo());
  // Split at the playhead (⌘E: S solos now) splits every take there; both halves stay folders, with their comps
  await E((k) => { const app = window.overdub, tr = app.store.track(k), c = tr.clips.find((x) => x.take && !x.mute && x.start === 1.5); app.engine.seek(3); app.arranger.selectClips([c.id]); app.ui.select({ track: k, clip: c.id, notes: [], range: null }); app.ui.state.focus = 'arranger'; document.querySelector('.ar-scroll').focus(); }, ids.Keys);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyE' : 'Control+KeyE');
  await page.waitForTimeout(200);
  const sp = await E(async (k) => {
    const { takeFolders } = await import('/app/src/core/arrangement.js');
    const app = window.overdub, fs = takeFolders(app.store.track(k)).filter((f) => f.lanes.length === 3);
    // (what the lane draws: no two shown clips on top of each other, the overlap the producer saw after a split)
    const shown = app.store.track(k).clips.filter((c) => !app.arranger.takes(c.id)?.takes.find((x) => x.clip === c.id)?.hidden);
    const overlap = shown.some((a) => shown.some((b) => a !== b && a.start < b.start + b.length - 1e-6 && b.start < a.start + a.length - 1e-6));
    return { overlap, folders: fs.map((f) => `${f.start}-${f.end}:${f.comp.map((x) => x.lane).join('')}`).sort(), label: app.store.history.slice(-1)[0].label, toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '', rows: app.arranger.takeRows().length };
  }, ids.Keys);
  t.ok(sp.folders.join(' ') === '0-3:121 3-4:1' && sp.rows === 3, `⌘E splits every take in the folder at the playhead: two folders, each keeping its takes and its comp, still open (${sp.folders.join(' ')}; "${sp.toast}")`);
  t.ok(/with the 2 takes under it/.test(sp.toast) && /both halves keep their takes/.test(sp.toast), 'the toast says every take was split');
  t.ok(!sp.overlap, 'after the split no two clips the Keys lane draws sit on top of each other (their labels never overprint)');
  await shot('arranger-comp-split');
  await E(() => { window.overdub.store.undo(); window.overdub.store.undo(); });
  await page.keyboard.down('Alt'); await page.keyboard.press('KeyT'); await page.keyboard.up('Alt');
  await page.waitForTimeout(150);
  const closed = await E(() => window.overdub.arranger.takeRows().length);
  t.ok(closed === 0, `⌥T closes the take lanes again (${closed} rows)`);

  /* ---- the takes menu (right-click, Takes…): the takes, flatten, delete */
  await page.mouse.click(await E(() => window.overdub.arranger.xOf(0.5)), await E((k) => window.overdub.arranger.yOf(k) + 10, ids.Keys), { button: 'right' });
  await page.waitForTimeout(150);
  await E(() => [...document.querySelectorAll('.ek-pop [role=menuitem]')].find((b) => /^Takes \(3\)/.test(b.textContent))?.click());
  await page.waitForTimeout(200);
  const menuItems = await E(() => [...document.querySelectorAll('.ek-pop [role=menuitem], .ek-pop .ek-head')].map((x) => x.textContent));
  t.ok(menuItems.some((x) => /^3 takes on Keys$/.test(x)) && menuItems.filter((x) => /^Take \d/.test(x)).length >= 2 && menuItems.some((x) => /^Show the take lanes/.test(x)) && menuItems.some((x) => /^Flatten/.test(x)) && menuItems.some((x) => /^Delete/.test(x)), `the clip menu's Takes… lists the takes, the take lanes, flatten and delete (${menuItems.join(' | ')})`);
  await shot('arranger-rec-take-menu');
  const flat = await E(async () => { const btn = [...document.querySelectorAll('.ek-pop [role=menuitem]')].find((b) => /^Flatten/.test(b.textContent)); btn.click(); await new Promise((r) => setTimeout(r, 100)); return null; });
  void flat;
  const fl = await E((k) => { const app = window.overdub, tr = app.store.track(k); return { takes: tr.clips.filter((c) => c.take).length, n: app.store.history.length, label: app.store.history.slice(-1)[0]?.label }; }, ids.Keys);
  t.ok(fl.takes === 0 && fl.n === h0 + 1 && /flatten/.test(fl.label), `Flatten keeps the playing take as a plain clip and the muted ones go, one undo step ("${fl.label}")`);
  await E(() => window.overdub.store.undo());
  const del = await E((id) => { const app = window.overdub; const r = app.arranger.deleteTake(id); const f = app.store.findClip(id); const k = app.store.track(app.store.get().tracks.find((x) => x.name === 'Keys').id); return { ok: r && r.ok, gone: !f, playing: k.clips.filter((c) => c.take && !c.mute).map((c) => c.name) }; }, stack.playing);
  t.ok(del.ok && del.gone && del.playing.length === 1, `Delete takes the playing take out and the newest one left plays (${del.playing})`);
  await E(() => window.overdub.store.undo());
  // the same take selected and deleted with the Delete key (the clip menu's Delete and arranger.deleteClip go the same
  // way): the newest one left plays, in the same undo step, rather than the bars going silent under muted takes
  const h1 = await E(() => window.overdub.store.history.length);
  await E((id) => { const app = window.overdub, f = app.store.findClip(id); app.arranger.selectClips([id]); app.ui.select({ track: f.track.id, clip: id, notes: [], range: null }); app.ui.state.focus = 'arranger'; document.querySelector('.ar-scroll').focus(); }, stack.playing);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  const delKey = await E(([id, k]) => { const app = window.overdub, tr = app.store.track(k); return { gone: !app.store.findClip(id), playing: tr.clips.filter((c) => c.take && !c.mute).map((c) => c.name), n: app.store.history.length }; }, [stack.playing, ids.Keys]);
  t.ok(delKey.gone && delKey.playing.length === 1 && delKey.n === h1 + 1, `the Delete key on the playing take does the same: it goes, the newest one left plays (${delKey.playing}), one undo step`);
  await E(() => window.overdub.store.undo());

  /* ---- one take folder per range, numbered as the core numbers it (core/arrangement.js takeFolders, takeNumber) */
  const agree = await E(async (k) => {
    const app = window.overdub, { takeFolders, takeNumber } = await import('/app/src/core/arrangement.js');
    const tr = app.store.track(k), playing = tr.clips.find((c) => c.take && !c.mute);
    const st = app.arranger.takes(playing.id), f = takeFolders(tr).find((x) => x.id === playing.take);
    app.ui.select({ track: k, clip: playing.id, notes: [], range: null });
    await new Promise((r) => setTimeout(r, 60));
    return { n: st.n, k: st.k, order: st.takes.map((x) => x.clip).join() === f.clips.map((c) => c.id).join(), numbered: f.clips.every((c, i) => !takeNumber(c) || takeNumber(c) === i + 1), names: st.takes.map((x) => x.name), hint: document.querySelector('.ar-hint').textContent, ranges: new Set(f.clips.map((c) => `${c.start}-${c.start + c.length}`)).size };
  }, ids.Keys);
  // (the take that plays, the complete first pass, is Take 2 of 3: the takes are numbered in the order played)
  t.ok(agree.order && agree.numbered && agree.ranges === 1 && agree.k === 2 && new RegExp(`^${agree.names[agree.k - 1]}, ${agree.k} of ${agree.n} takes`).test(agree.hint), `the stack is the core's take folder: one range, its order, "Take N" is entry N, and the hint names the one playing "${agree.hint.split(':')[0]}" (${agree.names.join(', ')})`);
  // a folder with an empty take in it, and a leftover piece of it over other bars (a song recorded before folders)
  const gap = await E(() => {
    const app = window.overdub, t0 = app.store.get().tracks.find((x) => x.name === 'Bass'), tk = 'tk_gapfold1';
    const r = app.store.dispatch([
      { type: 'clip.add', track: t0.id, ref: 'a', clip: { kind: 'notes', start: 64, length: 8, name: 'Walk', take: tk, mute: true, notes: [{ p: 40, t: 0, d: 1, v: 0.8 }] } },
      { type: 'clip.add', track: t0.id, ref: 'b', clip: { kind: 'notes', start: 64, length: 8, name: 'Take 2', take: tk, mute: true, notes: [] } },
      { type: 'clip.add', track: t0.id, ref: 'c', clip: { kind: 'notes', start: 64, length: 8, name: 'Take 3', take: tk, notes: [{ p: 43, t: 1, d: 1, v: 0.8 }] } },
      { type: 'clip.add', track: t0.id, ref: 'd', clip: { kind: 'notes', start: 56, length: 8, name: 'Take 4', take: tk, mute: true, notes: [{ p: 45, t: 0, d: 1, v: 0.8 }] } },
    ], { by: 'you', label: 'a folder with a gap' });
    app.arranger.selectClips([r.created.c]);
    app.ui.select({ track: t0.id, clip: r.created.c, notes: [], range: null });
    app.ui.state.focus = 'arranger';
    return { track: t0.id, ...r.created, st: app.arranger.takes(r.created.c) };
  });
  await page.keyboard.press('Meta+ArrowUp');
  await page.waitForTimeout(150);
  const gapUp = await E((g) => { const tr = window.overdub.store.track(g.track); return tr.clips.filter((c) => c.take === 'tk_gapfold1' && !c.mute).map((c) => c.name).join(); }, gap);
  t.ok(gap.st && gap.st.n === 3 && !gap.st.takes.some((x) => x.clip === gap.d), `a leftover piece over other bars is not a take of this range: 3 takes, not 4 (${gap.st && gap.st.takes.map((x) => x.name).join(', ')})`);
  t.ok(gapUp === 'Walk', `⌘↑ from Take 3 passes over the empty Take 2 and plays Walk, so the bars never go silent (playing: ${gapUp})`);
  await E(() => { const app = window.overdub; app.store.undo(); app.store.undo(); app.ui.select({ clip: null, range: null }); });

  /* ---- comping's edges (FRESH-EYES-4, the producer's problem 5): a comp's edges land on the grid line nearest where
     you let go, positions are bar.beat everywhere, one toast at a time, the takes menu says where each take plays in the
     whole comp, and Flatten merges what plays into one clip */
  const h4 = await E(() => window.overdub.store.history.length);
  const fe = await E(async (k) => {
    const app = window.overdub, { planTakeFolder, takeFolders } = await import('/app/src/core/arrangement.js');
    // three passes over bars 5–6, each note 1.2 beats long, so a comp's edge on a bar line cuts one
    const pass = (p0) => ({ start: 16, end: 24, notes: [0, 1.5, 3, 4.5, 6].map((t, i) => ({ p: p0 + i, t: 16 + t, d: 1.2, v: 0.8 })) });
    const tf = planTakeFolder(app.store.get(), { track: k, kind: 'notes', start: 16, end: 24, take: 'tk_fe4comp01', passes: [pass(60), pass(64), pass(67)] });
    app.store.dispatch(tf.ops, { by: 'you', label: 'three passes over bars 5–6' });
    app.arranger.zoomTo(0, 36);   // (the producer's zoom: about 15 px a beat, where the 1/16 snap works in half beats)
    const f = takeFolders(app.store.track(k)).find((x) => x.id === 'tk_fe4comp01');
    app.arranger.takeLanes(f.clips.find((c) => !c.mute).id, true);
    await new Promise((r) => setTimeout(r, 120));
    document.querySelectorAll('.ew-toast').forEach((x) => x.remove());
    return { lanes: f.lanes.map((l) => l.name), grid: app.arranger.locate(app.arranger.xOf(17), app.arranger.yOf(k)).grid };
  }, ids.Keys);
  const feRows = await E(() => window.overdub.arranger.takeRows());
  const feFolder = () => E(async (k) => { const { takeFolders } = await import('/app/src/core/arrangement.js'); const f = takeFolders(window.overdub.store.track(k)).find((x) => x.id === 'tk_fe4comp01'); return f ? f.comp.map((x) => `${f.lanes[x.lane]?.name}@${x.start}-${x.end}`) : null; }, ids.Keys);
  const takeToasts = () => E(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.querySelector('.ew-toast-text')?.textContent || '').filter((x) => /takes on|plays|Flattened/.test(x)));
  async function swipe(row, a, b) {
    const x0 = await E((v) => window.overdub.arranger.xOf(v), a), x1 = await E((v) => window.overdub.arranger.xOf(v), b);
    await page.mouse.move(x0, row.mid); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (x1 - x0) * i / 8, row.mid);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  // Take 2 from the bar-5 line to just past bar 6's (0.15 of a beat past it: the old drag pushed that out to beat 20.5)
  await swipe(feRows[1], 16.05, 20.15);
  const fe1 = { comp: await feFolder(), label: await E(() => window.overdub.store.history.slice(-1)[0].label), toasts: await takeToasts() };
  t.ok(fe.grid === 0.5 && fe1.comp && fe1.comp.join() === 'Take 2@16-20,Take 4@20-24', `a swipe across Take 2 from bar 5 to bar 6 stores bars 5–6 exactly, on the ${fe.grid}-beat grid line nearest where it was let go (${fe1.comp && fe1.comp.join(', ')})`);
  t.ok(/^comp: Take 2 plays 5\.1–6\.1 on Keys, 1 note cut at 6\.1$/.test(fe1.label) && fe1.toasts.length === 1 && /^Take 2 plays 5\.1–6\.1 on Keys, 1 note cut at 6\.1\.$/.test(fe1.toasts[0]), `it says where in bar.beat, and that the note ringing over the edge is cut there ("${fe1.label}"; toasts: ${JSON.stringify(fe1.toasts)})`);
  // Take 3 over the middle: its toast takes the place of the last one (which no longer describes the comp)
  await swipe(feRows[2], 20.1, 22.4);
  const fe2 = { comp: await feFolder(), toasts: await takeToasts(), heads: await E(() => [...document.querySelectorAll('.ar-takehead')].map((x) => `${x.querySelector('.ar-tkname').textContent}: ${x.querySelector('.ar-tkwhere').textContent}`)) };
  t.ok(fe2.comp.join() === 'Take 2@16-20,Take 3@20-22.5,Take 4@22.5-24' && fe2.toasts.length === 1 && /^Take 3 plays 6\.1–6\.3\.3 on Keys/.test(fe2.toasts[0]), `a later swipe replaces the earlier toast: one on screen, about the comp as it is now (${JSON.stringify(fe2.toasts)})`);
  t.ok(fe2.heads.join(' | ') === 'Changes: not playing | Take 2: plays 5.1–6.1 | Take 3: plays 6.1–6.3.3 | Take 4: plays 6.3.3–7.1', `the lane heads say where each take plays in one unit, bar.beat (${fe2.heads.join(' | ')})`);
  await shot('arranger-comp-fe4');
  // the takes menu, opened on the bar-5 piece: where each take plays in the whole comp (Take 3 isn't "muted")
  await page.mouse.click(await E(() => window.overdub.arranger.xOf(16.5)), await E((k) => window.overdub.arranger.yOf(k) + 10, ids.Keys), { button: 'right' });
  await page.waitForTimeout(150);
  await E(() => [...document.querySelectorAll('.ek-pop [role=menuitem]')].find((b) => /^Takes \(4\)/.test(b.textContent))?.click());
  await page.waitForTimeout(150);
  const feMenu = await E(() => [...document.querySelectorAll('.ek-pop [role=menuitem], .ek-pop .ek-head')].map((x) => x.textContent));
  t.ok(feMenu.includes('Take 3plays 6.1–6.3.3') && feMenu.includes('Take 2plays 5.1–6.1') && feMenu.includes('Changesnot playing, as it was') && !feMenu.some((x) => /muted/.test(x)) && feMenu.some((x) => /^4 takes on Keys, comped: a click plays one in 5\.1–6\.1$/.test(x)), `the takes menu describes the whole comp, not one piece of it (${feMenu.slice(0, 5).join(' | ')})`);
  // Flatten the comp: one clip, as Ableton's flatten makes, sounding as the comp did
  const heardComp = () => E((k) => window.overdub.store.track(k).clips.filter((c) => !c.mute && c.start >= 16 - 1e-6 && c.start < 24 - 1e-6).flatMap((c) => c.notes.filter((n) => n.t < c.length - 1e-6).map((n) => `${n.p}@${Math.round((c.start + n.t) * 1000) / 1000}:${Math.round(Math.min(n.d, c.length - n.t) * 1000) / 1000}`)).sort().join(' '), ids.Keys);
  const beforeFlat = await heardComp();
  await E(() => [...document.querySelectorAll('.ek-pop [role=menuitem]')].find((b) => /^Flatten the comp/.test(b.textContent))?.click());
  await page.waitForTimeout(150);
  const flat4 = await E((k) => { const tr = window.overdub.store.track(k); const cs = tr.clips.filter((c) => c.start >= 16 - 1e-6 && c.start < 24 - 1e-6); return { clips: cs.map((c) => `${c.name || tr.name}@${c.start}+${c.length}${c.take ? ' take' : ''}${c.mute ? ' muted' : ''}`), toasts: [...document.querySelectorAll('.ew-toast')].map((x) => x.querySelector('.ew-toast-text')?.textContent || '').filter((x) => /plays|Flattened|takes on/.test(x)) }; }, ids.Keys);
  const afterFlat = await heardComp();
  t.ok(flat4.clips.join() === 'Keys@16+8' && afterFlat === beforeFlat && flat4.toasts.length === 1 && /^Flattened the comp into one clip: Take 2, Take 3 and Take 4 as they played/.test(flat4.toasts[0]), `Flatten merges the comp into one clip that plays what the comp played (${flat4.clips.join(', ')}; "${flat4.toasts[0]}")`);
  await E((n) => { const app = window.overdub; while (app.store.history.length > n && app.store.canUndo()) app.store.undo(); document.querySelectorAll('.ew-toast').forEach((x) => x.remove()); }, h4);

  /* ---- Repeat ×4 leaves the view where it was (FRESH-EYES-4, the beginner's problem 4: it jumped to bars 8–12) */
  const rp = await E((k) => { const app = window.overdub, c = app.store.track(k).clips.slice().sort((a, b) => a.start - b.start)[0]; app.arranger.zoomTo(c.start, c.start + 8); return { id: c.id, start: c.start, len: c.length }; }, ids.Keys);
  await page.waitForTimeout(150);
  const sl0 = await E(() => document.querySelector('.ar-scroll').scrollLeft);
  await page.mouse.click(await E((b) => window.overdub.arranger.xOf(b), rp.start + 0.5), await E((k) => window.overdub.arranger.yOf(k) + 10, ids.Keys), { button: 'right' });
  await page.waitForTimeout(150);
  await E(() => [...document.querySelectorAll('.ek-pop [role=menuitem]')].find((b) => /^Repeat ×4/.test(b.textContent))?.click());
  await page.waitForTimeout(250);
  const rpAfter = await E((r) => { const app = window.overdub, sc = document.querySelector('.ar-scroll'), x = app.arranger.xOf(r.start), b = sc.getBoundingClientRect(); return { sl: sc.scrollLeft, inView: x >= b.left - 1 && x < b.right, label: app.store.history.slice(-1)[0].label }; }, rp);
  t.ok(/^repeat .* ×4$/.test(rpAfter.label) && Math.abs(rpAfter.sl - sl0) < 1 && rpAfter.inView, `after Repeat ×4 the view stays where it was, the clip still in it ("${rpAfter.label}"; scroll ${sl0} → ${rpAfter.sl})`);
  await E(() => window.overdub.store.undo());

  /* ---- selecting another track clears a clip selected on a different one (FRESH-EYES-4, the producer's problem 4) */
  const hs = await E(() => window.overdub.store.history.length);
  await E((r) => window.overdub.arranger.zoomTo(r.start, r.start + 16), rp);
  await page.waitForTimeout(100);
  await page.mouse.click(await E((b) => window.overdub.arranger.xOf(b), rp.start + 0.5), await E((k) => window.overdub.arranger.yOf(k) + 10, ids.Keys));
  await page.waitForTimeout(100);
  const selK = await E((k) => { const id = window.overdub.ui.state.selection.clip; return id && window.overdub.store.findClip(id)?.track.id === k ? id : null; }, ids.Keys);
  await clickHead('Bass');
  const selB = await E(() => ({ track: window.overdub.ui.state.selection.track, clip: window.overdub.ui.state.selection.clip, drawn: window.overdub.arranger.selectedClips().length, chip: document.querySelector('.ag-ctx-chip')?.textContent || '' }));
  t.ok(!!selK && selB.track === ids.Bass && selB.clip === null && selB.drawn === 0 && !/Changes|Keys/.test(selB.chip), `a Keys clip selected, then the Bass header clicked: the clip selection goes with it, so nothing reads "On Bass" with a Keys clip (${JSON.stringify({ ...selB, selK })})`);
  await E((n) => { const app = window.overdub; while (app.store.history.length > n && app.store.canUndo()) app.store.undo(); }, hs);

  /* ---- the agent's notes in your clip: signed by both, its notes outlined in cool ink at arranger zoom (FRESH-EYES-4,
     the beginner's problem 5) */
  const hm = await E(() => window.overdub.store.history.length);
  const mx = await E((k) => {
    const app = window.overdub;
    const r = app.store.dispatch({ type: 'clip.add', track: k, ref: 'm', clip: { start: 128, length: 8, name: 'Mine', notes: 'C3@0:1 E3@2:1 G3@4:1 C3@6:1' } }, { by: 'you', label: 'my tune' });
    const before = app.arranger.signedBy(r.created.m);
    app.store.dispatch({ type: 'notes.add', track: k, clip: r.created.m, notes: 'C4@1:0.5 E4@3:0.5 G4@5:0.5 C4@7:0.5' }, { by: 'claude', label: 'bouncier' });
    app.arranger.zoomTo(127, 137);
    return { id: r.created.m, before, after: app.arranger.signedBy(r.created.m) };
  }, ids.Bass);
  await page.waitForTimeout(1600);   // (the arrival's crop marks fade first: they are cool ink too)
  const AGENT = await ink('--agent');
  // a column through each kind of note: cool ink round Claude's (beats 129.1–129.4), none round yours (128.1–128.8)
  const coolIn = (a, b) => E(({ a, b, k }) => {
    const app = window.overdub, cv = document.querySelector('.ar-lanes'), r = cv.getBoundingClientRect(), s = cv.width / cv.clientWidth, g = cv.getContext('2d');
    const ag = getComputedStyle(document.documentElement).getPropertyValue('--agent').trim(), m = /^#(..)(..)(..)/.exec(ag), A = [1, 2, 3].map((i) => parseInt(m[i], 16));
    const x0 = Math.round((app.arranger.xOf(a) - r.left) * s), x1 = Math.round((app.arranger.xOf(b) - r.left) * s), yc = (app.arranger.yOf(k) - r.top) * s, hh = 22 * s;
    const d = g.getImageData(x0, Math.round(yc - hh), Math.max(1, x1 - x0), Math.round(hh * 2)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - A[0]) < 30 && Math.abs(d[i + 1] - A[1]) < 30 && Math.abs(d[i + 2] - A[2]) < 30) n++;
    return n;
  }, { a, b, k: ids.Bass });
  const coolClaude = await coolIn(129.1, 129.4), coolMine = await coolIn(128.1, 128.8);
  t.ok(mx.before === 'you' && mx.after === 'you and Claude', `a clip of yours with Claude's kept notes in it is signed by both: "${mx.after}" (it read "${mx.before}" before)`);
  t.ok(AGENT && coolClaude > 4 && coolMine === 0, `at arranger zoom Claude's notes keep a cool outline, yours none (${coolClaude} cool pixels round Claude's note, ${coolMine} round yours)`);
  await shot('arranger-mixed-authors');
  await E((n) => { const app = window.overdub; while (app.store.history.length > n && app.store.canUndo()) app.store.undo(); }, hm);

  /* ---- the loop strip: a drag in it draws a new loop, its middle moves it, its ends resize it; L loops the selection */
  await E(() => { const app = window.overdub; app.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 0, end: 32 } } }, { by: 'you', label: 'loop 1-8' }); app.arranger.zoomTo(0, 36); });
  await page.waitForTimeout(100);
  const stripY = await E(() => document.querySelector('.ar-ruler').getBoundingClientRect().top + 26);
  const xb = (b) => E((b) => window.overdub.arranger.xOf(b), b);
  const loopNow = () => E(() => { const l = window.overdub.store.get().loop; return `${l.on ? 'on' : 'off'} ${l.start}-${l.end}`; });
  const dragX = async (a, b) => { await page.mouse.move(a, stripY); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(a + (b - a) * i / 8, stripY); await page.mouse.up(); await page.waitForTimeout(120); };
  await dragX(await xb(20.2), await xb(23.8));
  const l1 = await loopNow();
  t.ok(l1 === 'on 20-24', `dragging inside the loop strip, away from the loop's middle, draws a new loop there (bars 1–8 became ${l1})`);
  await dragX(await xb(22), await xb(26));
  const l2 = await loopNow();
  t.ok(l2 === 'on 24-28', `dragging the loop's middle moves it (${l2})`);
  await dragX(await xb(28), await xb(30));
  const l3 = await loopNow();
  t.ok(l3 === 'on 24-30', `dragging its end resizes it (${l3})`);
  await E(() => { const app = window.overdub; app.ui.select({ track: null, clip: null, notes: [], range: { from: 8, to: 16 } }); app.ui.state.focus = 'arranger'; document.activeElement?.blur?.(); });
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(100);
  const l4 = await loopNow();
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(100);
  const l5 = await loopNow();
  await E(() => window.overdub.ui.select({ range: null }));
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(100);
  const l6 = await loopNow();
  t.ok(l4 === 'on 8-16' && l5 === 'off 8-16' && l6 === 'on 8-16', `with bars 3–4 selected L loops them (${l4}); L again turns it off (${l5}); L alone toggles it as before (${l6})`);

  /* ---- Stop with Follow on: the view comes back to the marker */
  await E(async () => { const app = window.overdub; app.store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you', label: 'loop off' }); app.arranger.zoomTo(0, 10); app.transport.marker.set(8); await app.transport.playStop(); });
  await page.waitForTimeout(300);
  await E(() => window.overdub.engine.seek(56));
  await page.waitForTimeout(500);
  const inView = (b) => E((b) => { const sc = document.querySelector('.ar-scroll').getBoundingClientRect(), x = window.overdub.arranger.xOf(b); return x >= sc.left && x <= sc.left + document.querySelector('.ar-scroll').clientWidth; }, b);
  const away = !(await inView(8));
  await E(() => window.overdub.transport.playStop());
  await page.waitForTimeout(400);
  const back = { playing: await E(() => window.overdub.engine.playing), beat: await E(() => window.overdub.engine.beat), seen: await inView(8) };
  t.ok(away && !back.playing && back.beat === 8 && back.seen, `stopping with Follow on brings the marker (bar 3) back into view (away while playing: ${away}; after: ${JSON.stringify(back)})`);

  /* ---- Follow while a take loops: the loop stays in view (FRESH-EYES-3: at the loop's end it flipped to bars 12–24) */
  {
    // the producer's view: bars 1–12, the loop bars 9–12 at its right edge; recording keys over it (R, real keys)
    const h3 = await E((k) => { const app = window.overdub; app.ui.select({ track: k, clip: null, notes: [], range: null }); app.input.recorder.setCountIn(0); app.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 32, end: 48 } } }, { by: 'you', label: 'loop bars 9-12' }); app.arranger.zoomTo(0, 48); app.engine.seek(44); app.ui.state.focus = 'arranger'; document.querySelector('.ar-scroll').focus(); return app.store.history.length; }, ids.Keys);
    await page.waitForTimeout(200);
    await page.keyboard.press('Backquote');
    await page.keyboard.press('KeyR');
    const seen = [];
    for (let i = 0; i < 400 && seen.filter((v) => v.wrapped).length < 4; i++) {
      seen.push(await E(() => { const sc = document.querySelector('.ar-scroll'), pb = window.overdub.ui.state.zoom.pxPerBeat, b = window.overdub.engine.beat; return { b, from: sc.scrollLeft / pb, to: (sc.scrollLeft + sc.clientWidth) / pb, rec: window.overdub.input.recorder.state }; }));
      const v = seen[seen.length - 1], u = seen[seen.length - 2];
      if (u && v.b < u.b - 4) v.wrapped = true;
      if (seen.some((x) => x.wrapped) && v.b > 34) break;
      await page.waitForTimeout(30);
    }
    await page.keyboard.press('Space');
    await idle();
    await page.keyboard.press('Backquote');
    const rec = seen.filter((v) => v.rec === 'rec');
    const lost = rec.filter((v) => v.from > 32 + 0.01 || v.to < 48 - 0.01);
    t.ok(rec.length > 10 && seen.some((v) => v.wrapped) && !lost.length, `recording over the loop with Follow on, the loop stays in view through its end and back (${rec.length} frames over the wrap; views off the loop: ${lost.length ? lost.slice(0, 3).map((v) => `${v.from.toFixed(1)}–${v.to.toFixed(1)} at ${v.b.toFixed(2)}`).join(', ') : 'none'})`);
    await E((n) => { const app = window.overdub; app.engine.stop(); while (app.store.history.length > n - 1 && app.store.canUndo()) app.store.undo(); }, h3);
  }

  /* ---- opening a song: at the top, fitted; Fit on a 2-bar song; a take that grows the song keeps its end in view */
  await E(() => { const sc = document.querySelector('.ar-scroll'); sc.scrollTop = sc.scrollHeight; });
  await page.waitForTimeout(80);
  const scrolled = await E(() => document.querySelector('.ar-scroll').scrollTop);
  await E(async () => { const app = window.overdub, m = await import('/app/src/core/demo.js'); app.store.load(m.demoProject(), { by: 'overdub' }); });
  await page.waitForTimeout(250);
  const opened = await E(() => { const sc = document.querySelector('.ar-scroll'), app = window.overdub, p = app.store.get(), bpb = 4; const end = Math.max(...p.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length))); return { top: sc.scrollTop, bars: sc.clientWidth / app.ui.state.zoom.pxPerBeat / bpb, endBars: end / bpb, first: app.arranger.yOf(p.tracks[0].id) - sc.getBoundingClientRect().top }; });
  t.ok(scrolled > 20 && opened.top === 0 && opened.first > 0 && opened.bars >= opened.endBars && opened.bars <= opened.endBars + 1, `a song opens at the top (it was scrolled ${scrolled} px down; now ${opened.top}, its first track in view) and fitted (${opened.bars.toFixed(1)} bars for ${opened.endBars})`);
  const fit2 = await E(async () => {
    const app = window.overdub, { createProject } = await import('/app/src/core/project.js');
    app.store.load(createProject(), { by: 'overdub' });
    app.store.dispatch({ type: 'track.add', ref: 'd', track: { kind: 'instrument', name: 'Drums', instrument: { device: 'core.drums', params: {} } } }, { by: 'you' });
    const d = app.store.get().tracks[0].id;
    app.store.dispatch({ type: 'clip.add', track: d, clip: { kind: 'notes', start: 0, length: 8, notes: [{ p: 36, t: 0, d: 0.25, v: 0.8 }, { p: 38, t: 5, d: 0.25, v: 0.8 }] } }, { by: 'you' });
    app.arranger.zoomTo(0, 120);
    await new Promise((r) => requestAnimationFrame(r));
    return { id: d };
  });
  await page.click('.ar-bar .ar-tool:text-is("Fit")');
  await page.waitForTimeout(100);
  const fitBars = await E(() => document.querySelector('.ar-scroll').clientWidth / window.overdub.ui.state.zoom.pxPerBeat / 4);
  t.ok(fitBars >= 4 && fitBars < 5, `Fit on a 2-bar song shows 4 bars, not 17 (${fitBars.toFixed(2)})`);
  const grown = await E(async (d) => {
    const app = window.overdub;
    const r = app.store.dispatch({ type: 'clip.add', track: d, ref: 'k', clip: { kind: 'notes', start: 8, length: 40, take: 'tk_grow0001', name: 'Take 1', notes: [{ p: 36, t: 38, d: 0.25, v: 0.8 }] } }, { by: 'you', label: 'a long take' });
    app.arranger.show([r.created.k], 'you');
    for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(res));
    const sc = document.querySelector('.ar-scroll').getBoundingClientRect(), w = document.querySelector('.ar-scroll').clientWidth;
    const x0 = app.arranger.xOf(8), x1 = app.arranger.xOf(48);
    return { start: x0 >= sc.left - 1, end: x1 <= sc.left + w + 1 };
  }, fit2.id);
  t.ok(grown.start && grown.end, `a take that runs past the song's end is shown whole, its end in view (${JSON.stringify(grown)})`);
  await E(async () => { const app = window.overdub, m = await import('/app/src/core/demo.js'); app.store.load(m.demoProject(), { by: 'overdub' }); });
  await page.waitForTimeout(250);

  /* ---- recording keys over a busy part: the count numeral reads, and each note is drawn as it is played */
  const ids2 = await E(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
  await page.emulateMedia({ reducedMotion: 'reduce' });   // (the numeral still: the pixels are its own, not a fade)
  await E((k) => { const app = window.overdub; app.ui.select({ track: k, clip: null, notes: [], range: null }); app.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 0, end: 32 } } }, { by: 'you', label: 'loop 1-8' }); app.input.recorder.setCountIn(1); app.transport.marker.set(16); app.engine.seek(16); app.arranger.zoomTo(8, 40); }, ids2.Keys);
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  const TEXT = await ink('--text'), BG = await ink('--bg');
  let numeral = null;
  for (let i = 0; i < 60 && !numeral; i++) {
    const v = await view();
    if (v && v.state === 'count' && v.countAt) {
      const c = v.countAt;
      numeral = await E(({ c, TEXT }) => {
        const cv = document.querySelector('.ar-lanes'), k = cv.width / cv.clientWidth, g = cv.getContext('2d');
        const d = g.getImageData(Math.round(c.x * k), Math.round((c.y - 20) * k), Math.max(1, Math.round(c.w * k)), Math.round(40 * k)).data;
        let cream = 0; for (let j = 0; j < d.length; j += 4) if (Math.abs(d[j] - TEXT[0]) + Math.abs(d[j + 1] - TEXT[1]) + Math.abs(d[j + 2] - TEXT[2]) < 30) cream++;
        return { cream, k: c };
      }, { c, TEXT });
      await shot('arranger-rec-countin-keys');
    }
    await page.waitForTimeout(60);
  }
  t.ok(numeral && numeral.cream > 30, `the count numeral over the busy Keys part is solid cream on a room-coloured halo, not faint grey (${numeral && numeral.cream} cream pixels)`);
  await until(16.5);
  await tapKey('KeyA', 120);
  await until(17.2);
  await page.keyboard.down('KeyG');
  await page.waitForTimeout(250);
  const kv = await view();
  const kb = kv && kv.bands.find((b) => b.track === ids2.Keys);
  const KEYS = await E((k) => { const v = getComputedStyle(document.querySelector(`.ar-head[data-track="${k}"]`)).getPropertyValue('--tc').trim(); const el = document.createElement('i'); el.style.color = v; document.body.append(el); const m = getComputedStyle(el).color.match(/\d+/g).map(Number); el.remove(); return m.slice(0, 3); }, ids2.Keys);
  const notePx = kv?.at ? await pixel('.ar-lanes', kv.at.x, kv.at.y) : null;
  // the ground under the band where nothing has been played yet (beats 16.05-16.4): what played before is set back
  let spread = 0;
  if (kb) {
    const xs = [16.05, 16.15, 16.25, 16.35].map(async (b) => (await E((b) => window.overdub.arranger.xOf(b) - document.querySelector('.ar-lanes').getBoundingClientRect().left, b)));
    const cols = await Promise.all(xs);
    const px = [];
    for (const x of cols) for (let y = kb.y + 3; y < kb.y + kb.h - 3; y += 2) px.push(await pixel('.ar-lanes', x, y));
    const mean = [0, 1, 2].map((i) => px.reduce((s, p) => s + p[i], 0) / px.length);
    spread = Math.max(...px.map((p) => p.reduce((s, v, i) => s + Math.abs(v - mean[i]), 0)));
  }
  await shot('arranger-rec-keys-live');
  t.ok(kv && kv.state === 'rec' && kv.marks >= 2 && kv.held >= 1 && notePx && close3(notePx, KEYS, 30), `each key is drawn in the Keys lane as it is played, the held one growing (${kv && kv.marks} marks, ${kv && kv.held} held; note pixel ${notePx} vs the track's ${KEYS})`);
  t.ok(kb && spread < 40, `under the band the busy part it replaces is set back to the room, so the new notes read (the ground varies by ${Math.round(spread)} where nothing is played yet)`);
  void BG;
  await page.keyboard.up('KeyG');
  await page.keyboard.press('Space');
  await idle();
  await page.keyboard.press('Backquote');
  await page.emulateMedia({ reducedMotion: null });
  await E(() => { const app = window.overdub; app.engine.stop(); while (app.store.canUndo()) app.store.undo(); });

  /* ---- a phone: a finger drag on a clip or a track name scrolls; a hold picks it up (and says where Mute is) */
  {
    const ctx = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const ph = await ctx.newPage();
    const perr = [];
    ph.on('pageerror', (e) => perr.push(String(e)));
    await ph.goto(page.url().replace(/\?.*$/, '') + '?demo', { waitUntil: 'load' });
    await ph.evaluate(() => { localStorage.setItem('overdub:welcomed', '1'); localStorage.removeItem('overdub:clip-lift-hint'); localStorage.removeItem('overdub:track-lift-hint'); });
    await ph.reload({ waitUntil: 'load' });
    await ph.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    await ph.waitForTimeout(400);
    const PE = (fn, a) => ph.evaluate(fn, a);
    const cdp = await ctx.newCDPSession(ph);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 })) });
    const swipe = async (x0, y0, x1, y1, hold = 0) => { await touch('touchStart', [[x0, y0]]); await sleep(hold || 30); for (let i = 1; i <= 10; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10]]); await sleep(16); } await touch('touchEnd', []); await ph.waitForTimeout(250); };
    const st = () => PE(() => ({ top: document.querySelector('.ar-scroll').scrollTop, n: window.overdub.store.history.length, last: window.overdub.store.history.slice(-1)[0]?.label || '' }));
    const pids = await PE(() => { const o = window.overdub; o.arranger.zoomTo(0, 32); return Object.fromEntries(o.store.get().tracks.map((x) => [x.name, x.id])); });
    await ph.waitForTimeout(150);
    // a vertical swipe up on the Keys clip
    const kx = await PE(() => window.overdub.arranger.xOf(6)), ky = await PE((k) => window.overdub.arranger.yOf(k) + 6, pids.Keys);
    const s0 = await st();
    await swipe(kx, ky, kx, ky - 140);
    const s1 = await st();
    const keysClip = await PE((k) => window.overdub.store.track(k).clips.map((c) => c.start).join(), pids.Keys);
    t.ok(s1.n === s0.n && s1.top > s0.top + 20 && keysClip === '0', `phone: a finger swiped up on a clip scrolls the tracks (${s0.top} → ${s1.top} px) and moves nothing (history ${s0.n} → ${s1.n})`);
    // a vertical swipe down on a track's name
    const hb = await PE((k) => { const r = document.querySelector(`.ar-head[data-track="${k}"] .ar-hname`).getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; }, pids.Hook);
    const order0 = await PE(() => window.overdub.store.get().tracks.map((x) => x.name).join());
    await swipe(hb.x, hb.y, hb.x, hb.y + 120);
    const s2 = await st();
    const order1 = await PE(() => window.overdub.store.get().tracks.map((x) => x.name).join());
    t.ok(s2.n === s1.n && order1 === order0 && s2.top < s1.top, `phone: a finger swiped down on a track's name scrolls (${s1.top} → ${s2.top} px) and reorders nothing`);
    await PE(() => { document.querySelector('.ar-scroll').scrollTop = 0; });
    await ph.waitForTimeout(100);
    // hold the Bass's second clip, then drag it a bar later: it moves; the first hold says how, and where Mute is
    const bx = await PE(() => window.overdub.arranger.xOf(20)), by = await PE((k) => window.overdub.arranger.yOf(k) + 6, pids.Bass);
    const bx1 = await PE(() => window.overdub.arranger.xOf(24));
    const bassBefore = await PE((k) => window.overdub.store.track(k).clips.map((c) => c.start).join(), pids.Bass);
    await swipe(bx, by, bx1, by, 750);
    const toast = await PE(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '));
    const s3 = await st();
    const bassAfter = await PE((k) => window.overdub.store.track(k).clips.map((c) => c.start).join(), pids.Bass);
    t.ok(/^move clip/.test(s3.last) && bassAfter !== bassBefore, `phone: held first, a drag moves the clip (${bassBefore} → ${bassAfter}, "${s3.last}")`);
    t.ok(/Holding .* opens its menu/.test(toast) && /Mute/.test(toast), `phone: the first hold says what holding does and where Mute is ("${toast.slice(0, 140)}")`);
    await PE(() => window.overdub.store.undo());
    // hold and let go: the clip's menu, Mute in it
    await touch('touchStart', [[bx, by]]); await sleep(750); await touch('touchEnd', []);
    await ph.waitForTimeout(250);
    const items = await PE(() => [...document.querySelectorAll('.ek-pop [role=menuitem]')].map((b) => b.textContent));
    t.ok(items.some((x) => /^Mute/.test(x)), `phone: a hold opens the clip's menu (still open once let go), with Mute (${items.slice(0, 9).join(', ')})`);
    await PE(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })));
    await ph.keyboard.press('Escape');
    await ph.waitForTimeout(150);
    // hold a track's name, then drag it down past the next track: it moves
    const hk = await PE((k) => { const r = document.querySelector(`.ar-head[data-track="${k}"] .ar-hname`).getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; }, pids.Drums);
    const th0 = await PE(() => window.overdub.ui.state.zoom.trackH);
    await swipe(hk.x, hk.y, hk.x, hk.y + th0 * 1.6, 750);
    const order2 = await PE(() => window.overdub.store.get().tracks.map((x) => x.name).join());
    t.ok(order2 !== order0 && order2.split(',')[1] === 'Drums', `phone: held first, a drag on a track's name moves the track (${order2})`);
    // the "3 takes" badge: a 40 px target for a finger, its menu on the tap (not the touch), and a scroll can start on it
    await PE(() => { const app = window.overdub; while (app.store.canUndo()) app.store.undo(); app.arranger.zoomTo(0, 32); document.querySelector('.ar-scroll').scrollTop = 0; });
    const tk = await PE((k) => {
      const app = window.overdub;
      const r = app.store.dispatch([1, 2, 3].map((n) => ({ type: 'clip.add', track: k, ref: 'k' + n, clip: { kind: 'notes', start: 32, length: 8, take: 'tk_probe1', name: `Take ${n}`, mute: n < 3, notes: [{ p: 40 + n, t: 0, d: 1, v: 0.8 }] } })), { by: 'you', label: 'three takes' });
      app.arranger.zoomTo(24, 44);
      return r.created.k3;
    }, pids.Bass);
    await ph.waitForTimeout(250);
    const bd = await PE((id) => window.overdub.arranger.badgeAt(id), tk);
    const pops = () => PE(() => `${window.overdub.arranger.takeRows().length} take rows`);
    const closeMenu = async () => { await PE(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))); await ph.waitForTimeout(120); };
    // a tap 14 px below the badge's middle (on the clip's head, where a finger lands): the takes menu
    await touch('touchStart', [[bd.x, bd.y + 14]]); await sleep(60);
    const onDown = await pops();
    await touch('touchEnd', []); await ph.waitForTimeout(200);
    const onTap = await pops();
    t.ok(onDown === '0 take rows' && onTap === '3 take rows', `phone: a tap a finger's width off the "3 takes" badge opens the take lanes, on the tap and not the touch (${onDown}, then ${onTap})`);
    await PE((id) => window.overdub.arranger.takeLanes(id, false), tk);
    await closeMenu();
    // a horizontal swipe that starts on the badge scrolls, and opens nothing
    const sl0 = await PE(() => document.querySelector('.ar-scroll').scrollLeft);
    await swipe(bd.x, bd.y, bd.x + 140, bd.y);
    const sl1 = await PE(() => document.querySelector('.ar-scroll').scrollLeft);
    const afterSwipe = await pops();
    t.ok(sl1 < sl0 - 20 && afterSwipe === '0 take rows', `phone: a swipe that starts on the badge scrolls (scrollLeft ${sl0} → ${sl1}) and opens nothing`);
    await closeMenu();
    await ph.screenshot({ path: `${process.env.OUTDIR || 'tools/.out'}/arranger-rec-phone.png` });
    t.ok(!perr.length, `phone: no page errors${perr.length ? ': ' + perr.slice(0, 2).join(' | ') : ''}`);
    await ctx.close();
  }

  /* ---- the look: no stripes, no pills in what the arranger injects */
  const cssText = await E(() => [...document.querySelectorAll('style')].map((s) => s.textContent).filter((x) => /\.ar-hin/.test(x)).join('\n'));
  t.ok(cssText && !/inset\s+\d+(\.\d+)?px\s+0\s+0/.test(cssText) && !/99px|border-radius:\s*50%/.test(cssText), 'the arranger\'s CSS has no stripe and no pill');

  /* ---- the mic onto Guitar: its peaks drawn in the lane as they come in, the input meter moving */
  await page.addInitScript(`(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const app = window.overdub; await app.engine.start();
      const ctx = app.engine.ctx, o = ctx.createOscillator(), g = ctx.createGain(), d = ctx.createMediaStreamDestination();
      o.frequency.value = 330; g.gain.value = 0.4; o.connect(g); g.connect(d); o.start();
      return d.stream;
    };
  })();`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await E(async () => { const app = window.overdub; await app.engine.start(); app.input.recorder.setCountIn(0); app.store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you' }); app.engine.seek(8); });
  await clickHead('Guitar');
  await page.keyboard.press('KeyR');
  let pv = null, inMeter = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    pv = await view();
    inMeter = await E(() => document.querySelector('.ar-head.armed .ar-hin-fill')?.style.clipPath || '');
    if (pv && pv.peaks > 10 && i >= 14) break;   // (a second and a half of audio: a take long enough to keep)
  }
  const gid = await E(() => window.overdub.store.get().tracks.find((x) => x.name === 'Guitar').id);
  t.ok(pv && pv.state === 'rec' && pv.bands.some((b) => b.track === gid) && pv.peaks > 10, `recording the mic onto Guitar, its peaks are drawn in the lane as they come in (${pv && pv.peaks} columns)`);
  const shown = /inset\(0px? ([\d.]+)%/.exec(inMeter);
  t.ok(shown && +shown[1] < 60, `and the armed header's input meter shows the input (${inMeter})`);
  await shot('arranger-rec-audio');
  await page.keyboard.press('Space');
  await idle();
  for (let i = 0; i < 30 && !(await E((g) => window.overdub.store.track(g).clips.some((c) => c.kind === 'audio' && c.take), gid)); i++) await page.waitForTimeout(100);
  const au = await E((g) => window.overdub.store.track(g).clips.filter((c) => c.kind === 'audio' && c.take && !c.mute).length, gid);
  t.ok(au >= 1 && !(await view()), `Space puts the audio take in (${au} clip) and the band goes`);

  const own = errors.filter((e) => !/favicon/.test(e));
  t.ok(!own.length, `no page errors${own.length ? ': ' + own.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  t.ok(false, 'crashed: ' + (e && e.stack || e));
} finally {
  await close();
}
t.done();
