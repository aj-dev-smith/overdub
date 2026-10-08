// @ts-check
// Every clawd-o-matic amp as an Overdub effect device, 'amp.<id>' (cat 'amp'). The sound is clawd-o-matic's own
// plugAmp (app/vendor/clawd/amps.js, verbatim): the same knobs give the same samples. Each amp also has its cab and mic
// network (plugCabNet): any of the cabs, a mic of any type moved across the cone, back from the grille and off axis,
// and a second mic blended in (phase flip and all). With the cab on 'Its own' and one mic where it was voiced, it's
// the amp exactly as it was voiced (the network isn't in the path at all).
import { defineDevice } from '../registry.js';
import { clawd, workletFiles } from './clawd.js';

const { PLUG_AMPS, PLUG_CABS, PLUG_MICS, PLUG_MIC_DEFAULT, PLUG_MIC2_DEFAULT, PLUG_DEFAULT, PLUG_WORKLETS } = clawd;
export const CAB_IDS = Object.keys(PLUG_CABS); // 'own' first
export const MIC_IDS = Object.keys(PLUG_MICS);
const TONE_LABEL = {
  clean: 'CLEAN AMP',
  crunch: 'CRUNCH AMP',
  high: 'HIGH-GAIN AMP',
  weird: 'WEIRD AMP',
  bass: 'BASS AMP',
};

// where a mic is on a cone, in words (as clawd-o-matic's cab view says it)
const where = (r) =>
  r < 0.12 ? 'centre' : r < 0.4 ? 'cap edge' : r < 0.82 ? 'cone' : r <= 1.04 ? 'cone edge' : 'off cone';
const inches = (d) => (d < 1 ? d.toFixed(1) : d < 10 ? String(Math.round(d * 2) / 2) : String(Math.round(d))) + '"';
const knob = (key, label, def, role) => ({
  key,
  label,
  min: 0,
  max: 10,
  def,
  step: 0,
  role,
  fmt: (v) => (+v).toFixed(1),
});

export const AMP_PARAMS = [
  knob('gain', 'GAIN', PLUG_DEFAULT.gain, 'drive'),
  knob('bass', 'BASS', PLUG_DEFAULT.bass, 'tone'),
  knob('mid', 'MIDDLE', PLUG_DEFAULT.mid, 'tone'),
  knob('treble', 'TREBLE', PLUG_DEFAULT.treble, 'tone'),
  knob('presence', 'PRESENCE', PLUG_DEFAULT.presence, 'tone'),
  knob('level', 'MASTER', PLUG_DEFAULT.level, 'level'),
  // the cab and the mics
  {
    key: 'cab',
    label: 'CAB',
    opts: CAB_IDS.map((k) => PLUG_CABS[k].name),
    def: 0,
    group: 'cab',
    desc: 'the speaker cabinet',
  },
  {
    key: 'mic',
    label: 'MIC',
    opts: MIC_IDS.map((k) => PLUG_MICS[k].name),
    def: Math.max(0, MIC_IDS.indexOf(PLUG_MIC_DEFAULT.type)),
    group: 'cab',
  },
  {
    key: 'micpos',
    label: 'POSITION',
    min: 0,
    max: 1.35,
    def: PLUG_MIC_DEFAULT.x,
    step: 0.01,
    group: 'cab',
    role: 'tone',
    desc: 'cone radii from the dustcap: brighter at the centre, darker toward the edge',
    fmt: (v) => `${(+v).toFixed(2)} ${where(v)}`,
  },
  {
    key: 'micdist',
    label: 'DISTANCE',
    min: 0.5,
    max: 24,
    def: PLUG_MIC_DEFAULT.dist,
    step: 0,
    curve: 'log',
    group: 'cab',
    desc: 'inches from the grille: closer is bassier (proximity), farther hears the room',
    fmt: inches,
  },
  {
    key: 'micang',
    label: 'ANGLE',
    min: 0,
    max: 60,
    def: PLUG_MIC_DEFAULT.ang,
    step: 1,
    group: 'cab',
    desc: 'degrees off axis: darker',
    fmt: (v) => Math.round(v) + '°',
  },
  {
    key: 'mic2',
    label: 'MIC 2',
    opts: ['Off'].concat(MIC_IDS.map((k) => PLUG_MICS[k].name)),
    def: 0,
    group: 'cab',
    desc: 'a second mic, blended in',
  },
  {
    key: 'mic2pos',
    label: 'POS 2',
    min: 0,
    max: 1.35,
    def: PLUG_MIC2_DEFAULT.x,
    step: 0.01,
    group: 'cab',
    fmt: (v) => `${(+v).toFixed(2)} ${where(v)}`,
  },
  {
    key: 'mic2dist',
    label: 'DIST 2',
    min: 0.5,
    max: 24,
    def: PLUG_MIC2_DEFAULT.dist,
    step: 0,
    curve: 'log',
    group: 'cab',
    fmt: inches,
  },
  {
    key: 'mic2ang',
    label: 'ANGLE 2',
    min: 0,
    max: 60,
    def: PLUG_MIC2_DEFAULT.ang,
    step: 1,
    group: 'cab',
    fmt: (v) => Math.round(v) + '°',
  },
  {
    key: 'blend',
    label: 'BLEND',
    min: 0,
    max: 10,
    def: PLUG_MIC2_DEFAULT.blend,
    step: 0,
    group: 'cab',
    role: 'mix',
    desc: '0 all mic 1, 10 all mic 2',
    fmt: (v) => (+v).toFixed(1),
  },
  { key: 'flip', label: 'PHASE', opts: ['NORM', 'FLIP'], def: 0, group: 'cab', desc: "flip mic 2's polarity" },
];

// Overdub params -> clawd-o-matic's amp settings P ({ amp, gain, ..., cab?, mic?, mic2? }); the defaults left out, so
// the amp at its own cab and one mic where it was voiced takes the straight wire, bit for bit.
export function ampSettings(id, v) {
  const P = { amp: id };
  for (const k of ['gain', 'bass', 'mid', 'treble', 'presence', 'level']) P[k] = v[k];
  const cab = CAB_IDS[Math.round(v.cab)] || 'own';
  if (cab !== 'own') P.cab = cab;
  const m1 = {
    type: MIC_IDS[Math.round(v.mic)] || PLUG_MIC_DEFAULT.type,
    x: +v.micpos,
    y: 0,
    dist: +v.micdist,
    ang: +v.micang,
    s: 0,
  };
  if (Object.keys(PLUG_MIC_DEFAULT).some((k) => m1[k] !== PLUG_MIC_DEFAULT[k])) P.mic = m1;
  const t2 = Math.round(v.mic2);
  if (t2 > 0)
    P.mic2 = {
      type: MIC_IDS[t2 - 1] || 'ribbon',
      x: +v.mic2pos,
      y: 0,
      dist: +v.mic2dist,
      ang: +v.mic2ang,
      s: 0,
      blend: +v.blend,
      flip: Math.round(v.flip) === 1,
    };
  return P;
}
// clawd-o-matic amp settings (a preset's) -> Overdub params
export function ampParams(S) {
  const v = {};
  for (const k of ['gain', 'bass', 'mid', 'treble', 'presence', 'level']) if (S[k] != null) v[k] = +S[k];
  if (S.cab && S.cab !== 'own' && PLUG_CABS[S.cab]) v.cab = CAB_IDS.indexOf(S.cab);
  const pos = (m) => Math.round(Math.min(1.35, Math.hypot(+m.x || 0, +m.y || 0)) * 1000) / 1000;
  if (S.mic) {
    v.mic = Math.max(0, MIC_IDS.indexOf(S.mic.type));
    v.micpos = pos(S.mic);
    v.micdist = +S.mic.dist;
    v.micang = +S.mic.ang;
  }
  if (S.mic2) {
    v.mic2 = 1 + Math.max(0, MIC_IDS.indexOf(S.mic2.type));
    v.mic2pos = pos(S.mic2);
    v.mic2dist = +S.mic2.dist;
    v.mic2ang = +S.mic2.ang;
    v.blend = +S.mic2.blend;
    v.flip = S.mic2.flip ? 1 : 0;
  }
  return v;
}

export function ampDevice(id) {
  const A = PLUG_AMPS[id];
  // (Abyss's octave divider: only the amps with one; plugin.js loads PLUG_WORKLETS as 'clawd-amps', from its file here)
  const worklets = A.sub ? workletFiles({ 'clawd-amps': PLUG_WORKLETS }, 'amp.' + id) : null;
  return {
    id: 'amp.' + id,
    name: A.name,
    kind: 'effect',
    cat: 'amp',
    amp: id,
    kindLabel: TONE_LABEL[A.tone] || 'AMP',
    tone: A.tone,
    style: A.style,
    blurb: A.blurb,
    nod: A.nod,
    by: 'clawd',
    source: 'clawd-o-matic',
    params: AMP_PARAMS.map((p) => Object.assign({}, p)),
    look: { amp: id, style: A.style },
    latency: 256 / 48000, // (the two 2x-oversampled stages: 128 samples each; the instance reports it at its own rate)
    worklets,
    build(c, kit) {
      if (A.sub) c.__clawdAmpWorklets = kit.loaded('clawd-amps'); // (plugAmp builds the octave only when they're in)
      const amp = clawd.plugAmp(c);
      return {
        input: amp.input,
        output: amp.output,
        latency: amp.latency,
        amp,
        set(v, x) {
          amp.set(ampSettings(id, v), x && !x.first ? x.t : undefined);
        },
        dispose() {
          amp.dispose();
        },
      };
    },
  };
}

export function registerAmps() {
  const out = [];
  for (const id of Object.keys(PLUG_AMPS)) {
    try {
      out.push(defineDevice(ampDevice(id)));
    } catch (e) {
      console.error('guitar: amp ' + id + ' not registered:', e.message);
    }
  }
  return out;
}
