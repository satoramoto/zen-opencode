import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { SessionMessageInfo } from "@opencode/client"
import { For, Show, createMemo } from "solid-js"
import { SidebarSection } from "../../ui/sidebar-section"

const BAR_WIDTH = 36
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

type Key = "system" | "user" | "assistant" | "tools" | "mcp" | "skills" | "summary"
const CATEGORIES: { key: Key; label: string; hue: string }[] = [
  { key: "system", label: "System & tools", hue: "blue" },
  { key: "summary", label: "Compacted summary", hue: "gray" },
  { key: "user", label: "User prompts", hue: "green" },
  { key: "assistant", label: "Assistant", hue: "purple" },
  { key: "tools", label: "Tool calls", hue: "orange" },
  { key: "mcp", label: "MCP", hue: "cyan" },
  { key: "skills", label: "Skills", hue: "yellow" },
]

// Rough chars-per-token heuristic; only used to split the real total proportionally.
const estimate = (value: unknown) => {
  if (value === undefined || value === null) return 0
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return Math.ceil(text.length / 4)
}

const compact = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function ContextBar(props: { sessionID: string }) {
  const context = usePlugin()

  const session = createMemo(() => context.data.session.get(props.sessionID))
  const cost = createMemo(() => context.data.session.cost(props.sessionID))

  const breakdown = createMemo(() => {
    let messages = context.data.session.message.list(props.sessionID) ?? []
    const revert = session()?.revert?.messageID
    if (revert) {
      const index = messages.findIndex((message) => message.id === revert)
      if (index >= 0) messages = messages.slice(0, index)
    }

    // Only messages since the last completed compaction are still in context.
    const compactionIndex = messages.findLastIndex((m) => m.type === "compaction" && m.status === "completed")
    const live = compactionIndex >= 0 ? messages.slice(compactionIndex) : messages

    const assistants = live.filter(
      (m): m is Extract<SessionMessageInfo, { type: "assistant" }> => m.type === "assistant" && !!m.tokens,
    )
    const last = assistants.at(-1)
    if (!last?.tokens) return undefined
    const t = last.tokens
    const total = t.input + t.output + t.reasoning + t.cache.read + t.cache.write

    const servers = (context.data.location.mcp.server.list(session()?.location) ?? []).map((s) => s.name)
    const isMcp = (name: string) => name === "execute" || servers.some((s) => name.startsWith(`${s}_`) || name.startsWith(`${s}.`))

    const est: Record<Key, number> = { system: 0, user: 0, assistant: 0, tools: 0, mcp: 0, skills: 0, summary: 0 }
    let firstUser = 0
    for (const message of live) {
      switch (message.type) {
        case "user":
          est.user += estimate(message.text)
          if (!firstUser) firstUser = est.user
          break
        case "system":
        case "synthetic":
          est.system += estimate(message.text)
          break
        case "skill":
          est.skills += estimate(message.text)
          break
        case "shell":
          est.tools += estimate(message.command) + estimate(message.output?.output)
          break
        case "compaction":
          if (message.status === "completed") est.summary += estimate(message.summary) + estimate(message.recent)
          break
        case "assistant":
          for (const part of message.content) {
            if (part.type !== "tool") {
              est.assistant += estimate(part.text)
              continue
            }
            const state = part.state as { input?: unknown; content?: { type: string; text?: string }[]; error?: { message: string } }
            const size =
              estimate(state.input) +
              (state.content ?? []).reduce((sum, c) => sum + estimate(c.text ?? ""), 0) +
              estimate(state.error?.message)
            if (part.name === "skill") est.skills += size
            else if (isMcp(part.name)) est.mcp += size
            else est.tools += size
          }
          break
      }
    }

    // The first response's prompt is roughly system prompt + tool definitions + the first user message.
    const first = assistants[0]?.tokens
    const firstPrompt = first ? first.input + first.cache.read + first.cache.write : 0
    const overhead = Math.max(0, Math.min(total, firstPrompt - firstUser))

    const conversation = Math.max(0, total - overhead)
    const estimated = (Object.keys(est) as Key[]).reduce((sum, key) => sum + est[key], 0)
    const scale = estimated > 0 ? conversation / estimated : 0
    const values = Object.fromEntries((Object.keys(est) as Key[]).map((key) => [key, Math.round(est[key] * scale)])) as Record<
      Key,
      number
    >
    values.system += overhead

    const model = context.data.location.model
      .list(session()?.location)
      ?.find((m) => m.providerID === last.model.providerID && m.id === last.model.id)
    const limit = model?.limit.context || undefined

    return { total, limit, values }
  })

  const hue = (name: string) => {
    const palette = (context.theme.hue as Record<string, Record<string, unknown>> | undefined)?.[name]
    return (palette?.["300"] ?? context.theme.text.muted) as typeof context.theme.text.base
  }

  const segments = createMemo(() => {
    const data = breakdown()
    if (!data) return []
    const capacity = Math.max(data.limit ?? data.total, data.total)
    const exact = CATEGORIES.map((c) => ({ ...c, value: data.values[c.key], cells: (data.values[c.key] / capacity) * BAR_WIDTH }))
    // Largest-remainder rounding, with at least one cell for any non-empty slice.
    const cells = exact.map((s) => (s.value > 0 ? Math.max(1, Math.floor(s.cells)) : 0))
    const used = Math.min(BAR_WIDTH, Math.round((data.total / capacity) * BAR_WIDTH))
    let remaining = used - cells.reduce((a, b) => a + b, 0)
    const order = exact.map((s, i) => ({ i, frac: s.cells - Math.floor(s.cells) })).sort((a, b) => b.frac - a.frac)
    for (const { i } of order) {
      if (remaining <= 0) break
      if (exact[i].value > 0) {
        cells[i]++
        remaining--
      }
    }
    while (remaining < 0) {
      const i = cells.indexOf(Math.max(...cells))
      cells[i]--
      remaining++
    }
    return exact.map((s, i) => ({ ...s, cells: cells[i] }))
  })

  const free = () => Math.max(0, BAR_WIDTH - segments().reduce((sum, s) => sum + s.cells, 0))

  return (
    <Show when={breakdown() || cost() > 0}>
      <SidebarSection title="Context" summary={breakdown() ? `${compact(breakdown()!.total)} tokens` : `${usd.format(cost())} spent`}>
        <Show when={breakdown()}>
          {(data) => (
            <>
              <text wrapMode="none">
                <For each={segments()}>{(s) => <span style={{ fg: hue(s.hue) }}>{"█".repeat(s.cells)}</span>}</For>
                <span style={{ fg: context.theme.text.muted }}>{"░".repeat(free())}</span>
              </text>
              <text fg={context.theme.text.muted} wrapMode="none">
                {data().total.toLocaleString()}
                {data().limit ? ` / ${compact(data().limit!)} (${Math.round((data().total / data().limit!) * 100)}%)` : " tokens"}
                {cost() > 0 ? ` · ${usd.format(cost())}` : ""}
              </text>
              <For each={segments().filter((s) => s.value > 0)}>
                {(s) => (
                  <box flexDirection="row" justifyContent="space-between" paddingRight={1}>
                    <text wrapMode="none">
                      <span style={{ fg: hue(s.hue) }}>■ </span>
                      <span style={{ fg: context.theme.text.base }}>{s.label}</span>
                    </text>
                    <text fg={context.theme.text.muted} wrapMode="none">
                      {`${compact(s.value)} ${String(Math.round((s.value / data().total) * 100)).padStart(3)}%`}
                    </text>
                  </box>
                )}
              </For>
            </>
          )}
        </Show>
        <Show when={!breakdown() && cost() > 0}>
          <text fg={context.theme.text.muted}>{`${usd.format(cost())} spent`}</text>
        </Show>
      </SidebarSection>
    </Show>
  )
}

export default Plugin.define({
  id: "local.context-bar",
  setup(context) {
    return context.ui.slot({
      prepend: "sidebar.content",
      render: (input) => <ContextBar sessionID={input.sessionID} />,
    })
  },
})
