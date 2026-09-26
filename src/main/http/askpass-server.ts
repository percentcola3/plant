import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { app, BrowserWindow, safeStorage } from 'electron'
import { join } from 'node:path'

// 本地 HTTP askpass 服务：git 通过 GIT_ASKPASS 环境变量 spawn askpass-helper.sh，
// 脚本 curl 到本服务。两条路径：
//   /askpass         交互式：缓存命中→200，未命中→推 PATPromptDialog 等用户输入
//   /askpass/cached  cache-only：缓存命中→200，未命中→499 静默失败（不弹 UI）
// 端口随机绑定到 127.0.0.1 + 一次性 token，只在 App 运行期有效。
// 用户勾"记住"的凭证用 safeStorage 加密落 userData/askpass-creds.enc，跨会话复用。

type PendingPrompt = {
  resolve: (answer: string) => void
  reject: (err: Error) => void
  cacheKey: string | null
}

class AskpassServer {
  private server: http.Server | null = null
  private port = 0
  private token = ''
  private pendingId = 0
  private pending = new Map<number, PendingPrompt>()
  private rememberedAnswers = new Map<string, string>() // host + prompt kind -> credential

  // renderer 侧调用：把 promptId 对应的答案送回来
  respond(promptId: number, answer: string, remember?: { host: string }): void {
    const p = this.pending.get(promptId)
    if (!p) return
    if (remember && p.cacheKey) {
      this.rememberedAnswers.set(p.cacheKey, answer)
      void this.persistCreds()
    }
    p.resolve(answer)
    this.pending.delete(promptId)
  }

  // renderer 取消
  cancel(promptId: number): void {
    const p = this.pending.get(promptId)
    if (!p) return
    p.reject(new Error('cancelled'))
    this.pending.delete(promptId)
  }

  forgetHost(host: string): void {
    this.rememberedAnswers.delete(host)
    this.rememberedAnswers.delete(`${host}:username`)
    this.rememberedAnswers.delete(`${host}:password`)
    void this.persistCreds()
  }

  // 设置里手动新增 / 编辑 host 凭证。username / password 任意一个传空字符串 = 不改这个字段
  // （编辑场景：用户只想换密码，username 字段留空就维持原值）；两个都给才是完整新增。
  // 调用方应保证 host 已 trim。
  setCred(host: string, username?: string, password?: string): void {
    if (!host) return
    if (typeof username === 'string' && username.length > 0) {
      this.rememberedAnswers.set(`${host}:username`, username)
    }
    if (typeof password === 'string' && password.length > 0) {
      this.rememberedAnswers.set(`${host}:password`, password)
    }
    void this.persistCreds()
  }

  async clearAllCreds(): Promise<void> {
    this.rememberedAnswers.clear()
    await fs.rm(credsFilePath(), { force: true }).catch(() => undefined)
  }

  // 给 Settings 凭证面板用：列已缓存的 host 概览。
  // 不暴露密码 / token 实际值，只暴露 username（PAT 通常是 username = git 邮箱 + token = secret）
  // 和 hasPassword 标识。
  listCachedCreds(): Array<{ host: string; username: string | null; hasPassword: boolean }> {
    const hosts = new Map<string, { username: string | null; hasPassword: boolean }>()
    for (const key of this.rememberedAnswers.keys()) {
      // 三种 key：'host'（旧版兜底）、'host:username'、'host:password'
      const colon = key.lastIndexOf(':')
      let host = key
      let kind: 'username' | 'password' | 'plain' = 'plain'
      if (colon >= 0) {
        const tail = key.slice(colon + 1)
        if (tail === 'username' || tail === 'password') {
          host = key.slice(0, colon)
          kind = tail
        }
      }
      const cur = hosts.get(host) ?? { username: null, hasPassword: false }
      if (kind === 'username') cur.username = this.rememberedAnswers.get(key) ?? null
      if (kind === 'password' || kind === 'plain') cur.hasPassword = true
      hosts.set(host, cur)
    }
    return [...hosts.entries()]
      .map(([host, info]) => ({ host, ...info }))
      .sort((a, b) => a.host.localeCompare(b.host))
  }

  private async loadPersistedCreds(): Promise<void> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return
      const buf = await fs.readFile(credsFilePath())
      const json = safeStorage.decryptString(buf)
      const obj = JSON.parse(json) as Record<string, string>
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') this.rememberedAnswers.set(k, v)
        }
      }
    } catch {
      // 文件不存在 / 解密失败（OS keychain backend 切了）→ 当作干净启动
    }
  }

  private async persistCreds(): Promise<void> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return
      const obj = Object.fromEntries(this.rememberedAnswers.entries())
      const enc = safeStorage.encryptString(JSON.stringify(obj))
      await fs.writeFile(credsFilePath(), enc, { mode: 0o600 })
    } catch (e) {
      console.warn('[askpass] persist creds failed:', (e as Error).message)
    }
  }

  async start(): Promise<{ url: string; token: string }> {
    if (this.server) {
      return { url: `http://127.0.0.1:${this.port}/askpass`, token: this.token }
    }
    this.token = randomBytes(24).toString('hex')
    await this.loadPersistedCreds()

    const server = http.createServer((req, res) => {
      const url = req.url ?? ''
      const isCached = url.startsWith('/askpass/cached')
      const isInteractive = !isCached && url.startsWith('/askpass')
      if (req.method !== 'POST' || (!isCached && !isInteractive)) {
        res.statusCode = 404
        res.end()
        return
      }
      if (req.headers['x-token'] !== this.token) {
        res.statusCode = 403
        res.end()
        return
      }
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          const { prompt } = JSON.parse(body || '{}') as { prompt?: string }
          const promptText = String(prompt ?? '')
          const cacheKey = cacheKeyForPrompt(promptText)
          // 缓存命中：两条路径都直接返回——背景 git 因此能复用之前用户输入过的 PAT
          if (cacheKey) {
            const cached = this.rememberedAnswers.get(cacheKey)
            if (cached) {
              res.statusCode = 200
              res.end(cached)
              return
            }
          }
          if (isCached) {
            // cache-only 路径：未命中 → 499 静默失败，绝不弹 PATPromptDialog
            res.statusCode = 499
            res.end()
            return
          }
          const answer = await this.askRenderer(promptText)
          res.statusCode = 200
          res.end(answer)
        } catch {
          // 取消 / 超时 / 其它错误：返回 499 + 空 body。配合 helper.sh 的 curl -f，
          // helper 会以非 0 退出，git 拿不到答案直接结束这一轮 auth。
          // 千万不要把 error.message 写进 body —— git 会把它当成用户答案。
          res.statusCode = 499
          res.end()
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('server address invalid')
    this.port = addr.port
    this.server = server
    return { url: `http://127.0.0.1:${this.port}/askpass`, token: this.token }
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = null
    this.port = 0
    this.token = ''
    for (const p of this.pending.values()) p.reject(new Error('server closed'))
    this.pending.clear()
  }

  private askRenderer(prompt: string): Promise<string> {
    const id = ++this.pendingId
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, cacheKey: cacheKeyForPrompt(prompt) })
      // 推到所有 renderer 窗口
      const payload = { id, prompt }
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('askpass.request', payload)
      }
      // 60s 超时兜底
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('askpass timed out'))
        }
      }, 60_000)
    })
  }
}

function extractHost(prompt: string): string | null {
  // git 的 prompt 例：
  // "Username for 'https://github.com': "
  // "Password for 'https://user@github.com': "
  const m = prompt.match(/['"]([^'"]+)['"]/)
  if (!m) return null
  try {
    return new URL(m[1]).host
  } catch {
    return m[1]
  }
}

function promptKind(prompt: string): 'username' | 'password' {
  return /password|token|passphrase/i.test(prompt) ? 'password' : 'username'
}

export function cacheKeyForPrompt(prompt: string): string | null {
  const host = extractHost(prompt)
  if (!host) return null
  return `${host}:${promptKind(prompt)}`
}

export const askpassServer = new AskpassServer()

function credsFilePath(): string {
  return join(app.getPath('userData'), 'askpass-creds.enc')
}

export function askpassHelperPath(): string {
  return join(app.getPath('userData'), 'askpass-helper.sh')
}

export function askpassCachedHelperPath(): string {
  return join(app.getPath('userData'), 'askpass-cached-helper.sh')
}

// 交互式 helper：被前台 git 操作（clone / 用户主动同步等）通过 GIT_ASKPASS 调用。
// 缓存命中直接返回；未命中由 askpass-server 推 PATPromptDialog 等用户输入。
export async function ensureAskpassHelper(): Promise<string> {
  const path = askpassHelperPath()
  const content = `#!/bin/sh
# -f：4xx/5xx 时不输出 body 且退出非 0。askpass-server 在取消时返回 499，
# 这里就会被吞掉而不是把 "cancelled" / 错误信息当成用户输入打回 git stdout。
exec curl -s -f --max-time 60 -X POST \\
  -H "X-Token: $UI_CLIENT_ASKPASS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"prompt\\":\\"$1\\"}" \\
  "$UI_CLIENT_ASKPASS_URL"
`
  await fs.writeFile(path, content, { mode: 0o755 })
  return path
}

// cache-only helper：被后台 git 操作（hydrate / auto-refresh）通过 GIT_ASKPASS 调用。
// 仅查 askpass-server 缓存（含 safeStorage 持久化）：命中→直接返；未命中→499 静默失败。
// 永远不会弹 PATPromptDialog。
export async function ensureCachedAskpassHelper(): Promise<string> {
  const path = askpassCachedHelperPath()
  const content = `#!/bin/sh
exec curl -s -f --max-time 10 -X POST \\
  -H "X-Token: $UI_CLIENT_ASKPASS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"prompt\\":\\"$1\\"}" \\
  "$UI_CLIENT_ASKPASS_URL/cached"
`
  await fs.writeFile(path, content, { mode: 0o755 })
  return path
}

export function askpassEnv(url: string, token: string): NodeJS.ProcessEnv {
  return {
    UI_CLIENT_ASKPASS_URL: url,
    UI_CLIENT_ASKPASS_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0'
  }
}
