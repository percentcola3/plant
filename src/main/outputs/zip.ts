import { promises as fs } from 'node:fs'
import { relative } from 'node:path'
import JSZip from 'jszip'

// 打包 UI 产物为 zip Buffer。zip 内的相对路径以 rootDir 为基准（用 / 分隔，跨平台一致）。
// level 6 是 jszip 默认，体积/速度权衡合适；产物一般 < 10MB，全程内存里打包够用。

export async function buildZipBuffer(opts: {
  rootDir: string
  files: string[]
}): Promise<Buffer> {
  const zip = new JSZip()
  for (const abs of opts.files) {
    const rel = relative(opts.rootDir, abs).split(/\\|\//).join('/')
    if (!rel) continue
    const data = await fs.readFile(abs)
    zip.file(rel, data)
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
}
