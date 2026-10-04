// Knobs and faders on lanes [ui-mix] (docs/research/AUTOMATION.md 3.6, wave B2): app/src/ui/faces.js, rack.js,
// mixer.js and the top bar's "Back to the lanes" (transport.js). Real pointer events on a song with lanes:
//   - the controls read core/automation.js's travel (a log knob and the fader law), not copies of their own
//   - a knob, the fader and the pan on a playing lane sit at the lane's value (stopped: at the marker), move with the
//     song while it plays, and say "auto"
//   - turning one holds the lane in one undo step ([insert.set | track.set, auto.set off]); it says "held", the toast
//     says so once, the top bar offers "Back to the lanes (n held)"; the hold is in the song (and in what plays)
//   - "held" on the control and the top bar's word give the lane back (one undo step each)
//   - right-click, the menu key and a long press on touch open the menu; Automate opens the lane via
//     app.arranger.showLane({ track, insert?, param })
//   - a finger (ui/touch.js): a knob is picked up by a hold before it turns, so a long press is the hold and then the
//     menu's own; a finger that drags at once turns nothing (it scrolls what the knob sits in)
//   node tools/knobs-auto-test.js      (screenshots: tools/.out/knobs-auto-*.png)
import { open, tally } from './pw.js';

const T = tally('knobs-auto');
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g/.test(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await open('/app/', { query: 'demo' });
const { page, errors, close, shot } = s;
const E = (fn, a) => page.evaluate(fn, a);
try {
  await E(() => { localStorage.setItem('overdub:welcomed', '1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(400);

  /* ---- the controls' travel is core/automation.js's */
  const travel = await E(async () => {
    const core = await import('/app/src/core/automation.js');
    const mixer = await import('/app/src/ui/mixer.js');
    const same = [-96, -60, -30, -12, -6, -1.5, 0, 3, 6].every((db) => mixer.dbToPos(db) === core.dbToPos(db))
      && [0, 0.01, 0.2, 0.5, 0.8, 0.95, 1].every((x) => mixer.posToDb(x) === core.posToDb(x));
    return { same, src: await (await fetch('/app/src/ui/faces.js')).text() };
  });
  T.ok(travel.same, 'the mixer\'s fader law is core/automation.js\'s (dbToPos / posToDb agree everywhere)');
  T.ok(/import \{ toPos, fromPos \} from '\.\.\/core\/automation\.js'/.test(travel.src) && !/const toPos = /.test(travel.src), 'faces.js turns knobs through core/automation.js\'s toPos / fromPos, not a copy');

  /* ---- a song with lanes: Keyhole cutoff (log), the track's level and pan */
  const setup = await E(() => {
    const o = window.overdub, st = o.store;
    st.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you' });
    const t = st.get().tracks.find((x) => x.kind === 'instrument' && x.instrument);
    const r = st.dispatch({ type: 'insert.add', track: t.id, insert: { device: 'core.filter', params: { cutoff: 1000 } } }, { by: 'you', label: 'add Keyhole' });
    const fx = r.created.insert;
    const w = st.dispatch([
      { type: 'auto.write', track: t.id, insert: fx, param: 'cutoff', points: '0:200 16:8000' },
      { type: 'auto.write', track: t.id, param: 'gain', points: '0:-30 16:0' },
      { type: 'auto.write', track: t.id, param: 'pan', points: '0:-1 16:1' },
    ], { by: 'claude', label: 'lanes' });
    o.ui.select({ track: t.id, insert: null });
    o.ui.show('rack');
    // a spy on the arranger's lane opener (the arranger builds showLane; the knobs call it by that name)
    window.__shown = [];
    const had = typeof o.arranger?.showLane === 'function';
    const orig = o.arranger?.showLane;
    if (o.arranger) o.arranger.showLane = (a, b) => { const addr = b && typeof b === 'object' ? b : a; window.__shown.push(addr); let r; try { r = orig ? orig(a, b) : true; } catch (e) { r = e.message; } window.__shownR = r; return r === null ? true : r; };
    return { ok: r.ok && w.ok, track: t.id, name: t.name, fx, had, gain: t.gain, pan: t.pan };
  });
  T.ok(setup.ok, `a song with three lanes: Keyhole cutoff on ${setup.name} (${setup.fx}), its level and its pan`);
  T.note(`app.arranger.showLane ${setup.had ? 'is there (the arranger\'s)' : 'is not built yet: a spy stands in'}`);
  const tid = setup.track, fx = setup.fx;
  await E(() => window.overdub.transport.marker.set(8));
  await sleep(250);

  const knob = (key) => E(({ fx, key }) => {
    const card = document.querySelector(`.rk-card[data-insert="${fx}"]`);
    const w = card?.querySelector(`.kn[data-key="${key}"]`), d = w?.querySelector('.kn-dial'), m = w?.querySelector('.ewf-am');
    return w ? { now: +d.getAttribute('aria-valuenow'), text: d.getAttribute('aria-valuetext'), title: d.title, mark: m ? m.dataset.mark : null, markText: m?.textContent, rot: w.style.getPropertyValue('--kv') } : null;
  }, { fx, key });
  const lane = (addr) => E((addr) => { const o = window.overdub; const p = o.store.get(); const t = p.tracks.find((x) => x.id === addr.track); const host = addr.insert ? t.inserts.find((x) => x.id === addr.insert) : t; const l = host.auto?.[addr.param]; return l ? { off: !!l.off, n: l.points.length } : null; }, addr);
  const cutA = { track: tid, insert: fx, param: 'cutoff' }, gainA = { track: tid, param: 'gain' }, panA = { track: tid, param: 'pan' };

  /* ---- the knob sits on its lane's value at the marker, on the lane's (log) travel, and says auto */
  let k = await knob('cutoff');
  const expect8 = Math.sqrt(200 * 8000); // halfway on a log knob from 200 Hz to 8 kHz
  T.ok(k && Math.abs(k.now - expect8) / expect8 < 0.01, `stopped at bar 3 (beat 8), Cutoff shows its lane's value halfway along the log travel (${k?.now} ≈ ${expect8.toFixed(0)} Hz, not the static 1000)`);
  T.ok(k && k.mark === 'auto' && /follows its lane/.test(k.text) && /Follows its lane \(Cutoff, bars 1–4\)/.test(k.title), `it wears "auto" and says so ("${k?.text}"; title "${k?.title?.slice(0, 40)}…")`);
  const rotOk = await E(async ({ k }) => { const core = await import('/app/src/core/automation.js'); return Math.abs(+k.rot - core.toPos({ min: 30, max: 18000, curve: 'log' }, k.now)) < 0.002; }, { k });
  T.ok(rotOk, `the dial's turn is core's toPos of that value (--kv ${k?.rot})`);
  await shot('knobs-auto-rack');

  /* ---- it moves with the song */
  await E(() => window.overdub.transport.marker.set(0));
  await sleep(150);
  await E(() => window.overdub.engine.play(0));
  await sleep(500);
  const a1 = (await knob('cutoff')).now;
  await sleep(700);
  const a2 = (await knob('cutoff')).now;
  await E(() => window.overdub.engine.stop());
  await sleep(300);
  T.ok(a2 > a1 && a1 > 200, `playing, the knob turns by itself with the lane (${a1} → ${a2} Hz)`);

  /* ---- turning it holds the lane: one undo step, "held", the toast, the top bar */
  await E(() => window.overdub.transport.marker.set(8));
  await sleep(200);
  const hist0 = await E(() => window.overdub.store.history.length);
  const dial = await page.$(`.rk-card[data-insert="${fx}"] .kn[data-key="cutoff"] .kn-dial`);
  const bb = await dial.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 - i * 4);
  await page.mouse.up();
  await sleep(200);
  const after = await E(({ fx, tid }) => {
    const o = window.overdub, st = o.store, h = st.history;
    const fxo = st.get().tracks.find((x) => x.id === tid).inserts.find((x) => x.id === fx);
    const last = h[h.length - 1];
    return { n: h.length, cutoff: fxo.params.cutoff, off: !!fxo.auto?.cutoff?.off, ops: last.ops.map((x) => x.type + (x.patch?.off != null ? ':' + x.patch.off : '')), toast: [...document.querySelectorAll('.ew-toast, .toast, [class*="toast"]')].map((x) => x.textContent).join(' | '),
      held: document.querySelector('.tp-g-held')?.hidden === false ? document.querySelector('.tp-held')?.getAttribute('aria-label') : null, json: JSON.stringify(st.get()).includes('"off":true') };
  }, { fx, tid });
  k = await knob('cutoff');
  T.ok(after.n === hist0 + 1, `the turn is one undo step (${hist0} → ${after.n})`);
  T.ok(after.off && after.ops.includes('auto.set:true') && after.ops.some((x) => x.startsWith('insert.set')), `it holds the lane and sets the knob in that one step (${[...new Set(after.ops)].join(', ')})`);
  T.ok(after.cutoff > expect8 * 1.05, `the turn starts from where the knob was (the lane's ${expect8.toFixed(0)} Hz) and goes up (${after.cutoff} Hz)`);
  T.ok(k.mark === 'held' && /held/.test(k.text) && k.markText === 'held', `the knob says "held" ("${k.text}")`);
  const said = await E(async (v) => (await import('/app/src/ui/faces.js')).valueText({ unit: 'Hz', min: 30, max: 18000, step: 0, curve: 'log' }, v), after.cutoff);
  T.ok(after.toast.includes(`Cutoff is held at ${said}. Its lane is off until you bring it back.`), `when the turn ends the toast says what happened, where it ended ("${after.toast.match(/Cutoff is held[^|]*?back\./)?.[0]}")`);
  T.ok(after.held === 'Back to the lanes (1 held)', `the top bar offers "${after.held}"`);
  T.ok(after.json, 'the hold is in the song (lane.off), so renders and agents hear what you hear');
  const specNow = await E(async ({ tid, fx }) => { const strip = await import('/app/src/engine/strip.js'); const t = window.overdub.store.get().tracks.find((x) => x.id === tid); return { cut: strip.trackSpec(t, { at: 8 }).inserts.find((x) => x.id === fx).params.cutoff, stat: t.inserts.find((x) => x.id === fx).params.cutoff }; }, { tid, fx });
  T.ok(specNow.cut === specNow.stat, `what plays at beat 8 is the knob's own value while held (${specNow.cut} Hz)`);
  // a second toast doesn't come for the next hold in this song (once per song)
  await shot('knobs-auto-held');

  /* ---- undo puts the lane and the value back in one step */
  await E(() => window.overdub.store.undo());
  await sleep(150);
  k = await knob('cutoff');
  let L = await lane(cutA);
  const stat = await E(({ tid, fx }) => window.overdub.store.get().tracks.find((x) => x.id === tid).inserts.find((x) => x.id === fx).params.cutoff, { tid, fx });
  T.ok(!L.off && stat === 1000 && k.mark === 'auto' && Math.abs(k.now - expect8) / expect8 < 0.01, `one undo: the lane plays again, the static value is back (${stat} Hz), the knob is on the lane (${k.now})`);
  T.ok(await E(() => document.querySelector('.tp-g-held')?.hidden === true), 'and the top bar\'s word is gone');

  /* ---- "held" on the knob gives it back */
  await E(() => window.overdub.store.redo());
  await sleep(150);
  T.ok((await lane(cutA)).off, 'redo holds it again');
  await page.click(`.rk-card[data-insert="${fx}"] .kn[data-key="cutoff"] .ewf-am`);
  await sleep(150);
  L = await lane(cutA);
  k = await knob('cutoff');
  const lastLabel = await E(() => { const h = window.overdub.store.history; return h[h.length - 1].label; });
  T.ok(!L.off && k.mark === 'auto', `clicking "held" brings it back to the lane ("${lastLabel}")`);

  /* ---- right-click: the menu, Automate opens the lane by its address */
  await page.click(`.rk-card[data-insert="${fx}"] .kn[data-key="cutoff"] .kn-dial`, { button: 'right' });
  await sleep(150);
  let items = await E(() => [...document.querySelectorAll('.ew-automenu .ek-item')].map((b) => b.textContent));
  T.ok(items.some((x) => x.startsWith('Automate')) && items.some((x) => x.startsWith('Hold it here')), `right-click on the knob opens its menu (${items.join(' / ')})`);
  await page.click('.ew-automenu .ek-item:first-of-type');
  await sleep(150);
  let shown = await E(() => window.__shown);
  T.ok(shown.length === 1 && shown[0].track === tid && shown[0].insert === fx && shown[0].param === 'cutoff', `Automate calls app.arranger.showLane(${JSON.stringify(shown[0])})`);
  if (setup.had) {
    const res = await E(() => window.__shownR);
    T.ok(res && typeof res === 'object' && res.param === 'cutoff', `the arranger opens the Cutoff lane (${JSON.stringify(res)})`);
  }
  // a knob with no lane: Automate is still there (it opens a new lane)
  await page.click(`.rk-card[data-insert="${fx}"] .kn[data-key="reso"] .kn-dial`, { button: 'right' });
  await sleep(120);
  items = await E(() => [...document.querySelectorAll('.ew-automenu .ek-item')].map((b) => b.textContent));
  T.ok(items.length === 1 && /open a lane/.test(items[0]), `a knob with no lane offers Automate to open one (${items.join(' / ')})`);
  await page.keyboard.press('Escape');
  // the menu key on a focused knob
  await page.focus(`.rk-card[data-insert="${fx}"] .kn[data-key="cutoff"] .kn-dial`);
  await page.keyboard.press('Shift+F10');
  await sleep(120);
  T.ok(await E(() => !!document.querySelector('.ew-automenu')), 'Shift+F10 on a focused knob opens the same menu');
  await page.keyboard.press('Escape');
  await sleep(100);

  /* ---- a long press on touch: the menu, and nothing turns (a knob is picked up by a hold first, then the menu's own
     long press: about 0.9 s in all, as the mixer's fader has it) */
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const db = await (await page.$(`.rk-card[data-insert="${fx}"] .kn[data-key="cutoff"] .kn-dial`)).boundingBox();
  const hBefore = await E(() => window.overdub.store.history.length);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const cx = db.x + db.width / 2, cy = db.y + db.height / 2;
  await tp('touchStart', cx, cy);
  await sleep(250);
  await tp('touchMove', cx + 2, cy - 2); // a finger is never quite still
  await sleep(800);
  await tp('touchEnd');
  await sleep(200);
  const lp = await E(() => ({ menu: !!document.querySelector('.ew-automenu'), items: [...document.querySelectorAll('.ew-automenu .ek-item')].map((b) => b.textContent), n: window.overdub.store.history.length }));
  L = await lane(cutA);
  T.ok(lp.menu && lp.items.some((x) => x.startsWith('Automate')), `a long press on the knob (touch) opens its menu (${lp.items.join(' / ')})`);
  T.ok(lp.n === hBefore && !L.off, 'and turns nothing: the lane still plays, nothing in History');
  await page.keyboard.press('Escape');
  await sleep(100);
  // a finger that drags at once turns nothing (it would scroll what the knob sits in); held still a moment first, it
  // turns the knob (and holds the lane)
  await tp('touchStart', cx, cy);
  for (let i = 1; i <= 10; i++) { await tp('touchMove', cx, cy - i * 5); await sleep(16); }
  await tp('touchEnd');
  await sleep(200);
  L = await lane(cutA);
  const hSwipe = await E(() => window.overdub.store.history.length);
  T.ok(!L.off && hSwipe === hBefore, 'a finger that drags from the knob at once turns nothing: the lane still plays, nothing in History');
  await tp('touchStart', cx, cy);
  await sleep(450);
  for (let i = 1; i <= 10; i++) { await tp('touchMove', cx, cy - i * 5); await sleep(16); }
  await tp('touchEnd');
  await sleep(200);
  L = await lane(cutA);
  T.ok(L.off, 'a finger held still a moment, then moved, turns the knob and holds the lane');
  await E(() => window.overdub.store.undo());
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await sleep(150);

  /* ---- the mixer: the fader and the pan on their lanes */
  await E(() => { window.overdub.ui.show('mixer'); window.overdub.transport.marker.set(8); });
  await sleep(300);
  const strip = () => E(async ({ tid }) => {
    const core = await import('/app/src/core/automation.js');
    const t = window.overdub.store.get().tracks.find((x) => x.id === tid);
    const el = document.querySelector(`.mx-strip[data-track="${tid}"]`);
    const th = el.querySelector('.mx-thumb'), gm = el.querySelector('.mx-dbrow .mx-am'), pm = el.querySelector('.mx-am-pan'), pk = el.querySelector('.mx-pan .mk');
    return { g: +th.getAttribute('aria-valuenow'), gt: th.getAttribute('aria-valuetext'), out: el.querySelector('.mx-db').textContent, gm: gm.hidden ? null : gm.dataset.mark, pm: pm.hidden ? null : pm.dataset.mark,
      pan: +pk.getAttribute('aria-valuenow'), want: core.valueAt(t.auto.gain, 8, core.MIXER.gain), wantPan: core.valueAt(t.auto.pan, 8, core.MIXER.pan), gTitle: gm.title };
  }, { tid });
  let m = await strip();
  T.ok(Math.abs(m.g - m.want) < 1e-6 && m.gm === 'auto', `the fader sits on its lane's value at the marker on the fader's travel (${m.g.toFixed(2)} dB = valueAt ${m.want.toFixed(2)}) and says "${m.gm}"`);
  T.ok(Math.abs(m.pan - m.wantPan) < 1e-6 && m.pm === 'auto', `the pan sits on its lane (${m.pan}) and says "${m.pm}"`);
  T.ok(/follows its lane/.test(m.gt) && /Follows its lane/.test(m.gTitle), `they say so to a screen reader ("${m.gt}")`);
  await shot('knobs-auto-mixer');
  // drag the fader: one step, held
  const h1 = await E(() => window.overdub.store.history.length);
  const thumb = await (await page.$(`.mx-strip[data-track="${tid}"] .mx-thumb`)).boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + i * 3);
  await page.mouse.up();
  await sleep(200);
  m = await strip();
  const gl = await lane(gainA);
  const gops = await E(() => { const h = window.overdub.store.history; return [...new Set(h[h.length - 1].ops.map((x) => x.type))]; });
  const h2 = await E(() => window.overdub.store.history.length);
  T.ok(gl.off && h2 === h1 + 1 && gops.includes('track.set') && gops.includes('auto.set'), `pulling the fader holds its lane in one step (${gops.join(', ')})`);
  T.ok(m.gm === 'held' && m.g < m.want, `the fader says "held" and moved down from the lane's value (${m.g} dB)`);
  T.ok(await E(() => document.querySelector('.tp-held')?.getAttribute('aria-label')) === 'Back to the lanes (1 held)', 'the top bar counts it');
  // turn the pan: holds that lane too
  const pk = await (await page.$(`.mx-strip[data-track="${tid}"] .mx-pan .mk`)).boundingBox();
  await page.mouse.move(pk.x + pk.width / 2, pk.y + pk.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(pk.x + pk.width / 2, pk.y + pk.height / 2 - i * 4);
  await page.mouse.up();
  await sleep(200);
  T.ok((await lane(panA)).off && (await strip()).pm === 'held', 'turning the pan holds its lane and it says "held"');
  // a click on the pan that turns nothing holds nothing
  T.ok(await E(() => document.querySelector('.tp-held')?.getAttribute('aria-label')) === 'Back to the lanes (2 held)', 'the top bar: Back to the lanes (2 held)');
  await shot('knobs-auto-topbar');
  // the top bar's word: every held lane back, one undo step
  const h3 = await E(() => window.overdub.store.history.length);
  await page.click('.tp-held');
  await sleep(200);
  const back = { g: await lane(gainA), p: await lane(panA), n: await E(() => window.overdub.store.history.length), hidden: await E(() => document.querySelector('.tp-g-held').hidden) };
  m = await strip();
  T.ok(!back.g.off && !back.p.off && back.n === h3 + 1 && back.hidden, `"Back to the lanes" gives both back in one step and goes away (${back.n - h3} step)`);
  T.ok(Math.abs(m.g - m.want) < 1e-6 && m.gm === 'auto' && m.pm === 'auto', `the fader and the pan are back on their lanes (${m.g.toFixed(2)} dB)`);
  // a mouse click on the pan without turning it holds nothing
  await page.mouse.click(pk.x + pk.width / 2, pk.y + pk.height / 2);
  await sleep(150);
  T.ok(!(await lane(panA)).off, 'a click on the pan that turns nothing holds nothing');
  // right-click on the fader and the pan: Automate by address
  await E(() => { window.__shown = []; });
  await page.click(`.mx-strip[data-track="${tid}"] .mx-groove`, { button: 'right', force: true }).catch(async () => { await page.mouse.click(thumb.x + thumb.width / 2, thumb.y - 20, { button: 'right' }); });
  await sleep(120);
  items = await E(() => [...document.querySelectorAll('.ew-automenu .ek-item')].map((b) => b.textContent));
  T.ok(items.some((x) => x.startsWith('Automate')), `right-click on the fader opens its menu (${items.join(' / ')})`);
  T.ok(!(await lane(gainA)).off, 'and a right-click moves nothing');
  await page.click('.ew-automenu .ek-item:first-of-type');
  await page.click(`.mx-strip[data-track="${tid}"] .mx-pan .mk`, { button: 'right' });
  await sleep(120);
  await page.click('.ew-automenu .ek-item:first-of-type');
  await sleep(120);
  shown = await E(() => window.__shown);
  T.ok(shown.length === 2 && shown[0].param === 'gain' && !shown[0].insert && shown[1].param === 'pan' && shown.every((x) => x.track === tid), `Automate on the fader and the pan: showLane(${shown.map((x) => JSON.stringify(x)).join(', ')})`);
  // a master lane (R on the master fader, or an agent) has no row in the arranger: its menu says so and clears it
  await E(() => { const o = window.overdub; o.engine.stop?.(); o.transport.marker.set(0); o.store.dispatch({ type: 'auto.write', track: 'master', param: 'gain', points: '0:-6 16:-1' }, { by: 'claude', label: 'master fade' }); });
  await sleep(200);
  await page.click('.mx-strip[data-track="master"] .mx-groove', { button: 'right', force: true });
  await sleep(120);
  const mItems = await E(() => [...document.querySelectorAll('.ew-automenu .ek-item')].map((b) => b.textContent));
  const mh = await E(() => window.overdub.store.history.length);
  const clearBtn = await page.$$('.ew-automenu .ek-item');
  let clicked = false;
  for (const b of clearBtn) if ((await b.textContent()).startsWith('Clear its lane')) { await b.click(); clicked = true; break; }
  await sleep(150);
  const mAfter = await E(() => { const p = window.overdub.store.get(); return { lane: !!p.master.auto?.gain, gain: p.master.gain, n: window.overdub.store.history.length }; });
  T.ok(clicked && mItems.some((x) => x.startsWith('Clear its lane')) && !mAfter.lane && Math.abs(mAfter.gain + 6) < 1e-6 && mAfter.n === mh + 1, `a master lane can be cleared by hand: the master fader's menu has Clear its lane (${mItems.join(' / ')}); the fader keeps the lane's value at the playhead (${mAfter.gain} dB), one undo step`);
  await E(() => window.overdub.store.undo({ by: 'you' }));
  T.ok(await E(() => !!window.overdub.store.get().master.auto?.gain), 'and undo brings it back');
  await E(() => window.overdub.store.undo());
  // playing, the fader rides its lane
  await E(() => { window.overdub.transport.marker.set(0); window.overdub.engine.play(0); });
  await sleep(500);
  const f1 = (await strip()).g;
  await sleep(700);
  const f2 = (await strip()).g;
  await E(() => window.overdub.engine.stop());
  await sleep(200);
  T.ok(f2 > f1, `playing, the fader rides its lane (${f1.toFixed(1)} → ${f2.toFixed(1)} dB)`);

  /* ---- the lane menu's Ramp up (FRESH-EYES-5 producer): on a level 30 Hz stretch it rose over bar 3 and fell straight
     back, leaving the chorus at 30 Hz; over bars that already ramp it did nothing, with no History line and no word.
     It goes to where the lane is going and holds there, says the numbers, and says so when there's nothing to do */
  const shapeOn = (pts, shape, a, b) => E(async ({ tid, fx, pts, shape, a, b }) => {
    const o = window.overdub, st = o.store, A = await import('/app/src/core/automation.js');
    st.dispatch([{ type: 'auto.write', track: tid, insert: fx, param: 'cutoff', points: pts, from: 0, to: 64 }, { type: 'auto.set', track: tid, insert: fx, param: 'cutoff', patch: { off: false } }], { by: 'you', label: 'my cutoff lane' });
    document.querySelectorAll('.ew-toast').forEach((x) => x.remove());
    const h0 = st.history.length;
    o.arranger.laneShape(tid, { insert: fx, param: 'cutoff' }, shape, a, b);
    await new Promise((r) => setTimeout(r, 80));
    const lane = A.laneAt(st.get(), { track: tid, insert: fx, param: 'cutoff' });
    const spec = { min: 30, max: 18000, curve: 'log' };
    return { added: st.history.length - h0, label: st.history[st.history.length - 1].label, pts: A.formatPoints(lane.points), at: [12, 14, 20, 31].map((x) => Math.round(A.valueAt(lane, x, spec))), toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ') };
  }, { tid, fx, pts, shape, a, b });
  const lvl = await shapeOn('0:2000 8:30 16:30', 'ramp-up', 8, 12);
  T.ok(lvl.added === 1 && /ramp up, bar 3/.test(lvl.label) && lvl.at.join() === '735,735,735,735' && /Cutoff ramps up over bar 3, 30 Hz to 735 Hz, and holds there to the end\./.test(lvl.toast),
    `Ramp up over bar 3 on a level 30 Hz goes to 735 Hz and holds through the chorus, and says so (bars 4–8 at ${lvl.at.join(', ')} Hz; ${lvl.pts}; "${lvl.toast}")`);
  const already = await shapeOn('0:2000 8:253 16:18000 32:18000', 'ramp-up', 8, 16);
  T.ok(already.added === 0 && /Cutoff already ramps up over bars 3–4, to 18\.0 kHz\. Nothing changed\./.test(already.toast),
    `Ramp up over bars that already ramp up says so, and adds nothing to History ("${already.toast}"; ${already.added} new lines)`);

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  T.ok(false, 'threw: ' + (e && e.stack || e));
} finally {
  await close();
  T.done();
}
