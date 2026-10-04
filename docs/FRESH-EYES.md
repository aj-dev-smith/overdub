# Fresh eyes: two newcomers on the live site (2026-10-01, about 04:40)

Two agents played strangers who had just clicked through from a post: one on a laptop (1440x900), one on a phone
(390x844, touch only), both on https://overdub.ajsmithhq.com. They were told to be honest, not polite. Their reports
are below verbatim. Screenshots are in `tools/.out/fresh-eyes/` (not committed). The most important items were fixed
in the last wave of the night; see the morning report in OVERNIGHT.md for which.

---

# OVERDUB first-visit report: laptop, 1440x900, live site, 2026-10-01

I tested as a newcomer, then used `window.overdub` only to confirm what I saw. The full path worked:

- **Landing:** read the page, played the "Strum through it" pedal and used "Hum into it".
- **Studio:** opened it, played Night Shift, tried Hum with the stock fake mic, tapped a beat, kept it and built a band.
- **Demo agent:** sent one scripted prompt and one prompt of my own, held to hear a take, kept a take and watched it build a device.
- **Rest:** checked History, made a share link and opened it in a fresh browser, used "Make it yours", started a New song, played a melody with musical typing, kept it, built a band, ran the "Take one" tour, reloaded, opened the device library and played Choir Loft.

Hum gave no notes with the stock fake mic, which only beeps. So I ran it again with a generated A3-C4-E4-C4-A3 hum file, and it worked. There were zero console or page errors during the whole session. The studio was ready about 1.7s after the click. Screenshots are in `tools/.out/fresh-eyes/desktop-NN-*.png` (01 to 53).

**Does the pitch land in 10 seconds?** Mostly. "Play over each other" plus the two strands reads as "AI plays music with you", and the word "music" is in the first screen. But the hero is abstract: there's no product picture until you scroll. The word "agent" assumes an AI-savvy reader. A non-AI musician won't know what "your agent" is until section 02.

**What's missing from the landing:**
- It never says plainly that without a key the agent is scripted. The studio says it ("a scripted session (not a live model)"); the landing only says "runs without a key".
- No song or audio plays above the fold.

## 5 best things

1. **Landing pedal plus live meters (desktop-04).** "Strum through it" gave a moving LUFS, peak and brightness readout, a 7-band spectrum and the `render_and_measure` JSON. It's the clearest proof of "agents can't hear, so the studio measures". The knobs drag and the footswitch works.
2. **Tap, Keep, Band in under a minute (desktop-15b, 16, 18, 19).** "Your beat is in. 32 hits, 2 bars." → Keep → "Kept on Drums. It's yours: undo with ⌘Z." → Band popover ("Adds tracks only. Your notes stay as they are.") → "Band in: chords and bass… One undo takes it back." The copy is excellent throughout.
3. **Demo agent flow (desktop-21 to 25).** It sends a starter prompt for you and shows its tool steps (read, looked, pointed, measured). It offers A/B/C/D takes with "Hold to hear" and "Order is shuffled; none is recommended". Then it builds a device (Velvet Hush) that shows up in the rack with a "by Claude" badge. The "scripted session" banner is honest.
4. **History panel (desktop-27).** It has an author-share bar, author filters, a reason in italics, a "picked by you" badge, per-entry "Undo this" and "Revert all Claude's changes (keep mine)". It even exposed two loop toggles I hadn't meant to make.
5. **The blank-reel screen and hum transparency (desktop-34, 53).** "Take 1 is yours." with Hum it / Tap a beat / Play it / Ask your agent is the best onboarding in the product. The hum preview draws your original pitch dashed next to the snapped note. The device library also works: cards show the "ASKED FOR" request, measured LUFS/dBTP/CPU, in-page Play with a waveform, and draggable knobs. Work survives a reload.

## 10 most important problems, ranked by how much they'd stop a newcomer

1. **The best onboarding is hidden, and the welcome card never goes away.**
   - **Did:** clicked "Open the studio".
   - **Got:** the dense Night Shift DAW, with an "API key" form taking up the whole right panel. The "This is Night Shift." card stayed on top of the clips through Play, Hum, Tap, Keep and Band until I closed it by hand (desktop-06b, 18, 19). The "Take 1 is yours" screen and the "Take one – the two-minute tour" only appear via Song → New song / Song → Take one (desktop-28, 49).
   - **Expected:** to land on "Take 1 is yours", or a tour that starts itself, and a card that clears once I act.
   - **Fix:** on first visit open the blank-reel screen with "or hear the demo" as a link, start Take one automatically, and hide the welcome card on first Play or first take.

2. **Takes land at the playhead, and the playhead carries over into a New song.**
   - **Did:** on Night Shift I'd stopped at 7.3.2, then tapped a beat and kept it.
   - **Got:** it landed at bars 7–8 on top of the house Beat. Band then stacked a second Piano and "Bass 2" over the existing Bass and Keys (desktop-19). After Song → New song the clock still read 7.3.2. My first-ever kept take on a blank song landed at bar 7, after 12 seconds of silence (desktop-42, 45b).
   - **Expected:** my first take at bar 1, and a new song starting at 1.1.1.
   - **Fix:** reset the transport on New song, and place a kept take at bar 1 (or the loop start) when the track is empty at the playhead.

3. **A share link re-signs Claude's devices to the sender.**
   - **Did:** shared, then opened the link in a fresh browser (desktop-30).
   - **Got:** Tidal Cathedral, Firefly, Night Bus and Velvet Hush were badged "Guest", in warm. The store shows sender `claude.velvet-hush` by `claude` and receiver `claude.velvet-hush` by `guest:a5bad4`; all four devices changed the same way. The header read "by Guest and Claude" even though 82% is house. Note-level authorship survived (claude 16, guest 32).
   - **Expected:** "Send a link. Every name goes with it."
   - **Fix:** carry the device `by` through encode/decode, and only re-sign the human `you` author as guest.

4. **The demo agent ignores what you type.**
   - **Did:** typed "make the whole thing sound darker and add a sad melody".
   - **Got:** "Your tapped rhythm is in: 32 notes, C2–A#2", then an offer to place my drum hits "as a lead (as you sang it)" or "as a bassline" (desktop-26). It said nothing about darker or a melody. Drum hits became pitched notes, and it said "sang" when I'd tapped.
   - **Expected:** it either does it or says "I'm the scripted demo; I can do X, Y, Z. Add a key for anything else."
   - **Fix:** when the demo agent's script doesn't match the prompt, reply with that and show its three real moves as chips. Never offer drum tracks as melody.

5. **The colour legend contradicts the screen.**
   - **Did:** read the welcome card: "Warm parts were played by a person, cool-blue parts by an agent."
   - **Got:**
     - No part was played by a person; every track is `overdub`, the house.
     - The Bass clips are blue because that's the track colour.
     - The only agent clip, Twinkle, is yellow, with a thin blue edge you can barely see (desktop-07).
     - History calls the house "Demo 82%" in the bar but "Overdub" in the filter chip.
     - In my blank song, the band I asked for counts as "Demo 83%" (desktop-45b).
   - **Expected:** the colours to match the legend at a glance.
   - **Fix:** rewrite the welcome card around the house ("the house wrote this; the ✦ part is Claude's"), avoid blue/orange track colours, and use one name for the house everywhere.

6. **Hum snaps right notes into wrong ones by default.**
   - **Did:** on a blank song (default C minor, Snap on) I hummed A3 C4 E4 C4 A3.
   - **Got:** "Your hum is in. 7 notes, C minor. 4 moved into the key." A and E are not in C minor, so a correctly sung A-minor line was altered (desktop-53). The engine detected pitch fine; the problem is the default.
   - **Expected:** to hear what I sang.
   - **Fix:** on a song with no notes, take the key from the first hum (or start with Snap set to chromatic), and only snap once a key is set.

7. **Space doesn't play after you click a toolbar button.**
   - **Did:** clicked Fit, then pressed Space twice.
   - **Got:** nothing; the clock stayed at 1.1.1. Focus was on `<button title="Fit the whole song in view">`. After clicking empty arranger space, Space played. The welcome card and tour both say "Press Space".
   - **Expected:** Space always toggles the transport.
   - **Fix:** handle Space globally (except in text inputs) and `preventDefault` on toolbar buttons, or blur toolbar buttons after a click.

8. **Sketch keeps state from the previous song.**
   - **Did:** Song → New song.
   - **Got:**
     - Sketch still showed Night Shift's tapped take, with "On Drums / On Bass / On Hook / On Fireflies" as targets in a song whose only track is Keys (desktop-36b).
     - "Play it" on the blank-reel screen added a Keys track but left the bottom panel on Devices, not the keyboard (desktop-35).
     - Old takes also stay listed under the new song.
   - **Expected:** a clean Sketch with targets from this song, and "Play it" opening the keyboard.
   - **Fix:** rebuild the target list from the current song, scope or label takes per song, and have "Play it" open Sketch › Play it with musical typing on.

9. **The agent's numbers contradict each other.**
   - **Did:** watched the demo agent build Velvet Hush (desktop-25).
   - **Got:**
     - "built Velvet Hush · +0.4 LU on Drums vs bypassed", then "It passed the device check (2.1 LU quieter than what goes in…)".
     - The measurement went from −12.7 to −12.3 LUFS, which is louder.
     - It called a tapped beat "most of its energy in the sub band".
     - Right after I kept "busier hats", its next suggestion chip was "Make the hats busier".
     - The Band summary spelled "Chords Cm – G#" in C minor; that should be Ab.
   - **Expected:** one consistent before/after number. For a product built on "measured, never guessed", contradictions undermine trust.
   - **Fix:** report one number (the in-context before/after), name which measurement it is, drop suggestions that were just done, and spell chords from the key.

10. **Overlaps, truncation and hidden toggles.**
    - **Overlaps:** the musical-typing keyboard covers the take card's Keep and Agent buttons (desktop-39b). The welcome card, Band popover and toast stacked on top of each other (desktop-18).
    - **Truncation:** take card headers cut off as "Tapped 0…" and "✓ Drun" (desktop-17).
    - **Lingering toasts:** "Kept on Drums" was still on screen after I'd opened the Band popover.
    - **Hidden toggle:** the "Keys F J K L" chip is an on/off toggle. Turned off, L silently toggles loop: History recorded "loop off" and "loop on" that I never meant to make.
    - **Unclear label:** "Agent" on a take card doesn't say what it does.
    - **Expected:** nothing important covered, and controls that say what they do.
    - **Fix:**
      - Dock the typing keyboard below the panel.
      - Let take-card headers wrap.
      - Clear a toast when the next action starts.
      - Label the chip "Tap keys: on/off".
      - Rename "Agent" to "Hand to agent".

## Smaller notes

- The share URL is 10,279 characters. That's risky in SMS, email and some chat apps. The share box also defaults "Sign it as" to "Guest" without prompting for a name.
- On the share receiver, the generic "This is Night Shift… Warm parts were played by a person" card appears again, along with "Back to my song" for someone who has no song yet.
- In the library, each card's Play button sits at the bottom of a tall card, below the fold on first view.
- A red "The input went away (unplugged or switched off)." toast appeared when I shared. It's probably caused by my harness: I re-granted browser permissions just before, which may have dropped the mic. Not counted.

Key screenshots, all in `tools/.out/fresh-eyes/`:
- `desktop-06b-studio-after-4s.png`
- `desktop-07-arranger-zoom.png`
- `desktop-19-band-built.png`
- `desktop-25-agent-built-device.png`
- `desktop-26-demo-agent-offscript.png`
- `desktop-27-history.png`
- `desktop-30-share-link-opened.png`
- `desktop-34-blank-song.png`
- `desktop-36b-sketch-stale-take.png`
- `desktop-42-typed-kept-on-keys.png`
- `desktop-53-hum-real-tone-stopped.png`

---

# OVERDUB on a phone: one newcomer's first run (390x844, touch only)

I could get through the whole core loop by touch alone. Nothing crashed, and there were no console errors anywhere. The problems are about finding things and fitting them on the screen, not things that don't work.

How I tested: headless Chromium with an iPhone user agent, `isMobile`/`hasTouch`, scale factor 3, and real CDP touch events for taps, drags and press-and-hold. The mic was Chromium's fake device, which only beeps. So when the hum take came back "I didn't hear a note", that was my test setup, not a bug. Screenshots are in `tools/.out/fresh-eyes/phone-01…37-*.png`.

## What I did, in order
1. **Landing page.** Read the hero, scrolled all 16.9k px, dragged a knob on the Cathedral Below pedal, tapped "Strum through it" and the hero's "Hum into it".
2. **Studio.** Tapped "Open the studio" and pressed ▶ on Night Shift.
3. **Tapped a beat.** Sketch → Tap it, tapped 16 hits on the pads. The take landed: "Your beat is in. 16 hits, 2 bars."
4. **Kept it and built a band.** Keep put it on Drums. Band → Pop → Build the band added Piano and Bass 2.
5. **Hummed.** Hum it → Allow the mic → recording → Stop.
6. **Play it.** Opened it; there was nothing to play on a phone.
7. **Demo agent.** Opened the Agent panel and tapped "Try the demo agent". It offered 3 takes; Hold to hear worked; I kept one. It then built Velvet Hush and measured it.
8. **History, Devices, Notes, Mixer.** Looked at each.

## The 3 best things
1. **The hero sells it in one screen** (phone-01, phone-35). "Play over each other" with the two strands is clear and pretty at 390 wide. "Hum into it" really listens right there on the landing page, and it turns the orange strand into your voice. That's the best 5 seconds on the site.
2. **Tap → Keep → Band → demo agent works with thumbs.**
   - The pads are big (about 85x66) and respond well.
   - The live "16 hits, keep going" strip is reassuring.
   - The Band popover fits the screen.
   - The demo agent's take cards have big targets (Hold to hear / Keep, about 130x40). Press-and-hold auditioning works by touch, with a clear lit state (phone-29).
   - The agent's transcript explains itself in plain words: read the song → measured −13.3 LUFS → three takes → you picked busier hats.
3. **History is the best screen on the phone** (phone-32).
   - The "Who wrote the notes" bar: You 4%, Agents 10%, Demo 86%.
   - Warm and cool cards, with "picked by you" on the agent's take.
   - Plain sentences, and "Undo this" on every card.

   It reads like a story. The full-screen Agent/History sheet with a 44px close button feels native. Also good: the Mixer (phone-37) is a readable channel strip, and the bottom sheet's handle drags up smoothly (443→218px).

## The 8 problems that would stop someone on a phone (worst first)

**1. The agent, the headline feature, is hard to find in the studio.**
- **What I did:** Landed in the studio looking for "your agent", the landing page's main promise.
- **What happened:**
  - The only way in from the top bar is an unlabeled split-panel icon at the top right ("Agent (A)", 40x40). It looks the same as the one next to it ("Browser (B)").
  - The welcome card says "ask the agent to play over it", but only "Sketch" is a link.
  - On load, focus lands on the Browser button, so the *wrong* icon gets the yellow ring (phone-10).
  - I only found Agent through the take card after keeping a beat, or by checking aria-labels.
- **What I expected:** A visible "Agent" or "Try the demo agent" button on first open.
- **Fix:** Make "the agent" in the welcome card a link that opens the demo agent, and give the top-right button a text label ("Agent") on phones.

**2. Hum's main buttons are below the fold, during recording too.**
- **What I did:** Sketch → Hum it, at the default sheet height.
- **What happened:**
  - "Allow the mic and hum" sits at y=959 and Hum at y=1069, both below an 844px screen. The pitch dial takes all the visible space (phone-20).
  - While recording, **Stop sits at y=844**, just off screen (phone-22). The prompt says "Stop (or Esc) when you're done."
  - I had to swipe inside the sheet while humming to find Stop.
- **What I expected:** A big Hum/Stop button I can always reach with my thumb.
- **Fix:** On phones, put the Hum/Stop button in a pinned footer of the sheet (or above the dial), and drop "(or Esc)" on touch devices.

**3. "Play it" is a dead end on a phone.**
- **What I did:** Tapped Play it.
- **What happened:**
  - The page says "A MIDI keyboard or your computer keys… Turn on musical typing (`) or connect a MIDI keyboard."
  - There's no on-screen keyboard, and tapping the pitch dial does nothing (phone-25).
  - The target defaults to "Playing Drums".
- **What I expected:** Piano keys or pads to play.
- **Fix:** Show a one-octave, scale-locked touch keyboard when `pointer: coarse`, or hide Play it on phones and say why.

**4. Key takes and Keep are below the fold, and the note to undo is keyboard-only.**
- **What I did:** Finished a tapped take.
- **What happened:**
  - The visible sheet area (about 327px of a 693px scroll) shows only the grid.
  - Keep and Agent are at y=786+ and need a swipe inside the sheet (phone-15).
  - After Keep, the toast says "**undo with ⌘Z**", and it covers the take card (phone-16).
  - The agent later says "one click undoes it".
  - The Keep button stays bright green after keeping, which looks like it still needs pressing.
- **What I expected:** When a take lands, Keep scrolls into view, the toast has an Undo button, and Keep switches to "Kept ✓".
- **Fix:** Scroll the new take's Keep row into view when it lands, use touch wording ("tap ↶ to undo") with an Undo button in the toast, and grey out Keep once the take is kept.

**5. The Devices rack is unreadable and too small to use on a phone.**
- **What I did:** Opened Devices on Drums (phone-33, phone-34).
- **What happened:**
  - Knob labels are **6px** (KIT, TUNE, DECAY, MIX) and values 8–9px.
  - Knobs are **21x21px** (Velvet Hush's are 24px).
  - On Velvet Hush the values run together: "2.40 kHz0.800".
  - The top ~40% of the panel is empty wood texture.
  - You page between devices with ‹ › arrows, and the next device is cut off at the right edge.
  - Dragging a knob by touch works but is very touchy: 48px of drag moved TONE from 0.35 to 0.99.
- **What I expected:** On a phone, one device at a time, at full width, with knobs at least 44px.
- **Fix:** Scale the device face to the sheet width on phones (about 2x), and halve knob sensitivity for touch.

**6. The timeline uses a third of the width for headers and shows about 2 bars, so your take is hard to spot.**
- **What I did:** Played, then kept a take while the song was at bar 3–8.
- **What happened:**
  - Track headers (name plus 40px M and S) take about 110 of 390px.
  - With the sheet up, only the Drums lane is visible (phone-21).
  - The kept take went to bar 1, layered on top of the house Beat, while Follow had the view at bar 7–8. I couldn't see where my take went until I tapped Fit (phone-17).
  - The band added "Bass 2" next to the song's "Bass", and it didn't play back, though the landing video says Band "plays it back as a song".
- **What I expected:** To see my take land, and to hear the band right away.
- **Fix:** After Keep or Band, scroll and flash the new clip. Make the M/S headers narrower on phones. Start playback after "Build the band", as the landing promises.

**7. The welcome card covers the song, and the agent sheet hides it completely.**
- **What I did:** Opened the studio, then ran the demo agent.
- **What happened:**
  - The "This is Night Shift" card covers the toolbar, sections and the first lane (phone-10/11), and it stays open after you press ▶ as it asks.
  - The agent panel is full screen, so while the demo agent "plays over" your beat you can't see or watch anything change.
  - The status pill says "Claude working" all through "Waiting for your pick".
- **What I expected:** The card to go away once I press ▶, and some view of the song while the agent works.
- **Fix:** Dismiss the welcome card on first play. On phones, open the agent sheet at about 70% height so the timeline peeks above it, and show "waiting for you" in the pill.

**8. Lots of small tap targets and desktop-only wording.**
- **What happened:**
  - **Under 32px tall:**
    - History "Undo this" (84x22) and its filter chips (24px).
    - Snap/grid chips (24–26px), "1/16 · 1/8" (24px).
    - Band style chips (26px), Band "Cancel" (24px).
    - "Add a section +" (34x20).
    - The ✕ on the agent's context chip (18x18), right next to the Send box.
    - On the landing page, the pedal on/off LEDs (24x24) and footer links (20px tall).
  - **Desktop wording:**
    - "Hold to hear": a single tap does nothing, with no "keep holding" hint.
    - The hum privacy copy says "nothing leaves this computer".
    - The landing pedal says "tab to one and use the arrow keys".
  - **Landing:** On the landing page, the 30s studio video is a desktop recording shrunk to 390px. Its UI text is unreadable, and the Pause/Sound buttons cover a third of it (phone-03).
  - **Notes tab:** Drum lane names are cut off ("High t", "Mid to", "Low to"), and the toolbar has two unlabeled magnet icons and two unlabeled chevrons (phone-36).
- **Fix:** Use a 40px minimum height for chips and "Undo this" under `pointer: coarse`. Make a single tap on "Hold to hear" play a 2-second preview. Change the device wording to "this device". Record a phone-sized version of the landing video.

## Smaller things
- The landing page is very long on a phone (16,893px, about 20 screens). The "29 devices" pedalboard alone is roughly 3 screens.
- The kept tapped beat sits on bar 1 on top of the existing drum Beat clip, so both play together. That's probably fine, but I didn't expect it.
- The Velvet Hush summary says "+0.3 LU on Drums vs bypassed" and then "2.1 LU quieter than what goes in". As a newcomer those two numbers read as a contradiction.
- One correction to my own run: I meant to keep take C (four on the floor), but my selector hit B, so I kept "busier hats". That was my mistake, not the app's.
