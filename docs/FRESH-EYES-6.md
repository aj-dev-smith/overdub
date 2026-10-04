# Fresh eyes, round 6: the new rooms (2026-10-03, morning)

After the night run (`docs/NIGHT-RUN.md`): Light Table and its window, Studio A and its window, Slide Rule, Scribble
Strip, Gaffer Tape, the Grooves tab, the Jam room, Vacancy, Logic's keys, Keep cards. The testers drove the local
studio in headless Chromium, read-only; their reports are below, verbatim. Screenshots and their measuring scripts
are in the session scratchpad (`fresh6/`, not committed). What came of it is in `docs/NIGHT-RUN.md`'s log.

---

# Fresh eyes, round 6: a producer on Light Table, Studio A, Slide Rule, Scribble Strip and Gaffer Tape (2026-10-03)

**Setup.** I drove the local studio in headless Chromium through `tools/pw.js`, using real clicks, drags and keys and reading state only to confirm what I saw. I ran the whole brief at 1440×900, then opened every device window at 1280×800 and at 390×844.

The song was "Untitled", 124 bpm, C minor:
- **Bass:** Light Table on Low Key, edited (VOWEL table, POS 0.525, LFO 1 → cutoff +4 oct synced to 1/8, a short envelope, B kept). I recorded it with musical typing (24 notes) and repeated it ×2.
- **Pad:** Light Table on Bokeh, chords drawn in the piano roll (Cm, Ab, Eb, Bb), repeated ×2. Verse and Chorus sections.
- **Drums:** Studio A, from Grooves → "Build drums for the song" (Pop). I moved the mics: OH −6.4, room −8.1, crush −23.
- **Effects:** Slide Rule on the pad (a 24 dB low cut at 187 Hz). Scribble Strip's "Pump (quarter notes)" on the pad. Gaffer Tape's "Drum smash" on the drums.

Then I opened Vacancy from Song → Demos.

Sound is judged by measurement: the canonical Node render (`renderSong`), `app/src/audio/measure.js`, and `checkDevice` run in the page.

I started at `5d0132f`. Main is now `d39e64a`, and the only app change since is Vacancy (`b19da82`), so everything below holds at HEAD. The repo is untouched (`git status` clean). Screenshots are `shots/NN-*.png` in the session scratchpad under `fresh6/producer/`, next to the measuring scripts (`measure-song.mjs`, `gt-depth.mjs`, `lt-presets.mjs`, `bass-sub.mjs`, `studioa-low.mjs`, `vacancy-gr.mjs`).

### The mixes, by measurement
- **Mine:**
  - Overall: −15.6 LUFS, **+0.5 dBTP**, crest 17.3 dB.
  - Parts: pad −18.1 LUFS, drums −20.0 (−16.6 without Gaffer Tape), bass −25.3.
  - The tracks sum to at least +2.4 dBFS, so the master's safety soft clip is shaving the peaks.
  - Kick against bass barely mask: in 30–120 Hz the bass comes within 6 dB of the kick on only 2 of 35 kick frames. That's only because the bass sits at 25–40 Hz, under the kick's 57 Hz (Broken 3).
- **Vacancy:**
  - Overall: −10.5 LUFS, −1.1 dBTP, crest 11.6 dB, loudness range 3.4 LU. That matches its own header, and it holds up as a loud indie-pop master.
  - The six tracks sum to +6.3 dBFS before the master. The master limiter is fed +7.5 dBTP and takes **8.6 dB** off the peaks. It's working in 61% of 100 ms blocks (3 dB or more in 29%) and costs 2.1 LU. I'd pull the drums and bass down 4–5 dB before it.
  - The drums' low end (under 120 Hz) correlates only 0.26, so it loses 2.0 dB in mono (Broken 5).
  - The loudest band is 60–250 Hz; 2–8 kHz sits 9–11 dB under it. It's a dark mix, and the topline carries the presence.
  - Kick against bass is workable: the bass is within 6 dB of the kick on 25% of kick frames, and the median gap on hits is 7.8 dB.

### Broken, ranked by how much it hurt

1. **Gaffer Tape makes Studio A drums quieter and peakier, and pushes them over 0 dBTP.**
   - **What I did:** put Drum smash on the built drums.
   - **What happened:** −16.6 → −20.0 LUFS, crest 18.1 → 22.2 dB, true peak −1.1 → −0.5 dBTP (54-gaffer-playing).
     - Every preset on that part comes out 1.2 to 4.3 LU quieter, with crest up 2.2 to 4.2 dB.
     - Defaults, Glue, Vocal presence and Subtle 30% all end over 0 dBTP (+0.1 to +0.6).
     - A depth sweep at the defaults: at 0% the part already goes from −1.1 to **+0.8 dBTP** at the same loudness, and each further 20% of depth costs about 0.85 LU.
     - On the pad it's denser (crest down 2–3 dB) but still 0.8–2.1 LU quieter.
   - **What I expected:** what the guide promises ("Make it loud and finished", GUIDE.md:185) and the preset says ("loud, roomy drums"): louder, denser, lower crest, and under its own −1 dBTP ceiling.
   - **Cause:**
     - The ceiling only holds the compressed part. The dry part is the crossover's output and is never limited (multiband.js:247–248, :76).
     - The crossover's phase turn alone rebuilds Studio A's peaks by +4.5 dB (docs/research/MULTIBAND.md:105).
     - The presets are trimmed to the input's loudness (MULTIBAND.md:40–42), while the attacks let each onset through with the makeup gain on it (MULTIBAND.md:109).

2. **The master meter can never show clipping.**
   - **What happened:** my mix ran into the safety clip (tracks summing to at least +2.4 dBFS, render at +0.5 dBTP), and the top bar read "−0.7" in white (34-playing-song, 51-scribble-pump-playing).
   - **What I expected:** red, as the meter's own tooltip says ("Red is clipping", transport.js:657).
   - **Cause:**
     - The meter reads the master tap after the soft clip (strip.js:144, :160–163).
     - The clip saturates toward −0.5 dBFS (strip.js:98).
     - Red needs a held peak over −0.1 dBFS (transport.js:907–914), so it can't happen.
     - A new song's master has no limiter either, so nothing else warns you.

3. **Light Table's bass presets put most of their weight below 35 Hz.**
   - **What I measured:** on the house's own bass phrase (A1, F1, C2, G1), the share of energy at 20–35 Hz is:

     | Preset | Energy at 20–35 Hz |
     |---|---|
     | Low Key | 38% |
     | Gate Weave | 43% |
     | Solarized | 58% |
     | Sprocket | 15% |
     | Safelight | 0.2% |

     On my line, Low Key's 500 Hz–2 kHz band sits 32 dB under its sub. My edited bass peaked at 28–32 Hz and measured −25.3 LUFS against the pad's −18.1. On laptop speakers there would be no bass line. The window shows the cause plainly: Sub OCT −1, LEVEL 0.600 (07-lt-window).
   - **Cause:** the sub oscillator plays an octave under the note (wavetable.js:609), at sub_level 0.45–0.6 in these presets. The presets are levelled by LUFS (wavetable.js:1176), and LUFS barely registers 30 Hz. Vacancy works around this with Sprocket plus a Slide Rule cut at 30 Hz.

4. **Light Table isn't in "Add a track".**
   - **What happened:** neither the toolbar button nor the row under the tracks lists it (24-add-track).
   - **Cause:** the menu takes only the first 14 instruments (arranger.js:1126). That also drops Step Ladder, Brass Rail, Risers, Suitcase and Mallet Bag.
   - I got a second Light Table only by Shift-clicking it in the browser, which only the tooltip mentions.

5. **Studio A's room mics put the kick's low end out of phase.**
   - **What I measured:** correlation under 120 Hz for the kick.

     | Setup | Correlation under 120 Hz |
     |---|---|
     | Room pair alone | −0.20 |
     | Default mics | 0.76 |
     | Vacancy's drum track | 0.26 (−2.0 dB in mono) |

     Only the Dead 70s and Dry and tight presets are mono in the lows.
   - There's no low cut or "mono low end" control on ROOM or OH (39-studioa-mics).
   - **Cause:** the room's early reflections land at different times left and right and alternate in sign (drumroom.js:836), and the FDN tail runs full-range on both sides (:829).

6. **Toasts sit on top of device windows for over 3 seconds and take the clicks.**
   - "Light Table: Light Table, Low Key" covers the filter's VEL and the envelope labels (07-lt-window).
   - "Gaffer Tape on Drums" covers the Mid band's curve and its threshold handles (53-gaffer-window, 76-1280-gaffer).
   - On the phone it covers Depth, Input and Output (86-phone-gaffer).
   - **Cause:** `.ew-toasts` is fixed bottom-right at z-index 1000 (shell.js:592; 3.2 s at :507), above `.pw` at 700 (plugin.js:932).

7. **A mod ring's handle covers the knob's name and value.**
   - **What happened:** with LFO 1 → CUTOFF at +40% from 381 Hz, the knob reads "UTOFF / 81 Hz" (15-filter-zoom, 94-ring-40).
   - **Cause:** the ring box reaches past the dial into the label column at z-index 2 (wavetable.js:243–246, :1618). The 7 px handle (:1624, placed at :259–261) lands on the text when its tip is at 1–3 o'clock. It's also a 7 px target for a mouse.

8. **Clicking the word "Kick" in Studio A plays nothing.**
   - **Cause:** the label "Kick 22 × 18" is drawn on the floor between the pedal and floor tom 1 (drumroom.js:735–737). That's outside the kick's hit shape, which is only the shell rectangle and a 13 px pedal strip (drumroom.js:624). Most of the shell is hidden under the toms (38-kick-zoom).

9. **At 1280×800, the controls you open a window for are below the fold.** You have to scroll inside the window:

   | Window | Hidden part | Scroll needed |
   |---|---|---|
   | Studio A | the mic faders | 97 px (72-1280-studioa) |
   | Light Table | the mod matrix and macros | 84 px (73-1280-lighttable) |
   | Scribble Strip | depth and rate | 69 px (74-1280-scribble) |

   At 1440×900 they fit.

10. **A second effect's Open button is hidden behind the right pane at 1440×900.** My click on Scribble Strip's Open landed on the Agent panel (49-rack-with-shaper). Double-clicking the device name worked.

### Confused, ranked
1. **Gaffer Tape gives no sign that it's level-matched.** It has no before/after loudness, no gain reduction per band and no output meter. "40% of the compressed sound" gave me no hint that my drums had dropped 1.7 LU; I only found out by rendering.
2. **Envelope points are about three times as twitchy as the knobs.** A time's whole travel fits in about 67 px (wavetable.js:995), against 180 px for a knob (plugin-kit.js:160). A 20 px drag took the decay from 0.60 s to 0.065 s (16-env-zoom).
3. **Build drums always ends the song.** My 8-bar Verse/Chorus sketch got 2 bars of the chorus groove, then a 2-bar "Ring out" in bars 7–8 (core/grooves.js:839). The plan says so up front, but its rows give no way to drop the ending.
4. **"Preset Custom" everywhere.**
   - All four Light Table tracks in Vacancy say Custom (64-vacancy-pad-rack), though the demo built them from Sprocket, Zoetrope, Long Exposure and Magic Lantern.
   - A fresh Slide Rule, Scribble Strip or Gaffer Tape also says Custom before I've touched it (plugin.js:539), which reads as "you changed it".
5. **"Click adds to Guitar" replaces Guitar's instrument.** It says so afterwards, with Undo: "Guitar now plays Light Table (was DI Box)" (95-browser-click-replaces). But "adds" read to me as "adds a new one".
6. **History labels are raw parameter names with no values:** "Light Table a pos", "Light Table m2 amount", "Light Table lfo1 sync" (plugin.js:460–461). The window itself says "LFO 1 → CUTOFF, +4.0 oct".
7. **The A/B status line goes stale.** "B starts as a copy of A. Change it, then flip back to compare." stays after B has been changed and flipped twice (17-ab-on-b).
8. **The phone windows use desktop words:** "Right-click a point" (83-phone-scribble), "Alt-click chokes a cymbal" (84-phone-studioa).

### What worked
- **Light Table feels like a real wavetable synth, not a form.**
  - The 3D table follows POS, and the table picker describes each table in a few words.
  - Dragging LFO 1's jack lit up the 37 knobs it can reach, with a visible cable. It answered "Slot 2: LFO 1 → CUTOFF, +2.5 oct", and dragging the ring set +4.0 oct.
  - While a note played, the filter curve moved from 55 Hz to 13 kHz and the rings ticked.
  - The LFO sync reads "1/8 at 120 bpm, 0.25 s".
  - A/B and every gesture are one undo step each.
  - Flipping presets with ‹ › while holding a note works.
- **Recording with musical typing:** 24 notes, all on the grid, in one take.
- **Build drums for the song:**
  - It states the plan in words first.
  - It picked Studio A on its own.
  - The whole build is one undo step.
- **Studio A's drawn kit:**
  - Where you hit picks the stroke: center, edge or rimshot.
  - Selecting a piece lists its strokes.
  - Mic faders and the output meter are right there.
- **Slide Rule:**
  - Double-click places a band, and right-click gives the shapes and slopes.
  - The input and output spectra update live.
  - In the render it took 5.1 dB out of the pad's 60–250 Hz band and left everything else alone.
- **Scribble Strip:**
  - The pump is one click, and its dot reads "−1.1 dB".
  - In the render the pad dips 11.7 dB on each beat and recovers over the quarter note.
- **All five new devices pass the device check:**
  - No errors, and renders are deterministic.
  - At default settings, true peak is −1.4 dBTP or lower.
  - Light Table uses 2.7% CPU.
  - With Light Table open during Vacancy, 95% of frames took 17 ms or less, with no long tasks.
- **Preset levels are consistent:**
  - Light Table: −15.5 to −18.1 LUFS on the house phrase, −14.0 to −21.1 on mine, all at −1.5 dBTP or lower.
  - Its basses are mono and its pads wide (correlation 0.49–0.60).
  - Studio A's eight presets: −14.8 to −17.9 LUFS, all at −1.1 dBTP or lower.
- **On the phone,** every window opens full-screen with nothing running off the side, and Light Table's seven tabs work.

### Ideas
- **Gaffer Tape:**
  - Show the change in LU and the gain reduction per band.
  - Add a "keep it loud" mode that doesn't trim back to the input level.
  - Move the ceiling after the depth mix.
- **The meter:**
  - Read it before the safety clip, or say "clipping 2.4 dB" in red.
  - Give a new song's master a limiter, or offer one when it clips.
- **Light Table:**
  - Let me save my own preset.
  - Let me import or draw a table.
  - Keep the sub above about 35 Hz, or let it follow the register.
  - Say "from Sprocket, edited" instead of Custom.
- **Studio A:**
  - Add a low cut or "mono below 120 Hz" on ROOM and OH.
  - Put the kick's label inside the shell.
- **Scribble Strip:**
  - Let the kick track (or MIDI notes) trigger the pump.
  - Add a phase offset.
- **"Add a track":** list every instrument, or let me search.
- **Toasts:** dock them beside an open window, or show them in its status line.
- **Build drums:** add a "loop it, no ending" choice to the plan.

---

# Fresh eyes: a guitarist in the Jam room

**Setup.** I played a guitarist in his thirties who plays rock, blues and some funk every night. He has an audio interface and has only ever used GarageBand.

- **His guitar.** I wrote a one-track song on `core.guitar` (DI Box): the six open strings, then an A minor pentatonic lick with a blue note, then A7/D7/E7 stabs into an A5. I rendered it with `node tools/render.js` and detuned the G string 15 cents flat afterwards. I converted it to a 16-bit mono WAV and passed it as `open('/app/', { fakeAudio })`, so Chromium's fake microphone looped it.
- **That path worked.** "Fake Audio Input 1" was listed, it monitored through the rigs, and the tuner read it.
- **Sessions.** Two fresh sessions through `tools/pw.js`, both in HeadlessChrome 151 at DPR 1, with `navigator.webdriver` false, storage cleared, and every request outside localhost blocked (none were attempted). The first was 1440x900. The second was 1280x800, resized to 1440x900 at the end to check chord names.
- **How I drove it.** Real clicks, drags, wheel and keys. I used `page.evaluate` only to read state, plus one wrapper that logged when Show me's notes sounded.
- **Screenshots** are in the session scratchpad (`fresh6/guitarist/shots/`, not committed; `a-*` at 1440, `b-*` at 1280).
- No page or console errors in either session. The repo was not touched.

## Broken, ranked by how much it hurt

**1. Switching songs with the guitar plugged in kills monitoring and floods the screen with toasts.**
- **Did:** blues jam track, input open, Monitor on, playing through Live guitar. Then Jam tracks → Funk in E minor. Later I opened the demo Halation from the same picker.
- **Got:**
  - 16 identical toasts ("Add an audio track to monitor through (its pedals and amp).") stacked over the room; Halation gave 22. Every tone flip after that added two more.
  - The guitar went silent: the new song has no audio track, so Live guitar had no meter at all.
  - The Monitor toggle stayed lit, and the room still said "You hear it through Live guitar. The tuner listens below." and "R records your guitar onto Guitar" (Guitar is the DI Box track).
  - Recovery: clicking Monitor turned it off and made a Live guitar track; a second click brought the guitar back.
- **Expected:** my guitar stays audible when the song changes. The room already makes an audio Guitar track when you open the input; it should do the same when the song changes under an open input. Failing that, turn Monitor off and say so once.
- **Shots:** a-35-funk-open.png, a-37-funk-input-section-stale.png, b-15-demo-open-with-input.png
- **Cause:**
  - `app/src/input/audioin.js:251` raises the toast in `wireMonitor()` whenever there is no audio track. `:265-270` call it again after every store change and every engine `graph` event, so each one adds a toast.
  - `app/src/ui/jam.js:257-271` (`openTrack`) and the demo/recent opens neither carry over nor remake the audio Guitar track.
  - `jam.js:746` builds the input section's cache key from open/device/channel/monitoring only, so `:756` keeps naming a track that's gone.
  - `jam.js:741` names `guitarTrack()`, which falls back to the DI track.

**2. The demo agent answers the room's own guitar questions with bass takes.**
- **Did:** clicked the room's chip "What scale works over the chorus 1?", then Ask the demo agent. Then the chip "Show me a lick into the D7 at bar 17". Then typed "what scale should I solo with over this blues?".
- **Got:** all three replied "Listening to the bass first… It's a warm, low-heavy sound. Here are three takes over your part", with three bass variations on Bass bars 1–4. The composer said "On Guitar". No scale, nothing on the neck. The other two chips ("What tone would suit this song?", "Make me a slow blues in E") get "…is past me". With no key, none of the room's four chips works.
- **Expected:** an answer built from `get_jam` and `show_on_fretboard` (A minor pentatonic at the 5th fret, C# over A7), or an honest "past me" first, as the guide promises. Never a bass take tour.
- **Shots:** a-25-demo-agent-scale-answer.png, a-26-chip-lick.png, a-29-typed-scale-question.png, a-27-chip-tone.png
- **Cause:**
  - `app/src/agent/mock.js:104`: the `tour` scene matches "over the", "over this" and "show me".
  - The question guard at `mock.js:111` only catches "what's / what is / are / does / do", not "what scale…" or "which…".
  - No scene in the script calls the Jam tools.

**3. The big chord name is cut off.**
- **Did:** played Night Shift at 1280x800 and Late Checkout at 1440x900.
- **Got:** at 1280, "Fmaj7" reads "Fma". At 1440, "Bbmaj7/F" reads "Bbma", and Abmaj7, Cm7/G and Eb6/G are clipped too: 254–404 px of text in a 184–251 px box. You can't tell maj7 from a triad or see the bass note, and showing the chord is the stage's whole job.
- **Expected:** the whole name, shrunk to fit if it has to be.
- **Shots:** b-03-stage-fmaj7-1280.png, b-14-clipped-chord-1440-Bbmaj7F.png (also -Abmaj7, -Cm7G, -Eb6G)
- **Cause:**
  - `app/src/ui/jam.js:1188`: `.jm-now-name` sizes from the viewport (`clamp(46px, 5.4vw, 72px)`), not from its column, and clips with `nowrap; overflow: hidden; text-overflow: clip`.
  - `:1191`: `.jm-tones { flex: none }` takes its full width first, inside a 1.7fr column (`:1186`) of a center region the side panes squeeze to 656–818 px.

**4. Show me plays the lick off the beat and over the wrong chords, and can add a track to the song.**
- **Did:** blues, looping Chorus 2 at 75%. At beat 48.6 (bar 13, A7) I clicked Show me on "A two-bar lick over A7 to D7 (bars 16–17) … lands on F# as D7 arrives".
- **Got:** the first note sounded at beat 49.225, between beats and nowhere near bar 16. The landing F# came at beat 52.7, over A7 in bar 14. Separately, on Dust Jacket (a demo with no DI guitar), Show me added a "Guitar" track to the song (History: "you: add Guitar for the keys").
- **Expected:** while the song plays, the lick waits for its bars, or at least the next bar line, and plays on the grid. Hearing a lick shouldn't edit the song.
- **Shots:** a-22-neck-during-lick.png, b-19-show-me-adds-track.png
- **Cause:**
  - `app/src/ui/jam.js:349` starts the lick at `performance.now() + 120`, although the comment at `:344` says "from the next beat".
  - `:347` calls `ensureKeysGuitar()`, which dispatches a `track.add`.

**5. The tuner shows nonsense while you play.**
- **Did:** opened the input and let the phrase play.
- **Got:** the open strings read perfectly, the detuned G included ("15 cents flat: the 3rd string, G3"). Between notes and on the stabs it showed:
  - "E4 · 1795 cents flat", with the needle pinned
  - "D2 · 999 cents flat"
  - "G4 · 296 cents flat: the 1st string, E4"
  - "D#4 · 101 cents sharp: the 1st string, E4"
  - "A1" and "E1 · In tune" on chords. Those notes are below a guitar's lowest string.
- **Expected:** cents only once the pitch has settled, "–" for chords and transitions, and nothing below the tuning's low string.
- **Shots:** a-16-tuner-nonsense.png, a-17-tone-flipped.png
- **Cause:**
  - `app/src/ui/jam.js:878-886` (`drawTuner`) ignores `tn.stable`, takes the note name from the held `tn.p` but the string from the raw `tn.midi`.
  - `app/src/input/pitch.js:628-633` keeps the old note for `hold` and measures cents against it while the median has already moved.
  - `app/src/input/audioin.js:158` runs YIN down to 38 Hz.

**6. The tips rewrite themselves at every chord change and ignore the loop at the turnaround.**
- **Did:** read the Ideas while the blues played at 75%.
- **Got:**
  - The Land on tip and the lick (tab and Show/Show me buttons included) were replaced at bars 19, 21, 22, 23, 24 and 13, about every 5 s, while I was reading the tab.
  - On bar 24 (E7, the turnaround) the lick read "over E7 (bars 24–25) … lands on G# as E7 arrives". Bar 25 doesn't exist; round the loop it's A7. The Land on tip disappeared on that bar, the one where a blues player most wants it.
  - The stage gets this right: "in 2 bars, round the loop".
- **Expected:** tips that hold still while I read them, and that wrap with the loop.
- **Shot:** a-20-ideas-blues.png
- **Cause:**
  - `app/src/ui/jam.js:407-411` keys the tips on the chord now and next, and `:862` re-renders Ideas every 400 ms while playing.
  - `app/src/core/jam.js:812` (`next`) and `:921` (`c2` falls back to the same chord past the song's end) ignore the loop, unlike `whereAt`.

**7. "The keys play Bass. Give the keys a guitar" right after opening a jam track.**
- **Did:** opened the blues, at both sizes.
- **Got:** the line stayed until something else redrew the tone row. Meanwhile the top bar said "Keys play Guitar", and typing did play the DI Guitar.
- **Expected:** the line names the track the keys actually play.
- **Shots:** a-12-blues-on-D7.png, b-08-blues-1280.png
- **Cause:**
  - `app/src/ui/jam.js:263` loads the song, and the tone row redraws on that load. At that point the selection is the old song's track, so the keys' target resolves to Bass. Only after that does `:267` select the Guitar track.
  - The room never listens for `select`, so `:696-698` isn't recomputed.

**8. Musical typing in the room plays Bass on the song the studio opens with.**
- **Did:** Night Shift → Jam → `` ` `` → A S D F G.
- **Got:** "Keys play Bass", so I heard a bass. A tap on the neck made a "Keys guitar" track and fixed it, as would the "Give the keys a guitar" link, which is below the fold.
- **Expected:** `docs/GUIDE.md:265-266`: "No guitar? Musical typing … plays a guitar sound on the Guitar track."
- **Shot:** b-05-musical-typing-playing.png
- **Cause:** `app/src/ui/jam.js:162-165`: `aimKeys()` only aims at a DI guitar that already exists, and Night Shift's Guitar is an audio track.

**9. The previous song's lick stays on the neck.**
- **Did:** Show me on the blues, then opened the funk.
- **Got:** the A blues lick's numbers and the "Lick, bars 16–17 · Clear" label stayed drawn over the E minor funk.
- **Expected:** a new song clears whatever was pointed at on the neck.
- **Shot:** a-36-funk-toast-storm-after-flip.png
- **Cause:** `app/src/ui/jam.js:89-92` and `:778` reset the room's caches on a load but not `J.shown` or `J.lick`.

**10. Make your own refuses A13.**
- **Did:** Funk, chords "Em9 A13 Em9 A13 Gmaj7 F#7#9 Em9 A13".
- **Got:** `can't read "A13", "A13", "A13" as a chord`. Em9 and F#7#9 were accepted.
- **Expected:** 13ths, 11ths, 7sus4 and 7b9, which are funk staples.
- **Shot:** b-20-make-own-funk.png
- **Cause:** `app/src/core/jam.js:51-71` has no such qualities, and `:197` doesn't de-duplicate the bad tokens.

## Confused, ranked

1. **Room or form? Half each, and the room is a peephole.**
   - The top screen is a guitar player's room: the huge chord, the countdown, the neck, and the line naming what you just played. Below the fold it's a form.
   - The room gets 818x532 px at 1440x900 and 656x432 px at 1280x800. Tone, input, tuner, practice and tips all need scrolling, and once you scroll to flip a tone or tune, the chord and neck are off screen.
   - Under the room, the Sketch pane keeps offering Hum it ("Allow the mic and hum") and its own Record button, aimed elsewhere: it said Bass while the room's R said Live guitar (a-33).
   - Hiding the detail pane (D) gives the room 732 px and fixes most of this (b-13-detail-pane-hidden-1280.png), but nothing suggests it.
2. **Finding the room.** The first-visit card ("This is Night Shift": a beat and a tune, the tour, the agent) says nothing about guitar, and Jam is a small word beside Arrange in the toolbar (a-01-first-visit.png).
3. **R snaps 75% back to 100%.** Pressing R while practising slowly jumps the band to full speed at the count-in. The toast explains afterwards, and the speed stays at 100% after the take.
4. **Two guitar tracks.** With the input open there's Guitar (DI Box, for the keys) and Live guitar (the real one).
   - The tone row edits one or the other depending on whether the input is open.
   - Show me plays through the DI one, in a different tone from the one you're hearing.
   - The Devices tab opened on the DI one (a-43-devices-tab.png).
5. **The neck at a glance.**
   - Good: the chord tones as cream discs labelled R/3/5/b7 read well, and the next chord's dashed rings fading in work.
   - Busy: every chord tone is lit across 15 frets, the pentatonic's own notes are faint grey dots on the rosewood, and the box only shows up after Show on the scale tip.
   - Show me's numbers overwrite each other where a place repeats; the blues lick showed only 9, 8, 7, 5 and 1, so the order can't be read off the neck.
   - Musical typing's top keys light past the 15th fret or nowhere (Eb6 and E6 are off a 22-fret neck). (a-03-neck-crop.png, a-22)
6. **"Land on F# … 4th fret, D string, inside the box."** Box 1 is frets 5–8, but the code counts 4–9 as inside (`app/src/core/jam.js:815-816`). The F# at the B string's 7th fret is genuinely in the box.
7. **Small things.**
   - The chip reads "What scale works over the chorus 1?" (`app/src/ui/jam.js:770`), and it names Chorus 1 while you loop Chorus 2.
   - At 1280 the head wraps "Playing / over" and the Bars value is clipped (`app/src/ui/jam.js:1182`).
   - Slide Rule's header kept saying "Band 6: a bell at 2.80 kHz, 0.0 dB." after I dragged the band to +2.2 dB.
   - Live guitar is a fixed −4 dB with no input trim. With my input it sat about 6 dB under the band's sum, while the keys guitar is levelled by measurement.

## What worked

- **Jam tracks.** Ten clear styles, and Make your own built a 66 BPM blues in A instantly and played it. The old song went to Recent songs, and reopening the blues brought my audio take back.
- **The stage.** It shows the chord with its tones by interval and the next chord counting "4 beats … 1 beat" or "round the loop". It followed the 12-bar blues and the funk vamp.
- **The input.**
  - Open made an armed Live guitar track with the rig's chain.
  - Monitor ran the guitar through the rig, and its meter moved.
  - The tuner caught the detuned G and named the strings.
- **The heard line teaches.** "G: the blue third over E7; bend it a little toward G#", "Eb: the blue note, between D and E", "B: from A major pentatonic; over A7, the 9th".
- **Tones.** The arrows and `[` `]` flip through 156 rigs with their pedals drawn, and quick flips count as one undo step.
- **Practice.** Loop Chorus 2, the speed slider dragged to 75% (49.5 BPM) with the song's tempo untouched, and `-`, `=`, `⇧L` all work.
- **Recording.**
  - R counted in to the next bar and put the take on Live guitar, bars 18–20, with Undo.
  - Musical typing recorded onto Guitar, snapped and in A blues.
  - Both takes were in Arrange, and the song played on across tab switches.
- **The tips are specific and would teach a blues player if they held still:** where to start on the neck, "Land on F#, its 3rd: A7 doesn't have it", "play C# over A7, F# over D7, G# and B over E7", and a lick with its tab.
- **Device windows.** Squid Quack opened big and its knob drag landed in History. Slide Rule drew a live spectrum of the guitar and placed a band on a double-click.
- **Keys.** The first-press notes for K and S help a GarageBand user.

## Ideas

- When Jam opens, collapse the detail pane, or pin the stage and neck while the lower half scrolls.
- When the song changes under an open input, remake the audio Guitar track with the current tone and keep monitoring.
- Let me pin a tip while I read it. Give Show me "play at bar 16" or "loop these two bars", in time with the band, lighting the numbers in order.
- Give the demo agent a Jam scene (`get_jam` + `show_on_fretboard`) so the four chips do what they say.
- Add a tuner mode that mutes the band, shows cents only when the note is stable, and stays within the tuning's range.
- Add "Match the band" for Live guitar (the keys guitar's measured levelling) and a trim beside the meter.
- Put "Play guitar over a song → Jam" on the first-visit card.


---

# Overdub over MCP: an agent builder's fresh-eyes test (2026-10-03)

**Setup.** I connected the way Claude Code does. My copy of the `tools/mcp-e2e-test.js` harness spawned `node server/mcp.js` with `OVERDUB_URL` on a free port, `OVERDUB_NO_OPEN=1` and `clientInfo` set to claude-code. The server started in-process. A headless Chromium (Playwright's chrome-headless-shell, 1440×900, `navigator.webdriver` false) opened `/app/` against it. Everything off localhost was blocked, and nothing tried to leave. A small control server let me make one MCP call at a time and drive the tab with real clicks and keys in between. 179 tool calls over two runs, on three songs:
- **Night Shift**, as the studio opens.
- **A blank song the human started from the Song menu**, which I filled as the agent: "Static Bloom", with drums, a synth part and a guitar riff.
- **"Porch Light", a share link from "Sam"**, opened in a second, fresh profile. I built it in Node with `encodeShare`: Sam played the bass and keys, and Sam's Claude wrote the drums and an effect called Warble.

The tree moved while I tested, from 7b2236d to 5d0132f (Light Table's own window and Gaffer Tape landed). None of the files cited below changed in that time. One transient: run 1's second tab loaded while `ui/plugin.js` was mid-commit, so it booted without `show_device`. `mcp.js` correctly sent `tools/list_changed` for it. There were no page errors in run 2, and the repo is untouched. Screenshots are in `scratchpad/fresh6/agent/shots/`.

## Broken, ranked by how much it hurt

1. **`show_on_fretboard` with `play: true` adds a track and signs it "You".**
   - **What I did:** on Night Shift, whose Guitar track is an audio track, I called `show_on_fretboard { chord: "Am7", frets: [5, 8], label: …, play: true }`.
   - **What happened:**
     - A new track appeared: "Keys guitar", a DI Box with the Guitar track's chain.
     - History got two entries by **You**: "add Keys guitar for the keys" and "Keys guitar: level +4.1 dB, measured against the song". The human got a toast with Undo.
     - The result said only `played: true` and `visible: false`; the human wasn't even on the Jam tab.
     - My next `undo` took back my previous change ("pump the pad") instead.
     - `provenance_report` now credits the edit to You.
     - On Sam's link song it went straight past the Keep guard, because it was signed `you`.
     - While the human was recording on another track, it added a "Guitar" track mid-take and auditioned the chord through it. `play`, `use_groove`, `drum_track` and `set_tone` all refused with `recording` in the same moment.
   - **Expected:** a "point at the neck" tool doesn't change the song. If it must add a track, the track is mine, the result says so, the call is refused while recording, and on a link song it comes back as a card.
   - **Screenshots:** 09-fretboard-scale.png, 17-during-rec-after-fretboard.png, 34-fretboard-play-adds-track.png.
   - **Cause:**
     - `ui/jam.js:498` calls `playShown`, which calls `audition` (`jam.js:337-338`). That calls `ensureKeysGuitar({ select: false })`, whose `by` defaults to `'you'` (`jam.js:111`).
     - `runShow` (`jam.js:493`) never passes `ctx.by` and has no recording check.
     - The description (`extra-schemas.js:278`) promises only "sounds it on the Guitar track".

2. **Device params aren't range-checked.**
   - **What I did:** `apply_ops` with `instrument.set` on the Arp (Light Table) `{ a_table: 99, flt_cutoff: -5 }`, and on the Riff (DI Box) `{ tone: 7 }`.
   - **What happened:** `ok: true`, with diffs "a_table 4 → 99, flt_cutoff 2600 → -5 Hz" and "tone 0.7 → 7". The Arp then rendered at −120 LUFS. The fader is checked: gain 60 is refused with "gain is in dB, -96..24".
   - **Expected:** refused with the range, the way an unknown key already is; or clamped and said so. Units are where agents slip: kHz for Hz, 0..1 for dB, a label for a switch index.
   - **Cause:** `agent/tools.js:979-1003` (`unknownParams`) checks keys only. Nothing compares values against min/max or the number of switch options.

3. **`set_tone` can't find a track by name, and drops the agent's reason.**
   - **What I did:** `set_tone { rig: "crunch", track: "Riff" }`, and the same with "Keys" on Sam's song.
   - **What happened:** `no track "Riff"`, with the hint `tracks: "Drums", "Arp", "Riff"`. Only the id works. My `reason` ("a sweet soul clean for the fills") reached History as "".
   - **Expected:** id or exact name, as the schema says ("the track (id or exact name)", `extra-schemas.js:268`).
   - **Cause:**
     - `ui/jam.js:487` looks the track up with `store.track(input.track)`, which matches ids only (`core/store.js:275`).
     - `jam.js:193` sets `reason: by === 'you' ? '' : undefined`, and `runTone` (`jam.js:472`) never passes `input.reason`.

4. **`use_groove`'s hint sends the agent in a loop.**
   - **What I did:** `use_groove { groove: "neosoul/behind-the-beat", bar: 5 }` on Night Shift, with no track named.
   - **What happened:** "bars 5–8 on Drums already holds 'Beat'", with the hint "…leave track out for a new Drums track…". I had already left it out. Leaving it out always picks the selected or first drum track, so following the hint gives the same error. The same hint comes with "no track" and "isn't a drum track".
   - **Expected:** a hint that works, such as "add a drum track with apply_ops, then name it", or a way to ask for a new track.
   - **Cause:** the hint text in `core/grooves.js:697, 698, 704` contradicts the default in `agent/grooves-tool.js:31-36` and `:137`.

5. **An agent can't take back its own `make_jam_track`, and the summary credits the wrong author.**
   - **What I did:** `make_jam_track` (blues) over Night Shift, which had my edits in it, then `undo` and `revert_my_changes`.
   - **What happened:**
     - The result said "Night Shift is in Recent songs; the toast's Undo brings it back". That toast is the human's and lasts 7 s.
     - `undo` says "nothing by mcp:claude-code to undo", `revert_my_changes` reverts 0, and History is empty.
     - The summary says "Drums, Bass, Organ by the house band", but every note is signed Claude Code (History shows "Claude Code 100%").
   - **Expected:** the result says only the person can bring the old song back (Song → Recent songs), or there's an agent path back. The summary names who the parts are signed by. The destructive annotation is right.
   - **Cause:** `ui/jam.js:263` replaces the song with `store.load`, not an op. `core/jam.js:752` hard-codes "by the house band", while `ui/jam.js:259` signs the parts with the caller.

6. **The agent's name runs into its own messages in the Agent tab.** This shows on every MCP entry: "Claude Coderead the song", "Claude CodeStatic Bloom is up…", "Claude CodeArp level?". The cause is `agent/panel.js:832`, which gives the speaker column 54 px; `.ag-spk` (`:836`) has `min-width: 0`, and nothing wraps or clips the name. Screenshots: 02-agent-panel-zoom.png, 28-say-ask.png.

7. **A held device's code gets through with one variable renamed.**
   - **What I did:** on Sam's song, `define_device` with Warble's held kernel, copied from `get_device`. That was refused, correctly. Then I sent the same kernel with `ph` renamed to `phase` and a comment added.
   - **What happened:** it was offered as "Claude Code wants to add a new device, Wobble." Nothing on the card says it's Sam's held code, and Keep would run it after the device check. On a song that's the person's own, it would compile and run at once, and "What an agent defines here is trusted in this browser from then on" (AGENTS.md:119).
   - **Expected:** AGENTS.md:156 says "define_device refuses a held device's code under any id". Either catch an edited copy, or say the check is exact text.
   - **Cause:** `agent/tools.js:1153-1156` hashes the raw kernel source.
   - **Screenshot:** 14-three-cards.png.

8. **Two chords in a bar on a riff style: the bass skips the second chord's root, and the Jam room misreads it.**
   - **What I did:** `make_jam_track { style: "blues", progression: "I7 IV7 | I7 % V7" }`.
   - **What happened:**
     - Over the D7 half-bar the bass plays C B A F# (the end of the A7 riff) and never a D.
     - `get_jam` and the room's big "Next" read bar 1 as A7 then Am6/C, and read the E7 as G.
     - The result carries both readings: the summary says "A7 D7 | A7 A7 E7", the sections say "A7 Am6/C A7 G…".
   - **Expected:** the riff restarts, or at least the root plays, at each chord change.
   - **Cause:** `core/jam.js:582-605` (`riffBass`) picks each riff note's role by its beat in the bar, so a chord that starts on beat 3 gets the roles b7, 6, 5, 3.
   - **Screenshot:** 10-jam-track-made.png.

9. **Small ones.**
   - Two `section.add` ops without refs: `created` keeps only the last id.
   - `apply_ops` with `clip.repeat` reports "+32 notes" in its summary while the diff says "4 clips, 128 notes".
   - `show_on_fretboard` refuses a call without `label` ("label it"), but the schema doesn't mark it required (`extra-schemas.js:279`).
   - `list_devices { cat: "guitar" }` returns "none match" without listing the categories. DI Box is filed under pluck.
   - `get_jam { bars: [8, 2] }` silently returns bar 8 only.
   - `render_and_measure` over bars 40–44 of a 16-bar song measures silence and doesn't say the range is past the end.
   - The Agent tab's chips read "+core.shaper", "project.set, section.add ×2" and "browsed 1 devices". `set_tone` and `show_on_fretboard` chips have no words at all. Keep cards show raw diffs ("Keys: + Snapper insert th -62 (default) → -80 dB") and device ids (06-chips.png, 23-built-song.png).
   - After a new jam track, the neck still shows the previous song's overlay (11-funk-jam.png).

## Confused, ranked

1. **What it costs to read.**
   - `tools/list` is 64 KB, about 17,000 tokens, before the first call.
   - `apply_ops`'s description is 7.3 KB and contains every line of `get_guide "ops"` (6.3 KB), so that guide adds nothing for an MCP agent.
   - `get_device core.wavetable` is 38.6 KB, about 10,000 tokens: 114 params with a sentence each and 24 presets of about 30 changes each. Its table params also point at `docs/research/LIGHT-TABLE.md`, which an MCP agent can't open.
   - `list_devices { cat: "synth" }` defaults to full params (it does for 12 results or fewer) at 26 KB. `{ query: "wavetable" }` is 19.8 KB for one device.
   - `get_project` prints all 114 Light Table params and all 50 Studio A params in every summary, even when `presets` already says "Glass Pad: Light Table, Bokeh".
   - In run 1, `get_device` and `list_devices` were half of all result text (116 of 231 KB).
2. **The `about` note leads almost every result.** 77 of 85 results in run 1 started with the same 175 characters, about 13 KB a session. That includes `find_grooves`, `use_groove`, `drum_track`, `make_jam_track`, `set_tone` search and `show_device`, which carry no song text. On `find_grooves` it claims the library's grooves "were written by whoever made the song".
3. **Nothing says a song is from a link until a call bounces.**
   - `get_project` and `get_selection` on Porch Light don't mention it. I learned about Keep mode from the first `offered: true`.
   - After the person pressed Make it yours, my pending card still said "The song came from a link, so this waits for you", and the agent wasn't told (35-made-it-yours-pending-card.png).
   - Opening a link in a second tab silently moved all my calls to it, so the first song's ids stopped working.
4. **Presets on big devices take two calls and about 5 KB.** `get_device { preset }` returns all 114 params, which go back in `instrument.set`. For a new track or insert, the preset's `changes` alone would do, but those only appear in the 38 KB listing, and the hint doesn't say so.
5. **There's no way for an agent to start a song.** There's no `new_song` or `open_song`. Asked for "a song with drums, a synth and a riff" while Night Shift is open, an agent can add to Night Shift, delete its tracks, or call `make_jam_track`, which brings a band. I had the human press New song.
6. **AGENTS.md's rules aren't "the same eight rules" the agent gets.**
   - AGENTS.md:63-96 says they are, but its rule 2 reads "Small, reversible moves: just make them". `prompt.js:13`, which is what `get_guide "etiquette"` returns, says only moves "they asked for" are made, and "what nobody asked for … you offer in one line, never make".
   - AGENTS.md's rule 1 drops "a named track wins over the selection" and "the last bar is the song's".
   - The in-app prompt's Jam advice ("make one only when they ask for something to jam over") isn't in the MCP instructions or any guide.
7. **`drum_track` always writes an ending, even under a loop.** With sections, it puts the style's ending in the last bars and a crash on bar 1, even when the loop covers the whole song. On Night Shift (looping bars 1–8), "Last rim" plays every pass; Static Bloom got "Big finish" in bars 15–16 under a 1–16 loop. There's no `ending: false`.
8. **`highlight` doesn't bring its target into view.** After New song the arranger showed bars 1–3. A highlight on the Arp, bars 1–4, drew two tiny crop marks with its label off-screen (30-highlight-2.png). After Fit it reads well (31-highlight-fit.png).
9. **`show_device` tells you less about the best windows.**
   - For the generic window it returns sections with their param keys. For Light Table and Studio A, which have their own editors, it returns only `editor`, so I can't map "Mod matrix", "Through the filter" or "Room pair" to params.
   - The generic window also labels mod slots m1–m8 as "Macros 1–8" (`ui/editors/generic.js:28`, `m: 'Macros'`). Light Table showed that until its own window landed mid-test (04b-window-scrolled.png), and any other device with `m1_` keys still would.
10. **Smaller ones.**
   - AGENTS.md:105-108 tells readers how Claude Code and Claude act on the hints (a read-only tool runs without asking, destructive ones prompt). That's a claim about other products I couldn't confirm.
   - A new song reports "C minor" to the agent while Sketch tells the human "Snap: no key yet".
   - With Claude Code connected, the Agent tab still leads with the yellow "Try the demo agent (no key)" button.

## What worked

- **Connecting.** `initialize` carries instructions. `tools/list` is identical with and without a tab (35 tools, each with a title and all four hints), and the relay catalog matches. A call with no tab waits, then names the URL to open. `list_changed` fired when the tab's catalog changed. Apart from item 1, the annotations read honestly.
- **Errors.** Nearly every error names the bad value and lists the valid ones: tracks with ids, clips, inserts, sections, styles, transforms, axes, chord and scale names. `apply_ops` is all-or-nothing and gives the failing op's index. `recording` names the take's track and says other tracks are fine.
- **Keep cards.** A track delete, a new device, `set_tone` over Sam's chain and `remove_bars` all came back `offered: true` with a readable `what`. Keep and Keep as it was resolved through `get_variation_result`, with the device check report after a Keep, even after Make it yours. Held code sent as-is was refused with a clear reason.
- **Grooves.** `find_grooves` understood "neo-soul". `drum_track`'s dry run matched the real run, and seeds are deterministic. `use_groove` dry runs went straight into `propose_variations` with `measure: true`, and the human's pick came back.
- **Device windows.** Light Table's new window, Studio A's kit and Scribble Strip's window all flashed my moves and said what moved ("Claude Code moved 4 controls: …"; 26-lighttable-agent-mod.png, 27-studioA-window.png).
- **Measuring.**
  - `render_and_measure` with `per_track` is short and caught my silent Arp.
  - `adjust` "less mud" switched on Slide Rule's 300 Hz band and reported the level side effect.
  - `define_device` returned the check and on vs bypassed.
- **Jam and readback.** `get_jam` (3.4 KB) and `show_on_fretboard`'s list of places are exactly what a teaching agent needs. Scribble Strip reads back as one line in `get_project`, and Studio A's `get_device` includes its note map.
- **Could an agent build a full song without guessing? Mostly.** From a blank song, 9 calls produced sections, Studio A rock drums with fills, a Light Table arp (preset, notes and `clip.repeat` through refs in one call), a DI Box riff with a bend and a rig, and a balance check. Three places needed guessing:
  - Finding the guitar: DI Box is filed under "pluck"; a query for "guitar" found it.
  - Using the track id for `set_tone`, since names fail.
  - Units: nothing stops a wrong one.

## Ideas

- `preset: "<name>"` on `track.add`, `instrument.set` and `insert.add`/`insert.set`.
- A `get_device` brief mode (one line per param, preset names and blurbs) as the default above about 40 params. `list_devices` could switch to brief by size rather than by count.
- In `get_project`, show device params as "preset Bokeh, +2 changes" instead of every value.
- Put a from-link / Keep-mode flag in `get_project` and `get_selection`, and tell the agent when the song becomes the person's or the live tab changes.
- Add the `about` note only to results that carry song text, and trim `apply_ops`'s description down to the op list, leaving the rest to `get_guide "ops"`.
- Add `ending` and `crashes` switches to `drum_track`, and make it loop-aware by default.
- Give agents a `new_song` / Recent songs tool that the person can Undo.
- Have `highlight` scroll its target into view, and have `show_device` return a custom editor's sections too.


---

# Fresh eyes, round 6: a first-timer on a phone (390x844, then sideways at 844x390)

**Setup.** I opened the local studio at app code `7863bd7` (only docs changed while I ran) in headless Chromium. I used the server from `tools/pw.js` with my own touch context: 390x844, DPR 2, `isMobile`, `hasTouch`, an iPhone user agent, and `navigator.webdriver` set to false so it was a first visit. Requests off localhost were blocked; none were attempted. Taps were `page.touchscreen.tap`. Swipes, holds and drags were real CDP touch events. I read state only to confirm what I saw.

My path:
- the welcome card
- the Jam room: Night Shift, then the blues jam track, then Make your own (Indie in G, "Am F C G")
- the neck and Sketch's Play it keys; Loop and speed; recording a take; Ideas and the agent chips
- Grooves: Hear, Tap to find, Put it at bar, Build drums for the song
- Devices → Open on Studio A, Slide Rule, Scribble Strip and Light Table
- M, S and K on a keyboard; a phone has none
- the phone on its side: Arrange, Jam, Grooves, Studio A

The app threw no page errors, the page itself never scrolled sideways, and the repo is untouched. Screenshots are in the session scratchpad (`fresh6/phone/shots/<name>.png`, not committed), named below. A few other files in that folder are from an earlier run that was cut off.

**Verdict:** the sounds and drawings are fun within two minutes, but the phone layout is a fight. The neck, the reason to open Jam, starts hidden under the Sketch sheet. A thumb trying to scroll plays notes, turns pedal knobs and moves faders.

### Broken, ranked by how much it hurt

1. **Jam on a phone hides the neck, and nothing that points at the neck brings it into view.**
   - **The neck starts under the sheet.** I tapped Jam and saw the chord and the Scale/Pentatonic/Chord tones toggles. The neck starts at y 539, under the detail sheet, which stays on Sketch's Hum it with its top at 444. The line that names what you play (`.jm-neck-label`) sits under the neck, so it's hidden too (05-jam-open, 06-jam-swiped, 07-neck-tap). I only saw the neck and that line together after dragging the sheet down (08-sheet-dragged-down).
   - **Show and Show me light up a neck you can't see.** In Ideas I tapped Show on the scale tip, then Show me on the lick. The neck lit up about 1,000 px above, off screen. The lick played, but nothing on screen changed (16-show-me-lick, 17-show-scale). Cause: `show()` calls `neck.reveal()`, which only scrolls the neck sideways (`app/src/ui/jam.js:330`, `:1011`).
   - **The room's Record is about 800 px below the neck.**
   - **Expected:** on a phone, the neck is in view when you arrive, and Show scrolls to it.

2. **Scrolling with a thumb changes the music.** The mixer makes a finger hold still before a fader moves. These three surfaces treat a scroll swipe as an edit:
   - **The neck.** A vertical swipe that starts on it plays and holds a note (C3 here) and doesn't scroll the room. The stray note is then reported as "You C: the 7th of D7" (13-jam-scroll-0 to -5, 14-jam-scrolled-from-chords). Cause: `.jm-neck-scroll { touch-action: pan-x }` (`jam.js:1207`) together with play-on-pointerdown (`jam.js:978`). On a phone the neck is full width and about 250 px tall, exactly where a thumb scrolls.
   - **The rig's pedals in Jam.** A 200 px upward swipe starting on Snapper's threshold knob moved it from −72 to −30 dB, made one undo step and didn't scroll (79-swipe-on-pedal). The first time it happened by accident, with the toast "Threshold moved from −80 dB to open over bar 23" (20-keys-and-neck). Cause: the face knob turns after 8 px of travel with no hold (`app/src/ui/faces.js:172-186`). The knobs are shrunk to 16–21 px by `zoom: 0.7` / `0.55` (`jam.js:1347-1348`), so you can't tell you're on one.
   - **Studio A's window.** Swiping down to reach the mics moved ROOM from −10 to +6 dB. The preset now reads "Birch modern, edited", and History shows "Studio A room" by you (48-studioa-scrolled2). Cause: a slider jumps to the touch point on pointerdown, then drags (`app/src/ui/plugin-kit.js:167-176`, `.pk-sl { touch-action: none }` at `:659`). The mic strips are 140 px vertical sliders across the window's width (`app/src/ui/editors/drumroom.js:238`).

3. **The Jam room's "Ask the agent" chips dead-end without an API key**, which a phone visitor won't have.
   - "What tone would suit this song?" gave "Not sent: no agent is on yet". After Ask the demo agent: "I can't do that one: I'm the scripted demo…" (73-ask-tone, 74-demo-agent-tone).
   - "What scale works over the jam?" measured my guitar take and offered three takes over it. It then sat on "Waiting for your pick…", so "Make me a slow blues in E" couldn't be sent (77-demo-scale2, 78-demo-slow-blues).
   - Cause: the chips send straight to the agent (`jam.js:775`). The demo agent (`app/src/agent/mock.js`) has nothing for get_jam, make_jam_track, set_tone or show_on_fretboard.

4. **Sideways (844x390), Grooves and the device windows have no room.**
   - **Grooves.** The sheet stops at y 195, and Grooves uses the three-column desktop layout because it chooses layout by width only (`app/src/ui/grooves.js:662-667`; the one-column layout is `max-width: 640px` at `:669`). The body gets 48 px: the list shows one line, and the Kick/Snare/Hat pads are cut off at the screen edge (66-side-grooves, 67-side-grooves-tall).
   - **Device windows.** The header (title, scope, presets, A/B) takes 257 of 390 px. Studio A's 354 px kit scrolls in a 133 px window, so you see the cymbal tops only (68-side-studioa). `.pw-phone` has no landscape rule (`app/src/ui/plugin.js:993-1021`).
   - **Jam.** The neck uses desktop spacing, 23 px between strings, because `phone()` means `max-width: 640px` (`jam.js:942`). The chord and the whole neck never fit on screen together (62- to 65-side-jam).

5. **The welcome card's links disappear when touched.**
   - After "Tap to play it" the song plays, but the link turns the card's own cream, leaving a bare underline (03-tap-to-play). "the tour" does the same.
   - On a desktop, hovering does it too: the computed colour is 244,234,214 on a 244,234,214 card (86-desktop-hover-tour).
   - Cause: `.ar-link:hover { color: var(--text) }` (`app/src/ui/arranger.js:3552`) beats `.ar-welcome .ar-link` (`:3539`) and `.ar-welcome .ar-welcome-hear` (`:3547`). iOS keeps `:hover` after a tap.

6. **The Jam room scrolls 24 px sideways and cuts off the lick tip.**
   - "…in the box at the 5th fret: it" runs off the right edge. A sideways swipe pans the whole room and clips every left edge (15-jam-down-1, 85-jam-room-panned-sideways).
   - Cause: at ≤640 px, `.jm-tips > li { grid-template-columns: 1fr }` (`jam.js:1346`, and `--ledger-cols: 1fr` at `:1345`) lets the tab's `pre` (`white-space: pre`, `:1266`) widen the column to 402 px. `minmax(0, 1fr)` would hold it.

7. **Light Table isn't in Add a track.**
   - The menu stops at DI Box. Light Table, Suitcase, Mallet Bag, Step Ladder, Brass Rail and Risers never appear (81-add-track).
   - Cause: `others.slice(0, 14)` (`arranger.js:1126`).
   - The Browser does list it, but a tap there swaps the selected track's instrument: "Guitar now plays Light Table (was DI Box)" (83-light-table-tapped).

8. **The Jam tracks popover is desktop-sized on a phone.**
   - Text: the descriptions are 11.5 px, the subtitle 10.4 px, and the Make your own labels 11 px.
   - Fields: the Style/Key/Scale/Bars selects and the Tempo/Chords inputs are 30 px tall with 13 px text, so Safari would zoom into them. "Make the jam track" is 28 px tall (10-jam-tracks, 24- to 26-make-your-own).
   - Cause: its phone rules are all scoped to `.ew-shell` (`jam.js:1302`, `:1315-1319`), but the popover is mounted on `<body>` (`jam.js:823`, class at `:831`), so none apply. That is also why its grid stays two columns. The form fields (`.jm-mk .ew-input`) have no phone size at all.

9. **"Add an effect" focuses a 13 px search field when it opens** (`app/src/ui/rack.js:1009`). On an iPhone that puts the keyboard over the list and triggers Safari's zoom (49-add-effect).

10. **The demo agent gives the wrong fix for a soloed track.**
    - It said: "Another track is soloed, so the guitar is silent, so there's nothing of it to hear. Unmute it (select the clip and press 0)…"
    - The guitar isn't muted, a phone has no 0 key, and the sentence says "so" twice (75-demo-scale).
    - Cause: `unheard()` (`mock.js:227`), `quietWhy()` (`:363`) and `ASK_UNMUTE` (`:367`).

11. **Small ones:**
    - **Stale note line.** "You E: in A blues; over D7, the 9th" was still under the neck in Indie in G (70-rec-countin). `heard()` only re-describes on the next note (`jam.js:678-681`).
    - **Toasts sit on what you're using:**
      - the neck (07-neck-tap, 11-blues-loaded, 27-own-jam-made)
      - Scribble Strip's drawing (56-scribble-window)
      - three first-press key toasts stacked over the lanes (60-s-k-keys)
    - **Targets under 44 px:**
      - the snap line over the phone keys: 100x24 and 62x24
      - Hum it's snap chips: 28 px tall
      - the Jam tone-bank words: All 22x40, Keys and Bass 34x40
      - the Jam speed slider: 16 px tall
      - the Jam pedal footswitches: 17x17
      - Studio A's face in Devices: KIT select 42x14, VIEW switch 15x15

### Confused, ranked

1. **Where do I play?** The room says "The keys play Bass. Give the keys a guitar" on a phone that has no keys. The on-screen keys are in the sheet, under Sketch → Play it. Getting the keys and the neck on screen together took four careful swipes (19-play-it, 21-keys-lit-neck). The hints are keyboard hints: "[ and ]", ⇧L, R, and F J K on the Grooves pads.
2. **My first tap on the neck made a track.** The toast said "New track: Keys guitar, DI Box with Guitar's chain. The keys play it." Night Shift already has a Guitar track, and "DI Box" and "chain" mean nothing to a newcomer (07-neck-tap).
3. **Build drums after Tap to find.**
   - The header said "Rock, Straight eighths" but the plan said Pop: the style only follows a picked groove in the style view (`grooves.js:171`).
   - The plan's first sentence opened scrolled under the pinned bar (36-build-plan vs 37-build-plan-top).
   - The result is a second kit next to the first ("Drums stays as it is"), so two drum tracks play at once.
4. **The practice speed carried over.** I set 75% on the blues, then made Indie in G. It played at 91.5 BPM while the header said "Tempo 122". Only the slider far below showed 75% (27-own-jam-made).
5. **Studio A talks in MIDI numbers:** "Snare, center: note 38, velocity 72. Plays 38 center, 34 edge, 40 rimshot…" (44-snare-tapped).
6. **Truncated or odd labels:**
   - the tone "This song's own …" (08-sheet-dragged-down)
   - the title "Blues shuffl…" (11-blues-loaded)
   - groove results "16 of 16 taps on its hits, sc…" (34-tap-results)
   - "A track for every section (1)" (30-grooves-bottom)
7. **The welcome card covers the Arrange | Jam row** on the first open, so the new tab isn't visible until you close the card (01-first-open).

### What worked

- **Jam tracks:** one tap and a band plays in that key, looping. The chord is huge with its tones, and the next one counts down. Make your own with "Am F C G" just worked (11-blues-loaded, 27-own-jam-made).
- **The neck:** tap a note and it lights everywhere it falls, with "G4, 3rd fret, string 1: the 7th of A7" (12-neck-held). Sketch's keys light it too (21-keys-lit-neck).
- **Recording and practice:**
  - The top-bar ● gave a count-in, took my neck taps, and said "Take 1 is in on Guitar, bars 1–2" (70- to 72-rec).
  - Loop Chorus worked.
  - Speed 75% said "The song's tempo is unchanged".
  - Leaving the room said "Back to full speed: 122 BPM" (23-speed, 39-arrange-after-build).
- **Grooves:**
  - The drawn grooves read at a glance, and Hear works.
  - 16 taps found "Straight eighths, score 1.00".
  - Put it at bar cut cleanly, with Undo.
  - Build it was one step (29, 34, 35, 38).
- **Device windows:**
  - Studio A's drawn kit is the best thing on the phone: snare, ride bell, hats dragged open, each lit and heard (44- to 46-).
  - Slide Rule: double-tap, then drag over a live spectrum (55-band-dragged).
  - Scribble Strip: tap a point, drag it, and the green dot rides the line (58-scribble-dragged).
  - Light Table: the keys play, and a drag moves through its 3D table (84-light-table-window).
- **The basics:** no page errors, nothing requested off localhost, the page never scrolls sideways, and all seven sheet tabs fit at 390.

### Ideas

- On a phone, tuck the sheet when Jam opens, keep a one-line chord strip on the neck, and scroll the neck into view on Show and Show me.
- Use one touch rule everywhere: a knob or fader moves only after a short hold, as the mixer does, and sliders don't jump on touch-down. Use `touch-action: pan-y` on the neck so a vertical swipe scrolls.
- Teach the demo agent the four jam tools (a tone, a scale on the neck, a jam track); the chips are the room's best way in.
- Give Grooves and device windows a landscape layout: one column for Grooves, a one-row header for the windows.
- Add a row of big note pads under the neck, so a phone can play without opening Sketch.
