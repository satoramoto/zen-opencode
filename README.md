# zen-opencode

Custom sidebar plugins and a Git signing startup check for **OpenCode v2**.
The initial snapshot targets the `@opencode/plugin` **2.0.18** API; these are not
v1 plugins and compatibility with other v2 releases is not guaranteed.

## Plugins

| Plugin | Purpose |
| --- | --- |
| `session-dashboard` | Sessions sidebar with open tabs and session metrics. |
| `context-bar` | Context usage, estimated breakdown, and session cost. |
| `mcp-overview` | MCP connection status and tool/resource counts. |
| `subagents` | Task tree and expanded task panel. |
| `activity-mosaic` | Color-coded grid of recent session activity. |
| `github` | Branch pull requests and CI status via the `gh` CLI. |
| `credits` | Account allowances for GitHub Copilot and the Lightspeed LLM gateway. |
| `git-signing-startup.ts` | Best-effort macOS 1Password SSH signing authorization at service startup. |

Sidebar plugins share `ui/sidebar-section.tsx`, which supplies collapsible headers
and persisted section preferences. Keep the directory structure intact: the
plugins import this shared component, and the signing entry point imports the
root `git-signing-startup.ts` helper.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun test
```

Tests cover helpers and component behavior using lightweight terminal/UI fixtures;
they are not interactive terminal layout verification.

## Install locally

OpenCode discovers local plugins under `~/.config/opencode/plugins/`. To install
from this checkout, copy the seven plugin directories, the signing entry point,
the root signing helper, and the `ui/` directory into the corresponding locations
under `~/.config/opencode/`. **Back up existing files first** and do not overwrite
unrelated plugins or personal configuration. Install the dependencies from
`package.json` in that config directory, preserving its existing dependencies.

Alternatively, symlink those individual directories/files from the checkout into
the same locations after backing up any existing destinations. Do not link the
entire `plugins/` directory if it would hide other installed plugins.

Merge the following selection into your existing `~/.config/opencode/cli.json`
to enable the plugins and replace the built-in Context and MCP sections:

```json
{
  "plugins": ["*", "-opencode.sidebar.context", "-opencode.sidebar.mcp"]
}
```

Restart OpenCode after changing plugins or configuration. This repository does
not change an existing installation automatically.

## Integration requirements

- **GitHub:** install and authenticate `gh`. The current implementation also looks
  up same-branch PRs in `chronogolf/golf-e2e` when working in
  `chronogolf/chronogolf`; this is an optional, project-specific behavior.
- **Credits:** reads existing OpenCode integrations named `github-copilot` and
  `lightspeedllm`. Copilot uses an unofficial GitHub endpoint. The Lightspeed
  allowance uses `https://llm.lightspeeddev.app/v2/user/info` and requires an
  existing authorized account/integration; its SSO plugin is not included.
  Credentials are resolved server-side at runtime, not checked into this repo.
- **Signing:** only probes when Git has `commit.gpgsign=true`, `gpg.format=ssh`,
  a signing key, and `gpg.ssh.program` set to
  `/Applications/1Password.app/Contents/MacOS/op-ssh-sign`. It may prompt for
  approval and waits up to 60 seconds. Failure does not disable signing or stop
  startup. It signs a probe message, not a Git commit.

## Scope

This repository tracks plugin source, shared UI, and tests only. Personal OpenCode
configuration, authentication plugins, credentials, runtime state, and
`node_modules` are intentionally excluded.
