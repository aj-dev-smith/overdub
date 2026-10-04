// The beginner's first run (docs/FRESH-EYES-3.md, the beginner's problems 1, 3, 4 and 7), with real clicks and keys:
//   - the welcome's main action is Make your own: a new song of yours (Night Shift goes to Recent songs) and the first
//     minute on it, a Drums track, a 2-bar loop playing with the click; hearing Night Shift stays one click away, and
//     the welcome stays up while it plays (Make your own is still there after a listen)
//   - R, F J K L, Space: the beat is in; "Play keys over it": a Keys track, R, A S D F G, Space: the tune is in; the
//     last card counts what you played, the hits and the notes, from what is in the song
//   - on the demo (the tour from the Song menu): listened past the loop, "Tap a beat" puts the playhead in the loop it
//     sets; the beat goes on a track of its own (Taps), never into Night Shift's drums, and "Play keys over it" records
//     on a new track (Tune), never muting or covering the song's chords
//   - the toast after each take stays off the detail pane (the Takes list's Hear, Keep and Agent) and off the tour card
//   - the cards speak plainly: no "Now the overdub." or "That's an overdub." as a headline
//   node tools/onboard-test.js      (screenshots: tools/.out/onboard-*.png)
import fs from 'node:fs';
import { open, tally } from './pw.js';

const T = tally('onboard');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) => /favicon|ERR_CONNECTION|net::|AudioContext was not allowed|fonts\.g/i.test(e);

const s = await open('/app/', { query: 'demo', width: 1440, height: 900 });
const { page, errors, shot } = s;
const E = (fn, a) => page.evaluate(fn, a);
const neutral = () => E(() => { document.activeElement?.blur?.(); document.querySelector('.ar-scroll')?.focus({ preventScroll: true }); });
const waitFor = (fn, a, ms = 8000) => page.waitForFunction(fn, a, { timeout: ms }).catch(() => {});
const recIdle = () => waitFor(() => window.overdub.input.recorder.state === 'idle', null, 4000);
// a rect that overlaps any of the others
const overlaps = (a, list) => list.some((b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1);
// the toast stack and what it must stay off: the detail pane, its Hear / Keep / Agent buttons, the tour card
const toastClear = () => E(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const ts = [...document.querySelectorAll('.ew-toast')].filter((t) => !t.classList.contains('out')).map(r);
  const bottom = document.querySelector('.ew-region-bottom');
  const btns = [...document.querySelectorAll('.ew-region-bottom button')].filter((b) => b.getClientRects().length && /^(Hear|Keep|Agent|Keep on…)/.test(b.textContent.trim())).map(r);
  const ob = document.querySelector('.ob:not(.out)');
  return { ts, text: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '), bottom: bottom && bottom.getClientRects().length ? r(bottom) : null, btns, ob: ob ? r(ob) : null };
});
// R, the keys, then Space, once the take is recording
async function take(keys, gap = 230) {
  await neutral();
  await page.keyboard.press('KeyR');
  await waitFor(() => window.overdub.input.recorder.state === 'rec', null, 8000);
  for (const k of keys) { await page.keyboard.down(k); await sleep(70); await page.keyboard.up(k); await sleep(gap); }
  await page.keyboard.press('Space');
  await recIdle();
  await sleep(400);
}

try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(600);

  /* ================================================================ the welcome: Make your own */
  const wel = await E(() => {
    const el = document.querySelector('.ar-welcome'), main = el?.querySelector('.ar-welcome-acts .btn');
    return el ? { main: main?.textContent.trim(), cls: main?.className, sub: el.querySelector('.ar-welcome-own-s')?.textContent, hear: el.querySelector('.ar-welcome-hear')?.textContent, links: [...el.querySelectorAll('.ar-link')].map((x) => x.textContent) } : null;
  });
  T.ok(wel && wel.main === 'Make your own' && /ar-welcome-own/.test(wel.cls) && /a beat and a tune in two minutes/.test(wel.sub), `the welcome's main action is "Make your own: a beat and a tune in two minutes" (${JSON.stringify(wel)})`);
  T.ok(wel && /Space\s*plays it/.test(wel.hear) && wel.links.includes('the tour') && wel.links.includes('ask the agent'), `hearing this one is one click beside it, with the tour and the agent (${wel && wel.links.join(', ')})`);
  await shot('onboard-welcome');
  // every link and key on the card reads on its paper whatever the pointer does: hovered, pressed, focused (the room's
  // link hover is cream, the paper's own colour: "the tour" vanished under a mouse, and on iOS, which keeps :hover after
  // a tap, "Tap to play it" did after a tap); a guitarist is pointed at the Jam room in one line
  {
    const ids = await E(() => [...document.querySelectorAll('.ar-welcome :is(.ar-link, .btn)')].map((el, i) => { el.dataset.probe = String(i); return { i, text: el.textContent.trim().slice(0, 20) }; }));
    const read = (i) => E((i) => {
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const el = document.querySelector(`.ar-welcome [data-probe="${i}"]`), cs = getComputedStyle(el), paper = getComputedStyle(document.querySelector('.ar-welcome')).backgroundColor;
      const bg = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? paper : cs.backgroundColor;
      return Math.min(ratio(cs.color, bg), ratio(bg, paper) >= 3 ? 99 : ratio(cs.color, paper));
    }, i);
    const low = [];
    for (const { i, text } of ids) {
      const sel = `.ar-welcome [data-probe="${i}"]`;
      const rest = await read(i);
      await page.hover(sel);
      const hover = await read(i);
      const b = await page.locator(sel).boundingBox();
      await page.mouse.down();
      const press = await read(i);
      await page.mouse.move(b.x + b.width / 2, b.y - 60);   // (let go away from it: nothing is clicked)
      await page.mouse.up();
      await E((sel) => document.querySelector(sel).focus(), sel);
      const focus = await read(i);
      await E(() => document.activeElement?.blur());
      for (const [st, v] of [['rest', rest], ['hover', hover], ['pressed', press], ['focused', focus]]) if (v < 4.5) low.push(`${text} ${st} ${v.toFixed(1)}:1`);
    }
    await page.mouse.move(700, 400);
    T.ok(ids.length >= 6 && !low.length, `every link and key on the welcome card reads on its paper, hovered, pressed and focused (${ids.length} of them${low.length ? '; low: ' + low.join(', ') : ''})`);
    const jam = await E(() => document.querySelector('.ar-welcome .ar-welcome-jam')?.textContent || '');
    T.ok(/^Play guitar\? The Jam room puts the chords on a neck\.$/.test(jam), `a guitarist is pointed at the Jam room in one line ("${jam}")`);
  }
  // one click plays Night Shift, and the welcome stays: Make your own is still there after a listen
  await page.click('.ar-welcome-hear');
  await waitFor(() => window.overdub.engine.playing, null, 5000);
  await sleep(500);
  const heard = await E(() => ({ playing: window.overdub.engine.playing, title: window.overdub.store.get().title, card: !!document.querySelector('.ar-welcome:not(.out) .ar-welcome-own') }));
  T.ok(heard.playing && heard.title === 'Night Shift' && heard.card, `one click on "Space plays it" plays Night Shift, and the welcome stays up with Make your own (${JSON.stringify(heard)})`);

  await page.click('.ar-welcome-own');
  await waitFor(() => window.overdub.onboard?.step === 'take' && window.overdub.engine.playing && window.overdub.store.get().tracks.length === 1, null, 8000);
  await sleep(500);
  const own = await E(() => {
    const o = window.overdub, p = o.store.get(), lp = p.loop;
    return { title: p.title, tracks: p.tracks.map((t) => `${t.name}:${t.by}`), recent: o.exporter.recent().map((e) => e.title), loop: lp, beat: o.engine.beat, playing: o.engine.playing, click: o.engine.metronome, step: o.onboard.step, card: document.querySelector('.ob .ob-t')?.textContent, welcome: !!document.querySelector('.ar-welcome:not(.out)') };
  });
  T.ok(own.title !== 'Night Shift' && own.recent.includes('Night Shift') && own.tracks.length === 1 && /^Drums:you$/.test(own.tracks[0]), `Make your own: a new song with one Drums track of yours, Night Shift in Recent songs (${JSON.stringify({ title: own.title, tracks: own.tracks, recent: own.recent })})`);
  T.ok(own.loop.on && own.loop.end - own.loop.start === 8 && own.playing && own.beat >= own.loop.start && own.beat < own.loop.end && own.click && own.step === 'take' && own.card === 'Tap a beat.' && !own.welcome, `and the first minute on it: a 2-bar loop playing (beat ${own.beat.toFixed(2)}) with the click, "Tap a beat." (${JSON.stringify({ loop: own.loop, step: own.step, card: own.card })})`);
  await shot('onboard-own-tap');

  // the beat: R, F J K L, Space
  await take(['KeyF', 'KeyJ', 'KeyK', 'KeyF', 'KeyL']);
  const beat = await E(() => { const o = window.overdub; return { step: o.onboard.step, title: document.querySelector('.ob .ob-t')?.textContent, text: document.querySelector('.ob')?.textContent || '', hits: o.store.get().tracks.find((t) => t.name === 'Drums').clips.reduce((n, c) => n + c.notes.filter((x) => (x.by || c.by) === 'you').length, 0) }; });
  T.ok(beat.step === 'ask' && beat.title === 'Your beat is in the song.' && beat.hits >= 4 && /Play keys over it/.test(beat.text), `R, F J K L, Space: "${beat.title}" (${beat.hits} hits in the song), and keys over it next`);
  const tc1 = await toastClear();
  T.ok(/Your beat is in/.test(tc1.text) && tc1.bottom && tc1.ts.every((t) => !overlaps(t, [tc1.bottom, ...tc1.btns]) && !(tc1.ob && overlaps(t, [tc1.ob]))), `the take's toast stays off the detail pane (the Takes list's ${tc1.btns.length} Hear / Keep / Agent buttons) and off the tour card (${tc1.ts.length} toasts: "${tc1.text.slice(-90)}")`);
  await shot('onboard-own-beat');

  // the tune: "Play keys over it", R, A S D F G, Space
  await page.click('.ob button:has-text("Play keys over it")');
  await waitFor(() => !!window.overdub.input.qwerty?.on && window.overdub.engine.playing, null, 5000);
  const kv = await E(() => { const o = window.overdub; return { sel: o.store.track(o.ui.state.selection.track)?.name, tracks: o.store.get().tracks.map((t) => t.name) }; });
  T.ok(kv.sel === 'Keys' && kv.tracks.join() === 'Drums,Keys', `"Play keys over it" in your own song: a Keys track, selected (${JSON.stringify(kv)})`);
  await take(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'], 180);
  await E(() => { const o = window.overdub; o.engine.stop(); o.input.qwerty?.toggle?.(false); });
  const tc2 = await toastClear();
  T.ok(/Take 1 is in/.test(tc2.text) && tc2.ts.every((t) => !overlaps(t, [tc2.bottom, ...tc2.btns]) && !(tc2.ob && overlaps(t, [tc2.ob]))), `the keys take's toast stays off the detail pane and the tour card too (${tc2.ts.length} toasts: "${tc2.text.slice(-90)}")`);
  // the last card counts what you played, from the song
  await E(() => { for (let i = 0; i < 4 && window.overdub.onboard.step !== 'done'; i++) window.overdub.onboard.skip(); });
  await sleep(200);
  const done = await E(() => {
    const o = window.overdub, p = o.store.get(), mine = (t) => t ? t.clips.filter((c) => !c.mute).reduce((n, c) => n + c.notes.filter((x) => (x.by || c.by) === 'you').length, 0) : 0;
    return { step: o.onboard.step, title: document.querySelector('.ob .ob-t')?.textContent, text: document.querySelector('.ob')?.textContent || '', hits: mine(p.tracks.find((t) => t.name === 'Drums')), notes: mine(p.tracks.find((t) => t.name === 'Keys')), played: o.onboard.played() };
  });
  T.ok(done.step === 'done' && done.notes > 0 && done.played.hits === done.hits && done.played.notes === done.notes && done.text.includes(`your ${done.hits} hits and ${done.notes} note${done.notes === 1 ? '' : 's'}`), `the last card counts what you played, hits and notes, as the song has them (${done.hits} hits, ${done.notes} notes: "${(done.text.match(/(First you|In the song):[^.,]*[.,]/) || [''])[0]}")`);
  T.ok(!/Now the overdub|That’s an overdub\./.test(done.text) && done.title === 'Your part is in the song.' && !/played over you/.test(done.text) && /called an overdub/.test(done.text), `its headline says what happened ("${done.title}": the agent step was skipped, so no agent is credited), and the word overdub is explained, not a headline`);
  await shot('onboard-own-done');
  // making it longer (docs/FRESH-EYES-4.md, the beginner's problem 4): the toast after the beat offered it, and the last
  // card's "Make it 8 bars" repeats what's there (the beat and the tune together) to 8 bars, the loop with it, in one
  // undo step, and the view stays where it was
  T.ok(/Make it 8 bars/.test(tc1.text), `the toast after the kept beat offers "Make it 8 bars" ("${tc1.text.slice(-120)}")`);
  const span = () => E(() => {
    const o = window.overdub, p = o.store.get(), on = p.tracks.flatMap((t) => t.clips.filter((c) => !c.mute).map((c) => ({ t: t.name, c })));
    const end = Math.max(...on.map(({ c }) => c.start + c.length)), start = Math.min(...on.map(({ c }) => c.start));
    const notes = (n) => on.filter(({ t }) => t === n).reduce((k, { c }) => k + c.notes.length, 0);
    return { bars: (end - start) / 4, start, drums: notes('Drums'), keys: notes('Keys'), loop: p.loop, hist: o.store.history.length, sx: o.ui.state.scrollX ?? document.querySelector('.ar-scroll').scrollLeft };
  });
  const s0 = await span();
  T.ok(await E(() => [...document.querySelectorAll('.ob button')].some((b) => b.textContent.trim() === 'Make it 8 bars')), `the last card offers "Make it 8 bars" (the song is ${s0.bars} bars)`);
  await page.click('.ob button:has-text("Make it 8 bars")');
  await sleep(300);
  const s1 = await span();
  const card8 = await E(() => ({ text: document.querySelector('.ob')?.textContent || '', btn: [...document.querySelectorAll('.ob button')].some((b) => b.textContent.trim() === 'Make it 8 bars'), toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | ') }));
  T.ok(s0.bars === 2 && s1.bars === 8 && s1.start === s0.start && s1.drums === s0.drums * 4 && s1.keys === s0.keys * 4 && s1.hist === s0.hist + 1 && (s0.loop.on ? s1.loop.end - s1.loop.start === 32 : JSON.stringify(s1.loop) === JSON.stringify(s0.loop)) && s1.sx === s0.sx, `"Make it 8 bars": ${s0.bars} → ${s1.bars} bars, the beat and the tune 4 times (${s0.drums} → ${s1.drums} hits, ${s0.keys} → ${s1.keys} notes), the loop ${s0.loop.on ? '8 bars' : 'left off, as the tour gave it back'}, one undo step, the view where it was`);
  T.ok(!card8.btn && /It’s 8 bars now/.test(card8.text) && /Undo/.test(card8.toast), `the card says so and the offer goes; the toast has Undo ("${(card8.text.match(/It’s 8 bars now[^.]*\./) || [''])[0]}")`);
  await E(() => window.overdub.store.undo());
  const s2 = await span();
  T.ok(s2.bars === 2 && s2.drums === s0.drums && s2.keys === s0.keys && s2.loop.end - s2.loop.start === s0.loop.end - s0.loop.start, `one Undo puts it back to ${s2.bars} bars`);
  await E(() => window.overdub.onboard.stop());

  /* ================================================================ the demo: the tour from the Song menu */
  await E(() => window.overdub.exporter.openRecent(window.overdub.exporter.recent().findIndex((e) => e.title === 'Night Shift')));
  await waitFor(() => window.overdub.store.get().title === 'Night Shift', null, 5000);
  await sleep(300);
  const before = await E(() => { const p = window.overdub.store.get(); return { tracks: p.tracks.map((t) => t.name), drums: p.tracks.find((t) => t.name === 'Drums').clips.reduce((n, c) => n + c.notes.length, 0), keys: JSON.stringify(p.tracks.find((t) => t.name === 'Keys').clips.map((c) => [c.id, c.start, c.length, !!c.mute, c.notes.length])) }; });
  // listened past the loop the tour is about to set
  await E(async () => { const o = window.overdub; o.transport.marker.set(0); await o.engine.start(); await o.engine.play(0); o.engine.seek(12); });
  await sleep(200);
  await page.click('.sm-btn');
  await page.click('.ew-pop .sm-i:has-text("Take one")');
  await waitFor(() => window.overdub.onboard.step === 'take', null, 5000);
  await page.click('.ob button:has-text("Tap a beat")');
  await sleep(1200);
  const tap = await E(() => { const o = window.overdub, p = o.store.get(); return { loop: p.loop, beat: o.engine.beat, playing: o.engine.playing, card: document.querySelector('.ob')?.textContent || '', sel: o.store.track(o.ui.state.selection.track)?.name, tracks: p.tracks.map((t) => t.name) }; });
  T.ok(tap.loop.on && tap.loop.end - tap.loop.start === 8 && tap.playing && tap.beat >= tap.loop.start && tap.beat < tap.loop.end && /The loop is playing bars 1–2/.test(tap.card), `listened past bar 2, "Tap a beat" puts the playhead in the loop it sets, as the card says (beat ${tap.beat.toFixed(2)}, loop ${tap.loop.start}–${tap.loop.end})`);
  T.ok(tap.sel === 'Taps' && tap.tracks.filter((n) => n === 'Drums').length === 1, `on the demo the beat gets a track of its own, Taps, beside Night Shift's Drums (${tap.tracks.join(', ')})`);
  await shot('onboard-demo-tap');
  await take(['KeyF', 'KeyJ', 'KeyK', 'KeyL']);
  const tc3 = await toastClear();
  const afterBeat = await E(() => { const p = window.overdub.store.get(); return { drums: p.tracks.find((t) => t.name === 'Drums').clips.reduce((n, c) => n + c.notes.length, 0), taps: (p.tracks.find((t) => t.name === 'Taps')?.clips || []).reduce((n, c) => n + c.notes.length, 0) }; });
  T.ok(afterBeat.drums === before.drums && afterBeat.taps >= 3, `Night Shift's drums are as they were (${before.drums} → ${afterBeat.drums} hits); your ${afterBeat.taps} are on Taps`);
  T.ok(/Your beat is in/.test(tc3.text) && tc3.ts.every((t) => !overlaps(t, [tc3.bottom, ...tc3.btns]) && !(tc3.ob && overlaps(t, [tc3.ob]))), `on the demo too, the toast is off the Takes list and the tour card (${tc3.ts.length} toasts: "${tc3.text.slice(-90)}")`);
  await page.click('.ob button:has-text("Play keys over it")');
  await waitFor(() => !!window.overdub.input.qwerty?.on, null, 5000);
  await sleep(300);
  const tune = await E(() => { const o = window.overdub; return { sel: o.store.track(o.ui.state.selection.track)?.name, target: o.store.track(o.input.recorder.targetFor('keys')?.id)?.name }; });
  T.ok(tune.sel === 'Tune' && tune.target === 'Tune', `on the demo "Play keys over it" records on a new track, Tune, not the song's Keys (${JSON.stringify(tune)})`);
  await take(['KeyA', 'KeyD', 'KeyG', 'KeyH'], 180);
  await E(() => { const o = window.overdub; o.engine.stop(); o.input.qwerty?.toggle?.(false); });
  const afterKeys = await E(() => { const p = window.overdub.store.get(); return { keys: JSON.stringify(p.tracks.find((t) => t.name === 'Keys').clips.map((c) => [c.id, c.start, c.length, !!c.mute, c.notes.length])), tune: (p.tracks.find((t) => t.name === 'Tune')?.clips || []).filter((c) => !c.mute).reduce((n, c) => n + c.notes.length, 0), text: document.querySelector('.ob')?.textContent || '' }; });
  T.ok(afterKeys.keys === before.keys && afterKeys.tune > 0, `the song's chords play on, untouched and unmuted; your ${afterKeys.tune} notes are on Tune`);
  await E(() => { for (let i = 0; i < 4 && window.overdub.onboard.step !== 'done'; i++) window.overdub.onboard.skip(); });
  await sleep(200);
  const dd = await E(() => ({ text: document.querySelector('.ob')?.textContent || '', played: window.overdub.onboard.played() }));
  T.ok(dd.played.hits >= 3 && dd.played.notes === afterKeys.tune && dd.text.includes(`your ${dd.played.hits} hits and ${dd.played.notes} note`), `and the last card credits both: "${(dd.text.match(/(First you|In the song):[^.,]*[.,]/) || [''])[0]}" (not "your 1 hit")`);
  await shot('onboard-demo-done');
  await E(() => window.overdub.onboard.stop());

  /* ================================================================ songs loaded mid-tour, Close, drawn squares */
  const ownNow = async () => { await E(() => window.overdub.onboard.ownSong()); await waitFor(() => window.overdub.onboard?.step === 'take' && window.overdub.onboard.minute === 'tap', null, 8000); await sleep(300); };
  const undoToast = () => E(() => [...document.querySelectorAll('.ew-toast button')].reverse().find((b) => b.textContent === 'Undo')?.click());
  await E(async () => { const o = window.overdub; o.engine.stop(); await o.exporter.openDemo('night-shift'); o.transport.click.set({ on: false }); });
  await sleep(300);
  // Undo of Make your own: Night Shift is back, and the tour starts over on it (not "Tap a beat" with the pads live on
  // a track that has gone, which put your taps into Night Shift's own drums)
  await ownNow();
  await undoToast();
  await sleep(600);
  const un = await E(() => { const o = window.overdub; return { title: o.store.get().title, step: o.onboard.step, minute: o.onboard.minute, mode: o.input.mode, card: document.querySelector('.ob .ob-t')?.textContent, click: o.engine.metronome }; });
  T.ok(un.title === 'Night Shift' && un.minute === null && un.mode !== 'tap' && un.card !== 'Tap a beat.' && !un.click && (un.step === 'listen' || un.step === 'take'), `Undo of Make your own: the tour starts over on Night Shift, the pads and the click off (${JSON.stringify(un)})`);
  await E(() => { window.overdub.onboard.stop(); window.overdub.engine.stop(); });
  // Close gives back what the first minute lent: the click (kept in this browser, it clicked in every song after) and Tap
  // (the pads, and Sketch's tab: on Tap it the pads stay live, and L, the loop key, plays a pad)
  await E(() => window.overdub.input.emit('sketch:mode', 'hum'));
  await ownNow();
  const lentOn = await E(() => ({ click: window.overdub.engine.metronome, mode: window.overdub.input.mode }));
  await page.click('.ob .ob-x');
  await sleep(300);
  const closed = await E(() => ({ click: window.overdub.engine.metronome, stored: JSON.parse(localStorage.getItem('overdub:click') || '{}').on, mode: window.overdub.input.mode, sketch: window.overdub.input.sketchMode }));
  T.ok(lentOn.click && lentOn.mode === 'tap' && !closed.click && !closed.stored && closed.mode !== 'tap' && closed.sketch === 'hum', `Close puts the click and Tap back as they were (on during the minute ${JSON.stringify(lentOn)}, after ${JSON.stringify(closed)})`);
  await E(() => window.overdub.engine.stop());
  await undoToast();
  await sleep(300);
  // Draw a beat in the first minute: the card counts the squares as they're drawn, not the first one only
  await ownNow();
  await E(() => document.querySelector('.sk-draw')?.click());
  await sleep(400);
  const drawn = [];
  for (let i = 0; i < 3; i++) {
    await E((k) => { const o = window.overdub, sel = o.ui.state.selection; o.store.dispatch({ type: 'notes.add', track: sel.track, clip: sel.clip, notes: [{ p: 36, t: k, d: 0.25, v: 100 }] }, { by: 'you', label: 'add Kick' }); }, i);
    await sleep(150);
    drawn.push(await E(() => ({ step: window.overdub.onboard.step, text: document.querySelector('.ob')?.textContent || '' })));
  }
  T.ok(drawn[2].step === 'ask' && /Your 3 hits are on a track/.test(drawn[2].text), `three squares drawn in the first minute: the card says "Your 3 hits" (${drawn.map((d) => `${d.step}: ${(d.text.match(/Your \d+ hits?/) || ['?'])[0]}`).join(' → ')})`);
  await E(() => { window.overdub.onboard.stop(); window.overdub.engine.stop(); });
  await undoToast();
  await sleep(300);
  // a short, narrow window (1024×640): Make your own's toast stays inside the arrangement and off the tour card
  await page.setViewportSize({ width: 1024, height: 640 });
  await sleep(500);
  await ownNow();
  await sleep(400);
  const small = await toastClear();
  const ctr = await E(() => { const b = document.querySelector('.ew-region-center').getBoundingClientRect(); return { left: b.left, right: b.right }; });
  T.ok(/New song/.test(small.text) && small.ob && small.ts.length && small.ts.every((t) => !overlaps(t, [small.ob]) && t.left >= ctr.left - 1 && t.right <= ctr.right + 1), `at 1024×640 the "New song" toast is inside the arrangement and off the tour card (toasts ${JSON.stringify(small.ts.map((t) => [t.left, t.top, t.right, t.bottom].map(Math.round)))}, card ${JSON.stringify([small.ob.left, small.ob.top, small.ob.right, small.ob.bottom].map(Math.round))})`);
  await shot('onboard-toast-1024');
  await E(() => { window.overdub.onboard.stop(); window.overdub.engine.stop(); });
  await page.setViewportSize({ width: 1440, height: 900 });

  // a real first visit (not under webdriver): the welcome and its Make your own are up, and the tour waits for them
  {
    const ctx = await s.browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const fp = await ctx.newPage();
    await fp.goto(s.base + '/app/', { waitUntil: 'load' });
    await fp.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await sleep(800);
    const fv = await fp.evaluate(() => ({ webdriver: navigator.webdriver, welcome: !!document.querySelector('.ar-welcome:not(.out) .ar-welcome-own'), tour: document.querySelector('.ob:not(.out) .ob-t')?.textContent || null, active: window.overdub.onboard.active }));
    T.ok(fv.webdriver === false && fv.welcome && !fv.tour && !fv.active, `a first visit opens on the welcome with Make your own, and the tour doesn't close it (${JSON.stringify(fv)})`);
    // the welcome's "The Jam room" opens the room
    if (await fp.$('.ar-welcome .ar-welcome-jamlink')) await fp.click('.ar-welcome .ar-welcome-jamlink');
    await sleep(400);
    const room = await fp.evaluate(() => ({ center: window.overdub.ui.active('center'), card: !!document.querySelector('.ar-welcome:not(.out)') }));
    T.ok(room.center === 'jam' && !room.card, `the welcome's "The Jam room" opens the Jam room (${JSON.stringify(room)})`);
    await ctx.close();
  }

  /* ================================================================ someone else's song, and Close (FRESH-EYES round 5)
     A tour left half-way resumed on a link someone sent (on a phone it, the banner and the ask left no timeline), and
     its Close "gave back" a loop that was never its own there: it turned the link's loop off, signed by you. The tour
     never runs on someone else's song by itself; Close gives back the loop it set only on the song it set it on, only if
     nobody has changed it since, signed by the house. */
  {
    const S = await import('../app/src/core/share.js');
    const { demoProject } = await import('../app/src/core/demo.js');
    const theirs = demoProject();
    theirs.title = 'Their Song';
    theirs.loop = { on: true, start: 0, end: 8 };   // (a 2-bar loop at bar 1: just what the first minute sets)
    const link = (await S.encodeShare(theirs, { from: { name: 'Sam', me: 'samSecret01' } })).hash;
    const ctx = await s.browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const pg = await ctx.newPage();
    const P = (fn, a) => pg.evaluate(fn, a);
    const boot = async (url) => { await pg.goto(s.base + url, { waitUntil: 'load' }); await pg.waitForSelector('html[data-ready="1"]', { timeout: 45000 }); await sleep(700); };
    const card = () => P(() => ({ card: !!document.querySelector('.ob:not(.out)'), active: window.overdub.onboard.active, step: window.overdub.onboard.step, listening: !!window.overdub.share?.listening, title: window.overdub.store.get().title }));
    await boot('/app/?demo');
    await P(() => { localStorage.setItem('overdub:welcomed', '1'); localStorage.setItem('overdub:onboard', JSON.stringify({ state: 'on', step: 'take' })); });
    await boot('/app/');
    const mine = await card();
    // a tour left half-way, then a link opens: no tour on their song; Back to my song brings it back where it was
    await pg.goto('about:blank');
    await boot('/app/' + link);
    const onLink = await card();
    await P(() => window.overdub.share.leave());
    await sleep(600);
    const back = await card();
    T.ok(mine.active && mine.step === 'take' && onLink.listening && !onLink.card && !onLink.active && !back.listening && back.card && back.step === 'take',
      `a tour left half-way resumes on your song (${mine.step}), not on a link someone sent (card: ${onLink.card}), and picks up again on Back to my song (${back.step})`);
    // mid-tour, a link opened in the tab: the tour steps aside, and comes back with your song
    await P((h) => window.overdub.share.open(h), link);
    await sleep(500);
    const mid = await card();
    await P(() => window.overdub.share.leave());
    await sleep(600);
    const mid2 = await card();
    T.ok(mid.listening && !mid.card && !mid.active && mid2.card && mid2.active, `a link opened mid-tour sends the tour aside (card: ${mid.card}); your song back, so is the tour (${mid2.step})`);
    // a tour that set its loop on your song, resumed and closed on their link (a reload with the link in it): their
    // song is left as it is: not turned off, not widened, not signed by you
    await P(() => { localStorage.setItem('overdub:onboard', JSON.stringify({ state: 'on', step: 'ask', lent: { loop: { on: true, start: 0, end: 8 }, was: { on: false, start: 0, end: 32 } } })); });
    await pg.goto('about:blank');
    await boot('/app/' + link);
    await P(() => { if (!window.overdub.onboard.active) window.overdub.onboard.start({ force: true }); });
    await sleep(300);
    await P(() => document.querySelector('.ob .ob-x')?.click());
    await sleep(300);
    const left = await P(() => ({ loop: window.overdub.store.get().loop, edited: !!window.overdub.share.edited, mine: window.overdub.store.history.filter((x) => /tour/.test(x.label || '')).map((x) => `${x.by}: ${x.label}`) }));
    T.ok(left.loop.on && left.loop.start === 0 && left.loop.end === 8 && !left.edited && !left.mine.length, `closing a tour on someone else's song leaves their loop as it is (${JSON.stringify(left.loop)}; ${left.mine.length ? left.mine.join(', ') : 'no edit'})`);
    await P(() => window.overdub.share.leave());
    await sleep(500);
    // on your own song: Close gives the loop back only as the tour left it, and signs it as the house
    await P(() => { window.overdub.onboard.stop(); localStorage.setItem('overdub:onboard', JSON.stringify({ state: 'dismissed' })); });
    const close1 = async (touch) => {
      await P(async () => { const o = window.overdub; o.engine.stop(); o.store.dispatch({ type: 'project.set', patch: { loop: { on: false, start: 0, end: 32 } } }, { by: 'you', label: 'a long loop, off' }); o.transport.marker.set(0); await o.onboard.firstMinute('tap'); });
      await sleep(500);
      const set = await P(() => window.overdub.store.get().loop);
      if (touch) await P(() => { const o = window.overdub, l = o.store.get().loop; o.store.dispatch({ type: 'project.set', patch: { loop: { ...l, on: false } } }, { by: 'you', label: 'loop off' }); o.store.dispatch({ type: 'project.set', patch: { loop: { ...l, on: true } } }, { by: 'you', label: 'loop on' }); });
      await P(() => { window.overdub.engine.stop(); document.querySelector('.ob .ob-x')?.click(); });
      await sleep(300);
      return P((set) => ({ set, now: window.overdub.store.get().loop, last: `${window.overdub.store.history.at(-1).by}: ${window.overdub.store.history.at(-1).label}` }), set);
    };
    const a = await close1(false);
    T.ok(a.set.on && a.set.end - a.set.start === 8 && !a.now.on && a.now.end === 32 && /^overdub: /.test(a.last), `untouched, Close gives the loop back as it was (${JSON.stringify(a.now)}), signed by the house ("${a.last}")`);
    const b = await close1(true);
    T.ok(b.now.on && b.now.start === b.set.start && b.now.end === b.set.end && /^you: loop on$/.test(b.last), `changed since (off and on again), Close leaves the loop as you left it (${JSON.stringify(b.now)}; last edit "${b.last}")`);
    await ctx.close();
  }

  /* ================================================================ a phone: the track header (FRESH-EYES round 5)
     A finger beside a track's name soloed it: the name is a small target, the rest of the header wasn't one, and the
     browser takes a tap to the nearest thing that can be pressed (S). The header's empty space selects the track; only
     a tap on S soloes it. (Touches over CDP with a radius, as a finger lands.) */
  {
    const ctx = await s.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    await pg.goto(s.base + '/app/?demo', { waitUntil: 'load' });
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await sleep(700);
    await pg.evaluate(() => document.querySelector('.ar-welcome-x')?.click());
    await sleep(300);
    const cdp = await ctx.newCDPSession(pg);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, radiusX: 6, radiusY: 6, force: 1, id: i })) });
    const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(60); await touch('touchEnd', []); await sleep(300); };
    const g = await pg.evaluate(() => { const hd = document.querySelectorAll('.ar-head')[1], q = (s) => hd.querySelector(s).getBoundingClientRect(); const n = q('.ar-hname'), sb = q('.ar-hb-solo'), r = hd.getBoundingClientRect(); return { id: hd.dataset.track, name: [n.right, n.top + n.height / 2], solo: [sb.left + sb.width / 2, sb.top + sb.height / 2, sb.right], head: [r.right, r.bottom] }; });
    const reset = () => pg.evaluate(() => { const o = window.overdub; for (const t of o.store.get().tracks) if (t.solo) o.store.dispatch({ type: 'track.set', track: t.id, patch: { solo: false } }); o.ui.select({ track: null }); });
    const st = () => pg.evaluate((id) => ({ solo: !!window.overdub.store.track(id).solo, sel: window.overdub.ui.state.selection.track === id }), g.id);
    const beside = [[g.name[0] + 6, g.name[1]], [g.name[0] + 20, g.name[1]], [g.name[0] + 10, g.name[1] + 4], [g.name[0] + 10, g.name[1] + 8], [g.solo[2] + 6, g.solo[1]]];
    const got = [];
    for (const [x, y] of beside) { await reset(); await tapAt(x, y); got.push(await st()); }
    await reset();
    await tapAt(g.solo[0], g.solo[1]);
    const onS = await st();
    T.ok(got.every((x) => x.sel && !x.solo) && onS.solo, `a tap beside a track's name selects it and never soloes it (${got.map((x) => (x.solo ? 'S' : x.sel ? 'sel' : '-')).join(' ')}); a tap on S soloes it (${onS.solo})`);
    await ctx.close();
  }

  /* ================================================================ plain words */
  const copy = (() => {
    const src = fs.readFileSync(new URL('../app/src/ui/onboard.js', import.meta.url), 'utf8');
    return { now: /title\('Now the overdub\.'\)/.test(src), thats: /title\('That’s an overdub\.'\)/.test(src), pick: /title\('Pick a take\.'\)/.test(src), capture: /Capture is always on/.test(src) };
  })();
  T.ok(!copy.now && !copy.thats && !copy.pick && !copy.capture, `no tour headline is jargon ("Now the overdub.", "That’s an overdub.", "Pick a take.") and no "Capture is always on" (${JSON.stringify(copy)})`);

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
} finally { await s.close(); }
T.done();
