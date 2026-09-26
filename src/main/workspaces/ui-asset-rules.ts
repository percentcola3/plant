// Cursor 适配：把项目唯一事实源 system.md 镜像成 .cursor/rules/ui-client-ui-assets.mdc。
//
// Cursor 不读 system.md / AGENTS.md，只认 .cursor/rules/*.mdc —— 于是从 system.md 镜像
// 一份（system.md 才是事实源；AGENTS.md 默认不存在）。.mdc 是纯 App 托管文件
// （gitignored），可整文件覆盖 / 删除。
//
// system.md 存在且非空 → 写镜像；不存在 / 空 → 删镜像。幂等。

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

const CURSOR_RULE_REL = '.cursor/rules/ui-client-ui-assets.mdc'
const SYSTEM_REL = 'system.md'

async function writeIfChanged(absPath: string, next: string): Promise<void> {
  const current = await fs.readFile(absPath, 'utf-8').catch(() => '')
  if (current === next) return
  await fs.mkdir(dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, next, 'utf-8')
}

async function removeIfPresent(absPath: string): Promise<void> {
  await fs.rm(absPath, { force: true }).catch(() => undefined)
}

function renderCursorMdc(body: string): string {
  return `---\ndescription: 项目 AI 约束（App 从 system.md 自动镜像，勿手动编辑）\nalwaysApply: true\n---\n\n${body.trim()}\n`
}

// 从项目根 system.md 镜像 Cursor 规则。system.md 缺失/空白 → 删除镜像文件。
export async function syncCursorRulesFromSystemDoc(workspacePath: string): Promise<void> {
  const cursorAbs = join(workspacePath, CURSOR_RULE_REL)
  const body = await fs.readFile(join(workspacePath, SYSTEM_REL), 'utf-8').catch(() => '')
  if (body.trim() === '') {
    await removeIfPresent(cursorAbs)
    return
  }
  await writeIfChanged(cursorAbs, renderCursorMdc(body))
}
