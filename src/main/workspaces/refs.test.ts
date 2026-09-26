import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addRef, readRefs, removeRef, updateRef, writeRefs } from './refs'

let dir: string

async function writeJson(rel: string, value: unknown): Promise<void> {
  const abs = join(dir, rel)
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, JSON.stringify(value))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'workspace-refs-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('readRefs', () => {
  it('refs.json 不存在 → 空数组', async () => {
    expect(await readRefs(dir)).toEqual([])
  })

  it('正常读多条引用', async () => {
    await writeJson('.ui-client/refs.json', [
      { alias: 'saas-uikit', externalRefId: 'kb01', addedAt: '2026-06-09T00:00:00.000Z' },
      {
        alias: '产品规范',
        externalRefId: 'kb02',
        addedAt: '2026-06-09T00:00:00.000Z',
        visibleDirs: ['docs', 'docs/api', '/research/'],
        usageNote: '  只参考当前版本的接口规范。  '
      }
    ])
    const r = await readRefs(dir)
    expect(r).toHaveLength(2)
    expect(r.map((b) => b.alias)).toEqual(['saas-uikit', '产品规范'])
    expect(r[1].visibleDirs).toEqual(['docs', 'research'])
    expect(r[1].usageNote).toBe('只参考当前版本的接口规范。')
  })

  it('损坏 JSON → 空数组', async () => {
    await fs.mkdir(join(dir, '.ui-client'), { recursive: true })
    await fs.writeFile(join(dir, '.ui-client/refs.json'), '{not json')
    expect(await readRefs(dir)).toEqual([])
  })

  it('非数组 → 空数组', async () => {
    await writeJson('.ui-client/refs.json', { wrong: 'shape' })
    expect(await readRefs(dir)).toEqual([])
  })

  it('字段缺失的条目被过滤掉', async () => {
    await writeJson('.ui-client/refs.json', [
      { alias: 'good', externalRefId: 'k', addedAt: 't' },
      { alias: 'bad-no-id' },
      'not-an-object'
    ])
    const r = await readRefs(dir)
    expect(r).toHaveLength(1)
    expect(r[0].alias).toBe('good')
  })
})

describe('writeRefs / addRef / removeRef', () => {
  it('writeRefs 整体覆写', async () => {
    await writeRefs(dir, [{ alias: 'a', externalRefId: 'r1', addedAt: 't' }])
    expect(await readRefs(dir)).toHaveLength(1)
    await writeRefs(dir, [])
    expect(await readRefs(dir)).toEqual([])
  })

  it('addRef 新增', async () => {
    await addRef(dir, { alias: 'a', externalRefId: 'r1', addedAt: 't' })
    expect(await readRefs(dir)).toHaveLength(1)
  })

  it('addRef 同对幂等', async () => {
    await addRef(dir, { alias: 'a', externalRefId: 'r1', addedAt: 't' })
    await addRef(dir, { alias: 'a', externalRefId: 'r1', addedAt: 't2' })
    expect(await readRefs(dir)).toHaveLength(1)
  })

  it('addRef 同 alias 异 id 抛 ALIAS_CONFLICT', async () => {
    await addRef(dir, { alias: 'a', externalRefId: 'r1', addedAt: 't' })
    await expect(addRef(dir, { alias: 'a', externalRefId: 'r2', addedAt: 't' }))
      .rejects.toMatchObject({ code: 'ALIAS_CONFLICT' })
  })

  it('removeRef 按 externalRefId 移除', async () => {
    await writeRefs(dir, [
      { alias: 'a', externalRefId: 'r1', addedAt: 't' },
      { alias: 'b', externalRefId: 'r2', addedAt: 't' }
    ])
    await removeRef(dir, 'r1')
    const r = await readRefs(dir)
    expect(r).toHaveLength(1)
    expect(r[0].alias).toBe('b')
  })

  it('removeRef 找不到静默', async () => {
    await expect(removeRef(dir, 'never')).resolves.toBeUndefined()
  })

  it('updateRef 更新目录筛选并保持其它 binding 不变', async () => {
    await writeRefs(dir, [
      { alias: 'a', externalRefId: 'r1', addedAt: 't' },
      { alias: 'b', externalRefId: 'r2', addedAt: 't' }
    ])

    const updated = await updateRef(dir, 'r1', { visibleDirs: ['docs/api', 'docs', 'guides'] })

    expect(updated).toEqual({ alias: 'a', externalRefId: 'r1', addedAt: 't', visibleDirs: ['docs', 'guides'] })
    expect(await readRefs(dir)).toEqual([
      { alias: 'a', externalRefId: 'r1', addedAt: 't', visibleDirs: ['docs', 'guides'] },
      { alias: 'b', externalRefId: 'r2', addedAt: 't' }
    ])
  })

  it('updateRef 可保存和清空项目级使用说明', async () => {
    await writeRefs(dir, [{ alias: 'a', externalRefId: 'r1', addedAt: 't' }])

    expect((await updateRef(dir, 'r1', { usageNote: '  只使用 tokens/ 下的颜色。 ' })).usageNote)
      .toBe('只使用 tokens/ 下的颜色。')
    expect((await updateRef(dir, 'r1', { usageNote: '  ' })).usageNote).toBeUndefined()
  })
})
