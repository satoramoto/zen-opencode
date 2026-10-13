import { Rpc } from "@opencode/plugin/rpc"

const balance = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ready", "unlimited", "unavailable", "disconnected"] },
    unit: { type: "string", enum: ["credits", "requests", "usd"] },
    remaining: { type: "number" },
    limit: { type: "number" },
    reset: { type: "string" },
    note: { type: "string" },
  },
  required: ["status"],
  additionalProperties: false,
} as const

export const Credits = Rpc.define({
  id: "local.credits",
  events: {},
  methods: {
    balances: {
      input: { type: "object", properties: {}, additionalProperties: false },
      errors: {},
      output: {
        type: "object",
        properties: { copilot: balance, bedrock: balance, updated: { type: "number" } },
        required: ["copilot", "bedrock", "updated"],
        additionalProperties: false,
      },
    },
  },
})
