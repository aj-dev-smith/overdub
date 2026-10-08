# Instruments: a new idea is a new track, and you pick its sound by hearing it

Spec for branch `ux-instruments` (from `ux-simple`, 2026-10-05; revised the same day after three critiques, section 9).
It fixes the path AJ walked in the simple view: getting from a beat to a second track with a sound you chose, and
seeing that sound. Both views get it; where the full studio keeps today's behaviour, this says so. File references are
to the `ux-simple` tree this branch starts from (`32e89a2`).

*Since then: the studio is one view with everything on screen, More became Find (⌘K), and Simple view is reached only
at `?view=simple`, never by default. Where this spec says Simple view or More, that is the history it was written in.*

The direction agreed with AJ:

1. **A new idea is a new track.** Hum, Play or Tap on a song with tracks lands on a new track unless you picked one.
   Recording onto a track that's already there is a deliberate choice (Onto, or selecting it).
2. **Pick a sound by hearing it.** After a take on a new track, a card asks "What should this sound like?", plays
   *their* take straight away and lets them step through 3 or 4 fitting instruments by ear. Keep one; it's undoable
   and signed you. The agent can suggest sounds into the same card.
3. **The track's header shows its instrument, and its name opens it big**: the existing device window, with its
   face, knobs and a playable keyboard. The rack's small Open is no longer the only way.
4. **The browser never silently overwrites.** A click tries the instrument on the selected track, with Keep and Back.
   A melodic instrument clicked while a drum track is selected offers "New track with Light Table" instead of
   replacing the kit.
5. **One clear way into sounds:** a **Sounds** button on each track, plus the agent.

The goal is measured (section 6.1, check 17): from a blank song, **4 clicks or keys** until the person hears their own
hum on a second instrument.

**Words.** Every on-screen string says **track**, as the browser, the arranger, the transport, the importers, Grooves
and BRAND already do, and as AJ does. This spec says "track" too. (The first draft said "part" in new copy only, which
would have mixed two words in one studio.)

## 0. What AJ hit, reproduced

`node tools/instruments-repro.js` (QUIET: `tools/pw.js` `open()` adds `--mute-audio`) runs AJ's path on a blank song
in the simple view, with a fake mic that hums C4 E4 G4 A4 G4 E4 D4 C4. Screenshots land in
`tools/.out/ux-instruments/before/` (`desk-*` at 1440x900, `phone-*` at 390x844, and the variants below). What it
shows:

| Step | What happens today | Screenshot |
|---|---|---|
| Blank song, Tap a beat | `onboard.firstMinute('tap')` adds Drums (Gobo Kit), selects it, loops bars 1-2 with the click, opens Sketch on Tap it. The top bar says "Keys play Drums" (`transport.js` `keysHeld`, around `:771`). | `desk-02-tap-a-beat` |
| R, tap F J K L, Space | 16 hits on Drums, bars 1-2, one undo step. The coach: "Your beat is in the song. Next, play a tune over it on the keys, or let the agent play a part over it." Its buttons are Play keys over it and Ask the demo agent. **There is no Hum over it.** | `desk-04-kept` |
| AJ hums | Sketch is still on Tap it, and the only mic button in view is **Beatbox** (`sketch.js:1019`). A hum into it comes back as "Your beat is in. 8 hits, 2 bars." and Keep says **On Drums**. The hum lands on the drums as drum hits. | `beatbox-04c-hummed-into-beatbox` |
| Hum it, then R | The hum lands on a new track, Keys (Lamp Tines): `recorder.targetFor('hum')` skips an unarmed drum track (`recorder.js:370-379`, `partOf` at `:434-440`). Right for this path, but nothing told AJ, and the Onto picker that would have is put away in the simple view (`sketch.js:626`, `record-options`). | `desk-07-hum-landed` |
| Hum it, the Hum button, Keep | The keep select beside Keep defaults to **"New track, Pluck"** (`NEW_TRACK_DEVICES`, `sketch.js:66`, `:287`), a different instrument and name from R's new track (Keys, `recorder.js:440`) and from capture's own default ("Hum", `capture.js:252`). Several defaults for one idea (section 1.2 lists all five). | `desk-08-hum-take` |
| `/` to find a sound | In the simple view the Browser is put away and `/` goes to the agent's ask box instead (`agent/panel.js:859`: `/` asks while the left pane is closed). | `desk-09a-slash` |
| More, add Instruments and effects, click Light Table (Drums selected) | **"Drums now plays Light Table (was Gobo Kit)"**: `browser.js:213` calls `rack.addDevice` (`rack.js:102-131`), an `instrument.set` on the selected track. The beat now plays Light Table's notes. The target line warned ("An instrument replaces Gobo Kit (Shift-click: a new track)"), in 11.5 px pencil. | `drumsel-10-light-table-clicked` |
| See what Light Table is | The header shows "Light Table" as plain words: in the simple view the header's devices button is put away (`arranger.js:905-907`, `.ws-off-devices .ar-hdevname`, `:3533-3536`). The way in is More, add Sound, the Devices tab, then **Open**, a 34x20 px text button at 11.5 px beside the name on the rack's caption (`rack.js:843`). | `desk-11-header`, `desk-12-devices-tab` |
| Open | The window is good: Light Table's own editor, presets, A/B, the keyboard (`plugin.js`). Nothing on the main path leads to it. | `desk-13-light-table-open` |

Three more findings:

- A click on a track header selects it but doesn't arm it (`clickhead-*`: `arm` stays false), so selecting Drums
  doesn't send a hum there. The drums AJ hit came from the Beatbox button and the browser click, not from the arm.
- Musical typing plays the selected track ("Keys play Drums"), and with no target `input.target('keys')` falls back
  to the first instrument track (`input/index.js:37-40`). After Tap a beat, the keys play the drum kit, whatever the
  take will land on. Section 1.1 fixes this: you hear what you record.
- The hum is never put in tune on a blank song or over the first minute's drums: `keyChosen()` is false there, and
  `transcribe` snaps into the heard key only with `snapHeard` (`input/hum.js:87-100`, `:223-224`; Sketch's Snap chip
  is off by default, `sketch.js:841`). No instrument makes an out-of-tune hum sound pretty. Section 1.4 fixes this.

## 1. Model

### 1.1 Where a take goes (`input/recorder.js`, the "aim")

Each way in has a kind: `hum` (Hum it, the mic as pitch), `keys` (MIDI, musical typing, touch keys), `pads` (Tap it's
pads and keys, Beatbox) and `audio` (Record). Every kind has an **aim**: the track its next take goes onto, or a new
track.

The aim is session state, not the song, and it lives in the recorder (so the Node checks can drive it without a
shell):

```js
recorder.aim(kind)          -> { track: id | null, why: 'choice' | 'selected' | 'last' | 'only-kit' | 'armed' | 'new' }
recorder.setAim(kind, v)    // v: a track id, 'new' (one-shot) or null (clear the choice); emits 'aim'
recorder.on('aim', fn)      // the top bar, Sketch's Onto, the arranger's ghost lane and lamps redraw on it
```

Inside: `{ song, choice: { hum, keys, pads }, last: { hum, keys, pads }, lastAt: { hum, keys, pads } }`, cleared when
another song loads (`store` `'load'`). Nothing of it is written to the song, `localStorage` or a share link. The view
is read from `app.ui?.workspace?.view?.()` (`workspace.js:221`); with no shell (Node) the recorder takes
`createRecorder(..., { view })` for the checks.

- `choice[kind]` is what the person picked in **Onto** (section 2.1). A track id stays until they pick again, the
  track is removed or another song loads. **`'new'` is one-shot**: when the take commits, `choice[kind]` is cleared and
  the track it made is `last[kind]` (and selected), so the next take of that kind goes onto that track (stacked or
  beside it, below), never a Melody 3, and a track clicked after it still wins. (Integration: the first draft made the
  spent choice that track's id, which outranked a later click.)
- `last[kind]` is the track the last take of that kind went onto in this song, this session, and `lastAt[kind]` when.
- The **selection counts when it is newer than the last take**: a track the person clicked after their last take of
  that kind (`ui.on('select')` time against `lastAt[kind]`) is a deliberate act, and it wins over `last`.

**`targetFor(kind)` in the simple view** (`recorder.js:370`), in order:

1. `audio`: today's rule (an armed audio track, else the selected one; null makes one). Unchanged.
2. `choice[kind]`: `'new'` returns null; a track id returns that track if it is still in the song and fits.
3. The selected track, if it fits and was selected after `lastAt[kind]` (or there is no last take of that kind).
4. `last[kind]`, if it is still in the song and fits.
5. `pads` only: the song's only drum track, whether it has clips or not. A tap onto a beat layers onto it, as people
   expect, also after a reload (when `last` is empty). Two or more drum tracks and none picked or selected: a new one.
6. Otherwise null: **a new track**.

"Fits": `pads` needs a drum track; `hum` and `keys` need a pitched track. A drum track is offered to `keys` only as a
deliberate Onto choice (pads on a controller). In the simple view the header's arm is not a way to aim (its R is put
away), but the aim is always shown (section 2.3, the lit R and the ghost lane), so nothing routes a take unseen.

On commit, `last[kind]` and `lastAt[kind]` are set to each kind's track, and **the track the take went onto is
selected** (`ui.select`), in both views. So the next take, and the keys, follow the idea you just made.

**In the full studio**, `targetFor` keeps the armed track first, because full-studio users record onto the lit R and
rely on it:

1. `audio`: unchanged.
2. `choice[kind]` (as above, `'new'` one-shot). Arming or disarming a track by hand, from a header's R, clears every
   `choice` (the recorder sees a `track.set` with `arm` in its patch by you), so the most recent deliberate act wins.
3. An armed track that fits (hum and keys: an armed pitched track, then an armed drum track for keys only; pads: an
   armed drum track).
4. The selected track that fits (a hum never goes onto an unarmed drum track).
5. Otherwise null: a new track. **The "first pitched track" fallback goes** (`recorder.js:378`): with Drums selected
   and nothing armed, a full-studio hum went onto whichever pitched track came first, usually Bass, the same mistake
   AJ hit in the other view. A full-studio user who arms loses nothing.

**One rule for what's lit:** whatever is lit is where the take goes. In the full studio, picking "A new track" in Onto
disarms every track (one `track.set` per armed track, signed you, labelled "record onto a new track") and lights the
ghost lane's R (section 2.3); picking a track arms it, as `pickTarget` does today (`sketch.js:645`).

**The keys are heard where they'll be recorded.** Keys need a track to sound on (`engine.liveNoteOn` takes a track
id; `recorder.noteOn` drops notes without one, `recorder.js:510`). So when the `keys` aim is a new track and the
person turns on musical typing, touches the on-screen keys or sends the first MIDI note, the track is made then: one
`track.add` from `newPartFor('keys')`, signed you, selected, and said once in the top bar's line ("Keys play a new
track, Keys (Lamp Tines). Undo takes it away."). `input.target('keys')` (`input/index.js:37-40`) loses its
first-instrument fallback in both views and reads the aim. `record()`'s dead end ("New track: Keys. Press R again",
`recorder.js:696-700`) goes: R with keys aimed at a new track makes it at the count-in and records in the same press.
`hum` and `pads` keep making their track at commit (`partOf`, `recorder.js:434-440`), since nothing sounds live on them
until then.

`lands()`, `onto()` and `primary()` (`recorder.js:383-404`) read the aim, so the top bar's Onto, Sketch's Onto, the
count-in numeral, the lit R, the ghost lane and the take line agree.

**A second take on the same track.** A take stacks as a take (`modeFor` `'take'`, the earlier ones muted) only when its
bars overlap an earlier take on that track. Otherwise it is a new clip on the same track beside it, and nothing is
muted. When a take does mute an earlier one, Onto says so before R ("Onto: Melody, a new take") and the take line says
so after: "Take 2 is in on Melody; Take 1 is muted." with **Put it on its own track** (`.btn-txt`): one dispatch,
signed you, that adds a track from `newPartFor` with Melody's instrument, moves the new clip there out of the take
folder and unmutes Take 1 (one undo step). A harmony or an answer line is one click from both playing.

### 1.2 The new track

A new track is made in the take's own transaction, as today (`planTake`, `recorder.js:197-211`; `capture.keep`,
`capture.js:250-252`), except the keys' track (1.1). Its name and first instrument come from one place,
`core/sounds.js` (section 3.1):

| Kind | Name (then "Melody 2", "Melody 3") | First instrument |
|---|---|---|
| hum | Melody | `core.keys` Lamp Tines |
| keys | Keys | `core.keys` Lamp Tines |
| pads, beatbox | Drums | `core.drums` Gobo Kit |

This replaces five defaults: `NEW_TRACK_DEVICES` (`sketch.js:66`), `partOf`'s `{ name: 'Keys', device: 'core.keys' }`
(`recorder.js:440`), `record()`'s empty-song Keys (`recorder.js:697`), Shift+R's `captureToSong` (`recorder.js:941`,
Keys or Drums) and `capture.keep`'s "Beat" / "Hum" / "Idea" (`capture.js:252`, `pickDevice` at `:273`). The first
instrument is a starting point: the card (section 2.2) is where the sound is chosen.

**Names that stay true.** A track the browser makes is named after its device ("Light Table", as today). When a
track's name still equals its old instrument's name and a sound is kept on it (card, browser or drop), the same
dispatch renames it to the new instrument's name. A name the person typed is never touched.

### 1.3 Trying a sound (`ui/sounds.js`, new)

Trying an instrument on a track is a **preview**: `store.preview({ type: 'instrument.set', track, device, preset? }, { by: 'you' })`
(`core/store.js:186`), applied silently and never in History. One track is tried at a time; trying another sound
releases the last preview first, then previews the next. **Keep** releases the preview and dispatches one op in the
same task:

```js
store.dispatch([{ type: 'instrument.set', track, device, preset }, ...renameIfNamedAfterOld],
  { by: 'you', label: `${track}: ${name} (was ${was})`, reason: suggestedBy ? `suggested by ${agentName}` : undefined })
```

No `audition` flag: that flag means "only a listen" and History, the History tab's counts, provenance, the share
banner's edited check and the coach all skip it (`agent/history.js:56,64,94`, `ui/provenance.js:167-170`,
`ui/share.js`, `ui/onboard.js:162`). A kept sound is a real edit. One undo step, signed you, and its inverse puts back
the whole old instrument (`ops.js:747-756`, `_restore`). An agent's suggestion the person kept is still theirs;
History's reason line says who suggested it.

Release and dispatch run in one task so the engine rebuilds the device once; WP3 checks it (an engine counter of
instrument builds on that track goes up by one on Keep, and an offline render across the Keep has no step over
-60 dBFS at the swap). If it rebuilds twice, the engine's reconcile is batched to a microtask.

**Back** releases the preview: the track plays what it played before, and nothing is in History.

**On an uncommitted take** (Sketch's Hum it, Tap it or Play it take before Keep) there is no track to try a sound on.
The card then previews the track the Keep would make: `store.preview({ type: 'track.add', track: { name, instrument:
{ device, preset } } })`, as Grooves previews its "Hearing" track (`ui/grooves.js:44-58`), and Sketch's `hear()`
(`sketch.js:331`) plays the take on it. The arranger draws that previewed track as the ghost lane (2.3). The take's
Keep releases it and makes the track with the chosen instrument in the take's own transaction: track, clip and sound
in one undo step, signed you. A take kept onto an existing track has no preview track: its card tries sounds on that
track as above.

Hearing it, when the card comes up from a take: the take plays at once on the current sound from its first bar (loop
round the take's bars only if the transport was looping), and the "now" row has focus, so ↓ tries the next one
straight away. A tap on a row previews it and, when the transport is stopped, plays from the take's first bar. When
the song's loop doesn't hold the take, the same preview handle carries `{ type: 'project.set', patch: { loop: { on:
true, start, end } } }` over the take's bars and is released with the instrument. When the transport is already
playing it keeps playing. Swaps wait for `engine.settled()` before the first note, as Grooves does. ↑ ↓ held down
start a trial only once the key has rested 150 ms on a row, so holding an arrow doesn't stack previews. The top bar's
Stop and Space stop it.

**What ends a trial**, and what each says:

- **Back, Esc:** back to what it played. The card's status line: "Back to Lamp Tines."
- **Keep, Enter:** kept (above).
- **Recording starts** on that track: **Keep first, said before it happens.** During the count-in and in the record
  line: "Recording keeps Light Table on Melody." The instrument change and the take are two History entries, in that
  order, so one ⌘Z takes the take back and a second takes the sound back.
- **A control of the tried instrument is touched** (its window's knobs, a preset, A/B): Keep first; the card says
  "Kept Light Table on Melody, to change it."
- **An undo or redo that touches the tried track:** Back first, then the undo runs, so releasing the preview later
  can't overwrite what the undo put back.
- **An agent tool that reads or changes the song** (`ui.on('agent:tool', { phase: 'start' })`, as `grooves.js:527`):
  Back first, so the agent sees the song as it is. Not for `suggest_sounds`, `get_variation_result`, `say`,
  `ask_human`, `get_recording` or `highlight`, which don't read the song (as `propose_variations`: "your next call
  that reads or changes the song lets go"). The card's status line says why: "Back to Lamp Tines while Claude works.
  Light Table wasn't kept."
- **Anything else** (another track selected, the browser's pane closed, the track removed, another song loaded, the
  page hidden): Back, with a toast: "Back to Gobo Kit on Drums; Light Table wasn't kept." and **Keep it** (which
  dispatches the Keep it would have). A removed track or another song: no Keep it.
- **The autosave catches a preview:** while one is applied, `localStorage['overdub:sound-trying'] = { song, track,
  instrument, newTrack?, at }` (a new, permanent key) holds the track's real instrument, or names the previewed new
  track; the next boot puts it back (or takes the previewed track out) with `store.preview(..., { by: 'overdub' })`
  and nothing in History, as `healLeftover` does (`grooves.js:44-58`).

A click outside the card does **not** end a trial (section 2.2).

### 1.4 A hum is put in tune

A hum onto a **new track**, in a song whose key nobody chose (`keyChosen()` false), is transcribed with
`snapHeard: true`: its notes move into the key heard in the hum (`input/hum.js` `takeOpts`, `:323`, sets it from the
aim before `finishTake`). The move is counted and said, as the song-key snap already says it (`sayMoved`,
`hum.js:265`): "Moved 3 notes into A minor, the key you hummed in." with **Undo**, which puts them back as sung. On
the card, for a hum take not yet kept, one line holds an **In tune** lamp (`.tog`, lit by default), the same state as
Sketch's Snap chip (`sketch.js:841`); off is "As sung". A hum onto an existing track keeps today's rule.

With nothing to play in time with (no other track and the click off), a hum keeps its timing (`keepTiming: true`)
instead of being pulled to 16ths at 120 BPM it never heard. Over a beat or the click it is quantized as today.

## 2. Behaviours

### 2.1 Onto: one line, both views (`ui/sketch.js`, `ui/transport.js`)

Sketch's record strip Onto picker (`sketch.js:612`, `tgtSel`) comes out of `record-options`: it is no longer put away
in the simple view (`sketch.js:626` drops `dataset: { feature: 'record-options' }` from `.sk-onto`; Each pass,
Count-in and Click stay in `record-options`). It reads like a spec sheet ("Onto" over the value) and lists:

- **A new track** (value `new`), always first.
- The tracks that fit the mode's kind (`stripTracks`, `sketch.js:602`), by name. When the aimed track would stack the
  take over an earlier one, its value reads "Melody, a new take".

Its value is `recorder.aim(kind)` (a new track when null). Picking calls `recorder.setAim(kind, v)`. In the full studio
a pick of a track still selects and arms it (`pickTarget`), and "A new track" disarms (1.1), so the lit R agrees; in
the simple view a pick only sets the aim.

The top bar's Onto (`transport.js:487-500`, `pickRecTrack`) gains "A new track" first and calls `setAim` the same way.
It stays in `record-options` (it is a full-studio control and the simple first screen's budget doesn't move). Its
copy moves to the aim: "No track yet: R makes one (Keys)" and "onto a new track (Keys)" (`:493`, `:943-944`) become
"R records onto a new track ({newPartFor name})", and the hum's "(a hum goes onto a drum track only when it's armed)"
stays for the full studio only. The keys line ("Keys play Drums", `keysHeld`, around `:771`) names the aim: "Keys play
Keys" once the keys' track exists (1.1).

The keep select beside a take's Keep (`destSelect`, `sketch.js:275-293`) becomes the same list with the same default:
"A new track", then "On Melody", "On Keys". `NEW_TRACK_DEVICES` goes; the instrument is the card's job. On a phone
Keep already follows the strip's picker (`stripDest`, `sketch.js:260`); it says "Keep on a new track" when that is
where it goes. `keepTo` (`sketch.js:295`) passes `newTrack: { name, device }` from `core/sounds.js`, with the device
the card has on trial (1.3).

The idea cards' Keep on… menu (`keepMenu`, `sketch.js:1603`) lists "A new track" first, then the tracks.

### 2.2 The sound card: "What should this sound like?"

**When it's offered.** On the **first take onto a track that had no clips**: R's commit, a take kept from Sketch, a
Shift+R capture, the coach's Play keys over it (whose Keys track is made before the take, `onboard.js:396`), or a
track added by hand. Once per track. A take onto a track that already had clips doesn't offer it.

**Simple view and full studio differ in one thing: whether it opens by itself.**

- *Simple view:* it opens by itself, with the take playing (1.3).
  - **On a computer** it floats as a popover under the track's header (the new track's, or the ghost lane's for a take
    not kept yet), whole on screen. (It first sat in Sketch's stage beside the take's canvas; at 1440x900 the stage is
    a strip a few hundred pixels tall, and the rows fell under the window's edge: section 10.) On a take not kept yet
    its own Keep keeps the take with the sound heard (`app.sketch.keepTake`), and the take line's Keep still does too.
    The musician hears it pretty before deciding to keep it.
  - **On a phone** (Sketch's split sheet) it sits in Sketch's sheet under the take's row, as below.
- *Full studio:* it doesn't open by itself; a producer recording five ideas in a row gets no dialog after each. The
  take's toast gets a second line, "What should it sound like? **Sounds**" (`.btn-txt`), and the uncommitted Sketch
  take gets **Sounds** (`.btn-txt`) on its take line. Both open the card where the simple view puts it.
- *Both views:* the new track's header shows **Sounds** as pending (2.3) until the card has been opened once on it, so
  the toast is a hint, never the only door.

**Where it sits otherwise.**

- *From a header's Sounds or the device window's Sounds:* a popover under the button (`rack.js` `popover`, `:153`),
  never modal.
- *Phone (under 900 px):* a bottom sheet in the studio's existing phone-sheet style (the More sheet's), up to 70% of
  the height. After a take in Sketch it opens in Sketch's sheet under the take row (`takeRow`, `sketch.js:809`).

**Closing.** While a sound is being tried, a click outside does **not** close the card, the popover or the sheet, and
does not end the trial: you can click the arranger to press Play and keep listening. Only Keep, Back, Esc and × close
it, and × is Back (aria-label "Close, back to {Was}"). With nothing on trial, a click outside closes it.

**What's on it** (liner notes: a ledger under a plain head, no card in a card, no pills, no stripes):

```
What should this sound like?                                         ×
Your hum, on 4 sounds. ↓ tries the next.
────────────────────────────────────────────────────────────────────────
  Lamp Tines      Electric piano: bark and shimmer…              now
▪ Light Table     Synth: two morphing wavetables…                hearing
  Music Stands    Strings: slow bows, vibrato, a hall around it
  Choir Loft      Choir: soft vowels…                            suggested by Claude
────────────────────────────────────────────────────────────────────────
[■] In tune
Hearing your hum on Light Table, bars 1–4. Space stops.
[Keep Light Table]   Back to Lamp Tines
Open Light Table   More sounds   Ask Claude for others
```

- `.head` (13.5 px, 600), not a `.sheet-head`: Sketch already has "Takes".
- Rows are `.ledger` rows (`--ledger-cols: 12px 1fr auto`): the device's 8 px swatch (`swatchOf`, `rack.js:88`), the
  name (600), then in pencil its **family** and blurb ("Electric piano: bark and shimmer", cut with an ellipsis; the
  whole on the row's title). The family is a plain word a newcomer knows, from the set's row in `core/sounds.js`
  (section 3.1), else the blurb's words before its colon (the wavetable presets' blurbs start with their family,
  `wavetable.js:1175`). On a phone the blurb drops and the family stays: "Lamp Tines" over "Electric piano".
- The state at the right in pencil: **now** (what the track plays, outside a trial), **hearing** (the one being
  tried). The row being tried is reverse print (`.ledger-row.sel`): every text on it, the state included, is in
  `--bg` ink (kit rule 7), with a lit `.tog`-style lamp, the only glow.
- A device's own maker signs it as the browser does (`byline(def.by)`; the house unsigned). A row an agent suggested
  says **suggested by Claude** in cool ink in place of the state, and its `why` as the row's second line in italic
  pencil (`.why`).
- **In tune** (1.4): only for a hum take not yet kept.
- First line of buttons, for the decision: **Keep {name}** and **Back to {was}** (`.btn-txt`, while a trial differs
  from what the track plays). Keep is the region's one primary (`.btn-go`) only when no other `.btn-go` is in it: on
  an uncommitted Sketch take, the take's own Keep is the primary and carries the sound, and the card shows no Keep of
  its own (kit rule 14). Outside a trial the button reads **Done** (`.btn`) and closes the card.
- Second, quieter line: **Open {name}** (`.btn-txt`; Keep first if it is a trial, then
  `app.plugin.open({ track, slot: 'instrument' })`), **More sounds** (`.btn-txt`: the browser searched to the take's
  category, section 2.4, `ui.show('browser')`, which in the simple view adds it, signed you) and **Ask {agent} for
  others** (`.btn-txt` with `icon('agent')`: `ui.emit('agent:compose', { text: 'Other sounds for Melody?', send: true,
  attach: { track } })`, answered with `suggest_sounds`, 2.6).
- The status line (`role=status`) says what's playing and what changed.
- No more than four rows besides "now". Two rows are the same sound when their device and preset match (`presetNow`
  for the track's current preset), so "Gobo Kit" and "Gobo Kit, Studio kit" don't both show when the kit already is
  on Studio kit.

**Keys.** ↑ ↓ move between rows and try the one they land on (debounced, 1.3), Enter keeps, Esc is Back then close.
Declared through `ui.keys.add` with `when` (the card focused), never bound on the element. On a phone every row is
48 px tall and the buttons are the kit's 40 px.

**The card isn't the only view of the choice.** While a trial runs, the track's header names the sound being tried in
pencil italic ("Light Table, trying"), the device window (if open on that track) rebuilds onto it (`plugin.js:913-918`
already follows the track's instrument changing), and the browser's target line says "Trying Light Table on Melody".

### 2.3 The track's header and the arranger (`ui/arranger.js`)

Today the sub row is the swatch, `.ar-hdevname` (words, shown only while `devices` is put away) and `.ar-hdev` (the
devices button, opening the rack: `arranger.js:905-907`). It becomes:

- **The instrument as a button**, `.ar-hinst`, in both views: the swatch, the name in `--text-2`, and a small open
  glyph after it (`icon('open')`, a new 12 px square-and-arrow stroke in `dom.js`, `currentColor`), visible at rest,
  so it reads as something to open without a hover (touch has none). Underlined on hover and focus, no box. **Only the
  name and glyph open**: a click there selects the track and opens its instrument big with
  `app.plugin.open({ track, slot: 'instrument' })`. A click on the header's empty space or the swatch selects as
  today and opens nothing. It is untagged, so the simple view always shows it.
  - The window is the existing one (`plugin.js`, ARCHITECTURE "Device windows"): the device's own editor where it has
    one (Light Table's `ui/editors/wavetable.js`), presets, A/B and the keyboard. On a computer it is placed so it
    doesn't cover the selected track's lane (`place()`, `plugin.js:352-368`: over the lower half of the arranger when
    the lane is in the upper half, else the upper); a full-height sheet on a phone. Esc closes it and gives focus back
    to the arranger (`lastOpener`).
  - **A held instrument** (kept off on this computer): `plugin.open` refuses it (`plugin.js:166`), so `.ar-hinst`
    opens the Devices tab instead (`ui.show('rack')`, which adds it in the simple view, signed you), where **Play it**
    lives, as `.ar-hdev` does today. The ", kept off" stays where it is.
- **The devices button `.ar-hdev` stays in the full studio**, beside `.ar-hinst` (it is already tagged `devices`, so
  the simple view folds it away). The effects chain is one click away for full-studio users, as today.
- **Sounds**, `.ar-hsounds` (`.btn-txt`, 12 px): on the selected track; on any track whose header has the pointer over
  it or focus within (a fine pointer), by CSS (`:hover`, `:focus-within`), never by state in the draw signature, with
  its space always reserved so the header doesn't shift; and **pending** on a new track until the card has been
  opened on it once (shown unselected, in `--text` cream rather than pencil). A click opens the card for that track
  (2.2). On a phone: the selected track and pending tracks.
- The byline stays where it is (", by Claude" after the name, `arranger.js:908`).
- Audio tracks keep today's words (their effects, "Audio in") and the devices button.
- **The track menu** (`trackMenu`, `arranger.js:1028`) gains **Open {Device}**, **Sounds** and **Devices on {Track}**
  (`ui.show('rack')`).
- Headers under 46 px tall (`tall`, `arranger.js:893`) have no sub row: the instrument and Sounds are in the track
  menu.

**Where R goes, shown in the arranger, both views.**

- **The aimed track's R is lit** (the header's arm lamp). In the full studio it is today's arm button. In the simple
  view, where the arm is put away, only the aimed track shows it, as a lamp that isn't a button (title "R records
  onto Melody. Onto in Sketch picks another.").
- **A ghost lane** at the foot of the arranger while the aim is a new track and Sketch is open, a take is counting in
  or recording, or the card previews a new track (1.3): one row, no clips, the name in pencil italic "A new track,
  Lamp Tines" (or the sound on trial), with a lit R lamp, and a dashed hairline frame (`--line-2`) like a muted clip's.
  It is not a track: nothing selects it.

So the lit R, the ghost lane, the count-in numeral and Onto all say the same thing.

The header's draw signature (`arranger.js:859`) adds the trial (`app.sounds?.trying()?.device`), the pending set and
the aim, so they redraw.

**Drops.** A device dropped onto a track's lane (`dropDevice`, `arranger.js:2167-2211`) is a deliberate act, so it is
**kept at once**, one undo step signed you, with a toast "Melody plays Light Table now (was Lamp Tines)." and Undo. A
melodic instrument dropped on a drum lane (or a kit on a pitched track with notes) makes a new track instead, and the
lane's drop line says so while you drag: "Drop for a new track with Light Table". A drop on empty arranger space is a
new track, as today. Only a click in the browser is a trial.

Budget: a track's header in the simple view goes from 2 controls (M, S) to 3 (the instrument, M, S), plus Sounds on
the selected or pending track. The first-screen budgets in `tools/find-test.js` are measured on a blank song and
don't move.

### 2.4 The browser tries, it never overwrites (`ui/browser.js`, `ui/rack.js`)

`pickDevice` (`browser.js:199-214`) for an instrument:

1. **No track selected, or an audio track:** a new track with it, as today (`rack.addDevice`, `rack.js:111-114`).
   Nothing is replaced, so no trial.
2. **A mismatch:** a melodic instrument on a drum track, or a kit (`cat: 'drums'`) on a pitched track that has notes
   (`rack.isMismatch(def, track, project)`, new). No trial. A menu at the row (`menu`, `arrange-kit.js`, as the touch
   path at `browser.js:208-210` does today): head "Light Table"; **New track with Light Table** ("Drums keeps Gobo
   Kit"), first and focused; **On Drums anyway** ("its hits play as Light Table's notes"), which starts a trial like 3.
3. **Otherwise:** a trial on the selected track (`app.sounds.try(track, { device })`), and the target line becomes the
   trial bar: "Trying Light Table on Keys." **Keep** (`.btn-go`) and **Back** (`.btn-txt`). Clicking another
   instrument tries that one instead. Esc in the browser is Back; selecting another track or closing the left pane is
   Back with the "wasn't kept" toast and Keep it (1.3).
4. The same instrument the track plays: "Keys plays Light Table already." and its row's Open.

A touch screen follows the same rules: the ask-first menu at `browser.js:207-212` folds into 2 and 3 (a tap tries,
which is safe now). Shift-click and Shift+Enter still make a new track directly. Drops are 2.3's.

Effects and rigs keep today's behaviour (an effect takes nothing away; a rig over a chain already asks first on
touch). Kept instruments toast as the card does.

The target line (`renderTarget`, `browser.js:46-56`) says what a click does now: "Click tries it on Keys." with "Keep
it or go back after." under it; for a drum track, "A melodic instrument gets a track of its own." The row title
(`browser.js:77`) changes to "Click: try it on the selected track. Shift-click: a new track".

`rack.addDevice` (`rack.js:102`) is unchanged for its other callers (drag onto the rack, the agent, the rack's own
instrument picker, which is a deliberate swap on the rack); the browser stops calling it for case 3.

### 2.5 The device window (`ui/plugin.js`)

- The bar (`plugin.js` around `:547`, beside **Ask**) gains **Sounds** (`.btn-txt`) on an instrument: the card for
  that track, as a popover under the button. Trying a sound rebuilds the window onto it (`plugin.js:913-918`), so
  what you see is what you hear.
- **Effects** (`.btn-txt`) in the bar: `ui.show('rack')` with the track selected (in the simple view it adds Sound,
  signed you).
- Touching any control while its device is a trial keeps the trial first (`app.sounds.keepIfTrying(track)` from the
  window's `set()` and its preset and A/B paths), with the card's "Kept … to change it" line.
- `open()` works with the `devices` feature put away (it does today; a check holds it).

### 2.6 The agent (`agent/sounds-tool.js`, new; `agent/prompt.js`; `agent/mock.js`)

A new tool, **`suggest_sounds`** (tool 40). It never changes the song by itself: it fills the card with the agent's
sounds and waits for the person.

```
suggest_sounds {
  track?: string,                         // id or exact name; default the selected track, else the newest new track
  sounds: [{ device: string, preset?: string, why: string }],   // 1-4; why ≤ 60 chars, e.g. "breathy, sits behind the hum"
  reason?: string,
  wait_seconds?: number                   // default 0; up to 120
}
-> { offered: true, id, track, sounds: [{ device, name }] }   // or, waited: { picked: { device, name } | null, kept: bool }
```

- "The newest new track" is the track the most recent take in this session made (the recorder keeps it). With none
  selected and none made: `{ error: 'no track to suggest sounds for', hint: 'name one with track' }`.
- Each `device` must be an instrument this studio has (`getDevice`, `kind: 'instrument'`); a `preset` must be one of
  its presets. A bad one is refused before anything shows: `{ error: 'no instrument "x"', hint: 'list_devices kind
  "instrument" lists them' }`.
- An audio track is refused: `{ error: 'Vox is an audio track', hint: 'sounds are for instrument tracks' }`.
- While the person records, the tool refuses by its own check (it is in `NEVER_BLOCKED`, so the catalog's recording
  guard doesn't stop it): `{ error: 'the person is recording', hint: 'wait until they stop (get_recording with
  wait_seconds)' }`.
- The card shows the agent's rows under the track's current sound, each signed "suggested by Claude" with its why;
  they replace the house's rows from the bottom, so it never shows more than now plus four.
- `get_variation_result { id }` returns `{ status: 'pending' }` or `{ picked: { device, preset?, name } | null, kept }`
  (the requests map, `tools.js:255`). Its "ids come from…" hint (`tools.js:599`) adds `suggest_sounds`.
- Add to `NEVER_BLOCKED` (`tools.js:778`): it doesn't touch the song.
- The schema lives in `agent/extra-schemas.js` (`SUGGEST_SOUNDS_SCHEMA`) so `server/mcp.js` lists it with no tab open;
  `agent/sounds-tool.js` registers it (`installTools(app).register`, as `workspace-tool.js:100`). `node
  tools/relay-catalog.js` regenerates `server/relay-catalog.json`.

**Etiquette** (`agent/prompt.js`, rule 2, line 13), added after the propose_variations sentence:

> A track's sound is the person's to pick by ear: when they ask what something should sound like, or for other sounds,
> use suggest_sounds (2-4, each with why) rather than instrument.set. When they name the instrument ("make it a
> choir"), set it, and say what it was.

**The demo agent** (`agent/mock.js`, matched before the existing moves, beside the workspace moves at `:138-190`):

- "what should this sound like", "other sounds", "try some sounds", "different instrument": `suggest_sounds` on the
  selected track with `soundsFor()`'s next four (section 3.1) minus the ones on the card, with each device's blurb as
  its why. Reply: "Four more for Melody: Brass Rail, Mallet Bag, Risers and Patch Bay. Click one to hear it." (the
  count and names from the call).
- "make it a {name}" / "use {name}" where {name} matches an instrument's name: `instrument.set`, reply "Melody plays
  Choir Loft now (was Lamp Tines). Undo takes it back."

`list_devices` and `show_device` are unchanged. `get_selection` gains `trying: { track, device } | null`.

### 2.7 First run (`ui/onboard.js`, `ui/sketch.js`, `ui/arranger.js`)

- **The blank sheet's primary stays Tap a beat** (`arranger.js:2418`, `.btn-go`), as the simple view's spec chose:
  the first minute is built and tested around it, and a beat gives a hum a tempo and a grid. The comment at `:2412`
  that says "one primary (Hum it)" is wrong and is corrected. Hum it from the blank sheet is still the shortest way to
  a pretty sound (4 actions, check 17): Hum it, the Hum button, stop, and the card plays the take; ↓ tries the next.
- The coach's "Your beat is in the song." (`onboard.js:552-555`) offers **Hum over it** first, then Play keys over
  it, then the agent. Its body: "16 hits on Drums, bars 1–2. Next, hum a tune over it, play the keys, or let the agent
  play a part over it."
- **Hum over it** puts Sketch on Hum it and gives the tune room before anything records:
  - The beat is made 8 bars long with the existing Make it 8 bars (`app.song.longer({ bars: 8 })`, `sketch.js:82`),
    one undo step signed you, which grows the loop with it; the line says "The beat runs 8 bars now, so a tune has
    room." A hum then records as one take over up to 8 bars, not four 2-bar takes in a folder (on a pitched track each
    loop pass is a take, `modeFor`, `recorder.js:255`).
  - The take keeps its real length: the clip ends at the bar of its last note.
  - The click goes off while you hum over it (the first minute's `rolling()`, `onboard.js:347`, lent it; it is put
    back after the take), so its ticks don't bleed into the mic.
  - The first time in a session, Sketch's line says "Headphones keep the drums out of your hum." The browser can't
    tell whether headphones are in, so it says it once rather than guessing. (Echo cancellation stays off,
    `input/audioin.js:178`: it smears a hum's pitch.)
  - No `choice` is set: the aim is a new track by rule 6 (Drums doesn't fit a hum), and the coach's next step advances
    on the hum's commit as it does on a keys take.
- `keysOver()` (`onboard.js:396`) keeps making Keys, which is now also the new-track rule's name for keys; the card is
  offered on its first take (2.2).
- **Tap it after a beat is in** (`tapView`, `sketch.js:989`): the take line ends "Hum a tune over it?" with **Hum
  over it** (`.btn-txt`), the same action. Tap it's mic button keeps its label, Beatbox, and its title becomes
  "Beatbox: the mic as drums. To hum a tune, use Hum it."
- **The Beatbox catch** (`input/tap.js`, at the beatbox's stop, `:205-219`, outside a recording only: with R running,
  hits go straight into the take and nothing is caught): the beatbox buffer runs through `input/pitch.js` `frames` and
  `segment`. When it reads as a tune, not a beat (pitch confidence over 0.6 on more than half its voiced frames, and
  fewer than 2 onsets a beat), the take says "That sounded like a tune: 7 notes. Keep it as a melody?" with **Keep the
  beat** (the default: it is focused and Enter presses it, because the person chose Beatbox) and **Make it a melody**
  (`.btn-txt`: the segments through `input/hum.js` `transcribe` with `snapHeard`, onto a new Melody track, then the
  card). The take is in Takes either way.

## 3. The sound picker's candidates

### 3.1 `core/sounds.js` (new, pure, runs in Node)

```js
export const SOUND_SETS = { ... }                          // below; ids only, forever
export function kindOfTake({ kind, src, notes }) -> 'drums' | 'hum' | 'bass' | 'chords' | 'played'
export function soundsFor(take, { has, current, currentPreset } = {}) -> [{ device, preset?, set, family }]   // 4, current first
export function familyOf(row, def) -> string               // the row's family, else the blurb's words before ':'
export function newPartFor(kind, project) -> { name, device }                           // section 1.2
```

`kindOfTake`, in this order: `drums` when `kind === 'drums'` (tapped, beatboxed); **hum** when `src === 'hum'`,
whatever its register (a man's hum around A2 to C3 is still a hum, and pitch tracking's octave slips make the
register a poor test); then from the notes, **bass** when the median pitch is under 48 (C3), **chords** when at least
a third of the notes overlap two others, otherwise **played**.

`soundsFor` takes the set's ids in order, skips any `has(id)` is false for (a library device that hasn't loaded, a
browser without it), fills from the set's fallbacks, puts `current` (the track's instrument and preset) first as "now"
and drops its duplicate (same device and preset). The sets, all real ids (`devices/builtin/*.js`,
`devices/library/*.js`), each row with its family word:

| Set | Sounds, in order (family) | Fallbacks |
|---|---|---|
| hum | `core.keys` Lamp Tines (Electric piano), `core.wavetable` Light Table (Synth), `core.strings` Music Stands (Strings), `claude.choir-loft` Choir Loft (Choir) | `core.mallets` Mallet Bag (Mallets), `core.ensemble` Rosin (Strings), `core.choir` Risers (Choir), `core.pluck` Pinch Roller (Pluck), `core.barisax` Bell Up (Sax), `core.cello` Endpin (Cello), `core.flute` Head Joint (Flute) |
| played | `core.keys` Lamp Tines (Electric piano), `core.upright` Parlour Upright (Upright piano), `core.wavetable` Light Table (Synth), `core.mallets` Mallet Bag (Mallets) | `core.grand` Full Stick (Piano), `core.vibes` Damper Bar (Vibraphone), `core.brass` Brass Rail (Brass), `core.piano` Baby Grand (Piano), `core.pluck` Pinch Roller (Pluck), `core.eguitar` Hollow Body (Electric guitar), `core.trumpet` Spit Valve (Trumpet) |
| chords | `core.keys` Lamp Tines (Electric piano), `core.upright` Parlour Upright (Upright piano), `core.pad` Room Tone (Pad), `core.ensemble` Rosin (Strings) | `core.grand` Full Stick (Piano), `core.strings` Music Stands (Strings), `core.ep` Suitcase (Electric piano), `core.piano` Baby Grand (Piano), `core.organ` Rotor Cabinet (Organ), `core.poly2` Step Ladder (Synth) |
| bass | `core.ebass` Roundwound (Bass guitar), `core.bass` Capstan (Synth bass), `claude.sub-basement` Sub Basement (Sub bass), `core.wavetable` preset "Low Key" (Synth bass) | `core.bassguitar` Flatwound (Bass guitar), `core.poly2` preset "Ladder bass" (Synth bass) |
| drums | `core.drums` preset "Studio kit" (Drum kit), `core.drumkit` Virtuosity Kit (Jazz kit), `core.drumroom` Studio A (Acoustic kit), `core.drums` preset "Boom bap" (Drum kit) | `core.brushkit` Rusty Brushes (Brushes), `core.handkit` Hand Crate (Hand percussion), `core.drums` preset "Trap" (Drum kit), `core.drums` preset "Live room" (Drum kit) |

The hum set is chosen to sing: AJ named only Light Table, so the set is ours to tune and to check with him. A bass
guitar playing a C4-A4 hummed line reads as a mistake, so Flatwound moved to the bass set only, and Music Stands
(slow bows, a hall around it: the one row with a room) took its place. Sampled instruments sit in the rows where they
are the best sound for the set: Parlour Upright second in played and chords, Rosin last in chords (Music Stands moved
to the fallbacks), Roundwound first in bass (Flatwound, the synthesized bass guitar, heads the fallbacks) and Virtuosity
Kit second in drums. The others sit in the fallbacks: Full Stick and Damper Bar at the head of played's, Hollow Body
and Spit Valve at its end; Full Stick at the head of chords'; Rosin for hum (after Mallet Bag, which stands in for
Choir Loft), then Bell Up, Endpin and Head Joint; Rusty Brushes and Hand Crate for drums, so an agent asked for other
kits offers them next. A sampled sound's first try is never silent (`ui/kitload.js`): its samples start coming as soon
as its row is shown on the card, or the pointer or the keys rest on it in the browser or Find; the row, the track's
header and the browser's trial bar say "Loading samples" with how far along they are; a tried take waits for them and
plays from its first note once they're in (the status line says so, with the megabytes); a key pressed meanwhile sounds
once they're in if it is still down (`engine.liveNoteOn`, as a key pressed before the engine was up does). An export or
a render waits for the samples as it always has. A preset makes a row its own sound: the row's name is "Gobo Kit, Trap" and Keep
dispatches `instrument.set { device, preset }`. "More sounds" searches the browser by the set's category (`keys`,
`synth`, `bass`, `drums`).

The agent's rows (2.6) come after the house's on the card and replace them from the bottom, so the card holds the
current sound and at most four others.

### 3.2 `ui/sounds.js` (new, `app.sounds`)

The card's module (no panel of its own). **It alone decides when the card opens**; Sketch only tells it where to go.

```js
app.sounds = {
  setHost(fn)               // Sketch registers: fn({ track, take }) -> host element | null (its stage, its phone sheet)
  offer({ track, from: 'take' | 'header' | 'window' | 'browser' | 'agent', anchor?, take? }) -> { ok }
  try(track, { device, preset? }, { play = true } = {}) -> { ok, error? }   // a preview; replaces the last trial
  tryNew(take, { device, preset? }) -> { ok }                                // an uncommitted take's preview track (1.3)
  keep({ reason? } = {}) -> dispatch result | null                          // section 1.3
  back({ why? } = {}) -> boolean
  keepIfTrying(track) -> boolean                                            // recording, a control touched
  trying() -> { track, device, preset?, was, newTrack? } | null
  pending(track) -> boolean                                                 // the header's pending Sounds (2.3)
  toastLine(made) -> node | null                                            // the recorder's take toast asks for its line
  suggest(track, sounds, { by }) -> { id }                                  // suggest_sounds' path
  close() ; current -> { track, rows, from } | null
  setsFor(track) -> rows                                                    // soundsFor over the track's notes
}
```

It listens to `store` (a removed track, a load, an undo or redo that touches the tried track), `ui.on('agent:tool')`,
`input.recorder.on('state')` (recording starts: keepIfTrying) and `recorder.on('commit')` plus Sketch's keep result
(offer, by the trigger in 2.2). It owns `overdub:sound-trying` and its boot heal. CSS once, via
`css('ew-sounds', ...)`, with the tokens; no `inset Npx 0 0`, no `99px`.

## 4. Every new string

Separators in this table (`·`, `/`) are the spec's, not the screen's.

| Where | String |
|---|---|
| Onto pickers (Sketch and top bar), first option | `A new track` |
| Onto, a track whose take would stack | `{Track}, a new take` |
| Keep select (computer) | `A new track` · `On {Track}` (replaces `New track, Pluck` …) |
| Keep button, phone, to a new track | `Keep on a new track` (title: `Keep on a new track, as a clip, by you: the track Record’s picker shows (pick another there)`) |
| Record line while recording onto a new track | `Recording onto a new track.` (unchanged) |
| Count-in and record line during a trial | `Recording keeps {Name} on {Track}.` |
| Top bar, R onto a new track | `R records onto a new track ({Name})` |
| Top bar, keys made a track | `Keys play a new track, {Track} ({Device}). Undo takes it away.` |
| New track names | `Melody`, `Keys`, `Drums` (then ` 2`, ` 3`) |
| Take line, an earlier take muted | `Take {n} is in on {Track}; Take {m} is muted.` + `.btn-txt` `Put it on its own track` |
| Hum moved into the heard key | `Moved {n} notes into {Key}, the key you hummed in.` + `Undo` |
| Card head | `What should this sound like?` |
| Card aside, hum / played / chords / bass / drums | `Your hum, on {n} sounds.` · `What you played, on {n} sounds.` · `Your chords, on {n} sounds.` · `Your bass line, on {n} sounds.` · `Your beat, on {n} kits.` then ` ↓ tries the next.` (phone: ` Tap one to hear it.`) |
| Card, from a header | `{Track}, on {n} sounds. Click one to hear it.` |
| Row | `{Name}` over or beside `{Family}: {blurb}`; phone `{Family}` only |
| Row states | `now` · `hearing` · `suggested by ` + byline |
| Row with a preset | `{Device}, {Preset}` |
| Card lamp, hum | `In tune` (title `On: your notes moved into the key you hummed in. Off: as sung`) |
| Card buttons | `Keep {Name}` · `Back to {Was}` · `Done` (nothing on trial) · `Open {Name}` · `More sounds` · `Ask {Agent} for others` |
| Card close | `×` (aria-label `Close, back to {Was}` during a trial, else `Close the sounds`) |
| Status, hearing | `Hearing your hum on {Name}, bars {a}–{b}. Space stops.` (hum; `your beat`, `what you played`, `{Track}` from a header) |
| Status, back | `Back to {Was}.` |
| Status, an agent tool ended a trial | `Back to {Was} while {Agent} works. {Name} wasn't kept.` |
| Status, agent rows arrived | `{Agent} suggested {n} sounds for {Track}.` |
| Toast, kept | `{Track} plays {Name} now (was {Was}).` + action `Undo` |
| Toast, kept by recording | `Kept {Name} on {Track}: you recorded with it.` + `Undo` |
| Toast, kept by a control | `Kept {Name} on {Track}, to change it.` + `Undo` |
| Toast, trial ended by something else | `Back to {Was} on {Track}; {Name} wasn't kept.` + action `Keep it` |
| Take toast, full studio or Sketch not showing | second line `What should it sound like? ` + `.btn-txt` `Sounds` |
| Header, instrument button | text `{Device}` + the open glyph; title `Open {Device} big: its sound, presets and a keyboard`; aria-label `Open {Device}, the instrument on {Track}` (held: title `Kept off: its code hasn’t run on this computer. Open its devices to play it`) |
| Header, during a trial | `{Device}, trying` |
| Header, Sounds | `Sounds` (title `Hear {Track} on other instruments`; aria-label `Sounds for {Track}`) |
| Header, the lit R in the simple view | title `R records onto {Track}. Onto in Sketch picks another.` |
| Ghost lane | `A new track, {Device}` |
| Lane drop line, a mismatch | `Drop for a new track with {Name}` |
| Track menu | `Open {Device}` · `Sounds` · `Devices on {Track}` |
| Browser target line | `Click tries it on {Track}.` + small `Keep it or go back after.`; drum track: small `A melodic instrument gets a track of its own.`; phone `Tap tries it on {Track}.` |
| Browser trial bar | `Trying {Name} on {Track}.` + `Keep` + `Back` |
| Browser same instrument | `{Track} plays {Name} already.` |
| Browser row title | `{Name}. {blurb} Click: try it on the selected track. Shift-click: a new track` |
| Browser mismatch menu | head `{Name}` · `New track with {Name}` / sub `{Track} keeps {Was}` · `On {Track} anyway` / sub `its hits play as {Name}’s notes` (a kit on a pitched track: `its notes play as {Name}’s drums`) |
| Window bar | `Sounds` (title `Hear this track on other instruments`) · `Effects` (title `The effects on {Track}, in the Devices tab`) |
| Coach, beat kept | buttons `Hum over it` · `Play keys over it` · (agent's, unchanged); body `{n} hits on Drums, bars {a}–{b}. Next, hum a tune over it, play the keys, or let the agent play a part over it.` |
| Hum over it | `The beat runs 8 bars now, so a tune has room.`; once a session `Headphones keep the drums out of your hum.` |
| Tap it after a take | `Hum a tune over it?` + `.btn-txt` `Hum over it` |
| Tap it's mic button title | `Beatbox: the mic as drums. To hum a tune, use Hum it.` |
| Beatbox catch | `That sounded like a tune: {n} notes. Keep it as a melody?` · `Keep the beat` (default) · `Make it a melody` |
| Agent ask (card button) | `Other sounds for {Track}?` |
| Tool description | `Offer the person 1–4 instruments for one track, on the sound card: their take plays through each when they pick it, and nothing changes until they Keep one (signed by them; History notes you suggested it). Each sound is { device, preset?, why ≤ 60 chars }. Use it when they ask what a track should sound like or for other sounds; when they name the instrument, set it with instrument.set instead. Returns { offered, id }; get_variation_result with the id gives their pick. Refused while they record.` |
| Tool errors | `no instrument "{x}"` / `list_devices kind "instrument" lists them` · `no preset "{p}" on {Name}` / `get_device lists its presets` · `{Track} is an audio track` / `sounds are for instrument tracks` · `the person is recording` / `wait until they stop (get_recording with wait_seconds)` · `no track to suggest sounds for` / `name one with track` |
| Demo agent | `{N} more for {Track}: {names}. Click one to hear it.` (phone: `Tap`) · `{Track} plays {Name} now (was {Was}). Undo takes it back.` |
| Activity line (tools.js map) | `suggested sounds for {Track}` |

No whimsy on buttons; device names carry it. Counts in copy are counted from the rows on screen.

## 5. Phone layout (390x844)

- **After a take in Sketch:** the sheet scrolls the card into view under the take row (`bringKeep`,
  `sketch.js:247`). Head and aside on two lines (12 px floor), four rows of 48 px (name 14 px over its family, the
  state at the right), the In tune lamp for a hum, the status line, then Open, More sounds and Ask for others on one
  line.
- **The pinned row** while a sound is being tried: **Keep** (`.btn-go`, flex 1; the name is in the status line), **Back**
  and the record lamp. R keeps the trial first on a phone as on a computer (1.3), so you can record over a trial in
  both. Otherwise Hum, Record, Onto as today.
- **From a header's Sounds:** a bottom sheet (More's phone-sheet style), at most 70% of the height, the same rows;
  Keep and Back pinned at its foot. During a trial only Keep, Back, Esc and × close it (no tap-above, no drag-down);
  with nothing on trial, a drag on its handle or a tap above it closes it.
- **The instrument button** opens the device window as today's full-height sheet (44 px keys, a Play key).
- **The browser** is a full-height side sheet on a phone (today); its trial bar is pinned at its top under the search.
- Sizes: rows 48 px, `.btn` 40 px (the kit's phone size). Budgets: `tools/phone-test.js`'s simple first screen is
  unchanged (no tracks yet). A new check holds the card's rows at 44 px or more and the sheet inside the viewport.

## 6. Tests

### 6.1 New: `tools/pick-sound-test.js` (QUIET via `tools/pw.js` `open()`)

(`tools/instruments-test.js` already exists: it holds the acoustic instruments' signatures. The new suite takes a name
of its own.)

Node, no browser:

1. `kindOfTake`: a hummed C4-A4 line is `hum`; **a hummed A2-C3 line is `hum`**; a played line under C3 is `bass`;
   three overlapping notes on each beat are `chords`; a tapped beat is `drums`.
2. `soundsFor`: the hum set is exactly `core.keys, core.wavetable, core.strings, claude.choir-loft`; with `has`
   refusing `claude.choir-loft` the fourth is `core.mallets`; `current: 'core.wavetable'` puts it first and keeps four;
   a current `core.drums` on "Studio kit" isn't listed twice; every row has a family; every id and preset in
   `SOUND_SETS` exists in the registry (`devices/builtin`, `devices/library`).
3. `newPartFor('hum', p)` is Melody (Lamp Tines); with a Melody already, Melody 2.
4. The recorder's aim, pure over a stub project, `view: 'simple'`:
   - a hum with Drums selected goes to a new track; the second hum goes onto Melody;
   - after `setAim('hum', 'new')` and a commit, the next hum's aim is that Melody, **not a Melody 2**;
   - selecting Bass (with clips) after the last hum aims the next hum at Bass;
   - `setAim('hum', drumsId)` puts a hum on Drums;
   - pads after a reload (no `last`) with one Drums track and nothing selected aim at Drums;
   - a second hum over the same bars stacks as Take 2 and its commit carries the "Put it on its own track" offer; one
     over other bars is a new clip on Melody with nothing muted.
   And `view: 'full'`: an armed Keys still takes a hum (today's rule); `setAim('hum', 'new')` overrides it and disarms
   every track; arming a track by hand afterwards clears the choice; **with Drums selected and nothing armed, a hum
   aims at a new track, not at Bass**.

Browser, `?view=simple`, clean storage, the fake hum wav from `tools/instruments-repro.js` (its writer factored into
a helper both use, which also writes a fake beatbox wav: noise bursts on the beat):

5. AJ's path: Tap a beat, R, taps, Space: 16 hits on Drums. Hum it (Onto says "A new track"), R, Space: the hum is on
   a **new track, Melody**, not Drums; Melody is selected; **its notes are all in the key heard** (the moved-notes
   line says how many). The card is up and playing, with Lamp Tines (now), Light Table, Music Stands, Choir Loft, and
   the "now" row has focus.
6. ↓ to Light Table: `store.get()` shows Melody on `core.wavetable`, `store.history` has no new entry, the header says
   "Light Table, trying", the transport plays from bar 1. ↓ to Music Stands: still no History entry. Back: Lamp
   Tines, nothing in History. Light Table again, Keep: one History entry by you, with no `audition` flag, labelled
   "Melody: Light Table (was Lamp Tines)", counted in the History tab; one ⌘Z puts Lamp Tines back exactly. Holding ↓
   for 400 ms starts at most two trials.
7. Trials end as 1.3 says:
   - `tools.run('get_project', {}, { by: 'claude' })` mid-trial sees Lamp Tines and the status line says why;
     `tools.run('get_recording', …)` mid-trial leaves the trial on.
   - R mid-trial: the count-in line says "Recording keeps Light Table on Melody."; after the take, ⌘Z takes the take
     and a second ⌘Z the sound.
   - Selecting Drums mid-trial: the "wasn't kept" toast, whose Keep it keeps it.
   - ⌘Z of an earlier instrument change on Melody mid-trial: the undo holds after the trial is released.
   - A click on the arranger mid-trial leaves the card open and the trial on.
8. Leftover heal: try Light Table, read `overdub:sound-trying`, reload: Melody plays Lamp Tines, History empty of it.
   The same for a Sketch take's previewed new track: reload, and no track is left.
9. The Sketch card on an uncommitted Hum it take: the ghost lane reads "A new track, Light Table" while it's on trial;
   the take's Keep makes Melody on `core.wavetable` with the clip, in one undo step, and there's one `.btn-go` in
   Sketch. The In tune lamp is lit; off, the take's notes are as sung.
10. The header: `.ar-hinst` on Melody reads "Lamp Tines" with the open glyph present with no hover; a click on the
    name opens the window (`app.plugin.current.name === 'Lamp Tines'`) with `devices` still put away
    (`ui.workspace.has('devices') === false`), not over Melody's lane, keyboard visible; a click on the swatch opens
    nothing. Sounds shows on the selected track and, pending, on a new unselected track until opened once; the header
    doesn't change width on hover. A held instrument's `.ar-hinst` opens the Devices tab. In the full studio `.ar-hdev`
    is still there.
11. The browser: with Drums selected, a click on Light Table changes nothing (`core.drums` still on Drums) and opens
    the menu; New track with Light Table adds a track named "Light Table" with Drums untouched, in one undo step.
    With Keys selected, a click is a trial with Keep and Back in the target line; Back leaves no History entry. A
    drop of Light Table onto Keys' lane is kept at once (one History entry); onto Drums' lane it makes a new track.
12. Musical typing after Tap a beat makes Keys (Lamp Tines) on the first key, selected; the top bar says "Keys play a
    new track, Keys (Lamp Tines)…"; the note sounds on Keys (`engine.liveNoteOn`'s track), never on Drums.
13. `suggest_sounds { sounds: [{ device: 'core.brass', why: 'bright, cuts through' }] }` by claude adds a row signed
    "suggested by Claude" (cool ink, `.by-agent`); Keep dispatches by you with `reason` naming Claude; a bad id comes
    back `no instrument "x"`; while recording, `the person is recording`; `suggest_sounds` is in `tools.list()` and in
    `server/mcp.js`'s list with no tab open.
14. The demo agent: "what should this sound like" puts four suggested rows on the card and replies in one line.
15. The coach: after the beat, "Hum over it" is first on the card; it makes the beat 8 bars, turns the click off and
    puts Sketch on Hum it with Onto "A new track". **A 4-bar fake hum, recorded with the beat playing, lands as one
    4-bar clip on Melody** (no take folder). Tap it's mic button carries the Beatbox title.
16. The Beatbox catch: the fake hum through Beatbox offers "Make it a melody", which lands a Melody track; Enter on the
    offer keeps the beat. **The fake beatbox wav through Beatbox raises no offer.**
17. **Time to a pretty sound**, counted clicks and keys (playing and humming not counted): from the blank song, Hum it,
    the Hum button, stop, then ↓ hears the take on a second instrument: **at most 4**. From the coach's beat card,
    Hum over it, R, Space, ↓: **at most 4**. (Held here beside the flow it measures; `find-test.js` keeps the first
    screen's budgets.)
18. Liner notes: no `inset Npx 0 0` and no `99px` in `ew-sounds`' CSS; bylines present; at most one `.btn-go` per
    region; the `.sel` row's text is in `--bg` ink.
19. Phone (390x844, `hasTouch`): the card's rows are 44 px or taller, the sheet is inside the viewport, Keep and Back
    and the record lamp are pinned, a tap above the sheet during a trial leaves it open, nothing overlaps the take row.
20. Full studio (`?view=full`): after a take onto a new track the card doesn't open by itself; the toast has the Sounds
    line and the track's header shows Sounds pending.

### 6.2 Updated, by the package whose change breaks them

Each package fixes the existing checks its own change breaks, in the test files it owns (section 8), so
`node tools/run-all.js simple sketch record input mix panes phone onboard share agent` passes after each merge.

- **WP1:** `tools/record-test.js`, `tools/input-test.js`, `tools/transport-rec-test.js` (the aim, the full studio's
  dropped first-pitched fallback, "Press R again" gone, the keys' track).
- **WP2:** `tools/sketch-rec-test.js` ("New track, Keys" → "A new track"; full-studio targeting checks stay),
  `tools/onboard-test.js` (Hum over it first), `tools/find-test.js` (Onto visible in Sketch in the simple view; the
  registry's Recording options purpose word for word, section 7).
- **WP3:** `tools/share-test.js` (held instruments: `.ar-hinst` opens the Devices tab in the simple view; `.ar-hdev`
  is unchanged in the full studio), `tools/panes-test.js` if its header counts move.
- **WP4:** `tools/mix-test.js:428-429` (the instrument row's title and click now try; add Keep, then the same
  assertions), `tools/phone-test.js:917` (the touch menu is the mismatch menu only; a tap on a melodic track tries).
  WP2's and WP3's phone changes have their checks in `pick-sound-test.js` 19, so `phone-test.js` has one owner.
- **WP5:** `tools/agent-test.js` (the list has `suggest_sounds`, 40 tools).

### 6.3 Counts (CLAUDE.md: every public number is counted)

- **Tools 39 → 40:** `README.md:69`, `docs/BRAND.md:76`, `site/index.html:488` and `site/press/index.html:101,114`
  (`data-tool-count`), `docs/AGENTS.md`'s table plus a `suggest_sounds` section, and the launch drafts.
- **Suites +1** (`pick-sound-test.js`) and **checks**: after a full `node tools/run-all.js`, update every stated suite
  and check count to `tools/.out/run-all.json`; `tools/pages-test.js` holds them.
- `node tools/docs-build.js` after GUIDE, AGENTS and ARCHITECTURE change.
- Devices are unchanged (no new device).

## 7. Docs

- `docs/ARCHITECTURE.md`: the aim (`recorder.aim`, `setAim`, `'aim'`) in the recorder's contract; `app.sounds` under
  "The UI"; the header's instrument button, Sounds, the lit R and the ghost lane in "Lanes in the arranger"; the
  browser's trial and drops kept; `overdub:sound-trying` with the storage keys.
- `docs/GUIDE.md`: "Pick a sound": a new idea gets its own track, the card, the header's instrument and Sounds, Onto.
- `docs/AGENTS.md`: `suggest_sounds`, the etiquette line, and the workspace table's Recording row (`record-options`:
  track arm, count-in, layering, timing, the top bar's Onto; Sketch's Onto is always shown).
- The registry (`ui/workspace.js:41`): Recording options' purpose becomes `Count-in, layering takes and timing.`;
  its `where` stays "Sketch, and each track’s header" (the header's R, `arranger.js:868`, and the top bar's Onto are
  still tagged `record-options`); "record onto" leaves its aliases, so asking where to pick the track finds Sketch's
  Onto, not a put-away feature. The Sound and Instruments and effects features (`:31-32`) are unchanged.

## 8. Work packages

Five packages, each owning only its files. They talk through the contracts above (`recorder.aim`/`setAim`/`'aim'`,
`app.sounds`, `core/sounds.js`, `recorder.on('commit')`) with `app.sounds?.` optional chaining, so each works before
the others land.

| WP | Owns (only these) | Builds |
|---|---|---|
| **WP1 Where a take goes** | `app/src/core/sounds.js` (new), `app/src/input/recorder.js`, `app/src/input/capture.js`, `app/src/input/tap.js`, `app/src/input/index.js`, `app/src/input/hum.js`, `tools/record-test.js`, `tools/input-test.js`, `tools/transport-rec-test.js` | 1.1 the aim and `targetFor` in both views (one-shot new, the selection rule, the only kit, the full studio's arm-clears-choice and no first-pitched fallback), the keys' track made when keys start, the new track selected on commit, stack only on overlap and the "own track" op; 1.2 `newPartFor` everywhere (five defaults); 1.4 `snapHeard` and `keepTiming` from the aim; 3.1 `kindOfTake` (hum first), `soundsFor`, `familyOf`, `SOUND_SETS`; the take toast's extra line from `app.sounds?.toastLine?.(made)` and the "Take 1 is muted" line; "Recording keeps…" from `app.sounds?.trying()`; the Beatbox catch's detection (`frames`, `segment`, emits `tap` `'tune'` with the segments) |
| **WP2 Sketch, the top bar and the first minute** | `app/src/ui/sketch.js`, `app/src/ui/transport.js`, `app/src/ui/onboard.js`, `app/src/ui/workspace.js` (the one registry line, 7), `tools/sketch-rec-test.js`, `tools/onboard-test.js`, `tools/find-test.js` | 2.1 Onto out of `record-options` and "A new track" in both pickers and the keep select, `NEW_TRACK_DEVICES` gone, the top bar's copy and keys line; `app.sounds.setHost` for the stage and the phone sheet, the take's Keep carrying the trial, the pinned Keep/Back/record lamp, the In tune lamp wired to Snap; 2.7 Hum over it (8 bars, click off, the headphones line), the coach's card, Tap it's line and Beatbox title, the Beatbox catch's UI (Keep the beat default) |
| **WP3 The sound card, the arranger and the window** | `app/src/ui/sounds.js` (new), `app/src/ui/arranger.js`, `app/src/ui/plugin.js`, `app/src/ui/dom.js` (`icon('open')` only), `app/src/main.js`, `tools/share-test.js`, `tools/panes-test.js` | 1.3 trials, Keep (no `audition`, one engine rebuild), Back, every ending and its line, the heal (both kinds); 2.2 the card (when it opens in each view, the popover, the phone sheet, click-outside, Done, family words, dedup), its keys and debounce; 2.3 `.ar-hinst` with the glyph, held → Devices tab, `.ar-hdev` kept in the full studio, Sounds and pending, the lit R and the ghost lane, drops kept at once with the mismatch rule, the blank-sheet comment, the track menu; 2.5 the window's Sounds, Effects, placement and keep-on-touch; MODULES gets `./ui/sounds.js` after `./ui/plugin.js` (so `app.input.recorder` exists) and `./agent/sounds-tool.js` before `./agent/panel.js` (`tryImport` skips it with a warning until WP5 lands) |
| **WP4 The browser** | `app/src/ui/browser.js`, `app/src/ui/rack.js`, `tools/mix-test.js`, `tools/phone-test.js` | 2.4: trial on click, the mismatch menu, the target line and trial bar, touch folded in; `rack.isMismatch(def, track, project)` (WP3's drop uses it) and `addDevice` kept as is |
| **WP5 Agent, docs and the new suite** | `app/src/agent/sounds-tool.js` (new), `app/src/agent/extra-schemas.js`, `app/src/agent/tools.js`, `app/src/agent/prompt.js`, `app/src/agent/mock.js`, `server/relay-catalog.json` (generated), `docs/*`, `README.md`, `site/index.html`, `site/press/index.html`, `site/docs/` (generated), `tools/pick-sound-test.js` (new), `tools/instruments-repro.js` and its shared wav helper, `tools/agent-test.js` | 2.6 the tool, `get_selection.trying`, NEVER_BLOCKED and its own recording check, the get_variation_result hint, the etiquette, the demo agent's moves; 6.1 the suite (written against this spec in parallel, run last on the merged tree); 6.3 and 7 |

**Order.** WP1 first (the others read its contracts), then WP2, WP3 and WP4 in any order (they share no files), then
WP5's tool against WP3's `app.sounds.suggest`, and WP5's suite and counts last. After each merge run
`node tools/run-all.js simple sketch record input transport-rec mix panes phone onboard share agent`; before committing
the integration, the full suite, then the counts.

**Not in this branch.** Sounds for audio tracks (effects and rigs on a voice or guitar), a sound picker for effects,
measuring each candidate's level (`render_and_measure`) before it is heard (the card plays every candidate at the
device's own level, as the browser does today), a hum setting the song's tempo, and a candidate with a touch of room
on every row (most of "pretty" is reverb and most rows are dry; Music Stands is the one with a hall): a follow-up.

## 9. Revisions after the critiques

Three critiques read the first draft (`2a96080`): a first-timer who hums and wants it pretty fast (A), a producer
recording many ideas in a session (B), and a check of the spec against the code (C). What changed, and what didn't.

**Taken:**

- Put in tune (A1): 1.4. Hum over it over 8 bars, one take (A2): 2.7, check 15. The card on the uncommitted Sketch
  take, its Keep carrying the sound in one undo step (A3): 1.3, 2.2. The card plays at once, "now" focused (A4).
  Family words, kept on the phone (A5). Flatwound out of the hum set, Music Stands in, and "the four AJ named"
  corrected (A6). Click outside doesn't end a trial; × is Back (A7, phone too). The open glyph at rest, and Sounds
  pending on a new track (A8, A9). The stacked take shown before R and after, with Put it on its own track (A10, B7).
  Two lines of buttons, Done outside a trial (A11, B11). Beatbox title and a beatbox-wav check (A12). Click off
  for Hum over it (A13). The time-to-pretty budget (A15).
- 'new' is one-shot (B1, C3). The keys are heard where they're recorded and the new track is selected (B2, C1). The
  lit R and a ghost lane in both views (B3). A newer selection wins over `last` (B4). Arming by hand clears the
  choice; "A new track" disarms (B5). No first-pitched fallback in the full studio (B6). Drops kept at once; every
  other ending says so with Keep it; agent endings say why (B8). R says before it keeps (B9). Only the name opens the
  window; the window spares the lane; `.ar-hdev` kept in the full studio (B10). The card doesn't open by itself in the
  full studio (B11). Names that stay true (B12). Hum before bass (B13, C10). Keep the beat is the default (B14).
  Arrow debounce, reserved hover space, one phone behaviour for R, the extra checks (B15).
- No `audition` on Keep (C2). Pads aim at the only kit (C4). The trigger is the first take onto an empty track
  (C5). Only tools that read or change the song end a trial (C6). Undo during a trial (C7). Held instruments go to
  the Devices tab (C8). The `.sel` row's ink and one `.btn-go` per region (C9). Ownership: the toast line through
  `app.sounds.toastLine` (WP1 calls, WP3 fills), drops in WP3, `ui/sounds.js` after `plugin.js`, `input/index.js`,
  `input/hum.js` and `transport.js` owned, one owner of the card's opening (`setHost`), the aim behind recorder
  methods, each package fixing the tests it breaks (C-B1 to C-B7). The citations (C-C). "Track" everywhere, the
  registry's `where` and aliases, the dedup rule, 40 px phone buttons, no `/` on the card, CSS hover, the tool's own
  recording check and "newest new track", the hint, the Keep click check, and the Grid (C-D).

**Not taken, or taken differently:**

- *The blank sheet's primary becomes Hum it* (A14): no. The simple view's spec makes Tap a beat the primary and the first minute is built around it. The wrong comment is fixed, and Hum it
  from the blank sheet meets the same 4-action budget.
- *Detect headphones and warn only without them* (A13): browsers can't tell reliably (device labels need permission
  and don't say "headphones"), so the line is said once a session on the first Hum over it.
- *A muted-take offer "Hear both?"* (B7): Put it on its own track does what a harmony needs (both play, each with its
  own sound); unmuting a take inside its folder is already in Takes.
- *A setting to open the card by itself in the full studio* (B11): not added. Sounds pending on the header is one
  click, and a setting is one more thing to find.
- *"Back to the electric piano"* (A5): the card always shows the name beside its family, so "Back to Lamp Tines"
  reads with the word right there.
- *Make "A new track" for keys a track straight away when picked* (C1): taken more widely. The keys' track is made
  when the keys start (typing on, a touch key, the first MIDI note) whether or not it was picked, so musical typing is
  never heard on the wrong track.
- *`main.js` fails at boot until WP5 lands* (C-B3): it doesn't; `tryImport` skips a missing module with a warning. The
  load order fix is taken.
- *`docs/BRAND.md:101` has the old Recording options wording* (C-B4): it doesn't (101 is the device-naming paragraph,
  and a grep finds no "record onto" in BRAND or GUIDE). The private SPEC does; flagged.
- *Hold the time-to-pretty budget in `find-test.js`* (A15): it lives in `pick-sound-test.js` beside the flow it
  measures, so `find-test.js` stays the first screen's.
- *The new suite as `tools/instruments-test.js`*: that file exists (the acoustic instruments' signatures); the suite
  is `tools/pick-sound-test.js`.
- *The Grid rule* (C-D): no change. In the simple view a keys take still snaps to 16ths, as today; Grid stays in
  `record-options`.

## 10. After the fresh-eyes runs (2026-10-05)

Three runs on `b2c6da8`: the simple view at 1440x900 and 390x844 with the fake mic, a phone walk, and the full studio
side by side with `ux-simple`. What changed, most important first:

- **The card floats** on a computer (2.2): Sketch hosts it only on the phone's split sheet (`sketch.js` `hostFn`).
  Its first line of buttons is the decision and **Open {name}** beside it (it was last, under the fold on a phone).
- **A browser trial leaves the song's loop alone.** `playTake` held a loop preview round the track's bars that only
  the card's closing let go, so a browser trial wrote it into the song and the autosave. It is never taken for a
  trial from the browser (tagged `from: 'browser'` now, so the pane closing ends it, as 1.3 says), and a Keep or Back
  lets go of the card's.
- **A double-click in the browser keeps** what its first click tried. The target line keeps its height between the
  line and the trial bar, and every row shows its blurb on one line (a row that grew on hover moved the list under
  the pointer, so the second click tried Choir).
- **The device window** says what the instrument is under its name ("Wavetable synth: two morphing tables…") and
  has a **Computer keys** lamp at its keyboard's end (musical typing, the same as `` ` ``). It still goes beside the
  lane only when it fits there whole: Light Table's editor at 1440x900 doesn't, and letting it scroll in the room
  beside the lane broke its own fit-the-screen checks (`wavetable-ui-test`, `multiband-test`), so a deep synth still
  covers the lane. AJ's call.
- **Stale offers go.** "Make it 8 bars" leaves a toast (and the phone's tour strip) once the song is 8 bars; "What
  should it sound like? Sounds" leaves once the card has been opened on that track; neither is on the first minute's
  beat, whose next step is the tour's Hum over it. The take toast's two sentences have their space.
- **The tour says what's in.** After the hum: "Your hum is in the song." with both counts, not the beat's head again.
  On any screen 640 px or narrower, touch or not, the tour is the one-line strip, whose button keeps its whole label.
- **A take recorded with R is in the song, and Sketch says so:** "Kept ✓" in place of a Keep that did nothing, "in
  the song: Melody" on its Takes entry (the recorder points the pass's capture entry at the track it made), and "Your
  hum is in the song: 15 notes on Melody". Before Keep, a hum is "Your hum: 15 notes, C major." The key heard in it
  becomes the song's (its own undo step, after the take), as Keep from Sketch already did, so the top bar agrees.
- **Families everywhere:** "now" gets its family from the sets ("Lamp Tines, Electric piano"), and a set's row with
  no preset isn't listed beside "now" on the same device (no "Light Table" twice).
- **Smaller:** the browser's line on a kit track ("Click tries a kit on Drums. Another instrument asks first…"), its
  new-track toast ("Light Table is on a new track. Press R and play to put notes on it."), the header's name ending
  before Sounds, the phone header showing the instrument (Sounds there while it's pending), no "Space" on a phone,
  the devices button keeping focus, and Hum it's explainer pointing to R over a song with parts.

Not changed: a browser click with the transport stopped still plays the track from its first bar (1.3), and the
behaviour changes the full-studio run listed (musical typing with nothing selected makes Keys, a click is a trial,
⌘Z after a trial undoes the edit before it) stand as specified.
