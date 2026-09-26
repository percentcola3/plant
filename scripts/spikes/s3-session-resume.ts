/**
 * Spike S3: 验证 --session-id + --resume 兼容性
 *
 * 目标：确认我们自己生成的 UUID 作为 session-id 能否让 claude 正确落位 JSONL
 *       同 id --resume 是否能续上历史
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), 'spike-s3-test')
mkdirSync(testDir, { recursive: true })

// 用 execSync 初始化 git
try { execSync('git init', { cwd: testDir, stdio: 'pipe' }) } catch {}

const sessionId = randomUUID()
console.log(`=== S3 测试: session-id + resume ===`)
console.log(`Session ID: ${sessionId}`)

// 预测 JSONL 路径 (基于 S1 结论: path → - 替换 /)
const projectDir = testDir.replace(/\//g, '-')
const expectedJsonl = join(homedir(), '.claude', 'projects', projectDir, `${sessionId}.jsonl`)
console.log(`预期 JSONL 路径: ${expectedJsonl}`)

// Turn 1: 发一条消息
const msg1 = JSON.stringify({
  type: 'user',
  content: [{ type: 'text', text: 'remember the number 42. just reply "ok"' }]
})

function runTurn(msg: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: testDir, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.stdin.write(msg + '\n')
    child.stdin.end()
    const timeout = setTimeout(() => { child.kill('SIGTERM') }, 30000)
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ stdout, stderr, code })
    })
  })
}

async function main() {
  // Turn 1
  console.log('\n--- Turn 1: 首次消息 ---')
  const r1 = await runTurn(msg1, [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--session-id', sessionId,
    '--verbose',
    '--print'
  ])
  console.log(`Exit: ${r1.code}`)
  console.log(`Stdout (前200): ${(r1.stdout || '').slice(0, 200)}`)
  if (r1.stderr) console.log(`Stderr (前200): ${r1.stderr.slice(0, 200)}`)

  // 检查 JSONL 是否存在
  console.log('\n--- 检查 JSONL 文件 ---')
  if (existsSync(expectedJsonl)) {
    console.log('✅ JSONL 文件存在!')
    const content = readFileSync(expectedJsonl, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    console.log(`JSONL 行数: ${lines.length}`)
    for (const line of lines.slice(0, 3)) {
      try {
        const parsed = JSON.parse(line)
        console.log(`  type=${parsed.type} role=${parsed.role || ''}`)
      } catch {
        console.log(`  (parse error)`)
      }
    }
  } else {
    // 也看看有没有其他路径
    const projBase = join(homedir(), '.claude', 'projects')
    if (existsSync(projBase)) {
      const dirs = readdirSync(projBase).filter(d => d.includes('spike-s3'))
      console.log(`❌ 预期路径不存在。找到相关目录: ${dirs.join(', ')}`)
      // 在这些目录里找 session 文件
      for (const d of dirs) {
        const dpath = join(projBase, d)
        const files = readdirSync(dpath)
        console.log(`  ${d}/: ${files.join(', ')}`)
      }
    } else {
      console.log('❌ projects 目录不存在')
    }
  }

  // Turn 2: resume
  console.log('\n--- Turn 2: resume 续上 ---')
  const msg2 = JSON.stringify({
    type: 'user',
    content: [{ type: 'text', text: 'what number did I tell you to remember? reply just the number' }]
  })
  const r2 = await runTurn(msg2, [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--session-id', sessionId,
    '--resume',
    '--verbose',
    '--print'
  ])
  console.log(`Exit: ${r2.code}`)
  console.log(`Stdout (前500): ${(r2.stdout || '').slice(0, 500)}`)

  // 检查输出是否包含 42
  const has42 = r2.stdout.includes('42')
  console.log(`\n${has42 ? '✅' : '❌'} S3 ${has42 ? 'PASS' : 'FAIL'}: resume 后 ${has42 ? '记住了' : '未记住'} 数字 42`)

  // 清理
  try { rmSync(testDir, { recursive: true }) } catch {}
  // 也清理 JSONL（但保留目录）
  try { if (existsSync(expectedJsonl)) rmSync(expectedJsonl) } catch {}
}

main().catch(e => {
  console.log('❌ S3 FAIL:', e)
  try { rmSync(testDir, { recursive: true }) } catch {}
})
