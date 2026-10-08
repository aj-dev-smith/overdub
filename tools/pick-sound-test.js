// Picking a sound (docs/INSTRUMENTS-UX.md, section 6.1): a new idea is a new track, and you pick its sound by hearing it.
// Twenty-one checks, numbered as the spec numbers them (21 is the sampled sounds' first try); each is a section, so one that throws fails with its reason and the
// rest still run. QUIET: tools/pw.js open() launches Chromium with --mute-audio. The fake mic is tools/fake-wav.js's
// (the hummed line AJ's repro uses, a 4-bar one, and a beatbox: noise bursts on the beat).
//
// Node, no browser:
//   1  kindOfTake: a hum is a hum in any register; bass, chords, drums
//   2  soundsFor: the hum set, a missing device's fallback, the current sound first, no duplicate preset; every id and
//      preset in SOUND_SETS is a real device
//   3  newPartFor: Melody (Lamp Tines), then Melody 2
//   4  the aim, simple view (in the page, with real commits): a hum with Drums selected makes a track, the next goes
//      onto it; 'new' is one-shot; a newer selection wins; Onto Drums; pads onto the only kit; a stacked take and the
//      "own track" offer; full studio: the armed track, 'new' disarms, arming clears the choice, no first-pitched fallback
// Browser, ?view=simple, clean storage:
//   5  AJ's path: Tap a beat, R, taps, Space; Hum it, R, Space: a new Melody, selected, in the heard key, the card up
//   6  trials: ↓ previews (no History), Back, Keep (one entry, no audition flag, its label), ⌘Z, held ↓ debounced
//   7  what ends a trial: an agent tool that reads the song, R (kept first), another track, an undo, a click outside
//   8  the leftover heal: overdub:sound-trying, reload
//   9  the Sketch card on a hum that landed by itself (capture-timing): ↓ tries a sound on its Melody, Keep is one step
//  10  the header: .ar-hinst opens the instrument big, Sounds and pending, a held instrument, .ar-hdev in the full studio
//  11  the browser: a mismatch asks, a click tries, drops keep
//  12  musical typing after Tap a beat makes Keys and sounds there
//  13  suggest_sounds: signed rows, Keep by you with reason, refusals, listed with no tab open
//  14  the demo agent: "what should this sound like"
//  15  the coach's Hum over it: 8 bars, click off, Onto a new track, a 4-bar hum is one clip
//  16  the Beatbox catch: a tune offers Make it a melody; a beat raises nothing
//  17  time to a pretty sound: at most 4 actions, from the blank song and from the beat card
//  18  liner notes: no stripes, no pills, bylines, one primary, the .sel row's ink
//  19  phone: 44 px rows, the sheet in the viewport, pinned Keep/Back, a tap above doesn't close it
//  20  full studio: no card by itself; the toast line and the pending Sounds
//  21  a sampled sound on a slow network (every kit held 3 s by a route): the card's rows start their samples coming
//      when shown; a tried row says Loading on the row, the track's header and the status line; the take waits and
//      plays from its first note once they're in; the browser starts a kit on hover; a key pressed while one loads
//      sounds once it's in
//   node tools/pick-sound-test.js      (screenshots: tools/.out/pick-sound-*.png; SECTIONS=21 runs just those)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { open, tally, OUTDIR } from './pw.js';
import { humWav, beatboxWav, HUM_NOTES } from './fake-wav.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = tally('pick-sound');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) =>
  /favicon|ERR_CONNECTION|net::|AudioContext was not allowed|fonts\.g|Failed to load resource|getUserMedia|NotAllowedError|NotFoundError/i.test(
    e,
  );
const ONLY = process.env.SECTIONS ? new Set(process.env.SECTIONS.split(',')) : null; // SECTIONS=6,21: just those
const section = async (name, fn) => {
  if (ONLY && !ONLY.has(name.split(' ')[0])) return;
  try {
    await fn();
  } catch (e) {
    T.ok(
      false,
      `${name}: ran to the end (${String((e && e.stack) || e)
        .split('\n')
        .slice(0, 3)
        .join(' ')})`,
    );
  }
};
const WAVS = path.join(OUTDIR, 'pick-sound');
const HUM = humWav(path.join(WAVS, 'hum.wav'));
const HUM4 = humWav(path.join(WAVS, 'hum-4bars.wav'), {
  notes: [60, 64, 67, 69, 67, 64, 62, 60, 64, 67, 69, 72, 69, 67, 64, 60],
  dur: 0.42,
  gap: 0.08,
  tail: 4,
}); // 16 notes, 8 s: 4 bars at 120
const BEATBOX = beatboxWav(path.join(WAVS, 'beatbox.wav'));
const HUM_KEY_PCS = new Set([0, 2, 4, 5, 7, 9, 11]); // the hummed line is C major (or A minor): every pitch class in it

/* ======================================================================== Node */
const reg = await import('../app/src/devices/registry.js');
await import('../app/src/devices/builtin/index.js');
await import('../app/src/devices/library/index.js').catch(() => null);
const sounds = await import('../app/src/core/sounds.js').catch((e) => ({ _missing: e.message }));
const N = (spec) => spec.map(([p, t, d]) => ({ p, t, d, v: 0.8 }));
const line = (ps) => N(ps.map((p, i) => [p, i, 0.9]));

await section('1 kindOfTake', async () => {
  const k = sounds.kindOfTake;
  T.ok(
    typeof k === 'function',
    `1: core/sounds.js exports kindOfTake${sounds._missing ? ` (${sounds._missing})` : ''}`,
  );
  if (typeof k !== 'function') return;
  const chords = N(
    [0, 1, 2, 3].flatMap((b) => [
      [60, b, 1],
      [64, b, 1],
      [67, b, 1],
    ]),
  );
  const got = {
    hum: k({ kind: 'notes', src: 'hum', notes: line(HUM_NOTES) }),
    low: k({ kind: 'notes', src: 'hum', notes: line([45, 47, 48, 47, 45]) }),
    bass: k({ kind: 'notes', src: 'keys', notes: line([36, 38, 40, 43]) }),
    chords: k({ kind: 'notes', src: 'keys', notes: chords }),
    drums: k({ kind: 'drums', src: 'tap', notes: line([36, 38, 36, 38]) }),
  };
  T.ok(
    got.hum === 'hum' && got.low === 'hum' && got.bass === 'bass' && got.chords === 'chords' && got.drums === 'drums',
    `1: a hummed C4-A4 line is hum, a hummed A2-C3 line is hum too, a played line under C3 bass, three notes a beat chords, a tapped beat drums (${JSON.stringify(got)})`,
  );
});

await section('2 soundsFor', async () => {
  const sf = sounds.soundsFor;
  T.ok(
    typeof sf === 'function' && sounds.SOUND_SETS && typeof sounds.familyOf === 'function',
    '2: core/sounds.js exports soundsFor, familyOf and SOUND_SETS',
  );
  if (typeof sf !== 'function') return;
  const hum = { kind: 'notes', src: 'hum', notes: line(HUM_NOTES) };
  const has = (id) => !!reg.getDevice(id);
  const ids = (rows) => rows.map((r) => r.device + (r.preset ? `:${r.preset}` : ''));
  const a = sf(hum, { has });
  const b = sf(hum, { has: (id) => id !== 'claude.choir-loft' && has(id) });
  const c = sf(hum, { has, current: 'core.wavetable' });
  const d = sf({ kind: 'drums', src: 'tap', notes: [] }, { has, current: 'core.drums', currentPreset: 'Studio kit' });
  T.ok(
    ids(a).join() === 'core.keys,core.wavetable,core.strings,claude.choir-loft',
    `2: the hum set is Lamp Tines, Light Table, Music Stands, Choir Loft (${ids(a).join(', ')})`,
  );
  T.ok(
    b.length === 4 && b[3].device === 'core.mallets',
    `2: without Choir Loft the fourth is Mallet Bag (${ids(b).join(', ')})`,
  );
  T.ok(
    c.length === 4 &&
      c[0].device === 'core.wavetable' &&
      c.filter((r) => r.device === 'core.wavetable' && !r.preset).length === 1,
    `2: the current sound comes first, once, and there are still four (${ids(c).join(', ')})`,
  );
  T.ok(
    d.filter((r) => r.device === 'core.drums' && /^studio kit$/i.test(r.preset || '')).length +
      d.filter((r) => r.device === 'core.drums' && !r.preset).length <=
      1,
    `2: Gobo Kit on Studio kit isn't listed twice (${ids(d).join(', ')})`,
  );
  T.ok(
    [a, b, c, d].flat().every((r) => typeof r.family === 'string' && r.family.length > 1),
    '2: every row has a family word',
  );
  // the sampled instruments are offered where they fit: Parlour Upright for played lines and chords, Virtuosity Kit for a beat
  const pl = sf({ kind: 'notes', src: 'qwerty', notes: line([60, 62, 64, 65]) }, { has });
  const ch = sf('chords', { has }),
    dr = sf({ kind: 'drums', src: 'tap', notes: [] }, { has });
  const noKit = sf({ kind: 'drums', src: 'tap', notes: [] }, { has: (id) => id !== 'core.drumroom' && has(id) });
  T.ok(
    ids(pl)[1] === 'core.upright' &&
      ids(ch)[1] === 'core.upright' &&
      ids(dr)[1] === 'core.drumkit' &&
      !ids(sf(hum, { has })).includes('core.upright') &&
      ids(noKit)[3] === 'core.brushkit' &&
      sounds.SOUND_SETS.drums.fallbacks.some((r) => r.device === 'core.handkit'),
    `2: the sampled instruments are offered: Parlour Upright second for what you played (${ids(pl).join(', ')}) and for chords (${ids(ch).join(', ')}), Virtuosity Kit second for a beat (${ids(dr).join(', ')}), Rusty Brushes the first fallback and Hand Crate among them (${ids(noKit).join(', ')}); a hum keeps the voices that sing`,
  );
  // every device and preset the sets name is real: walk SOUND_SETS whatever its shape
  const named = [];
  const walk = (x, depth = 0) => {
    if (depth > 6 || x == null) return;
    if (typeof x === 'string') {
      if (/^(core|claude|pedal|amp)\.[a-z0-9-]+$/.test(x)) named.push({ device: x });
      return;
    }
    if (Array.isArray(x)) {
      x.forEach((y) => walk(y, depth + 1));
      return;
    }
    if (typeof x === 'object') {
      if (typeof x.device === 'string') named.push({ device: x.device, preset: x.preset });
      else for (const v of Object.values(x)) walk(v, depth + 1);
    }
  };
  walk(sounds.SOUND_SETS);
  const bad = named.filter(({ device, preset }) => {
    const def = reg.getDevice(device);
    return (
      !def ||
      def.kind !== 'instrument' ||
      (preset && !(def.presets || []).some((p) => p.name.toLowerCase() === String(preset).toLowerCase()))
    );
  });
  T.ok(
    named.length >= 20 && !bad.length,
    `2: all ${named.length} devices and presets in SOUND_SETS are instruments in the registry${bad.length ? ' (not: ' + bad.map((x) => x.device + (x.preset ? ` "${x.preset}"` : '')).join(', ') + ')' : ''}`,
  );
});

await section('3 newPartFor', async () => {
  const np = sounds.newPartFor;
  T.ok(typeof np === 'function', '3: core/sounds.js exports newPartFor');
  if (typeof np !== 'function') return;
  const { createStore } = await import('../app/src/core/store.js');
  const s = createStore(null, { getDevice: reg.getDevice });
  const a = np('hum', s.get());
  s.dispatch({ type: 'track.add', track: { name: 'Melody', instrument: { device: 'core.keys' } } }, { by: 'you' });
  const b = np('hum', s.get());
  const k = np('keys', s.get()),
    p = np('pads', s.get());
  T.ok(
    a?.name === 'Melody' &&
      a.device === 'core.keys' &&
      b?.name === 'Melody 2' &&
      k?.name === 'Keys' &&
      p?.name === 'Drums' &&
      p.device === 'core.drums',
    `3: a hum's new track is Melody (Lamp Tines), then Melody 2; keys make Keys, pads Drums (${JSON.stringify({ a, b, k, p })})`,
  );
});

await section('13 the tool, Node', async () => {
  const tools = await import('../app/src/agent/tools.js');
  const extra = await import('../app/src/agent/extra-schemas.js');
  const cat = await tools.catalogSchemas();
  const S = extra.SUGGEST_SOUNDS_SCHEMA;
  T.ok(
    cat.length === 40 &&
      cat.some((x) => x.name === 'suggest_sounds') &&
      extra.EXTRA_SCHEMAS.includes(S) &&
      S.annotations?.readOnlyHint === false &&
      S.annotations?.destructiveHint === false,
    `13: suggest_sounds is the catalog's 40th tool, from extra-schemas.js, neither read-only nor destructive (${cat.length} tools)`,
  );
  // with no tab open: server/mcp.js lists it
  // (on a free port of its own: mcp.js starts the studio server there, finds no tab and lists the whole catalog)
  const port = await new Promise((res, rej) => {
    const v = net.createServer();
    v.on('error', rej);
    v.listen(0, '127.0.0.1', () => {
      const n = v.address().port;
      v.close(() => res(n));
    });
  });
  const child = spawn(process.execPath, [path.join(HERE, '../server/mcp.js')], {
    env: { ...process.env, OVERDUB_URL: `http://127.0.0.1:${port}`, OVERDUB_NO_OPEN: '1', OVERDUB_OPEN_WAIT: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    out += d;
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pick-sound-test', version: '1' } },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  let listed = null;
  for (let i = 0; i < 300 && !listed; i++) {
    await sleep(100);
    for (const l of out.split('\n')) {
      try {
        const m = JSON.parse(l);
        if (m.id === 2 && m.result) listed = m.result.tools;
      } catch (e) {
        /* partial */
      }
    }
  }
  child.kill();
  T.ok(
    Array.isArray(listed) && listed.some((x) => x.name === 'suggest_sounds' && x.annotations?.title),
    `13: server/mcp.js lists suggest_sounds with no tab open (${listed ? listed.length + ' tools' : 'no answer'})`,
  );
});

/* ======================================================================== the studio */
const s = await open('/app/', { query: 'view=simple', width: 1440, height: 900, fakeAudio: HUM });
const pages = [];
// a fresh context (clean storage) on the same server; mic: which wav the fake mic plays is per browser, so a check that
// needs another sound opens its own browser
async function fresh({
  w = 1440,
  h = 900,
  query = 'view=simple',
  mobile = false,
  init = null,
  browser = s.browser,
  base = s.base,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    permissions: ['microphone'],
    ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}),
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.stack) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  const go = async (q = query) => {
    await page.goto(base + '/app/' + (q ? '?' + q : ''), { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await sleep(600);
  };
  await go();
  const P = {
    page,
    ctx,
    errors,
    go,
    E: (fn, a) => page.evaluate(fn, a),
    shot: (n) => page.screenshot({ path: path.join(OUTDIR, `pick-sound-${n}.png`) }).catch(() => {}),
    until: (fn, a, ms = 8000) =>
      page
        .waitForFunction(fn, a, { timeout: ms })
        .then(() => true)
        .catch(() => false),
  };
  pages.push(P);
  return P;
}
// what the checks read, in the page
const STATE = () => {
  const o = window.overdub,
    p = o.store.get(),
    sel = o.ui.state.selection.track;
  const tr = o.sounds?.trying?.() || null,
    cur = o.sounds?.current || null;
  const dev = (id) => o.devices.getDevice(id)?.name || id;
  return {
    tracks: p.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      dev: t.instrument?.device,
      arm: !!t.arm,
      clips: t.clips.map((c) => ({
        start: c.start,
        length: c.length,
        take: c.take || null,
        mute: !!c.mute,
        n: (c.notes || []).length,
        ps: (c.notes || []).map((x) => x.p),
      })),
    })),
    sel: sel && p.tracks.find((t) => t.id === sel)?.name,
    hist: o.store.history.length,
    last: o.store.history.at(-1) && {
      by: o.store.history.at(-1).by,
      label: o.store.history.at(-1).label,
      audition: !!o.store.history.at(-1).audition,
      reason: o.store.history.at(-1).reason || '',
    },
    trying: tr && { track: tr.track, device: tr.device, newTrack: !!tr.newTrack },
    card: cur && {
      track: cur.track,
      from: cur.from,
      rows: (cur.rows || []).map((r) => r.name || (r.preset ? `${dev(r.device)}, ${r.preset}` : dev(r.device))),
    },
    focus: document.activeElement?.closest?.('.ledger-row')?.textContent?.trim() || null,
    status: [...document.querySelectorAll('[role=status]')].map((x) => x.textContent.trim()).filter(Boolean),
    toasts: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent.trim()),
    playing: !!o.engine.playing,
  };
};
// Hum it in your own time on a blank song: Sketch's Hum is on screen under the door in the studio's default layout;
// when it isn't, the door's Hum a tune, then "No beat; I'll hum freely" (ui/start.js). -> the presses it took
const humIt = async (P) => {
  if (
    await P.E(
      () => !!window.overdub.ui.isOpen?.('bottom') && !!document.querySelector('.sk-hum')?.getClientRects().length,
    )
  )
    return 0;
  await P.page.getByRole('button', { name: 'Hum a tune' }).click();
  await sleep(300);
  await P.page.getByRole('button', { name: 'No beat; I’ll hum freely' }).click();
  return 2;
};
const tapABeat = async (P) => {
  await P.page.getByRole('button', { name: 'Tap a beat' }).click();
  // (on a blank song Tap a beat opens Start a song's stage, ui/start.js: "Play to a click instead" is the first minute,
  // R to record, as this path has always been)
  await sleep(300);
  if (await P.E(() => !!window.overdub.start?.step))
    await P.page.getByRole('button', { name: 'Play to a click instead' }).click();
  await sleep(1500);
  await P.page.keyboard.press('r');
  await sleep(2300);
  for (let i = 0; i < 2; i++)
    for (const k of ['f', 'k', 'j', 'k', 'f', 'k', 'j', 'k']) {
      await P.page.keyboard.press(k);
      await sleep(250);
    }
  await P.page.keyboard.press('Space');
  await sleep(1200);
  await P.E(() => window.overdub.engine.stop?.());
};
// R in Hum it with the fake mic humming, for `secs`, then Space
const humTake = async (P, secs = 5) => {
  await P.E(() => {
    const o = window.overdub;
    o.ui.show('sketch');
    o.input.emit('sketch:mode', 'hum');
    o.input.recorder.setCountIn?.(0);
  });
  await sleep(400);
  await P.page.keyboard.press('r');
  await sleep(secs * 1000);
  await P.page.keyboard.press('Space');
  await P.until(() => window.overdub.input.recorder.state === 'idle', null, 8000);
  await sleep(1200);
};
const previewsOf = (P) =>
  P.E(() => {
    const o = window.overdub;
    o.__pv = 0;
    o.store.on('change', (e) => {
      if (e.kind === 'preview' && (e.ops || []).some((x) => x.type === 'instrument.set' && !x._restore)) o.__pv++;
    });
  });

try {
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });

  /* ---------------------------------------------------------------- 4: the aim, in the page */
  await section('4 the aim', async () => {
    const P = await fresh();
    const r = await P.E(async () => {
      const o = window.overdub,
        rec = o.input.recorder,
        st = o.store;
      const out = {};
      if (typeof rec.aim !== 'function' || typeof rec.setAim !== 'function') return { missing: true };
      const name = (id) => st.get().tracks.find((t) => t.id === id)?.name ?? null;
      const aimName = (k) => {
        const a = rec.aim(k);
        return a.track ? name(a.track) : 'new';
      };
      // a hum committed: notes on the grid from bar `bar`, then stop
      const hum = async (bar = 1, ps = [60, 64, 67]) => {
        o.engine.seek((bar - 1) * 4);
        // a hum take, as Hum it's R makes one, without the mic: the notes come in below
        const start = o.input.hum.start;
        o.input.hum.start = async () => {};
        try {
          await rec.record({ countIn: 0, quantize: false, hum: true });
        } finally {
          o.input.hum.start = start;
        }
        rec.addNotes(
          ps.map((p, i) => ({ p, g: (bar - 1) * 4 + i, d: 0.9, v: 0.8 })),
          { src: 'hum' },
        );
        await new Promise((res) => setTimeout(res, 150));
        return rec.stop();
      };
      st.dispatch(
        [
          { type: 'track.add', ref: 'd', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
          { type: 'clip.add', track: '$d', clip: { start: 0, length: 8, notes: 'C2@0:1 D2@1:1' } },
          { type: 'track.add', ref: 'b', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
          { type: 'clip.add', track: '$b', clip: { start: 0, length: 8, notes: 'C2@0:2' } },
        ],
        { by: 'you' },
      );
      const ids = Object.fromEntries(st.get().tracks.map((t) => [t.name, t.id]));
      o.ui.select({ track: ids.Drums });
      out.first = aimName('hum');
      await hum(1);
      out.afterFirst = st.get().tracks.map((t) => t.name);
      out.selAfter = name(o.ui.state.selection.track);
      out.second = aimName('hum');
      // 'new' is one-shot: after its commit the next hum goes onto that track
      rec.setAim('hum', 'new');
      await hum(3);
      const made = st.get().tracks.at(-1);
      out.oneShot = { made: made.name, next: aimName('hum') };
      // a newer selection wins over the last take
      await new Promise((res) => setTimeout(res, 20));
      o.ui.select({ track: ids.Bass });
      out.selWins = aimName('hum');
      rec.setAim('hum', ids.Drums);
      out.ontoDrums = aimName('hum');
      rec.setAim('hum', null);
      out.pads = aimName('pads');
      // a hum over the same bars stacks; over other bars it's a clip beside
      o.ui.select({ track: made.id });
      const c1 = await hum(3, [62, 65]);
      out.stack = {
        offer: !!(c1 && (c1.stacked || c1.ownTrack || c1.offer || /own track/i.test(JSON.stringify(c1)))),
        muted: st
          .get()
          .tracks.find((t) => t.id === made.id)
          .clips.filter((c) => c.mute).length,
      };
      const c2 = await hum(7, [64]);
      out.beside = {
        muted: st
          .get()
          .tracks.find((t) => t.id === made.id)
          .clips.filter((c) => c.mute).length,
        ok: !!c2,
      };
      return out;
    });
    if (r.missing) {
      T.ok(false, '4: input/recorder.js has aim() and setAim()');
      return;
    }
    T.ok(
      r.first === 'new' && r.afterFirst.includes('Melody') && r.selAfter === 'Melody' && r.second === 'Melody',
      `4: with Drums selected a hum goes to a new track (Melody, selected), and the next onto Melody (${JSON.stringify(r)})`,
    );
    T.ok(
      r.oneShot.next === r.oneShot.made && r.oneShot.made !== 'Melody 3',
      `4: 'new' is one-shot: the hum after it goes onto ${r.oneShot.made}, not another new track (${r.oneShot.next})`,
    );
    T.ok(
      r.selWins === 'Bass' && r.ontoDrums === 'Drums' && r.pads === 'Drums',
      `4: a newer selection wins (Bass), Onto Drums puts a hum on Drums, pads aim at the only kit (${r.selWins}, ${r.ontoDrums}, ${r.pads})`,
    );
    T.ok(
      r.stack.offer && r.stack.muted >= 1 && r.beside.muted === r.stack.muted && r.beside.ok,
      `4: a hum over the same bars stacks (an earlier take muted, the "own track" offer); over other bars nothing more is muted (${JSON.stringify(r.stack)} → ${JSON.stringify(r.beside)})`,
    );

    // the full studio
    const F = await fresh({ query: 'view=full' });
    const f = await F.E(() => {
      const o = window.overdub,
        rec = o.input.recorder,
        st = o.store;
      if (typeof rec.aim !== 'function') return { missing: true };
      st.dispatch(
        [
          { type: 'track.add', ref: 'd', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
          { type: 'track.add', ref: 'b', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
          { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' }, arm: true } },
        ],
        { by: 'you' },
      );
      const ids = Object.fromEntries(st.get().tracks.map((t) => [t.name, t.id]));
      const name = (id) => st.get().tracks.find((t) => t.id === id)?.name ?? 'new';
      const out = { armed: name(rec.aim('hum').track) };
      rec.setAim('hum', 'new');
      out.newAim = name(rec.aim('hum').track);
      out.armedAfter = st
        .get()
        .tracks.filter((t) => t.arm)
        .map((t) => t.name);
      st.dispatch({ type: 'track.set', track: ids.Keys, patch: { arm: true } }, { by: 'you' });
      out.rearmed = name(rec.aim('hum').track);
      st.dispatch({ type: 'track.set', track: ids.Keys, patch: { arm: false } }, { by: 'you' });
      o.ui.select({ track: ids.Drums });
      out.drumsSel = name(rec.aim('hum').track);
      return out;
    });
    if (f.missing) return;
    T.ok(
      f.armed === 'Keys' && f.newAim === 'new' && !f.armedAfter.length && f.rearmed === 'Keys' && f.drumsSel === 'new',
      `4 (full studio): an armed Keys takes the hum; A new track disarms every track; arming by hand clears the choice; Drums selected with nothing armed aims at a new track, not Bass (${JSON.stringify(f)})`,
    );
  });

  /* ---------------------------------------------------------------- 5-7, 13, 14: AJ's path, then the card */
  const A = await fresh();
  let melody = null;
  await section("5 AJ's path", async () => {
    await tapABeat(A);
    const beat = await A.E(STATE);
    const drums = beat.tracks.find((t) => t.name === 'Drums');
    T.ok(
      drums && drums.clips.reduce((n, c) => n + c.n, 0) >= 12,
      `5: Tap a beat, R, taps, Space: hits on Drums (${drums ? drums.clips.reduce((n, c) => n + c.n, 0) : 'no Drums'})`,
    );
    await A.E(() => {
      const o = window.overdub;
      o.ui.show('sketch');
      o.input.emit('sketch:mode', 'hum');
    });
    await sleep(500);
    const onto = await A.E(() => {
      const el = document.querySelector('.sk-onto');
      const sel = el?.querySelector('select');
      return {
        shown: !!el && el.getClientRects().length > 0,
        text: sel ? sel.selectedOptions[0]?.textContent : el?.textContent || '',
      };
    });
    T.ok(
      onto.shown && /A new track/.test(onto.text),
      `5: in Hum it, Onto shows "A new track" in the simple view ("${onto.text}")`,
    );
    await humTake(A, 5);
    const st = await A.E(STATE);
    melody = st.tracks.find((t) => t.name === 'Melody');
    const ps = melody ? melody.clips.flatMap((c) => c.ps) : [];
    T.ok(
      melody &&
        melody.clips.some((c) => c.n) &&
        st.tracks.find((t) => t.name === 'Drums').clips.every((c) => !c.ps.some((p) => p >= 55)) &&
        st.sel === 'Melody',
      `5: the hum is on a new track, Melody, not Drums, and Melody is selected (${st.tracks.map((t) => `${t.name}:${t.clips.reduce((n, c) => n + c.n, 0)}`).join(', ')}; selected ${st.sel})`,
    );
    T.ok(
      ps.length && ps.every((p) => HUM_KEY_PCS.has(((p % 12) + 12) % 12)),
      `5: its notes are all in the key heard (${ps.join(' ')})`,
    );
    T.ok(
      st.card &&
        st.card.track === melody?.id &&
        st.card.rows.slice(0, 4).join() === 'Lamp Tines,Light Table,Music Stands,Choir Loft' &&
        /Lamp Tines/.test(st.focus || ''),
      `5: the card is up on Melody with Lamp Tines (now), Light Table, Music Stands, Choir Loft, and "now" has focus (${JSON.stringify(st.card)}; focus ${st.focus})`,
    );
    // (the fresh-eyes run at 1440×900 found the rows under the window's edge, in Sketch's short stage: the card floats by
    // the track's header now, whole on screen, every row the one a click there lands on)
    const vis = await A.E(() => {
      const c = document.querySelector('.snd-card');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const rows = [...c.querySelectorAll('.snd-row')].map((x) => {
        const q = x.getBoundingClientRect();
        const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return { top: Math.round(q.top), bottom: Math.round(q.bottom), hit: !!at && x.contains(at) };
      });
      return {
        pop: c.classList.contains('snd-pop'),
        whole: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        rows,
      };
    });
    T.ok(
      vis && vis.pop && vis.whole && vis.rows.length >= 4 && vis.rows.every((x) => x.bottom <= 900 && x.hit),
      `5: at 1440×900 the card floats whole on screen and every row takes its click (${JSON.stringify(vis)})`,
    );
    await A.shot('05-card');
  });

  await section('6 trials', async () => {
    await previewsOf(A);
    const h0 = (await A.E(STATE)).hist;
    await A.page.keyboard.press('ArrowDown');
    await sleep(700);
    const a = await A.E(STATE);
    const head = await A.E(
      (id) => document.querySelector(`.ar-head[data-track="${id}"] .ar-hinst`)?.textContent || '',
      melody?.id,
    );
    T.ok(
      a.tracks.find((t) => t.name === 'Melody')?.dev === 'core.wavetable' &&
        a.hist === h0 &&
        /Light Table, trying/.test(head),
      `6: ↓ to Light Table previews it: Melody on core.wavetable, no History entry, the header says "${head}"`,
    );
    await A.page.keyboard.press('ArrowDown');
    await sleep(700);
    const b = await A.E(STATE);
    T.ok(
      b.hist === h0 && b.trying?.device === 'core.strings',
      `6: ↓ to Music Stands, still no History entry (${b.trying?.device})`,
    );
    await A.page.keyboard.press('Escape');
    await sleep(500);
    const c = await A.E(STATE);
    T.ok(
      c.tracks.find((t) => t.name === 'Melody')?.dev === 'core.keys' && c.hist === h0 && !c.trying,
      `6: Back: Lamp Tines again, nothing in History (${c.tracks.find((t) => t.name === 'Melody')?.dev})`,
    );
    // Light Table again, Keep
    await A.E(() => window.overdub.sounds?.offer?.({ track: window.overdub.ui.state.selection.track, from: 'header' }));
    await sleep(300);
    await A.E((id) => window.overdub.sounds.try(id, { device: 'core.wavetable' }), melody?.id);
    await sleep(500);
    await A.page.keyboard.press('Enter');
    await sleep(500);
    const d = await A.E(STATE);
    const counted = await A.E(() => {
      const o = window.overdub;
      o.ui.show?.('history');
      return [...document.querySelectorAll('.hist-row, .ledger-row')].some((x) =>
        /Light Table \(was Lamp Tines\)/.test(x.textContent),
      );
    });
    T.ok(
      d.hist === h0 + 1 &&
        d.last.by === 'you' &&
        !d.last.audition &&
        d.last.label === 'Melody: Light Table (was Lamp Tines)' &&
        counted,
      `6: Keep: one History entry by you, no audition flag, "${d.last?.label}", counted in the History tab (${counted})`,
    );
    await A.page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await sleep(400);
    const e = await A.E(STATE);
    T.ok(
      e.tracks.find((t) => t.name === 'Melody')?.dev === 'core.keys' && e.hist === h0,
      `6: one ⌘Z puts Lamp Tines back (${e.tracks.find((t) => t.name === 'Melody')?.dev})`,
    );
    // held ↓ for 400 ms: at most two trials
    await A.E(() => {
      window.overdub.sounds?.offer?.({ track: window.overdub.ui.state.selection.track, from: 'header' });
      window.overdub.__pv = 0;
    });
    await sleep(300);
    await A.page.keyboard.down('ArrowDown');
    await sleep(400);
    await A.page.keyboard.up('ArrowDown');
    await sleep(400);
    const n = await A.E(() => window.overdub.__pv);
    T.ok(n <= 2, `6: holding ↓ for 400 ms starts at most two trials (${n})`);
    await A.E(() => window.overdub.sounds?.back?.());
  });

  await section('7 what ends a trial', async () => {
    const tryLT = () =>
      A.E((id) => {
        const o = window.overdub;
        o.sounds?.offer?.({ track: id, from: 'header' });
        return o.sounds?.try?.(id, { device: 'core.wavetable' });
      }, melody?.id);
    await tryLT();
    await sleep(400);
    const read = await A.E(async (id) => {
      const o = window.overdub;
      const r = await o.tools.run('get_project', {}, { by: 'claude' });
      return {
        sees: /Lamp Tines/.test(r.song || JSON.stringify(r)),
        dev: o.store.get().tracks.find((t) => t.id === id).instrument.device,
        trying: !!o.sounds.trying(),
      };
    }, melody?.id);
    const why = (await A.E(STATE)).status.join(' | ');
    T.ok(
      read.sees && read.dev === 'core.keys' && !read.trying && /while Claude works/.test(why),
      `7: get_project mid-trial sees Lamp Tines, and the card says why ("${why}")`,
    );
    await tryLT();
    await sleep(400);
    const kept = await A.E(async () => {
      const o = window.overdub;
      await o.tools.run('get_recording', {}, { by: 'claude' });
      return !!o.sounds.trying();
    });
    T.ok(kept, '7: get_recording mid-trial leaves the trial on');
    // R mid-trial keeps first, said before
    const h0 = (await A.E(STATE)).hist;
    await A.E(() => {
      const o = window.overdub;
      o.input.recorder.setCountIn?.(1);
    });
    await A.page.keyboard.press('r');
    await sleep(500);
    const counting =
      (await A.E(STATE)).status.join(' | ') +
      ' ' +
      (await A.E(() => document.body.innerText.match(/Recording keeps[^.\n]*\./)?.[0] || ''));
    // (R while the loop plays waits for a short loop's top, then counts a bar: capture-timing; so wait for the take)
    await A.until(() => window.overdub.input.recorder.state === 'rec');
    await sleep(2500);
    await A.page.keyboard.press('Space');
    await A.until(() => window.overdub.input.recorder.state === 'idle');
    await sleep(800);
    const after = await A.E(STATE);
    await A.page.keyboard.press('Meta+z');
    await sleep(300);
    const u1 = await A.E(STATE);
    await A.page.keyboard.press('Meta+z');
    await sleep(300);
    const u2 = await A.E(STATE);
    T.ok(
      /Recording keeps Light Table on Melody\./.test(counting) &&
        after.hist >= h0 + 2 &&
        u1.tracks.find((t) => t.name === 'Melody').dev === 'core.wavetable' &&
        u2.tracks.find((t) => t.name === 'Melody').dev === 'core.keys',
      `7: R mid-trial says "Recording keeps Light Table on Melody." and keeps it first: ⌘Z takes the take, a second ⌘Z the sound (said "${counting.trim()}"; History +${after.hist - h0}; ${u1.tracks.find((t) => t.name === 'Melody').dev} → ${u2.tracks.find((t) => t.name === 'Melody').dev})`,
    );
    // another track selected: Back, with Keep it
    await tryLT();
    await sleep(400);
    await A.E(() => {
      const o = window.overdub;
      o.ui.select({ track: o.store.get().tracks.find((t) => t.name === 'Drums').id });
    });
    await sleep(500);
    const toast = (await A.E(STATE)).toasts.join(' | ');
    const keepIt = await A.E(() => {
      const b = [...document.querySelectorAll('.ew-toast button')].find((x) => /Keep it/.test(x.textContent));
      b?.click();
      return !!b;
    });
    await sleep(400);
    const k = await A.E(STATE);
    T.ok(
      /Back to Lamp Tines on Melody; Light Table wasn.t kept\./.test(toast) &&
        keepIt &&
        k.tracks.find((t) => t.name === 'Melody').dev === 'core.wavetable',
      `7: selecting Drums mid-trial: "${toast}", and its Keep it keeps it`,
    );
    // an undo mid-trial of an earlier change on Melody holds after the release
    await A.E((id) => {
      const o = window.overdub;
      o.ui.select({ track: id });
      o.sounds.offer?.({ track: id, from: 'header' });
      o.sounds.try(id, { device: 'core.strings' });
    }, melody?.id);
    await sleep(400);
    await A.page.keyboard.press('Meta+z');
    await sleep(500);
    const un = await A.E(STATE);
    T.ok(
      un.tracks.find((t) => t.name === 'Melody').dev === 'core.keys' && !un.trying,
      `7: ⌘Z of the kept Light Table mid-trial: Back first, and the undo holds (${un.tracks.find((t) => t.name === 'Melody').dev})`,
    );
    // a click on the arranger leaves the card open and the trial on
    await tryLT();
    await sleep(400);
    await A.page.mouse.click(700, 600);
    await sleep(300);
    const cl = await A.E(STATE);
    T.ok(!!cl.trying && !!cl.card, '7: a click on the arranger mid-trial leaves the card open and the trial on');
    await A.E(() => window.overdub.sounds?.back?.());
  });

  await section('13 suggest_sounds', async () => {
    const r = await A.E(async (id) => {
      const o = window.overdub;
      o.ui.select({ track: id });
      const ok = await o.tools.run(
        'suggest_sounds',
        { sounds: [{ device: 'core.brass', why: 'bright, cuts through' }] },
        { by: 'claude' },
      );
      await new Promise((res) => setTimeout(res, 400));
      const row = [...document.querySelectorAll('.ledger-row')].find((x) => /Brass Rail/.test(x.textContent));
      const signed =
        !!row?.querySelector('.by-agent') &&
        /suggested by\s*Claude/.test(row?.textContent || '') &&
        /bright, cuts through/.test(row?.textContent || '');
      o.sounds.try(id, { device: 'core.brass' });
      await new Promise((res) => setTimeout(res, 300));
      o.sounds.keep();
      await new Promise((res) => setTimeout(res, 300));
      const last = o.store.history.at(-1);
      const res = await o.tools.run('get_variation_result', { id: ok.id }, { by: 'claude' });
      const bad = await o.tools.run('suggest_sounds', { sounds: [{ device: 'x', why: 'y' }] }, { by: 'claude' });
      const listed = o.tools.list().includes('suggest_sounds');
      o.store.undo();
      return { ok, signed, last: { by: last.by, reason: last.reason || '' }, res, bad: bad.error, listed };
    }, melody?.id);
    T.ok(
      r.ok.offered && r.signed,
      `13: suggest_sounds by Claude adds a row signed "suggested by Claude" in cool ink, with its why (${JSON.stringify(r.ok)})`,
    );
    T.ok(
      r.last.by === 'you' &&
        /Claude/.test(r.last.reason) &&
        r.res.kept === true &&
        r.res.picked?.device === 'core.brass',
      `13: Keep dispatches by you with a reason naming Claude, and get_variation_result says what they kept (${JSON.stringify(r.last)}; ${JSON.stringify(r.res)})`,
    );
    T.ok(
      r.bad === 'no instrument "x"' && r.listed,
      `13: a bad id is refused ("${r.bad}"); the tool is in tools.list()`,
    );
    // while recording
    const rec = await A.E(async () => {
      const o = window.overdub;
      await o.input.recorder.record({ countIn: 0 });
      const x = await o.tools.run('suggest_sounds', { sounds: [{ device: 'core.brass', why: 'b' }] }, { by: 'claude' });
      o.input.recorder.cancel?.();
      await o.input.recorder.stop?.();
      return x.error;
    });
    T.ok(rec === 'the person is recording', `13: while recording: "${rec}"`);
    await A.E(() => window.overdub.sounds?.close?.());
  });

  await section('14 the demo agent', async () => {
    const r = await A.E(async (id) => {
      const o = window.overdub;
      o.ui.select({ track: id });
      const { runMock } = await import('/app/src/agent/mock.js');
      let text = '';
      await runMock(o, 'what should this sound like', {
        emit: (k, d) => {
          if (k === 'text') text += d.delta;
        },
        setStatus() {},
        fast: true,
      });
      await new Promise((res) => setTimeout(res, 300));
      const rows = [...document.querySelectorAll('.ledger-row')].filter((x) =>
        /suggested by/.test(x.textContent),
      ).length;
      return { text, rows };
    }, melody?.id);
    T.ok(
      r.rows === 4 && /^Four more for Melody: [^.]+\. Click one to hear it\.$/.test(r.text.trim()),
      `14: "what should this sound like" puts four suggested rows on the card and says so in one line ("${r.text.trim()}")`,
    );
    await A.E(() => window.overdub.sounds?.close?.());
  });

  /* ---------------------------------------------------------------- 8: the leftover heal */
  await section('8 the heal', async () => {
    const H = await fresh();
    await H.E(() => {
      const o = window.overdub;
      o.store.dispatch(
        [
          { type: 'track.add', ref: 'm', track: { name: 'Melody', instrument: { device: 'core.keys' } } },
          { type: 'clip.add', track: '$m', clip: { start: 0, length: 4, notes: 'C4@0:1' } },
        ],
        { by: 'you' },
      );
    });
    const id = await H.E(() => window.overdub.store.get().tracks[0].id);
    await H.E((id) => {
      const o = window.overdub;
      o.ui.select({ track: id });
      o.sounds.offer?.({ track: id, from: 'header' });
      o.sounds.try(id, { device: 'core.wavetable' });
    }, id);
    await sleep(500);
    const key = await H.E(() => localStorage.getItem('overdub:sound-trying'));
    await H.go();
    const back = await H.E(() => ({
      dev: window.overdub.store.get().tracks[0]?.instrument.device,
      hist: window.overdub.store.history.length,
      key: localStorage.getItem('overdub:sound-trying'),
    }));
    T.ok(
      !!key && /core\.keys/.test(key) && back.dev === 'core.keys' && !back.key,
      `8: a trial leaves overdub:sound-trying; a reload puts Lamp Tines back, nothing in History (${back.dev}, ${back.hist})`,
    );
  });

  /* ---------------------------------------------------------------- 9: the Sketch card on an uncommitted take */
  await section('9 the Sketch card', async () => {
    // (capture-timing: a take from Hum it lands in the song by itself, so the card is on the landed take's track, Melody;
    // the uncommitted take's ghost lane and its In tune lamp are gone with the wait for Keep)
    const K = await fresh();
    await humIt(K);
    await sleep(600);
    await K.page.locator('.sk-hum').click();
    await K.until(
      () => window.overdub.input.recorder.state === 'rec' || window.overdub.input.recorder.free,
      null,
      6000,
    );
    await sleep(3000);
    await K.page.locator('.sk-hum').click();
    await K.until(() => window.overdub.input.recorder.state === 'idle');
    await sleep(1500);
    const landed = await K.E(STATE);
    const mel0 = landed.tracks.find((t) => t.name === 'Melody');
    T.ok(
      mel0 && mel0.clips.length === 1 && mel0.dev === 'core.keys',
      `9: the hum lands by itself on a new Melody, Lamp Tines, one clip (${JSON.stringify(mel0)})`,
    );
    await K.page.keyboard.press('ArrowDown');
    await sleep(800);
    const g = await K.E(() => {
      const o = window.overdub,
        tr = o.sounds?.trying?.();
      return {
        tr: tr ? { track: tr.track, device: tr.device, newTrack: !!tr.newTrack } : null,
        mel: o.store.get().tracks.find((t) => t.name === 'Melody')?.id,
        h: o.store.history.length,
        go: document.querySelectorAll('.sketch .btn-go, [data-panel="sketch"] .btn-go').length,
      };
    });
    T.ok(
      g.tr && g.tr.track === g.mel && !g.tr.newTrack && g.go <= 1,
      `9: ↓ on the card tries a sound on Melody, the track the take made, at most one .btn-go in Sketch (${JSON.stringify(g)})`,
    );
    const h0 = await K.E(() => window.overdub.store.history.length);
    const dev = g.tr?.device;
    await K.E(() => window.overdub.sounds?.keepIfTrying?.(null, { why: 'keep' }));
    await sleep(600);
    const k = await K.E(STATE);
    const m = k.tracks.find((t) => t.name === 'Melody');
    T.ok(
      m && m.dev === dev && m.clips.length === 1 && k.hist - h0 === 1,
      `9: Keep puts the sound on Melody with its clip, in one undo step (${JSON.stringify(m)}; History +${k.hist - h0})`,
    );
    await K.shot('09-sketch-kept');
  });

  /* ---------------------------------------------------------------- 10: the header */
  await section('10 the header', async () => {
    const R = await fresh();
    await R.E(() => {
      const o = window.overdub;
      o.store.dispatch(
        [
          { type: 'track.add', ref: 'm', track: { name: 'Melody', instrument: { device: 'core.keys' } } },
          { type: 'clip.add', track: '$m', clip: { start: 0, length: 4, notes: 'C4@0:1' } },
          { type: 'track.add', ref: 'n', track: { name: 'New', instrument: { device: 'core.keys' } } },
          { type: 'clip.add', track: '$n', clip: { start: 0, length: 4, notes: 'E4@0:1' } },
        ],
        { by: 'you' },
      );
      o.ui.select({ track: o.store.get().tracks[0].id });
    });
    await sleep(500);
    const h = await R.E(() => {
      const el = document.querySelector('.ar-head .ar-hinst');
      return {
        text: el?.textContent.trim() || '',
        glyph: !!el?.querySelector('svg'),
        glyphShown: el?.querySelector('svg')
          ? getComputedStyle(el.querySelector('svg')).visibility !== 'hidden' &&
            getComputedStyle(el.querySelector('svg')).opacity !== '0'
          : false,
      };
    });
    T.ok(
      /Lamp Tines/.test(h.text) && h.glyph && h.glyphShown,
      `10: .ar-hinst on Melody reads "${h.text}" with the open glyph shown at rest`,
    );
    await R.page.locator('.ar-head .ar-hinst').first().click();
    await sleep(800);
    const w = await R.E(() => {
      const o = window.overdub;
      const win = document.querySelector('.plugin, .pl-win, [data-plugin]');
      const lane = document.querySelector('.ar-lane');
      const a = win?.getBoundingClientRect(),
        b = lane?.getBoundingClientRect();
      const over = a && b ? !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right) : null;
      return {
        name: o.plugin?.current?.name,
        devices: o.ui.workspace?.has?.('devices'),
        keys: !!document.querySelector('.plugin .kb, .pl-keys, [data-plugin] .kb'),
        over,
      };
    });
    T.ok(
      w.name === 'Lamp Tines' && w.devices === false && w.over !== true,
      `10: a click on the name opens Lamp Tines big with Sound still put away, not over Melody's lane (${JSON.stringify(w)})`,
    );
    await R.page.keyboard.press('Escape');
    await sleep(300);
    await R.E(() => document.querySelector('.ar-head .ar-hinst .sw, .ar-head .ar-hsw, .ar-head .ar-swatch')?.click());
    await sleep(300);
    const sw = await R.E(() => window.overdub.plugin?.current?.name || null);
    T.ok(!sw, `10: a click on the swatch opens nothing (${sw})`);
    const so = await R.E(() => {
      const heads = [...document.querySelectorAll('.ar-head[data-track]')];
      const vis = (el) =>
        !!el &&
        el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        getComputedStyle(el).opacity !== '0';
      return heads.map((hd) => ({
        name: hd.querySelector('.ar-hname')?.textContent.trim(),
        sounds: vis(hd.querySelector('.ar-hsounds')),
        w: hd.getBoundingClientRect().width,
      }));
    });
    T.ok(
      so.length >= 2 && so[0].sounds && so[1].sounds,
      `10: Sounds shows on the selected track and, pending, on the new unselected one (${JSON.stringify(so)})`,
    );
    const w0 = so[1].w;
    await R.page.locator('.ar-head[data-track]').nth(1).hover();
    await sleep(200);
    const w1 = await R.E(() => document.querySelectorAll('.ar-head[data-track]')[1].getBoundingClientRect().width);
    T.ok(Math.abs(w1 - w0) < 0.5, `10: the header doesn't change width on hover (${w0} → ${w1})`);
    const F = await fresh({ query: 'view=full' });
    await F.E(() =>
      window.overdub.store.dispatch(
        { type: 'track.add', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
        { by: 'you' },
      ),
    );
    await sleep(400);
    const full = await F.E(() => ({
      hdev: !!document.querySelector('.ar-head .ar-hdev'),
      hinst: !!document.querySelector('.ar-head .ar-hinst'),
    }));
    T.ok(
      full.hdev && full.hinst,
      `10: in the full studio .ar-hdev is still there beside .ar-hinst (${JSON.stringify(full)})`,
    );
  });

  /* ---------------------------------------------------------------- 11: the browser */
  await section('11 the browser', async () => {
    const B = await fresh({ query: 'view=full' });
    await B.E(() => {
      const o = window.overdub;
      o.store.dispatch(
        [
          { type: 'track.add', ref: 'd', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
          { type: 'clip.add', track: '$d', clip: { start: 0, length: 4, notes: 'C2@0:1' } },
          { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
        ],
        { by: 'you' },
      );
      o.ui.select({ track: o.store.get().tracks[0].id });
      o.ui.show('browser');
    });
    await sleep(600);
    const row = () =>
      B.page
        .locator('.br-row, .browser .ledger-row, [data-device="core.wavetable"]')
        .filter({ hasText: 'Light Table' })
        .first();
    await row().click();
    await sleep(400);
    const m = await B.E(() => ({
      dev: window.overdub.store.get().tracks[0].instrument.device,
      menu: [...document.querySelectorAll('.menu button, [role=menuitem]')].map((x) => x.textContent.trim()),
    }));
    T.ok(
      m.dev === 'core.drums' && m.menu.some((x) => /New track with Light Table/.test(x)),
      `11: Drums selected, a click on Light Table changes nothing and asks (${m.dev}; ${m.menu.join(' / ')})`,
    );
    const h0 = await B.E(() => window.overdub.store.history.length);
    await B.page
      .getByRole('menuitem', { name: /New track with Light Table/ })
      .or(B.page.locator('.menu button').filter({ hasText: 'New track with Light Table' }))
      .first()
      .click();
    await sleep(400);
    const n = await B.E(() => ({
      names: window.overdub.store.get().tracks.map((t) => `${t.name}:${t.instrument?.device}`),
      h: window.overdub.store.history.length,
    }));
    T.ok(
      n.names.includes('Light Table:core.wavetable') && n.names.includes('Drums:core.drums') && n.h === h0 + 1,
      `11: New track with Light Table adds "Light Table", Drums untouched, one undo step (${n.names.join(', ')})`,
    );
    await B.E(() => {
      const o = window.overdub;
      o.ui.select({ track: o.store.get().tracks.find((t) => t.name === 'Keys').id });
    });
    await sleep(300);
    const h1 = await B.E(() => window.overdub.store.history.length);
    await row().click();
    await sleep(500);
    const tri = await B.E(() => ({
      dev: window.overdub.store.get().tracks.find((t) => t.name === 'Keys').instrument.device,
      bar: document.querySelector('.br-target, .browser [role=status]')?.textContent || '',
    }));
    await B.page
      .getByRole('button', { name: /^Back$/ })
      .first()
      .click()
      .catch(() => {});
    await sleep(300);
    const back = await B.E(() => ({
      dev: window.overdub.store.get().tracks.find((t) => t.name === 'Keys').instrument.device,
      h: window.overdub.store.history.length,
    }));
    T.ok(
      tri.dev === 'core.wavetable' &&
        /Trying Light Table on Keys/.test(tri.bar) &&
        back.dev === 'core.keys' &&
        back.h === h1,
      `11: Keys selected, a click tries ("${tri.bar.trim()}"); Back leaves no History entry`,
    );
    // a producer's loop: a browser trial plays the track and never moves it, whether it ends in Back or Keep (it was
    // held round the track's bars and saved that way)
    await B.E(() => {
      const o = window.overdub;
      o.store.dispatch(
        { type: 'project.set', patch: { loop: { on: true, start: 16, end: 24 } } },
        { by: 'you', label: 'loop' },
      );
      o.engine.stop?.();
    });
    await sleep(200);
    const loopNow = () => B.E(() => JSON.stringify(window.overdub.store.get().loop));
    const l0 = await loopNow();
    await row().click();
    await sleep(600);
    const l1 = await loopNow();
    await B.page
      .getByRole('button', { name: /^Back$/ })
      .first()
      .click()
      .catch(() => {});
    await sleep(300);
    const l2 = await loopNow();
    T.ok(
      l1 === l0 && l2 === l0,
      `11: a browser trial leaves the song's loop alone, during it and after Back (${l0} / ${l1} / ${l2})`,
    );
    // a double-click keeps what the first click tried, on the row the pointer is on (the line over the list doesn't
    // grow under it: the trial bar has its room)
    await B.E(() => window.overdub.engine.stop?.());
    const y0 = await B.E(
      () => document.querySelector('.br-row[data-device="core.wavetable"]').getBoundingClientRect().top,
    );
    const h2 = await B.E(() => window.overdub.store.history.length);
    const bx = await row().boundingBox();
    await B.page.mouse.dblclick(bx.x + 30, bx.y + 8);
    await sleep(700);
    const dk = await B.E(() => ({
      dev: window.overdub.store.get().tracks.find((t) => t.name === 'Keys' || t.name === 'Light Table')?.instrument
        .device,
      h: window.overdub.store.history.length,
      last: window.overdub.store.history.at(-1)?.label,
      y: document.querySelector('.br-row[data-device="core.wavetable"]').getBoundingClientRect().top,
      loop: JSON.stringify(window.overdub.store.get().loop),
    }));
    T.ok(
      dk.dev === 'core.wavetable' &&
        dk.h === h2 + 1 &&
        /Light Table \(was Lamp Tines\)/.test(dk.last || '') &&
        Math.abs(dk.y - y0) < 1 &&
        dk.loop === l0,
      `11: a double-click on Light Table keeps it on Keys, one undo step, the row didn't move (${JSON.stringify(dk)})`,
    );
  });

  /* ---------------------------------------------------------------- 12: musical typing */
  await section('12 musical typing', async () => {
    const M = await fresh();
    await tapABeat(M);
    await M.E(() => {
      const o = window.overdub;
      o.__live = [];
      const f = o.engine.liveNoteOn;
      o.engine.liveNoteOn = function (track, ...a) {
        o.__live.push(track);
        return f.call(this, track, ...a);
      };
      o.__said = [];
      o.input.on('keys:track', (e) => o.__said.push(e.text));
      o.input.setMode(null);
      o.input.qwerty.toggle(true);
    });
    await M.page.keyboard.press('a');
    await sleep(500);
    const r = await M.E(() => {
      const o = window.overdub,
        p = o.store.get();
      const k = p.tracks.find((t) => t.name === 'Keys');
      return {
        keys: k && { dev: k.instrument.device, id: k.id },
        sel: p.tracks.find((t) => t.id === o.ui.state.selection.track)?.name,
        live: o.__live,
        drums: p.tracks.find((t) => t.name === 'Drums')?.id,
        line: o.__said[0] || document.body.innerText.match(/Keys play a new track[^.]*\./)?.[0] || '',
      };
    });
    T.ok(
      r.keys?.dev === 'core.keys' &&
        r.sel === 'Keys' &&
        r.live.length &&
        r.live.every((x) => x === r.keys.id) &&
        !r.live.includes(r.drums) &&
        /Keys play a new track, Keys \(Lamp Tines\)/.test(r.line),
      `12: musical typing after Tap a beat makes Keys (Lamp Tines), selected, the note sounds there and never on Drums ("${r.line}")`,
    );
  });

  /* ---------------------------------------------------------------- 15, 17b: the coach's Hum over it (a 4-bar hum) */
  await section('15 Hum over it', async () => {
    const B4 = await open('/app/', { query: 'view=simple', width: 1440, height: 900, fakeAudio: HUM4 });
    try {
      await B4.page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
      const C = {
        page: B4.page,
        E: (fn, a) => B4.page.evaluate(fn, a),
        until: (fn, a, ms = 8000) =>
          B4.page
            .waitForFunction(fn, a, { timeout: ms })
            .then(() => true)
            .catch(() => false),
        shot: (n) => B4.page.screenshot({ path: path.join(OUTDIR, `pick-sound-${n}.png`) }).catch(() => {}),
      };
      await tapABeat(C);
      const card = await C.E(() =>
        [...document.querySelectorAll('.ob button:not(.ob-x)')].map((b) => b.textContent.trim()),
      );
      T.ok(card[0] === 'Hum over it', `15: the coach's beat card offers Hum over it first (${card.join(' / ')})`);
      const tap = await C.E(() => document.querySelector('.sk-bb')?.title || '');
      T.ok(
        tap === 'Beatbox: the mic as drums. To hum a tune, use Hum it.',
        `15: Tap it's mic button carries the Beatbox title ("${tap}")`,
      );
      // 17b: Hum over it, R, Space, ↓
      let actions = 0;
      await C.page.getByRole('button', { name: 'Hum over it' }).first().click();
      actions++;
      await sleep(800);
      const set = await C.E(() => {
        const o = window.overdub,
          p = o.store.get();
        const d = p.tracks.find((t) => t.name === 'Drums');
        return {
          loopBars: p.loop?.on ? (p.loop.end - p.loop.start) / 4 : 0,
          beatBars: d ? Math.max(...d.clips.map((c) => (c.start + c.length) / 4)) : 0,
          click: !!o.engine.metronome,
          onto:
            document.querySelector('.sk-onto select')?.selectedOptions[0]?.textContent ||
            document.querySelector('.sk-onto')?.textContent ||
            '',
        };
      });
      T.ok(
        set.beatBars >= 8 && set.loopBars >= 8 && !set.click && /A new track/.test(set.onto),
        `15: Hum over it makes the beat 8 bars, turns the click off, Onto "A new track" (${JSON.stringify(set)})`,
      );
      await C.page.keyboard.press('r');
      actions++;
      await sleep(10000);
      await C.page.keyboard.press('Space');
      actions++;
      await C.until(() => window.overdub.input.recorder.state === 'idle');
      await sleep(1500);
      const one = await C.E(() => {
        const m = window.overdub.store.get().tracks.find((t) => t.name === 'Melody');
        return (
          m &&
          m.clips.map((c) => ({
            start: c.start,
            length: c.length,
            take: c.take || null,
            mute: !!c.mute,
            n: c.notes.length,
          }))
        );
      });
      T.ok(
        one &&
          one.filter((c) => !c.mute).length === 1 &&
          !one.some((c) => c.mute) &&
          one[0].length >= 12 &&
          one[0].length <= 20,
        `15: a 4-bar hum over the playing beat lands as one clip on Melody, no take folder (${JSON.stringify(one)})`,
      );
      await C.page.keyboard.press('ArrowDown');
      actions++;
      await sleep(900);
      const hear = await C.E(() => window.overdub.sounds?.trying?.()?.device || null);
      T.ok(
        actions <= 4 && hear && hear !== 'core.keys',
        `17: from the beat card, Hum over it, R, Space, ↓ hears the hum on a second instrument in ${actions} actions (${hear})`,
      );
    } finally {
      await B4.close();
    }
  });

  /* ---------------------------------------------------------------- 17a: from the blank song */
  await section('17 time to a pretty sound', async () => {
    // (the door's way in now, ui/start.js: Hum a tune, then Hum (H) records over a simple beat, Space keeps it)
    const Z = await fresh();
    let actions = 0;
    await Z.page.getByRole('button', { name: 'Hum a tune' }).click();
    actions++;
    await sleep(700);
    await Z.page.keyboard.press('KeyH');
    actions++;
    await sleep(6000);
    await Z.page.keyboard.press('Space');
    actions++;
    await sleep(1800);
    // (Space ended the take and the transport with it: the card's ↓ plays the take on the sound it tries)
    await Z.page.keyboard.press('ArrowDown');
    actions++;
    await sleep(900);
    const playing = await Z.E(() => !!window.overdub.engine.playing || !!window.overdub.sketch?.hearing?.());
    const hear = await Z.E(() => window.overdub.sounds?.trying?.()?.device || null);
    T.ok(
      actions <= 4 && playing && hear && hear !== 'core.keys',
      `17: from the blank song, Hum a tune, H, Space, ↓: the take plays at once and is heard on a second instrument in ${actions} actions (${hear}; playing ${playing})`,
    );
    await Z.shot('17-blank-to-pretty');

    /* 18: liner notes, on this card */
    const css = await Z.E(
      () =>
        document.getElementById('ew-sounds')?.textContent ||
        [...document.querySelectorAll('style')].map((x) => x.textContent).find((t) => /ew-sounds|\.snd-/.test(t)) ||
        '',
    );
    const sel = await Z.E(() => {
      const r = document.querySelector('.ledger-row.sel');
      if (!r) return null;
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      const ink = [...r.querySelectorAll('*')]
        .filter((x) => x.childNodes.length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        .map((x) => getComputedStyle(x).color);
      const probe = document.createElement('i');
      probe.style.color = bg;
      document.body.append(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return { all: ink.every((c) => c === want), n: ink.length };
    });
    const regions = await Z.E(
      () =>
        [...document.querySelectorAll('section, [role=region], .panel, .sketch')]
          .map((r) => r.querySelectorAll(':scope .btn-go').length)
          .filter((n) => n > 1).length,
    );
    T.ok(
      css.length > 0 && !/inset\s+-?\d+(\.\d+)?px\s+0\s+0/.test(css) && !/99px/.test(css) && sel?.all && regions === 0,
      `18: the card's CSS has no inset stripe and no 99px pill; the .sel row's text is all in --bg ink (${JSON.stringify(sel)}); no region has two .btn-go (${regions})`,
    );
    const by = await Z.E(async () => {
      const o = window.overdub;
      const id = o.ui.state.selection.track || o.store.get().tracks[0]?.id;
      if (!id) return null;
      await o.tools.run(
        'suggest_sounds',
        { track: id, sounds: [{ device: 'core.brass', why: 'bright' }] },
        { by: 'claude' },
      );
      await new Promise((r) => setTimeout(r, 300));
      return !!document.querySelector('.ledger-row .by-agent');
    });
    T.ok(by === true, `18: an agent's row carries its byline in cool ink (${by})`);
  });

  /* ---------------------------------------------------------------- 16: the Beatbox catch */
  await section('16 the Beatbox catch', async () => {
    const tune = await (async () => {
      const C = await fresh();
      await C.E(() => {
        const o = window.overdub;
        o.ui.show('sketch');
        o.input.emit('sketch:mode', 'tap');
      });
      await sleep(600);
      await C.page.locator('.sk-bb').click();
      await sleep(4500);
      await C.page.locator('.sk-bb').click();
      await sleep(1500);
      const offer = await C.E(() => ({
        line: document.body.innerText.match(/That sounded like a tune: \d+ notes\. Keep it as a melody\?/)?.[0] || '',
        focus: document.activeElement?.textContent?.trim() || '',
      }));
      const mk = await C.page
        .getByRole('button', { name: 'Make it a melody' })
        .first()
        .click()
        .then(() => true)
        .catch(() => false);
      await sleep(800);
      const mel = await C.E(
        () =>
          !!window.overdub.store.get().tracks.find((t) => t.name === 'Melody' && t.clips.some((c) => c.notes.length)),
      );
      return { offer, mk, mel };
    })();
    T.ok(
      /That sounded like a tune/.test(tune.offer.line) && tune.offer.focus === 'Keep the beat' && tune.mk && tune.mel,
      `16: the fake hum through Beatbox offers "Make it a melody" (Keep the beat focused), which lands a Melody track (${JSON.stringify(tune)})`,
    );
    const BB = await open('/app/', { query: 'view=simple', width: 1440, height: 900, fakeAudio: BEATBOX });
    try {
      await BB.page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
      await BB.page.evaluate(() => {
        const o = window.overdub;
        o.ui.show('sketch');
        o.input.emit('sketch:mode', 'tap');
      });
      await sleep(600);
      await BB.page.locator('.sk-bb').click();
      await sleep(4500);
      await BB.page.locator('.sk-bb').click();
      await sleep(1500);
      const none = await BB.page.evaluate(
        () =>
          !/That sounded like a tune/.test(document.body.innerText) &&
          ![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Make it a melody'),
      );
      T.ok(none, '16: the fake beatbox through Beatbox raises no offer');
    } finally {
      await BB.close();
    }
  });

  /* ---------------------------------------------------------------- 19: phone */
  await section('19 phone', async () => {
    const Ph = await fresh({ w: 390, h: 844, mobile: true });
    await Ph.E(() => {
      const o = window.overdub;
      o.store.dispatch(
        [
          { type: 'track.add', ref: 'm', track: { name: 'Melody', instrument: { device: 'core.keys' } } },
          { type: 'clip.add', track: '$m', clip: { start: 0, length: 4, notes: 'C4@0:1 E4@1:1' } },
        ],
        { by: 'you' },
      );
      const id = o.store.get().tracks[0].id;
      o.ui.select({ track: id });
      o.sounds?.offer?.({ track: id, from: 'header' });
    });
    await sleep(700);
    await Ph.E(() => {
      const o = window.overdub;
      o.sounds?.try?.(o.store.get().tracks[0].id, { device: 'core.wavetable' });
    });
    await sleep(600);
    const g = await Ph.E(() => {
      const rows = [...document.querySelectorAll('.ledger-row')]
        .filter((r) => r.getClientRects().length)
        .map((r) => r.getBoundingClientRect().height);
      const sheet = document.querySelector('.ledger-row')?.closest('[role=dialog], .sheet, .snd-sheet, .ew-sounds');
      const sb = sheet?.getBoundingClientRect();
      const btn = (re) =>
        [...document.querySelectorAll('button')].find(
          (b) => re.test(b.textContent.trim()) && b.getClientRects().length,
        );
      const keep = btn(/^Keep/),
        back = btn(/^Back/);
      return {
        rows,
        inside: sb ? sb.top >= 0 && sb.bottom <= innerHeight + 1 && sb.left >= 0 && sb.right <= innerWidth + 1 : false,
        keep: !!keep,
        back: !!back,
        kb: keep ? keep.getBoundingClientRect().bottom : 0,
      };
    });
    T.ok(
      g.rows.length >= 4 && g.rows.every((x) => x >= 44) && g.inside && g.keep && g.back,
      `19: on a phone the card's rows are 44 px or taller (${g.rows.map(Math.round).join(', ')}), the sheet is inside the viewport, Keep and Back are on screen`,
    );
    await Ph.page.touchscreen.tap(195, 40);
    await sleep(400);
    const still = await Ph.E(() => !!window.overdub.sounds?.trying?.() && !!window.overdub.sounds?.current);
    T.ok(still, '19: a tap above the sheet during a trial leaves it open and the trial on');
    await Ph.shot('19-phone');
  });

  /* ---------------------------------------------------------------- 20: the full studio */
  await section('20 full studio', async () => {
    const Fu = await fresh({ query: 'view=full' });
    await Fu.E(async () => {
      const o = window.overdub,
        rec = o.input.recorder;
      o.store.dispatch(
        [{ type: 'track.add', ref: 'd', track: { name: 'Drums', instrument: { device: 'core.drums' } } }],
        { by: 'you' },
      );
      o.ui.select({ track: o.store.get().tracks[0].id });
      rec.setAim?.('hum', 'new');
      await rec.record({ countIn: 0, quantize: false });
      rec.addNotes(
        [60, 64, 67].map((p, i) => ({ p, g: i, d: 0.9, v: 0.8 })),
        { src: 'hum' },
      );
      await new Promise((r) => setTimeout(r, 150));
      await rec.stop();
    });
    await sleep(900);
    const f = await Fu.E(() => {
      const o = window.overdub,
        m = o.store.get().tracks.at(-1);
      const head = document.querySelector(`.ar-head[data-track="${m.id}"] .ar-hsounds`);
      return {
        card: !!o.sounds?.current,
        toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '),
        pending: !!head && head.getClientRects().length > 0 && !!o.sounds?.pending?.(m.id),
      };
    });
    T.ok(
      !f.card && /What should it sound like\?\s*Sounds/.test(f.toast) && f.pending,
      `20: in the full studio the card doesn't open by itself; the toast has the Sounds line and the header shows Sounds pending (${JSON.stringify(f)})`,
    );
    T.ok(
      /back\. What should it sound like\?/.test(f.toast),
      `20: the toast's two sentences have a space between them ("${f.toast.slice(0, 120)}")`,
    );
    await Fu.page.locator('.ew-toast .snd-tl-b').first().click();
    await sleep(400);
    const g = await Fu.E(() => ({
      card: !!window.overdub.sounds?.current,
      line: !!document.querySelector('.ew-toast .snd-tl'),
    }));
    T.ok(
      g.card && !g.line,
      `20: Sounds in the toast opens the card, and the toast's line goes, asked and answered (${JSON.stringify(g)})`,
    );
  });

  await section('21 a sampled sound on a slow network', async () => {
    const B = await fresh({ query: 'view=full' });
    // every kit file held 3 s on its way, as a slow connection would (ui/kitload.js, kernel/data.js)
    const reqs = [];
    await B.page.route(/\/app\/kits\/[0-9a-f]{64}\.odkz?$/, async (route) => {
      reqs.push(
        route
          .request()
          .url()
          .replace(/^.*\/([0-9a-f]{12})[0-9a-f]+(\.odkz?)$/, '$1$2'),
      );
      await sleep(3000);
      await route.continue().catch(() => {});
    });
    const hex = (id) => B.E((d) => window.overdub.devices.getDevice(d).data.kit.slice(7, 19), id);
    const [ens, gtr] = [await hex('core.ensemble'), await hex('core.eguitar')];
    // a chord held four beats on Keys: Rosin is in the chords rows
    await B.E(() => {
      const o = window.overdub;
      o.store.dispatch(
        [
          { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
          { type: 'clip.add', track: '$k', clip: { start: 0, length: 8, notes: 'C4@0:4 E4@0:4 G4@0:4' } },
        ],
        { by: 'you' },
      );
      const id = o.store.get().tracks.at(-1).id;
      window.__keys = id;
      o.ui.select({ track: id });
      o.sounds.offer({ track: id, from: 'header' });
    });
    await sleep(500);
    const shown = await B.E(() => [...document.querySelectorAll('.snd-row')].map((r) => r.dataset.device));
    T.ok(
      shown.includes('core.ensemble') && reqs.some((r) => r.startsWith(ens)),
      `21: the card shows Rosin in the chords rows, and its samples start coming before anything is tried (rows ${shown.join(', ')}; asked for ${reqs.join(', ')})`,
    );
    // what the first chord sounds like, and when the take starts, against when the samples are in
    await B.E(
      (h) => {
        const o = window.overdub,
          id = window.__keys;
        window.__k = { peaks: [], start: null };
        import('/app/src/kernel/data.js').then((D) => {
          window.__k.D = D;
        });
        o.engine.on('transport', (e) => {
          if (e.playing && !window.__k.start)
            window.__k.start = { t: performance.now(), state: window.__k.D?.dataState('sha256-' + h) || null };
        });
        window.__k.iv = setInterval(async () => {
          const v = await o.engine.voices?.();
          const p = v?.[id]?.peak;
          window.__k.peaks.push({ t: performance.now(), p: p == null ? -180 : p });
        }, 50);
      },
      await B.E(() => window.overdub.devices.getDevice('core.ensemble').data.kit.slice(7)),
    );
    await B.page.locator('.snd-row[data-device="core.ensemble"]').click();
    await sleep(500);
    const ld = await B.E(() => {
      const row = document.querySelector('.snd-row[data-device="core.ensemble"] .kitload'),
        head = document.querySelector(`.ar-head[data-track="${window.__keys}"] > .kitload`);
      return {
        row: row && !row.hidden ? row.textContent : '',
        head: head && !head.hidden ? head.getAttribute('aria-label') || '' : '',
        status: document.querySelector('.snd-status')?.textContent || '',
        playing: !!window.overdub.engine.playing,
      };
    });
    await B.shot('21-loading');
    T.ok(
      /Loading samples/.test(ld.row) &&
        /Loading its samples/.test(ld.head) &&
        /Loading Rosin’s samples.*It plays once they’re in/.test(ld.status) &&
        !ld.playing,
      `21: tried while its samples load, Rosin says so on its row, the track's header and the status line, and the take hasn't started (${JSON.stringify(ld)})`,
    );
    const began = await B.until(() => window.__k.start, null, 12000);
    await sleep(1500);
    const r = await B.E(() => {
      clearInterval(window.__k.iv);
      const k = window.__k,
        s = k.start;
      const first = k.peaks.filter((x) => s && x.t >= s.t && x.t <= s.t + 1200);
      return {
        state: s && s.state,
        max: Math.max(-180, ...first.map((x) => x.p)),
        row: document.querySelector('.snd-row[data-device="core.ensemble"] .kitload')?.hidden !== false,
        status: document.querySelector('.snd-status')?.textContent || '',
      };
    });
    T.ok(
      began && r.state === 'ready' && r.max > -50 && r.row,
      `21: once they're in, the take starts from its first chord and it sounds (the samples ${r.state} when it started; the first 1.2 s peak at ${r.max} dBFS; the row's loading line gone)`,
    );
    T.ok(/Hearing .* on Rosin/.test(r.status), `21: the status line goes back to what it's hearing ("${r.status}")`);
    await B.E(() => {
      window.overdub.engine.stop?.();
      window.overdub.sounds.back?.();
      window.overdub.sounds.close?.();
    });
    // the browser: resting the pointer on Hollow Body starts its samples, and its row says how far along they are
    await B.E(() => window.overdub.ui.show('browser'));
    await sleep(500);
    await B.E(() => window.overdub.browser?.search?.('Hollow Body'));
    await sleep(500);
    const n0 = reqs.length;
    await B.page.locator('.br-row[data-device="core.eguitar"]').first().hover();
    await sleep(400);
    const hv = await B.E(() => {
      const k = document.querySelector('.br-row[data-device="core.eguitar"] .kitload');
      return k && !k.hidden ? k.textContent : '';
    });
    T.ok(
      reqs.slice(n0).some((x) => x.startsWith(gtr)) && /Loading samples/.test(hv),
      `21: in the browser, the pointer on Hollow Body starts its samples, and its row says Loading ("${hv}"; asked for ${reqs.slice(n0).join(', ')})`,
    );
    // a key pressed while they load sounds once they're in, if it is still down
    const live = await B.E(async () => {
      const o = window.overdub;
      o.store.dispatch(
        { type: 'track.add', ref: 'g', track: { name: 'Guitar', instrument: { device: 'core.eguitar' } } },
        { by: 'you' },
      );
      const id = o.store.get().tracks.at(-1).id;
      await o.engine.settled?.();
      let waited = 0;
      const off = o.engine.on('kitwait', (e) => {
        if (e.track === id) waited++;
      });
      const state0 = o.engine.instance(id)?.data?.state;
      o.engine.liveNoteOn(id, 64, 0.9);
      const peaks = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 6000) {
        await new Promise((r) => setTimeout(r, 60));
        const v = await o.engine.voices();
        peaks.push({ t: performance.now() - t0, p: v?.[id]?.peak ?? -180, ready: o.engine.instance(id)?.data?.state });
        if (peaks.at(-1).ready === 'ready' && peaks.filter((x) => x.ready === 'ready').length > 12) break;
      }
      o.engine.liveNoteOff(id, 64);
      off();
      const after = peaks.filter((x) => x.ready === 'ready');
      return {
        state0,
        waited,
        before: Math.max(-180, ...peaks.filter((x) => x.ready !== 'ready').map((x) => x.p)),
        after: Math.max(-180, ...after.map((x) => x.p)),
      };
    });
    T.ok(
      live.state0 === 'loading' && live.waited === 1 && live.after > -50,
      `21: a key pressed on Hollow Body while its samples load waits (kitwait once) and sounds once they're in, still held (${JSON.stringify(live)})`,
    );
  });

  const all = [...s.errors, ...pages.flatMap((p) => p.errors)].filter((e) => !ignorable(e));
  T.ok(!all.length, `no page errors${all.length ? ': ' + all.slice(0, 3).join(' | ') : ''}`);
} finally {
  for (const p of pages) await p.ctx.close().catch(() => {});
  await s.close();
}
T.done();
