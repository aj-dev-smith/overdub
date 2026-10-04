# Theme copy a rename can't fix

`node tools/rebrand.js --name "<Name>" --slug <slug>` swaps the word. It can't swap the idea. This is everything that
leans on the worm, the soil, or "a song stuck in your head", so the copy rewrite after the pick is a checklist, not a
search. Line numbers are from the repo **before** the rename; the rename doesn't add or remove lines except one import
near the top of `app/src/ui/export.js` (everything below line 15 there moves down one).

Not listed: plain mentions of the name (the script handles them), `app/vendor/**` (verbatim Claw'd-o-Matic copies),
and the sea-creature pedal and preset names from the Guitar Studio, which are heritage and stay.

## 1. The worm and the mascot

| where | what it says now | what to do |
|---|---|---|
| `docs/BRAND.md:12-14` | "the song you can't get out of your head … a small, slightly gross, friendly animal, which gives the brand a mascot for free" | Rewrite "The name" for the new name. |
| `docs/BRAND.md:16-22` | The alternates table (Translator, Hum, Luthier), each argued against the old name | Rewrite or drop; after the rename it reads "<Name> is also tap, play…", which may not be true of the new name. |
| `docs/BRAND.md:25-26` | Wordmark rule; it lists "EarWorm", "Ear Worm" and "EARWORM" as wrong spellings | The rename turns this into nonsense ("<Name>", "Ear Worm" or "<SLUG>"). Write the new name's own rule. |
| `docs/BRAND.md:82` | "**A worm, curled up.** The outer end lifts into a little head with one eye. That is the earworm, the mascot." | Delete the third reading (or replace it with the new mark's). The rename flags this line as a common-noun hit. |
| `docs/BRAND.md:85-87` | The mark's construction: "thick at the head to thin at the tail", "The eye is a hole (a mask)" | Rewrite for the new mark. |
| `docs/BRAND.md:99` | "The worm can be animated (it is in the hero)" | Rewrite. |
| `docs/BRAND.md:118` | `--accent` row: "**the worm pink.**" | Rename the role ("the accent" or the new name's colour). Keep the token name. |
| `docs/BRAND.md:146` | Fraunces: "soft, gooey … looks like it was squeezed out of a tube, which is the worm" | Re-justify the display face, or pick another. |
| `docs/BRAND.md:186-190` | "## Illustration and the mascot": "The worm is a line … one dot for an eye … Let it curl, peek and stretch" | Rewrite the section. Whimsy can stay (in names and pictures) without a creature. |
| `docs/BRAND.md:204` | "the worm's head bobs while the agent works" | Describe the new working indicator (see `ag-worm` below). |
| `app/style/tokens.css:3` | "The worm-pink accent is spent sparingly" | Comment only. Token names are a contract: change values, never names. |
| `app/style/tokens.css:9` | "Fraunces … is the gooey display serif" | Comment only. |
| `app/style/tokens.css:25` | `--accent: #ff8db4; /* the worm: primary action … */` | Comment (and maybe the value). |
| `app/style/tokens.css:61` | `--ease-wiggle` ("the one bounce") | Keep the NAME (contract); the bounce is fine without a worm. |
| `app/src/ui/spiral.js:11` | "the middle the worm (var(--accent))" | Comment only. |
| `app/src/ui/spiral.js:50` | "cool inside, the worm in the middle, warm outside" | Comment only. |
| `app/src/agent/panel.js:276`, `:580-581` | The agent's "working" indicator is `.ag-worm`, a row of cool dots crawling (`@keyframes ag-crawl`) | Visual reads as an inchworm. Restyle or keep; rename the class while you're in there. |
| `tools/brand-marks.js:8-9`, `:33-46` | The logo generator draws the spiral's thick "head" and cuts an eye into it (`eye = true`, the mask) | Retire or redraw it. **Don't run it after the swap**: it overwrites `app/assets` and `site/assets` with the old mark. |
| `tools/brand-marks.js:51`, `:87-89` | The wordmark generator: the **o** is the spiral | Same. |

## 2. "Stuck in your head" (the earworm idea, in copy)

| where | what it says now |
|---|---|
| `site/index.html:37` | Hero `<h1>`: "Get the song out of your head." |
| `site/index.html:11` | `og:title`: "Earworm: get the song out of your head" |
| `site/index.html:18` | `twitter:title`: the same |
| `site/index.html:271` | Closing section `<h2>`: "What's stuck in your head?" |
| `site/assets/og-card.html:25` | The social card's `<h1>`: "Get the song out of your head." (re-render with `node tools/brand-og.js`) |
| `README.md:3` | "**Get the song out of your head.** Earworm is a music studio…" |
| `docs/BRAND.md:30` | "**Primary: Get the song out of your head.**" (the primary tagline) |
| `app/src/ui/arranger.js:876` | The empty-song card's title: "What's stuck in your head?" |
| `app/src/ui/sketch.js:1` | Header comment: "Get the song out of your head the way it's in there" |
| `tools/demo-video.js:5` | Header comment: "Get the song out of your head." against the video's first beat (the end card at `:91` uses "A studio for you and your agents.", which needs nothing) |

"Get the song out of your head" still works for a non-worm name; it just stops being a pun. The alternates in
`docs/BRAND.md:32-42` ("A studio for you and your agents.", "Hum it. Tap it. Play it. Say it.") need nothing.

## 3. Soil and garden device names

Device **ids** (`core.poly`, …) are forever and stay; only `name` (and the header comment) changes. Names show in the
browser, the rack, the device faces and the screenshots; no test checks them. Each is listed once in
`app/src/devices/builtin/index.js:2-6` too.

| device | name now | where | theme |
|---|---|---|---|
| `core.poly` | Mycelium | `app/src/devices/builtin/poly.js:1`, `:9` | soil (fungus) |
| `core.bass` | Burrow Bass | `app/src/devices/builtin/bass.js:1`, `:9` | worm |
| `core.drums` | Topsoil Kit | `app/src/devices/builtin/drums.js:1`, `:15` | soil |
| `core.pad` | Loam Pad | `app/src/devices/builtin/pad.js:1`, `:9`; "lush straight out of the ground" at `:4` | soil |
| `core.eq` | Furrow EQ | `app/src/devices/builtin/eq.js:1`, `:8` | soil |
| `core.delay` | Tunnel Echo | `app/src/devices/builtin/delay.js:1`, `:9` | worm (burrow) |
| `core.limiter` | Bedrock | `app/src/devices/builtin/limiter.js:1`, `:9` | soil |
| `core.crush` | Gravel | `app/src/devices/builtin/crush.js:1`, `:9`; "clean to all gravel" at `:16` | soil |
| `core.keys` | Dewdrop Keys | `app/src/devices/builtin/keys.js:1`, `:13` | garden |
| `core.pluck` | Tendril | `app/src/devices/builtin/pluck.js:1`, `:10` | garden |
| `core.drive` | Hothouse | `app/src/devices/builtin/drive.js:1`, `:8` | garden |
| `core.chorus` | Cricket Chorus | `app/src/devices/builtin/chorus.js:1`, `:8` | garden bug |
| `core.filter` | Sieve | `app/src/devices/builtin/filter.js:1`, `:9` | garden tool |
| `core.width` | Spreader | `app/src/devices/builtin/width.js:1`, `:8` | garden tool, loosely |
| `core.comp` | Squash | `app/src/devices/builtin/comp.js:1`, `:10` | a vegetable, loosely ("squash" is also the compression word in `agent/lexicon.js`: leave that) |
| `core.verb` | Hollow | `app/src/devices/builtin/verb.js:1`, `:9`; also mentioned in `pad.js:4` | neutral |

Rename the instruments in the demo song's screenshots too: the arranger shows "Topsoil Kit", "Burrow Bass",
"Dewdrop Keys", "Tendril" under the track names, and the browser lists them all. `node tools/shots.js` retakes them.

Not soil: the demo's agent-built devices (Tidal Cathedral, Firefly, Night Bus in `app/src/devices/showcase.js`), the
song "Night Shift", and the landing page's Cathedral Below (`site/assets/pedal.js`). They suit a night/sea register
and can stay.

## 4. Copy that is true only while the mark is the spiral

The pitch spiral in the hum view is real music theory (one turn per octave) and should stay whatever the logo is. These
lines say the spiral **is the logo**, which stops being true if the new mark isn't one:

| where | what it says now |
|---|---|
| `docs/BRAND.md:71-99` | "## The mark: the spiral": three readings (pitch helix, cochlea, worm), construction, files, don'ts |
| `docs/BRAND.md:80-81` | "**A cochlea.** … Earworm is about ears." |
| `docs/BRAND.md:95` | `wordmark.svg`: "the **o** is the spiral" |
| `docs/BRAND.md:157` | Motion: "One thing moves on its own: the spiral." |
| `docs/BRAND.md:209` | "a living spiral hero" |
| `app/src/ui/spiral.js:1` | "The pitch spiral: the brand's logo, alive." |
| `app/src/ui/spiral.js:11`, `:50` | Colours "follow the logo" (also in section 1) |
| `app/src/ui/spiral.js:109` | "coloured like the logo, with a slow comet travelling out along it (it's alive)" |
| `site/assets/spiral.js:1` | "The living spiral: Earworm's mark, drawn as a real pitch helix" |
| `site/assets/spiral.js:99-102` | "the spiral body: tapered … (the logo, stretched to four octaves)", "one filled, tapered body (like the logo)" |
| `site/assets/site.css:2` | "One bold thing (the living spiral)" |
| `site/index.html:16` | `og:image:alt`: "The Earworm spiral: a hummed line in warm orange…" |
| `site/index.html:269` | The closing section shows `logo.svg` (`.last-mark`) next to "What's stuck in your head?" |
| `app/src/ui/dom.js:85` | The `spiral` icon (the Sketch tab). Fine as a pitch-spiral icon; check it still matches the new mark's style. |

## 5. Flagged by the rename (check the result reads right)

The script prints these as "ambiguous" on every run; they are here so nothing is a surprise:

- `docs/BRAND.md:82`: "That is the earworm, the mascot" (the common noun; section 1 deletes it anyway).
- `docs/BRAND.md:26`: the odd spellings "EarWorm" / "EARWORM".
- The MCP server name (`claude mcp add <slug>`, `serverInfo.name`): `CLAUDE.md:13`, `README.md:34`,
  `docs/AGENTS.md:16`, `server/mcp.js:5`, `:143`, `app/src/agent/panel.js:17`, `site/llms.txt:9`,
  `tools/agent-test.js:28`. A registration you already made under the old name keeps working; re-add it under the new
  one when you like.
- The attribution-log format `<slug>-provenance/0` (`app/src/ui/export.js:157`, `:220`; `tools/mix-test.js:498`,
  `:525`).
- `app/src/agent/panel.js:227`: "ask Claude Code to 'open the <slug> tools'".

Kept on purpose by the script (not theme copy, listed so it isn't mistaken for a miss): the browser storage keys
(`'earworm:*'`), the IndexedDB names (`earworm-assets`, `earworm-capture`) and absolute paths to the repo folder
(`~/Code/overdub/...`). Renaming those would orphan saved songs, API keys and recordings, or point at a folder
that doesn't exist.
