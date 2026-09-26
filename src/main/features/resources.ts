import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FeatureResourceSelection } from '@shared/types'
import { assertFeatureRelPath } from './scanner'

const RESOURCE_CONFIG_REL_PATH = '.ui-client/resources.json'

function configPath(workspacePath: string, featureRelPath: string): string {
  return join(workspacePath, assertFeatureRelPath(featureRelPath), RESOURCE_CONFIG_REL_PATH)
}

export async function readFeatureResourceSelection(
  workspacePath: string,
  featureRelPath: string
): Promise<FeatureResourceSelection | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(workspacePath, featureRelPath), 'utf-8')) as Record<string, unknown>
    if (parsed.version !== 1 || !Array.isArray(parsed.externalRefIds)) return null
    return {
      version: 1,
      externalRefIds: [...new Set(parsed.externalRefIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean))],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString()
    }
  } catch {
    return null
  }
}

export async function writeFeatureResourceSelection(
  workspacePath: string,
  featureRelPath: string,
  externalRefIds: string[]
): Promise<FeatureResourceSelection> {
  const path = configPath(workspacePath, featureRelPath)
  const selection: FeatureResourceSelection = {
    version: 1,
    externalRefIds: [...new Set(externalRefIds.map((id) => id.trim()).filter(Boolean))],
    updatedAt: new Date().toISOString()
  }
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, `${JSON.stringify(selection, null, 2)}\n`, 'utf-8')
  return selection
}
