import { describe, expect, it } from 'vitest'
import { formatClaudeToolCall, sanitizeClaudeText } from './claude-display'

describe('formatClaudeToolCall · 标题 / 摘要', () => {
  it('Read 标题 + 文件路径作为摘要', () => {
    const r = formatClaudeToolCall('Read', { file_path: 'docs/prd/foo.md' }, undefined, 'pending')
    expect(r.title).toBe('阅读文件')
    expect(r.summary).toBe('docs/prd/foo.md')
  })

  it('Bash 标题 + 命令前 80 字作为摘要', () => {
    const r = formatClaudeToolCall('Bash', { command: 'ls -la' }, undefined, 'pending')
    expect(r.title).toBe('执行命令')
    expect(r.summary).toBe('ls -la')
  })

  it('TodoWrite 标题 + 任务数量', () => {
    const r = formatClaudeToolCall('TodoWrite', { todos: [{ subject: 'a' }, { subject: 'b' }] }, undefined, 'done')
    expect(r.title).toBe('更新任务清单')
    expect(r.summary).toBe('2 个任务')
  })
})

describe('formatClaudeToolCall · resultSummary', () => {
  it('结构化 result 隐藏详情（让用户去 sections 看）', () => {
    const r = formatClaudeToolCall('SomeTool', { id: 1 }, { content: { raw: { nested: true } } }, 'done')
    expect(r.resultSummary).toBe('已收到结构化结果，详情已隐藏。')
  })

  it('isError 时给出友好提示', () => {
    const r = formatClaudeToolCall('Bash', { command: 'x' }, { content: 'oops', isError: true }, 'error')
    expect(r.resultSummary).toBe('执行失败。')
  })
})

describe('formatClaudeToolCall · sections（结构化技术详情）', () => {
  it('Read：含 文件 + 内容 段', () => {
    const r = formatClaudeToolCall(
      'Read',
      { file_path: 'a.md' },
      { content: 'line1\nline2', isError: false },
      'done'
    )
    const labels = r.sections.map(s => s.label)
    expect(labels).toContain('文件')
    expect(labels).toContain('内容')
    expect(r.sections.find(s => s.label === '内容')?.body).toContain('line1')
  })

  it('Bash：含 命令 + 输出 段；不再返回原始 JSON 字符串', () => {
    const r = formatClaudeToolCall(
      'Bash',
      { command: 'ls', description: 'list' },
      { content: 'a\nb\nc' },
      'done'
    )
    const labels = r.sections.map(s => s.label)
    expect(labels).toContain('命令')
    expect(labels).toContain('说明')
    expect(labels).toContain('输出')
    // 不应再有"input/result"字面（旧 JSON 模式）
    const blob = r.sections.map(s => s.body).join('\n')
    expect(blob).not.toMatch(/"input"\s*:/)
  })

  it('Edit：含 文件 / 原文 / 替换为', () => {
    const r = formatClaudeToolCall(
      'Edit',
      { file_path: 'x.ts', old_string: 'foo', new_string: 'bar' },
      undefined,
      'pending'
    )
    const labels = r.sections.map(s => s.label)
    expect(labels).toEqual(expect.arrayContaining(['文件', '原文', '替换为']))
  })

  it('TodoWrite：渲染为可读清单（含状态 mark）', () => {
    const r = formatClaudeToolCall(
      'TodoWrite',
      { todos: [
        { subject: '任务 A', status: 'completed' },
        { subject: '任务 B', status: 'in_progress' },
        { subject: '任务 C', status: 'pending' }
      ] },
      undefined,
      'done'
    )
    const body = r.sections[0].body
    expect(body).toContain('✓')
    expect(body).toContain('▶')
    expect(body).toContain('○')
    expect(body).toContain('任务 A')
  })

  it('未知工具走 fallback，仍能展示输入', () => {
    const r = formatClaudeToolCall('SomeNewTool', { foo: 'bar' }, { content: 'ok' }, 'done')
    expect(r.sections[0].label).toBe('输入')
    expect(r.sections[0].body).toContain('"foo"')
  })

  it('result.content 是数组（claude tool_result block 数组）→ 提取 text 拼接', () => {
    const r = formatClaudeToolCall(
      'Bash',
      { command: 'echo' },
      { content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] },
      'done'
    )
    const out = r.sections.find(s => s.label === '输出')?.body
    expect(out).toContain('first')
    expect(out).toContain('second')
  })
})

describe('formatClaudeToolCall · 需要人工授权识别', () => {
  it('"requires approval" 错误 → needsApproval=true + 友好 hint', () => {
    const r = formatClaudeToolCall(
      'Bash',
      { command: 'ls "/x/y" && echo done' },
      { content: 'This Bash command contains multiple operations. The following part requires approval: ls "/x/y"', isError: true },
      'error'
    )
    expect(r.needsApproval).toBe(true)
    expect(r.approvalHint).toContain('多步操作')
    expect(r.approvalHint).not.toContain('TUI')
    expect(r.approvalHint).not.toContain('拆成')
    expect(r.resultSummary).toBe('需要人工授权才能执行。')
  })

  it('"Permission to use ... has not been granted" → needsApproval=true', () => {
    const r = formatClaudeToolCall(
      'Bash',
      { command: 'foo' },
      { content: 'Permission to use Bash has not been granted', isError: true },
      'error'
    )
    expect(r.needsApproval).toBe(true)
    expect(r.approvalHint).toContain('权限')
  })

  it('普通错误 → needsApproval=false', () => {
    const r = formatClaudeToolCall(
      'Bash',
      { command: 'foo' },
      { content: 'command not found: foo', isError: true },
      'error'
    )
    expect(r.needsApproval).toBe(false)
    expect(r.approvalHint).toBeUndefined()
    expect(r.resultSummary).toBe('执行失败。')
  })

  it('数组形式 result.content（claude tool_result block 数组）也能识别', () => {
    const r = formatClaudeToolCall(
      'Bash',
      { command: 'foo' },
      { content: [{ type: 'text', text: 'requires approval: ls' }], isError: true },
      'error'
    )
    expect(r.needsApproval).toBe(true)
  })
})

describe('sanitizeClaudeText', () => {
  it('hides pure JSON text blocks', () => {
    expect(sanitizeClaudeText('{"type":"result","data":{"ok":true}}')).toBe('Claude 返回了一段结构化数据，已隐藏。')
  })

  it('keeps normal user-facing text unchanged', () => {
    expect(sanitizeClaudeText('我需要你确认页面名称。')).toBe('我需要你确认页面名称。')
  })
})


describe('zvec-grep retrieval display', () => {
  it.each(['mcp__zvec-grep__zvec_grep_search', 'zvec_grep_search', 'zg_search'])('recognizes %s', name => {
    const formatted = formatClaudeToolCall(name, { queries: ['订单', '退款'], root: '.external/docs' }, undefined, 'pending')
    expect(formatted.title).toBe('zvec-grep 检索')
    expect(formatted.summary).toBe('订单 / 退款 · .external/docs')
    expect(formatted.resultSummary).toBe('正在检索…')
  })

  it.each(['没有匹配内容', [{ type: 'text', text: '没有匹配内容' }]])('recognizes empty native results', content => {
    expect(formatClaudeToolCall('zg_search', {}, { content }, 'done').resultSummary).toBe('未找到匹配内容')
  })

  it('preserves MCP text results in details without guessing hit counts from source text', () => {
    const content = [{ type: 'text', text: 'freshness: fresh\nsource excerpt: hits: 42' }]
    const formatted = formatClaudeToolCall('zvec_grep_search', { query: '订单' }, { content }, 'done')
    expect(formatted.resultSummary).toBe('检索完成，展开查看结果')
    expect(formatted.sections.some(section => section.body.includes('source excerpt: hits: 42'))).toBe(true)
  })

  it('keeps failures and missing results distinct from successful searches', () => {
    expect(formatClaudeToolCall('zg_search', {}, { content: '索引未就绪', isError: true }, 'done').resultSummary).toContain('检索失败')
    expect(formatClaudeToolCall('zg_search', {}, undefined, 'error').resultSummary).toContain('检索失败')
    expect(formatClaudeToolCall('zg_search', {}, undefined, 'done').resultSummary).toBe('未收到检索结果')
  })
})
