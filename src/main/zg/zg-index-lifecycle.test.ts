import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isZgAvailable: vi.fn(), runZg: vi.fn(), runZgStream: vi.fn()
}))
vi.mock('./zg-runtime', () => mocks)

import { ensureZgIndex, resetZgSearchStateForTests, summarizeZgIndexError, zgIndexBuild, zgIndexError, zgIndexState } from './zg-search'

describe('zg index failure state', () => {
  let root: string

  beforeEach(() => {
    vi.resetAllMocks()
    resetZgSearchStateForTests()
    root = mkdtempSync(join(tmpdir(), 'zg-index-state-'))
    mocks.isZgAvailable.mockReturnValue(true)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it.each([ensureZgIndex, zgIndexBuild])('exposes a useful error when the packaged CLI is missing', async (build) => {
    mocks.isZgAvailable.mockReturnValue(false)
    await expect(build(root)).resolves.toBe(false)
    expect(zgIndexState(root)).toBe('error')
    expect(zgIndexError(root)).toContain('未找到 zg 运行文件')
    expect(mocks.runZgStream).not.toHaveBeenCalled()
  })

  it('clears the missing-runtime error after a successful retry', async () => {
    mocks.isZgAvailable.mockReturnValue(false)
    await ensureZgIndex(root)
    mocks.isZgAvailable.mockReturnValue(true)
    mocks.runZgStream.mockResolvedValue({ code: 0, stdout: '', stderr: '', killed: false })
    await expect(ensureZgIndex(root)).resolves.toBe(true)
    expect(zgIndexError(root)).toBeUndefined()
    expect(zgIndexState(root)).toBe('idle')
  })

  it('surfaces the process launch error and releases building state', async () => {
    mocks.runZgStream.mockResolvedValue({ code: 1, stdout: '', stderr: 'ENOENT: spawn Electron ENOENT', killed: false })
    await expect(ensureZgIndex(root)).resolves.toBe(false)
    expect(zgIndexError(root)).toContain('ENOENT')
    expect(zgIndexState(root)).toBe('error')
  })

  it('keeps the missing module error instead of the trailing Node version', async () => {
    const stderr = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from /app/zg/schemas.js\n    at packageResolve (node:internal/modules/esm/resolve:778:12)\n}\nNode.js v22.22.3"
    mocks.runZgStream.mockResolvedValue({ code: 1, stdout: '', stderr, killed: false })
    await expect(ensureZgIndex(root)).resolves.toBe(false)
    expect(zgIndexError(root)).toContain("Cannot find package 'zod'")
    expect(zgIndexError(root)).not.toContain('Node.js v22')
  })

  it('explains Node 20 module resolution assertions and killed index builds', () => {
    expect(summarizeZgIndexError('Error [ERR_INTERNAL_ASSERTION]: Code: ERR_MODULE_NOT_FOUND;\n}\nNode.js v20.18.1', 1)).toContain('依赖模块缺失')
    expect(summarizeZgIndexError('Scanning files...', 1, true)).toContain('超时')
  })
})
