// AJ's path to an instrument, before docs/INSTRUMENTS-UX.md (2026-10-05): QUIET (tools/pw.js open: --mute-audio), a
// blank song in the simple view: Tap a beat, keep it, Hum it, where it lands, the Browser's Light Table, opening it.
// Not a check (run-all runs *-test.js only): it reproduces and screenshots. Variants by env: CLICKHEAD=1 (a click on
// the Drums header first), BEATBOX=1 (a hum into Tap it's mic), DRUMSEL=1 (Light Table clicked with Drums selected),
// W/H/TAG (a phone: W=390 H=844 TAG=phone). Screenshots: tools/.out/ux-instruments/before/<tag>-*.png
//   node tools/instruments-repro.js
import fs from 'node:fs';
import path from 'node:path';
import { open, OUTDIR } from './pw.js';
import { humWav } from './fake-wav.js';
const OUT = path.join(OUTDIR, 'ux-instruments', 'before');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a hummed line: C4 E4 G4 A4 G4 E4 D4 C4, 0.42 s each with a breath, a voice-ish tone, then silence (tools/fake-wav.js)
fs.mkdirSync(OUT, { recursive: true });
const wav = humWav(path.join(OUT, '..', 'hum.wav'));

const W = Number(process.env.W || 1440),
  H = Number(process.env.H || 900),
  tag = process.env.TAG || 'desk';
const { page, errors, close } = await open('/app/', { query: 'view=simple', width: W, height: H, fakeAudio: wav });
const shot = (n) => page.screenshot({ path: path.join(OUT, `${tag}-${n}.png`) });
const state = () =>
  page.evaluate(() => {
    const { store, input, ui, plugin } = window.overdub;
    return {
      tracks: store.get().tracks.map((t) => ({
        name: t.name,
        dev: t.instrument?.device,
        arm: !!t.arm,
        clips: t.clips.map((c) => ({ name: c.name, by: c.by, n: (c.notes || []).length })),
      })),
      sel: ui.state.selection.track && store.track(ui.state.selection.track)?.name,
      lands: input.recorder?.lands?.()?.name ?? null,
      plugin: plugin?.current?.name ?? null,
      view: ui.workspace?.view?.(),
    };
  });
const log = [];
const step = async (name, extra = {}) => {
  const s = await state();
  log.push({ step: name, ...extra, ...s });
  console.log(name, JSON.stringify({ ...extra, ...s }));
};
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(600);
  await shot('01-blank');
  await step('blank');
  // Tap a beat (the blank sheet's primary)
  await page.getByRole('button', { name: 'Tap a beat' }).click();
  await sleep(1500);
  await shot('02-tap-a-beat');
  await step('tap a beat');
  // the coach says: press R and tap along on F J K L
  await page.keyboard.press('r');
  await sleep(2300);
  for (let i = 0; i < 2; i++)
    for (const k of ['f', 'k', 'j', 'k', 'f', 'k', 'j', 'k']) {
      await page.keyboard.press(k);
      await sleep(250);
    }
  await shot('03-tapping');
  await step('tapping (R)');
  await page.keyboard.press('Space');
  await sleep(1200);
  await shot('04-kept');
  await step('tap kept (Space)');
  // the coach's next card offers "Play keys over it" / "Ask the demo agent"; AJ hums instead
  // stop the loop
  await page.evaluate(() => window.overdub.engine.stop?.());
  if (process.env.CLICKHEAD) {
    // a click on the Drums header (to look at it, to select it): in the simple view its R is put away, but the click arms it
    await page.locator('.ar-head[data-track] .ar-hname', { hasText: 'Drums' }).first().click();
    await sleep(400);
    await shot('04b-clicked-drums-header');
    await step('clicked the Drums header');
  }
  if (process.env.BEATBOX) {
    // still in Tap it: the first button in the foot is "Beatbox", the mic; hum into it
    await page.locator('button:visible', { hasText: 'Beatbox' }).first().click();
    await sleep(5000);
    await page
      .locator('button:visible', { hasText: /Stop|Beatbox/ })
      .first()
      .click();
    await sleep(1500);
    await shot('04c-hummed-into-beatbox');
    await step("hummed into Tap it's mic (Beatbox)", {
      takes: await page.evaluate(() =>
        [...document.querySelectorAll('.sk-acts, .sk-capline')].map((e) => e.textContent.trim()).filter(Boolean),
      ),
    });
  }
  // Hum it: Sketch's Hum mode
  await page.evaluate(() => window.overdub.input.emit('sketch:mode', 'hum'));
  await sleep(500);
  await shot('05-hum-mode');
  await step('hum mode');
  const onto = await page.evaluate(() =>
    [...document.querySelectorAll('.sk-recnote, .sk-onto, .sk-take, .sk-acts')]
      .map((e) => e.textContent.trim())
      .filter(Boolean),
  );
  // R in Hum it records the hum into the song (the path the strip offers)
  await page.keyboard.press('r');
  await sleep(9000);
  await shot('06-humming');
  await step('humming (R)', { onto });
  await page.keyboard.press('Space');
  await sleep(1500);
  await shot('07-hum-landed');
  await step('hum landed (R)');
  // Hum again with the Hum button, then look at its Keep
  const humBtn = page.locator('button.sk-hum:visible').first();
  await humBtn.click();
  await sleep(5000);
  await humBtn.click();
  await sleep(1200);
  const keepHum = await page.evaluate(() => {
    const a = document.querySelector('.sk-acts');
    const s = a?.querySelector('select');
    return {
      keep: a?.querySelector('.btn-go')?.textContent,
      dest: s ? s.options[s.selectedIndex]?.text : null,
      destVisible: !!s && !!s.getClientRects().length,
    };
  });
  await shot('08-hum-take');
  await step('hum take (button)', { keepHum });
  // the Browser: in the simple view it's put away; / reaches for it
  // "/" in the simple view: does it reach the browser?
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('/');
  await sleep(600);
  const slashWent = await page.evaluate(() => ({
    focus: document.activeElement?.className || document.activeElement?.tagName,
    browserShown: window.overdub.ui.workspace?.has?.('browser'),
  }));
  await shot('09a-slash');
  await step('slash', { slashWent });
  await page.keyboard.press('Escape');
  // More > Instruments and effects > Add (how AJ got the browser)
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await sleep(400);
  await page.locator('input[type=search]:visible').first().fill('instruments');
  await sleep(300);
  await shot('09b-more');
  await page.evaluate(() => {
    window.overdub.ui.workspace.add(['browser'], { by: 'you' });
    window.overdub.ui.show('browser');
    window.overdub.ui.setOpen('left', true);
  });
  await page.keyboard.press('Escape');
  await sleep(700);
  await page.evaluate(() => {
    const r = document.querySelector('.br-row[data-device="core.wavetable"]');
    r?.scrollIntoView({ block: 'center' });
  });
  await sleep(300);
  await sleep(500);
  const target = await page.evaluate(() => document.querySelector('.br-target')?.textContent);
  await shot('09-browser');
  await step('browser', { target });
  if (process.env.DRUMSEL) {
    await page.locator('.ar-head[data-track] .ar-hname', { hasText: 'Drums' }).first().click();
    await sleep(400);
  }
  await page.locator('.br-row[data-device="core.wavetable"]').first().click();
  await sleep(800);
  const toast = await page.evaluate(() =>
    [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '),
  );
  await shot('10-light-table-clicked');
  await step('clicked Light Table', { toast });
  // where's Light Table? the header names it; is it a control?
  const header = await page.evaluate(() =>
    [...document.querySelectorAll('.ar-head')].map((r) => ({
      text: r.textContent.replace(/\s+/g, ' ').trim(),
      devButtonVisible: !!r.querySelector('.ar-hdev')?.getClientRects().length,
      devNameVisible: !!r.querySelector('.ar-hdevname')?.getClientRects().length,
    })),
  );
  await shot('11-header');
  await step('header', { header });
  // the only way: More > Sound (devices), the Devices tab, the small Open
  const openBtn = await page.evaluate(() => {
    const b = document.querySelector('.rk-open');
    return b ? { visible: !!b.getClientRects().length } : null;
  });
  await page.evaluate(() => window.overdub.ui.show('rack'));
  await sleep(900);
  const openInfo = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.rk-open')].find((x) => x.getClientRects().length);
    if (!b) return null;
    const r = b.getBoundingClientRect(),
      cs = getComputedStyle(b);
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      font: cs.fontSize,
      x: Math.round(r.x),
      y: Math.round(r.y),
    };
  });
  await shot('12-devices-tab');
  await step('devices tab', { openBtnBefore: openBtn, openInfo });
  const ob = page.locator('.rk-open:visible').first();
  if (await ob.count()) {
    await ob.click();
    await sleep(1500);
  }
  await shot('13-light-table-open');
  await step('opened');
  fs.writeFileSync(path.join(OUT, `${tag}-log.json`), JSON.stringify({ log, errors }, null, 2));
  console.log('errors', errors.slice(0, 5));
} finally {
  await close();
}
