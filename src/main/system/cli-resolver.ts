// CLI 解析收敛层：定位 claude 可执行文件并暴露统一的参数包装。
//
// 所有 spawn claude 的地方都过这一层，避免各调用点自行查找二进制。
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
  // 透传给底层 claude 的参数包装（当前为恒等）。
  wrapArgs: (claudeArgs: string[]) => string[]
}

// 进程内缓存：CLI 二进制位置在 App 生命周期内通常不变。用户装/卸 CLI 后重启即可。
const binCache = new Map<CliKind, string | null>()

function makeResolved(kind: CliKind, found: string | null): ResolvedCli {
  return {
    kind,
    bin: found ?? kind,
    found: !!found,
    wrapArgs: (a) => a
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
