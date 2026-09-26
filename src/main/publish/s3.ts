import { extname } from 'node:path'

// S3 发布通过环境变量注入目标集群与凭证（UI_CLIENT_S3_*），未配置时不提供默认值。
// 上传实现按需动态加载可选 SDK，未安装时给出明确报错，其余功能不受影响。
const GIFT_MODULE = '@didi/didi-node-gift'

export interface S3Bucket {
  putObject(key: string, source: string | Buffer, options?: { headers?: Record<string, string> }): Promise<unknown>
  putObjectACL(key: string, acl: string): Promise<unknown>
  getObjectUrl(key: string): string
}

export const PUBLISH_CONFIG = {
  accessKey: process.env.UI_CLIENT_S3_ACCESS_KEY || '',
  secretKey: process.env.UI_CLIENT_S3_SECRET_KEY || '',
  region: process.env.UI_CLIENT_S3_REGION || '',
  tenant: process.env.UI_CLIENT_S3_TENANT || '',
  bucket: process.env.UI_CLIENT_S3_BUCKET || '',
  clusterBaseUrl: process.env.UI_CLIENT_S3_CLUSTER_BASE_URL || '',
  cdnBaseUrl: process.env.UI_CLIENT_S3_CDN_BASE_URL || '',
  timeout: 30000
} as const

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mdx': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8'
}

export function contentTypeFor(absPath: string): string {
  const ext = extname(absPath).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function describeRequestError(e: unknown): string {
  if (!isPlainObject(e)) return String(e)
  const response = isPlainObject(e.response) ? e.response : null
  const status = response && typeof response.status === 'number' ? response.status : null
  const data = response ? response.data : null
  let dataText = ''
  if (typeof data === 'string') dataText = data.slice(0, 300)
  else if (data) {
    try {
      dataText = JSON.stringify(data).slice(0, 300)
    } catch {
      dataText = String(data)
    }
  }
  const msg = typeof e.message === 'string' ? e.message : 'request error'
  if (status) return `HTTP ${status} · ${msg}${dataText ? ` · ${dataText}` : ''}`
  const code = typeof e.code === 'string' ? e.code : null
  return code ? `${code} · ${msg}` : msg
}

export function buildTimestamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function projectSlug(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

export function publishSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact'
}

export async function createBucket(): Promise<S3Bucket> {
  if (!PUBLISH_CONFIG.accessKey || !PUBLISH_CONFIG.bucket) {
    throw new Error('S3 发布未配置：请通过环境变量提供 UI_CLIENT_S3_* 配置')
  }
  let Bucket: new (options: Record<string, unknown>) => S3Bucket
  try {
    Bucket = (await import(/* @vite-ignore */ GIFT_MODULE)).BucketV3
  } catch {
    throw new Error('S3 发布需要可选 SDK 依赖，当前环境未安装')
  }
  return new Bucket({
    name: PUBLISH_CONFIG.bucket,
    accessKey: PUBLISH_CONFIG.accessKey,
    secretKey: PUBLISH_CONFIG.secretKey,
    region: PUBLISH_CONFIG.region,
    timeout: PUBLISH_CONFIG.timeout,
    clusterConfig: {
      service: 's3',
      baseUrl: PUBLISH_CONFIG.clusterBaseUrl,
      cdnBaseUrl: PUBLISH_CONFIG.cdnBaseUrl
    }
  })
}

export async function uploadToS3(
  bucket: S3Bucket,
  key: string,
  source: string | Buffer,
  contentType: string
): Promise<string> {
  let res: unknown
  try {
    res = await bucket.putObject(key, source, { headers: { 'content-type': contentType } })
  } catch (e) {
    throw new Error(`putObject 失败 (${key})：${describeRequestError(e)}`)
  }
  try {
    await bucket.putObjectACL(key, 'public-read')
  } catch (e) {
    throw new Error(`putObjectACL 失败 (${key})：${describeRequestError(e)}`)
  }
  const resUrl = isPlainObject(res) && typeof res.url === 'string' ? res.url : ''
  return resUrl || bucket.getObjectUrl(key)
}
