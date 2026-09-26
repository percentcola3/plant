import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ExternalRef } from '@shared/types'
import { indexFile } from './paths'
import { UIClientError } from '../ipc/errors'

// alias 校验：拉丁字母 / 数字 / 下划线 / 连字符 / CJK 统一汉字；长度 1-40
export const ALIAS_PATTERN = /^[A-Za-z0-9_\-一-龥]{1,40}$/

// userData/external-pool.json 持久化。仿 KnowledgeBaseStore 但完全独立。
// alias 全局唯一（沿用 ALIAS_PATTERN）；id 在 service 层生成 randomUUID。

type PoolFile = {
  externalRefs: ExternalRef[]
  schemaVersion: 1
}

const EMPTY: PoolFile = { externalRefs: [], schemaVersion: 1 }

let sharedCache: PoolFile | null = null

export function _testOnlyResetSharedCache(): void {
  sharedCache = null
}

export class ExternalPoolStore {
  async load(): Promise<PoolFile> {
    if (sharedCache) return sharedCache
    try {
      const text = await fs.readFile(indexFile(), 'utf-8')
      const parsed = JSON.parse(text) as PoolFile
      if (!Array.isArray(parsed.externalRefs)) {
        sharedCache = { ...EMPTY }
      } else {
        sharedCache = { ...parsed, schemaVersion: 1 }
      }
    } catch {
      sharedCache = { ...EMPTY }
    }
    return sharedCache
  }

  async save(): Promise<void> {
    if (!sharedCache) return
    const path = indexFile()
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, JSON.stringify(sharedCache, null, 2), 'utf-8')
  }

  async list(): Promise<ExternalRef[]> {
    const f = await this.load()
    return [...f.externalRefs]
  }

  async findById(id: string): Promise<ExternalRef | null> {
    const f = await this.load()
    return f.externalRefs.find((r) => r.id === id) ?? null
  }

  async findByAlias(alias: string): Promise<ExternalRef | null> {
    const f = await this.load()
    return f.externalRefs.find((r) => r.alias === alias) ?? null
  }

  async add(ref: ExternalRef): Promise<void> {
    if (!ALIAS_PATTERN.test(ref.alias)) {
      throw new UIClientError('VALIDATION', `外部库别名不合法：${ref.alias}`)
    }
    const f = await this.load()
    if (f.externalRefs.some((r) => r.alias === ref.alias)) {
      throw new UIClientError('EXTERNAL_ALIAS_TAKEN', `外部库别名已被占用：${ref.alias}`)
    }
    if (f.externalRefs.some((r) => r.id === ref.id)) {
      throw new UIClientError('VALIDATION', `外部库 id 已存在：${ref.id}`)
    }
    f.externalRefs.push(ref)
    await this.save()
  }

  async remove(id: string): Promise<void> {
    const f = await this.load()
    const next = f.externalRefs.filter((r) => r.id !== id)
    if (next.length === f.externalRefs.length) return
    f.externalRefs = next
    await this.save()
  }

  async update(id: string, patch: Partial<Omit<ExternalRef, 'id' | 'alias'>>): Promise<void> {
    const f = await this.load()
    const idx = f.externalRefs.findIndex((r) => r.id === id)
    if (idx < 0) throw new UIClientError('NOT_FOUND', `外部库不存在：${id}`)
    f.externalRefs[idx] = { ...f.externalRefs[idx], ...patch }
    await this.save()
  }
}

export const externalPoolStore = new ExternalPoolStore()
