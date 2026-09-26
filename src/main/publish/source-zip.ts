// 共享：把整个产物/feature 目录打包成 source.zip 并上传到同一 prefix 下。
// 抽自 outputs/publish.ts 的内联逻辑，让 PM features/publish.ts 也能复用。
//
// 设计：zip 早于其它文件上传，让上传完后 zipUrl 已就绪，可立即写进 SPA index 的下载按钮。
import { describeRequestError, isPlainObject, type S3Bucket } from './s3'
import { UIClientError } from '../ipc/errors'
import { buildZipBuffer } from '../outputs/zip'

export type SourceZipResult = {
  zipKey: string
  zipUrl: string
}

export async function uploadSourceZip(input: {
  bucket: S3Bucket
  prefix: string
  rootDir: string
  files: string[]
}): Promise<SourceZipResult> {
  let zipBuffer: Buffer
  try {
    zipBuffer = await buildZipBuffer({ rootDir: input.rootDir, files: input.files })
  } catch (e) {
    throw new UIClientError('ZIP_FAILED', `打包 source.zip 失败：${e instanceof Error ? e.message : String(e)}`)
  }

  const zipKey = `${input.prefix}/source.zip`
  let zipRes: unknown
  try {
    zipRes = await input.bucket.putObject(zipKey, zipBuffer, {
      headers: { 'content-type': 'application/zip' }
    })
  } catch (e) {
    throw new UIClientError('UPLOAD_FAILED', `上传 source.zip 失败：${describeRequestError(e)}`)
  }
  try {
    await input.bucket.putObjectACL(zipKey, 'public-read')
  } catch (e) {
    throw new UIClientError('ACL_FAILED', `设置 source.zip 的访问权限失败：${describeRequestError(e)}`)
  }

  const zipUrl = (isPlainObject(zipRes) && typeof zipRes.url === 'string' && zipRes.url)
    ? zipRes.url
    : input.bucket.getObjectUrl(zipKey)
  return { zipKey, zipUrl }
}
