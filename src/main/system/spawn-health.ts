// child_process.spawn 的 EBADF 自检与自愈。
//
// 线上 observed：主进程所有 spawn 同步抛 `spawn EBADF`（AI 面板 claude.submit
// 直接失败），dev 实例（启动终端后来被关闭）与打包版 GUI 启动都出现过。
// EBADF 说明 posix_spawn 使用了无效 fd；现有日志还不能确认是 0/1/2 缺失、
// pipe/detached 组合，还是运行期 fd 关闭竞争。这里做四件事：
//   1. repairMissingStdioFds：把失效的 0/1/2 重绑到 /dev/null（打开文件会占用
//      编号最小的空闲 fd，依次补 0→1→2 即可归位）
//   2. captureSpawnDiagnostics：记录 fd 数量、类型采样和标准流状态，不记录路径
//   3. probeSpawnVariants：用不同 stdio / detached / cwd 组合定位故障层
//   4. ensureSpawnHealth：启动时探测 + 修复，仍失败则把 fd 表信息写入诊断日志，
//      下一次导出的诊断包里就有定位根因需要的全部数据
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { accessSync, closeSync, constants, fstatSync, openSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { diagnostics } from '../diagnostics/runtime'

const FD_SAMPLE_LIMIT = 256
let fdBaselineCount = -1
let fdHighWater = -1
let epipeCount = 0
let lastEpipeAt = 0

type FdKind = 'file' | 'directory' | 'socket' | 'fifo' | 'character' | 'block' | 'other'

export type SpawnDiagnosticsSnapshot = {
  fdCount: number
  fdScanCode: string
  fdMax: number
  fdNext: number
  fdNextCode: string
  fdBaselineCount: number
  fdDeltaFromBaseline: number
  fdHighWater: number
  fdSampledCount: number
  fdScanTruncated: boolean
  fdInvalidCount: number
  fdFileCount: number
  fdDirectoryCount: number
  fdSocketCount: number
  fdFifoCount: number
  fdCharacterCount: number
  fdBlockCount: number
  fdOtherCount: number
  stdinFdState: string
  stdoutFdState: string
  stderrFdState: string
  stdinStreamState: string
  stdoutStreamState: string
  stderrStreamState: string
  activeResources: string
  epipeCount: number
  lastEpipeAgoMs: number
}

export type SpawnProbeMatrix = {
  probePipeDetached: string
  probePipeAttached: string
  probeIgnoreDetached: string
  probePipeDetachedCwd: string
}

function errorCode(error: unknown): string {
  return error instanceof Error
    ? ((error as NodeJS.ErrnoException).code ?? error.name ?? 'UNKNOWN')
    : 'UNKNOWN'
}

function fdKind(fd: number): FdKind {
  const stat = fstatSync(fd)
  if (stat.isFile()) return 'file'
  if (stat.isDirectory()) return 'directory'
  if (stat.isSocket()) return 'socket'
  if (stat.isFIFO()) return 'fifo'
  if (stat.isCharacterDevice()) return 'character'
  if (stat.isBlockDevice()) return 'block'
  return 'other'
}

function describeFd(fd: number): string {
  try {
    return `valid:${fdKind(fd)}`
  } catch (error) {
    return `invalid:${errorCode(error)}`
  }
}

function describeProcessStream(getStream: () => NodeJS.ReadStream | NodeJS.WriteStream): string {
  try {
    const stream = getStream() as NodeJS.ReadStream & NodeJS.WriteStream & {
      closed?: boolean
      readableEnded?: boolean
      writableEnded?: boolean
    }
    return [
      `tty=${stream.isTTY ? 1 : 0}`,
      `destroyed=${stream.destroyed ? 1 : 0}`,
      `closed=${stream.closed ? 1 : 0}`,
      `readable=${stream.readable ? 1 : 0}`,
      `readableEnded=${stream.readableEnded ? 1 : 0}`,
      `writable=${stream.writable ? 1 : 0}`,
      `writableEnded=${stream.writableEnded ? 1 : 0}`
    ].join(',')
  } catch (error) {
    return `unavailable:${errorCode(error)}`
  }
}

function activeResourceSummary(): string {
  try {
    const counts = new Map<string, number>()
    for (const name of process.getActiveResourcesInfo()) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `${name}:${count}`)
      .join(',') || 'none'
  } catch (error) {
    return `unavailable:${errorCode(error)}`
  }
}

function sampledFds(fds: number[]): number[] {
  if (fds.length <= FD_SAMPLE_LIMIT) return fds
  const lowerCount = Math.floor(FD_SAMPLE_LIMIT / 2)
  return [
    ...fds.slice(0, lowerCount),
    ...fds.slice(-(FD_SAMPLE_LIMIT - lowerCount))
  ]
}

function nextAvailableFd(): { fdNext: number; fdNextCode: string } {
  try {
    const fd = openSync('/dev/null', 'r')
    closeSync(fd)
    return { fdNext: fd, fdNextCode: 'ok' }
  } catch (error) {
    return { fdNext: -1, fdNextCode: errorCode(error) }
  }
}

export function captureSpawnDiagnostics(): SpawnDiagnosticsSnapshot {
  const counts: Record<FdKind, number> = {
    file: 0,
    directory: 0,
    socket: 0,
    fifo: 0,
    character: 0,
    block: 0,
    other: 0
  }
  let fds: number[] = []
  let fdInvalidCount = 0
  let fdScanCode = 'ok'

  try {
    fds = readdirSync('/dev/fd')
      .map((entry) => Number(entry))
      .filter((fd) => Number.isInteger(fd) && fd >= 0)
      .sort((a, b) => a - b)
  } catch (error) {
    // Windows / restricted runtime: keep sentinel values below.
    fdScanCode = errorCode(error)
  }

  const fdCount = fdScanCode === 'ok' ? fds.length : -1
  if (fdCount >= 0) {
    if (fdBaselineCount < 0) fdBaselineCount = fdCount
    fdHighWater = Math.max(fdHighWater, fdCount)
  }

  const sampled = sampledFds(fds)
  for (const fd of sampled) {
    try {
      counts[fdKind(fd)] += 1
    } catch {
      // /dev/fd is inherently racy: a descriptor can close after readdir.
      fdInvalidCount += 1
    }
  }

  const nextFd = nextAvailableFd()

  return {
    fdCount,
    fdScanCode,
    fdMax: fds.at(-1) ?? -1,
    ...nextFd,
    fdBaselineCount,
    fdDeltaFromBaseline: fdCount >= 0 && fdBaselineCount >= 0 ? fdCount - fdBaselineCount : -1,
    fdHighWater,
    fdSampledCount: sampled.length,
    fdScanTruncated: fds.length > sampled.length,
    fdInvalidCount,
    fdFileCount: counts.file,
    fdDirectoryCount: counts.directory,
    fdSocketCount: counts.socket,
    fdFifoCount: counts.fifo,
    fdCharacterCount: counts.character,
    fdBlockCount: counts.block,
    fdOtherCount: counts.other,
    stdinFdState: describeFd(0),
    stdoutFdState: describeFd(1),
    stderrFdState: describeFd(2),
    stdinStreamState: describeProcessStream(() => process.stdin),
    stdoutStreamState: describeProcessStream(() => process.stdout),
    stderrStreamState: describeProcessStream(() => process.stderr),
    activeResources: activeResourceSummary(),
    epipeCount,
    lastEpipeAgoMs: lastEpipeAt > 0 ? Math.max(0, Date.now() - lastEpipeAt) : -1
  }
}

export function recordSpawnRelatedEpipe(): void {
  epipeCount += 1
  lastEpipeAt = Date.now()
}

// 只返回路径类型，不写出绝对路径，避免诊断包泄露用户目录结构。
export function describeSpawnPath(path: string): string {
  if (!isAbsolute(path)) return 'command-name'
  try {
    const stat = statSync(path)
    if (stat.isFile()) return 'file'
    if (stat.isDirectory()) return 'directory'
    return 'other'
  } catch (error) {
    return `unavailable:${errorCode(error)}`
  }
}

// 只记录权限检查结果，不记录待检查路径。
export function describeSpawnAccess(path: string, kind: 'cwd' | 'executable'): string {
  if (!isAbsolute(path)) return 'command-name'
  try {
    accessSync(path, kind === 'cwd' ? constants.R_OK | constants.X_OK : constants.X_OK)
    return 'ok'
  } catch (error) {
    return `unavailable:${errorCode(error)}`
  }
}

export function countOpenFds(): number {
  try {
    return readdirSync('/dev/fd').length
  } catch {
    return -1
  }
}

export function repairMissingStdioFds(): number[] {
  const repaired: number[] = []
  for (const fd of [0, 1, 2]) {
    try {
      fstatSync(fd)
      continue // fd 还有效
    } catch {
      // fd 失效，尝试让 open 占用这个编号（open 返回最小空闲 fd）
    }
    try {
      const nfd = openSync('/dev/null', fd === 0 ? 'r' : 'a')
      if (nfd === fd) {
        repaired.push(fd)
      } else {
        closeSync(nfd) // 低位 fd 被别的东西占了，绑不回去
      }
    } catch {
      // /dev/null 都打不开，无能为力
    }
  }
  return repaired
}

type SpawnProbeOptions = {
  stdio?: SpawnOptions['stdio']
  detached?: boolean
  cwd?: string
}

// 等待最小子进程真正退出，并区分 spawn 同步异常与异步 error 事件。
// 固定使用 /usr/bin/true，不依赖用户 CLI、PATH 或网络。
export function runSpawnProbe(options: SpawnProbeOptions = {}): Promise<string> {
  const stdio: SpawnOptions['stdio'] = options.stdio ?? ['pipe', 'pipe', 'pipe']
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn('/usr/bin/true', [], {
        stdio,
        detached: options.detached ?? true,
        ...(options.cwd ? { cwd: options.cwd } : {})
      })
    } catch (error) {
      resolve(`sync:${errorCode(error)}`)
      return
    }

    let settled = false
    const finish = (result: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      finish(asyncError ?? 'timeout')
    }, 2_000)

    let asyncError: string | undefined
    child.once('error', (error) => {
      // error 后通常还会有 close；等 close 再启动下一探针，避免残留 pipe 重叠。
      asyncError = `async:${errorCode(error)}`
    })
    child.once('close', (code, signal) => {
      if (asyncError) finish(asyncError)
      else if (signal) finish(`signal:${signal}`)
      else finish(code === 0 ? 'ok' : `exit:${code ?? 'unknown'}`)
    })
    child.stdin?.destroy()
    child.stdout?.destroy()
    child.stderr?.destroy()
  })
}

export async function probeSpawnVariants(cwd?: string): Promise<SpawnProbeMatrix> {
  // 严格串行，避免探针本身同时占用多组 pipe，污染 fd 压力现场。
  return {
    probePipeDetached: await runSpawnProbe(),
    probePipeAttached: await runSpawnProbe({ detached: false }),
    probeIgnoreDetached: await runSpawnProbe({ stdio: 'ignore' }),
    probePipeDetachedCwd: cwd
      ? await runSpawnProbe({ cwd })
      : 'not-run'
  }
}

export type SpawnHealthResult = {
  ok: boolean
  code?: string
  repairedFds: number[]
  fdCount: number
}

type SpawnHealthContext = {
  appVersion?: string
  isPackaged?: boolean
}

function processIdentity(context: SpawnHealthContext): Record<string, string | number | boolean> {
  return {
    processId: process.pid,
    parentProcessId: process.ppid,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    ...(context.appVersion ? { appVersion: context.appVersion } : {}),
    ...(context.isPackaged !== undefined ? { isPackaged: context.isPackaged } : {})
  }
}

// 启动时调用：先探测；失败时修复标准 fd，再跑探测矩阵并记录诊断。
export async function ensureSpawnHealth(context: SpawnHealthContext = {}): Promise<SpawnHealthResult> {
  const initialSnapshot = captureSpawnDiagnostics()
  const firstProbe = await runSpawnProbe()
  if (firstProbe === 'ok') {
    diagnostics.info('app.spawn_health', {
      phase: 'startup',
      initialProbeCode: 'ok',
      ...processIdentity(context),
      ...initialSnapshot
    })
    return { ok: true, repairedFds: [], fdCount: initialSnapshot.fdCount }
  }

  diagnostics.error(
    'app.spawn_probe.failed',
    Object.assign(new Error(`spawn startup probe failed: ${firstProbe}`), { code: firstProbe }),
    {
      phase: 'startup-before-repair',
      initialProbeCode: firstProbe,
      ...processIdentity(context),
      ...initialSnapshot
    }
  )

  const repaired = repairMissingStdioFds()
  const repairedSnapshot = captureSpawnDiagnostics()
  const probes = await probeSpawnVariants()
  const secondProbe = probes.probePipeDetached === 'ok' ? null : probes.probePipeDetached
  const result: SpawnHealthResult = {
    ok: secondProbe === null,
    code: secondProbe ?? firstProbe,
    repairedFds: repaired,
    fdCount: repairedSnapshot.fdCount
  }
  if (!result.ok) {
    diagnostics.error(
      'app.spawn_broken',
      new Error(`spawn 自检失败（code=${result.code}），修复 fd=${JSON.stringify(repaired)} 后仍失败；AI 面板将无法启动子进程`),
      {
        phase: 'startup-after-repair',
        repairedFds: repaired.join(','),
        code: result.code ?? '',
        ...processIdentity(context),
        ...probes,
        ...repairedSnapshot
      }
    )
  } else {
    diagnostics.warn('app.spawn_repaired', {
      phase: 'startup-after-repair',
      repairedFds: repaired.join(','),
      ...processIdentity(context),
      ...probes,
      ...repairedSnapshot
    })
  }
  return result
}
