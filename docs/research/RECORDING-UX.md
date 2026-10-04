# Recording in the song: research and spec

*2026-10-01, wave 9 (research). By a research agent of the day run; no product code changed. Screenshots in
`tools/.out/recording/` (not committed; the walkthrough scripts beside them remake them).*

AJ, this morning, after trying the live studio: "i tried tap and hum and all that, but it doesn't let you do that IN
the song like a real DAW does. or at least I couldn't figure that out. And tap, for example, doesn't even have a
metranome or visual to show when and where you're tapping... we need a killswitch for sounds and ability to easily
stop any individual patterns too... if you record a long take the whole thing plays." This document is three things:
what he hit (section 1), how the best tools solve it, with sources (section 2), and what Overdub should do and how to
build it (sections 3 and 4).

**How to read the evidence.** Same tags as [UX-RESEARCH.md](../UX-RESEARCH.md): **[manual]** a vendor's own manual
or help page; **[review]** a reputable review; **[study]** peer-reviewed research; **[hands-on]** we used Overdub
ourselves (section 1); **[inference]** our own reasoning or practitioner convention. Nobody tested the other products
hands-on; their behaviour comes from their manuals and reviews.

---

## 0. The short version

1. **There is one Record, and it records into the song.** Arm a track (selecting it arms it), press R: a count-in
   you can see and hear, then whatever you play (keys, pads, hum, beatbox, a mic) lands on that track at the bars where
   you played it, drawn in the lane as it lands. Space stops and the take is already in the song. Undo removes it.
   No Keep step, no Sketch detour. (Today: R ignores an armed instrument track and records the mic; tap and typing
   go to a side panel; nothing appears in the song until you press Keep.)
2. **The metronome moves.** An audible click plus a *moving* visual: a ball that travels between beat cells in the top
   bar and a cursor sweeping a song-anchored beat ruler in the pane you play from. Research says a flashing light is a
   poor beat to tap to and a moving one is nearly as good as a click (Hove et al., 2013). Every hit or note appears
   on that ruler the moment it lands, at its raw time and at the grid cell it snapped to.
3. **Loop recording is the default way to build a part.** With the loop on, each pass either **layers** (drums: each
   pass adds hits, the drum-machine way) or **stacks a new take** (keys, hum, audio: the last pass plays, earlier ones
   are kept underneath, ⌘↑ ⌘↓ switches). That is GarageBand's default split, and Live's and Logic's take lanes.
4. **Recording over something never doubles it by accident.** Layer adds into the clip that is there (your notes
   signed by you); a new take mutes the part it covers (kept, not deleted). Two drum parts playing on top of each
   other, as today, only happens if you ask for it.
5. **Silence is one key away.** The killswitch (Shift+Esc and the speaker button, being built now) stops everything;
   0 mutes the selected clips; a clip's menu trims it to the loop. Recording adds: a take longer than the loop becomes
   passes, not one long clip; Space during a take keeps it; the killswitch during a take keeps it too.
6. **Sketch stays the scratchpad** (always-on capture, free time, the Takes log), and gets **Put it in the song**
   (Shift+R): what you just played goes onto the track, at the beats where you played it if the song was running.
   That is Live's Capture MIDI and Logic's Capture as Recording.
7. **The first minute** is Tap it: a two-bar loop starts with the click and a one-bar count-in, you tap, each pass
   layers, the beat is in the song. Then Play it over it. Then the agent over that.

---

## 1. What AJ hit: the studio, used the way he used it

Fresh server, `/app/?demo` (Night Shift, 92 BPM, loop bars 1-9), desktop 1440x900, Chromium with the fake mic.
Scripts: `walk.mjs`, `walk2.mjs` and `phone.mjs` (copied next to the screenshots in `tools/.out/recording/`; run
them with `node` from the repo) drive keys and pads in real time against the running song; the numbers below are from
their logs. Phone: one 390x844 screenshot.

| # | Did | Got | Shot |
|---|---|---|---|
| F1 | Space, then M (metronome) | The click sounds. The only visual is the metronome button lit; nothing shows the beat. | 03 |
| F2 | T while the song played (bar 1, beat 3.6), tapped F K J K on eighths for two bars | Each hit sounds on the drum kit. The tap grid in Sketch starts **at the first hit**, labelled bar "1" whatever bar the song is on; no playhead, no song bars, no click unless M is on. It shows what you tapped, not where in the song it went. | 04 |
| F3 | Waited 2.5 s for the take to close, pressed Keep | The take kept its song position (beat 0, 3 bars), but landed **on top of the house Beat clip on the same track; both play.** Nothing appeared in the arranger until Keep. | 05, 06 |
| F4 | Musical typing (\`) while the song played, six notes | They were captured at bar 5 (correct), but **played on the drum kit**: the keep had selected Drums, and typing plays the selected track ("Playing Drums"). Only the Takes column shows them. | 07, 08 |
| F5 | R (record) with nothing armed | Toast: "Nothing is armed. Arm a track (its ● button) to record onto it." A dead end for keys and taps: R only ever records audio. | 09 |
| F6 | Hum: turned on **With song**, pressed H | The song did **not** start. The chip only works from the Hum button: the H key calls `hum.start()` without `withSong` (`input/index.js`, `toggleHum`). | 11 |
| F7 | Armed **Keys** (an instrument track) with its ●, pressed R | It recorded **the mic** onto the Guitar audio track, and armed Guitar too. The armed instrument track is ignored (`transport.js` `record()` → `audio.toggleRecord`). | 20 |
| F8 | Armed Guitar, playhead at bar 3, R | One bar of clicks, then the song. **No count-in visual**: the position reads 3.1.1, the lane shows nothing; only the record button is red. | 21 |
| F9 | Recorded 14 s | **Nothing grows in the lane** while recording; the take appears at Stop. It also stops by itself at the loop's end (a silent punch-out, `audioin.js`), which reads as a bug. | 22, 23 |
| F10 | Right-clicked the long take | Open, Rename, Duplicate, Repeat, Split, Loop this clip, Select its bars, Delete. **No mute, no trim, no stop.** Esc while playing does nothing to sound. | 25 |
| F11 | Looked for a panic | None. Space stops the transport; held notes, tails and previews are a separate matter. | — |
| F12 | Phone, Tap it while playing | Same grid anchored to the first hit; the record button (40x44) sits in the top bar, far from the pads. | 30 |

Since the walkthrough, the working tree (another agent, wave 9) already has: `engine.silence()` with Shift+Esc and a
speaker-with-a-cross button in the transport (F11), `clip.mute` with the 0 key and Mute in the clip menu, Trim to the
loop in the clip menu, and Stop on a take's Hear button in Sketch (F10). This spec takes those as the base (3.12).

**What the failures have in common.** Overdub has two time systems that never meet: the song (arranger, transport,
loop) and the capture (Sketch, Takes, Keep). Everything AJ wanted ("IN the song", "when and where you're tapping",
"stop any individual pattern") is the two meeting: input drawn and placed on the song's timeline, as it happens.
The engine already knows where every note was played in the song (`capture.js` stores each note's song beat, on the
unwrapped grid across loop wraps). The missing part is the interaction and the drawing, plus a recorder that owns a
take from count-in to commit.

---

## 2. How the best tools do it

### 2.1 Where a take lands

- **Ableton Live** has two answers. Arrangement record writes clips onto armed tracks at the playhead; Session record
  writes into a clip slot that loops. "Clicking one track's Arm button unarms all other tracks unless the Cmd modifier
  is held", and recording starts with the Arrangement Record button (Shift reverses "Start Playback with Record")
  [manual: [Live 12, Recording New Clips](https://www.ableton.com/en/live-manual/12/recording-new-clips/)].
- **Logic Pro** records into regions on armed tracks; "Recording starts at the current position of the playhead" is
  GarageBand's wording of the same rule [manual: [GarageBand for iPhone, record a Touch Instrument](https://support.apple.com/guide/garageband-iphone/chs392846e9/ios)].
- **FL Studio** splits pattern and song: in pattern mode notes go into the selected pattern's piano roll; in song mode
  "Pattern clips automatically place at playback start point in the Playlist"
  [manual: [FL Studio, Recording Notes / MIDI](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/recording_scores.htm)].
- **GarageBand iOS Live Loops / Logic Live Loops**: tapping a cell in Cell Record mode "triggers it to start recording
  at the next quantize start point" [manual: [Logic Pro for iPad, Live Loops](https://support.apple.com/guide/logicpro-ipad/lpip7318102a/ipados)];
  in GarageBand "other cells playing when recording starts continue playing"
  [manual: [GarageBand for iPhone, record to cells](https://support.apple.com/guide/garageband-iphone/chsd0ccaf923/ios)].
- **Hardware grooveboxes** (EP-133, Maschine) record into the pattern that is looping: on the EP-133, "press
  (PLAY) to start the pattern then hold (RECORD) and hit the pads to record notes into the beat"
  [manual: [EP-133 guide, play and record](https://teenage.engineering/guides/ep-133/play-and-record)].

**Convention:** the take lands on the armed track, at the bars where you played it. The loop decides whether it
repeats. **Overdub adopts it** and drops the separate Keep step for anything recorded with R.

### 2.2 Count-in and pre-roll

- Live: count-in None, 1, 2 or 4 bars, from the metronome's menu; "The count-in runs from negative
  bars-beats-sixteenths (beginning at -2.1.1., for example, with a Count-In setting of 2 bars) up to 1.1.1., at which
  point recording commences" [manual: [Live 12](https://www.ableton.com/en/live-manual/12/recording-new-clips/)].
- Logic: with Count-in on (Shift-K) "the playback begins before the playhead position, and when reaching the playhead
  position, Logic Pro switches to record mode", set in bars or beats (count-in) or seconds (pre-roll)
  [manual: [Logic Pro, metronome and count-in](https://support.apple.com/guide/logicpro/lgcpbc10f1ea/mac)].
- GarageBand: "the metronome includes a count-in that plays before recording starts, to help you get ready"
  [manual: [GarageBand for iPhone](https://support.apple.com/guide/garageband-iphone/chs392846e9/ios)].
- EP-133: "press and release (record) then press (play) to hear a four beat count-in and start recording"
  [manual: [EP-133](https://teenage.engineering/guides/ep-133/play-and-record)]. Maschine: Shift+REC turns count-in on
  [manual: [Maschine+ quick start](https://www.native-instruments.com/en/maschine-plus-quickstart/making-a-beat)].
- BandLab (web): a Count-in Duration in the metronome menu; R records, Space stops
  [manual: [BandLab Help, metronome](https://help.bandlab.com/hc/en-us/articles/115002960274-Using-the-Metronome)].

**Convention:** one bar, on by default, shown as negative time. Logic's pre-roll (you hear the song lead in) beats a
click-only count-in when there is song before the playhead [inference]. **Overdub:** one bar by default; the song
plays the bar before the playhead when there is one, clicks only otherwise; the position reads −1.4 … −1.1.

### 2.3 The metronome: audible and visual

- Every tool has an audible click with an accented downbeat and settings for sound, level, count-in and "only while
  recording" (Live's "Enable Only While Recording") [manual: [Live 12](https://www.ableton.com/en/live-manual/12/recording-new-clips/);
  [FL Studio, Recording](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/recording.htm)].
- **Why the visual must move.** People synchronise taps to a flashing light far worse than to a click: the rate
  limit is "less than 2.5 Hz (> 400 ms) with simple visual stimuli (flashes of light)" against 8-10 Hz for sound
  [study: Repp and colleagues, summarised in [Hove et al.](https://sccn.ucsd.edu/~jiversen/pdfs/hove_etal_2012.pdf)].
  But a continuously moving stimulus closes the gap: tapping to a bouncing ball "yielded variability that was not
  significantly larger than that with the auditory metronome" [study: [Hove, Iversen, Zhang & Repp, *Psychological
  Research* 2013](https://sccn.ucsd.edu/~jiversen/pdfs/hove_etal_2012.pdf)]. So: the visual metronome is a moving
  thing (a ball between beat cells, a cursor over a beat ruler), not a blinking dot. This matters doubly for people
  with headphones off, on a phone in a quiet room, or hard of hearing.
- **Timing the visual.** The Web Audio context reports `outputLatency` (buffer to the device) and `baseLatency`, and
  `getOutputTimestamp()` exists "for synchronizing animation data to audio"
  [manual: [MDN, AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)]. Overdub's
  `engine.beat` is already the *audible* beat (it allows for output latency and plugin delay), so any visual drawn
  from it in `frame(now)` lines up with what you hear.

### 2.4 Loop recording: layer or stack

- **Layer (overdub merge).** Live's Session record overdubs: "Successive MIDI notes build layer-by-layer while
  looping" [manual: [Live 12](https://www.ableton.com/en/live-manual/12/recording-new-clips/)]. Logic's MIDI cycle
  option **Merge** "merges newly recorded MIDI data in each cycle pass with previously recorded MIDI data … into a
  single MIDI region" [manual: [Logic Pro, MIDI recording settings](https://support.apple.com/guide/logicpro/lgcp411dd5c8/mac)].
  GarageBand: "When you record the Drums Touch Instrument, new recordings are merged with existing regions on the
  track. You can turn off merging using the track controls" [manual: [GarageBand for iPhone](https://support.apple.com/guide/garageband-iphone/chs392846e9/ios)].
  The grooveboxes all layer, with live erase: EP-133 "hold (ERASE) and the pad you wish to clear"
  [manual: [EP-133](https://teenage.engineering/guides/ep-133/play-and-record)]; Koala lets you "overdub pad hits
  into a pattern" with count-in and metronome [review: [Sound On Sound, Koala Sampler](https://www.soundonsound.com/reviews/elf-audio-koala-sampler)].
- **Stack (takes).** Live 11 and 12: "Recording over existing clips, either by recording individual passes or by
  recording in a loop, adds a new take lane for each pass"; the main lane plays, take lanes only in Audition Mode;
  Enter copies a take-lane selection to the main lane, Cmd+↑/↓ swaps the main lane's clip for the next or previous
  take [manual: [Live 12, Comping](https://www.ableton.com/en/live-manual/12/comping/)]. Logic: "a take folder
  containing the takes is created on the track", comped by swiping (Quick Swipe Comping, audio only)
  [manual: [Logic Pro for iPad, take folders](https://support.apple.com/guide/logicpro-ipad/lpipf8218b82/ipados)].
  Logic's MIDI options also include **Create Tracks** and **Create Tracks and Mute** per pass
  [manual: [Logic Pro](https://support.apple.com/guide/logicpro/lgcp411dd5c8/mac)]. GarageBand: "When multi-take
  recording is turned on, a new take is created each time the playhead starts over from the beginning of the song
  section", and without it "previous recordings … in the same track are replaced by the new recording"
  [manual: [GarageBand for iPhone](https://support.apple.com/guide/garageband-iphone/chs392846e9/ios)].
- **FL Studio** names the trap AJ fell into: with Loop record and **Blend recording** on, "each loop recording will be
  audible"; for takes, "select Loop record and deselect Blend record so recordings are muted when you press stop"
  [manual (search summary): [FL Studio, Audio Recording](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/recording_audio.htm)].

**Convention:** drums layer, everything else stacks takes, and the mode is one visible switch. **Overdub adopts
GarageBand's split** as the default, with Live's ⌘↑/⌘↓ to switch takes.

### 2.5 Punch in and out

Logic's Autopunch uses locators shown as "a red stripe in the middle third of the Bar ruler", so you "concentrate on
your playing, rather than on controlling Logic Pro" [manual: [Logic Pro 9, Audio Punch Recording](https://help.apple.com/logicpro/mac/9.1.6/en/logicpro/usermanual/chapter_14_section_15.html)];
Live's Punch-In and Punch-Out use the arrangement loop's start and end
[manual: [Live 12](https://www.ableton.com/en/live-manual/12/recording-new-clips/)]. Pressing record again while
playing is the punch on the fly everywhere. **Overdub:** the loop is the punch range (Live's way, one less concept);
R while playing punches in and out on the fly.

### 2.6 Retroactive capture

Live's Capture MIDI retrieves "recently played material without pre-arming" and detects tempo and loop length in a
new Set [manual: [Live 12](https://www.ableton.com/en/live-manual/12/recording-new-clips/)]. Logic's Flashback
Capture captures "your most recent MIDI performance, even if Logic Pro for iPad wasn't recording", playing or stopped
[manual: [Logic Pro for iPad](https://support.apple.com/guide/logicpro-ipad/lpip32b4ef1d/ipados)]. FL Studio's score
logger keeps the last 30 minutes, dumped with "Dump score log to selected pattern" [manual: [FL Studio, Tools menu](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/menu_tools.htm)].
Ableton Note shows what you played as ghost notes until you commit ("more visible, and for me more usable")
[review: [Sound On Sound, Ableton Note](https://www.soundonsound.com/reviews/ableton-note)]. Overdub's capture is
already this; what's missing is a one-key "into the song" (Shift+R) that uses the song beats it already stores.

### 2.7 Quantize on input, note repeat

Live's Record Quantization chooser aligns notes as they are recorded, and for Arrangement recording "quantization is a
separate undo step" [manual: [Live 12](https://www.ableton.com/en/live-manual/12/recording-new-clips/)]. Maschine's
Input Quantization is None, Record, or Play/Rec, and Note Repeat retriggers a held pad at a rate from 1/1 to 1/128
[manual: [Maschine+ manual, recording patterns](https://www.native-instruments.com/ni-tech-manuals/maschine-plus-manual/en/recording-patterns)].
FL's input quantize follows the global snap and can quantize only note starts
[manual: [FL Studio](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/recording_scores.htm)].
GarageBand quantizes per track and per section [manual: [GarageBand for iPhone](https://support.apple.com/guide/garageband-iphone/chs392846e9/ios)].
**Overdub:** pads quantize on input (1/16, as now); keys record your timing and Q quantizes after; both keep the raw
timing so quantize can be undone or changed. Live's separate undo step is the right shape: quantize is its own step.

### 2.8 Voice in context

Dubler 2's live triggers are fast; its pitch output "requires editing", and its MIDI Capture plugin lets you "lay down
a quick hummed or sung melody and get an instant, draggable MIDI pattern" [review: [MusicTech, Dubler 2](https://musictech.com/reviews/software-instruments/vochlea-dubler-2-review/)].
Melodyne corrects slow pitch drift separately from vibrato, then exports MIDI
[manual: [Melodyne 5, pitch drift](https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_ToolModulationDrift_2?env=dawsWithoutAra)].
None of them shows the hum on the song's timeline while you sing. Overdub's hum already places notes on the beats they
were sung against when the song plays (`hum.js` `takeOpts`); it needs the song to actually be playing (F6) and the
trace drawn in the lane.

### 2.9 Monitoring and latency

Live monitors armed tracks automatically ("auto-monitoring") and offers "Keep Monitoring Latency in Recording" for
device delay [manual: [Live 12](https://www.ableton.com/en/live-manual/12/recording-new-clips/)]. The standard
correction for recorded audio is a measured round trip (a loopback), entered as a record offset
[forum, practitioner: [Gearspace, loopback test](https://gearspace.com/threads/loopback-test-input-latency-compensation.1131610/)].
Overdub has both halves: `latency.js` (tap-along or loopback calibration) and the rule that `engine.beat` is the
audible beat. Keys and pads need no round trip (you press to what you hear); the mic does.

### 2.10 Stop, mute, panic

- **Panic.** MIDI's channel mode messages: "All Sound Off" (CC 120) turns oscillators off and sets "their volume
  envelopes … to zero as soon as possible"; "All Notes Off" (CC 123) releases notes
  [spec: [MIDI 1.0 message summary](https://midi.org/summary-of-midi-1-0-messages)]. A panic sends both, plus note-offs
  where instruments ignore them [inference, practitioner convention].
- **Per clip.** Live: the Clip Activator, or the 0 key, deactivates a clip so it does not play in Session or
  Arrangement [manual: [Live 12, Clip View](https://www.ableton.com/live-manual/12/clip-view/)]. Logic: Control–M
  mutes regions, which "appear gray" [manual: [Logic Pro, mute regions](https://help.apple.com/logicpro/mac/10.1/en.lproj/lgcp2217b80d.html)].
  FL Studio's Mute tool "mutes individual Clips. This is independent of the Track mute switch"
  [manual: [FL Studio, Playlist](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist.htm)].
- **Trim.** Every arranger trims by dragging a clip's edges; Live also crops a clip to its loop. The other agent's
  "Trim to the loop" is Live's crop.

### 2.11 The first minute for a beginner

GarageBand for Mac opens on a project chooser; an Empty Project asks for a track type (Software Instrument, Audio,
Drummer) before anything else [review: [The GarageBand Guide](https://thegaragebandguide.com/garageband-for-mac-beginner-guide)].
Its Drummer plays a part that can "follow another track" [manual: [GarageBand for Mac, Drummer](https://support.apple.com/guide/garageband/gbnd861ac1f3/mac)].
Chrome Music Lab's Song Maker is a grid that plays as a loop the moment you click a cell: no record button, no
take, no keep [review: [Chrome Unboxed](https://chromeunboxed.com/how-to-create-songs-with-chrome-music-lab)]. Ableton
Note lets you pick free length or one to eight bars, "with a pre-determined tempo and a click, or to record freeform
and have Note figure things out afterwards" [review: [Sound On Sound](https://www.soundonsound.com/reviews/ableton-note)].
**Lesson [inference]:** the beginner's loop should already be playing, with the click, before they make a sound, and
what they make should stay in it. Recording is something that is *on*, not a ceremony.

### 2.12 What Overdub takes from each

| Question | Convention | Overdub |
|---|---|---|
| Where does a take go? | the armed track, at the playhead (Live, Logic, GarageBand, BandLab) | the same; selecting a track arms it |
| How do I get ready? | count-in, 1 bar, as negative time (Live); pre-roll (Logic) | 1 bar, song pre-rolls if there is song, −1.4…−1.1 shown big |
| How do I keep time? | click with accent (all) | click + a moving ball and a sweeping cursor (Hove 2013) |
| Loop passes | drums merge, others replace or take (GarageBand); take lanes (Live, Logic) | drums Layer, others New take; ⌘↑/⌘↓ switch |
| Punch | locators (Logic), loop (Live) | the loop |
| After the fact | Capture MIDI, Flashback, score log | Shift+R, Put it in the song |
| Quantize | input quantize (Maschine, FL), separate undo step (Live) | pads on input, keys after; raw timing kept |
| Silence | panic; clip mute (0, Ctrl-M, Mute tool) | Shift+Esc; 0; Trim to the loop |

---

## 3. The spec

### 3.1 Principles

1. **Record means into the song.** If you pressed R, what you play lands on the timeline where you played it and is
   drawn there as it lands. It is in the song when you stop; undo takes it out. (Sketch keeps a copy of every take,
   always, so undo never loses an idea.)
2. **You can always see the beat.** Whenever you can record, a moving beat is on screen, and the click is one key
   away.
3. **Nothing doubles by accident.** Recording over material layers into it (drums) or takes its place (everything
   else, with the old part kept, muted). Never two parts playing over each other unless you chose that.
4. **One gesture per idea, the same everywhere.** R records keys, pads, hum, beatbox and audio. Space stops. The
   source is chosen by what you play, not by a mode you have to find.
5. **Every sound can be stopped.** The whole studio (Shift+Esc), one clip (0), one preview (its Stop), one take (⌘Z).

### 3.2 The model: track, source, recorder

**Target track.** The selected track is the record target ("auto-arm", Live's default for MIDI tracks). Its arm
button shows armed whenever it is the target; clicking another track's arm adds it only with ⌘ (Live's rule), which
is how you record keys and pads at once. With no suitable track, Record makes one and says so ("New track: Keys").
`input.target()` changes accordingly: the armed instrument track first, then the selected one; and **drum tracks are
never the target of keys** unless you arm one on purpose (F4).

**Sources**, by what the target track is and what you touch:

| Target | Sources | Default | Notes |
|---|---|---|---|
| instrument (pitched) | keys (MIDI, musical typing, touch keys), hum | keys | hum is chosen by pressing H, or Hum in Sketch; it asks for the mic once |
| instrument (drums) | pads (F J K L, on-screen, MIDI), beatbox | pads | beatbox is chosen in Tap it |
| audio | mic / interface | mic | input, channel, monitor as today (Sketch › Record) |

Pads always play the drum target: pressing a pad while a pitched track is armed records the pads onto the song's
drum track (or a new Drums track) as a second target for that take, and says so once ("Pads go to Drums").

**The recorder** (`input/recorder.js`, new) owns a take from R to commit. States:

```
idle ──R──▶ count ──(count-in ends)──▶ rec ──R / Space / killswitch / punch-out──▶ commit ──▶ idle
  ▲            │ Space / Shift+Esc: cancel (nothing recorded)        │ loop wrap: pass n+1 (layer or new take)
  └────────────┘                                                      ▼
                                     R while playing (no count-in) ──▶ rec
```

- **idle**: capture is always on (as now). Playing with the song stopped is a sketch (free time, to Takes).
  Playing while the song runs is captured with its song beats, ready for Shift+R.
- **count**: the transport runs from the playhead minus the count-in (pre-roll if there's song, clicks only below
  bar 1). Notes played in the count's last eighth count as the downbeat (people anticipate it), earlier ones are
  ignored for the take (kept in capture).
- **rec**: one pass per loop cycle (or one pass, loop off). Each pass is drawn live in the lane.
- **commit**: one `store.dispatch` (one undo step) by `'you'`, labelled "record take 3 on Keys"; every pass also goes
  to `capture.add` (never lose a take). A pass with nothing in it adds nothing.

### 3.3 The first minute (a beginner, desktop or phone)

1. **Open.** The first-run screen ("Take 1 is yours", FRESH-EYES item 1) has four doors: Tap a beat, Play it, Hum it,
   Ask your agent. On a returning visit, the song opens as today.
2. **Tap a beat.** The song gets a Drums track if it has none; the loop is set to bars 1-2 if it is off; the click
   turns on; the Sketch pane opens on Tap it; the pads light. Nothing records yet; the header says **"Press R (or the
   ● button) and tap along."** The ball is already moving, so they see the tempo before they play.
3. **R.** One bar of count-in: the ball travels, the big numeral counts 4 3 2 1 in the lane and over the pads. Then
   the loop plays. Each tap sounds, appears on the beat ruler under the pads and in the Drums lane on the beat it
   landed. At the wrap, pass 2 starts: pass 1's hits stay (dimmer), new hits layer in.
4. **Space.** The take is in: "Your beat is in: 2 bars, 14 hits on Drums. Undo takes it back." Selected, flashed
   warm. The click stays on; the loop keeps its place.
5. **Play it over it** (the next door, offered in the toast and in Sketch): Keys is armed, musical typing turns on,
   the same loop plays. R: count-in, play; each pass is a new take; Space keeps the last one, earlier passes sit
   under it.
6. **Ask your agent** (unchanged): it plays over what you recorded.

No step asks the beginner to understand arming, Keep, Sketch modes or the capture log. Those are there when they look.

### 3.4 Gestures and keys

Existing keys were checked (every `ui.keys.add` in `app/src`, plus the killswitch work in the tree). New keys marked
**new**; nothing collides.

| Key | Action | Notes |
|---|---|---|
| **R** | idle: count-in, then record. rec: punch out (stop recording, keep playing). count: cancel. | changed (today: audio only) |
| **Space** | play / stop; during rec: stop and commit; during count: cancel | changed |
| **Shift+R** | **new**: Put it in the song: the last captured phrase onto the target, at the beats played (or at the playhead bar if played in free time) | Live's Capture |
| **M** | click on / off | unchanged |
| **Shift+M** | **new**: count-in: 1 bar → 2 bars → off | no collision (Mixer's M is M only, when the mixer is focused) |
| **L** | loop on / off (the loop is the punch range) | unchanged |
| **⌘↑ / ⌘↓** (Ctrl on Windows) | **new**: the selected clip's previous / next take | arranger; free in every panel (Notes uses plain, Shift and Alt arrows) |
| **0** | mute / unmute the selected clips | from the killswitch work |
| **Shift+Esc** | silence everything (stops and keeps any take in progress) | from the killswitch work |
| **Q** | quantize the selected notes (Notes) | unchanged; also offered on a fresh take's toast |
| **H / T / \`** | hum, tap, musical typing: choose the source and open its pane. While **rec**, H starts or stops the hum pass in place. | H now honours the song playing (F6) |
| **F J K L** | pads (while Tap is on) | unchanged |
| **Esc** | unchanged (leaves Tap / typing, stops a hum). It does **not** stop a recording: R and Space do. | avoids five existing Esc handlers |

On a phone: the record button in the top bar and a big **● Record / ■ Stop** pinned at the bottom of the Sketch sheet
(the same footer FRESH-EYES item 2 asked for Hum); Shift-keys have buttons in the record popover.

### 3.5 Count-in

- **Default:** 1 bar. Options: off, 1, 2 bars (`overdub:record` in localStorage, per browser; not in the song).
- **Pre-roll:** if the playhead is at beat b ≥ one count length, the song plays from b − count (you hear what you're
  coming in on); otherwise the clicks play alone for the part below bar 1. The click always sounds during the
  count-in, even with the metronome off (Live and Logic do the same).
- **Visual:** the position display reads **−1.4, −1.3, −1.2, −1.1** in `--rec`; the beat ball travels; a numeral
  (display face, 48 px, `--text`, 70% opacity, fading over the beat) counts **4 3 2 1** (the meter's beats; 3 for 3/4,
  6 for 6/8 in eighths) at the playhead over the target lane, and over the pads or keys in Sketch.
- **R while already playing:** no count-in; recording starts now (punch on the fly). The clip's start is floored to
  the bar it began in (as `capture.js` does), so a late punch still makes a clip that starts on a bar.

### 3.6 The metronome you can see

Three views of one beat, all drawn from `engine.beat` (the audible beat) in `frame(now)`:

1. **The beat ball (transport, always visible while playing).** Beside the position display: one cell per beat of the
   bar (4 for 4/4; 6/8 shows 6), each cell 10x10 px, 4 px apart, outline `--line-2`; the downbeat cell slightly
   larger (12 px). A 6 px dot in `--text` (in `--rec` during count-in and recording) travels from cell to cell along a
   shallow arc (max 5 px high, a parabola over each beat: it is lowest, *on* the cell, exactly at the beat), so the
   eye can predict the next beat. Reduced motion: the dot steps from cell to cell with no arc. Stopped: the dot rests
   on cell 1. The metronome toggle sits right of it; the ball shows whether or not the click is on.
2. **The beat ruler (where you play: Sketch's Tap it, Play it and Hum it).** It is anchored to the song, not to your
   first hit: it shows the loop's bars (or the two bars from the playhead's bar when the loop is off), numbered with
   the song's bar numbers. A cursor (1.5 px, `--accent`, with its glow) sweeps across it; beat lines brighten for
   120 ms as the cursor crosses them. Each hit appears **the moment it lands** as two marks: a 2 px tick at its raw
   time, and the grid cell it snapped to filled in the track's colour. The current pass draws at full strength,
   earlier passes at 45%. After each pass a small mono readout says how you played against the click: "Pass 2 · 16
   hits · 9 ms late on average" (the engineer's number; no grade).
3. **The lane (arranger).** See 3.11: the take grows in the target lane under the playhead.

**Click options** (the popover on the metronome button's caret): click on/off, only while recording, count-in
(off/1/2), level. The engine's click is already off the mix and the render; keep it that way.

### 3.7 Where takes land, and recording over clips

- **Empty span on the target:** a new clip from the bar the take began in to the end of the bar it ended in (or the
  punch range).
- **Over an existing clip, Layer mode:** the notes go **into that clip** (`notes.add`, signed by you); no second
  clip, no doubling. Where the take runs past the clip, the rest becomes a new clip.
- **Over an existing clip, New take mode:** the take becomes the playing clip for its span; the parts of the clips it
  covers are split at the take's edges (`planClipSplit`) and **muted** (`clip.mute`), and joined to the take's stack
  (3.8). Nothing is deleted. One undo step restores everything.
- **Hum in Layer mode** is allowed (harmonies over your own line) but never the default.
- **Audio** always stacks (an audio take cannot merge).

### 3.8 Loop recording: Layer or New take

With the loop on and the playhead inside it (or R pressed before it: the pre-roll runs up to the loop start), the
recorder records every pass until you stop.

| Mode | Default for | Each pass | At stop |
|---|---|---|---|
| **Layer** | pads, beatbox, MIDI drums | adds its notes to the same clip; earlier passes keep playing (you hear what you've built) | one clip with every pass's notes |
| **New take** | keys, hum, audio | the pass becomes the newest take; earlier passes are muted at the wrap so you play over the song, not over yourself | the last pass plays; earlier passes are in the take stack, muted |

The switch sits on the record popover and in Sketch's header: **Each pass: Layer · New take**, with the default per
source restored when the source changes (a choice you make sticks for that track while the song is open).

**Take stacks.** Clips that share a take group (`clip.take`, 3.15) are drawn as one clip with a mono badge "3 takes"
in its top right; the playing one is the visible clip, the muted ones are not drawn in the lane. ⌘↑ / ⌘↓ (or the
badge's menu: Take 1 … Take 3, each with Hold to hear and Use) swaps which take plays: one `clip.set { mute }` pair,
one undo step. "Show takes" in the menu expands the track to one sub-lane per take (wave 3; comping by
split-and-pick comes after, not in this plan).

**Discarding a pass while recording:** ⌘Z during rec undoes the last *completed* pass (it is removed from the take,
kept in capture); the current pass keeps recording. This is the closest to the EP-133's live erase that stays
undo-friendly; a live erase for pads (hold Backspace + pad) is a later idea.

**Long takes** (AJ's "the whole thing plays"): with the loop on, a long take is passes, not one long clip. With the
loop off, a take ends where you stopped; the toast offers the two moves that matter: "Take 4 is in: 46 bars on Guitar.
**Trim** (to the loop or the selection) · **Mute** (0)". And from the killswitch work, a take's Hear button in Takes is
a Stop while it plays.

### 3.9 Punch in and out

- The **loop is the punch range** when the loop is on and you start before or inside it: recording only happens
  between loop start and loop end; the pre-roll plays the song before it. Drawn as a red line along the ruler's loop
  bar (`--rec`, 2 px, over the loop's `--accent-2`) while armed and recording.
- With the loop off: R while playing punches in, R again punches out (the transport keeps going), Space stops.
- Today's silent punch-out at the loop end in `audioin.js` becomes a loop pass (New take), visible and documented.

### 3.10 Quantize on input

- **Pads and beatbox:** quantized on input to the Sketch grid (1/16 default, 1/8), as now; the raw tick still shows
  on the ruler, and raw times are kept in the take (`raw` per note) so "My timing" can restore them.
- **Keys:** recorded as played. The commit toast offers "Quantize to 1/16" (one more undo step, as in Live). On a
  touch keyboard, input quantize is on (1/16): fingers on glass are late and loose.
- **Hum:** as now (grid, snap to key with every move shown), transcribed per pass.

### 3.11 Per source

- **Keys** (MIDI, typing, touch). Notes sound through the target's instrument with no added delay; each note is
  placed at `engine.beat` at its event (corrected by `performance.now() − event.timeStamp` so main-thread lag doesn't
  push notes late). In the lane: each note draws at note-on as a growing bar, ending at note-off.
- **Pads** (F J K L, on-screen pads, MIDI drums). As keys, with input quantize. In the lane: a hit draws as a short
  block in its drum row (the lane shows 4 rows while recording a drum track).
- **Beatbox.** Hits are detected live (`tap.js` already emits live hits) and drawn at their audible time minus the
  round trip; the final hits come from the offline pass at each wrap (as now at stop). Layer mode.
- **Hum.** H (or Hum it) while the song plays or a take records: the pitch trace draws in the lane under the playhead
  (a 1.5 px line in `--text-2`), ghost notes form as segments settle (every 240 ms, as now), and each pass is
  transcribed at its wrap and committed as notes. The spiral stays in Sketch. "With song" goes: the hum is in the song
  whenever the song is playing (F6), and in free time when it isn't.
- **Audio.** As today's Sketch › Record, through the recorder: input meter on the target's header, monitor through
  the track's chain, waveform peaks drawn live in the lane (one column per 20 ms from the capture worklet), the round
  trip taken off at commit. Takes stack.

### 3.12 Stopping sounds (the base, from the killswitch work)

- **Shift+Esc / the speaker button:** `engine.silence()`: transport stops, every note, tail, click and preview cut in
  about 20 ms, devices renewed. **During a take, it commits what was recorded** (never lose an idea) and the toast says
  "Silenced. Take 2 kept on Keys (bars 5–8)."
- **0 / Mute in the clip menu:** the clip stays, greyed and hatched, plays nowhere (live, render, export).
- **Trim to the loop** (clip menu) and edge drags: the long-take fix.
- **A take's Hear button** in Takes is Stop while it plays.
- **Add:** muting the clip under the playhead takes effect at once (the engine already releases notes of a removed
  clip inside its lookahead; a muted clip must behave the same, and fade an audio clip out over 10 ms).
- **Add:** a muted take is drawn as part of its stack (3.8), not as a hatched clip, so a stack of five takes doesn't
  look like five broken clips.

### 3.13 What Sketch becomes

Sketch stays the **instrument you play from and the notebook that never forgets**: the pads, the keys, the hum
spiral, the input meter, and the Takes column (every pass of every recording, every free-time phrase). It changes in
four ways:

1. **Its footer is the record strip** in every mode: **● Record** (R) · target ("→ Keys", a select) · Each pass:
   Layer · New take · count-in chip (1 bar) · click chip. Tap it's Done button and Hum it's With song chip go.
2. **Its canvas is the song-anchored beat ruler** (3.6) whenever the song is playing or a take is recording; the
   free-time view (first note on the downbeat) only when the transport is stopped.
3. **Every take card gets Put it in the song** (Shift+R for the newest), which replaces Keep as the primary action:
   a take played with the song goes back to the exact beats; a free-time take goes to the playhead bar on the target
   (or bar 1 of an empty track, FRESH-EYES item 2). "Keep on…" stays in the card's menu for another track.
4. **Takes recorded with R are marked "in the song"** with the track and bars ("Keys · bars 5–8"), and clicking that
   label reveals the clip in the arranger.

### 3.14 Visual details (precise)

All colours are tokens; the look itself is wave 10's (the new direction). **Do not mark authorship with a coloured
stripe down the left edge of a box** (AJ's "AI smell"); the authorship mark on notes and clips comes from the new
look (see `docs/research/AI-SMELLS.md`).

- **Record button (transport):** idle: ring in `--line-2` with a `--rec` dot. count: the dot blinks once per beat
  (on the beat, 80 ms). rec: filled `--rec`, the label "REC" in mono beside the position display. Never pulses
  continuously (a constant pulse is noise).
- **Target track header while armed:** arm button filled `--rec`; a 2 px input meter along the header's bottom edge
  (`--ok` → `--warn` → `--bad` over the last 6 dB).
- **The recording region in the lane:** from the punch-in point to the playhead, a band at `--rec` 10% fill with
  1 px `--rec` lines top and bottom (not left), growing with the playhead. Current-pass notes in the track colour,
  earlier passes at 45%. Audio: peaks in `--text-2`. Hum: trace in `--text-2`, ghost notes outlined dashed until the
  pass is transcribed.
- **Count-in numeral:** see 3.5. **Punch range:** see 3.9.
- **Commit:** the new clip flashes as today (`arranger.show`), the band fades over 200 ms into the clip.
- **Reduced motion:** no arc, no flash, no fade; everything else the same.

### 3.15 Data and ops

- **`clip.take`** (new optional field, string `tk_` + 6 base36): the take group. `normClip` keeps it; `clip.add`
  accepts it; `clip.set` may set or clear it. Older readers skip it; a song without it is unchanged.
- **`clip.mute`** (in the tree from the killswitch work) is how a take is silenced.
- **No new op.** A commit is `clip.add` / `notes.add` / `clip.set { mute, take }` / split ops in one transaction.
- **`capture` phrases** gain `{ take, pass, rec: true }` so the Takes column can say "in the song" and ⌘Z during a
  take can find the pass.
- **Agent tools.** `get_capture` and the project text show takes ("clip … (take 2 of 3, muted)"). Add
  `get_recording` (read: idle / count / rec, target track, bars, pass). While a take records, tools that edit the
  target track or time (tempo, meter, loop, `time.*`, sections) return `{ error: 'recording', hint: 'You are recording
  on Keys (bars 5–8). Try again when the take stops.' }`; edits to other tracks go through (the engine takes edits
  inside its lookahead). The in-app agent queues its next turn until the take stops (UX-RESEARCH: never interrupt a
  take).

### 3.16 Edge cases

- **Latency.** Keys and pads: placed at the audible beat at the event (no round trip). Mic: the measured round trip,
  or the browser's guess with "measured" or "guess" shown (as now in Sketch › Record). If `outputLatency` is over
  80 ms (Bluetooth headphones), say once: "These headphones add about 180 ms. Your notes still land where you heard
  the beat; what you hear of yourself will feel late. Wired headphones fix it."
- **Recording over clips:** 3.7. **Recording past the song's end:** the transport keeps running while recording
  (no auto-stop at the last clip); the song grows.
- **Tempo, meter, loop edits during a take:** disabled (the controls dim, with "after the take" in their title).
- **Seek during a take:** clicking the ruler while recording punches out first (commit), then seeks.
- **Empty take:** nothing added; "Nothing played in that take." in the status, no toast.
- **Mic denied:** "The mic is blocked. Allow it from the address bar, then press R again." Keys and pads still work.
- **Hidden tab / suspended context:** the recorder commits what it has and stops.
- **Two inputs at once:** typing and a MIDI keyboard both record to the target; pads to the drum target.
- **Musical typing vs pads:** the home row is either typing or pads (`input.mode`), never both; the record strip says
  which.
- **Phones:** touch latency is higher, so pads quantize on input and touch keys too; the Record/Stop button is pinned
  at the bottom of the sheet; the count-in numeral shows over the pads; the take lane scrolls into view at commit
  (FRESH-EYES phone item 6); no Shift-keys are needed for anything.
- **Share links and renders:** muted takes travel and render silent (they are muted clips); `take` is a plain field.
- **Undo after commit:** one ⌘Z removes the whole take (every pass); capture keeps it in Takes.

### 3.17 Copy

The engineer behind the glass ([BRAND.md](../BRAND.md)): what was recorded, what changed, the number.

- Commit, layer: "Your beat is in: 2 bars, 14 hits on Drums. Undo takes it back."
- Commit, takes: "Take 3 is in on Keys, bars 5–8. Two more underneath: ⌘↑ ⌘↓ to switch."
- Pass readout: "Pass 2 · 16 hits · 9 ms late on average"
- Shift+R: "Put in the song: 9 notes on Keys at bars 5–6, where you played them."
- No target: "New track: Keys. Press R again to record."
- Long take: "Take 4 is in: 46 bars on Guitar." with actions Trim · Mute.
- Killswitch in a take: "Silenced. Take 2 kept on Keys (bars 5–8)."

---

## 4. Build plan

Two waves. Wave A (engine and input core) has no visible UI beyond what tests need; wave B draws it. Each wave ends
green (`PAR=3 node tools/run-all.js`). The killswitch, clip mute and trim to the loop (in the tree now) land first and
are the base. No golden hash moves: the click is never in a render, and new fields don't change existing songs.

### Wave A: engine and input core (two builders in parallel, one contract)

The contract goes into [ARCHITECTURE.md](../ARCHITECTURE.md) first (the engine and capture sections), so both
builders code against it.

**A1, engine** (`app/src/engine/engine.js`, `clock.js`, `schedule.js`, `strip.js`)
- `engine.play(from, { countIn: { beats, preroll } })`: the transport starts `beats` before `from`; below beat 0 only
  clicks sound (the click forced on for the count), above it the song pre-rolls. `engine.beat` runs negative during
  the count; `engine.counting` = `{ until }` or null; a `'transport'` event `why: 'countin-end'` at the audible
  downbeat.
- Click options: `engine.click = { on, whileRecording, level }` (`engine.metronome` stays as the on/off alias);
  accent on bar starts as now.
- `engine.beatAt(perfMs)`: the audible beat at a `performance.now()` time (for `event.timeStamp`).
- `engine.recording = true` holds the transport past the song's end; the `'transport'` `'loop'` event (it exists)
  carries the pass boundary beat.
- Muted clips release inside the lookahead like removed ones (3.12), with a 10 ms fade for audio.
- Tests: `tools/engine-test.js` grows count-in (negative beats, clicks only below 0, pre-roll sounds), `beatAt`, and
  mute-while-playing.

**A2, input core** (`app/src/input/recorder.js` new, `index.js`, `capture.js`, `tap.js`, `hum.js`, `audioin.js`,
`latency.js`; plus the `take` field in `app/src/core/ops.js` and `core/project.js`)
- `recorder.js`: the state machine (3.2), sources (keys, pads, beatbox, hum, mic) as adapters over the existing
  modules, passes on the loop event, Layer / New take commit plans (3.7, 3.8) built with `core/arrangement.js`'s
  split planner, one dispatch per commit, every pass to `capture.add`. API:
  `app.input.recorder = { state, target, record(opts), stop(opts), cancel(), capture(id?), live(), passes(), on(type, fn) }`
  with `live()` returning `{ track, source, from, now, passes: [{ n, notes, hits, peaks, trace, raw }], counting }`
  for the UI to draw.
- `index.js`: `target()` per 3.2 (armed first, never keys onto drums by accident); H honours a playing song and
  records a hum pass when a take is running (F6).
- `audioin.js`: recording goes through the recorder; its silent loop-end punch-out becomes passes (F9).
- `tap.js`, `hum.js`: per-pass hooks (beatbox's live hits, hum's segments) and `raw` timing kept.
- `capture.js`: the beat placement (`closeCur`'s three ways) becomes a pure helper the recorder shares; phrases gain
  `take`, `pass`, `rec`.
- Agent guard (`app/src/agent/tools.js`, small): the recording refusal and `get_recording` (3.15).
- Tests: a new `tools/record-test.js` (browser, real key events against the running song): R at bar 5 with count-in
  puts notes at bar 5 ±1/32; Layer over the demo's Beat adds notes to that clip (no second clip); New take mutes the
  covered part; two loop passes give one clip (pads) or two takes (keys); punch ignores notes outside the loop;
  Shift+R places a played-along phrase at its beats; the killswitch during a take commits it; an agent edit to the
  target while recording is refused; a hum from a synthesized file (as `hum-bench.js` makes them) with the song
  playing lands on the right bar. `tools/core-test.js` for the `take` field round trip and undo.

### Wave B: the UI (three builders in parallel, after wave A merges; in the new look from wave 10)

**B1, transport and shell** (`app/src/ui/transport.js`, `app/src/ui/shell.js`, `app/src/ui/onboard.js`)
- Record button states (3.14), R / Space / Shift+R / Shift+M behaviour (3.4), the count-in readout (−1.4…), the
  beat ball, the click popover (on, only while recording, count-in, level), dimming tempo / meter / loop during a take.
- `onboard.js`: the first minute (3.3) as the Take one tour's first steps; the first-run screen's four doors.
- Phone top bar: the beat ball fits beside the position (two-row bar).

**B2, arranger** (`app/src/ui/arranger.js`, `app/src/ui/arrange-kit.js`)
- The recording region, live notes, hits, peaks and hum trace in the target lane (3.11, 3.14), the count-in numeral,
  the punch line on the ruler, the armed header's input meter.
- Take stacks: the badge, the take menu, ⌘↑ / ⌘↓, muted takes hidden from the lane; "Show takes" sub-lanes may slip to
  wave 3.
- Auto-arm on select; ⌘-click arms more than one.

**B3, Sketch** (`app/src/ui/sketch.js`, `app/src/ui/spiral.js` if the hum view needs it)
- The record strip footer in every mode (3.13); the song-anchored beat ruler with the sweeping cursor, raw ticks and
  snapped cells, earlier passes dimmed, the pass readout (3.6); Put it in the song as the take card's primary action;
  "in the song · Keys · bars 5–8" labels; With song and Done removed; the pinned Record/Stop on phones.

**Checks for wave B:** `record-test.js` grows screenshots of count-in, mid-take (lane and ruler), commit, a take stack
and the phone; `a11y-test.js` (the ball is `aria-hidden`; the count-in and commits are announced with
`ui.announce`); `phone-test.js` (Record/Stop reachable, 44 px); the keys overlay lists the new keys; then a fresh-eyes
pass (wave 12) with the same script as section 1: tap, type and hum into bar 5 of Night Shift, loop-record two
passes, stop a long take, silence everything.

### Ownership summary

| Builder | Files | Depends on |
|---|---|---|
| A1 engine | `engine/engine.js`, `engine/clock.js`, `engine/schedule.js`, `engine/strip.js`, `tools/engine-test.js` | the contract |
| A2 input core | `input/recorder.js` (new), `input/index.js`, `input/capture.js`, `input/tap.js`, `input/hum.js`, `input/audioin.js`, `input/latency.js`, `core/ops.js`, `core/project.js`, `agent/tools.js` (guard), `tools/record-test.js` (new), `tools/core-test.js` | the contract; A1's `play({ countIn })` (stub it until A1 lands) |
| B1 transport | `ui/transport.js`, `ui/shell.js`, `ui/onboard.js` | wave A |
| B2 arranger | `ui/arranger.js`, `ui/arrange-kit.js` | wave A |
| B3 Sketch | `ui/sketch.js`, `ui/spiral.js` | wave A |

Docs after wave B: GUIDE.md (Record in the song, the click, takes, silence), AGENTS.md (`get_recording`, the
refusal), ARCHITECTURE.md (recorder, `clip.take`, keys), and `node tools/docs-build.js`; the tool count in public
copy moves by one (`get_recording`), so the counts pass runs.

---

## 5. Open questions for AJ

1. **Layer as the default for drums, New take for the rest** (GarageBand's split). Or one default everywhere?
   "Overdub" as a name argues for Layer; AJ's "the whole thing plays" argues for takes.
2. **Auto-arm on select.** It removes a step for beginners; it means clicking a track changes where R records. Live
   does it for MIDI tracks; Logic doesn't by default.
3. **Count-in pre-roll** (hear the song lead in) or clicks only (Live's default)?
4. **First run:** start the beginner on Tap a beat with a loop already playing (3.3), or on the demo song as today?

---

## 6. Sources

Manuals and help pages
- Ableton Live 12 manual: [Recording New Clips](https://www.ableton.com/en/live-manual/12/recording-new-clips/), [Comping](https://www.ableton.com/en/live-manual/12/comping/), [Clip View](https://www.ableton.com/live-manual/12/clip-view/), [Keyboard Shortcuts](https://www.ableton.com/live-manual/12/live-keyboard-shortcuts/)
- Logic Pro for Mac: [MIDI recording settings](https://support.apple.com/guide/logicpro/lgcp411dd5c8/mac), [metronome and count-in](https://support.apple.com/guide/logicpro/lgcpbc10f1ea/mac), [mute regions](https://help.apple.com/logicpro/mac/10.1/en.lproj/lgcp2217b80d.html), [Audio Punch Recording (Logic 9)](https://help.apple.com/logicpro/mac/9.1.6/en/logicpro/usermanual/chapter_14_section_15.html)
- Logic Pro for iPad: [take folders and Quick Swipe Comping](https://support.apple.com/guide/logicpro-ipad/lpipf8218b82/ipados), [Flashback Capture](https://support.apple.com/guide/logicpro-ipad/lpip32b4ef1d/ipados), [Live Loops cell recording](https://support.apple.com/guide/logicpro-ipad/lpip7318102a/ipados)
- GarageBand for iPhone: [record a Touch Instrument](https://support.apple.com/guide/garageband-iphone/chs392846e9/ios), [record to Live Loops cells](https://support.apple.com/guide/garageband-iphone/chsd0ccaf923/ios); GarageBand for Mac: [Drummer, follow a track](https://support.apple.com/guide/garageband/gbnd861ac1f3/mac)
- FL Studio: [Recording Notes / MIDI](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/recording_scores.htm), [Audio Recording](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/recording_audio.htm), [Recording](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/recording.htm), [Tools menu (score log)](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/menu_tools.htm), [Playlist (Mute tool)](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist.htm)
- Teenage Engineering: [EP-133 guide, play and record](https://teenage.engineering/guides/ep-133/play-and-record)
- Native Instruments: [Maschine+ recording patterns](https://www.native-instruments.com/ni-tech-manuals/maschine-plus-manual/en/recording-patterns), [Maschine+ quick start](https://www.native-instruments.com/en/maschine-plus-quickstart/making-a-beat)
- BandLab: [Using the metronome](https://help.bandlab.com/hc/en-us/articles/115002960274-Using-the-Metronome)
- Celemony: [Melodyne 5, pitch modulation and drift](https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_ToolModulationDrift_2?env=dawsWithoutAra)
- MDN: [AudioContext (outputLatency, baseLatency, getOutputTimestamp)](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)
- MIDI Association: [Summary of MIDI 1.0 messages](https://midi.org/summary-of-midi-1-0-messages)

Reviews and practitioner sources
- Sound On Sound: [Ableton Note](https://www.soundonsound.com/reviews/ableton-note), [Koala Sampler](https://www.soundonsound.com/reviews/elf-audio-koala-sampler)
- MusicTech: [Vochlea Dubler 2](https://musictech.com/reviews/software-instruments/vochlea-dubler-2-review/)
- [The GarageBand Guide, beginner guide](https://thegaragebandguide.com/garageband-for-mac-beginner-guide); [Chrome Unboxed, Song Maker](https://chromeunboxed.com/how-to-create-songs-with-chrome-music-lab); [Gearspace, loopback test](https://gearspace.com/threads/loopback-test-input-latency-compensation.1131610/)

Research
- Hove, M. J., Iversen, J. R., Zhang, A., & Repp, B. H. (2013). Synchronization with competing visual and auditory
  rhythms: bouncing ball meets metronome. *Psychological Research*, 77(4). [PDF](https://sccn.ucsd.edu/~jiversen/pdfs/hove_etal_2012.pdf)
  (also summarises Repp's flash-versus-tone findings).

Caveats: the Koala, EP-133 and Maschine details come from the vendors' pages and reviews read through search
summaries and page fetches, not from the devices. FL Studio's Blend recording wording is from a search summary of
its manual page. Live's Capture MIDI help article returned 403; its behaviour is cited from the Live 12 manual.
