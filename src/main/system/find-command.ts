// 在用户机上定位命令绝对路径的共享工具。
//
// 三级兜底，按 fast → slow 顺序：
//   1. process.env.PATH 各目录直接 existsSync 拼路径
//   2. 常见 GUI 启动场景下 PATH 不完整，扫几个常见目录（/usr/local/bin, /opt/homebrew/bin, /usr/bin）
//   3. 最后才 spawn shell，且只用 `sh -c command -v`（不要 -lic / -i —— 启动完整 shell 慢且
//      触发用户 .zshrc 副作用）
//
// 同步 / 异步两个变体共用同一套策略。spawn-turn 里 turn 起步是同步链路，需要 sync 版本；
// IPC handler 那种异步上下文用 async 版本（execFile 不阻塞主线程）。
//
// **不在这里加缓存**：调用方按需缓存（比如 claude-binary.ts 缓存 claude 二进制的位置；
// setup.ts 的 IPC 不缓存，每次都重新探测，因为安装/卸载状态会变）。
import { homedir } from 'node:os'
import { delimiter } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const COMMON_BIN_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', ...['.npm-global/bin', '.local/bin', '.bun/bin', '.opencode/bin'].map(dir => `${homedir()}/${dir}`)]
const SHELL_PROBE_TIMEOUT_MS = 1500

function pathDirs(): string[] {
  return (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean)
}

function checkDirs(cmd: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const full = `${dir}/${cmd}`
    if (existsSync(full)) return full
  }
  return null
}

function shell(): string {
  return process.env.SHELL ?? '/bin/zsh'
}

export function findCommandSync(cmd: string): string | null {
  const fromPath = checkDirs(cmd, pathDirs())
  if (fromPath) return fromPath
  const fromCommon = checkDirs(cmd, COMMON_BIN_PATHS)
  if (fromCommon) return fromCommon
  try {
    const out = execFileSync(shell(), ['-c', `command -v ${cmd}`], {
      encoding: 'utf-8',
      timeout: SHELL_PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return out || null
  } catch {
    return null
  }
}

export async function findCommandAsync(cmd: string): Promise<string | null> {
  const fromPath = checkDirs(cmd, pathDirs())
  if (fromPath) return fromPath
  const fromCommon = checkDirs(cmd, COMMON_BIN_PATHS)
  if (fromCommon) return fromCommon
  try {
    const { stdout } = await execFileAsync(shell(), ['-c', `command -v ${cmd}`], {
      encoding: 'utf-8',
      timeout: SHELL_PROBE_TIMEOUT_MS
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}
