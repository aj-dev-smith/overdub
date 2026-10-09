// The staged session the landing page's film (tools/demo-video.js) and its social cuts (tools/demo-cuts.js) both
// film: one script, so the film and the cuts tell the same story. Each caller brings its own camera (where the
// in-page zoom aims in each scene) and says whether the captions are drawn in the page (the film) or composed later
// as plates (the cuts).
//
// The session (30 s; the times are marks the script waits for, so each scene starts on its mark whatever the machine):
//   0     Night Shift in the studio; play is pressed.                                       "Play over each other."
//   ~2.8  A new song; "Tap a beat" on its blank sheet is the first minute (app.onboard.firstMinute): a Drums track,
//         bars 1-2 looped with the click, the ball moving in the top bar before a sound is made. Record (top bar):
//         a bar of count-in (the position reads -1.4 .. -1.1, the numeral counts over the lane), then two passes:
//         kick and snare, then hats layered over them, each tap on the beat ruler and in the lane as it lands. R
//         punches out and the loop plays on: the beat is in the song.                       "Tap a beat into the song."
//   ~16   Shift+B: the Band builds chords and bass around the beat (house-signed: unsigned).   "Build a band around it."
//   ~19.6 The demo agent (scripted, real tools, ?agentfast) plays takes over the band's bass as A/B takes; one is
//         kept.                                                                               "The agent plays over you."
//   ~24.6 History: every edit signed, you in warm ink, the agent in cool.                   "Every take is signed."
//   ~27.2 The end card (the caller draws it).
// The small lines under the captions are read from the studio as it is filmed (its own words and counts).
//
// The soundtrack is what was on screen: every state the song passes through (each store change, as it happens) is
// rendered offline in the page (engine.render) and played from where the transport was. While a take records, the
// song doesn't hold the hits yet (they are previews), so that stretch is built from the taps themselves: each pad
// hit, rendered once through the take's own drum track, at the moment its key went down, and again on every later
// pass (Layer: you hear what you've built), plus the click (the engine's own recipe) on every beat it sounded.
//
// The Band picker is not on camera: it is opened with its key (Shift+B) and built with its own Build button, out of
// sight, because it has not moved to the Liner notes look yet (round chips); the caption and the toast line say what
// it did.
import fs from 'node:fs';
import path from 'node:path';
import { open } from './pw.js';

export const SR = 48000;

/* ------------------------------------------------------------------ the overlay: a cursor, captions, the zoom */
const OVERLAY_CSS = `
#dv { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: var(--font-display); }
/* captions: a plate laid over the studio (it floats, so it takes the one shadow); square, a hairline edge; the line in
   Archivo at its widest, ExtraBold Italic, cream; who-words in the warm and cool inks; arrivals 160 ms */
#dv .cap { position: absolute; left: 50%; max-width: 1180px; padding: 16px 30px 19px; text-align: center; border-radius: 0;
  background: var(--bg); border: 1px solid var(--line-2); box-shadow: var(--shadow-2);
  color: var(--text); font: italic 800 44px/1.08 var(--font-display); font-variation-settings: 'wdth' 125; font-stretch: 125%; letter-spacing: -.012em;
  opacity: 0; transform: translate(-50%, 0); transition: opacity .16s var(--ease); white-space: nowrap; }
#dv .cap.on { opacity: 1; }
/* the hero line is overprinted, as on the landing page: cream, the warm pass a hair high-left, the cool a hair low-right */
#dv .cap.hero { font-size: 64px; padding: 22px 42px 28px; text-shadow: -0.03em -0.026em 0 var(--human), 0.03em 0.026em 0 var(--agent); }
#dv .cap.side { left: 44px; top: 50%; white-space: normal; text-align: left; max-width: 640px; transform: translate(0, -50%); }
#dv .cap.top { top: 26px; } #dv .cap.bottom { bottom: 30px; } #dv .cap.middle { top: 50%; margin-top: -64px; }
#dv .cap.lane { top: 300px; }
#dv .cap.bl { left: 34px; bottom: 34px; transform: none; text-align: left; }
#dv .cap .w { color: var(--human); } #dv .cap .c { color: var(--agent); }
#dv .cap small { display: block; margin-top: 9px; font: 600 22px/1.3 var(--font-ui); font-style: normal; color: var(--text-2); letter-spacing: 0; font-variation-settings: normal; text-shadow: none; }
#dv .cap small:empty { display: none; }
#dv .cap small .w { color: var(--human); } #dv .cap small .c { color: var(--agent); }
/* the cursor: an arrow in warm ink (it is you); a press is the arrow pushed in, no ring */
#dv .cur { position: absolute; left: 0; top: 0; width: 34px; height: 34px; transform: translate(640px, 760px);
  transition: transform .62s cubic-bezier(.3, .7, .2, 1); filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .5)); }
#dv .cur svg { width: 34px; height: 34px; display: block; transform-origin: 4px 3px; transition: transform .09s var(--ease); }
#dv .cur.press svg { transform: scale(.78); }
/* the end card: the living Weave across the frame, the lockup and one line under it, on the room */
#dv .end { position: absolute; inset: 0; display: grid; align-content: center; justify-items: center; gap: 26px; opacity: 0; transition: opacity .45s var(--ease); background: var(--bg); }
#dv .end.on { opacity: 1; }
#dv .end canvas { width: 1280px; height: 250px; display: block; }
#dv .end .lockup { display: flex; align-items: center; gap: 22px; }
#dv .end .lockup .mark { width: 96px; height: auto; }
#dv .end .lockup .word { width: 360px; height: auto; }
#dv .end p { margin: 0; color: var(--text); font: italic 800 40px/1.1 var(--font-display); font-variation-settings: 'wdth' 125; font-stretch: 125%; letter-spacing: -.01em; }
#dv .end p .w { color: var(--human); } #dv .end p .c { color: var(--agent); }
#dv .end .slate { font: 600 20px/1 var(--font-mono); color: var(--text-3); }
#studio { transform-origin: 0 0; transition: transform .9s cubic-bezier(.45, .05, .2, 1); }
/* told in the captions instead (their words are read from the page): the toasts and the first-minute coach card.
   The Band picker is opened and built out of sight (see the head of tools/demo-session.js). */
.ew-toasts, aside.ob { display: none !important; }
.band-pop { visibility: hidden !important; }
`;

function installOverlay([css, win]) {
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  const dv = document.createElement('div'); dv.id = 'dv';
  dv.innerHTML = `<div class="cap" data-cap><span data-line></span><small data-small></small></div><div class="cur" data-cur><svg viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.4 L11.6 22 L14.6 20.7 L11.7 14.2 L18 14.2 Z" fill="#ffa043" stroke="#141210" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
    <div class="end" data-end><canvas data-weave></canvas><div class="lockup"><img class="mark" src="/app/assets/logo.svg" alt=""><img class="word" src="/app/assets/wordmark.svg" alt=""></div><p>A studio for <span class="w">you</span> and <span class="c">your agents</span>.</p><div class="slate">overdubstudio.com</div></div>`;
  document.body.append(dv);
  const cap = dv.querySelector('[data-cap]'), line = dv.querySelector('[data-line]'), small = dv.querySelector('[data-small]');
  const cur = dv.querySelector('[data-cur]'), end = dv.querySelector('[data-end]');
  const studio = document.getElementById('studio');
  let z = { s: 1, x: 0, y: 0 };
  // The studio's canvases size themselves from getBoundingClientRect, which includes the camera's zoom (a CSS
  // transform on #studio): a canvas inside the studio is told its unzoomed size, so it draws just as it does at 1:1.
  const gbcr = Element.prototype.getBoundingClientRect;
  HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    const r = gbcr.call(this);
    if (!studio.contains(this)) return r;
    const k = gbcr.call(studio).width / studio.offsetWidth;
    return Math.abs(k - 1) < 1e-4 ? r : new DOMRect(r.x, r.y, r.width / k, r.height / k);
  };
  window.__dv = {
    caption(html, cls = 'bottom', sm = '') { cap.className = 'cap ' + cls; line.innerHTML = html; small.innerHTML = sm; void cap.offsetWidth; cap.classList.add('on'); },
    small(html) { if (small.innerHTML !== html) small.innerHTML = html; },
    restyle(cls) { cap.className = 'cap ' + cls + ' on'; },
    hide() { cap.classList.remove('on'); },
    move(x, y) { cur.style.transform = `translate(${x}px, ${y}px)`; },
    click() { cur.classList.add('press'); setTimeout(() => cur.classList.remove('press'), 140); },
    async weave() {
      const { createWeave } = await import('/site/assets/weave.js');
      const weave = createWeave(dv.querySelector('[data-weave]'));
      weave.demo(); weave.recolor();
      const t0 = performance.now() - 2600;
      for (let t = t0; t < performance.now(); t += 1000 / 30) weave.frame(t);
      const loop = (now) => { weave.frame(now); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    },
    end() { end.classList.add('on'); cap.classList.remove('on'); cur.style.opacity = '0'; },
    // zoom so the layout-space rect {x, y, w, h} fills the window (never under 1:1, and the studio always covers
    // the window, so no edge of the page shows); null zooms out
    zoom(r) {
      if (!r) { z = { s: 1, x: 0, y: 0 }; studio.style.transform = ''; return; }
      const s = Math.max(1, Math.min(win.w / r.w, win.h / r.h));
      let x = win.x + (win.w - r.w * s) / 2 - r.x * s, y = win.y + (win.h - r.h * s) / 2 - r.y * s;
      x = Math.min(win.x, Math.max(win.x + win.w - innerWidth * s, x)); y = Math.min(win.y, Math.max(win.y + win.h - innerHeight * s, y));
      z = { s, x, y }; studio.style.transform = s === 1 && !x && !y ? '' : `translate(${x}px, ${y}px) scale(${s})`;
    },
    screen(el) { const r = this.rect(el); return { x: r.x * z.s + z.x, y: r.y * z.s + z.y, w: r.w * z.s, h: r.h * z.s }; },
    rect(sel) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null;
      const b = el.getBoundingClientRect(), sb = studio.getBoundingClientRect(), k = sb.width / studio.offsetWidth;
      return { x: (b.x - sb.x) / k + studio.offsetLeft, y: (b.y - sb.y) / k + studio.offsetTop, w: b.width / k, h: b.height / k };
    },
  };
  // scroll the agent's feed (only the feed: scrollIntoView would also scroll the panel and take its tabs off screen)
  window.__feedTo = (sel, block = 'start') => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel, feed = el?.closest('.ag-feed');
    if (!feed) return;
    const off = el.getBoundingClientRect().top - feed.getBoundingClientRect().top, k = feed.getBoundingClientRect().height / feed.clientHeight || 1;
    feed.scrollTop += off / k - (block === 'center' ? (feed.clientHeight - el.offsetHeight) / 2 : 0);
  };
}

// What the soundtrack needs, recorded as it happens, each with the wall clock the screencast's frames carry: the song
// at every store change (not the recorder's previews: those are heard from the taps), the transport at every move,
// the engine sampled every 20 ms (the audible beat, the click, the recorder's state), and every hit the recorder took.
function installRecorder() {
  const { store, engine, input } = window.overdub;
  const states = window.__states = [], anchors = window.__anchors = [], ticks = window.__ticks = [], hits = window.__hits = [];
  let last = '';
  const take = (e) => {
    if (e && e.kind === 'preview') return;
    const p = store.get(), j = JSON.stringify(p);
    if (j === last) return;
    last = j; states.push({ at: Date.now() / 1000, kind: e?.kind || 'start', by: e?.by || null, song: structuredClone(p) });
  };
  take();
  store.on('change', take);
  window.__anchor = () => { const a = { at: Date.now() / 1000, beat: engine.beat, playing: engine.playing }; anchors.push(a); return a; };
  engine.on?.('transport', () => setTimeout(() => window.__anchor(), 0));
  const rec = input.recorder;
  rec.on('note', ({ note, pass }) => hits.push({ at: Date.now() / 1000, p: note.p, v: note.v, t: note.t, pass }));
  setInterval(() => {
    const ck = engine.click || {};
    ticks.push({ at: Date.now() / 1000, beat: engine.beat, playing: !!engine.playing, click: !!(ck.on ?? engine.metronome), rec: rec.state, tempo: store.get().tempo });
  }, 20);
}

/* ------------------------------------------------------------------ film it */
// opts: { W, H, dsf, win (the window the zoom aims into), camera: { scene: (R) => rect }, captions (draw them in the
//   page), laneBeats (beats the arranger shows in the first minute), frames (dir), log, length }
// -> { frames, marks (absolute s), info, states, anchors, ticks, hits, renders, oneShots, errors, v0, dur }
export async function filmSession(opts) {
  const { W, H, dsf = 2, win = { x: 0, y: 0, w: W, h: H }, camera, captions = false, laneBeats = 8, log = console.log, length = 30 } = opts;
  const FRAMES = opts.frames;
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });
  const s = await open('/app/', { width: W, height: H });
  await s.page.close();
  const ctx = await s.browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(s.base + '/app/?demo&agentfast', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('overdub:welcomed', '1');
      localStorage.setItem('overdub:onboard', JSON.stringify({ state: 'dismissed' }));
      localStorage.setItem('overdub:layout', JSON.stringify({ leftW: 236, rightW: 400, bottomH: 330, open: { left: false, right: true, bottom: true }, tabs: {} }));
      localStorage.setItem('overdub:band-style', JSON.stringify('pop'));
      localStorage.setItem('overdub:band-parts', JSON.stringify(['chords', 'bass']));
      sessionStorage.setItem('overdub:agent-mock', '1');   // the demo agent, on before we start (no key card)
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(installOverlay, [OVERLAY_CSS, win]);
    await page.evaluate(() => Promise.all([...document.querySelectorAll('#dv img')].map((i) => i.decode().catch(() => {}))));
    // wake the audio engine off camera (browsers want a gesture), so play is instant on camera
    await page.mouse.click(1100, 700);
    await page.evaluate(() => window.overdub.engine.start());
    await page.evaluate(() => { const { ui } = window.overdub; ui.show('sketch'); ui.show('agent'); document.activeElement?.blur(); });
    await page.waitForTimeout(600);
    await page.evaluate(installRecorder);

    const marks = {}, info = {}, frames = [];
    const mark = (k) => { marks[k] = Date.now() / 1000; log(k, `@ ${marks.start ? (marks[k] - marks.start).toFixed(2) : '0.00'} s`, frames.length + ' frames'); };
    const wait = (ms) => page.waitForTimeout(ms);
    async function until(sec, what) {
      const late = Date.now() / 1000 - (marks.start + sec);
      if (late > 0.25) log(`late for ${what} (${sec} s) by ${late.toFixed(2)} s`);
      else if (late < 0) await wait(-late * 1000);
    }
    const E = (fn, arg) => page.evaluate(fn, arg);
    const cap = (html, cls, sm = '') => (captions ? E(([h, c, x]) => window.__dv.caption(h, c, x), [html, cls, sm]) : null);
    const small = (html) => (captions ? E((h) => window.__dv.small(h), html) : null);
    const hide = () => (captions ? E(() => window.__dv.hide()) : null);
    let zoomAt = 0;
    const zoomRect = (r) => { zoomAt = Date.now(); return E((x) => window.__dv.zoom(x), r); };
    const scene = (k, R = {}) => { mark('z_' + k); const r = camera[k] ? camera[k](R) : null; return r === undefined ? null : zoomRect(r); };
    const away = () => E(() => window.__dv.move(1400, 820));
    const stuck = async (e) => { await page.screenshot({ path: path.join(path.dirname(FRAMES), 'stuck.png') }); throw e; };
    async function point(locator, { click = true, dwell = 260, before = null } = {}) {
      const b = await locator.evaluate((el) => window.__dv.screen(el));
      const x = b.x + b.w / 2, y = b.y + b.h / 2;
      await E(([a, c]) => window.__dv.move(a, c), [x, y]);
      await wait(640 + dwell);
      const settle = zoomAt + 960 - Date.now();   // the zoom's transition has to finish before the real click lands
      if (settle > 0) await wait(settle);
      if (!click) return;
      const at = async () => { const r = await locator.boundingBox(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
      let c = await at();
      for (let i = 0; i < 20; i++) { await wait(60); const c2 = await at(); if (c && c2 && Math.hypot(c2.x - c.x, c2.y - c.y) < 0.5) break; c = c2; }
      if (!c) throw new Error('nothing to click: ' + locator);
      if (Math.hypot(c.x - x, c.y - y) > 4) { await E(([a, b2]) => window.__dv.move(a, b2), [c.x, c.y]); await wait(420); }
      if (before) await before();
      await E(() => window.__dv.click());
      await page.mouse.click(c.x, c.y);
    }

    // the first frame is already framed: the play scene, the cursor parked on the play button
    await E((r) => { document.getElementById('studio').style.transition = 'none'; window.__dv.zoom(r); }, camera.play ? camera.play({}) : null);
    await E(() => { void document.getElementById('studio').offsetWidth; document.getElementById('studio').style.transition = ''; });
    const playBtn = page.getByRole('button', { name: 'Play (Space)' });
    const pb = await playBtn.evaluate((el) => window.__dv.screen(el));
    await E(([x, y]) => { const c = document.querySelector('#dv .cur'); c.style.transition = 'none'; window.__dv.move(x, y); void c.offsetWidth; c.style.transition = ''; }, [pb.x + pb.w / 2 + 60, pb.y + pb.h / 2 + 90]);
    await cap('Play over each&nbsp;other.', 'hero middle');
    await wait(500);

    // the screencast
    const cdp = await ctx.newCDPSession(page);
    let nFrame = 0;
    cdp.on('Page.screencastFrame', (f) => {
      const file = path.join(FRAMES, String(nFrame++).padStart(5, '0') + '.jpg');
      fs.writeFile(file, Buffer.from(f.data, 'base64'), () => {});
      frames.push({ ts: f.metadata.timestamp, file });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    mark('start');

    /* 1. Night Shift: press play */
    await point(playBtn, { dwell: 0 });
    await page.waitForFunction(() => window.overdub.engine.playing, null, { timeout: 5000 });
    mark('play');
    await until(1.7, 'the hero line');
    if (captions) await E(() => window.__dv.restyle('hero bottom'));

    /* 2. the first minute: a new song, Tap a beat, R, two passes */
    await until(2.8, 'the new song');
    await hide();
    await E(async () => { const { engine, exporter } = window.overdub; engine.stop(); await exporter.newSong(); });
    await page.waitForSelector('.ar-empty-actions .btn-go', { timeout: 5000 }).catch(stuck);
    mark('new');
    await scene('blank');
    await cap('Tap a beat into the song.', captions === 'film' ? 'bottom' : 'bottom');
    await point(page.locator('.ar-empty-actions .btn-go'), { dwell: 0 });
    await page.waitForFunction(() => window.overdub.engine.playing, null, { timeout: 5000 }).catch(stuck);
    mark('tapdoor');
    await E((b) => window.overdub.arranger.zoomTo(0, b), laneBeats);
    await scene('tap');
    if (captions) await E(() => window.__dv.restyle('lane'));
    info.tempo = await E(() => window.overdub.store.get().tempo);
    const spbMs = 60000 / info.tempo;
    // the loop is two bars from beat 0; R just after bar 2's downbeat counts in the rest of bar 2 (a full bar),
    // and the take starts at the wrap, so pass 1 is the whole loop
    const recBtn = page.getByRole('button', { name: /^Record \(R\)/ });
    await point(recBtn, { dwell: 0, before: () => page.waitForFunction(() => { const b = window.overdub.engine.beat; return b >= 4.02 && b < 4.4; }, null, { polling: 'raf', timeout: 8000 }) });
    mark('rec');
    await page.waitForFunction(() => window.overdub.input.recorder.state !== 'idle', null, { timeout: 3000 }).catch(stuck);
    await small('Counting in.');
    await away();
    // the taps, on the song's grid (the engine's audible beat, unwrapped by passes)
    const beatNow = () => E(() => { const e = window.overdub.engine; return { b: e.beat, st: window.overdub.input.recorder.state, now: Date.now() }; });
    let base = null;   // the wall time of pass 1's downbeat
    for (let i = 0; i < 400 && !base; i++) {
      const x = await beatNow();
      if (x.st === 'rec' || (x.b < 1 && x.b >= 0)) base = x.now - (x.b < 4 ? x.b : x.b - 8) * spbMs;
      else await wait(Math.max(1, Math.min(60, (8 - x.b) * spbMs - 30)));
    }
    if (!base) await stuck(new Error('the take never started'));
    mark('pass1');
    const P1 = [[0, 'KeyF'], [1, 'KeyJ'], [2, 'KeyF'], [2.5, 'KeyF'], [3, 'KeyJ'], [4, 'KeyF'], [5, 'KeyJ'], [6, 'KeyF'], [6.5, 'KeyF'], [7, 'KeyJ']];
    const P2 = Array.from({ length: 16 }, (_, i) => [8 + i * 0.5, 'KeyK']);
    const LATE = [0.012, -0.008, 0.02, 0.004, -0.015, 0.01, 0.018, -0.004, 0.006, 0.014, -0.01, 0.022, 0, 0.009, -0.006, 0.016];   // a person, a little loose (s)
    let k = 0, readout = '';
    for (const [b, key] of [...P1, ...P2]) {
      const target = base + b * spbMs + LATE[k++ % LATE.length] * 1000 - 6;
      const dt = target - Date.now();
      if (dt > 2) await wait(dt);
      await page.keyboard.down(key); await wait(28); await page.keyboard.up(key);
      if (b === 8) mark('pass2');
      if (b === 0.0 || b === 8) {
        const t = await E(() => document.querySelector('.sk-recnote')?.textContent || '');
        if (t) { info['recNote' + (b ? 2 : 1)] = t; await small(t); }
      }
      if (b === 9) {
        // the pass readout under the ruler, once pass 1 is done ("Pass 1: 10 hits, 9 ms early on average")
        readout = await E(() => { const t = document.querySelector('.ew-region-bottom')?.innerText || ''; return (t.match(/Pass 1: [^\n]*/) || [''])[0].trim(); });
        info.readout1 = readout;
      }
    }
    // punch out just after pass 2 ends: R, and the loop plays on with the beat in it
    { const dt = base + 16.06 * spbMs - Date.now(); if (dt > 0) await wait(dt); }
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => window.overdub.input.recorder.state === 'idle', null, { timeout: 4000 }).catch(stuck);
    mark('in');
    info.beatText = await E(() => window.overdub.input.recorder.last?.summary || '');
    if (info.beatText) await small(info.beatText);
    info.hits = await E(() => window.__hits.length);

    /* 3. the band */
    await until(16.2, 'the band');
    await hide();
    // the take is selected after it goes in; select it for sure, then the band's key
    await E(() => { const { store, ui } = window.overdub; const t = store.get().tracks.find((x) => x.name === 'Drums'); const c = t?.clips[t.clips.length - 1]; if (c) ui.select({ track: t.id, clip: c.id, notes: [] }); document.activeElement?.blur(); });
    await scene('band');
    await cap('Build a band around&nbsp;it.', 'bottom');
    await page.keyboard.press('Shift+KeyB');
    await page.waitForSelector('.band-pop .band-go', { state: 'attached', timeout: 4000 }).catch(stuck);
    info.pickerNote = await E(() => document.querySelector('.band-pop .band-note')?.textContent || '');
    const hBand = await E(() => window.overdub.store.history.length);
    await E(() => document.querySelector('.band-pop .band-go').click());
    mark('build');
    await page.waitForFunction((n) => window.overdub.store.history.length > n, hBand, { timeout: 15000 }).catch(stuck);
    mark('band');
    // the click goes off once the band is in (it was there to tap to; the band keeps time now)
    await E(() => { const { transport, engine } = window.overdub; try { transport.click.set({ on: false }); } catch { engine.metronome = false; } });
    await wait(120);
    info.bandText = await E(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.querySelector('span')?.textContent || '').find((t) => /^Band in:/.test(t)) || '');
    info.tracks = await E(() => window.overdub.store.get().tracks.map((t) => `${t.name} (${t.by || 'house'})`));
    log('band', info.bandText, info.tracks.join(', '));
    const bandLine = info.bandText.replace(/ One undo takes it back\.$/, '');
    if (bandLine) await small(bandLine);
    // the lanes stay at the song's start from here on (the agent's highlight would scroll them sideways), so the beat
    // and its band stay in the picture behind the agent and History
    await E(() => { const sc = document.querySelector('.ar-scroll'); sc.scrollLeft = 0; sc.addEventListener('scroll', () => { if (sc.scrollLeft) sc.scrollLeft = 0; }); });
    await scene('arr');

    /* 4. the agent plays over you */
    await until(19.6, 'the agent');
    await hide();
    await E(() => {
      const { store, ui } = window.overdub;
      const p = store.get(), bass = p.tracks.filter((t) => /bass/.test(t.instrument?.device || '') && t.by === 'overdub').pop() || p.tracks.find((t) => t.name === 'Bass');
      ui.select({ track: bass.id, clip: null, notes: [] });
      ui.show('agent');
    });
    await scene('ask');
    await point(page.locator('.ag-input'), { dwell: 0 });
    if (!(await E(() => document.activeElement?.classList.contains('ag-input')))) await page.locator('.ag-input').focus();
    await page.keyboard.type('Play over the bass', { delay: 24 });
    await wait(80);
    await page.keyboard.press('Enter');
    mark('ask');
    await scene('cards');
    await page.waitForSelector('.ag-take', { timeout: 60000 }).catch(stuck);
    mark('cards');
    const cards = page.locator('.ag-take:not(.ag-take-orig)');
    info.takes = await cards.count();
    const WORDS = { 2: 'Two', 3: 'Three', 4: 'Four' };
    await cap('<span class="c">The agent</span> plays over <span class="w">you</span>.', 'bl', `${WORDS[info.takes] || info.takes} takes on the bass. You keep one.`);
    await E(() => window.__feedTo('.ag-vars', 'start'));
    await wait(700);
    const pick = (await cards.filter({ hasText: 'octave pops' }).count()) ? cards.filter({ hasText: 'octave pops' }) : cards;
    const hBefore = await E(() => window.overdub.store.history.length);
    await pick.first().evaluate((el) => window.__feedTo(el, 'center'));
    await wait(200);
    await point(pick.first().locator('.ag-keep'), { dwell: 80 });
    mark('picked');
    await away();
    await page.waitForFunction((n) => window.overdub.store.history.length > n, hBefore, { timeout: 30000 }).catch(stuck);
    info.kept = await E(() => window.overdub.store.history[window.overdub.store.history.length - 1]?.label);

    /* 5. History: who did what */
    await until(24.5, 'History');
    await hide();
    const histTab = page.locator('.ew-region-right [role="tab"]', { hasText: 'History' }).first();
    await scene('history');
    await point(histTab, { dwell: 0 });
    await wait(100);
    if (!(await E(() => !!document.querySelector('.ew-region-right [role="tab"][aria-selected="true"]')?.textContent.includes('History')))) {
      log('the click missed the History tab; showing it'); await E(() => window.overdub.ui.show('history'));
    }
    await cap('Every take is signed.', 'bl', '<span class="w">Warm is you</span>, <span class="c">cool is the agent</span>.');
    mark('history');
    await away();
    info.history = await E(() => window.overdub.store.history.slice(-8).map((t) => `${t.by}: ${t.label}`));

    /* 6. the end card (the film draws it in the page; the cuts compose their own) */
    if (captions) await E(() => window.__dv.weave());
    await until(length - 2.8, 'the end card');
    if (captions) await E(() => window.__dv.end());
    mark('end');
    await until(length, 'the last frame');
    mark('stop');
    await cdp.send('Page.stopScreencast');
    await wait(300);
    log(`${frames.length} frames`);

    /* the soundtrack's parts: each state rendered, and the one-shots the taps need */
    const rec = await E(() => ({ states: window.__states.map((x) => ({ at: x.at, kind: x.kind, by: x.by, loop: x.song.loop, tempo: x.song.tempo })), anchors: window.__anchors, ticks: window.__ticks, hits: window.__hits }));
    await E(() => { window.overdub.engine.stop?.(); });
    const renders = [];
    for (let i = 0; i < rec.states.length; i++) {
      const st = rec.states[i], next = rec.states[i + 1]?.at ?? Infinity;
      // a state nobody heard (before play, or replaced within a few ms) is not rendered
      if (next < marks.play || next - st.at < 0.005) { renders.push(null); continue; }
      const loop = st.loop?.on ? st.loop : { start: 0, end: await E((j) => { const so = window.__states[j].song; return Math.max(...so.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)), 4); }, i) };
      renders.push({ ...(await renderIn(page, i, loop.start, loop.end)), loop, spb: 60 / st.tempo });
    }
    // one hit of each pad the take used, through the take's own drum track (the last state holds it)
    const oneShots = {};
    for (const key of [...new Set(rec.hits.map((x) => `${x.p}:${x.v}`))]) {
      const [p, v] = key.split(':').map(Number);
      oneShots[key] = await E(async ([pp, vv]) => {
        const e = window.overdub, so = structuredClone(window.__states[window.__states.length - 1].song);
        const drums = so.tracks.find((t) => t.name === 'Drums');
        so.tracks = [drums]; so.loop = { on: false, start: 0, end: 4 };
        drums.gain = drums.gain ?? 0; drums.mute = false; drums.solo = false;
        drums.clips = [{ ...drums.clips[0], id: 'c_oneshot', start: 0, length: 4, mute: false, notes: [{ p: pp, t: 0, d: 0.25, v: vv }] }];
        e.store.load(so);
        await new Promise((r) => setTimeout(r, 50));
        const buf = await e.engine.render({ from: 0, to: 1, tail: 1 });
        return Array.from(buf.getChannelData(0)).concat([]).length ? { L: Array.from(buf.getChannelData(0)), R: Array.from(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)) } : null;
      }, [p, v]);
    }
    errors.push(...s.errors);
    frames.sort((a, b) => a.ts - b.ts);
    return { frames, marks, info, ...rec, renders, oneShots, errors, v0: frames[0].ts, dur: marks.stop - frames[0].ts };
  } finally {
    await ctx.close().catch(() => {});
    await s.close();
  }
}

async function renderIn(page, i, from, to) {
  const b64 = await page.evaluate(async ([k, a, b]) => {
    const e = window.overdub;
    e.store.load(window.__states[k].song);
    await new Promise((r) => setTimeout(r, 50));
    const buf = await e.engine.render({ from: a, to: b, tail: 3 });
    const n = buf.length, out = new Float32Array(n * 2);
    out.set(buf.getChannelData(0), 0); out.set(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0), n);
    const bytes = new Uint8Array(out.buffer); let s = '';
    for (let j = 0; j < bytes.length; j += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
    return { sr: buf.sampleRate, n, data: btoa(s) };
  }, [i, from, to]);
  if (b64.sr !== SR) throw new Error('render sample rate ' + b64.sr);
  const f = new Float32Array(Buffer.from(b64.data, 'base64').buffer.slice(0));
  return { L: f.subarray(0, b64.n), R: f.subarray(b64.n) };
}

/* ------------------------------------------------------------------ the soundtrack */
// -> { L, R, levels, gain }: the song as it played, the taps and their later passes, the click; peak to -1 dBFS and a
// fade over the end card from fadeAt (s, film time)
export function soundtrack(take, { fadeAt, tailFade = 0.15 } = {}) {
  const { v0, dur, states, anchors, renders, ticks, hits, oneShots, marks } = take;
  const n = Math.ceil(dur * SR), L = new Float32Array(n), R = new Float32Array(n);
  const rel = (k) => marks[k] - v0;
  // 1. the song: each state from where the transport was put last (a take's previews are not states: below)
  const events = [...states.map((st, k) => ({ i: Math.round((st.at - v0) * SR), state: k })), ...anchors.map((a) => ({ i: Math.round((a.at - v0) * SR), anchor: a }))].sort((a, b) => a.i - b.i);
  const XF = Math.round(0.04 * SR);
  const sample = (k, a, t) => {
    const r = renders[k];
    if (!r || !a || !a.playing) return [0, 0];
    const beat = a.beat + (t - (a.at - v0)) / r.spb, { start, end } = r.loop, len = end - start;
    if (beat < start) return [0, 0];
    const pass = Math.floor((beat - start) / len), pos = (beat - start) - pass * len;
    const i = Math.floor(pos * r.spb * SR), j = Math.floor((pos + len) * r.spb * SR);
    let l = r.L[i] || 0, rr = r.R[i] || 0;
    if (pass > 0 && j < r.L.length) { l += r.L[j]; rr += r.R[j]; }   // the previous pass's tail (reverb, release) over the top
    return [l, rr];
  };
  {
    let st = 0, an = null, prev = null, since = Infinity, e = 0;
    for (let i = 0; i < n; i++) {
      let changed = false;
      while (e < events.length && events[e].i <= i) {
        if (!changed) prev = { st, an };
        if (events[e].state != null) st = events[e].state; else an = events[e].anchor;
        changed = true; e++;
      }
      if (changed) since = 0;
      const t = i / SR;
      let [l, r] = sample(st, an, t);
      if (prev && since < XF) { const [pl, pr] = sample(prev.st, prev.an, t), g = since / XF; l = pl + (l - pl) * g; r = pr + (r - pr) * g; }
      since++;
      L[i] = l; R[i] = r;
    }
  }
  // the stretch of song beats each 20 ms tick pair covered: [b0, b1u] unwrapped (a loop wrap between them is undone
  // with the elapsed time), and the loop's length when it wrapped
  const span = (a, c) => {
    const b0 = a.beat, ela = (c.at - a.at) * (c.tempo || 120) / 60;
    if (c.beat >= b0 - 1e-6) return { b0, b1u: c.beat, shift: 0 };
    const b1u = b0 + ela;
    return { b0, b1u, shift: Math.round(b1u - c.beat) };
  };
  // the moments the audible beat crossed song beat b, while playing, in [from, to) (wall clock)
  const crossings = (b, from, to) => {
    const out = [];
    for (let i = 1; i < ticks.length; i++) {
      const a = ticks[i - 1], c = ticks[i];
      if (!a.playing || !c.playing || c.at < from || a.at >= to) continue;
      const { b0, b1u, shift } = span(a, c);
      for (const bb of shift ? [b, b + shift] : [b]) if (bb > b0 && bb <= b1u) out.push(a.at + (c.at - a.at) * (bb - b0) / (b1u - b0));
    }
    return out.filter((t) => t >= from && t < to);
  };
  const mix = (buf, at, g = 1) => {
    if (!buf) return;
    const i0 = Math.round((at - v0) * SR);
    for (let k = 0; k < buf.L.length; k++) { const i = i0 + k; if (i < 0) continue; if (i >= n) break; L[i] += buf.L[k] * g; R[i] += buf.R[k] * g; }
  };
  // 2. the take as it was recorded: each hit when its key went down, and again on every later pass until it went in
  const inAt = marks.in ?? Infinity;
  const commit = states.find((st) => st.at >= (marks.rec ?? Infinity) && st.kind === 'do')?.at ?? inAt;
  for (const h of hits) {
    const shot = oneShots[`${h.p}:${h.v}`];
    mix(shot, h.at);
    for (const t of crossings(h.t, h.at + 0.3, commit - 0.1)) mix(shot, t);
  }
  // 3. the click: the engine's own recipe (a sine, 1760 Hz on the bar and 1320 on the beat, 1 ms up, 12 ms down), on
  // every whole beat it sounded (the click on, or counting in), a little under its studio level
  const clickBuf = (accent) => {
    const len = Math.round(0.12 * SR), out = new Float32Array(len), f = accent ? 1760 : 1320, pk = (accent ? 0.32 : 0.18) * 0.7;
    for (let k = 0; k < len; k++) { const t = k / SR, env = t < 0.001 ? t / 0.001 : t < 0.002 ? 1 : Math.exp(-(t - 0.002) / 0.012); out[k] = pk * env * Math.sin(2 * Math.PI * f * t); }
    return { L: out, R: out };
  };
  const clicks = [clickBuf(true), clickBuf(false)];
  let nClicks = 0;
  for (let i = 1; i < ticks.length; i++) {
    const a = ticks[i - 1], c = ticks[i];
    if (!a.playing || !c.playing) continue;
    if (!(c.click || c.rec === 'count' || a.rec === 'count')) continue;
    const { b0, b1u } = span(a, c);
    for (let B = Math.floor(b0 + 1e-9) + 1; B <= b1u + 1e-9; B++) {
      mix(clicks[((B % 4) + 4) % 4 === 0 ? 0 : 1], a.at + (c.at - a.at) * (B - b0) / (b1u - b0));   // (loops are whole bars)
      nClicks++;
    }
  }
  // level: peak to -1 dBFS; fade out over the end card
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const fadeFrom = (fadeAt ?? rel('end') + 0.4) * SR, fadeTo = n - tailFade * SR;
  for (let i = 0; i < n; i++) {
    const f = i < fadeFrom ? 1 : Math.max(0, 1 - (i - fadeFrom) / (fadeTo - fadeFrom));
    const g = gain * f * f; L[i] *= g; R[i] *= g;
  }
  const rms = (a, b) => { let s2 = 0, c = 0; for (let i = Math.max(0, Math.round(a * SR)); i < Math.min(n, Math.round(b * SR)); i++) { s2 += L[i] * L[i] + R[i] * R[i]; c += 2; } return c ? 20 * Math.log10(Math.sqrt(s2 / c) + 1e-9) : -200; };
  const levels = { song: rms(rel('play') + 0.3, rel('new')), count: rms(rel('rec') + 0.3, rel('pass1')), taps: rms(rel('pass1'), rel('in')), band: rms(rel('band') + 0.3, rel('ask')), agent: rms(rel('picked') + 0.3, rel('end')) };
  return { L, R, levels, gain, clicks: nClicks };
}

export function wav(file, chans) {
  const n = chans[0].length, c = chans.length, buf = Buffer.alloc(44 + n * c * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * c * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(c, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * c * 2, 28); buf.writeUInt16LE(c * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * c * 2, 40);
  for (let i = 0, o = 44; i < n; i++) for (let ch = 0; ch < c; ch++, o += 2) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chans[ch][i] * 32767))), o);
  fs.writeFileSync(file, buf);
}
