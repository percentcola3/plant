// system.md：项目唯一的 AI 约束事实源（用户自管、随仓库走）。
//
// 项目根（本模块）收敛到目标态：根只留 system.md，默认无 CLAUDE.md/AGENTS.md。
//   - system.md：缺则按模板生成；存在则剥掉历史遗留的 App 受管块（早期版本可能把旧块
//     迁进来过），剥完为空则重置为模板，否则保留用户真内容。
//   - CLAUDE.md / AGENTS.md：
//       · 符号链接（旧版本建的根链接）→ 删除（默认根不留这两个文件）。
//       · 真实文件：剥掉旧 App 受管块——剥完为空（整份是旧 App 生成内容）则删除；
//         还有用户真内容则保留 + 末尾注入 @system.md。
//
// 真正把 system.md 关联进 feature 的 CLAUDE.md/AGENTS.md/.cursor 符号链接发生在
// features/ai-links.ts。失败不阻塞 sync。

import { promises as fs } from 'node:fs'
import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { renderSystemDoc } from '@shared/ai-rule-text'

const SYSTEM_DOC = 'system.md'
const LINK_NAMES = ['CLAUDE.md', 'AGENTS.md'] as const
const MARK_BEGIN = '<!-- BEGIN ui-client:system-link (app-managed) -->'
const MARK_END = '<!-- END ui-client:system-link -->'
const MARKED_BLOCK = `${MARK_BEGIN}\n@${SYSTEM_DOC}\n${MARK_END}`

// 旧版 App 写入的受管块 + 我们自己的 system-link 块，迁移/自愈时一并剥掉。
const MANAGED_BLOCK_RES = [
  /<!-- UI-CLIENT:WORKSPACE-RULES:START -->[\s\S]*?<!-- UI-CLIENT:WORKSPACE-RULES:END -->/g,
  /<!-- BEGIN ui-client:ui-asset-rules \(app-managed\) -->[\s\S]*?<!-- END ui-client:ui-asset-rules -->/g,
  /<!-- BEGIN ui-client:system-link \(app-managed\) -->[\s\S]*?<!-- END ui-client:system-link -->/g
]

export type SystemDocLinkResult = 'injected' | 'already' | 'removed-legacy' | 'removed-link' | 'absent'
export type SystemDocOutcome = {
  systemDoc: 'created' | 'cleaned' | 'exists'
  injected: Record<string, SystemDocLinkResult>
}

function isRealFile(p: string): boolean {
  const st = lstatSync(p, { throwIfNoEntry: false })
  return st !== undefined && !st.isSymbolicLink() && st.isFile()
}

function stripManagedBlocks(content: string): string {
  let out = content
  for (const re of MANAGED_BLOCK_RES) out = out.replace(re, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

async function ensureSystemFile(systemAbs: string): Promise<SystemDocOutcome['systemDoc']> {
  if (!existsSync(systemAbs)) {
    await fs.writeFile(systemAbs, renderSystemDoc(), 'utf-8')
    return 'created'
  }
  const cur = await fs.readFile(systemAbs, 'utf-8').catch(() => '')
  const cleaned = stripManagedBlocks(cur)
  if (cleaned === '') {
    // 整份是历史遗留 App 块（无用户内容）→ 重置为模板
    await fs.writeFile(systemAbs, renderSystemDoc(), 'utf-8')
    return 'cleaned'
  }
  if (cleaned + '\n' !== cur) {
    await fs.writeFile(systemAbs, cleaned + '\n', 'utf-8')
    return 'cleaned'
  }
  return 'exists'
}

export async function ensureSystemDoc(workspacePath: string): Promise<SystemDocOutcome> {
  const systemDoc = await ensureSystemFile(join(workspacePath, SYSTEM_DOC))

  const injected: SystemDocOutcome['injected'] = {}
  for (const name of LINK_NAMES) {
    const abs = join(workspacePath, name)
    const st = lstatSync(abs, { throwIfNoEntry: false })
    if (st === undefined) { injected[name] = 'absent'; continue }
    if (st.isSymbolicLink()) {
      // 旧版本在根建的符号链接 → 删除（默认根不留 CLAUDE.md/AGENTS.md）
      await fs.rm(abs, { force: true })
      injected[name] = 'removed-link'
      continue
    }
    if (!isRealFile(abs)) { injected[name] = 'absent'; continue }

    const raw = await fs.readFile(abs, 'utf-8').catch(() => '')
    const residual = stripManagedBlocks(raw)
    if (residual === '') {
      await fs.rm(abs, { force: true })
      injected[name] = 'removed-legacy'
      continue
    }
    const next = residual + '\n\n' + MARKED_BLOCK + '\n'
    if (next === raw) { injected[name] = 'already'; continue }
    await fs.writeFile(abs, next, 'utf-8')
    injected[name] = 'injected'
  }
  return { systemDoc, injected }
}
