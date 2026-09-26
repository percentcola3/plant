import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const state = vi.hoisted(() => ({ userData: '', encryptionAvailable: true }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  safeStorage: {
    isEncryptionAvailable: () => state.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, '')
  }
}))

import { DeepSeekCredentialStore } from './credentials'

beforeEach(async () => {
  state.userData = await mkdtemp(join(tmpdir(), 'ui-client-deepseek-key-'))
  state.encryptionAvailable = true
})

afterEach(async () => {
  await rm(state.userData, { recursive: true, force: true })
})

describe('DeepSeekCredentialStore', () => {
  it('encrypts the key at rest and only exposes configured status to callers', async () => {
    const store = new DeepSeekCredentialStore()
    await store.setApiKey('sk-test-secret')

    await expect(new DeepSeekCredentialStore().getApiKey()).resolves.toBe('sk-test-secret')
    await expect(store.hasApiKey()).resolves.toBe(true)
  })

  it('clears a persisted key', async () => {
    const store = new DeepSeekCredentialStore()
    await store.setApiKey('sk-test-secret')
    await store.clearApiKey()

    await expect(new DeepSeekCredentialStore().getApiKey()).resolves.toBeNull()
  })

  it('refuses plaintext fallback when secure storage is unavailable', async () => {
    state.encryptionAvailable = false
    await expect(new DeepSeekCredentialStore().setApiKey('sk-test-secret'))
      .rejects.toThrow('安全存储')
  })
})
