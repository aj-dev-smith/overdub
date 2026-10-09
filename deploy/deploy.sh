#!/usr/bin/env bash
# Deploy Overdub to https://overdubstudio.com (the bucket keeps its first name): the landing page (site/), the studio (app/) and the public docs.
# Text files revalidate every time (no-cache + ETag, so a deploy is live at once); media caches for a day.
# Sampled kits (app/kits/<sha256>.odk, gitignored: node tools/fetch-kits.js builds them) go up from the working tree,
# each checked against its name, gzipped, and cached for good (a file named by its hash never changes), with its packed
# twin (<sha256>.odkz, which the studio fetches first and unpacks back to the .odk; the .odk stays as the fallback).
# Every kit the shipped code names must be here, or nothing is deployed; they go up before the code that names them.
# Run deploy/setup.sh once first. Usage:
#   deploy/deploy.sh [--skip-tests]                  the live site, from REF (default HEAD)
#   deploy/deploy.sh [--skip-tests] --next [REF]     the preview, https://next.overdubstudio.com (deploy/next/setup.sh
#                                                    once first), from REF (default HEAD): any committed ref; one
#                                                    older than the ribbon (app/src/ui/preview.js) ships without it
#   DRY_RUN=1 deploy/deploy.sh ...                   stage the files and print the plan; no AWS calls
# app/site-config.json, the deploy's switches, is never committed: this script is its one writer, for both sites. It
# starts from deploy/site-config.json (gitignored; SITE_CONFIG=<file> reads another), else {}. The preview's copy adds
# "env": "preview", "preview": true and the commit, so the studio wears the Preview ribbon (app/src/ui/preview.js); every
# other key is kept as it is. With no "preview" key a studio is the live site.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARGET=live TESTS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) TESTS= ;;
    --next) TARGET=next; if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then REF=$2; shift; fi ;;
    *) echo "deploy.sh: unknown argument $1 (usage: deploy/deploy.sh [--skip-tests] [--next [REF]])"; exit 2 ;;
  esac
  shift
done
DRY=${DRY_RUN:-}
if [ "$TARGET" = next ]; then
  BUCKET=next.overdubstudio.com HOST=next.overdubstudio.com IDFILE="$ROOT/deploy/.next-distribution-id" SETUP=deploy/next/setup.sh
else
  BUCKET=overdub.ajsmithhq.com HOST=overdubstudio.com IDFILE="$ROOT/deploy/.distribution-id" SETUP=deploy/setup.sh
fi
if [ -n "$DRY" ]; then DIST=EDRYRUN
elif [ -f "$IDFILE" ]; then DIST=$(cat "$IDFILE")
else
  DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$HOST')].Id | [0]" --output text)
  [ "$DIST" != "None" ] && [ -n "$DIST" ] || { echo "no CloudFront distribution for $HOST: run $SETUP"; exit 1; }
fi
# a change: run it, or in a dry run print it
x() { if [ -z "$DRY" ]; then "$@"; else echo "+ $*"; fi; }
cd "$ROOT"

if [ -n "$TESTS" ]; then
  node tools/core-test.js | tail -1
fi

# Ship exactly what is committed (REF, default HEAD), never a half-edited working tree.
REF=${REF:-HEAD}
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
DOCS=""
for f in AGENTS ARCHITECTURE DEVICES UX-RESEARCH VISION BRAND REMOTE-MCP GUIDE BENCH; do
  git cat-file -e "$REF:docs/$f.md" 2>/dev/null && DOCS="$DOCS docs/$f.md"
done
git archive "$REF" site app $DOCS | tar -x -C "$STAGE"
SHORT=$(git rev-parse --short "$REF^{commit}")
# The deploy's switches (app/src/ui/preview.js reads env, preview and ref; other modules may read other keys), never
# committed: deploy/site-config.json when there is one, else {}. The preview's copy adds its three keys and keeps the rest.
SITE_CONFIG=${SITE_CONFIG:-$ROOT/deploy/site-config.json}
if [ -f "$SITE_CONFIG" ]; then cp "$SITE_CONFIG" "$STAGE/app/site-config.json"; else echo '{}' > "$STAGE/app/site-config.json"; fi
if [ "$TARGET" = next ]; then
  node -e 'const fs = require("fs"), [file, ref] = process.argv.slice(1);
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error(file + " is not a JSON object");
    fs.writeFileSync(file, JSON.stringify({ ...c, env: "preview", preview: true, ref }, null, 2) + "\n");' "$STAGE/app/site-config.json" "$SHORT"
fi
# Paths committed but held back from both sites until AJ decides (empty now: the community gallery, site/community/,
# ships since 2026-10-06; docs/COMMUNITY-SHELF.md, "Where it's on"). The studio's built snapshot, app/community/, is
# gitignored, so it never ships. The sync below runs with --delete, so taking a path off this list is what puts it live.
HELD_BACK=()
for p in ${HELD_BACK[@]+"${HELD_BACK[@]}"}; do rm -rf "${STAGE:?}/$p"; done
echo "$TARGET: $SHORT ($REF): $(find "$STAGE" -type f | wc -l | tr -d ' ') files -> s3://$BUCKET, distribution $DIST"
echo "app/site-config.json: $(tr -d '\n ' < "$STAGE/app/site-config.json")"

# the sampled kits the shipped devices name (data: { kit: 'sha256-<hex>' }): each must be here and be its own hash
# (a dry run names a missing kit and plans without it, so the plan can be read on a checkout that hasn't built them)
KITS=$( (grep -rhoE "sha256-[0-9a-f]{64}" "$STAGE/app/src/devices" || true) | sort -u | cut -c8-)
HAVE=""
for name in $KITS; do
  f="app/kits/$name.odk"
  if [ ! -e "$f" ] && [ -n "$DRY" ]; then echo "dry run: $f isn't here, so a real deploy would stop (node tools/fetch-kits.js builds it)"; continue; fi
  if [ ! -e "$f" ]; then echo "not deploying: $f isn't here (node tools/fetch-kits.js builds it)"; exit 1; fi
  sum=$(shasum -a 256 "$f" | cut -d' ' -f1)
  if [ "$sum" != "$name" ]; then echo "not deploying: $f's SHA-256 is $sum"; exit 1; fi
  # the packed twin must unpack to exactly that file
  if ! node --input-type=module -e 'import fs from "node:fs"; import crypto from "node:crypto";
    import { unpackOdk } from "'"$ROOT"'/app/src/kernel/odkz.js";
    const [f, want] = process.argv.slice(1);
    const got = crypto.createHash("sha256").update(unpackOdk(fs.readFileSync(f))).digest("hex");
    if (got !== want) { console.error(f + " unpacks to " + got); process.exit(1); }' "${f}z" "$name"; then
    echo "not deploying: ${f}z is missing or doesn't unpack to $f (node tools/fetch-kits.js writes it)"; exit 1
  fi
  HAVE="$HAVE $name"
done

# the kits first, so no page names one that isn't up yet (uploaded once each: a file named by its hash never changes)
KITTMP=$(mktemp -d)
trap 'rm -rf "$STAGE" "$KITTMP"' EXIT
for name in $HAVE; do
  for ext in odkz odk; do
    if [ -z "$DRY" ] && aws s3api head-object --bucket "$BUCKET" --key "app/kits/$name.$ext" >/dev/null 2>&1; then echo "kit $name.$ext: already up"; continue; fi
    gzip -9 -n -c "app/kits/$name.$ext" > "$KITTMP/$name.$ext"
    x aws s3 cp "$KITTMP/$name.$ext" "s3://$BUCKET/app/kits/$name.$ext" --only-show-errors \
      --content-type 'application/octet-stream' --content-encoding gzip --cache-control 'public, max-age=31536000, immutable'
    echo "uploaded kit $name.$ext ($(du -h "$KITTMP/$name.$ext" | cut -f1) gzipped)"
  done
done

up() { x aws s3 sync "$STAGE" "s3://$BUCKET" --only-show-errors --exclude '*' "$@"; }
TEXT='no-cache'
MEDIA='public, max-age=86400'
up --include '*.html' --content-type 'text/html; charset=utf-8' --cache-control "$TEXT"
up --include '*.js' --content-type 'text/javascript; charset=utf-8' --cache-control "$TEXT"
up --include '*.css' --content-type 'text/css; charset=utf-8' --cache-control "$TEXT"
up --include '*.json' --content-type 'application/json; charset=utf-8' --cache-control "$TEXT"
up --include '*.md' --content-type 'text/markdown; charset=utf-8' --cache-control "$TEXT"
up --include '*.txt' --content-type 'text/plain; charset=utf-8' --cache-control "$TEXT"
up --include '*.svg' --content-type 'image/svg+xml' --cache-control "$TEXT"
up --include '*.webp' --content-type 'image/webp' --cache-control "$MEDIA"
up --include '*.png' --content-type 'image/png' --cache-control "$MEDIA"
up --include '*.jpg' --content-type 'image/jpeg' --cache-control "$MEDIA"
up --include '*.gif' --content-type 'image/gif' --cache-control "$MEDIA"
up --include '*.mp4' --content-type 'video/mp4' --cache-control "$MEDIA"
up --include '*.woff2' --content-type 'font/woff2' --cache-control "$MEDIA"
up --include '*.wav' --content-type 'audio/wav' --cache-control "$MEDIA"
# anything else, and remove what's gone (never the kits: they aren't in git, so they aren't in the stage)
x aws s3 sync "$STAGE" "s3://$BUCKET" --only-show-errors --delete --exclude 'app/kits/*'

if [ -n "$DRY" ]; then
  x aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*'
  echo "dry run: nothing sent"
else
  ID=$(aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' --query Invalidation.Id --output text)
  echo "deployed $(find "$STAGE" -type f | wc -l | tr -d ' ') files to s3://$BUCKET; invalidation $ID"
fi
echo "https://$HOST/  ·  https://$HOST/app/"
