import { app } from 'electron'
import { join } from 'node:path'

// 外部资源池物理布局：
//   userData/external-pool.json   池索引（schemaVersion: 1）
//   userData/external-pool/<id>/  git 类型条目的物理目录（local 类型不入池，poolPath = source）
//
// 与老 knowledge-bases 池并存，互不影响；R5 数据迁移完成后老池下架。

export function poolRoot(): string {
  return join(app.getPath('userData'), 'external-pool')
}

export function poolEntryPath(id: string): string {
  return join(poolRoot(), id)
}

export function indexFile(): string {
  return join(app.getPath('userData'), 'external-pool.json')
}
