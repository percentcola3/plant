import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { UiProductPublishProgressEvent, UiProductPublishRecord } from '@shared/types'
import { UIClientError } from '../ipc/errors'
import {
  PUBLISH_CONFIG,
  buildTimestamp,
  contentTypeFor,
  createBucket,
  describeRequestError,
  isPlainObject,
  projectSlug,
  publishSlug
} from '../publish/s3'
import { uploadSourceZip } from '../publish/source-zip'
import { collectMarkdownDocs } from '../publish/markdown-walker'
import {
  collectChangelogEntries,
  readHeadSha,
  readPrevPublishHeadShaFromMetaJson
} from '../publish/changelog'
import { renderPublishIndexHtml } from '../publish/index-html'

type PublishMeta = {
  publish?: UiProductPublishRecord
  publishHistory?: UiProductPublishRecord[]
  [key: string]: unknown
}

type UiProductPublishProgress = Omit<UiProductPublishProgressEvent, 'workspaceId'>

// 只扫这些文本资源里的路径引用；二进制/其它文件跳过。
const SCANNED_EXTS = /\.(html?|css|js|mjs|cjs|jsx|ts|tsx|vue|json)$/i
// 匹配指向 .external/ 的路径引用：前置引号/括号/=，可带任意层 ./ ../ 前缀。
const EXTERNAL_REF_RE = /["'(=]\s*(?:\.{0,2}\/)*\.external\//

export type ExternalRefViolation = { relPath: string; snippet: string }

// 扫描产物文本资源，找出指向 .external/ 的引用。命中即返回（带文件相对路径 + 片段）。
export async function findExternalRefViolations(
  productAbs: string,
  allFiles: string[]
): Promise<ExternalRefViolation[]> {
  const out: ExternalRefViolation[] = []
  for (const abs of allFiles) {
    const relPath = relative(productAbs, abs).split(/\\|\//).join('/')
    if (!SCANNED_EXTS.test(relPath)) continue
    const content = await fs.readFile(abs, 'utf-8').catch(() => '')
    if (!content) continue
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (EXTERNAL_REF_RE.test(lines[i])) {
        out.push({ relPath: `${relPath}:${i + 1}`, snippet: lines[i].trim().slice(0, 80) })
      }
    }
  }
  return out
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) await visit(abs)
      else if (entry.isFile()) out.push(abs)
    }
  }
  await visit(root)
  return out
}

export async function publishUiProduct(input: {
  workspacePath: string
  workspaceName: string
  productRelPath: string
  onProgress?: (event: UiProductPublishProgress) => void
}): Promise<UiProductPublishRecord> {
  const productRelPath = normalizeRelPath(input.productRelPath)
  const productAbs = resolveInsideWorkspace(input.workspacePath, productRelPath)
  const stat = await fs.stat(productAbs).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new UIClientError('NOT_FOUND', `UI 产物不存在：${productRelPath}`)
  }

  const userIndexPath = join(productAbs, 'index.html')
  const userIndexStat = await fs.stat(userIndexPath).catch(() => null)
  if (!userIndexStat?.isFile()) {
    throw new UIClientError('NO_INDEX', `UI 产物 ${basename(productRelPath)} 没有 index.html，无法发布`)
  }

  const allFiles = await walkFiles(productAbs)
  const badNames = allFiles
    .map((abs) => relative(productAbs, abs).split(/\\|\//).join('/'))
    .filter((rel) => /[^\x00-\x7F]/.test(rel))
  if (badNames.length > 0) {
    const list = badNames.slice(0, 5).join('、') + (badNames.length > 5 ? ` 等 ${badNames.length} 个` : '')
    throw new UIClientError(
      'NON_ASCII_FILENAME',
      `产物里有 ${badNames.length} 个文件名包含中文或特殊字符，S3 不支持。请改成英文/数字/下划线后重试：${list}`
    )
  }

  // .external/ 是只读且 gitignore、不随产物发布。产物里残留指向它的 src/href/url()/@import
  // 引用 → 发布后必然 404。打包前扫描文本资源，命中即阻断，提示把资源复制进产物目录。
  const externalRefs = await findExternalRefViolations(productAbs, allFiles)
  if (externalRefs.length > 0) {
    const list = externalRefs.slice(0, 5).map((v) => `${v.relPath}: ${v.snippet}`).join('；')
      + (externalRefs.length > 5 ? ` 等 ${externalRefs.length} 处` : '')
    throw new UIClientError(
      'EXTERNAL_REF_IN_PRODUCT',
      `产物里有 ${externalRefs.length} 处引用了 .external/（只读资产库，不随发布）。请把对应资源复制进产物目录并改成项目内相对路径后重试：${list}`
    )
  }

  const productName = basename(productRelPath)
  const prefix = [
    PUBLISH_CONFIG.tenant,
    projectSlug(input.workspaceName),
    'ui',
    publishSlug(productName),
    buildTimestamp()
  ].join('/')
  const bucket = await createBucket()
  let uploaded = 0
  // total 包含：source.zip + 所有产物文件（原 index.html 改名为 ui-main.html 仍算 1 个） + SPA root index.html
  const total = allFiles.length + 2
  const emitProgress = (event: Omit<UiProductPublishProgress, 'productRelPath'>): void => {
    input.onProgress?.({ productRelPath, ...event })
  }

  emitProgress({ phase: 'preparing', uploaded, total })

  // 「可更新」检测 + 变更日志：记录当前 HEAD SHA；若上次发布记录了 SHA，取其到 HEAD 的
  // commit 标题列表作为本次更新的 changelog，注入到 SPA 主页左下角。
  const headSha = await readHeadSha(input.workspacePath)
  const oldHeadSha = await readPrevPublishHeadShaFromMetaJson(productAbs)
  emitProgress({ phase: 'comparing', uploaded, total })
  const changelogEntries = oldHeadSha
    ? await collectChangelogEntries(input.workspacePath, oldHeadSha, headSha)
    : []
  const markdownDocs = await collectMarkdownDocs(productAbs, allFiles)

  // 1) 打包整个产物目录为 source.zip 上传到同一 prefix 下。先于其它文件，让 SPA root 拼链接时已就绪。
  emitProgress({ phase: 'zipping', uploaded, total })
  emitProgress({ phase: 'uploading', uploaded, total, currentFile: 'source.zip' })
  const { zipUrl } = await uploadSourceZip({ bucket, prefix, rootDir: productAbs, files: allFiles })
  uploaded += 1
  emitProgress({ phase: 'uploading', uploaded, total, currentFile: 'source.zip' })

  // 2) 上传所有产物文件；用户的 index.html 改名为 ui-main.html，给 SPA 主页 UI 卡片链接用。
  //    其它文件按原相对路径上传（CSS/JS/图片 的相对引用照常工作）。
  for (const abs of allFiles) {
    const relPath = relative(productAbs, abs).split(/\\|\//).join('/')
    const isUserIndex = relPath === 'index.html'
    const key = isUserIndex ? `${prefix}/ui-main.html` : `${prefix}/${relPath}`
    const displayName = isUserIndex ? 'ui-main.html' : relPath
    emitProgress({ phase: 'uploading', uploaded, total, currentFile: displayName })
    try {
      if (isUserIndex) {
        // 元素备注脚本只对 UI 页面有意义，注入到 ui-main.html 而不是 SPA 主页
        const original = await fs.readFile(abs, 'utf-8')
        const injected = injectElementRemarksOverlay(original, {
          sourceRelPath: `${productRelPath}/index.html`,
          publishedRelPath: 'ui-main.html',
          remarksHref: 'element-remarks.json'
        })
        await bucket.putObject(key, Buffer.from(injected, 'utf-8'), {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      } else {
        await bucket.putObject(key, abs, {
          headers: { 'content-type': contentTypeFor(abs) }
        })
      }
    } catch (e) {
      throw new UIClientError('UPLOAD_FAILED', `上传 ${displayName} 失败：${describeRequestError(e)}`)
    }
    emitProgress({ phase: 'acl', uploaded, total, currentFile: displayName })
    try {
      await bucket.putObjectACL(key, 'public-read')
    } catch (e) {
      throw new UIClientError('ACL_FAILED', `设置 ${displayName} 的访问权限失败：${describeRequestError(e)}`)
    }
    uploaded += 1
    emitProgress({ phase: 'uploading', uploaded, total, currentFile: displayName })
  }

  // 3) 生成并上传 SPA 根 index.html。这是用户访问的入口（record.url 指向它）。
  const indexKey = `${prefix}/index.html`
  emitProgress({ phase: 'uploading', uploaded, total, currentFile: 'index.html' })
  const spaHtml = renderPublishIndexHtml({
    title: productName,
    markdownDocs,
    uiLinks: [{ name: 'main', href: 'ui-main.html' }],
    sourceZipUrl: zipUrl,
    changelogEntries
  })
  let indexRes: unknown
  try {
    indexRes = await bucket.putObject(indexKey, Buffer.from(spaHtml, 'utf-8'), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  } catch (e) {
    throw new UIClientError('UPLOAD_FAILED', `上传 index.html 失败：${describeRequestError(e)}`)
  }
  emitProgress({ phase: 'acl', uploaded, total, currentFile: 'index.html' })
  try {
    await bucket.putObjectACL(indexKey, 'public-read')
  } catch (e) {
    throw new UIClientError('ACL_FAILED', `设置 index.html 的访问权限失败：${describeRequestError(e)}`)
  }
  uploaded += 1
  const indexUrl = (isPlainObject(indexRes) && typeof indexRes.url === 'string' && indexRes.url)
    ? indexRes.url
    : bucket.getObjectUrl(indexKey)
  emitProgress({ phase: 'uploading', uploaded, total, currentFile: 'index.html' })

  const record: UiProductPublishRecord = {
    productRelPath,
    publishedAt: new Date().toISOString(),
    url: indexUrl,
    prefix,
    fileCount: allFiles.length,
    bucket: PUBLISH_CONFIG.bucket,
    region: PUBLISH_CONFIG.region,
    headSha
  }
  emitProgress({ phase: 'finalizing', uploaded, total })
  await writePublishRecord(productAbs, record)
  emitProgress({ phase: 'completed', uploaded, total })
  return record
}

async function writePublishRecord(productAbs: string, record: UiProductPublishRecord): Promise<void> {
  const metaPath = join(productAbs, 'meta.json')
  let meta: PublishMeta = {}
  try {
    const parsed = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as PublishMeta
  } catch {
    // meta.json is optional.
  }
  meta.publish = record
  meta.publishHistory = [record, ...(meta.publishHistory ?? [])].slice(0, 10)
  await fs.mkdir(dirname(metaPath), { recursive: true })
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
}

// 元素备注脚本：在 UI 页面里读 element-remarks.json 把橙色"备注"标记定位到对应 DOM 元素上。
// 仅注入到 ui-main.html（用户产物页），不注入到 SPA 主页——后者没有用户元素可标。
export function injectElementRemarksOverlay(
  html: string,
  options: {
    sourceRelPath?: string
    publishedRelPath?: string
    remarksHref?: string
  } = {}
): string {
  const sourceRelPath = normalizeRelPath(options.sourceRelPath ?? 'index.html')
  const publishedRelPath = normalizeRelPath(options.publishedRelPath ?? 'index.html')
  const remarksHref = options.remarksHref ?? 'element-remarks.json'
  const snippet = `
<script id="ws-element-remarks">
(function(){
  var sourceRelPath = ${JSON.stringify(sourceRelPath)};
  var publishedRelPath = ${JSON.stringify(publishedRelPath)};
  var remarksHref = ${JSON.stringify(remarksHref)};
  var popover = null;
  function ensureStyles() {
    if (document.getElementById('ws-element-remarks-style')) return;
    var style = document.createElement('style');
    style.id = 'ws-element-remarks-style';
    style.textContent = '.ws-element-remark-marker{position:absolute;z-index:2147483646;border:0;border-radius:999px;background:#f26b2f;color:#fff;padding:4px 8px;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 4px 12px rgba(15,23,42,.2);cursor:pointer}.ws-element-remark-popover{position:absolute;z-index:2147483647;max-width:320px;padding:10px 12px;border-radius:10px;background:#111827;color:#fff;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 12px 32px rgba(15,23,42,.32);white-space:pre-wrap}';
    document.head.appendChild(style);
  }
  function normalizeRemarkRel(value) {
    return String(value || '').replace(/\\\\/g, '/').replace(/^\\/+/, '').replace(/^\\.\\//, '').replace(/\\/+$/, '');
  }
  function matchesPage(item) {
    var rel = normalizeRemarkRel(item && item.relPath);
    var source = normalizeRemarkRel(sourceRelPath);
    var published = normalizeRemarkRel(publishedRelPath);
    if (!rel) return false;
    if (source && rel === source) return true;
    if (published && rel === published) return true;
    if (rel === 'index.html') return true;
    if (source && rel.endsWith('/' + source)) return true;
    if (published && rel.endsWith('/' + published)) return true;
    return false;
  }
  function place(marker, el) {
    var rect = el.getBoundingClientRect();
    marker.style.left = Math.max(8, window.scrollX + rect.right - 18) + 'px';
    marker.style.top = Math.max(8, window.scrollY + rect.top - 12) + 'px';
  }
  function showPopover(text, marker) {
    if (popover) popover.remove();
    popover = document.createElement('div');
    popover.className = 'ws-element-remark-popover';
    popover.textContent = text;
    document.body.appendChild(popover);
    var rect = marker.getBoundingClientRect();
    popover.style.left = Math.max(8, window.scrollX + rect.left) + 'px';
    popover.style.top = Math.max(8, window.scrollY + rect.bottom + 8) + 'px';
  }
  function renderRemarks(items) {
    ensureStyles();
    var markers = [];
    items.forEach(function(item) {
      if (!item || !item.path || !item.note || !matchesPage(item)) return;
      var el = null;
      try { el = document.querySelector(item.path); } catch (e) { el = null; }
      if (!el) return;
      var marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'ws-element-remark-marker';
      marker.textContent = '备注';
      marker.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showPopover(item.note, marker);
      });
      document.body.appendChild(marker);
      markers.push({ marker: marker, el: el });
    });
    function update() { markers.forEach(function(entry) { place(entry.marker, entry.el); }); }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
  }
  fetch(remarksHref, { cache: 'no-store' })
    .then(function(res) { return res.ok ? res.json() : null; })
    .then(function(data) { renderRemarks(Array.isArray(data && data.items) ? data.items : []); })
    .catch(function() {});
})();
</script>
`
  const lower = html.toLowerCase()
  const idx = lower.lastIndexOf('</body>')
  if (idx >= 0) return html.slice(0, idx) + snippet + html.slice(idx)
  return html + snippet
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function resolveInsideWorkspace(workspacePath: string, relPath: string): string {
  const root = resolve(workspacePath)
  const abs = resolve(root, normalizeRelPath(relPath))
  if (abs !== root && !abs.startsWith(root + '/')) {
    throw new UIClientError('PATH_OUTSIDE_SCOPE', `路径越界：${relPath}`)
  }
  return abs
}
