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
- Build: a snare roll speeding up 1/4, 1/8, 1/16, 1/32 (find_grooves style "dubstep" part "build"), a riser under it (Light Table "Fade Up"), a filter opening (auto.write on a cutoff). The gap before the drop is the loudest moment's set-up: leave it empty.
- Drop: bass and drums trade (call and response); the sub plays the root under the growls, on its own track.

Drums
- Sandbag (core.clubkit) is the kit: KIT DUBSTEP, RIDDIM, DNB or MELODIC; a tuned sub-kick (KICK NOTE, default F1: tune it to the song's root), a layered snare (body, crack, clap, room), hats and a crash, a riser (note 40) and an impact (note 41). Grooves: find_grooves { style: "dubstep" } (half-time, riddim, two-step, melodic, the build roll, fills); drum_track { style: "dubstep" } for a whole song.

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
- Sub on its own track, mono: Gatefold (core.width) monobass 120 on every bass track; nothing else under 100 Hz but the kick.
- Duck: Dim Switch (core.ducker) on the sub, the growls and the pads, keyed by the drums: insert.add { device: "core.ducker", preset: "Kick duck", key: { track: "Drums" } }. Dubstep also ducks on the snare ("Kick and snare duck"); riddim pumps hard ("Hard pump (riddim)"); pads breathe ("Gentle pump").
- Growls and stabs: Gaffer Tape (core.multiband) "Bass density" (upward 60%) after them, or fx_mband in the synth; a low cut on the growl (Slide Rule) where the sub plays.
- Drums: Clip Lamp (core.clipper) "Drum bus clip", then Gaffer Tape "Drum density" at 30-50%.
- Master: Clip Lamp "Master clip (+3)" (or "+6" for riddim), then Red Line (core.limiter) ceiling -1, gain until the drop reads -6 to -4 LUFS short-term; then master.set { patch: { clip: "clean" } } so nothing rounds the limiter's peaks.

Check it (render_and_measure { targets: "bass-music" })
- A drop (window "drop"): short-term loudness at its loudest -6 to -4 LUFS, crest 6-9 dB, the low end mono (side under 120 Hz at -20 dB or less, correlation 0.95 or more), the bands a sub-heavy, bright-topped balance.
- The whole song (window "song"): -8 to -6 LUFS integrated, true peak -1 dBTP at most.
- Say what you changed first, then the numbers in one line: "The drop is louder and the bass breathes with the kick. -5.6 LUFS short-term, -1.0 dBTP, sub mono."

Etiquette: make a whole drop only when asked; otherwise offer it, and offer two bass patches as takes (propose_variations).`,
};

export const GENRE_LIST = Object.keys(GENRE_SECTIONS);
export function genresGuide(section = null) {
  if (section && GENRE_SECTIONS[section]) return GENRE_SECTIONS[section];
  return `Genres here: ${GENRE_LIST.join(', ')}.\n\n` + GENRE_LIST.map((k) => GENRE_SECTIONS[k]).join('\n\n');
}
