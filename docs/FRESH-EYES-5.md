# Fresh eyes, round 5: a friend's link, a producer and a phone (2026-10-02, about 21:30-22:30)

After the security review (`docs/SECURITY.md`), wave 17, the ask before a shared song's code runs, and worklet modules
as files (live at `4e421a2`). The testers drove the local studio at that commit, in headless Chromium, read-only;
verbatim below. Screenshots in the session scratchpad (`fresh5/`, not committed). What came of it is in
`docs/DAY-RUN.md`'s log.

---

# Overdub first-time-friend test: report

**Setup.** I built Sam's song "Spin Cycle" (80 bpm, D minor, 5 tracks):
- Sam played the bass, the chords and the tune. Sam's AI did the drums and a sparkle part.
- It carries two devices: Tape Organ, an instrument Sam wrote, and Warble, an effect Sam's Claude wrote. Both pass `checkDevice`.
- I made the link in Node with `encodeShare(song, { from: { name: 'Sam' } })`. It came to 5,028 characters.

I opened it in a fresh Chromium profile with `navigator.webdriver` set to false, so the studio treats it as a real first visit. Everything else off this machine was blocked except Google Fonts, and nothing else was requested. I drove it with real clicks and keys. Later I opened my link back in a "Sam's browser" profile that already had Sam's song and trusted Sam's code. No console errors anywhere. `git status` is clean, and every repo file is unchanged.

### Broken, ranked by how much it hurt
1. **Sending the song back credits Sam's own instrument to me.** In Sam's browser, my link shows "Tape Organ — Jo" under "Written in this song", and its About panel says "Made by Jo, placed by Sam". It stays that way after Sam presses Make it yours (48, 50, 57).
   - Notes keep "Sam", but devices don't.
   - The cause is `app/src/core/share.js:280`: every device that isn't an agent's is re-signed to whoever sent the link. The real author is only kept in `claimedBy`, which nothing shows.
   - This contradicts the toast I got: "Every part stays signed by whoever played it."
2. **The link goes out signed "Guest".**
   - Clicking "Share a link" copies the link at once, before you can type a name.
   - I then typed "Jo" and pressed Copy link, and the clipboard still held the unsigned link. The name field only saves when you leave it (`onchange`, `app/src/ui/share.js:127`). The button copies the old link (`:125`) before the new one is ready.
   - A small line then says "Copy it again to send this one." I only caught it by decoding the clipboard; a real person would send "Guest" (44, 45b, 46).
3. **The round ▶ next to "Listening to Spin Cycle" does nothing.** It's only an icon, but it was my first click (56).
4. Small ones:
   - Right after Play it, the Organ header shows "tape-organ" instead of "Tape Organ" until something redraws (07b, 08).
   - The top Record button's tooltip lags the selected track. It said "onto Bass" while the take actually went onto Hum.
   - In the Devices tab, "Describe a sound and the agent can build it" overlaps the "+ Add" box at 1440×900 (05b).
   - History says "1 notes edited".

### Confused, ranked
1. **My first listen wasn't Sam's song.** The devices are off before I answer anything, and nothing on the Chords lane shows it's silent.
   - The only sign is the cut-off header "Tape Org…, kept off" (55).
   - I pressed Play first, like anyone would: the Organ meter sat at −120 dB and Warble was skipped (02, 03).
   - The question's buttons are the quietest thing on screen. Four yellow buttons compete with them: Play, Make it yours, Try the demo agent, Allow the mic.
2. **Who made what.** The "This is Spin Cycle." card lists "Drums and Sparkles — Claude" and "Your takes — you", but never Sam, who sent it (01). `credits()` in `app/src/ui/arranger.js:110` only lists the house, agents and you.
   - "Claude 52%, Sam 48%" counts notes, so Claude's hi-hats outvote Sam's chords.
   - History is empty, so I can't see what Sam asked their AI for.
3. **The agent.**
   - I typed "can you add a harmony to my riff?" and pressed Enter. The panel turned into an API-key and model screen with a terminal command, and my message sat unsent (38). I was stuck about a minute.
   - "Try the demo agent" then ran "Show me what you would do with this song" in my name and ignored what I'd typed (40).
4. **Fixing my riff's timing: stuck about 2 minutes.**
   - After Cmd+A, Esc didn't clear the selection; it turned off musical typing instead.
   - Clicking one selected note didn't narrow the selection, so ← moved all 7 notes, twice.
   - I got out by switching to Select mode and clicking empty space.
   - The note editor also opened too short to show my top and bottom notes, or Claude's added notes (19, 20, 42).
5. **Three ways to commit a take:** Keep, "Put it in the song" and "Keep on…", with no clear difference. Keep defaulted to "On Melody", which is Sam's track (16, 17).
6. **"Make your own" vs. "Make it yours."**
   - The card's "Make your own" leaves Sam's song for a blank song with a click loop running (53). Undo and Recent songs make that safe.
   - For a first-timer, "Back to my song" opens the house demo "Night Shift" with no message. It drops the link from the URL, and the browser's Back button leaves the studio (51, 52).
7. **"The Devices tab can play them"** opens on the Drums track. It took me about 30 seconds to think of clicking Organ (05, 06).
8. **Sam's side after the round trip.**
   - Sam's own parts now count as "Sam 45%, You 0%" in Sam's own studio.
   - My demo agent's notes are signed "Claude", the same name as Sam's AI (48).
   - Note names are spelled A# in D minor in Sketch, but Bb4 in the note editor.

### Did "kept off" make sense? Would I press Play them?
It mostly made sense: it says what the devices are, who wrote them, that they're code, and what I lose by saying no. What it doesn't say:
- They are *already* off. I was hearing the song without Sam's chords before I'd answered.
- What "code that runs on this computer" can actually do, so I can't weigh the risk. It just becomes "do I trust Sam?"
- That Play them trusts that code "in any song, from now on". I only learned that from the toast afterwards.

I'd press Play them, yes: it's Sam, and the organ is Sam's chords. I tried Keep them off first to be careful and immediately wanted it back. For a stranger's link I'd hesitate, and the wording doesn't help me tell the difference.

### The three changes that would have helped most
1. Keep the right names when a song goes back and forth: a device keeps its earlier author, or shows it ("made by Sam, via Jo's link"). Name Sam on the welcome card.
2. Make the first listen honest: ask before the first Play, or mark the silent lane. Say they're currently off, make Play them the obvious button, and explain "code" in one line.
3. Ask for my name before the first copy, and make Copy link copy the signed link.

### What felt great
- **Humming:** live ghost notes while I hummed, and back came "Your hum is in. 9 notes, D minor.", exactly the notes I hummed (17).
- **Fixing a note:** click it, press ↓, and G4 went to F4 in one press, with the note sounding and History logging it (22).
- **Recording on the computer keys:** count-in, REC light, keys lighting up, then "Take 1 is in on Hum, bars 5–6. Undo takes it back." (27, 28)
- **Sam's devices:** the kept-off panel is clear, and Tape Organ turns into a real-looking instrument and Warble into a pedal (07, 10).
- **Make it yours:** one click, the song kept playing, and History says "Forked from 'Spin Cycle' by Sam and Claude" (12).
- **The demo agent's three takes:** hold to hear each, "none is recommended", and the notes it keeps are signed with its name (40, 42).

Two oddities came from my test setup, not the app. The first hum had 20 notes because the fake mic looped my recording. The typed take landed a 16th early because my scripted key timing started before the count-in did.

---

# Overdub on a phone, round 5: first-time user with a tune in their head

I did the whole journey by touch on the local studio. The core promise breaks on the default path. After the tour has you tap a beat, the tune you hum comes back as a different tune. That's where I'd give up on the bus.

The second place I'd give up is the friend's link. On a phone it shows none of Sam's song: just a wall of text about code, plus the tour telling me to "Tap a beat".

**How I tested**
- Chromium headless at 390×844, device scale 3, isMobile and hasTouch (coarse pointer, no fine pointer), with an Android user agent. Taps, holds and drags were real CDP touch events.
- The fake mic looped a synthesized hum: E4 E4 G4 A4 | A4 G4 E4 D4 E4.
- I set `navigator.webdriver` to false so the first-run tour runs the way it does for a person. The mic permission was granted automatically, so no browser prompt was shown.
- I can't hear, so sound is judged from the meters and the song data.
- Sam's link was built in Node with `encodeShare`, `from: { name: 'Sam' }`, the same way share-test builds it: "Late Bus" with Tin Whistle on Keys and Half Measure on Hook.
- No console errors. Nothing left the machine except Google Fonts. `git status` is clean.

**Where I'd give up**
1. Keep, then Play, after humming (13, 14). The playback isn't my tune.
2. If I got past that: opening Sam's link (32). I can't see the song.

## This is broken

**#1. My hummed tune is moved into a key I never picked.**
- **What I tried:** Make your own → tapped the beat the tour asked for → Hum it → Hum → hummed E E G A | A G E D E → Keep.
- **What happened:**
  - Sketch said "19 notes, C minor. 13 moved into the key." The first pass came back F F G A# G# G F D D#.
  - C minor is just Make your own's default key.
  - The cause: `keyChosen()` in `app/src/input/hum.js` treats any clip with notes as a chosen key, and drum hits count. In Node, `keyChosen(drums-only song)` is true and `keyChosen(blank song)` is false.
  - The same hum on a blank song came back exactly E4 E4 G4 A4 A4 G4 E4 D4 E4 (48).
- **What I expected:** the notes I sang, or at least a visible "moved 13 notes into C minor · Undo". That line is hidden under the pinned buttons (#4).

**#9. The agent drops what I typed.**
- **What I tried:** typed "add a bassline that goes with my beat" and tapped Send, with no key set.
- **What happened:**
  - Send opened the API-key settings, including a terminal command with a local path.
  - "Try the demo agent" then put "Show me what you would do with this song" in the transcript, signed "You". I never typed that.
  - It offered three drum variations, not a bass, and talked about "−16.8 LUFS … sub band".

## This is too small or covered on a phone

**#2. Sam's link shows none of Sam's song.**
- The listening banner takes y 97–359. Under it come the kept-off question, a resumed tour strip ("Take one is yours…" with "Tap a beat"), and the bottom sheet. **That leaves 0 px of timeline** (32).
- After "Keep them off" there's 37 px (33). After closing the tour, 97 px, which is about one and a third of the 6 tracks (41).
- At Safari's visible 390×664 it's 0 px again. The tour strip sits behind the banner, and a tap on its Close lands on "Keep them off" (63).

**#3. The pinned row covers the pads while you tap the beat.**
- During a take, "Recording onto Drums, pass 1." wraps the pinned row into two rows (121 px, starting at y 723).
- Beatbox moves up over the bottom 18 px of all four pads (pads span y 674–741). A tap low on Kick lands on Beatbox, which turns the mic on.
- This happened on every take at 390 px (06, 07, 56).

**#4. After a hum, the pinned row grows to three rows (about 169 px).**
- It hides the pitch dial and the result line. "Your hum is in… 13 moved into the key" sits at y 691, under the row, which starts at y 675.
- The "Your hum" button runs off the right edge (x 362–424).
- Two different track pickers sit side by side: Keep goes to "New track, Pluck", Record goes to "New track, Keys" (12, 51).

**#5. Tapping beside a track's name soloes it.**
- I tapped next to "Hum" to select the track. The S lit up and the drums dimmed. There was no toast and no Undo.
- The name is a 30×17 target, and the empty part of the header isn't a target at all.
- Chrome's touch adjustment moves a tap at y 276 onto S, which starts at y 283. The event log shows pointerdown and click on `.ar-hb-solo` (21).

**#6. Landscape (844×390) hides the song and shrinks the controls.**
- The sheet takes the full height, so the timeline is 0 px until you drag it down (44, 45).
- The song title disappears.
- Stop and Record are 30×34, Play is 44×34.
- Browser, Detail and Agent turn into unlabeled icons.
- Track M/S/R buttons are 19×19 and device knobs are 23 px.
- The "Describe a sound…" button is cut off at the bottom.
- The hint says "Double-click a lane".
- Rotating back to portrait was clean.

**#7. Many small targets remain.**

| Control | Size |
|---|---|
| Clip long-press menu items (stacked, no gap) | 30 px tall (16) |
| Devices track picker rows | 31 px (36) |
| Mixer M/S/arm | 20×32 (28) |
| Mixer pan knob | 28 px |
| Swap-instrument ⌄ and "i" | 36×36 |
| Welcome links: Tap to play it / the tour / ask the agent (no extra touch reach) | 17 px tall (01) |
| Follow toggle | 26 px tall |

**#8. On the first screen, part of the Sketch pane is out of sight.**
- Sketch opens scrolled 42 px, so the mode row (Hum it · Tap it · Play it · Record · Draw a beat) is hidden under the tabs.
- "Nothing leaves this device / Allow the mic and hum" sits below the pinned row. So tapping Hum brings up the mic prompt before you've seen any explanation (01).
- Related, probably: the instrument search box takes focus when the list opens. On a real phone the keyboard would cover the list (25). Headless Chromium has no on-screen keyboard, so I couldn't confirm this.

## I was confused

- **Making it longer after humming.** "Make it 8 bars" only appears in the tour strip right after the beat (58), and it was gone once I'd hummed. I had to long-press the beat → Repeat ×4, then long-press the hum → Loop this clip, which gives no confirmation at all (16–19).
- **The tour never counts my hum as the tune.** The strip kept saying "Your beat is in…" with "Play keys over it" through the hum, the keep, the sound change and the mute.
  - Its line gets cut off: "Recording … layers on. ■ …". The cut part is "keeps it", the instruction for how to finish.
  - There are three stop squares on screen: top-left, the play button while playing, and Sketch's red Stop (02, 06, 14).
- **The mixer fader.** A plain swipe does nothing and says nothing. Hold-then-drag works. Then the strip offers "Keep that move", which reads as if the change will be undone, but the +6 dB already stuck. The master also shows "≈ LUFS M" (29, 30).
- **The kept-off question on a phone.**
  - It says the code runs "on this computer", and nothing says whether that's safe for me.
  - "The Devices tab can play them", but Devices opens on Drums, and the track picker doesn't mark which tracks are kept off (33, 35, 36, 39).
  - "Play it" then says the code will run "in any song" (40).
- **Smaller:**
  - Make your own starts clicking before I press anything, which matters on a bus.
  - The Notes tab says "Click… double-click" on a touch screen (50).
  - The hum dial labels C minor with sharps (A#, D#, G#).
  - Once, my first take read "time 7 round" (06). I couldn't reproduce it in 5 tries (52, 56).

## Three changes that would have kept me going

1. **Keep hummed notes as sung** unless the person picked a key. Drum hits shouldn't set it. Show "moved N notes into C minor · Undo" where it can be seen.
2. **Keep Sketch's pinned row to one row on a phone.** Put the status text above the pads or in the strip, so the row never covers the pads, the dial or the result.
3. **On a friend's link:** shrink the banner to one line once the kept-off question is answered, don't resume the first-run tour on someone else's song, and open Devices on the first kept-off track.

## What felt great

- **Make your own.** The loop plays, the count-in shows a big numeral in the lane, the strip shrinks to one line while recording, and then "Your beat is in: bars 1–2, 16 hits on Drums. Undo takes it back." (08)
- **The live pitch dial** showed E4 while I hummed. On a blank song the transcription was exact, notes and rhythm.
- **Changing the sound** was a delight: plain-words instrument list ("A soft choir singing vowels…"), then "Hum now plays Choir Loft (was Pinch Roller) · Undo", and a beautiful device face (25, 26).
- **Mute is unmistakable:** lit M, the name struck through, the clips dimmed (27).
- **All off** is always on screen and silenced everything within 150 ms (31).
- **Clear messages:** "Repeated Tapped beat ×4: 3 copies end to end, up to bar 9." and "It's 8 bars now".
- **The link is safe for my own work.** "Your own song is untouched" plus Back to my song brought my song back exactly. Each kept-off device has a clear "Play it" (39).

---

# Overdub, first session as an Ableton producer: findings

Overdub is closer to a real DAW than I expected. Comping, punch-in, the panic key and undo are genuinely good. But one thing kills it for a pro: R can record onto a track I didn't arm, because the record arm moves when I click empty space. And several defaults change what I play without saying so.

**The session:**
- Started from `?new`, typed 96 BPM into the tempo field, programmed a 2-bar beat on the step grid, ⌘D to 4 bars.
- Recorded a bass on musical typing (computer keys as a keyboard) with a 1-bar count-in and click over a 4-bar loop: three passes became one take folder. Comped bar 2 from Take 1 with one swipe.
- Added Verse and Chorus sections, then ⌘A ⌘D to 8 bars and a section Duplicate to 12.
- Put the Keyhole filter on the drums and drew a cutoff sweep into the chorus (98 Hz → 253 Hz at bar 3 → 18 kHz at bar 5). Recorded a Reso knob ride during a take.
- Punched in on bars 2 and 4 with "My timing" (unquantized).
- Asked the demo agent for a counter-melody.
- Exported the mix, stems and a DAWproject.
- In a second session, recorded audio from a synthetic bass DI fed in as the mic.
- No console errors in the main session.

## Bugs, most severe first

1. **R records onto a track I didn't arm.**
   - What I did: armed the Audio track (its R lit), clicked empty arranger space to set the marker, pressed R.
   - What happened: the count-in numeral appeared over the bass track (Flatwound). Clicking empty space clears the selection, and the arm falls back to another track, R light and all. Esc doesn't do this.
   - No damage this time only because no audio came in. With musical typing on, it would have laid a take over my comped bass.
   - Live and Logic: the arm only changes when you change it.
2. **Loop recording loses an early downbeat (with "My timing" on).**
   - I played a note 0.03 beats before the loop point and held it across the wrap.
   - It landed as a 0.03-beat stub at the end of the complete pass (`48@15.97/0.03`), and the next pass had no downbeat at all.
   - Same seam with ⌘Z mid-take: the toast said "Pass 2 is out of the take (4 notes)", but that pass had 5 notes. Its early first note stayed behind as a 0.02-beat D3 blip at the end of my good take.
   - Default input quantize hides this; anyone recording loose loops will hit it.
3. **Dropping a clip on another stacks both, and both play.**
   - Any drag on a clip body moves it; I meant to select bars and moved the playing comp segment from bars 3–4 to bar 5.
   - Bars 3–4 were left with only muted takes, so the bass went silent there.
   - Bars 5–6 played two unmuted clips at once: 21 bass notes where 10 belong.
   - Live overwrites what's under a dropped clip. Two ⌘Z's restored everything exactly.
4. **The demo agent didn't answer what I asked.**
   - I asked: "Write a counter-melody for the chorus (bars 5-8) that answers the bass line", with Drums selected.
   - It replayed its drum script word for word and offered hi-hat variations on bars 1–2. It never said it couldn't do a counter-melody, although `app/src/agent/mock.js` promises an honest answer first for anything it can't do.
   - With the bass's chorus clip selected, it offered three variations (octave pops, fifths, chromatic pickups) that add notes into my bass clip. They covered only the one-bar comp segment I'd clicked, not the chorus I named. That's a variation on my bass, not a counter-melody on its own track.
5. **"Ramp up" doesn't ramp into the chorus.**
   - On a flat 30 Hz stretch it went from 30 Hz to 735 Hz over one bar, then dropped back to 30 Hz. That would have left the chorus drums filtered to nothing.
   - Over bars that already ramp, it silently does nothing: no history entry, no message.
6. **At 1280 px wide, the top bar loses the Loop toggle and Undo/Redo** (Undo/Redo are also gone at 1366). That's a 13-inch laptop.
7. **Take numbers aren't chronological after stopping mid-pass.** The complete first pass plays as "Take 2"; the later, cut-short pass is "Take 1".
8. **A revert from the History panel can't be redone.** Reverting only Claude's entry worked and kept my later edit, but ⌘⇧Z then said "nothing to redo".
9. **Closing the "Take one" tour card edited my song.** It turned the loop off and widened it, logged as "the tour's loop off" by you.
10. **Polish:**
    - The "Keys pl… Esc" line under the title is cut off at 1440 and 1280 px, hiding the track name the guide says it shows.
    - Instrument descriptions are cut mid-word: "…vowels from t".
    - The click popover shows "0 dE" for 0 dB.
    - Keyhole's cutoff and reso readouts collide: "2.62 kH0.250".
    - The Inspector's input device reads "Defa".
    - Musical typing spells C minor as D#/G#/A#; the piano roll says Eb/Ab/Bb.
    - The Beat editor header says "Bars 1–2 of 2" over a grid labelled 3 and 4.
    - The mixer's M key logs "track mute" for an unmute.
    - ⌘L, ⌘C/⌘V on clips and ⌘E do nothing, with no message.

## Design disagreements, by how much they'd cost me

1. **Keys change meaning with focus.**
   - M toggles the click, except when the Mixer panel has focus, where it mutes. With the Mixer tab open and Drums selected in the arranger, M silently turned my click off. Logic: M mutes, K is the click.
   - S splits in the arranger but solos in the mixer.
   - A hides the agent pane (Live: automation); B toggles the browser (Live: draw mode).
2. **Defaults that rewrite my playing, unannounced.**
   - Musical typing is quantized by default: my deliberately loose pass (±50 ms) came out bar-perfect, with lengths snapped to 1/16.
   - Scale lock is on by default: the home row becomes scale degrees and the black keys are dead, so D plays Eb, not E as in Live's layout.
   - The guide mentions neither. Q quantizes nicely after the fact; let me use that instead.
3. **No time selection where the music is.**
   - Bars can only be selected by dragging in empty space; any drag on a clip moves it.
   - Automation shapes use a separate selection made inside the lane, so the guide's "select some bars and right-click the lane" ignored the bars I'd selected in the arranger.
   - No ⌘C/⌘V for clips (only ⌥-drag and ⌘D), and ⌘L doesn't loop a selection (plain L does).
   - No key moves the marker by a bar (Logic uses , and .; Live nudges with the arrows). Here the arrows walk between clips and tracks.
4. **The arm always follows the selection.** Combined with bug 1, that's a trap.
5. **Keyhole ships with a tempo-synced LFO at 0.6 octaves**, so "add a filter and automate the cutoff" gives an auto-wah. Searching "filter" lists 11 devices (Squid Quack, Coral Ladder, Wailing Whale…) and none says "low-pass".
6. **The piano roll opens in Draw mode**: one click on empty grid added an Ab2.
7. **Snap stays at 1/16 zoomed out**: my ⌥-drag copy landed on bar 12 beat 3. Live's grid would snap to bars at that zoom.
8. **Automation lanes are about 40 px tall**, with no resize and no typed values. ⇧-drag for fine adjustment does work.
9. **Punch-in while playing waits for the next bar line**; Live and Logic drop in at the playhead.
10. **Export has no options**: always the whole song, no range, normalize or dither.

## Keyboard habits

| Key | What happened | Verdict |
|---|---|---|
| Space | Plays from the marker, stops back to it (like Live's insert marker) | Expected |
| ⇧Space | Continues from the stop point | Good |
| Home, or a click on the counter | Marker back to bar 1 | Good |
| R | Count-in from the marker; R or Space during the count cancels; while playing, drops in at the next bar; R again punches out and the song plays on | Better than expected |
| M | Toggles the click, not mute | Wrong for Logic users |
| ⌘Z | Undo was trustworthy everywhere; mid-take it drops the last pass | Better than Logic |
| Arrows | Step between clips and tracks; never move the playhead | Logic-ish, not Live |
| Esc | Leaves musical typing, then clears the selection, stops the agent; never stops the transport | Good |
| ⇧Esc / All off | Real panic: transport stopped, a held note and tails cut, devices rebuilt | Good |
| 0, ⌘D, ⌘A, Q | Clip mute (Live's key), duplicate, select all, quantize | Good |
| ⌘L, ⌘C/⌘V on clips, ⌘E | Nothing, no message | Missing |

## Guide vs studio

The studio matches GUIDE.md on the count-in, cancel, R while playing and punch-out; Tempo/Meter/Loop dimming during a
take; the muted-clip styling; "Tap a beat" on a new song (Drums track, 2-bar loop, click, playing); ⇧Esc; History and
"Revert all Claude's changes"; and the exports. It doesn't match on shapes from "select some bars" (the arranger's
selection is ignored), the truncated "Keys play Bass" line, and it never says musical typing is quantized and
scale-locked by default, or that deselecting moves R's target.

## Better than I expected

- **Comping:** one swipe on a take lane, one undo step. ⌘↑/⌘↓ step through takes. After a mid-bar punch-out, the original keeps playing, which is correct.
- **Knob rides:** turning a knob during a take writes its automation lane.
- **Section Duplicate** carries the clips and the automation, and the toast says exactly what it copied.
- **The agent never touched the song until I pressed Keep.** "Hold to hear" auditions each take. ⌘Z restored the song byte for byte and named whose change it undid. Its measurements were honest: it heard my filtered drums as sub-heavy.
- **Exports:** the mix measured right bar by bar (the filter closed in bars 1–3, opening through 4, the muted drum clip silent, no click); stems are two 24-bit WAVs; the DAWproject carries the automation. Unverified risk: take folders export as stacked overlapping clips (muted takes as `enable="false"`), which another DAW may trim wrongly.
- **A silent audio input gets a specific message:** "Nothing came in on input 1… Check the cable and the input's gain."

## Five changes that would make me take it seriously

1. **A sticky, explicit record arm.** Nothing but me changes it, and the armed track shows in the transport.
2. **Record what I play.** Quantize and scale lock off by default (or remembered), and fix the loop seam so an early downbeat belongs to the next pass.
3. **One real time selection** that works over clips and is shared by the arranger, the lanes and the agent; plus clip ⌘C/⌘V, ⌘L, and keys that move the marker by a bar.
4. **One meaning per key.** M mutes everywhere and the click gets its own key; S is never both split and solo.
5. **Overwrite semantics.** A dropped clip trims what's under it, comp segments move as a folder slice, and Ramp up ramps to where the lane is going.

## The best thing

The agent's trust model. It only ever offers: takes I can audition, nothing in the song until I press Keep, every change signed. ⌘Z restores the song byte for byte, and History can take back only Claude's edits while keeping mine. Neither Live nor Logic can tell me who wrote which notes, or undo one collaborator selectively. Close second: Logic-grade swipe comping in a browser.
