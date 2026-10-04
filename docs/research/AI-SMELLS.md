# AI smells: what reads as generated, and where Overdub does it

Research for the style pass AJ asked for on 2026-10-01: "really just the ai smell of the boxes w/ the color on the left
side for a few pixels has to go … look into what are ai smells and avoid them. overall I do like the direction".
This changes no product code. Screenshots are in `tools/.out/smells/` (not committed; retake them with the two
scripts described at the end). Selectors and line numbers are as of commit `f47dac0` plus the working tree at about 08:00. Other agents are editing `arranger.js` and `sketch.js` this morning, so treat the selector as the pointer and the line number as a hint.

**In one paragraph.** The few-pixel coloured left edge is the most-cited single tell of AI-made UI in 2025-26, and
Overdub uses it as its authorship grammar. "Authorship is an edge or a badge" is written into CLAUDE.md and BRAND.md,
so the stripe shows up on every card that has an author: take cards, History rows, Sketch takes, library cards, chat
bubbles, the landing page's lanes, chat and track sheet, and the printed provenance report. That is about 20 rule
sites, and they are the first things a newcomer sees after "Try the demo agent". So the fix is a brand-rule change
first and a CSS change second. Next in strength: the sparkle glyph and icon used to mean "AI" (BRAND.md already
forbids it), the glowing orb avatar on the key card, pills on everything, numbered tracked-caps eyebrows on every
section, and a run of two-beat "X. Y." headlines. The parts that are clearly Overdub's own (the Weave, the
overprinted display type, the device faces and pedalboard, the tape box) don't read as generated, and they're what
to build the update around.

---

## 1. The tells, as designers name them in 2025-26

The sources broadly agree on why it happens. A model asked for a page with the look left open gives the median of
its training data: Tailwind defaults (indigo-500 buttons, which Adam Wathan publicly apologised for in August 2025),
shadcn/ui cards, Lucide icons, and the Linear/Vercel dark look. Visitors now recognise that median. What they take
from it is "nobody decided anything here" ([codemyspec][codemyspec], [prg.sh][prg], [Fountain Institute][fountain]).

### Visual

| Tell | What to check for | Sources |
|---|---|---|
| **Coloured side stripe on a card** | `border-left: 2-5px solid <accent>`, or the same drawn with `box-shadow: inset 3px 0 0`, or a `::before` bar. Often with `border-radius` on the other corners. The colour often cycles per card. | "The most recognizable tell of AI-generated UIs"; "almost as reliable a sign of AI-generated design as em-dashes for text" ([Robots on Payroll][rop]). "Multicolored side tabs on every block of content … a thin vertical bar on the left edge" ([Fountain][fountain]). "Side-tab accent border" and "border accent on rounded element" ([Impeccable][imp]). |
| **Sparkle ✦ for "AI"** | a four-point star glyph or sparkle icon on AI buttons and AI-made content | shadcn's `sparkle` icon is the stock "AI" mark ([shadcn.io][shadcn]). Our own BRAND.md forbids it: "no sparkle emoji to mean 'AI'". |
| **Purple/blue gradient glow** | an indigo-to-violet gradient, radial halos behind the hero, glowing borders on dark | "Purple gradients on everything"; "dark mode with decorative glow effects" ([Fountain][fountain]). "Radial-gradient background halo", "soft spotlight behind content", "dark mode with glowing accents" ([Impeccable][imp]). The cause ([prg.sh][prg], [DEV][dev]). |
| **"AI palette" on dark** | bright cyan on near-black; or near-black with a single acid-green or vermilion accent; or cream with a serif and terracotta (the Claude look) | "Purple gradients and bright cyan on dark backgrounds"; "cream / beige can become a default substitute" ([Impeccable][imp]). Anthropic's own frontend-design guidance lists "near-black background with a single bright acid-green … accent" and "warm cream background … terracotta" as current AI clusters ([frontend-design skill][fds]). |
| **Glassmorphism** | `backdrop-filter: blur` on cards used for decoration | ([Impeccable][imp]) |
| **Identical rounded cards** | content chopped into same-radius cards with the same soft shadow, cards nested inside cards | "Cards for every block of info"; "nested cards … a filing cabinet inside a filing cabinet" ([Fountain][fountain], [Robots on Payroll][rop]). "The SaaS-card kit … one border-radius on everything … the same soft grey shadow" ([frontend-design skill][fds]). |
| **Pills and badges everywhere** | `border-radius: 999px` chips for status, tags, nav and filters; a pill badge above the headline | "Badge above the main headline" ([Impeccable][imp]); "status dots that don't mean anything" ([Fountain][fountain]). |
| **Tracked caps eyebrows, numbered sections** | an all-caps, wide-tracked label above every heading; `01 / 02 / 03` markers on content that isn't a sequence; meta strings joined with `·`; `→` on links | "Tiny numbered section labels", "label above a heading" ([Impeccable][imp]). "A tracked-out ALL-CAPS eyebrow label above every heading; meta strings joined with middle dots ('A · B · C') … a monospace face for small data labels; a '→' appended to link and button text" ([frontend-design skill][fds]). |
| **Centred hero and three feature cards** | centred H1, two buttons, a glow behind; then a row of three cards, each with an icon, a two-word title and a sentence; then a bento grid | "Always three, never two, never four … an emoji or a thin-line icon, always a two-word title"; the stock section order ([Superdesign][sd]). "Identical card grids", "hero metric layout" ([Impeccable][imp]). |
| **Gradient or accented headline text** | one word or phrase of the H1 in a different colour or in a gradient | "Gradient text" ([Impeccable][imp]); "accenting just a single word or phrase in a headline" ([frontend-design skill][fds]). |
| **Decorative emoji or generic line icons** | emoji as bullets and feature icons; a rounded icon tile above every heading or empty state | "Emojis used as icons, bullets, and navigation items" ([Fountain][fountain]); "icon tile stacked above heading" ([Impeccable][imp]). |
| **Soft shadows on everything** | `0 4px 12px rgba(0,0,0,.1)` under every card; a hairline border plus a wide shadow | ([prg.sh][prg], [Impeccable][imp]) |

### Copy

| Tell | Example | Sources |
|---|---|---|
| Em-dash cadence | a dash in every other sentence, used for punch | [Wikipedia: Signs of AI writing][wiki], [Impeccable][imp] |
| Buzzwords | unlock, elevate, seamless, supercharge, world-class, delve | [Wikipedia][wiki], [Superdesign][sd] |
| Rule of three | triads of adjectives or benefits; three-beat slogans ("Save time. Work smarter. Scale faster.") | [Wikipedia][wiki], [Superdesign][sd] |
| Negative parallelism, forced contrast | "Not just X, it's Y"; "Not a feature. A platform." | [Wikipedia][wiki], [Impeccable][imp] |
| Mad-lib headline | "The AI-powered X for modern Y" | [Superdesign][sd] |
| Bold lead-ins, Title Case, emoji formatting | **Bold phrase.** then a sentence; emoji used as section markers | [Wikipedia][wiki] |

### Interaction and motion

| Tell | What to check for | Sources |
|---|---|---|
| Fade-up on everything | every block fades in from below at about 300 ms, staggered | [DEV: motion patterns][devmotion], [frontend-design skill][fds] |
| Hover lift on every card | `translateY(-2px)` plus a bigger shadow on hover | [DEV: motion patterns][devmotion], [Impeccable][imp] ("images that move on hover") |
| Pulsing status dot, blinking cursor | something keeps pulsing when nothing has changed | [Impeccable][imp], [Fountain][fountain] |
| Bounce or elastic easing | dialogs that overshoot | [Impeccable][imp] |
| Shimmer skeletons, typing dots | loading theatre | [DEV: motion patterns][devmotion] |

---

## 2. Audit

These pages were screenshotted at 1440x900 (`-d`) and 390x844 (`-m`). The landing page is the live site; the rest is
the local tree at `f47dac0` with `?demo&agentfast`. The CSS was grepped across `app/style/*.css`, `app/src/ui/*.js`,
`app/src/agent/*.js`, `app/*.html` and `site/**`.

**Raw counts** (the pattern tally from the grep script, across those files). Side stripes, as
`border-left|right|inline-start` with a colour or as `inset Npx 0 0`: about 20 authorship and selection sites, listed
below. Plus:

| Pattern | Count |
|---|---|
| `border-radius: 99px/999px/50%` | 74 |
| radius of 12-99 px | 29 |
| glow box-shadows in agent, human, accent, rec or ok colours | 45 |
| `radial-gradient` | 26 |
| `linear-gradient` | 36 |
| `text-transform: uppercase` | 44 |
| wide `letter-spacing` | 42 |
| `·` in strings | 154 |
| `→` | 40 |
| `@keyframes` | 30 |
| `translateY` | 22 |
| `backdrop-filter` | 7 |
| `icon('sparkle')` | 8 |
| `✦` | 2 |

Em dashes in user-facing copy are nearly gone (the earlier copy passes worked). The `—` hits are mostly comments.

### 2a. Every side-stripe instance (AJ's named tell)

| Where it shows | Selector, file:line | How it's drawn | Seen in |
|---|---|---|---|
| Demo agent's take cards (A/B/C/D) | `.ag-take`, `.ag-take-orig`, `app/src/agent/panel.js:659-660` | `inset 3px 0 0 var(--agent)` / `--text-3`, inside `.ag-card` (`:647`, shadow-1), inside the panel | `studio-agent-takes-d/m`, `zoom-agent-takes` |
| History rows | `.hi-row.k-human/.k-agent/.k-house`, `app/src/agent/history.js:166` | `inset 3px 0 0` warm/cool/grey, on a rounded bordered card per row | `zoom-history`, `studio-history-signed-d`; also the landing's `history.webp` |
| Sketch takes list | `.by-human` / `.by-agent`, `app/style/app.css:7-8`, used by `.sk-idea.by-human` (`app/src/ui/sketch.js:748`) | `inset 3px 0 0 var(--human)` on a rounded card | `studio-tap-take-d`, `zoom-sketch-take` |
| Your chat bubble | `.ag-bubble`, `app/src/agent/panel.js:603` | `inset -3px 0 0 var(--human)`: a right-side stripe on a 14 px bubble | `studio-agent-after-keep-d` |
| Vocabulary rows | `.ag-w`, `app/src/agent/panel.js:699` | `border-left` in the author colour | agent settings |
| Landing, "Four ways to lay down take one" | `.lane`, `site/assets/site.css:134`; `.lane-clip`, `:135` | `border-left: 5px solid var(--lane)` in four different track colours, plus a 6 px coloured top border on each preview. Fountain's "multicolored side tabs", exactly | `landing-full-d` (tile 2) |
| Landing, You/Agent chat | `.msg`, `.msg--human`, `.msg--agent`, `site/assets/site.css:152-154` | `border-left: 3px solid` warm/cool on rounded bubbles | `landing-full-d` (tile 3) |
| Landing, track sheet | `.h-row`, `.h-row--agent`, `site/assets/site.css:254-255` | `border-left: 3px` warm/cool on rounded rows | `landing-full-d` (tile 4) |
| Landing, demo song cards | `.rn-song`, `site/assets/site.css:359-366` | `border-top: 6px` in a cycling track colour, on a tinted rounded card | `landing-full-d` (tile 5) |
| Device library cards | `.lb-card::before`, `.lb-card.by-agent::before`, `app/library.html:56-57` | a 3 px `::before` bar on every card (grey for the house, cyan for Claude) | `library-d`, `library-full-d` |
| Library "ASKED FOR" callout | `.lb-req`, `app/library.html:70` | `border-left: 2px solid var(--agent)` + `--agent-wash` fill + `border-radius: 0 r r 0`. The textbook AI callout, and a card inside a card | `library-full-d` (tile 1) |
| Gallery rig cards | `.g-rig`, `app/gallery.html:55` | `border-left: 4px solid var(--bc)` | `/app/gallery.html` |
| Provenance report (print) | `.who` `:451-454`, `.device` `:481-483`, `.run` `:496-498`, `app/src/ui/provenance.js` | `border-left: 3-4px` house/warm/cool, with a dashed variant | Song → provenance |
| Selected row in Browser and rig list | `.br-row.on`, `app/src/ui/browser.js:208`; `.rk-prow.on`, `app/src/ui/rack.js:874` | `inset 2px 0 0 var(--accent-2)` | browser |
| Docs nav, current page; TOC | `.docs-nav a[aria-current]`, `site/docs/docs.css:51-53`; `.toc li a.is-here`, `:58-60` | `border-left: 3px` / `2px` grease pencil | `docs-guide-d` |
| Docs blockquote | `.prose blockquote`, `site/docs/docs.css:93` | `border-left: 3px solid var(--line-2)` (conventional for prose; weakest) | docs |
| Arranger track header | `.ar-swatch` (6 px track colour) and `.ar-auth` (2 px author line), `app/src/ui/arranger.js:1890-1892` | coloured bars at the head's left edge | `studio-first-d` |

The root is the rule itself: CLAUDE.md ("authorship is an edge or a badge, never a fill") and BRAND.md under
Colour ("a note keeps its track colour and gets a warm or cool edge") and In the studio ("The History panel is a
column of warm and cool edges you can read at a glance"). Designers need AJ to rewrite that rule (proposal in
section 4) before they touch CSS. Otherwise the next panel someone builds will grow a stripe again.

**What to keep.** `.ar-swatch` is the DAW's own idiom: Ableton, Logic and Bitwig all show the track colour as a strip on
the track header. It reads as a DAW, not as AI. A note's warm or cool outline in the piano roll is also fine,
because it is a property of a musical object, not a card decoration. The AI tell is the stripe on a *text card*.

### 2b. Everything else, by surface

**Studio, first view** (`studio-first-d`, `studio-first-m`)
- The welcome card's "The ✦ parts are Claude's" (`app/src/ui/arranger.js:139`), and the `✦` prefix on agent clip
  names (`arranger.js:1496`, visible as "✦ Twinkle").
- Browser: a cyan "Claude" pill on 8 of the first 20 rows (`.badge-agent`, `app/style/app.css:9`), and a "whole
  boards" pill. Tracked caps group heads ("WRITTEN IN THIS SONG", "INSTRUMENTS").
- Agent tab:
  - **Status pills:** "Claude no key" and a dashed "MCP ready" pill (`.ag-bridge`, `panel.js:593`).
  - **"Bring your own Claude" card:** a vertical gradient wash (`.ag-keycard`, `panel.js:679`) and a **glowing radial orb
    avatar** holding a smiley face (`.ag-kc-orb`, `panel.js:683`; the icon is `agent` in `app/src/ui/dom.js:77`).
  - **Three identical model cards:** Opus, Sonnet, Haiku (`.ag-models`/`.ag-model`, `panel.js:687-690`).
  - **Sparkle icons:** "Try the demo agent (no key)" uses one (`panel.js:270`).
  - **Tracked caps:** "MODEL" and "OR DRIVE THE STUDIO FROM CLAUDE CODE (MCP)".
- Arranger: a pulsing, glowing presence dot on the agent's track (`.ar-head.presence::after`, `arranger.js:1888`) and a
  glow flash (`:1885-1886`).

**Sketch** (`studio-sketch-d`, `studio-tap-take-d`)
- Glow halos on the selected mode icon and on Hum/Record (`app/src/ui/sketch.js:872`, `:905-911`). The record lamp glowing is
  physical and fine; the mode-icon glow is decoration.
- A row of pills: "Snap: A minor", "My timing", "With song", "F J K L play pads: on".
- The take card has a warm stripe (above) and a cool-outlined "Agent" pill button with the smiley icon.

**Notes** (`studio-pianoroll-d`): the empty state is a centred icon tile above a bold sentence
(`.pr-empty-card`/`.pr-empty-icon`, `app/src/ui/pianoroll.js:137`). That's the stock empty state.

**Devices** (`studio-rack-d`, `studio-rack-guitar-d`)
- "Ask" buttons with sparkle icons (`app/src/ui/rack.js:260`, `:625`, `:647`) and "Describe a sound and the agent can
  build it" with a sparkle (`rack.js:393`).
- "Nothing in the chain yet" is a card holding a pill cloud (Reverb, Delay, Compressor, Drive, EQ).
- The device faces themselves are not a tell: they are Overdub's most distinctive surface.

**Mixer** (`studio-mixer-d`): mostly clean. Channel strips are a DAW idiom. There's one coloured top edge per strip
(`inset 0 -3px 0 var(--ae)`, `app/src/ui/mixer.js:320`), which is the track colour on a strip, so it's DAW-native.

**Agent with the demo agent's takes** (`studio-agent-takes-d/m`, `zoom-agent-takes`, `studio-agent-after-keep-d`)
- **Three levels of nested cards:** striped take cards inside `.ag-card` (border, radius, shadow-1, `panel.js:647`),
  inside the panel.
- **Bounce on arrival:** `.ag-card.ag-new` uses `--ease-wiggle` (`panel.js:648`; `app/style/tokens.css:62` "the one
  bounce"). Impeccable lists bounce easing as a tell. Keeping it for exactly one moment is defensible.
- **Pills for every tool step:** each one is a bordered chip ("pointed at Bass", "measured −16.3 LUFS · Bass · bars
  1–4", "built Velvet Hush …"; `.ag-chip`, `panel.js:633`). Five in a row read as a log made of pills.
- **Emoji labels in the source:** the activity map (`app/src/agent/tools.js:88-109`: 👂 📖 👁 🎛 🔍 🎚 🎤) carries emoji
  for each chip. They render as small glyphs, so check before shipping anything that shows them raw.
- **Hover lift:** `.ag-take.on` uses `translateY(-1px)` (`panel.js:661`).
- **"Waiting for your pick…" plus a moving tape glyph:** this is fine. It names what it's waiting for.

**History** (`zoom-history`): the stripes (above) on bordered rounded cards with round avatar circles; pill filter
chips ("All 3", "You 2", "Claude 1"); and a tracked-caps "WHO WROTE THE NOTES".

**Landing** (`landing-fold-d/m`, `landing-full-d/m`)
- **Hero eyebrows:**
  - a boxed "OVERDUB STUDIO" badge above the headline, then a tracked mono caps line ("A STUDIO FOR YOU AND YOUR
    AGENTS"), then "REEL 1 · TAKE 2 · 92 BPM" (`site/index.html:51`; `.slate`, `site/assets/site.css:51-52`).
  - This is the "badge above the headline" plus "tracked caps eyebrow" plus "middle-dot meta" cluster.
- **Two radial halos** behind the hero, warm bottom-left and cool top-right (`site/assets/site.css:90`).
- **Numbered slates on all nine sections**, `01 · The room` through `09 · Where it came from`, as a boxed number plus
  tracked caps (`site/index.html:80-353`). The sections aren't a sequence, so the numbers are decoration.
- **Every section head in the same overprinted display style** (11 times). The overprint is the signature. Used on
  every head, it stops being a choice.
- **Two-beat contrast headlines:**
  - "Musicians talk in pictures. DAWs want numbers." (`:157`)
  - "Describe a sound. Get a device." (`:214`)
  - "Agents can't hear. So the studio measures." (`:231`)
- **Negative parallelism** in the copy:
  - "Not a mockup." (`:82`)
  - "It doesn't make the song for you. It plays on yours." (`:168`)
  - "Measured, never guessed." (`:233`)
  - press "Real captures, not mockups." (`site/press/index.html:188`)
- **The three-up feature row** "Open all the way down": "The song is a document. / Bring your own agent. / Devices are code."
  (`site/index.html:269ff`). Under it is a pill cloud of tool names.
- **A bento grid** for "Since the last session": tracked caps tags, an italic head and a paragraph per cell
  (`.rn-list`, `.rn`, `.rn-tag`, `site/assets/site.css:345-347`).
- **A hero-metric row** in the tape box: 16 / 101 / 27 / 156 / 26 with small caps labels (`.box-spec`,
  `site/assets/site.css:300`).
- **A bold lead-in sentence in the lede** ("**Your agent plays over it.**").
- **Not tells:**
  - the Weave hero
  - the gap table ("Make it warmer." → `lowpass 2.4 kHz`)
  - the Cathedral Below pedal
  - the pedalboard
  - the Side A / Side B track listing

  These are specific to this product. Lead with them.

**Device library** (`library-d`, `library-full-d`)
- **The accented headline:** "Every device in the house, and the ones **Claude built.**" sets the last phrase in cyan
  (`.lb-hero h1 em`, `app/library.html:38`).
- **Pill everything:**
  - segmented pill filters (`.lb-seg`, `:26-30`)
  - "The house" and "Built by Claude" pills (`.lb-who`, `:67`)
  - the "by Claude" badge drawn again on the face
  - a row of stat chips ("✓ check", "−16.1 LUFS", "−7.2 dBTP", "4.4% CPU", "2.9 s tail")
- **A radial spotlight** behind each face (`.lb-stage`, `:58`) and a blurred floor shadow (`:60`). This is borderline:
  it's a shelf, but the treatment is stock.

**Docs** (`docs-d`, `docs-guide-d`): rounded cards in a grid, each with a boxed number plus tracked caps
eyebrow ("01 GUIDE") and a middle-dot meta line ("9 sections · about 8 min · docs/GUIDE.md") (`.doc-card`,
`site/docs/docs.css:25-28`). The nav uses a stripe for the current page.

**Press** (`press-d`): the "PRESS KIT" boxed eyebrow, and a row of eight pill links (`.jump a`,
`site/press/press.css:25`). "Overdub puts an AI agent in that chair." is set in bold mid-paragraph.

**Phones** (`*-m.png`): at 390 px each striped card runs edge to edge, so the stripe is a full-height coloured rule
down the screen. That makes it louder on a phone than on a laptop. Take cards and History are the worst.

---

## 3. The top 20, ranked

Score = how strongly it reads as AI (1-5) × how visible it is on the newcomer's path (1-5): landing → studio → "Try
the demo agent" → History → library.

| # | Instance | Pointer | Reads AI | Seen | Note |
|---|---|---|---|---|---|
| 1 | Striped take cards nested in a shadowed card in the panel | `app/src/agent/panel.js:659-660` (`.ag-take`), `:647` (`.ag-card`) | 5 | 5 | The first thing "Try the demo agent" shows |
| 2 | Striped History rows (and the landing screenshot of them) | `app/src/agent/history.js:166` (`.hi-row.k-*`) | 5 | 5 | "A column of warm and cool edges" is the brand rule that made it |
| 3 | Landing "Four ways": a 5 px multicolour left border on each lane, plus a 6 px top border on each preview | `site/assets/site.css:134-135` (`.lane`, `.lane-clip`) | 5 | 5 | The exact "multicolored side tabs" pattern, above the fold of section 03 |
| 4 | Sparkle ✦ and the sparkle icon to mean AI | `app/src/ui/arranger.js:139`, `:1496`; `app/src/ui/dom.js:59`; used at `app/src/agent/panel.js:270`, `app/src/ui/rack.js:260,393,625,647`, `app/src/ui/browser.js` (2), `app/src/ui/export.js:370` | 5 | 5 | BRAND.md:268 already says no |
| 5 | Library cards: a stripe bar on every card, plus the "ASKED FOR" tinted left-border callout | `app/library.html:56-57` (`.lb-card::before`), `:70` (`.lb-req`) | 5 | 4 | The purest instance: border-left + wash + one-side radius |
| 6 | Glowing radial orb avatar, gradient-wash key card, three identical model cards | `app/src/agent/panel.js:679`, `:683` (`.ag-kc-orb`), `:687-690`; smiley `agent` icon `app/src/ui/dom.js:77` | 4 | 5 | The default right panel on first open |
| 7 | Landing chat and track sheet: striped rounded bubbles and rows | `site/assets/site.css:152-154` (`.msg`), `:254-255` (`.h-row`) | 5 | 4 | |
| 8 | Sketch take cards striped through the global classes | `app/style/app.css:7-8` (`.by-human/.by-agent`), applied at `app/src/ui/sketch.js:748` | 5 | 4 | Delete the classes and every user loses the stripe |
| 9 | Pills on everything: Claude badges ×8 in the Browser, status pills, filter chips, stat chips, tool-step chips, press nav | `app/style/app.css:9-10`; `panel.js:593`, `:633`; `history.js` filters; `app/library.html:26-30`, `:67`; `site/press/press.css:25` | 4 | 5 | 74 pill radii in the tree |
| 10 | Boxed-number tracked-caps eyebrows on every section, plus the badge above the hero | `site/assets/site.css:51-52` (`.slate`); `site/index.html:51`, `:80-353`; `site/docs/docs.css:25-28`; press | 4 | 5 | The sections aren't a sequence |
| 11 | Two-beat contrast headlines and negative parallelism in copy | `site/index.html:82`, `:157`, `:168`, `:214`, `:231`, `:233`; `site/press/index.html:188` | 4 | 4 | Rewrite as plain claims with a number or a thing |
| 12 | Your chat bubble with a right-side stripe | `app/src/agent/panel.js:603` (`.ag-bubble`) | 4 | 4 | |
| 13 | Radial halos behind the landing hero; spotlight behind library faces | `site/assets/site.css:90`; `app/library.html:58-60` | 4 | 3 | |
| 14 | Pulsing glowing dots and decorative glows | `app/src/ui/arranger.js:1885-1889`; `app/src/agent/panel.js:595`; `app/src/ui/sketch.js:872` | 3 | 4 | Keep the glow where a lamp is lit (record, LEDs, meters) |
| 15 | Bento grid "Since the last session" | `site/assets/site.css:345-347` (`.rn-list/.rn/.rn-tag`) | 4 | 3 | |
| 16 | Three-up feature row "Open all the way down", with a pill cloud of tool names | `site/index.html:269ff` | 4 | 3 | |
| 17 | Demo song cards with a cycling coloured top edge on tinted cards | `site/assets/site.css:359-366` (`.rn-song`) | 4 | 3 | |
| 18 | Accented phrase in the headline ("Claude built." in cyan); bold lead-ins mid-paragraph | `app/library.html:38`; landing lede; `site/press/index.html` hero paragraph | 3 | 3 | |
| 19 | Middle-dot meta strings and `→` everywhere (154 and 40) | e.g. `site/docs/index.html` card meta, `site/index.html:51` slate, `app/src/agent/tools.js` chip text | 3 | 3 | Fine in data such as "Bass · Walk · bars 1–4"; a tell in decorative meta |
| 20 | Long tail of stripes: provenance print, gallery rigs, selected-row insets, docs nav | `app/src/ui/provenance.js:451-454,481-483,496-498`; `app/gallery.html:55`; `app/src/ui/rack.js:874`; `app/src/ui/browser.js:208`; `site/docs/docs.css:51-60` | 4 | 2 | Sweep them in the same pass |

Further down the list:
- the stock empty state (`app/src/ui/pianoroll.js:137`)
- the hero-metric row in the tape box (`site/assets/site.css:300`)
- the bounce on agent arrivals (`app/style/tokens.css:62`)
- hover lift (`panel.js:661`, `site/assets/site.css:363`)
- the 11 identical overprinted section heads
- the palette (below)

**The palette, as context rather than a fix.** Near-black with a single leader-green CTA, cream text and paper, and
orange plus cyan on dark: each of these sits near a cluster that Anthropic's guidance and Impeccable now name as
generated defaults. AJ said he likes the direction, and here the colours carry meaning (warm is the person, cool is
the agent), which is the opposite of a default. So keep them. Spend no more of the look on them, and make sure the
*structure* (no stripe cards, fewer pills) is what reads as designed.

---

## 4. Directions for the designers (not a spec)

The brand already has better answers than the stripe. Authorship in Overdub is "played versus exact": the warm
strand breathes and the cool one is a pure sine. Use that instead of a coloured bar.

1. **Change the rule first.** In CLAUDE.md and BRAND.md, replace "authorship is an edge or a badge" with
   "authorship is a signature". The author's name or initial is set in their colour, where you'd sign a track
   sheet. No coloured bars on text containers. Notes, clips and lanes (musical objects) keep their warm or cool
   outline or corner tab.
2. **History as a real track sheet.**
   - Make it a ledger, not a stack of cards: hairline rows, a narrow fixed left column with the author's name in
     their colour, mono time, then the change and the reason.
   - Show the share bar as a strip of tape: two inks laid end to end.
   - Put zero radius on rows and no background per row.
3. **Takes as a take folder, not cards.**
   - Use what DAWs already show: Logic's take folders and Ableton's take lanes put takes under the part as lanes.
   - Draw A/B/C/D as stacked mini-lanes, each a thin clip with its notes. The letter goes in the display face at
     the left. Use one row of Hold/Keep controls per lane.
   - One container, no nesting. The cool colour lives in the notes the agent wrote, which is where authorship
     actually is.
4. **Chat as a session log.** Screenplay layout: speaker in small caps in a left margin column (warm "YOU", cool
   "CLAUDE"), the text in a measure beside it, no bubbles, no stripes. Tool steps become one indented mono line
   each ("measured −16.3 LUFS on Bass, bars 1–4"), not pills.
5. **Library "Asked for" as a note on the box.** The request is a quote. Set it in the display italic with an
   attribution ("asked for by AJ, built by Claude"), the way a J-card carries a handwritten note. No tinted box. One
   "by Claude" mark per card, not two.
6. **Landing lanes as real lanes.** "Four ways" is already "drawn as arranger lanes", so draw it exactly like the
   arranger: a track header on the left (name, M/S, the track-colour swatch, which is DAW-native) and the clip on
   the right. Drop the card background and the side and top borders.
7. **Kill the sparkle.**
   - For the agent's mark, use a short straight cool stroke: the cool strand of the Weave, exact.
   - Your mark is the same stroke with a wobble. The welcome card can say "the cool parts are Claude's" and show
     the stroke.
   - Replace the smiley-face `agent` icon and the orb with the same stroke, or with the name "Claude" as text.
8. **Eyebrows only where they're data.** Keep one slate: the hero's, or the tape box's. Drop the numbers from
   landing, docs and press sections, or keep them only where the content really is a sequence (the guide's steps).
9. **Pills: one job.** Pills only for toggles you press. Statuses go back to plain text with a dot only if the dot
   means something live. Badges go to text in the author's colour.
10. **Copy pass.** Replace the "X. Y." heads and "not X, it's Y" lines with plain claims carrying a thing or a number,
    in the engineer's voice. For example: "An agent can't hear your mix, so the studio measures it: −14 LUFS, true
    peak −1 dBFS."

**What the update should not touch:**
- the Weave
- the overprint on the hero line
- the device faces and their finishes
- the pedalboard
- the tape box
- the gap table
- mono numerals in meters

These are where Overdub looks like nobody else, and they're the reason AJ likes the direction.

---

## Screenshots (`tools/.out/smells/`)

| What | Files |
|---|---|
| Landing | `landing-fold-{d,m}`, `landing-full-{d,m}`, tiles in `tiles/landing-full-d-*.png` |
| Studio, first visit | `studio-first-{d,m}`, `zoom-welcome-card`, `zoom-agent-keycard`, `zoom-browser` |
| Studio tabs | `studio-{sketch,pianoroll,rack,mixer,history}-{d,m}`, `studio-notes-clip-d`, `studio-rack-guitar-d` |
| Tap it | `studio-tap-armed-d`, `studio-tap-live-d`, `studio-tap-take-d`, `zoom-sketch-take` |
| Demo agent | `studio-agent-takes-{d,m}`, `zoom-agent-takes`, `studio-agent-after-keep-d`, `zoom-agent-after-keep` |
| History | `studio-history-signed-d`, `zoom-history` |
| Library, docs, press | `library-{d,m}`, `library-full-{d,m}`, `docs-{d,m}`, `docs-guide-{d,m}`, `press-{d,m}`, `press-full-{d,m}` |

The two capture scripts used `tools/pw.js` (`open`/`openUrl`) and were kept out of the repo. Rerunning them means
opening `/app/?demo&agentfast`, then calling `ui.show(id)` for each panel, `.ag-demo` for the takes, and `KeyT` plus
F/J/K for a tapped take.

## Sources

- [Impeccable: The visible tells of AI design][imp], the most complete checkable catalogue.
- [The Fountain Institute: 7 Signs a UI Has Been Vibe Coded][fountain]
- [Robots on Payroll: How to avoid that vibe-coded look][rop]
- [prg.sh: Why your AI keeps building the same purple gradient website][prg] (on Adam Wathan's August 2025 indigo-500 post)
- [codemyspec: How to keep your website from looking like every other vibe-coded website][codemyspec]
- [Superdesign: Fix a generic AI landing page][sd]
- [DEV: AI purple problem][dev]
- [DEV: four UI motion patterns that stop looking AI-generated][devmotion]
- [Wikipedia: Signs of AI writing][wiki] (em dashes, rule of three, negative parallelism, bold, emoji)
- [shadcn.io: the sparkle icon][shadcn]
- Anthropic's `frontend-design` skill (claude-plugins-official; local copy at `~/.claude/plugins/cache/claude-plugins-official/frontend-design/*/skills/frontend-design/SKILL.md`), which lists the 2026 AI clusters: cream + serif +
  terracotta; near-black + one acid accent; the SaaS-card kit; tracked caps eyebrows; middle-dot meta; mono data
  labels; `→` on links.

[imp]: https://impeccable.style/slop
[fountain]: https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui
[rop]: https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look
[prg]: https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
[codemyspec]: https://codemyspec.com/blog/vibe-coded-websites-look-the-same
[sd]: https://superdesign.dev/blog/fix-generic-ai-landing-page
[dev]: https://dev.to/jaainil/ai-purple-problem-make-your-ui-unmistakable-3ono
[devmotion]: https://dev.to/kenimo49/framer-motion-view-transitions-api-4-ui-motion-patterns-that-stop-looking-ai-generated-25gg
[wiki]: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
[shadcn]: https://www.shadcn.io/icon/octicon-sparkle-24
[fds]: #sources
