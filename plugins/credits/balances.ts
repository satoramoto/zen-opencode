export type Balance = {
  status: "ready" | "unlimited" | "unavailable" | "disconnected"
  unit?: "credits" | "requests" | "usd"
  remaining?: number
  limit?: number
  reset?: string
  note?: string
}

export type Balances = { copilot: Balance; bedrock: Balance; updated: number }

export function balanceMeter(balance: Balance, width = 36): { filled: number; empty: number; percent: number } | undefined {
  if (balance.status !== "ready" || balance.remaining === undefined || balance.limit === undefined ||
      !Number.isFinite(balance.remaining) || !Number.isFinite(balance.limit) || balance.limit < 0) return undefined
  const ratio = balance.limit === 0 ? 0 : Math.max(0, Math.min(1, balance.remaining / balance.limit))
  const filled = Math.round(ratio * width)
  return { filled, empty: width - filled, percent: Math.round(ratio * 100) }
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const amount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
const date = (value: unknown): string | undefined =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined

export function copilotBalance(payload: unknown): Balance {
  const data = object(payload)
  const quota = object(object(data.quota_snapshots).premium_interactions)
  const reset = date(data.quota_reset_date_utc) ?? date(data.quota_reset_date)
  const unit = quota.token_based_billing === true ? "credits" : quota.token_based_billing === false ? "requests" : undefined
  if (quota.unlimited === true) return { status: "unlimited", unit, reset }
  const remaining = amount(quota.quota_remaining) ?? amount(quota.remaining)
  const limit = amount(quota.entitlement)
  if (!unit || remaining === undefined || limit === undefined) {
    return { status: "unavailable", note: "Quota format unavailable" }
  }
  return { status: "ready", unit, remaining, limit, reset }
}

export function bedrockBalance(payload: unknown): Balance {
  const data = object(payload)
  const spend = amount(data.spend)
  const reset = date(data.budget_reset_at)
  // Missing/null limits mean no personal cap, not an infinite pool of prepaid credits.
  if (data.max_budget === null) return { status: "unlimited", unit: "usd", reset, note: "No personal cap" }
  const limit = amount(data.max_budget)
  if (spend === undefined || limit === undefined) return { status: "unavailable", note: "Budget data unavailable" }
  return { status: "ready", unit: "usd", remaining: Math.max(0, limit - spend), limit, reset }
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, roundingMode: "floor" })

export function balanceLabel(balance: Balance): string {
  if (balance.status === "disconnected") return "Not connected"
  if (balance.status === "unavailable") return balance.note ?? "Unavailable"
  if (balance.status === "unlimited") return balance.note ?? "Unlimited allowance"
  if (balance.unit === "usd") return `${usd.format(balance.remaining!)} / ${usd.format(balance.limit!)} left`
  return `${count.format(balance.remaining!)} / ${count.format(balance.limit!)} ${balance.unit} left`
}

export function resetLabel(balance: Balance): string | undefined {
  if (!balance.reset) return undefined
  return `Resets ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(balance.reset))} UTC`
}
