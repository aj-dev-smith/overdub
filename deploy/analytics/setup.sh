#!/usr/bin/env bash
# One-time setup for Overdub's counts (app/src/analytics.js, site/assets/analytics.js): a private log bucket that
# forgets after 90 days, CloudFront standard logging on the overdub.ajsmithhq.com distribution into it, and the Athena
# database, table and view that tools/stats.sh reads. Safe to re-run: it skips or re-applies what exists.
#
#   deploy/analytics/setup.sh            (needs AWS credentials: `aws login`; region us-east-1)
#
# Costs: S3 for a few MB of gzipped logs a month, Athena at $5/TB scanned (each stats.sh run scans the logs once per
# query, a few MB). No servers. CloudFront logs every request, as any web server would, including the client address
# and user agent; the lifecycle rule deletes them after 90 days, and the Athena view used by stats.sh never selects them.
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1
HERE=$(cd "$(dirname "$0")" && pwd)
DIST=$(cat "$HERE/../.distribution-id")   # written by deploy/setup.sh
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="overdub-logs-$ACCOUNT"
LOGS="s3://$BUCKET"
AWSLOGS=c4c1ede66af53448b93c283ce9448c4ba468c9432aa01d700d3878632f77d2d0   # CloudFront's log-delivery account (awslogsdelivery)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ---- the bucket: private, encrypted, ACLs on (CloudFront's standard logging writes with an ACL grant), 90-day expiry
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  echo "bucket: created $BUCKET"
else
  echo "bucket: $BUCKET exists"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerPreferred}]'
OWNER=$(aws s3api list-buckets --query Owner.ID --output text)
aws s3api put-bucket-acl --bucket "$BUCKET" --grant-full-control "id=$OWNER,id=$AWSLOGS"
cat > "$TMP/lifecycle.json" <<'JSON'
{ "Rules": [
  { "ID": "forget-after-90-days", "Filter": { "Prefix": "" }, "Status": "Enabled",
    "Expiration": { "Days": 90 }, "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } },
  { "ID": "athena-results-7-days", "Filter": { "Prefix": "athena-results/" }, "Status": "Enabled",
    "Expiration": { "Days": 7 } } ] }
JSON
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "file://$TMP/lifecycle.json"
echo "bucket: private, encrypted, logs expire after 90 days (query results after 7)"

# ---- CloudFront standard logging on the distribution, no cookies, under cf-logs/
aws cloudfront get-distribution-config --id "$DIST" > "$TMP/dist.json"
ETAG=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$TMP/dist.json")
python3 - "$TMP/dist.json" "$BUCKET" > "$TMP/config.json" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))["DistributionConfig"]
cfg["Logging"] = {"Enabled": True, "IncludeCookies": False, "Bucket": sys.argv[2] + ".s3.amazonaws.com", "Prefix": "cf-logs/"}
print(json.dumps(cfg))
PY
aws cloudfront update-distribution --id "$DIST" --if-match "$ETAG" --distribution-config "file://$TMP/config.json" \
  --query 'Distribution.DistributionConfig.Logging' --output text
echo "cloudfront: $DIST logs to $LOGS/cf-logs/ (the first files land within the hour)"

# ---- Athena: the database, the table over the logs and the events view (deploy/analytics/athena.sql)
run() {
  local id st
  id=$(aws athena start-query-execution --query-string "$1" --work-group primary \
    --result-configuration "OutputLocation=$LOGS/athena-results/" --query QueryExecutionId --output text)
  while :; do
    st=$(aws athena get-query-execution --query-execution-id "$id" --query QueryExecution.Status.State --output text)
    case "$st" in
      SUCCEEDED) return 0 ;;
      FAILED|CANCELLED) aws athena get-query-execution --query-execution-id "$id" --query QueryExecution.Status.StateChangeReason --output text >&2; return 1 ;;
    esac
    sleep 1
  done
}
python3 - "$HERE/athena.sql" "$LOGS" > "$TMP/statements" <<'PY'
import sys
sql = open(sys.argv[1]).read().replace("__LOGS__", sys.argv[2])
body = "\n".join(l for l in sql.splitlines() if not l.lstrip().startswith("--"))
for s in body.split(";"):
    s = " ".join(s.split())
    if s: print(s)
PY
while IFS= read -r stmt <&3; do
  run "$stmt"
  echo "athena: ${stmt:0:60}…"
done 3< "$TMP/statements"

echo "done. Read the counts with tools/stats.sh [days]"
