import type { AgentMessage } from './agent-events'

// 部分链路下模型的推理内容常以普通 text block 输出（stream-json 里 thinking block
// 反而是空的，只剩 signature）。为了做到「任务结束只看结论」：
// 每个 assistant 组（连续 assistant 消息）内，最后一条带非空 text 的消息视为
// 「结论」，正常渲染 markdown；其余消息里的 text 都是过程旁白，按折叠块展示。
// 组内没有任何带 text 的消息时，整组 text 均按旁白处理。
export function findConclusionUuids(
  groups: Array<{ role: AgentMessage['role']; messages: AgentMessage[] }>
): Set<string> {
  const ids = new Set<string>()
  for (const group of groups) {
    if (group.role !== 'assistant') continue
    for (let i = group.messages.length - 1; i >= 0; i--) {
      const message = group.messages[i]
      if (message.content.some(block => block.type === 'text' && block.text.trim())) {
        ids.add(message.uuid)
        break
      }
    }
  }
  return ids
}

// 组内全部过程文本（thinking 块 + 非结论消息的 text 块），按消息顺序收集，
// 供组级合并成一个折叠思考块。结论消息的 text 不算过程。
export function collectProcessTexts(messages: AgentMessage[], conclusionUuids: Set<string>): string[] {
  const texts: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block.type === 'thinking' && block.text.trim()) {
        texts.push(block.text)
      } else if (block.type === 'text' && !conclusionUuids.has(message.uuid) && block.text.trim()) {
        texts.push(block.text)
      }
    }
  }
  return texts
}
