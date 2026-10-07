# Contributing

Thanks for wanting to help. Overdub is small on purpose: native ES modules, no dependencies, no build.

## Before you start

- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). It says which module owns what, and the rules a change must
  keep: every change to a song is an op dispatched through the store with an author, renders are deterministic, and
  ids are never renamed.
- Writing an instrument or effect? [`docs/DEVICES.md`](docs/DEVICES.md). Driving the studio from an agent?
  [`docs/AGENTS.md`](docs/AGENTS.md).
- For anything bigger than a fix, open an issue first so we can agree on the shape.

## Running it

```sh
node server/serve.js          # the site at http://localhost:3279/, the studio at /app/
node tools/<area>-test.js     # one area's checks
node tools/run-all.js         # every check (a few minutes)
```

The browser checks need playwright-core and a Chromium; `tools/pw.js` says where it looks (`PLAYWRIGHT_CORE`,
`CHROMIUM`). Chrome is the reference browser, and `tools/compat-test.js` and `tools/phone-test.js` hold Safari,
Firefox and phones to it.

## Sound changes

Nobody can judge a mix from a diff. After a change to anything that makes sound, render it offline and measure it
(`app/src/audio/measure.js`), and say what moved and by how much. `tools/golden.json` holds the hashes of the
canonical renders: if yours moves one on purpose, regenerate only that scene (`UPDATE_GOLDEN=<scene>
node tools/golden-test.js`) and say why in the pull request.

## Sounds

Contributed audio (samples, impulse responses, anything recorded) must be CC0, so anyone can ship it and nobody's
song owes it anything. Pin its source and add it to [`docs/SOUNDS.md`](docs/SOUNDS.md).

## Pull requests

Keep one change per pull request, with its checks passing, and copy that follows [`docs/BRAND.md`](docs/BRAND.md):
calm, quick, a little dry. By contributing you agree your work is released under the MIT licence in
[LICENSE](LICENSE).
