import { expect, test } from "bun:test"
import * as metrics from "./metrics"

// Execute actual component/registration code with lightweight JSX and context
// fixtures. This checks behavior, not native terminal layout.
const source = await Bun.file(new URL("./dashboard.tsx", import.meta.url)).text()
// Bun's React-style JSX transform evaluates hidden Show children eagerly,
// unlike the host's Solid transform. Give those hidden expressions safe inputs.
const compiled = new Bun.Transpiler({ loader: "tsx" }).transformSync(source
  .replaceAll("usage()!.used", "(usage()?.used ?? 0)")
  .replaceAll("duration()!.approximate", "duration()?.approximate")
  .replaceAll("duration()!.ms", "(duration()?.ms ?? 0)"))
  .replace(/^import .*;$/gm, "")
  .replace("export function Dashboard", "function Dashboard")
  .replace("export default Plugin.define", "const plugin = Plugin.define")
  .replace(/jsxDEV_\w+/g, "element")
const cleanups: Array<() => void> = []
const element = (tag: any, props: any) => typeof tag === "function" ? tag(props) : { tag, ...props }
const make = new Function("usePlugin", "Plugin", "For", "Show", "createEffect", "createMemo", "createSignal", "onCleanup", "SidebarSection", "element", ...Object.keys(metrics), `${compiled}; return { Dashboard, SessionCard, plugin }`)

function harness() {
  const now = Date.now()
  const sessions: Record<string, any> = {
    root: { title: "Main task", location: { directory: "/repo" }, time: { created: now - 100000 } },
    child: { title: "Child", parentID: "root" },
    nested: { title: "Nested", parentID: "child" },
    other: { title: "Other task", outcome: "failed", location: { directory: "/other" } },
  }
  const tabs = [
    { sessionID: "root", title: "Main", active: true, busy: true, attention: false },
    { sessionID: "other", active: false, busy: false, attention: false },
  ]
  const messages: Record<string, any[]> = {
    root: [{ id: "m", type: "assistant", time: { created: now - 5000 }, model: { id: "model", providerID: "provider" }, tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } }, snapshot: { files: ["/repo/edit.ts"] } }],
  }
  const state = { runs: { root: { started: now - 5000 } }, errors: {}, loaded: { root: true, other: true } }
  const slots: any[] = []
  const focused: string[] = []
  let listener: any
  let unsubscribed = false
  const synced: string[] = []
  const modelsSynced: string[] = []
  const context = {
    theme: { text: { base: "white", muted: "gray" } },
    storage: { memory: () => [state, (fn: any) => fn(state)] },
    keymap: { layer: (fn: any) => fn() },
    data: {
      listen: (fn: any) => { listener = fn; return () => { unsubscribed = true } },
      session: {
        get: (id: string) => sessions[id], root: () => "root", family: (id: string) => id === "root" ? ["root", "child", "nested"] : [id],
        status: (id: string) => id === "root" || id === "nested" ? "running" : "idle",
        sync: async (id: string) => { synced.push(id) },
        message: { list: (id: string) => messages[id] ?? [], sync: async () => {} },
      },
      location: { model: { list: () => [{ id: "model", providerID: "provider", limit: { context: 1000 } }], sync: async (location: any) => { modelsSynced.push(location.directory) } } },
    },
    ui: { tabs: { list: () => tabs, focus: (id: string) => { focused.push(id); return true } },
      router: { navigate: () => {} }, slot: (slot: any) => { slots.push(slot); return () => {} } },
  }
  const api = make(() => context, { define: (x: any) => x },
    (p: any) => p.each.map(p.children), (p: any) => p.when ? p.children : p.fallback,
    (fn: any) => fn(), (fn: any) => fn, (value: any) => [() => value, (next: any) => { value = next }],
    (fn: any) => cleanups.push(fn), (p: any) => ({ section: p.title, children: p.children }), element, ...Object.values(metrics))
  return { api, context, state, tabs, slots, focused, synced, modelsSynced, event: (event: any) => listener({ details: event }), stopped: () => unsubscribed }
}

function renderedText(value: any): string {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) return value.map(renderedText).join("")
  if (typeof value === "object") return renderedText(value.children)
  return String(value)
}

test("dashboard shows each open session, descendants, last-reported context and recent edits", () => {
  const app = harness()
  let hydrated: string[] = []
  const view = app.api.Dashboard({ sessionID: "root", state: app.state, hydrate: (ids: string[]) => { hydrated = ids } })
  const text = renderedText(view)
  for (const value of ["Main task", "Other task", "failed", "A1/2", "edit.ts", "11%", "0 files"]) expect(text).toContain(value)
  expect(hydrated).toEqual(["root", "child", "nested", "other"])
  const card = app.api.SessionCard({ tab: app.tabs[1], state: app.state, now: Date.now() })
  card.children[0].onMouseDown()
  expect(app.focused).toEqual(["other"])
  for (const cleanup of cleanups.splice(0)) cleanup()
})

test("disabled native tabs falls back to current family; plugin events and cleanup work", async () => {
  const app = harness()
  app.tabs.length = 0
  const stop = app.api.plugin.setup(app.context)
  app.slots[0].render({ sessionID: "root" })
  await Promise.resolve()
  await Promise.resolve()
  expect(app.synced.sort()).toEqual(["child", "nested", "root"])
  expect(app.modelsSynced).toEqual(["/repo"])
  app.event({ type: "session.execution.started", created: 100, data: { sessionID: "root" } })
  app.event({ type: "session.execution.failed", created: 200, data: { sessionID: "root" } })
  expect(app.state.runs.root).toEqual({ started: 100, ended: 200 })
  stop()
  expect(app.stopped()).toBe(true)
  for (const cleanup of cleanups.splice(0)) cleanup()
})
