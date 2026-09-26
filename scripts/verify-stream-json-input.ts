// v1 spec S2 风险闸：验证 claude --input-format stream-json 是否接受 image content block。
// 用法：tsx scripts/verify-stream-json-input.ts
// 通过判定：stdout 至少出现一条 type=assistant 的事件，且全程无 fatal stderr。
// 失败判定：claude 报错 / 超时 30s 没有 assistant 事件 → 前端要临时禁用图片粘贴。

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// 1×1 透明 PNG 的 base64（最小可发图片，避免大文件影响测试速度）
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const sessionId = randomUUID()
const child = spawn('claude', [
  '--print',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--session-id', sessionId,
  '--permission-mode', 'default'
], { stdio: ['pipe', 'pipe', 'pipe'] })

const userEvent = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      { type: 'text', text: '这张图是什么颜色？一句话回答。' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 } }
    ]
  }
}
child.stdin.write(JSON.stringify(userEvent) + '\n')
child.stdin.end()

let stdoutBuf = ''
let sawAssistant = false
let assistantText = ''
const stderrChunks: string[] = []

child.stdout.on('data', (chunk: Buffer) => {
  stdoutBuf += chunk.toString()
  const lines = stdoutBuf.split('\n')
  stdoutBuf = lines.pop()!
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const evt = JSON.parse(line) as { type: string; message?: { content?: Array<{ type: string; text?: string }> } }
      if (evt.type === 'assistant') {
        sawAssistant = true
        const blocks = evt.message?.content ?? []
        for (const b of blocks) if (b.type === 'text' && b.text) assistantText += b.text
      }
    } catch {
      console.warn('[verify] 跳过非 JSON 行:', line.slice(0, 120))
    }
  }
})

child.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString()
  stderrChunks.push(text)
})

const timer = setTimeout(() => {
  console.error('❌ 超时 30s 未收到 assistant 事件，触发 S2 风险闸')
  child.kill('SIGTERM')
  process.exit(2)
}, 30_000)

child.on('close', (code) => {
  clearTimeout(timer)
  const stderr = stderrChunks.join('').trim()
  if (sawAssistant) {
    console.log('✅ claude 接受 image content block，sessionId =', sessionId)
    console.log('   assistant 回复（节选）:', assistantText.slice(0, 160))
    if (stderr) console.warn('   stderr（仅警告）:', stderr.slice(0, 240))
    process.exit(0)
  } else {
    console.error('❌ claude 未返回 assistant 事件，exitCode =', code)
    if (stderr) console.error('   stderr:', stderr.slice(0, 480))
    process.exit(1)
  }
})
