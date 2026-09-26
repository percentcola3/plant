import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { resolveGitBinary } from '../git/binary'
import { findCommandAsync } from './find-command'
import { resolveCli } from './cli-resolver'

const execFileAsync = promisify(execFile)

export const CLAUDE_CODE_GUIDE_URL = 'https://docs.example.com/setup/cli'

// 启动检查：极简策略——只查 git binary 是否存在 + git user 是否配。
// node / npm 是 Electron 自带，不需要检测；claude-code / cursor / vscode 改成 lazy + 后台。
// 之前用 zsh -lic 跑 6 次 which，每次 100-500ms 累计 1.5-3s，全删。
export type EnvCheckResult = {
  gitBinaryReady: boolean
  gitUser: {
    name: string
    email: string
    configured: boolean
  }
  claudeGuideUrl: string
}

export type OptionalDepStatus = {
  name: 'claude-code' | 'cursor' | 'vscode'
  found: boolean
  version?: string
  guideUrl?: string
}

// 极简同步检查：不 spawn shell，只用 fs.existsSync 验证 bundled git
function checkGitBinary(): boolean {
  const path = resolveGitBinary()
  return !!path && existsSync(path)
}

// gitUser 配置走 bundled git 直接 spawn（不经 -lic shell）。失败兜底空字符串。
async function readGlobalGitConfig(key: string): Promise<string> {
  try {
    const git = resolveGitBinary()
    if (!git) return ''
    const { stdout } = await execFileAsync(git, ['config', '--global', '--get', key], {
      encoding: 'utf-8',
      timeout: 2000
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function checkGitUser(): Promise<EnvCheckResult['gitUser']> {
  const [name, email] = await Promise.all([
    readGlobalGitConfig('user.name'),
    readGlobalGitConfig('user.email')
  ])
  return {
    name,
    email,
    configured: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }
}

export async function checkEnvironment(): Promise<EnvCheckResult> {
  const [gitUser, gitBinaryReady] = await Promise.all([
    checkGitUser(),
    Promise.resolve(checkGitBinary())
  ])
  return {
    gitBinaryReady,
    gitUser,
    claudeGuideUrl: CLAUDE_CODE_GUIDE_URL
  }
}

// ========================================================================================
// Lazy / 后台检查：不在启动 splash 跑。打开对应面板时按需调，结果由 renderer 缓存。
// ========================================================================================

// findCommand 已抽到 system/find-command.ts 共享：claude-binary（同步版本）和这里
// （异步版本）共用同一套三级兜底（PATH → 常见目录 → sh -c），不再走 -lic 完整 shell。
const findCommand = findCommandAsync

async function getVersion(cmd: string, args: string[] = ['--version']): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding: 'utf-8', timeout: 2000 })
    return stdout.split('\n')[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

// 当前选中的 CLI 检测（claude 或 dcc）：打开 AI 面板时调，没装就 toast + guideUrl。
// dcc 时探测命令也得透传：dcc -- --version。
export async function checkClaude(): Promise<OptionalDepStatus> {
  const cli = await resolveCli()
  if (!cli.found) {
    return { name: 'claude-code', found: false, guideUrl: CLAUDE_CODE_GUIDE_URL }
  }
  const version = await getVersion(cli.bin, cli.wrapArgs(['--version']))
  return { name: 'claude-code', found: true, version }
}

// IDE 检测：启动后异步后台调，结果给 project-tool-menu 用
export async function checkCursor(): Promise<OptionalDepStatus> {
  const cmdPath = await findCommand('cursor')
  if (cmdPath) {
    const version = await getVersion(cmdPath, ['--version'])
    return { name: 'cursor', found: true, version }
  }
  if (process.platform === 'darwin' && existsSync('/Applications/Cursor.app')) {
    return { name: 'cursor', found: true, version: 'via .app' }
  }
  return { name: 'cursor', found: false }
}

export async function checkVSCode(): Promise<OptionalDepStatus> {
  const cmdPath = await findCommand('code')
  if (cmdPath) {
    const version = await getVersion(cmdPath, ['--version'])
    return { name: 'vscode', found: true, version }
  }
  if (process.platform === 'darwin' && existsSync('/Applications/Visual Studio Code.app')) {
    return { name: 'vscode', found: true, version: 'via .app' }
  }
  return { name: 'vscode', found: false }
}
