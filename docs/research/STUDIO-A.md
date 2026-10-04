# Studio A: an acoustic kit that plays like a recorded one

Studio A (`core.drumroom`, `app/src/devices/builtin/drumroom.js`) is a synthesized acoustic drum kit that plays like a
multi-miked recording: distinct pieces with articulations, velocity that changes the sound, hits that never repeat,
and a mic mix (close, overheads, room, a crushed room, bleed) you can balance. This note has six parts:

- what the big drum samplers do that players love, with sources
- the engine as built
- the note map: the contract for grooves, the editor and agents
- the param map
- the measurements, CPU included
- what the next wave should build

Product names appear here because this is a research note. The studio's own copy never uses them.

`tools/studioa-test.js` holds the kit to what this note claims. The numbers below come from the canonical
Node render (`app/src/engine/node/render.js`) on an M-series Mac, unless a line says otherwise.

## 1. What the big samplers get right

### The sound

- **Every mic, with its bleed.** The flagship library was recorded in a 330 m² hall with an 8 m ceiling and a
  reverb time of up to 2.4 s. It ships close mics (kick in, out and sub; snare top and bottom; hi-hat; toms), two
  pairs of overheads, and ambience pairs at several distances [TT-mics]. Players can bring "bleed individually into
  any or all of the room mics" [SOS-SD3].
- **Snares on and off, many articulations.** Kits were sampled with the snare wires on and off, and with sticks,
  brushes, mallets and blasticks [TT-kits]. Another library lists:
  - "up to 80 velocity layers"
  - rim clicks and rimshots on the toms
  - bell hits on the hats [BFD3]
- **Modelled where samples run out.** That library adds modelled tom resonance and bleed for "a natural-sounding
  glue", and a "swell-modelling algorithm for more realistic cymbal washes" [BFD3]. A smaller sibling never plays
  the same velocity layer twice in a row ("anti-machinegun") [BFD-Eco].
- **Per-piece shaping.** Each piece has level, tuning, humanise and a pitch envelope [SOS-SD3]. Reviewers single
  out grace notes "reproduced perfectly" and call the result "deep, detailed, utterly believable" [SOS-SD3].

### The kit and mic workflow

- **A drawn kit.** You click a piece to hear it and select it, and its controls open beside the drawing [SOS-SD3]
  [SOS-EZD2] [BFD-Eco].
- **A mixer with a channel per mic.** Bleed is routed per channel [SOS-SD3]. A perspective switch flips the stereo
  picture between the drummer's seat and the audience's [BFD-Eco].
- **Variable hi-hat.** The hats open in stages (closed, ¼, ½, ¾, open), on the tip and on the shank. A pedal
  controller (MIDI CC 4) picks the stage, and the pedal chokes any open hat [BFD-Eco].
- **Room options.** One library adds "mono room and hardware-compressed channels", the crushed room [BFD3].

### Grooves, and finding them by tapping

- **Tap to find.** You overdub a two-bar clip on a loop, and the library "searches the clip library to find MIDI
  loops that closely match, or would work alongside" it [SOS-SD3]. Each suggestion shows a match score [SOS-EZD2].
- **Other front ends to the same search:**
  - a three-lane step grid (hat, snare, kick) [SOS-AD2]
  - a kick and snare step sequencer [SOS-EZD3]
  - a groove picked from the transients of your song [SSD]
- **The band-mate.** You drop in audio or MIDI and get matching grooves, sorted by genre [TT-EZD3] [SOS-EZD3].

### The song creator

- You drop a clip in. The panel fills with clips "that might make suitable options for verse, pre-chorus, chorus
  and so on" [SOS-SD3]. Dragging a song structure in gives "an instant, fully formed, song-length drum performance"
  [SOS-SD3].
- Inside the grid editor, Humanize adds velocity "styles", and timing has quantize, swing and nudge [SOS-EZD3].
- An Edit Play Style control adds ghost notes, and a power-hand switch moves the pattern, for example from the hat
  to the ride [SOS-EZD3].

### What a synthesized kit can do that samples can't

- **Continuous controls.** Every tuning, damping and strike position is a dial, not a pick from a fixed set of
  samples.
- **One body per piece.** A re-strike adds to the drum that is already ringing, so a roll builds and a ride's wash
  grows.
- **Small and repeatable.** There is no RAM, no download, and every render is deterministic.

Studio A takes that side: it's a physical model, miked like a recording.

## 2. The engine

### Architecture: probes, and the kit in `process()`

A kernel's voices render into one stereo pair, and a voice doesn't know where in the block it starts. A mic mix needs
each piece on its own: in the close mics, at each overhead after its own time of flight, in the room, in the crushed
room and in the other close mics. So Studio A's voices are **probes**:

- A probe starts on its note, counts the frames the host asks it to render before `process()` runs, and reads the
  note's `mod`. The frames it counted give the note's offset in the block, to the sample.
- It stays alive one block, or until the note ends for a held snare roll.
- `process()` then runs the kit: 16 persistent piece models, the mic buses and the output stage.

This keeps the notes sample-accurate and the buses shared, and it lets one piece be struck again while it rings.
Nothing in the host changed for it. `poly: 24` probes is far more than any block needs (the device check's 28
notes at once reach one live probe).

### The membranes: kick, snare, four toms

Each drum is a bank of two-pole resonators, one per mode, struck by a contact force:

- **The head's modes.** They sit at the circular membrane's Bessel ratios: (0,1) 1, (1,1) 1.594, (2,1) 2.136, (0,2)
  2.296, (3,1) 2.653, (1,2) 2.918 and so on [Rossing] [Russell].
  - On toms and the kick the ratios are flattened a little (ratio^0.94), for the air loading that pulls a real
    drum's partials together [Rossing] [Avanzini-Marogna].
  - The (0,1) mode has a partner from the other head. On toms and the kick it is a few % apart, so they beat. On the
    snare it sits about 1.5x above, like the 182 and 330 Hz pair measured on a snare [Rossing] [Avanzini-Marogna].
- **Where the stick lands.** Each mode is driven by its shape there, |J_m(j_mn r)| [Avanzini-Marogna]:
  - a centre hit drives the (0,n) modes: fat and short
  - the edge and rimshots drive the high modes: thin and ringing
  - the kick's beater lands at r 0.1, toms at 0.4, a backbeat at 0.3
  - ghost strokes land a little further out, and HUMAN moves every stroke a little
- **Contact.** The force is a half sine (a stick on a head) or a raised cosine (a felt beater; a stick on metal) of
  a given length, shorter as the stroke gets harder:
  - stick on a snare: 0.35-1.8 ms; on a tom: 0.3-2.3 ms
  - felt beater: 2-7 ms
  - plastic or wood beater: 0.8-3.4 ms

  A shorter push reaches higher partials, so harder is brighter by physics, not by a filter on the output
  [Avanzini-Rocchesso]. A real stroke stays in contact for 5-8 ms at mf [Dahl]. The model's push is its sharp first
  impact, which carries the brightness. The long contact after it mostly damps the lowest modes, and the model leaves
  that out.
- **Tension modulation.** A hard hit bends the head up, and it glides down as the energy falls [Avanzini-Bank]
  [Avanzini-Marogna]. Each 32-sample sub-block retunes the bank by `1 + G x` (capped at `1 + 2G`), where `x` is
  mode (0,1)'s energy relative to a full stroke. When the bend falls under 0.2 cents it stops retuning.
- **The rest of the drum:**
  - a shell mode (wood: 220-720 Hz)
  - the crack (the stick on the head) or the beater's slap. It is a band of noise, bounded (an impact has no Gaussian
    spikes), whose level grows as F^2.2 to F^3 and whose centre climbs with the force.
  - the knock: the head's dense middle, which the modal bank can't hold
- **The snare's extra modes.** Its hoop modes (1.2-5.1 kHz) ring on rimshots, and the stick-and-rim modes
  (430-2900 Hz) ring on the side stick.

### The snare wires, and the toms that shake them

- **The buzz.** The wires are noise gated by the snare head's own motion: an envelope over a threshold, plus the
  rectified motion itself. That gives a buzz at twice the head's frequency, not hiss. Their band climbs from 2.6 to
  6.8 kHz as the drive grows, so a ghost stroke's wires are soft and dark. WIRES sets their level and threshold; 0
  is snares off.
- **Literature.** Coupled-wire models collide the wires with the carry head [Torin-Bilbao]. Higher wire tension is
  brighter [Avanzini-Marogna].
- **Sympathetic buzz.** The kick and toms feed a resonance tuned to the snare head (Q 3), which drives the wires. A
  floor tom hit adds about 52 dB in the 3-9 kHz band with the wires on. That is still 42-51 dB under the tom: a
  faint sizzle at the default WIRES, plain with loose ones. No source fetched measures sympathetic buzz; samplers
  record it as bleed (a "Kick No Snare" articulation exists for the opposite reason [BFD-Eco]). The level is set by
  ear for the studio's measures, not from data.

### The hi-hat

- **The plates.** Fourteen partials (three low, 380-1100 Hz, and eleven from 3 to 16 kHz), seeded per kit.
- **Openness.** h runs from 0 (clamped) to 1 (wide open) and sets each partial's ring between its closed time (50-90
  ms) and its open time (1.1-2.3 s). Less foot pressure lets the plates "rub together more freely": more sustain and
  sizzle [Hihat].
- **The sizzle** is noise driven by the plates' own motion, most at half open.
- **Closing** (a closed or pedal note, or a note whose mod is lower) moves h to 0 over a few ms, so the ring dies in
  about 20 ms. That is the choke, and it comes with the chick of the plates meeting.
- **Tip and edge.** The tip weights the high partials, and the shank (edge) the low ones, with a longer contact.
- **Stages.** ¼ is h 0.25, ½ is 0.5, open is 1. The foot splash is the chick, then the plates ringing at 0.6.
- **A note's mod** (0..1) sets h for that stroke: openness as a continuum, the way a hat pedal's CC 4 sets it on an
  e-kit [BFD-Eco].

### The cymbals

- **Partials.** Each cymbal has 16-26 inharmonic partials, seeded per kit so a cymbal keeps its voice:
  - spread between about 300 Hz and 13.5 kHz
  - tilted toward the kit's peak frequency
  - each ringing 0.2 s to 1.4x the cymbal's T60, the highest fastest
- **Wash.** Three bands of noise. A stroke fills each band's reservoir, which swells into the band and drains with
  its ring.
  - The swell takes longer up the spectrum (crash: 18, 40 and 75 ms). That is the cascade measured on real
    cymbals: a strike sound in the first millisecond, peaks building over 10-20 ms, then an aftersound at 3-5 kHz
    that dominates "a second or so after striking" [Rossing] [Chaigne-Touze].
  - The wash grows as F^1.35 (more energy up the spectrum on a hard hit). Repeated strokes add up, so a ride's wash
    builds.
- **Ride zones.**
  - bow: the ping partials, little wash, a stick tick
  - bell: four near-harmonic partials that ring long, little wash
  - edge: crash-like
- **China.** Adds a 45 Hz rough flutter (the trash).
- **Chokes.** A choke is the hit, then a hand grabbing it 110 ms later: every ring drops to 2.5% of its time.

### Percussion

- Tambourine: four jingle collisions over about 20 ms, five jingle partials, and a noise tail.
- Cowbell: five partials.
- Shaker: a 10 ms swing of grainy noise.
- Claps: four people a few ms apart.

They sit in the kit with their own close mics (the tambourine on the hat stand, the cowbell on the kick).

### The mics

The layout is in metres from the drummer's seat (`POS` in the kernel). The mics are positioned as follows:

- **Overheads.** A spaced pair 1.24 m apart, 1.86 m up, cardioids pointing down.
- **Room pair.** 2.5 m apart and 3.6 m out, aimed at the kit.
- **Crush mic.** Omni, 1.7 m out.
- **Close mics.** Panned to each piece's place. The kick mic is inside the drum, so it hears a quarter of the
  leakage the others do.

Every piece gets these from its geometry:

- **Overheads.** A time of flight (distance / 343 m/s, fractional) and a level (cardioid and 1/d) at each mic,
  times how much the piece radiates upward (the kick's 0.4, the cymbals' 1.25). The image is the layout:
  - drummer's view: rack tom 1 arrives 0.6 ms earlier on the left and 1.9 dB louder
  - rack tom 2 -0.5 ms, -1.7 dB
  - floor tom 1 -1.2 ms, -3.8 dB
  - floor tom 2 -1.7 ms, -4.7 dB
  - Spaced pairs localise by time difference and comb in mono [DPA-stereo].
- **Room.** The direct sound after its distance (about 10 ms), then:
  - six early reflections a side, 7-45 ms, scaled by SIZE
  - an 8-line FDN tail, T60 0.3-1.8 s
  - darker and lower than the overheads
  - mono under 120 Hz: mid and side, the side through a fourth-order high pass at 120 Hz, the middle untouched. The
    reflections reach the two room mics at different times and alternate in sign, and the tail differs on each side,
    so without it the kick's low end came out of phase between left and right and cancelled in mono. Section 5, "The
    low end in mono", has the measurements and why it is the room alone.
- **Crush.** A brick-wall compressor whose gain follows each peak at once and lets go over 70 ms, so the room swells
  between hits. It is driven into a soft clip, then gated: once the room has fallen 20 dB under the threshold it
  closes over 120 ms. This is the trick heard on "Intruder" and "In the Air Tonight": the console's talkback
  compressor, then 1176s on room mics, "90 percent of the sound was the live room mics" [Mix]. In Zeppelin's
  stairwell, compressors were set "to create a breathing effect" [Levee]. Crest on the drum phrase: 13.1 dB, against
  the plain room's 16.6.
- **Bleed.** Each piece leaks into every other close mic by distance (a close mic sits 6 cm from its drum, 0.45
  off axis), heard at that mic's pan, darker. The hat leaks into the snare mic; the cymbals, which have no close
  mic, leak into the toms [DPA-snare] [DPA-kit]. At BLEED 0 a crash is not in the close mics; at 1 it is.
  Delays inside 15 ms comb; the 3:1 rule wants about -10 dB [DPA-comb], and BLEED 0.5 sits near that.
- **The view.** It mirrors everything. Every mic is symmetric about the kit's centre, so the audience's side is the
  drummer's with left and right swapped, crossfaded over 15 ms.

### The output

- **Preamps.** Each close mic and each overhead runs into its own soft ceiling, rounding the top few dB of the
  hardest strokes the way a driven console or tape does.
- **True-peak limiter.** The mix then goes into a stereo-linked limiter that looks 1.67 ms ahead.
  - Its detector reads true peaks, with the same 4x polyphase windowed-sinc design `audio/measure.js` uses, at 16
    taps a phase.
  - Its gain is the lowest any sample in the window asks for, averaged over the window, then released over 40 ms.
  - The output is delayed the window plus the filter's half-length (80 samples at 48 kHz, declared as `latency`),
    so every peak is under -1.5 dBFS when it plays.
  - The engine lines the other tracks up, and the device check finds the onset at the declared 80 samples.

A natural kit has a crest near 20 dB. Raw, Studio A's GM drum phrase would need its loudest backbeats clipped by
about 8 dB to reach the house level. With the preamps and the limiter it reads -17.8 LUFS at -1.35 dBTP. A snare
is still 7.3 dB louder from velocity 0.4 to 1.0, and a kick 8.8.

### Humanity

- **No two strokes alike.** Every stroke draws its variation from the instance's seed, in the order the strokes
  arrive, so renders repeat bit for bit. Under HUMAN it moves:
  - force by up to ±6%
  - where the stick lands by ±0.06 of the radius
  - contact time by ±12%
  - the flam, drag and roll spacing by up to 15%
- **The drum remembers.** Each stroke lands on a drum that is still moving and draws its own noise. Eight snare
  strokes at one velocity never repeat: consecutive waveforms correlate 0.74-0.78. They stay within 0.7 dB and
  x1.11 brightness of each other.
- **Timing is left alone.** HUMAN doesn't move timing: the notes are the player's or the agent's. Groove timing is
  the next wave's (section 6).
- **VEL is the velocity curve:** force = v^(1.15 x 2^-VEL). A light touch (-1) to a heavy hand (+1) is 7.5 dB on the
  same note.

### The kits

| kit | kick | snare | toms (Hz) | hats / cymbals | character |
|---|---|---|---|---|---|
| MAPLE (default) | 53 Hz, felt, T60 0.32 s | 188 Hz, 0.2 s | 138 118 98 80 | 7.8 kHz peak; 16/18" crashes, 20" ride | warm 70s maple, coated heads, medium damping |
| BIRCH | 57 Hz, plastic beater, 0.26 s | 225 Hz, bright crack | 172 142 108 86 | brighter (9.6 kHz) | punchy modern birch, clear heads |
| JAZZ | 70 Hz, felt, 0.75 s, open | 290 Hz, crisp wires | 212 178 140 112, long | dark and thin, long ride (7 s) | a small kit tuned up |
| ARENA | 46 Hz, wood beater, 0.4 s | 172 Hz, fat, 0.28 s | 125 106 82 68, long | big and bright, 22" ride | a big rock kit |
| DEAD | 50 Hz, felt, 0.17 s | 168 Hz, 0.09 s | 128 110 86 72, 0.28-0.45 s | small and dark | towels on the heads |

Against published tunings [Tune-Bot] [Rossing]:

- **Kicks.** 46-57 Hz (the jazz kit's 70): the top of the published fundamentals (C1-G1, 33-49 Hz) and into the
  batter head's lug pitch (49-71 Hz).
- **Snares.** 168-225 Hz (the jazz kit's 290): inside the published E3-A#3 (165-233 Hz). A snare's (0,1) was measured
  at 182 Hz.
- **Toms.** A little higher than the guide's 12" 110-131 Hz and 16" 65-73 Hz: here the 12" sits at 125-142 Hz and
  the 16" at 80-86 Hz, which is punchier.

The jazz kit is tuned above all these on purpose. Kit loudness is levelled by each kit's `gain`: on the drum phrase at
the default mix the five kits read -16.9 to -18.3 LUFS.

Brushes are not in v1. A believable brush needs a sustained scraping excitation (sweeps) and very soft, long-contact
taps. The probe architecture could carry a held sweep the way it carries a roll, but nothing here was measured
against brushes, so they wait.

## 3. The note map (the contract)

General MIDI notes play what GM names (35-59, plus the tambourine, cowbell, cabasa and maracas GM covers). The
articulations GM has no note for have notes of their own below 35:

- The hats' edge notes follow the e-kit convention: closed edge on 22, open edge on 26 [BFD-Eco].
- The others are new: the stages, chokes, flam, drag, roll and snare edge.

Every name is in `core/music.js` `DRUM_MAP`, for grid rows and agents. Every label is in the def's `notes`, Studio A's
own names for its rows, which the drum grid, the piano roll and `get_device` read (`kitNotes`); `DRUM_NAMES` keeps
every label the studio had. Those were added only: the 33 names already there kept their numbers, and `formatGrid`
prints the same names for old notes. `tools/studioa-test.js` checks that.

| note | piece, articulation | DRUM_MAP name | its name (`notes`) |
|---|---|---|---|
| 35 | kick | | Kick (35) |
| 36 | kick | `kick` `bd` | Kick |
| 37 | snare, side stick | `rim` `side` | Side stick |
| 38 | snare, centre (ghosts by velocity) | `snare` `sd` | Snare |
| 39 | claps | `clap` `cp` | Clap |
| 40 | snare, rimshot (GM's electric snare) | `rimshot` | Rimshot |
| 41 | floor tom 2 (GM low floor) | `lowfloor` | Floor tom 2 (41) |
| 42 | hat, closed, tip | `hat` `hh` `ch` `closed` | Hat |
| 43 | floor tom 2 | `tom4` `floor` | Floor tom 2 |
| 44 | hat, pedal (foot chick, chokes) | `pedal` `ph` | Pedal hat |
| 45 | floor tom 1 | `tom3` `lotom` | Floor tom 1 |
| 46 | hat, open (tip) | `open` `oh` | Open hat |
| 47 | rack tom 2 | `tom2` `midtom` | Rack tom 2 |
| 48 | rack tom 1 (GM hi-mid) | `himid` | Rack tom 1 (48) |
| 49 | crash 1 | `crash` `cy` | Crash |
| 50 | rack tom 1 | `tom1` `hitom` | Rack tom 1 |
| 51 | ride, bow | `ride` `rd` | Ride |
| 52 | china | `china` | China |
| 53 | ride, bell | `bell` | Ride bell |
| 54 | tambourine | `tamb` | Tamb |
| 55 | splash | `splash` | Splash |
| 56 | cowbell | `cowbell` `cb` | Cowbell |
| 57 | crash 2 | `crash2` | Crash 2 |
| 59 | ride, edge (GM's ride 2) | `rideedge` | Ride edge |
| 69, 70, 82 | shaker (GM cabasa, maracas; GM2 shaker) | `shaker` `sh` (70) | Shaker (69) / Shaker / Shaker (82) |
| 21 | hat, foot splash | `footsplash` | Hat foot splash |
| 22 | hat, closed, edge (shank) | `hatedge` | Hat edge |
| 23 | hat, ¼ open | `quarter` | Hat 1/4 open |
| 24 | hat, ½ open | `half` | Hat 1/2 open |
| 25 | ride choke (hit, then grabbed) | `ridechoke` | Ride choke |
| 26 | hat, open, edge | `openedge` | Open hat edge |
| 27 | crash 1 choke | `crashchoke` | Crash choke |
| 28 | crash 2 choke | `crash2choke` | Crash 2 choke |
| 29 | china choke | `chinachoke` | China choke |
| 30 | splash choke | `splashchoke` | Splash choke |
| 31 | snare flam (grace note, then the stroke 24 ms late) | `flam` | Flam |
| 32 | snare drag (two grace notes, the stroke 75 ms late) | `drag` | Drag |
| 33 | snare roll, held: rolls until the note ends | `roll` | Roll |
| 34 | snare, edge | `snareedge` | Snare edge |

The rules for the editor and for agents:

- **Toms.** The house names `tom1` `tom2` `tom3` `floor` (50 47 45 43) are four distinct drums, high to low, and so
  are `tom1`-`tom4`. Of GM's six tom notes, 48 joins 50 on rack tom 1 and 41 joins 43 on floor tom 2.

  The common commercial map puts 45 on the second rack tom instead. It was not followed here, so that the house
  vocabulary (`tom3` = 45) stays a separate drum: grooves written before Studio A keep four toms. It is an open
  question (section 7).
- **Hats.**
  - A closed (42, 22) or pedal (44) note chokes whatever the hats were ringing.
  - A hat note's `mod` (0..1), when it carries one (over 0.02), is the openness for that stroke, and the channel's
    mod wheel does the same live. The pedal and foot splash ignore it.
- **Rolls.** 33 is a held note: the sticks bounce about 48 times a second, the hands alternating, until it ends.
  Its `mod`, if any, swells it (`mod` curve = a crescendo).
- **Flams and drags** land late by design: the grace notes come first, as in a sampled flam. Put the note that much
  early if the main stroke must land on the grid.
- **Chokes** are a stroke that's grabbed. To stop a ringing cymbal, play its choke; it adds one short hit.
- **Anything else** (vibraslap, the Latin percussion, whistles) plays the side stick, quietly, as Gobo Kit plays
  its rim.

## 4. The params

Every param has a role, a `desc` and a `group` (the piece it belongs to, `mics`, `kit` or `perc`), for the editor.

| key | range (default) | role | what it does |
|---|---|---|---|
| `kit` | MAPLE BIRCH JAZZ ARENA DEAD (MAPLE) | shape | sizes, tunings, heads, beater, cymbals |
| `tune` | -12..12 st (0) | pitch | every drum and cymbal |
| `decay` | 0.3..2 x (1) | decay | every piece's ring |
| `mix_close` | -40..6 dB (0) | mix | the close mics (-40 off) |
| `mix_oh` | -40..6 dB (-2) | mix | the overheads |
| `mix_room` | -40..6 dB (-8) | mix | the room pair |
| `mix_crush` | -40..6 dB (-40) | mix | the crushed mono room |
| `bleed` | 0..1 (0.5) | mix | leakage into the close mics |
| `room_size` | 0..1 (0.5) | size | booth to big live room |
| `view` | DRUMMER AUDIENCE (DRUMMER) | width | the stereo picture |
| `humanize` | 0..1 (0.5) | depth | how much each stroke varies |
| `velocity` | -1..1 (0) | sens | the velocity curve |
| `<piece>_tune` | -12..12 st (0) | pitch | kick, snare, hat, tom1-tom4, ride, crash1, crash2, china, splash |
| `<piece>_decay` | 0.2..2.5 x (1) | decay | the same pieces |
| `<piece>_level` | -40..6 dB (0) | level | the same pieces, in every mic (-40 off) |
| `snare_wires` | 0..1 (0.6) | tone | 0 snares off, 1 loose and buzzy |
| `perc_level` | -40..6 dB (0) | level | tambourine, cowbell, shaker, claps |

That is 50 params. The order puts the kit-wide ones first, so a perceptual move ("longer", "bigger") lands on
`decay` or `room_size` before any one piece. The room's mono low end is not a param (section 5, "The low end in
mono").

The presets:

- one for each kit: Maple 70s, Birch modern, Jazz club, Arena, Dead 70s
- three mixes: Dry and tight, Big room, Crushed

## 5. Measurements

### Levels

On the GM drum phrase (`audio/testsignals.js`, what the device check plays), at the defaults: -17.8 LUFS, -1.35 dBTP,
crest 18.8 dB (the device check in Chromium reads -18.0). The house aims instruments at about -16, inside -18.5 to
-13.5. Studio A sits 2 dB under that on purpose, so the limiter only shaves the hardest backbeats: a snare is 7.3 dB
louder from velocity 0.4 to 1.0, a kick 8.8. A fader before it moves a stroke under it by what it says (snare_level
-6 is 5.8 dB at velocity 0.3); a full backbeat the limiter was holding gives some of it back (3.3 dB at 0.9). At
-17.5 the limiter would take 3 dB off a lone 0.9 backbeat, so the default stays at -18 and the track fader adds the
rest.

| | LUFS | dBTP |
|---|---|---|
| kit BIRCH, default mix | -17.7 | -1.21 |
| kit JAZZ, default mix | -16.9 | -1.44 |
| kit ARENA, default mix | -17.2 | -1.17 |
| kit DEAD, default mix | -18.3 | -1.45 |
| preset Birch modern | -18.0 | -1.21 |
| preset Jazz club | -18.8 | -1.45 |
| preset Arena | -16.2 | -1.18 |
| preset Dead 70s | -18.6 | -1.45 |
| preset Dry and tight | -18.6 | -1.33 |
| preset Big room | -16.3 | -1.45 |
| preset Crushed | -16.7 | -1.44 |

Every preset's tail is under -60 dBFS within 3 s of the last note-off.

The device check in Chromium (full mode) reads -18.2 LUFS (-18.0 before the room went mono under 120 Hz), -1.4 dBTP,
a 3.05 s tail and 80 samples of latency, the onset landing where it is declared. It gives no warnings, renders deterministically, and all 102 extreme settings
are clean. Its CPU figure is in the table below.

**Piece balance.** Each piece's loudness 400 ms after a 0.8 stroke, against the snare. These are the targets `GAIN`
was set to:

| piece | target |
|---|---|
| kick | -2.5 dB (its big low peaks need the room) |
| toms | -1.5 dB |
| closed hat | -10 dB |
| ride | -8 dB |
| crashes | -1 dB |
| china | -2 dB |
| splash | -5 dB |
| tambourine | -10 dB |
| cowbell | -8 dB |
| shaker | -12 dB |
| claps | -5 dB |

Measured, every piece lands within 1 dB of its target against the snare. The kick reads -1.6, not -2.5: a 0.8 snare
gives the limiter a little.

### The low end in mono

A producer measured the kick's low end out of phase between left and right (`docs/FRESH-EYES-6.md`, Broken 5). The
room's reflections reach its two mics at different times and alternate in sign, and its tail differs on each side,
so under 120 Hz the room pair alone correlated -0.20: what it added to one side it took from the other. The fix is
what an engineer does to a room pair: mid and side, the side through a high pass (here fourth order, at 120 Hz), the
middle untouched. Under 120 Hz the room is mono; above 150 Hz it is as wide as it was; and since the middle is
untouched, the room's share of the mono mix is the same.

Measured the producer's way: each channel through two one-pole low passes at 120 Hz, then the correlation of the two.
The mono loss is the middle's level against the two sides'. Eight kicks at velocity 0.9, before (283b44a) and after:

| | under 120 Hz, before | after | lost in mono, before | after |
|---|---|---|---|---|
| the default mics | 0.76 | 1.00 | 0.6 dB | 0.0 dB |
| Vacancy's drum settings | 0.47 | 0.99 | 1.3 dB | 0.0 dB |
| the room pair alone | -0.20 | 0.96 | 4.0 dB | 0.1 dB |
| Vacancy's drum track, as the song plays it | 0.26 | 0.94 | 2.0 dB | 0.1 dB |

Vacancy's whole mix went from 0.50 under 120 Hz (1.2 dB lost in mono) to 0.96 (0.1 dB). Every preset's kick reads
0.98 or more. Big room was 0.50, Jazz club 0.54 and Arena 0.55; Dead 70s and Dry and tight were 1.00 already.

The width above 150 Hz, measured as the side's level under the middle and the correlation, each channel through a
fourth-order high pass at 150 Hz:

| | before | after |
|---|---|---|
| the drum phrase at the defaults | -6.71 dB, 0.649 | -6.84 dB, 0.660 |
| Vacancy's drum track | -3.12 dB, 0.347 | -3.25 dB, 0.362 |

Octave by octave, the side under the middle in dB:

| octave (Hz) | 30-60 | 60-120 | 120-240 | 240-480 | 480-960 | 960-1920 | 1920-3840 | 3840-7680 | 7680-15360 |
|---|---|---|---|---|---|---|---|---|---|
| the drum phrase, before | -7.5 | -7.8 | -8.3 | -6.6 | -4.6 | -2.4 | -5.2 | -4.3 | -7.4 |
| the drum phrase, after | -26.1 | -10.8 | -9.8 | -6.5 | -4.2 | -2.3 | -5.2 | -4.4 | -7.4 |
| Vacancy's drum track, before | -0.1 | -5.9 | -2.2 | -2.1 | -2.2 | -1.6 | -3.2 | -4.6 | -6.1 |
| Vacancy's drum track, after | -23.0 | -12.5 | -2.4 | -2.1 | -2.7 | -1.9 | -3.2 | -4.6 | -6.1 |

From 240 Hz up every octave is within 0.5 dB of where it was. `tools/studioa-test.js` holds the kick at 0.9 or more
(the default mics, Vacancy's settings, the room alone), Vacancy's track under 0.5 dB lost in mono, and the width
above 150 Hz within 0.5 dB and 0.03 of the figures before.

Why the room alone, and why this filter. Two other ways were measured and set aside:

- **The same high pass on the overheads' side** swaps the toms between the overheads. A spaced pair places a tom by
  the time it takes to reach each mic, and a high pass turns the side's phase near its corner, so that time
  difference comes out as a level difference the wrong way round. Fourth order at 120 Hz moved rack tom 1 from 2.0 dB
  left to 3.9 dB right; even second order at 60 Hz moved floor tom 2 from 4.9 dB right to 1.9 dB left. The overheads'
  low end is in phase already, since the kick sits between them (1.00 under 120 Hz from the overheads alone).
- **A Linkwitz-Riley crossover** (the side high-passed, the middle through the all-pass the crossover sums to) keeps
  the overheads' picture. But its all-pass turns the pairs' middle against the close mics, and the tone moves where
  they sum: at 90 Hz on both pairs, the snare's centroid went from 815 to 696 Hz and rack tom 1's from 180 to 145 Hz.

On the room the side's phase turn does no harm: its reflections and tail are diffuse, with no picture to swap, and its
middle is untouched. It costs two filters a sample while the room is on; the busy groove still costs x0.66 of Gobo
Kit's CPU.

It is not a param. A room pair's low end out of phase is a fault, not a sound to dial in, and another control on the
mixer would cost the window room it doesn't have at 1280 by 800.

The levels move a little where the room is up, since what it put out of phase no longer adds to the stereo level (the
mono level is the same). On the drum phrase, the same render before and after: the defaults -17.99 to -18.10 LUFS,
Birch modern -17.82 to -17.90, Jazz club -19.01 to -19.39, Arena -16.28 to -16.52, Big room -16.54 to -16.89, Crushed
-16.91 to -16.98. Dead 70s and Dry and tight are unchanged, and every true peak is within 0.02 dB of where it was.

### Against Gobo Kit

Same notes, same render, same measures.

| | Studio A | Gobo FIELD | Gobo ACOUSTIC+ |
|---|---|---|---|
| onset brightness, 0.4 to 1.0: kick / snare / tom / hat / ride | x1.57 / 1.43 / 1.33 / 1.23 / 1.64 | x1.05 / 3.31 / 1.00 / 1.08 / 1.09 | x2.34 / 3.31 / 1.43 / 1.16 / 1.09 |
| stereo correlation (drum phrase) | 0.84 (overheads and rooms; 0.70 before the room went mono under 120 Hz) | 0.97 (panned mono) | 0.97 |
| crest (drum phrase) | 18.8 dB | 11.4 dB (saturated) | 11.9 dB |
| true peak | -1.35 dBTP at -17.8 LUFS | -7.3 dBTP at -16.2 LUFS | -6.7 dBTP at -16.0 LUFS |
| room | a positioned pair: reflections, tail, size | one FDN send | the same |

How to read the table:

- **Velocity colour.** Studio A colours every piece with velocity, from the contact, the noise growing faster than
  the force, and the wash. Gobo's snare reads brighter on this measure because it lowpasses soft strokes at the
  output.
- **Waveform correlation is no score.** Gobo's consecutive snare strokes decorrelate (-0.43 to 0.43) because it
  starts each stroke's modes at random phases. A struck membrane's modes start in phase from the impulse, so Studio
  A's correlate 0.74-0.78 at the body and differ in the noise, the way two takes of one drum do.

### CPU

Measured on a quiet machine:

| measure | Studio A | Gobo Kit |
|---|---|---|
| the drum phrase, timbre-test (a share of an idle core) | 2.38% (0.26% with nothing playing) | 3.04% (1.17%) |
| a busy groove (252 notes in 17 s: 16th hats, a fill every other bar, crash, ride and china ringing), thread CPU time | 2.8% of a core | 4.2% |
| 16 s with nothing playing | under 0.3% | |
| device check's 4 s CPU render (Chromium) | 2.1% | |

With other suites running on the same machine the absolute numbers rise (the busy groove read 4.7% against Gobo
Kit's 7.0%), but the ratio holds at x0.67. So `tools/studioa-test.js` checks the ratio: the busy groove against Gobo
Kit, measured alongside, within a budget of x1.25. Timbre-test holds every drum kit to 6% of an idle core on the drum
phrase.

The costs:

- **Silence is free.** A silent piece costs nothing: its modes are skipped once they die, and a piece with nothing
  ringing isn't run. Once nothing sounds and the output has been silent for 100 ms, the kit, its buses and the
  limiter rest until the next note.
- **Idle buses stop.** The room and crush buses stop when their faders are down and their tails have died.
- **The hot loops allocate nothing.** The membranes' tension glide retunes every 32 samples, and only while a hard
  hit's bend is over 0.2 cents.

## 6. What the next wave should build

Built since (3 October 2026):

- Items 1 and 2, the drawn kit and the mic mixer: `ui/editors/drumroom.js`, drawn from `LAYOUT`, which `drumroom.js`
  now exports and builds its mics from. The mixer has the output meter only, since per-bus meters need a channel from
  the kernel to the page that doesn't exist.
- Item 5's note map: `notes` on the def, read by `get_device`, and the agent prompt names the rows.
- After a producer's pass (`docs/FRESH-EYES-6.md`):
  - The room pair is mono under 120 Hz (section 5, "The low end in mono").
  - In the window, the kick is its shell and the floor before it, from the pedal across to floor tom 1, where its name
    now sits; every piece's name plays that piece.
  - On a touch screen, a finger held on a cymbal chokes it, and the window says so.
  - The window fits a 1280 by 800 screen whole, mic faders included.

1. **The drawn kit editor.**
   - Draw the kit from `POS` (top view, from the drummer's seat; mirror it for VIEW AUDIENCE) and label pieces with
     `PIECES`.
   - A click plays the piece's main articulation (`engine.audition(track, note, vel)`), the click's height setting
     the velocity.
   - Zones on the drawing map to articulations:
     - snare: centre 38, edge 34, rim 40, rim across 37
     - hat: bow 42, shank 22, with an openness slider that writes `mod`
     - ride: bow 51, bell 53, edge 59
     - cymbals: a choke button
   - The selected piece's `<piece>_tune/_decay/_level` are its knobs, from `group`.
   - The kit's own knobs (`group: 'kit'`) sit in a header.
2. **The mic mixer view.**
   - Six faders: `mix_close` `mix_oh` `mix_room` `mix_crush` `bleed` `room_size`.
   - The pieces' level knobs as a strip: they set the piece in every mic.
   - Meters per bus need the kit to report them. A kernel can't post messages, so either measure buses offline (render
     with the others at -40, as the test does) or add a small kernel-to-host meter channel.
   - The VIEW switch belongs on this page.
3. **The groove library and tap-to-find.**
   - **Store.** Grooves as note lists in this note map, with metadata: style, tempo range, meter, feel (straight or
     swung, and how much), bars, pieces used, energy (notes per bar, velocity), fill or not.
   - **Search.** Tap-to-find takes the studio's tap lane (F J K L), or kick/snare/hat steps, as onset vectors on a
     16th grid with velocities. It ranks by a weighted distance:
     - kick and snare positions count most
     - the hat pattern's density next
     - tempo normalised
   - **Show a score.** The match number is what players read [SOS-EZD2].
   - **Humanise the library's timing** with correlated (1/f) deviations, not white noise. Listeners preferred 1/f
     humanising 64% of the time at σ 15 ms [Hennig]. A professional's 16th intervals spread about 8.7 ms, alternate
     long-short (r -0.48), and accent "high–low–medium–low–very high" with the backbeat highest [Rasanen].
4. **The song creator.**
   - From the arranger's sections, pick a groove per section by match to a seed groove.
   - Rise in energy toward choruses: more open hat, ride instead of hat, crash on the downbeat.
   - Write a fill (toms 50 47 45 43, flams 31) into the bar before each section change, and a choke (27) on a stop.
   - One undo step, signed. Arrange-around's structure is the start.
5. **Agent tools.**
   - Expose a drum device's note map as data (`notes: NOTE_MAP` on the def, read by `get_device`), so an agent writes
     articulations by name for whatever kit is on the track.
   - Add the new names to the agent prompt's grid rows. `agent/prompt.js` was off limits tonight; the names are in
     `DRUM_MAP` and docs/AGENTS.md already.
   - Add a `groove_search` tool once the library exists.
6. **Engine follow-ups.**
   - tom rimshots
   - brushes (sweeps as a held note)
   - hand percussion for GM 60-68 (bongos, congas, timbales on the membrane model)
   - per-close-mic EQ and compression
   - a bleed matrix (per pair, not one amount)
   - a snares-off articulation note
   - mallet rolls on cymbals (the roll machinery on a cymbal)
   - room mic distance as a param
   - tom resonance when the kick and snare play [BFD3]. It is cheap per tom, but it keeps four modal banks running
     through every groove, so it waits for a CPU budget.

## 7. Open questions for AJ

- **The id.** It is `core.drumroom`, not the suggested `core.studioa`.
  - The recorder, Sketch, transforms, arrangement and the arrange tool find drum tracks with `/drum/` on the device
    id (`input/recorder.js` `/drum|kit|beat/`, `core/transforms.js`, `core/arrangement.js`, `agent/arrange-tool.js`,
    `ui/sketch.js`). Two of those files were off limits tonight.
  - With `core.studioa`, a new Studio A track named "Studio A" would not take tapped beats, would be transposed by
    transforms, and would split hits at section cuts.
  - Ids are forever, so this is the one to confirm before anything ships.
- **The toms.** GM 45 on floor tom 1 (the house names stay four drums) or on rack tom 2 (the common commercial map).
- **The default mix.** Close 0, overheads -2, room -8, crush off, bleed 0.5: a studio sound, not a dry one.
- **The default loudness.** -18 LUFS on the drum phrase, 2 dB under the house's -16 and inside its window. Reaching
  -16 at -1 dBTP means about 3 dB more limiting on every backbeat; the kit keeps its dynamics and the track fader
  makes up the level. A louder default is a one-number change (`OUT`).
- **The output stage.** The preamps and limiter are always on. Should the mixer view offer them as controls?

## Sources

**Product documentation and reviews**

- [TT-mics] Toontrack, Superior Drummer 3 Microphone & Input List (reseller-hosted): https://ms.bestservice.com/download_files.php/8669/en
- [TT-kits] Toontrack, Superior Drummer 3 Kit & Instrument List (reseller-hosted): https://ms.bestservice.com/download_files.php/8668/en
- [TT-EZD3] Toontrack, EZdrummer 3: https://www.toontrack.com/product/ezdrummer-3/
- [SOS-SD3] Sound On Sound, Toontrack Superior Drummer 3 review: https://www.soundonsound.com/reviews/toontrack-superior-drummer-3
- [SOS-EZD2] Sound On Sound, Toontrack EZdrummer 2 review: https://www.soundonsound.com/reviews/toontrack-ezdrummer-2
- [SOS-EZD3] Sound On Sound, Toontrack EZdrummer 3 review: https://www.soundonsound.com/reviews/toontrack-ezdrummer-3
- [SOS-AD2] Sound On Sound, XLN Addictive Drums 2 review: https://www.soundonsound.com/reviews/xln-addictive-drums-2
- [BFD3] FXpansion, BFD3: https://www.fxpansion.com/products/bfd3/
- [BFD-Eco] BFD Eco manual: https://d140ffsmluhjx7.cloudfront.net/Documentation/manuals/pdf/BFD_Eco_Manual.pdf
- [SSD] Steven Slate Drums 5.5: https://stevenslatedrums.com/ssd5/

**Acoustics**

- [Rossing] T. D. Rossing, "Acoustics of percussion instruments: recent progress", Acoust. Sci. & Tech. 22(3), 2001: https://www.jstage.jst.go.jp/article/ast/22/3/22_3_177/_pdf
- [Russell] D. Russell, Vibrational modes of a circular membrane: https://www.acs.psu.edu/drussell/Demos/MembraneCircle/Circle.html
- [Avanzini-Marogna] F. Avanzini and R. Marogna, "A modular physically based approach to the sound synthesis of membrane percussion instruments", IEEE TASLP 2010: https://avanzini.di.unimi.it/downloads/publications/avanzini_taslp10.pdf
- [Avanzini-Bank] F. Avanzini, R. Marogna and B. Bank, "Efficient synthesis of tension modulation in strings and membranes based on energy estimation", JASA 2012: http://home.mit.bme.hu/~bank/publist/jasa12.pdf
- [Avanzini-Rocchesso] F. Avanzini and D. Rocchesso, "Controlling material properties in physical models of sounding objects", DAFx-01: https://www.dafx.de/paper-archive/2001/papers/avanzini.pdf
- [Dahl] S. Dahl, "Striking movements: a survey of motion analysis of percussionists", Acoust. Sci. & Tech. 32(5), 2011: https://www.jstage.jst.go.jp/article/ast/32/5/32_5_168/_pdf
- [Torin-Bilbao] A. Torin, B. Hamilton and S. Bilbao, "An energy conserving finite difference scheme for the simulation of collisions in snare drums", DAFx-14: https://www.ness.music.ed.ac.uk/wp-content/uploads/2014/06/dafx14_submission_56-3.pdf
- [Chaigne-Touze] A. Chaigne, C. Touzé and O. Thomas, "Nonlinear vibrations and chaos in gongs and cymbals", Acoust. Sci. & Tech. 26(5), 2005: https://www.jstage.jst.go.jp/article/ast/26/5/26_5_403/_pdf
- [Hihat] Wikipedia, Hi-hat: https://en.wikipedia.org/wiki/Hi-hat
- [Tune-Bot] Tune-Bot drum tuning guide (vendor): https://tune-bot.com/tuning-guide/

**Recording**

- [DPA-kit] DPA, How to mic a drum kit: https://www.dpamicrophones.com/mic-university/how-to-mic/how-to-mic-a-drum-kit/
- [DPA-snare] DPA, How to mic a snare drum: https://www.dpamicrophones.com/mic-university/how-to-mic/how-to-mic-a-snare-drum/
- [DPA-stereo] DPA, Stereo recording techniques: https://www.dpamicrophones.com/mic-university/audio-production/stereo-recording-techniques-and-setups/
- [DPA-comb] DPA, The basics about comb filtering: https://www.dpamicrophones.com/mic-university/audio-production/the-basics-about-comb-filtering-and-how-to-avoid-it/
- [Mix] Mix, "Classic Tracks: Phil Collins' In the Air Tonight": https://www.mixonline.com/recording/classic-tracks/classic-tracks-phil-collins-air-tonight-365521
- [Levee] Wikipedia, When the Levee Breaks: https://en.wikipedia.org/wiki/When_the_Levee_Breaks

**Groove and timing**

- [Hennig] H. Hennig et al., "The nature and perception of fluctuations in human musical rhythms", PLoS ONE 2011: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0026457
- [Rasanen] E. Räsänen et al., "Fluctuations of hi-hat timing and dynamics in a virtuoso drum track of a popular music recording", PLoS ONE 2015: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0127902
