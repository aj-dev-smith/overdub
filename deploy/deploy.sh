#!/usr/bin/env bash
# Deploy Overdub to https://overdub.ajsmithhq.com: the landing page (site/), the studio (app/) and the public docs.
# Text files revalidate every time (no-cache + ETag, so a deploy is live at once); media caches for a day.
# Run deploy/setup.sh once first. Usage: deploy/deploy.sh [--skip-tests]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUCKET=overdub.ajsmithhq.com
DIST=$(cat "$ROOT/deploy/.distribution-id")
cd "$ROOT"

if [ "${1:-}" != "--skip-tests" ]; then
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
echo "staging $(git rev-parse --short "$REF"): $(find "$STAGE" -type f | wc -l | tr -d ' ') files"

up() { aws s3 sync "$STAGE" "s3://$BUCKET" --only-show-errors --exclude '*' "$@"; }
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
# anything else, and remove what's gone
aws s3 sync "$STAGE" "s3://$BUCKET" --only-show-errors --delete

ID=$(aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' --query Invalidation.Id --output text)
echo "deployed $(find "$STAGE" -type f | wc -l | tr -d ' ') files to s3://$BUCKET; invalidation $ID"
echo "https://$BUCKET/  ·  https://$BUCKET/app/"
