// 写入范围提醒的 PreToolUse hook 注入。
//
// 工作流：
//   1. 把 hook 脚本写到 <workspace>/.ui-client/hooks/check-editable.cjs
//   2. 把 hook 注册写到 <workspace>/.claude/settings.local.json 的
//      hooks.PreToolUse；用脚本相对路径作为"是不是我们的 hook" 的指纹，
//      避免重复注入或误删用户自己的 hooks。
//
// 为什么不写 settings.json：那个文件常被人 git commit + 协作编辑。
// settings.local.json 按 claude code 约定是 local-only，更适合 app 托管。
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

const HOOK_REL_PATH = '.ui-client/hooks/check-editable.cjs'
const HOOK_MATCHER = 'Write|Edit|MultiEdit|NotebookEdit'
const HOOK_COMMAND = `node ${HOOK_REL_PATH}`

// brainstorming 门禁的 SessionStart hook：按工作区内实际装入的 brainstorming skill 动态注入门禁文案。
// 没装 → 不注入；用户装入后下次 session 启动就生效，无需 sync。
const GATE_HOOK_REL_PATH = '.ui-client/hooks/brainstorming-gate.cjs'
const GATE_HOOK_COMMAND = `node ${GATE_HOOK_REL_PATH}`

const HOOK_SCRIPT = `#!/usr/bin/env node
// app-managed by ui-client. 不要手动编辑——syncWorkspaceTemplates 会覆盖回来。
//
// PreToolUse hook：拦截 Write/Edit/MultiEdit/NotebookEdit。
// 从 .workspace/project-context.json 读 editableRoots，目标路径不在范围内 → stderr 提醒但放行。
'use strict'
const fs = require('node:fs')
const path = require('node:path')

function readStdinSync() {
  try { return fs.readFileSync(0, 'utf-8') } catch (_) { return '' }
}
function exit(code, message) {
  if (message) process.stderr.write(message + '\\n')
  process.exit(code)
}
function warn(message) {
  if (message) process.stderr.write(message + '\\n')
  process.exit(0)
}

const raw = readStdinSync()
let event
try { event = JSON.parse(raw) } catch (_) { exit(0) }

const toolName = event && event.tool_name
const toolInput = (event && event.tool_input) || {}

const writeTools = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
if (!writeTools.has(toolName)) exit(0)

const targetPath = toolInput.file_path || toolInput.notebook_path
if (typeof targetPath !== 'string' || !targetPath) exit(0)

const projectRoot = process.cwd()
let context
try {
  const ctxRaw = fs.readFileSync(path.join(projectRoot, '.workspace', 'project-context.json'), 'utf-8')
  context = JSON.parse(ctxRaw)
} catch (_) {
  exit(0)   // 没 context 就放行（开发环境 / 老工作区）
}

const editableRoots = Array.isArray(context.editableRoots) ? context.editableRoots : []
if (editableRoots.length === 0) exit(0)   // 没限制就放行

const absTarget = path.isAbsolute(targetPath) ? targetPath : path.resolve(projectRoot, targetPath)
const relTarget = path.relative(projectRoot, absTarget).replace(/\\\\/g, '/')

if (relTarget.startsWith('..')) {
  warn('提醒：本次写入目标在项目外：' + targetPath)
}

const normRoots = editableRoots
  .map((r) => String(r).replace(/\\\\/g, '/').replace(/\\/+$/, ''))
  .filter(Boolean)

const inEditable = normRoots.some((r) => relTarget === r || relTarget.startsWith(r + '/'))

if (!inEditable) {
  const msg = [
    '提醒：本次写入超出当前编辑范围。',
    '当前编辑范围：',
    ...normRoots.map((r) => '  - ' + r + '/'),
    '写入目标：' + relTarget,
    '如果这是预期操作，可以继续；否则请在 App 里切换到对应项目。'
  ].join('\\n')
  warn(msg)
}

exit(0)
`

// SessionStart hook：在每次会话启动时根据工作区里实际装入的 brainstorming skill
// 动态注入门禁文案。装了哪个就强制走哪个；都没装 → 不注入。
// 与硬编码到 CLAUDE.md 受管块相比，这种方式 skill 删 / 装 / 禁用都自动生效，
// 不会出现"文案指向的 skill 实际不存在"。
const GATE_HOOK_SCRIPT = `#!/usr/bin/env node
// app-managed by ui-client. 不要手动编辑——syncWorkspaceTemplates 会覆盖回来。
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = process.cwd()
const candidates = ['pm-brainstorm', 'ui-brainstorm']

function isInstalled(name) {
  try {
    return fs.statSync(path.join(projectRoot, '.claude', 'skills', name)).isDirectory()
  } catch (_) { return false }
}

const active = candidates.filter(isInstalled)
if (active.length === 0) {
  // 不输出 → Claude Code 不会添加任何 additional context
  process.exit(0)
}

const lines = []
for (const name of active) {
  lines.push('<EXTREMELY_IMPORTANT>')
  lines.push('**' + name + ' 门禁：任何创造性工作开始前必须先 Skill 工具加载 ' + name + ' 完整跑一轮**')
  lines.push('')
  lines.push('- 创造性工作 = 新增功能 / 写 PRD / 画 UI / 改行为 / 重构 / 调整体验 / 任何会产出 spec、PRD、设计稿、代码改动的任务。')
  lines.push('- 跳过 ' + name + ' 直接 Edit / Write / 创建文件 / 调用其它实施 skill = 违规。')
  lines.push('- 即使用户说"很简单 / 直接做 / 立刻动手 / 不用想了"，也必须先走 ' + name + ' 流程并拿到对设计稿的明确确认。')
  lines.push('- 例外：纯查询、纯解释、修单纯 typo、用户已有 ' + name + ' 产出的 spec 文档作为输入直接进实施环节。')
  lines.push('')
  lines.push(name + ' skill 在 \\\`.claude/skills/' + name + '/SKILL.md\\\`，通过 Skill 工具加载（不要 Read）。')
  lines.push('</EXTREMELY_IMPORTANT>')
  lines.push('')
}

const additionalContext = lines.join('\\n')
const out = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: additionalContext
  }
})
process.stdout.write(out)
process.exit(0)
`

// runtime-context.cjs SessionStart hook 已废弃（spec: 2026-06-24-cwd-scoped-agent-design.md）。
// cwd 锁定后，AI 自然知道"在哪干活"；editableRoots 经由 cwd 本身体现。
// 保留路径常量仅用于幂等清理 settings.local.json 的旧条目；不再写脚本文件、不再注入注册。
const LEGACY_RUNTIME_CTX_HOOK_REL_PATH = '.ui-client/hooks/runtime-context.cjs'

// 写 hook 脚本到 .ui-client/hooks/check-editable.cjs
async function writeHookScript(workspacePath: string): Promise<void> {
  const path = join(workspacePath, HOOK_REL_PATH)
  await fs.mkdir(dirname(path), { recursive: true })
  const current = await fs.readFile(path, 'utf-8').catch(() => '')
  if (current === HOOK_SCRIPT) return
  await fs.writeFile(path, HOOK_SCRIPT, 'utf-8')
  // 加可执行位（即使 hook 用 `node X.cjs` 运行也无所谓，让它合规一点）
  await fs.chmod(path, 0o755).catch(() => undefined)
}

async function writeGateHookScript(workspacePath: string): Promise<void> {
  const path = join(workspacePath, GATE_HOOK_REL_PATH)
  await fs.mkdir(dirname(path), { recursive: true })
  const current = await fs.readFile(path, 'utf-8').catch(() => '')
  if (current === GATE_HOOK_SCRIPT) return
  await fs.writeFile(path, GATE_HOOK_SCRIPT, 'utf-8')
  await fs.chmod(path, 0o755).catch(() => undefined)
}

type HookEntry = {
  type: 'command'
  command: string
}
type HookGroup = {
  matcher: string
  hooks: HookEntry[]
}
type SettingsShape = {
  hooks?: {
    PreToolUse?: HookGroup[]
    SessionStart?: HookGroup[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

// 通用：把一个 hook group 注入到指定 event；按 command 包含 fingerprintPath 去掉所有旧条目，幂等。
function upsertHookGroup(
  groups: HookGroup[],
  fingerprintPath: string,
  injected: HookGroup
): HookGroup[] {
  const filtered = groups.filter((group) => {
    if (!group || typeof group !== 'object') return false
    const hooks = Array.isArray(group.hooks) ? group.hooks : []
    return !hooks.some((h) => h && typeof h === 'object'
      && typeof h.command === 'string'
      && h.command.includes(fingerprintPath))
  })
  filtered.push(injected)
  return filtered
}

// 写 / 合并 .claude/settings.local.json：注入我们托管的 PreToolUse + SessionStart hook。
// 用 hook command 字符串中的脚本路径作为指纹，确保幂等且不踩用户自己的 hooks。
async function upsertSettingsHook(workspacePath: string): Promise<void> {
  const settingsPath = join(workspacePath, '.claude', 'settings.local.json')
  await fs.mkdir(dirname(settingsPath), { recursive: true })

  let settings: SettingsShape = {}
  const raw = await fs.readFile(settingsPath, 'utf-8').catch(() => '')
  if (raw.trim()) {
    try {
      settings = JSON.parse(raw) as SettingsShape
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        settings = {}
      }
    } catch {
      // 用户的 settings.local.json 损坏 → 整个重写，否则 claude 启不来
      settings = {}
    }
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {}

  const preToolUse = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : []
  settings.hooks.PreToolUse = upsertHookGroup(preToolUse, HOOK_REL_PATH, {
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: HOOK_COMMAND }]
  })

  const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : []
  settings.hooks.SessionStart = upsertHookGroup(sessionStart, GATE_HOOK_REL_PATH, {
    matcher: '',                  // SessionStart 无 matcher 区分
    hooks: [{ type: 'command', command: GATE_HOOK_COMMAND }]
  })
  // 幂等清理旧 runtime-context.cjs SessionStart 注册（升级后老工作区残留）；
  // 不再注入新条目，spec 2026-06-24-cwd-scoped-agent-design.md。
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter((group) => {
    if (!group || typeof group !== 'object') return false
    const hooks = Array.isArray(group.hooks) ? group.hooks : []
    return !hooks.some((h) => h && typeof h === 'object'
      && typeof h.command === 'string'
      && h.command.includes(LEGACY_RUNTIME_CTX_HOOK_REL_PATH))
  })

  const next = JSON.stringify(settings, null, 2) + '\n'
  if (next === raw) return
  await fs.writeFile(settingsPath, next, 'utf-8')
}

export async function syncManagedHooks(workspacePath: string): Promise<void> {
  await writeHookScript(workspacePath)
  await writeGateHookScript(workspacePath)
  // 老 .ui-client/hooks/runtime-context.cjs 脚本文件不主动删（用户可能 git 已忽略，影响极小）；
  // settings.local.json 的旧条目在 upsertSettingsHook 里幂等清理。
  await upsertSettingsHook(workspacePath)
}

// 测试用导出
export const HOOK_INTERNALS = {
  HOOK_REL_PATH,
  HOOK_MATCHER,
  HOOK_COMMAND,
  GATE_HOOK_REL_PATH,
  GATE_HOOK_COMMAND,
  LEGACY_RUNTIME_CTX_HOOK_REL_PATH
}
