import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/workspace-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { askpassServer, cacheKeyForPrompt } from './askpass-server'

describe('cacheKeyForPrompt', () => {
  it('区分同一 host 的 username 和 password prompt', () => {
    expect(cacheKeyForPrompt("Username for 'https://git.example.internal': "))
      .toBe('git.example.internal:username')
    expect(cacheKeyForPrompt("Password for 'https://user@git.example.internal': "))
      .toBe('git.example.internal:password')
  })
})

describe('AskpassServer cancel/respond', () => {
  // singleton + module 级 pendingId 单调增；用响应顺序兜底而不是猜 id
  afterEach(async () => {
    await askpassServer.stop()
  })

  async function postPrompt(url: string, token: string, prompt: string): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'X-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    })
  }

  // 通过试错广撒"取消所有 1..N"；这样测试不依赖于 singleton 的内部 counter
  function cancelAll(): void {
    for (let id = 1; id <= 100; id += 1) askpassServer.cancel(id)
  }
  function respondAll(answer: string): void {
    for (let id = 1; id <= 100; id += 1) askpassServer.respond(id, answer)
  }

  it('取消时返回 499 + 空 body（不能把 "cancelled" 当 stdout 喂给 git）', async () => {
    const { url, token } = await askpassServer.start()
    const p = postPrompt(url, token, "Username for 'https://example.com': ")
    await new Promise((r) => setTimeout(r, 30))
    cancelAll()
    const res = await p
    expect(res.status).toBe(499)
    const text = await res.text()
    expect(text).toBe('')
    expect(text).not.toContain('cancelled')
  })

  it('正常 respond 返回 200 + answer', async () => {
    const { url, token } = await askpassServer.start()
    const p = postPrompt(url, token, "Username for 'https://example.com': ")
    await new Promise((r) => setTimeout(r, 30))
    respondAll('alice@example.com')
    const res = await p
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('alice@example.com')
  })
})
