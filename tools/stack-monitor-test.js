// Playing live through Half Stack, in a QUIET Chromium (tools/pw.js): a guitar on an
// interface, monitored through an armed audio track's inserts (input/audioin.js, engine.inputNode). The interface is a
// page-made stream named as a Scarlett (tools/input-test.js's way), so monitoring starts by itself as it would for a
// player. A click goes in at a known audio-clock time; what reaches the speakers is recorded from the node wired to
// the destination: with Half Stack on the track, with it bypassed, and with no insert at all. Against no insert the amp
// adds only its declared 28 samples (0.58 ms), within 1 ms. (A bypassed kernel keeps delaying its dry path by its
// declared latency, engine/strip.js, so the bypassed path shows only latency the amp has and doesn't declare.)
// engine.latency reports the track's latency; plugin delay compensation never holds live input back.
//   node tools/stack-monitor-test.js        (HEADED=1 to watch)
import { open, tally } from './pw.js';

const T = tally('stack-monitor');
const NAMED = `(() => {
  const md = navigator.mediaDevices;
  window.__devs = { 'scarlett-1': 'Scarlett 2i2 USB', default: 'Default - Scarlett 2i2 USB' };
  md.enumerateDevices = async () => Object.entries(window.__devs).map(([deviceId, label]) => ({ deviceId, label, kind: 'audioinput', groupId: 'g' }));
  md.getUserMedia = async (c) => {
    const app = window.overdub; await app.engine.start();
    const ctx = app.engine.ctx, want = c && c.audio && c.audio.deviceId, id = (want && (want.exact || want)) || 'default';
    if (!window.__bus || window.__bus.context !== ctx) window.__bus = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    window.__bus.connect(dest);
    const tr = dest.stream.getAudioTracks()[0], settings = tr.getSettings.bind(tr);
    Object.defineProperty(tr, 'label', { value: window.__devs[id], configurable: true });
    tr.getSettings = () => ({ ...settings(), deviceId: id, channelCount: 2 });
    return dest.stream;
  };
})();`;

const { page, errors, close } = await open('/app/', { query: 'new&autostart' });
try {
  await page.addInitScript(NAMED);
  await page.evaluate(() => {
    try {
      localStorage.removeItem('overdub:input');
    } catch (e) {
      /* ok */
    }
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const r = await page.evaluate(async () => {
    await import('/app/src/devices/builtin/stack.js'); // (registered at integration in builtin/index.js)
    const { store, engine } = window.overdub,
      a = window.overdub.input.audio,
      w = (ms) => new Promise((res) => setTimeout(res, ms));
    await engine.start();
    await engine.settled();
    store.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio', arm: true } }, { by: 'you' });
    const tid = store.get().tracks.find((t) => t.name === 'Guitar').id;
    store.dispatch(
      { type: 'insert.add', track: tid, insert: { device: 'core.stack', params: { cab: 7, gate: -96, gain: 4 } } },
      { by: 'you' },
    );
    await engine.settled();
    await w(400);
    await a.open({ device: 'scarlett-1' });
    await w(600);
    const out = { monitoring: a.state.monitoring, auto: a.state.monitorAuto, through: a.monitorTrack()?.name || null };
    const ctx = engine.ctx,
      sr = ctx.sampleRate;
    const inst = engine.instance(tid, store.get().tracks.find((t) => t.id === tid).inserts[0].id);
    await inst?.ready;
    out.instLatency = inst ? Math.round(inst.latency * sr) : null;
    out.trackLatency = Math.round((engine.latency.tracks[tid] || 0) * sr);
    // a recorder on the node wired to the speakers (the mix plus the monitor)
    const rec = [];
    const sp = ctx.createScriptProcessor(1024, 2, 2),
      mon = engine._monitor;
    sp.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      rec.push({ t: e.playbackTime, d: Float32Array.from(d) });
    };
    mon.connect(sp);
    sp.connect(ctx.destination);
    // a click at a known time, then where it comes out (first sample over -40 dBFS), in samples
    async function clickOut() {
      rec.length = 0;
      const t0 = Math.ceil((ctx.currentTime + 0.4) * sr) / sr;
      const b = ctx.createBuffer(1, 256, sr);
      const x = b.getChannelData(0);
      x[0] = 0.5;
      x[1] = -0.25;
      const n = ctx.createBufferSource();
      n.buffer = b;
      n.connect(window.__bus);
      n.start(t0);
      await w(1200);
      for (const blk of rec)
        for (let i = 0; i < blk.d.length; i++) if (Math.abs(blk.d[i]) > 0.01) return Math.round((blk.t - t0) * sr) + i;
      return null;
    }
    const fx = JSON.parse(JSON.stringify(store.get().tracks.find((t) => t.id === tid).inserts[0])),
      fxId = fx.id;
    // one click first, unmeasured: the first after the interface opens can come out before the monitor's chain has
    // settled (a null, or a block early); then five rounds, and the median of each
    await clickOut();
    const withAmp = [],
      bypassed = [],
      without = [];
    for (let k = 0; k < 5; k++) {
      store.dispatch({ type: 'insert.set', track: tid, insert: fxId, patch: { on: true } }, { by: 'you' });
      await engine.settled();
      await w(300);
      withAmp.push(await clickOut());
      store.dispatch({ type: 'insert.set', track: tid, insert: fxId, patch: { on: false } }, { by: 'you' });
      await engine.settled();
      await w(300);
      bypassed.push(await clickOut());
      store.dispatch({ type: 'insert.remove', track: tid, insert: fxId }, { by: 'you' });
      await engine.settled();
      await w(300);
      without.push(await clickOut());
      store.dispatch({ type: 'insert.add', track: tid, insert: { ...fx, on: true }, index: 0 }, { by: 'you' });
      await engine.settled();
      await w(400);
      await engine.instance(tid, fxId)?.ready;
    }
    out.withAmp = withAmp;
    out.bypassed = bypassed;
    out.without = without;
    out.sr = sr;
    mon.disconnect(sp);
    sp.disconnect();
    a.monitor(false);
    a.close();
    return out;
  });
  T.ok(
    r.monitoring && r.auto && r.through === 'Guitar',
    `the interface opens and monitoring starts by itself, through the armed Guitar track (${r.through})`,
  );
  T.ok(
    r.instLatency === 28 && r.trackLatency === 28,
    `Half Stack reports 28 samples (${((28 / r.sr) * 1000).toFixed(2)} ms) and engine.latency puts the track at ${r.trackLatency}`,
  );
  const med = (a) => a.slice().sort((x, y) => x - y)[2];
  const dw = med(r.withAmp),
    db = med(r.bypassed),
    dn = med(r.without),
    extra = dw - dn;
  T.ok(
    r.withAmp.every((x) => x != null) &&
      r.without.every((x) => x != null) &&
      r.bypassed.every((x) => x != null) &&
      extra >= 0 &&
      (extra * 1000) / r.sr <= 1,
    `a click in comes out ${dw} samples later through Half Stack, ${db} with it bypassed and ${dn} with no insert (the input stream's own buffering): the amp adds ${extra} samples, ${((extra * 1000) / r.sr).toFixed(2)} ms (want within 1 ms; runs ${r.withAmp.join(', ')} / ${r.bypassed.join(', ')} / ${r.without.join(', ')})`,
  );
  T.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally {
  await close();
}
T.done();
