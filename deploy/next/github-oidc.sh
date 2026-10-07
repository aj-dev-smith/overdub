#!/usr/bin/env bash
# One-time AWS setup that lets GitHub Actions deploy the preview, https://next.overdubstudio.com, with no stored keys
# (safe to re-run: it creates what is missing and rewrites the role's trust and permissions to match this file).
#
#   GitHub Actions ──OIDC token──> sts:AssumeRoleWithWebIdentity ──> role overdub-next-deploy-github
#                                    only overdubstudio/overdub, only    s3: the next.overdubstudio.com bucket
#                                    from the branches in BRANCHES       cloudfront: invalidate its distribution
#
# What it makes: GitHub's OIDC identity provider in this account (token.actions.githubusercontent.com, if missing) and
# the role, with an inline policy. Nothing touches the live site's bucket or distribution (those are in another account).
# The workflow is .github/workflows/ci.yml (deploy-staging). It reads two repository variables (Settings > Secrets and
# variables > Actions > Variables), so no id is committed: NEXT_DEPLOY_ROLE (the ARN this prints at the end) and
# NEXT_DISTRIBUTION (the preview's distribution id).
#
#   deploy/next/github-oidc.sh                          needs AWS credentials for the Overdub account (AWS_PROFILE=overdub)
#   BRANCHES=main deploy/next/github-oidc.sh            the branches whose runs may deploy (default: main, the one ci.yml deploys)
#   DRY_RUN=1 deploy/next/github-oidc.sh                prints the plan, calls nothing that changes anything
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1 AWS_REGION=us-east-1 AWS_PAGER=""
REPO=overdubstudio/overdub
ROLE=overdub-next-deploy-github
BUCKET=next.overdubstudio.com
HERE=$(cd "$(dirname "$0")" && pwd)
DIST=${NEXT_DISTRIBUTION:-$(cat "$HERE/../.next-distribution-id" 2>/dev/null || true)}
[ -n "$DIST" ] || { echo "no distribution id: set NEXT_DISTRIBUTION, or write it to deploy/.next-distribution-id"; exit 1; }
BRANCHES=${BRANCHES:-main}
ISSUER=token.actions.githubusercontent.com
DRY=${DRY_RUN:-}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
say() { printf '\033[1m%s\033[0m %s\n' "$1" "${*:2}"; }
# a change: run it, or in a dry run print it (with any file:// argument's contents)
exec 3>&1   # the plan goes to the terminal even where a command's own output is dropped
x() {
  if [ -z "$DRY" ]; then "$@"; return; fi
  echo "+ $*" >&3
  for a in "$@"; do case "$a" in file://*) sed 's/^/    /' "${a#*://}" >&3;; esac; done
}

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
PROVIDER_ARN=arn:aws:iam::$ACCOUNT:oidc-provider/$ISSUER
say account "$ACCOUNT"

# 1. GitHub's identity provider (IAM trusts GitHub's certificate chain for this issuer; the thumbprint is not checked)
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1; then
  say provider "$ISSUER: already here"
else
  say provider "$ISSUER: creating"
  x aws iam create-open-id-connect-provider --url "https://$ISSUER" --client-id-list sts.amazonaws.com \
    --tags Key=project,Value=overdub >/dev/null
fi

# 2. The role: assumable only by this repo's runs on the named branches (a pull request's run has a different subject)
SUBS=$(for b in $BRANCHES; do printf '"repo:%s:ref:refs/heads/%s",' "$REPO" "$b"; done)
cat > "$TMP/trust.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "$PROVIDER_ARN" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "$ISSUER:aud": "sts.amazonaws.com" },
      "StringLike": { "$ISSUER:sub": [${SUBS%,}] }
    }
  }]
}
JSON
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  say role "$ROLE: already here; setting its trust to: $BRANCHES"
  x aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "file://$TMP/trust.json"
else
  say role "$ROLE: creating, for: $BRANCHES"
  x aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$TMP/trust.json" \
    --description "GitHub Actions ($REPO) deploys https://$BUCKET" --max-session-duration 3600 \
    --tags Key=project,Value=overdub >/dev/null
fi

# 3. What it may do: exactly what deploy/deploy.sh --next calls, on the preview's bucket and distribution only
cat > "$TMP/policy.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ListPreviewBucket", "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::$BUCKET" },
    { "Sid": "WritePreviewObjects", "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::$BUCKET/*" },
    { "Sid": "InvalidatePreview", "Effect": "Allow", "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::$ACCOUNT:distribution/$DIST" }
  ]
}
JSON
say policy "deploy-preview: s3://$BUCKET, distribution $DIST"
x aws iam put-role-policy --role-name "$ROLE" --policy-name deploy-preview --policy-document "file://$TMP/policy.json"

say "done" "arn:aws:iam::$ACCOUNT:role/$ROLE"
[ -n "$DRY" ] && echo "dry run: nothing changed"
exit 0
