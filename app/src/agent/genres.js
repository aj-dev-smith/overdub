// @ts-check
// get_guide "genres": how a named genre is built and mixed here, section by section. Each section is the know-how an
// agent needs before it writes a part in that genre: the tempo and the form, the drum pattern, the sounds to start
// from (by device and preset name), the mix and the master, and the numbers it is held to (audio/targets.js). Kept
// short on purpose (each section under 6 KB): the agent reads it before the first call, every time.

export const GENRE_SECTIONS = {
  'bass-music': `BASS MUSIC (dubstep, riddim, melodic bass, drum and bass)

Tempo and form
- Dubstep and riddim: 140 bpm (riddim also 150), half-time: kick on 1, snare on 3 of each bar. Riddim locks kick and bass to triplet and sixteenth stabs with gaps between.
- Melodic bass: 140-150, half-time; the break carries chords and a lead, drop 2 adds supersaw chords over the growls.
- Drum and bass: 172-176, two-step (kick on 1 and the "and" of 3, snare on 2 and 4): find_grooves style "dnb".
- Form: intro 16-32 bars, build 8-16, a half to one bar of near silence, drop 16-32 with a switch-up every 8, break 16, drop 2 (a different bass patch), outro 16-32. DnB: intro 32 (DJ-friendly), drop 32, break 32.
- Build: a snare roll speeding up 1/4, 1/8, 1/16, 1/32 (the groove "Build roll" in find_grooves { style: "dubstep" }: four bars), a riser under it (Light Table "Fade Up"), a filter opening (auto.write on a cutoff). The gap before the drop is the loudest moment's set-up: leave it empty.
- Drop: bass and drums trade (call and response); the sub plays the root under the growls, on its own track.

Drums
- Sandbag (core.clubkit) is the kit: KIT DUBSTEP, RIDDIM, DNB or MELODIC; a tuned sub-kick (KICK NOTE, default F1: tune it to the song's root), a layered snare (body, crack, clap, room), hats and a crash, a riser (note 34, four bars) and an impact (note 33). Grooves: find_grooves { style: "dubstep" } (half-time, riddim, two-step, melodic, the build roll, fills); drum_track { style: "dubstep" } for a whole song.

Sounds (Light Table, core.wavetable; preset: "<name>" in instrument.set)
- Sub: "Dark Slide" (pure sine), "Contact Sheet" (sine and a little octave), "Push Process" (rounded triangle). Mono and clean: play the root at F1-C2 (43-65 Hz).
- Growls: "Fixer" (FM yawn, quarter notes), "Stop Bath" (comb, eighths), "Emulsion" (talking vowel: give notes a mod curve), "Halation" (wavefold, eighths). Older: "Solarized".
- Riddim stabs: "Hard Cut" (clipped square), "Jump Cut" (metallic): short notes, triplets and gaps.
- Reese (DnB): "Double Exposure" (rolling), "Cross Process" (neuro); older "Gate Weave". Long notes, slides (LEGATO).
- Wobble: "Strobe" (eighths), "Iris" (eighth triplets); MACRO 1 sets the depth. The LFOs lock to the song's grid.
- Melodic: "Wide Angle" (supersaw chords), "Key Light" (lead), "Fade Up" (riser).
- Each preset's MACRO 1 is its main move (its blurb says which); automate macro1 across a drop for a switch-up.
- In-synth: fx_dist (TANH HARD FOLD SINE FOLD RECTIFY DOWNSAMPLE) and fx_mband (the three-band upward and downward compression, %) make one Light Table a whole growl chain.
- Make a growl talk per note: give the note a mod curve, e.g. { "p": "F1", "t": 0, "d": 1, "mod": [[0, 0], [0.5, 1], [1, 0.2]] }; Emulsion's wheel opens its vowel. bend curves pitch-dive the end of a phrase.

Mix
- Sub on its own track, mono: Gatefold (core.width) { monobass: 120, mono_mode: "STEEP" } on the sub, monobass 200 on the growls and reeses (always STEEP: the ORIGINAL mode leaves the low side about as wide as it was); nothing else under 100 Hz but the kick (Sandbag's low end is mono already).
- Duck: Dim Switch (core.ducker) on the sub, the growls and the pads, keyed by the drums: insert.add { device: "core.ducker", preset: "Kick duck", key: { track: "Drums" } }. Dubstep also ducks on the snare ("Kick and snare duck"); riddim pumps hard ("Hard pump (riddim)"); pads breathe ("Gentle pump").
- Growls and stabs: an octave over the sub; Slide Rule (core.eq8) a 24 dB low cut at 40 Hz and +6 dB around 110 Hz (their low end carries the 60-250 Hz band); Gaffer Tape (core.multiband) "Bass density" after, or fx_mband in the synth. The sub sits a few dB under them (track gain about -4.5).
- Drums: Clip Lamp (core.clipper) "Drum bus clip", then Gaffer Tape "Drum density" at 30-50%.
- Master: Clip Lamp "Master clip (+6)" ("+3" for a gentler song), then Red Line (core.limiter) ceiling -1, gain about 9.5 dB (raise it until the drop reads -6 to -4 LUFS short-term; past that the crest falls under 6 dB); then master.set { patch: { clip: "clean" } } so nothing rounds the limiter's peaks. Measured: Sandbag, Dark Slide and Fixer that way read -5.8 LUFS short-term, crest 6.1 dB, -1.1 dBTP, the low end mono. Another growl moves the balance: measure, then trim the limiter's gain and the 110 Hz lift.

Check it (render_and_measure { targets: "bass-music" })
- A drop (window "drop"): short-term loudness at its loudest -6 to -4 LUFS, crest 6-9 dB, the low end mono (side under 120 Hz at -20 dB or less, correlation 0.95 or more), the bands a sub-heavy, bright-topped balance.
- The whole song (window "song"): -8 to -6 LUFS integrated, true peak -1 dBTP at most.
- Say what you changed first, then the numbers in one line: "The drop is louder and the bass breathes with the kick. -5.6 LUFS short-term, -1.0 dBTP, sub mono."

Etiquette: make a whole drop only when asked; otherwise offer it, and offer two bass patches as takes (propose_variations).`,
  metal: `METAL (modern metal, djent, thrash, extreme; from a guitar DI)

Tunings and tempo
- Drop D, D standard, drop C, B standard; a 7-string in B, an 8-string in F#. The bass follows the guitar.
- Grooves and djent 90-140 bpm; thrash and metalcore 150-200; blasts 180-260 (the snare on eighths at the felt tempo).
- Form: intro, verse, pre-chorus, chorus (open chords, the crash or China riding), breakdown (half time, the China, the kick in unison with the chug), solo, last chorus or outro. A beat of silence before a breakdown.

The rhythm guitar (DI Box, or a DI recorded on an audio track)
- Half Stack (core.stack) on the track: "Modern" is a tight rhythm tone; "Djent", "Thrash", "Doom" and "Lead" the others. In it: GATE, TIGHT (the input high-pass), a green BOOST, GAIN (6-7 for rhythm), BASS MID TREBLE, MASTER and SAG, PRESENCE and DEPTH, CAB (six miked 4x12s), LOW CUT, HIGH CUT, LEVEL. It renders in exports, as heard (the Guitar Studio's graph amps render clean in exports).
- Double-track: two performances, two tracks, hard left (pan -1) and hard right (pan 1). Never a copy: write the second take's notes again, with its own small timing and velocity differences.
- Palm mutes: DI Box with MUTE SOFT mutes notes under velocity 0.35. Lock the low-string chugs to the kick.
- After the amp, Slide Rule: a 24 dB low cut at 80-100 Hz, a few dB out around 400 Hz, a high cut where the fizz starts (8-10 kHz).
- Iso Cab (core.cab) is the cab alone, after a graph amp or any drive.

The bass
- Roundwound (core.ebass) or Flatwound on the guitar's roots an octave down, into Y Cable (core.bassrig) "Modern": a clean, compressed, mono low end under a driven top through a cab. XOVER 150-250 Hz.

Drums
- Rusty Sticks (core.metalkit), "Modern": a kick with a click and a sub (CLICK, SUB, TRIG VEL), TIGHT for fast double kick (10 for blasts), a room on the snare. Studio A's note map: 36 kick, 38 snare, 42 hat, 49 crash, 52 China, 51 ride.
- Drum Riser (core.drumbus) after it: "Modern" punches, squashes and adds a crushed room underneath.
- Grooves: find_grooves { style: "modernmetal" } (djent unison, half-time China breakdowns, gallops, a bar of silence before the breakdown) or "extreme" (blasts, d-beat, double kick under the ride and China); drum_track plays them on Rusty Sticks.

Master
- Slide Rule (a low cut at 35 Hz), Gatefold (core.width) { monobass: 120, mono_mode: "STEEP" }, Clip Lamp "Master clip (+3)", Red Line (core.limiter) ceiling -1, gain about 5 dB; then master.set { patch: { clip: "clean" } }.

Check it (render_and_measure { targets: "metal", window: "song" })
- The whole master: -9 to -7 LUFS integrated, the loudest 3 s at -6.5 to -5, true peak -1 dBTP at most, PLR 6-9 dB, crest 7-10, loudness range 3-7 LU, the low end mono (side under 120 Hz at -20 dB or less), the bands a metal tilt (low 60-250 Hz -6 to -2 dB of the energy, the mids filled, air -23 to -15).
- The rhythm guitars alone (tracks: the two guitars): 89% of their energy in 100 Hz-5 kHz, -20 dB or less under 80 Hz, -30 dB or less over 8 kHz.
- Say what changed, then the numbers: "Rhythm guitars: 98% between 100 Hz and 5 kHz, fizz -52 dB. The master's -7.2 LUFS, -1.1 dBTP."

Etiquette: make a whole song only when asked; otherwise offer the chain, and offer two tones as takes (propose_variations).`,
};

export const GENRE_LIST = Object.keys(GENRE_SECTIONS);
export function genresGuide(section = null) {
  if (section && GENRE_SECTIONS[section]) return GENRE_SECTIONS[section];
  return `Genres here: ${GENRE_LIST.join(', ')}.\n\n` + GENRE_LIST.map((k) => GENRE_SECTIONS[k]).join('\n\n');
}
