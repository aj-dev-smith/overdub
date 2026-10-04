# EQ: what producers want from one, and what Slide Rule does

A design note for Slide Rule (`core.eq8`), the eight-band EQ added on 2026-10-03: what the EQs producers use every
day get right, with sources, and what we built and measured. Where a source couldn't be checked it says so.

## What producers value

**The display is the instrument.** Sound On Sound's review of Pro-Q 4 says FabFilter rebuilt the plug-in EQ "using
the principles of good software interface design instead of preconceptions inherited from hardware"
([SOS 2025][sos4]); the 2019 review notes the interface "has been widely imitated since its debut in 2011"
([SOS 2019][sos3]). Bands are made and moved on the curve itself ("click on the yellow overall curve and drag it
up or down", [FabFilter: EQ display][ffdisplay]), and Q comes from the mouse wheel or a modifier-drag (Pro-Q:
Ctrl/Cmd-drag, with Alt locking the drag's direction; Ableton's EQ Eight: Alt-drag, [Live manual][eq8]).

**A spectrum behind the curve, before and after.** Pro-Q draws the pre, post and sidechain spectra, tilted 4.5 dB
per octave by default so a typical mix reads level, and can freeze them ([FabFilter: analyzer][ffanalyzer]). EQ Eight
draws its output's spectrum behind the curves ([Live manual][eq8]). Spectrum Grab goes further: hover, and the
analyzer labels its peaks for you to drag ([FabFilter: spectrum grab][ffgrab]).

**Hearing a band on its own.** Pro-Q's solo plays "the part of the frequency spectrum that is being affected by that
band", and for a cut, what is being removed ([FabFilter: solo][ffsolo]); EQ Eight's Audition mode plays "only that
filter's effect" while you hold a dot ([Live manual][eq8]). It answers the old boost-and-sweep habit, which Sound On
Sound describes as boosting a peaking filter at a Q of three or four and sweeping it through the spectrum
([SOS: Using EQ][sosusing]; also [Mellor 1995][mellor]), without having to boost anything. FabFilter's own
caution applies to both: "beware of applying EQ changes to a track in solo mode", since what matters is how a sound
fits the mix ([FabFilter: introduction to EQ][ffintro]).

**Level-matched comparison.** "In the short term, louder tends to sound better" ([Vickers 2010][vickers], AES 129),
which is why formal listening tests match loudness first ([ITU-R BS.1534-3][bs1534], 7.1) and why Pro-Q has Auto
Gain, keeping "a consistent subjective level, so you can get an unbiased verdict" ([SOS 2014][sos2]). Pro-Q's is "an
educated guess based on the current EQ settings, and is not a dynamic process based on actually measured levels"
([FabFilter: output][ffoutput]).

**The sound.** Pro-Q's zero-latency mode "matches the magnitude response of analog EQing as closely as possible", and
FabFilter says linear phase "is not better or more transparent ... it is different!" ([FabFilter: processing
modes][ffmodes]). The usual digital fault is near the top: bilinear-transform filters, the cookbook's included, cramp
toward Nyquist, "steeper rolloff and narrower peaks" there, which oversampling or matched designs avoid
([Vicanek 2016][vicanek]; Orfanidis 1997, summarised there; the original paper could not be fetched).

**What it costs to change a setting.** The Audio EQ Cookbook, now a W3C Note, calls Direct Form 1 "probably both the
best and the easiest method" ([W3C][cookbook]). Under modulation, Wishnick found Direct Form II, lattice and ladder
forms "not necessarily stable when coefficients are changed", a jump giving "a large transient followed by ripple"
([DAFx-14][wishnick]); Chromium's own BiquadFilterNode runs Direct Form I and updates its coefficients every sample
under automation ([biquad.cc][chromium]). No reputable source we found ranks Direct Form I for modulation in so many
words.

## Where the regions are, and why sources disagree

Sound On Sound: high-pass "any unused low-frequency range", or the low end "can get muddy"; a boxy snare at
800 Hz-1.2 kHz; 2-5 kHz for clarity, 4-5 kHz for a voice's presence, 16-18 kHz for crispness; keeping only about
1-5 kHz gives "the 'telephone' special effect" ([SOS: Using EQ][sosusing]). FabFilter: the top of 125-350 Hz can be
"muddy", 350-500 Hz "boxy", 1.5-4 kHz "exceptionally present", 9-16 kHz "the air and/or sparkle band"
([FabFilter: frequency ranges][ffranges]). The telephone band proper is 300-3400 Hz ([ITU-T G.712][g712]). Handbooks
disagree on all of it: "muddy" runs from 16-60 Hz to 200-800 Hz depending on the author ([De Man and Reiss
2015][deman]). People disagree too: in SocialEQ, "warm" was agreed on within groups but not between them, while
"tinny" had the highest agreement of all ([Cartwright and Pardo 2013][socialeq]). That is why Overdub's lexicon asks
before it acts on "warm", and why Slide Rule's params say where each band is parked rather than what it means.

## What we built

- **The window is the curve.** One square node per band in use, numbered, over a hairline grid (20 Hz to 20 kHz, log;
  ±12 or ±24 dB). Drag for frequency and gain (on a cut, its corner's bump), Shift for fine, Alt-drag or the wheel
  for Q (EQ Eight's and Pro-Q's gestures), two fingers on a phone; double-click the plot to place a band, a node to
  reset it; its values sit beside it while it moves. A drag is one undo step signed by whoever made it. Every
  control works from the keyboard (Tab between bands, arrows to move them, Enter on and off, Delete to free one) and
  each node tells a screen reader "Band 3, bell, 2.4 kHz, plus 3 dB".
- **Pre and post.** The window taps the device's input and output (`ctx.meter.tap`, 8192-point FFTs) and draws the
  input filled and the output as a line, tilted 4.5 dB per octave like Pro-Q's.
- **One source of truth.** The curve is drawn by the functions the kernel filters with (`eq8-curve.js`, embedded in
  the kernel as their own source). `tools/eq-test.js` puts an impulse through the kernel and compares its DFT with
  the curve at 17 frequencies for all 11 types at three settings each, and every preset's summed curve: they agree
  to within 0.001 dB (the bar is 0.5).
- **Filters.** The cookbook's biquads in Direct Form I, double precision; cuts as Butterworth cascades of one, two or
  four sections, the last taking the corner's resonance (so Q 1 is -3 dB at the corner and Q 2 +3 dB, at every
  slope). The host glides each setting per block and the kernel interpolates coefficients sample by sample, so a
  sweep leaves under -105 dBFS of energy above 3 kHz on a -12 dBFS sine at 220 Hz; the same jumps through a
  block-stepped biquad leave -37 dBFS. Switches (a band on or off, a shape, solo) crossfade on an S-curve over 12 ms
  (-77 to -87 dBFS on the same measure). At its defaults the output is the input, sample for sample. We kept the
  cookbook's bilinear design as asked, so it cramps near Nyquist the way the cookbook does; the curve shows exactly
  that, since it is the same coefficients.
- **Auto gain goes past a guess.** It starts from the curve, as Pro-Q does (a mix's long-term spectrum, 1.5 dB per
  octave steeper than pink, under K-weighting), so the level holds the moment a band moves; then it listens: the
  input and output, K-weighted, over about 3 s, the trim following their ratio over about 2 s. A curve alone can't
  know the material: on the house's drums-guitar-bass program a 24 dB low cut at 200 Hz loses 4.4 LU, which a
  pink-noise guess puts at 0.6. With the correction, twelve moves on three signals settle within 0.12 LU of the dry
  level.
- **Solo** plays one band's region of the input (a bell's band pass, what a cut takes away) on the live device only.
  The window holds the kernel's `solo` with an automation segment and lets go on close; the song never stores it.
- **Agents** get the params as the interface: each band's desc says where it is parked and what region that is,
  `b1_type` says what every shape does, and the presets' blurbs say what they do in numbers. `adjust` on a track with
  Slide Rule moves its bands ("less mud": the band parked at 300 Hz, switched on as a bell) instead of adding another
  EQ (`agent/lexicon.js`).
- **Cost.** Eight bands, two of them 48 dB cuts, with auto gain: about 0.3% of real time in Node.

## Not built yet

Dynamic EQ, mid/side and left/right per band, linear and natural phase, Spectrum Grab, matching to a reference,
collision display between tracks, adaptive Q (EQ Eight's), and analog-matched coefficients near Nyquist (Vicanek's
designs would drop into `eqSections` without touching the rest, since the window draws whatever it returns).

[sos4]: https://www.soundonsound.com/reviews/fabfilter-pro-q-4
[sos3]: https://www.soundonsound.com/reviews/fabfilter-pro-q-3
[sos2]: https://www.soundonsound.com/reviews/fabfilter-pro-q-2
[ffdisplay]: https://www.fabfilter.com/help/pro-q/using/eqdisplay
[ffanalyzer]: https://www.fabfilter.com/help/pro-q/using/analyzer
[ffgrab]: https://www.fabfilter.com/help/pro-q/using/spectrumgrab
[ffsolo]: https://www.fabfilter.com/help/pro-q/using/solo
[ffoutput]: https://www.fabfilter.com/help/pro-q/using/output
[ffmodes]: https://www.fabfilter.com/help/pro-q/using/processingmode
[ffintro]: https://www.fabfilter.com/learn/equalization/introduction-to-eq/
[ffranges]: https://www.fabfilter.com/learn/equalization/frequency-range-characteristics/
[eq8]: https://www.ableton.com/en/manual/live-audio-effect-reference/#eq-eight
[cookbook]: https://www.w3.org/TR/audio-eq-cookbook/
[vicanek]: https://www.vicanek.de/articles/BiquadFits.pdf
[wishnick]: https://www.dafx.de/paper-archive/2014/dafx14_aaron_wishnick_time_varying_filters_for_.pdf
[chromium]: https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/audio/biquad.cc
[vickers]: http://www.sfxmachine.com/docs/loudnesswar/loudness_war.pdf
[bs1534]: https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1534-3-201510-I!!PDF-E.pdf
[sosusing]: https://www.soundonsound.com/techniques/using-eq
[mellor]: https://www.soundonsound.com/techniques/eq-how-when-use-it
[g712]: https://www.itu.int/rec/T-REC-G.712-200111-I/en
[deman]: https://www.arpjournal.com/asarpwp/analysis-of-peer-reviews-in-music-production/
[socialeq]: https://interactiveaudiolab.github.io/assets/papers/cartwright-pardo-ismir13.pdf
