import { expect, test } from "bun:test"

// Run the component with tracked signals and lightweight JSX, without needing
// an interactive terminal. Keep the render function so async state can be read.
const source = await Bun.file(new URL("./github.tsx", import.meta.url)).text()
const compiled = new Bun.Transpiler({ loader: "tsx" }).transformSync(source
  .replace("return (\n    <SidebarSection", "return () => (\n    <SidebarSection"))
  .replace(/^import .*;$/gm, "")
  .replace("export default Plugin.define", "const plugin = Plugin.define")
  .replace(/Fragment_\w+/g, '"fragment"')
  .replace(/jsxDEV_\w+/g, "element")
const element = (tag: any, props: any) => typeof tag === "function" ? tag(props) : { tag, ...props }
const make = new Function("usePlugin", "Plugin", "promisify", "execFile", "For", "Show", "createEffect", "createSignal", "onCleanup", "untrack", "SidebarSection", "element", `${compiled}; return GitHub`)

function harness(options: {
  repository?: string
  branch?: string
  primary?: any[]
  paired?: any[]
  gitError?: string
  repoError?: string
  primaryError?: string
  pairedError?: string
} = {}) {
  let tracking = false
  let trackedRuns = 0
  const subscribers = new Set<() => void>()
  const signals: Array<(value: any) => void> = []
  const cleanups: Array<() => void> = []
  const requests: any[] = []
  const pr = { number: 42, title: "Fix sidebar", url: "https://github.com/example/repo/pull/42", headRepositoryOwner: { login: "example" }, headRepository: { name: "repo" }, statusCheckRollup: [{ name: "test", conclusion: "SUCCESS" }] }
  const context = {
    data: { session: { get: () => ({ location: { directory: "/repo" } }) } },
    theme: { text: { base: "white", muted: "gray", feedback: { warning: { base: "yellow" }, success: { base: "green" }, error: { base: "red" } } } },
  }
  const component = make(() => context, { define: (value: any) => value }, () => async (command: string, args: string[]) => {
    requests.push({ command, args })
    const kind = command === "git" ? "git" : args[0] === "repo" ? "repo" : args.includes("--repo") ? "paired" : "primary"
    const stderr = options[`${kind}Error`]
    if (stderr) throw { stderr }
    return { stdout: kind === "git" ? options.branch ?? "feature\n"
      : kind === "repo" ? options.repository ?? "example/repo\n"
      : JSON.stringify(kind === "paired" ? options.paired ?? [] : options.primary ?? [pr]) }
  }, undefined, (props: any) => props.each.map(props.children), (props: any) => props.when
     ? typeof props.children === "function" ? props.children(props.keyed ? props.when : () => props.when) : props.children
    : props.fallback,
  (fn: () => void) => {
    const run = () => { trackedRuns++; tracking = true; try { fn() } finally { tracking = false } }
    subscribers.add(run)
    run()
  }, (value: any) => {
    const dependencies = new Set<() => void>()
    const set = (next: any) => {
      if (value === next) return
      value = next
      for (const fn of dependencies) fn()
    }
    signals.push(set)
    return [() => { if (tracking) for (const fn of subscribers) dependencies.add(fn); return value }, set]
  }, (fn: () => void) => cleanups.push(fn), (fn: () => void) => {
    const previous = tracking
    tracking = false
    try { return fn() } finally { tracking = previous }
  }, (props: any) => ({ ...props }), element)
  const render = component({ sessionID: "session", refreshVersion: 0, onRefresh() {} })
  return { render, requests, signals, runs: () => trackedRuns, cleanup: () => cleanups.forEach((fn) => fn()) }
}

function text(value: any): string {
  if (value == null) return ""
  if (Array.isArray(value)) return value.map(text).join(" ")
  if (typeof value === "object") return text(value.children)
  return String(value)
}

test("finishing a refresh does not subscribe the effect to loading and start another refresh", async () => {
  const app = harness()
  try {
    // Drain both exec awaits and the refresh's finally block.
    await drain()
    expect(app.requests.map((request) => request.command)).toEqual(["git", "gh", "gh"])
    expect(app.runs()).toBe(1)
    expect(app.render().summary).toBe("#42")
    expect(text(app.render())).toContain("#42")
    expect(text(app.render())).toContain("Fix sidebar")
    expect(text(app.render())).not.toContain("example/repo")
    expect(text(app.render())).not.toContain("/github-refresh")
    expect(text(app.render())).toContain("↻ refresh")
  } finally { app.cleanup() }
})

async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function links(value: any): any[] {
  if (value == null || typeof value !== "object") return []
  if (Array.isArray(value)) return value.flatMap(links)
  return [...(value.tag === "a" ? [value] : []), ...links(value.children)]
}

test("primary and paired PR numbers and titles link to their GitHub URLs", async () => {
  const url = "https://github.com/chronogolf/golf-e2e/pull/10"
  const app = harness({ repository: "chronogolf/chronogolf", paired: [{ number: 10, title: "Test sidebar", url }] })
  try {
    await drain()
    expect(links(app.render()).map((link) => ({ href: link.href, label: text(link) }))).toEqual([
      { href: "https://github.com/example/repo/pull/42", label: "#42" },
      { href: "https://github.com/example/repo/pull/42", label: "Fix sidebar" },
      { href: url, label: "E2E #10" },
      { href: url, label: "Test sidebar" },
    ])
  } finally { app.cleanup() }
})

test("chronogolf shows every paired e2e PR with CI and an exact branch query", async () => {
  const app = harness({ repository: "chronogolf/chronogolf", branch: "feature/same-name", paired: [
    { number: 10, statusCheckRollup: [{ name: "test", conclusion: "FAILURE" }] },
    { number: 11, statusCheckRollup: [{ name: "test", state: "PENDING" }] },
  ] })
  try {
    await drain()
    expect(app.render().summary).toBe("#42 · 2 e2e")
    expect(text(app.render())).toContain("E2E #10 Pull request ●")
    expect(text(app.render())).toContain("E2E #11 Pull request ●")
    expect(app.requests.at(-1).args).toEqual([
      "pr", "list", "--repo", "chronogolf/golf-e2e", "--head", "feature/same-name",
      "--state", "all", "--limit", "1000", "--json", "number,title,url,headRepository,headRepositoryOwner,statusCheckRollup",
    ])
  } finally { app.cleanup() }
})

test("other repositories do not request paired PRs", async () => {
  const app = harness({ repository: "other/chronogolf" })
  try {
    await drain()
    expect(app.requests).toHaveLength(3)
    expect(text(app.render())).not.toContain("E2E")
  } finally { app.cleanup() }
})

for (const options of [
  { gitError: "fatal: not a git repository (or any of the parent directories): .git" },
  { repoError: "no git remotes found" },
  { repoError: "none of the git remotes configured for this repository point to a known GitHub host" },
  { repoError: "GraphQL: Could not resolve to a Repository with the name 'example/missing'." },
  { repository: "" },
]) {
  test(`missing repository is a quiet empty state: ${JSON.stringify(options)}`, async () => {
    const app = harness(options)
    try {
      await drain()
      expect(app.render().summary).toBe("No repo")
      expect(text(app.render())).toContain("No GitHub repository")
      expect(text(app.render())).not.toContain("Could not load")
    } finally { app.cleanup() }
  })
}

test("no primary or paired results is not an error", async () => {
  const app = harness({ repository: "chronogolf/chronogolf", primary: [], paired: [] })
  try {
    await drain()
    expect(app.render().summary).toBe("No PR")
    expect(text(app.render())).toContain("No pull request for this branch")
    expect(text(app.render())).not.toContain("Could not load")
  } finally { app.cleanup() }
})

test("paired PRs are shown even without a primary PR", async () => {
  const app = harness({ repository: "chronogolf/chronogolf", primary: [], paired: [{ number: 10 }] })
  try {
    await drain()
    expect(app.render().summary).toBe("1 e2e")
    expect(text(app.render())).toContain("E2E #10")
  } finally { app.cleanup() }
})

test("e2e lookup failures do not hide the primary PR", async () => {
  const app = harness({ repository: "chronogolf/chronogolf", pairedError: "HTTP 500" })
  try {
    await drain()
    expect(text(app.render())).toContain("#42")
    expect(text(app.render())).toContain("Could not load paired e2e PRs")
  } finally { app.cleanup() }
})

test("real lookup failures still show a warning", async () => {
  const app = harness({ primaryError: "HTTP 401: Bad credentials" })
  try {
    await drain()
    expect(text(app.render())).toContain("Could not load GitHub status")
  } finally { app.cleanup() }
})

test("detached HEAD skips GitHub lookups without an error", async () => {
  const app = harness({ branch: "" })
  try {
    await drain()
    expect(app.requests).toHaveLength(1)
    expect(text(app.render())).not.toContain("Could not load")
  } finally { app.cleanup() }
})
