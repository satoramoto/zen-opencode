import { Plugin } from "@opencode/plugin"
import { bedrockBalance, copilotBalance, type Balance } from "./balances"
import { Credits } from "./rpc"

export default Plugin.define({
  id: "local.credits",
  async setup(context) {
    async function read(integrationID: string, url: string, parse: (data: unknown) => Balance, signal: AbortSignal): Promise<Balance> {
      try {
        const connection = await context.integration.connection.active(integrationID)
        if (!connection) return { status: "disconnected" }
        // Credentials stay server-side; resolve also handles OAuth refresh.
        const credential = await context.integration.connection.resolve(connection)
        if (!credential) return { status: "disconnected" }
        const token = credential.type === "key" ? credential.key : credential.access
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${token}`, "user-agent": "OpenCode-Credits" },
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        })
        if (!response.ok) {
          return { status: "unavailable", note: response.status === 401 || response.status === 403 ? "Account access unavailable" : `Balance HTTP ${response.status}` }
        }
        return parse(await response.json())
      } catch {
        // Never expose credentials, raw API responses, or provider error bodies.
        return { status: "unavailable", note: "Balance temporarily unavailable" }
      }
    }

    const registration = await context.rpc.register(Credits, {
      balances: async (_input, { signal }) => {
        const [copilot, bedrock] = await Promise.all([
          read("github-copilot", "https://api.github.com/copilot_internal/user", copilotBalance, signal),
          read("lightspeedllm", "https://llm.lightspeeddev.app/v2/user/info", bedrockBalance, signal),
        ])
        return { copilot, bedrock, updated: Date.now() }
      },
    })
    return () => registration.dispose()
  },
})
