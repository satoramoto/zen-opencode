// Structural inputs keep calculations independent of the TUI/runtime.
export type Message = {
  id: string
  type: string
  time: { created: number; completed?: number }
  status?: string
  model?: { providerID: string; id: string }
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  snapshot?: { files?: string[] }
  content?: Array<{
    type: string
    name?: string
    text?: string
    time?: { created: number; completed?: number }
    state?: { status: string; input: unknown }
  }>
}
export type Run = { started: number; ended?: number }

export function visibleMessages(messages: readonly Message[], revertID?: string) {
  const index = revertID ? messages.findIndex((message) => message.id === revertID) : -1
  return index >= 0 ? messages.slice(0, index) : [...messages]
}

export function reportedContext(messages: readonly Message[]) {
  const boundary = messages.findLastIndex((message) => message.type === "compaction" && message.status === "completed")
  const last = messages.slice(boundary + 1).findLast((message) => message.type === "assistant" && message.tokens)
  if (!last?.tokens) return undefined
  const t = last.tokens
  const used = t.input + t.cache.read + t.cache.write + t.output + t.reasoning
  return { used, model: last.model }
}

// Execution events are precise. Historical message boundaries are only an approximation.
export function runDuration(messages: readonly Message[], running: boolean, now: number, event?: Run) {
  if (event && (running ? event.ended === undefined : event.ended !== undefined)) {
    return { ms: Math.max(0, (event.ended ?? now) - event.started), approximate: false }
  }
  const end = running ? messages.length : messages.findLastIndex((message) => message.type === "idle")
  if (end < 0) return undefined
  const previous = messages.slice(0, end).findLastIndex((message) => message.type === "idle")
  const start = messages.slice(previous + 1, end).find((message) => message.type === "user" || message.type === "synthetic")
  if (!start) return undefined
  return { ms: Math.max(0, (running ? now : messages[end].time.created) - start.time.created), approximate: true }
}

function editPaths(name: string | undefined, input: unknown): string[] {
  if (!input || typeof input !== "object") return []
  const data = input as Record<string, unknown>
  const tool = name?.split(/[._]/).at(-1)
  if (tool === "edit" || tool === "write") {
    const path = data.filePath ?? data.file_path ?? data.path
    return typeof path === "string" ? [path] : []
  }
  if (tool === "patch" || name === "apply_patch") {
    const text = data.patchText ?? data.patch
    if (typeof text !== "string") return []
    return [...text.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((match) => match[1])
  }
  return []
}

export function recentFiles(groups: readonly (readonly Message[])[], limit = 3) {
  const latest = new Map<string, number>()
  for (const messages of groups) for (const message of messages) {
    if (message.type !== "assistant") continue
    const record = (path: string, time: number) => latest.set(path, Math.max(latest.get(path) ?? 0, time))
    for (const path of message.snapshot?.files ?? []) record(path, message.time.completed ?? message.time.created)
    for (const part of message.content ?? []) {
      if (part.type !== "tool" || part.state?.status !== "completed") continue
      for (const path of editPaths(part.name, part.state.input)) record(path, part.time?.completed ?? message.time.created)
    }
  }
  const sorted = [...latest].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return { paths: sorted.slice(0, limit).map(([path]) => path), total: sorted.length }
}

export function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function elapsed(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

export function displayPath(path: string, directory: string) {
  const prefix = directory.replace(/\/$/, "") + "/"
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}
