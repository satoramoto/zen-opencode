import { describe, expect, test } from "bun:test"
import { balanceLabel, balanceMeter, bedrockBalance, copilotBalance, resetLabel } from "./balances"

describe("Copilot", () => {
  test("uses precise account credits, not a premium-request multiplier", () => {
    const balance = copilotBalance({ quota_snapshots: { premium_interactions: {
      token_based_billing: true, quota_remaining: 36932.3, remaining: 36932, entitlement: 40000,
    } }, quota_reset_date_utc: "2026-11-01T00:00:00Z" })
    expect(balance.remaining).toBe(36932.3)
    expect(balanceLabel(balance)).toBe("36,932 / 40,000 credits left")
    expect(resetLabel(balance)).toBe("Resets Nov 1 UTC")
  })
  test("legacy request plans and unlimited quotas", () => {
    expect(copilotBalance({ quota_snapshots: { premium_interactions: { token_based_billing: false, remaining: 100, entitlement: 300 } } }).unit).toBe("requests")
    expect(copilotBalance({ quota_snapshots: { premium_interactions: { unlimited: true } } }).status).toBe("unlimited")
  })
  test("does not invent a balance or unit from malformed quota data", () => {
    for (const payload of [{}, null, { quota_snapshots: { premium_interactions: { remaining: 1, entitlement: 2 } } }]) {
      expect(copilotBalance(payload).status).toBe("unavailable")
    }
  })
})

describe("remaining allowance bars", () => {
  test("filled cells show the remaining fraction, not spend", () => {
    expect(balanceMeter({ status: "ready", remaining: 75, limit: 100 })).toEqual({ filled: 27, empty: 9, percent: 75 })
  })
  test("empty, full, zero-cap, and over-limit balances have bounded bars", () => {
    for (const remaining of [0, 1, 49.5, 100, 200, -10]) {
      const meter = balanceMeter({ status: "ready", remaining, limit: 100 })!
      expect(meter.filled + meter.empty).toBe(36)
      expect(meter.filled).toBeGreaterThanOrEqual(0)
      expect(meter.empty).toBeGreaterThanOrEqual(0)
    }
    expect(balanceMeter({ status: "ready", remaining: 0, limit: 0 })).toEqual({ filled: 0, empty: 36, percent: 0 })
  })
  test("unknown or unlimited allowances never imply an empty balance", () => {
    for (const status of ["unavailable", "unlimited", "disconnected"] as const) expect(balanceMeter({ status })).toBeUndefined()
    expect(balanceMeter({ status: "ready", remaining: NaN, limit: 100 })).toBeUndefined()
  })
})

describe("company gateway", () => {
  test("remaining shared allowance and reset", () => {
    const balance = bedrockBalance({ spend: 151.905, max_budget: 200, budget_reset_at: "2026-10-12T00:00:00Z" })
    expect(balanceLabel(balance)).toBe("$48.10 / $200.00 left")
    expect(resetLabel(balance)).toBe("Resets Oct 12 UTC")
  })
  test("over budget clamps to zero; zero cap is not unlimited", () => {
    expect(bedrockBalance({ spend: 210, max_budget: 200 }).remaining).toBe(0)
    expect(bedrockBalance({ spend: 0, max_budget: 0 }).status).toBe("ready")
  })
  test("null cap differs from missing or invalid values", () => {
    expect(balanceLabel(bedrockBalance({ max_budget: null }))).toBe("No personal cap")
    for (const payload of [{}, { spend: NaN, max_budget: 200 }, { spend: 0, max_budget: -1 }]) {
      expect(bedrockBalance(payload).status).toBe("unavailable")
    }
  })
})
