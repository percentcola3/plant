import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chrome 插件分发：app 启动时把 resources/chrome-extension/ 整目录复制到
// ~/Documents/WorkSpace 浏览器插件/。
// 选 Documents/ 而不是 userData/Library 是因为 Chrome 的"加载已解压扩展程序"目录选择器
// 默认 sidebar 里有 Documents 但没 Library；让用户两次点击就能定位。
//
// 触发时机：app 启动、且复制时跳过未变化的版本（比对 manifest.json 的 version 字段）。
// 用户在 chrome://extensions 加载后，extension 路径稳定不变，App 升级覆盖会复制新内容，
// 但用户仍需在浏览器手动点扩展卡上的"刷新"才能让新代码生效。

const EXTENSION_DIR_NAME = 'workspace-extension'

export type InstallResult = {
  installed: boolean         // 是否真的复制（false = 已是最新版，跳过）
  version: string | null      // 已就位的 manifest.version
  destDir: string             // 用户可见的绝对路径
  sourceDir: string | null    // 拷贝来源（无源时为 null）
  legacyMigrated?: boolean    // 是否清理过旧的 userData/chrome-extension/
  error?: string              // 任何环节出错记一下，但不抛
}

// 用户可见目录优先；环境变量 WORKSPACE_EXTENSION_DIR 可覆盖（测试 / 高级用户）
export function extensionDestDir(): string {
  const override = process.env.WORKSPACE_EXTENSION_DIR
  if (override) return override
  return join(homedir(), 'Documents', EXTENSION_DIR_NAME)
}

// app 早期版本曾把插件复制到这些位置，新版本改放 ~/Documents/workspace-extension/
// 启动迁移时如果旧目录还在就清掉，避免用户在 Chrome 里加载的是旧路径
function legacyExtensionDirs(): string[] {
  return [
    join(app.getPath('userData'), 'chrome-extension'),
    join(homedir(), 'Documents', 'WorkSpace 浏览器插件'),
    join(homedir(), 'Documents', 'WorkSpace Extension')
  ]
}

export async function ensureExtensionInstalled(): Promise<InstallResult> {
  const dest = extensionDestDir()
  const src = await resolveSourceDir()
  // 顺手清掉早期遗留的目录（用户已在 Chrome 加载过的话需要重新加载新路径，
  // 这无法避免；至少不留旧文件让用户困惑）
  let legacyMigrated = false
  for (const legacy of legacyExtensionDirs()) {
    if (legacy === dest) continue
    try {
      const stat = await fs.stat(legacy).catch(() => null)
      if (stat?.isDirectory()) {
        await fs.rm(legacy, { recursive: true, force: true }).catch(() => undefined)
        legacyMigrated = true
      }
    } catch { /* best-effort */ }
  }

  if (!src) {
    return { installed: false, version: null, destDir: dest, sourceDir: null, legacyMigrated, error: 'extension source not found in resources/' }
  }

  const srcVersion = await readManifestVersion(src)
  const destVersion = await readManifestVersion(dest)

  if (destVersion && srcVersion && destVersion === srcVersion) {
    return { installed: false, version: destVersion, destDir: dest, sourceDir: src, legacyMigrated }
  }

  try {
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.rm(dest, { recursive: true, force: true })
    await copyDir(src, dest)
    return { installed: true, version: srcVersion, destDir: dest, sourceDir: src, legacyMigrated }
  } catch (e) {
    return {
      installed: false,
      version: destVersion,
      destDir: dest,
      sourceDir: src,
      legacyMigrated,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

async function resolveSourceDir(): Promise<string | null> {
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'chrome-extension'))
  }
  const here = dirname(fileURLToPath(import.meta.url))
  candidates.push(join(process.cwd(), 'resources', 'chrome-extension'))
  candidates.push(join(here, '..', '..', '..', 'resources', 'chrome-extension'))
  candidates.push(join(here, '..', '..', 'resources', 'chrome-extension'))
  for (const c of candidates) {
    try {
      const stat = await fs.stat(c)
      if (stat.isDirectory()) return c
    } catch { /* try next */ }
  }
  return null
}

async function readManifestVersion(baseDir: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(join(baseDir, 'manifest.json'), 'utf-8')
    const json = JSON.parse(buf) as { version?: unknown }
    return typeof json.version === 'string' ? json.version : null
  } catch {
    return null
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath)
    }
    // symlink/socket 等其他类型忽略
  }
}
