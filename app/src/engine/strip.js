// Channel strips: the part of the graph the live engine and the offline renderer build with the SAME code, so what an
// agent measures is what the human hears.
//
//   track strip:  [instrument | input | audio clips] -> head -> preDip -> inserts... -> postDip -> fader (stereo)
//                 -> mute -> balance pan -> out (-> meter taps, live) -> master head
//
// The fader forces stereo (a mono source becomes L = R at unity), and pan is a balance control (centre: both sides
// at unity; moving one way turns the other side down along a cosine). So a mono sample at 0 dB plays at 0 dB, and
// panning never boosts. (A StereoPanner would play a mono source 3 dB down at centre and sum L+R when hard panned.)
//   master strip: head (sum) -> preDip -> master inserts... -> postDip -> fader (master gain) -> softClip -> tap
//                 and, live (opts.monitor): fader + the metronome (monIn) -> a second soft clip -> the speakers
//                 Its meter (live) listens at the fader, before the soft clip: see "the meter" below.
//
// Latency. A strip's latency() is what its instrument and wired inserts add (each Instance's `latency`, seconds; a
// bypassed kernel still delays its dry path by its declared latency, a bypassed graph pedal doesn't). The engine and
// the renderers compensate for it by when they play each track (see engine.js, "Plugin delay compensation").
//
// The dips are how rewires stay click-free: both ramp to 0 over 8 ms, the chain is rewired once the audio clock has
// passed the ramp, then both ramp back. Devices are instantiated through the registry (instantiate / paramValues);
// a missing device or one whose build throws becomes a FALLBACK (fallback.js) plus an 'error' report. A held device
// (a song's, whose code this browser hasn't allowed: devices/trust.js) is silence for an instrument and a pass-through
// for an effect, with no report; nothing of it is compiled or run, live or in any render.

import { getDevice, heldDevice, instantiate, paramValues, seedOf } from '../devices/registry.js';
import { fallbackSynth, passThrough, silentInstrument } from './fallback.js';
import { dbToGain, ramp, setNow, afterAudio, isOffline, within, sig, soon } from './util.js';
import { laneValue, FADER, PAN } from './schedule.js';

const READY_MS = 8000;   // a device that isn't ready by then is treated as broken
const DIP = 0.008;       // seconds to dip a strip out (and back in) around a rewire

// What a device id should be built as right now: 'id@version', 'held:id:hash' or 'missing:id'. (Held first: a song's
// device that shadows a shelf id and is held plays as held, not as the shelf's.)
export function wantKey(id) {
  const held = heldDevice(id);
  if (held) return `held:${id}:${held.hash}`;
  const def = getDevice(id);
  return def ? `${id}@${def.version || 1}` : `missing:${id}`;
}

// Make a live Instance for a device id. Never throws: falls back and reports.
//   kind: 'instrument' | 'effect'; ctx: { clock, report(err) }
export async function makeInstance(c, kind, deviceId, { uid, params, on = true, clock, bpm, report }) {
  const key = wantKey(deviceId);
  if (heldDevice(deviceId)) {
    const inst = kind === 'instrument' ? silentInstrument(c, { uid, held: deviceId }) : passThrough(c, { uid, held: deviceId });
    return { inst, key, failed: false, held: true };
  }
  const def = getDevice(deviceId);
  const fallback = (why) => {
    report && report({ kind: 'device', device: deviceId, uid, message: why });
    const inst = kind === 'instrument' ? fallbackSynth(c, { uid, missing: deviceId }) : passThrough(c, { uid, missing: deviceId });
    return { inst, key, failed: true };
  };
  if (!def) return fallback(`no device "${deviceId}" (playing a stand-in until it is defined)`);
  if (def.kind !== kind) return fallback(`device "${deviceId}" is an ${def.kind}, not an ${kind}`);
  let inst = null;
  try {
    const values = paramValues(def, params || {});
    inst = await within(instantiate(c, def, { uid, seed: seedOf(uid), clock, params: values, on }), READY_MS, deviceId);
    await within(inst.ready, READY_MS, deviceId);
    if (!inst.output) throw new Error('instance has no output');
    if (kind === 'effect' && !inst.input) throw new Error('effect instance has no input');
    try { inst.set(values, { bpm, first: true }); } catch (e) { report && report({ kind: 'device', device: deviceId, uid, message: 'set: ' + e.message }); }
    if (kind === 'effect') { try { inst.setOn(on !== false); } catch (e) { /* optional */ } }
    inst.__sig = sig(values) + '|' + bpm;
    inst.__on = on !== false;
    // kernel data that isn't on this server: the device plays nothing, and says so (once it knows)
    if (inst.data && report) {
      const say = (d) => { if (d && d.state === 'missing') report({ kind: 'data', device: deviceId, uid, message: `${def.name} plays nothing: its samples (${Object.values(d.hashes).map((x) => x.slice(7, 19)).join(', ')}) aren't on this server` }); };
      say(inst.data);
      if (inst.on) inst.on('data', say);
    }
    return { inst, key, failed: false };
  } catch (e) {
    if (inst) { try { inst.dispose(); } catch (e2) { /* gone */ } }
    return fallback(`device "${deviceId}" failed to build: ${e && e.message || e}`);
  }
}

// Apply params (and bypass) to an instance if they changed. Devices glide themselves. inst.__auto ({ key: value }, set
// by the engine's graph automation) overlays what is sent.
export function applyParams(inst, deviceId, stored, bpm, on, report) {
  if (!inst || inst.fallback) return;
  const def = getDevice(deviceId) || inst.def;
  if (!def || !def.params) return;
  const values = paramValues(def, stored || {});
  const s = sig(values) + '|' + bpm;
  if (s !== inst.__sig) {
    inst.__sig = s;
    // (a graph device's automated keys keep the value their lane last sent: a reconcile never yanks them back)
    if (inst.__auto) Object.assign(values, inst.__auto);
    try { inst.set(values, { bpm }); } catch (e) { report && report({ kind: 'device', device: deviceId, uid: inst.uid, message: 'set: ' + e.message }); }
  }
  if (on != null && (on !== false) !== inst.__on) {
    inst.__on = on !== false;
    try { inst.setOn(inst.__on); } catch (e) { report && report({ kind: 'device', device: deviceId, uid: inst.uid, message: 'setOn: ' + e.message }); }
  }
}

// The safety soft clip: transparent (exactly linear) below -3 dBFS, then a tanh knee up to a ceiling a little under
// 0 dBFS. Input headroom of +18 dB before the curve's end. (A WaveShaperNode; see SOFTCLIP_OVERSAMPLE.)
export const SC_K = 8;            // the curve spans -8..+8 (+18 dBFS)
const SC_T = 0.7079;         // -3 dBFS: linear below this
export const SC_CEIL = 0.944; // -0.5 dBFS: what it saturates toward
// Measured in Chrome: oversample '2x' delays the whole mix by 128 samples and '4x' by 192, and neither is transparent
// (an impulse of 0.5 comes out 0.496). 'none' is exact below the knee with no delay; the smooth tanh knee keeps the
// aliasing of a mix that actually hits it low. It is a safety net, not a mastering limiter.
export const SOFTCLIP_OVERSAMPLE = 'none';
let CURVE = null;
export function softClipCurve() {
  if (CURVE) return CURVE;
  const n = 32769, cv = new Float32Array(n), room = SC_CEIL - SC_T;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) * 2 - 1) * SC_K, a = Math.abs(x);
    const y = a <= SC_T ? a : SC_T + room * Math.tanh((a - SC_T) / room);
    cv[i] = Math.sign(x) * y;
  }
  return (CURVE = cv);
}
export function makeSoftClip(c) {
  const pre = c.createGain(); pre.gain.value = 1 / SC_K;
  const ws = c.createWaveShaper();
  ws.curve = softClipCurve();
  ws.oversample = SOFTCLIP_OVERSAMPLE;
  pre.connect(ws);
  return { input: pre, output: ws, nodes: [pre, ws] };
}

// ---------------------------------------------------------------------------------------------------- Strip
// opts: { id, master, dest (AudioNode), clock, bpm(), report(err), onGraph(evt), meters (bool) }
export class Strip {
  constructor(c, opts) {
    this.c = c;
    this.id = opts.id;
    this.master = !!opts.master;
    this.o = opts;
    this.live = !isOffline(c);
    const G = (v = 1) => { const g = c.createGain(); g.gain.value = v; return g; };
    this.head = G();
    this.input = G();              // live input monitoring feeds this
    this.input.connect(this.head);
    this.preDip = G();
    this.postDip = G();
    this.fader = G();
    this.head.connect(this.preDip);
    // live only: the polite stop's fade (calmDown / calmUp; engine.js). Offline the chain is as it always was.
    if (this.live) { this.calm = G(); this.postDip.connect(this.calm); this.calm.connect(this.fader); } else this.postDip.connect(this.fader);
    if (this.master) {
      this.clip = makeSoftClip(c);
      this.out = G();               // the tap (engine.masterTap): after the soft clip
      this.fader.connect(this.clip.input);
      this.clip.output.connect(this.out);
    } else {
      this.fader.channelCount = 2; this.fader.channelCountMode = 'explicit'; this.fader.channelInterpretation = 'speakers';
      this.mute = G();
      this.split = c.createChannelSplitter(2);
      this.panL = G(); this.panR = G();
      this.merge = c.createChannelMerger(2);
      this.out = G();
      this.fader.connect(this.mute); this.mute.connect(this.split);
      this.split.connect(this.panL, 0); this.split.connect(this.panR, 1);
      this.panL.connect(this.merge, 0, 0); this.panR.connect(this.merge, 0, 1);
      this.merge.connect(this.out);
    }
    if (opts.dest) this.out.connect(opts.dest);
    // The meter (live only: no render has one). A track's listens to what it sends on. The master's listens to the mix
    // before the safety soft clip, at the fader: after the clip a mix can never read past about -0.5 dBFS (SC_CEIL),
    // so a mix that goes over would never read over (docs/FRESH-EYES-6.md, the producer's Broken 2). Over 0 dBFS
    // there, the clip is shaving the peaks down to about -0.5 dBFS (ui/transport.js says so, in red). It only listens:
    // the analysers are a branch off the fader, so nothing reaches the soft clip, the speakers or masterTap differently.
    if (opts.meters) {
      const split = c.createChannelSplitter(2);
      (this.master ? this.fader : this.out).connect(split);
      this.an = [0, 1].map((i) => { const a = c.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0; split.connect(a, i); return a; });
      this.msplit = split;
      this.buf = new Float32Array(2048);
    }
    this.instr = null;              // { device, key, inst, gain }
    this.fx = [];                   // [{ id, device, key, inst }] in chain order (what is wired)
    this.pool = new Map();          // insert id -> { device, key, inst } built but not wired yet
    this.job = null;                // the running device sync
    this.dirty = false;
    this.spec = null;               // the latest { instrument, inserts }
    this.mix = null;
    this.disposed = false;
    this.dips = 0;                  // dips in flight (preDip / postDip come back up when the last one ends)
    if (this.master && opts.monitor) {
      // what the speakers get: the same safety soft clip over the mix plus the metronome, so a click on a hot mix
      // never goes over 0 dBFS, while the tap (and every render) stays the mix alone
      this.mon = makeSoftClip(c);
      this.fader.connect(this.mon.input);
      this.mon.output.connect(opts.monitor);
      this.monIn = this.mon.input;
    }
    this.wire();
  }

  // ---- mixer (cheap, synchronous)
  // auto: { gain?, pan? } true while a lane drives that param (the engine ramps it on the control grid): left alone
  // here. When the lane lets go, the param is set again (ramped) to `gain` / `pan`.
  // trim: dB at the mute stage, after the fader (so a gain lane is untouched): the practice Band level (engine.band),
  // live only; 0 everywhere else, renders included unless one asks (renderProject's trims, for the Jam room's measuring)
  setMix({ gain = 0, pan = 0, audible = true, auto = null, trim = 0 }, now = false) {
    const c = this.c, ag = !!(auto && auto.gain), ap = !!(auto && auto.pan), m = { gain, pan, audible, ag, ap, trim };
    const prev = this.mix;
    this.mix = m;
    const set = (param, v, dur) => (now || !prev ? setNow(c, param, v) : ramp(c, param, v, dur));
    if (!ag && (!prev || prev.gain !== gain || prev.ag)) set(this.fader.gain, dbToGain(gain), 0.02);
    if (this.master) return;
    if (!ap && (!prev || prev.pan !== pan || prev.ap)) {
      const x = Math.max(-1, Math.min(1, pan || 0));
      set(this.panL.gain, x <= 0 ? 1 : Math.cos(x * Math.PI / 2), 0.02);
      set(this.panR.gain, x >= 0 ? 1 : Math.cos(-x * Math.PI / 2), 0.02);
    }
    if (!prev || prev.audible !== audible || (prev.trim || 0) !== trim) set(this.mute.gain, audible ? (trim ? dbToGain(trim) : 1) : 0, prev && prev.audible === audible ? 0.03 : 0.012);
  }

  // ---- devices
  // spec: { instrument: { device, params } | null, inserts: [{ id, device, on, params }] }. Returns a promise that
  // resolves when the strip matches the latest spec it has been given.
  sync(spec) {
    this.spec = spec;
    // fast path: params and bypass on what is already built
    const bpm = this.o.bpm();
    if (this.instr && spec.instrument && this.instr.device === spec.instrument.device) applyParams(this.instr.inst, this.instr.device, spec.instrument.params, bpm, null, this.o.report);
    for (const ins of spec.inserts) {
      const have = this.fx.find((f) => f.id === ins.id && f.device === ins.device) || (this.pool.get(ins.id));
      if (have && have.device === ins.device) applyParams(have.inst, ins.device, ins.params, bpm, ins.on, this.o.report);
    }
    if (!this.needsBuild(spec)) return this.job || Promise.resolve();
    if (this.job) { this.dirty = true; return this.job; }
    this.job = (async () => {
      try {
        do { this.dirty = false; await this.build(this.spec); } while (this.dirty && !this.disposed);
      } finally { this.job = null; }
    })();
    return this.job;
  }

  needsBuild(spec) {
    const wi = spec.instrument ? spec.instrument.device : null;
    if ((this.instr ? this.instr.device : null) !== wi) return true;
    if (this.instr && wi && !sameKey(this.instr.key, wantKey(wi))) return true;
    if (this.fx.length !== spec.inserts.length) return true;
    for (let i = 0; i < spec.inserts.length; i++) {
      const f = this.fx[i], s = spec.inserts[i];
      if (f.id !== s.id || f.device !== s.device || !sameKey(f.key, wantKey(s.device))) return true;
    }
    return false;
  }

  async build(spec) {
    const c = this.c, bpm = this.o.bpm(), report = this.o.report, clock = this.o.clock;
    const tasks = [];
    // the instrument
    let newInstr = null;
    const wi = spec.instrument && spec.instrument.device;
    if (wi && (!this.instr || this.instr.device !== wi || !sameKey(this.instr.key, wantKey(wi)))) {
      tasks.push(makeInstance(c, 'instrument', wi, { uid: `${this.id}:instrument`, params: spec.instrument.params, clock, bpm, report })
        .then((r) => { newInstr = { device: wi, ...r }; }));
    }
    // inserts: reuse what is built (wired or pooled) when its device and version still match
    const have = new Map();
    for (const f of this.fx) have.set(f.id, f);
    for (const [id, f] of this.pool) if (!have.has(id)) have.set(id, f);
    const next = spec.inserts.map((s) => {
      const h = have.get(s.id);
      if (h && h.device === s.device && sameKey(h.key, wantKey(s.device))) return h;
      const slot = { id: s.id, device: s.device, key: null, inst: null };
      tasks.push(makeInstance(c, 'effect', s.device, { uid: s.id, params: s.params, on: s.on, clock, bpm, report })
        .then((r) => { slot.key = r.key; slot.inst = r.inst; slot.failed = r.failed; }));
      return slot;
    });
    await Promise.all(tasks);
    if (this.disposed) { for (const s of next) if (!have.has(s.id) || have.get(s.id) !== s) safeDispose(s.inst); if (newInstr) safeDispose(newInstr.inst); return; }
    // the latest params (they may have moved while we were building)
    const latest = this.spec;
    for (const s of next) {
      const ls = latest.inserts.find((x) => x.id === s.id);
      if (ls) applyParams(s.inst, s.device, ls.params, this.o.bpm(), ls.on, report);
    }
    // swap the instrument: the new one in, the old one released and faded out
    if (newInstr || (!wi && this.instr)) {
      const old = this.instr;
      if (newInstr) {
        const g = c.createGain(); g.gain.value = 1;
        newInstr.inst.output.connect(g); g.connect(this.head);
        this.instr = { ...newInstr, gain: g };
        if (latest.instrument) applyParams(newInstr.inst, wi, latest.instrument.params, this.o.bpm(), null, report);
      } else this.instr = null;
      if (old) this.retireInstrument(old);
      this.o.onGraph && this.o.onGraph({ kind: 'instrument', track: this.id, device: wi || null });
    }
    // rewire the inserts if the chain changed
    const changed = next.length !== this.fx.length || next.some((s, i) => s !== this.fx[i]);
    if (changed) {
      const gone = this.fx.filter((f) => !next.includes(f));
      // pooled instances not in `next` are no longer wanted either
      for (const [id, f] of this.pool) if (!next.includes(f) && !gone.includes(f)) gone.push(f);
      this.pool.clear();
      await this.rewire(next);
      for (const f of gone) {
        // a removed insert that is still in the spec under a moved position is in `next`; the rest go
        if (!next.includes(f)) safeDispose(f.inst);
      }
      this.o.onGraph && this.o.onGraph({ kind: 'inserts', track: this.id, inserts: next.map((s) => s.id) });
    }
  }

  retireInstrument(old) {
    const c = this.c;
    try { old.inst.allOff(soon(c)); } catch (e) { /* ok */ }
    if (!this.live) { safeDispose(old.inst); try { old.gain.disconnect(); } catch (e) { /* ok */ } return; }
    ramp(c, old.gain.gain, 0, 0.03);
    afterAudio(c, soon(c) + 0.05, () => {
      try { old.inst.output.disconnect(old.gain); } catch (e) { /* ok */ }
      try { old.gain.disconnect(); } catch (e) { /* ok */ }
      safeDispose(old.inst);
    });
  }

  // Fresh instances of every device on the strip (the killswitch, engine.silence(), with the speakers already at
  // zero): held voices and reverb and delay tails go with the old ones. Resolves when the strip is rebuilt.
  async renew() {
    if (this.disposed) return;
    if (this.job) { try { await this.job; } catch (e) { /* rebuilt below */ } }
    const old = [this.instr, ...this.fx, ...this.pool.values()].filter(Boolean);
    if (this.instr) { try { this.instr.inst.output.disconnect(this.instr.gain); } catch (e) { /* ok */ } try { this.instr.gain.disconnect(); } catch (e) { /* ok */ } }
    this.instr = null; this.fx = []; this.pool.clear();
    this.wire();
    for (const f of old) safeDispose(f.inst);
    if (this.spec) await this.sync(this.spec);
  }

  // The polite stop (engine.js): what the strip sends fades from t over dur (an exponential approach, -52 dB at dur,
  // then the rest of the way in a few ms), so the strip can be renewed in silence; calmUp brings it back (at once:
  // `now`, with the speakers shut; else over 30 ms, from wherever the fade had got to). Live strips only.
  calmDown(t, dur) {
    if (!this.calm) return;
    const g = this.calm.gain;
    try { g.cancelScheduledValues(t); g.setTargetAtTime(0, t, dur / 6); g.setTargetAtTime(0, t + dur, 0.004); } catch (e) { /* closed */ }
  }
  calmUp(now = false) {
    if (!this.calm || this.disposed) return;
    if (now) setNow(this.c, this.calm.gain, 1); else ramp(this.c, this.calm.gain, 1, 0.03);
  }
  // Live input (a monitored mic or guitar) coming into the strip: watchInput() starts listening (the engine's
  // inputNode() calls it), hearsInput() says whether anything is coming in now (over -80 dBFS).
  watchInput() {
    if (this.inTap || !this.live) return;
    this.inTap = this.c.createAnalyser(); this.inTap.fftSize = 512;
    this.input.connect(this.inTap);
  }
  hearsInput() {
    if (!this.inTap) return false;
    const b = new Float32Array(this.inTap.fftSize);
    this.inTap.getFloatTimeDomainData(b);
    for (let i = 0; i < b.length; i++) if (b[i] > 1e-4 || b[i] < -1e-4) return true;
    return false;
  }

  // Change the chain under the strip: live and sounding, dip out, run fn, dip back in (overlapping dips share one).
  dipped(fn) {
    const c = this.c;
    if (!this.live || c.state !== 'running') { fn(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const t = soon(c);
      this.dips++;
      ramp(c, this.preDip.gain, 0, DIP);
      ramp(c, this.postDip.gain, 0, DIP);
      afterAudio(c, t + 2 * DIP, () => {
        this.dips--;
        if (!this.disposed) {
          fn();
          if (this.dips === 0) {
            ramp(this.c, this.preDip.gain, 1, DIP);
            ramp(this.c, this.postDip.gain, 1, DIP);
          }
        }
        resolve();
      });
    });
  }

  // Wire preDip -> chain -> postDip. Live and sounding: dip out, rewire, dip in.
  rewire(next) {
    return this.dipped(() => { this.fx = next; this.wire(); });
  }

  // (only the connections the strip made are undone: a device may hang its own taps off its output)
  wire() {
    for (const [a, b] of this.links || []) { try { a.disconnect(b); } catch (e) { /* ok */ } }
    this.links = [];
    let at = this.preDip;
    for (const f of this.fx) { at.connect(f.inst.input); this.links.push([at, f.inst.input]); at = f.inst.output; }
    at.connect(this.postDip);
    this.links.push([at, this.postDip]);
  }

  // Seconds of delay the strip's own devices add (the instrument and the wired inserts).
  latency() {
    let s = 0;
    const add = (inst) => { if (!inst) return; let l = 0; try { l = +inst.latency; } catch (e) { l = 0; } if (Number.isFinite(l) && l > 0) s += l; };
    if (this.instr) add(this.instr.inst);
    for (const f of this.fx) add(f.inst);
    return s;
  }

  instance(which) {
    if (which === 'instrument') return this.instr ? this.instr.inst : null;
    const f = this.fx.find((x) => x.id === which);
    return f ? f.inst : null;
  }

  // dBFS peak and rms of what the strip sends on (live, with meters); the master's, of the mix before its soft clip,
  // so its peak passes 0 when the mix goes over
  read() {
    if (!this.an) return null;
    let pk = 0, sq = 0, n = 0;
    for (const a of this.an) {
      a.getFloatTimeDomainData(this.buf);
      const b = this.buf;
      for (let i = 0; i < b.length; i++) { const v = b[i], av = v < 0 ? -v : v; if (av > pk) pk = av; sq += v * v; }
      n += b.length;
    }
    const db = (x) => (x > 1e-6 ? Math.round(200 * Math.log10(x)) / 10 : -120);
    return { peak: db(pk), rms: db(Math.sqrt(sq / n)) };
  }

  // Take the strip out (fade first when live). Instances are disposed.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const c = this.c;
    const end = () => {
      for (const [a, b] of this.links || []) { try { a.disconnect(b); } catch (e) { /* ok */ } }
      for (const n of [this.head, this.input, this.inTap, this.preDip, this.postDip, this.calm, this.fader, this.mute, this.split, this.panL, this.panR, this.merge, this.out, this.msplit, ...(this.an || []), ...(this.clip ? this.clip.nodes : []), ...(this.mon ? this.mon.nodes : [])]) {
        if (n) { try { n.disconnect(); } catch (e) { /* ok */ } }
      }
      if (this.instr) { try { this.instr.gain.disconnect(); } catch (e) { /* ok */ } safeDispose(this.instr.inst); }
      for (const f of this.fx) safeDispose(f.inst);
      for (const f of this.pool.values()) safeDispose(f.inst);
    };
    if (this.instr) { try { this.instr.inst.allOff(soon(c)); } catch (e) { /* ok */ } }
    if (this.live && c.state === 'running') { ramp(c, this.out.gain, 0, 0.015); if (this.mon) ramp(c, this.mon.input.gain, 0, 0.015); afterAudio(c, soon(c) + 0.025, end); } else end();
  }
}

// 'failed' and 'missing' builds keep their key; a failed build of a version is not retried until the version moves.
function sameKey(have, want) { return have === want; }

function safeDispose(inst) { if (inst) { try { inst.dispose(); } catch (e) { console.warn('engine: dispose', e); } } }

// The spec a strip builds from a track (or the master). With `at` (a song beat), each automated param (a lane that
// isn't held) carries its lane's value there instead of its static one: what a stopped transport sits at (the cursor)
// and where a render starts. def(id): the device def (default the registry's).
export function trackSpec(t, { at = null, def = getDevice } = {}) {
  return {
    instrument: t.kind !== 'audio' && t.instrument && t.instrument.device ? { device: String(t.instrument.device), params: atBeat(t.instrument, at, def) } : null,
    inserts: (t.inserts || []).map((x) => ({ id: x.id, device: String(x.device), on: x.on !== false, params: atBeat(x, at, def) })),
  };
}
export function masterSpec(p, { at = null, def = getDevice } = {}) {
  return { instrument: null, inserts: ((p.master && p.master.inserts) || []).map((x) => ({ id: x.id, device: String(x.device), on: x.on !== false, params: atBeat(x, at, def) })) };
}
// a device's params, its lanes' values at beat `at` laid over them
function atBeat(d, at, def) {
  const params = d.params || {};
  if (at == null || !d.auto || typeof d.auto !== 'object') return params;
  let out = null;
  const dd = def(String(d.device));
  for (const k of Object.keys(d.auto)) {
    const lane = d.auto[k];
    if (!lane || lane.off) continue;
    const q = dd && (dd.params || []).find((x) => (Array.isArray(x) ? x[0] : x.key) === k);
    if (!q || q.auto === false) continue;
    const v = laneValue(lane, at, q);
    if (v == null) continue;
    if (!out) out = { ...params };
    out[k] = v;
  }
  return out || params;
}
// The mixer's values at beat `at` ({ gain, pan }: the lanes' where they play, else the static ones).
export function mixAt(t, at) {
  const a = (t && t.auto) || {}, out = { gain: +t.gain || 0, pan: +t.pan || 0 };
  if (at == null) return out;
  for (const k of ['gain', 'pan']) {
    const lane = a[k];
    if (!lane || lane.off) continue;
    const v = laneValue(lane, at, k === 'gain' ? FADER : PAN);
    if (v != null) out[k] = v;
  }
  return out;
}

// Which tracks are heard: mute, and solo (any solo: only soloed tracks).
export function audibility(p, only = null) {
  const out = {};
  if (only) { for (const t of p.tracks) out[t.id] = only.includes(t.id); return out; }
  const anySolo = p.tracks.some((t) => t.solo);
  for (const t of p.tracks) out[t.id] = !t.mute && (!anySolo || !!t.solo);
  return out;
}
