// AI 冲突解决：把所有冲突文件原样喂给 Claude Code，让它产出每个文件的合并版本。
//
// 异步后台任务（不再阻塞 IPC / 冻结冲突对话框）：startAiResolve 立即返回，
// claude --print 子进程 detach 跑，完成后回调 onDone（由 IPC 层广播事件）。
// 同一工作区不并发；abortAiResolve 可中途杀掉。全部解决且无残留冲突时自动
// git rebase/merge --continue 收尾，避免仓库卡在半合并态。
import { promises as fs } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { WorkspacesStore } from '../workspaces/store'
import { gitFor } from '../git/client'
import { listConflicts, continueOperation } from '../workspaces/conflict'
import { UIClientError } from '../ipc/errors'
import { resolveCliSync } from '../system/cli-resolver'

const store = new WorkspacesStore()
const MAX_FILE_BYTES = 64 * 1024              // 单文件超 64KB 跳过 AI（避免 prompt 过大）
const CLAUDE_TIMEOUT_MS = 5 * 60_000          // 5 分钟超时

export type AiResolveOutcome = {
  relPath: string
  applied: boolean
  reason?: 'too-large' | 'binary' | 'no-output' | 'parse-failed' | 'apply-failed' | 'ok'
  error?: string
}

// 后台任务最终结果（广播给 renderer）
export type AiResolveResult =
  | { ok: true; outcomes: AiResolveOutcome[]; continued: boolean }
  | { ok: false; error: string }

// 进行中的任务句柄：child 供 abort，timer 供清理
type InFlight = { child: ChildProcess | null; timer: NodeJS.Timeout | null }
const inFlight = new Map<string, InFlight>()

export function isAiResolveInFlight(workspaceId: string): boolean {
  return inFlight.has(workspaceId)
}

// 触发后台 AI 解决。已在进行 → 返回 {started:false}。否则立即返回 {started:true}，
// 子进程 detach 跑，完成后回调 onDone（含自动 continue 尝试结果）。
export function startAiResolve(workspaceId: string, onDone: (result: AiResolveResult) => void): { started: boolean } {
  if (inFlight.has(workspaceId)) return { started: false }
  inFlight.set(workspaceId, { child: null, timer: null })
  void runAiResolveTask(workspaceId)
    .catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    .then((result) => {
      const handle = inFlight.get(workspaceId)
      if (handle?.timer) clearTimeout(handle.timer)
      inFlight.delete(workspaceId)
      onDone(result ?? { ok: false, error: '未知错误' })
    })
  return { started: true }
}

// 中途取消：SIGTERM 子进程。runAiResolveTask 的 exit 会走 reject 路径。
export function abortAiResolve(workspaceId: string): boolean {
  const handle = inFlight.get(workspaceId)
  if (!handle?.child) return false
  try { handle.child.kill('SIGTERM') } catch { /* ignore */ }
  return true
}

async function runAiResolveTask(workspaceId: string): Promise<AiResolveResult> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)

  const { files } = await listConflicts(workspaceId)
  if (files.length === 0) return { ok: true, outcomes: [], continued: false }

  const candidates: { relPath: string; content: string }[] = []
  const outcomes: AiResolveOutcome[] = []

  for (const f of files) {
    if (f.binary) {
      outcomes.push({ relPath: f.relPath, applied: false, reason: 'binary' })
      continue
    }
    const abs = join(ws.path, f.relPath)
    try {
      const stat = await fs.stat(abs)
      if (stat.size > MAX_FILE_BYTES) {
        outcomes.push({ relPath: f.relPath, applied: false, reason: 'too-large' })
        continue
      }
      const text = await fs.readFile(abs, 'utf-8')
      candidates.push({ relPath: f.relPath, content: text })
    } catch (e) {
      outcomes.push({ relPath: f.relPath, applied: false, reason: 'apply-failed', error: (e as Error).message })
    }
  }

  if (candidates.length === 0) return { ok: true, outcomes, continued: false }

  const prompt = buildPrompt(candidates)
  const stdout = await runClaudePrint(ws.path, prompt, workspaceId)
  const parsed = parseClaudeOutput(stdout)

  const sg = gitFor(ws.path)
  for (const c of candidates) {
    const merged = parsed.get(c.relPath)
    if (merged === undefined) {
      outcomes.push({ relPath: c.relPath, applied: false, reason: 'no-output' })
      continue
    }
    if (containsConflictMarkers(merged)) {
      outcomes.push({ relPath: c.relPath, applied: false, reason: 'parse-failed', error: 'AI 输出仍含冲突标记' })
      continue
    }
    try {
      await fs.writeFile(join(ws.path, c.relPath), merged, 'utf-8')
      await sg.add([c.relPath])
      outcomes.push({ relPath: c.relPath, applied: true, reason: 'ok' })
    } catch (e) {
      outcomes.push({ relPath: c.relPath, applied: false, reason: 'apply-failed', error: (e as Error).message })
    }
  }

  // 全部解决且无残留未合并 → 自动 continue 收尾，避免仓库卡在半合并态
  let continued = false
  const allApplied = candidates.every((c) => outcomes.find((o) => o.relPath === c.relPath)?.applied)
  if (allApplied) {
    try {
      const remaining = await listConflicts(workspaceId)
      if (remaining.files.length === 0) {
        await continueOperation(workspaceId)
        continued = true
      }
    } catch { /* continue 失败不影响已解决的文件；留给用户手动 continue */ }
  }

  return { ok: true, outcomes, continued }
}

function buildPrompt(files: { relPath: string; content: string }[]): string {
  const head = [
    '你正在帮助解决 git 冲突。下面给出多个含 <<<<<<<...=======...>>>>>>> 标记的文件原文。',
    '请阅读每个文件的两侧内容，结合上下文给出**合理的合并版本**。',
    '严格的输出要求（机器解析，不要偏离）：',
    '- 每个文件用一个独立 fenced code block，开头三个反引号紧跟 FILE:<相对路径>，结束三个反引号；',
    '- 文件之间不要有其它注释；不要解释思路；不要 Markdown 列表；',
    '- 每个 code block 内是该文件**完整最终内容**，已经移除所有 <<<<<<< / ======= / >>>>>>> 标记；',
    '- 如果某文件你无法判断，仍然输出一个 code block，原样保留所有冲突标记（让人来处理）。',
    '',
    '示例：',
    '```FILE:src/a.md',
    '<合并后的完整内容>',
    '```',
    '```FILE:src/b.css',
    '<合并后的完整内容>',
    '```',
    ''
  ].join('\n')
  const body = files.map((f) => [
    `### 输入：${f.relPath}`,
    '```',
    f.content,
    '```',
    ''
  ].join('\n')).join('\n')
  return head + '\n' + body
}

// spawn claude --print，把 child 挂进 inFlight 供 abort，超时 SIGTERM。
async function runClaudePrint(cwd: string, prompt: string, workspaceId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cli = resolveCliSync()
    const child = spawn(cli.bin, cli.wrapArgs(['--print', '--permission-mode', 'default']), {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env } as Record<string, string>
    })
    const handle = inFlight.get(workspaceId)
    if (handle) handle.child = child
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      reject(new UIClientError('AI_TIMEOUT', `AI 响应超时（${CLAUDE_TIMEOUT_MS / 1000}s）`))
    }, CLAUDE_TIMEOUT_MS)
    if (handle) handle.timer = timer

    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf-8') })
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf-8') })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new UIClientError('AI_SPAWN_FAILED', `启动 claude 失败：${err.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new UIClientError('AI_FAILED', `claude 退出码 ${code}：${stderr.slice(0, 400)}`))
        return
      }
      resolve(stdout)
    })

    child.stdin?.write(prompt)
    child.stdin?.end()
  })
}

// 解析 ```FILE:<relPath> ... ``` 围栏，返回每文件的最终内容
function parseClaudeOutput(stdout: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /```FILE:([^\n`]+)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stdout)) !== null) {
    const rel = m[1].trim()
    const body = m[2]
    map.set(rel, body.replace(/\n$/, '\n'))
  }
  return map
}

function containsConflictMarkers(text: string): boolean {
  return /<<<<<<< |^=======$|>>>>>>> /m.test(text)
}
