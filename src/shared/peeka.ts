export type PeekaProtocol = 'chat-completions' | 'messages' | 'responses'
export type PeekaConnection = {
  baseUrl: string
  protocol: PeekaProtocol
  model: string
  visionModel: string
}

export const PEEKA_PRESETS = {
  official: { baseUrl: 'https://api.deepseek.com', protocol: 'chat-completions', model: 'deepseek-flash', visionModel: 'deepseek-flash' },
  llm: { baseUrl: 'http://llm-proxy.example.com', protocol: 'messages', model: 'deepseek-v4-flash', visionModel: 'claude-opus-4-8' }
} satisfies Record<string, PeekaConnection>

// 官方 V4.1 Flash 同时支持文本和图片；内网代理的模型 ID 由网关独立维护。
// https://api-docs.deepseek.com/quick_start/pricing
export const PEEKA_OFFICIAL_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const
export const PEEKA_OFFICIAL_VISION_MODELS = ['deepseek-flash'] as const

// 代理网关（LLM 代理）实测支持的对话模型（2026-09）。仅作输入建议（datalist），
// 不做白名单校验——网关模型列表会演进，自由输入始终保留。
// text-embedding-3-small/large 为 embedding 模型，不用于对话，未列出。
export const PEEKA_LLM_PROXY_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'gpt-6-astra',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.5',
  'gpt-5.4-pro',
  'gpt-5.4',
  'gpt-5.4-mini',
  'kimi-k3',
  'glm-5.2'
] as const

// 视觉模型建议：网关清单中确认支持视觉的家族（claude 系）
export const PEEKA_LLM_PROXY_VISION_MODELS = PEEKA_LLM_PROXY_MODELS.filter((model) => model.startsWith('claude-'))

export function validatePeekaConnection(value: unknown): PeekaConnection {
  if (!value || typeof value !== 'object') throw new Error('Peeka 配置无效')
  const c = value as PeekaConnection
  if (!['chat-completions', 'messages', 'responses'].includes(c.protocol)) throw new Error('API 格式无效')
  let url: URL
  try { url = new URL(c.baseUrl) } catch { throw new Error('请输入有效的 API Base URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('API Base URL 必须为 HTTP(S) 地址，不能包含凭证、查询参数或片段')
  }
  if (typeof c.model !== 'string' || !c.model.trim() || c.model.length > 200) throw new Error('请输入模型名称（最多 200 字符）')
  if (typeof c.visionModel !== 'string' || c.visionModel.length > 200) throw new Error('视觉模型名称无效')
  return { baseUrl: url.toString().replace(/\/+$/, ''), protocol: c.protocol, model: c.model.trim(), visionModel: c.visionModel.trim() }
}

export function peekaEndpoint(c: PeekaConnection): string {
  const base = c.baseUrl.replace(/\/+$/, '')
  const suffix = c.protocol === 'messages' ? '/v1/messages' : c.protocol === 'responses' ? '/responses' : '/chat/completions'
  if (base.endsWith(suffix)) return base
  if (c.protocol === 'messages' && base.endsWith('/v1')) return `${base}/messages`
  return `${base}${suffix}`
}
