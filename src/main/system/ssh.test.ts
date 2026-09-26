import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const electronPaths = vi.hoisted(() => ({ userData: '', home: '' }))
const spawnMock = vi.hoisted(() => vi.fn())

const APP_PRIVATE_KEY = 'private-key'
const APP_PUBLIC_KEY_BODY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIApp'
const OLD_PRIVATE_KEY = 'old-private-key'
const OLD_PUBLIC_KEY_BODY = APP_PUBLIC_KEY_BODY
const NEW_PRIVATE_KEY = 'new-private-key'
const NEW_PUBLIC_KEY_BODY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINew'
const OLD_FINGERPRINT = 'SHA256:8njrZCuQ/L2LtHzdWY7HGyBB+wQMFwtT2H4jDMEjhy0'
const NEW_FINGERPRINT = 'SHA256:uawnr2rVM6Cy2glObAy/zPLf+JC3mJ5pT2mYuf+/i7I'

vi.mock('electron', () => ({
  app: { getPath: (name: string) => name === 'userData' ? electronPaths.userData : electronPaths.home }
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

async function loadSshModule(): Promise<typeof import('./ssh')> {
  vi.resetModules()
  return import('./ssh')
}

async function writePublicKey(dir: string, name: string, text: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, name), text, 'utf-8')
}

function derivedPublicKey(privateKey: string): string | undefined {
  if (privateKey === APP_PRIVATE_KEY || privateKey === OLD_PRIVATE_KEY) return APP_PUBLIC_KEY_BODY
  if (privateKey === NEW_PRIVATE_KEY) return NEW_PUBLIC_KEY_BODY
  return undefined
}

type MockChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

function finishChild(child: MockChild, code: number): void {
  child.emit('exit', code)
  child.emit('close', code)
}

async function emitDerivedPublicKey(child: MockChild, args: string[]): Promise<void> {
  const privateKeyPath = args[args.indexOf('-f') + 1]
  const privateKey = await fs.readFile(privateKeyPath, 'utf-8')
  const publicKey = derivedPublicKey(privateKey)
  if (!publicKey) {
    child.stderr.emit('data', 'invalid private key')
    finishChild(child, 255)
    return
  }
  child.stdout.emit('data', `${publicKey}\n`)
  finishChild(child, 0)
}

function mockKeygenSuccess(
  privateKey = NEW_PRIVATE_KEY,
  publicKey = `${NEW_PUBLIC_KEY_BODY} workspace-app\n`
): void {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChild()
    queueMicrotask(async () => {
      if (args.includes('-y')) {
        await emitDerivedPublicKey(child, args)
        return
      }
      const outputPath = args[args.indexOf('-f') + 1]
      await fs.mkdir(dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, privateKey, 'utf-8')
      await fs.writeFile(`${outputPath}.pub`, publicKey, 'utf-8')
      finishChild(child, 0)
    })
    return child
  })
}

function mockKeygenFailure(): void {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChild()
    queueMicrotask(async () => {
      if (args.includes('-y')) {
        await emitDerivedPublicKey(child, args)
        return
      }
      const outputPath = args[args.indexOf('-f') + 1]
      await fs.mkdir(dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, 'partial-private-key', 'utf-8')
      await fs.writeFile(`${outputPath}.pub`, 'partial-public-key', 'utf-8')
      child.stderr.emit('data', 'key generation failed')
      finishChild(child, 1)
    })
    return child
  })
}

function mockPublicKeyDerivationFailure(): void {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = createMockChild()
    queueMicrotask(async () => {
      if (args.includes('-y')) {
        child.stderr.emit('data', 'failed to load private key')
        finishChild(child, 255)
        return
      }
      const outputPath = args[args.indexOf('-f') + 1]
      await fs.mkdir(dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, NEW_PRIVATE_KEY, 'utf-8')
      await fs.writeFile(`${outputPath}.pub`, `${NEW_PUBLIC_KEY_BODY} workspace-app\n`, 'utf-8')
      finishChild(child, 0)
    })
    return child
  })
}

async function findBackedUpPrivateKeys(root: string): Promise<string[]> {
  const found: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...await findBackedUpPrivateKeys(path))
    else if (entry.name === 'id_ed25519') found.push(path)
  }
  return found
}

describe('app-managed ssh key', () => {
  beforeEach(async () => {
    electronPaths.userData = await mkdtemp(join(tmpdir(), 'workspace-ssh-userdata-'))
    electronPaths.home = await mkdtemp(join(tmpdir(), 'workspace-ssh-home-'))
    spawnMock.mockReset()
    mockKeygenSuccess()
  })

  it('ignores public keys from the user system ssh directory', async () => {
    await writePublicKey(
      join(electronPaths.home, '.ssh'),
      'id_rsa.pub',
      'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCuser user@example.com\n'
    )
    const { checkSshKey } = await loadSshModule()

    const state = await checkSshKey()

    expect(state.exists).toBe(false)
    expect(state.path).toBe(join(electronPaths.userData, 'ssh', 'id_ed25519'))
  })

  it('reads only the app-managed public key', async () => {
    await fs.mkdir(join(electronPaths.userData, 'ssh'), { recursive: true })
    await fs.writeFile(join(electronPaths.userData, 'ssh', 'id_ed25519'), APP_PRIVATE_KEY, 'utf-8')
    await writePublicKey(
      join(electronPaths.userData, 'ssh'),
      'id_ed25519.pub',
      `${APP_PUBLIC_KEY_BODY} workspace-app\n`
    )
    const { checkSshKey } = await loadSshModule()

    const state = await checkSshKey()

    expect(state.exists).toBe(true)
    expect(state.path).toBe(join(electronPaths.userData, 'ssh', 'id_ed25519'))
    expect(state.publicKey).toContain('workspace-app')
    expect(state.fingerprint).toBe(OLD_FINGERPRINT)
  })

  it('repairs a public key that does not match the private key', async () => {
    const appKeyPath = join(electronPaths.userData, 'ssh', 'id_ed25519')
    await fs.mkdir(dirname(appKeyPath), { recursive: true })
    await fs.writeFile(appKeyPath, OLD_PRIVATE_KEY, 'utf-8')
    await fs.writeFile(`${appKeyPath}.pub`, `${NEW_PUBLIC_KEY_BODY} wrong-key\n`, 'utf-8')
    const { checkSshKey } = await loadSshModule()

    const state = await checkSshKey()

    expect(state).toMatchObject({
      exists: true,
      path: appKeyPath,
      fingerprint: OLD_FINGERPRINT
    })
    expect(state.publicKey?.split(/\s+/, 2).join(' ')).toBe(OLD_PUBLIC_KEY_BODY)
    await expect(fs.readFile(`${appKeyPath}.pub`, 'utf-8')).resolves.toBe(`${state.publicKey}\n`)
  })

  it('treats a public key without its private key as not configured', async () => {
    await writePublicKey(
      join(electronPaths.userData, 'ssh'),
      'id_ed25519.pub',
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIApp workspace-app\n'
    )
    const { checkSshKey } = await loadSshModule()

    await expect(checkSshKey()).resolves.toMatchObject({ exists: false })
  })

  it('requires the app key only for SSH remotes', async () => {
    const { requireSshKeyForRemote } = await loadSshModule()

    await expect(requireSshKeyForRemote('https://git.example.com/team/repo.git')).resolves.toBe(false)
    await expect(requireSshKeyForRemote('git@git.example.com:team/repo.git')).rejects.toMatchObject({
      code: 'SSH_KEY_REQUIRED'
    })
  })

  it('generates the key under app userData instead of ~/.ssh', async () => {
    const appKeyPath = join(electronPaths.userData, 'ssh', 'id_ed25519')
    mockKeygenSuccess()
    const { generateSshKey } = await loadSshModule()

    const state = await generateSshKey()

    const generationCall = spawnMock.mock.calls.find(([, args]) => args.includes('-t'))
    expect(generationCall).toBeTruthy()
    const [command, args, options] = generationCall!
    const outputPath = args[args.indexOf('-f') + 1]
    expect(command).toBe('/usr/bin/ssh-keygen')
    expect(args.slice(0, 3)).toEqual(['-t', 'ed25519', '-f'])
    expect(dirname(outputPath)).toBe(join(electronPaths.userData, 'ssh'))
    expect(outputPath).not.toBe(appKeyPath)
    expect(args.slice(4, 7)).toEqual(['-N', '', '-C'])
    expect(args[7]).toEqual(expect.any(String))
    expect(options).toEqual({ stdio: ['ignore', 'pipe', 'pipe'] })
    expect(state.exists).toBe(true)
    expect(state.path).toBe(appKeyPath)
  })

  it('does not replace an existing private key when public key derivation fails', async () => {
    const appKeyPath = join(electronPaths.userData, 'ssh', 'id_ed25519')
    const publicKey = `${APP_PUBLIC_KEY_BODY} workspace-app\n`
    await fs.mkdir(dirname(appKeyPath), { recursive: true })
    await fs.writeFile(appKeyPath, APP_PRIVATE_KEY, 'utf-8')
    await fs.writeFile(`${appKeyPath}.pub`, publicKey, 'utf-8')
    mockPublicKeyDerivationFailure()
    const { generateSshKey } = await loadSshModule()

    await expect(generateSshKey()).rejects.toMatchObject({ code: 'SSH_KEY_INVALID' })

    expect(spawnMock.mock.calls.some(([, args]) => args.includes('-t'))).toBe(false)
    await expect(fs.readFile(appKeyPath, 'utf-8')).resolves.toBe(APP_PRIVATE_KEY)
    await expect(fs.readFile(`${appKeyPath}.pub`, 'utf-8')).resolves.toBe(publicKey)
  })

  it('rotates the app key and backs up the previous key pair', async () => {
    const appKeyPath = join(electronPaths.userData, 'ssh', 'id_ed25519')
    const oldPublicKey = `${OLD_PUBLIC_KEY_BODY} old@example.com\n`
    await fs.mkdir(dirname(appKeyPath), { recursive: true })
    await fs.writeFile(appKeyPath, OLD_PRIVATE_KEY, 'utf-8')
    await fs.writeFile(`${appKeyPath}.pub`, oldPublicKey, 'utf-8')
    mockKeygenSuccess()
    const { rotateSshKey } = await loadSshModule()

    const state = await rotateSshKey({ expectedFingerprint: OLD_FINGERPRINT })

    expect(state).toMatchObject({
      exists: true,
      path: appKeyPath,
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINew workspace-app',
      fingerprint: NEW_FINGERPRINT
    })
    expect(state).not.toHaveProperty('backupPath')
    await expect(fs.readFile(appKeyPath, 'utf-8')).resolves.toBe(NEW_PRIVATE_KEY)
    await expect(fs.readFile(`${appKeyPath}.pub`, 'utf-8')).resolves.toBe(
      `${NEW_PUBLIC_KEY_BODY} workspace-app\n`
    )
    const backups = await findBackedUpPrivateKeys(join(electronPaths.userData, 'ssh', 'backups'))
    expect(backups).toHaveLength(1)
    await expect(fs.readFile(backups[0], 'utf-8')).resolves.toBe(OLD_PRIVATE_KEY)
    await expect(fs.readFile(`${backups[0]}.pub`, 'utf-8')).resolves.toBe(oldPublicKey)
  })

  it('cleans a partial backup when copying the previous public key fails', async () => {
    const sshPath = join(electronPaths.userData, 'ssh')
    const appKeyPath = join(sshPath, 'id_ed25519')
    const publicKeyPath = `${appKeyPath}.pub`
    const backupsPath = join(sshPath, 'backups')
    const oldPublicKey = `${OLD_PUBLIC_KEY_BODY} old@example.com\n`
    await fs.mkdir(sshPath, { recursive: true })
    await fs.writeFile(appKeyPath, OLD_PRIVATE_KEY, 'utf-8')
    await fs.writeFile(publicKeyPath, oldPublicKey, 'utf-8')
    mockKeygenSuccess()
    const copyFile = fs.copyFile.bind(fs)
    const copyFileSpy = vi.spyOn(fs, 'copyFile').mockImplementation(async (source, destination, mode) => {
      if (String(source) === publicKeyPath && String(destination).startsWith(`${backupsPath}/`)) {
        throw new Error('backup public copy failed')
      }
      await copyFile(source, destination, mode)
    })
    const { rotateSshKey } = await loadSshModule()

    try {
      await expect(rotateSshKey({ expectedFingerprint: OLD_FINGERPRINT })).rejects.toThrow(
        'backup public copy failed'
      )
    } finally {
      copyFileSpy.mockRestore()
    }

    await expect(fs.readFile(appKeyPath, 'utf-8')).resolves.toBe(OLD_PRIVATE_KEY)
    await expect(fs.readFile(publicKeyPath, 'utf-8')).resolves.toBe(oldPublicKey)
    await expect(fs.readdir(backupsPath)).resolves.toEqual([])
    expect((await fs.readdir(sshPath)).sort()).toEqual(['backups', 'id_ed25519', 'id_ed25519.pub'])
  })

  it('rejects rotation when the current fingerprint changed', async () => {
    const appKeyPath = join(electronPaths.userData, 'ssh', 'id_ed25519')
    const oldPublicKey = `${OLD_PUBLIC_KEY_BODY} old@example.com\n`
    await fs.mkdir(dirname(appKeyPath), { recursive: true })
    await fs.writeFile(appKeyPath, OLD_PRIVATE_KEY, 'utf-8')
    await fs.writeFile(`${appKeyPath}.pub`, oldPublicKey, 'utf-8')
    const { rotateSshKey } = await loadSshModule()

    await expect(rotateSshKey({ expectedFingerprint: 'SHA256:stale' })).rejects.toMatchObject({
      code: 'SSH_KEY_CHANGED'
    })

    expect(spawnMock.mock.calls.some(([, args]) => args.includes('-t'))).toBe(false)
    await expect(fs.readFile(appKeyPath, 'utf-8')).resolves.toBe(OLD_PRIVATE_KEY)
    await expect(fs.readFile(`${appKeyPath}.pub`, 'utf-8')).resolves.toBe(oldPublicKey)
    await expect(fs.access(join(electronPaths.userData, 'ssh', 'backups'))).rejects.toThrow()
  })

  it('rejects rotation without a non-empty expected fingerprint', async () => {
    const appKeyPath = join(electronPaths.userData, 'ssh', 'id_ed25519')
    const oldPublicKey = `${OLD_PUBLIC_KEY_BODY} old@example.com\n`
    await fs.mkdir(dirname(appKeyPath), { recursive: true })
    await fs.writeFile(appKeyPath, OLD_PRIVATE_KEY, 'utf-8')
    await fs.writeFile(`${appKeyPath}.pub`, oldPublicKey, 'utf-8')
    const { rotateSshKey } = await loadSshModule()

    await expect(rotateSshKey(undefined as never)).rejects.toMatchObject({ code: 'SSH_KEY_CHANGED' })
    await expect(rotateSshKey({ expectedFingerprint: '' })).rejects.toMatchObject({ code: 'SSH_KEY_CHANGED' })

    expect(spawnMock.mock.calls.some(([, args]) => args.includes('-t'))).toBe(false)
    await expect(fs.readFile(appKeyPath, 'utf-8')).resolves.toBe(OLD_PRIVATE_KEY)
    await expect(fs.readFile(`${appKeyPath}.pub`, 'utf-8')).resolves.toBe(oldPublicKey)
  })

  it('keeps the previous key pair when rotation key generation fails', async () => {
    const appKeyPath = join(electronPaths.userData, 'ssh', 'id_ed25519')
    const oldPublicKey = `${OLD_PUBLIC_KEY_BODY} old@example.com\n`
    await fs.mkdir(dirname(appKeyPath), { recursive: true })
    await fs.writeFile(appKeyPath, OLD_PRIVATE_KEY, 'utf-8')
    await fs.writeFile(`${appKeyPath}.pub`, oldPublicKey, 'utf-8')
    mockKeygenFailure()
    const { checkSshKey, rotateSshKey } = await loadSshModule()

    await expect(rotateSshKey({ expectedFingerprint: OLD_FINGERPRINT })).rejects.toMatchObject({
      code: 'SSH_KEYGEN_FAILED',
      message: 'key generation failed'
    })

    await expect(fs.readFile(appKeyPath, 'utf-8')).resolves.toBe(OLD_PRIVATE_KEY)
    await expect(fs.readFile(`${appKeyPath}.pub`, 'utf-8')).resolves.toBe(oldPublicKey)
    await expect(checkSshKey()).resolves.toMatchObject({
      exists: true,
      publicKey: oldPublicKey.trim(),
      fingerprint: OLD_FINGERPRINT
    })
  })

  it('builds an isolated ssh command for app git operations', async () => {
    const { appSshEnv } = await loadSshModule()

    const env = appSshEnv()

    expect(env.GIT_SSH_COMMAND).toContain(`-i '${join(electronPaths.userData, 'ssh', 'id_ed25519')}'`)
    expect(env.GIT_SSH_COMMAND).toContain('-F /dev/null')
    expect(env.GIT_SSH_COMMAND).toContain('IdentitiesOnly=yes')
    expect(env.GIT_SSH_COMMAND).toContain(`UserKnownHostsFile='${join(electronPaths.userData, 'ssh', 'known_hosts')}'`)
  })
})
