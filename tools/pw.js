// Shared browser harness for Overdub's checks. Every *-test.js in tools/ uses this.
//
//   import { open } from './pw.js';
//   const { page, url, close, errors } = await open('/app/');      // starts its own server on a free port
//   ... await page.evaluate(() => window.overdub.store.get().tracks.length) ...
//   await close();
//
// Env: PLAYWRIGHT_CORE (path to playwright-core), CHROMIUM (a chromium or chrome-headless-shell binary),
// HEADED=1 (watch it), OUTDIR (screenshots; default tools/.out). Falls back to the copies already on this machine.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer, ready } from '../server/serve.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// The browser checks see the studio as a visitor without Claude Code would: the Agent panel offers Claude Code only
// when `claude` is on the PATH, so the machine running the checks would otherwise change what they see. A check about
// Claude Code points OVERDUB_CLAUDE at tools/fake-claude.js.
process.env.OVERDUB_CLAUDE ??= path.join(path.dirname(fileURLToPath(import.meta.url)), 'no-claude-here');

export const OUTDIR = process.env.OUTDIR || path.join(HERE, '.out');
fs.mkdirSync(OUTDIR, { recursive: true });

function findPlaywright() {
  const tries = [process.env.PLAYWRIGHT_CORE, 'playwright-core', path.join(os.homedir(), 'Code/xenobotany/node_modules/playwright-core')].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  throw new Error('playwright-core not found: set PLAYWRIGHT_CORE or `npm i --no-save playwright-core`');
}
function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const cands = [];
  if (fs.existsSync(base)) for (const d of fs.readdirSync(base)) {
    if (d.startsWith('chromium_headless_shell')) cands.push(path.join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'));
    if (d.startsWith('chromium-')) cands.push(path.join(base, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'), path.join(base, d, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'));
  }
  return cands.find((p) => fs.existsSync(p));
}

// Test browsers keep quiet on this machine's speakers: Chromium's --mute-audio silences only what reaches the speakers
// (the audio graph, its taps, captures and renders run as before). SOUND=1 lets a run be heard.
export const QUIET = process.env.SOUND ? [] : ['--mute-audio'];
// Text measures as it does on a Mac: Chromium on Linux hints fonts by default, which rounds each glyph's advance to a
// whole pixel, so a line of text comes out a few px wider and the checks that fit a bar or a panel to the window ran
// 2-16 px over on a Linux CI runner. No hinting is what macOS does anyway, so this changes nothing there.
export const TEXT = ['--font-render-hinting=none'];

// Open an absolute URL (production checks): same browser setup, no local server.
export async function openUrl(url, { width = 1440, height = 900, headed = !!process.env.HEADED } = {}) {
  const pw = findPlaywright();
  const args = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...QUIET, ...TEXT];
  const browser = await pw.chromium.launch({ headless: !headed, executablePath: headed ? undefined : findChromium(), args });
  const context = await browser.newContext({ viewport: { width, height }, permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  return { page, browser, context, url, errors, close: () => browser.close().catch(() => {}), shot: (name) => page.screenshot({ path: path.join(OUTDIR, name + '.png') }) };
}

// Open a page on a fresh server. Collects console errors and page errors in `errors` (fail your test on them).
export async function open(route = '/app/', { width = 1440, height = 900, headed = !!process.env.HEADED, fakeAudio = null, query = '' } = {}) {
  await ready;
  const srv = await startServer({ port: 0, quiet: true });
  const pw = findPlaywright();
  const args = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...QUIET, ...TEXT];
  if (fakeAudio) args.push(`--use-file-for-fake-audio-capture=${fakeAudio}`);
  const exe = headed ? undefined : findChromium();
  const browser = await pw.chromium.launch({ headless: !headed, executablePath: exe, args });
  const context = await browser.newContext({ viewport: { width, height }, permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = srv.url + route + (query ? (route.includes('?') ? '&' : '?') + query : '');
  await page.goto(url, { waitUntil: 'load' });
  const close = async () => { await browser.close().catch(() => {}); await srv.close(); };
  return { page, browser, context, url, base: srv.url, errors, close, shot: (name) => page.screenshot({ path: path.join(OUTDIR, name + '.png') }) };
}

// Tiny assertion helpers that print ok/FAIL lines and keep a tally.
export function tally(name) {
  let fails = 0, oks = 0;
  return {
    ok(cond, msg) { if (cond) { oks++; console.log('  ok   ' + msg); } else { fails++; console.log('  FAIL ' + msg); } return !!cond; },
    note(msg) { console.log('  ..   ' + msg); },
    done() { console.log(`${name}: ${oks} ok, ${fails} failed`); if (fails) process.exitCode = 1; return fails === 0; },
  };
}
