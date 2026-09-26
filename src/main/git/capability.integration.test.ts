import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

vi.mock('./client', async () => {
  const { simpleGit } = await import('simple-git')
  const gitFor = (path: string) => simpleGit({ baseDir: path, unsafe: { allowUnsafeConfigPaths: true } })
    .env({ PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' })
  return { gitFor, gitForWithAskpass: async (path: string) => gitFor(path) }
})

vi.mock('../system/ssh', () => ({
  requireSshKeyForRemote: async () => false,
  sshAuthorizationError: () => null,
}))

import { bindGitRepository } from './capability'
import { gitFor } from './client'

let root: string
let remotePath: string
let workspacePath: string

async function writeAt(path: string, relPath: string, content: string): Promise<void> {
  await fs.mkdir(dirname(join(path, relPath)), { recursive: true })
  await fs.writeFile(join(path, relPath), content)
}

async function commitAll(path: string): Promise<void> {
  const git = gitFor(path)
  await git.add('.')
  await git.raw(['-c', 'user.name=Git Bind Test', '-c', 'user.email=git-bind@example.test', 'commit', '--no-gpg-sign', '-m', 'fixture'])
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'git-bind-integration-'))
  remotePath = join(root, 'remote')
  workspacePath = join(root, 'workspace')
  await fs.mkdir(remotePath)
  await fs.mkdir(workspacePath)
  await gitFor(remotePath).init(['--initial-branch=main'])
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('Git binding with real local repositories', () => {
  it('preserves scaffold and user files while importing remote-only files into a new workspace', async () => {
    const collisions = [
      '.gitignore',
      '.workspace/resource-indexes/剪页库/INDEX.md',
      '.workspace/resource-indexes/剪页库/files.jsonl',
      'docs/.gitkeep',
      'requirements/.gitkeep',
      'system.md',
      'ui/.gitkeep',
      'workspace.external.json',
    ]
    for (const path of collisions) {
      await writeAt(remotePath, path, `remote ${path}\n`)
      await writeAt(workspacePath, path, `local ${path}\n`)
    }
    const remoteOnly = 'docs/中文 空格\n新文件.md'
    await writeAt(remotePath, remoteOnly, 'remote document\n')
    await writeAt(workspacePath, 'private-note.txt', 'user-only note\n')
    await commitAll(remotePath)
    const remoteHead = await gitFor(remotePath).revparse(['HEAD'])

    await expect(bindGitRepository(workspacePath, { remoteUrl: remotePath, branch: 'main' }))
      .resolves.toEqual({ state: 'remote', branch: 'main', remoteUrl: remotePath })

    for (const path of collisions) {
      expect(await fs.readFile(join(workspacePath, path), 'utf8')).toContain(`local ${path}\n`)
    }
    expect(await fs.readFile(join(workspacePath, remoteOnly), 'utf8')).toBe('remote document\n')
    expect(await fs.readFile(join(workspacePath, 'private-note.txt'), 'utf8')).toBe('user-only note\n')
    const git = gitFor(workspacePath)
    expect(await git.revparse(['HEAD'])).toBe(remoteHead)
    expect((await git.revparse(['--abbrev-ref', '@{upstream}'])).trim()).toBe('origin/main')
    const status = await git.status()
    expect(status.staged).toEqual([])
    expect(status.modified).toContain('system.md')
    expect(status.deleted).toEqual([])
  })

  it('binds an existing unborn repository and changes to the selected branch', async () => {
    await writeAt(remotePath, 'system.md', 'remote template\n')
    await commitAll(remotePath)
    await gitFor(workspacePath).init(['--initial-branch=draft'])
    await gitFor(workspacePath).addConfig('test.marker', 'keep')
    await writeAt(workspacePath, 'system.md', 'local template\n')

    await bindGitRepository(workspacePath, { remoteUrl: remotePath, branch: 'main' })

    expect((await gitFor(workspacePath).status()).current).toBe('main')
    expect((await gitFor(workspacePath).getConfig('test.marker')).value).toBe('keep')
    expect(await fs.readFile(join(workspacePath, 'system.md'), 'utf8')).toBe('local template\n')
  })

  it('keeps an existing unborn repository retryable when a local symlink blocks remote files', async () => {
    await writeAt(remotePath, 'docs/remote.md', 'remote document\n')
    await commitAll(remotePath)
    const outside = join(root, 'outside')
    await fs.mkdir(outside)
    await writeAt(outside, 'user.md', 'outside content\n')
    await fs.symlink(outside, join(workspacePath, 'docs'))
    const git = gitFor(workspacePath)
    await git.init(['--initial-branch=draft'])
    await git.addConfig('test.marker', 'keep')

    await expect(bindGitRepository(workspacePath, { remoteUrl: remotePath, branch: 'main' })).rejects.toThrow()

    await expect(git.revparse(['--verify', 'HEAD'])).rejects.toThrow()
    expect(await git.raw(['ls-files', '--cached', '-z'])).toBe('')
    expect(await git.getRemotes()).toEqual([])
    expect((await git.getConfig('test.marker')).value).toBe('keep')
    expect(await fs.readFile(join(outside, 'user.md'), 'utf8')).toBe('outside content\n')
    await expect(fs.stat(join(outside, 'remote.md'))).rejects.toThrow()

    await fs.rename(join(workspacePath, 'docs'), join(workspacePath, 'original-docs-link'))
    await bindGitRepository(workspacePath, { remoteUrl: remotePath, branch: 'main' })
    expect(await fs.readFile(join(workspacePath, 'docs/remote.md'), 'utf8')).toBe('remote document\n')
    expect((await git.status()).current).toBe('main')
  })

  it('preserves staged versions in an unborn repository instead of replacing its index', async () => {
    await writeAt(remotePath, 'system.md', 'remote template\n')
    await commitAll(remotePath)
    const git = gitFor(workspacePath)
    await git.init(['--initial-branch=main'])
    await writeAt(workspacePath, 'system.md', 'staged template\n')
    await git.add('system.md')
    await writeAt(workspacePath, 'system.md', 'working template\n')

    await expect(bindGitRepository(workspacePath, { remoteUrl: remotePath, branch: 'main' }))
      .rejects.toThrow('工作区存在已暂存内容')

    expect(await git.show([':system.md'])).toBe('staged template\n')
    expect(await fs.readFile(join(workspacePath, 'system.md'), 'utf8')).toBe('working template\n')
    expect(await git.getRemotes()).toEqual([])
    await expect(git.revparse(['--verify', 'HEAD'])).rejects.toThrow()
  })

  it('preserves a local directory that conflicts with a remote file and rolls back new Git metadata', async () => {
    await writeAt(remotePath, 'docs', 'remote file\n')
    await commitAll(remotePath)
    await writeAt(workspacePath, 'docs/local.md', 'local document\n')

    await expect(bindGitRepository(workspacePath, { remoteUrl: remotePath, branch: 'main' }))
      .rejects.toThrow('本地路径与远端文件类型冲突')

    expect(await fs.readFile(join(workspacePath, 'docs/local.md'), 'utf8')).toBe('local document\n')
    await expect(fs.stat(join(workspacePath, '.git'))).rejects.toThrow()
  })

  it('keeps existing local commits and working changes when binding an established branch', async () => {
    await writeAt(remotePath, 'system.md', 'remote template\n')
    await commitAll(remotePath)
    const git = gitFor(workspacePath)
    await git.init(['--initial-branch=main'])
    await writeAt(workspacePath, 'system.md', 'local commit\n')
    await commitAll(workspacePath)
    const localHead = await git.revparse(['HEAD'])
    await writeAt(workspacePath, 'system.md', 'working template\n')

    await bindGitRepository(workspacePath, { remoteUrl: remotePath, branch: 'main' })

    expect(await git.revparse(['HEAD'])).toBe(localHead)
    expect(await fs.readFile(join(workspacePath, 'system.md'), 'utf8')).toBe('working template\n')
    expect((await git.revparse(['--abbrev-ref', '@{upstream}'])).trim()).toBe('origin/main')
  })
})
