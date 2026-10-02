// 项目级与跨进程共享的类型定义。
// IPC 通讯两侧都要 import 这里。

// =====================================================================
// === Workspace v2（一体化工作流）===
// 详见 docs/superpowers/specs/2026-06-09-unified-workspace-refactor-design.md
// =====================================================================

// Workspace 仍保留 kind 作为历史数据兼容层。新模型只有一个本地默认工作台，
// 知识库和 UX 资产通过资源包绑定，不再作为用户需要创建/导入的根项目。
export type WorkspaceKind = 'project' | 'ux' | 'asset' | 'knowledge'

// 新建 / 导入 / 克隆项目统一使用 simple 工作流：Git 可选，不启用 personal space/worktree。
// 历史记录缺少此字段时继续走 legacy 行为，避免升级后破坏已有分支工作流。
export type WorkspaceWorkflowMode = 'simple'

// hidden workspace 的隐藏原因：
// - 'ai-task': 历史 AI task 派生 workspace（新任务不再创建）
// - 'space':   personal space 的独立 workspace（历史 worktree-per-space 方案）
// 老数据里的 `hidden: true` 只可能是历史 AI task，store 层读时自动升级到 'ai-task'。
export type WorkspaceHiddenReason = 'space' | 'ai-task'

export type Workspace = {
  id: string
  kind: WorkspaceKind
  workflowMode?: WorkspaceWorkflowMode
  isDefault?: boolean                  // 当前 workspaceRoot/.mywork 对应的系统默认工作台
  name: string
  path: string                        // 当前项目入口的绝对路径
  directoryRoot?: string              // 所关联目录的根，未选入口时与 path 相同
  entryPath?: string                  // 根目录内的相对入口；空值采用默认 features/ 约定
  managedPath?: boolean               // App 是否拥有该目录；导入目录固定为 false
  remoteUrl?: string
  defaultBranch: string               // 通常 'main'
  addedAt: string
  lastActiveAt: string
  activeRequirementId?: string | null
  externalInitWarnings?: string[]      // 创建/导入/克隆后初始化外部依赖的临时提示，不持久化
  hidden?: WorkspaceHiddenReason       // 历史内部派生记录不在侧栏展示；undefined = 可见
  // 通用父指针：历史派生 workspace 指回逻辑 workspace。
  parentWorkspaceId?: string
  baseWorkspaceId?: string             // 兼容字段：历史 AI 任务派生 workspace 对应的原工作区
  aiTaskId?: string                    // 历史 hidden='ai-task' 时使用
  spaceSlug?: string                   // hidden='space' 时使用
}

// 「个人空间」：项目内一条 git 分支（space/<slug>）。
// PM + UX 项目都用这套模型（PM 项目 2026-06-24 重构后从 req/* 模型迁来）。
// 一个项目可以有多个个人空间（多个 space/* 分支），用户在 top bar 切换。
// 元信息持久化在 .ui-client/personal-space.json（私有，不入项目 git）。
export type PersonalSpace = {
  slug: string                        // 分支片段，如 'eric'
  branch: string                      // 'space/<slug>'
  createdAt: string
  /** 公共空间 = 项目默认分支（通常 main），不是 space/* 分支，不可移除 */
  isPublic?: boolean
  /** 展示名；公共空间固定为「公共空间」，个人空间默认展示 slug */
  displayName?: string
  // 来源分支：'main'（从默认分支 cut） / 'space/foo' / 'req/abc-login' 等。
  // 升级前老格式无此字段，读取时静默兜底为 'main'。
  fromBranch?: string
  externalInitWarnings?: string[]      // create/switch 后 hydrate 外部依赖的临时提示，不持久化
}

// 一个工作区下所有 personal-space 的快照 + 当前活跃 slug。
// activeSlug 跟随实际 checkout 的分支，meta 写入时同步；不依赖 meta 文件做唯一事实源
// （branch 状态以 git status 为准，meta 只在快速展示时用）。
export type PersonalSpaceList = {
  spaces: PersonalSpace[]
  activeSlug: string | null
}

// =====================================================================
// === AI Task lanes（全局后台 AI 任务）===
// =====================================================================

export type AiTaskStatus =
  | 'running'
  | 'waiting_user'
  | 'waiting_approval'
  | 'completed'
  | 'applied'
  | 'failed'
  | 'aborted'

export type AiTaskLaneId = 'running' | 'waiting' | 'done'

export type AiTaskWorkArea =
  | { kind: 'workspace'; relPath?: undefined }
  | { kind: 'feature' | 'ui-product' | 'ui-component' | 'document'; relPath: string }

export type AiTaskSummary = {
  id: string
  sessionId: string
  workspaceId: string
  workspaceName: string
  workspacePath: string
  baseWorkspaceId?: string
  baseWorkspaceName?: string
  baseWorkspacePath?: string
  isolationBranch?: string
  status: AiTaskStatus
  title: string
  promptPreview: string
  workArea: AiTaskWorkArea
  createdAt: string
  updatedAt: string
  lastEventAt?: string
  changedArtifacts: string[]
  lastMessagePreview?: string
  unread: boolean
  errorMessage?: string
}

// 外部资源池条目类别。uikit = 含 styles/components 的设计资产库；knowledge = 纯文档库。
export type ExternalRefCategory = 'uikit' | 'knowledge'

// ~/.ui-client/external-pool/<id>/ 池里的一条记录。
export type ExternalRef = {
  id: string
  alias: string                       // 全局唯一，沿用 ALIAS_PATTERN
  kind: 'git' | 'local'
  category: ExternalRefCategory
  source: string                      // git URL 或本地路径
  poolPath: string                    // git: ~/.ui-client/external-pool/<id>/；local: 同 source
  instructionFile?: string            // 资源包根目录内的 AI 使用说明，当前约定为 AI_USAGE.md
  addedAt: string
  lastSyncedAt?: string
  checkout?: ExternalRefCheckout
  indexStatus?: ExternalRefIndexStatus
}

export type ExternalRefSyncStatus = {
  externalRefId: string
  kind: 'git' | 'local'
  ok: boolean
  hasUpdates: boolean
  behind: number
  checkedAt: string
  message?: string
}

export type ExternalRefIndexStatus = {
  externalRefId: string
  state: 'missing' | 'queued' | 'building' | 'ready' | 'error'
  reason?: 'first-import' | 'git-update' | 'checkout-change' | 'missing-index' | 'manual'
  // zg 混合索引覆盖的文件总数（zg status 的 Coverage）
  fileCount?: number
  // zg status 证据：embedding 模型名 / 抽取实体数。只可能来自 `zg status`，不是写死文案。
  engine?: 'zg'
  embedding?: string
  entities?: number
  fingerprint?: string
  builtAt?: string
  updatedAt: string
  message?: string
  // 构建期实时阶段（参照 zg TUI 分步：扫描 → 模型(首次) → 索引），节流落盘
  progress?: { phase: 'scan' | 'model' | 'index'; percent?: number }
  // 词法索引已就绪、daemon 后台还在补齐向量时的实时进度（读状态时动态填充；
  // total 为首次记录的待补齐总数，pending 归零后 enhancing 消失）
  enhancing?: { pending: number; total?: number }
}

export type ExternalRefBranches = {
  externalRefId: string
  branches: string[]
  current: string | null
  checkedAt: string
}

export type ExternalRefCheckout = {
  type: 'branch' | 'tag' | 'commit'
  value: string
}

export type ExternalDependencyManifestRef = {
  alias: string
  category: ExternalRefCategory
  kind: 'git'
  url: string
  checkout?: ExternalRefCheckout
  visibleDirs?: string[]
  readonly?: boolean
}

export type ExternalDependencyManifest = {
  schemaVersion: 1
  refs: ExternalDependencyManifestRef[]
}

// 项目对外部库的引用项；持久化为 .ui-client/refs.json（私有，不入项目 git）。
export type ExternalRefBinding = {
  alias: string                       // 项目内别名（默认取 ExternalRef.alias）
  externalRefId: string
  addedAt: string
  visibleDirs?: string[]              // 知识库可见子目录；空/缺失 = 整库可见
  assetLibrary?: string               // uikit 引用：选用源仓 components/<name> 哪个资产库；
                                      // 缺省 = 第一个；只在源仓里发现多个资产库时才有意义
  usageNote?: string                  // 当前项目使用该资源包时的补充说明
}

// =====================================================================
// === 资产库 (asset / ux 工作区视图) ===
// =====================================================================
//
// 新模型：components/ 下每个二级目录是一个独立的「资产库」。
// 每个资产库自带 theme/（可选）+ 若干组件子目录。
//
//   components/
//     SaaS-B/
//       theme/
//         palette.css
//         theme-g-one-b.css
//       sp-button/
//       sp-form/
//     SaaS-C/
//       theme/
//       sp-button/
//     business/             ← 无 theme/ 也算资产库（themes 为空）
//
// 旧模型里 workspace 根的 styles/<group>/ 已废弃；不再识别全局 activeTheme。

// @deprecated 旧模型遗留——preview-server.ts 还在用 styles/theme.css。
// 新的资产库模型不再有"激活主题"的工作区级概念。
export type ActiveThemeSelection = {
  group: string
  variant: string
}

export type ThemeVariant = {
  name: string                    // theme-light.css → "light"；theme.css → "default"
  cssPath: string                 // "components/<lib>/theme/theme-<variant>.css"
  cssExists: boolean
  guidePath: string
  guideExists: boolean
}

export type ThemeGroup = {
  name: string                    // 资产库名（沿用 library name）
  path: string                    // "components/<lib>/theme"
  palette: {
    cssPath: string
    cssExists: boolean
    guidePath: string
    guideExists: boolean
  }
  variants: ThemeVariant[]
}

// 资产库下的一个组件子目录（除 theme/ 之外的子目录）
export type AssetComponent = {
  name: string                    // 例 "sp-button"
  path: string                    // "components/<lib>/sp-button"
  hasDemo: boolean                // 子目录里是否含 .html / .htm
  demoPath: string | null          // 第一个可预览 demo，例如 "components/<lib>/sp-button/index.html"
  demoPaths: string[]              // 全部可选效果文件；demoPath 保留为默认预览入口
}

export type AssetLibrary = {
  name: string                    // 例 "SaaS-B"
  path: string                    // "components/SaaS-B"
  theme: ThemeGroup | null        // <lib>/theme/ 不存在则为 null
  components: AssetComponent[]    // 除 theme/ 外的子目录
}

// 轻量设计风格资产。对齐 Open Design 的 design-systems/<slug>/DESIGN.md 形态：
// 主要给 AI 读取设计规则，可选 tokens.css/theme.css 作为可复制 CSS。
export type DesignSystemAsset = {
  name: string                    // 例 "linear"
  path: string                    // "design-systems/linear"
  designPath: string | null       // 优先 DESIGN.md，其次 README.md / 任意 .md
  primaryCssPath: string | null   // 优先 tokens.css，其次 theme.css / 任意 .css
  markdownPaths: string[]         // 该设计风格下全部 .md
  cssPaths: string[]              // 该设计风格下全部 .css
}

export type UikitAssetSummary = {
  assetLibraries: AssetLibrary[]
  designSystemAssets: DesignSystemAsset[]
  componentsCount: number         // 全部资产库下含 .html 的组件总数
  designSystemCount: number       // design-systems/ 下设计风格数量
  iconsCount: number              // assets/ 下图片总数
  hasComponentsDir: boolean
  hasDesignSystemsDir: boolean
  hasAssetsDir: boolean
  warnings: string[]
}

// skill 来源：
// - 'app'：App 内置模板同步进来的（resources/skill-templates/<name> 存在）
// - 'project'：项目自带的（工作区里有但模板没有；通常是用户手工添加或老版本残留）
// 注：~/.claude/skills 的全局 skill 不在面板展示——用户既不能在 App 里编辑全局 skill 内容，
// 列出来只是噪音；想看就直接去 ~/.claude/skills/。
export type SkillSource = 'app' | 'project'

export type SkillSummary = {
  name: string                      // skill 目录名，如 'brainstorming'
  title: string | null              // SKILL.md frontmatter 的 name 字段
  description: string | null        // frontmatter 的 description（折叠语法已合并）
  quickInvocation: boolean           // 是否在 AI 面板展示快捷调用按钮
  defaultPrompt: string | null       // 快捷调用时发送给 AI 的默认提示词
  skillDirRelPath: string           // Skill 文件夹的工作区相对路径
  skillRelPath: string              // 入口文件 SKILL.md 的工作区相对路径
  hasUserEdits: boolean             // 整个 Skill 文件夹与模板是否一致；非 app source 始终 false
  disabled: boolean                 // 是否被禁用（移到 .disabled/ 子目录，AI 工具不会加载）
  source: SkillSource
}

// 模板库面板里一个可选装条目。kind 来自 SKILL_SETS 反查。
export type SkillTemplateKind = 'project' | 'ux' | 'shared'
export type SkillTemplateInfo = {
  name: string                      // 目录名，如 'pm-brainstorm'
  title: string | null
  description: string | null
  kind: SkillTemplateKind
  alreadyInstalled: boolean         // 当前工作区是否已存在同名 skill 目录
}

// 批量装入模板的结果。前端 toast 用。
export type SkillInstallResult = {
  installed: string[]
  skipped: string[]
}

/** UX outputs 项目卡片封面展示信息，存于 outputs/<project>/meta.json 的 card 字段。 */
export type UiProductCardMeta = {
  /** 封面与列表展示用标题，可与目录名不同。 */
  title?: string
  coverTag?: string
  uxName?: string
  pmName?: string
}

// 项目可选关联的一份真实前端源码。项目本身仍是普通目录；源码副本由 App 私有管理。
export type SourceRuntimeProfile = {
  schemaVersion: 1
  name: string
  node?: string
  packageManager?: string
  install: string[]
  start: string[]
  readyUrl?: string
  mockOutputDir?: string
}

export type SourceProjectBinding = {
  schemaVersion: 1
  sourceId: string
  repositoryUrl?: string
  baseBranch: string
  branch: string
  runtime: SourceRuntimeProfile
  createdAt: string
}

export type SourceProjectInfo = {
  binding: SourceProjectBinding | null
  state: 'unlinked' | 'ready' | 'missing'
  dirty: boolean
  launch: SourceProjectLaunchInfo
}

export type SourceProjectLaunchInfo = {
  state: 'stopped' | 'starting' | 'running' | 'failed'
  url?: string
  message?: string
}

// =====================================================================
// === Features（PM 项目 2026-06-24 重构后取代 requirements 模型） ===
// =====================================================================
//
// 目录结构：features/<slug>/ 平铺，或 features/<group>/<slug>/ 一级分组。
//   features/login-page/
//     prd.md                  ← PRD 文档（产品需求）
//     index.html              ← UI 主产物
//     v2/index.html           ← 可选：UI 版本 2 子目录
//     assets/                 ← 资产文件夹
//   features/onboarding/     ← 分组
//     login-page/             ← 这才是 feature
//     reset-password/

export type FeatureUiArtifact = {
  /** 显示名（取 .html 所在子目录名；根 index.html 名为 'main'） */
  name: string
  /** UI 产物 html 文件相对项目根的路径 */
  htmlRelPath: string
  /** 产物根目录（feature 根 / 或某子目录），相对项目根 */
  rootRelPath: string
}

export type FeatureCard = {
  /** feature slug：扁平时 = 目录名；分组时 = 组内目录名 */
  name: string
  /** 相对项目根：'features/<slug>' 或 'features/<group>/<slug>' */
  relPath: string
  /** 一级分组名；null = 未分组（在 features/<slug>） */
  group: string | null
  /** PRD 文件相对路径（prd.md 优先，README.md 兜底）；null = 无 PRD */
  prdRelPath: string | null
  /** UI 产物列表（feature 根的 index.html + 各子目录 index.html） */
  uiArtifacts: FeatureUiArtifact[]
  /** 整个 feature 目录的最近修改时间（取下层任意文件最大值） */
  modifiedAt: string | null
}

export type FeatureResourceSelection = {
  version: 1
  externalRefIds: string[]
  updatedAt: string
}

// =====================================================================
// === 文档树（knowledge 工作区视图） ===
// =====================================================================

export type DocTreeNode =
  | {
      kind: 'file'
      name: string
      relPath: string
      size: number
      modifiedAt: string
    }
  | {
      kind: 'folder'
      name: string
      relPath: string
      children: DocTreeNode[]
      uiProductCard?: UiProductCardMeta | null
    }

export type FsNode = DocTreeNode

// =====================================================================
// === 扫描结果分流 ===
// =====================================================================

// 新扫描器输出（按 Workspace.kind 分支）。
export type WorkspaceScanResult =
  | {
      kind: 'project'
      warnings: string[]
      /** PM 项目 features/<slug>/ 卡片列表（2026-06-24 重构后取代 requirements） */
      features: FeatureCard[]
      refs: ExternalRefBinding[]
      hasKnowledgeDir: boolean
      /** 当前激活个人空间（PM 也走 space/<slug> 模型；老 PM 项目无 space/* 时为 null） */
      personalSpace: PersonalSpace | null
    }
  | {
      kind: 'asset'
      warnings: string[]
      assetLibraries: AssetLibrary[]
      designSystemAssets: DesignSystemAsset[]
      hasComponentsDir: boolean
      hasDesignSystemsDir: boolean
      hasAssetsDir: boolean
    }
  | {
      kind: 'ux'
      warnings: string[]
      assetLibraries: AssetLibrary[]
      designSystemAssets: DesignSystemAsset[]
      hasComponentsDir: boolean
      hasDesignSystemsDir: boolean
      hasAssetsDir: boolean
      hasOutputsDir: boolean
      personalSpace: PersonalSpace | null
    }
  | {
      kind: 'knowledge'
      warnings: string[]
      tree: DocTreeNode[]
    }

export type WorkspaceSearchEngine = 'zg' | 'legacy'

export type WorkspaceSearchTrace = {
  zgAvailable: boolean
  zgScript: string | null
  zgRoots: number
  legacyRoots: number
  durationMs: number
}

export type WorkspaceTextSearchResultItem =
  | {
      source: 'workspace'
      relPath: string
      title: string
      snippet: string
      engine: WorkspaceSearchEngine
      matchedBy?: string
    }
  | {
      source: 'external'
      externalRefId: string
      externalAlias: string
      externalCategory: ExternalRefCategory
      relPath: string
      title: string
      snippet: string
      engine: WorkspaceSearchEngine
      matchedBy?: string
    }

// =====================================================================
// === Git 状态（前端展示） ===
// =====================================================================

export type GitCapability =
  | { state: 'unbound' }
  | { state: 'local'; branch: string }
  | { state: 'remote'; branch: string; remoteUrl: string }

export type GitStatus = {
  isDirty: boolean
  modifiedCount: number
  stagedCount: number
  changedFiles: string[]
  changedFileDetails: Array<{
    path: string
    kind: 'added' | 'deleted' | 'modified'
  }>
  branch: string
  ahead: number
  behind: number
  mainlineBehind: number
  hasRemote: boolean
  rebaseInProgress: boolean
  detached: boolean
  headSha: string
}

// GitSnapshot：git saga 体系内的 canonical 状态对象。
// 与 GitStatus（旧契约）并存，过渡期由 git.status 投影；P1 删除 GitStatus。
export type GitChangedFile = {
  path: string
  kind: 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked'
}

export type GitWorkingState =
  | { kind: 'clean' }
  | { kind: 'dirty'; files: GitChangedFile[] }
  | { kind: 'rebasing'; step: number; total: number; conflicts: string[] }
  | { kind: 'merging'; conflicts: string[] }
  | { kind: 'reverting'; conflicts: string[] }
  | { kind: 'cherry-picking'; conflicts: string[] }
  | { kind: 'detached'; headSha: string }

export type GitRemoteState =
  | { kind: 'no-remote' }
  | { kind: 'untracked-local' }                                 // 有 remote 但本地分支未跟踪
  | { kind: 'tracked'; outgoing: number; incoming: number }     // 跟踪状态下的两端差

export type GitSnapshot = {
  workspacePath: string
  branch: string
  defaultBranch: string
  working: GitWorkingState
  remote: GitRemoteState
  mainlineIncoming: number
  headSha: string
  takenAt: number
}

// RepairContext：saga 失败时打包给 AI / 用户的结构化上下文。
// P0：渲染成中文 prompt 让用户复制；P1：直接喂 claude-headless 让 AI 自动 apply。
export type RepairContextStep = {
  op: string
  args: Record<string, unknown>
  status: 'done' | 'skipped' | 'failed' | 'pending' | 'running'
}

export type RepairContext = {
  saga: 'save' | 'sync'
  trigger: string
  workspace: { id: string; name?: string; path: string; defaultBranch: string }
  completedSteps: RepairContextStep[]
  failedStep: RepairContextStep & { failureKind: string; failureSummary: string; rawError?: string }
  pendingSteps: RepairContextStep[]
  snapshotBefore: GitSnapshot
  snapshotAfter: GitSnapshot
  attempts: number
  capturedAt: string
}

export type GitFileDiff = {
  path: string
  diff: string
  truncated: boolean
}

export type GitCommitSummary = {
  sha: string
  shortSha: string
  subject: string
  authorName: string
  authorEmail: string
  authoredAt: string
}

export type GitRevertToResult =
  | { ok: true; revertedCount: number; branch: string }
  | {
      ok: false
      phase: 'check-clean' | 'resolve-target' | 'list-commits' | 'revert'
      code: string
      message: string
      branch?: string
    }
