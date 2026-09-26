// zvec-grep（zg）运行时层：定位 zg CLI 脚本并统一 spawn。
//
// 接入形态（spike 已验证）：
//   - 通过 ELECTRON_RUN_AS_NODE=1 用应用自带的 Electron 二进制以 Node 模式运行
//     zg 的 JS 入口， zg 0.2.2 完整可用（含 onnxruntime 向量引擎）——
//     打包用户无需安装任何 Node。
//   - zg 脚本与 native 依赖在打包态位于 app.asar.unpacked（electron-builder
//     asarUnpack），运行时把 app.asar 路径改写为 app.asar.unpacked。
//
// zg CLI（0.2.2）为子命令风格：zg index / zg query / zg status。
//   - `zg status --check-ready` 退出码 0 = 索引就绪（非 0 = 未就绪/不存在）
//   - `zg query` 在无索引目录 156ms 干净退出（stderr 带 Code: 行），不阻塞
//   - 索引落 <root>/.zvec-grep/，CN 网络 HuggingFace 失败自动回退 ModelScope
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { diagnostics } from '../diagnostics/runtime'

const ZG_REL_PATH = join('@zvec', 'zvec-grep', 'dist', 'cli', 'index.js')

let cachedScriptPath: string | null | undefined = undefined

function toUnpackedAsarPath(path: string): string {
  return path.replace(/app\.asar(?=\/|$)/, 'app.asar.unpacked')
}

// 定位 zg 的 JS 入口。dev 态：项目 node_modules；打包态：asar（运行时改写为
// unpacked 路径，native 依赖才能以真实文件形式被加载）。
// 任何定位异常（如测试环境 electron mock 不完整）一律判定不可用，调用方走回退。
export function resolveZgScript(): string | null {
  if (cachedScriptPath !== undefined) return cachedScriptPath
  const checkedPaths: string[] = []
  const candidates = [
    // 打包态 app 根（getAppPath 在不完整 electron mock 下可能缺失，逐候选兜底）
    (): string => join(app.getAppPath(), 'node_modules', ZG_REL_PATH),
    // dev 态（编译产物）：out/main/zg/ → 项目根
    (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', ZG_REL_PATH),
    // dev/测试态（源码直接运行）：进程 cwd = 项目根（vitest、electron-vite dev 均如此）
    (): string => join(process.cwd(), 'node_modules', ZG_REL_PATH)
  ]
  for (const resolve of candidates) {
    let candidate: string
    try {
      candidate = resolve()
    } catch {
      continue
    }
    try {
      const unpacked = toUnpackedAsarPath(candidate)
      checkedPaths.push(unpacked)
      const target = existsSync(unpacked) ? unpacked : existsSync(candidate) ? candidate : null
      if (target) {
        cachedScriptPath = target
        diagnostics.info('zg.runtime.resolved', { success: true, relativePath: target })
        return cachedScriptPath
      }
    } catch {
      // try next
    }
  }
  cachedScriptPath = null
  diagnostics.warn('zg.runtime.unavailable', {
    success: false,
    reason: 'zg script not found in node_modules',
    relativePath: [...new Set(checkedPaths)].join(' | ')
  })
  return cachedScriptPath
}

export type ZgRunResult = {
  code: number
  stdout: string
  stderr: string
  killed: boolean
}

export type ZgRunOptions = {
  cwd: string
  timeoutMs?: number
  maxBufferBytes?: number
}

function clip(text: string, max = 240): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

// 每次真实 spawn zg CLI 都打一条结构化日志，便于核对「这次是不是 zg 在干活」。
function logZgSpawn(script: string, args: string[], opts: ZgRunOptions): number {
  const startedAt = Date.now()
  diagnostics.info('zg.process.started', {
    name: args[0] ?? '?',
    sessionTarget: opts.cwd,
    relativePath: script
  })
  return startedAt
}

type ZgProcessError = Error & { code?: number | string | null; killed?: boolean; syscall?: string }

function processErrorMessage(error: ZgProcessError): string {
  return typeof error.code === 'string' ? `${error.code}: ${error.message}` : error.message
}

function logZgDone(args: string[], opts: ZgRunOptions, startedAt: number, result: ZgRunResult, error?: ZgProcessError | null): void {
  const cmd = args[0] ?? '?'
  const payload: Record<string, unknown> = {
    name: cmd,
    sessionTarget: opts.cwd,
    exitCode: result.code,
    durationMs: Date.now() - startedAt,
    success: result.code === 0 && !result.killed,
    ...(result.killed ? { signal: 'SIGKILL' } : {}),
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    ...(error?.syscall ? { syscall: error.syscall } : {})
  }
  // index/status 的 stderr 包含缺依赖、权限和模型加载错误；不记录 stdout、
  // 查询参数或查询 stderr，避免查询原文和命中文件内容落入 main.log。
  if ((cmd === 'index' || cmd === 'status') && result.stderr.trim()) {
    payload.reason = clip(result.stderr, 2_000)
  } else if (cmd === 'query') {
    const errorCode = /^Code:\s*(ZVEC_GREP\.[A-Z0-9_.]+)/m.exec(result.stderr)
    if (errorCode) payload.code = errorCode[1]
  }
  if (payload.success) diagnostics.info('zg.process.finished', payload)
  else diagnostics.warn('zg.process.finished', payload)
}

function unavailableResult(args: string[], opts: ZgRunOptions): ZgRunResult {
  diagnostics.warn('zg.process.skipped', {
    name: args[0] ?? '?', sessionTarget: opts.cwd, reason: 'zg script not found'
  })
  return { code: -1, stdout: '', stderr: 'zg script not found', killed: false }
}

// 统一的 zg 调用。非零退出不抛异常（调用方按 code/stderr 分类处理）；
// 超时被 kill 时 killed=true。
export function runZg(args: string[], opts: ZgRunOptions): Promise<ZgRunResult> {
  const script = resolveZgScript()
  if (!script) return Promise.resolve(unavailableResult(args, opts))
  const startedAt = logZgSpawn(script, args, opts)
  return new Promise((resolve) => {
    const finish = (err: ZgProcessError | null, stdout: string, stderr: string): void => {
      const result: ZgRunResult = {
        code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
        stdout,
        stderr: stderr || (err ? processErrorMessage(err) : ''),
        killed: !!err?.killed
      }
      logZgDone(args, opts, startedAt, result, err)
      resolve(result)
    }
    try {
      execFile(
        process.execPath,
        [script, ...args],
        {
          cwd: opts.cwd,
          timeout: opts.timeoutMs ?? 15_000,
          maxBuffer: opts.maxBufferBytes ?? 8 * 1024 * 1024,
          killSignal: 'SIGKILL',
          env: {
            ...process.env,
            // 用 Electron 内置 Node 运行 zg（Electron 内置 Node 20 实测跑通 0.2.2
            // 的完整向量查询），打包用户无需安装 Node
            ELECTRON_RUN_AS_NODE: '1'
          }
        },
        (error, stdout, stderr) => {
          finish(error, typeof stdout === 'string' ? stdout : '', typeof stderr === 'string' ? stderr : '')
        }
      )
    } catch (error) {
      finish(error as ZgProcessError, '', '')
    }
  })
}

export function isZgAvailable(): boolean {
  return resolveZgScript() !== null
}

// 流式变体：stdout/stderr 逐块回调（含 \r 刷新的进度行），用于构建期的实时
// 阶段/百分比解析。返回值语义与 runZg 一致（非零不抛异常）。
export function runZgStream(
  args: string[],
  opts: ZgRunOptions,
  onChunk: (stream: 'stdout' | 'stderr', text: string) => void
): Promise<ZgRunResult> {
  const script = resolveZgScript()
  if (!script) return Promise.resolve(unavailableResult(args, opts))
  const startedAt = logZgSpawn(script, args, opts)
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(process.execPath, [script, ...args], {
        cwd: opts.cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        // detached=false：随 App 退出，避免遗留孤儿进程
      })
    } catch (error) {
      const err = error as ZgProcessError
      const result = { code: 1, stdout: '', stderr: processErrorMessage(err), killed: false }
      logZgDone(args, opts, startedAt, result, err)
      resolve(result)
      return
    }
    let stdout = ''
    let stderr = ''
    let killed = false
    let settled = false
    const timer = setTimeout(() => {
      killed = true
      try { child.kill('SIGKILL') } catch { /* already dead */ }
    }, opts.timeoutMs ?? 15_000)
    const finish = (code: number, error?: ZgProcessError): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) stderr = [stderr, processErrorMessage(error)].filter(Boolean).join('\n')
      const result = { code, stdout, stderr, killed }
      logZgDone(args, opts, startedAt, result, error)
      resolve(result)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (stdout.length < (opts.maxBufferBytes ?? 8 * 1024 * 1024)) stdout += text
      onChunk('stdout', text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (stderr.length < (opts.maxBufferBytes ?? 8 * 1024 * 1024)) stderr += text
      onChunk('stderr', text)
    })
    child.on('error', (error) => finish(1, error))
    child.on('close', (code) => finish(code ?? 1))
  })
}

// 测试用：清缓存（生产代码不要调用）
export function resetZgRuntimeCacheForTests(): void {
  cachedScriptPath = undefined
}
