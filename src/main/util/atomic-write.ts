import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

// POSIX rename 原子地替换目标；崩溃时不会出现"半写"文件。
// 用于 saga journal、状态快照等"一定不能损坏"的小文件写入。

function tmpSuffix(): string {
  return `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
}

export async function atomicWriteFile(
  targetPath: string,
  data: string | Uint8Array,
  encoding: BufferEncoding = 'utf-8'
): Promise<void> {
  const dir = dirname(targetPath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${targetPath}${tmpSuffix()}`
  try {
    if (typeof data === 'string') {
      await fs.writeFile(tmp, data, encoding)
    } else {
      await fs.writeFile(tmp, data)
    }
    await fs.rename(tmp, targetPath)
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw e
  }
}

export async function atomicWriteJson(targetPath: string, value: unknown, indent = 2): Promise<void> {
  const text = JSON.stringify(value, null, indent)
  if (typeof text !== 'string') {
    throw new TypeError(`atomicWriteJson: value not serializable (${typeof text})`)
  }
  await atomicWriteFile(targetPath, text, 'utf-8')
}

export async function readJson<T>(targetPath: string): Promise<T | null> {
  try {
    const text = await fs.readFile(targetPath, 'utf-8')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
