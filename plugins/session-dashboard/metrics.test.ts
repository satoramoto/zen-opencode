import { describe, expect, test } from "bun:test"
import { compact, displayPath, elapsed, recentFiles, reportedContext, runDuration, visibleMessages, type Message } from "./metrics"

const message = (type: string, time: number, extra: Partial<Message> = {}): Message => ({ id: String(time), type, time: { created: time }, ...extra })
const tokens = { input: 100, output: 10, reasoning: 5, cache: { read: 200, write: 50 } }

describe("reported context", () => {
  test("uses latest request, including cache, not cumulative session tokens", () => {
    expect(reportedContext([message("assistant", 1, { tokens }), message("assistant", 2, { tokens: { ...tokens, input: 500 } })])?.used).toBe(765)
  })
  test("does not resurrect pre-compaction usage or mistake unreported usage for zero", () => {
    expect(reportedContext([message("assistant", 1, { tokens }), message("compaction", 2, { status: "completed" })])).toBeUndefined()
    expect(reportedContext([])).toBeUndefined()
    expect(reportedContext([message("assistant", 1, { tokens }), message("compaction", 2, { status: "running" })])?.used).toBe(365)
  })
  test("revert removes later context and edits", () => {
    const messages = [message("user", 1), message("assistant", 2, { tokens })]
    expect(visibleMessages(messages, "2")).toEqual([messages[0]])
    expect(visibleMessages(messages, "missing")).toEqual(messages)
  })
})

describe("run duration", () => {
  const messages = [message("user", 100), message("idle", 200), message("user", 300), message("assistant", 400)]
  test("event start measures current run, not session age", () => {
    expect(runDuration(messages, true, 700, { started: 500 })).toEqual({ ms: 200, approximate: false })
    expect(runDuration(messages, false, 1000, { started: 500, ended: 800 })).toEqual({ ms: 300, approximate: false })
  })
  test("historical/reload boundaries are approximate and finished duration freezes", () => {
    expect(runDuration(messages, true, 700)).toEqual({ ms: 400, approximate: true })
    expect(runDuration(messages, false, 700)).toEqual({ ms: 100, approximate: true })
    expect(runDuration([], true, 100)).toBeUndefined()
    expect(runDuration([message("idle", 100)], false, 200)).toBeUndefined()
  })
  test("stale event state cannot time a new run and negative durations clamp", () => {
    expect(runDuration(messages, true, 700, { started: 100, ended: 200 })).toEqual({ ms: 400, approximate: true })
    expect(runDuration(messages, true, 100, { started: 200 })?.ms).toBe(0)
  })
})

describe("recent files", () => {
  const tool = (name: string, input: unknown, status = "completed") => ({ type: "tool", name, state: { status, input } })
  test("merges family snapshots and completed edits, sorts newest first and deduplicates", () => {
    const root = message("assistant", 100, { snapshot: { files: ["a", "b"] } })
    const child = message("assistant", 200, { content: [tool("write", { filePath: "a" }), tool("edit", { file_path: "c" })] })
    expect(recentFiles([[root], [child]], 2)).toEqual({ paths: ["a", "c"], total: 3 })
  })
  test("patches include renamed/deleted files; failed and unfinished tools are ignored", () => {
    const msg = message("assistant", 1, { content: [
      tool("patch", { patchText: "*** Update File: a\n*** Move to: b\n*** Delete File: c\n*** Add File: d" }),
      tool("write", { path: "failed" }, "error"), tool("edit", { path: "running" }, "running"),
      tool("read", { path: "read-only" }),
    ] })
    expect(recentFiles([[msg]], 10)).toEqual({ paths: ["a", "b", "c", "d"], total: 4 })
    expect(recentFiles([])).toEqual({ paths: [], total: 0 })
  })
})

test("formats values without confusing path prefixes", () => {
  expect(compact(1200)).toBe("1.2k")
  expect(compact(2000000)).toBe("2.0M")
  expect(compact(0)).toBe("0")
  expect(elapsed(7208000)).toBe("2h 0m")
  expect(elapsed(68000)).toBe("1m 08s")
  expect(displayPath("/repo/a.ts", "/repo/")).toBe("a.ts")
  expect(displayPath("/repo-other/a.ts", "/repo")).toBe("/repo-other/a.ts")
})
