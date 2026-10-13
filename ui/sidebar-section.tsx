import { usePlugin } from "@opencode/plugin/tui"
import { Show, type JSX } from "solid-js"

// Matches the built-in MCP section: leading triangle, bold title, collapsed
// summary, whole-header toggle, and a durable preference shared across sessions.
export function SidebarSection(props: {
  title: string
  summary?: string
  collapsible?: boolean
  children: JSX.Element
}) {
  const context = usePlugin()
  const [view, update] = context.storage.store("sidebar-section", { initial: { open: true } })
  const open = () => props.collapsible === false || view.open
  const toggle = () => {
    if (props.collapsible === false) return
    void update((draft) => { draft.open = !draft.open }).catch(() => {
      context.ui.toast.show({ message: `Could not save ${props.title} sidebar state`, variant: "error" })
    })
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} onMouseDown={toggle}>
        <text fg={context.theme.text.base} flexShrink={0} width={1}>
          {props.collapsible === false ? " " : open() ? "▼" : "▶"}
        </text>
        <text fg={context.theme.text.base}>
          <b>{props.title}</b>
          <Show when={!open() && props.summary}>
            <span style={{ fg: context.theme.text.muted }}>{` (${props.summary})`}</span>
          </Show>
        </text>
      </box>
      <Show when={open()}>
        <box paddingLeft={2}>{props.children}</box>
      </Show>
    </box>
  )
}
