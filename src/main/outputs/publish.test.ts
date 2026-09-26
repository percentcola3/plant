import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { publishUiProduct, findExternalRefViolations } from './publish'

const bucketMock = vi.hoisted(() => ({
  putObject: vi.fn(),
  putObjectACL: vi.fn(),
  getObjectUrl: vi.fn()
}))

vi.mock('../publish/s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../publish/s3')>()
  return {
    ...actual,
    buildTimestamp: () => '20260611-180000',
    createBucket: async () => bucketMock
  }
})

let workspacePath: string

beforeEach(async () => {
  vi.clearAllMocks()
  bucketMock.putObject.mockImplementation(async (key: string) => ({ url: `https://cdn.example.com/${key}` }))
  bucketMock.putObjectACL.mockResolvedValue(undefined)
  bucketMock.getObjectUrl.mockImplementation((key: string) => `https://cdn.example.com/${key}`)
  workspacePath = await mkdtemp(join(tmpdir(), 'ui-product-publish-'))
})

afterEach(async () => {
  await fs.rm(workspacePath, { recursive: true, force: true })
})

describe('publishUiProduct', () => {
  it('rejects a UI product without index.html before uploading', async () => {
    await fs.mkdir(join(workspacePath, 'ui/login'), { recursive: true })

    await expect(
      publishUiProduct({
        workspacePath,
        workspaceName: 'saas',
        productRelPath: 'ui/login'
      })
    ).rejects.toMatchObject({ code: 'NO_INDEX' })
  })

  it('rejects paths outside the workspace', async () => {
    await expect(
      publishUiProduct({
        workspacePath,
        workspaceName: 'saas',
        productRelPath: '../outside'
      })
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_SCOPE' })
  })

  // zip 构建在并发跑全套测试时偶尔 >5s，给宽松点
  it('uploads SPA root index + ui-main + source.zip and reports progress', { timeout: 15000 }, async () => {
    await fs.mkdir(join(workspacePath, 'outputs/login/assets'), { recursive: true })
    await fs.writeFile(
      join(workspacePath, 'outputs/login/index.html'),
      '<!doctype html><html><body><h1>hi</h1></body></html>',
      'utf-8'
    )
    await fs.writeFile(join(workspacePath, 'outputs/login/assets/app.css'), 'body{}', 'utf-8')
    await fs.writeFile(
      join(workspacePath, 'outputs/login/assets/logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
      'utf-8'
    )

    const onProgress = vi.fn()
    const record = await publishUiProduct({
      workspacePath,
      workspaceName: 'saas',
      productRelPath: 'outputs/login',
      onProgress
    })

    // fileCount = 产物原始文件数（不含 zip / SPA root）；total = fileCount + 2（zip + SPA root）
    expect(record.fileCount).toBe(3)
    // putObject 调用：source.zip + ui-main.html + CSS + SVG + SPA index.html
    expect(bucketMock.putObject).toHaveBeenCalledTimes(5)

    const zipCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/source.zip'))
    expect(zipCall).toBeTruthy()
    expect(Buffer.isBuffer(zipCall![1])).toBe(true)
    expect(zipCall![2]).toMatchObject({ headers: { 'content-type': 'application/zip' } })
    const sourceZip = await JSZip.loadAsync(zipCall![1] as Buffer)
    await expect(sourceZip.file('assets/logo.svg')?.async('string')).resolves.toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>'
    )

    // 用户的 index.html 上传为 ui-main.html
    const uiMainCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/ui-main.html'))
    expect(uiMainCall).toBeTruthy()
    const uiMainBody = (uiMainCall![1] as Buffer).toString('utf-8')
    expect(uiMainBody).toContain('<h1>hi</h1>')

    // SPA 主页（根 index.html）= 文档索引页，含 marked 运行时
    const rootIndexCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/index.html'))
    expect(rootIndexCall).toBeTruthy()
    expect(rootIndexCall![0]).not.toEqual(uiMainCall![0])
    const rootBody = (rootIndexCall![1] as Buffer).toString('utf-8')
    expect(rootBody).toContain('marked.parse')
    expect(rootBody).toContain('href="ui-main.html"')
    expect(rootBody).toContain('source.zip')
    // record.url 指向 SPA 主页
    expect(record.url).toBe(rootIndexCall![0]
      ? `https://cdn.example.com/${rootIndexCall![0] as string}`
      : '')

    expect(onProgress).toHaveBeenCalledWith({
      productRelPath: 'outputs/login',
      phase: 'preparing',
      uploaded: 0,
      total: 5
    })
    expect(onProgress).toHaveBeenLastCalledWith({
      productRelPath: 'outputs/login',
      phase: 'completed',
      uploaded: 5,
      total: 5
    })
  })

  it('uploads element remarks json and injects the remark overlay into ui-main.html', async () => {
    await fs.mkdir(join(workspacePath, 'ui/pay'), { recursive: true })
    await fs.writeFile(
      join(workspacePath, 'ui/pay/index.html'),
      '<!doctype html><html><body><button>pay</button></body></html>',
      'utf-8'
    )
    await fs.writeFile(
      join(workspacePath, 'ui/pay/element-remarks.json'),
      JSON.stringify({
        version: 1,
        items: [{ relPath: 'ui/pay/index.html', path: 'body > button', note: '确认按钮' }]
      }),
      'utf-8'
    )

    await publishUiProduct({
      workspacePath,
      workspaceName: 'saas',
      productRelPath: 'ui/pay'
    })

    const remarksCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/element-remarks.json'))
    expect(remarksCall).toBeTruthy()

    // 备注脚本注入到 ui-main.html，不在 SPA 主页
    const uiMainCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/ui-main.html'))
    expect(uiMainCall).toBeTruthy()
    const uiMainBody = (uiMainCall![1] as Buffer).toString('utf-8')
    expect(uiMainBody).toContain('element-remarks.json')
    expect(uiMainBody).toContain('ws-element-remark-marker')
    expect(uiMainBody).toContain('ui/pay/index.html')

    const rootIndexCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/index.html')
      && !String(c[0]).endsWith('/ui-main.html'))
    expect(rootIndexCall).toBeTruthy()
    const rootBody = (rootIndexCall![1] as Buffer).toString('utf-8')
    expect(rootBody).not.toContain('ws-element-remark-marker')
  })

  it('uploads markdown specs raw and lists them in the SPA sidebar', async () => {
    await fs.mkdir(join(workspacePath, 'outputs/order/docs'), { recursive: true })
    await fs.writeFile(
      join(workspacePath, 'outputs/order/index.html'),
      '<!doctype html><html><body><h1>Order</h1></body></html>',
      'utf-8'
    )
    await fs.writeFile(
      join(workspacePath, 'outputs/order/docs/spec.md'),
      '# Order Spec\n\n规格说明',
      'utf-8'
    )
    await fs.writeFile(
      join(workspacePath, 'outputs/order/README.markdown'),
      '# Read Me\n',
      'utf-8'
    )
    // 隐藏目录里的 MD 应被排除
    await fs.mkdir(join(workspacePath, 'outputs/order/.claude/skills/ui'), { recursive: true })
    await fs.writeFile(
      join(workspacePath, 'outputs/order/.claude/skills/ui/SKILL.md'),
      '# Internal Skill\n',
      'utf-8'
    )

    await publishUiProduct({
      workspacePath,
      workspaceName: 'saas',
      productRelPath: 'outputs/order'
    })

    // .md 原样上传，content-type = text/markdown
    const specCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/docs/spec.md'))
    expect(specCall).toBeTruthy()
    expect(specCall![2]).toMatchObject({ headers: { 'content-type': 'text/markdown; charset=utf-8' } })
    const readmeCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/README.markdown'))
    expect(readmeCall).toBeTruthy()

    // SPA 主页的 DOCS JSON 含两个文档；隐藏目录里的 SKILL.md 不在
    const rootIndexCall = bucketMock.putObject.mock.calls.find((c) => String(c[0]).endsWith('/index.html')
      && !String(c[0]).endsWith('/ui-main.html'))
    expect(rootIndexCall).toBeTruthy()
    const rootBody = (rootIndexCall![1] as Buffer).toString('utf-8')
    expect(rootBody).toContain('"docs/spec.md"')
    expect(rootBody).toContain('"README.markdown"')
    expect(rootBody).toContain('Order Spec')
    expect(rootBody).toContain('Read Me')
    expect(rootBody).not.toContain('Internal Skill')
    expect(rootBody).not.toContain('.claude/skills/ui/SKILL.md')
  })

  it('阻断引用了 .external/ 的产物，不上传任何文件', async () => {
    await fs.mkdir(join(workspacePath, 'outputs/login'), { recursive: true })
    await fs.writeFile(
      join(workspacePath, 'outputs/login/index.html'),
      '<!doctype html><html><body><img src="../../.external/ui/logo.png"></body></html>',
      'utf-8'
    )
    await expect(
      publishUiProduct({
        workspacePath,
        workspaceName: 'Demo',
        productRelPath: 'outputs/login'
      })
    ).rejects.toMatchObject({ code: 'EXTERNAL_REF_IN_PRODUCT' })
    expect(bucketMock.putObject).not.toHaveBeenCalled()
  })
})

describe('findExternalRefViolations', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ext-ref-')) })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it('命中 html src / css url() / @import 引用', async () => {
    await fs.writeFile(join(dir, 'index.html'), '<img src="../.external/ui/a.png">', 'utf-8')
    await fs.writeFile(join(dir, 'app.css'), '.x{background:url(.external/ui/b.png)}\n@import "./.external/ui/t.css";', 'utf-8')
    const hits = await findExternalRefViolations(dir, [join(dir, 'index.html'), join(dir, 'app.css')])
    expect(hits.length).toBeGreaterThanOrEqual(3)
    expect(hits.some((h) => h.relPath.startsWith('index.html:'))).toBe(true)
    expect(hits.some((h) => h.relPath.startsWith('app.css:'))).toBe(true)
  })

  it('项目内相对路径不误报；二进制/非扫描文件跳过', async () => {
    await fs.writeFile(join(dir, 'index.html'), '<img src="assets/logo.png"><link href="./styles/theme.css">', 'utf-8')
    await fs.writeFile(join(dir, 'note.txt'), 'see .external/ui for reference', 'utf-8')
    const hits = await findExternalRefViolations(dir, [join(dir, 'index.html'), join(dir, 'note.txt')])
    expect(hits).toEqual([])
  })
})
