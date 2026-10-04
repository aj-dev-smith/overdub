// The social cuts of the landing page's 30-second film, for feeds that autoplay muted (X, Instagram, TikTok, LinkedIn).
//   node tools/demo-cuts.js                 -> every cut into site/assets/social/
//   node tools/demo-cuts.js vertical square -> just those (vertical, square, loop, gif)
//   REUSE=1 node tools/demo-cuts.js         -> recompose from the last filmed takes in tools/.out/cuts/ (no refilm)
//
// What it makes (each H.264 + AAC, yuv420p, +faststart, under ~8 MB, with a JPEG poster):
//   overdub-vertical.mp4  1080x1920  the film re-framed for Reels / TikTok / Shorts / X on a phone
//   overdub-square.mp4    1080x1080  the film for X, LinkedIn and the Instagram grid
//   overdub-loop.mp4      1080x1080  two bars (4 s at 120 bpm) that loop seamlessly: the Weave, then the tapped beat and
//                                    the band built around it in the arranger, then back to the Weave; for a pinned post
//   overdub-square.gif    600x338    a silent preview of the square cut, under 3 MB
//
// How: the session tools/demo-video.js films, from the same script (tools/demo-session.js): Night Shift plays; a new
// song, and Tap a beat starts the first minute (the click, the ball, the count-in, two passes tapped on the pads,
// the second layered over the first); the Band builds chords and bass around the beat; the demo agent plays takes
// over the band's bass and one is kept; History. (The screencast delivers frames at CSS-pixel size, 1280x720,
// whatever the device scale; the page renders at 2x and is sampled down, and the zoomed-in text stays crisp.) The
// difference is the camera: the in-page zoom aims each scene's important region into a fixed window (taller than
// 16:9), and that window is cropped out of every frame. Captions are not drawn in the studio: they are plates (the
// whole frame around the window, rendered in Chromium with the brand's own CSS and faces, in the Liner notes look)
// that ffmpeg lays under the window, so they sit above the picture, large, in Archivo ExtraBold Italic, and readable
// with the sound off from the first frame. The soundtrack is made the film's way (tools/demo-session.js).
// The end card and the loop's Weave are the landing page's living Weave (site/assets/weave.js), stepped frame by frame.
// Needs ffmpeg. Working files land in tools/.out/cuts/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, OUTDIR } from './pw.js';
import { filmSession, soundtrack, wav } from './demo-session.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(OUTDIR, 'cuts');
const DEST = path.join(ROOT, 'site/assets/social');
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => fs.existsSync(p)) || 'ffmpeg';
const FFPROBE = FFMPEG.replace(/ffmpeg$/, 'ffprobe');
const W = 1280, H = 720, DSF = 2, SR = 48000, FPS = 30;
const MAX_BYTES = 7.6 * 1024 * 1024, GIF_MAX = 2.9 * 1024 * 1024;
const URL_TEXT = 'overdub.ajsmithhq.com';
const BAR = 2;   // a bar at the session's 120 bpm (the new song the beat is tapped into)
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(DEST, { recursive: true });
const ff = (args) => {
  if (process.env.DEBUG_FF) console.log('ffmpeg', args.map((a) => (/[\s;\[]/.test(a) ? JSON.stringify(a) : a)).join(' '));
  try { return execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error('ffmpeg failed: ' + String(e.stderr || e.message).trim()); }
};
const probeDur = (f) => +execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2) + ' MB';
const t0 = Date.now();
const log = (...a) => console.log(`  ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);

/* ------------------------------------------------------------------ the formats
   win: the window in the 1280x720 studio that is cropped out (layout px, full height); video: where it lands in the
   frame. Each scene names the studio region that matters (layout px); the in-page zoom fits it into the window. */
const FORMATS = {
  vertical: {
    w: 1080, h: 1920, video: { x: 0, y: 664, w: 1080, h: 960 }, laneBeats: 12,   // bars 1-2 in the left 400 px of the lanes
    scenes: {
      play: () => ({ x: 0, y: 0, w: 620, h: 551 }),                   // the transport, the song, the playhead
      blank: () => ({ x: 150, y: 64, w: 580, h: 516 }),               // the blank sheet and its Tap a beat
      tap: () => ({ x: 0, y: 0, w: 700, h: 622 }),                    // the ball and the count, the lane, the beat ruler, the pads
      band: () => ({ x: 0, y: 0, w: 700, h: 622 }),
      arr: () => ({ x: 0, y: 0, w: 700, h: 622 }),                    // the beat and its band in the arranger
      ask: () => ({ x: 880, y: 430, w: 400, h: 290 }),                // the agent's input
      cards: () => ({ x: 880, y: 96, w: 400, h: 540 }),               // its takes
      history: () => ({ x: 880, y: 52, w: 400, h: 520 }),             // who wrote what
    },
  },
  square: {
    w: 1080, h: 1080, video: { x: 0, y: 296, w: 1080, h: 784 }, laneBeats: 10,
    scenes: {
      play: () => ({ x: 0, y: 0, w: 880, h: 639 }),
      blank: () => ({ x: 100, y: 64, w: 700, h: 508 }),
      tap: () => ({ x: 0, y: 0, w: 860, h: 624 }),
      band: () => ({ x: 0, y: 0, w: 860, h: 624 }),
      arr: () => ({ x: 0, y: 0, w: 860, h: 624 }),
      ask: () => ({ x: 640, y: 380, w: 640, h: 340 }),
      cards: () => ({ x: 520, y: 52, w: 760, h: 552 }),
      history: () => ({ x: 500, y: 52, w: 780, h: 566 }),
    },
  },
};
for (const f of Object.values(FORMATS)) {
  const ww = Math.round(H * f.video.w / f.video.h);
  f.win = { x: Math.round((W - ww) / 2), y: 0, w: ww, h: H };
}
function readWav(file) {
  const b = fs.readFileSync(file), c = b.readUInt16LE(22), n = (b.length - 44) / (2 * c), out = Array.from({ length: c }, () => new Float32Array(n));
  for (let i = 0, o = 44; i < n; i++) for (let ch = 0; ch < c; ch++, o += 2) out[ch][i] = b.readInt16LE(o) / 32767;
  return out;
}

/* ------------------------------------------------------------------ film one format's take of the session */
const LENGTH = 31.2;   // the end card runs a little longer than the film's
async function film(name) {
  const F = FORMATS[name], dir = path.join(WORK, name), FRAMES = path.join(dir, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const take = await filmSession({ W, H, dsf: DSF, win: F.win, camera: F.scenes, captions: false, laneBeats: F.laneBeats, frames: FRAMES, log: (...a) => log(name, ...a), length: LENGTH });
  const { frames, marks, v0, dur, info, errors, states, anchors, renders } = take;
  // assemble the frames (only the window, cropped at full resolution)
  await new Promise((r) => setTimeout(r, 400));
  const list = [];
  for (let i = 0; i < frames.length; i++) {
    const d = (i + 1 < frames.length ? frames[i + 1].ts : marks.stop) - frames[i].ts;
    list.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
  }
  list.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(dir, 'frames.txt'), list.join('\n') + '\n');
  const c = F.win, V = F.video;
  ff(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'),
    '-vf', `fps=${FPS},crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${V.w}:${V.h}:flags=lanczos,format=rgb24`,
    '-c:v', 'libx264rgb', '-preset', 'veryfast', '-crf', '4', '-t', dur.toFixed(3), path.join(dir, 'clean.mkv')]);
  // the soundtrack, exactly as the film builds it; the music holds under the end card, then fades over its last seconds
  const st = soundtrack(take, { fadeAt: marks.end - v0 + 0.6, tailFade: 0.1 });
  wav(path.join(dir, 'soundtrack.wav'), [st.L, st.R]);
  info.gain = st.gain; info.levels = st.levels;
  // the band on its own (the song the moment the band went in), for the loop cut, and where the transport was then
  const bandState = states.findIndex((x) => x.at >= marks.build - 0.05 && x.kind === 'do' && x.by === 'overdub');
  if (bandState >= 0 && renders[bandState]) wav(path.join(dir, 'band.wav'), [renders[bandState].L, renders[bandState].R]);
  const seek = anchors.filter((a) => a.at <= marks.band && a.playing).pop() || anchors[anchors.length - 1];
  const loop = states[bandState]?.loop?.on ? [states[bandState].loop.start, states[bandState].loop.end] : [0, 8];
  const relMarks = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, +(v - v0).toFixed(3)]));
  fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify({ marks: relMarks, dur, info, sync: { tempo: states[bandState]?.tempo || info.tempo, seek: { at: +(seek.at - v0).toFixed(4), beat: seek.beat }, loop }, errors }, null, 2));
  fs.rmSync(FRAMES, { recursive: true, force: true });
  log(name, `filmed ${dur.toFixed(1)} s, ${frames.length} frames; levels ${Object.entries(st.levels).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`, JSON.stringify(info));
  if (errors.length) console.log('  page errors:\n    ' + errors.join('\n    '));
}

/* ------------------------------------------------------------------ plates and cards, drawn in Chromium */
const CARD_HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/app/style/tokens.css"><link rel="stylesheet" href="/site/assets/site.css">
<style>
html, body { margin: 0; overflow: hidden; }
body { background: var(--bg); }
#root { position: relative; overflow: hidden; background: var(--bg); color: var(--text); }
/* (no grain: it does not survive H.264, and comes out as blotches round the type) */
.d { font-family: var(--font-display); font-style: italic; font-weight: 800; font-variation-settings: 'wdth' 125; font-stretch: 125%; letter-spacing: -.012em; }
.w { color: var(--human); } .c { color: var(--agent); }
.slate2 { font: 600 var(--slate, 26px)/1 var(--font-mono); color: var(--text-3); display: flex; gap: 18px; align-items: center; }
.cap { margin: 0; max-width: none; font-size: inherit; line-height: inherit; color: var(--text); text-wrap: balance; }
/* overprint: the site's own .over/.over-a/.over-b (site.css), the two passes stacked in one grid cell */
.cap.over { display: grid; }
.cap.over > span { grid-area: 1 / 1; }
.cap.over > .over-b { position: static; width: auto; }
.small { margin: 0; color: var(--text-2); font-family: var(--font-ui); font-weight: 600; }
.win { position: absolute; background: #000; }
.win::before, .win::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--line-2); }
.win::before { top: -2px; } .win::after { bottom: -2px; }
.lockup { display: flex; align-items: center; }
.weave { position: absolute; left: 0; }
/* vertical */
.vert .zone { position: absolute; left: 64px; right: 64px; top: 168px; height: 470px; display: flex; flex-direction: column; justify-content: flex-end; gap: 26px; }
.vert .cap { font-size: 92px; line-height: 1.02; }
.vert .cap.big { font-size: 118px; line-height: .98; }
.vert .small { font-size: 38px; line-height: 1.25; }
.vert .vfoot { position: absolute; left: 0; right: 0; top: 1660px; display: grid; justify-items: center; gap: 22px; }
.vert .vfoot .lockup { gap: 22px; } .vert .vfoot .mark { width: 92px; } .vert .vfoot .word { width: 330px; }
/* square */
.sq .zone { position: absolute; left: 52px; right: 52px; top: 34px; height: 236px; display: flex; flex-direction: column; justify-content: flex-end; gap: 14px; }
.sq .cap { font-size: 64px; line-height: 1.02; }
.sq .cap.big { font-size: 68px; }
.sq .small { font-size: 30px; line-height: 1.2; }
.sq .corner { position: absolute; right: 50px; top: 30px; width: 50px; }
.sq { --slate: 20px; }
/* end cards */
.endc { display: grid; justify-items: center; align-content: center; text-align: center; }
.endc .tag { margin: 0; color: var(--text); }
.endc .url { font: 600 var(--slate, 28px)/1 var(--font-mono); color: var(--text-3); }
</style></head><body><div id="root"></div>
<canvas id="wv" style="position: absolute; left: -5000px; top: 0;"></canvas>
<script type="module">
import { createWeave } from '/site/assets/weave.js';
let root = document.getElementById('root');
const wv = document.getElementById('wv');
const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
let weave = null, scale = 1, view = null;
window.__card = {
  async set(w, h, html) {
    // a fresh root each time: reusing one left the old background in the screenshot outside the repainted boxes
    const fresh = document.createElement('div'); fresh.id = 'root'; root.replaceWith(fresh); root = fresh;
    root.style.width = w + 'px'; root.style.height = h + 'px'; root.innerHTML = html;
    await document.fonts.ready;
    await Promise.all([...root.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
    view = root.querySelector('canvas.weave');
    if (view) {
      // the Weave at a phone's proportions (it sizes itself from its CSS box), drawn at the output's resolution
      // (weave.js draws at up to 2x, so the CSS box is half the output)
      const cw = view.width / 2, ch = view.height / 2;
      scale = 2;
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => scale });
      wv.style.width = cw + 'px'; wv.style.height = ch + 'px';
      weave = createWeave(wv); weave.demo(); weave.recolor(); weave.resize();
    }
    await frame();
  },
  // step the Weave to t seconds (it advances at most 0.1 s per call, so walk there)
  weaveAt(ms) { if (!weave) return; weave.frame(ms); const g = view.getContext('2d'); g.clearRect(0, 0, view.width, view.height); g.drawImage(wv, 0, 0, view.width, view.height); },
};
window.__cardReady = true;
</script></body></html>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const over = (txt, cls) => `<h2 class="cap d over ${cls || ''}"><span class="over-a">${txt}</span><span class="over-b" aria-hidden="true">${txt}</span></h2>`;
function plateHtml(fmt, p) {
  const F = FORMATS[fmt], V = F.video;
  const cap = p.hero ? over(p.cap, 'big') : `<h2 class="cap d">${p.cap}</h2>`;
  const small = p.small ? `<p class="small">${p.small}</p>` : '';
  const win = `<div class="win" style="left:${V.x}px; top:${V.y}px; width:${V.w}px; height:${V.h}px"></div>`;
  if (fmt === 'vertical') {
    return `<div class="vert" style="position:absolute; inset:0">${win}<div class="zone">${cap}${small}</div>
      <div class="vfoot"><div class="lockup"><img class="mark" src="/app/assets/logo.svg" alt=""><img class="word" src="/app/assets/wordmark.svg" alt=""></div><span class="slate2" style="justify-content:center">${URL_TEXT}</span></div></div>`;
  }
  return `<div class="sq" style="position:absolute; inset:0">${win}<img class="corner" src="/app/assets/logo.svg" alt=""><div class="zone">${cap}${small}</div></div>`;
}
// the end card: the line, the living Weave, the lockup and the address
function endHtml(fmt) {
  if (fmt === 'vertical') {
    return `<div class="endc" style="position:absolute; inset:0; gap: 0">
      <div style="position:absolute; left:64px; right:64px; top:250px; text-align:left; font-size:118px; line-height:.98">${over('Play over each&nbsp;other.', 'big')}</div>
      <canvas class="weave" width="1080" height="560" style="top:620px; width:1080px; height:560px"></canvas>
      <div style="position:absolute; left:0; right:0; top:1250px; display:grid; justify-items:center; gap:40px">
        <div class="lockup" style="gap:30px"><img src="/app/assets/logo.svg" style="width:150px" alt=""><img src="/app/assets/wordmark.svg" style="width:540px" alt=""></div>
        <p class="tag d" style="font-size:54px; line-height:1.15">A studio for <span class="w">you</span><br>and <span class="c">your agents</span>.</p>
        <span class="url">${URL_TEXT}</span></div></div>`;
  }
  return `<div class="endc sq" style="position:absolute; inset:0">
      <div style="position:absolute; left:52px; right:52px; top:60px; text-align:left; font-size:70px; line-height:1">${over('Play over each&nbsp;other.', 'big')}</div>
      <canvas class="weave" width="1080" height="460" style="top:250px; width:1080px; height:460px"></canvas>
      <div style="position:absolute; left:0; right:0; top:744px; display:grid; justify-items:center; gap:26px">
        <div class="lockup" style="gap:22px"><img src="/app/assets/logo.svg" style="width:96px" alt=""><img src="/app/assets/wordmark.svg" style="width:350px" alt=""></div>
        <p class="tag d" style="font-size:40px; line-height:1.15">A studio for <span class="w">you</span> and <span class="c">your agents</span>.</p>
        <span class="url" style="--slate:20px">${URL_TEXT}</span></div></div>`;
}

let cardSession = null;
async function cardPage(w, h) {
  if (!cardSession) {
    const s = await open('/site/index.html', { width: 1080, height: 1920 });
    await s.page.route('**/__cuts/card.html', (r) => r.fulfill({ contentType: 'text/html', body: CARD_HTML }));
    await s.page.goto(s.base + '/__cuts/card.html', { waitUntil: 'load' });
    await s.page.waitForFunction(() => window.__cardReady === true);
    cardSession = s;
  }
  await cardSession.page.setViewportSize({ width: w, height: h });
  return cardSession.page;
}
async function renderPlate(fmt, p, file) {
  const F = FORMATS[fmt], page = await cardPage(F.w, F.h);
  await page.evaluate(([w, h, html]) => window.__card.set(w, h, html), [F.w, F.h, plateHtml(fmt, p)]);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: F.w, height: F.h } });
}
// frames of a card with the living Weave on it, the Weave at tape times t0 + i / FPS
async function renderWeaveFrames(w, h, html, dir, n, startMs = 0) {
  const page = await cardPage(w, h);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(([a, b, c]) => window.__card.set(a, b, c), [w, h, html]);
  // walk the Weave's clock up to the start (it advances at most 0.1 s per frame)
  let ms = 0;
  await page.evaluate(() => window.__card.weaveAt(0));
  while (ms < startMs) { ms = Math.min(startMs, ms + 1000 / FPS); await page.evaluate((x) => window.__card.weaveAt(x), ms); }
  for (let i = 0; i < n; i++) {
    await page.evaluate((x) => window.__card.weaveAt(x), startMs + i * 1000 / FPS + 1);
    await page.screenshot({ path: path.join(dir, String(i).padStart(4, '0') + '.png'), clip: { x: 0, y: 0, width: w, height: h } });
  }
}

/* ------------------------------------------------------------------ the captions: what is on screen, in the engineer's voice */
function captions(fmt, take) {
  const m = take.marks, i = take.info;
  const bandLine = i.bandText ? i.bandText.replace(/ One undo takes it back\.$/, '') : '';
  const takes = i.takes || 3;
  const names = { 3: 'Three', 2: 'Two', 4: 'Four' };
  const v = fmt === 'vertical';
  const tap = 'Tap a beat into the&nbsp;song.';
  return [
    { at: 0, hero: true, cap: 'Play over each&nbsp;other.', small: 'A music studio for <span class="w">you</span> and <span class="c">your agents</span>.' },
    { at: m.new + 0.05, cap: tap, small: 'A new song. Tap a beat starts the loop and the click.' },
    { at: m.rec + 0.15, cap: tap, small: 'Counting in.' },
    { at: m.pass1 + 0.05, cap: tap, small: esc(i.recNote1 || 'Recording onto Drums, pass 1.') },
    { at: m.pass2 + 0.05, cap: tap, small: esc(i.recNote2 || 'Recording onto Drums, pass 2.') + (i.readout1 ? `<br>${esc(i.readout1)}` : '') },
    { at: m.in + 0.05, cap: tap, small: esc(i.beatText || '') },
    { at: m.z_band + 0.1, cap: 'Build a band around&nbsp;it.', small: esc(i.pickerNote || 'Adds tracks only. Your notes stay as they are.') },
    { at: m.band + 0.1, cap: 'Build a band around&nbsp;it.', small: esc(bandLine) },
    { at: m.z_ask + 0.3, cap: 'Ask <span class="c">your agent</span> to play over&nbsp;it.', small: 'In words. It works on what you select.' },
    { at: m.cards + 0.1, cap: '<span class="c">The agent</span> plays over&nbsp;<span class="w">you</span>.', small: `${names[takes] || takes} takes on the bass. You keep one.` },
    { at: Math.max(m.z_history + 0.3, m.history - 0.5), cap: 'Every take is&nbsp;signed.', small: '<span class="w">Warm is you</span>, <span class="c">cool is the agent</span>.' + (v ? ' Undo the agent’s change and yours stay.' : '') },
  ];
}

/* ------------------------------------------------------------------ compose a cut */
function encodeFinal(hq, out, { maxBytes = MAX_BYTES, audio = true, crf = 20 } = {}) {
  for (;;) {
    ff(['-i', hq, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-level', '4.1', '-x264-params', 'aq-mode=3', '-pix_fmt', 'yuv420p',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      ...(audio ? ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000'] : ['-an']), '-movflags', '+faststart', out]);
    const size = fs.statSync(out).size;
    log(`${path.basename(out)} crf ${crf}: ${mb(out)}`);
    if (size <= maxBytes || crf >= 34) return crf;
    crf += 2;
  }
}
// everything is composed in RGB and converted to video range BT.709 once, at the end, with the tags to say so
const toYuv = 'scale=out_range=tv:out_color_matrix=bt709,format=yuv444p';
const TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
async function compose(fmt) {
  const F = FORMATS[fmt], dir = path.join(WORK, fmt);
  const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  const caps = captions(fmt, take), dur = take.dur, tEnd = take.marks.end;
  const plates = [];
  for (let k = 0; k < caps.length; k++) {
    const file = path.join(dir, `plate-${k}.png`);
    await renderPlate(fmt, caps[k], file);
    plates.push({ file, at: caps[k].at });
  }
  const endDir = path.join(dir, 'end'), nEnd = Math.ceil((dur - tEnd) * FPS) + 2;
  await renderWeaveFrames(F.w, F.h, endHtml(fmt), endDir, nEnd, BAR * 1000 * 0.4);
  log(fmt, `${plates.length} plates, ${nEnd} end-card frames`);

  const inputs = ['-i', path.join(dir, 'clean.mkv'), '-i', path.join(dir, 'soundtrack.wav')];
  for (const p of plates) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(3), '-i', p.file);
  inputs.push('-framerate', String(FPS), '-i', path.join(endDir, '%04d.png'));
  const g = [];
  g.push(`[2:v]format=rgba[b0]`);
  for (let k = 1; k < plates.length; k++) {
    g.push(`[${k + 2}:v]format=rgba,fade=t=in:st=${plates[k].at.toFixed(3)}:d=0.28:alpha=1[p${k}]`);
    g.push(`[b${k - 1}][p${k}]overlay=format=rgb[b${k}]`);
  }
  const E = plates.length + 2;
  g.push(`[b${plates.length - 1}][0:v]overlay=${F.video.x}:${F.video.y}:eof_action=pass:format=rgb[v1]`);
  g.push(`[${E}:v]format=rgba,fade=t=in:st=0:d=0.5:alpha=1,setpts=PTS-STARTPTS+${tEnd.toFixed(3)}/TB[e]`);
  g.push(`[v1][e]overlay=eof_action=pass:format=rgb,${toYuv}[v]`);
  const hq = path.join(dir, 'hq.mp4');
  ff([...inputs, '-filter_complex', g.join(';'), '-map', '[v]', '-map', '1:a', '-r', String(FPS), '-t', dur.toFixed(3), '-af', 'volume=0.94',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '10', ...TAGS, '-c:a', 'pcm_s16le', '-f', 'matroska', hq]);
  const out = path.join(DEST, `overdub-${fmt}.mp4`);
  const crf = encodeFinal(hq, out);
  // the poster: the first minute late in pass 2, with its caption
  const posterAt = Math.min(take.marks.in - 0.3, take.marks.pass2 + 3.0);   // the first minute, both passes in
  ff(['-ss', posterAt.toFixed(3), '-i', hq, '-frames:v', '1', '-q:v', '2', path.join(DEST, `overdub-${fmt}-poster.jpg`)]);
  return { fmt, out, dur, crf, take };
}

/* ------------------------------------------------------------------ the loop: two bars, the Weave then the studio */
async function makeLoop() {
  const sq = path.join(WORK, 'square'), take = JSON.parse(fs.readFileSync(path.join(sq, 'take.json'), 'utf8'));
  const dir = path.join(WORK, 'loop'); fs.mkdirSync(dir, { recursive: true });
  const L = 2 * BAR, nL = Math.round(L * FPS), D = nL / FPS;     // 120 frames, 4 s
  const A = 1.75, X1 = 0.3, B = 1.55, X2 = D - A - X1 - B;      // weave, crossfade, studio, crossfade back
  // the Weave card: frames for weave time [-X2, A + X1); the loop starts X2 in, so its last crossfade lands on frame 0
  const html = `<div class="sq" style="position:absolute; inset:0">
    <div style="position:absolute; left:52px; right:52px; top:64px; font-size:70px; line-height:1">${over('Play over each&nbsp;other.', 'big')}</div>
    <canvas class="weave" width="1080" height="520" style="top:300px; width:1080px; height:520px"></canvas>
    <div style="position:absolute; left:0; right:0; top:860px; display:grid; justify-items:center; gap:22px">
      <div class="lockup" style="gap:20px"><img src="/app/assets/logo.svg" style="width:84px" alt=""><img src="/app/assets/wordmark.svg" style="width:300px" alt=""></div>
      <span class="url" style="font: 600 22px/1 var(--font-mono); color: var(--text-3)">${URL_TEXT}</span></div></div>`;
  const nW = Math.round((X2 + A + X1) * FPS) + 1;
  await renderWeaveFrames(1080, 1080, html, path.join(dir, 'weave'), nW, BAR * 1000 * 0.4);
  // the studio moment: the beat and its band in the arranger, from the square cut (caption and all), from once the
  // band's plate is up, ending before the camera leaves for the agent
  const from = Math.min(take.marks.band + 0.42, take.marks.z_ask - (X1 + B + X2) - 0.05);
  if (from < take.marks.band + 0.38) log(`loop: the band moment is short; its studio moment starts ${(from - take.marks.band).toFixed(2)} s after the band went in`);
  const hq = path.join(sq, 'hq.mp4');
  // music: the band's own loop (the beat and its band: two bars at 120 bpm), turned so that what plays under the
  // studio moment is what that picture was playing. Each pass carries the previous one's tail (as it does in the
  // studio), and any hair the video's frames are short of two bars is crossfaded at the top.
  const [sl, sr] = readWav(path.join(sq, 'band.wav'));
  const spb = 60 / take.sync.tempo, [la, lb] = take.sync.loop, beats = lb - la;
  const nLoop = Math.round(beats * spb * SR), n = Math.round(D * SR), xf = Math.round(0.02 * SR);
  const P = (src, k) => { k = ((k % nLoop) + nLoop) % nLoop; return (src[k] || 0) + (src[k + nLoop] || 0); };
  const beatAt = (t) => take.sync.seek.beat + (t - take.sync.seek.at) / spb;
  const p0 = Math.round((((beatAt(from - A) - la) % beats) + beats) % beats * spb * SR);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (const [ch, src] of [[0, sl], [1, sr]]) {
    for (let i = 0; i < n; i++) {
      let v = P(src, p0 + i);
      if (i < xf) v = v * (i / xf) + P(src, p0 + n + i) * (1 - i / xf);   // the end of the last pass into the top
      out[ch][i] = v;
    }
  }
  // the level the cut's soundtrack gave the band (its gain and its one master ride), a touch under, never over -1 dBFS
  let peak = 0; for (const c of out) for (const v of c) peak = Math.max(peak, Math.abs(v));
  const g = Math.min((take.info.gain || 1) * Math.pow(10, (take.info.ride || 0) / 20) * 0.92, peak > 0 ? 0.89 / peak : 1);
  for (const c of out) for (let i = 0; i < n; i++) c[i] *= g;
  const AUD = path.join(dir, 'loop.wav'); wav(AUD, out);
  // weave frames: index 0 is weave time -X2 relative to loop start
  const wd = path.join(dir, 'weave', '%04d.png');
  const gr = [
    // W1: weave from loop time 0 (frame X2*FPS) for A + X1
    `[0:v]trim=start_frame=${Math.round(X2 * FPS)}:end_frame=${Math.round((X2 + A + X1) * FPS)},setpts=PTS-STARTPTS,fps=${FPS},settb=1/${FPS},${toYuv}[w1]`,
    `[1:v]trim=start=${from.toFixed(3)}:duration=${(X1 + B + X2).toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},settb=1/${FPS},format=yuv444p[st]`,
    // W0: weave from -X2 for X2 (the way back in)
    `[2:v]trim=start_frame=0:end_frame=${Math.round(X2 * FPS)},setpts=PTS-STARTPTS,fps=${FPS},settb=1/${FPS},${toYuv}[w0]`,
    `[w1][st]xfade=transition=fade:duration=${X1}:offset=${A.toFixed(3)}[a]`,
    `[a][w0]xfade=transition=fade:duration=${X2.toFixed(3)}:offset=${(A + B + X1 - 0.0001).toFixed(3)},trim=end=${((nL - 0.5) / FPS).toFixed(4)}[v]`,
  ];
  const hqLoop = path.join(dir, 'hq.mp4');
  ff(['-framerate', String(FPS), '-i', wd, '-i', hq, '-framerate', String(FPS), '-i', wd, '-i', AUD, '-filter_complex', gr.join(';'),
    '-map', '[v]', '-map', '3:a', '-fps_mode', 'passthrough', '-frames:v', String(nL), '-t', D.toFixed(4), '-c:v', 'libx264', '-preset', 'fast', '-crf', '10', ...TAGS, '-c:a', 'pcm_s16le', '-f', 'matroska', hqLoop]);
  const dest = path.join(DEST, 'overdub-loop.mp4');
  const crf = encodeFinal(hqLoop, dest, { maxBytes: 4 * 1024 * 1024, crf: 18 });
  ff(['-ss', '1.0', '-i', hqLoop, '-frames:v', '1', '-q:v', '2', path.join(DEST, 'overdub-loop-poster.jpg')]);
  return { fmt: 'loop', out: dest, dur: D, crf };
}

/* ------------------------------------------------------------------ the GIF: a silent preview of the square cut, 600x338 */
async function makeGif() {
  const dir = path.join(WORK, 'gif'); fs.mkdirSync(dir, { recursive: true });
  const side = path.join(dir, 'side.png');
  const page = await cardPage(600, 338);
  await page.evaluate(([w, h, html]) => window.__card.set(w, h, html), [600, 338, `<div style="position:absolute; inset:0; padding: 0 0 0 26px; width: 262px; display:grid; align-content:center; gap: 16px">
    <div class="lockup" style="gap:9px"><img src="/app/assets/logo.svg" style="width:40px" alt=""><img src="/app/assets/wordmark.svg" style="width:150px" alt=""></div>
    <p class="d" style="margin:0; font-size:23px; line-height:1.08; color: var(--text)">Play over each&nbsp;other.</p>
    <p style="margin:0; font: 600 14px/1.4 var(--font-ui); color: var(--text-2)">A music studio for <span class="w">you</span> and <span class="c">your agents</span>.</p>
    <span style="font: 600 12px/1 var(--font-mono); color: var(--text-3)">${URL_TEXT}</span></div>`]);
  await page.screenshot({ path: side, clip: { x: 0, y: 0, width: 600, height: 338 } });
  const src = path.join(WORK, 'square', 'hq.mp4'), out = path.join(DEST, 'overdub-square.gif');
  for (const [fps, colors] of [[10, 128], [8, 96], [6, 64], [5, 48]]) {
    ff(['-loop', '1', '-i', side, '-i', src, '-filter_complex',
      `[1:v]fps=${fps},scale=338:338:flags=lanczos[s];[0:v][s]overlay=262:0:shortest=1,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0', out]);
    log(`gif ${fps} fps, ${colors} colours: ${mb(out)}`);
    if (fs.statSync(out).size <= GIF_MAX) break;
  }
  return { fmt: 'gif', out };
}

/* ------------------------------------------------------------------ run */
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const all = ['vertical', 'square', 'loop', 'gif'];
const todo = want.length ? want : all;
const done = [];
try {
  for (const fmt of ['vertical', 'square']) {
    if (!todo.includes(fmt) && !(fmt === 'square' && (todo.includes('loop') || todo.includes('gif')) && !fs.existsSync(path.join(WORK, 'square', 'hq.mp4')))) continue;
    if (!process.env.REUSE || !fs.existsSync(path.join(WORK, fmt, 'take.json'))) await film(fmt);
    done.push(await compose(fmt));
  }
  if (todo.includes('loop')) done.push(await makeLoop());
  if (todo.includes('gif')) done.push(await makeGif());
} finally {
  if (cardSession) await cardSession.close();
}
for (const d of done) console.log(`demo-cuts: ${path.relative(ROOT, d.out)} ${probeDur(d.out).toFixed(2)} s, ${mb(d.out)}`);
