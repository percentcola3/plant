// claude 在正常工作时也会往 stderr 打一堆 noise（telemetry、deprecation 警告、
// MCP handshake 日志、node 实验性警告）。全量推 console.warn 会污染诊断日志，
// 也让 [claude-headless:diag] exit 的 stderrTail 混入无关行。
//
// 这里按行过滤掉已知噪声，只保留真正的错误/告警。保守策略：宁可漏过（保留）
// 不可误杀（吞掉真实错误）—— 任何含 error/fatal/panic 的行一律保留。
//
// 对标 open-design createAgentStderrVisibilityFilter，但裁剪到 claude 单 agent。

const SUPPRESSED_PATTERNS = [
  /^\s*$/,                                      // 空行
  /\btelemetry\b/i,                            // 遥测上报
  /\[MCP\]/i,                                  // MCP handshake（除非带 error）
  /ExperimentalWarning/,                       // node 实验性警告
  /DeprecationWarning.*(?:punycode|crypto)/i   // node 弃用警告（claude 常见）
]

function filterLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      // 含 error/fatal/panic/failed 的行一律保留，即使匹配了抑制模式
      if (/\b(error|fatal|panic|failed)\b/i.test(line)) return true
      return !SUPPRESSED_PATTERNS.some((re) => re.test(line))
    })
    .join('\n')
}

// 纯函数变体：对一整块文本做一次性过滤。适用于无跨 chunk 状态的场景。
export function filterStderrChunk(chunk: string): string {
  return filterLines(chunk)
}

// 有状态变体：正确处理跨 chunk 的行边界。stderr 是流式到达的，一个 chunk 可能
// 在行中间切断。pending 只保留最后一段没有换行符的尾巴，下次 write 拼上后续。
export function createStderrFilter(): { write(chunk: string): string; flush(): string } {
  let pending = ''
  return {
    write(chunk: string) {
      pending += chunk
      const lastNl = pending.lastIndexOf('\n')
      if (lastNl === -1) return ''   // 还没凑成完整行，全部留 pending
      const complete = pending.slice(0, lastNl + 1)
      pending = pending.slice(lastNl + 1)
      return filterLines(complete)
    },
    flush() {
      const rest = pending
      pending = ''
      return rest ? filterLines(rest) : ''
    }
  }
}
