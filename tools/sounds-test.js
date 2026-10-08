// The ears and the built-in sounds: checks for app/src/audio/measure.js, app/src/audio/testsignals.js and every device
// in app/src/devices/builtin/.
//
//   node tools/sounds-test.js            measure.js numbers in Node, then every built-in through checkDevice in Chromium
//   QUICK=1 node tools/sounds-test.js    the device checks' quick mode (fewer extreme-param renders)
//   NODE_ONLY=1 node tools/sounds-test.js    just the Node part (no browser)
//   ONLY=core.verb,core.poly node tools/sounds-test.js   just those devices
//
// Writes tools/.out/sounds/<id>.wav: each instrument playing its test phrase, each effect on the test program
// (drums + guitar + bass), rendered in the browser through the same worklet the studio runs, so AJ can listen to what
// was measured. Prints a table: id | LUFS (instruments) or ΔLU vs bypass (effects) | true peak | cpu% | tail | deterministic.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, OUTDIR } from './pw.js';
import { measure, lufs, truePeak, spectrogram, onsets, keyOf, chroma } from '../app/src/audio/measure.js';
import * as T from '../app/src/audio/testsignals.js';
import { SAMPLED } from '../app/src/devices/builtin/index.js';
import { dataPath } from '../app/src/engine/node/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOUNDS = path.join(OUTDIR, 'sounds');
fs.mkdirSync(SOUNDS, { recursive: true });
const t = tally('sounds');
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const SR = 48000;

// ------------------------------------------------------------------------------------------------ the ears, in Node
console.log('measure.js');
{
  const sine = (f, db, secs = 5, sr = SR, ph = 0, fade = 0.02) => {
    const n = Math.round(secs * sr),
      x = new Float32Array(n),
      a = Math.pow(10, db / 20),
      fd = Math.round(fade * sr);
    for (let i = 0; i < n; i++)
      x[i] = a * Math.sin((2 * Math.PI * f * i) / sr + ph) * (fd ? Math.min(1, i / fd, (n - 1 - i) / fd) : 1);
    return x;
  };
  for (const sr of [44100, 48000, 96000]) {
    const s = sine(1000, -20, 5, sr, 0, 0);
    const one = lufs({ sr, channels: [s, new Float32Array(s.length)] }),
      two = lufs({ sr, channels: [s, s] });
    t.ok(
      near(one, -23, 0.1),
      `1 kHz at -20 dBFS in one channel at ${sr / 1000} kHz reads ${one.toFixed(2)} LUFS (want -23.0 ±0.1)`,
    );
    t.ok(
      near(two, -20, 0.1),
      `the same in both channels at ${sr / 1000} kHz reads ${two.toFixed(2)} LUFS (want -20.0 ±0.1)`,
    );
  }
  // an inter-sample peak: fs/4 at 45°, samples at ±0.707 of a full-scale wave
  const q = sine(SR / 4, 0, 2, SR, Math.PI / 4);
  const m = measure({ sr: SR, channels: [q] });
  t.ok(
    near(m.peak, -3.01, 0.05) && near(m.truePeak, 0, 0.2),
    `fs/4 sine at 45°: sample peak ${m.peak} dBFS, true peak ${m.truePeak} dBTP (want -3.01 and 0)`,
  );
  let worst = 0;
  for (const f of [100, 1000, 5000, 10000, 15000, 19000])
    for (const ph of [0, 0.3, 0.9])
      worst = Math.max(worst, Math.abs(truePeak({ sr: SR, channels: [sine(f, -6, 1, SR, ph)] }) + 6));
  t.ok(worst < 0.1, `true peak of -6 dBFS sines 100 Hz..19 kHz, any phase, within ${worst.toFixed(3)} dB (want < 0.1)`);
  // keys: scales of harmonic tones
  const scale = (pitches) => {
    const x = new Float32Array(SR * pitches.length);
    pitches.forEach((p, k) => {
      const f = 440 * 2 ** ((p - 69) / 12);
      for (let i = 0; i < SR; i++) {
        const s = i / SR,
          e = Math.min(1, s * 50) * Math.exp(-s * 2);
        let v = 0;
        for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * s) / h;
        x[k * SR + i] = 0.2 * v * e;
      }
    });
    return x;
  };
  const kc = measure({ sr: SR, channels: [scale([60, 62, 64, 65, 67, 69, 71, 72])] }).key;
  t.ok(
    kc && kc.root === 'C' && kc.scale === 'major',
    `a C major scale estimates ${kc && kc.root + ' ' + kc.scale} (confidence ${kc && kc.confidence})`,
  );
  const ka = measure({ sr: SR, channels: [scale([57, 59, 60, 62, 64, 65, 67, 69, 64, 60, 57])] }).key;
  t.ok(
    ka && ka.root === 'A' && ka.scale === 'minor',
    `an A minor scale estimates ${ka && ka.root + ' ' + ka.scale} (confidence ${ka && ka.confidence})`,
  );
  // silence, clipping, width, bands
  const sil = measure({ sr: SR, channels: [new Float32Array(SR * 2), new Float32Array(SR * 2)] });
  t.ok(
    sil.lufs === -120 && sil.silencePct === 100 && sil.key === null,
    `silence: ${sil.lufs} LUFS, ${sil.silencePct}% silent, no key`,
  );
  const sq = new Float32Array(SR);
  for (let i = 0; i < SR; i++) sq[i] = i % 100 < 50 ? 1 : -1;
  t.ok(measure({ sr: SR, channels: [sq] }).clipped === SR, 'a full-scale square: every sample counted as clipped');
  const s1 = sine(440, -12, 2);
  const inv = Float32Array.from(s1, (v) => -v);
  t.ok(
    measure({ sr: SR, channels: [s1, inv] }).width === -1 && measure({ sr: SR, channels: [s1, s1] }).width === 1,
    'width: L = -R reads -1, L = R reads 1',
  );
  const b1k = measure({ sr: SR, channels: [sine(1000, -12, 2)] });
  t.ok(
    b1k.bands.mid > -0.1 && b1k.bands.low < -40 && near(b1k.centroid, 1000, 30),
    `1 kHz sine: all its energy in "mid" (${b1k.bands.mid} dB), centroid ${b1k.centroid} Hz`,
  );
  // LRA: 10 s at -20 then 10 s at -30 reads about 10 LU
  const lr = new Float32Array(SR * 20);
  const a20 = sine(1000, -20, 10, SR, 0, 0),
    a30 = sine(1000, -30, 10, SR, 0, 0);
  lr.set(a20);
  lr.set(a30, SR * 10);
  const ml = measure({ sr: SR, channels: [lr, lr] });
  t.ok(
    near(ml.lra, 10, 0.6) && near(ml.lufsShortMax, -20, 0.1),
    `LRA of 10 s at -20 then 10 s at -30: ${ml.lra} LU (want ~10), short-term max ${ml.lufsShortMax}`,
  );
  // onsets
  const os = onsets({ sr: SR, channels: [sine(440, -12, 3)] }).length;
  t.ok(os <= 1, `a steady sine has ${os} onset (its start)`);
  const loop = T.drumLoop(4, SR, 120),
    md = measure(loop);
  t.ok(md.onsetsPerSec > 4 && md.onsetsPerSec < 9, `the drum loop (16th hats at 120): ${md.onsetsPerSec} onsets/s`);
  // the spectrogram (pure-JS PNG in Node)
  const png = await spectrogram(T.program(4), { width: 320, height: 120 });
  t.ok(
    /^data:image\/png;base64,/.test(png) && png.length > 2000,
    `spectrogram: a PNG data URL (${(png.length / 1024).toFixed(0)} KB)`,
  );
  fs.writeFileSync(path.join(SOUNDS, 'program-spectrogram.png'), Buffer.from(png.split(',')[1], 'base64'));
  // speed: three minutes of stereo
  const big = new Float32Array(SR * 180);
  for (let i = 0; i < big.length; i++) big[i] = 0.3 * Math.sin(i * 0.05) * Math.sin(i * 0.0001);
  const t0 = performance.now();
  measure({ sr: SR, channels: [big, big] });
  const ms = performance.now() - t0;
  t.ok(ms < 4000, `measure() of a 3-minute stereo song takes ${ms.toFixed(0)} ms`);
}

console.log('testsignals.js');
{
  const pk = (x) => {
    let m = 0;
    for (const v of x) m = Math.max(m, Math.abs(v));
    return 20 * Math.log10(m);
  };
  t.ok(near(pk(T.diStrum()), -10, 0.05), `DI strum peaks at ${pk(T.diStrum()).toFixed(2)} dBFS (want -10)`);
  t.ok(near(pk(T.bassDI()), -10, 0.05), `bass DI peaks at ${pk(T.bassDI()).toFixed(2)} dBFS (want -10)`);
  const dl = T.drumLoop();
  t.ok(near(Math.max(pk(dl.channels[0]), pk(dl.channels[1])), -6, 0.05), 'drum loop peaks at -6 dBFS');
  const pn = measure({ sr: SR, channels: [T.pinkNoise()] });
  t.ok(near(pn.rms, -18, 0.1), `pink noise RMS ${pn.rms} dBFS (want -18)`);
  const pr = measure(T.program());
  t.ok(near(pr.lufs, -18, 1), `the effect program reads ${pr.lufs} LUFS (want about -18), true peak ${pr.truePeak}`);
  const sw = T.sweep();
  t.ok(near(pk(sw), -12, 0.05), 'sweep at -12 dBFS');
  t.ok(T.impulse(1, SR, { at: 0.5 })[SR / 2] === 1, 'impulse in place');
  const ph = T.phrase(),
    dp = T.drumPhrase();
  t.ok(
    ph.length > 40 && ph.every((n) => n.t >= 0 && n.t + n.d <= T.PHRASE_BEATS && n.v > 0 && n.v <= 1),
    `test phrase: ${ph.length} notes in ${T.PHRASE_BEATS} beats`,
  );
  const pieces = new Set(dp.map((n) => n.p));
  t.ok(
    [36, 37, 38, 39, 42, 44, 46, 45, 47, 50, 49, 51, 56, 70].every((p) => pieces.has(p)),
    `drum phrase plays every GM piece Overdub maps (${pieces.size} pieces)`,
  );
  const a = T.drumLoop(2),
    b = T.drumLoop(2);
  t.ok(
    a.channels[0].every((v, i) => v === b.channels[0][i]),
    'test signals are deterministic',
  );
}

if (process.env.NODE_ONLY) {
  t.done();
  process.exit();
}

// ------------------------------------------------------------------------------------------------ the devices, in Chromium
const { open } = await import('./pw.js');
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
console.log('built-in devices (checkDevice in Chromium' + (process.env.QUICK ? ', quick' : '') + ')');
let { page, errors, close } = await open('/app/');
// a sampled kit's samples stay in the page once decoded (Rusty Sticks alone is 24 MB), so after each sampled device the
// page is opened afresh: fourteen kits in one tab run it out of memory
const allErrors = [];
async function fresh() {
  allErrors.push(...errors);
  await close();
  ({ page, errors, close } = await open('/app/'));
}
const wav = (file, chans, sr) => {
  const n = chans[0].length,
    w = Buffer.alloc(44 + n * 4);
  w.write('RIFF', 0);
  w.writeUInt32LE(36 + n * 4, 4);
  w.write('WAVEfmt ', 8);
  w.writeUInt32LE(16, 16);
  w.writeUInt16LE(1, 20);
  w.writeUInt16LE(2, 22);
  w.writeUInt32LE(sr, 24);
  w.writeUInt32LE(sr * 4, 28);
  w.writeUInt16LE(4, 32);
  w.writeUInt16LE(16, 34);
  w.write('data', 36);
  w.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 2; c++)
      w.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[c][i])) * 32767), 44 + i * 4 + c * 2);
  fs.writeFileSync(file, w);
};
const unpack = (b64) => {
  const b = Buffer.from(b64, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
try {
  const ids = await page.evaluate(async () => {
    const B = await import('/app/src/devices/builtin/index.js');
    return B.BUILTINS.map((d) => d.id);
  });
  t.ok(ids.length === 52, `builtin/index.js registers ${ids.length} devices`);
  // a sampled device whose samples haven't been fetched plays nothing: skipped here (tools/drumkit-test.js says so)
  const unfetched = SAMPLED.filter((d) => Object.values(d.data || {}).some((h) => !fs.existsSync(dataPath(h)))).map(
    (d) => d.id,
  );
  for (const id of unfetched) t.note(`${id}: skipped, its samples haven't been fetched (node tools/fetch-kits.js)`);
  // the ears in the page: measure() on a real AudioBuffer, spectrogram() through a canvas
  const ears = await page.evaluate(async () => {
    const M = await import('/app/src/audio/measure.js');
    const c = new OfflineAudioContext(2, 48000 * 3, 48000),
      o = c.createOscillator(),
      g = c.createGain();
    o.frequency.value = 1000;
    g.gain.value = 0.1;
    o.connect(g);
    g.connect(c.destination);
    o.start(0);
    const buf = await c.startRendering();
    const m = M.measure(buf),
      png = await M.spectrogram(buf, { width: 200, height: 80 });
    return { lufs: m.lufs, tp: m.truePeak, png: png.slice(0, 22), len: png.length };
  });
  t.ok(
    near(ears.lufs, -20, 0.1) && near(ears.tp, -20, 0.1),
    `in the page: an OfflineAudioContext 1 kHz sine at -20 dBFS reads ${ears.lufs} LUFS, ${ears.tp} dBTP`,
  );
  t.ok(
    ears.png === 'data:image/png;base64,' && ears.len > 500,
    `in the page: spectrogram() returns a PNG (${ears.len} chars)`,
  );
  const rows = [];
  for (const id of ids) {
    if (only && !only.includes(id)) continue;
    if (unfetched.includes(id)) continue;
    const res = await page.evaluate(
      async ({ id, quick }) => {
        const { getDevice } = await import('/app/src/devices/registry.js');
        const { checkDevice } = await import('/app/src/kernel/check.js');
        const { kernelInstance, ensureKernelWorklet } = await import('/app/src/kernel/host.js');
        const T = await import('/app/src/audio/testsignals.js');
        const def = getDevice(id);
        const report = await checkDevice(def, { quick });
        // a render to listen to: the instrument's phrase (drums: the kit phrase; bass: the bass phrase), or the effect
        // on the test program, at default params
        const SR = 48000,
          bpm = T.PHRASE_BPM,
          beat = 60 / bpm;
        let secs,
          notes = null,
          input = null;
        if (def.kind === 'instrument') {
          const ph = def.cat === 'drums' ? T.drumPhrase() : def.id === 'core.bass' ? T.bassPhrase() : T.phrase();
          notes = ph.map((n) => ({ p: n.p, v: n.v, t: 0.05 + n.t * beat, d: n.d * beat }));
          secs = notes.reduce((m, n) => Math.max(m, n.t + n.d), 0) + Math.min(4, (def.tail || 1) + 1);
        } else {
          input = T.program(8, SR).channels;
          secs = 8 + Math.min(4, (def.tail || 0) + 0.5);
        }
        const c = new OfflineAudioContext(2, Math.round(secs * SR), SR);
        await ensureKernelWorklet(c);
        const params = Object.fromEntries(def.params.map((p) => [p.key, p.def]));
        const inst = await kernelInstance(c, def, { seed: 1, params, bpm });
        await inst.ready;
        inst.set(params, { first: true });
        if (input) {
          const b = c.createBuffer(2, input[0].length, SR);
          b.copyToChannel(input[0], 0);
          b.copyToChannel(input[1], 1);
          const src = c.createBufferSource();
          src.buffer = b;
          src.connect(inst.input);
          src.start(0);
        }
        if (notes)
          for (const n of notes) {
            inst.noteOn(n.p, n.v, n.t);
            inst.noteOff(n.p, n.t + n.d);
          }
        inst.output.connect(c.destination);
        const buf = await c.startRendering();
        inst.dispose();
        const enc = (a) => {
          const u = new Uint8Array(a.buffer.slice(0));
          let s = '';
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
          return btoa(s);
        };
        return {
          report,
          kind: def.kind,
          L: enc(buf.getChannelData(0)),
          R: enc(buf.getChannelData(1)),
          sr: SR,
          programSecs: input ? 8 : 0,
        };
      },
      { id, quick: !!process.env.QUICK },
    );
    const r = res.report,
      L = unpack(res.L),
      R = unpack(res.R);
    wav(path.join(SOUNDS, id + '.wav'), [L, R], res.sr);
    // our own measure of the listening render (the effect against the dry program)
    const mine = measure({ sr: res.sr, channels: [L, R] }, res.programSecs ? { to: res.programSecs } : {});
    let level, levelOk;
    if (res.kind === 'instrument') {
      level = `${r.level && r.level.lufs} LUFS (own phrase ${mine.lufs})`;
      levelOk = r.level && r.level.lufs >= -18.5 && r.level.lufs <= -13.5 && mine.lufs >= -18.5 && mine.lufs <= -13.5;
    } else {
      const dry = measure(T.program(8, res.sr)).lufs,
        d = Math.round((mine.lufs - dry) * 100) / 100;
      level = `ΔLU strum ${r.level && r.level.deltaLU} / drums ${r.level && r.level.drumsDeltaLU} / program ${d}`;
      const lo = id === 'core.drive' ? 0 : -1.5,
        hi = id === 'core.drive' ? 3 : 1.5;
      // an amp's output barely follows its input (as Hot Print's), so drums and the program read far under: Half Stack
      // and Y Cable are held here on the DI strum only, and to their own DIs' level by stack-test and bassrig-test
      const amp = id === 'core.stack' || id === 'core.bassrig';
      levelOk =
        r.level &&
        (amp
          ? [r.level.deltaLU].every((x) => x >= -3 && x <= 1.8)
          : [r.level.deltaLU, r.level.drumsDeltaLU, d].every((x) => x >= lo - 0.3 && x <= hi + 0.3));
    }
    const tp = Math.max(r.truePeak ?? -120, mine.truePeak);
    rows.push([
      id,
      level,
      `${tp} dBTP`,
      `${r.cpu && r.cpu.pct}%`,
      r.tail ? `${r.tail.seconds}s${r.tail.decays === false ? ' (rings)' : ''}` : '-',
      r.deterministic ? 'yes' : 'NO',
      r.latency ? `${r.latency.samples ?? '-'}/${r.latency.declared}` : '-',
    ]);
    t.ok(r.ok, `${id}: checkDevice ok${r.ok ? '' : ': ' + r.errors.join('; ')}`);
    for (const w of r.warnings) t.note(`${id}: ${w}`);
    t.ok(levelOk, `${id}: level ${level}`);
    t.ok(tp <= -1, `${id}: true peak ${tp} dBTP at defaults (want <= -1)`);
    t.ok(r.deterministic === true, `${id}: deterministic`);
    t.ok(
      !r.nan && !(r.extremes && r.extremes.failed && r.extremes.failed.length),
      `${id}: no NaN, every extreme setting renders${r.extremes && r.extremes.failed && r.extremes.failed.length ? ': ' + JSON.stringify(r.extremes.failed.slice(0, 3)) : ''} (worst peak ${r.extremes && r.extremes.worstPeak} dBFS)`,
    );
    if (id === 'core.limiter')
      t.ok(
        r.latency && Math.abs(r.latency.samples - r.latency.declared) <= 2,
        `core.limiter: reports its latency (${r.latency && r.latency.declared} samples; an impulse comes out at ${r.latency && r.latency.samples})`,
      );
    if (SAMPLED.some((d) => d.id === id)) await fresh();
  }
  const head = ['id', 'level', 'true peak', 'cpu', 'tail', 'deterministic', 'latency (seen/declared)'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => '  ' + r.map((c, i) => String(c).padEnd(w[i])).join(' | ');
  console.log(
    '\n' + line(head) + '\n  ' + w.map((n) => '-'.repeat(n)).join('-+-') + '\n' + rows.map(line).join('\n') + '\n',
  );
  t.note(`WAV renders in ${path.relative(process.cwd(), SOUNDS)}/`);
  // page errors: ours fail the run, anyone else's are noted
  errors.push(...allErrors);
  const mineErr = errors.filter((e) => /devices\/builtin|audio\/(measure|testsignals)/.test(e));
  for (const e of errors) if (!mineErr.includes(e)) t.note('page error (another area): ' + e.slice(0, 200));
  t.ok(!mineErr.length, `no page errors from the sounds area${mineErr.length ? ': ' + mineErr.join(' | ') : ''}`);
} finally {
  await close();
}
t.done();
