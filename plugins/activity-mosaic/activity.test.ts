import { expect, test } from "bun:test"
import { CAPACITY, CATEGORIES, append, emptyMosaic, eventChip, historyChips, seed, toolKind } from "./activity"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client"

const event = (type: string, data: object, id = "event", created = 1) =>
  ({ type, data, id, created }) as OpenCodeEvent

test("the ring fills then replaces only the oldest chip in place indefinitely", () => {
  const mosaic = emptyMosaic()
  for (let i = 0; i < CAPACITY; i++) append(mosaic, { id: String(i), kind: "read", time: i })
  expect(mosaic.chips).toHaveLength(CAPACITY)
  expect(mosaic.next).toBe(0)
  append(mosaic, { id: "new", kind: "edit", time: CAPACITY })
  expect(mosaic.chips[0].id).toBe("new")
  expect(mosaic.chips[1].id).toBe("1")
  for (let i = CAPACITY + 1; i < 10_000; i++) append(mosaic, { id: String(i), kind: "think", time: i })
  expect(mosaic.chips).toHaveLength(CAPACITY)
  expect(mosaic.total).toBe(10_000)
  expect(mosaic.next).toBe(10_000 % CAPACITY)
})

test("failures recolor an existing tool chip instead of adding another action", () => {
  const mosaic = emptyMosaic()
  const start = eventChip(event("session.tool.input.started", { sessionID: "s", id: "t", name: "read" }))!
  const fail = eventChip(event("session.tool.failed", { sessionID: "s", id: "t" }, "fail", 2))!
  append(mosaic, start.chip)
  append(mosaic, fail.chip)
  expect(mosaic.total).toBe(1)
  expect(mosaic.chips[0].kind).toBe("error")
})

test("namespaced built-in tools get meaningful colors and unknown tools have a fallback", () => {
  for (const [name, kind] of Object.entries({
    read: "read", "functions.read": "read", patch: "edit", apply_patch: "edit",
    write: "edit", glob: "search", grep: "search", bash: "shell", shell: "shell",
    webfetch: "web", websearch: "web", subagent: "agent", question: "wait", execute: "tool",
    atlassian_getJiraIssue: "tool",
  })) expect(toolKind(name)).toBe(kind)
  expect(new Set(CATEGORIES.map((category) => category.color)).size).toBe(CATEGORIES.length)
})

test("one chip per thinking or reply block, never per streaming delta", () => {
  expect(eventChip(event("session.reasoning.started", { sessionID: "s", assistantMessageID: "m", ordinal: 0 }))?.chip.kind).toBe("think")
  expect(eventChip(event("session.text.started", { sessionID: "s", assistantMessageID: "m", ordinal: 1 }))?.chip.kind).toBe("reply")
  for (const type of ["session.reasoning.delta", "session.reasoning.ended", "session.text.delta", "session.text.ended", "session.tool.input.delta", "session.tool.success", "session.status"]) {
    expect(eventChip(event(type, { sessionID: "s" }))).toBeUndefined()
  }
})

test("prompts, questions, permission requests, compaction and outcomes are interesting", () => {
  const samples = [
    ["session.inbox.enqueued", { sessionID: "s", inboxID: "p", item: { type: "user" } }, "prompt"],
    ["form.created", { form: { sessionID: "s" } }, "wait"],
    ["permission.asked", { sessionID: "s" }, "wait"],
    ["session.compaction.started", { sessionID: "s" }, "compact"],
    ["session.execution.succeeded", { sessionID: "s" }, "done"],
    ["session.execution.failed", { sessionID: "s" }, "error"],
    ["session.execution.interrupted", { sessionID: "s" }, "wait"],
    ["session.shell.started", { sessionID: "s" }, "shell"],
  ] as const
  for (const [type, data, kind] of samples) {
    const activity = eventChip(event(type, data))!
    expect(activity.sessionID).toBe("s")
    expect(activity.chip.kind).toBe(kind)
  }
  expect(eventChip(event("session.inbox.enqueued", { sessionID: "s", item: { type: "synthetic" } }))).toBeUndefined()
  expect(eventChip(event("project.updated", {}))).toBeUndefined()
})

test("history seeds tools, reasoning, replies and prompts without storing their contents", () => {
  const messages = [
    { type: "user", id: "p", time: { created: 1 }, text: "private prompt" },
    { type: "assistant", id: "m", time: { created: 2 }, content: [
      { type: "reasoning", text: "private thought" },
      { type: "tool", id: "t", name: "patch", time: { created: 3 }, state: { status: "completed" } },
      { type: "text", text: "private reply" },
    ] },
  ] as SessionMessageInfo[]
  const history = historyChips(messages)
  expect(history.map((chip) => chip.kind)).toEqual(["prompt", "think", "edit", "reply"])
  expect(JSON.stringify(history)).not.toContain("private")
  const mosaic = emptyMosaic()
  append(mosaic, { id: "tool:t", kind: "error", time: 4 })
  append(mosaic, { id: "live", kind: "read", time: 5 })
  const result = seed(mosaic, history)
  expect(result.total).toBe(5)
  expect(result.chips.find((chip) => chip.id === "tool:t")?.kind).toBe("error")
  expect(result.chips.at(-1)?.id).toBe("live")
})

test("history longer than the mosaic keeps only the most recent chips", () => {
  const history = Array.from({ length: 300 }, (_, time) => ({ id: String(time), kind: "read" as const, time }))
  const mosaic = seed(emptyMosaic(), history)
  expect(mosaic.total).toBe(300)
  expect(mosaic.chips).toHaveLength(CAPACITY)
  expect(Math.min(...mosaic.chips.map((chip) => chip.time))).toBe(300 - CAPACITY)
})
