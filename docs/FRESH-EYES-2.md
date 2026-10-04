# Fresh eyes, round 2: the live studio after recording in the song (2026-10-01, about 13:30)

Three agents tried the live site after wave 11 shipped (recording in the song, the start marker, the killswitch,
clip mute, new instruments, ten songs, presets, the Liner notes look): a laptop newcomer, a phone newcomer, and a
working musician running AJ's own complaints as a script. Read-only; verbatim below. Screenshots are in
`tools/.out/fresh-eyes-2/` (not committed). What was fixed after is in docs/DAY-RUN.md.

---

# Fresh eyes, laptop (1440x900): live overdub.ajsmithhq.com, 1 Oct 2026

I drove headless Chrome for Testing over CDP. The fake mic played a generated hummed phrase (C D E G E D C). I changed nothing in the repo. Screenshots are in `tools/.out/fresh-eyes-2/` as `laptop-01` to `laptop-80`. There are 195 files in that folder and only about 90 are mine, so another run is probably writing there too. Every claim below was measured: `engine.beat`/`playing`/`recording`, store clips and notes, an analyser on `engine.masterTap`, and `engine.meters`.

## The 5 best things

1. **Tapping a beat into the song works.** On a blank song, "Tap a beat" adds Drums, loops 2 bars with the click and starts. R plus F/J/K landed hits **2 ms early on average** (I timed the taps). They show in the lane and in the tap strip, each pass layers, History signs it, and Undo is offered. The count-in reads −1.4…−1.1 in red at the position and puts a big 4-3-2-1 over the track. (laptop-75…79, 17)
2. **The start marker behaves like a real DAW when the loop is off.** Click bar 4, Space plays from beat 12, Space stops at 12 / 4.1.1. ⇧Space plays on from where it stopped. (laptop-29…31)
3. **The killswitch and clip mute both work.**
   - "All off" and ⇧Esc took the master from −4 dBFS to the floor (−63) in under 150 ms, stopped, and returned to the marker.
   - Pressing 0 on a playing clip strikes it through, dashes it, explains itself in a toast, and the track dropped from −10 to −22 dB in 1.5 s. (laptop-34, 39)
4. **The demo agent is good.** It offers three named takes with note previews, "Hold to hear" and Keep, and states "none is recommended". It then built Velvet Hush and reported measured LUFS before and after. History signs every step with its reason, next to "Revert all Claude's changes (keep mine)". (laptop-23…27)
5. **The look and the small loops feel polished.** Liner Notes is handsome. Other good touches:
   - Swapping an instrument says "Piano now plays Baby Grand (was Lamp Tines)".
   - Presets (Concert / Felt / Bright pop) are one click and logged.
   - All ten demos open in about 0.4 s with zero console errors.
   - On the landing page, "Hum into it" draws your voice live as the warm strand. That was the most delightful moment. (laptop-68…72, 80)

## The 10 problems most likely to stop a newcomer, worst first

1. **Humming into the song silently fails on the obvious path.**
   - **Path 1:** Hum it panel → Record (R). Count-in, about 9 bars "recording onto Wall", nothing drawn, nothing kept, no message.
   - **Path 2:** H, then R. The hum is drawn live in the Wall lane, then **discarded on Space**. No clip, no toast, History says "Nothing on tape yet". It ends up only as a sketch take.
   - Only **R, then H** landed "Take 2 is in on Wall". (laptop-48…57)
   - Fix: in Hum it, R opens the mic itself, and whatever is drawn during a take always lands.
2. **With the loop on, Space ignores the marker, and the tour leaves a loop on.**
   - A stray ruler click put my marker at bar 7, so the tour looped bars 7–8 ("loop 2 bars to record over", signed "You").
   - Later, marker at bar 4 plus Space started at **beat 24 (bar 7)**, every time. Stop went back to 4.
   - Dragging in the Loop strip **moves** the loop (it ended up at 3–18, past the song end).
   - L only toggles the loop on and off, and drag-selecting bars and pressing L doesn't loop them. Only dragging the loop edges works.
   - Fix: play from the marker and cycle once the playhead enters the loop; dragging in the strip draws a new loop; the tour removes its loop when it ends.
3. **Opening a demo throws your work away without asking.** "New song" asks first ("Room Service is kept, Undo brings it back"); Demos → Halation did not. Reopening Night Shift gave the pristine demo: my beat, keys take, Claude's take B and Velvet Hush were all gone, and only a toast Undo offered them back. Fix: use the same confirm for demos, and add Recent songs.
4. **Musical typing silently eats single-key shortcuts.**
   - The tour's "Play keys over it" turns musical typing on and leaves it on.
   - L then played a Bass note instead of toggling the loop, and I thought the loop key was broken. It worked once I turned typing off with the backtick key.
   - Fix: show a "Musical typing" badge in the transport, and turn typing off when you leave Play it.
5. **Sketch panel text collides at 1440x900.**
   - Tap strip: the Kick/Snare/Hat/Open hat labels are drawn on top of each other, and "Pass 3: 14 hits, 54 ms late on average" sits over the hits.
   - After a hum: "Your hum is in…" overlaps "Pass 1: …", the pitch wheel shrinks to about 30 px with "Again" on top of it.
   - Play it: the white keys are clipped.
   - (laptop-15, 57, 19)
   - Fix: give the panel a minimum height and one line per label.
6. **Several on-screen numbers are wrong.**
   - The final tour card says "Take one: **your 140 hits**". I tapped 8; 140 is the whole clip including the house beat.
   - A toast says "8 hits on Drums, **bars 1–8**", but I tapped in bars 7–8. The Takes card for the same take says "14 hits, 2 bars".
   - The tour says "listed in the Agent tab, **A and B**", but there were A, B and C.
   - The lane says "Take 3" while the Takes list numbers the same take "7".
   - Fix: count the take's own notes and bars, and use one numbering scheme for takes.
7. **Recording keys keeps the half-pass you stopped in.** With "New take", the active take was the 5-note fragment cut off by Space, not the full 8-note pass, and the demo agent then built its takes on the fragment. Fix: if the last pass is cut short, keep the last complete pass and stack the fragment underneath.
8. **Trim to the loop leaves a hole.** My long hum take muted bar 5 of Halation's Strum underneath it. After I trimmed my take to bars 3–4, bar 5 stayed muted, so Strum now starts at bar 6. Fix: trimming or edge-dragging a take un-mutes whatever underneath is no longer covered.
9. **Stop doesn't silence Halation.**
   - Glide's delay keeps ringing after Space: **−20 dB at 2 s, −33 at 4 s, −46 at 6 s, −60 at 10 s**. Every other demo fell below −50 dB within 3 s.
   - Night Shift's Keys chain keeps putting out a constant **−62 dBFS DC/sub offset** (energy at 0–60 Hz) while stopped. "All off" doesn't kill it.
   - Fix: cut Glide's delay feedback or fade effect tails on Stop; add a DC blocker on Night Bus.
10. **The landing page doesn't match the studio.**
    - Its stills and the 30-second video show the old teal/orange UI, not Liner Notes.
    - It says "the first of the **four** songs it ships with" a few screens above "Nine more songs".
    - It mentions none of today's features: recording into the song, count-in, marker, All off, take stacks.
    - The Guide calls the killswitch "the speaker with a cross"; the UI shows a red "All off" button.

**Smaller problems:**
- "All off" stays filled red forever after one press: its `hit` class is never removed.
- Band builds a 1-bar band from 4 notes and stacks Drums 2 and Bass 2 on a song that already has drums and bass.
- The Band button only appears after keeping a sketch hum, not for takes recorded into the song.
- After an in-song hum, the Hum panel's "Keep" button does nothing.
- Titles are cut off: "Night S…", "Choir … , by Claude".
- Opening a song keeps the old vertical scroll, so Drums is hidden.
- Fit on a 2-bar song shows 17 bars, so the drawn taps are tiny.
- The tour card covers the lanes where your notes land.
- With no API key, the whole right column opens on the key form; the no-key demo agent button sits below it.

## Verdicts on your complaints

| Complaint | Verdict |
|---|---|
| Tap and hum **in** the song like a real DAW | **Tap: solved. Keys: solved. Hum: not solved** on the natural path (problem 1). |
| Tap has no metronome or visual | **Mostly solved.** There's a click, the count-in numeral, a square that steps through four cells on each beat, and hits drawn where they land. But the "ball" is four roughly 10 px squares in the top bar, far from where you're tapping, and the tap strip's labels overlap. |
| Need a killswitch | **Solved** (All off and ⇧Esc). The button just looks stuck red afterwards. |
| Easily stop any individual pattern | **Solved.** 0 or the clip menu Mute, with a hint and a clear muted look. |
| A long take plays all the way through | **Mostly solved.** Each loop pass becomes its own take and Trim to the loop works. But trimming leaves the muted hole (problem 8), and an unlooped take still mutes the house part wherever it runs. |
| Measure 4 → Space → stop should go back to 4 | **Solved with the loop off. Broken with the loop on** when the marker is outside the loop, and the tour leaves a loop on (problem 2). |
| Notes held indefinitely on stop | **No truly stuck notes found.** I tried a key held through Stop, a window blur, and stopping each of the 10 demos at several points. But Halation keeps ringing for over 10 s after Stop, which will feel exactly like this bug, and Night Shift has a constant −62 dBFS offset. |

---

**Phone report: Overdub studio at 390x844, touch only**

On a phone, recording into the song works for taps and played keys, and stop now returns to the marker. Humming still doesn't go into the song properly. The worst problem is that trying to scroll the arranger up or down moves your clips. I could not hear anything: levels came from an analyser I attached to the master output. Screenshots are `tools/.out/fresh-eyes-2/phone-01…55-*.png`.

**3 best things**

1. **Recording keys into the song works by touch.** Tapping the top-bar record counts in a bar early, shows a big count number in the lane, outlines the recording area in red, and draws your taps where they land (phone-12, 15, 17). Stopping leaves a clean take stack. A "2 takes" label on the clip opens Previous/Next/Flatten/Delete (phone-20). The message is clear: "Take 2 is in on Bass, bars 3–4. One more underneath, muted."
2. **The start marker and stopping are solid.** Tapping a bar number sets the marker. Play then stop, and play then pause, both went back to bar 3 in 9 of 9 tries. Tails faded out within about 2 seconds every time. A key still held down was cut off by stop. The drum pads are 85x67 px, the keys 43x140 px, and the main buttons are 44 to 48 px tall.
3. **The agent sheet and History work well by touch.** The sheet is full height with a 44 px close button. "Hold to hear" plays while you hold and stops when you let go, back at the marker. History shows who wrote the notes and has an Undo. The clip mute message teaches the gesture: "hold it and pick Unmute".

**8 most important problems, ranked**

1. **Swiping up or down on the arranger edits the song instead of scrolling it.**
   - What I did: swiped up on the "Hummed idea" clip to see more tracks, then swiped on a track name.
   - What happened: the clip moved from Hook onto Bass, off screen, on top of the Bass take stack. The swipe on the name reordered the tracks ("move Fireflies"). Only swipes in empty lane space scroll (phone-48, 50).
   - Expected: a one-finger vertical swipe scrolls.
   - Fix: on touch, one-finger drag always scrolls; moving a clip or track needs a long-press first.
2. **Humming still isn't in the song.**
   - What I did: chose Hook as the target, tapped Record in "Hum it" mode and hummed. Then I tapped Hum while the song was playing and kept the result.
   - What happened: Record in Hum mode records keys, not the mic. The result was "Nothing played in that take" and the hum dial never moved. The Hum button has no count-in and no click. My hum started at beat 10.4 but was kept at the marker (beat 8), and it overlapped the existing Hook clip. "Hear your hum" sits off screen (x 418–511) and "Hear the notes" is cut off (phone-40, 46, 47).
   - Expected: hum into the song at the beats where I sang, like tapping does.
   - Fix: make Record in Hum mode take the mic into the song with a count-in, and place a hum sung during playback at its own beats.
3. **The top bar reflows once the bar number reaches 10.**
   - What happened: going from "3.1.1" to "10.1.1" widens the position display (89 to 108 px). All off wraps onto a third row, the top bar grows from 97 to 137 px, and the whole studio drops 40 px during playback. My next tap then hit the Sections "+" and added an "Intro" section (phone-27).
   - Expected: nothing moves while the song plays.
   - Fix: give the position display a fixed width for 3-digit bars.
4. **Stop returns the position to the marker but not the view.**
   - What happened: the counter showed 3.1.1, but the arranger stayed on bars 5–7, or bar 26 after a long play. The marker and playhead were off screen (phone-38, 29).
   - Expected: to see bar 3 again.
   - Fix: when you stop with Follow on, scroll the marker back into view.
5. **The tour card hides the recording it is teaching.**
   - What happened: on "Tap along" the card covers the whole arranger, so the taps drawn where they land can't be seen (phone-53, 54). The visual metronome is a 6 px dot over 8 px squares in the top bar, about 580 px above the pads. The copy says "Nothing records until you press R", which a phone has no key for.
   - Expected: to see the beat and my hits while tapping.
   - Fix: on phones, shrink the card to one line while recording, and pulse the pads or the strip above them on each beat.
6. **Several targets are tiny, hidden or off screen.**
   - The Loop row is 12 px tall, and one stray tap turned the song's loop off with no message.
   - Other small targets: the Bars row is 17 px, Follow 26 px, the Snap/1/16/1/8 chips 28 px, long-press menu items 30 px, the agent's selection "×" 18 px, and the welcome card's "the tour" and "ask the agent" links 17 px.
   - Clip mute exists only behind an unannounced long-press.
   - There is no Undo outside the toasts and the History tab: the Song menu has none.
   - The Count-in, Click and "Each pass" options are hidden on phones.
   - Fix: make every row and chip at least 40 px tall, and add a visible Undo to the top bar or Song menu.
7. **The touch keyboard ignores the instrument's range, and its Record button is below the fold.**
   - What happened: playing "Bass" on the A4–A5 keyboard recorded MIDI notes 69–81 over a bass line at 28–40, three octaves too high. The "Play it" Record button sits at y=1111, below the 844 px screen.
   - Fix: start the keyboard in the track's own register, and pin Record above the keys.
8. **All off stays solid red forever after one tap.**
   - Cause: `transport.js:424` adds the `hit` class and never removes it, so the button looks like a live alarm for the rest of the session (phone-22 onward).
   - Fix: remove the class on `animationend` or after a short timeout.

**Smaller things**
- **The demo agent worked on a clip I had muted, without noticing.** It kept a take there, measured the Keys at about −68 LUFS (essentially silence), and still reported "fuller, boomier bottom".
- **Taps on existing notes are dropped without saying so.** I tapped 8 times and the message said 4 hits, then 5 hits in the tour.
- **The beat message names the wrong bars.** It says "bars 1–8" after I recorded only bars 3–4.
- **Soloed Bass silenced the touch keys on Keys with no hint.** A tap 8 px beside the S button soloed it by accident.
- **With the loop off, playback runs into silence forever.** It was at bar 22 of a song that ends at bar 13.
- **The play button shows a pause icon but acts as stop.** It returns to the marker instead of pausing.
- **The count-in reads "−1.4" in the position display.**

**AJ's complaints, on a phone**

- **Tap in the song:** solved. There is a count-in, it records in the song, and taps are drawn live. After the count-in there is no click unless you turn it on in the Song menu (the tour turns it on), and the beat dot is far too small and far from the pads.
- **Hum in the song:** not solved (problem 2).
- **Metronome or visual:** partly solved. The count-in clicks and shows a number, but the beat dot is tiny and the tour card hides the lane.
- **Killswitch:** solved. All off is on the top bar at 79x40 px and silences everything, but it stays red afterwards (problem 8).
- **Stop one pattern:** works, but only through a long-press on the clip, then Mute. It works during playback, the clip draws hollow, and the M button mutes the whole track. The `0` key doesn't exist on a phone.
- **A long take plays all the way through:** a take ends where you stop, rounded up to the bar, and "Trim to the loop" is in the long-press menu. I did not record a take longer than the loop, so this is untested.
- **Go back to bar 4 after stop:** the position goes back but the view doesn't (problem 4).
- **Notes held after stop:** not reproduced. Eight random stops and pauses, plus a key held through stop, all faded to near silence within about 2 seconds. A −64 dBFS, 5 Hz sub-audible signal stayed on Keys after I played it live, and All off didn't clear it. It is inaudible and not a held note.

---

I ran all eight steps on the live studio at 1440×900 with real key and mouse events, and checked results with `window.overdub` afterwards. AJ's three complaints from this morning are fixed. The worst problem now is that a take silences more of the existing part than you actually played. That happened 6 times out of 6. Once it muted the whole 8-bar demo Keys part, and I couldn't make that worse case happen again in 11 more tries. The page logged no console errors the whole session.

**AJ's complaints, checked**

| Complaint | Status |
|---|---|
| Can't tap or hum in the song | Fixed. R records on the armed track from the marker, and keys, taps and hum all land on the bars where they were played. |
| No metronome or visual while tapping | Mostly fixed. There's a count-in, a moving ball, a big count numeral and a hit ruler in the Tap panel. Gaps: the click is off during the take by default, and the Click lamp stays dark during the count-in even though it clicks. |
| Need a killswitch | Fixed. Shift+Esc cut every voice to zero within 148 ms. |
| Need to stop one pattern | Fixed. `0` mutes the selected clip and it plays nowhere. |
| A long take plays all the way through | Fixed. Trim to the loop (or dragging an edge) cuts it down. |
| Stop should go back to bar 4 | Fixed. Space plays from the marker and Space again goes back to it. |
| Notes held forever after stop | Not reproduced. Nothing stuck in 90 stops across three songs. |

**Step by step**

1. **Marker.** I clicked bar 5 on the ruler and the marker moved to beat 16 ("5.1.1"). Space started playback in 18 ms. I stopped at beat 20.72 and the playhead was back at 16 within one frame; the readout showed "6.1.4" for that one frame. Shift+Space carried on from 20.72, not from the marker, but nothing on screen shows where it will resume. Home put the marker at bar 1. Screenshots: `musician-01-*`.

2. **Recording keys at bar 5.**
   - The count-in looks good. The top-bar position counts −1.4 to −1.1 in red, a big numeral counts 4 3 2 1 over the Keys lane, the ball moves, and recording started on beat 16.02, 2.7 s after R.
   - The numeral over the lane is very faint grey on top of busy notes (`musician-02-countin-1.png`, `-2.png`).
   - The count-in clicks even with the click off, but the Click lamp doesn't light. The click itself stays off for the take (on: false, whileRecording: false).
   - R still works with musical typing on. Notes landed 4–9 ms after the key went down (17.003 → 17.0074), unquantised, on the right pitches and the right track.
   - Nothing is drawn in the lane while you play; the notes only appear after you stop (`musician-02-recording.png`).
   - Overlap with the demo Keys: no doubling, because the old part is muted. **But the take always runs to the end of the loop.** Playing bars 5–6 with the default loop (bars 1–8) gave a take covering bars 5–8 and muted bars 5–8 of the original "Changes" part. That happened in 6 of 6 fresh browsers and 3 more tries on the same page.
   - On my very first take the status read "Recording onto Keys, pass 2" during the first pass. That take covered bars 1–8 and muted the whole demo Keys part (`musician-02-after-take.png`). I couldn't repeat it in 11 more tries.

3. **Loop bars 5–6, two passes.**
   - Dragging inside the loop strip moved the whole loop to bars 3–10, past the end of the song. Dragging its two edges worked.
   - There's no "loop the selection" key, and the top-bar loop button has zero size at 1440 wide, so it's effectively hidden.
   - Two passes did stack, as Take 3 and Take 4, timing within ±40 ms.
   - ⌘↑/⌘↓ step through a confusing stack. It mixes clips of different lengths, including empty leftover pieces of Take 2 covering bars 1–4 and 7–8.
   - On one ⌘↑, the announcement said "Take 2 plays on Keys, 2 of 5" while bars 5–6 went silent. The counts don't agree either: the lane says "5 takes", the Takes panel says 6, and the hint says "Take 7 of 7" while the toast says "Take 6".
   - Screenshots: `musician-03-*`.

4. **Tap.**
   - Hits show as ticks on the Tap panel's bar 5–6 ruler. The row labels Kick, Snare, Hat and Open hat are squashed into one illegible stack (`musician-04-tap-ruler-zoom.png`).
   - In the lane, layered hits appear as faint previews on top of the dense demo beat (`musician-04-tap-lane-zoom.png`).
   - Passes do layer into one clip: 6 open-hats plus 4 more gave 10 hits.
   - Hits that land on a demo hit are dropped silently. The summary said "4 hits" after I tapped 15.
   - Taps a little late, about 0.1–0.16 beat after the key went down, snapped to the next 16th (17.1 became 17.25). Some of that lateness may be my automation's own key latency, so I can't call it an app bug. Even so, the readout "44 ms early on average" is measured against that 16th, not the beat I meant.
   - The summary says "bars 1–8" for hits that are only in bars 5–6.
   - In Tap mode, L plays an open hat instead of toggling the loop.

5. **Hum.** I fed in a WAV of E4 G4 A4 G4 at 92 bpm and recorded onto Hook from bar 5. The pitches were right (64/67/69) and the notes landed on the right bars, within a 16th of where the mic heard them. The note still sounding when I pressed H to stop was dropped. The take muted all of Hook's bars 5–8, the same overwrite problem as step 2.

6. **Long take, mute, trim, killswitch.**
   - A 12-bar take went past the song's end; the song grew to 48 beats and the lanes didn't scroll to show it.
   - `0` muted it, and the Keys track measured −180 dB while playing.
   - Trim to the loop cut it to bars 5–6 and the song length went back to 32 beats. Keys is then silent in bars 1–4 and 7–8, because the original is still muted underneath.
   - Shift+Esc while playing: the engine stopped by 59 ms, every voice was zero by 148 ms, and the master dropped to −60 dB.
   - Shift+Esc while recording with keys held: all voices zero by 96 ms. It kept the take, which a panic button probably shouldn't do.
   - After the killswitch, the Keys meter sits at −63 dB indefinitely. That's the noise floor of the Night Bus effect on that track, not a stuck note, but it looks like something is still on.

7. **Stop/start 30 times on each of three songs.** I mixed Space, Shift+Space and clicking a bar then Space, at random positions and play lengths.
   - **Halation:** nothing held or stuck. At 2 s after each stop, though, the pad still had 4–12 voices at −34 to −47 dB and the master was −17 to −31 dB. Everything decays to silence by about 6 s, so these are long release tails, not stuck notes.
   - **Wake-Up Call:** silent 6 s after every one of the 30 stops; −82 dB by 2.1 s.
   - **Night Shift:** silent 3 s after every one of the 30 stops.

8. **Automation.**
   - A person can't make any: there are no lanes, right-clicking a knob does nothing, turning a knob while playing writes nothing and shows no toast, and there's no E key.
   - Only the agent can. I called its `adjust` tool directly with brightness ramp-up over bars 5–8. It added an EQ with a treble shelf going 0 → 4 dB, not a filter sweep. Its own measurement shows bar 8's brightness at 630 Hz against 648 Hz in bar 5.
   - The result is shown only as a bracket labelled "Claude: + brightness, bars 5–8". There's no curve to see or edit (`musician-08-agent-sweep.png`). After it ran, the playhead showed 8.1.1.
   - The repo's `docs/GUIDE.md` already describes automation lanes, but the live site doesn't have them yet.

**The 10 biggest gaps, ranked**

1. **A take silences more than you played** (it runs to the loop end, and once covered the whole loop). Fix: end the take where you stopped and mute the original only over that range.
2. **The take stack is confusing** (empty leftover pieces, counts that disagree, ⌘↑ can leave the bars silent). Fix: one take folder per recorded range with one row per pass, comped by swiping, no leftover pieces.
3. **People can't draw automation, only the agent can, and nobody can see it.** Fix: ship lanes (E) with a pencil and breakpoints, and give the agent a real filter-cutoff sweep.
4. **Notes don't appear while you record.** Fix: draw each note in the target lane as it is played.
5. **One key does two jobs** (L is loop and open hat; A, S and D toggle panels or play notes depending on mode). Fix: move loop to ⌘L (or C, like Logic's cycle) and show which mode the keys are in.
6. **No click during the take by default, and a dark Click lamp during the count-in.** Fix: turn on "click while recording" by default and light the lamp on each count-in click.
7. **Setting a loop is awkward** (dragging moves it, no loop-selection key, the loop button is hidden at 1440). Fix: dragging in an empty part of the loop strip draws a new loop, ⌘L loops the selection, show the button.
8. **The Sketch panel overlaps itself at 1440×900** (the Tap labels, the musical-typing wheel over its button, "Ghost notes" text over the "Pass 1" readout, the Takes "14" over "played by", toasts covering Record). Fix: a layout pass on the Sketch panel at 900 px tall.
9. **Summaries name the wrong bars** ("bars 1–8" for bars 5–6), and taps that duplicate a demo hit vanish without a word. Fix: report the bars actually played and say "n hits already there".
10. **Opening a demo replaces your song without asking** (only one previous song is kept, behind an Undo toast). Fix: autosave each song to a song list.

Smaller items: Shift+Space resumes from a point that isn't shown anywhere; the lanes don't scroll when a take runs past the song end; the Shift+Esc killswitch keeps the take it interrupts.

All screenshots are in `tools/.out/fresh-eyes-2/`, named `musician-00` to `musician-08-*.png` (44 files). No repo files were changed.
