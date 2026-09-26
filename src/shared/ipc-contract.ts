import type { BrowserScope, BrowserBounds, ProjectWebPage, WebPageText, WebPageDesign } from './project-browser'
import type { GitPushHistory } from './git-push-summary'
import type { PeekaConnection } from './peeka'
// IPC 通讯单一事实源。main 与 renderer 都从这里取类型。
// 新增 channel = 加一行到 IpcContract + 把 channel 名加进 IPC_CHANNELS。

import type {
  AiTaskSummary,
  DocTreeNode,
  ExternalRef,
  ExternalRefBinding,
  ExternalRefBranches,
  ExternalRefCategory,
  ExternalRefCheckout,
  ExternalRefIndexStatus,
  ExternalRefSyncStatus,
  GitCommitSummary,
  GitCapability,
  GitFileDiff,
  GitRevertToResult,
  GitSnapshot,
  GitStatus,
  FeatureCard,
  FeatureResourceSelection,
  PersonalSpace,
  PersonalSpaceList,
  RepairContext,
  SkillInstallResult,
  SkillSummary,
  SkillTemplateInfo,
  Workspace,
  WorkspaceScanResult,
  WorkspaceSearchTrace,
  WorkspaceTextSearchResultItem,
  UiProductCardMeta,
  SourceProjectInfo,
  UikitAssetSummary
} from './types'

export type ClaudeTargetWorkspace = {
  kind: 'workspace-home'
  scopeKey?: string
  intent?: 'design-prd'
}

export interface IpcContract {
  'projectBrowser.list': { input: undefined; output: ProjectWebPage[] }
  'projectBrowser.open': { input: BrowserScope & { url: string }; output: ProjectWebPage }
  'projectBrowser.close': { input: BrowserScope & { id: string }; output: void }
  'projectBrowser.control': { input: BrowserScope & { id: string; action: 'navigate' | 'back' | 'forward' | 'reload'; url?: string }; output: void }
  'projectBrowser.layout': { input: BrowserScope & { id: string; bounds: BrowserBounds | null }; output: void }
  'projectBrowser.read': { input: BrowserScope & { id: string }; output: WebPageText }
  'projectBrowser.createDesign': { input: BrowserScope & { id: string }; output: WebPageDesign }

  // ──── 系统级 ────
  'app.ping': {
    input: { msg: string }
    output: { pong: string; receivedAt: number }
  }
  'app.version': {
    input: void
    output: { version: string; electron: string; node: string; chrome: string }
  }

  // ──── App 全局设置 ────
  'settings.get': {
    input: void
    output: { workspaceRoot: string; pmDocsDir: string; preferredTool?: string; cliKind: 'claude'; aiProvider: 'claude-code' | 'deepseek-harness'; deepseekApiKeyConfigured: boolean; peekaConnection: PeekaConnection; aiTaskNotchEnabled: boolean; defaultExternalRefIds: string[]; theme: 'dark' | 'light'; schemaVersion: 3 }
  }
  'settings.update': {
    input: { workspaceRoot?: string; pmDocsDir?: string; preferredTool?: string; cliKind?: 'claude'; aiProvider?: 'claude-code' | 'deepseek-harness'; deepseekApiKey?: string | null; peekaConnection?: PeekaConnection; aiTaskNotchEnabled?: boolean; defaultExternalRefIds?: string[]; theme?: 'dark' | 'light' }
    output: { workspaceRoot: string; pmDocsDir: string; preferredTool?: string; cliKind: 'claude'; aiProvider: 'claude-code' | 'deepseek-harness'; deepseekApiKeyConfigured: boolean; peekaConnection: PeekaConnection; aiTaskNotchEnabled: boolean; defaultExternalRefIds: string[]; theme: 'dark' | 'light'; schemaVersion: 3 }
  }

  // ──── 本地诊断日志 ────
  'diagnostics.info': {
    input: void
    output: { directory: string; fileCount: number; totalBytes: number; oldestAt?: string; newestAt?: string }
  }
  'diagnostics.reveal': {
    input: void
    output: void
  }
  'diagnostics.export': {
    input: { sessionId?: string }
    output: { path: string }
  }
  'diagnostics.clear': {
    input: void
    output: { directory: string; fileCount: number; totalBytes: number; oldestAt?: string; newestAt?: string }
  }
  'diagnostics.reportRendererError': {
    input: { kind: 'error' | 'unhandledrejection'; name?: string; message: string; stack?: string }
    output: void
  }

  // ──── 编辑器（按工作区路径读写文本与资产） ────
  // 编辑器（按工作区路径读写文本与资产）
  'editor.readTextFile': {
    input: { workspaceId: string; relPath: string; scope?: 'docs' | 'project' }
    output: { relPath: string; content: string; mtime: string }
  }
  'editor.entryExists': {
    input: { workspaceId: string; relPath: string; scope?: 'docs' | 'project' }
    output: { exists: boolean }
  }
  'editor.entryKind': {
    input: { workspaceId: string; relPath: string }
    output: { kind: 'missing' | 'symlink' | 'file' | 'dir'; target?: string }
  }
  'editor.writeTextFile': {
    input: { workspaceId: string; relPath: string; content: string; expectedMtime?: string; scope?: 'docs' | 'project' }
    output: { relPath: string; mtime: string }
  }
  'editor.deleteTextFile': {
    input: { workspaceId: string; relPath: string; scope?: 'docs' | 'project' }
    output: void
  }
  'editor.deleteEntry': {
    input: { workspaceId: string; relPath: string; scope?: 'docs' | 'project' }
    output: void
  }
  'editor.copyEntry': {
    input: { workspaceId: string; sourceRelPath: string; targetRelPath: string; scope?: 'docs' | 'project' }
    output: { relPath: string }
  }
  'editor.moveEntry': {
    input: { workspaceId: string; sourceRelPath: string; targetRelPath: string; scope?: 'docs' | 'project' }
    output: { relPath: string }
  }
  'editor.createEntry': {
    input: { workspaceId: string; targetRelPath: string; scope?: 'docs' | 'project' }
    output: { relPath: string }
  }
  'editor.saveAsset': {
    input: {
      workspaceId: string
      contextRelPath: string
      mimeType: string
      dataBase64: string
      originalName?: string
    }
    output: { assetRelPath: string; markdownPath: string }
  }
  'editor.saveBinaryFile': {
    input: {
      workspaceId: string
      targetRelDir: string
      mimeType: string
      dataBase64: string
      originalName?: string
    }
    output: { relPath: string }
  }
  // 新建或打开 UX/PM 产物时，把工作区根的 agent 配置复制进产物子目录，
  // 让产物在不同 IDE / cwd 下打开都能本地拿到 skill / AGENTS / CLAUDE 配置。
  // spec: docs/superpowers/specs/2026-06-24-cwd-scoped-agent-design.md
  'uiProduct.seedAgentFiles': {
    input: { workspaceId: string; productRelPath: string }
    output: { copied: number; sourcedFrom: string[] }
  }
  'uiProduct.import': {
    input: { workspaceId: string; sourcePath: string; name?: string }
    output: { productRelPath: string; htmlRelPath: string; fileCount: number }
  }
  'uiProduct.copyToSpace': {
    input: { workspaceId: string; relPath: string; targetSlug: string; targetWorkspaceId?: string; targetName?: string }
    output: { relPath: string; targetSlug: string; targetBranch: string; targetWorkspaceId: string }
  }
  'uiProduct.updateCardMeta': {
    input: {
      workspaceId: string
      productRelPath: string
      title?: string
      coverTag?: string
      uxName?: string
      pmName?: string
    }
    output: UiProductCardMeta | null
  }

  // ──── 项目源码关联（项目文件夹与私有源码副本一对一） ────
  'sourceProject.get': {
    input: { workspaceId: string; projectRelPath: string }
    output: SourceProjectInfo
  }
  'sourceProject.associate': {
    input: { workspaceId: string; projectRelPath: string; sourcePath: string }
    output: SourceProjectInfo
  }
  'sourceProject.commit': {
    input: { workspaceId: string; projectRelPath: string; message: string }
    output: SourceProjectInfo
  }
  'sourceProject.start': {
    input: { workspaceId: string; projectRelPath: string }
    output: SourceProjectInfo
  }
  'sourceProject.stop': {
    input: { workspaceId: string; projectRelPath: string }
    output: SourceProjectInfo
  }

  // ──── Features（PM 项目 2026-06-24 重构后，取代 requirements 模型） ────
  // 见 ~/.claude/plans/jaunty-giggling-starfish.md Phase B
  'feature.list': {
    input: { workspaceId: string }
    output: FeatureCard[]
  }
  'feature.listGroups': {
    input: { workspaceId: string }
    output: string[]
  }
  'feature.create': {
    // slug 必填；group 可选（创建到 features/<group>/<slug>/）；withPrd/withIndexHtml 控制 scaffold
    input: { workspaceId: string; slug: string; group?: string | null; withPrd?: boolean; withIndexHtml?: boolean; externalRefIds?: string[]; setResourcesAsDefault?: boolean }
    output: { featureRelPath: string; prdRelPath: string | null; indexHtmlRelPath: string | null }
  }
  'feature.resources.get': {
    input: { workspaceId: string; featureRelPath: string }
    output: FeatureResourceSelection & { configured: boolean }
  }
  'feature.resources.update': {
    input: { workspaceId: string; featureRelPath: string; externalRefIds: string[]; setAsDefault?: boolean }
    output: FeatureResourceSelection
  }
  'feature.import': {
    input: { workspaceId: string; sourcePath: string; slug?: string; group?: string | null }
    output: { featureRelPath: string }
  }
  'feature.delete': {
    input: { workspaceId: string; relPath: string }
    output: void
  }
  'feature.rename': {
    input: { workspaceId: string; relPath: string; newSlug: string }
    output: { relPath: string }
  }
  'feature.move': {
    // toGroup=null → 移到 features/<slug>；非空 → features/<group>/<slug>
    input: { workspaceId: string; relPath: string; toGroup: string | null }
    output: { relPath: string }
  }
  'feature.copyToSpace': {
    input: { workspaceId: string; relPath: string; targetSlug: string; targetWorkspaceId?: string; targetName?: string }
    output: { relPath: string; targetSlug: string; targetBranch: string; targetWorkspaceId: string }
  }

  // ──── 系统集成 ────
  'system.openInBrowser': {
    input: { workspaceId: string; relativePath: string }
    output: void
  }
  'system.revealInFinder': {
    input: { workspaceId: string; relativePath?: string }
    output: void
  }
  'system.openExternal': {
    input: { url: string }
    output: void
  }
  'system.copyToClipboard': {
    input: { text: string }
    output: void
  }
  'system.openInIDE': {
    input: { workspaceId: string; relativePath?: string }
    output: { kind: 'cursor' | 'code' | 'none' }
  }
  'system.setTrafficLightsVisible': {
    input: { visible: boolean }
    output: void
  }
  'system.getWindowChromeState': {
    input: void
    output: {
      platform: string
      maximized: boolean
      fullscreen: boolean
      compactTrafficLightInset: boolean
    }
  }
  'system.openProjectTool': {
    input: { workspaceId: string; kind: 'finder' | 'terminal' | 'codex' | 'cursor' | 'code'; relativePath?: string }
    output: { kind: 'finder' | 'terminal' | 'codex' | 'cursor' | 'code'; message?: string; copiedPath?: boolean }
  }
  'system.detectIde': {
    input: void
    output: { kind: 'cursor' | 'code' | 'none' }
  }
  'system.selectDirectory': {
    input: { title?: string; buttonLabel?: string }
    output: { path: string } | null
  }

  // ──── 启动环境检查（极简，不阻塞 splash） ────
  'setup.checkEnv': {
    input: void
    output: {
      gitBinaryReady: boolean
      gitUser: { name: string; email: string; configured: boolean }
      claudeGuideUrl: string
    }
  }
  // 按需检查可选依赖：claude-code（打开 AI 面板时调）/ cursor / vscode（后台异步调）
  'setup.checkOptionalDep': {
    input: { name: 'claude-code' | 'cursor' | 'vscode' }
    output: {
      name: 'claude-code' | 'cursor' | 'vscode'
      found: boolean
      version?: string
      guideUrl?: string
    }
  }

  // ──── 内置预览（HTTP server） ────
  'preview.componentsUrl': {
    input: { workspaceId: string; rootRel?: string }
    output: { url: string }
  }
  'preview.iconsUrl': {
    input: { workspaceId: string; rootRel?: string }
    output: { url: string }
  }
  'preview.docUrl': {
    input: { workspaceId: string; relPath?: string }
    output: { url: string }
  }
  'preview.fileUrl': {
    input: { workspaceId: string; relPath: string }
    output: { url: string }
  }

  // ──── 图标导入 ────
  'icons.import': {
    input: { workspaceId: string; filePaths?: string[]; purpose?: string; name?: string }
    output: {
      added: string[]
      skipped: Array<{ name: string; reason: 'exists' | 'unsupported' | 'read-failed' }>
    }
  }

  // ──── SSH 密钥引导 ────
  'ssh.check': {
    input: void
    output: { exists: boolean; publicKey?: string; fingerprint?: string; path: string }
  }
  'ssh.generate': {
    input: { email?: string }
    output: { exists: boolean; publicKey?: string; fingerprint?: string; path: string }
  }
  'ssh.rotate': {
    input: { email?: string; expectedFingerprint: string }
    output: { exists: boolean; publicKey?: string; fingerprint?: string; path: string }
  }

  // ──── git 状态 + identity（同步 / 拉推由 sync.start 接管） ────
  'git.capability': {
    input: { workspaceId: string }
    output: GitCapability
  }
  'git.remoteBranches': {
    input: { workspaceId: string; remoteUrl: string }
    output: { branches: string[]; defaultBranch: string | null }
  }
  'git.bind': {
    input: { workspaceId: string; remoteUrl: string; branch: string }
    output: GitCapability
  }
  'git.status': {
    input: { workspaceId: string }
    output: GitStatus
  }
  'git.branches': {
    input: { workspaceId: string }
    output: { branches: string[]; current: string | null }
  }
  // canonical 状态（saga 体系；旧 git.status 在 P1 删除前并存）
  'git.snapshot': {
    input: { workspaceId: string; force?: boolean }
    output: GitSnapshot
  }
  'git.restoreFile': {
    input: { workspaceId: string; relPath: string }
    output: void
  }
  'git.fileDiff': {
    input: { workspaceId: string; relPath: string }
    output: GitFileDiff
  }
  'git.pushHistory': {
    input: { workspaceId: string; relPath?: string; branch?: string; retry?: boolean }
    output: GitPushHistory
  }
  'git.submitFeature': {
    input: { workspaceId: string; relDir: string }
    output: { committed: boolean; pushed: boolean; fileCount: number; warning?: string; summary?: string }
  }
  'git.history': {
    input: { workspaceId: string; limit?: number }
    output: GitCommitSummary[]
  }
  'git.revertTo': {
    input: { workspaceId: string; targetSha: string }
    output: GitRevertToResult
  }
  'git.currentUser': {
    input: void
    output: { name: string; email: string }
  }
  'git.setIdentity': {
    input: { name?: string; email?: string }
    output: { name: string; email: string }
  }
  // ──── saga（git 工作流编排；P0 仅暴露失败上下文供 AI repair dialog 用） ────
  'saga.latestRepair': {
    input: { workspaceId: string }
    output: { context: RepairContext | null; prompt: string | null }
  }

  // ──── askpass（renderer → main 答复） ────
  'askpass.respond': {
    input: { id: number; answer: string; rememberHost?: string }
    output: void
  }
  'askpass.cancel': {
    input: { id: number }
    output: void
  }
  'askpass.forget': {
    input: { host: string }
    output: void
  }
  'askpass.listCreds': {
    input: void
    output: Array<{ host: string; username: string | null; hasPassword: boolean }>
  }
  'askpass.clearAll': { input: void; output: void }
  // 用户在设置里手动新增 / 编辑 host 的 PAT。username 可空（部分 git 服务只需 token）；
  // password 可空表示"只改用户名，不动密码"——对应编辑场景。
  'askpass.upsert': {
    input: { host: string; username?: string; password?: string }
    output: void
  }

  // ──── 剪页插件配置引导（Settings 用） ────
  'raw.extensionInfo': {
    input: void
    output: { destDir: string; version: string | null; installed: boolean; error?: string }
  }
  'raw.revealExtensionDir': { input: void; output: void }
  'raw.openChromeExtensions': { input: void; output: void }

  // ──── 终端（PTY） ────
  'terminal.create': {
    input: {
      shell?: string
      args?: string[]
      cwd?: string
      cols?: number
      rows?: number
    }
    output: { ttyId: string }
  }
  'terminal.write': {
    input: { ttyId: string; data: string }
    output: void
  }
  'terminal.resize': {
    input: { ttyId: string; cols: number; rows: number }
    output: void
  }
  'terminal.kill': {
    input: { ttyId: string }
    output: void
  }

  // ──── Claude UI 模式（headless spawn + JSONL 回放） ────
  'claude.accessScope': {
    input: { workspaceId: string }
    output: { workDir: string; readRoots: string[]; writeRoots: string[]; enforced: boolean }
  }
  'claude.sessionId': {
    input: {
      workspaceId: string
      targetDocument?: { relPath: string; kind: 'markdown' | 'css' | 'html' | 'text'; readonly?: boolean }
      targetWorkspace?: ClaudeTargetWorkspace
    }
    output: { sessionId: string }
  }
  'claude.session.new': {
    input: {
      workspaceId: string
      targetDocument?: { relPath: string; kind: 'markdown' | 'css' | 'html' | 'text'; readonly?: boolean }
      targetWorkspace?: ClaudeTargetWorkspace
      abortExisting?: boolean
    }
    output: { sessionId: string }
  }
  'claude.submit': {
    input: {
      workspaceId: string
      sessionId?: string
      text: string
      chips?: Array<{
        alias: string
        path: string
        tagName?: string
        textPreview?: string
        edits?: Record<string, string>
      }>
      images?: Array<{ mediaType: string; data: string }>
      editableArea?: { relPath: string; kind: 'ui-product' | 'ui-component' }
      targetDocument?: { relPath: string; kind: 'markdown' | 'css' | 'html' | 'text'; readonly?: boolean }
      targetWorkspace?: ClaudeTargetWorkspace
      toolResult?: { toolUseId: string; content: string }
      allowedTools?: string[]
    }
    output: { sessionId: string; turnPid: number; workspaceId: string; taskId: string }
  }
  'claude.abort': {
    input: {
      workspaceId: string
      sessionId?: string
      targetDocument?: { relPath: string; kind: 'markdown' | 'css' | 'html' | 'text'; readonly?: boolean }
      targetWorkspace?: ClaudeTargetWorkspace
    }
    output: { ok: boolean }
  }
  'claude.watch.start': {
    input: {
      workspaceId: string
      sessionId?: string
      targetDocument?: { relPath: string; kind: 'markdown' | 'css' | 'html' | 'text'; readonly?: boolean }
      targetWorkspace?: ClaudeTargetWorkspace
    }
    output: {
      sessionId: string
      watchId: string
      events: Array<{ type: string; uuid?: string; [key: string]: unknown }>
      turnActive: boolean
    }
  }
  'claude.watch.stop': {
    input: {
      workspaceId: string
      sessionId?: string
      watchId?: string
      targetDocument?: { relPath: string; kind: 'markdown' | 'css' | 'html' | 'text'; readonly?: boolean }
      targetWorkspace?: ClaudeTargetWorkspace
    }
    output: void
  }
  'claude.commandCatalog': {
    input: { workspaceId: string }
    output: {
      skills: Array<{
        name: string
        description: string
        source: 'project' | 'user'
        quickInvocation: boolean
        defaultPrompt: string | null
      }>
      builtins: Array<{ name: string; description: string; insertText: string }>
    }
  }

  // ──── AI Tasks（全局后台 AI 任务泳道） ────
  'aiTask.list': {
    input: void
    output: AiTaskSummary[]
  }
  'aiTask.get': {
    input: { taskId: string }
    output: AiTaskSummary | null
  }
  'aiTask.abort': {
    input: { taskId: string }
    output: { ok: boolean }
  }
  'aiTask.dismiss': {
    // 从任务列表里彻底移除（不影响文件、不动 worktree）；如果任务还在跑，先 abort 再移除
    input: { taskId: string }
    output: { ok: boolean }
  }
  'aiTask.open': {
    // 从灵动岛跳到主窗口的对应任务
    input: { taskId: string }
    output: void
  }
  'aiTask.notch.setState': {
    // mini（44×44 透明窗口，容纳图标和外置角标）/ panel（620×最高 360 展开）
    input: { state: 'mini' | 'panel' }
    output: void
  }
  'aiTask.notch.setPanelHeight': {
    input: { height: number }
    output: void
  }
  'aiTask.notch.moveBy': {
    // mini 和 panel 顶栏靠 JS 手写拖动，使双击与拖动可以共存
    input: { dx: number; dy: number }
    output: void
  }

  // ──── Workspace（一体化工作流核心） ────
  'workspace.ensureDefault': { input: void; output: Workspace }
  'workspace.list': { input: void; output: Workspace[] }
  'workspace.findById': { input: { id: string }; output: Workspace | null }
  'workspace.activeId': { input: void; output: string | null }
  'workspace.setActive': { input: { id: string | null }; output: void }
  'workspace.scan': { input: { id: string }; output: WorkspaceScanResult }
  'workspace.ensureDefaultKnowledge': { input: void; output: Workspace }
  'workspace.create': {
    input: { parentDir: string; name: string; kind?: 'project' | 'ux' | 'asset' | 'knowledge'; initialBranch?: string }
    output: Workspace
  }
  'workspace.import': {
    input: { path: string; name?: string; kind?: 'project' | 'ux' | 'asset' | 'knowledge' }
    output: Workspace
  }
  'workspace.clone': {
    input: { url: string; parentDir: string; name: string; kind?: 'project' | 'ux' | 'asset' | 'knowledge' }
    output: Workspace
  }
  'workspace.remove': { input: { id: string; deleteFiles?: boolean }; output: void }
  'workspace.rename': { input: { id: string; name: string }; output: void }
  'workspace.setWorkArea': {
    input: {
      workspaceId: string
      area?: { kind: 'ui-product' | 'ui-component' | 'document' | 'feature'; relPath: string } | null
    }
    output: void
  }
  'workspace.setWatchScope': {
    input:
      | { workspaceId: string; projectRelPath: string }
      | { workspaceId: null; projectRelPath: null }
    output: void
  }
  'workspace.checkoutHome': {
    input: { workspaceId: string; preCommitMessage?: string }
    output: void
  }
  'workspace.save': {
    input: { workspaceId: string; commitMessage?: string }
    output:
      | { ok: true; pushed: boolean; branch: string; committed: boolean }
      | { ok: false; phase: string; code: string; message: string }
  }
  // 列工作区内某目录的文件树（按可选扩展名过滤）
  'workspace.listFiles': {
    input: {
      workspaceId: string
      relDir: string                  // '.' = 工作区根；'docs' / 'ui' = 项目共享目录
      recursive?: boolean             // 默认 true
      extensions?: string[]           // 不带点的扩展名小写列表，如 ['md','html']；为空 = 全部
    }
    output: DocTreeNode[]
  }
  'workspace.listSpaceFiles': {
    input: {
      workspaceId: string
      spaceSlug: string
      relDir: string
      recursive?: boolean
      extensions?: string[]
    }
    output: DocTreeNode[]
  }
  'workspace.search': {
    input: { workspaceId: string; query: string }
    output: { query: string; results: WorkspaceTextSearchResultItem[]; trace: WorkspaceSearchTrace }
  }
  'workspace.uikitSummary': {
    input: { workspaceId: string; rootRel?: string }
    output: UikitAssetSummary
  }

  // ──── Skills（项目内 .claude/skills + .agents/skills） ────
  // Skill 是包含 SKILL.md、说明和脚本等内容的文件夹；文件读写复用 editor 系列 IPC。
  'skills.list': {
    input: { workspaceId: string }
    output: SkillSummary[]
  }
  'skills.restoreTemplate': {
    input: { workspaceId: string; skillName: string }
    output: void
  }
  'skills.setDisabled': {
    input: { workspaceId: string; skillName: string; disabled: boolean }
    output: void
  }
  'skills.listTemplates': {
    input: { workspaceId: string }
    output: SkillTemplateInfo[]
  }
  'skills.create': {
    input: {
      workspaceId: string
      name: string
      description?: string
      quickInvocation?: boolean
      defaultPrompt?: string
    }
    output: void
  }
  'skills.installTemplates': {
    input: { workspaceId: string; names: string[] }
    output: SkillInstallResult
  }
  'skills.delete': {
    input: { workspaceId: string; skillName: string }
    output: void
  }

  // ──── Personal Space（PM / UX workspace 共用） ────
  // 2026-06-24 重构后支持多空间：每个 workspace 可有多个 space/<slug> 分支。
  'personalSpace.ensure': {
    // 兼容旧调用：保证至少有一个空间（已有 active 则切过去；无则创建）
    input: { workspaceId: string; slug?: string; preCommitMessage?: string }
    output: PersonalSpace
  }
  'personalSpace.get': {
    // 返回 active space（list.spaces[activeSlug]）
    input: { workspaceId: string }
    output: PersonalSpace | null
  }
  'personalSpace.list': {
    // 列出 workspace 下所有空间 + 当前活跃 slug
    input: { workspaceId: string }
    output: PersonalSpaceList
  }
  'personalSpace.create': {
    // 显式创建新空间。fromBranch 缺省 = defaultBranch
    input: { workspaceId: string; slug?: string; fromBranch?: string; preCommitMessage?: string }
    output: PersonalSpace
  }
  'personalSpace.switch': {
    // 切到已有空间（git checkout space/<slug> + 更新 activeSlug）
    input: { workspaceId: string; slug: string; preCommitMessage?: string }
    output: PersonalSpace
  }
  'personalSpace.remove': {
    // 移除空间：删本地 space/<slug> + 从 meta 抹掉。不主动 push delete 远端
    input: { workspaceId: string; slug: string; preCommitMessage?: string }
    output: PersonalSpaceList
  }

  // ──── External（外部资源池 + 工作区引用） ────
  'external.list': { input: void; output: ExternalRef[] }
  'external.refs': { input: { workspaceId: string }; output: ExternalRefBinding[] }
  'external.add': {
    input:
      | { alias: string; category: ExternalRefCategory; kind: 'git'; url: string; checkout?: ExternalRefCheckout }
      | { alias: string; category: ExternalRefCategory; kind: 'local'; sourcePath: string }
    output: ExternalRef
  }
  'external.remove': { input: { id: string }; output: void }
  'external.status': { input: { id: string }; output: ExternalRefSyncStatus }
  'external.branches': { input: { id: string }; output: ExternalRefBranches }
  'external.refresh': { input: { id: string }; output: { ok: boolean; message?: string } }
  'external.buildIndex': { input: { id: string }; output: ExternalRefIndexStatus }
  'external.hydrate': { input: { workspaceId: string }; output: { mounted: string[]; warnings: string[] } }
  'external.attach': {
    input: { workspaceId: string; externalRefId: string; assetLibrary?: string; usageNote?: string }
    output: void
  }
  'external.detach': { input: { workspaceId: string; externalRefId: string }; output: void }
  'external.checkout': { input: { id: string; checkout: ExternalRefCheckout }; output: ExternalRef }
  'external.updateBinding': {
    input: { workspaceId: string; externalRefId: string; visibleDirs?: string[]; assetLibrary?: string; usageNote?: string }
    output: ExternalRefBinding
  }
  // 查询源仓里有哪些资产库（components/<name>），uikit 多资产库时让用户选用一个
  'external.listAssetLibraries': {
    input: { id: string }
    output: { libraries: { name: string; hasTheme: boolean; componentCount: number }[] }
  }

  // ──── 同步组合（事件流走 'sync.progress:<workspaceId>'，见 EVENT_PREFIXES） ────
  'sync.start': {
    input: { workspaceId: string; mode?: 'remote' | 'mainline' | 'full'; uncommittedStrategy?: 'commit' | 'reject'; commitMessage?: string }
    output:
      | { ok: true; pushed: boolean }
      | { ok: false; phase: string; code: string; message: string }
  }

  // ──── 推送到团队空间（origin/main）。事件流走 'team-push.progress:<workspaceId>' ────
  'team.push': {
    input: { workspaceId: string; relPath: string; name: string; type: 'feat' | 'ui' }
    output:
      | { ok: true; pushed: boolean; empty: boolean }
      | {
          ok: false
          phase: string
          code: 'CONFLICT' | 'AUTH' | 'NETWORK' | 'NO_REMOTE' | 'OTHER'
          message: string
          worktreePath?: string
          conflictFiles?: string[]
        }
  },

  // ──── 放弃冲突推送：abort worktree 内 rebase + 移除临时 worktree ────
  'team.abort': {
    input: { workspaceId: string; worktreePath: string }
    output: { ok: true } | { ok: false; code: string; message: string }
  }

  // ──── 冲突解决 ────
  'conflict.list': {
    input: { workspaceId: string }
    output: {
      inProgress: 'rebase' | 'merge' | 'none'
      files: Array<{
        relPath: string
        binary: boolean
        chunks: Array<{
          startLine: number
          separatorLine: number
          endLine: number
          ours: string
          theirs: string
        }>
      }>
    }
  }
  'conflict.applyResolution': {
    input: { workspaceId: string; relPath: string; resolvedContent: string }
    output: void
  }
  'conflict.pickSide': {
    input: { workspaceId: string; relPath: string; side: 'ours' | 'theirs' }
    output: void
  }
  'conflict.continue': { input: { workspaceId: string }; output: void }
  'conflict.abort': { input: { workspaceId: string }; output: void }
  // 异步后台任务：立即返回 {started}，结果走 'conflict.aiResolve.done:<workspaceId>' 事件
  'conflict.aiResolve': {
    input: { workspaceId: string }
    output: { started: boolean }
  },
  'conflict.aiResolve.abort': {
    input: { workspaceId: string }
    output: { aborted: boolean }
  }
}

// 每次新增 channel 必须把名字也加到这里；否则 preload 的 contextBridge 不会暴露它。
// 启动时有一个运行时校验保证 IpcContract 与 IPC_CHANNELS 一一对应（见 main/ipc/registry.ts）。
export const IPC_CHANNELS = [
  'projectBrowser.list', 'projectBrowser.open', 'projectBrowser.close', 'projectBrowser.control', 'projectBrowser.layout', 'projectBrowser.read', 'projectBrowser.createDesign',
  'app.ping',
  'app.version',
  'settings.get',
  'settings.update',
  'diagnostics.info',
  'diagnostics.reveal',
  'diagnostics.export',
  'diagnostics.clear',
  'diagnostics.reportRendererError',
  'editor.readTextFile',
  'editor.entryExists',
  'editor.entryKind',
  'editor.writeTextFile',
  'editor.deleteTextFile',
  'editor.deleteEntry',
  'editor.copyEntry',
  'editor.moveEntry',
  'editor.createEntry',
  'editor.saveAsset',
  'editor.saveBinaryFile',
  'uiProduct.seedAgentFiles',
  'uiProduct.import',
  'uiProduct.copyToSpace',
  'uiProduct.updateCardMeta',
  'sourceProject.get',
  'sourceProject.associate',
  'sourceProject.commit',
  'sourceProject.start',
  'sourceProject.stop',
  'feature.list',
  'feature.listGroups',
  'feature.create',
  'feature.resources.get',
  'feature.resources.update',
  'feature.import',
  'feature.delete',
  'feature.rename',
  'feature.move',
  'feature.copyToSpace',
  'system.openInBrowser',
  'system.revealInFinder',
  'system.openExternal',
  'system.copyToClipboard',
  'system.openInIDE',
  'system.setTrafficLightsVisible',
  'system.getWindowChromeState',
  'system.openProjectTool',
  'system.detectIde',
  'system.selectDirectory',
  'setup.checkEnv',
  'setup.checkOptionalDep',
  'preview.componentsUrl',
  'preview.iconsUrl',
  'preview.docUrl',
  'preview.fileUrl',
  'icons.import',
  'ssh.check',
  'ssh.generate',
  'ssh.rotate',
  'git.status',
  'git.capability',
  'git.remoteBranches',
  'git.bind',
  'git.branches',
  'git.snapshot',
  'git.restoreFile',
  'git.fileDiff',
  'git.history',
  'git.pushHistory',
  'git.submitFeature',
  'git.revertTo',
  'git.currentUser',
  'git.setIdentity',
  'saga.latestRepair',
  'askpass.respond',
  'askpass.cancel',
  'askpass.forget',
  'askpass.listCreds',
  'askpass.clearAll',
  'askpass.upsert',
  'raw.extensionInfo',
  'raw.revealExtensionDir',
  'raw.openChromeExtensions',
  'terminal.create',
  'terminal.write',
  'terminal.resize',
  'terminal.kill',
  'claude.accessScope',
  'claude.sessionId',
  'claude.session.new',
  'claude.submit',
  'claude.abort',
  'claude.watch.start',
  'claude.watch.stop',
  'claude.commandCatalog',
  'aiTask.list',
  'aiTask.get',
  'aiTask.abort',
  'aiTask.dismiss',
  'aiTask.open',
  'aiTask.notch.setState',
  'aiTask.notch.setPanelHeight',
  'aiTask.notch.moveBy',
  'workspace.ensureDefault',
  'workspace.list',
  'workspace.findById',
  'workspace.activeId',
  'workspace.setActive',
  'workspace.scan',
  'workspace.ensureDefaultKnowledge',
  'workspace.create',
  'workspace.import',
  'workspace.clone',
  'workspace.remove',
  'workspace.rename',
  'workspace.setWorkArea',
  'workspace.setWatchScope',
  'workspace.checkoutHome',
  'workspace.save',
  'workspace.listFiles',
  'workspace.listSpaceFiles',
  'workspace.search',
  'workspace.uikitSummary',
  'skills.list',
  'skills.restoreTemplate',
  'skills.setDisabled',
  'skills.listTemplates',
  'skills.create',
  'skills.installTemplates',
  'skills.delete',
  'personalSpace.ensure',
  'personalSpace.get',
  'personalSpace.list',
  'personalSpace.create',
  'personalSpace.switch',
  'personalSpace.remove',
  'external.list',
  'external.refs',
  'external.add',
  'external.remove',
  'external.status',
  'external.branches',
  'external.refresh',
  'external.buildIndex',
  'external.hydrate',
  'external.attach',
  'external.detach',
  'external.checkout',
  'external.updateBinding',
  'external.listAssetLibraries',
  'sync.start',
  'team.push',
  'team.abort',
  'conflict.list',
  'conflict.applyResolution',
  'conflict.pickSide',
  'conflict.continue',
  'conflict.abort',
  'conflict.aiResolve',
  'conflict.aiResolve.abort'
] as const satisfies ReadonlyArray<keyof IpcContract>

// 推送式（main → renderer）的事件 channel 命名空间。renderer 通过
// window.events.on(channel, listener) 订阅。channel 名是动态拼出来的
// （如 pty.data:<ttyId>），所以这里只列前缀作为白名单。
export const EVENT_PREFIXES = [
  'project-browser.changed',
  'project-browser.activate',
  'window.chrome-state',
  'pty.data:',
  'pty.exit:',
  'fs.change:',
  'fs.watch-status:',
  'askpass.request',
  'claude.delta:',
  'claude.turn-end:',
  'claude.turn-error:',
  'claude.jsonl-append:',
  'ai-task.changed',
  'ai-task.open',
  'sync.progress:',
  'team-push.progress:',
  'conflict.aiResolve.done:',
  'saga.fs-change-pushed:',
  'git.remote-updated:',
  'raw.captured'
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export type IpcInput<K extends IpcChannel> = IpcContract[K]['input']
export type IpcOutput<K extends IpcChannel> = IpcContract[K]['output']

// 统一返回结构。main 抛出的异常被 registry 捕获后变成 { ok: false, ... }。
// renderer 始终能拿到一个 IpcResult，永远不需要 try/catch IPC 调用本身。
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; details?: unknown }
