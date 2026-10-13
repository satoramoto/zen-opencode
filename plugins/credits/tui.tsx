import { Plugin } from "@opencode/plugin/tui"
import { Show, createSignal } from "solid-js"
import { balanceLabel, balanceMeter, resetLabel, type Balance, type Balances } from "./balances"
import { Credits } from "./rpc"
import { SidebarSection } from "../../ui/sidebar-section"

export default Plugin.define({
  id: "local.credits",
  setup(context) {
    const client = context.client.rpc(Credits)
    const [data, setData] = createSignal<Balances>()
    const [loading, setLoading] = createSignal(false)
    const [error, setError] = createSignal(false)
    let disposed = false

    async function refresh() {
      if (disposed || loading()) return
      setLoading(true)
      try {
        const value = await client.balances({})
        if (!disposed) {
          setData(value as Balances)
          setError(false)
        }
      } catch {
        if (!disposed) setError(true)
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    const summary = () => {
      const value = data()
      if (!value) return error() ? "unavailable" : "loading"
      const copilot = balanceMeter(value.copilot)
      const bedrock = balanceMeter(value.bedrock)
      return `Copilot ${copilot ? `${copilot.percent}%` : "—"} · Bedrock ${bedrock ? `${bedrock.percent}%` : "—"}`
    }

    function Row(props: { name: string; balance: Balance; color: string }) {
      const warning = () => props.balance.status === "ready" && props.balance.limit! > 0 && props.balance.remaining! / props.balance.limit! <= 0.1
      const meter = () => balanceMeter(props.balance)
      return (
        <box flexDirection="column" paddingTop={1}>
          <text fg={context.theme.text.base}>{props.name}{meter() ? ` · ${meter()!.percent}% left` : ""}</text>
          <Show when={meter()}>
            {(bar) => (
              <text wrapMode="none">
                <span style={{ fg: warning() ? "#facc15" : props.color }}>{"█".repeat(bar().filled)}</span>
                <span style={{ fg: context.theme.text.muted }}>{"░".repeat(bar().empty)}</span>
              </text>
            )}
          </Show>
          <text fg={warning() ? "#facc15" : context.theme.text.muted}>{balanceLabel(props.balance)}</text>
          <Show when={resetLabel(props.balance)}>
            <text fg={context.theme.text.muted}>{resetLabel(props.balance)}</text>
          </Show>
        </box>
      )
    }

    const slot = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <box flexDirection="column">
          <SidebarSection title="Credits" summary={summary()}>
            <box onMouseDown={() => void refresh()}>
              <text fg={context.theme.text.muted}>{loading() ? "Refreshing…" : "[Refresh · /credits]"}</text>
            </box>
            <Show when={data()} fallback={<text fg={context.theme.text.muted}>{error() ? "Unavailable · try /credits" : "Loading balances…"}</text>}>
              {(value) => (
                <>
                  <Row name="Copilot" balance={value().copilot} color="#60a5fa" />
                  <Row name="Bedrock · company gateway" balance={value().bedrock} color="#a78bfa" />
                  <text fg={context.theme.text.muted}>
                    {error() ? "Refresh failed · previous balances" : `Updated ${new Date(value().updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                  </text>
                </>
              )}
            </Show>
          </SidebarSection>
        </box>
      ),
    })
    const commands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "local.credits.refresh",
            title: "Refresh account credits",
            group: "Credits",
            palette: true,
            slash: { name: "credits" },
            run: () => refresh(),
          }],
        }))
        return null
      },
    })
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => {
      disposed = true
      clearInterval(timer)
      slot()
      commands()
    }
  },
})
