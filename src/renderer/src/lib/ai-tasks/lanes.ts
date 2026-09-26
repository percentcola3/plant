import type { AiTaskLaneId, AiTaskSummary } from '@shared/types'

export type AiTaskLane = {
  id: AiTaskLaneId
  title: string
  tasks: AiTaskSummary[]
}

const LANE_TITLES: Record<AiTaskLaneId, string> = {
  running: '运行中',
  waiting: '等待我',
  done: '已结束'
}

function laneForStatus(status: AiTaskSummary['status']): AiTaskLaneId {
  if (status === 'running') return 'running'
  if (status === 'waiting_user' || status === 'waiting_approval') return 'waiting'
  return 'done'
}

export function groupAiTasksByLane(tasks: AiTaskSummary[]): AiTaskLane[] {
  const lanes: AiTaskLane[] = (['running', 'waiting', 'done'] as AiTaskLaneId[])
    .map((id) => ({ id, title: LANE_TITLES[id], tasks: [] }))
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  for (const task of tasks) {
    byId.get(laneForStatus(task.status))?.tasks.push(task)
  }
  return lanes
}
