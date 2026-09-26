import { app } from 'electron'
import { join } from 'node:path'

export function resourceIndexesRoot(): string {
  return join(app.getPath('userData'), 'resource-indexes')
}

export function resourceIndexDir(externalRefId: string): string {
  return join(resourceIndexesRoot(), externalRefId)
}

export function resourceIndexStatusPath(externalRefId: string): string {
  return join(resourceIndexDir(externalRefId), 'status.json')
}
