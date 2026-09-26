#!/usr/bin/env node
// 把 dugite 需要的便携 git 从 GitHub 下载下来。
// 走通 dugite 自带 postinstall 在中国大陆经常被网络挡，本脚本支持多镜像 + 手动指定本地缓存。
//
// 用法：
//   node scripts/setup-bundled-git.mjs                  # 自动尝试镜像 + 直连
//   DUGITE_CACHE_DIR=/path node scripts/setup-bundled-git.mjs   # 用预置缓存（已 curl 好）
//   node scripts/setup-bundled-git.mjs --mirror https://...     # 自定义镜像
//
// 脚本只负责把 tarball 落到 dugite 的 cache 目录里，然后触发 dugite 自己的解压脚本。

import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const require = createRequire(import.meta.url)
const config = require('../node_modules/dugite/script/config.js')()

if (!config.source) {
  console.error(`当前平台 ${process.platform}-${process.arch} 不在 dugite 支持列表`)
  process.exit(1)
}

const cacheDir = process.env.DUGITE_CACHE_DIR
  ? resolve(process.env.DUGITE_CACHE_DIR)
  : tmpdir()
mkdirSync(cacheDir, { recursive: true })
const cachePath = join(cacheDir, config.fileName)

const mirrors = parseMirrors(config.source)
console.log(`目标文件：${config.fileName}`)
console.log(`缓存路径：${cachePath}`)

if (existsSync(cachePath)) {
  console.log('已发现本地缓存，跳过下载。')
} else {
  let downloaded = false
  for (const url of mirrors) {
    console.log(`\n尝试镜像：${url}`)
    try {
      await downloadTo(url, cachePath)
      downloaded = true
      break
    } catch (e) {
      console.warn(`  失败：${e.message}`)
    }
  }
  if (!downloaded) {
    console.error('\n所有镜像都失败。可手动下载后放到上述缓存路径再重跑本脚本：')
    console.error(`  ${config.source}`)
    process.exit(1)
  }
}

console.log('\n触发 dugite 解压…')
const result = spawnSync('node', ['./node_modules/dugite/script/download-git.js'], {
  stdio: 'inherit',
  env: { ...process.env, DUGITE_CACHE_DIR: cacheDir }
})
process.exit(result.status ?? 1)

function parseMirrors(originalUrl) {
  const cliMirror = process.argv.find((a) => a.startsWith('--mirror='))?.replace('--mirror=', '')
  const explicit = cliMirror ? [cliMirror.replace(/\/$/, '') + originalUrl.replace('https://github.com', '')] : []
  return [
    ...explicit,
    // 已验证可用：2026-06 时 gh-proxy.com 在中国大陆稳定
    `https://gh-proxy.com/${originalUrl}`,
    // 备选（不稳定，但偶尔 gh-proxy 也挂）
    `https://ghproxy.com/${originalUrl}`,
    `https://mirror.ghproxy.com/${originalUrl}`,
    `https://gh.api.99988866.xyz/${originalUrl}`,
    // 直连兜底
    originalUrl
  ]
}

async function downloadTo(url, destPath) {
  const ac = new AbortController()
  // 60M 的 tarball 在国内镜像走完常需 2 分钟，给够 5 分钟 buffer
  const timeout = setTimeout(() => ac.abort(), 5 * 60_000)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'ui-client-setup' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (!res.body) throw new Error('empty body')
    await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath))
  } finally {
    clearTimeout(timeout)
  }
}
