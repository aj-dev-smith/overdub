// FALLBACK devices: what the engine plays through when a track names a device that isn't there (not registered yet,
// misspelled, or its build threw). Instruments get a small, pleasant, click-free synth so the song stays audible;
// effects get a pass-through. Both have the full Instance interface (docs/ARCHITECTURE.md, "Instance"), and both
// are deterministic (no randomness at all), so offline renders of them are sample-identical.
//
// The fallback synth: a triangle with a quiet, slightly detuned saw on top, through a gentle key-tracked low-pass,
// with a soft attack / decay / sustain / release envelope. Velocity shapes level and brightness.

import { isOffline, soon } from './util.js';

// Voices sit in slots chained one into the next (slot k sums slot k-1 and its own voice), so no node ever sums more
// than two sounding inputs. (Chrome sums 3+ connections into one input in an order that varies from run to run,
// which makes chords differ by a rounding error between two renders. Two inputs add the same either way.)
const SLOTS = 32;

export const FALLBACK_DEF = {
  id: 'engine.fallback', name: 'Fallback synth', kind: 'instrument', cat: 'synth', flavour: 'fallback',
  blurb: 'what plays while the real instrument is missing', params: [], look: {}, version: 1,
};
export const PASS_DEF = {
  id: 'engine.pass', name: 'Pass-through', kind: 'effect', cat: 'utility', flavour: 'fallback',
  blurb: 'stands in for a missing effect', params: [], look: {}, version: 1,
};

const mtof = (p) => 440 * Math.pow(2, (p - 69) / 12);

export function fallbackSynth(c, { uid = 'fallback', missing = null } = {}) {
  const output = c.createGain();
  output.gain.value = 1;
  const voices = []; // { p, t0, off, nodes: [osc...], env, alive, slot }
  const live = !isOffline(c);
  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const g = c.createGain(); g.gain.value = 1;
    if (i) slots[i - 1].node.connect(g);
    slots.push({ node: g, busy: -Infinity, voice: null });
  }
  slots[SLOTS - 1].node.connect(output);

  function stopVoice(v, at, fast = false) {
    if (fast && at <= v.t0 + 1e-9) {
      // it hasn't started yet: make sure it never sounds
      v.off = v.t0;
      for (const o of v.nodes) { try { o.stop(v.t0); } catch (e) { /* stopped */ } }
      if (v.slot.voice === v) v.slot.busy = Math.min(v.slot.busy, v.t0);
      return;
    }
    // (never before the attack has been laid down: the envelope's events must stay in time order)
    const t = Math.max(at, v.t0 + 0.006);
    if (v.off !== Infinity && t >= v.off && !fast) return;
    v.off = Math.min(v.off, t);
    const tc = fast ? 0.008 : 0.07;
    try { v.env.gain.setTargetAtTime(0, t, tc); } catch (e) { /* gone */ }
    const end = t + tc * 10;
    for (const o of v.nodes) { try { o.stop(end); } catch (e) { /* stopped */ } }
    if (v.slot.voice === v) v.slot.busy = Math.min(v.slot.busy, end);
  }

  // The first slot that is silent at t; else steal the one that frees up soonest (it is released fast).
  function slotFor(t) {
    let best = null;
    for (const s of slots) { if (s.busy <= t) return s; if (!best || s.busy < best.busy) best = s; }
    if (best.voice) stopVoice(best.voice, t, true);
    return best;
  }

  // (a time that is already past for the audio thread would make the envelope jump: start no sooner than soon())
  function noteOn(pitch, vel = 0.8, time = c.currentTime) {
    const t = Math.max(time, soon(c));
    const slot = slotFor(t);
    const f = mtof(pitch);
    const v = Math.max(0, Math.min(1, vel));
    const peak = 0.2 * Math.pow(v, 1.4) + 0.004;
    const env = c.createGain();
    env.gain.value = 0;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.005);
    env.gain.setTargetAtTime(peak * 0.55, t + 0.005, 0.16);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(c.sampleRate * 0.45, f * (3 + 5 * v) + 500);
    lp.Q.value = 0.6;
    const tri = c.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f;
    const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f; saw.detune.value = 5;
    const sawG = c.createGain(); sawG.gain.value = 0.22;
    tri.connect(lp); saw.connect(sawG); sawG.connect(lp); lp.connect(env); env.connect(slot.node);
    tri.start(t); saw.start(t);
    const voice = { p: pitch, at: time, t0: t, off: Infinity, nodes: [tri, saw], env, alive: true, slot };
    slot.voice = voice; slot.busy = Infinity;
    tri.onended = () => {
      voice.alive = false;
      try { env.disconnect(); lp.disconnect(); sawG.disconnect(); } catch (e) { /* gone */ }
      const i = voices.indexOf(voice); if (i >= 0) voices.splice(i, 1);
    };
    voices.push(voice);
    if (!live && voices.length > 4096) voices.splice(0, voices.length - 4096); // offline: keep the list bounded
  }

  // Release the oldest held voice of that pitch that started at or before `time` (events arrive time-ordered,
  // offs before ons at equal times, so a repeated note releases the previous one, not itself).
  function noteOff(pitch, time = c.currentTime) {
    const t = Math.max(time, soon(c));
    const v = voices.find((x) => x.alive && x.p === pitch && x.off === Infinity && x.t0 <= t + 1e-9);
    if (v) stopVoice(v, t);
  }

  // Take back the note-on sent for `time` (see kernel/host.js cancel): not started yet, it never sounds; sounding, it
  // is released now. With `to`, it is released then (here a release can move earlier, not later).
  function cancel(pitch, time, off, to) {
    const v = voices.find((x) => x.alive && x.p === pitch && Math.abs(x.at - time) < 1e-7);
    if (!v) return;
    const now = soon(c);
    if (to != null) stopVoice(v, Math.max(now, to));
    else if (v.t0 > now) stopVoice(v, v.t0, true);
    else stopVoice(v, now);
  }

  function allOff(time = c.currentTime) {
    const t = Math.max(time, soon(c));
    for (const v of voices) if (v.alive) stopVoice(v, t, true);
  }

  return {
    def: FALLBACK_DEF, uid, ready: Promise.resolve(), input: null, output, latency: 0, fallback: true, missing,
    set() {}, setOn() {}, noteOn, noteOff, allOff, cancel,
    // (voices: still sounding; held: no release laid down yet. engine.voices() and tools/stuck-test.js read it)
    stats: async () => ({ voices: voices.filter((v) => v.alive).length, held: voices.filter((v) => v.alive && v.off === Infinity).length }),
    dispose() { allOff(); setTimeout(() => { for (const s of slots) { try { s.node.disconnect(); } catch (e) { /* gone */ } } try { output.disconnect(); } catch (e) { /* gone */ } }, 200); },
  };
}

// held: the id of a held device (devices/trust.js) this stands in for. A held effect is this pass-through: the sound
// goes on untouched and nothing of the device runs.
export function passThrough(c, { uid = 'pass', missing = null, held = null } = {}) {
  const node = c.createGain();
  node.gain.value = 1;
  return {
    def: PASS_DEF, uid, ready: Promise.resolve(), input: node, output: node, latency: 0, fallback: true, missing, held,
    set() {}, setOn() {}, noteOn() {}, noteOff() {}, allOff() {},
    dispose() { try { node.disconnect(); } catch (e) { /* gone */ } },
  };
}

// A held instrument (its code came with the song and hasn't been allowed to run here): silence. Unlike a missing
// device, it doesn't get the fallback synth: the track is quiet until the person lets the device play.
export const HELD_DEF = {
  id: 'engine.held', name: 'Kept off', kind: 'instrument', cat: 'utility', flavour: 'fallback',
  blurb: 'stands in for a song’s instrument whose code hasn’t been allowed here', params: [], look: {}, version: 1,
};
export function silentInstrument(c, { uid = 'held', held = null } = {}) {
  const output = c.createGain();
  output.gain.value = 1;
  return {
    def: HELD_DEF, uid, ready: Promise.resolve(), input: null, output, latency: 0, fallback: true, missing: null, held,
    set() {}, setOn() {}, noteOn() {}, noteOff() {}, allOff() {}, cancel() {},
    stats: async () => ({ voices: 0, held: 0 }),
    dispose() { try { output.disconnect(); } catch (e) { /* gone */ } },
  };
}
