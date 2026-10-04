<!-- vendored verbatim from clawd-o-matic/web/../docs/PEDALS.md @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it -->
# Pedal packs

The Plug in tab runs a live guitar through a pedalboard and an amp, all in Web Audio. The board is an ordered list of
pedals with the amp somewhere in it. Players add pedals from a library, drag them around (across the amp too), stomp
them on and off, and save presets. You add pedals to the library by writing a **pedal pack**: one file,
`web/pedals/NN-name.js`, which calls `pedalDef({...})` once for each pedal. You don't edit any core file.

- `web/pedals.js` is the platform: the registry, the DSP kit (`PFX`), worklet loading, the board model, the audio rig
  (bypass, rewiring) and the knob.
- `web/pedalboard.js` is what you see: the procedural faces, the board, the library and the chain strip.
- `web/pedals/00-classic.js` holds the first six pedals, all written this way. Read it alongside this doc.
- `web/tools/pedal-check.js` checks every pedal. **Run it on yours before you commit.**

## Where your code runs

`node web/build.js` concatenates `web/pedals/*.js` in file-name order, right after `pedals.js`, into the page's single
app scope. That scope is shared with the whole app (`$`, `song`, `ctx`, `play`, `W`, `H`, `g`… are all taken), and a
duplicate top-level `const` breaks the page. So:

- **Wrap your file in a block `{ … }` or an IIFE** if it declares anything, or give every top-level name a prefix that's
  yours (for example `clamWah…`).
- At load, do nothing but call `pedalDef`. Any other work (buffers, curves) goes inside `build()`.
- The page is the only place it runs. Chrome is the target, and `AudioWorklet` is fine to use.
- Name the file `NN-name.js` with a two-digit number, for example `20-fuzzes.js` or `45-weird.js`. `00` is taken by
  the classics. The number sets the order the files load in, and so the order within a library category.

## The def

```js
pedalDef({
  id: 'clamwah',             // 2-24 of a-z 0-9 -, unique, never 'amp'. Saves and presets use it forever: don't rename it.
  name: 'Clam Wah',          // ≤16 characters, shown in FONTS.dirt on the face. A sea-creature/crab/punk pun.
  kind: 'AUTO-WAH',          // ≤18 characters, capitals: the label under the name. 'X · Y' is fine ('DELAY · IN TIME').
  cat: 'filter',             // dynamics filter pitch drive fuzz synth mod time ambient glitch utility (library tab, placement)
  nod: 'the envelope filter funk players stomp on',   // what it tips its hat to, in words ("Tips its hat to …"). No trademarks.
  blurb: 'Pick hard and it quacks: a filter that follows you',   // ≤60 characters, what it does for you
  color: '#c43b8e', ink: '#fff4fa',   // the enclosure and the printing on it (#hex; keep them readable together)
  look: { shape: 'box', finish: 'sparkle', knob: 'chrome', label: 'plate', led: '#7dffb8' },   // optional; see Faces
  where: 'pre',              // 'pre' (before the amp, the default) or 'post': where Add puts it
  trails: false,             // true: a delay/reverb whose tail rings on after it's stomped off (see Bypass)
  trim: 4.5,                 // dB of makeup on its output when on, measured with pedal-check (see Levels)
  knobs: [ … ],              // 0-6 of them (see Knobs)
  worklets: { 'pfx-env': PFX.ENV },   // AudioWorkletProcessors it needs, { processorName: sourceString } (see Worklets)
  stereo: false,             // true if it outputs two different channels (information only; mono in is always fine)
  latency: 0,                // seconds of latency it adds when on (a pitch shifter's window, say), shown in the tab
  drone: false,              // true if it can sustain on its own (see Checks)
  tail: 0,                   // seconds its tail can legitimately ring after the input stops, if over 5 (big reverbs)
  build(c, kit) { … return { input, output, set(v, x) { … }, dispose() { … } }; },
});
```

`pedalDef` refuses a bad def with a console warning, and pedal-check fails on it: an id that's malformed, no `build`,
a knob whose default is out of its range, or more than six knobs. **An id that's already taken** is a `console.error`,
and the pedal that registered first keeps it (never silently replaced: saves and presets mean that one). So is a
worklet processor name another pack already declared with different code. The rest of the page carries on without
that pedal. pedal-check also fails on two pedals with the same `name` (ignoring case and punctuation).

### build(c, kit)

`build` is called once each time the pedal joins a board (a player can have two of the same pedal, and each gets its own
`build`). `c` is the AudioContext, which is an `OfflineAudioContext` in the tools, and `kit` is the DSP kit bound to
`c` (see The kit). Return:

| key | |
|---|---|
| `input` | an AudioNode the guitar goes into (mono, or stereo if a stereo pedal is before you) |
| `output` | an AudioNode your sound comes out of |
| `set(v, x)` | apply the knobs. `v` is this pedal's entry: `{ uid, id, on, ...knob values }` (read `v.sens` and so on). `x` is `{ bpm, first, t, to(param, value, tc?), note(i), clock, phaseAt(t, bars?) }` (the clock: see In time with the band). Use `x.to(param, value)` for every AudioParam. It jumps on the first call (`first`) and glides after that (`setTargetAtTime`, time constant `tc`, default 15 ms), so knobs never zipper. `x.note(i)` is `DELAY_NOTES[i]` in seconds at the song's tempo. `set` is called again when your knobs change and when the song's tempo changes (only then), so tempo-synced pedals just read `x.bpm` or `x.note()`. **Don't look at `v.on`**: the wrapper handles bypass. |
| `sync(x)` | optional. Called when the band's bar grid matters to you: see In time with the band. |
| `dispose()` | optional. The pedal left the board (or the player unplugged), so clean up anything the kit didn't start (see the kit's `own`/`onDispose`). |
| `latency` | optional, seconds, if it depends on the knobs (otherwise use the def's `latency`) |

Anything else on the object is yours. Tests reach it with `rig.chain.pedal(uid)`; the gate puts its worklet node there.

If `build` throws or returns no `input`/`output`, the pedal becomes a wire and the error goes to the console.

### In time with the band

Tremolos, choppers, auto-pans, step filters and glitch grids want their loop to start on the band's bar lines. Don't
poll `PLUG.clock` yourself: the rig has one clock for the whole board.

- **`x.clock`** (in `set`, and `kit.clock` in `build`) is live: `playing` (the band is playing on this context),
  `bpm` (the bar's tempo, tempo map included), `beatsPerBar` (4: every bar in the app is 4/4), `barTime(b)` (audio
  time bar `b` starts), `barAt(t)` (the fractional bar at audio time `t`), `bar()` (now), `next(t?)` (the first bar
  line after `t`: `{ bar, time, len }`), and **`phaseAt(t, bars = 1)`**: where audio time `t` is in a cycle of `bars`
  bars, 0 to 1. `phaseAt(t, 2)` is a two-bar loop that starts on even bars; `phaseAt(t, 1 / 4)` is the beat.
  `x.phaseAt` is the same function.
- **`sync(x)`**, if your pedal returns one, is called with `{ why, playing, bpm, beatsPerBar, bar, next, barLen, now,
  phaseAt, barTime, barAt, clock }`. `next` is the audio time of the next bar line and `bar` its number, so the usual
  thing is to restart your loop there (`osc.start(x.next)`, or post `x.next` to your worklet). `why` is `'build'` (once,
  right after your first `set`), `'start'` / `'stop'` (the band), `'tempo'`, `'jump'` (the grid moved: a seek, a loop
  that isn't whole bars) or `'bar'` (each new bar, about a bar ahead: re-anchor if you drift). One watcher calls every
  pedal's `sync`, ten times a second at most and only when something changed, and only while a pedal on the board has one.
- When the band isn't playing, the clock is a free grid of bars from audio time 0 at the song's tempo. **Offline** (the
  tools, bounces) it's that grid always, so a render is the same every time, and `sync` is called once, at `'build'`.
- `rig.useClock(src)` swaps the source (anything shaped like `PLUG.clock`: `playing() bpm() bar() barTime(b)`, and
  `beatsPerBar()` if it knows better), or `null` for the free grid. The tools use it to fake a band.

```js
build(c, k) {   // a tremolo whose cycle starts on the bar lines
  const input = k.G(1), vca = k.G(0.5), depth = k.G(0.5);
  let osc = null, hz = 2;
  k.chain(input, vca); depth.connect(vca.gain);
  // a new LFO starting its cycle at `at`, taking over from the old one there
  const start = (at) => { const o = k.own(c.createOscillator()); o.frequency.value = hz; o.connect(depth); o.start(at); if (osc) osc.stop(at); osc = o; };
  return { input, output: vca,
    set(v, x) { hz = 1 / x.note(v.rate); if (osc) x.to(osc.frequency, hz); },
    sync(x) { if (x.why !== 'bar') start(x.next); } }; // (a straight note divides a bar: only a start, jump or tempo moves it)
}
```

Pedals written before the clock existed (Jelly Pulse, Claw Chopper, Sidestep, Pump Fish and the glitch grids poll
`PLUG.clock` on their own timers) still work; new pedals should use `sync`.

### Bypass: insert or trails

You never write on/off. The platform wraps every pedal:

- **insert** (the default): `in → dry → out` and `in → your pedal → wet (dB(trim) when on) → out`. The footswitch
  crossfades dry and wet along a 10 ms raised cosine (click-free). An insert pedal that's been off for 80 ms stops
  being fed, so it costs nothing. **Your output is the whole sound**: if you want some dry signal (a mix knob), mix it
  yourself, as the Tidepool chorus does.
- **trails** (`trails: true`): `in → out` at unity, always, and `in → send (on/off) → your pedal → dB(trim) → out`.
  **Your output must be WET ONLY.** The send switches, so the repeats or the reverb ring on after it's stomped off.
  Use this for delays, reverbs, loopers and freezes.

Off means exactly the dry signal. pedal-check makes sure that's true to −90 dB.

## Knobs

Each knob is an array or an object:

```js
knobs: [
  ['sens', 'SENS', 0, 10, 6],                        // [key, LABEL, min, max, default, step?, fmt?]
  ['time', 'TIME', 0, 5, 2, 1, PFX.noteFmt],         // step 1, shown as a note value (1/16 … 1/2)
  ['th', 'THRESH', -90, -30, -60, 1, (v) => Math.round(v) + ' dB'],
  { key: 'range', label: 'RANGE', opts: ['LO', 'HI'], def: 1 },   // a mini switch: the value is the index (0, 1, …)
]
```

- `key`: a short identifier, not `uid`, `id` or `on`. Saves store it, so don't rename it once you've shipped.
- `LABEL`: capitals, **≤9 characters** (the pixel font is tiny; 6-7 looks best).
- Without a step, knobs move in tenths. The 0-10 range is the house style for "amount" knobs; use real units only when
  the number means something to a player (dB, notes).
- `fmt(v)` returns the string shown under the knob and in its tooltip. It must return a string for every value.
- A switch (`opts`) draws as a toggle lever with its setting underneath. Click cycles it; arrow keys set it. Use 2-3
  options, each ≤5 characters.
- The drag, the keyboard, double-click to reset, and ARIA are all handled for you.

## Faces

Faces are drawn from the def, so you never write any CSS. Everything in `look` is optional. Anything you leave out is
picked from a hash of your id, so pedals look different from one another by default. Choose deliberately anyway.

| look | values | |
|---|---|---|
| `shape` | `box` (132 px, the default), `wide` (196 px; the default with 5-6 knobs), `mini` (100 px, ≤2 knobs), `round` (a 184 px disc, the fuzz-face; ≤3 knobs), `wah` (a treadle), `rack` (a 300 px, rack-ish unit: name and switch left, knobs right) | an unsuitable choice falls back to `box` |
| `finish` | `flat`, `sparkle` (metal flake), `brushed`, `hammer` (hammertone), `stripe` (two racing stripes in `ink`), `check` | |
| `knob` | `black`, `chicken` (chicken-head pointer), `cream`, `chrome`, `small` | |
| `label` | `script` (FONTS.dirt), `block` (pixel capitals), `plate` (a metal nameplate), `stencil` (outlined) | |
| `led` | a `#hex` | the on-LED's colour (red by default) |
| `treadle` | a knob key | with `shape: 'wah'`, that knob becomes the rocking treadle (drag it up and down) |
| `foot2` | a switch key | adds a second footswitch that cycles that switch (a `wide` or `rack` shape) |

Knobs lay themselves out: 1 is big, 2-3 sit in a row, 4 make a 2×2 grid, and 5-6 make a 3×2 grid of smaller knobs.
Phones (390 px) show two pedals across, with `wide` and `rack` full width.

## The kit

`build(c, kit)` gets `kit`. `PFX` is the same thing with no context, holding the helpers that don't make nodes
(`PFX.dB`, `PFX.noteFmt`, `PFX.ENV`, …).

| | |
|---|---|
| `kit.G(v = 1)` | GainNode |
| `kit.F(type, freq, Q?, gain?)` | BiquadFilterNode. **For lowpass/highpass, Web Audio's Q is resonance in dB** (0.7 is not Butterworth here; 0 is flat). For bandpass/peaking/notch it's the usual Q. |
| `kit.chain(a, b, c…)` | connects them in order and returns the last |
| `kit.shaper(k, bias = 0, over = '2x')` | WaveShaper: tanh at drive `k` with an asymmetry `bias`, normalised to ±1 and centred (no DC at rest). The drives use it. |
| `kit.curve(fn, over = '2x', n = 4096)` | WaveShaper from `fn(x)` over [−1, 1] (folders, crushers, rectifiers…) |
| `kit.delay(max, t = 0)` | DelayNode |
| `kit.lfo(rate, shape = 'sine')` | a **started** OscillatorNode, ±1, `shape` is `'sine' 'triangle' 'square' 'sawtooth'` or `[harmonic amplitudes]`. Connect it through `kit.G(depth)` into a param. |
| `kit.constant(v = 0)` | a started ConstantSourceNode (an offset to add to a param alongside an LFO or envelope) |
| `kit.noise({ secs = 2, seed = 1, color = 'white' \| 'pink' \| 'brown', channels = 1 })` | a deterministic noise AudioBuffer, cached per context |
| `kit.noiseSource(opts)` | a started, looping BufferSource of that noise |
| `kit.ir({ secs = 2, pre = 0.012, seed = 1, tail = 1.2, damp = 0.25, darken = 0.7, width = 1, channels = 2 })` | a reverb impulse response (the Deep Trench's, generalised): decaying noise, −60 dB at `secs`, `pre`-delay, getting darker as it goes (`damp` 0 bright … 1 dark, plus `darken` by `secs`), `width` 0 mono … 1 wide. Deterministic for a seed. It takes a few ms, so rebuild it with `kit.later` once a knob settles (see Deep Trench). |
| `kit.convolver(buffer?)` | ConvolverNode (live, a new `.buffer` crossfades from the old one instead of cutting its tail) |
| `kit.merge(L, R)` | a 2-channel ChannelMerger with L on the left and R on the right (`R` defaults to `L`) |
| `kit.pan(v)` | StereoPannerNode |
| `kit.envelope({ attack = 0.005, release = 0.12 })` | the **envelope follower**: an AudioWorkletNode. Connect audio in; out comes its envelope (0 to about 1, linear, one channel) as a control signal. Route it through `kit.G(depth)` into any AudioParam. Its `attack` and `release` are AudioParams in seconds. **Needs `worklets: { 'pfx-env': PFX.ENV }` in the def.** Returns `null` if worklets are unavailable, so keep a fallback path. |
| `kit.worklet(name, options)` | `new AudioWorkletNode(c, name, options)` for a processor your def's `worklets` loaded, or `null` if it failed (pass the signal through then) |
| `kit.later(fn, ms)` | setTimeout that's cleared if the pedal leaves the board |
| `kit.own(node)` / `kit.onDispose(fn)` | a source you started yourself, stopped on removal / a cleanup function |
| `kit.dB(d)`, `kit.toDb(g)`, `kit.clamp(v, lo, hi)` | |
| `kit.rng(seed)` | a seeded random in [−1, 1). **Never `Math.random`**: renders must be the same every time. |
| `kit.uid`, `kit.seed` | this instance's uid on the board (`'crabwalk'`, `'crabwalk2'`…) and a number made from it (stable across reloads, different for a second copy): `k.rng(k.seed)`, or `processorOptions: { seed: k.seed }` for a worklet, so two of a random-ish pedal don't move in lockstep and each renders the same every time |
| `kit.clock` | the bar clock (see In time with the band) |
| `kit.noteSec(i \| '1/8.', bpm)`, `kit.noteFmt(v)`, `kit.NOTES` | `DELAY_NOTES`: `['1/16', .25] ['1/8', .5] ['1/8.', .75] ['1/4', 1] ['1/4.', 1.5] ['1/2', 2]` (quarter notes) |
| `kit.c`, `kit.sr` | the context and its sample rate |

The kit stops everything it started (`lfo`, `constant`, `noiseSource`) and clears its timers when the pedal leaves the
board. Anything you started with `c.create…().start()` yourself must go through `kit.own(node)`.

### Worklets

For DSP that plain nodes can't do (pitch shifting, bit crushing, sample-and-hold, a looper in a pedal, granular
freezes), write an AudioWorkletProcessor as a **string** and declare it:

```js
{
const CRUSH = `class ReefCrush extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' }]; }
  process(ins, outs, p) {
    const i = ins[0], o = outs[0], q = Math.pow(2, p.bits[0] - 1);
    for (let ch = 0; ch < o.length; ch++) { const x = i[ch] || i[0], y = o[ch]; if (!x) { y.fill(0); continue; } for (let n = 0; n < y.length; n++) y[n] = Math.round(x[n] * q) / q; }
    return true;
  }
}
registerProcessor('reef-crush', ReefCrush);`;
pedalDef({ id: 'reefcrush', …, worklets: { 'reef-crush': CRUSH },
  build(c, k) {
    const n = k.worklet('reef-crush', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }) || k.G(1);
    return { input: n, output: n, set(v, x) { if (n.parameters) x.to(n.parameters.get('bits'), v.bits); } };
  } });
}
```

- The processor name (the `registerProcessor` string and the key in `worklets`) must be unique across all packs, so
  prefix it with your pedal's id.
- Make its nodes with `k.worklet`: when the pedal leaves the board they're sent `{ __pfxEnd }` and stop being processed
  (a processor returning `true` would otherwise run for ever after its node was let go). Your own `port.onmessage`
  sees that message too: ignore what you don't know.
- The source loads once per context (`pfxWorklet(c, name, src)`: a `data:` URL, falling back to `blob:`). The board
  builds your pedal once it has loaded. Offline, the tools `await rig.ready()`.
- `process` must return `true`, cope with a missing input (`ins[0][0]` can be undefined), and allocate nothing per
  call. Keep it deterministic: no `Math.random`, so seed your own LCG.
- A processor has no latency of its own. If you buffer (a pitch shifter's window), declare `latency`.

## Levels (measured, never guessed)

Nobody working on this can listen, so the levels are measured with `web/tools/pedal-check.js`. The reference is a
synthetic DI strum peaking at about −10 dBFS, which is a guitar on an interface with sensible gain. The guitar sits at
about −14 LUFS at the amp.

| cat | at its default knobs, on vs off, with the Clean and the Punk amp |
|---|---|
| `drive`, `fuzz` | **+0.5 to +3 LU** (a boost you can hear, like the classics: Clawdrive +1.8, Big Crab +2.4) |
| everything else | **within ±1.5 LU** |
| all | true peak of the rig (before the band's soft clip) **≤ −1 dBFS** |

Use `trim` (dB) to land it. It's the makeup on your output when the pedal is on, and it's what the classics use
(Clawdrive −10, Big Crab −17.5). Level knobs should put unity near their default. If the Clean and Punk amps disagree
by more than the band allows (the Punk amp compresses), change the voicing rather than the trim. A dry blend by default
helps.

## Checks

```sh
node web/build.js --out=/tmp/p.html
PAGE=/tmp/p.html PEDALS=clamwah,reefcrush node web/tools/pedal-check.js   # PLAYWRIGHT_CORE, CHROMIUM, OUTDIR as usual
```

For each pedal it prints one row (the level against off with each amp, true peak, bypass, extremes, latency, cost) and
exits 1 if anything fails:

1. **meta**: name ≤16, kind ≤18, blurb ≤60, a nod, `#hex` colours, knob labels ≤9, and `fmt` returning strings.
2. **level**: the bands above.
3. **bypass**: on the board but off equals no pedal, to −90 dB.
4. **extremes**: the pedal alone, 3 s of strum then silence. It tries every knob at its min and at its max (the others
   at default), all at min, all at max, and every switch position. It fails on NaN or Infinity, or a raw peak over
   +6 dBFS. The tail must die: below −60 dBFS by the end of the silence (6 s, or `tail + 1`), or falling at least
   1 dB/s (which passes with a note). A pedal that can sustain on its own at some settings (a drone synth, repeats
   that run away at the top of a knob, like Echo Reef's) sets `drone: true`. It's then held to this only at its
   defaults.
5. **latency and cost**: where an impulse's biggest response lands (noted if it's over 10 ms and not declared), and the
   offline render time as a percentage of real time. It's noted over 8%: a phone is several times slower, and a player
   can have 14 pedals.

It checks the platform (`CLOCK=0` skips it): `kit.uid`/`kit.seed`, `x.clock`/`x.phaseAt` offline, and `sync` through a
faked band starting, running bars, jumping, changing tempo and stopping. Then it runs the board itself (`BOARD=0` skips
it): pedals moved across the amp, added, removed and stomped on a live context, which must be click-free. That's
captured on the audio thread beside a reference tone, so a loaded machine's glitches aren't counted as clicks, and a
failing run is repeated (the median of three is judged); a deliberate hard cut at the end must still read as one. It also runs the board's UI (`UI=0` skips it). `WAV=1` writes each pedal's
Punk-amp render to `OUTDIR/pedal-<id>.wav`. Also run `node web/tools/plug-level.js` (with `PRESETS=0` if you didn't
touch presets). It checks the amps and the classic pedals end to end.

## Cost

The board shows what it costs the device (`CPU 12%` by the chain strip: a quarter second of the board rendered offline
and timed, a moment after it changes). It turns amber at 35% and says HEAVY at 60%, with a tip to switch off what's not
in use. On an M-series Mac the fourteen costliest pedals together are about 11-16%, so a slow phone can get there.
Keep yours cheap: pedal-check notes anything over 8% alone.

## Naming

- Sea creatures, crabs and punk: Clawdrive, Big Crab, Tidepool, Echo Reef, Deep Trench, Snapper, Clam Wah, Urchin Face,
  Kelp Forest, Barnacle Boost. Puns are welcome. Say what it's modelled on in `nod`, in words ("the green mid-hump
  overdrive", "the round sixties fuzz"), with no brand or model names anywhere in the UI.
- `blurb` says what it does for the player, not the circuit.
- ids are short and lowercase, with no pack prefix needed (just unique). Prefix worklet processor names with the id.

## Presets and saves

A player's board is saved as `[{ uid, id, on, ...knobs }, …, { id: 'amp' }, …]`. Presets (`web/presets.js`) can use
`board: [{ id: 'clamwah', sens: 7 }, 'amp', { id: 'delay', time: 3 }]` to place any pedals in any order. A pedal
listed there is on unless it says `on: false`, knobs it doesn't give are at their defaults, and with no `'amp'` in the
list the pre pedals go first, then the amp, then the post ones. The old `fx: { gate: {…}, drive: {…} }` shape still
means the classic board. If a pedal id isn't registered (a pack was removed), it's dropped quietly from saves and
presets. So **never rename an id or a knob key** once it has shipped, and keep old knob ranges meaning the same thing.

Tests can drive the board with `window.__clawd.plug.board.add(id, at?)`, `.remove(uid)`, `.move(uid, to)`, `.list()`,
`.open()` / `.close()` (the library). `window.__clawd.plug.pedals` is the registry, `.makeRig(c, amp)` builds a rig
around any amp (or a passthrough GainNode pair: `set(P, bpm)`, `ready()`, `pedal(uid)`, `clock`, `useClock(src)`,
`dispose()`), and `.kit` is `PFX` (`.kit.refused` lists the defs `pedalDef` turned down).

## A complete pedal

`web/pedals/30-clamwah.js` (measured with pedal-check: clean −0.4 LU, punk −0.9 LU, true peak −8.7 dBFS,
bypass exact, 10 extremes clean):

```js
/* ---- pedal pack: the Clam Wah (an envelope filter) */
pedalDef({
  id: 'clamwah', name: 'Clam Wah', kind: 'AUTO-WAH', cat: 'filter', where: 'pre',
  color: '#c43b8e', ink: '#fff4fa', nod: 'the envelope filter funk players stomp on',
  blurb: 'Pick hard and it quacks: a filter that follows you',
  look: { shape: 'box', finish: 'sparkle', knob: 'chrome', label: 'plate', led: '#7dffb8' },
  worklets: { 'pfx-env': PFX.ENV }, // (the kit's envelope follower)
  trim: 6, // (a band-pass throws level away: measured back to level with pedal-check)
  knobs: [['sens', 'SENS', 0, 10, 6], ['q', 'PEAK', 0, 10, 5], ['mix', 'MIX', 0, 10, 6], { key: 'range', label: 'RANGE', opts: ['LO', 'HI'], def: 1 }],
  build(c, k) {
    const input = k.G(1), output = k.G(1), dry = k.G(0), wet = k.G(1);
    // the filter's frequency: a base (a constant) plus the envelope times a depth
    const bp = k.F('bandpass', 400, 4), base = k.constant(400), depth = k.G(0);
    const env = k.envelope({ attack: 0.004, release: 0.12 });
    bp.frequency.value = 0; // (the constant sets it; the envelope adds to it)
    base.connect(bp.frequency);
    if (env) k.chain(input, env, depth, bp.frequency); // (no worklets: a fixed band-pass, still a sound)
    k.chain(input, bp, wet, output);
    k.chain(input, dry, output); // (its own dry blend: an insert pedal's output is the whole sound)
    return { input, output, set(v, x) {
      x.to(base.offset, v.range ? 400 : 200);
      x.to(depth.gain, (v.sens / 10) * (v.range ? 9000 : 4000)); // Hz per unit of envelope
      x.to(bp.Q, 0.7 + v.q * 0.5);
      x.to(wet.gain, (v.mix / 10) * 3); x.to(dry.gain, 1 - v.mix / 10);
    } };
  },
});
```

Checklist before you commit: `pedal-check` passes for your pedals; build a test copy and look at your pedals in the
library and on the board at 1400 px and 390 px wide; the ids, knob keys and processor names are unique; nothing
top-level leaks from your file. Don't commit `web/clawd-o-matic.html` from a feature branch (the orchestrator rebuilds
it).
