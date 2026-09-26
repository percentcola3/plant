// 把"用 claude 还是 dcc"的差异收敛到一个地方。
//
// dcc 是基于 claude 封装的 CLI，所有 flag 透传都得加 '--' 分隔符：
//   claude --resume <uuid>          ↔   dcc -- --resume <uuid>
//   claude --print -p '...'         ↔   dcc -- --print -p '...'
//   claude auth status              ↔   dcc -- auth status
//
// 所有 spawn claude 的地方都过这一层，避免在 5 个调用点各自加判断、漏一个都会让 dcc
// 把 --resume 当成 dcc 自己的 flag 报错。
//
// 同步链路（spawn-turn / pty defaultPtyCommand）用 resolveCliSync；异步 IPC handler
// （capability-probe 探测 / setup checkClaude）用 async 版本，避免阻塞主线程。
import { findCommandSync, findCommandAsync } from './find-command'
import { settingsStore, type CliKind } from '../settings/store'
import { DEFAULT_CLI_KIND } from '../../shared/cli'

export type ResolvedCli = {
  kind: CliKind
  // 可执行文件路径。found=true 时是绝对路径；found=false 时退化为命令名（让 spawn 走 PATH 兜底）。
  bin: string
  found: boolean
  // 透传给底层 claude 的参数。已经按 dcc 规则处理过——dcc 时前面会有 '--'
  wrapArgs: (claudeArgs: string[]) => string[]
}

// 进程内缓存：CLI 二进制位置在 App 生命周期内通常不变。用户装/卸 CLI 或改 cliKind 后重启即可。
// key = cliKind，值 = bin 绝对路径（null = 没找到）
const binCache = new Map<CliKind, string | null>()

function makeResolved(kind: CliKind, found: string | null): ResolvedCli {
  return {
    kind,
    bin: found ?? kind,
    found: !!found,
    wrapArgs: kind === 'dcc' ? (a) => ['--', ...a] : (a) => a
  }
}

function readKind(): CliKind {
  return settingsStore.getCached()?.cliKind ?? DEFAULT_CLI_KIND
}

export function resolveCliSync(): ResolvedCli {
  const kind = readKind()
  let found = binCache.get(kind)
  if (found === undefined) {
    found = findCommandSync(kind)
    binCache.set(kind, found)
  }
  return makeResolved(kind, found)
}

export async function resolveCli(): Promise<ResolvedCli> {
  const settings = await settingsStore.get()
  const kind = settings.cliKind ?? DEFAULT_CLI_KIND
  let found = binCache.get(kind)
  if (found === undefined) {
    found = await findCommandAsync(kind)
    binCache.set(kind, found)
  }
  return makeResolved(kind, found)
}

// 测试用：清缓存（生产代码不要调用）
export function resetCliResolverCacheForTests(): void {
  binCache.clear()
}
