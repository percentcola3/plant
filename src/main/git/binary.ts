import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

// 决议 git 二进制路径 + bundled 时必需的运行时 env vars。
// 优先级：
// 1. dugite 自带的便携 git（packaged 路径会自动从 app.asar 替换为 app.asar.unpacked）
// 2. 系统 git（dev 环境兜底；用户在终端里用的还是这一份）
//
// dugite 的 postinstall 在中国大陆下载常会卡，dev 环境允许 fallback；
// packaged 构建必须保证 dugite 的 git 已下载好（CI 配代理 / 提前手动下载）。

const require = createRequire(import.meta.url)

let cachedPath: string | null | undefined
let cachedEnv: Record<string, string> | null | undefined

export function resolveGitBinary(): string | null {
  if (cachedPath !== undefined) return cachedPath
  cachedPath = locateBundled() ?? locateSystem() ?? null
  return cachedPath
}

// bundled 时返回 GIT_EXEC_PATH / GIT_TEMPLATE_DIR / GIT_CONFIG_SYSTEM 等必需 env；
// 系统 git fallback 时返回 {} —— 系统 git 自己知道 helper 和模板在哪。
// 没设这些 env 时 dugite 会找 `//share/git-core/templates`、`git-remote-https not found`
// 这种错误（compile-time 路径无效）。
export function resolveGitEnv(): Record<string, string> {
  if (cachedEnv !== undefined && cachedEnv !== null) return cachedEnv
  if (cachedEnv === null) return {}
  const bundled = locateBundled()
  if (!bundled) {
    cachedEnv = null
    return {}
  }
  const gitRoot = dirname(dirname(bundled))   // .../dugite/git
  const env: Record<string, string> = {
    GIT_EXEC_PATH: join(gitRoot, 'libexec', 'git-core'),
  }
  if (process.platform !== 'win32') {
    env.GIT_CONFIG_SYSTEM = join(gitRoot, 'etc', 'gitconfig')
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    env.GIT_TEMPLATE_DIR = join(gitRoot, 'share', 'git-core', 'templates')
  }
  if (process.platform === 'linux') {
    env.PREFIX = gitRoot
    const cabundle = join(gitRoot, 'ssl', 'cacert.pem')
    if (existsSync(cabundle)) env.GIT_SSL_CAINFO = cabundle
  }
  cachedEnv = env
  return env
}

export function isBundled(): boolean {
  const path = resolveGitBinary()
  return path !== null && path !== locateSystem()
}

export function _testOnlyResetBinaryCache(): void {
  cachedPath = undefined
  cachedEnv = undefined
}

function locateBundled(): string | null {
  let pkgPath: string
  try {
    pkgPath = require.resolve('dugite/package.json')
  } catch {
    return null
  }
  const root = dirname(pkgPath)
  const binName = process.platform === 'win32' ? 'git.exe' : 'git'
  let candidate = join(root, 'git', 'bin', binName)
  // packaged 时 dugite 的 git 二进制在 app.asar.unpacked 下；asar 路径里直接 access 文件失败
  if (candidate.includes(`${'app.asar'}/`) && !candidate.includes('app.asar.unpacked')) {
    candidate = candidate.replace(`${'app.asar'}/`, `${'app.asar.unpacked'}/`)
  }
  return existsSync(candidate) ? candidate : null
}

function locateSystem(): string | null {
  // 登录 shell 的 PATH 才含用户自装的 git；可执行程序固定为字面量 /bin/zsh
  try {
    const out = execFileSync('/bin/zsh', ['-lic', 'command -v git'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return out && existsSync(out) ? out : null
  } catch {
    return null
  }
}
