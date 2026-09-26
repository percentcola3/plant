import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExternalRef, ExternalRefBinding, WorkspaceKind } from '@shared/types'
import { APP_MANAGED_GITIGNORE_ENTRIES } from '@shared/app-managed-paths'
import { externalPoolStore } from '../external-pool/store'
import { ensureGitignoreEntry } from '../projects/gitignore'
import { activeReqPath } from './paths'
import { readRefs } from './refs'
import { readActiveWorkArea, type ActiveWorkArea } from './work-area'
import { syncManagedHooks } from './managed-hooks'
import { syncCursorRulesFromSystemDoc } from './ui-asset-rules'
import { ensureSystemDoc } from './system-doc'
import { readFeatureResourceSelection } from '../features/resources'

const PROJECT_DOCS_ROOT = 'docs'
const PROJECT_UI_ROOT = 'ui'
const PROJECT_FEATURES_ROOT = 'features'
const UX_COMPONENTS_ROOT = 'components'
const UX_DESIGN_SYSTEMS_ROOT = 'design-systems'
const UX_ASSETS_ROOT = 'assets'
const UX_OUTPUTS_ROOT = 'outputs'
type TemplateWorkspaceKind = Extract<WorkspaceKind, 'project' | 'ux'>

// 按工作区 kind 暴露不同的 skill 集合：
// - project（PM 项目）：pm-* skills，加共享 _shared/
// - ux（UI 项目）：ui-* skills，加共享 _shared/
//
// _shared/ 里放 component-spec.md / brainstorm-core.md / summary-core.md
// 等共用约束 + 流程骨架，各 skill 通过 `_shared/<file>` 引用。
// 改 SKILL_SETS 时同步改 templates.test.ts 覆盖。
// 给 skill-template 列表 / 装入流程反查 kind 用，导出。改这里时同步 templates.test.ts。
export const SKILL_SETS: Record<TemplateWorkspaceKind, readonly string[]> = {
  project: [
    'ux-design',
    'prd-tech-review',
    'knowledge-search',
    'pm-brainstorm',
    'pm-prd',
    'pm-prd-tech-analysis',
    'pm-ui-execute',
    'pm-summary'
  ],
  ux: [
    'ui-brainstorm',
    'ui-execute',
    'ui-distill',
    'ui-summary'
  ]
}

export const SHARED_TEMPLATE_DIR = '_shared'

// 老 sync 逻辑用的扁平列表，restoreSkillTemplate 接口校验仍要用。所有 kind 的所有 skill 合一份。
const ALL_SKILL_NAMES: readonly string[] = Array.from(
  new Set([...SKILL_SETS.project, ...SKILL_SETS.ux, SHARED_TEMPLATE_DIR])
)

type ResolvedRef = {
  binding: ExternalRefBinding
  ref: ExternalRef
}

type ContextRef = {
  alias: string
  path: string
  paths: string[]
  visibleDirs?: string[]
  kind: ExternalRef['kind']
  source: string
  readonly: boolean
  category?: ExternalRef['category']
  instructionPath?: string
  usageNote?: string
}

type ProjectContext = {
  version: 1
  role: 'workspace'
  // 工作区类型。runtime-context hook 读了用它拼「当前工作区类型」文案，
  // skill 模板和 PreToolUse hook 不依赖此字段。
  kind: TemplateWorkspaceKind
  activeRequirementId: string | null
  activeWorkArea: ActiveWorkArea | null
  activeWorkspace: string | null
  editableRoots: string[]
  kbRefs: ContextRef[]
  knowledgeBase: ContextRef[]
  uiAssets: ContextRef[]
  externalRefs: ContextRef[]
}

// 同一 workspace 的 sync 不允许并发：rm + mkdir + cp 序列非原子，
// 重入会导致 EEXIST / 文件被中途删掉等竞态。
// 简化策略：dedup 重入调用，第二个 caller 等同一个 promise；
// 想拿到"context 变化后的最新 sync"的 caller 在该 promise resolve 后再调一次。
const inFlightSyncs = new Map<string, Promise<void>>()

export async function syncWorkspaceTemplates(
  workspacePath: string,
  kind: TemplateWorkspaceKind = 'project'
): Promise<void> {
  const existing = inFlightSyncs.get(workspacePath)
  if (existing) return existing
  const promise = doSyncWorkspaceTemplates(workspacePath, kind).finally(() => {
    if (inFlightSyncs.get(workspacePath) === promise) inFlightSyncs.delete(workspacePath)
  })
  inFlightSyncs.set(workspacePath, promise)
  return promise
}

// 兼容老 PM 项目残留的 .ui-client/active-requirement 文件：仅用于让 project-context.json
// 在过渡期还原老的 activeRequirementId 字段，新项目不再写入此文件。
async function readLegacyActiveRequirementId(workspacePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(activeReqPath(workspacePath), 'utf-8')
    const value = raw.trim()
    return value ? value : null
  } catch {
    return null
  }
}

async function doSyncWorkspaceTemplates(
  workspacePath: string,
  kind: TemplateWorkspaceKind
): Promise<void> {
  const [activeRequirementId, activeWorkArea, resolvedRefs] = await Promise.all([
    readLegacyActiveRequirementId(workspacePath),
    readActiveWorkArea(workspacePath),
    resolveRefs(workspacePath)
  ])
  const scopedRefs = await resolveWorkAreaRefs(workspacePath, activeWorkArea, resolvedRefs)
  const context = buildProjectContext(kind, activeRequirementId, activeWorkArea, scopedRefs)

  // 先确保根 system.md 就位（并给已有 CLAUDE.md/AGENTS.md 注入 @system.md），再镜像 Cursor。
  await ensureSystemDoc(workspacePath).catch(() => undefined)

  await Promise.all([
    ensureAppManagedGitignore(workspacePath),
    writeProjectContext(workspacePath, context),
    syncManagedHooks(workspacePath),
    // Cursor 适配：从 system.md 镜像 .cursor/rules（App 自管文件，不碰用户文件）。
    syncCursorRulesFromSystemDoc(workspacePath)
  ])
  // 注：
  // - skill 模板由用户主动装入，不再 auto-scaffold。
  // - AI 业务约束（UI 资产/生成硬约束）已交还用户，事实源在 CLAUDE.md / AGENTS.md，
  //   App 不再 upsert 这两个文件（见 ui-asset-rules.ts、ProjectRulesPanel.vue）。
}

async function resolveWorkAreaRefs(
  workspacePath: string,
  activeWorkArea: ActiveWorkArea | null,
  refs: ResolvedRef[]
): Promise<ResolvedRef[]> {
  if (activeWorkArea?.kind !== 'feature') return refs
  const selection = await readFeatureResourceSelection(workspacePath, activeWorkArea.relPath)
  // 创建项目总会写下 resources.json。空数组表示还没关联（或工作区后来才挂上知识库），
  // 不是「明确不要任何库」。缺文件和空列表都继承工作区挂载；非空列表才过滤。
  if (!selection || selection.externalRefIds.length === 0) return refs
  const selectedIds = new Set(selection.externalRefIds)
  return refs.filter(({ ref }) => selectedIds.has(ref.id))
}

async function ensureAppManagedGitignore(workspacePath: string): Promise<void> {
  const gitDir = await fs.stat(join(workspacePath, '.git')).catch(() => null)
  if (!gitDir) return
  for (const entry of APP_MANAGED_GITIGNORE_ENTRIES) {
    await ensureGitignoreEntry(workspacePath, entry)
  }
}

async function resolveRefs(workspacePath: string): Promise<ResolvedRef[]> {
  const [bindings, pool] = await Promise.all([
    readRefs(workspacePath),
    externalPoolStore.list()
  ])
  const refsById = new Map(pool.map((ref) => [ref.id, ref]))
  return bindings.flatMap((binding) => {
    const ref = refsById.get(binding.externalRefId)
    return ref ? [{ binding, ref }] : []
  })
}

function buildProjectContext(
  kind: TemplateWorkspaceKind,
  activeRequirementId: string | null,
  activeWorkArea: ActiveWorkArea | null,
  refs: ResolvedRef[]
): ProjectContext {
  const effectiveWorkArea = resolveEffectiveWorkArea(kind, activeWorkArea)
  const activeWorkspace = effectiveWorkArea?.relPath ?? defaultActiveWorkspace(kind, activeRequirementId)
  const editableRoots = buildEditableRoots(kind, effectiveWorkArea)

  const toContextRef = ({ binding, ref }: ResolvedRef): ContextRef => {
    const path = `.external/${binding.alias}`
    const visibleDirs = ref.category === 'knowledge' ? (binding.visibleDirs ?? []) : []
    return {
      alias: binding.alias,
      path,
      paths: visibleDirs.length > 0
        ? visibleDirs.map((dir) => `${path}/${dir}`)
        : [path],
      ...(visibleDirs.length > 0 ? { visibleDirs } : {}),
      kind: ref.kind,
      source: ref.source,
      readonly: true,
      category: ref.category,
      instructionPath: `${path}/AI_USAGE.md`,
      ...(binding.usageNote ? { usageNote: binding.usageNote } : {})
    }
  }

  const all = refs.map(toContextRef)
  const kbRefs = refs.filter(({ ref }) => ref.category === 'knowledge').map(toContextRef)
  const externalUiAssets = refs.filter(({ ref }) => ref.category === 'uikit').map(toContextRef)
  const uiAssets = kind === 'ux'
    ? [...localUxUiAssets(), ...externalUiAssets]
    : externalUiAssets

  return {
    version: 1,
    role: 'workspace',
    kind,
    activeRequirementId,
    activeWorkArea: effectiveWorkArea,
    activeWorkspace,
    editableRoots,
    kbRefs,
    knowledgeBase: kbRefs,
    uiAssets,
    externalRefs: all
  }
}

function localUxUiAssets(): ContextRef[] {
  return [
    {
      alias: 'workspace-components',
      path: UX_COMPONENTS_ROOT,
      paths: [UX_COMPONENTS_ROOT],
      kind: 'local',
      source: 'workspace',
      readonly: false
    },
    {
      alias: 'workspace-assets',
      path: UX_ASSETS_ROOT,
      paths: [UX_ASSETS_ROOT],
      kind: 'local',
      source: 'workspace',
      readonly: false
    },
    {
      alias: 'workspace-design-systems',
      path: UX_DESIGN_SYSTEMS_ROOT,
      paths: [UX_DESIGN_SYSTEMS_ROOT],
      kind: 'local',
      source: 'workspace',
      readonly: false
    }
  ]
}

function defaultActiveWorkspace(kind: TemplateWorkspaceKind, activeRequirementId: string | null): string {
  if (kind === 'ux') return 'components/ + design-systems/ + assets/ + outputs/'
  if (activeRequirementId) return 'docs/ + ui/'
  return 'features/ + .external/'
}

function resolveEffectiveWorkArea(
  kind: TemplateWorkspaceKind,
  activeWorkArea: ActiveWorkArea | null
): ActiveWorkArea | null {
  if (!activeWorkArea) return null
  const relPath = activeWorkArea.relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  const uiRoot = kind === 'ux' ? UX_OUTPUTS_ROOT : PROJECT_UI_ROOT
  if (activeWorkArea.kind === 'ui-product' && !relPath.startsWith(`${uiRoot}/`)) return null
  if (activeWorkArea.kind === 'ui-component') {
    if (kind !== 'ux' || !relPath.startsWith(`${UX_COMPONENTS_ROOT}/`)) return null
    return { kind: activeWorkArea.kind, relPath }
  }
  if (activeWorkArea.kind === 'document' && !relPath.startsWith(`${PROJECT_DOCS_ROOT}/`)) return null
  if (activeWorkArea.kind === 'feature') {
    if (kind !== 'project' || !relPath.startsWith(`${PROJECT_FEATURES_ROOT}/`)) return null
    return { kind: activeWorkArea.kind, relPath }
  }
  return { kind: activeWorkArea.kind, relPath }
}

function buildEditableRoots(
  kind: TemplateWorkspaceKind,
  activeWorkArea: ActiveWorkArea | null
): string[] {
  if (activeWorkArea) {
    if (
      activeWorkArea.kind === 'ui-product'
      || activeWorkArea.kind === 'ui-component'
      || activeWorkArea.kind === 'feature'
    ) {
      return [`${activeWorkArea.relPath}/`]
    }
    return [activeWorkArea.relPath]
  }
  if (kind === 'ux') {
    return [
      `${UX_COMPONENTS_ROOT}/`,
      `${UX_DESIGN_SYSTEMS_ROOT}/`,
      `${UX_ASSETS_ROOT}/`,
      `${UX_OUTPUTS_ROOT}/`
    ]
  }
  // PM 项目（2026-06-24 重构后）所有产物都在 features/<slug>/ 下；
  // 老的 docs/ + ui/ 已废，不再做默认可写根。
  return [`${PROJECT_FEATURES_ROOT}/`]
}

async function writeProjectContext(workspacePath: string, context: ProjectContext): Promise<void> {
  const path = join(workspacePath, '.workspace', 'project-context.json')
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, JSON.stringify(context, null, 2) + '\n', 'utf-8')
}

// 显式把单个 skill 恢复成模板版本（覆盖用户改动）。"恢复模板" 按钮调用。
// kind 不传 = 兼容老调用：从 SHARED + 所有 kind 的并集里找名字
export async function restoreSkillTemplate(workspacePath: string, skillName: string): Promise<void> {
  if (!ALL_SKILL_NAMES.includes(skillName)) {
    throw new Error(`未知 skill 模板：${skillName}`)
  }
  const root = await resolveSkillTemplateRoot()
  await Promise.all([
    overwriteSkillFromTemplate(root, join(workspacePath, '.claude', 'skills'), skillName),
    overwriteSkillFromTemplate(root, join(workspacePath, '.agents', 'skills'), skillName)
  ])
}

async function overwriteSkillFromTemplate(root: string, targetRoot: string, skillName: string): Promise<void> {
  const target = join(targetRoot, skillName)
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(targetRoot, { recursive: true })
  await fs.cp(join(root, skillName), target, { recursive: true, force: true })
}

export async function resolveSkillTemplateRoot(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = skillTemplateRootCandidates(here)
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => null)
    if (stat?.isDirectory()) return candidate
  }
  throw new Error('skill templates directory not found')
}

export function skillTemplateRootCandidates(
  here: string,
  cwd = process.cwd(),
  resourcesPath = process.resourcesPath
): string[] {
  const candidates = [
    join(cwd, 'resources', 'skill-templates'),
    join(here, '..', '..', '..', 'resources', 'skill-templates'),
    join(here, '..', '..', 'resources', 'skill-templates')
  ]
  if (resourcesPath) candidates.unshift(join(resourcesPath, 'skill-templates'))
  return candidates
}
