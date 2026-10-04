# The Jam room: research and design

*2026-10-03, night run. By the agent that built the room; the room, the agent tools it registers and
`tools/jam-test.js` shipped in the same commit. Screenshots: `tools/.out/jam-*.png` (not committed; the suite remakes them).*

AJ, asking for it: "I want a new section that's basically just like a guitar players dream area. like a jam section.
a place to find ideas and just explore effects and stuff, to vibe jam to diff songs. maybe to learn a thing or two."

This note is four things: what the room is (section 1), what players say about the tools they use for this today,
with sources (section 2), the design and what was built (sections 3 and 4), and what comes next, tabs first
(section 5). Product names appear here and nowhere in the studio's copy.

**How to read the evidence.** **[manual]** a vendor's own page or help; **[review]** a review in the press;
**[store]** an app store or Steam review, quoted as an example of what people say, never as a sample of how many say
it; **[study]** peer-reviewed research; **[inference]** our own reasoning. Nobody tested the other products
hands-on. The web search tool was down for this run, so everything came from fetching pages directly; Reddit, The
Gear Page, Ars Technica, most vendor help centres and several journals refused the fetch. YouTube channels, BandLab,
Jamzone, Boss Tone Studio and Line 6's apps aren't covered.

---

## 0. The short version

1. **Jam is a room in the studio, not another app.** A tab beside Arrange. The song on screen is the band; the room
   follows it. Switching keeps the song playing, and a take recorded in the room is in the arranger after.
2. **The band never waits for you.** Every backing is a real song in steady time: the song you're making, a demo, a
   recent song, or a jam track the house band builds on the spot (ten styles, any key, tempo or chords).
3. **The chords are read from the notes, and the room says so.** The chord now, big; the next one counting down in
   beats; a slash chord when the bass isn't the root. A song made only of audio has no chords to read, and the room
   says that rather than guessing.
4. **The neck is the hero.** Six strings, frets 0-22, five tunings, left-handed; the box, the scale, the chord's tones
   and the next chord's, fading in as the change comes. What you play lights up on every place it falls, filled where
   it fits and a ring where it doesn't, with a line saying what the note is over the chord.
5. **Your rig is the Guitar Studio's.** The interface, a big tuner, and the 156 rigs as a row you flip through and
   hear at once. A tone is one undo step; the chain is shown as its faces.
6. **Practice is loop and slow down.** One tap loops the section; 50-100% speed is the engine's, never in the song or
   History. Audio clips sit out below 100% instead of being stretched badly, and the room says so.
7. **Ideas come from this song's harmony.** The scale and where it sits on the neck, the chord tone to land on at the
   next change, the notes outside the key, a section in another key, and a two-bar lick to see and hear.
8. **Agents get the room too:** `get_jam`, `make_jam_track`, `set_tone`, `show_on_fretboard`.
9. **Tabs are next**, built on the same pieces: notes that carry their string and fret, fingering in one hand position,
   tab text in and out, and play-along feedback that is honest about what a monophonic pitch tracker can hear.

---

## 1. What the room is

A guitarist opens Overdub with a song on screen, or none. They want to play over something, find out what works over
it, hear their guitar sound good, and maybe leave with an idea worth keeping. The room is built around that loop:
**pick something to play over, see where you are in it, play, hear it through a good tone, slow down and loop the hard
part, take one idea away, keep the take.**

What it isn't: a course, a game with a score, a tab library or a separate document. It shares the song, the engine,
the devices and the recorder with the rest of the studio, so nothing learned in the room is lost when you go back to
making the song.

---

## 2. What players say about the tools they use

### 2.1 Backing tracks and play-along

**iReal Pro** generates the band from a chord chart. Its pitch: "more than 50 backing track styles"; "Loop any tricky
section, then push yourself with automatic tempo increase and transposition"; "mute an instrument to take its place";
"Pay once for your platform, no subscription" ([irealpro.com](https://www.irealpro.com/)) [manual]. Complaints: "it
only allows rhythms on the one on the downbeat and nothing on the upbeat"; "The interface is a little tricky"
([App Store](https://apps.apple.com/us/app/ireal-pro/id298206806)) [store].

**Band-in-a-Box** has played chord charts since the early nineties; its RealTracks are recorded players
([Wikipedia](https://en.wikipedia.org/wiki/Band-in-a-Box)). "RealTracks are one of the most amazing features of the
program", but "BIAB is large and deep", "about 108GB" ([Sound On Sound](https://www.soundonsound.com/reviews/pg-music-band-box-2017))
[review]; "a forest of hidden commands, pop-up menus, and dialog boxes", "mastering the program will take weeks or
months", and its melody generator "produces gibberish"
([Synth and Software](https://synthandsoftware.com/2021/11/band-in-a-box-2021-the-synth-and-software-review/)) [review].

**Moises** separates a recording into stems and reads its chords. The free tier shows chords for "the first minute of
each song" and changes speed by ±10 bpm ([chord finder](https://moises.ai/features/chord-finder/),
[speed changer](https://moises.ai/features/audio-speed-changer/)) [manual]. Loved: "I also use the function that
allows me to slow down the song to play along with, until I can play it at tempo." Not loved: "It tends to mix up
chords sometimes giving a false root", "especially with modal jazz"; it "may mistake certain lower pitches for a bass
guitar"; "money grubbing, dishonest and irritating behavior"
([App Store](https://apps.apple.com/us/app/moises-the-musicians-app/id1515796612)) [store]. Moises says itself that
detection "does occasionally make mistakes" [manual].

**Chordify** reads chords from songs: "close to" but "not quite, correct"; "no human musician has vetted the outcome
in any way"; "why am i only allowed to practice three songs a day?"
([App Store](https://apps.apple.com/us/app/chordify-songs-chords-tuner/id1073624757)) [store].

**Spark's Smart Jam and Auto Chords**: "the Spark amp and app work together to learn your style and feel. Then Spark
generates authentic bass and drums to accompany you in real time" ([positivegrid.com/spark](https://www.positivegrid.com/spark))
[manual]. "The smart jam feature also works quite well"; Auto Chords is "fairly accurate"; but backing tracks
"increase in volume and drown out the guitar", and "It takes multiple times of trying to connect before it connects"
([App Store](https://apps.apple.com/us/app/spark-amp-smart-jam-chords/id1457653921)) [store].

### 2.2 Learning apps and tab

**Rocksmith and Rocksmith+** listen to a real guitar (by cable, or the phone's mic on mobile:
[App Store](https://apps.apple.com/us/app/rocksmith-fast-music-learning/id1571139807), [Ubisoft](https://www.ubisoft.com/en-us/game/rocksmith/plus)).
Loved: "If the game sees you rock, it'll make the next bit a little bit harder"
([Steam](https://steamcommunity.com/app/221680/reviews/?browsefilter=toprated&filterLanguage=english)) [store]; "now
the game can tell" ([TNW](https://thenextweb.com/news/loving-new-rocksmith-beta-not-uninstalling-rs2014)) [review];
"more engaging than practicing with just a metronome alone" ([COGconnected](https://cogconnected.com/preview/rocksmith-beta-impressions/))
[review]. Not loved, and this is the longest list in the research:
- detection: "The tone recognition isn't perfect, and it never is"; it can "miss some notes (especially low E string
  on first frets)" (Steam) [store]; a "hard time registering my notes"; "if you can get one of the Rocksmith cables
  ... SOOOOO much better" (App Store) [store];
- lag: Ars Technica's review said it "fails as a way to learn guitar", partly for lag (quoted in
  [Wikipedia](https://en.wikipedia.org/wiki/Rocksmith); [the review itself](https://arstechnica.com/gaming/2011/10/the-three-reasons-rocksmith-fails-as-a-way-to-learn-guitar/)
  wouldn't load) [review]; COGconnected changed Windows sound settings "to reduce latency", and found it "assumes
  that you're using the 'correct' fingers" [review];
- jamming: no free jamming at launch was "a borderline deal-breaker" (TNW) [review]; Session Mode is "odd that it
  follows you, rather than maintaining a constant rhythm for you to improv over" (Steam) [store].

**Yousician** ([Wikipedia](https://en.wikipedia.org/wiki/Yousician), [yousician.com](https://yousician.com/guitar)):
"I grew up playing guitar hero…" ([App Store](https://apps.apple.com/us/app/yousician/id959883039)) [store];
"Having the ability to practice a song, adjust the tempo and loop a measure(s) is absolutely perfect"
([Trustpilot](https://www.trustpilot.com/review/yousician.com)) [store]. But: it "gave me just enough to get started and
excited, but then cut me off…"; songs "vanish without warning"; "It's bitty and repetitive. It doesn't allow to play
the full song" [store].

**Fender Play** ("1000+ song library", MatchMySound listening:
[App Store](https://apps.apple.com/us/app/fender-play-learn-guitar/id1226057939)) and **Justin Guitar** ("Over 1,500
hit songs": [App Store](https://apps.apple.com/us/app/justin-guitar-lessons-songs/id1176125504)) [manual]: "Working with
just a metronome is really hard for me and having something to play along with really helps." Fender Play has "not a
good way to organize what's relevant outside of the course structure"; Justin's drills "don't really put it together
in a way that is musical" [store].

**Songsterr** plays tab back with the real rhythm: "Slow down tab playback up to 15%"
([App Store](https://apps.apple.com/us/app/songsterr-tabs-chords/id399211291)) [manual]. "the tabs are actually so much
more accurate!", but "the tab for multi track overdubs" falls short [store], and its own help page warns "errors and
inaccurate or incomplete versions of transcriptions are possible" ([help](https://www.songsterr.com/help)) [manual].

**Ultimate Guitar** ([Wikipedia](https://en.wikipedia.org/wiki/Ultimate_Guitar);
[App Store](https://apps.apple.com/us/app/ultimate-guitar-chords-tabs/id357828853)), "over 29,000" tabs with backing
tracks: "You definitely have to check out each song and the chords to make sure that they are correct"; autoscroll
"either jumps really quickly or it doesn't move at all" [store].

### 2.3 Amp sims and tone apps

**Neural DSP**: the Quad Cortex review (10/10) says its amps "feel more organic under the fingers, less fatiguing on
the ears", but "the amp menu is biased towards higher-gain tones"
([guitar.com](https://guitar.com/reviews/effects-pedal/neural-dsp-quad-cortex-game-changing-guitar-product-of-the-decade/))
[review]; of the Archetype: Morello plug-in (7/10), "Click around… for 20 minutes and it feels like you've heard most
of the sounds it has to offer" ([guitar.com](https://guitar.com/reviews/effects-pedal/neural-dsp-archetype-tom-morello-review/))
[review]. Company background: [Wikipedia](https://en.wikipedia.org/wiki/Neural_DSP).

**IK ToneX**: "the results are impressive", with "unlimited access to user-generated models via IK's ToneNet", but
"Options are limited to static, tone-based effects" ([MusicRadar](https://www.musicradar.com/reviews/ik-multimedia-tonex))
[review]; its iOS app crashes on launch for some ([App Store](https://apps.apple.com/us/app/amplitube-tonex/id1613359930)) [store].

**BIAS FX 2** (no longer sold: [positivegrid.com](https://www.positivegrid.com/bias-fx-2)) had ToneCloud, "over
50,000" presets [manual]. "how I got an iPad to sound so good"; a Spark owner is "like a kid in the candy store running
from one flavor to the next" ([App Store](https://apps.apple.com/us/app/bias-fx-2-1-guitar-tone-app/id1475438828))
[store]. But it "freezes up…", and "The tuner jumps around everywhere" [store].

**Fender Tone** ([App Store](https://apps.apple.com/us/app/fender-tone/id1174113426)): it "will refuse to connect to
your amp EVEN IF ITS ALREADY CONNECTED…"; "30+ minutes… troubleshooting" [store].

### 2.4 The evidence underneath

**Slow practice works because correct repetitions do.** Duke, Simmons and Cash (2009) found the share of correct trials
in practice predicted the next day's performance (r = −.51, and −.71 for complete run-throughs), and incorrect trials
predicted worse (r = .48) ([DOI](https://doi.org/10.1177/0022429408328851); abstract via
[Crossref](https://api.crossref.org/works/10.1177/0022429408328851)) [study]. Transcription tools have long offered
speed from "one twentieth to double speed" ([Transcribe! overview](https://www.seventhstring.com/xscribe/overview.html),
[FAQ](https://www.seventhstring.com/xscribe/faq3.html)) [manual].

**Stretched audio sounds stretched.** Time-scale modification is "phasey and diffuse" at large factors
([Wikipedia](https://en.wikipedia.org/wiki/Audio_time_stretching_and_pitch_scaling)); there is "no single TSM method
that can cope with all kinds of audio signals equally well" (Driedger and Müller, 2016; abstract via
[Semantic Scholar](https://api.semanticscholar.org/graph/v1/paper/DOI:10.3390/app6020057?fields=title,abstract,authors,year,venue,openAccessPdf))
[study]; a Rocksmith player: "past about 80% speed, the audio quality is so bad…" (Steam) [store]. **[inference]** A
band made of notes and synthesized instruments slows down with no artefacts at all: the notes are simply played later.

**Target the chord tones; one box can carry a blues.** "Targeting means landing on the tones of a chord"
([Jazz improvisation](https://en.wikipedia.org/wiki/Jazz_improvisation)); one blues scale is "commonly used over all
changes… based upon the key" ([Blues scale](https://en.wikipedia.org/wiki/Blues_scale));
[Pentatonic scale](https://en.wikipedia.org/wiki/Pentatonic_scale). The chord-scale approach has its critics, Ake
among them ([Chord-scale system](https://en.wikipedia.org/wiki/Chord-scale_system)) [study, via the encyclopedia].

**Polyphonic pitch detection is still hard**: "a vague cloud…" ([Transcription](https://en.wikipedia.org/wiki/Transcription_(music))).

**Crowd tab is often wrong, and its ratings don't tell you which.** Macrae and Dixon (ISMIR 2011) checked online tabs
against each other and against recordings: the mean chord accuracy was 61.8%, only 7,547 of 24,746 tabs were usable,
user ratings didn't predict accuracy, and an automatic chord transcriber (79.3%) beat the tabs (68.8%) on the songs it
was tested on ([PDF](https://archives.ismir.net/ismir2011/paper/000082.pdf)) [study]. Tab itself drops rhythm: "TAB
will *not* give you any information on the note lengths" ([classtab.org](https://www.classtab.org/tabbing.htm)), and
ASCII tab "is not strictly defined" ([ASCII tab](https://en.wikipedia.org/wiki/ASCII_tab)).

**The latency budget is about 10 ms, and jitter is worse than delay.** Under 10 ms is the usual target (Wessel and
Wright, via [NIME 2016](https://www.nime.org/proceedings/2016/nime2016_paper0005.pdf)); a 6 ms asynchrony can be
detected, players compensate for up to about 55 ms, and jitter "cannot be corrected" [study]. Jack et al. (2018): 10 ms
rated like 0 ms; 20 ms, and 10 ms with ±3 ms jitter, rated worse ([DOI](https://doi.org/10.1525/mp.2018.36.1.109))
[study]. Whirlwind: under about 10 ms isn't noticeable, 15-20 ms makes playing difficult
([article](https://www.whirlwindusa.com/tech-articles/opening-pandoras-box/)) [manual]. In browsers, output latency is
about 10 ms on Windows, a few ms on macOS and iOS, 30-40 ms on Linux, and 12.5-150 ms on Android (Paul Adenot's
[notes](https://padenot.github.io/web-audio-perf/)); `AudioContext.outputLatency` is widely supported since March
2025 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency); also
[AudioContext()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext),
[MediaTrackSettings.latency](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/latency)) [manual].

### 2.5 What players keep saying (twelve patterns)

1. **A band that keeps playing** is the thing they want; practising to a metronome alone is the thing they dread.
2. **Steady time**, not a band that follows you: a backing that waits for your mistakes isn't a band.
3. **Slow down and loop** are the most loved controls in every category.
4. **Machine-read chords are welcome** when labelled as a reading and easy to check; a confident wrong root is what
   annoys.
5. **Crowd tab gets checked by ear**; nobody trusts it blind (and the study above says they're right).
6. **Rhythm is tab's weak spot.**
7. **Detection must be strict and fair**: missed notes and lag break trust faster than anything else.
8. **Paywalls and caps** draw the angriest reviews (three songs a day; the first minute of chords).
9. **Chopped-up lessons feel "bitty"**: players want the whole song, and something musical.
10. **Tone quality is no longer the complaint**; connections, crashes and setup are.
11. **Flipping through presets is fun**; uneven levels between them annoy, and so does a band that drowns the guitar.
12. **About 10 ms is the budget**, and jitter is worse than a steady delay.

---

## 3. The design, decision by decision

| decision | why (pattern) |
|---|---|
| A tab beside Arrange, not a new page or mode; the song keeps playing across it | 1, 9: the whole song, in the studio where the idea can be kept |
| The backing is always a real song in steady time: this song, a demo, a recent song or a jam track | 1, 2 |
| Jam tracks are built by the house band from a style, key, tempo and chords, as notes on real devices | 1, 2; and slow-down stays clean (2.4) |
| Opening a jam track behaves like opening a song: the old one goes to Recent songs, Undo brings it back | nothing lost; no new kind of document |
| Chords are read from notes, labelled as a reading, never guessed from audio | 4, 5 |
| The stage: the chord now big, the next with a beat countdown, the section and the bar | 2: you need to see the change coming, not react to it |
| The neck shows where to play (box, scale), what to aim at (chord tones) and what's coming (next chord) | 2.4 targeting; 9 |
| What you play is marked fits / outside, and named over the chord ("the blue third over E7") | 7, made kind: a description, never a score |
| Tones are the 156 rigs, measured to a common loudness, flipped as a row and heard at once | 10, 11 |
| Practice speed is the engine's (`engine.rate`), not an edit: no op, no History, back to 100% when you leave | 3; a practice aid shouldn't change the song |
| Audio clips sit out below 100% rather than stretch, and the room says so | 2.4 stretched audio |
| Tips are specific to this song: frets, strings, bars and notes; a lick you can see and hear | 9; no generic advice |
| Everything free and on the device; no account, no cap | 8 |
| R records the guitar onto a Guitar track at the playhead with the studio's recorder | the take is kept like any other |

**The Guitar track: two kinds, used by what you play with.** A real guitar goes on an audio track ("Guitar", armed,
monitored through its inserts via the interface input, recorded as audio). The keys, a MIDI keyboard and taps on the
neck play DI Box (`core.guitar`, the studio's modelled DI guitar) on an instrument track ("Guitar" or "Keys guitar").
The room uses the audio one while the input is open, else the keys one, and makes the one it needs on demand, with
the other one's tone. **[inference]** One track for both would mean an audio track that plays MIDI or an instrument
track that records audio; neither exists in the studio, and both would blur what a take is.

**The fader is measured, not guessed.** When the room makes a keys guitar it renders two bars of the band without it
and the room's lick on it, and sets the fader so the guitar sits 0.5 LU under the band (clamped to −18..+12 dB). The
jam tracks' own levels were set the same way: every style's band measures −18.5 to −17.0 LUFS with a lick on its
Guitar track within 2.5 LU of it, true peak at or under −1.3 dBTP (`tools/jam-test.js`).

**What the room never does.** It doesn't grade, keep a streak or lock songs. It doesn't stretch audio. It doesn't
read chords from audio. It doesn't hum: Sketch's Hum it, open below, would otherwise add the mic to a take, so R in
the room records with `hum: false`.

---

## 4. What was built

**Core, pure and tested in Node.**

- `app/src/core/fretboard.js`: tunings (standard, drop D, half-step down, DADGAD, open G), `positionsOf(pitch,
  tuning, { from, to })`, `boxStart` / `boxOf` (a scale under one hand), `handSpan`, and
  `fingering(notes, tuning, { span = 4, near, open })`: a Viterbi over every place of every onset (notes within 0.03
  beats are one chord on distinct strings), in hand windows of `span` frets, charging |Δposition| + 0.6 for a shift,
  0.25 for a string skipped, a little for frets above the 12th, and `open` for an open string (negative favours open
  chords; 0.6 keeps a lead line off them). It returns each note's string, fret and finger, the hand positions, the
  shifts and the span, or `{ error, hint }` for more than six notes at once, a note off the neck, or a chord no hand
  can hold. `formatTab` / `parseTab` write and read ASCII tab (high e on top, bar lines; the column width recovered
  from the spacing).
- `app/src/core/jam.js`:
  - `chordTimeline(project, { grain: 'half' })`: pitch-class weights per half bar from every pitched clip, drums
    skipped. A clip weighs as chords (1.0) when at least 40% of its notes start together, as bass (1.2) when its median
    pitch is under E3, else as a line (0.5); notes count by overlap, velocity and an onset bonus. Each window scores
    every root and quality (major, minor, 7, maj7, m7, m7b5, dim, sus2, sus4, 5, 6, m6) by the share of weight inside
    the chord, less missing-tone penalties (third most), plus the bass note (sounding at the window's start: a root
    bonus, a slash chord for another chord tone) and a small prior for chords in the key. A Viterbi pass charges for a
    change, more mid-bar, so a passing note doesn't become a chord. Result: chords with bars, name, Roman numeral,
    tones spelled from the chord (E7's third is G#), bass and a confidence.
  - `whereAt` (the chord now, the next one, the beats to it, the section, bar and beat), `parseChord`,
    `parseRoman`, `parseProgression` (`|` for two chords in a bar, `%` repeats), `chordTones`, `spellTone`,
    `spellIn` (the blue note as a flat five), `sectionKeys`.
  - `jamTrack({ style, key, tempo, progression, bars, seed, by })`: ten styles (below) built with `core/arrange.js`'s
    builders (now exported: `drumBar`, `bassLine`, `chordPart`, `voice`, `nearestPitch`), plus a riff bass with
    named roles, a pad and a shuffle feel. A real song: sections, the loop round the form, a light master bus
    compressor and limiter, a Guitar track with the style's rig, `meta.jam` (the recipe), stable ids for a seed.
  - `jamTips(project, timeline, { tuning, at })` and `makeLick(...)`: the tips and the two-bar lick (three rhythms,
    four phrase shapes; it lands on the next chord's change tone on beat 4, ends on a root or third, and is fingered
    in the box with `open: 0.6`).

| style | key | tempo | what the band plays | the Guitar track's tone |
|---|---|---|---|---|
| Blues shuffle | A blues | 92 | twelve-bar shuffle, boogie bass, organ on the backbeat | blues |
| Funk | E minor | 104 | Em7-A7 vamp, Cmaj7-B7 turn, sixteenth hats, e-piano stabs | gr-clucky |
| Indie | G major | 122 | I V vi IV and IV I V vi, eighth-note bass, bright piano | jangle |
| Ballad | C major | 68 | broken piano chords, strings, half-time kit | siren |
| Neo-soul | Eb major | 78 | IVmaj7 iii7 ii7 Imaj7 and vi7 II7 ii7 V7, ninths on e-piano | gr-motown |
| Metal | E minor | 132 | palm-muted chug on a rhythm guitar, double kick, power chords | kraken |
| Reggae | A minor | 74 | one drop, organ skank on two and four | gr-skank |
| Bossa nova | D minor | 132 | i6 i6 ii7b5 V7 and iv7 bVII7 bIIImaj7 bVImaj7, rim clave, felt piano | gr-jazz (nylon DI) |
| Lo-fi | F major | 80 | dusty Rhodes sevenths, lazy swung beat | in-salad |
| Classic rock | E mixolydian | 116 | driving eighths, power chords, big backbeat | crunch |

**The room** (`app/src/ui/jam.js`, `app.jam`): the head (what you're playing over, its key, tempo and bars, the
picker), the stage, the neck (canvas in a sideways scroller, drawn from `frame(now)`), the tones (the row, the banks,
the pedalboard of faces), the input (interface, channel, monitor, meter, tuner), practice (loop, speed, click,
count-in, Record), and ideas (the tips ledger, Show and Show me, and chips that ask the agent through the Agent tab).
Keys while it shows: `[` `]` tones, `⇧L` loop the section, `-` `=` speed, `R` record. The center region's tabs
(Arrange, Jam) sit in the arranger's toolbar row rather than a row of their own, so the room takes no height from the
arranger; a row of their own cost 40 px on a desktop and left a phone on its side with no lanes in view. In the room
they sit on its head, which stays at the top while the room scrolls; on a phone they have the room's top line to
themselves, kept there as it scrolls. Phones narrower than 390 px, where the toolbar and the tabs don't fit side by
side, give the tabs their own row.

**The engine hook** (`app/src/engine/engine.js`, flagged): `engine.rate` (0.25-2). The transport's clock and the
scheduler run at tempo × rate; a change re-anchors the transport the way a tempo change does. `beatToSec` and
`secToBeat` stay at the song's tempo (renders and the recorder's placement don't move). Below 1, audio clips aren't
scheduled (a clip playing fades out); back at 1 they pick up where the song is. The recorder places audio at the
song's tempo, so a take that records audio puts the speed back to 100% first. The golden renders are unchanged: the
song never sees the rate.

**For agents** (`app/src/agent/extra-schemas.js`, registered by the room): `get_jam` (read-only), `make_jam_track`
(replaces the song on screen, which goes to Recent songs; refused while recording and on a song from a link),
`set_tone` (search, or load a rig as one undo step), `show_on_fretboard` (notes, places, a scale or a chord, in the
agent's ink, optionally played). Documented in `docs/AGENTS.md`; a short paragraph in the system prompt says to read
`get_jam` before talking harmony, to make a jam track only when asked, and to talk in frets, strings and bars.

**Checks** (`tools/jam-test.js`): the timeline on Night Shift (Am7 Fmaj7 C G7, bar by bar, with numerals) and on all
ten jam tracks (every bar of every chart read back), slash chords, two chords in a bar, a section in another key and a
blues that isn't one; positions in every tuning; a box run in one position (span 4, no shifts), a two-octave climb, an
open A minor shape; tab out and back; jam tracks in the asked key and tempo, deterministic per seed, refused with a
hint when the asking is wrong; levels; tips; the room in the page (the tab, playback across switches, the stage at
the playhead, the countdown, the toggles read off the canvas's pixels, a tuning, left-handed, a tone flip as one
signed undo step, the loop, the speed with nothing in History, R with no hum); `get_jam`, `make_jam_track`, `set_tone` and `show_on_fretboard` with their errors; a
phone (no sideways page scroll, the neck scrolls, the stage stacks, 40 px targets, 12 px text); no page errors.

**What it doesn't do yet.** No chords from audio clips. The practice speed doesn't slow audio. One guitar at a time.
(Tab, riffs and play-along feedback came next: section 5.)

---

## 5. Tabs: what was built

The plan was tabs first. The pieces built for the room were shaped for it: `fingering` already turned notes into
strings and frets in one hand position, the tab writer and reader existed, `show_on_fretboard` already took
`string:fret` places, and the lick player already lit each note on the neck as it sounded. What landed, against the
plan:

### 5.1 Tab is a view of notes, not a new document (built)

- **A note may carry its place**: `s` (string, the lowest 0) and `f` (fret from the nut), both or neither; a notes
  clip may carry `tuning` and `capo`. The pitch stays the truth: `placeOk` ignores a place that no longer plays its
  pitch in the clip's tuning, and `placeNotes` fingers it again around the places that still hold. Every op, undo,
  split, repeat, save and share link keeps them (`tools/tabs-test.js` checks each), and old readers skip them.
- **Where places come from.** `fingering()` for notes without them; the house riff writer and `write_tab` write them
  with the notes; the Notes panel's **Tab** view moves them (below).
- **Not built: the notes-text suffix** (`A3@0:0.5/5:7`). The parser in `core/music.js` has another owner; agents pass
  places as note objects (`{ p, t, d, s, f }`) or write tab with `write_tab`.
- **The tab view** came out as two views. The Jam room's **tab lane**, under the stage, is a page of tab with a moving
  cursor. The Notes panel's **Tab** view is the piano roll's clip as tab: pick a fret number, type a fret (the pitch
  goes with it), ↑ and ↓ to move a note to the next string at the same pitch, and the clip's tuning and capo. Neither
  view draws stems and beams. The rhythm is each note's real length, drawn as a line along its string, and in tab
  text it's `=` holding a note on through its 16ths. So the tab has its rhythm, which answers tab's oldest complaint
  (2.4, pattern 6). A capo shifts the numbers, not the notes.

### 5.2 Riffs as tab, for a section (built, with the house writer in front)

- **The house riff writer** (`core/riff.js`) came first, so the room has riffs without an agent: deterministic per
  seed, five styles (rock, blues, funk, indie, metal) with their own rhythm templates, three difficulties, a 1-4 bar
  motif repeated and answered with another ending, chord tones on the strong beats, scale or pentatonic notes
  between, one hand position, fingered. Each riff carries the checks it passed (in the key, chord tones where it
  claims them, playable, within a hand's span), and its description says only what was checked. The suite writes
  660 riffs (every style, difficulty and both tunings over the demo songs' sections) and holds each to those checks.
- **In the room**: **Suggest a riff** gives three takes for the section the playhead is in. **Hold to hear** plays one
  through the rig, **Keep** puts it on the Guitar track as one undo step, and **Another** gives the next seeds. With an
  agent connected, the button asks the agent and its takes come to the lane.
- **For agents**: `tab_for` reads a part as tab and changes nothing. `write_tab` takes tab text and lands it as a clip
  that keeps its places, or as a card when it would replace notes (the borrowed-song rule from `agent/keep.js`, applied
  to every song). `suggest_riff` offers the house writer's riffs as takes. The demo agent answers "give me a riff for
  the chorus" with the house writer's takes, and says whose they are.

### 5.3 Play-along feedback, honest about what it can hear (built)

- **What it compares.** Note events from the keys, MIDI or the neck, placed on the song's beat, and from a real guitar
  `input/onsets.js`: onsets and pitches found in the interface's raw input, with candidate pitches for octave errors.
  The calibrated round trip (`input/latency.js`) and the engine's output latency come off before a note is placed.
  `core/playalong.js` judges pitch and onset. A note is a hit within 35-75 ms (by tempo), early or late out to 200 ms,
  and not heard when nothing matched.
- **What it can't hear.** Chords are judged on their strike and their lowest note only, and the lane says so under
  any part with chords. A note that went by unheard stays plain: it is never marked wrong.
- **How it reports.** On the tab as it plays: warm for a hit, a ring with a tick on the side you were for early or
  late, plain for not heard. After each pass, one line ("11 of 14, the bend in bar 2 is late"). No score, no streak,
  no fail screen.
- **Learn it** (not in the plan): the transport waits on each note until you play it, the riff's own clip silent
  (`engine.hush`), then moves on.
- **Not built**: showing the latency figure and suggesting direct monitoring above about 20 ms; a wider window for low
  E; the loop speeding up 5% after a clean pass.

### 5.4 After that

- **Chords from audio clips**: a chroma from the clip's spectrum, the same timeline code after it. Labelled as a
  reading, with the same smoothing; the research is clear that it will be wrong sometimes (2.1).
- **Tab in for people.** Agents can already paste tab (`write_tab`, with the lengths said to be a guess when the text
  has no `=`). A person can't yet: a paste box in the lane, then MusicXML or Guitar Pro files. See the question below.
- **The notes-text suffix** for places (5.1), when `core/music.js`'s owner takes it.
- **Transpose and capo** in the jam track maker and on the neck.
- **More of the room for other instruments**: a bass neck is four strings in `TUNINGS`; keys would be a different view
  over the same timeline.

---

## 6. Questions that are AJ's

1. **Bringing in other people's tabs and songs.** Pasting tab and playing along to your own recordings are the most
   asked-for things in this market (sections 2.1 and 2.2), and most tabs are transcriptions of copyrighted songs. On
   the device only, it's like any player app. In a share link it would send someone else's song. Do we allow tab and
   recordings in, and if so, are they kept out of share links?
2. **Stretched audio.** Below 100% the room plays the notes slower and leaves audio clips out. A time-stretch for
   audio is possible, and the research says it sounds bad below about 80% (2.4). Worth building for recorded songs,
   or should the room keep saying audio can't follow?
