import { app } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'

// 集中所有路径决定。项目集中存放在
// ~/Documents/WorkSpace-projects/<repo-name>，App 数据在 userData 下。

export function projectsRoot(): string {
  return join(homedir(), 'Documents', 'WorkSpace-projects')
}

export function projectsJsonPath(): string {
  return join(app.getPath('userData'), 'projects.json')
}

export function settingsJsonPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function logsDir(): string {
  return app.getPath('logs')
}
