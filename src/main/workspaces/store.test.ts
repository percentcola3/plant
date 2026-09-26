import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electronPaths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData }
}))

import { WorkspacesStore, _testOnlyResetSharedCache } from './store'
import { workspacesJsonPath } from './paths'

const sample = (overrides: Partial<Parameters<WorkspacesStore['add']>[0]> = {}) => ({
  id: 'w-1',
  kind: 'project' as const,
  name: 'demo',
  path: '/tmp/demo',
  defaultBranch: 'main',
  addedAt: '2026-06-09T00:00:00.000Z',
  lastActiveAt: '2026-06-09T00:00:00.000Z',
  ...overrides
})

let isolation = Promise.resolve()

async function withStore<T>(run: (store: WorkspacesStore) => Promise<T>): Promise<T> {
  const previous = isolation
  let release!: () => void
  isolation = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    electronPaths.userData = await mkdtemp(join(tmpdir(), 'workspace-store-test-'))
    _testOnlyResetSharedCache()
    await fs.rm(workspacesJsonPath(), { force: true })
    const store = new WorkspacesStore()
    for (const ws of await store.list()) {
      await store.remove(ws.id)
    }
    return await run(store)
  } finally {
    _testOnlyResetSharedCache()
    await fs.rm(electronPaths.userData, { recursive: true, force: true }).catch(() => undefined)
    release()
  }
}

describe.sequential('WorkspacesStore', () => {
  it('list 返回空数组当 workspaces.json 不存在', async () => {
    await withStore(async (s) => {
      expect(await s.list()).toEqual([])
      expect(await s.activeId()).toBeNull()
    })
  })

  it('add → list 包含新条目，activeId 自动指向新增项', async () => {
    await withStore(async (s) => {
      await s.add(sample())
      const all = await s.list()
      expect(all).toHaveLength(1)
      expect(all[0].id).toBe('w-1')
      expect(await s.activeId()).toBe('w-1')
    })
  })

  it('add 重复 id 抛错', async () => {
    await withStore(async (s) => {
      await s.add(sample())
      await expect(s.add(sample())).rejects.toThrow(/already exists/)
    })
  })

  it('findByPath 命中', async () => {
    await withStore(async (s) => {
      await s.add(sample({ id: 'w-2', path: '/abs/p' }))
      expect((await s.findByPath('/abs/p'))?.id).toBe('w-2')
      expect(await s.findByPath('/missing')).toBeNull()
    })
  })

  it('remove 后 activeId 切到下一个；最后一个被删则置 null', async () => {
    await withStore(async (s) => {
      await s.add(sample({ id: 'a' }))
      await s.add(sample({ id: 'b' }))
      // add 默认 setActive 到新增项 → 当前 active = b
      await s.remove('b')
      expect(await s.activeId()).toBe('a')
      await s.remove('a')
      expect(await s.activeId()).toBeNull()
    })
  })

  it('setActive 更新 lastActiveAt', async () => {
    await withStore(async (s) => {
      await s.add(sample({ lastActiveAt: '2020-01-01T00:00:00.000Z' }))
      await s.setActive('w-1')
      const w = await s.findById('w-1')
      expect(w?.lastActiveAt.startsWith('20')).toBe(true)
      expect(w?.lastActiveAt).not.toBe('2020-01-01T00:00:00.000Z')
    })
  })

  it('setActive 不存在的 id 抛错', async () => {
    await withStore(async (s) => {
      await expect(s.setActive('missing')).rejects.toThrow()
    })
  })

  it('updateWorkspace 不允许覆盖 id', async () => {
    await withStore(async (s) => {
      await s.add(sample())
      await s.updateWorkspace('w-1', { id: 'evil', name: 'new-name' } as Parameters<WorkspacesStore['updateWorkspace']>[1])
      const w = await s.findById('w-1')
      expect(w?.id).toBe('w-1')
      expect(w?.name).toBe('new-name')
    })
  })

  it('落盘后再次 load 还能读出来', async () => {
    await withStore(async (s1) => {
      await s1.add(sample())
      _testOnlyResetSharedCache()
      const s2 = new WorkspacesStore()
      expect(await s2.list()).toHaveLength(1)
    })
  })

  it('list 默认返回全部（含历史 hidden space）；visibleOnly 才过滤', async () => {
    await withStore(async (s) => {
      await s.add(sample({ id: 'visible-1' }))
      await s.add(sample({ id: 'hidden-space', hidden: 'space', parentWorkspaceId: 'visible-1' }))
      const all = await s.list()
      expect(all.map((w) => w.id).sort()).toEqual(['hidden-space', 'visible-1'])
      const visibleOnly = await s.list({ visibleOnly: true })
      expect(visibleOnly.map((w) => w.id)).toEqual(['visible-1'])
    })
  })

  it('启动迁移会移除历史 AI task 派生 workspace，并把 active 切回 parent', async () => {
    await withStore(async (s) => {
      // 手工写一份 v1 格式的 workspaces.json 模拟老数据
      _testOnlyResetSharedCache()
      const legacy = {
        schemaVersion: 1,
        activeWorkspaceId: 'b-hidden',
        workspaces: [
          { ...sample({ id: 'a' }) },
          {
            ...sample({ id: 'b-hidden' }),
            hidden: true,
            baseWorkspaceId: 'a',
            aiTaskId: 'task-old'
          }
        ]
      }
      await fs.mkdir(join(electronPaths.userData), { recursive: true }).catch(() => undefined)
      await fs.writeFile(workspacesJsonPath(), JSON.stringify(legacy), 'utf-8')
      const s2 = new WorkspacesStore()
      const all = await s2.list()
      expect(all.map((w) => w.id)).toEqual(['a'])
      expect(await s2.findById('b-hidden')).toBeNull()
      expect(await s2.activeId()).toBe('a')
      expect((await s2.list({ visibleOnly: true })).map((w) => w.id)).toEqual(['a'])

      _testOnlyResetSharedCache()
      const s3 = new WorkspacesStore()
      expect(await s3.activeId()).toBe('a')
      expect((await s3.list()).map((w) => w.id)).toEqual(['a'])
      void s
    })
  })

  it('启动迁移会把 active hidden space 切回 parent，并保留该 space 的 worktree 路径', async () => {
    await withStore(async (s) => {
      _testOnlyResetSharedCache()
      const legacy = {
        schemaVersion: 2,
        activeWorkspaceId: 'space-b',
        workspaces: [
          { ...sample({ id: 'a', path: '/repo/base' }) },
          {
            ...sample({ id: 'space-b', path: '/repo/space-b' }),
            hidden: 'space',
            parentWorkspaceId: 'a',
            spaceSlug: 'b'
          }
        ]
      }
      await fs.mkdir(join(electronPaths.userData), { recursive: true }).catch(() => undefined)
      await fs.writeFile(workspacesJsonPath(), JSON.stringify(legacy), 'utf-8')
      const s2 = new WorkspacesStore()
      expect(await s2.activeId()).toBe('a')
      expect((await s2.findById('a'))?.path).toBe('/repo/space-b')

      _testOnlyResetSharedCache()
      const s3 = new WorkspacesStore()
      expect(await s3.activeId()).toBe('a')
      expect((await s3.findById('a'))?.path).toBe('/repo/space-b')
      void s
    })
  })
})
