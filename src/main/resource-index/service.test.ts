import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronPaths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData }
}))

type EnsureZgIndexImpl = (
  root: string,
  opts?: { force?: boolean; onProgress?: (p: { phase: string; percent?: number }) => void }
) => Promise<boolean>
const ensureZgIndexMock = vi.hoisted(() => vi.fn<EnsureZgIndexImpl>(async () => true))
const zgIndexStatsMock = vi.hoisted(() => vi.fn(async () => ({
  filesIndexed: 3,
  filesTotal: 3,
  entities: 42,
  embedding: 'local/potion-code-16m-v2',
  queuePending: 0
})))
vi.mock('../zg/zg-search', () => ({
  ensureZgIndex: ensureZgIndexMock,
  zgIndexStats: zgIndexStatsMock,
  zgIndexError: vi.fn(() => undefined)
}))

import type { ExternalRef } from '@shared/types'
import { buildResourceIndex, readResourceIndexStatusLive } from './service'
import { resourceIndexStatusPath } from './paths'

let sourceDir: string

function ref(category: ExternalRef['category'] = 'uikit'): ExternalRef {
  return {
    id: 'resource-1',
    alias: category === 'uikit' ? 'design-assets' : 'product-docs',
    kind: 'local',
    category,
    source: sourceDir,
    poolPath: sourceDir,
    addedAt: '2026-07-21T00:00:00.000Z'
  }
}

beforeEach(async () => {
  electronPaths.userData = await mkdtemp(join(tmpdir(), 'resource-index-data-'))
  sourceDir = await mkdtemp(join(tmpdir(), 'resource-index-source-'))
  ensureZgIndexMock.mockClear().mockResolvedValue(true)
  zgIndexStatsMock.mockClear().mockResolvedValue({
    filesIndexed: 3,
    filesTotal: 3,
    entities: 42,
    embedding: 'local/potion-code-16m-v2',
    queuePending: 0
  })
})

afterEach(async () => {
  await fs.rm(sourceDir, { recursive: true, force: true })
  await fs.rm(electronPaths.userData, { recursive: true, force: true })
})

describe('resource index（zg 混合索引状态跟踪）', () => {
  it('构建 = 触发 zg 索引（manual 强制重建），ready 状态带覆盖率与模型信息', async () => {
    const status = await buildResourceIndex(ref(), 'manual')

    expect(ensureZgIndexMock).toHaveBeenCalledWith(sourceDir, expect.objectContaining({ force: true }))
    expect(status).toMatchObject({
      state: 'ready',
      fileCount: 3,
      engine: 'zg',
      embedding: 'local/potion-code-16m-v2',
      entities: 42
    })
    expect(status.message).toContain('zg 混合索引')
    expect(status.message).toContain('potion-code-16m-v2')
    await expect(fs.readFile(resourceIndexStatusPath('resource-1'), 'utf-8'))
      .resolves.toContain('"state": "ready"')
  })

  it('zg 构建失败 → error 状态携带真实原因 + 回退提示', async () => {
    ensureZgIndexMock.mockResolvedValue(false)
    const status = await buildResourceIndex(ref('knowledge'), 'first-import')

    expect(status.state).toBe('error')
    expect(status.message).toContain('zg 索引构建失败')
    expect(status.message).toContain('回退文本匹配')
  })

  it('非 manual/git-update 的触发不强制重建（尊重冷却）', async () => {
    await buildResourceIndex(ref(), 'missing-index')
    expect(ensureZgIndexMock).toHaveBeenCalledWith(sourceDir, expect.objectContaining({ force: false }))
  })

  it('构建期 onProgress 节流落盘为 building + progress 阶段', async () => {
    ensureZgIndexMock.mockImplementation(async (_root, opts) => {
      opts?.onProgress?.({ phase: 'scan' })
      opts?.onProgress?.({ phase: 'model', percent: 40 })
      opts?.onProgress?.({ phase: 'index' })
      return true
    })
    await buildResourceIndex(ref(), 'manual')
    // 最终 ready（最后一次 progress 之后 ready 覆写状态）
    const raw = JSON.parse(await fs.readFile(resourceIndexStatusPath('resource-1'), 'utf-8'))
    expect(raw.state).toBe('ready')
    // onProgress 确实被传入（阶段回调链路接通）
    expect(ensureZgIndexMock.mock.calls[0]?.[1]?.onProgress).toBeTypeOf('function')
  })

  it('daemon 有向量补齐队列时写入 enhancing（含 total 供百分比计算）', async () => {
    zgIndexStatsMock.mockResolvedValue({ filesIndexed: 3, filesTotal: 3, entities: 42, queuePending: 1204, embedding: 'local/potion-code-16m-v2' })
    const status = await buildResourceIndex(ref(), 'first-import')
    expect(status.state).toBe('ready')
    expect(status.enhancing).toEqual({ pending: 1204, total: 1204 })
  })

  it('readResourceIndexStatusLive：enhancing 归零后清除标记，期间保留 total', async () => {
    zgIndexStatsMock.mockResolvedValue({ filesIndexed: 3, filesTotal: 3, entities: 42, queuePending: 1204, embedding: 'local/potion-code-16m-v2' })
    await buildResourceIndex(ref(), 'first-import')

    // pending 下降 → 刷新数值且保留 total（面板可算 75% 完成）
    zgIndexStatsMock.mockResolvedValue({ filesIndexed: 3, filesTotal: 3, entities: 42, queuePending: 300, embedding: 'local/potion-code-16m-v2' })
    const enhancing = await readResourceIndexStatusLive('resource-1', sourceDir)
    expect(enhancing.enhancing).toEqual({ pending: 300, total: 1204 })

    // pending 归零 → 清除
    zgIndexStatsMock.mockResolvedValue({ filesIndexed: 3, filesTotal: 3, entities: 42, queuePending: 0, embedding: 'local/potion-code-16m-v2' })
    const cleared = await readResourceIndexStatusLive('resource-1', sourceDir)
    expect(cleared.enhancing).toBeUndefined()
    // 持久化同步清除
    const raw = JSON.parse(await fs.readFile(resourceIndexStatusPath('resource-1'), 'utf-8'))
    expect(raw.enhancing).toBeUndefined()
  })

  it('readResourceIndexStatusLive：无 enhancing 且已有 zg 证据时零开销直接返回', async () => {
    await buildResourceIndex(ref(), 'manual')
    zgIndexStatsMock.mockClear()
    const status = await readResourceIndexStatusLive('resource-1', sourceDir)
    expect(status.enhancing).toBeUndefined()
    expect(status.engine).toBe('zg')
    expect(zgIndexStatsMock).not.toHaveBeenCalled()
  })

  it('readResourceIndexStatusLive：旧 status 缺 engine 时补齐 zg 证据', async () => {
    await fs.mkdir(electronPaths.userData, { recursive: true })
    const statusPath = resourceIndexStatusPath('resource-1')
    await fs.mkdir(join(statusPath, '..'), { recursive: true })
    await fs.writeFile(statusPath, JSON.stringify({
      externalRefId: 'resource-1',
      state: 'ready',
      fileCount: 2323,
      updatedAt: '2026-09-01T00:00:00.000Z'
    }), 'utf-8')

    const status = await readResourceIndexStatusLive('resource-1', sourceDir)
    expect(status.engine).toBe('zg')
    expect(status.embedding).toBe('local/potion-code-16m-v2')
    expect(status.entities).toBe(42)
    expect(zgIndexStatsMock).toHaveBeenCalled()
  })
})
