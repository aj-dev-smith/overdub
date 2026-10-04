#!/usr/bin/env bash
# One-time AWS setup for overdub.ajsmithhq.com (run once; safe to re-run: it skips what exists).
# Bucket (private) -> CloudFront (OAC, the ajsmithhq.com wildcard cert, a path-rewrite function) -> Route53 alias.
# Costs: S3 storage for ~20 MB and CloudFront requests; pennies a month at this scale.
set -euo pipefail
[ -f "$(dirname "$0")/.env" ] && . "$(dirname "$0")/.env"   # ZONE, CERT, OAC: see deploy/env.example
DOMAIN=overdub.ajsmithhq.com
BUCKET=$DOMAIN
ZONE=${ZONE:?set ZONE in deploy/.env}          # the domain's hosted zone
CERT=${CERT:?set CERT in deploy/.env}          # the domain + its wildcard
OAC=${OAC:?set OAC in deploy/.env}             # an origin access control
CACHE=658327ea-f89d-4fab-a63d-7e88639e58f6      # managed CachingOptimized
SECURITY=67f7725c-6f97-4210-82d7-5512b31e9d03   # managed SecurityHeadersPolicy
FN=overdub-path-rewrite
HERE=$(cd "$(dirname "$0")" && pwd)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region us-east-1 >/dev/null
  echo "bucket: created $BUCKET"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# the path-rewrite function, published LIVE
if aws cloudfront describe-function --name "$FN" >/dev/null 2>&1; then
  ETAG=$(aws cloudfront describe-function --name "$FN" --query ETag --output text)
  ETAG=$(aws cloudfront update-function --name "$FN" --if-match "$ETAG" --function-config Comment="overdub path rewrite",Runtime=cloudfront-js-2.0 --function-code "fileb://$HERE/path-rewrite.js" --query ETag --output text)
else
  ETAG=$(aws cloudfront create-function --name "$FN" --function-config Comment="overdub path rewrite",Runtime=cloudfront-js-2.0 --function-code "fileb://$HERE/path-rewrite.js" --query ETag --output text)
fi
aws cloudfront publish-function --name "$FN" --if-match "$ETAG" >/dev/null
FN_ARN=$(aws cloudfront describe-function --name "$FN" --stage LIVE --query FunctionSummary.FunctionMetadata.FunctionARN --output text)
echo "function: $FN_ARN"

# the distribution
DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$DOMAIN')].Id | [0]" --output text)
if [ "$DIST" = "None" ] || [ -z "$DIST" ]; then
  CFG=$(mktemp)
  cat > "$CFG" <<JSON
{
  "CallerReference": "overdub-$(date +%s)",
  "Comment": "$DOMAIN",
  "Enabled": true,
  "Aliases": { "Quantity": 1, "Items": ["$DOMAIN"] },
  "DefaultRootObject": "",
  "Origins": { "Quantity": 1, "Items": [{
    "Id": "s3-overdub", "DomainName": "$BUCKET.s3.us-east-1.amazonaws.com", "OriginPath": "",
    "S3OriginConfig": { "OriginAccessIdentity": "" }, "OriginAccessControlId": "$OAC" }] },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-overdub", "ViewerProtocolPolicy": "redirect-to-https", "Compress": true,
    "AllowedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"], "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] } },
    "CachePolicyId": "$CACHE", "ResponseHeadersPolicyId": "$SECURITY",
    "FunctionAssociations": { "Quantity": 1, "Items": [{ "FunctionARN": "$FN_ARN", "EventType": "viewer-request" }] }
  },
  "ViewerCertificate": { "ACMCertificateArn": "$CERT", "SSLSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021" },
  "HttpVersion": "http2and3", "IsIPV6Enabled": true, "PriceClass": "PriceClass_100"
}
JSON
  DIST=$(aws cloudfront create-distribution --distribution-config "file://$CFG" --query Distribution.Id --output text)
  rm -f "$CFG"
  echo "distribution: created $DIST"
fi
DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST" --query Distribution.DomainName --output text)
echo "distribution: $DIST ($DIST_DOMAIN)"

# only this distribution may read the bucket
POLICY=$(mktemp)
cat > "$POLICY" <<JSON
{ "Version": "2012-10-17", "Statement": [{ "Sid": "CloudFrontRead", "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" }, "Action": "s3:GetObject", "Resource": "arn:aws:s3:::$BUCKET/*",
  "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::$ACCOUNT:distribution/$DIST" } } }] }
JSON
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$POLICY"
rm -f "$POLICY"

# DNS
CHG=$(mktemp)
cat > "$CHG" <<JSON
{ "Comment": "overdub", "Changes": [
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$DOMAIN", "Type": "A", "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "$DIST_DOMAIN", "EvaluateTargetHealth": false } } },
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$DOMAIN", "Type": "AAAA", "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "$DIST_DOMAIN", "EvaluateTargetHealth": false } } } ] }
JSON
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "file://$CHG" >/dev/null
rm -f "$CHG"
echo "dns: $DOMAIN -> $DIST_DOMAIN"
echo "$DIST" > "$HERE/.distribution-id"
echo "done. Deploy with deploy/deploy.sh"
