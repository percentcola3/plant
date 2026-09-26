import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

function credentialPath(): string {
  return join(app.getPath('userData'), 'deepseek-api-key.enc')
}

export class DeepSeekCredentialStore {
  private cachedKey: string | null | undefined

  async getApiKey(): Promise<string | null> {
    if (this.cachedKey !== undefined) return this.cachedKey
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        this.cachedKey = null
        return null
      }
      const encrypted = await fs.readFile(credentialPath())
      const key = safeStorage.decryptString(encrypted).trim()
      this.cachedKey = key || null
    } catch {
      this.cachedKey = null
    }
    return this.cachedKey
  }

  async hasApiKey(): Promise<boolean> {
    return !!(await this.getApiKey())
  }

  async setApiKey(value: string): Promise<void> {
    const key = value.trim()
    if (!key) throw new Error('DeepSeek API key 不能为空')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法使用安全存储，不能保存 DeepSeek API key')
    }
    const encrypted = safeStorage.encryptString(key)
    const path = credentialPath()
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, encrypted, { mode: 0o600 })
    this.cachedKey = key
  }

  async clearApiKey(): Promise<void> {
    this.cachedKey = null
    await fs.rm(credentialPath(), { force: true })
  }
}

export const deepSeekCredentialStore = new DeepSeekCredentialStore()
