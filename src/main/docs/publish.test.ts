import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMarkdownPublishBundle,
  readDocPublishStatus,
  writeDocPublishRecord
} from './publish'

let projectPath: string

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'doc-publish-'))
})

afterEach(async () => {
  await fs.rm(projectPath, { recursive: true, force: true })
})

describe('buildMarkdownPublishBundle', () => {
  it('renders markdown to html and rewrites local image/link resources into assets', async () => {
    await fs.mkdir(join(projectPath, 'docs', 'img'), { recursive: true })
    await fs.mkdir(join(projectPath, 'files'), { recursive: true })
    await fs.writeFile(join(projectPath, 'docs', 'img', 'logo.png'), 'png-data')
    await fs.writeFile(join(projectPath, 'files', 'scope.pdf'), 'pdf-data')

    const bundle = await buildMarkdownPublishBundle({
      projectPath,
      relPath: 'docs/prd.md',
      content: [
        '# 发布测试',
        '',
        '==重点==',
        '',
        '![logo](./img/logo.png)',
        '',
        '[附件](../files/scope.pdf)',
        '',
        '[外链](https://example.com/x.png)'
      ].join('\n')
    })

    expect(bundle.html).toContain('<article class="markdown">')
    expect(bundle.html).toContain('<mark>重点</mark>')
    expect(bundle.html).not.toContain('./img/logo.png')
    expect(bundle.html).not.toContain('../files/scope.pdf')
    expect(bundle.html).toContain('https://example.com/x.png')
    expect(bundle.resources).toHaveLength(2)
    const outputs = bundle.resources.map((r) => r.outputPath)
    expect(outputs).toContainEqual(expect.stringMatching(/^assets\/[a-f0-9]{12}\.pdf$/))
    expect(outputs).toContainEqual(expect.stringMatching(/^assets\/[a-f0-9]{12}\.png$/))
    expect(bundle.imageCount).toBe(1)
  })

  it('keeps mermaid charts renderable in the published html', async () => {
    const bundle = await buildMarkdownPublishBundle({
      projectPath,
      relPath: 'chart.md',
      content: ['```mermaid', 'flowchart LR', 'A --> B', '```'].join('\n')
    })

    expect(bundle.html).toContain('class="md-chart"')
    expect(bundle.html).toContain('class="md-chart__title">图表</span>')
    expect(bundle.html).toContain('<pre class="mermaid">')
    expect(bundle.html).toContain('mermaid.initialize')
    expect(bundle.html).toContain('"theme":"base"')
    expect(bundle.html).toContain('"themeVariables"')
  })
})

describe('doc publish status', () => {
  it('marks a document unpublished when content no longer matches the last published hash', async () => {
    await writeDocPublishRecord(projectPath, {
      relPath: 'prd.md',
      contentHash: 'old-hash',
      publishedAt: '2026-06-06T00:00:00.000Z',
      url: 'https://example.com/prd',
      prefix: 'tenant/project/prd/20260606',
      fileCount: 1,
      imageCount: 0,
      assetCount: 0,
      bucket: 'bucket',
      region: 'region'
    })

    const status = await readDocPublishStatus(projectPath, 'prd.md', 'new content')

    expect(status?.url).toBe('https://example.com/prd')
    expect(status?.isPublished).toBe(false)
  })
})
