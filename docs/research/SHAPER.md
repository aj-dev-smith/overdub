# Scribble Strip: a shaper you draw, in time with the song

AJ asked for "cool VST type plugins. think serum". One that producers reach for all the time is a tempo-synced shaper.
You draw a shape over a beat or a bar, and it moves the volume, a filter or the pan in time. That covers the pumping
sidechain feel, trance gates, stutters, slow swells and auto-pan. This note covers what producers like about the ones
they use and what Overdub built: `core.shaper`, **Scribble Strip**
([`app/src/devices/builtin/shaper.js`](../../app/src/devices/builtin/shaper.js)), and its window
([`app/src/ui/editors/shaper.js`](../../app/src/ui/editors/shaper.js)). The checks are
[`tools/shaper-test.js`](../../tools/shaper-test.js).

The name comes from the console: a scribble strip is the tape above a channel's fader, pan and filter, where the
engineer writes what each one does. This one is where you draw what they do.

## What producers like about shapers

**Pumping without the sidechain.**
- Ducking with a compressor needs a key signal, a ratio, an attack and a release. The shapers sell themselves on
  skipping all of that.
  - Waves: "Pumping music in time with the beat is an essential EDM technique, but setting it up is complicated and
    cumbersome … No sidechaining needed" ([OneKnob Pumper](https://www.waves.com/plugins/oneknob-pumper)).
  - Kickstart: "Forget fiddling about with compressors … instantly get sidechain ducking, with no setup"
    ([kickstart-plugin.com](https://kickstart-plugin.com/)).
- EDMProd calls LFOTool "a staple replacement for traditional sidechain". It says Kickstart "emulates a house-style
  kick drum trigger", so the 4/4 pump stays steady even where the song has no kick
  ([EDMProd](https://www.edmprod.com/sidechain-compression/)).
- Devious Machines pitches Duck as "Simply carve out the exact shape you need … Lock it to the beat like an LFO"
  ([KVR](https://www.kvraudio.com/product/duck-by-devious-machines)).
- Cableguys says VolumeShaper "does away with the clicks and pops that can plague compressors"
  ([VolumeShaper](https://www.cableguys.com/volumeshaper)).

**The limit.** A shaper locked to the tempo lines up only with a regular kick. ShaperBox adds audio triggering for a
kick that "isn't 4x4" ([ShaperBox](https://www.cableguys.com/shaperbox)).

**Drawing points with curves.**
- LFOTool has a "point+tension-curve editor" ([Xfer](https://xferrecords.com/products/lfo-tool)).
- Gross Beat bends a segment with a tension handle "between control points"
  ([Image-Line](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Gross%20Beat.htm)).
- Sound On Sound's ShaperBox 3 review praises "pen tools now making it much easier to create curves, steps and
  ramps, and to sync your curve's shape to the tempo grid"
  ([SOS, Feb 2023](https://www.soundonsound.com/reviews/cableguys-shaperbox-3)).
- Trance gates are painted step by step: "Click to toggle steps on or off"
  ([Kilohearts Trance Gate](https://kilohearts.com/products/trance_gate)).

**One shape for each thing it moves.**
- LFOTool runs "Up to 5 graphs simultaneously (Cutoff/Reso/Pan/Variation/Volume)". Its listed uses are "tremolo,
  auto-pan, trance-gate, side-chain compressor simulation"
  ([KVR](https://www.kvraudio.com/product/lfotool-by-xfer-records)).
- ShaperBox's filter shaper moves "both cutoff frequency and resonance" (the SOS review).

**Smoothing, so sharp shapes don't click.**
- Sound On Sound: "a very useful Smooth function, which softens any sharp changes you make in the curve, reducing
  the possibility of clicks caused by sudden parameter value changes".
- VolumeShaper has a Smooth control. Gross Beat's "ATT" smooths volume changes from 0 to 500 ms.
- The click is physics. A gain change made in one step gives "a soft 'click'"
  ([Wikipedia, Zero crossing](https://en.wikipedia.org/wiki/Zero_crossing)). The Web Audio spec notes that "no
  automatic smoothing is done" on a value set directly
  ([W3C](https://webaudio.github.io/web-audio-api/)). Ableton's clip-edge fades run 0 to 4 ms
  ([Live manual](https://www.ableton.com/en/manual/clip-view/)).
- VolumeShaper's lookahead applies "a tight fade just before the sidechain begins". That is the idea behind
  Scribble Strip reading its shape ahead (below).

**Rates, from a stutter to a riser.**
- OneKnob Pumper goes "from 1/32 notes to bars". ShaperBox goes "from 1/4-note pumping FX to evolving multi-bar
  patterns". PanShaper does "16th-note stereo tremolo to 8-bar autopanning patterns".
- Ableton's Auto Pan has triplet and dotted time modes
  ([Live manual](https://www.ableton.com/en/manual/live-audio-effect-reference/)).

**A mix knob and a shelf of shapes.**
- Kickstart has a "Big Mix knob" and "16 hand-crafted curves".
- Duck ships presets for "side-chaining, gating, rhythmic patterns, tremolo".

**Seeing the shape where it plays.**
- ShaperBox's "high-res waveform display … locks to beats and bars".
- Kickstart shows kick and bass on one display.

Not confirmed: LFOTool's own Smooth knob (not on Xfer's page), Serum's LFO editor (its page doesn't describe it), and
the folk numbers for a release (1/8 to 1/4 note) or trance gates on 1/16 steps. Nothing below leans on them.

## What we built

**The device** is a kernel effect with three lanes: **volume**, **filter** (a resonant low-pass: cutoff and reso)
and **pan**.
- Each lane has its own shape of up to 16 points, a rate, a depth and an on switch. The rates run 1/32 to 2 bars,
  with triplets and dotted.
- Two knobs act on every lane: **SMOOTH** (0.1 to 100 ms) and **MIX** (dry/wet).
- What the top and bottom of a shape mean:
  - **Volume:** the top is full level and the bottom is the level pulled down by its depth (100%: silence).
  - **Filter:** the top is the cutoff and the bottom is the cutoff closed by its depth (100%: eight octaves lower).
  - **Pan:** at 100% depth the top is hard right, the bottom hard left, and the middle is centre. Panning is
    equal-power on the middle of the sound, and the sides narrow as it moves out.
- At its defaults it passes the sound through untouched: the volume lane is flat at the top, the other lanes are
  off and the mix is 100%.

**The shape is params: four for each point.** For lane `vol` (`flt` and `pan` are the same):

| Param | Meaning |
|---|---|
| `vol_n` | how many points the shape uses |
| `vol<i>_x` | where point *i* sits in one pass, 0..1 |
| `vol<i>_y` | its level, 0..1 |
| `vol<i>_c` | the bend of the line that leaves it, -1..1 (the lanes' convention: > 0 starts slow) |
| `vol<i>_s` | 1 for a step: hold, then jump at the next point |

That is 195 params for three lanes of 16 points, plus 13 knobs. They are `hidden` (kept off the face and the generic
window) and `auto: false` (kept out of the Add-a-lane menu, which would otherwise list 195 more entries per shaper).
Why this encoding:
- **Numbers, because kernels only see numbers.** An op can store a string, but the worklet turns every param into a
  number, so a text param like "0:1 0.5:0" could never reach the DSP. As numbers, a shape undoes, flips with A/B,
  sits in a preset, travels in a share link and is written by an agent in one `insert.set`, like any knob.
- **Free x, not a fixed step grid.** Moving the knee of a pump a hair later is the point of a shaper.
- **A step flag, not pairs of points.** A 16-step trance gate fits in 16 points. Drawing each jump as two points at
  one x would take 32.
- **Order doesn't matter.** The shape is the points sorted by x (a tie keeps the param order). So dragging a point
  writes two numbers, its x and y, and the store folds the drag into one undo step. Adding a point writes the count
  and its four numbers. Deleting one moves the last point into the freed slot.
- **The cost.** `get_device` and `list_devices` print 195 short lines for it, and a preset in `get_device` carries
  all 208 params. Only the first point's params carry a description; the rest are named by pattern.

**The text form.** `get_project` prints a shaper insert as words in the automation lanes' own format, not its 208
numbers. Core `summarize` calls the def's `describe(params)` for a device the studio ships:

```
fx_k3=Scribble Strip (core.shaper) volume every 1/4, depth 85%: 0:0~-0.35 0.6:1 1:1; filter off; pan off; smooth 4 ms, mix 100% (…)
```

**Timing.**
- A pass is one rate, locked to the transport's beat (the kernel's fifth argument). Beat 0 starts a pass, so a
  quarter-note pump dips on every beat. Stopped, it runs on at the tempo.
- A bar is four beats, because a kernel isn't told the meter (Keyhole and Echo Reel make the same assumption).
- SMOOTH is a two-pole low-pass on what each lane applies. Its time is the edge's 10-90% rise, and 0.1 ms means none
  at all, a hard edge for anyone who wants the click.
- The shape is read half the smoothing time ahead, so a smoothed edge is centred where it is drawn. A shape is known
  in advance, so this costs no latency. It is VolumeShaper's "tight fade just before" with nothing to wait for.
- Switching a lane on or off ramps over 10 ms. A new rate or a new point smooths over at least 8 ms for a moment, so
  changing the shape doesn't click either.

**The window** draws the selected lane's shape on a large canvas:
- one pass over the beat grid (snap steps in hairline, beats stronger), the passes either side in pencil, and a faint
  tint of the device's own tape colour under the pass;
- while the song plays, a leader-green dot rides the line at the transport's beat, labelled with what the lane
  applies there (−6.0 dB, 1.2 kHz, L 40%).

How you draw:
- **Add and move.** Click to add a point; drag one to move it. It snaps to the grid (Shift: off the grid) and stays
  between its neighbours.
- **Bend and delete.** Drag the small square on a line to bend it. Double-click a point to delete it.
- **The point's menu** (right-click, a long press or the menu key): step or line, straighten, add a point after it,
  or delete it.
- **Pencil.** Drag across the grid to paint steps; where a painted run ends, the old shape picks up again.
- **Snap** sets the grid in steps per pass, and says what that is in notes ("1/64 notes").

Every gesture is one undo step signed you, through `ctx.set`. While your hand is on it, the line is drawn in warm
ink. When an agent changes a shape, the canvas and that lane's tab flash in cool ink, the line is drawn cool for a
moment, and the window's line says what it drew ("Claude drew the volume shape: 3 points, every 1/4."). That line
comes from a small hook added to `ui/plugin.js`, an editor's optional `said(keys, by)`.

The rest of the window:
- **Lane tabs.** Each tab shows its shape drawn small, a lamp while the lane is on, and its rate.
- **Presets.** The eight presets are a row of drawings; the one the params match exactly is printed in reverse.
- **Knobs.** Each lane's knobs, plus SMOOTH and MIX, are the window's own bound controls, so automation, the menu and
  the agent's flash work as they do on every knob.
- **Keyboard.** Arrows move a focused point (one grid step sideways, 5% up or down; Shift for fine), Alt with up or
  down bends the line after it, Enter makes it a step or a line, and Delete removes it.
- **Phone.** Under 900 px everything stacks, with 44 px targets.

**The presets**, each the whole device:
- Pump (quarter notes)
- Pump (eighths)
- Gate (sixteenths)
- Stutter (two beats open, then sixteenth and thirty-second chops into the next bar)
- Swell over a bar
- Auto-pan (half notes)
- Filter wobble (eighths)
- Half-time duck

## What was measured

From `tools/shaper-test.js`. The DSP checks use the canonical Node render and the device check runs in Chromium.

| Check | Result |
|---|---|
| Defaults | The test program comes out bit for bit (the same SHA-256 as no insert). The device check reads 0 LU on the strum and the drums, no warnings, 418 extreme settings |
| Pump at quarter notes on a 1 kHz tone, 97 bpm | The drawn envelope to within 0.2% of full scale. The duck is half-way down within 0.1 ms of every beat |
| A step gate | Holds its drawn levels to 0.5%, both edges within 0.25 ms of where they're drawn |
| Pan | 15.9 dB between the sides at the extremes, total power flat to 0.01 dB across the pass |
| Filter lane closed to 500 Hz | Presence −41 dB, air −58 dB, lows −0.2 dB |
| Filter wobble | Centroid moves 406 to 3,414 Hz within a pass |
| Smoothing | At 0.1 ms a hard gate jumps 0.35 in one sample (the click, on purpose). At 3 ms no step is bigger than the tone alone makes |
| CPU | 0.4-0.5% of real time for one instance, at every preset |
| Repeatability | Every preset renders to the same hash twice |

## What's left

- **Kick triggering.** Following a kick that isn't four-on-the-floor would need a sidechain input, which the engine
  doesn't route to kernels yet.
- **Bars in the song's meter.** A kernel isn't told the meter, so "1 bar" is four beats.
- **Automating a single point.** Point params are `auto: false`, for the menu's sake. Depth, rate, on, cutoff, reso,
  smooth and mix all automate.
- **Editing in bulk.** Selecting several points to move together, and copying a shape from one lane to another.
- **More shapes and modes.** A swing control, rates longer than 2 bars, and high-pass or band-pass filter modes.
- **A golden scene.** It joins `EFFECTS` in `devices/builtin/index.js` once its scene is pinned
  (`UPDATE_GOLDEN=fx:core.shaper`). It is in `BUILTINS` now, so `sounds-test` measures it.
