# The guide

Overdub is a studio for you and your agents. You lay down a take, your agent plays over it, you play over that, and
every take is signed: warm for you, cool for it. This page gets you from the door to a kept take in five minutes,
then shows where everything else lives. In the studio, `?` shows every key.

## Your first overdub in five minutes

1. **Open the studio.** [overdubstudio.com/app/](/app/) in Chrome, Safari or Firefox, on a computer or a phone.
   Nothing to install, no account. The first time, it opens on **Night Shift**, a finished song, with a card on who
   played what; the Song menu's **Demos** has more, in other genres. Nothing plays until you press something. **Make
   your own** on that card starts a blank song and **Take one**, a small card that walks you through the steps below.
   It waits for each one to really happen, and you can close it. It stays out of songs someone sends you, and closing
   it puts back the loop it set, unless you've changed that loop since. If you've used Overdub in this browser before,
   it opens where you left off. Everything is on screen, and [**Find anything**](#find-anything) (`⌘K`) gets you to
   any of it.
2. **Hear it first, if you like.** Press `Space` (on a phone, ▶ at the top). Warm parts were played by a person,
   cool ones by an agent. **New song** in the Song menu gives you a blank one.
3. **Lay down take one.** On a blank song the empty space is the door: [**Start a song**](#start-a-song) takes your
   first idea at any speed and keeps time for you. Or open the **Sketch** tab under the song and pick a way in:
   - **Hum it.** The **Hum** button (the browser asks for the mic first) counts in a bar with the click, then records
     your hum into the song; press it again (or `Space`) and it's in, on a track of its own (Melody), at the bars you
     sang it. The notes are drawn as you sing, gently on the grid: a note near an eighth goes there, one well off it
     keeps your timing. Once the song has a key (one you set, or a part in one; a beat alone doesn't give it one), notes
     between keys move into it, and it says how many ("Moved 2 notes into A minor"), with **Undo**. `H` hums on its
     own, into Sketch's **Takes**.
   - **Tap it.** `T`, then `F` `J` `K` `L` for kick, snare, hat and open hat. The pads work too. A tap goes to the
     nearest eighth when it's near one (80 ms late at 120 BPM is still on the beat), else to the nearest sixteenth.
   - **Play it.** `` ` `` turns on musical typing (`A` `S` `D`… are the white keys), or plug in a MIDI keyboard.
     Musical typing and a phone's keys have two helpers, on until you turn them off: what you play lands on the
     grid, and the keys play only the song's key. The line over the keys says so: *Snapping to 1/16, in C minor*.
     Click either part to turn it off, and it says what you get instead (*Your timing*, *every note*); click it again
     to turn it back on. This browser remembers. With no key set, it says what the keys play instead (*in C major*).
     A MIDI keyboard's notes stay as you play them.

   Capture is always on. Everything you hum, tap or play lands in the **Takes** list, so nothing is lost.
4. **Keep it.** **Keep as a clip** in Sketch, or **Keep** on the take in the Takes list. It lands on a track, signed
   by you. **Band** on a kept take (or `⇧B` on a selected clip) builds chords, bass and drums around it in a style
   you pick, on new tracks; your notes stay as they are, and one undo takes the band back.
5. **Ask the agent for a take.** Open the **Agent** tab (`A`; `⌘/` or `Ctrl+/` to type) and ask for something over
   it: *"Give me a bassline under this."* No agent on yet? Press **Try the demo agent (free)**, or just type: what
   you type stays in the box, and **Ask the demo agent** sends it. The demo agent is a scripted session, not a live
   model, but it uses the real tools, so everything it does is signed and undoable. It answers what it can, and when
   something is past its script it says so first, then offers the nearest thing it can on the part and bars you named.
6. **Keep one.** Its takes arrive as cards. **Hold to hear** plays one over yours; let go to go back. Keep the one
   you like.

That's an overdub. Take one is yours, take two is the agent's, and the **History** tab shows both, with the reason the
agent gave. `⌘Z` undoes the latest edit.
**Revert all Claude's changes (keep mine)** takes back everything the agent did and leaves your edits alone, and
`⇧⌘Z` puts it back, as it does after **Undo** on one of the agent's lines there.

## Start a song

Every blank song (**New song**, **Make your own**) opens on its door: **Tap a beat**, **Hum a tune** or **Play the
keys**, and, with no playing in time, **Draw a beat**, **Pick a groove** or **Ask** your agent. `↑` `↓` walk the three
ways. Nothing sounds until you press one, and the door never shows over a song with tracks in it.

**Tap a beat** opens a stage over the song. There's no click: tap `F` `J` `K` `L` (or the four pads; on a phone they
fire as your finger lands) at whatever speed feels right, and keep going round. Your first hit starts the clock and
the pads sound straight away. After six hits or so the BPM shows; after two bars' worth the bar lines fade in under
your hits; once you've played the same thing twice it counts the rounds. What you play most often is what's kept: a
hit you played in one round of three is left out, one you played in both of two rounds stays. **Done** (`Space`) puts
it in the song at once: the tempo, a Drums track, the clip and a loop over it, one undo step, signed by you.
**Start again** (`⌫`) clears it (the take stays in **Takes**). **Play to a click instead** is the older way: a Drums
track, two bars looping with the click, `R` to record.

Then it loops while you decide:

- **Timing**: **Tight** puts each hit where you meant it (an eighth when you're near one), **Loose** half way, **As
  played** keeps your feel, evened out to the tempo. `←` `→` step through them, the line says how many hits moved and
  by how much, and it's all still one undo step with the take.
- **Not quite?** If the studio isn't sure where the 1 is, it says so. The other ways your beat could go (the bar
  starting on another kick, or twice as slow) are listed, and picking one plays it at once. **Use this one** keeps it;
  `Esc` puts back what was there.
- **Hum over it** (`Enter`) is the next part: the stage folds away, the beat keeps looping and Sketch is on Hum.
  **Back to the song** (`Esc`) just folds it away.

**Hum a tune** starts a simple beat looping at 100 BPM so you have something to hum against. **Speed** (Slow 80, Easy
100, Upbeat 120) and **Beat** (Simple, Rock, Lo-fi) change what you hear, not the song. **Hum** (`H`) puts the beat in
the song and records your hum over it from the next bar line; `Space` stops, and the tune lands on a new Melody track.
**No beat; I'll hum freely** is Sketch's Hum in your own time. Headphones keep the beat out of your hum.

`Esc` before you've played anything closes the stage; after, it asks once (*Leave without keeping this take? It stays
in Takes.*). **Skip to the studio** is always top right. While you play on the stage, an agent's changes to the song
wait until it's in.

## Find anything

Everything is on screen: the song, the transport, the detail tabs under the song (Sketch, Notes, Beat, Grooves,
Devices, Mixer, Reference) and the Agent with History beside it. The Browser and the Inspector wait on the left: `B`
or their button opens them, and the studio remembers how you left it.

**Find anything** (`⌘K`, or `Ctrl+K`), at the right of the top bar, or at the end of the agent's tabs while that pane
is open, finds anything by name: type *piano roll*, *loop*, *faders* or *reverb*. `↑` `↓` choose and `Enter` goes.
Each row says what it is:

- **Go to** shows the panel or points at the control for a moment: *faders* goes to the **Mixer**.
- **Do** does what a key does, with the key beside it: *loop* finds **Loop on/off**, `L`.
- **Sound** tries an instrument on the selected track, with **Keep** and **Back** (it never swaps the sound out by
  itself). An effect, or an instrument with no track selected, opens the Browser on it.
- **Help** opens this guide at that heading.
- **Ask Claude**, the last row, sends what you typed to the agent (`⌘Enter`). Finding spends no tokens; only asking
  does.

Empty, Find lists every part of the studio by what it's for (Make, Sound, Balance, Song, Recording, Agent, Files,
Layout). `Esc` closes it. Ask the agent where something is (*"where's the mixer?"*) and it says where, and the demo
agent shows it.

## Record into the song

Press `R` (on a phone, the ● at the top). **A new idea goes on a new track**: a hum, a tune on the keys or a beat on
a song that has tracks lands on a track of its own (Melody, Keys or Drums) unless you picked one, and that track is
selected, so your next take of the same kind goes onto it. To record onto a track that's already there, pick it in
**Onto** (in Sketch's record strip, always shown; **A new track** is first) or select it after your last take. A hum
never goes onto a drum track unless you picked it. The track R records onto has its R lit in the arranger, and a new
one shows as a faint lane at the foot, *A new track, Lamp Tines*, until the take is in. In the full studio the armed
track still comes first, as it always has: arm a track and R records onto it; **A new track** in Onto disarms them,
and arming one by hand again wins. It records from the start marker, after one bar of count-in: the bar before the marker plays with the click (below bar
1, the click alone), the position counts −1.4 to −1.1 in red, and a big numeral over the track counts 4 3 2 1. `R`
or `Space` during the count calls it off. With the song already playing, `R` waits for a bar line with a whole bar to
come in on (a loop of 2 bars or less, the loop's top, so what you play first is its first bar): the position counts
down (−2.2 … −1.1) and the numeral counts the last bar, 4 3 2 1. Then whatever you play, tap or hum lands on that track at the bars where you played it;
musical typing and a phone's keys are snapped as they record, as the line over the keys says. `Space` stops and
keeps the take; `R` again punches out and the song plays on; `⌘Z` takes it back out.

- **Watch the ball.** Beside the position, a cell for each beat of the bar and a square that travels between them,
  landing on each beat as you hear it, so you can see the next one coming with the sound off. It goes red while a
  take counts in and records.
- **The beat in Sketch.** In Tap it and Hum it, Sketch's top line is the beat: a lamp for each beat of the bar (bar 1
  wider), lit on the beat you hear, red-edged while a take records; the count-in in big numerals counting up with the
  lamps, 1 2 3 4, so you come in right after the 4 (the beats it waits out before its bar are counted dimmer); what is
  recording ("Bars 1–2, time 2 round"); and **Click**. It is the one count on screen then: the track's numeral stays
  away.
- **Late or early all the way through.** Against the click, if you play every hit about the same amount late (waiting
  to hear the click, then hitting) or early, that one lean comes out of the whole take before each hit is placed, up to
  about 200 ms at 120 BPM, so a beat played 150 ms behind the click lands on its beats, not on the "and"s. The take
  says so ("You played about 150 ms behind the click, so your hits are on their beats; As played puts them back."), as
  does the line under the pads. A first hit or two that comes in late, on a drum you otherwise play on the beat, goes
  on its beat too. Hums against the click get the same.
- **No click: your own time.** Turn **Click** off there, over a song with nothing in it yet, and Record (or **Hum**)
  records at once, no count and nothing playing: tap or hum in your own time and press `Space`. Overdub finds the pulse
  in what you played (the tempo, a drift followed, your first note the downbeat), sets the song to your tempo and puts
  it in on its own track, one undo step for all of it. Over a song with parts, the song keeps its tempo and your beats
  become its beats.
- **Tight, Loose, As played.** After a take from Tap it or Hum it, the same line has its timing: **Tight** is where the
  grid put each hit, **As played** puts them back exactly where you played them, **Loose** half way (without the take's
  lean: your feel, not your lateness). Each is one undo step.
- **The click.** A take clicks even with the click off: that's *While recording* in the options under the caret
  beside **Click**, on until you turn it off. `K` turns the click on and off for everything, `⇧K` steps the count-in
  through 1 bar, 2 bars and off, and the options have the level too. They stay set in this browser. The click is
  never in the mix or an export.
- **Each pass round the loop.** The loop is the punch range. On a drum track each pass **Layer**s into one clip, so
  you add a little every time round; on any other track each pass is a **New take**. Sketch's record strip switches
  it (**Each pass**), per track. A note you start a hair before the loop comes round (less than a 32nd early) is the
  next pass's downbeat, on the grid or in your own timing. On a drum track, a hit you play again on the next pass
  replaces the one you missed (within a third of a beat of it, as played), so a miss never doubles; the line after
  each pass says how many hits were nudged into place and how many replaced a miss.
- **Takes.** A take covers the bars you played, from the bar you started in to where you stopped, and what played
  there before is muted under it, there and nowhere else. The passes and what was there before are one take folder:
  the clip says how many ("3 takes"), and that label lists them and plays the one you pick, with **Previous take**
  and **Next take** (`⌘↑` `⌘↓` on the selected clip), **Flatten to** the one playing (the others go) and
  **Delete**. The takes are numbered in the order you played them. The last complete pass plays; one you stopped
  halfway through waits underneath with the others. A tune that runs on over the loop's end stays one take: its last
  notes go to the loop's start, where they came round. A last pass that's only a fragment of the others waits under
  the fuller one.
- **Hum it in.** With Sketch on **Hum it**, `R` records the mic as a hum, count-in and all. A hum already going when
  you press `R` becomes the take's. When the take is in, notes it moved into the song's key are counted, as when you
  hum on your own ("Moved 2 notes into A minor, the song's key."), and **Undo** there puts them back as you sang them,
  leaving the take in.
- **Put it in the song.** Played something without recording? It's in Sketch's **Takes** list, and **Put it in the
  song** (`⇧R` for the newest) places it at the beats where you played it if the song was running, else at the
  marker's bar.
- **Tempo, meter and the loop wait** until the take stops (they dim while it runs).
- **The letter keys.** While musical typing or Tap has them, the line under the song's title says so ("Keys play
  Bass", with the key that stops it), and the keys they play on are notes: `K` and `L` aren't the click and the loop
  then, nor `S` solo in musical typing. Click that line to hand the keys back.
- **First time?** **Tap a beat** on the Take one card, or **Play to a click instead** on Start a song's stage, adds a Drums track if
  there is none, loops two bars with the click and starts them: press `R`, a bar counts in, and tap `F` `J` `K` `L`. While the song is
  shorter than 8 bars, **Make it 8 bars** (beside a kept take, and on the tour's last card) repeats it to 8: parts
  that don't fit evenly, like a 3-bar hum over a 2-bar beat, each come round on their own phrase. The coach's next
  card offers **Hum over it**: it makes the beat 8 bars so a tune has room, turns the click off while you hum, and
  puts Sketch on Hum it, onto a new track.

## Pick a sound

A take on a new track starts on a plain sound (Lamp Tines for a hum or the keys, Gobo Kit for a beat). Its sound is
yours to pick by ear:

- **What should this sound like?** After the first take on a track, a card plays your take straight away and lists
  the track's sound and up to four others that suit what you did (a hum gets Lamp Tines, Light Table, Music Stands
  and Choir Loft; a beat gets kits). `↓` and `↑` try the next one, `Enter` keeps it, `Esc` goes back. Trying isn't an
  edit: nothing is in History until you keep one, and one `⌘Z` takes the kept sound back. The take's note says
  *What should it sound like?* with **Sounds**, which opens the card.
- **In tune.** A hum on a new track, in a song whose key nobody chose, moves into the key you hummed in, and says how
  many notes moved, with **Undo**. On the card, **In tune** turns it off (*as sung*).
- **Sounds** on a track's header opens the card for that track any time; it's lit on a new track until you've opened
  it once. The track's instrument is on its header too: click the name to open it big, with its own controls, presets
  and a keyboard to play.
- **The browser tries before it changes anything.** A click on an instrument tries it on the selected track, with
  **Keep** and **Back**, and a double-click keeps it. A melodic instrument clicked with a drum track selected offers
  **New track with Light Table** instead of replacing the kit. Shift-click makes a new track; a drop onto a track
  keeps it at once, with Undo. Trying never moves your loop.
- **Ask the agent** (*"other sounds for Melody?"*, or **Ask Claude for others** on the card): it puts its suggestions on the
  card, each saying why, signed *suggested by Claude*. Nothing changes until you keep one, and the kept sound is yours.
  Name an instrument (*"make it a Choir Loft"*) and it sets it, and says what it was.
- Recording on a track while you're trying a sound keeps that sound first, and says so before the take starts.

## Shape the song

- **Where play starts.** Click a bar on the ruler or in a lane, or select some bars, and the start marker goes there
  (its bar number printed in reverse on the ruler). `Space` plays from it and `Space` again stops and goes back to it,
  so you can work a part bar by bar. `⇧Space` plays on from where it stopped, and `Home` puts the marker back at bar
  1 (so does a click on the position). With the loop on, `Space` still plays from the marker and cycles once the
  playhead reaches the loop: a marker before the loop plays into it and round, one past its end plays on. `R` records
  from the marker too. Each song keeps its marker in this browser.
- **Sections.** Right-click a section's name in the ruler (long-press on a phone): **Duplicate** (`⌘D`) copies it and
  its clips right after it and moves what follows; **Insert bars after** adds 1, 2, 4 or 8 empty bars across the song;
  **Delete these bars** takes them out, with what's in them, and closes the gap.
- **Clips.** Right-click a clip (on a phone, hold it and let go): **Repeat ×2** or **×4**, or **Split at playhead**
  (`⌘E`). Notes cut by a split keep the part that sounds on each side, and every note keeps its author.
- **Drop a clip on another** (drag it, or ⌥-drag a copy) and it takes those beats, as in Live: what was under it on
  that track is cut away there and kept on either side, or goes if the dropped clip covers it whole. `⌘Z` undoes the
  move and puts it all back in one go. A take folder under it is cut across all its takes, and the part after it is a
  folder of its own.
- **A take folder moves whole.** Drag any of its takes and all of them go along. On a comped folder (takes picked
  for different bars), a drag across the clip selects those bars; drag it by its label line (the name along the top)
  to move it.
- **Mute or solo a track.** `M` mutes the selected track and `S` solos it, from anywhere in the studio (with a clip
  selected, its track); the same key again unmutes or unsolos it. **M** and **S** on its header and its mixer strip do
  the same. On a phone, a tap anywhere on a track's header selects the track; **M** and **S** only take a tap on them.
- **Stop one part.** **Mute** (`0`, or the clip's menu) keeps a clip and silences it, even while the song plays:
  it is printed in outline, its name struck through and "muted" where its byline was, and it plays nowhere, not in
  the song, an export or a render. `0` again, or **Unmute**, brings it back.
- **A take that runs on.** Cut it down by dragging either edge, or with **Trim to the loop**: it keeps just the loop's
  bars, and what played under the part you cut off plays again. Mute and Trim work on every selected clip at once.
- **Too much sound.** **All off**, the red key at the right of the top bar (`⇧Esc`, from anywhere, even a text
  field), stops everything at once: every note, reverb and delay tail, preview and click, whoever started it.
- **A mix that clips.** The top bar's meter reads the mix before the master's safety clip. When the mix goes over
  0 dBFS, the bars turn red and the number becomes **Clipping 2.4 dB**, the amount the clip is shaving off. Press it
  to pull the master down by that much, with half a decibel to spare: one undo step. The mixer's master strip says
  the same.
- **Notes.** The piano roll's **Transform** menu works on the selected notes, or the whole clip: humanize, quantize,
  strum, arpeggiate, transpose in the key, double an octave up, chords from a melody, continue a phrase, fill a gap
  and more, sixteen in all. Each is one undo step, and the agent has the same set.
- **Notes as tab.** **Tab** in the Notes toolbar shows a pitched clip as guitar tab. It holds the same notes, so an edit
  in either view is an edit in both, and a part written as tab (a kept riff, tab an agent wrote) opens that way. Click
  a fret number to pick its note (`⇧` adds). Type a fret and the note moves there on its string, its pitch changing to
  match; `↑` and `↓` move it to the next string and keep the pitch. **Higher string**, **Lower string**, **Fret −1**
  and **Fret +1** do the same with a click. With Scale lock on, a fret outside the key is refused and the view says
  why. **Tuning** and **Capo** belong to the clip: changing them moves the fret numbers and leaves the pitches alone.
- **Presets.** An instrument with named sounds has a **Preset** line under its name in the Devices tab ("Preset
  Felt"). Pick one and every knob goes there, in one undo step; move a knob after and it says "Felt, edited". A device
  nobody has touched says **Default**, and a sound that is plainly one of the presets moved a little (a song built
  from it) names it the same way, "Sprocket, edited". The agent names the same sounds.
- **Open a device big.** **Open** on a device in the Devices tab (or a double-click on its name) opens it in its own
  window over the studio: every knob big, with its value, the presets (‹ › to step through them), **A** and **B** to
  compare two settings (each flip is one undo step), **On** for an effect, what it sends out as a scope, and for an
  instrument a keyboard along the bottom: click or drag along it to play, lower on a key for louder. The song, the
  transport and musical typing keep working while it's open, so you shape the sound as you play it. Drag the window
  by its top and size it from its corner; `Esc` or × closes it. When an agent turns a knob there, the knob flashes in
  its colour and the window says what moved. History names each knob in words, with where you left it ("Light Table:
  A pos 0.53"), and the studio's notes stand beside the window while it's open, or in its bar when there's no room,
  never over its knobs. On a phone it opens over the whole screen; on its side, its top is one row.
- **Drums.** Two kits are under Drums in **Add a track**, which lists every instrument by kind. **Gobo Kit** has a
  field kit, drum machines and a dusty sampler. **Studio A** is an acoustic kit in a big tracking room, miked like a
  record:
  - **The mics.** A close mic on every drum, a pair of overheads, a room pair and a crushed room, each a fader in the
    Devices tab: CLOSE, OH, ROOM, CRUSH, BLEED and SIZE.
  - **The drums.** KIT picks them: warm 70s maple, punchy birch, a small jazz kit, a big arena kit or a dead 70s kit.
    Every drum and cymbal has its own tune, decay and level.
  - **How it plays.** Harder strokes are brighter as well as louder, and no two strokes are alike.
  - **What it plays.** Besides the usual rows it plays rimshots, the ride's edge, the hats' edges and half-open
    hats, flams, drags, a roll for as long as you hold the note, and cymbal chokes. The Beat tab and the piano roll
    name every row by what the track's kit plays there, and **More rows** in the Beat tab adds any of them.
  - **Its window.** **Open** Studio A to see the kit drawn from above, each piece where it stands for the mics. Click
    a piece where you'd hit it: the middle, near the edge or the rim (a rimshot); the hats' tip or edge; the ride's
    bell, bow or edge. Lower on a piece is louder. Alt-click chokes a cymbal (on a touch screen, press and hold it),
    and drag up on the hats to open them (let go and the foot closes them). The pieces light as the song plays them.
    Click one to tune it, or to play every stroke it has from the keys beside the kit (hold **Roll** to roll). The
    mics are faders along the bottom, and **VIEW** turns the picture round with the stereo image. On a phone, tap the
    kit and scroll for the rest.
- **A real piano.** Parlour Upright, under Keys in **Add a track**, plays a recorded upright piano, every key from
  samples. The first song that uses it fetches them (the device says **Loading samples…** beside its name until
  they land) and the studio keeps them, so the next time it plays at once. **DYNAMICS** sets how far soft notes fall
  below hard ones, **RELEASE** how long a note takes to die once you let go, and a sustain pedal holds notes as on
  a piano. Its sources and licence are in [`docs/SOUNDS.md`](https://github.com/overdubstudio/overdub/blob/main/docs/SOUNDS.md).
- **A concert grand.** Full Stick, under Keys too, is a recorded grand with its lid open: Alexander Holm's Salamander
  Grand. Every note is cut to fit a 15 MB download, so a chord held under the pedal dies after three or four seconds;
  for long held chords, Parlour Upright rings longer. **DYNAMICS**, **RELEASE** and the pedal work as on the upright,
  and the **Half stick** preset is the lid lowered.
- **A synth to dig into.** Light Table is a wavetable synth. Each of its two oscillators sweeps through a table of
  waves (vowels, bells, organ drawbars, eight-bit pulses and more) as you turn its **POS** knob. Twelve more tables
  are recorded single cycles from AKWF: voices, electric pianos, organs, guitars, basses, strings, winds and more,
  nine waves each. A filter, three
  envelopes, four LFOs and eight mod slots move almost any knob for you. Start from a preset: its description begins
  with what it's for (Bass, Lead, Pad, Pluck, Keys, Arp or FX). The four **MACRO** knobs do nothing until a mod slot
  uses one.
- **Shape the tone.** Slide Rule is an EQ: put it on a track like any effect and open it, and you get its curve over
  the live spectrum of what comes in and what goes out. Double-click the line to place a band there, then drag the
  band's square for its frequency and gain (`⇧` for fine steps, `⌥` or the scroll wheel for how wide it is; on a
  phone, double-tap to place one and spread two fingers to widen it). Double-click a band to put it back to 0 dB.
  Right-click it (or hold it on a phone) for its shape (bell, shelves, cuts at 12, 24 or 48 dB per octave, notch,
  band pass), to switch it off, or for **Solo**: you hear only the part of the sound that band works on, so you can
  hear what you're cutting. `Tab` moves between bands and the arrow keys move them. **Auto gain** holds the level
  where it was, so you judge the tone and not the volume. Its presets are starting points ("Clean up the low end",
  "Vocal presence", "Air", "Telephone", "Kick: thump and click"), and each band's square is outlined in the colour of
  whoever set it last.
- **Pump, gate and pan in time.** Put **Scribble Strip** on a track (Add an effect, in the Devices tab) and **Open**
  it. Draw a shape and it moves the volume, a filter or the pan in time with the song: **Volume**, **Filter** and
  **Pan** are tabs, each its own shape, depth and rate (1/32 to 2 bars). Click to add a point, drag one to move it
  (`⇧` for off the grid), drag the small square on a line to bend it, right-click a point to make it a step or delete
  it; **Pencil** paints steps on the grid, and **Snap** sets the grid. The presets under it are drawn: Pump (quarter
  notes), Gate (sixteenths), Stutter, Swell over a bar, Auto-pan, Filter wobble and more. **Smooth** softens the edges
  so a hard step doesn't click (all the way down, it does). While the song plays, a green dot rides the line and says
  what it's doing there (−6.0 dB). With a point picked, the arrow keys move it, `Enter` makes it a step and `Delete`
  takes it out.
- **Light Table's window.** Open it big and each oscillator's table is drawn as a stack of its waves, the one it plays
  lit: drag up or down on the drawing (or turn **POS**) to move through them, and **3D**, **Wave** and **Harmonics**
  change how it's drawn. Click the table's name to pick another; each is drawn small with a few words on how it
  sounds. Under them, **AKWF single cycles** lists the recorded waves by family: pick a family, then a wave, and the
  oscillator plays it. Turn **POS** from there to morph into its neighbours.
- **Drag to modulate.** Every source has a jack, the small socket beside an envelope's or an LFO's name, under each
  macro, and beside Velocity, Note, Wheel and Random. Drag one onto a knob and the first free mod slot takes it: the
  knob gets a ring, and the ring's arc is how far the source moves it. Drag the ring up or down to change that, and
  right-click it to take it off. Each of these is one undo step. A click on a jack and then on a knob does the same
  (on a phone too, across tabs), and the **Mod matrix** tab lists all eight slots as sentences ("LFO 1 → A POS,
  +35%"). When all eight are in use, it says so. While the song plays, the table, the filter's curve and the rings
  show where things have moved to.
- **Make it loud and finished.** Put **Gaffer Tape** on a synth, a drum bus or a vocal and **Open** it. It hears the
  sound in three bands, low, mid and high, and in each it lifts the quiet detail up and holds the loud parts down.
  **Depth** is the big knob: how much of it you hear. It starts at 40%, about as loud as it came in; turn it up and it
  gets denser and louder. **Full depth**, **Drum smash** and **Vocal presence** make a part louder, by 1 to 3 LU on
  drums; **Subtle 30%**, **Glue (bus)** and **Bass tighten** keep it about level. Under Depth, while the song plays,
  the window says what it is doing to the level: the loudness coming out against what went in, in LU ("+2.1 LU,
  louder than it came in"; a part it takes a decibel or more off reads in yellow, and the window's top line says so
  too), with an In and an Out meter. Nothing it puts out goes over −1 dBTP. Each band draws its curve, level in to
  level out: drag the hollow square sideways to set where it starts holding down and the filled one for where it
  starts lifting (`⇧` for fine steps, a double-click puts one back). Drag the two lines on the strip above to move
  where the bands split. While the song plays, each band says how far it is holding down or lifting the sound, with a
  bar, and a green dot rides its curve where the band is now. **Time** makes every band react faster or slower; a
  fast **Attack** (under 5 ms) catches each hit's front, a slow one lets it through. Thresholds and splits take the
  arrow keys too.

## Grooves

The **Grooves** tab, beside Beat, is a drummer's book. The styles run down the side, from rock and funk to bossa, trap
and gospel. Each has grooves for the parts of a song: intro, verse, chorus, bridge, a half-time feel where it fits,
fills of a beat, two beats and a bar, and an ending. Each groove is drawn as a picture of its hits: the bigger the
mark, the harder the hit, and a hollow mark is a ghost note. They play with a feel, not on a grid: swing that tightens
as the tempo rises, a neo-soul snare a little behind the beat, punk hats a hair ahead, and a drummer's small drift.

- **Hear** plays the groove you picked at the song's tempo, from the bar in the **Put it at bar** box: alone, or
  **with the song** in place of its drums. Stop, Space or `Esc` ends it. Nothing goes into the song.
- **Put it at bar** puts it on the selected drum track (or a new Drums track) for the bars you give. Whatever was
  under it on that track is cut away, as a clip dropped in the arranger cuts, and one undo brings it back. You can
  also drag a groove onto the arranger: it lands at the bar you drop it on.
- **Tap to find.** Tap two bars or so on the Kick, Snare and Hat pads; after the first tap, `F` `J` `K` play them.
  When you stop, the five closest grooves come back with the tempo you tapped. They play at the song's tempo.
- **Build drums for the song** writes a whole drum track in the style of the groove you picked, one you found by
  tapping too. Each section gets its part's groove (by its name, Verse, Chorus, Bridge, or by how busy the song is
  there), a fill where sections change, a crash on each new one, and the style's ending. When the loop runs to the
  song's end, the ending is left out so the loop goes round. First it says what it will do ("Pop, verse groove in bars
  1–4 and chorus groove in 5–8; fills at 4 …"). Tap a section's part to change it, pick **End with** the style's
  ending or **Loop it, no ending**, then **Build it**. It goes on a new track, as one undo step. Drums already in the
  song keep playing beside it: **M** on a track's header mutes one.

On a phone the tab is one column that scrolls, upright or on its side. Agents get the same with `find_grooves`,
`use_groove` and `drum_track`. Ask the demo agent for "a funk beat" and it offers three from the library as takes.

## Automation

Any knob, fader or pan can move over the song. Its moves live in a lane under its track, and lanes play whether
they're shown or not.

- **See the lanes.** `E` shows or hides the selected track's lanes (a track with none opens on Level). **Automation…**
  in the track's menu lists them and has **Add a lane…** for Level, Pan or any knob; right-click a knob (hold it on a
  phone) and **Automate** opens its lane.
- **Draw.** Click a lane to add a point; drag a point to move it (`⇧` for fine, off the grid), drag the line between
  two points to move both, `⌥`-drag the line to bend it, double-click a point to delete it. **Draw** on the lane's
  header (or hold `⌘` while you drag) paints freehand. Drag across an empty stretch to select its points; the arrow
  keys step from point to point and raise or lower them, and `Delete` takes them out. Every gesture is one undo step.
- **Shapes.** Select some bars and right-click the lane: **Ramp up**, **Ramp down**, **Swell**, **Dip**, **Hold here**
  or **Pulse** over them, or **Simplify**, **Clear** and **Hide this lane**. Right-click a point for **Straight**,
  **Ease in**, **Ease out** or **Step**. A ramp goes where the lane is going and holds there: to the value after the
  bars, or the one it jumps to at the next section; on a level stretch, half the knob's travel, held until the lane
  next moves. The toast says the numbers, and when the lane already does it, it says that instead.
- **Record a move.** Press `R` and turn a knob or pull a fader while it records: what your hand does is written into
  that control's lane, from where you touched it to where you let go, and then the lane takes over again with a
  200 ms glide. Only the stretch you touched changes. The moves go in with the take, as one undo step (`⌘Z` takes
  both back out); round a loop, the last pass you moved it in is the one that plays.
- **A move while the song plays.** Turn a knob while the song just plays and the toast says what moved, and that it
  stays where you left it ("Cutoff moved from 400 Hz to 6.2 kHz over bars 9–11. It stays where you left it.").
  **Write it into the lane** writes the move into the lane as if you had recorded it. Leave it and the knob simply
  stays where you put it.
- **A knob with a lane** turns by itself and says *auto*. Turn it yourself and the lane steps aside: the knob says
  *held*, and **Back to the lane** (in the toast, the knob's menu or the lane's header) gives the lane back. With any
  held, **Back to the lanes** in the top bar gives them all back at once.

## Jam

**Jam**, the tab beside **Arrange**, is a room for playing guitar over a song: to find ideas, try tones and learn the
changes. The song keeps playing when you switch, and what you record there is in the arranger when you come back.
The room takes the screen: the detail pane steps aside while it's open (`D` brings it back, and then it stays) and
returns when you leave. From the top: the chord, then two tabs, **Neck** (the tab and the neck) and **Rig** (your amp
and pedalboard), then your guitar and practice, then ideas. The song plays on whichever tab is open.

- **Play over something.** The song on screen is the band. Its name at the top opens the others: **Jam tracks** (a
  blues shuffle in A, a funk vamp in E minor, indie in G, a ballad, neo-soul, a metal chug, reggae, bossa nova, lo-fi
  and classic rock), the demos and your recent songs. **Make your own** takes a style, a key, a tempo and your own
  chords ("Am F C G", or numerals like "I IV V"). A jam track opens like a song: the one you had goes to Recent songs,
  and Undo brings it back. Another song starts at full speed, with nothing left on the neck from the last one, and
  with your guitar still plugged in it gets an audio guitar track at once, so you keep hearing yourself.
- **Follow the changes.** The chord now is big, with its notes; the next one counts down in beats; the section and
  the bar sit beside them. A long name ("Dbmaj7/Ab") gets smaller rather than cut off. The chords are read from the
  song's notes, so take them as a good reading, not gospel; a song made only of audio clips has none.
- **The neck.** The pentatonic box, the key's scale, the chord's tones (by interval, or by name with **Note names**)
  and the next chord, fading in as the change comes; each one toggles. Pick a tuning (standard, drop D, half-step
  down, DADGAD, open G), or **Left-handed**. What you play lights up wherever it falls: filled when it fits, a ring
  when it's outside, and the line under the neck says what it is ("G: the blue third over E7; bend it a little toward
  G#").
- **Your guitar.** With an interface, choose it and its input under **Your guitar** and open it. An interface or a
  line input you pick is monitored at once, through the Guitar track's effects, and the line under it says through
  which tone; a microphone stays unmonitored, since through speakers it howls, and the line says that too. **Monitor**
  turns it on or off by hand. Your guitar's track starts loud, where a guitar at an interface's usual level sits over
  the band. **Match the band** listens while you play along for five seconds and puts your guitar 3 dB over the band,
  one undo step; it never goes past the fader's top or pushes the master into clipping, and it says where it landed.
  The tuner names a note and how far off it is once the note settles, and only a guitar's notes.
- **No guitar?** Musical typing, a MIDI keyboard or a tap on the neck plays a guitar sound: turning musical typing on
  in the room gives the keys a guitar track when the song has none. A line by the neck says when the keys play
  something else.
- **Rig.** Your tone, laid out the way it sits on a stage: the amp big, the pedalboard under it. The chord stays at
  the end of the tabs' row while the rig has the room.
  - **The rig's name** sits at the top, with what it's for and where it is in its bank. The arrows beside it (or `[`
    and `]`) flip through the Guitar Studio's rigs: you hear each one at once, and the one you rest on is one undo
    step. The words under it pick a bank. A rig whose pedals you've changed says *edited*.
  - **The amp** is drawn at full size: turn its knobs by dragging up and down, the scroll wheel or the arrow keys; its
    power switch takes it out of the chain. **Cab & mics** under it names the cabinet and the mic, and **Adjust**
    opens their controls.
  - **The pedalboard** runs in signal order, left to right: your guitar's jack, the pedals, the amp's place in the
    chain, then any pedals after the amp, out to the mixer. Stomp a pedal's footswitch to bypass it. Drag a pedal by
    the tape under it to move it (or focus the tape and use the arrow keys); its **×** takes it off. **Add a pedal**,
    before the amp, opens the effect list. Each of these is one undo step. The board scrolls sideways when it's wider
    than the room.
  - A tone, a knob or a change on the board goes on both guitar tracks, the keys' and your interface's, so what you
    play on either, and what Show me plays, sound alike.
- **Practice.** **Loop** loops the section you're in (`⇧L`; again to stop). The speed slider plays it at 50–100% (`-`
  and `=`) without changing the song; audio clips sit out below 100%. Recording your guitar through the interface
  plays at full speed, and your speed comes back when the take stops; leaving the room or opening another song puts
  it back to 100%. **Band** turns everything except your guitar down, to 24 dB, so you can hear yourself over a loud
  song. It's for practice only: the song's faders, its renders and its exports stay as they are. While it's down, the
  top of the room says **Band −6 dB** (or however far); press that, or double-click the slider, to put it back.
  Leaving the room or opening another song puts it back to 0 dB. **Match the band** turns the band down for you when
  the top of your guitar's fader isn't enough to sit 3 dB over it, and says by how much. **Click** and **Count-in**
  are the transport's.
- **Ideas.** Tips from this song's chords: the scale and where it sits on the neck, the note to land on at the next
  change, the notes outside the key, a section that moves key, and a two-bar lick. **Show** puts one on the neck and
  brings the neck into view. **Show me** plays the lick: while the song plays it waits for its own bars and plays in
  time with the band (when the loop never reaches them, it starts at the next bar line and the neck says why).
  Hearing a lick or a chord changes nothing in the song: it plays on the room's own guitar, not a track. The tips
  hold still while your pointer is over them. The chips under them ask the agent.
- **Keep it.** `R` records what you play onto the Guitar track from the playhead (again: punch out). In the room it
  never starts a hum.
- **On a phone.** The sheet tucks away when the room opens, and comes back when you leave. The chord sits on one line
  with the neck straight under it and a **Record** button by the neck. A swipe that starts on the neck scrolls the
  room; a tap plays the note. Show and Show me bring the neck back into view. On **Rig** the amp sits above the
  pedalboard, and the board scrolls sideways under your thumb; to turn a knob, hold it still for a moment, then drag.

### Tab

Under the chords, the room shows the Guitar track's part as tab: six strings, the fret each note starts on, its
length drawn along the string, the bars numbered and the chords above them. While the song plays, the note sounding
now is printed in reverse and lit on the neck. The notes ahead are in plain ink and the ones behind in pencil.
**Copy tab** copies it as text. With no riff and no part to show, the tab is one line with **Suggest a riff** in it.

- **Suggest a riff.** It writes three riffs for the section the playhead is in, in the song's key and style (or the
  style you pick) at the difficulty you pick. Each is a one- to four-bar idea that repeats and changes a little, with
  chord tones on the strong beats, played in one hand position. They come from the house riff writer, a seeded
  program in the studio, and the lane says so. With an agent connected, the button asks the agent instead; **or the
  house writer's** still gets the studio's. **Hold to hear** plays a take through your tone while you hold it.
  **Keep** puts it on the Guitar track as one undo step, and **Another** writes three more.
- **Learn a riff.** **Loop bars 5–8** loops the riff's bars. **Play from bar 5** plays them after a bar of count-in,
  and **Speed** slows them down (− and +). Turn off **Hear the riff** and it goes silent, so you play it. **Learn it**
  waits on each note until you play it, then moves on, and the line says what to play ("Waiting on the A: open, A
  string").
- **How it went.** Play along on your guitar through the interface, with musical typing, a MIDI keyboard or taps on
  the neck. A note you hit turns warm. A note you play early or late gets a ring, with a tick on the side you were. A
  note you miss stays plain. After each pass a line says how it went ("11 of 14, the bend in bar 2 is late"). Chords
  are judged on when you strike them and on their lowest note only, because the pitch tracker hears one note at a
  time; the lane says so under a part with chords.

An agent can read the room, make a jam track, set a tone, point at the neck, and read and write tab
([the tools](AGENTS.md#the-tools)).

## On a phone

**Start a song**'s stage is the whole screen: four pads, each a thumb's width tall, and **Done** at the bottom.

**Find anything** is a row of the Song menu, and the end of the agent sheet's tabs; it comes up as a sheet from the
bottom.

The detail pane is a sheet under the song: drag its handle to size it, or tap the handle to tuck the sheet down to its
tabs. Turn the phone on its side and the top bar takes one row, and the top of the song stays in view however far the
sheet comes up. A swipe scrolls. Sketch's **Play it** is an octave of keys in the song's key, with the line over them
that musical typing has (*Snapping to 1/16, in C minor*): tap either part to turn it off. To move a knob, a slider or
a fader (a pedal's, a device window's, the mixer's), hold it still for a moment, then drag: a swipe that starts on one
scrolls past it and moves nothing (one that scrolls nothing says how); in the Beat grid a tap adds a hit, and a hold,
then a drag, paints along the row. In the browser a tap on an instrument asks where it goes, a new track or in place
of what the selected track plays, so a look never swaps a sound out. Two notes show at a time, and the same one again
is counted (×2), not stacked. In **Jam** the chord sits on one line above the neck, the neck scrolls sideways, and a
tap on it plays that note; the tab scrolls sideways with the playhead.

## Bring your own Claude

The demo agent is a script. For the real thing, bring your own Claude, on your Claude plan: **claude.ai** (on the
web or in the Claude apps) through the **Connect** tab, or **Claude Code** on your computer, in the Agent tab's own
box or over MCP (both below). Pick Claude Code's model in the Agent tab's settings: Opus 5.5 (the default),
Sonnet 5.5 or Haiku 4.5.

The studio keeps no API key. It used to take one in the Agent tab and keep it in the browser; that field is gone, and
a key saved there is deleted the next time the studio opens, with a note saying so. If you saved one, you may want to
revoke it in the Anthropic Console.

Ask it the way you'd ask a session player: *"darker"*, *"half-time in the bridge"*, *"two takes on the hats"*. It
acts on what you've selected, says what it changed and the number, and asks which one you mean when a word like
"warm" could go two ways. Anything that rewrites your notes comes as takes for you to pick from.

When it asks, you hear both readings and pick one. Your picks are kept under **Your words** in the Agent tab's
settings (the gear), in that browser, so next time "warm" means what you picked and the agent says it used it.

## Bring claude.ai

claude.ai can play in the studio you have open, on the public site, with nothing to install:

1. Open the **Connect** tab (in the right pane, next to Agent and History) and press **Turn on**.
2. Copy the **connector URL**.
3. In claude.ai, open **Settings → Connectors → Add custom connector**, name it Overdub and paste the URL.
4. In a chat, turn Overdub on in the tools menu and ask Claude to look at your song. Keep the studio tab open.

claude.ai will say the connector has no sign-in. That's expected: the link is the key. Anyone with it can edit the
song in that tab while Connect is on, so keep it to yourself; **New link** swaps it for a fresh one and the old one
stops working at once, and **Turn off** disconnects the tab. Claude's edits are signed `claude.ai`, and every one is
undoable on its own. On Team and Enterprise plans an Owner may have to allow custom connectors first.

## Bring Claude Code

Claude Code (or any agent that speaks MCP) can drive the studio too, with the same tools as the agent in the page.
It needs a copy of the studio running on your own computer: the public site can't be driven from outside. Clone
<https://github.com/overdubstudio/overdub>, or install the plugin, which fetches it for you.

The plugin brings the server and a skill that teaches Claude the room's rules. Inside Claude Code:

```text
/plugin marketplace add overdubstudio/overdub
/plugin install overdub@overdub
```

Or, from a clone, add the server alone:

```sh
claude mcp add overdub -- node <repo>/server/mcp.js
```

Then ask: *"Look at my Overdub song and give me two takes on the bassline."* The first tool call starts the local
server if it isn't running and opens the studio at `http://localhost:3279/app/`. Keep that tab open. Claude Code
shows up in the Agent tab as a presence, and its edits are signed `mcp:claude-code`.

Or skip the terminal: with the studio running from your clone (`node server/serve.js`) and Claude Code installed and
signed in, the Agent tab offers **Use Claude Code here**. Then the Agent tab's own box talks to Claude Code on your
computer, on your Claude plan rather than an API key, with the model you pick in the Agent tab's settings. It sees
only the studio's tools, and its edits are signed `claude`, like the agent in the page. Each song keeps its own
conversation; **New** starts it over.

Songs are kept per site, so a song on the public studio and one on `localhost` are separate. Move one across with
the Song menu: **Save the project file** (`⌘S`) on one, open it (`⌘O`) on the other. More, for Claude Desktop,
Cursor, VS Code and Codex too: [Connect an agent](../integrations/README.md).

### Your own API key, on your own server

Self-hosting, with an Anthropic API key rather than a Claude plan? Give the key to the server, not the page:

```sh
OVERDUB_ANTHROPIC_KEY=sk-ant-… node server/serve.js
```

The Agent tab's box then talks to Claude through that server: the page sends its request to the server, the server
adds the key and passes it to the Messages API, and the key never reaches the browser. Anthropic bills you for what
you use. It is its own variable, not `ANTHROPIC_API_KEY`, so a key that happens to be set in your shell is never
spent unasked. When Claude Code is on (or the demo agent), that answers instead. The server listens on `127.0.0.1`
only: put it on a public address and anyone who reaches it spends your key.

Hosting a copy of the site? The studio has a hosted agent built in, Claude on Overdub credits, but it's Overdub's own
service and it's off in your copy: it only turns on when the site has an `app/site-config.json` naming a service, and
the repo has none. Without one, the studio shows nothing of it and connects to no one. (Pointing it at a service of
your own also means adding that service to the page's `connect-src` and `frame-src`, in `app/index.html`.)

## Build a device

Ask for an instrument or an effect that doesn't exist yet: *"Build me a pedal that makes my guitar sound like it's
underwater in a cathedral."* The agent writes it as a small piece of audio code.

- **The check.** Before you hear it, the studio checks it: it has to compile, never output NaN, stay under control
  at the ends of its knobs and never leave a note stuck. Its loudness is measured against what went in. A device
  that fails doesn't play, and the agent gets the report so it can fix it.
- **The face.** A device that passes gets a face drawn from its knobs, with a badge saying who built it. Every knob
  drags, takes the arrow keys and resets on a double-click.
- **Export and import.** In the **Devices** tab, a device's **i** card has **Export device**: a
  `.overdub-device.json` file. In another song, **Import a device…** in the Song menu (`⌘⇧I`) brings it in. It is
  checked again on the way in, and refused, with the report, if it fails.

The [device library](/app/library.html) has 47 devices: the 34 built-in instruments and effects, and 13 Claude
wrote, each from one request, and the request is on the card. Play any of them on the page. The Guitar Studio's 101
pedals and 27 amps aren't on that shelf; find them in the studio's browser. To write one by hand, see
[Writing devices](DEVICES.md).

## Share and fork

**Share a link** in the Song menu copies a link with the whole song in it: notes, devices (including ones written in
the song) and the mix. Audio recordings stay behind, and the studio says so. The song is packed into the link
itself, so Overdub's servers never see it, though whatever you paste the link into (a chat, an email) does. The first
time, it asks whose name the link should carry (your parts are signed with it) before it copies anything; this
browser keeps the name, so after that it copies straight away. Change the name in the sheet and **Copy link** copies
the link signed with the new one.

A link can carry devices someone wrote, and a device is code that runs in your browser when the song plays. So the
studio asks first. Under the banner it says what the song brings, who wrote it, what you're hearing without it and
what playing it means: *"This song brings 2 devices Sam wrote: Tin Whistle and Half Measure. They're off now: Tin
Whistle is silent and Half Measure lets the sound through untouched. Each is a small program that runs on this
computer. Play them if you trust Sam: that code then runs from now on, in this browser, in any song."* Until you
answer they're kept off, so if you press play first you hear the rest of the song, and the silent track's clips say
*kept off* on the lanes.

- **Play them**, if you trust whoever sent it, lets them play now, no reload, and this browser trusts that code from
  then on, in any song: the same link won't ask again.
- **Keep them off** leaves them off. The song plays without them, the track says *kept off*, and the next time the song
  opens it asks again. **Play it** on a kept-off device in the **Devices** tab lets that one play later: the tab opens
  on the first track with one, and its track list says *kept off* beside each of them.

On a phone the question comes first, on its own; once you've answered, the banner is one line (▶, the title, **Make
it yours**, **Back**), so the song stays in view. The banner's ▶ plays the song and stops it, from the start marker.

A song file you open (`⌘O`, or dropped on the studio) asks the same way. Nothing asks about the demo songs, the devices
your agents write here, or a device file you import: those are yours to run. **Make it yours** keeps whatever you
decided.

Whoever opens the link hears your song but doesn't keep it yet: nothing is saved in their browser until they press
**Make it yours**. Their copy remembers where it came from, and every part stays signed by whoever played it: Claude's
takes stay Claude's, and yours come over signed by a guest, so nobody mistakes them for the new owner's. A device
stays credited to whoever made it, and one that reached the sender in someone else's link says so ("Sam, via Jo's
link"), so a song that comes back to you still credits what you made. The welcome card a first-time listener sees
names who sent the song. History and the provenance report both name the song it was forked from.

When you open someone else's link, your agents can play over their song, but until you press Make it yours they don't
take anything out of it on their own. An agent that wants to delete something, rewrite notes or automation that's
there, or add a device it wrote asks first, with a card in the Agent tab: *"Claude wants to delete Bass (Sam's
part)."* **Keep** does it, signed by the agent; **Keep as it was** leaves the song alone; **Hold to hear** plays it as
it would be. A new device is code, so it runs only once you keep it, after the device check. Adding a part, a clip or
an effect, or a mix move, goes straight through as usual, and after Make it yours your agents work directly again.

## Bring material in

- **MIDI.** Drop a `.mid` file anywhere in the studio, or use **Import MIDI…** in the Song menu. Each part becomes a
  track with one clip (drums on the drum kit, other parts on the nearest built-in instrument), all in one undo step.
  Into an empty song it also brings the file's tempo, meter, key and markers; into a song with clips, the song keeps
  its tempo and says so.
- **Audio.** Drop a WAV, MP3, M4A or OGG file on the arranger: it lands where you dropped it, on that audio track or
  a new one. **Import audio…** in the Song menu puts it at the playhead's bar.
- **A reference.** Open the **Reference** tab (bottom panel, after the Mixer) and drop a finished song you want yours
  to sit near. It is measured once and kept beside your song, never in the mix or a render. **Measure the mix** shows
  your mix's numbers beside it, and **A** and **B** switch between your mix and the reference, played at your mix's
  loudness. Ask the agent how yours compares and it measures both (`compare_to_reference`).

- **A device from the community shelf** (a studio on your own computer only, for now). Open **Instruments and
  effects** (or Find anything, then type *community*) and scroll to **From the community**. ▶ on a row plays a
  recording of the device; nothing of it runs. Tap the row for what it does, who made it, and its code to read. **Try**
  isn't open yet. When it is, **Try on Vocals** (or whichever track is selected) asks whether to run code someone else
  wrote before anything plays; a new track comes with two bars to hear the device on, and Undo takes it all back.

## Take it elsewhere

The Song menu's **Export** section:

| | what you get |
|---|---|
| **Mix** (`⌘⇧E`) | the song as a WAV, 24-bit, 48 kHz |
| **Stems** | one WAV per track, in a zip |
| **MIDI** | a Standard MIDI File, one track per part |
| **DAWproject** | a `.dawproject` for Bitwig Studio, Studio One, Cubase and others: tempo, tracks with their mixer settings, notes, audio clips and sections. Overdub's own devices can't travel, so each becomes a named placeholder with its settings. Put your own instrument on each track; the notes are all there. |
| **Provenance report** | who played what: each author's share of the notes, the devices an agent built and the requests behind them, and the story of the edits. It opens in a new tab; print it to keep a PDF. |
| **Attribution log** | the same story as JSON: who made each note, clip, effect and device, and every edit this session with its author and time |

**Save the project file** (`⌘S`) keeps the song itself as `.overdub.json`, every note and device. Open it again with
`⌘O`.

## Keys

`?` shows every key in the studio, grouped, and has a switch for single-key shortcuts: off, keys like `R` and `H` do
nothing, so dictation or a stray key can't start a take or open the mic. The ones to learn first:

| key | does |
|---|---|
| `Space` | play from the marker, and stop (back to the marker) |
| `⇧Space` · `Home` | play on from where it stopped · the marker back to bar 1 |
| `⇧Esc` | All off: stop, and cut every note and tail, from anywhere |
| `R` | record into the song from the marker (again: punch out) |
| `⇧R` | put what you just played in the song |
| `⌘↑` · `⌘↓` | the selected clip's previous · next take |
| `L` · `K` · `⇧K` | loop on and off · the click · the count-in (1 bar, 2 bars, off) |
| `M` · `S` | mute · solo the selected track (again: unmute · unsolo) |
| `⌘E` | split the selected clips at the playhead, on the snap grid |
| `H` | hum (again to stop) |
| `T` | tap (then `F` `J` `K` `L`) |
| `⇧B` | build a band around the selected clip |
| `0` | mute or unmute the selected clips |
| `E` | show or hide the selected track's automation lanes |
| `` ` `` | musical typing on and off |
| `/` | search sounds and effects |
| `⌘/` | ask the agent |
| `A` · `B` · `D` | show or hide the agent · the browser · the detail pane |
| `⌘Z` · `⇧⌘Z` | undo · redo |
| `Esc` | stop the agent, or close the device window you're in |

On Windows and Linux, `Ctrl` stands in for `⌘`. The keys are the ones Logic and GarageBand use: `M` mutes, `S` solos,
`K` is the click. Splitting is `⌘E`, Ableton Live's key, since a browser keeps Logic's `⌘T` for a new tab. (Until
October 2026 `M` was the click and `S` split a clip; the first press of each moved key says so, once.) A key from
another DAW that does something else here (`⌘L`, `⌘C` or `⌘V` on a clip) says what does it: `L` loops the selected
bars, `⌥`-drag or `⌘D` copies a clip.
