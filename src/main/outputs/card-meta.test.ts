import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { readFileTree } from '../workspaces/doc-tree'
import { updateUiProductCardMeta } from './card-meta'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'ui-card-meta-'))
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('updateUiProductCardMeta', () => {
  it('writes card metadata to outputs meta.json and readFileTree can load it', async () => {
    const productRelPath = 'outputs/demo'
    await updateUiProductCardMeta(workspacePath, productRelPath, {
      title: '移动端支持直接点餐',
      coverTag: 'SAAS',
      uxName: '张裴',
      pmName: '张代辉',
    })

    const raw = JSON.parse(await readFile(join(workspacePath, productRelPath, 'meta.json'), 'utf-8')) as {
      card?: Record<string, string>
    }
    expect(raw.card).toEqual({
      title: '移动端支持直接点餐',
      coverTag: 'SAAS',
      uxName: '张裴',
      pmName: '张代辉',
    })

    const tree = await readFileTree(workspacePath, 'outputs')
    const demo = tree.find((node) => node.kind === 'folder' && node.name === 'demo')
    expect(demo?.kind === 'folder' ? demo.uiProductCard : null).toEqual(raw.card)
  })
})
