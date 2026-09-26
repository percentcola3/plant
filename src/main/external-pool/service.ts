import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ExternalDependencyManifestRef,
  ExternalRef,
  ExternalRefBinding,
  ExternalRefBranches,
  ExternalRefCategory,
  ExternalRefCheckout,
  ExternalRefIndexStatus,
  ExternalRefSyncStatus,
  FeatureResourceSelection
} from '@shared/types'
import { externalPoolStore } from './store'
import { poolEntryPath, poolRoot } from './paths'
import { clone, gitFor, gitForBackground, gitForWithAskpass } from '../git/client'
import { ensureGitignoreEntry } from '../projects/gitignore'
import { UIClientError } from '../ipc/errors'
import { WorkspacesStore } from '../workspaces/store'
import { externalDir, EXTERNAL_DIR } from '../workspaces/paths'
import { addRef, readRefs, removeRef, updateRef } from '../workspaces/refs'
import { syncWorkspaceTemplates } from '../workspaces/templates'
import { listAssetLibraries } from '../themes/group-scanner'
import { normalizeExternalCheckout, normalizeExternalVisibleDirs } from '@shared/external-ref-controls'
import { readResourceIndexStatus, readResourceIndexStatusLive, scheduleResourceIndexBuild } from '../resource-index/service'
import {
  readFeatureResourceSelection,
  writeFeatureResourceSelection
} from '../features/resources'
import { assertFeatureRelPath } from '../features/scanner'
import {
  externalRefToManifestRef,
  readExternalManifest,
  removeExternalManifestRef,
  upsertExternalManifestRef
} from '../workspaces/external-manifest'

// ExternalRef 池服务：增删改 + 工作区挂载/卸载。
// 与老 KB service 形似但不 chmod 池物理（asset 工作区允许编辑），
// 引用关系存 .ui-client/refs.json 而非 Project.kbRefs。

const workspacesStore = new WorkspacesStore()

export type AddExternalInput =
  | { alias: string; category: ExternalRefCategory; kind: 'git'; url: string; checkout?: ExternalRefCheckout }
  | { alias: string; category: ExternalRefCategory; kind: 'local'; sourcePath: string }

type AddGitExternalInput = Extract<AddExternalInput, { kind: 'git' }> & {
  checkout?: ExternalRefCheckout
}

type AttachOptions = {
  syncManifest?: boolean
  assetLibrary?: string                       // 仅 uikit：选用源仓 components/<name> 哪个资产库
  usageNote?: string
}

export type HydrateExternalManifestResult = {
  mounted: string[]
  warnings: string[]
}

function newId(): string { return randomUUID() }

function assertSymlinkSupported(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new UIClientError(
      'PLATFORM_UNSUPPORTED',
      `当前平台 ${process.platform} 暂不支持外部库挂载（v1 仅 macOS/linux）`
    )
  }
}

export async function listExternalRefs(): Promise<ExternalRef[]> {
  const refs = await externalPoolStore.list()
  return Promise.all(refs.map(async (ref) => {
    // readResourceIndexStatusLive：ready 时补齐 zg 证据（embedding/实体），
    // 并刷新「后台增强中」进度。证据已落盘且无 enhancing 时零开销。
    const [instructionFile, indexStatus] = await Promise.all([
      instructionFileAt(ref.poolPath),
      readResourceIndexStatusLive(ref.id, ref.poolPath)
    ])
    const { instructionFile: _storedInstructionFile, ...base } = ref
    return {
      ...base,
      ...(instructionFile ? { instructionFile } : {}),
      indexStatus
    }
  }))
}

export async function requestExternalRefIndexBuild(id: string): Promise<ExternalRefIndexStatus> {
  const ref = await externalPoolStore.findById(id)
  if (!ref) throw new UIClientError('NOT_FOUND', `外部库不存在：${id}`)
  const status: ExternalRefIndexStatus = {
    externalRefId: id,
    state: 'queued',
    reason: 'manual',
    updatedAt: new Date().toISOString()
  }
  scheduleResourceIndexBuild(ref, 'manual')
  return status
}

async function instructionFileAt(poolPath: string): Promise<string | undefined> {
  const filename = 'AI_USAGE.md'
  const stat = await fs.stat(join(poolPath, filename)).catch(() => null)
  return stat?.isFile() ? filename : undefined
}

export async function addExternalRef(input: AddExternalInput): Promise<ExternalRef> {
  const id = newId()
  const addedAt = new Date().toISOString()

  if (input.kind === 'local') {
    const src = input.sourcePath.trim()
    if (!src || !isAbsolute(src)) {
      throw new UIClientError('VALIDATION', '外部库本地路径必须是绝对路径')
    }
    try {
      const stat = await fs.stat(src)
      if (!stat.isDirectory()) throw new UIClientError('NOT_DIR', `路径不是目录：${src}`)
    } catch (e) {
      if (e instanceof UIClientError) throw e
      throw new UIClientError('NOT_FOUND', `本地外部库目录不存在：${src}`)
    }
    const ref: ExternalRef = {
      id, alias: input.alias, kind: 'local', category: input.category,
      source: src, poolPath: src, addedAt,
      instructionFile: await instructionFileAt(src)
    }
    await externalPoolStore.add(ref)
    scheduleResourceIndexBuild(ref, 'first-import')
    return ref
  }

  // git
  const gitInput = input as AddGitExternalInput
  const url = gitInput.url.trim()
  const checkout = gitInput.checkout ? normalizeCheckoutOrThrow(gitInput.checkout) : undefined
  if (!/^(https?:\/\/|git@|file:\/\/|\/)/.test(url)) {
    throw new UIClientError(
      'VALIDATION',
      '外部库 git 地址只接受 https:// 、 git@ 、 file:// 或绝对路径'
    )
  }
  await fs.mkdir(poolRoot(), { recursive: true })
  const dest = poolEntryPath(id)
  try {
    await clone({ url, dest })
    await configureExternalGitRepo(dest)
    if (checkout) {
      await checkoutExternalRef(dest, checkout)
    }
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined)
    if (e instanceof UIClientError) throw e
    throw new UIClientError('GIT_FAILED', `git clone 失败：${(e as Error).message ?? String(e)}`)
  }
  // 外部 git 库统一只读：项目内只能消费，不允许编辑（专人维护是另外的入口）
  await lockExternalGitPool(dest).catch(() => undefined)
  const ref: ExternalRef = {
    id, alias: input.alias, kind: 'git', category: input.category,
    source: url, poolPath: dest, addedAt, lastSyncedAt: addedAt,
    instructionFile: await instructionFileAt(dest),
    ...(checkout ? { checkout } : {})
  }
  await externalPoolStore.add(ref)
  scheduleResourceIndexBuild(ref, 'first-import')
  return ref
}

async function checkoutExternalRef(poolPath: string, checkout: ExternalRefCheckout): Promise<void> {
  const normalized = normalizeCheckoutOrThrow(checkout)
  const sg = await gitForWithAskpass(poolPath)
  await sg.checkout(normalized.value)
}

function normalizeCheckoutOrThrow(checkout: ExternalRefCheckout): ExternalRefCheckout {
  try {
    return normalizeExternalCheckout(checkout)
  } catch (e) {
    throw new UIClientError('VALIDATION', e instanceof Error ? e.message : String(e))
  }
}

const ZG_INDEX_DIR_NAME = '.zvec-grep'

// Git 池只读锁：源码 555/444，但 zg 索引目录必须可写（query/index 都要在
// .zvec-grep/locks 下建租约）。把索引一起锁死会 EACCES。
async function lockExternalGitPool(path: string): Promise<void> {
  await chmodRecursive(path, 0o555, 0o444, { skipNames: new Set([ZG_INDEX_DIR_NAME]) })
  await chmodRecursive(join(path, ZG_INDEX_DIR_NAME), 0o755, 0o644).catch(() => undefined)
}

// 递归 chmod；symlink 跳过避免改源
async function chmodRecursive(
  path: string,
  dirMode: number,
  fileMode: number,
  opts: { skipNames?: Set<string> } = {}
): Promise<void> {
  const stat = await fs.lstat(path).catch(() => null)
  if (!stat) return
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    const entries = await fs.readdir(path)
    for (const e of entries) {
      if (opts.skipNames?.has(e)) continue
      await chmodRecursive(`${path}/${e}`, dirMode, fileMode, opts)
    }
    await fs.chmod(path, dirMode).catch(() => undefined)
    return
  }
  const executableBits = stat.mode & 0o111
  const nextMode = fileMode === 0o644 || fileMode === 0o444
    ? fileMode | executableBits
    : fileMode
  await fs.chmod(path, nextMode).catch(() => undefined)
}

async function configureExternalGitRepo(poolPath: string): Promise<void> {
  await gitFor(poolPath).raw(['config', 'core.filemode', 'false']).catch(() => undefined)
}

async function hasExternalLocalChanges(
  sg: Awaited<ReturnType<typeof gitForWithAskpass>>
): Promise<boolean> {
  const status = await sg.status()
  return typeof status.isClean === 'function' ? !status.isClean() : status.files.length > 0
}

// 删除池条目时级联清理：所有引用此 id 的工作区做 detach（删软链 + refs.json）。
// 池物理目录保留（决策：不破坏源数据；想真删让用户手工 rm）。
export async function removeExternalRef(id: string): Promise<void> {
  const ref = await externalPoolStore.findById(id)
  if (!ref) return

  const allWorkspaces = await workspacesStore.list()
  for (const ws of allWorkspaces) {
    if (ws.kind !== 'project') continue
    const bindings = await readRefs(ws.path)
    const hit = bindings.find((b) => b.externalRefId === id)
    if (!hit) continue
    await fs.unlink(join(externalDir(ws.path), hit.alias)).catch(() => undefined)
    await removeRef(ws.path, id)
    await syncWorkspaceTemplates(ws.path)
  }

  await externalPoolStore.remove(id)
}

export type RefreshResult = { ok: boolean; message?: string }

// interactive=false：auto-refresh / 启动时静默检测，缺凭证不弹 PATPromptDialog；
// interactive=true：用户在 UI 主动点"刷新"，缺凭证弹框正常。
export async function readExternalRefSyncStatus(
  id: string,
  opts: { interactive?: boolean } = {}
): Promise<ExternalRefSyncStatus> {
  const checkedAt = new Date().toISOString()
  const ref = await externalPoolStore.findById(id)
  if (!ref) {
    return {
      externalRefId: id,
      kind: 'git',
      ok: false,
      hasUpdates: false,
      behind: 0,
      checkedAt,
      message: 'NOT_FOUND'
    }
  }

  if (ref.kind === 'local') {
    return {
      externalRefId: id,
      kind: 'local',
      ok: true,
      hasUpdates: false,
      behind: 0,
      checkedAt
    }
  }

  try {
    await chmodRecursive(ref.poolPath, 0o755, 0o644)
    const sg = opts.interactive
      ? await gitForWithAskpass(ref.poolPath)
      : await gitForBackground(ref.poolPath)
    await sg.fetch(['--all', '--prune'])
    const upstream = await resolveCurrentUpstreamRef(sg)
    const behind = await countRevList(sg, `HEAD..${upstream}`)
    return {
      externalRefId: id,
      kind: 'git',
      ok: true,
      hasUpdates: behind > 0,
      behind,
      checkedAt
    }
  } catch (e) {
    return {
      externalRefId: id,
      kind: 'git',
      ok: false,
      hasUpdates: false,
      behind: 0,
      checkedAt,
      message: (e as Error).message ?? String(e)
    }
  } finally {
    await lockExternalGitPool(ref.poolPath).catch(() => undefined)
  }
}

export async function listExternalRefBranches(id: string): Promise<ExternalRefBranches> {
  const ref = await externalPoolStore.findById(id)
  if (!ref) throw new UIClientError('NOT_FOUND', `外部库不存在：${id}`)
  if (ref.kind !== 'git') {
    throw new UIClientError('VALIDATION', '只有 Git 外部库支持列分支')
  }

  const sg = await gitForWithAskpass(ref.poolPath)
  const output = await sg.raw(['branch', '-r', '--format=%(refname:short)'])
  return {
    externalRefId: ref.id,
    branches: parseRemoteBranches(output),
    current: await resolveCurrentBranchName(sg, ref),
    checkedAt: new Date().toISOString()
  }
}

function parseRemoteBranches(output: string): string[] {
  const seen = new Set<string>()
  const branches: string[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    let ref = rawLine.trim().replace(/^remotes\//, '')
    if (!ref || ref.includes('->')) continue
    const slash = ref.indexOf('/')
    if (slash >= 0) ref = ref.slice(slash + 1)
    if (!ref || ref === 'HEAD' || ref.endsWith('/HEAD')) continue
    if (seen.has(ref)) continue
    seen.add(ref)
    branches.push(ref)
  }
  return branches
}

async function resolveCurrentBranchName(
  sg: Awaited<ReturnType<typeof gitForWithAskpass>>,
  ref: ExternalRef
): Promise<string | null> {
  if (ref.checkout?.type === 'branch') return ref.checkout.value
  try {
    const summary = await sg.branch()
    return summary.current || null
  } catch {
    return null
  }
}

async function resolveCurrentUpstreamRef(sg: Awaited<ReturnType<typeof gitForWithAskpass>>): Promise<string> {
  try {
    const upstream = (await sg.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim()
    if (upstream) return upstream
  } catch { /* fallback below */ }

  const branch = await resolveRemoteDefaultBranch(sg)
  if (!branch) throw new Error('无法识别远端默认分支')
  return `origin/${branch}`
}

async function countRevList(
  sg: Awaited<ReturnType<typeof gitForWithAskpass>>,
  range: string
): Promise<number> {
  const output = await sg.raw(['rev-list', '--count', range])
  return parseInt(output.trim(), 10) || 0
}

export async function refreshExternalRef(
  id: string,
  opts: { interactive?: boolean } = {}
): Promise<RefreshResult> {
  const ref = await externalPoolStore.findById(id)
  if (!ref) return { ok: false, message: 'NOT_FOUND' }

  if (ref.kind === 'local') {
    try {
      const stat = await fs.stat(ref.source)
      if (!stat.isDirectory()) return { ok: false, message: 'SOURCE_GONE' }
    } catch {
      return { ok: false, message: 'SOURCE_GONE' }
    }
    await externalPoolStore.update(id, { instructionFile: await instructionFileAt(ref.poolPath) })
    return { ok: true }
  }

  // 外部 git 库统一只读：先解锁 → pull → 重新锁
  try {
    await chmodRecursive(ref.poolPath, 0o755, 0o644)
    await configureExternalGitRepo(ref.poolPath)
    const sg = opts.interactive
      ? await gitForWithAskpass(ref.poolPath)
      : await gitForBackground(ref.poolPath)
    if (await hasExternalLocalChanges(sg)) {
      return opts.interactive
        ? { ok: false, message: 'LOCAL_CHANGES: 资源库存在本地变更，已跳过更新。索引文件存放在 App 数据目录，不应写入资源库 Git 仓库。' }
        : { ok: true }
    }
    const beforeRevision = await readHeadRevision(sg)
    try {
      await sg.pull(['--rebase'])
    } catch (e) {
      if (!isMissingUpstreamRefError(e)) throw e
      await repairExternalDefaultBranch(sg)
      await sg.pull(['--rebase'])
    }
    await lockExternalGitPool(ref.poolPath)
    await externalPoolStore.update(id, {
      lastSyncedAt: new Date().toISOString(),
      instructionFile: await instructionFileAt(ref.poolPath)
    })
    const afterRevision = await readHeadRevision(sg)
    if (beforeRevision && afterRevision && beforeRevision !== afterRevision) {
      scheduleResourceIndexBuild({ ...ref, lastSyncedAt: new Date().toISOString() }, 'git-update')
    }
    return { ok: true }
  } catch (e) {
    await lockExternalGitPool(ref.poolPath).catch(() => undefined)
    return { ok: false, message: `GIT_CONFLICT: ${(e as Error).message ?? String(e)}` }
  }
}

async function readHeadRevision(
  sg: Awaited<ReturnType<typeof gitForWithAskpass>>
): Promise<string | null> {
  try {
    const revision = (await sg.raw(['rev-parse', 'HEAD'])).trim()
    return /^[0-9a-f]{7,64}$/i.test(revision) ? revision : null
  } catch {
    return null
  }
}

export async function switchExternalRefCheckout(
  id: string,
  checkout: ExternalRefCheckout
): Promise<ExternalRef> {
  const normalized = normalizeCheckoutOrThrow(checkout)
  const ref = await externalPoolStore.findById(id)
  if (!ref) throw new UIClientError('NOT_FOUND', `外部库不存在：${id}`)
  if (ref.kind !== 'git') {
    throw new UIClientError('VALIDATION', '只有 Git 外部库支持切换分支')
  }

  try {
    await chmodRecursive(ref.poolPath, 0o755, 0o644)
    const sg = await gitForWithAskpass(ref.poolPath)
    await sg.checkout(normalized.value)
    const updated: ExternalRef = {
      ...ref,
      checkout: normalized,
      lastSyncedAt: new Date().toISOString()
    }
    await externalPoolStore.update(id, {
      checkout: normalized,
      lastSyncedAt: updated.lastSyncedAt
    })
    scheduleResourceIndexBuild(updated, 'checkout-change')
    await syncAttachedExternalRefMetadata(updated)
    return updated
  } catch (e) {
    throw new UIClientError('GIT_FAILED', `切换外部库分支失败：${(e as Error).message ?? String(e)}`)
  } finally {
    await lockExternalGitPool(ref.poolPath).catch(() => undefined)
  }
}

async function syncAttachedExternalRefMetadata(ref: ExternalRef): Promise<void> {
  const allWorkspaces = await workspacesStore.list()
  for (const ws of allWorkspaces) {
    if (ws.kind !== 'project') continue
    const bindings = await readRefs(ws.path)
    const binding = bindings.find((item) => item.externalRefId === ref.id)
    if (!binding) continue
    await syncExternalManifestForAttach(ws.path, ref, binding)
    await syncWorkspaceTemplates(ws.path)
  }
}

function isMissingUpstreamRefError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('Your configuration specifies to merge with the ref') &&
    msg.includes('but no such ref was fetched')
}

async function repairExternalDefaultBranch(sg: Awaited<ReturnType<typeof gitForWithAskpass>>): Promise<void> {
  const branch = await resolveRemoteDefaultBranch(sg)
  if (!branch) throw new Error('无法识别远端默认分支')
  await sg.checkout(['-B', branch, `origin/${branch}`])
  await sg.raw(['branch', `--set-upstream-to=origin/${branch}`, branch])
}

async function resolveRemoteDefaultBranch(sg: Awaited<ReturnType<typeof gitForWithAskpass>>): Promise<string | null> {
  try {
    const symbolic = await sg.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    const branch = parseRemoteHeadRef(symbolic)
    if (branch) return branch
  } catch { /* fallback below */ }

  try {
    const remoteHead = await sg.raw(['ls-remote', '--symref', 'origin', 'HEAD'])
    return parseRemoteHeadRef(remoteHead)
  } catch {
    return null
  }
}

function parseRemoteHeadRef(output: string): string | null {
  const match = output.match(/refs\/(?:remotes\/origin|heads)\/([^\s]+)/)
  return match?.[1] ?? null
}

// 后台定时拉取所有 git 类外部条目。main/index.ts 启动时调一次然后 setInterval。
export const EXTERNAL_AUTO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000   // 24 小时
const AUTO_REFRESH_INITIAL_DELAY_MS = 5_000
let autoRefreshInitialTimer: NodeJS.Timeout | null = null
let autoRefreshIntervalTimer: NodeJS.Timeout | null = null
let autoRefreshInFlight = false

export async function refreshAllExternalRefs(): Promise<void> {
  const all = await externalPoolStore.list()
  for (const ref of all) {
    if (ref.kind !== 'git') continue
    // 后台 auto-refresh 永远走非交互；缺凭证 / 网络问题静默失败，不弹 PAT 框。
    await refreshExternalRef(ref.id, { interactive: false }).catch((e) => {
      console.warn('[external-pool] auto-refresh failed:', ref.alias, (e as Error).message)
    })
  }
}

export function startAutoRefresh(options?: {
  initialDelayMs?: number
  intervalMs?: number
}): void {
  if (autoRefreshInitialTimer || autoRefreshIntervalTimer) return
  void ensureMissingResourceIndexes().catch((e) => {
    console.warn('[resource-index] startup check failed:', (e as Error).message)
  })
  const initialDelayMs = options?.initialDelayMs ?? AUTO_REFRESH_INITIAL_DELAY_MS
  const intervalMs = options?.intervalMs ?? EXTERNAL_AUTO_REFRESH_INTERVAL_MS
  const run = async (): Promise<void> => {
    if (autoRefreshInFlight) return
    autoRefreshInFlight = true
    try {
      await refreshAllExternalRefs()
    } catch (e) {
      console.warn('[external-pool] scheduled refresh failed:', (e as Error).message)
    } finally {
      autoRefreshInFlight = false
    }
  }
  // 启动后稍等再跑一次（让 App 先稳定起来），之后周期检测。
  autoRefreshInitialTimer = setTimeout(async () => {
    autoRefreshInitialTimer = null
    await run()
  }, initialDelayMs)
  autoRefreshIntervalTimer = setInterval(run, intervalMs)
}

async function ensureMissingResourceIndexes(): Promise<void> {
  const refs = await externalPoolStore.list()
  for (const ref of refs) {
    const status = await readResourceIndexStatus(ref.id)
    if (
      status.state === 'missing'
      || status.state === 'error'
      || status.state === 'queued'
      || status.state === 'building'
    ) {
      scheduleResourceIndexBuild(ref, 'missing-index')
    }
  }
}

export function stopAutoRefresh(): void {
  if (autoRefreshInitialTimer) {
    clearTimeout(autoRefreshInitialTimer)
    autoRefreshInitialTimer = null
  }
  if (autoRefreshIntervalTimer) {
    clearInterval(autoRefreshIntervalTimer)
    autoRefreshIntervalTimer = null
  }
  autoRefreshInFlight = false
}

// 在工作区内挂载：创建 .external/<alias> 软链 + 写 refs.json + .gitignore 注入。
// 幂等：同一对 (workspaceId, externalRefId) 重复 attach 等价 no-op；同 alias 异 id 报 ALIAS_CONFLICT。
// 知识库和 UI 资产都允许多选；具体 feature 使用哪些资源由 feature 私有配置过滤。
export async function attachExternalRef(
  workspaceId: string,
  externalRefId: string,
  options: AttachOptions = {}
): Promise<void> {
  assertSymlinkSupported()

  const ws = await workspacesStore.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (ws.kind !== 'project') {
    throw new UIClientError('VALIDATION', '只有 project 工作区可挂载外部库')
  }
  const ref = await externalPoolStore.findById(externalRefId)
  if (!ref) throw new UIClientError('NOT_FOUND', `外部库不存在：${externalRefId}`)

  // 检查池物理路径是否还在（防被外部 rm）
  try {
    await fs.stat(ref.poolPath)
  } catch {
    throw new UIClientError('POOL_PATH_MISSING', `外部库池路径丢失：${ref.poolPath}`)
  }

  const linkDir = externalDir(ws.path)
  const linkPath = join(linkDir, ref.alias)

  const assetLibrary = ref.category === 'uikit' && options.assetLibrary?.trim()
    ? options.assetLibrary.trim()
    : undefined
  const usageNote = options.usageNote?.trim()
  if (usageNote && usageNote.length > 4000) {
    throw new UIClientError('VALIDATION', '项目级资源使用说明不能超过 4000 个字符')
  }

  // 已存在：检查是否软链且指向同一目标 → 幂等返回
  const existed = await fs.lstat(linkPath).then((s) => s).catch(() => null)
  if (existed) {
    if (existed.isSymbolicLink()) {
      const cur = await fs.readlink(linkPath).catch(() => '')
      if (cur === ref.poolPath) {
        // 软链已对；确认 refs.json 也对得上（addRef 自身幂等）
        const binding: ExternalRefBinding = {
          alias: ref.alias,
          externalRefId,
          addedAt: new Date().toISOString(),
          ...(assetLibrary ? { assetLibrary } : {}),
          ...(usageNote ? { usageNote } : {})
        }
        await addRef(ws.path, binding)
        if (assetLibrary || options.usageNote !== undefined) {
          // addRef 幂等返回时不会写入新字段；显式 patch 一遍把绑定配置落到 refs.json
          await updateRef(ws.path, externalRefId, {
            ...(assetLibrary ? { assetLibrary } : {}),
            ...(options.usageNote !== undefined ? { usageNote: options.usageNote } : {})
          }).catch(() => undefined)
        }
        if (options.syncManifest !== false) {
          await syncExternalManifestForAttach(
            ws.path,
            ref,
            await readCurrentExternalBinding(ws.path, externalRefId, binding)
          )
        }
        await syncWorkspaceTemplates(ws.path)
        return
      }
    }
    throw new UIClientError('ALIAS_CONFLICT', `工作区内已存在同名条目：${ref.alias}`)
  }

  await fs.mkdir(linkDir, { recursive: true })
  try {
    await fs.symlink(ref.poolPath, linkPath)
  } catch (e) {
    throw new UIClientError('SYMLINK_FAILED', `创建软链失败：${(e as Error).message}`)
  }

  const binding: ExternalRefBinding = {
    alias: ref.alias,
    externalRefId,
    addedAt: new Date().toISOString(),
    ...(assetLibrary ? { assetLibrary } : {}),
    ...(usageNote ? { usageNote } : {})
  }
  await addRef(ws.path, binding).catch(async (err) => {
    // refs.json 写入失败 → 回滚软链
    await fs.unlink(linkPath).catch(() => undefined)
    throw err
  })

  const gitDir = await fs.stat(join(ws.path, '.git')).catch(() => null)
  if (gitDir) await ensureGitignoreEntry(ws.path, `${EXTERNAL_DIR}/`).catch(() => undefined)
  if (options.syncManifest !== false) {
    await syncExternalManifestForAttach(
      ws.path,
      ref,
      await readCurrentExternalBinding(ws.path, externalRefId, binding)
    )
  }
  await syncWorkspaceTemplates(ws.path)
}

export async function readFeatureExternalRefs(
  workspaceId: string,
  featureRelPath: string
): Promise<FeatureResourceSelection & { configured: boolean }> {
  const ws = await workspacesStore.findById(workspaceId)
  if (!ws || ws.kind !== 'project') throw new UIClientError('NOT_FOUND', `根项目不存在：${workspaceId}`)
  const normalized = assertFeatureRelPath(featureRelPath)
  const stat = await fs.stat(join(ws.path, normalized)).catch(() => null)
  if (!stat?.isDirectory()) throw new UIClientError('NOT_FOUND', `项目不存在：${normalized}`)

  const configured = await readFeatureResourceSelection(ws.path, normalized)
  const availableIds = new Set((await externalPoolStore.list()).map((ref) => ref.id))
  if (configured) {
    return {
      ...configured,
      externalRefIds: configured.externalRefIds.filter((id) => availableIds.has(id)),
      configured: true
    }
  }

  const inherited = (await readRefs(ws.path))
    .map((binding) => binding.externalRefId)
    .filter((id) => availableIds.has(id))
  return {
    version: 1,
    externalRefIds: inherited,
    updatedAt: new Date(0).toISOString(),
    configured: false
  }
}

export async function updateFeatureExternalRefs(
  workspaceId: string,
  featureRelPath: string,
  externalRefIds: string[]
): Promise<FeatureResourceSelection> {
  const ws = await workspacesStore.findById(workspaceId)
  if (!ws || ws.kind !== 'project') throw new UIClientError('NOT_FOUND', `根项目不存在：${workspaceId}`)
  const normalized = assertFeatureRelPath(featureRelPath)
  const stat = await fs.stat(join(ws.path, normalized)).catch(() => null)
  if (!stat?.isDirectory()) throw new UIClientError('NOT_FOUND', `项目不存在：${normalized}`)

  if (!Array.isArray(externalRefIds) || externalRefIds.some((id) => typeof id !== 'string')) {
    throw new UIClientError('VALIDATION', 'externalRefIds 必须是字符串数组')
  }
  const ids = [...new Set(externalRefIds.map((id) => id.trim()).filter(Boolean))]
  const pool = await externalPoolStore.list()
  const available = new Map(pool.map((ref) => [ref.id, ref]))
  const missing = ids.find((id) => !available.has(id))
  if (missing) throw new UIClientError('NOT_FOUND', `资源包不存在：${missing}`)

  const attached = new Set((await readRefs(ws.path)).map((binding) => binding.externalRefId))
  for (const id of ids) {
    if (!attached.has(id)) {
      await attachExternalRef(workspaceId, id)
      attached.add(id)
    }
  }

  const selection = await writeFeatureResourceSelection(ws.path, normalized, ids)
  await syncWorkspaceTemplates(ws.path, 'project')
  return selection
}

async function readCurrentExternalBinding(
  workspacePath: string,
  externalRefId: string,
  fallback: ExternalRefBinding
): Promise<ExternalRefBinding> {
  const bindings = await readRefs(workspacePath)
  return bindings.find((binding) => binding.externalRefId === externalRefId) ?? fallback
}

async function syncExternalManifestForAttach(
  workspacePath: string,
  ref: ExternalRef,
  binding?: ExternalRefBinding
): Promise<void> {
  const manifestRef = externalRefToManifestRef(ref, binding)
  if (!manifestRef) return
  await upsertExternalManifestRef(workspacePath, manifestRef)
}

// 卸载：删软链 + 移除 refs.json 条目。不动池物理目录。
export async function detachExternalRef(
  workspaceId: string,
  externalRefId: string,
  options: AttachOptions = {}
): Promise<void> {
  const ws = await workspacesStore.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (ws.kind !== 'project') return

  const bindings = await readRefs(ws.path)
  const hit = bindings.find((b) => b.externalRefId === externalRefId)
  if (!hit) return

  await fs.unlink(join(externalDir(ws.path), hit.alias)).catch(() => undefined)
  await removeRef(ws.path, externalRefId)
  if (options.syncManifest !== false) await removeExternalManifestRef(ws.path, hit.alias)
  await syncWorkspaceTemplates(ws.path)
}

export async function getWorkspaceBindings(workspacePath: string): Promise<ExternalRefBinding[]> {
  return readRefs(workspacePath)
}

export async function updateExternalRefBinding(
  workspaceId: string,
  externalRefId: string,
  patch: Pick<ExternalRefBinding, 'visibleDirs' | 'assetLibrary' | 'usageNote'>
): Promise<ExternalRefBinding> {
  const ws = await workspacesStore.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (ws.kind !== 'project') {
    throw new UIClientError('VALIDATION', '只有 project 工作区可更新外部库绑定')
  }
  const ref = await externalPoolStore.findById(externalRefId)
  if (!ref) throw new UIClientError('NOT_FOUND', `外部库不存在：${externalRefId}`)
  const normalizedPatch: { visibleDirs?: string[]; assetLibrary?: string; usageNote?: string } = {}
  if (patch.visibleDirs !== undefined) {
    const visibleDirs = normalizeExternalVisibleDirs(patch.visibleDirs)
    if (visibleDirs.length > 0 && ref.category !== 'knowledge') {
      throw new UIClientError('VALIDATION', '只有知识库支持目录筛选')
    }
    normalizedPatch.visibleDirs = visibleDirs
  }
  if (patch.assetLibrary !== undefined) {
    if (patch.assetLibrary && ref.category !== 'uikit') {
      throw new UIClientError('VALIDATION', '只有 UI 资产区支持资产库选择')
    }
    normalizedPatch.assetLibrary = patch.assetLibrary
  }
  if (patch.usageNote !== undefined) {
    const usageNote = patch.usageNote.trim()
    if (usageNote.length > 4000) {
      throw new UIClientError('VALIDATION', '项目级资源使用说明不能超过 4000 个字符')
    }
    normalizedPatch.usageNote = usageNote
  }
  const updated = await updateRef(ws.path, externalRefId, normalizedPatch)
  if (ref.kind === 'git') await syncExternalManifestForAttach(ws.path, ref, updated)
  await syncWorkspaceTemplates(ws.path)
  return updated
}

// 查询源仓里有哪些资产库（components/<name>/），uikit 多资产库时让用户选用一个。
export async function listExternalRefAssetLibraries(
  externalRefId: string,
): Promise<{ libraries: { name: string; hasTheme: boolean; componentCount: number }[] }> {
  const ref = await externalPoolStore.findById(externalRefId)
  if (!ref) throw new UIClientError('NOT_FOUND', `外部库不存在：${externalRefId}`)
  if (ref.category !== 'uikit') return { libraries: [] }
  try {
    await fs.stat(ref.poolPath)
  } catch {
    throw new UIClientError('POOL_PATH_MISSING', `外部库池路径丢失：${ref.poolPath}`)
  }
  const libs = await listAssetLibraries(ref.poolPath)
  return {
    libraries: libs.map((lib) => ({
      name: lib.name,
      hasTheme: !!lib.theme,
      componentCount: lib.components.length,
    })),
  }
}

export async function hydrateExternalManifest(workspaceId: string): Promise<HydrateExternalManifestResult> {
  assertSymlinkSupported()

  const ws = await workspacesStore.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (ws.kind !== 'project') return { mounted: [], warnings: [] }

  const manifest = await readExternalManifest(ws.path)
  const mounted: string[] = []
  const warnings: string[] = []
  if (manifest.refs.length === 0) return { mounted, warnings }

  for (const dep of manifest.refs) {
    try {
      const ref = await ensurePoolRefFromManifest(dep)
      await attachExternalRef(workspaceId, ref.id, { syncManifest: false })
      if (ref.category === 'knowledge') {
        await updateRef(ws.path, ref.id, { visibleDirs: dep.visibleDirs ?? [] })
        await syncWorkspaceTemplates(ws.path)
      }
      mounted.push(dep.alias)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`外部依赖 ${dep.alias} 初始化失败：${msg}`)
    }
  }

  return { mounted, warnings }
}

async function ensurePoolRefFromManifest(dep: ExternalDependencyManifestRef): Promise<ExternalRef> {
  const existing = (await externalPoolStore.list()).find((ref) =>
    ref.kind === 'git' &&
    ref.alias === dep.alias &&
    ref.category === dep.category &&
    ref.source === dep.url
  )
  if (existing) {
    if (dep.checkout && !sameCheckout(existing.checkout, dep.checkout)) {
      return switchExternalRefCheckout(existing.id, dep.checkout)
    }
    // hydrate 是项目打开/新建时的后台同步——refresh 失败（缺凭证 / 网络不通）不要阻断 attach。
    // 前一次成功 clone 的内容仍在池里，attach 后用户依然能用；refresh 失败由 UI 上"过期"
    // 标识 + 用户主动点刷新（interactive=true）来触发 PAT 弹窗解决。
    const refreshed = await refreshExternalRef(existing.id, { interactive: false })
    if (!refreshed.ok) {
      console.warn('[external-pool] hydrate refresh skipped:', existing.alias, refreshed.message)
    }
    return existing
  }

  return addExternalRef({
    alias: dep.alias,
    category: dep.category,
    kind: 'git',
    url: dep.url,
    checkout: dep.checkout
  } as AddGitExternalInput)
}

function sameCheckout(a: ExternalRefCheckout | undefined, b: ExternalRefCheckout | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.type === b.type && a.value === b.value
}
