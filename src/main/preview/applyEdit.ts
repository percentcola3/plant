import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { load } from 'cheerio'
import { UIClientError } from '../ipc/errors'

// inspector 写回预览 HTML：从浏览器收到 { path, kind, value } → cheerio 解析 →
// path 命中元素 → 修改其 style / attr → 写回。
//
// 每次修改是一个独立写：防止冲突的策略 = 同一文件的多个 edit 在浏览器侧已经按 1.2s 节流，
// 服务端这里直接读-改-写。watcher 会刷新预览。

export type EditKind = `style:${string}` | `attr:${string}` | 'text:content' | 'node:remove'

export type EditRequest = {
  projectPath: string
  relPath: string                 // outputs/...、components/...、ui/... 或 features/... 下的 html
  selector: string                // CSS path（与 inspector.js 算法一致）
  kind: EditKind
  value: string                   // 空字符串 = 清除该属性；__remove__ = 删除 attr
}

function resolveTarget(projectPath: string, relPath: string): string {
  if (relPath.includes('..')) {
    throw new UIClientError('VALIDATION', '路径含 ..')
  }
  const projectAbs = resolve(projectPath)
  const target = isAbsolute(relPath) ? resolve(relPath) : resolve(join(projectAbs, relPath))
  if (target !== projectAbs && !target.startsWith(projectAbs + '/')) {
    throw new UIClientError('PATH_OUTSIDE_PROJECT', '路径越界')
  }
  // 仅产品/组件预览 HTML 允许写回。
  const rel = target.slice(projectAbs.length + 1)
  const isProjectUiHtml = /^ui\/.+\.html?$/i.test(rel)
  const isFeatureHtml = /^features\/.+\.html?$/i.test(rel)
  if (!rel.startsWith('outputs/') && !rel.startsWith('components/') && !isProjectUiHtml && !isFeatureHtml) {
    throw new UIClientError('NOT_PREVIEW_HTML', '只能修改 outputs/、components/、ui/ 或 features/ 下的 HTML')
  }
  if (!/\.html?$/i.test(rel)) {
    throw new UIClientError('NOT_HTML', '只能修改 .html 文件')
  }
  return target
}

function setStyleProp(styleAttr: string, prop: string, value: string): string {
  // 极简 inline style 解析：按 `;` 切，找/替换 prop。空值 = 删除该 prop。
  const parts = styleAttr.split(';').map((s) => s.trim()).filter(Boolean)
  const out: string[] = []
  let replaced = false
  for (const part of parts) {
    const idx = part.indexOf(':')
    if (idx === -1) {
      out.push(part)
      continue
    }
    const k = part.slice(0, idx).trim().toLowerCase()
    if (k === prop.toLowerCase()) {
      replaced = true
      if (value !== '') out.push(`${prop}: ${value}`)
    } else {
      out.push(part)
    }
  }
  if (!replaced && value !== '') out.push(`${prop}: ${value}`)
  return out.join('; ')
}

export async function applyOutputEdit(req: EditRequest): Promise<void> {
  const targetAbs = resolveTarget(req.projectPath, req.relPath)
  const html = await fs.readFile(targetAbs, 'utf-8')
  const $ = load(html, { xml: false })

  const matches = $(req.selector)
  if (matches.length === 0) {
    throw new UIClientError('SELECTOR_NOT_FOUND', `选择器没匹配到元素：${req.selector}`)
  }
  if (matches.length > 1) {
    throw new UIClientError('SELECTOR_AMBIGUOUS', `选择器匹配到 ${matches.length} 个元素，要求唯一：${req.selector}`)
  }

  const el = matches.first()
  if (req.kind.startsWith('style:')) {
    const prop = req.kind.slice('style:'.length)
    const cur = el.attr('style') || ''
    const next = setStyleProp(cur, prop, req.value).trim()
    if (next) el.attr('style', next)
    else el.removeAttr('style')
  } else if (req.kind.startsWith('attr:')) {
    const name = req.kind.slice('attr:'.length)
    if (req.value === '__remove__' || req.value === '') {
      el.removeAttr(name)
    } else {
      el.attr(name, req.value)
    }
  } else if (req.kind === 'text:content') {
    el.text(req.value)
  } else if (req.kind === 'node:remove') {
    el.remove()
  } else {
    throw new UIClientError('VALIDATION', `不支持的 kind：${req.kind}`)
  }

  // 保留原 doctype + 头部空白（cheerio.html() 会重新输出整段）
  const out = $.html()
  await fs.writeFile(targetAbs, out, 'utf-8')
}
