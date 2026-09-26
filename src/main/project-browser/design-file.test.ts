import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { savePageDesign } from './design-file'

const directories: string[] = []
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'web-design-test-'))
  directories.push(root)
  await fs.mkdir(join(root, 'ui/current'), { recursive: true })
  return root
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))) })
const snapshot = {
  html: '<!doctype html><html><body><h1>订单页面</h1></body></html>',
  title: '订单 / 页面', url: 'https://example.com/orders', capturedAt: '2026-09-12T00:00:00.000Z',
  warnings: ['远程图片需要网络'], viewport: { width: 1200, height: 800 }
}

describe('save webpage design in the current project', () => {
  it('creates editable HTML under the project without replacing earlier designs', async () => {
    const root = await fixture()
    const first = await savePageDesign(root, 'ui/current', snapshot)
    const second = await savePageDesign(root, 'ui/current', snapshot)
    expect(first.relPath).toMatch(/^ui\/current\/网页设计稿\/订单 - 页面-[\da-f-]+\.html$/)
    expect(first.relPath).not.toBe(second.relPath)
    expect(first).toMatchObject({ title: snapshot.title, warnings: snapshot.warnings, viewport: snapshot.viewport })
    expect(first).not.toHaveProperty('html')
    expect(await fs.readFile(join(root, first.relPath), 'utf8')).toBe(snapshot.html)
    expect(await fs.readFile(join(root, second.relPath), 'utf8')).toBe(snapshot.html)
  })
  it('rejects invalid or missing project directories without creating them', async () => {
    const root = await fixture()
    for (const path of ['', '.', '../outside', '/tmp/elsewhere', 'ui/../current', 'ui//current', 'ui\\current']) {
      await expect(savePageDesign(root, path, snapshot)).rejects.toThrow('项目路径无效')
    }
    await expect(savePageDesign(root, 'ui/missing', snapshot)).rejects.toThrow()
    await expect(fs.stat(join(root, 'ui/missing'))).rejects.toThrow()
  })
  it('does not write through project or design-directory symlinks outside the workspace', async () => {
    const root = await fixture()
    const outside = await fixture()
    await fs.symlink(outside, join(root, 'ui/external'))
    await expect(savePageDesign(root, 'ui/external', snapshot)).rejects.toThrow('当前工作区')
    await fs.symlink(outside, join(root, 'ui/current/网页设计稿'))
    await expect(savePageDesign(root, 'ui/current', snapshot)).rejects.toThrow('符号链接')
    expect(await fs.readdir(outside)).toEqual(['ui'])
  })
})
