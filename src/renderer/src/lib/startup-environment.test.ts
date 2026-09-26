import { describe, expect, it } from 'vitest'
import { buildStartupEnvironmentNotice } from './startup-environment'

const CLAUDE_GUIDE_URL = 'https://docs.example.com/setup/cli'

describe('buildStartupEnvironmentNotice（极简版，只关心 git binary + git user）', () => {
  it('git binary 不可用 → blocking', () => {
    const notice = buildStartupEnvironmentNotice({
      gitBinaryReady: false,
      gitUser: { name: 'Alice', email: 'user@example.com', configured: true },
      claudeGuideUrl: CLAUDE_GUIDE_URL
    })

    expect(notice?.severity).toBe('blocking')
    expect(notice?.title).toBe('环境未就绪')
    expect(notice?.items.some((i) => i.includes('内置 Git 组件不可用'))).toBe(true)
  })

  it('git user 邮箱未配 → blocking + 引导去 Settings', () => {
    const notice = buildStartupEnvironmentNotice({
      gitBinaryReady: true,
      gitUser: { name: '', email: '', configured: false },
      claudeGuideUrl: CLAUDE_GUIDE_URL
    })

    expect(notice).toMatchObject({
      title: '环境未就绪',
      severity: 'blocking',
      primaryActionKind: 'settings',
      primaryActionLabel: '去配置身份'
    })
    expect(notice?.items.some((i) => i.includes('未配置用户身份邮箱'))).toBe(true)
  })

  it('git binary 不可用 + 邮箱未配 → blocking，但不给 settings 入口（先修 git）', () => {
    const notice = buildStartupEnvironmentNotice({
      gitBinaryReady: false,
      gitUser: { name: '', email: '', configured: false },
      claudeGuideUrl: CLAUDE_GUIDE_URL
    })

    expect(notice?.severity).toBe('blocking')
    expect(notice?.primaryActionKind).toBeUndefined()
  })

  it('一切正常 → 返回 null（没 splash notice）', () => {
    const notice = buildStartupEnvironmentNotice({
      gitBinaryReady: true,
      gitUser: { name: 'Alice', email: 'user@example.com', configured: true },
      claudeGuideUrl: CLAUDE_GUIDE_URL
    })
    expect(notice).toBeNull()
  })

  it('claude / cursor / vscode 不在启动检查里——不在这里产生 notice', () => {
    // 即使 claude 没装，启动 splash 也不应该叫——它现在是 lazy detect
    const notice = buildStartupEnvironmentNotice({
      gitBinaryReady: true,
      gitUser: { name: 'Alice', email: 'user@example.com', configured: true },
      claudeGuideUrl: CLAUDE_GUIDE_URL
    })
    expect(notice).toBeNull()
  })
})
