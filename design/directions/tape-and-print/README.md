# Direction: Tape and print

The studio dresses in its own paperwork: track sheets, scribble strips, tape-box labels, crop marks and grease pencil on the desk, so every surface looks like something a working studio already uses rather than a web app's card kit. Who played what is signed the way a session is signed: a person's take in a warm grease-pencil hand, an agent's take with a cool rubber stamp, and the house's demo simply printed, with no coloured stripe anywhere.

Mockup: `index.html` in this folder (static, self-contained: fonts are the repo's own woff2 files copied into `fonts/`, the marks are `app/assets/logo.svg` and `wordmark.svg`, and every note, clip, tempo and name comes from Night Shift in `app/src/core/demo.js`). Screenshots: `tools/.out/directions/tape-and-print-desktop.png` (1440 wide, full page) and `tape-and-print-phone.png` (390 wide, full page). It changes no product code.

What's on the page, top to bottom:

- **Studio, 1440x900.** The top bar and transport, with a click and an "All off" key. The arranger has clips by the house (Beat, Walk, Changes), by Claude (Twinkle, stamped) and by you (Guitar Take 1, signed). Walk is selected and the agent is pointing at it; Hook is muted. Sketch shows Tap it with a count-in and a fresh Take 3 (Keep / Band / Agent). The Agent panel is a session log holding the A/B/C/D take folder. The welcome sheet and the toast are on screen too.
- **History**, as a track-sheet ledger, beside a specimen of the marks.
- **The landing hero.**
- **Phone, 390.** The arranger with the agent's take folder under it.

## Authorship and state

| | Mark | Where |
|---|---|---|
| **A person** | **Grease pencil.** The name ("you", "AJ", "guest Sam") set in Archivo Italic at `wdth` 78, weight 700, warm, rotated −4°, roughened by an SVG filter (displacement plus a wax-grain knockout), with a loose hand-drawn stroke under it. Their notes keep the track colour and get a warm 1 px outline. | Clip name, History "who" column, session log margin, Takes list, toast ("yours") |
| **An agent** | **Rubber stamp.** Mono 600 capitals, tracked, in a 2 px ruled box, cool, rotated −2° (alternating +1.5°), with an uneven-ink filter. Its notes keep the track colour with a cool outline; in a take folder the notes it *added* are cool. | Same places as the pencil, plus track headers for agent-made tracks/instruments |
| **The house** | **Printed.** Plain small mono "house" in `--text-3`. The demo is the pre-printed form, so it needs no mark. | History, welcome legend |
| **Selected** | **Crop marks**: four 9 px corners in cream, drawn 5 px outside the clip. No glow, no fill change. | Clips, take lanes, devices |
| **Muted** | **Hatched, ink off**: the clip keeps its outline, the body becomes 45° hairline hatching on `--bg`, the notes go grey, and a printed "muted" appears beside the name. | Clips, tracks |
| **Loop / agent's pointer** | **Yellow grease pencil** (`--accent-2`, unchanged in meaning): a hand-drawn bracket over the ruler for the loop, and a loose ring round whatever the agent is pointing at. | Ruler, arranger |
| **Playhead / primary action** | **Leader green**, as now: a 1.5 px line with a flag, and one filled key per region (Keep in Sketch, Open the studio). | Everywhere, sparingly |
| **Live / hearing** | An LED-like playhead inside the lane being auditioned, and the key reading "Hearing B". No pulsing. | Take folder |

The two marks follow the Weave: *played versus exact*. The pencil wobbles; the stamp is square and repeatable. They also scale: a grease-pencil name works for any person, and a stamp works for any agent (`CLAUDE`, `CLAUDE.AI`, `MCP:CURSOR`).

## Type scale

The faces stay the same; only how they're used changes.

| Role | Face | Size |
|---|---|---|
| Landing hero | Archivo ExtraBold Italic `wdth` 125, overprinted | 48–150 px / 0.95 |
| Studio display: "Tap it.", "This is Night Shift.", take letters A–D, "Take 3" | Archivo ExtraBold Italic `wdth` 112–118 | 15 / 20–24 px |
| Song title, on the reel label | Archivo ExtraBold upright `wdth` 112, in ink on paper | 15 px |
| Signature (person) | Archivo Bold Italic `wdth` 78, filtered | 13–17 px (22 in specimens) |
| Stamp (agent) | Atkinson Hyperlegible Mono 600 caps, +0.13em | 8–10 px (12 in specimens) |
| UI text | Atkinson Hyperlegible Next | 13 px base, 11.5 minimum for secondary, 13.5 for messages |
| Numbers, counters, ops, printed labels | Atkinson Hyperlegible Mono | counter 22 px; others 10–12 px, tabular |

Tracked capitals appear only where a real form prints them: ledger column heads, the stamp, and the hero's track-sheet fields. Nowhere else.

## Surfaces and elevation

- **The room is flat.** `--bg`, `--bg-2` and `--panel` as today. Regions are separated by hairline rules (`--line`, with `--line-2` for the rule a form prints under its head), never by cards. Nothing in the working UI has a shadow. Nothing is nested: the take folder is one ruled block in the log, with lanes split by hairlines.
- **One radius: 2 px**, a cut edge. No pills anywhere. Keys are square hardware keys, segmented choices are underlined text, and status is plain text, with a dot only when it is live.
- **Paper is the only elevation**, kept for things handed *to* you: the welcome sheet (a J-card: cream `--paper`, ink, a printed rule under the title, dashed rules round the legend), the toast (a strip of masking tape with torn ends, rotated −0.8°), the song's reel label in the top bar, and the landing tape box. Paper gets a real-object shadow and the grain. Because it is rare, it reads as "a note for you".
- **Registration marks** (crosshair-in-circle, `--line-2`) sit at the corners of large printed regions such as the landing hero and the History sheet. They are decoration in the print sense, so keep it to 2–4 per page.

## Colour

The BRAND values are unchanged. What changes is how each colour is spent:

- **Warm and cool are ink.** They appear as the signature, the stamp and note outlines. They are never a bar, a card fill or a tinted wash behind text.
- **Track colours** come as a dot sticker on the track header (studios colour-code reels and cables with round dot stickers) and as the clip body: a 17% `color-mix` of the track colour into `--bg`, with a 45% outline. The 6 px header strip goes.
- **Leader green**: the playhead and one primary key per region.
- **Grease-pencil yellow**: the loop and the agent's pointer.
- **`--rec`**: the record key and the All off glyph.
- **On paper**, warm and cool switch to the riso inks (`#f07612`, `#1b95dc`) so they hold on cream.
- **The print control strip** (riso warm, riso cool, their overprint green, paper, ink, leader, grease, room) closes the landing hero. It is the brand's palette shown the way a printer checks it.

## Motion

- **The pencil writes.** When a person's take lands, the signature's underline draws in left to right (`stroke-dashoffset`, 220 ms, `--ease`).
- **The stamp lands.** When an agent's take lands, the stamp goes from scale 1.06 and 0 opacity to 1 in 120 ms with no overshoot: a thunk, not a bounce. This replaces `--ease-wiggle`'s "the one bounce".
- **Tape is laid down.** The toast slides up 8 px and settles at −0.8° (180 ms). It leaves by fading, not flying off.
- **Crop marks snap.** Corners move from 3 px outside to 5 px outside in 120 ms.
- **What moves on its own is real.** The playhead, meters, the count-in lamps and the auditioned lane's playhead follow the sound. Nothing pulses or breathes: the presence dot, `ag-breathe` and `ar-flash` go.
- **Reduced motion**: every one of these is instant.

## Iconography

- The sparkle (`✦` and `icon('sparkle')`) and the smiley `agent` icon are gone. The agent is named, in its stamp. "Ask" buttons say "Ask Claude", or show a short straight cool stroke (the Weave's exact strand) when the space is too small for a word.
- Transport glyphs stay geometric (◼ ▶ ● ⟲). All off is a square inside a square in `--rec`.
- No icon tiles above headings and no icons on take actions: the take folder's keys are words (Hold to hear, Keep, Keep as it was).
- Empty states are a printed line plus a key, not an icon in a box.

## What it removes from today's UI (the AI-SMELLS.md list)

| Smell (audit #) | Today | Here |
|---|---|---|
| Side stripes (1, 2, 3, 5, 7, 8, 12, 20) | `inset 3px 0 0` on take cards, History rows, Sketch takes, chat bubble; `border-left` on library, landing lanes/chat/track sheet, gallery, provenance, selected rows, docs nav | None. Authorship is the signature or stamp. Selection is crop marks. Current nav item is bold text plus a rule *under* it. |
| Nested cards (1) | take cards in `.ag-card` in the panel | One ruled take folder; lanes split by hairlines |
| Sparkle (4) | `✦`, `icon('sparkle')` ×8 | Stamp / name / exact stroke |
| Orb avatar, gradient key card, three model cards (6) | `.ag-kc-orb`, `.ag-keycard`, `.ag-models` | Key form as a printed form: label, field, one line per model in a ruled list with a radio (not drawn in the mockup) |
| Pills (9) | Claude badges, status, tool chips, filters, stat chips | Square keys, underlined text filters, stamps; tool steps as one mono line each |
| Boxed numbered eyebrows, badge over the hero (10) | `.slate` with `01 ·`, "OVERDUB STUDIO" box | One track-sheet form row in the hero, where the labels are data (artist, over, reel/take, tempo); section numbers dropped |
| Two-beat headlines and "not X, Y" (11) | "Musicians talk in pictures. DAWs want numbers." etc. | Plain claims; the lede has no bold lead-in |
| Radial halos and spotlights (13) | hero halos, library stage | Flat room; registration marks and the colour strip carry the print idea |
| Pulsing and glowing dots (14) | presence, breathe, mode glow | Nothing loops except real audio |
| Bento grid, three-up features, cycling top edges (15–17) | `.rn-list`, "Open all the way down", `.rn-song` | A ledger (rows with rules) and a reel listing; songs as tape-box labels |
| Accented headline phrase, bold lead-ins (18) | `.lb-hero h1 em` | Same colour throughout; the overprint is the only two-colour heading |
| `·` meta and `→` decoration (19) | 154 / 40 | Commas, or columns in a ledger. The mockup's text uses no `·` joiners. |

## UX it carries (from AJ's notes)

- **Taking in the song.** Sketch says where the take goes: "Into **Drums**, bars **5–6**, over the song". It has a count-in (four lamps) and a click in the top bar.
- **Seeing your taps.** Each tap is drawn as a loose warm tick at the moment you hit it, over the 1/16 cell it snaps to, with bar.beat numbers under the grid and a playhead. You see where and when you tapped.
- **Killswitch and stopping parts.** "All off" sits in the top bar (Esc twice). Every clip can be muted on its own, shown as hatched with its ink off, and every track has M. A long take is stopped by muting that clip, without touching the track.
- **Takes as a take folder** (Logic and Ableton's model): A–D are lanes under one head, each with its notes, so you compare them by eye before you hear them.

## Implementation plan for Overdub

**0. Change the rule first** (AJ's call). In CLAUDE.md and BRAND.md (Colour; In the studio), replace "authorship is an edge or a badge, never a fill" with: "Authorship is a signature: a person signs in grease pencil (warm), an agent stamps (cool), the house is printed. Notes and clips carry a warm or cool outline; no coloured bars on text containers." Add the crop-mark, hatch and paper rules to BRAND.md. Retire the line "The History panel is a column of warm and cool edges".

**1. Tokens** (`app/style/tokens.css`; the names are a contract, so these are new extras, not renames):
- `--r-cut: 2px`. Then point `--r-1/2/3` at it, or reduce them to 2/3/4 px. Values belong to BRAND, so that's allowed.
- `--paper`, `--paper-2`, `--ink`, `--ink-2`, `--riso-warm`, `--riso-cool` move from `site.css` into tokens.
- `--grain` (data-URI noise).
- `--ease-stamp: cubic-bezier(.3, 0, .2, 1)`. Keep `--ease-wiggle` defined, but stop using it.

**2. Shared marks** (`app/style/app.css` plus a small `app/src/ui/marks.js`):
- `marks.sig(name)`, `marks.stamp(name)`, `marks.printed(text)` and `marks.by(app, by)`. `by` picks one of the three from `authorKind()`, which the arranger already uses.
- The two SVG filters (`#grease`, `#stampink`), injected once into the shell.
- Classes: `.sig`, `.stamp`, `.printed`, `.crop`, `.hatch`, `.paper`, `.tape`, `.key`.
- Replace `.by-human`, `.by-agent`, `.badge-agent` and `.badge-human` (`app.css:7-10`) with marks. Keep the old class names as no-op aliases for one release so nothing breaks.
- `dom.js`: delete the `sparkle` and `agent` icons and add `stroke-exact`.

**3. Components, by file:**
- **`app/src/ui/arranger.js`**
  - Clip name: `marks.by()`.
  - Selected clip: `.crop`.
  - Muted clip: `.hatch` (needs a per-clip `mute` field; if none exists, a new op `set_clip_mute` with its inverse in `core/ops.js`, and the engine skips muted clips).
  - Loop: an SVG bracket with the grease filter. Agent pointer: a ring.
  - Header: a dot sticker in place of `.ar-swatch`; `.ar-auth` goes.
  - Remove the `✦` prefix (`:1496`) and the presence glow and flash (`:1885-1889`).
  - Rebuild the welcome card (`:120-160`) as a `.paper` J-card with the three-mark legend.
- **`app/src/ui/transport.js`**: square keys, a reel label for the title, the click toggle and count-in lamps, and All off (stops the engine, kills voices, releases held notes; it needs an engine `panic()` if none exists).
- **`app/src/ui/sketch.js`**
  - A "Into <track>, bars a–b, over the song" line.
  - A count-in.
  - Raw tap ticks over snapped cells.
  - Takes as a ruled list with a mini strip; the fresh take gets Keep (primary), Band, Agent.
  - Mode glows (`:872`, `:905-911`) go, except the record lamp.
- **`app/src/agent/panel.js`**
  - The log becomes a two-column screenplay: a signature or stamp in the margin and the text in a measure. No bubbles.
  - `.ag-chip` becomes mono step lines.
  - `.ag-card` and `.ag-take` become one `.folder` with `.tk` lanes, each with a mini note strip (reuse the piano roll's note painter at strip size) and the Hold to hear / Keep row.
  - The key card becomes a printed form; `.ag-bridge` becomes plain text.
- **`app/src/agent/history.js`**: a `<table>` ledger (time, who, change and reason, undo). The share bar becomes a `.tape` strip. Filters become underlined text. Rows have no per-row background or radius.
- **`app/src/ui/browser.js`, `rack.js`, `export.js`, `provenance.js`, `pianoroll.js`**: sparkle out, badges become stamps, `.br-row.on` and `.rk-prow.on` use a `--bg-3` row plus crop marks, and the provenance print uses the marks (print-friendly: stamp boxes and pencil underlines survive greyscale).
- **`app/library.html`, `app/gallery.html`**
  - Cards lose `::before` and `border-left`.
  - "Asked for" becomes a quoted note in display italic: "asked for by AJ" in pencil, "built" with a stamp.
  - One authorship mark per card; the spotlight goes.
- **`site/assets/site.css`, `site/index.html`**
  - The hero form row replaces the slate and badge. Halos go; the colour strip and registration marks come in.
  - `.lane` is drawn as arranger lanes, `.msg` as a screenplay, `.h-row` as a ledger, `.rn-song` as reel labels.
  - Section numbers go.
  - A copy pass on the 11 lines the audit lists.
- **`site/docs/docs.css`, `site/press/press.css`**: the current nav item becomes bold plus an underline; `.jump` pills become text links.

**4. Checks.**
- `tools/brand-test.js` contrast on the new combinations, measured: ink on `--paper` 15.5:1; riso warm `#f07612` on cream 2.4:1 and riso cool `#1b95dc` 2.8:1. Both riso inks fail even the 3:1 large-text floor, so on paper the mark's *letters* go in `--ink` and the colour moves to the pencil stroke and the stamp's box. The mockup's welcome legend and toast still set the letters in riso; fix that in the build.
- Retake `node tools/shots.js` (the landing uses real screenshots).
- `tools/phone-test.js` and `compat-test.js` for the SVG filters in Safari and Firefox.
- Add a lint to `brand-test.js` that fails on `border-left` or `inset Npx 0 0` with `--human` or `--agent`, `border-radius: 99`, `✦` and `icon('sparkle')`, so the smells can't grow back.

**Order:** rule change → tokens and marks → History and the take folder (smells 1 and 2) → Sketch and arranger → the landing → library, docs and press.

## Risks

- **Pastiche.** Lean on stamps, tape and torn edges too hard and it turns into a scrapbook theme. Keep paper to four objects (welcome, toast, reel label, tape box), use one stamp per authored item, and keep the working surfaces flat and ruled. If in doubt, take the decoration out.
- **SVG filters.**
  - Cost: dozens of filtered signatures in a long History list, and Safari is slow at `feTurbulence`. Mitigation: render each distinct signature or stamp once to a cached `<canvas>`/`data:` image, or fall back to the unfiltered text when there are more than about 40 on screen. Test in `compat-test.js`.
  - Firefox draws filter regions differently, so set explicit `x/y/width/height` on each filter, as the mockup does.
- **Legibility.** The roughened italic at 13 px is a mark, not a label. Every signature carries the plain name as `aria-label` and in `title`; the History filter and the screen-reader text use plain words. Never sign a person's name below 13 px.
- **Reading pencil as "AI".** A rotated handwriting badge is a known trick of generated "playful" UIs. What keeps it honest here is meaning: it marks only people, and it pairs with the stamp that marks only agents. Don't use either decoratively (no stamps on buttons, no pencil on headings).
- **Contrast on paper** (above). Riso warm and cool letters on cream fail (2.4:1 and 2.8:1), so on paper the colour can only be in the stroke and the box.
- **Agent names grow.** `MCP:SOME-LONG-CLIENT` overflows a stamp. Cap it at 14 characters with an ellipsis; the full name goes in `title` and in History.
- **Clip mute is new behaviour,** not just a style. It needs an op, an inverse, engine support and a golden-render check. If it ships later, the hatch style can still mark muted *tracks* now.
- **Agents are editing `arranger.js` and `sketch.js` today.** Land the shared `marks.js` and the CSS first, then switch those files over in one small commit each.
