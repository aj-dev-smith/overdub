# Deploys

Two sites, one tree. Both are a private S3 bucket behind CloudFront (an origin access control, the path-rewrite
function in `path-rewrite.js`, no-cache text and day-cached media), and both ship exactly what is committed
(`git archive`), never the working tree. Ids live in the gitignored `deploy/.env` (see `env.example`), never here.

| | Live | Preview |
|---|---|---|
| Address | https://overdubstudio.com | https://next.overdubstudio.com |
| One-time setup | `deploy/setup.sh` | `deploy/next/setup.sh` |
| Ship | `deploy/deploy.sh` (HEAD, or `REF=…`) | `deploy/deploy.sh --next [REF]` (any committed ref; HEAD by default) |
| `app/site-config.json` (never committed) | written by the deploy: `deploy/site-config.json`, else `{}` | the same, plus `preview` and the commit |
| Search engines | indexed | `X-Robots-Tag: noindex, nofollow` on every response |
| Counts (`app/src/analytics.js`) | on | off (they count on `overdubstudio.com` only) |

`DRY_RUN=1` before either script stages the files and prints what it would send, calling nothing:
`DRY_RUN=1 deploy/deploy.sh --skip-tests --next HEAD~1`, `DRY_RUN=1 deploy/next/setup.sh`.
`tools/analytics-test.js` runs both dry with a stub `aws` and checks the plan.

## How the preview works

`deploy/next/setup.sh` (once; re-running skips what exists) makes the bucket `next.overdubstudio.com`, an ACM
certificate for that name validated by a CNAME in the overdubstudio.com zone, a copy of the path-rewrite function whose
home is `next.overdubstudio.com` (so its own paths resolve and nothing redirects testers to the live site), a response
headers policy with the managed security headers plus `X-Robots-Tag: noindex, nofollow`, the distribution, the bucket
policy that lets only that distribution read, and the A/AAAA alias. It writes the distribution id to
`deploy/.next-distribution-id` (gitignored); `deploy.sh --next` reads it, or looks the distribution up by its alias.

`deploy.sh --next REF` ships the same files the live site gets, with one difference in `app/site-config.json`, the
deploy's switches. That file is never committed and `deploy.sh` is its one writer: for both sites it starts from the
gitignored `deploy/site-config.json` (`SITE_CONFIG=<file>` reads another), else `{}`, and the preview's copy adds
`"env": "preview", "preview": true, "ref": "<commit>"`, keeping every other key as it is. The studio reads it at boot
(`app/src/ui/preview.js`, `app.site`) and puts a paper slip in the top-left corner, "Preview · <commit>", and starts
the tab's title with "Preview ·". The live site's copy has no `preview` key, so it never shows the slip. A ref from
before the ribbon existed (no `app/src/ui/preview.js`) deploys without the slip or the title; the noindex header still
applies, since it comes from the distribution.

## The preview from GitHub Actions

`.github/workflows/ci.yml` runs the suite on every pull request and every push to `main`, on macOS (the golden renders
match only on Apple Silicon). A push to `main` (a merge) whose suite passes is deployed to the preview by its
`deploy-staging` job; you can also start the workflow by hand on `main` (Actions › ci › Run workflow), which runs the
suite and then deploys. The real-time suites, which flake on GitHub's slow macOS VMs, run beside it in a job that
neither blocks the merge nor the deploy (ci.yml lists them). It signs in to AWS with GitHub's OIDC token, never a
stored key, as a role that can write the preview's bucket and invalidate its distribution and nothing else.
`deploy/next/github-oidc.sh` (once, `AWS_PROFILE=overdub`; `DRY_RUN=1` prints the plan) makes the role and GitHub's
identity provider; `BRANCHES` names the branches whose runs may assume it (default `main`). The role's
ARN and the distribution id go in the repository variables `NEXT_DEPLOY_ROLE` and `NEXT_DISTRIBUTION`.

What a tester should know: songs, keys and settings saved on the preview stay on the preview (each site keeps its own
browser storage). Connect to Claude doesn't work there: the relay accepts the live origin only.
