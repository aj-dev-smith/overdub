#!/usr/bin/env bash
# One-time AWS setup for the Overdub relay at https://overdub-relay.ajsmithhq.com (server/relay.js; docs/REMOTE-MCP.md).
# Safe to re-run: every step looks for what it would create (by name or tag project=overdub) and skips or repairs it.
#
#   claude.ai ──https──> CloudFront (overdub-relay.ajsmithhq.com, the *.ajsmithhq.com cert, no caching)
#                          └─http :8787 + x-overdub-origin secret──> EC2 t4g.nano (AL2023, Node 22, systemd)
#                                                                    security group: CloudFront origin-facing IPs only
#
# What it makes (all tagged project=overdub): an IAM role + instance profile (SSM, and reading the one parameter
# below), the origin secret as a SecureString in SSM Parameter Store (/overdub/relay/origin-secret), a security group,
# an Elastic IP, one t4g.nano with an 8 GB gp3 disk, a CloudFront distribution, and Route53 A/AAAA aliases. Then it
# runs deploy.sh to ship the relay. Undo it all with teardown.sh.
#
# Cost (us-east-1, on demand): t4g.nano ~$3.07/month + 8 GB gp3 ~$0.64 + the public IPv4 (Elastic IP) ~$3.65
# = about $7.40/month. CloudFront and Route53 queries sit inside the free tier at this scale; SSM is free.
#
# Usage: deploy/relay/setup.sh            (needs the aws CLI, node, and AWS credentials, and deploy/.env)
set -euo pipefail
[ -f "$(dirname "$0")/../.env" ] && . "$(dirname "$0")/../.env"   # ZONE, CERT, OAC: see deploy/env.example
export AWS_REGION=${AWS_REGION:-us-east-1} AWS_PAGER=""
HERE=$(cd "$(dirname "$0")" && pwd)

NAME=overdub-relay
DOMAIN=overdub-relay.ajsmithhq.com
ZONE=${ZONE:?set ZONE in deploy/.env}          # the domain's hosted zone
CERT=${CERT:?set CERT in deploy/.env}          # the domain + its wildcard
CACHE=4135ea2d-6df8-44a3-9df3-4b5a84be39ad      # managed CachingDisabled
ORIGIN_REQ=b689b0a8-53d0-40ab-baf2-68738e2966ac # managed AllViewerExceptHostHeader
PORT=8787
PARAM=/overdub/relay/origin-secret              # SSM Parameter Store, SecureString (the default aws/ssm key)
TYPE=t4g.nano
say() { printf '\033[1m%s\033[0m %s\n' "$1" "${*:2}"; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
say account "$ACCOUNT ($AWS_REGION)"

# ---------------------------------------------------------------------------------------------- IAM: SSM and one parameter
if ! aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$NAME" --description "Overdub relay instance: SSM, and reading its origin secret" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --tags Key=project,Value=overdub >/dev/null
  say iam "created role $NAME"
else say iam "role $NAME exists"; fi
aws iam attach-role-policy --role-name "$NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
# reading the origin secret on the instance (deploy.sh). AmazonSSMManagedInstanceCore already allows ssm:GetParameter
# on every parameter; this says which one the relay needs, so it still works if that policy is ever narrowed. A
# SecureString under the default aws/ssm key needs no kms grant for a principal in this account.
aws iam put-role-policy --role-name "$NAME" --policy-name overdub-relay-origin-secret --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameter\",\"Resource\":\"arn:aws:ssm:$AWS_REGION:$ACCOUNT:parameter$PARAM\"}]}"
if ! aws iam get-instance-profile --instance-profile-name "$NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$NAME" --tags Key=project,Value=overdub >/dev/null
  say iam "created instance profile $NAME"
fi
if [ "$(aws iam get-instance-profile --instance-profile-name "$NAME" --query 'length(InstanceProfile.Roles)' --output text)" = "0" ]; then
  aws iam add-role-to-instance-profile --instance-profile-name "$NAME" --role-name "$NAME"
  say iam "added the role to the profile (waiting 15 s for IAM to propagate)"; sleep 15
fi

# ---------------------------------------------------------------------------------------------- network
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC" != "None" ] || { echo "no default VPC in $AWS_REGION: create one (aws ec2 create-default-vpc) and re-run"; exit 1; }
# a default subnet in an AZ that offers t4g.nano
AZS=$(aws ec2 describe-instance-type-offerings --location-type availability-zone --filters Name=instance-type,Values=$TYPE --query 'InstanceTypeOfferings[].Location' --output text)
SUBNET=""
for az in $AZS; do
  SUBNET=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true Name=availability-zone,Values="$az" --query 'Subnets[0].SubnetId' --output text)
  [ "$SUBNET" != "None" ] && break
done
[ -n "$SUBNET" ] && [ "$SUBNET" != "None" ] || { echo "no default subnet offers $TYPE"; exit 1; }
say network "vpc $VPC, subnet $SUBNET"

SG=$(aws ec2 describe-security-groups --filters Name=vpc-id,Values="$VPC" Name=group-name,Values="$NAME" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name "$NAME" --vpc-id "$VPC" --description "Overdub relay: CloudFront origin-facing only" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=project,Value=overdub},{Key=Name,Value=$NAME}]" --query GroupId --output text)
  say sg "created $SG"
else say sg "$SG exists"; fi
PL=$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text)
HAS=$(aws ec2 describe-security-group-rules --filters Name=group-id,Values="$SG" --query "length(SecurityGroupRules[?!IsEgress && PrefixListId=='$PL' && FromPort==\`$PORT\`])" --output text)
if [ "$HAS" = "0" ]; then
  aws ec2 authorize-security-group-ingress --group-id "$SG" \
    --ip-permissions "IpProtocol=tcp,FromPort=$PORT,ToPort=$PORT,PrefixListIds=[{PrefixListId=$PL,Description=CloudFront origin-facing}]" >/dev/null
  say sg "allowed tcp $PORT from CloudFront's origin-facing prefix list $PL (nothing else gets in; no SSH)"
else say sg "ingress from $PL on $PORT is in place"; fi

# ---------------------------------------------------------------------------------------------- the origin secret
# CloudFront adds x-overdub-origin: <secret> to every request; the relay refuses requests without it, so nobody can
# put another CloudFront distribution in front of this instance. Its home is Parameter Store ($PARAM, a SecureString):
# CloudFront's origin header is set from it, and deploy.sh has the instance read it there, so it never rides in an SSM
# command. Re-runs keep the parameter's value (to rotate: docs/REMOTE-MCP.md, "The origin secret").
DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$DOMAIN')].Id | [0]" --output text)
SECRET=$(aws ssm get-parameter --name "$PARAM" --with-decryption --query Parameter.Value --output text 2>/dev/null || true)
if [ -z "$SECRET" ] || [ "$SECRET" = "None" ]; then
  SECRET=""
  # a relay set up before the secret lived in Parameter Store keeps the distribution's
  if [ "$DIST" != "None" ] && [ -n "$DIST" ]; then
    SECRET=$(aws cloudfront get-distribution-config --id "$DIST" --query "DistributionConfig.Origins.Items[0].CustomHeaders.Items[?HeaderName=='x-overdub-origin'].HeaderValue | [0]" --output text)
  fi
  if [ -z "$SECRET" ] || [ "$SECRET" = "None" ]; then SECRET=$(openssl rand -hex 24); say secret "made a new origin secret"; else say secret "moving the distribution's origin secret to Parameter Store"; fi
  # (the value goes through a file only this user can read, never a command line)
  PJ=$(mktemp); chmod 600 "$PJ"
  SECRET="$SECRET" node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ Name: process.argv[2], Type: 'SecureString', Value: process.env.SECRET, Description: 'x-overdub-origin: CloudFront to the Overdub relay (deploy/relay)', Tags: [{ Key: 'project', Value: 'overdub' }] }))" "$PJ" "$PARAM"
  aws ssm put-parameter --cli-input-json "file://$PJ" >/dev/null
  rm -f "$PJ"
  say secret "stored in Parameter Store as $PARAM (SecureString)"
else say secret "the origin secret is in Parameter Store ($PARAM)"; fi

# ---------------------------------------------------------------------------------------------- the instance
INSTANCE=$(aws ec2 describe-instances --filters Name=tag:Name,Values="$NAME" Name=tag:project,Values=overdub Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[0].InstanceId | [0]' --output text)
if [ "$INSTANCE" = "None" ] || [ -z "$INSTANCE" ]; then
  AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
  UD=$(mktemp)
  cat > "$UD" <<'EOS'
#!/bin/bash
# Overdub relay first boot: a little swap (512 MB of RAM is tight for dnf), Node 22. deploy.sh does the rest over SSM.
set -eux
if [ ! -f /swapfile ]; then dd if=/dev/zero of=/swapfile bs=1M count=512; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile; echo '/swapfile none swap defaults 0 0' >> /etc/fstab; fi
dnf install -y nodejs22
mkdir -p /opt/overdub-relay/releases
EOS
  INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type $TYPE --subnet-id "$SUBNET" --security-group-ids "$SG" \
    --iam-instance-profile Name="$NAME" --user-data "file://$UD" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=8,VolumeType=gp3,DeleteOnTermination=true,Encrypted=true}' \
    --credit-specification CpuCredits=standard \
    --tag-specifications "ResourceType=instance,Tags=[{Key=project,Value=overdub},{Key=Name,Value=$NAME}]" "ResourceType=volume,Tags=[{Key=project,Value=overdub},{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)
  rm -f "$UD"
  say instance "launched $INSTANCE ($TYPE, $AMI); waiting for it to run"
else say instance "$INSTANCE exists"; fi
STATE=$(aws ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].State.Name' --output text)
[ "$STATE" = "stopped" ] && { aws ec2 start-instances --instance-ids "$INSTANCE" >/dev/null; say instance "started it"; }
aws ec2 wait instance-running --instance-ids "$INSTANCE"

# a stable public address (the origin's DNS name must not change on a stop/start)
ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NAME" Name=tag:project,Values=overdub --query 'Addresses[0].AllocationId' --output text)
if [ "$ALLOC" = "None" ]; then
  ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=project,Value=overdub},{Key=Name,Value=$NAME}]" --query AllocationId --output text)
  say eip "allocated $ALLOC"
fi
ASSOC=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].InstanceId' --output text)
if [ "$ASSOC" != "$INSTANCE" ]; then aws ec2 associate-address --allocation-id "$ALLOC" --instance-id "$INSTANCE" >/dev/null; say eip "associated with $INSTANCE"; sleep 5; fi
EIP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
ORIGIN=$(aws ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].PublicDnsName' --output text)
[ -n "$ORIGIN" ] && [ "$ORIGIN" != "None" ] || ORIGIN="ec2-${EIP//./-}.compute-1.amazonaws.com"
say eip "$EIP ($ORIGIN)"

# ---------------------------------------------------------------------------------------------- CloudFront
if [ "$DIST" = "None" ] || [ -z "$DIST" ]; then
  CFG=$(mktemp); chmod 600 "$CFG"   # (it holds the origin secret until CloudFront has it)
  cat > "$CFG" <<JSON
{
  "DistributionConfig": {
    "CallerReference": "overdub-relay-$(date +%s)",
    "Comment": "$DOMAIN (Overdub MCP relay)",
    "Enabled": true,
    "Aliases": { "Quantity": 1, "Items": ["$DOMAIN"] },
    "Origins": { "Quantity": 1, "Items": [{
      "Id": "relay-ec2", "DomainName": "$ORIGIN", "OriginPath": "",
      "CustomHeaders": { "Quantity": 1, "Items": [{ "HeaderName": "x-overdub-origin", "HeaderValue": "$SECRET" }] },
      "CustomOriginConfig": { "HTTPPort": $PORT, "HTTPSPort": 443, "OriginProtocolPolicy": "http-only",
        "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] }, "OriginReadTimeout": 60, "OriginKeepaliveTimeout": 5 },
      "ConnectionAttempts": 3, "ConnectionTimeout": 10 }] },
    "DefaultCacheBehavior": {
      "TargetOriginId": "relay-ec2", "ViewerProtocolPolicy": "https-only", "Compress": false,
      "AllowedMethods": { "Quantity": 7, "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
        "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] } },
      "CachePolicyId": "$CACHE", "OriginRequestPolicyId": "$ORIGIN_REQ"
    },
    "ViewerCertificate": { "ACMCertificateArn": "$CERT", "SSLSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021" },
    "HttpVersion": "http2", "IsIPV6Enabled": true, "PriceClass": "PriceClass_100"
  },
  "Tags": { "Items": [{ "Key": "project", "Value": "overdub" }, { "Key": "Name", "Value": "$NAME" }] }
}
JSON
  DIST=$(aws cloudfront create-distribution-with-tags --distribution-config-with-tags "file://$CFG" --query Distribution.Id --output text)
  rm -f "$CFG"
  say cloudfront "created $DIST (no caching, all methods, origin read timeout 60 s, https only)"
else
  # repair: point the origin at this instance if it changed (a replaced instance or a new Elastic IP), and give it
  # Parameter Store's origin secret if the header differs (a rotation: the relay takes the new one on the deploy below)
  CUR=$(aws cloudfront get-distribution-config --id "$DIST" --query 'DistributionConfig.Origins.Items[0].DomainName' --output text)
  CURS=$(aws cloudfront get-distribution-config --id "$DIST" --query "DistributionConfig.Origins.Items[0].CustomHeaders.Items[?HeaderName=='x-overdub-origin'].HeaderValue | [0]" --output text)
  if [ "$CUR" != "$ORIGIN" ] || [ "$CURS" != "$SECRET" ]; then
    TMP=$(mktemp); OUT=$(mktemp); chmod 600 "$TMP" "$OUT"
    ETAG=$(aws cloudfront get-distribution-config --id "$DIST" --query ETag --output text)
    aws cloudfront get-distribution-config --id "$DIST" --query DistributionConfig > "$TMP"
    SECRET="$SECRET" node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.argv[1]));const o=c.Origins.Items[0];o.DomainName=process.argv[2];const hs=((o.CustomHeaders||{}).Items||[]).filter((x)=>x.HeaderName!=='x-overdub-origin').concat([{HeaderName:'x-overdub-origin',HeaderValue:process.env.SECRET}]);o.CustomHeaders={Quantity:hs.length,Items:hs};fs.writeFileSync(process.argv[3],JSON.stringify(c))" "$TMP" "$ORIGIN" "$OUT"
    aws cloudfront update-distribution --id "$DIST" --if-match "$ETAG" --distribution-config "file://$OUT" >/dev/null
    rm -f "$TMP" "$OUT"
    say cloudfront "$DIST: origin $ORIGIN$([ "$CURS" != "$SECRET" ] && echo ', origin secret from Parameter Store')"
  else say cloudfront "$DIST exists, origin $ORIGIN"; fi
  unset CURS
fi
DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST" --query Distribution.DomainName --output text)

# ---------------------------------------------------------------------------------------------- DNS
CHG=$(mktemp)
cat > "$CHG" <<JSON
{ "Comment": "overdub relay", "Changes": [
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$DOMAIN", "Type": "A", "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "$DIST_DOMAIN", "EvaluateTargetHealth": false } } },
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "$DOMAIN", "Type": "AAAA", "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "$DIST_DOMAIN", "EvaluateTargetHealth": false } } } ] }
JSON
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "file://$CHG" >/dev/null
rm -f "$CHG"
say dns "$DOMAIN -> $DIST_DOMAIN"

# ---------------------------------------------------------------------------------------------- ship the relay
say deploy "shipping server/relay.js over SSM"
"$HERE/deploy.sh" --skip-tests
say 'done' "https://$DOMAIN/health (the distribution takes a few minutes to deploy the first time)"
