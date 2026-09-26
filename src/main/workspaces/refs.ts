import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ExternalRefBinding } from '@shared/types'
import { normalizeExternalVisibleDirs } from '@shared/external-ref-controls'
import { refsPath } from './paths'
import { UIClientError } from '../ipc/errors'

// .ui-client/refs.json 读写 API。损坏 / 缺失统一兜底为空数组。
// 写入策略：完整覆写小文件（无并发风险）。

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseBinding(raw: unknown): ExternalRefBinding | null {
  if (!isPlainObject(raw)) return null
  const alias = typeof raw.alias === 'string' ? raw.alias : null
  const externalRefId = typeof raw.externalRefId === 'string' ? raw.externalRefId : null
  const addedAt = typeof raw.addedAt === 'string' ? raw.addedAt : null
  if (!alias || !externalRefId || !addedAt) return null
  const visibleDirs = Array.isArray(raw.visibleDirs)
    ? normalizeExternalVisibleDirs(raw.visibleDirs.filter((item): item is string => typeof item === 'string'))
    : []
  const assetLibrary = typeof raw.assetLibrary === 'string' && raw.assetLibrary.trim()
    ? raw.assetLibrary.trim()
    : null
  const usageNote = typeof raw.usageNote === 'string' && raw.usageNote.trim()
    ? raw.usageNote.trim().slice(0, 4000)
    : null
  return {
    alias,
    externalRefId,
    addedAt,
    ...(visibleDirs.length > 0 ? { visibleDirs } : {}),
    ...(assetLibrary ? { assetLibrary } : {}),
    ...(usageNote ? { usageNote } : {})
  }
}

export async function readRefs(workspacePath: string): Promise<ExternalRefBinding[]> {
  try {
    const text = await fs.readFile(refsPath(workspacePath), 'utf-8')
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseBinding).filter((b): b is ExternalRefBinding => b !== null)
  } catch {
    return []
  }
}

export async function writeRefs(workspacePath: string, bindings: ExternalRefBinding[]): Promise<void> {
  const path = refsPath(workspacePath)
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, JSON.stringify(bindings, null, 2), 'utf-8')
}

// 幂等：同 (alias, externalRefId) 重复 add = no-op；同 alias 异 id 抛 ALIAS_CONFLICT。
export async function addRef(workspacePath: string, binding: ExternalRefBinding): Promise<void> {
  const current = await readRefs(workspacePath)
  const existSame = current.find((b) => b.externalRefId === binding.externalRefId && b.alias === binding.alias)
  if (existSame) return
  const aliasTaken = current.find((b) => b.alias === binding.alias)
  if (aliasTaken) {
    throw new UIClientError('ALIAS_CONFLICT', `工作区内已存在同名引用：${binding.alias}`)
  }
  await writeRefs(workspacePath, [...current, binding])
}

// 静默：找不到不报错；按 externalRefId 移除（同一池条目在工作区只可能有一个 binding）。
export async function removeRef(workspacePath: string, externalRefId: string): Promise<void> {
  const current = await readRefs(workspacePath)
  const next = current.filter((b) => b.externalRefId !== externalRefId)
  if (next.length === current.length) return
  await writeRefs(workspacePath, next)
}

export async function updateRef(
  workspacePath: string,
  externalRefId: string,
  patch: Pick<ExternalRefBinding, 'visibleDirs' | 'assetLibrary' | 'usageNote'>
): Promise<ExternalRefBinding> {
  const current = await readRefs(workspacePath)
  const idx = current.findIndex((b) => b.externalRefId === externalRefId)
  if (idx < 0) {
    throw new UIClientError('NOT_FOUND', `工作区未引用外部库：${externalRefId}`)
  }
  const nextBinding: ExternalRefBinding = { ...current[idx] }
  if (patch.visibleDirs !== undefined) {
    const visibleDirs = normalizeExternalVisibleDirs(patch.visibleDirs)
    if (visibleDirs.length > 0) nextBinding.visibleDirs = visibleDirs
    else delete nextBinding.visibleDirs
  }
  if (patch.assetLibrary !== undefined) {
    const trimmed = patch.assetLibrary?.trim()
    if (trimmed) nextBinding.assetLibrary = trimmed
    else delete nextBinding.assetLibrary
  }
  if (patch.usageNote !== undefined) {
    const trimmed = patch.usageNote.trim()
    if (trimmed) nextBinding.usageNote = trimmed.slice(0, 4000)
    else delete nextBinding.usageNote
  }
  const next = [...current]
  next[idx] = nextBinding
  await writeRefs(workspacePath, next)
  return nextBinding
}
