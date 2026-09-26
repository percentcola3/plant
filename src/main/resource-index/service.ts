// 知识库/UI 资产库的检索索引管理：现在唯一的索引就是 zg 混合索引
// （ripgrep + BM25 + 向量，本地无 AI）。
//
// 本模块只负责三件事：
//   1. 构建排队（进程内串行，同一 ref 去重）
//   2. 触发 zg 构建（ensureZgIndex，10 分钟超时；CN 网络 HF 失败自动回退 ModelScope）
//   3. 状态落盘 status.json（queued/building/ready/error），供面板展示与启动补救
//
// 中途关闭应用的生命周期（实测/设计契约）：
//   - zg daemon 独立于 App 进程常驻，向量 embedding 后台补齐不因退出而中断；
//     重活都在 daemon 侧，status.json 停在 'building' 也无数据损失。
//   - 下次启动 ensureMissingResourceIndexes 会把遗留的 building/queued 重排为
//     missing-index → 增量重建（zg 按内容哈希续作，daemon 未完成的自动续上）。
//   - 与常驻 daemon 的并发锁冲突（ZVEC_GREP.ENGINE.LOCK.BUSY）由
//     zgIndexBuild/zgStatusWithRetry 的退避重试吸收。
//
// 旧的 INDEX.md / files.jsonl 同步产物已移除；语义检索一律走 zg（App 内搜索
// 自动使用），AI 会话按 .external/<alias>/ 直接读取原文件。
import { promises as fs } from 'node:fs'
import type { ExternalRef, ExternalRefIndexStatus } from '@shared/types'
import { ensureZgIndex, zgIndexError, zgIndexStats, type ZgIndexProgress } from '../zg/zg-search'
import {
  resourceIndexDir,
  resourceIndexStatusPath
} from './paths'

export type ResourceIndexReason = 'first-import' | 'git-update' | 'checkout-change' | 'missing-index' | 'manual'

type PendingBuild = { ref: ExternalRef; reason: ResourceIndexReason }
const pending = new Map<string, PendingBuild>()
let drainPromise: Promise<void> | null = null

export function scheduleResourceIndexBuild(ref: ExternalRef, reason: ResourceIndexReason): void {
  pending.set(ref.id, { ref, reason })
  if (drainPromise) return
  drainPromise = drainBuildQueue().finally(() => {
    drainPromise = null
    if (pending.size > 0) scheduleResourceIndexBuildFromPending()
  })
}

function scheduleResourceIndexBuildFromPending(): void {
  if (drainPromise || pending.size === 0) return
  drainPromise = drainBuildQueue().finally(() => {
    drainPromise = null
    if (pending.size > 0) scheduleResourceIndexBuildFromPending()
  })
}

async function drainBuildQueue(): Promise<void> {
  while (pending.size > 0) {
    const entry = pending.entries().next().value as [string, PendingBuild] | undefined
    if (!entry) return
    const [externalRefId, next] = entry
    pending.delete(externalRefId)
    if (!next) continue
    await markQueued(externalRefId, next.reason)
    await buildResourceIndex(next.ref, next.reason).catch((error) => {
      console.warn('[resource-index] build failed:', next.ref.alias, error instanceof Error ? error.message : error)
    })
  }
}

async function markQueued(externalRefId: string, reason: ResourceIndexReason): Promise<void> {
  await fs.mkdir(resourceIndexDir(externalRefId), { recursive: true })
  await writeStatus(externalRefId, {
    externalRefId,
    state: 'queued',
    reason,
    updatedAt: new Date().toISOString()
  })
}

export async function buildResourceIndex(
  ref: ExternalRef,
  reason: ResourceIndexReason
): Promise<ExternalRefIndexStatus> {
  await fs.mkdir(resourceIndexDir(ref.id), { recursive: true })
  await writeStatus(ref.id, {
    externalRefId: ref.id,
    state: 'building',
    reason,
    updatedAt: new Date().toISOString()
  })

  try {
    // 构建期分步进度（参照 zg TUI：扫描文件 → 准备模型(首次) → 构建索引），
    // 节流落盘供面板 2.5s 轮询展示。写入串成链并在 ready 前排空，
    // 避免迟到的进度写把最终状态倒刷回 building。
    let lastPersist = 0
    let progressWrites: Promise<void> = Promise.resolve()
    const persistProgress = (progress: ZgIndexProgress): void => {
      // 'done'（带汇总）后紧跟 ready 落盘，无需再写 building 态
      if (progress.phase === 'done') return
      const now = Date.now()
      if (now - lastPersist < 1_000) return
      lastPersist = now
      const phase = progress.phase
      const percent = progress.percent
      progressWrites = progressWrites.then(() => writeStatus(ref.id, {
        externalRefId: ref.id,
        state: 'building',
        reason,
        progress: { phase, ...(percent !== undefined ? { percent } : {}) },
        updatedAt: new Date().toISOString()
      })).catch(() => undefined)
    }

    const ok = await ensureZgIndex(ref.poolPath, {
      force: reason === 'manual' || reason === 'git-update' || reason === 'checkout-change',
      onProgress: persistProgress
    })
    await progressWrites
    if (!ok) {
      const detail = zgIndexError(ref.poolPath)
      const status: ExternalRefIndexStatus = {
        externalRefId: ref.id,
        state: 'error',
        reason,
        updatedAt: new Date().toISOString(),
        message: `zg 索引构建失败：${detail ?? '未知原因'}。搜索会自动回退文本匹配。`
      }
      await writeStatus(ref.id, status)
      return status
    }

    // 覆盖率用于面板展示；拿不到（并发/超时）不视为失败
    const stats = await zgIndexStats(ref.poolPath).catch(() => null)
    // 词法索引已就绪但 daemon 还有向量补齐任务 → 标记 enhancing（pending=当前
    // 待补齐数，total=首次记录值，供面板算百分比；归零后由 live 刷新清除）
    const enhancing = stats?.queuePending
      ? { pending: stats.queuePending, total: stats.queuePending }
      : undefined
    const status: ExternalRefIndexStatus = {
      externalRefId: ref.id,
      state: 'ready',
      reason,
      engine: 'zg',
      fileCount: stats?.filesTotal,
      embedding: stats?.embedding,
      entities: stats?.entities,
      builtAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(enhancing ? { enhancing } : {}),
      ...(stats?.embedding ? { message: `zg 混合索引 · ${stats.embedding}` } : {})
    }
    await writeStatus(ref.id, status)
    return status
  } catch (error) {
    const status: ExternalRefIndexStatus = {
      externalRefId: ref.id,
      state: 'error',
      reason,
      updatedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error)
    }
    await writeStatus(ref.id, status)
    return status
  }
}

export async function readResourceIndexStatus(externalRefId: string): Promise<ExternalRefIndexStatus> {
  try {
    const raw = await fs.readFile(resourceIndexStatusPath(externalRefId), 'utf-8')
    return JSON.parse(raw) as ExternalRefIndexStatus
  } catch {
    return {
      externalRefId,
      state: 'missing',
      updatedAt: new Date().toISOString()
    }
  }
}

// 实时状态：ready 时补齐 zg 证据（embedding/实体，仅缺 engine 时打一次 zg status）；
// 若有 enhancing 标记则顺带刷新向量补齐进度。证据已落盘且无 enhancing 时零开销。
// 永不降级已持久化的 ready/error 状态（瞬时 LOCK.BUSY 已由重试吸收）。
export async function readResourceIndexStatusLive(
  externalRefId: string,
  poolPath: string
): Promise<ExternalRefIndexStatus> {
  const base = await readResourceIndexStatus(externalRefId)
  if (base.state !== 'ready') return base
  const needsEnhanceRefresh = !!base.enhancing
  const needsEvidence = base.engine !== 'zg'
  if (!needsEnhanceRefresh && !needsEvidence) return base
  const stats = await zgIndexStats(poolPath).catch(() => null)
  if (!stats) return base
  const pending = stats.queuePending ?? 0
  const evidence: Pick<ExternalRefIndexStatus, 'engine' | 'embedding' | 'entities' | 'fileCount'> = {
    engine: 'zg',
    fileCount: stats.filesTotal,
    ...(stats.embedding ? { embedding: stats.embedding } : {}),
    entities: stats.entities
  }
  if (pending > 0) {
    if (
      base.enhancing?.pending === pending
      && base.embedding === evidence.embedding
      && base.entities === evidence.entities
    ) return { ...base, ...evidence }
    const merged: ExternalRefIndexStatus = {
      ...base,
      ...evidence,
      enhancing: { pending, total: base.enhancing?.total ?? pending }
    }
    await writeStatus(externalRefId, merged).catch(() => undefined)
    return merged
  }
  const { enhancing: _done, ...cleared } = base
  const updated: ExternalRefIndexStatus = {
    ...cleared,
    ...evidence,
    updatedAt: new Date().toISOString()
  }
  await writeStatus(externalRefId, updated).catch(() => undefined)
  return updated
}

async function writeStatus(externalRefId: string, status: ExternalRefIndexStatus): Promise<void> {
  await writeAtomic(resourceIndexStatusPath(externalRefId), `${JSON.stringify(status, null, 2)}\n`)
}

async function writeAtomic(path: string, content: string, readonly = false): Promise<void> {
  const tempPath = `${path}.${process.pid}.tmp`
  await fs.writeFile(tempPath, content, 'utf-8')
  await fs.rename(tempPath, path)
  if (readonly) await fs.chmod(path, 0o444).catch(() => undefined)
}
