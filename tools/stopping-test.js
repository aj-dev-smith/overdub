// A polite stop (app/src/engine/engine.js, "Stop" and "The polite stop"; docs/FRESH-EYES-2.md problem 9).
//   1. Every demo song, stopped mid-play: what was sounding rings on for a moment (the tail is not cut), then whatever
//      still rings fades and the effects are renewed, so the speakers are below -60 dBFS within 3.5 s of Stop. Halation
//      is stopped three times (its delay and long pad releases rang for 10 s and more).
//   2. The polite stop leaves live playing alone: a key played after Stop keeps sounding through the fade; Play during
//      the fade brings the song straight back. The killswitch stays instant (tools/silence-test.js holds it to 50 ms).
//   3. Night Shift's Keys chain (Night Bus) is silent while stopped: its cassette hiss stops with the tape (it put a
//      constant -62 dBFS of pink hiss, most of it under 60 Hz, on the Keys strip). Offline, playing, nothing moved
//      (tools/golden-test.js pins it).
//   4. With the loop off, playback stops by itself a bar after the song's last note and goes back to the marker,
//      unless a take is recording; a play started past the end runs on (you are about to record there).
//   5. A stop stops only what was asked: the song's end, an agent's stop or an agent's play over the song leave the
//      chord the musician holds sounding (their own Stop lets it go); a play waiting on the killswitch's renew loses to
//      the killswitch again, to Space again and to cancelling R's count; an agent's play doesn't stop a take begun
//      over it, nor the musician's own playback once they take the transport; a monitored guitar coming back in during
//      the polite fade is left alone.
//   6. In 7/8 the click starts every bar and a 1-bar count-in is one bar (3.5 beats).
//
//   node tools/stopping-test.js
import { open, tally } from './pw.js';
import { MORE_DEMOS } from '../app/src/core/demos/index.js';

const t = tally('stopping');
const { page, errors, close } = await open('/app/', { query: 'new&autostart' });
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
await page.evaluate(async () => {
  window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
  // the peak of every render quantum a node sends, with its audio time: [[time, peak], ...] until stop()
  window.__peaks = async (ctx, node) => {
    // ('stop-pk', from a file on the studio's origin: its policy refuses a worklet made from a string)
    if (!ctx.__pk) ctx.__pk = ctx.audioWorklet.addModule('/tools/test-worklets.js');
    await ctx.__pk;
    const cap = new AudioWorkletNode(ctx, 'stop-pk', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    const rows = [];
    let done = null;
    cap.port.onmessage = (e) => {
      if (e.data === 'end') done && done();
      else rows.push(e.data);
    };
    const z = ctx.createGain();
    z.gain.value = 0;
    cap.connect(z);
    z.connect(ctx.destination);
    node.connect(cap);
    return {
      rows,
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
            res(rows);
          };
          cap.port.postMessage('stop');
        }),
    };
  };
  // the loudest quantum in [a, b) (audio times), in dBFS
  window.__over = (rows, a, b) => window.__db(rows.reduce((m, [tt, p]) => (tt >= a && tt < b && p > m ? p : m), 0));
  // seconds after t that the capture was last over thr dBFS (0: never)
  window.__last = (rows, t, thr) => {
    const g = Math.pow(10, thr / 20);
    let last = t;
    for (const [tt, p] of rows) if (tt >= t && p > g) last = tt;
    return last - t;
  };
  await window.overdub.engine.start();
});

// ------------------------------------------------------------------------------------------------ 1. every demo
const stopAt = async (id, from, playMs) =>
  page.evaluate(
    async ({ id, from, playMs }) => {
      const { store, engine } = window.overdub;
      const { demoById } = await import('/app/src/core/demo.js');
      store.load(demoById(id), { by: 'overdub' });
      await engine.settled();
      engine.metronome = false;
      const p = store.get(),
        ctx = engine.ctx;
      const c = await window.__peaks(ctx, engine._monitor);
      const beat = Math.round(p.loop.end * from);
      await engine.play(beat);
      await window.__sleep(playMs);
      const tStop = ctx.currentTime;
      engine.stop();
      await window.__sleep(5200);
      const rows = await c.stop();
      return {
        title: p.title,
        beat,
        playing: window.__over(rows, tStop - 0.5, tStop),
        at05: window.__over(rows, tStop + 0.4, tStop + 0.6),
        at15: window.__over(rows, tStop + 1.4, tStop + 1.6),
        at3: window.__over(rows, tStop + 2.9, tStop + 3.1),
        after35: window.__over(rows, tStop + 3.5, tStop + 5.2),
        last: window.__last(rows, tStop, -60),
      };
    },
    { id, from, playMs },
  );

const runs = [];
for (const d of [{ id: 'night-shift', title: 'Night Shift' }, ...MORE_DEMOS]) runs.push([d.id, 0.5, 2500]);
runs.push(['halation', 0.1, 3000], ['halation', 0.8, 2000]);
for (const [id, from, ms] of runs) {
  const r = await stopAt(id, from, ms);
  const f = (x) => x.toFixed(1);
  t.note(
    `${r.title} from beat ${r.beat}: ${f(r.playing)} dBFS playing; after Stop ${f(r.at05)} at 0.5 s, ${f(r.at15)} at 1.5 s, ${f(r.at3)} at 3 s, ${f(r.after35)} from 3.5 s on`,
  );
  t.ok(
    r.playing > -30 && r.last <= 3.5 && r.after35 <= -60,
    `${r.title} (stopped at beat ${r.beat} + ${ms / 1000} s): below -60 dBFS ${r.last.toFixed(2)} s after Stop (from 3.5 s on: ${f(r.after35)} dBFS)`,
  );
}
// the tail is still natural for a moment: Halation's delay and pad keep ringing after Stop, they are not cut
{
  const r = await stopAt('halation', 0.1, 3000);
  t.ok(
    r.at05 > -45 && r.at15 > -60,
    `Halation's tail rings on after Stop (${r.at05.toFixed(1)} dBFS at 0.5 s, ${r.at15.toFixed(1)} at 1.5 s), then goes (${r.after35.toFixed(1)} from 3.5 s)`,
  );
}

// ------------------------------------------------------------------------------------------------ 2. live playing
const live = await page.evaluate(async () => {
  const { store, engine } = window.overdub;
  const { demoById } = await import('/app/src/core/demo.js');
  store.load(demoById('halation'), { by: 'overdub' });
  await engine.settled();
  const p = store.get(),
    ctx = engine.ctx;
  const pad = p.tracks.find((x) => x.name === 'Pad'),
    glide = p.tracks.find((x) => x.name === 'Glide');
  await engine.play(4);
  await window.__sleep(2500);
  engine.stop();
  await window.__sleep(1200);
  const inst0 = engine.instance(pad.id),
    glide0 = engine.instance(glide.id);
  engine.liveNoteOn(pad.id, 64, 0.9); // a key held from 1.2 s after Stop, through the fade and past it
  await window.__sleep(2600);
  const v = await engine.voices();
  const held = {
    same: engine.instance(pad.id) === inst0,
    peak: v[pad.id].peak,
    meter: engine.meters.tracks[pad.id].peak,
  };
  engine.liveNoteOff(pad.id, 64);
  const glideRenewed = engine.instance(glide.id) !== glide0;
  // Play during the fade: the song comes straight back
  await window.__sleep(3000);
  await engine.play(4);
  await window.__sleep(2500);
  engine.stop();
  await window.__sleep(2300); // inside the fade (2 s ring, 1 s fade)
  const c = await window.__peaks(ctx, engine._monitor);
  const tPlay = ctx.currentTime;
  await engine.play(4);
  await window.__sleep(1500);
  const rows = await c.stop();
  engine.stop();
  return { held, glideRenewed, back: window.__over(rows, tPlay + 0.6, tPlay + 1.5), silencing: engine.silencing };
});
t.ok(
  live.held.same && live.held.peak > -40,
  `a key played on the Pad 1.2 s after Stop keeps sounding through the polite stop (same instrument, ${live.held.peak.toFixed(1)} dBFS at 3.8 s), while the rest is renewed (Glide: ${live.glideRenewed})`,
);
t.ok(live.glideRenewed, 'the tracks that rang were renewed (fresh devices: their tails are gone with the old ones)');
t.ok(live.back > -30, `Play during the fade brings the song straight back (${live.back.toFixed(1)} dBFS from 0.6 s)`);

// ------------------------------------------------------------------------------------------------ 3. Night Bus
const nb = await page.evaluate(async () => {
  const { store, engine } = window.overdub;
  const { demoById } = await import('/app/src/core/demo.js');
  store.load(demoById('night-shift'), { by: 'overdub' });
  await engine.settled();
  const keys = store.get().tracks.find((x) => x.name === 'Keys');
  const fx = keys.inserts.find((x) => x.device === 'claude.night-bus');
  const ctx = engine.ctx,
    inst = engine.instance(keys.id, fx.id);
  const c = await window.__peaks(ctx, inst.output);
  await engine.play(0);
  await window.__sleep(2000);
  engine.stop();
  const tStop = ctx.currentTime;
  await window.__sleep(4000);
  const rows = await c.stop();
  // the strip's own meter, stopped: what the tester read as a constant offset
  const meter = engine.meters.tracks[keys.id].peak;
  return { stopped: window.__over(rows, tStop + 1, tStop + 4), meter };
});
t.ok(
  nb.stopped <= -100 && nb.meter <= -100,
  `Night Bus is silent while stopped: ${nb.stopped.toFixed(1)} dBFS out of the device from 1 s after Stop, the Keys meter at ${nb.meter.toFixed(1)}`,
);

// ------------------------------------------------------------------------------------------------ 4. the song's end
const end = await page.evaluate(async () => {
  const { store, engine } = window.overdub;
  store.load(
    {
      format: 'overdub/0',
      id: 'p_ends01',
      title: 'Ends',
      tempo: 240,
      meter: [4, 4],
      key: null,
      loop: { on: false, start: 0, end: 8 },
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
              notes: [
                { id: 'n1', p: 60, t: 0, d: 1, v: 0.8 },
                { id: 'n2', p: 64, t: 4, d: 1.5, v: 0.8 },
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
    },
    { by: 'overdub' },
  );
  await engine.settled();
  const app = window.overdub;
  app.transport.marker.set(4);
  await window.__sleep(50);
  const stops = [];
  const off = engine.on('transport', (e) => {
    if (e.why === 'stop') stops.push(e.beat);
  });
  // the last note ends at beat 5.5: the song ends at bar 3 (beat 8), and playback a bar later (beat 12): 2 s at 240 bpm
  const t0 = performance.now();
  await engine.play(4);
  while (engine.playing && performance.now() - t0 < 4000) await window.__sleep(20);
  const ranFor = (performance.now() - t0) / 1000,
    stoppedAt = stops[0];
  await window.__sleep(100);
  const backAt = engine.beat,
    marker = app.transport.marker.beat;
  // recording: it runs on
  stops.length = 0;
  await engine.play(4);
  engine.recording = true;
  await window.__sleep(2600);
  const recPlaying = engine.playing,
    recBeat = engine.beat;
  engine.stop();
  // from past the end: it runs on
  await engine.play(16);
  await window.__sleep(800);
  const pastPlaying = engine.playing;
  engine.stop();
  // the loop on: it wraps as before
  store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 0, end: 8 } } }, { by: 'you' });
  await engine.play(0);
  await window.__sleep(2600);
  const loopPlaying = engine.playing;
  engine.stop();
  off();
  return { ranFor, stoppedAt, backAt, marker, recPlaying, recBeat, pastPlaying, loopPlaying };
});
t.ok(
  end.stoppedAt >= 11.9 && end.stoppedAt <= 12.3 && end.ranFor < 2.6,
  `loop off: playback stops by itself a bar after the last note (at beat ${end.stoppedAt?.toFixed(2)}, ${end.ranFor.toFixed(2)} s after Play from beat 4)`,
);
t.ok(
  Math.abs(end.backAt - 4) < 1e-6 && end.marker === 4,
  `and goes back to the marker (beat ${end.backAt}, the marker at ${end.marker})`,
);
t.ok(end.recPlaying && end.recBeat > 12, `recording, it runs on past the end (beat ${end.recBeat.toFixed(1)})`);
t.ok(end.pastPlaying, 'a play started past the end runs on');
t.ok(end.loopPlaying, 'with the loop on, the loop wraps as before');

// ------------------------------------------------------------------------------------------------ 5. only what was asked
// (docs/FRESH-EYES-2.md wave: an agent's play timer cut a take; a play waiting on a renew beat Stop and the killswitch;
// the song's end and an agent's stop cut the chord the musician held; the polite stop faded a guitar that came back in)
const only = await page.evaluate(async () => {
  const { store, engine, input, ui, transport, tools } = window.overdub;
  const w = window.__sleep,
    out = {};
  const tr = (id, dev, clips = []) => ({
    id,
    name: id,
    kind: 'instrument',
    instrument: { device: dev, params: {} },
    inserts: [],
    gain: -6,
    pan: 0,
    mute: false,
    solo: false,
    clips,
  });
  const base = (id, tracks) => ({
    format: 'overdub/0',
    id,
    title: id,
    tempo: 120,
    meter: [4, 4],
    key: null,
    loop: { on: false, start: 0, end: 16 },
    tracks,
    sections: [],
    devices: {},
    assets: {},
    master: { gain: -6, inserts: [] },
    meta: {},
  });
  // the keys the musician holds: the song's end, an agent's stop, an agent's play over the song
  store.load(
    base('p_stop5a', [
      tr('t_a', 'core.pad', [
        { id: 'ca', kind: 'notes', start: 0, length: 4, notes: [{ id: 'n1', p: 60, t: 0, d: 4, v: 0.8 }] },
      ]),
    ]),
    { by: 'overdub' },
  );
  await engine.settled();
  engine.metronome = false;
  const held = async () => (await engine.voices()).t_a?.held ?? -1;
  await engine.play(0);
  await w(2500);
  engine.liveNoteOn('t_a', 48);
  engine.liveNoteOn('t_a', 55);
  for (let i = 0; i < 60 && engine.playing; i++) await w(100);
  await w(300);
  out.end = { playing: engine.playing, held: await held() };
  engine.liveNoteOff('t_a', 48);
  engine.liveNoteOff('t_a', 55);
  await w(600);
  out.endLetGo = await held();
  engine.liveNoteOn('t_a', 60);
  await w(200);
  await tools.run('stop', {}, { by: 'claude' });
  await w(400);
  out.agentStop = await held();
  engine.liveNoteOff('t_a', 60);
  await w(600);
  await engine.play(0);
  await w(300);
  engine.liveNoteOn('t_a', 64);
  await w(200);
  out.over = await held();
  await tools.run('play', { from: 0, to: 4 }, { by: 'claude' });
  await w(500);
  out.agentPlay = await held();
  engine.stop();
  await w(500);
  out.ownStop = await held();
  engine.liveNoteOff('t_a', 64);
  await w(1200);
  // an agent's play, then R while it plays: the take runs on past the play's end; Space twice: the musician's playback
  store.load(base('p_stop5b', [tr('t_k', 'core.keys')]), { by: 'overdub' });
  await engine.settled();
  ui.select({ track: 't_k' });
  engine.stop();
  await w(200);
  const r = await tools.run('play', { bars: [1, 2] }, { by: 'claude' });
  await w(1000);
  transport.record();
  const states = [];
  for (let i = 0; i < 24; i++) {
    input.noteOn('midi:t', 60 + (i % 5), 0.8, 'midi');
    await w(120);
    input.noteOff('midi:t', 60 + (i % 5), 'midi');
    await w(100);
    states.push((input.recorder.state === 'rec' ? 'R' : input.recorder.state[0]) + (engine.playing ? '' : '.'));
  }
  out.take = {
    secs: r.seconds ?? r.error,
    states: states.join(''),
    rec: input.recorder.state,
    playing: engine.playing,
  };
  await input.recorder.stop();
  engine.stop();
  await w(300);
  await tools.run('play', { bars: [1, 2] }, { by: 'claude' });
  await w(1000);
  transport.playStop();
  await w(50);
  transport.playStop();
  await w(4000);
  out.takeover = engine.playing;
  engine.stop();
  // a play waiting on a renew: (a) the killswitch again, (b) Space again, (c) R's count cancelled
  store.load(
    base('p_stop5a', [
      tr('t_a', 'core.pad', [
        { id: 'ca', kind: 'notes', start: 0, length: 4, notes: [{ id: 'n1', p: 60, t: 0, d: 4, v: 0.8 }] },
      ]),
    ]),
    { by: 'overdub' },
  );
  await engine.settled();
  await engine.play(0);
  await w(300);
  engine.silence();
  const pa = transport.playStop();
  await w(20);
  const sa = engine.silence();
  await Promise.all([pa, sa]);
  await w(200);
  out.a = engine.playing;
  await engine.play(0);
  await w(300);
  const sb = engine.silence();
  const pb = transport.playStop();
  out.waiting = engine.starting;
  await w(5);
  transport.playStop();
  await Promise.all([pb, sb]);
  await w(300);
  out.b = engine.playing;
  ui.select({ track: 't_a' });
  const sc = engine.silence();
  input.recorder.record();
  await w(5);
  out.cState = input.recorder.state;
  input.recorder.cancel();
  await sc;
  await w(300);
  out.c = { playing: engine.playing, rec: input.recorder.state };
  // a monitored guitar through a 20 s reverb comes back 2.3 s after Stop, as the fade starts
  store.load(
    base('p_stop5c', [
      {
        id: 't_g',
        name: 'Gtr',
        kind: 'audio',
        instrument: null,
        inserts: [{ id: 'i_v', device: 'core.verb', params: { decay: 20, mix: 0.6 } }],
        gain: 0,
        pan: 0,
        mute: false,
        solo: false,
        clips: [],
      },
      tr('t_k', 'core.keys', [
        { id: 'ck', kind: 'notes', start: 0, length: 4, notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8 }] },
      ]),
    ]),
    { by: 'overdub' },
  );
  await engine.settled();
  await w(1600);
  const ctx = engine.ctx,
    node = engine.inputNode('t_g');
  const osc = ctx.createOscillator();
  osc.frequency.value = 196;
  const gate = ctx.createGain();
  gate.gain.value = 1;
  osc.connect(gate);
  gate.connect(node);
  osc.start();
  await engine.play(0);
  await w(1500);
  const playing = engine.meters.tracks.t_g?.peak ?? -120;
  gate.gain.setValueAtTime(0, ctx.currentTime);
  const g0 = engine.instance('t_g', 'i_v');
  engine.stop();
  const t0 = performance.now();
  await w(2300);
  gate.gain.setValueAtTime(1, ctx.currentTime);
  let low = 0;
  while (performance.now() - t0 < 4000) {
    await w(40);
    if (performance.now() - t0 > 2450) low = Math.min(low, engine.meters.tracks.t_g?.peak ?? -120);
  }
  out.gtr = { playing, low, renewed: engine.instance('t_g', 'i_v') !== g0 };
  osc.stop();
  gate.disconnect();
  return out;
});
t.ok(
  only.end.held === 2 && !only.end.playing && only.endLetGo === 0,
  `the song's end stops the transport and the chord the musician is holding plays on (${only.end.held} held after the stop; ${only.endLetGo} once let go)`,
);
t.ok(only.agentStop === 1, `an agent's stop leaves a held key sounding (${only.agentStop} held)`);
t.ok(
  only.over === 2 && only.agentPlay === 2,
  `an agent's play over the song keeps the musician's key (held ${only.over} before, ${only.agentPlay} after: theirs and the song's chased note)`,
);
t.ok(only.ownStop === 0, `the musician's own Stop still lets everything go (${only.ownStop} held)`);
t.ok(
  only.a === false,
  'the killswitch, Play while it renews, the killswitch again: stopped (the waiting play never starts)',
);
t.ok(
  only.waiting === true && only.b === false,
  `Play while the killswitch renews, then Space again: stopped (engine.starting while it waited: ${only.waiting})`,
);
t.ok(
  only.cState === 'count' && !only.c.playing && only.c.rec === 'idle',
  `R while the killswitch renews, then cancelling the count: nothing plays (${JSON.stringify(only.c)})`,
);
t.ok(
  /^c*R+$/.test(only.take.states) &&
    /^R{8}$/.test(only.take.states.slice(-8)) &&
    only.take.playing &&
    only.take.rec === 'rec',
  `an agent's ${only.take.secs} s play, R while it plays: the take runs on past the play's end (${only.take.states}: c count, R rec, '.' stopped)`,
);
t.ok(
  only.takeover === true,
  "an agent's play, then Space twice (the musician takes the transport over): their playback runs on past the agent's end",
);
t.ok(
  only.gtr.playing > -30 && only.gtr.low > -12 && !only.gtr.renewed,
  `a monitored guitar that comes back in 2.3 s after Stop is not faded or renewed under the player (${only.gtr.playing.toFixed(1)} dBFS playing, lowest ${only.gtr.low.toFixed(1)} from 2.45 s)`,
);

// ------------------------------------------------------------------------------------------------ 6. the click in 7/8
// every bar starts on an accented click, and a 1-bar count-in is one bar (3.5 beats), not four quarters
const odd = await page.evaluate(async () => {
  const { store, engine, input, ui, transport } = window.overdub;
  const w = window.__sleep;
  store.load(
    {
      format: 'overdub/0',
      id: 'p_stop6',
      title: 'Seven',
      tempo: 120,
      meter: [7, 8],
      key: null,
      loop: { on: false, start: 0, end: 14 },
      tracks: [
        {
          id: 't_k',
          name: 'Keys',
          kind: 'instrument',
          instrument: { device: 'core.keys', params: {} },
          inserts: [],
          gain: -6,
          pan: 0,
          mute: false,
          solo: false,
          clips: [],
        },
      ],
      sections: [],
      devices: {},
      assets: {},
      master: { gain: -6, inserts: [] },
      meta: {},
    },
    { by: 'overdub' },
  );
  await engine.settled();
  await w(1600);
  ui.select({ track: 't_k' });
  const ctx = engine.ctx;
  const c = await window.__peaks(ctx, engine._monitor);
  const was = engine.click;
  engine.click = { on: true, level: 0 };
  transport.marker.set(3.5);
  input.recorder.setCountIn(1);
  input.recorder.record();
  await w(300);
  const k = engine.counting && {
    beats: engine.counting.beats,
    from: engine.counting.from,
    until: engine.counting.until,
  };
  await w(4000);
  const t0 = engine.ctx.currentTime;
  input.recorder.cancel();
  const rows = await c.stop();
  engine.click = was;
  transport.marker.set(0);
  // onsets: a quantum 4x louder than the one before it and over -35 dBFS, 100 ms after the last
  const on = [];
  let prev = 1,
    last = -1;
  for (const [tt, p] of rows) {
    if (tt < t0 && p > 4 * prev && p > 0.018 && tt - last > 0.1) {
      on.push(tt);
      last = tt;
    }
    prev = Math.max(p, 1e-6);
  }
  return { k, gaps: on.slice(1).map((x, i) => Math.round((x - on[i]) * 1000)) };
});
// at 120 bpm: the count clicks 0, 1, 2, 3 (500 ms apart), the downbeat 250 ms after the last, then 500 ms beats
const gaps = odd.gaps.slice(0, 8),
  want = [500, 500, 500, 250, 500, 500, 500, 250];
t.ok(
  odd.k &&
    odd.k.beats === 3.5 &&
    odd.k.from === 0 &&
    odd.k.until === 3.5 &&
    gaps.length === 8 &&
    gaps.every((g, i) => Math.abs(g - want[i]) < 15),
  `7/8: a 1-bar count-in from bar 2 is one bar (${JSON.stringify(odd.k)}) and the click starts every bar (gaps ${odd.gaps.join(' ')} ms: 3.5 beats a bar, the last beat an eighth)`,
);

t.ok(
  !errors.filter((e) => !/Failed to load resource/.test(e)).length,
  'no page errors ' + errors.slice(0, 3).join(' | '),
);
await close();
t.done();
