import { spawn as ptySpawn, type IPty } from 'node-pty'
import { spawnSync } from 'node:child_process'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolveCliSync } from '../system/cli-resolver'
import { findCommandSync } from '../system/find-command'
import { ensureNodePtySpawnHelpersExecutable } from './node-pty-helper'

function diagnoseSpawn(
  label: string, command: string, args: string[], cwd: string, env: Record<string, string>
): string {
  try {
    const r = spawnSync(command, args, { cwd, env, timeout: 1500, encoding: 'utf-8' })
    if (r.error) {
      const code = (r.error as NodeJS.ErrnoException).code ?? ''
      return `${label}：${code} ${r.error.message}`
    }
    return `${label}：exit ${r.status} (stderr: ${(r.stderr ?? '').slice(0, 200)})`
  } catch (e) {
    return `${label}异常：${e instanceof Error ? e.message : String(e)}`
  }
}

// node-pty 的 posix_spawnp 失败信息无 errno；用 child_process.spawnSync 重跑一次
// 拿到 spawn errno（ENOENT / EACCES / ENOEXEC 等），方便定位。
function diagnoseCommandSpawnFailure(
  command: string, args: string[], cwd: string, env: Record<string, string>
): string {
  return diagnoseSpawn('child_process.spawn 探测', command, [...args, '--version'], cwd, env)
}

function diagnoseUserShellStartup(shell: string, cwd: string, env: Record<string, string>): string {
  return diagnoseSpawn('用户 shell 探测', shell, ['-ilc', 'echo ok'], cwd, env)
}

// 读 script 文件第一行的 shebang，返回解释器名（不含路径）。
// `#!/usr/bin/env node` → 'node'；`#!/usr/bin/env -S node --foo` → 'node'；
// `#!/usr/bin/node` → 'node'；非脚本 / 读失败 → null。
function readShebangInterpreter(filePath: string): string | null {
  try {
    const buf = readFileSync(filePath, { encoding: 'utf-8' }).slice(0, 256)
    if (!buf.startsWith('#!')) return null
    const firstLine = buf.split('\n')[0].slice(2).trim()
    // /usr/bin/env [-S] <interp> [args]
    const envMatch = firstLine.match(/^\/usr\/bin\/env(?:\s+-S)?\s+(\S+)/)
    if (envMatch) return envMatch[1]
    // 直接路径，如 /usr/bin/node
    const direct = firstLine.split(/\s+/)[0]
    return direct.split('/').pop() ?? null
  } catch {
    return null
  }
}

type Session = {
  ttyId: string
  pty: IPty
  windowId: number
}

export function defaultPtyCommand(): { shell: string; args: string[]; banner: string } {
  const cli = resolveCliSync()
  if (cli.found) return { shell: cli.bin, args: cli.wrapArgs([]), banner: '' }
  const sh = process.env.SHELL ?? '/bin/zsh'
  return {
    shell: sh,
    args: [],
    banner:
      `\x1b[33m[Plant] 未检测到 ${cli.kind}，临时回退到系统 shell。\r\n` +
      `安装并认证所选 CLI 后重启 App，或在设置中使用内置 DeepSeek Harness。\x1b[0m\r\n`
  }
}

// 统一的 claude 参数包装入口。terminal.ts 在拼 --add-dir 类默认参数时调用这个，
// 经由 cli-resolver 保持与 spawn 链路一致的包装规则。
export function wrapClaudeArgs(claudeArgs: string[]): string[] {
  return resolveCliSync().wrapArgs(claudeArgs)
}

const sessions = new Map<string, Session>()

export type CreateOptions = {
  shell?: string
  args?: string[]
  defaultArgs?: string[]
  cwd?: string
  cols?: number
  rows?: number
  env?: Record<string, string>
  ownerWindowId: number
}

// Electron 主进程的 process.env 含一堆 macOS / dyld 沙盒/插桩相关变量，
// 直接传给 node-pty 的 posix_spawnp 偶发 EPERM / EACCES（表象就是 posix_spawnp failed）。
// 过滤掉这些不该泄漏给子 shell 的变量；保留 PATH / HOME / SHELL / LANG / TERM 等。
const ENV_KEY_DENY_PATTERN = /^(DYLD_|__CF|__XPC_|ELECTRON_|NODE_OPTIONS$|VSCODE_|GIT_ASKPASS)/i
function sanitizeEnv(input: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== 'string') continue
    if (ENV_KEY_DENY_PATTERN.test(k)) continue
    out[k] = v
  }
  // 保证 TERM 存在，xterm 端兜底
  if (!out.TERM) out.TERM = 'xterm-256color'
  return out
}

export function createTty(opts: CreateOptions): string {
  const ttyId = randomUUID()
  // shell 没指定时走默认（优先 claude，回退到系统 shell）
  const fallback = defaultPtyCommand()
  const shell = opts.shell ?? fallback.shell
  const args = opts.args ?? (!opts.shell && !fallback.banner ? (opts.defaultArgs ?? fallback.args) : fallback.args)
  const cwd = opts.cwd ?? process.env.HOME ?? '/'
  const env = sanitizeEnv((opts.env ?? process.env) as Record<string, string | undefined>)

  let pty: IPty
  try {
    ensureNodePtySpawnHelpersExecutable()
    pty = ptySpawn(shell, args, {
      name: 'xterm-256color',
      cwd,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 30,
      env
    })
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    // 直 exec 失败时不强求识别 shebang（npm/bun 装的 claude 可能是 JS wrapper，
    // 或 SEA 二进制，shebang 形式各异）。直接交给用户 login shell 兜底：
    // `$SHELL -ilc 'exec <shell> <args>'` 会加载完整 .zshrc 的 PATH，能跨过
    // execve 在子进程里再找 node/bun 等解释器的问题。
    const fileExists = existsSync(shell)
    const userShell = process.env.SHELL ?? '/bin/zsh'
    if (fileExists && userShell !== shell) {
      try {
        const quoted = [shell, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')
        pty = ptySpawn(userShell, ['-ilc', `exec ${quoted}`], {
          name: 'xterm-256color',
          cwd,
          cols: opts.cols ?? 80,
          rows: opts.rows ?? 30,
          env
        })
      } catch (e2) {
        const reason2 = e2 instanceof Error ? e2.message : String(e2)
        const interpreter = readShebangInterpreter(shell)
        const interpExists = interpreter ? !!findCommandSync(interpreter) : null
        // 用 child_process.spawnSync 探一次拿真实 errno
        const diagOriginal = diagnoseCommandSpawnFailure(shell, args, cwd, env)
        const diagFallback = diagnoseUserShellStartup(userShell, cwd, env)
        throw new Error(
          `无法启动 ${shell}（cwd=${cwd}）：${reason}；通过 ${userShell} -ilc 兜底也失败：${reason2}。`
          + (interpreter ? ` 脚本解释器 \`${interpreter}\` ${interpExists ? '已就绪' : 'PATH 找不到'}。` : '')
          + ` 诊断：${diagOriginal}；shell 诊断：${diagFallback}。`
        )
      }
    } else {
      const stat = fileExists ? statSync(shell, { throwIfNoEntry: false }) : null
      const interpreter = fileExists ? readShebangInterpreter(shell) : null
      throw new Error(
        `无法启动 ${shell}（cwd=${cwd}）：${reason}。`
        + ` 文件 ${stat ? `存在（mode=${stat.mode.toString(8)}）` : '不存在'}`
        + (interpreter ? `；脚本声明的解释器 \`${interpreter}\`` : '')
        + `；PATH=${env.PATH ?? '(empty)'}`
      )
    }
  }

  // 若回退到系统 shell，先打个提示横幅
  if (!opts.shell && fallback.banner) {
    setTimeout(() => {
      const win = BrowserWindow.fromId(opts.ownerWindowId)
      win?.webContents.send(`pty.data:${ttyId}`, fallback.banner)
    }, 100)
  }

  pty.onData((data) => {
    const win = BrowserWindow.fromId(opts.ownerWindowId)
    win?.webContents.send(`pty.data:${ttyId}`, data)
  })

  pty.onExit(({ exitCode, signal }) => {
    const win = BrowserWindow.fromId(opts.ownerWindowId)
    win?.webContents.send(`pty.exit:${ttyId}`, { exitCode, signal })
    sessions.delete(ttyId)
  })

  sessions.set(ttyId, { ttyId, pty, windowId: opts.ownerWindowId })
  return ttyId
}

export function writeTty(ttyId: string, data: string): void {
  sessions.get(ttyId)?.pty.write(data)
}

export function resizeTty(ttyId: string, cols: number, rows: number): void {
  sessions.get(ttyId)?.pty.resize(cols, rows)
}

export function killTty(ttyId: string): void {
  const s = sessions.get(ttyId)
  if (!s) return
  try {
    s.pty.kill()
  } catch {
    // ignore: pty already exited
  }
  sessions.delete(ttyId)
}

export function killAllTtys(): void {
  for (const s of sessions.values()) {
    try {
      s.pty.kill()
    } catch {
      // ignore
    }
  }
  sessions.clear()
}

export function ttySize(): number {
  return sessions.size
}
