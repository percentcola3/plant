// 同 family 工具分组：把连续的同 family 工具（多个 Edit/Read）合并成一个 group，
// 折叠成 "编辑 ×3 · 完成" 这样的 summary，避免一个 turn 改 5 个文件就出现 5 张卡。
//
// 对标 open-design ToolGroupCard + summarizeGroup，但裁剪到我们已有的 ToolCallPair 结构。
import type { AgentContentBlock } from './agent-events'
import { isZvecSearchTool } from '@shared/claude-display'

// 工具 → family 映射。同 family 的连续工具会被合并。
// 未映射的工具各自成独立 family（name 本身），不会误合并。
const TOOL_FAMILY: Record<string, string> = {
  // 文件编辑类
  Write: 'editing',
  Edit: 'editing',
  MultiEdit: 'editing',
  write_file: 'editing',
  replace: 'editing',
  // 文件读取类
  Read: 'reading',
  // 搜索类
  Glob: 'searching',
  Grep: 'searching',
  // 执行类
  Bash: 'bash',
  // 网络类
  WebFetch: 'web',
  WebSearch: 'web'
}

export type ToolCallStatus = 'pending' | 'done' | 'error'

export type ToolCallPair = {
  toolUseId: string
  name: string
  input: unknown
  result?: { content: unknown; isError?: boolean }
  status: ToolCallStatus
}

export type ToolFamily = 'editing' | 'reading' | 'searching' | 'bash' | 'web' | 'retrieval'

// 分组结果：单个工具原样保留；多个同 family 连续工具合并成 group
export type ToolGroupEntry =
  | { kind: 'single'; pair: ToolCallPair }
  | { kind: 'group'; family: string; pairs: ToolCallPair[] }

// family 的中文标签 + 动词（用于 summary）
const FAMILY_LABEL: Record<string, { action: string; verb: string }> = {
  retrieval: { action: 'zvec-grep 检索', verb: '已检索' },
  editing: { action: '编辑', verb: '已编辑' },
  reading: { action: '读取', verb: '已读取' },
  searching: { action: '搜索', verb: '已搜索' },
  bash: { action: '执行命令', verb: '已执行' },
  web: { action: '网络请求', verb: '已完成' }
}

export function getToolFamily(name: string): string {
  if (isZvecSearchTool(name)) return 'retrieval'
  return TOOL_FAMILY[name] ?? name
}

export function getFamilyLabel(family: string): { action: string; verb: string } {
  return FAMILY_LABEL[family] ?? { action: family, verb: '已完成' }
}

/** 完成后保留真实检索记录，普通工具继续随执行过程折叠。 */
export function isRetrievalEntry(entry: ToolGroupEntry): boolean {
  const pairs = entry.kind === 'group' ? entry.pairs : [entry.pair]
  return pairs.some(pair => isZvecSearchTool(pair.name))
}

// 把 toolCallPairs 分组成 ToolGroupEntry[]。
// 规则：相邻的同 family 工具合并；不相邻（中间夹了别的）的不合并。
// 我们保留"相邻"约束（跟 open-design 一致），避免把分散的同类工具强凑一起丢顺序信息。
export function groupToolCalls(pairs: ToolCallPair[]): ToolGroupEntry[] {
  if (pairs.length === 0) return []

  const entries: ToolGroupEntry[] = []
  let i = 0
  while (i < pairs.length) {
    const family = getToolFamily(pairs[i].name)
    // 往后扫连续同 family
    const groupPairs: ToolCallPair[] = [pairs[i]]
    let j = i + 1
    while (j < pairs.length && getToolFamily(pairs[j].name) === family) {
      groupPairs.push(pairs[j])
      j++
    }
    if (groupPairs.length === 1) {
      entries.push({ kind: 'single', pair: groupPairs[0] })
    } else {
      entries.push({ kind: 'group', family, pairs: groupPairs })
    }
    i = j
  }
  return entries
}

// group 的 summary 状态："全部完成" / "进行中 (2/3)" / "部分失败" 等
export type GroupSummary = {
  label: string       // "编辑 ×3"
  statusLabel: string // "已完成" / "进行中" / "部分失败"
  status: ToolCallStatus  // 聚合状态（任一 pending→pending；任一 error 且无 pending→error；否则 done）
}

export function summarizeGroup(family: string, pairs: ToolCallPair[]): GroupSummary {
  const { action, verb } = getFamilyLabel(family)
  const label = `${action} ×${pairs.length}`

  const hasPending = pairs.some(p => p.status === 'pending')
  const hasError = pairs.some(p => p.status === 'error')
  const doneCount = pairs.filter(p => p.status === 'done').length

  let status: ToolCallStatus
  let statusLabel: string
  if (hasPending) {
    status = 'pending'
    statusLabel = `进行中 (${doneCount}/${pairs.length})`
  } else if (hasError) {
    status = 'error'
    statusLabel = doneCount === 0 ? '失败' : `部分失败 (${doneCount}/${pairs.length})`
  } else {
    status = 'done'
    statusLabel = verb
  }

  return { label, statusLabel, status }
}

// 从 message content blocks 提取 toolCallPairs（跟 MessageContent 原有逻辑一致，抽出来复用）
export function extractToolCallPairs(content: AgentContentBlock[]): ToolCallPair[] {
  const pairs: Map<string, ToolCallPair> = new Map()
  for (const block of content) {
    if (block.type === 'tool_use') {
      pairs.set(block.toolUseId, {
        toolUseId: block.toolUseId,
        name: block.name,
        input: block.input,
        status: 'pending'
      })
    }
    if (block.type === 'tool_result') {
      const pair = pairs.get(block.toolUseId)
      if (pair) {
        pair.result = { content: block.content, isError: block.isError }
        pair.status = block.isError ? 'error' : 'done'
      }
    }
  }
  return Array.from(pairs.values())
}
