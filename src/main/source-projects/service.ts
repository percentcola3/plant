import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { SourceProjectBinding, SourceProjectInfo, SourceProjectLaunchInfo, SourceRuntimeProfile } from '@shared/types'
import { gitFor } from '../git/client'
import { UIClientError } from '../ipc/errors'

const BINDING_FILE = '.source-project.json'
const RUNTIME_FILE = 'ui-client.runtime.json'
const launches = new Map<string, { child: ChildProcess; url?: string; message?: string }>()

function normalizeProjectPath(projectRelPath: string): string {
  const normalized = projectRelPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized || normalized.split('/').includes('..')) {
    throw new UIClientError('PATH_OUTSIDE_SCOPE', `项目路径无效：${projectRelPath}`)
  }
  return normalized
}

function projectDirectory(workspacePath: string, projectRelPath: string): string {
  const root = resolve(workspacePath)
  const target = resolve(root, normalizeProjectPath(projectRelPath))
  if (target === root || !target.startsWith(`${root}/`)) {
    throw new UIClientError('PATH_OUTSIDE_SCOPE', '项目路径不在当前工作区内')
  }
  return target
}

function bindingPath(workspacePath: string, projectRelPath: string): string {
  return join(projectDirectory(workspacePath, projectRelPath), BINDING_FILE)
}

function sourceCopyPath(sourceId: string): string {
  return join(app.getPath('userData'), 'source-projects', sourceId, 'source')
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf-8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new UIClientError('VALIDATION', `无法读取配置：${path}`)
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function parseRuntimeProfile(value: unknown, fallbackName: string): SourceRuntimeProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UIClientError('VALIDATION', '源码运行配置格式错误')
  }
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1 || typeof raw.name !== 'string' || !isStringArray(raw.install) || !isStringArray(raw.start)) {
    throw new UIClientError('VALIDATION', '源码运行配置缺少 schemaVersion、name、install 或 start')
  }
  return {
    schemaVersion: 1,
    name: raw.name.trim() || fallbackName,
    ...(typeof raw.node === 'string' && raw.node ? { node: raw.node } : {}),
    ...(typeof raw.packageManager === 'string' && raw.packageManager ? { packageManager: raw.packageManager } : {}),
    install: [...raw.install],
    start: [...raw.start],
    ...(typeof raw.readyUrl === 'string' && raw.readyUrl ? { readyUrl: raw.readyUrl } : {}),
    ...(typeof raw.mockOutputDir === 'string' && raw.mockOutputDir ? { mockOutputDir: raw.mockOutputDir } : {})
  }
}

async function readRuntimeProfile(sourcePath: string): Promise<SourceRuntimeProfile> {
  const configured = await readJson(join(sourcePath, RUNTIME_FILE))
  if (configured) return parseRuntimeProfile(configured, basename(sourcePath))

  const packageJson = await readJson(join(sourcePath, 'package.json'))
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new UIClientError('VALIDATION', '源码仓库缺少 package.json 或 ui-client.runtime.json')
  }
  const pkg = packageJson as { name?: unknown; volta?: { node?: unknown; yarn?: unknown }; scripts?: Record<string, unknown> }
  const script = typeof pkg.scripts?.dev === 'string' ? 'dev' : typeof pkg.scripts?.serve === 'string' ? 'serve' : null
  if (!script) throw new UIClientError('VALIDATION', '源码仓库缺少 dev 或 serve 启动脚本')
  return {
    schemaVersion: 1,
    name: typeof pkg.name === 'string' ? pkg.name : basename(sourcePath),
    ...(typeof pkg.volta?.node === 'string' ? { node: pkg.volta.node } : {}),
    ...(typeof pkg.volta?.yarn === 'string' ? { packageManager: `yarn@${pkg.volta.yarn}` } : {}),
    install: ['yarn', 'install', '--frozen-lockfile', '--non-interactive'],
    start: ['yarn', script]
  }
}

function parseBinding(value: unknown): SourceProjectBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (
    raw.schemaVersion !== 1
    || typeof raw.sourceId !== 'string'
    || typeof raw.baseBranch !== 'string'
    || typeof raw.branch !== 'string'
    || typeof raw.createdAt !== 'string'
  ) return null
  return {
    schemaVersion: 1,
    sourceId: raw.sourceId,
    ...(typeof raw.repositoryUrl === 'string' && raw.repositoryUrl ? { repositoryUrl: raw.repositoryUrl } : {}),
    baseBranch: raw.baseBranch,
    branch: raw.branch,
    runtime: parseRuntimeProfile(raw.runtime, raw.sourceId),
    createdAt: raw.createdAt
  }
}

async function readBinding(workspacePath: string, projectRelPath: string): Promise<SourceProjectBinding | null> {
  return parseBinding(await readJson(bindingPath(workspacePath, projectRelPath)))
}

async function sourceInfo(binding: SourceProjectBinding | null): Promise<SourceProjectInfo> {
  if (!binding) return { binding: null, state: 'unlinked', dirty: false, launch: { state: 'stopped' } }
  const sourcePath = sourceCopyPath(binding.sourceId)
  const exists = await fs.stat(sourcePath).then(stat => stat.isDirectory()).catch(() => false)
  if (!exists) return { binding, state: 'missing', dirty: false, launch: { state: 'stopped' } }
  const status = await gitFor(sourcePath).status()
  const active = launches.get(binding.sourceId)
  const launch: SourceProjectLaunchInfo = active
    ? { state: 'running', ...(active.url ? { url: active.url } : {}), ...(active.message ? { message: active.message } : {}) }
    : { state: 'stopped' }
  return { binding, state: 'ready', dirty: !status.isClean(), launch }
}

async function waitForReady(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new UIClientError('VALIDATION', '源码开发服务启动后已退出')
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 服务仍在编译，继续等待。
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new UIClientError('VALIDATION', `源码服务未能在 90 秒内就绪：${url}`)
}

async function ensureDependencies(sourcePath: string, runtime: SourceRuntimeProfile): Promise<void> {
  const nodeModules = await fs.stat(join(sourcePath, 'node_modules')).then(stat => stat.isDirectory()).catch(() => false)
  if (nodeModules) return
  const [command, ...args] = runtime.install
  await new Promise<void>((resolveInstall, rejectInstall) => {
    const child = spawn(command, args, { cwd: sourcePath, stdio: 'ignore' })
    child.once('error', rejectInstall)
    child.once('exit', code => code === 0 ? resolveInstall() : rejectInstall(new UIClientError('VALIDATION', `源码依赖安装失败（退出码 ${code ?? 'unknown'}）`)))
  })
}

function stopLaunch(child: ChildProcess): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      // 进程组可能已退出，回退为关闭直接子进程。
    }
  }
  child.kill()
}

export async function startSourceProject(workspacePath: string, projectRelPath: string): Promise<SourceProjectInfo> {
  const binding = await readBinding(workspacePath, projectRelPath)
  if (!binding) throw new UIClientError('NOT_FOUND', '当前项目尚未关联源码')
  if (launches.has(binding.sourceId)) return sourceInfo(binding)
  const sourcePath = sourceCopyPath(binding.sourceId)
  await ensureDependencies(sourcePath, binding.runtime)
  const [command, ...args] = binding.runtime.start
  const child = spawn(command, args, {
    cwd: sourcePath,
    stdio: 'ignore',
    detached: process.platform !== 'win32'
  })
  launches.set(binding.sourceId, { child, ...(binding.runtime.readyUrl ? { url: binding.runtime.readyUrl } : {}) })
  child.once('exit', () => launches.delete(binding.sourceId))
  child.once('error', () => launches.delete(binding.sourceId))
  try {
    if (binding.runtime.readyUrl) await waitForReady(binding.runtime.readyUrl, child)
    return sourceInfo(binding)
  } catch (error) {
    stopLaunch(child)
    launches.delete(binding.sourceId)
    throw error
  }
}

export async function stopSourceProject(workspacePath: string, projectRelPath: string): Promise<SourceProjectInfo> {
  const binding = await readBinding(workspacePath, projectRelPath)
  if (!binding) throw new UIClientError('NOT_FOUND', '当前项目尚未关联源码')
  const active = launches.get(binding.sourceId)
  if (active) stopLaunch(active.child)
  launches.delete(binding.sourceId)
  return sourceInfo(binding)
}

export async function getSourceProject(workspacePath: string, projectRelPath: string): Promise<SourceProjectInfo> {
  return sourceInfo(await readBinding(workspacePath, projectRelPath))
}

export async function associateSourceProject(
  workspacePath: string,
  projectRelPath: string,
  sourcePathInput: string
): Promise<SourceProjectInfo> {
  const existing = await readBinding(workspacePath, projectRelPath)
  if (existing) throw new UIClientError('VALIDATION', '当前项目已关联源码，请先解除关联后再更换')

  const sourcePath = resolve(sourcePathInput)
  const sourceStat = await fs.stat(sourcePath).catch(() => null)
  if (!sourceStat?.isDirectory()) throw new UIClientError('VALIDATION', '请选择有效的源码目录')
  const sourceGit = gitFor(sourcePath)
  const isRepository = await sourceGit.raw(['rev-parse', '--is-inside-work-tree'])
    .then(value => value.trim() === 'true')
    .catch(() => false)
  if (!isRepository) throw new UIClientError('VALIDATION', '所选目录不是 Git 仓库')

  const runtime = await readRuntimeProfile(sourcePath)
  const sourceStatus = await sourceGit.status()
  const baseBranch = sourceStatus.current || 'master'
  const repositoryUrl = await sourceGit.raw(['remote', 'get-url', 'origin']).then(value => value.trim()).catch(() => '')
  const sourceId = randomUUID()
  const targetPath = sourceCopyPath(sourceId)
  const branch = `ui-client/${sourceId}`

  await fs.mkdir(dirname(targetPath), { recursive: true })
  try {
    await gitFor(dirname(targetPath)).clone(sourcePath, targetPath)
    await gitFor(targetPath).raw(['checkout', '-b', branch])
    const binding: SourceProjectBinding = {
      schemaVersion: 1,
      sourceId,
      ...(repositoryUrl ? { repositoryUrl } : {}),
      baseBranch,
      branch,
      runtime,
      createdAt: new Date().toISOString()
    }
    await fs.writeFile(bindingPath(workspacePath, projectRelPath), `${JSON.stringify(binding, null, 2)}\n`, 'utf-8')
    return sourceInfo(binding)
  } catch (error) {
    await fs.rm(join(app.getPath('userData'), 'source-projects', sourceId), { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function commitSourceProject(
  workspacePath: string,
  projectRelPath: string,
  message: string
): Promise<SourceProjectInfo> {
  const binding = await readBinding(workspacePath, projectRelPath)
  if (!binding) throw new UIClientError('NOT_FOUND', '当前项目尚未关联源码')
  const sourcePath = sourceCopyPath(binding.sourceId)
  const commitMessage = message.trim()
  if (!commitMessage) throw new UIClientError('VALIDATION', '请输入提交说明')
  const git = gitFor(sourcePath)
  const status = await git.status()
  if (status.isClean()) throw new UIClientError('VALIDATION', '源码没有可提交的改动')
  await git.add(['-A'])
  await git.commit(commitMessage)
  return sourceInfo(binding)
}

export function sourceProjectCopyPath(sourceId: string): string {
  return sourceCopyPath(sourceId)
}
