# Bring your agent to Overdub

Overdub's studio speaks MCP. One local server, `server/mcp.js`, gives any MCP client the same tools the in-app
agent uses: read the song and the selection, edit through signed and undoable ops, offer takes as A/B cards, write
devices that the studio checks before they play, and render-and-measure so an agent that can't hear can still
report what changed. This folder makes that one install away for Claude Code and a short JSON block away for
everything else.

| file | what |
|---|---|
| [`claude-code/`](claude-code/) | the Claude Code plugin: `.claude-plugin/plugin.json` (the MCP server) and `skills/overdub/SKILL.md` (how to run a good session) |
| `.claude-plugin/marketplace.json` (at the repo root) | the marketplace file that makes this repo installable with `/plugin`: see [For maintainers](#for-maintainers) |
| [`check.js`](check.js) | `node integrations/check.js`: validates the manifests and runs every config on this page over stdio |

## First: live site or local server?

**The bridge between an outside agent and the studio only runs on your machine.**

- **[overdubstudio.com/app/](https://overdubstudio.com/app/)** (the public studio) works with the agents that
  live inside the page: the **demo agent** in the Agent tab, a scripted session on the real tools, free. The studio
  keeps no API key. Claude Code, Claude Desktop and Cursor
  **can't** connect to a tab on the public site. The page doesn't even try: the bridge stays quiet off localhost.
- **[localhost:3279/app/](http://localhost:3279/app/)** (the studio served by your clone) is the one outside agents
  drive. You don't have to start it: `server/mcp.js` starts the local server itself if nothing is listening, and on
  the first tool call it opens the studio in your default browser if no tab is connected. Any current browser works
  (Chrome, Edge, Safari, Firefox), as long as the tab is on localhost; keep it open while you work.

Your songs are stored per origin in the browser, so a song on the public site and a song on `localhost:3279` are
separate. To move a song across, save the song file (⌘S) on one and open it (⌘O) on the other. Audio recordings stay
in the browser they were made in.

Requirements for the local route: a clone of this repo and Node 22 or later. There is nothing to `npm install`; the
server has no dependencies.

```sh
git clone https://github.com/aj-dev-smith/overdub.git ~/Code/overdub
```

## Claude Code

### Option A: the plugin (recommended)

The plugin bundles the MCP server and the `overdub` skill, which teaches Claude the room's rules and five recipes:
write a part, offer takes, build a device, check the mix, and turn a hum into a part.

From GitHub, inside Claude Code:

```text
/plugin marketplace add aj-dev-smith/overdub
/plugin install overdub@overdub
```

Or from your shell: `claude plugin marketplace add aj-dev-smith/overdub` then `claude plugin install overdub@overdub`.
Claude Code copies the repo into its plugin cache and runs the server from there, so you don't need a separate clone.

From a clone you're working on, so your edits apply on the next session or `/reload-plugins`:

```sh
claude plugin marketplace add ~/Code/overdub          # loads the plugin in place from the clone
claude plugin install overdub@overdub
```

For one session only, without installing anything:

```sh
claude --plugin-dir ~/Code/overdub/integrations/claude-code
```

Then just ask: *"Look at my Overdub song and give me two takes on the bassline."* The skill loads on its own when the
request is about Overdub. You can also invoke it as `/overdub:overdub`. The tools appear as
`mcp__plugin_overdub_overdub__*`.

### Option B: just the MCP server

```sh
claude mcp add overdub --scope user -- node ~/Code/overdub/server/mcp.js
```

`--scope user` makes it available in every project. Leave the scope out to add it to the current project only. The
tools appear as `mcp__overdub__*`. With this route you get the tools and the server's built-in instructions, but not
the skill. To add the skill on its own, copy `integrations/claude-code/skills/overdub/` into `~/.claude/skills/`.

With settings, as JSON:

```sh
claude mcp add-json overdub '{"type":"stdio","command":"node","args":["/path/to/overdub/server/mcp.js"],"env":{"OVERDUB_PORT":"3279"}}' --scope user
```

Use one route or the other. With both, Claude sees every tool twice (`mcp__overdub__*` and
`mcp__plugin_overdub_overdub__*`). It still works, but it's noise.

## Claude Desktop

Settings → Developer → Edit Config, which opens `claude_desktop_config.json`
(`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows). Add:

```json
{
  "mcpServers": {
    "overdub": {
      "command": "node",
      "args": ["/path/to/overdub/server/mcp.js"]
    }
  }
}
```

Restart Claude Desktop. Two things catch people out:

- **Use absolute paths, including for `node`.** Desktop apps don't read your shell profile, so a `node` installed
  through nvm, mise, fnm or asdf usually isn't on their `PATH`. If the server doesn't show up, put the output of
  `which node` in `command` (for example `/Users/you/.local/share/mise/installs/node/lts/bin/node`).
- Claude Desktop doesn't load the skill. It gets the server's built-in instructions (read the etiquette guide, act on
  the selection, measure before and after) from the MCP handshake, and the tools themselves explain the rest.

## Cursor

Add the server to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "overdub": {
      "command": "node",
      "args": ["/path/to/overdub/server/mcp.js"]
    }
  }
}
```

The same absolute-`node` caveat applies. The studio shows the agent as "Cursor".

## Any other MCP client

Overdub is a plain **stdio** server: JSON-RPC 2.0, one message per line, nothing but protocol on stdout (logs go to
stderr). It speaks protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`, and offers tools only (no resources
or prompts). Most clients take the same `mcpServers` block as Cursor. VS Code's `.vscode/mcp.json` uses `servers`
and a `type`:

```json
{
  "servers": {
    "overdub": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/overdub/server/mcp.js"]
    }
  }
}
```

Codex CLI, in `~/.codex/config.toml`:

```toml
[mcp_servers.overdub]
command = "node"
args = ["/path/to/overdub/server/mcp.js"]
```

The studio names the agent from the client's `clientInfo.name`. Its edits are signed `mcp:<name>` and shown in the
cool agent colour.

Two tools wait for the human. `propose_variations` waits up to 90 s for a pick, and `ask_human` up to 120 s for an
answer. If your client times tool calls out sooner, pass a smaller `wait_seconds`, then poll
`get_variation_result` with the returned `id`.

What this page has actually exercised: Claude Code (the plugin from a local marketplace, from a git-hosted marketplace
and with `--plugin-dir`; `claude mcp add`; `claude mcp add-json`) reported the server ✔ Connected, and a session listed
the skill and the studio's tools. `check.js` runs every JSON config above over stdio. It hasn't been tried inside Claude
Desktop, Cursor, VS Code or Codex themselves, so their file locations and keys come from those clients' docs.

## Settings

Set these in the client's `env` block, or with `-e` on `claude mcp add`.

| variable | default | what |
|---|---|---|
| `OVERDUB_PORT` | `3279` | the local server's port. The studio URL follows it: `http://localhost:<port>/app/` |
| `OVERDUB_URL` | `http://localhost:3279` | a full base URL instead. A non-local URL is never started for you |
| `OVERDUB_OPEN_WAIT` | `20` | seconds to wait for a studio tab after opening the browser |
| `OVERDUB_NO_OPEN` | unset | `1` stops it opening a browser (tests use this) |

If you already run `node server/serve.js` yourself, the MCP server uses that server instead of starting its own.

## When it doesn't work

| you see | do this |
|---|---|
| `No Overdub studio tab is connected.` | Open `http://localhost:3279/app/` (or the URL in the message) in your browser and keep it open, then ask again. A tab on overdubstudio.com doesn't count. |
| The server isn't listed, or shows ✘ Failed | Run `node /path/to/overdub/server/mcp.js` in a terminal. It should sit silently waiting for input (Ctrl-C to quit). If `node` isn't found or is older than 22, fix the `command` path. |
| `Overdub is not running at …` | `OVERDUB_URL` points somewhere the MCP server can't start a server. Unset it, or start the server there yourself. |
| Port 3279 is taken by something else | Set `OVERDUB_PORT` (say `3280`) and open the studio on that port. |
| Tools show up twice | You have both the plugin and `claude mcp add overdub`. Remove one. |
| The plugin doesn't update | Without a `version` field, the plugin tracks the repo's commits. Run `/plugin marketplace update overdub`, then `/reload-plugins`. |

## Safety

- The bridge listens on `127.0.0.1` only, and refuses requests that carry another site's browser `Origin`, so a web
  page can't drive your studio.
- The plugin runs exactly one process, `node <repo>/server/mcp.js`, which is the code in this repo. It has no
  dependencies and nothing is installed.
- Agent edits are ops in the song's undo history, signed and coloured. The History tab can revert everything an agent
  did while keeping your edits in between.
- The skill pre-approves only the tools that read, measure, point or talk (`get_*`, `list_devices`,
  `render_and_measure`, `highlight`, `say`), and only while the skill is running. Tools that change the song still
  ask, unless you allow them.

## For maintainers

**The marketplace file lives at the repo root**, `<repo>/.claude-plugin/marketplace.json`, because that is the only
place Claude Code looks for one (`/plugin marketplace add aj-dev-smith/overdub`). It was staged under
`integrations/repo-root/` at first and has since moved; `check.js` still finds it in either place.

Why the plugin's source is the repo root and not `integrations/claude-code`: an installed plugin is copied into
Claude Code's cache, and only the plugin's own directory is copied. A plugin rooted at `integrations/claude-code`
couldn't reach `server/mcp.js` (or the studio it serves) after install. So the marketplace entry points at `./`. It
names the skill folder (`./integrations/claude-code/skills/`) and runs `${CLAUDE_PLUGIN_ROOT}/server/mcp.js`. The
tracked repo is about 33 MB (most of it the film, its social cuts and the deck's PDF), so the copy is cheap enough. Keep a `plugin.json` out of the repo root: if one existed there it
would become the manifest, and the entry's `mcpServers` would be ignored.

`integrations/claude-code/.claude-plugin/plugin.json` is for `--plugin-dir` and other in-place loads from a clone.
Its server path is `${CLAUDE_PLUGIN_ROOT}/../../server/mcp.js`, which only resolves when the plugin isn't copied.

Neither manifest sets `version`, so installs track commits. Add `"version"` to the marketplace entry when you want
users to stay on a release until you bump it.

Before shipping a change here:

```sh
node integrations/check.js                                         # manifests, skill, every config above over stdio
claude plugin validate .                                           # the marketplace
claude plugin validate integrations/claude-code                    # the --plugin-dir plugin
```

`claude plugin validate integrations/claude-code` warns that `version` is unset. That's on purpose.

### claude.ai, through the hosted relay

Our landscape research noted that a browser-hosted MCP that works
from claude.ai would be an advantage no local-socket desktop bridge can match. The local bridge stays local by design.
A hosted relay for claude.ai is live (`server/relay.js`, `tools/relay-test.js`; the design, limits and hosting are in
[REMOTE-MCP.md](../docs/REMOTE-MCP.md)). Open the studio's **Connect** tab, press **Turn on**, and add the connector
URL in claude.ai under Settings → Connectors → Add custom connector. claude.ai says it has no sign-in; that's
expected, the URL is the key.
