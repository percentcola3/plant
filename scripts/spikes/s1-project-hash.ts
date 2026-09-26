/**
 * Spike S1: 验证 claude-code 的 projectHashFor 规则
 *
 * 目标：确定 claude-code 如何将项目路径转换为 ~/.claude/projects/<hash> 中的目录名
 * 方法：在测试项目跑一次 claude，观察实际生成的目录名，反推 hash 规则
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const CLAUDE_DIR = join(homedir(), '.claude', 'projects')
// 创建临时测试项目
const testDir = join(tmpdir(), 'spike-s1-test-project')
mkdirSync(testDir, { recursive: true })

// 先检查现有 projects 目录结构
console.log('=== 现有 ~/.claude/projects/ 目录 ===')
if (existsSync(CLAUDE_DIR)) {
  const dirs = readdirSync(CLAUDE_DIR).filter(d => {
    try { return statSync(join(CLAUDE_DIR, d)).isDirectory() } catch { return false }
  })
  console.log(`共 ${dirs.length} 个项目目录:`)
  dirs.slice(0, 20).forEach(d => console.log(`  ${d}`))
  if (dirs.length > 20) console.log(`  ... 还有 ${dirs.length - 20} 个`)
} else {
  console.log('目录不存在')
}

// 读取当前项目的 JSONL 文件来确定 hash
const currentProject = '/Users/didi/Code/ui-client'
console.log(`\n=== 当前项目: ${currentProject} ===`)

// 尝试不同的 hash 方法
function tryHashes(path: string): Record<string, string> {
  const results: Record<string, string> = {}
  // 方法 1: SHA-256 of path
  results['sha256-full'] = createHash('sha256').update(path).digest('hex')
  // 方法 2: SHA-256 truncated
  results['sha256-16'] = createHash('sha256').update(path).digest('hex').slice(0, 16)
  // 方法 3: SHA-256 truncated to 12
  results['sha256-12'] = createHash('sha256').update(path).digest('hex').slice(0, 12)
  // 方法 4: base64url encoded SHA-256 truncated
  results['b64url-16'] = createHash('sha256').update(path).digest('base64url').slice(0, 16)
  // 方法 5: MD5
  results['md5'] = createHash('md5').update(path).digest('hex')
  // 方法 6: SHA-1
  results['sha1'] = createHash('sha1').update(path).digest('hex')
  // 方法 7: 带换行符
  results['sha256-nl'] = createHash('sha256').update(path + '\n').digest('hex')
  // 方法 8: SHA-256 of lowercase path
  results['sha256-lower'] = createHash('sha256').update(path.toLowerCase()).digest('hex')
  return results
}

const hashes = tryHashes(currentProject)
console.log('\n可能的 hash 值:')
Object.entries(hashes).forEach(([method, hash]) => {
  const dir = join(CLAUDE_DIR, hash)
  const exists = existsSync(dir)
  console.log(`  ${method}: ${hash} ${exists ? '✅ EXISTS' : '❌'}`)
})

// 尝试匹配：看哪个 hash 目录存在
const matchedDir = Object.entries(hashes).find(([, hash]) => existsSync(join(CLAUDE_DIR, hash)))
if (matchedDir) {
  console.log(`\n✅ 匹配方法: ${matchedDir[0]} → ${matchedDir[1]}`)
  const dir = join(CLAUDE_DIR, matchedDir[1])
  const files = readdirSync(dir)
  console.log(`目录内容: ${files.join(', ')}`)
}

// 对比：看看实际 projects 目录里哪些目录名格式匹配我们的 hash
console.log('\n=== 对比 projects 目录名格式 ===')
if (existsSync(CLAUDE_DIR)) {
  const dirs = readdirSync(CLAUDE_DIR)
  // 尝试反推：已知项目路径，看哪个目录匹配
  const knownProjects = [
    '/Users/didi/Code/ui-client',
    '/Users/didi/Code/ui-2-code',
  ]
  for (const proj of knownProjects) {
    const projHashes = tryHashes(proj)
    const match = Object.entries(projHashes).find(([, h]) => dirs.includes(h))
    if (match) {
      console.log(`项目 ${proj} → hash 方法 ${match[0]}: ${match[1]}`)
    } else {
      console.log(`项目 ${proj} → 未找到匹配的 hash 目录`)
    }
  }
}

// 检查是否 claude 有 --print 命令可以获取 project hash
try {
  const helpOut = execSync('claude --help 2>&1', { encoding: 'utf-8' })
  const lines = helpOut.split('\n').filter(l => l.includes('project') || l.includes('hash'))
  if (lines.length > 0) {
    console.log('\n=== claude --help 中 project/hash 相关 ===')
    lines.forEach(l => console.log(l))
  }
} catch {}

// 尝试在测试项目执行 claude 并查看生成的目录
console.log('\n=== 尝试在新测试项目中执行 claude ===')
const testHashes = tryHashes(testDir)
console.log(`测试目录: ${testDir}`)

// 创建 .git 以让 claude 识别为项目
try { execSync('git init', { cwd: testDir, stdio: 'pipe' }) } catch {}

// 用 claude 的 --print 模式做最简单的交互
try {
  const result = execSync(
    `echo '{"type":"user","content":[{"type":"text","text":"say hi"}]}' | claude --input-format stream-json --output-format stream-json --print 2>/dev/null || true`,
    { cwd: testDir, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  console.log('claude 输出 (前200字符):', result.slice(0, 200))
} catch (e: any) {
  console.log('claude 执行失败:', e.message?.slice(0, 200))
}

// 检查测试目录是否有新的 hash 目录
console.log('\n=== 测试项目 hash 目录 ===')
for (const [method, hash] of Object.entries(testHashes)) {
  if (existsSync(join(CLAUDE_DIR, hash))) {
    console.log(`✅ ${method}: ${hash} - 目录已创建!`)
    const files = readdirSync(join(CLAUDE_DIR, hash))
    console.log(`  内容: ${files.join(', ')}`)
  }
}

// 额外：查看是否有以 - 结尾的目录（path encoding）
if (existsSync(CLAUDE_DIR)) {
  const dirs = readdirSync(CLAUDE_DIR)
  const specialDirs = dirs.filter(d => d.includes('-') && d.length < 20)
  if (specialDirs.length > 0) {
    console.log('\n短/特殊目录名:')
    specialDirs.forEach(d => console.log(`  ${d}`))
  }
}

console.log('\n=== SPIKE S1 完成 ===')

// 清理
try { rmSync(testDir, { recursive: true }) } catch {}
