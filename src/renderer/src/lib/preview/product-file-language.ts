import { css as cssLanguage } from '@codemirror/lang-css'
import { html as htmlLanguage } from '@codemirror/lang-html'
import { javascript as javascriptLanguage } from '@codemirror/lang-javascript'
import { json as jsonLanguage } from '@codemirror/lang-json'
import { markdown as markdownLanguage } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'

export type ProductFileLanguageId =
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'markdown'
  | 'plain'

export function productFileLanguageId(relPath: string): ProductFileLanguageId {
  if (/\.html?$/i.test(relPath)) return 'html'
  if (/\.css$/i.test(relPath)) return 'css'
  if (/\.(js|mjs|cjs|jsx)$/i.test(relPath)) return 'javascript'
  if (/\.(ts|tsx)$/i.test(relPath)) return 'typescript'
  if (/\.json$/i.test(relPath)) return 'json'
  if (/\.(md|mdx|markdown)$/i.test(relPath)) return 'markdown'
  return 'plain'
}

export function productFileLanguageExtension(relPath: string): Extension {
  switch (productFileLanguageId(relPath)) {
    case 'html':
      return htmlLanguage()
    case 'css':
      return cssLanguage()
    case 'javascript':
      return javascriptLanguage({ jsx: /\.jsx$/i.test(relPath) })
    case 'typescript':
      return javascriptLanguage({ typescript: true, jsx: /\.tsx$/i.test(relPath) })
    case 'json':
      return jsonLanguage()
    case 'markdown':
      return markdownLanguage()
    case 'plain':
      return []
  }
}
