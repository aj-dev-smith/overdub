// Real screenshots of the studio for the landing page. node tools/shots.js
//   studio.webp   the whole studio on Night Shift: arranger, the Guitar chain in Devices, the agent panel
//   rack.webp     the rack close up, ending on Claude's Tidal Cathedral (an agent-built device face)
//   sketch.webp   the Sketch panel after a (fake-mic) hum of A3 C4 E4: the spiral and the notes it wrote
//   history.webp  the History panel after a few edits by you and by Claude: warm is you, cool is the agent
// Each is written at 1440 and 960 wide (name.webp, name-960.webp) into site/assets/, and kept under ~400 KB.
// Needs ffmpeg or cwebp on PATH. Raw PNGs land in tools/.out/shots/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, OUTDIR } from './pw.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(OUTDIR, 'shots');
const DEST = path.join(ROOT, 'site/assets');
fs.mkdirSync(RAW, { recursive: true });

// A hummed A3, C4, E4 for the fake mic (the same phrase brand-test uses).
function humWav(file) {
  const sr = 48000,
    seq = [
      [57, 0.9],
      [null, 0.35],
      [60, 0.9],
      [null, 0.35],
      [64, 0.9],
      [null, 1.2],
    ];
  const total = seq.reduce((s, x) => s + x[1], 0),
    n = Math.round(sr * total);
  const pcm = new Int16Array(n);
  let i = 0,
    ph = 0;
  for (const [m, d] of seq) {
    const len = Math.round(sr * d),
      f = m ? 440 * 2 ** ((m - 69) / 12) : 0;
    for (let k = 0; k < len && i < n; k++, i++) {
      const env = Math.min(1, k / 800, (len - k) / 800);
      ph += (2 * Math.PI * f * (1 + 0.004 * Math.sin((2 * Math.PI * 5.5 * k) / sr))) / sr;
      pcm[i] = m
        ? Math.round((9000 * env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph))) / 1.5)
        : 0;
    }
  }
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n * 2, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sr, 24);
  wav.writeUInt32LE(sr * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n * 2, 40);
  Buffer.from(pcm.buffer).copy(wav, 44);
  fs.writeFileSync(file, wav);
  return total;
}

function encode(name, png) {
  const out = [];
  const pw = fs.readFileSync(png).readUInt32BE(16);
  for (const [suffix, w0] of [
    ['', 1440],
    ['-960', 960],
  ]) {
    if (suffix && pw <= w0) continue; // small crops ship at their own size only
    const w = Math.min(w0, pw);
    const dst = path.join(DEST, `${name}${suffix}.webp`);
    let q = 84;
    for (;;) {
      execFileSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-resize', String(w), '0', png, '-o', dst]);
      const kb = fs.statSync(dst).size / 1024;
      if (kb <= 400 || q <= 50) {
        out.push(`${path.basename(dst)} ${kb.toFixed(0)} KB`);
        break;
      }
      q -= 8;
    }
  }
  console.log('  ' + name + ': ' + out.join(', '));
}

async function boot(opts = {}, layout = null) {
  const s = await open('/app/', { width: 1440, height: 900, query: 'demo&agentfast', ...opts });
  // skip the first-visit welcome card; set the layout the shot wants
  await s.page.evaluate((l) => {
    localStorage.setItem('overdub:welcomed', '1');
    if (l) localStorage.setItem('overdub:layout', JSON.stringify(l));
  }, layout);
  await s.page.reload({ waitUntil: 'load' });
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await s.page.waitForTimeout(600);
  return s;
}
const shot = async (page, name, clip) => {
  const f = path.join(RAW, name + '.png');
  await page.screenshot({ path: f, clip });
  return f;
};

const errs = [];
// ---- (a) the whole studio, (b) the rack, (d) history
{
  const { page, browser, url, errors, close } = await boot(
    {},
    { leftW: 236, rightW: 400, bottomH: 330, open: { left: false, right: true, bottom: true }, tabs: {} },
  );
  // The demo agent (scripted, real tools) takes a turn so the agent panel shows real work. Optional: skip if it stalls.
  const said = await page
    .evaluate(async () => {
      const { agent, ui, store } = window.overdub;
      ui.show('agent');
      ui.select({ track: store.get().tracks.find((t) => t.name === 'Keys').id }); // "the keys" means the keys
      agent.useMock(true);
      const turn = agent.send('Make the keys a bit warmer');
      // it asks which "warmer" (two options): answer like a person would, so the turn finishes with the change made
      const pick = setInterval(() => {
        const b = document.querySelectorAll('.ag-opt')[0];
        if (b) {
          clearInterval(pick);
          b.click();
        }
      }, 300);
      turn.finally(() => clearInterval(pick));
      return Promise.race([turn.then(() => 'done'), new Promise((r) => setTimeout(() => r('timeout'), 25000))]);
    })
    .catch((e) => 'error ' + e.message);
  console.log('  demo agent turn: ' + said);
  await page.evaluate(() => {
    const { store, ui } = window.overdub;
    const g = store.get().tracks.find((t) => t.name === 'Guitar');
    ui.select({ track: g.id });
    ui.show('rack');
    ui.show('agent');
  });
  await page.waitForTimeout(900);
  encode('studio', await shot(page, 'studio'));

  // A few signed edits: yours and Claude's, as a session would leave them.
  await page.evaluate(() => {
    const { store } = window.overdub;
    const p = store.get();
    const t = (n) => p.tracks.find((x) => x.name === n);
    const g = t('Guitar'),
      keys = t('Keys'),
      bass = t('Bass');
    const cat = g.inserts.find((i) => i.device === 'claude.tidal-cathedral');
    store.dispatch([{ type: 'track.set', track: bass.id, patch: { gain: -2 } }], {
      by: 'you',
      label: 'Bass down 2 dB',
    });
    store.dispatch([{ type: 'track.set', track: keys.id, patch: { pan: -0.25 } }], {
      by: 'you',
      label: 'Keys a little left',
    });
    if (cat)
      store.dispatch([{ type: 'insert.set', track: g.id, insert: cat.id, patch: { on: true } }], {
        by: 'claude',
        label: 'Tidal Cathedral on the guitar',
        reason: 'You asked for underwater in a cathedral.',
      });
    store.dispatch([{ type: 'track.set', track: keys.id, patch: { gain: -1.5 } }], {
      by: 'claude',
      label: 'Keys down 1.5 dB under the hook',
      reason: 'The hook was 2 LU under the keys in the chorus.',
    });
    store.dispatch([{ type: 'track.set', track: g.id, patch: { pan: 0.3 } }], { by: 'you', label: 'Guitar right' });
    window.overdub.ui.show('history');
  });
  await page.waitForTimeout(600);
  encode(
    'history',
    await shot(
      page,
      'history',
      await page.evaluate(() => {
        const r = document.querySelector('.ew-region-right').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 640) };
      }),
    ),
  );
  // (b) the rack close up, at 2x so the device faces stay crisp
  {
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errs.push('pageerror: ' + e));
    await p2.goto(url, { waitUntil: 'load' });
    await p2.evaluate(() => {
      localStorage.setItem('overdub:welcomed', '1');
      localStorage.setItem(
        'overdub:layout',
        JSON.stringify({
          leftW: 236,
          rightW: 400,
          bottomH: 344,
          open: { left: false, right: false, bottom: true },
          tabs: {},
        }),
      );
    });
    await p2.reload({ waitUntil: 'load' });
    await p2.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    await p2.evaluate(() => {
      const { store, ui } = window.overdub;
      ui.select({ track: store.get().tracks.find((t) => t.name === 'Guitar').id });
      ui.show('rack');
    });
    await p2.waitForTimeout(900);
    const box = await p2.evaluate(() => {
      // the board under the rack's head (the pedals, from the input to the mixer), not a fixed offset into the dock
      const r = document.querySelector('.ew-region-bottom').getBoundingClientRect(),
        b = (
          document.querySelector('.rk-board') || document.querySelector('.ew-region-bottom')
        ).getBoundingClientRect();
      // 260 tall (the site and the press page state 1440 x 262), from just above the board, inside the dock
      const y = Math.max(r.y, Math.min(b.y - 4, r.bottom - 260));
      return { x: r.x, y, width: r.width, height: Math.min(260, r.bottom - y) };
    });
    encode('rack', await shot(p2, 'rack', box));
    await ctx2.close();
  }
  errs.push(...errors);
  await close();
}
// ---- (c) Sketch, after a hum through the fake mic
{
  const wav = path.join(RAW, 'hum.wav');
  const secs = humWav(wav);
  const { page, errors, close } = await boot(
    { fakeAudio: wav },
    { leftW: 236, rightW: 380, bottomH: 470, open: { left: false, right: true, bottom: true }, tabs: {} },
  );
  await page.evaluate(() => window.overdub.ui.show('sketch'));
  await page.waitForTimeout(300);
  const btn = page.getByRole('button', { name: 'Allow the mic and hum' });
  if (await btn.count()) await btn.first().click();
  else await page.keyboard.press('KeyH');
  // shoot once the last note is written but before Chromium's fake mic loops the file (its 1.2 s of trailing
  // silence): later, the next pass's A3 starts a fourth note the caption doesn't mention
  await page.waitForTimeout(Math.ceil((secs - 0.75) * 1000));
  encode(
    'sketch',
    await shot(
      page,
      'sketch',
      await page.evaluate(() => {
        const r = document.querySelector('.ew-region-bottom').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    ),
  );
  errs.push(...errors);
  await close();
}
if (errs.length) {
  console.log('  page errors: ' + errs.join(' | '));
  process.exitCode = 1;
}
