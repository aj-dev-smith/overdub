#!/usr/bin/env bash
# One-time AWS setup for the preview site, https://next.overdubstudio.com (safe to re-run: it skips what exists).
# The same shape as the live site (deploy/setup.sh): a private bucket -> CloudFront (OAC, the path-rewrite function
# with its home set to next.overdubstudio.com) -> a Route53 alias. Two differences: its own ACM certificate, validated
# by DNS in the overdubstudio.com zone, and a response headers policy that adds X-Robots-Tag: noindex, nofollow to the
# managed security headers, so no search engine lists the preview.
#
#   deploy/next/setup.sh                 needs AWS credentials (us-east-1); creates what is missing
#   DRY_RUN=1 deploy/next/setup.sh       prints the plan, calls nothing (every lookup reads as "not there yet")
#
# Ids come from deploy/.env (deploy/env.example) when set, else are looked up; none is written here:
#   NEXT_ZONE  the overdubstudio.com hosted zone      (else: looked up by name)
#   NEXT_OAC   an S3 origin access control             (else: OAC, else the one named overdub-next, made if missing)
#   NEXT_CERT  an ACM certificate for the name         (else: the issued or pending one for it, requested if missing)
#   the account comes from sts. The distribution id lands in deploy/.next-distribution-id (gitignored), for deploy.sh.
#   DEPLOY_ENV=<file> reads that file instead of deploy/.env (DEPLOY_ENV=/dev/null reads none; the dry-run check does).
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1 AWS_REGION=us-east-1 AWS_PAGER=""   # both: AWS_REGION outranks the default, and the certificate must be us-east-1
HERE=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${DEPLOY_ENV:-$HERE/../.env}
if [ -f "$ENV_FILE" ]; then . "$ENV_FILE"; fi
APEX=overdubstudio.com
DOMAIN=next.$APEX
BUCKET=$DOMAIN
FN=overdub-next-path-rewrite
HEADERS=overdub-next-headers
CACHE=658327ea-f89d-4fab-a63d-7e88639e58f6      # managed CachingOptimized (an AWS constant, the same in every account)
CF_ZONE=Z2FDTNDATAQYW2                          # CloudFront's alias hosted zone (an AWS constant)
DRY=${DRY_RUN:-}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
say() { printf '\033[1m%s\033[0m %s\n' "$1" "${*:2}"; }
# a change: run it, or in a dry run print it (with any file:// argument's contents)
exec 3>&1   # the plan goes to the terminal even where a command's own output is captured or dropped
x() {
  if [ -z "$DRY" ]; then "$@"; return; fi
  echo "+ $*" >&3
  for a in "$@"; do case "$a" in file://*|fileb://*) sed 's/^/    /' "${a#*://}" >&3;; esac; done
}
# a change whose output we keep: in a dry run, print it and answer with a placeholder
mk() { local stub=$1; shift; if [ -z "$DRY" ]; then "$@"; else x "$@"; echo "$stub"; fi; }
# a lookup: in a dry run, nothing exists yet
look() { if [ -z "$DRY" ]; then "$@"; else echo None; fi; }
[ -n "$DRY" ] && say dry-run "no AWS calls: this is what a first run would do"

# ---- the ids
ACCOUNT=$( [ -n "$DRY" ] && echo 000000000000 || aws sts get-caller-identity --query Account --output text)
ZONE=${NEXT_ZONE:-$(look aws route53 list-hosted-zones-by-name --dns-name "$APEX" --query "HostedZones[?Name=='$APEX.'].Id | [0]" --output text)}
ZONE=${ZONE#/hostedzone/}
if [ "$ZONE" = "None" ] || [ -z "$ZONE" ]; then
  [ -n "$DRY" ] && ZONE=ZDRYRUN || { echo "no Route53 hosted zone for $APEX: set NEXT_ZONE in deploy/.env"; exit 1; }
fi
say zone "$APEX ($ZONE)"

# ---- the bucket: private, read only by the distribution below
if [ -n "$DRY" ] || ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  x aws s3api create-bucket --bucket "$BUCKET" --region us-east-1 >/dev/null
  say bucket "created $BUCKET"
fi
x aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# ---- the origin access control (the live site's is fine to share; it signs requests, it names no bucket)
OAC=${NEXT_OAC:-${OAC:-}}
if [ -z "$OAC" ]; then
  OAC=$(look aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='overdub-next'].Id | [0]" --output text)
  if [ "$OAC" = "None" ] || [ -z "$OAC" ]; then
    OAC=$(mk EOACDRYRUN aws cloudfront create-origin-access-control --origin-access-control-config Name=overdub-next,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 --query OriginAccessControl.Id --output text)
    say oac "created $OAC"
  fi
fi
say oac "$OAC"

# ---- the certificate: ACM in us-east-1, validated by a CNAME in the zone
CERT=${NEXT_CERT:-$(look aws acm list-certificates --certificate-statuses ISSUED PENDING_VALIDATION --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn | [0]" --output text)}
if [ "$CERT" = "None" ] || [ -z "$CERT" ]; then
  CERT=$(mk "arn:aws:acm:us-east-1:$ACCOUNT:certificate/dry-run" aws acm request-certificate --region us-east-1 --domain-name "$DOMAIN" --validation-method DNS --idempotency-token overdubnext --query CertificateArn --output text)
  say cert "requested $CERT"
fi
STATUS=$( [ -n "$DRY" ] && echo PENDING_VALIDATION || aws acm describe-certificate --certificate-arn "$CERT" --query Certificate.Status --output text)
if [ "$STATUS" != "ISSUED" ]; then
  REC="_dryrun.$DOMAIN. _dryrun.acm-validations.aws."
  if [ -z "$DRY" ]; then
    REC=""
    for _ in $(seq 1 30); do   # ACM takes a few seconds to name the record
      REC=$(aws acm describe-certificate --certificate-arn "$CERT" --query 'Certificate.DomainValidationOptions[0].ResourceRecord.[Name,Value]' --output text)
      [ -n "$REC" ] && [ "$REC" != "None" ] && break
      sleep 2
    done
  fi
  read -r RNAME RVALUE <<<"$REC"
  [ -n "${RVALUE:-}" ] || { echo "ACM gave no validation record for $CERT yet: run this again in a minute"; exit 1; }
  cat > "$TMP/validate.json" <<JSON
{ "Comment": "overdub next: certificate validation", "Changes": [
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$RNAME", "Type": "CNAME", "TTL": 300, "ResourceRecords": [{ "Value": "$RVALUE" }] } } ] }
JSON
  x aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "file://$TMP/validate.json" >/dev/null
  say cert "validation record $RNAME; waiting for ACM (a few minutes)"
  x aws acm wait certificate-validated --certificate-arn "$CERT"
fi
say cert "$CERT"

# ---- the viewer-request function: deploy/path-rewrite.js with its home set to the preview's name, so the preview
# serves its own paths (and the bare cloudfront.net name redirects to it, not to the live site)
sed "s/^var HOME = '$APEX';/var HOME = '$DOMAIN';/" "$HERE/../path-rewrite.js" > "$TMP/path-rewrite.js"
grep -q "^var HOME = '$DOMAIN';" "$TMP/path-rewrite.js" || { echo "deploy/path-rewrite.js no longer starts with var HOME = '$APEX': update this script"; exit 1; }
EXISTS=$( [ -n "$DRY" ] && echo no || { aws cloudfront describe-function --name "$FN" >/dev/null 2>&1 && echo yes || echo no; })
if [ "$EXISTS" = yes ]; then
  ETAG=$(aws cloudfront describe-function --name "$FN" --query ETag --output text)
  ETAG=$(aws cloudfront update-function --name "$FN" --if-match "$ETAG" --function-config Comment="overdub preview path rewrite",Runtime=cloudfront-js-2.0 --function-code "fileb://$TMP/path-rewrite.js" --query ETag --output text)
else
  ETAG=$(mk EDRYRUN aws cloudfront create-function --name "$FN" --function-config Comment="overdub preview path rewrite",Runtime=cloudfront-js-2.0 --function-code "fileb://$TMP/path-rewrite.js" --query ETag --output text)
fi
x aws cloudfront publish-function --name "$FN" --if-match "$ETAG" >/dev/null
FN_ARN=$( [ -n "$DRY" ] && echo "arn:aws:cloudfront::$ACCOUNT:function/$FN" || aws cloudfront describe-function --name "$FN" --stage LIVE --query FunctionSummary.FunctionMetadata.FunctionARN --output text)
say function "$FN_ARN"

# ---- the response headers: the managed SecurityHeadersPolicy's set, plus noindex (one policy per behaviour)
cat > "$TMP/headers.json" <<JSON
{ "Name": "$HEADERS", "Comment": "$DOMAIN: security headers plus noindex",
  "SecurityHeadersConfig": {
    "XSSProtection": { "Override": false, "Protection": true, "ModeBlock": true },
    "FrameOptions": { "Override": false, "FrameOption": "SAMEORIGIN" },
    "ReferrerPolicy": { "Override": false, "ReferrerPolicy": "strict-origin-when-cross-origin" },
    "ContentTypeOptions": { "Override": true },
    "StrictTransportSecurity": { "Override": false, "IncludeSubdomains": false, "Preload": false, "AccessControlMaxAgeSec": 31536000 } },
  "CustomHeadersConfig": { "Quantity": 1, "Items": [{ "Header": "X-Robots-Tag", "Value": "noindex, nofollow", "Override": true }] } }
JSON
RHP=$(look aws cloudfront list-response-headers-policies --type custom --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='$HEADERS'].ResponseHeadersPolicy.Id | [0]" --output text)
if [ "$RHP" = "None" ] || [ -z "$RHP" ]; then
  RHP=$(mk RHPDRYRUN aws cloudfront create-response-headers-policy --response-headers-policy-config "file://$TMP/headers.json" --query ResponseHeadersPolicy.Id --output text)
  say headers "created $RHP"
else
  RETAG=$(aws cloudfront get-response-headers-policy --id "$RHP" --query ETag --output text)
  aws cloudfront update-response-headers-policy --id "$RHP" --if-match "$RETAG" --response-headers-policy-config "file://$TMP/headers.json" >/dev/null
fi
say headers "$RHP (X-Robots-Tag: noindex, nofollow)"

# ---- the distribution
DIST=$(look aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$DOMAIN')].Id | [0]" --output text)
if [ "$DIST" = "None" ] || [ -z "$DIST" ]; then
  cat > "$TMP/dist.json" <<JSON
{
  "CallerReference": "overdub-next-$(date +%s)",
  "Comment": "$DOMAIN (preview)",
  "Enabled": true,
  "Aliases": { "Quantity": 1, "Items": ["$DOMAIN"] },
  "DefaultRootObject": "",
  "Origins": { "Quantity": 1, "Items": [{
    "Id": "s3-overdub-next", "DomainName": "$BUCKET.s3.us-east-1.amazonaws.com", "OriginPath": "",
    "S3OriginConfig": { "OriginAccessIdentity": "" }, "OriginAccessControlId": "$OAC" }] },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-overdub-next", "ViewerProtocolPolicy": "redirect-to-https", "Compress": true,
    "AllowedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"], "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] } },
    "CachePolicyId": "$CACHE", "ResponseHeadersPolicyId": "$RHP",
    "FunctionAssociations": { "Quantity": 1, "Items": [{ "FunctionARN": "$FN_ARN", "EventType": "viewer-request" }] }
  },
  "ViewerCertificate": { "ACMCertificateArn": "$CERT", "SSLSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021" },
  "HttpVersion": "http2and3", "IsIPV6Enabled": true, "PriceClass": "PriceClass_100"
}
JSON
  DIST=$(mk EDRYRUN aws cloudfront create-distribution --distribution-config "file://$TMP/dist.json" --query Distribution.Id --output text)
  say distribution "created $DIST"
fi
DIST_DOMAIN=$( [ -n "$DRY" ] && echo dryrun.cloudfront.net || aws cloudfront get-distribution --id "$DIST" --query Distribution.DomainName --output text)
say distribution "$DIST ($DIST_DOMAIN)"

# ---- only this distribution may read the bucket
cat > "$TMP/policy.json" <<JSON
{ "Version": "2012-10-17", "Statement": [{ "Sid": "CloudFrontRead", "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" }, "Action": "s3:GetObject", "Resource": "arn:aws:s3:::$BUCKET/*",
  "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::$ACCOUNT:distribution/$DIST" } } }] }
JSON
x aws s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$TMP/policy.json"

# ---- DNS
cat > "$TMP/alias.json" <<JSON
{ "Comment": "overdub next", "Changes": [
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$DOMAIN", "Type": "A", "AliasTarget": { "HostedZoneId": "$CF_ZONE", "DNSName": "$DIST_DOMAIN", "EvaluateTargetHealth": false } } },
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$DOMAIN", "Type": "AAAA", "AliasTarget": { "HostedZoneId": "$CF_ZONE", "DNSName": "$DIST_DOMAIN", "EvaluateTargetHealth": false } } } ] }
JSON
x aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "file://$TMP/alias.json" >/dev/null
say dns "$DOMAIN -> $DIST_DOMAIN"
if [ -z "$DRY" ]; then echo "$DIST" > "$HERE/../.next-distribution-id"; fi
echo "done. Deploy with deploy/deploy.sh --next [REF]"
