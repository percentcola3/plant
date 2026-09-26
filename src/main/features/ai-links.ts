// PM feature 目录的 AI 配置符号链接：把项目根的
//   .claude/      .agents/      .cursor/rules
//   .external/      CLAUDE.md      AGENTS.md
// 链接到 feature 子目录，让 Claude Code 在 cwd 锁定模式下仍能发现项目级 skill、
// 约束文档和外部资产/知识库。**根目录唯一事实源**，零副本零漂移。
//
// 调用时机：
//   - features/lifecycle.createFeature：新建 feature 时挂上
//   - workspace.setWorkArea：spawn AI 前再 ensure 一次（防 clone / 手动删除）
//
// idempotent 设计：
//   - 链接不存在 → 创建
//   - 链接存在且 target 正确 → no-op
//   - 链接存在但 target 错（旧引用 / 项目搬位置）→ 删旧建新
//   - 同名实文件 / 实目录存在（旧 seedProductAgentFiles 留下的副本）→ 跳过 + 日志，
//     不主动破坏用户数据；用户手动 git rm 后下次自动挂上

import { promises as fs } from 'node:fs'
import { existsSync, lstatSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { ensureSystemDoc } from '../workspaces/system-doc'

const LINK_TARGETS = ['.claude', '.agents', '.cursor/rules', '.external', 'system.md', 'CLAUDE.md', 'AGENTS.md'] as const

export type AiLinkOutcome = {
  /** key = target 名（'.claude' 等），value = 处理结果 */
  results: Record<string, 'linked' | 'already-linked' | 'skipped-real' | 'source-missing'>
}

/** 计算从 link 所在目录到根目标的相对路径，如 features/login/.cursor/rules → ../../../.cursor/rules。 */
function relativeLinkTarget(featureRelPath: string, name: string, targetName: string): string {
  return relative(dirname(join(featureRelPath, name)), targetName)  // path.relative 不依赖 fs，纯字符串
}

// feature 里的 link 名 → 根目录的实际目标名。
// CLAUDE.md / AGENTS.md：根有用户自有的同名文件就指它（已注入 @system.md），否则指 system.md。
function rootTargetName(workspacePath: string, name: string): string {
  if (name === 'CLAUDE.md' || name === 'AGENTS.md') {
    return existsSync(join(workspacePath, name)) ? name : 'system.md'
  }
  return name
}

async function readSymlinkTarget(linkPath: string): Promise<string | null> {
  try {
    const st = lstatSync(linkPath)
    if (!st.isSymbolicLink()) return null
    return await fs.readlink(linkPath)
  } catch {
    return null
  }
}

async function ensureOneLink(
  workspacePath: string,
  featureRelPath: string,
  name: string
): Promise<AiLinkOutcome['results'][string]> {
  const targetName = rootTargetName(workspacePath, name)
  const sourceAbs = join(workspacePath, targetName)
  if (!existsSync(sourceAbs)) return 'source-missing'

  const linkAbs = join(workspacePath, featureRelPath, name)
  const expectedTarget = relativeLinkTarget(featureRelPath, name, targetName)

  const existsAtLink = existsSync(linkAbs) || lstatSync(linkAbs, { throwIfNoEntry: false }) !== undefined
  if (existsAtLink) {
    const currentTarget = await readSymlinkTarget(linkAbs)
    if (currentTarget === expectedTarget) return 'already-linked'
    if (currentTarget !== null) {
      // 是 symlink 但 target 错（可能项目搬过位置）— 删旧建新
      await fs.unlink(linkAbs)
    } else {
      // 是真实文件 / 目录 — 不破坏用户数据，跳过
      return 'skipped-real'
    }
  }

  await fs.mkdir(dirname(linkAbs), { recursive: true })
  await fs.symlink(expectedTarget, linkAbs)
  return 'linked'
}

export async function ensureFeatureAiLinks(
  workspacePath: string,
  featureRelPath: string
): Promise<AiLinkOutcome> {
  // CLAUDE.md/AGENTS.md 默认 fallback 到根 system.md，先确保它存在（含给已有文件注入 @system.md）。
  await ensureSystemDoc(workspacePath).catch(() => undefined)
  const results: AiLinkOutcome['results'] = {}
  for (const name of LINK_TARGETS) {
    results[name] = await ensureOneLink(workspacePath, featureRelPath, name)
  }
  return { results }
}
