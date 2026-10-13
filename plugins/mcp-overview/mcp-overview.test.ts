import { expect, test } from "bun:test"
import type { McpResource, SessionMessageInfo } from "@opencode/client"
import { observedToolCount, observedToolNames, resourceCount, rightAlign, toolColumnValue } from "./metrics"

const assistant = (content: any[]): SessionMessageInfo => ({
  id: "message",
  type: "assistant",
  agent: "build",
  model: { providerID: "test", id: "model" },
  content,
  time: { created: 1 },
})

test("counts namespaced MCP tools seen in current session, deduplicated by server and tool", () => {
  const messages = [assistant([
    { type: "tool", id: "1", name: "datadog.search_logs", state: { status: "completed", input: {}, content: [{ type: "text", text: "" }] } },
    { type: "tool", id: "2", name: "datadog.search_logs", state: { status: "completed", input: {}, content: [{ type: "text", text: "" }] } },
    { type: "tool", id: "3", name: "datadog_metrics.query", state: { status: "running", input: {}, metadata: {} } },
    { type: "tool", id: "4", name: "atlassian_search", state: { status: "running", input: {}, metadata: {} } },
    { type: "tool", id: "5", name: "execute", state: { status: "running", input: {}, metadata: {} } },
  ])]
  expect(observedToolCount(messages, "datadog")).toBe(2)
  expect(observedToolNames(messages, "datadog")).toEqual(["metrics.query", "search_logs"])
  expect(observedToolCount(messages, "atlassian")).toBe(1)
  expect(observedToolCount(messages, "incident-io")).toBe(0)
  expect(observedToolNames(messages, "incident-io")).toEqual([])
  const incidentTools = [assistant([
    { type: "tool", id: "6", name: "incident-io_incident_list", state: { status: "running", input: {}, metadata: {} } },
  ])]
  expect(observedToolCount(incidentTools, "incident-io")).toBe(1)
  expect(observedToolNames(incidentTools, "incident-io")).toEqual(["incident_list"])
})

test("counts catalog resources per server", () => {
  const resources = [
    { server: "datadog", name: "dashboard", uri: "dd://dashboard" },
    { server: "datadog", name: "logs", uri: "dd://logs" },
    { server: "atlassian", name: "issues", uri: "jira://issues" },
  ] satisfies McpResource[]
  expect(resourceCount(resources, "datadog")).toBe(2)
  expect(resourceCount(resources, "atlassian")).toBe(1)
  expect(resourceCount([], "missing")).toBe(0)
})

test("right-aligns fixed-width columns without changing already-wide values", () => {
  expect(toolColumnValue([], "datadog")).toBe("—")
  expect(rightAlign("Tools", 8)).toBe("   Tools")
  expect(rightAlign("12t", 8)).toBe("     12t")
  expect(rightAlign("123456789", 8)).toBe("23456789")
})
