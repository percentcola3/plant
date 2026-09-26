import type { ExternalRefCheckout } from './types'

export function normalizeExternalVisibleDirs(input: readonly string[] | null | undefined): string[] {
  if (!input || input.length === 0) return []

  const cleaned = input
    .map((item) => normalizeVisibleDir(item))
    .filter((item): item is string => item !== null)

  const sorted = [...new Set(cleaned)].sort((a, b) => {
    const byDepth = a.split('/').length - b.split('/').length
    return byDepth || a.localeCompare(b)
  })

  const result: string[] = []
  for (const dir of sorted) {
    if (result.some((parent) => dir === parent || dir.startsWith(`${parent}/`))) continue
    result.push(dir)
  }
  return result
}

function normalizeVisibleDir(input: string): string | null {
  const value = input.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!value || value === '.') return null
  const parts = value.split('/')
  if (parts.includes('..')) throw new Error('目录不能包含 ..')
  if (parts.some((part) => !part || part === '.')) throw new Error(`目录不合法：${input}`)
  return parts.join('/')
}

export function normalizeExternalCheckout(checkout: ExternalRefCheckout): ExternalRefCheckout {
  if (!checkout) throw new Error('checkout 不能为空')
  const type = checkout.type
  if (type !== 'branch' && type !== 'tag' && type !== 'commit') {
    throw new Error('checkout 类型必须是 branch、tag 或 commit')
  }
  const value = typeof checkout.value === 'string' ? checkout.value.trim() : ''
  if (!value) throw new Error('checkout 不能为空')
  if (value.includes('\0')) throw new Error('checkout 不能包含空字符')
  if (value.split('/').includes('..')) throw new Error('checkout 不能包含 ..')
  return { type, value }
}

export function parseExternalCheckoutInput(input: string): ExternalRefCheckout {
  const raw = input.trim()
  if (!raw) throw new Error('checkout 不能为空')
  const match = raw.match(/^(branch|tag|commit)\s*:\s*(.+)$/i)
  const checkout: ExternalRefCheckout = match
    ? { type: match[1].toLowerCase() as ExternalRefCheckout['type'], value: match[2] }
    : { type: 'branch', value: raw }
  return normalizeExternalCheckout(checkout)
}

export function formatExternalCheckout(checkout: ExternalRefCheckout | undefined): string {
  if (!checkout) return '默认分支'
  const label = checkout.type === 'branch' ? '分支' : checkout.type === 'tag' ? '标签' : '提交'
  return `${label}:${checkout.value}`
}
