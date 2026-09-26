// LongRunningDriver（骨架）：长驻 claude 子进程多轮复用 stdin，目标是干掉每轮 spawn
// 的冷启动成本（500ms-3s），把首 token 延迟降到 streaming-input 模式那种几百 ms 量级。
//
// 当前状态：未启用，默认 driver 仍是 LegacySpawnDriver（参见 driver/index.ts）。
// 这里只搭好接口骨架和实现路径文档，等需要时可以单独迭代。
//
// === 实现计划 ===
//
// 1. 进程池：每个 (projectPath, sessionId) 维护一个长驻 child。
//    - 首次 submit：spawn `claude --print --input-format stream-json
//      --output-format stream-json --verbose --session-id <id>`（也可以 --resume）
//    - 后续 submit：复用同一个 child，往 stdin 持续 write 新的 user 事件
//    - claude CLI 在 stream-json input 模式下应当持续读 stdin 直到 close
//      （需要 spike 验证：单进程多 turn 行为是否真的稳定，stream-json 输入模式
//       claude CLI 读完一条用户消息之后是不是处于"等下一条"状态。这一点是核心未知。）
//
// 2. 事件流多路复用：
//    - stdout 是连续的 stream-json 行，每行带 session_id；按 session_id 路由到对应的
//      IPC channel `claude.delta:<sessionId>`（行为和 LegacySpawn 一致）
//    - 每条 turn 以 type='result' 收尾，作为 turn 结束信号，触发 `claude.turn-end`
//
// 3. 生命周期：
//    - 闲置 N 分钟后回收（避免长跑进程吃内存）
//    - app shutdown 时全部 SIGTERM
//    - sessionId 切换时不一定 kill：如果 claude 支持单进程多 session（待验），可以共用
//
// 4. abort 语义：
//    - 当前 turn 进行中：close stdin？发送 cancel 事件？需要 spike 看 claude CLI
//      streaming-input 模式如何 abort 一条进行中的 turn 而不杀整个进程
//    - 如果做不到细粒度 abort，回退到杀进程 + 重 spawn
//
// 5. 错误恢复：
//    - 进程崩了：重 spawn，事件流继续
//    - 进程僵死（无 stdout > 30s）：杀掉重启
//
// === 切换方式 ===
//
// 在 driver/index.ts 的 createDefaultDriver 里：
//   - 读 settings 或 env（CLAUDE_HEADLESS_DRIVER=long-running）
//   - 命中就 new LongRunningDriver()
//   - 否则保持 LegacySpawnDriver
//
// 灰度阶段两个 driver 共存零风险。
//
// === 已知 spike 项 ===
//
// [ ] claude --print --input-format stream-json 在写完一条 stream-json user 事件
//     后，是不是真的等 stdin 下一条而不退出？还是 --print 隐含 single-shot 语义？
//     从 README 看 `--print` 是 non-interactive flag，倾向 single-shot。可能需要不带
//     `--print`（即默认 interactive 但驱动 stdin）—— 但 interactive 模式输出格式不同。
//     先做这个 spike 决定大方向。
// [ ] 如果 --print 真的是 single-shot，方案变成"长 idle 进程池"——pre-spawn 一批
//     已经 resume 好的子进程，submit 时拿一个用，避免 cold-start。这个性价比可能更
//     直接：不改协议、不改输入格式，只把启动成本提前到空闲时间。
import type { AgentDriver } from './types'
import type { TurnHandle, TurnInput } from '../spawn-turn'

export class LongRunningDriver implements AgentDriver {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  submit(_input: TurnInput): TurnHandle {
    throw new Error('LongRunningDriver: not yet implemented. See file header for plan.')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async abort(_sessionId: string): Promise<boolean> {
    return false
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  hasActiveTurn(_sessionId: string): boolean {
    return false
  }

  async shutdown(): Promise<void> {
    /* no-op until implemented */
  }
}
