import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electronPaths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData }
}))

import type { ExternalRef } from '@shared/types'
import { ExternalPoolStore, _testOnlyResetSharedCache } from './store'
import { indexFile } from './paths'
import { UIClientError } from '../ipc/errors'

const sample = (overrides: Partial<ExternalRef> = {}): ExternalRef => ({
  id: 'r-1',
  alias: 'saas-uikit',
  kind: 'git',
  category: 'uikit',
  source: 'git@example.com:org/saas-uikit.git',
  poolPath: '/tmp/r-1',
  addedAt: '2026-06-09T00:00:00.000Z',
  ...overrides
})

let isolation = Promise.resolve()

async function withStore<T>(run: (store: ExternalPoolStore) => Promise<T>): Promise<T> {
  const previous = isolation
  let release!: () => void
  isolation = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    electronPaths.userData = await mkdtemp(join(tmpdir(), 'external-pool-store-test-'))
    _testOnlyResetSharedCache()
    await fs.rm(indexFile(), { force: true })
    const store = new ExternalPoolStore()
    for (const ref of await store.list()) {
      await store.remove(ref.id)
    }
    return await run(store)
  } finally {
    _testOnlyResetSharedCache()
    await fs.rm(electronPaths.userData, { recursive: true, force: true }).catch(() => undefined)
    release()
  }
}

describe.sequential('ExternalPoolStore', () => {
  it('list 返回空数组当索引不存在', async () => {
    await withStore(async (store) => {
      expect(await store.list()).toEqual([])
    })
  })

  it('add → list 包含新条目，落盘', async () => {
    await withStore(async (store) => {
      await store.add(sample())
      const all = await store.list()
      expect(all).toHaveLength(1)
      expect(all[0].alias).toBe('saas-uikit')
      const text = await fs.readFile(indexFile(), 'utf-8')
      expect(text).toContain('saas-uikit')
    })
  })

  it('add 时 alias 重复抛 EXTERNAL_ALIAS_TAKEN', async () => {
    await withStore(async (store) => {
      await store.add(sample())
      await expect(store.add(sample({ id: 'r-2' })))
        .rejects.toMatchObject({ code: 'EXTERNAL_ALIAS_TAKEN' })
    })
  })

  it('add 时 alias 不合法抛 VALIDATION', async () => {
    await withStore(async (store) => {
      await expect(store.add(sample({ alias: 'has space' })))
        .rejects.toBeInstanceOf(UIClientError)
    })
  })

  it('add 时 id 重复抛 VALIDATION', async () => {
    await withStore(async (store) => {
      await store.add(sample())
      await expect(store.add(sample({ alias: 'alt' })))
        .rejects.toMatchObject({ code: 'VALIDATION' })
    })
  })

  it('findByAlias / findById 命中', async () => {
    await withStore(async (store) => {
      await store.add(sample())
      expect((await store.findByAlias('saas-uikit'))?.id).toBe('r-1')
      expect((await store.findById('r-1'))?.alias).toBe('saas-uikit')
    })
  })

  it('remove 不存在的 id 静默', async () => {
    await withStore(async (store) => {
      await store.remove('missing')
      expect(await store.list()).toEqual([])
    })
  })

  it('remove 后 findById 返回 null', async () => {
    await withStore(async (store) => {
      await store.add(sample())
      await store.remove('r-1')
      expect(await store.findById('r-1')).toBeNull()
    })
  })

  it('update 改 lastSyncedAt 但不动 id/alias', async () => {
    await withStore(async (store) => {
      await store.add(sample())
      await store.update('r-1', { lastSyncedAt: '2026-06-10T00:00:00.000Z' })
      const r = await store.findById('r-1')
      expect(r?.lastSyncedAt).toBe('2026-06-10T00:00:00.000Z')
      expect(r?.alias).toBe('saas-uikit')
    })
  })

  it('支持 category=knowledge', async () => {
    await withStore(async (store) => {
      await store.add(sample({ category: 'knowledge', alias: 'prd-spec' }))
      const r = await store.findByAlias('prd-spec')
      expect(r?.category).toBe('knowledge')
    })
  })
})
