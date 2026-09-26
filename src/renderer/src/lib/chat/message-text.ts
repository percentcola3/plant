// 从消息 content blocks 中抽出可复制的纯文本：
// 只取 text block，跳过 thinking / tool_use / tool_result / image。
// 用结构类型避免对 store 的循环依赖。
type AnyBlock = { type: string; text?: string }

export function extractMessageText(blocks: AnyBlock[]): string {
  return blocks
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('\n\n')
    .trim()
}
