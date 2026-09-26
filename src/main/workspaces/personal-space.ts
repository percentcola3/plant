import { promises as fs } from 'node:fs'
import { app } from 'electron'
import { dirname, join } from 'node:path'
import type { PersonalSpace, PersonalSpaceList } from '@shared/types'
import { isAppManagedPath } from '../../shared/app-managed-paths'
import { WorkspacesStore } from './store'
import { personalSpacePath } from './paths'
import { gitFor, gitForWithAskpass } from '../git/client'
import { runPushOp } from '../git/ops'
import { readLocalGitUser, sanitizeBranchSegment } from '../git/identity'
import { hydrateExternalManifest } from '../external-pool/service'
import { UIClientError } from '../ipc/errors'
import { supportsPersonalSpaces } from '@shared/workspace-policy'
import {
  SPACE_BRANCH_PREFIX,
  hasRemoteSpaceBranch,
  listSpaceBranchSlugs
} from './personal-space-branches'

// 「个人空间」生命周期管理。
//
// 历史：原本只 UX 项目用、且只允许一个空间（spec 2026-06-09-unified-workspace-refactor-design.md）。
// 2026-06-24 重构后：
//   - PM + UX 项目共用，同一个工作区可有多个个人空间（多个 space/<slug> 分支）
//   - 支持「从已有分支创建」（fromBranch）
//   - 支持切换 / 移除
//
// 元信息持久化在 .ui-client/personal-space.json（私有，不入项目 git）。
// 新格式：{ spaces: PersonalSpace[], activeSlug }。老单 entry 格式自动迁移。
// 元信息只用于快速 UI 展示；当前激活分支以 git status 为准。

const store = new WorkspacesStore()
const PUBLIC_SPACE_SLUG = '__public__'

type GitStatusFiles = Array<{ path: string; index?: string; working_dir?: string }>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parsePersonalSpace(raw: unknown): PersonalSpace | null {
  if (!isPlainObject(raw)) return null
  const slug = typeof raw.slug === 'string' ? raw.slug : null
  const branch = typeof raw.branch === 'string' ? raw.branch : null
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : null
  if (!slug || !branch || !createdAt) return null
  const fromBranch = typeof raw.fromBranch === 'string' && raw.fromBranch ? raw.fromBranch : undefined
  return { slug, branch, createdAt, ...(fromBranch ? { fromBranch } : {}) }
}

function parseSpaceList(raw: unknown): PersonalSpaceList {
  // 新格式：{ spaces: [...], activeSlug }
  if (isPlainObject(raw) && Array.isArray(raw.spaces)) {
    const spaces = raw.spaces.map(parsePersonalSpace).filter((s): s is PersonalSpace => s !== null)
    const activeSlug = typeof raw.activeSlug === 'string' && spaces.some((s) => s.slug === raw.activeSlug)
      ? raw.activeSlug
      : (spaces[0]?.slug ?? null)
    return { spaces, activeSlug }
  }
  // 老单 entry 格式（< 2026-06-24）：直接是 PersonalSpace
  const single = parsePersonalSpace(raw)
  if (single) return { spaces: [single], activeSlug: single.slug }
  return { spaces: [], activeSlug: null }
}

function publicSpace(defaultBranch: string): PersonalSpace {
  return {
    slug: PUBLIC_SPACE_SLUG,
    branch: defaultBranch,
    createdAt: '',
    isPublic: true,
    displayName: '私密空间'
  }
}

function isPublicSpace(space: PersonalSpace): boolean {
  return space.isPublic === true || space.slug === PUBLIC_SPACE_SLUG
}

function withPublicSpace(spaces: PersonalSpace[], defaultBranch: string): PersonalSpace[] {
  return [
    publicSpace(defaultBranch),
    ...spaces.filter((space) => !isPublicSpace(space))
  ]
}

function stripRuntimeSpaces(list: PersonalSpaceList): PersonalSpaceList {
  return {
    spaces: list.spaces.filter((space) => !isPublicSpace(space)),
    activeSlug: list.activeSlug === PUBLIC_SPACE_SLUG ? null : list.activeSlug
  }
}

// ── git 辅助 ──

function dirtyChanges(status: { files?: GitStatusFiles }): string[] {
  return (status.files ?? [])
    .filter((file) => !isAppManagedPath(file.path))
    .map((file) => file.path)
}

function checkoutSafeManagedPaths(status: { files?: Array<{ path: string }> }): string[] {
  return Array.from(new Set((status.files ?? [])
    .map((file) => file.path)
    .filter((path) => isAppManagedPath(path))
    .filter((path) => !path.startsWith('.ui-client/') && !path.startsWith('.external/'))))
}

async function discardCheckoutBlockingManagedChanges(
  workspacePath: string,
  knownStatus?: { files?: Array<{ path: string }> }
): Promise<void> {
  const sg = gitFor(workspacePath)
  const status = knownStatus ?? await sg.status()
  const paths = checkoutSafeManagedPaths(status)
  if (paths.length === 0) return
  await sg.raw(['restore', '--staged', '--worktree', '--', ...paths])
    .then(() => null)
    .catch(() => undefined)
  await sg.raw(['clean', '-f', '-X', '--', ...paths])
    .then(() => null)
    .catch(() => undefined)
}

async function commitCurrentChanges(workspacePath: string, message: string): Promise<void> {
  const sg = gitFor(workspacePath)
  const status = await sg.status()
  if (status.isClean()) return
  const changes = dirtyChanges(status)
  if (changes.length === 0) return
  if (!message.trim()) {
    throw new UIClientError('VALIDATION', '保存版本时必须提供说明')
  }
  await sg.add(changes)
  await sg.commit(message)
}

async function ensureCleanOrCommit(
  workspacePath: string,
  message: string | undefined
): Promise<void> {
  const sg = gitFor(workspacePath)
  const status = await sg.status()
  if (status.isClean()) return
  const changes = dirtyChanges(status)
  if (changes.length === 0) {
    await discardCheckoutBlockingManagedChanges(workspacePath, status)
    return
  }
  if (!message || !message.trim()) {
    throw new UIClientError(
      'UNCOMMITTED_CHANGES',
      '当前工作区有未提交的改动。请先确认这些改动是否需要保存。',
      { changes }
    )
  }
  await commitCurrentChanges(workspacePath, message)
  await discardCheckoutBlockingManagedChanges(workspacePath)
}

async function pushBranchWithUpstream(workspacePath: string, branch: string, defaultBranch: string): Promise<void> {
  const result = await runPushOp(workspacePath, defaultBranch, { branch, setUpstream: true })
  if (result.ok) return
  const message = result.failure.kind === 'UNKNOWN'
    ? result.failure.raw
    : result.failure.kind === 'NETWORK' ? result.failure.detail : result.failure.kind
  throw new UIClientError('GIT_FAILED', `远程分支创建失败：${message}`)
}

async function refreshRemoteSpaceBranch(
  workspacePath: string,
  branch: string
): Promise<'fetched' | 'missing' | 'no-remote'> {
  const sg = await gitForWithAskpass(workspacePath)
  const remotes = await sg.raw(['remote']).catch(() => '')
  if (!remotes.split('\n').some((remote) => remote.trim() === 'origin')) return 'no-remote'

  let remoteBranch = ''
  try {
    remoteBranch = await sg.raw(['ls-remote', '--heads', 'origin', branch])
  } catch (error) {
    throw new UIClientError(
      'GIT_FAILED',
      `远程分支检查失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!remoteBranch.trim()) return 'missing'

  try {
    await sg.raw(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`])
  } catch (error) {
    throw new UIClientError(
      'GIT_FAILED',
      `远程分支拉取失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
  return 'fetched'
}

function personalSpaceWorktreePath(workspaceId: string, slug: string): string {
  return join(app.getPath('userData'), 'personal-space-worktrees', workspaceId, slug)
}

export function findWorktreePathForBranch(porcelain: string, branch: string): string | null {
  const expected = `refs/heads/${branch}`
  for (const block of porcelain.split(/\n\s*\n/)) {
    let worktreePath = ''
    let branchRef = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) worktreePath = line.slice('worktree '.length).trim()
      if (line.startsWith('branch ')) branchRef = line.slice('branch '.length).trim()
    }
    if (worktreePath && branchRef === expected) return worktreePath
  }
  return null
}

async function pathExists(path: string): Promise<boolean> {
  return fs.stat(path).then(() => true).catch(() => false)
}

async function ensurePersonalSpaceWorktree(
  workspacePath: string,
  workspaceId: string,
  target: PersonalSpace
): Promise<string> {
  const worktreePath = personalSpaceWorktreePath(workspaceId, target.slug)
  if (await pathExists(worktreePath)) return worktreePath
  const sg = gitFor(workspacePath)
  const summary = await sg.branchLocal()
  await fs.mkdir(dirname(worktreePath), { recursive: true })
  if (summary.all.includes(target.branch)) {
    await sg.raw(['worktree', 'add', worktreePath, target.branch])
    return worktreePath
  }
  if (!isPublicSpace(target) && await hasRemoteSpaceBranch(workspacePath, target.branch)) {
    await sg.raw(['worktree', 'add', '-b', target.branch, worktreePath, `origin/${target.branch}`])
    return worktreePath
  }
  throw new UIClientError(
    'GIT_FAILED',
    `分支已被删除：${target.branch}。请先移除该空间再重新创建。`
  )
}

async function createPersonalSpaceWorktree(
  workspacePath: string,
  workspaceId: string,
  space: PersonalSpace,
  fromBranch: string
): Promise<string> {
  const worktreePath = personalSpaceWorktreePath(workspaceId, space.slug)
  if (await pathExists(worktreePath)) return worktreePath
  await fs.mkdir(dirname(worktreePath), { recursive: true })
  await gitFor(workspacePath).raw(['worktree', 'add', '-b', space.branch, worktreePath, fromBranch])
  return worktreePath
}

async function writeMeta(workspacePath: string, list: PersonalSpaceList): Promise<void> {
  const persisted = stripRuntimeSpaces(list)
  await fs.mkdir(`${workspacePath}/.ui-client`, { recursive: true })
  await fs.writeFile(
    personalSpacePath(workspacePath),
    JSON.stringify(persisted, null, 2),
    'utf-8'
  )
}

// create/switch 切完分支后跑一次外联同步：manifest 跟分支走（commit 进 git），
// 但 .ui-client/refs.json 和 .external/ 软链是 gitignored，不会自动跟着 checkout 走。
// hydrate 失败不抛——以 warning 形式返回，UI 决定是否提示。
async function runHydrate(workspaceId: string): Promise<string[]> {
  try {
    const r = await hydrateExternalManifest(workspaceId)
    return r.warnings
  } catch (e) {
    return [`外部依赖初始化失败：${e instanceof Error ? e.message : String(e)}`]
  }
}

function attachWarnings(space: PersonalSpace, warnings: string[]): PersonalSpace {
  return warnings.length > 0 ? { ...space, externalInitWarnings: warnings } : space
}

// ── 对外 API ──

async function getOwnedWorkspace(workspaceId: string): Promise<{ path: string; defaultBranch: string }> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (!supportsPersonalSpaces(ws)) {
    if (ws.workflowMode === 'simple') {
      throw new UIClientError('VALIDATION', '简化项目不使用个人空间')
    }
    throw new UIClientError('VALIDATION', '只有 PM / UX 工作区可创建个人空间')
  }
  return { path: ws.path, defaultBranch: ws.defaultBranch }
}

// 默认 slug：优先用 git user.name，清洗失败兜底 'work'。
async function defaultSlug(workspacePath: string): Promise<string> {
  try {
    const { name } = await readLocalGitUser(workspacePath)
    const seg = sanitizeBranchSegment(name)
    if (seg && seg !== 'work') return seg
  } catch { /* ignore */ }
  return 'work'
}

export async function listPersonalSpaces(workspaceId: string): Promise<PersonalSpaceList> {
  const { path, defaultBranch } = await getOwnedWorkspace(workspaceId)
  return listPersonalSpacesByPath(path, defaultBranch)
}

export async function resolvePersonalSpaceWorktreePath(
  workspaceId: string,
  spaceSlug: string
): Promise<string> {
  const { path, defaultBranch } = await getOwnedWorkspace(workspaceId)
  const list = await listPersonalSpacesByPath(path, defaultBranch)
  const target = list.spaces.find((space) => space.slug === spaceSlug)
  if (!target) throw new UIClientError('NOT_FOUND', `工作空间不存在：${spaceSlug}`)

  const porcelain = await gitFor(path).raw(['worktree', 'list', '--porcelain'])
  const existingPath = findWorktreePathForBranch(porcelain, target.branch)
  if (existingPath) return existingPath
  return ensurePersonalSpaceWorktree(path, workspaceId, target)
}

// 按路径读个人空间快照：以 git space/* 分支（本地 + origin）为权威，meta 补齐 createdAt/fromBranch。
// 这样同事在远端创建的 space 分支也能在本机 UI 上看见，不再受限于本地私有 meta 文件。
export async function listPersonalSpacesByPath(workspacePath: string, defaultBranch = 'main'): Promise<PersonalSpaceList> {
  let meta: PersonalSpaceList = { spaces: [], activeSlug: null }
  try {
    const text = await fs.readFile(personalSpacePath(workspacePath), 'utf-8')
    meta = parseSpaceList(JSON.parse(text))
  } catch { /* meta 缺失也 OK，从 git 推断 */ }

  const slugs = await listSpaceBranchSlugs(workspacePath)
  const metaBySlug = new Map(meta.spaces.map((s) => [s.slug, s]))
  const personalSpaces: PersonalSpace[] = slugs.length === 0
    ? meta.spaces
    : slugs.map((slug) => {
      const m = metaBySlug.get(slug)
      return m ?? { slug, branch: `${SPACE_BRANCH_PREFIX}${slug}`, createdAt: '' }
    })
  const spaces = withPublicSpace(personalSpaces, defaultBranch)

  let activeSlug: string | null = null
  try {
    const status = await gitFor(workspacePath).status()
    const current = status.current ?? ''
    if (current === defaultBranch) {
      activeSlug = PUBLIC_SPACE_SLUG
    } else if (current.startsWith(SPACE_BRANCH_PREFIX)) {
      const slug = current.slice(SPACE_BRANCH_PREFIX.length)
      if (spaces.some((s) => s.slug === slug)) activeSlug = slug
    }
  } catch { /* ignore */ }
  if (!activeSlug && meta.activeSlug && spaces.some((s) => s.slug === meta.activeSlug)) {
    activeSlug = meta.activeSlug
  }
  return { spaces, activeSlug }
}

// 兼容旧 API：读当前激活的个人空间（list 里 activeSlug 对应那个）。
export async function readPersonalSpace(workspaceId: string): Promise<PersonalSpace | null> {
  const list = await listPersonalSpaces(workspaceId)
  return list.spaces.find((s) => s.slug === list.activeSlug) ?? list.spaces[0] ?? null
}

export async function readPersonalSpaceByPath(workspacePath: string, defaultBranch = 'main'): Promise<PersonalSpace | null> {
  const list = await listPersonalSpacesByPath(workspacePath, defaultBranch)
  return list.spaces.find((s) => s.slug === list.activeSlug) ?? list.spaces[0] ?? null
}

export type CreatePersonalSpaceInput = {
  workspaceId: string
  slug?: string                       // 缺省 = git user.name 清洗
  fromBranch?: string                 // 缺省 = workspace.defaultBranch（main）
  preCommitMessage?: string
}

// 创建一个新的个人空间。slug 冲突 → 抛 ALIAS_CONFLICT。
export async function createPersonalSpace(input: CreatePersonalSpaceInput): Promise<PersonalSpace> {
  const { path, defaultBranch } = await getOwnedWorkspace(input.workspaceId)
  const sg = gitFor(path)
  const list = await listPersonalSpacesByPath(path, defaultBranch)

  const slugRaw = (input.slug ?? '').trim() || await defaultSlug(path)
  const slug = sanitizeBranchSegment(slugRaw) || 'work'
  const branch = `${SPACE_BRANCH_PREFIX}${slug}`

  if (list.spaces.some((s) => s.slug === slug)) {
    throw new UIClientError('ALIAS_CONFLICT', `已存在同名个人空间：${slug}`)
  }

  const fromBranch = (input.fromBranch ?? '').trim() || defaultBranch

  // 验证 fromBranch 存在（本地或远端追踪）
  const summary = await sg.branchLocal()
  if (!summary.all.includes(fromBranch)) {
    throw new UIClientError('GIT_FAILED', `来源分支不存在：${fromBranch}`)
  }

  const now = new Date().toISOString()
  const space: PersonalSpace = {
    slug,
    branch,
    createdAt: now,
    ...(fromBranch !== defaultBranch ? { fromBranch } : {})
  }
  const nextList: PersonalSpaceList = {
    spaces: [...list.spaces, space],
    activeSlug: slug
  }
  const worktreePath = summary.all.includes(branch)
    ? await ensurePersonalSpaceWorktree(path, input.workspaceId, space)
    : await createPersonalSpaceWorktree(path, input.workspaceId, space, fromBranch)
  await store.updateWorkspace(input.workspaceId, { path: worktreePath })
  await writeMeta(worktreePath, nextList)

  await pushBranchWithUpstream(worktreePath, branch, defaultBranch)
  const warnings = await runHydrate(input.workspaceId)
  return attachWarnings(space, warnings)
}

export type SwitchPersonalSpaceInput = {
  workspaceId: string
  slug: string
  preCommitMessage?: string
}

export async function switchPersonalSpace(input: SwitchPersonalSpaceInput): Promise<PersonalSpace> {
  const { path, defaultBranch } = await getOwnedWorkspace(input.workspaceId)
  const list = await listPersonalSpacesByPath(path, defaultBranch)
  const target = list.spaces.find((s) => s.slug === input.slug)
  if (!target) {
    throw new UIClientError('NOT_FOUND', `个人空间不存在：${input.slug}`)
  }
  const sg = gitFor(path)
  const status = await sg.status()
  if (status.current === target.branch) {
    // 已经在目标分支，仅同步 activeSlug
    if (!isPublicSpace(target) && list.activeSlug !== target.slug) {
      await writeMeta(path, { ...list, activeSlug: target.slug })
    }
    const warnings = await runHydrate(input.workspaceId)
    return attachWarnings(target, warnings)
  }
  const worktreePath = await ensurePersonalSpaceWorktree(path, input.workspaceId, target)
  await store.updateWorkspace(input.workspaceId, { path: worktreePath })
  await writeMeta(worktreePath, { ...list, activeSlug: target.slug })
  const warnings = await runHydrate(input.workspaceId)
  return attachWarnings(target, warnings)
}

export type RemovePersonalSpaceInput = {
  workspaceId: string
  slug: string
  preCommitMessage?: string
}

// 移除一个个人空间：删本地 space/<slug> 分支 + 从 meta 抹去。
// 不主动 push delete 远端（用户自己 `git push origin --delete space/<slug>`）。
export async function removePersonalSpace(input: RemovePersonalSpaceInput): Promise<PersonalSpaceList> {
  const { path, defaultBranch } = await getOwnedWorkspace(input.workspaceId)
  const list = await listPersonalSpacesByPath(path, defaultBranch)
  const target = list.spaces.find((s) => s.slug === input.slug)
  if (!target) {
    throw new UIClientError('NOT_FOUND', `个人空间不存在：${input.slug}`)
  }
  if (isPublicSpace(target)) {
    throw new UIClientError('VALIDATION', '私密空间不能移除')
  }
  const sg = gitFor(path)
  const status = await sg.status()
  if (status.current === target.branch) {
    // 当前正在被删除的分支上 → 先切到默认分支再删，否则 git 拒绝
    await ensureCleanOrCommit(path, input.preCommitMessage)
    await sg.checkout(defaultBranch)
  }
  const summary = await sg.branchLocal()
  if (summary.all.includes(target.branch)) {
    await sg.raw(['branch', '-D', target.branch]).catch((e) => {
      throw new UIClientError('GIT_FAILED', `删除本地分支失败：${(e as Error).message}`)
    })
  }
  const remaining = list.spaces.filter((s) => s.slug !== target.slug)
  const nextActive = list.activeSlug === target.slug
    ? (remaining[0]?.slug ?? null)
    : list.activeSlug
  const nextList: PersonalSpaceList = { spaces: remaining, activeSlug: nextActive }
  await writeMeta(path, nextList)
  return nextList
}

export type EnsurePersonalSpaceInput = {
  workspaceId: string
  slug?: string
  preCommitMessage?: string
}

// 指定 slug 时确保该空间在远端/本地存在并切换；未指定时兼容旧逻辑，
// 继续使用当前 activeSlug，没有个人空间才按默认 slug 创建。
export async function ensurePersonalSpace(input: EnsurePersonalSpaceInput): Promise<PersonalSpace> {
  const { path, defaultBranch } = await getOwnedWorkspace(input.workspaceId)
  let list = await listPersonalSpacesByPath(path, defaultBranch)
  const requestedSlugRaw = (input.slug ?? '').trim()
  if (requestedSlugRaw) {
    const requestedSlug = sanitizeBranchSegment(requestedSlugRaw) || 'work'
    const branch = `${SPACE_BRANCH_PREFIX}${requestedSlug}`
    let target = list.spaces.find((space) => space.slug === requestedSlug)
    const remoteState = await refreshRemoteSpaceBranch(path, branch)
    if (remoteState === 'fetched') {
      list = await listPersonalSpacesByPath(path, defaultBranch)
      target = list.spaces.find((space) => space.slug === requestedSlug)
      if (!target) {
        throw new UIClientError('GIT_FAILED', `远程分支拉取后仍无法识别：${branch}`)
      }
    }
    if (target) {
      const switched = await switchPersonalSpace({
        workspaceId: input.workspaceId,
        slug: target.slug,
        preCommitMessage: input.preCommitMessage
      })
      if (remoteState === 'missing') {
        const current = await getOwnedWorkspace(input.workspaceId)
        await pushBranchWithUpstream(current.path, target.branch, defaultBranch)
      }
      return switched
    }
    return createPersonalSpace({
      workspaceId: input.workspaceId,
      slug: requestedSlug,
      preCommitMessage: input.preCommitMessage
    })
  }
  if (list.activeSlug) {
    const target = list.spaces.find((s) => s.slug === list.activeSlug)
    if (target && !isPublicSpace(target)) {
      return switchPersonalSpace({
        workspaceId: input.workspaceId,
        slug: target.slug,
        preCommitMessage: input.preCommitMessage
      })
    }
  }
  return createPersonalSpace({
    workspaceId: input.workspaceId,
    slug: input.slug,
    preCommitMessage: input.preCommitMessage
  })
}
