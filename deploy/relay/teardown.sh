#!/usr/bin/env bash
# Delete everything deploy/relay/setup.sh made for https://overdub-relay.ajsmithhq.com: the Route53 aliases, the
# CloudFront distribution (disabled first, then deleted once AWS has rolled that out: 5-15 minutes), the instance,
# its Elastic IP, the security group, the origin secret in Parameter Store, and the IAM instance profile and role.
# Safe to re-run: it skips what is gone. The overdub.ajsmithhq.com site, its bucket and its distribution are not
# touched.
#
#   deploy/relay/teardown.sh [--yes]
set -euo pipefail
[ -f "$(dirname "$0")/../.env" ] && . "$(dirname "$0")/../.env"   # ZONE, CERT, OAC: see deploy/env.example
export AWS_REGION=${AWS_REGION:-us-east-1} AWS_PAGER=""
NAME=overdub-relay
DOMAIN=overdub-relay.ajsmithhq.com
ZONE=${ZONE:?set ZONE in deploy/.env}
PARAM=/overdub/relay/origin-secret
say() { printf '\033[1m%s\033[0m %s\n' "$1" "${*:2}"; }

if [ "${1:-}" != "--yes" ]; then
  read -r -p "Delete the Overdub relay ($DOMAIN) and everything it runs on? [y/N] " ok
  [ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "nothing deleted"; exit 0; }
fi

# ---------------------------------------------------------------------------------------------- DNS
for TYPE in A AAAA; do
  REC=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE" --query "ResourceRecordSets[?Name=='$DOMAIN.' && Type=='$TYPE'] | [0]" --output json)
  if [ "$REC" != "null" ]; then
    CHG=$(mktemp)
    node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ Changes: [{ Action: 'DELETE', ResourceRecordSet: JSON.parse(process.argv[2]) }] }))" "$CHG" "$REC"
    aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "file://$CHG" >/dev/null
    rm -f "$CHG"
    say dns "deleted $DOMAIN $TYPE"
  fi
done

# ---------------------------------------------------------------------------------------------- CloudFront
DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$DOMAIN')].Id | [0]" --output text)
if [ "$DIST" != "None" ] && [ -n "$DIST" ]; then
  ENABLED=$(aws cloudfront get-distribution-config --id "$DIST" --query DistributionConfig.Enabled --output text)
  if [ "$ENABLED" = "True" ]; then
    TMP=$(mktemp); OUT=$(mktemp)
    ETAG=$(aws cloudfront get-distribution-config --id "$DIST" --query ETag --output text)
    aws cloudfront get-distribution-config --id "$DIST" --query DistributionConfig > "$TMP"
    node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.argv[1]));c.Enabled=false;fs.writeFileSync(process.argv[2],JSON.stringify(c))" "$TMP" "$OUT"
    aws cloudfront update-distribution --id "$DIST" --if-match "$ETAG" --distribution-config "file://$OUT" >/dev/null
    rm -f "$TMP" "$OUT"
    say cloudfront "disabled $DIST"
  fi
  say cloudfront "waiting for $DIST to finish deploying (5-15 minutes)"
  aws cloudfront wait distribution-deployed --id "$DIST"
  ETAG=$(aws cloudfront get-distribution --id "$DIST" --query ETag --output text)
  aws cloudfront delete-distribution --id "$DIST" --if-match "$ETAG"
  say cloudfront "deleted $DIST"
else say cloudfront "no distribution for $DOMAIN"; fi

# ---------------------------------------------------------------------------------------------- instance + address
for INSTANCE in $(aws ec2 describe-instances --filters Name=tag:Name,Values="$NAME" Name=tag:project,Values=overdub Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text); do
  aws ec2 terminate-instances --instance-ids "$INSTANCE" >/dev/null
  say instance "terminating $INSTANCE"
  aws ec2 wait instance-terminated --instance-ids "$INSTANCE"
  say instance "terminated $INSTANCE (its disk went with it)"
done
for ALLOC in $(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NAME" Name=tag:project,Values=overdub --query 'Addresses[].AllocationId' --output text); do
  ASSOC=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].AssociationId' --output text)
  [ "$ASSOC" != "None" ] && aws ec2 disassociate-address --association-id "$ASSOC"
  aws ec2 release-address --allocation-id "$ALLOC"
  say eip "released $ALLOC"
done

# ---------------------------------------------------------------------------------------------- security group
for SG in $(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME" --query 'SecurityGroups[].GroupId' --output text); do
  for i in 1 2 3 4 5 6; do
    if aws ec2 delete-security-group --group-id "$SG" 2>/dev/null; then say sg "deleted $SG"; break; fi
    say sg "$SG still in use (network interface draining); retrying in 10 s"; sleep 10
  done
done

# ---------------------------------------------------------------------------------------------- the origin secret
if [ "$(aws ssm describe-parameters --parameter-filters "Key=Name,Option=Equals,Values=$PARAM" --query 'length(Parameters)' --output text)" = "1" ]; then
  aws ssm delete-parameter --name "$PARAM"
  say ssm "deleted $PARAM"
fi

# ---------------------------------------------------------------------------------------------- IAM
if aws iam get-instance-profile --instance-profile-name "$NAME" >/dev/null 2>&1; then
  for R in $(aws iam get-instance-profile --instance-profile-name "$NAME" --query 'InstanceProfile.Roles[].RoleName' --output text); do
    aws iam remove-role-from-instance-profile --instance-profile-name "$NAME" --role-name "$R"
  done
  aws iam delete-instance-profile --instance-profile-name "$NAME"
  say iam "deleted instance profile $NAME"
fi
if aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then
  for P in $(aws iam list-attached-role-policies --role-name "$NAME" --query 'AttachedPolicies[].PolicyArn' --output text); do
    aws iam detach-role-policy --role-name "$NAME" --policy-arn "$P"
  done
  for P in $(aws iam list-role-policies --role-name "$NAME" --query 'PolicyNames[]' --output text); do
    aws iam delete-role-policy --role-name "$NAME" --policy-name "$P"   # (the inline one that reads the origin secret)
  done
  aws iam delete-role --role-name "$NAME"
  say iam "deleted role $NAME"
fi
say done "the relay is gone. Studios with Connect on will show Reconnecting until it is turned off."
