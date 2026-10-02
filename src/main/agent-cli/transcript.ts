import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { StreamJsonEvent } from '../claude-headless/spawn-turn'

export function cliTranscriptPath(sessionId: string): string {
  return join(app.getPath('userData'), 'agent-cli', 'sessions', `${sessionId}.jsonl`)
}
export function appendCliEvent(sessionId: string, event: StreamJsonEvent): void {
  const path = cliTranscriptPath(sessionId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(event)}\n`, { flag: 'a', mode: 0o600 })
}
export function cliNativeSessionId(sessionId: string): string | undefined {
  const path = cliTranscriptPath(sessionId)
  if (!existsSync(path)) return undefined
  for (const line of readFileSync(path, 'utf8').split('\n').reverse()) {
    try {
      const event = JSON.parse(line)
      if (event.type === 'system' && typeof event.nativeSessionId === 'string') return event.nativeSessionId
    } catch { /* incomplete record */ }
  }
  return undefined
}
export function removeCliTranscript(sessionId: string): void {
  rmSync(cliTranscriptPath(sessionId), { force: true })
  rmSync(join(dirname(cliTranscriptPath(sessionId)), `${sessionId}.pi.jsonl`), { force: true })
}
