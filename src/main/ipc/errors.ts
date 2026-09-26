// 把任意抛出物转成可序列化的 IPC 错误体。
// renderer 永远收到 { ok: false, code, message, details? } 形态。

// 项目集中定义的错误码常量（PM 重构 / KB 池）。
// 仍允许 throw new UIClientError('SOME_NEW_CODE', ...)，常量只是文档化常用项。
export const ERROR_CODES = {
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  NOT_DIR: 'NOT_DIR',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  DUPLICATE: 'DUPLICATE',
  CANCELLED: 'CANCELLED',
  PROTECTED: 'PROTECTED',
  KB_ALIAS_TAKEN: 'KB_ALIAS_TAKEN',
  KB_ALIAS_CONFLICT: 'KB_ALIAS_CONFLICT',
  GIT_FAILED: 'GIT_FAILED',
  SSH_KEY_REQUIRED: 'SSH_KEY_REQUIRED',
  SSH_AUTH_FAILED: 'SSH_AUTH_FAILED',
  SSH_KEYGEN_FAILED: 'SSH_KEYGEN_FAILED',
  SSH_KEY_CHANGED: 'SSH_KEY_CHANGED',
  SSH_KEY_INVALID: 'SSH_KEY_INVALID',
  SOURCE_GONE: 'SOURCE_GONE',
  SYMLINK_FAILED: 'SYMLINK_FAILED',
  IN_FLIGHT: 'IN_FLIGHT',
  PROJECT_DIR_MISSING: 'PROJECT_DIR_MISSING',
  TARGET_EXISTS: 'TARGET_EXISTS',
  NOT_A_REPO: 'NOT_A_REPO',
  NOT_A_DIR: 'NOT_A_DIR',
  BRANCH_CREATE_FAILED: 'BRANCH_CREATE_FAILED',
  UNKNOWN: 'UNKNOWN'
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

export class UIClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'UIClientError'
  }
}

export function serializeError(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof UIClientError) {
    return { code: err.code, message: err.message, details: err.details }
  }
  if (err instanceof Error) {
    return { code: 'UNKNOWN', message: err.message, details: { stack: err.stack } }
  }
  return { code: 'UNKNOWN', message: String(err) }
}
