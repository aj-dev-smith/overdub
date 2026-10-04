# Security

What Overdub protects, how it handles a stranger's song, and what is still open. From the review of 2026-10-02:
three reviewers, one for each way in (code inside songs; song and link data reaching the page; secrets, agents and
the platform), then the fixes in four groups, each fix with a check that fails on the old code and passes on the new.
The fixes are commits `9cbced5`, `2e39267`, `62f4c8a`, `289ad3d`, `e53e3a9` and `4f0b621`; `de084c1` closed the first
open item (no script comes from a `data:` or `blob:` URL), and asking before a shared song's code runs came after, then
the agent asking before it takes anything out of a song from a link.

## What it protects, and from whom

- **The person's Anthropic API key**, kept in `localStorage` (`overdub:anthropic-key`) on overdub.ajsmithhq.com. It
  leaves the browser only in the `x-api-key` header of requests to api.anthropic.com. The review checked it with a
  placeholder key: it isn't in a share link, a song file, History, the agent's messages, analytics, toasts, logs, the
  MCP server or the relay, and no song or link can make it go anywhere else.
- **Their songs.** A song lives in the browser; a share link carries it in the URL hash, which never reaches a server.
- **Their machine**, when they run the local server, the MCP server or the Node renderer.
- **Who made what**: bylines, History and the provenance report.

The threats: someone who sends a share link, a song file or a device file; a web page open while the local server
runs; and text in a song written to steer an agent.

## How the studio takes a stranger's song

- **Code.** A song's devices are kernels: source text, evaluated only in the AudioWorklet (and the Node renderer),
  never on the page that holds the key. The page only parses kernel source. A song's device brings nothing else that
  runs: `build` and `worklets` (module source the graph path loads into the audio thread) are dropped by a song file,
  a link and the registry. The worklet scope is a rule for determinism, not a security boundary.
- **Asked first.** A song's device runs only once this browser trusts its code (`devices/trust.js`; ARCHITECTURE.md,
  "Who runs a song's code"). Trust is by SHA-256 of the kernel's source, kept in `overdub:trusted-kernels`. The studio's
  own kernels, the shipped demo songs' devices, what the person's own agents define here and device files the person
  imports are trusted without asking, and the first run of this version trusted the songs this browser already kept,
  once (and a link this browser made before then: its moment is sealed in its mark; one made since gets no pass, so
  sharing a song to yourself can't let held code play). Anything else a link or a song file brings is held: never
  registered, so nothing compiles, checks or renders it; an instrument plays silence and an effect is bypassed, live,
  in exports, in the provenance report's checks and in every agent measurement. The banner (or, for a file, the same
  strip in its place) names the devices and who wrote them, says they're code that runs on this computer, and asks:
  **Play them** trusts that code for good, **Keep them off** leaves it held and the song asks again next time. Agents
  see held devices but no tool lets them play, and `define_device` refuses a held kernel under any id. `share-test`,
  `demos-test`, `agent-test`, `library-test` and `provenance-test` check it, with every kernel that reaches the audio
  thread written down.
- **Data.** `h()` (`ui/dom.js`) never turns data into markup, and the review found no way in for script across every
  panel. Names are plain text up to 100 characters, without control characters or bidi overrides. Colours are a
  palette token or hex where a song comes in, in the ops, and again in every view that draws one. A link is held to
  the growth limits and to 64 levels of nesting, and numbers from a file are made finite.
- **The page.** The studio, the device library and the gallery carry a Content Security Policy (a `<meta>` tag, first
  in the head; `app/index.html` says why each allowance is there). Scripts come from the site itself, worklet modules
  included: each is a file there (`kernel/processor.js`, `devices/worklets/`, `vendor/clawd/worklets/`,
  `input/cap-worklet.js`), so no script comes from a `data:` or `blob:` URL (`blob:` stays in `worker-src` for the
  engine's timer Worker). Connections go to the site, api.anthropic.com and the relay (and loopback, for local work),
  images to the site, `data:` and `blob:`, media to the site and `blob:`, and fonts and stylesheets to the site alone:
  the faces are files there (`app/style/fonts.css`, each family beside its licence), so no other host's CSS is on the
  page that keeps the key and no visitor's address goes to a font host, from any page. Inline scripts (but the
  library's and gallery's own, by hash), inline event handlers, plugins, `<base>` and forms are refused. CloudFront's
  managed policy adds HSTS, `X-Frame-Options: SAMEORIGIN`, `nosniff` and a referrer policy.
- **Authorship.** A link signs every part that isn't an agent's, an earlier guest's or the house's as the guest who
  sent it, including a part with no signature. An author id's form fixes whether it is a person or an agent, and no
  one else can go by You, Claude, Overdub, claude.ai or an agent in the session.
- **Agents.** Song text is content, not instructions (etiquette rule 8, which also covers device code, check reports
  and runtime errors). The selection reaches the in-app agent escaped inside its `<context>` wrapper, so a name can't
  close it and speak as the person; Ask quotes the names it fills in. MCP and relay results that carry song text lead
  with a note (`about`) saying whose words they are. On a song from a link, until Make it yours, an agent's
  deletions, rewrites and new devices change nothing until the person keeps them on a card ("Decided and built",
  below), so a name that talks an agent into wiping the song wipes nothing. A device check has a deadline (60 s) and stops when the person
  presses Stop, and while a render it gave up on still holds Chrome's offline worklet thread, no other check or song
  render starts behind it.
- **Local.** `server/serve.js` answers only requests made to localhost or an IP (DNS rebinding), sends no CORS
  header, and serves nothing under a dot name (`.git`, `tools/.out`). The bridge also refuses a browser request from
  another site (`Sec-Fetch-Site`), opens an event stream only for a page that said hello first, uses random call ids
  and takes at most 8 MB. The Node renderer runs a song under Node's permission model, reading only `app/`, the
  script and the files named on its command line.

## The findings

| Finding | Severity | Now |
|---|---|---|
| A song's device could load module code into the audio thread (`build` + `worklets`), past the kernel's rules and the device check | Medium | Fixed (`9cbced5`) |
| The local server sent `Access-Control-Allow-Origin: *`, so any page could read the checkout (`.git` too) while it ran | Medium | Fixed (`9cbced5`) |
| A long run of spaces in a kernel froze the page for about 45 s (a quadratic regex) | Low to medium | Fixed (`9cbced5`) |
| A song's colour could be a `url()`, so opening a link made the browser call the sender's server | Medium | Fixed at the door, in the ops and in every view (`2e39267`, `e53e3a9`, `4f0b621`) |
| A link could credit the receiver with the sender's unsigned parts, and relabel agents and guests | Medium | Fixed (`2e39267`) |
| No Content Security Policy, with the key in origin-wide storage | Medium | The studio, library and gallery have one (`e53e3a9`), with no `data:` or `blob:` scripts (`de084c1`) |
| The policy allowed `data:` scripts (for worklets): markup that got into the page could run script on the key's origin through an `<iframe srcdoc>` (Chromium, WebKit, Firefox) | Low (no injection point known: the backstop) | Fixed (`de084c1`) |
| A shared song's text can steer the in-app agent, whose tools act without the person | Medium | Names escaped, quoted and capped (`e53e3a9`, `2e39267`); on a song from a link its deletions, rewrites and new devices wait for the person's Keep; a budget per turn is AJ's call |
| A shared song's text reaches outside agents with stronger tools (Claude Code has a shell) | Medium | Results carry the `about` note and rule 8 says so (`62f4c8a`); in the studio their deletions, rewrites and new devices on a song from a link wait for the person's Keep too; what a shell does outside the studio is the agent's own |
| The relay (not deployed): one token unlocks both the MCP side and the tab side | Medium before it ships | Fixed: the tab proves a 256-bit secret the connector URL doesn't carry (the token is a one-way hash of it), in a header, never a URL; `tools/list` is the relay's own catalog, not the tab's, and other names are refused |
| The relay echoed request text at length in errors, logged error messages (which can quote a request), compared its origin secret in variable time, and took any nesting or batch size | Low | Fixed: names cut to 64 safe characters, bad ids refused, only an error's kind logged, constant-time compares, 64 levels and 16 messages at most |
| In the Node renderer a song's kernel could read the whole checkout | Medium | Reads narrowed (`62f4c8a`); the network is still open (Node 24 has no network permission) |
| A kernel that never returns: the agent waited until reload, and live audio stops with no recovery | Medium (availability) | Checks have a deadline and Stop works (`62f4c8a`); renders don't queue behind a held one (`289ad3d`); live playback is open |
| Song size limits weren't applied to a link | Low to medium | Fixed (`2e39267`) |
| `?relay=` worked on the live site (shows Connect; could send a tab's token to a local port) | Low | Fixed (`e53e3a9`); the relay's trial switch, `?connect=1`, shows Connect for the hosted relay only |
| The bridge took any request without an Origin, so a page could take over the live tab (denial of service) | Low | Fixed (`62f4c8a`) |
| `Infinity` from a song file reached clip positions; a deeply nested link threw | Low | Fixed (`2e39267`) |
| Kernels in one audio context share the worklet's built-in prototypes | Low | Open |
| Google Fonts on every page: each visitor's IP goes to Google, and CSS can read attribute values on the key's page | Low | Fixed: the fonts are files on the site (`app/style/fonts.css`), no page asks Google for anything, and the policies name no font or style host (`font-src 'self'`); the provenance report takes the same files, inside it when it is saved |
| The relay's memory and capacity limits; its origin secret travels in SSM command parameters | Low, before it ships | Fixed: caps on bodies, held and unread bytes, sessions, streams and calls in flight, a rate limit per address (an IPv6 /64), `429`/`503` with `Retry-After` (calls in flight: a tool error saying when); the instance reads the secret from Parameter Store |
| Analytics: only words from a fixed list are sent, but CloudFront's logs keep IP, browser and referrer for 90 days | Info | Disclosed; AJ's call |
| The audio thread shares the page's renderer process, where the key is | Info | Long term (WASM kernels, or the engine on its own origin) |

## Checked and sound

No script injection from song or link data (tried in every panel). No prototype pollution (`__proto__`,
`constructor`, `prototype` through links and ops). The 8 MB inflate cap stops decompression bombs. The MIDI importer
is bounded. The main thread never runs kernel source. The live site refuses framing from other origins. The MCP
server has no file or URL access of its own. Analytics sends only fixed words, and not from localhost.

## Still open

Code, no decision needed:

1. **A kernel that hangs during playback.** Audio stops until reload, autosave brings the device back, and `?new` is
   the only way out. A heartbeat could rebuild the audio context without the newest song device and name it. (A
   link's or a file's kernel now hangs only after the person has let it play, and its code stays trusted after that.)
2. **Song renders** (`render_and_measure` on a song with a hanging kernel) have no deadline yet.
3. **Freeze the worklet's built-in prototypes** before any kernel runs.
4. **Self-host the fonts: done.** The five families the pages draw in (Archivo, Atkinson Hyperlegible Next and Mono,
   and the device faces' Rubik Dirt and Silkscreen) are woff2 files on the site, each folder in `app/style/fonts/`
   with its licence (the SIL OFL 1.1), declared in `app/style/fonts.css` with the weights, widths and ranges Google
   Fonts served, so nothing on a page moved; `tokens.css` imports it, so every page that has the tokens has the faces.
   No page asks Google for anything; the studio's, library's and gallery's policies say `font-src 'self'` and name no
   style host. The provenance report takes the same files: by URL in its tab, inside the page when it is saved.
5. **The relay, before it ships: fixed.** The tab now proves a 256-bit secret the connector URL doesn't carry (the
   token is a one-way SHA-256 of it; a browser that kept an old token gets a new pair and is told once); `tools/list`
   is the relay's own catalog (`server/relay-catalog.json`, generated from `tools.js` and checked), and other names
   are refused; caps on bytes, sessions and streams, and a rate limit per address or /64, answer `429` or `503` with
   `Retry-After` (a call one too many in flight is a tool error that says when to retry); the instance reads the
   origin secret from Parameter Store; and its host is in the policy's `connect-src`. Left: deploying it (AJ's call, about $7.40 a month) and the plain-HTTP hop from CloudFront
   to the instance (REMOTE-MCP.md, "Known gap").
6. **Smaller:** the engine's timer Worker as a file (so `worker-src` can be `'self'`); warn when sharing a song a link can't carry (past the limits); make the loop's values finite at load;
   give the landing and docs pages a policy (their inline scripts need hashes).

AJ's calls:

1. **How much an agent does on a song from a link in one turn**: a budget per turn (calls, or changes), and the
   tokens a turn used shown to the person. (What it takes away already waits for Keep: below.)
2. **Whether a sender's agent signatures travel.** Today a link's `claude` parts stay Claude's, on the sender's word
   (the ask names such a device "Claude for Sam", so the listener knows whose link it came in).
3. **The policy as a CloudFront header**, for `frame-ancestors` and violation reports (it must carry the library's and
   gallery's script hashes).
4. **How long CloudFront's logs keep IPs.**

Decided and built:

- **Ask before running a shared song's code** (AJ's call 1 in the review). A link's or a song file's devices stay off
  until the listener allows them; see "Asked first" above.
- **The agent on a song from a link: deletions, rewrites and new devices as cards to Keep** (AJ's call 1 after it).
  While the person listens to a song from someone else's link (`app.share.listening`, until Make it yours), a change
  by any caller but the person (the in-app agent, the demo agent, MCP, the relay) that deletes (a track, a clip,
  notes, a section, bars, an insert, automation), rewrites what's there (notes, a lane's points, an instrument) or
  brings a new device isn't applied: the store's guard holds it (`agent/keep.js`), and the whole call, adds and all,
  goes to the person as one card with **Keep** and **Keep as it was**. The agent gets `offered: true` and an id, never
  a claim that it changed something. Keep lands the change signed by the agent; a new device's code isn't checked,
  trusted, registered or auditioned until Keep, which runs the device check first. Adds and mix moves go straight
  through.

## Re-checking

The checks live in the suites they guard: `share-test` and `core-test` (links, authorship, limits, names, colours;
`share-test` also the ask before a song's code runs, with `demos-test`, `agent-test`, `library-test` and
`provenance-test`), `kernel-test` (the regex, the check's deadline, held renders), `mcp-e2e-test` (the file server, the
bridge, the `about` note), `bench-test` (the Node renderer's reads), `arrange-test` (colours in every view),
`compat-test` (the policy in Chromium, WebKit, Firefox and a phone: no violation in a session, every worklet module a
file on the site, and an `<iframe srcdoc>` with a `data:` script, or a worklet from a `data:` or `blob:` URL,
refused; the studio, library, gallery and landing page ask no host but the site for anything, and no policy names a
font or style host), `brand-test` (each family loads from `/app/style/fonts/`, beside its licence), `pages-test` (the
docs and press pages ask no other host), `provenance-test` (the report's fonts are the studio's own, inside it when
saved), `guitar-test` (each vendored worklet file is the source the pedals build, byte for byte), `relay-test`
(`?relay=`; the tab secret: the connector URL alone can't open the tab side, take its stream or answer a call, and the
secret travels in a header, never a URL; `tools/list` is the catalog whatever a tab registers, and other names are
refused; `relay-catalog.js --check`; errors that don't echo input, bounded batches and nesting; the caps and the rate
limit per address and per /64 answering `429` or `503` (calls in flight, a tool error) and recovering; sessions, links and addresses ageing out; no
log line with a token, a secret or a session id; the move from an old stored token; the relay in `connect-src`; the
deploy dry run carrying no origin secret; Connect in WebKit and Firefox) and `agent-test` (the selection context; and,
in its section 3e, a song from a link: an agent's deletions, note and lane rewrites, transforms, deleted bars and new
devices come back `offered` and change nothing; Keep lands them signed by the agent, a new device only after its check;
Keep as it was changes nothing; adds go straight through; a call that adds and deletes is one take; the store holds a
deletion from any tool, even one that goes around the app it was given; the same over the real MCP bridge and from the
demo agent; after Make it yours, and on a song that never came from a link, everything applies directly).
