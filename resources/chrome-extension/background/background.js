// Background service worker —— 暂存最近一次剪裁结果，等 popup 打开时取走
let pendingCapture = null

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'capture-result') {
    pendingCapture = msg.data
    chrome.action.setBadgeText({ text: '1' })
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' })
  }

  if (msg.type === 'get-pending-capture') {
    sendResponse(pendingCapture)
    pendingCapture = null
    chrome.action.setBadgeText({ text: '' })
  }

  if (msg.type === 'clear-pending-capture') {
    pendingCapture = null
    chrome.action.setBadgeText({ text: '' })
  }
})
