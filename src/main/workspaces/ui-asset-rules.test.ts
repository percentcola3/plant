import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { syncCursorRulesFromSystemDoc } from './ui-asset-rules'

const CURSOR_REL = '.cursor/rules/ui-client-ui-assets.mdc'

describe('syncCursorRulesFromSystemDoc', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'ui-asset-rules-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const write = (rel: string, body: string) => fs.writeFile(join(dir, rel), body, 'utf-8')
  const read = (rel: string) => fs.readFile(join(dir, rel), 'utf-8')
  const exists = (rel: string) => fs.stat(join(dir, rel)).then(() => true).catch(() => false)

  it('system.md 存在 → 镜像成 cursor mdc（alwaysApply + 原文 body）', async () => {
    await write('system.md', '# 项目约束\n\n只用 theme token，禁止裸色值。\n')
    await syncCursorRulesFromSystemDoc(dir)
    const mdc = await read(CURSOR_REL)
    expect(mdc).toContain('alwaysApply: true')
    expect(mdc).toContain('# 项目约束')
    expect(mdc).toContain('只用 theme token，禁止裸色值。')
  })

  it('不创建 / 修改 system.md 本身', async () => {
    await write('system.md', '# 头\n\n正文。\n')
    await syncCursorRulesFromSystemDoc(dir)
    expect(await read('system.md')).toBe('# 头\n\n正文。\n')
  })

  it('system.md 不存在 → 删除镜像、不建任何文件', async () => {
    await syncCursorRulesFromSystemDoc(dir)
    expect(await exists(CURSOR_REL)).toBe(false)
    expect(await exists('system.md')).toBe(false)
  })

  it('system.md 由有到无 → 镜像被删除', async () => {
    await write('system.md', '# 头\n')
    await syncCursorRulesFromSystemDoc(dir)
    expect(await exists(CURSOR_REL)).toBe(true)

    await fs.rm(join(dir, 'system.md'))
    await syncCursorRulesFromSystemDoc(dir)
    expect(await exists(CURSOR_REL)).toBe(false)
  })

  it('二次 sync 幂等：内容字节一致', async () => {
    await write('system.md', '# 头\n\n规则。\n')
    await syncCursorRulesFromSystemDoc(dir)
    const first = await read(CURSOR_REL)
    await syncCursorRulesFromSystemDoc(dir)
    expect(await read(CURSOR_REL)).toBe(first)
  })
})
