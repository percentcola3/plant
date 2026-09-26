// WorkSpace 网页剪裁 popup
// 端口探测：9527→9531 顺序找一个响应 /health 且 app:"ui-client" 的端口
const PORT_CANDIDATES = [9527, 9528, 9529, 9530, 9531]

let serverPort = null
let serverUrl = null
let captured = null

const $ = (id) => document.getElementById(id)
const states = ['initial', 'selecting', 'result', 'done']

function showState(name) {
  for (const s of states) {
    const el = $(`state-${s}`)
    if (el) el.hidden = s !== name
  }
}

function setStatus(kind, text) {
  const bar = $('status-bar')
  const titles = {
    checking: '正在检测 WorkSpace',
    connected: '已连接 WorkSpace',
    missing: 'WorkSpace 未运行，点击重试'
  }
  bar.classList.remove('status-bar--checking', 'status-bar--connected', 'status-bar--missing')
  bar.classList.add(`status-bar--${kind}`)
  bar.title = titles[kind] || text
  bar.querySelector('.status-bar__text').textContent = text
}

function setStartHint(text) {
  const hint = $('hint-target')
  if (hint) hint.textContent = text
}

function getHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || '未知来源'
  } catch {
    return '未知来源'
  }
}

function countText(text) {
  return String(text || '').trim().length
}

function normalizeFileName(value) {
  return String(value || '')
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.md$/i, '')
    .trim()
    .slice(0, 80)
}

async function probePort(port) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 600)
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const data = await res.json()
    if (data && data.ok && data.app === 'ui-client') return port
  } catch { /* ignore */ }
  return null
}

async function detectServer() {
  setStatus('checking', '检测中')
  setStartHint('正在检测 WorkSpace 连接...')
  for (const port of PORT_CANDIDATES) {
    const ok = await probePort(port)
    if (ok) {
      serverPort = ok
      serverUrl = `http://127.0.0.1:${ok}`
      setStatus('connected', '已连接')
      setStartHint('保存到系统剪页库，跨项目可用。')
      return true
    }
  }
  serverPort = null
  serverUrl = null
  setStatus('missing', '未运行')
  setStartHint('请先启动 WorkSpace，状态变绿后即可开始选取。')
  return false
}

// --- result rendering ---

function renderMediaBadges(data) {
  const c = $('result-media-badges')
  c.innerHTML = ''
  const items = []
  const imgs = (data.imageUrls || []).length
  const vids = (data.videoUrls || []).length
  const auds = (data.audioUrls || []).length
  const subs = (data.subtitleTracks || []).filter(t => t.text).length
  if (imgs > 0) items.push({ cls: 'media-badge--image', t: `图片 ${imgs}` })
  if (vids > 0) items.push({ cls: 'media-badge--video', t: `视频 ${vids}` })
  if (auds > 0) items.push({ cls: 'media-badge--audio', t: `音频 ${auds}` })
  if (subs > 0) items.push({ cls: 'media-badge--subtitle', t: `字幕 ${subs}` })
  for (const i of items) {
    const span = document.createElement('span')
    span.className = `media-badge ${i.cls}`
    span.textContent = i.t
    c.appendChild(span)
  }
}

function renderThumbs(data) {
  const c = $('result-thumbs')
  c.innerHTML = ''
  const urls = data.imageUrls || []
  const max = 6
  for (const url of urls.slice(0, max)) {
    const img = document.createElement('img')
    img.className = 'thumbs__item'
    img.src = url
    img.referrerPolicy = 'no-referrer'
    img.onerror = () => { img.style.opacity = '0.3' }
    c.appendChild(img)
  }
  if (urls.length > max) {
    const more = document.createElement('div')
    more.className = 'thumbs__more'
    more.textContent = `+${urls.length - max}`
    c.appendChild(more)
  }
}

function renderPreview(data) {
  const content = data.content || ''
  const imageCount = (data.imageUrls || []).length
  const videoCount = (data.videoUrls || []).length
  const audioCount = (data.audioUrls || []).length
  const subtitleCount = (data.subtitleTracks || []).filter(t => t.text).length
  const mediaCount = imageCount + videoCount + audioCount + subtitleCount

  const fileName = normalizeFileName(data.fileName || data.title || getHost(data.url) || '未命名剪页')

  $('result-title').textContent = data.title || '未命名'
  $('result-site').textContent = getHost(data.url)
  $('result-url').textContent = data.url || ''
  $('result-url').title = data.url || ''
  $('result-text-count').textContent = countText(content) > 0 ? `${countText(content)} 字` : '无正文'
  $('result-media-count').textContent = mediaCount > 0 ? `${mediaCount} 个` : '无'
  renderMediaBadges(data)
  renderThumbs(data)
  const text = content.slice(0, 260)
  $('result-preview').textContent = text ? text + (content.length > 260 ? '…' : '') : '这次选区没有可展示的正文，但仍会保存页面结构和媒体信息。'
  $('result-file-name').value = fileName
  $('result-tags').value = ''
  showState('result')
}

// --- save flow ---

async function saveCapture() {
  if (!captured) return
  if (!serverUrl) {
    const ok = await detectServer()
    if (!ok) return alert('未连接 WorkSpace，请先启动 App')
  }

  const tags = $('result-tags').value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 20)
  const fileName = normalizeFileName($('result-file-name').value) || normalizeFileName(captured.fileName || captured.title) || '未命名剪页'

  const btn = $('btn-save')
  btn.textContent = '正在保存...'
  btn.disabled = true

  try {
    const res = await fetch(`${serverUrl}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...captured, fileName, tags })
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || '未知错误')

    $('done-id').textContent = data.id
    showState('done')
    chrome.runtime.sendMessage({ type: 'clear-pending-capture' })

    // 用一个新标签页打开 ui-client:// 协议地址，让 macOS 唤起 App
    if (data.openUrl) {
      chrome.tabs.create({ url: data.openUrl, active: false })
    }
    captured = null
  } catch (e) {
    alert('保存失败：' + (e?.message || e))
    btn.textContent = '保存到 WorkSpace'
    btn.disabled = false
  }
}

// --- start selection ---

async function startSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return
  await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] })
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] })
  chrome.tabs.sendMessage(tab.id, { type: 'start-selection' })
  window.close()
}

async function cancelSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'cancel-selection' })
  captured = null
  chrome.runtime.sendMessage({ type: 'clear-pending-capture' })
  showState('initial')
}

// --- bootstrap ---

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-start').addEventListener('click', startSelection)
  $('btn-cancel').addEventListener('click', cancelSelection)
  $('btn-cancel-result').addEventListener('click', () => {
    captured = null
    chrome.runtime.sendMessage({ type: 'clear-pending-capture' })
    showState('initial')
  })
  $('btn-save').addEventListener('click', saveCapture)
  $('btn-done-more').addEventListener('click', () => showState('initial'))
  $('status-bar').addEventListener('click', async () => {
    if ($('status-bar').classList.contains('status-bar--missing')) {
      await detectServer()
      if (serverPort) $('btn-start').disabled = false
    }
  })

  // 进入 popup 第一时间检查是否有待处理的剪裁结果
  chrome.runtime.sendMessage({ type: 'get-pending-capture' }, async (data) => {
    const ok = await detectServer()
    $('btn-start').disabled = !ok

    if (data) {
      captured = data
      renderPreview(data)
    } else {
      showState('initial')
    }
  })
})
