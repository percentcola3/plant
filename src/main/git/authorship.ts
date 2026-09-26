import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { gitFor } from './client'
import { readLocalGitUser } from './identity'
import { UIClientError } from '../ipc/errors'

// 查文件第一次进入仓库的提交作者邮箱（--diff-filter=A 只看 add）。
// - 文件没在 git 跟踪过（新建未提交） → 返回 null，视作"当前用户的"，允许删除
// - 文件在 git 历史里 → 返回最早 add 的 author email
// 注意 --follow 会跟着重命名走，所以即使被改过名也能找到原始作者。
export async function firstAuthorEmailOf(cwd: string, relPath: string): Promise<string | null> {
  const sg = gitFor(cwd)
  try {
    const out = await sg.raw([
      'log',
      '--diff-filter=A',
      '--follow',
      '--reverse',
      '--pretty=%ae',
      '--',
      relPath
    ])
    const first = out.split('\n').map((s) => s.trim()).filter(Boolean)[0]
    return first || null
  } catch {
    return null
  }
}

// 校验当前 git 用户是否有权删除指定路径。不能删时抛 NOT_OWNER。
export async function assertCanDelete(cwd: string, relPath: string): Promise<void> {
  const author = await firstAuthorEmailOf(cwd, relPath)
  if (!author) return  // 没进过 git 历史，视作本地新建，允许删
  const me = (await readLocalGitUser(cwd)).email
  if (!me) {
    throw new UIClientError(
      'NO_GIT_IDENTITY',
      `无法读取你的 git 身份（git config user.email），请先在终端里 git config --global user.email <你的邮箱>`
    )
  }
  if (author.toLowerCase() !== me.toLowerCase()) {
    throw new UIClientError(
      'NOT_OWNER',
      `${basename(relPath)} 是 ${author} 加入仓库的，只有作者本人能删`
    )
  }
}

// 校验目录下所有跟踪文件是否都归当前用户。任何一个不是 → 整个目录禁止删除，
// 抛 NOT_OWNER 并指出最早遇到的"非你"文件，方便用户定位。
export async function assertCanDeleteDirectory(
  cwd: string,
  relDir: string
): Promise<void> {
  const absDir = join(cwd, relDir)
  const files: string[] = []
  await collectTrackedFiles(cwd, absDir, relDir, files)
  if (files.length === 0) return  // 空目录或全部未跟踪 → 允许
  const me = (await readLocalGitUser(cwd)).email
  if (!me) {
    throw new UIClientError(
      'NO_GIT_IDENTITY',
      `无法读取你的 git 身份（git config user.email），请先在终端里 git config --global user.email <你的邮箱>`
    )
  }
  for (const rel of files) {
    const author = await firstAuthorEmailOf(cwd, rel)
    if (author && author.toLowerCase() !== me.toLowerCase()) {
      throw new UIClientError(
        'NOT_OWNER',
        `${relDir}/ 里的 ${rel} 是 ${author} 加入仓库的，目录里有别人的文件就不能整目录删除`
      )
    }
  }
}

async function collectTrackedFiles(
  projectRoot: string,
  absDir: string,
  relDir: string,
  out: string[]
): Promise<void> {
  let entries: { name: string; isDir: boolean; isFile: boolean }[] = []
  try {
    const dirents = await fs.readdir(absDir, { withFileTypes: true })
    entries = dirents.map((d) => ({
      name: d.name,
      isDir: d.isDirectory(),
      isFile: d.isFile()
    }))
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === '.git') continue
    const childRel = `${relDir}/${e.name}`.replace(/\\/g, '/')
    const childAbs = join(absDir, e.name)
    if (e.isDir) {
      await collectTrackedFiles(projectRoot, childAbs, childRel, out)
    } else if (e.isFile) {
      out.push(childRel)
    }
  }
}
