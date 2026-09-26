import { app } from 'electron'
import { join } from 'node:path'

// 工作区目录约定常量。所有路径都相对工作区根（除 workspacesJsonPath 是 userData 下）。
// 详见 docs/superpowers/specs/2026-06-09-unified-workspace-refactor-design.md §3.1

export const REQUIREMENTS_DIR = 'requirements'
export const PROJECT_DOCS_DIR = 'docs'
export const PROJECT_UI_DIR = 'ui'
export const KNOWLEDGE_DIR = '.knowledge'
export const EXTERNAL_DIR = '.external'
export const UI_CLIENT_DIR = '.ui-client'

export const REQ_META_FILENAME = '.meta.json'
export const REFS_FILENAME = 'refs.json'
export const ACTIVE_REQ_FILENAME = 'active-requirement'
export const PERSONAL_SPACE_FILENAME = 'personal-space.json'
export const ACTIVE_WORK_AREA_FILENAME = 'active-work-area.json'
export const EXTERNAL_MANIFEST_FILENAME = 'workspace.external.json'

// 工作区索引文件，与 projects.json 并存（双轨期）
export function workspacesJsonPath(): string {
  return join(app.getPath('userData'), 'workspaces.json')
}

export function managedProjectsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, '.mywork')
}

export function requirementsDir(workspacePath: string): string {
  return join(workspacePath, REQUIREMENTS_DIR)
}

export function projectDocsDir(workspacePath: string): string {
  return join(workspacePath, PROJECT_DOCS_DIR)
}

export function projectUiDir(workspacePath: string): string {
  return join(workspacePath, PROJECT_UI_DIR)
}

export function requirementDir(workspacePath: string, idSlug: string): string {
  return join(workspacePath, REQUIREMENTS_DIR, idSlug)
}

export function reqMetaPath(workspacePath: string, idSlug: string): string {
  return join(workspacePath, REQUIREMENTS_DIR, idSlug, REQ_META_FILENAME)
}

export function knowledgeDir(workspacePath: string): string {
  return join(workspacePath, KNOWLEDGE_DIR)
}

export function externalDir(workspacePath: string): string {
  return join(workspacePath, EXTERNAL_DIR)
}

export function uiClientDir(workspacePath: string): string {
  return join(workspacePath, UI_CLIENT_DIR)
}

export function refsPath(workspacePath: string): string {
  return join(workspacePath, UI_CLIENT_DIR, REFS_FILENAME)
}

export function activeReqPath(workspacePath: string): string {
  return join(workspacePath, UI_CLIENT_DIR, ACTIVE_REQ_FILENAME)
}

export function activeWorkAreaPath(workspacePath: string): string {
  return join(workspacePath, UI_CLIENT_DIR, ACTIVE_WORK_AREA_FILENAME)
}

// UX 项目个人空间元信息：持久化在 .ui-client/personal-space.json（私有，不入项目 git）。
export function personalSpacePath(workspacePath: string): string {
  return join(workspacePath, UI_CLIENT_DIR, PERSONAL_SPACE_FILENAME)
}

export function externalManifestPath(workspacePath: string): string {
  return join(workspacePath, EXTERNAL_MANIFEST_FILENAME)
}
