#!/usr/bin/env node
// fake-claude: 模拟 claude CLI，用于 spawn-turn 集成测试
// 读取 stdin 第一行作为用户消息，按预设脚本输出 stream-json 行
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const printMode = args.includes('--print')

// 解析 --session-id 和 --resume
let sessionId = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--session-id' && args[i + 1]) sessionId = args[i + 1]
  if (args[i] === '--resume' && args[i + 1]) sessionId = args[i + 1]
}

if (!sessionId) sessionId = 'fake-session-001'

// 读取 stdin
let input = ''
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const sessionIdLine = sessionId

  // 输出 hook 事件
  writeLine({ type: 'system', subtype: 'init', session_id: sessionIdLine, uuid: fakeUuid(0) })

  // 输出 assistant 回复
  writeLine({
    type: 'assistant',
    message: {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: 'fake',
      content: [{ type: 'text', text: `收到: ${input.trim().slice(0, 100)}` }],
      stop_reason: 'end_turn'
    },
    session_id: sessionIdLine,
    uuid: fakeUuid(1)
  })

  // 输出 result
  writeLine({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 100,
    result: `Echo: ${input.trim().slice(0, 50)}`,
    session_id: sessionIdLine,
    uuid: fakeUuid(2)
  })

  process.exit(0)
})

function writeLine(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

let _seq = 0
function fakeUuid(idx: number): string {
  return `fake-uuid-${idx}-${++_seq}`
}
