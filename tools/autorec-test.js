// Recording automation (docs/research/AUTOMATION.md 3.9; app/src/input/autorec.js, the recorder's commit hook).
//   1. Node: which dispatches are control moves (gestureOf); a gesture as lane writes (planMove): the jump in, the
//      points thinned, the glide back to the lane, a pass per loop wrap, Latch on an empty lane; autorec on a store
//      with a stand-in transport: while R records a move is held in a preview and kept out of the history, the take's
//      writes come back for the commit, the song is exactly as it was until then, and undo is exact; while the song
//      just plays the move goes through, the toast says it stays where you left it (fresh eyes 5: "Keep that move"
//      read as if the move would be taken back), and Write it into the lane writes it after the fact, in one undo step;
//      a key or wheel gesture ends 400 ms after its last step; round a loop each pass is its own write and ⌘Z mid-take
//      drops one.
//   2. The studio (Night Shift, real pointer drags on the Bass's cutoff knob): while R records, the drag writes a lane
//      that reads back the gesture within 2.5% of the knob's travel, outside the touched span nothing moves, letting go
//      glides back to the lane over 200 ms, the take is one undo step and undo is exact; a fader drag in the mixer
//      writes the level lane; with the song just playing, the toast says the knob stays where you left it and offers
//      Write it into the lane, which writes the move; and it is heard (a probe kernel's output, live): the hand while
//      it holds, the lane once let go, the written pass on the next time round the loop.
//
//   node tools/autorec-test.js
import { open, tally } from './pw.js';
import { createStore } from '../app/src/core/store.js';
import { createProject } from '../app/src/core/project.js';
import { paramSpec, specFor, valueAt, laneAt, toPos } from '../app/src/core/automation.js';
import { gestureOf, planMove, createAutorec, GLIDE_S } from '../app/src/input/autorec.js';
import { passOf } from '../app/src/input/capture.js';

const t = tally('autorec');
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((kk) => [kk, v[kk]]),
        )
      : v,
  );
const body = (s) => canon({ ...s.get(), meta: null });
const near = (a, b, e) => Math.abs(a - b) <= e;

/* ------------------------------------------------------------------ 1. Node */
const DEVS = {
  'x.synth': {
    id: 'x.synth',
    kind: 'instrument',
    name: 'Testsynth',
    params: [
      { key: 'cutoff', label: 'CUTOFF', min: 40, max: 16000, def: 2000, curve: 'log', unit: 'Hz' },
      { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0 },
    ].map(paramSpec),
  },
};
const getDevice = (id) => DEVS[id] || null;
{
  // which dispatches are a control being moved
  const g = (ops, o) => JSON.stringify(gestureOf(ops, o));
  t.ok(
    g(
      { type: 'insert.set', track: 't1', insert: 'fx_1', patch: { params: { mix: 0.4 } } },
      { coalesce: 'insert:fx_1:mix' },
    ) === '{"addr":{"track":"t1","insert":"fx_1","param":"mix"},"value":0.4}',
    'a knob on an insert is a move',
  );
  t.ok(
    g({ type: 'instrument.set', track: 't1', params: { cutoff: 900 } }, { coalesce: 'instrument:t1:cutoff' }) ===
      '{"addr":{"track":"t1","insert":"instrument","param":"cutoff"},"value":900}',
    'an instrument knob is a move',
  );
  t.ok(
    g({ type: 'track.set', track: 't1', patch: { gain: -6 } }, { coalesce: 'track:t1:gain' }).includes(
      '"param":"gain"',
    ) && g({ type: 'master.set', patch: { gain: -1 } }, { coalesce: 'master:gain' }).includes('"track":"master"'),
    "a fader (a track's, the master's) is a move",
  );
  t.ok(
    g(
      [
        { type: 'insert.set', track: 't1', insert: 'fx_1', patch: { params: { mix: 0.4 } } },
        { type: 'auto.set', track: 't1', insert: 'fx_1', param: 'mix', patch: { off: true } },
      ],
      { coalesce: 'insert:fx_1:mix' },
    ).includes('"mix"'),
    'a knob turn that holds its lane ([set, auto.set off]) is a move',
  );
  t.ok(
    g({ type: 'track.set', track: 't1', patch: { gain: -6 } }, {}) === 'null' &&
      g({ type: 'track.set', track: 't1', patch: { mute: true } }, { coalesce: 'track:t1:mute' }) === 'null' &&
      g({ type: 'track.set', track: 't1', patch: { gain: -6 } }, { coalesce: 'track:t1:gain', by: 'claude' }) ===
        'null' &&
      g(
        { type: 'insert.set', track: 't1', insert: 'fx_1', patch: { params: { mix: 0.4, time: 3 } } },
        { coalesce: 'insert:fx_1:mix' },
      ) === 'null' &&
      g(
        { type: 'instrument.set', track: 't1', device: 'core.keys', params: { a: 1 } },
        { coalesce: 'instrument:t1:a' },
      ) === 'null',
    "not a move: no coalesce key, mute, an agent's, two params at once (a preset), an instrument swap",
  );

  // a gesture as writes
  const spec = paramSpec(DEVS['x.synth'].params[0]);
  const addr = { track: 't1', insert: 'instrument', param: 'cutoff' };
  const P = (beat, v, pass = 0, from = 0, to = Infinity) => ({ pass, beat, from, to, v });
  const sweep = [];
  for (let i = 0; i <= 40; i++) sweep.push(P(4 + i * 0.05, 1000 * Math.pow(4, i / 40))); // a straight turn of a log knob
  const w = planMove({
    addr,
    spec,
    pts: sweep,
    before: 800,
    lane: [
      { t: 0, v: 800 },
      { t: 32, v: 800 },
    ],
    glide: 0.5,
  });
  t.ok(
    w.length === 1 && w[0].type === 'auto.write' && w[0].from === 4 && w[0].to === 6.5,
    `one write over the touched span and the glide (${w.map((o) => `${o.from}–${o.to}`).join(', ')})`,
  );
  t.ok(
    w[0].points.length <= 5 && w[0].points[0].v === 800 && w[0].points[1].t === 4 && near(w[0].points[1].v, 1000, 1e-9),
    `thinned to the shape (${w[0].points.length} points from 41; a straight turn of a log knob is a line in its travel): ${w[0].points.map((x) => `${x.t}:${Math.round(x.v)}`).join(' ')}`,
  );
  const lane1 = w[0].points;
  t.ok(
    near(valueAt(lane1, 5, spec), 2000, 2000 * 0.01) &&
      near(valueAt(lane1, 6, spec), 4000, 1e-6) &&
      near(valueAt(lane1, 6.5, spec), 800, 1e-9) &&
      near(valueAt(lane1, 6.25, spec), Math.sqrt(4000 * 800), 2),
    `it reads back the gesture (beat 5: ${valueAt(lane1, 5, spec).toFixed(0)} Hz), jumps in from the lane at the touch, and glides back to it (6.25: ${valueAt(lane1, 6.25, spec).toFixed(0)} Hz, half way in the knob's travel)`,
  );
  const w0 = planMove({ addr, spec, pts: sweep, before: 800, lane: null, glide: 0.5 });
  t.ok(
    w0.length === 1 && w0[0].to === 6 && w0[0].points[w0[0].points.length - 1].v === 4000 && w0[0].points[0].v === 800,
    "on an empty lane: from the knob's value to the last one, which holds (Touch and Latch agree)",
  );
  // across a loop wrap (loop 0–8): this pass holds to the loop's end, the next starts at its start
  const wrap = [P(7, 1000, 0, 0, 8), P(7.5, 2000, 0, 0, 8), P(0.5, 3000, 1, 0, 8), P(1, 3000, 1, 0, 8)];
  const ww = planMove({ addr, spec, pts: wrap, before: 1000, lane: [{ t: 0, v: 1000 }], glide: 0.25 });
  t.ok(
    ww.length === 2 &&
      ww[0].from === 7 &&
      ww[0].to === 8 &&
      ww[0].points[ww[0].points.length - 1].v === 2000 &&
      ww[1].from === 0 &&
      ww[1].points[0].v === 2000 &&
      ww[1].to === 1.25 &&
      ww[1].points[ww[1].points.length - 1].v === 1000,
    `a gesture across a loop wrap is a write per pass (${ww.map((o) => `${o.from}–${o.to}: ${o.points.map((x) => `${x.t}:${x.v}`).join(' ')}`).join(' | ')})`,
  );
  const wc = planMove({ addr, spec, pts: [P(1, 20), P(2, 99999)], before: 500 });
  t.ok(
    wc[0].points.every((x) => x.v >= 40 && x.v <= 16000),
    "values are kept to the control's travel",
  );

  // autorec on a store, with a stand-in transport and recorder
  const mk = () => {
    const store = createStore(createProject({ title: 'Touch' }), { getDevice });
    const tid = store.dispatch(
      {
        type: 'track.add',
        ref: 'a',
        track: { name: 'Synth', kind: 'instrument', instrument: { device: 'x.synth', params: { cutoff: 800 } } },
      },
      { by: 'you' },
    ).created.a;
    const on = new Map();
    const ev = (type, fn) => {
      if (!on.has(type)) on.set(type, []);
      on.get(type).push(fn);
      return () => {};
    };
    const engine = {
      playing: true,
      gridBeat: 0,
      beat: 0,
      beatAt() {
        return this.beat;
      },
      on: ev,
    };
    const rs = new Map();
    const rec = {
      state: 'idle',
      g: 0,
      gridNow() {
        return this.state === 'rec' ? this.g : null;
      },
      where(g) {
        return { pass: 0, beat: g, from: 0, to: Infinity };
      },
      on(type, fn) {
        rs.set(type, fn);
      },
    };
    const toasts = [];
    const app = { store, engine, devices: { getDevice }, ui: { toast: (text, o) => toasts.push({ text, o }) } };
    const ar = createAutorec(app, { emit() {} }, rec);
    return {
      store,
      tid,
      engine,
      rec,
      ar,
      toasts,
      emit: (type, d) => (on.get(type) || []).forEach((f) => f(d)),
      recState: (s) => {
        rec.state = s;
        rs.get('state')?.({ state: s, take: 'tk_t1' });
      },
    };
  };
  const knob = (x, v) =>
    x.store.dispatch(
      { type: 'instrument.set', track: x.tid, params: { cutoff: v } },
      { by: 'you', coalesce: 'instrument:' + x.tid + ':cutoff', label: 'cutoff' },
    );

  // while R records: held in a preview, out of the history; the writes come back for the commit
  {
    const x = mk();
    x.store.dispatch(
      { type: 'auto.write', track: x.tid, insert: 'instrument', param: 'cutoff', points: '0:800 32:800' },
      { by: 'you' },
    );
    const before = body(x.store),
      hist = x.store.history.length;
    x.recState('rec');
    let took = 0,
      mid = null;
    for (let i = 0; i <= 40; i++) {
      x.rec.g = 4 + i * 0.05;
      if (knob(x, Math.round(1000 * Math.pow(4, i / 40))).recorded) took++;
      if (i === 20) {
        const tr = x.store.track(x.tid);
        mid = { off: tr.instrument.auto.cutoff.off, v: tr.instrument.params.cutoff };
      }
    }
    t.ok(
      took === 41 && x.store.history.length === hist,
      `while R records, the knob's 41 moves are taken: none reaches the history (${x.store.history.length - hist} new steps)`,
    );
    t.ok(
      mid && mid.off === true && mid.v === 2000,
      `and each is heard: the lane is held and the knob's value plays, in a preview (mid-gesture: held ${mid?.off}, ${mid?.v} Hz)`,
    );
    const fin = x.ar.finish({ span: { g0: 0, b0: 0, loop: null, wrap: Infinity }, lastG: 6.5 });
    t.ok(body(x.store) === before, 'when the take stops, the previews come back out: the song is exactly as it was');
    const glide = (GLIDE_S * 120) / 60;
    t.ok(
      fin.ops.length === 1 &&
        near(fin.ops[0].from, 4, 1 / 256) &&
        near(fin.ops[0].to, 6.5 + glide, 1 / 1024) &&
        /^Cutoff, bar 2 \(recorded\)$/.test(fin.label) &&
        /Cutoff, bar 2/.test(fin.summary),
      `the take's ops: one write, 4–${fin.ops[0]?.to} ("${fin.label}"; "${fin.summary}")`,
    );
    const d = x.store.dispatch(fin.ops, { by: 'you', label: fin.label });
    const lane = laneAt(x.store.get(), { track: x.tid, insert: 'instrument', param: 'cutoff' }),
      sp = specFor(x.store.get(), { track: x.tid, insert: 'instrument', param: 'cutoff' }, getDevice);
    t.ok(
      d.ok &&
        near(valueAt(lane, 5, sp), 2000, 30) &&
        near(valueAt(lane, 6.25, sp), 4000, 1e-6) &&
        near(valueAt(lane, 7, sp), 800, 1e-9) &&
        valueAt(lane, 2, sp) === 800 &&
        valueAt(lane, 20, sp) === 800 &&
        x.store.track(x.tid).instrument.params.cutoff === 800,
      `committed, the lane reads back the move (beat 5: ${valueAt(lane, 5, sp).toFixed(0)} Hz; held to the let-go at 6.5), glides back by ${(6.5 + glide).toFixed(3)}, leaves the rest alone, and the knob's own value is untouched`,
    );
    x.store.undo();
    t.ok(body(x.store) === before, 'undo is exact');
  }
  // a held lane written by R is given back
  {
    const x = mk();
    x.store.dispatch(
      [
        { type: 'auto.write', track: x.tid, insert: 'instrument', param: 'cutoff', points: '0:800 32:800' },
        { type: 'auto.set', track: x.tid, insert: 'instrument', param: 'cutoff', patch: { off: true } },
      ],
      { by: 'you' },
    );
    x.recState('rec');
    for (let i = 0; i <= 10; i++) {
      x.rec.g = 8 + i * 0.1;
      knob(x, 1000 + i * 100);
    }
    const f = x.ar.finish({ span: { g0: 0, b0: 0, loop: null, wrap: Infinity }, lastG: 9 });
    t.ok(
      f.ops.map((o) => o.type).join() === 'auto.write,auto.set' && f.ops[1].patch.off === false,
      `writing into a held lane gives it back (${f.ops.map((o) => o.type).join(', ')})`,
    );
    const y = mk();
    y.recState('rec');
    for (let i = 0; i <= 10; i++) {
      y.rec.g = 8 + i * 0.1;
      knob(y, 1000 + i * 100);
    }
    const before = body(y.store);
    const c = y.ar.finish(null, { cancel: true });
    t.ok(
      !c.ops.length &&
        body(y.store) === before.replace(/"cutoff":2000/, '"cutoff":800') &&
        y.store.track(y.tid).instrument.params.cutoff === 800,
      'a cancelled take (R in the count-in) writes nothing and puts the knob back',
    );
  }
  // a knob moved in the count-in (or while R waits for the bar) is the take's: heard, out of the history, and written
  // from the downbeat (FRESH-EYES-2: it used to go through as a plain knob change and the take said nothing was played)
  {
    const x = mk();
    x.store.dispatch(
      { type: 'auto.write', track: x.tid, insert: 'instrument', param: 'cutoff', points: '0:600 64:600' },
      { by: 'you' },
    );
    const before = body(x.store),
      hist = x.store.history.length;
    x.recState('count');
    const r0 = knob(x, 650);
    const tr0 = x.store.track(x.tid);
    const heard = { off: tr0.instrument.auto.cutoff.off, v: tr0.instrument.params.cutoff };
    x.rec.g = 4;
    x.recState('rec');
    let took = r0.recorded ? 1 : 0;
    for (let i = 1; i <= 31; i++) {
      x.rec.g = 4 + i * 0.1;
      if (knob(x, Math.round(650 + i * 230)).recorded) took++;
    }
    t.ok(
      took === 32 && x.store.history.length === hist && heard.off === true && heard.v === 650,
      `a knob moved in the count-in is the take's: all 32 moves taken, none in the history (${x.store.history.length - hist} new steps), and heard in the count (lane held ${heard.off}, ${heard.v} Hz)`,
    );
    const f = x.ar.finish({ span: { g0: 4, b0: 4, loop: null, wrap: Infinity }, lastG: 7.2 });
    t.ok(
      body(x.store) === before && x.store.track(x.tid).instrument.params.cutoff === 800,
      "when the take stops the song is as it was, the knob's own value untouched (800 Hz)",
    );
    const lane = (s) => laneAt(s.get(), { track: x.tid, insert: 'instrument', param: 'cutoff' });
    const d = x.store.dispatch(f.ops, { by: 'you', label: f.label });
    const sp = specFor(x.store.get(), { track: x.tid, insert: 'instrument', param: 'cutoff' }, getDevice);
    t.ok(
      d.ok &&
        f.ops.length === 1 &&
        f.ops[0].from === 4 &&
        /Cutoff, bar 2/.test(f.summary) &&
        near(valueAt(lane(x.store), 3.9, sp), 600, 1e-6) &&
        valueAt(lane(x.store), 4, sp) === 650 &&
        near(valueAt(lane(x.store), 7, sp), 650 + 30 * 230, 0.05 * (650 + 30 * 230)) &&
        !x.toasts.some((m) => /moved from/.test(m.text)),
      `it writes from the downbeat, from where the hand was (beat 4: ${valueAt(lane(x.store), 4, sp)} Hz, beat 7: ${valueAt(lane(x.store), 7, sp)?.toFixed(0)} Hz; "${f.summary}"), and no "Write it into the lane" toast`,
    );
    // cancelled in the count: let go, nothing written, the knob as it was
    const y = mk();
    const b0 = body(y.store);
    y.recState('count');
    knob(y, 3000);
    const mid = y.store.track(y.tid).instrument.params.cutoff;
    y.recState('idle');
    t.ok(
      mid === 3000 &&
        body(y.store) === b0 &&
        y.ar.touching().length === 0 &&
        !y.ar.finish(null, { cancel: true }).ops.length,
      'a count-in cancelled lets the knob go: nothing written, the song as it was',
    );
    // a move already going when the count began: the part before is a move to keep, the rest goes into the take
    const z = mk();
    z.engine.playing = true;
    knob(z, 900);
    z.engine.beat = 1;
    knob(z, 1000);
    z.recState('count');
    const rz = knob(z, 1100);
    z.rec.g = 4;
    z.recState('rec');
    z.rec.g = 5;
    knob(z, 1500);
    const fz = z.ar.finish({ span: { g0: 4, b0: 4, loop: null, wrap: Infinity }, lastG: 5.5 });
    t.ok(
      rz.recorded === true && fz.ops.length === 1 && fz.ops[0].from === 4,
      `a move going when the count began is cut there: what comes after is the take's (${fz.ops.map((o) => `${o.from}–${o.to}`).join(', ')})`,
    );
  }
  // the wheel or the keys (no pointer): the gesture ends 400 ms after its last step, at that step
  {
    const x = mk();
    x.recState('rec');
    for (const [g, v] of [
      [2, 900],
      [2.25, 1000],
      [2.5, 1100],
    ]) {
      x.rec.g = g;
      knob(x, v);
    }
    const during = x.ar.writes().length;
    await new Promise((res) => setTimeout(res, 450));
    const w = x.ar.writes();
    t.ok(
      during === 0 && w.length === 1 && w[0].from === 2 && w[0].to === 2.5 && x.ar.touching().length === 0,
      `a key or wheel gesture ends 400 ms after its last step, at that step (${w.map((o) => `${o.from}–${o.to}`).join(', ')})`,
    );
    x.ar.finish({ span: { g0: 0, b0: 0, loop: null, wrap: Infinity }, lastG: 3 }, { cancel: true });
  }
  // round a loop (0–8): a move in each pass; ⌘Z while recording takes the last completed pass's move out
  {
    const x = mk();
    const span = { g0: 0, b0: 0, loop: { start: 0, end: 8 }, wrap: 8 };
    x.rec.where = (g) => passOf(g, span);
    x.recState('rec');
    for (const base of [2, 10]) {
      for (let i = 0; i <= 4; i++) {
        x.rec.g = base + i * 0.25;
        knob(x, 1000 + i * 250 + base * 10);
      }
      await new Promise((res) => setTimeout(res, 450));
    }
    const w = x.ar.writes();
    const out = x.ar.undoPass(1);
    const left = x.ar.writes();
    t.ok(
      w.length === 2 &&
        w[0].pass === 0 &&
        w[1].pass === 1 &&
        w[1].from === 2 &&
        out === 1 &&
        left.length === 1 &&
        left[0].pass === 0,
      `round a loop each pass's move is its own write (passes ${w.map((o) => o.pass).join(', ')}, both at beat ${w.map((o) => o.from).join(' and ')}); ⌘Z while recording takes pass 2's out (${left.length} left)`,
    );
    const f = x.ar.finish({ span, lastG: 12 });
    t.ok(
      f.ops.length === 1 && /^Cutoff, bar 1 \(recorded\)$/.test(f.label),
      `and the commit has what is left ("${f.label}")`,
    );
  }
  // while the song just plays: the move goes through and stays, then Write it into the lane
  {
    const x = mk();
    const s0 = body(x.store);
    for (let i = 0; i <= 20; i++) {
      x.engine.beat = x.engine.gridBeat = 16 + i * 0.1;
      knob(x, 800 + i * 100);
    }
    const afterMove = body(x.store),
      hist = x.store.history.length;
    t.ok(
      afterMove !== s0 &&
        x.store.track(x.tid).instrument.params.cutoff === 2800 &&
        !laneAt(x.store.get(), { track: x.tid, insert: 'instrument', param: 'cutoff' }),
      'with the song just playing, the knob moves as it always did (no lane yet)',
    );
    x.engine.playing = false;
    x.emit('transport', { playing: false });
    const toast = x.toasts.pop();
    // (fresh eyes 5: "Keep that move" read as if the change would be undone, but the +6 dB had already stuck)
    t.ok(
      toast &&
        toast.text === 'Cutoff moved from 800 Hz to 2.8 kHz over bar 5. It stays where you left it.' &&
        toast.o.action?.label === 'Write it into the lane' &&
        x.ar.moves.length === 1,
      `the toast says the move stays where it was left, and offers to write it into the lane: "${toast?.text}" [${toast?.o.action?.label}]`,
    );
    toast.o.action.run();
    const wrote = x.toasts.pop();
    const lane = laneAt(x.store.get(), { track: x.tid, insert: 'instrument', param: 'cutoff' }),
      sp = specFor(x.store.get(), { track: x.tid, insert: 'instrument', param: 'cutoff' }, getDevice);
    t.ok(
      lane &&
        near(valueAt(lane, 17, sp), 1800, 1800 * 0.02) &&
        valueAt(lane, 10, sp) === 800 &&
        valueAt(lane, 30, sp) === 2800 &&
        x.store.history.length === hist + 1 &&
        /\(kept\)$/.test(x.store.history[hist].label),
      `Write it into the lane writes it, after the fact, as a recording would (beat 17: ${valueAt(lane, 17, sp)?.toFixed(0)} Hz; before it 800, after it 2800 holds), one undo step ("${x.store.history[hist]?.label}")`,
    );
    t.ok(
      wrote &&
        wrote.text === 'Written into the lane: Cutoff, bar 5. It plays from the lane now.' &&
        wrote.o.action?.label === 'Undo',
      `and says so: "${wrote?.text}" [${wrote?.o.action?.label}]`,
    );
    t.ok(
      x.store.track(x.tid).instrument.params.cutoff === 800,
      "and the knob's own value goes back to where it was (the lane plays now)",
    );
    x.store.undo();
    t.ok(body(x.store) === afterMove, 'undo of Write it into the lane is exact (the move stays as it was)');
    t.ok(x.ar.keep().ok === false, 'a move is kept once');
  }
}

/* ------------------------------------------------------------------ 2. the studio */
const { page, errors, close, shot } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await page.evaluate(async () => {
    const app = window.overdub;
    await app.engine.start();
    app.ui.setOpen?.('bottom', true);
  });
  const ids = await page.evaluate(() =>
    Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])),
  );
  const tempo = await page.evaluate(() => window.overdub.store.get().tempo);
  const spbMs = 60000 / tempo;
  const beatNow = () => page.evaluate(() => window.overdub.engine.beat);
  async function until(b) {
    for (let i = 0; i < 2000; i++) {
      const x = await beatNow();
      if (x >= b - 0.015) return x;
      await page.waitForTimeout(Math.max(1, Math.min(250, (b - x) * spbMs - 25)));
    }
    return null;
  }
  const state = () => page.evaluate(() => window.overdub.input.recorder.state);
  async function idle() {
    for (let i = 0; i < 100 && (await state()) !== 'idle'; i++) await page.waitForTimeout(50);
    await page.waitForTimeout(80);
  }
  const lastToast = () =>
    page.evaluate(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');
  // what the page saw: every pointer event on a knob or the fader, with its audible beat
  await page.evaluate(() => {
    window.__pm = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup'])
      window.addEventListener(
        type,
        (e) => {
          const en = window.overdub.engine;
          window.__pm.push({ type, beat: en.playing ? en.beatAt(e.timeStamp) : null, ts: e.timeStamp });
        },
        true,
      );
  });
  const ADDR = { track: ids.Bass, insert: 'instrument', param: 'cutoff' };
  const laneOf = (addr) =>
    page.evaluate((a) => {
      const l = window.overdub.store.get().tracks.find((x) => x.id === a.track);
      const host = a.insert ? l.instrument : l;
      return host.auto?.[a.param] || null;
    }, addr);

  // the Bass's knobs in the rack; a flat cutoff lane to hand back to
  await page.evaluate((b) => {
    const app = window.overdub;
    app.ui.select({ track: b });
    app.ui.show('rack');
    app.store.dispatch(
      [
        { type: 'project.set', patch: { loop: { on: false, start: 0, end: 32 } } },
        { type: 'auto.write', track: b, insert: 'instrument', param: 'cutoff', points: '0:600 64:600' },
      ],
      { by: 'you', label: 'setup' },
    );
    app.engine.seek(0);
  }, ids.Bass);
  await page.waitForTimeout(300);
  const dial = page.locator('.rk-card .kn[data-key="cutoff"] .kn-dial').first();
  await dial.scrollIntoViewIfNeeded();
  const box = await dial.boundingBox();
  t.ok(!!box, `the Bass's cutoff knob is on screen (${box ? Math.round(box.width) + ' px' : 'missing'})`);
  const before = await page.evaluate(() => JSON.stringify({ ...window.overdub.store.get(), meta: null }));
  const hist0 = await page.evaluate(() => window.overdub.store.history.length);
  const stat0 = await page.evaluate((a) => window.overdub.store.track(a.track).instrument.params.cutoff, ADDR);

  /* ---- R, then a slow drag up on the knob from beat 2, held, let go at 5 */
  await page.evaluate(() => window.overdub.input.recorder.record({ countIn: 0 }));
  await until(2);
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const seen = [];
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(cx, cy - i * 2.5);
    await page.waitForTimeout(28);
    if (i % 3 === 0)
      seen.push(
        await page.evaluate(
          (a) => ({
            beat: window.overdub.engine.beat,
            v: +document.querySelector('.rk-card .kn[data-key="cutoff"] .kn-dial').getAttribute('aria-valuenow'),
            hist: window.overdub.store.history.length,
            off: window.overdub.store.track(a.track).instrument.auto?.cutoff?.off === true,
            stat: window.overdub.store.track(a.track).instrument.params.cutoff,
            writing: window.overdub.input.autorec.touching().length,
          }),
          ADDR,
        ),
      );
  }
  const mid = seen[Math.floor(seen.length / 2)];
  t.ok(
    seen.every((x) => x.hist === hist0) && mid.off && Math.abs(mid.stat - mid.v) < 1 && mid.writing === 1,
    `while it records, the drag is held and heard (lane held, ${Math.round(mid.stat)} Hz playing, the knob at ${Math.round(mid.v)} Hz) and nothing reaches the history (${seen[0].hist - hist0} steps)`,
  );
  await until(5);
  await page.mouse.up();
  const upBeat = await page.evaluate(() => window.__pm.filter((x) => x.type === 'pointerup').pop()?.beat);
  await page.waitForTimeout(60);
  const pv = await laneOf(ADDR);
  t.ok(
    pv && !pv.off && pv.points.length > 3,
    `let go, the lane is back on and already plays the pass (a preview, ${pv?.points.length} points)`,
  );
  await until(7);
  await shot('autorec-recording');
  await page.evaluate(() => window.overdub.input.recorder.stop());
  await idle();
  const after = await page.evaluate((a) => {
    const app = window.overdub,
      last = app.input.recorder.last,
      h = app.store.history;
    return {
      last: { ok: last?.ok, label: last?.label, summary: last?.summary, lanes: last?.lanes },
      hist: h.length,
      top: h[h.length - 1] && {
        by: h[h.length - 1].by,
        label: h[h.length - 1].label,
        ops: h[h.length - 1].ops.map((o) => o.type),
      },
      stat: app.store.track(a.track).instrument.params.cutoff,
    };
  }, ADDR);
  const lane = await laneOf(ADDR);
  t.ok(
    after.hist === hist0 + 1 &&
      after.top.by === 'you' &&
      /^Cutoff, bars? [\d–]+ \(recorded\)$/.test(after.top.label) &&
      after.top.ops.every((x) => x === 'auto.write'),
    `the take is one undo step by you: "${after.top?.label}" (${after.top?.ops.join(', ')})`,
  );
  t.ok(
    after.stat === stat0 && lane && !lane.off && lane.by === 'you',
    `the knob's own value is untouched (${after.stat} Hz); the lane is yours, playing`,
  );
  t.ok(
    /^Recorded into its lane: Cutoff, bars? [\d–]+\. Undo takes it back\./.test(await lastToast()),
    `the toast says so: "${await lastToast()}"`,
  );
  // read back: where the page saw each move, the lane has the knob's value (in its travel)
  const spec = { min: 40, max: 8000, curve: 'log' };
  const errs = seen.map((x) => {
    const lv = valueAt(lane.points, x.beat, spec);
    return Math.abs(toPos(spec, lv) - toPos(spec, x.v));
  });
  const worst = Math.max(...errs);
  t.ok(
    worst < 0.025,
    `the lane reads back the gesture: ${seen.length} samples within ${(worst * 100).toFixed(2)}% of the knob's travel (2.5% allowed; thinned to ${lane.points.length} points)`,
  );
  const first = lane.points[0],
    last = lane.points[lane.points.length - 1];
  const glide = (GLIDE_S * tempo) / 60;
  t.ok(
    valueAt(lane.points, 1, spec) === 600 && valueAt(lane.points, 20, spec) === 600 && first.t === 0 && last.t === 64,
    `outside the touched span nothing moved (beat 1 and 20: 600 Hz; still 0–64)`,
  );
  const vUp = valueAt(lane.points, upBeat - 0.02, spec),
    vHalf = valueAt(lane.points, upBeat + glide / 2, spec),
    vBack = valueAt(lane.points, upBeat + glide + 0.02, spec);
  t.ok(
    vUp > 1000 && vHalf < vUp && vHalf > 600 && near(vBack, 600, 1e-6),
    `letting go at beat ${upBeat?.toFixed(3)} glides back to the lane over 200 ms (${glide.toFixed(3)} beats): ${Math.round(vUp)} → ${Math.round(vHalf)} → ${Math.round(vBack)} Hz`,
  );
  const held = seen[seen.length - 1];
  t.ok(
    near(valueAt(lane.points, (held.beat + upBeat) / 2, spec), held.v, held.v * 0.03),
    `held still after the drag, the last value runs to the let-go (${Math.round(valueAt(lane.points, (held.beat + upBeat) / 2, spec))} Hz)`,
  );
  await page.evaluate(() => window.overdub.store.undo());
  const undone = await page.evaluate(() => JSON.stringify({ ...window.overdub.store.get(), meta: null }));
  t.ok(undone === before, 'undo takes the take back out exactly');

  /* ---- a fader in the mixer while R records: the level lane */
  await page.evaluate(() => {
    const app = window.overdub;
    app.ui.show('mixer');
    app.engine.seek(8);
  });
  await page.waitForTimeout(300);
  const fader = page.locator(`.mx-strip[data-track="${ids.Keys}"] .mx-thumb`).first();
  const fb = await fader.boundingBox();
  const g0 = await page.evaluate((k) => window.overdub.store.track(k).gain, ids.Keys);
  await page.evaluate(() => window.overdub.input.recorder.record({ countIn: 0 }));
  await until(9);
  if (fb) {
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2 + i * 4);
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
  }
  await until(11);
  await page.evaluate(() => window.overdub.input.recorder.stop());
  await idle();
  const gl = await laneOf({ track: ids.Keys, param: 'gain' });
  const gt = await page.evaluate(
    (k) => ({ g: window.overdub.store.track(k).gain, label: window.overdub.store.history.slice(-1)[0]?.label }),
    ids.Keys,
  );
  const gmin = gl ? Math.min(...gl.points.map((x) => x.v)) : null;
  t.ok(
    fb &&
      gl &&
      gmin < g0 - 6 &&
      gt.g === g0 &&
      /^Keys level, bars? [\d–]+ \(recorded\)$/.test(gt.label) &&
      gl.points[gl.points.length - 1].v === gmin,
    `a fader drag while it records writes the level lane (${gl?.points.length} points, down to ${gmin?.toFixed(1)} dB; no lane before, so the last value holds), and the fader's own level stays ${g0} dB ("${gt.label}")`,
  );
  await page.evaluate(() => window.overdub.store.undo());

  /* ---- the song just playing: the move stays, and Write it into the lane */
  await page.evaluate(() => {
    const app = window.overdub;
    app.ui.show('rack');
    app.engine.seek(16);
    app.engine.play();
  });
  await page.waitForTimeout(400);
  const kb = await dial.boundingBox();
  const hist1 = await page.evaluate(() => window.overdub.store.history.length);
  await until(17);
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2 - i * 3);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
  const moved = await page.evaluate(
    (a) => ({
      hist: window.overdub.store.history.length,
      stat: window.overdub.store.track(a.track).instrument.params.cutoff,
      lane: window.overdub.store.track(a.track).instrument.auto?.cutoff?.points?.length ?? 0,
    }),
    ADDR,
  );
  const offer = await page.evaluate(() => {
    const x = [...document.querySelectorAll('.ew-toast')].filter((e) => /moved from/.test(e.textContent)).pop();
    return {
      text: x?.querySelector('.ew-toast-text')?.textContent || '',
      act: x?.querySelector('.ew-toast-act')?.textContent || '',
    };
  });
  t.ok(
    moved.hist === hist1 + 1 && moved.stat > stat0,
    `with the song just playing, the knob moves the song as always (one step; ${Math.round(moved.stat)} Hz)`,
  );
  t.ok(
    /^Cutoff moved from 600 Hz to [\d.]+ k?Hz over bars? [\d–]+\. It stays where you left it\.$/.test(offer.text) &&
      offer.act === 'Write it into the lane',
    `and the toast says it stays where you left it, offering to write it into the lane: "${offer.text}" [${offer.act}]`,
  );
  await shot('autorec-keep');
  const keepBtn = page.locator('.ew-toast .ew-toast-act', { hasText: 'Write it into the lane' }).last();
  await keepBtn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(100);
  const kept = await page.evaluate((a) => {
    const app = window.overdub,
      h = app.store.history;
    return {
      hist: h.length,
      label: h[h.length - 1]?.label,
      stat: app.store.track(a.track).instrument.params.cutoff,
      lane: app.store.track(a.track).instrument.auto?.cutoff || null,
      moves: app.input.autorec.moves.map((m) => ({ kept: m.kept, to: m.to })),
    };
  }, ADDR);
  const km = kept.moves[kept.moves.length - 1];
  const kpts = kept.lane?.points || [];
  t.ok(
    kept.hist === hist1 + 2 &&
      /^Cutoff, bars? [\d–]+ \(kept\)$/.test(kept.label) &&
      kept.lane &&
      !kept.lane.off &&
      kpts.length >= 3 &&
      km?.kept,
    `Write it into the lane writes the move into the lane after the fact (${kpts.length} points, "${kept.label}")`,
  );
  t.ok(
    kept.stat === stat0 && kpts.length && Math.abs(Math.max(...kpts.map((x) => x.v)) - km.to) < 1,
    `as a recording would: up to ${Math.round(km?.to)} Hz in the lane, the knob's own value back at ${stat0} Hz (${kept.stat})`,
  );
  await page.evaluate(() => window.overdub.engine.stop());

  /* ---- heard: a probe (an effect whose output is its knob's value as DC) on a lane at 0.2, recorded over */
  const { PROBE } = await import('./probe-kernel.js');
  const pid = await page.evaluate(async (PROBE) => {
    const app = window.overdub;
    (await import('/app/src/devices/registry.js')).defineDevice(PROBE, { replace: true });
    const r = app.store.dispatch(
      [
        { type: 'project.set', patch: { loop: { on: true, start: 0, end: 8 } } },
        { type: 'track.add', ref: 'p', track: { name: 'Probe', kind: 'audio' } },
        { type: 'insert.add', track: '$p', ref: 'f', insert: { device: 'test.probe' } },
      ],
      { by: 'you', label: 'probe' },
    );
    if (!r.ok) throw new Error(r.error);
    const tid = r.created.p,
      fx = r.created.f;
    app.store.dispatch(
      { type: 'auto.write', track: tid, insert: fx, param: 'v', points: '0:0.2 8:0.2' },
      { by: 'you' },
    );
    app.ui.select({ track: tid });
    app.ui.show('rack');
    app.engine.seek(0);
    await new Promise((res) => setTimeout(res, 400));
    const inst = app.engine.instance(tid, fx),
      ctx = app.engine.ctx;
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.channelCount = 1;
    an.channelCountMode = 'explicit';
    an.channelInterpretation = 'discrete'; // (the left channel: the probe's v)
    inst.output.connect(an);
    const buf = new Float32Array(512);
    window.__dc = () => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x;
      return s / buf.length;
    };
    return { tid, fx };
  }, PROBE);
  const pdial = page.locator('.rk-card .kn[data-key="v"] .kn-dial').first();
  await pdial.scrollIntoViewIfNeeded();
  const pb = await pdial.boundingBox();
  await page.evaluate(() => window.overdub.input.recorder.record({ countIn: 0 }));
  await until(1);
  const dc0 = await page.evaluate(() => window.__dc());
  const heard = [];
  if (pb) {
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2 - i * 4);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(150);
    heard.push(
      await page.evaluate(() => ({
        dc: window.__dc(),
        v: +document.querySelector('.rk-card .kn[data-key="v"] .kn-dial').getAttribute('aria-valuenow'),
        beat: window.overdub.engine.beat,
      })),
    );
    await until(3);
    await page.mouse.up();
  }
  await page.waitForTimeout(700);
  const dcBack = await page.evaluate(() => ({ dc: window.__dc(), beat: window.overdub.engine.beat }));
  // the next pass plays what this one wrote (beats 2-3: the knob's last value, held)
  // (between the drag's end and the let-go the knob held still at h.v: read the next pass in the middle of that)
  const at = 8 + Math.min(2.8, ((heard[0]?.beat ?? 2.4) + 3) / 2);
  for (let i = 0; i < 600; i++) {
    const b = await page.evaluate(() => window.overdub.engine.gridBeat);
    if (b >= at) break;
    await page.waitForTimeout(15);
  }
  const dcNext = await page.evaluate(
    (p) => ({
      dc: window.__dc(),
      beat: window.overdub.engine.beat,
      lane: window.overdub.store.track(p.tid).inserts[0].auto?.v?.points || [],
    }),
    pid,
  );
  const wantNext = valueAt(dcNext.lane, dcNext.beat, { min: 0, max: 1 });
  await page.evaluate(() => window.overdub.input.recorder.stop());
  await idle();
  const h = heard[0];
  t.ok(
    near(dc0, 0.2, 0.005) && h && near(h.dc, h.v, 0.01) && h.v > 0.4,
    `heard while it records: the lane plays 0.2 (${dc0.toFixed(3)}), then the hand on the knob does (${h?.dc.toFixed(3)} out, the knob at ${h?.v})`,
  );
  t.ok(
    near(dcBack.dc, 0.2, 0.01),
    `let go, the lane plays again (${dcBack.dc.toFixed(3)} at beat ${dcBack.beat.toFixed(2)})`,
  );
  t.ok(
    h && dcNext.lane.length > 2 && near(dcNext.dc, wantNext, 0.02) && wantNext > 0.25,
    `and the next loop pass plays what the last one wrote (${dcNext.dc.toFixed(3)} at beat ${dcNext.beat.toFixed(2)}; the written lane says ${wantNext?.toFixed(3)} there)`,
  );

  t.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally {
  await close();
}
t.done();
