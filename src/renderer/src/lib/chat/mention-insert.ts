type TextToken = { type: 'text'; text: string }

function isTextToken(token: { type: string }): token is TextToken {
  return token.type === 'text' && typeof (token as TextToken).text === 'string'
}

/**
 * 把输入里的 `@query` 触发段换成选中的 mention token。
 * 必须用勾选前的 token 列表做替换，不能先改 DOM 再决定是否回写：
 * 整段 `@query` 被删掉后文本节点会脱离，DOM 插入会失败，若再把旧文本拼回去就会变成普通字而不是 chip。
 */
export function insertTokenAtMentionTrigger<T extends { type: string }>(
  tokens: T[],
  query: string,
  token: T
): T[] {
  const trigger = `@${query}`
  const result: T[] = []
  let replaced = false

  for (const item of tokens) {
    if (!replaced && isTextToken(item)) {
      const index = item.text.lastIndexOf(trigger)
      if (index !== -1) {
        const before = item.text.slice(0, index)
        const after = item.text.slice(index + trigger.length)
        if (before) result.push({ type: 'text', text: before } as T)
        result.push(token)
        if (after) result.push({ type: 'text', text: after } as T)
        replaced = true
        continue
      }
    }
    result.push(item)
  }

  if (!replaced) result.push(token)
  return result
}
