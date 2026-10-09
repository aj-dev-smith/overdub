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
node server/serve.js                 # the site at http://localhost:3279/, the studio at /app/
node tools/<area>-test.js            # one area's checks
node --test "test/unit/*.test.js"    # the unit tests, what CI runs (seconds)
node tools/run-all.js                # every check (a few minutes): run it before a pull request
npm run check                        # the static checks CI runs: lint, format, types, shell, workflows (seconds)
npm run format                       # format the paths on the formatting ratchet (Biome)
```

The browser checks need playwright-core and a Chromium; `tools/pw.js` says where it looks (`PLAYWRIGHT_CORE`,
`CHROMIUM`). Chrome is the reference browser, and `tools/compat-test.js` and `tools/phone-test.js` hold Safari,
Firefox and phones to it.

## Static checks

`npm run check` runs what CI's static job runs: Biome's lint and format check, `tsc`, ShellCheck, actionlint and
zizmor. The checkers are pinned in `mise.toml`, not `package.json` (`mise install` fetches them), so the studio still
has no dependencies.

Lint covers the whole repo. Formatting and types are ratchets, turned on a piece at a time so nobody's open branch
is rewritten under them. Each step is a pull request of its own:

- **Type-check a file:** add `// @ts-check` as its first line, then make `npm run typecheck` pass, with JSDoc where
  inference falls short (`/** @type {Op} */`; the song's types are in `app/src/core`). Never take the line off a file.
- **Format a directory:** add it to `formatter.includes` in `biome.jsonc` and run `npm run format`. Nothing else
  goes in that pull request, and it lands when nobody has a branch open in that directory. A branch that conflicts
  with it can run `npm run format` itself before rebasing, and most of the conflicts go.
- **Turn on a lint rule:** take it off the list in `biome.jsonc` (each one there says why it's off), fix what it
  finds or suppress a deliberate case with `// biome-ignore <rule>: <why>`, and run the full suite. Some rules stay
  off for good: their fixes move the sound.

Some files are never formatted, wherever the list grows to: their source becomes kernel text, which is trusted by
its hash, or it ships inside a size-capped deploy. `biome.jsonc` names them and says why.

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
