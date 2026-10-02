import { CliAgentDriver } from '../../agent-cli/driver'
import { isCliAiProvider } from '../../../shared/ai-provider'
// driver 入口：导出唯一的进程级实例 + 类型。
//
// 当前默认是 LegacySpawnDriver（每 turn spawn）；LongRunningDriver 是骨架，
// 暂未启用。env CLAUDE_HEADLESS_DRIVER=long-running 走骨架（会抛 not implemented，
// 仅供开发调试）；其它任何值 / 未设置都走 legacy。
import { LegacySpawnDriver } from './legacy-spawn'
import { LongRunningDriver } from './long-running'
import type { AgentDriver } from './types'
import { DeepSeekHarnessDriver } from '../../deepseek-harness/driver'

export type { AgentDriver } from './types'

let instance: AgentDriver | null = null

export function getAgentDriver(): AgentDriver {
  if (!instance) instance = createDefaultDriver()
  return instance
}

// 测试用：替换 driver 实例
export function setAgentDriverForTests(driver: AgentDriver): void {
  instance = driver
}

function createDefaultDriver(): AgentDriver {
  const claudeDriver = createClaudeDriver()
  return new ProviderRoutingDriver(claudeDriver, new DeepSeekHarnessDriver())
}

function createClaudeDriver(): AgentDriver {
  if (process.env.CLAUDE_HEADLESS_DRIVER === 'long-running') {
    console.warn('[claude-driver] LongRunningDriver not yet implemented; expect submit() to throw.')
    return new LongRunningDriver()
  }
  return new LegacySpawnDriver()
}

class ProviderRoutingDriver implements AgentDriver {
  constructor(
    private readonly claude: AgentDriver,
    private readonly deepSeek: AgentDriver,
    private readonly cli: AgentDriver = new CliAgentDriver()
  ) {}

  submit(input: Parameters<AgentDriver['submit']>[0]): ReturnType<AgentDriver['submit']> {
    if (isCliAiProvider(input.aiProvider)) return this.cli.submit(input)
    return input.aiProvider === 'deepseek-harness'
      ? this.deepSeek.submit(input)
      : this.claude.submit(input)
  }

  async abort(sessionId: string): Promise<boolean> {
    const [claude, deepSeek, cli] = await Promise.all([
      this.claude.abort(sessionId),
      this.deepSeek.abort(sessionId),
      this.cli.abort(sessionId)
    ])
    return claude || deepSeek || cli
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.claude.hasActiveTurn(sessionId) || this.deepSeek.hasActiveTurn(sessionId) || this.cli.hasActiveTurn(sessionId)
  }

  async shutdown(): Promise<void> {
    await Promise.all([this.claude.shutdown(), this.deepSeek.shutdown(), this.cli.shutdown()])
  }
}
