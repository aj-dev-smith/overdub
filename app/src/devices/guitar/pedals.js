// @ts-check
// Every clawd-o-matic pedal as an Overdub effect device, 'pedal.<id>' (ids are forever: the original ones, prefixed).
// The pedal's own build(c, kit) runs unchanged on Overdub's kit (devices/kit.js) inside devices/graph.js's bypass.
// Params are its knobs, with a role and a unit added where the label or the knob's own readout makes them obvious.
import { defineDevice } from '../registry.js';
import { clawd, workletFiles } from './clawd.js';

// clawd-o-matic's pedal categories -> Overdub's (registry DEVICE_CATS). 'synth' there means a guitar-synth effect
// (a synth voice, a freeze, an arpeggiator): Overdub's 'synth' is for instruments, so those file under pitch.
const CAT = {
  dynamics: 'dynamics',
  filter: 'filter',
  pitch: 'pitch',
  drive: 'drive',
  fuzz: 'fuzz',
  synth: 'pitch',
  mod: 'mod',
  time: 'time',
  ambient: 'ambient',
  glitch: 'glitch',
  utility: 'utility',
};

// Role from the label (and the pedal's category where a word means two things)
export function roleOf(label, cat) {
  const l = String(label).toUpperCase().trim();
  if (/^(MIX|BLEND|WET|DRY\/WET|EFFECT)$/.test(l)) return 'mix';
  if (/^(TONE|FILTER|TREBLE|BASS|MIDDLE|MID|LOW|HIGH|LOWS|HIGHS|CUTOFF|FREQ|TREB)$/.test(l)) return 'tone';
  if (/^(RATE|SPEED)$/.test(l)) return 'rate';
  if (/^(DEPTH|INTENSE|INTENSITY|SWEEP)$/.test(l)) return 'depth';
  if (/^(TIME|NOTE|SLAP|DELAY)$/.test(l)) return 'time';
  if (/^(FDBK|FEEDBACK|REPEATS|REGEN)$/.test(l)) return 'feedback';
  if (/^(LEVEL|VOL|VOLUME|OUTPUT|OUT|MASTER)$/.test(l)) return 'level';
  if (/^(DRIVE|FUZZ|DIST|BOOST|BLOW|SNAP)$/.test(l)) return 'drive';
  if (l === 'GAIN') return cat === 'drive' || cat === 'fuzz' || cat === 'amp' ? 'drive' : null;
  if (l === 'SUSTAIN') return cat === 'fuzz' || cat === 'drive' ? 'drive' : cat === 'synth' ? 'decay' : null;
  if (/^(DECAY|DWELL|LENGTH|HOLD)$/.test(l)) return 'decay';
  if (/^(SIZE|SPACE)$/.test(l)) return 'size';
  if (l === 'ATTACK') return cat === 'fuzz' ? 'drive' : 'attack';
  if (/^(RELEASE|FADE)$/.test(l)) return 'release';
  if (/^(THRESH|THRESHOLD)$/.test(l)) return 'gate';
  if (/^(SENS|SENSITIVITY)$/.test(l)) return 'sens';
  if (/^(WIDTH|SPREAD|STEREO)$/.test(l)) return 'width';
  if (/^(DETUNE|INTERVAL|DROP|PITCH|OCTAVE|SHIFT)$/.test(l)) return 'pitch';
  if (/^(SHAPE|WAVE)$/.test(l)) return 'shape';
  return null;
}
// Unit from what the knob's readout says at its default ('320 ms', '+2.5 dB', '1/8.', '6.5k')
export function unitOf(k) {
  if (k.type === 'switch' || k.type === 'tap' || !k.fmt) return null;
  let s = '';
  try {
    s = String(k.fmt(k.def));
  } catch {
    return null;
  }
  if (k.fmt === clawd.PFX.noteFmt || /^1\/(2|4|8|16|32)(\.|T)?$/.test(s)) return 'note';
  if (/dB$/.test(s)) return 'dB';
  if (/\d\s*k?Hz$/.test(s) || /^\d+(\.\d+)?k$/.test(s)) return 'Hz';
  if (/\d\s*ms$/.test(s)) return 'ms';
  if (/\d\s*s$/.test(s)) return 's';
  if (/\d\s*%$/.test(s)) return '%';
  if (/\d\s*st$/.test(s)) return 'st';
  return null;
}

export function pedalParam(k, cat) {
  const q = { key: k.key, label: k.label, min: k.min, max: k.max, def: k.def, step: k.step || 0 };
  if (k.fmt) q.fmt = k.fmt;
  if (k.type === 'switch') q.opts = k.opts.slice();
  if (k.type === 'tap') q.tap = true;
  const role = k.type === 'tap' ? null : roleOf(k.label, cat);
  if (role) q.role = role;
  const unit = unitOf(k);
  if (unit) q.unit = unit;
  return q;
}

// Params whose pedal applies them in set() at once (a .value write, a rebuild, a pattern restart) rather than at
// set()'s `at`: an automation lane on them would land up to the scheduler's 120 ms lookahead early, so they get none
// (auto: false; docs/research/AUTOMATION.md 3.5). Found by tools/guitar-test.js, which fails on any it doesn't see
// here. Tape Crab and Ping Pong Prawn (feedback delays) sometimes move early in that check and sometimes don't, so
// all of their knobs are out. The vendored pedals are never edited.
export const NO_LANE = {
  wub: ['rate', 'shape'],
  riser: ['bars'],
  jellypulse: ['rate'],
  spinlobster: ['width'],
  sidestep: ['rate'],
  clawchop: ['pat', 'len'],
  tapecrab: ['time', 'int', 'age', 'mix'],
  pingprawn: ['time', 'fb', 'tone', 'width', 'mix'],
  lowbatt: ['batt'],
};

// One clawd-o-matic def (normalised by its pedalDef) -> an Overdub device def.
export function pedalDevice(d) {
  const L = d.look || {};
  return {
    id: 'pedal.' + d.id,
    name: d.name,
    kind: 'effect',
    cat: CAT[d.cat] || 'other',
    pedalCat: d.cat,
    pedal: d.id,
    kindLabel: d.kind,
    blurb: d.blurb,
    nod: d.nod,
    by: 'clawd',
    source: 'clawd-o-matic',
    params: d.knobs.map((k) => {
      const q = pedalParam(k, d.cat);
      if ((NO_LANE[d.id] || []).includes(k.key)) q.auto = false;
      return q;
    }),
    look: Object.assign({ color: d.color, ink: d.ink }, L),
    where: d.where,
    trails: !!d.trails,
    trim: d.trim || 0,
    latency: d.latency || 0,
    drone: !!d.drone,
    tail: d.tail || 0,
    stereo: !!d.stereo,
    worklets: d.worklets ? workletFiles(d.worklets, d.id) : null, // (the files the vendored sources were written to)
    build: d.build,
  };
}

export function registerPedals() {
  const out = [];
  for (const d of clawd.PEDAL_LIST) {
    try {
      out.push(defineDevice(pedalDevice(d)));
    } catch (e) {
      console.error('guitar: pedal ' + d.id + ' not registered:', e.message);
    }
  }
  return out;
}
