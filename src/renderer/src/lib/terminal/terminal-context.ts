export type TerminalContextScope = 'workspace' | 'document'

export type TerminalTargetDocument = {
  relPath: string
  kind: 'markdown' | 'css' | 'html' | 'text'
  readonly?: boolean
}

export type TerminalTargetWorkspace = {
  kind: 'workspace-home'
  scopeKey?: string
  intent?: 'design-prd'
}

export type ResolvedTerminalContext = {
  scope: TerminalContextScope
  targetDocument: TerminalTargetDocument | undefined
  targetWorkspace: TerminalTargetWorkspace | undefined
  activeWorkspace: string | null
}

// `TerminalOpenContext` 保留为占位类型（外部 caller 仍可能传 null/undefined）。
// 旧的 'requirement-branch' kind 在 Phase E 移除；如未来需要"分支专用"会话标签再补回。
export type TerminalOpenContext = { kind: 'workspace-home'; workspaceId: string }

// Claude Code 工作上下文：从"当前是否有可编辑文档"自动推导，没有手动开关。
//
// 设计：
// - 读 = 始终整个工作区（不在这里管，由 CLAUDE.md 模板里的"允许读取整个仓库"规则保障）
// - 写 = 跟随当前可编辑文档；没文档（AI Chat 场景）= workspace 模式，写入工作区根
// - 只读文档（如 .knowledge 下知识库引用）→ workspace 模式（不该改它）
export function resolveTerminalContext(
  currentDocument: TerminalTargetDocument | undefined
): ResolvedTerminalContext {
  if (currentDocument && !currentDocument.readonly) {
    return {
      scope: 'document',
      targetDocument: currentDocument,
      targetWorkspace: undefined,
      activeWorkspace: fileParentDir(currentDocument.relPath)
    }
  }

  return {
    scope: 'workspace',
    targetDocument: undefined,
    targetWorkspace: { kind: 'workspace-home' },
    activeWorkspace: null
  }
}

function fileParentDir(relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return null
  return normalized.slice(0, idx)
}
