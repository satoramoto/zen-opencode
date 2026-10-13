import { execFile, spawn } from "node:child_process"
import { mkdtemp, unlink, rmdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)
const signer = "/Applications/1Password.app/Contents/MacOS/op-ssh-sign"

type Dependencies = {
  config: (name: string) => Promise<string>
  sign: (key: string) => Promise<void>
  notify: (message: string) => void
}

export async function authorizeSigning(deps: Dependencies): Promise<void> {
  try {
    if ((await deps.config("commit.gpgsign")) !== "true") return
    if ((await deps.config("gpg.format")) !== "ssh") return
    if ((await deps.config("gpg.ssh.program")) !== signer) return
    const key = await deps.config("user.signingkey")
    if (!key) return

    deps.notify("Approve the 1Password signing request if prompted (up to 60 seconds).")
    await deps.sign(key)
    deps.notify("1Password signing check succeeded.")
  } catch {
    deps.notify("Signing check failed or timed out; Git signing remains enabled. Check 1Password for a waiting SSH request.")
  }
}

export async function withPublicKeyFile<T>(key: string, action: (path: string) => Promise<T>): Promise<T> {
  const publicKey = key.startsWith("key::") ? key.slice(5) : key
  if (!/^(ssh-|ecdsa-|sk-)/.test(publicKey)) return action(key)

  const directory = await mkdtemp(join(tmpdir(), "opencode-signing-"))
  const path = join(directory, "key.pub")
  try {
    await writeFile(path, `${publicKey}\n`, { mode: 0o600 })
    return await action(path)
  } finally {
    await unlink(path).catch(() => {})
    await rmdir(directory).catch(() => {})
  }
}

export function startupSigningCheck(directory: string): Promise<void> {
  return authorizeSigning({
    config: async name => {
      const { stdout } = await exec("git", ["config", "--get", name], {
        cwd: directory,
        timeout: 5_000,
      })
      return stdout.trim()
    },
    sign: key => withPublicKeyFile(key, path => new Promise<void>((resolve, reject) => {
      const child = spawn(signer, ["-Y", "sign", "-n", "git", "-f", path], {
        cwd: directory,
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 60_000,
      })
      child.once("error", reject)
      child.once("close", code => {
        if (code === 0) resolve()
        else reject(new Error("Signing probe failed"))
      })
      child.stdin.on("error", () => {})
      child.stdin.end("OpenCode startup signing authorization check\n")
    })),
    notify: message => console.error(`[git-signing-startup] ${message}`),
  })
}
