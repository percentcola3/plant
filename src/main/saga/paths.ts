import { join } from 'node:path'
import { uiClientDir } from '../workspaces/paths'

export const SAGAS_SUBDIR = 'sagas'
export const SAGAS_DONE_SUBDIR = 'done'

export function sagasDir(workspacePath: string): string {
  return join(uiClientDir(workspacePath), SAGAS_SUBDIR)
}

export function sagasDoneDir(workspacePath: string): string {
  return join(uiClientDir(workspacePath), SAGAS_SUBDIR, SAGAS_DONE_SUBDIR)
}

export function sagaJournalPath(workspacePath: string, id: string): string {
  return join(sagasDir(workspacePath), `${id}.json`)
}

export function sagaDonePath(workspacePath: string, id: string): string {
  return join(sagasDoneDir(workspacePath), `${id}.json`)
}
