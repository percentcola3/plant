// LegacySpawnDriver：每 turn 跑一次 `claude --print`，stdout 流式 JSON 推 IPC。
// 这是当前正在用的行为；包成 driver 接口只是为了让别的实现能并存 / 替换。
//
// 行为对齐原 claude.ts 内联 activeTurns Map：
//   - submit 自动注册到 activeTurns，turn 退出后自动清理
//   - abort sessionId 上的 turn；找不到就返回 false（保留旧 IPC 的 ok:false 语义）
//   - shutdown 时全部 abort
import { spawnTurn, spawnResumeTurn, type TurnHandle, type TurnInput } from '../spawn-turn'
import type { AgentDriver } from './types'

export class LegacySpawnDriver implements AgentDriver {
  private readonly activeTurns = new Map<string, TurnHandle>()

  submit(input: TurnInput): TurnHandle {
    const handle = input.resume ? spawnResumeTurn(input) : spawnTurn(input)
    this.activeTurns.set(input.sessionId, handle)
    handle.onExit(() => {
      // 只有还是同一个 handle 时才清理；防止 abort+重 submit 的竞态把新 handle 删了
      if (this.activeTurns.get(input.sessionId) === handle) {
        this.activeTurns.delete(input.sessionId)
      }
    })
    return handle
  }

  async abort(sessionId: string): Promise<boolean> {
    const handle = this.activeTurns.get(sessionId)
    if (!handle) return false
    await handle.abort()
    this.activeTurns.delete(sessionId)
    return true
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.activeTurns.has(sessionId)
  }

  async shutdown(): Promise<void> {
    const handles = Array.from(this.activeTurns.values())
    this.activeTurns.clear()
    await Promise.all(handles.map(handle => handle.abort().catch((error) => {
      console.error('[claude-driver] abort failed during shutdown:', error)
    })))
  }
}
