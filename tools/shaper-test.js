// Scribble Strip (core.shaper: app/src/devices/builtin/shaper.js) and its window (app/src/ui/editors/shaper.js).
//
// The device, on the canonical Node renderer: registered as the spec says (three lanes, 15 rates, 16 points, the eight
// presets); at its defaults it is bypass, bit for bit; a volume shape at quarter notes on a steady tone comes out as
// the drawn envelope, landing on the beat at the song's tempo; pan moves energy between the channels at equal power;
// the filter lane changes the spectrum; smoothing takes the clicks out of a hard gate (and 0.1 ms leaves them in, on
// purpose); renders are deterministic; get_project reads a shape back as text. In Chromium: the device check passes at
// the defaults (full) and on every preset (quick), at bypass level, well inside the CPU budget.
// The window: it opens; adding, dragging and bending a point are each one undo step signed you; a preset, the pencil
// and the lane tabs work; the playhead dot moves while the song plays; an agent's change flashes and is said; the
// keyboard moves, steps and deletes points; an agent sets a pump in one call; the phone sheet (44 px targets, 12 px
// text, nothing sideways); no page errors.
//   node tools/shaper-test.js      screenshots: tools/.out/shaper-*.png
import path from 'node:path';
import { open, tally, OUTDIR } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { createProject, summarize } from '../app/src/core/project.js';
import { measure } from '../app/src/audio/measure.js';
import { program } from '../app/src/audio/testsignals.js';
import { getDevice, presetParams } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import * as S from '../app/src/devices/builtin/shaper.js';

const T = tally('shaper');
const ok = T.ok;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ours = (errors) =>
  errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext|getUserMedia/.test(e));
const SR = 48000;
const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

/* ======================================================================== the device (Node: the canonical render) */
const def = getDevice('core.shaper');
ok(
  !!def &&
    def.kind === 'effect' &&
    def.name === 'Scribble Strip' &&
    def.editor === 'shaper' &&
    def.source === 'builtin',
  `core.shaper is registered: ${def?.name}, an effect with its own editor (${def?.editor})`,
);
const visible = def.params.filter((p) => !p.hidden),
  shapeP = def.params.filter((p) => p.hidden);
ok(
  visible.length === 13 &&
    visible.every((p) => p.desc) &&
    shapeP.length === 3 * (1 + 16 * 4) &&
    shapeP.every((p) => p.auto === false),
  `13 knobs, each with a meaning, and ${shapeP.length} shape params (16 points a lane, x y bend step, hidden from the face and the lanes menu)`,
);
ok(
  ['vol', 'flt', 'pan'].every(
    (l) =>
      def.params.find((p) => p.key === `${l}_rate`)?.opts?.join(' ') ===
      '1/32 1/16T 1/16 1/16D 1/8T 1/8 1/8D 1/4T 1/4 1/4D 1/2T 1/2 1/2D 1 BAR 2 BARS',
  ),
  'each lane has its rate: 1/32 to 2 bars, with triplets and dotted',
);
ok(
  S.RATE_BEATS.every((b) => def.kernel.includes(String(b))),
  'the kernel reads the same rates as the window (RATE_BEATS, written into its source)',
);
const WANT_PRESETS = [
  'Pump (quarter notes)',
  'Pump (eighths)',
  'Gate (sixteenths)',
  'Stutter',
  'Swell over a bar',
  'Auto-pan',
  'Filter wobble (eighths)',
  'Half-time duck',
];
ok(
  JSON.stringify(def.presets.map((p) => p.name)) === JSON.stringify(WANT_PRESETS),
  `the eight shape presets, in order (${def.presets.map((p) => p.name).join(', ')})`,
);
ok(
  !/™|®|LFOTool|Kickstart|ShaperBox|Serum|Xfer|Cableguys/i.test(def.nod + def.blurb),
  `its nod is plain words ("${def.nod}")`,
);

// a song: one audio track playing `chans` (mono or stereo) through the shaper with `params`
function song(params, { tempo = 120, secs = 4, insert = true } = {}) {
  const p = {
    ...createProject(),
    id: 'p_shaper',
    title: 'shaper',
    tempo,
    key: null,
    meta: { created: '2026-10-03T00:00:00.000Z', modified: '2026-10-03T00:00:00.000Z', authors: {} },
  };
  p.assets = { a_in: { kind: 'audio', name: 'in', sr: SR, channels: 2, duration: secs } };
  p.tracks = [
    {
      id: 't_in',
      name: 'In',
      kind: 'audio',
      instrument: null,
      inserts: insert ? [{ id: 'fx_sh', device: 'core.shaper', on: true, params, by: 'you' }] : [],
      clips: [
        {
          id: 'c_in',
          kind: 'audio',
          start: 0,
          length: (secs * tempo) / 60,
          asset: 'a_in',
          offset: 0,
          gain: 0,
          by: 'you',
        },
      ],
      gain: 0,
      pan: 0,
      mute: false,
      solo: false,
      arm: false,
      by: 'you',
    },
  ];
  return p;
}
const render = (params, chans, o = {}) => {
  const secs = chans[0].length / SR;
  return renderSong(song(params, { ...o, secs }), {
    from: 0,
    to: (secs * (o.tempo || 120)) / 60,
    tail: 0,
    assets: { a_in: { sr: SR, channels: chans } },
  });
};
const sine = (f, amp, secs) => {
  const x = new Float32Array(Math.round(secs * SR));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
  return x;
};
// a level a sample: the RMS over one period of the 1 kHz tone (48 samples) centred on it, as the tone's amplitude
function envelope(x, amp) {
  const n = x.length,
    c = new Float64Array(n + 1),
    out = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + x[i] * x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 24),
      b = Math.min(n, i + 24);
    out[i] = Math.sqrt(((c[b] - c[a]) / Math.max(1, b - a)) * 2) / amp;
  }
  return out;
}
// where the level crosses `lv` going down (or up), near each of `times` (seconds): the crossing's time, or null
function crossing(env, lv, near, down) {
  const a = Math.max(1, Math.round((near - 0.02) * SR)),
    b = Math.min(env.length - 1, Math.round((near + 0.02) * SR));
  for (let i = a; i < b; i++) {
    const p = env[i - 1],
      q = env[i];
    if (down ? p > lv && q <= lv : p < lv && q >= lv) return (i - 1 + (p - lv) / (p - q)) / SR;
  }
  return null;
}

{
  // the defaults are bypass: the test program through it, bit for bit what plays without it
  const prog = program(4, SR).channels;
  const wet = renderSong(song({}, { secs: 4 }), {
    from: 0,
    to: 8,
    tail: 0.5,
    assets: { a_in: { sr: SR, channels: prog } },
  });
  const dry = renderSong(song({}, { secs: 4, insert: false }), {
    from: 0,
    to: 8,
    tail: 0.5,
    assets: { a_in: { sr: SR, channels: prog } },
  });
  const mW = measure({ sr: SR, channels: wet.channels }),
    mD = measure({ sr: SR, channels: dry.channels });
  ok(
    sha256(wet) === sha256(dry),
    `at its defaults it is bypass: the program comes out bit for bit (${mW.lufs} LUFS on, ${mD.lufs} LUFS without it)`,
  );
}

{
  // the drawn envelope at quarter notes, on the beat, at the song's tempo (97 bpm: nothing lines up by luck)
  const bpm = 97,
    spb = 60 / bpm,
    amp = 0.5;
  const tone = sine(1000, amp, 6);
  const pump = presetParams(def, 'Pump (quarter notes)');
  const r = render(pump, [tone, tone], { tempo: bpm });
  const env = envelope(r.channels[0], amp);
  const pts = S.pointsOf(pump, 'vol');
  // away from the drop (the smoothing's few ms), every millisecond of beats 2-8 against the drawing
  let worst = 0,
    n = 0;
  for (let b = 1; b < 8; b++)
    for (let ph = 0.04; ph < 0.97; ph += 0.01) {
      const t = (b + ph) * spb,
        i = Math.round(t * SR);
      if (i >= env.length - 30) continue;
      const want = S.applied(pump, 'vol', S.valueAt(pts, ph));
      worst = Math.max(worst, Math.abs(env[i] - want));
      n++;
    }
  ok(
    n > 500 && worst < 0.02,
    `a pump at quarter notes on a steady tone is the drawn envelope: ${n} readings, the worst ${(worst * 100).toFixed(2)}% of full scale off (want < 2%)`,
  );
  // the drop lands on the beat: half-way down at each beat, within a millisecond
  const mid = (1 + S.applied(pump, 'vol', 0)) / 2,
    off = [];
  for (let b = 1; b < 8; b++) {
    const c = crossing(env, mid, b * spb, true);
    off.push(c == null ? Infinity : (c - b * spb) * 1000);
  }
  ok(
    off.every((x) => Math.abs(x) < 1),
    `the duck lands on every beat at ${bpm} bpm: half-way down within 1 ms of the beat (${off.map((x) => x.toFixed(2)).join(', ')} ms)`,
  );
  // a hard gate drawn with steps: its levels, and both edges where they're drawn
  const gate = {
    vol_rate: 8,
    vol_depth: 100,
    smooth: 0.5,
    ...S.lanePatch('vol', [
      { x: 0, y: 1, s: 1 },
      { x: 0.5, y: 0.25, s: 1 },
    ]),
  };
  const rg = render(gate, [tone, tone], { tempo: bpm });
  const eg = envelope(rg.channels[0], amp);
  const lv = (t) => eg[Math.round(t * SR)];
  const hi = [1, 2, 3, 4].map((b) => lv((b + 0.25) * spb)),
    lo = [1, 2, 3, 4].map((b) => lv((b + 0.75) * spb));
  ok(
    hi.every((x) => Math.abs(x - 1) < 0.005) && lo.every((x) => Math.abs(x - 0.25) < 0.005),
    `a step gate holds its drawn levels (${hi.map((x) => x.toFixed(3)).join(' ')} at the top, ${lo.map((x) => x.toFixed(3)).join(' ')} at a quarter)`,
  );
  const edges = [];
  for (let b = 1; b < 5; b++) {
    edges.push(
      crossing(eg, 0.625, (b + 0.5) * spb, true) - (b + 0.5) * spb,
      crossing(eg, 0.625, (b + 1) * spb, false) - (b + 1) * spb,
    );
  }
  ok(
    edges.every((x) => x != null && Math.abs(x * 1000) < 0.5),
    `…and both its edges land where they're drawn, within half a millisecond (${edges.map((x) => (x * 1000).toFixed(2)).join(', ')} ms)`,
  );
}

{
  // pan: a mono tone swings between the speakers at equal power
  const amp = 0.3,
    tone = sine(1000, amp, 4),
    ap = presetParams(def, 'Auto-pan');
  const r = render(ap, [tone, tone]);
  const [L, R] = r.channels,
    spb = 0.5,
    cyc = 2 * spb; // half notes at 120 bpm
  const at = (t) => {
    const i = Math.round(t * SR);
    let l = 0,
      rr = 0;
    for (let k = i - 240; k < i + 240; k++) {
      l += L[k] * L[k];
      rr += R[k] * R[k];
    }
    return { l: Math.sqrt(l / 480), r: Math.sqrt(rr / 480) };
  };
  const right = at(cyc + 0.25 * cyc),
    left = at(cyc + 0.75 * cyc),
    mid = at(cyc + 0.5 * cyc);
  const pw = [0.1, 0.3, 0.5, 0.7, 0.9].map((ph) => {
    const x = at(cyc + ph * cyc);
    return db(Math.sqrt(x.l * x.l + x.r * x.r));
  });
  ok(
    db(right.r) - db(right.l) > 10 && db(left.l) - db(left.r) > 10 && Math.abs(db(mid.l) - db(mid.r)) < 0.5,
    `pan moves the energy: a quarter through, right is ${(db(right.r) - db(right.l)).toFixed(1)} dB over left; three quarters, left ${(db(left.l) - db(left.r)).toFixed(1)} dB over right; half-way, centred`,
  );
  ok(
    Math.max(...pw) - Math.min(...pw) < 1,
    `…at equal power: the two sides together stay within ${(Math.max(...pw) - Math.min(...pw)).toFixed(2)} dB across the pass`,
  );
}

{
  // the filter lane: closed at the bottom of its shape, the top end goes; the wobble moves the brightness
  const prog = program(4, SR).channels;
  const closed = {
    vol_on: 0,
    flt_on: 1,
    flt_cut: 8000,
    flt_depth: 50,
    flt_res: 0,
    ...S.lanePatch('flt', [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]),
  };
  const dry = measure({ sr: SR, channels: render({}, prog).channels }),
    wet = measure({ sr: SR, channels: render(closed, prog).channels });
  ok(
    dry.bandsAbs.presence - wet.bandsAbs.presence > 20 &&
      dry.bandsAbs.air - wet.bandsAbs.air > 20 &&
      Math.abs(dry.bandsAbs.low - wet.bandsAbs.low) < 3,
    `the filter lane changes the spectrum: closed to 500 Hz, presence ${(wet.bandsAbs.presence - dry.bandsAbs.presence).toFixed(1)} dB, air ${(wet.bandsAbs.air - dry.bandsAbs.air).toFixed(1)} dB, lows ${(wet.bandsAbs.low - dry.bandsAbs.low).toFixed(1)} dB`,
  );
  const wob = render(presetParams(def, 'Filter wobble (eighths)'), prog);
  const cents = [];
  for (let k = 0; k < 8; k++) {
    const from = 1 + k * 0.0625,
      m = measure({ sr: SR, channels: wob.channels }, { from, to: from + 0.04 });
    cents.push(m.centroid);
  }
  ok(
    Math.max(...cents) / Math.min(...cents) > 1.6,
    `…and the wobble moves the brightness with the eighths (centroid ${Math.round(Math.min(...cents))} to ${Math.round(Math.max(...cents))} Hz across a pass)`,
  );
}

{
  // smoothing: a hard sixteenth gate on a steady tone. 0.1 ms clicks (on purpose); 3 ms leaves no jump a tone of that
  // pitch and level couldn't make by itself
  const amp = 0.5,
    tone = sine(220, amp, 3),
    natural = amp * 2 * Math.sin((Math.PI * 220) / SR);
  const gate = (ms) => ({ ...presetParams(def, 'Gate (sixteenths)'), smooth: ms });
  const jump = (x) => {
    let m = 0;
    for (let i = 4800; i < x.length - 10; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
    return m;
  };
  const hard = jump(render(gate(0.1), [tone, tone]).channels[0]),
    soft = jump(render(gate(3), [tone, tone]).channels[0]);
  ok(hard > 0.15, `with 0.1 ms smoothing a hard gate clicks, as asked: a ${hard.toFixed(3)} jump between samples`);
  ok(
    soft < natural * 1.6,
    `with 3 ms smoothing no sample jumps more than ${(natural * 1.6).toFixed(4)} (the tone alone moves up to ${natural.toFixed(4)}): the worst is ${soft.toFixed(4)}`,
  );
}

{
  // deterministic: two renders of every preset hash the same
  const prog = program(3, SR).channels;
  const same = def.presets.filter((pr) => sha256(render(pr.params, prog)) === sha256(render(pr.params, prog))).length;
  ok(
    same === def.presets.length,
    `renders are deterministic: every preset twice, the same hash (${same} of ${def.presets.length})`,
  );
}

{
  // the text form: what get_project prints for it
  const p = song(presetParams(def, 'Pump (quarter notes)'));
  const text = summarize(p, { devices: getDevice });
  ok(
    /fx_sh=Scribble Strip \(core\.shaper\) volume every 1\/4, depth 85%: 0:0~-0\.35 0\.6:1 1:1; filter off; pan off; smooth 4 ms, mix 100%/.test(
      text,
    ),
    `get_project reads the shape back as text: "${(text.split('\n').find((l) => l.includes('fx_sh')) || '').trim().slice(0, 140)}…"`,
  );
  ok(
    /~step/.test(S.describe(presetParams(def, 'Gate (sixteenths)'))),
    `steps read as ~step ("${S.shapeText(S.pointsOf(presetParams(def, 'Gate (sixteenths)'), 'vol'))}")`,
  );
}

/* ======================================================================== the device check (Chromium) and the window */
const s = await open('/app/', { query: 'demo' });
const { page, errors, shot } = s;
page.setDefaultTimeout(20000);
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(400);
  const E = (fn, arg) => page.evaluate(fn, arg);
  await E(() => document.querySelector('.ar-welcome-x')?.click());

  /* -------- the device check: the defaults in full, every preset quick */
  const chk = await E(async () => {
    const { checkDevice } = await import('/app/src/kernel/check.js');
    const d = window.overdub.devices.getDevice('core.shaper');
    const r0 = await checkDevice(d);
    const out = {
      defaults: {
        ok: r0.ok,
        errors: r0.errors,
        warnings: r0.warnings,
        dLU: r0.level?.deltaLU,
        dD: r0.level?.drumsDeltaLU,
        tp: r0.truePeak,
        cpu: r0.cpu?.pct,
        det: r0.deterministic,
        cases: r0.extremes?.cases,
        ms: r0.ms,
      },
      presets: [],
    };
    for (const pr of d.presets) {
      const pd = {
        ...d,
        id: 'core.shaper-preset',
        params: d.params.map((p) => ({ ...p, def: pr.params[p.key] ?? p.def })),
      };
      const r = await checkDevice(pd, { quick: true });
      out.presets.push({
        name: pr.name,
        ok: r.ok,
        errors: r.errors,
        nan: r.nan,
        det: r.deterministic,
        tp: r.truePeak,
        cpu: r.cpu?.pct,
        dLU: r.level?.deltaLU,
      });
    }
    return out;
  });
  const d0 = chk.defaults;
  ok(
    d0.ok && !d0.errors.length && !d0.warnings.length,
    `the device check passes at the defaults, with no warnings (${d0.cases} extreme cases in ${(d0.ms / 1000).toFixed(1)} s)${d0.errors.length ? ': ' + d0.errors.join(' | ') : ''}${d0.warnings.length ? ' warn: ' + d0.warnings.join(' | ') : ''}`,
  );
  ok(
    Math.abs(d0.dLU) <= 0.1 && Math.abs(d0.dD) <= 0.1 && d0.tp <= -1,
    `the defaults measure as bypass: ${d0.dLU} LU on the strum, ${d0.dD} LU on the drums, ${d0.tp} dBTP`,
  );
  ok(d0.det === true && d0.cpu < 5, `deterministic, and ${d0.cpu}% of real time at the defaults`);
  const badPre = chk.presets.filter((x) => !x.ok || x.nan || !x.det);
  ok(
    !badPre.length,
    `the device check passes on every preset (${chk.presets.length})${badPre.length ? ': ' + badPre.map((x) => `${x.name}: ${x.errors.join(' | ')}`).join('; ') : ''}`,
  );
  const cpuMax = Math.max(...chk.presets.map((x) => x.cpu));
  ok(
    cpuMax < 8,
    `its CPU stays well inside the check's 25% budget: ${cpuMax}% of real time at the busiest preset (${chk.presets.map((x) => `${x.name} ${x.cpu}%`).join(', ')})`,
  );
  ok(
    chk.presets.every((x) => x.tp <= 0),
    `no preset peaks over 0 dBTP on the test signals (worst ${Math.max(...chk.presets.map((x) => x.tp))} dBTP)`,
  );

  /* -------- the window opens */
  const info = await E(async () => {
    const a = window.overdub;
    const t =
      a.store.get().tracks.find((x) => x.kind === 'instrument' && /bass/i.test(x.name)) ||
      a.store.get().tracks.find((x) => x.kind === 'instrument');
    const r = a.store.dispatch(
      { type: 'insert.add', track: t.id, insert: { device: 'core.shaper' }, ref: 's' },
      { by: 'you', label: 'shaper test' },
    );
    a.plugin.open({ track: t.id, slot: r.created.s });
    for (let i = 0; i < 80 && document.querySelector('.pw')?.dataset.editor !== 'shaper'; i++)
      await new Promise((res) => setTimeout(res, 25));
    await new Promise((res) => setTimeout(res, 150));
    const w = document.querySelector('.pw');
    return {
      track: t.id,
      fx: r.created.s,
      editor: w?.dataset.editor,
      tabs: [...w.querySelectorAll('.sh-tab')].map((x) => x.textContent),
      pts: [...w.querySelectorAll('.sh-pt')].filter((x) => !x.hidden).length,
      canvas: !!w.querySelector('.sh-field canvas'),
      label: w.querySelector('.sh-field canvas')?.getAttribute('aria-label'),
      presets: w.querySelectorAll('.sh-pre-b').length,
    };
  });
  ok(
    info.editor === 'shaper' && info.canvas && info.pts === 2,
    `its window opens with its own editor: a canvas and the default shape's 2 points ("${info.label}")`,
  );
  ok(
    info.tabs.length === 3 &&
      /Volume/.test(info.tabs[0]) &&
      /Filter/.test(info.tabs[1]) &&
      /Pan/.test(info.tabs[2]) &&
      info.presets === 8,
    `lane tabs (${info.tabs.join(' | ')}) and the 8 presets, drawn`,
  );
  const fx = info.fx,
    tr = info.track;
  const P = () => E(({ tr, fx }) => window.overdub.store.insert(tr, fx).params, { tr, fx });
  const hist = () =>
    E(() => {
      const h = window.overdub.store.history;
      const l = h[h.length - 1];
      return { n: h.length, by: l?.by, label: l?.label };
    });
  // where a phase and level sit on the canvas (the editor's geometry: a pass with room either side)
  const spot = async (ph, y) =>
    E(
      ({ ph, y }) => {
        const f = document.querySelector('.sh-field'),
          r = f.getBoundingClientRect();
        const side = Math.min(72, Math.max(22, Math.round(r.width * 0.075))),
          top = 14,
          bottom = r.height - 24;
        return { x: r.left + side + ph * (r.width - 2 * side), y: r.top + bottom - y * (bottom - top) };
      },
      { ph, y },
    );
  const ptAt = (i) =>
    E((i) => {
      const el = document.querySelector(`.sh-pt[data-i="${i}"]`);
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, hidden: el.hidden };
    }, i);

  /* -------- add a point: one click, one step by you */
  const h0 = await hist();
  const c1 = await spot(0.5, 0.3);
  await page.mouse.click(c1.x, c1.y);
  await sleep(120);
  const p1 = await P(),
    h1 = await hist();
  ok(
    p1.vol_n === 3 && Math.abs(p1.vol3_x - 0.5) < 1e-6 && Math.abs(p1.vol3_y - 0.3) < 0.02,
    `a click adds a point where it lands (on the grid: x ${p1.vol3_x}, y ${p1.vol3_y})`,
  );
  ok(
    h1.n - h0.n === 1 && h1.by === 'you' && /added a volume point/.test(h1.label),
    `…as one undo step signed you ("${h1.label}")`,
  );

  /* -------- drag it: one step, drawn in warm ink while the hand is on it */
  const a3 = await ptAt(3),
    c2 = await spot(0.75, 0.6);
  await page.mouse.move(a3.x, a3.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(a3.x + ((c2.x - a3.x) * k) / 8, a3.y + ((c2.y - a3.y) * k) / 8);
  await sleep(50);
  const inkDrag = await E(() => document.querySelector('.sh').dataset.ink);
  await page.mouse.up();
  await sleep(120);
  const p2 = await P(),
    h2 = await hist();
  ok(
    Math.abs(p2.vol3_x - 0.75) < 1e-6 && Math.abs(p2.vol3_y - 0.6) < 0.02 && h2.n - h1.n === 1 && h2.by === 'you',
    `dragging a point moves it (to x ${p2.vol3_x}, y ${p2.vol3_y}), one undo step signed you ("${h2.label}")`,
  );
  await sleep(800);
  const inkAfter = await E(() => document.querySelector('.sh').dataset.ink);
  ok(
    inkDrag === 'you' && inkAfter === '',
    `the line is in warm ink while a person draws it ("${inkDrag}"), and back in cream after ("${inkAfter}")`,
  );

  /* -------- bend the line after point 1: one step */
  await sleep(1600); // (past the store's coalescing window, so nothing joins the last step by accident)
  const bd = await E(() => {
    const el = document.querySelector('.sh-bend[data-i="1"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, hidden: el.hidden };
  });
  await page.mouse.move(bd.x, bd.y);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(bd.x, bd.y + k * 6);
  await page.mouse.up();
  await sleep(120);
  const p3 = await P(),
    h3 = await hist();
  ok(
    !bd.hidden && p3.vol1_c !== 0 && h3.n - h2.n === 1 && h3.by === 'you' && /bent/.test(h3.label),
    `dragging a line's square bends it (bend ${p3.vol1_c}), one undo step signed you ("${h3.label}")`,
  );
  await E(() => window.overdub.store.undo());
  await sleep(60);
  ok((await P()).vol1_c === 0 || (await P()).vol1_c === undefined, 'and one undo straightens it again');

  /* -------- the keyboard: arrows move a point, Enter makes it a step, Delete removes it */
  await page.focus('.sh-pt[data-i="3"]');
  const k0 = await P();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await sleep(60);
  const k1 = await P();
  ok(
    Math.abs(k1.vol3_x - (k0.vol3_x + 1 / 16)) < 1e-6 && Math.abs(k1.vol3_y - (k0.vol3_y + 0.05)) < 1e-4,
    `arrow keys move a focused point: a grid step right (${k0.vol3_x} → ${k1.vol3_x}) and 5% up (${k0.vol3_y} → ${k1.vol3_y})`,
  );
  await page.keyboard.press('Enter');
  await sleep(60);
  ok((await P()).vol3_s === 1, 'Enter makes it a step');
  const kl = await E(
    () =>
      document.querySelector('.sh-pt[data-i="3"]').getAttribute('aria-label') +
      ' / ' +
      document.querySelector('.sh-pt[data-i="3"]').getAttribute('aria-valuetext'),
  );
  ok(
    /Volume point \d of 3/.test(kl) && /beat|%/.test(kl) && /dB/.test(kl) && /step/.test(kl),
    `each point is labelled for a screen reader ("${kl}")`,
  );
  await page.keyboard.press('Delete');
  await sleep(60);
  ok((await P()).vol_n === 2, 'Delete removes it');

  /* -------- the snap sets the grid; a point's menu (right-click) makes it a step, or deletes it */
  await page.selectOption('.sh-snap select', { label: '8 steps' });
  await sleep(60);
  const cs = await spot(0.3, 0.5);
  await page.mouse.click(cs.x, cs.y);
  await sleep(100);
  const ps = await P();
  const snapSaid = await E(() => document.querySelector('.sh-snap-n').textContent);
  ok(
    ps.vol_n === 3 && Math.abs(ps.vol3_x - 0.25) < 1e-6 && /1\/32 notes/.test(snapSaid),
    `the snap sets the grid: 8 steps a pass ("${snapSaid}"), and a click at 0.3 lands on 0.25 (${ps.vol3_x})`,
  );
  await page.selectOption('.sh-snap select', { label: '16 steps' });
  const m3 = await ptAt(3);
  await page.mouse.click(m3.x, m3.y, { button: 'right' });
  await page.waitForSelector('.ek-pop[role=menu]');
  const items = await E(() => [...document.querySelectorAll('.ek-pop[role=menu] .ek-item')].map((b) => b.textContent));
  ok(
    items.some((x) => /^Make it a step/.test(x)) &&
      items.some((x) => /^Delete it/.test(x)) &&
      items.some((x) => /^Straighten/.test(x)),
    `right-click on a point: ${items.map((x) => x.replace(/(holds|halfway|a line|Enter|Delete$).*/, '').trim()).join(', ')}`,
  );
  await page.click('.ek-pop[role=menu] .ek-item:has-text("Make it a step")');
  await sleep(60);
  ok((await P()).vol3_s === 1, '…Make it a step makes it one');
  await page.mouse.click(m3.x, m3.y, { button: 'right' });
  await page.waitForSelector('.ek-pop[role=menu]');
  const hd0 = await hist();
  await page.click('.ek-pop[role=menu] .ek-item:has-text("Delete it")');
  await sleep(60);
  const hd1 = await hist();
  ok(
    (await P()).vol_n === 2 && hd1.n - hd0.n === 1 && /deleted a volume point/.test(hd1.label),
    `…and Delete it deletes it, one step ("${hd1.label}")`,
  );

  /* -------- the tabs draw their shapes small; the knobs are bound controls (automation, the agent's flash) */
  const bits = await E(() => ({
    minis: [...document.querySelectorAll('.sh-tab .sh-mini svg path.sh-dr-l')].map(
      (p) => (p.getAttribute('d') || '').length,
    ),
    keys: [...document.querySelectorAll('.sh-ctl .pk-ctl[data-key]')].map((x) => x.dataset.key),
  }));
  ok(bits.minis.length === 3 && bits.minis.every((n) => n > 50), "each lane's tab shows its shape, drawn small");
  ok(
    ['vol_on', 'vol_depth', 'vol_rate', 'flt_cut', 'flt_res', 'smooth', 'mix'].every((k) => bits.keys.includes(k)),
    `on, depth, rate, cutoff, reso, smooth and mix are the window's bound controls (${bits.keys.length})`,
  );

  /* -------- presets */
  await page.click('.sh-pre-b[data-preset="Gate (sixteenths)"]');
  await sleep(120);
  const pg = await E(
    ({ tr, fx }) => {
      const a = window.overdub;
      const d = a.devices.getDevice('core.shaper');
      const st = a.store.insert(tr, fx).params;
      return {
        name: a.devices.presetOf(d, st)?.name,
        pressed: document.querySelector('.sh-pre-b[data-preset="Gate (sixteenths)"]').getAttribute('aria-pressed'),
        bar: document.querySelector('.pw .pw-pre-n')?.textContent,
        label: a.store.history[a.store.history.length - 1].label,
      };
    },
    { tr, fx },
  );
  ok(
    pg.name === 'Gate (sixteenths)' && pg.pressed === 'true' && /Gate \(sixteenths\)/.test(pg.bar),
    `a preset's drawing applies it ("${pg.label}"), printed in reverse, and the window's bar names it ("${pg.bar}")`,
  );
  await page.click('.sh-pre-b[data-preset="Auto-pan"]');
  await sleep(120);
  ok(
    await E(
      () =>
        document.querySelector('.sh').dataset.lane === 'pan' &&
        document.querySelector('.sh-tab[data-lane="pan"]').getAttribute('aria-selected') === 'true',
    ),
    'a pan preset shows the pan lane',
  );
  await shot('shaper-pan');

  /* -------- the lane tabs */
  await page.click('.sh-tab[data-lane="flt"]');
  await sleep(80);
  const lt = await E(() => ({
    lane: document.querySelector('.sh').dataset.lane,
    sel: document.querySelector('.sh-tab[data-lane="flt"]').getAttribute('aria-selected'),
    cut: !!document.querySelector('.sh-grp[data-lane="flt"]:not([hidden]) .pk-ctl[data-key="flt_cut"]'),
    volHidden: document.querySelector('.sh-grp[data-lane="vol"]').hidden,
    label: document.querySelector('.sh-field canvas').getAttribute('aria-label'),
  }));
  ok(
    lt.lane === 'flt' && lt.sel === 'true' && lt.cut && lt.volHidden && /^Filter shape/.test(lt.label),
    `a tab shows its lane: its shape and its knobs (cutoff, reso) ("${lt.label}")`,
  );
  await page.focus('.sh-tab[data-lane="flt"]');
  await page.keyboard.press('ArrowRight');
  await sleep(60);
  ok(
    await E(
      () => document.querySelector('.sh').dataset.lane === 'pan' && document.activeElement?.dataset.lane === 'pan',
    ),
    'the tabs take the arrow keys',
  );
  await page.click('.sh-tab[data-lane="vol"]');

  /* -------- the pencil: paints steps on the grid, one undo step */
  await page.click('.sh-pre-b[data-preset="Pump (quarter notes)"]');
  await sleep(80);
  await E(() => {
    const r = document.querySelector('.sh-tools .pk-seg-b:nth-child(2)');
    r.click();
  });
  await sleep(60);
  const hp0 = await hist();
  const s0 = await spot(0.02, 0.95),
    s1 = await spot(0.48, 0.95);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(s0.x + ((s1.x - s0.x) * k) / 10, s0.y);
  const s2 = await spot(0.55, 0.02);
  await page.mouse.move(s2.x, s2.y);
  await page.mouse.up();
  await sleep(120);
  const pp = await P(),
    hp1 = await hist();
  const ppts = S.pointsOf(pp, 'vol');
  ok(
    hp1.n - hp0.n === 1 && hp1.by === 'you' && /painted/.test(hp1.label),
    `the pencil paints in one undo step signed you ("${hp1.label}")`,
  );
  ok(
    ppts.some((p) => p.s && p.x === 0 && p.y === 1) &&
      ppts.some((p) => p.s && p.y === 0 && p.x >= 0.5 && p.x < 0.6) &&
      Math.abs(S.valueAt(ppts, 0.3) - 1) < 1e-6,
    `…steps on the grid: on through the first half, off from ${ppts.find((p) => p.s && p.y === 0)?.x} (${S.shapeText(ppts)})`,
  );
  await shot('shaper-pencil');
  await E(() => document.querySelector('.sh-tools .pk-seg-b:nth-child(1)').click());

  /* -------- the playhead dot rides the line while the song plays */
  await page.click('.sh-pre-b[data-preset="Pump (quarter notes)"]');
  await E(async () => {
    const a = window.overdub;
    await a.engine.start?.();
    a.engine.play(0);
  });
  await sleep(700);
  const ph1 = await E(() => ({
    ph: document.querySelector('.sh').dataset.phase,
    now: document.querySelector('.sh-now').textContent,
  }));
  await sleep(230);
  const ph2 = await E(() => document.querySelector('.sh').dataset.phase);
  await shot('shaper-desktop');
  await page.locator('.pw').screenshot({ path: path.join(OUTDIR, 'shaper-window.png') });
  await E(() => window.overdub.engine.stop());
  ok(
    ph1.ph !== '' && ph2 !== '' && ph1.ph !== ph2 && /dB/.test(ph1.now),
    `the playhead dot moves while the song plays (at ${ph1.ph}, then ${ph2} of a pass; "${ph1.now}")`,
  );
  await sleep(150);
  ok(await E(() => document.querySelector('.sh').dataset.phase === ''), '…and leaves the line when it stops');

  /* -------- an agent's change: the canvas and the tab flash cool, the window says what it drew */
  const ag = await E(
    async ({ tr, fx }) => {
      const a = window.overdub;
      const { lanePatch } = await import('/app/src/devices/builtin/shaper.js');
      a.store.dispatch(
        {
          type: 'insert.set',
          track: tr,
          insert: fx,
          patch: {
            params: lanePatch('vol', [
              { x: 0, y: 0.2, c: -0.5 },
              { x: 0.5, y: 1 },
              { x: 1, y: 1 },
            ]),
          },
        },
        { by: 'claude', label: 'a softer pump' },
      );
      const st = document.querySelector('.pw .pw-status');
      await new Promise((res) => setTimeout(res, 120));
      return {
        field: document.querySelector('.sh-field').classList.contains('pk-flash'),
        tab: document.querySelector('.sh-tab[data-lane="vol"]').classList.contains('pk-flash'),
        say: st?.textContent,
        by: st?.querySelector('.by')?.className,
        color: getComputedStyle(document.querySelector('.sh-field')).outlineColor,
        ink: document.querySelector('.sh').dataset.ink,
      };
    },
    { tr, fx },
  );
  ok(
    ag.field && ag.tab && ag.color === 'rgb(76, 195, 255)' && ag.ink === 'agent',
    `an agent's shape flashes the canvas and its tab in cool ink (${ag.color}), and its line is drawn cool for a moment ("${ag.ink}")`,
  );
  ok(
    /Claude drew the volume shape: 3 points, every 1\/4\./.test(ag.say) && /by-agent/.test(ag.by || ''),
    `…and the window says what it drew ("${ag.say}")`,
  );
  await shot('shaper-agent');

  /* -------- an agent sets a pump on the bass in one call, and reads it back */
  const one = await E(async () => {
    const a = window.overdub;
    const t = a.store.get().tracks.find((x) => /bass/i.test(x.name));
    const r = await a.tools.run(
      'apply_ops',
      {
        ops: [
          {
            type: 'insert.add',
            track: t.name,
            insert: {
              device: 'core.shaper',
              params: { vol_n: 3, vol1_x: 0, vol1_y: 0, vol1_c: -0.35, vol2_x: 0.6, vol2_y: 1, vol3_x: 1, vol3_y: 1 },
            },
          },
        ],
        label: 'pump on the bass',
        reason: 'room for the kick',
      },
      { by: 'claude' },
    );
    const g = await a.tools.run('get_project', { track: t.name }, { by: 'claude' });
    const line =
      (g.song || '').split('\n').find((l) => /inserts:.*core\.shaper/.test(l) && /0:0~-0\.35 0\.6:1 1:1/.test(l)) || '';
    return {
      ok: !r.error,
      error: r.error,
      line,
      mine: line.split(' → ').find((x) => /0:0~-0\.35 0\.6:1 1:1/.test(x)) || '',
    };
  });
  ok(
    one.ok && /volume every 1\/4, depth 100%: 0:0~-0\.35 0\.6:1 1:1/.test(one.mine),
    `an agent sets a pump on the bass in one apply_ops call and get_project reads it back ("${one.mine.trim().slice(0, 110)}…")`,
  );

  /* -------- its CSS keeps the liner-notes rules */
  const css = await E(() =>
    [...document.querySelectorAll('style[data-css="plugin-shaper"]')].map((x) => x.textContent).join('\n'),
  );
  ok(
    css.length > 1000 &&
      !/border-(left|right|top)\s*:\s*[2-9]px solid|inset\s+-?\d+px\s+0\s+0|border-radius:\s*(99|999|9999)px|backdrop-filter|radial-gradient/.test(
        css,
      ),
    'its CSS has no coloured edge, no pill, no glass, no glow gradient',
  );

  ok(
    !ours(errors).length,
    `desktop: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`,
  );
} catch (e) {
  ok(false, 'desktop run threw: ' + ((e && e.stack) || e));
}
await s.close();

/* ======================================================================== a phone: the sheet, 44 px to press */
{
  const p = await open('/app/', { query: 'demo', width: 390, height: 844 });
  const { page, errors, shot } = p;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(400);
    const E = (fn, arg) => page.evaluate(fn, arg);
    await E(async () => {
      const a = window.overdub,
        t = a.store.get().tracks.find((x) => x.kind === 'instrument');
      const d = a.devices.getDevice('core.shaper');
      const r = a.store.dispatch(
        { type: 'insert.add', track: t.id, insert: { device: 'core.shaper', params: d.presets[0].params }, ref: 's' },
        { by: 'you' },
      );
      a.plugin.open({ track: t.id, slot: r.created.s });
      for (let i = 0; i < 80 && document.querySelector('.pw')?.dataset.editor !== 'shaper'; i++)
        await new Promise((res) => setTimeout(res, 25));
    });
    await sleep(500);
    await shot('shaper-phone');
    const m = await E(() => {
      const el = document.querySelector('.pw'),
        r = el.getBoundingClientRect(),
        body = el.querySelector('.pw-body');
      const sh = el.querySelector('.sh');
      const texts = [...sh.querySelectorAll('*')].filter(
        (x) => x.getClientRects().length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
      );
      const small = texts
        .map((x) => [x.className, parseFloat(getComputedStyle(x).fontSize), x.textContent.trim().slice(0, 16)])
        .filter((x) => x[1] < 12);
      const box = (q) =>
        [...sh.querySelectorAll(q)]
          .filter((x) => x.getClientRects().length)
          .map((x) => {
            const b = x.getBoundingClientRect();
            return [Math.round(b.width), Math.round(b.height)];
          });
      el.querySelector('.sh-field').scrollIntoView({ block: 'center' });
      const reach = (q) =>
        [...sh.querySelectorAll(q)]
          .filter((x) => x.getClientRects().length)
          .map((x) => {
            const b = x.getBoundingClientRect(),
              cx = b.left + b.width / 2,
              cy = b.top + b.height / 2;
            const at = (dx, dy) => {
              const t = document.elementFromPoint(cx + dx, cy + dy);
              return !!t && (t === x || x.contains(t));
            };
            return at(-20, 0) && at(20, 0) && at(0, -20) && at(0, 20);
          });
      return {
        r: r.toJSON(),
        vw: innerWidth,
        vh: innerHeight,
        over: body.scrollWidth - body.clientWidth,
        shW: sh.getBoundingClientRect().width,
        small,
        tabs: box('.sh-tab'),
        pre: box('.sh-pre-b'),
        seg: box('.sh-tools .pk-seg-b'),
        sel: box('select'),
        pts: reach('.sh-pt:not([hidden])'),
        field: el.querySelector('.sh-field').getBoundingClientRect().width,
      };
    });
    T.ok(
      m.r.left === 0 && m.r.top === 0 && Math.round(m.r.width) === m.vw && m.over <= 1 && m.field <= m.vw,
      `phone: a full-height sheet, the canvas the width of the screen (${Math.round(m.field)} px of ${m.vw}), nothing runs out sideways`,
    );
    const all44 = (xs) => xs.length > 0 && xs.every(([w, hh]) => w >= 44 && hh >= 44);
    T.ok(
      all44(m.tabs) && all44(m.pre) && all44(m.seg) && all44(m.sel),
      `phone: the tabs, presets, draw switch and selects are 44 px to press (${[m.tabs, m.pre, m.seg, m.sel].map((xs) => (xs.length ? Math.min(...xs.map(([w, hh]) => Math.min(w, hh))) : 0)).join(', ')})`,
    );
    T.ok(
      m.pts.length >= 2 && m.pts.every(Boolean),
      `phone: every point is a 44 px target under a finger (${m.pts.length} points)`,
    );
    T.ok(
      !m.small.length,
      `phone: no text under 12 px${
        m.small.length
          ? ' (' +
            m.small
              .slice(0, 4)
              .map((x) => `${x[0]} ${x[1]}px "${x[2]}"`)
              .join('; ') +
            ')'
          : ''
      }`,
    );
    // a finger adds a point, and drags it
    const f = await E(() => {
      const r = document.querySelector('.sh-field').getBoundingClientRect();
      const side = Math.min(72, Math.max(22, Math.round(r.width * 0.075)));
      return { x: r.left + side + 0.3 * (r.width - 2 * side), y: r.top + (r.height - 24) - 0.5 * (r.height - 38) };
    });
    const n0 = await E(() => window.overdub.store.history.length);
    await page.mouse.click(f.x, f.y);
    await sleep(150);
    T.ok(await E((n0) => window.overdub.store.history.length > n0, n0), 'phone: a tap on the canvas adds a point');
    await E(() => {
      document.querySelector('.pw-body').scrollTop = 600;
    });
    await sleep(150);
    await shot('shaper-phone-scrolled');
    T.ok(
      !ours(errors).length,
      `phone: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`,
    );
  } catch (e) {
    T.ok(false, 'phone run threw: ' + ((e && e.stack) || e));
  }
  await p.close();
}
T.done();
