import { simpleGit, type SimpleGit } from 'simple-git'
import { app } from 'electron'
import { join } from 'node:path'
import { askpassServer, askpassEnv, askpassCachedHelperPath } from '../http/askpass-server'
import { appSshEnv, requireSshKeyForRemote, sshAuthorizationError } from '../system/ssh'
import { resolveGitBinary, resolveGitEnv } from './binary'

// 极薄封装，统一注入 GIT_ASKPASS 环境变量。

function helperPath(): string {
  return join(app.getPath('userData'), 'askpass-helper.sh')
}

// simple-git 出于安全考虑会拒绝 env 带 EDITOR / GIT_EDITOR / VISUAL（避免被劫持
// 在 commit 等流程里执行任意编辑器），UNSAFE_OPTS 里也不放行。所有进入 simple-git 的 env
// 必须经过这里清洗，否则任何只要用户 shell 设过 EDITOR 的环境，simple-git 命令一律抛
// "Use of EDITOR is not permitted without enabling allowUnsafeEditor"。
function sanitizedProcessEnv(): NodeJS.ProcessEnv {
  const safe = { ...process.env }
  delete safe.EDITOR
  delete safe.GIT_EDITOR
  delete safe.VISUAL
  return safe
}

async function gitEnv(): Promise<NodeJS.ProcessEnv> {
  const { url, token } = await askpassServer.start()
  return {
    ...sanitizedProcessEnv(),
    ...resolveGitEnv(),                          // bundled 时注入 GIT_EXEC_PATH 等；fallback 系统 git 时为空
    ...appSshEnv(),
    ...askpassEnv(url, token),
    GIT_ASKPASS: helperPath(),
    SSH_ASKPASS: helperPath(),
    SSH_ASKPASS_REQUIRE: 'force'
  }
}

export type CloneOptions = {
  url: string
  dest: string
  onProgress?: (percent: number, stage: string) => void
}

// simple-git 默认把 GIT_ASKPASS / SSH_ASKPASS 等列为"potentially unsafe env"，
// 我们的 askpass 脚本是 App 自己写的、走 localhost+token，可信，显式开启允许。
// 来源：node_modules/@simple-git/argv-parser/dist/index.mjs 的 env 漏洞表
// （git_askpass / ssh_askpass → allowUnsafeAskPass）
const UNSAFE_OPTS = {
  unsafe: {
    allowUnsafeAskPass: true,         // GIT_ASKPASS / SSH_ASKPASS
    allowUnsafeSshCommand: true,      // App 专用 SSH key 通过 GIT_SSH_COMMAND 注入
    // bundled git 的 env 全部要放行：
    // - GIT_EXEC_PATH / GIT_CONFIG_SYSTEM / PREFIX → allowUnsafeConfigPaths
    // - GIT_TEMPLATE_DIR                          → allowUnsafeTemplateDir
    allowUnsafeConfigPaths: true,
    allowUnsafeTemplateDir: true,
    // dugite git binary 的绝对路径包含 "app.asar.unpacked"、用户名、安装目录等。
    // simple-git 的 isBadArgument 正则（/^([a-z]:)?([a-z0-9/.\\_~-]+)$/i）只放行
    // 字母/数字/_/-/./~/ 这几类字符，App 装在含空格、括号、中文的目录下就会挂。
    // binary 是 App 自己 resolve 的固定路径，不来自用户输入，不存在注入风险。
    allowUnsafeCustomBinary: true
  }
} as const

// simple-git 默认调用 `git` 走 $PATH。我们把它固定到内置的 dugite git，
// 既能让没装系统 git 的用户开箱即用，又避免不同 git 版本带来的行为漂移。
function gitBinaryOption(): { binary?: string } {
  const path = resolveGitBinary()
  return path ? { binary: path } : {}
}

export async function clone(opts: CloneOptions): Promise<void> {
  const sshRemote = await requireSshKeyForRemote(opts.url)
  const env = await gitEnv()
  const sg: SimpleGit = simpleGit({
    ...UNSAFE_OPTS,
    ...gitBinaryOption(),
    progress: ({ method, stage, progress }) => {
      opts.onProgress?.(progress, `${method}: ${stage}`)
    }
  }).env(env)
  try {
    await sg.clone(opts.url, opts.dest)
  } catch (error) {
    const sshError = sshAuthorizationError(error, sshRemote)
    if (sshError) throw sshError
    throw error
  }
}

export function gitFor(cwd: string): SimpleGit {
  // bundled git 必须带 GIT_EXEC_PATH / GIT_TEMPLATE_DIR 等，否则连本地 init/status 都报
  // "templates not found" / "git-remote-https not found"。这里一并注入。
  // 即便 bundledEnv 为空也要 sg.env(sanitized)，否则 simple-git 继承 process.env 时会
  // 因为 EDITOR / GIT_EDITOR / VISUAL 拒绝执行（参见 sanitizedProcessEnv 注释）。
  const sg = simpleGit({ baseDir: cwd, ...UNSAFE_OPTS, ...gitBinaryOption() })
  sg.env({ ...sanitizedProcessEnv(), ...resolveGitEnv(), ...appSshEnv() })
  return sg
}

export async function gitForWithAskpass(cwd: string): Promise<SimpleGit> {
  const env = await gitEnv()
  return simpleGit({ baseDir: cwd, ...UNSAFE_OPTS, ...gitBinaryOption() }).env(env)
}

// 后台 git：用于 auto-refresh / hydrate 等"用户没主动点"的路径。
// 跟 gitForWithAskpass 共享 askpass-server，但 GIT_ASKPASS 指向 cache-only helper：
// - 缓存命中（用户之前输过 PAT 并勾"记住"）→ 直接复用，命令成功
// - 缓存未命中 → askpass-server 返 499 → curl -f 退出非 0 → git 静默 abort
// 永远不会弹 PATPromptDialog。
export async function gitForBackground(cwd: string, timeoutMs?: number): Promise<SimpleGit> {
  const { url, token } = await askpassServer.start()
  const cached = askpassCachedHelperPath()
  const env: NodeJS.ProcessEnv = {
    ...sanitizedProcessEnv(),
    ...resolveGitEnv(),
    ...appSshEnv(),
    ...askpassEnv(url, token),
    GIT_ASKPASS: cached,
    SSH_ASKPASS: cached
  }
  return simpleGit({ baseDir: cwd, ...UNSAFE_OPTS, ...gitBinaryOption(), ...(timeoutMs ? { timeout: { block: timeoutMs } } : {}) }).env(env)
}

export type PullResult =
  | { ok: true; ahead: number; behind: number }
  | { ok: false; code: 'CONFLICT' | 'UNCOMMITTED' | 'AUTH' | 'NETWORK' | 'OTHER'; message: string }

export async function pullRebase(cwd: string): Promise<PullResult> {
  const sg = await gitForWithAskpass(cwd)
  try {
    await sg.pull(['--rebase'])
    const status = await sg.status()
    return { ok: true, ahead: status.ahead ?? 0, behind: status.behind ?? 0 }
  } catch (e) {
    return classifyError(e, 'pull')
  }
}

export type PushResult =
  | { ok: true }
  | { ok: false; code: 'NON_FAST_FORWARD' | 'AUTH' | 'NETWORK' | 'OTHER'; message: string }

export async function push(cwd: string, branch: string): Promise<PushResult> {
  const { runPushOp } = await import('./ops/push')
  const outcome = await runPushOp(cwd, branch, { branch })
  if (outcome.ok) return { ok: true }
  const failure = outcome.failure
  if (failure.kind === 'NON_FAST_FORWARD') return { ok: false, code: 'NON_FAST_FORWARD', message: failure.kind }
  if (failure.kind === 'AUTH') return { ok: false, code: 'AUTH', message: failure.kind }
  if (failure.kind === 'NETWORK') return { ok: false, code: 'NETWORK', message: failure.detail }
  const message = failure.kind === 'UNKNOWN' ? failure.raw : failure.kind
  return { ok: false, code: 'OTHER', message }
}

function classifyError(e: unknown, _kind: 'pull'): PullResult {
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (lower.includes('conflict') || lower.includes('merge conflict')) {
    return { ok: false, code: 'CONFLICT', message: msg }
  }
  if (lower.includes('please commit your changes') || lower.includes('uncommitted changes')) {
    return { ok: false, code: 'UNCOMMITTED', message: msg }
  }
  if (lower.includes('authentication') || lower.includes('could not read username') || lower.includes('403')) {
    return { ok: false, code: 'AUTH', message: msg }
  }
  if (lower.includes('could not resolve host') || lower.includes('connect') || lower.includes('timed out')) {
    return { ok: false, code: 'NETWORK', message: msg }
  }
  return { ok: false, code: 'OTHER', message: msg }
}

