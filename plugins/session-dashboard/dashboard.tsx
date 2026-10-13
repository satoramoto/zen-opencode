import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { For, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { SidebarSection } from "../../ui/sidebar-section"
import { compact, displayPath, elapsed, recentFiles, reportedContext, runDuration, visibleMessages, type Run } from "./metrics"

type Tab = ReturnType<Context["ui"]["tabs"]["list"]>[number]
type State = { runs: Record<string, Run>; errors: Record<string, boolean>; loaded: Record<string, boolean> }

function SessionCard(props: { tab: Tab; state: State; now: number }) {
  const context = usePlugin()
  const id = () => props.tab.sessionID
  const session = createMemo(() => context.data.session.get(id()))
  const family = createMemo(() => [...new Set([id(), ...context.data.session.family(id())])])
  const descendants = createMemo(() => family().filter((value) => value !== id()))
  const runningAgents = createMemo(() => descendants().filter((value) => context.data.session.status(value) === "running").length)
  const running = () => context.data.session.status(id()) === "running"
  const messages = createMemo(() => visibleMessages(context.data.session.message.list(id()) ?? [], session()?.revert?.messageID))
  const usage = createMemo(() => reportedContext(messages()))
  const capacity = createMemo(() => {
    const model = usage()?.model
    if (!model) return undefined
    return context.data.location.model.list(session()?.location)?.find((value) => value.providerID === model.providerID && value.id === model.id)?.limit.context || undefined
  })
  const duration = createMemo(() => runDuration(messages(), running(), props.now, props.state.runs[id()]))
  const files = createMemo(() => recentFiles(family().map((value) => visibleMessages(
    context.data.session.message.list(value) ?? [], context.data.session.get(value)?.revert?.messageID,
  ))))
  const status = () => {
    if (props.tab.attention) return "Needs attention"
    if (running() || runningAgents() > 0) return "Working"
    if (session()?.outcome === "failed") return "Failed"
    if (session()?.outcome === "interrupted") return "Stopped"
    return session()?.outcome === "succeeded" ? "Done" : "Idle"
  }
  const color = () => status() === "Working" ? "#facc15" : status() === "Failed" || props.tab.attention ? "#fb923c" : context.theme.text.muted
  const navigate = () => {
    if (!context.ui.tabs.focus(id())) context.ui.router.navigate({ type: "session", sessionID: id() })
  }
  const percent = () => capacity() ? Math.round((usage()!.used / capacity()!) * 100) : undefined
  const bar = () => {
    const filled = Math.min(6, Math.max(0, Math.round((percent() ?? 0) * 6 / 100)))
    return "▰".repeat(filled) + "▱".repeat(6 - filled)
  }
  const runLabel = () => duration() ? `${duration()!.approximate ? "~" : ""}${elapsed(duration()!.ms)}` : "—"
  const contextLabel = () => usage() ? `${bar()} ${percent() === undefined ? compact(usage()!.used) : `${percent()}%`}` : "Ctx —"
  const activityLabel = () => props.state.errors[id()] ? "⚠ refresh" : !props.state.loaded[id()] ? "…" : `${files().total} files`

  return (
    <box flexDirection="column" paddingTop={1} border={["bottom"]} borderColor={context.theme.text.muted}>
      <box onMouseDown={navigate} flexDirection="row" gap={1} minWidth={0}>
        <text fg={color()} flexShrink={0}>{props.tab.attention ? "◆" : running() || runningAgents() ? "●" : "○"}</text>
        <text fg={context.theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}><b>{session()?.title ?? props.tab.title ?? "Untitled session"}</b></text>
        <text fg={color()} wrapMode="none" flexShrink={0}>{running() ? runLabel() : status() === "Failed" ? "failed" : runLabel()}</text>
      </box>
      <box flexDirection="row" gap={1} minWidth={0}>
        <text fg={percent() !== undefined && percent()! >= 85 ? "#fb923c" : context.theme.text.muted} wrapMode="none" flexShrink={0}>{contextLabel()}</text>
        <text fg={context.theme.text.muted} wrapMode="none" flexShrink={0}>{`A${runningAgents()}/${descendants().length}`}</text>
        <text fg={props.state.errors[id()] ? "#fb923c" : context.theme.text.muted} wrapMode="none" truncate flexGrow={1} minWidth={0}>
          {files().paths.length ? displayPath(files().paths[0], session()?.location.directory ?? "") : activityLabel()}
        </text>
      </box>
    </box>
  )
}

export function Dashboard(props: { sessionID: string; state: State; hydrate: (ids: string[]) => void }) {
  const context = usePlugin()
  const tabs = createMemo(() => {
    const open = context.ui.tabs.list()
    if (open.length) return open
    const root = context.data.session.root(props.sessionID)
    return [{ sessionID: root, active: true, busy: context.data.session.status(root) === "running", attention: false }]
  })
  const busy = createMemo(() => tabs().some((tab) => tab.busy || context.data.session.family(tab.sessionID).some((id) => context.data.session.status(id) === "running")))
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!busy()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  createEffect(() => props.hydrate([...new Set(tabs().flatMap((tab) => [tab.sessionID, ...context.data.session.family(tab.sessionID)]))]))

  return (
    <SidebarSection title="Sessions" summary={`${tabs().length} open`}>
      <text fg={context.theme.text.muted}>Click a title to switch sessions</text>
      <For each={tabs()}>{(tab) => <SessionCard tab={tab} state={props.state} now={now()} />}</For>
    </SidebarSection>
  )
}

export default Plugin.define({
  id: "local.session-dashboard",
  setup(context) {
    const [state, update] = context.storage.memory<State>("dashboard", { initial: { runs: {}, errors: {}, loaded: {} } })
    const attempted = new Set<string>()
    const pending: string[] = []
    let active = 0
    let disposed = false
    const modelLoads = new Map<string, Promise<void>>()
    const hydrateModels = async (id: string) => {
      const location = context.data.session.get(id)?.location
      if (!location) return
      const key = JSON.stringify(location)
      let load = modelLoads.get(key)
      if (!load) {
        load = context.data.location.model.sync(location).catch((error) => { modelLoads.delete(key); throw error })
        modelLoads.set(key, load)
      }
      await load
    }
    const pump = () => {
      while (!disposed && active < 3 && pending.length) {
        const id = pending.shift()!
        active++
        Promise.all([context.data.session.sync(id), context.data.session.message.sync(id)])
          .then(() => hydrateModels(id))
          .then(() => { if (!disposed) update((draft) => { draft.loaded[id] = true; delete draft.errors[id] }) })
          .catch(() => { if (!disposed) update((draft) => { draft.errors[id] = true }) })
          .finally(() => { active--; pump() })
      }
    }
    const hydrate = (ids: string[]) => {
      for (const id of ids) if (!attempted.has(id)) { attempted.add(id); pending.push(id) }
      pump()
    }
    const stop = context.data.listen(({ details: event }) => {
      if (event.type === "session.execution.started") update((draft) => { draft.runs[event.data.sessionID] = { started: event.created } })
      if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
        update((draft) => {
          const run = draft.runs[event.data.sessionID]
          if (run && event.created >= run.started) run.ended = event.created
        })
      }
    })
    const sidebar = context.ui.slot({ prepend: "sidebar.content", render: (input) => <Dashboard sessionID={input.sessionID} state={state} hydrate={hydrate} /> })
    const commands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({ mode: "global", commands: [{
          id: "local.session-dashboard.refresh", title: "Refresh session dashboard", group: "Sessions", palette: true,
          slash: { name: "dashboard-refresh" },
          run: () => {
            const ids = [...attempted]
            attempted.clear()
            modelLoads.clear()
            hydrate(ids)
          },
        }] }))
        return null
      },
    })
    return () => { disposed = true; stop(); sidebar(); commands() }
  },
})
