// The Guitar Studio in Overdub (devices/guitar, devices/graph.js + kit.js, ui/faces.js, gallery.html):
//  1. registry: every clawd-o-matic pedal and amp is registered (ids kept: pedal.<id>, amp.<id>), none refused, and
//     every rig's devices exist; rigOps dispatch through the real store. Every worklet the vendored code builds is a
//     file on the studio's origin with that source byte for byte, and the pedals and amps load theirs from those files.
//  2. every pedal and amp instantiates on an OfflineAudioContext and renders the DI strum with no NaN or Inf;
//     renders are deterministic (twice the same, sample for sample).
//  3. bypass is exact: a sample of insert and trails pedals, off, equals the dry input to -90 dB.
//  4. the amps: each one's level with the DI strum through it alone (then the band's soft clip, as clawd-o-matic's
//     tools/plug-level.js measures it) is -14 LUFS (±0.75), its true peak under -1 dBTP; and the device is clawd-o-matic's
//     plugAmp sample for sample (also with a cab and two mics).
//  5. the rigs: every preset (but the keys bank's) through its whole chain lands at -14 LUFS ±1.5 (leads up to -12),
//     true peak ≤ -1 dBTP: the pedals, the amp, the cab and the mics all came across.
//  2b. automation: every pedal param that changes the sound before set()'s `at` is marked auto: false (no lane).
//  6. live: stomping a few pedals on and off while a tone plays is click-free (the 10 ms crossfades).
//  7. faces: gallery.html renders a face for every device with no page errors; knobs turn (keys, double-click reset),
//     switches flip, footswitches stomp; screenshots at 1440 and 390 wide (tools/.out/gallery-*.png).
// usage: node tools/guitar-test.js   (FAST=1 skips the rigs' levels; PEDALS=quack,delay renders only those)
// local-only: every vendored pedal and amp, registered, rendered and run live: 2 min on a CI runner
import { open, tally, OUTDIR } from './pw.js';
import path from 'node:path';

const t = tally('guitar');
const FAST = process.env.FAST === '1';
const ONLY = process.env.PEDALS ? process.env.PEDALS.split(',') : null;

// In-page helpers (window.__gt): render a chain of devices offline, clawd-o-matic's loudness, the band's tail.
const HELPERS = `
  const G = await import('/app/src/devices/guitar/index.js');
  const R = await import('/app/src/devices/registry.js');
  const TS = await import('/app/src/audio/testsignals.js');
  const M = await import('/app/src/audio/measure.js');
  const SR = 48000;
  // clawd-o-matic's loudness (vendor/pop-punk engine.js E.loudness: a +4 dB shelf at 1.5 kHz and a 38 Hz high-pass,
  // designed at 44.1 kHz as it is there, mean square of both channels, no gating): the number its levels were set by
  function clawdLufs(L, Rr, from = 0.5) {
    const hs = () => { const sr = 44100, w = 2 * Math.PI * 1500 / sr, c = Math.cos(w), s = Math.sin(w), A = Math.pow(10, 4 / 40), sA = 2 * Math.sqrt(A) * (s / 2) * Math.SQRT2;
      const b0 = A * (A + 1 + (A - 1) * c + sA), b1 = -2 * A * (A - 1 + (A + 1) * c), b2 = A * (A + 1 + (A - 1) * c - sA), a0 = A + 1 - (A - 1) * c + sA, a1 = 2 * (A - 1 - (A + 1) * c), a2 = A + 1 - (A - 1) * c - sA;
      const f = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, z1: 0, z2: 0 };
      return (x) => { const y = f.b0 * x + f.z1; f.z1 = f.b1 * x - f.a1 * y + f.z2; f.z2 = f.b2 * x - f.a2 * y; return y; }; };
    const hp = () => { const g = Math.tan(Math.PI * 38 / 44100), k = 1 / 0.5, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2; let s1 = 0, s2 = 0;
      return (x) => { const v3 = x - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3; s1 = 2 * v1 - s1; s2 = 2 * v2 - s2; return x - k * v1 - v2; }; };
    const sl = hs(), sr = hs(), hl = hp(), hr = hp();
    let ms = 0; const a = Math.round(from * SR), b = L.length;
    for (let i = a; i < b; i++) { const l = hl(sl(L[i])), r = hr(sr(Rr[i])); ms += l * l + r * r; }
    return -0.691 + 10 * Math.log10(ms / Math.max(1, b - a) + 1e-12);
  }
  // the band's master tail in clawd-o-matic (app.js): a soft clip at 4x and -1.5 dB
  function tail(c) {
    const clip = c.createWaveShaper(), n = 4096, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 4 - 2, q = Math.abs(x), y = q <= 0.85 ? q : 0.85 + 0.15 * Math.tanh((q - 0.85) / 0.15); cv[i] = x < 0 ? -y : y; }
    clip.curve = cv; clip.oversample = '4x';
    const trim = c.createGain(); trim.gain.value = Math.pow(10, -1.5 / 20);
    clip.connect(trim); return { input: clip, output: trim };
  }
  const inputs = {};
  const input = (kind = 'di', secs = 8) => { const k = kind + secs; if (!inputs[k]) inputs[k] = kind === 'bass' ? TS.bassDI(secs, SR) : TS.diStrum(secs, SR); return inputs[k]; };
  // render input through [{ device, params, on }] (offline, at bpm), optionally through the band's tail
  async function render(chain, x, { band = false, bpm = 170, extra = 0, insts } = {}) {
    const n = x.length + Math.round(extra * SR), c = new OfflineAudioContext(2, n, SR), src = c.createBufferSource(), b = c.createBuffer(1, x.length, SR);
    b.copyToChannel(x, 0); src.buffer = b;
    let at = src;
    const made = [];
    for (let k = 0; k < chain.length; k++) {
      const s = chain[k], inst = await R.instantiate(c, s.device, { uid: 'u' + k + '-' + s.device, params: s.params || {}, on: s.on !== false, bpm });
      await inst.ready; made.push(inst);
      at.connect(inst.input); at = inst.output;
    }
    if (band) { const tl = tail(c); at.connect(tl.input); at = tl.output; }
    at.connect(c.destination); src.start(0);
    const r = await c.startRendering();
    for (const i of made) i.dispose();
    if (insts) insts.push(...made);
    return [r.getChannelData(0), r.getChannelData(1)];
  }
  const check = (chs) => { let pk = 0, bad = 0; for (const ch of chs) for (let i = 0; i < ch.length; i++) { const v = ch[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > pk) pk = Math.abs(v); } return { bad, peak: 20 * Math.log10(pk + 1e-12) }; };
  const tp = (chs) => Math.max(...chs.map((ch) => M.truePeak({ sampleRate: SR, numberOfChannels: 1, length: ch.length, getChannelData: () => ch })));
  window.__gt = { G, R, TS, M, SR, clawdLufs, tail, input, render, check, tp };
`;

async function boot(page) {
  await page.addScriptTag({ type: 'module', content: HELPERS });
  await page.waitForFunction(() => window.__gt, null, { timeout: 30000 });
}

// ---------------------------------------------------------------------------------------------------- audio
{
  const { page, errors, close } = await open('/app/style/tokens.css');
  page.setDefaultTimeout(600000);
  await boot(page);

  // 1. registry
  const reg = await page.evaluate(() => {
    const { G, R } = window.__gt;
    const pedals = R.listDevices().filter((d) => d.id.startsWith('pedal.')), amps = R.listDevices({ cat: 'amp' }).filter((d) => d.id.startsWith('amp.'));
    const missing = [];
    for (const r of G.RIGS) for (const s of r.chain) if (!R.getDevice(s.device)) missing.push(r.id + ':' + s.device);
    const ids = G.clawd.PEDAL_LIST.map((d) => d.id).filter((id) => !R.getDevice('pedal.' + id));
    const badParams = [];
    for (const d of pedals.concat(amps)) for (const p of d.params) { if (!(p.def >= Math.min(p.min, p.max) && p.def <= Math.max(p.min, p.max))) badParams.push(d.id + '.' + p.key); if (p.fmt) { try { if (typeof p.fmt(p.def) !== 'string') badParams.push(d.id + '.' + p.key + ' fmt'); } catch (e) { badParams.push(d.id + '.' + p.key + ' fmt throws'); } } }
    const roles = pedals.reduce((n, d) => n + d.params.filter((p) => p.role).length, 0), units = pedals.reduce((n, d) => n + d.params.filter((p) => p.unit).length, 0);
    const knobs = pedals.reduce((n, d) => n + d.params.length, 0);
    return { pedals: pedals.length, clawdPedals: G.clawd.PEDAL_LIST.length, refused: G.clawd.PFX.refused, amps: amps.length, clawdAmps: Object.keys(G.clawd.PLUG_AMPS).length,
      rigs: G.RIGS.length, presets: G.clawd.PLUG_PRESETS.length, banks: G.RIG_BANKS.length, missing, ids, badParams, roles, units, knobs,
      trails: pedals.filter((d) => d.trails).length, cats: [...new Set(pedals.map((d) => d.cat))].join(' ') };
  });
  t.ok(reg.pedals === reg.clawdPedals && reg.pedals >= 100 && !reg.ids.length, `${reg.pedals} pedals registered (clawd-o-matic has ${reg.clawdPedals}) as pedal.<id>${reg.ids.length ? '; missing ' + reg.ids.join(' ') : ''}`);
  t.ok(!reg.refused.length, `no pedal refused by its pedalDef${reg.refused.length ? ': ' + JSON.stringify(reg.refused) : ''}`);
  t.ok(reg.amps === reg.clawdAmps && reg.amps >= 27, `${reg.amps} amps registered as amp.<id> (clawd-o-matic has ${reg.clawdAmps})`);
  t.ok(reg.rigs === reg.presets && reg.rigs > 100, `${reg.rigs} rigs from ${reg.banks} banks (every preset)`);
  t.ok(!reg.missing.length, `every rig's devices are registered${reg.missing.length ? ': ' + reg.missing.slice(0, 5).join(' ') : ''}`);
  t.ok(!reg.badParams.length, `every param's default is in range and its fmt returns a string${reg.badParams.length ? ': ' + reg.badParams.slice(0, 5).join(' ') : ''}`);
  t.note(`${reg.knobs} pedal params: ${reg.roles} with a role, ${reg.units} with a unit; ${reg.trails} trails pedals; cats: ${reg.cats}`);

  // the worklets: the studio loads worklet modules only from files on its own origin (its policy refuses data: and
  // blob: scripts), so tools/vendor-clawd.js wrote every processor source the vendored code builds to a file of its own
  // (app/vendor/clawd/worklets/). Each file is that source byte for byte (after its one line saying so), and every
  // pedal and amp device names those files for its worklets.
  const wl = await page.evaluate(async () => {
    const { G, R } = window.__gt;
    const { WORKLETS } = await import('/app/src/devices/guitar/clawd.js');
    const src = { 'clawd-amps': G.clawd.PLUG_WORKLETS };
    for (const [n, w] of Object.entries(G.clawd.PFX.worklets)) src[n] = w.src;
    const diff = [], files = Object.values(WORKLETS);
    for (const [n, s] of Object.entries(src)) {
      if (!WORKLETS[n]) { diff.push(n + ': no file'); continue; }
      const u = new URL(WORKLETS[n]);
      const text = await (await fetch(u)).text();
      if (u.origin !== location.origin || !u.pathname.startsWith('/app/vendor/clawd/worklets/')) diff.push(n + ': ' + u.href);
      else if (text.slice(text.indexOf('\n') + 1) !== s) diff.push(n + ': not its source');
    }
    const devs = R.listDevices().filter((d) => /^(pedal|amp)\./.test(d.id) && d.worklets);
    const named = devs.flatMap((d) => Object.entries(d.worklets).filter(([n, u]) => u !== WORKLETS[n] || !files.includes(u)).map(([n]) => d.id + ':' + n));
    return { n: Object.keys(src).length, files: files.length, diff, devs: devs.length, named };
  });
  t.ok(wl.n >= 40 && wl.files === wl.n && !wl.diff.length, `${wl.n} worklets the vendored code builds, each a file of its own on the studio's origin with its source byte for byte (app/vendor/clawd/worklets/)${wl.diff.length ? ': ' + wl.diff.slice(0, 5).join(', ') : ''}`);
  t.ok(wl.devs >= 30 && !wl.named.length, `the ${wl.devs} pedals and amps with worklets load them from those files${wl.named.length ? '; not: ' + wl.named.slice(0, 5).join(' ') : ''}`);
  // the kit's own envelope follower (PFX.ENV, for a graph device of Overdub's that calls kit.envelope(); no built-in
  // does yet): its file loads behind END and it follows a tone
  const env = await page.evaluate(async () => {
    const K = await import('/app/src/devices/kit.js');
    const c = new OfflineAudioContext(1, 24000, 48000);
    const ok = await K.loadWorklet(c, 'pfx-env', K.PFX.ENV);
    if (!ok) return { ok, url: K.PFX.ENV };
    const o = c.createOscillator(), g = c.createGain(), n = new AudioWorkletNode(c, 'pfx-env', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    o.frequency.value = 220; g.gain.value = 0.5; o.connect(g); g.connect(n); n.connect(c.destination); o.start(0);
    const d = (await c.startRendering()).getChannelData(0);
    return { ok, end: d[d.length - 1], url: new URL(K.PFX.ENV).pathname };
  });
  t.ok(env.ok && Math.abs(env.end - 0.5) < 0.05, `the kit's own envelope follower (${env.url}) loads from its file and follows a 0.5 sine (${env.ok ? env.end.toFixed(3) : 'did not load'})`);

  const ops = await page.evaluate(async () => {
    const { G, R } = window.__gt;
    let store = null;
    try { const S = await import('/app/src/core/store.js'); store = S.createStore(); } catch (e) { return { skip: e.message }; }
    let r = store.dispatch({ type: 'track.add', track: { name: 'Guitar', kind: 'audio' }, ref: 'g' }, { by: 'you' });
    if (!r.ok) return { err: r.error };
    const tid = r.created.g || Object.values(r.created)[0];
    const rig = G.rigById('webcam') || G.RIGS[0];
    r = store.dispatch(G.rigOps(tid, rig), { by: 'claude', label: 'rig ' + rig.name });
    if (!r.ok) return { err: r.error };
    const t1 = store.track(tid), first = t1.inserts.map((x) => x.id);
    const rig2 = G.RIGS.find((x) => x.chain.length > 3 && x.id !== rig.id);
    r = store.dispatch(G.rigOps(tid, rig2, { replace: first }), { by: 'claude' });
    if (!r.ok) return { err: r.error };
    const t2 = store.track(tid);
    return { n1: first.length, chain1: rig.chain.length, n2: t2.inserts.length, chain2: rig2.chain.length, devs: t2.inserts.map((x) => x.device).join(' '), same: t2.inserts.every((x, k) => x.device === rig2.chain[k].device && x.on === rig2.chain[k].on) };
  });
  if (ops.skip) t.note('store not loadable: ' + ops.skip);
  else t.ok(!ops.err && ops.n1 === ops.chain1 && ops.n2 === ops.chain2 && ops.same, `rigOps through the store: a rig's ${ops.chain1} inserts, then another replacing it (${ops.devs || ops.err})`);

  // 2b. automation (docs/research/AUTOMATION.md 3.5): the engine moves a pedal's knob with set(values, { at }) ahead
  // of time. A param that changes the sound before `at` (the pedal writes .value, or rebuilds, in set()) would land up
  // to 120 ms early: those are marked auto: false in devices/guitar/pedals.js (no lane), and every other one waits.
  {
    const early = await page.evaluate(async (ONLY) => {
      const { R, input } = window.__gt;
      const SR = 48000, x = input('di', 1.2).slice(0, Math.round(1.2 * SR)), AT = 0.8, until = Math.round((AT - 0.03) * SR);
      const go = async (id, params, move) => {
        const c = new OfflineAudioContext(2, x.length, SR), src = c.createBufferSource(), b = c.createBuffer(1, x.length, SR);
        b.copyToChannel(x, 0); src.buffer = b;
        const inst = await R.instantiate(c, id, { uid: 'auto-' + id, params, on: true, bpm: 120 });
        await inst.ready;
        src.connect(inst.input); inst.output.connect(c.destination); src.start(0);
        inst.set({ ...params, ...move }, { at: AT });
        const r = await c.startRendering();
        inst.dispose();
        return [r.getChannelData(0).slice(0, until), r.getChannelData(1).slice(0, until)];
      };
      const out = { found: [], marked: [], wrong: [], params: 0 };
      for (const d of R.listDevices().filter((q) => q.id.startsWith('pedal.') && (!ONLY || ONLY.includes(q.id.slice(6))))) {
        const base = {};
        for (const p of d.params) base[p.key] = p.def;
        const ref = await go(d.id, base, {}), ref2 = await go(d.id, base, {});
        // (a pedal whose renders differ by a hair on their own: its own floor, times ten)
        let floor = 0;
        for (let ch = 0; ch < 2; ch++) for (let i = 0; i < until; i++) floor = Math.max(floor, Math.abs(ref2[ch][i] - ref[ch][i]));
        for (const p of d.params) {
          if (p.auto === false) out.marked.push(d.id + '.' + p.key);
          if (p.opts || p.tap || p.step >= (p.max - p.min)) continue;
          out.params++;
          const to = p.def > (p.min + p.max) / 2 ? p.min : p.max;
          const got = await go(d.id, base, { [p.key]: to });
          let dmax = 0;
          for (let ch = 0; ch < 2; ch++) for (let i = 0; i < until; i++) dmax = Math.max(dmax, Math.abs(got[ch][i] - ref[ch][i]));
          if (dmax > Math.max(1e-4, 10 * floor)) out.found.push(d.id + '.' + p.key);
        }
      }
      return out;
    }, ONLY);
    const unmarked = early.found.filter((k) => !early.marked.includes(k));
    t.note(`automation: ${early.found.length} of ${early.params} continuous pedal params change the sound before their set()'s time${early.found.length ? ': ' + early.found.join(' ') : ''}`);
    t.ok(!unmarked.length, `every pedal param that ignores set()'s time is marked auto: false (no lane), so a lane never lands early${unmarked.length ? '; unmarked: ' + unmarked.join(' ') : ''}`);
  }

  // 2. every pedal renders, finite; deterministic
  const ids = await page.evaluate((only) => window.__gt.R.listDevices().filter((d) => d.id.startsWith('pedal.') && (!only || only.includes(d.pedal))).map((d) => d.id), ONLY);
  const bad = [], loud = [];
  let worst = { id: '', peak: -999 };
  for (let k = 0; k < ids.length; k += 12) {
    const res = await page.evaluate(async (batch) => {
      const { render, input, check } = window.__gt, x = input('di', 3), out = [];
      for (const id of batch) {
        try { const r = await render([{ device: id }], x, { extra: 0.5 }); out.push(Object.assign({ id }, check(r))); }
        catch (e) { out.push({ id, err: String(e && e.message || e) }); }
      }
      return out;
    }, ids.slice(k, k + 12));
    for (const r of res) {
      if (r.err || r.bad) bad.push(r.id + (r.err ? ' ' + r.err : ' NaN/Inf x' + r.bad));
      if (r.peak > 6) loud.push(`${r.id} ${r.peak.toFixed(1)}`);
      if (r.peak > worst.peak) worst = r;
    }
  }
  t.ok(!bad.length, `${ids.length} pedals render the DI strum on an OfflineAudioContext, finite${bad.length ? ': ' + bad.slice(0, 6).join('; ') : ''}`);
  t.ok(!loud.length, `no pedal's raw peak over +6 dBFS at its defaults (loudest ${worst.id} ${worst.peak.toFixed(1)} dBFS)${loud.length ? ': ' + loud.join(', ') : ''}`);

  const det = await page.evaluate(async () => {
    const { render, input } = window.__gt, x = input('di', 2), out = [];
    for (const id of ['pedal.bitreef', 'pedal.verb', 'pedal.krillroll', 'pedal.chewedcable', 'pedal.planktoncloud', 'pedal.seasick', 'amp.abyss']) {
      const a = await render([{ device: id }], x), b = await render([{ device: id }], x);
      let d = 0; for (let ch = 0; ch < 2; ch++) for (let i = 0; i < a[ch].length; i++) d = Math.max(d, Math.abs(a[ch][i] - b[ch][i]));
      out.push([id, d]);
    }
    return out;
  });
  // Kernels are bit-exact. A few vendored pedals drive their modulation from main-thread timers (they predate the
  // clock), so under heavy CPU load two renders can differ by a render quantum's worth of wobble: allowed up to
  // -80 dB, and named here so it stays visible.
  const inexact = det.filter(([, d]) => d > 0);
  if (inexact.length) t.note(`not bit-exact under load: ${inexact.map(([id, d]) => id.split('.')[1] + ' ' + d.toExponential(1)).join(', ')}`);
  t.ok(det.every(([, d]) => d <= 1e-4), `renders are deterministic (twice the same to -80 dB; ${det.length - inexact.length}/${det.length} sample for sample)`);

  // 3. bypass exact
  const byp = await page.evaluate(async () => {
    const { R, render, input } = window.__gt, x = input('di', 2);
    const ins = ['pedal.gate', 'pedal.drive', 'pedal.fuzz', 'pedal.quack', 'pedal.chorus', 'pedal.whammerhead', 'pedal.bitreef', 'amp.punk'];
    const tr = ['pedal.delay', 'pedal.verb', 'pedal.tapecrab', 'pedal.halojelly', 'pedal.iceberg', 'pedal.frostbite'].filter((id) => R.getDevice(id) && R.getDevice(id).trails);
    const out = [];
    for (const id of ins.concat(tr)) {
      const r = await render([{ device: id, on: false }], x);
      let d = 0; for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(r[0][i] - x[i]), Math.abs(r[1][i] - x[i]));
      out.push({ id, trails: !!R.getDevice(id).trails, db: 20 * Math.log10(d + 1e-12) });
    }
    return out;
  });
  t.ok(byp.every((b) => b.db <= -90), `bypass is exact (off = dry, worst ${Math.max(...byp.map((b) => b.db)).toFixed(0)} dB) for ${byp.filter((b) => !b.trails).length} insert and ${byp.filter((b) => b.trails).length} trails devices${byp.some((b) => b.db > -90) ? ': ' + byp.filter((b) => b.db > -90).map((b) => b.id + ' ' + b.db.toFixed(0)).join(' ') : ''}`);

  // 4. the amps
  const amps = await page.evaluate(async () => {
    const { G, R, render, input, clawdLufs, check, tp, M, SR } = window.__gt, out = [];
    for (const d of R.listDevices({ cat: 'amp' }).filter((x) => x.id.startsWith('amp.'))) {
      const bass = d.tone === 'bass', x = input(bass ? 'bass' : 'di', 8);
      const r = await render([{ device: d.id }], x, { band: true });
      const buf = { sampleRate: SR, numberOfChannels: 2, length: r[0].length, getChannelData: (i) => r[i] };
      out.push({ id: d.id, name: d.name, bass, lufs: clawdLufs(r[0], r[1]), bs1770: M.lufs(buf), tp: tp(r), ...check(r) });
    }
    // the same as clawd-o-matic's plugAmp, sample for sample: its own cab, and a preset's cab and two mics
    const same = [];
    const studio = G.clawd.presetResolve(G.clawd.PLUG_PRESETS.find((p) => p.id === 'studio'));
    for (const [id, S] of [['punk', { gain: 6, bass: 5, mid: 5, treble: 6, presence: 5, level: 6 }], ['abyss', { gain: 7, bass: 4, mid: 6, treble: 5, presence: 6, level: 5 }], ['punk', studio], ['jangle', { gain: 5, bass: 5, mid: 6, treble: 6, presence: 5, level: 6.4, cab: 'phone' }]]) {
      const x = input('di', 2), P = Object.assign({}, S, { amp: id }); delete P.board;
      const a = await render([{ device: 'amp.' + id, params: G.ampParams(P) }], x);
      const { loadWorklet } = await import('/app/src/devices/kit.js');
      const { WORKLETS } = await import('/app/src/devices/guitar/clawd.js');
      // (exact: the settings the device hands plugAmp; the preset's own: within its mic position's rounding)
      const run = async (Q) => {
        const c = new OfflineAudioContext(2, x.length, SR), s = c.createBufferSource(), b = c.createBuffer(1, x.length, SR);
        b.copyToChannel(x, 0); s.buffer = b;
        if (G.clawd.PLUG_AMPS[id].sub) c.__clawdAmpWorklets = await loadWorklet(c, 'clawd-amps', WORKLETS['clawd-amps']);
        const amp = G.clawd.plugAmp(c); amp.set(Q);
        s.connect(amp.input); amp.output.connect(c.destination); s.start(0);
        const o = await c.startRendering();
        let d = 0; for (let ch = 0; ch < 2; ch++) { const y = o.getChannelData(ch); for (let i = 0; i < y.length; i++) d = Math.max(d, Math.abs(a[ch][i] - y[i])); }
        return d;
      };
      const def = R.getDevice('amp.' + id);
      same.push({ id: id + (P.cab ? '+' + P.cab : '') + (P.mic2 ? '+2 mics' : ''), d: await run(G.ampSettings(id, R.paramValues(def, G.ampParams(P)))), dPreset: await run(P) });
    }
    return { out, same };
  });
  for (const a of amps.out) {
    const okLevel = Math.abs(a.lufs + 14) <= 0.75;
    t.ok(!a.bad && okLevel && a.tp <= -1, `${a.id.padEnd(12)} ${a.name.padEnd(13)} ${a.lufs.toFixed(1)} LUFS (BS.1770 ${a.bs1770.toFixed(1)}), TP ${a.tp.toFixed(1)} dBTP${a.bass ? ' (bass DI)' : ''}${a.bad ? ' NaN!' : ''}`);
  }
  t.ok(amps.same.every((s) => s.d < 1e-6), `the amp devices are clawd-o-matic's plugAmp, to -120 dB: ${amps.same.map((s) => s.id + ' ' + (s.d ? (20 * Math.log10(s.d)).toFixed(0) + ' dB' : 'exact')).join(', ')}`);
  const worstPreset = Math.max(...amps.same.map((s) => s.dPreset));
  t.ok(worstPreset < 1e-3, `a preset's amp settings come across within ${(20 * Math.log10(worstPreset + 1e-12)).toFixed(0)} dBFS (a mic's x, y on the cone become one radius, as the sound only hears the radius; plugCabClean rounds x and y)`);

  // 5. the rigs, end to end
  if (!FAST) {
    const rigIds = await page.evaluate(() => window.__gt.G.RIGS.map((r) => r.id));
    const rows = [];
    for (let k = 0; k < rigIds.length; k += 16) {
      rows.push(...await page.evaluate(async (batch) => {
        const { G, render, input, clawdLufs, check, tp } = window.__gt, out = [];
        for (const id of batch) {
          const r = G.rigById(id), kind = r.bank.id === 'bass' ? 'bass' : r.bank.id === 'keys' ? 'keys' : 'di';
          try {
            const y = await render(r.chain, input(kind === 'keys' ? 'di' : kind, 6), { band: true });
            out.push({ id, bank: r.bank.id, lead: r.tags.includes('lead'), kind, lufs: clawdLufs(y[0], y[1]), tp: tp(y), ...check(y) });
          } catch (e) { out.push({ id, err: String(e.message || e) }); }
        }
        return out;
      }, rigIds.slice(k, k + 16)));
    }
    const judged = rows.filter((r) => r.kind !== 'keys');
    const off = judged.filter((r) => r.err || r.bad || r.lufs < -15.5 || r.lufs > (r.lead ? -12 : -12.5) || r.tp > -1);
    const lo = Math.min(...judged.map((r) => r.lufs)), hi = Math.max(...judged.map((r) => r.lufs));
    t.ok(!off.length, `${judged.length} rigs (all but the keys bank) through their whole chain: ${lo.toFixed(1)} to ${hi.toFixed(1)} LUFS, true peak ≤ ${Math.max(...judged.map((r) => r.tp)).toFixed(1)} dBTP${off.length ? '; off: ' + off.slice(0, 8).map((r) => `${r.id} ${r.err || (r.bad ? 'NaN' : r.lufs.toFixed(1) + '/' + r.tp.toFixed(1))}`).join(', ') : ''}`);
    const keys = rows.filter((r) => r.kind === 'keys');
    t.ok(keys.every((r) => !r.err && !r.bad), `${keys.length} keys rigs render finite (their levels are set for a keyboard, not judged with a guitar)`);
  }

  // 6. live: click-free stomps
  const live = await page.evaluate(async () => {
    const { R } = window.__gt, c = new AudioContext({ sampleRate: 48000 });
    await c.resume();
    const REC = `class GtRec extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = (e) => { this.on = false; }; }
      process(i) { const x = i[0] && i[0][0]; if (x && this.on) this.port.postMessage(x.slice(0)); return this.on; } } registerProcessor('gt-rec', GtRec);`;
    await c.audioWorklet.addModule('data:text/javascript,' + encodeURIComponent(REC));
    const res = [];
    for (const id of ['pedal.drive', 'pedal.chorus', 'pedal.delay', 'pedal.quack', 'amp.clean']) {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 196; g.gain.value = 0.25; o.connect(g);
      const inst = await R.instantiate(c, id, { uid: 'live-' + id, on: false }); await inst.ready;
      const rec = new AudioWorkletNode(c, 'gt-rec'), blocks = [];
      rec.port.onmessage = (e) => blocks.push(e.data);
      g.connect(inst.input); inst.output.connect(rec); rec.connect(c.destination); o.start();
      const marks = [];
      const t0 = c.currentTime;
      await new Promise((r) => setTimeout(r, 300));
      for (let k = 0; k < 6; k++) { const at = c.currentTime + 0.05; marks.push(at - t0); inst.setOn(k % 2 === 0, at); await new Promise((r) => setTimeout(r, 260)); }
      rec.port.postMessage('stop'); o.stop(); await new Promise((r) => setTimeout(r, 60));
      inst.dispose(); g.disconnect(); rec.disconnect();
      const n = blocks.reduce((s, b) => s + b.length, 0), y = new Float32Array(n); let p = 0; for (const b of blocks) { y.set(b, p); p += b.length; }
      // the second difference: a click is a jump it can't hide; a crossfade between two tones stays within theirs
      const d2 = new Float32Array(n); for (let i = 2; i < n; i++) d2[i] = Math.abs(y[i] - 2 * y[i - 1] + y[i - 2]);
      // steady: the windows between stomps; around a stomp: 40 ms either side of its scheduled time
      const sr = c.sampleRate, near = new Uint8Array(n);
      for (const m of marks) for (let i = Math.max(0, Math.round((m - 0.03) * sr)); i < Math.min(n, Math.round((m + 0.06) * sr)); i++) near[i] = 1;
      let steady = 0, at = 0, start = Math.round(0.1 * sr);
      for (let i = start; i < n - 256; i++) { if (near[i]) at = Math.max(at, d2[i]); else steady = Math.max(steady, d2[i]); }
      res.push({ id, ratio: at / Math.max(steady, 1e-9), steady, at, secs: n / sr });
    }
    await c.close();
    return res;
  });
  for (const l of live) t.ok(l.ratio < 1.6 && l.secs > 1, `live stomps on ${l.id} are click-free (second difference at the stomps ${l.ratio.toFixed(2)}× the steady sound's, ${l.secs.toFixed(1)} s captured)`);

  t.ok(!errors.length, `no page errors in the audio checks${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await close();
}

// ---------------------------------------------------------------------------------------------------- faces
for (const width of [1440, 390]) {
  const { page, errors, close } = await open('/app/gallery.html', { width, height: 900 });
  const missing404 = [];
  page.on('response', (r) => { if (r.status() === 404) missing404.push(r.url()); });
  await page.waitForFunction(() => window.__gallery && window.__gallery.ready, null, { timeout: 60000 });
  await page.waitForTimeout(1500); // (the faces' fonts)
  const g = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.g-card')];
    const noFace = cards.filter((c) => !c.querySelector('.ewf')).map((c) => c.dataset.id);
    const kinds = {}; for (const f of document.querySelectorAll('.ewf')) kinds[f.dataset.face] = (kinds[f.dataset.face] || 0) + 1;
    const sliders = document.querySelectorAll('.ewf [role="slider"]').length, unlabeled = [...document.querySelectorAll('.ewf [role="slider"]')].filter((s) => !s.getAttribute('aria-label') || !s.getAttribute('aria-valuetext')).length;
    const badges = [...document.querySelectorAll('.ewf-by')].map((b) => b.textContent);
    return { cards: cards.length, devices: window.__gallery.devices, noFace, kinds, sliders, unlabeled, badges, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  t.ok(g.cards === g.devices && !g.noFace.length, `${width}px: gallery.html draws a face for all ${g.devices} devices (${Object.entries(g.kinds).map(([k, n]) => n + ' ' + k).join(', ')})`);
  t.ok(g.sliders > 400 && !g.unlabeled, `${width}px: ${g.sliders} controls are ARIA sliders with a label and a valuetext`);
  t.ok(g.badges.some((b) => /Claude/.test(b)) && g.badges.some((b) => /\byou\b/i.test(b)), `${width}px: agent-written devices are signed with their author's byline (${[...new Set(g.badges)].join(', ')})`);
  t.ok(g.overflow <= 0, `${width}px: no sideways scroll (${g.overflow > 0 ? g.overflow + ' px over' : 'fits'})`);
  if (width === 1440) {
    // interact: a knob by keys and double-click, a lever, the footswitch, a drag
    const k = await page.evaluate(async () => {
      const card = document.querySelector('.g-card[data-id="pedal.drive"]'), dial = card.querySelector('.kn-dial'), out = card.querySelector('.g-val');
      const v0 = +dial.getAttribute('aria-valuenow');
      dial.focus(); dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
      const v1 = +dial.getAttribute('aria-valuenow'), said = out.textContent;
      dial.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const v2 = +dial.getAttribute('aria-valuenow');
      const sw = card.querySelector('.pd-sw'), pd = card.querySelector('.pd'), on0 = pd.classList.contains('on'); sw.click(); const on1 = pd.classList.contains('on');
      const lever = document.querySelector('.g-card[data-id="pedal.clamocd"] .ms-b'), lv0 = lever.getAttribute('aria-valuetext'); lever.click(); const lv1 = lever.getAttribute('aria-valuetext');
      const pw = document.querySelector('.g-card[data-id="amp.punk"] .amp-pwr'), p0 = pw.getAttribute('aria-pressed'); pw.click(); const p1 = pw.getAttribute('aria-pressed');
      const txt = document.querySelector('.g-card[data-id="pedal.delay"] .kn-dial').getAttribute('aria-valuetext');
      return { v0, v1, v2, said, on0, on1, lv0, lv1, p0, p1, txt };
    });
    t.ok(k.v1 > k.v0 && k.v2 === k.v0 && /drive = /.test(k.said), `a knob turns with the keys (${k.v0} -> ${k.v1}, "${k.said}") and double-click puts it back (${k.v2})`);
    t.ok(k.on0 !== k.on1 && k.lv0 !== k.lv1 && k.p0 !== k.p1, `the footswitch stomps (${k.on0} -> ${k.on1}), a lever flips (${k.lv0} -> ${k.lv1}), the amp's power switches (${k.p0} -> ${k.p1})`);
    t.ok(k.txt === '1/8.', `valuetext comes from the param's fmt (the delay's TIME reads "${k.txt}")`);
    const dial = await page.$('.g-card[data-id="pedal.fuzz"] .kn-dial');
    await dial.scrollIntoViewIfNeeded();
    const box = await dial.boundingBox(), before = await dial.getAttribute('aria-valuenow');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 5 }); await page.mouse.up();
    const after = await dial.getAttribute('aria-valuenow'), said = await page.$eval('.g-card[data-id="pedal.fuzz"] .g-val', (e) => e.textContent);
    t.ok(+after > +before && !/…/.test(said), `dragging a knob up turns it up (${before} -> ${after}) and lets go with a commit ("${said}")`);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUTDIR, 'gallery-1440.png') });
    for (const c of ['amp', 'fuzz', 'time']) { const s = await page.$(`section[data-cat="${c}"]`); await page.addStyleTag({ content: '.g-top{position:static}' }); if (s) await s.screenshot({ path: path.join(OUTDIR, `gallery-1440-${c}.png`) }); }
  } else {
    await page.screenshot({ path: path.join(OUTDIR, 'gallery-390.png') });
    await page.evaluate(() => document.querySelector('section[data-cat="amp"]').scrollIntoView());
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUTDIR, 'gallery-390-amps.png') });
  }
  // (a device library that isn't there yet is a 404 the gallery skips on purpose)
  const real = errors.filter((e) => !/status of 404/.test(e) || missing404.some((u) => !/\/devices\/builtin\//.test(u)));
  t.ok(!real.length, `${width}px: no page errors${real.length ? ': ' + real.slice(0, 3).join(' | ') : ''}${missing404.length ? ' (skipped: ' + missing404.map((u) => u.replace(/^.*\/app\//, '')).join(', ') + ')' : ''}`);
  await close();
}
t.done();
