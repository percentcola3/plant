// AgentDriver：把"如何驱动 Claude"从 IPC handler 里抽出来。
//
// 当前唯一实现是 LegacySpawnDriver（每轮 spawn 一次 claude --print）。
// 未来要加：
//   - HookEnabledDriver：基于 LegacySpawn + .claude/settings.json hooks 做写入边界拦截
//   - LongRunningDriver：claude --resume 长驻进程多轮复用 stdin，干掉冷启动
//   - SdkDriver（远期）：如果有一天真的迁 SDK
//
// driver 之间可以同时存在，env / settings 决定用哪个。
import type { TurnHandle, TurnInput } from '../spawn-turn'

export interface AgentDriver {
  // 提交一轮对话。input.resume 由调用方根据 jsonl 是否已存在决定。
  submit(input: TurnInput): TurnHandle

  // 中止 sessionId 上的 in-flight turn。返回 true 表示确实有 turn 被中止。
  abort(sessionId: string): Promise<boolean>

  // sessionId 是否有 in-flight turn。submit 之前用来 reject 重复提交。
  hasActiveTurn(sessionId: string): boolean

  // 应用退出时调用，确保所有子进程被回收。
  shutdown(): Promise<void>
}
