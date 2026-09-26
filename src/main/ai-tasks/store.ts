import { atomicWriteJson, readJson } from '../util/atomic-write'
import type { AiTaskSummary } from '@shared/types'

type AiTaskFile = {
  schemaVersion: 1
  tasks: AiTaskSummary[]
}

function emptyFile(): AiTaskFile {
  return { schemaVersion: 1, tasks: [] }
}

function sortTasks(tasks: AiTaskSummary[]): AiTaskSummary[] {
  return [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export class AiTaskStore {
  constructor(readonly filePath: string) {}

  async list(): Promise<AiTaskSummary[]> {
    const file = await this.read()
    return sortTasks(file.tasks)
  }

  async get(id: string): Promise<AiTaskSummary | null> {
    const file = await this.read()
    return file.tasks.find((task) => task.id === id) ?? null
  }

  async getBySessionId(sessionId: string): Promise<AiTaskSummary | null> {
    const file = await this.read()
    return file.tasks.find((task) => task.sessionId === sessionId) ?? null
  }

  async upsert(task: AiTaskSummary): Promise<void> {
    const file = await this.read()
    const tasks = file.tasks.filter((item) => item.id !== task.id)
    tasks.push(task)
    await atomicWriteJson(this.filePath, { schemaVersion: 1, tasks: sortTasks(tasks) })
  }

  async replaceWhere(
    task: AiTaskSummary,
    shouldReplace: (item: AiTaskSummary) => boolean
  ): Promise<AiTaskSummary[]> {
    const file = await this.read()
    const replaced: AiTaskSummary[] = []
    const tasks = file.tasks.filter((item) => {
      if (item.id === task.id) return false
      if (!shouldReplace(item)) return true
      replaced.push(item)
      return false
    })
    tasks.push(task)
    await atomicWriteJson(this.filePath, { schemaVersion: 1, tasks: sortTasks(tasks) })
    return replaced
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.read()
    const before = file.tasks.length
    const tasks = file.tasks.filter((item) => item.id !== id)
    if (tasks.length === before) return false
    await atomicWriteJson(this.filePath, { schemaVersion: 1, tasks: sortTasks(tasks) })
    return true
  }

  private async read(): Promise<AiTaskFile> {
    const file = await readJson<AiTaskFile>(this.filePath)
    if (!file || file.schemaVersion !== 1 || !Array.isArray(file.tasks)) return emptyFile()
    return file
  }
}
