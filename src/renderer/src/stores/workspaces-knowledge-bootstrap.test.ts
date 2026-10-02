import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('retired clip library', () => {
  it('does not expose the server or automatic knowledge bootstrap', () => {
    const contract = readFileSync(new URL('../../../shared/ipc-contract.ts', import.meta.url), 'utf-8')
    const main = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf-8')
    expect(contract).not.toContain('workspace.ensureDefaultKnowledge')
    expect(contract).not.toContain('raw.extensionInfo')
    expect(main).not.toContain('captureServer')
    expect(existsSync(new URL('../../../main/raw/server.ts', import.meta.url))).toBe(false)
  })
})
