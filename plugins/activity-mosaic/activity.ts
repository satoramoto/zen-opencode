import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client"

export const COLUMNS = 11
export const ROWS = 8
export const CAPACITY = COLUMNS * ROWS
export const CATEGORIES = [
  { key: "read", label: "Read", abbreviation: "Read", color: "#60a5fa" },
  { key: "edit", label: "Edit", abbreviation: "Edit", color: "#4ade80" },
  { key: "search", label: "Search", abbreviation: "Srch", color: "#22d3ee" },
  { key: "shell", label: "Shell", abbreviation: "Shell", color: "#fb923c" },
  { key: "think", label: "Think", abbreviation: "Think", color: "#c084fc" },
  { key: "reply", label: "Reply", abbreviation: "Reply", color: "#f472b6" },
  { key: "prompt", label: "You", abbreviation: "You", color: "#facc15" },
  { key: "web", label: "Web", abbreviation: "Web", color: "#2dd4bf" },
  { key: "agent", label: "Agent", abbreviation: "Agent", color: "#818cf8" },
  { key: "tool", label: "Tool", abbreviation: "Tool", color: "#a3e635" },
  { key: "wait", label: "Ask", abbreviation: "Ask", color: "#e2e8f0" },
  { key: "compact", label: "Compact", abbreviation: "Cmpct", color: "#94a3b8" },
  { key: "error", label: "Error", abbreviation: "Error", color: "#f87171" },
  { key: "done", label: "Done", abbreviation: "Done", color: "#34d399" },
] as const
export type Kind = typeof CATEGORIES[number]["key"]
export type Chip = { id: string; kind: Kind; time: number }
export type Mosaic = { chips: Chip[]; next: number; total: number }
export const emptyMosaic = (): Mosaic => ({ chips: [], next: 0, total: 0 })

export function toolKind(name: string): Kind {
  const tool = name.toLowerCase().split(/[._]/).at(-1) ?? name
  if (["read"].includes(tool)) return "read"
  if (["patch", "edit", "write"].includes(tool)) return "edit"
  if (["grep", "glob", "search"].includes(tool)) return "search"
  if (["shell", "bash"].includes(tool)) return "shell"
  if (["webfetch", "websearch"].includes(tool)) return "web"
  if (["subagent", "task"].includes(tool)) return "agent"
  if (["question"].includes(tool)) return "wait"
  return "tool"
}

// Updating an existing chip (e.g. a tool failing) doesn't consume another cell.
export function append(mosaic: Mosaic, chip: Chip): void {
  const index = mosaic.chips.findIndex((item) => item.id === chip.id)
  if (index >= 0) {
    mosaic.chips[index] = chip
    return
  }
  mosaic.chips[mosaic.next] = chip
  mosaic.next = (mosaic.next + 1) % CAPACITY
  mosaic.total++
}

export function eventChip(event: OpenCodeEvent): { sessionID: string; chip: Chip } | undefined {
  if (event.type === "form.created") {
    return { sessionID: event.data.form.sessionID, chip: { id: event.id, kind: "wait", time: event.created } }
  }
  if (!("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
  const data = event.data
  let kind: Kind
  let id = event.id
  switch (event.type) {
    case "session.tool.input.started":
      kind = toolKind(event.data.name)
      id = `tool:${event.data.id}`
      break
    case "session.tool.failed":
      kind = "error"
      id = `tool:${event.data.id}`
      break
    case "session.reasoning.started":
    case "session.text.started":
      kind = event.type === "session.reasoning.started" ? "think" : "reply"
      id = `part:${event.data.assistantMessageID}:${event.data.ordinal}`
      break
    case "session.inbox.enqueued":
      if (event.data.item.type !== "user") return
      kind = "prompt"
      id = `message:${event.data.inboxID}`
      break
    case "session.shell.started": kind = "shell"; break
    case "permission.asked":
      kind = "wait"; break
    case "session.compaction.started": kind = "compact"; break
    case "session.execution.failed": kind = "error"; break
    case "session.execution.succeeded": kind = "done"; break
    case "session.execution.interrupted": kind = "wait"; break
    default: return
  }
  return { sessionID: data.sessionID, chip: { id, kind, time: event.created } }
}

export function historyChips(messages: SessionMessageInfo[]): Chip[] {
  const chips: Chip[] = []
  for (const message of messages) {
    const time = message.time.created
    if (message.type === "assistant") {
      message.content.forEach((part, ordinal) => {
        chips.push({
          id: part.type === "tool" ? `tool:${part.id}` : `part:${message.id}:${ordinal}`,
          kind: part.type === "tool" ? part.state.status === "error" ? "error" : toolKind(part.name)
            : part.type === "reasoning" ? "think" : "reply",
          time: part.type === "tool" ? part.time.created : part.type === "reasoning" ? part.time?.created ?? time : time,
        })
      })
    } else if (message.type === "user" || message.type === "shell" || message.type === "compaction" || message.type === "idle") {
      chips.push({ id: `message:${message.id}`, time,
        kind: message.type === "user" ? "prompt" : message.type === "shell" ? "shell"
          : message.type === "idle" ? message.outcome === "succeeded" ? "done" : message.outcome === "failed" ? "error" : "wait"
          : message.status === "failed" ? "error" : "compact" })
    }
  }
  return chips
}

// Hydration may finish after live activity arrives. Merge without duplicating it.
export function seed(mosaic: Mosaic, history: Chip[]): Mosaic {
  const merged = new Map(history.map((chip) => [chip.id, chip]))
  for (const chip of mosaic.chips) merged.set(chip.id, chip)
  const result = emptyMosaic()
  for (const chip of [...merged.values()].sort((a, b) => a.time - b.time)) append(result, chip)
  return result
}
