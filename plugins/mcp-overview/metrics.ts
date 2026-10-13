import type { McpResource, SessionMessageInfo } from "@opencode/client"

export function rightAlign(value: string, width: number) {
  return value.slice(-width).padStart(width)
}

export const MCP_TOOL_COLUMN_WIDTH = 8
export const MCP_RESOURCE_COLUMN_WIDTH = 6

export function observedToolNames(messages: SessionMessageInfo[], server: string) {
  const namespace = server.replace(/[^a-zA-Z0-9_-]/g, "_")
  const tools = new Set<string>()
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool") continue
      if (part.name.startsWith(`${namespace}_`) || part.name.startsWith(`${namespace}.`)) {
        tools.add(part.name.slice(namespace.length + 1))
        continue
      }
    }
  }
  return [...tools].toSorted((a, b) => a.localeCompare(b))
}

export function observedToolCount(messages: SessionMessageInfo[], server: string) {
  return observedToolNames(messages, server).length
}

export function toolColumnValue(messages: SessionMessageInfo[], server: string) {
  const names = observedToolNames(messages, server)
  return names.length ? `${names.length}t*` : "—"
}

export function resourceCount(resources: McpResource[], server: string) {
  return resources.filter((resource) => resource.server === server).length
}
