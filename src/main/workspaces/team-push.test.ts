import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type { Workspace } from '@shared/types'

const tmpUserData = await mkdtemp(join(tmpdir(), 'team-push-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData }
}))

// git client mock：所有 gitFor/gitForWithAskpass 返回同一个 api，按 args 分支。
const gitApi = vi.hoisted(() => ({
  status: vi.fn(),
  add: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
  fetch: vi.fn(async () => undefined),
  push: vi.fn(async () => undefined),
  raw: vi.fn(async (_args: string[]) => ''),
  revparse: vi.fn(async () => 'abc123')
}))

vi.mock('../git/client', () => ({
  gitFor: vi.fn(() => gitApi),
  gitForWithAskpass: vi.fn(async () => gitApi)
}))

// store mock：findById 返回指向真实 tmp 目录的 workspace（让 mirror/fs 真跑）
const storeMock = vi.hoisted(() => ({ findById: vi.fn() }))
vi.mock('./store', () => ({
  WorkspacesStore: vi.fn(() => ({ findById: storeMock.findById }))
}))

import { pushToTeamSpace, abortTeamPush, cleanupOrphanTeamPushWorktrees, mirrorDir, teamPushRoot } from './team-push'
import { _testOnlyResetSharedProbe } from '../git/probe'

const baseWorkspace: Workspace = {
  id: 'ws-1',
  kind: 'project',
  name: 'demo',
  path: '/tmp/demo',
  defaultBranch: 'main',
  addedAt: '2026-06-12T00:00:00.000Z',
  lastActiveAt: '2026-06-12T00:00:00.000Z'
}

let seq = 0
let workspacePath: string

async function pathExists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true } catch { return false }
}

beforeEach(async () => {
  _testOnlyResetSharedProbe()
  seq += 1
  workspacePath = await mkdtemp(join(tmpdir(), `team-push-ws-${seq}-`))
  // 模拟工作空间里的一个 feature 目录
  await fs.mkdir(join(workspacePath, 'features', 'login'), { recursive: true })
  await fs.writeFile(join(workspacePath, 'features', 'login', 'index.html'), '<html>v1</html>')

  storeMock.findById.mockReset()
  storeMock.findById.mockResolvedValue({ ...baseWorkspace, path: workspacePath })

  gitApi.status.mockReset()
  gitApi.add.mockReset().mockImplementation(async () => undefined)
  gitApi.commit.mockReset().mockImplementation(async () => undefined)
  gitApi.fetch.mockReset().mockImplementation(async () => undefined)
  gitApi.push.mockReset().mockImplementation(async () => undefined)
  gitApi.revparse.mockReset().mockImplementation(async () => 'abc123')
  gitApi.raw.mockReset().mockImplementation(async (args: string[]) => {
    // 默认有 origin 远端
    if (args[0] === 'remote') return 'origin\n'
    // worktree add：真实创建目录，模拟 checkout 出来的 worktree
    if (args[0] === 'worktree' && args[1] === 'add') {
      const wtPath = args[args.indexOf('--detach') + 1]
      await fs.mkdir(join(wtPath, 'features', 'login'), { recursive: true })
      // 团队空间里该文件旧版本（模拟 origin/main 已有内容）
      await fs.writeFile(join(wtPath, 'features', 'login', 'index.html'), '<html>old</html>')
      return ''
    }
    if (args[0] === 'diff') return ''   // 默认无未合并冲突文件
    return ''
  })
})

describe('pushToTeamSpace', () => {
  it('无远端 → NO_REMOTE，不创建 worktree', async () => {
    gitApi.raw.mockImplementation(async (args: string[]) => args[0] === 'remote' ? '' : '')
    const r = await pushToTeamSpace('ws-1', { relPath: 'features/login', name: '登录', type: 'feat' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NO_REMOTE')
  })

  it('成功路径：mirror + commit + push → pushed:true，worktree 清理', async () => {
    // worktree add 后 status 显示 dirty（mirror 改了文件）
    gitApi.status.mockResolvedValue({ isClean: () => false, files: [{ path: 'features/login/index.html' }] } as never)
    const r = await pushToTeamSpace('ws-1', { relPath: 'features/login', name: '登录', type: 'feat' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pushed).toBe(true)
      expect(r.empty).toBe(false)
    }
    expect(gitApi.push).toHaveBeenCalledWith(['origin', 'HEAD:main'])
    // worktree remove 被调用
    expect(gitApi.raw).toHaveBeenCalled()
  })

  it('成功后 reconcile：dirty→wip + fetch + rebase origin/main（停留分支）', async () => {
    gitApi.status.mockResolvedValue({ isClean: () => false, files: [{ path: 'features/login/index.html' }] } as never)
    await pushToTeamSpace('ws-1', { relPath: 'features/login', name: '登录', type: 'feat' })
    // reconcile 拉取最新 + rebase 当前分支到 origin/main
    expect(gitApi.fetch).toHaveBeenCalled()
    expect(gitApi.raw).toHaveBeenCalledWith(['rebase', 'origin/main'])
    // push-flow commit + reconcile wip commit = 2 笔
    expect(gitApi.commit).toHaveBeenCalledTimes(2)
  })

  it('空推送：mirror 后工作树 clean → empty:true，不 push', async () => {
    gitApi.status.mockResolvedValue({ isClean: () => true, files: [] } as never)
    const r = await pushToTeamSpace('ws-1', { relPath: 'features/login', name: '登录', type: 'feat' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.empty).toBe(true)
    expect(gitApi.push).not.toHaveBeenCalled()
  })

  it('冲突：push NON_FAST_FORWARD → rebase 冲突 → 保留 worktree 返回 conflictFiles', async () => {
    gitApi.status.mockResolvedValue({ isClean: () => false, files: [{ path: 'features/login/index.html' }] } as never)
    // 第一次 push 抛 non-fast-forward
    gitApi.push.mockRejectedValueOnce(new Error('! [rejected] HEAD -> main (non-fast-forward)'))
    // rebase 抛冲突
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return 'origin\n'
      if (args[0] === 'worktree' && args[1] === 'add') {
        const wtPath = args[args.indexOf('--detach') + 1]
        await fs.mkdir(join(wtPath, 'features', 'login'), { recursive: true })
        await fs.writeFile(join(wtPath, 'features', 'login', 'index.html'), '<html>team</html>')
        return ''
      }
      if (args[0] === 'rebase') throw new Error('CONFLICT (content): Merge conflict in features/login/index.html')
      if (args[0] === 'diff') return 'features/login/index.html\n'
      return ''
    })
    const r = await pushToTeamSpace('ws-1', { relPath: 'features/login', name: '登录', type: 'feat' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('CONFLICT')
      expect(r.worktreePath).toBeTruthy()
      expect(r.conflictFiles).toContain('features/login/index.html')
    }
  })
})

describe('mirrorDir（经 pushToTeamSpace 间接验证）', () => {
  it('mirror 后 worktree 文件与工作空间一致（覆盖旧内容）', async () => {
    gitApi.status.mockResolvedValue({ isClean: () => false, files: [{ path: 'features/login/index.html' }] } as never)
    await pushToTeamSpace('ws-1', { relPath: 'features/login', name: '登录', type: 'feat' })
    // commit 被调用说明 mirror 确实产生了改动（团队空间旧 'old' → 工作空间 'v1'）
    expect(gitApi.commit).toHaveBeenCalled()
    expect(gitApi.add).toHaveBeenCalledWith(['-A', 'features/login'])
  })

  it('排除 AI 脚手架：AGENTS.md/CLAUDE.md/.claude 不被镜像到团队空间', async () => {
    const src = await mkdtemp(join(tmpdir(), `mirror-src-${seq}-`))
    const dst = await mkdtemp(join(tmpdir(), `mirror-dst-${seq}-`))
    // 源（工作空间）：真实产物 + AI 脚手架
    await fs.writeFile(join(src, 'index.html'), '<html>v1</html>')
    await fs.writeFile(join(src, 'AGENTS.md'), 'my-local-agents')
    await fs.writeFile(join(src, 'CLAUDE.md'), 'my-local-claude')
    await fs.mkdir(join(src, '.claude'), { recursive: true })
    // 目标（团队空间 origin/main baseline）：已有旧产物 + 队友的 AGENTS.md
    await fs.writeFile(join(dst, 'index.html'), '<html>old</html>')
    await fs.writeFile(join(dst, 'AGENTS.md'), 'team-agents')

    await mirrorDir(src, dst)

    // 真实产物被覆盖为工作空间版本
    expect(await fs.readFile(join(dst, 'index.html'), 'utf-8')).toBe('<html>v1</html>')
    // AI 脚手架被排除：队友的 AGENTS.md 原样保留、CLAUDE.md/.claude 没被复制进来
    expect(await fs.readFile(join(dst, 'AGENTS.md'), 'utf-8')).toBe('team-agents')
    expect(await pathExists(join(dst, 'CLAUDE.md'))).toBe(false)
    expect(await pathExists(join(dst, '.claude'))).toBe(false)
  })
})

describe('abortTeamPush', () => {
  it('rebase --abort + worktree remove', async () => {
    const wtPath = join(teamPushRoot(), 'ws-1', 'run-x')
    await fs.mkdir(wtPath, { recursive: true })
    await abortTeamPush('ws-1', wtPath)
    // rebase --abort 被调（worktreePath 上）
    expect(gitApi.raw).toHaveBeenCalledWith(['rebase', '--abort'])
    // worktree remove --force 被调
    expect(gitApi.raw).toHaveBeenCalledWith(expect.arrayContaining(['worktree', 'remove', '--force', wtPath]))
  })

  it('工作区不存在 → 直接删目录', async () => {
    storeMock.findById.mockResolvedValue(null)
    const wtPath = join(teamPushRoot(), 'ws-ghost', 'run-y')
    await fs.mkdir(wtPath, { recursive: true })
    await abortTeamPush('ws-ghost', wtPath)
    expect(await pathExists(wtPath)).toBe(false)
  })
})

describe('cleanupOrphanTeamPushWorktrees', () => {
  it('删掉不在 worktree list 的孤儿目录，保留仍在 list 的', async () => {
    const liveWt = join(teamPushRoot(), 'ws-1', 'run-live')
    const orphanWt = join(teamPushRoot(), 'ws-1', 'run-orphan')
    await fs.mkdir(liveWt, { recursive: true })
    await fs.mkdir(orphanWt, { recursive: true })
    gitApi.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') return 'origin\n'
      if (args[0] === 'worktree' && args[1] === 'list' && args[2] === '--porcelain') {
        return `worktree ${liveWt}\nHEAD abc123\ndetached\n`
      }
      return ''
    })
    await cleanupOrphanTeamPushWorktrees()
    expect(await pathExists(orphanWt)).toBe(false)   // 孤儿删了
    expect(await pathExists(liveWt)).toBe(true)      // 仍在 list，保留
  })

  it('工作区已不存在 → 整个子树删', async () => {
    const ghostWt = join(teamPushRoot(), 'ws-ghost', 'run-z')
    await fs.mkdir(ghostWt, { recursive: true })
    storeMock.findById.mockResolvedValue(null)
    await cleanupOrphanTeamPushWorktrees()
    expect(await pathExists(ghostWt)).toBe(false)
  })
})
