import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  SkillSource,
  SkillSummary,
  SkillTemplateInfo,
  SkillTemplateKind,
  SkillInstallResult
} from '@shared/types'
import { SKILL_SETS, SHARED_TEMPLATE_DIR } from '../workspaces/templates'
import { syncSkillSubtree, removeHashPrefix } from '../workspaces/skill-sync'

// 项目级 skills 暴露：以 .claude/skills/<name>/ 文件夹为单位列出，
// SKILL.md 仅作为入口和 frontmatter 来源；目录内其它说明、脚本和资源同属一个 Skill。
// 恢复模板复用 workspaces/templates.ts 的 restoreSkillTemplate。

const SKILL_PARENT_DIRS = [
  ['.claude', 'skills'],
  ['.agents', 'skills']
] as const

export const BUILTIN_SKILL_NAMES = [
  'ux-design',
  'prd-tech-review',
  'knowledge-search'
] as const

// 禁用区子目录名。Claude Code / Codex 默认不扫描点开头目录，所以放这里就不会被加载。
const DISABLED_DIR = '.disabled'

// 三个核心 Skill 随 App 提供，但落到工作区后就是普通可编辑文件夹。
// 未改过的副本随模板升级；用户改过的保留；仅存在于禁用区的不要复活。
export async function ensureBuiltinSkills(
  workspacePath: string,
  templatesRoot: string
): Promise<void> {
  for (const name of BUILTIN_SKILL_NAMES) {
    const templateDir = join(templatesRoot, name)
    const templateExists = await fs.stat(join(templateDir, 'SKILL.md')).then(() => true).catch(() => false)
    if (!templateExists) continue

    const locations = await Promise.all(SKILL_PARENT_DIRS.map(async (parent) => {
      const enabled = join(workspacePath, ...parent, name)
      const disabled = join(workspacePath, ...parent, DISABLED_DIR, name)
      return {
        enabled,
        enabledExists: await fs.stat(enabled).then(() => true).catch(() => false),
        disabledExists: await fs.stat(disabled).then(() => true).catch(() => false)
      }
    }))
    const anyEnabled = locations.some((location) => location.enabledExists)
    const anyDisabled = locations.some((location) => location.disabledExists)
    if (!anyEnabled && anyDisabled) continue

    for (const location of locations) {
      if (location.disabledExists && !location.enabledExists) continue
      await syncSkillSubtree(workspacePath, templateDir, location.enabled)
    }
  }
}

// 列出工作区已安装的 skills（含 enabled / disabled）。
// 不再扫描 ~/.claude/skills 下的全局 skill——展示了用户也没法在 App 里改它。
// 同名 skill 在两个工作区 parent 都存在时按目录名去重，优先取 .claude。
export async function listSkills(
  workspacePath: string,
  templatesRoot: string
): Promise<SkillSummary[]> {
  const seen = new Map<string, SkillSummary>()

  for (const disabled of [false, true]) {
    for (const parent of SKILL_PARENT_DIRS) {
      const skillsRoot = disabled
        ? join(workspacePath, ...parent, DISABLED_DIR)
        : join(workspacePath, ...parent)
      const entries = await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name === DISABLED_DIR) continue
        if (seen.has(entry.name)) continue
        const skillFile = join(skillsRoot, entry.name, 'SKILL.md')
        const content = await fs.readFile(skillFile, 'utf-8').catch(() => null)
        if (content === null) continue
        const templateDir = join(templatesRoot, entry.name)
        const templateExists = await fs.stat(join(templateDir, 'SKILL.md')).then(() => true).catch(() => false)
        const source: SkillSource = templateExists ? 'app' : 'project'
        const skillDirRelPath = disabled
          ? `${parent.join('/')}/${DISABLED_DIR}/${entry.name}`
          : `${parent.join('/')}/${entry.name}`
        const skillRelPath = `${skillDirRelPath}/SKILL.md`
        seen.set(entry.name, {
          ...summaryFromContent(entry.name, content),
          skillDirRelPath,
          skillRelPath,
          hasUserEdits: source === 'app' && !await directoriesEqual(join(skillsRoot, entry.name), templateDir),
          disabled,
          source
        })
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function directoriesEqual(leftRoot: string, rightRoot: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    readDirectoryFiles(leftRoot),
    readDirectoryFiles(rightRoot)
  ])
  if (left.size !== right.size) return false
  for (const [relPath, content] of left) {
    const other = right.get(relPath)
    if (!other || !content.equals(other)) return false
  }
  return true
}

async function readDirectoryFiles(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  async function visit(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absPath = join(dir, entry.name)
      if (entry.isDirectory()) await visit(absPath, relPath)
      else if (entry.isFile()) files.set(relPath, await fs.readFile(absPath))
    }
  }
  await visit(root, '')
  return files
}

function summaryFromContent(
  name: string,
  content: string
): Pick<SkillSummary, 'name' | 'title' | 'description' | 'quickInvocation' | 'defaultPrompt'> {
  const fm = parseFrontmatter(content)
  const quickInvocation = (fm.quickInvocation ?? fm['quick-invocation']) === 'true'
  const defaultPrompt = (fm.defaultPrompt ?? fm['default-prompt'])?.trim() || null
  return {
    name,
    title: typeof fm.name === 'string' ? fm.name.trim() : null,
    description: typeof fm.description === 'string' ? fm.description.trim() : null,
    quickInvocation,
    defaultPrompt
  }
}

// 切换某个 skill 的启用状态：在 .claude/skills 与 .agents/skills 两侧联动。
// 任一侧不存在对应目录就跳过，不报错；都不存在则抛 NOT_FOUND-style 错误。
export async function setSkillDisabled(
  workspacePath: string,
  skillName: string,
  disabled: boolean
): Promise<void> {
  if (!skillName || skillName.includes('/') || skillName.startsWith('.')) {
    throw new Error(`非法 skill 名：${skillName}`)
  }
  let moved = 0
  for (const parent of SKILL_PARENT_DIRS) {
    const enabledPath = join(workspacePath, ...parent, skillName)
    const disabledPath = join(workspacePath, ...parent, DISABLED_DIR, skillName)
    const [from, to] = disabled ? [enabledPath, disabledPath] : [disabledPath, enabledPath]
    const exists = await fs.stat(from).then(() => true).catch(() => false)
    if (!exists) continue
    // 目标已存在则覆盖删除（同名冲突时以 from 为准）
    await fs.rm(to, { recursive: true, force: true })
    await fs.mkdir(dirname(to), { recursive: true })
    await fs.rename(from, to)
    moved += 1
  }
  if (moved === 0) {
    throw new Error(`skill 不存在：${skillName}`)
  }
}

// ──── CRUD 入口（v1 用户主导）─────────────────────────────────────────────
// 不再 auto-scaffold；下面四个函数支撑面板的「+ 添加」「📦 模板库」「删除」入口。

// kebab-case 校验，最长 40 位，禁用保留字。createSkill 与 deleteSkill 都用。
const RESERVED_SKILL_NAMES = new Set([SHARED_TEMPLATE_DIR, '.disabled', 'README', 'README.md'])
const SKILL_NAME_RE = /^[a-z][a-z0-9-]{1,40}$/

function assertValidSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error('skill 名只能用小写字母、数字、短横线，2-41 位且以字母开头')
  }
  if (RESERVED_SKILL_NAMES.has(name)) {
    throw new Error(`「${name}」是保留名，请换一个`)
  }
}

function templateKindOf(name: string): SkillTemplateKind {
  if (name === SHARED_TEMPLATE_DIR) return 'shared'
  if ((SKILL_SETS.project as readonly string[]).includes(name)) return 'project'
  if ((SKILL_SETS.ux as readonly string[]).includes(name)) return 'ux'
  // 不在 SKILL_SETS 里也不是 _shared 的（理论上不应有），归到 shared 兜底显示
  return 'shared'
}

// 列出 resources/skill-templates/ 下全部可装模板。alreadyInstalled 用于面板里把对应行置灰。
// .claude/skills/<name> 存在 → alreadyInstalled=true（不查 .agents 那一份，两侧由 install 保持一致）。
export async function listSkillTemplates(
  workspacePath: string,
  templatesRoot: string
): Promise<SkillTemplateInfo[]> {
  const entries = await fs.readdir(templatesRoot, { withFileTypes: true }).catch(() => [])
  const out: SkillTemplateInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    const skillMd = await fs.readFile(join(templatesRoot, name, 'SKILL.md'), 'utf-8').catch(() => null)
    // 没 SKILL.md 的目录跳过（_shared 没 SKILL.md 但被显式带进列表，给一个空标题占位）
    const summary = skillMd ? summaryFromContent(name, skillMd) : { name, title: null, description: name === SHARED_TEMPLATE_DIR ? '_shared 公共片段，被 pm-*/ui-* skill 引用' : null }
    const alreadyInstalled = await fs.stat(join(workspacePath, '.claude', 'skills', name)).then(() => true).catch(() => false)
    out.push({
      name,
      title: summary.title,
      description: summary.description,
      kind: templateKindOf(name),
      alreadyInstalled
    })
  }
  // 排序：先 shared，再 project，再 ux；同 kind 内按 name 升序
  const kindOrder: Record<SkillTemplateKind, number> = { shared: 0, project: 1, ux: 2 }
  out.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name))
  return out
}

// 从零生成空白 skill。两侧（.claude/.agents）都写入最小骨架 SKILL.md。
// 名字非法或已存在抛错；其余幂等。
export async function createSkill(
  workspacePath: string,
  name: string,
  description?: string,
  options: { quickInvocation?: boolean; defaultPrompt?: string } = {}
): Promise<void> {
  assertValidSkillName(name)
  const claudeDir = join(workspacePath, '.claude', 'skills', name)
  const agentsDir = join(workspacePath, '.agents', 'skills', name)
  for (const dir of [claudeDir, agentsDir]) {
    const exists = await fs.stat(dir).then(() => true).catch(() => false)
    if (exists) throw new Error(`skill 已存在：${name}`)
  }
  const desc = (description ?? '').trim() || 'TODO: 填写 skill 的用途与触发时机'
  const quickInvocation = options.quickInvocation === true
  const defaultPrompt = options.defaultPrompt?.trim() ?? ''
  if (quickInvocation && !defaultPrompt) {
    throw new Error('快捷调用必须配置默认提示词')
  }
  const body = [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    `quickInvocation: ${quickInvocation}`,
    ...(defaultPrompt ? [`defaultPrompt: ${JSON.stringify(defaultPrompt)}`] : []),
    '---',
    '',
    `# ${name}`,
    '',
    'TODO: 这里写 skill 的目的、触发时机、产出物。',
    ''
  ].join('\n')
  for (const dir of [claudeDir, agentsDir]) {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'SKILL.md'), body, 'utf-8')
  }
}

// 批量装入模板。复用 syncSkillSubtree 的 hash 跟踪机制，保留用户改动协议一致。
// 第一次装入时若 .claude/skills/README.md 不存在，按 kind 兜底从 _shared/readme-{pm,ui}.md 复制一份。
export async function installSkillTemplates(
  workspacePath: string,
  templatesRoot: string,
  kind: 'project' | 'ux',
  names: string[]
): Promise<SkillInstallResult> {
  const installed: string[] = []
  const skipped: string[] = []
  for (const name of names) {
    if (!name || name.includes('/') || name.startsWith('.')) continue
    const claudeTarget = join(workspacePath, '.claude', 'skills', name)
    const agentsTarget = join(workspacePath, '.agents', 'skills', name)
    const existsClaude = await fs.stat(claudeTarget).then(() => true).catch(() => false)
    const existsAgents = await fs.stat(agentsTarget).then(() => true).catch(() => false)
    if (existsClaude || existsAgents) { skipped.push(name); continue }
    const templateDir = join(templatesRoot, name)
    const templateExists = await fs.stat(templateDir).then(() => true).catch(() => false)
    if (!templateExists) { skipped.push(name); continue }
    await syncSkillSubtree(workspacePath, templateDir, claudeTarget)
    await syncSkillSubtree(workspacePath, templateDir, agentsTarget)
    installed.push(name)
  }
  // README 兜底：装入了至少一个，且两侧 README 任一缺失就补
  if (installed.length > 0) {
    const readmeSrc = join(templatesRoot, SHARED_TEMPLATE_DIR, kind === 'project' ? 'readme-pm.md' : 'readme-ui.md')
    for (const parent of SKILL_PARENT_DIRS) {
      const readmePath = join(workspacePath, ...parent, 'README.md')
      const has = await fs.stat(readmePath).then(() => true).catch(() => false)
      if (!has) {
        await fs.mkdir(dirname(readmePath), { recursive: true }).catch(() => undefined)
        await fs.copyFile(readmeSrc, readmePath).catch(() => undefined)
      }
    }
  }
  return { installed, skipped }
}

// 硬删一个 skill，连带 .disabled 副本和 hash map 里的对应前缀条目一并清掉。幂等。
export async function deleteSkill(workspacePath: string, name: string): Promise<void> {
  if (!name || name.includes('/') || name.startsWith('.')) {
    throw new Error(`非法 skill 名：${name}`)
  }
  if (RESERVED_SKILL_NAMES.has(name)) {
    throw new Error(`「${name}」是保留名，不能删`)
  }
  const targets: string[] = []
  for (const parent of SKILL_PARENT_DIRS) {
    targets.push(join(workspacePath, ...parent, name))
    targets.push(join(workspacePath, ...parent, '.disabled', name))
  }
  for (const t of targets) {
    await fs.rm(t, { recursive: true, force: true })
  }
  // hash map 清理：前缀涵盖正常和禁用区两套位置
  const prefixes = SKILL_PARENT_DIRS.flatMap((parent) => [
    `${parent.join('/')}/${name}/`,
    `${parent.join('/')}/.disabled/${name}/`
  ])
  await removeHashPrefix(workspacePath, prefixes)
}

// 极简 frontmatter 解析：只认 --- 开头 / 结尾的 yaml 块，提取顶层 key:value（含 > 折叠风格）。
// 不引第三方 yaml 解析器，因为只用来取 name + description 两个字段。
export function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---\n')) return {}
  const end = content.indexOf('\n---', 4)
  if (end < 0) return {}
  const block = content.slice(4, end)
  const out: Record<string, string> = {}
  const lines = block.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!match) { i++; continue }
    const [, key, raw] = match
    let value = raw.trim()
    // > 或 >- 折叠：把后续缩进行拼起来
    if (value === '>' || value === '>-') {
      const collected: string[] = []
      i++
      while (i < lines.length && /^\s+/.test(lines[i])) {
        collected.push(lines[i].trim())
        i++
      }
      value = collected.join(' ')
      out[key] = value
      continue
    }
    // "..." 或 '...' 引号包裹
    const stripped = value.match(/^["'](.*)["']$/)
    if (stripped) {
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value) as string
        } catch {
          value = stripped[1]
        }
      } else {
        value = stripped[1]
      }
    }
    out[key] = value
    i++
  }
  return out
}
