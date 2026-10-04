# Automation: research and spec

*2026-10-01, wave 10b (research). By a research agent of the day run; no product code changed.*

AJ, 09:50, after playing with the Liner notes build: "automations?" Overdub has none today: every knob, fader and pan
in a song holds one value from bar 1 to the end. This document is what the best tools do and what beginners trip on
(section 2), what Overdub should do and why (section 3), and how to build it in two waves (section 4), with the open
questions answered (section 5).

**How to read the evidence.** Same tags as [UX-RESEARCH.md](../UX-RESEARCH.md) and
[RECORDING-UX.md](RECORDING-UX.md): **[manual]** a vendor's manual or help page; **[review]** a reputable review or
tutorial; **[forum]** a user forum; **[code]** read in Overdub's source today (file named); **[inference]** our own
reasoning or practitioner convention. Nobody tested the other products hands-on.

---

## 0. The short version

1. **Lanes live with what they move, in song time.** A lane is a list of points (beat, value, curve) on a track's
   gain or pan, on an instrument param or on an insert's param (and the master's). It is stored *on* that thing
   (`track.auto.gain`, `insert.auto.cutoff`), so deleting a pedal takes its lanes with it and undo puts them back for
   free. No clip envelopes: one value at any moment, one place to look, nothing to rank against anything else.
2. **Lanes follow the music.** Insert or delete bars, duplicate a section, move, copy or repeat a clip in the arranger,
   and the automation under it goes along (Ableton's default, Logic's "Always"). Time is beats, so a tempo change
   keeps a sweep on its bars.
3. **The lane wins, and the knob says so.** An automated knob moves by itself while the song plays and wears "auto".
   Turn it yourself and the lane steps aside (*held*, Ableton's override), the knob says "held", the lane goes dashed,
   and **Back to the lane** is one click there and in the top bar. Every hold is an undoable edit, so what you hear,
   what the agent measures and what you export are the same thing.
4. **Recording is Touch, and there is no automation arm.** While R records, any knob or fader you hold writes into
   its lane; let go and the lane takes over again with a 200 ms glide (Logic's ramp time). While the song just plays,
   a knob move is *kept anyway*, the way Sketch keeps notes: the toast offers **Keep that move** ("Cutoff, 400 Hz to
   6.2 kHz, bars 9–11"). That is Ableton Note's capture, and Overdub's own rule: never lose an idea.
5. **Drawing is the simple thing first.** A lane opens under its track (E, or the track's Automation menu). Click the
   line to add a point, drag to move, Alt-drag a segment to bend it, double-click to delete, drag across empty lane to
   select; **Draw** paints freehand and thins it. Right-click a bar range for Ramp up, Ramp down, Swell, Dip, Hold.
   Touch: tap, drag, hold for the menu. All in the Liner notes look: a track-ink line, square points, reverse-print
   selection, dashed when held, record red while being written, a byline on the lane when an agent wrote it.
6. **The engine plays it block-accurate everywhere, bit-exact where it matters.** Kernels get timed segments in their
   own event queue and evaluate them per 128-frame block inside the shared `KernelCore`, so the worklet and the Node
   renderer produce the same samples *by construction*. Gain and pan ramp linearly between 128-frame control points
   in both renderers. Graph pedals get `set(values, { at })` every 20 ms and glide on their own (they are already
   outside the canonical render).
7. **Agents write lanes with the same ops and get measured.** `apply_ops` gains `auto.write`, `auto.clear`,
   `auto.set` (with a `beat:value` text format like the notes one); `adjust` gains `over` and `shape`, so "open the
   filter over the chorus" is one call that writes a lane and measures the first and last bars of it;
   `render_and_measure` gains a per-bar series so "fade the pad in over bars 1–4" can be checked as four rising
   numbers. No new tool: the public count of 26 stays.
8. **Budget.** Under 1% of a block for 64 automated kernel params; one message per segment; under 2% of the main
   thread for 16 gain and pan lanes; 10,000 points a lane, 50,000 a song, and recordings thinned to tens of points
   per sweep so share links stay small.

---

## 1. What Overdub has today (read in the code)

| Where | What it does now | What automation needs from it |
|---|---|---|
| `core/project.js` **[code]** | `Track { gain, pan, instrument: { device, params }, inserts: [{ id, device, on, params, by }] }`, `master { gain, inserts }`. `normTrack` and `normInsert` **whitelist** their fields. | New `auto` fields on track, instrument, insert, master. The normalisers must carry them, or every load, undo of a removal and `cleanProject` silently drops lanes. |
| `core/ops.js` **[code]** | Every op returns its exact inverse; inverses that would overwrite someone's later edit carry `_expect` (a print) and refuse. Knob drags dispatch `insert.set` / `instrument.set` with `coalesce: 'insert:<id>:<key>'` (one undo step per gesture, `COALESCE_MS` 1500). | Three ops with exact, guarded inverses (3.3). `insert.remove`/`track.remove` already clone the whole object, so lanes stored on it come back with an undo. |
| `core/arrangement.js` **[code]** | `time.insert`, `time.remove`, `section.duplicate`, `clip.repeat`, `clip.split` plan ordinary ops from the song. | The planners also plan `auto.write` for every lane in range (3.11). |
| `engine/strip.js` **[code]** | `Strip.setMix({ gain, pan })` ramps the fader and the two cosine-law pan gains over 20 ms; `applyParams` calls `inst.set(fullParams, { bpm })` when the params' signature changes. | Mixer ramps on a control grid while playing; automated keys left alone by `applyParams`. |
| `kernel/host.js`, `kernel/worklet.js` **[code]** | `inst.set` posts `{ type: 'params', values }` (untimed: applied on arrival). `KernelCore` keeps targets `tgt` and smoothed values `p`; `smoothParams(n)` is a one-pole with a 10 ms time constant per 128-frame block (log params glide in log space). Notes are timed events in a frame-ordered queue. | A timed `auto` event in the same queue, and per-block evaluation inside `KernelCore`. That class is the one the Node renderer runs, so it is bit-exact for free. |
| `devices/graph.js` **[code]** | Graph devices (the 101 pedals and 27 amps, a few built-ins) apply params in their own `set(v, x)`, mostly through `x.to(audioParam, value)` = `setTargetAtTime` at `x.t = max(now, at)` with a 15 ms constant. `inst.set(params, { at })` already threads `at` through. | Control-rate `set(values, { at })` calls; the device glides. The param→AudioParam mapping is the device's secret, so there is no direct AudioParam ramp to schedule. |
| `engine/engine.js`, `engine/schedule.js` **[code]** | A 25 ms tick schedules 120 ms ahead on an unwrapped grid (`u`) with segments for loop wraps; pure `notesIn`/`audioIn` are shared with both renderers; chase on play, seek and wrap; plugin delay compensation holds each track back `comp` samples. | A pure `autoIn` beside them, scheduled through the same path, with the same chase, wrap and compensation. |
| `engine/node/render.js` **[code]** | The canonical render. The fader is one float32 constant per track; pan the same. Graph devices are bypassed with a warning. | Per-sample fader and pan from the same control points; kernels need nothing beyond the events. |
| `ui/arranger.js` **[code]** | One canvas; every track row is `zoom.trackH` tall (`i * TH` everywhere: hit-testing, `locate`, presence, heads). | Rows of different heights (a track plus its open lanes). The biggest UI change. |
| `ui/faces.js`, `ui/rack.js`, `ui/mixer.js` **[code]** | Knobs: drag, wheel, keys; `toPos`/`fromPos` map a value to knob travel (log for `curve: 'log'`). `onParam(key, value, { commit })`. The mixer's fader law (`dbToPos`) is piecewise like a console's. | The knob shows the lane's value, an "auto" or "held" mark, and Back to the lane. The travel functions become the interpolation space, so they move to core. |
| `agent/tools.js`, `agent/lexicon.js` **[code]** | 26 tools. `adjust` resolves a word to param moves on the target's devices, renders before and after, corrects once, and reports what moved. | `adjust { over, shape }` writes a lane instead of a static move and measures its ends. |

Nothing in the song, the renders or the tools has a notion of a value changing over time except notes (and the
per-note bend and mod curves in `kernel/expr.js`).

---

## 2. How the best tools do it

### 2.1 Ableton Live (arrangement automation)

- **Lanes.** Automation Mode (A) shows a control's envelope "on top of" the clips in a track; an expand button
  "moves the envelope into its own automation lane below the clip", and hiding a lane "does not deactivate its
  envelope" **[manual]**.
- **Editing.** Click a segment to add a breakpoint, double-click anywhere to add one, click a breakpoint to delete it,
  drag to move; Shift for fine values; Alt/Option-drag a segment to curve it, Alt-double-click to straighten
  **[manual]**.
- **Draw Mode** (B) draws "steps as wide as the visible grid"; hold Alt/Cmd to draw freehand with the grid shown
  **[manual]**. **Simplify Envelope** "calculates the optimal number of breakpoints ... and removes any unnecessary"
  ones **[manual]**.
- **Shapes** (Live 11 on): sine, triangle, sawtooth, inverse sawtooth and square, plus ramps and an ADSR that "link up
  to the value of the automation before or after the selection", applied to a time selection **[manual]**.
- **Recording.** The Automation Arm button decides "whether or not manual parameter changes will be recorded"; with it
  on, changes during an arrangement recording become automation. With the mouse, "recording stops immediately when
  you let go ... 'touch' behavior"; with a MIDI controller it continues while you adjust and then punches out
  ("latch") **[manual]**.
- **Override.** Changing an automated control while not recording turns its LED off: the automation is
  "*overridden* by the current manual setting", and the **Re-Enable Automation** button lights to "return to the
  automation state as it is written 'on tape'" **[manual]**. This is the classic gotcha: "If your automation suddenly
  stops working, this is almost always why" **[review, forum]**.
- **Clips carry automation.** "Live normally moves all automation with the clip"; **Lock Envelopes** pins it to the
  song position instead **[manual]**. Clip envelopes (per clip, in the clip view) exist alongside, mostly for Session
  clips and modulation **[manual]**.

### 2.2 Logic Pro (track and region automation, modes)

- **Two homes.** Track automation "applies to the entire track"; region automation "is embedded in the individual
  region" and moves with it. If both exist for one parameter, "region automation has priority" **[manual]**.
- **Modes.** Off, Read, Touch, Latch, Write (plus Trim and Relative). Read follows the data and "cannot be changed by
  moving the channel strip controls"; Touch writes while touched and returns to the existing data on release; Latch
  keeps the last value and "replaces any existing automation data after releasing ... in playback"; Write erases as
  the playhead passes **[manual]**. Logic 9's guide calls Off the default "as any mix automation recording may prove
  disconcerting while arranging" **[manual]**; its control-surface guide calls Touch "the most useful mode for
  creating a mix ... comparable to 'riding the faders'" **[manual]**.
- **Settings.** "Move Track Automation with Regions": Never, Always or Ask; a **Ramp Time** "required by a parameter
  to return to its previously recorded setting" (after a Touch release) **[manual]**.

### 2.3 FL Studio (automation clips)

- Right-click any control, **Create automation clip**: the automation becomes its own clip in the Playlist that can be
  moved, stretched, sliced, copied and made unique; with a time range selected it spans that range, otherwise the
  whole song **[manual]**.
- Each segment has a mode (single curve, double curve, hold, stairs, smooth stairs, pulse, wave, half sine, smooth)
  and a tension handle **[manual]**.
- Recorded moves are **event data**, separate from clips; "Edit > Turn into automation clip" converts them
  **[manual]**. Two representations of the same idea is a known source of confusion **[inference]**.

### 2.4 Bitwig Studio (automation, modulators, note expressions)

- A "joker lane" in the arranger "takes on whatever function you want" from the last control you clicked, plus fixed
  lanes **[manual]**.
- Write modes Latch, Touch and Write; moving an automated parameter turns its indicator from blue to green ("the
  automation's control of this parameter has been broken"); **Restore Automation Control** re-engages it **[manual]**.
- **Modulators are not automation.** Automation sets a parameter's position over song time; modulators (LFOs,
  envelopes, expressions) move it around that position, per voice where it makes sense, "within the absolute
  boundaries set by the automation" **[review]**. **Note expressions** put per-note curves (pan, timbre, pressure) on
  the notes themselves **[review]**. Overdub already has the per-note half (bend and mod curves on notes,
  `kernel/expr.js`) **[code]**.

### 2.5 REAPER (envelopes, automation items)

- Every track starts in **Trim/Read**: envelopes play, the on-screen controls don't move, and moving a control offsets
  the whole envelope **[forum: REAPER accessibility wiki]**. Read, Touch, Latch, **Latch Preview** (audition a move
  and write only the value, to a range, when you say so) and Write **[forum]**.
- Point shapes: linear, square, slow start/end, fast start, fast end, Bezier with a tension of −1 to 1 **[forum,
  API docs]**.
- **Automation items** hold a stretch of envelope that can be pooled, looped, stretched and moved like a media item
  **[forum]**.

### 2.6 Pro Tools

- Off, Read, Touch, Latch, Touch/Latch and Write (Trim modifies them in Ultimate) **[review]**. Touch reverts to the
  previous position on release; **AutoMatch** sets how fast it glides back **[review]**. Pro Tools is the console
  model: the modes exist because engineers ride real faders during a mix pass **[inference]**.

### 2.7 The simple versions

- **GarageBand (Mac).** Mix > Show Automation (A); each track header gets an Automation button and a parameter menu
  (volume, pan, effects, Smart Controls). Clicking an empty automation track "adds an automation point at the project
  start position, using the current value"; drag points up, down, left, right **[manual]**. No modes in the UI.
- **BandLab.** A press A to show lanes, pick a parameter from the header's list; add breakpoints by clicking the
  line, copy and paste them; record with a mapped MIDI knob and **Arm Automation Recording** **[manual]**.
- **Soundtrap.** Three automatable things on a track (Volume, Pan, a Sweep filter) plus some effect params; click the
  line to add points, select several to drag or copy, click the icon to show or hide the lane **[manual]**.
- **Suno Studio.** Shift+A for automation view, right-click a knob, Automate; "its knob locks and shows a green
  outline" and shows the effective value while playing; double-click the lane for a point, drag a segment to curve
  it; the guide says to start with volume, "the fastest way to learn the workflow" **[manual]**.
- **Ableton Note (iPhone).** No arm, no lanes to open: press Play and move a knob, "a dotted line ... will appear to
  represent the automation curve"; tap **Add** to keep it; automated knobs show a dot; move again and Add again to
  replace **[review, manual via search]**.

### 2.8 What beginners find hard, and what makes it easy

| Hard | Seen where | What helps |
|---|---|---|
| "My automation stopped working" (an override nobody noticed) | Ableton, Bitwig **[manual, forum]** | Say it where it happened: the knob, the lane and one global Back to the lane. Never a silent state |
| Modes before you have done anything (Read/Touch/Latch/Write/Trim) | Logic, Pro Tools, REAPER **[manual]** | One behaviour, Touch, chosen for you (Ableton's mouse behaviour) |
| Arming, then forgetting to disarm, then wiping a mix | Logic's reason for Off by default **[manual]** | Write only while R records; otherwise keep the move and *offer* it (Ableton Note) |
| Two homes for automation (clip vs track, event data vs clips) and precedence | Logic, FL, Ableton **[manual]** | One home |
| A lane that doesn't follow the clip you moved | Logic "Never" setting **[manual]** | Follow by default |
| Hundreds of recorded points | everyone | Thin on record (Simplify) |
| Finding the lane for an effect param | all lane UIs | Open the lane *from the knob* (right-click, Automate, as Suno and FL do), not from a menu of 40 names |
| Steps when you wanted a smooth sweep | Ableton Draw Mode's grid steps **[manual]** | Freehand draw is smooth; steps are a shape you ask for |

What makes it easy, in every simple tool: a visible line you can grab; volume first; the knob showing the value the
song is actually using.

### 2.9 What Overdub takes from each

| From | Overdub takes |
|---|---|
| Ableton | Lanes under the track; click/drag/Alt-curve gestures; Simplify; shapes on a bar range; clips carry automation; the override + re-enable model, made visible |
| Logic | Touch as the recording behaviour; the 200 ms return glide; "move automation with regions: Always" as the only behaviour |
| FL Studio | Open the lane from the knob; per-segment curve with a tension number |
| Bitwig | Keep modulation (LFOs inside devices, per-note expression) separate from automation |
| REAPER | Trim, but only for the agent (an `adjust` on an automated param moves the whole lane) |
| GarageBand, Soundtrap, BandLab, Suno | One parameter picker, volume first, no modes |
| Ableton Note | No arm: moves while playing are kept and offered |

---

## 3. The spec

### 3.1 Principles

1. **One value at any moment, in one place.** Track-level lanes only. **[inference]** Clip envelopes would make a
   second home with a precedence rule (Logic's region-over-track), and an agent reading the song would have to merge
   two curves to know what plays.
2. **Song time in beats.** Like notes and clips. A lane is musical: it stays on its bars when the tempo changes.
3. **Automation is the document.** Lanes, holds and recordings are ops: signed, undoable, in History, in renders and
   exports. What you hear is what the agent measures.
4. **Every change is an exact inverse.** Range-replace ops whose inverse is the same op with the old points.
5. **No modes.** Touch is the only writing behaviour; reading is always on unless a lane is held.
6. **Measured, not guessed.** A probe kernel turns a param into DC, so tests read automation curves sample by sample
   in the browser and in Node.

### 3.2 The data model

Lanes are stored on the thing they move, keyed by the param they move. All new fields; older songs have none and
older readers skip them (`format` stays `overdub/0`).

```js
Track  = { ..., auto?: { gain?: Lane, pan?: Lane } }                       // the mixer
Track.instrument = { device, params, auto?: { [paramKey]: Lane } }          // instrument params
Insert = { id, device, on, params, by, auto?: { [paramKey]: Lane } }       // effect params (track and master inserts)
Project.master = { gain, inserts, auto?: { gain?: Lane } }

Lane  = { points: [Point], off?: true, by }    // off: held (the static value plays); by: who last wrote it
Point = { t, v, c? }                            // t: song beat (>= 0); v: the param's own units (Hz, dB, -1..1)
                                                // c: the segment leaving this point: absent = straight,
                                                //    a number in -1..1 = bent (see 3.4), 'step' = hold, then jump
```

- **Addressing** in ops, tools and the UI: `{ track, insert?, param }`. `insert` is an insert id or `'instrument'`;
  absent means the mixer, where `param` is `'gain'` or `'pan'`. `track: 'master'` takes `param: 'gain'` or an
  `insert` on the master. Same shape as every other op (`insert.set` names `track` + `insert`). **Sends**: Overdub has
  none yet (`engine/strip.js` has no send bus) **[code]**; when they land, `param: 'send:<bus>'` on the mixer.
- **Canonical order.** Points sorted by `t`; at most two points share a `t` (a jump: the first is the value arriving,
  the second the value leaving); `v` clamped to the param's range and snapped to its `step`; the segments of a
  discrete param (a switch, or a whole-number param of up to 24 steps: a mode, a note division, bits, semitones;
  `automation.js` `discrete`) are always `'step'`, while a knob whose step is only its resolution (0.5 dB, 10 Hz,
  1 ms, 0.01) ramps and bends like any other; `t` rounded to 1/1024 beat, like `arrangement.js`'s `r4` rounding.
- **Before the first point** the lane holds the first value; **after the last** it holds the last. A lane with one
  point is a constant. A lane with no points doesn't exist (an op that would leave one empty removes it).
- **The static value** (`params[key]`, `track.gain`) stays where it is. It is what plays when the lane is held, and
  what the param returns to if the lane is cleared. (Clearing from the UI first sets it to the lane's value at the
  playhead, so nothing jumps: 3.7.)
- **Why stored on the insert and not in a list on the track:** `insert.remove`'s inverse already re-adds `clone(fx)`,
  `track.remove`'s re-adds `clone(t)`, and `instrument.set`'s `_restore` puts back the whole instrument, so lanes come
  back exactly with no new code. Removing a device removes its lanes, as Ableton does. Changing a track's instrument
  to another device drops the old instrument's lanes (their keys belong to the old device); undo restores them.
- **Not automatable in v1:** an insert's `on` (bypass), mute and solo, the tempo, the meter. Overdub has one tempo
  (`project.tempo`) **[code]**; a tempo map is a separate project. For a delay throw, automate the effect's mix.
- **Limits** (`LIMITS` in `core/project.js`): `lanePoints: 10000`, `songPoints: 50000`; `songSize` counts points;
  a point past beat 8,192 is refused like a clip there. Lanes don't extend `songEnd` (Ableton doesn't either
  **[inference]**).

### 3.3 Ops (`core/ops.js`; each with its exact inverse)

| op | args | does | inverse |
|---|---|---|---|
| `auto.write` | `track`, `insert?`, `param`, `points: [Point] \| "text"`, `from?`, `to?` | Replaces the points in `[from, to]` (default: the span of the given points) with these. Creates the lane if there is none (`by` = the writer); sets `lane.by`. Values are checked against the param's range (`checkDevice`'s def; the mixer's −96..24 dB and −1..1). | `auto.write` over the same `[from, to]` with the old points and the old `by`, carrying `_expect` (a print of the points this op left in the range). If the op created the lane: `auto.clear { whole: true, _expect }`. |
| `auto.clear` | `track`, `insert?`, `param`, `from?`, `to?` | Removes the points in `[from, to]`; with neither, removes the lane. | `auto.write` with the removed points (or the whole lane back, `off` and `by` included). |
| `auto.set` | `track`, `insert?`, `param`, `patch: { off? }` | Holds the lane (`off: true`) or gives it back (`off: false` stores no flag). | `auto.set` with the old flag. |

- **Guarded like notes.** `_expect` makes an undo by one author refuse (changing nothing) when someone has since
  written into that range of that lane, exactly as `notes.replace` does with `notesPrint` today. `revertAuthor` skips
  it and says why.
- **Coalesce.** A drag in a lane dispatches `auto.write` with `coalesce: 'auto:<track>:<insert>:<param>'` (one undo
  step per gesture, as knobs do today). A knob turn that holds a lane dispatches `[insert.set, auto.set off]` together
  under the knob's existing coalesce key.
- **`insert.set` / `instrument.set` / `track.set` on an automated param** still change the static value and nothing
  else (ops stay primitive). `apply_ops` adds a line to its diff: "cutoff has a lane: this sets the value it holds at
  when the lane is held".
- **Text format** (for agents and the console, like the notes format): `beat:value[~curve]`, space separated;
  `curve` is a number in −1..1 or `step`; two tokens at one beat make a jump. `"32:400 48:8000~0.5 64:8000"` is a
  bent sweep from beat 32 to 48 held to 64. `automation.parsePoints(text)` / `formatPoints(points)`.
- **Refs.** Lanes have no ids: `{ track, insert, param }` names one, and `$refs` work for `track` and `insert` as
  everywhere.
- `OP_TYPES` grows by three; ARCHITECTURE.md's catalog, `OPS_CHEATSHEET` in `agent/prompt.js`, AGENTS.md and the ops
  guide document them; `pages-test` counts tools, not ops, so no public number moves.

### 3.4 Values between points (`core/automation.js`, new, pure)

One function decides every value everywhere, and both renderers call it or a transcription of it:

- **Interpolation happens in control travel, not raw units.** A straight line on the lane is a straight turn of the
  knob: a log param (`curve: 'log'`: cutoff, time) moves through `toPos`/`fromPos` (today in `ui/faces.js`), the
  fader through its console law (`dbToPos`/`posToDb`, today in `ui/mixer.js`), pan linearly. These move into
  `core/automation.js` (the UI imports them back), so a sweep from 200 Hz to 8 kHz sounds even, and a fade drawn as a
  line on the fader's travel sounds like a hand on a fader rather than 3 bars of nothing then a jump.
- **Bend.** For `c` in −1..1, `x` the position in the segment (0..1): `c > 0` is a slow start, `y = x^(1 + 3c)`;
  `c < 0` a fast start, `y = 1 − (1 − x)^(1 − 3c)`; `c = 0` straight. Monotone, never overshoots, one `Math.pow`.
  (Ableton and Logic both bend a segment rather than add Bezier handles **[manual]**; one number is something an agent
  can write.)
- **API:** `valueAt(lane, beat, spec)`, `travel(spec)` → `{ toPos, fromPos }`, `segmentsIn(lane, from, to, spec)` →
  `[{ t0, t1, a, b, c }]` with `a`, `b` in travel (0..1), `lanesOf(project)` (every lane with its address),
  `shapePoints(shape, { from, to, v0, v1, ... })` (3.8, 3.10), `thin(points, tol)` (Ramer–Douglas–Peucker in travel
  space, for recordings and freehand draw), `parsePoints`/`formatPoints`. No DOM; runs in Node.

### 3.5 How the engine plays it

**Kernel params: timed segments, evaluated per block inside `KernelCore`** (`kernel/worklet.js`, `kernel/host.js`).

- New messages: `{ type: 'auto', key, time, end, a, b, c }` (AudioContext seconds, like notes; `a`, `b` travel;
  `c` the bend or `'step'`), `{ type: 'auto.clear', key, from }` (drop queued segments for `key` at or after `from`),
  `{ type: 'auto.stop' }` (drop all, release every key). Enqueued in frame order in the event queue that already
  orders note-ons and offs.
- At the start of each block (frame `f0`), for each key with a segment covering `f0`: `pos = a + (b − a)·bend(x, c)`
  with `x = (f0 − f0seg) / (f1seg − f0seg)`, `tgt[key] = fit(spec, fromPos(spec, pos))`. The existing 10 ms one-pole
  (`smoothParams`) then runs as it does now, so a step or a loop wrap's jump never clicks and a ramp lags it by a
  constant 10 ms in both renderers. Block-accurate: 128 frames, 2.7 ms at 48 kHz.
- **The static value doesn't fight it.** A key that has received an `auto` event since the last `auto.stop` ignores
  the `params` message for that key (the value is remembered for when automation stops). So `Strip.applyParams`
  can keep sending the full params object.
- **Bit-exact by construction.** The Node renderer runs the same `KernelCore` class **[code]**; it receives the same
  `auto` events (built by the same `autoIn`, below), so a kernel's automation renders identically in the worklet and
  in Node, the same way notes do. Golden scenes with automation pin Node hashes; the browser preview agrees within
  −90 dBFS as for every kernel scene.

**What plays when** (`engine/schedule.js`): `autoIn(p, from, to, { cut, chase, tracks })` → for every lane that isn't
held, the segments that start in `[from, to)` (and, with `chase`, the one covering `from`, cut to start there), each
`{ track, insert, param, key, at, end, a, b, c }` in song beats. Pure; the live scheduler, `engine/render.js` and the
Node renderer all read the song through it, as they do `notesIn`.

**Live** (`engine/engine.js`):

- `scheduleRange` hands each new segment to its instance once (keyed in `T.scheduled` like notes:
  `${lane key}/${t0}@${segIndex}`), at `time(at) + comp` (plugin delay compensation: automation lines up with the
  notes it was drawn against). Master lanes get no `comp`.
- **Chase, one rule:** at play, seek and a loop wrap, the segment covering the start is sent from that point (its
  value there), as held notes are chased. A segment that runs past the loop's end is cut there; the wrap sends the
  fresh one.
- **Edits while playing.** A store change that touches a lane (`auto.*` ops, time ops, an insert removed) marks it
  dirty; `revise()` posts `auto.clear { key, from: now }` and reschedules that lane's segments from now through the
  scheduled horizon. Same pattern as notes moved inside the lookahead.
- **Stopped.** `stop()` posts `auto.stop` to every automated instance; the strip's spec then carries, for each
  automated param, the lane's value **at the cursor** (`valueAt(lane, T.cursor)`), so a knob, a measurement and
  what you hear all agree while stopped. A seek updates it. The killswitch's fresh instances get the same.
- **Being written** (3.9): the param being held by a hand is left out of scheduling until it is let go; the knob's own
  live `set` is what plays.

**Graph device params** (pedals, amps; `devices/graph.js`):

- The scheduler calls `inst.set(values, { at })` at control points every 20 ms of audio time inside the lookahead
  (merging every automated key of that instance into one call), with `values` = static params overlaid by each lane's
  `valueAt`. The device's `x.to` glides there (`setTargetAtTime`, 15 ms) **[code]**, so 20 ms points read as a smooth
  sweep. `Strip.applyParams` overlays the latest scheduled values for automated keys, so a reconcile never yanks a
  pedal back to its static value.
- A few vendored pedals write `.value` directly in `set()` (8 sites in `app/vendor/clawd/pedals.js`) **[code]**; for
  those `at` is ignored and the change lands up to 120 ms early. `tools/guitar-test.js` lists them (render a lane
  sweep, check the change lands within 30 ms of its beat); their params are marked `auto: false` in the adapter
  (`devices/guitar/pedals.js`) and the UI won't offer a lane. We never edit the vendored copies.
- Browser offline render: the same `set(…, { at })` calls are made up front before `startRendering()`. The Node
  renderer bypasses graph devices as it does today. Graph lanes are held to −80 dB between renders like the pedals.

**Gain and pan** (`engine/strip.js`, `engine/render.js`, `engine/node/render.js`):

- Control points on the **128-frame grid** of the render or the audio clock: the fader's linear gain
  `dbToGain(posToDb(pos))` and the two cosine-law pan gains at each grid point; between points, linear. Live and in
  the browser render: `linearRampToValueAtTime` to each grid point (the scheduler adds the points for its 120 ms
  window each tick, after a `cancelScheduledValues` from the first new one). Node: the same grid values computed in
  float32 and interpolated per sample (`v0 + (v1 − v0)·k/128`), the formula the Web Audio spec gives for a linear
  ramp **[manual: W3C]**. Expected agreement within −90 dBFS; the golden test measures it.
  (`setValueCurveAtTime` would be one call per tick, but the spec makes it throw when it overlaps other events
  **[manual: W3C]**, which an edit mid-curve guarantees.)
- If the main-thread cost is over budget (3.12), the grid coarsens to 512 frames: one constant, both renderers.

**Renders.** `engine.render`, stems and `probeLatency` need nothing new beyond `autoIn` (ranges chase the value at
`from`). `measure()` doesn't change. Muted clips don't mute automation.

### 3.6 What a knob does when its param has a lane (pick: Ableton's override, made visible)

| State | The knob | Turning it (not recording) | While R records |
|---|---|---|---|
| **Lane plays** (default) | Moves with the song; shows the lane's value at the playhead (stopped: at the cursor). Small pencil `auto` after its label; its pop-up says "Follows its lane (Cutoff, bars 9–16)". | **Holds** the lane: one undo step `[insert.set value, auto.set off]` by you. Toast, once per song: "Cutoff is held at 2.4 kHz. Its lane is off until you bring it back." with **Back to the lane** and the key. While playing, the gesture is also kept: see 3.9's Keep that move. | Writes into the lane (Touch, 3.9). The lane stays on. |
| **Held** | Static, its label says `held` in grease pencil; the lane under the track is dashed pencil | Changes the static value as today | Writes into the lane and gives it back (`off: false`) |
| **No lane** | As today | As today; while playing, the move is kept and offered (3.9) | Writes a new lane |

- **Back to the lane**: in the knob's pop-up, on the lane's header, from the knob's right-click menu, and in the top
  bar as `.btn-txt` "Back to the lanes (2 held)" whenever any lane in the song is held (Ableton's Re-Enable, but it
  says how many and stays out of sight otherwise). Each is `auto.set { off: false }`, one undo step.
- **Why not Logic's Read** (the knob refuses to move): a control that won't turn reads as broken to a beginner
  **[inference]**. **Why not REAPER's Trim** (the knob offsets the lane): powerful, invisible, and the knob no longer
  shows the value playing **[inference]**; Trim is what the *agent* does (3.10), where it reports the numbers.
- The mixer's fader and pan follow the same table.

### 3.7 The UI (in the Liner notes look)

**Where lanes live.** Under their track in the arranger, each 40 px tall (48 on phones), indented under the track's
header column. Lanes still play when hidden.

- **Show and hide.** `E` shows or hides the selected track's lanes (free today: E is only used with modifiers
  **[code]**; musical typing takes it while on, as it takes every letter); the track header's menu has **Automation** with a list of what has lanes and **Add a lane…** (a
  ledger of the track's params, the mixer's first: Level, Pan, then each device's knobs by label). The fastest way in
  is from the knob: right-click (touch: hold) a knob or fader → **Automate** opens its lane and scrolls to it, as
  Suno and FL do **[manual]**. A track with lanes it isn't showing gets a pencil `A` key beside M S R (19 px, 2 px
  corners), lit (`.tog` lamp) when they are shown.
- **The lane header** (in the header column): the param's name in sentence case ("Cutoff"), the device in pencil
  ("Keyhole"), a byline when an agent wrote it last ("Cutoff, by Claude"); the house is unsigned. The value at the
  playhead in `.mono`. A `.tog` **Draw**. A `.btn-txt` **Back to the lane** when held. A `.btn-txt` **Hide**. The
  menu (right-click): Clear, Simplify, Copy, Paste, Shapes, Remove the lane.
- **The lane.** No box and no fill block: the room, the beat grid's hairlines, and the line. The line is the track's
  ink at 1.5 px with the area under it at the clip fill's 13% ("which part", never "who"); points are 5 px squares
  outlined in the track ink (no circles: kit rule 5). Selected points are reverse print (filled `--text`), and a
  selected range gets the arranger's cream hairline frame. **Held** is the muted look: the line dashed in `--text-3`,
  the name struck, "held" where the byline was. **Being recorded** is the record ink: the stretch being written is
  drawn in `--rec` with a red frame on it, nothing else (kit rule 10). An agent's arriving lane gets crop marks in its
  ink for 1.4 s, as clips do; an agent pointing at a range gets grease-pencil crop marks. Before the first point and
  after the last, the line continues flat in pencil (it holds, but nobody drew it). A step segment is drawn square.
  Values off the top or bottom of the visible range never happen: the lane's vertical axis is the full travel.
- **Gestures (pointer).** Click the line: add a point there (snapped in time to the arranger's snap, value on the
  line). Drag a point: move it (time snaps; Shift: fine, no snap). Drag a segment up or down: moves its two ends
  (Ableton). Alt-drag a segment: bend it (`c`); Alt-double-click: straighten. Double-click a point: delete it. Drag on
  empty lane: select points in that range; Delete removes them; drag the selection to move it (in time and value);
  ⌘C/⌘V copy and paste at the playhead. Draw on (the `.tog`, or hold ⌘): paint freehand, thinned on release
  (`thin` at 0.5% of travel), time-snapped only if the snap is a bar or coarser. Every gesture is one undo step.
  Hovering a point shows its value and bar in a mono tip.
- **Gestures (touch).** Tap the line: add. Drag a point or the selection. Hold a point: its menu (Delete, Straight,
  Ease in, Ease out, Step). Hold empty lane and drag: select. Draw is the `.tog` (no ⌘ on phones). Targets 40 px
  (points get a 40 px hit circle around a 7 px square).
- **Shapes on a range** (select bars in the lane, right-click): **Ramp up**, **Ramp down**, **Swell** (up and back),
  **Dip** (down and back), **Hold here** (the value at the range's start, flat), and **Pulse** (a step every beat,
  between the lane's value and a second value you drag). Each joins the lane's value before and after the range, as
  Live's ramps "link up" **[manual]**. They are `shapePoints` in core, so the agent uses the same shapes.
- **Copying with clips.** Moving, Alt-copying, duplicating (⌘D), repeating or pasting clips in the arranger also
  writes the lanes on that track under the clip's span to the new place (3.11). A `.tog` **Lanes follow clips** in
  the arranger's View menu, on by default, per browser (`overdub:arrange`), is Ableton's Lock Envelopes inverted.
- **Knob and fader marks** (`ui/faces.js`, `ui/mixer.js`): `auto` / `held` as above; while playing an automated knob
  turns by itself at the frame rate (from `engine` reading the lane, not the audio thread). No glow, no outline
  colour (Suno's green outline is exactly what the kit rules out).
- **Phones.** Lanes are 48 px; the lane header collapses to the name and the value; one lane open at a time per track
  by default.
- **Arranger layout.** Rows become variable: a track row (`trackH`) plus its open lanes. One `rows()` model (y, height
  and kind for every row, cached per change) replaces `i * TH` in drawing, hit-testing, `locate()`, presence and the
  headers. This is the largest change in the UI wave and also what take lanes will need later.

### 3.8 Drawing defaults

- A new lane from **Add a lane** or **Automate** has no points until you touch it: the line is the static value in
  pencil, labelled "not automated yet". The first click makes a point *and* a point at bar 1 with the static value
  (GarageBand's first click "adds an automation point at the project start position, using the current value"
  **[manual]**), so the first edit is a move from where it was, not a jump.
- Snap: the arranger's snap; a new point's value is the line's value there.
- Freehand: thinned at 0.5% of travel, never more than one point per 1/64 beat.

### 3.9 Recording: Touch, and Keep that move

- **While R records** (`engine.recording`), holding any knob or fader writes. Pointer down starts writing at the
  event's audible beat (`engine.beatAt(e.timeStamp)`, the same placement the recorder uses for notes); every
  `pointermove` adds a raw point; pointer up stops, and the lane's existing curve takes over again after a 200 ms
  glide (Logic's ramp time **[manual]**; written as two points). What was written replaces the old points in exactly
  the span that was touched (Touch: later automation survives). On an empty lane Touch and Latch give the same
  result. Raw points are thinned (`thin`, 0.5%) when the pass ends.
- **Commit.** Each loop pass (or the take, without a loop) becomes one `auto.write` per touched lane, dispatched with
  the take's commit (`planTake`'s ops plus these, one undo step, by you), labelled "Cutoff, bars 9–11 (recorded)".
  A later pass over the same span replaces the earlier one (the last pass is what plays, like New take).
  A pass in which you only moved knobs adds only automation (a pass with nothing in it adds nothing, as today).
- **While the song just plays** (no R), every knob or fader gesture is kept in memory with its beats (Sketch's
  capture rule: never lose an idea). When the gesture ends, the toast says what was done and offers to keep it:
  "Cutoff moved from 400 Hz to 6.2 kHz over bars 9–11. **Keep that move**" (`.btn-txt`). Keep writes it into the lane exactly as a recording would and gives the lane back. Ignored, it
  expires with the toast; the static change (or the hold) stays as it was. This is Ableton Note's dotted line and
  Add **[manual]**, without a lane to look at.
- **MIDI controllers.** Overdub reads CC 1, 64 and the reset messages only, with no MIDI learn **[code:
  `input/midi.js`]**. Mapping knobs is its own feature; when it lands, a mapped CC counts as touched while it moves
  and for 500 ms after (Ableton's latch-then-punch-out for controllers **[manual]**).

### 3.10 The agent

- **apply_ops** takes `auto.write`, `auto.clear`, `auto.set` (3.3). Examples in the ops guide:
  - "fade the pad in over bars 1–4": `{ type: 'auto.write', track: 'Pad', param: 'gain', points: '0:-60 16:-6' }`
    (−6 dB being the pad's fader; the curve is on the fader's travel, so it sounds even).
  - "open the filter over the chorus" (Chorus at beats 32–48, Keyhole `fx_k`):
    `{ type: 'auto.write', track: 'Keys', insert: 'fx_k', param: 'cutoff', points: '31:600 32:4500 47:4500 48:600' }`.
- **get_project** lists lanes under their track: `  auto: Keyhole cutoff (fx_k) 31:600 32:4500 47:4500 48:600,
  by claude` (the text format when 12 points or fewer, else "184 points, 400–6200 Hz, bars 9–24"), `held` when held.
  `summarize()` in `core/project.js`.
- **adjust** gains `over` (bars, beats or a section, the same `RANGE_PROPS` it already takes for measuring) and
  `shape`: `'hold'` (default with `over`: the move applies across the range with half-beat ramps in and out, then the
  lane returns), `'ramp'` (from the value at the start to the moved value at the end, then stays), `'swell'`, `'dip'`.
  Without `over`, adjust is unchanged. With it, the planned moves (`planAxis`) become `auto.write` ops built by
  `shapePoints`, one per moved param (an EQ insert added by `adjust` keeps its static gain move outside the range at
  zero). **Measure:** render the range plus a bar either side once before and once after; measure the first and last
  bar of the range and the bar after it (`measure(buffer, { from, to })`); correct once if the last bar moved the
  wrong way or too little (the existing rule, applied to that bar); report "brightness, bars 13–16: centroid 820 →
  2,950 Hz; bar 12 unchanged (830 Hz); after the chorus back to 815 Hz".
- **adjust on an automated param without `over`** moves the whole lane by the planned amount in travel space (REAPER's
  Trim, for the agent only), so "a bit brighter" keeps the sweep and lifts it. Reported as such.
- **render_and_measure** gains `series: 'bars'`: per-bar `lufsShortMax`, `rms` and `centroid` for the range, so a fade
  or a sweep can be checked as numbers ("bars 1–4: −41, −29, −22, −17 LUFS short-term").
- **Presence.** While an agent writes a lane it highlights `{ track, insert, param, range }`; the lane draws crop
  marks.
- **Prompt** (`agent/prompt.js`): one paragraph. "Automation is lanes in song beats on gain, pan and device params
  (`auto.write`). Prefer `adjust` with `over` for words; use `auto.write` for exact shapes. Don't write over a lane
  the human drew without asking; propose instead." Proposals use `propose_variations` with the lane ops (`store.preview`
  already auditions any ops).
- **No new tool.** The catalog stays at 26, so README, docs, the site and `pages-test`'s claims block don't move.
- **diff.js / history.js**: one line per `auto.*` op ("Claude wrote Keyhole cutoff on Keys, bars 9–12: 600 Hz →
  4.5 kHz"; "You held Cutoff on Keys").

### 3.11 Time, clips and the other edges

| Edit | What happens to lanes |
|---|---|
| `time.insert at, length` | Points at or after `at` move right by `length`; the value at `at` is held across the gap (a point at `at` and at `at + length`). Every lane in the song. |
| `time.remove at, length` | Points in `[at, at + length)` go; later ones move left; a point at `at` with the value from before and one with the value from after (a jump, smoothed by the engine). |
| `section.duplicate` | Each lane's points in the section's span (with its values at both edges) are written at the destination, after `push` makes room. |
| `clip.repeat` (copies and loop) | The lane points under the clip's span on that track are written to each copy's span (the loop mode's extension included). |
| `clip.split` | Nothing (lanes are track-level). |
| Arranger move / Alt-copy / ⌘D / paste of clips, with Lanes follow clips on | That track's points strictly inside the clip's old span are written to the new span (replacing what was there); a move also clears the old span (holding the value that was before it). Across tracks: the lanes move to the same params on the other track if it has them, else stay. |
| `clip.move` from an agent (`apply_ops`) | Nothing. Ops stay primitive; the arrangement planners and the arranger are where "follow" lives. `arrange_song` follows. |
| Tempo or meter change | Nothing moves: lanes are in beats. |
| Loop wrap with a jump between loop end and start | Kernels slide 10 ms; gain and pan ramp over one 2.7 ms block. No click (measured in the engine test). |
| Insert removed / instrument changed / track removed | Lanes go with it; undo brings them back exactly. |
| A device's param removed in a new version (`device.define`) | The lane stays in the song, does nothing, and is listed "no such param" on its header and in `get_project`. |
| Song opened in an older studio (cached tab) | It drops the `auto` fields on load. Accepted: the studio is served fresh; no other reader exists. |
| Share links (64 KB) and `.overdub.json` | Lanes ride in the JSON. Thinning keeps a recorded sweep to tens of points (a point is ~20 bytes). |
| DAWproject export (`core/dawproject.js`) | Each lane as `<Points unit="…">` with a `<Target parameter="…">` and `<RealPoint time value interpolation>`; the format knows only `linear` and `hold` **[manual: DAWproject schema]**, so bent segments are sampled every 1/16 beat. MIDI export: none. |
| Provenance report | Lanes counted by author (who last wrote each). |
| Muted clip under a lane | The lane still plays. |
| Undo of a recording while still playing | The engine's `revise` clears and reschedules; the hand-written value is gone within one tick. |

### 3.12 Performance budget

| What | Budget | How it's held |
|---|---|---|
| Kernel evaluation | < 0.5 µs per automated key per block; 64 automated kernel params under 1% of a 2.7 ms block | One `Math.pow` (bent segments only) and one `fromPos` per key per block; `tools/perf-check.js` adds a scene: 16 heavy tracks, each with a gain lane and two param lanes, playing |
| Messages to the worklet | One per segment (not per block) | A lane with a point every beat at 120 BPM: 2 messages/s |
| Graph lanes | `set()` at 50 Hz per automated instance; 16 instances live under 1 ms per 25 ms tick | One merged `set` per instance per control point |
| Gain and pan | 375 ramp events/s per lane; 16 lanes under 2% of the main thread | Coarsen to 512 frames (both renderers) if `perf-check` says otherwise |
| Arranger drawing | Under 2 ms a frame for 16 open lanes and 2,000 visible points | Only visible rows; points culled to the view; one path per lane |
| Song size | 10,000 points a lane, 50,000 a song | `LIMITS`, `songSize`; recordings thinned |
| Renders | Under 3% slower with the scene above | `autoIn` once per render |

### 3.13 Copy

- "Cutoff is held at 2.4 kHz. Its lane is off until you bring it back." **Back to the lane**
- "Cutoff moved from 400 Hz to 6.2 kHz over bars 9–11." **Keep that move**
- "Cutoff, bars 9–11 (recorded)" (History label)
- "Back to the lanes (2 held)" (top bar)
- "Not automated yet. Click the line to add a point." (an empty lane)
- "Claude wrote Keyhole cutoff on Keys, bars 9–12: 600 Hz to 4.5 kHz." (agent edit)

### 3.14 Checks

- `tools/automation-test.js` (Node, new): the text format round-trips; `valueAt` and `segmentsIn` agree; every op's
  inverse restores the song byte for byte over a seeded fuzz of 2,000 random op sequences (the `stuck-test` style);
  guarded inverses refuse after someone else's write; time ops move lanes as the table says; normalisers keep `auto`.
- `tools/engine-test.js` additions (browser): a **probe kernel** that outputs one param as DC; play and render a lane
  through it and compare the curve with `valueAt` per block (live, `engine.render`, Node: within one block and
  10 ms of smoothing); fader and pan lanes within −90 dBFS between `engine.render` and Node; edits while playing land
  within one tick; stop leaves the value at the cursor; no click at a loop wrap jump (−60 dB above the signal's
  own step).
- Golden: a new scene `automation` (a pad with a gain fade and a filter sweep, a kernel insert). Builders list it; the
  orchestrator pins it.
- `tools/agent-test.js`: `adjust { over }` writes a lane, measures the ends, corrects once; `get_project` shows lanes;
  `series: 'bars'` returns rising numbers for a fade.
- `tools/arrange-test.js` / a new `tools/lanes-test.js` (browser): show/hide, add, drag, bend, delete, draw, select
  and move, shapes, follow on clip move, phone gestures, the held look, screenshots for the kit.

---

## 4. Build plan

Two waves, as DAY-RUN.md item 11b has it: the core alongside wave 11, the UI in wave 12. Ownership follows
ARCHITECTURE.md's areas; nobody writes `tools/golden.json` (scenes are listed for the orchestrator).

### Wave A: the core (three builders in parallel, one contract: sections 3.2–3.5 and 3.10 of this file)

**A1. Model and ops** [core]
- `app/src/core/automation.js` (new): travel functions (moved from `ui/faces.js` `toPos`/`fromPos` and
  `ui/mixer.js` `dbToPos`/`posToDb`; those files keep working by importing them in wave B), bend, `valueAt`,
  `segmentsIn`, `lanesOf`, `shapePoints`, `thin`, `parsePoints`/`formatPoints`, `laneAt(p, { track, insert, param })`.
- `app/src/core/ops.js`: `auto.write`, `auto.clear`, `auto.set` with guarded inverses; the `apply_ops`-facing errors.
- `app/src/core/project.js`: `normTrack`, `normInsert`, the instrument copy and `cleanProject` carry `auto` (cleaned:
  sorted, clamped, dropped if malformed); `LIMITS.lanePoints`/`songPoints`; `songSize` counts points; `summarize`
  lists lanes.
- `app/src/core/arrangement.js`: `time.insert`, `time.remove`, `section.duplicate`, `clip.repeat` plan `auto.write`
  for lanes in range; a `followClips(p, moves)` planner the arranger will call in wave B.
- `app/src/core/dawproject.js`: lanes as `<Points>`.
- `tools/automation-test.js` (new); `tools/core-test.js` and `tools/arrangement-test.js` additions.
- Docs: ARCHITECTURE.md (schema, op table), the ops guide text.

**A2. Engine and both renders** [engine + dsp]
- `app/src/kernel/worklet.js`: the `auto`, `auto.clear`, `auto.stop` messages; per-block evaluation; `params`
  ignoring automated keys. `app/src/kernel/host.js`: `inst.auto(segment)`, `inst.autoClear(key, from)`,
  `inst.autoStop()`. (dsp area: these two files.)
- `app/src/engine/schedule.js`: `autoIn`. `app/src/engine/engine.js`: scheduling, chase, wrap, compensation, `revise`
  for lanes, stopped values at the cursor, graph control-rate `set`, gain and pan control points.
  `app/src/engine/strip.js`: `trackSpec`/`masterSpec` with lane values at a beat; `applyParams` overlay;
  `setMix` ramps on the grid. `app/src/engine/render.js` and `app/src/engine/node/render.js`: the same, offline.
- `app/src/devices/guitar/pedals.js` [guitar]: `auto: false` on the params of pedals that ignore `at` (found by the
  `guitar-test` check this builder adds); vendored files untouched.
- `tools/engine-test.js` additions with the probe kernel; `tools/perf-check.js` scene; `tools/guitar-test.js` check;
  the `automation` golden scene in `tools/golden-scenes.js` (listed, not pinned).

**A3. Agent** [agent layer]
- `app/src/agent/tools.js`: `adjust { over, shape }` and lane Trim; `render_and_measure { series: 'bars' }`;
  `apply_ops` diff warnings; `get_project` via `summarize`. `app/src/agent/extra-schemas.js` untouched (no new tool).
- `app/src/agent/prompt.js` (the cheatsheet paragraph), `app/src/agent/diff.js`, `app/src/agent/history.js`
  (summaries), `app/src/agent/mock.js` (the demo agent fades something in, so the scripted demo shows it).
- `tools/agent-test.js`, `tools/lexicon-test.js` additions. Docs: AGENTS.md; `node tools/docs-build.js`.
- Depends on A1's `core/automation.js` exports (code against the contract; a marked FALLBACK until it merges).

### Wave B: the UI (after wave A merges; three builders in parallel, in the Liner notes look)

**B1. Lanes in the arranger** [ui-arrange]
- `app/src/ui/arranger.js`: the `rows()` layout (variable rows), lane rows and headers, show/hide (E), the Automation
  menu, Lanes follow clips (calls A1's planner), hit-testing, presence and `locate()` on the new layout.
- `app/src/ui/lanes.js` (new): drawing a lane, its hit-testing and gestures (pointer and touch), shapes menu, copy and
  paste of points, so `arranger.js` grows by the layout only.
- `app/src/ui/arrange-kit.js`: shared bits (point squares, the held dash).
- `tools/lanes-test.js` (new), `tools/phone-test.js` and `tools/a11y-test.js` additions (lanes are reachable by
  keyboard: Tab into a lane, ←/→ between points, ↑/↓ value, Delete).

**B2. Knobs, faders and holds** [ui-mix; faces with the guitar owner's sign-off]
- `app/src/ui/faces.js`: the `auto`/`held` mark, the knob following the lane while playing, **Automate** and
  **Back to the lane** in the knob's menu; travel functions imported from core.
- `app/src/ui/rack.js`, `app/src/ui/mixer.js`: the hold dispatch, fader and pan following lanes, `dbToPos` from core.
- `app/src/ui/transport.js`: "Back to the lanes (n held)".

**B3. Recording and Keep that move** [input]
- `app/src/input/autorec.js` (new): gesture capture from faces and the mixer (`onParam` with `commit`), placement with
  `engine.beatAt`, Touch writing during R, the 200 ms return, thinning, the Keep that move toast.
- `app/src/input/recorder.js`: one hook so a take's commit includes the passes' `auto.write` ops (one undo step).
- `tools/record-test.js` additions. Docs: GUIDE.md ("Automation": open a lane from a knob, draw, record, hold and
  bring back), then `docs-build`.

### Ownership summary

| File | Wave | Builder |
|---|---|---|
| `core/automation.js` (new), `core/ops.js`, `core/project.js`, `core/arrangement.js`, `core/dawproject.js` | A | A1 |
| `kernel/worklet.js`, `kernel/host.js`, `engine/schedule.js`, `engine/engine.js`, `engine/strip.js`, `engine/render.js`, `engine/node/render.js`, `devices/guitar/pedals.js` | A | A2 |
| `agent/tools.js`, `agent/prompt.js`, `agent/diff.js`, `agent/history.js`, `agent/mock.js` | A | A3 |
| `ui/arranger.js`, `ui/lanes.js` (new), `ui/arrange-kit.js` | B | B1 |
| `ui/faces.js`, `ui/rack.js`, `ui/mixer.js`, `ui/transport.js` | B | B2 |
| `input/autorec.js` (new), `input/recorder.js` | B | B3 |
| `tools/golden.json`, `docs/DAY-RUN.md`, commits | both | the orchestrator |

Risks: the arranger's variable rows (B1) touch every coordinate in a 2,000-line file that wave 10b's start-marker
work is also editing today, so B1 starts after that merges. The fader's control grid (A2) is the one place the
browser and Node renderers compute the same thing two ways; the golden test decides.

---

## 5. Open questions, with the answer we'd go with

1. **Clip envelopes?** No, track lanes only, moving with clips in the arranger (3.1, 3.11). Revisit if loops in a
   future clip launcher want per-clip motion; then they would be modulation, not automation (Bitwig's split).
2. **Latch by default for recording?** No: Touch. With a mouse or a finger we always know when the control is held,
   so Touch never wipes later automation by surprise, and on an empty lane it gives Latch's result anyway. Ableton
   behaves this way with the mouse **[manual]**. Latch-like behaviour only for MIDI knobs once they can be mapped.
3. **An automation arm?** No. R writes; plain playing keeps moves and offers them (Keep that move).
4. **Turning an automated knob: hold the lane (Ableton) or edit the lane at the playhead?** Hold, made visible, plus
   Keep that move while playing. Editing the lane from a knob while stopped sounds friendly but makes a knob turn
   change the song at one point nobody can see; holding is reversible with one click and says so.
5. **Is a hold part of the song?** Yes (`lane.off`, an op). Otherwise the agent's renders and the export would differ
   from what you hear.
6. **Lanes follow clips by default?** Yes, with a View toggle (Ableton's default, Logic's Always). Agents' raw
   `clip.move` doesn't follow; `arrange_song` does.
7. **Insert bypass (`on`) automation in v1?** No; automate the effect's mix. Bypass crossfades are timed separately in
   the browser and Node, and would need their own agreement work.
8. **The interpolation space** (control travel, not raw units)? Yes. A straight line on a cutoff lane should sound
   straight; agents still write values in Hz and dB.
9. **Show lanes on phones?** Yes, one per track at a time, 48 px, with the touch gestures in 3.7.

---

## 6. Sources

Manuals and help pages
- Ableton Live 12 manual: [Automation and Editing Envelopes](https://www.ableton.com/en/manual/automation-and-editing-envelopes/)
- Logic Pro: [Region vs track automation (iPad guide, intro to automation)](https://support.apple.com/guide/logicpro-ipad/lpip5e86f830/ipados), [Automation settings: Move Track Automation with Regions, Ramp Time](https://support.apple.com/en-asia/guide/logicpro/lgcp8aa8f24b/mac), [Logic 9: Setting an Automation Mode (Off is the default)](https://help.apple.com/logicpro/mac/9.1.6/en/logicpro/usermanual/chapter_28_section_2.html), [Control Surfaces Support Guide: automation modes](https://support.apple.com/guide/logicpro-css/ctls72225d3a/mac)
- FL Studio: [Automation Clips](https://www.image-line.com/support/flstudio_online_manual/html/playlist_automationclip.htm)
- Bitwig Studio: [User guide, Automation](https://www.bitwig.com/userguide/latest/automation/), [Modulators](https://www.bitwig.com/en/bitwig-studio/devices/modulators.html)
- GarageBand for Mac: [Show track automation curves](https://support.apple.com/guide/garageband/gbnd939b92d8/mac), [Add and adjust automation points](https://support.apple.com/guide/garageband/gbnd65471e12/mac)
- BandLab: [How can I automate volume, pan, and effects?](https://help.bandlab.com/hc/en-us/articles/360021039314-How-can-I-automate-volume-pan-and-effects)
- Soundtrap: [Using track automations](https://support.soundtrap.com/hc/en-us/articles/205662071-Using-track-automations)
- Suno: [Automation in Studio](https://help.suno.com/en/articles/13674305)
- Ableton Note: [Capture in Note](https://help.ableton.com/hc/articles/5953167728796) (403 to our fetch; its wording is cited through search summaries), [Sound On Sound review](https://www.soundonsound.com/reviews/ableton-note)
- Avid: [Pro Tools First Help, automating in Touch mode](https://apps.avid.com/proToolsFirstHelp/version12.0/enu/Pro%20Tools%20First%20Help/mix3.automation.55.19.html)
- W3C: [Web Audio API, AudioParam automation (linear ramps, setValueCurveAtTime)](https://webaudio.github.io/web-audio-api/)
- Bitwig/PreSonus: [DAWproject](https://github.com/bitwig/dawproject) and its [Project.xsd](https://raw.githubusercontent.com/bitwig/dawproject/main/Project.xsd) (`Points`, `RealPoint`, interpolation `hold` | `linear`)

Reviews, tutorials and forums
- MusicTech: [Learn to use the automation modes in Pro Tools 2020](https://musictech.com/tutorials/pro-tools/learn-to-use-the-automation-modes-in-pro-tools-2020/); Performer: [Pro Tools Automation Made Easy](https://performermag.com/music-news/pro-tools-automation-made-easy/)
- Ask.Audio: [Logic Pro X: Track or Region Based Automation?](https://ask.audio/articles/logic-pro-x-track-or-region-based-automation), [Making instruments more expressive in Bitwig](https://ask.audio/articles/making-instruments-more-expressive-in-bitwig-studio)
- Admiral Bumblebee: [Bitwig note expression](https://www.admiralbumblebee.com/music/2017/06/16/bitwig-feature-review-note-expression), [Bitwig modulators](https://admiralbumblebee.com/music/2017/06/23/Bitwig-Modulators.html)
- REAPER: [Implementing accessible automation (REAPER accessibility wiki)](https://reaperaccessibility.com/wiki/Implementing_accessible_automation), [Envato Tuts+: REAPER automation and envelopes](https://music.tutsplus.com/how-to-use-reaper-automation-and-envelopes--cms-107723t)
- Overrides in practice: [Violet Recording, how to automate in Ableton](https://violetrecording.com/how-to-automate-in-ableton/), [Moog forum, Ableton automation not working](https://forum.moogmusic.com/t/ableton-live-automation-not-working/17579), [JUCE forum, Re-Enable Automation](https://forum.juce.com/t/ableton-automation-lane-bug-vst3-re-enable-automation-automation-lane-greyed-out/67070)

Caveats: the Logic for Mac pages for modes and settings returned only their tables of contents to our fetch; the
mode wording is from the Logic 9 manual and the Control Surfaces guide, and the settings wording from a search
summary of the Mac guide. REAPER's shapes and modes come from the accessibility wiki and tutorials, not Cockos's PDF
(404 to our fetch). The Ableton Note behaviour is from search summaries of its help page and the Sound On Sound
review. Nothing in section 2 was tried hands-on.
