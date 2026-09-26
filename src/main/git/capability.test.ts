import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const gitState = vi.hoisted(() => ({
  workspacePath: '',
  branch: 'main',
  remoteUrl: null as string | null,
  remoteOutput: '',
  fetchError: false,
  init: vi.fn(async (_args: string[]) => undefined),
  raw: vi.fn(async (_args: string[]) => ''),
  checkout: vi.fn(async (_args: string[]) => undefined),
}))
const sshState = vi.hoisted(() => ({ exists: true }))

vi.mock('./client', () => ({
  gitFor: vi.fn((workspacePath: string) => {
    gitState.workspacePath = workspacePath
    return {
      init: gitState.init,
      status: vi.fn(async () => ({ current: gitState.branch })),
      raw: gitState.raw,
      checkout: gitState.checkout,
    }
  }),
  gitForWithAskpass: vi.fn(async (workspacePath: string) => {
    gitState.workspacePath = workspacePath
    return {
      init: gitState.init,
      status: vi.fn(async () => ({ current: gitState.branch })),
      raw: gitState.raw,
      checkout: gitState.checkout,
    }
  }),
}))

vi.mock('../system/ssh', () => ({
  requireSshKeyForRemote: vi.fn(async (remoteUrl: string) => {
    const sshRemote = /^(?:ssh|git\+ssh):\/\//i.test(remoteUrl) || /^[^\s/@]+@[^\s:]+:.+/.test(remoteUrl)
    if (sshRemote && !sshState.exists) {
      throw Object.assign(new Error('当前 App 尚未配置专用 SSH Key'), { code: 'SSH_KEY_REQUIRED' })
    }
    return sshRemote
  }),
  sshAuthorizationError: vi.fn((error: unknown, sshRemote: boolean) => {
    const message = error instanceof Error ? error.message : String(error)
    if (!sshRemote || !/Permission denied \(publickey\)/i.test(message)) return null
    return Object.assign(new Error('SSH Key 已生成，但远端仓库尚未授权'), { code: 'SSH_AUTH_FAILED' })
  })
}))

import { bindGitRepository, listRemoteGitBranches, readGitCapability } from './capability'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'git-capability-'))
  gitState.branch = 'main'
  gitState.remoteUrl = null
  gitState.fetchError = false
  gitState.remoteOutput = [
    'ref: refs/heads/main\tHEAD',
    '1111111111111111111111111111111111111111\tHEAD',
    '1111111111111111111111111111111111111111\trefs/heads/main',
    '2222222222222222222222222222222222222222\trefs/heads/develop',
  ].join('\n')
  sshState.exists = true
  gitState.init.mockReset()
  gitState.init.mockImplementation(async (args: string[]) => {
    const branchArg = args.find((arg) => arg.startsWith('--initial-branch='))
    if (branchArg) gitState.branch = branchArg.slice('--initial-branch='.length)
    await fs.mkdir(join(gitState.workspacePath, '.git'), { recursive: true })
  })
  gitState.checkout.mockReset()
  gitState.raw.mockReset()
  gitState.raw.mockImplementation(async (args: string[]) => {
    if (args[0] === 'ls-remote') return gitState.remoteOutput
    if (args.join(' ') === 'remote get-url origin') {
      if (!gitState.remoteUrl) throw new Error('origin missing')
      return `${gitState.remoteUrl}\n`
    }
    if (args[0] === 'remote' && args[1] === 'add') {
      gitState.remoteUrl = args[3] ?? null
      return ''
    }
    if (args[0] === 'fetch' && gitState.fetchError) throw new Error('fetch failed')
    if (args.join(' ') === 'rev-parse --verify HEAD') throw new Error('unborn branch')
    if (args[0] === 'show-ref') throw new Error('branch missing')
    return ''
  })
})

afterEach(async () => {
  await fs.rm(workspacePath, { recursive: true, force: true })
})

describe('Git capability', () => {
  it('returns unbound when the project has no .git entry', async () => {
    await expect(readGitCapability(workspacePath)).resolves.toEqual({ state: 'unbound' })
  })

  it('returns local when the repository has no origin', async () => {
    await fs.mkdir(join(workspacePath, '.git'))

    await expect(readGitCapability(workspacePath)).resolves.toEqual({
      state: 'local',
      branch: 'main',
    })
  })

  it('returns remote with the origin URL', async () => {
    await fs.mkdir(join(workspacePath, '.git'))
    gitState.branch = 'develop'
    gitState.remoteUrl = 'https://example.com/demo.git'

    await expect(readGitCapability(workspacePath)).resolves.toEqual({
      state: 'remote',
      branch: 'develop',
      remoteUrl: 'https://example.com/demo.git',
    })
  })

  it('lists remote branches with the default branch first', async () => {
    await expect(listRemoteGitBranches(workspacePath, 'https://example.com/demo.git')).resolves.toEqual({
      branches: ['main', 'develop'],
      defaultBranch: 'main',
    })
  })

  it('requires the app SSH key before reading an SSH remote', async () => {
    sshState.exists = false

    await expect(listRemoteGitBranches(
      workspacePath,
      'git@git.example.com:team/demo.git'
    )).rejects.toMatchObject({
      code: 'SSH_KEY_REQUIRED',
      message: expect.stringContaining('当前 App 尚未配置专用 SSH Key')
    })
    expect(gitState.raw).not.toHaveBeenCalledWith(expect.arrayContaining(['ls-remote']))
  })

  it('guides users when the SSH key has not been authorized by the remote', async () => {
    gitState.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'ls-remote') {
        throw new Error('git@git.example.com: Permission denied (publickey).')
      }
      return ''
    })

    await expect(listRemoteGitBranches(
      workspacePath,
      'ssh://git@git.example.com/team/demo.git'
    )).rejects.toMatchObject({
      code: 'SSH_AUTH_FAILED',
      message: expect.stringContaining('SSH Key 已生成，但远端仓库尚未授权')
    })
  })

  it('binds the selected remote branch without overwriting local workspace files', async () => {
    const capability = await bindGitRepository(workspacePath, {
      remoteUrl: 'https://example.com/demo.git',
      branch: 'develop',
    })

    expect(gitState.init).toHaveBeenCalledWith(['--initial-branch=develop'])
    expect(gitState.raw).toHaveBeenCalledWith([
      'remote',
      'add',
      'origin',
      'https://example.com/demo.git',
    ])
    expect(gitState.raw).toHaveBeenCalledWith(['fetch', 'origin', 'develop'])
    expect(gitState.raw).toHaveBeenCalledWith(['read-tree', 'origin/develop'])
    expect(gitState.checkout).toHaveBeenCalledWith(['-b', 'develop', '--track', 'origin/develop'])
    expect(gitState.raw).toHaveBeenCalledWith(['branch', '--set-upstream-to=origin/develop', 'develop'])
    expect(capability).toEqual({
      state: 'remote',
      branch: 'develop',
      remoteUrl: 'https://example.com/demo.git',
    })
    const gitignore = await fs.readFile(join(workspacePath, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.ui-client/')
  })

  it('rejects a branch that does not exist on the remote without initializing Git', async () => {
    await expect(bindGitRepository(workspacePath, {
      remoteUrl: 'https://example.com/demo.git',
      branch: 'missing',
    })).rejects.toThrow('远端分支不存在：missing')

    await expect(fs.stat(join(workspacePath, '.git'))).rejects.toThrow()
  })

  it('rolls back a newly initialized repository when remote binding fails', async () => {
    gitState.fetchError = true

    await expect(bindGitRepository(workspacePath, {
      remoteUrl: 'https://example.com/demo.git',
      branch: 'main',
    })).rejects.toThrow('fetch failed')

    await expect(fs.stat(join(workspacePath, '.git'))).rejects.toThrow()
  })
})
