# Direction: Instrument panel

Overdub drawn as a piece of studio hardware rather than a web app. Regions are flat planes split by hairlines, with labels printed beside the controls, keys that press in, and mono numerals in a recessed display. Who played what is shown by a small lamp on the take and by the ink of the author's name, so there are no stripes, cards or pills anywhere.

- Mockup: [`index.html`](index.html). It is static and self-contained, and opens straight from disk. It uses the repo's own font files (`deck/assets/fonts/`), the marks from `app/assets/`, and Night Shift's real notes from `app/src/core/demo.js`.
- Screenshots: `tools/.out/directions/instrument-panel-desktop.png` (1440 wide, full page) and `instrument-panel-phone.png` (390 wide, full page).
- On screen, in order:
  - the studio at 1440 × 900: top bar and transport; the arranger with clips by you, by Claude and by the house, one selected and one muted; Sketch in Tap with a fresh take; the Agent panel with a message and the A/B takes; a toast; the welcome sticker
  - History, the parts list (specimen) and the phone
  - the landing hero

The brand stays as it is: graphite, cream and leader green; Archivo Expanded ExtraBold Italic and the Overprint for display type; Atkinson Hyperlegible for everything else; the Weave; the voice. Warm is still a person and cool is still an agent. What changes is how those meanings are drawn.

## How authorship and state are shown

**A lamp is the only authorship mark.** It is a 7 px round light, and the colour says who did it:

| Lamp | Means |
|---|---|
| warm, lit | a person played or changed it |
| cool, lit | an agent did it |
| unlit (a hairline ring) | the house: demo songs, and what Band writes |

The house not signing is the point. The parts you should notice are the ones that light up.

**The author's name is written in their ink.** "You" is warm and "Claude" is cool, in History, the session log and clip names. On a clip, the lamp sits before the name and the name takes the author's ink. A house clip keeps a cream-tinted name in its track colour.

**Musical objects keep their DAW idioms.** A clip is filled with its track colour, and a track header shows its colour as an 8 px square key-cap (in place of a strip down the edge).

**Authorship in a take shows in the notes.** In the agent's takes, the notes that were already there are drawn neutral and the notes Claude added are drawn cool. You can see what changed before you hear it.

**State lamps have their own fixed colours:**

| Lamp | Means |
|---|---|
| cream | on or selected (the active tab, Click, With the song) |
| leader green | playing: the play key, and the take you are holding to hear. It is the playhead's lamp. |
| red | recording ("Tapping into the song") |
| grease pencil | the loop |

**Keys:**
- A key that is on presses in: it inverts to cream with dark text. It is never tinted.
- A primary action is leader green. There is at most one per region ("Keep on Drums" in Sketch, "Open the studio" on the landing). The agent's takes have no primary, on purpose, because none of them is recommended.

**Selection, the agent's pointer and muting:**
- A selected clip gets four cream corner marks, like a viewfinder, and a cream hairline. It gets no glow and no fill change.
- What the agent is pointing at gets a dashed grease-pencil outline and a mono tag ("Claude is on bars 1–4").
- A muted clip goes to a grey hatch with hollow notes and an `off` tag. Hatching is how DAWs show a clip that won't play.

## Answers to AJ's UX notes, drawn into the mockup

- **A kill switch.** "All off" is a permanent key in the top bar. Pressing Esc twice does the same. It silences everything and does not stop the song's document from being edited.
- **Stopping one pattern.** Click a clip and press `0` to mute it (Ableton's key for deactivating a clip). This already exists in the tree (`clip.set mute`, `Digit0` in `arranger.js`), but nobody could find it. The mockup makes it findable: the arranger's hint line says so, a muted clip looks plainly off, and the toast confirms it ("Walk 2 is off: the bass sits out bars 5–8") with Undo.
- **Tap inside the song, with a click you can see.** Sketch says where you are recording: "Tapping into the song: bars 5–6, looping, with the click", under a red lamp.
  - Four beat lamps light in time, both in the top bar and large in Sketch. The step grid shows the playhead column and your hits from earlier passes. Each loop overdubs onto the last.
  - Count-in is a key next to Click.
  - The take lands where you tapped ("8 hits over 1 bar at bar 5").

## Type scale

Three faces, as BRAND.md sets them, at these sizes in the studio:

| Role | Face | Size | Used for |
|---|---|---|---|
| display | Archivo 800 italic, wdth 112–125 | 22–26 px | take letters (A, B), the welcome sticker's title |
| readout | Atkinson Mono | 24 px (17 px on a phone) | the position display (`005.3.1`) |
| title | Archivo 700 upright, wdth 112 | 17 px | the song title |
| body | Atkinson Next | 13.5 px / 1.5 | agent messages, the sticker |
| UI | Atkinson Next 600 / 400 | 13 / 12 px | track names, keys, tabs; device names under tracks |
| data | Atkinson Mono | 11–11.5 px | tool steps, History "where" lines, note ranges, times |
| silkscreen | Atkinson Mono, lower case, untracked | 10 px, `--text-3` | labels printed beside a control: `bpm`, `time`, `key`, `snap`, `out` |

Silkscreen is deliberately lower case and untracked, in the Teenage Engineering manner. It labels controls only and never sits above a heading, so it can't turn into the tracked-caps eyebrow from the audit. The capitals on device faces stay as they are.

The landing page keeps the hero overprint at 148 px (58 px on a phone) and body text at 20 px.

## Surfaces and elevation

**Square planes split by 1 px hairlines. No cards, no nesting.** From darkest to lightest:

| Plane | Token | Used for |
|---|---|---|
| well | `#0f0d0b` (new) | recessed windows: the position display, step grids, the mini lanes in takes, the text input |
| room | `--bg` | the arranger |
| panel | `--bg-2` | the top bar, Sketch |
| pane | `--panel` | Agent, History |
| raised | `--bg-3` | the selected Sketch mode, the fresh take, a hovered History row |
| paper | `--paper` | only the welcome sticker |

**Radius:**
- Keys and pads get 3 px. They are the only rounded rectangles, because they are physical.
- Clips and wells get 2 px.
- Planes get 0.
- Lamps and jacks are round, because they are round in real life.

**Shadow:** only two things float, the toast and the welcome sticker. They get `--lift`: a hard 1 px contact line plus one long, low, offset shadow. Nothing else casts a shadow, and nothing has an inner glow.

**The welcome card is a quick-start sticker on cream paper,** like the card in the box with new gear. It uses the riso inks for its lamp legend. It is the one place paper appears in the studio, so it reads as an object to peel off rather than one more panel.

## Colour use

- **Palette:** unchanged.
- **Leader green:** the playhead, the play lamp and a held take's lamp (all the playhead), and one primary key per region.
- **Grease pencil:** the loop line and the agent's pointer.
- **Red:** recording only.
- **Warm and cool:** lamps, author names, and the notes an author added. They never appear as a stripe, a fill behind text, a wash or a border on something with text in it.
- **Track colours:** clip fills at 15% over the room, with a 42% border. Notes are drawn at full strength.
- **Glow:** only on a lit lamp, at most 6 px. It is physical, so it's allowed.
- **Removed:** gradients, radial halos and tinted callouts.

## Motion

- Lamps switch on and off instantly, the way hardware does. The beat lamps and the playhead follow the audio clock and are never faked.
- A key presses in within one frame. Nothing lifts on hover. Hover is only the raised plane on rows.
- The toast slides 8 px up and fades in over 160 ms (`--ease`), and leaves the same way.
- The sticker appears without moving.
- The one bounce (`--ease-wiggle`) moves to a single job: a take lane arriving from the agent. Its letter drops in. Nothing else bounces.
- No pulsing dots. The agent's presence is its lamp being lit; when it is working, the session log adds one mono line per step as each step happens.
- Reduced motion: everything is instant. Nothing in this direction loops apart from what the audio drives.

## Iconography

- Three glyphs only: stop ■, play ▶ and record ●, drawn as SVG.
- Everything else is a word on a key (Click, Loop, All off, Band, Agent, Send), or a lamp.
- No icon library, no icon tiles, and no smiley `agent` icon or orb.
- The sparkle (`✦` and `icon('sparkle')`) is gone. The agent is "Claude" in cool ink with a cool lamp.
- Shortcuts appear as small `kbd` keys inside the button they trigger.
- The landing shows the four ways in as input jacks labelled `hum`, `tap`, `play` and `say`.

## What it removes from today's UI (cross-referenced to docs/research/AI-SMELLS.md)

| Audit # | Today | In this direction |
|---|---|---|
| 1 | Striped `.ag-take` cards nested in `.ag-card` | Take lanes: a display-face letter, a mini lane in a well, two keys, hairlines between |
| 2 | Striped History rows | A ledger: time, author in ink with a lamp, then the change, the reason and where. The share bar is a strip of tape. |
| 3, 7, 17 | Landing lanes, chat bubbles, track-sheet rows and song cards with coloured edges | Hero rebuilt with no boxes (see below). The remaining landing sections follow the same plan. |
| 4 | `✦` and the sparkle icon | Removed. Cool lamp and "Claude" in cool ink. |
| 5 | Library card bars and the "ASKED FOR" callout | Plan: library cards become plates on one plane; the request becomes a quote with an attribution |
| 6 | Orb avatar, gradient key card, three model cards | Plan: a status line (lamp, "Claude", state) and a model selector made of three keys |
| 8 | Striped Sketch takes (`.by-human/.by-agent`) | Take rows with a lamp. The fresh take sits on the raised plane. |
| 9 | 74 pill radii, Claude badges, status pills, tool-step chips | Square keys for toggles; lamp plus word for status; one mono line per tool step |
| 10 | Boxed-number, tracked-caps eyebrows; badge above the hero | None. The category line sits in the nav, in sentence case. |
| 11 | "X. Y." headlines and "not X, it's Y" | Hero lede rewritten as plain claims |
| 12 | Your chat bubble's right-side stripe | Session log: speaker column in ink, text beside it, no bubbles |
| 13 | Radial halos | None |
| 14 | Pulsing presence dot, decorative glows | Lamps only, lit or not |
| 18 | Accented headline phrase, bold lead-ins | None |
| 20 | Selected-row insets, provenance, gallery and docs stripes | Selection is a cream hairline or the raised plane. Print uses lamps or ink. |

## Implementation plan

Do it in this order. Each step is a separate commit with its screenshots retaken (`node tools/shots.js` for the landing images).

**0. Rule first** (CLAUDE.md and BRAND.md). Replace "authorship is an edge or a badge, never a fill" with:

> "Authorship is a lamp and an ink: a warm or cool lamp on the take and the author's name in their colour; never a stripe, a fill or a border on anything with text in it. Notes an author added are drawn in their colour."

Then update BRAND.md: "In the studio", the Colour paragraph, Motion (the bounce), and Illustration (the slate). `tools/brand-test.js` may grep for the old wording.

**1. Tokens** (`app/style/tokens.css`, values only, plus extras; the names in ARCHITECTURE.md don't change):
- Add `--well`, `--plate`, `--r-key: 3px`, `--hair` and `--lift`.
- Change the values `--r-2: 3px` and `--r-3: 2px`. Panels and sheets go square, and every existing user follows automatically.
- Change `--shadow-1` to `none`. Point `--shadow-2` at `--lift`, for the toast and popovers.
- Keep the washes, but stop using them for authorship.

**2. Shared atoms** (`app/style/app.css`):
- `.lamp` with `.w .c .on .g .r .y .ok`, `.ss` (silkscreen), `.key` with `.in .go .ghost`, `.kbd`, and `.ink-human` / `.ink-agent`.
- Delete the stripe rules on `.by-human` / `.by-agent` (app.css:7-8) and re-point those classes at the lamp, so every current user loses the stripe in one change.
- Turn `.badge-agent` (app.css:9-10) into `.ink-agent` text with a lamp.
- `app/src/ui/dom.js`:
  - Add `lamp(kind)`, a helper that maps a `by` to `w`, `c` or house through `store.author(by).kind`.
  - Delete the `sparkle` and `agent` icons once nothing references them.

**3. Components, by file:**

| File | Change |
|---|---|
| `app/src/agent/panel.js` | `.ag-card`/`.ag-take` become a take-lane list (letter, mini lane, Hold/Keep). Added notes are drawn cool, existing notes neutral; the existing piano-roll mini renderer can take a `by` per note. `.ag-bubble` becomes a log row. `.ag-chip` becomes a mono line. `.ag-bridge` and `ag-breathe` become a status line. `.ag-keycard`, `.ag-kc-orb` and `.ag-models` become a flat form with three model keys. `.ag-new` bounces the letter only. |
| `app/src/agent/history.js` | `.hi-row.k-*` become ledger rows: grid `46px 64px 1fr`, hairline, no radius. The share bar becomes a tape strip. Filter chips become keys. |
| `app/src/ui/arranger.js` | Clip header: lamp, then name in ink; remove the `✦` prefix (`:1496`). Track header: replace `.ar-swatch` and `.ar-auth` with a square cap. Selection uses corner marks. Muted clip: hatch plus `off`. The agent pointer is a dashed grease-pencil outline. The welcome card becomes the paper sticker, with the copy rewritten around lamps (`:119-145`). Remove the presence pulse and flash (`:1885-1889`). Put the existing `0` (mute clip) in the hint line. |
| `app/src/ui/transport.js` (top bar) | Fields with silkscreen labels; the display well; four beat lamps beside Click; Count-in; the **All off** key (Esc Esc). |
| `app/src/ui/sketch.js` | Modes column with lamps. The "Tapping into the song: bars …" line. Big beat lamps. The step grid with a playhead column. The fresh take on the raised plane with Keep (primary), Band and Agent. Remove the `.sk-mode-ic` glow (`:872`). |
| `app/src/ui/rack.js`, `browser.js`, `export.js` | Replace the sparkle with a lamp or a word. Selected rows (`.rk-prow.on`, `.br-row.on`) use the raised plane and lose the inset stripe. |
| `app/src/ui/shell.js` (`ui.toast`) | A flat readout: an author lamp, the text and an Undo key, with `--lift`. |
| `app/src/ui/provenance.js` | Print: an ink name and a filled or hollow dot in place of `border-left`. |
| `app/library.html`, `app/gallery.html` | Remove the `.lb-card::before` bar and the `.lb-stage` halo. `.lb-req` becomes a quote. `.lb-seg` and `.lb-who` become keys or ink. `.g-rig` loses its border-left. |
| `site/assets/site.css`, `site/index.html` | The hero as in the mockup: no slate or badge, no halos, the lede rewritten, Hum into it as a key with a lamp, the four jacks. `.lane`, `.lane-clip`, `.msg`, `.h-row` and `.rn-song` follow the studio's arranger, log and ledger, with no edges. Section slates lose their numbers; at most one slate is kept. The copy pass from audit #11. |
| `site/docs/docs.css`, `site/press/press.css` | The current nav item becomes ink plus a lamp, not a stripe. The `.jump` pills become a plain text row. |

**4. Checks.**
- Run `tools/brand-test.js` (contrast; the new well and plate planes need their text pairs added) and `tools/phone-test.js` (keys must stay at least 40 px tall on a phone, as in the mockup's take keys).
- Run `tools/compat-test.js`. `color-mix()` is used for clip tints; Safari 16.2+ and Firefox 113+ support it, otherwise precompute the tints in JS.
- Run the full suite. Retake `site/assets/*.webp` with `node tools/shots.js`.

## Risks

- **Lamps are small.** A 7 px dot carries less than a 3 px full-height stripe, and warm against cool at 7 px is harder for some colour-vision deficiencies. Mitigations: the author's name is always written next to the lamp, in ink; the house lamp is hollow; and the brand test can add a check on lamp hue separation. If it's still too quiet, raise lamps on clips to 8 px before reaching for any other mark.
- **It can turn cold.** Hairlines everywhere can read as a spreadsheet. The warmth comes from the graphite, the display italic, the paper sticker and the lamp glow. Don't drop those to make it "cleaner".
- **Silkscreen can become a tell again.** Mono labels are on Anthropic's list of current AI defaults. Keep them lower case, keep them next to controls, and keep them few (about 6 in the top bar). They must never introduce a section.
- **Square planes and the existing radius tokens.** Changing `--r-2` and `--r-3` moves every panel at once. Device faces set their own shape (`look`), so they shouldn't change, but check the pedalboard and the library shelf.
- **The rule change touches copy and tests.** The welcome card, GUIDE.md and brand-test.js all say "edge". Change them in the same commit as the rule.
- **Other agents are editing `arranger.js` and `sketch.js`.** Land the token and atom steps (1-2) first. They are small and conflict-free, and remove most of the stripes through the shared classes. Then do the per-file component work after those branches merge.
- **New UX behaviour, not just style.**
  - Clip mute already exists (`clip.set mute`).
  - All off needs a panic in the engine.
  - The beat lamps need the click's clock exposed to the UI.
  - "Tapping into the song" needs Sketch to record against the transport.

  Ship the look first, and these as their own changes with tests.
