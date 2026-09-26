;(function () {
  if (window.__captureActive) return
  window.__captureActive = true

  let highlightedEl = null
  let highlightBox = null
  let tooltip = null
  let locked = false

  const HIGHLIGHT_STYLE = 'border: 2px solid #1976D2; background: rgba(25,118,210,0.06);'

  function createHighlight() {
    highlightBox = document.createElement('div')
    highlightBox.id = '__capture-highlight'
    highlightBox.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483645;' +
      'border:2px solid #1976D2;background:rgba(25,118,210,0.06);' +
      'border-radius:3px;transition:all 0.08s ease;display:none;'

    tooltip = document.createElement('div')
    tooltip.id = '__capture-tooltip'
    tooltip.style.cssText =
      'position:fixed;z-index:2147483646;pointer-events:none;' +
      'background:rgba(0,0,0,0.75);color:#fff;font-size:12px;' +
      'padding:4px 8px;border-radius:4px;font-family:system-ui,sans-serif;' +
      'white-space:nowrap;display:none;'

    document.body.appendChild(highlightBox)
    document.body.appendChild(tooltip)
  }

  function updateHighlight(el) {
    if (!el || !highlightBox) return
    const rect = el.getBoundingClientRect()
    highlightBox.style.display = 'block'
    highlightBox.style.left = rect.left + 'px'
    highlightBox.style.top = rect.top + 'px'
    highlightBox.style.width = rect.width + 'px'
    highlightBox.style.height = rect.height + 'px'

    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      : ''
    tooltip.textContent = `<${tag}${id}${cls}>  ${Math.round(rect.width)}x${Math.round(rect.height)}`
    tooltip.style.display = 'block'
    tooltip.style.left = rect.left + 'px'
    tooltip.style.top = Math.max(rect.top - 28, 2) + 'px'
  }

  function hideHighlight() {
    if (highlightBox) highlightBox.style.display = 'none'
    if (tooltip) tooltip.style.display = 'none'
  }

  function onMouseMove(e) {
    if (locked) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el === highlightedEl) return
    if (el.id === '__capture-highlight' || el.id === '__capture-tooltip') return
    highlightedEl = el
    updateHighlight(el)
  }

  function findCaptureTarget(el) {
    let target = el
    const maxWalk = 5
    for (let i = 0; i < maxWalk; i++) {
      if (!target.parentElement) break
      const tag = target.tagName
      const rect = target.getBoundingClientRect()
      const parentRect = target.parentElement.getBoundingClientRect()

      if (['ARTICLE', 'MAIN', 'SECTION', 'ASIDE'].includes(tag)) break

      const isBlock = getComputedStyle(target).display === 'block'
      if (isBlock && rect.width > 200 && rect.height > 100) break

      if (parentRect.width > rect.width * 1.5 || parentRect.height > rect.height * 2) break

      target = target.parentElement
    }
    return target
  }

  // --- Media detection: video, audio, subtitles, embeds ---

  function collectMedia(container) {
    const videoUrls = []
    const audioUrls = []
    const subtitleTracks = []
    const embedUrls = []

    // Video elements
    container.querySelectorAll('video').forEach((video) => {
      const src = video.src || video.getAttribute('src')
      if (src) {
        try { videoUrls.push({ src: new URL(src, window.location.href).href, type: video.type || '' }) } catch {}
      }
      // Collect <source> children
      video.querySelectorAll('source').forEach((source) => {
        const s = source.src || source.getAttribute('src')
        if (s) {
          try { videoUrls.push({ src: new URL(s, window.location.href).href, type: source.type || '' }) } catch {}
        }
      })
      // Extract text tracks (subtitles)
      extractTextTracks(video, subtitleTracks)
    })

    // Audio elements
    container.querySelectorAll('audio').forEach((audio) => {
      const src = audio.src || audio.getAttribute('src')
      if (src) {
        try { audioUrls.push({ src: new URL(src, window.location.href).href, type: audio.type || '' }) } catch {}
      }
      audio.querySelectorAll('source').forEach((source) => {
        const s = source.src || source.getAttribute('src')
        if (s) {
          try { audioUrls.push({ src: new URL(s, window.location.href).href, type: source.type || '' }) } catch {}
        }
      })
      extractTextTracks(audio, subtitleTracks)
    })

    // Embedded iframes (YouTube, Bilibili, Vimeo)
    container.querySelectorAll('iframe').forEach((iframe) => {
      const src = iframe.src || iframe.getAttribute('src') || ''
      let platform = null
      if (/youtube\.com\/embed|youtu\.be\/embed/i.test(src)) platform = 'youtube'
      else if (/player\.bilibili\.com|bilibili\.com\/player/i.test(src)) platform = 'bilibili'
      else if (/player\.vimeo\.com|vimeo\.com\/embed/i.test(src)) platform = 'vimeo'

      if (platform) {
        embedUrls.push({ platform, src })
      }
    })

    return { videoUrls, audioUrls, subtitleTracks, embedUrls }
  }

  function extractTextTracks(mediaEl, tracks) {
    // Method 1: HTML5 TextTrack API
    if (mediaEl.textTracks && mediaEl.textTracks.length > 0) {
      for (let i = 0; i < mediaEl.textTracks.length; i++) {
        const track = mediaEl.textTracks[i]
        // Must switch mode to access cues
        const prevMode = track.mode
        track.mode = 'hidden'
        const cues = []
        if (track.cues) {
          for (let j = 0; j < track.cues.length; j++) {
            cues.push(track.cues[j].text)
          }
        }
        if (cues.length > 0) {
          tracks.push({
            label: track.label || track.language || `Track ${i + 1}`,
            srclang: track.language || '',
            text: cues.join('\n'),
          })
        }
        track.mode = prevMode
      }
    }

    // Method 2: <track> elements with src attribute (URL-based, needs server fetch)
    mediaEl.querySelectorAll('track').forEach((trackEl) => {
      const src = trackEl.src || trackEl.getAttribute('src')
      if (src && trackEl.kind !== 'chapters') {
        // Store URL for server-side fetching
        tracks.push({
          label: trackEl.label || trackEl.srclang || 'Subtitle',
          srclang: trackEl.srclang || '',
          text: '',
          trackUrl: src,
        })
      }
    })
  }

  // --- SPA lazy-load detection and expansion ---

  function detectLazyContent(container) {
    // Check for unloaded images
    const lazyImages = container.querySelectorAll('img[data-src], img[data-lazy-src], img.loading--lazy, img[loading="lazy"]')
    let hasLazy = lazyImages.length > 0

    // Check for skeleton/placeholder elements
    const skeletons = container.querySelectorAll('[class*="skeleton"], [class*="placeholder"], [class*="loading"]')
    if (skeletons.length > 0) hasLazy = true

    // Check for "load more" buttons
    const expandBtns = findExpandButtons(container)
    if (expandBtns.length > 0) hasLazy = true

    // Check for fixed-height scrollable containers (virtual scroll)
    const scrollContainers = Array.from(container.querySelectorAll('*')).filter((el) => {
      const style = getComputedStyle(el)
      return (style.overflowY === 'auto' || style.overflowY === 'scroll')
        && parseInt(style.maxHeight) > 0 && parseInt(style.maxHeight) < 600
    })
    if (scrollContainers.length > 0) hasLazy = true

    return hasLazy
  }

  function findExpandButtons(container) {
    const btns = []
    const candidates = container.querySelectorAll('button, a, span')
    const pattern = /load more|show more|展开|加载更多|查看全部|show all|read more|查看更多/i
    candidates.forEach((btn) => {
      if (pattern.test(btn.innerText) || pattern.test(btn.textContent)) {
        btns.push(btn)
      }
    })
    return btns
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function cleanCaptureName(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  }

  function firstTextLine(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map((line) => cleanCaptureName(line))
      .find(Boolean) || ''
  }

  function inferCaptureName(container) {
    const pageTitle = cleanCaptureName(document.title)
    if (pageTitle) return pageTitle

    const header = container.querySelector('h1, h2, h3') || container.querySelector('header')
    const headerText = firstTextLine(header?.innerText || header?.textContent)
    if (headerText) return headerText

    return firstTextLine(container.innerText || container.textContent) || '未命名剪页'
  }

  async function expandLazyContent(container) {
    // 1. Click "load more" buttons (max 10 times)
    const expandBtns = findExpandButtons(container)
    let clickCount = 0
    for (const btn of expandBtns) {
      if (clickCount >= 10) break
      try {
        btn.click()
        clickCount++
        await sleep(800)
      } catch {}
    }

    // 2. Trigger lazy image loading
    container.querySelectorAll('img[data-src], img[data-lazy-src]').forEach((img) => {
      const lazySrc = img.dataset.src || img.dataset.lazySrc
      if (lazySrc && !img.src.includes(lazySrc)) {
        img.src = lazySrc
      }
    })
    await sleep(500)

    // 3. Scroll inside scrollable containers to trigger virtual scroll
    const scrollContainers = Array.from(container.querySelectorAll('*')).filter((el) => {
      const style = getComputedStyle(el)
      return (style.overflowY === 'auto' || style.overflowY === 'scroll')
        && el.scrollHeight > el.clientHeight + 100
    })
    for (const sc of scrollContainers) {
      sc.scrollTop = sc.scrollHeight
      await sleep(500)
      sc.scrollTop = sc.scrollHeight
      await sleep(500)
    }
  }

  // --- Lazy-load prompt UI ---

  function showLazyPrompt(container) {
    return new Promise((resolve) => {
      const rect = container.getBoundingClientRect()
      const prompt = document.createElement('div')
      prompt.id = '__capture-lazy-prompt'
      prompt.style.cssText =
        `position:fixed;z-index:2147483647;top:${Math.max(rect.top - 44, 4)}px;` +
        `left:${rect.left}px;width:${rect.width}px;` +
        'background:#FFF3E0;border:1px solid #FF9800;border-radius:6px;' +
        'padding:8px 12px;font-size:13px;font-family:system-ui,sans-serif;' +
        'display:flex;align-items:center;justify-content:space-between;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,0.15);'

      const text = document.createElement('span')
      text.textContent = '检测到未完全加载的内容'
      text.style.color = '#E65100'

      const btnLoad = document.createElement('button')
      btnLoad.textContent = '加载完整内容'
      btnLoad.style.cssText =
        'padding:4px 12px;border:1px solid #FF9800;border-radius:4px;' +
        'background:#FF9800;color:white;cursor:pointer;font-size:12px;'

      const btnSkip = document.createElement('button')
      btnSkip.textContent = '跳过'
      btnSkip.style.cssText =
        'padding:4px 12px;border:1px solid #ddd;border-radius:4px;' +
        'background:white;color:#666;cursor:pointer;font-size:12px;'

      prompt.appendChild(text)
      prompt.appendChild(btnLoad)
      prompt.appendChild(btnSkip)
      document.body.appendChild(prompt)

      btnLoad.addEventListener('click', async () => {
        btnLoad.textContent = '加载中...'
        btnLoad.disabled = true
        await expandLazyContent(container)
        prompt.remove()
        resolve(true)
      })

      btnSkip.addEventListener('click', () => {
        prompt.remove()
        resolve(false)
      })
    })
  }

  // --- Main click handler ---

  function onClick(e) {
    if (locked) return
    e.preventDefault()
    e.stopPropagation()

    locked = true
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el.id === '__capture-highlight' || el.id === '__capture-tooltip') {
      locked = false
      return
    }

    const container = findCaptureTarget(el)

    // Flash green to confirm selection
    if (highlightBox) {
      highlightBox.style.border = '2px solid #4CAF50'
      highlightBox.style.background = 'rgba(76,175,80,0.1)'
    }

    setTimeout(async () => {
      // Check for lazy content and prompt user
      const hasLazy = detectLazyContent(container)
      if (hasLazy) {
        await showLazyPrompt(container)
        // Re-read container content after expansion
        await sleep(300)
      }

      const html = container.innerHTML
      const content = container.innerText
      const fileName = inferCaptureName(container)

      // Collect image URLs
      const images = container.querySelectorAll('img')
      const imageUrls = []
      images.forEach((img) => {
        const src = img.src || img.getAttribute('data-src')
        if (src) {
          try {
            imageUrls.push(new URL(src, window.location.href).href)
          } catch {}
        }
      })

      // Collect background images
      container.querySelectorAll('[style]').forEach((el) => {
        const style = el.getAttribute('style') || ''
        const match = style.match(/url\(['"]?([^'")]+)['"]?\)/)
        if (match) {
          try {
            imageUrls.push(new URL(match[1], window.location.href).href)
          } catch {}
        }
      })

      // Collect media (video, audio, subtitles, embeds)
      const media = collectMedia(container)

      cleanup()

      chrome.runtime.sendMessage({
        type: 'capture-result',
        data: {
          title: fileName,
          fileName,
          url: window.location.href,
          html,
          content,
          imageUrls: [...new Set(imageUrls)],
          capturedAt: new Date().toISOString(),
          videoUrls: media.videoUrls,
          audioUrls: media.audioUrls,
          subtitleTracks: media.subtitleTracks,
          embedUrls: media.embedUrls,
        },
      })
    }, 300)
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') cleanup()
    if (e.key === 'ArrowUp' && highlightedEl && highlightedEl.parentElement) {
      e.preventDefault()
      highlightedEl = highlightedEl.parentElement
      updateHighlight(highlightedEl)
    }
    if (e.key === 'ArrowDown' && highlightedEl && highlightedEl.children.length > 0) {
      e.preventDefault()
      highlightedEl = highlightedEl.children[0]
      updateHighlight(highlightedEl)
    }
  }

  function onScroll() {
    if (highlightedEl) updateHighlight(highlightedEl)
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('scroll', onScroll, true)
    if (highlightBox) { highlightBox.remove(); highlightBox = null }
    if (tooltip) { tooltip.remove(); tooltip = null }
    // Remove lazy prompt if present
    const lazyPrompt = document.getElementById('__capture-lazy-prompt')
    if (lazyPrompt) lazyPrompt.remove()
    highlightedEl = null
    locked = false
    window.__captureActive = false
  }

  function start() {
    createHighlight()
    document.addEventListener('mousemove', onMouseMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScroll, true)
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'start-selection') start()
    if (msg.type === 'cancel-selection') cleanup()
  })
})()
