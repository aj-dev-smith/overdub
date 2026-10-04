# Liner notes

The studio is set like the back of a great record sleeve: a Swiss grid of hairline rules and whitespace, big Archivo
Expanded numerals and heads, and authorship written as a credit ("played by you", "played by Claude", "the house") in
warm and cool ink instead of a coloured stripe on a box. Nothing is enclosed unless it floats or you press it, so the
music (clips, notes, the playhead) is the only colour in the room and every name you read is a signature.

Mockup: `index.html` (open it as a file; fonts are the repo's own, copied from `deck/assets/fonts/` into `fonts/`).
Screenshots: `tools/.out/directions/liner-notes-desktop.png` (1440 wide, full page) and `liner-notes-phone.png` (390
wide, full page). Content is Night Shift's real notes (`app/src/core/demo.js`), parsed on the page.

## How authorship and state are shown

**Authorship is a signature.** This replaces "authorship is an edge or a badge" in CLAUDE.md and BRAND.md (the
audit's first recommendation, and a decision for AJ).

| Where | Today | Liner notes |
|---|---|---|
| Clip | warm/cool corner tab, `✦` before agent clip names | the author's name at the right of the clip's label line, in their ink: `house` (pencil, `--text-3`), `Claude` (cool), `you` (warm) |
| Notes | track colour, warm/cool edge | unchanged: track colour, plus a cool outline on notes an agent wrote |
| Track header | 6 px swatch bar + 2 px author line | a big track number (`01`), the name, an 8 px square swatch (the DAW idiom, kept, but not a bar), and "Firefly, by **Claude**" when the device was built by an agent |
| Take (Sketch) | striped card | a ledger row: a big take numeral, "tapped by **you**", the time, a mini roll, Keep / Band / Agent |
| Agent's takes | striped cards inside a shadowed card | one list under a heavy rule: a big cool letter (**A**, **B**), the idea, a preview roll where the house's notes are pencil and Claude's added notes are cool, Hold to hear / Keep; "as it was" last |
| Chat | bubbles, yours with a right-side stripe | a session log: the speaker's name in a 54 px margin column (warm "You", cool "Claude"), the text in a measure beside it, tool steps as mono lines (`listened  Bass, bars 1–4`) |
| History | striped rounded cards with avatar circles | a track sheet: time in the margin, name, change, the reason in italic, where in mono; one hairline per row; the share as big numerals over a strip of tape (pencil, warm, cool laid end to end) |
| Welcome | dark card, `✦`, "cool edge" swatches | a printed insert on paper: "This is Night Shift." and the credits with dot leaders (the house, **Claude**, **you**) in the paper inks |

**State** uses print marks, never a stripe:

- **Selected**: a 1.5 px cream frame, and the clip's label line printed in reverse (cream ground, room-coloured
  text), like a highlighted credit. The selected track's header steps up to `--bg-3`.
- **Muted**: printed in outline only. The fill goes, the notes become hollow pencil outlines, the frame is dashed, the
  name is struck through and the byline slot says "muted". It stays in the song; `0` toggles it (shown in the toast and
  the Sketch hint). This is AJ's "stop any individual pattern".
- **Pointed at by the agent**: grease-pencil crop marks at the four corners of the region, with a one-line label
  ("Claude: 2 takes, bars 1–4"). A printer's crop mark, not a glow.
- **Recording**: the record ink and nothing else: a red frame on the region being written, a red lamp beside
  "Recording take 4".
- **Playing**: leader green, the playhead only. The one primary action per region is also leader green (Play in the
  top bar, Keep in Sketch).
- **Toggles** (Click, Loop): a small square lamp, grease-pencil when lit. Toggles are the only lit controls.
- **Held** ("Hearing A"): the button inverts to cream while you hold it.

## Type scale

Display is Archivo at `wdth` 125, ExtraBold Italic, tabular figures where it is a number. UI is Atkinson Hyperlegible
Next; data is Atkinson Hyperlegible Mono.

| Role | Face | Size | Used for |
|---|---|---|---|
| Hero | Archivo 125 italic 800, overprinted | 48–154 px / 0.92 | the landing line only |
| Sheet head | Archivo 125 italic 800 | 40 px (28 on phones) | a page section ("Who played what") |
| Big numeral | Archivo 125 italic 800, tnum | 30–58 px | position `5.3.1`, the count-in `1 2 3 4`, take numbers, take letters, the History shares |
| Track number | same | 17 px, pencil | `01` … `06` |
| Bar numbers | same | 15 px | the ruler |
| Head | Archivo 125 italic 800 | 17–23 px | "Takes", "Bass, Walk", "Tap it", "This is Night Shift." |
| Section | Archivo 112 italic 800 | 13 px | Verse, Chorus |
| Body | Atkinson Next 400 | 13.5 px / 1.5 | messages, descriptions |
| Label | Atkinson Next 600 | 12.5–13.5 px | track names, take titles, buttons |
| Byline | Atkinson Next 600 (house: 400) | 11–12 px | the signatures |
| Data | Atkinson Mono 400 | 11.5 px | times, LUFS, bars, tool steps, note counts |
| Small label | Atkinson Next 400 | 10.5–11 px, pencil | "Tempo", "Meter", "Key" over their values, sentence case |

No tracked capitals anywhere in the studio. Labels are sentence case and sit above their value, like a spec sheet.

## Surfaces and elevation

- **Two planes.** The room (`--bg`) holds the arranger and the dock; the agent pane and History sit on `--bg-2`.
  That is the only difference in ground; everything else is separated by rules.
- **Three rules.** A hairline (`1px --line`) separates rows and regions and never closes a shape. A bar rule
  (`1px --line-2`) is for bar lines and input edges. A heavy rule (`2px --text`) sits above a region's title
  ("Takes", "Bass, Walk", the History panel, the landing columns), the way a sleeve opens a credit block.
- **No cards.** Lists are rows under a heavy rule. Nothing is nested. Containers have square corners.
- **One radius, 2 px**, for things you press (buttons, keys, pads, toggles). No pills.
- **Elevation only for things that float**, and only one shadow: the welcome insert (paper) and the toast. Menus
  would take the same.
- **Paper** is used once in the studio: the welcome insert, in `--paper` with ink text and two darker paper inks
  for the bylines (`--ink-human #9a4400`, 5.5:1; `--ink-agent #085f92`, 5.7:1 on cream; the riso pair is too light
  for 12 px text).
- The brand's fine grain sits over everything at 5%.

## Colour use

- **Warm and cool are inks, not fills.** They colour names, take letters, the agent's added notes, the History share
  tape and the two strands. No container is striped, tinted or filled by who made it.
- **Track colours** are the clip fills (13% over the room), outlines (42%) and note colour. They carry "which part",
  never "who".
- **Leader green**: the playhead and the one primary action in a region. **Grease pencil**: the loop line, lit
  toggle lamps, crop marks on what the agent points at. **Record red**: the take being written, the record button, the
  All off button's edge.
- **Pencil** (`--text-3`) is the house's ink: the demo's bylines, track numbers, muted notes.
- Gone: the washes as authorship, glow box-shadows (only lit lamps glow: record, the click's toggle), gradients.

## Motion

- Things you do move; nothing else. The playhead and meters follow the sound.
- The count-in and the click are drawn: four big numerals, the current beat in cream, past beats in pencil, the
  next in rule grey. The top bar's beat lamps (bar 1 wider) mirror them. Both follow the audio clock, never a CSS
  animation.
- Taps land on the song strip as you play them, warm ticks over the house's pencil grid, so you see where they fell.
- Arrivals: 160 ms fade and 4 px settle on `--ease`, for the insert, the toast and a new take row. The one bounce
  (`--ease-wiggle`) is kept for a single moment: the agent's take list arriving. No hover lift, no pulsing presence
  dot (a still cool dot means "connected"), no fade-up on scroll.
- Reduced motion: everything is instant.

## Iconography

- Mostly words. Tabs, toggles and most buttons are text.
- Transport keeps its three glyphs (square, triangle, ring) because every musician reads them.
- The sparkle (`✦` and the `sparkle` icon) and the smiley `agent` icon are gone. The agent's mark is a short straight
  cool stroke (the Weave's exact strand); a person's is the same stroke with a breath. Used on the Agent button and
  nowhere decorative.
- Keys are shown as keycaps (`kbd`), the one bordered inline element.

## What it removes from today's UI

Against the audit's top 20 (`docs/research/AI-SMELLS.md`):

1. Striped take cards nested in a shadowed card: now a ruled list, no nesting (`.ag-take`, `.ag-card`).
2. Striped History rows: now a ledger (`.hi-row.k-*`).
3. The landing's multicolour lane borders: the landing hero shown here has none; the "Four ways" lanes should be
   drawn exactly like the arranger above (header + clip, no card).
4. `✦` and the sparkle icon: gone, replaced by bylines and the cool stroke.
5. Library stripe bars and the tinted "Asked for" callout: same treatment as History (byline, a quoted request in
   display italic with "asked for by …, built by Claude").
6. The orb avatar, gradient key card and three identical model cards: the key card becomes a sheet head and a plain
   ruled list of models.
7. Landing chat and track-sheet stripes: session log and ledger, as in the studio.
8. Sketch take stripes: ledger rows with a big take numeral.
9. Pills: none. Toggles are square lamps; badges are bylines; filters are underlined words; tool steps are mono lines.
10. Boxed-number, tracked-caps eyebrows and the badge above the hero: gone. Figures here are numbered only because
    they are figures; the landing hero has no eyebrow.
11. Two-beat headlines: the mockup's heads are names ("Who played what", "Takes", "Bass, Walk").
12. Your chat bubble's right stripe: gone with the bubbles.
13. Radial halos: gone; the hero sits on the room and its grain.
14. Pulsing dots and decorative glows: only lamps glow.
15–17. Bento grid, three-up features, cycling top edges on song cards: not in the mockup; the sleeve's grid replaces
    them (credits columns, ledgers).
18. Accented phrase in a headline, bold lead-ins: gone (the landing lede has no bold sentence).
19. Middle-dot meta and decorative `→`: meta is written as a phrase ("8 hits, 1 bar, bar 5"), separators are
    commas.
20. Selected-row stripes, docs nav stripes, gallery rigs, provenance print: reverse print for selection, underline
    for the current page, bylines for authors.

Also added, from AJ's notes, as part of the look: the **All off** killswitch in the top bar (`Esc Esc`), per-clip
mute with `0` and its toast, the click with a count-in in the transport, and Sketch recording *into the song* at the
playhead with the count, the strip and the take region visible.

## Implementation plan for Overdub

**0. The rule (first, AJ's call).** CLAUDE.md, Rules: replace "authorship is an edge or a badge, never a fill" with
"authorship is a signature: the author's name in their ink, where you'd sign it; notes keep a warm or cool outline;
no container is striped, tinted or filled by who made it". BRAND.md: same in Colour and In the studio ("The History
panel is a column of warm and cool edges" becomes "a track sheet of signed lines"); Illustration: drop the numbered
slate except on the tape box. `tools/brand-test.js` copy checks follow.

**1. Tokens** (`app/style/tokens.css`; names are a contract in ARCHITECTURE.md, so these are additions):
`--rule`, `--rule-2`, `--rule-heavy`, `--r-press: 2px`, `--ink-human`, `--ink-agent` (paper bylines),
`--paper`, `--ink`, `--ink-2` moved from `site.css` so the studio can use paper. Change values, not names:
`--r-1` 5→2, `--r-2` 10→2, `--r-3` 18→0 (panels and sheets square), `--shadow-1` → `none` (keep `--shadow-2` for
floating things). Add `.num`, `.disp`, `.disp-s` font utilities to `app/style/app.css`.

**2. Shared components** (`app/style/app.css`, `app/src/ui/dom.js`):
- `byline(by)` in `dom.js` (`h('span.by.by-'+kind, name)`), used everywhere authorship shows; delete `.by-human`,
  `.by-agent` stripe classes and `.badge-agent` / `.badge-human` pills (app.css:7-10) and move callers to it.
- `.btn` / `.btn-go` / `.btn-txt` / `.tog` (square lamp) / `kbd`; retire pill radii (the 74 `99px`/`50%`).
- `icon('sparkle')` and `icon('agent')` in `dom.js`: replace the paths with the cool stroke; then remove the sparkle
  calls (`panel.js:270`, `rack.js:260,393,625,647`, `browser.js`, `export.js:370`).
- `.ledger` (track-sheet rows), `.sheet-head` (heavy rule + display head), `.crop` (grease-pencil marks).

**3. Files, in the order a newcomer meets them:**
- `app/src/ui/arranger.js`: header layout (number, name, square swatch, byline; drop `.ar-auth`), clip label line with
  byline (drop the `✦` at the clip-name site and the corner tab), selected = reverse label + frame, muted = outline +
  strike, crop marks for `presence` pointing (replaces `.ar-head.presence::after` pulse and `ar-flash`), ruler numerals
  and section names in display, welcome card as the paper insert with credits. Clips are canvas-drawn: the label
  line and outlines move into the draw code, not CSS.
- `app/src/ui/shell.js` / top bar in `app.css`: position as a big numeral, spec-sheet labels, click lamps, All off.
- `app/src/agent/panel.js`: session log (`.ag-bubble` → margin speaker), tool steps as mono lines (`.ag-chip` →
  `li`), takes as a ruled list (`.ag-card`, `.ag-take`, `.ag-take-orig`), the key card and models as a sheet.
- `app/src/agent/history.js`: the ledger, share numerals and tape, underlined filters.
- `app/src/ui/sketch.js`: take rows (`.sk-idea`), mode list, the count and the song strip.
- `app/src/ui/browser.js`, `rack.js`, `mixer.js`, `pianoroll.js`: bylines for "Claude" pills, selection by
  reverse print instead of `inset 2px` stripes, the empty state as a sentence with a button (no icon tile).
- `app/library.html`, `app/gallery.html`, `app/src/ui/provenance.js`: bylines and ledgers; the print report becomes a
  real sleeve (it already is paper).
- `site/assets/site.css`, `site/index.html`: hero without badge, eyebrow or halos; the credits block; "Four ways" as
  arranger lanes; chat and track sheet as log and ledger; drop numbered slates (`.slate`) except the tape box; the
  bento and three-up rows become two credit columns. `site/docs/docs.css`, `site/press/press.css`: underline for the
  current page, no pills, no boxed numbers. Then `node tools/shots.js` (the landing's screenshots are real) and
  `node tools/docs-build.js`.

**4. Checks.** `tools/brand-test.js` (contrast of the paper inks and of `--text-3` bylines at 11 px; the copy rules),
`tools/phone-test.js` and `tools/compat-test.js` (the phone layout drops the device line and the house byline in clips
to make room), and the UI tests that select by class (`.ag-take`, `.hi-row`, `.sk-idea`, `.badge-agent`): keep the old
class names on the new elements during the move so tests and `tools/shots.js` keep finding them.

## Risks

- **Bylines are quieter than stripes.** A column of stripes reads at a glance from across the room; names need a
  look. History's share tape and the big cool A/B letters carry the glanceable part; if it is still too quiet, the
  fallback is a warm/cool initial in the margin column, not a stripe.
- **Clip labels get crowded.** Short clips (one bar, 105 px) can't fit name + byline. Rule: the byline drops first,
  and the notes' cool outline still says "agent". On phones the house byline is always dropped.
- **Cool notes at small sizes read as cool fills.** In 4 px preview rolls the outline is the note. The mockup fills
  Claude's added notes cool in the take previews only; the arranger keeps track-colour fill with a cool outline.
- **Track colour 5 (slate) sits close to cool.** Bass is slate in Night Shift, so its notes can look "agent". The
  preview rolls draw the house's notes in pencil for that reason; the palette may want slate nudged warmer.
- **Square and flat can read as unfinished** if the grid slips. This direction only works with strict alignment
  (one baseline per row, the 54 px margin column, the 16/18 px gutters). It needs a careful pass, not a CSS swap.
- **The rule change is a brand change.** It touches CLAUDE.md, BRAND.md, the brand test and the landing copy; it
  should land as one decision before any panel is restyled, or new stripes will keep arriving.
- **Archivo numerals at 30–58 px** cost space in a dense top bar (the mockup's bar is 68 px, up from about 52). On
  laptops under 1280 px, Meter and the LUFS readout fold into the Song menu.
- **Other agents are editing `arranger.js` and `sketch.js`.** Land tokens and shared components first, then one
  panel per change, so the diffs stay small and mergeable.
