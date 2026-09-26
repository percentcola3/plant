import { beforeEach, describe, expect, it, vi } from 'vitest'

const envMock = vi.hoisted(() => vi.fn())
const cloneMock = vi.hoisted(() => vi.fn(async () => undefined))
const simpleGitMock = vi.hoisted(() => vi.fn(() => ({
  env: envMock.mockReturnThis(),
  clone: cloneMock
})))
const askpassStartMock = vi.hoisted(() => vi.fn(async () => ({ url: 'http://127.0.0.1:1/askpass', token: 'token' })))
const appSshEnvMock = vi.hoisted(() => vi.fn(() => ({ GIT_SSH_COMMAND: 'ssh -F /dev/null -i /app/ssh/id_ed25519' })))
const requireSshKeyForRemoteMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('simple-git', () => ({ simpleGit: simpleGitMock }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/workspace-userdata' } }))
vi.mock('../http/askpass-server', () => ({
  askpassServer: { start: askpassStartMock },
  askpassEnv: () => ({ UI_CLIENT_ASKPASS_URL: 'http://127.0.0.1:1/askpass', UI_CLIENT_ASKPASS_TOKEN: 'token' }),
  askpassCachedHelperPath: () => '/tmp/workspace-userdata/askpass-cached-helper.sh'
}))
vi.mock('./binary', () => ({
  resolveGitBinary: () => '/tmp/git',
  resolveGitEnv: () => ({ GIT_EXEC_PATH: '/tmp/git-core' })
}))
vi.mock('../system/ssh', () => ({
  appSshEnv: appSshEnvMock,
  requireSshKeyForRemote: requireSshKeyForRemoteMock,
  sshAuthorizationError: () => null
}))

async function loadClient(): Promise<typeof import('./client')> {
  vi.resetModules()
  return import('./client')
}

describe('git client ssh isolation', () => {
  beforeEach(() => {
    envMock.mockClear()
    cloneMock.mockClear()
    simpleGitMock.mockClear()
    askpassStartMock.mockClear()
    appSshEnvMock.mockClear()
    requireSshKeyForRemoteMock.mockClear()
  })

  it('injects the app-managed ssh command when cloning', async () => {
    const { clone } = await loadClient()

    await clone({ url: 'git@gitlab.example.com:team/repo.git', dest: '/tmp/repo' })

    expect(requireSshKeyForRemoteMock).toHaveBeenCalledWith('git@gitlab.example.com:team/repo.git')
    expect(envMock).toHaveBeenCalledWith(expect.objectContaining({
      GIT_SSH_COMMAND: 'ssh -F /dev/null -i /app/ssh/id_ed25519'
    }))
  })

  it('injects the app-managed ssh command for normal workspace git commands', async () => {
    const { gitFor, gitForWithAskpass, gitForBackground } = await loadClient()

    gitFor('/tmp/repo')
    await gitForWithAskpass('/tmp/repo')
    await gitForBackground('/tmp/repo')

    expect(envMock).toHaveBeenCalledTimes(3)
    for (const call of envMock.mock.calls) {
      expect(call[0]).toMatchObject({
        GIT_SSH_COMMAND: 'ssh -F /dev/null -i /app/ssh/id_ed25519'
      })
    }
  })
})
