import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { PAGE_TEXT_SCRIPT } from './extract'

function extract(body: string, candidates: Array<{ text: string; visible?: boolean }> = []) {
  return runInNewContext(PAGE_TEXT_SCRIPT, { document: {
    body: { innerText: body },
    querySelectorAll: () => candidates.map(c => ({ innerText: c.text, getClientRects: () => c.visible === false ? [] : [1], closest: () => null }))
  } })
}
describe('project webpage text extraction', () => {
  it('prefers loaded article text over navigation and excludes hidden articles', () => {
    const article = '正文内容'.repeat(40)
    expect(extract('导航 广告 页脚', [{ text: article }, { text: 'hidden'.repeat(100), visible: false }]).text).toBe(article)
  })
  it('falls back to body text and cleans blank lines', () => {
    expect(extract('账户\n\n\n\n已登录\t\n内容').text).toBe('账户\n\n已登录\n内容')
  })
  it('caps text and reports truncation', () => {
    const result = extract('a'.repeat(60001))
    expect(result.text).toHaveLength(60000)
    expect(result.truncated).toBe(true)
  })
})
