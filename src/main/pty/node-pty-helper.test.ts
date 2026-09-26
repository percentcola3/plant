import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureExecutableBit, nodePtySpawnHelperCandidates } from './node-pty-helper'

describe('node-pty helper permissions', () => {
  it('resolves build and prebuild spawn-helper candidates from node-pty entry', () => {
    const entry = '/repo/node_modules/node-pty/lib/index.js'

    expect(nodePtySpawnHelperCandidates(entry, 'darwin', 'arm64')).toEqual([
      '/repo/node_modules/node-pty/build/Release/spawn-helper',
      '/repo/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'
    ])
  })

  it('maps asar paths to app.asar.unpacked candidates', () => {
    const entry = '/App/Contents/Resources/app.asar/node_modules/node-pty/lib/index.js'

    expect(nodePtySpawnHelperCandidates(entry, 'darwin', 'arm64')).toEqual([
      '/App/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper',
      '/App/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'
    ])
  })

  it('keeps already-unpacked asar paths stable', () => {
    const entry = '/App/Contents/Resources/app.asar.unpacked/node_modules/node-pty/lib/index.js'

    expect(nodePtySpawnHelperCandidates(entry, 'darwin', 'arm64')).toEqual([
      '/App/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper',
      '/App/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'
    ])
  })

  it('adds execute bits to an existing helper without changing readable bits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'node-pty-helper-'))
    const helper = join(dir, 'spawn-helper')
    writeFileSync(helper, 'binary')
    chmodSync(helper, 0o644)

    expect(ensureExecutableBit(helper)).toBe(true)
    expect(statSync(helper).mode & 0o777).toBe(0o755)
    expect(ensureExecutableBit(helper)).toBe(false)
  })

  it('fills missing group and other execute bits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'node-pty-helper-'))
    const helper = join(dir, 'spawn-helper')
    writeFileSync(helper, 'binary')
    chmodSync(helper, 0o744)

    expect(ensureExecutableBit(helper)).toBe(true)
    expect(statSync(helper).mode & 0o777).toBe(0o755)
  })
})
