import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { McpServer } from "@opencode/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { SidebarSection } from "../../ui/sidebar-section"
import { MCP_RESOURCE_COLUMN_WIDTH, MCP_TOOL_COLUMN_WIDTH, resourceCount, rightAlign, toolColumnValue } from "./metrics"

function McpOverview(props: { sessionID: string }) {
  const context = usePlugin()
  const session = createMemo(() => context.data.session.get(props.sessionID))
  const servers = createMemo(() => context.data.location.mcp.server.list(session()?.location) ?? [])
  const resources = createMemo(() => context.data.location.mcp.resource.list(session()?.location) ?? [])
  const messages = createMemo(() => context.data.session.message.list(props.sessionID) ?? [])
  const connected = createMemo(() => servers().filter((server) => server.status.status === "connected").length)
  const errors = createMemo(() => servers().filter((server) => server.status.status === "failed" || server.status.status === "needs_auth").length)
  const [loading, setLoading] = createSignal(false)
  const [loadError, setLoadError] = createSignal(false)
  let mounted = true
  onCleanup(() => { mounted = false })

  createEffect(() => {
    const location = session()?.location
    if (!location) return
    setLoading(true)
    setLoadError(false)
    Promise.all([
      context.data.location.mcp.server.sync(location),
      context.data.location.mcp.resource.sync(location),
      context.data.session.message.sync(props.sessionID),
    ]).catch(() => { if (mounted) setLoadError(true) }).finally(() => { if (mounted) setLoading(false) })
  })

  const countResources = (server: string) => resourceCount(resources(), server)
  const color = (status: McpServer["status"]["status"]) => {
    if (status === "connected") return context.theme.text.feedback.success.base
    if (status === "failed") return context.theme.text.feedback.error.base
    if (status === "needs_auth") return context.theme.text.feedback.warning.base
    return context.theme.text.muted
  }

  return (
    <SidebarSection title="MCP" summary={`${connected()}/${servers().length} on${errors() ? ` · ${errors()} err` : ""}`}>
      <Show when={loading()}><text fg={context.theme.text.muted}>Loading…</text></Show>
      <Show when={loadError()}><text fg={context.theme.text.feedback.warning.base}>Refresh failed · cached</text></Show>
      <Show when={servers().length > 0} fallback={<Show when={!loading()}><text fg={context.theme.text.muted}>No servers</text></Show>}>
        <box flexDirection="row" gap={1}>
          <text fg={context.theme.text.muted} wrapMode="none" flexGrow={1} minWidth={0}>Server</text>
          <text fg={context.theme.text.muted} wrapMode="none">{rightAlign("Tools", MCP_TOOL_COLUMN_WIDTH)}</text>
          <text fg={context.theme.text.muted} wrapMode="none">{rightAlign("Res", MCP_RESOURCE_COLUMN_WIDTH)}</text>
        </box>
        <For each={servers()}>{(server) => (
          <box flexDirection="row" gap={1} minWidth={0}>
            <text fg={color(server.status.status)} flexShrink={0}>●</text>
            <text fg={context.theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>{server.name}</text>
            <text fg={context.theme.text.muted} wrapMode="none">{rightAlign(toolColumnValue(messages(), server.name), MCP_TOOL_COLUMN_WIDTH)}</text>
            <text fg={context.theme.text.muted} wrapMode="none">{rightAlign(`${countResources(server.name)}r`, MCP_RESOURCE_COLUMN_WIDTH)}</text>
          </box>
        )}</For>
      </Show>
    </SidebarSection>
  )
}

export default Plugin.define({
  id: "local.mcp-overview",
  setup(context) {
    return context.ui.slot({
      before: "sidebar.content",
      render: (input) => <McpOverview sessionID={input.sessionID} />,
    })
  },
})
