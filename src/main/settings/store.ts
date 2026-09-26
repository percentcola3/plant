import { PEEKA_PRESETS, validatePeekaConnection, type PeekaConnection } from '../../shared/peeka'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { settingsJsonPath } from '../projects/paths'
import { CLI_KINDS, DEFAULT_CLI_KIND, type CliKind } from '../../shared/cli'
import { DEFAULT_APP_THEME, isAppTheme, type AppTheme } from '../../shared/app-theme'
import { DEFAULT_AI_PROVIDER, isAiProvider, type AiProvider } from '../../shared/ai-provider'

export type ProjectToolKind = 'finder' | 'terminal' | 'codex' | 'cursor' | 'code'
// 'claude' = 直接调 claude CLI。
export type { CliKind } from '../../shared/cli'
export type { AppTheme } from '../../shared/app-theme'

export type AppSettings = {
  workspaceRoot: string             // 本地工作台父目录；实际工作根为 <workspaceRoot>/.mywork
  pmDocsDir: string
  preferredTool?: ProjectToolKind   // 用户上次选择的工具，undefined = 用检测到的 IDE
  cliKind: CliKind                  // 跑 AI 面板用哪个 CLI；默认 'claude'
  aiProvider: AiProvider            // AI 面板底层：本地 Claude Code 或内置 DeepSeek Harness
  defaultExternalRefIds: string[]   // 新建项目时默认关联的知识库和 UX 资产
  theme: AppTheme                   // 全局界面主题
  peekaConnection: PeekaConnection
  aiTaskNotchEnabled: boolean
  schemaVersion: 3
}

const SETTINGS_SCHEMA_VERSION = 3

function defaultWorkspaceRoot(): string {
  return join(homedir(), 'Documents', 'WorkSpace')
}

const VALID_TOOLS = new Set<string>(['finder', 'terminal', 'codex', 'cursor', 'code'])
const VALID_CLI_KINDS = new Set<string>(CLI_KINDS)

const DEFAULTS: AppSettings = {
  peekaConnection: { ...PEEKA_PRESETS.official },
  aiTaskNotchEnabled: true,
  workspaceRoot: defaultWorkspaceRoot(),
  pmDocsDir: 'docs',
  cliKind: DEFAULT_CLI_KIND,
  aiProvider: DEFAULT_AI_PROVIDER,
  defaultExternalRefIds: [],
  theme: DEFAULT_APP_THEME,
  schemaVersion: SETTINGS_SCHEMA_VERSION
}

// 导出 class 供测试构造独立实例；生产代码只用下面的单例。
export class SettingsStore {
  private cache: AppSettings | null = null

  async load(): Promise<AppSettings> {
    if (this.cache) return this.cache
    const path = settingsJsonPath()
    try {
      const text = await fs.readFile(path, 'utf-8')
      const parsed = JSON.parse(text) as Record<string, unknown>
      const fileVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1
      void fileVersion
      // 旧字段如 pmDocsDir 直接忽略；只取 AppSettings 已定义字段
      const merged: AppSettings = {
        workspaceRoot: typeof parsed.workspaceRoot === 'string' && parsed.workspaceRoot
          ? parsed.workspaceRoot
          : DEFAULTS.workspaceRoot,
        pmDocsDir: typeof parsed.pmDocsDir === 'string' && parsed.pmDocsDir
          ? parsed.pmDocsDir
          : DEFAULTS.pmDocsDir,
        preferredTool: typeof parsed.preferredTool === 'string' && VALID_TOOLS.has(parsed.preferredTool)
          ? parsed.preferredTool as ProjectToolKind
          : undefined,
        cliKind: typeof parsed.cliKind === 'string' && VALID_CLI_KINDS.has(parsed.cliKind)
          ? parsed.cliKind as CliKind
          : DEFAULTS.cliKind,
        aiProvider: isAiProvider(parsed.aiProvider) ? parsed.aiProvider : DEFAULTS.aiProvider,
        defaultExternalRefIds: Array.isArray(parsed.defaultExternalRefIds)
          ? [...new Set(parsed.defaultExternalRefIds
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean))]
          : [],
        theme: isAppTheme(parsed.theme) ? parsed.theme : DEFAULTS.theme,
        peekaConnection: readPeekaConnection(parsed.peekaConnection),
        aiTaskNotchEnabled: typeof parsed.aiTaskNotchEnabled === 'boolean' ? parsed.aiTaskNotchEnabled : true,
        schemaVersion: SETTINGS_SCHEMA_VERSION
      }
      this.cache = merged
    } catch {
      this.cache = { ...DEFAULTS }
    }
    return this.cache
  }

  async save(): Promise<void> {
    if (!this.cache) return
    const path = settingsJsonPath()
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, JSON.stringify(this.cache, null, 2), 'utf-8')
  }

  async get(): Promise<AppSettings> {
    return this.load()
  }

  // 同步读已加载的设置。App 启动时 main/index.ts 会先 await load()，之后所有同步链路
  // （spawn-turn、pty defaultPtyCommand）都能 0 成本读到。未加载时返回 null，调用方按
  // 默认行为兜底（cli-resolver 默认 'claude'）。
  getCached(): AppSettings | null {
    return this.cache
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.load()
    // 不允许覆盖 schemaVersion
    const { schemaVersion: _ignored, ...safe } = patch
    this.cache = { ...current, ...safe, schemaVersion: SETTINGS_SCHEMA_VERSION }
    await this.save()
    return this.cache
  }
}

export const settingsStore = new SettingsStore()

function readPeekaConnection(value: unknown): PeekaConnection {
  try { return validatePeekaConnection(value) } catch { return { ...PEEKA_PRESETS.official } }
}
