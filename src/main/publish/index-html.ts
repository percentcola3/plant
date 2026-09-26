// 共享：生成发布产物的根 index.html（SPA：左侧栏 MD 列表 + 主区客户端渲染）。
//
// PM 和 UX 发布器都用这个模板，确保两边产物的"看上去"完全一致：
//   - 顶栏：标题 + UI 卡片横列（点击新标签页打开各 UI 子页）
//   - 左侧栏：所有 .md/.mdx/.markdown 的标题列表
//   - 主区：用 marked 在客户端渲染当前选中 MD（hash 路由 #doc=<rel>）
//   - 右下角：源码包下载按钮
//   - 左下角：本次更新 changelog 浮层（仅 changelogEntries 非空时显示）
//
// marked.umd.js 直接读 node_modules（~43KB unminified），不引 CDN——S3 公网偶发被墙。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

// 进程内缓存：marked 源码读一次就够。~43KB，readFileSync 启动即完成。
// marked 的 package.json exports 字段没暴露 ./lib/* 子路径，所以必须先解析包根目录
// （走 package.json 这个白名单入口）再手动拼出 UMD 文件路径，绕开 exports 限制。
let markedSourceCached: string | null = null
function loadMarkedSource(): string {
  if (markedSourceCached) return markedSourceCached
  const pkgRoot = dirname(require.resolve('marked/package.json'))
  markedSourceCached = readFileSync(join(pkgRoot, 'lib/marked.umd.js'), 'utf-8')
  return markedSourceCached
}

export type MarkdownDocLink = {
  relPath: string
  title: string
}

export type UiLink = {
  name: string            // 'main' / 'v2' / 'mobile' 等。UX 单产物固定 'main'
  href: string            // 'ui-main.html' 等同 prefix 下的相对路径
}

export type RenderPublishIndexInput = {
  title: string                          // 顶栏显示用，产物名/feature 名
  markdownDocs: MarkdownDocLink[]        // 已按 relPath 排序
  uiLinks: UiLink[]                       // 0 个时顶栏 UI 卡片区隐藏
  sourceZipUrl: string                    // 源码包下载链接（同 prefix 下的 source.zip 公网 URL）
  changelogEntries: string[]              // 空数组 = 不显示 changelog 浮层
}

export function renderPublishIndexHtml(input: RenderPublishIndexInput): string {
  const markedSrc = loadMarkedSource()
  const docsJson = JSON.stringify(input.markdownDocs)
  const titleJson = JSON.stringify(input.title)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(input.title)}</title>
<style>${INDEX_CSS}</style>
<script>${markedSrc}</script>
</head>
<body>
<div class="shell">
  <header class="top">
    <h1>${escapeHtml(input.title)}</h1>
    ${renderUiBanner(input.uiLinks)}
  </header>
  <div class="body">
    <nav class="sidebar" aria-label="文档列表">
      ${renderSidebar(input.markdownDocs)}
    </nav>
    <main class="content">
      <article id="doc-render"><p class="empty">加载中…</p></article>
    </main>
  </div>
</div>
${renderDownloadButton(input.sourceZipUrl)}
${renderChangelogOverlay(input.changelogEntries)}
<script>
const DOCS = ${docsJson};
const TITLE = ${titleJson};
${CLIENT_JS}
</script>
</body>
</html>
`
}

function renderUiBanner(uiLinks: UiLink[]): string {
  if (uiLinks.length === 0) return ''
  const cards = uiLinks.map((link) => {
    const label = link.name === 'main' ? 'UI 预览' : `UI · ${escapeHtml(link.name)}`
    return `<a class="ui-card" href="${escapeHtmlAttr(link.href)}" target="_blank" rel="noopener">`
      + `<span aria-hidden="true">↗</span><span>${label}</span></a>`
  }).join('')
  return `<div class="ui-cards">${cards}</div>`
}

function renderSidebar(docs: MarkdownDocLink[]): string {
  if (docs.length === 0) {
    return '<p class="empty" style="padding:16px;">没有文档</p>'
  }
  const items = docs.map((doc) => {
    return `<li><a href="#doc=${escapeHtmlAttr(encodeURIComponent(doc.relPath))}" data-rel="${escapeHtmlAttr(doc.relPath)}">`
      + `<span class="icon" aria-hidden="true">MD</span>`
      + `<span class="title">${escapeHtml(doc.title)}</span></a></li>`
  }).join('')
  return `<h2>文档 (${docs.length})</h2><ul>${items}</ul>`
}

function renderDownloadButton(zipUrl: string): string {
  return `<a class="download" href="${escapeHtmlAttr(zipUrl)}" download aria-label="下载源码包">`
    + `<span aria-hidden="true">⬇</span><span>下载源码包</span></a>`
}

function renderChangelogOverlay(entries: string[]): string {
  if (entries.length === 0) return ''
  const items = entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')
  return `<div id="ws-publish-changelog" class="changelog">
    <button type="button" id="ws-publish-changelog-toggle" class="changelog-toggle">
      <span aria-hidden="true">✨</span>
      <span>本次更新 ${entries.length} 项</span>
      <span id="ws-publish-changelog-arrow" aria-hidden="true" class="changelog-arrow">▾</span>
    </button>
    <ul id="ws-publish-changelog-list" class="changelog-list">${items}</ul>
  </div>
  <script>(function(){
    var btn=document.getElementById('ws-publish-changelog-toggle');
    var list=document.getElementById('ws-publish-changelog-list');
    var arrow=document.getElementById('ws-publish-changelog-arrow');
    if(btn&&list&&arrow){btn.addEventListener('click',function(){
      var open=list.style.display!=='none'&&list.style.display!=='';
      list.style.display=open?'none':'block';
      arrow.style.transform=open?'':'rotate(180deg)';
    });}
  })();</script>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const INDEX_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2937; background: #fff; }
.shell { display: flex; flex-direction: column; height: 100%; }
header.top { padding: 16px 24px 14px; border-bottom: 1px solid #e5e7eb; background: #fafafa; flex-shrink: 0; }
header.top h1 { margin: 0 0 10px; font-size: 18px; font-weight: 600; color: #111827; }
.ui-cards { display: flex; flex-wrap: wrap; gap: 8px; }
.ui-card { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; background: #1d1d1f; color: #fff; text-decoration: none; font-size: 12px; font-weight: 500; transition: background .15s; }
.ui-card:hover { background: #374151; }
.body { display: flex; flex: 1; min-height: 0; }
.sidebar { width: 240px; flex-shrink: 0; padding: 12px 8px; border-right: 1px solid #e5e7eb; background: #fafafa; overflow-y: auto; }
.sidebar h2 { margin: 0 8px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: .05em; }
.sidebar ul { list-style: none; margin: 0; padding: 0; }
.sidebar li { margin: 0; padding: 0; }
.sidebar a { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; color: #374151; text-decoration: none; font-size: 13px; transition: background .1s; }
.sidebar a:hover { background: #f3f4f6; }
.sidebar a.active { background: #e0e7ff; color: #3730a3; }
.sidebar .icon { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; background: #eef2ff; color: #3730a3; font-size: 10px; font-weight: 700; flex-shrink: 0; }
.sidebar .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
main.content { flex: 1; overflow-y: auto; padding: 32px 48px 96px; }
article { max-width: 820px; margin: 0 auto; line-height: 1.65; font-size: 15px; }
article > *:first-child { margin-top: 0; }
article h1, article h2, article h3, article h4 { margin: 1.6em 0 .6em; color: #111827; font-weight: 600; }
article h1 { font-size: 28px; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
article h2 { font-size: 22px; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
article h3 { font-size: 18px; }
article h4 { font-size: 16px; }
article p, article ul, article ol { margin: 0 0 1em; }
article code { padding: .15em .4em; background: #f3f4f6; border-radius: 4px; font-size: .9em; font-family: "SF Mono", Menlo, Monaco, Consolas, monospace; }
article pre { background: #1f2937; color: #f3f4f6; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.55; }
article pre code { background: transparent; padding: 0; color: inherit; font-size: inherit; }
article blockquote { margin: 0 0 1em; padding: .5em 1em; color: #6b7280; border-left: 4px solid #e5e7eb; background: #f9fafb; border-radius: 0 6px 6px 0; }
article a { color: #2563eb; text-decoration: none; }
article a:hover { text-decoration: underline; }
article img { max-width: 100%; height: auto; border-radius: 4px; }
article table { border-collapse: collapse; margin: 0 0 1em; font-size: 14px; }
article th, article td { border: 1px solid #e5e7eb; padding: 6px 12px; text-align: left; }
article th { background: #f9fafb; font-weight: 600; }
article hr { border: 0; border-top: 1px solid #e5e7eb; margin: 2em 0; }
.empty { color: #9ca3af; font-size: 14px; text-align: center; padding: 64px 16px; }
.download { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; background: #1f2937; color: #fff; text-decoration: none; font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.18); transition: background .15s; }
.download:hover { background: #374151; }
.changelog { position: fixed; left: 16px; bottom: 16px; z-index: 2147483646; max-width: 320px; border-radius: 12px; background: #1f2937; color: #fff; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.22); overflow: hidden; }
.changelog-toggle { display: flex; width: 100%; align-items: center; gap: 8px; padding: 10px 14px; border: 0; background: transparent; color: #fff; cursor: pointer; font: inherit; text-align: left; }
.changelog-arrow { margin-left: auto; transition: transform .2s; }
.changelog-list { margin: 0; padding: 0 14px 12px 28px; list-style: disc; display: none; max-height: 240px; overflow: auto; border-top: 1px solid rgba(255,255,255,.12); }
.changelog-list li { padding: 4px 0; }
`

const CLIENT_JS = `
function pickDefault(docs) {
  if (!docs.length) return null;
  const byPath = new Map(docs.map(d => [d.relPath.toLowerCase(), d]));
  const preferred = ['prd.md', 'doc/prd.md', 'docs/prd.md', 'readme.md'];
  for (const p of preferred) { if (byPath.has(p)) return byPath.get(p); }
  return docs[0];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);
}

function fixRelativePaths(docRelPath) {
  const slash = docRelPath.lastIndexOf('/');
  const docDir = slash >= 0 ? docRelPath.slice(0, slash + 1) : '';
  if (!docDir) return;
  const isAbsolute = url => !url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.startsWith('#');
  document.querySelectorAll('#doc-render img').forEach(img => {
    const src = img.getAttribute('src');
    if (!isAbsolute(src)) img.setAttribute('src', docDir + src);
  });
  document.querySelectorAll('#doc-render a').forEach(a => {
    const href = a.getAttribute('href');
    if (!isAbsolute(href)) {
      // 链到另一个 MD 时改成 hash 路由，让它在 SPA 内打开
      const resolved = docDir + href;
      if (/\\.(md|mdx|markdown)$/i.test(resolved)) {
        a.setAttribute('href', '#doc=' + encodeURIComponent(resolved));
      } else {
        a.setAttribute('href', resolved);
      }
    }
  });
}

async function loadDoc(relPath) {
  const article = document.getElementById('doc-render');
  if (!DOCS.length) {
    article.innerHTML = '<p class="empty">这个产物里没有可显示的 Markdown 文档。</p>';
    return;
  }
  const target = relPath || pickDefault(DOCS).relPath;
  document.querySelectorAll('.sidebar a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('data-rel') === target);
  });
  article.innerHTML = '<p class="empty">加载中…</p>';
  try {
    const res = await fetch(encodeURI(target));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    article.innerHTML = marked.parse(text, { gfm: true, breaks: false });
    fixRelativePaths(target);
    document.title = target + ' · ' + TITLE;
    article.scrollTop = 0;
    document.querySelector('main.content').scrollTop = 0;
  } catch (e) {
    article.innerHTML = '<p class="empty">加载 ' + escapeHtml(target) + ' 失败：' + escapeHtml(e.message) + '</p>';
  }
}

function readHashDoc() {
  const m = location.hash.match(/[#&]doc=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

window.addEventListener('hashchange', () => loadDoc(readHashDoc()));
document.querySelectorAll('.sidebar a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const rel = a.getAttribute('data-rel');
    if (location.hash === '#doc=' + encodeURIComponent(rel)) {
      // 同一文档点击：手动触发一次 reload（hashchange 不会触发）
      loadDoc(rel);
    } else {
      location.hash = '#doc=' + encodeURIComponent(rel);
    }
  });
});

loadDoc(readHashDoc());
`
