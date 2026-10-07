# Overdub architecture (v0.1 contracts)

Overdub is a web DAW where a musician and their agents play over each other. This document is the contract every
module is built against. If code and this document disagree, fix one of them in the same change.

**Principles**

1. **The song is a document.** One JSON project is the source of truth. The GUI, the in-app agent and outside agents
   (over MCP) all change it the same way: by dispatching typed **ops** through the **store**. Every op is attributed
   (who: a human or an agent), undoable and logged.
2. **Agents can't hear, so the studio measures.** Anything that makes sound can be rendered offline through the exact
   graph the human hears and measured (LUFS, true peak, spectrum, onsets, key...). Levels are measured, never guessed.
3. **Devices are code you can ask for.** Instruments and effects are small definitions. Built-ins may be Web Audio
   graphs; anything a player or agent writes is a **kernel**: pure DSP run inside an AudioWorklet (no DOM, no clock,
   seeded randomness), so it is deterministic and hot-reloadable. That scope is a rule for determinism, not a security
   boundary (DEVICES.md, "Under the hood"): a kernel from a share link or a file is code from whoever wrote it, so it
   runs only once the person has allowed it ("Who runs a song's code", below).
   Faces (the UI of a device) are drawn from its metadata, so nobody writes UI to make a pedal.
4. **Meet the musician where they are.** Hum it, tap it, play it, say it, draw it. The studio captures first and
   structures later, and the agent is the translator between musical language and parameters.
5. **Zero dependencies, no build.** Native ES modules, served by `server/serve.js`. Chrome is the reference browser
   and the canonical render is the Node one (`tools/render.js`); WebKit (Safari), Firefox and a phone-sized Chromium
   are covered by `tools/compat-test.js`.

## Layout and ownership

```
overdub/
  server/serve.js        static server (/ = site, /app/ = studio) + route hooks. PORT 3279.
  server/bridge.js       agent bridge routes (/bridge/*): MCP <-> the open studio tab, localhost only  [agent layer]
  server/mcp.js          MCP stdio server: Claude Code / Desktop / any MCP client drive the studio    [agent layer]
  server/local-claude.js Claude Code behind the Agent panel (/local/*): `claude -p` per turn, localhost [agent layer]
  server/relay.js        the hosted relay for claude.ai (REMOTE-MCP.md; live)                         [agent layer]
                         relay-catalog.json: the tools it lists, generated (tools/relay-catalog.js)
  site/                  landing page, press/, docs/ (built by tools/docs-build.js), llms.txt         [brand]
                         community/ (the community shelf's gallery; deployed, unlinked, reads nothing off localhost)
  app/community/         the community shelf's bundled snapshot: gitignored, built by overdub-devices'
                         tools/index.js --out (docs/COMMUNITY-SHELF.md)                              [shelf]
  app/index.html         the studio page; app/library.html the device shelf; app/gallery.html          [core]
  app/style/tokens.css   brand tokens (CSS custom properties; names below are fixed)                   [brand owns values]
  app/style/fonts.css    the faces, from the site (fonts/<family>/: each woff2 and its licence)         [brand]
  app/style/app.css      the shell, shared widgets and the phone layout                                [core / ui]
  app/vendor/clawd/      verbatim Claw'd-o-Matic sources (pedals, amps, presets) and worklets/ (each processor they
                         build, as a file); tools/vendor-clawd.js writes them, never edited here      [guitar]
  app/src/main.js        boot: devices, store, engine, shell, then MODULES; window.overdub             [core]
  app/src/analytics.js   anonymous counts on the live site only                                        [core]
  app/src/core/          project.js (schema, ids, defaults), ops.js (every op), store.js (dispatch, history,
                         events), music.js (theory, notes text format, drum grids), arrangement.js (section and
                         time edits, take folders), automation.js (lanes: values, travel, text form, shapes),
                         transforms.js (note transforms and infill), arrange.js (Build a band),
                         grooves.js + grooves/ (the groove library: a style file per family, feel and humanising,
                         tap-to-find, the song creator), share.js (share links, forks), dawproject.js (DAWproject
                         export), demo.js + demos/ (the twelve demo songs)                             [core]
                         jam.js (chords read from notes, jam tracks, tips, licks), fretboard.js (tunings, positions,
                         fingering in one hand position, tab text in and out), riff.js (the house riff writer),
                         playalong.js (judging what you play against a part)                           [jam]
                         sounds.js (newPartFor: the track a new idea makes; the rest is ux-instruments')   [core]
  app/src/engine/        engine.js (context, transport, scheduler, tracks, mixer), strip.js (channel strips),
                         schedule.js (what plays when), click.js (the click's sound), render.js (offline, in the browser), node/render.js (the
                         canonical Node renderer), node/check.js + check-render.js (the device check in Node, the
                         kernel in a child process), fallback.js, assets.js (audio in IndexedDB), clock.js   [engine]
  app/src/audio/         measure.js (the ears: LUFS, true peak, spectrum...), testsignals.js            [dsp]
  app/src/devices/       registry.js (fixed), trust.js (which song devices run here), graph.js + kit.js (graph devices:
                         bypass, glide, the PFX kit), worklets/ (the kit's END and envelope follower modules),
                         guitar/ (ported pedals, amps, cabs, rigs)                                     [guitar]
                         builtin/ (Overdub's own kernels: synths, drums, pluck, bass, eq, comp, verb...;
                         wavetables.js is Light Table's tables, which its kernel embeds and its face imports;
                         akwf.js the AKWF single cycles they carry),
                         library/ (the house shelf, with reports.js), showcase.js (the demo's agent devices) [dsp]
                         community.js (the one reader of a community shelf index: allow-list, types, URL policy) [shelf]
  app/src/kernel/        host.js (main thread), worklet.js (the processor, KernelCore), processor.js (the
                         worklet's module), dsp.js (the kernels' stdlib), check.js (device check), guide.js (the agent's device guide), examples.js,
                         odk.js + data.js (kernel data: the .odk container; fetched once, checked, kept in IndexedDB)  [dsp]
  app/kits/              kernel data files, <sha256>.odk (gitignored: tools/fetch-kits.js builds them; deploy uploads them)
  app/src/input/         pitch.js (YIN, pYIN), hum.js, tap.js, midi.js, qwerty.js, audioin.js (interface input) + cap-worklet.js (its capture processor),
                         onsets.js (each note's onset and pitch in a guitar's raw input, for the tab lane),
                         timing.js (forgiving time: the gentle grid, a take's steady lean, the pulse in free playing),
                         rounds.js (Start a song: the loop, folding rounds, the 1, the readings, the timing words),
                         recorder.js (R: takes into the song), autorec.js (knob moves into lanes), latency.js
                         (calibration), capture.js (never lose an idea), importers.js (MIDI and audio files in),
                         index.js (app.input)                                                           [input]
  app/src/ui/            shell.js + dom.js (fixed frame), workspace.js + workspace-view.js (Find anything), 
                         transport.js, arranger.js, lanes.js (automation lanes),
                         arrange-kit.js, pianoroll.js, drumgrid.js, grooves.js (the Grooves tab)        [ui-arrange]
                         mixer.js, rack.js, faces.js*, browser.js, inspector.js                         [ui-mix] (*faces: guitar)
                         touch.js (a finger on a knob, a slider or a fader: a drag scrolls, a hold moves it)  [ui-mix]
                         plugin.js (device windows: a device opened big), plugin-kit.js (their widgets),
                         editors/ (generic.js, and the editors the studio's own devices name: eq8.js, shaper.js,
                         drumroom.js: Studio A's drawn kit)                                             [ui-mix]
                         sketch.js (capture UI), spiral.js (pitch spiral)                               [input]
                         export.js (the Song menu, files out), provenance.js, share.js, onboard.js, reference.js,
                         start.js (Start a song: the blank song's door and its stage, app.start),
                         devices-io.js                                                                  [core / ui]
                         community.js (From the community in the Browser: previews, Try and its prompt; off
                         unless on localhost, COMMUNITY_LIVE)                                           [shelf]
                         jam.js (the Jam room beside Arrange: chords, the neck, the rig, practice, ideas),
                         tabs.js (the room's tab lane: riffs, practice, play-along), tabstaff.js (drawing tab;
                         the Notes panel's Tab view)                                                    [jam]
  app/src/agent/         tools.js (the tool catalog), extra-schemas.js, transforms-tool.js, arrange-tool.js,
                         arrangement-tool.js, grooves-tool.js (find_grooves, use_groove, drum_track), tabs-tool.js
                         (tab_for, write_tab, suggest_riff), claude.js
                         (Messages API via the local server's key), prompt.js, mock.js (the demo agent),
                         lexicon.js + lexicon-personal.js, panel.js (chat UI), history.js, presence.js, diff.js,
                         keep.js (a song from a link: what waits for Keep), bridge.js (page side of MCP),
                         remote.js (page side of the relay), cloud.js, cloud-kind.js, cloud-panel.js (Claude
                         on Overdub credits; off unless app/site-config.json names it),
                         community-tool.js (find_community_device)                                     [agent layer]
  tools/                 pw.js (browser harness, fixed), <area>-test.js checks, run-all.js, render.js, bench/
  integrations/          the Claude Code plugin and skill, configs for other MCP clients, check.js
  deploy/                setup.sh (one time), deploy.sh (ships the committed tree; --next REF ships it to the preview,
                         next.overdubstudio.com, set up once by next/setup.sh), relay/, analytics/; README.md
  docs/                  ARCHITECTURE.md (this), DEVICES.md, AGENTS.md, GUIDE.md, BENCH.md, REMOTE-MCP.md, BRAND.md,
                         VISION.md, UX-RESEARCH.md, SECURITY.md, research/
```

Only touch files your area owns. If you need something from another area that doesn't exist yet, code against the
contract here, and put a small clearly-marked fallback in your own file (`// FALLBACK until engine lands`) rather
than writing into theirs. Never commit; the orchestrator commits.

Conventions: 2-space indent, ES modules with relative imports, no globals except `window.overdub`, no
`Math.random` in anything that makes sound (seed it), every audible change ramps (no clicks), CSS injected once per
module via `css(id, text)` from `ui/dom.js`, using the tokens below.

## The project document

All musical time is in **beats** (quarter notes, floats). One tempo and one meter for v0.

```js
Project = {
  format: 'overdub/0', id: 'p_k3j9x2', title: 'Untitled', tempo: 120, meter: [4, 4],
  key: { root: 'C', scale: 'minor' } | null,           // scale names: music.js SCALES
  loop: { on: false, start: 0, end: 16 },               // beats
  tracks: [Track],
  sections: [{ id: 's_x', name: 'Verse', start: 0, length: 16, color? }],
  devices: { [id]: DeviceSource },                       // devices written in this project (kernels), travel with it
  assets: { [id]: { kind: 'audio', name, sr, channels, duration } },   // the samples live in IndexedDB (engine/assets.js)
  master: { gain: 0, inserts: [Insert], auto?: { gain?: Lane } },   // gain in dB
  reference?: { asset, name, sr, channels, duration, profile, by },   // the reference track: beside the song, never in it
  meta: { created, modified, authors: { [authorId]: { kind: 'human' | 'agent' | 'house', name } },
          forkedFrom?: { title, authors, at, id, from } },             // set by "Make it yours" (core/share.js)
}
Track = {
  id: 't_x', name, color, kind: 'instrument' | 'audio',
  instrument: { device: 'core.poly', params: {}, auto?: { [paramKey]: Lane } } | null,   // instrument tracks
  inserts: [Insert],                                          // effects, in order
  clips: [Clip],
  gain: 0, pan: 0, mute: false, solo: false, arm: false,     // dB, -1..1
  input?: { device: 'default', channel: 1 },                  // audio tracks: what record/monitor listens to
  by: 'you',                                                  // author of the last structural edit
  auto?: { gain?: Lane, pan?: Lane },                         // the mixer's automation
}
Insert = { id: 'fx_x', device: 'pedal.clamwah', on: true, params: {}, by, auto?: { [paramKey]: Lane } }
Lane   = { points: [Point], off?: true, by }    // off: held (the static value plays); by: who last wrote it
Point  = { t /* song beat */, v /* the param's own units: dB, -1..1, Hz */, c? /* the segment leaving it: absent
           straight, -1..1 bent (> 0 starts slow), 'step' holds then jumps */ }
Clip   = { id: 'c_x', kind: 'notes', start, length, name?, color?, mute?, notes: [Note], by,
           tuning?: 'drop-d' /* fretboard.js TUNINGS id */, capo?: 1..12 }   // what its tab is written in (absent: standard, none)
       | { id: 'c_x', kind: 'audio', start, length, asset: 'a_x', offset: 0 /* s into asset */, gain: 0, name?, mute?, by }
         // mute: true keeps the clip and plays it nowhere (live, renders, the Node render); absent = playing
         // take?: 'tk_x' the take group a recording stacked (clips on one track sharing it; the unmuted one plays)
Note   = { id: 'n7', p: 60 /* MIDI */, t: 0 /* beats from clip start */, d: 0.5 /* beats */, v: 0.8 /* 0..1 */, by,
           s?: 0..11 /* string, 0 the lowest */, f?: 0..36 /* fret from the nut */ }   // a place on the neck: both or neither
DeviceSource = { id, name, kind, cat, blurb, params: [ParamSpec], look, kernel: 'source', by, version, created, modified }
```

Ids: prefix + 6 base36 chars (`t_`, `c_`, `fx_`, `s_`, `a_`, `p_`); note ids are `n` + a counter per clip,
never reused while the store has history (undo finds notes by id, so a freed id stays freed). Ids seed instruments'
randomness, so the demos are built with `stableIds(p, seed)` (`core/project.js`) and sound the same for everyone.

`by` is an author id: `'you'` (the human at this browser), `'claude'` (the in-app agent), `'claude.ai'` (the remote
connector), `'mcp:<name>'` (a local MCP client), `'overdub'` (the house: demo content, and what the studio's own
tools write when asked, like Band) or `'guest:<name>-<browser>'` (the sender of a share link, `kind: 'human'`, named
in `meta.authors`). The UI draws a person's work warm and an agent's cool, and the house's neutral.

A note's place (`s`, `f`) says where a guitarist plays it; the pitch is still `p`, and a place that doesn't play `p`
in the clip's tuning (the note was moved, the tuning changed) is ignored and fingered again wherever tab is drawn
(`fretboard.placeOk`, `placeNotes`). `normNote` keeps a place only when both are whole numbers in range; `normClip`
keeps a tuning id and a capo of 1-12. Every op that copies or cuts notes carries them (split, repeat, duplicate,
reshape), and `notes.set` sets or clears them (`s: null`), its inverse putting back what was there.

A song saved under the product's first name (format `earworm/0`, house parts by the old house id) still opens:
`cleanProject` brings it up to this format.

### Automation lanes (`core/automation.js`)

Lanes live on what they move (`track.auto.gain`/`pan`, `instrument.auto[key]`, `insert.auto[key]`,
`master.auto.gain`), so removing an insert or a track takes its lanes and undo brings them back, and changing a
track's instrument to another device drops the old one's. In ops and tools a lane is named `{ track, insert?, param }`:
`insert` an insert id or `'instrument'`, absent for the mixer (`'gain'` or `'pan'`); `track: 'master'` takes `'gain'`
or an insert on the master. Canonical: points sorted by `t` (rounded to 1/1024 beat), at most two at one beat (a
jump: arriving, then leaving), values clamped to the param's range and snapped to its step (switches, and
whole-number params of up to 24 steps, always step; a knob whose step is only its resolution ramps). Before
the first point a lane holds the first value, after the last the last; a lane with no points doesn't exist. The
static value (`params[key]`, `track.gain`) is what plays while a lane is held. The normalisers (`normTrack`,
`normInsert`, `cleanProject`) keep lanes, cleaned. Not automatable: an insert's `on`, mute, solo, tempo, meter.

Values between points follow the control's travel, not its raw units: `curve: 'log'` params through the knob's log
travel, the mixer's gain through the fader's console law (run on to +24 dB), pan and the rest linearly; `c` bends a
segment (`x^(1+3c)` for c > 0, `1−(1−x)^(1−3c)` for c < 0). One set of pure functions decides every value, and the
engine, both renderers, the knobs and the agent use it: `valueAt(lane, beat, spec)` (at a jump, the value leaving),
`valueBefore`, `segmentsIn(lane, from, to, spec)` → `[{ t0, t1, a, b, c }]` (`a`, `b` in travel; the end holds run
to ±Infinity) with `posAt(seg, beat)`, `toPos`/`fromPos`/`travel(spec)`, `bend(x, c)`, `specFor(p, addr, getDevice)`
(`MIXER.gain`/`MIXER.pan` or the device's param), `lanesOf(p)` (every lane with its address and `key`), `laneAt(p,
addr)`, `shapePoints(shape, { from, to, v0, v1, vEnd })` (ramp, swell, dip, hold, flat, pulse), `thin(points, tol,
spec)` (Ramer–Douglas–Peucker in travel), `dbToPos`/`posToDb` (the mixer's fader law, for the UI).

Text form, for agents and the console: `beat:value[~curve]`, space separated; `curve` −1..1 or `step`; two tokens at
one beat make a jump. `"32:400 48:8000~0.5 64:8000"` is a bent sweep from beat 32 to 48, held to 64.
`parsePoints(text)` / `formatPoints(points)`.

### The notes text format (for agents and the console)

`pitch@start:dur[*vel]`, space separated. Pitch is a name (`C4` = 60, `F#3`, `Bb2`) or a MIDI number. Start and dur
in beats; vel 0..1 (default 0.8). `C2@0:0.5 C2@0.5:0.5 G1@1:1*0.9`. Chords: write the notes at the same start.
Fractions work (`E4@1/3:1/3`). `music.parseNotes(text)` / `music.formatNotes(notes)`.

Drum grids: `{ steps: 16, step: 0.25, rows: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } }`,
`X` accent (1.0), `x` hit (0.8), `o` ghost (0.45), `.` rest. Rows map to General MIDI (kick 36, snare 38, clap 39,
rim 37, hat 42, pedal 44, open 46, tom1 50, tom2 47, tom3 45, crash 49, ride 51, cowbell 56, shaker 70), and to the
articulations Studio A plays beyond GM (`rimshot` 40, `half` 24, `flam` 31, `roll` 33, `crashchoke` 27...: `DRUM_MAP`,
docs/research/STUDIO-A.md). Names are only ever added: a song's notes keep their meaning, and `formatGrid` keeps
printing the old names. `music.parseGrid(grid)` → notes.

## Ops and the store

```js
import { createStore } from './core/store.js';
const store = createStore(project?, { getDevice });
store.get()                       // the project (live object: read it, never mutate it outside an op)
store.dispatch(ops, { by = 'you', label, reason, coalesce, audition, silent, kept, as, join })   // op or [ops]: atomic, one undo step
   → { ok: true, txn, created: { [refOrKind]: newId } } | { ok: false, error, index } | { ok: false, held: true, error, hold }
   // join: a txn id; when it is still the newest (nothing done after it, nothing undone) and by the same author, the
   // change goes into it (one undo step for both: a take and the track made for it at its count-in)
store.guard = (ops, { by, label, reason, as }) → null | { error, hold }   // set by the agent layer (agent/keep.js)
store.preview(ops, { by }) → { release() }   // hold-to-hear: applied silently, never in the history
store.undo({ by?, id?, redo? }?) → { ok, txn, forward } / store.redo() / store.canUndo(by?) / store.canRedo()
store.revertAuthor(by, { since }) → { ok, reverted, skipped }
store.on('change', fn) → off      // fn({ txn, ops, by, kind: 'do' | 'undo' | 'redo' | 'load' | 'preview', created?, reverted? })
store.history                     // [{ id, at, by, label, reason?, ops, inverse, coalesce? }], oldest first, at most 500
store.load(project, { by, keepHistory })   // replace the whole document (kind 'load')
store.track(id), store.clip(trackId, clipId), store.insert(trackId, insertId), store.findClip(clipId)   // finders (or null)
store.authors / store.author(id) / store.addAuthor(id, { kind, name }) / store.isAgent(id)
```

- **A transaction is all or nothing.** An op that fails leaves the song exactly as it was; `index` names the failing
  op. Ops check everything before they change anything, and their errors are written for whoever sent the op (often
  an agent): what was wrong, and what would be right.
- **Refs inside one transaction.** `track.add`, `clip.add`, `insert.add` and `section.add` take `ref: 'name'`; later
  ops in the same `dispatch` name the new thing as `'$name'` (`{ type: 'notes.add', track: '$bass', clip: '$v1', ... }`)
  and `created` maps refs to the new ids. A track can also be named by its exact name instead of its id, and
  `'master'` is accepted where a track id takes inserts. A device written in the song (`device.define`) can be placed
  by a later op in the same transaction.
- **`reason`** is kept on the transaction (agents say why); **`coalesce`** merges a gesture's dispatches into one undo
  step (knob drags dispatch with `coalesce: 'insert:<id>:<key>'`); **`audition`** marks a variation the human kept.
- **Three grains of undo.** `store.undo()` (the latest transaction), `store.undo({ by })` (that author's latest, which
  fails, changing nothing, if later edits depend on it), `store.revertAuthor(by, { since })` (everything that author
  did, keeping everyone else's edits; it reports what it skipped, and a `since` that isn't in the history reverts
  nothing and says so). All three redo: redo is last in, first out and any new edit clears it, so an author's latest
  undone with later edits kept goes back as it was, and a revert is one redo step that puts back everything it took
  out, oldest first. Undo, redo and reverts put back what was there without re-checking devices (a song may hold
  ones this browser hasn't loaded), and an inverse that would delete or overwrite notes someone else has since edited
  refuses instead: removing a note, putting back a clip's old notes (an undone split, cut, loop or insert; the inverse
  carries a print of the notes as its op left them, `_expect`) or removing a clip or track someone has written into
  since. An undo of a note that a split or an insert has since moved into another clip refuses too, rather than
  reporting success with the note still there.
- **Preview.** `store.preview(ops)` applies ops silently and `release()` takes them back out exactly, returning
  `{ ok, skipped }` (if a later edit made the exact inverse impossible, it puts back what it can). Variation cards
  audition through it, and an agent tool call that reads or changes the song lets go of a held card first.
- **The guard.** `store.guard(ops, { by, label, reason, as })`, when set, is asked before a dispatch applies anything;
  a change it holds isn't applied and nothing is emitted (the caller gets `{ ok: false, held: true, error, hold }`).
  `kept: true` skips it: the person said yes to exactly these ops (a card's Keep). `as: [op]` is the same change as one
  op, for the guard to read (an arrangement move dispatched as its plan's primitives). The agent layer sets it for
  songs from a link ("The agent layer", below). `store.undo({ id, redo: false })` takes one transaction out without
  leaving it to redo, and every undo returns `forward`, the ops that put it back exactly.
- **Authors.** `store.author(id)` → `{ kind: 'human' | 'agent' | 'house', name }`: the session's authors, then names the
  song carries in `meta.authors` (a guest from a share link), then `mcp:<name>` as an agent. An id's form fixes its
  kind whatever a song says (`you` and `guest:*` are people; `claude`, `claude.ai` and `mcp:*` agents; `overdub` the
  house: `authorClass` in `core/project.js`), and a name stands only when nobody else goes by it: the studio's own
  (You, Claude, Overdub, claude.ai) and the agents that joined the session, matched loosely (case, width, spacing).
  Otherwise the id's own name stands in ("Guest", the MCP client's name) (`namedAuthor`). `store.isAgent(by)` is
  true for agents. Draw authorship as a byline: `byline(by, { app })` in `ui/dom.js` (the name in warm or cool ink;
  the house returns null), never a stripe, a tint or a fill (`design/LINER-NOTES-KIT.md`).

The op catalog (`core/ops.js`; each returns its inverse; `OP_TYPES` lists them). Track/clip/insert fields given as
`track`, `clip`, `insert` are ids (or refs, or a track's name).

| op | args |
|---|---|
| `project.set` | `patch: { title?, tempo?, meter?, key?, loop? }` |
| `track.add` | `track: Partial<Track>`, `index?`, `ref?` (ids/defaults filled in; returns the id in `created`) |
| `track.remove` / `track.move` | `track`, (`index`) |
| `track.set` | `track`, `patch: { name?, color?, gain?, pan?, mute?, solo?, arm?, input? }` (gain −96..24 dB, pan −1..1) |
| `instrument.set` | `track`, `device?`, `params?` (params merge; `null` resets one to its default) |
| `insert.add` | `track`, `insert: { device, params?, on? }`, `index?`, `ref?` |
| `insert.remove` / `insert.move` | `track`, `insert`, (`index`) |
| `insert.set` | `track`, `insert`, `patch: { on?, params? }` (params merge) |
| `clip.add` | `track`, `clip: Partial<Clip>` (notes may be the text format, or `grid`), `ref?` |
| `clip.remove` | `track`, `clip` |
| `clip.set` | `track`, `clip`, `patch: { start?, length?, name?, color?, offset?, gain?, mute?, tuning?, capo? }` (`mute: true` silences the clip and keeps it; `false` stores no flag; `tuning` and `capo`, a notes clip's, for its tab: `null` or capo 0 removes them) |
| `clip.move` | `track`, `clip`, `toTrack?`, `start?` |
| `notes.add` | `track`, `clip`, `notes: [Note] \| "text"` (or `grid`) |
| `notes.remove` | `track`, `clip`, `ids: [noteId]` |
| `notes.set` | `track`, `clip`, `notes: [{ id, p?, t?, d?, v?, s?, f? }]` (`s` and `f` together, the note's place on the neck; `s: null` clears it) |
| `notes.replace` | `track`, `clip`, `notes: [Note] \| "text"` (or `grid`) |
| `notes.restore` | internal: the inverse of `notes.remove` (puts notes back with their ids); not in `OP_TYPES` |
| `section.add` | `section: { name, start, length, color? }`, `ref?` |
| `section.set` / `section.remove` | `section` (object, id or name), `patch: { name?, start?, length?, color? }` |
| `section.duplicate` | `section`, `to?` (beats; default right after it), `push?` (make room there first), `ref?` |
| `time.insert` / `time.remove` | `at`, `length` (beats, across the whole song: clips, sections, the loop) |
| `clip.repeat` | `track`, `clip`, `times` (2..64, in all), `mode?: 'copies' \| 'loop'`, `ref?` |
| `clip.split` | `track`, `clip`, `at` (a song beat inside it), `ref?` (the right half) |
| `master.set` | `patch: { gain }` (dB, −96..24) |
| `auto.write` | `track`, `insert?`, `param`, `points: [Point] \| "text"`, `from?`, `to?`: replaces the lane's points in [from, to] (default: the span of the points; none with a range clears it), making the lane if there is none; signs it `by` the writer; values checked against the param's range |
| `auto.clear` | `track`, `insert?`, `param`, `from?`, `to?`: removes the points in the range; with neither, the lane |
| `auto.set` | `track`, `insert?`, `param`, `patch: { off }`: `true` holds the lane (its static value plays), `false` gives it back (no flag stored) |
| `asset.add` / `asset.remove` | `asset: { id, kind: 'audio', name, sr, channels, duration }` / `id` (the samples live in engine.assets) |
| `reference.set` | `reference: { asset, name, sr, channels, duration, profile } \| null` (`project.reference`) |
| `device.define` | `device: DeviceSource` (registers it; a new version if the id exists) |
| `device.remove` | `id` |

**Arrangement ops** (`core/arrangement.js`). `planSectionDuplicate`, `planTimeInsert`, `planTimeRemove`,
`planClipRepeat` and `planClipSplit` are pure functions over the project that return the ordinary ops for the change
(`clip.set`/`clip.add`/`clip.remove`, `notes.replace` in its exact restore form, `section.*`, `project.set` for the
loop), plus a one-line summary. `ops.js` registers `section.duplicate`, `time.insert`, `time.remove`, `clip.repeat` and
`clip.split` as ops that plan from the song as it is and apply those, so their inverse is the primitives' own. Notes
keep their sounding part across a cut (a pitched note is cut in two, the halves add up; a drum hit stays whole on its
side), their ids within a clip and their authors; a copy's clip is signed by whoever asked, a split's right half by
the clip's maker. A duplicated section brings every clip that plays in it, cut to its bars (a full-length beat that
starts before it included). A notes clip across a deleted stretch closes up around it; an audio one becomes two, the
second `offset` further into its take.

**Automation ops.** `auto.write` and `auto.clear` are one range-replace: the inverse writes the old points back over
the same range and carries a print of what the op left there (`_expect`), so an undo or a revert by one author
refuses when someone has written into that range of that lane since (writes elsewhere on the lane don't block it, and
keep their author's byline); an inverse that removes a lane its op made is an `auto.clear` of that range. Undo and
redo put back a lane's points, author and held flag exactly. The arrangement planners carry lanes (planned
`auto.write`s that keep the lane's author): `time.insert` moves points right and holds the value at `at` across the
gap; `time.remove` closes the lane up, the value from before meeting the value from after (a jump if they differ);
`section.duplicate` writes each lane's stretch over the section (with its edge values) at the copy, after `push`;
`clip.repeat` writes the lanes on that track under the clip into each copy (and a loop's extension). `clip.split` and
a raw `clip.move` leave lanes alone; `followClips(p, moves, ctx)` is the planner the arranger calls to move or copy
the lanes under clips it moves (across tracks, to the same params there). A bent segment cut by one of these keeps
its curve number on each side (close, not exact); straight, step and held stretches are exact.

**Names and colours.** A name (a track's, clip's, section's, marker's, device's or preset's) is plain text up to 100
characters (`NAME_MAX`), a title up to 200: control characters and bidi overrides and isolates are dropped where a song
comes in, `track.add`, `clip.add`, `section.add` and `device.define` cut a longer name, and the `.set` ops refuse one.
A colour is a palette token (`var(--c-N)`) or hex, since the page draws it as CSS, where a `url(...)` would be a
request to whoever wrote the song: anything else is dropped where a song comes in (the default applies) and refused
by the `.set` ops.

**Growth limits** (`LIMITS` in `core/project.js`: 20,000 notes in a clip, 50,000 in a song, 4,096 clips, beat 8,192;
10,000 automation points in a lane and 50,000 in a song, points from beat 0 to 8,192; lanes don't extend the song).
A loop or copy multiplies what it's given, so a few bytes of ops could ask for millions of notes. The arrangement
planners check before they build anything and say what fits; `clip.add`, `notes.add`, `notes.replace` and `track.add`
hold a clip to its notes; and the store checks the song's size after every op of a transaction (`songSize`,
`sizeError`), refusing one that grows it past a limit. A song already past one (an old file) opens and can be edited,
just not grown, and undo, redo and reverts aren't held to them. A share link past a limit is refused as it comes in
(`decodeShare`): it is someone else's song, and a few hundred KB of one can hold more than the tab keeps up with.

**A device's `credit`** (optional, newer songs only): a device the community shelf put in a song carries
`credit: { author, alias, agent, license, sha256, source }`, from the shelf's index: the person who asked for it (a
handle), the agent that wrote it, its licence, its kernel's SHA-256 and where its source lives. It's display data, read
by nobody that decides anything; an older reader skips it. The device itself is `by: 'you'`: the person brought it in.

**`device.define` guards.** A song's devices add to the studio and never take over one it ships: ids in the built-in
namespaces (`core.`, `pedal.`, `amp.`, `cab.`, `overdub.`) or on the house shelf are refused (undo and redo still put
back what was there), and a kernel can be up to 256 KB. A song's device is data, a kernel and its params: `build` and
`worklets` (code only the studio's own devices carry; `worklets` names module files the graph path would load into the
audio thread, past the kernel's rules and the device check) are dropped by a song file, a link and the registry.

## Devices

Registry: `app/src/devices/registry.js` (`defineDevice`, `getDevice`, `listDevices({ kind, cat, q })`,
`instantiate(c, id, opts)`, `onDevices`, `removeDevice`, `shadowedDevice`, and the held set: `holdDevices`,
`heldDevice(id)`, `heldDevices()`). A def:

```js
defineDevice({
  id: 'core.poly', name: 'Patch Bay', kind: 'instrument' | 'effect', cat: 'synth', blurb: '≤60 chars: what it does for you',
  nod?: 'what it tips its hat to, in words (no trademarks)', by: 'overdub',
  params: [{ key: 'cutoff', label: 'CUTOFF', min: 40, max: 18000, def: 2400, curve: 'log', unit: 'Hz',
             role: 'tone', desc: 'brighter as it opens' }, { key: 'wave', label: 'WAVE', opts: ['SAW', 'SQR'], def: 0 }],
  look: { color: '#c43b8e', ink: '#fff4fa', shape: 'box', finish: 'sparkle', knob: 'chrome', label: 'plate', led: '#7dffb8' },
  where?: 'pre' | 'post', trails?: false, trim?: 0, latency?: 0, tail?: 0, drone?: false,
  build(c, kit) { ... } | kernel: `...source...`,
});
```

A drum kit may name its notes: `notes: { 36: 'Kick', 40: 'Rimshot', ..., other: 'Side stick' }` (what each MIDI note
plays on it; `other`, any note it doesn't name). The drum grid, the piano roll, the inspector and `get_device` read it
through `core/music.js` `kitNotes(def)` (as text only: notes 0-127, strings of at most 40 characters) and name a row
`drumName(p, notes)`, General MIDI's name when the kit has no map.

A graph device that needs its own AudioWorkletProcessor lists `worklets: { name: url }`, the URL of a module file on
the studio's origin (`new URL('./x.js', import.meta.url).href`), never source: the pages' policy refuses scripts from
`data:` and `blob:` URLs. `kit.loadWorklet` loads each once per context behind END (`devices/worklets/end.js`, which
stops a disposed node's processor); the vendored pedals' are `WORKLETS` in `devices/guitar/clawd.gen.js`.

Ids are forever; display names are not. The built-ins are named after studio objects (core.poly Patch Bay, core.bass
Capstan, core.keys Lamp Tines, core.pluck Pinch Roller, core.drums Gobo Kit, core.pad Room Tone; core.eq Top Shelf,
core.comp Squeeze Box, core.verb Stairwell, core.delay Echo Reel, core.chorus Double Track, core.filter Keyhole,
core.drive Hot Print, core.crush Chewed Tape, core.width Gatefold, core.limiter Red Line, core.eq8 Slide Rule, core.shaper Scribble Strip,
core.multiband Gaffer Tape; core.drumroom Studio A, a room), and a rename only touches `name`. Names must not collide
with the vendored pedals' (`tools/guitar-test.js` checks).
A def the studio ships may carry `describe(params)` (one line of text for `get_project`, in place of the params' JSON:
core/project.js `summarize`), and a param `hidden` (not on the face or in the generic window), `auto: false` (no lane)
and `quantum` (a window control's smallest step); DEVICES.md, "Params that aren't knobs".

**Data a kernel and the page share.** A kernel sees only `dsp`, so a device whose face draws the same data its
sound plays keeps that data in one self-contained function and embeds the function's source in its kernel. Light
Table (`core.wavetable`) does this with its wavetables (`devices/builtin/wavetables.js`, `lightTables(bank)`): the
kernel evaluates `(${lightTables})(bank)` and builds the tables lazily in the worklet, and the page imports the same
function to draw them, so the editor shows exactly what plays. The bank (`akwf.js`, 108 recorded single cycles, CC0)
is a literal in the kernel's source, packed so the kernel stays under its 256 KB. Its design note, with the param map its editor works from, is
`docs/research/LIGHT-TABLE.md`.

Param `role` (for agents and semantic controls): `tone level drive mix time feedback rate depth size decay attack
release pitch shape width gate sens` (or omit). `unit`: `Hz dB ms s % st note x`.

**Where devices come from.** `main.js` imports three libraries at boot: `devices/builtin/` (the 32 built-ins, one of
them sampled: Virtuosity Kit, whose samples come as kernel data),
`devices/guitar/` (the Guitar Studio's 101 pedals and 27 amps, with 16 cabinets and 5 mics inside the amps, and its
156 rigs as device chains) and `devices/library/` (the house shelf: ten kernels Claude wrote, `claude.*`, `source:
'library'`, each with its `request`; also loaded by the Node renderer). `devices/showcase.js` holds the three devices
the demo song carries as project devices. Project devices (`project.devices`) follow the song: `main.js`
`syncProjectDevices` registers each one the song has whose kernel this browser trusts (`source: 'project'`), holds the
rest (below), and calls `registry.removeDevice(id)` for every one it no longer has or now holds (undo, another song
loaded, `revert_my_changes`), which puts back the def it shadowed, if any (`shadowedDevice(id)`).

**Device files** (`ui/devices-io.js`, `app.devicesIO`): `.overdub-device.json` (`overdub-device/0`) out and in; an
import runs `checkDevice` first and becomes one `device.define` by you (its kernel trusted here: the person chose the
file). `/app/?device=<id>` opens a new song with that device on a track. `/app/library.html` is the public shelf.
Details in DEVICES.md. The public, user-submitted library waits for WASM kernels and sandboxed faces (SECURITY.md).

### Who runs a song's code (`devices/trust.js`)

A song's devices are kernels: code from whoever made the song, which runs in the AudioWorklet on this computer when the
song plays. A song device runs here only when its kernel is **trusted** in this browser; one that isn't is **held**
until the person allows it.

- **The trusted set** is per browser and by code: the SHA-256 of a kernel's source (its UTF-8 bytes; `trust.js`
  `sha256` is plain synchronous JS, so every check is synchronous), stored in localStorage `overdub:trusted-kernels`
  as `{ "sha256": ["<64 hex>", ...], "since": <ms> }`, oldest first, at most 2,000 (the oldest go first); `since` is
  when the set began. The same code is trusted
  under any id, name or song; a changed byte is new code. (The registry's own `hash` is 32-bit FNV: fine for a cache
  key, too weak to trust code by, since a kernel matching Night Shift's could be made to order.)
- **Trusted without asking:** the studio's own kernels (the built-ins and the house shelf, as registered at boot) and
  every device in a song the studio ships (each `DEMOS` entry's devices: Night Shift's three), worked out when first
  needed and never stored; and kernels this browser takes in: `define_device` (the person's own agents, in the page
  or over MCP: the tool trusts the kernel once its check passes), a device file the person imports (`ui/devices-io.js`),
  and any `device.define` op a `do` dispatch applies in this page (`main.js`; not an undo, a redo or a load, never
  a kernel that is held, and never one allowed for this page load only, below). Once, on the first run of this
  version (the key isn't there), `main.js` trusts every kernel in the songs this browser kept (`overdub:project`,
  `overdub:previous`, `overdub:before-fork`, `overdub:recent`): they were already running. For the same reason a link this browser made before `since` opens as yours with its
  devices trusted (`trustOwnLink`; the link's moment is sealed into its mark, so it can't be moved); an own link made
  since gets no pass, or sharing a song to yourself would let held code play.
- **Held** (`trust.heldIn(song, isTrusted)` → `registry.holdDevices`): a song device whose kernel isn't trusted is
  never registered, so nothing can instantiate, check or render it. The engine plays a held instrument as silence
  (`fallback.js` `silentInstrument`, not the fallback synth) and a held effect as a pass-through, live and in every
  offline render (`engine/strip.js` `makeInstance`; `wantKey` is `held:<id>:<hash>`, so the stand-in is swapped for
  the real device when it's allowed, with no reload). Held comes first: a held device that shares an id with a shelf
  device plays as held. `main.js` `syncProjectDevices` recomputes the held set on every load, device op, revert and
  trust change (another tab's too: the `storage` event); listeners get `{ type: 'held' }`.
- **Where it's checked.** `syncProjectDevices` (registration), `strip.js` (live and offline renders: the mix and
  stems, `render_and_measure`, `adjust`, `compare_to_reference`, `arrange_around`), `ui/provenance.js` (never checks a
  held device for the report), `agent/tools.js` (`define_device` refuses a held kernel under any id, and a community
  shelf device's kernel, as it is or with its names, comments or spacing changed: so its credit isn't passed off as the
  agent's; not a boundary, since a program changed any other way isn't matched). Exports and the
  report say what they left out.
- **The ask** (`ui/share.js`): a song that opens with held devices asks, under the share banner for a link, or in the
  same strip in the banner's place for any other song (a file opened from disk or dropped, the saved song, Recent
  songs): who wrote them (a guest from a link, one that came through someone else's link "Sam wrote, via Jo's link",
  an agent "for" the guest who sent it; a file's own claims aren't repeated), that they're off now and what that
  means (an instrument silent, an effect passing the sound through), that each is a small program that runs on this
  computer, and, before the click, what **Play them** does: "Play them if you trust Sam: that code then runs from now
  on, in this browser, in any song." While it's open **Play them** is the strip's one primary (Make it yours steps
  back until it's answered). **Play them** is `app.trust.play()` (trusts their hashes and syncs: they play, no
  reload); **Keep them off** leaves them held, and the song asks again the next time it opens; Make it yours keeps
  what was decided. The rack draws a held device as a dashed note with **Play it**, the track header and the mixer
  say *kept off*, the arranger draws a held instrument's clips silent (outline, hollow notes) with *kept off* where
  the byline goes, the browser lists it under "Written in this song". On a phone the strip is the question alone while
  it's open and one line once it's answered, so the lanes stay in view.
- **Agents** see held devices (`get_project` `held`, `get_device` `held: true`, `list_devices`, `render_and_measure`
  and `provenance_report` say what they left out) and can't run or allow them: no tool reaches `app.trust.play`, and
  etiquette rule 8 says only the person lets held code play.
- **For this page load only** (`trust.allowForNow`): the community shelf's Try, with *Run it in any song from now on*
  unticked. The hash is trusted until the page reloads and is never stored, so the song's device is held again after a
  reload. `trust.forNow(hash)` says whether a hash is trusted that way; `main.js` skips such a kernel when it trusts a
  dispatched `device.define`, so it isn't stored behind the person's back. `trust.forget(hashes)` takes hashes back
  (stored and this page load's; a shipped kernel can't be forgotten): the shelf's deny list (the studio's own copy of
  the index only) and a Try whose dispatch failed after its allow.
- `app.trust = { key, held(), hash(source), trusts(source), has(hash), size(), since(), play(ids?), allow(sources), allowForNow(sources), forNow(source), forget(sources), ownLink(res) }`. The Node renderer
  (`tools/render.js`) has no trust set: it renders what it's given (CLAUDE.md: render only what you trust with it).

### The community shelf (`ui/community.js`, `devices/community.js`)

Instruments and effects people asked their agents for, from the community repo (`overdub-devices`), in the Browser
under **From the community**. Nothing is sold, priced or rated. The spec is [COMMUNITY-SHELF.md](COMMUNITY-SHELF.md);
SECURITY.md says what runs when. Off on the live site (`COMMUNITY_LIVE`); Try is held (`TRY_ON`) until the worklet's
prototypes are frozen, and a developer on localhost turns it on with localStorage `overdub:community-try` = `1`.

- `devices/community.js` is the one reader of an index (`overdub-community-index/1`): the studio, the agent tool and the
  site gallery all read through it. `ASKED_MAX` is how long a requester line can be and still be drawn.
- `app.community = { on(), ready(), state(), section(opts), reach(id?, by), offer(entry, opts), targetFor(entry, track),
  tryEntry(entry, opts), matchKernel(source), heldLines(held), stop(), nowPlaying() }`. `targetFor` says where a Try
  lands (`already: true` when it's on that track now: Try doesn't stack a second copy). On a new track a Try brings a
  two-bar part to hear the device on, in the same step.
- Events: `community:ready` (`ui.emit`, after each read of the index: `ui/share.js` draws the held strip's shelf lines
  again) and `workspace:go` (`ui/workspace.js`, Find's Go to, with the query: a shelf word opens the Browser on the
  shelf).

### Instance

What `instantiate(c, id, opts)` returns, for both flavours:

```js
opts = { uid, seed, clock, params, on = true }
Instance = {
  def, uid, ready: Promise,           // await before an offline render
  input: AudioNode | null,            // effects: where audio goes in (null for instruments)
  output: AudioNode,                  // stereo out
  set(params, x?),                    // the full params object (defaults merged); x: { bpm, first }
  setOn(on, at?),                     // effects: bypass with a 10 ms click-free crossfade (trails pedals keep tails)
  noteOn(pitch, vel, time, x?), noteOff(pitch, time), allOff(time?),   // instruments; `time` is AudioContext time;
                                      // x: the note's own { bend, mod } (kernels; kernel/expr.js)
  expr?({ bend?, mod?, sustain? }, time),   // kernels: the channel's pitch bend, mod wheel and pedal (docs/DEVICES.md)
  cancel?(pitch, time, off?, to?),    // take back a note handed over but not started (kernels, the fallback synth)
  latency: 0, meter?(): number, dispose(),
}
```

`clock` (from the engine; `engine.clock`) is `{ playing(), bpm(), beatsPerBar(), barTime(b), barAt(t), bar(), next(t),
phaseAt(t, bars = 1) }`, the shape the ported pedals expect (clawd-o-matic's `PLUG.clock` / `x.clock`). Offline it is
a free grid from time 0 at the project tempo. A track that names a device that isn't there plays through
`engine/fallback.js` (a small deterministic synth, or a pass-through effect); a held device (its code not allowed
here) plays as silence (an instrument) or a pass-through (an effect), with no report.

### Kernels (the format agents write)

A kernel is the source of one JS expression evaluating to an object. It runs in the AudioWorklet (and in device
checks), gets `dsp` (the stdlib, `kernel/dsp.js`) and nothing else: no DOM, no fetch, no Date, `Math.random` throws.

**Kernel code is evaluated only in the worklet** (and the Node renderer), never on the page. A kernel can arrive from a
share link, a device file or any agent, and the shadowed names are not a boundary: `[].constructor.constructor` still
reaches the realm's `Function`. What makes it safe is where it runs: the AudioWorkletGlobalScope has no DOM, no
localStorage (the person's songs and settings), no cookies and no network. It isn't isolated: a kernel shares the realm
with every other device (SECURITY.md, "Still open"). On the main thread, `host.compileKernel(src)` is a
parse only (`new Function` is built and never called) for a fast syntax error with its line; every other refusal
(no `create()`, a bad `poly`, `Math.random` at compile time) comes back from the worklet as a compile-stage error.
Never call `kernelCompiler(...).compile()` on the page. The Node renderer (`tools/render.js`) has no such scope: a
kernel there runs with Node's globals, so render only songs and devices you trust with it, and never from a server
(`tools/node-permissions.js` runs the CLIs that render someone else's song under Node's permission model).

```js
// effect
({
  create({ sr, seed, dsp }) {
    const lp = dsp.svf();
    return {
      process(L, R, n, p) {             // in-place stereo, n frames; p: current param values (smoothed)
        lp.set(p.cutoff, 0.7);
        for (let i = 0; i < n; i++) { L[i] = lp.lp(L[i]); R[i] = L[i]; }   // (a real one keeps two filters)
      },
    };
  },
})
// instrument: the host owns polyphony (poly: 8 by default), note timing (sample accurate) and smoothing
({
  poly: 8,
  create({ sr, seed, dsp }) {
    return {
      voice() {
        const osc = dsp.osc('saw'), env = dsp.adsr();
        return {
          start(pitch, vel, p) { osc.freq(dsp.mtof(pitch)); env.gate(true); this.v = vel; },
          release(p) { env.gate(false); },
          render(L, R, n, p) { for (let i = 0; i < n; i++) { const y = osc.next() * env.next(p) * this.v; L[i] += y; R[i] += y; } return env.active(); },
        };
      },
      process(L, R, n, p) {},           // optional: after the voices are summed (a shared filter, a chorus)
    };
  },
})
```

Every `process` / `render` also gets a 5th argument `t = { bpm, playing, beat }` (the transport at the start of the
block; `beat` advances while playing), so delays and LFOs can sync to the song. The host sends it; offline it is the
project tempo from beat 0.

An instrument whose sound needs each voice on its own bus can make its voices probes, as Studio A
(`devices/builtin/drumroom.js`) does for its mic mix. A probe's `start` queues the note, and its `render` counts the
frames the host asks for and returns true for that block. `process` then knows each note's offset in the block
(`n` minus the frames) and runs the instrument itself, its buses shared. The host's contract is unchanged: notes stay
sample accurate, and a probe the host steals or releases simply tells `process`.

The device check (`kernel/check.js`, `checkDevice(def, { quick, signal, timeout })`) parses it, renders test signals through it
offline and reports `{ ok, errors, warnings, level: { lufs, deltaLU }, truePeak, nan, tail, cpu, latency,
deterministic, extremes }` (plus `voices` and `stuck` for instruments). `define_device` returns this report to the
agent. A device that fails to compile, produces NaN, peaks over +6 dBTP at its defaults, runs away at an extreme
setting, leaves a note stuck or makes no sound at its defaults is refused; loudness, tail, CPU, latency and
determinism problems are warnings. DEVICES.md has the full table. Every wait on the audio thread races a deadline
(60 s by default) and the caller's signal: a render that doesn't end refuses the device ("process() may never
return"), and Stop ends `define_device` at once. A render can't be cancelled, and Chrome renders every offline context
on one worklet thread, so the renders a check gave up on are counted until they end (`heldRenders()`): meanwhile a
check, a song render (`engine/render.js`: an export, a reference compare, `arrange_around`) and the agent's measuring
say the thread is held instead of queueing behind it, since loading a worklet then would block the page.

The verdict is measured from samples. A render hands back stereo Float32Arrays and what the kernel's side says about
itself (errors, latency, poly, voice counts); the check keeps samples only at the length it asked for and claims only in
range, and measures level, peaks, NaN, tails, determinism and CPU itself with `audio/measure.js`. Poly, declared latency
and voice counts are claims, bounded; a reported error makes the device fail, and a renderer that sends no voice counts
back fails it too. In the browser the kernel runs in the worklet, a realm apart from the report. Node has no such realm,
so `engine/node/check.js` (`checkDeviceNode`, which `checkDevice(def, { renderer })` makes possible) runs the kernel in
a child process (`engine/node/check-render.js`, under Node's permission model: reads `app/src`, writes no files, starts
no processes, network still open) that sends back framed samples only, kills it at the deadline, times CPU from the job
going out to the samples coming back, and measures in the parent, which never evaluates kernel code. The kernel shares
the child, so the samples are its own: this stops a kernel rewriting the report, not one written to fool the check.

## The engine

```js
import { createEngine } from './engine/engine.js';
const engine = createEngine(store);
await engine.start();                 // from a user gesture: AudioContext, worklets, the graph for the project
engine.ctx                            // the AudioContext
engine.play(fromBeat?, { countIn: { beats, preroll = true } }?) ; engine.stop({ live }?) ; engine.seek(beat) ; engine.toggle()
engine.playing ; engine.beat          // transport state; beat is the audible position (for the playhead), < 0 in a count-in
engine.starting                       // a play() waiting (the engine starting, a renew): stop() or silence() cancels it
engine.gen                            // counts transport starts (play, seek); a loop wrap is the same run
engine.gridBeat                       // the same moment unwrapped: it doesn't jump back at a loop wrap (null stopped)
engine.counting                       // { from, until, beats, preroll, time } while a count-in is heard, else null
engine.beatAt(perfMs)                 // the audible song beat at a performance.now() time (pass event.timeStamp)
engine.click = { on, whileRecording, level }   // assign any of them; reads back a copy. level: dB, -60..+6
engine.metronome = true | false       // = engine.click.on (kept)
engine.recording = true | false       // a take is running (the recorder sets it; stop() and silence() clear it)
engine.silence() → Promise            // the killswitch: stop, and every sound cut within ~20 ms (tails reset); see below
engine.on('transport' | 'meters' | 'error' | 'graph' | 'silence', fn) → off
engine.meters                         // { tracks: { [id]: { peak, rms } }, master: { peak, rms } } (dBFS, ~30 Hz)
engine.liveNoteOn(trackId, pitch, vel) ; engine.liveNoteOff(trackId, pitch)   // MIDI, qwerty, auditions
engine.audition(trackId, pitch, vel = 0.8, beats = 0.5)
engine.inputNode(trackId)             // a GainNode feeding that track's inserts (live input monitoring)
engine.instance(trackId, insertId | 'instrument')   // the live Instance
engine.masterTap                      // an AudioNode to tap (recorders, analysers); don't feed it
engine.clock                          // the device clock above
engine.latency                        // { base, output, tracks, comp, max, master, total } (seconds; comp in samples)
engine.render({ from = 0, to = engine.songEnd(), tracks = null, sr = 48000, tail = 2, latencyMax = 0 }) → Promise<AudioBuffer>
engine.probeLatency({ tracks, withMix }) → Promise<{ tracks, max }>   // stems render with latencyMax: max, so they line up
engine.settled() → Promise            // every strip matches the document
engine.songEnd()                      // beats
engine.beatToSec(b) ; engine.secToBeat(s)   // at the song's tempo (the practice speed doesn't change them)
engine.rate = 0.25..2                 // practice speed (the Jam room's 50-100%): the transport runs at tempo × rate, live
                                      // only, never in the song, History or a render; audio clips sit out below 1 (they
                                      // can't slow down in tune) and pick up again at 1. The transport event says rate.
engine.hush(clipIds | null) ; engine.hushed   // clips the live scheduler skips, for practice (the tab lane's riff while
                                      // you play it): live only, never the song, History or a render
engine.band(db, { keep: trackIds }) → { db, keep } ; engine.bandLevel   // practice Band level (the Jam room's Band
                                      // fader, -24..0 there; the engine takes -60..0): every track but `keep` (the
                                      // room's guitars) turned down by db at its strip's mute stage, after its fader and
                                      // any gain lane. Live only: never the song, History, a render or an export; the
                                      // room puts it back to 0 on leaving or on another song
engine.assets                         // { put(id, AudioBuffer | { sr, channels: Float32Array[] }), get(id) → Promise<AudioBuffer> }
engine.dispose()
```

Track graph (`engine/strip.js`, built by the same code live and offline): `[instrument | inputNode | audio clips] →
inserts… → fader (stereo) → mute → balance pan → meter → master sum → master inserts → master gain → safety soft clip
→ destination`. The mute stage also carries `setMix`'s `trim` (dB): the Band level live, and `renderProject`'s
`trims: { [trackId]: dB }` offline, which only the Jam room's measuring passes (so every other render, export and
golden hash is the same with or without it). The master's meter listens at its gain, before the safety soft clip, so the top bar sees a mix over 0
dBFS (red, "Clipping N dB"; pressing it takes the over off the master's gain in one undo step, a master level lane
moving with it); `masterTap` and every render are after the clip. The engine reconciles this graph with the project
on every store change (add, remove, reorder, params with a glide, bypass with a crossfade). Notes are read by a lookahead scheduler (`engine/schedule.js`; 25 ms tick,
120 ms ahead) each tick, so editing notes never rebuilds anything. `render` builds the same graph in an
OfflineAudioContext with the same functions, so what an agent measures is what the human hears.

Timing rules (`engine/engine.js` header; checked in `tools/engine-test.js`):

- **Plugin delay compensation.** Every track's notes and clips are scheduled `comp` samples late (the latest track's
  latency less its own), so all tracks line up at the master to the sample, live, in `engine.render`
  (`buffer.latency`, same shape as `engine.latency`) and in the Node render (`r.latency`). The master's inserts delay
  everything alike: a render's mix comes out `total` after beat `from`; `engine.beat` allows for it, so recordings land
  where they were played. Live input and live notes are not held back.
- **Edits inside the lookahead.** A note already handed to an instrument that is deleted or moved before it starts
  is taken back (`Instance.cancel`) and never sounds; a sounding one that is deleted is released; one whose end moved
  is released at the new end. Audio clips deleted or re-trimmed while playing fade out (and pick up mid-way where they
  now are).
- **Chase, one rule.** Wherever the transport starts (play, seek, a loop wrap) and wherever a render starts, notes that
  began before that point and are still held there sound from it, as audio clips always did.
- **The metronome** reaches the speakers through the master's monitor soft clip (summed after the master fader), held
  back by `latency.total`; it is never in `masterTap` or a render.
- **The killswitch.** `engine.silence()` is the one function every panic path calls (the transport's button, Shift+Esc,
  an agent). It stops the transport, ramps the speakers' feed (the last gain before the destination) to zero in 6 ms,
  releases every note and emits `'silence'` (Sketch's previews stop on it); then every strip builds fresh instances of
  its devices (`Strip.renew`), so held voices and reverb and delay tails are gone, and the feed opens again. `play()`
  waits for that. Anything that plays to the speakers on its own should go through the feed (`engine._monitor`) or stop
  on `'silence'`. `tools/silence-test.js` measures it.
- **The polite stop.** Tails ring on after `stop()`, but not for ever: 2 s after a stop (still stopped), every strip
  still over -50 dBFS fades out over 1 s (a gain only live strips have, `Strip.calmDown`) and is renewed like the
  killswitch renews it, then comes back up; the master too when it has inserts and nothing live goes through it. A
  strip that took a live note or an audition since the stop, or hears its input (listened for through the fade), is
  left alone; play during the fade brings it straight back. `tools/stopping-test.js` holds every demo song to -60 dBFS
  3.5 s after Stop.
- **Held keys.** The keys the musician holds (`liveNoteOn`) are theirs. The song's end, an agent's
  `stop({ live: false })`, a seek or a play from elsewhere let the transport's notes go (one by one on an instrument
  they are playing) and leave theirs sounding; their own `stop()` and the killswitch let everything go. A play that is
  waiting loses to any stop, silence or newer play that comes in meanwhile.
- **Count-in, the click and recording** (`docs/research/RECORDING-UX.md` 3.5, 3.6, 3.8). `play(from, { countIn:
  { beats, preroll } })` (beats up to 4 bars; `countIn: true` is one bar) starts the transport `beats` before `from`:
  `engine.beat` runs from `from - beats`, negative
  below bar 1, where only clicks sound; above 0 the song pre-rolls (`preroll: false`: clicks alone up to `from`, the
  song from `from`, held notes chased). The click sounds through the whole count whatever `click.on` says (accent on
  bar starts, as always). It clicks the whole beats counted from each bar line, so in 7/8 (3.5 beats) every bar starts
  on a click and its last beat is an eighth. `engine.counting` is set until the audible downbeat, when a `'transport'` event `why:
  'countin-end'` fires (`counting.time` is that downbeat on the audio clock). Stopping during the count puts the
  playhead back at `from`. A loop wrap's `'transport'` `why: 'loop'` event carries the pass boundary, `pass: { n, start,
  end, grid, time }` (n: the pass now starting, 2 at the first wrap; start/end: the song beats it wrapped to/from;
  grid: the boundary on `engine.gridBeat`'s grid; time: when it is heard, audio clock), fired as it is heard. When
  the loop won't wrap, the transport stops itself a bar after the song's last sound (`lastSound` in schedule.js: the
  bar the last note or audio clip ends in, then one more), with a `'stop'` event that says `end: true`, so the
  playhead goes back to the marker; not when play started at or past that point. `engine.recording` (set by the
  recorder from R to commit) keeps it running for a take, makes `click.whileRecording` sound, and rides on every
  `'transport'` event; `stop()` and
  `silence()` clear it after their `'stop'` event (which still says `recording: true`). `beatAt(perfMs)` maps an input
  event's `timeStamp` onto the audible beat through the same tempo map, wraps and count-in as `engine.beat` (the audio
  clock is read against `performance.now()`, smoothed over the last second), so main-thread lag doesn't make notes late.
  The click is never in `masterTap` or a render.
- **Muted clips** (`clip.mute`) are skipped by `notesIn` / `audioIn`, so the live scheduler, `engine.render` and the
  Node render all leave them out; muting a playing clip takes effect inside the lookahead, like deleting it: its
  notes not yet started never sound, sounding ones are released, and an audio clip fades out over 10 ms.
- **Automation** (`docs/research/AUTOMATION.md` 3.5) plays by the rules notes play by. `schedule.js` `autoIn(p, from,
  to, { cut, chase })` gives the lane segments starting in a range (chased: the one playing at `from`, or a constant
  where none is), with `a`/`b` in knob travel (`core/automation.js`). Kernel params: each segment goes to its instance
  once (`Instance.auto({ key, time, end, a, b, c, start })`, at its time plus the track's `comp`; `autoClear(key, from,
  release?)`, `autoStop()`), and `KernelCore` evaluates it at the start of every 128-frame block, then smooths it like
  any target (10 ms), so the worklet and the Node renderer are bit-exact; a key on a lane ignores `set()`. Graph device
  params: one merged `set(values, { at })` per device every 20 ms inside the lookahead (the device glides); params a
  pedal applies before `at` are `auto: false` in `devices/guitar/pedals.js` and get no lane (`tools/guitar-test.js`
  finds them). Gain and pan: linear ramps through control points on the 128-frame grid (`schedule.js` `mixGrid`; the
  Node renderer interpolates the same points per sample). Loop wraps, play and seek chase; an edit to a lane while
  playing clears what was handed over from now and sends it again; stopped (and at every render's start), each
  automated param sits at its lane's value at the cursor (`trackSpec(t, { at })`, `mixAt(t, at)` in `strip.js`). A held
  lane (`off`) plays the static value. `tools/probe-kernel.js` turns params into DC for the checks.
- **Silence costs nothing (live).** A kernel with nothing coming in whose output has stayed under −100 dBFS for
  max(0.5 s, min(tail, 10 s)) dozes until something arrives (`kernel/worklet.js`, `processorOptions.idle`; renders
  never doze). `tools/perf-check.js` measures 16 heavy tracks at 48 kHz: playing, stopped, and stopped without dozing.

### The canonical render and the preview

"Deterministic" has one definition: the **canonical render** is the Node one, `app/src/engine/node/render.js`
(`renderSong(project, { from, to, tracks, sr, tail, assets, graph, latencyMax })`; CLI
`node tools/render.js song.json [--out x.wav] [--from --to] [--tracks Bass,Keys] [--measure] [--hash]`). It runs the
worklet's own `KernelCore` (`kernel/worklet.js`: voices, stealing, the note queue, smoothing, the transport) in
128-frame blocks at 48 kHz, and mirrors the strip in float32: fader, balance pan, track-order sum, master inserts,
the soft clip's curve interpolated as Chrome does. Same song JSON, same samples; a render's identity is the SHA-256
of its float samples (channel 0 then 1, Float32 LE). Graph devices (pedals, amps) can't run there: their inserts
are bypassed and their tracks skipped, with a warning (`--strict` fails instead).

**Browser renders and playback are the preview**, measured to agree with the canonical render within −90 dBFS for
kernels (`tools/golden-test.js`; most scenes come out bit-identical, the rest differ where Chromium's and Node's V8
round `Math.exp`/`sin`/`tanh` in the last bit). `tools/golden.json` pins each scene's hash (`tools/golden-scenes.js`:
built-in instruments on the test phrase, effects on the DI strum, the demo). **It is never regenerated casually:** a
moved hash means the sound moved; regenerate only the scenes changed on purpose (`UPDATE_GOLDEN=<scene,...>`) and say
why in the commit (clawd-o-matic has the same rule). Hashes hold for the Node major and CPU arch in `golden.json`
`made`; elsewhere loudness must match to 0.05 dB. Graph devices built on native nodes are held to −80 dB between
renders (a few vendored pedals move their LFOs from main-thread timers; `tools/guitar-test.js` names them).

## The ears (`audio/measure.js`)

```js
measure(buffer, { from?, to? }) → {
  lufs, lufsShortMax, lra, truePeak, peak, rms, crest,          // LUFS per BS.1770-4; LRA per EBU 3342; true peak 4x oversampled (dBTP)
  bands: { sub, low, lowmid, mid, highmid, presence, air },     // dB: each band's share of the total (the balance)
  bandsAbs: { ... },                                             // dB: each band's own energy (what an EQ move changes)
  centroid, width, correlation, sideDb,                          // Hz; stereo
  onsetsPerSec, silencePct, clipped, duration, sr,               // clipped: samples at or over 0 dBFS
  key?: { root, scale, confidence }, chroma?: number[12],
}
spectrogram(buffer, { width, height, from?, to?, floor? }) → Promise<string>   // PNG data URL (agents can look at it)
```

Bands: sub < 60 Hz, low 60-250, low-mid 250-500, mid 500-2k, high-mid 2-4k, presence 4-8k, air > 8k. dB values never
go below −120, so results survive JSON. Pure JS: it runs in Node (the bench, the canonical render) and the browser.

## The UI

`app/src/ui/shell.js` lays out regions and owns the one animation loop and the key handler:

```
top     transport bar and the Song menu; then the workspace's note and Find anything (div.ew-ws; with the agent
        pane open on a wide screen, and on a phone, Find sits at the end of the agent's tab row, ui.wsSide)
left    Browser, Inspector (tabs)
center  Arrange, Jam (tabs; ui/jam.js puts them in the arranger's toolbar row, so they cost the song no height)
bottom  detail (tabs: Sketch, Notes, Beat, Grooves, Devices, Mixer, Reference)
right   Agent, Connect, History (tabs)
```

```js
ui.panel({ id, region, title, icon?, order?, mount(el, ctx) { return { update(evt), frame(now), unmount() } } })
ui.show(panelId, { save?, by? }) ; ui.state ; ui.select(sel) ; ui.on(type, fn) ; ui.emit(type, detail) ; ui.toast(text, { kind, action })
ui.announce(text)                 // a screen-reader-only status line (agent edits and messages while the Agent tab is hidden)
ui.keys.add({ key: 'Space' | 'KeyZ' | ..., mod: 'mod' | 'shift' | 'alt' | 'mod+shift' | null, run(e), when?(), label, group, global?, feature? })
ui.state = { selection: { track, clip, notes: Set<noteId>, range: { from, to } | null, insert }, zoom: { pxPerBeat, trackH },
             scrollX, scrollY, focus: panelId, presence }
ctx = the app object (window.overdub)
```

Rules: state lives in the store (document) or `ui.state` (session), never in the DOM; no `requestAnimationFrame` of
your own (use `frame(now)`, called only while you're visible); mount is cheap and repeatable; keys are declared, not
bound. `?` shows every declared key, grouped, with a switch that turns single-key shortcuts off.

**Keys** (the ones every panel must leave alone; the layout is Logic's and GarageBand's): Space plays from the start
marker and stops back at it, ⇧Space plays on from where it stopped, Home and Enter put the marker at bar 1, R records
(again: punch out), ⇧R puts what you just played in the song, L loops, K the click, ⇧K the count-in, M mutes and S
solos the selected track (or the selected clip's) from any panel, ⌘E (Ctrl+E; Live's key, as a browser keeps ⌘T for a
new tab) splits the selected clips at the playhead, 0 mutes or unmutes the selected clips, H hums, T taps, \` toggles
musical typing, `/` searches the browser, ⌘/ (Ctrl+/) asks the agent (plain `/` too while the browser is closed), A ·
B · D show or hide the agent, the browser and the detail pane, ⇧B builds a band around the selected clip, E shows or
hides the selected track's automation lanes, ⌘↑ / ⌘↓ step the selected clip's takes, Esc stops the agent, ⇧Esc
silences everything (All off, the killswitch, even from a text field), ⌘Z / ⇧⌘Z undo and redo, ⌘S / ⌘O save and open
the project file. Until 2 October 2026 M was the click, ⇧M the count-in and S split (soloing only in the mixer); the
first press of each moved key in a browser says so in its toast, once (`ui.keys.firstPress`, `overdub:keys-moved`),
and ⇧M does nothing now. While musical typing or Tap has the letter keys, those keys play notes (S and K in musical
typing, K and L in Tap, where L is an open hat): the shell tries a mode's keys before the always-on ones, and the
transport says so under the title. R and Space still record and stop, and M, which neither mode plays, still mutes.
In the Jam room (its keys have `when`, so they win there): [ and ] flip the tones, ⇧L loops the section, − and =
change the practice speed, and R records what you play onto the Guitar track, never a hum.

**Phones** (under 900 px): the side panes become full-height sheets (one at a time) and the detail pane a bottom
sheet whose divider is a drag handle (never taller than the room it has: turning the phone clamps it, so the first
drag after a turn moves it); the top bar takes two rows. The panels' side is in `app.css` ("phones"): text
12 px at the least, tap targets 40 px (44 for tabs and sheet controls). `tools/phone-test.js` measures it. A browser
takes a tap to the nearest thing that can be pressed (touch adjustment), so empty space beside a small target needs
a target of its own: a track header's empty space (`.ar-htap`, under its words) selects the track, and only a tap on
S soloes it. One touch rule for every control a finger drags (`ui/touch.js`, `holdToMove(el, { name, pick, scroller })`:
the faces' knobs, the plugin kit's knobs and sliders, the mixer's faders and pans): a drag that starts on one scrolls
whatever it sits in (by hand: the control's `touch-action` is none) and the control never hears it; held still for
350 ms it is picked up (outlined in warm ink, a buzz, the first hold explained once) and gets the touch then, where
the finger is, so a slider or a fader moves from where it sits and never jumps to the finger; held on, its menu opens.
A mouse and a pen are left alone. Toasts: the same words again while they're up count on the note there ("×3") instead
of stacking, a phone shows two at most, and an open device window is never under one (`ui.dockToasts`, below).

**The workspace seam** (`ui/workspace.js`, `ui.workspace`, `app.find`): what's on screen, kept apart from the song.
There is one studio, one set of panels and one undo, and nothing in it is put away. `FEATURES` is the registry and
Find's index: each feature has a permanent id (`notes`, `mixer`, `loop`, `agent-setup`, …), a group, a title, a
one-line purpose, where it is (a line an agent can say), its panels (mapped centrally, so panel files don't tag
themselves) and search aliases. Parts outside a panel are tagged in place, `data-feature="<id>"` (space-separated for
more than one), so Go to can point at them. **Find anything** (`⌘K`, `app.find.open({ query })`) ranks every source
with `rank()`: Go to (`FEATURES`: `ui.show` its panel, or a two-second pencil outline on its tagged part, in agent ink
when an agent asked), Do (every `ui.keys` declaration with a `label`, run as the key would be), Sound (devices and
presets: an instrument tries on the selected track through `app.sounds.try`, never an overwrite; else the Browser
searches it), Help (the guide page's `h2[id]`/`h3[id]` headings, read once) and, last, Ask (`ui.emit('agent:compose',
{ text, send: true })`). Local search spends no tokens. The layout is per browser and is **never an op**: not in the
store, not undoable, never in a share link or a song file. Which view a load opens in is `decideView`
(`ui/workspace-view.js`, pure): `full` for everyone, nothing written down; a saved `view: 'simple'` is read as full
(`from: 'merged'`: the studio says so once, on `overdub:start.merged`). `?view=simple` opens the earlier simple view
for that load, for one release: the root carries `ws-simple` and a `ws-off-<id>` per feature put away, one generated
stylesheet (`.ws-off-<id> [data-feature~="<id>"] { display: none !important }`) hides their parts, and reaching for
one (`ui.show`, a key declared with `feature`, Find) brings it back, signed, with a note; `localStorage
['overdub:workspace'] = { v: 1, view, added: { [id]: by } }` keeps what was added. `?view=round` draws the Round
prototype (`ui/round.js`) over it. Other modules never import `workspace.js`: they tag parts and call
`app.ui.workspace?.…`. Changes emit `ui.emit('workspace', { view, hidden })`. There is no agent tool for the layout;
`get_selection` carries `studio: { view, hidden }` only under `?view=simple`.

```js
ui.workspace = { FEATURES, view(), setView(view, { by }), has(id), panelShown(panelId), featureOfPanel(panelId),
                 go(id, { by, query }), add(ids, { by, note }), putAway(ids, { by }), reach(id, by), list(), where(id),
                 openFind({ query }), closeFind(), search(q), openMore (an alias) }
app.find = { open({ query }), close(), search(q) }
```

**Picking a sound** (`ui/sounds.js`, `app.sounds`; the sets in `core/sounds.js`; docs/INSTRUMENTS-UX.md): a new idea
is a new track, and its sound is picked by ear on the **sound card** ("What should this sound like?"). After the first
take onto a track that had no clips the card offers the track's current sound and up to four others that suit the
take (`soundsFor(kindOfTake(take))`: a hum, a played line, chords, a bass line or a beat each have a set of real
device ids and presets, `SOUND_SETS`); it opens from the take's note or the header's **Sounds** (under `?view=simple`
by itself, with the take playing). Trying a sound is a **preview**: `store.preview({ type:
'instrument.set', … })`, never in History; one track at a time, the next trial releasing the last. **Keep** releases it
and dispatches one `instrument.set` by you in the same task (one undo step; a track still named after its old
instrument is renamed with it; an agent's suggestion keeps `reason: 'suggested by …'`); **Back** releases it. A trial
ends by itself, said in the card's status line or a toast with **Keep it**: R on that track and touching the tried
device's controls keep it first; an undo or redo that touches the track, an agent tool that reads or changes the song
(not `suggest_sounds`, `get_selection`, `get_variation_result`, `say`, `ask_human`, `get_recording`, `highlight`), another track
selected, the browser's pane closed, the track removed or another song go back first. On an uncommitted Sketch take
the card previews the track the Keep would make (`track.add`), and the take's own Keep makes track, clip and sound in
one step. While a preview is applied `localStorage['overdub:sound-trying'] = { song, track, instrument, newTrack?, at
}` holds what the track really plays, and the next boot puts it back (a preview by the house, nothing in History). The
browser follows the same rule: a click on an instrument tries it on the selected track (Keep, Back in its target
line); a melodic instrument on a drum track, or a kit on a pitched track with notes (`rack.isMismatch`), asks first
(**New track with …**); Shift-click and a drop onto empty space make a new track, a drop onto a lane keeps at once.
`suggest_sounds` (`agent/sounds-tool.js`) puts an agent's rows on the card, signed by it.

```js
app.sounds = { setHost(fn), offer({ track, from, anchor?, take? }), try(track, { device, preset? }, { play }),
               tryNew(take, { device, preset? }), keep({ reason? }), back({ why? }), keepIfTrying(track),
               trying() → { track, device, preset?, was, newTrack? } | null, pending(track), toastLine(made),
               suggest(track, rows, { by, id, reason, done }) → { id }, close(), current → { track, rows, from } | null,
               setsFor(track) }
```

**Start a song** (`ui/start.js`, `app.start`; the pure parts `input/rounds.js` and `core/start.js`): the blank song's
empty state is its door (`arranger.js` `syncEmpty` draws `doorOf(app)`), on every blank song. **Tap a beat** opens a
stage over `.ew-main` (the arranger and the bottom pane `inert` under it; the whole screen on a phone). The pads play on
a `store.preview` Drums track (never in History, released before any landing and on `pagehide`, ahead of the autosave),
and each hit (`e.timeStamp`) goes through `rounds.js` `takeOf`: `timing.js` `fitHits` on the free-time hits, the tempo's
octave, `loopOf` (1, 2 or 4 bars, the smallest that agrees nearly as well as the best), `foldRounds` (per drum sound: in
the only round, in both of two, in half or more of three or more; the rest strays), `downbeatOf` (kicks on 1 and 3,
snares on 2 and 4) and `readingsOf` (the other 1, the tempo halved or doubled within 60 to 180). **Done** dispatches
`core/start.js` `planStart` once, by `'you'`: on a blank song the rounded tempo and a loop over the take, a new track
named by `newPartFor`, one clip. The Timing words (`atLevel`) and the readings are `notes.replace` (and `clip.set`,
`project.set`) dispatched with `join` on that transaction, so one undo takes the lot. **Hum a tune** previews a groove
(`agent/grooves-tool.js` `putGroove` dry run) at a chosen speed; **Hum** dispatches it with the tempo and loop, then
`app.onboard.humOver()` and `recorder.record()`. While the stage is on its play steps, `app.start.busy` is true and
`agent/tools.js` refuses song-changing tools with `recording`. Its keys are `ui.keys` declarations with `first: true`,
and while it's open the studio's single keys are held under it. `app.start = { open({ kind: 'tap' | 'hum' }), close(),
step ('play' | 'hum' | 'in' | 'readings' | null), kind, busy, tap(row, perfMs), done(), again(), setLevel(level),
readings(), useReading(i), humNow(), humFree(), leave(), landed(), take(), on('step' | 'land' | 'close', fn) }`.

**Take one** (`ui/onboard.js`, `app.onboard`): the first-run coach (hear it, take one, keep it, ask the agent, keep
its take). Each step advances on the real event (transport, capture `add`, a kept clip by you, an agent's request or
notes). State in `overdub:onboard`; never starts under `navigator.webdriver` unless `?coach` or `start({ force })`.
Never starts by itself in the simple view: there it comes from **Tap a beat**
(`firstMinute`), the Song menu's **Take one** or `?coach`. The Song menu's **Take one** restarts it. `app.onboard = { start({ force?, restart? }), stop(), skip(), done(), ask(),
firstMinute(kind = 'tap'), keysOver(), step, index, steps, active, state, take }`; ui event `'onboard'`.
`firstMinute()` is the first minute (`docs/research/RECORDING-UX.md` 3.3; **Tap a beat** on the card and on a new
song's blank sheet): a Drums track if the song has none, selected, a 2-bar loop at the marker, the click, Sketch on
Tap, and the loop playing, so the ball is moving before a sound is made; R records and each pass layers.
`keysOver()` (and `firstMinute('keys')`) is "Now the overdub": a pitched track (Keys if there is none), musical
typing on, the same loop. What it lends (the loop, musical typing) it puts back when the tour ends, a reload
included: the loop only on the song it set it on (`lent.song`), only as it left it (a change by anyone else since
marks it `touched`, and then it stays), in a dispatch signed by the house (`'overdub'`), never by you. It never runs on
someone else's song by itself: a tour left half-way doesn't resume on a link, and a link opened mid-tour sends it
aside; it picks up again when a song of yours is back (Back to my song, New song, a reload), not when the link's
song is made yours.

### Device windows (`ui/plugin.js`, `app.plugin`)

The rack's faces are right for a chain and too small for a deep instrument, so any device opens big: **Open** on a
face's caption, a double-click on the caption, or an agent's `show_device`. One window at a time (opening another
replaces it).

```js
app.plugin.open({ track, slot }, { focus = true, by = 'you' }) -> { ok, error? }   // slot: 'instrument' | an insert id
app.plugin.close() -> boolean ; app.plugin.current -> { track, slot, device, name, editor } | null
app.plugin.editorFor(def) -> the custom editor's name, or null (the generic one)
```

- **Desktop**: a window over the studio, never modal: the transport, the keys and musical typing still work (the
  window is a `[data-panel="plugin"]`, so `ui.state.focus` is `'plugin'` while it's in use and no panel's focused keys
  fire), and a person opening it selects its track, so musical typing plays what's on screen. Dragged by its head,
  sized from its corner (arrow keys on the corner too); until it is sized by hand it takes its device's own size, up
  to the room there is. Its place and size last the session (`ui.state.pluginWin`). Esc closes it while it's in use
  (focus in it), after whatever Esc closes first (a menu, a popover, the code sheet, the keys sheet; the agent at
  work, a hum) and ahead of musical typing's Esc; × closes it; focus goes back to what opened it. **Under 900 px** it
  is a full-height sheet (44 px keys, 12 px text, a Play key, Tab kept inside); on its side (under 500 px tall) its
  head is one row (the name, the preset, A and B, On, Code, Ask, play, close), who made it and the scope give way, and
  the keyboard is one row, so the device keeps the height.
- **The head** is the device's nameplate in its own colours and lamp (`def.look`: `color`, `ink`, `led`; the lamp
  breathes with the device's output), the track and slot it's on, who made it (`byline`, and "via Jo's link" from a
  device's `via`: `core/share.js`; the house is unsigned, the Guitar Studio's pedals say so) and a scope over a
  spectrum of the device's own output: the window taps `engine.instance(track, slot).output` with an AnalyserNode of
  its own, as `engine.voices()` does, and lets go of it on close; no engine change. **The bar**: the presets (the
  rack's names, `app.rack.presetOf` (rack.js `presetNow`), "Felt, edited"; with nothing picked this session the nearest
  preset names a sound that is plainly it moved a little, "Sprocket, edited" (`nearestPreset`: distance in knob
  travel, a switch on another option counting a whole travel; less than half as far from it as from the next nearest
  and less than half way to its nearest neighbour), "Default" at the defaults, else "Custom"; ‹ › and the list apply
  `presetParams`, one undo step each; a device with none still has Defaults), **A/B** (two snapshots of its params in
  `ui.state.pluginAB`; a flip puts the other side's params in as one undo step, B's first visit starts as a copy of A,
  and an undo or redo of a flip flips the letter with it; Copy A to B; its line goes when either side changes, and a
  flip says how many controls the two set apart), **On** for an effect (bypass, `insert.set { on }`), **Code** for a
  kernel (`app.rack.openCode`), **Ask** (the agent, with the device attached) and a line saying what an agent just
  changed ("Claude set Reso to 0.620."). A hand on a control is one History entry in words, with where the gesture
  ended ("Light Table: A pos 0.53"; rack.js `gestureLabel`). While a window is open the studio's toasts keep clear of
  it (`ui.dockToasts({ el, box })`): beside it where a 260 px note fits, else a line of its bar. An instrument has a
  **keyboard** along the bottom: click or drag to play it (lower on a key is louder; each pointer its own note), arrow
  keys and Enter from the keyboard; it plays through `engine.liveNoteOn`, the piano roll keyboard's path, and lights the
  keys MIDI or musical typing play on that track.
- **The generic editor** (`ui/editors/generic.js`) is what every device without its own gets: the built-ins, the
  house shelf, the Guitar Studio's pedals and amps, an agent's devices. Sections: a param's `group` (an amp's `cab`)
  or key prefixes (`a_*`, `flt_*`, `env1_*`: two params to a prefix), the rest in "Main"; else eight params or fewer
  in one row, more by role (Sound, Tone, Envelope, Movement, Space or Voice, Level). Switches (`opts`) sit over the
  knobs, as segmented words (five or fewer, short) or a select; an envelope's attack and release (decay and sustain
  too) are also drawn, to drag. `layout(def)` is what it shows, and `show_device` hands it to the agent.
- **Every control** keeps the rack's behaviour: a hand on a param whose lane plays holds the lane in the same step
  (`controlOps`; the first hold says so), the control says *auto* or *held* (a button: show the lane, or back to it),
  its menu (right-click, a long press, the menu key) is the rack's `controlMenu` (Automate, Back to the lane, Hold it
  here), it turns by itself while its lane plays, a gesture is one undo step signed `you` (the rack's coalesce keys,
  so `input/autorec.js` writes a move into its lane while R records), and an agent's change flashes it in cool ink.
- **Custom editors.** A device the studio ships names its own: `editor: 'wavetable'` loads
  `ui/editors/wavetable.js`. Only a def whose `source` is the studio's (`'builtin'`, the Guitar Studio's
  `'clawd-o-matic'`, the house shelf's `'library'`) may name one, matching `/^[a-z][a-z0-9-]{0,39}$/`; a song's device
  (`source: 'project'`: a song, a link, a device file, `define_device`) gets the generic editor whatever it says, so
  code from a song never decides what UI code runs on the page (SECURITY.md). One that fails to load or to mount
  falls back to the generic editor. Light Table's is the first: it draws with its device module's page maths
  (`devices/builtin/wavetable.js`: `warpCycle`, `filterResponse`, `envAt`, `lfoShape`, `modMatrix`, which mirror the
  kernel's), so the window shows what plays (`docs/research/LIGHT-TABLE.md` section 7). The contract (the header of
  `ui/plugin.js` has it in full):

```js
// ui/editors/<name>.js
export function mount(el, ctx) { /* ... */ return { update(evt) {}, frame(now) {}, unmount() {} }; }
ctx = {
  app, def, addr: { track, slot, insert },
  params() -> { key: value }        // what it plays now: its params, a playing lane's value over its own
  stored() -> { key: value }        // its params, without the lanes
  set(patch, { gesture: 'move' | 'end', label?, fresh? })   // the generic controls' own path: holds a playing lane,
                                    // signed you; calls on the same params merge into one undo step (a drag is one
                                    // step); fresh: a discrete move (a patch made or cleared) is always a step of its
                                    // own; label: what History calls it
  on(fn({ params, keys, by, kind })) -> off   // any change to what it plays: yours, an agent's, an undo, a preset or
                                    // A/B flip, a lane playing ('lane')
  control(key, { size, kind, label, orient, length }) -> el   // a bound control (knob, segmented, select, tap; kind
                                    // 'slider', orient 'v' for a fader): menu, marks, flash
  param(key), text(key, v), lane(key), menu(key, anchor), flash(key | el), isAgent(by), byline(by), status(text),
  statusText(),                     // what the bar's line says now (a line of the editor's own is kept current only
                                    // while it is still the one showing: Slide Rule's about a band follows the band)
  kit,                              // ui/plugin-kit.js
  keyboard: { el, shown, show(on), range, setRange(lo, hi), on(fn({ p, v, on })) -> off, held() },
  meter: { node(), level() -> { peak, rms }, scope(buf), spectrum(buf), sampleRate,
           tap('input' | 'output', { fftSize, smoothing }) -> AnalyserNode | null },   // an editor's own analyser on
                                    // the device's input (an effect's) or output; it follows the instance, let go on close
}
// update(evt): what on() gets, plus { type: 'on', on } (bypass) and { type: 'lanes' }; frame(now): once a frame while
// it's open; unmount(): on close, on another device replacing it, and before a rebuild (a new version of the device);
// said(keys, by), optional: what an agent's change to those params did, in words, for the window's line ("Claude drew
// the volume shape: 3 points"), or null for the window's own ("Claude set Depth to 80%")
```

Scribble Strip (`core.shaper`) is the first device the studio ships with an editor of its own (`ui/editors/shaper.js`):
the selected lane's shape on a canvas, drawn with points, bends and a pencil, its playhead dot riding the line at the
transport's beat (DEVICES.md; `docs/research/SHAPER.md`).

- **The kit** (`ui/plugin-kit.js`), the widgets editors share: `knob` (drag up or down, Shift fine, the wheel, arrow
  keys, Page Up/Down, Home/End, double-click for the default; `role=slider` with its value in the param's units; a
  modulation ring, `setMod`), `slider`, `toggle` (the `.tog` lamp), `segmented` (a radio group in reverse print),
  `select`, `tap`, `xy` (a pad, both axes from the arrow keys), `envelope` (ADSR: draggable points and curve handles,
  each a labelled slider), `lfo` (the shape and where it is), `canvas` (device-pixel sizing, a ResizeObserver, drawn
  only from the window's frame and only while on screen), `meter`, `keys` (the piano strip) and `menuOn` (a control's
  menu). No `requestAnimationFrame`: the window joins the shell's loop through a top-region panel with no face (id
  `'plugin'`: the top region is always visible) and pumps the kit's canvases from it. Values travel and snap as the
  faces' do (`core/automation.js` `toPos`/`fromPos`, `ui/faces.js` `valueText`), to a param's own `quantum` when it
  has one.
- **Agents**: `show_device { track, slot, close }` opens a device's window for the person (it changes nothing in the
  song; refused while they record) and returns what it shows, with its sections and their param keys: the generic
  window's layout, or a custom editor's sections by the names its window shows (each control's nearest named section:
  Light Table's "Mod matrix", Studio A's "Mic mix"), the params it has no control on screen for last (`shown: false`).

### The Jam room (`ui/jam.js`, `app.jam`)

A guitarist's room, the center region's second panel (`ui.panel({ id: 'jam', region: 'center' })`). It shares the song,
the engine and the devices: switching tabs keeps the song playing, and a take recorded here is in the arranger after.
Everything it shows is read from the song, the engine and `ui.state.jam` (tuning, left-handed, overlays, the bank, the
view, the cab strip open; the preferences kept in `overdub:jam`); nothing of its own goes in the song. Under the stage
two tabs share the main area (`J.view`, `app.jam.setView`): **Neck** (the tab lane and the neck) and **Rig** (the amp
and the pedalboard; the stage steps aside and the tabs' row keeps the chord now and next). A laptop can't show the neck
and a full-size amp with its board together under the chord (at 1280x800 the room is about 620 px wide and 700 tall),
so each gets the whole area, one click apart, and the song plays on across them.

- **The chords** (`core/jam.js`, `chordTimeline(project, { grain })`): pitch classes per half bar from every pitched
  clip (drums skipped; a clip weighs as chords, bass or a line by how its notes start together and how low they sit),
  scored against chord templates with the bass note (slash chords), then smoothed by a Viterbi pass that charges for a
  change, more mid-bar. Cached until a harmony op (notes, clips, tracks, the key, sections, time) or a load.
  `whereAt(project, timeline, beat)` gives the chord now, the next one and the beats to it, the section, bar and beat.
- **The neck** (`core/fretboard.js`): tunings (standard, drop D, half-step down, DADGAD, open G), `positionsOf`,
  `fingering(notes, tuning, { span, near, open })` (a Viterbi over each note's places, one hand position of `span`
  frets at a time, charging for shifts and string skips; `{ error, hint }` when a chord won't fit one hand), `boxOf`,
  `placeNotes(notes, { tuning, capo })` (the notes' own places where they still play their pitch, the rest fingered
  around them; a capo fingers from its fret), and tab text (`tabText` / `parseTab`: one column a 16th or an 8th-note
  triplet, `=` holding a note on, bends and legato as marks; AGENTS.md has the format). Drawn on a canvas in a sideways scroller from `frame(now)`: the scale, the pentatonic,
  the chord's tones, the next chord fading in as the change nears, what an agent shows (`show_on_fretboard`, in its
  ink with crop marks), the lick, and what you play (`app.input`'s `note` events: filled where it fits, a ring where
  it doesn't).
- **The Guitar track.** A real guitar goes on an audio track ("Guitar", armed, monitored through its inserts by
  `app.input.audio`); the keys, MIDI and taps on the neck play DI Box (`core.guitar`) on an instrument track. The room
  uses the one that matches what you play with and makes it when needed (its fader set by measuring the band against
  a lick on it: the guitar sits 3 dB over the band, up to the fader's top, +6 dB; **Match the band** measures your own
  playing for five seconds and sets it again, one undo step). The input opens with `audio.open({ monitor: 'auto' })`:
  an interface or line input you pick is monitored at once, a microphone isn't (`state.monitorLine` says why), and a
  feedback guard turns monitoring off if it hears a howl; with no audio track the monitor waits and the room makes
  Live guitar in the `'monitor'` event, so nothing toasts. A tone is a Guitar Studio rig loaded with
  `rigOps(track, rig, { replace })`, one undo step; with both guitars present a tone loads on both, and a knob on the
  board moves both chains.
- **The rig** (the Rig tab): the guitar track's chain as a stage. The chain's first amp is drawn at its full face
  (`faces.renderFace(def, params, { size: 'full' })`, its knobs scaled to the room's width, 46 px at most), its cab and
  mics strip folded to a line that names them (**Adjust** opens it). Under it the pedalboard, in signal order: the
  input jack, the pedals before the amp, an Add a pedal slot, the amp's place, the pedals after it, the jack out to the
  mixer, patch cables between; it scrolls sideways and never up and down. Every change is a store op by you, one undo
  step, on both guitars while their chains are the same devices in the same order (`twinOf`): a knob
  (`insert.set`, through `controlOps`), a footswitch (`insert.set { on }`), a move (`insert.move`: the tape under a
  pedal drags it, its arrow keys move it a place), a take-off (`insert.remove`) and an add (`insert.add` at the slot,
  from `rack.js`'s `devicePicker`, the rack's Add an effect).
- **The Band level** (practice): the Band fader turns everything but the room's guitars down (`engine.band`, kept in
  step as the guitars come and go), shown in the head while it's below 0 dB, back to 0 on leaving the room or on
  another song. Match the band uses it when the fader's top can't put your guitar 3 dB over the band: `placeLive`
  renders the band turned down (`trims`), a half-dB at a time, until it's there, measured. With a guitar at an
  interface's usual level the fader's top leaves it 1.9 dB under the band on Vacancy and 4.7 dB under on Red Eye; with
  the band at -6 dB and -9.5 dB it sits 3.2 and 3.3 dB over (`tools/jam-test.js`).
- **Jam tracks** (`jamTrack({ style, key, tempo, progression, bars, seed, by })`): ten styles built with
  `core/arrange.js`'s builders (drum bars, bass lines, chord parts) into a real song with sections, the loop round the
  form, a Guitar track with the style's tone and `meta.jam` (the recipe). Opening one puts the song on screen aside the
  way opening a song does (`app.exporter.putAside`: Recent songs, Undo). The house signs the band when the person opens
  one; an agent's (`make_jam_track`) is signed by the agent.
- **Practice**: loop the section (the song's loop, an op), the practice speed (`engine.rate`, 50-100%: no op, back to
  100% on leaving the room or when a take records audio), the Band level (`engine.band`, above), the click and the
  count-in (`app.transport.click`), and R
  (`recorder.record({ hum: false })` at the playhead onto the Guitar track; the transport's punch-out after).
- **Ideas** (`jamTips(project, timeline, { tuning, at })`): the scale and its box, the chord tone to land on at the next
  change, the notes outside the key, a section in another key, and a two-bar lick (`makeLick`) fingered in the box with
  its tab. Show draws one on the neck; Show me plays the lick.
- **Hearing** (Show me, a shown chord or scale, `show_on_fretboard`'s `play`) sounds on the room's own voice, a DI Box
  in the room's tone on a Strip straight into the master, not a track: nothing is dispatched or signed, so hearing
  never edits the song. A lick waits for its own bars while the song plays; a stop, seek, rate or tempo change stops
  it.
- **The room's state for others**: `ui.state.room` is `'jam'` while the room shows (else null), and
  `ui.emit('room', { room, on })` fires each way (Sketch steps back while it's open). Entering tucks the detail pane
  away and leaving brings it back, unless you reopened it yourself.
- **The tab lane** (`ui/tabs.js`, `app.tabs`), under the stage: a page of tab with a moving cursor (`ui/tabstaff.js`
  draws it: hairline strings, the fret where each note starts, its length along the string, the chords over the bars).
  It shows the riff take being auditioned, else the Guitar track's clip under the playhead. **Suggest a riff** asks
  the house riff writer (`core/riff.js`, `riffTakes(project, { timeline, at, style, difficulty, seed, tuning }, n)`:
  deterministic for a seed; a style's rhythm template and motif over the section's chords, chord tones on the strong
  beats, scale or pentatonic between, one hand position, fingered, each riff carrying the checks it passed), or the
  agent when one is connected (its takes, from `suggest_riff` or `write_tab`, come to the lane too). A take held to
  hear is a preview on the Guitar track; Keep is one op signed by the house (or the agent) and kept by you. Practice:
  loop the riff's bars, play from its first bar with a bar of count-in, the room's speed, **Hear the riff** (off:
  `engine.hush` on its clip) and **Learn it** (the transport pauses at each note until it's played, then resumes).
  Play-along: `core/playalong.js` judges what comes in (`app.input` note events placed with `engine.beatAt`, or a
  guitar through the interface: `input/onsets.js` finds onsets and pitches in the raw input and the calibrated round
  trip comes off) against the part's notes, by onset (hit within 35-75 ms by tempo, early or late to 200 ms) and
  pitch (a chord by its strike and lowest note only); each pass ends in a line (`passLine`). Copy tab is `tabText`.
- **The Notes panel's Tab view** (`ui/tabstaff.js` `mountRollTab`): the piano roll's clip as tab, the same notes. A
  pitched clip with a place or a tuning opens there; the toolbar's **Tab** flips it (`ui.state.prTab`). Picking a fret
  number selects its note; a typed fret is `notes.set { p, s, f }` (the pitch follows, Scale lock holds), ↑/↓ move
  a note to the next string at the same pitch, and the clip's tuning and capo are `clip.set`.

`app.jam = { timeline(), where(beat?), guitar(), guitars(), source(), tone(), state, speed(), setSpeed(pct),
loopSection(), setTone(rig, { track, by }), flipTone(±1), openTrack(opts, { by }), show(spec, { by }), clearShown(),
playLick(lick), playShown(shown), tips(), describe(pitch), ensureKeysGuitar(), ensureAudioGuitar(), matchBand(),
place({ ref, band }), levelled (a promise: the guitar the room made has its measured level), setBand(db), band(),
setView('neck' | 'rig'), view, voice, neck, rigs }`.
`app.tabs = { part(), state, suggest(opts), hold(i, on), keep(i), another(), dismiss(), show(src), hear({ p, ps?, beat?,
src }), learn(on), hearRiff(on), loopRiff(), play(), text(), copy(), describe(), passes, follow, learning, geometry }`.
Checked by `tools/jam-test.js` and `tools/tabs-test.js`; the design and the research behind it are in
`docs/research/JAM.md`.

### The transport (`ui/transport.js`, `app.transport`)

```js
app.transport = { toggleLoop(), record(), silence(), marker, playStop(), playOn(), home(), click, ball, countdown(), locked() }
marker.beat ; marker.lastStop           // the start marker (song beats); where the song last stopped (⇧Space), or null
marker.set(beat, { announce?, seek = true }) ; marker.from() ; marker.label(beat?) ; marker.on(fn) → off
click.get() → { on, whileRecording, level, takes, countIn } ; click.set({ on?, whileRecording?, level?, takes? }, { announce? })
click.setCountIn(bars) ; click.cycleCountIn() ; click.borrowed
ball                                    // what the ball drew last frame: { beat, cell, f, x, y, cells, moving } or null
countdown() → { n, bar, cell, frac, label: '−1.4', until } | null   // the count-in as it is heard
locked() → boolean                      // a take is running: tempo, meter and the loop wait for it
```

- **The start marker** is where Space plays from (`playStop()`) and where every stop brings the playhead back (Space,
  the stop key, All off, a take ending, an agent's stop; a take closing first, then the marker). Stopped, the
  playhead sits on it, so the position shows it and R records from it. A click on a bar (ruler or lane), a bar
  selection (its first bar) or any seek while stopped moves it; `home()` (Home, Enter, the stop key while stopped, a
  click on the position) puts it at bar 1. With the loop on, play still starts at the marker and cycles once the
  playhead reaches the loop (Logic's cycle); `playOn()` (⇧Space) plays from `lastStop`. It is where you are, not what
  you made: per song and per browser (`localStorage overdub:marker`, the newest 24 songs), never in the song. Its
  bar is printed in reverse on the ruler.
- **The click** (the Click lamp, its caret's popover: Click, While recording, the count-in, the level; `localStorage
  overdub:click`, the count-in in `overdub:record`). `takes` (on by default) borrows the click for a take that starts
  with it off (`engine.click = { on: true, whileRecording: true }` until the recorder goes idle) and gives it back;
  anything that sets the click meanwhile keeps what it set. The count-in always clicks; the lamp is lit whenever the
  click sounds.
- **The ball** is the metronome you can see: a cell per beat of the bar (the first wider) beside the position and a
  square that travels between them on a shallow arc, lowest exactly on the beat, drawn from `engine.beat` (the audible
  beat) in `frame()`; red while a take counts in or records; with reduced motion it steps with no arc.
- **The count-in** (`countdown()`): from the moment R is pressed the position reads `−bar.beat` in record ink, and the
  arranger draws the one big numeral (4 3 2 1) over the lane being recorded onto, unless Sketch's beat band is on
  screen (`app.sketch.bandShown()`, Tap it and Hum it), whose numerals count the bar in instead, up with its lamps (1 2
  3 4, the beats waited out before the count-in's bar dimmer): one count in view. R while the song plays counts the
  beats left in this bar (`live().counting`).
- **The record key** shows the recorder's state: a ring (nothing to record onto), the ring in record ink (a target),
  its dot lit on each beat of the count, a filled lamp with REC beside the position (recording), dimmed while the take
  goes in.
- **All off** (`silence()`, a key printed in record red; ⇧Esc from anywhere): input monitoring off, the ui event
  `'silence'`, then `engine.silence()` (see the engine). Every panic path in the studio comes here.
- **Back to the lanes (n held)** appears on the bar while any lane in the song is held, and gives every held lane
  back in one `auto.set` dispatch.

### Lanes in the arranger (`ui/lanes.js`, `app.arranger`)

**A track's header** shows its instrument as a button, `.ar-hinst` (its swatch, its name and an open glyph, in both
views): a click on the name selects the track and opens the instrument big (`app.plugin.open({ track, slot:
'instrument' })`, placed so it doesn't cover the track's lane); a held instrument opens the Devices tab instead. The
full studio keeps the devices button `.ar-hdev` beside it. **Sounds** (`.ar-hsounds`) opens the sound card for that
track: on the selected track, on a hovered or focused header (by CSS, its space always reserved), and *pending* on a
new track until the card has been opened on it once. During a trial the header names the sound being tried ("Light
Table, trying"). **Where R goes** is drawn in both views: the aimed track's R is lit (the simple view's is a lamp, not a
button), and while the aim is a new track (Sketch open, a count-in or a take, or the card previewing a new track) a
**ghost lane** at the foot reads "A new track, Lamp Tines": one row, no clips, a dashed hairline, nothing to select.

A track's open lanes are rows under it (40 px, 48 on phones), one per param, in one layout (`rows()`) that drawing,
hit-testing, the headers, `locate()` and presence read. Which lanes show is session state (`ui.state.lanes`); the
lanes themselves are the song's, and they play shown or hidden. E (or a header's A key) toggles the selected track's
lanes; with none, it opens Level. The track menu's **Automation…** lists the lanes and has **Add a lane…** (Level, Pan,
then each device's knobs: `laneParams(app, p, t)`, params with `auto: false` left out) and **Lanes follow clips** (on by
default, `localStorage overdub:arrange`: moving, Alt-copying or duplicating clips carries the lanes under them, via
`core/arrangement.js` `followClips`). Every gesture is one `auto.write` by you, one undo step: click adds a point (on
the line, the line's value), drag moves it (⇧: fine, no snap), dragging the line moves both ends, ⌥-drag bends it
(⌥-double-click: straight), double-click deletes, a drag over empty lane selects; **Draw** on the header (or ⌘ held)
paints freehand, thinned on release; the lane menu shapes the selected bars (or the bar under it) with `SHAPES`
(Ramp up, Ramp down, Swell, Dip, Hold here, Pulse; `core/automation.js` `shapePoints`; a ramp goes where the lane
is going and holds there, `rampPlan`), Simplify (`thin`), Clear, Hide; a shape that changes nothing says so in a
toast; a point's menu sets its curve (Straight, Ease in, Ease out, Step). Keys with the lanes focused: ←/→ the
previous / next point, ↑/↓ its value, Delete.

```js
app.arranger.showLane(trackId, { insert?, param })   // open that lane and scroll to it → { key, track, insert, param } | null
app.arranger.toggleLanes(trackId, on?) ; app.arranger.hideLane(trackId, { insert?, param })
app.arranger.laneRows() → [{ key, track, insert, param, y, h, top, bottom, mid }]   // on screen (client px)
app.arranger.laneY(key, value) → clientY ; app.arranger.laneSel() → { key, from, to } | null
app.arranger.selectLaneRange(trackId, addr, from, to) ; app.arranger.laneShape(trackId, addr, shape, from, to)
app.arranger.shapes() → [{ id, label }] ; app.arranger.lanesFollow(on?) → boolean
app.arranger.recLanes([{ track, insert?, param, from, to }] | null)   // lanes drawn as being written (record ink)
app.arranger.takes(clipId) → { k, n, track, takes: [{ clip, name, playing, hidden }] } | null
app.arranger.useTake(clipId) ; stepTake(±1) ; flattenTakes(clipId) ; deleteTake(clipId)
app.arranger.clipLabel(clipId) → byline text | 'muted' | 'kept off' | null   // what its label line printed last draw
```

`insert` is an insert id or `'instrument'`, absent for the mixer's `'gain'` and `'pan'`. While R records, the arranger
also reads `app.input.autorec.writes()` and `touching()` and draws those stretches in record ink.

**Knobs and faders follow their lanes.** A device knob (`ui/rack.js` through `ui/faces.js`), a mixer fader or pan
with a lane turns by itself and is marked *auto*; turning it by hand holds the lane (`[set, auto.set { off: true }]`
in one dispatch) and marks it *held*, with a toast the first time ("Cutoff is held at 2.4 kHz. Its lane is off until
you bring it back.") and **Back to the lane**. A control's menu (right-click, a long press, the menu key):
**Automate** (`app.arranger.showLane`), then **Back to the lane** when held or **Hold it here** when not.
Presets (`def.presets`, `docs/DEVICES.md`): the rack shows a **Preset** line under a device's caption that names the
preset its params are exactly (`presetOf` in the registry, which `get_project` also tells agents), "Felt, edited"
after a knob moves off it, else "Custom"; picking one is one `instrument.set` (or `insert.set`) with all its params.

### Tokens (`app/style/tokens.css`; names fixed, values are the brand's)

`--bg --bg-2 --bg-3 --panel --line --line-2 --text --text-2 --text-3 --accent --accent-2 --human --agent --ok --warn
--bad --rec --font-ui --font-display --font-mono --r-1 --r-2 --r-3 --shadow-1 --shadow-2` and track colours
`--c-1 … --c-8`, plus (Liner notes) `--rule --rule-2 --rule-heavy --r-press --paper --ink --ink-2 --ink-3 --ink-human
--ink-agent --paper-rule`. `--human` (warm) marks what a person did; `--agent` (cool) marks what an agent did. The
shared classes built on them (`.btn`, `.tog`, `.ledger`, `.sheet-head`, `.by`, …) are in `app/style/app.css` and
`design/LINER-NOTES-KIT.md`.

## Capture and bringing material in

`app.input` (`input/index.js`) = `{ pitch, audio, hum, tap, midi, qwerty, capture, recorder, autorec }`.

- **Recording into the song** (`input/recorder.js`, `app.input.recorder`; the spec is
  `docs/research/RECORDING-UX.md` 3.2-3.17). One Record for every source: R (the transport's key and button) calls
  `recorder.toggle()`: idle → `record()`, count → `cancel()`, rec → punch out (`stop({ keepPlaying: true })`); Space
  while recording stops and keeps the take, and so do the killswitch, a seek, a tempo/meter/loop change and a hidden
  tab. `record()` plays from the playhead with the engine's count-in (`engine.play(from, { countIn: { beats, preroll:
  true } })`, `recorder.countIn` bars, default 1, `localStorage overdub:record`) and sets `engine.recording`; R while
  playing is a quantized launch: recording starts at the first bar line with the count-in's bars to come in on (a
  whole bar less a sixteenth for 1; the loop's start after its end; in a loop of 2 bars or less, its top, so a 2-bar
  beat lands as played, not its second bar then its first), the wait counted as `'count'` (the bright numerals count
  only its last bar; `record({ quantize: false })` punches in now). A take onto the blank sheet says so there
  ("Counting in.", "Recording.") in place of its ways in. Every event is placed on the engine's unwrapped grid (`engine.gridBeat`,
  moved to the event's `timeStamp` with `engine.beatAt`), so loop passes never lose or reorder a note; a note in the
  count-in's last eighth is the downbeat, earlier ones and notes before the loop stay in capture only (the loop is
  the punch range). `capture.passOf(grid, span)` maps the grid to (pass, song beat).
  - **The aim** (`recorder.aim(kind)` → `{ track | null, why }`, `recorder.setAim(kind, id | 'new' | null)`,
    `recorder.on('aim')`; docs/INSTRUMENTS-UX.md 1.1): each kind of take (`hum`, `keys`, `pads`, `audio`) has a track
    it goes onto, or a new track. Session state, never the song: the person's pick in **Onto** (`'new'` is one-shot:
    its commit spends it, and the next take of that kind follows the track it made as the last take's), the last take of that kind, and the
    selection when it is newer than that take. **Targets** (`recorder.targetFor(kind)`, also `input.target()`) read
    it. In the simple view: the pick, the selected track if newer and it fits, the last take's track, for pads the
    song's only drum track, else a new track. In the full studio the armed track still comes first (the pick, then an
    armed track that fits, then the selected one that fits, else a new track; arming by hand clears the pick, and
    "A new track" in Onto disarms), and nothing falls back to the first pitched track. A hum never goes onto an unarmed
    drum track. A new track's name and first instrument are `core/sounds.js` `newPartFor(kind)` (Melody, Keys, Drums;
    Lamp Tines or Gobo Kit); the track a take went onto is selected at commit, and the keys' new track is made when the
    keys start, so they're heard where they'll be recorded; Tap it makes its Drums at R (the pads sound on it), and the
    take joins that track's adding in one undo step (`store.dispatch(ops, { join: txnId })`; the first minute's own
    Drums, an empty track added just before, joins too). The mic → the armed audio track, else the selected one. Selecting a track makes it the target (auto-arm;
    the UI may draw it armed without setting `track.arm`); the ● button (`track.arm`) arms on purpose, ⌘ for more.
    `recorder.target` (the armed track, else the one last selected) is the arranger's lit R; where the take really
    lands is `recorder.lands()`: the target, except when R records a hum (`recorder.humming()`: Hum it open or a hum
    going, no audio target), which lands where a hum goes (null: a new track). The top bar's **Onto**, the record
    key's title, the count-in's numeral and `live().track` say `lands()`, and Onto's menu offers `recorder.onto()`.
  - **Sources** are adapters over the existing modules: `input.noteOn/noteOff` (MIDI, musical typing), `tap.hit`
    (quantized on input, forgivingly: `input/timing.js` `snapGentle`, the nearest eighth when within 0.35 of one,
    else the `input.options.grid` cell; raw time kept; with the take's **lean** out: `leanOf`, the one steady offset
    the take shares, its circular mean against the beat on the drums that keep one place in it (kick most, then snare),
    else against the eighth, steadied by the median, none under 0.08 beat; from the fourth hit on, the hits already in
    move with it, previews too), `tap.startBeatbox` and `hum.start({ rec: true })`
    (H while recording; they hand their notes in at their stop, on the grid), and the mic (`audio.openFor(track)`:
    the track's Input from the Inspector, else Sketch's picker; one asset per take, each pass a clip at its offset,
    the measured round trip taken off).
  - **Commit**: `planTake(project, take)` (pure) builds the ops; one `store.dispatch` by `'you'` (one undo step).
    Layer (drum tracks; `recorder.setMode(track, 'layer' | 'take')` changes it, Sketch's **Each pass**) adds every
    pass's notes into the clip under them (`notes.add`; a hit on one already there is merged, and the summary says
    how many were) and makes clips only where there are none; while it records, each hit is previewed
    (`store.preview`) so the next pass plays it. A miss is replaced, not added: when a pass closes, a hit an earlier
    pass played on the same drum within a third of a beat (as played) of one of this pass's, in another cell, that
    this pass didn't play again, goes, its preview too (`settleMisses`; `live().passes[].replaced` counts them). New take (pitched tracks, hum, audio always) puts the passes in one
    **take folder** over the beats they recorded (`core/arrangement.js` `planTakeFolder`). A pass's beats are
    `passRange(rec, pass, bpb)`: from the bar the take began in (the loop's start after a wrap) to the loop's end when
    it ran round, else to where you stopped (the bar line before the stop, or further when a note was played or still
    rang there), never the rest of the loop; its `from` and `to` are the beats it really recorded, so a punch in from
    a marker or out mid-bar leaves the rest of that bar to what played there. An audio take's folder is the beats its
    playing pass covers (audio can't be filled out); a seek ends the take where it was. Every pass also goes to
    `capture.add` with `{ take, pass, rec: true }`.
    A pass with nothing in it adds nothing. `parts[].notes` and `.bars` in the commit are your own notes and bars.
  - **Take folders** (`core/arrangement.js`): the clips of a track that share a take id (`clip.take`) and cover the
    same beats `[start, end)`. One plays and the others are kept, muted. What played there before is one more entry,
    first, under its own name ("What played" when it was another folder's take; a clip across an edge is cut there,
    only the inside is muted, and a note ringing past the end isn't struck again there); the passes are named "Take
    N" in folder order, so the name, "take N of M" and "M takes" agree, and no two entries share a name. The last
    complete pass plays; a pass cut
    short by the stop (and the first pass of a take begun inside the loop) is filled out with what played there
    before, so picking any take never leaves part of the range silent. Which pass plays is `pickActive(passes)`
    (`input/recorder.js`): the last complete one, but never a fragment (fewer than half the notes of the fullest
    pass) over a fuller one. Before the folder is made, `joinSeams(passes, loop, bpb)` keeps a phrase played over the
    loop's seam in one pass: when the gap across the seam is no longer than the phrase's own (twice its usual
    note-to-note time, at least a beat, at most a bar), its tail moves back to the loop's start in the pass it began
    in (marked `wrap`), or its head on into the next pass. A phrase longer than the loop stays a pass per time round. A folder never holds a piece over other bars or
    an empty leftover. `takeFolders(track)` → `[{ id, clips, start, end, playing }]`, `takeNumber(clip)`.
    `planClipTrim(p, { track, clip, start, end })` is the arranger's edge drags and **Trim to the loop**: trimming a
    folder's playing take gives back what it no longer covers (what played there before plays again; the other takes
    there stay, muted, as a folder of their own). The arranger's take label, its menu and ⌘↑ / ⌘↓ are
    `app.arranger.takes` / `useTake` / `stepTake` / `flattenTakes` / `deleteTake` (above).
    `planDropTrim(p, drops, { keep })` is a dropped clip (the arranger's drag, a move or an Alt-copy): it takes the
    beats it covers on its track, as in Live. What lies under it there is cut away (kept on either side, gone when
    covered whole; muted clips too, so nothing waits under it to play later), planned from the song before the drop
    and dispatched with the move, one undo step. A take folder under it is cut across all its takes, as Split cuts one:
    the part before keeps the folder, the part after is a folder of its own, a part left with one clip is an ordinary
    clip; so every folder is still one range with one take playing in each stretch. A take folder moves whole (a drag
    of any of its clips takes every take along); on a comped folder a drag across the body selects bars (a piece of a
    comp isn't a clip of its own) and its label line moves the folder.
  - **The lean at the stop** (`relean`, `input/timing.js` `placeTake`): every note the forgiving grid placed (pads,
    beatbox, a hum against the click) is placed again with the whole take's lean out, and a drum's nervous first hits
    (in its first two beats, before any lands on a beat, 0.25 to 0.5 beat late, on a drum otherwise on the beat) go
    on their beats. The commit says it (`leanWords`: "You played about 150 ms behind the click, so your hits are on
    their beats; As played puts them back.") and returns `res.lean` ({ beats, ms, by, moved, opening, words });
    `retime('loose')` blends from where each was played less the lean.
  - **Capture takes** (Sketch on Tap it or Hum it): Hum it's big button is R (the strip's Record button stands down
    in Hum it: one record button). The click a take hears is the
    transport's click for takes (`recorder.captureClick`, `setCaptureClick`; Sketch's beat band shows it as a lamp).
    With it off altogether, over a song with nothing in it and nothing playing (`recorder.wouldBeFree()`), a take is
    **free** (`recorder.free`): no transport and no count; the pads keep their own take (each hit's time) and the hum
    its own (`hum.start({ free: true })`); at the stop the pulse is found in what was played (`input/timing.js`
    `fitHits`, `fitSegs`: the tatum whose lattice fits every onset, counted with the tempo followed as it drifts, the
    first onset the downbeat; a hum's count is the best of a few readings, the one whose notes sit nearest where they
    were sung with a sixteenth costing 40 ms, since 60 ms of slop on an eighth pair reads as 75 BPM in sixteenths) and the take goes in on its own track by `capture.keep(id, { tempo, join })`, the song
    taking the tempo played when it had nothing in it: one undo step. Every take from there keeps its timing
    (`recorder.timing`, `recorder.retime('tight' | 'loose' | 'played')`: a `notes.set` by you, one undo step each).
  - **Hum into the take.** In Hum it (Sketch on its Hum mode), `record()` also starts the mic as a hum
    (`hum.start({ rec: true })`, count-in and all), its notes placed gently (`transcribe(..., { gentle: true })`) and
    each one's as-sung beat kept (`tr`); one sung in the count-in keeps its place before the take (`clampStart: false`)
    and stays in capture, never on beat 1; a hum already going when R starts (H, then R) joins the take
    (`hum.join()`). A blocked mic says so and the take records keys and pads without it. A hummed note moved into the
    song's key reaches the take with what it was sung as (`addNotes`' `was`); the commit finds those notes in the song
    (`res.sung`: how many, and the `notes.set` ops that put them back), and `hum.js` says it as it does for a hum on
    its own ("Moved 2 notes into A minor, the song's key."), its Undo those ops, one step of its own.
  - **Put it in the song** (`recorder.capture(id?)`, ⇧R, a Sketch take card's first action): a captured phrase onto
    its target at the beats it was played on, or at the marker's bar when it was played in free time.
  - **Automation while recording** (`input/autorec.js`, `app.input.autorec`; `docs/research/AUTOMATION.md` 3.9).
    There is no automation arm. autorec sits in front of `store.dispatch` and reads the coalesce keys controls
    dispatch with (`'insert:<id>:<key>'`, `'instrument:<track>:<key>'`, `'track:<id>:gain|pan'`, `'master:gain'`).
    While the recorder is in `'rec'`, a held control writes its lane from the audible beat of the first move (on the
    take's grid) until it lets go, then a 200 ms glide back to the lane (`GLIDE_S`), replacing only the touched span
    (Touch), thinned to 0.5% of travel (`THIN`); the dispatch returns `{ ok: true, recorded: true }` and the history
    doesn't change; the lanes written so far are previews, so the next pass plays them. At commit
    `autorec.finish(take)` hands the recorder its `auto.write`s, dispatched with the take (one undo step); `⌘Z` during
    the take (`recorder.undoPass()`) takes that pass's moves out too (`autorec.undoPass(n)`). While the song just
    plays, a finished gesture offers **Write it into the lane** (a toast: "Cutoff moved from 400 Hz to 6.2 kHz over
    bars 9–11. It stays where you left it."), which writes it as a recording would; `autorec.moves` (the last 8),
    `autorec.keep(id?)`. Also `autorec.recording`, `touching()` → `[{ track, insert?, param, value }]`, `writes()`.
    Pure: `planMove(...)`, `gestureOf(ops, opts)`.
  - **For the UI** (`recorder.live()`): `{ state, take, track, tracks, from, now, pass, loop, counting, passes: [{ n,
    track, mode, notes, raw }], held, peaks, trace }`; events `recorder.on('state' | 'pass' | 'note' | 'commit')` and
    `app.input` `'record'`. The agent's view is `get_recording`; while a take runs, tools that edit its tracks or the
    timeline are refused with `{ error: 'recording' }` (`agent/tools.js`).

- **Capture is always on** (`input/capture.js`): every note played on MIDI or the computer keys is kept and split into
  phrases by silence, and every hum, tap, beatbox and audio take lands there too (in memory and IndexedDB
  `overdub-capture`). `capture.keep(id)` turns one into a clip by `'you'`; the agent's `get_capture` reads `latest()`.
- **Hum** (`input/hum.js`, `input/pitch.js`): pYIN frames and a Viterbi path, then the note tracker; `transcribe`
  snaps to the grid and the key and reports what it moved. A hum with nothing playing is counted on its own pulse
  (`fitSegs`), its tempo the hummer's; `hum.live()` is the notes so far on the take's grid (Sketch draws them as sung). `tools/hum-bench.js` scores it on synthesized phrases whose
  notes are known.
- **Musical typing and the touch keys** (`input/qwerty.js`, Sketch's Play it on a touch screen): two helpers, on until
  turned off and kept in this browser (`localStorage overdub:qwerty`): the grid (`qwerty.quantize`, onto
  `input.options.grid`, in a take with R as it records) and Scale lock (`qwerty.scaleLock`, the song's key; with no
  key, C major). The line over the keys says what they do, "Snapping to 1/16, in C minor", each part a click that turns
  its helper off ("Your timing", "every note") and on: `qwerty.snapLine({ touch })`, its words `snapWords(...)` (pure).
  A MIDI keyboard's notes are never moved.
- **Latency** (`input/latency.js`): tap along to eight clicks, or a loopback, once per input device; takes, hums and
  beatbox are shifted by the measured round trip.
- **Audio inputs** (`input/audioin.js`): an interface opens with all its channels (`channelCount` up to what the
  device reports) and the chosen input is split off (`state.channels`, `state.channel` '1'…'32', 'both', 'stereo'); a
  channel the device doesn't have is silence, never input 1. A `devicechange` emits `app.input` `'devices'` and ui
  `'input:devices'` (the Inspector and Sketch re-read the list without a reload).
- **Files in** (`input/importers.js`, `app.importers`): a Standard MIDI File (types 0 and 1; running status, note-on at
  velocity 0, the first tempo of a tempo map, time and key signatures, markers, track names, program changes) dropped
  anywhere or from Song menu → Import MIDI… becomes a track per part (type 0 split by channel; channel 10 →
  `core.drums`, a GM program → its family's built-in), one clip each, in one undo step by `'you'`; into a song with no
  clips it also takes the file's tempo, meter, key, name and markers (as sections), otherwise it keeps the song's
  tempo and says so. An audio file dropped on the arranger is decoded (`decodeAudioData`), stored with
  `engine.assets.put`, and becomes `asset.add` + an audio clip at the drop point (on that audio track, or a new one),
  one undo step. Song menu → Import audio… does the same without a drag (the keyboard's and a phone's way in): onto the
  selected audio track (or a new one under the selected track), from the playhead's bar. `app.arranger.locate(x, y)`
  says where a point lands in the lanes.
- **The reference track** (`ui/reference.js`, the bottom "Reference" tab, `app.reference`): a finished song dropped
  there is measured once (`measure()` → `project.reference.profile`, via `reference.set`) and kept beside the song:
  not a track, not in the mix, a render or an export. Its profile is drawn beside the mix's; A/B plays it on its own
  source straight to the speakers (the mix's monitor feed is crossfaded against it), turned to the mix's integrated
  LUFS.

## The agent layer

`agent/tools.js` exports `TOOLS = [{ name, annotations, description, input_schema, run(input, ctx) → result }]`, one
catalog for the in-app agent (`agent/claude.js`, the Messages API with tool use and streaming, through a self-hoster's key on the local server, or
Claude Code on this computer; `agent/mock.js` is the
scripted demo agent) and outside agents (MCP via `server/mcp.js` → `server/bridge.js` → the page's `agent/bridge.js`,
or claude.ai via `server/relay.js` → `agent/remote.js`). `app.tools.run(name, input, { by })` never throws: errors
come back as `{ error, hint }`. Results are JSON; a tool may also return `{ image: dataURL }`. Every call emits ui
`agent:tool` so the panel shows outside agents' activity as well as Claude's.

AGENTS.md documents each tool in the catalog; by job:

| job | tools |
|---|---|
| read | `get_project`, `get_guide`, `get_selection`, `get_history`, `list_devices`, `get_device`, `get_capture`, `get_recording`, `provenance_report`, `find_grooves`, `get_jam`, `tab_for` |
| change | `apply_ops`, `define_device`, `adjust`, `transform`, `arrange_around`, `arrange_song`, `use_groove`, `drum_track`, `make_jam_track`, `set_tone`, `write_tab`, `suggest_riff` |
| listen | `render_and_measure`, `compare_to_reference`, `play`, `stop` |
| talk and point | `highlight`, `show_device`, `show_on_fretboard`, `say`, `ask_human`, `propose_variations`, `suggest_sounds`, `get_variation_result`, `share_link`, `find_community_device` (searches the community shelf; `put_on` raises a card, never a change) |
| take back | `undo`, `revert_my_changes` |

- **The catalog without a tab.** Some tools are registered by page modules at boot (`installTools(app).register(def)`):
  `transform` (`agent/transforms-tool.js`), `arrange_around` (`agent/arrange-tool.js`), `arrange_song`
  (`agent/arrangement-tool.js`), `compare_to_reference` (`ui/reference.js`), `show_device` (`ui/plugin.js`),
  `find_grooves`, `use_groove` and `drum_track` (`agent/grooves-tool.js`, installed by `ui/grooves.js`), `get_jam`,
  `make_jam_track`, `set_tone` and `show_on_fretboard` (`ui/jam.js`), `tab_for`, `write_tab` and `suggest_riff`
  (`agent/tabs-tool.js`, installed by `ui/tabs.js`), `suggest_sounds` (`agent/sounds-tool.js`), `share_link`
  (`ui/share.js`), `find_community_device` (`agent/community-tool.js`, installed by `ui/community.js`) and
  `provenance_report` (`ui/provenance.js`). Their schemas live in `agent/extra-schemas.js` (no DOM), and
  `catalogSchemas()` lists them with the static ones, so `server/mcp.js` and `server/bridge.js` list them all before a
  studio tab connects. `tools/relay-catalog.js` writes the same list to `server/relay-catalog.json`, which is all the
  relay ever lists, tab or no tab (`relay-test` checks it is current). `register()` emits ui `agent:tools` and the
  local bridge says hello again; `mcp.js` advertises `tools.listChanged` and sends
  `notifications/tools/list_changed` when the tab's catalog differs from the one it listed.
- **Annotations.** Every tool has MCP annotations beside its name, in `TOOLS` or in its `extra-schemas.js` schema:
  `{ title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint }` (the comment above `TOOLS` says how each is
  decided; REMOTE-MCP.md, "Annotations", lists them). `schemas()` and `catalogSchemas()` carry them, so the bridge,
  `mcp.js` (which also puts the title at the top of each tool in `tools/list`) and `server/relay-catalog.json` do too;
  `agent/claude.js` sends the Messages API only `name`, `description` and `input_schema`. `annotationGaps()` names any
  tool without them and where to add them: `tools/relay-catalog.js` won't write a catalog with one, and agent-test
  checks the Node catalog and the tab's.
- **A song from a link** (`agent/keep.js`, AJ's call in docs/SECURITY.md). While `app.share.listening` (a song opened
  from someone else's link, until Make it yours, Back to my song or another song), the store's guard holds any change
  by a caller other than `'you'` that takes something away: a deletion (a track, a clip, notes, a section, bars, an
  insert, a lane or its points, a device, a recording, the reference), a rewrite of what's there (`notes.replace`,
  `notes.set` on notes that were there, an automation write that takes out points, a new instrument in place of one, a
  loop that drops notes past a clip's end) or new code (`device.define`). `takenBy` reads it on a copy of the song, op by
  op, from each inverse; what the same call made first is the call's own. `runTool` gives each call by anyone but the
  person an app whose store reports back what its dispatches landed and what was held, so concurrent calls never mix;
  when something was held, what the call landed is taken back out (`undo({ id, redo: false })`) and the whole call
  becomes one take on a card (a `variations` request with `keep`, the take first, the original as "Keep as it was").
  The agent gets `{ offered: true, id, status: 'pending', what, note, targets }`; `get_variation_result` gives
  `kept: true | false` once they choose. Keep dispatches the take `kept: true`, signed by the agent (History adds "kept
  by you"); a take with a new device runs the device check first (its code isn't checked, trusted, registered or
  auditioned before Keep). A card for a song that closed is cancelled. Adds, mix moves, renames, moves, splits, copies
  and tempo go straight through; so does everything after Make it yours. `arrange_song` dispatches its plan's
  primitives with `as: [the arrangement op]`, so a split or bars put in read as what they are.
- **The prompt** (`agent/prompt.js`): `ETIQUETTE` (the rules of the room, also `get_guide "etiquette"` and the MCP
  server's `instructions`), the voice, `NOTES_BRIEF` (notes text, drum grids, time) and one line each pointing at the
  rest. Every API call re-reads the system prompt, so what only some requests need stays a `get_guide` topic away:
  the kernel guide (`kernel/guide.js`, topic `devices`), `OPS_CHEATSHEET` + `NOTES_FORMAT` (`ops`), the lexicon
  (`lexicon`) and the transforms' params (`transforms`); `tools/agent-test.js` caps the prompt's size and the
  catalog's. The in-app agent gets `IN_APP_DESCRIPTIONS` (`agent/tools.js`) in place of a few catalog descriptions
  that would repeat its prompt. The system prompt is frozen per conversation (prompt caching); the live context
  travels in each user message.
- **Plumbing.** `app.agent` (the in-app client: `send`, `stop`, `useMock`, `useLocal`, `setModel`, `on`), `app.bridge` (MCP connection
  state), `app.remote` (the Connect tab); ui events `agent:compose { text, attach, send? }`, `agent:tool`, `agent:say`,
  `agent:request`, `agent:tools`, `edit-clip { track, clip }`, `focus`, `presence`, `presence:status`, `bridge:state`,
  `remote:state`.
- **Presence.** `app.presence` (`agent/presence.js`) keeps `ui.state.presence = [{ id, by, track?, clip?, notes?,
  range?, insert?, note, until }]` and emits `ui.emit('presence', list)`. The arranger, piano roll, rack and mixer draw
  each target with a glowing `var(--agent)` outline and the note as a small label. Every agent edit also *flashes*:
  panels listen to store `change` events where `store.isAgent(evt.by)` and briefly glow what the ops touched.
- **The lexicon** (`agent/lexicon.js`): words → perceptual axes → param moves, for `adjust`, and `READINGS` for the
  words people disagree on (warm, fat, tight). The first time, `adjust` shows two audible readings as A/B cards and
  the pick is kept in `agent/lexicon-personal.js` (localStorage `overdub:lexicon-personal`; Agent settings › Your
  words); later calls use it and say so. Outside agents read it through `get_guide "lexicon"` (`personal`).
- **Transforms and infill** (`core/transforms.js`): pure, seeded functions over notes (humanize, quantize, strum,
  arpeggiate, legato, staccato, transpose in key, invert, retrograde, double, thin, ornament, chords_from_melody,
  melody_from_chords, continue, fill_the_gap). `planTransform` turns a result into `notes.*` ops (plus `clip.set` when it
  runs past the clip); `runTransform(store, …)` dispatches them as one undo step. The piano roll's Transform menu and
  the inspector's quick buttons run them by `'you'`; the `transform` tool runs them by the agent, or returns
  `variations` for `propose_variations` when it would rewrite a person's notes.
- **Arrangement edits.** The arranger runs the arrangement ops above by `'you'` (the section menu: Duplicate ⌘D,
  Insert bars after, Delete these bars; the clip menu and the inspector: Repeat, Split at playhead, ⌘E) and the
  `arrange_song` tool by the agent, one undo step each.
- **Build a band around it** (`core/arrange.js`): a pure, seeded arranger. `arrangeAround({ notes, start, length, key,
  meter, style, parts, seed })` reads the seed (a melody, a chord part or a beat) and returns chords (a Viterbi pass
  over diatonic chords per strong beat: nothing a semitone from the seed on a strong beat), a bass on each chord's root
  at the changes that rides the kick, a groove from the style's grid (a fill every 4th bar) and an optional pad, in
  five styles (pop, rock, lofi, house, ballad); `planArrangement(project, …)` turns it into `track.add` + `clip.add` ops
  (new tracks only; the seed is never touched). `agent/arrange-tool.js` (`app.band`) measures the faders first (each
  stem rendered in a scratch copy of the song through `engine/render.js`) so the seed leads, then dispatches one undo
  step: by `'overdub'` from Sketch's Band button on a kept take or ⇧B on a selected clip, by the agent from the
  `arrange_around` tool.
- **The groove library** (`core/grooves.js`, design note `docs/research/GROOVES.md`): drum grooves in a text format
  agents can write, a style file per family in `core/grooves/` (style lines: tempo, feel, swing, lay, human, accent,
  kit; then grooves: `<part> <Name> <N> bars` and a row of cells per piece, a group of cells per beat), in General MIDI.
  `realize(groove, { tempo, seed, human, length, offset })` plays one as a drummer would: swing by tempo, the hand's
  accents, lay in ms at the song's tempo, and seeded humanising (a correlated timing drift plus a little spread per
  hit; no `Math.random`). `matchTaps(taps)` is tap-to-find (`tempoFromTaps` reads the tempo; kick and snare first,
  every piece second, every cyclic shift, at the tempo and its half, double, 2/3, 3/4 and 4/5 readings, weighed by
  each groove's tempo range); `planPut` puts one groove at a bar (the person's way cuts what's under it with
  `planDropTrim`, the agents' refuses), `planDrumTrack` is the song creator (one clip per section, a fill before each
  change, a crash on each new section, the ending; a new track, on Studio A (`core.drumroom`) with the style's preset and its `art` articulations when it is registered, else Gobo Kit, all General MIDI). The Grooves tab
  (`ui/grooves.js`, `app.grooves`) hears a groove through `store.preview` (a soloed "Hearing" track, or in place of the
  song's drums) and the tools are `find_grooves`, `use_groove` and `drum_track`.
- **The reference, for agents.** `compare_to_reference` renders the song or a range/tracks and reports deltas against
  `project.reference.profile` with the `render_and_measure` glosses.

**The local bridge** (`server/bridge.js`, `/bridge/*` on the local server):

```
page  -> POST /bridge/hello  { page, tools, title }        announce a studio tab (and its tool catalog)
page  <- GET  /bridge/events?page=…  (SSE)                  { type: 'call', id, tool, input, agent } | { type: 'agent', agent, state }
page  -> POST /bridge/result { id, result | error }         answer a call
agent -> POST /bridge/call   { tool, input, agent, turn?, page? }   waits for the page; -> { result } | { error, hint }
agent -> POST /bridge/agent  { agent, state: 'join' | 'leave' }   presence
any   -> GET  /bridge/tools  -> { tools, source: 'page' | 'catalog' }
any   -> GET  /bridge/status -> { pages, agents, root, url }
```

It listens on 127.0.0.1 only and refuses a request carrying another site's browser `Origin`, a Host that isn't a
loopback name (DNS rebinding), or a browser's `Sec-Fetch-Site` other than `same-origin` or `none` (a subresource GET
from another site carries no Origin). An event stream opens only for a page that said hello first, call ids are
random, and a body is at most 8 MB. Results that carry the song's own text lead with a note (`about`) that it is the
song's content, never instructions (`server/relay.js` sends the same). The local file server (`server/serve.js`)
answers only requests made to localhost or an IP, sends no CORS header, and serves nothing under a dot name (`.git`,
`tools/.out`). On the public site the page's bridge stays quiet. `server/mcp.js` (stdio, JSON-RPC 2.0)
starts the local server itself if none is running, opens the studio in the default browser on the first call when no
tab is connected, and names the agent `mcp:<clientInfo.name>`.

**Claude Code behind the panel** (`server/local-claude.js`, `/local/*` on the local server, the same guards as the
bridge): `GET /local/status` says whether `claude` is on the PATH; `POST /local/turn { page, text, model, system,
session? }` runs `claude -p` once per turn and streams its stream-json events back as NDJSON, after a first line
`{ type: 'turn', token }`. It runs with no built-in tools (`--tools ""`), no settings, only the overdub MCP server
(`--strict-mcp-config`) and without `ANTHROPIC_API_KEY`, so it is on the person's Claude plan. That `mcp.js` carries
the token and the page id on each `/bridge/call`; the bridge sends it to that tab only, and the tab
(`agent/bridge.js` → `app.agent.localCall`) runs it signed `claude` only while that token is its running turn's.
`agent/claude.js` is the page side (provider `'local'`): Stop closes the request and the process goes with it, and
the session id is kept per song (`overdub:agent:local-session:<id>`) and resumed. `POST /local/messages` is a
self-hoster's own API key (provider `'claude'`): the server holds `OVERDUB_ANTHROPIC_KEY` (never `ANTHROPIC_API_KEY`
from the shell), adds it and the API version to the page's Messages API request, and streams the answer back;
`/local/status` says `key: true` when one is set, never the key. The page keeps no key: `overdub:anthropic-key`, the
old in-browser key, is deleted on load and noted once (`overdub:agent:key-retired`). The public site has no `/local/`.

**Claude on Overdub credits** (provider `'cloud'`; built, not switched on): Claude run by Overdub's own service and
paid for with credits, for people without a Claude of their own. It's off unless the deploy names the service in
`app/site-config.json` (gitignored; `app/src/site-config.js` reads it once per load, `server/serve.js` answers it from
`OVERDUB_CLOUD_ORIGIN` when there's no file, `deploy/deploy.sh` ships `deploy/site-config.json` or `{}`); `?cloud=`
points a local studio at a local service only. No prices live here: the rate card, plans and packs come from the
service's `GET /v1/config`.

- `agent/cloud.js` (`app.agent.cloud`) is the account: the sign-in (an email link, or its 6-digit code in a tab the
  link wasn't opened in; the tab polls `/v1/me` while it waits), the balance, top up, credits back, where the credits
  went, deleting the account. Every request is `credentials: 'include'`; the session is an httpOnly cookie on the
  service's origin. `canonicalBundle` and `bundleVersion` give the prompt bundle's version, the same on both sides.
- `agent/claude.js` decides the provider in this order: the demo agent if it's on, Claude Code if chosen, a server
  key, then credits only if the person chose them (`overdub:agent-provider`). An ask on credits is
  `POST /v1/agent/actions { kind, moreTime, promptVersion }` (one `Idempotency-Key` per Send), then one
  `…/calls` per step of the tool loop (the first sends a text-only recap of the last two exchanges and the opening
  message, each later one only `{ toolResults }`; the service holds the conversation and builds the request), then
  `…/finish { outcome, cardPending, deviceWritten }`. The tools run in the page, signed `claude`; a `…/wait`
  heartbeat keeps an ask open while it waits on the person. Only `503 upstream_busy` and a retryable
  `502 upstream_error` (or the same as an error event mid-stream) are retried, twice at most, with the same body.
  The page keeps which History entries each ask made (`overdub:cloud:takes`) and asks for its credits back when all
  of them are undone (or its card is declined, or its device still fails its check) inside the window finish gave.
- **The send gate.** While credits are on, nothing opens an ask until its price was on screen for that exact text:
  `agent.quote(text)` names the kind (`agent/cloud-kind.js classify`, open rules) and its price from the rate card,
  the panel shows it beside Send ("A new part · N credits ▾", the ▾ lists the other kinds) and marks it
  `agent.shown(quote)`; `agent.send` with anything else emits `quote` and returns. A suggestion, the tour's ask or a
  move offered in the log lands in the box with its price and needs a second press. A quick move typed as one word
  ("warmer", "make it brighter") or "use <device>" by its exact name (`freeMove`) runs in the page, free, signed
  `you`, and is never sent.
- `agent/cloud-panel.js` draws it in the Agent tab: a row in settings, the sign-in sheet, the balance in the presence
  line, out of credits (Top up and Use your own Claude, the same size), paused, top up, the account.
- `tools/agent-bundle.js` exports the bundle (`{ version, source, system, tools }`) from a running studio for the
  service to import; `tools/cloud-test.js` runs all of this against a fake of the service.

**Remote MCP** ([REMOTE-MCP.md](REMOTE-MCP.md)): `server/relay.js` is the hosted relay for
overdub-relay.ajsmithhq.com. It serves MCP Streamable HTTP at `/s/<token>/mcp` to claude.ai and hands calls to the tab
over `/s/<token>/{hello,events,result}`. The tab side takes the tab's secret in a header (the token in the URL is a
one-way hash of it, so the connector URL alone can't pose as the tab), and `tools/list` is the relay's own catalog
(`server/relay-catalog.json`), never the tab's. `agent/remote.js` (`app.remote`, the right-region "Connect" tab) is
the page side; its calls run with `by: 'claude.ai'` (`kind: 'agent'`, added with `store.addAuthor`). It is live at
overdub-relay.ajsmithhq.com and tested by `tools/relay-test.js`; `RELAY_LIVE` in `agent/remote.js` is on, so every
studio shows the Connect tab (off, it shows only on a local studio with `?relay=` or after `?connect=1`).

## Songs in and out

- **Autosave.** `main.js` saves the song to localStorage (`overdub:project`) half a second after each change; audio
  lives in IndexedDB. `?new` and `?demo=<id>` open another song and keep the saved one as the previous song
  (`overdub:previous`), with an Undo.
- **Share links and the fork** (`core/share.js`, `ui/share.js`, `app.share`): the song rides in the URL hash
  (`/app/#s=…`: JSON `{ f: 'overdub-share/0', at, from: { name?, mark? }, dropped, song }`, deflate-raw, base64url; at
  most 64 KB), so Overdub's servers never see it. Audio clips and assets are left out and counted, and so is the
  reference track. `main.js` decodes a link before the store exists and the studio *listens*: nothing autosaves
  (`app.share.listening`), and an agent's deletions, rewrites and new devices wait on a card for the person's Keep
  ("A song from a link", in the agent layer), until **Make it yours**, which keeps the song with `meta.forkedFrom`. Agents', earlier
  guests' and the house's signatures travel exactly; everything else (the sender's own `'you'`, a part with no
  signature, any other id) becomes the guest author. A device an agent wrote or an earlier guest made keeps its maker
  with `via` naming the guest whose link it came through ("made by Sam, via Jo's link": a song sent back credits
  whoever made it, in the sender's browser too); the sender's own device, and any other claim, is the guest's
  (`claimedBy` keeps the claim). Whatever they're signed, they're code that came in the link: held until the listener
  plays them, unless this browser already trusts that code ("Who runs a song's code"). The first **Share a link** in
  a browser asks whose name the link carries before anything is copied (`overdub:share-name`); after that it copies
  at once, and the sheet's Copy link copies the link signed with the name in its field. A link nested more than 64 deep (`MAX_DEPTH`) or past the growth limits is
  refused with a plain reason. A link you made yourself opens as yours:
  `from.mark` is a hash of this browser's secret (`overdub:me`, never sent), the moment and the song, so it can't be
  moved onto another song. `guardDevices` moves a song's devices off built-in and house-shelf ids to `guest.<slug>` (a
  link) or `you.<slug>` (an opened file), with the tracks that use them; kernels past 256 KB stay out. History and the
  provenance report name a fork's origin.
- **Files out** (`ui/export.js`, the Song menu, `app.exporter`): the mix (24-bit, 48 kHz WAV), stems (one WAV per
  track, zipped, lined up by `probeLatency`), MIDI, DAWproject, the provenance report, the attribution log (JSON:
  every transaction with its author, time, label and ops) and the project file (`.overdub.json`). The mix and the
  stems render held devices as silence and pass-throughs and say so ("Left out: Tin Whistle, kept off on this
  computer."); the attribution log marks them `held`. A project file opened (`loadText`: the Song menu's Open, ⌘O,
  or a file dropped on the studio) emits ui `'song:opened' { from: 'file' }`, so its ask says "This file brings".
- **DAWproject** (`core/dawproject.js`): tempo and meter, tracks with their mixer settings, note clips, audio clips
  (their recordings embedded as WAV), sections as markers. Overdub's devices can't travel, so each is a placeholder
  device with its name, id and parameter values. Pure; `ui/export.js` zips it.
- **The provenance report** (`ui/provenance.js`, `app.provenance`): who wrote what share of the notes (by count and by
  sounding time, per author and per track), recorded audio by author, the devices agents wrote with their requests and
  check reports, this session's edits as runs by author, and where the song was forked from. `provenanceModel` and
  `provenanceHtml` are pure (a scriptless page with a strict CSP); it opens as a blob in a new tab. It is a record,
  not a legal opinion, and says so. A held device is listed as kept off and never checked for it.
- **Analytics** (`app/src/analytics.js`, `site/assets/analytics.js`): on overdubstudio.com only, and not under Do
  Not Track or Global Privacy Control, one GET of `e.gif` per counted event, with one word from a fixed list. No
  cookies, ids or storage; never the song. AGENTS.md ("Privacy") lists the events; `tools/analytics-test.js` holds
  the copy to the code.

## Boot and the app object

`app/src/main.js` migrates the first evening's `earworm:*` keys once, imports the device libraries
(`devices/builtin/`, `devices/guitar/`, `devices/library/`), sets up the trusted set (`devices/trust.js`; the first run
of this version trusts the kept songs' devices, once), decodes a share link if there is one, creates the store
(the link's song, `?new`, `?demo`, the saved song, or the demo), the engine (a silent stand-in if it fails), the
shell, then starts each module in `MODULES` (each `export default function (app)`) in order; one failing never stops
the rest. Audio starts on the first gesture. URL switches: `?new`, `?demo=<id>`, `?device=<id>`, `?agent=mock`,
`?coach`, `?autostart`, `?view=simple|full`, `#s=…`. Straight after the shell,
`installWorkspace(ui, app)` gives it `ui.workspace`, before any module mounts a panel.

The app object (`window.overdub`): `{ store, engine, ui, devices, music, summarize, version, opened, trust, agent,
tools, input, presence, bridge, remote, share, onboard, devicesIO, importers, reference, band, provenance, exporter,
analytics, plugin, jam, site }` plus the panels that publish an API (`arranger`, `pianoroll`, `drumgrid`, `rack`, `mixer`,
`browser`, `transport`). `app.site` is which site this is (`ui/preview.js` reads `app/site-config.json`; deploy/README.md).

## Testing

`tools/pw.js` opens the studio in Chromium (WebKit and Firefox too, for `compat-test` and `phone-test`) on its own
server on a free port (`open('/app/')`), with fake media and autoplay allowed, so suites run in parallel. The fake mic plays a file
(`open(…, { fakeAudio })`): `tools/fake-wav.js` writes the ones the checks use (a hummed line, a beatbox). Each area
adds `tools/<area>-test.js` that prints `ok`/`FAIL` lines and exits 1 on failure; fail on page errors (`errors` from
`open`). Screenshots go to `tools/.out/`. `node tools/run-all.js` runs every suite (`PAR=3` at a time by default) and
leaves its totals in `tools/.out/run-all.json`, which `tools/pages-test.js` holds the public check count to.
Benchmarks that aren't gates: `tools/perf-check.js`, `tools/hum-bench.js`, OverdubBench (`tools/bench/`, BENCH.md),
and `tools/prod-check.js` against the live site.
