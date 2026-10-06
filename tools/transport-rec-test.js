// Recording from the top bar (docs/research/RECORDING-UX.md wave B1: app/src/ui/transport.js, app/src/ui/onboard.js).
// Real key events against the running song (Night Shift, 92 bpm):
//   - the ball: a cell per beat of the meter beside the position, aria-hidden, resting on cell 1 when stopped; while
//     the song plays the square sits where engine.beat says (on the cell at the beat, between cells between beats)
//   - Shift+K steps the count-in 1 bar, 2 bars, off (announced); K turns the click on and off (Logic's and
//     GarageBand's keys); Shift+M does nothing now
//   - the click's popover (on, while recording, count-in, level) and every one of them kept over a reload; a fresh
//     browser clicks while a take records with the click off, the Click lamp lit through the count-in
//   - musical typing and Tap's pads holding the letter keys: a lamp on the bar says so ("Keys play Keys, ` to stop"),
//     L, S and K play notes (no loop, no solo, no click), K is Tap's hat, a click hands the keys back; the Loop key is
//     on the bar at 1440
//   - the position holds still from bar 9 into bar 10 (the numeral, the ball, Loop and All off don't move)
//   - the loop on, the marker before it: Space plays from the marker and cycles once in the loop; the play key shows
//     stop while playing; stop comes back to the marker
//   - R at the marker on bar 5: the count-in pre-rolls bar 4 (-1.4 ... -1.1 in the position from the moment R is
//     pressed, one big numeral 4 3 2 1 over the target lane in the arranger and none in the top bar, the record lamp
//     counting, announced), then records from bar 5 (REC, the lamp lit); tempo, meter and the loop are locked while
//     it runs (L does nothing); Space stops it and keeps it (the take on bar 5, announced, "keeping")
//   - R while the song plays: recording starts at the next bar line, the beats left in this bar counted (-1.2, -1.1);
//     R again during that count cancels it and the song plays on
//   - the first minute: Tap a beat (the tour's door, and New song's) sets up a 2-bar loop with the click and plays it;
//     R (counting what is left of the bar, then recording from its bar line), F J K L, each pass layers, Space: the beat is in the song and the tour offers keys over it, then the agent
//   - laptops, 1280, 1366 and 1440 with both panes open: Loop, Undo and Redo stay on the bar, where R records sits
//     beside the record key ("Onto Bass"), "Keys play Bass  Esc" reads whole under a short title, and the click's
//     level reads "0 dB" whole
//   - a phone: the ball beside the position on the bar's second row
//   node tools/transport-rec-test.js      (screenshots: tools/.out/transport-rec-*.png)
import { open, tally } from './pw.js';

const T = tally('transport-rec');
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g/.test(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================ desktop */
{
  const s = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const { page, errors, shot } = s;
  const E = (fn, a) => page.evaluate(fn, a);
  try {
    await E(() => { localStorage.setItem('overdub:welcomed', '1'); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await E(async () => { const o = window.overdub; await o.engine.start(); o.store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you', label: 'loop off' }); });
    await sleep(300);
    const said = () => E(() => document.querySelector('.ew-announce')?.textContent || '');
    // every line a screen reader is handed (the live region holds only the last one)
    const heard = () => E(() => window.__said || []);
    const listen = () => E(() => { const u = window.overdub.ui, a = u.announce; window.__said = []; u.announce = (t) => { window.__said.push(String(t)); return a(t); }; });
    await listen();
    const neutral = () => E(() => { document.activeElement?.blur?.(); document.querySelector('.ar-scroll')?.focus({ preventScroll: true }); });
    await neutral();

    /* ---- the ball, at rest */
    const rest = await E(() => {
      const b = document.querySelector('.tp-ball'), o = window.overdub;
      return { hidden: b?.getAttribute('aria-hidden'), cells: b?.querySelectorAll('.tp-beats i').length, dot: !!b?.querySelector('.tp-ball-dot'), ball: o.transport.ball, inPos: !!b?.closest('.tp-g-pos') };
    });
    T.ok(rest.hidden === 'true' && rest.cells === 4 && rest.dot && rest.inPos, `the ball sits beside the position: 4 cells for 4/4 and the square, aria-hidden (${JSON.stringify({ cells: rest.cells, hidden: rest.hidden })})`);
    T.ok(rest.ball && rest.ball.cell === 0 && rest.ball.y === 0 && !rest.ball.moving, `stopped, it rests on the first cell (${JSON.stringify(rest.ball)})`);
    const six = await E(async () => {
      const o = window.overdub;
      o.store.dispatch({ type: 'project.set', patch: { meter: [6, 8] } }, { by: 'you', label: 'meter' });
      await new Promise((r) => setTimeout(r, 80));
      const n = document.querySelectorAll('.tp-ball .tp-beats i').length;
      o.store.undo();
      await new Promise((r) => setTimeout(r, 80));
      return n;
    });
    T.ok(six === 6, `6/8 shows 6 cells (${six})`);

    /* ---- the ball follows engine.beat */
    await neutral();
    await page.keyboard.press('Space');
    await sleep(900);
    const samples = [];
    for (let i = 0; i < 8; i++) {
      samples.push(await E(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const o = window.overdub, b = o.transport.ball;
        const cells = [...document.querySelectorAll('.tp-ball .tp-beats i')].map((el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
        const d = document.querySelector('.tp-ball-dot').getBoundingClientRect();
        const lit = [...document.querySelectorAll('.tp-ball .tp-beats i')].findIndex((el) => el.classList.contains('now'));
        res({ beat: o.engine.beat, ball: b, cells, dotX: d.left + d.width / 2, lit });
      })))));
      await sleep(170);
    }
    await page.keyboard.press('Space');
    await sleep(300);
    const follows = samples.every((x) => x.ball && x.ball.moving && Math.abs(x.ball.beat - x.beat) < 0.25 && x.ball.cell === Math.floor(((x.ball.beat % 4) + 4) % 4 + 1e-9) && x.lit === x.ball.cell);
    T.ok(follows, `playing, the ball's cell is the beat of the bar engine.beat is on, and that cell is lit (${samples.map((x) => `${x.beat.toFixed(2)}→${x.ball?.cell}`).join(' ')})`);
    const drawn = samples.every((x) => { const k = x.ball.cell, n = (k + 1) % 4; const want = x.cells[k] + (x.cells[n] - x.cells[k]) * x.ball.f; return Math.abs(want - x.dotX) < 1.6; });
    T.ok(drawn, `the square is drawn between its cells by how far through the beat it is (${samples.map((x) => `${x.ball.f.toFixed(2)}:${(x.dotX - x.cells[x.ball.cell]).toFixed(1)}px`).join(' ')})`);
    T.ok(samples.some((x) => x.ball.y < -1) && samples.every((x) => x.ball.y <= 0 && x.ball.y >= -5.01), `it travels on an arc no more than 5 px high (${samples.map((x) => x.ball.y).join(' ')})`);

    // less motion: it steps from cell to cell, no arc
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await neutral();
    await page.keyboard.press('Space');
    await sleep(700);
    const calm = [];
    for (let i = 0; i < 4; i++) { calm.push(await E(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => { const b = window.overdub.transport.ball; const c = document.querySelectorAll('.tp-ball .tp-beats i')[b.cell]; res({ y: b.y, off: Math.abs(c.offsetLeft + c.offsetWidth / 2 - b.x), f: b.f }); }))))); await sleep(200); }
    await page.keyboard.press('Space');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await sleep(300);
    T.ok(calm.every((x) => x.y === 0 && x.off < 0.6), `less motion: the square steps from cell to cell with no arc (${calm.map((x) => `${x.f.toFixed(2)}:${x.off.toFixed(1)}px`).join(' ')})`);

    /* ---- Shift+K: the count-in; K: the click (Logic's and GarageBand's keys); Shift+M: nothing now */
    await neutral();
    const ci0 = await E(() => window.overdub.input.recorder.countIn);
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+KeyK');
      await sleep(120);
      seen.push(await E(() => ({ n: window.overdub.input.recorder.countIn, v: document.querySelector('.tp-count .tp-val')?.textContent })));
    }
    T.ok(ci0 === 1 && seen.map((x) => x.n).join(',') === '2,0,1' && seen[0].v === '2 bars' && seen[1].v === 'none', `Shift+K steps the count-in 1 bar → 2 bars → off → 1 bar (${seen.map((x) => `${x.n}:${x.v}`).join(', ')})`);
    T.ok(/Count-in: 1 bar/.test(await said()), `and says so ("${await said()}")`);
    const m0 = await E(() => window.overdub.engine.metronome);
    await page.keyboard.press('KeyK');
    await sleep(100);
    const m1 = await E(() => ({ on: window.overdub.engine.metronome, pressed: document.querySelector('.tp-met').getAttribute('aria-pressed') }));
    await page.keyboard.press('KeyK');
    await sleep(100);
    T.ok(m0 === false && m1.on === true && m1.pressed === 'true' && (await E(() => window.overdub.engine.metronome)) === false, `K turns the click on and off (${m0} → ${m1.on} → off)`);
    T.ok(await E(() => window.overdub.ui.keys.list().some((k) => k.key === 'KeyK' && k.mod === 'shift' && /Count-in/.test(k.label))), 'Shift+K is a declared key (the "?" sheet lists it)');
    const sm = await E(() => ({ ci: window.overdub.input.recorder.countIn, click: window.overdub.engine.metronome, n: window.overdub.store.history.length }));
    await page.keyboard.press('Shift+KeyM');
    await sleep(120);
    const sm1 = await E(() => ({ ci: window.overdub.input.recorder.countIn, click: window.overdub.engine.metronome, n: window.overdub.store.history.length, toasts: document.querySelectorAll('.ew-toast').length }));
    T.ok(sm1.ci === sm.ci && sm1.click === sm.click && sm1.n === sm.n && !(await E(() => window.overdub.ui.keys.list().some((k) => k.key === 'KeyM' && k.mod === 'shift'))), `Shift+M does nothing now: the count-in (${sm1.ci}), the click (${sm1.click}) and the song as they were`);

    /* ---- the click's popover, kept over a reload */
    await page.click('.tp-caret');
    await page.waitForSelector('.tp-clickpop');
    const pop = await E(() => { const p = document.querySelector('.tp-clickpop'); return { text: p.textContent, togs: p.querySelectorAll('.tog').length, radios: p.querySelectorAll('[role=radio]').length, level: !!p.querySelector('input[type=range]'), role: p.getAttribute('role'), name: p.getAttribute('aria-label') }; });
    const takes0 = await E(() => ({ takes: window.overdub.transport.click.get().takes, row: document.querySelector('.tp-clickpop .tog:nth-of-type(2)')?.getAttribute('aria-pressed') }));
    T.ok(pop.togs === 2 && pop.radios === 3 && pop.level && /While recording/.test(pop.text) && /Count-in/.test(pop.text) && /Level/.test(pop.text) && pop.role === 'dialog' && pop.name === 'The click', `the caret opens the click's options: on, while recording, count-in (1, 2, off), level (${pop.togs} toggles, ${pop.radios} counts)`);
    T.ok(takes0.takes === true && takes0.row === 'true', `a fresh browser clicks while recording by default, with the click off (${JSON.stringify(takes0)})`);
    await shot('transport-rec-clickpop');
    await page.click('.tp-clickpop .tog:nth-of-type(2)');                       // while recording: off
    T.ok(await E(() => !!document.activeElement?.closest('.tp-clickpop') && document.activeElement.getAttribute('aria-pressed') === 'false'), 'pressing a toggle in it keeps focus on that toggle (now off)');
    await page.click('.tp-clickpop [role=radio]:nth-of-type(2)');              // 2 bars
    await E(() => { const r = document.querySelector('.tp-clickpop input[type=range]'); r.value = '-9'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('.tp-clickpop .tog:nth-of-type(1)');                       // the click on
    await sleep(100);
    const set = await E(() => ({ click: window.overdub.engine.click, takes: window.overdub.transport.click.get().takes, ci: window.overdub.input.recorder.countIn }));
    T.ok(set.click.on && !set.takes && set.click.level === -9 && set.ci === 2, `the popover sets them (${JSON.stringify(set)})`);
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(300);
    const kept = await E(() => ({ click: window.overdub.engine.click, takes: window.overdub.transport.click.get().takes, ci: window.overdub.input.recorder.countIn, lamp: document.querySelector('.tp-met').getAttribute('aria-pressed'), count: document.querySelector('.tp-count .tp-val')?.textContent }));
    T.ok(kept.click.on && kept.takes === false && kept.click.level === -9 && kept.ci === 2 && kept.lamp === 'true' && kept.count === '2 bars', `and they are kept over a reload (${JSON.stringify(kept)})`);
    // the old "only while recording" (the click on, whileRecording) reads as the click off and on for takes
    const legacy = await E(async () => { localStorage.setItem('overdub:click', JSON.stringify({ on: true, whileRecording: true, level: 0 })); return true; });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(300);
    const mig = await E(() => ({ click: window.overdub.engine.click, takes: window.overdub.transport.click.get().takes }));
    T.ok(legacy && !mig.click.on && mig.takes === true, `a kept "only while recording" becomes the click off, on while recording (${JSON.stringify(mig)})`);
    await E(() => { const o = window.overdub; o.transport.click.set({ on: false, whileRecording: false, level: 0, takes: true }); o.transport.click.setCountIn(1); });
    await listen();

    /* ---- what the keys do: musical typing and Tap's pads hold the letter keys, and the bar says so */
    await neutral();
    const loopKey = await E(() => { const r = document.querySelector('.tp-loop').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    T.ok(loopKey.w > 30 && loopKey.h > 20, `at 1440 the Loop key is on the bar (${loopKey.w}x${loopKey.h})`);
    T.ok(await E(() => document.querySelector('.tp-hold').hidden), 'with the keys free, no keys lamp');
    await page.keyboard.press('Backquote');
    await sleep(150);
    const fits = await E(() => { const row = document.querySelector('.tp-row'), r = row.getBoundingClientRect(); const kids = [...row.children].filter((k) => k.getClientRects().length); return { over: Math.round(Math.max(...kids.map((k) => k.getBoundingClientRect().right)) - r.right), clip: (() => { const n = document.querySelector('.tp-hold-l'); return n.scrollWidth - n.clientWidth; })() }; });
    const hk = await E(() => { const b = document.querySelector('.tp-hold'), r = b.getBoundingClientRect(); return { on: window.overdub.input.qwerty.on, text: b.textContent, vis: r.width > 0 && !b.closest('[hidden]'), kbd: b.querySelector('kbd')?.textContent, label: b.getAttribute('aria-label'), name: window.overdub.input.target()?.name }; });
    T.ok(hk.on && hk.vis && /^Keys play\s*\S/.test(hk.text) && hk.text.includes(hk.name) && hk.kbd === 'Esc' && /to stop/.test(hk.text), `musical typing on: the bar says "${hk.text}"`);
    T.ok(fits.over <= 0 && fits.clip <= 1, `under the title, where the credit line was: the bar still fits and the track's name reads whole (${JSON.stringify(fits)})`);
    const loopBefore = await E(() => window.overdub.store.get().loop.on);
    await page.keyboard.press('KeyL');
    await sleep(100);
    T.ok((await E(() => window.overdub.store.get().loop.on)) === loopBefore, 'and L plays a note, the loop left alone (the lamp is why)');
    // S and K are musical typing's too (two of its white keys): a note each, nothing soloed, the click as it was
    const sk0 = await E(() => { const o = window.overdub; window.__notes = []; window.__offNote?.(); window.__offNote = o.input.on('note', (e) => { if (e.on) window.__notes.push(`${e.src}:${e.p}`); }); return { click: o.engine.metronome, solo: o.store.get().tracks.filter((t) => t.solo).length, n: o.store.history.length }; });
    for (const k of ['KeyS', 'KeyK']) { await page.keyboard.press(k); await sleep(120); }
    const sk1 = await E(() => { const o = window.overdub; window.__offNote?.(); return { notes: window.__notes.slice(), click: o.engine.metronome, solo: o.store.get().tracks.filter((t) => t.solo).length, n: o.store.history.length }; });
    T.ok(sk1.notes.length === 2 && sk1.notes.every((x) => /^qwerty:\d+$/.test(x)) && sk1.click === sk0.click && sk1.solo === sk0.solo && sk1.n === sk0.n, `S and K play notes too (${sk1.notes.join(', ')}): nothing soloed, the click as it was, the song untouched`);
    await page.click('.tp-hold');
    await sleep(150);
    const hk2 = await E(() => ({ on: window.overdub.input.qwerty.on, hidden: document.querySelector('.tp-hold').hidden }));
    T.ok(!hk2.on && hk2.hidden, `a click on it hands the keys back (typing ${hk2.on}, lamp hidden ${hk2.hidden})`);
    await E(() => { const o = window.overdub; o.ui.show('sketch'); o.input.setMode('tap'); });
    await sleep(150);
    const tk = await E(() => ({ text: document.querySelector('.tp-hold').textContent, hidden: document.querySelector('.tp-hold').hidden, kbd: document.querySelector('.tp-hold kbd')?.textContent }));
    T.ok(!tk.hidden && /^Keys play\s*\S/.test(tk.text) && tk.kbd === 'Esc', `Tap's pads: "${tk.text}"`);
    // K is Tap's hat, not the click
    const th0 = await E(() => { const o = window.overdub; window.__hits = []; window.__offHit?.(); window.__offHit = o.input.tap.on('hit', (e) => window.__hits.push(e.row)); return { click: o.engine.metronome }; });
    await page.keyboard.press('KeyK');
    await sleep(150);
    const th1 = await E(() => { window.__offHit?.(); return { hits: window.__hits.slice(), click: window.overdub.engine.metronome }; });
    T.ok(th1.hits.join() === 'hat' && th1.click === th0.click, `in Tap, K is the hat, the click left as it was (${th1.hits.join(', ') || 'no hit'}; click ${th1.click})`);
    await shot('transport-rec-keys-held');
    await E(() => window.overdub.input.setMode(null));
    await sleep(100);
    T.ok(await E(() => document.querySelector('.tp-hold').hidden), 'leaving Tap, the lamp goes');

    /* ---- the position holds still: bar 9 to bar 10 moves nothing on the bar */
    const geo = () => E(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left * 10) / 10, Math.round(b.width * 10) / 10]; }; return { bar: r('.tp-pos-bar'), ball: r('.tp-ball'), kill: r('.tp-kill'), loop: r('.tp-loop'), top: Math.round(document.querySelector('.ew-top').getBoundingClientRect().height), pos: document.querySelector('.tp-pos-bar').textContent }; });
    // (a clip at bar 12, so the song runs past bar 10)
    await E(() => { const o = window.overdub, t = o.store.get().tracks.find((x) => x.kind === 'instrument'); o.store.dispatch({ type: 'clip.add', track: t.id, clip: { start: 44, length: 4, notes: [{ p: 60, t: 0, d: 1, v: 0.6 }] } }, { by: 'you', label: 'a clip at bar 12' }); o.engine.seek(0); });
    await sleep(150);
    const g1 = await geo();
    await E(() => window.overdub.engine.play(35)); await sleep(200);
    const g9 = await geo();
    for (let i = 0; i < 80 && (await E(() => window.overdub.engine.beat)) < 36.3; i++) await sleep(25);
    const g10 = await geo();
    await E(() => { const o = window.overdub; o.engine.stop(); o.store.undo(); }); await sleep(200);
    const same = (a, b) => JSON.stringify([a.bar, a.ball, a.kill, a.loop, a.top]) === JSON.stringify([b.bar, b.ball, b.kill, b.loop, b.top]);
    T.ok(/^9\./.test(g9.pos) && /^10\./.test(g10.pos) && same(g1, g9) && same(g9, g10), `playing from bar 9 into bar 10, the numeral, the ball, Loop and All off stay put (${g1.pos} ${g9.pos} ${g10.pos}: ${JSON.stringify([g1, g9, g10])})`);

    /* ---- the loop on: Space plays from the marker and cycles once it is in the loop; stop comes back to the marker */
    const lp = await E(async () => {
      const o = window.overdub;
      o.store.dispatch([{ type: 'project.set', patch: { tempo: 240, loop: { on: true, start: 8, end: 12 } } }], { by: 'you', label: 'fast loop bars 3' });
      o.transport.marker.set(4);
      window.__loops = 0; o.engine.on('transport', (e) => { if (e?.why === 'loop') window.__loops++; });
      return true;
    });
    await neutral();
    await page.keyboard.press('Space');
    await sleep(250);
    const lp1 = await E(() => ({ beat: window.overdub.engine.beat, playing: window.overdub.engine.playing, ico: getComputedStyle(document.querySelector('.tp-play .ico-stop')).display, play: getComputedStyle(document.querySelector('.tp-play .ico-play')).display, label: document.querySelector('.tp-play').getAttribute('aria-label') }));
    T.ok(lp && lp1.playing && lp1.beat >= 4 && lp1.beat < 7.5, `loop on (bar 3), marker on bar 2: Space plays from the marker, not the loop's start (beat ${lp1.beat.toFixed(2)})`);
    T.ok(lp1.ico !== 'none' && lp1.play === 'none' && lp1.label === 'Stop (Space)', `playing, the play key shows what it does: stop (${lp1.label})`);
    for (let i = 0; i < 120 && (await E(() => window.__loops)) < 1; i++) await sleep(50);
    await sleep(200);
    const lp2 = await E(() => ({ beat: window.overdub.engine.beat, loops: window.__loops }));
    T.ok(lp2.loops >= 1 && lp2.beat >= 8 && lp2.beat < 12, `then it plays into the loop and cycles (${lp2.loops} wrap, beat ${lp2.beat.toFixed(2)})`);
    await page.keyboard.press('Space');
    for (let i = 0; i < 40 && (await E(() => window.overdub.engine.playing)); i++) await sleep(25);
    await sleep(200);
    const lp3 = await E(() => ({ beat: window.overdub.engine.beat, marker: window.overdub.transport.marker.beat, ico: getComputedStyle(document.querySelector('.tp-play .ico-play')).display, label: document.querySelector('.tp-play').getAttribute('aria-label') }));
    T.ok(lp3.beat === 4 && lp3.marker === 4 && lp3.ico !== 'none' && lp3.label === 'Play (Space)', `stop comes back to the marker, and the key is Play again (beat ${lp3.beat}, ${lp3.label})`);
    await E(() => { const o = window.overdub; o.store.undo(); o.transport.marker.set(0); });

    /* ---- R at the marker on bar 5: counts in from bar 4, records from bar 5 */
    const ids = await E(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
    await E(async (k) => { const o = window.overdub; await o.engine.start(); o.store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you', label: 'loop off' }); o.ui.select({ track: k }); o.transport.marker.set(16); }, ids.Keys);
    await neutral();
    const loop0 = await E(() => JSON.stringify(window.overdub.store.get().loop));
    await page.keyboard.press('KeyR');
    const counts = [];
    for (let i = 0; i < 40; i++) {
      const c = await E(() => {
        const o = window.overdub;
        return { st: o.input.recorder.state, beat: o.engine.beat, pos: document.querySelector('.tp-pos-bar')?.textContent, posRec: document.querySelector('.tp-pos')?.classList.contains('counting'), n: o.arranger.recView()?.count ?? null, top: !!document.querySelector('.tp-countn, .tp-take .num'), lamp: document.querySelector('.tp-rec')?.className, locked: document.querySelector('.tp-tempo')?.classList.contains('tp-locked'), ball: document.querySelector('.tp-ball')?.classList.contains('rec'), cd: o.transport.countdown(), met: document.querySelector('.tp-met').classList.contains('on') };
      });
      if (c.st !== 'count') break;
      counts.push(c);
      await sleep(70);
    }
    const sawCount = (await heard()).find((x) => /^Counting in/.test(x)) || '';
    T.ok(counts.length > 3 && counts.every((c) => c.beat >= 12 - 0.05 && c.beat < 16 + 0.05), `R at the marker on bar 5 counts in over bar 4, the song pre-rolling (beats ${counts[0]?.beat.toFixed(2)} … ${counts[counts.length - 1]?.beat.toFixed(2)})`);
    const labels = [...new Set(counts.map((c) => c.pos))], nums = [...new Set(counts.map((c) => c.n))];
    T.ok(labels.every((l) => /^−1\.[1-4]$/.test(l)) && labels.length >= 3 && counts.every((c) => c.posRec), `the position reads the count in record ink: ${labels.join(' ')}`);
    T.ok(counts[0].pos === '−1.4' && counts[0].posRec, `from the moment R is pressed, the position reads the whole count (${counts[0].pos}, before any frame drew)`);
    T.ok(nums.filter((n) => n != null).every((n) => n >= 1 && n <= 4) && nums.length >= 3 && +nums.find((n) => n != null) > +nums[nums.length - 1], `one big numeral, over the target lane in the arranger, counts the bar down: ${nums.join(' ')}`);
    T.ok(counts.every((c) => !c.top), 'and none in the top bar (one count numeral, not two)');
    T.ok(counts.every((c) => /\bcounting\b/.test(c.lamp) && c.ball), 'the record lamp counts in, the ball in record ink');
    T.ok(counts.some((c) => c.locked), 'tempo is locked while it counts in');
    T.ok(counts.every((c) => c.met), 'the Click lamp is lit through the count-in (the click off)');
    T.ok(/Counting in, 1 bar\. Recording on Keys from bar 5\./.test(sawCount), `the count-in is announced ("${sawCount}")`);
    for (let i = 0; i < 40 && (await E(() => window.overdub.input.recorder.state)) !== 'rec'; i++) await sleep(50);
    await sleep(150);
    const recClick = await E(() => ({ click: window.overdub.engine.click, recording: window.overdub.engine.recording, lamp: document.querySelector('.tp-met').classList.contains('on'), set: window.overdub.transport.click.get() }));
    T.ok(recClick.click.on && recClick.click.whileRecording && recClick.recording && recClick.lamp && recClick.set.on === false, `the click sounds for the take by default, the click itself still off (${JSON.stringify(recClick)})`);
    const rec = await E(() => ({ st: window.overdub.input.recorder.state, beat: window.overdub.engine.beat, lamp: document.querySelector('.tp-rec').className, pressed: document.querySelector('.tp-rec').getAttribute('aria-pressed'), lab: document.querySelector('.tp-reclab')?.textContent, pos: document.querySelector('.tp-pos-bar')?.textContent, tempo: document.querySelector('.tp-tempo').classList.contains('tp-locked'), meter: document.querySelector('.tp-meter-sig').classList.contains('tp-locked'), loop: document.querySelector('.tp-loop').classList.contains('tp-locked'), title: document.querySelector('.tp-tempo').title }));
    T.ok(rec.st === 'rec' && rec.beat >= 16 && /\bon\b/.test(rec.lamp) && rec.pressed === 'true' && rec.lab === 'REC' && /^5\./.test(rec.pos), `then it records from bar 5: the lamp lit, REC beside the position (${rec.pos})`);
    T.ok(rec.tempo && rec.meter && rec.loop && /after the take/.test(rec.title), `tempo, meter and the loop are dimmed and locked ("${rec.title}")`);
    await shot('transport-rec-recording');
    await page.keyboard.press('KeyL');
    await sleep(100);
    T.ok((await E(() => JSON.stringify(window.overdub.store.get().loop))) === loop0 && (await E(() => window.overdub.input.recorder.state)) === 'rec', 'L during a take leaves the loop alone, and the take keeps going');
    await page.keyboard.press('Backquote');                                    // musical typing, mid-take
    await page.keyboard.down('KeyA'); await sleep(150); await page.keyboard.up('KeyA');
    await sleep(200);
    await page.keyboard.down('KeyG'); await sleep(150); await page.keyboard.up('KeyG');
    await sleep(150);
    await page.keyboard.press('Space');
    let keeping = false;
    for (let i = 0; i < 12; i++) { if (await E(() => document.querySelector('.tp-rec').classList.contains('keeping'))) { keeping = true; break; } await sleep(40); }
    for (let i = 0; i < 60 && (await E(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await sleep(50);
    await sleep(250);
    const done = await E((k) => {
      const o = window.overdub, last = o.input.recorder.last, tr = o.store.track(k);
      const c = tr.clips.find((x) => x.take && !x.mute);
      return { ok: last?.ok, summary: last?.summary, clip: c ? { start: c.start, notes: c.notes.filter((n) => n.by === 'you').length } : null, playing: o.engine.playing, locked: document.querySelector('.tp-tempo').classList.contains('tp-locked') };
    }, ids.Keys);
    const commitSaid = (await heard()).find((x) => /^Take kept/.test(x)) || '';
    T.ok(done.ok && done.clip && done.clip.start === 16 && done.clip.notes === 2 && !done.playing, `Space stops it and keeps it: a take on Keys from bar 5 (${JSON.stringify(done.clip)}; "${done.summary}")`);
    T.ok(keeping, 'the lamp shows the take going in ("keeping")');
    T.ok(/^Take kept\. Take \d+ is in on Keys/.test(commitSaid), `the commit is announced ("${commitSaid}")`);
    await sleep(700);
    const after = await E(() => ({ locked: document.querySelector('.tp-tempo').classList.contains('tp-locked'), lamp: document.querySelector('.tp-rec').className, take: document.querySelector('.tp-take').hidden, marker: window.overdub.transport.marker.beat, beat: window.overdub.engine.beat }));
    T.ok(!after.locked && !/\b(on|counting|keeping)\b/.test(after.lamp) && after.take && after.marker === 16 && after.beat === 16, `afterwards the controls unlock, the lamp is idle and the playhead is back on the marker (${after.beat})`);
    const clickAfter = await E(() => ({ on: window.overdub.engine.click.on, lamp: document.querySelector('.tp-met').classList.contains('on'), saved: JSON.parse(localStorage.getItem('overdub:click') || '{}') }));
    T.ok(!clickAfter.on && !clickAfter.lamp && clickAfter.saved.on === false && clickAfter.saved.takes === true, `the take over, the click goes back off (${JSON.stringify(clickAfter)})`);
    await page.keyboard.press('Backquote');

    /* ---- no click while recording (turned off): the count-in still clicks, and the lamp says so */
    await E(() => window.overdub.transport.click.set({ takes: false }));
    await neutral();
    await page.keyboard.press('KeyR');
    await sleep(250);
    const ck2 = await E(() => ({ st: window.overdub.input.recorder.state, on: window.overdub.engine.click.on, lamp: document.querySelector('.tp-met').classList.contains('on') }));
    await E(() => window.overdub.input.recorder.cancel());
    for (let i = 0; i < 40 && (await E(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await sleep(50);
    await sleep(200);
    const ck3 = await E(() => ({ lamp: document.querySelector('.tp-met').classList.contains('on'), on: window.overdub.engine.click.on }));
    T.ok(ck2.st === 'count' && !ck2.on && ck2.lamp && !ck3.lamp && !ck3.on, `with no click while recording, the count-in still lights the Click lamp, and it goes out after (${JSON.stringify([ck2, ck3])})`);
    await E(() => { const o = window.overdub; o.transport.click.set({ takes: true }); o.transport.marker.set(16); });

    /* ---- R while the song plays: recording starts at the next bar line, the rest of this bar counted */
    await listen();
    await E(() => window.overdub.engine.play(17.5));                         // bar 5, the "and" of beat 2
    for (let i = 0; i < 80 && (await E(() => window.overdub.engine.beat)) < 18.1; i++) await sleep(20);
    await neutral();
    await page.keyboard.press('KeyR');
    const pl0 = await E(() => { const o = window.overdub, lv = o.input.recorder.live(); return { st: o.input.recorder.state, beat: o.engine.beat, from: lv?.from, pos: document.querySelector('.tp-pos-bar')?.textContent, posRec: document.querySelector('.tp-pos')?.classList.contains('counting'), playing: o.engine.playing }; });
    const pls = [];
    for (let i = 0; i < 60; i++) {
      const c = await E(() => { const o = window.overdub; return { st: o.input.recorder.state, beat: o.engine.beat, pos: document.querySelector('.tp-pos-bar')?.textContent, n: o.arranger.recView()?.count ?? null }; });
      if (c.st !== 'count') { pls.push(c); break; }
      pls.push(c);
      await sleep(40);
    }
    const plSaid = (await heard()).find((x) => /^Counting in/.test(x)) || '';
    // the labels shown before the downbeat: on the downbeat itself the readout already shows the bar while the recorder
    // flips from 'count' to 'rec' a frame later, which is right on screen and only a race for the sampler
    const plLabels = [...new Set(pls.filter((c) => c.st === 'count' && c.beat < pl0.from).map((c) => c.pos))];
    const plRec = pls[pls.length - 1];
    T.ok(pl0.playing && pl0.st === 'count' && pl0.from === 20 && pl0.beat > 18 && pl0.beat < 19 && pl0.pos === '−1.2' && pl0.posRec, `R while playing (beat ${pl0.beat.toFixed(2)}) does not punch in: it counts to the next bar line, bar 6 (from ${pl0.from}; ${pl0.pos} at once, in record ink)`);
    T.ok(plLabels.join(' ') === '−1.2 −1.1' && pls.filter((c) => c.st === 'count').some((c) => c.n === 2) && pls.filter((c) => c.st === 'count').some((c) => c.n === 1), `the count is the beats left in this bar: ${plLabels.join(' ')} (the numeral ${[...new Set(pls.map((c) => c.n))].join(' ')})`);
    T.ok(plRec.st === 'rec' && plRec.beat >= 20 - 0.1 && plRec.beat < 20.6, `then it records from bar 6 (state ${plRec.st} at beat ${plRec.beat.toFixed(2)})`);
    T.ok(/^Counting in\. Recording on Keys from bar 6\.$/.test(plSaid), `and says where ("${plSaid}")`);
    await page.keyboard.press('Space');
    for (let i = 0; i < 60 && (await E(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await sleep(50);
    await sleep(300);
    // R, then R again inside the count: cancelled, and the song plays on
    await E(() => window.overdub.engine.play(17.5));
    for (let i = 0; i < 80 && (await E(() => window.overdub.engine.beat)) < 17.7; i++) await sleep(20);
    await neutral();
    await page.keyboard.press('KeyR');
    const c1 = await E(() => window.overdub.input.recorder.state);
    await sleep(120);
    await page.keyboard.press('KeyR');
    await sleep(150);
    const c2 = await E(() => ({ st: window.overdub.input.recorder.state, playing: window.overdub.engine.playing, pos: document.querySelector('.tp-pos-bar')?.textContent, ink: document.querySelector('.tp-pos')?.classList.contains('counting') }));
    T.ok(c1 === 'count' && c2.st === 'idle' && c2.playing && /^5\./.test(c2.pos) && !c2.ink, `R again inside that count cancels it and the song plays on (${c1} → ${c2.st}, playing ${c2.playing}, ${c2.pos})`);
    await E(() => window.overdub.engine.stop());
    await sleep(300);

    /* ---- the first minute: Tap a beat */
    await E(() => { const o = window.overdub; while (o.store.canUndo()) o.store.undo(); o.transport.marker.set(0); });
    await E(() => window.overdub.onboard.start({ force: true, restart: true }));
    if ((await E(() => window.overdub.onboard.step)) === 'listen') await E(() => window.overdub.onboard.skip());
    const door = await E(() => { const b = [...document.querySelectorAll('.ob button')].find((x) => x.textContent.trim() === 'Tap a beat'); b?.click(); return !!b; });
    await sleep(900);
    const fm = await E(() => {
      const o = window.overdub, p = o.store.get();
      return { door: true, loop: p.loop, click: o.engine.metronome, playing: o.engine.playing, mode: o.input.mode, sketch: o.ui.active('bottom'), text: document.querySelector('.ob')?.textContent || '', step: o.onboard.step, drums: o.input.recorder.targetFor('pads')?.name, ball: o.transport.ball };
    });
    T.ok(door && fm.loop.on && fm.loop.end - fm.loop.start === 8 && fm.click && fm.playing && fm.mode === 'tap' && fm.sketch === 'sketch', `Tap a beat: a 2-bar loop plays with the click, Sketch on Tap (${JSON.stringify({ loop: fm.loop, click: fm.click, mode: fm.mode })})`);
    T.ok(fm.step === 'take' && /Press R/.test(fm.text) && /F/.test(fm.text) && fm.ball?.moving, `the card says what to do next, with the ball already moving ("${fm.text.replace(/^.*?Tap a beat\./, '').slice(0, 120)}")`);
    await shot('transport-rec-first-minute');
    await neutral();
    await page.keyboard.press('KeyR');
    const fmc = await E(() => { const o = window.overdub, lv = o.input.recorder.live(), bpb = 4; return { st: o.input.recorder.state, beat: o.engine.beat, from: lv?.from, pos: document.querySelector('.tp-pos-bar')?.textContent, bpb }; });
    const fmLeft = fmc.from > fmc.beat ? fmc.from - fmc.beat : fmc.from + 8 - fmc.beat;   // the next bar line, or the loop's start after the wrap
    T.ok((fmc.st === 'count' && fmc.from % 4 === 0 && fmLeft > 0 && fmLeft <= 4 && fmc.pos === `−1.${Math.ceil(fmLeft - 1e-6)}`) || (fmc.st === 'rec' && Math.abs(fmc.beat % 4) < 0.05), `the first minute: R over the playing loop counts what is left of the bar (beat ${fmc.beat.toFixed(2)} → bar ${fmc.from / 4 + 1}, ${fmc.pos})`);
    for (let i = 0; i < 80 && (await E(() => window.overdub.input.recorder.state)) !== 'rec'; i++) await sleep(50);
    const mid = await E(() => document.querySelector('.ob')?.textContent || '');
    T.ok(/layer/i.test(mid) && /Space/.test(mid), `recording, the card says each pass layers and Space keeps it ("${mid.replace(/^.*?(Recording|Tap)/, '$1').slice(0, 110)}")`);
    for (const k of ['KeyF', 'KeyJ', 'KeyF', 'KeyK']) { await page.keyboard.down(k); await sleep(60); await page.keyboard.up(k); await sleep(260); }
    await page.keyboard.press('Space');
    for (let i = 0; i < 60 && (await E(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await sleep(50);
    await sleep(400);
    const fm2 = await E(() => ({ step: window.overdub.onboard.step, text: document.querySelector('.ob')?.textContent || '', take: window.overdub.onboard.take, last: window.overdub.input.recorder.last }));
    T.ok(fm2.last?.ok && fm2.step === 'ask' && fm2.take.drums && /Your beat is in the song/.test(fm2.text) && /Play keys over it/.test(fm2.text) && /agent/i.test(fm2.text), `Space: the beat is in the song, and the tour offers keys over it, then the agent ("${fm2.text.replace(/^.*?Now the overdub\./, '').slice(0, 140)}")`);
    const keys = await E(() => { const b = [...document.querySelectorAll('.ob button')].find((x) => x.textContent.trim() === 'Play keys over it'); b?.click(); return !!b; });
    await sleep(600);
    const kv = await E(() => { const o = window.overdub; return { typing: !!o.input.qwerty?.on, target: o.store.track(o.input.recorder.targetFor('keys')?.id)?.name, sel: o.store.track(o.ui.state.selection.track)?.name, playing: o.engine.playing, text: document.querySelector('.ob')?.textContent || '' }; });
    T.ok(keys && kv.typing && kv.sel && kv.sel === kv.target && kv.playing && /R/.test(kv.text) && /take/i.test(kv.text), `Play keys over it: musical typing on, ${kv.sel} selected, the loop playing ("${kv.text.replace(/^.*?Now the overdub\./, '').slice(0, 120)}")`);
    await E(() => { const o = window.overdub; o.engine.stop(); o.input.qwerty?.toggle?.(false); o.onboard.stop(); });

    /* ---- New song's first screen offers it */
    await E(() => window.overdub.exporter.newSong());
    await sleep(400);
    const blank = await E(() => { const c = document.querySelector('.ar-empty-card'); const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Tap a beat'); return { card: !!c && c.getClientRects().length > 0, primary: b?.classList.contains('btn-go') }; });
    T.ok(blank.card && blank.primary, `a blank song's first screen offers Tap a beat first (${JSON.stringify(blank)})`);
    await E(() => [...document.querySelectorAll('.ar-empty-card button')].find((x) => x.textContent.trim() === 'Tap a beat')?.click());
    await sleep(900);
    const nb = await E(() => { const o = window.overdub, p = o.store.get(); return { tracks: p.tracks.map((t) => t.name), loop: p.loop, playing: o.engine.playing, click: o.engine.metronome, step: o.onboard.step, card: !!document.querySelector('.ob') }; });
    T.ok(nb.tracks.includes('Drums') && nb.loop.on && nb.loop.end - nb.loop.start === 8 && nb.playing && nb.click && nb.card && nb.step === 'take', `and it starts the first minute on a new Drums track (${JSON.stringify(nb)})`);
    await E(() => { const o = window.overdub; o.engine.stop(); o.onboard.stop(); });

    const errs = errors.filter((e) => !ignorable(e));
    T.ok(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await s.close(); }
}

/* ================================================================ laptops (fresh eyes 5) */
// At 1280 the bar dropped Loop and Undo/Redo (Undo/Redo at 1366 too); "Keys play Bass · Esc" read "Keys pl…" under a
// short title at 1440 and 1280; the click's level read "0 dE". The bar gives way in its own order now (the tap key, the
// position's sixteenth and the spacing first, then the output's number; while the keys play notes the number goes
// first), and says where R records, beside the record key.
for (const w of [1280, 1366, 1440]) {
  const s = await open('/app/', { width: w, height: 800 });
  const { page, errors } = s;
  const E = (fn, a) => page.evaluate(fn, a);
  try {
    await E(() => { localStorage.setItem('overdub:welcomed', '1'); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await E(() => document.fonts.ready.then(() => true));
    // a new song (Untitled), the first minute's Drums and a Bass, both panes open, as the tester had it
    await E(async () => {
      const o = window.overdub;
      o.onboard?.stop?.();
      await o.exporter.newSong();
      await new Promise((r) => setTimeout(r, 300));
      const ids = o.store.dispatch([{ type: 'track.add', ref: 'd', track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} } } },
        { type: 'track.add', ref: 'b', track: { name: 'Bass', kind: 'instrument', instrument: { device: 'core.bass', params: {} } } }], { by: 'you', label: 'two tracks' }).created;
      o.ui.select({ track: ids.b });
      o.ui.setOpen?.('left', true); o.ui.setOpen?.('right', true);
    });
    await sleep(600);
    const bar = () => E(() => {
      window.overdub.ui.fitTop?.(true);
      const vis = (sel) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length || getComputedStyle(e).display === 'none') return false; const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 8 && r.right <= innerWidth && !!hit && e.contains(hit); };
      const row = document.querySelector('.tp-row'), panel = document.querySelector('[data-panel="transport"]').getBoundingClientRect();
      const kids = [...row.children].filter((k) => k.getClientRects().length);
      const hl = document.querySelector('.tp-hold-l'), hold = document.querySelector('.tp-hold');
      return { loop: vis('.tp-loop'), undo: vis('.tp-undo'), redo: vis('.tp-redo'), rec: vis('.tp-rec'), onto: vis('.tp-recto') ? document.querySelector('.tp-recto-v').textContent : null, db: vis('.tp-db'),
        over: Math.round(Math.max(...kids.map((k) => k.getBoundingClientRect().right)) - panel.right),
        hold: hold && !hold.hidden ? { text: hold.textContent, cut: hl.scrollWidth - hl.clientWidth, whole: hold.getBoundingClientRect().right <= panel.right + 0.5 } : null };
    });
    const b0 = await bar();
    T.ok(b0.loop && b0.undo && b0.redo && b0.rec && b0.over <= 0, `${w}: Loop, Undo and Redo are on the bar, and nothing runs off it (${JSON.stringify({ loop: b0.loop, undo: b0.undo, redo: b0.redo, over: b0.over })})`);
    T.ok(b0.onto === 'Bass', `${w}: beside the record key, where R records ("Onto ${b0.onto}")`);
    T.ok(b0.db, `${w}: the output meter keeps its number beside its bars`);
    // musical typing on: "Keys play Bass  Esc" reads whole under "Untitled"
    await page.keyboard.press('Backquote');
    await sleep(400);
    const b1 = await bar();
    T.ok(b1.hold && /^Keys play\s*Bass/.test(b1.hold.text) && /Esc/.test(b1.hold.text) && b1.hold.cut <= 1 && b1.hold.whole && b1.loop && b1.undo && b1.over <= 0, `${w}, musical typing on: "${b1.hold?.text}" reads whole under the title, Loop and Undo still on the bar (${JSON.stringify({ cut: b1.hold?.cut, over: b1.over })})`);
    await page.keyboard.press('Backquote');
    if (w === 1440) {
      // the click's options: the level's value reads whole ("0 dB", not "0 dE")
      await page.click('.tp-caret');
      await sleep(250);
      const pop = await E(() => { const p = document.querySelector('.tp-clickpop'), v = p.querySelector('.tp-pop-v'), pr = p.getBoundingClientRect(), vr = v.getBoundingClientRect(); return { v: v.textContent, over: p.scrollWidth - p.clientWidth, inside: vr.right <= pr.right - 1 && vr.left >= pr.left, note: [...p.querySelectorAll('.tp-pop-note')].every((n) => n.scrollWidth <= n.clientWidth + 1 && n.getBoundingClientRect().right <= pr.right) }; });
      await page.keyboard.press('Escape');
      T.ok(/^0 dB$/.test(pop.v) && pop.over <= 0 && pop.inside && pop.note, `the click's options: the level reads "${pop.v}" whole inside the popover, its note too (${JSON.stringify(pop)})`);
    }
    const errs = errors.filter((e) => !ignorable(e));
    T.ok(!errs.length, `${w}: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await s.close(); }
}

/* ================================================================ R on a blank song (docs/INSTRUMENTS-UX.md 1.1) */
// No track to record onto is never a dead end: R with the keys aimed at a new track makes it at the count-in and
// records onto it in the same press (it used to say "New track: Keys. Press R again to record.").
{
  const s = await open('/app/', { width: 1440, height: 900 });
  const { page, errors } = s;
  const E = (fn, a) => page.evaluate(fn, a);
  try {
    await E(() => { localStorage.setItem('overdub:welcomed', '1'); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await E(async () => { const o = window.overdub; o.onboard?.stop?.(); await o.exporter.newSong(); o.input.emit('sketch:mode', 'play'); });
    await sleep(400);
    const before = await E(() => ({ tracks: window.overdub.store.get().tracks.length, aim: window.overdub.input.recorder.aim('keys') }));
    await page.keyboard.press('KeyR');
    await sleep(500);
    const r = await E(() => { const o = window.overdub, t = o.store.track(o.input.recorder.live()?.track); return { state: o.input.recorder.state, track: t && `${t.name} (${t.instrument.device})`, sel: o.store.track(o.ui.state.selection.track)?.name, toasts: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent), hist: o.store.history.map((h) => h.label) }; });
    await page.keyboard.press('KeyR');   // (R in the count calls it off)
    await sleep(300);
    T.ok(before.tracks === 0 && before.aim.track === null && r.state !== 'idle' && r.track === 'Keys (core.keys)' && r.sel === 'Keys' && !r.toasts.some((x) => /Press R again/.test(x)) && r.hist.join() === 'add Keys for the keys',
      `R on a blank song makes Keys and counts in onto it in the same press, no "Press R again" (${JSON.stringify(r)})`);
    const errs = errors.filter((e) => !ignorable(e));
    T.ok(!errs.length, `R on a blank song: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await s.close(); }
}

/* ================================================================ a phone */
{
  const s = await open('/app/', { query: 'demo', width: 390, height: 844 });
  const { page, errors, shot } = s;
  const E = (fn, a) => page.evaluate(fn, a);
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    // (the fonts first: under load one can land between two measurements below and move the bar a pixel)
    await E(() => document.fonts.ready.then(() => true));
    await sleep(500);
    const ph = await E(() => {
      const box = (sel) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), cy: Math.round(r.top + r.height / 2) }; };
      return { ball: box('.tp-ball'), pos: box('.tp-pos-bar'), play: box('.tp-play'), rec: box('.tp-rec'), kill: box('.tp-kill'), title: box('.tp-title'), vw: innerWidth, sw: document.documentElement.scrollWidth };
    });
    T.ok(ph.ball && ph.pos && ph.ball.x >= ph.pos.r - 2 && Math.abs(ph.ball.cy - ph.pos.cy) < 14 && ph.ball.r <= ph.vw && ph.ball.y > ph.title.y, `phone: the ball beside the position on the second row (${JSON.stringify({ ball: ph.ball, pos: ph.pos })})`);
    T.ok(ph.sw <= ph.vw && ph.kill && ph.kill.r <= ph.vw && ph.rec && ph.rec.h >= 40, `phone: nothing runs off the side (${ph.sw} px), record is a 40 px key`);
    // the bar's second row holds still: bar 3, bar 10, and a long song's bar 100 (the tester's top bar grew 40 px)
    const rowAt = (b) => E(async (b) => { const o = window.overdub; o.engine.seek(b); await new Promise((r) => setTimeout(r, 150)); const r = (s) => { const e = document.querySelector(s).getBoundingClientRect(); return [Math.round(e.left), Math.round(e.top), Math.round(e.width)]; }; return { top: Math.round(document.querySelector('.ew-top').getBoundingClientRect().height), kill: r('.tp-kill'), pos: r('.tp-pos'), ball: r('.tp-ball'), text: document.querySelector('.tp-pos-bar').textContent }; }, b);
    const r3 = await rowAt(8), r10 = await rowAt(36);
    await E(() => { const o = window.overdub, t = o.store.get().tracks.find((x) => x.kind === 'instrument'); o.store.dispatch({ type: 'clip.add', track: t.id, clip: { start: 420, length: 4, notes: [{ p: 60, t: 0, d: 1, v: 0.6 }] } }, { by: 'you', label: 'a clip at bar 106' }); });
    const r100 = await rowAt(398);
    await E(() => window.overdub.store.undo());
    T.ok(r3.top === r10.top && JSON.stringify([r3.kill, r3.pos, r3.ball]) === JSON.stringify([r10.kill, r10.pos, r10.ball]), `phone: from bar 3 to bar 10 nothing on the bar moves (${r3.text} → ${r10.text}: top ${r3.top}/${r10.top}, All off ${r3.kill} / ${r10.kill})`);
    T.ok(r100.top === r3.top && r100.kill[1] === r3.kill[1] && /^100\./.test(r100.text), `phone: a song past bar 99 still fits the row (${r100.text}: top ${r100.top}, All off at y ${r100.kill[1]})`);
    await E(() => window.overdub.engine.seek(0));
    await E(async () => { const o = window.overdub; await o.engine.start(); o.input.recorder.setCountIn(1); o.engine.seek(16); });
    await E(() => window.overdub.transport.record());
    await sleep(500);
    const pc = await E(() => ({ st: window.overdub.input.recorder.state, pos: document.querySelector('.tp-pos-bar')?.textContent, sw: document.documentElement.scrollWidth }));
    T.ok(pc.st === 'count' && /^−1\.[1-4]$/.test(pc.pos) && pc.sw <= 390, `phone: the count reads in the position (${pc.pos}) and nothing moves off screen`);
    await shot('transport-rec-phone');
    await E(() => window.overdub.input.recorder.cancel());
    const errs = errors.filter((e) => !ignorable(e));
    T.ok(!errs.length, `phone: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await s.close(); }
}

T.done();
