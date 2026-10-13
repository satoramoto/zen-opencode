import { Plugin } from "@opencode/plugin"

import { startupSigningCheck } from "../git-signing-startup"

// Each service process probes once, even if it loads multiple workspace instances.
let started = false

export default Plugin.define({
  id: "git-signing-startup",
  async setup(ctx) {
    if (started) return
    started = true
    await startupSigningCheck(ctx.location.directory)
  },
})
