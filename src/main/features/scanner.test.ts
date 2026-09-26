import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { assertFeatureRelPath, listFeatureGroups, listFeatures } from './scanner'

let dir: string
const execFileAsync = promisify(execFile)
const mockUserData = vi.hoisted(() => '/tmp/features-scan-userdata')

vi.mock('electron', () => ({
  app: { getPath: () => mockUserData }
}))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'features-scan-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writeFile(rel: string, content = 'x'): Promise<void> {
  const abs = join(dir, rel)
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, content, 'utf-8')
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    }
  })
  return stdout.trim()
}

async function initGitRepo(): Promise<void> {
  await git(['init', '-b', 'main'])
  await git(['config', 'user.name', 'Test'])
  await git(['config', 'user.email', 'test@example.com'])
}

describe('listFeatures', () => {
  it('返回空数组当 features/ 不存在', async () => {
    await expect(listFeatures(dir)).resolves.toEqual([])
  })

  it('识别扁平 feature：含 prd.md 的目录', async () => {
    await writeFile('features/login/prd.md', '# 登录')
    const features = await listFeatures(dir)
    expect(features).toHaveLength(1)
    expect(features[0]).toMatchObject({
      name: 'login',
      relPath: 'features/login',
      group: null,
      prdRelPath: 'features/login/prd.md'
    })
  })

  it('优先识别 doc/prd.md 作为 PM feature 文档', async () => {
    await writeFile('features/payment/doc/prd.md', '# 支付')
    await writeFile('features/payment/index.html', '<html />')

    const [feature] = await listFeatures(dir)

    expect(feature).toMatchObject({
      name: 'payment',
      relPath: 'features/payment',
      group: null,
      prdRelPath: 'features/payment/doc/prd.md'
    })
    expect(feature.uiArtifacts).toEqual([
      {
        name: 'main',
        htmlRelPath: 'features/payment/index.html',
        rootRelPath: 'features/payment'
      }
    ])
  })

  it('识别 group 嵌套：features/<group>/<slug>/', async () => {
    await writeFile('features/auth/login/prd.md', '# 登录')
    await writeFile('features/auth/signup/index.html', '<html />')
    const features = await listFeatures(dir)
    expect(features).toHaveLength(2)
    const byName = Object.fromEntries(features.map((f) => [f.name, f]))
    expect(byName.login.group).toBe('auth')
    expect(byName.signup.group).toBe('auth')
    expect(byName.signup.uiArtifacts).toHaveLength(1)
  })

  it('收集多个 UI 产物：根 index.html + 一级子目录 v2/index.html', async () => {
    await writeFile('features/order/prd.md', '# 订单')
    await writeFile('features/order/index.html', '<html />')
    await writeFile('features/order/v2/index.html', '<html />')
    const [feature] = await listFeatures(dir)
    expect(feature.uiArtifacts).toHaveLength(2)
    const names = feature.uiArtifacts.map((a) => a.name).sort()
    expect(names).toEqual(['main', 'v2'])
  })

  it('识别只有 doc/ 技术方案、没有 prd.md / html 的扁平 feature', async () => {
    await writeFile('features/POS-64位系统/doc/64位打包技术方案.md', '# 方案')
    const features = await listFeatures(dir)
    expect(features).toHaveLength(1)
    expect(features[0]).toMatchObject({
      name: 'POS-64位系统',
      relPath: 'features/POS-64位系统',
      group: null,
      prdRelPath: 'features/POS-64位系统/doc/64位打包技术方案.md'
    })
    await expect(listFeatureGroups(dir)).resolves.toEqual([])
  })

  it('group 容器自身不算 feature（无 prd / 无 html）', async () => {
    await fs.mkdir(join(dir, 'features/empty-group'), { recursive: true })
    await expect(listFeatures(dir)).resolves.toEqual([])
  })

  it('三层嵌套不识别（仅支持一级 group）', async () => {
    await writeFile('features/auth/sub/login/prd.md', '# 登录')
    await expect(listFeatures(dir)).resolves.toEqual([])
  })

  it('忽略 node_modules / 隐藏目录', async () => {
    await writeFile('features/login/prd.md', '# 登录')
    await writeFile('features/login/node_modules/lib/x.js', '')
    await writeFile('features/login/.cache/x.json', '')
    const [feature] = await listFeatures(dir)
    expect(feature.uiArtifacts).toHaveLength(0)
  })

})

describe('listFeatureGroups', () => {
  it('返回 features/ 下的一级分组，包括只有 .gitkeep 的空分组', async () => {
    await writeFile('features/auth/login/prd.md', '# 登录')
    await writeFile('features/empty/.gitkeep', '')
    await writeFile('features/root/prd.md', '# 顶层项目')

    await expect(listFeatureGroups(dir)).resolves.toEqual(['auth', 'empty'])
  })
})

describe('assertFeatureRelPath', () => {
  it('放过 features/<slug>', () => {
    expect(assertFeatureRelPath('features/login')).toBe('features/login')
  })

  it('放过 features/<group>/<slug>', () => {
    expect(assertFeatureRelPath('features/auth/login')).toBe('features/auth/login')
  })

  it('归一化反斜杠 / 末尾斜杠', () => {
    expect(assertFeatureRelPath('features\\login\\')).toBe('features/login')
  })

  it('拒绝越界 ..', () => {
    expect(() => assertFeatureRelPath('features/../etc/passwd')).toThrow()
  })

  it('拒绝非 features/ 前缀', () => {
    expect(() => assertFeatureRelPath('docs/login')).toThrow()
  })

  it('拒绝层级过深', () => {
    expect(() => assertFeatureRelPath('features/a/b/c')).toThrow()
  })
})
