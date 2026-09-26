import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userDataPath = vi.hoisted(() => `/tmp/ui-client-settings-default-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  }
}))

import { settingsStore, SettingsStore } from './store'
import { settingsJsonPath } from '../projects/paths'

afterAll(() => {
  rmSync(userDataPath, { recursive: true, force: true })
})

describe('SettingsStore defaults', () => {
  it('uses claude when no settings file exists', async () => {
    await expect(settingsStore.get()).resolves.toMatchObject({
      cliKind: 'claude',
      aiProvider: 'claude-code',
      defaultExternalRefIds: [],
      theme: 'light'
    })
  })

  it('persists appearance theme', async () => {
    await settingsStore.update({ theme: 'light' })
    await expect(settingsStore.get()).resolves.toMatchObject({ theme: 'light' })
  })

  it('persists default project resources', async () => {
    await settingsStore.update({ defaultExternalRefIds: ['kb-1', 'ui-1'] })
    await expect(settingsStore.get()).resolves.toMatchObject({
      defaultExternalRefIds: ['kb-1', 'ui-1']
    })
  })
})

describe('SettingsStore cliKind migration', () => {
  // 直接写 settings.json 再用独立实例 load，避免污染上面单例的缓存。
  function writeSettingsFile(content: Record<string, unknown>): void {
    mkdirSync(dirname(settingsJsonPath()), { recursive: true })
    writeFileSync(settingsJsonPath(), JSON.stringify(content), 'utf-8')
  }

  it('keeps a legacy v1 cliKind=claude as claude', async () => {
    writeSettingsFile({ cliKind: 'claude', schemaVersion: 1 })
    await expect(new SettingsStore().get()).resolves.toMatchObject({
      cliKind: 'claude',
      schemaVersion: 3
    })
  })

  it('treats a v1 file without schemaVersion the same way', async () => {
    writeSettingsFile({ cliKind: 'claude' })
    await expect(new SettingsStore().get()).resolves.toMatchObject({ cliKind: 'claude' })
  })

  it('keeps an explicit claude choice that was saved under v2', async () => {
    writeSettingsFile({ cliKind: 'claude', schemaVersion: 2 })
    await expect(new SettingsStore().get()).resolves.toMatchObject({ cliKind: 'claude' })
  })

  it('keeps an explicit DeepSeek provider and migrates the schema', async () => {
    writeSettingsFile({ aiProvider: 'deepseek-harness', cliKind: 'claude', schemaVersion: 2 })
    await expect(new SettingsStore().get()).resolves.toMatchObject({
      aiProvider: 'deepseek-harness',
      schemaVersion: 3
    })
  })

  it('falls back to claude for an unknown cliKind value', async () => {
    writeSettingsFile({ cliKind: 'something-else', schemaVersion: 2 })
    await expect(new SettingsStore().get()).resolves.toMatchObject({ cliKind: 'claude' })
  })
})

 it('persists a closed notch and custom Peeka connection across restarts', async () => {
   const store = new SettingsStore()
   const peekaConnection = { baseUrl: 'http://llm-proxy.example.com', protocol: 'responses' as const, model: 'gpt-5.6-sol', visionModel: '' }
   await store.update({ aiTaskNotchEnabled: false, peekaConnection })
   await expect(new SettingsStore().get()).resolves.toMatchObject({ aiTaskNotchEnabled: false, peekaConnection })
 })
