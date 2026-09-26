import { describe, expect, it } from 'vitest'
import {
  buildChangeGuideAiPrompt,
  buildCommitPromptMessage,
  copyChangeGuidePromptToClipboardAndOpenTerminal
} from './dirty-changes'

describe('buildCommitPromptMessage', () => {
  it('说明保存弹窗出现的原因并列出改动文件', () => {
    const message = buildCommitPromptMessage('创建新需求', {
      changes: [
        { path: 'src/app.ts', index: 'M', workingDir: ' ' },
        { path: 'docs/prd.md', index: '?', workingDir: '?' }
      ]
    })

    expect(message).toContain('创建新需求前需要先处理当前未提交改动')
    expect(message).toContain('检测到 2 个业务文件变动')
    expect(message).toContain('• 已暂存修改：src/app.ts')
    expect(message).toContain('• 未跟踪：docs/prd.md')
  })

  it('过滤应用内部会话文件', () => {
    const message = buildCommitPromptMessage('切换需求', {
      changes: [
        { path: '.workspace/document-sessions/a94481794a4b2259.session-id', index: '?', workingDir: '?' },
        { path: '.workspace/project-context.json', index: 'M', workingDir: ' ' },
        { path: '.claude/skills/ui/SKILL.md', index: '?', workingDir: '?' },
        { path: '.agents/skills/ui/SKILL.md', index: '?', workingDir: '?' },
        { path: '.cursor/rules/ui-client-workspace.mdc', index: '?', workingDir: '?' },
        { path: 'AGENTS.md', index: 'M', workingDir: ' ' },
        { path: 'CLAUDE.md', index: 'M', workingDir: ' ' },
        { path: 'docs/spec.md', index: 'M', workingDir: ' ' }
      ]
    })

    expect(message).toContain('检测到 1 个业务文件变动')
    expect(message).toContain('docs/spec.md')
    expect(message).not.toContain('a94481794a4b2259.session-id')
    expect(message).not.toContain('project-context.json')
    expect(message).not.toContain('.claude/skills')
    expect(message).not.toContain('.agents/skills')
    expect(message).not.toContain('.cursor/rules')
    expect(message).not.toContain('AGENTS.md')
    expect(message).not.toContain('CLAUDE.md')
  })

  it('只有内部会话文件时提示无需保存业务版本', () => {
    const message = buildCommitPromptMessage('切换需求', {
      changes: [
        { path: '.workspace/session-id', index: '?', workingDir: '?' },
        { path: '.workspace/home-session-id', index: '?', workingDir: '?' },
        { path: '.workspace/document-sessions/a94481794a4b2259.session-id', index: '?', workingDir: '?' },
        { path: '.workspace/project-context.json', index: '?', workingDir: '?' },
        { path: '.claude/skills/pm/SKILL.md', index: '?', workingDir: '?' },
        { path: '.agents/skills/pm/SKILL.md', index: '?', workingDir: '?' },
        { path: '.cursor/rules/ui-client-workspace.mdc', index: '?', workingDir: '?' },
        { path: '.ui-client/refs.json', index: '?', workingDir: '?' },
        { path: '.external/saas-ui', index: '?', workingDir: '?' },
        { path: 'AGENTS.md', index: 'M', workingDir: ' ' },
        { path: 'CLAUDE.md', index: 'M', workingDir: ' ' }
      ]
    })

    expect(message).toContain('当前只检测到应用内部会话状态文件变动')
    expect(message).not.toContain('a94481794a4b2259.session-id')
  })

  it('没有改动详情时使用兜底说明', () => {
    const message = buildCommitPromptMessage('切换需求', undefined)

    expect(message).toContain('切换需求前需要先处理当前未提交改动')
    expect(message).toContain('当前 Git 工作区不是干净状态')
  })
})

describe('buildChangeGuideAiPrompt', () => {
  it('生成用于询问 AI 的改动分析提示词', () => {
    const prompt = buildChangeGuideAiPrompt({
      workspaceName: 'saasb',
      branch: 'req/demo',
      changedFiles: [
        { path: 'docs/prd.md', kind: 'modified' },
        { path: 'ui/login/index.html', kind: 'added' },
        { path: 'ui/old/index.html', kind: 'deleted' }
      ],
      diffSummaries: [
        {
          path: 'docs/prd.md',
          diff: '@@ -1 +1 @@\n-old\n+new',
          truncated: false
        }
      ]
    } as Parameters<typeof buildChangeGuideAiPrompt>[0] & {
      diffSummaries: Array<{ path: string; diff: string; truncated: boolean }>
    })

    expect(prompt).toContain('项目：saasb')
    expect(prompt).toContain('分支：req/demo')
    expect(prompt).toContain('- 修改: docs/prd.md')
    expect(prompt).toContain('- 新增: ui/login/index.html')
    expect(prompt).toContain('- 删除: ui/old/index.html')
    expect(prompt).toContain('docs/prd.md')
    expect(prompt).toContain('@@ -1 +1 @@')
    expect(prompt).toContain('请分析这些变更的影响范围')
    expect(prompt).toContain('是否可以直接提交')
  })
})

describe('copyChangeGuidePromptToClipboardAndOpenTerminal', () => {
  it('复制成功后打开终端面板并关闭当前弹窗', async () => {
    const copied: string[] = []
    const toasts: Array<{ kind: string; message: string }> = []
    let terminalOpened = false
    let dialogClosed = false

    const ok = await copyChangeGuidePromptToClipboardAndOpenTerminal({
      workspaceName: 'saasb',
      branch: 'req/demo',
      changedFiles: [{ path: 'docs/prd.md', kind: 'modified' }]
    }, {
      copyToClipboard: async (text) => {
        copied.push(text)
        return { ok: true }
      },
      showToast: (kind, message) => {
        toasts.push({ kind, message })
      },
      openTerminalPanel: () => {
        terminalOpened = true
      },
      closeDialog: () => {
        dialogClosed = true
      }
    })

    expect(ok).toBe(true)
    expect(copied).toHaveLength(1)
    expect(copied[0]).toContain('项目：saasb')
    expect(copied[0]).toContain('- 修改: docs/prd.md')
    expect(toasts).toEqual([{ kind: 'success', message: '已复制给 AI 的改动分析提示词' }])
    expect(terminalOpened).toBe(true)
    expect(dialogClosed).toBe(true)
  })

  it('复制失败时保留弹窗且不打开终端面板', async () => {
    const toasts: Array<{ kind: string; message: string }> = []
    let terminalOpened = false
    let dialogClosed = false

    const ok = await copyChangeGuidePromptToClipboardAndOpenTerminal({
      workspaceName: 'saasb',
      changedFiles: []
    }, {
      copyToClipboard: async () => ({ ok: false, message: 'denied' }),
      showToast: (kind, message) => {
        toasts.push({ kind, message })
      },
      openTerminalPanel: () => {
        terminalOpened = true
      },
      closeDialog: () => {
        dialogClosed = true
      }
    })

    expect(ok).toBe(false)
    expect(toasts).toEqual([{ kind: 'error', message: '复制失败：denied' }])
    expect(terminalOpened).toBe(false)
    expect(dialogClosed).toBe(false)
  })
})
