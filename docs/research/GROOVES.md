# Grooves: a library played by a drummer, tap-to-find, and drums for the whole song

AJ asked for "Superior Drummer 3 kinda deal" and to "expand upon what the drum situation in general creatively". The
big drum programs are loved for their sound and for three things beside it: a groove library recorded by real
drummers, a way to find a groove by tapping it, and a song creator that turns a groove into a whole song's drums.
This note covers the second half: the library, the matcher and the song creator. Studio A (`core.drumroom`, an
acoustic kit with articulations and a mic mix, docs/research/STUDIO-A.md) was built beside it the same night. The
library plays on it, on a preset per style, and uses a few of its articulations where Studio A is the kit.

What was built:

- `app/src/core/grooves.js`, pure and seeded: the text format, feel and humanising, tap-to-find and the song creator.
- `app/src/core/grooves/`: 22 style files, 208 grooves.
- `app/src/ui/grooves.js`: the Grooves tab, beside Beat.
- `app/src/agent/grooves-tool.js`: three tools, `find_grooves`, `use_groove` and `drum_track`.
- The demo agent's one honest move: "give me a funk beat" offers three of the funk family as takes.
- `tools/grooves-test.js` checks all of it.

## 1. What people love and hate

The research for this note had no web search left in its session. It worked from manuals, reviews in Sound On Sound,
papers and vendor pages it could reach directly. Forum threads (Gearspace, KVR, Reddit) were mostly out of reach,
so complaints are taken from what vendors built against, and say so.

**Played by people.** "Played by a person" is what the vendors sell first:

- Toontrack: EZdrummer 3's grooves are "performed on electronic kits by professional drummers", more than 2,500 of
  them, "organized in common song structure parts (intro, verse, pre-chorus, chorus etc.)" [1].
- XLN: Addictive Drums 2's packs are "organic beats played by actual humans" [2].
- Magenta's Groove MIDI Dataset found that commercial loops "may be edited in post-production to remove human error
  and variation". That is why it recorded 13.6 hours of its own, from 10 drummers [3].

So "real drummer" is partly the feel. The engine below models that feel; it doesn't sample it.

**White-noise humanising sounds wrong.** Hennig et al. measured a professional drummer's timing:

- the drummer's timing errors have long-range (1/f) correlations;
- "the humanizing tools of widely used professional software applications generally apply white noise fluctuations";
- in a listening test, 39 people preferred correlated fluctuations to white noise at the same 15 ms spread [4].

Roger Linn, who put swing in the MPC, never found random timing "to do much good"; "if the note dynamics and swing
are right, then the groove works best when the notes are played at exactly the perfect time slots" [5].

**Exaggerated microtiming lowers groove ratings.** Three studies agree:

- Senn et al., 160 listeners: fully quantized and the original performed timing were "rated equally high" [6].
- Frühauf, Kopiez & Platz: a quantized rock pattern was rated highest; shifting the snare hurt more than the kick, and
  early hurt more than late [7].
- Davies et al.: scaling idiomatic jazz, funk and samba microtiming up "led to decreased groove ratings"; the jazz
  shuffle's short-long figure was the one exception [8].

The design takes this literally. The feel is in dynamics, swing and a style's consistent lay. The random part is
small (2 to 7 ms) and correlated.

**Ghost notes and velocity.** Reviewers single these out. EZdrummer 3 adds snare ghost notes "and control[s] their
number and intensity", with "very natural and authentic results". Superior Drummer 3's Edit Play Style adjusts "the
number of hits and the velocity for each individual drum" [9][10].

**Finding things.** Reviewers praise libraries that are "painstakingly indexed with metadata" and organised by
"genre‑based categories and then song style, tempo and feel" [11][9]. Smart search is only as good as the library
behind it: Bandmate's "quality of the musical 'fit' is obviously constrained by how well stocked your EZdrummer MIDI
groove library is" [9]. So every groove here carries its style, feel, tempo range, part and length, and the search
covers all of them.

**Song creators.** These are the vendors' answers to the familiar complaints:

- Groove Agent's Crash Mode decides whether intros, fills and endings "play with crash cymbals", Auto Fill plays a
  fill "after a specified interval of bars", and Auto Complexity aims at "a less static playback" [12].
- Logic's Drummer has a Fills knob to "reduce or increase the number and length of fills" [13].

That a fill knob and a crash switch exist means fills in the wrong place and crashes on every downbeat are what
people turn off. User quotes about it couldn't be reached; they are not verified here.

**Tap-to-find.**

- EZdrummer 2's Tap2Find: you tap "against a click using a MIDI keyboard or by clicking on a drum". You can build it
  "in layers", it is "neatly quantised", and results come "in order of how well they match up". Sound On Sound: it
  "works extremely well … often close enough to edit" [11].
- Superior Drummer 3 opens "a blank two-bar MIDI clip" for the tapped pattern [10].
- EZdrummer 3: you "play a basic kick/snare groove to a click" and it "searches all of your groove content" [9].
- The one user complaint found wanted more than four bars, and recording that starts with the first hit [14].

So this one listens without a click and from the first tap, and reads the tempo from the taps.

## 2. The format

A style file is plain text an agent can read and write. One groove is a handful of lines. It extends the drum grid
in `core/music.js` in three ways: a row splits into a group of cells per beat, each group can have its own number of
cells, and the style lines carry the feel.

```
style rock  Rock
blurb   straight eighths, sixteenths or half-time, and a big backbeat on 2 and 4
tempo   88-160            the BPM range it is played at
feel    straight, driving words a search matches
swing   none              8 or 16, a percentage; "68-55%" runs from the slow end of the range to the fast end
lay     snare +3  hat -2  ms behind (+) or ahead (-) of the beat, per piece or family
human   5ms 7%            the humanising: timing spread and velocity spread
accent  hat 1 .84 .66     the time-keeping hand: on the beat, on the "and", on the "e" and "a" (then triplets)
kit     acoustic room .35 acoustic | plus | machine | dust | 808 | 909, and Gobo Kit params
studio  Arena             the Studio A preset an acoustic style plays on, when the studio has Studio A

verse   Straight eighths  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   X... .... X.x. ....
```

- **Cells.** `X` accent (1.0), `x` hit (0.8), `O` soft (0.6), `o` ghost (0.45), `g` feathered (0.28), `f` and `F`
  flams (a grace note 26 ms before), `.` or `-` rest. The first five are music.js's grid marks plus `g`.
- **Groups.** A row is split by spaces or `|` into one group per beat, one per bar, or one for the whole groove. A
  group's cells share its span evenly: four cells are sixteenths, three eighth-note triplets, six sixteenth triplets
  (a trap roll, gospel chops), eight thirty-seconds. A shuffle is written as triplets, `x.x x.x x.x x.x`. A trap
  hat bar is `x.x. x.x. x.x. oxxxxX`.
- **Headers.** A groove opens with `<part> <Name> <N> bars|beats`. Parts are intro, verse, chorus, bridge, half
  (half-time), fill and ending. A groove may override the style's tempo, feel, swing, lay, human or accent on lines
  of its own (jazz's Latin bridge sets `swing none`).
- **Pieces.** Rows are DRUM_MAP names (kick, snare, rim, clap, hat, pedal, open, ride, bell, crash, tom1, tom2, tom3,
  floor, cowbell, shaker, tamb), plus stick, crash2, splash and china, or MIDI numbers. Every groove as written is
  General MIDI, so it plays right on Gobo Kit and on any GM kit.
- **Articulations.** A groove may add `art <row> <articulation>` (`art open half`). On a kit that has articulations,
  Studio A (`core.drumroom`), that row plays the articulation (here the half-open hat, note 24). On any other kit the
  row plays as written. A flam (`f`, `F`) on the snare becomes Studio A's own flam note (31), one note with the
  grace stroke in it; elsewhere it is a grace note 26 ms ahead. The articulation names are music.js's DRUM_MAP:
  half, quarter, hatedge, openedge, rimshot, rideedge, flam, drag, roll, the chokes. They came with Studio A.
- **Errors.** A mistake names the file, the line and what would work: `rock line 23: hat has 5 groups; write one per
  beat (4), one per bar (1), or one for the whole groove`.

## 3. The styles

Twenty-two families. Each has an intro, a verse (often two), a chorus that is bigger (hats move to the ride or open
up, or the kick doubles), a bridge, fills of a beat, two beats and a bar, and an ending. Fifteen have a half-time
feel where one fits.

| style | tempo | feel | what makes it that style |
|---|---|---|---|
| Rock | 88–160 | straight | eighths or sixteenths on the hat, the backbeat on 2 and 4; ride and a pushing kick in the chorus; floor-tom bridge |
| Pop | 84–132 | straight | eighth hats, kick on 1 and 3, a clean backbeat; ride and claps in the chorus |
| Indie | 100–150 | four on the floor | dance-punk hats (open on the "and") over a four-on-the-floor kick; floor-tom and garage beats |
| Punk | 150–210 | pushed | the skank beat (kick on the beat, snare on the "and"); hands 6 ms ahead; open hats in the chorus |
| Metal | 100–200 | double kick | sixteenths on two feet under 2 and 4; a gallop, a blast, a china breakdown |
| Funk | 88–118 | sixteenths | sixteenth hats, ghost notes all over the snare, a syncopated kick 8 ms ahead; a linear fill |
| Motown | 100–140 | four on the snare | the snare on every beat, tambourine on 2 and 4 [15] |
| Disco | 108–130 | four on the floor | the open hat hissing on every "and", sixteenths between [16] |
| Gospel | 70–140 | swung sixteenths | a pocket with ghost notes; chops in sixteenth triplets round the kit |
| Neo-soul | 68–96 | behind the beat | the snare 24 ms late, hats 10 ms late, swung sixteenths at 60–56% |
| Boom bap | 80–98 | swung sixteenths | kick on 1 and the "a" of 2, hard snare; 56% swing, the sampler's DUST kit [17][18] |
| Lo-fi | 64–90 | dusty | soft, late, swung 62–58%; a rim click; the DUST kit |
| Trap | 130–160 | half-time | the clap on 3; eighth hats with rolls in sixteenth triplets and thirty-seconds; the 808 [19] |
| House | 118–130 | four on the floor | a 909 kick on every beat, claps on 2 and 4, the open hat on the off-beat, 54% shuffle |
| Drum and bass | 160–178 | two-step | kick on 1 and the "and" of 3, snare on 2 and 4 [20][21] |
| Jazz | 100–240 | swung eighths | spang-a-lang on the ride, the hat foot on 2 and 4, a feathered kick; swing 68% slow to 55% fast |
| Blues shuffle | 70–140 | twelve-eight | written in triplets; the double shuffle in the chorus [22] |
| Country | 90–160 | train | sixteenths on the snare with 2 and 4 on top (the train beat); boom-chick in the chorus |
| Reggae | 64–92 | one drop | kick and cross-stick together on 3, nothing on 1; steppers (four on the floor) in the chorus [23] |
| Bossa nova | 110–150 | Brazilian | the bossa clave on the cross-stick over two bars; the surdo's pattern in the kick [24] |
| Samba | 92–126 | in two | the surdo in the kick (soft on 1, strong on 2, a sixteenth before each), a partido-alto cross-stick |
| Afrobeat | 96–126 | rolling | an open-and-closed hat that never stops, a skipping kick, ghosted snare and floor tom [25] |

Machine styles play on Gobo Kit's machines: trap on its 808, house on its 909, boom bap and lo-fi on DUST. Acoustic
styles play on Studio A (`core.drumroom`) when the studio has it, on the preset the style's `studio` line names:

| Studio A preset | styles |
|---|---|
| Arena | rock, metal |
| Birch modern | pop, punk, gospel |
| Maple 70s | indie, Motown, shuffle, country |
| Dead 70s | funk, neo-soul, reggae, afrobeat |
| Jazz club | jazz, bossa |
| Dry and tight | disco, drum and bass |
| Big room | samba |

Without Studio A they play on Gobo Kit's ACOUSTIC+, where velocity changes the colour as well as the level. That
matters when the feel is in the dynamics.

Three grooves use Studio A's articulations, each with a General MIDI fallback:

- rock's second chorus and disco's chorus open the hats halfway (`art open half`);
- rock's bar fill and Motown's open on a flam.

Rock's first chorus puts the bell on the beat and the bow on the "and"s, which is General MIDI already (53 and 51),
so it plays the same on both kits.

Two of the asked-for facts couldn't be verified from a source and rest on common drumming practice: the country
train beat and gospel chops. Songo was offered as the alternative to samba; samba was built.

## 4. Feel and humanising

`realize(groove, { tempo, seed, human })` plays the grid as a drummer would, in this order:

1. **Swing.** An offbeat on the 8 or 16 grid moves to the style's percentage, interpolated over its tempo range.
   Friberg & Sundström measured ride swing ratios as high as 3.5:1 at slow tempi, falling to 1:1 at fast ones [26].
   Jazz here runs from 68% at 100 BPM to 55% at 240. Hip-hop breakbeats swing their sixteenths subtly, median about
   1.2:1 (55%), and not with tempo [17], so boom bap is a flat 56%. Linn: 54% "will loosen up the feel without it
   sounding like swing" [5]. Triplet groups aren't swung again: they are already the swing.
2. **The hand's accents.** Time-keepers (hat, ride, shaker, tambourine, cowbell) get a profile across the beat. By
   default that is 1.0 on the beat, 0.84 on the "and", 0.66 on the "e" and "a", 0.78 on triplets. So hats written
   as plain `x` already lean on the beat, and a style can set its own (funk 1, .74, .58).
3. **Lay.** A style's consistent placement, in ms at the song's tempo:
   - neo-soul's snare +24, lo-fi's +14;
   - punk's hats −6;
   - funk's kick −8. Kilchenmann & Senn measured a funk kick's median at −12.5 ms and the hat at −3 [27].
   - jazz's hat foot −14. In their swing data the foot hat sat at −33 [27].

   No millisecond source for neo-soul or Dilla backbeats could be reached. Danielsen's book is paywalled. Studies of
   laid-back playing (Danielsen et al.; Câmara et al.) show laid-back strokes land later and are often played louder
   [28]. The +24 is a design choice inside the 10–30 ms range the in-app agent's prompt already uses.
4. **Humanising**, from `rng(groove id + seed)`, never `Math.random`:
   - a timing drift that is AR(1) per sixteenth (φ = 0.86, so a slow wander, correlated as Hennig found);
   - a smaller independent spread per hit (the limbs don't land together);
   - velocity spread with a slower swell.

   Normal deviates come from four uniforms (Irwin–Hall), so there is no `Math.log` or `Math.cos` whose last bit
   differs between V8 builds. The same groove, seed and tempo give the same notes everywhere. Measured over 16 bars
   of rock sixteenths, the drift's lag-1 correlation is above 0.3 and its spread a few ms.

The test holds the numbers to it:

- the jazz ride's "and" lands at 67.0% of the beat at 100 BPM, 59.8% at 170 and 52.6% at 240 (the ride's −6 ms lay
  included);
- the neo-soul backbeat is 24.0 ms late;
- the punk hats are 6.0 ms early;
- humanised, every neo-soul backbeat stays behind the beat.

## 5. Tap-to-find

The taps are two bars or so on three pads (Kick, Snare, Hat; F, J, K once a pad has been tapped), timed by the
event's own timestamp, with no click and no quantizing. The library is searched 1.4 s after the last tap.

**The tempo.** `tempoFromTaps` tries every tempo from 56 to 200 BPM in half-BPM steps against seven readings of a
beat:

- straight sixteenths;
- eighth-note triplets (a shuffle);
- swung eighths at 58% and 62%;
- swung sixteenths at 56%, 60% and 64%.

Each reading is tried with the first tap on each of its positions. A reading costs:

- how far the taps sit from it, in grid steps (so a finer grid isn't free: the taps' own spread counts against it);
- how many taps land off its main pulses;
- a small cost for being swung or triplet;
- a log-normal prior around 105 BPM.

The winner is refined by least squares through the taps' places. Without the triplet and swung readings, shuffles
and lo-fi came out at 3/4 or 4/3 of their tempo.

**The match.** For every main groove (verse, chorus, bridge, half-time):

1. **Shifts.** Every cyclic shift that puts the first tap on one of the groove's hits is tried, so the person can
   start anywhere.
2. **Tempos.** Each shift is scored at the read tempo and at its other readings: half and double (half-time against
   double-time), and 2/3, 3/4, 4/5 and their inverses (a swung or triplet feel read as straight).
3. **Kick and snare first.** With two or more pads used, kick taps are scored against the groove's kick and snare
   taps against its snare family. With one pad, all taps are scored against kick and snare together.
4. **Every piece second.** All taps are scored against every hit.
5. **Weights.** The score is 0.7 × the kick and snare score plus 0.3 × the every-piece score, times how well the tempo
   suits the groove's range (1 inside it, about a third a quarter outside).

Each score is a soft F-measure:

- **precision:** each tap's credit is 1 − (d/τ)² for its distance d to the nearest hit, with τ = 0.15 beat; a ghost
  note counts at 0.85;
- **recall:** each main hit in the tapped stretch should have a tap near it.

Ghost notes may be landed on but never have to be tapped. A voice played only as ghosts (jazz comping, a feathered
kick) counts its ghosts as its hits.

This is close to what the rhythm-similarity literature recommends. Toussaint found the chronotonic and swap
distances best among symbolic measures [29]. The necklace swap problem adds cyclic rotations [30]. Query-by-tapping
systems compare onset times from the first onset [31][32]. The soft F-measure keeps what those do (tolerance to
timing, rotation, differing counts) and works on real-valued onsets with no quantizing.

**Measured** (tools/grooves-test.js, every main groove's own onsets, jittered ±12 ms, at its middle tempo):

| case | first | tied with an identical groove | in the closest five | tempo error |
|---|---|---|---|---|
| all voices, from the downbeat | 84 of 97 | 12 | 97 of 97 | median 0.08%, worst 0.4% |
| all voices, starting at beat 2.5 | 84 of 97 | 13 | 97 of 97 | median 0.09%, worst 0.3% |
| kick and snare pads, main hits only | 61 | 11 | 88 | (experiment) |
| one pad, kick and snare rhythm | 50 | 14 | 82 | (experiment) |

The one miss from the downbeat ties within 0.002 (house's Full against disco's Four on the floor, nearly the same
hats). With fewer pads, more grooves share a pattern. That is a fact about drumming, not a bug: kick on 1 and 3 with
a snare on 2 and 4 is a hundred grooves. So the pad has three pads, and the results show their score.

## 6. The song creator

`planDrumTrack(song, { style, seed, parts })`, the tab's **Build drums for the song**, and `drum_track`:

- **Family.** The style chosen, or the one closest to the song's drums (the matcher, run on its drum part), or one
  played at its tempo.
- **Sections.** The arranger's sections. With none, one is made: over the loop when it is on, then with no ending, so
  the loop goes round. Otherwise over the song's length. It is added to the song in the same undo step.
- **Parts by name.** Intro; verse (also pre-chorus, rap, A); chorus (also hook, refrain, solo); bridge (also middle
  8, interlude, B); half-time (breakdown, break, drop); outro (it plays the chorus groove, then the ending).
- **Parts by energy.** Otherwise by energy: velocity-weighted notes per beat in the other parts, against the median
  section. At 1.25 × the median or more it is a chorus; at 0.6 × or less, a bridge; else a verse. `parts` overrides
  any of it, by section name or id.
- **Grooves.** The n-th section of a part plays the n-th groove written for it, of those that suit the song's tempo,
  so Verse 2 can be the style's second verse.
- **Fills.** A fill goes in the last bar before each change, when the next section starts where this one ends. Going
  up (into a chorus) it is a bar of fill, or two beats in a section under four bars. Coming down it is two beats.
  Between equals it is one beat. A one-bar intro gets none: its own groove is the way in.
- **Crashes.** A crash goes on the downbeat of every new section, with the kick, and the hand comes off the hats for
  it. There is none on an intro at the top of the song.
- **Ending.** The style's ending goes in the last section's last bars, so the track stays one clip per section. When
  the section is too short, it takes the ending's last bars, so the final hit is always there. When the loop is on and
  reaches the song's end, an ending would play on every pass, so by default there is none and the loop goes round
  (round 6 of fresh eyes: Night Shift, looping bars 1–8, played its "Last rim" ending on every pass). The plan offers
  **End with** the style's ending or **Loop it, no ending**, and `drum_track` has `ending` and `crashes` switches.
- **The kit.** It goes on a new track, "Drums" or "Drums 2". Drums already in the song stay as they are, and the
  plan says so. The kit is Studio A on the style's preset, with its articulations, when the registry has
  `core.drumroom` (the brief called it `core.studioa`; it shipped as `core.drumroom`, because the studio knows a drum
  track by "drum" in its id). Otherwise it is Gobo Kit.
- **One step.** One clip per section, one transaction, signed by whoever asked.

**Said first.** The plan is said before anything happens: "Rock, the intro in bars 1–2, verse groove in 3–10, chorus
groove in 11–18, bridge groove in 19–22 and chorus groove in 23–26; fills at 2, 10, 18 and 22; the ending in bars
25–26. On a new track, Drums, Gobo Kit." The tab shows each section's part as a word you can tap to change, then
**Build it**. The tool has `dry_run`.

**Putting one groove.** `planPut` plays a main groove for four bars by default, and an intro or ending for its own
length. A fill lands at the end of its bar. The person's **Put** cuts away what was under it on that track, as a
drop in the arranger does (`planDropTrim`). The agents' `use_groove` refuses bars that hold a clip, so it never
removes anything (its MCP annotation is `destructiveHint: false`), and its hint offers `track: "new"`, a new Drums
track. A `use_groove` dry run returns ops ready for `propose_variations`.

## 7. The room

The Grooves tab, beside Beat, is set like liner notes:

- the groove's name in display italic, its part, length, tempo and feel in mono beside it;
- the styles down the side as words, the chosen one in reverse print;
- each style's grooves as ledger rows under plain part heads.

**The pictures.** Each groove is drawn on three hairline lanes: cymbals over snare and toms over kick.

- the marks are crosses for hats, a cross with an open mark for an open hat, a plus for the ride, a diamond for the
  bell, a slash for the cross-stick, and squares for drums;
- size is velocity and a ghost is hollow;
- each mark is drawn where the song's tempo puts it, so swing and lay show (a neo-soul snare sits visibly behind the
  beat line);
- a bar fills the picture, two bars fit in it, and a one-beat fill is a quarter of it.

**Hearing.** **Hear** goes through `store.preview`, the mechanism variation cards use, so it is never in History:

- a soloed "Hearing" track with the target drum track's kit and inserts;
- or, with the song, in place of the song's drums, which are muted for it;
- four bars from the Put bar, or round the loop when the loop holds it.

It stops on Stop, `Esc`, another tab, an agent's tool call, an edit to it, or the song being replaced. The autosave
can catch a preview, so a key (`overdub:grooves-hearing`) names it while it plays, and the next boot takes a
leftover out.

**Putting and finding.**

- **Drag** a groove onto the arranger: `app.arranger.locate` finds the bar and the drum track there, with no edit to
  arranger.js.
- **Tap ticks.** The taps draw as warm ticks (the person's) on a beat grid.
- **The last placement** is signed with a byline, warm or cool.

**On a phone** the tab is one column: styles as a row of words, 44 px targets, no text under 12 px. A fallback
sizes the detail tabs by their words (min 44 px), so the seventh tab doesn't cut "Reference" short; it belongs in
`ui/shell.js`.

## 8. What's next

- **More of Studio A's articulations.** The mechanism is in (`art` lines, flams), and three grooves use it. Next, where
  each style's idiom asks:
  - funk's hats a quarter open on the "a";
  - rock's backbeat as rimshots in the chorus (`art snare rimshot`);
  - jazz's ride edge in the shout chorus;
  - metal's crash chokes at the end of a fill;
  - a hat's openness from its note's `mod`, which Studio A reads, for a hat that opens across a bar.

  When Studio A has brushes, bossa and country get them. The `accent` line could map velocity bands to articulations
  (a ghost to a snare-edge hit) for kits that have them.
- **Build a band using the library.** `core/arrange.js` has its own five drum grids. It should take its drums from
  this library instead: the family closest to the seed (`styleForSong` on the seed's rhythm), the verse groove for
  the band, fills from the family, and the bass riding that groove's kick.
- **Other meters.** Waltzes, 6/8 ballads and a jazz waltz (`meter 3/4` exists in the format). The planners refuse
  other meters and say so.
- **A Follow mode**, as Logic's Drummer has: the kick and snare follow another track's rhythm. The matcher already
  reads rhythm from notes.
- **Per-groove controls.** Complexity, a fills amount, a crash-mode switch: the controls the vendors added for the
  complaints above.
- **More tap readings.** A quintuplet or septuplet reading for Dilla-style grooves (Attack's recipe uses those grids
  [18]).
- **The tab's numbers live**: the tapped tempo against the song's tempo, with a button to set the song to it.

## Sources

1. Toontrack, EZdrummer 3: https://www.toontrack.com/product/ezdrummer-3/
2. XLN Audio, Addictive Drums 2 and MIDIpaks: https://www.xlnaudio.com/products/addictive_drums_2 ; https://www.xlnaudio.com/products/addictive_drums_2/midipak
3. Gillick, Roberts, Engel, Eck & Bamman, "Learning to Groove with Inverse Sequence Transformations", ICML 2019: https://arxiv.org/abs/1905.06118 ; the Groove MIDI Dataset: https://magenta.tensorflow.org/datasets/groove
4. Hennig, Fleischmann, Fredebohm et al., "The Nature and Perception of Fluctuations in Human Musical Rhythms", PLoS ONE 2011: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0026457
5. Attack Magazine, "Roger Linn on swing, groove and the magic of the MPC's timing" (2013): https://www.attackmagazine.com/features/interview/roger-linn-swing-groove-magic-mpc-timing/
6. Senn, Kilchenmann, von Georgi & Bullerjahn, "The Effect of Expert Performance Microtiming on Listeners' Experience of Groove in Swing or Funk Music", Frontiers in Psychology 2016: https://www.frontiersin.org/articles/10.3389/fpsyg.2016.01487/full
7. Frühauf, Kopiez & Platz, "Music on the timing grid: The influence of microtiming on the perceived groove quality of a simple drum pattern performance", Musicae Scientiae 2013: https://doi.org/10.1177/1029864913486793
8. Davies, Madison, Silva & Gouyon, "The Effect of Microtiming Deviations on the Perception of Groove in Short Rhythms", Music Perception 2013: https://doi.org/10.1525/mp.2013.30.5.497
9. Sound On Sound, Toontrack EZdrummer 3 review (J. Walden, June 2022): https://www.soundonsound.com/reviews/toontrack-ezdrummer-3
10. Sound On Sound, Toontrack Superior Drummer 3 review (Walden and Gordon, October 2017): https://www.soundonsound.com/reviews/toontrack-superior-drummer-3
11. Sound On Sound, Toontrack EZdrummer 2 review (P. White, May 2014): https://www.soundonsound.com/reviews/toontrack-ezdrummer-2
12. Steinberg, Groove Agent 5.2 manual, the Style Player: https://www.steinberg.help/r/groove-agent/5.2/en/halion/topics/working_with_pads/style_player_r.html?contentId=1BMxIZCg8svg~Ib2LIEh7w
13. Apple, "Edit drummer regions in GarageBand for Mac": https://support.apple.com/guide/garageband/edit-drummer-regions-gbndcaf22b29/mac
14. Toontrack forum, "Tap2Find" (2014): https://www.toontrack.com/forums/topic/tap2find/
15. Wikipedia, Motown (tambourines accenting the backbeat; "a four-beat drum pattern"): https://en.wikipedia.org/wiki/Motown
16. Wikipedia, Disco ("an open hissing hi-hat on the off-beat"): https://en.wikipedia.org/wiki/Disco
17. Frane, "Swing Rhythm in Classic Drum Breaks From Hip-Hop's Breakbeat Canon", Music Perception 2017: https://doi.org/10.1525/mp.2017.34.3.291
18. Attack Magazine, Beat Dissected: 90s boom bap hip-hop; drunk drummer-style grooves: https://www.attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/ ; https://www.attackmagazine.com/technique/beat-dissected/drunk-drummer-style-grooves/
19. Wikipedia, Trap music (half-time; divided hi-hats): https://en.wikipedia.org/wiki/Trap_music
20. Wikipedia, Drum and bass (160–180 BPM): https://en.wikipedia.org/wiki/Drum_and_bass
21. Attack Magazine, Beat Dissected: raw drum & bass; an incessant drum & bass beat: https://www.attackmagazine.com/technique/beat-dissected/raw-drum-bass/ ; https://www.attackmagazine.com/technique/beat-dissected/incessant-drum-bass-beat/
22. Wikipedia, Swing (shuffle; 12/8): https://en.wikipedia.org/wiki/Shuffle_rhythm
23. Wikipedia, One drop rhythm: https://en.wikipedia.org/wiki/One_drop_rhythm
24. Wikipedia, Bossa nova (the surdo pattern; the bossa clave): https://en.wikipedia.org/wiki/Bossa_nova
25. Wikipedia, Tony Allen (musician): https://en.wikipedia.org/wiki/Tony_Allen_(musician)
26. Friberg & Sundström, "Swing Ratios and Ensemble Timing in Jazz Performance", Music Perception 2002: https://doi.org/10.1525/mp.2002.19.3.333
27. Kilchenmann & Senn, "Microtiming in Swing and Funk affects the body movement behavior of music expert listeners", Frontiers in Psychology 2015: https://www.frontiersin.org/articles/10.3389/fpsyg.2015.01232/full
28. Danielsen and colleagues, JASA 2015 (ten drummers playing laid-back, on-beat and pushed snare strokes; most played laid-back strokes louder): https://doi.org/10.1121/1.4930950 ; Câmara, Nymoen, Lartillot & Danielsen, Music Perception 38(1), 2020 (22 drummers; with a backing track, pushed strokes earlier and laid-back strokes later): https://doi.org/10.1525/mp.2020.38.1.1
29. Toussaint, "A Comparison of Rhythmic Similarity Measures", ISMIR 2004: http://www.ee.columbia.edu/~dpwe/ismir2004/CRFILES/paper134.pdf
30. Ardila et al., "Necklace Swap Problem for Rhythmic Similarity Measures", SPIRE 2005: https://doi.org/10.1007/11575832_27
31. MIREX 2014, Query by Tapping: https://music-ir.org/mirex/wiki/2014:Query_by_Tapping ; Jang, Lee & Yeh, "Query by Tapping: A New Paradigm for Content-Based Music Retrieval from Acoustic Input", PCM 2001: https://doi.org/10.1007/3-540-45453-5_76
32. Hanna & Robine, "Query by Tapping System Based on Alignment Algorithm", ICASSP 2009: https://hal.science/hal-00391091v1
33. Witek, Clarke, Wallentin, Kringelbach & Vuust, "Syncopation, Body-Movement and Pleasure in Groove Music", PLoS ONE 2014 (medium syncopation rated highest, an inverted U): https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0094446
