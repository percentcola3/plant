import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

// homedir 在 session-id.ts 里作为 ~/.claude 根路径基础。改成临时 dir。
const fakeHome = vi.hoisted(() => ({ path: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => fakeHome.path }
})

import {
  findSessionJsonlAnywhere,
  findSessionJsonlForResume,
  projectHashFor,
  sessionJsonlPath,
  sessionJsonlPathForReplay
} from './session-id'

function claudeProjectsDir(): string {
  return join(fakeHome.path, '.claude', 'projects')
}

function writeJsonlAt(projectPath: string, sessionId: string, content: string): string {
  const hash = projectHashFor(projectPath)
  const dir = join(claudeProjectsDir(), hash)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${sessionId}.jsonl`)
  writeFileSync(p, content, 'utf-8')
  return p
}

beforeEach(async () => {
  fakeHome.path = await mkdtemp(join(tmpdir(), 'session-id-migrate-'))
})
afterEach(async () => {
  await fs.rm(fakeHome.path, { recursive: true, force: true }).catch(() => undefined)
})

describe('findSessionJsonlAnywhere', () => {
  it('按 SID 找到 Claude 私有 cwd-key 下的 jsonl，不依赖应用计算规则', () => {
    const sid = 'abcd-1234'
    const dir = join(claudeProjectsDir(), 'private-key-format-vNext')
    mkdirSync(dir, { recursive: true })
    const written = join(dir, `${sid}.jsonl`)
    writeFileSync(written, '{}\n', 'utf-8')

    expect(findSessionJsonlAnywhere(sid)).toBe(written)
  })

  it('空文件不算命中', () => {
    const sid = 'sid-empty'
    writeJsonlAt('/some/cwd', sid, '')
    expect(findSessionJsonlAnywhere(sid)).toBeNull()
  })

  it('projects 根不存在时返回 null', () => {
    expect(findSessionJsonlAnywhere('sid-not-exist')).toBeNull()
  })

  it('同 SID 有多个私有目录副本时选择最近更新的一份', () => {
    const sid = 'sid-duplicated'
    const olderDir = join(claudeProjectsDir(), 'private-key-old')
    const newerDir = join(claudeProjectsDir(), 'private-key-new')
    mkdirSync(olderDir, { recursive: true })
    mkdirSync(newerDir, { recursive: true })
    const older = join(olderDir, `${sid}.jsonl`)
    const newer = join(newerDir, `${sid}.jsonl`)
    writeFileSync(older, '{"old":true}\n', 'utf-8')
    writeFileSync(newer, '{"new":true}\n', 'utf-8')
    utimesSync(older, new Date(1_000), new Date(1_000))
    utimesSync(newer, new Date(2_000), new Date(2_000))

    expect(findSessionJsonlAnywhere(sid)).toBe(newer)
    expect(findSessionJsonlForResume('/unrelated/current/cwd', sid)).toBe(newer)
  })
})

describe('sessionJsonlPathForReplay', () => {
  it('优先使用当前 cwd 下的会话历史', () => {
    const sid = 'sid-replay-current'
    const currentCwd = '/Users/dev/proj/current'
    const current = writeJsonlAt(currentCwd, sid, '{"current":true}\n')
    writeJsonlAt('/Users/dev/proj/old', sid, '{"old":true}\n')

    expect(sessionJsonlPathForReplay(currentCwd, sid)).toBe(current)
  })

  it('当前 cwd 无历史时回退到 Claude Code 的实际归档路径', () => {
    const sid = 'sid-replay-fallback'
    const privateDir = join(claudeProjectsDir(), 'unknown-private-cwd-key')
    mkdirSync(privateDir, { recursive: true })
    const archived = join(privateDir, `${sid}.jsonl`)
    writeFileSync(archived, '{"history":true}\n', 'utf-8')

    expect(sessionJsonlPathForReplay('/Users/dev/proj/current', sid)).toBe(archived)
    expect(existsSync(archived)).toBe(true)
  })

  it('首轮尚无历史时返回当前 cwd 的预期路径', () => {
    const sid = 'sid-replay-new'
    const currentCwd = '/Users/dev/proj/current'

    expect(sessionJsonlPathForReplay(currentCwd, sid)).toBe(sessionJsonlPath(currentCwd, sid))
  })
})
