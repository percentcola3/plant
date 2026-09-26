import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { simpleGit } from 'simple-git'
import type { GitPushSummary } from '../../shared/git-push-summary'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => tmpdir() }
}))

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return {
    ...actual,
    gitForWithAskpass: async (cwd: string) => actual.gitFor(cwd)
  }
})

vi.mock('./push-summary-ai', () => ({
  summarizePush: async (evidence: { record: GitPushSummary }) => evidence.record
}))

import { isPathInsideRelDir, submitFeatureDir } from './submit-feature'
import { _testOnlyResetSharedProbe } from './probe'

const roots: string[] = []
afterEach(async () => {
  _testOnlyResetSharedProbe()
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('isPathInsideRelDir', () => {
  it('matches the feature directory and its files only', () => {
    expect(isPathInsideRelDir('features/POS-64位系统/doc/a.md', 'features/POS-64位系统')).toBe(true)
    expect(isPathInsideRelDir('features/POS-64位系统', 'features/POS-64位系统')).toBe(true)
    expect(isPathInsideRelDir('features/other/doc.md', 'features/POS-64位系统')).toBe(false)
    expect(isPathInsideRelDir('features/POS-64位系统-old/a.md', 'features/POS-64位系统')).toBe(false)
    expect(isPathInsideRelDir('"features/POS-64位系统/doc/a.md"', 'features/POS-64位系统')).toBe(true)
    expect(isPathInsideRelDir('features/POS-64位系统/doc/a.md'.normalize('NFD'), 'features/POS-64位系统')).toBe(true)
  })
})

describe('submitFeatureDir', () => {
  it('commits and pushes only files under the current feature directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'submit-feature-'))
    roots.push(root)
    const bare = join(root, 'remote.git')
    const ws = join(root, 'ws')
    await mkdir(bare)
    await mkdir(join(ws, 'features/keep'), { recursive: true })
    await mkdir(join(ws, 'features/submit-me'), { recursive: true })
    await simpleGit(bare).raw(['init', '--bare', '--initial-branch=main'])
    const git = simpleGit(ws)
    await git.raw(['init', '--initial-branch=main'])
    await git.addConfig('user.name', 'Alice')
    await git.addConfig('user.email', 'alice@example.com')
    await writeFile(join(ws, 'features/keep/a.md'), 'keep-1')
    await writeFile(join(ws, 'features/submit-me/a.md'), 'submit-1')
    await git.add('.')
    await git.commit('initial')
    await git.addRemote('origin', bare)
    await git.push(['-u', 'origin', 'main'])

    await writeFile(join(ws, 'features/keep/a.md'), 'keep-2')
    await writeFile(join(ws, 'features/submit-me/a.md'), 'submit-2')
    await mkdir(join(ws, 'features/submit-me/doc'))
    await writeFile(join(ws, 'features/submit-me/doc/新增文档.md'), 'new document')

    const result = await submitFeatureDir({
      workspacePath: ws,
      defaultBranch: 'main',
      relDir: 'features/submit-me'
    })

    expect(result.committed).toBe(true)
    expect(result.pushed).toBe(true)
    expect(result.fileCount).toBe(2)
    const status = await git.status()
    expect(status.files.map((file) => file.path)).toEqual(['features/keep/a.md'])
    const log = await git.log({ maxCount: 1 })
    expect(log.latest?.message).toBe('提交 submit-me')
  })

  it('commits unicode feature paths even when status path quoting differs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'submit-feature-cn-'))
    roots.push(root)
    const bare = join(root, 'remote.git')
    const ws = join(root, 'ws')
    await mkdir(bare)
    await mkdir(join(ws, 'features/POS-64位系统/doc'), { recursive: true })
    await simpleGit(bare).raw(['init', '--bare', '--initial-branch=main'])
    const git = simpleGit(ws)
    await git.raw(['init', '--initial-branch=main'])
    await git.addConfig('user.name', 'Alice')
    await git.addConfig('user.email', 'alice@example.com')
    await writeFile(join(ws, 'features/POS-64位系统/doc/方案.md'), 'old')
    await git.add('.')
    await git.commit('initial')
    await git.addRemote('origin', bare)
    await git.push(['-u', 'origin', 'main'])

    await writeFile(join(ws, 'features/POS-64位系统/doc/方案.md'), 'new')

    const result = await submitFeatureDir({
      workspacePath: ws,
      defaultBranch: 'main',
      relDir: 'features/POS-64位系统'
    })

    expect(result.committed).toBe(true)
    expect(result.fileCount).toBe(1)
    const status = await git.status()
    expect(status.files).toEqual([])
  })

  it('returns a successful no-op when auto-save has already submitted the changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'submit-feature-empty-'))
    roots.push(root)
    const bare = join(root, 'remote.git')
    const ws = join(root, 'ws')
    await mkdir(bare)
    await mkdir(join(ws, 'features/submit-me'), { recursive: true })
    await simpleGit(bare).raw(['init', '--bare', '--initial-branch=main'])
    const git = simpleGit(ws)
    await git.raw(['init', '--initial-branch=main'])
    await git.addConfig('user.name', 'Alice')
    await git.addConfig('user.email', 'alice@example.com')
    await writeFile(join(ws, 'features/submit-me/a.md'), 'submit-1')
    await git.add('.')
    await git.commit('initial')
    await git.addRemote('origin', bare)
    await git.push(['-u', 'origin', 'main'])

    await expect(submitFeatureDir({
      workspacePath: ws,
      defaultBranch: 'main',
      relDir: 'features/submit-me'
    })).resolves.toEqual({ committed: false, pushed: false, fileCount: 0 })
  })
})
