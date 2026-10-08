// First-impression checks for the studio's look and feel [ui]: the demo song at three sizes, nothing overlapping,
// no sideways scroll on a phone, the rack fitting its pane, Space playing, the "?" keys overlay and the one-time welcome.
//   node tools/studio-test.js      (screenshots: tools/.out/studio-*.png)
import { open, tally } from './pw.js';

const T = tally('studio');
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext/.test(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(width, height) {
  const s = await open('/app/', { query: 'demo', width, height });
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await s.page.waitForTimeout(500);
  return s;
}

// Text that draws on top of other text: leaf text elements inside `root` whose visible boxes intersect.
function overlaps(rootSel) {
  const root = document.querySelector(rootSel);
  if (!root) return ['(no ' + rootSel + ')'];
  const vis = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    return true;
  };
  const clipBox = (el) => {
    let r = el.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(hidden|auto|scroll|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
        const p = e.getBoundingClientRect();
        x0 = Math.max(x0, p.left); y0 = Math.max(y0, p.top); x1 = Math.min(x1, p.right); y1 = Math.min(y1, p.bottom);
      }
    }
    return x1 - x0 > 1 && y1 - y0 > 1 ? { x0, y0, x1, y1 } : null;
  };
  const texty = [...root.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && vis(el));
  const boxes = texty.map((el) => ({ el, b: clipBox(el) })).filter((x) => x.b);
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const A = boxes[i], B = boxes[j];
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const w = Math.min(A.b.x1, B.b.x1) - Math.max(A.b.x0, B.b.x0), hh = Math.min(A.b.y1, B.b.y1) - Math.max(A.b.y0, B.b.y0);
    if (w > 3 && hh > 3) out.push(`"${A.el.textContent.trim().slice(0, 30)}" × "${B.el.textContent.trim().slice(0, 30)}"`);
  }
  return out;
}

for (const [W, H] of [[1440, 900], [1280, 800], [390, 844]]) {
  const { page, errors, close, shot } = await boot(W, H);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const tag = `${W}`;

  /* -------- the welcome (a fresh browser is a first visit) */
  T.ok(await page.isVisible('.ar-welcome'), `${tag}: the welcome card shows on a first visit`);
  const wt = (await page.textContent('.ar-welcome')) || '';
  // the paper insert (design/LINER-NOTES-KIT.md): the song, then the credits, signed: the house's parts unsigned,
  // Claude's in cool ink, your takes in warm; then the tour, the agent and the key
  const wc = await E(() => { const el = document.querySelector('.ar-welcome'), rows = [...el.querySelectorAll('.ar-credits li')];
    return { paper: el.classList.contains('paper'), rows: rows.map((li) => ({ text: li.textContent, by: li.querySelector('.by')?.className || '' })) }; });
  const house = wc.rows.find((r) => /came with the song/.test(r.text)), claude = wc.rows.find((r) => /Fireflies/.test(r.text)), you = wc.rows.find((r) => /Your takes, in Sketch/.test(r.text));
  T.ok(/This is Night Shift\./.test(wt) && /Space\s*plays it/.test(wt) && wc.paper && house && !house.by && claude && /by-agent/.test(claude.by) && /Claude$/.test(claude.text) && you && /by-human/.test(you.by) && /you$/.test(you.text),
    `${tag}: it is the paper insert: the song, then the credits (the house's parts unsigned, Fireflies by Claude in cool ink, your takes in warm) and Space (${wc.rows.map((r) => r.text).join(' | ')})`);
  T.ok(!/✦|cool edge|house wrote|the house\b/.test(wt), `${tag}: no sparkle, no "cool edge", and the house never signs`);
  const wl = await E(() => ({ agent: [...document.querySelectorAll('.ar-welcome button')].some((b) => /ask the agent/.test(b.textContent)), tour: !!document.querySelector('.ar-welcome .ar-welcome-tour') }));
  T.ok(wl.agent && wl.tour, `${tag}: "ask the agent" is a link and the card offers the two-minute tour (${JSON.stringify(wl)})`);
  await shot(`studio-${tag}-welcome`);
  if (W === 1280) {
    // "ask the agent" opens the Agent tab (and the card stays: nothing was played or changed)
    await E(() => { overdub.ui.setOpen('right', false); overdub.ui.show('history'); });
    await page.click('.ar-welcome button.ar-link-agent');
    await sleep(200);
    const ag = await E(() => ({ open: overdub.ui.isOpen('right'), tab: overdub.ui.active('right'), card: !!document.querySelector('.ar-welcome:not(.out)') }));
    T.ok(ag.open && ag.tab === 'agent' && ag.card, `${tag}: "ask the agent" opens the Agent tab (${JSON.stringify(ag)})`);
    // the tour button starts Take one and the welcome makes way for it
    await page.click('.ar-welcome-tour');
    await sleep(400);
    const tr = await E(() => ({ on: overdub.onboard.active, step: overdub.onboard.step, card: !!document.querySelector('.ar-welcome:not(.out)'), ob: !!document.querySelector('.ob') }));
    T.ok(tr.on && tr.ob && !tr.card, `${tag}: "Take the two-minute tour" starts the Take one coach and the card goes (${JSON.stringify(tr)})`);
    await E(() => overdub.onboard.stop());
  }
  if (W === 390) {
    // the first edit puts it away (here, a loop toggled by you); the house setting itself up doesn't count
    await E(() => overdub.store.dispatch({ type: 'project.set', patch: { tempo: overdub.store.get().tempo } }, { by: 'overdub', label: 'house' }));
    await sleep(100);
    T.ok(await page.isVisible('.ar-welcome:not(.out)'), `${tag}: an edit by the house leaves the welcome up`);
    await E(() => overdub.store.dispatch({ type: 'project.set', patch: { loop: { on: !overdub.store.get().loop.on } } }, { by: 'you', label: 'loop' }));
    await sleep(400);
    T.ok(!(await page.$('.ar-welcome')), `${tag}: your first edit puts the welcome card away`);
    await E(() => overdub.store.undo());
  }

  /* -------- no sideways scroll */
  const over = await E(() => document.documentElement.scrollWidth - innerWidth);
  T.ok(over <= 0, `${tag}: no sideways page scroll (${over > 0 ? over + ' px over' : 'fits'})`);

  /* -------- the master meter is a meter: its two bars, and its dB readout beside them while the top bar has room (a
     top bar of 1080 px or less keeps Loop, Undo and Redo instead: fresh eyes 5, the 1280 px laptop) */
  if (W >= 1000) {
    const m = await E(() => { const b = document.querySelector('.tp-meterbox'), r = b?.getBoundingClientRect(), cv = b?.querySelector('canvas')?.getBoundingClientRect(), db = b?.querySelector('.tp-db'); return b ? { w: Math.round(r.width), h: Math.round(r.height), bars: Math.round(cv?.width || 0), db: !!db && getComputedStyle(db).display !== 'none', bar: Math.round(document.querySelector('[data-panel="transport"]').getBoundingClientRect().width) } : null; });
    T.ok(m && m.h >= 20 && m.bars >= 30 && (m.bar <= 1080 || (m.db && m.w > 80)), `${tag}: the master meter is a meter, with its dB readout when the top bar has room (${m ? `${m.w}×${m.h}, bars ${m.bars} px, readout ${m.db ? 'shown' : 'not shown'}, top bar ${m.bar} px` : 'missing'})`);
  }

  /* -------- Sketch tab: nothing drawn over anything */
  await E(() => overdub.ui.show('sketch'));
  await sleep(350);
  const sk = await E(overlaps, '[data-panel="sketch"]');
  T.ok(!sk.length, `${tag}: Sketch has no overlapping text${sk.length ? ': ' + sk.slice(0, 3).join('; ') : ''}`);
  await shot(`studio-${tag}-sketch`);

  /* -------- Devices tab: the Guitar chain fits the pane's height; what doesn't fit sideways says so */
  await E(() => { const t = overdub.store.get().tracks.find((x) => /guitar/i.test(x.name)); overdub.ui.select({ track: t.id }); overdub.ui.show('rack'); });
  await sleep(500);
  const rk = await E(() => {
    const b = document.querySelector('[data-panel="rack"] .rk-board').getBoundingClientRect();
    const faces = [...document.querySelectorAll('[data-panel="rack"] .rk-face')].map((f) => f.getBoundingClientRect());
    const board = document.querySelector('[data-panel="rack"] .rk-board');
    return { n: faces.length, cut: faces.filter((r) => r.bottom > b.bottom + 1 || r.top < b.top - 1).length, scrolls: board.scrollWidth > board.clientWidth + 4,
      more: getComputedStyle(document.querySelector('.rk-more-rb')).display !== 'none' };
  });
  // (640 px and under the board is a pager that sizes each face to the width and scrolls down: phone-test holds it)
  T.ok(rk.n >= 4 && (rk.cut === 0 || W <= 640), `${tag}: every face in the Guitar chain fits the pane's height (${rk.n} faces, ${rk.cut} cut${W <= 640 ? ', paged on a phone' : ''})`);
  T.ok(!rk.scrolls || rk.more, `${tag}: a chain wider than the pane shows a "more" edge (${rk.scrolls ? 'scrolls' : 'fits'})`);
  await shot(`studio-${tag}-rack`);
  if (rk.scrolls) {
    await page.click('.rk-more-rb svg');
    await sleep(600);
    T.ok(await E(() => document.querySelector('[data-panel="rack"] .rk-board').scrollLeft > 0), `${tag}: the "more" edge scrolls the board`);
    await shot(`studio-${tag}-rack-scrolled`);
  }

  /* -------- Space plays (the first click starts audio), and things move */
  if (W === 1440) {
    // Space plays even after a mouse click on a toolbar button (that button keeps focus, but not Space): Fit, then Space
    await page.click('.ar-tool[title="Fit the whole song in view"]');
    await E(() => { overdub.engine.playing && overdub.engine.stop?.(); overdub.engine.seek(0); });
    const onFit = await E(() => document.activeElement?.title || document.activeElement?.tagName);
    await page.keyboard.press('Space');
    await sleep(500);
    const fitPlay = await E(() => ({ playing: !!overdub.engine.playing, beat: overdub.engine.beat }));
    T.ok(fitPlay.playing, `Space plays after a click on Fit (focus on "${onFit}")`);
    T.ok(await page.isVisible('.ar-welcome:not(.out) .ar-welcome-own'), 'the first Play leaves the welcome up: Make your own is still one click away after a listen');
    await page.keyboard.press('Space');
    await sleep(200);
    T.ok(!(await E(() => overdub.engine.playing)), 'and Space stops it again (the clicked button never takes it)');
    // a button with keyboard focus still keeps Space for itself (Tab to it, Space presses it)
    await E(() => { window.__fit = 0; const b = document.querySelector('.ar-tool[title="Fit the whole song in view"]'); b.addEventListener('click', () => { window.__fit++; }, { once: true }); b.blur(); b.focus(); });
    await page.keyboard.press('Space');
    await sleep(200);
    const kb = await E(() => ({ fit: window.__fit, playing: !!overdub.engine.playing }));
    T.ok(kb.fit === 1 && !kb.playing, `Space on a keyboard-focused button presses it and leaves the transport alone (${JSON.stringify(kb)})`);
    await page.mouse.click(W / 2, 400); // the lanes: a first gesture
    await E(() => { overdub.engine.playing && overdub.engine.stop?.(); overdub.engine.seek(0); document.activeElement?.blur?.(); });
    await sleep(150);
    await page.keyboard.press('Space');
    await sleep(1200);
    const st = await E(() => ({ playing: !!overdub.engine.playing, beat: overdub.engine.beat, pos: document.querySelector('.tp-pos-bar')?.textContent, ph: document.querySelector('.ar-playhead')?.getBoundingClientRect().left, m: overdub.engine.meters?.master }));
    T.ok(st.playing, 'Space starts the demo (engine.playing)');
    T.ok(st.beat > 0.5 && st.pos !== '1.1.1', `the position moves (${st.pos}, beat ${st.beat?.toFixed?.(2)})`);
    await sleep(500);
    const ph2 = await E(() => document.querySelector('.ar-playhead')?.getBoundingClientRect().left);
    T.ok(ph2 > st.ph, `the playhead moves (${Math.round(st.ph)} → ${Math.round(ph2)})`);
    const m = await E(() => overdub.engine.meters?.master);
    T.note(`master meter while playing: peak ${m?.peak?.toFixed?.(1)} dB, rms ${m?.rms?.toFixed?.(1)} dB`);
    await shot(`studio-${tag}-playing`);
    await page.keyboard.press('Space');
    await sleep(200);
    T.ok(!(await E(() => overdub.engine.playing)), 'Space stops');
  }

  /* -------- the "?" overlay */
  await page.mouse.click(W - 30, H - 4).catch(() => {});
  await E(() => document.activeElement?.blur?.());
  await page.keyboard.press('Shift+Slash');
  await sleep(250);
  const ko = await E(() => ({ open: !!document.querySelector('.tpk'), groups: [...document.querySelectorAll('.tpk-g h3')].map((x) => x.textContent), rows: document.querySelectorAll('.tpk dd').length, n: overdub.ui.keys.list().length }));
  T.ok(ko.open && ko.groups.length >= 4 && ko.rows >= 10, `${tag}: ? opens every key, grouped (${ko.groups.join(', ')}; ${ko.rows} rows of ${ko.n} keys)`);
  const kover = await E(() => document.documentElement.scrollWidth - innerWidth);
  T.ok(kover <= 0, `${tag}: the keys overlay fits the width`);
  await shot(`studio-${tag}-keys`);
  await page.keyboard.press('Escape');
  await sleep(300);
  T.ok(!(await page.$('.tpk')), `${tag}: Esc closes it`);

  /* -------- the welcome shows once (put away above by Play, the tour or an edit; else by its close) */
  if (await page.$('.ar-welcome:not(.out)')) await page.click('.ar-welcome-x');
  await sleep(300);
  T.ok(!(await page.$('.ar-welcome')), `${tag}: the welcome closes`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(400);
  T.ok(!(await page.$('.ar-welcome')), `${tag}: and does not come back on the next visit`);
  await shot(`studio-${tag}-main`);

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `${tag}: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

/* -------- a kept take and a built band land in view, flash once in their author's colour, and the band plays your take
   back from its first bar (not over a song that's already playing); a pill says "waiting for you" while a card waits */
{
  const { page, errors, close, shot } = await boot(1440, 900);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const view = (ids) => E((ids) => {
    const o = window.overdub, sc = document.querySelector('.ar-scroll'), pal = getComputedStyle(document.documentElement);
    return ids.map((id) => {
      const f = o.store.findClip(id), ppb = o.ui.state.zoom.pxPerBeat, x = f.clip.start * ppb;
      const row = o.store.get().tracks.findIndex((t) => t.id === f.track.id), y = row * o.ui.state.zoom.trackH;
      return { id, inX: x >= sc.scrollLeft - 1 && x <= sc.scrollLeft + sc.clientWidth - 20, inY: y >= sc.scrollTop - 1 && y < sc.scrollTop + sc.clientHeight, flash: o.arranger.flashing(id), by: f.clip.by || f.track.by };
    }).map((r) => ({ ...r, human: pal.getPropertyValue('--human').trim() }));
  }, ids);
  await E(() => { const o = window.overdub; document.querySelector('.ar-welcome-x')?.click(); o.engine.playing && o.engine.stop(); o.engine.seek(0); o.arranger.zoomTo(0, 8); });
  await sleep(200);
  await E(() => { const sc = document.querySelector('.ar-scroll'); sc.scrollLeft = sc.scrollWidth; sc.scrollTop = 0; });
  await sleep(200);
  const kept = await E(() => { const o = window.overdub, p = o.input.capture.add({ src: 'hum', kind: 'notes', notes: [60, 63, 67, 65].map((n, i) => ({ p: n, t: i, d: 0.9, v: 0.8 })), tempo: o.store.get().tempo }); return o.input.capture.keep(p.id, { newTrack: { name: 'Hum' } }); });
  await sleep(150);
  const [k] = await view([kept.clip]);
  T.ok(kept.ok && k.inX && k.inY, `after Keep the arranger scrolls the new clip into view (${JSON.stringify({ inX: k.inX, inY: k.inY })})`);
  T.ok(!!k.flash && k.flash === k.human, `and flashes it once in the author's colour (you: ${k.flash} vs --human ${k.human})`);
  await shot('studio-keep-flash');
  // Build the band from the UI: the picker's Build
  await E(() => { const sc = document.querySelector('.ar-scroll'); sc.scrollLeft = sc.scrollWidth; });
  const before = await E(() => window.overdub.store.get().tracks.flatMap((t) => t.clips.map((c) => c.id)));
  await E((t) => window.overdub.band.open(t), { track: kept.track, clip: kept.clip });
  await page.click('.band-go');
  await page.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].some((t) => /Band in/.test(t.textContent)), null, { timeout: 30000 }).catch(() => {});
  await sleep(250);
  const band = await E(([seed, before]) => { const o = window.overdub, s = o.store.findClip(seed).clip, last = o.store.history.at(-1); const ids = o.store.get().tracks.flatMap((t) => t.clips.map((c) => c.id)).filter((id) => !before.includes(id)); return { ids, playing: o.engine.playing, beat: o.engine.beat, start: s.start, label: last.label }; }, [kept.clip, before]);
  T.ok(band.playing && band.beat >= band.start - 0.01 && band.beat < band.start + 8, `Build the band plays the take back from its first bar (playing ${band.playing}, beat ${band.beat?.toFixed?.(2)}, take at ${band.start})`);
  const bv = band.ids.length ? await view(band.ids) : [];
  T.ok(bv.length >= 2 && bv.some((b) => b.inX && b.inY) && bv.every((b) => b.inX) && bv.every((b) => !!b.flash), `the band's new clips scroll into view and flash (${bv.map((b) => `${b.inX ? 'x' : '-'}${b.inY ? 'y' : '-'}${b.flash ? '*' : ''}`).join(' ') || 'none found: ' + band.label})`);
  await shot('studio-band-flash');
  // already playing from bar 9: a second band doesn't jump the playhead back to the take
  await E(() => { const o = window.overdub; o.store.undo(); o.engine.play(32); });
  await sleep(300);
  await E((t) => window.overdub.band.open(t), { track: kept.track, clip: kept.clip });
  await page.click('.band-go');
  await page.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].filter((t) => /Band in/.test(t.textContent)).length && window.overdub.store.history.at(-1).by === 'overdub', null, { timeout: 30000 }).catch(() => {});
  await sleep(200);
  const b2 = await E(() => ({ playing: window.overdub.engine.playing, beat: window.overdub.engine.beat }));
  T.ok(b2.playing && b2.beat > 32, `a band built while the song plays leaves the transport where it is (beat ${b2.beat?.toFixed?.(2)})`);
  await E(() => window.overdub.engine.stop());
  // a card waiting on the human: the pills say "waiting for you", not "working"
  await E(() => { const o = window.overdub; o.ui.setOpen('right', false); o.presence.join('mcp:probe', { name: 'Probe' }); o.presence.status('Waiting for your pick…', 'mcp:probe'); });
  await sleep(150);
  const pill = await E(() => document.querySelector('.ew-presence-pill:not([hidden])')?.textContent || '');
  await E(() => { const o = window.overdub; o.presence.status('reading the song', 'mcp:probe'); });
  const busy = await E(() => ({ pill: document.querySelector('.ew-presence-pill:not([hidden])')?.textContent || '', waiting: window.overdub.presence.waiting('mcp:probe') }));
  await E(async () => {
    const o = window.overdub, t = o.store.get().tracks.find((x) => x.kind === 'instrument');
    await o.tools.run('propose_variations', { variations: [
      { label: 'up', ops: [{ type: 'clip.add', track: t.id, clip: { kind: 'notes', start: 64, length: 4, notes: [{ p: 67, t: 0, d: 1, v: 0.8 }] } }] },
      { label: 'down', ops: [{ type: 'clip.add', track: t.id, clip: { kind: 'notes', start: 64, length: 4, notes: [{ p: 55, t: 0, d: 1, v: 0.8 }] } }] },
    ], wait_seconds: 0 }, { by: 'mcp:probe' });
    o.presence.status('working on it', 'mcp:probe');
    o.ui.setOpen('right', true); o.ui.show('agent');
  });
  await sleep(300);
  const card = await E(() => ({ pill: [...document.querySelectorAll('.ag-pill.mcp')].map((p) => p.textContent).join(' | '), waiting: window.overdub.presence.waiting('mcp:probe') }));
  T.ok(/Probe\s*waiting for you/.test(pill) && !/waiting/.test(busy.pill) && !busy.waiting, `the presence pill says "waiting for you" while a pick waits, not "working" ("${pill}" then "${busy.pill}")`);
  T.ok(card.waiting && /waiting for you/.test(card.pill), `with an A/B card on screen the agent's pill says "waiting for you" ("${card.pill}")`);
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `keep/band/pill: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

T.done();
