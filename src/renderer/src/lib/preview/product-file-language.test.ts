import { describe, expect, it } from 'vitest'
import { productFileLanguageId } from './product-file-language'

describe('product file language mapping', () => {
  it.each([
    ['ui/demo/index.html', 'html'],
    ['ui/demo/app.js', 'javascript'],
    ['ui/demo/component.jsx', 'javascript'],
    ['ui/demo/app.ts', 'typescript'],
    ['ui/demo/component.tsx', 'typescript'],
    ['ui/demo/data.json', 'json'],
    ['ui/demo/theme.css', 'css'],
    ['ui/demo/readme.md', 'markdown'],
    ['ui/demo/plain.txt', 'plain']
  ] as const)('maps %s to %s', (relPath, expected) => {
    expect(productFileLanguageId(relPath)).toBe(expected)
  })
})
