// The device check: the pedal-check of kernels. Compiles a def's kernel, renders test signals through it in
// OfflineAudioContexts (the same worklet the studio runs) and measures what comes out, because nobody writing a
// kernel - human or agent - can be trusted to have listened.
//
//   const report = await checkDevice(def, { quick = false, signal = null, timeout = 60000 })
//   report = {
//     ok,                       false on a compile error, NaN/Infinity, a peak over +6 dBTP at default settings, a
//                               raw peak over +24 dBFS at an extreme setting (a runaway), a stuck note, or a check
//                               that ran out of time (timedOut)
//     errors: [string], warnings: [string],                       each one says what to change; what a kernel threw
//                                                                 is quoted trimmed to 200 characters
//     timedOut,                 false, or where the time ran out: 'process' (a render never finished: process() may
//                               never return), 'create' (create() never returned), or 'busy' (the audio thread the
//                               checks render on was still held by an earlier render, so this kernel never ran)
//
//   heldRenders()               how many renders a check gave up on are still running (see below)
//     id, kind, ms,             ms: how long the check took
//     compile: { ok, error, line },
//     level: { lufs, deltaLU, inLufs, drumsDeltaLU },             effects: LU against the input (strum / drums);
//                                                                 instruments: lufs of the test phrase
//     truePeak, peak,           dBTP / dBFS, the loudest over every render at default settings
//     nan,                      true if any render produced NaN / Infinity (or the worklet faulted)
//     tail: { seconds, limit, decays },   effects: time to fall under -60 dBFS after the input stops;
//                                         instruments: after the last note-off
//     cpu: { pct, ms, secs },   wall time of a 4 s render as % of real time (one instance)
//     latency: { samples, ms, declared },  effects: where an impulse comes out; instruments: note-on to onset
//     deterministic,            two renders hash-equal
//     extremes: { cases, worstPeak, failed: [{ case, nan, peak, error }], hot: [case] },   every param at min and max,
//                               all min, all max; `hot`: cases over +6 dBFS (a warning)
//     voices?: { poly, maxVoices, steals },  instruments: poly + 4 notes held at once
//     stuck?: false | string,  instruments
//   }
//
// A kernel whose process() never returns would hold the check forever, and its caller with it (define_device, and the
// agent's turn behind it). So every wait on the audio thread races `timeout` and `signal`: past the deadline the
// device is refused, and an aborted signal rejects with an AbortError. An OfflineAudioContext render can't be
// cancelled, so the check only stops waiting and lets the render go. Chrome renders every offline context on one
// worklet thread, so a render that never ends holds up every render after it until the page reloads, and while that
// thread is busy, loading the worklet into a new context blocks the page's main thread too. So the renders a check
// gives up on are counted until they end (heldRenders(), which the agent's tools consult before rendering), and while
// any is left a check doesn't start another: it says the thread is held ('busy') instead of blaming this device.
import { compileKernel, kernelInstance } from './host.js';
import { normParam } from '../devices/registry.js';
import { lufs as measureLufs, truePeak as measureTruePeak } from '../audio/measure.js';
import { diStrum, drumLoop, phrase, drumPhrase, PHRASE_BPM } from '../audio/testsignals.js';

const SR = 48000;
const SILENCE = 0.001; // -60 dBFS
const TIMEOUT = 60000; // ms. A full check of the heaviest shipped device takes about 3.5 s on an M-series Mac, so this
                       // leaves room for slow machines and heavy kernels, and stays under the 120 s the local bridge
                       // and the relay give define_device
const round = (x, k = 10) => (Number.isFinite(x) ? Math.round(x * k) / k : x);
const dBFS = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
// What a kernel threw is its author's text, not ours, and can be any length: it goes into the report trimmed, with
// control characters gone, because the report goes on to agents and the human.
const said = (m, n = 200) => { const t = String(m ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// The check's clock: wait(p) races p against the deadline and the signal. Once either trips, every wait rejects with
// the same reason (and check() throws it), so no new render starts. loaded and created record how far this check got
// on the audio thread: a worklet loaded for it, and a kernel instance of this device created.
function watch(ms, signal) {
  const w = { reason: null, loaded: false, created: false };
  let trip;
  const tripped = new Promise((res, rej) => { trip = rej; });
  tripped.catch(() => {}); // (raced, never awaited on its own)
  const fail = (e) => { if (!w.reason) { w.reason = e; trip(e); } };
  const timer = setTimeout(() => fail(Object.assign(new Error('the device check ran out of time'), { name: 'TimeoutError' })), ms);
  const onAbort = () => fail(Object.assign(new Error('stopped'), { name: 'AbortError' }));
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  w.wait = (p) => Promise.race([p, tripped]);
  w.check = () => { if (w.reason) throw w.reason; };
  w.end = () => { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); };
  return w;
}

// What a check gave up on and is still running on the audio thread, each as a promise that settles when it ends.
const held = new Set();
const hold = (p) => { held.add(p); const done = () => held.delete(p); p.then(done, done); };
export const heldRenders = () => held.size;
const BUSY = 'the device check can\'t run yet: the audio thread it renders on is still held by an earlier render that hasn\'t finished (one whose process() never returns holds it until the page is reloaded). Try again in a moment; if it says this again, reload the studio';

function hash(buf) {
  let h = 0x811c9dc5;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const u = new Uint32Array(buf.getChannelData(c).slice().buffer);
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h.toString(16);
}
function scan(buf) {
  let peak = 0, nan = false;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c);
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (v !== v || v === Infinity || v === -Infinity) { nan = true; continue; }
      const a = v < 0 ? -v : v; if (a > peak) peak = a;
    }
  }
  return { peak, nan };
}
// Index of the last frame (from `from`) above `thr`, or -1.
function lastAbove(buf, thr, from = 0) {
  let last = -1;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c);
    for (let i = x.length - 1; i >= from && i > last; i--) if (Math.abs(x[i]) > thr) { last = i; break; }
  }
  return last;
}
function firstAbove(buf, thr, from = 0) {
  let first = Infinity;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c);
    for (let i = from; i < x.length && i < first; i++) if (Math.abs(x[i]) > thr) { first = i; break; }
  }
  return first === Infinity ? -1 : first;
}

function stereoOf(x) { return Array.isArray(x) ? x : (x && x.channels) ? x.channels : [x, x]; }
function cut(chans, secs, fade = 0.01) {
  const n = Math.round(secs * SR), f = Math.round(fade * SR);
  return chans.map((x) => {
    const y = new Float32Array(n); y.set(x.subarray(0, n));
    for (let i = 0; i < f; i++) y[n - 1 - i] *= i / f;
    return y;
  });
}
function pad(chans, secs) {
  const n = Math.round(secs * SR);
  return chans.map((x) => { const y = new Float32Array(n); y.set(x.subarray(0, Math.min(n, x.length))); return y; });
}

// One offline render of `def` with `params`. Effects get `input` (stereo Float32Arrays); instruments get `notes`
// ([{ p, t, d, v }] in seconds) and optionally `allOffAt` (seconds). Every wait goes through the check's watch `w`;
// when it trips, what was being waited on is held until it ends, and the instance is let go.
async function renderOnce(def, { secs, params = {}, input = null, notes = null, allOffAt = null, seed = 1, stats = false }, w) {
  w.check();
  const c = new OfflineAudioContext(2, Math.round(secs * SR), SR);
  const made = kernelInstance(c, def, { seed, params, bpm: PHRASE_BPM }); // (loads the worklet on `c` first)
  let inst;
  try { inst = await w.wait(made); } catch (e) { if (e === w.reason) { hold(made); made.then((i) => i.dispose(), () => {}); } throw e; }
  w.loaded = true;
  try { await w.wait(inst.ready); } catch (e) {
    if (e !== w.reason) { inst.dispose(); return { compileError: said(e.message), line: e.line || null }; }
    // create() is still running: ready settles when it returns (disposing now would close the port it answers on)
    hold(inst.ready); inst.ready.then(() => inst.dispose(), () => inst.dispose());
    throw e;
  }
  w.created = true;
  inst.set(params, { first: true });
  if (input) {
    const b = c.createBuffer(2, input[0].length, SR);
    b.copyToChannel(input[0], 0); b.copyToChannel(input[1] || input[0], 1);
    const src = c.createBufferSource(); src.buffer = b; src.connect(inst.input); src.start(0);
  }
  if (notes) for (const n of notes) { inst.noteOn(n.p, n.v, n.t); inst.noteOff(n.p, n.t + n.d); }
  if (allOffAt != null) inst.allOff(allOffAt);
  inst.output.connect(c.destination);
  const t0 = performance.now();
  const rendering = c.startRendering();
  let buffer;
  try { buffer = await w.wait(rendering); } catch (e) { inst.dispose(); if (e === w.reason) hold(rendering); throw e; }
  const ms = performance.now() - t0;
  const st = stats ? await w.wait(inst.stats()).catch((e) => { inst.dispose(); throw e; }) : null;
  const errors = inst.errors.slice();
  const latency = inst.latency;
  inst.dispose();
  return { buffer, ms, errors, stats: st, latency, poly: inst.poly || 0 };
}

function paramCases(params, quick) {
  const base = {};
  for (const p of params) base[p.key] = p.def;
  const cases = [];
  if (!quick) for (const p of params) {
    if (p.min === p.max) continue;
    cases.push({ name: `${p.key} at min (${p.min})`, params: { ...base, [p.key]: p.min } });
    cases.push({ name: `${p.key} at max (${p.max})`, params: { ...base, [p.key]: p.max } });
  }
  if (params.length) {
    cases.push({ name: 'all params at min', params: Object.fromEntries(params.map((p) => [p.key, p.min])) });
    cases.push({ name: 'all params at max', params: Object.fromEntries(params.map((p) => [p.key, p.max])) });
  }
  return cases;
}

// Run async jobs with at most `k` in flight.
async function pool(items, k, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); } };
  await Promise.all(Array.from({ length: Math.min(k, items.length) }, worker));
  return out;
}

const beatSec = 60 / PHRASE_BPM;
function phraseNotes(maxBeat = Infinity, drums = false) {
  return (drums ? drumPhrase() : phrase()).filter((n) => n.t < maxBeat).map((n) => ({ p: n.p, v: n.v, t: 0.05 + n.t * beatSec, d: Math.max(0.02, Math.min(n.d, maxBeat - n.t) * beatSec) }));
}

// An effect's level against its input, on both test signals, each named. A filter or an EQ changes level by input (a
// low-pass takes a lot off a bright strum and little off a kick), so when the two disagree by more than 6 LU no trim
// can satisfy both: that is level.note (how to set the output: on the target track), not a warning nothing could
// clear. "Trim the output" only when both agree.
export function levelWarnings(level, warnings) {
  const dS = level.deltaLU, dD = level.drumsDeltaLU;
  const sg = (x) => `${x > 0 ? '+' : ''}${round(x)}`;
  const by = (x) => (x > 0 ? `${round(x)} LU louder` : `${round(-x)} LU quieter`);
  if (!Number.isFinite(dD)) {
    if (Math.abs(dS) > 6) warnings.push(`level: at default settings the effect is ${by(dS)} than its input on the DI strum: trim the output so on and bypassed sound about the same (within 3 LU)`);
    else if (Math.abs(dS) > 3) warnings.push(`level: ${sg(dS)} LU against the input on the DI strum at defaults (aim for within 3 LU)`);
    return;
  }
  if (Math.abs(dS - dD) > 6) {
    level.note = `level depends on the input: ${sg(dS)} LU on the DI strum, ${sg(dD)} LU on the drum loop at defaults (typical of filters and EQ). Set the output by measuring the target track with the effect on and bypassed (render_and_measure), not by trimming to a test signal`;
  } else if (Math.abs(dS) > 6 && Math.abs(dD) > 6 && Math.sign(dS) === Math.sign(dD)) {
    warnings.push(`level: at default settings the effect is ${by(dS)} than its input on the DI strum and ${by(dD)} on the drum loop: trim the output so on and bypassed sound about the same (within 3 LU)`);
  } else if (Math.abs(dS) > 3 || Math.abs(dD) > 3) {
    warnings.push(`level: ${sg(dS)} LU on the DI strum, ${sg(dD)} LU on the drum loop against the input at defaults (aim for within 3 LU on both)`);
  }
}

export async function checkDevice(def, { quick = false, signal = null, timeout = TIMEOUT } = {}) {
  const T0 = performance.now();
  const errors = [], warnings = [];
  const kind = def && def.kind === 'instrument' ? 'instrument' : 'effect';
  const report = {
    ok: false, id: def && def.id, kind, errors, warnings, ms: 0, timedOut: false,
    compile: { ok: false, error: null, line: null },
    level: null, truePeak: null, peak: null, nan: false, tail: null, cpu: null, latency: null,
    deterministic: null, extremes: null,
  };
  const finish = () => {
    report.ok = !errors.length;
    report.ms = Math.round(performance.now() - T0);
    return report;
  };
  if (!def || typeof def !== 'object') { errors.push('the def must be an object { id, name, kind, params, kernel }'); return finish(); }
  if (def.kind !== 'instrument' && def.kind !== 'effect') { errors.push(`kind must be "instrument" or "effect" (got ${JSON.stringify(def.kind)})`); return finish(); }
  if (typeof def.kernel !== 'string') { errors.push('kernel must be a source string: "({ create({ sr, seed, dsp }) { ... } })"'); return finish(); }
  if (def.kernel.length > 256 * 1024) { errors.push(`the kernel is too large (${Math.ceil(def.kernel.length / 1024)} KB; a device's source can be up to 256 KB)`); return finish(); }
  let params;
  try {
    params = (def.params || []).map(normParam);
    for (const p of params) {
      if (!p.key) throw new Error('a param has no key');
      if (!(p.def >= Math.min(p.min, p.max) && p.def <= Math.max(p.min, p.max))) throw new Error(`param ${p.key}: default ${p.def} is outside ${p.min}..${p.max}`);
      if (p.curve === 'log' && !(p.min > 0)) throw new Error(`param ${p.key}: a log curve needs min > 0 (got ${p.min})`);
    }
  } catch (e) { errors.push('params: ' + e.message); return finish(); }
  if (def.id && !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(def.id)) warnings.push(`id "${def.id}" is not a valid device id (use "<author>.<slug>", lowercase a-z 0-9 . _ -)`);

  // 1. a syntax check on the main thread (fast, with a line number). Parse only: the kernel is evaluated in the
  // worklet alone, so its shape errors (no create(), bad poly, Math.random) arrive with the first render.
  const cr = compileKernel(def.kernel);
  report.compile = { ok: cr.ok, error: cr.ok ? cr.error : said(cr.error), line: cr.line };
  if (!cr.ok) { errors.push('compile: ' + report.compile.error); return finish(); }
  const ndef = { ...def, params };
  const defaults = Object.fromEntries(params.map((p) => [p.key, p.def]));
  let worst = { peak: 0, nan: false };
  const note = (r, label) => {
    if (r.compileError) {
      if (report.compile.ok) report.compile = { ok: false, error: r.compileError, line: r.line || null };
      errors.push(`compile: ${r.compileError}`); return false;
    }
    const s = scan(r.buffer);
    const perr = r.errors.find((e) => e.stage === 'process');
    if (perr) { errors.push(`${label}: ${said(perr.message)}`); report.nan = report.nan || /NaN|Infinity/.test(perr.message); }
    if (s.nan) { report.nan = true; errors.push(`${label}: NaN or Infinity in the output: check divisions, log/sqrt of negatives, and feedback above 1`); }
    return s;
  };
  const peakError = (tp, label) => {
    if (tp > 6) errors.push(`${label}: output peaks at ${round(tp)} dBTP (limit +6): lower the output gain; aim for peaks under -1 dBTP${kind === 'instrument' ? ' and about -14 LUFS' : ' and the input\'s loudness'}`);
  };

  // 2. renders on the audio thread, every wait bounded by the watch (the header says why); none while one this module
  // gave up on still holds the thread, since loading the worklet behind it would block the page
  if (held.size) { report.timedOut = 'busy'; errors.push(BUSY); return finish(); }
  const w = watch(timeout, signal);
  const render = (d, o) => renderOnce(d, o, w);
  try {
    if (kind === 'effect') {
      const strum = stereoOf(diStrum(4, SR));
      const drums = stereoOf(drumLoop(4, SR, 120));
      const main = await render(ndef, { secs: 4, params: defaults, input: strum });
      const s1 = note(main, 'with the DI strum');
      if (!s1) return finish();
      const dr = await render(ndef, { secs: 4, params: defaults, input: drums });
      const s2 = note(dr, 'with the drum loop') || { peak: 0 };
      const inL = measureLufs({ sr: SR, channels: strum }), outL = measureLufs(main.buffer);
      const inD = measureLufs({ sr: SR, channels: drums }), outD = dr.buffer ? measureLufs(dr.buffer) : -120;
      report.level = { lufs: round(outL), deltaLU: round(outL - inL), inLufs: round(inL), drumsDeltaLU: dr.buffer ? round(outD - inD) : null };
      const tp = Math.max(measureTruePeak(main.buffer), dr.buffer ? measureTruePeak(dr.buffer) : -120);
      report.truePeak = round(tp); report.peak = round(dBFS(Math.max(s1.peak, s2.peak)));
      peakError(tp, 'at default settings');
      levelWarnings(report.level, warnings);
      report.cpu = { pct: round((main.ms / 4000) * 100), ms: Math.round(main.ms), secs: 4 };
      if (report.cpu.pct > 25) warnings.push(`cpu: a 4 s render took ${report.cpu.ms} ms (${report.cpu.pct}% of real time) for one instance: look for per-sample trig/pow/exp you could move to per-block`);

      // tail: 1 s of input, then silence
      const limit = def.drone ? 0 : Math.min(quick ? 4 : 12, Math.max(2, (+def.tail || 0) + 2));
      if (!def.drone) {
        const tr = await render(ndef, { secs: 1 + limit, params: defaults, input: pad(cut(strum, 1), 1 + limit) });
        if (note(tr, 'tail render')) {
          const last = lastAbove(tr.buffer, SILENCE, SR);
          const decays = last < tr.buffer.length - Math.round(0.05 * SR);
          report.tail = { seconds: last < 0 ? 0 : round(last / SR - 1, 100), limit, decays };
          if (!decays) warnings.push(`tail: still above -60 dBFS ${limit} s after the input stopped: if it should ring forever set drone: true, otherwise make sure feedback < 1 and add damping${def.tail ? '' : ' (or declare tail: <seconds>)'}`);
        }
      } else report.tail = { seconds: null, limit: 0, decays: null };

      // latency: an impulse at 0.1 s
      const imp = [new Float32Array(SR), new Float32Array(SR)]; imp[0][Math.round(0.1 * SR)] = 1; imp[1][Math.round(0.1 * SR)] = 1;
      const lr = await render(ndef, { secs: 1, params: defaults, input: imp });
      if (note(lr, 'impulse render')) {
        let best = -1, bv = 0; const x = lr.buffer.getChannelData(0), y = lr.buffer.getChannelData(1);
        for (let i = 0; i < x.length; i++) { const a = Math.max(Math.abs(x[i]), Math.abs(y[i])); if (a > bv) { bv = a; best = i; } }
        const declared = Math.round((lr.latency || 0) * SR);
        if (bv > SILENCE) {
          const samples = best - Math.round(0.1 * SR);
          report.latency = { samples, ms: round((samples / SR) * 1000, 100), declared };
          if (declared && Math.abs(samples - declared) > 4 && samples >= 0) warnings.push(`latency: an impulse comes out ${samples} samples late but the kernel declares ${declared}`);
        } else report.latency = { samples: null, ms: null, declared };
      }

      // determinism
      const again = await render(ndef, { secs: quick ? 2 : 4, params: defaults, input: quick ? cut(strum, 2) : strum });
      const first = quick ? await render(ndef, { secs: 2, params: defaults, input: cut(strum, 2) }) : main;
      report.deterministic = !!(again.buffer && first.buffer && hash(again.buffer) === hash(first.buffer));
      if (!report.deterministic) warnings.push('deterministic: two renders of the same input differ: seed every random source from create({ seed }) and keep no state outside create()');

      // extremes
      const cases = paramCases(params, quick);
      const input1 = cut(strum, 1.2);
      const res = await pool(cases, 4, async (cs) => {
        const r = await render(ndef, { secs: 1.2, params: cs.params, input: input1 });
        if (r.compileError) return { case: cs.name, nan: false, peak: null, error: r.compileError };
        const s = scan(r.buffer), perr = r.errors.find((e) => e.stage === 'process');
        return { case: cs.name, nan: s.nan || !!(perr && /NaN|Infinity/.test(perr.message)), peak: round(dBFS(s.peak)), error: perr ? said(perr.message) : null };
      });
      worst = summariseExtremes(res, report, errors);
    } else {
      // instruments
      const drums = def.cat === 'drums'; // a kit plays the GM drum phrase instead of the melodic one
      const phr = quick ? phraseNotes(8, drums) : phraseNotes(32, drums);
      const lastOff = phr.reduce((m, n) => Math.max(m, n.t + n.d), 0);
      const limit = Math.min(quick ? 4 : 10, Math.max(2, (+def.tail || 0) + 2));
      const secs = lastOff + limit;
      const main = await render(ndef, { secs, params: defaults, notes: phr });
      const s1 = note(main, 'playing the test phrase');
      if (!s1) return finish();
      const poly = main.poly || def.poly || 8; // the worklet's (the kernel's poly, else the def's, else 8)
      const L = measureLufs(main.buffer), tp = measureTruePeak(main.buffer);
      report.level = { lufs: round(L), deltaLU: round(L + 14), inLufs: null, drumsDeltaLU: null };
      report.truePeak = round(tp); report.peak = round(dBFS(s1.peak));
      peakError(tp, 'playing the test phrase');
      if (L < -60) errors.push(`level: the test phrase measures ${round(L)} LUFS: effectively no sound. Check that render() adds the voice into L and R (+=) and returns true while it sounds (aim for about -14 LUFS)`);
      else if (L < -40) warnings.push(`level: the test phrase measures ${round(L)} LUFS: is it making sound? (aim for about -14 LUFS)`);
      else if (L < -22 || L > -8) warnings.push(`level: the test phrase measures ${round(L)} LUFS; aim for about -14 LUFS (scale the voice output)`);
      // stuck notes: silence within `limit` after the last note-off
      const last = lastAbove(main.buffer, SILENCE, Math.round(lastOff * SR));
      const decays = last < main.buffer.length - Math.round(0.05 * SR);
      report.tail = { seconds: last < 0 ? 0 : round(Math.max(0, last / SR - lastOff), 100), limit, decays };
      report.stuck = false;
      if (!decays) {
        report.stuck = `still sounding ${limit} s after the last note-off`;
        errors.push(`stuck note: the output is still above -60 dBFS ${limit} s after the last note-off: release() must start a release and render() must return false once it has finished (return env.active())${def.tail ? '' : ', or declare tail: <seconds> for long releases'}`);
      }
      // allOff silences held notes
      const held = [48, 55, 60, 64, 67].map((p, k) => ({ p, v: 0.8, t: 0.05 + k * 0.01, d: 100 }));
      const ao = await render(ndef, { secs: 1 + limit, params: defaults, notes: held, allOffAt: 1 });
      if (note(ao, 'allOff render') && ao.buffer) {
        const la = lastAbove(ao.buffer, SILENCE, SR);
        if (la >= ao.buffer.length - Math.round(0.05 * SR)) {
          report.stuck = report.stuck || 'allOff did not silence held notes';
          errors.push(`stuck note: ${limit} s after allOff() held notes still sound: release() must lead to render() returning false`);
        }
      }
      // cpu: the first 4 s of the phrase
      const cpuNotes = phraseNotes(8, drums);
      const cp = await render(ndef, { secs: 4, params: defaults, notes: cpuNotes });
      if (note(cp, 'cpu render')) report.cpu = { pct: round((cp.ms / 4000) * 100), ms: Math.round(cp.ms), secs: 4 };
      if (report.cpu && report.cpu.pct > 25) warnings.push(`cpu: 4 s of the phrase took ${report.cpu.ms} ms (${report.cpu.pct}% of real time): look for per-sample trig/pow/exp you could move to per-block, or lower poly`);
      // latency: a note-on at 0.25 s
      const lt = await render(ndef, { secs: 1, params: defaults, notes: [{ p: 60, v: 1, t: 0.25, d: 0.5 }] });
      if (note(lt, 'onset render') && lt.buffer) {
        const on = firstAbove(lt.buffer, 1e-5, 0);
        report.latency = { samples: on < 0 ? null : on - Math.round(0.25 * SR), ms: on < 0 ? null : round(((on - 0.25 * SR) / SR) * 1000, 100), declared: Math.round((lt.latency || 0) * SR) };
        if (on < 0) warnings.push('a note at full velocity made no sound in the first 0.75 s');
        else if (on < Math.round(0.25 * SR)) warnings.push('sound before the first note-on: voices should be silent until start()');
      }
      // determinism
      const again = await render(ndef, { secs: 4, params: defaults, notes: cpuNotes });
      report.deterministic = !!(again.buffer && cp.buffer && hash(again.buffer) === hash(cp.buffer));
      if (!report.deterministic) warnings.push('deterministic: two renders of the same notes differ: seed every random source from create({ seed }) / voice(i) and keep no state outside create()');
      // stealing: poly + 4 notes held at once
      const many = Array.from({ length: poly + 4 }, (_, k) => ({ p: 40 + ((k * 7) % 36), v: 0.7, t: 0.05 + k * 0.02, d: 1.2 }));
      const st = await render(ndef, { secs: 1.5 + limit, params: defaults, notes: many, stats: true });
      if (note(st, `${poly + 4} notes at once (poly ${poly})`) && st.buffer) {
        const v = st.stats || {};
        report.voices = { poly, maxVoices: v.maxVoices ?? null, steals: v.steals ?? null };
        if (v.maxVoices != null && v.maxVoices > poly + 2) errors.push(`voices: ${v.maxVoices} voices ran at once with poly ${poly} (stealing failed)`);
        if (v.steals != null && v.steals < 4 && v.maxVoices >= poly) warnings.push(`voices: ${poly + 4} held notes caused ${v.steals} steals (expected 4)`);
        const stp = measureTruePeak(st.buffer);
        peakError(stp, `${poly + 4} notes at once`);
        if (stp > report.truePeak) report.truePeak = round(stp);
        const la = lastAbove(st.buffer, SILENCE, Math.round(1.3 * SR));
        if (la >= st.buffer.length - Math.round(0.05 * SR)) { report.stuck = report.stuck || 'after voice stealing'; errors.push('stuck note after voice stealing: a stolen-and-reused voice never finished; reset all per-note state in start()'); }
      }
      // extremes: a short phrase at each case
      const ex = phraseNotes(4, drums).concat([{ p: 36, v: 1, t: 1.6, d: 0.3 }, { p: 96, v: 1, t: 1.7, d: 0.3 }]);
      const cases = paramCases(params, quick);
      const res = await pool(cases, 4, async (cs) => {
        const r = await render(ndef, { secs: 2.5, params: cs.params, notes: ex });
        if (r.compileError) return { case: cs.name, nan: false, peak: null, error: r.compileError };
        const s = scan(r.buffer), perr = r.errors.find((e) => e.stage === 'process');
        return { case: cs.name, nan: s.nan || !!(perr && /NaN|Infinity/.test(perr.message)), peak: round(dBFS(s.peak)), error: perr ? said(perr.message) : null };
      });
      worst = summariseExtremes(res, report, errors);
    }
  } catch (e) {
    if (e !== w.reason || e.name === 'AbortError') throw e;
    report.timedOut = !w.loaded ? 'busy' : !w.created ? 'create' : 'process';
    const s = Math.round(timeout / 100) / 10;
    errors.unshift(report.timedOut === 'busy' ? BUSY
      : report.timedOut === 'create'
        ? `timeout: create() had not returned after ${s} s, so it may never return: give every loop in it a fixed bound`
        : `timeout: a test render had not finished after ${s} s, so ${kind === 'instrument' ? 'render() or process()' : 'process()'} may never return (or is far too slow to play): give every loop a bound that doesn't depend on the input, a param or a value that can go NaN`);
  } finally { w.end(); }
  void worst;
  return finish();
}

function summariseExtremes(res, report, errors, warnings = report.warnings) {
  // A boost the player dialled in can legitimately pass 0 dBFS (an EQ with every band at max); a runaway can't.
  // So: over +6 dBFS at an extreme is a warning, over +24 dBFS (16x full scale) is a failure.
  const failed = res.filter((r) => r.nan || r.error || (r.peak != null && r.peak > 24));
  const hot = res.filter((r) => !failed.includes(r) && r.peak != null && r.peak > 6);
  const worstPeak = res.reduce((m, r) => (r.peak != null && r.peak > m ? r.peak : m), -120);
  report.extremes = { cases: res.length, worstPeak: round(worstPeak), failed, hot: hot.map((h) => h.case) };
  for (const f of failed) {
    if (f.nan) { report.nan = true; errors.push(`extremes (${f.case}): NaN or Infinity${f.error ? ' - ' + f.error : ''}: guard the math at the ends of each range (clamp before log/sqrt/division; keep feedback < 1)`); }
    else if (f.error) errors.push(`extremes (${f.case}): ${f.error}`);
    else errors.push(`extremes (${f.case}): raw peak ${f.peak} dBFS (limit +24): it runs away at that end of the range; tame the gain or the feedback`);
  }
  if (hot.length) {
    const w = hot.reduce((a, b) => (b.peak > a.peak ? b : a));
    warnings.push(`extremes: ${hot.length} setting${hot.length > 1 ? 's' : ''} peak over +6 dBFS (worst: ${w.case}, ${w.peak} dBFS): fine for a boost the player chooses, otherwise narrow the range or add makeup that follows the gain`);
  }
  return { peak: worstPeak };
}

// A one-line summary for logs and the agent ("ok -14.2 LUFS, -1.3 dBTP, tail 1.8 s, cpu 1.2%").
export function summarize(r) {
  if (!r.compile.ok) return `refused: ${r.errors[0]}`;
  const bits = [];
  if (r.level) bits.push(r.kind === 'effect' ? `${r.level.deltaLU >= 0 ? '+' : ''}${r.level.deltaLU} LU vs input` : `${r.level.lufs} LUFS`);
  if (r.truePeak != null) bits.push(`${r.truePeak} dBTP`);
  if (r.tail && r.tail.seconds != null) bits.push(`tail ${r.tail.seconds} s`);
  if (r.cpu) bits.push(`cpu ${r.cpu.pct}%`);
  if (r.latency && r.latency.samples) bits.push(`latency ${r.latency.samples} smp`);
  return `${r.ok ? 'ok' : 'FAILED'}: ${bits.join(', ')}${r.errors.length ? ' | ' + r.errors.join(' | ') : ''}${r.warnings.length ? ' | warn: ' + r.warnings.join(' | ') : ''}`;
}
