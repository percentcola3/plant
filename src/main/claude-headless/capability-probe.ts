// 启动时一次性探测 claude CLI 的能力 + 登录态，结果进程内缓存。
// claude 二进制位置在 App 生命周期内通常不变，缓存命中后零成本；用户装/卸
// claude 或改登录态后重启 App 即可刷新。
//
// 用途：
//   - partialMessages / addDir 决定 spawn 时是否加这些 flag（老版本加了会 exit 1 崩）
//   - authStatus 让 UI 能在 spawn 前提示用户登录，而不是跑起来才发现
//
// 对标 open-design detection.ts:probe + probeCapabilities，裁剪到 claude 单 agent。
// open-design 并发探测是因为它有 19 个 agent，我们只有一个，help + auth 并行够快（<2s）。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveCli, resolveCliSync } from '../system/cli-resolver'

const execFileAsync = promisify(execFile)

const PROBE_TIMEOUT_MS = 5000

export type ClaudeAuthStatus = 'ok' | 'missing' | 'unknown'

export type ClaudeCapabilities = {
  binPath: string | null
  version: string | null
  // 新版 claude（≥1.0.86）才支持 --include-partial-messages，开启后文本可逐 token 流式。
  // 老版本加这个 flag 会 "unknown option" exit 1，所以必须探测后才能决定是否传。
  partialMessages: boolean
  // --add-dir：允许把额外目录加进 claude 的可访问范围。老/fork 版本可能没有。
  addDir: boolean
  // --append-system-prompt：往系统提示追加 app 级指令（如"问就停"）。老版本可能没有。
  appendSystemPrompt: boolean
  // --mcp-config：附加 app 生成的 MCP server 配置（zg 检索工具）。老版本可能没有。
  mcpConfig: boolean
  authStatus: ClaudeAuthStatus
}

let cached: ClaudeCapabilities | null = null

export async function probeClaudeCapabilities(): Promise<ClaudeCapabilities> {
  if (cached) return cached

  const cli = await resolveCli()
  if (!cli.found) {
    cached = {
      binPath: null,
      version: null,
      partialMessages: false,
      addDir: false,
      appendSystemPrompt: false,
      mcpConfig: false,
      authStatus: 'unknown'
    }
    return cached
  }

  // dcc 时所有探测参数也得透传：dcc -- -p --help / dcc -- auth status / dcc -- --version
  const wrap = cli.wrapArgs

  // help + auth 并行（version 串行在后面，因为不重要且可能慢）
  // 失败一律降级到保守值（false / unknown），不阻塞 spawn。
  const [helpResult, authResult, versionResult] = await Promise.all([
    execFileAsync(cli.bin, wrap(['-p', '--help']), { timeout: PROBE_TIMEOUT_MS })
      .then((r) => r.stdout)
      .catch(() => ''),
    execFileAsync(cli.bin, wrap(['auth', 'status']), { timeout: PROBE_TIMEOUT_MS })
      .then((r) => `${r.stdout}\n${r.stderr}`)
      .catch((err) => {
        // auth status 子命令不存在或 claude 未登录都会 reject，stderr 有信息
        const stderr = err instanceof Error ? err.message : String(err)
        return stderr
      }),
    execFileAsync(cli.bin, wrap(['--version']), { timeout: PROBE_TIMEOUT_MS })
      .then((r) => r.stdout.trim().split('\n')[0] ?? null)
      .catch(() => null)
  ])

  cached = {
    binPath: cli.bin,
    version: versionResult,
    partialMessages: helpResult.includes('--include-partial-messages'),
    addDir: helpResult.includes('--add-dir'),
    appendSystemPrompt: helpResult.includes('--append-system-prompt'),
    mcpConfig: helpResult.includes('--mcp-config'),
    authStatus: classifyAuthStatus(authResult)
  }
  return cached
}

// 同步获取已缓存的 capability。未探测过时返回保守默认值（不阻塞）。
// spawn-turn 是同步链路，用这个避免把 spawn 改成 async。
export function getClaudeCapabilitiesSync(): ClaudeCapabilities {
  if (cached) return cached
  const cli = resolveCliSync()
  return {
    binPath: cli.found ? cli.bin : null,
    version: null,
    partialMessages: false,
    addDir: false,
    appendSystemPrompt: false,
    mcpConfig: false,
    authStatus: 'unknown'
  }
}

function classifyAuthStatus(text: string): ClaudeAuthStatus {
  // missing 优先检查：'not logged in' 含 'logged in' 子串，若先查 ok 会误判。
  // 'sign in' / 'login' 也是未登录的常见提示词。
  if (/\b(not logged in|not authenticated|invalid|expired|sign in|log in)\b/i.test(text)) return 'missing'
  if (/\b(logged in|authenticated|valid|active)\b/i.test(text)) return 'ok'
  return 'unknown'
}

// 清空缓存。生产路径：用户在设置里切了 cliKind（claude ↔ dcc），需要重探一次新二进制的能力。
export function resetClaudeCapabilitiesCache(): void {
  cached = null
}

// 测试用别名（保留旧名避免破坏现有 import）
export const resetClaudeCapabilitiesCacheForTests = resetClaudeCapabilitiesCache

// 测试用：直接注入缓存值（绕过真实探测）
export function setClaudeCapabilitiesCacheForTests(caps: ClaudeCapabilities): void {
  cached = caps
}
