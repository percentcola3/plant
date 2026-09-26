export type ChatInputToken =
  | { type: 'text'; text: string }
  | { type: 'chip'; alias: string; path: string }
  | { type: 'image' }
  | { type: 'fileref'; relPath: string }
  | { type: 'resource'; alias: string; path: string }

export function expandInputTokens(tokens: ChatInputToken[]): string {
  return tokens.map(token => {
    if (token.type === 'text') return token.text
    if (token.type === 'chip') return `@${token.alias}`
    if (token.type === 'fileref') return `@${token.relPath}`
    if (token.type === 'resource') return `@${token.path}`
    return ''
  }).join('')
}

export function displayInputTokens(tokens: ChatInputToken[]): string {
  return tokens.map(token => {
    if (token.type === 'text') return token.text
    if (token.type === 'chip') return `@${token.alias}`
    if (token.type === 'fileref') return `@${token.relPath}`
    if (token.type === 'resource') return `@${token.alias}`
    return ''
  }).join('')
}

/** 只从用户实际选择的文件/资源生成范围，不把元素和网页当作磁盘路径。 */
export function formatRetrievalPriority(tokens: ChatInputToken[]): string {
  const paths = [...new Set(tokens.flatMap(token => {
    if (token.type === 'fileref') return [token.relPath]
    if (token.type === 'resource' && !token.path.startsWith('webpage:')) return [token.path]
    return []
  }).filter(path => path.trim()))]
  if (!paths.length) return ''
  return '\n\n## 本轮 @ 引用的优先检索范围\n'
    + paths.map(path => `- ${JSON.stringify(path)}`).join('\n')
    + '\n是否需要检索由你判断，不要求调用工具。若需要，先在以上文件或目录中查找；已知文件可直接 Read。只有未找到相关信息时，才扩展到其他已挂载的 .external 知识库；用户明确限定范围时不得扩展。zvec-grep 的 root 使用索引目录，不要将单个文件作为 root；无法按文件限定检索时先直接读取选中文件。'
}
