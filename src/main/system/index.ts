import { shell } from 'electron'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { UIClientError } from '../ipc/errors'

// 安全前提：renderer 传过来的路径必须能解析到一个已注册项目目录内。
// 这一层不做项目存在性校验，由调用方在传入前用 service 校验过；这里只做路径合法性。

export async function openInBrowser(filePath: string, projectPath?: string): Promise<void> {
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(join(projectPath ?? '', filePath))
  if (projectPath) {
    const projAbs = resolve(projectPath)
    if (!abs.startsWith(projAbs)) {
      throw new UIClientError('PATH_OUTSIDE_PROJECT', `路径越界：${filePath}`)
    }
  }
  try {
    await fs.access(abs)
  } catch {
    throw new UIClientError('FILE_NOT_FOUND', `文件不存在：${abs}`)
  }
  // shell.openPath 接受绝对路径，自动用系统默认应用打开
  const errMsg = await shell.openPath(abs)
  if (errMsg) {
    throw new UIClientError('OPEN_FAILED', errMsg)
  }
}

export async function openInIDE(targetPath: string): Promise<void> {
  // M3 阶段不实现，留给 M6/M7 接 cursor / code 探测
  throw new UIClientError('NOT_IMPLEMENTED', `openInIDE("${targetPath}") 留待 M6/M7`)
}

export function revealInFinder(targetPath: string): void {
  shell.showItemInFolder(targetPath)
}
