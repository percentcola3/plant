/* ui-kit Inspector — 注入到 outputs 预览页里的浏览器内调整工具。
 * 设计目标：让设计师能在预览里点选元素、即时改简单属性、添加备注并写回预览文件。
 *
 * 加载时由 preview-server 在 outputs HTML 末尾注入；上下文从 window.__UIKIT_INSPECTOR 读取，
 * 包含 projectId / relPath / token / apiBase。所有修改会即时改 DOM，并节流 1.5s 后 POST 到
 * /api/preview/edit 写回 HTML 文件。
 */
(function () {
  'use strict'
  if (window.__UIKIT_INSPECTOR_LOADED) return
  window.__UIKIT_INSPECTOR_LOADED = true

  const ctx = window.__UIKIT_INSPECTOR
  if (!ctx || !ctx.projectId || !ctx.relPath || !ctx.token) {
    console.warn('[uikit-inspector] missing context, abort')
    return
  }
  const apiBase = ctx.apiBase || '' // 同源，留空即可
  const Z_BASE = 2147483600
  let workspaceLockPromise = null

  // morphdom 是 12KB UMD，懒加载：只在首次需要 morph reload 时拉一次。
  // 拿不到（404 / 网断）则 fallback 用整页 reload，不阻断核心功能。
  let morphdomPromise = null
  function loadMorphdom() {
    if (morphdomPromise) return morphdomPromise
    if (window.morphdom) return Promise.resolve(window.morphdom)
    morphdomPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = `${apiBase}/static/morphdom.js`
      s.async = true
      s.onload = () => window.morphdom ? resolve(window.morphdom) : reject(new Error('morphdom global missing'))
      s.onerror = () => reject(new Error('morphdom script load failed'))
      document.head.appendChild(s)
    })
    return morphdomPromise
  }

  function ensureWorkspaceLocked() {
    if (!ctx.autoLockWorkspace || !ctx.workspacePath) return Promise.resolve()
    if (workspaceLockPromise) return workspaceLockPromise
    workspaceLockPromise = fetch(`${apiBase}/api/project/workspace-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: ctx.projectId,
        workspacePath: ctx.workspacePath,
        token: ctx.token
      })
    }).then(async (r) => {
      if (!r.ok) throw new Error(await r.text().catch(() => '锁定失败'))
    }).catch((e) => {
      workspaceLockPromise = null
      toast(`锁定编辑范围失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      throw e
    })
    return workspaceLockPromise
  }

  // ───── 状态 ─────
  /** 选中的元素清单：[{ alias, path, el, isRoot, edits: { 'style:color': '#fff' } }] */
  const picks = []
  let pickerActive = false
  let pickerOnce = false
  let elementEditMode = false
  let panelOpen = false
  let popoverMode = 'style'
  let hostEditPick = null
  let hostTabId = ctx.tabId || null
  let hostMode = 'tui'
  let elementDragInfo = null
  let suppressNextClickAfterDrag = false
  const remarksByPath = new Map()
  let remarksLoaded = false
  let remarksLoadPromise = null
  const pendingRemarkSaves = new Map()

  // ───── DOM 工具：CSS path（前后端必须一致）─────
  function computeCssPath(el) {
    const segs = []
    while (el && el.nodeType === 1 && el.tagName.toLowerCase() !== 'html') {
      const tag = el.tagName.toLowerCase()
      const parent = el.parentElement
      if (!parent) break
      const sameTagSibs = Array.from(parent.children).filter(c => c.tagName === el.tagName)
      if (sameTagSibs.length === 1) {
        segs.unshift(tag)
      } else {
        const idx = sameTagSibs.indexOf(el) + 1
        segs.unshift(`${tag}:nth-of-type(${idx})`)
      }
      if (tag === 'body') break
      el = parent
    }
    return segs.join(' > ')
  }

  function nextAlias() {
    const used = new Set(picks.map(p => p.alias))
    for (let i = 0; i < 26; i++) {
      const alias = String.fromCharCode(65 + i)
      if (!used.has(alias)) return alias
    }
    return null
  }

  // 同步 picks 给 host（不含 DOM 引用；带 tagName / textPreview / edits 元数据）
  function syncPicksToHost() {
    const pubPicks = picks.map(p => ({
      alias: p.alias,
      path: p.path,
      tagName: p.el?.tagName?.toLowerCase() ?? '',
      textPreview: extractTextPreview(p.el),
      edits: { ...p.edits }
    }))
    window.parent.postMessage({ type: '__uikit_picks_sync__', tabId: hostTabId || ctx.tabId || ctx.relPath, picks: pubPicks }, '*')
    persistPicksToSession()
  }

  // 把 picks（cssPath + alias + edits）持久化到 sessionStorage，按 relPath 隔离。
  // iframe reload 后 init 时读这里恢复，让选中状态不被整页 reload 擦掉。
  // sessionStorage 跟 iframe 生命周期一致；切到其它项目 / 关 App 自动清。
  const PERSIST_KEY = `__uikit_picks_${ctx.relPath}`
  function persistPicksToSession() {
    try {
      const slim = picks
        .filter(p => p.committed)
        .map(p => ({ alias: p.alias, path: p.path, edits: { ...p.edits } }))
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify(slim))
    } catch { /* 配额超 / 隐私模式都忽略 */ }
  }
  function readPersistedPicks() {
    try {
      const raw = sessionStorage.getItem(PERSIST_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }

  function extractTextPreview(el) {
    if (!el) return ''
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
    return text.slice(0, 80)
  }

  // ───── 网络：写回文件（节流）─────
  // 保存状态机：drives popover header 的小指示
  // 'idle' | 'pending'（用户正在输入，节流中）| 'saving' | 'saved' | 'error'
  let saveState = 'idle'
  let saveStateClearTimer = null
  const saveStateListeners = new Set()
  function setSaveState(next) {
    saveState = next
    if (hostMode === 'ui') {
      window.parent.postMessage({
        type: '__uikit_element_edit_save_state__',
        state: next
      }, '*')
    }
    for (const fn of saveStateListeners) {
      try { fn(next) } catch { /* listener 自己保证不抛 */ }
    }
    if (saveStateClearTimer) { clearTimeout(saveStateClearTimer); saveStateClearTimer = null }
    if (next === 'saved') {
      saveStateClearTimer = setTimeout(() => setSaveState('idle'), 1200)
    }
  }

  const pendingWrites = new Map() // key=`${path}|${kind}` → { value, timer }
  function scheduleWrite(path, kind, value) {
    const key = `${path}|${kind}`
    const prev = pendingWrites.get(key)
    if (prev) clearTimeout(prev.timer)
    setSaveState('pending')
    const timer = setTimeout(() => {
      pendingWrites.delete(key)
      doWrite(path, kind, value)
    }, 300)
    pendingWrites.set(key, { value, timer })
  }
  async function doWrite(path, kind, value) {
    setSaveState('saving')
    try {
      const r = await fetch(`${apiBase}/api/preview/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: ctx.projectId,
          relPath: ctx.relPath,
          token: ctx.token,
          path, kind, value
        })
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        toast(`保存失败：${r.status} ${text}`, 'error')
        setSaveState('error')
        return
      }
      setSaveState('saved')
      // 通知宿主"是我自己的写回"，让宿主在 fs.change 收到时跳过整页 reload。
      // 不通知 = 宿主收 fs.change 后会 reload，inspector + 选中状态全丢。
      try {
        window.parent.postMessage({
          type: '__uikit_self_edit_done__',
          relPath: ctx.relPath,
          ts: Date.now()
        }, '*')
      } catch { /* postMessage 不可能抛，但保护性 catch */ }
    } catch (e) {
      toast(`保存失败：${e.message}`, 'error')
      setSaveState('error')
    }
  }

  // ───── 样式（全部 inline；UI 节点 host 用 #__uikit_inspector__ 锚定）─────
  const STYLE = `
    #__uikit_inspector__, #__uikit_inspector__ * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
    #__uikit_fab__ {
      position: fixed; right: 24px; bottom: 24px;
      width: 52px; height: 52px; border-radius: 50%;
      background: #f26b2f; color: #fff;
      box-shadow: 0 12px 32px rgba(15,23,42,.32);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; cursor: grab; user-select: none;
      z-index: ${Z_BASE + 10};
    }
    #__uikit_fab__:active { cursor: grabbing; }
    #__uikit_fab__.picking { background: #2563eb; }
    #__uikit_inspector__.mode-ui #__uikit_fab__,
    #__uikit_inspector__.mode-ui #__uikit_panel__,
    #__uikit_inspector__.mode-ui #__uikit_style_popover__ {
      display: none !important;
    }
    #__uikit_panel__ {
      position: fixed; right: 24px; bottom: 84px;
      width: 360px; max-height: calc(100vh - 120px);
      background: #fff; color: #0f172a;
      border: 1px solid #e2e8f0; border-radius: 16px;
      box-shadow: 0 24px 64px rgba(15,23,42,.24);
      display: flex; flex-direction: column;
      z-index: ${Z_BASE + 5};
      font-size: 13px; line-height: 1.45;
    }
    #__uikit_panel__ header { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; }
    #__uikit_panel__ header .title { font-weight: 600; font-size: 14px; }
    #__uikit_panel__ header .sub { color: #64748b; font-size: 11px; margin-top: 2px; }
    #__uikit_panel__ .body { overflow-y: auto; padding: 10px 12px; flex: 1; }
    #__uikit_panel__ .row { display: flex; gap: 8px; align-items: center; }
    #__uikit_inspector__ button.btn { background: #f1f5f9; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
    #__uikit_inspector__ button.btn:hover { background: #e2e8f0; }
    #__uikit_inspector__ button.btn-primary { background: #f26b2f; color: #fff; border-color: #f26b2f; }
    #__uikit_inspector__ button.btn-primary:hover { background: #e85a1f; }
    #__uikit_inspector__ button.btn-danger { background: #fff; color: #dc2626; border-color: #fecaca; }
    #__uikit_inspector__ .group { display: flex; flex-direction: column; gap: 6px; }
    #__uikit_inspector__ .group + .group { margin-top: 4px; }
    #__uikit_inspector__ .group .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .08em; }
    #__uikit_inspector__ .field { display: flex; align-items: center; gap: 8px; }
    #__uikit_inspector__ .field label { width: 80px; font-size: 11px; color: #475569; flex-shrink: 0; }
    #__uikit_inspector__ .field input[type=text], #__uikit_inspector__ .field input[type=number], #__uikit_inspector__ .field select { flex: 1; min-width: 0; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; background: #fff; color: #0f172a; }
    #__uikit_inspector__ textarea {
      width: 100%; min-height: 72px; resize: vertical;
      padding: 8px; border: 1px solid #e2e8f0; border-radius: 8px;
      font-size: 12px; line-height: 1.5; color: #0f172a; background: #fff;
      outline: none;
    }
    #__uikit_inspector__ textarea:focus { border-color: #f26b2f; }
    #__uikit_inspector__ .field input[type=color] { width: 40px; height: 28px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0; background: #fff; cursor: pointer; }
    #__uikit_inspector__ .field input[type=range] { flex: 1; }
    #__uikit_inspector__ .field input[type=checkbox] { margin: 0; }
    #__uikit_inspector__ .len-input { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
    #__uikit_inspector__ .len-input input[type=number] { flex: 1; min-width: 0; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; background: #fff; color: #0f172a; }
    #__uikit_inspector__ .len-input .unit { font-size: 11px; color: #94a3b8; flex-shrink: 0; }
    #__uikit_inspector__ .color-row { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
    #__uikit_inspector__ .color-row .color-cell { display: flex; align-items: center; gap: 6px; }
    #__uikit_inspector__ .color-row .color-cell span { font-size: 12px; color: #b8b0a7; }
    #__uikit_panel__ .request {
      min-height: 96px; max-height: 220px; overflow-y: auto;
      padding: 10px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 13px; line-height: 1.5; outline: none;
      background: #fff;
    }
    #__uikit_panel__ .request:focus { border-color: #f26b2f; }
    #__uikit_panel__ .request:empty::before { content: attr(placeholder); color: #94a3b8; }
    #__uikit_panel__ .aliasref {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 1px 6px; margin: 0 2px;
      background: #10b981; color: #fff; border-radius: 6px; font-weight: 700;
      user-select: none; white-space: nowrap; caret-color: transparent;
    }
    #__uikit_panel__ .aliasref__remove {
      width: 14px; height: 14px; padding: 0; border: 0; border-radius: 999px;
      background: rgba(15,23,42,.18); color: #fff; cursor: pointer;
    }
    #__uikit_panel__ .aliasref__remove::before { content: "×"; font-size: 11px; line-height: 14px; }
    #__uikit_panel__ .aliasref__remove:hover { background: rgba(15,23,42,.32); }
    #__uikit_style_popover__ {
      position: fixed; width: 320px; max-height: min(640px, calc(100vh - 24px));
      background: #211f1d; color: #f4f0e8;
      border: 1px solid rgba(255,255,255,.14); border-radius: 12px;
      box-shadow: 0 24px 70px rgba(0,0,0,.38);
      display: none; flex-direction: column;
      z-index: ${Z_BASE + 8};
      font-size: 12px;
      overflow: hidden;
    }
    #__uikit_style_popover__.open { display: flex; }
    #__uikit_style_popover__ header {
      padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.10);
      display: flex; align-items: center; gap: 6px;
      user-select: none;
    }
    #__uikit_style_popover__ [data-pop-drag-handle] { cursor: grab; }
    #__uikit_style_popover__ [data-pop-drag-handle]:active { cursor: grabbing; }
    #__uikit_style_popover__ header .drag-dots {
      width: 16px; color: #a8a29e; font-size: 14px; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center;
    }
    #__uikit_style_popover__ header .title { font-weight: 600; font-size: 13px; flex: 1 1 auto; min-width: 0; }
    #__uikit_style_popover__ header .save-indicator {
      font-size: 11px; color: #a8a29e; white-space: nowrap;
      transition: color 120ms ease;
    }
    #__uikit_style_popover__ header .save-indicator[data-state="saving"],
    #__uikit_style_popover__ header .save-indicator[data-state="pending"] { color: #93c5fd; }
    #__uikit_style_popover__ header .save-indicator[data-state="saved"] { color: #86efac; }
    #__uikit_style_popover__ header .save-indicator[data-state="error"] { color: #fca5a5; }
    #__uikit_style_popover__ header .save-indicator[data-state="idle"] { display: none; }
    #__uikit_style_popover__ .close-btn {
      width: 22px; height: 22px; padding: 0;
      background: transparent; border: 1px solid rgba(255,255,255,.12);
      border-radius: 6px; font-size: 12px; cursor: pointer; color: #e7e5e4;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #__uikit_style_popover__ .close-btn:hover { background: rgba(255,255,255,.12); }
    #__uikit_style_popover__ .actions {
      display: flex; align-items: center; gap: 4px; flex-shrink: 0;
    }
    #__uikit_style_popover__ .icon-btn {
      width: 22px; height: 22px; padding: 0;
      background: transparent; border: 1px solid rgba(255,255,255,.16);
      border-radius: 6px; font-size: 12px; line-height: 1;
      cursor: pointer; color: #e7e5e4;
      display: inline-flex; align-items: center; justify-content: center;
    }
    #__uikit_style_popover__ .icon-btn:hover { background: rgba(255,255,255,.10); border-color: rgba(255,255,255,.28); }
    #__uikit_style_popover__ .icon-btn.icon-btn-primary { background: #f26b2f; border-color: #f26b2f; color: #fff; }
    #__uikit_style_popover__ .icon-btn.icon-btn-primary:hover { background: #e85a1f; }
    #__uikit_style_popover__ .icon-btn.icon-btn-danger { color: #fca5a5; border-color: rgba(248,113,113,.45); }
    #__uikit_style_popover__ .icon-btn.icon-btn-danger:hover { background: rgba(248,113,113,.10); }
    #__uikit_style_popover__ .icon-btn.is-active { background: rgba(242,107,47,.20); border-color: rgba(242,107,47,.70); color: #fed7aa; }
    #__uikit_style_popover__ .body { padding: 10px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px; }
    #__uikit_style_popover__ .group { gap: 6px; }
    #__uikit_style_popover__ .group + .group { margin-top: 0; }
    #__uikit_style_popover__ .group .label {
      color: #aaa39a; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
    }
    #__uikit_style_popover__ .field {
      display: grid; grid-template-columns: 56px minmax(0, 1fr);
      align-items: center; gap: 8px;
    }
    #__uikit_style_popover__ .field label {
      width: auto; color: #b8b0a7; font-size: 12px;
    }
    #__uikit_style_popover__ input[type=text],
    #__uikit_style_popover__ input[type=number],
    #__uikit_style_popover__ select,
    #__uikit_style_popover__ textarea,
    #__uikit_style_popover__ .len-input input[type=number] {
      background: #35332f; color: #f4f0e8;
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 6px;
    }
    #__uikit_style_popover__ textarea {
      min-height: 220px;
    }
    #__uikit_style_popover__ input:focus,
    #__uikit_style_popover__ select:focus,
    #__uikit_style_popover__ textarea:focus { border-color: rgba(255,255,255,.36); }

    html.__uikit_element_edit_mode__ .__uikit_pick_marked__ {
      cursor: move !important;
    }
    .__uikit_pick_hover__,
    .__uikit_pick_selection__ {
      position: fixed;
      left: 0; top: 0;
      width: 0; height: 0;
      pointer-events: none;
      border: 2px solid #f26b2f;
      border-radius: 2px;
      box-shadow: none !important;
      z-index: ${Z_BASE + 1};
      transition: none;
    }
    .__uikit_remark_overlay_svg__ {
      position: fixed; left: 0; top: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: ${Z_BASE + 1};
    }
    .__uikit_remark_overlay_svg__ path { fill: none; stroke: #f26b2f; stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
    .__uikit_remark_anchor__ {
      position: fixed; width: 8px; height: 8px; border-radius: 50%;
      background: #f26b2f; border: 2px solid #fff;
      box-shadow: 0 0 0 1px rgba(242,107,47,.4);
      pointer-events: none; z-index: ${Z_BASE + 1};
    }
    .__uikit_remark_card__ {
      position: fixed;
      display: flex; align-items: flex-start; gap: 8px;
      max-width: 240px; padding: 8px 10px;
      background: #fff; color: #1f2937;
      border: 1px solid #fed7aa; border-radius: 8px;
      font-size: 12px; line-height: 1.5;
      box-shadow: 0 6px 18px rgba(15,23,42,.12);
      z-index: ${Z_BASE + 1};
      pointer-events: auto; user-select: none;
      white-space: pre-wrap; word-break: break-word;
      cursor: grab;
    }
    .__uikit_remark_card__:active { cursor: grabbing; }
    .__uikit_remark_card__.is-dragging { box-shadow: 0 12px 28px rgba(15,23,42,.22); transition: none; }
    .__uikit_remark_card__ .uikit-remark-index {
      width: 18px; height: 18px; flex-shrink: 0; border-radius: 50%;
      background: #f26b2f; color: #fff; font-weight: 700; font-size: 11px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .__uikit_pick_toolbar__ {
      position: fixed;
      width: 22px; height: 22px; border-radius: 50%;
      background: #f26b2f; color: #fff; font-weight: 700; font-size: 12px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 6px rgba(15,23,42,.22);
      z-index: ${Z_BASE + 2};
      cursor: pointer; user-select: none;
      pointer-events: auto;
      transition: top .08s linear, left .08s linear, transform 80ms ease;
    }
    .__uikit_pick_toolbar__:hover { transform: scale(1.08); }

    #__uikit_toast__ {
      position: fixed; right: 24px; top: 24px;
      max-width: 360px; padding: 10px 14px;
      border-radius: 10px; font-size: 13px;
      box-shadow: 0 12px 32px rgba(15,23,42,.32);
      z-index: ${Z_BASE + 20};
      color: #fff;
      transition: opacity .25s, transform .25s;
    }
    #__uikit_toast__.success { background: #059669; }
    #__uikit_toast__.error { background: #dc2626; }
    #__uikit_toast__.info { background: #0f172a; }
    #__uikit_toast__.hidden { opacity: 0; transform: translateY(-8px); pointer-events: none; }
  `

  // ───── 容器 + 样式注入 ─────
  const host = document.createElement('div')
  host.id = '__uikit_inspector__'
  document.body.appendChild(host)
  const styleEl = document.createElement('style')
  styleEl.textContent = STYLE
  host.appendChild(styleEl)

  function setHostMode(mode) {
    hostMode = mode === 'ui' ? 'ui' : 'tui'
    host.classList.toggle('mode-ui', hostMode === 'ui')
    host.classList.toggle('mode-tui', hostMode !== 'ui')
    if (hostMode === 'ui' && panelOpen) {
      panelOpen = false
      panelEl.style.display = 'none'
    }
    if (hostMode === 'ui') {
      closeStylePopover()
      postElementEditSelection(hostEditPick)
      window.parent.postMessage({
        type: '__uikit_element_edit_save_state__',
        state: saveState
      }, '*')
    }
  }

  // toast
  const toastEl = document.createElement('div')
  toastEl.id = '__uikit_toast__'
  toastEl.classList.add('hidden')
  host.appendChild(toastEl)
  let toastTimer = null
  function toast(msg, kind) {
    toastEl.textContent = msg
    toastEl.className = (kind || 'info')
    setTimeout(() => toastEl.classList.remove('hidden'), 10)
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2400)
  }

  // ───── 悬浮球 ─────
  const fab = document.createElement('div')
  fab.id = '__uikit_fab__'
  fab.title = '点击展开 / 拖动调整位置'
  fab.textContent = '✦'
  host.appendChild(fab)

  // FAB / 面板的"距离右下"偏移；以可见区右下角为锚点（被嵌入 ui-client 时由 parent 推送可见区）。
  let savedOffsetRight = 24
  let savedOffsetBottom = 24
  // parent 推送的"iframe 不可见部分"尺寸；独立打开时保持 0,0（视口就是 iframe 自身）。
  let clipRight = 0
  let clipBottom = 0

  // 恢复偏移
  try {
    const saved = JSON.parse(localStorage.getItem('__uikit_fab_pos__') || 'null')
    if (saved && typeof saved.right === 'number' && typeof saved.bottom === 'number') {
      savedOffsetRight = saved.right
      savedOffsetBottom = saved.bottom
    }
  } catch { /* ignore */ }

  function applyFabPosition() {
    const right = clipRight + savedOffsetRight
    const bottom = clipBottom + savedOffsetBottom
    fab.style.right = right + 'px'
    fab.style.bottom = bottom + 'px'
    panelEl.style.right = right + 'px'
    panelEl.style.bottom = (bottom + 60) + 'px'
  }

  // 接收 parent 推送的可见区裁剪信息
  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === '__uikit_visible_rect__') {
      if (typeof d.clipRight === 'number') clipRight = Math.max(0, d.clipRight)
      if (typeof d.clipBottom === 'number') clipBottom = Math.max(0, d.clipBottom)
      applyFabPosition()
      return
    }
    if (d.type === '__uikit_host_context__') {
      if (typeof d.tabId === 'string') hostTabId = d.tabId
      setHostMode(d.mode)
      syncPicksToHost()
      syncRequestToHost()
      return
    }
    if (d.type === '__uikit_pick_once__') {
      startPickOnce()
      return
    }
    if (d.type === '__uikit_pick_cancel__') {
      if (!elementEditMode) setPickerActive(false, false)
      return
    }
    if (d.type === '__uikit_element_edit_mode__') {
      setElementEditMode(Boolean(d.enabled))
      return
    }
    if (
      d.type === '__uikit_element_edit_apply__'
      && typeof d.path === 'string'
      && typeof d.value === 'string'
    ) {
      const pick = picks.find(item => item.path === d.path)
      if (!pick || hostEditPick !== pick) return
      if (d.kind === 'text') {
        writeTextEdit(pick, d.value)
      } else if (typeof d.property === 'string') {
        writeStyleEdit(pick, d.property, d.value)
      }
      return
    }
    if (
      d.type === '__uikit_element_edit_action__'
      && typeof d.path === 'string'
      && (d.action === 'reset' || d.action === 'delete')
    ) {
      const pick = picks.find(item => item.path === d.path)
      if (!pick || hostEditPick !== pick) return
      if (d.action === 'reset') resetPick(pick)
      else deletePickElement(pick)
      return
    }
    if (d.type === '__uikit_remarks_visible__') {
      setRemarksOverlayVisible(Boolean(d.visible))
      return
    }
    if (d.type === '__uikit_request_set__' && typeof d.text === 'string') {
      setRequestText(d.text)
      return
    }
    if (d.type === '__uikit_remove_pick__' && typeof d.path === 'string') {
      removePickByPath(d.path)
      return
    }
    if (d.type === '__uikit_sync_pick_paths__' && Array.isArray(d.paths)) {
      syncPicksFromHostPaths(d.paths)
      return
    }
    if (d.type === '__uikit_morph_reload__') {
      void handleMorphReload()
      return
    }
  })

  // 用 morphdom 把当前 DOM 增量更新到磁盘上的最新版本，避免整页 reload
  // 把选中 / 滚动 / popover 全部擦掉。失败 fallback 到整页 reload。
  let morphReloadInFlight = false
  async function handleMorphReload() {
    if (morphReloadInFlight) return
    morphReloadInFlight = true
    try {
      const morphdom = await loadMorphdom()
      const url = window.location.pathname + '?_morph=' + Date.now()
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error('fetch ' + res.status)
      const text = await res.text()
      const newDoc = new DOMParser().parseFromString(text, 'text/html')
      if (!newDoc || !newDoc.body) throw new Error('parse failed')

      const scrollX = window.scrollX
      const scrollY = window.scrollY
      const inspectorHost = document.getElementById('__uikit_inspector__')

      morphdom(document.body, newDoc.body, {
        // 不让 morphdom 碰 inspector host 节点（保留它的子树和监听）
        onBeforeNodeDiscarded: (node) => node !== inspectorHost,
        onBeforeElUpdated: (fromEl, toEl) => {
          if (fromEl === inspectorHost) return false
          // 跳过相同节点（小优化）
          if (fromEl.isEqualNode(toEl)) return false
          return true
        }
      })

      // 新 DOM 结构里 inspector host 不存在 → morphdom 在它"该消失"时被我们留下了，
      // 但它在 body 末尾的位置可能挪了。确保它仍是 body 直接子元素。
      if (inspectorHost && inspectorHost.parentNode !== document.body) {
        document.body.appendChild(inspectorHost)
      }

      window.scrollTo(scrollX, scrollY)
      // picks 引用的旧 DOM 节点可能被替换；重新解析每个 cssPath 让 pick.el 指向新节点
      refreshPicksAfterMorph()
      // 通知宿主"morph 完成"，宿主就不需要 fallback reload 了
      window.parent.postMessage({ type: '__uikit_morph_done__', relPath: ctx.relPath }, '*')
    } catch (e) {
      console.warn('[uikit-inspector] morph reload failed, falling back:', e)
      window.parent.postMessage({ type: '__uikit_morph_failed__', relPath: ctx.relPath, message: String(e?.message || e) }, '*')
    } finally {
      morphReloadInFlight = false
    }
  }

  // morphdom 之后，picks 里 pick.el 可能指向旧的（被替换的）DOM 节点。
  // 按 cssPath 重新解析；找不到的 pick 静默丢弃 + 移除 toolbar；找到的更新
  // pick.el 引用 + 重画 toolbar 位置。
  function refreshPicksAfterMorph() {
    const survivors = []
    for (const pick of picks) {
      let el
      try { el = document.querySelector(pick.path) } catch { el = null }
      if (!el) {
        destroyToolbar(pick)
        continue
      }
      // morphdom 可能保留了原节点（onBeforeElUpdated 没替换），也可能换成了新节点；
      // 不管哪种情况，重新打标记 + 引用 + 工具条都安全。
      el.setAttribute('data-uikit-alias', pick.alias)
      el.classList.add('__uikit_pick_marked__')
      pick.el = el
      createSelectionOverlay(pick)
      updateSelectionOverlay(pick)
      survivors.push(pick)
    }
    picks.length = 0
    picks.push(...survivors)
    if (hostEditPick && !survivors.includes(hostEditPick)) hostEditPick = null
    updateAllToolbarPositions()
    syncPicksToHost()
    if (hostMode === 'ui') postElementEditSelection(hostEditPick)
  }

  // 拖动
  let dragInfo = null
  fab.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    dragInfo = {
      startX: e.clientX,
      startY: e.clientY,
      startOffsetRight: savedOffsetRight,
      startOffsetBottom: savedOffsetBottom,
      moved: false
    }
    e.preventDefault()
  })
  window.addEventListener('mousemove', (e) => {
    if (!dragInfo) return
    const dx = e.clientX - dragInfo.startX
    const dy = e.clientY - dragInfo.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) dragInfo.moved = true
    savedOffsetRight = Math.max(8, dragInfo.startOffsetRight - dx)
    savedOffsetBottom = Math.max(8, dragInfo.startOffsetBottom - dy)
    applyFabPosition()
  })
  window.addEventListener('mouseup', () => {
    if (!dragInfo) return
    const moved = dragInfo.moved
    if (moved) {
      try {
        localStorage.setItem('__uikit_fab_pos__', JSON.stringify({
          right: savedOffsetRight,
          bottom: savedOffsetBottom
        }))
      } catch { /* ignore */ }
    }
    dragInfo = null
    if (!moved) togglePanel()
  })

  // ───── 主面板 ─────
  const panelEl = document.createElement('div')
  panelEl.id = '__uikit_panel__'
  panelEl.style.display = 'none'
  panelEl.innerHTML = `
    <header>
      <div>
        <div class="title">设计调整工具</div>
        <div class="sub">点选元素，改属性，添加备注</div>
      </div>
      <button class="btn" data-action="close">关闭</button>
    </header>
    <div class="body">
      <div class="group" style="margin-top: 14px;">
        <div class="label">复杂诉求（用 @A、@B 引用元素）</div>
        <div class="request" contenteditable="true" data-role="request" placeholder="例：只改 @A 卡片内部。让 @B 按钮更突出；如果点击 @B，则让 @A 底部说明区展开。"></div>
      </div>
    </div>
  `
  host.appendChild(panelEl)

  // ───── 样式微调 popover（单例）─────
  const stylePopoverEl = document.createElement('div')
  stylePopoverEl.id = '__uikit_style_popover__'
  stylePopoverEl.innerHTML = `
    <header>
      <div data-pop-drag-handle style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
        <span class="drag-dots">⠿</span>
        <span class="title"></span>
        <span class="save-indicator" data-state="idle"></span>
      </div>
      <div class="actions" data-pop-actions>
        <button class="icon-btn" type="button" data-pop-action="remark" title="备注" aria-label="备注">📝</button>
        <button class="icon-btn icon-btn-primary" type="button" data-pop-action="insert-chat" title="加入到对话" aria-label="加入到对话">＋</button>
        <button class="icon-btn icon-btn-danger" type="button" data-pop-action="delete" title="删除元素" aria-label="删除元素">🗑</button>
        <button class="icon-btn" type="button" data-pop-action="reset" title="重置该元素" aria-label="重置该元素">↺</button>
      </div>
      <button class="close-btn" type="button" data-pop-action="close" title="关闭">✕</button>
    </header>
    <div class="body"></div>
  `
  host.appendChild(stylePopoverEl)
  let popoverPick = null
  const popoverTitleEl = stylePopoverEl.querySelector('.title')
  const popoverBodyEl = stylePopoverEl.querySelector('.body')
  const saveIndicatorEl = stylePopoverEl.querySelector('.save-indicator')
  const remarkModeButton = stylePopoverEl.querySelector('[data-pop-action=remark]')

  const SAVE_INDICATOR_TEXT = {
    idle: '',
    pending: '⋯ 等待保存',
    saving: '⋯ 保存中',
    saved: '● 已保存',
    error: '✕ 保存失败'
  }
  function renderSaveIndicator(state) {
    if (!saveIndicatorEl) return
    saveIndicatorEl.dataset.state = state
    saveIndicatorEl.textContent = SAVE_INDICATOR_TEXT[state] || ''
  }
  saveStateListeners.add(renderSaveIndicator)
  renderSaveIndicator(saveState)

  const HOST_TUNABLE_STYLES = new Set([
    'color',
    'background-color',
    'font-size',
    'font-weight',
    'line-height',
    'text-align',
    'display',
    'flex-direction',
    'flex-wrap',
    'justify-content',
    'align-items',
    'gap',
    'row-gap',
    'column-gap',
    'flex',
    'flex-grow',
    'flex-shrink',
    'flex-basis',
    'order',
    'margin',
    'padding',
    'width',
    'height',
    'border-radius'
  ])

  function readPickStyle(pick, property) {
    const edited = pick.edits[`style:${property}`]
    if (edited !== undefined) return edited
    return (getComputedStyle(pick.el).getPropertyValue(property) || '').trim()
  }

  function elementEditSelectionSnapshot(pick) {
    if (!pick?.el?.isConnected) return null
    return {
      alias: pick.alias,
      path: pick.path,
      tagName: pick.el.tagName.toLowerCase(),
      textContent: pick.edits['text:content'] !== undefined ? pick.edits['text:content'] : (pick.el.textContent || ''),
      textPreview: extractTextPreview(pick.el),
      styles: {
        color: normalizeColor(readPickStyle(pick, 'color')) || '#000000',
        backgroundColor: normalizeColor(readPickStyle(pick, 'background-color')) || '#ffffff',
        fontSize: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'font-size')))),
        fontWeight: readPickStyle(pick, 'font-weight') || '400',
        lineHeight: readPickStyle(pick, 'line-height') || 'normal',
        textAlign: readPickStyle(pick, 'text-align') || 'start',
        display: readPickStyle(pick, 'display') || 'block',
        flexDirection: readPickStyle(pick, 'flex-direction') || 'row',
        flexWrap: readPickStyle(pick, 'flex-wrap') || 'nowrap',
        justifyContent: readPickStyle(pick, 'justify-content') || 'normal',
        alignItems: readPickStyle(pick, 'align-items') || 'normal',
        gap: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'gap')))),
        rowGap: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'row-gap')))),
        columnGap: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'column-gap')))),
        flex: readPickStyle(pick, 'flex') || '',
        flexGrow: readPickStyle(pick, 'flex-grow') || '0',
        flexShrink: readPickStyle(pick, 'flex-shrink') || '1',
        flexBasis: readPickStyle(pick, 'flex-basis') || 'auto',
        order: readPickStyle(pick, 'order') || '0',
        margin: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'margin')))),
        padding: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'padding')))),
        width: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'width')))),
        height: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'height')))),
        borderRadius: Math.max(0, Math.round(parseLengthPx(readPickStyle(pick, 'border-radius'))))
      }
    }
  }

  function postElementEditSelection(pick) {
    hostEditPick = pick?.el?.isConnected ? pick : null
    window.parent.postMessage({
      type: '__uikit_element_edit_selection__',
      selection: elementEditSelectionSnapshot(hostEditPick)
    }, '*')
  }

  function writeStyleEdit(pick, property, value) {
    if (!pick || !HOST_TUNABLE_STYLES.has(property)) return
    pick.edits[`style:${property}`] = value
    pick.el.style.setProperty(property, value)
    updateSelectionOverlay(pick)
    updateToolbarPos(pick)
    positionRemarkOverlays()
    scheduleWrite(pick.path, `style:${property}`, value)
    syncPicksToHost()
    if (hostMode === 'ui' && hostEditPick === pick) postElementEditSelection(pick)
  }

  function writeTextEdit(pick, value) {
    if (!pick) return
    pick.edits['text:content'] = value
    pick.el.textContent = value
    updateSelectionOverlay(pick)
    updateToolbarPos(pick)
    positionRemarkOverlays()
    scheduleWrite(pick.path, 'text:content', value)
    syncPicksToHost()
    if (hostMode === 'ui' && hostEditPick === pick) postElementEditSelection(pick)
  }

  function openStylePopover(pick, mode) {
    if (hostMode === 'ui') {
      postElementEditSelection(pick)
      return
    }
    popoverMode = mode || 'style'
    popoverPick = pick
    popoverTitleEl.textContent = `@${pick.alias} 元素微调`
    renderStylePopoverBody(pick)
    stylePopoverEl.classList.add('open')
    // morph 重渲染后 pick.el 可能已脱离文档（rect 全 0）→ 按 cssPath 重取一次，
    // 仍拿不到就传 null，让 positionPopoverByRect 走居中兜底，别甩到左上角被裁。
    if (!pick.el || !pick.el.isConnected) {
      let fresh = null
      try { fresh = document.querySelector(pick.path) } catch { fresh = null }
      if (fresh) pick.el = fresh
    }
    const rect = pick.el && pick.el.isConnected ? pick.el.getBoundingClientRect() : null
    positionPopoverByRect(rect)
    void loadRemarks().then(() => syncOpenRemarkField(pick))
  }

  function renderStylePopoverBody(pick) {
    popoverBodyEl.innerHTML = ''
    if (popoverMode === 'remark') {
      popoverBodyEl.appendChild(buildRemarkPanel(pick))
    } else {
      popoverBodyEl.appendChild(buildAttrPanel(pick))
    }
    renderPopoverFooterState()
  }

  function renderPopoverFooterState() {
    if (!remarkModeButton) return
    const isRemark = popoverMode === 'remark'
    remarkModeButton.textContent = isRemark ? '✎' : '📝'
    remarkModeButton.title = isRemark ? '返回微调' : '备注'
    remarkModeButton.setAttribute('aria-label', remarkModeButton.title)
    remarkModeButton.classList.toggle('is-active', isRemark)
  }

  function closeStylePopover() {
    if (!popoverPick) return
    popoverPick = null
    stylePopoverEl.classList.remove('open')
    popoverBodyEl.innerHTML = ''
    stylePopoverEl.style.left = stylePopoverEl.style.right = stylePopoverEl.style.top = ''
  }

  // 锚到元素：默认右侧；右侧不够放左侧；最后统一钳进视口内。
  // rect 退化（元素未布局 / 已脱离文档，宽高都为 0）或缺失 → 居中兜底，
  // 否则 left=8/top=0 会把弹窗甩到左上角被裁（见元素编辑回归 bug）。
  function positionPopoverByRect(rect) {
    const W = 320, H = Math.min(stylePopoverEl.scrollHeight || 360, 480)
    const vw = window.innerWidth, vh = window.innerHeight
    const degenerate = !rect || (rect.width === 0 && rect.height === 0)
    let left, top
    if (degenerate) {
      left = (vw - W) / 2
      top = (vh - H) / 2
    } else {
      left = rect.right + 8
      if (left + W > vw - 8) left = rect.left - W - 8
      top = rect.top
    }
    // 统一钳进视口（含 top 下限，修复贴顶 / 越界被裁）
    left = Math.max(8, Math.min(left, vw - W - 8))
    top = Math.max(8, Math.min(top, vh - H - 8))
    stylePopoverEl.style.left = left + 'px'
    stylePopoverEl.style.top = top + 'px'
  }

  stylePopoverEl.addEventListener('click', (e) => {
    const action = e.target.closest('[data-pop-action]')?.getAttribute('data-pop-action')
    if (!action) return
    if (action === 'close') {
      // 临时 pick（未加入对话）随面板关闭一并丢弃，不留残影
      if (popoverPick && !popoverPick.committed) removePick(popoverPick)
      else closeStylePopover()
    } else if (action === 'reset') {
      if (!popoverPick) return
      const pick = popoverPick
      resetPick(pick)
      // 重置后刷新 popover 内容（getComputedStyle 会反映清空后的值）
      renderStylePopoverBody(pick)
    } else if (action === 'insert-chat') {
      if (popoverPick) {
        const pick = popoverPick
        insertPickToChat(pick)
        if (!pick.committed) {
          pick.committed = true
          createToolbar(pick)
          updateToolbarPos(pick)
          syncPicksToHost()
        }
        closeStylePopover()
      }
    } else if (action === 'delete') {
      if (popoverPick) deletePickElement(popoverPick)
    } else if (action === 'remark') {
      if (!popoverPick) return
      popoverMode = popoverMode === 'remark' ? 'style' : 'remark'
      renderStylePopoverBody(popoverPick)
      if (popoverMode === 'remark') void loadRemarks().then(() => syncOpenRemarkField(popoverPick))
    }
  })

  let popoverDragInfo = null
  function startPopoverDrag(e) {
    if (e.button !== 0) return
    if (e.target.closest('[data-pop-action]')) return
    const rect = stylePopoverEl.getBoundingClientRect()
    popoverDragInfo = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top
    }
    e.preventDefault()
  }
  stylePopoverEl.querySelector('[data-pop-drag-handle]')?.addEventListener('mousedown', startPopoverDrag)
  window.addEventListener('mousemove', (e) => {
    if (!popoverDragInfo) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = stylePopoverEl.getBoundingClientRect()
    const left = Math.max(8, Math.min(vw - rect.width - 8, popoverDragInfo.startLeft + e.clientX - popoverDragInfo.startX))
    const top = Math.max(8, Math.min(vh - 48, popoverDragInfo.startTop + e.clientY - popoverDragInfo.startY))
    stylePopoverEl.style.left = left + 'px'
    stylePopoverEl.style.top = top + 'px'
    stylePopoverEl.style.right = ''
  })
  window.addEventListener('mouseup', () => {
    popoverDragInfo = null
  })

  document.addEventListener('mousedown', (e) => {
    if (!popoverPick) return
    if (stylePopoverEl.contains(e.target)) return
    // 点到的是其它工具条微调按钮交给 openStylePopover 自己处理（toggle/切换）
    if (e.target.closest('[data-tb-action=tweak]')) return
    closeStylePopover()
  }, true)

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popoverPick) closeStylePopover()
  })

  // panelEl 就位后应用初始位置（包含从 localStorage 恢复的偏移）
  applyFabPosition()

  const requestEl = panelEl.querySelector('[data-role=request]')

  function requestTabId() {
    return hostTabId || ctx.tabId || ctx.relPath
  }

  function syncRequestToHost() {
    window.parent.postMessage({
      type: '__uikit_request_sync__',
      tabId: requestTabId(),
      text: requestEl.textContent || ''
    }, '*')
  }

  function setRequestText(text) {
    const next = String(text || '')
    if ((requestEl.textContent || '') === next) return
    requestEl.textContent = next
    refreshRequestHighlight()
    syncRequestToHost()
  }

  function togglePanel() {
    panelOpen = !panelOpen
    panelEl.style.display = panelOpen ? 'flex' : 'none'
    if (panelOpen) void ensureWorkspaceLocked()
  }

  // 关闭按钮
  panelEl.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.getAttribute('data-action')
    if (!action) return
    if (action === 'close') togglePanel()
  })

  // ───── 拾取模式 ─────
  let hoverEl = null
  const hoverOverlayEl = document.createElement('div')
  hoverOverlayEl.className = '__uikit_pick_hover__'
  hoverOverlayEl.style.display = 'none'
  host.appendChild(hoverOverlayEl)

  function updateHoverOverlay() {
    if (!hoverEl || !hoverEl.isConnected) {
      hoverOverlayEl.style.display = 'none'
      return
    }
    const rect = hoverEl.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      hoverOverlayEl.style.display = 'none'
      return
    }
    hoverOverlayEl.style.display = ''
    hoverOverlayEl.style.left = rect.left + 'px'
    hoverOverlayEl.style.top = rect.top + 'px'
    hoverOverlayEl.style.width = Math.max(1, rect.width) + 'px'
    hoverOverlayEl.style.height = Math.max(1, rect.height) + 'px'
  }
  function setPickerActive(active, once) {
    pickerActive = active
    pickerOnce = !!once && active
    fab.classList.toggle('picking', pickerActive)
    const btn = panelEl.querySelector('[data-action=toggle-pick]')
    if (btn) btn.textContent = pickerActive ? '退出拾取' : '拾取一个'
    if (pickerActive) void ensureWorkspaceLocked()
    if (!pickerActive) clearHover()
    if (hostMode === 'ui') {
      window.parent.postMessage({
        type: '__uikit_picker_state__',
        active: pickerActive,
        mode: elementEditMode ? 'edit' : 'select'
      }, '*')
    }
  }

  function setElementEditMode(enabled) {
    const next = Boolean(enabled)
    if (elementEditMode === next) return
    elementEditMode = next
    document.documentElement.classList.toggle('__uikit_element_edit_mode__', elementEditMode)
    setPickerActive(elementEditMode, false)
    if (elementEditMode) {
      postElementEditSelection(null)
      toast('元素微调已开启：选择元素后在侧栏中调整', 'info')
    } else {
      clearTransientEditPicks()
      postElementEditSelection(null)
    }
  }

  function startPickOnce() {
    if (elementEditMode) setElementEditMode(false)
    elementEditMode = false
    setPickerActive(true, hostMode !== 'ui')
    toast(hostMode === 'ui' ? '元素选择已开启' : '选择元素后会直接加入 AI 输入框', 'info')
  }

  function clearHover() {
    hoverEl = null
    hoverOverlayEl.style.display = 'none'
  }

  // ───── 元素上的浮动徽标（A/B/C 圆）─────
  function createSelectionOverlay(pick) {
    if (pick.selection) return
    const sel = document.createElement('div')
    sel.className = '__uikit_pick_selection__'
    sel.setAttribute('data-alias', pick.alias)
    host.appendChild(sel)
    pick.selection = sel
  }

  function updateSelectionOverlay(pick) {
    if (!pick.selection || !pick.el.isConnected) return
    const rect = pick.el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      pick.selection.style.display = 'none'
      return
    }
    pick.selection.style.display = ''
    pick.selection.style.left = rect.left + 'px'
    pick.selection.style.top = rect.top + 'px'
    pick.selection.style.width = Math.max(1, rect.width) + 'px'
    pick.selection.style.height = Math.max(1, rect.height) + 'px'
  }

  function destroySelectionOverlay(pick) {
    if (!pick.selection) return
    pick.selection.remove()
    pick.selection = null
  }

  function createToolbar(pick) {
    const tb = document.createElement('div')
    tb.className = '__uikit_pick_toolbar__'
    tb.title = `@${pick.alias}（点击重新打开微调）`
    tb.textContent = pick.alias
    tb.addEventListener('click', (e) => {
      e.stopPropagation()
      openStylePopover(pick)
    })
    host.appendChild(tb)
    pick.toolbar = tb
  }

  function updateToolbarPos(pick) {
    if (!pick.toolbar || !pick.el.isConnected) return
    const rect = pick.el.getBoundingClientRect()
    const badge = 22, gap = 4, outline = 2
    let left = rect.left
    let top = rect.top - badge - gap - outline
    if (top < 0) top = rect.bottom + gap + outline
    pick.toolbar.style.left = left + 'px'
    pick.toolbar.style.top = top + 'px'
  }

  function destroyToolbar(pick) {
    if (!pick.toolbar) return
    pick.toolbar.remove()
    pick.toolbar = null
  }

  function updateAllToolbarPositions() {
    updateHoverOverlay()
    for (const p of picks) {
      updateToolbarPos(p)
      updateSelectionOverlay(p)
    }
  }

  let toolbarRafId = null
  function scheduleToolbarUpdate() {
    if (toolbarRafId) return
    toolbarRafId = requestAnimationFrame(() => {
      toolbarRafId = null
      updateAllToolbarPositions()
      positionRemarkOverlays()
    })
  }
  window.addEventListener('scroll', scheduleToolbarUpdate, true)
  window.addEventListener('resize', scheduleToolbarUpdate)

  // Ctrl/⌘+滚轮 与触控板双指捏合：iframe 内的 wheel 事件不会冒泡到父窗口，
  // 这里捕获并 postMessage 给宿主，由宿主统一调整画布视觉缩放。
  window.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    window.parent.postMessage({
      type: '__uikit_zoom_wheel__',
      deltaY: e.deltaY,
      deltaMode: e.deltaMode
    }, '*')
  }, { passive: false, capture: true })

  function isInsideInspectorUI(el) {
    return host.contains(el)
  }

  function pickFromTarget(target) {
    if (!target || target.nodeType !== 1) return null
    return picks
      .filter(p => p.el && p.el.isConnected && (p.el === target || p.el.contains(target)))
      .sort((a, b) => {
        const ar = a.el.getBoundingClientRect()
        const br = b.el.getBoundingClientRect()
        return (ar.width * ar.height) - (br.width * br.height)
      })[0] || null
  }

  function parseTranslatePx(value) {
    const raw = String(value || '').trim()
    if (!raw || raw === 'none') return { x: 0, y: 0 }
    const parts = raw.split(/\s+/)
    return {
      x: parseLengthPx(parts[0] || '0'),
      y: parseLengthPx(parts[1] || '0')
    }
  }

  function currentTranslateForPick(pick) {
    const edited = pick.edits['style:translate']
    if (edited !== undefined) return parseTranslatePx(edited)
    const inline = pick.el.style.getPropertyValue('translate')
    if (inline) return parseTranslatePx(inline)
    return parseTranslatePx(getComputedStyle(pick.el).translate)
  }

  function startElementDrag(e, pick) {
    if (!pick || e.button !== 0) return
    const initial = currentTranslateForPick(pick)
    elementDragInfo = {
      pick,
      startX: e.clientX,
      startY: e.clientY,
      startTranslateX: initial.x,
      startTranslateY: initial.y,
      moved: false
    }
    pick.selection?.classList.add('is-dragging')
    e.preventDefault()
    e.stopPropagation()
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }

  document.addEventListener('mousedown', (e) => {
    if (!elementEditMode || isInsideInspectorUI(e.target)) return
    const pick = pickFromTarget(e.target)
    if (!pick) return
    startElementDrag(e, pick)
  }, true)

  window.addEventListener('mousemove', (e) => {
    const s = elementDragInfo
    if (!s) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (!s.moved && Math.abs(dx) + Math.abs(dy) < 3) return
    s.moved = true
    const value = `${Math.round(s.startTranslateX + dx)}px ${Math.round(s.startTranslateY + dy)}px`
    s.pick.edits['style:translate'] = value
    s.pick.el.style.setProperty('translate', value)
    updateSelectionOverlay(s.pick)
    updateToolbarPos(s.pick)
    positionRemarkOverlays()
    if (popoverPick === s.pick) positionPopoverByRect(s.pick.el.getBoundingClientRect())
    e.preventDefault()
  }, true)

  window.addEventListener('mouseup', () => {
    const s = elementDragInfo
    if (!s) return
    elementDragInfo = null
    s.pick.selection?.classList.remove('is-dragging')
    if (!s.moved) return
    const value = s.pick.edits['style:translate'] || ''
    suppressNextClickAfterDrag = true
    scheduleWrite(s.pick.path, 'style:translate', value)
    syncPicksToHost()
  }, true)

  document.addEventListener('mouseover', (e) => {
    if (!pickerActive) return
    const t = e.target
    if (isInsideInspectorUI(t)) { clearHover(); return }
    clearHover()
    hoverEl = t
    updateHoverOverlay()
  }, true)

  document.addEventListener('mouseout', (e) => {
    if (!pickerActive) return
    if (e.target === hoverEl) clearHover()
  }, true)

  document.addEventListener('click', (e) => {
    if (suppressNextClickAfterDrag) {
      suppressNextClickAfterDrag = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!pickerActive) return
    if (isInsideInspectorUI(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    if (elementEditMode) {
      activateElementForEdit(e.target)
    } else {
      addPick(e.target, {
        openPopover: false,
        injectRequest: pickerOnce && hostMode !== 'ui',
        insertChip: pickerOnce || hostMode === 'ui',
        showToolbar: true
      })
    }
    if (pickerOnce) setPickerActive(false, false)
  }, true)

  function activateElementForEdit(el) {
    // 切换焦点前丢弃所有未加入对话的临时 pick，避免遗留边框/徽标
    for (const p of picks.filter(p => !p.committed)) removePick(p)
    const existing = picks.find(p => p.el === el)
    if (existing) {
      openStylePopover(existing)
      return existing
    }
    return addPick(el, {
      openPopover: true,
      injectRequest: false,
      insertChip: false,
      showToolbar: false,
      committed: false
    })
  }

  function addPick(el, options) {
    const opt = {
      openPopover: false,
      injectRequest: true,
      insertChip: true,
      showToolbar: true,
      committed: true,
      ...(options || {})
    }
    const existing = picks.find(p => p.el === el)
    if (existing) {
      if (opt.openPopover) openStylePopover(existing)
      else toast('该元素已被拾取', 'info')
      if (opt.insertChip) insertPickToChat(existing)
      if (pickerOnce) setPickerActive(false, false)
      return existing
    }
    const alias = nextAlias()
    if (!alias) {
      toast('已达上限：最多 26 个元素', 'error')
      if (pickerOnce) setPickerActive(false, false)
      return null
    }
    const path = computeCssPath(el)
    if (!path) {
      toast('无法定位该元素（path 为空）', 'error')
      if (pickerOnce) setPickerActive(false, false)
      return null
    }
    el.setAttribute('data-uikit-alias', alias)
    el.classList.add('__uikit_pick_marked__')
    const pick = { alias, path, el, isRoot: picks.length === 0, edits: {}, originalText: el.textContent || '', toolbar: null, selection: null, committed: opt.committed }
    picks.push(pick)
    createSelectionOverlay(pick)
    updateSelectionOverlay(pick)
    if (opt.showToolbar) {
      createToolbar(pick)
      updateToolbarPos(pick)
    }
    if (opt.injectRequest) {
      injectAliasIntoRequest(alias)
      refreshRequestHighlight()
    }
    syncPicksToHost()
    if (opt.insertChip) insertPickToChat(pick)
    if (opt.openPopover) openStylePopover(pick)
    return pick
  }

  // iframe reload 后从 sessionStorage 恢复 picks，避免选中状态被擦掉。
  // 只重建 DOM 标记 + toolbar，不触发 toast / chip 插入 / 诉求文本注入
  // （这些是用户主动拾取时的反馈，恢复时不该重复打扰）。
  // 路径在新 DOM 里找不到（AI 改动了结构）就静默跳过该条。
  function restorePicksFromSession() {
    const saved = readPersistedPicks()
    if (saved.length === 0) return
    let restoredCount = 0
    let skippedCount = 0
    for (const entry of saved) {
      if (!entry || typeof entry.path !== 'string') continue
      let el
      try { el = document.querySelector(entry.path) } catch { el = null }
      if (!el || picks.some(p => p.el === el)) { skippedCount++; continue }
      const alias = entry.alias && /^[A-Z]$/.test(entry.alias) && !picks.some(p => p.alias === entry.alias)
        ? entry.alias
        : nextAlias()
      if (!alias) { skippedCount++; continue }
      el.setAttribute('data-uikit-alias', alias)
      el.classList.add('__uikit_pick_marked__')
      const pick = {
        alias, path: entry.path, el,
        isRoot: picks.length === 0,
        edits: entry.edits && typeof entry.edits === 'object' ? { ...entry.edits } : {},
        toolbar: null,
        selection: null,
        committed: true
      }
      picks.push(pick)
      createSelectionOverlay(pick)
      updateSelectionOverlay(pick)
      createToolbar(pick)
      updateToolbarPos(pick)
      restoredCount++
    }
    if (restoredCount > 0) {
      syncPicksToHost()
      // 用 toast 而不是 toast.error，避免红色焦虑
      const skipMsg = skippedCount > 0 ? `（${skippedCount} 个元素已不存在）` : ''
      toast(`已恢复 ${restoredCount} 个选中${skipMsg}`, 'info')
    }
  }

  // 拾取后把 @A 追加到诉求输入框末尾，便于用户继续描述。
  function injectAliasIntoRequest(alias) {
    const cur = requestEl.textContent || ''
    const needSpace = cur.length > 0 && !/\s$/.test(cur)
    requestEl.textContent = cur + (needSpace ? ' ' : '') + '@' + alias + ' '
    syncRequestToHost()
  }

  function clearTransientEditPicks() {
    for (const pick of [...picks]) {
      if (!pick.committed) removePick(pick)
    }
  }

  function clearPicks() {
    closeStylePopover()
    elementDragInfo = null
    removeAliasesFromRequest(picks.map(p => p.alias))
    for (const p of picks) {
      p.el.classList.remove('__uikit_pick_marked__')
      p.el.removeAttribute('data-uikit-alias')
      destroyToolbar(p)
      destroySelectionOverlay(p)
    }
    picks.length = 0
    refreshRequestHighlight()
    syncPicksToHost()
  }

  function syncPicksFromHostPaths(paths) {
    const alive = new Set(paths.filter(p => typeof p === 'string'))
    const stale = picks.filter(p => !alive.has(p.path))
    if (stale.length === 0) return
    for (const pick of stale) removePick(pick)
  }

  function resetAllEdits() {
    closeStylePopover()
    for (const p of picks) {
      for (const key of Object.keys(p.edits)) {
        if (key.startsWith('style:')) {
          const prop = key.slice('style:'.length)
          p.el.style.removeProperty(prop)
          scheduleWrite(p.path, key, '') // 空值 = unset
        } else if (key.startsWith('attr:')) {
          const name = key.slice('attr:'.length)
          p.el.removeAttribute(name)
          const original = p.originalText !== undefined ? p.originalText : ''
          p.el.textContent = original
          scheduleWrite(p.path, key, original)
        } else if (key === 'text:content') {
          scheduleWrite(p.path, key, '')
        }
      }
      p.edits = {}
      updateSelectionOverlay(p)
      updateToolbarPos(p)
    }
    positionRemarkOverlays()
    toast('已重置全部修改', 'info')
  }

  // 删除元素：confirm 二次确认 → 先 schedule 写回源码 → 再移除 DOM → 从 picks 列表清掉。
  function insertPickToChat(pick) {
    if (!pick) return
    window.parent.postMessage({ type: '__uikit_insert_chip__', alias: pick.alias, path: pick.path }, '*')
    toast(`@${pick.alias} 已加入对话`, 'success')
  }

  function deletePickElement(pick) {
    if (!confirm(`删除 @${pick.alias} 对应的元素？此操作会同步到源码。`)) return
    scheduleWrite(pick.path, 'node:remove', '')
    pick.el.remove()
    removePick(pick)
    toast(`@${pick.alias} 已删除`, 'success')
  }

  function resetPick(pick) {
    const keys = Object.keys(pick.edits)
    if (keys.length === 0) {
      toast(`@${pick.alias} 没有修改可以重置`, 'info')
      return
    }
    for (const key of keys) {
      if (key.startsWith('style:')) {
        const prop = key.slice('style:'.length)
        pick.el.style.removeProperty(prop)
        const original = pick.originalText !== undefined ? pick.originalText : ''
        pick.el.textContent = original
        scheduleWrite(pick.path, key, original)
      } else if (key.startsWith('attr:')) {
        const name = key.slice('attr:'.length)
        pick.el.removeAttribute(name)
        scheduleWrite(pick.path, key, '__remove__')
      } else if (key === 'text:content') {
        scheduleWrite(pick.path, key, '')
      }
    }
    pick.edits = {}
    updateSelectionOverlay(pick)
    updateToolbarPos(pick)
    positionRemarkOverlays()
    syncPicksToHost()
    if (hostMode === 'ui' && hostEditPick === pick) postElementEditSelection(pick)
    toast(`@${pick.alias} 已重置`, 'info')
  }

  function removePick(pick) {
    const idx = picks.indexOf(pick)
    if (idx === -1) return
    if (popoverPick === pick) closeStylePopover()
    if (hostEditPick === pick) postElementEditSelection(null)
    if (elementDragInfo?.pick === pick) elementDragInfo = null
    const removedRoot = pick.isRoot
    removeAliasFromRequest(pick.alias)
    pick.el.classList.remove('__uikit_pick_marked__')
    pick.el.removeAttribute('data-uikit-alias')
    destroyToolbar(pick)
    destroySelectionOverlay(pick)
    picks.splice(idx, 1)
    if (removedRoot && picks[0]) picks[0].isRoot = true
    refreshRequestHighlight()
    syncPicksToHost()
  }

  function removePickByPath(path) {
    const pick = picks.find(p => p.path === path)
    if (pick) removePick(pick)
  }

  function removePickByAlias(alias) {
    const pick = picks.find(p => p.alias === alias)
    if (pick) removePick(pick)
  }

  function removeAliasFromRequest(alias) {
    removeAliasesFromRequest([alias])
  }

  function removeAliasesFromRequest(aliases) {
    if (!aliases.length) return
    const aliasSet = new Set(aliases)
    const text = requestEl.textContent || ''
    const next = text
      .replace(/@([A-Z]+)\b/g, (match, alias) => aliasSet.has(alias) ? '' : match)
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ *\n */g, '\n')
      .trimStart()
    if (next !== text) requestEl.textContent = next
    if (next !== text) syncRequestToHost()
  }

  // ───── 属性面板 ─────
  function remarksUrl() {
    return `${apiBase}/api/preview/remarks?projectId=${encodeURIComponent(ctx.projectId)}&relPath=${encodeURIComponent(ctx.relPath)}`
  }

  function loadRemarks() {
    if (remarksLoaded) return Promise.resolve()
    if (remarksLoadPromise) return remarksLoadPromise
    remarksLoadPromise = fetch(remarksUrl(), { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text().catch(() => '读取失败'))
        return r.json()
      })
      .then((data) => {
        remarksByPath.clear()
        const items = Array.isArray(data?.items) ? data.items : []
        for (const item of items) {
          if (typeof item?.path === 'string' && typeof item?.note === 'string') {
            remarksByPath.set(item.path, item.note)
          }
        }
        remarksLoaded = true
        renderRemarkOverlay()
      })
      .catch((e) => {
        console.warn('[uikit-inspector] load remarks failed:', e)
      })
      .finally(() => {
        remarksLoadPromise = null
      })
    return remarksLoadPromise
  }

  // ───── 备注 overlay：锚点 + 引线 + 卡片 ─────
  const remarkOverlays = []
  let remarksOverlayVisible = false
  let remarkSvg = null

  function ensureRemarkSvg() {
    if (remarkSvg) return remarkSvg
    remarkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    remarkSvg.setAttribute('class', '__uikit_remark_overlay_svg__')
    host.appendChild(remarkSvg)
    return remarkSvg
  }

  function clearRemarkOverlay() {
    for (const o of remarkOverlays) {
      o.card.remove(); o.anchor.remove(); o.line.remove()
    }
    remarkOverlays.length = 0
  }

  function setRemarksOverlayVisible(on) {
    const next = !!on
    if (remarksOverlayVisible === next) return
    remarksOverlayVisible = next
    if (next) {
      void loadRemarks().then(renderRemarkOverlay)
    } else {
      clearRemarkOverlay()
    }
  }

  function renderRemarkOverlay() {
    clearRemarkOverlay()
    if (!remarksOverlayVisible) return
    ensureRemarkSvg()
    let index = 0
    for (const [path, note] of remarksByPath) {
      const trimmed = String(note || '').trim()
      if (!trimmed) continue
      let el = null
      try { el = document.querySelector(path) } catch { el = null }
      if (!el) continue
      index++
      const anchor = document.createElement('div')
      anchor.className = '__uikit_remark_anchor__'
      host.appendChild(anchor)
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      remarkSvg.appendChild(line)
      const card = document.createElement('div')
      card.className = '__uikit_remark_card__'
      const idx = document.createElement('span')
      idx.className = 'uikit-remark-index'
      idx.textContent = String(index)
      const text = document.createElement('span')
      text.textContent = trimmed
      card.appendChild(idx)
      card.appendChild(text)
      host.appendChild(card)
      const overlay = { el, anchor, line, card, userPlaced: false }
      attachRemarkCardDrag(overlay)
      remarkOverlays.push(overlay)
    }
    positionRemarkOverlays()
  }

  // 用户拖动后卡片切换为 userPlaced，自动定位不再覆盖；引线照常跟随锚点。
  function attachRemarkCardDrag(o) {
    o.card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault(); e.stopPropagation()
      const rect = o.card.getBoundingClientRect()
      const dx = e.clientX - rect.left, dy = e.clientY - rect.top
      o.card.classList.add('is-dragging')
      function onMove(ev) {
        const vw = window.innerWidth, vh = window.innerHeight
        const w = o.card.offsetWidth, h = o.card.offsetHeight
        const cx = Math.max(4, Math.min(vw - w - 4, ev.clientX - dx))
        const cy = Math.max(4, Math.min(vh - h - 4, ev.clientY - dy))
        o.card.style.left = cx + 'px'
        o.card.style.top = cy + 'px'
        o.userPlaced = true
        updateRemarkLine(o)
      }
      function onUp() {
        o.card.classList.remove('is-dragging')
        window.removeEventListener('mousemove', onMove, true)
        window.removeEventListener('mouseup', onUp, true)
      }
      window.addEventListener('mousemove', onMove, true)
      window.addEventListener('mouseup', onUp, true)
    })
  }

  function positionRemarkOverlays() {
    if (!remarkSvg) return
    const vw = window.innerWidth, vh = window.innerHeight
    remarkSvg.setAttribute('viewBox', `0 0 ${vw} ${vh}`)
    remarkSvg.setAttribute('width', String(vw))
    remarkSvg.setAttribute('height', String(vh))
    const LEAD = 64
    const CARD_OFFSET_Y = 6
    for (const o of remarkOverlays) {
      if (!o.el.isConnected) { hideRemarkOverlay(o); continue }
      const rect = o.el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) { hideRemarkOverlay(o); continue }
      // 锚点：元素右上角内侧
      const ax = Math.min(rect.right - 4, vw - 6)
      const ay = Math.max(rect.top + 4, 6)
      o.anchorX = ax; o.anchorY = ay
      o.anchor.style.display = ''
      o.anchor.style.left = (ax - 4) + 'px'
      o.anchor.style.top = (ay - 4) + 'px'
      o.card.style.display = ''
      if (!o.userPlaced) {
        // 优先放在元素右侧；右侧不够则放下方
        const cardW = o.card.offsetWidth || 240
        const cardH = o.card.offsetHeight || 48
        let cx, cy
        if (rect.right + LEAD + cardW + 12 <= vw) {
          cx = rect.right + LEAD
          cy = Math.min(Math.max(8, ay - CARD_OFFSET_Y), vh - cardH - 8)
        } else {
          cx = Math.max(8, Math.min(rect.left, vw - cardW - 8))
          cy = Math.min(rect.bottom + LEAD, vh - cardH - 8)
        }
        o.card.style.left = cx + 'px'
        o.card.style.top = cy + 'px'
      }
      updateRemarkLine(o)
    }
  }

  function hideRemarkOverlay(o) {
    o.card.style.display = 'none'
    o.anchor.style.display = 'none'
    o.line.setAttribute('d', '')
  }

  // 从锚点画一条引线到卡片最近边的中点；近距离用直线，远距离加 L 拐点更清晰。
  function updateRemarkLine(o) {
    if (typeof o.anchorX !== 'number') return
    const ax = o.anchorX, ay = o.anchorY
    const r = o.card.getBoundingClientRect()
    // 锚点投影到卡片矩形 → 卡片接入点
    const tx = Math.max(r.left, Math.min(r.right, ax))
    const ty = Math.max(r.top, Math.min(r.bottom, ay))
    const dx = tx - ax, dy = ty - ay
    let d
    if (Math.abs(dx) < 8 || Math.abs(dy) < 8) {
      d = `M ${ax} ${ay} L ${tx} ${ty}`
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      // 先水平后竖直
      const mx = ax + dx * 0.55
      d = `M ${ax} ${ay} L ${mx} ${ay} L ${mx} ${ty} L ${tx} ${ty}`
    } else {
      const my = ay + dy * 0.55
      d = `M ${ax} ${ay} L ${ax} ${my} L ${tx} ${my} L ${tx} ${ty}`
    }
    o.line.setAttribute('d', d)
  }

  function syncOpenRemarkField(pick) {
    if (!popoverPick || popoverPick.path !== pick.path) return
    const input = stylePopoverEl.querySelector('[data-role="remark"]')
    if (!input || input.dataset.dirty === 'true' || input.value) return
    input.value = remarksByPath.get(pick.path) || ''
  }

  function scheduleRemarkSave(pick, note) {
    remarksByPath.set(pick.path, note)
    const previous = pendingRemarkSaves.get(pick.path)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      pendingRemarkSaves.delete(pick.path)
      void saveRemark(pick.path, note)
    }, 400)
    pendingRemarkSaves.set(pick.path, timer)
  }

  async function saveRemark(path, note) {
    try {
      const r = await fetch(`${apiBase}/api/preview/remarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: ctx.projectId,
          relPath: ctx.relPath,
          token: ctx.token,
          path,
          note
        })
      })
      if (!r.ok) throw new Error(await r.text().catch(() => '保存失败'))
      const data = await r.json().catch(() => null)
      const items = Array.isArray(data?.items) ? data.items : []
      remarksByPath.clear()
      for (const item of items) {
        if (typeof item?.path === 'string' && typeof item?.note === 'string') {
          remarksByPath.set(item.path, item.note)
        }
      }
      remarksLoaded = true
      renderRemarkOverlay()
      toast(note.trim() ? '备注已保存' : '备注已清除', 'success')
    } catch (e) {
      toast(`备注保存失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  function buildRemarkPanel(pick) {
    const group = document.createElement('div')
    group.className = 'group'
    const label = document.createElement('div')
    label.className = 'label'
    label.textContent = '备注'
    const input = document.createElement('textarea')
    input.setAttribute('data-role', 'remark')
    input.placeholder = '写给这个元素的备注。发布后会在页面上显示标记。'
    input.value = remarksByPath.get(pick.path) || ''
    input.dataset.dirty = 'false'
    input.addEventListener('input', () => {
      input.dataset.dirty = 'true'
      scheduleRemarkSave(pick, input.value)
    })
    group.appendChild(label)
    group.appendChild(input)
    return group
  }

  // 解析 "12px" / "50%" 等任意长度 → 数值 px 估算。% / em / rem 等读不到原值时退回 0，
  // 用户改动后一律按 px 写回。
  function parseLengthPx(s) {
    const v = String(s == null ? '' : s).trim()
    if (!v || v === 'auto') return 0
    const m = /^(-?\d+(?:\.\d+)?)/.exec(v)
    return m ? parseFloat(m[1]) : 0
  }

  function buildLengthInput(initial, onChange) {
    const wrap = document.createElement('div')
    wrap.className = 'len-input'
    const num = document.createElement('input')
    num.type = 'number'
    num.step = '1'
    num.value = String(parseLengthPx(initial))
    const unit = document.createElement('span')
    unit.className = 'unit'
    unit.textContent = 'px'
    num.addEventListener('input', () => {
      const n = num.value === '' ? 0 : Number(num.value)
      onChange(`${n}px`)
    })
    wrap.appendChild(num)
    wrap.appendChild(unit)
    return wrap
  }

  function buildAttrPanel(pick) {
    const root = document.createElement('div')
    const cs = getComputedStyle(pick.el)

    function field(label, control) {
      const f = document.createElement('div')
      f.className = 'field'
      const l = document.createElement('label')
      l.textContent = label
      f.appendChild(l)
      f.appendChild(control)
      return f
    }

    function writeStyle(prop, v) {
      writeStyleEdit(pick, prop, v)
    }

    function readStyle(prop) {
      const initialEdit = pick.edits[`style:${prop}`]
      return initialEdit !== undefined ? initialEdit : (cs.getPropertyValue(prop) || '').trim()
    }

    function lengthEditor(prop, label) {
      const ctrl = buildLengthInput(readStyle(prop), (v) => writeStyle(prop, v))
      return field(label, ctrl)
    }

    function colorRow() {
      const row = document.createElement('div')
      row.className = 'color-row'
      for (const [prop, label] of [['color', '文字'], ['background-color', '背景']]) {
        const cell = document.createElement('div')
        cell.className = 'color-cell'
        const lab = document.createElement('span')
        lab.textContent = label
        const input = document.createElement('input')
        input.type = 'color'
        input.value = normalizeColor(readStyle(prop)) || '#000000'
        input.addEventListener('input', () => writeStyle(prop, input.value))
        cell.appendChild(lab)
        cell.appendChild(input)
        row.appendChild(cell)
      }
      return field('颜色', row)
    }

    function group(title, fields) {
      const g = document.createElement('div')
      g.className = 'group'
      const l = document.createElement('div')
      l.className = 'label'
      l.textContent = title
      g.appendChild(l)
      for (const f of fields) g.appendChild(f)
      return g
    }

    root.appendChild(group('颜色', [colorRow()]))
    root.appendChild(group('尺寸', [
      lengthEditor('width', '宽度'),
      lengthEditor('height', '高度'),
      lengthEditor('border-radius', '圆角')
    ]))

    return root
  }

  // 把 rgb(255, 0, 0) → #ff0000，方便 color picker 显示。失败原样返回。
  function normalizeColor(s) {
    if (!s) return ''
    if (s.startsWith('#')) return s
    const m = s.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/)
    if (!m) return ''
    const toHex = (n) => parseInt(n, 10).toString(16).padStart(2, '0')
    return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`
  }

  // ───── 诉求输入框：@ 高亮 ─────
  // contenteditable 染色：每次 input 后，从 textContent 重新解析 + 拼回 HTML。光标位置以字符 offset 重建。
  // IME 组合期间（中文/日文输入候选词阶段）跳过重写，避免打断输入；compositionend 后再统一刷一次。
  let highlightingScheduled = false
  let composing = false
  requestEl.addEventListener('compositionstart', () => { composing = true })
  requestEl.addEventListener('compositionend', () => {
    composing = false
    refreshRequestHighlight()
    syncRequestToHost()
  })
  requestEl.addEventListener('input', () => {
    if (composing) return
    if (highlightingScheduled) return
    highlightingScheduled = true
    queueMicrotask(() => {
      highlightingScheduled = false
      refreshRequestHighlight()
      syncRequestToHost()
    })
  })
  requestEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-alias-remove]')
    if (!btn) return
    e.preventDefault()
    e.stopPropagation()
    const alias = btn.getAttribute('data-alias-remove')
    if (alias) removePickByAlias(alias)
  })

  function refreshRequestHighlight() {
    const text = requestEl.textContent
    const aliases = new Set(picks.map(p => p.alias))
    if (aliases.size === 0) {
      // 没有被选中的别名，纯文本展示即可（清掉之前的 span）
      if (requestEl.innerHTML !== escapeHtml(text)) {
        const offset = saveCaretOffset(requestEl)
        requestEl.innerHTML = escapeHtml(text)
        restoreCaretOffset(requestEl, offset)
      }
      return
    }
    const offset = saveCaretOffset(requestEl)
    const segments = []
    const re = /@([A-Z]+)\b/g
    let lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(lastIndex, m.index)
      if (before) segments.push({ kind: 'text', value: before })
      const alias = m[1]
      if (aliases.has(alias)) {
        segments.push({ kind: 'alias', value: '@' + alias })
      } else {
        segments.push({ kind: 'text', value: '@' + alias })
      }
      lastIndex = m.index + m[0].length
    }
    if (lastIndex < text.length) segments.push({ kind: 'text', value: text.slice(lastIndex) })
    const html = segments.map(s => s.kind === 'alias'
      ? `<span class="aliasref" contenteditable="false" data-alias="${escapeHtml(s.value.slice(1))}"><span>${escapeHtml(s.value)}</span><button type="button" class="aliasref__remove" data-alias-remove="${escapeHtml(s.value.slice(1))}" aria-label="删除 ${escapeHtml(s.value)}"></button></span>`
      : escapeHtml(s.value)
    ).join('')
    if (requestEl.innerHTML !== html) {
      requestEl.innerHTML = html || ''
      restoreCaretOffset(requestEl, offset)
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '<br>')
  }

  // 用线性字符 offset 在 contenteditable 中保存/恢复光标
  function saveCaretOffset(root) {
    const sel = window.getSelection()
    if (!sel.rangeCount) return 0
    const range = sel.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(root)
    pre.setEnd(range.endContainer, range.endOffset)
    return pre.toString().length
  }
  function restoreCaretOffset(root, offset) {
    const sel = window.getSelection()
    const range = document.createRange()
    let remaining = offset
    let node = null
    let nodeOffset = 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    while ((node = walker.nextNode())) {
      const len = node.textContent.length
      if (remaining <= len) {
        nodeOffset = remaining
        break
      }
      remaining -= len
    }
    if (!node) {
      range.selectNodeContents(root)
      range.collapse(false)
    } else {
      range.setStart(node, nodeOffset)
      range.collapse(true)
    }
    sel.removeAllRanges()
    sel.addRange(range)
  }

  // ───── 启动时恢复上次 picks（iframe reload 后保留选中状态）─────
  // DOM 结构可能因 AI 改动变化，querySelector 找不到就静默跳过对应条目。
  // 用 rAF 让样式和 toolbar host 都就位再尝试。
  requestAnimationFrame(() => {
    try { restorePicksFromSession() } catch (e) { console.warn('[uikit-inspector] restore picks failed:', e) }
  })
})()
