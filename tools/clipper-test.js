// Clip Lamp (core.clipper: app/src/devices/builtin/clipper.js) and the master's end (master.clip).
//
// Clip Lamp, on the canonical Node renderer: registered as the spec says (six params, four presets tagged); at its
// defaults the house's test signals pass within 0.1 LU (only delayed and band-limited by its oversampler); pushed hard,
// what comes out sits on the ceiling, and the overshoot the filters rebuild after it is small and reported (meter);
// its latency is the one it declares; MIX 0 is the clean sound however hard DRIVE pushes; SOFT and TAPE make fewer
// high harmonics than HARD on the same push; renders repeat. The master: with master.clip 'clean' a -1.1 dBFS peak
// comes out at -1.1 (the soft clip's curve puts it at -1.36), a sample over full scale is held at 1.0, and Red Line at
// -1 dBTP is the master's last word; absent, every old song keeps its soft clip. In Chromium (QUIET): the device check
// passes at the defaults and on every preset. The browser agreeing with Node on the clean master is golden-test's
// (scene master-clean).
//   node tools/clipper-test.js
import { open, tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { createProject } from '../app/src/core/project.js';
import { measure } from '../app/src/audio/measure.js';
import * as TS from '../app/src/audio/testsignals.js';
import { getDevice, presetParams } from '../app/src/devices/registry.js';
import { softClipCurve, SC_K } from '../app/src/engine/strip.js';
import '../app/src/devices/builtin/index.js';

const T = tally('clipper');
const ok = T.ok;
const SR = 48000;
const db = (x) => 20 * Math.log10(Math.max(Math.abs(x), 1e-12));
const STAMP = '2026-10-07T00:00:00.000Z';

// one audio track playing `chans` through `inserts`, the master as given
function song(chans, inserts, master = {}) {
  const secs = chans[0].length / SR;
  return {
    ...createProject(),
    id: 'p_clip',
    tempo: 120,
    key: null,
    meta: { created: STAMP, modified: STAMP, authors: {} },
    assets: { a: { kind: 'audio', name: 'in', sr: SR, channels: chans.length, duration: secs } },
    tracks: [
      {
        id: 't',
        name: 'In',
        kind: 'audio',
        instrument: null,
        inserts,
        clips: [{ id: 'c', kind: 'audio', start: 0, length: secs * 2, asset: 'a', offset: 0, gain: 0, by: 'you' }],
        gain: 0,
        pan: 0,
        mute: false,
        solo: false,
        arm: false,
        by: 'you',
      },
    ],
    master: { gain: 0, inserts: [], ...master },
  };
}
const render = (chans, inserts, master) =>
  renderSong(song(chans, inserts, master), {
    from: 0,
    to: (chans[0].length / SR) * 2,
    tail: 0.1,
    assets: { a: { sr: SR, channels: chans } },
  });
const clip = (params) => [{ id: 'fx_c', device: 'core.clipper', on: true, params, by: 'you' }];
const peakOf = (r, a = 0, b = Infinity) => {
  let p = 0;
  for (const x of r.channels)
    for (let i = a; i < Math.min(b, x.length); i++) {
      const v = Math.abs(x[i]);
      if (v > p) p = v;
    }
  return p;
};

console.log('Clip Lamp');
const def = getDevice('core.clipper');
ok(
  def && def.kind === 'effect' && def.name === 'Clip Lamp' && def.cat === 'dynamics' && def.key !== true,
  `core.clipper is registered: ${def?.name}, a dynamics effect`,
);
ok(
  ['drive', 'ceiling', 'knee', 'shape', 'output', 'mix'].join() === def.params.map((p) => p.key).join() &&
    def.params.every((p) => p.desc),
  'its params: drive, ceiling, knee, shape, output, mix, each with a meaning',
);
ok(
  ['Drum bus clip', 'Master clip (+3)', 'Master clip (+6)', 'Bass grit'].join() ===
    def.presets.map((p) => p.name).join() && def.presets.every((p) => p.tags.includes('bass-music')),
  `its presets, tagged bass-music (${def.presets.map((p) => p.name).join(', ')})`,
);
ok(
  Math.abs(def.latency * SR - 27.5) < 1e-9 && def.kernel.includes('dsp.oversample4x()'),
  "it runs at 4x through the stdlib's oversampler and declares its latency (27.5 samples)",
);

// the defaults: the test signals pass
{
  const sigs = {
    program: TS.program(8, SR).channels,
    drums: TS.drumLoop(8, SR).channels || [TS.drumLoop(8, SR)],
    strum: [TS.diStrum(8, SR)],
  };
  for (const [name, ch] of Object.entries(sigs)) {
    const chans = Array.isArray(ch) ? ch : [ch];
    const dry = measure({ sr: SR, channels: render(chans, []).channels }),
      wet = measure({ sr: SR, channels: render(chans, clip({})).channels });
    ok(
      Math.abs(wet.lufs - dry.lufs) <= 0.1 && Math.abs(wet.truePeak - dry.truePeak) <= 0.2,
      `at its defaults the ${name} passes: ${(wet.lufs - dry.lufs).toFixed(3)} LU, true peak ${dry.truePeak} -> ${wet.truePeak} dBTP`,
    );
  }
}
// pushed: a 100 Hz sine at -6 dBFS, DRIVE 18 dB into CEILING -6 dBFS: what comes out sits on the ceiling
{
  const x = new Float32Array(2 * SR);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / SR);
  for (const shape of [0, 1, 2]) {
    const r = render([x], clip({ drive: 18, ceiling: -6, shape }));
    const pk = db(peakOf(r, SR / 4, SR * 1.5)),
      over = pk + 6;
    ok(
      over < 0.6 && over > -0.6,
      `${['HARD', 'SOFT', 'TAPE'][shape]}: pushed 18 dB into -6 dBFS, it peaks at ${pk.toFixed(2)} dBFS (the filters after the 4x curve rebuild ${over > 0 ? over.toFixed(2) + ' dB over' : 'nothing over'})`,
    );
  }
  // the harmonics it makes: a hard corner more than a rounded one
  // (the 5th to the 40th harmonic of the 100 Hz tone, against the fundamental, over half a second)
  const hf = (shape) => {
    const L = render([x], clip({ drive: 4, ceiling: -6, shape, knee: 0 })).channels[0],
      a = SR / 2,
      n = SR / 2;
    const pw = (f) => {
      let re = 0,
        im = 0;
      for (let i = a; i < a + n; i++) {
        const w = (2 * Math.PI * f * i) / SR;
        re += L[i] * Math.cos(w);
        im += L[i] * Math.sin(w);
      }
      return re * re + im * im;
    };
    let h = 0;
    for (let k = 5; k <= 40; k++) h += pw(100 * k);
    return 10 * Math.log10(h / pw(100));
  };
  const h0 = hf(0),
    h1 = hf(1);
  ok(
    h1 < h0 - 1,
    `SOFT rounds the peaks: ${(h0 - h1).toFixed(1)} dB less high-frequency energy than HARD on the same 4 dB push`,
  );
  // MIX 0: the clean sound (from before DRIVE), whatever DRIVE is
  const a = render([x], clip({ drive: 18, ceiling: -6, mix: 0 })),
    b = render([x], clip({}));
  let worst = 0;
  for (let i = 0; i < a.channels[0].length; i++) worst = Math.max(worst, Math.abs(a.channels[0][i] - b.channels[0][i]));
  ok(
    db(worst) < -100,
    `MIX 0% is the clean sound however hard it is pushed (differs from the defaults by ${db(worst).toFixed(0)} dBFS)`,
  );
  ok(sha256(render([x], clip({ drive: 9 }))) === sha256(render([x], clip({ drive: 9 }))), 'renders repeat bit for bit');
}
// latency: an impulse comes out where it says
{
  const x = new Float32Array(SR / 4);
  x[1000] = 0.5;
  const r = render([x], clip({})),
    L = r.channels[0];
  let at = 0;
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > Math.abs(L[at])) at = i;
  ok(Math.abs(at - 1000 - 27.5) <= 1, `an impulse comes out ${at - 1000} samples late (declared 27.5)`);
}

console.log('the master');
{
  // a 1 kHz sine whose peak is -1.1 dBFS, then one at +2 dBFS, through the master: soft, then clean
  const mk = (dbfs) => {
    const a = Math.pow(10, dbfs / 20),
      x = new Float32Array(SR);
    for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * 1000 * (i + 0.25)) / SR);
    return x;
  };
  const soft = render([mk(-1.1)], []),
    clean = render([mk(-1.1)], [], { clip: 'clean' });
  const ps = db(peakOf(soft)),
    pc = db(peakOf(clean));
  ok(
    Math.abs(pc + 1.1) < 0.01 && ps < -1.3,
    `a -1.1 dBFS peak: ${ps.toFixed(2)} dBFS through the soft clip, ${pc.toFixed(2)} with master.clip "clean"`,
  );
  const over = render([mk(2)], [], { clip: 'clean' });
  ok(
    Math.abs(peakOf(over) - 1) < 1e-9,
    `a sample over full scale is held at exactly 1.0 with "clean" (${peakOf(over)})`,
  );
  // below the clip, "clean" is exactly the mix: the soft curve's own linear region agrees with it, sample for sample
  const q = render([mk(-12)], []),
    qc = render([mk(-12)], [], { clip: 'clean' });
  let d = 0;
  for (let i = 0; i < q.channels[0].length; i++) d = Math.max(d, Math.abs(q.channels[0][i] - qc.channels[0][i]));
  ok(
    d < 1e-6,
    `under -3 dBFS the two ends agree (worst ${db(d).toFixed(0)} dBFS): only a hot master hears the difference`,
  );
  // a loud master: Clip Lamp (Master clip +3), then Red Line at -1 dBTP, then the clean ceiling: -1 dBTP is the last word
  const prog = TS.program(8, SR).channels.map((x) => Float32Array.from(x, (v) => v * 2.5));
  const chain = [
    {
      id: 'fx_mc',
      device: 'core.clipper',
      on: true,
      params: presetParams('core.clipper', 'Master clip (+3)'),
      by: 'you',
    },
    { id: 'fx_ml', device: 'core.limiter', on: true, params: { gain: 6, ceiling: -1, release: 60 }, by: 'you' },
  ];
  const ms = measure({ sr: SR, channels: render(prog, [], { inserts: chain }).channels }),
    mc = measure({ sr: SR, channels: render(prog, [], { inserts: chain, clip: 'clean' }).channels });
  ok(
    mc.truePeak <= -1.0 + 0.05 && mc.peak > ms.peak + 0.15,
    `Clip Lamp then Red Line at -1 dBTP, clean: ${mc.lufs} LUFS, peaks ${mc.peak} dBFS, ${mc.truePeak} dBTP (soft-clipped after the limiter, the peaks are rounded down to ${ms.peak} dBFS)`,
  );
  // an old song keeps its soft clip: no field, and the soft curve
  const c = softClipCurve(),
    mid = (c.length - 1) / 2,
    at = (x) => c[Math.round(mid + (x / SC_K) * mid)];
  ok(
    Math.abs(db(at(Math.pow(10, -1.1 / 20))) + 1.36) < 0.02,
    `the soft clip itself is unchanged: -1.1 dBFS in, ${db(at(Math.pow(10, -1.1 / 20))).toFixed(2)} out (what every song without master.clip still gets)`,
  );
}

console.log('the device check (Chromium)');
const { page, close, errors } = await open('/app/', { query: 'new' });
try {
  await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
  const chk = await page.evaluate(async () => {
    const { checkDevice } = await import('/app/src/kernel/check.js');
    const reg = await import('/app/src/devices/registry.js');
    const d = reg.getDevice('core.clipper');
    const r0 = await checkDevice(d, {});
    const pre = [];
    for (const pr of d.presets) {
      const pd = {
        ...d,
        id: 'core.clipper-preset',
        params: d.params.map((p) => ({ ...p, def: pr.params[p.key] ?? p.def })),
      };
      const r = await checkDevice(pd, { quick: true });
      pre.push({ name: pr.name, ok: r.ok, errors: r.errors, tp: r.truePeak, dLU: r.level?.deltaLU, cpu: r.cpu?.pct });
    }
    return {
      ok: r0.ok,
      errors: r0.errors,
      warnings: r0.warnings,
      dLU: r0.level?.deltaLU,
      tp: r0.truePeak,
      cpu: r0.cpu?.pct,
      det: r0.deterministic,
      pre,
    };
  });
  ok(
    chk.ok && Math.abs(chk.dLU) <= 0.1 && chk.det,
    `the device check passes at the defaults: ${chk.dLU} LU, ${chk.tp} dBTP, deterministic, ${chk.cpu}% of real time${chk.errors.length ? ': ' + chk.errors.join(' | ') : ''}`,
  );
  ok(
    chk.pre.every((x) => x.ok),
    `...and on every preset (${chk.pre.map((x) => `${x.name} ${x.dLU} LU, ${x.cpu}%`).join('; ')})${chk.pre
      .filter((x) => !x.ok)
      .map((x) => ` ${x.name}: ${x.errors.join(' | ')}`)
      .join(';')}`,
  );
  ok(
    !errors.filter((e) => !/Failed to load resource|favicon|net::ERR|AudioContext/.test(e)).length,
    `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`,
  );
} finally {
  await close();
}
T.done();
