export type ClaudeInteractionOption = {
  label: string
  description?: string
}

export type ClaudeInteractionQuestion = {
  id: string
  label: string
  question: string
  options: ClaudeInteractionOption[]
  multiSelect: boolean
}

export type ClaudeInteraction = {
  title: string
  questions: ClaudeInteractionQuestion[]
}

const INTERACTION_TOOL_NAMES = new Set([
  'request_user_input',
  'AskUserQuestion',
  'ask_user_question',
  'user_input',
  'UserInput'
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readBool(value: unknown): boolean {
  return value === true
}

function parseOptions(value: unknown): ClaudeInteractionOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => {
      if (typeof raw === 'string') return { label: raw }
      const item = asRecord(raw)
      const label = readString(item.label ?? item.title ?? item.value)
      if (!label) return null
      const description = readString(item.description ?? item.detail ?? item.help)
      return description ? { label, description } : { label }
    })
    .filter((item): item is ClaudeInteractionOption => !!item)
}

function parseQuestion(raw: unknown, index: number): ClaudeInteractionQuestion | null {
  const item = asRecord(raw)
  const id = readString(item.id) || `question_${index + 1}`
  const label = readString(item.header ?? item.label ?? item.title) || `问题 ${index + 1}`
  const question = readString(item.question ?? item.prompt ?? item.text)
  if (!question) return null
  return {
    id,
    label,
    question,
    options: parseOptions(item.options),
    multiSelect: readBool(item.multiSelect ?? item.multi_select)
  }
}

export function parseClaudeInteraction(name: string, input: unknown): ClaudeInteraction | null {
  if (!INTERACTION_TOOL_NAMES.has(name)) return null
  const data = asRecord(input)
  const rawQuestions = Array.isArray(data.questions)
    ? data.questions
    : [data]
  const questions = rawQuestions
    .map((question, index) => parseQuestion(question, index))
    .filter((question): question is ClaudeInteractionQuestion => !!question)

  if (questions.length === 0) return null
  return {
    title: readString(data.title) || 'Claude 需要你补充信息',
    questions
  }
}

export function buildInteractionResponse(
  interaction: ClaudeInteraction,
  answers: Record<string, string[]>,
  note: string
): string {
  const lines: string[] = []
  for (const question of interaction.questions) {
    const values = (answers[question.id] ?? []).map(v => v.trim()).filter(Boolean)
    if (values.length === 0) continue
    lines.push(`${question.label}：${values.join('、')}`)
  }
  const cleanedNote = note.trim()
  if (cleanedNote) lines.push(`补充说明：${cleanedNote}`)
  return lines.join('\n')
}

export function isClaudeInteractionAnswerResult(
  interaction: ClaudeInteraction,
  content: unknown
): boolean {
  const text = interactionResultText(content).trim()
  if (!text) return false
  if (/(^|\n)\s*补充说明\s*[:：]/.test(text)) return true
  return interaction.questions.some((question) => {
    const label = question.label.trim()
    if (!label) return false
    return new RegExp(`(^|\\n)\\s*${escapeRegExp(label)}\\s*[:：]`).test(text)
  })
}

function interactionResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item
      const record = asRecord(item)
      return readString(record.text ?? record.content)
    }).filter(Boolean).join('\n')
  }
  const record = asRecord(content)
  const text = readString(record.text ?? record.content)
  return text || (Object.keys(record).length > 0 ? JSON.stringify(record) : '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
