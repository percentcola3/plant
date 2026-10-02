import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' })
// Install librsvg and ImageMagick before running; iconutil ships with macOS.
run('rsvg-convert', ['--version'])
run('magick', ['-version'])
const source = readFileSync(join(root, 'resources/brand/plant-mark.svg'), 'utf8')
const write = (path, content) => {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}
const background = (rect) => source
  .replace('on a transparent background', 'on white')
  .replace('  <path', `  ${rect}\n  <path`)
const appIcon = background('<rect x="88" y="88" width="1078" height="1078" rx="240" fill="#FFFFFF"/>')
const uiIcon = background('<rect width="1254" height="1254" fill="#FFFFFF"/>')
write('build/icon-source.svg', appIcon)
write('src/renderer/src/assets/brand/plant-icon.svg', uiIcon)
write('src/renderer/public/favicon.svg', appIcon)

const temp = mkdtempSync(join(tmpdir(), 'plant-brand-'))
try {
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
  const png = (size) => join(temp, `${size}.png`)
  for (const size of sizes) {
    run('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', png(size), join(root, 'build/icon-source.svg')])
  }
  copyFileSync(png(1024), join(root, 'build/icon.png'))
  const iconset = join(root, 'build/icon.iconset')
  mkdirSync(iconset, { recursive: true })
  for (const size of [16, 32, 128, 256, 512]) {
    copyFileSync(png(size), join(iconset, `icon_${size}x${size}.png`))
    copyFileSync(png(size * 2), join(iconset, `icon_${size}x${size}@2x.png`))
  }
  copyFileSync(png(64), join(iconset, 'icon_64x64.png'))
  run('magick', [...sizes.filter((size) => size <= 256).map(png), join(root, 'build/icon.ico')])
  if (process.platform === 'darwin') {
    run('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')])
  } else {
    console.warn('Run on macOS to regenerate build/icon.icns before packaging the Mac app.')
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
console.log('Plant brand icons generated from resources/brand/plant-mark.svg')
