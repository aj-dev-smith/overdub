#!/usr/bin/env bash
# Every static check CI runs (.github/workflows/ci.yml, the static job), in one go: npm run check.
# The tools come from mise.toml (mise install); none of them is a dependency of the studio.
#
#   biome ci        lint (biome.jsonc) and the format check: npm run format writes it
#   tsc             types, for the files that opt in with // @ts-check (jsconfig.json)
#   ShellCheck      the deploy scripts
#   actionlint      the workflows; zizmor audits them for the usual Actions security slips
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
run() { echo "== $*"; "$@" || fail=1; }

run biome ci --reporter="${BIOME_REPORTER:-default}" .
run tsc -p jsconfig.json
run sh -c "git ls-files -z '*.sh' | xargs -0 shellcheck -S warning"
run actionlint
run zizmor --offline --min-severity=low .github

if [ "$fail" = 0 ]; then echo "static checks: ok"; else echo "static checks: FAIL"; fi
exit "$fail"
