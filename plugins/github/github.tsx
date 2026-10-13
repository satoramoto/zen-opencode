import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { For, Show, createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { SidebarSection } from "../../ui/sidebar-section"

const exec = promisify(execFile)
type Check = { name: string; state?: string; conclusion?: string; bucket?: string }
type PullRequest = {
  number: number
  title?: string
  url?: string
  headRepository?: { name: string } | null
  headRepositoryOwner?: { login: string } | null
  statusCheckRollup?: Check[] | null
}

function checkDot(checks: Check[] | null | undefined) {
  if (!checks?.length) return { glyph: "○", color: "muted" as const }
  const pending = checks.some((check) => check.bucket === "pending" || ["PENDING", "IN_PROGRESS", "QUEUED"].includes(check.state ?? ""))
  const failed = checks.some((check) => check.bucket === "fail" || ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(check.conclusion ?? ""))
  if (pending) return { glyph: "●", color: "warning" as const }
  if (failed) return { glyph: "●", color: "error" as const }
  return { glyph: "●", color: "success" as const }
}

function missingRepository(error: unknown) {
  const stderr = (error as { stderr?: string })?.stderr ?? ""
  return /not a git repository|no git remotes|none of the git remotes.*(github|known host)|could not resolve to a repository/i.test(stderr)
}

function GitHub(props: { sessionID: string; refreshVersion: number; onRefresh: () => void }) {
  const context = usePlugin()
  const session = () => context.data.session.get(props.sessionID)
  const [emptyState, setEmptyState] = createSignal("No pull request for this branch")
  const [pullRequest, setPullRequest] = createSignal<PullRequest>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const [pairedPullRequests, setPairedPullRequests] = createSignal<PullRequest[]>([])
  const [pairedError, setPairedError] = createSignal("")
  let disposed = false

  async function refresh() {
    const directory = session()?.location?.directory
    if (!directory || loading()) return
    setLoading(true)
    setError("")
    setPairedError("")
    setPairedPullRequests([])
    setEmptyState("No pull request for this branch")
    try {
      const git = await exec("git", ["-C", directory, "branch", "--show-current"], { timeout: 5_000 })
      const currentBranch = git.stdout.trim()
      if (!currentBranch) {
        setPullRequest(undefined)
        return
      }
      // Resolve the base repository, not the PR's head repository (which can
      // be a fork), before deciding whether this branch has paired e2e work.
      const repository = await exec("gh", [
        "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner",
      ], { cwd: directory, timeout: 15_000 })
      const nameWithOwner = repository.stdout.trim()
      if (!nameWithOwner) {
        setPullRequest(undefined)
        setEmptyState("No GitHub repository")
        return
      }
      const result = await exec("gh", [
        "pr", "list", "--head", currentBranch, "--state", "all", "--limit", "1",
        "--json", "number,title,url,headRepository,headRepositoryOwner,statusCheckRollup",
      ], { cwd: directory, timeout: 15_000, maxBuffer: 1024 * 1024 })
      const prs = JSON.parse(result.stdout) as PullRequest[]
      if (!disposed) setPullRequest(prs[0])
      if (nameWithOwner.toLowerCase() !== "chronogolf/chronogolf") return
      try {
        const paired = await exec("gh", [
          "pr", "list", "--repo", "chronogolf/golf-e2e", "--head", currentBranch,
          "--state", "all", "--limit", "1000",
          "--json", "number,title,url,headRepository,headRepositoryOwner,statusCheckRollup",
        ], { cwd: directory, timeout: 15_000, maxBuffer: 1024 * 1024 })
        if (!disposed) setPairedPullRequests(JSON.parse(paired.stdout) as PullRequest[])
      } catch (error) {
        if (!disposed && !missingRepository(error)) setPairedError("Could not load paired e2e PRs.")
      }
    } catch (error) {
      if (!disposed) {
        setPullRequest(undefined)
        if (missingRepository(error)) setEmptyState("No GitHub repository")
        else setError("Could not load GitHub status. Check git and gh authentication.")
      }
    } finally {
      if (!disposed) setLoading(false)
    }
  }

  createEffect(() => {
    // Reload when the selected session or explicit refresh counter changes.
    session()?.location?.directory
    props.refreshVersion
    // refresh reads/writes loading synchronously; tracking it here would make
    // every completed request trigger another request and hide the PR details.
    untrack(() => void refresh())
  })
  const timer = setInterval(() => void refresh(), 60_000)
  onCleanup(() => { disposed = true; clearInterval(timer) })

  const summary = () => pullRequest()
    ? `#${pullRequest()!.number}${pairedPullRequests().length ? ` · ${pairedPullRequests().length} e2e` : ""}`
    : loading() ? "Loading" : pairedPullRequests().length ? `${pairedPullRequests().length} e2e` : emptyState() === "No GitHub repository" ? "No repo" : "No PR"

  function pullRequestRow(pr: PullRequest, paired = false) {
    const ci = checkDot(pr.statusCheckRollup)
    const color = ci.color === "warning"
      ? context.theme.text.feedback.warning.base
      : ci.color === "error" ? context.theme.text.feedback.error.base
      : ci.color === "success" ? context.theme.text.feedback.success.base : context.theme.text.muted
    const label = `${paired ? "E2E " : ""}#${pr.number}`
    return (
      <box flexDirection="row" gap={1} minWidth={0}>
        <text fg={context.theme.text.base} wrapMode="none" flexShrink={0}><b>{pr.url ? <a href={pr.url}>{label}</a> : label}</b></text>
        <text fg={context.theme.text.muted} wrapMode="none" truncate flexGrow={1} minWidth={0}>{pr.url ? <a href={pr.url}>{pr.title || "Pull request"}</a> : pr.title || "Pull request"}</text>
        <text fg={color} wrapMode="none" flexShrink={0}>{ci.glyph}</text>
      </box>
    )
  }

  return (
    <SidebarSection title="GitHub" summary={summary()}>
      <Show when={loading()}><text fg={context.theme.text.muted}>Refreshing…</text></Show>
      <Show when={error()}><text fg={context.theme.text.feedback.warning.base}>{error()}</text></Show>
      <Show when={!loading() && !error()}>
        <Show keyed when={pullRequest()} fallback={<text fg={context.theme.text.muted}>{emptyState()}</text>}>
          {(pr) => pullRequestRow(pr)}
        </Show>
        <For each={pairedPullRequests()}>{(pr) => pullRequestRow(pr, true)}</For>
        <Show when={pairedError()}><text fg={context.theme.text.feedback.warning.base}>{pairedError()}</text></Show>
      </Show>
      <box onMouseDown={props.onRefresh}><text fg={context.theme.text.muted} wrapMode="none">↻ refresh</text></box>
    </SidebarSection>
  )
}

export default Plugin.define({
  id: "local.github",
  setup(context) {
    const [refreshVersion, setRefreshVersion] = createSignal(0)
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => <GitHub sessionID={input.sessionID} refreshVersion={refreshVersion()} onRefresh={() => setRefreshVersion((value) => value + 1)} />,
    })
    const commands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({ mode: "global", commands: [{
          id: "local.github.refresh",
          title: "Refresh GitHub status",
          group: "GitHub",
          palette: true,
          slash: { name: "github-refresh" },
          run: () => setRefreshVersion((value) => value + 1),
        }] }))
        return null
      },
    })
    return () => { sidebar(); commands() }
  },
})
