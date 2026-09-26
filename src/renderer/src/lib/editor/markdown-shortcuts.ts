export type MarkdownShortcutId = 'emphasis' | 'heading' | 'quote' | 'table' | 'chart'

export type MarkdownShortcutInsertion = {
  text: string
  selectionStart: number
  selectionEnd: number
}

const PLACEHOLDERS: Record<MarkdownShortcutId, string> = {
  emphasis: '重点内容',
  heading: '标题',
  quote: '引用内容',
  table: '',
  chart: ''
}

export function buildMarkdownShortcutInsertion(
  id: MarkdownShortcutId,
  selectedText = ''
): MarkdownShortcutInsertion {
  const selected = selectedText.trim()
  if (id === 'emphasis') {
    const inner = selected || PLACEHOLDERS.emphasis
    return withSelection(`==${inner}==`, 2, inner.length)
  }

  if (id === 'heading') {
    const inner = selected || PLACEHOLDERS.heading
    return withSelection(`## ${inner}`, 3, inner.length)
  }

  if (id === 'quote') {
    const inner = selectedText || PLACEHOLDERS.quote
    const text = inner
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
    return withSelection(text, 2, inner.length)
  }

  if (id === 'table') {
    const text = [
      '| 列 1 | 列 2 | 列 3 |',
      '|---|---|---|',
      '| 内容 | 内容 | 内容 |'
    ].join('\n')
    return {
      text,
      selectionStart: text.length,
      selectionEnd: text.length
    }
  }

  const text = [
    '```mermaid',
    'flowchart LR',
    '  A[开始] --> B[处理]',
    '  B --> C[完成]',
    '```'
  ].join('\n')
  return {
    text,
    selectionStart: text.length,
    selectionEnd: text.length
  }
}

function withSelection(text: string, start: number, length: number): MarkdownShortcutInsertion {
  return {
    text,
    selectionStart: start,
    selectionEnd: start + length
  }
}
