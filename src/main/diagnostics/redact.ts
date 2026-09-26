const MAX_TEXT_LENGTH = 4_000

const SAFE_ATTRIBUTE_KEYS = new Set([
  'activeResources',
  'appVersion',
  'apiDurationMs',
  'appPrepareMs',
  'arch',
  'binAccess',
  'binState',
  'cacheCreationInputTokens',
  'cacheReadInputTokens',
  'category',
  'claudeDurationMs',
  'chromeVersion',
  'cliFound',
  'cliKind',
  'code',
  'codeRetrievalCount',
  'durationMs',
  'cwdAccess',
  'cwdState',
  'electronVersion',
  'eventType',
  'errno',
  'epipeCount',
  'exitCode',
  'fdBaselineCount',
  'fdBlockCount',
  'fdCharacterCount',
  'fdCount',
  'fdDeltaFromBaseline',
  'fdDirectoryCount',
  'fdFifoCount',
  'fileCount',
  'fdFileCount',
  'fdInvalidCount',
  'fdHighWater',
  'fdMax',
  'fdNext',
  'fdNextCode',
  'fdOtherCount',
  'fdSampledCount',
  'fdScanCode',
  'fdScanTruncated',
  'fdSocketCount',
  'firstAssistantMs',
  'firstProtocolMs',
  'firstVisibleTextMs',
  'hasAnthropicKey',
  'inputBytes',
  'inputTokens',
  'initialProbeCode',
  'isPackaged',
  'knowledgeRetrievalCount',
  'lastEpipeAgoMs',
  'name',
  'nodeVersion',
  'numTurns',
  'oldestAt',
  'outputBytes',
  'outputTokens',
  'parentProcessId',
  'phase',
  'pidPresent',
  'platform',
  'probeIgnoreDetached',
  'probePipeAttached',
  'probePipeDetached',
  'probePipeDetachedCwd',
  'processId',
  'reason',
  'relativePath',
  'repairedFds',
  'retrievalCount',
  'retrievalWallMs',
  'resume',
  'sessionTarget',
  'signal',
  'spawnDetached',
  'spawnStdio',
  'statusCode',
  'stderrFdState',
  'stderrStreamState',
  'stdinFdState',
  'stdinStreamState',
  'subtype',
  'success',
  'stdoutFdState',
  'stdoutStreamState',
  'syscall',
  'toolCategory',
  'toolName',
  'totalCostUsd',
  'totalBytes',
  'writeCount'
])

export type DiagnosticPrimitive = string | number | boolean

export type SerializedDiagnosticError = {
  name: string
  message: string
  stack?: string
  code?: string
}

export function sanitizeCorrelationId(value: string): string {
  return /^[a-z0-9._:-]{1,200}$/i.test(value) ? value : '[REDACTED]'
}

export function redactText(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bsk-ant-[a-z0-9_-]+\b/gi, '[REDACTED]')
    .replace(/\b(token|password|passwd|secret|api[_-]?key|pat)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\/Users\/[^/\s]+/g, '~')
    .replace(/\/home\/[^/\s]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
    .slice(0, MAX_TEXT_LENGTH)
}

export function sanitizeAttributes(
  input: Record<string, unknown>
): Record<string, DiagnosticPrimitive> {
  const output: Record<string, DiagnosticPrimitive> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_ATTRIBUTE_KEYS.has(key)) continue
    if (typeof value === 'string') output[key] = redactText(value)
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value
    else if (typeof value === 'boolean') output[key] = value
  }
  return output
}

export function serializeDiagnosticError(error: unknown): SerializedDiagnosticError {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: redactText(String(error)) }
  }
  const code = (error as NodeJS.ErrnoException).code
  return {
    name: redactText(error.name || 'Error'),
    message: redactText(error.message),
    ...(error.stack ? { stack: redactText(error.stack) } : {}),
    ...(typeof code === 'string' ? { code: redactText(code) } : {})
  }
}
