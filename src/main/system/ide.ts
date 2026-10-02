import { clipboard } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve, join } from 'node:path'
import { UIClientError } from '../ipc/errors'

export type IdeKind = 'cursor' | 'code' | 'none'
export type ProjectToolKind = 'finder' | 'terminal' | 'codex' | 'cursor' | 'code'

type IdeInfo = { kind: IdeKind; path: string | null; useOpen: boolean }

let detected: IdeInfo | null = null

// macOS 应用路径
const MACOS_APPS = '/Applications'

// 通过登录 shell 的 PATH 查找命令行工具（适用于已启用命令行工具的情况）。
// 可执行程序固定为字面量 /bin/zsh；命令名作为 $1 传入，不拼接进命令字符串。
function which(cmd: string): string | null {
  try {
    const out = execFileSync('/bin/zsh', ['-lic', 'command -v "$1"', 'plant-which', cmd], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return out || null
  } catch {
    return null
  }
}

// 检测 .app 是否存在
function findApp(appName: string): string | null {
  if (process.platform !== 'darwin') return null
  const appPath = join(MACOS_APPS, `${appName}.app`)
  return existsSync(appPath) ? appPath : null
}

export function detectIde(): IdeInfo {
  if (detected) return detected

  // 优先 cursor → code
  // 先检测命令行工具
  const cursorCmd = which('cursor')
  if (cursorCmd) return (detected = { kind: 'cursor', path: cursorCmd, useOpen: false })

  const cursorApp = findApp('Cursor')
  if (cursorApp) return (detected = { kind: 'cursor', path: cursorApp, useOpen: true })

  const codeCmd = which('code')
  if (codeCmd) return (detected = { kind: 'code', path: codeCmd, useOpen: false })

  const codeApp = findApp('Visual Studio Code')
  if (codeApp) return (detected = { kind: 'code', path: codeApp, useOpen: true })

  return (detected = { kind: 'none', path: null, useOpen: false })
}

function openMacApp(appName: string, targetPath: string): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    const child = spawn('open', ['-a', appName, targetPath], { stdio: 'ignore' })
    child.on('error', rejectOpen)
    child.on('exit', (code) => {
      if (code === 0) resolveOpen()
      else rejectOpen(new UIClientError('OPEN_FAILED', `无法打开 ${appName}`))
    })
  })
}

async function assertPathExists(abs: string): Promise<void> {
  try {
    await exists(abs)
  } catch {
    throw new UIClientError('FILE_NOT_FOUND', `路径不存在：${abs}`)
  }
}

function resolveProjectTarget(targetPath: string, projectPath?: string): string {
  const abs = isAbsolute(targetPath) ? resolve(targetPath) : resolve(join(projectPath ?? '', targetPath))
  if (projectPath) {
    const projAbs = resolve(projectPath)
    if (!abs.startsWith(projAbs)) {
      throw new UIClientError('PATH_OUTSIDE_PROJECT', `路径越界：${targetPath}`)
    }
  }
  return abs
}

export async function openInIde(targetPath: string, projectPath?: string): Promise<{ kind: IdeKind }> {
  const ide = detectIde()
  if (ide.kind === 'none' || !ide.path) {
    throw new UIClientError(
      'NO_IDE',
      '未检测到 VSCode 或 Cursor。请安装其中之一。'
    )
  }
  const abs = resolveProjectTarget(targetPath, projectPath)
  await assertPathExists(abs)

  // macOS .app 方式：用 open 命令
  if (ide.useOpen) {
    await openMacApp(ide.path, abs)
    return { kind: ide.kind }
  }

  // 命令行工具方式：直接 spawn
  const child = spawn(ide.path, [abs], { detached: true, stdio: 'ignore' })
  child.unref()
  return { kind: ide.kind }
}

export async function openProjectTool(
  kind: ProjectToolKind,
  projectPath: string,
  relativePath?: string
): Promise<{ kind: ProjectToolKind; message?: string; copiedPath?: boolean }> {
  // relativePath 给「卡片级打开」用：打开 projectPath/<relativePath> 子目录；
  // 传 projectPath 作第二参，resolveProjectTarget 会做越界校验。
  const abs = resolveProjectTarget(relativePath ? join(projectPath, relativePath) : projectPath, projectPath)
  await assertPathExists(abs)

  if (kind === 'terminal') {
    await openMacApp('Terminal', abs)
    return { kind }
  }

  if (kind === 'cursor') {
    const cursorCmd = which('cursor')
    if (cursorCmd) {
      const child = spawn(cursorCmd, [abs], { detached: true, stdio: 'ignore' })
      child.unref()
      return { kind }
    }
    await openMacApp('Cursor', abs)
    return { kind }
  }

  if (kind === 'code') {
    const codeCmd = which('code')
    if (codeCmd) {
      const child = spawn(codeCmd, [abs], { detached: true, stdio: 'ignore' })
      child.unref()
      return { kind }
    }
    await openMacApp('Visual Studio Code', abs)
    return { kind }
  }

  if (kind === 'codex') {
    clipboard.writeText(abs)
    return {
      kind,
      copiedPath: true,
      message: `Codex App 不能从外部直接打开项目。已复制项目路径：${abs}。请在 Codex App 中新建或导入工作区时粘贴该路径。`
    }
  }

  return { kind }
}

// fs.access 的 Promise 版本
async function exists(path: string): Promise<void> {
  const { access } = await import('node:fs/promises')
  return access(path)
}
