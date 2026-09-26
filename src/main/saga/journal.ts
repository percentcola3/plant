import { promises as fs } from 'node:fs'
import { atomicWriteJson, readJson } from '../util/atomic-write'
import { sagaDonePath, sagaJournalPath, sagasDir, sagasDoneDir } from './paths'
import type { SagaJournal } from './types'

const DONE_TTL_MS = 7 * 24 * 60 * 60 * 1000        // 完成的 saga 保留 7 天

export async function writeJournal(journal: SagaJournal): Promise<void> {
  await atomicWriteJson(sagaJournalPath(journal.workspacePath, journal.id), journal)
}

export async function readJournal(workspacePath: string, id: string): Promise<SagaJournal | null> {
  const j = await readJson<SagaJournal>(sagaJournalPath(workspacePath, id))
  if (!j) return null
  if (j.schemaVersion !== 1) return { ...j, status: 'corrupted', schemaVersion: 1 }
  return j
}

export async function listIncompleteJournals(workspacePath: string): Promise<SagaJournal[]> {
  const dir = sagasDir(workspacePath)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: SagaJournal[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const j = await readJson<SagaJournal>(`${dir}/${name}`)
    if (!j) continue
    if (j.status === 'done') continue
    out.push(j)
  }
  out.sort((a, b) => a.lastTouchedAt.localeCompare(b.lastTouchedAt))
  return out
}

export async function archiveJournal(journal: SagaJournal): Promise<void> {
  const target = sagaDonePath(journal.workspacePath, journal.id)
  await atomicWriteJson(target, journal)
  await fs.rm(sagaJournalPath(journal.workspacePath, journal.id), { force: true }).catch(() => undefined)
}

export async function purgeOldDoneJournals(workspacePath: string, now = Date.now()): Promise<number> {
  const dir = sagasDoneDir(workspacePath)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  let removed = 0
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = `${dir}/${name}`
    const j = await readJson<SagaJournal>(path)
    if (!j) {
      await fs.rm(path, { force: true }).catch(() => undefined)
      removed += 1
      continue
    }
    const t = Date.parse(j.lastTouchedAt)
    if (Number.isFinite(t) && now - t > DONE_TTL_MS) {
      await fs.rm(path, { force: true }).catch(() => undefined)
      removed += 1
    }
  }
  return removed
}
