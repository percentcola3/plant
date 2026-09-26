import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { externalDir } from '../workspaces/paths'
import type { ActiveWorkArea } from '../workspaces/work-area'

export type ClaudeLaunchContext = {
  workDir: string
  addDirs: string[]
}

export function resolveClaudeLaunchContext(
  projectPath: string,
  workArea: ActiveWorkArea | null
): ClaudeLaunchContext {
  if (!workArea) return { workDir: projectPath, addDirs: [] }

  const candidates = [projectPath, externalDir(projectPath)]
  return {
    workDir: join(projectPath, workArea.relPath),
    addDirs: candidates.filter((dir) => {
      try { return existsSync(dir) } catch { return false }
    })
  }
}
