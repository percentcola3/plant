// 新建或打开 UX/PM 产物时，把工作区根的 AI 配置复制到产物子目录，
// 让产物自带 AI 启动配置。
// 配合 spawn cwd=产物 + --add-dir 项目根 使用：
// - claude-code 在产物 cwd 启动 → 直接看到 ./.claude/skills/、CLAUDE.md、.external/ 和资源索引
// - Cursor / Codex 在产物目录打开 → 同样直接看到本地的 skill 配置
// 见 docs/superpowers/specs/2026-06-24-cwd-scoped-agent-design.md。

import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const SEED_DIRS = ['.claude/skills', '.agents/skills'] as const
const SEED_FILES = ['AGENTS.md', 'CLAUDE.md'] as const
const SEED_OPTIONAL_DIRS = ['.cursor/rules'] as const
const SEED_SYMLINK_DIRS = ['.external'] as const

export type SeedAgentFilesResult = {
  /** 复制的文件总数（不计目录） */
  copied: number
  /** 实际有内容被复制的源相对路径（用于诊断 / toast） */
  sourcedFrom: string[]
}

// 递归复制 src 整个目录到 dst。已存在的文件会被覆盖（产物初始化场景，
// 目标目录刚创建，不存在用户编辑保留问题）。
async function copyTree(src: string, dst: string): Promise<number> {
  let count = 0
  const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => null)
  if (!entries) return 0
  await fs.mkdir(dst, { recursive: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.DS_Store')) continue
    const s = join(src, entry.name)
    const d = join(dst, entry.name)
    if (entry.isDirectory()) {
      count += await copyTree(s, d)
    } else if (entry.isFile()) {
      await fs.copyFile(s, d)
      count += 1
    }
    // 软链接 / 设备文件等忽略
  }
  return count
}

async function dirHasContent(absPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(absPath)
    return entries.some((e) => !e.startsWith('.DS_Store'))
  } catch {
    return false
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath)
    return stat.isFile()
  } catch {
    return false
  }
}

async function copyFileIfPresent(src: string, dst: string): Promise<number> {
  if (!(await fileExists(src))) return 0
  if (await pathExists(dst)) return 0
  await fs.mkdir(dirname(dst), { recursive: true })
  await fs.copyFile(src, dst)
  return 1
}

async function readSymlinkTarget(absPath: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(absPath)
    if (!stat.isSymbolicLink()) return null
    return await fs.readlink(absPath)
  } catch {
    return null
  }
}

async function pathExists(absPath: string): Promise<boolean> {
  return fs.lstat(absPath).then(() => true).catch(() => false)
}

async function ensureSymlinkDir(
  workspacePath: string,
  productRelPath: string,
  rel: string
): Promise<void> {
  const src = join(workspacePath, rel)
  const srcStat = await fs.stat(src).catch(() => null)
  if (!srcStat?.isDirectory()) return

  const dst = join(workspacePath, productRelPath, rel)
  const expectedTarget = relative(dirname(join(productRelPath, rel)), rel)
  const currentTarget = await readSymlinkTarget(dst)
  if (currentTarget === expectedTarget) return
  if (currentTarget !== null) {
    await fs.unlink(dst)
  } else if (await pathExists(dst)) {
    return
  }

  await fs.mkdir(dirname(dst), { recursive: true })
  await fs.symlink(expectedTarget, dst)
}

export async function seedProductAgentFiles(
  workspacePath: string,
  productRelPath: string,
): Promise<SeedAgentFilesResult> {
  const productAbs = join(workspacePath, productRelPath)
  // 产物目录应已由调用方创建（scaffoldFiles 写过 index.html）；这里再保险一次。
  await fs.mkdir(productAbs, { recursive: true })

  const result: SeedAgentFilesResult = { copied: 0, sourcedFrom: [] }
  for (const rel of SEED_DIRS) {
    const src = join(workspacePath, rel)
    if (!(await dirHasContent(src))) continue
    const dst = join(productAbs, rel)
    if (await pathExists(dst)) continue
    const count = await copyTree(src, dst)
    if (count > 0) {
      result.copied += count
      result.sourcedFrom.push(rel)
    }
  }
  for (const rel of SEED_FILES) {
    const count = await copyFileIfPresent(join(workspacePath, rel), join(productAbs, rel))
    if (count > 0) {
      result.copied += count
      result.sourcedFrom.push(rel)
    }
  }
  for (const rel of SEED_OPTIONAL_DIRS) {
    const src = join(workspacePath, rel)
    if (!(await dirHasContent(src))) continue
    const dst = join(productAbs, rel)
    if (await pathExists(dst)) continue
    const count = await copyTree(src, dst)
    if (count > 0) {
      result.copied += count
      result.sourcedFrom.push(rel)
    }
  }
  for (const rel of SEED_SYMLINK_DIRS) {
    await ensureSymlinkDir(workspacePath, productRelPath, rel)
  }
  return result
}
