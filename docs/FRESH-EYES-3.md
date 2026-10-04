# Fresh eyes, round 3: a producer and a beginner (2026-10-01, about 16:30)

After automation shipped (waves 12-13): an Ableton producer's first session with automation and comping, and someone
who has never used a DAW spending their first five minutes. Read-only on the live site; verbatim below. Screenshots
in tools/.out/fresh-eyes-3/ (not committed).

---

# OVERDUB automation: notes from an Ableton producer's first session

I spent about 50 minutes on https://overdub.ajsmithhq.com/app/ (Chromium, 1440x900, the Night Shift song). Screenshots are in `tools/.out/fresh-eyes-3/producer-01…73-*.png`. I didn't change any repo file.

To check the sound, I rendered offline with `engine.render` and measured with `measure.js`. Automation does reach the audio:
- **Bass cutoff sweep, bars 1–4:** spectral centroid went 163 → 341 → 1088 → 2205 Hz.
- **Keys fade-in:** −36.4 → −18.5 → −12.4 → −11.8 LUFS.

## Each step, compared with Ableton and Logic

1. **Showing lanes (E):** E did nothing until a track was selected, and nothing told me why. Then it opened only a Level lane. That lane has no parameter chooser and no "+" button. I found Cutoff by right-clicking the knob (**Automate**, "open a lane for it"). Much later I found **Add a lane…** in a lane's right-click menu (a good Level / Pan / device-parameter list). Ableton puts a device and parameter chooser right on the lane.

2. **Filter sweep on the bass (Capstan has the cutoff; I didn't find one on the other synths I opened):** I clicked two points and got the ramp. It interpolates in log space (2.04 kHz halfway), which sounds musical. My first click silently added an anchor at bar 1 at the old 900 Hz, which made a blip I had to delete.

3. **Volume fade-in on Keys:** I clicked near the top expecting unity and got **+20.4 dB**. The lane runs −96 to +24 dB, but the mixer fader stops at +6. There's no 0 dB line and no value readout, so I fixed it blind: the arrow keys move 0.48 dB per press, Shift+arrow 4.8 dB.

4. **Pan move:** right-click the pan knob, Automate, then draw freehand. It thinned my drawing to 36 points and looked right. Before the first point, the lane holds the first point's value, the same as Ableton.

5. **Recording a knob move:** press R, move the knob, and it writes in touch mode. It only writes where I touched, goes back to the lane when I let go, makes the lane if there isn't one, and confirms with "Recorded into its lane: Cutoff, bar 10. Undo takes it back." This is on par with Ableton's touch-style recording. Two oddities:
   - While I was writing, the knob showed "held" and the transport said "1 held", which reads wrong while you're recording.
   - Selecting a track arms it, so the Bass clip turned red while I was only recording a knob.

6. **Turning a knob that has a lane:** this is excellent (see the best things below).

7. **Copying a section with its automation:** ⌘D on the Verse got this toast: "Copied Verse (4 bars) … with 3 clips and its automation (2 lanes); everything after moved right 4 bars." I checked the data and it's correct. Moving a clip also moves its automation, the same as Ableton with Lock Envelopes off. Copying automation on its own doesn't work (see problem 8).

8. **Two takes on Keys over a loop:** the section menu has **Loop it**. Recording over the loop with musical typing gave Take 2 and Take 3 stacked over the original, with a "3 takes" badge, ⌘↑/⌘↓ to switch, and Flatten. There is no comping at all (see problem 4).

9. **Asking the demo agent for automation:** it writes real lanes, signs them "Claude", and measures them, but it got the content wrong (see problems 2 and 3).

## The 5 best things

1. **Turning an automated knob tells you exactly what happened.** The toast says "Cutoff is held at 211 Hz. Its lane is off until you bring it back. [Back to the lane]". The lane name gets struck through with "held", the curve goes dashed, the knob shows a "held" badge, and the transport shows "1 held / Back to the lanes". That's clearer than Ableton's small orange re-enable button, and Logic has nothing like it.
2. **Right-click a knob and pick Automate.** The lane's right-click menu also has shapes (Ramp up/down, Swell, Dip, Hold, Pulse) that fill a bar range you've dragged, plus Draw freehand, Simplify and Clear. The knobs show an "auto" badge.
3. **Recording knob moves works the way I'd expect** (touch mode, auto-made lane, specific toast with undo).
4. **Duplicating a section carries its automation and shifts everything after it correctly**, and the toast says exactly what moved.
5. **History is readable and fair.** Every automation edit gets a plain sentence ("Level on Keys: a point at bar 3", "Cutoff, bar 10 (recorded)", "you asked: …"). **Revert all Claude's changes (keep mine)** removed the agent's lane edits and kept my later Reso point.

## The 8 most important problems, ranked

**1. You're editing blind on the lanes.**
- **What I did:** drew a "fade to unity" on Keys, then hovered and dragged points looking for their value.
- **What happened:** the fade ended at +20.4 dB. There's no number on hover, drag or selection; the lane header shows the playhead's value, not the point's. There's no 0 dB line. The gain lane goes to +24 dB while the fader stops at +6. Lanes are a fixed 40 px and can't be resized. The only place I saw the real value was History afterwards ("wrote level, bar 3: 20.4 dB").
- **Expected:** a value tooltip at the cursor and resizable lanes, like Ableton and Logic.
- **Fix:** show the value tooltip on hover and drag, cap the gain lane at the fader's +6 dB, draw a 0 dB guide, and make lane height draggable.

**2. The demo agent's "fade in" made the keys silent, and it reported success.**
- **What I did:** typed "Fade it in over 4 bars".
- **What happened:** it wrote −60 dB at bar 1 and ramped into an existing −96 dB point at bar 5, so bars 1–4 rendered at −120 LUFS. It replied "Measured, bars 1–4 silent, silent, silent, silent LUFS, steady" next to "Faded the keys in".
- **Expected:** a rise to the track's level, or an admission that it failed.
- **Fix:** the fade writer always ends on an explicit point at the target level, and the agent flags it when its measurement contradicts what it said it did.

**3. The demo agent quietly drops or redirects automation requests.**
- **What I did:** asked "Open the bass filter up over the chorus and fade the keys out over the last bar", then "Sweep the bass cutoff up over the chorus, like a build".
- **What happened:**
  - First request: it faded the keys over 4 bars, not the last bar, and never mentioned the bass.
  - Second request: it automated **Keys** brightness, plus a Velvet Hush Tone lane it didn't mention, because the scope chip still said "On Keys". It did honestly say "'like a build' is past me".
- **Expected:** it uses the track I named, or says it can't.
- **Fix:** a track or parameter named in the text overrides the scope chip, or the agent says so; the reply lists every lane it wrote.

**4. You can't comp takes.**
- **What I did:** recorded two passes over the looped chorus, then tried to take bars 9–10 from Take 2 and bars 11–12 from Take 3.
- **What happened:** you can only swap or flatten whole takes. "Split at playhead" splits only the top take. The right half lost its take group, and the left half's right-click menu no longer offered Takes.
- **Expected:** take lanes you can swipe across, like Ableton 11 and Logic.
- **Fix:** show take lanes under the clip, and let a drag across a lane make that take active for that range.

**5. Dragging a point past its neighbour deletes the neighbour.**
- **What I did:** started a drag on the cutoff lane near the bar-1 point.
- **What happened:** I grabbed that point. It slid to bar 5 and ate the 8 kHz point there, so the whole 4-bar sweep was gone. Undo restored it.
- **Expected:** Ableton and Logic keep a point between its neighbours.
- **Fix:** clamp a dragged point's time between the points on either side.

**6. Lanes are hard to find.**
- **What I did:** pressed E with no track selected, then looked for a way to get from Level to Cutoff.
- **What happened:** E with nothing selected does nothing and says nothing. With a track selected it shows Level only. The lane name is a button that selects points, not a chooser. **Add a lane…** only exists in an existing lane's right-click menu.
- **Expected:** Ableton's device and parameter dropdowns right on the lane.
- **Fix:** make the lane name a parameter dropdown, add a "+ lane" button, and have E with no track say "select a track".

**7. Lanes are signed by whoever touched them last.**
- **What I did:** drew a fade-in on Keys myself, then let the agent fade out bars 9–12.
- **What happened:** the whole Keys Level lane, my fade-in included, became `by: "claude"`, and the header read "Level Claude". Revert fixed it, but until then the header was wrong.
- **Expected:** credit for my own points, which matters in a product built on "every edit is attributed".
- **Fix:** record the author per point or per range, or show "you + Claude".

**8. You can't copy automation on its own.**
- **What I did:** box-selected points on the cutoff lane, pressed ⌘C, moved to bar 12, pressed ⌘V.
- **What happened:** nothing. Section duplicate is the only way to copy automation.
- **Expected:** copy and paste of a lane range, like Ableton.
- **Fix:** ⌘C/⌘V for selected points, pasted at the playhead.

## Smaller things I noticed

- **Musical typing stays on after recording.** Escape didn't turn it off, so S (Split) played a D4 and created a sketch take.
- **Follow mode jumps during loop recording.** At the loop end it scrolled to bars 12–24, so I couldn't see what I'd recorded.
- **Two take numbering systems disagree.** Arrangement "Take 2/3" doesn't match Sketch takes 1–5.
- **Layout overlaps:**
  - "Back to the lane" runs into the timeline.
  - "1 held" pushes the master dB readout off the top bar.
  - "Layer New take" overlaps "Count-in" while recording.
  - The split take's header text overlaps itself.
  - The track header shows "Fir…, by Claude".
  - "Describe a sound…" overlaps the Add slot.
- **The Pulse shape has no rate or depth control** (it's fixed at quarter notes, 0.3–0.7).
- **The agent repeats its "Try" suggestions** in two rows.

---

I could make a beat and a melody of my own in under five minutes, but only by taking a route the first screen doesn't offer. Song menu → "New song" puts up a "Take 1 is yours" card. From there, "Tap a beat" and then "Play keys over it" gave me two bars of drums and two bars of melody in about 50 seconds of playing. The default route doesn't work: the studio opens inside someone else's finished song, and the guided tour leads you to add your part on top of it. The tour then ended by crediting me with "your 1 hit" (`beginner-20`).

Limits: I can't hear, so sound is judged from meters and the song data, not by ear. The Chromium fake microphone didn't produce a note the studio could detect, so I couldn't test humming properly. All screenshots are in `tools/.out/fresh-eyes-3/` as `beginner-01` to `beginner-53` (54 files). I saw no console errors all session.

## Landing page, as a beginner
- **What worked:** "Play over each other" and the orange-and-blue strands get the idea across in seconds. "Hum into it" draws your voice as the orange line next to the agent's blue one, which made me smile (`beginner-48`, `beginner-49`).
- **What lost me:** below the first screen it turns into an engineering spec: take, overdub, LUFS, dBTP, DSP kernels, MCP, stems, DAWproject, "Devices are code". It never says plainly that you'll make a beat and a tune in a couple of minutes.
- **The numbers disagree:** "the first of the four songs it ships with" sits on the same page as "Nine more songs to open", and the studio's Demos menu says "10 songs".
- **Verdict:** I wanted to try it. I understood what to do only in vague terms.

## The 5 best things
1. **New song → "Take 1 is yours."** The card offers four plain verbs: Tap a beat, Hum it, Play it, Ask your agent. "Tap a beat" made the Drums track, set a two-bar loop with the click, counted me in and recorded on R. "Play keys over it" made a Keys track by itself. Levels were sensible: drums peaked at −12.5 dBFS, keys at −15.5 (`beginner-23` to `beginner-29`).
2. **Feedback that makes you feel heard.** After tapping I saw "Pass 1: 25 hits, 7 ms late on average". Every action had an Undo in its pop-up, my tapped beat turned up cleanly in the Beat tab's grid of squares (`beginner-40`), and "played by you" sat under the song name.
3. **The on-screen keyboard in "Play it".** It shows which computer key plays which note (A = C4, S = D4…). With no instrument and no musical training I could play a tune straight away.
4. **Choosing between the agent's versions.** There are three versions, A/B/C, each with "Hold to hear", plus "Keep as it was", "None of these" and "Order is shuffled; none is recommended". It's honest, and hold-to-hear is a delightful control. The demo agent's "Original kept. It already grooves." made me smile.
5. **Safe to experiment.** The song survived a reload, I could rename it by clicking the title, "New song" confirmed inline and offered Undo, and M/S/R and Snap all have useful hover tooltips.

## The 8 most important problems, ranked

**1. The default path buries your music in someone else's song.**
- **What I did:** opened the studio and followed the "This is Night Shift" card and then the "Take one" tour.
- **What happened:**
  - My taps went on top of Night Shift's already full drum part.
  - The pop-up said "10 hits on Drums (9 already there)" (`beginner-13`).
  - My 8-note melody wasn't mentioned at all in the final card: "Take one: your 1 hit."
  - The welcome card disappears the moment you press Space, and it never comes back on a second visit (`beginner-50`). "New song" and the tour are buried in the Song menu.
- **What I expected:** to make my own thing.
- **Fix:** make "Start your own song" the main button on the welcome card, run Take one in a blank song, and have the summary count everything you played.

**2. The demo agent ignores what you type.**
- **What I did:** typed "make it sound happier and add a bassline".
- **What happened:** it measured my keys part and offered the same three scripted versions as before ("octave pops on the off-beats" and so on). Only after I picked one did it say "'make it sound happier' is past me: I'm the scripted demo" (`beginner-31` to `beginner-34`).
- **What I expected:** a happier sound and a bassline, or an immediate "I can't do that".
- **Fix:** say it can't do this first, before running the script, and offer the closest thing it can do.

**3. The "Tap a beat" tour step says the loop is playing when it isn't.** I reproduced this twice.
- **What I did:** listened past bar 2 (step 1 tells you to listen), then clicked "Tap a beat".
- **What happened:** the loop was set to bars 1–2, but the playhead ran on through the chorus from beat 10.6 to 34.7, and playback stopped when the song ended. The card still read "The loop is playing bars 1–2 with the click" (`beginner-10`, `beginner-52`).
- **Fix:** jump the playhead to the loop start when the step sets the loop.

**4. A wall of jargon, aimed at someone else.**
- **Right panel by default:** an API key box, "localStorage", a list of Opus/Sonnet/Haiku models, and "Claude Code … MCP".
- **Agent replies:** "−18.8 LUFS … low-mid band", "+1.2 LU", "sub +7.8 dB", "peaks at −7.1 dBTP".
- **Version names:** "chromatic pickups", "ghosted half-step approach note", "fifths answering the roots".
- **Tour headlines:** "Now the overdub." and "That's an overdub."
- **No explanation at all:** "Layer" and "New take" have no tooltip; Rigs, Ghosts and Scale lock aren't explained either.
- **Fix:** give the versions plain blurbs ("bouncier", "busier") with the theory as a subtitle, and fold the key and model setup behind a "Use your own Claude" link.

**5. The agent changes things nobody asked for.**
- **What I did:** kept version A.
- **What happened:** the demo agent built an effect called "Velvet Hush", added it to my Keys track, and switched the bottom panel to Devices, all while the tour's closing card was on screen (`beginner-21`).
- **What I expected:** the panels to stay where I left them and nothing new added.
- **Fix:** offer it ("Want it warmer? I can build an effect") instead of doing it, and never switch the user's panel.

**6. "Play keys over it" replaced the existing part instead of adding to it.**
- **What I did:** played a melody on the Night Shift tour step "Play keys over it".
- **What happened:** the song's own chords in bars 1–2 were muted ("One more underneath, muted"). The numbering didn't add up: the Takes panel said 3, the clip said "Take 2" with "2 takes", and I had played once (`beginner-16`).
- **What I expected:** my melody playing over the chords.
- **Fix:** record onto a new track, as the blank-song path already does.

**7. Layout glitches at the moments that matter.**
- The "Your beat is in…" pop-up covers the Takes panel's Hear, Keep and Agent buttons after every take: 4 out of 4 (`beginner-13`, `-16`, `-26`, `-29`).
- During recording the control row overlaps itself, reading "Drums ⌄Layer New ta■Count-in" (`beginner-12`).
- After keeping a tapped beat, the "Tap it" grid shrinks to rows about 5px tall and doesn't show the beat (`beginner-26`).
- The "Allow the mic and hum" button is cut off at the bottom of its box (`beginner-41`).
- The tour card covers the very lanes it's describing.
- The Beat tab header is clipped to "by yo" under Swing.

**8. No easy route for someone who can't play in time or in key.**
- The Beat tab's grid of squares is the easiest way for a non-musician to make a beat, but the "Take 1 is yours" card only offers tapping in real time.
- With nothing selected, the Beat tab just says "Beat edits drum clips".
- Scale lock is off by default. The new song is in C minor, the on-screen keys are labelled C D E F G, and I played E and A natural with no hint that they're outside the key.
- **Fix:** add "Draw a beat" next to "Tap it", turn Scale lock on by default for new songs, and highlight the in-key keys.

**Not verified:** in Hum it, the backing track didn't play while I hummed (the playhead stayed at 1.1.1). That may be intended, but I'd expect to hear my beat while humming over it. The "I didn't hear a note in that one. Hum a bit louder, or closer to the mic" message was friendly.
