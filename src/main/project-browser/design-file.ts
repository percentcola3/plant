import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { WebPageDesign, WebPageDesignSnapshot } from '../../shared/project-browser'

function isInside(root: string, target: string): boolean {
  return target.startsWith(root + sep)
}

export async function savePageDesign(
  workspacePath: string,
  projectRelPath: string,
  snapshot: WebPageDesignSnapshot
): Promise<WebPageDesign> {
  if (!projectRelPath || isAbsolute(projectRelPath) || projectRelPath.includes('\\')
    || projectRelPath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('项目路径无效')
  }
  const workspaceRoot = await fs.realpath(workspacePath)
  const projectRoot = await fs.realpath(resolve(workspaceRoot, projectRelPath))
  if (!isInside(workspaceRoot, projectRoot) || !(await fs.stat(projectRoot)).isDirectory()) {
    throw new Error('设计稿只能保存到当前工作区的项目目录')
  }
  const directory = join(projectRoot, '网页设计稿')
  await fs.mkdir(directory, { recursive: true })
  if (await fs.realpath(directory) !== directory) throw new Error('设计稿目录不能是符号链接')
  const stem = (snapshot.title || '网页')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 60) || '网页'
  const fileName = `${stem}-${randomUUID().slice(0, 8)}.html`
  // Exclusive creation keeps existing designs and user drafts intact.
  const target = join(directory, fileName)
  await fs.writeFile(target, snapshot.html, { encoding: 'utf8', flag: 'wx' })
  const { html: _html, ...metadata } = snapshot
  return { ...metadata, relPath: join(projectRelPath, relative(projectRoot, target)).split(sep).join('/') }
}
