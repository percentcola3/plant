import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userData: '',
  zgScript: '/app/node_modules/@zvec/zvec-grep/dist/cli/index.js' as string | null
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? mocks.userData : `/tmp/zg-mcp-${name}`) }
}))
vi.mock('./zg-runtime', () => ({
  isZgAvailable: () => mocks.zgScript !== null,
  resolveZgScript: () => mocks.zgScript
}))

import { buildZgMcpConfig, ensureZgMcpConfig } from './zg-mcp'

describe('buildZgMcpConfig', () => {
  it('生成 stdio MCP 配置：Electron-as-Node 运行 zg server --stdio', () => {
    const json = JSON.parse(buildZgMcpConfig('/x/zg/index.js', '/y/Electron'))
    const server = json.mcpServers['zvec-grep']
    expect(server.command).toBe('/y/Electron')
    expect(server.args).toEqual(['/x/zg/index.js', 'server', '--stdio'])
    expect(server.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})

describe('ensureZgMcpConfig', () => {
  beforeEach(async () => {
    mocks.userData = await mkdtemp(join(tmpdir(), 'zg-mcp-'))
  })
  afterEach(async () => {
    await fs.rm(mocks.userData, { recursive: true, force: true })
  })

  it('zg 可用时写入配置文件并返回路径；内容不变时不重复写', async () => {
    const path = await ensureZgMcpConfig()
    expect(path).toBe(join(mocks.userData, 'zg-mcp.json'))
    const first = await fs.readFile(path!, 'utf-8')
    expect(JSON.parse(first).mcpServers['zvec-grep'].args[1]).toBe('server')

    // 改写文件后再次调用 → 内容一致被还原（幂等）
    await fs.writeFile(path!, '{}', 'utf-8')
    await ensureZgMcpConfig()
    await expect(fs.readFile(path!, 'utf-8')).resolves.toBe(first)
  })

  it('zg 不可用时返回 null', async () => {
    mocks.zgScript = null
    try {
      await expect(ensureZgMcpConfig()).resolves.toBeNull()
    } finally {
      mocks.zgScript = '/app/node_modules/@zvec/zvec-grep/dist/cli/index.js'
    }
  })
})
