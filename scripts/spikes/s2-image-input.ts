/**
 * Spike S2: 验证 --input-format stream-json 含 image block 的 schema
 *
 * 目标：确认 claude-code stream-json 输入是否支持 image content block
 * 方法：echo 一个包含 image content block 的 JSON 给 claude，看 stdout 是否正常
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 创建一个 1x1 红色像素 PNG 的 base64
const MINI_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

const testDir = join(tmpdir(), 'spike-s2-test')
mkdirSync(testDir, { recursive: true })

// 测试 1: stream-json input 含 image block (Anthropic SDK 格式)
const inputWithImage = JSON.stringify({
  type: 'user',
  content: [
    { type: 'text', text: 'describe this image briefly in 5 words' },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: MINI_PNG_B64
      }
    }
  ]
})

console.log('=== S2 测试: stream-json 含 image block ===')
console.log('输入 JSON:', inputWithImage.slice(0, 150) + '...')

try {
  const child = spawn('claude', [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--print'
  ], {
    cwd: testDir,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

  child.stdin.write(inputWithImage + '\n')
  child.stdin.end()

  const timeout = setTimeout(() => {
    child.kill('SIGTERM')
  }, 30000)

  child.on('close', (code) => {
    clearTimeout(timeout)
    console.log(`\nExit code: ${code}`)
    if (stderr) console.log('Stderr:', stderr.slice(0, 500))
    if (stdout) {
      console.log('Stdout (前 500 字符):', stdout.slice(0, 500))
      // 尝试解析 stream-json
      try {
        const lines = stdout.trim().split('\n').filter(Boolean)
        console.log(`\n收到 ${lines.length} 行 stream-json 输出`)
        for (const line of lines.slice(0, 5)) {
          const parsed = JSON.parse(line)
          console.log(`  type=${parsed.type} ${parsed.content_block_type || ''}`)
        }
        console.log('\n✅ S2 PASS: image block 被 claude-code 接受')
      } catch (e: any) {
        console.log('解析输出失败:', e.message)
        // 如果不是 JSON 但有输出，可能仍算部分通过
        if (stdout.includes('image') || stdout.includes('red') || stdout.includes('pixel')) {
          console.log('⚠️ S2 PARTIAL: 有输出但非 stream-json 格式')
        } else {
          console.log('❌ S2 FAIL: 输出不可解析')
        }
      }
    } else {
      console.log('❌ S2 FAIL: 无输出')
    }
  })
} catch (e: any) {
  console.log('❌ S2 FAIL:', e.message)
}
