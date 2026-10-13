import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { SessionInfo } from "@opencode/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { SidebarSection } from "../../ui/sidebar-section"

type Status = "running" | "failed" | "interrupted" | "done"
type Node = { session: SessionInfo; last: boolean[]; children: number; descendants: number; status: Status }

const panelName = "local.subagents.tree"

function SubagentTree(props: { sessionID: string; expanded?: boolean; onSelect?: () => void }) {
  const context = usePlugin()
  const [state, update] = context.storage.memory("subagents", {
    initial: { collapsed: {} as Record<string, boolean> },
  })

  const rootID = createMemo(() => context.data.session.root(props.sessionID))

  const tree = createMemo(() => {
    const root = rootID()
    const sessions = context.data.session
      .family(root)
      .map((id) => context.data.session.get(id))
      .filter((session): session is SessionInfo => session !== undefined)

    const children = new Map<string, SessionInfo[]>()
    for (const session of sessions) {
      if (!session.parentID) continue
      const list = children.get(session.parentID) ?? []
      list.push(session)
      children.set(session.parentID, list)
    }
    for (const list of children.values()) list.sort((a, b) => a.time.created - b.time.created)

    const own = (session: SessionInfo): Status => {
      if (context.data.session.status(session.id) === "running") return "running"
      if (session.outcome === "failed") return "failed"
      if (session.outcome === "interrupted") return "interrupted"
      return "done"
    }

    // A subtree is running if anything in it runs, otherwise failed if anything in it failed.
    const rank: Record<Status, number> = { done: 0, interrupted: 1, failed: 2, running: 3 }
    const summary = new Map<string, { status: Status; descendants: number }>()
    const summarize = (session: SessionInfo): { status: Status; descendants: number } => {
      let status = own(session)
      let descendants = 0
      for (const child of children.get(session.id) ?? []) {
        const result = summarize(child)
        descendants += result.descendants + 1
        if (rank[result.status] > rank[status]) status = result.status
      }
      const result = { status, descendants }
      summary.set(session.id, result)
      return result
    }
    const top = children.get(root) ?? []
    let overall: Status = "done"
    for (const session of top) {
      const result = summarize(session)
      if (rank[result.status] > rank[overall]) overall = result.status
    }

    const result: Node[] = []
    const walk = (parentID: string, last: boolean[]) => {
      const list = children.get(parentID) ?? []
      list.forEach((session, index) => {
        const trail = [...last, index === list.length - 1]
        const info = summary.get(session.id)!
        const node = {
          session,
          last: trail,
          children: children.get(session.id)?.length ?? 0,
          descendants: info.descendants,
          status: info.status,
        }
        result.push(node)
        if (!isCollapsed(session.id, node.status, node.children)) walk(session.id, trail)
      })
    }
    walk(root, [])

    const total = summary.size
    const running = [...summary.keys()].filter((id) => context.data.session.status(id) === "running").length
    return { nodes: result, total, running, overall }
  })

  const [filled, setFilled] = createSignal(true)
  const hasRunning = createMemo(() => tree().running > 0)
  createEffect(() => {
    if (!hasRunning()) {
      setFilled(true)
      return
    }
    const timer = setInterval(() => setFilled((value) => !value), 500)
    onCleanup(() => clearInterval(timer))
  })
  const dot = (status: Status) => status === "running" && !filled() ? "○" : "●"

  // Finished branches collapse automatically; a manual toggle overrides that.
  function isCollapsed(id: string, status: Status, children: number) {
    if (children === 0) return false
    return state.collapsed[id] ?? status !== "running"
  }

  const navigate = (sessionID: string) => {
    props.onSelect?.()
    context.ui.router.navigate({ type: "session", sessionID })
  }

  const toggle = (id: string, current: boolean) =>
    update((draft) => {
      draft.collapsed[id] = !current
    })

  const hue = (name: string, fallback: unknown) => {
    const palette = (context.theme.hue as Record<string, Record<string, unknown>> | undefined)?.[name]
    return (palette?.["300"] ?? fallback) as typeof context.theme.text.base
  }
  const color = (status: Status) => {
    if (status === "running") return "#facc15"
    if (status === "failed") return hue("red", context.theme.text.base)
    if (status === "interrupted") return context.theme.text.muted
    return hue("purple", context.theme.text.muted)
  }

  const prefix = (node: Node) =>
    node.last
      .map((isLast, index) => {
        if (index === node.last.length - 1) return isLast ? "└─ " : "├─ "
        return isLast ? "   " : "│  "
      })
      .join("")

  const label = (session: SessionInfo) => {
    const agent = session.agent ? `${session.agent}: ` : ""
    return `${agent}${session.title ?? "Untitled"}`
  }

  return (
    <box flexDirection="column">
      <SidebarSection
        title="Tasks"
        summary={`${tree().total} total${tree().running > 0 ? ` · ${tree().running} running` : ""}${!props.expanded ? " · Expand · Ctrl+X F" : ""}`}
        collapsible={!props.expanded}
      >
        <box
          flexDirection="row"
          onMouseDown={() => navigate(rootID())}
        >
          <text fg={rootID() === props.sessionID ? context.theme.text.base : context.theme.text.muted} wrapMode={props.expanded ? "word" : "none"}>
            {rootID() === props.sessionID ? "→ " : "  "}
            {context.data.session.get(rootID())?.title ?? "Main session"}
          </text>
        </box>
        <For each={tree().nodes}>
          {(node) => {
            const current = () => node.session.id === props.sessionID
            const collapsed = () => isCollapsed(node.session.id, node.status, node.children)
            return (
              <box flexDirection="row">
                <text fg={context.theme.text.muted} wrapMode="none" flexShrink={0}>
                  {(current() ? "→ " : "  ") + prefix(node)}
                </text>
                <Show when={node.children > 0}>
                  <box onMouseDown={() => toggle(node.session.id, collapsed())}>
                    <text fg={color(node.status)} wrapMode="none">
                      {collapsed() ? "▸ " : "▾ "}
                    </text>
                  </box>
                </Show>
                <box
                  flexDirection="row"
                  flexGrow={props.expanded ? 1 : undefined}
                  minWidth={props.expanded ? 0 : undefined}
                  onMouseDown={() => navigate(node.session.id)}
                >
                  <text fg={color(node.status)} wrapMode={props.expanded ? "word" : "none"} flexShrink={props.expanded ? 1 : undefined}>
                    {current() ? (
                      <b>{`${dot(node.status)} ${label(node.session)}`}</b>
                    ) : (
                      `${dot(node.status)} ${label(node.session)}`
                    )}
                    {collapsed() ? ` (+${node.descendants})` : ""}
                  </text>
                </box>
              </box>
            )
          }}
        </For>
      </SidebarSection>
    </box>
  )
}

function SubagentPanel(props: { panel: PanelInput }) {
  const context = usePlugin()
  context.keymap.layer(() => ({
    commands: [
      { id: "local.subagents.fullscreen", title: "Toggle tasks full screen", bind: "f", run: props.panel.toggleFullscreen },
      { id: "local.subagents.close", title: "Close tasks", bind: "escape", run: props.panel.close },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={context.theme.text.base}><b>Tasks</b></text>
        <box onMouseDown={props.panel.toggleFullscreen}>
          <text fg={context.theme.text.muted}>
            {props.panel.presentation === "fullscreen" ? "[Side view · f]" : "[Full screen · f]"}
          </text>
        </box>
        <box onMouseDown={props.panel.close}>
          <text fg={context.theme.text.muted}>[Close · Esc]</text>
        </box>
      </box>
      <scrollbox flexGrow={1} minHeight={0}>
        <SubagentTree sessionID={props.panel.sessionID} expanded onSelect={props.panel.close} />
        <Show when={context.data.session.family(context.data.session.root(props.panel.sessionID)).length <= 1}>
          <text fg={context.theme.text.muted}>No tasks in this session family.</text>
        </Show>
      </scrollbox>
    </box>
  )
}

export default Plugin.define({
  id: "local.subagents",
  setup(context) {
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => <SubagentTree sessionID={input.sessionID} />,
    })
    const panel = context.ui.slot({
      append: "session.panel",
      render: (input) => (
        <Show when={input.name === panelName}>
          <SubagentPanel panel={input} />
        </Show>
      ),
    })
    const commands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "local.subagents.expand",
            title: "Expand tasks tree",
            group: "Tasks",
            bind: "<leader>f",
            palette: true,
            slash: { name: "tasks", aliases: ["subagents"] },
            enabled: () => context.ui.router.current().type === "session",
            run: () => {
              if (context.ui.panel.current()?.name === panelName) context.ui.panel.close()
              else context.ui.panel.open(panelName, { presentation: "fullscreen" })
            },
          }],
        }))
        return null
      },
    })
    return () => {
      sidebar()
      panel()
      commands()
    }
  },
})
