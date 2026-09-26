import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import type { ExternalRefHint } from './compose-prompt'

export const MAX_RESOURCE_INSTRUCTION_BYTES = 12 * 1024
export const MAX_TOTAL_RESOURCE_INSTRUCTION_BYTES = 32 * 1024

function truncateUtf8(input: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(input, 'utf8')
  if (buffer.byteLength <= maxBytes) return { text: input, truncated: false }
  const text = buffer.subarray(0, Math.max(0, maxBytes)).toString('utf8').replace(/\uFFFD$/, '')
  return { text, truncated: true }
}

function isExpectedInstructionPath(ref: ExternalRefHint): boolean {
  return ref.instructionPath === `.external/${ref.alias}/AI_USAGE.md`
}

function readInstructionPrefix(path: string, maxBytes: number): { text: string; truncated: boolean } {
  const fd = openSync(path, 'r')
  try {
    const stat = fstatSync(fd)
    const length = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(length)
    const bytesRead = readSync(fd, buffer, 0, length, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8').replace(/\uFFFD$/, '')
    return { text, truncated: stat.size > maxBytes }
  } finally {
    closeSync(fd)
  }
}

export function loadResourceInstructions(
  projectPath: string,
  refs: ExternalRefHint[]
): ExternalRefHint[] {
  let remaining = MAX_TOTAL_RESOURCE_INSTRUCTION_BYTES
  return refs.map((ref) => {
    const next: ExternalRefHint = { ...ref }
    let truncated = false
    if (ref.instructionPath && isExpectedInstructionPath(ref) && remaining > 0) {
      try {
        const limit = Math.min(MAX_RESOURCE_INSTRUCTION_BYTES, remaining)
        const result = readInstructionPrefix(join(projectPath, ref.instructionPath), limit)
        remaining -= Buffer.byteLength(result.text, 'utf8')
        if (result.text.trim()) next.instructions = result.text.trim()
        truncated ||= result.truncated
      } catch {
        // 缺失或不可读不阻断 AI 请求。
      }
    }
    if (ref.usageNote) {
      const result = truncateUtf8(ref.usageNote, remaining)
      remaining -= Buffer.byteLength(result.text, 'utf8')
      next.usageNote = result.text.trim()
      truncated ||= result.truncated
    }
    if (truncated) next.instructionsTruncated = true
    return next
  })
}
