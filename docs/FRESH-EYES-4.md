# Fresh eyes, round 4: a beginner, a producer and a phone (2026-10-01, about 18:45-19:30)

After wave 15 (Make your own, Draw a beat, scale lock and quantize by default, the agent in plain words, lanes with
values and resizing, credit per point, copy/paste, comping). Read-only on the live site; verbatim below. Screenshots
in tools/.out/fresh-eyes-4/ (not committed).

---

# Overdub automation and comping: second session as an Ableton producer (fresh eyes, round 4)

I spent about 40 minutes on the live studio (https://overdub.ajsmithhq.com/app/, Chromium at 1440x900, the Night Shift song). I didn't change any repo files. Screenshots are `tools/.out/fresh-eyes-4/producer-01-open.png` to `producer-58-lane-menu.png`. I can't hear, so I checked what I saw against `window.overdub.store`.

**Two things I did to other testers.** The scratchpad is shared, and other testers were using it at the same time.
- I wrote my browser driver to `scratchpad/drv.mjs`. Another tester's driver (pid 91813, port 9411) had just started from that same file, so the copy on disk is now mine.
- My helper `scratchpad/r.sh` had been rewritten by the phone tester to point at their daemon on port 7391. Before I noticed, I sent their phone browser one tap at (330,240), an `e` key press and a failed `evaluate`.
- After that I moved my driver to `scratchpad/prod4/` on its own port, and I've shut it down. If the phone tester reports a stray tap or lanes opening, that was me.

## What I did, compared with Ableton and Logic

1. **Finding lanes:** `E` with nothing selected now says "Select a track first: E shows its automation lanes." The lane name is a dropdown listing Level, Pan and every device knob, and there are **+ lane** and **Hide** buttons. This is now on par with Ableton's device and parameter choosers.
2. **Filter sweep (Bass cutoff):** a value tooltip follows the cursor ("77 Hz bar 2, beat 4"), and dragging shows the point's value ("6.26 kHz bar 5").
   - The first click on an empty lane still adds a hidden point at bar 1 at the knob's old value. My sweep stored as 900 Hz → 51 Hz in an eighth note, then up to 6.26 kHz.
3. **Resizing lanes:** drag the bottom of the lane header. I took a lane from 40 px to about 140 px, and it kept that height when I hid and showed it again.
4. **Fade (Keys level):** the lane now runs from −∞ to **+6 dB**, the same as the fader, with a dotted 0 dB line.
   - I drew from −∞ at bar 1 to −3.0 dB at bar 5, and the stored data matched exactly.
   - The tooltip shows the value at the cursor's height, not the value of the line under it.
5. **Points stay between their neighbours:** I dragged the bar-1 point far past bar 5. It stopped at beat 15.5, just before its neighbour, and nothing was deleted.
6. **Copy and paste points:** box-select, then ⌘C, gave "Copied 3 points from Cutoff (bars 1–5). ⌘V pastes them at the playhead." ⌘V at bar 7 gave "Pasted 3 points on Cutoff at bar 7." with Undo.
7. **Recording a knob move:** press R, turn Drive. While it records, a red box shows where it's writing. The toast said "Recorded into its lane: Drive, bars 1–2". The times matched my hand to within a few hundredths of a beat.
   - **Keep that move** while the song played gave "Env moved from 45% to 96% over bars 1–2", then "Kept: Env, bars 1–2. It plays from its lane now."
8. **Three takes on a loop, then comping:**
   - I set the loop by dragging the brace handles to bars 5–6, turned on musical typing and recorded three passes. The toast: "Take 4 is in on Keys, bars 5–6. Three more underneath, muted."
   - ⌥T opens one take lane each for Changes, Take 2, Take 3 and Take 4, Logic style. Dragging across a lane makes that take play for that range.
   - I comped Take 2 for bar 5, Take 3 for the middle and Take 4 for the end, then used **Flatten the comp**.
9. **Asking the demo agent:**
   - "Sweep the bass cutoff up over the chorus, like a build" now goes to the **Bass** even though the scope chip said Keys.
   - "Fade the keys in over 4 bars" worked: −60 → −3 dB, measured −54, −38, −27, −19 LUFS, rising.
   - Its other moves were wrong (problems 1 and 2).
   - **Revert all Claude's changes (keep mine)** brought my own points back exactly.

## The 5 best things

1. **Take lanes and comping by dragging across a take.** It looks like Logic: a lane per take, the playing part filled in, the rest dashed. Each lane says what it plays ("Take 2 you plays bar 5"), every swipe is one undo, and History has lines like "comp: Take 3 plays beats 20–22.5 on Keys".
2. **The lanes now look like a real DAW's.** There's a parameter dropdown, + lane, value tooltips while hovering and dragging, lanes you can resize, a +6 dB cap, a 0 dB line, and points that stay between their neighbours. All six of last round's lane complaints were addressed.
3. **Copy and paste of points**, with toasts that say what was copied and where it went, plus Undo. The lane's right-click menu also has "Paste at the playhead ⌘V".
4. **Recording a knob is clear and accurate.** While it records you see the box being written, the toast after is specific, and Keep that move is a feature Ableton doesn't have. The knob no longer says "held" while you record.
5. **Credit and History are fair.** The lane header reads "Cutoff · Capstan · you and Claude". My points keep `by: "you"`, and Revert all Claude's changes restored them exactly.

## The 8 most important problems, ranked

**1. The demo agent silenced the keys for the rest of the song and overwrote my point without saying so.**
- **What I did:** I had a fade-in on Keys to −3 dB at bar 5. With the marker at bar 4, I asked "Open the bass filter up over the chorus and fade the keys out over the last bar".
- **What happened:**
  - It read "the last bar" as **bar 4**, the marker's bar. The song's last bar is bar 8.
  - It replaced my bar-5 point (−3 dB) with −60 dB. The lane now holds −60 dB from bar 5 to the end, so the keys are silent for the whole chorus (`producer-54`).
  - The reply said "from their usual level down to silence" and named −26.3 dB as that level, which is just a point halfway along my fade.
  - Asked the same thing earlier, it faded bar 6 (the last bar of a stale selection) and left bars 7–8 at −60 dB. It didn't mention that either time.
- **Expected:** "the last bar" means bar 8. A fade-out mid-song comes back up afterwards or warns that it doesn't. My points are kept, or the agent says it's replacing them.
- **Fix:** read "last bar" as the song's last bar. End every fade inside its range with a point back at the old value, unless it's the song's end. Never delete points by "you" without listing them in the reply.

**2. The agent claims a build its own measurement contradicts.**
- **What I did:** "Sweep the bass cutoff up over the chorus, like a build."
- **What happened:** it wrote 6.3 kHz → 8 kHz, starting from my existing point, so the line is nearly flat. It replied "darker at the start, brighter by the end". Its own measurement in the same reply: "3,066, 2,723, 3,059, 3,001 Hz, down and back."
- **Expected:** a build starts low, for example from a few hundred Hz. If the measurement disagrees, it says so.
- **Fix:** start a "build" sweep from well below the current value. When the measured trend doesn't match the claim, change the sentence ("this barely changed it; want me to start it lower?").

**3. After the agent replies, ⌘Z does nothing to the song.**
- **What I did:** sent a request, read the reply ("one undo takes out each move") and pressed ⌘Z.
- **What happened:** focus stays in `TEXTAREA.ag-input`, so ⌘Z went to the text box. The lane didn't change (I checked before and after).
- **Expected:** ⌘Z undoes the agent's move, as the reply promises.
- **Fix:** when a reply finishes, send ⌘Z from an empty agent input to the song's undo, or take focus off the input.

**4. The agent's scope chip is wrong.**
- **What I did:** selected the Bass track while a Keys clip (Take 2) was still selected.
- **What happened:** the chip read "On Bass, Take 2, bars 5–6", but Take 2 is on Keys. It then took "the last bar" from that stale bar range.
- **Fix:** clear a clip selection when a different track is selected. Never combine one track's name with another track's clip in the chip.

**5. Comping is good but rough at the edges.**
- **Ranges move from where you let go.** I dragged exactly bar 5 to bar 6, and it stored beats 16–20.5. It seems to stretch the range so it doesn't cut a note in half, and nothing says so.
- **Labels pile up.** Each comp split makes a clip in every lane, so you get "Tak…", "Cha…" and an overlapping "you" (`producer-40`).
- **The Takes menu contradicts the lanes.** Opened on the bar-5 piece, it lists "Take 3 muted" while Take 3 plays beats 20–22.5.
- **A stale toast.** "Take 2 plays beats 16–20.5" stays on screen after a later swipe changed that to 16–20.
- **Two units for the same thing.** One lane says "plays bar 5", the next "beats 20–22.5". A producer reads "6.1–6.3", not beat counts from the start of the song.
- **Flatten leaves three clips.** It doesn't merge into one, unlike Ableton's flatten or Logic's Flatten and Merge.
- **Fix:** snap comp edges to the grid where you let go and cut notes there, or say "kept the whole note". Use bar.beat everywhere. Make the Takes menu describe the whole comp. Have Flatten merge into one clip.

**6. Comping and the new lane features aren't in the guide.**
- `docs/GUIDE.md` and `site/docs/guide.html` don't mention take lanes, ⌥T, comping, ⌘C/⌘V for points, lane resizing or the parameter dropdown (I grepped for "take lanes": 0 hits in either).
- **Fix:** add these to the Automation and Takes sections of `GUIDE.md`, then run `node tools/docs-build.js`.

**7. Selecting a track still arms it for recording.**
- **What I did:** selected Bass to edit its lanes, then recorded a Drive move.
- **What happened:** the Walk clip turned red under the record overlay as if it were being recorded over (`producer-23`). No take was actually made.
- **Expected:** in Ableton, a knob-only automation pass doesn't arm the track.
- **Fix:** arm only when the user arms. If you keep arming on select, record notes only when something is actually played.

**8. Small lane details that still cost time.**
- **Hidden first point:** the first click on an empty lane still adds a point at bar 1 at the knob's old value. My cutoff ended up as 900 → 51 Hz in an eighth note. Ableton does the same, but shows that point clearly.
- **Hover value:** the tooltip shows the value at the cursor's height, not the line's value under it.
- **Paste past the end:** pasting at bar 7 wrote points out to beat 41, past the song's end at beat 32.
- **Loop selection:** you can't loop a selected range (⌘L and the right-click menu don't offer it). Dragging the loop brace moves it, and its handles show a pointer cursor instead of a resize cursor.
- **Top bar jumps:** after recording, and with "1 held", the overdub wordmark shrinks to just the icon, so the top bar shifts (`producer-24`, `producer-55`).
- **0 dB label:** it sits under the song-end line ("0| dB").
- **Fix:** draw the bar-1 point clearly (or skip it when the first click is near bar 1), show the line's value on hover, stop a paste at the song's end, add ⌘L to loop a selection, and give the top bar fixed widths.

## Last round's problems (FE3, the producer's section)

| # | FE3 problem | Now |
|---|---|---|
| 1 | Editing lanes blind | **Solved.** Value tooltips on hover and drag, a +6 dB cap, a 0 dB line, lanes you can resize. One gap: hovering shows the cursor's value, not the line's. |
| 2 | Demo agent's fade-in silenced the keys and claimed success | **Partly.** "Fade it in over 4 bars" now ends at −3 dB and measures rising. Fade-outs still silence everything after them (problem 1), and a claim that contradicts its own measurement still isn't flagged (problem 2). |
| 3 | Agent drops or redirects requests | **Mostly solved.** A named track beats the scope chip, and both halves of a two-part request were done. "Last bar" is still misread through a wrong scope chip (problems 1 and 4). |
| 4 | No comping | **Solved,** with the rough edges in problem 5. |
| 5 | Dragging a point past its neighbour deletes it | **Solved.** It stops just before the neighbour. |
| 6 | Lanes hard to find | **Solved.** `E` with nothing selected explains itself, the lane name is a dropdown, and there's + lane. |
| 7 | Lane signed by whoever touched it last | **Solved.** Points keep their own author, and the header says "you and Claude". The agent re-signs a point it rewrites at the same value (my bar-5 cutoff point lost `by: "you"`). |
| 8 | Can't copy automation on its own | **Solved.** ⌘C/⌘V with clear toasts. |
| Smaller | "held" while recording; Pulse had no controls; "Try" suggestions repeated | **Solved.** No "held" while recording; Pulse offers "1/4, 40%"; the suggestions appear once. Still there: select-arms-the-track, and "Describe a sound…" overlapping the Add slot. |

**Verdict:** for a producer this went from a demo to something usable. The lanes and comping now come close to Logic's. The weak link is the demo agent. Its fade-out can silence half the song while it reports success, and ⌘Z won't take it back until you click out of the chat box. Fix problems 1–3 before showing it to anyone who makes music for a living.

---

# Fresh eyes, round 4: the beginner (live site, 2026-10-01, about 18:40–19:30)

I got a beat and a tune of my own into a new song on the first try. It took about 80 seconds of clicking, from the welcome card's **Make your own** to hearing it back. After that I made it 8 bars long, changed the piano and drew a second beat on the grid. Rendered offline, my mix measured −15.1 LUFS with peaks at −4.6 dBTP, so it does make sound.

What still trips a beginner, worst first:
- On a loop that's already playing, a tune that runs past the loop's end gets cut in two, and only the small piece is kept.
- On a phone you never see what you made, because the tour card covers the song.
- Drawing notes in the Notes tab isn't held to the key.
- Making the song longer is hidden.

**Limits:** I can't hear, so I judged by what was on screen, the song data and an offline render. Chrome's fake microphone gave "I didn't hear a note", so I couldn't test humming. There were no console errors in three browsers (desktop first run, the desktop tour on Night Shift, and a 390×844 touch phone). Screenshots are `tools/.out/fresh-eyes-4/beginner-01…43-*.png` and `beginner-60…66-phone-*.png` (two numbers, 27 to 29, appear twice with different step names).

## Landing page
- **What worked:** the headline and the two strands still explain the idea in seconds. The numbers now agree: "the first of the twelve songs", "Eleven more songs to open", and the studio's Demos menu says 12.
- **What lost me:** below the first screen it's still an engineering spec: LUFS, dBTP, `render_and_measure`, MCP, "DSP kernels", "Devices are code".
- **What's missing:** the landing never says "make a beat and a tune in two minutes". The studio's welcome card says exactly that, and it's the best sentence in the product.

## The 5 best things
1. **Make your own works.** One click gave me an empty song with a 2-bar loop already playing and the click on. I pressed R, tapped F/J/K, and 24 hits landed on the beat (`beginner-04` to `07`). Then **Play keys over it** made a Keys track by itself, and my 8 notes went in on the first pass (`11`).
2. **You can't play a wrong note on the keys.** Scale lock and "My timing" are on by default. Keys outside the scale are greyed out and labelled C4, D4, D#4… On the phone you get 8 big keys under "C minor, C4–C5" (`08`, `65`).
3. **The agent is honest and asks first.** "add a bassline and make it longer" got "I can't do that one… The closest I can do: play a few takes over a part you already have" (`17`). After I kept a version it offered "Want it warmer? I can build…" as a button and did nothing on its own. My bottom panel stayed where I'd left it. The versions now have plain names: *leans into each bar*, *walks a little*, *bouncier*.
4. **The last tour card counts everything I did.** "First you: your 24 hits and 8 notes. Then Claude's (bouncier), over it… Playing over what's already there is called an overdub." (`15`) That explains the word instead of just using it.
5. **You can make a beat without playing in time.**
   - In an empty song, **Draw a beat** made a 2-bar Beat clip with "Click a square to add a hit, drag along a row for more." One drag across the Hat row filled all 32 sixteenths (`33`).
   - Right-click → **Repeat ×4** made the song 8 bars.
   - Swapping the instrument confirmed it plainly: "Keys now plays Baby Grand (was Lamp Tines) · Undo".
   - Layer, New take, Scale lock, Ghosts and Count-in now all have plain tooltips.

## The 8 most important problems, ranked

**1. A tune that runs past the loop's end is split in two, and only the fragment plays.** I reproduced it on desktop and on the phone.
- **What I did:** with the tour's loop already playing, I pressed record and played one 8-note phrase, then stopped.
- **What happened:**
  - Phone: Take 1 got 7 notes and was muted; Take 2 got 1 note (G at beat 7) and is what plays (`66`).
  - Desktop tour: 5 notes muted, 3 kept (`32`).
  - The toast reads "Take 2 is in… One more underneath, muted, the pass you stopped in among them."
- **What I expected:** my whole tune, as one take.
- **What I think causes it:** record waits for the next bar, so the phrase starts near the loop's end and wraps round. That's my reading of it; I didn't confirm it in the code.
- **Fix:** keep notes that spill over the loop seam with the take they belong to, and when a pass is only a fragment, keep the fuller take.

**2. On a phone you never see your song during the tour.**
- **What I did:** Make your own → tapped a beat → played the keys.
- **What happened:** the tour card plus the toast cover the whole arranger in steps 2–4. The toast also sits on the card's "Ask the demo agent" button (`62`, `64`, `65`).
- **What I expected:** to see my clip appear.
- **Fix:** on phones, shrink the tour to a one-line strip above the bottom panel, and don't show a toast while the card is up.

**3. The Notes tab doesn't keep notes in key.**
- **What I did:** made a new clip on a Baby Grand track and clicked a rising line of 8 notes.
- **What happened:** the notes were C, C#, D, D#, E, F, F#, G, so 3 of the 8 are outside C minor. "Scale" is off in Notes while Scale lock is on in Sketch. The piano roll's rows are about 13 px tall, with only C4 labelled (`37`, `38`).
- **What I expected:** the same protection as the keys.
- **Fix:** turn Scale on in Notes for new songs (or follow Sketch's setting), and shade the in-key rows.

**4. Making the song longer is hidden, and the view jumps away.**
- **What I did:** looked for a way to make my 2-bar song longer. I tried asking the agent and the Song menu, then right-clicked a clip and chose **Repeat ×4**.
- **What happened:**
  - The agent and the Song menu had nothing.
  - After Repeat ×4 the view scrolled to bars 8–12, so my Keys clip was off screen. My next right-click landed on an empty lane (`22`). Only **Fit** brought it back.
- **Fix:** add "Make it 8 bars" to the tour's last card or to the clip toast, and leave the view where it was after a repeat.

**5. You can't see what Claude added.**
- **What I did:** kept version C, *bouncier*.
- **What happened:** Claude's 8 notes went into my clip. The clip is still signed only "you", and at arranger zoom its notes look exactly like mine (`16`). The product promises every take is signed, but nothing shows Claude's notes here.
- **Fix:** put the agent's notes in their own clip or take, or sign the clip "you + Claude" with cool outlines that show at arranger zoom.

**6. Jargon is still in the agent's replies.**
- "−19.4 LUFS on its own; most of its energy in the low-mid band"
- "chromatic pickups", "fifths answering the roots"
- "add an API key… or connect Claude Code over MCP"
- In Devices: "Rigs", and knob values like 0.500 with no units. In Notes: "VEL" and "Transform".
- The tour card says "A and B" when there are three versions (A, B, C) (`13`).
- **Fix:** say the measurement in words ("a warm, low-heavy sound") and move the numbers to a detail line. Say "Want me to do anything you type? Use your own Claude" instead of naming API keys and MCP.

**7. The Takes list and the tour's wording leave you unsure what's kept.**
- **What I did:** played one melody, then looked at the Takes list.
- **What happened:**
  - The list showed 5 takes for 3 passes, including a duplicate of my melody: "Take 4: 8 notes, 3 bars · Put it in the song", even though it was already in.
  - Every take still offers "Keep on…", so I wasn't sure whether I still had to keep anything.
  - In my next new song the list said "From other songs… from 'Untitled'". Every new song is called Untitled.
  - Smaller: on the keys step the card's headline still said "Your beat is in the song.", and the counter started at "2 of 5".
- **Fix:**
  - Don't list a separate copy of a pass that's already in the song.
  - Mark takes that are in the song as "in the song" instead of offering "Keep on…".
  - Name new songs "Untitled 2", "Untitled 3" and so on.
  - Retitle each tour step.

**8. Layout glitches.**
- In Devices, "Describe a sound and the agent can build it" overlaps the **Add** slot (`42`).
- The Notes header clips the clip name to "on Baby Grand by yo" when a note is selected (`38`).
- An unexplained "Keys pl… Esc" sits under the song title (`04`).
- The Add a track menu cuts its descriptions off mid-word (`35`).
- The phone's Kick/Snare pad hints are clipped to `"b" /` (`62`).
- The confirmation toast lands on the clip you just recorded (`11`).

## Status of round 3's beginner problems (docs/FRESH-EYES-3.md)
1. **Your music buried in someone else's song: solved.**
   - The welcome card leads with **Make your own** and opens a blank song.
   - "the tour" still runs inside Night Shift, but it now records onto new **Taps** and **Tune** tracks.
   - The last card counts everything ("your 24 hits and 8 notes").
2. **Demo agent ignores what you type: solved.** It says it can't do it first, then offers the closest thing. The reply now leans on API key and MCP jargon (problem 6).
3. **The tour's loop isn't playing: solved.** I sampled the playhead on Night Shift: 1.1.4 → 2.4.1 → 1.1.1, looping bars 1–2.
4. **Wall of jargon: partly solved.**
   - Fixed: the right panel opens on "Try the agent" with the key folded away, the versions have plain names, the tour explains "overdub", and Layer / New take / Scale lock / Ghosts have tooltips.
   - Still there: LUFS and low-mid in replies, API key and MCP, Rigs, VEL, Transform.
5. **The agent acts unasked: solved.** It offers, and the panel doesn't switch.
6. **"Play keys over it" replaced the song's chords: solved.** It now records onto its own track, and Night Shift's "Changes" stayed unmuted. The take split in problem 1 replaces this as the issue on this step.
7. **Layout glitches: mostly solved.**
   - The toast no longer covers Hear, Keep and Agent in the Takes panel.
   - The record row no longer overlaps itself; it just truncates "Recordi…".
   - The Tap grid stays full size, the mic button fits, and the Beat header reads "by you".
   - New glitches are in problems 2 and 8.
8. **No route for non-musicians: mostly solved.** Draw a beat is there, scale lock is on and the in-key keys are highlighted. The exception is the Notes tab (problem 3).
- **Not verified, same as round 3:** humming, because of the fake microphone.

---

# Phone tester report: OVERDUB live studio at 390×844, touch only (iPhone user agent, real touch events)

On a phone you can now make your own song from the first screen. "Make your own" took me from the welcome card to a tapped beat and a melody in about 2 minutes, and most of round 2's phone problems are gone. The worst thing left is that a one-finger drag still edits instead of scrolling in two places, the beat grid and the mixer. Close behind: a sticky footer covers the drum pads and the hum dial, and a melody played across the loop ends up as just its last fragment.

I can't hear, so sound is judged from the song data and what's on screen. No console errors all session. Screenshots are `tools/.out/fresh-eyes-4/phone-02-…` to `phone-59-…`. Other testers write to the same folder, so `phone-01-03-bass-lanes.png` there isn't mine.

**Note on the brief:** `docs/FRESH-EYES-3.md` has no phone section. The last phone report is in `docs/FRESH-EYES-2.md`, so I checked against that one, plus the round-3 beginner items that apply on a phone.

## The 5 best things
1. **Make your own works end to end by touch.**
   - It's the main button on the welcome card. It opens a blank 120 bpm C minor song with a 2-bar loop and starts on "Tap a beat".
   - The count-in shows a big numeral in the lane.
   - While recording, the tour card shrinks to one line, so you can see your hits drawn live. The beat square sits right above the pads.
   - The result was correct: "Your beat is in: bars 1–2, 16 hits on Drums" (phone-04 to 07).
2. **The touch keys.**
   - Scale lock is on by default. In C minor the keys show only in-key notes (C4–C5, each 43×140 px).
   - On Late Checkout's Bass the range moved to D#2–D#3.
   - Record sits above the keys, not below the fold (phone-08, phone-54).
3. **Scrolling the arranger is fixed.**
   - Four swipes on clips moved no clip and no track. A vertical swipe on a clip scrolled the view (scrollY 0 → 127).
   - Long-press opens the clip menu, with a hint: "A drag without holding scrolls".
   - A muted clip is clearly marked: dashed, struck through, and labelled "muted".
   - The piano roll scrolls by swipe and drew no stray notes (phone-21, 22, 43, 50).
4. **The agent is honest and polite.**
   - I asked "make it sound happier and add a bassline". It answered "I can't do that one: I'm the scripted demo…" and offered the closest things it can do.
   - After I kept a take it offered ("Want it warmer? I can build…") instead of acting.
   - "Hold to hear" played 1.1 → 1.4 while held and went back to 1.1 when I let go.
   - The API key setup is folded behind "Use your own Claude" (phone-26, 33).
5. **The transport is solid.**
   - All off stopped playback and returned to 1.1. Its red tint cleared within 3 s.
   - Stop returned both the position and the view to bar 18.
   - The top bar didn't move from bar 18 to bar 20: the position display stayed 82 px wide and the lanes stayed at y 185.
   - With the loop off, playback stopped at the end of the song.

## The 8 most important problems, ranked

**1. A vertical swipe on the beat grid paints hits instead of scrolling.**
- **What I did:** In Draw a beat, I swiped up on the grid to reach the Crash row.
- **What happened:**
  - It painted a whole column: Kick through Low tom, 6 hits (31 → 37 notes). There was no toast and no Undo (phone-15).
  - In History, Undo on "add 6 hits" was refused: "Undo goes newest-first for each author: undo You's later changes first".
  - Grid cells are about 18×20 px.
  - The grid fills the pane, so there's almost nowhere to scroll from.
- **Expected:** Scroll, like the arranger and the piano roll now do.
- **Fix:** On touch, a vertical drag scrolls; paint only along the row (horizontal drag) or by tapping, and make cells at least 32 px.

**2. The sticky footer covers the drum pads and the hum dial.**
- **What I did:** Opened Tap it, then Hum it.
- **What happened:**
  - The pads span y 674–741, but the footer starts at about 720. The bottom ~20 px of every pad is hidden, and Beatbox starts at y 730, so a low tap on Kick can hit Beatbox, which turns on the mic (phone-03, 05).
  - In Hum it, the 150 px pitch dial (y 717–867) sits almost completely under the Hum/Record buttons (phone-55, 57).
- **Expected:** All of the pad and the dial visible.
- **Fix:** Reserve the footer's height below the content, or don't make the footer sticky on phones.

**3. A melody played across the loop keeps only its last fragment.**
- **What I did:** Tapped the panel's Record and played 16 notes over the 2-bar loop.
- **What happened:**
  - The phrase wrapped into a second pass. The song kept "Take 2", which has 5 notes. The 11-note first pass sits underneath, muted ("Take 2 is in on Keys, bars 1–2. One more underneath, muted").
  - The count-in also seemed short: 300 ms after I pressed Record during playback it already read −1.3.
- **Expected:** My whole melody, or at least the fuller pass.
- **Fix:** When the last pass is partial (you stopped mid-loop), keep the fullest pass and comp the rest, or keep a phrase that crosses the loop point as one take.

**4. Between steps, the tour card covers the arranger and stops updating.**
- **What happened:**
  - After I recorded keys, the card still said "Your beat is in the song". The take toast sat on top of it and cut off the card's last line (phone-12).
  - You can't see your takes until you Close the card.
  - Closing the tour silently turned the loop off and stretched it to bars 1–4. History logged that as "You: the tour's loop off".
- **Fix:** Collapse the card to one line after every step, not only while recording; move on to the next step when a take lands; leave the loop alone on Close, or offer to restore it.

**5. Send with no key drops what you typed and puts other words in your name.**
- **What I did:** Typed "make it sound happier and add a bassline" and tapped Send.
- **What happened:**
  - Nothing was sent. The sheet jumped to the middle of the API-key settings, already scrolled past the key field.
  - When I then tapped "Try the demo agent", my text was gone. The transcript showed "You: Show me what you would do with this song", which I never typed (phone-27 to 29).
- **Fix:** With no key, Send should start the demo agent with my message (it handles off-script requests well now), or say so in one line next to the field.

**6. There's no zoom on a phone.**
- **What I did:** Pinched outward on the arranger.
- **What happened:**
  - The pinch scrolled sideways into empty bars 25–37. The zoom stayed at 3 px per beat (phone-47).
  - Fit is the only zoom control.
  - In the 24-bar demo, notes in clips are 2–4 px, and piano-roll rows are about 8 px tall.
- **Fix:** Pinch to zoom in the arranger and piano roll, or add +/− buttons.

**7. Many targets are still small or squeezed together.**
- Clip menu items: 30 px.
- Agent suggestion chips: 24 px, stacked with no gap (y 508/532/556).
- The selection "×": 18 px.
- Mixer M/S/arm buttons: 20×32. The Master "—": 36×11.
- Follow: 26 px. Beat-header buttons (‹ › copy, clear, Repeat): 26 px.
- Scale lock, My timing and the "Playing …" select: 28 px.
- The welcome card links: 17 px. The demo-open confirm buttons: 24 px.
- The Demos list runs past the bottom of the Song menu: Late Checkout and the rest are below a clipped edge, so you have to scroll inside the menu.
- The long-press hint toast is drawn over the clip menu's Duplicate/Repeat items.
- The Song menu still has no Undo.
- **Fix:** At least 40 px per target, 8 px gaps between stacked chips, size the menu to the screen, and add Undo to the Song menu.

**8. In the mixer, a stray swipe moves a fader with no Undo.**
- **What I did:** Swiped up from the dB readout under the Keys strip (I was trying to scroll).
- **What happened:** Keys went from +1.5 dB to +6.0 dB. No toast, no Undo (phone-52, 53).
- **Related, in History:**
  - Each row's Undo only appears after you tap the row.
  - Rows show "clip.set" and "project.set".
  - The refusal message says "You's".
- **Fix:** A fader moves only when you grab its cap. Every level change gets a toast with Undo. History rows use plain words.

**Smaller things:**
- Eb major is labelled with sharps: "Eb major, D#2–D#3" and keys D#, G#, A#.
- The recording strip reads "Recording, time 1 round: each time layers on. ■ k…", which is clumsy and truncated.
- The count-in still shows "−1.1" in the position display.
- The section label "Chan…" and the title "Late Check…" are clipped.
- The beat grid keeps its playhead column highlighted after stop.
- The Beat editor doesn't show that its clip is muted.
- The Metronome setting went from on to off without my touching it (seen once, not reproduced).
- One empty hum produced two toasts saying the same thing.
- The agent still talks in LUFS: "−16.3 LUFS … sub band".

## Round 2 phone problems (FRESH-EYES-2), now
| # | Problem | Status |
|---|---|---|
| 1 | Swiping the arranger moves clips | **Solved** in the arranger: clips never moved, and a swipe scrolls. A swipe on a track name now does nothing (no reorder, but no scroll either). The same bug now shows up in the beat grid (problem 1). |
| 2 | Humming isn't in the song | **Partly / not verified.** Record in Hum it now opens the mic (Hum and Record both turn to Stop, and it reports "I didn't hear a note"). The Chromium fake mic gave no pitch, so I couldn't confirm notes land. The dial is hidden under the footer. |
| 3 | Top bar reflows at bar 10 | **Solved.** No reflow at bars 18–20. |
| 4 | Stop restores the position but not the view | **Solved.** |
| 5 | Tour card hides the recording | **Solved while recording** (one line). It still covers everything between steps (problem 4). |
| 6 | Tiny, hidden or off-screen targets | **Partly.** The main buttons are 40–48 px. Many small ones remain (problem 7). Still no Undo in the Song menu. A metronome toggle is now in the Song menu. |
| 7 | Keyboard ignores the instrument's range; Record below the fold | **Solved.** |
| 8 | All off stays red | **Solved.** |

**Round 3 beginner items that apply on a phone:**
- Default path buries your music in someone else's song: **solved**.
- Demo agent ignores what you type: **solved**.
- Agent changes things unasked: **solved**.
- No Draw a beat, scale lock off: **solved**.
- Toasts covering controls: **partly**, since they still stack over the tour card and the clip menu.
- Jargon: **partly**, since LUFS still appears in agent replies and "clip.set" in History.
