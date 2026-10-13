# Credits sidebar

Displays account allowances, not the cost of the current OpenCode session.

- **Copilot:** remaining included AI credits (or legacy premium requests), total allowance, and reset date. Uses the connected `github-copilot` account and GitHub's internal `/copilot_internal/user` endpoint. This is an unofficial API and may change; unknown formats are shown as unavailable rather than estimated.
- **Bedrock · company gateway:** remaining personal Lightspeed LLM budget (`max_budget - spend`) and reset date from `/v2/user/info`. This allowance is shared with other models/tools using the same gateway account, not a Bedrock-only prepaid balance. Other key/team caps may also constrain usage. A null budget means no personal cap, not free or unlimited service.

Bars show the fraction of each allowance **remaining**; exact balances and reset dates appear below them. Unknown/unlimited balances do not render misleading percentage bars.

Refreshes once per minute, including while collapsed. Click **Refresh** or run `/credits` to refresh immediately. Low remaining allowances (10% or less) are yellow. Reset dates use UTC.

Context, Tasks, and Credits share `../../ui/sidebar-section.tsx`: click the leading **▼/▶** or header to collapse/expand the whole body. Each section remembers its own preference across sessions and restarts and shows a compact summary while collapsed, matching the MCP header style. Tasks no longer auto-collapse the entire section when work finishes; nested finished branches still auto-collapse. The full-screen task panel always shows its contents.

Credentials are resolved/refreshed on the server using OpenCode's integration API. Only sanitized balances reach the UI; tokens and raw response bodies are never displayed or stored. Requests use fixed trusted origins, reject redirects, and time out after 15 seconds. No new login, API key, or CLI configuration is required.

Run tests with `bun test plugins/credits` from `~/.config/opencode`.
