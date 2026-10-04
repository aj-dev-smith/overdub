// The landing page's demo film: a real session in the studio, filmed in Chromium, with captions and a soundtrack.
//   node tools/demo-video.js            -> site/assets/overdub-demo.mp4 (1280x720, H.264 + AAC) and overdub-demo-poster.webp
//
// The session is tools/demo-session.js (the social cuts film the same one): Night Shift plays ("Play over each
// other."); a new song, and Tap a beat on its blank sheet starts the first minute: the click, the ball, a bar of
// count-in, two passes tapped on the pads, each hit on the beat ruler and in the lane, the second layered over the
// first ("Tap a beat into the song."); the Band builds chords and bass around the beat ("Build a band around it.");
// the demo agent plays takes over the band's bass and one is kept ("The agent plays over you."); History signs every
// edit ("Every take is signed."); the end card. Captions are plates drawn in the page in the Liner notes look; the
// small lines under them are read from the studio as it is filmed.
// Frames come from the DevTools screencast (JPEG, with timestamps), at deviceScaleFactor 2 so the zoomed-in moments stay
// sharp. The soundtrack is what was on screen (see tools/demo-session.js).
// Needs ffmpeg (PATH or /opt/homebrew/bin/ffmpeg) and cwebp. Working files land in tools/.out/demo/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUTDIR } from './pw.js';
import { filmSession, soundtrack, wav } from './demo-session.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(OUTDIR, 'demo');
const FRAMES = path.join(WORK, 'frames');
const DEST_MP4 = path.join(ROOT, 'site/assets/overdub-demo.mp4');
const DEST_POSTER = path.join(ROOT, 'site/assets/overdub-demo-poster.webp');
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => fs.existsSync(p)) || 'ffmpeg';
const W = 1280, H = 720, FPS = 30, MAX_BYTES = 6 * 1024 * 1024;
fs.mkdirSync(WORK, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`  ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`, ...a);

// the camera: the layout-space region each scene fills the frame with (null: the whole studio)
const camera = {
  play: () => null,
  blank: () => null,
  tap: () => ({ x: 0, y: 0, w: 1000, h: 610 }),       // the top bar (the ball, the count), the lane, the beat ruler and pads
  band: () => ({ x: 0, y: 0, w: 1000, h: 610 }),
  arr: () => ({ x: 0, y: 0, w: 880, h: 400 }),        // the beat and its band in the arranger
  ask: () => ({ x: 520, y: 290, w: 760, h: 430 }),    // the agent's input
  cards: () => ({ x: 380, y: 52, w: 900, h: 534 }),   // its takes
  history: () => ({ x: 380, y: 64, w: 900, h: 508 }),
};

const take = await filmSession({ W, H, dsf: 2, camera, captions: 'film', laneBeats: 8, frames: FRAMES, log, length: 30 });
const { frames, marks, v0, dur, info, errors } = take;
const rel = (k) => marks[k] - v0;

/* ------------------------------------------------------------------ assemble */
const list = [];
await new Promise((r) => setTimeout(r, 300)); // let the last frame files land
for (let i = 0; i < frames.length; i++) {
  const d = (i + 1 < frames.length ? frames[i + 1].ts : marks.stop) - frames[i].ts;
  list.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
}
list.push(`file '${frames[frames.length - 1].file}'`);
fs.writeFileSync(path.join(WORK, 'frames.txt'), list.join('\n') + '\n');

const st = soundtrack(take, { fadeAt: rel('end') + 0.4 });
log('scene levels (dBFS RMS):', Object.entries(st.levels).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '), `; ${st.clicks} clicks, ${take.hits.length} hits`);
for (const [k, v] of Object.entries(st.levels)) if (k !== 'count' && v < -40) errors.push(`soundtrack: the ${k} scene is near silent (${v.toFixed(1)} dBFS)`);
const AUDIO = path.join(WORK, 'soundtrack.wav');
wav(AUDIO, [st.L, st.R]);

// encode: H.264 + AAC, yuv420p, faststart; step the quality down until it fits
let crf = 20;
for (;;) {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'frames.txt'), '-i', AUDIO,
    '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p`, '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-tune', 'animation',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', dur.toFixed(3), '-movflags', '+faststart', DEST_MP4]);
  const size = fs.statSync(DEST_MP4).size;
  log(`crf ${crf}: ${(size / 1048576).toFixed(2)} MB`);
  if (size <= MAX_BYTES || crf >= 32) break;
  crf += 2;
}
// the poster: the first minute, late in pass 2 (both passes on the ruler and in the lane), with its caption
// (from the JPEG frame itself, not the H.264, so it is as sharp as it can be; cwebp, as tools/shots.js uses)
const posterAt = Math.min(rel('in') - 0.3, rel('pass2') + 3.0);
const posterFrame = frames.filter((f) => f.ts <= v0 + posterAt).pop() || frames[0];
const posterPng = path.join(WORK, 'poster.png');
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', posterFrame.file, '-vf', `scale=${W}:${H}:flags=lanczos`, posterPng]);
execFileSync('cwebp', ['-quiet', '-q', '80', '-m', '6', posterPng, '-o', DEST_POSTER]);
for (const [k, v] of Object.entries(marks)) log(`mark ${k} @ ${(v - v0).toFixed(2)} s`);
fs.writeFileSync(path.join(WORK, 'take.json'), JSON.stringify({ marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, +(v - v0).toFixed(3)])), dur, info, levels: st.levels, states: take.states.length, hits: take.hits.length, clicks: st.clicks, errors }, null, 2));
log('info', JSON.stringify(info));
if (!process.env.KEEP_FRAMES) fs.rmSync(FRAMES, { recursive: true, force: true });   // ~350 MB of JPEGs
console.log(`demo-video: ${path.relative(ROOT, DEST_MP4)} ${dur.toFixed(1)} s, ${(fs.statSync(DEST_MP4).size / 1048576).toFixed(2)} MB; poster ${(fs.statSync(DEST_POSTER).size / 1024).toFixed(0)} KB`);
if (errors.length) { console.log('  page errors:\n    ' + errors.join('\n    ')); process.exitCode = 1; }
