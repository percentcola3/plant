import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileTree } from './doc-tree'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'doc-tree-'))
})

afterEach(async () => {
  await fs.rm(workspacePath, { recursive: true, force: true })
})

describe('readFileTree', () => {
  it('attaches UI product publish metadata from meta.json to product folders', async () => {
    await fs.mkdir(join(workspacePath, 'outputs/login'), { recursive: true })
    await fs.writeFile(join(workspacePath, 'outputs/login/index.html'), '<!doctype html>', 'utf-8')
    await fs.writeFile(join(workspacePath, 'outputs/login/meta.json'), JSON.stringify({
      publish: {
        productRelPath: 'outputs/login',
        publishedAt: '2026-06-11T10:00:00.000Z',
        url: 'https://cdn.example.com/outputs/login/index.html',
        prefix: 'demo-tenant/saas/ui/login/20260611-180000',
        fileCount: 2,
        bucket: 'demo-bucket',
        region: 'demo-region'
      }
    }), 'utf-8')

    const tree = await readFileTree(workspacePath, 'outputs')
    const login = tree.find((node) => node.kind === 'folder' && node.name === 'login')

    expect(login).toMatchObject({
      kind: 'folder',
      uiProductPublish: {
        url: 'https://cdn.example.com/outputs/login/index.html',
        productRelPath: 'outputs/login'
      }
    })
  })

  it('attaches UI product card metadata from meta.json to product folders', async () => {
    await fs.mkdir(join(workspacePath, 'outputs/checkout'), { recursive: true })
    await fs.writeFile(join(workspacePath, 'outputs/checkout/index.html'), '<!doctype html>', 'utf-8')
    await fs.writeFile(join(workspacePath, 'outputs/checkout/meta.json'), JSON.stringify({
      card: {
        title: '移动端支持直接点餐',
        coverTag: 'SAAS',
        uxName: '张裴',
        pmName: '张代辉',
      },
    }), 'utf-8')

    const tree = await readFileTree(workspacePath, 'outputs')
    const checkout = tree.find((node) => node.kind === 'folder' && node.name === 'checkout')

    expect(checkout).toMatchObject({
      kind: 'folder',
      uiProductCard: {
        title: '移动端支持直接点餐',
        coverTag: 'SAAS',
        uxName: '张裴',
        pmName: '张代辉',
      },
    })
  })
})
