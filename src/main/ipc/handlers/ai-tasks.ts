import { registerIpcHandler } from '../registry'
import { getSharedAiTaskRegistry } from '../../ai-tasks/service'
import {
  isAiTaskNotchWindow,
  moveAiTaskNotchBy,
  presentAiTaskNotch,
  setAiTaskNotchPanelHeight,
  setAiTaskNotchState
} from '../../ai-tasks/notch-window'
import { abortClaudeSession } from './claude'
import { BrowserWindow } from 'electron'
import { UIClientError } from '../errors'
import type { AiTaskSummary } from '../../../shared/types'

function emitAiTaskChanged(taskId: string): void {
  void getSharedAiTaskRegistry().get(taskId).then((task) => {
    for (const target of BrowserWindow.getAllWindows()) {
      target.webContents.send('ai-task.changed', task ?? null)
    }
    // 有任务转到"等我"状态就把灵动岛顶到前台（不抢焦点）
    if (task?.status === 'waiting_user' || task?.status === 'waiting_approval') {
      presentAiTaskNotch()
    }
  }).catch((error) => {
    console.error('[ai-task] failed to emit task change:', error)
  })
}

function canMarkAborted(task: AiTaskSummary): boolean {
  return task.status === 'running'
    || task.status === 'waiting_user'
    || task.status === 'waiting_approval'
}

function mainWindowCandidates(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => !isAiTaskNotchWindow(win))
}

function focusMainWindowForTask(taskId: string): void {
  const target = mainWindowCandidates()[0]
  if (!target) throw new UIClientError('NO_WINDOW', '没有可用主窗口')
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
  target.webContents.send('ai-task.open', { taskId })
}

export function registerAiTaskHandlers(): void {
  registerIpcHandler('aiTask.list', async () => {
    return getSharedAiTaskRegistry().list()
  })

  registerIpcHandler('aiTask.get', async ({ taskId }) => {
    return getSharedAiTaskRegistry().get(taskId)
  })

  registerIpcHandler('aiTask.abort', async ({ taskId }) => {
    const registry = getSharedAiTaskRegistry()
    const task = await registry.get(taskId)
    if (!task) throw new UIClientError('NOT_FOUND', 'AI 任务不存在')

    const processAborted = await abortClaudeSession(task.sessionId)
    const shouldMarkAborted = processAborted || canMarkAborted(task)
    if (shouldMarkAborted) {
      await registry.markAborted(taskId)
      emitAiTaskChanged(taskId)
    }
    return { ok: shouldMarkAborted }
  })

  registerIpcHandler('aiTask.dismiss', async ({ taskId }) => {
    const registry = getSharedAiTaskRegistry()
    const task = await registry.get(taskId)
    if (!task) return { ok: false }
    // 如果任务还在活跃状态，先 abort 让 spawn-turn 停下来，再从记录里移除
    if (canMarkAborted(task)) {
      await abortClaudeSession(task.sessionId).catch(() => undefined)
    }
    const removed = await registry.dismiss(taskId)
    if (removed) {
      // 广播 removed（payload = null）给所有窗口，让 renderer store 顺势 filter 掉
      for (const target of BrowserWindow.getAllWindows()) {
        target.webContents.send('ai-task.changed', null)
      }
    }
    return { ok: removed }
  })

  registerIpcHandler('aiTask.open', async ({ taskId }) => {
    const task = await getSharedAiTaskRegistry().get(taskId)
    if (!task) throw new UIClientError('NOT_FOUND', 'AI 任务不存在')
    focusMainWindowForTask(taskId)
  })

  registerIpcHandler('aiTask.notch.setState', async ({ state }) => {
    setAiTaskNotchState(state)
  })

  registerIpcHandler('aiTask.notch.setPanelHeight', async ({ height }) => {
    setAiTaskNotchPanelHeight(height)
  })

  registerIpcHandler('aiTask.notch.moveBy', async ({ dx, dy }) => {
    moveAiTaskNotchBy(dx, dy)
  })
}
