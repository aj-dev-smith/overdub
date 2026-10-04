// KERNEL_GUIDE: what an agent needs in context to write an Overdub device (the agent layer puts it in the system
// prompt / the define_device tool description). Every API name and signature here is checked against kernel/dsp.js
// by tools/kernel-test.js, and both examples pass checkDevice there. Keep it compact and exact.

export const GUIDE_EFFECT = {
  id: 'claude.tape-echo', name: 'Tape Echo', kind: 'effect', cat: 'time', by: 'claude',
  blurb: 'Tempo-synced echoes that darken as they repeat',
  params: [
    { key: 'division', label: 'TIME', opts: ['1/16', '1/8', '1/8.', '1/4', '1/2'], def: 2 },
    { key: 'feedback', label: 'REPEATS', min: 0, max: 95, def: 40, unit: '%', role: 'feedback' },
    { key: 'tone', label: 'TONE', min: 500, max: 12000, def: 3500, curve: 'log', unit: 'Hz', role: 'tone' },
    { key: 'mix', label: 'MIX', min: 0, max: 100, def: 30, unit: '%', role: 'mix' },
  ],
  look: { color: '#8a5a2b', ink: '#fff3e0', shape: 'box', finish: 'hammer', knob: 'cream', label: 'script', led: '#ffb347' },
  tail: 6, trails: true,
  kernel: `({
  create({ sr, seed, dsp }) {
    const BEATS = [0.25, 0.5, 0.75, 1, 2];
    const max = sr * 4;
    const dl = dsp.delay(max), dr = dsp.delay(max);
    const tl = dsp.onepole(), tr = dsp.onepole();
    const time = dsp.smooth(80, sr / 4);          // the delay time glides like tape (in samples)
    const wow = dsp.lfo('sine', 0.6);
    return {
      process(L, R, n, p, t) {
        const target = Math.min(max - 8, BEATS[p.division] * 60 / t.bpm * sr);
        tl.set(p.tone); tr.set(p.tone);
        const fb = p.feedback / 100, mix = p.mix / 100;
        for (let i = 0; i < n; i++) {
          const d = time.tick(target) + 6 * wow.next();
          const yl = dl.cubic(d), yr = dr.cubic(d);
          dl.write(L[i] + dsp.tanh(tl.lp(yl) * fb));
          dr.write(R[i] + dsp.tanh(tr.lp(yr) * fb));
          L[i] += yl * mix;
          R[i] += yr * mix;
        }
      },
    };
  },
})`,
};

export const GUIDE_INSTRUMENT = {
  id: 'claude.glass-harp', name: 'Glass Harp', kind: 'instrument', cat: 'pluck', by: 'claude',
  blurb: 'Plucked strings with a soft glassy shimmer',
  params: [
    { key: 'decay', label: 'DECAY', min: 0.3, max: 8, def: 3, curve: 'log', unit: 's', role: 'decay' },
    { key: 'bright', label: 'BRIGHT', min: 0, max: 1, def: 0.6, role: 'tone' },
    { key: 'shimmer', label: 'SHIMMER', min: 0, max: 100, def: 30, unit: '%', role: 'mix' },
  ],
  look: { color: '#3b4f7a', ink: '#eef3ff', knob: 'chrome', led: '#9fd8ff' },
  tail: 8,
  kernel: `({
  poly: 8,
  create({ sr, seed, dsp }) {
    const ch = dsp.chorus(0.6, 0.35);
    return {
      voice(i) {
        const s = dsp.karplus(220, 3, 0.6, seed + i);
        const glass = dsp.osc('sine'), env = dsp.adsr(0.002, 1.2, 0, 0.4);
        let gl = 0, gr = 0, v = 0;
        return {
          start(pitch, vel, p) {
            s.set(p.decay, p.bright).pluck(vel, dsp.mtof(pitch));
            glass.freq(dsp.mtof(pitch + 12)).reset(0);
            env.gate(true);
            const pan = dsp.clamp((pitch - 60) / 48, -0.5, 0.5);   // low notes left, high notes right
            gl = Math.cos((pan + 0.5) * Math.PI / 2); gr = Math.sin((pan + 0.5) * Math.PI / 2);
            v = vel;
          },
          release(p) { s.mute(0.15); env.gate(false); },
          render(L, R, n, p) {
            const sh = 0.25 * p.shimmer / 100 * v;
            for (let i = 0; i < n; i++) {
              const y = 0.62 * s.next() + sh * glass.next() * env.next();
              L[i] += y * gl; R[i] += y * gr;
            }
            return s.active() || env.active();
          },
        };
      },
      process(L, R, n, p) {
        for (let i = 0; i < n; i++) {
          ch.tick(L[i], R[i]);
          L[i] = dsp.softclip(L[i] + 0.3 * ch.l);     // gentle ceiling for big chords
          R[i] = dsp.softclip(R[i] + 0.3 * ch.r);
        }
      },
    };
  },
})`,
};

const fmtDef = (d) => {
  const { kernel, ...rest } = d;
  const json = JSON.stringify(rest, null, 0).replace(/"(\w+)":/g, '$1: ').replace(/,(?=[{"\w])/g, ', ');
  return `${json.slice(0, -1)}, kernel: \`\n${kernel}\` }`;
};

export const KERNEL_GUIDE = `# Writing an Overdub device (a kernel)

A device is a definition plus a kernel: the source of ONE JavaScript expression that evaluates to an object. It runs
in an AudioWorklet and gets \`dsp\` (below) and nothing else: no DOM, fetch, Date or timers; Math.random throws. The
host does stereo I/O, polyphony, sample-accurate notes, param smoothing, hot reload, bypass, and silencing faults.

## The definition

{ id: '<author>.<slug>' (lowercase a-z 0-9 . _ -, forever: songs refer to it; e.g. 'claude.tape-echo'),
  name: 'Tape Echo', kind: 'effect' | 'instrument',
  cat: synth keys drums bass pluck sampler | dynamics eq filter pitch drive fuzz amp mod time ambient glitch utility other,
  blurb: '<= 60 chars: what it does for the player',
  params: [ParamSpec], look: { ... }, tail?: seconds it rings after the input/notes stop (default 0),
  drone?: true if it never falls silent on its own, trails?: true to let the tail ring out when bypassed,
  presets?: [{ name: 'Felt', params: { tone: 0.2 } }] (named sounds; a param left out keeps its default),
  kernel: '<source>' }

ParamSpec, continuous: { key, label, min, max, def, curve?: 'lin' | 'log' (log needs min > 0; use it for Hz and
times), unit?: 'Hz' | 'dB' | 'ms' | 's' | '%' | 'st' | 'note' | 'x', role?, desc?, step? }
ParamSpec, switch: { key, label, opts: ['LP', 'BP', 'HP'], def: 0 } (the kernel sees the index 0, 1, 2).
role (so agents and macros find the right knob): tone level drive mix time feedback rate depth size decay attack
release pitch shape width gate sens. Keys are forever; never 'id', 'on' or 'uid'. 3-5 good params beat 10.

look (the face is drawn from it; missing fields are picked from the id): color, ink, led (hex), shape box | wide |
mini | round | wah | rack, finish flat | sparkle | brushed | hammer | stripe | check, knob black | chicken | cream |
chrome | small, label script | block | plate | stencil. Instruments get a synth panel in color/ink/knob.

## The kernel

Effect:
({ create({ sr, seed, dsp, params }) {
     // allocate here: filters, delay lines, buffers, lookup tables
     return { latency?: samples, process(L, R, n, p, t) { /* in place: L/R hold the input, write the output */ } };
} })

Instrument (the host owns voices: poly of them, default 8, max 64; it steals the oldest released voice, then the
oldest, with a 5 ms fade):
({ poly: 8,
   create({ sr, seed, dsp, params }) {
     return {
       voice(i) { return {                     // called poly + 2 times up front; i = 0, 1, 2... (seed + i for variety)
         start(pitch, vel, p) {},               // MIDI pitch (60 = C4), vel 0..1; reset ALL per-note state here
         release(p) {},                         // note-off: begin the release
         render(L, R, n, p, t) { return alive }, // ADD into L[0..n-1] and R[0..n-1]; return false once silent
         stop?() {},                            // optional: the host cut this voice
       }; },
       process?(L, R, n, p, t) {},              // optional, after the voices are summed: shared filter, chorus, reverb
     };
} })

- n is the number of frames to do now. It varies (the host splits blocks at note events): loop to n, never L.length.
- p is the params object by key, smoothed by the host (continuous params glide ~10 ms, switches and stepped params
  snap, values are clamped to their range). Read it; never store or mutate it.
- t = { bpm, playing, beat, bend, mod, sustain }: the transport at the start of the block (beat advances while
  playing) and the player's expression. Sync time to t.bpm (seconds per beat = 60 / t.bpm) and LFOs with
  lfo.sync(beats, t). t.bend is the pitch bend in semitones (multiply your frequencies by 2^(t.bend / 12)), t.mod
  the mod wheel 0..1 (vibrato, brightness, a rotor: your choice), t.sustain whether the pedal is down (the host
  already holds note-offs while it is). In a voice's render they are that note's own (a note can carry its own bend
  and mod); in process, the channel's. A kernel that ignores them still plays.
- Mono sources arrive on both L and R. Output is always stereo.
- render must return false (e.g. return env.active()) when the voice has finished, or the note counts as stuck.

## Rules (the device check enforces most of them)

1. No allocation in process/render/start/release: no new arrays, objects, closures or string building per block.
   Create everything in create() or voice(). (Float32Array via dsp.buffer(n) in create.)
2. No Math.random (it throws): use dsp.rng(seed) / dsp.noise(seed). Same seed, same sound, every render.
3. Effects keep their level: at default settings the output should measure within 3 LU of the input (the check
   says "level: +x LU"). Instruments: about -14 LUFS for the test phrase (-18 is fine for plucks and drums, whose
   peaks are high), true peaks under -1 dBTP. Over +6 dBTP at default settings fails the check; so does a runaway
   (over +24 dBFS) at any setting, while over +6 dBFS at an extreme setting is a warning.
4. Heavy nonlinearities (drive, fuzz, folding, clipping with gain) alias: run them through dsp.oversample2x() or
   oversample4x() and declare latency (the oversampler's .latency) if you time-align a dry path.
5. Every change must be smooth: p is smoothed, but glide anything you derive from it that jumps (a delay time:
   dsp.smooth) so knob moves never click.
6. Guard the ends of every range: each param is tested at min and max, all at min, all at max. Clamp before
   log/sqrt/division; keep feedback below 1.
7. Put pow/exp/tan in coefficient formulas per block, not per sample, where you can.

## dsp (all factories allocate: call them in create() or voice())

Generators have next(); one-in/one-out processors have tick(x); stereo processors have tick(l, r) and leave the WET
signal in .l and .r. Times in seconds unless named ms; frequencies in Hz; gains linear unless named dB.

Math: sr, TAU, PI, clamp(x, lo, hi), lerp(a, b, t), mtof(midi), ftom(hz), dB(db) -> gain, toDb(gain) -> dB,
sstep(t) smoothstep, tanh(x) (fast rational; exactly +-1 beyond +-3), softclip(x) (cubic; +-1 beyond +-1.5),
hardclip(x, lim = 1), fold(x) (triangle wavefolder: identity in -1..1, folds beyond), crush(x, bits).

Random: rng(seed) -> r; r() in [0, 1), r.bi() in [-1, 1), r.gauss(). noise(seed, 'white' | 'pink' | 'brown').next()
(white: uniform +-1; pink and brown: RMS about 0.3).

Oscillators: osc(shape = 'saw'), shapes 'sine' 'saw' 'square' 'pulse' 'tri' (band-limited) -> .freq(hz) (chainable)
.next() (-1..1) .reset(phase = 0) .wave(shape) .phase .pw (pulse width 0.02..0.98). blep(t, dt) / blamp(t, dt): the
polyBLEP / polyBLAMP residuals (phase t, increment dt) for band-limiting your own shapes.
lfo(shape = 'sine', hz = 1, seed?), shapes 'sine' 'tri' 'saw' 'square' 'sh' (sample and hold) 'drift' (smooth random)
-> .next() (-1..1) .uni() (0..1) .rate(hz) .sync(beats, t) (call once per block: one cycle per beats, locked to
t.beat while playing) .phase .offset (0..1, phase offset used by sync).

Filters: svf() (zero-delay state variable; stable at any setting; retune every sample if you like) -> .set(fc, q = 0.707,
gainDb = 0), then ONE of .lp(x) .bp(x) .hp(x) .notch(x) .peak(x) (resonant peak) .allpass(x) .bell(x) (EQ bell by
gainDb) .lowshelf(x) .highshelf(x) per sample (each call advances the filter); or .tick(x) then read .low .band .high.
q: 0.5 soft, 0.707 flat, 2-10 resonant, 20+ ringing. One filter per channel.
onepole(fc?) -> .set(fc) .lp(x) .hp(x). dcblock() -> .tick(x).
biquad() -> .set(type, fc, q = 0.707, gainDb = 0) with type 'lp' 'hp' 'bp' 'notch' 'allpass' 'peak' 'lowshelf'
'highshelf', then .tick(x). (set costs trig: per block.)

Delays: delay(maxSamples) -> .read(d) (linear, d >= 1 samples) .cubic(d) (Hermite, d >= 2, for modulated delays)
.write(x) .ms(ms) -> samples .clear(). Read BEFORE you write each sample: read(d) is the input from d samples ago.
allpass(len, g = 0.5) -> .tick(x). comb(len, fb = 0.8, damp = 0.2) -> .tick(x) .set(fb, damp).

Envelopes: adsr(a = 0.005, d = 0.1, s = 0.7, r = 0.2) -> .gate(on) .hit() (attack, then release on its own) .next()
(0..1) .active() .set(a, d, s, r) (cheap when unchanged: fine per block) .reset(). Exponential segments; a retrigger
attacks from the current level (no click). ar(a = 0.002, r = 0.3): the same, holding at 1 while gated.
follower(attackMs = 5, releaseMs = 100) -> .tick(x) (the level of x). smooth(ms = 10, init = 0) -> .tick(target)
.reset(v) .value. slew(riseMs = 10, fallMs = riseMs, init = 0) -> .tick(target).

Oversampling: oversample2x() / oversample4x() -> .process(x, fn) runs fn (a one-sample function you make ONCE in
create, reading variables you update per block) at 2x / 4x and returns one band-limited sample. .latency = 23 / 27.5
samples. Use one per channel.

Physical models: karplus(hz = 220, decay = 3, bright = 0.5, seed?) (plucked string) -> .pluck(vel = 1, hz?) .next()
.freq(hz) .set(decay, bright) (from the next pluck) .mute(t60 = 0.08) (damp it: a release) .active().
modal(freqs, decays, gains?) (resonator bank: drums, bells, bars; arrays; decays are T60 s; gains default 1/n) ->
.strike(vel = 1) .tick(x) (excite with a signal) .next() .tune(ratio) .damp(k) (k < 1 chokes) .active().

Space: fdn(size = 0.6, decay = 2, damp = 0.4, seed?) (8-line modulated reverb; size 0..1 room to hall, decay = T60 s,
damp 0 bright .. 1 dark) -> .tick(l, r) then .l .r (wet) .set(size, decay, damp). chorus(depth = 0.5, rate = 0.8)
(two voices in quadrature) -> .tick(l, r) then .l .r (wet) .set(depth, rate). buffer(n) -> Float32Array(n).

## What the check reports (define_device returns it)

{ ok, errors, warnings, level: { lufs, deltaLU }, truePeak, nan, tail: { seconds, decays }, cpu: { pct },
latency: { samples }, deterministic, extremes: { cases, failed }, voices?: { poly, maxVoices, steals }, stuck? }.
ok is false on a compile error (with the line), NaN/Infinity, a peak over +6 dBTP at defaults, a runaway at an
extreme setting, or a stuck note. Effects are
rendered with a DI guitar strum and a drum loop; instruments play chords, a melody, a fast run, low to high notes
and soft to hard velocities. Fix every error; act on warnings unless you mean them.

## Example: an effect

${fmtDef(GUIDE_EFFECT)}

## Example: an instrument

${fmtDef(GUIDE_INSTRUMENT)}
`;
