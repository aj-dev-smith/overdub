# Devices: writing instruments and effects

Overdub's instruments and effects are **devices**: a small definition (id, name, params, look) plus either a Web Audio
graph (`build(c, kit)`, trusted built-ins like the ported pedals and amps) or a **kernel**: a few dozen lines of pure DSP
that run inside an AudioWorklet. Kernels are what you and your agent write. They get no DOM, no clock and seeded
randomness only, so they are deterministic and hot-reloadable; that rule is for determinism, not security (see
[Under the hood](#under-the-hood)). A kernel written with `define_device` or imported from a device file is measured by
the **device check** before it reaches a track. Kernels that arrive inside a song (a share link, a project file) run
only once this browser trusts their code: until the person presses **Play them** they are held (an instrument silent,
an effect bypassed, nothing compiled), and once allowed they are compiled as they are, without the check
([ARCHITECTURE.md](ARCHITECTURE.md), "Who runs a song's code"). They add devices to the studio and never replace
one it ships: a song whose device has a built-in's id (`core.*`, `pedal.*`, `amp.*`, `cab.*`, `overdub.*`) or a house
shelf device's id brings it in as `guest.<slug>` (a share link) or `you.<slug>` (a song file), and a kernel's source
can be up to 256 KB.

Where things live:

| file | what |
|---|---|
| `app/src/kernel/dsp.js` | the stdlib a kernel gets as `dsp` (`makeDsp(sr)`, `overdubDsp`, `DSP_API`) |
| `app/src/kernel/worklet.js` | the one AudioWorkletProcessor (`'overdub-kernel'`) that hosts any kernel; `kernelCompiler` |
| `app/src/kernel/processor.js` | the worklet's module: registers that processor in each audio context |
| `app/src/kernel/host.js` | `kernelInstance(c, def, opts)`, `ensureKernelWorklet(c)`, `compileKernel(source)` |
| `app/src/kernel/check.js` | `checkDevice(def, { quick })`, `summarize(report)` |
| `app/src/engine/node/check.js` | `checkDeviceNode(def, { quick })`: the same check in Node, the kernel in a child process |
| `app/src/kernel/expr.js` | expression: `noteExpr(note, spb)`, `normCurve`, `chanExpr` (pitch bend, mod wheel, sustain) |
| `app/src/kernel/guide.js` | `KERNEL_GUIDE` (the agent's version of this page), `GUIDE_EFFECT`, `GUIDE_INSTRUMENT` |
| `app/src/kernel/examples.js` | `core.testsynth` and `core.testfilter`, the reference kernels (registered on import) |
| `tools/kernel-test.js` | the platform's checks (`node tools/kernel-test.js`) |
| `app/src/kernel/odk.js` | kernel data: the `.odk` container (`encodeOdk`, `decodeOdk`), `normData(def.data)` |
| `app/src/kernel/data.js` | kernel data on the page: `loadData(hash)` (fetch once, check, IndexedDB), `dataState`, `dataProgress`, `onData` |
| `app/src/engine/node/data.js` | kernel data in Node: `dataFor(def.data)` reads `app/kits/` for the renderer and the check |
| `tools/fetch-kits.js` | builds the sampled kits into `app/kits/` from pinned upstream files (`tools/kits/`, `tools/flac.js`) |

## The loop: write, check, play, refine

1. Write a def (below). Start from one of the examples.
2. `const report = await checkDevice(def)` (or the agent's `define_device` tool, which runs it and registers the device
   when it passes). Fix every error; read the warnings.
3. Put it on a track. Change the kernel and the instance hot-reloads it: `instance.reload(source)` compiles the new
   code in the worklet and crossfades old to new over 20 ms (params kept, held notes released). A reload that fails to
   compile keeps the old code playing and reports the error with its line.
4. Measure, don't guess: render the song (`engine.render`) and `measure()` it.

## The device check

`checkDevice(def, { quick = false })` parses the kernel on the main thread without running it (a syntax error comes back
with its line: `compile: line 12: SyntaxError: Unexpected token ')'`), then renders it in OfflineAudioContexts through
the same worklet the studio uses (where a missing `create()` or a bad `poly` is refused, also as `compile: ...`), and
reports:

| field | effects | instruments |
|---|---|---|
| `level` | `lufs` out, `deltaLU` against the input (DI strum), `drumsDeltaLU` (drum loop) | `lufs` of the test phrase, `deltaLU` from -14 |
| `truePeak`, `peak` | dBTP / dBFS at defaults | the phrase, and poly + 4 notes at once |
| `nan` | NaN / Infinity anywhere, or the worklet faulted | same |
| `tail` | seconds until under -60 dBFS after the input stops (`decays: false` if it never does) | after the last note-off |
| `cpu` | wall time of a 4 s render as % of real time | 4 s of the phrase |
| `latency` | where an impulse comes out (samples), and what the kernel declares | note-on to onset |
| `deterministic` | two renders are bit-identical | same |
| `extremes` | every param at min and at max, all min, all max: NaN, errors, raw peak (`hot`: cases over +6 dBFS) | same, with a short phrase |
| `voices` | | `{ poly, maxVoices, steals }` after poly + 4 held notes |
| `stuck` | | a note still sounding after note-off, after `allOff()`, or after stealing |
| `timedOut` | `'process'`: a render didn't finish by the deadline (60 s); `'create'`: `create()` didn't return; `'busy'`: the audio thread is still held by an earlier render that didn't; else `false` | same |

`ok` is false on a compile error, NaN/Infinity, a peak over +6 dBTP at default settings, a runaway at an extreme setting
(a raw peak over +24 dBFS), a stuck note, or no sound at all at default settings (under -60 LUFS). Over +6 dBFS at an extreme is a warning (an EQ with every band at max is
a boost the player chose, not a bug). Level, tail, cpu, latency and determinism problems are warnings too.
Drum kits (`cat: 'drums'`) are played the General MIDI drum phrase instead of the melodic one. Every message says what to change. `quick: true` skips
the per-param extremes and shortens the renders (a few hundred ms instead of about a second).

Level, peaks, NaN, tails, determinism and CPU are measured by the checker from the samples a render hands back. Poly,
declared latency and voice counts are what the render's side says about itself, kept only in range; an error it
reports makes the device fail. A kernel that hides its own fault is left with the silence a fault makes, which fails
the level check, so an effect that is meant to be silent at its defaults (a gate set above the test signals, a mute)
fails too: give it defaults that let sound through. In Node, `checkDeviceNode` (`app/src/engine/node/check.js`) runs
the kernel in a child process that can read `app/src`, writes no files and starts no processes (the network is still
open), and the parent, which never runs kernel code, measures what comes back. A child that sends anything but the
frames asked for, or ends early, fails the check. That keeps a kernel from rewriting the report, not from shaping its
own samples: everything the child sends is the kernel's, so a kernel written to fool the check can. Passing means the
device behaved in the measured ways while it was checked; it doesn't say the code is harmless. Read it.

## How a device gets its face

Nobody writes UI for a device: `app/src/ui/faces.js` draws it from the def. Effects become a stompbox (more than six
params make it a rack) in `look`'s colour, finish, knobs and lettering, with an LED and a footswitch; instruments get a
synth panel. Knobs follow each param's `curve` (log travel for Hz and times), show its `unit`, and use `opts` for
switches. Missing look fields are picked from a hash of the id, so two devices never look alike. A device written by an
agent wears its author's badge in the agent colour. A param with `face: false` stays off the face and lives in the
device's window (Slide Rule's forty band controls do), and a device the studio ships may draw a small screen on its
face: `screen(ctx2d, { w, h, ink, dim }, values)`, a function on the def, so a song's device (JSON) never has one.

**Its window.** Open on a face (or a double-click on its name) opens the device big (ARCHITECTURE.md, "Device
windows"): its nameplate in its `look` colours, every param as a big control, its presets, A/B and, for an instrument,
a keyboard. The window lays the params out in sections: by a param's `group` (`group: 'Filter'`), else by key
prefixes (`flt_cut` and `flt_res` make a Filter section; `env1_a` … `env1_r` an Envelope 1), else by role. A device
the studio ships may name an editor of its own (`editor: 'wavetable'` loads `ui/editors/wavetable.js`); a device written
in a song never runs page code of its own: whatever it says, it gets the generic window.

**Slide Rule (`core.eq8`), the worked example.** An eight-band EQ whose window (`ui/editors/eq8.js`) draws its bands as
nodes over the live spectrum of what comes in and goes out (`ctx.meter.tap`). Its filter math is one module,
`devices/builtin/eq8-curve.js`: the kernel embeds those functions as source (`EQ_SOURCE`, from
`Function.prototype.toString`) and the window imports them, so the curve on screen is computed from the same
coefficients the kernel runs. `tools/eq-test.js` holds the two together: an impulse through the kernel, its DFT at
test frequencies, against the curve, for every band type (within 0.5 dB; they agree to a thousandth). The rest of it:

- **Bands.** `b1_*` … `b8_*`, each `on`, `type` (`BELL`, `LOW SHELF`, `HIGH SHELF`, `LOW CUT 12/24/48`, `HIGH CUT
  12/24/48`, `NOTCH`, `BAND PASS`), `freq` (20 Hz to 20 kHz), `gain` (±24 dB, for bells and shelves) and `q` (a
  bell's, notch's or band pass's width; on a shelf or a cut the bump at its corner: 1 none, 2 a 6 dB bump, up to 4).
  Off by default, parked as 0 dB bells at 60, 150, 300, 700 Hz, 1.5, 3, 6 and 12 kHz; then `out_gain` and `out_auto`.
- **Filters.** The Audio EQ Cookbook's biquads in Direct Form I, double precision; cuts are Butterworth cascades of
  one, two or four sections. The host glides frequency, gain and Q each block and the kernel interpolates the
  coefficients sample by sample across it; a band switched on or off, or to another shape, crossfades over 12 ms
  (an S-curve). At its defaults it is the input, sample for sample (its golden scene's hash is the dry strum's).
- **Auto gain.** A first guess from the curve (a mix's long-term spectrum under K-weighting, instant), then a slow
  correction by what it hears: the input and the output K-weighted over about 3 s, the trim following their ratio
  over about 2 s, held in silence and while a band is soloed. After a few seconds of program the level is within
  about 0.1 LU of the dry signal on the house's test signals.
- **Solo.** A hidden param (`solo`, `auto: false`) the window holds on the live instance only, with an automation
  segment (`inst.auto`), never in the song: it plays one band's region of the input (a bell's band pass, what a cut
  takes away), and the window lets go of it on close.
- **Cost.** All eight bands with two 48 dB cuts and auto gain run at about 0.3% of real time.

**Params that aren't knobs.** A device whose state is more than a few knobs (a drawn shape, a step pattern) can still
keep all of it in params, so it undoes, flips with A/B, sits in presets and travels in a song. Three fields help:
`hidden: true` keeps a param off the face and out of the generic window (its editor draws it instead); `auto: false`
keeps it out of the lanes (a param a pedal applies too early to follow one, or one of a shape's 195 points that would
bury the Add-a-lane menu); `quantum` is the smallest step a window control makes (default: 1/200 of a short range, so a
point on a 1/16 grid needs `quantum: 1e-4`). A device the studio ships may also give its def a `describe(params)` that
returns one line of text: `get_project` prints that in place of the params' JSON (Scribble Strip prints its shapes).

## Scribble Strip (core.shaper): a shaper you draw

Draw a shape over a beat or a bar and it moves the volume, a filter or the pan in time with the song: the pumping
sidechain feel, trance gates, stutters, swells and auto-pan. `app/src/devices/builtin/shaper.js`; its window
(`editor: 'shaper'`) is `app/src/ui/editors/shaper.js`; the design note and what was measured is
[research/SHAPER.md](research/SHAPER.md).

- **Three lanes**: `vol` (a gain: the top of the shape is full level, the bottom the level pulled down by
  `vol_depth`), `flt` (a resonant low-pass: the top is `flt_cut`, the bottom closed by `flt_depth`, up to 8 octaves;
  `flt_res`) and `pan` (equal-power: at 100% `pan_depth` the top is hard right, 0.5 the middle). Each has
  `<lane>_on`, `<lane>_depth` (%) and `<lane>_rate` (`1/32` … `2 BARS`, triplets and dotted). Then `smooth` (ms: the
  edges' rise; 0.1 is a hard edge) and `mix` (%).
- **The shapes are params**: `<lane>_n` points (1..16), each `<lane><i>_x` (where in one pass, 0..1), `_y` (0..1),
  `_c` (the bend of the line that leaves it, -1..1: > 0 starts slow, as lanes bend) and `_s` (1: hold, then jump at
  the next point). Any order: the shape is them sorted by x, and it loops. They're `hidden` and `auto: false`.
- **Timing**: a pass is locked to the transport's beat (beat 0 starts one); stopped, it runs on at the tempo. A bar
  is four beats (a kernel isn't told the meter). The shape is read half the smoothing time ahead, so a smoothed edge
  is centred where it's drawn.
- **At the defaults it is bypass**, bit for bit (the volume lane flat at the top, the others off). Presets: Pump
  (quarter notes), Pump (eighths), Gate (sixteenths), Stutter, Swell over a bar, Auto-pan, Filter wobble (eighths),
  Half-time duck. `tools/shaper-test.js` holds it to all of this.

## Gaffer Tape (core.multiband): three bands, up and down

The three-band compressor producers put on everything: in each band it lifts the quiet detail up (upward compression,
below one threshold) and holds the loud parts down (downward compression, above another), and one DEPTH knob mixes it
in. On a synth, a drum bus or a vocal it makes the sound loud, dense and finished. `app/src/devices/builtin/multiband.js`;
its window (`editor: 'multiband'`) is `app/src/ui/editors/multiband.js`; the design note, with sources and what was
measured, is [research/MULTIBAND.md](research/MULTIBAND.md).

- **Bands**: `low`, `mid` and `high`, split at `xover_lo` (120 Hz) and `xover_hi` (2.5 kHz); the upper split stays
  at least 1.5 times the lower. Each band has `<band>_down_thresh` and `<band>_down_ratio` (above the threshold it is
  pulled down), `<band>_up_thresh` and `<band>_up_ratio` (below it, lifted, by at most 30 dB, and nothing under about
  −70 dB, so silence stays silent; it never sits above the downward threshold), `<band>_attack`, `<band>_release` and
  `<band>_gain`. Then `depth` (%: how much of it you hear), `in_gain` and `out_gain` (±12 dB) and `time` (10% to
  1000%: every attack and release, scaled together).
- **Heard in bands, applied with shelves.** A Linkwitz-Riley crossover (24 dB per octave) feeds each band's level
  detector; the sound itself is never split. The three gains go onto the whole sound: the mid band's on all of it, a
  low shelf at `xover_lo` for the low band's and a high shelf at `xover_hi` for the high band's (each two trapezoidal
  SVF shelves, 24 dB per octave at their steepest, halfway in dB at the split). When the gains agree the shelves are
  flat, so at depth 0 the output is the input, sample for sample, and the phase only turns where the bands differ.
- **One source of truth.** The crossover, each band's dynamics (`mbStep`: the detector, the static curve with 6 dB
  soft knees, the smoothing), the depth mix and the shelves are pure functions in `devices/builtin/multiband-curve.js`:
  the kernel embeds their source, as Slide Rule's does, and the window imports them to draw each band's curve and to
  run the same detectors on its live input for its readouts.
- **Depth** mixes each band's gain toward 0 dB before the shelves: at 0% every band is at 0 dB and the shelves are
  flat; at 100% it is all of it.
- **Attack and the look-ahead.** The sound reaches its gains 5 ms after the detectors heard it. Each band's downward
  side follows its mean square at the attack and release, and the same curve on the band's peak at the attack, let go
  within 10 ms: so a fast attack (under 5 ms) catches a hit's front, gain and makeup in place before it arrives, and a
  slow one lets the front through. The lift lets go within a millisecond as the band gets louder, so a hit after a
  quiet spot doesn't jump out, and comes back at the release.
- **Levels.** The defaults are the classic (each band lifted toward −26, −24 and −32 dB at 6:1 and back within 60,
  50 and 40 ms; held at 3:1 above −4, −8 and −14 dB; made up by 2, 1.5 and 2 dB) at 40% depth: within a decibel of
  bypass on the house's test signals and drum kits. A safety ceiling, a look-ahead true-peak limiter (Red Line's
  method) on everything it puts out, holds it at −1 dBTP at any setting; it lets go of a short over within 10 ms and a
  long one over 150 ms. The look-ahead and the ceiling cost 328 samples (6.8 ms) of latency, declared. About 2% of
  real time.
- **Upward and downward** (appended): `upward` and `downward` (0-200%, default 100) scale every band's lift and hold,
  in dB of gain change, as the classic plugin's two big knobs do: less upward on a bass that hisses, more downward on
  a top end that bites (the lift stays at most 30 dB). At 100% each the arithmetic is exactly what it was.
- **Presets**: Full depth (the classic, all of it, a decibel up), Glue (bus), Drum smash, Vocal presence, Bass
  tighten, Subtle 30%, and for bass music Bass density (60% in, upward 60%) and Drum density (50%, downward 130%),
  each about 1 LU up on the test signals. Full depth, Drum smash and Vocal presence come out 1 to 3 LU louder on drums, the crest factor
  down; Glue, Subtle and Bass tighten stay within a decibel or so of the input. `tools/multiband-test.js` holds it to
  all of this.
- **The window says what it does**: while the song plays, the loudness out against in (in LU, large, in the warning
  ink when it takes a decibel or more off), In and Out meters, and each band held or lifted, all worked out on the
  page from the window's own taps (`ctx.meter.tap`) and the shared functions.

## Dim Switch (core.ducker): the sidechain duck

The track it sits on dips under another track: the bass makes room for the kick, the pads breathe with the drums.
`app/src/devices/builtin/ducker.js`. It is the studio's first **keyed** device (`key: true`, below): its window has a
**Key** menu listing the song's other tracks, which sets the insert's key (`insert.set { patch: { key: { track } } }`,
signed whoever picked it), and the mixer shows "keyed by Kick" under the track.

- **What it hears**: the key track after its inserts and before its fader, mute and pan, so a muted "ghost kick"
  track still keys it and moving the kick's fader doesn't change the duck. A band-pass on the key, `key_lo` to
  `key_hi` (24 dB per octave each side), lets a whole drum track key it on its kick alone (30-150 Hz); the band adds
  about a millisecond of delay before it hears a kick.
- **`mode`**: `TRIGGER` fires one fixed shape each time the key's band rises past `thresh` (and has fallen 6 dB under
  it since, at least 30 ms after the last): down by `depth` (0-48 dB) over `attack` (0.1-50 ms, a raised cosine),
  held `hold` (0-500 ms), back over `release` (10-2000 ms) in a straight line in dB, `curve` bending it (+ waits and
  then comes back fast, a harder pump; - comes back fast and eases in). `FOLLOW` is a compressor listening to the
  key: down by however far it is over `thresh`, dB for dB, at most `depth`, at the attack; held, then back with a time
  constant of a third of the release.
- **`nokey`** (`OFF`, `1/4`, `1/8`, `1/2`, `1 BAR`): with no key set, `TRIGGER` fires on that grid of the song while the
  transport plays. `mix` blends the dry back in.
- **At its defaults with no key it is bypass**, bit for bit. No look-ahead, no latency. Measured
  (`tools/sidechain-test.js`): keyed by a kick it is at its depth within ATTACK + 1 ms of the kick crossing its
  threshold, and within 1 dB of the way back at 91% of RELEASE (CURVE 0).
- **Presets**: Kick duck, Kick and snare duck (dubstep's), Gentle pump, Hard pump (riddim), Bus breathe (FOLLOW),
  Quarter pump (no key), each tagged `bass-music`.

## Clip Lamp (core.clipper): a ceiling it never passes

A clipper for drums and loud masters: `drive` (0-24 dB) pushes the sound into `ceiling` (-12 to 0 dBFS), and what
would have gone over is cut off (`shape` `HARD`), rounded (`SOFT`, a tanh) or leaned on like tape (`TAPE`, a tanh on a
bias, for even harmonics), `knee` (0-1) setting how far under the ceiling the bend starts (up to 6 dB). `output` and
`mix` (the clean sound, from before the drive) after. `app/src/devices/builtin/clipper.js`.

- **At 4x.** The curve runs at 4x the sample rate through the stdlib's `oversample4x`, so the harmonics a corner
  makes above the band are filtered out, not folded back. At the 4x rate nothing passes the ceiling; the filters after
  it rebuild a little (0.02 dB on a 100 Hz tone pushed 18 dB into -6 dBFS), which `meter()` reports and a limiter
  after it catches. Its latency, 27.5 samples, is declared.
- **At its defaults** (drive 0, ceiling 0 dBFS, no knee) anything under full scale passes as it was, delayed and
  band-limited: within 0.1 LU on the house's test signals.
- **Presets**: Drum bus clip (4 dB into -3 dBFS), Master clip (+3) and Master clip (+6) (into -1 dBFS, for in front
  of Red Line), Bass grit (14 dB into tape, 60% in). The loud master is Clip Lamp, then Red Line at -1 dBTP, then the
  master's clean ceiling (`master.set { clip: 'clean' }`). `tools/clipper-test.js` holds it to this.

## Sandbag (core.clubkit): a club kit for bass music

A synthesized drum kit for dubstep, riddim, drum and bass and melodic bass, on the GM map (the riser on note 34, the
impact on 33). `app/src/devices/builtin/clubkit.js`; the design note and what was measured is
[research/CLUBKIT.md](research/CLUBKIT.md).

- **Kick**: a sine falling from about five times `kick_note` (C1-B1, F1 by default: tune it to the song's root) into
  the note within 60 ms, a knock and a tail at the kit's length; `click` adds a tick on top; `drive` warms it.
- **Snare**: a body of two membrane modes (182-235 Hz), a noise crack whose ring falls with frequency, a `clap`, and a
  short `room` whose highs die first. **Hats**: two struck plates of 48 modes each (closed, pedal and open are one hat:
  a closed stroke chokes an open one). Toms, the crash and ride (metal.js's FDN), the riser and the impact.
- **KIT** (`DUBSTEP`, `RIDDIM`, `DNB`, `MELODIC`) sets each piece's character; `tune` moves everything but the kick,
  `decay` every ring, `width` the hats and cymbals; `clip` (on) is a 2x soft clipper on the kit, set per kit; `level`.
- Measured (`tools/clubkit-test.js`): the kick peaks 1.3-1.8 ms in with a crest of 10.3-11.2 dB over 100 ms and a tail
  within 15 cents of its note; the snare peaks 0.4 ms in, crest 12.3-13.8 dB, its highs ringing 0.23-0.29 s; the hats
  carry their body under 2.5 kHz and a top as strong (12-20 kHz within 1 dB of 150-600 Hz, centroid about 5.4 kHz) and
  correlate 0.30; every piece ends 60 dB under its peak; the drum phrase plays at -17.9 to -18.5 LUFS. Presets: Dubstep, Riddim, Drum and bass, Melodic. The groove library's Dubstep style plays on it.

## Keys: an effect that hears another track

A def with `key: true` (effects only) gets a second input, its **key**: the sound of the track the insert's `key`
names (`{ track: '<track id>' }`, set with `insert.add` / `insert.set`), taken after that track's inserts and before
its fader, mute and pan. In `process(L, R, n, p, t)` it reads `t.key = { l, r, on }`: two preallocated
`Float32Array` views of this block's key (silent when there is none) and `on`, false when the insert has no key or its
track is gone. A def without `key` never sees `t.key` and behaves exactly as before.

- Both renderers render every key source before the tracks it keys, in the same 128-frame block (a topological order,
  stable on the track order, so a song without keys renders exactly as it did), and render a key source even when it
  isn't heard (muted, soloed out, left out of a stem), without summing it. The browser and Node agree bit for bit on
  the `sidechain` golden scene.
- The ops refuse a key naming no track, the insert's own track, a master insert, and a loop (a track's sound reaching,
  through keys, the track it keys). A key whose track is removed stays in the song, is heard as silence, and comes back
  with an undo.
- The key is the source's place on the master timeline after delay compensation; inserts after the keyed device that
  add latency make the key that much late (reported in the latency, not corrected).

## Under the hood

- **One processor for every kernel.** `ensureKernelWorklet(c)` loads `app/src/kernel/processor.js` (the processor and
  the dsp stdlib) once per context, a file on the studio's own origin like every worklet module it loads: the page's
  policy refuses scripts from `data:` and `blob:` URLs. Each instance is an `AudioWorkletNode` given the kernel's
  source in `processorOptions`; the worklet compiles it with `new Function` in a scope where `dsp`, a frozen
  `Math` (whose `random` throws) and a small `console` are the only useful names. That guards against accidents; it
  is not a security boundary (a determined kernel can reach the worklet's globals), so treat kernels from strangers like
  code from strangers. What keeps the page safe is that kernels are evaluated only there: the worklet scope has no
  DOM, no localStorage and no network. The main thread only ever parses kernel source (`compileKernel`), never runs it.
- **Faults are contained.** A kernel that throws, or outputs NaN/Infinity, or runs past +60 dBFS is silenced and reports
  one `{ stage: 'process', message, line }` error (`instance.errors`, `instance.on('error', fn)`) until it is reloaded.
- **Notes are sample accurate.** `noteOn/noteOff/allOff(time)` carry AudioContext times; the worklet converts them to
  frames and splits the block at each one. Offline, every context that hosts kernels gets one `suspend(0)` where the host
  waits for each kernel to acknowledge what was posted to it (`instance.sync()`), so notes scheduled before
  `startRendering()` land on their frames. (Don't schedule your own `suspend` at exactly 0 on such a context.)
- **Params** are posted whole (`set(params)`, defaults merged), clamped to their range, and smoothed per block with a
  ~10 ms one-pole (geometric for `curve: 'log'`); switches and stepped params snap; `set(params, { first: true })` jumps.
- **Bypass** (`setOn(false)`) crossfades wet to dry over ~10 ms in Web Audio gains; a `trails` device keeps its wet path
  open so the tail rings out. A bypassed non-trails kernel is put to sleep (skipped) once its tail has had time to die.
- **Transport**: the host posts `{ bpm, playing, beat }` from the engine's clock every 50 ms and the worklet extrapolates
  per block, so `t.beat` is right at every block start. Offline it is the project tempo from beat 0, playing.
- **Instance extras** beyond the contract: `errors`, `faulted`, `version`, `on('error' | 'log' | 'ready', fn)`,
  `stats()` (`{ voices, maxVoices, steals, notes }`), `sync()`, `reload(source)`, `node`.

## Expression: pitch bend, the mod wheel and the sustain pedal

A kernel reads the player's expression from `t`, beside the transport: `t.bend` (semitones), `t.mod` (0..1) and
`t.sustain` (the pedal is down). A kernel that never reads them plays exactly as it did before they existed. Two
things set them:

- **The channel**, as a MIDI keyboard sends it: `instance.expr({ bend?, mod?, sustain? }, time)`, sample accurate
  like a note (the block is split there). `input/midi.js` sends the pitch bend wheel (its 14 bits times the bend
  range: 2 semitones, or what `midi.setBendRange(st)` or the controller's RPN 0 sets, 1..24), the mod wheel (CC 1,
  with CC 33's fine bits) and the pedal (CC 64) to the instrument you are playing; CC 121 resets them. The host keeps
  the sustain pedal for every instrument: a note-off that arrives while it is down is held (the voice is not released,
  and it can still be stolen first) until it lifts. (`midi.js` also holds the keys it captures while the pedal is down,
  so a kept take carries the pedal as note lengths.)
- **The note**, from the song, so a render repeats it: a note may carry `bend` (semitones) and `mod` (0..1), each a
  number for the whole note or `[[beat, value], ...]` from the note's start (linear between the points, the first
  value before the first point, the last after the last; up to 64 points, bend within ±48). The engine, the browser
  render and the canonical Node render send them with the note-on (`noteExpr` turns beats into seconds; a note
  chased from mid-song starts its curve that far in). Agents write them with `notes.add` and `notes.replace`.

Inside a voice's `render`, `t.bend` is the channel's bend plus the note's own and `t.mod` their sum (clamped to 0..1);
in `process` they are the channel's. Evaluate them per block: they move at block rate (the host splits blocks at
channel changes and evaluates a note's curve at the start of each piece). `core.guitar` (DI Box) bends its string
with `t.bend` and adds finger vibrato from `t.mod`.

## Presets

`presets: [{ name, params, blurb?, tags? }]` names sounds a newcomer picks by name. The registry checks and fills them
in (`normPresets`): every param left out takes its default, values are clamped to their ranges and snapped to their
steps, a switch may be given by its label (`'NYLON'`) or its index, names are unique (any case), up to 24 (64 for a
built-in, by `overdub`). `tags` are words from the registry's `PRESET_TAGS` (`bass-music`, `dubstep`, `riddim`,
`dnb`, `melodic`, `sub`, `growl`, `reese`, `wobble`, `stab`, `lead`, `chords`, `fx`, `drums`, `bus`, `master`,
`pump`): what the browser's genre filter and `list_devices { tag }` find a preset by. So a
preset's `params` is the whole sound: `instrument.set { params }` (or `insert.set { patch: { params } }`) applies it
as it is, and `presetParams(def, name)` looks one up. `list_devices` lists their names and `get_device` their params
for agents. A device file and a `define_device` call carry the field too (a bad preset is refused with the reason).

## The library and device files (v0)

The house shelf is `app/src/devices/library/`: ten kernels Claude wrote the way any agent writes them, one plain
request each (the def's `request` field), signed `by: 'claude'`, registered at boot with `source: 'library'` (ids
`claude.<slug>`; their faces wear Claude's badge). Instruments: Choir Loft (`claude.choir-loft`), Biscuit Tin
(`claude.biscuit-tin`), Dust Sheet (`claude.dust-sheet`), Sub Basement (`claude.sub-basement`). Effects: Charity Shop
(`claude.charity-shop`), Skylight (`claude.skylight`), Chopping Block (`claude.chopping-block`), Power Cut
(`claude.power-cut`), Say Ahh (`claude.say-ahh`), Leading Edge (`claude.leading-edge`). A def may carry
`demo: { params }`, the settings the library page plays it at. `tools/library-test.js` holds them to house levels
(instruments -14 to -18 LUFS on the test phrase, effects within 1.5 LU of bypass, true peaks at or under -1 dBTP, no
check warnings).

`/app/library.html` shows every built-in, showcase and library device as its face, with its request, its check
summary (`library/reports.js`, written by `WRITE=1 node tools/library-test.js`; a summary only counts while its hash
matches the kernel) and a ▶ that renders a demo in the page. "Use in a new song" opens `/app/?new&device=<id>`, which
`app/src/ui/devices-io.js` turns into a track with that device and a few bars to hear it with.

**Device files.** `.overdub-device.json` = `{ format: 'overdub-device/0', exported, device: { id, name, kind, cat,
blurb, nod?, request?, by, params, look, tail?, trails?, kernel } }`. Export from a device's info card in the rack
(⌥⌘E exports the selected one); import from the Song menu, ⇧⌘I, ⌘O, or a drop anywhere. An import runs
`checkDevice` first and is refused with the report if it fails; one that passes is one `device.define` signed by you
(the device keeps its author). A file can't take over a built-in id (`core.verb` comes in as `you.verb`), and the
same file twice changes nothing. Until kernels run as WASM, a device file is code from whoever made it: import files
from people you trust. Importing one trusts its code in this browser (you chose the file), as `define_device` trusts
what your agent writes. A share link (`#s=`) or a song file carries the song's devices, kernels included; the ones
this browser hasn't trusted are held, and the studio asks before they run.

**Trying a community device** (a local studio only, and Try is held until the worklet's prototypes are frozen:
docs/COMMUNITY-SHELF.md). The Browser's **From the
community** lists the shelf's devices with their author and the agent that wrote them. ▶ plays the clip rendered for
the shelf. **Try** fetches the device file, refuses it unless its kernel matches the shelf's fingerprint, asks whether
to run code someone else wrote, runs the device check, and puts it on the selected track (or a new one, with two bars to
hear it on) as one step you can undo. The song gets the shelf's name and request for it and a `credit` (who asked for
it, the agent, the licence, the kernel's hash); the device is yours (`by: 'you'`), as an imported file is. Unticked,
**Run it in any song from now on** trusts the code until you reload; after that the song holds it and asks again.

## Drum kits and the note map

Three built-in kits sit on the drums shelf (`cat: 'drums'`). Every kit plays the drum phrase in the device check, and
a track with one gets the drum grid.

- **Gobo Kit** (`core.drums`): one hit, one voice. It has six characters: FIELD, MACHINE, DUST, 808, 909 and
  ACOUSTIC+. `hat_model` picks the hi-hats' model: ORIGINAL (each character's own, the default), PLATES (two
  plates of struck modes that chatter), BANDS (banded noise) or SQUARES (six squares with a body). On the last three
  a hat note's `mod` (0..1) sets how open the hats are, and moves them while the note plays.
  `snare_voice` and `clap_voice` swap in a candidate snare (MODAL, TWO HEADS, SNAPPY) or clap (HANDS, CIRCUIT, ROOM)
  on any character; 0 (KIT) is each character's own, as before.
- **Studio A** (`core.drumroom`): an acoustic kit in a big tracking room, miked like a recording. It has
  articulations, velocity that changes the sound, strokes that never repeat, and a mic mix you balance.
  Its design note is `docs/research/STUDIO-A.md`.
- **Virtuosity Kit** (`core.drumkit`): a real jazz-club kit, recorded through a pair of overheads and played from
  samples (below: [Virtuosity Kit](#virtuosity-kit-coredrumkit-a-sampled-kit)). One of the studio's thirteen sampled
  instruments; the others are Parlour Upright (`core.upright`, a real upright piano), Full Stick (`core.grand`, a real
  concert grand), Rosin (`core.ensemble`, a real string section), Damper Bar (`core.vibes`, a real vibraphone),
  Roundwound (`core.ebass`, a real five-string bass), Hollow Body (`core.eguitar`, a real hollow-body electric guitar),
  Bell Up (`core.barisax`, a real baritone sax), Endpin (`core.cello`, a real solo cello), Head Joint (`core.flute`, a
  real flute) and Spit Valve (`core.trumpet`, a real trumpet) ([Melodic
  kits](#melodic-kits-a-sampled-instrument-across-the-keyboard)), Rusty Brushes and Hand Crate.
- **Rusty Brushes** (`core.brushkit`): a real kit played with brushes and mallets, where Virtuosity Kit has sticks
  (below: [Rusty Brushes](#rusty-brushes-corebrushkit-brushes-and-mallets)).
- **Hand Crate** (`core.handkit`): real hand percussion, which plays a kit's beat as a hand player would
  (below: [Hand Crate](#hand-crate-corehandkit-hand-percussion)).

**Cymbal models.** Gobo Kit and Studio A take `cym_model` (CYMBALS): CLASSIC (the default: each kit's own cymbals, so old songs
play as they did), FDN or MODAL. These two are new models of the crashes, ride (bow, bell and edge), china and splash,
built in `app/src/devices/builtin/metal.js` and measured against real cymbal recordings. Each cymbal is one model that
keeps ringing between strokes, so a ride's wash builds; Gobo runs them in its `process()`, with its cymbal voices as
probes (below). Gobo's 808 keeps its own.

**The note map.** Every kit plays General MIDI. Studio A plays these articulations GM has no note for:

| notes | piece | what they play |
|---|---|---|
| 21-24, 26 | hi-hat | foot splash, closed edge (shank), ¼ open, ½ open, open edge |
| 31-34 | snare | flam, drag, a held roll, edge |
| 25, 27-30 | cymbals | chokes: ride, crash, crash 2, china, splash |

`core/music.js` names them in `DRUM_MAP`, for grid rows: `footsplash hatedge quarter half openedge flam drag roll
snareedge ridechoke crashchoke crash2choke chinachoke splashchoke`. It also names the GM notes that had no name:
`rimshot` 40, `lowfloor` 41, `himid` 48, `china` 52, `splash` 55, `crash2` 57, `rideedge` 59, and `tom4` 43, the
same note as `floor`. Studio A's own note map (below) labels every row.

**A kit names its own notes.** A drum kit's def can carry `notes`: what each MIDI note plays on it, in a row's
words, and `other`, what any note it doesn't name plays.

```js
notes: { 36: 'Kick', 38: 'Snare', 40: 'Rimshot', 31: 'Flam', 24: 'Hat 1/2 open', /* ... */ other: 'Side stick' }
```

- The Beat tab, the piano roll and the inspector name a track's drum rows from its kit's map
  (`core/music.js` `kitNotes(def)` and `drumName(p, notes)`). On Studio A, note 40 is "Rimshot"; on Gobo Kit it is
  "Snare (40)", since Gobo plays its snare there.
- A kit with no map gets General MIDI's names (`GM_DRUMS`). A note the kit doesn't name reads as its `other` and
  the number ("Side stick (60)").
- `get_device` gives agents the map, so an agent writing for a kit uses its articulations.
- Names are read as text: keys are MIDI notes 0-127 or `other`, values are strings of at most 40 characters.
- Gobo Kit's map sits in `core/music.js` (`KIT_NOTES`, by its id) until its def carries it.

What Studio A does with the GM notes:

- 40 is the rimshot, 59 the ride's edge, 53 its bell.
- 50 and 48 play rack tom 1, 47 rack tom 2, 45 floor tom 1, and 43 and 41 floor tom 2.
- A closed (42, 22) or pedal (44) note chokes an open hat.
- A hat note's `mod` (0..1) sets how open the hats are for that stroke.
- The roll (33) rolls for as long as the note is held, and its `mod` swells it.
- A choke is the hit, then a hand grabbing it.
- Notes the map doesn't name play the side stick, quietly.

The full table, with every piece, is in the design note.

**Studio A's window** (`editor: 'drumroom'`, `ui/editors/drumroom.js`) draws the kit from above, from `LAYOUT`. That
is the same layout `drumroom.js` builds the mics from, so the picture and the stereo image agree.

- **Playing it.** You play it by clicking where you'd hit (`engine.liveNoteOn`), and lower on a piece is louder.
- **The strokes.** Alt plays the other stroke (a choke, the side stick, the hat pedal), and a drag up on the hats
  opens them. A touch has no Alt, so a finger held on a cymbal chokes it.
- **Where to hit.** The toms cover most of the kick's shell, so the kick is also the floor before it, from the pedal
  across to floor tom 1, where its name sits. Every piece's name plays that piece.
- **Lights.** The pieces light as the song plays them, and fade with each piece's ring.
- **Controls.** Beside the kit sit the selected piece's tune, decay and level, with a key for each of its notes. Along
  the bottom, the mic mix is laid out as channel strips.

**Studio A's params.**

- The kit: `kit` (MAPLE BIRCH JAZZ ARENA DEAD), `tune`, `decay`, `humanize`, `velocity` (the velocity curve), and
  `cym_model` (CLASSIC FDN MODAL).
- The mic mix: `mix_close`, `mix_oh`, `mix_room`, `mix_crush` (dB faders, -40 off), `bleed`, `room_size`, and `view`
  (DRUMMER or AUDIENCE).
- Each piece's `<piece>_tune`, `<piece>_decay` and `<piece>_level` for kick, snare, hat, tom1-tom4, ride, crash1,
  crash2, china and splash.
- `snare_wires` (0 is snares off) and `perc_level`.
- `hat_model`: ORIGINAL (the default) or PLATES (two plates of dense modes that chatter as they ring).
- Every param carries a `group` (its piece, `mics`, `kit` or `perc`), so an editor can lay them out by piece.

**A kernel technique it uses: probes.** A voice renders into one stereo pair and doesn't know where in the block it
starts. A kit whose mics need each piece on its own bus can't build its mix in its voices. Studio A's voices are
probes:

- `start` queues the note.
- `render` counts the frames the host asks for and reads the note's `t.mod`, then returns true for that block only
  (or while a held roll lasts).
- In `process`, the frames counted give each note's offset in the block (`n - frames`).

The whole kit, its persistent piece models and its shared mic buses run there, sample accurate. Any kernel that
needs per-voice buses (a mixer of sources, a sympathetic resonance between notes) can do the same.

## Virtuosity Kit (`core.drumkit`): a sampled kit

A jazz-club kit played with sticks: Virtuosity Drums (Versilian Studios, CC0 1.0), recorded at Virtuosity Musical
Instruments in Boston with Austin McMahon on the house kit. Overdub plays a lean subset of it through one stereo pair
of overheads. `app/src/devices/builtin/drumkit.js`; the samples come by [kernel data](#kernel-data-samples-a-kernel-plays).

- **What it plays.** Eleven articulations: kick, snare, hi-hat closed, half open, open and pedal, ride and its bell, a
  crash, and a high and a low tom. Each has three velocity layers of two strokes. The file is 66 samples, 22.9 MB
  of 16-bit, 48 kHz stereo (10.5 MB gzipped), with tails cut after the last 20 ms window above -70 dBFS RMS.
- **The note map** is General MIDI: 35 and 36 kick, 38 and 40 snare, 42 hat closed, 44 pedal, 46 open, 49 and 57 crash,
  51 and 59 ride, 53 bell; 50, 48 and 47 the high tom, 45, 43 and 41 the low one. Studio A's half-open notes (23, 24)
  play the half-open hat, its edge notes 22 and 26 the closed and open hat. Its `notes` names every one; any other
  note plays nothing ("Not in this kit").
- **Velocity.** A note's velocity picks the layer and crossfades across each layer boundary (within 0.06 of it):
  drums linearly, since two strokes of one drum add at the attack, and cymbals and hats at equal power. The level
  follows a curve through each layer's measured level (the RMS of its first 150 ms), so it doesn't jump where the
  timbre changes. On the snare, each step of 0.02 in velocity moves the level by under 2 dB.
- **Strokes.** Which of a layer's two strokes plays is drawn from the instance's seed, in the order notes arrive (the
  other stroke three times in four), so a render repeats exactly and two tracks of the kit differ.
- **The hats are one instrument.** A hat note chokes what the hats were ringing: a closed or pedal note within 30 ms,
  an open or half-open one within 80 ms. A piece keeps at most three strokes ringing; the oldest fades in 50 ms.
- **Each stroke lands on its note.** It starts 2 ms before it first comes within 20 dB of its peak (the overheads'
  flight time, and the foot's travel before a pedal hat closes, are skipped), with a 1 ms fade in. `fetch-kits.js`
  works that point out once, into each sample's `start` in the kit file, so building an instance reads no more of the
  kit than the first 150 ms of each stroke.
- **Params.** `tune` (±12 semitones, by resampling with the kernel's own 4-point Hermite interpolator, fixed at each
  stroke: lower is longer; at 0 a stroke is its recorded samples, scaled), `decay` (100% is the recording; lower
  holds part of each stroke, then lets it go), `tone` (a tilt around 900 Hz, ±6 dB at the ends; at 0 it is bypassed),
  `level`, and a level for the kick, snare, hats, toms, ride and crash (-40 is off). The defaults lift the kick 8 dB
  and ease the snare back 5 and the hats 3; the **As recorded** preset is the pair's own balance.
- **Levels.** The overheads' snare peaks sit about 18 dB over the kit's loudness, so the output runs into Studio A's
  stereo-linked true-peak limiter (1.5 ms look-ahead, declared as 80 samples of latency). At the defaults the device
  check's drum phrase measures -18.1 LUFS and -1.5 dBTP (the library card's figures; the golden scene, which
  plays the phrase on a track through the mixer, -17.8 and -1.6). The hardest snare and tom strokes (velocity 0.95 and up) are eased by
  4 to 6 dB, the hardest open hat by 3; anything under 0.7 passes untouched.
- **At other sample rates** the kernel converts from 48 kHz with the same interpolator.

`tools/drumkit-test.js` holds it to all of this, and the golden scene `inst:core.drumkit#e590dc685420` pins its render.

## Rusty Brushes (`core.brushkit`): brushes and mallets

Big Rusty Drums (Karoryfer Samples, CC0 1.0): a big kit Zygmunt Szpaderski made in Poland, probably in the early
1980s, recorded with brushes, mallets and sticks. Overdub plays the brushes and mallets, which Virtuosity Kit doesn't
have, through one stereo pair of overheads. `app/src/devices/builtin/brushkit.js`; the samples come by
[kernel data](#kernel-data-samples-a-kernel-plays), built from `tools/kits/big-rusty.js`.

- **What it plays.** Thirteen articulations, two to four velocity layers of two strokes each: the kick (a felt
  beater); on the snare, brush taps (four layers), digs (the brush pressed into the head: an accent), a stir and the
  brush lifting off; on the hi-hat, brushed closed, quarter-open and open strokes and the pedal; the brushed ride; a
  mallet on the crash, a 14" rack tom and an 18" floor tom. 68 samples, 106.7 s of 16-bit, 44.1 kHz stereo (the
  source's own rate: the kernel converts as Virtuosity Kit's does), 7.06 MB over the wire as `.odkz`.
- **The note map** is General MIDI: 35 and 36 kick, 38 brush snare, 40 dig, 42 hat closed, 44 pedal, 46 open, 49 and 57
  crash, 51 and 59 ride; 50, 48 and 47 the rack tom, 45, 43 and 41 the floor tom. Studio A's notes play what they
  name: 23 and 24 the quarter-open hat, 22 and 26 closed and open, 33 (its held roll) the stir. Big Rusty's own notes
  play too: 73 and 74 the stir, 76 the dig; 77 is the brush lifting off. Any other note plays nothing.
- **The stir rings while its note is held.** A brush stirs the snare for as long as the note lasts: three seconds of
  the recording loop (the last 0.3 s crossfaded at equal power into the loop's start, baked into the file, so the
  jump back is seamless and bit-exact), fading in over 40 ms and out over 150 ms after the note ends. Two layers: a
  soft stir and a hard one.
- **Everything else is Virtuosity Kit's.** The same kernel (`drumsampler.js`, Virtuosity Kit's with the kit's shape
  passed in): velocity crossfades between layers along their measured levels (the brushes, like the cymbals, at equal
  power: two brush strokes are noise to each other), strokes from the instance's seed, the hats choking each other,
  three strokes per piece at most, the same params (`tune`, `decay`, `tone`, `level`) and a level for the kick,
  snare, swirl, hats, toms, ride and crash.
- **Levels.** The defaults ease the kick back 4 dB and the toms 3, lift the snare 4, the stir 6 and the ride 8 (a
  brushed ride is quiet), with the crash at -2; **As recorded** is the pair's own balance. At the defaults the device
  check's drum phrase measures -17.8 LUFS and -1.5 dBTP, and the limiter eases only the hardest strokes (velocity 0.95
  and up: the snare by 4 to 5.5 dB, the rack tom by 2 to 3.5, the kick by 1 to 2).
- **The QA rubric** (`tools/kits/qa.js`, run by `fetch-kits.js` on every stroke) accepts clipping, DC and the heads.
  Every piece's velocity layers climb, 10.3 to 21.9 dB soft to hard, but the stir's two (a soft and a hard stir)
  are 5.6 dB apart, so that check is for review. It waives three checks in the
  recipe, each with its reason: the noise floor and the tails (every file sits on the same room at -91 dBFS: the
  soft brush strokes are quiet, not noisy) and phase coherence (a spaced pair over brushed hats and cymbals, whose
  noise is uncorrelated between the mics, about -3 dB summed to mono, not a mic out of phase). Its round robins are
  for the listening room: four layers' two strokes are 1.6 to 2.2 dB apart.

`tools/drumkit-test.js` holds it to all of this, and the golden scene `inst:core.brushkit#653ce5fbd513` pins its render.

## Hand Crate (`core.handkit`): hand percussion

VCSL's hand and aux percussion (the Versilian Community Sample Library, Versilian Studios, CC0 1.0), through VCSL's
stereo pair. `app/src/devices/builtin/handkit.js` on the same kernel as Rusty Brushes (`drumsampler.js`); the samples
come by [kernel data](#kernel-data-samples-a-kernel-plays), built from `tools/kits/vcsl-hand.js`.

- **What it plays.** Sixteen pieces, one to three velocity layers of one or two strokes: a cajon's bass and slap, an
  open, a muted and a low conga, high and low bongos, a small and a big shaker, tambourine strokes and a tambourine
  roll, a cowbell, claves, a woodblock, a high agogo and a guiro. 66 samples, 39.0 s of 16-bit, 44.1 kHz stereo,
  2.56 MB over the wire as `.odkz`.
- **The note map.** General MIDI's percussion where it is: 54 tambourine, 56 cowbell, 60 and 61 bongos, 62 muted,
  63 open and 64 low conga, 67 agogo, 69 and 70 the big shaker, 73 guiro, 75 claves, 76 and 77 woodblock, 82 shaker.
  A kit's notes play as a hand player would: 35 and 36 the cajon's bass, 38 and 40 its slap, 42 and 44 the shaker,
  46 the tambourine, the high toms (50, 48, 47) the conga and the low ones (45, 43, 41) the low conga. So any beat
  written for a kit plays on it. 33 (Studio A's held roll) is the tambourine roll, which rings while its note is
  held (a 3 s loop, as Rusty Brushes' stir). Cymbal notes play nothing ("Not in this kit").
- **Even strokes.** VCSL's two strokes of one layer were recorded up to 6.6 dB apart (the low bongo), so each stroke
  plays at its layer's level, measured from its own first 150 ms (`even` in `drumSamplerKernel`): a run of one note
  at one velocity is level whichever stroke plays. A few pieces VCSL recorded quieter than their neighbours on one
  knob sit higher by a fixed `offset` (the small shaker 10 dB, the guiro 12, the agogo 6, the claves 4, the low
  conga 3).
- **A muted conga stops the open one** (within 30 ms), and an open stroke the muted one (60 ms).
- **Params:** `tune`, `decay`, `tone` and `level`, as the other kits, and a level for the cajon, congas, bongos,
  shakers (with the tambourines and guiro) and bells (cowbell, agogo, claves, woodblock). The defaults ease the cajon
  back 3 dB and lift the congas and bongos 6, the shakers 6 and the bells 3. At the defaults the drum phrase
  measures -18.1 LUFS and -1.5 dBTP; the limiter eases only the hardest strokes, by 2.2 dB at most (the low bongo).
- **The QA rubric** accepts clipping (the cajon's loudest bass pairs one stroke of hit 3 with one of hit 2, as the
  other of hit 3 is clipped), DC and the heads. For review: the small shaker's floor and tail (VCSL's files stop while
  it sounds; the build cuts it at 0.24 s with a 30 ms fade), the softest woodblock's floor, the round robins (the
  kernel evens them) and the tambourine roll's two layers, 8.3 dB apart (the rubric asks 10). Waived in the recipe, with its reason:
  phase coherence (a spaced pair over small, bright percussion, the high bongo, the tambourines and the woodblock:
  r from -0.2 to 0.2, not a mic out of phase).

`tools/drumkit-test.js` holds it to all of this, and the golden scene `inst:core.handkit#a449e40fb8b4` pins its render.

## Rusty Sticks (`core.metalkit`): a metal kit

Big Rusty Drums (Karoryfer Samples, CC0 1.0), the kit Rusty Brushes plays, hit hard with sticks: each drum is its close mic panned to its place
in Studio A's layout plus the overhead pair, the hats and cymbals the same with the overheads louder. `app/src/devices/builtin/metalkit.js`;
the samples come by kernel data, built from `tools/kits/big-rusty-sticks.js` by `tools/kits/blend.js`.

- **What it plays.** On Studio A's note map: 35 and 36 the kick; 38 snare, 40 rimshot, 37 side stick; 42 closed hat, 22 tight, 44 pedal,
  23 quarter-open, 24 half-open, 46 open, 21 foot splash; 50/48, 47, 45 and 43/41 the 14", 15", 18" and 22" toms (the 22" is a kick on its
  side); 49 crash, 57 sizzle crash, 52 China, 55 stack, 51 ride, 53 bell, 59 ride edge; 27, 28 and 29 choke the crashes and the China, 25
  the ride. Any other note plays nothing. 176 strokes, 12.6 MB over the wire.
- **Strokes never repeat.** Each hit draws from its velocity layer and the nearer neighbour's, never either of the last two strokes on that
  piece, with a seeded +-0.4 dB and +-4 cents of its own. Every stroke starts 1 ms before its attack, and the kernel declares that with its
  limiter's look-ahead as latency, so hits land on the grid.
- **TIGHT** (5-60 ms, 18): a new kick fades the last over that time, and each kick's tail is held to it (40-150 Hz T60 0.19 s at 18).
- **The trigger.** CLICK (a 2-6 kHz burst and a one-sample beater impulse, 4 ms) and SUB (a sine that falls an octave onto SUB HZ over
  12 ms and dies with TIGHT), at each kick's attack, the sub in the stroke's own polarity; TRIG VEL is how much velocity moves them. -40
  is off. At the defaults (-12, -10) the 2-6 kHz band in a kick's first 10 ms is 9.4 dB under its low band. A missing kit plays the trigger
  alone.
- **ROOM** (-14 dB) and **ROOM SIZE**: a small live room (`kitroom.js`) each piece sends into: the snare 1, the toms 0.8, the cymbals 0.3,
  the hats 0.15, the kick 0.1.
- **Levels and presets.** A level for the kick, snare, hats, toms, ride, crashes and China; the drum phrase measures -16.7 LUFS, -1.4 dBTP.
  Modern (the defaults), Natural (no trigger, more room), Tight (TIGHT 10, the room low).

`tools/metalkit-test.js` holds it to this; the golden scenes `inst:core.metalkit#9e0becc0ce4f` and its `:trigger` twin pin its render.

## Drum Riser (`core.drumbus`): a drum bus

What a record's drum bus does, as one insert on the drum track (the studio has no sends, so the parallel paths are inside it):
`app/src/devices/builtin/drumbus.js`.

- **ATTACK and SUSTAIN** (-100 to +100%): a transient shaper on the difference of a fast and a slow follower, linked.
- **SQUASH** (0-1) with **COMP ATK** (1-50 ms) and **COMP REL** (20-400 ms): a bus compressor, threshold -6 to -30 dB and 2:1 to 8:1
  together, its detector Squeeze Box's (the lows out of it, half peak and half RMS, a release that slows while it works, a slow makeup).
- **DRIVE** and **CLIP** (SOFT, HARD): 4x oversampled, the level given back by a measured table.
- **ROOM** and **ROOM SIZE**: the kit room on the whole kit; **CRUSH**: a mono copy high-passed at 120 Hz, a brick wall and a drive. Both
  in parallel, lined up with the main path.
- **MIX** and **OUTPUT**. It declares 23 samples of latency. At its defaults it is within 0.3 LU of bypass. Presets: Modern (the snare's
  crest from 15.4 to 12.6 dB), Room, Smash, Glue.

`tools/drumbus-test.js` holds it to this; the golden scene `fx:core.drumbus` pins its render.

## Half Stack, Iso Cab and Y Cable (core.stack, core.cab, core.bassrig): a guitar amp that renders

A high-gain head into a measured 4x12, as a kernel. The canonical render, the agent's render_and_measure and the
studio hear the same amp, within the house's -90 dB. (The Guitar Studio's graph amps render clean in Node.) The devices
are `app/src/devices/builtin/stack.js`, `cab.js` and `bassrig.js`. The DSP they share is `amp-lib.js`: kernel text,
not `dsp` names.
- **Half Stack**:
  - GATE: before the gain.
  - TIGHT: a 12 dB/oct input high-pass.
  - BOOST, with B DRIVE and B LEVEL: a green overdrive whose clipped branch starts at 720 Hz.
  - GAIN, over three triode stages.
  - BASS, MID and TREBLE: the TMB stack's own response.
  - The power amp: MASTER and SAG, then PRESENCE and DEPTH.
  - CAB: six IRs, FILTER 4X12 or OFF.
  - LOW CUT, HIGH CUT and LEVEL.
  - QUALITY: 4X by default; 8X aliases about 15 dB less for twice the cost.
  - 28 samples of latency, so it can be played live. Presets: Modern, Djent, Thrash, Doom, Lead.
- **Iso Cab**: CAB, LOW CUT, HIGH CUT, MIX and LEVEL. The cab on its own, after a graph amp, a pedal or any drive. No
  latency.
- **Y Cable**: XOVER (80-400 Hz), LOW, DRIVE, MID, TREBLE, CAB, HIGH and LEVEL. A clean, compressed, mono low end under
  a driven top through a guitar cab. Presets: Modern, Grind, Clean.
- The cab IRs are kernel data (`data: { cabs }`, 39 KB). Until they arrive, or on a server without them, every IR
  choice plays the Filter 4x12 at the same level, and the card says so.

## Kernel data: samples a kernel plays

A kernel sees only `dsp`, so a device that plays recordings needs the host to bring them. A def can name files by
their content: `data: { kit: 'sha256-<64 hex>' }`. The file is `app/kits/<64 hex>.odk`, and the kernel gets it,
decoded, as `create({ sr, seed, dsp, data })`: `data.kit = { sr, bits, channels, meta, samples: [{ id, ...,
frames, ch: [Int16Array, ...] }] }`.

- **The hash is all a song carries.** Songs, share links and device files name the hash, never the audio, so they stay
  small. `defineDevice` keeps only `{ name: 'sha256-<hex>' }` (up to four) and drops anything else in `data`.
- **The container is ours, and integer.** `kernel/odk.js`: `'ODK1'`, a JSON header, then 16- or 24-bit PCM, planar,
  little-endian, at 48 kHz. Every engine reads the same integers, and `x / 32768` is exact anywhere, so a render is
  bit-exact everywhere. There's no `decodeAudioData`, which resamples by each browser's own method. The format
  itself is never compressed.
- **Packed for the trip.** Beside each `.odk` sits `<hex>.odkz` (`kernel/odkz.js`): the same header, then each
  sample's second-order differences, zigzagged and split into a plane of high bytes and one of low bytes. It is
  lossless and gzips far better: Virtuosity Kit goes over the wire in 7.10 MB instead of 11.05. The studio fetches
  the `.odkz`, unpacks it and checks the rebuilt `.odk` against the hash, so the worklet, Node and the golden hashes
  never see it, and the pinned hash is still the `.odk`'s. A wrong byte fails that check: the studio says which file
  in the console and fetches the plain `.odk` instead, and without one the device plays nothing. Plain copies an
  earlier visit cached still load.
- **Loaded lazily, once.** Nothing is fetched until something asks: a track using the device (`kernel/host.js` asks
  when it builds an instance), or a sound picker showing it (the suggested-sounds card's rows) or the pointer resting
  on it (the browser, Find), through `ui/kitload.js`, so a first try isn't silent. `kernel/data.js` fetches the file, checks its SHA-256 against its name, and keeps it in IndexedDB
  (`overdub-kits`, beside the audio assets; the packed bytes, which are smaller), so the next visit never fetches it. Each audio context's worklet decodes
  it once: the first node that needs it carries the bytes, and every node after names the hash (a node whose hash
  arrives before those bytes do gets its kit when they land).
- **Nothing streams mid-render.** An offline render (an export, the device check, the preview) waits for the file
  before it starts, however long the download takes (an export never swaps in a stand-in for want of it). A live instance starts at once with `data.kit = null` (silence). When the file arrives,
  `create()` runs again with it, crossfading from that silence. While it loads, the device's card says **Loading
  samples…**, and the track's header, a picker's row and the browser's trial bar show how far along it is. A trial
  of the sound waits for it before it plays the take, and a key pressed meanwhile sounds once it lands if it is still
  down, so no note of a first try is lost to the download.
- **A missing file plays nothing, and says so.** A hash this server doesn't have (never fetched, or a song from
  somewhere else) gives the kernel `null`. The card says **No samples here**, the engine reports it (kind `'data'`),
  and the Node renderer warns. The device check fails it as silent.
- **Node reads the same file.** `engine/node/data.js` reads `app/kits/` for the canonical renderer and the device
  check, whose render process may read that folder too. A golden scene that plays a kit carries the kit's hash in
  its name (`inst:core.drumkit#<12 hex>`) and its entry pins the whole hash, so a different kit is a different
  scene, never a moved one.
- **The audio stays out of git.** `node tools/fetch-kits.js` downloads the pinned upstream files (by commit, each
  checked by SHA-256, with the upstream licence checked too), decodes them with `tools/flac.js` (held to each file's
  MD5), trims and converts them in integer arithmetic, and writes the `.odk` and its `.odkz`. The same files always
  build the same bytes: `--verify` rebuilds from the download cache and compares. `deploy/deploy.sh` refuses to deploy
  unless every kit the shipped devices name is in `app/kits/`, is its own hash and has an `.odkz` that unpacks to it,
  and uploads both, gzipped and cached for good
  (`immutable`: a file named by its hash never changes), before the code that names them. Without the kit, the tests that need it skip
  it and say so.

`create()` runs on the audio thread (live, on every new instance and when the file lands), so it mustn't read a whole
kit: anything worked out from all of the audio belongs in the file, written once by the tool that builds it (Virtuosity
Kit's stroke starts are). A kernel can only name data the studio hosts, so this is for built-in devices for now: an agent's kernel gets
`data` only if its def names a file this server has.

## Melodic kits: a sampled instrument across the keyboard

A melodic kit is an ordinary `.odk` whose samples carry a few more header fields. They are optional, so every older
kit parses exactly as before, under the same format string:

| field | what | from SFZ |
|---|---|---|
| `key` | the note it was recorded at | `pitch_keycenter` |
| `lo`, `hi` | the keys it plays | `lokey`, `hikey` |
| `vlo`, `vhi` | the velocities it plays, 0-127 | `lovel`, `hivel` |
| `rr` | its round robin among the samples sharing its keys and velocities | `seq_position` |
| `trig` | `'attack'` (default) or `'release'` | `trigger` |
| `tune`, `gain` | cents and dB, measured or from the source; applied by the kernel, never baked in | `tune`, `volume` |
| `start` | the frame it starts from | `offset` |
| `loop` | `{ s, e, mode }` in frames; `'sustain'` loops while the key is down, `'continuous'` always | `loop_*` |
| `cutoff` | Hz, a 2-pole low pass on that sample | `fil_type=lpf_2p`, `cutoff` |

The kit's `meta` may add `kind: 'melodic'`, `velcurve: [[vel, dB], ...]` (default: the SFZ curve, 40 log10(vel/127)),
`env: { a, r }` and `rt: { decay }` (dB per second held, off a release sample).

`samplerKernel(opts)` in `app/src/devices/builtin/sampler.js` plays one. A device is that kernel, its params
(`samplerParams()`) and a kit hash; Upright (`core.upright`) is the first.

| device | kit | recipe |
|---|---|---|
| Parlour Upright (`core.upright`) | FreePats Upright Piano KW: 2 layers, 66 zones, the source's own SFZ | `tools/kits/upright-kw.js` |
| Full Stick (`core.grand`) | Salamander Grand Piano V3: 3 of its 16 layers at 30 notes, release noise, cut to fit 15 MB | `tools/kits/salamander.js` |
| Rosin (`core.ensemble`) | VSCO 2 CE: four string sections' sustains, 15 zones, 2 layers, looped | `tools/kits/vsco-strings.js` |
| Damper Bar (`core.vibes`) | VCSL Vibraphone: 11 bars, soft and hard mallets, 4 layers | `tools/kits/vcsl-vibes.js` |
| Roundwound (`core.ebass`) | Karoryfer Black And Blue Basses, dark black: 14 zones, 4 layers, 2 round robins, mono | `tools/kits/karoryfer-bass.js` |
| Hollow Body (`core.eguitar`) | Karoryfer Black And Green Guitars, green: 16 zones, 3 layers, 2 round robins, mono | `tools/kits/karoryfer-guitar.js` |
| Bell Up (`core.barisax`) | Karoryfer Bear Sax: 11 zones, 2 layers, looped on Karoryfer's own loops, mono | `tools/kits/karoryfer-barisax.js` |
| Endpin (`core.cello`) | Karoryfer x bigcat cello: 16 zones, 2 layers, looped on Karoryfer's own loops, mono | `tools/kits/karoryfer-cello.js` |
| Head Joint (`core.flute`) | VSCO 2 CE: the flute's sustains with vibrato, 10 zones, 1 layer, looped | `tools/kits/vsco-flute.js` |
| Spit Valve (`core.trumpet`) | VSCO 2 CE: the trumpet's straight sustains, 10 zones, 2 layers, looped | `tools/kits/vsco-trumpet.js` |

**Building one.** `node tools/fetch-kits.js` builds every kit a device names (`--only <name>` for one). Parlour
Upright's recipe names an upstream SFZ; the others lay out their own regions (`file, key, lo, hi, vlo, vhi, layer,
tune, trig`) and `tools/kits/build.js` builds them. A recipe also says:

- **`cut`**: where each note ends. A level (`db` dBFS, or `rel` dB under its own attack) or a length by register
  (`cap`), whichever comes first, then a squared fade, so a note cut for size dies a little early instead of stopping.
- **`level`**: `'flat'` puts every sample on one smooth curve across the keys, and the kit's `velcurve` makes the
  dynamics; `'key'` keeps the layers' recorded distance. **`align`** lines each layer's start up with the next layer
  of its key, for the kernel's `'aligned'` crossfade.
- **`loop`**: a sustain loop for each note, found by searching for the loop whose two ends match best, with the
  crossfade baked into the samples (check 14 of the QA rubric reads it).
- **`channels: 1`** stores the mid of a stereo source.

Every build runs the QA rubric (`tools/kits/qa.js`) and writes `tools/.out/library/<name>/qa.json`; a check that fails
ships only with a written waiver in the recipe.

- **Pitch by resampling**, through a 16-tap Kaiser-windowed sinc with 512 phases. The table is built in `create()`
  from `+ - * /` and `sqrt` alone (its own sine and Bessel series), so it is the same numbers on every engine. A
  15 kHz tone moved up 3 semitones keeps everything else 72 dB down (the drum kit's Hermite: 16.5 dB). The limit:
  the cut is fixed at 0.44 of the kit's rate, so a sample moved up folds its top octave's last few kHz back below
  Nyquist. Within a zone of a few semitones that stays above 20 kHz.
- **Velocity** picks the layer; near a boundary both layers play, crossfaded. The level follows the curve, scaled by
  DYNAMICS.
- **Round robins** come from the instance's seed and never repeat back to back.
- **An envelope:** a 1 ms ramp in, then an exponential release (RELEASE, seconds to -60 dB) at note-off. A release
  sample, where the kit has one, sounds at the level the note had decayed to.
- **Voices and the pedal are the host's:** `poly` of them, the oldest stolen; note-offs wait while the sustain pedal
  is down.
- `tools/sampler-test.js` holds every one of those to a kit of sine waves.

## A big instrument: Light Table (`core.wavetable`)

Light Table is the wavetable synth: two oscillators that sweep through tables of single-cycle frames, a sub, noise,
a filter, three envelopes, four LFOs, an 8-slot mod matrix and FX (drive in six shapes, `fx_dist`, and Gaffer Tape's
three-band dynamics inside it, `fx_mband`). It is the largest built-in, with 117 params, and a
worked example of three things a big kernel needs. The design note, with every param, table and number, is
`docs/research/LIGHT-TABLE.md`.

- **Data the page and the kernel share.** A kernel sees only `dsp`. So when a face needs the same data as the sound,
  put the data in one self-contained function (no imports, nothing from the module's scope) and paste the function's
  source into the kernel: `const LT = (${lightTables})(bank);`, with any data it needs as a literal (the AKWF bank,
  packed to keep the kernel under 256 KB). The page imports the same function
  (`app/src/devices/builtin/wavetables.js`) to draw what plays. `tools/wavetable-test.js` checks that the kernel
  carries it verbatim.
- **Big data, built lazily.** The tables are built in the worklet. The frames nearest the playing position are built
  first, at once, and the rest four a block, so changing a table never holds the audio thread. Each instance holds
  14.9 MB.
- **Many params.**
  - **Keys** are grouped by prefix: `a_*`, `b_*`, `sub_*`, `noise_*`, `flt_*`, `env1_*`, `lfo1_*`, `m1_*`, `macro1`,
    `fx_*` and `voice_*`. Each has a role and a desc.
  - **Reads** stay fast: once a block, the kernel copies the host's params into an object of fixed shape, so hundreds
    of reads a block cost little.
  - **Nothing allocates** once it runs.

To drive it, as an agent or by hand:
- **Start from a preset.** Each preset's blurb opens with its family, as in "Bass: a Reese, …". Sixteen are for bass
  music (tagged `bass-music`: subs, growls, riddim stabs, Reeses, wobbles, chords, a lead and a riser), each with MACRO
  1 wired to its main move; `list_devices { tag: "growl" }` finds them.
- **Pick a table.** `a_table` is a switch over 26 tables: 14 built in code, then 12 of recorded single cycles from
  AKWF (Adventure Kid Waveforms, CC0), nine waves each. `list_devices` with `detail: "params"` lists them, and the
  design note says what each sounds like. `a_pos` moves through the table.
- **Pick a wave.** `get_device` with `library: ""` lists the AKWF families and their waves; `library: "<family or
  wave>"` gives each one's params (`{ "a_table": "AKWF VOICE", "a_pos": 0.25 }`): wave i of a family is at POS i/8.
- **Wire a mod slot.** Slot n is `mn_src` (an index into `SOURCES`), `mn_dst` (an index into `DESTS`) and `mn_amt`,
  from −1 to 1.
  - The amount is in the destination knob's travel. At CUTOFF, 1 is 10 octaves, so 0.1 is an octave. PITCH is 24
    semitones and FINE 1 semitone.
  - For example, `{ m1_src: 4, m1_dst: 1, m1_amt: 0.3 }` sweeps osc A through 0.3 of its table with LFO1.
  - `MACRO 1`–`4` are sources that do nothing until a slot uses them.
  - A slot aimed at `M1 AMT` scales slot 1, so MOD WHEEL → M1 AMT puts a vibrato's depth on the wheel.

## For agents

Everything below is `KERNEL_GUIDE` from `app/src/kernel/guide.js`, word for word: the agent layer puts it in the
agent's context. Both examples in it pass `checkDevice` with no warnings (`tools/kernel-test.js` checks that, and that
the guide names every `dsp` function and no others).

A device is a definition plus a kernel: the source of ONE JavaScript expression that evaluates to an object. It runs
in an AudioWorklet and gets `dsp` (below) and nothing else: no DOM, fetch, Date or timers; Math.random throws. The
host does stereo I/O, polyphony, sample-accurate notes, param smoothing, hot reload, bypass, and silencing faults.

## The definition

```js
{ id: '<author>.<slug>' (lowercase a-z 0-9 . _ -, forever: songs refer to it; e.g. 'claude.tape-echo'),
  name: 'Tape Echo' (shown everywhere; may change later, unlike the id), kind: 'effect' | 'instrument',
  cat: synth keys drums bass pluck sampler | dynamics eq filter pitch drive fuzz amp mod time ambient glitch utility other,
  blurb: '<= 60 chars: what it does for the player',
  params: [ParamSpec], look: { ... }, tail?: seconds it rings after the input/notes stop (default 0),
  drone?: true if it never falls silent on its own, trails?: true to let the tail ring out when bypassed,
  presets?: [{ name: 'Felt', params: { tone: 0.2 } }] (named sounds; a param left out keeps its default),
  key?: true (an effect that hears another track: t.key, "Keys" above),
  kernel: '<source>' }
```

ParamSpec, continuous: { key, label, min, max, def, curve?: 'lin' | 'log' (log needs min > 0; use it for Hz and
times), unit?: 'Hz' | 'dB' | 'ms' | 's' | '%' | 'st' | 'note' | 'x', role?, desc?, step?, group? }
ParamSpec, switch: { key, label, opts: ['LP', 'BP', 'HP'], def: 0 } (the kernel sees the index 0, 1, 2).
role (so agents and macros find the right knob): tone level drive mix time feedback rate depth size decay attack
release pitch shape width gate sens. Keys are forever; never 'id', 'on' or 'uid'. 3-5 good params beat 10.
group (optional): the section a param sits in, in the device's window ('Filter', 'Envelope'); key prefixes
(flt_cut, flt_res) do the same.

look (the face is drawn from it; missing fields are picked from the id): color, ink, led (hex), shape box | wide |
mini | round | wah | rack, finish flat | sparkle | brushed | hammer | stripe | check, knob black | chicken | cream |
chrome | small, label script | block | plate | stencil. Instruments get a synth panel in color/ink/knob.

## The kernel

Effect:

```js
({ create({ sr, seed, dsp, params }) {
     // allocate here: filters, delay lines, buffers, lookup tables
     return { latency?: samples, process(L, R, n, p, t) { /* in place: L/R hold the input, write the output */ } };
} })
```

Instrument (the host owns voices: poly of them, default 8, max 64; it steals the oldest released voice, then the
oldest, with a 5 ms fade):

```js
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
```

- n is the number of frames to do now. It varies (the host splits blocks at note events): loop to n, never L.length.
- p is the params object by key, smoothed by the host (continuous params glide ~10 ms, switches and stepped params
  snap, values are clamped to their range). Read it; never store or mutate it.
- t = { bpm, playing, beat, bend, mod, sustain }: the transport at the start of the block (beat advances while
  playing) and the player's expression. Sync time to t.bpm (seconds per beat = 60 / t.bpm) and LFOs with
  lfo.sync(beats, t). t.bend is the pitch bend in semitones (multiply your frequencies by 2^(t.bend / 12)), t.mod
  the mod wheel 0..1 (vibrato, brightness, a rotor: your choice), t.sustain whether the pedal is down (the host
  already holds note-offs while it is). In a voice's render they are that note's own (a note can carry its own bend
  and mod); in process, the channel's. A kernel that ignores them still plays.
- A keyed effect (`key: true`) also sees t.key = { l, r, on }: this block's key (another track's sound, "Keys" above),
  silent with on false when it has none.
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

Convolution: convolver(taps, { direct }?) (taps: one array, or [left, right]; a cab, a room) -> .process(x, outL, outR,
n) (mono x in, one output per taps channel; in place is fine) .set(taps) (new taps up to the first length, no
allocation) .reset() .latency (128 frames; 0 with direct: 128, which convolves the first 128 taps directly: declare
it). fft(n) (n a power of two, 16..8192) -> .forward(x, Xr, Xi) (n/2 + 1 bins) .inverse(Xr, Xi, x). Both are the
same doubles on every engine.

## What the check reports (define_device returns it)

{ ok, errors, warnings, level: { lufs, deltaLU }, truePeak, nan, tail: { seconds, decays }, cpu: { pct },
latency: { samples }, deterministic, extremes: { cases, failed }, voices?: { poly, maxVoices, steals }, stuck?,
keyed?: { deltaLU, grMaxDb } }. keyed is a key: true effect's DI strum again, keyed by the drum loop (a warning if
nothing changes: the key is ignored).
ok is false on a compile error (with the line), NaN/Infinity, a peak over +6 dBTP at defaults, a runaway at an
extreme setting, a stuck note, or no sound at all at defaults. Effects are
rendered with a DI guitar strum and a drum loop; instruments play chords, a melody, a fast run, low to high notes
and soft to hard velocities. Fix every error; act on warnings unless you mean them.

## Example: an effect

```js
{id: "claude.tape-echo", name: "Tape Echo", kind: "effect", cat: "time", by: "claude", blurb: "Tempo-synced echoes that darken as they repeat", params: [{key: "division", label: "TIME", opts: ["1/16", "1/8", "1/8.", "1/4", "1/2"], def: 2}, {key: "feedback", label: "REPEATS", min: 0, max: 95, def: 40, unit: "%", role: "feedback"}, {key: "tone", label: "TONE", min: 500, max: 12000, def: 3500, curve: "log", unit: "Hz", role: "tone"}, {key: "mix", label: "MIX", min: 0, max: 100, def: 30, unit: "%", role: "mix"}], look: {color: "#8a5a2b", ink: "#fff3e0", shape: "box", finish: "hammer", knob: "cream", label: "script", led: "#ffb347"}, tail: 6, trails: true, kernel: `
({
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
})` }
```

## Example: an instrument

```js
{id: "claude.glass-harp", name: "Glass Harp", kind: "instrument", cat: "pluck", by: "claude", blurb: "Plucked strings with a soft glassy shimmer", params: [{key: "decay", label: "DECAY", min: 0.3, max: 8, def: 3, curve: "log", unit: "s", role: "decay"}, {key: "bright", label: "BRIGHT", min: 0, max: 1, def: 0.6, role: "tone"}, {key: "shimmer", label: "SHIMMER", min: 0, max: 100, def: 30, unit: "%", role: "mix"}], look: {color: "#3b4f7a", ink: "#eef3ff", knob: "chrome", led: "#9fd8ff"}, tail: 8, kernel: `
({
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
})` }
```
