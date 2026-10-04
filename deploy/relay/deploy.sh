#!/usr/bin/env bash
# Ship server/relay.js (plus its tool catalog, server/relay-catalog.json) to the relay instance and restart it, over SSM
# (no SSH, no bucket: the release travels inside the command, gzip + base64). Run deploy/relay/setup.sh once first.
#
#   deploy/relay/deploy.sh [--skip-tests]
#
# On the instance: /opt/overdub-relay/releases/<stamp>/{relay.js,relay-catalog.json}, a current -> releases/<stamp>
# symlink, /etc/overdub-relay.env (root only: PORT, HOST, RELAY_TRUST_PROXY, RELAY_ORIGIN_SECRET) and the systemd unit
# overdub-relay.service (DynamicUser, read-only system, 320 MB cap, restarts on failure). Keeps the last 3 releases.
#
# The origin secret never passes through this script or the SSM command, whose parameters anyone who can read the
# account's SSM command history can see. The instance reads it from Parameter Store ($PARAM, a SecureString that
# setup.sh makes) while the command runs, and writes it only to the root-only env file.
set -euo pipefail
export AWS_REGION=${AWS_REGION:-us-east-1} AWS_PAGER=""
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME=overdub-relay
DOMAIN=overdub-relay.ajsmithhq.com
PORT=8787
PARAM=/overdub/relay/origin-secret   # SSM Parameter Store, SecureString (docs/REMOTE-MCP.md, "The origin secret")
say() { printf '\033[1m%s\033[0m %s\n' "$1" "${*:2}"; }
cd "$ROOT"

node --check server/relay.js
node tools/relay-catalog.js --check || { echo "server/relay-catalog.json is not the studio's catalog: run node tools/relay-catalog.js and commit it"; exit 1; }
if [ "${1:-}" != "--skip-tests" ]; then
  say test "node tools/relay-test.js"
  node tools/relay-test.js | tail -1
fi

if [ -n "${DRY_RUN:-}" ]; then
  INSTANCE=i-dryrun DIST=EDRYRUN
  say dry-run "no AWS calls: builds the release and prints the remote script"
else
INSTANCE=$(aws ec2 describe-instances --filters Name=tag:Name,Values="$NAME" Name=tag:project,Values=overdub Name=instance-state-name,Values=running --query 'Reservations[].Instances[0].InstanceId | [0]' --output text)
[ "$INSTANCE" != "None" ] && [ -n "$INSTANCE" ] || { echo "no running $NAME instance: run deploy/relay/setup.sh"; exit 1; }
DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$DOMAIN')].Id | [0]" --output text)
[ "$DIST" != "None" ] && [ -n "$DIST" ] || { echo "no CloudFront distribution for $DOMAIN: run deploy/relay/setup.sh"; exit 1; }
# the secret's name only (describe-parameters never returns a value): the instance reads the value itself
[ "$(aws ssm describe-parameters --parameter-filters "Key=Name,Option=Equals,Values=$PARAM" --query 'length(Parameters)' --output text)" = "1" ] \
  || { echo "no $PARAM in Parameter Store: run deploy/relay/setup.sh (docs/REMOTE-MCP.md, \"The origin secret\")"; exit 1; }
fi
say target "$INSTANCE behind $DIST"

# the release: relay.js + relay-catalog.json (the only tools it lists and passes on; checked current above), compacted
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp server/relay.js "$STAGE/relay.js"
node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))))" server/relay-catalog.json > "$STAGE/relay-catalog.json"
REL=$(date -u +%Y%m%d-%H%M%S)
PAYLOAD=$(tar -C "$STAGE" -cf - relay.js relay-catalog.json | gzip -9 | base64 | tr -d '\n')   # (gzip apart: bsdtar -z pads its output to 10 KB)
say release "$REL: $(wc -c < "$STAGE/relay.js" | tr -d ' ') B relay.js, $(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).length)" "$STAGE/relay-catalog.json") tools in the catalog, ${#PAYLOAD} B payload"
[ "${#PAYLOAD}" -lt 60000 ] || { echo "the release is too big to send inline over SSM (${#PAYLOAD} B): ship it through S3 instead"; exit 1; }

# the remote script (the payload goes in as 4 KB lines)
NODE_UNIT=$(cat <<UNIT
[Unit]
Description=Overdub relay (MCP for claude.ai)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/overdub-relay.env
ExecStart=__NODE__ /opt/overdub-relay/current/relay.js
WorkingDirectory=/opt/overdub-relay/current
DynamicUser=yes
Restart=always
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=320M
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
)
CMDS=$(mktemp)
node - "$CMDS" "$PAYLOAD" "$REL" "$PARAM" "$AWS_REGION" "$PORT" "$NODE_UNIT" <<'JS'
const fs = require('fs');
const [out, payload, rel, param, region, port, unit] = process.argv.slice(2);
const lines = [
  'set -eu',
  'cloud-init status --wait >/dev/null 2>&1 || true',
  'command -v node-22 >/dev/null 2>&1 || command -v node >/dev/null 2>&1 || dnf install -y nodejs22',
  'command -v aws >/dev/null 2>&1 || dnf install -y awscli-2',
  'NODE=$(command -v node-22 || command -v node)',
  'rm -f /tmp/overdub-relay.b64',
];
for (let i = 0; i < payload.length; i += 4000) lines.push(`printf %s '${payload.slice(i, i + 4000)}' >> /tmp/overdub-relay.b64`);
lines.push(
  `D=/opt/overdub-relay/releases/${rel}`,
  'mkdir -p "$D"',
  'base64 -d /tmp/overdub-relay.b64 | tar -xz -C "$D"',
  'rm -f /tmp/overdub-relay.b64',
  '"$NODE" --check "$D/relay.js"',
  'ln -sfn "$D" /opt/overdub-relay/current.new && mv -Tf /opt/overdub-relay/current.new /opt/overdub-relay/current',
  // the origin secret, read here on the instance from Parameter Store (its role may read that one parameter): it is
  // never part of this command, and nothing here prints it
  'umask 077',
  `SECRET=$(aws ssm get-parameter --region ${region} --name ${param} --with-decryption --query Parameter.Value --output text)`,
  `[ -n "$SECRET" ] && [ "$SECRET" != None ] || { echo "no origin secret in Parameter Store (${param}): run deploy/relay/setup.sh"; exit 1; }`,
  `printf '%s\\n' 'PORT=${port}' 'HOST=0.0.0.0' 'RELAY_TRUST_PROXY=1' "RELAY_ORIGIN_SECRET=$SECRET" 'NODE_ENV=production' > /etc/overdub-relay.env`,
  'unset SECRET',
  'umask 022',
  `cat > /etc/systemd/system/overdub-relay.service <<'UNIT'\n${unit}\nUNIT`,
  'sed -i "s#__NODE__#$NODE#" /etc/systemd/system/overdub-relay.service',
  'systemctl daemon-reload',
  'systemctl enable overdub-relay >/dev/null 2>&1',
  'systemctl restart overdub-relay',
  'for i in $(seq 1 20); do curl -fsS -H "x-overdub-origin: $(sed -n s/^RELAY_ORIGIN_SECRET=//p /etc/overdub-relay.env)" http://127.0.0.1:' + port + '/health && break; sleep 0.5; done',
  'echo',
  'sleep 1; systemctl is-active --quiet overdub-relay || { journalctl -u overdub-relay -n 30 --no-pager; exit 1; }',
  'ls -1dt /opt/overdub-relay/releases/* | tail -n +4 | xargs -r rm -rf',
  'echo "release $(readlink /opt/overdub-relay/current) is live on $("$NODE" --version)"',
);
fs.writeFileSync(out, JSON.stringify({ commands: lines }));
JS

if [ -n "${DRY_RUN:-}" ]; then
  node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1])).commands.join('\n'); console.log(c.replace(/printf %s '[^']{100,}'/g, (m) => m.slice(0, 40) + \"…'\"))" "$CMDS"
  rm -f "$CMDS"; exit 0
fi

# a fresh instance needs a minute or two before SSM can reach it
for i in $(seq 1 60); do
  PING=$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
  [ "$PING" = "Online" ] && break
  [ "$i" = 1 ] && say ssm "waiting for $INSTANCE to check in with SSM"
  sleep 5
done
[ "$PING" = "Online" ] || { echo "$INSTANCE never came online in SSM (is the instance profile attached? does it have internet?)"; exit 1; }

CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript --comment "overdub relay $REL" \
  --parameters "file://$CMDS" --query Command.CommandId --output text)
rm -f "$CMDS"
say ssm "command $CMD sent; waiting"
aws ssm wait command-executed --command-id "$CMD" --instance-id "$INSTANCE" || true
STATUS=$(aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text)
aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query StandardOutputContent --output text | tail -3
if [ "$STATUS" != "Success" ]; then
  aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query StandardErrorContent --output text | tail -20
  echo "deploy failed: $STATUS"; exit 1
fi
say live "$REL on $INSTANCE"
if curl -fsS --max-time 10 "https://$DOMAIN/health" 2>/dev/null; then echo; say check "https://$DOMAIN/health answers"; else say check "https://$DOMAIN/health does not answer yet (a new distribution takes a few minutes)"; fi
