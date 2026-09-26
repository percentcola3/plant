import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// 隔离 homedir：session-id.ts 用 homedir() 定位 ~/.claude/projects
const fakeHome = vi.hoisted(() => ({ path: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => fakeHome.path }
})

import {
  createWorkspaceSessionId,
  projectHashFor,
  recoverDeadWorkspaceSessionBinding
} from './session-id'

// isClaudeSessionId 校验 UUID 格式（version 1-5 + variant 89ab）
const DEAD_SID = '11111111-2222-3333-8444-555555555555'
const GOOD_OLD_SID = '22222222-3333-4444-a555-666666666666'
const GOOD_NEW_SID = 'aaaaaaaa-bbbb-1ccc-9ddd-eeeeeeeeeeee'
const OTHER_FEATURE_SID = '33333333-4444-5555-b666-777777777777'

const WORK_DIR = '/tmp/ws-project/features/demo'
const SCOPE = 'feature:features/demo'

function scopeBindingFile(projectPath: string, scope: string): string {
  const key = createHash('sha1').update(scope.replace(/\\/g, '/').replace(/^\/+/, '')).digest('hex').slice(0, 16)
  return join(projectPath, '.workspace', 'workspace-sessions', `${key}.session-id`)
}

function writeBinding(projectPath: string, scope: string, sid: string): void {
  const file = scopeBindingFile(projectPath, scope)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, sid + '\n', 'utf-8')
}

function writeJsonl(workDir: string, sid: string, mtime: Date): void {
  const dir = join(fakeHome.path, '.claude', 'projects', projectHashFor(workDir))
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${sid}.jsonl`)
  writeFileSync(p, '{"type":"user"}\n', 'utf-8')
  utimesSync(p, mtime, mtime)
}

let projectRoot = ''

beforeEach(async () => {
  fakeHome.path = await mkdtemp(join(tmpdir(), 'session-id-recover-'))
  projectRoot = await mkdtemp(join(tmpdir(), 'ws-recover-project-'))
})
afterEach(async () => {
  await fs.rm(fakeHome.path, { recursive: true, force: true }).catch(() => undefined)
  await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => undefined)
})

describe('recoverDeadWorkspaceSessionBinding', () => {
  it('不会把用户主动创建且尚未发送首条消息的新会话回退到旧历史', () => {
    const newSessionId = createWorkspaceSessionId(projectRoot, SCOPE)
    const homeFile = join(projectRoot, '.workspace', 'home-session-id')
    mkdirSync(join(homeFile, '..'), { recursive: true })
    writeFileSync(homeFile, GOOD_OLD_SID + '\n', 'utf-8')
    writeJsonl(WORK_DIR, GOOD_OLD_SID, new Date())

    expect(recoverDeadWorkspaceSessionBinding(projectRoot, WORK_DIR, SCOPE)).toBeNull()
    expect(readFileSync(scopeBindingFile(projectRoot, SCOPE), 'utf-8').trim()).toBe(newSessionId)
  })

  it('回填同 workDir 下最近的有数据会话', () => {
    const binding = scopeBindingFile(projectRoot, SCOPE)
    mkdirSync(join(binding, '..'), { recursive: true })
    writeFileSync(binding, DEAD_SID + '\n', 'utf-8')

    // 已知会话集合：其它 scope 的绑定文件登记了两个真实会话
    writeBinding(projectRoot, 'feature:features/other', GOOD_NEW_SID)
    const homeFile = join(projectRoot, '.workspace', 'home-session-id')
    mkdirSync(join(homeFile, '..'), { recursive: true })
    writeFileSync(homeFile, GOOD_OLD_SID + '\n', 'utf-8')

    // 同 workDir 两个 jsonl：GOOD_NEW 更新
    writeJsonl(WORK_DIR, GOOD_OLD_SID, new Date('2026-08-16T10:00:00Z'))
    writeJsonl(WORK_DIR, GOOD_NEW_SID, new Date('2026-08-17T10:00:00Z'))

    const recovered = recoverDeadWorkspaceSessionBinding(projectRoot, WORK_DIR, SCOPE)
    expect(recovered).toBe(GOOD_NEW_SID)
    expect(readFileSync(binding, 'utf-8').trim()).toBe(GOOD_NEW_SID)
  })

  it('健康绑定（jsonl 存在）不动', () => {
    const binding = scopeBindingFile(projectRoot, SCOPE)
    mkdirSync(join(binding, '..'), { recursive: true })
    writeFileSync(binding, GOOD_NEW_SID + '\n', 'utf-8')
    writeJsonl(WORK_DIR, GOOD_NEW_SID, new Date())
    const homeFile = join(projectRoot, '.workspace', 'home-session-id')
    mkdirSync(join(homeFile, '..'), { recursive: true })
    writeFileSync(homeFile, GOOD_NEW_SID + '\n', 'utf-8')

    expect(recoverDeadWorkspaceSessionBinding(projectRoot, WORK_DIR, SCOPE)).toBeNull()
    expect(readFileSync(binding, 'utf-8').trim()).toBe(GOOD_NEW_SID)
  })

  it('死绑定但 workDir 没有任何已知会话的 jsonl 时返回 null', () => {
    const binding = scopeBindingFile(projectRoot, SCOPE)
    mkdirSync(join(binding, '..'), { recursive: true })
    writeFileSync(binding, DEAD_SID + '\n', 'utf-8')

    // OTHER_FEATURE_SID 有 jsonl 但不在已知会话集合里（不该被回填）
    writeJsonl(WORK_DIR, OTHER_FEATURE_SID, new Date())

    expect(recoverDeadWorkspaceSessionBinding(projectRoot, WORK_DIR, SCOPE)).toBeNull()
    expect(readFileSync(binding, 'utf-8').trim()).toBe(DEAD_SID)
  })
})
