// 共享：从产物 / feature 目录的 meta 文件读取上次发布的 HEAD SHA，并算 changelog。
// 抽自 outputs/publish.ts 的内联实现，让 PM 也能复用。
//
// 不同发布器的 meta 文件名 / 字段结构不同（UX 的 meta.json 里 publish.headSha；
// PM 的 .publish.json 直接是顶层 headSha），所以提供两个 reader，避免硬编码。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gitFor } from '../git/client'

export async function readHeadSha(workspacePath: string): Promise<string | undefined> {
  try {
    const sha = await gitFor(workspacePath).raw(['rev-parse', 'HEAD'])
    const trimmed = sha.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch {
    return undefined
  }
}

// UX 产物 meta.json：{ publish: { headSha } }
export async function readPrevPublishHeadShaFromMetaJson(productAbs: string): Promise<string | undefined> {
  return readShaFromFile(join(productAbs, 'meta.json'), (parsed) => {
    return (parsed as { publish?: { headSha?: unknown } }).publish?.headSha
  })
}

// PM feature .publish.json：{ headSha }（顶层）
export async function readPrevPublishHeadShaFromPublishJson(featureAbs: string): Promise<string | undefined> {
  return readShaFromFile(join(featureAbs, '.publish.json'), (parsed) => {
    return (parsed as { headSha?: unknown }).headSha
  })
}

async function readShaFromFile(absPath: string, extract: (parsed: unknown) => unknown): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(absPath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const sha = extract(parsed)
    return typeof sha === 'string' && sha.trim() ? sha : undefined
  } catch {
    return undefined
  }
}

// 取 oldSha..newSha 的 commit 标题列表作为 changelog。oldSha 不可达（rebase / force-push）
// 或无提交差异时返回 []，不阻塞发布。
export async function collectChangelogEntries(
  workspacePath: string,
  oldSha: string,
  newSha: string | undefined
): Promise<string[]> {
  if (!newSha) return []
  try {
    const output = await gitFor(workspacePath).raw([
      'log',
      `${oldSha}..${newSha}`,
      '--format=%s'
    ])
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}
