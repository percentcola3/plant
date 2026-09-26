import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishFeature } from './publish'

const bucketMock = vi.hoisted(() => ({
  putObject: vi.fn(),
  putObjectACL: vi.fn(),
  getObjectUrl: vi.fn()
}))

vi.mock('../publish/s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../publish/s3')>()
  return {
    ...actual,
    buildTimestamp: () => '20260625-120000',
    createBucket: async () => bucketMock
  }
})

vi.mock('../git/client', () => ({
  gitFor: () => ({
    revparse: vi.fn(async () => 'abc123'),
    raw: vi.fn(async () => 'abc123\n')
  })
}))

let workspacePath: string

beforeEach(async () => {
  vi.clearAllMocks()
  bucketMock.putObject.mockImplementation(async (key: string) => ({ url: `https://cdn.example.com/${key}` }))
  bucketMock.putObjectACL.mockResolvedValue(undefined)
  bucketMock.getObjectUrl.mockImplementation((key: string) => `https://cdn.example.com/${key}`)
  workspacePath = await mkdtemp(join(tmpdir(), 'feature-publish-'))
})

afterEach(async () => {
  await fs.rm(workspacePath, { recursive: true, force: true })
})

describe('publishFeature', () => {
  it('publishes SPA root index + raw markdown docs + ui-main.html + source.zip', async () => {
    await fs.mkdir(join(workspacePath, 'features/payment/doc'), { recursive: true })
    await fs.writeFile(join(workspacePath, 'features/payment/doc/prd.md'), '# 支付 PRD\n\n验收标准', 'utf-8')
    await fs.writeFile(
      join(workspacePath, 'features/payment/index.html'),
      '<!doctype html><html><body><h1>Payment</h1></body></html>',
      'utf-8'
    )

    const onProgress = vi.fn()
    const record = await publishFeature({
      workspacePath,
      workspaceName: 'pm app',
      featureRelPath: 'features/payment',
      onProgress
    })

    // 旧字段名沿用，语义改为 markdown 文档数
    expect(record.prdFileCount).toBe(1)
    expect(record.uiArtifactCount).toBe(1)
    // 1 zip + 1 SPA root + 1 md + 1 ui-main (无 assets)
    expect(record.fileCount).toBe(4)
    expect(record.headSha).toBe('abc123')

    const keys = bucketMock.putObject.mock.calls.map((call) => String(call[0]))
    const prefix = 'demo-tenant/pm-app/features/payment/20260625-120000'
    expect(keys).toContain(`${prefix}/index.html`)
    expect(keys).toContain(`${prefix}/source.zip`)
    expect(keys).toContain(`${prefix}/doc/prd.md`)
    expect(keys).toContain(`${prefix}/ui-main.html`)
    // 旧的 prd.html 应该完全消失
    expect(keys).not.toContain(`${prefix}/prd.html`)
    // 资源一律按原相对路径上传，不再塞进 ui-main-assets/ 子前缀
    expect(keys.some((key) => key.includes('ui-main-assets/'))).toBe(false)

    // SPA root index 必须包含 marked 运行时和文档列表 JSON（用于客户端渲染）
    const rootIndexCall = bucketMock.putObject.mock.calls.find((call) => String(call[0]) === `${prefix}/index.html`)
    expect(rootIndexCall).toBeTruthy()
    const rootHtml = (rootIndexCall![1] as Buffer).toString('utf-8')
    expect(rootHtml).toContain('marked.parse')
    expect(rootHtml).toContain('"doc/prd.md"')

    // record.url 指向 SPA 主页（而不是 ui-main 或 prd.html）
    expect(record.url).toBe(`https://cdn.example.com/${prefix}/index.html`)

    expect(onProgress).toHaveBeenLastCalledWith({
      featureRelPath: 'features/payment',
      phase: 'completed',
      uploaded: 4,
      total: 4
    })
  })

  it('uploads UI assets at their original relative path so HTML references resolve', async () => {
    // 复现真实产物：根 index.html 用 ./assets/、./bundles/ 等相对路径引用 CSS/JS/图片。
    // 这些资源必须按原相对路径上传到 prefix 下，与 ui-main.html 同层级；
    // 否则浏览器请求 <prefix>/assets/x.css 但资源在 <prefix>/ui-main-assets/assets/x.css → 404 → 无样式。
    await fs.mkdir(join(workspacePath, 'features/payment/assets'), { recursive: true })
    await fs.mkdir(join(workspacePath, 'features/payment/bundles'), { recursive: true })
    await fs.writeFile(
      join(workspacePath, 'features/payment/index.html'),
      '<!doctype html><html><head>'
      + '<link rel="stylesheet" href="./bundles/app.bundle.css">'
      + '<link rel="stylesheet" href="./assets/theme.css">'
      + '</head><body><h1>Payment</h1></body></html>',
      'utf-8'
    )
    await fs.writeFile(join(workspacePath, 'features/payment/bundles/app.bundle.css'), 'body{color:#000}', 'utf-8')
    await fs.writeFile(join(workspacePath, 'features/payment/assets/theme.css'), ':root{--c:#fff}', 'utf-8')

    await publishFeature({
      workspacePath,
      workspaceName: 'pm app',
      featureRelPath: 'features/payment'
    })

    const keys = bucketMock.putObject.mock.calls.map((call) => String(call[0]))
    const prefix = 'demo-tenant/pm-app/features/payment/20260625-120000'
    // 资源按原相对路径上传（与 ui-main.html 同层级），HTML 的相对引用才能解析
    expect(keys).toContain(`${prefix}/bundles/app.bundle.css`)
    expect(keys).toContain(`${prefix}/assets/theme.css`)
    // 不能塞进 ui-main-assets/ 子前缀（会打破相对层级导致 CSS 404）
    expect(keys).not.toContain(`${prefix}/ui-main-assets/bundles/app.bundle.css`)
    expect(keys).not.toContain(`${prefix}/ui-main-assets/assets/theme.css`)
  })

  it('rejects feature publish when UI files still reference .external assets', async () => {
    await fs.mkdir(join(workspacePath, 'features/payment/assets'), { recursive: true })
    await fs.writeFile(join(workspacePath, 'features/payment/prd.md'), '# 支付 PRD', 'utf-8')
    await fs.writeFile(
      join(workspacePath, 'features/payment/index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="../../.external/ui/theme.css"></head><body></body></html>',
      'utf-8'
    )

    await expect(publishFeature({
      workspacePath,
      workspaceName: 'pm app',
      featureRelPath: 'features/payment'
    })).rejects.toMatchObject({
      code: 'EXTERNAL_REF_IN_PRODUCT'
    })

    expect(bucketMock.putObject).not.toHaveBeenCalled()
  })

  it('publishes element remarks next to feature UI pages and injects the remark overlay', async () => {
    await fs.mkdir(join(workspacePath, 'features/payment'), { recursive: true })
    await fs.writeFile(
      join(workspacePath, 'features/payment/index.html'),
      '<!doctype html><html><body><button>Pay</button></body></html>',
      'utf-8'
    )
    await fs.writeFile(
      join(workspacePath, 'features/payment/element-remarks.json'),
      JSON.stringify({
        version: 1,
        items: [{ relPath: 'features/payment/index.html', path: 'body > button', note: '支付按钮' }]
      }),
      'utf-8'
    )

    const record = await publishFeature({
      workspacePath,
      workspaceName: 'pm app',
      featureRelPath: 'features/payment'
    })

    expect(record.fileCount).toBe(4)
    const prefix = 'demo-tenant/pm-app/features/payment/20260625-120000'
    const remarksCall = bucketMock.putObject.mock.calls.find((call) => String(call[0]) === `${prefix}/ui-main-element-remarks.json`)
    expect(remarksCall).toBeTruthy()

    const uiMainCall = bucketMock.putObject.mock.calls.find((call) => String(call[0]) === `${prefix}/ui-main.html`)
    expect(uiMainCall).toBeTruthy()
    const uiMainBody = (uiMainCall![1] as Buffer).toString('utf-8')
    expect(uiMainBody).toContain('ws-element-remark-marker')
    expect(uiMainBody).toContain('ui-main-element-remarks.json')
    expect(uiMainBody).toContain('features/payment/index.html')
  })
})
