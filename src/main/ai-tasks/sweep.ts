import type { AiTaskStatus } from '@shared/types'
import { getSharedAiTaskRegistry } from './service'

// App 启动扫描：把上次进程死掉时"仍在活跃状态"的 AI 任务全部标为 aborted。
// 场景：用户上次跑着 running / waiting_* 的任务时 App 意外退出 / 重启，Claude
// 子进程随主进程一起消失，但 tasks.json 里的状态没来得及更新，重启后灵动岛
// 展示的是僵尸"运行中"任务。这里在启动早期把它们归零。
const ACTIVE_STATUSES: readonly AiTaskStatus[] = ['running', 'waiting_user', 'waiting_approval']

export async function sweepStaleAiTasks(): Promise<{ swept: number }> {
  const registry = getSharedAiTaskRegistry()
  const tasks = await registry.list().catch(() => [])
  let swept = 0
  for (const task of tasks) {
    if (ACTIVE_STATUSES.includes(task.status)) {
      await registry.markAborted(task.id).catch(() => undefined)
      swept += 1
    }
  }
  return { swept }
}
