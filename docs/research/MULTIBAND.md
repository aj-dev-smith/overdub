# Three bands, up and down: what producers love, and what Gaffer Tape does

A design note for Gaffer Tape (`core.multiband`), the three-band upward and downward compressor added on 2026-10-03
and rebuilt the same day, after a producer measured it making drums quieter and peakier (docs/FRESH-EYES-6.md): what
producers get from this kind of compressor, with sources, and what we built and measured. Where a source couldn't be
checked it says so. The checks are `tools/multiband-test.js`.

## What producers love about it

**One setting that became an instrument.** The sound started as a preset. EDMProd: OTT was "the name of a preset on
the Multiband Dynamics audio effect" in Ableton Live, and Xfer Records' Steve Duda later made a free plug-in of it for
other DAWs ([EDMProd][edmprod]). KVR's listing of the plug-in calls it "a re-creation of a popular aggressive
multiband upwards / downwards compressor setting used by many dubstep and electro producers" ([KVR][kvr]; the
download is on [Xfer's freeware page][xfer]). Wikipedia notes that "aggressive multiband compression (known as OTT)"
has become associated with a sonic character pursued in loud electronic genres such as dubstep ([Wikipedia: dynamic
range compression][drc]).

**Up and down at once, in three bands.** Downward compression "reduces the volume of loud sounds above a certain
threshold"; upward compression "increases the volume of quiet sounds below a certain threshold"; a multiband
compressor splits the signal with crossover filters so that each part "passes through its own compressor and is
independently adjustable for threshold, ratio, attack, and release" ([Wikipedia][drc]). EDMProd's summary of the
result: it "makes loud sounds quieter" and "makes quiet sounds louder", in lows, mids and highs, split at 88.3 Hz and
2.5 kHz ([EDMProd][edmprod]).

**A few big knobs.** The plug-in's controls are a "Depth control to scale the amount of compression", a "Time
control to scale the attack/release times of all bands" and "Input and Output gain controls" ([KVR][kvr]). On Time,
EDMProd: "Decreasing this knob will translate into a faster attack and release. And vice-versa." Depth works as the
dry/wet: the article's examples run at 100%, 39% on a guitar, 30% on drums and 16% on a whole track ([EDMProd][edmprod]).

**On everything.** On drums it brings up "the previously quiet nuances in the groove"; on synths and leads it
amplifies "filter sweeps, volume or pitch changes"; on a master it can "glue your mix together", though "no more than
20%, and usually sticking to ~10%" ([EDMProd][edmprod]).

**What it costs.** Lifting everything quiet lifts the noise and the tails with it, and a slow attack lets each hit's
first milliseconds through with the band's makeup on them, so the peaks come out higher than they went in; the usual
answer is a clipper or a limiter after it. (This is common producer knowledge rather than a quotable source; our own
measurements below show both.) A crossover built from minimum-phase filters also turns the phase near each split:
Linkwitz-Riley crossovers add back to an allpass, flat in level but not in phase ([Wikipedia: Linkwitz-Riley][lr]), and
"phase shift errors usually have to be corrected with an additional allpass network" ([Linkwitz Lab][lab]).

**Level-matched comparison.** "In the short term, louder tends to sound better" ([Vickers 2010][vickers]), so a
compressor that also makes things louder wins every quick A/B whatever it does. So Gaffer Tape's defaults sit near
the input's loudness, and its window shows, while the song plays, the loudness coming out against the loudness going
in: louder or quieter is never a guess. The presets that promise loud come out louder, and say so.

## What went wrong in the first version

The producer put Drum smash on Studio A drums (a Pop groove, the overheads and room pulled down): −16.6 to −20.0
LUFS, crest factor 18.1 to 22.2 dB, true peak −1.1 to −0.5 dBTP. Every preset came out 1.2 to 4.3 LU quieter with the
crest up 2.2 to 4.2 dB, and at 0% depth the part already went from −1.1 to +0.8 dBTP. Measured again here, the causes:

- **The ceiling held only the compressed part.** The dry part was never limited.
- **The crossover rebuilt the peaks.** The dry part was the input through the crossover, whose bands add back to an
  allpass. On the house kits, whose peaks the instruments' own safety knee had rounded off, its phase turn alone
  rebuilt them: Studio A's drum phrase went from −1.45 to +3.0 dBTP at depth 0, Gobo Kit's from −6.7 to −0.7.
- **The fronts got the makeup.** A band's detector (a mean square through two one-poles of 7, 3.5 or 1.75 ms) rose
  over several milliseconds, so a hit's front went through at the gain of the quiet before it: the lift and the band's
  makeup on it. The ceiling then pulled each hit down over its 80 ms recovery.
- **The classic pinned every band at one level.** Held at 30:1 above about −30 dB, the kits' low band (its median
  −23 to −29 dB, a kick's body −7 to −13 dB) was crushed while the high band's clicks got +7 dB: the clicks stood out,
  the loudness went down and the crest up. The presets were trimmed to the input's loudness, on test signals quieter
  and denser than the kits.

## What we built

- **Hearing the bands.** A Linkwitz-Riley crossover, 24 dB per octave (each split two Butterworth 2nd-order filters in
  a row: Linkwitz 1976, JAES 24(1), as [Wikipedia][lr] cites it; [Linkwitz Lab][lab]), into low, mid and high, at
  120 Hz and 2.5 kHz by default; the upper split stays at least 1.5 times the lower. The filters are trapezoidal
  state-variable filters (Zavalishin, *The Art of VA Filter Design*; not fetched for this note), which behave while a
  split moves. Only the detectors hear these bands: the sound itself is never split.
- **Applying the gains: shelves.** The three bands' gains go onto the whole sound: the mid band's gain on all of it, a
  low shelf at the lower split for the low band's over the mid's, and a high shelf at the upper split for the high
  band's. Each shelf is two trapezoidal SVF shelves of half its dB, in a row (Andrew Simper's form of the shelf, with
  its corner moved by the square root of A so it is halfway in dB at its split; from memory of his published Cytomic
  notes, not fetched here): 24 dB per octave at its steepest. When the three gains agree, the shelves are flat and
  the sound is that gain, untouched. So at depth 0 the output is the input, sample for sample, and the phase only
  turns where the bands' gains differ, and only as far as they differ. A band's gain reaches about as far past its
  split as a Linkwitz-Riley band does (within an octave); at the split it is halfway in dB where the bands' sum would
  lean to the louder band.
- **The detector and the curve.** Each band's level is its mean square through two one-poles (7, 3.5 and 1.75 ms, low
  to high), read as a sine's peak, and beside it the band's peak, which jumps with a hit and falls at the same speed.
  The static curve is unchanged: a soft knee 6 dB wide on both sides, in the form of Giannoulis, Massberg and Reiss
  ([JAES 2012][giannoulis]; the paper could not be fetched here, its certificate failed): above the downward threshold
  the band is pulled down at its ratio; below the upward one it is lifted at its ratio, by at most 30 dB, and the lift
  fades out between −66 and −84 dB so silence and hiss stay where they are.
- **Smoothing.** In dB. The downward side follows the mean square at the band's attack (falling) and release
  (rising). Beside it the same curve on the band's peak falls at the same attack but is let go within 10 ms: a fast
  attack catches a hit's front without holding the body after it down for the whole release, and a slow one lets the
  front through, as it should. The lift reads the louder of the two, lets go within a millisecond, and comes back at
  the release. TIME scales every attack and release. Held still, a steady tone's peak and mean square read the same,
  so the curve is what a steady tone gets.
- **The look-ahead.** The sound reaches its gains 5 ms after the detectors heard it, so a gain is in place when what
  asked for it arrives: the lift has let go before a hit, and a fast attack has pulled it down. (5 ms covers the
  detectors' own crossover, whose low band hears a kick about 4.4 ms late at a 120 Hz split.)
- **Depth.** Each band's gain is mixed toward 0 dB (1 + depth × (gain − 1), linear), before the shelves: at depth 0
  every band is at 0 dB and the shelves are flat.
- **The safety.** A look-ahead true-peak ceiling (Red Line's method: the peaks between samples estimated 4x, a 1.5 ms
  look-ahead and a smooth ramp) on everything it puts out, at −1 dBTP, at any setting. It lets go in two ways at once:
  within 10 ms, and over 150 ms as far as the last 30 ms of its work asks, so a short over (a hit's front) is shaved
  without pulling down what follows it, and a long one (a held bass note) is held steady instead of rippling. With the
  look-ahead it costs 328 samples at 48 kHz (6.8 ms), declared, so the studio lines everything up.
- **The classic** (the defaults, at 40% depth): every band lifted hard toward its upward threshold (6:1 below −26,
  −24 and −32 dB, low to high) and back within 60, 50 and 40 ms of each hit, so the room, the tails and the quiet
  detail come up; held gently at the top (3:1 above −4, −8 and −14 dB, attack 20, 10 and 5 ms); made up by 2, 1.5 and
  2 dB. At 40% it sits within a decibel of the input; all of it (Full depth, with the output half a decibel up) is 1 to
  3 LU louder and denser. These are our own numbers, set by measurement on the house's test signals and drum parts,
  not anyone's preset. Tuned the same way, the presets lean on the lift for the same reason: on drums whose peaks an
  instrument's safety knee has rounded off, holding each band's hits down reshapes them and raises the crest, and
  lifting the quiet between them lowers it.
- **One source of truth.** The detectors' crossover and weights, the curve, each band's dynamics (`mbStep`), the mix
  law and the shelves (`mbShelfCoefs`, `mbShelve`, and their response, `mbResponse`) are pure functions in
  `devices/builtin/multiband-curve.js`. The kernel embeds their source; the window imports them to draw each band's
  curve and the bands over the spectrum, and runs the same detectors on its live input for its readouts.
- **The window says what it is doing.** While the song plays: the loudness coming out against the loudness going in,
  in LU, large under DEPTH (in the warning ink, and said once in the window's line, when it takes a decibel or more
  off), an In and an Out meter (the Out with its peak), and each band held down or lifted, in dB, with a bar. All of it
  is worked out on the page from the window's own taps on the device's input and output: the input through the
  kernel's own detectors, both K-weighted (BS.1770) into 100 ms blocks, the change over the last 3 s. The taps are
  AnalyserNodes, which sum the two channels to one, so a band's readout is exactly the kernel's for a sound in the
  middle of the stereo, and close for a wide one; the loudness change is the same either way, since the device moves
  both channels together.

## What we measured

Everything here is Node, the canonical path, on the house's test signals (the DI strum, the drum loop, the program and
the bass DI) and three drum parts the canonical renderer plays: Studio A and Gobo Kit on the drum phrase, and Studio
A on the Pop verse and chorus grooves at 124 bpm with the overheads at −6.4 dB, the room at −8.1 and the crush at −23,
as the producer set them. The device check in Chromium agrees.

**Loudness and density.** Each setting's loudness against the input, in LU, and the change in its crest factor (sample
peak over RMS, as `measure()` reads it), in dB, on the drum parts:

| setting | drum loop | Studio A | Gobo Kit | Studio A, Pop |
|---|---|---|---|---|
| defaults (the classic at 40%) | +0.8 / −0.1 | +0.5 / −0.2 | +0.7 / 0.0 | +0.5 / −0.2 |
| Full depth | +2.5 / −0.2 | +1.3 / −1.4 | +2.1 / +0.1 | +1.3 / −1.3 |
| Drum smash | +2.9 / −1.4 | +1.2 / −2.1 | +1.6 / +0.1 | +1.5 / −1.9 |
| Vocal presence | +2.2 / −0.4 | +1.2 / −1.3 | +1.4 / +0.1 | +1.4 / −1.2 |
| Glue (bus) | +0.9 / −0.4 | +0.3 / −0.2 | +0.4 / +0.4 | +0.3 / −0.2 |
| Bass tighten | +0.9 / −0.8 | +0.2 / −0.6 | +0.3 / +0.2 | +0.4 / −0.6 |
| Subtle 30% | +0.6 / −0.1 | +0.3 / 0.0 | +0.5 / 0.0 | +0.4 / 0.0 |

The first version, measured the same way: the defaults −0.5 / +2.6, −1.5 / +4.2, −1.5 / +7.5, −1.6 / +4.8; Full depth
−0.4 / +6.4, −3.2 / +3.5, −3.3 / +9.8, −4.0 / +4.6; Drum smash −0.9 / +4.7, −2.8 / +3.7, −2.1 / +8.6, −3.6 / +5.1.
On the strum, the program and the bass the defaults are +0.9, +0.8 and +0.8 LU and Full depth +2.6, +2.4 and +2.4
(crest −0.9, −0.1, −0.3); Bass tighten takes the bass's crest down 1.0 dB at +1.3 LU. Depth 50 sits between: +0.6 to
+1.1 LU on every signal. The device check in Chromium (the DI strum and its own drum loop) agrees: +0.9 and +0.8 LU at
the defaults, no warnings.

**True peak.** Every preset, and the defaults at depth 0, 50 and 100, on the seven signals (63 renders): the loudest is
−1.10 dBTP, the ceiling at work on Studio A, whose own peaks reach −1.45. The program 12 dB hotter with OUTPUT at
+12 dB comes out at −1.10 dBTP through Full depth and at depth 0 alike; 112 settings at the ends of every range, at
−1.08 dBTP at the loudest. The first version reached +3.5 dBTP at depth 0 on the Pop part, +1.9 at its defaults and
+18.7 pushed at depth 0.

**Depth 0.** The output is the input, 328 samples on, bit for bit; Studio A keeps its −1.45 dBTP (the first version
rebuilt it to +3.03) and Gobo Kit its −6.69 (−0.74).

**A hit's front.** A 1 kHz tone at −50 dBFS (lifted, a 6 dB band gain on it) rising to −6 dBFS in 2 ms: with a 1 ms
attack the hit's first 10 ms come out +0.4 dB over where it settles (the first version: +20.8 dB, the lift and the
gain on the front); with a 40 ms attack, +19 dB over, as a slow attack should let it through.

**The shelves and the curve.** Band gains of +12, 0 and −12 dB measure within 0.0001 dB of `mbResponse` at 20
frequencies from 20 Hz to 19 kHz, and the shelves are +6 and −6 dB at the splits. A 1 kHz tone at −6 dBFS, held above
−30 dB at 30:1, comes out at −28.27 dB where the curve says −28.27; at −50 dBFS it comes up 15.82 dB at 40% depth (the
curve: 15.82) and 22.72 dB at 100% (22.73). A 60 Hz tone at −50 dBFS comes up 21.97 dB against the curve's 22.14 (the
low band's detector ripples a little at twice the pitch, and the lift lets go faster than it comes back).

**Time.** On a 500 Hz tone, from 6 dB to 2 dB away after a step, 23.0 ms at TIME 100% (a 22 ms attack times ln 3 is
24.2) and 72.5 ms at 300%; after a step down, 285 ms (260 ms times ln 3 is 286) and 844 ms.

**Clicks.** Depth, the output, a band's gain, the thresholds and the splits jumping every 0.25 s on a 220 Hz tone leave
nothing above −74.4 dBFS over 3 kHz, where a plain 6 dB step reads −56.1 dBFS. (The host moves a param in block-sized
steps; the kernel glides the thresholds, the ratios and the shelves' splits a sample at a time, or a lift let go
within a millisecond would follow each step: −60 dBFS without.)

**Cost.** About 1.7 times the first version: 2.1% of real time in Node against its 1.3%, the best of eight runs each,
taken in turn on the same busy machine (the device check warns at 25%).

**What the crossover did to peaks.** On the two house drum kits, whose peaks the instruments' own safety knee had
rounded off, the first version's crossover alone rebuilt them: +4.5 dB of true peak on Studio A and +5.9 dB on Gobo
Kit, at the same loudness. The shelves leave them alone until the bands' gains differ, and then only as far as they
differ.

## What adjust does with it

`adjust` measures what it does: "punch" by the crest factor, "squashed" and "glue" by the crest factor and the loudness
range. On this device more depth now measures denser (a lower crest) on drums, a bass and a mix, so in
`agent/lexicon.js` (`isMultiband`) "punchier" and "more dynamic" move its DEPTH down, and "squashed", "glued" and
"compressed" up (the demo song's drum part played on Studio A: depth 40 to 23.5% for "punchier" and to 56.5% for
"glue", each measured moving the asked way); every other word leaves it alone. On Gobo Kit depth barely moves the
crest either way, and adjust's own measuring turns the plan round when it has to, as it does for any device.

## Open questions

- A per-band readout exact for a wide stereo sound would need the kernel to tell the page what it is doing; the
  window runs the kernel's detectors on the summed channels instead.
- Gobo Kit is already dense (a crest factor of 11 dB on the drum phrase), and its loudest moments are ones where the
  bands partly cancel: a static 3 dB tilt of any one band alone raises its crest by 0.2 to 2.1 dB. Lifting the quiet
  between its hits is what makes it denser; holding its hits per band makes it peakier.
- Per-band solo and bypass, as Slide Rule has solo.

[edmprod]: https://www.edmprod.com/ott/
[kvr]: https://www.kvraudio.com/product/ott-by-xfer-records
[xfer]: https://xferrecords.com/freeware
[drc]: https://en.wikipedia.org/wiki/Dynamic_range_compression
[lr]: https://en.wikipedia.org/wiki/Linkwitz%E2%80%93Riley_filter
[lab]: https://www.linkwitzlab.com/filters.htm
[giannoulis]: https://www.eecs.qmul.ac.uk/~josh/documents/2012/GiannoulisMassbergReiss-dynamicrangecompression-JAES2012.pdf
[vickers]: http://www.sfxmachine.com/docs/loudnesswar/loudness_war.pdf
