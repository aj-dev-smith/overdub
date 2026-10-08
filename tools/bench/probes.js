// The bench's test sources: two tiny kernel instruments the scorer plays through a device to measure it, the way a
// bench engineer feeds a pedal a click or a sine. They live only in probe renders (tools/bench/score.js puts them in
// the probe song's devices); no task song uses them and no agent needs to know they exist.
//
//   bench.click   a 1 kHz blip, 3 ms decay, 0.5 x velocity: an impulse you can see echoes of
//   bench.sine    a pure sine at the note's pitch, 0.25 x velocity, 10 ms linear fades: a test tone

const click = `({
  poly: 4,
  create({ sr, dsp }) {
    const k = Math.exp(-1 / (0.003 * sr)), inc = dsp.TAU * 1000 / sr;
    return {
      voice() {
        let ph = 0, a = 0;
        return {
          start(pitch, vel) { ph = 0; a = 0.5 * vel; },
          release() {},
          render(L, R, n) {
            for (let i = 0; i < n; i++) { const y = a * Math.sin(ph); ph += inc; a *= k; L[i] += y; R[i] += y; }
            return a > 1e-7;
          },
        };
      },
    };
  },
})`;

const sine = `({
  poly: 4,
  create({ sr, dsp }) {
    const step = 1 / (0.01 * sr);
    return {
      voice() {
        let ph = 0, inc = 0, g = 0, target = 0, v = 0;
        return {
          start(pitch, vel) { ph = 0; g = 0; target = 1; inc = dsp.TAU * dsp.mtof(pitch) / sr; v = 0.25 * vel; },
          release() { target = 0; },
          render(L, R, n) {
            for (let i = 0; i < n; i++) {
              if (g < target) g = Math.min(target, g + step); else if (g > target) g = Math.max(target, g - step);
              const y = v * g * Math.sin(ph); ph += inc; if (ph > dsp.TAU) ph -= dsp.TAU;
              L[i] += y; R[i] += y;
            }
            return target > 0 || g > 0;
          },
        };
      },
    };
  },
})`;

const def = (id, name, kernel) => ({
  id,
  name,
  kind: 'instrument',
  cat: 'other',
  by: 'overdub',
  blurb: 'a bench test source',
  params: [],
  tail: 0.1,
  kernel,
  version: 1,
});

export const PROBE_DEVICES = {
  'bench.click': def('bench.click', 'Bench Click', click),
  'bench.sine': def('bench.sine', 'Bench Sine', sine),
};
