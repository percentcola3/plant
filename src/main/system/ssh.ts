import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { app } from 'electron'
import { UIClientError } from '../ipc/errors'

export type SshKeyState = {
  exists: boolean
  publicKey?: string
  fingerprint?: string
  path: string
}

const DEFAULT_KEY_NAME = 'id_ed25519'
let keyMutationQueue: Promise<void> = Promise.resolve()

function sshDir(): string {
  return join(app.getPath('userData'), 'ssh')
}

function defaultKeyPath(): string {
  return join(sshDir(), DEFAULT_KEY_NAME)
}

function publicKeyPath(): string {
  return `${defaultKeyPath()}.pub`
}

function knownHostsPath(): string {
  return join(sshDir(), 'known_hosts')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function publicKeyIdentity(publicKey: string): string | undefined {
  const [type, encodedKey] = publicKey.trim().split(/\s+/, 3)
  if (!type || !encodedKey) return undefined

  const keyBytes = Buffer.from(encodedKey, 'base64')
  if (keyBytes.length === 0) return undefined
  return `${type} ${encodedKey}`
}

function fingerprintOf(publicKey: string): string | undefined {
  const identity = publicKeyIdentity(publicKey)
  if (!identity) return undefined
  const [, encodedKey] = identity.split(' ')

  const digest = createHash('sha256')
    .update(Buffer.from(encodedKey, 'base64'))
    .digest('base64')
    .replace(/=+$/, '')
  return `SHA256:${digest}`
}

async function runSshKeygen(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('/usr/bin/ssh-keygen', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += String(d) })
    child.stderr.on('data', (d) => { stderr += String(d) })
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new UIClientError('SSH_KEYGEN_FAILED', stderr.trim() || `ssh-keygen exit ${code}`))
    })
    child.on('error', (e) => reject(new UIClientError('SSH_KEYGEN_FAILED', e.message)))
  })
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new UIClientError('SSH_KEY_INVALID', `SSH Key 路径不是普通文件：${path}`)
    }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function derivePublicKey(privateKeyPath: string): Promise<string> {
  const publicKey = await runSshKeygen(['-y', '-f', privateKeyPath])
  const identity = publicKeyIdentity(publicKey)
  if (!identity) throw new UIClientError('SSH_KEY_INVALID', '无法从 App 私钥导出有效公钥')
  return identity
}

async function writePublicKeyAtomically(path: string, publicKey: string): Promise<void> {
  const stagedPath = `${path}.next-${randomUUID()}`
  try {
    await fs.writeFile(stagedPath, `${publicKey.trim()}\n`, { encoding: 'utf-8', mode: 0o644 })
    await fs.chmod(stagedPath, 0o644)
    await fs.rename(stagedPath, path)
  } finally {
    await fs.rm(stagedPath, { force: true })
  }
}

async function readKeyState(path: string, repairPublicKey: boolean): Promise<SshKeyState> {
  try {
    if (!await isRegularFile(path)) return { exists: false, path }
    await fs.chmod(path, 0o600)
    const derivedPublicKey = await derivePublicKey(path)
    const derivedIdentity = publicKeyIdentity(derivedPublicKey)
    if (!derivedIdentity) return { exists: false, path }

    const publicPath = `${path}.pub`
    let publicKey = ''
    if (await isRegularFile(publicPath)) {
      publicKey = (await fs.readFile(publicPath, 'utf-8')).trim()
    }

    if (publicKeyIdentity(publicKey) !== derivedIdentity) {
      if (!repairPublicKey) return { exists: false, path }
      publicKey = `${derivedIdentity} workspace-app-recovered`
      await writePublicKeyAtomically(publicPath, publicKey)
    }

    const fingerprint = fingerprintOf(derivedIdentity)
    if (!fingerprint) return { exists: false, path }
    return { exists: true, publicKey, fingerprint, path }
  } catch (error) {
    if (error instanceof UIClientError && error.code === 'SSH_KEY_INVALID') throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new UIClientError(
      'SSH_KEY_INVALID',
      'App SSH Key 已存在，但无法读取或校验。请先恢复该密钥，再重新轮换。',
      { cause: detail }
    )
  }
}

function enqueueKeyMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const operation = keyMutationQueue.then(mutation, mutation)
  keyMutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function keyComment(email?: string): string {
  return email?.trim() || `workspace-app-${randomUUID().slice(0, 8)}`
}

async function runKeygen(path: string, email?: string): Promise<void> {
  // ssh-keygen 用 macOS 自带的 /usr/bin/ssh-keygen
  await runSshKeygen(['-t', 'ed25519', '-f', path, '-N', '', '-C', keyComment(email)])
}

type KeyBackup = {
  path: string
  hadPrivateKey: boolean
  hadPublicKey: boolean
}

async function backupCurrentKey(): Promise<KeyBackup | null> {
  const [hadPrivateKey, hadPublicKey] = await Promise.all([
    isRegularFile(defaultKeyPath()),
    isRegularFile(publicKeyPath())
  ])
  if (!hadPrivateKey && !hadPublicKey) return null

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(sshDir(), 'backups', `${timestamp}-${randomUUID().slice(0, 8)}`)
  const backupPath = join(backupDir, DEFAULT_KEY_NAME)
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 })
  await fs.chmod(backupDir, 0o700)

  try {
    if (hadPrivateKey) {
      await fs.copyFile(defaultKeyPath(), backupPath)
      await fs.chmod(backupPath, 0o600)
    }
    if (hadPublicKey) {
      await fs.copyFile(publicKeyPath(), `${backupPath}.pub`)
      await fs.chmod(`${backupPath}.pub`, 0o644)
    }
  } catch (error) {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  return { path: backupPath, hadPrivateKey, hadPublicKey }
}

async function copyFileAtomically(source: string, destination: string, mode: number): Promise<void> {
  const stagedPath = `${destination}.restore-${randomUUID()}`
  try {
    await fs.copyFile(source, stagedPath)
    await fs.chmod(stagedPath, mode)
    await fs.rename(stagedPath, destination)
  } finally {
    await fs.rm(stagedPath, { force: true })
  }
}

async function restoreBackup(backup: KeyBackup | null): Promise<void> {
  if (backup?.hadPrivateKey) {
    await copyFileAtomically(backup.path, defaultKeyPath(), 0o600)
  } else {
    await fs.rm(defaultKeyPath(), { force: true })
  }

  if (backup?.hadPublicKey) {
    await copyFileAtomically(`${backup.path}.pub`, publicKeyPath(), 0o644)
  } else {
    await fs.rm(publicKeyPath(), { force: true })
  }

  if (backup?.hadPrivateKey && backup.hadPublicKey) {
    const restored = await readKeyState(defaultKeyPath(), true)
    if (!restored.exists) throw new UIClientError('SSH_KEYGEN_FAILED', '旧 SSH Key 回滚校验失败')
  }
}

async function pruneOldBackups(keep: KeyBackup | null): Promise<void> {
  if (!keep) return
  const backupsDir = join(sshDir(), 'backups')
  const keepDir = dirname(keep.path)
  const entries = await fs.readdir(backupsDir, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries.map(async (entry) => {
    const path = join(backupsDir, entry.name)
    if (path === keepDir || !entry.isDirectory() || entry.isSymbolicLink()) return
    await fs.rm(path, { recursive: true, force: true })
  }))
}

async function cleanupKeyPair(path: string): Promise<void> {
  await Promise.allSettled([
    fs.rm(path, { force: true }),
    fs.rm(`${path}.pub`, { force: true })
  ])
}

async function createAndInstallKey(opts?: { email?: string }): Promise<SshKeyState> {
  await fs.mkdir(sshDir(), { recursive: true, mode: 0o700 })
  await fs.chmod(sshDir(), 0o700)

  const tempPath = join(sshDir(), `.${DEFAULT_KEY_NAME}.${randomUUID()}.tmp`)
  let cleanupTemp = true
  try {
    await runKeygen(tempPath, opts?.email)
    const generated = await readKeyState(tempPath, false)
    if (!generated.exists || !generated.fingerprint) {
      throw new UIClientError('SSH_KEYGEN_FAILED', '生成完成但读不到有效的 .pub 文件')
    }

    const backup = await backupCurrentKey()
    try {
      await fs.rename(tempPath, defaultKeyPath())
      await fs.chmod(defaultKeyPath(), 0o600)
      try {
        await fs.rename(`${tempPath}.pub`, publicKeyPath())
        await fs.chmod(publicKeyPath(), 0o644)
      } catch {
        // 私钥是提交点。公钥替换失败时从新私钥重建，避免留下混合 key pair。
        const derived = await derivePublicKey(defaultKeyPath())
        await writePublicKeyAtomically(publicKeyPath(), `${derived} workspace-app-recovered`)
      }

      const installed = await readKeyState(defaultKeyPath(), true)
      if (!installed.exists || installed.fingerprint !== generated.fingerprint) {
        throw new UIClientError('SSH_KEYGEN_FAILED', '新 SSH Key 安装校验失败')
      }
      await pruneOldBackups(backup).catch(() => {
        // 下次成功轮换还会再次清理；不要因备份清理失败回滚已经安装并校验的新 key。
        console.warn('[ssh] 旧 SSH Key 备份清理失败，将在下次轮换时重试')
      })
      return installed
    } catch (error) {
      try {
        await restoreBackup(backup)
      } catch (restoreError) {
        cleanupTemp = false
        const detail = restoreError instanceof Error ? restoreError.message : String(restoreError)
        throw new UIClientError('SSH_KEYGEN_FAILED', `SSH Key 轮换失败且旧密钥回滚失败：${detail}`)
      }
      throw error
    }
  } finally {
    if (cleanupTemp) await cleanupKeyPair(tempPath)
  }
}

function checkSshKeyUnlocked(): Promise<SshKeyState> {
  return readKeyState(defaultKeyPath(), true)
}

export function checkSshKey(): Promise<SshKeyState> {
  return enqueueKeyMutation(checkSshKeyUnlocked)
}

export function isSshRemoteUrl(remoteUrl: string): boolean {
  return /^(?:ssh|git\+ssh):\/\//i.test(remoteUrl) || /^[^\s/@]+@[^\s:]+:.+/.test(remoteUrl)
}

export async function requireSshKeyForRemote(remoteUrl: string): Promise<boolean> {
  const sshRemote = isSshRemoteUrl(remoteUrl)
  if (!sshRemote) return false

  const ssh = await checkSshKey()
  if (!ssh.exists) {
    throw new UIClientError(
      'SSH_KEY_REQUIRED',
      '当前 App 尚未配置专用 SSH Key。请先在设置中生成 SSH Key，并将公钥添加到 Git 服务后再重试。'
    )
  }
  return true
}

export function sshAuthorizationError(error: unknown, sshRemote: boolean): UIClientError | null {
  if (!sshRemote) return null
  const message = error instanceof Error ? error.message : String(error)
  if (!/Permission denied \(publickey\)|Could not read from remote repository/i.test(message)) return null
  return new UIClientError(
    'SSH_AUTH_FAILED',
    'SSH Key 已生成，但远端仓库尚未授权。请在设置中复制 App 公钥，并添加到 Git 服务的 SSH Keys。'
  )
}

export function generateSshKey(opts?: { email?: string }): Promise<SshKeyState> {
  return enqueueKeyMutation(async () => {
    const state = await checkSshKeyUnlocked()
    if (state.exists) return state
    return createAndInstallKey(opts)
  })
}

export function rotateSshKey(opts: { email?: string; expectedFingerprint: string }): Promise<SshKeyState> {
  return enqueueKeyMutation(async () => {
    const current = await checkSshKeyUnlocked()
    if (!opts?.expectedFingerprint || !current.exists || current.fingerprint !== opts.expectedFingerprint) {
      throw new UIClientError('SSH_KEY_CHANGED', 'SSH Key 已发生变化，请刷新设置后再重试轮换。')
    }
    return createAndInstallKey(opts)
  })
}

export function appSshEnv(): NodeJS.ProcessEnv {
  return {
    GIT_SSH_COMMAND: [
      'ssh',
      '-F /dev/null',
      '-i', shellQuote(defaultKeyPath()),
      '-o IdentitiesOnly=yes',
      '-o IdentityAgent=none',
      `-o UserKnownHostsFile=${shellQuote(knownHostsPath())}`,
      '-o GlobalKnownHostsFile=/dev/null',
      '-o StrictHostKeyChecking=accept-new',
      '-o BatchMode=yes'
    ].join(' ')
  }
}
