<!-- vendored verbatim from clawd-o-matic/web/../docs/GUITAR.md @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it -->
# Live guitar

Claw'd-o-Matic can take a real guitar (a DI into an audio interface) and play it with the synthesized band: through
pedals, an amp, a cab and mics, all in Web Audio, into the band's own master. Around that rig sit a loop station, a
recorder, overdub tracks, a drum pedal, jam tracks with a solo guide, trade fours, keys, scenes, a webcam or a crab
of your own on stage, and a full-screen Guitar Studio that lays it all out like a floor unit.

This is the map for a developer. Pedal packs have their own spec: [`PEDALS.md`](PEDALS.md). Chrome is the target
(Web MIDI, AudioWorklet, `requestVideoFrameCallback`); Safari is not.

## Where the code is

`web/build.js` concatenates everything into the app's one scope, in this order:

```
amps.js            the amps, cabs and mics (the sound): PLUG_AMPS, PLUG_CABS, PLUG_MICS, plugAmp, plugCabNet
pedals.js          the pedal platform: pedalDef, PFX (the kit), pfxWorklet, the board model, pedalRig
pedals/*.js        pedal packs, in file-name order (00-classic … 80-wish)
pedalboard.js      the board, the chain strip and the library (what you see)
ampui.js, cabs.js  the amp's face, the amp wall, the cab and mic view
presets.js         presets, presetBank, the patch browser
presets/*.js       preset banks, in file-name order (10-punk … 90-keys)
plugin.js          the Plug in tab, the live rig, and the PLUG hub
plug/*.js          the features, in file-name order (00-latency first, so PLUG.latency is there for the rest)
studio.js          the Guitar Studio (after every feature has registered)
```

The scope is shared with the whole app (`$`, `song`, `ctx`, `play`, `W`, `H`, `g`… are taken), and a duplicate
top-level `const` breaks the whole page. Every file in `plug/` is one IIFE; pedal and preset packs are one block
each. Prefix anything that has to be top-level (`plug…`, `loop…`, `ky…`).

## The signal path

```
the interface → getUserMedia (echo cancellation, noise suppression and AGC off)
  → MediaStreamSource → rig.pick (input 1, 2, both summed, or stereo 1+2)
       ├→ rig.an (an AnalyserNode: the dry DI, read by PLUG.sense for the meter, tuner and pitch)
       └→ rig.chain (plugChain → pedalRig): pre pedals → the amp → post pedals
              the amp (plugAmp): hp → tight/bright/push → stage 1 → filters → stage 2 → tone stack
                                 → power → presence → cab & mics → level

rig.chain ────────────────────→ PLUG.bus(c).guitar → [you] ───┐   (keys join here, unless THRU RIG)
loops, takes, tracks ─────────→ PLUG.bus(c).returns → [loops] ┤
band: lanes → gate → pre → glue comp → limiter → [band] ───────┤
                                                               ↓
                    liveGraph.clip (the band's soft clip, 4× oversampled) → liveGraph.out (trim) → speakers
                                                                            = PLUG.bus(c).master
```

- **The guitar joins after the limiter**, at the soft clip, because the limiter's lookahead would add latency. The
  soft clip is what stops guitar plus band from going over.
- **The mix insert** (`plugMixInsert(liveGraph, c)`, made by the first `PLUG.bus(c)`) puts three gains in: `band`
  between the limiter and the soft clip, and `you` and `loops` into the soft clip. Only the live graph gets them; a
  render builds its own graph without. At 0 dB each is a gain of exactly 1, so the band is bit for bit what it was
  (`mix-check.js` proves it). The faders are `PLUG.setMix(k, dB)`: band −30…+3 (past +3 its true peak goes over
  0 dBFS), you and loops −30…+6; the bottom is off.
- **Returns** (`PLUG.bus(c).returns`) is where anything that plays back guitar connects: the looper, takes, tracks,
  the latency dialog's clicks and chirps. It goes through the LOOPS fader.
- **Master** (`PLUG.bus(c).master`) is the whole mix as heard. Tap it (don't connect into it) to record or meter.
- The drum pedal joins at the drum lane's own level into the band's gate (so the same glue, limiter and soft clip as
  a song's drums). Trade fours' answers join where the lead lane does, before the glue compressor.

The rig: `plugChain(c)` wraps `pedalRig(c, plugAmp(c))` and loads the amps' own worklets (`PLUG_WORKLETS`: Abyss's
octave divider). `rig.chain.set(P, bpm, at?)` takes the whole settings object `P` (`{ amp, gain, bass, mid, treble,
presence, level, board, cab?, mic?, mic2? }`); `await rig.chain.ready()` before rendering offline (a pedal with a
worklet builds once it has loaded). `rig.chain.latency` is the chain's own latency in seconds (oversampled stages, a
pitch shifter's window). The plugged-in rig is `{ stream, src, pick, an, chain, st, … }`, at `PLUG._rig`.

## The PLUG hub (plugin.js)

Everything live hangs off one object. The comment block above `PLUG_MIX` in `plugin.js` is the reference; in short:

| | |
|---|---|
| `PLUG.bus(c)` | `{ c, guitar, returns, master, band, you, loops }` for the live context (made once) |
| `PLUG.mix`, `PLUG.setMix(k, dB)` | the three faders; saved; emits `mix` |
| `PLUG.on(type, fn)` → off, `PLUG.emit(type, detail)` | a small synchronous event bus; one listener throwing doesn't stop the rest. Types: `rig`, `sound` (amp, knobs or pedals changed), `preset`, `chain`, `loop`, `take`, `backing`, `part`, `feature`, `mix`, `fold`, `studio` (open/shut) |
| `PLUG.onRig(fn)` | `fn(rig)` on plug in, `fn(null)` on unplug, and once now if a rig is up |
| `PLUG.feature(def)` | register a feature once; whoever is showing mounts it (see The studio) |
| `PLUG.section(id, title, blurb, group)` | a `<div>` of your own in the Plug in tab: a feature with only a panel view (the studio shows it under Setup › More) |
| `PLUG.fold(group, open)` | open or shut a fold of the Plug in tab (`amp`, `play`, `record`, `all`) |
| `PLUG.sense` | the input, read by whichever view is showing: `peak`, `db`, `lvl`, `pk`, `clipAt`, `hz`, `midi`, `cents`, `note`, `heardAt`, `heldMs`, `chord`, `sure`, `ap`. `update(now)` is cheap to call twice a frame. Pitch is YIN (`plugYin`) at most 25 times a second, only above −50 dBFS |
| `PLUG.clock` | the band's transport: `playing()`, `bpm()`, `bar()` (fractional), `barTime(b)` (audio time bar `b` starts), `play(from)`, `stop()`, `source()` |
| `PLUG.latency` | the round trip (see Latency) |
| `PLUG.applyAt(t, fn)`, `PLUG.at` | whatever `fn` changes on the rig lands at audio time `t`, not now (scenes use it to switch on the bar line) |
| `PLUG.rigUI` | the Plug in tab's insides (`P`, `changed`, `ampUI`, `board`, `presetUI`, `plugIn`, `unplug`, the rack): for the studio's views of the same rig |

**The Plug in tab's groups.** A feature's panel lands in `def.group`, else `PLUG_GROUPS[id]`, else `play`. `rig`
shows under the amp; `play` (Play along) and `record` (Record) are folds, shut until opened (saved). A fold opening
wakes its features the same way the tab opening does (the panel's `hidden` flips), so features don't need to know
about folds.

**The clock and the drum pedal.** Anything that needs the band's grid reads `PLUG.clock`, never the song's transport
directly. While the drum pedal runs, it *is* the clock: `plug/drums.js` overwrites `PLUG.clock`'s methods so
`playing`, `bpm`, `bar` and `barTime` answer from the pedal (and `source()` says `'drums'`, `'song'` or `null`). The
looper's SYNC, the recorder's bar counter and the rest follow the drums with no code of their own. The song and the
pedal never run together: starting one stops the other. Pedals get the clock through the rig (`x.clock`, `sync`), not
by polling `PLUG.clock` (see PEDALS.md, In time with the band).

**Latency** (`plug/00-latency.js`). `PLUG.latency.get(rig?)` is the dry round trip in seconds: out through the
band's path to the speakers and back in at the input. It's measured once per input device (strum along: 8 clicks at
100 bpm, onsets found sample by sample in the dry DI; or loopback: a cable from output to input, three chirps found
by cross-correlation), else estimated from the browser's numbers (which are often wrong: Chrome on macOS commonly
says 0 for the input). A feature recording the amped guitar adds `rig.chain.latency` on top. The looper, recorder,
tracks and trade fours all use it; the Calibrate dialog is `PLUG.latency.calibrate()`.

## The Guitar Studio (studio.js)

A full-screen place to play: the stage with you on it, a rack (input and tuner, the preset LCD, the amp strip, your
part), the solo guide row, the floor (stomps, loop station, drum pedal) along the bottom, and drawers for anything
you touch between songs. It's the same rig as the Plug in tab: turn a knob in one and the other shows it. Open it
with G, the tab's hero strip, the masthead's STUDIO sticker, or a link ending `#studio` (or `#studio/pedals`,
`/presets`, `/amps`, `/jam`, `/takes`, `/setup` for a drawer). The app's stage canvas is moved in while it's open and
moved back after.

**Features mount by surface.** A feature registers once:

```js
PLUG.feature({
  id: 'looper', title: 'Loop station', blurb, icon, order: 50,
  surfaces: ['panel', 'floor', 'hud'],   // panel top rack floor stage hud drawer guide
  at: { hud: 'br' },                     // top: 'left'; hud: a corner (tl, br …)
  drawer: 'setup',                       // a section of the Setup drawer rather than a tab of its own
  group: 'record',                       // which fold of the Plug in tab its panel goes in
  keys: [{ code: 'KeyZ', show: ['Z'], label, group: 'floor', run, shift, hold }],
  mount(el, surface, ctx) { return { frame(now) {}, refresh() {}, unmount() {} }; },
});
```

| surface | where | examples |
|---|---|---|
| `panel` | the Plug in tab (mounted at once, in call order) | every `PLUG.section` |
| `top` | the studio's top bar | REC, the jam track picker |
| `rack` | a unit in the rack column | input, presets, amp strip, your part |
| `floor` | a section of the floor | stomps, loop station, drum pedal |
| `stage` | a layer over the stage | count-in, trade fours' badge, onboarding |
| `hud` | a chip in a corner of the stage | loop rings, the armed track, scenes |
| `drawer` | a tab of the drawer | presets, amps, pedals, jam tracks, takes, tracks, keys, scenes, setup |
| `guide` | the solo guide row | the solo guide |

`ctx` is `{ surface, studio, compact (phone layout), reduced (REDUCED), clock, bus, rig(), sense, open(id), close(),
announce(text), settings, save, on, emit, borrow(node, into?) }`. `ctx.on` listeners come off at unmount; `borrow`
moves an element of the panel's into the view and puts it home again at unmount (how most drawers reuse the tab's
DOM). The rules:

1. **State lives in the feature, not the DOM.** The panel view stays mounted (hidden) while the studio is open, so
   both views draw from the same state and redraw on `refresh()` or an event.
2. **No `requestAnimationFrame` of your own while the studio is open.** It runs one loop and calls `frame(now)` on
   the visible views. In the panel, a loop of your own must stop when the panel is hidden.
3. **Mount is cheap and repeatable.** The studio mounts on open and unmounts on close. CSS goes in once.
4. **Keys are declared, not bound.** The studio owns the keydown handler (capture phase, physical `e.code`) and
   calls `run`, `shift` or `hold` (held 1 s). A key that's taken is warned about and skipped. Keys are the studio's
   only while it's open; the one exception is G, which opens it.

Footswitches (anything that sends a key, or MIDI) are profiles and LEARN in Setup › Footswitches, saved with the
studio's settings.

## Pedals, presets, amps, cabs

**Pedals** are `pedalDef({...})` in `web/pedals/NN-name.js`: about a hundred of them, in categories dynamics, filter,
pitch, drive, fuzz, synth, mod, time, ambient, glitch and utility. Everything about writing one (the def, the kit,
worklets, bypass, the clock, levels, faces) is in [`PEDALS.md`](PEDALS.md). A board is saved as
`[{ uid, id, on, ...knobs }, …, { id: 'amp' }, …]`.

**Presets** are whole sounds: `{ id, name, blurb (≤60), nod, tags, amp, knobs: { gain, bass, mid, treble, presence,
level }, board: [{ id, ...knobs }, 'amp', …] (or the older fx: {...}), cab?, mic?, mic2?, hot? }`. The first 22
in `presets.js` are the Clawd Classics bank. The rest are banks, one file each in `web/presets/`:

```js
presetBank({ id: 'punk', name: 'Three Chords & the Truth', blurb, color }, [ { id: 'pk-blitz', … }, … ]);
```

Bank ids and preset ids are unique across every bank (a clash is refused with a `console.error`); prefix a bank's
presets (`pk-`, `hv-`, `rk-` …). Banks are numbered in load order and presets lettered within them, so a patch reads
the same (4C) in the tab and the studio. Names are puns on what they model, with no brand or artist names in the UI;
the `nod` says what's modelled in words. Clean presets must keep the gate low enough not to cut a ringing note
(`plug-level.js` checks). Your own presets are saved separately (`clawd-o-matic:plug-presets`).

**Amps** (`amps.js`, `PLUG_AMPS`) are voicings of one circuit (`plugAmp`), each a set of numbers: the header
comment explains every field. There are 22, from the first eight (clean, jangle, crunch, plexi, punk, lead, recto,
tiny) to the weird ones (radio, bit, tape), Abyss (an octave down, through a worklet) and Straight In (`di`, for
keys). Each has a name, blurb, style, nod and tone (the wall's filter). A few optional fields (`crush`, `wow`, `sub`,
a crossover) sit on a side route that's silent unless an amp asks for it, so the classic amps' path is untouched.

**Cabs and mics** (`PLUG_CABS`, `PLUG_MICS`, `plugCabNet`; the view is `cabs.js`). With the amp's own cab and the
default mic the cab is a straight wire (`{ custom: false }`), and nothing about the sound changes. Otherwise the cab's
filters, then up to two mics: type (dynamic, ribbon, condenser, crystal), position on the cone, distance (0.5–24"),
angle, and for the second a blend and a phase flip, delayed by the difference in distance. A trim worked out from the
responses (plus a measured nudge) keeps every cab and mic level with the amp's own. `P.cab`, `P.mic`, `P.mic2` are
written only when they're not the default.

## The features

Each is one file in `web/plug/`, one IIFE, with its test hook on `window.__clawd.<id>`.

- **Latency** (`00-latency.js`). See above. The rack's line says whether the number is measured or a guess.
- **Loop station** (`looper.js`). Four tracks like the hardware: one footswitch a track (REC → PLAY → DUB → PLAY),
  hold to undo the last layer, Shift to stop, Shift again to clear; reverse, half speed, one-shot; all stop/start.
  It records `PLUG.bus(c).guitar` and plays into `returns`. With the band playing (SYNC) a recording starts on a bar
  line and closes on the nearest one, so loops are whole bars and stay locked. With it stopped (FREE) the first loop
  sets the length and a whole-number tempo the band can take ("follow my loop"). All the audio work is one worklet:
  sample-accurate starts, overdubs written in place, click-free seams. Loops live in memory only (a 384 MB budget,
  8 undo layers) and go with the page.
- **Recorder** (`recorder.js`). A take is three stems written by one worklet, so they're sample-aligned by
  construction: `mix` (tapped from `master`, stereo), `gtr` (the amped guitar, stereo) and `di` (the dry input,
  mono), as floats. Sample 0 is the downbeat you recorded from; the guitar stems are moved earlier by the round trip
  (the wet one by the chain's latency too), plus a nudge; the mix's soft-clip delay is measured and cut. **Line up**
  rebuilds the mix from an offline render of the band and the moved guitar; **Re-amp** plays the DI through the rig
  as it's set now. WAVs at 24 or 16 bits. Takes are kept in IndexedDB (memory only, with a note, if it's refused).
- **Take video** (`takevideo.js`). 🎬 Video on a take's card films the stage to the take's own sound, through
  Export's music video (`ClawdExport.take`): the band replays silenced at the gate, so the stage moves as it did, and
  the take's guitar drives the stage cam's light and the crowd. With the stage cam on, the raw camera is recorded
  during a take (a small WebM, with the clean plate and key settings) and replayed, keyed, when it's filmed.
- **Tracks** (`tracks.js`). Up to eight guitar tracks per song (by title), each a list of takes with one picked.
  Arm a track and record: the band and every other track play while you do. Punch in/out keeps only the bars
  between, crossfaded into the picked take (a new take: the comp). Playback follows the band's scheduler (`placed`),
  restarting on a start, seek or loop wrap; a take recorded at another tempo sits out and says so. Each track has a
  fader, pan, mute and solo into `returns`. **Bounce** renders the band offline with every track: a WAV and a take.
- **Stage cam** (`stagecam.js`). The webcam, keyed on the GPU (WebGL 1) against a clean plate or a picked colour
  (a white wall), choked, feathered, smoothed over time, un-mixed from the background, then lit by the show. It joins
  the stage as member `you`, by default in Karplus's spot (he takes five: `m.away`), or in one of two spots of its
  own. Nothing leaves the browser; the camera is off until asked.
- **Your crab** (`avatar.js`). Plugged in with the camera off, a crab of your own (colour, hat, guitar, name tag)
  plays when you play: onsets in the dry DI strum it, `PLUG.sense`'s pitch frets it, loud chords head-bang, big
  accents jump, a busy high run takes the spotlight (`SHOW.focus`). It reads the input as it arrives, so it moves
  when you play, not a round trip later. It never shares the stage with the camera.
- **Jam tracks** (`jamtracks.js`, `jamtracks-data.js`, `jamtracks-theory.js`). Backing tracks (27 at the time of
  writing) with the lead lane and vocals left empty for you, made only of blocks the page has, round-tripping through
  song codes. Loading one keeps your song (`clawd-o-matic:jam-home`) until Back to my song. Key shift and a practice
  tempo. The theory (chords by bar, scales, fret positions, the five pentatonic boxes) is Node-tested.
- **Solo guide** (`guide.js`, the studio's `guide` row). A fretboard that follows any song as it plays: the scale,
  the chord's tones, the next chord a beat early, and the note you're playing (YIN, `PLUG.sense`). F cycles what the
  neck shows (both, chords, scale, off). The Plug in tab has its own smaller guide in `jamtracks.js`.
- **Trade fours** (`fours.js`). You solo for 2, 4 or 8 bars; Karplus answers for as many with a phrase made from your
  own notes (echoed onto the chord, sequenced, inverted, displaced, ending on a long chord tone; a stock lick if you
  played nothing). A worklet feeds a note tracker (onsets, pitch, quantised to 16ths after taking off the round
  trip); the answer is rendered by the Lead lane's own renderer in a worker of its own, so it *is* Karplus. The lead
  lane is muted while it runs.
- **Drum pedal** (`drums.js`). A drummer at your feet, built from the page's own drum blocks (core and packs), in
  twenty styles. D: count-in and the main groove; again: a fill to the bar line; twice: a transition to the next part
  (verse → chorus → bridge); hold or ⇧D: the ending. S pauses at the bar line with the clock running (loops stay in
  time). Its own lookahead scheduler, using the app's clip cache and workers, so a clip here is the clip a song would
  play. It becomes `PLUG.clock` while it runs. You can program a drum song (sections, fills, count-in, ending) and
  write it, or what you played live, into the song's drum lane as blocks (one undo step) or as a new song.
- **Keys** (`keys.js`). A MIDI keyboard (Web MIDI), the computer's keys or the one on screen, playing Nyquist's
  synth patches live. The band renders those a clip at a time in a worker, so the same voice (`synthNote`) runs again
  as an AudioWorklet with 16 voices, plus a piano and a tine electric piano. Keys go into `PLUG.bus(c).guitar` on
  purpose: "you" is whatever you play, so the looper, the recorder and the YOU fader catch them; THRU RIG sends them
  through the pedals and amp instead. INSTRUMENT › Keys on the input rack is for a keyboard's audio on the interface
  (stereo 1+2, the gate off, the Keys & Synths bank and the Straight In amp). Nyquist walks on and plays what you hold.
- **Scenes** (`scenes.js`). The rig changes with the song on the bar line, like a modeller's scenes: a map per song
  (by title) of `{ bar, preset }` or `{ bar, stomps: { uid: on } }`. A little ahead of each bar line the change is
  made inside `PLUG.applyAt(t)`, so the rig schedules it for audio time `t` and it's half in on the line: a glide
  (knobs and stomps, 10 ms), a gap (a new amp or cab: the amp's click-free duck, 69 ms ahead) or a rewire (a new
  line-up of pedals, 71 ms ahead). A seek or a loop wrap takes the whole state at that bar. Learn writes what you pick
  while the band plays at the nearest bar line; One per section guesses a map; some jam tracks suggest one ("Use
  them"), never played until you take it. A map plays only on the instrument it was made with (`PLUG.inst`), and
  "Back to my song" puts back the preset you had if a jam track's scenes changed it.
- **Getting started** (`onboard.js`). The first time the studio opens, a card walks through five skippable steps:
  plug in (the meter's −12…−6 dBFS window, what to do with the interface's gain), tune, timing (the Calibrate
  dialog), a sound (four presets, then play along), and a tour of six spotlights. Then one-time tips. Under a test
  (`navigator.webdriver`) nothing opens by itself and no tips show; `window.__clawd.onboard` drives it.

## Levels

Nobody working on this can listen, so every level is measured, with a synthetic DI strum (Karplus-Strong power
chords, open and palm-muted, peaking about −10 dBFS: a guitar on an interface with sensible gain; `plug-meter.js`)
rendered offline through the rig and then the band's own soft clip and trim.

| what | target | measured by |
|---|---|---|
| each amp, default knobs, no pedals | −14 LUFS ±0.5, true peak ≤ −1 dBFS | `plug-level.js` |
| each preset | −14 LUFS ±1 (a lead up to −12.5), true peak ≤ −1 dBFS | `plug-level.js` (`BANK=`) |
| each pedal, on against off | drive and fuzz +0.5…+3 LU; the rest ±1.5 LU; the rig's true peak ≤ −1 dBFS | `pedal-check.js` |
| each cab and mic setting | within ±1.5 LU of the amp's own cab | `cab-check.js` |
| each keys patch | −14 LUFS ±1, true peak ≤ −1 dBFS (`KY_TRIM`) | `keys-test.js` |
| a loop played back | as loud as the live guitar, ±0.5 LU | `looper-test.js` |
| a trade-fours answer | each bar within ±1.5 LU of the Lead lane's own blocks | `fours-test.js` |
| jam tracks | −9 to −10.4 LUFS: about 1 LU under a song, as the guitar fills it | `jam-test.js` |
| the band's master (unchanged) | −8 to −9 LUFS, true peak ≤ −0.3 dBFS; the mix insert at 0 dB is bit for bit | `mix-check.js` |

The amp's LEVEL (MASTER) knob is what evens presets out. With a guitar at the amp's −14 over the band, the master
comes out about −7.4 to −7.7 LUFS (the band alone is −8.8): the soft clip holds the peaks, and the YOU and BAND faders
are the player's to move. Whether the defaults should change is a decision for AJ, not a test.

## Storage

Nothing live is in the song code. It's all per browser.

**localStorage** (through the app's `store`):

| key | what |
|---|---|
| `clawd-o-matic:plug` | the rig: amp, knobs, board, cab and mics, input channel and device, the active preset |
| `clawd-o-matic:plug-presets` | your saved presets |
| `clawd-o-matic:plug-open` | which folds of the Plug in tab are open |
| `clawd-o-matic:amp-filter`, `:cab-open` | the amp wall's filter; the cab view |
| `clawd-o-matic:mix` | the BAND / YOU / LOOPS faders (dB) |
| `clawd-o-matic:latency` | measured round trips, per input `deviceId` |
| `clawd-o-matic:looper` | the loop station's settings |
| `clawd-o-matic:rec` | the recorder's settings |
| `clawd-o-matic:tracks` | the tracks' settings |
| `clawd-o-matic:stagecam` | the camera: key, look, spot |
| `clawd-o-matic:avatar` | your crab's look |
| `clawd-o-matic:jam-home`, `:jam-guide` | the song you left for a jam track; the tab's guide |
| `clawd-o-matic:solo-guide` | the studio's guide (mode, picked scales) |
| `clawd-o-matic:fours` | trade fours' settings |
| `clawd-o-matic:drums`, `:drum-songs` | the drum pedal's settings; your programmed drum songs |
| `clawd-o-matic:keys` | patch, octave, transpose, curve, route, device, INSTRUMENT |
| `clawd-o-matic:scenes` | scene maps, per song title (up to 80 songs) |
| `clawd-o-matic:studio` | the studio: drawer, keys on, click, count-in, favourites, footswitch profile and binds, MIDI |
| `clawd-o-matic:onboard` | how far Getting started got, and which tips have shown |

**IndexedDB** (each falls back to memory, with a note, where it's refused):

| database | what |
|---|---|
| `clawd-o-matic-takes` | takes: the three stems as floats, and their metadata |
| `clawd-o-matic-tracks` | tracks: each song's tracks and their takes (DI and amped) |
| `clawd-o-matic-takecam` | the camera recorded during takes (WebM), with the clean plate and key settings |

These keys and names are read back by every browser that has used the page, so don't rename them, and keep what's in
them meaning the same thing (clean what you read, as `boardClean` and `plugCabClean` do).

## Rules learned the hard way

- **Ids are forever.** Players' saves, presets and scene maps name pedal ids and knob keys, preset and bank
  ids, amp ids, cab and mic ids, and feature ids (`#studio/<id>`). Never rename one, never reuse one for something
  else, and keep old knob ranges meaning the same thing. `pedalDef` and `presetBank` refuse a taken id with a
  `console.error` (the first keeps it), and `pedal-check.js` fails on it. Names must be unique too.
- **The guitar never goes into a render.** The song renderer (the workers, `compat.js`'s hashes) never sees the live
  rig; the mix insert is on the live graph only and is exact at 0 dB. Features that write into the song (the drum
  pedal's blocks) write ordinary blocks.
- **Never `Math.random` in DSP.** Offline renders (the tools, bounces, re-amps) must be the same every time: use
  `kit.rng(seed)`, `kit.seed` (per instance, stable across reloads), or a seeded LCG in a worklet. `Math.random` is
  fine for a take's id.
- **Start an AudioBufferSource on a sample frame** (`Math.round(t * sr) / sr`). One started between two samples is
  interpolated, which dulls its top end by a few dB. Takes, tracks and take videos all do this.
- **Load worklets from a `data:` URL**, falling back to `blob:` (`pfxWorklet(c, name, src)`): a data: URL loads from
  `file://`, where a blob: one doesn't. Once per context per name. Processor names are global: prefix them. `process`
  returns `true`, copes with a missing input, and allocates nothing.
- **A worklet node that's done must be let go.** Chrome calls a processor whose `process` returns `true` every render
  quantum for ever, connected or not, and never collects its node. So one made per use (a take, a capture) returns
  `false` once it's finished; a pedal's (made with `kit.worklet`) is sent `{ __pfxEnd }` when the pedal is disposed,
  and `pfxWorklet`'s shim makes it return `false` from then on (`pfxEnd(node)` does the same for any node from a
  `pfxWorklet` source). Before this, every preset change, re-plug and take left a processor running.
- **Idle features cost nothing.** A tap that only matters while a feature is on is fed only then (trade fours' tap).
  `tools/perf-check.js` measures what's processing and the audio thread's headroom.
- **Every change ramps.** Knobs glide (`x.to`), stomps crossfade over 10 ms, a new amp ducks and comes back, the
  board dips while it rewires. A scheduled change (`PLUG.applyAt`) lands on the audio clock, not the main thread's.
- **Read the band's time from `PLUG.clock`**, never the song's transport, or the drum pedal won't drive you. Take the
  round trip from `PLUG.latency` (plus `rig.chain.latency` for the wet signal) and move what you recorded earlier by
  it: a player plays to what they hear.
- **Tap the buses, don't feed them**, except `returns` (played-back guitar) and `guitar` (live playing: keys).
- **Two views, one state.** The panel and the studio can both be mounted; neither may own state in its DOM.
- **Under load, some tests flake**: pedal-check's live click test (it now judges the median of three, against a
  reference tone captured beside it) and studio-test's frame p95. Rerun them on a quiet machine before believing a
  failure.

## The tests

All drive Chromium through playwright-core (`PLAYWRIGHT_CORE`, `CHROMIUM`, `OUTDIR`) except where they say Node.
Most take `PAGE=` to test a copy: `node web/build.js --out=$OUTDIR/p.html && PAGE=$OUTDIR/p.html node web/tools/…`.
Each prints ok/FAIL lines and exits 1 on a failure. Screenshots (1400 or 1440 wide and 390 wide, and no sideways
scroll at 390) are part of nearly every one.

| tool | checks |
|---|---|
| `plug-level.js` | every amp's level, voice (centroid, THD, aliasing) and near-duplicates; extremes; a live amp change without a jump; the fake input plugged in (meter, tuner); every preset's level and gate; the patch browser. `AMPS=`, `BANK=`, `PRESETS=0` or `only`, `KEYS=1`, `LIVE=0` |
| `pedal-check.js` | every pedal: meta, level, bypass to −90 dB, extremes (NaN, peaks, tails), latency and cost; the clock and `sync`; the live board is click-free; the board's UI; duplicate ids and names. `PEDALS=`, `BOARD=0`, `UI=0`, `CLOCK=0`, `WAV=1` |
| `cab-check.js` | defaults bit for bit against a page built before cabs (`BASE=`); every cab and mic setting's level; extremes; latency; Abyss's octave; the cab view |
| `mix-check.js` | the mix insert at 0 dB is exact; BAND −6 and +3; the YIN tracker names notes low E to E6 and never names a chord |
| `latency-test.js` | the onset detector and loopback correlation (Node), then strum along and loopback in the page (±1 ms / ±1 sample), per-device persistence, and the features using the number |
| `looper-test.js` | SYNC loop lengths and click placement to the frame, seams, overdub and undo bit for bit, loop level, FREE and follow-my-loop, the station's keys |
| `recorder-test.js` | stem alignment to the sample with and without a round trip, band takes' length and peak, WAVs, IndexedDB across reloads, re-amp, no IndexedDB, the real input |
| `takevideo-test.js` | a take filmed: picture within a frame of the sound (a barcode clock on every frame), loudness ±0.2 LU, cancel, the stage cam replayed. Needs ffmpeg |
| `tracks-test.js` | clicks on the grid after the round trip; playback from a seek; track 2 aligned to track 1 to the sample; mute, solo, pan; punch; tempo change; re-amp; reload; bounce; no IndexedDB |
| `stagecam-test.js` | the keyer's matte against the figure's mask (IoU ≥ 0.95 plate, ≥ 0.9 colour); the fake camera end to end; frame time |
| `avatar-test.js` | the crab walks on, strums on onsets, frets with pitch, jumps, takes the spotlight, steps off for the camera, persists, costs < 0.5 ms a frame |
| `jam-test.js` | every jam track (Node: blocks, song codes, length; the theory), their levels in the page, the browser and the guide. `ONLY=`, `TRACKS=` |
| `fours-test.js` | the note tracker on known melodies and strums; the answer's rules over every key and chord; its level; the whole turn in the page |
| `drums-test.js` | the styles; the state machine on bar lines (±1 ms, and in the audio); the looper over the drums; the song taking over; levels; the studio |
| `keys-test.js` | every patch's level; MIDI (injected); note-to-sound timing; 16-voice stealing; nothing sticks; Nyquist on stage; the keys; the guitar bus |
| `scenes-test.js` | switches land within ±10 ms of the bar line and never click; loop wraps and seeks; learn; persistence; the lane and the drawer |
| `studio-test.js` | G, `#studio/…`, every drawer and key, no sideways scroll from 390 to 1920 wide, one rAF loop and frame p95 ≤ 20 ms (`SLOW=ok` reports only), the guide, the faders, footswitches, the count-in |
| `onboard-test.js` | the first run opens by itself only without webdriver; every step; persistence; one-time tips |
| `perf-check.js` | the live rig's cost with the band playing (plugged in; the studio; a full heavy board; loops, tracks and the recorder; after churn): worklets processing and their share of the audio thread, its headroom, rAF and timers, heap (`MEM=`); no let-go worklet still processed |
| `plug-meter.js` | not a test: the shared DI strum, LUFS, true peak and WAV writer |

Before committing a live-guitar change, run the tests for what you touched, plus `robust-test.js`, `mobile-test.js`,
`plug-level.js` and `compat.js`.

## Known rough edges

- Most of this has only met Chromium's fake input and synthetic signals. Trade fours' thresholds, the stage cam's key
  and the avatar's onsets haven't been tried with a real guitar and camera.
- The latency measurement is per input device; a change of output device isn't noticed.
- Some older pedals (Jelly Pulse, Claw Chopper, Sidestep, Pump Fish, the glitch grids) poll `PLUG.clock` on their own
  timers instead of using `sync`.
- A loop's WAV ignores reverse and half speed. Export's music video has about 50 ms of AAC lag.
