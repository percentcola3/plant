import { describe, expect, it } from 'vitest'
import {
  buildTurnStatusNotice,
  buildApprovalContinuationPrompt,
  findLatestApprovalRequest,
  summarizeTurnActivity,
  type DisplayMessage
} from './display-state'

describe('chat display-state', () => {
  it('findLatestApprovalRequest 提取最近一次授权失败的命令和提示', () => {
    const messages: DisplayMessage[] = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 't1', name: 'Bash', input: { command: 'find . -name "*.md" | head' } },
        {
          type: 'tool_result',
          toolUseId: 't1',
          isError: true,
          content: 'This Bash command contains multiple operations. The following part requires approval: find . -name "*.md"'
        }
      ]
    }]

    const approval = findLatestApprovalRequest(messages)

    expect(approval?.command).toBe('find . -name "*.md" | head')
    expect(approval?.hint).toContain('多步操作')
    expect(approval?.allowedTools).toEqual(['Bash'])
    expect(approval?.approvalPrompt).toContain('我已在 UI 中授权执行下面这条 Bash 命令')
    expect(approval?.approvalPrompt).toContain('find . -name "*.md" | head')
  })

  it('findLatestApprovalRequest 忽略普通工具错误', () => {
    const messages: DisplayMessage[] = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 't1', name: 'Bash', input: { command: 'foo' } },
        { type: 'tool_result', toolUseId: 't1', isError: true, content: 'command not found: foo' }
      ]
    }]

    expect(findLatestApprovalRequest(messages)).toBeNull()
  })

  it('findLatestApprovalRequest 不返回已经 UI 授权处理过的旧请求', () => {
    const messages: DisplayMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't1', name: 'Bash', input: { command: 'find . -name "*.md" | head' } },
          {
            type: 'tool_result',
            toolUseId: 't1',
            isError: true,
            content: 'This Bash command contains multiple operations. The following part requires approval: find . -name "*.md"'
          }
        ]
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '已授权，继续执行' }]
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '已继续完成。' }]
      }
    ]

    expect(findLatestApprovalRequest(messages)).toBeNull()
  })

  it('findLatestApprovalRequest 仍返回授权后新出现的请求', () => {
    const messages: DisplayMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't1', name: 'Bash', input: { command: 'find . -name "*.md" | head' } },
          {
            type: 'tool_result',
            toolUseId: 't1',
            isError: true,
            content: 'This Bash command contains multiple operations. The following part requires approval: find . -name "*.md"'
          }
        ]
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '已授权，继续执行' }]
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't2', name: 'Bash', input: { command: 'find . -name "*.vue" | head' } },
          {
            type: 'tool_result',
            toolUseId: 't2',
            isError: true,
            content: 'This Bash command contains multiple operations. The following part requires approval: find . -name "*.vue"'
          }
        ]
      }
    ]

    expect(findLatestApprovalRequest(messages)?.command).toBe('find . -name "*.vue" | head')
  })

  it('findRunningSkill 返回最后一个尚未返回结果的 Skill 调用', async () => {
    const { findRunningSkill } = await import('./display-state')
    const messages: DisplayMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '走一下脑暴然后查一下' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't1', name: 'Read', input: { file_path: 'x.md' } },
          { type: 'tool_use', toolUseId: 't2', name: 'Skill', input: { skill: 'pm-brainstorm' } },
          { type: 'tool_use', toolUseId: 't3', name: 'Skill', input: { skill: 'check' } }
        ]
      }
    ]
    expect(findRunningSkill(messages)).toBe('check')
  })

  it('findRunningSkill 在 Skill 返回结果（成功）后不再展示', async () => {
    const { findRunningSkill } = await import('./display-state')
    const messages: DisplayMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '走一下脑暴' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't1', name: 'Skill', input: { skill: 'pm-brainstorm' } },
          { type: 'tool_result', toolUseId: 't1', content: 'done' }
        ]
      }
    ]
    expect(findRunningSkill(messages)).toBeNull()
  })

  it('findRunningSkill 在 Skill 返回结果（失败）后不再展示', async () => {
    const { findRunningSkill } = await import('./display-state')
    const messages: DisplayMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '走一下脑暴' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't1', name: 'Skill', input: { skill: 'brainstorming' } },
          { type: 'tool_result', toolUseId: 't1', isError: true, content: 'skill not found' }
        ]
      }
    ]
    expect(findRunningSkill(messages)).toBeNull()
  })

  it('findRunningSkill 接受 input.name / input.skill_name 兜底', async () => {
    const { findRunningSkill } = await import('./display-state')
    const messages: DisplayMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't1', name: 'Skill', input: { name: 'ui-brainstorm' } },
          { type: 'tool_use', toolUseId: 't2', name: 'Skill', input: { skill_name: 'check' } }
        ]
      }
    ]
    expect(findRunningSkill(messages)).toBe('check')
  })

  it('findRunningSkill 遇到上一条 user 消息就重新开始计本轮', async () => {
    const { findRunningSkill } = await import('./display-state')
    const messages: DisplayMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', toolUseId: 't1', name: 'Skill', input: { skill: 'old-skill' } }]
      },
      { role: 'user', content: [{ type: 'text', text: '新一轮' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我先读读文件' }]
      }
    ]
    expect(findRunningSkill(messages)).toBeNull()
  })

  it('summarizeTurnActivity 优先展示当前 pending 工具', () => {
    const messages: DisplayMessage[] = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 't1', name: 'Read', input: { file_path: 'README.md' } }
      ]
    }]

    expect(summarizeTurnActivity(messages, true)).toBe('正在阅读文件')
  })

  it('buildTurnStatusNotice 进行中且最后工具已返回时提示仍在等待 Claude', () => {
    const messages: DisplayMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: '继续' }]
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't1', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' } },
          { type: 'tool_result', toolUseId: 't1', content: 'Updated task #1 status' }
        ]
      }
    ]

    const notice = buildTurnStatusNotice(messages, true)

    expect(notice?.tone).toBe('running')
    expect(notice?.title).toContain('等待 Claude')
  })

  it('buildTurnStatusNotice 回合结束但只有任务状态更新且未写文档时给出提示', () => {
    const messages: DisplayMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: '继续' }]
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '知识库依据已收集到位，直接进入 PRD 写作。' },
          { type: 'tool_use', toolUseId: 't1', name: 'TaskCreate', input: { subject: '写 Pix 线下支付 PRD' } },
          { type: 'tool_result', toolUseId: 't1', content: 'Task #1 created successfully' },
          { type: 'tool_use', toolUseId: 't2', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' } },
          { type: 'tool_result', toolUseId: 't2', content: 'Updated task #1 status' }
        ]
      }
    ]

    const notice = buildTurnStatusNotice(messages, false)

    expect(notice?.tone).toBe('warning')
    expect(notice?.title).toContain('没有检测到文档写入')
    expect(notice?.detail).toContain('Write/Edit/MultiEdit')
  })

  it('buildTurnStatusNotice 优先使用 turn outcome 的 noWrite 状态', () => {
    const notice = buildTurnStatusNotice([], false, {
      status: 'completed',
      outcome: 'noWrite',
      changedArtifacts: []
    })

    expect(notice?.tone).toBe('warning')
    expect(notice?.title).toContain('没有检测到文档写入')
  })

  it('buildTurnStatusNotice turn outcome 带文件变化时展示成功提示', () => {
    const notice = buildTurnStatusNotice([], false, {
      status: 'completed',
      outcome: 'wroteFiles',
      changedArtifacts: ['prd.md']
    })

    expect(notice?.tone).toBe('success')
    expect(notice?.title).toContain('已更新 1 个文件')
    expect(notice?.detail).toContain('prd.md')
  })

  it('buildTurnStatusNotice turn error 时展示失败原因', () => {
    const notice = buildTurnStatusNotice([], false, {
      status: 'error',
      outcome: 'failed',
      changedArtifacts: [],
      errorMessage: 'Claude Code exited with code 1'
    })

    expect(notice?.tone).toBe('warning')
    expect(notice?.title).toContain('AI 执行失败')
    expect(notice?.detail).toContain('code 1')
  })

  it('buildTurnStatusNotice 已发生文档写入时不提示异常', () => {
    const messages: DisplayMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: '写 PRD' }]
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUseId: 't1', name: 'Write', input: { file_path: '测试pred.md' } },
          { type: 'tool_result', toolUseId: 't1', content: 'File written' }
        ]
      }
    ]

    expect(buildTurnStatusNotice(messages, false)).toBeNull()
  })

  it('buildApprovalContinuationPrompt 生成 UI 授权继续提示', () => {
    const prompt = buildApprovalContinuationPrompt('find . -name "*.md" | head')

    expect(prompt).toContain('我已在 UI 中授权执行下面这条 Bash 命令')
    expect(prompt).toContain('继续完成原任务')
    expect(prompt).toContain('find . -name "*.md" | head')
  })
})
