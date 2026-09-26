import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const componentsDir = join(process.cwd(), 'src/renderer/src/components')

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name.endsWith('.test.ts')) return []
    if (statSync(path).isDirectory()) return collectSourceFiles(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

describe('focus ring theme', () => {
  it('keeps component focus rings thin and close to the component edge', () => {
    const offenders = collectSourceFiles(componentsDir).filter((file) => {
      const source = readFileSync(file, 'utf-8')
      return /focus(?:-visible)?:ring-2/.test(source) ||
        /focus(?:-visible)?:ring-offset-2/.test(source)
    })

    expect(offenders).toEqual([])
  })
})
