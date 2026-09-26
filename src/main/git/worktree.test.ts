import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const gitApi = vi.hoisted(() => ({
  raw: vi.fn(async (_args: string[]) => '')
}))

vi.mock('./client', () => ({
  gitFor: vi.fn(() => gitApi)
}))

import { addWorktree, removeWorktree, listWorktrees, parseWorktreePorcelain } from './worktree'

beforeEach(() => {
  gitApi.raw.mockReset()
  gitApi.raw.mockResolvedValue('')
})

describe('addWorktree 命令拼装', () => {
  it('已有本地分支：worktree add <path> <branch>', async () => {
    await addWorktree({ repoPath: '/repo', targetPath: '/tmp/wt', branch: 'space/eric' })
    expect(gitApi.raw).toHaveBeenCalledWith(['worktree', 'add', '/tmp/wt', 'space/eric'])
  })

  it('新建分支从 HEAD：worktree add -b <branch> <path> HEAD', async () => {
    await addWorktree({ repoPath: '/repo', targetPath: '/tmp/wt', branch: 'ai/uuid', createBranch: true, from: 'HEAD' })
    expect(gitApi.raw).toHaveBeenCalledWith(['worktree', 'add', '-b', 'ai/uuid', '/tmp/wt', 'HEAD'])
  })

  it('新建分支追踪 origin：worktree add -b <branch> <path> origin/<branch>', async () => {
    await addWorktree({ repoPath: '/repo', targetPath: '/tmp/wt', branch: 'space/bob', createBranch: true, from: 'origin/space/bob' })
    expect(gitApi.raw).toHaveBeenCalledWith(['worktree', 'add', '-b', 'space/bob', '/tmp/wt', 'origin/space/bob'])
  })

  it('detached 从 origin/main：worktree add --detach <path> origin/main', async () => {
    await addWorktree({ repoPath: '/repo', targetPath: '/tmp/wt', detach: true, from: 'origin/main' })
    expect(gitApi.raw).toHaveBeenCalledWith(['worktree', 'add', '--detach', '/tmp/wt', 'origin/main'])
  })

  it('--force 前置', async () => {
    await addWorktree({ repoPath: '/repo', targetPath: '/tmp/wt', branch: 'x', force: true })
    expect(gitApi.raw).toHaveBeenCalledWith(['worktree', 'add', '--force', '/tmp/wt', 'x'])
  })

  it('createBranch=true 但缺 branch 抛错', async () => {
    await expect(addWorktree({ repoPath: '/repo', targetPath: '/tmp/wt', createBranch: true })).rejects.toThrow(
      /createBranch=true 时必须指定 branch/
    )
  })

  it('在调用 git 之前确保父目录存在', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'wt-mkdir-'))
    const nested = join(parent, 'child-that-does-not-exist', 'wt')
    await addWorktree({ repoPath: '/repo', targetPath: nested, branch: 'x' })
    // dirname(nested) 应被创建
    const stat = await fs.stat(join(parent, 'child-that-does-not-exist'))
    expect(stat.isDirectory()).toBe(true)
  })
})

describe('removeWorktree', () => {
  it('先跑 git worktree remove --force 再 fs.rm', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wt-remove-'))
    await fs.writeFile(join(dir, 'foo.txt'), 'hi')
    await removeWorktree('/repo', dir)
    expect(gitApi.raw).toHaveBeenCalledWith(['worktree', 'remove', '--force', dir])
    // fs.rm 兜底
    await expect(fs.stat(dir)).rejects.toThrow()
  })

  it('git 报错也继续走 fs.rm', async () => {
    gitApi.raw.mockRejectedValueOnce(new Error('unknown worktree'))
    const dir = await mkdtemp(join(tmpdir(), 'wt-remove-fallback-'))
    await removeWorktree('/repo', dir)
    await expect(fs.stat(dir)).rejects.toThrow()
  })
})

describe('parseWorktreePorcelain', () => {
  it('解析主 worktree + 附加 worktree + detached', () => {
    const out = [
      'worktree /path/to/main',
      'HEAD abcd1234',
      'branch refs/heads/main',
      '',
      'worktree /path/to/space',
      'HEAD deadbeef',
      'branch refs/heads/space/eric',
      '',
      'worktree /path/to/detached',
      'HEAD 5555abcd',
      'detached'
    ].join('\n')
    const entries = parseWorktreePorcelain(out)
    expect(entries).toEqual([
      { path: '/path/to/main', head: 'abcd1234', branch: 'main', detached: false, bare: false, locked: false },
      { path: '/path/to/space', head: 'deadbeef', branch: 'space/eric', detached: false, bare: false, locked: false },
      { path: '/path/to/detached', head: '5555abcd', branch: undefined, detached: true, bare: false, locked: false }
    ])
  })

  it('locked / bare 标志识别', () => {
    const out = [
      'worktree /path/to/bare',
      'bare',
      '',
      'worktree /path/to/locked',
      'HEAD abcd',
      'branch refs/heads/x',
      'locked lockreason here'
    ].join('\n')
    const entries = parseWorktreePorcelain(out)
    expect(entries[0]).toMatchObject({ path: '/path/to/bare', bare: true })
    expect(entries[1]).toMatchObject({ path: '/path/to/locked', locked: true, branch: 'x' })
  })

  it('空输入返回空数组', () => {
    expect(parseWorktreePorcelain('')).toEqual([])
    expect(parseWorktreePorcelain('\n\n')).toEqual([])
  })
})

describe('listWorktrees', () => {
  it('git 抛错返回空数组', async () => {
    gitApi.raw.mockRejectedValueOnce(new Error('not a git repo'))
    const entries = await listWorktrees('/repo')
    expect(entries).toEqual([])
  })

  it('正常返回解析结果', async () => {
    gitApi.raw.mockResolvedValueOnce('worktree /a\nHEAD abcd\nbranch refs/heads/main\n')
    const entries = await listWorktrees('/repo')
    expect(entries).toEqual([{ path: '/a', head: 'abcd', branch: 'main', detached: false, bare: false, locked: false }])
    expect(gitApi.raw).toHaveBeenCalledWith(['worktree', 'list', '--porcelain'])
  })
})
