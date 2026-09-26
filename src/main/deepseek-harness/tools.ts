import { promises as fs, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { HarnessContext } from './context'
import { zgQuery, type ZgHit } from '../zg/zg-search'
import { ZG_MCP_SEARCH_TOOL } from '../zg/zg-mcp'

const MAX_READ_BYTES = 256 * 1024
const MAX_WRITE_BYTES = 2 * 1024 * 1024
const MAX_LISTED_FILES = 2_000
const MAX_GREP_RESULTS = 200
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'coverage', '.zvec-grep'])

export type DeepSeekToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type HarnessToolbox = {
  definitions: DeepSeekToolDefinition[]
  execute(name: string, rawInput: unknown): Promise<{ content: string; isError: boolean }>
}

export function createHarnessToolbox(input: {
  projectPath: string
  workDir: string
  context: HarnessContext
}): HarnessToolbox {
  const scope = new FileScope(input.projectPath, input.workDir, input.context.readRoots, input.context.writeRoots)

  return {
    definitions: buildToolDefinitions(input.projectPath, input.workDir),
    async execute(name, rawInput) {
      try {
        const data = objectInput(rawInput)
        if (name === 'Read') return ok(await readFile(scope, data))
        if (name === 'Write') return ok(await writeFile(scope, data))
        if (name === 'Edit') return ok(await editFile(scope, data))
        if (name === 'Glob') return ok(await globFiles(scope, data))
        if (name === 'Grep') return ok(await grepFiles(scope, data))
        if (isZgSearchTool(name)) return ok(await zgSearch(scope, data))
        if (name === 'Skill') return ok(await readSkill(input.context, data))
        throw new Error(`未知工具：${name}`)
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true }
      }
    }
  }
}

function isZgSearchTool(name: string): boolean {
  return name === ZG_MCP_SEARCH_TOOL || name === 'zvec_grep_search' || name === 'zg_search'
}

function buildToolDefinitions(projectPath: string, workDir: string): DeepSeekToolDefinition[] {
  const mounts = knowledgeMountHint(projectPath, workDir)
  return [
  functionTool('Read', 'Read a UTF-8 text file inside the readable roots.', {
    file_path: { type: 'string' },
    offset: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 4000 }
  }, ['file_path']),
  functionTool('Write', 'Create or replace a UTF-8 text file inside the writable roots.', {
    file_path: { type: 'string' },
    content: { type: 'string' }
  }, ['file_path', 'content']),
  functionTool('Edit', 'Replace an exact string in an existing UTF-8 file inside the writable roots.', {
    file_path: { type: 'string' },
    old_string: { type: 'string' },
    new_string: { type: 'string' },
    replace_all: { type: 'boolean' }
  }, ['file_path', 'old_string', 'new_string']),
  functionTool('Glob', 'List files under a readable directory using *, ** and ? wildcards.', {
    pattern: { type: 'string' },
    path: { type: 'string' }
  }, ['pattern']),
  functionTool('Grep', 'Search UTF-8 text files under a readable directory with a regular expression.', {
    pattern: { type: 'string' },
    path: { type: 'string' },
    glob: { type: 'string' },
    case_insensitive: { type: 'boolean' }
  }, ['pattern']),
  functionTool(ZG_MCP_SEARCH_TOOL, [
    'Registered zvec-grep search tool (Claude-compatible name mcp__zvec-grep__zvec_grep_search).',
    'Hybrid search (ripgrep + BM25 + vector) over a mounted knowledge or workspace root.',
    'Use when retrieval would help answer the question; calling this tool is optional. Hits are routes, not facts. Read candidate originals to verify.',
    'Prioritize @-selected files or directories in the current context. Read selected files directly if needed; expand to other mounted knowledge libraries only when the selected scope has no relevant information and the user permits that scope.',
    mounts || 'Libraries are mounted as .external/<alias> directory symlinks.',
    'root must be an indexed directory, such as .external/<alias> or an absolute directory under readable roots, not an individual file. query is natural language or exact terms.',
    'If this tool is unavailable, use an appropriate alternative and report the actual error.'
  ].join(' '), {
    query: { type: 'string' },
    queries: { type: 'array', items: { type: 'string' } },
    root: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 25 }
  }, []),
  functionTool('zg_search', 'Alias of mcp__zvec-grep__zvec_grep_search. Prefer the MCP tool name.', {
    query: { type: 'string' },
    root: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 25 }
  }, ['query']),
  functionTool('Skill', 'Load the complete SKILL.md for one skill from the provided catalog.', {
    skill: { type: 'string' }
  }, ['skill'])
  ]
}

function knowledgeMountHint(projectPath: string, workDir: string): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const base of [join(workDir, '.external'), join(projectPath, '.external')]) {
    let entries
    try {
      entries = readdirSync(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (seen.has(entry.name)) continue
      if (!entry.isSymbolicLink() && !entry.isDirectory()) continue
      seen.add(entry.name)
      parts.push(`@${entry.name} → ${join(base, entry.name)}`)
    }
  }
  return parts.length > 0 ? `Mounted libraries: ${parts.join('; ')}.` : ''
}

function functionTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): DeepSeekToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', additionalProperties: false, properties, required }
    }
  }
}

class FileScope {
  constructor(
    private readonly projectPath: string,
    private readonly workDir: string,
    private readonly readRoots: string[],
    private readonly writeRoots: string[]
  ) {}

  async canonicalReadRoots(): Promise<string[]> {
    return Promise.all(this.readRoots.map((root) => canonicalPath(root, true)))
  }

  async readable(path: string): Promise<string> {
    return this.resolveAllowed(path, this.readRoots, false, '读取')
  }

  async writable(path: string, allowMissing: boolean): Promise<string> {
    return this.resolveAllowed(path, this.writeRoots, allowMissing, '写入')
  }

  private async resolveAllowed(path: string, roots: string[], allowMissing: boolean, action: string): Promise<string> {
    if (!path.trim()) throw new Error('文件路径不能为空')
    const candidates = isAbsolute(path)
      ? [resolve(path)]
      : [resolve(this.workDir, path), resolve(this.projectPath, path)]
    for (const candidate of [...new Set(candidates)]) {
      try {
        const canonical = await canonicalPath(candidate, allowMissing)
        const allowed = await Promise.all(roots.map((root) => canonicalPath(root, true)))
        if (allowed.some((root) => isInside(root, canonical))) return candidate
      } catch {
        // Try the repository-relative interpretation next.
      }
    }
    throw new Error(`路径不在允许的${action}范围内：${path}`)
  }
}

async function readFile(scope: FileScope, data: Record<string, unknown>): Promise<string> {
  const path = await scope.readable(stringField(data, 'file_path'))
  const stat = await fs.stat(path)
  if (!stat.isFile()) throw new Error('目标不是文件')
  if (stat.size > MAX_READ_BYTES) throw new Error(`文件过大，最多读取 ${MAX_READ_BYTES} bytes`)
  const lines = (await fs.readFile(path, 'utf8')).split('\n')
  const offset = integerField(data, 'offset', 1)
  const limit = Math.min(integerField(data, 'limit', 4000), 4000)
  return lines.slice(offset - 1, offset - 1 + limit)
    .map((line, index) => `${offset + index}\t${line}`)
    .join('\n')
}

async function writeFile(scope: FileScope, data: Record<string, unknown>): Promise<string> {
  const path = await scope.writable(stringField(data, 'file_path'), true)
  const content = stringField(data, 'content', true)
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new Error('写入内容过大')
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, content, 'utf8')
  return `已写入 ${path}（${Buffer.byteLength(content, 'utf8')} bytes）`
}

async function editFile(scope: FileScope, data: Record<string, unknown>): Promise<string> {
  const path = await scope.writable(stringField(data, 'file_path'), false)
  const oldString = stringField(data, 'old_string', true)
  const newString = stringField(data, 'new_string', true)
  if (!oldString) throw new Error('old_string 不能为空')
  const original = await fs.readFile(path, 'utf8')
  const count = original.split(oldString).length - 1
  if (count === 0) throw new Error('没有找到 old_string，文件未修改')
  const replaceAll = data.replace_all === true
  if (!replaceAll && count !== 1) throw new Error(`old_string 出现 ${count} 次，请扩大上下文或设置 replace_all`)
  const updated = replaceAll ? original.split(oldString).join(newString) : original.replace(oldString, newString)
  if (Buffer.byteLength(updated, 'utf8') > MAX_WRITE_BYTES) throw new Error('修改后的文件过大')
  await fs.writeFile(path, updated, 'utf8')
  return `已修改 ${path}（替换 ${replaceAll ? count : 1} 处）`
}

async function globFiles(scope: FileScope, data: Record<string, unknown>): Promise<string> {
  const base = await scope.readable(typeof data.path === 'string' ? data.path : '.')
  const pattern = stringField(data, 'pattern')
  const matcher = globToRegExp(pattern)
  const files = await walkFiles(base, await scope.canonicalReadRoots())
  return files
    .map((path) => relative(base, path).split(sep).join('/'))
    .filter((path) => matcher.test(path))
    .slice(0, MAX_LISTED_FILES)
    .join('\n') || '没有匹配文件'
}

async function grepFiles(scope: FileScope, data: Record<string, unknown>): Promise<string> {
  const base = await scope.readable(typeof data.path === 'string' ? data.path : '.')
  const flags = data.case_insensitive === true ? 'i' : ''
  const expression = new RegExp(stringField(data, 'pattern'), flags)
  const glob = typeof data.glob === 'string' && data.glob ? globToRegExp(data.glob) : null
  const files = await walkFiles(base, await scope.canonicalReadRoots())
  const matches: string[] = []

  for (const path of files) {
    const rel = relative(base, path).split(sep).join('/')
    if (glob && !glob.test(rel)) continue
    let stat
    try { stat = await fs.stat(path) } catch { continue }
    if (stat.size > MAX_READ_BYTES) continue
    let text
    try { text = await fs.readFile(path, 'utf8') } catch { continue }
    if (text.includes('\0')) continue
    for (const [index, line] of text.split('\n').entries()) {
      expression.lastIndex = 0
      if (!expression.test(line)) continue
      matches.push(`${rel}:${index + 1}:${line.slice(0, 500)}`)
      if (matches.length >= MAX_GREP_RESULTS) return matches.join('\n')
    }
  }
  return matches.join('\n') || '没有匹配内容'
}

async function readSkill(context: HarnessContext, data: Record<string, unknown>): Promise<string> {
  const name = stringField(data, 'skill')
  const skill = context.skills.get(name)
  if (!skill) throw new Error(`未找到 skill：${name}`)
  const content = await fs.readFile(skill.path, 'utf8')
  return content.slice(0, MAX_READ_BYTES)
}

async function zgSearch(scope: FileScope, data: Record<string, unknown>): Promise<string> {
  const query = searchQuery(data)
  const rootInput = typeof data.root === 'string' && data.root.trim() ? data.root.trim() : '.external'
  const root = await scope.readable(rootInput)
  const indexed = await listZgIndexedRoots(root, await scope.canonicalReadRoots())
  const targets = indexed.length > 0 ? indexed : [root]
  const limit = integerField(data, 'limit', 12)
  const collected: Array<{ root: string; hit: ZgHit }> = []
  let engineReady = false
  for (const target of targets) {
    const hits = await zgQuery(target, query, { limit })
    if (hits === null) continue
    engineReady = true
    for (const hit of hits) collected.push({ root: target, hit })
  }
  if (!engineReady) {
    throw new Error('zg 检索不可用（索引未就绪或引擎未安装）。请改用 Grep，或指定 root=.external/<alias>。')
  }
  if (collected.length === 0) return '没有匹配内容'
  return collected.map((item, index) => {
    const loc = `${hitRelPath(item.root, root, item.hit.relPath)}:${item.hit.lineStart}-${item.hit.lineEnd}`
    const heading = item.hit.heading ? `\nheading: ${item.hit.heading}` : ''
    const body = item.hit.lines.join('\n')
    return `#${index + 1} matchedBy=${item.hit.matchedBy} ${loc}${heading}\n${body}`
  }).join('\n\n')
}

function hitRelPath(target: string, requestedRoot: string, relPath: string): string {
  const prefix = relative(requestedRoot, target).split(sep).join('/')
  if (!prefix || prefix === '.' || prefix.startsWith('..')) return relPath
  return `${prefix}/${relPath}`
}

async function listZgIndexedRoots(root: string, allowedRoots: string[]): Promise<string[]> {
  if (await hasZgIndex(root)) return [root]
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const roots: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) {
      const followed = await followAllowed(path, allowedRoots)
      if (followed?.kind !== 'dir') continue
    } else if (!entry.isDirectory()) {
      continue
    }
    if (await hasZgIndex(path)) roots.push(path)
  }
  return roots
}

async function hasZgIndex(root: string): Promise<boolean> {
  try {
    const stat = await fs.stat(join(root, '.zvec-grep'))
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function walkFiles(root: string, allowedRoots: string[]): Promise<string[]> {
  const stat = await fs.stat(root)
  if (stat.isFile()) return [root]
  if (!stat.isDirectory()) return []
  const result: string[] = []
  const queue = [root]
  while (queue.length > 0 && result.length < MAX_LISTED_FILES) {
    const dir = queue.shift()!
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const followed = await followAllowed(path, allowedRoots)
        if (!followed) continue
        if (followed.kind === 'dir') queue.push(path)
        else {
          result.push(path)
          if (result.length >= MAX_LISTED_FILES) break
        }
        continue
      }
      if (entry.isDirectory()) {
        queue.push(path)
      } else if (entry.isFile()) {
        result.push(path)
        if (result.length >= MAX_LISTED_FILES) break
      }
    }
  }
  return result
}

async function followAllowed(
  path: string,
  allowedRoots: string[]
): Promise<{ kind: 'dir' | 'file' } | null> {
  let stat
  let canonical
  try {
    stat = await fs.stat(path)
    canonical = await fs.realpath(path)
  } catch {
    return null
  }
  if (!allowedRoots.some((root) => isInside(root, canonical))) return null
  if (stat.isDirectory()) return { kind: 'dir' }
  if (stat.isFile()) return { kind: 'file' }
  return null
}

async function canonicalPath(path: string, allowMissing: boolean): Promise<string> {
  try {
    return await fs.realpath(path)
  } catch (error) {
    if (!allowMissing) throw error
    let ancestor = path
    while (true) {
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      try {
        const realAncestor = await fs.realpath(parent)
        return resolve(realAncestor, relative(parent, path))
      } catch {
        ancestor = parent
      }
    }
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/')
  let source = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (char === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工具参数必须是对象')
  return value as Record<string, unknown>
}

function stringField(data: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = data[key]
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`${key} 必须是字符串`)
  return value
}

function searchQuery(data: Record<string, unknown>): string {
  if (typeof data.query === 'string' && data.query.trim()) return data.query.trim()
  const queries = data.queries
  if (typeof queries === 'string' && queries.trim()) return queries.trim()
  if (Array.isArray(queries)) {
    const first = queries.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
    if (first) return first.trim()
  }
  throw new Error('query 必须是字符串')
}

function integerField(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = data[key]
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function ok(content: string): { content: string; isError: false } {
  return { content, isError: false }
}
