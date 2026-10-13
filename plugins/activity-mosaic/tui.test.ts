import { expect, test } from "bun:test"
import * as activity from "./activity"

const source = await Bun.file(new URL("./tui.tsx", import.meta.url)).text()
const compiled = new Bun.Transpiler({ loader: "tsx" }).transformSync(source
  .replace(/^import .*$/gm, "")
  .replace("export default Plugin.define", "const plugin = Plugin.define"))
  .replace(/jsxDEV_\w+/g, "element")
const element = (tag: any, props: any) => typeof tag === "function" ? tag(props) : { tag, ...props }
const make = new Function("Plugin", "usePlugin", "For", "createEffect", "untrack", "SidebarSection", "element", ...Object.keys(activity), `${compiled}; return plugin`)

function harness() {
  let listener: (event: any) => void = () => {}
  let renderSlot: (input: any) => any = () => {}
  let stopped = false
  let removed = false
  let syncs = 0
  const state = { sessions: {}, seen: [], hydrated: [] }
  const view = { mini: false }
  const context = {
    storage: { memory: (key: string) => {
      const value = key === "legend-view" ? view : state
      return [value, (fn: any) => fn(value)]
    } },
    data: {
      listen: (fn: any) => { listener = fn; return () => { stopped = true } },
      session: { message: {
        sync: async () => { syncs++ },
        list: () => [{ type: "user", id: "prompt", time: { created: 1 }, text: "Hello" }],
      } },
    },
    theme: { text: { muted: "gray" } },
    ui: { slot: (input: any) => { renderSlot = input.render; return () => { removed = true } } },
  }
  const plugin = make({ define: (value: any) => value }, () => context,
    (props: any) => props.each.map(props.children), (fn: any) => fn(), (fn: any) => fn(),
    (props: any) => ({ tag: "section", ...props }), element, ...Object.values(activity))
  const cleanup = plugin.setup(context)
  return {
    render: (sessionID = "s") => renderSlot({ sessionID }),
    emit: (id: string, sessionID = "s") => listener({ details: {
      type: "session.tool.input.started", id, created: 2,
      data: { sessionID, id, name: "read" },
    } }),
    state, cleanup, stopped: () => stopped, removed: () => removed, syncs: () => syncs,
  }
}

function nodes(value: any, tag: string): any[] {
  if (!value || typeof value !== "object") return []
  if (Array.isArray(value)) return value.flatMap((child) => nodes(child, tag))
  return [...(value.tag === tag ? [value] : []), ...nodes(value.children, tag)]
}

test("sidebar renders a fixed grid, legend, live colors, and separate sessions", async () => {
  const app = harness()
  try {
    const initial = app.render()
    expect(nodes(initial, "span").filter((span) => span.children === "░░░")).toHaveLength(activity.CAPACITY)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    app.emit("read-1")
    app.emit("read-1") // duplicate delivery is ignored
    const tree = app.render()
    expect(tree.summary).toBe("2 actions")
    expect(nodes(tree, "span").filter((span) => span.children === " ^ " || span.children === " = ")).toHaveLength(2)
    expect(nodes(tree, "span").filter((span) => span.children === "■ ")).toHaveLength(activity.CATEGORIES.length)
    expect(nodes(tree, "span").some((span) => span.style?.bg === "#60a5fa" && span.style.fg === "#111111" && span.children === " = ")).toBe(true)
    expect(nodes(tree, "span").some((span) => span.style?.bg === "#facc15" && span.children === " ^ ")).toBe(true)
    expect(nodes(initial, "span").filter((span) => span.children === "░░░").every((span) => span.style.bg === "transparent")).toBe(true)
    expect(nodes(tree, "box").some((box) => box.flexWrap === "wrap")).toBe(false)
    const legendRows = nodes(tree, "text").filter((row) => nodes(row, "span").some((span) => span.children === "■ "))
    expect(legendRows.map((row) => nodes(row, "span").filter((span) => span.children === "■ ").length)).toEqual([4, 4, 4, 2])
    const labels = legendRows.flatMap((row) => nodes(row, "span").filter((span) => span.style?.fg === "gray").map((span) => span.children))
    expect(labels).toEqual(["Read  ", "Edit  ", "Srch  ", "Shell ", "Think ", "Reply ", "You   ", "Web   ", "Agent ", "Tool  ", "Ask   ", "Cmpct ", "Error ", "Done  "])
    expect(labels.every((label) => label.length === 6)).toBe(true)
    expect(nodes(tree, "box").some((box) => box.height === activity.ROWS)).toBe(true)
    app.emit("other-read", "other")
    expect(app.render().summary).toBe("2 actions")
    expect(app.syncs()).toBe(1)
  } finally { app.cleanup() }
  expect(app.stopped()).toBe(true)
  expect(app.removed()).toBe(true)
})

test("events keep collecting while the sidebar is unmounted", () => {
  const app = harness()
  try {
    for (let i = 0; i < 500; i++) app.emit(String(i))
    expect(app.render().summary).toBe("500 actions")
    expect(nodes(app.render(), "span").filter((span) => span.children === " = ")).toHaveLength(activity.CAPACITY)
  } finally { app.cleanup() }
})

test("mini toggle replaces the label grid with colored icons and restores full mode", () => {
  const app = harness()
  try {
    app.emit("read")
    const toggle = (tree: any) => nodes(tree, "box").find((box) => box.onMouseDown).onMouseDown()
    toggle(app.render())
    const mini = app.render()
    const icons = nodes(mini, "text").find((row) => nodes(row, "span").some((span) => span.children === "v "))
    expect(nodes(icons, "span").filter((span) => span.style && span.style.fg !== "gray").map((span) => span.style.fg)).toEqual(activity.CATEGORIES.map((category) => category.color))
    expect(nodes(mini, "span").some((span) => span.children === "Read  ")).toBe(false)
    expect(nodes(mini, "text").some((row) => row.children === "[full]")).toBe(true)
    expect(nodes(mini, "span").filter((span) => span.children === " = ")).toHaveLength(1)
    const symbols = nodes(icons, "span").filter((span) => span.style && span.style.fg !== "gray").map((span) => span.children)
    expect(symbols.every((symbol) => /^[\x21-\x7e] $/.test(symbol))).toBe(true)
    expect(nodes(app.render("other"), "text").some((row) => row.children === "[full]")).toBe(true)
    toggle(app.render())
    expect(nodes(app.render(), "span").some((span) => span.children === "Read  ")).toBe(true)
    expect(nodes(app.render(), "text").some((row) => row.children === "[mini]")).toBe(true)
  } finally { app.cleanup() }
})
