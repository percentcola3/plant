import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

// GUI 启动 Electron 时 process.env.PATH 通常只有 /usr/bin:/bin:/usr/sbin:/sbin —
// 不含 brew、npm-global、nvm、bun、cargo 等用户安装的目录。
// 后果：spawn('claude', ...) 找不到，pty 里 `env node` 也 ENOENT，shebang 全挂。
//
// 这里在 main 启动早期就把用户的 PATH 注入到 process.env.PATH，所有后续 spawn / pty
// `{ ...process.env }` 自动受益。两步：
//   1. hydrateProcessPathSync()        — 瞬间加几个固定常见目录，覆盖 90%+ 用户
//   2. hydrateProcessPathFromShell()   — 异步用 user shell 拉完整 PATH，覆盖 nvm 等

const COMMON_USER_PATHS = [
  '/opt/homebrew/bin',                   // Apple Silicon homebrew
  '/opt/homebrew/sbin',
  '/usr/local/bin',                      // Intel mac homebrew
  '/usr/local/sbin',
  `${homedir()}/.npm-global/bin`,        // npm config prefix=~/.npm-global
  `${homedir()}/.bun/bin`,
  `${homedir()}/.deno/bin`,
  `${homedir()}/.cargo/bin`,
  `${homedir()}/.local/bin`
]

export function hydrateProcessPathSync(): void {
  const existing = (process.env.PATH ?? '').split(':').filter(Boolean)
  const set = new Set(existing)
  const additions = COMMON_USER_PATHS.filter((p) => existsSync(p) && !set.has(p))
  if (!additions.length) return
  process.env.PATH = [...additions, ...existing].join(':')
}

const execFileAsync = promisify(execFile)

// 用 $SHELL -ilc 启动 login + interactive shell 让 .zshrc / .bashrc 跑一遍，
// 再把它的 PATH 拉出来合并。涵盖 nvm 这种动态版本目录、用户自定义 alias 设的 PATH。
export async function hydrateProcessPathFromShell(): Promise<void> {
  const shell = process.env.SHELL ?? '/bin/zsh'
  try {
    const { stdout } = await execFileAsync(shell, ['-ilc', 'printf %s "$PATH"'], {
      timeout: 3000,
      encoding: 'utf-8'
    })
    if (!stdout) return
    const fromShell = stdout.split(':').filter(Boolean)
    const existing = (process.env.PATH ?? '').split(':').filter(Boolean)
    const set = new Set(existing)
    const additions = fromShell.filter((p) => !set.has(p))
    if (!additions.length) return
    // shell 拉的 PATH 拼到现有 PATH 之后；现有 PATH 里的 sync 加的常见目录优先级保留。
    process.env.PATH = [...existing, ...additions].join(':')
  } catch {
    // shell 探测失败（无 SHELL / 超时 / login script 报错）— 走 sync 加的常见目录兜底
  }
}
