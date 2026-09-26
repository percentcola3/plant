// claude JSONL stdout 解析层：把原始 stream-json 事件转成 UI 友好事件 + 威胁检测。
//
// 职责（v1 / P2）：
//   - ⑤ role-marker 注入检测：assistant text 里出现伪造 ## user/## assistant →
//     触发 abort，防止对话被劫持。只检测 text，不检测 thinking（thinking 不进
//     下一轮 prompt 序列化，不是注入向量；CoT 里出现 ## user 是正常的）。
//
// 职责（P4 会加）：
//   - ③ stream_event 增量解析 → text_delta 流式 token
//   - ② tool_use 去重（stream 拼装 vs assistant wrapper）
//
// 对标 open-design claude-stream.ts，但：
//   - 我们不做 agent 抽象，函数签名固定 claude
//   - artifact 回声抑制（④）放在 renderer reducer（那里有 text block 状态），
//     不在这里——main 只负责检测威胁信号（abort 级），不修改展示文本
//
// 设计：handler 接收已 JSON.parse 的原始事件，吐出 0~N 个 ClaudeStreamEvent。
// 'raw' 事件透传给原 IPC 路径（保持向后兼容）；其他事件是 main 侧关心的信号。
import type { StreamJsonEvent } from './spawn-turn'

export type ClaudeStreamEvent =
  // 透传：spawn-turn 继续把原 event 推 IPC（claude.delta:<sessionId>）
  | { type: 'raw'; event: StreamJsonEvent }
  // 检测到伪造角色标记 → spawn-turn 应 abort（wasAborted=false，status='error'）
  | { type: 'role_marker_detected'; marker: string; textPreview: string }

export interface ClaudeStreamHandler {
  // 处理一个已 parse 的 stream-json 事件，返回派生事件
  handle(event: StreamJsonEvent): ClaudeStreamEvent[]
}

// 匹配行首的 ## user / ## assistant 角色标记。
// 限定行首 + 严格的 ## 前缀，降低误报（正文里讨论 "user 概念" 不应命中）。
// open-design 的 createRoleMarkerGuard 做了跨 chunk 流式检测；我们 v1 先做
// 整 text 检测（在 assistant 整消息级别查），简单可靠。
const ROLE_MARKER_RE = /^#{1,3}\s*(user|assistant|system)\s*$/im

export function createClaudeStreamHandler(): ClaudeStreamHandler {
  return {
    handle(event: StreamJsonEvent): ClaudeStreamEvent[] {
      const derived: ClaudeStreamEvent[] = []

      // 只在 assistant 整消息的 text block 里检测 role marker
      // （stream_event 级的 text_delta 检测留给 P4 流式版）
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type !== 'text' || typeof block.text !== 'string') continue
          const match = ROLE_MARKER_RE.exec(block.text)
          if (match) {
            derived.push({
              type: 'role_marker_detected',
              marker: match[1],
              textPreview: block.text.slice(0, 120)
            })
          }
        }
      }

      // raw 永远透传（保持 IPC 向后兼容）
      derived.push({ type: 'raw', event })
      return derived
    }
  }
}
