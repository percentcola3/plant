import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWriteFile, atomicWriteJson, readJson } from './atomic-write'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atomic-write-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  vi.restoreAllMocks()
})

describe('atomicWriteFile', () => {
  it('writes target file with given content', async () => {
    const target = join(dir, 'a.txt')
    await atomicWriteFile(target, 'hello')
    expect(await fs.readFile(target, 'utf-8')).toBe('hello')
  })

  it('creates missing parent directories', async () => {
    const target = join(dir, 'nested', 'deep', 'a.txt')
    await atomicWriteFile(target, 'x')
    expect(await fs.readFile(target, 'utf-8')).toBe('x')
  })

  it('replaces existing target atomically', async () => {
    const target = join(dir, 'a.txt')
    await fs.writeFile(target, 'old')
    await atomicWriteFile(target, 'new')
    expect(await fs.readFile(target, 'utf-8')).toBe('new')
  })

  it('cleans up tmp file when write fails', async () => {
    const target = join(dir, 'a.txt')
    const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename boom'))
    await expect(atomicWriteFile(target, 'x')).rejects.toThrow('rename boom')
    spy.mockRestore()

    const remaining = await readdir(dir)
    expect(remaining.filter((name) => name.includes('.tmp-'))).toEqual([])
    expect(remaining.includes('a.txt')).toBe(false)
  })

  it('keeps existing target intact when rename fails', async () => {
    const target = join(dir, 'a.txt')
    await fs.writeFile(target, 'original')

    const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename boom'))
    await expect(atomicWriteFile(target, 'corrupt')).rejects.toThrow('rename boom')
    spy.mockRestore()

    expect(await fs.readFile(target, 'utf-8')).toBe('original')
  })

  it('handles concurrent writes without leaving tmp files', async () => {
    const target = join(dir, 'a.txt')
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => atomicWriteFile(target, `payload-${i}`))
    )
    const remaining = await readdir(dir)
    expect(remaining.filter((name) => name.includes('.tmp-'))).toEqual([])
    expect(remaining).toContain('a.txt')
    const final = await fs.readFile(target, 'utf-8')
    expect(final).toMatch(/^payload-\d$/)
  })
})

describe('atomicWriteJson + readJson', () => {
  it('round-trips an object', async () => {
    const target = join(dir, 'j.json')
    const value = { a: 1, b: ['x', 'y'], c: { nested: true } }
    await atomicWriteJson(target, value)
    expect(await readJson(target)).toEqual(value)
  })

  it('uses pretty formatting by default', async () => {
    const target = join(dir, 'j.json')
    await atomicWriteJson(target, { a: 1 })
    const text = await fs.readFile(target, 'utf-8')
    expect(text).toBe('{\n  "a": 1\n}')
  })

  it('readJson returns null for missing file', async () => {
    expect(await readJson(join(dir, 'missing.json'))).toBeNull()
  })

  it('readJson returns null for malformed JSON', async () => {
    const target = join(dir, 'bad.json')
    await fs.writeFile(target, '{not json')
    expect(await readJson(target)).toBeNull()
  })

  it('rejects non-serializable values', async () => {
    const target = join(dir, 'j.json')
    await expect(atomicWriteJson(target, undefined)).rejects.toThrow(/not serializable/)
  })
})
