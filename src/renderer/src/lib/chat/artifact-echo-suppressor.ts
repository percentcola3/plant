// artifact 回声抑制：claude 用 Write/Edit 写完文件后，assistant 文本里经常
// echo 一遍刚写的文件内容（尤其 HTML/markdown），用户看到"写了文件 → 又把整个
// 文件代码贴在对话里"，冗余且分散注意力。
//
// 设计为纯函数 + 外部状态：reducer 在 AgentConversationState 里持有
// recentFileWrites（滑窗），处理 message.assistant 时调用这两个函数。
// 这样保持 reducer 的纯函数契约（applyAgentEvent 无副作用）。
//
// 保守原则：宁可漏过（保留）不可误杀（把用户真正想看的代码剥掉）。
//   - 只比对"精确包含"关系（规范化空白后），不做模糊匹配
//   - 只处理 Write/Edit/MultiEdit/write_file/replace 这几个明确的文件写入工具
//   - 滑窗大小 8（最近 8 次写入内容）
//
// 对标 open-design claude-stream.ts:stripDuplicateArtifactText，但裁剪到
// "整 text block 比对"粒度（不做跨 chunk 流式 suppress，那是 P4 的事）。
import type { AgentContentBlock } from './agent-events'

const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'write_file', 'replace'])
export const ARTIFACT_ECHO_WINDOW_SIZE = 8

// 规范化空白用于比对：去掉首尾空白、统一换行、压缩每行首尾空白、丢空行。
// 这样 "  <div>\n\n  </div>  " 跟 "<div>\n</div>" 视为相同。
function normalizeWhitespace(text: string): string {
  return text
    .replace(/^\uFEFF/, '')          // BOM
    .replace(/\r\n?/g, '\n')         // CRLF → LF
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

function extractFileWriteContent(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const content = obj.content ?? obj.new_string ?? obj.file_text
  return typeof content === 'string' ? content : null
}

// 从一条 assistant message 的 content blocks 里提取所有 file-write 的规范化内容。
// 返回 [toolUseId, normalizedContent] 对，供 reducer 累积进 recentFileWrites。
export function collectFileWrites(
  blocks: AgentContentBlock[]
): Array<{ toolUseId: string; content: string }> {
  const out: Array<{ toolUseId: string; content: string }> = []
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue
    if (!FILE_WRITE_TOOLS.has(block.name)) continue
    const raw = extractFileWriteContent(block.input)
    if (!raw) continue
    const normalized = normalizeWhitespace(raw)
    if (normalized) out.push({ toolUseId: block.toolUseId, content: normalized })
  }
  return out
}

// 把新的 file-write 合并进 recentFileWrites 滑窗（去重 toolUseId，超窗丢最老）。
export function mergeFileWrites(
  recent: Array<{ toolUseId: string; content: string }>,
  incoming: Array<{ toolUseId: string; content: string }>
): Array<{ toolUseId: string; content: string }> {
  const seen = new Set(recent.map((r) => r.toolUseId))
  const merged = [...recent]
  for (const item of incoming) {
    if (seen.has(item.toolUseId)) continue
    seen.add(item.toolUseId)
    merged.push(item)
  }
  // 超窗丢最老（队首）
  while (merged.length > ARTIFACT_ECHO_WINDOW_SIZE) merged.shift()
  return merged
}

// 抑制 text blocks 里跟 recentFileWrites 内容重复的部分。返回过滤后的 blocks。
// 非文本 block 原样保留；text block 若规范化后等于某次写入或为其子串（≥20 字符）则剥掉。
//
// 对 writes.content 也做一次 normalizeWhitespace（幂等：已规范化的再 norm 无变化），
// 让函数对输入宽容 —— 调用方传原始字符串或已规范化字符串都能正确比对。
export function suppressArtifactEcho(
  blocks: AgentContentBlock[],
  recentWrites: Array<{ content: string }>
): AgentContentBlock[] {
  if (recentWrites.length === 0) return blocks
  const writeContents = recentWrites.map((w) => normalizeWhitespace(w.content)).filter((c) => c.length > 0)
  if (writeContents.length === 0) return blocks
  const out: AgentContentBlock[] = []
  for (const block of blocks) {
    if (block.type !== 'text') {
      out.push(block)
      continue
    }
    const normalized = normalizeWhitespace(block.text)
    if (!normalized) {
      out.push(block)
      continue
    }
    // text ⊂ written：echo 比写入短或等长。反向（写入是 text 子串）说明 text
    // 更长是用户想看的展开，不抑制。≥20 字符门槛避免短文本误判。
    const isEcho = writeContents.some(
      (w) => w === normalized || (normalized.length >= 20 && w.includes(normalized))
    )
    if (!isEcho) out.push(block)
  }
  return out
}
