import { expect, test } from "bun:test"

// Exercise header clicks/storage with lightweight JSX nodes, without requiring
// an interactive OpenTUI renderer in the test process.
const source = await Bun.file(new URL("./sidebar-section.tsx", import.meta.url)).text()
const compiled = new Bun.Transpiler({ loader: "tsx" }).transformSync(source)
  .replace(/^import .*;$/gm, "")
  .replace("export function SidebarSection", "function SidebarSection")
  .replace(/jsxDEV_\w+/g, "element")
const Show = Symbol("Show")
const element = (tag: unknown, props: any) => tag === Show
  ? props.when ? props.children : undefined
  : { tag, ...props }
const component = new Function("usePlugin", "Show", "element", `${compiled}; return SidebarSection`)

function harness(initial = true) {
  const view = { open: initial }
  let writes = 0
  const context = {
    theme: { text: { base: "white", muted: "gray" } },
    storage: { store: (key: string, options: any) => {
      expect(key).toBe("sidebar-section")
      expect(options.initial).toEqual({ open: true })
      return [view, async (update: (draft: typeof view) => void) => { update(view); writes++ }]
    } },
    ui: { toast: { show() {} } },
  }
  const render = component(() => context, Show, element)
  return { render, view, writes: () => writes }
}

test("all sections use MCP triangles and whole-body collapse", () => {
  for (const title of ["Context", "Tasks", "Credits"]) {
    const app = harness()
    const summary = title === "Tasks" ? "5 total · 2 running · Expand · Ctrl+X F" : "summary"
    const props = { title, summary, children: "section-body" }
    const opened = app.render(props)
    expect(JSON.stringify(opened)).toContain("▼")
    expect(JSON.stringify(opened.children[1])).toContain('"paddingLeft":2')
    expect(JSON.stringify(opened.children[1])).toContain("section-body")
    opened.children[0].onMouseDown()
    expect(app.view.open).toBe(false)
    const closed = app.render(props)
    expect(JSON.stringify(closed)).toContain("▶")
    expect(JSON.stringify(closed)).toContain(` (${summary})`)
    expect(JSON.stringify(closed)).not.toContain("section-body")
    closed.children[0].onMouseDown()
    expect(app.view.open).toBe(true)
    expect(app.writes()).toBe(2)
  }
})

test("stored collapse survives remount; sections are independent", () => {
  const context = harness(false)
  const credits = harness()
  expect(JSON.stringify(context.render({ title: "Context", children: "body" }))).toContain("▶")
  expect(JSON.stringify(credits.render({ title: "Credits", children: "body" }))).toContain("▼")
})

test("expanded task panel stays open without changing sidebar preference", () => {
  const app = harness(false)
  const rendered = app.render({ title: "Tasks", collapsible: false, children: "panel-body" })
  expect(JSON.stringify(rendered)).toContain("panel-body")
  expect(JSON.stringify(rendered)).not.toContain("▶")
  rendered.children[0].onMouseDown()
  expect(app.view.open).toBe(false)
  expect(app.writes()).toBe(0)
})
