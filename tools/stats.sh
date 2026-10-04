#!/usr/bin/env bash
# stats.sh — what people did on overdubstudio.com, counted from CloudFront's access logs with Athena.
# usage: tools/stats.sh [days=7]        (first, once: deploy/analytics/setup.sh)
# What is counted, and how: app/src/analytics.js and site/assets/analytics.js. Logs land a few minutes to an hour
# after the fact and are deleted after 90 days. Requires AWS credentials (`aws login`).
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1
DAYS="${1:-7}"
[[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "usage: tools/stats.sh [days]" >&2; exit 2; }
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
OUT="s3://overdub-logs-${ACCOUNT}/athena-results/"
SINCE="current_date - interval '${DAYS}' day"

run() { # run one query, print the result as a table
  local id st
  id=$(aws athena start-query-execution --query-string "$1" --work-group primary \
    --result-configuration "OutputLocation=${OUT}" --query QueryExecutionId --output text)
  while :; do
    st=$(aws athena get-query-execution --query-execution-id "$id" --query QueryExecution.Status.State --output text)
    case "$st" in
      SUCCEEDED) break ;;
      FAILED|CANCELLED) aws athena get-query-execution --query-execution-id "$id" --query QueryExecution.Status.StateChangeReason --output text >&2; return 1 ;;
    esac
    sleep 1
  done
  aws athena get-query-results --query-execution-id "$id" --output json |
    python3 -c 'import json,sys; rows=[[c.get("VarCharValue","") for c in r["Data"]] for r in json.load(sys.stdin)["ResultSet"]["Rows"]]
w=[max(len(r[i]) for r in rows) for i in range(len(rows[0]))] if rows else []
for r in rows: print("  ".join(v.ljust(w[i]) for i,v in enumerate(r)))'
}

echo "== each day, last ${DAYS} day(s) (UTC). views: landing page loads · opens: studio loads · played: studio loads that pressed play"
run "SELECT \"date\",
  count_if(e = 'view') AS views, count_if(e = 'open') AS opens, count_if(e = 'play') AS played,
  count_if(e = 'agent') AS agent_msgs, count_if(e = 'device') AS devices, count_if(e = 'export') AS exports,
  count_if(e = 'share') AS shares, count_if(e = 'hum') AS hums, count_if(e = 'keep') AS keeps
FROM overdub.events WHERE \"date\" >= ${SINCE} GROUP BY 1 ORDER BY 1 DESC"

echo; echo "== by kind: agent (demo, byok = each message; mcp, claude.ai = once per studio load), devices (who), exports (file), shares, keeps, opens (how)"
run "SELECT e AS event, p AS kind, count(*) AS n FROM overdub.events
WHERE \"date\" >= ${SINCE} AND e IN ('agent', 'device', 'export', 'share', 'keep', 'open') GROUP BY 1, 2 ORDER BY 1, 3 DESC"

echo; echo "== where views and opens came from (the linking site's host only; none = typed, bookmarked or private)"
run "SELECT coalesce(nullif(r, ''), '(none)') AS referrer, count_if(e = 'view') AS views, count_if(e = 'open') AS opens
FROM overdub.events WHERE \"date\" >= ${SINCE} AND e IN ('view', 'open') AND r <> 'overdubstudio.com'
GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 25"

echo; echo "== studio opens from the landing page"
run "SELECT count(*) AS opens FROM overdub.events WHERE \"date\" >= ${SINCE} AND e = 'open' AND r = 'overdubstudio.com'"
