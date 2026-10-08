# Overdub

A web DAW where a musician and their agents play over each other. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
before changing anything: it is the contract between the core, the engine, devices, the UI and the agent layer, and it
says which module owns what. [`docs/UX-RESEARCH.md`](docs/UX-RESEARCH.md) is why the studio behaves the way it does;
[`docs/BRAND.md`](docs/BRAND.md) is how it looks and talks; [`docs/DEVICES.md`](docs/DEVICES.md) is how to write an
instrument or effect; [`docs/AGENTS.md`](docs/AGENTS.md) is how an agent drives the studio;
[`docs/GUIDE.md`](docs/GUIDE.md) is what a musician is told to press. Live at https://overdubstudio.com.

## Commands

```sh
node server/serve.js                 # http://localhost:3279/ (landing) and /app/ (the studio). No install, no build.
node server/mcp.js                   # MCP stdio server: `claude mcp add overdub -- node "$PWD/server/mcp.js"`
node tools/run-all.js                # every check, PAR=3 at a time (each tools/*-test.js prints ok/FAIL, exits 1 on failure)
LOCAL_ONLY=skip node tools/run-all.js   # as CI runs it: leaves out (and names) suites whose header says `// local-only: <why>`
node tools/<area>-test.js            # one area's checks; screenshots land in tools/.out/
node tools/docs-build.js             # rebuild site/docs/ after editing GUIDE, AGENTS, DEVICES, BENCH, REMOTE-MCP,
                                     # ARCHITECTURE or integrations/README.md (pages-test fails on a stale page)
node tools/render.js song.json --hash   # the canonical render
deploy/deploy.sh                     # ships the committed tree (git archive, never the working tree) to the live site
deploy/deploy.sh --next [REF]        # ships a committed ref to the preview, next.overdubstudio.com (deploy/README.md)
```

The browser checks use `tools/pw.js` (playwright-core + a cached Chromium; override with `PLAYWRIGHT_CORE`,
`CHROMIUM`, `HEADED=1`). Each opens the studio on its own server on a free port, so they can run in parallel.

## Rules

- **The song is the document.** Everything that changes a song goes through `store.dispatch(ops, { by })` — the GUI,
  the in-app agent and MCP agents alike. Never mutate `store.get()` directly. New kinds of change are new ops in
  `app/src/core/ops.js`, each with an exact inverse.
- **Every edit is attributed.** `by` is `'you'`, `'claude'` (the in-app agent), `'claude.ai'` (the remote connector),
  `'mcp:<name>'` (a local MCP client), `'overdub'` (the house) or `'guest:<name>-<browser>'` (a share link's sender).
  Warm (`--human`) is a person, cool (`--agent`) is an agent, everywhere. Authorship is a **byline**: the author's
  name in warm or cool ink, at the size of the text it signs (`byline(by)` in `app/src/ui/dom.js`); notes keep a warm
  or cool outline; no container is striped, tinted or filled by who made it; the house is unsigned. The kit is
  [`design/LINER-NOTES-KIT.md`](design/LINER-NOTES-KIT.md).
- **Levels are measured, not guessed.** Nobody building this can listen. Render offline (`engine.render`) and measure
  (`app/src/audio/measure.js`) after any sound change; devices pass `checkDevice` (`app/src/kernel/check.js`).
- **Kernels are code from whoever wrote them.** Share links, song files and device files carry them. They are
  evaluated only in the AudioWorklet (and, in Node, the renderer and the device check's child process), never on the
  page, which holds the songs and drives the agents: the main thread only parses kernel source. The worklet scope is a
  rule for determinism, not a security boundary; never call kernels "sandboxed" or "secure" in copy.
- **Renders are deterministic.** No `Math.random` in anything that makes sound; seed it (`dsp.rng(seed)`,
  `kit.rng(seed)`). Kernels can't call it at all and render bit-exact. Graph devices built on native nodes are held to
  −80 dB: a few vendored pedals (seasick and other pre-clock ones) move their LFOs from main-thread timers, so under
  heavy load two renders can differ by a hair. `tools/guitar-test.js` names them.
- **The canonical render is the Node one** (`node tools/render.js song.json --hash`); the browser is the preview.
  **Never regenerate `tools/golden.json` casually.** A moved hash means the sound moved: regenerate only the scenes
  you changed on purpose (`UPDATE_GOLDEN=<scene,...> node tools/golden-test.js`) and say which and why in the commit.
  It was made on Apple Silicon with Node 24; another V8 rounds `Math.exp`/`sin` differently in the last bit.
- **Ids are forever:** device ids (`core.*`, `pedal.*`, `amp.*`, `<author>.<slug>`), param keys, op names, storage
  keys (`overdub:*`; `app/src/main.js` copies the first evening's `earworm:*` keys over once) and the project format.
  Never rename one; add new fields so older readers skip them.
- **Zero dependencies, no build.** Native ES modules served as files. Chrome is the reference browser; Safari,
  Firefox and phones must keep passing `tools/compat-test.js` and `tools/phone-test.js`.
- **One loop, one key handler.** Panels draw in `frame(now)` from the shell's loop and declare keys with
  `ui.keys.add`. State lives in the store or `ui.state`, never in the DOM.
- **Copy is the engineer behind the glass.** Calm, quick, a little dry: say what was recorded, then what changed, then
  the number ("Take 2 is in: Claude doubled your keys an octave up. Keep it?"). Whimsy goes in device names and on the
  tape box, never on buttons. No invented users, quotes or stats. Device display names may change; ids never do.
- **Every public number is counted.** Tools, devices, demos, suites and checks in the README, the docs, the site, the
  deck and the launch drafts (both in the private `overdub-private` repo beside this one, read when present) come from
  the code or the last full run, and `tools/pages-test.js` (the claims block) checks tool, suite and check counts
  against the studio and `tools/.out/run-all.json`. Change one, change all of them.
- **Clawd-o-Matic is vendored, not forked.** `app/vendor/clawd/` holds verbatim copies of the pedals, amps and
  presets from Claw'd-o-Matic (`../clawd-o-matic/web`); `node tools/vendor-clawd.js` re-syncs them. Don't edit the copies.
