// App 托管的私有路径列表（自动加进 .gitignore，且 commit 视图过滤）。
//
// 不在此列表里、但 App 可能曾经写过的路径：
// - AGENTS.md / CLAUDE.md：cwd 锁定改造后归用户所有（spec 2026-06-24-cwd-scoped-agent-design.md），
//   不强制 gitignore。挂 uikit 资产库时 App 会在其中 upsert 一个标记区（只动受管区、保留
//   用户内容，见 workspaces/ui-asset-rules.ts），但文件整体仍归用户、可自由 commit。
// - .cursor/rules/ui-client-workspace.mdc（旧）：已废弃归用户所有。
// - .cursor/rules/ui-client-ui-assets.mdc（新）：纯 App 托管文件，下方纳入 gitignore。
// - .claude/skills、.agents/skills：仍在列表里（项目内同步模板 + commit 视图过滤）
export const APP_MANAGED_GITIGNORE_ENTRIES = [
  '.ui-client/',
  '.external/',
  '.workspace/project-context.json',
  '.workspace/session-id',
  '.workspace/home-session-id',
  '.workspace/document-sessions/',
  '.workspace/workspace-sessions/',
  '.claude/skills/',
  '.claude/settings.local.json',
  '.agents/skills/',
  '.cursor/rules/ui-client-ui-assets.mdc',
  '.zvec-grep/'
] as const

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

export function isAppManagedPath(path: string): boolean {
  const normalized = normalizeRelPath(path)
  return APP_MANAGED_GITIGNORE_ENTRIES.some((entry) => {
    const cleanEntry = entry.replace(/\/$/, '')
    if (entry.endsWith('/')) {
      return normalized === cleanEntry || normalized.startsWith(`${cleanEntry}/`)
    }
    return normalized === entry
  })
}
