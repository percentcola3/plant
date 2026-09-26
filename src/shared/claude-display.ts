export type ToolStatus = 'pending' | 'done' | 'error'

export function isZvecSearchTool(name: string): boolean {
  return name === 'mcp__zvec-grep__zvec_grep_search'
    || name === 'zvec_grep_search'
    || name === 'zg_search'
}

// 单个分段：label = 段标题，body = 等宽展示文本
export type DetailSection = {
  label: string
  body: string
  // 'code' 用等宽字体；'plain' 用正文字体
  kind?: 'code' | 'plain'
}

export type FormattedToolCall = {
  title: string
  summary: string
  resultSummary: string
  // 结构化的"技术详情"分段列表（替代原来的 detail: string）
  sections: DetailSection[]
  // 该次调用是否因为缺少人工授权而失败（claude code "requires approval" 类错误）
  needsApproval?: boolean
  approvalHint?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isStructuredJsonText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return false
  }
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function pathSummary(input: Record<string, unknown>): string {
  return stringValue(input.file_path)
    || stringValue(input.path)
    || stringValue(input.notebook_path)
    || stringValue(input.url)
}

function commandSummary(input: Record<string, unknown>): string {
  const command = stringValue(input.command)
  return command.length > 80 ? `${command.slice(0, 80)}...` : command
}

// 识别 claude code 的"需要人工授权"错误：
//   - "requires approval"（multi-op Bash、敏感命令）
//   - "Permission denied" / "Permission to use ... has not been granted"
//   - "command requires permission"
function detectApprovalError(content: unknown): { matched: boolean; hint: string } {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(b => b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string'
          ? (b as Record<string, unknown>).text as string
          : '').join('\n')
      : ''
  if (!text) return { matched: false, hint: '' }

  if (/requires approval/i.test(text)) {
    return { matched: true, hint: '此命令含多步操作（如管道、&& 链），需要你在 UI 中确认授权后继续执行。' }
  }
  if (/Permission to use .* has not been granted/i.test(text)
      || /command requires permission/i.test(text)) {
    return { matched: true, hint: '当前会话没有该工具的使用权限，需要你在 UI 中确认授权后继续执行。' }
  }
  if (/^Permission denied$/i.test(text.trim())) {
    return { matched: true, hint: '系统级权限被拒（与 claude 无关）：检查文件 chmod / sudo 等。' }
  }
  return { matched: false, hint: '' }
}

function summarizeResult(
  result: { content: unknown; isError?: boolean } | undefined,
  status: ToolStatus
): string {
  if (status === 'pending') return '正在处理...'
  if (!result) return status === 'error' ? '执行失败。' : '已完成。'
  if (result.isError) {
    const ap = detectApprovalError(result.content)
    if (ap.matched) return '需要人工授权才能执行。'
    return '执行失败。'
  }

  const content = result.content
  if (typeof content !== 'string') return '已收到结构化结果，详情已隐藏。'
  if (isStructuredJsonText(content)) return '已收到结构化结果，详情已隐藏。'
  const firstLine = content.trim().split('\n').find(Boolean)
  if (!firstLine) return '已完成。'
  return firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine
}

export function sanitizeClaudeText(text: string): string {
  return isStructuredJsonText(text)
    ? 'Claude 返回了一段结构化数据，已隐藏。'
    : text
}

// 把 result.content 转为可展示文本（处理字符串 / 数组 block / 对象多种形态）
function resultContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // claude tool_result 的 content 经常是 [{type:'text',text:'...'}, ...]
    const parts: string[] = []
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>
        if (typeof b.text === 'string') parts.push(b.text)
        else parts.push(compactJson(b))
      } else {
        parts.push(String(block))
      }
    }
    return parts.join('\n')
  }
  if (content && typeof content === 'object') return compactJson(content)
  return String(content ?? '')
}

// ─── 各工具的 detail sections 构造器 ───────────────────────────

type Builder = (
  data: Record<string, unknown>,
  result: { content: unknown; isError?: boolean } | undefined
) => DetailSection[]

const BUILDERS: Record<string, Builder> = {
  Read: (data, result) => {
    const sections: DetailSection[] = [
      { label: '文件', body: pathSummary(data) || '(未指定)', kind: 'code' }
    ]
    const offset = data.offset, limit = data.limit
    if (typeof offset === 'number' || typeof limit === 'number') {
      sections.push({ label: '范围', body: `offset=${offset ?? 0}, limit=${limit ?? '全部'}`, kind: 'plain' })
    }
    if (result) {
      sections.push({
        label: result.isError ? '错误' : '内容',
        body: resultContentToText(result.content),
        kind: 'code'
      })
    }
    return sections
  },

  Write: (data, result) => {
    const sections: DetailSection[] = [
      { label: '文件', body: pathSummary(data) || '(未指定)', kind: 'code' }
    ]
    const content = stringValue(data.content)
    if (content) sections.push({ label: '写入内容', body: content, kind: 'code' })
    if (result?.isError) {
      sections.push({ label: '错误', body: resultContentToText(result.content), kind: 'code' })
    }
    return sections
  },

  Edit: (data, result) => {
    const sections: DetailSection[] = [
      { label: '文件', body: pathSummary(data) || '(未指定)', kind: 'code' }
    ]
    const oldStr = stringValue(data.old_string)
    const newStr = stringValue(data.new_string)
    if (oldStr) sections.push({ label: '原文', body: oldStr, kind: 'code' })
    if (newStr) sections.push({ label: '替换为', body: newStr, kind: 'code' })
    if (data.replace_all === true) {
      sections.push({ label: '选项', body: '全部替换', kind: 'plain' })
    }
    if (result) {
      sections.push({
        label: result.isError ? '错误' : '结果',
        body: resultContentToText(result.content),
        kind: 'code'
      })
    }
    return sections
  },

  MultiEdit: (data, result) => {
    const sections: DetailSection[] = [
      { label: '文件', body: pathSummary(data) || '(未指定)', kind: 'code' }
    ]
    const edits = Array.isArray(data.edits) ? data.edits : []
    if (edits.length > 0) {
      sections.push({ label: '编辑数', body: `${edits.length} 处修改`, kind: 'plain' })
      const detail = edits.map((e, i) => {
        const r = asRecord(e)
        return `[${i + 1}]\n  原文: ${stringValue(r.old_string).slice(0, 200)}\n  替换为: ${stringValue(r.new_string).slice(0, 200)}`
      }).join('\n\n')
      sections.push({ label: '编辑详情', body: detail, kind: 'code' })
    }
    if (result) {
      sections.push({
        label: result.isError ? '错误' : '结果',
        body: resultContentToText(result.content),
        kind: 'code'
      })
    }
    return sections
  },

  Bash: (data, result) => {
    const sections: DetailSection[] = []
    const cmd = stringValue(data.command)
    if (cmd) sections.push({ label: '命令', body: cmd, kind: 'code' })
    const desc = stringValue(data.description)
    if (desc) sections.push({ label: '说明', body: desc, kind: 'plain' })
    if (result) {
      sections.push({
        label: result.isError ? '错误输出' : '输出',
        body: resultContentToText(result.content) || '(无输出)',
        kind: 'code'
      })
    }
    return sections
  },

  Grep: (data, result) => {
    const sections: DetailSection[] = []
    const pattern = stringValue(data.pattern)
    if (pattern) sections.push({ label: '正则', body: pattern, kind: 'code' })
    const path = stringValue(data.path)
    if (path) sections.push({ label: '路径', body: path, kind: 'code' })
    const opts: string[] = []
    if (data['-i']) opts.push('忽略大小写')
    if (data['-n']) opts.push('显示行号')
    if (data.multiline) opts.push('多行模式')
    if (typeof data.glob === 'string') opts.push(`glob=${data.glob}`)
    if (typeof data.type === 'string') opts.push(`type=${data.type}`)
    if (opts.length > 0) sections.push({ label: '选项', body: opts.join(' / '), kind: 'plain' })
    if (result) {
      sections.push({
        label: result.isError ? '错误' : '命中',
        body: resultContentToText(result.content) || '(无命中)',
        kind: 'code'
      })
    }
    return sections
  },

  Glob: (data, result) => {
    const sections: DetailSection[] = []
    const pattern = stringValue(data.pattern)
    if (pattern) sections.push({ label: '模式', body: pattern, kind: 'code' })
    const path = stringValue(data.path)
    if (path) sections.push({ label: '路径', body: path, kind: 'code' })
    if (result) {
      sections.push({
        label: result.isError ? '错误' : '匹配文件',
        body: resultContentToText(result.content) || '(无匹配)',
        kind: 'code'
      })
    }
    return sections
  },

  LS: (data, result) => {
    const sections: DetailSection[] = [
      { label: '目录', body: pathSummary(data) || '(未指定)', kind: 'code' }
    ]
    if (Array.isArray(data.ignore) && data.ignore.length > 0) {
      sections.push({ label: '忽略', body: (data.ignore as unknown[]).join(' / '), kind: 'plain' })
    }
    if (result) {
      sections.push({
        label: result.isError ? '错误' : '内容',
        body: resultContentToText(result.content),
        kind: 'code'
      })
    }
    return sections
  },

  TodoWrite: (data) => {
    const todos = Array.isArray(data.todos) ? data.todos : []
    if (todos.length === 0) return [{ label: '任务', body: '(空)', kind: 'plain' }]
    const lines = todos.map((t, i) => {
      const r = asRecord(t)
      const status = stringValue(r.status) || 'pending'
      const mark = status === 'completed' ? '✓' : status === 'in_progress' ? '▶' : '○'
      const subject = stringValue(r.subject) || stringValue(r.content) || '(无标题)'
      return `${mark} [${i + 1}] ${subject}`
    })
    return [{ label: '任务清单', body: lines.join('\n'), kind: 'plain' }]
  },

  WebFetch: (data, result) => {
    const sections: DetailSection[] = []
    const url = stringValue(data.url)
    if (url) sections.push({ label: 'URL', body: url, kind: 'code' })
    const prompt = stringValue(data.prompt)
    if (prompt) sections.push({ label: '提取要求', body: prompt, kind: 'plain' })
    if (result) {
      sections.push({
        label: result.isError ? '错误' : '响应',
        body: resultContentToText(result.content),
        kind: 'code'
      })
    }
    return sections
  },

  WebSearch: (data, result) => {
    const sections: DetailSection[] = []
    const query = stringValue(data.query)
    if (query) sections.push({ label: '查询', body: query, kind: 'code' })
    if (result) {
      sections.push({
        label: result.isError ? '错误' : '结果',
        body: resultContentToText(result.content),
        kind: 'code'
      })
    }
    return sections
  }
}

function fallbackSections(
  input: unknown,
  result: { content: unknown; isError?: boolean } | undefined
): DetailSection[] {
  const sections: DetailSection[] = [
    { label: '输入', body: compactJson(input), kind: 'code' }
  ]
  if (result) {
    sections.push({
      label: result.isError ? '错误' : '结果',
      body: resultContentToText(result.content),
      kind: 'code'
    })
  }
  return sections
}

export function formatClaudeToolCall(
  name: string,
  input: unknown,
  result: { content: unknown; isError?: boolean } | undefined,
  status: ToolStatus
): FormattedToolCall {
  const data = asRecord(input)
  const path = pathSummary(data)
  let title = `执行 ${name}`
  let summary = path || '已调用工具'

  if (isZvecSearchTool(name)) {
    title = 'zvec-grep 检索'
    const queries = Array.isArray(data.queries)
      ? data.queries.map(stringValue).filter(Boolean).join(' / ')
      : stringValue(data.queries)
    summary = [stringValue(data.query) || queries, stringValue(data.root)].filter(Boolean).join(' · ') || '检索项目内容'
  } else if (name === 'Read') {
    title = '阅读文件'
  } else if (name === 'Write') {
    title = '写入文件'
  } else if (name === 'Edit' || name === 'MultiEdit') {
    title = '修改文件'
  } else if (name === 'Bash') {
    title = '执行命令'
    summary = commandSummary(data) || summary
  } else if (name === 'Grep') {
    title = '搜索文本'
    summary = stringValue(data.pattern) || summary
  } else if (name === 'Glob') {
    title = '查找文件'
    summary = stringValue(data.pattern) || summary
  } else if (name === 'LS') {
    title = '列出目录'
  } else if (name === 'TodoWrite') {
    title = '更新任务清单'
    const todos = Array.isArray(data.todos) ? data.todos.length : 0
    summary = todos > 0 ? `${todos} 个任务` : '任务清单已更新'
  } else if (name === 'WebFetch' || name === 'WebSearch') {
    title = '检索资料'
    summary = stringValue(data.query) || path || summary
  } else if (name === 'Skill') {
    title = '调用 skill'
    summary = stringValue(data.skill) || stringValue(data.name) || stringValue(data.skill_name) || '未知 skill'
  }

  const builder = BUILDERS[name]
  const sections = builder ? builder(data, result) : fallbackSections(input, result)

  const approval = result?.isError ? detectApprovalError(result.content) : { matched: false, hint: '' }

  return {
    title,
    summary,
    resultSummary: isZvecSearchTool(name) ? summarizeZvecResult(result, status) : summarizeResult(result, status),
    sections,
    needsApproval: approval.matched,
    approvalHint: approval.matched ? approval.hint : undefined
  }
}

function summarizeZvecResult(
  result: { content: unknown; isError?: boolean } | undefined,
  status: ToolStatus
): string {
  if (status === 'error' || result?.isError) return '检索失败，展开查看原因'
  if (status === 'pending') return '正在检索…'
  if (!result) return '未收到检索结果'
  const text = resultContentToText(result.content).trim()
  if (text === '没有匹配内容') return '未找到匹配内容'
  // 不从检索到的正文猜测命中数；不同引擎版本的原始输出保留在详情中。
  return '检索完成，展开查看结果'
}
