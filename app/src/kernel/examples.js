// @ts-check
// Two reference kernels that prove the platform end to end (compile -> worklet -> check -> instance). Importing this
// module registers them. They are small on purpose: read them next to docs/DEVICES.md.
import { defineDevice, getDevice } from '../devices/registry.js';

export const TESTSYNTH = {
  id: 'core.testsynth',
  name: 'Test Synth',
  kind: 'instrument',
  cat: 'synth',
  by: 'overdub',
  blurb: 'Two saws and a filter: the reference kernel synth',
  params: [
    {
      key: 'cutoff',
      label: 'CUTOFF',
      min: 80,
      max: 12000,
      def: 1800,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'brighter as it opens',
    },
    {
      key: 'reso',
      label: 'RESO',
      min: 0.5,
      max: 8,
      def: 1.2,
      unit: 'x',
      role: 'shape',
      desc: 'a vocal peak at the cutoff',
    },
    {
      key: 'env',
      label: 'ENV',
      min: 0,
      max: 4,
      def: 1.5,
      unit: 'x',
      role: 'depth',
      desc: 'how far each note opens the filter (octaves)',
    },
    { key: 'attack', label: 'ATTACK', min: 0.001, max: 2, def: 0.005, curve: 'log', unit: 's', role: 'attack' },
    { key: 'decay', label: 'DECAY', min: 0.01, max: 3, def: 0.3, curve: 'log', unit: 's', role: 'decay' },
    { key: 'sustain', label: 'SUSTAIN', min: 0, max: 1, def: 0.6, role: 'level' },
    { key: 'release', label: 'RELEASE', min: 0.01, max: 4, def: 0.25, curve: 'log', unit: 's', role: 'release' },
    {
      key: 'detune',
      label: 'DETUNE',
      min: 0,
      max: 0.5,
      def: 0.08,
      unit: 'st',
      role: 'width',
      desc: 'how far apart the two saws are',
    },
  ],
  look: {
    color: '#2c3e66',
    ink: '#e8f0ff',
    shape: 'box',
    finish: 'brushed',
    knob: 'chicken',
    label: 'plate',
    led: '#7dd3ff',
  },
  tail: 4,
  kernel: `({
  poly: 8,
  create({ sr, seed, dsp }) {
    return {
      voice() {
        const a = dsp.osc('saw'), b = dsp.osc('saw'), f = dsp.svf(), amp = dsp.adsr(), fenv = dsp.adsr();
        let hz = 440, vel = 0;
        return {
          start(pitch, v, p) {
            hz = dsp.mtof(pitch); vel = v;
            a.reset(0); b.reset(0.37);
            amp.gate(true); fenv.gate(true);
          },
          release(p) { amp.gate(false); fenv.gate(false); },
          render(L, R, n, p) {
            amp.set(p.attack, p.decay, p.sustain, p.release);
            fenv.set(p.attack * 0.5, p.decay, 0.2, p.release);
            const det = Math.pow(2, p.detune / 24);
            a.freq(hz / det); b.freq(hz * det);
            const g = 0.19 * (0.25 + 0.75 * vel);
            for (let i = 0; i < n; i++) {
              const e = fenv.next();
              f.set(Math.min(18000, p.cutoff * Math.pow(2, p.env * e * vel)), p.reso);
              const y = f.lp(a.next() + b.next()) * amp.next() * g;
              L[i] += y; R[i] += y;
            }
            return amp.active();
          },
        };
      },
    };
  },
})`,
};

export const TESTFILTER = {
  id: 'core.testfilter',
  name: 'Test Filter',
  kind: 'effect',
  cat: 'filter',
  by: 'overdub',
  blurb: 'A resonant filter with drive: the reference kernel effect',
  params: [
    { key: 'mode', label: 'MODE', opts: ['LP', 'BP', 'HP'], def: 0 },
    { key: 'cutoff', label: 'CUTOFF', min: 40, max: 16000, def: 5000, curve: 'log', unit: 'Hz', role: 'tone' },
    { key: 'reso', label: 'RESO', min: 0.5, max: 10, def: 1, unit: 'x', role: 'shape' },
    {
      key: 'drive',
      label: 'DRIVE',
      min: 0,
      max: 24,
      def: 0,
      unit: 'dB',
      role: 'drive',
      desc: 'pushes the filter into soft saturation',
    },
    { key: 'mix', label: 'MIX', min: 0, max: 100, def: 100, unit: '%', role: 'mix' },
  ],
  look: {
    color: '#1f6f5c',
    ink: '#eafff7',
    shape: 'box',
    finish: 'flat',
    knob: 'black',
    label: 'stencil',
    led: '#9dffcf',
  },
  kernel: `({
  create({ sr, seed, dsp }) {
    const fl = dsp.svf(), fr = dsp.svf();
    const osL = dsp.oversample2x(), osR = dsp.oversample2x();
    let drive = 1, makeup = 1;
    const shape = (x) => dsp.tanh(x * drive) * makeup;
    const dl = dsp.delay(64), dr = dsp.delay(64);   // keeps the dry path in time with the oversampled one
    return {
      latency: 23,
      process(L, R, n, p) {
        fl.set(p.cutoff, p.reso); fr.set(p.cutoff, p.reso);
        drive = dsp.dB(p.drive); makeup = 1 / Math.sqrt(drive);
        const wet = p.mix / 100, mode = p.mode;
        // a band-pass is quieter by nature: bring it up so the knob sweeps at about the same level
        const trim = mode === 1 ? 1.6 : 1;
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          const sl = osL.process(xl, shape), sr2 = osR.process(xr, shape);
          let yl, yr;
          if (mode === 0) { yl = fl.lp(sl); yr = fr.lp(sr2); }
          else if (mode === 1) { yl = fl.bp(sl) * trim; yr = fr.bp(sr2) * trim; }
          else { yl = fl.hp(sl); yr = fr.hp(sr2); }
          const dxl = dl.read(23), dxr = dr.read(23);
          dl.write(xl); dr.write(xr);
          L[i] = dxl + (yl - dxl) * wet;
          R[i] = dxr + (yr - dxr) * wet;
        }
      },
    };
  },
})`,
};

export const EXAMPLES = [TESTSYNTH, TESTFILTER];
for (const d of EXAMPLES) if (!getDevice(d.id)) defineDevice(d);
