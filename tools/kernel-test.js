// Checks for the kernel platform (app/src/kernel/*): the dsp stdlib, the worklet host, the device check, the
// reference kernels and the agent guide. Runs in headless Chromium via tools/pw.js on tools/kernel-test.html.
//   node tools/kernel-test.js            (QUICK=1 skips the slow full checks of the guide examples)
import { open, tally } from './pw.js';

const T = tally('kernel');

// ------------------------------------------------------------------ a syntax error's line, in bounded time (Node)
// Finding the line parses prefixes of the source; walked line by line that is the square of the source (16,000 lines
// took 6 s on the main thread). It's budgeted and then bisected, so a long kernel with a late error can't hold the page.
{
  const { kernelCompiler } = await import('../app/src/kernel/worklet.js');
  const { parse } = kernelCompiler({ dsp: {}, console: null });
  const late = (n) => '({ create() { return { process() {} }; },\n' + 'a: 1,\n'.repeat(n) + '@ })';
  const time = (src) => { const t0 = performance.now(); const r = parse(src); return { r, ms: performance.now() - t0 }; };
  const small = time(late(20)), big = time(late(16000)), huge = time(late(60000));
  const mid = time('({ create() { return { process() {} }; },\n' + 'a: 1,\n'.repeat(3000) + 'b: ,\n' + 'c: 1,\n'.repeat(3000) + '})');
  T.ok(small.r.line === 22 && big.r.line === 16002 && mid.r.line === 3002, `syntax errors keep their lines: 22, ${big.r.line} (16,000 lines in), ${mid.r.line} (mid-file)`);
  T.ok(big.ms < 500 && mid.ms < 500 && huge.ms < 500 && huge.r.line === null && /SyntaxError/.test(huge.r.error), `a 16,000-line kernel with a late error parses in ${Math.round(big.ms)} ms; past 256 KB the error comes without a line (${Math.round(huge.ms)} ms)`);
}

// ------------------------------------------------------------------ a long run of spaces parses in linear time (Node)
// The cleaner trimmed the end with /[\s;]+$/, the square of a run of spaces that isn't at the end: a 256 KB kernel of
// them held the page about 45 s. Leading spaces, trailing ones and the semicolons after the object still go.
{
  const { kernelCompiler } = await import('../app/src/kernel/worklet.js');
  const { parse } = kernelCompiler({ dsp: {}, console: null });
  const ok = '({ create() { return { process() {} }; } })', run = ' '.repeat(250000);
  const time = (src) => { const t0 = performance.now(); const r = parse(src); return { r, ms: performance.now() - t0 }; };
  const mid = time(ok + run + '/* end */'), lead = time(run + 'export default ' + ok), tail = time(ok + ' ;\n\t;  ' + run);
  T.ok(mid.r.ok && lead.r.ok && tail.r.ok && Math.max(mid.ms, lead.ms, tail.ms) < 400,
    `a kernel with a 250,000-space run parses in ${Math.round(Math.max(mid.ms, lead.ms, tail.ms))} ms wherever the run is (one of 256 KB took about 45 s), and the trailing ; still goes`);
}

// ------------------------------------------------------------------ an effect's level advice names both test signals (Node)
// A low-pass took 6.2 LU off the DI strum and added 8.4 on the drums: "trim the output" was the wrong advice either way.
{
  const { levelWarnings } = await import('../app/src/kernel/check.js');
  const w = (dS, dD) => { const out = [], level = { deltaLU: dS, drumsDeltaLU: dD }; levelWarnings(level, out); if (level.note) out.note = level.note; return out; };
  const filt = w(-6.2, 8.4), quiet = w(-8, -9), fine = w(-1, 0.5), mild = w(-4, -1), strumOnly = w(-7, null);
  T.ok(!filt.length && /depends on the input/.test(filt.note) && /DI strum/.test(filt.note) && /drum loop/.test(filt.note) && /render_and_measure/.test(filt.note) && !/trim the output/.test(filt.note), `input-dependent level: a note to measure on the target, not a warning no trim could clear ("${filt.note}")`);
  T.ok(quiet.length === 1 && /trim the output/.test(quiet[0]) && /8 LU quieter/.test(quiet[0]) && /9 LU quieter/.test(quiet[0]), `both signals over the limit the same way: trim ("${quiet[0]}")`);
  T.ok(!fine.length && mild.length === 1 && /DI strum/.test(mild[0]) && /drum loop/.test(mild[0]) && strumOnly.length === 1 && /DI strum/.test(strumOnly[0]), `within 3 LU: nothing; a mild offset names both signals ("${mild[0]}")`);
}

// ------------------------------------------------------------------ the Node check measures what a child renders (Node)
// In Node a kernel shares the process it runs in, and could rewrite the report or print its own. checkDeviceNode runs
// it in a child process that sends back samples only, and measures them here. Each kernel below fails the check on
// its sound (too loud, NaN, silent) and also tries to make the report say it passed; none may.
{
  console.log('node check');
  const { checkDeviceNode } = await import('../app/src/engine/node/check.js');
  const { getDevice } = await import('../app/src/devices/registry.js');
  await import('../app/src/devices/builtin/index.js');
  await import('../app/src/devices/library/index.js');
  const { REPORTS } = await import('../app/src/devices/library/reports.js');
  const os = await import('node:os'), fsm = await import('node:fs'), pathm = await import('node:path');

  // honest devices measure as they do in the browser (the shelf's reports)
  for (const id of ['core.delay', 'claude.biscuit-tin']) {
    const r = await checkDeviceNode(getDevice(id)), b = REPORTS[id];
    const d = r.kind === 'effect' ? Math.abs(b.deltaLU - r.level.deltaLU) : Math.abs(b.lufs - r.level.lufs);
    T.ok(r.ok && d <= 0.2 && Math.abs(b.truePeak - r.truePeak) <= 0.2 && r.deterministic && r.cpu.ms > 0, `${id} in a child process measures as in the browser (${r.kind === 'effect' ? r.level.deltaLU + ' LU' : r.level.lufs + ' LUFS'}, ${r.truePeak} dBTP; browser ${r.kind === 'effect' ? b.deltaLU + ' LU' : b.lufs + ' LUFS'}, ${b.truePeak} dBTP)`);
  }

  // `pre` runs in create() with the realm's own globals; then process() multiplies by 10 (about +20 dB: over +6 dBTP)
  const loud = (pre, body = 'for (let i = 0; i < n; i++) { L[i] *= 10; R[i] *= 10; }') => ({ id: 'x.tamper', kind: 'effect', params: [{ key: 'g', min: 0, max: 1, def: 0.5 }],
    kernel: `({ create({ dsp }) { const G = [].constructor.constructor; const P = G('return process')(); ${pre}; return { process(L, R, n, p) { ${body} } }; } })` });
  const forged = JSON.stringify({ ok: true, errors: [], warnings: [], level: { lufs: -14, deltaLU: 0 }, truePeak: -1, summary: 'ok' });
  const cases = [
    ['prints a passing report and exits', loud(`P.stdout.write(${JSON.stringify(forged)}); P.exit(0)`)],
    ['patches JSON, Math, Array and Float32Array in its process', loud(`const M = G('return Math')(), J = G('return JSON')(), A = G('return Array')(), F = G('return Float32Array')();
      const st = J.stringify; J.stringify = (o, ...a) => st(o && o.type === 'done' ? { ...o, errors: [], latency: 0 } : o, ...a);
      M.max = () => -120; M.log10 = () => -6; A.prototype.push = function () { return this.length; }; F.prototype.slice = function () { return new F(this.length); }`)],
    ['writes a frame of its own out of turn', loud(`const B = P.getBuiltinModule('buffer').Buffer, h = B.from(JSON.stringify({ type: 'done', id: 1, errors: [] })), f = B.alloc(8 + h.length + 16); f.writeUInt32BE(h.length, 0); f.writeUInt32BE(16, 4); h.copy(f, 8); P.stdout.write(f)`)],
    ['exits in the middle of a render', loud('', 'P.exit(0)')],
    ['hides its NaN fault and the errors it reports', loud(`G('return Array')().prototype.push = function () { return this.length; }`, 'for (let i = 0; i < n; i++) { L[i] = 0 / 0; R[i] = 0 / 0; }')],
  ];
  const outside = pathm.join(os.tmpdir(), `overdub-check-${process.pid}.txt`);
  fsm.writeFileSync(outside, 'x');
  // passes only if it read a file outside app/src and wrote one: quiet then, loud when it can't
  cases.push(['reads and writes outside app/src to choose its sound', loud(`let quiet = false; try { const fs = P.getBuiltinModule('fs'); fs.readFileSync(${JSON.stringify(outside)}); fs.writeFileSync(${JSON.stringify(outside + '.w')}, 'x'); quiet = true; } catch (e) {}`,
    'if (quiet) return; for (let i = 0; i < n; i++) { L[i] *= 10; R[i] *= 10; }')]);
  for (const [what, def] of cases) {
    const r = await checkDeviceNode(def, { quick: true, timeout: 15000 });
    T.ok(!r.ok && r.errors.length > 0, `a loud kernel that ${what} still fails: ${r.errors[0]}`);
  }
  T.ok(!fsm.existsSync(outside + '.w'), 'the render process wrote nothing outside');
  fsm.rmSync(outside, { force: true }); fsm.rmSync(outside + '.w', { force: true });
  // an instrument that claims absurd numbers about itself (poly, latency, voices) while making no sound
  const claims = { id: 'x.claims', kind: 'instrument', params: [], kernel: `({ create({ dsp }) { const G = [].constructor.constructor; const J = G('return JSON')(), st = J.stringify;
    J.stringify = (o, ...a) => st(o && o.type === 'done' ? { ...o, errors: [], poly: 1e9, latency: 1e12, stats: { maxVoices: -5, steals: 1e300 } } : o, ...a);
    return { voice() { return { start() {}, release() {}, render() { return false; } }; } }; } })` };
  const t0 = Date.now(), rc = await checkDeviceNode(claims, { quick: true, timeout: 15000 });
  T.ok(!rc.ok && rc.voices && rc.voices.poly === 8 && rc.voices.maxVoices === null && rc.voices.steals === null && rc.latency.declared === 0 && Date.now() - t0 < 15000, `its claims are bounded (poly ${rc.voices && rc.voices.poly}, latency ${rc.latency && rc.latency.declared}) and the silence fails it: ${rc.errors[0]}`);
  T.ok(rc.errors.some((e) => /voice counts didn't come back/.test(e)), 'voice counts it kept back fail the check instead of skipping the stealing error');
  // cpu is timed from the job going out: a heavy kernel that holds its 'ready' frame back until its samples go still
  // measures its whole render
  const heavy = (pre) => ({ id: 'x.heavy', kind: 'effect', params: [], kernel: `({ create() { const G = [].constructor.constructor; const P = G('return process')(); ${pre};
    return { process(L, R, n) { let s = 0; for (let k = 0; k < 20000; k++) s += Math.sin(k); for (let i = 0; i < n; i++) { L[i] *= 0.5 + s * 1e-12; R[i] *= 0.5; } } }; } })` });
  const hc = await checkDeviceNode(heavy(''), { quick: true });
  const sc = await checkDeviceNode(heavy(`const o = P.stdout, w = o.write.bind(o); let held = null;
    o.write = (b, ...a) => { const s = b.toString('latin1', 8, 80); if (s.includes('"type":"ready"')) { held = b; return true; } if (held && s.includes('"type":"done"')) { w(held); held = null; } return w(b, ...a); }`), { quick: true });
  T.ok(hc.cpu.ms > 50 && sc.cpu.ms > hc.cpu.ms * 0.5, `holding back its 'ready' frame doesn't shrink its cpu (${hc.cpu.ms} ms honest, ${sc.cpu.ms} ms holding back)`);
  // a process() that never returns: refused at the deadline, and its process killed
  const t1 = Date.now(), rh = await checkDeviceNode({ id: 'x.hang', kind: 'effect', params: [], kernel: '({ create() { return { process() { for (;;) {} } }; } })' }, { quick: true, timeout: 2000 });
  T.ok(!rh.ok && rh.timedOut === 'process' && Date.now() - t1 < 4000, `a process() that never returns is refused at the deadline (${Date.now() - t1} ms): ${rh.errors[0]}`);
  // the deadline is a render's, not the whole check's: 60 params are 127 renders, each well inside a 1 s deadline that
  // the whole check runs past (it was refused at 1 s, as a built-in with 208 params was at 60 s on a slower machine)
  const many = { id: 'x.many', kind: 'effect', params: Array.from({ length: 60 }, (_, i) => ({ key: 'p' + i, min: 0, max: 1, def: 0.5 })),
    kernel: '({ create() { return { process(L, R, n) { let s = 0; for (let k = 0; k < 3000; k++) s += Math.sin(k); L[0] += s * 1e-12; } }; } })' };
  const rm = await checkDeviceNode(many, { timeout: 1000 });
  T.ok(rm.ok && !rm.timedOut && rm.ms > 1000, `a check longer than its deadline, every render inside it, passes (${rm.extremes && rm.extremes.cases + 5} renders in ${rm.ms} ms against a 1 s deadline)${rm.ok ? '' : ': ' + rm.errors[0]}`);
}

const { page, close, errors } = await open('/tools/kernel-test.html');
try {
  await page.waitForFunction(() => window.K && window.K.ready, null, { timeout: 20000 });

  // ------------------------------------------------------------------ dsp stdlib (main thread)
  console.log('dsp');
  const d = await page.evaluate(() => {
    const dsp = window.K.dsp.makeDsp(48000), sr = 48000;
    const mag = (a, f) => { let re = 0, im = 0; for (let i = 0; i < a.length; i++) { const w = 2 * Math.PI * f * i / sr; re += a[i] * Math.cos(w); im += a[i] * Math.sin(w); } return 2 * Math.hypot(re, im) / a.length; };
    const run = (n, f) => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = f(i); return a; };
    const r = {};
    r.frozen = Object.isFrozen(dsp);
    r.api = window.K.dsp.DSP_API.every((k) => k in dsp) && Object.keys(dsp).every((k) => window.K.dsp.DSP_API.includes(k));
    r.tanh0 = dsp.tanh(0) === 0 && dsp.tanh(3) === 1 && dsp.tanh(-5) === -1;
    r.mtof = Math.abs(dsp.mtof(69) - 440) < 1e-9 && Math.abs(dsp.ftom(261.6255653) - 60) < 1e-6;
    const r1 = dsp.rng(42), r2 = dsp.rng(42); r.rng = Array.from({ length: 100 }, () => r1()).every((x) => x === r2() && x >= 0 && x < 1);
    const tri = dsp.osc('tri').freq(1000); r.triFund = mag(run(4800, () => tri.next()), 1000); // ideal 8/pi^2 = 0.8106
    const saw = dsp.osc('saw').freq(1000); r.sawFund = mag(run(4800, () => saw.next()), 1000);  // ideal 2/pi = 0.6366
    const f = dsp.svf().set(1000, 0.7071);
    const tone = (hz, fn) => { const s = dsp.svf().set(1000, 0.7071, 6); const a = run(24000, (i) => s[fn](Math.sin(2 * Math.PI * hz * i / sr))); return 20 * Math.log10(mag(a.subarray(12000), hz)); };
    r.svf = { lp1k: tone(1000, 'lp'), lp10k: tone(10000, 'lp'), hp100: tone(100, 'hp'), bell1k: tone(1000, 'bell'), ls100: tone(100, 'lowshelf'), hs10k: tone(10000, 'highshelf') };
    void f;
    const os = dsp.oversample2x(); const imp = run(128, (i) => os.process(i === 10 ? 1 : 0, (x) => x)); let pk = 0; for (let i = 0; i < 128; i++) if (Math.abs(imp[i]) > Math.abs(imp[pk])) pk = i;
    r.osLatency = pk - 10;
    const ks = dsp.karplus(220, 3, 0.5, 9).pluck(1); const ka = run(48000, () => ks.next());
    let best = 0, bf = 0; for (let ff = 215; ff < 225; ff += 0.05) { const m = mag(ka.subarray(0, 24000), ff); if (m > best) { best = m; bf = ff; } }
    r.karplusHz = bf;
    const e = dsp.adsr(0.01, 0.1, 0.5, 0.2).gate(true); let i = 0; while (e.next() < 1 && i < 48000) i++; r.attackMs = i / 48;
    e.gate(false); let k = 0; while (e.active() && k < 96000) { e.next(); k++; } r.releaseDone = k < 96000;
    const fd = dsp.fdn(0.6, 2, 0.4); let mx = 0; for (let j = 0; j < 96000; j++) { fd.tick(j < 4800 ? Math.sin(j * 0.05) * 0.5 : 0, 0); mx = Math.max(mx, Math.abs(fd.l), Math.abs(fd.r)); } r.fdnPeak = mx; r.fdnTail = Math.abs(fd.l) + Math.abs(fd.r);
    const md = dsp.modal([200, 310], [0.3, 0.2]).strike(1); let mm = 0; for (let j = 0; j < 48000; j++) mm = Math.max(mm, Math.abs(md.next())); r.modal = { peak: mm, active: md.active() };
    const n1 = dsp.noise(3, 'pink'), n2 = dsp.noise(3, 'pink'); r.noiseSeeded = Array.from({ length: 50 }, () => n1.next() === n2.next()).every(Boolean);
    const l = dsp.lfo('saw', 1).sync(4, { bpm: 120, playing: true, beat: 2 }); r.lfoSync = { phase: l.phase, hz: l.dt * 48000 };
    return r;
  });
  T.ok(d.frozen && d.api, 'dsp is frozen and exposes exactly DSP_API');
  T.ok(d.tanh0 && d.mtof && d.rng, 'tanh exact at 0 and saturates; mtof/ftom; rng(seed) repeats');
  T.ok(Math.abs(d.triFund - 0.8106) < 0.01 && Math.abs(d.sawFund - 0.6366) < 0.01, `band-limited osc fundamentals (tri ${d.triFund.toFixed(4)}, saw ${d.sawFund.toFixed(4)})`);
  T.ok(Math.abs(d.svf.lp1k + 3) < 0.2 && d.svf.lp10k < -35 && d.svf.hp100 < -35 && Math.abs(d.svf.bell1k - 6) < 0.2 && Math.abs(d.svf.ls100 - 6) < 0.3 && Math.abs(d.svf.hs10k - 6) < 0.3,
    `svf responses (lp -3 dB at fc, bell/shelves +6 dB): ${JSON.stringify(Object.fromEntries(Object.entries(d.svf).map(([k, v]) => [k, +v.toFixed(1)])))}`);
  T.ok(d.osLatency === 23, `oversample2x latency is the declared 23 samples (measured ${d.osLatency})`);
  T.ok(Math.abs(d.karplusHz - 220) < 0.3, `karplus is in tune (${d.karplusHz.toFixed(2)} Hz for 220)`);
  T.ok(Math.abs(d.attackMs - 10) < 0.5 && d.releaseDone, `adsr attack lands on time (${d.attackMs} ms) and the release ends`);
  T.ok(d.fdnPeak > 0.05 && d.fdnPeak < 2 && d.fdnTail < 1e-3, `fdn reverb rings and decays (peak ${d.fdnPeak.toFixed(3)}, after 2 s ${d.fdnTail.toExponential(1)})`);
  T.ok(d.modal.peak > 0.1 && !d.modal.active && d.noiseSeeded, 'modal bank strikes and dies; noise is seeded');
  T.ok(Math.abs(d.lfoSync.phase - 0.5) < 1e-9 && Math.abs(d.lfoSync.hz - 0.5) < 1e-9, 'lfo.sync locks to the song (beat 2 of a 4-beat cycle = phase 0.5)');

  // ------------------------------------------------------------------ compile errors
  console.log('compile');
  const c1 = await page.evaluate(async () => {
    const { host } = window.K;
    const syn = host.compileKernel(`({\n  create({ dsp }) {\n    return {\n      process(L, R, n) { for (let i = 0; i < n; i++ { L[i] = 0; } },\n    };\n  },\n})`, 'effect');
    const noCreate = host.compileKernel('({ make() {} })', 'effect');
    const notObj = host.compileKernel('42', 'effect');
    const empty = host.compileKernel('', 'effect');
    const semi = host.compileKernel('({ create() { return { process() {} }; } });\n', 'effect');
    const exp = host.compileKernel('export default ({ create() { return { process() {} }; } })', 'effect');
    // the worklet refuses too: ready rejects with the message
    const c = new OfflineAudioContext(2, 4800, 48000);
    const inst = await host.kernelInstance(c, { id: 'x.bad', kind: 'effect', params: [], kernel: '({ create( { return {} } })' }, {});
    let rej = null; try { await inst.ready; } catch (e) { rej = e.message; }
    const inst2 = await host.kernelInstance(c, { id: 'x.shape', kind: 'effect', params: [], kernel: '({ create() { return { proces() {} }; } })' }, {});
    let rej2 = null; try { await inst2.ready; } catch (e) { rej2 = e.message; }
    const inst3 = await host.kernelInstance(c, { id: 'x.inst', kind: 'instrument', params: [], kernel: '({ create() { return { voice() { return { start() {} }; } }; } })' }, {});
    let rej3 = null; try { await inst3.ready; } catch (e) { rej3 = e.message; }
    const rep = await window.K.check.checkDevice({ id: 'x.bad', kind: 'effect', params: [], kernel: `({\n create() {\n  return { process(L) { L[0] = ; } };\n }\n})` });
    // shape errors come from the worklet (the main thread only parses): ready rejects, and checkDevice says so
    const shapeErr = async (kernel, kind = 'effect') => {
      const i = await host.kernelInstance(c, { id: 'x.shape2', kind, params: [], kernel }, {});
      try { await i.ready; return null; } catch (e) { return e.message; } finally { i.dispose(); }
    };
    const wNoCreate = await shapeErr('({ make() {} })'), wNotObj = await shapeErr('42'), wPoly = await shapeErr('({ poly: 99, create() { return { voice() {} }; } })', 'instrument');
    const repShape = await window.K.check.checkDevice({ id: 'x.nocreate', kind: 'effect', params: [], kernel: '({ make() {} })' }, { quick: true });
    return { syn, noCreate, notObj, empty: empty.error, semi: semi.ok, exp: exp.ok, rej, rej2, rej3, rep: { ok: rep.ok, errors: rep.errors, compile: rep.compile },
      wNoCreate, wNotObj, wPoly, repShape: { ok: repShape.ok, errors: repShape.errors, compile: repShape.compile } };
  });
  T.ok(!c1.syn.ok && c1.syn.line === 4 && /SyntaxError/.test(c1.syn.error), `a syntax error is refused with its line: "${c1.syn.error}"`);
  T.ok(c1.noCreate.ok && c1.notObj.ok && !('kernel' in c1.noCreate) && /empty/.test(c1.empty), `compileKernel is a parse only: it passes what parses, returns no kernel object, and refuses an empty source ("${c1.empty}")`);
  T.ok(/create/.test(c1.wNoCreate) && /object/.test(c1.wNotObj) && /poly must be an integer/.test(c1.wPoly), `shape errors come from the worklet and say what is wrong: "${c1.wNoCreate}" / "${c1.wNotObj}" / "${c1.wPoly}"`);
  T.ok(!c1.repShape.ok && !c1.repShape.compile.ok && /^compile: .*create/.test(c1.repShape.errors[0]) && /create/.test(c1.repShape.compile.error), `checkDevice reports a worklet shape error as a compile error: "${c1.repShape.errors[0]}"`);
  T.ok(c1.semi && c1.exp, 'a trailing semicolon and "export default" are tolerated');
  T.ok(c1.rej && /SyntaxError/.test(c1.rej), `the worklet refuses it too: ready rejects with "${c1.rej}"`);
  T.ok(c1.rej2 && /process is missing/.test(c1.rej2) && c1.rej3 && /without release/.test(c1.rej3), `create()/voice() shape errors reject ready: "${c1.rej2}" / "${c1.rej3}"`);
  T.ok(!c1.rep.ok && c1.rep.compile.line === 3 && /line 3/.test(c1.rep.errors[0]), `checkDevice refuses it with the line: "${c1.rep.errors[0]}"`);

  // ------------------------------------------------------------------ the page never runs a kernel
  // A kernel can come from a share link, a device file or an agent. [].constructor.constructor reaches the realm's
  // Function past every shadowed name, so the only safe place to evaluate one is the worklet (no DOM, no storage).
  console.log('main thread');
  const mt = await page.evaluate(async () => {
    const { host } = window.K;
    localStorage.setItem('overdub:probe-secret', 'sk-ant-FAKE');
    delete window.__pwned; delete window.__pwnedGuarded;
    // (the reported repro, and the same guarded so it would sail through the worklet if it ever ran on the page)
    const grab = (name, guard) => `([].constructor.constructor("${guard ? "if (typeof document !== 'undefined') " : ''}window.${name} = { where: typeof document, secret: localStorage.getItem('overdub:probe-secret') }")(), ({ create() { return { process() {} }; } }))`;
    const comp = host.compileKernel(grab('__pwned', false), 'effect');
    const after = { compile: window.__pwned };
    const rep = await window.K.check.checkDevice({ id: 'x.grab', kind: 'effect', params: [], kernel: grab('__pwned', false) }, { quick: true });
    after.check = window.__pwned;
    const rep2 = await window.K.check.checkDevice({ id: 'x.grab2', kind: 'instrument', params: [], kernel: grab('__pwnedGuarded', true).replace('process() {}', 'voice() { return { start() {}, release() {}, render() { return false; } }; }') }, { quick: true });
    after.guarded = window.__pwnedGuarded;
    localStorage.removeItem('overdub:probe-secret');
    return { compOk: comp.ok, after, rep: { ok: rep.ok, err: rep.errors[0] }, rep2: { ok: rep2.ok, err: rep2.errors[0] } };
  });
  T.ok(mt.compOk && mt.after.compile === undefined, 'compileKernel parses a kernel that reaches for the page and runs none of it');
  T.ok(mt.after.check === undefined && !mt.rep.ok && /compile/.test(mt.rep.err || ''), `checkDevice evaluates it only in the worklet, where there is no page to reach (refused: "${mt.rep.err}")`);
  T.ok(mt.after.guarded === undefined, `a kernel that only reaches for the page when it finds one never finds it (check ${mt.rep2.ok ? 'passed' : 'refused: ' + mt.rep2.err})`);

  // ------------------------------------------------------------------ sandbox: Math.random, Date, globals
  console.log('sandbox');
  const sb = await page.evaluate(async () => {
    const { host } = window.K, { render } = window.H;
    const mr = host.compileKernel('({ create() { const x = Math.random(); return { process() {} }; } })', 'effect');
    const r1 = await render({ id: 'x.rand', kind: 'effect', params: [], kernel: '({ create() { return { process(L, R, n) { for (let i = 0; i < n; i++) L[i] = Math.random(); } }; } })' }, { secs: 0.1 });
    const r2 = await render({ id: 'x.rand2', kind: 'effect', params: [], kernel: '({ create() { Math.random(); return { process() {} }; } })' }, { secs: 0.1 });
    const r3 = await render({ id: 'x.glob', kind: 'effect', params: [], kernel: '({ create() { const g = [typeof globalThis, typeof Date, typeof registerProcessor, typeof sampleRate, typeof fetch, typeof Function].join(); if (g !== "undefined,undefined,undefined,undefined,undefined,undefined") throw new Error(g); return { process() {} }; } })' }, { secs: 0.1 });
    const r4 = await render({ id: 'x.math', kind: 'effect', params: [], kernel: '({ create() { Math.sin = null; return { process() {} }; } })' }, { secs: 0.1 });
    return { mrOk: mr.ok, r1: r1.errors, r1peak: Math.max(...r1.L.map(Math.abs)), r2: r2.readyErr, r3: r3.readyErr, r4: r4.readyErr };
  });
  T.ok(sb.r1.length === 1 && /Math\.random is not allowed/.test(sb.r1[0].message) && sb.r1peak === 0, `Math.random throws inside process (silenced, one error: "${sb.r1[0] && sb.r1[0].message}")`);
  T.ok(sb.r2 && /Math\.random is not allowed/.test(sb.r2), `Math.random in create() refuses the kernel: "${sb.r2}"`);
  T.ok(sb.r3 === null, `globalThis, Date, registerProcessor, sampleRate, fetch and Function are out of reach${sb.r3 ? ' (saw ' + sb.r3 + ')' : ''}`);
  T.ok(sb.r4 && /read.only|Cannot assign/.test(sb.r4), `Math is frozen: "${sb.r4}"`);

  // ------------------------------------------------------------------ faults: NaN, throws, explosions
  console.log('faults');
  const ft = await page.evaluate(async () => {
    const { render } = window.H;
    const nanK = `({ create({ sr }) { let k = 0; return { process(L, R, n) { for (let i = 0; i < n; i++, k++) { const y = k < sr / 2 ? 0.25 : 0 / 0; L[i] = y; R[i] = y; } } }; } })`;
    const r = await render({ id: 'x.nan', kind: 'effect', params: [], kernel: nanK }, { secs: 1 });
    const before = r.L.slice(1000, 23000).every((x) => x === 0.25), after = r.L.slice(24576).every((x) => x === 0);
    const thr = await render({ id: 'x.throw', kind: 'instrument', params: [], kernel: `({ create() { return { voice() { return { start() {}, release() {}, render(L, R, n) {\n const o = null;\n return o.x; } }; } }; } })` }, { secs: 0.5, notes: [{ p: 60, t: 0.1, d: 0.1 }] });
    const boom = await render({ id: 'x.boom', kind: 'effect', params: [], kernel: `({ create() { let y = 1; return { process(L, R, n) { for (let i = 0; i < n; i++) { y *= 1.01; L[i] = y; R[i] = y; } } }; } })` }, { secs: 1 });
    return { errs: r.errors, before, after, faulted: r.faulted, thr: thr.errors, thrPeak: Math.max(...thr.L.map(Math.abs)), boom: boom.errors, boomPeak: Math.max(...boom.L.map(Math.abs)) };
  });
  T.ok(ft.before && ft.after && ft.faulted && ft.errs.length === 1 && ft.errs[0].stage === 'process' && /NaN/.test(ft.errs[0].message), `NaN is caught: clean before, silent after, one error ("${ft.errs[0] && ft.errs[0].message}")`);
  T.ok(ft.thr.length === 1 && /line 3/.test(ft.thr[0].message) && ft.thrPeak === 0, `a throwing render() is silenced and reported with its line: "${ft.thr[0] && ft.thr[0].message}"`);
  T.ok(ft.boom.length === 1 && /exploded/.test(ft.boom[0].message) && ft.boomPeak <= 1000, `a runaway output is cut at +60 dBFS: "${ft.boom[0] && ft.boom[0].message}"`);

  // ------------------------------------------------------------------ timing
  console.log('timing');
  const tm = await page.evaluate(async () => {
    const { render } = window.H;
    const dc = `({ poly: 4, create() { return { voice() { let v = 0, on = false; return { start(p, vel) { v = vel; on = true; }, release() { on = false; }, render(L, R, n) { if (!on) return false; for (let i = 0; i < n; i++) { L[i] += v; R[i] += v; } return true; } }; } }; } })`;
    const times = [0.1, 0.123456, 0.2500104, 0.7777];
    const out = [];
    for (const t of times) {
      const r = await render({ id: 'x.dc', kind: 'instrument', params: [], kernel: dc }, { secs: 1, notes: [{ p: 60, v: 0.5, t, d: 0.1 }] });
      const first = r.L.findIndex((x) => x !== 0);
      let last = -1; for (let i = r.L.length - 1; i >= 0; i--) if (r.L[i] !== 0) { last = i; break; }
      out.push({ t, want: Math.round(t * 48000), first, wantOff: Math.round((t + 0.1) * 48000), off: last + 1 });
    }
    return out;
  });
  for (const x of tm) T.ok(Math.abs(x.first - x.want) <= 1 && Math.abs(x.off - x.wantOff) <= 1, `note at ${x.t} s: on at frame ${x.first} (want ${x.want}), off at ${x.off} (want ${x.wantOff})`);

  // ------------------------------------------------------------------ polyphony and stealing
  console.log('voices');
  const vs = await page.evaluate(async () => {
    const { render } = window.H;
    // each voice outputs pitch / 1000 while held, and keeps sounding 0.3 s after release
    const k = `({ poly: 4, create({ sr }) { return { voice() { let v = 0, rel = -1; return {
      start(p) { v = p / 1000; rel = -1; }, release() { rel = Math.round(0.3 * sr); },
      render(L, R, n) { for (let i = 0; i < n; i++) { if (rel === 0) return false; if (rel > 0) rel--; L[i] += v; R[i] += v; } return true; } }; } }; } })`;
    const def = { id: 'x.poly', kind: 'instrument', params: [], kernel: k };
    // 6 held notes, poly 4: the two oldest are stolen
    const a = await render(def, { secs: 1, notes: [60, 61, 62, 63, 64, 65].map((p, i) => ({ p, t: 0.1 + i * 0.05 })) });
    // 4 held, release 62, then a 5th: the released one goes (not the oldest held)
    const b = await render(def, { secs: 1, notes: [{ p: 60, t: 0.1 }, { p: 61, t: 0.12 }, { p: 62, t: 0.14, d: 0.06 }, { p: 63, t: 0.16 }, { p: 70, t: 0.3 }] });
    return { a: a.L[Math.round(0.6 * 48000)], aStats: a.stats, b: b.L[Math.round(0.5 * 48000)], bStats: b.stats };
  });
  T.ok(Math.abs(vs.a - (0.062 + 0.063 + 0.064 + 0.065)) < 1e-6 && vs.aStats.steals === 2 && vs.aStats.maxVoices <= 6, `6 notes on poly 4: the 2 oldest are stolen (sum ${vs.a.toFixed(3)}, steals ${vs.aStats.steals}, max ${vs.aStats.maxVoices} incl. fading)`);
  T.ok(Math.abs(vs.b - (0.060 + 0.061 + 0.063 + 0.070)) < 1e-6 && vs.bStats.steals === 1, `a released voice is stolen before the oldest held one (sum ${vs.b.toFixed(3)})`);

  // ------------------------------------------------------------------ hot reload, params, bypass, transport
  console.log('live changes');
  const lv = await page.evaluate(async () => {
    const { render } = window.H;
    const sine = (hz, ph) => `({ create({ sr }) { let k = 0; return { process(L, R, n) { for (let i = 0; i < n; i++, k++) { const y = 0.5 * Math.sin(2 * Math.PI * ${hz} * k / sr + ${ph}); L[i] = y; R[i] = y; } } }; } })`;
    const d2 = (x, a, b) => { let m = 0; for (let i = Math.max(2, a); i < b; i++) m = Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2])); return m; };
    const r = await render({ id: 'x.sine', kind: 'effect', params: [], kernel: sine(440, 0) }, { secs: 1, at: [{ time: 0.5, run: (inst) => inst.reload(sine(660, 2)) }] });
    const sw = Math.round(0.5 * 48000);
    const steady = Math.max(d2(r.L, 1000, sw - 100), d2(r.L, sw + 2000, 47000));
    const swap = d2(r.L, sw - 200, sw + 1200);
    // after the fade the output is a pure 660 Hz sine: x[i] = 2 cos(w) x[i-1] - x[i-2] (phase-free test)
    const cw = 2 * Math.cos(2 * Math.PI * 660 / 48000);
    let res = 0; for (let i = sw + 2000; i < 47000; i++) res = Math.max(res, Math.abs(r.L[i] - cw * r.L[i - 1] + r.L[i - 2]));
    const swapped = res < 1e-4;
    // a bad reload keeps the old kernel running
    const bad = await render({ id: 'x.sine2', kind: 'effect', params: [], kernel: sine(440, 0) }, { secs: 0.5, at: [{ time: 0.2, run: (inst) => inst.reload('({ create( })').catch((e) => (window.__badReload = e.message)) }] });
    const keeps = Math.abs(bad.L[20000] - 0.5 * Math.sin(2 * Math.PI * 440 * 20000 / 48000)) < 1e-4;
    // params: a gain jump glides (~10 ms), a switch snaps
    const gk = `({ create() { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] = p.gain * (p.mode ? -1 : 1); R[i] = L[i]; } } }; } })`;
    const gdef = { id: 'x.gain', kind: 'effect', params: [{ key: 'gain', min: 0, max: 1, def: 0.2 }, { key: 'mode', opts: ['A', 'B'], def: 0 }], kernel: gk };
    const g = await render(gdef, { secs: 0.5, at: [{ time: 0.2, run: (inst) => inst.set({ gain: 0.8 }) }] });
    const at = Math.round(0.2 * 48000);
    const g1 = g.L[at + 128 * 2], g10 = g.L[at + 480], g40 = g.L[at + 1920];
    const s = await render(gdef, { secs: 0.5, at: [{ time: 0.2, run: (inst) => inst.set({ mode: 1 }) }] });
    const snap = s.L[at + 130];
    const clampR = await render(gdef, { secs: 0.1, params: { gain: 7 } });
    // bypass: setOn(false) crossfades to dry over ~10 ms
    const inp = [new Float32Array(48000).fill(0.5)];
    const inv = `({ create() { return { process(L, R, n) { for (let i = 0; i < n; i++) { L[i] = -L[i]; R[i] = -R[i]; } } }; } })`;
    const by = await render({ id: 'x.inv', kind: 'effect', params: [], kernel: inv }, { secs: 1, input: inp, at: [{ time: 0.5, run: (inst, c) => inst.setOn(false, c.currentTime) }] });
    const bAt = Math.round(0.5 * 48000);
    let maxStep = 0; for (let i = bAt; i < bAt + 2400; i++) maxStep = Math.max(maxStep, Math.abs(by.L[i] - by.L[i - 1]));
    // transport: offline the song plays from beat 0 at the given bpm
    const tk = `({ create() { return { process(L, R, n, p, t) { for (let i = 0; i < n; i++) { L[i] = t.beat; R[i] = t.bpm / 1000; } } }; } })`;
    const tr = await render({ id: 'x.tr', kind: 'effect', params: [], kernel: tk }, { secs: 1.1 });
    return { steady, swap, swapped, keeps, bad: window.__badReload, g1, g10, g40, snap, clamp: clampR.L[1000], maxStep, byEnd: by.L[47000], byStart: by.L[1000], beat1s: tr.L[48000], bpm: tr.R[48000] };
  });
  T.ok(lv.swapped && lv.swap < 1.5 * lv.steady, `hot reload swaps the code with a 20 ms crossfade: max 2nd difference ${lv.swap.toFixed(5)} at the swap vs ${lv.steady.toFixed(5)} steady (a click would stand far above steady)`);
  T.ok(lv.keeps && /SyntaxError/.test(lv.bad || ''), `a reload that fails to compile keeps the old kernel playing ("${lv.bad}")`);
  T.ok(lv.g1 > 0.2 && lv.g1 < 0.6 && lv.g10 > lv.g1 && Math.abs(lv.g40 - 0.8) < 0.01, `a param jump glides (0.2 -> 0.8: ${lv.g1.toFixed(3)} after 5 ms, ${lv.g10.toFixed(3)} at 10 ms, ${lv.g40.toFixed(3)} at 40 ms)`);
  T.ok(Math.abs(lv.snap + 0.2) < 1e-6, `a switch snaps (${lv.snap})`);
  T.ok(Math.abs(lv.clamp - 1) < 1e-6, 'out-of-range values are clamped to the param range');
  T.ok(Math.abs(lv.byStart + 0.5) < 1e-4 && Math.abs(lv.byEnd - 0.5) < 1e-4 && lv.maxStep < 0.05, `bypass crossfades wet -> dry (largest step ${lv.maxStep.toFixed(4)} for a 1.0 swing)`);
  T.ok(Math.abs(lv.beat1s - 2) < 0.01 && Math.abs(lv.bpm - 0.12) < 1e-6, `transport: t.beat advances (beat ${lv.beat1s.toFixed(3)} at 1 s, 120 bpm)`);

  // ------------------------------------------------------------------ determinism
  console.log('determinism');
  const dt = await page.evaluate(async () => {
    const { render } = window.H;
    const nk = `({ create({ seed, dsp }) { const n = dsp.noise(seed, 'pink'), f = dsp.fdn(0.5, 1.5, 0.3, seed); return { process(L, R, len) { for (let i = 0; i < len; i++) { const x = n.next() * 0.2; f.tick(x, x); L[i] = x + f.l; R[i] = x + f.r; } } }; } })`;
    const def = { id: 'x.noise', kind: 'effect', params: [], kernel: nk };
    const a = await render(def, { secs: 0.5, seed: 5 }), b = await render(def, { secs: 0.5, seed: 5 }), c = await render(def, { secs: 0.5, seed: 6 });
    const eq = (x, y) => x.L.every((v, i) => v === y.L[i]) && x.R.every((v, i) => v === y.R[i]);
    return { same: eq(a, b), differs: !eq(a, c) };
  });
  T.ok(dt.same && dt.differs, 'renders repeat bit for bit with the same seed and differ with another');

  // ------------------------------------------------------------------ the reference kernels and the guide
  console.log('reference kernels');
  const rk = await page.evaluate(async (quick) => {
    const { check, examples, guide, registry, dsp } = window.K;
    const out = {};
    for (const d of [...examples.EXAMPLES, guide.GUIDE_EFFECT, guide.GUIDE_INSTRUMENT]) {
      const r = await check.checkDevice(d, { quick: quick && d.by === 'claude' });
      out[d.id] = { ok: r.ok, sum: check.summarize(r), warnings: r.warnings, report: r };
    }
    out.registered = ['core.testsynth', 'core.testfilter'].map((id) => registry.getDevice(id)).every((x) => x && x.flavour === 'kernel');
    // through the registry, like the engine does
    const c = new OfflineAudioContext(2, 48000, 48000);
    const inst = await registry.instantiate(c, 'core.testsynth', { uid: 't_abc123', params: { cutoff: 900 } });
    await inst.ready; inst.output.connect(c.destination); inst.noteOn(57, 0.9, 0.05); inst.noteOff(57, 0.6);
    const b = await c.startRendering(); let pk = 0; for (const v of b.getChannelData(0)) pk = Math.max(pk, Math.abs(v));
    out.viaRegistry = pk; inst.dispose();
    // the guide names every dsp function, and only real ones
    const text = guide.KERNEL_GUIDE;
    const api = dsp.DSP_API;
    out.missing = api.filter((k) => !new RegExp('\\b' + k + '\\b').test(text));
    const used = [...text.matchAll(/dsp\.(\w+)/g)].map((m) => m[1]);
    out.unknown = [...new Set(used.filter((k) => !api.includes(k)))];
    out.words = text.split(/\s+/).length;
    out.examplesInGuide = text.includes(guide.GUIDE_EFFECT.kernel) && text.includes(guide.GUIDE_INSTRUMENT.kernel);
    const md = await (await fetch('../docs/DEVICES.md')).text();
    out.examplesInDocs = md.includes(guide.GUIDE_EFFECT.kernel) && md.includes(guide.GUIDE_INSTRUMENT.kernel) && md.includes(text.split('## The kernel')[1].split('## Rules')[0].split('\n')[1]);
    const q0 = performance.now(); const qr = await check.checkDevice(examples.TESTFILTER, { quick: true }); out.quickMs = performance.now() - q0; out.quickOk = qr.ok;
    return out;
  }, !!process.env.QUICK);
  for (const id of ['core.testsynth', 'core.testfilter', 'claude.tape-echo', 'claude.glass-harp']) {
    T.ok(rk[id].ok && !rk[id].warnings.length, `${id} passes checkDevice: ${rk[id].sum}`);
  }
  T.ok(rk.registered && rk.viaRegistry > 0.05, `the examples are registered and play through registry.instantiate (peak ${rk.viaRegistry.toFixed(3)})`);
  T.ok(!rk.missing.length && !rk.unknown.length, `the guide documents every dsp name and no others${rk.missing.length ? ' (missing ' + rk.missing + ')' : ''}${rk.unknown.length ? ' (unknown ' + rk.unknown + ')' : ''}`);
  T.ok(rk.examplesInGuide, `the guide embeds both verified examples verbatim (${rk.words} words)`);
  T.ok(rk.examplesInDocs, 'docs/DEVICES.md carries the same guide and examples');
  T.ok(rk.quickOk && rk.quickMs < 1500, `a quick check takes ${Math.round(rk.quickMs)} ms`);

  // ------------------------------------------------------------------ the check catches bad devices
  console.log('the check');
  const ck = await page.evaluate(async () => {
    const { check } = window.K;
    const stuck = await check.checkDevice({ id: 'x.stuck', kind: 'instrument', params: [], kernel: `({ create({ dsp }) { return { voice() { const o = dsp.osc('sine'); let on = false; return { start(p) { o.freq(dsp.mtof(p)); on = true; }, release() {}, render(L, R, n) { for (let i = 0; i < n; i++) { const y = 0.05 * o.next(); L[i] += y; R[i] += y; } return true; } }; } }; } })` }, { quick: true });
    const loud = await check.checkDevice({ id: 'x.loud', kind: 'effect', params: [{ key: 'gain', min: 0, max: 40, def: 0, unit: 'dB' }], kernel: `({ create({ dsp }) { return { process(L, R, n, p) { const g = dsp.dB(p.gain); for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } } }; } })` }, { quick: true });
    const nanAtMax = await check.checkDevice({ id: 'x.nanmax', kind: 'effect', params: [{ key: 'q', min: 0, max: 1, def: 0.5 }], kernel: `({ create() { return { process(L, R, n, p) { const k = 1 / (1 - p.q); for (let i = 0; i < n; i++) { L[i] *= k * 0 + (p.q === 1 ? NaN : 1); R[i] = L[i]; } } }; } })` }, { quick: true });
    const ring = await check.checkDevice({ id: 'x.ring', kind: 'effect', params: [], kernel: `({ create({ dsp }) { const d = dsp.delay(4800); return { process(L, R, n) { for (let i = 0; i < n; i++) { const y = d.read(4800); d.write(L[i] + y); L[i] += 0.3 * y; R[i] = L[i]; } } }; } })` }, { quick: true });
    const mute = await check.checkDevice({ id: 'x.mute', kind: 'instrument', params: [], kernel: `({ create() { return { voice() { let t = 0; return { start() { t = 0; }, release() { t = -1; }, render(L, R, n) { return t >= 0; } }; } }; } })` }, { quick: true });
    const lp = await check.checkDevice({ id: 'x.wall', kind: 'effect', params: [], kernel: `({ create({ sr }) { let a = 0, b = 0; const k = Math.exp(-2 * Math.PI * 250 / sr); return { process(L, R, n) { for (let i = 0; i < n; i++) { a = L[i] + (a - L[i]) * k; b = R[i] + (b - R[i]) * k; L[i] = a * 2.5; R[i] = b * 2.5; } } }; } })` }, { quick: true });
    return { stuck: [stuck.ok, stuck.stuck, stuck.errors[0]], loud: [loud.ok, loud.errors[0], loud.extremes.worstPeak], nan: [nanAtMax.ok, nanAtMax.nan, nanAtMax.errors[0]], ring: [ring.ok, ring.tail, ring.warnings.find((w) => /^tail/.test(w))],
      mute: [mute.ok, mute.level?.lufs, mute.errors.find((e) => /^level/.test(e))], lp: [lp.ok, lp.level, lp.warnings.filter((w) => /level/.test(w)).concat(lp.level?.note ? [lp.level.note] : [])] };
  });
  T.ok(!ck.mute[0] && /no sound/.test(ck.mute[2] || ''), `an instrument that makes no sound fails the check (${ck.mute[1]} LUFS): "${ck.mute[2]}"`);
  T.ok(ck.lp[0] && ck.lp[2].length === 1 && /DI strum/.test(ck.lp[2][0]) && /drum loop/.test(ck.lp[2][0]), `a low-pass's level advice names both test signals (strum ${ck.lp[1]?.deltaLU}, drums ${ck.lp[1]?.drumsDeltaLU}): "${ck.lp[2][0]}"`);
  T.ok(!ck.stuck[0] && ck.stuck[1], `a voice that never ends is a stuck note: "${ck.stuck[2]}"`);
  T.ok(!ck.loud[0] && /extremes \(.*max.*\): raw peak/.test(ck.loud[1] || ''), `a +40 dB setting fails the extremes: "${ck.loud[1]}"`);
  T.ok(!ck.nan[0] && ck.nan[1] && /NaN/.test(ck.nan[2] || ''), `NaN at a param's max is caught: "${ck.nan[2]}"`);
  T.ok(ck.ring[0] && ck.ring[1] && ck.ring[1].decays === false && /tail/.test(ck.ring[2] || ''), `a delay with feedback 1 warns that its tail never decays: "${ck.ring[2]}"`);

  // ------------------------------------------------------------------ a check that can't finish ends anyway
  // A kernel whose process() never returns held checkDevice forever, and define_device and the agent's turn with it.
  // These kernels only busy-wait a few seconds per render (Chrome renders every offline context on one thread, and a
  // real endless loop would hold it for the rest of this run), so each check's timeout is cut to fit.
  console.log('a check that never finishes');
  const hang = await page.evaluate(async () => {
    const { check, examples } = window.K, { render } = window.H;
    // `ms` of busy-wait in each of a render's first `blocks` blocks (Date from the realm: kernels get no clock)
    const busy = (ms, blocks) => `({ create() { const now = [].constructor.constructor('return Date.now')(); let b = 0; return { process() { if (b++ < ${blocks}) { const t = now(); while (now() - t < ${ms}) {} } } }; } })`;
    const settle = () => render({ id: 'x.after', kind: 'effect', params: [], kernel: '({ create() { return { process() {} }; } })' }, { secs: 0.01 }); // waits out a slow render
    let t0 = performance.now();
    const rep = await check.checkDevice({ id: 'x.slow', kind: 'effect', params: [], kernel: busy(4, 750) }, { quick: true, timeout: 1000 }); // 3 s a render
    const ms = performance.now() - t0;
    // that render still holds the thread (and loading a worklet behind it would block this page): a healthy device
    // checked now is told so at once, not refused for its own code
    const counted = check.heldRenders?.();
    // and a song render behind it (an export, a reference compare, arrange_around) says so at once, not waiting there
    let song = null;
    const songT0 = performance.now();
    try { const { renderProject } = await import('/app/src/engine/render.js'); await renderProject({ tempo: 120, meter: [4, 4], tracks: [], master: { gain: 0, inserts: [] } }, { from: 0, to: 1, tail: 0 }); song = 'rendered'; } catch (e) { song = e.message; }
    const songMs = performance.now() - songT0;
    t0 = performance.now();
    const held = await check.checkDevice(examples.TESTFILTER, { quick: true, timeout: 500 });
    const heldMs = performance.now() - t0;
    await settle();
    const freed = check.heldRenders?.();
    // the caller's signal ends a check at once, with an AbortError
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    t0 = performance.now();
    let stopped = null;
    try { await check.checkDevice({ id: 'x.slow2', kind: 'effect', params: [], kernel: busy(4, 500) }, { quick: true, signal: ac.signal }); } catch (e) { stopped = e.name; }
    const stopMs = performance.now() - t0;
    await settle();
    const after = await check.checkDevice(examples.TESTFILTER, { quick: true });
    return { ok: rep.ok, timedOut: rep.timedOut, err: rep.errors[0], ms, counted, freed, held: { ok: held.ok, timedOut: held.timedOut, err: held.errors[0] }, heldMs, song, songMs, stopped, stopMs, after: after.ok };
  });
  T.ok(!hang.ok && hang.timedOut === 'process' && /process\(\) may never return/.test(hang.err || '') && hang.ms < 2500, `a render that doesn't finish refuses the device at the deadline (${Math.round(hang.ms)} ms for a 1 s timeout): "${hang.err}"`);
  T.ok(!hang.held.ok && hang.held.timedOut === 'busy' && /still held by an earlier render/.test(hang.held.err || '') && /[Rr]eload/.test(hang.held.err || '') && hang.heldMs < 300 && hang.counted === 1 && hang.freed === 0,
    `while that render runs, a check of a healthy device doesn't start one behind it (which would block the page): it says the thread is held, in ${Math.round(hang.heldMs)} ms (renders held: ${hang.counted}, then ${hang.freed} once it ended): "${hang.held.err}"`);
  T.ok(/still held by a device check/.test(hang.song || '') && hang.songMs < 300, `and a song render started behind it (an export, a reference compare, arrange_around) says the thread is held, in ${Math.round(hang.songMs)} ms: "${hang.song}"`);
  T.ok(hang.stopped === 'AbortError' && hang.stopMs < 1500, `an aborted signal stops a check at once (${hang.stopped || 'no error'} after ${Math.round(hang.stopMs)} ms, aborted at 300)`);
  T.ok(hang.after, 'once the slow renders end, the same healthy device passes its check again');

  // ------------------------------------------------------------------ CPU: a 16-voice instrument and 8 effects
  console.log('cpu');
  const cpu = await page.evaluate(async () => {
    const { host, examples, guide } = window.K;
    const secs = 8, c = new OfflineAudioContext(2, secs * 48000, 48000);
    const synth = { ...examples.TESTSYNTH, kernel: examples.TESTSYNTH.kernel.replace('poly: 8', 'poly: 16') };
    const inst = await host.kernelInstance(c, synth, { seed: 1 });
    const fx = [];
    const chain = [examples.TESTFILTER, guide.GUIDE_EFFECT, examples.TESTFILTER, guide.GUIDE_EFFECT, examples.TESTFILTER, guide.GUIDE_EFFECT, examples.TESTFILTER, guide.GUIDE_EFFECT];
    for (const [i, d] of chain.entries()) fx.push(await host.kernelInstance(c, d, { seed: i, params: d.id === 'core.testfilter' ? { drive: 12, mix: 80 } : {} }));
    await Promise.all([inst.ready, ...fx.map((f) => f.ready)]);
    let prev = inst.output; for (const f of fx) { prev.connect(f.input); prev = f.output; }
    const g = c.createGain(); g.gain.value = 0.25; prev.connect(g); g.connect(c.destination);
    for (let t = 0; t < secs - 1; t += 1) for (let k = 0; k < 16; k++) { inst.noteOn(36 + k * 3, 0.7, t + k * 0.01); inst.noteOff(36 + k * 3, t + 0.9); }
    const t0 = performance.now(); await c.startRendering(); const ms = performance.now() - t0;
    const st = await inst.stats();
    for (const f of [inst, ...fx]) f.dispose();
    return { ms, pct: (ms / (secs * 1000)) * 100, maxVoices: st.maxVoices };
  });
  T.ok(cpu.pct < 50 && cpu.maxVoices >= 16, `16-voice synth + 8 kernel effects (4 oversampled filters, 4 echoes): ${cpu.pct.toFixed(1)}% of real time (${Math.round(cpu.ms)} ms for 8 s, ${cpu.maxVoices} voices)`);

  // ------------------------------------------------------------------ a live AudioContext
  console.log('realtime');
  const rt = await page.evaluate(async () => {
    const { host, examples } = window.K;
    const c = new AudioContext({ sampleRate: 48000 });
    await c.resume();
    const clock = { playing: () => true, bpm: () => 100, beatsPerBar: () => 4, beatAt: (t) => t * 100 / 60 };
    const synth = await host.kernelInstance(c, examples.TESTSYNTH, { uid: 't_live01', clock });
    const filt = await host.kernelInstance(c, examples.TESTFILTER, { uid: 'fx_live01', clock, params: { cutoff: 1200 } });
    await Promise.all([synth.ready, filt.ready]);
    const an = c.createAnalyser(); an.fftSize = 2048;
    synth.output.connect(filt.input); filt.output.connect(an); an.connect(c.destination);
    const level = () => { const a = new Float32Array(2048); an.getFloatTimeDomainData(a); return Math.max(...a.map(Math.abs)); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const t = c.currentTime + 0.05;
    for (const p of [57, 60, 64]) { synth.noteOn(p, 0.8, t); synth.noteOff(p, t + 1.4); }
    await wait(250); const playing = level();
    filt.setOn(false); await wait(400); const bypassed = level(); // (long enough for the bypassed kernel to sleep)
    filt.setOn(true); await filt.reload(examples.TESTFILTER.kernel.replace('const trim = mode === 1 ? 1.6 : 1;', 'const trim = 1;'));
    await wait(80); const reloaded = level();
    await wait(1500); const after = level();
    const st = await synth.stats();
    synth.dispose(); filt.dispose(); await c.close();
    return { playing, bypassed, reloaded, after, errors: [...synth.errors, ...filt.errors], version: filt.version, st };
  });
  T.ok(rt.playing > 0.02 && rt.bypassed > 0.02 && rt.reloaded > 0.02 && rt.after < 1e-3 && !rt.errors.length && rt.version === 2,
    `live: plays (${rt.playing.toFixed(3)}), bypasses (${rt.bypassed.toFixed(3)}), hot-reloads while playing (v${rt.version}, ${rt.reloaded.toFixed(3)}), falls silent (${rt.after.toExponential(1)})`);

  T.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  T.ok(false, 'test crashed: ' + (e && e.stack || e));
} finally {
  await close();
  T.done();
}
