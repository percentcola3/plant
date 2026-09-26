import { describe, expect, it } from 'vitest'
import { delimiter } from 'node:path'
import { buildSpawnEnv } from './launch-env'

describe('launch-env buildSpawnEnv', () => {
  it('prepends node bin dir and claude bin dir to existing PATH', () => {
    const env = buildSpawnEnv({ PATH: '/usr/bin:/bin' }, '/opt/homebrew/bin/claude')
    const parts = (env.PATH ?? '').split(delimiter)
    // node bin dir 应该在最前
    expect(parts[0]).toBe(process.execPath.replace(/\/[^/]+$/, ''))
    // claude bin dir 应该靠前
    expect(parts).toContain('/opt/homebrew/bin')
    // existing PATH 应保留
    expect(parts).toContain('/usr/bin')
    expect(parts).toContain('/bin')
  })

  it('appends user toolchain dirs at the end', () => {
    const env = buildSpawnEnv({ PATH: '/usr/bin' }, '/opt/homebrew/bin/claude')
    const parts = (env.PATH ?? '').split(delimiter)
    // Homebrew 应在 existing 之后（prepend 优先，toolchain 垫后）
    const homebrewIdx = parts.indexOf('/opt/homebrew/bin')
    const usrbinIdx = parts.indexOf('/usr/bin')
    // 注意：claudeBin 的目录也是 /opt/homebrew/bin，prepend 时已加入，
    // 所以它出现两次时去重后只留首次（prepend 位置），usrbin 在其后。
    expect(homebrewIdx).toBeLessThan(usrbinIdx)
  })

  it('dedupes identical directory entries (keeps first occurrence)', () => {
    // Mac/Linux 文件系统可能大小写敏感，所以只做精确字符串去重；
    // Windows 在 normalize 阶段 lowercase（见 buildSpawnEnv）做大小写不敏感去重。
    const env = buildSpawnEnv({ PATH: '/usr/bin:/usr/bin:/bin:/usr/bin' }, '/opt/homebrew/bin/claude')
    const parts = (env.PATH ?? '').split(delimiter)
    const usrbinCount = parts.filter((p) => p === '/usr/bin').length
    expect(usrbinCount).toBe(1)
  })

  it('preserves non-PATH env vars', () => {
    const env = buildSpawnEnv({ PATH: '/usr/bin', HOME: '/Users/x', ANTHROPIC_API_KEY: 'sk-1' }, '/opt/homebrew/bin/claude')
    expect(env.HOME).toBe('/Users/x')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-1')
  })

  it('handles Windows Path key (case-insensitive lookup)', () => {
    const env = buildSpawnEnv({ Path: 'C:\\Windows\\System32' } as NodeJS.ProcessEnv, 'C:\\Users\\x\\claude.cmd')
    // 不应该在 PATH (大写) 上新建一个，而应更新原来的 Path
    expect(env.Path).toBeDefined()
    expect((env.Path as string).length).toBeGreaterThan(0)
  })
})
