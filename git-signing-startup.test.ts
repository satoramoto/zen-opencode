import { describe, expect, it, mock } from "bun:test"

import { readFile, access } from "node:fs/promises"

import { authorizeSigning, withPublicKeyFile } from "./git-signing-startup"

function dependencies(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    "commit.gpgsign": "true",
    "gpg.format": "ssh",
    "gpg.ssh.program": "/Applications/1Password.app/Contents/MacOS/op-ssh-sign",
    "user.signingkey": "ssh-ed25519 public-key-only",
    ...overrides,
  }
  return {
    config: async (name: string) => values[name],
    sign: mock(async (_key: string) => {}),
    notify: mock((_message: string) => {}),
  }
}

describe("startup signing authorization", () => {
  it("writes inline public keys to a temporary file and removes it", async () => {
    let path = ""
    await withPublicKeyFile("ssh-ed25519 public-key-only", async file => {
      path = file
      expect(await readFile(file, "utf8")).toBe("ssh-ed25519 public-key-only\n")
    })
    await expect(access(path)).rejects.toThrow()
  })

  it("accepts Git's key:: prefix and cleans up on failure", async () => {
    let path = ""
    await expect(withPublicKeyFile("key::ssh-ed25519 public-key-only", async file => {
      path = file
      expect(await readFile(file, "utf8")).toBe("ssh-ed25519 public-key-only\n")
      throw new Error("denied")
    })).rejects.toThrow("denied")
    await expect(access(path)).rejects.toThrow()
  })

  it("passes existing key file paths through unchanged", async () => {
    const action = mock(async (path: string) => path)
    expect(await withPublicKeyFile("/example/key.pub", action)).toBe("/example/key.pub")
  })
  it("probes the configured 1Password key once", async () => {
    const deps = dependencies()
    await authorizeSigning(deps)
    expect(deps.sign).toHaveBeenCalledTimes(1)
    expect(deps.sign).toHaveBeenCalledWith("ssh-ed25519 public-key-only")
    expect(deps.notify).toHaveBeenLastCalledWith("1Password signing check succeeded.")
  })

  for (const overrides of [
    { "commit.gpgsign": "false" },
    { "gpg.format": "openpgp" },
    { "gpg.ssh.program": "/usr/bin/ssh-keygen" },
    { "user.signingkey": "" },
  ]) {
    it(`skips unsupported configuration ${JSON.stringify(overrides)}`, async () => {
      const deps = dependencies(overrides)
      await authorizeSigning(deps)
      expect(deps.sign).not.toHaveBeenCalled()
    })
  }

  it("does not stop startup when signing fails", async () => {
    const deps = dependencies()
    deps.sign.mockImplementation(async () => { throw new Error("denied") })
    await expect(authorizeSigning(deps)).resolves.toBeUndefined()
    expect(deps.notify.mock.calls.at(-1)?.[0]).toContain("Git signing remains enabled")
  })

  it("handles missing Git configuration without attempting signing", async () => {
    const deps = dependencies()
    deps.config = async () => { throw new Error("missing config") }
    await expect(authorizeSigning(deps)).resolves.toBeUndefined()
    expect(deps.sign).not.toHaveBeenCalled()
  })
})
