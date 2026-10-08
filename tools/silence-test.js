// The killswitch, clip mute and taming a long take (docs/ARCHITECTURE.md, "The killswitch" and "Muted clips").
//   1. Node: clip.set { mute } round-trips exactly, is checked, survives normalising, a share link and the DAWproject
//      export; an agent's apply_ops mute is signed by the agent; a muted clip is absent from the Node render.
//   2. The studio: engine.silence() on a song with long reverb and delay tails, held notes, an audition and the
//      metronome reaches -90 dBFS at the speakers within 50 ms; nothing comes back when the feed opens; the next play
//      sounds as the first did. A muted clip is absent from engine.render. Keys (0, Shift+Esc), the clip menu (Mute,
//      Trim to the loop, the selection too), the transport's button and a Sketch take's Stop.
//
//   node tools/silence-test.js
import { open, tally } from './pw.js';
import { createStore } from '../app/src/core/store.js';
import { cleanProject as normProject, summarize } from '../app/src/core/project.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { encodeShare, decodeShare } from '../app/src/core/share.js';
import { dawprojectXml } from '../app/src/core/dawproject.js';
import * as tools from '../app/src/agent/tools.js';
import { getDevice } from '../app/src/devices/registry.js';

const t = tally('silence');
const dbOf = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
const peakOf = (chs, a = 0, b = Infinity) => {
  let pk = 0;
  for (const d of chs)
    for (let i = Math.max(0, a); i < Math.min(d.length, b); i++) {
      const v = Math.abs(d[i]);
      if (v > pk) pk = v;
    }
  return pk;
};
const J = (x) => JSON.stringify({ ...x, meta: null }); // (meta: the modified time and who has edited move on every edit)

const song = (mute = {}) => ({
  format: 'overdub/0',
  id: 'p_silnc1',
  title: 'Silence',
  tempo: 120,
  meter: [4, 4],
  key: null,
  loop: { on: false, start: 0, end: 16 },
  tracks: [
    {
      id: 't_keys01',
      name: 'Keys',
      kind: 'instrument',
      instrument: { device: 'core.keys', params: {} },
      inserts: [],
      clips: [
        {
          id: 'c_keys01',
          kind: 'notes',
          start: 0,
          length: 8,
          ...(mute.keys ? { mute: true } : {}),
          notes: [
            { id: 'n1', p: 60, t: 0, d: 2, v: 0.8 },
            { id: 'n2', p: 64, t: 2, d: 2, v: 0.8 },
            { id: 'n3', p: 67, t: 4, d: 2, v: 0.8 },
          ],
        },
      ],
      gain: 0,
      pan: 0,
      mute: false,
      solo: false,
    },
    {
      id: 't_bass01',
      name: 'Bass',
      kind: 'instrument',
      instrument: { device: 'core.bass', params: {} },
      inserts: [],
      clips: [
        {
          id: 'c_bass01',
          kind: 'notes',
          start: 0,
          length: 8,
          notes: [
            { id: 'n1', p: 36, t: 0, d: 1, v: 0.8 },
            { id: 'n2', p: 36, t: 4, d: 1, v: 0.8 },
          ],
        },
      ],
      gain: 0,
      pan: 0,
      mute: false,
      solo: false,
    },
  ],
  sections: [],
  devices: {},
  assets: {},
  master: { gain: 0, inserts: [] },
  meta: {},
});

/* ------------------------------------------------------------------ 1. Node */
{
  const store = createStore(normProject(song()), { getDevice });
  const before = J(store.get());
  t.ok(!('mute' in store.get().tracks[0].clips[0]), 'an older clip has no mute flag (it plays)');
  let r = store.dispatch(
    { type: 'clip.set', track: 't_keys01', clip: 'c_keys01', patch: { mute: true } },
    { by: 'you', label: 'mute clip' },
  );
  const muted = J(store.get());
  t.ok(r.ok && store.get().tracks[0].clips[0].mute === true, 'clip.set { mute: true } mutes the clip');
  store.undo();
  t.ok(J(store.get()) === before, 'undo puts the clip back exactly (no mute key left behind)');
  store.redo();
  t.ok(J(store.get()) === muted, 'redo mutes it again, exactly');
  r = store.dispatch({ type: 'clip.set', track: 't_keys01', clip: 'c_keys01', patch: { mute: false } }, { by: 'you' });
  t.ok(r.ok && J(store.get()) === before, 'clip.set { mute: false } stores no flag at all, like an older song');
  store.undo();
  t.ok(J(store.get()) === muted, 'and its undo mutes it again');
  r = store.dispatch({ type: 'clip.set', track: 't_keys01', clip: 'c_keys01', patch: { mute: 'yes' } }, { by: 'you' });
  t.ok(!r.ok && /mute must be true or false/.test(r.error), `a mute that isn't a boolean is refused (${r.error})`);
  t.ok(normProject(JSON.parse(muted)).tracks[0].clips[0].mute === true, 'normalising a song keeps a muted clip muted');
  t.ok(/\(muted\)/.test(summarize(store.get())), "the agent's summary says the clip is muted");

  // a share link and the DAWproject export carry it
  const enc = await encodeShare(store.get());
  const dec = await decodeShare(enc.hash);
  const got = dec.ok ? normProject(dec.song).tracks[0].clips[0] : null;
  t.ok(got && got.mute === true, 'a share link keeps the clip muted');
  const xml = dawprojectXml(store.get(), { getDevice }).project;
  t.ok(
    /<Clip[^>]*enable="false"/.test(xml) && (xml.match(/enable="false"/g) || []).length === 1,
    'the DAWproject export marks the muted clip enable="false" (and only it)',
  );

  // an agent mutes with apply_ops: signed by the agent
  const app = { store, devices: { getDevice }, ui: { emit() {}, toast() {} } };
  tools.installTools(app);
  const ap = await app.tools.run(
    'apply_ops',
    {
      label: 'mute the bass',
      reason: 'let the keys breathe',
      ops: [{ type: 'clip.set', track: 'Bass', clip: 'c_bass01', patch: { mute: true } }],
    },
    { by: 'mcp:probe' },
  );
  const last = store.history[store.history.length - 1];
  t.ok(
    ap.ok !== false && !ap.error && store.get().tracks[1].clips[0].mute === true && last.by === 'mcp:probe',
    `an agent's apply_ops mute lands, signed by the agent (by ${last && last.by})`,
  );

  // the Node render: a muted clip is absent
  const full = renderSong(song(), { to: 8, tail: 0.5 });
  const keysOnly = renderSong(song(), { to: 8, tail: 0.5, tracks: ['t_keys01'] });
  const keysMuted = renderSong(song({ keys: true }), { to: 8, tail: 0.5, tracks: ['t_keys01'] });
  const bassOnly = renderSong(song(), { to: 8, tail: 0.5, tracks: ['t_bass01'] });
  const allMuted = renderSong(song({ keys: true }), { to: 8, tail: 0.5 });
  const pk = (x) => dbOf(peakOf(x.channels));
  let diff = 0;
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < allMuted.length; i++)
      diff = Math.max(diff, Math.abs(allMuted.channels[c][i] - bassOnly.channels[c][i]));
  t.ok(
    pk(keysOnly) > -40 && pk(keysMuted) <= -180 && dbOf(diff) <= -180,
    `Node render: the keys clip peaks ${pk(keysOnly).toFixed(1)} dBFS, muted ${pk(keysMuted) <= -180 ? 'digital silence' : pk(keysMuted).toFixed(1) + ' dBFS'}; the song with it muted is the bass alone, sample for sample (full song ${pk(full).toFixed(1)} dBFS)`,
  );
}

/* ------------------------------------------------------------------ 2. the studio */
const { page, errors, close, shot } = await open('/app/');
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
await page.evaluate(() => {
  // record what a live node sends (both channels, with the audio time of the first block) until stop()
  window.__cap = async (ctx, node) => {
    // ('cap-sil', from a file on the studio's origin: its policy refuses a worklet made from a string)
    if (!ctx.__cap) ctx.__cap = ctx.audioWorklet.addModule('/tools/test-worklets.js');
    await ctx.__cap;
    const cap = new AudioWorkletNode(ctx, 'cap-sil', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    const chunks = [];
    let done = null;
    cap.port.onmessage = (e) => {
      if (e.data === 'end') done && done();
      else chunks.push(e.data);
    };
    const z = ctx.createGain();
    z.gain.value = 0;
    cap.connect(z);
    z.connect(ctx.destination);
    node.connect(cap);
    return {
      stop: () =>
        new Promise((res) => {
          done = () => {
            try {
              node.disconnect(cap);
            } catch (e) {
              /* ok */
            }
            cap.disconnect();
            z.disconnect();
            const n = chunks.reduce((a, c) => a + c[0].length, 0),
              L = new Float32Array(n),
              R = new Float32Array(n);
            let w = 0;
            for (const [l, r] of chunks) {
              L.set(l, w);
              R.set(r, w);
              w += l.length;
            }
            res({ L, R, t0: chunks.length ? chunks[0][2] : 0, sr: ctx.sampleRate });
          };
          cap.port.postMessage('stop');
        }),
    };
  };
  const idx = (c, t) => Math.max(0, Math.min(c.L.length, Math.round((t - c.t0) * c.sr)));
  window.__peak = (c, a, b) => {
    let pk = 0;
    for (let i = idx(c, a); i < idx(c, b); i++) pk = Math.max(pk, Math.abs(c.L[i]), Math.abs(c.R[i]));
    return pk;
  };
  window.__rms = (c, a, b) => {
    let s = 0,
      n = 0;
    for (let i = idx(c, a); i < idx(c, b); i++) {
      s += c.L[i] * c.L[i] + c.R[i] * c.R[i];
      n += 2;
    }
    return Math.sqrt(s / Math.max(1, n));
  };
  // the last moment after t that the capture was over thr (seconds after t), or 0
  window.__lastOver = (c, t, thr) => {
    let last = -1;
    for (let i = idx(c, t); i < c.L.length; i++) if (Math.abs(c.L[i]) > thr || Math.abs(c.R[i]) > thr) last = i;
    return last < 0 ? 0 : last / c.sr + c.t0 - t;
  };
  window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
});

// a song made to ring: a pad into a 20 s reverb and a 0.9 feedback delay, a bass, held and auditioned notes, the click
const kill = await page.evaluate(async () => {
  const { store, engine } = window.overdub;
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
  store.load(
    {
      format: 'overdub/0',
      id: 'p_ring01',
      title: 'Ring',
      tempo: 120,
      meter: [4, 4],
      key: null,
      loop: { on: true, start: 0, end: 16 },
      tracks: [
        {
          id: 't_pad001',
          name: 'Pad',
          kind: 'instrument',
          instrument: { device: 'core.pad', params: {} },
          inserts: [
            { id: 'fx_verb01', device: 'core.verb', on: true, params: { decay: 20, mix: 0.6 } },
            { id: 'fx_dly001', device: 'core.delay', on: true, params: { feedback: 0.9, mix: 0.5 } },
          ],
          clips: [
            {
              id: 'c_pad001',
              kind: 'notes',
              start: 0,
              length: 16,
              notes: [
                { id: 'n1', p: 60, t: 0, d: 16, v: 0.9 },
                { id: 'n2', p: 64, t: 0, d: 16, v: 0.9 },
                { id: 'n3', p: 67, t: 0, d: 16, v: 0.9 },
              ],
            },
          ],
          gain: 0,
          pan: 0,
          mute: false,
          solo: false,
        },
        {
          id: 't_keys01',
          name: 'Keys',
          kind: 'instrument',
          instrument: { device: 'core.keys', params: {} },
          inserts: [{ id: 'fx_verb02', device: 'core.verb', on: true, params: { decay: 12, mix: 0.5 } }],
          clips: [
            {
              id: 'c_keys01',
              kind: 'notes',
              start: 0,
              length: 16,
              notes: Array.from({ length: 16 }, (_, i) => ({ id: 'n' + i, p: 72 + (i % 4) * 3, t: i, d: 0.5, v: 0.8 })),
            },
          ],
          gain: 0,
          pan: 0,
          mute: false,
          solo: false,
        },
      ],
      sections: [],
      devices: {},
      assets: {},
      master: { gain: 0, inserts: [{ id: 'fx_mverb', device: 'core.verb', on: true, params: { decay: 8, mix: 0.3 } }] },
      meta: {},
    },
    { by: 'overdub' },
  );
  await engine.start();
  await engine.settled();
  const ctx = engine.ctx;
  let silences = 0;
  const off = engine.on('silence', () => silences++);
  engine.metronome = true;
  const instOf = () => ({
    pad: engine.instance('t_pad001'),
    verb: engine.instance('t_pad001', 'fx_verb01'),
    dly: engine.instance('t_pad001', 'fx_dly001'),
    mverb: engine.instance('master', 'fx_mverb'),
  });
  const insts0 = instOf();
  const c1 = await window.__cap(ctx, engine._monitor);
  const tPlay1 = ctx.currentTime;
  await engine.play(0);
  await window.__sleep(1600);
  engine.liveNoteOn('t_keys01', 48, 0.9); // held: no note-off ever comes
  engine.audition('t_pad001', 55, 0.9, 64); // a long audition
  await window.__sleep(400);
  const tKill = ctx.currentTime,
    t0 = performance.now();
  let renewMs = 0;
  const job = engine.silence().then(() => {
    renewMs = performance.now() - t0;
  });
  const stoppedAtOnce = !engine.playing;
  await window.__sleep(400);
  const r1 = await c1.stop();
  await job;
  const insts = instOf();
  // the feed is open again: nothing may come back (tails were reset with the devices)
  const c2 = await window.__cap(ctx, engine._monitor);
  await window.__sleep(300);
  const tPlay2 = ctx.currentTime;
  await engine.play(0);
  await window.__sleep(2000);
  engine.stop();
  const r2 = await c2.stop();
  engine.metronome = false;
  await engine.silence();
  off();
  const thr = Math.pow(10, -90 / 20);
  return {
    before: db(window.__peak(r1, tKill - 0.4, tKill)),
    after50: db(window.__peak(r1, tKill + 0.05, tKill + 0.4)),
    toMinus90: window.__lastOver(r1, tKill, thr) * 1000,
    after30: db(window.__peak(r1, tKill + 0.03, tKill + 0.4)),
    reopened: db(window.__peak(r2, r2.t0, tPlay2 + 0.05)),
    rms1: db(window.__rms(r1, tPlay1 + 0.3, tPlay1 + 1.6)),
    rms2: db(window.__rms(r2, tPlay2 + 0.3, tPlay2 + 1.6)),
    curve: [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5]
      .map((a) =>
        [
          db(window.__rms(r1, tPlay1 + a, tPlay1 + a + 0.2)).toFixed(1),
          db(window.__rms(r2, tPlay2 + a, tPlay2 + a + 0.2)).toFixed(1),
        ].join('/'),
      )
      .join(' '),
    pk2: db(window.__peak(r2, tPlay2, tPlay2 + 2)),
    stoppedAtOnce,
    silences,
    renewMs,
    playing: engine.playing,
    rebuilt: !!(
      insts.verb &&
      insts.dly &&
      insts.pad &&
      insts.mverb &&
      insts.verb !== insts0.verb &&
      insts.pad !== insts0.pad
    ),
  };
});
t.ok(
  kill.before > -30,
  `the song is ringing before the killswitch (${kill.before.toFixed(1)} dBFS peak at the speakers)`,
);
t.ok(
  kill.stoppedAtOnce && kill.silences >= 1,
  "engine.silence() stops the transport at once and tells everyone ('silence')",
);
t.ok(
  kill.after50 <= -90 && kill.toMinus90 <= 50,
  `silence reaches -90 dBFS ${kill.toMinus90.toFixed(1)} ms after the killswitch (peak from 50 ms on: ${kill.after50.toFixed(1)} dBFS; from 30 ms: ${kill.after30.toFixed(1)}) with a 20 s reverb, a 0.9 feedback delay, a held note, an audition and the click going`,
);
t.ok(
  kill.reopened <= -90,
  `the speakers open again ${kill.renewMs.toFixed(0)} ms after the killswitch, on fresh devices, and no tail comes back (${kill.reopened.toFixed(1)} dBFS until the next play)`,
);
t.note('rms first/second play, 200 ms windows: ' + kill.curve);
t.ok(
  kill.pk2 > -30 && Math.abs(kill.rms1 - kill.rms2) < 3 && kill.rebuilt,
  `the next play sounds as the first did, on rebuilt devices (rms ${kill.rms2.toFixed(2)} vs ${kill.rms1.toFixed(2)} dBFS over the same 1.3 s; the pad's modulation runs on the audio clock, so not bit for bit)`,
);

// engine.render: a muted clip is absent
const off = await page.evaluate(async () => {
  const { store, engine } = window.overdub;
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
  const pk = (b) => {
    let m = 0;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    }
    return m;
  };
  const a = await engine.render({ from: 0, to: 8, tail: 0.5, tracks: ['t_keys01'] });
  store.dispatch({ type: 'clip.set', track: 't_keys01', clip: 'c_keys01', patch: { mute: true } }, { by: 'you' });
  const b = await engine.render({ from: 0, to: 8, tail: 0.5, tracks: ['t_keys01'] });
  store.undo();
  return { a: db(pk(a)), b: db(pk(b)) };
});
t.ok(
  off.a > -40 && off.b <= -120,
  `engine.render: the keys clip peaks ${off.a.toFixed(1)} dBFS, muted ${off.b <= -180 ? 'digital silence' : off.b.toFixed(1) + ' dBFS'}`,
);

// keys and menus in the arranger
await page.evaluate(() => {
  const { store } = window.overdub;
  store.load(
    {
      format: 'overdub/0',
      id: 'p_keys01',
      title: 'Keys',
      tempo: 120,
      meter: [4, 4],
      key: null,
      loop: { on: false, start: 4, end: 8 },
      tracks: [
        {
          id: 't_a00001',
          name: 'Lead',
          kind: 'instrument',
          instrument: { device: 'core.keys', params: {} },
          inserts: [],
          clips: [
            {
              id: 'c_long01',
              kind: 'notes',
              start: 0,
              length: 16,
              name: 'Long take',
              notes: Array.from({ length: 16 }, (_, i) => ({
                id: 'n' + (i + 1),
                p: 60 + (i % 5),
                t: i,
                d: 0.5,
                v: 0.8,
              })),
            },
          ],
          gain: 0,
          pan: 0,
          mute: false,
          solo: false,
        },
        {
          id: 't_b00001',
          name: 'Bass',
          kind: 'instrument',
          instrument: { device: 'core.bass', params: {} },
          inserts: [],
          clips: [
            { id: 'c_bass02', kind: 'notes', start: 0, length: 8, notes: [{ id: 'n1', p: 36, t: 0, d: 1, v: 0.8 }] },
          ],
          gain: 0,
          pan: 0,
          mute: false,
          solo: false,
        },
      ],
      sections: [],
      devices: {},
      assets: {},
      master: { gain: 0, inserts: [] },
      meta: {},
    },
    { by: 'overdub' },
  );
  window.overdub.ui.show?.('arranger');
});
await page.waitForTimeout(150);
await page.focus('.ar-scroll');
await page.keyboard.press('ArrowRight'); // the cursor: the first clip, selected
const clipOf = (id) =>
  page.evaluate((i) => {
    for (const tr of window.overdub.store.get().tracks) for (const c of tr.clips) if (c.id === i) return c;
    return null;
  }, id);
const lastTxn = () =>
  page.evaluate(() => {
    const h = window.overdub.store.history;
    const x = h[h.length - 1];
    return x ? { by: x.by, label: x.label } : null;
  });
await page.keyboard.press('Digit0');
const k1 = await clipOf('c_long01'),
  tx1 = await lastTxn();
await page.waitForTimeout(80);
await shot('silence-muted-clip');
await page.keyboard.press('Digit0');
const k2 = await clipOf('c_long01');
t.ok(
  k1.mute === true && tx1.by === 'you' && /mute/.test(tx1.label) && !k2.mute,
  `0 mutes the selected clip (by you, "${tx1.label}") and 0 again unmutes it`,
);

// the menu: Mute, on the whole selection
await page.focus('.ar-scroll');
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
await page.keyboard.press('Shift+F10');
await page.waitForSelector('[role=menu] [role=menuitem]');
const items = await page.$$eval('[role=menu] [role=menuitem]', (els) => els.map((e) => e.textContent));
const muteItem = await page.$('[role=menu] [role=menuitem]:has-text("Mute 2 clips")');
t.ok(
  !!muteItem,
  `the clip menu offers Mute for the whole selection (${items.filter((x) => /Mute|Trim/.test(x)).join(' · ')})`,
);
const h0 = await page.evaluate(() => window.overdub.store.history.length);
if (muteItem) await muteItem.click();
const both = [await clipOf('c_long01'), await clipOf('c_bass02')];
const h1 = await page.evaluate(() => window.overdub.store.history.length);
t.ok(
  both.every((c) => c.mute === true) && h1 === h0 + 1,
  'Mute in the menu mutes both selected clips in one undo step',
);
await page.focus('.ar-scroll');
await page.keyboard.press('Shift+F10');
await page.waitForSelector('[role=menu] [role=menuitem]');
const unmute = await page.$('[role=menu] [role=menuitem]:has-text("Unmute 2 clips")');
if (unmute) await unmute.click();
const both2 = [await clipOf('c_long01'), await clipOf('c_bass02')];
t.ok(!!unmute && both2.every((c) => !('mute' in c)), 'and Unmute brings them both back (no flag left)');

// Trim to the loop: the long take keeps bars 2 (beats 4-8), notes where they sound
const docNow = () => page.evaluate(() => JSON.stringify({ ...window.overdub.store.get(), meta: null }));
const beforeTrim = await docNow();
await page.evaluate(() =>
  window.overdub.store.dispatch(
    { type: 'project.set', patch: { loop: { on: true, start: 4, end: 8 } } },
    { by: 'you' },
  ),
);
await page.focus('.ar-scroll');
await page.keyboard.press('Escape');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Shift+F10');
await page.waitForSelector('[role=menu] [role=menuitem]');
const trimItem = await page.$('[role=menu] [role=menuitem]:has-text("Trim to the loop")');
if (trimItem) await trimItem.click();
const trimmed = await clipOf('c_long01');
const notesOk =
  trimmed && trimmed.notes.length === 12 && trimmed.notes[0].t === 0 && trimmed.notes[0].p === 60 + (4 % 5);
t.ok(
  trimmed && trimmed.start === 4 && trimmed.length === 4 && notesOk,
  `Trim to the loop cuts the 16-beat take to beats 4-8 (start ${trimmed?.start}, length ${trimmed?.length}; ${trimmed?.notes.length} notes kept, the first where it sounded)`,
);
await page.evaluate(() => {
  window.overdub.store.undo();
  window.overdub.store.undo();
});
const afterUndo = await docNow();
if (afterUndo !== beforeTrim) {
  let i = 0;
  while (afterUndo[i] === beforeTrim[i]) i++;
  t.note('before: ' + beforeTrim.slice(i - 120, i + 80));
  t.note('after:  ' + afterUndo.slice(i - 120, i + 80));
}
t.ok(afterUndo === beforeTrim, 'undo puts the take back exactly');

// the trim handle: hovering an edge lights it (drawn), dragging it trims (the long take's right edge to beat 8)
const edge = await page.evaluate(() => {
  const sc = document.querySelector('.ar-scroll'),
    r = sc.getBoundingClientRect();
  const c = window.overdub.store.get().tracks[0].clips[0];
  const loc = (b) => {
    for (let x = 0; x < r.width; x += 1) {
      const l = window.overdub.arranger.locate(r.left + x, r.top + 10);
      if (l && l.beat >= b) return r.left + x;
    }
    return null;
  };
  return { x: loc(c.start + c.length) - 3, x8: loc(8), y: r.top + 30 };
});
if (edge.x && edge.x8) {
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x8, edge.y, { steps: 6 });
  await page.mouse.up();
}
const dragged = await clipOf('c_long01');
t.ok(
  dragged && dragged.start === 0 && Math.abs(dragged.length - 8) < 0.26,
  `dragging the clip's right edge trims the take (length ${dragged?.length})`,
);
await page.evaluate(() => window.overdub.store.undo());

// the killswitch: Shift+Esc (even from a text field) and the transport's button
const ks = await page.evaluate(async () => {
  const { engine } = window.overdub;
  let n = 0;
  const off2 = engine.on('silence', () => n++);
  await engine.play(0);
  await new Promise((r) => setTimeout(r, 300));
  const inp = document.createElement('input');
  document.body.append(inp);
  inp.focus();
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', shiftKey: true, bubbles: true }));
  inp.remove();
  const byKey = { n, playing: engine.playing };
  await engine.play(0);
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('.tp-kill').click();
  const byBtn = { n, playing: engine.playing };
  off2();
  return { byKey, byBtn, label: document.querySelector('.tp-kill')?.getAttribute('aria-label') };
});
t.ok(ks.byKey.n === 1 && !ks.byKey.playing, 'Shift+Esc is the killswitch, from inside a text field too');
t.ok(
  ks.byBtn.n === 2 && !ks.byBtn.playing && /silence everything/i.test(ks.label || ''),
  'the transport\'s "All off" button (named "silence everything") is the same killswitch',
);
const keyListed = await page.evaluate(
  () =>
    window.overdub.ui.keys.list().some((k) => k.key === 'Escape' && k.mod === 'shift' && /Silence/.test(k.label)) &&
    window.overdub.ui.keys.list().some((k) => k.key === 'Digit0' && /Mute/.test(k.label)),
);
t.ok(keyListed, 'both keys are in the "?" sheet (Shift+Esc, 0)');

// a Sketch take's Hear turns into Stop, and the killswitch stops it
const sk = await page.evaluate(async () => {
  const app = window.overdub;
  app.ui.show('sketch');
  const ph = app.input.capture.add({
    src: 'qwerty',
    kind: 'notes',
    label: 'Typed',
    track: 't_a00001',
    notes: Array.from({ length: 32 }, (_, i) => ({ p: 60 + (i % 7), t: i * 0.5, d: 0.4, v: 0.8 })),
  });
  await new Promise((r) => setTimeout(r, 400));
  const btn = () => document.querySelector(`.sk-hear[data-id="${ph.id}"]`);
  if (!btn()) return { found: false };
  btn().click();
  await new Promise((r) => setTimeout(r, 300));
  const on = btn().getAttribute('aria-pressed');
  btn().click();
  const offByClick = btn().getAttribute('aria-pressed');
  btn().click();
  await new Promise((r) => setTimeout(r, 200));
  const on2 = btn().getAttribute('aria-pressed');
  await app.transport.silence();
  return { found: true, on, offByClick, on2, offBySilence: btn().getAttribute('aria-pressed') };
});
t.ok(
  sk.found && sk.on === 'true' && sk.offByClick === 'false',
  "a take's Hear button is Stop while it plays, and stops it",
);
t.ok(sk.found && sk.on2 === 'true' && sk.offBySilence === 'false', 'the killswitch stops a take that is previewing');

const real = errors.filter((e) => !/Failed to load resource|favicon|fonts\.g/.test(e));
t.ok(!real.length, 'no page errors' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));
await close();
t.done();
