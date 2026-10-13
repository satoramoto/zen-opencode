import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { For, createEffect, untrack } from "solid-js"
import { SidebarSection } from "../../ui/sidebar-section"
import { CAPACITY, CATEGORIES, COLUMNS, ROWS, append, emptyMosaic, eventChip, historyChips, seed, type Mosaic } from "./activity"

type State = { sessions: Record<string, Mosaic>; seen: string[]; hydrated: string[] }

// ASCII symbols stay in the terminal's monospace font, avoiding fallback glyph
// widths and optical offsets from emoji-like Unicode icons.
const ICONS = { read: "=", edit: "+", search: "/", shell: ">", think: "~", reply: "<", prompt: "^", web: "@", agent: "&", tool: "*", wait: "?", compact: ":", error: "!", done: "v" } as const

export default Plugin.define({
  id: "local.activity-mosaic",
  setup(context) {
    const [view, updateView] = context.storage.memory<{ mini: boolean }>("legend-view", { initial: { mini: false } })
    // Bound both the ring and the number of cached sessions. History can rebuild
    // a session after a restart; no message contents are stored by this plugin.
    const [state, update] = context.storage.memory<State>("mosaics", {
      initial: { sessions: {}, seen: [], hydrated: [] },
    })
    const ensure = (draft: State, id: string) => {
      if (!draft.sessions[id]) {
        if (Object.keys(draft.sessions).length >= 50) {
          const oldest = Object.keys(draft.sessions)[0]
          delete draft.sessions[oldest]
          draft.hydrated = draft.hydrated.filter((value) => value !== oldest)
        }
        draft.sessions[id] = emptyMosaic()
      }
      return draft.sessions[id]
    }
    const stop = context.data.listen(({ details }) => {
      const activity = eventChip(details)
      if (!activity || state.seen.includes(details.id)) return
      update((draft) => {
        draft.seen.push(details.id)
        if (draft.seen.length > 2000) draft.seen.splice(0, draft.seen.length - 2000)
        append(ensure(draft, activity.sessionID), activity.chip)
      })
    })
    const pending = new Set<string>()
    let disposed = false
    async function hydrate(sessionID: string) {
      if (state.hydrated.includes(sessionID) || pending.has(sessionID)) return
      pending.add(sessionID)
      try {
        await context.data.session.message.sync(sessionID)
        if (disposed) return
        const history = historyChips(context.data.session.message.list(sessionID))
        update((draft) => {
          const mosaic = ensure(draft, sessionID)
          draft.sessions[sessionID] = seed(mosaic, history)
          draft.hydrated.push(sessionID)
        })
      } catch {
        // Live activity still works if history isn't available yet.
      } finally { pending.delete(sessionID) }
    }
    function MosaicView(props: { sessionID: string }) {
      const ui = usePlugin()
      createEffect(() => {
        const sessionID = props.sessionID
        untrack(() => void hydrate(sessionID))
      })
      const mosaic = () => state.sessions[props.sessionID]
      const color = (index: number) => {
        const chip = mosaic()?.chips[index]
        return chip ? CATEGORIES.find((category) => category.key === chip.kind)!.color : ui.theme.text.muted
      }
      return (
        <SidebarSection title="Activity mosaic" summary={`${mosaic()?.total ?? 0} actions`}>
          <box height={ROWS} flexDirection="column">
            <For each={Array.from({ length: ROWS }, (_, row) => row)}>{(row) => (
              <text wrapMode="none">
                <For each={Array.from({ length: COLUMNS }, (_, col) => row * COLUMNS + col)}>{(index) => (
                  <span style={mosaic()?.chips[index] ? { fg: "#111111", bg: color(index) } : { fg: ui.theme.text.muted, bg: "transparent" }}>{mosaic()?.chips[index] ? ` ${ICONS[mosaic()!.chips[index].kind]} ` : "░░░"}</span>
                )}</For>
              </text>
            )}</For>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={ui.theme.text.muted}>{`${mosaic()?.total ?? 0} actions · last ${CAPACITY}`}</text>
            <box marginRight={2} onMouseDown={() => updateView((draft) => { draft.mini = !draft.mini })}>
              <text fg={ui.theme.text.muted} wrapMode="none">{view.mini ? "[full]" : "[mini]"}</text>
            </box>
          </box>
          <box flexDirection="column" marginTop={1}>
            <For each={view.mini ? [CATEGORIES] : Array.from({ length: Math.ceil(CATEGORIES.length / 4) }, (_, row) => CATEGORIES.slice(row * 4, row * 4 + 4))}>{(categories) => (
              <text wrapMode="none">
                <For each={categories}>{(category) => (
                  <span><span style={{ fg: category.color }}>{view.mini ? `${ICONS[category.key]} ` : "■ "}</span><span style={{ fg: ui.theme.text.muted }}>{view.mini ? "" : `${category.abbreviation.padEnd(5)} `}</span></span>
                )}</For>
              </text>
            )}</For>
          </box>
        </SidebarSection>
      )
    }
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <MosaicView sessionID={sessionID} />,
    })
    return () => { disposed = true; stop(); sidebar() }
  },
})
