import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveZgIndexProgress, parseZgOutput, parseZgStatus, zgErrorCode, countMatchedBy, prepareZgIndexWorkspace, type ZgHit } from './zg-search'

// fixture 来自 spike 实测（zg 0.2.2，/tmp/zg-spike 语料，默认 agent markdown 输出）
const SPIKE_OUTPUT = `query groups (1):
Q1 [primary]: resource index build claude
hits: 5

#1 matchedBy=fts+vector src/paths.ts:4-6
4\tfunction resourceIndexesRoot(): string {

#2 matchedBy=fts+vector docs/12-project-rules.md:97-107
heading: Build and Test Instructions
heading_level: 3
scope: Project Rules (AGENTS.md)::What to Put in Project Rules
97\t### Build and Test Instructions
98\t
99\t- npm test

#3 matchedBy=fts+vector docs/README.md:1-6
heading: Grok Build User Guide
heading_level: 1
1\t# Grok Build User Guide

#4 matchedBy=fts+vector docs/04-slash-commands.md:382-387
heading: \`/import-claude\`
heading_level: 3
scope: Slash Commands::Other
382\t### \`/import-claude\`

#5 matchedBy=fts+vector src/service.ts:28
28\ttype ResourceIndexReason = 'first-import' | 'git-update' | 'checkout-change' | 'missing-index' | 'manual'
`

describe('parseZgOutput', () => {
  it('解析 spike 实测输出：路径/行号/matchedBy/heading/scope/内容行', () => {
    const hits = parseZgOutput(SPIKE_OUTPUT)
    expect(hits).toHaveLength(5)

    expect(hits[0]).toMatchObject({
      relPath: 'src/paths.ts',
      lineStart: 4,
      lineEnd: 6,
      matchedBy: 'fts+vector'
    })
    expect(hits[0].lines).toEqual(['function resourceIndexesRoot(): string {'])
    expect(hits[0].heading).toBeUndefined()

    expect(hits[1]).toMatchObject({
      relPath: 'docs/12-project-rules.md',
      lineStart: 97,
      lineEnd: 107,
      heading: 'Build and Test Instructions',
      scope: 'Project Rules (AGENTS.md)::What to Put in Project Rules'
    })
    expect(hits[1].lines).toHaveLength(3)
    expect(hits[1].lines[2]).toBe('- npm test')

    // 标题里的特殊字符（反引号/冒号）不破坏解析
    expect(hits[3].heading).toBe('`/import-claude`')
    expect(hits[4].lineStart).toBe(28)
    expect(hits[4].lineEnd).toBe(28)
  })

  it('汇总 matchedBy 计数，供日志核对 zg 命中通道', () => {
    const hits = parseZgOutput(SPIKE_OUTPUT)
    expect(countMatchedBy(hits)).toBe('fts+vector=5')
    expect(countMatchedBy([
      { relPath: 'a.md', lineStart: 1, lineEnd: 1, matchedBy: 'fts', lines: [] },
      { relPath: 'b.md', lineStart: 1, lineEnd: 1, matchedBy: 'vector', lines: [] },
      { relPath: 'c.md', lineStart: 1, lineEnd: 1, matchedBy: 'fts+vector', lines: [] }
    ])).toBe('fts=1,vector=1,fts+vector=1')
  })

  it('空输出与无 hits 输出返回空数组', () => {
    expect(parseZgOutput('')).toEqual([])
    expect(parseZgOutput('query groups (1):\nQ1 [primary]: x\nhits: 0\n')).toEqual([])
  })

  it('容忍行尾 CR（跨平台输出）', () => {
    const hits = parseZgOutput('#1 matchedBy=fts a.md:1-2\r\n1\thello\r\n')
    expect(hits).toHaveLength(1)
    expect(hits[0].lines).toEqual(['hello'])
  })
})

describe('zgErrorCode', () => {
  it('提取 stderr 中的结构化错误码', () => {
    const stderr = [
      'Error: No zvec-grep index found for this workspace',
      'Code: ZVEC_GREP.ENGINE.SERVICE.WORKSPACE_INDEX_NOT_FOUND',
      'Details:'
    ].join('\n')
    expect(zgErrorCode(stderr)).toBe('ZVEC_GREP.ENGINE.SERVICE.WORKSPACE_INDEX_NOT_FOUND')
  })

  it('无错误码时返回 null', () => {
    expect(zgErrorCode('some random failure')).toBeNull()
  })
})

describe('deriveZgIndexProgress（构建期流式阶段，参照 zg TUI）', () => {
  it('扫描阶段', () => {
    expect(deriveZgIndexProgress('tip Default indexing...\nScanning files...')).toEqual({ phase: 'scan' })
  })

  it('模型准备 + 下载百分比（仅首次）', () => {
    const p1 = deriveZgIndexProgress('Scanning files...\nPreparing local/potion-code-16m-v2')
    expect(p1.phase).toBe('model')
    expect(p1.detail).toBe('local/potion-code-16m-v2')
    const p2 = deriveZgIndexProgress('Downloading local/potion-code-16m-v2 · 42% · 13 MiB/32 MiB')
    expect(p2.phase).toBe('model')
    expect(p2.percent).toBe(42)
  })

  it('索引完成 + 汇总（千分位）', () => {
    const p = deriveZgIndexProgress([
      'Scanning files...',
      'Indexing complete',
      'files\t2,323 scanned, 12 added, 0 modified, 0 retried, 2,311 unchanged, 0 deleted, 0 failed',
      'entities\t27,406'
    ].join('\n'))
    expect(p).toMatchObject({ phase: 'done', filesTotal: 2323, entities: 27406 })
  })

  it('增量场景无模型下载：scan → done 直达', () => {
    const p = deriveZgIndexProgress('Scanning files...\nIndexing complete\nfiles\t68 scanned, 68 added')
    expect(p.phase).toBe('done')
    expect(p.filesTotal).toBe(68)
  })
})

describe('parseZgStatus', () => {
  it('解析就绪状态：覆盖率/实体/模型', () => {
    const out = [
      '✓ Workspace index is ready',
      '  Coverage    ████████████████████ 100%  68 / 68 files',
      '  Entities    1,078',
      '  Queue       0 pending · 0 failed',
      '  Embedding   local/potion-code-16m-v2'
    ].join('\n')
    const stats = parseZgStatus(out)
    expect(stats).toMatchObject({
      filesIndexed: 68,
      filesTotal: 68,
      entities: 1078,
      embedding: 'local/potion-code-16m-v2',
      queuePending: 0
    })
    expect(stats?.failed).toBeUndefined()
  })

  it('解析后台增强队列（daemon 补向量中）', () => {
    const out = [
      '✓ Workspace index is ready',
      '  Coverage    ██████████ 100%  2,323 / 2,323 files',
      '  Entities    27,406',
      '  Queue       1,204 pending · 0 failed'
    ].join('\n')
    expect(parseZgStatus(out)).toMatchObject({ queuePending: 1204, filesTotal: 2323 })
  })

  it('解析失败状态 + 结构化错误码（如 LOCK.BUSY 并发锁冲突）', () => {
    const out = [
      '✗ Workspace index failed',
      '  Coverage    ████████████████████ 100%  2,323 / 2,323 files',
      '  Queue       0 pending · 0 failed',
      '  Error       ZVEC_GREP.ENGINE.LOCK.BUSY'
    ].join('\n')
    const stats = parseZgStatus(out)
    expect(stats).toMatchObject({ failed: true, errorCode: 'ZVEC_GREP.ENGINE.LOCK.BUSY' })
  })
})

// 类型守护：确保 ZgHit 的可选字段语义（heading/scope 无值时为 undefined）
describe('ZgHit shape', () => {
  it('无 heading/scope 的代码命中字段为 undefined', () => {
    const hits: ZgHit[] = parseZgOutput('#1 matchedBy=vector src/a.ts:10-12\n10\tconst x = 1\n')
    expect(hits[0].heading).toBeUndefined()
    expect(hits[0].scope).toBeUndefined()
  })
})

describe('prepareZgIndexWorkspace', () => {
  it('555 的 git 池上能创建 .zvec-grep 锁目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'zg-prepare-'))
    writeFileSync(join(root, 'README.md'), 'x')
    chmodSync(join(root, 'README.md'), 0o444)
    chmodSync(root, 0o555)
    expect(() => mkdirSync(join(root, '.zvec-grep'))).toThrow(/EACCES|permission denied/i)

    prepareZgIndexWorkspace(root)
    const lock = join(root, '.zvec-grep', 'locks', 'home.readers', 'probe')
    mkdirSync(lock, { recursive: true })
    expect(statSync(lock).isDirectory()).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })
})
