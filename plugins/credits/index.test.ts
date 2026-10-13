import { afterEach, expect, test } from "bun:test"
import plugin from "./index"

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

async function harness(connected = true) {
  let handler: (input: unknown, context: { signal: AbortSignal }) => Promise<any>
  let disposed = false
  const cleanup = await plugin.setup({
    integration: { connection: {
      active: async (id: string) => connected ? { type: "credential", id } : undefined,
      resolve: async () => ({ type: "oauth", access: "test-token" }),
    } },
    rpc: { register: async (_definition: unknown, handlers: any) => {
      handler = handlers.balances
      return { dispose: async () => { disposed = true } }
    } },
  } as any)
  return {
    read: () => handler!({}, { signal: new AbortController().signal }),
    close: () => (cleanup as () => Promise<void>)(),
    disposed: () => disposed,
  }
}

test("fetches only the caller's accounts and returns no credentials", async () => {
  const urls: string[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    urls.push(url)
    expect(init.redirect).toBe("error")
    expect(init.headers).toEqual({ authorization: "Bearer test-token", "user-agent": "OpenCode-Credits" })
    return Response.json(url.includes("github") ? {
      quota_snapshots: { premium_interactions: { token_based_billing: true, remaining: 50, entitlement: 100 } },
    } : { spend: 20, max_budget: 200 })
  }) as typeof fetch
  const app = await harness()
  const result = await app.read()
  expect(urls.sort()).toEqual(["https://api.github.com/copilot_internal/user", "https://llm.lightspeeddev.app/v2/user/info"])
  expect(result.copilot.remaining).toBe(50)
  expect(result.bedrock.remaining).toBe(180)
  expect(JSON.stringify(result)).not.toContain("test-token")
  await app.close()
  expect(app.disposed()).toBe(true)
})

test("disconnected accounts do not send network requests", async () => {
  globalThis.fetch = (() => { throw new Error("Must not fetch") }) as typeof fetch
  const app = await harness(false)
  const result = await app.read()
  expect(result.copilot.status).toBe("disconnected")
  expect(result.bedrock.status).toBe("disconnected")
})

test("provider errors are isolated and sanitized", async () => {
  globalThis.fetch = (async (url: string) => url.includes("github")
    ? new Response("private-provider-error", { status: 403 })
    : Response.json({ spend: 1, max_budget: 200 })) as typeof fetch
  const app = await harness()
  const result = await app.read()
  expect(result.copilot.status).toBe("unavailable")
  expect(result.bedrock.status).toBe("ready")
  expect(JSON.stringify(result)).not.toContain("private-provider-error")
})
