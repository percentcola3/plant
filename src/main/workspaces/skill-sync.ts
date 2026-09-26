// skill 模板智能同步：解决"App 升级了 skill 内容但已初始化的工作区永远拿不到"。
//
// 老逻辑：syncSkillTemplateTarget 看到 skill 文件夹存在就 return —— 用户改没改都不动。
// 结果：每次 App 改了 skill 内容（修 bug / 加规则），用户必须手动点"恢复模板"才能拿到。
//
// 新逻辑（按文件粒度，per-file hash 跟踪）：
//   - 首次 sync：把模板内容拷过去，记录每个文件的源 hash 到 skill-managed-hashes.json
//   - 后续 sync 对每个模板文件：
//       1. 用户的副本不存在 → 写
//       2. 用户副本存在，且当前 hash == 上次记录的源 hash → 用户没改过，安全覆盖
//       3. 用户副本存在，且 hash 已变 → 用户定制过，保留不动（仅警告）
//   - 同步后更新 skill-managed-hashes.json 为最新源 hash
//
// 这样 App 升级 skill 内容会自动到用户工作区，但用户的本地定制不会被覆盖。
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'

const HASHES_FILE_REL = '.ui-client/skill-managed-hashes.json'

// 旧版 App 写入的内置 skill 指纹。没有 hash 记录时，这些副本按模板升级，不当作用户定制。
export const STALE_APP_SKILL_MARKERS = [
  '无需 RAG、向量库或专用 MCP'
] as const

type HashMap = Record<string, string>   // workspace-relative path → hex sha256

function looksLikeStaleAppSkill(existing: Buffer, source: Buffer): boolean {
  const existingText = existing.toString('utf8')
  const sourceText = source.toString('utf8')
  return STALE_APP_SKILL_MARKERS.some((marker) => existingText.includes(marker) && !sourceText.includes(marker))
}

function hashContent(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

async function readHashMap(workspacePath: string): Promise<HashMap> {
  const path = join(workspacePath, HASHES_FILE_REL)
  try {
    const text = await fs.readFile(path, 'utf-8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as HashMap : {}
  } catch { return {} }
}

async function writeHashMap(workspacePath: string, map: HashMap): Promise<void> {
  const path = join(workspacePath, HASHES_FILE_REL)
  await fs.mkdir(dirname(path), { recursive: true }).catch(() => undefined)
  await fs.writeFile(path, JSON.stringify(map, null, 2) + '\n', 'utf-8').catch(() => undefined)
}

// 递归遍历模板源目录，收集所有 (相对路径, 内容) 对
async function collectTemplateFiles(rootDir: string): Promise<Array<{ rel: string; content: Buffer }>> {
  const out: Array<{ rel: string; content: Buffer }> = []
  async function walk(dir: string, baseRel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(abs, rel)
      else if (entry.isFile()) {
        const content = await fs.readFile(abs).catch(() => null)
        if (content) out.push({ rel, content })
      }
    }
  }
  await walk(rootDir, '')
  return out
}

export type SyncSkillResult = {
  written: number
  preservedUserEdits: string[]    // 跳过的文件路径（相对工作区根）
}

// 按文件粒度同步一个 skill 目录树到目标位置。
// templateDir：模板源目录（如 resources/skill-templates/pm-brainstorm）
// targetDir：用户工作区目标目录（如 <workspace>/.claude/skills/pm-brainstorm）
export async function syncSkillSubtree(
  workspacePath: string,
  templateDir: string,
  targetDir: string
): Promise<SyncSkillResult> {
  const hashMap = await readHashMap(workspacePath)
  const templateFiles = await collectTemplateFiles(templateDir)
  const result: SyncSkillResult = { written: 0, preservedUserEdits: [] }

  await fs.mkdir(targetDir, { recursive: true })

  for (const { rel, content } of templateFiles) {
    const target = join(targetDir, rel)
    const targetRel = relative(workspacePath, target).replace(/\\/g, '/')
    const sourceHash = hashContent(content)

    let existingContent: Buffer | null = null
    try { existingContent = await fs.readFile(target) } catch { /* missing */ }

    if (existingContent === null) {
      // 1. 不存在 → 写
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, content)
      hashMap[targetRel] = sourceHash
      result.written += 1
      continue
    }

    const existingHash = hashContent(existingContent)
    if (existingHash === sourceHash) {
      // 内容跟源一致，不用动；hash map 也不用变
      continue
    }

    const lastSyncedHash = hashMap[targetRel]
    if (lastSyncedHash && existingHash === lastSyncedHash) {
      // 2. 用户没改过（当前 hash == 上次同步的源 hash），安全覆盖
      await fs.writeFile(target, content)
      hashMap[targetRel] = sourceHash
      result.written += 1
    } else if (!lastSyncedHash && looksLikeStaleAppSkill(existingContent, content)) {
      // 从未记过 hash 的旧内置模板（例如仍写「无需 MCP」），按 App 升级覆盖
      await fs.writeFile(target, content)
      hashMap[targetRel] = sourceHash
      result.written += 1
    } else {
      // 3. 用户改过 → 保留
      result.preservedUserEdits.push(targetRel)
    }
  }

  await writeHashMap(workspacePath, hashMap)
  return result
}

// 删除某个 skill 后调用：清掉 hash map 里所有以指定前缀（如 '.claude/skills/<name>/'）开头的条目。
// 防止以后用户重新装入同名 skill 时，残留的旧 hash 误判为"用户改过"。
// 文件不存在 / 写不进去都静默——hash map 是优化用的，丢了不影响功能。
export async function removeHashPrefix(workspacePath: string, prefixes: string[]): Promise<void> {
  if (prefixes.length === 0) return
  const map = await readHashMap(workspacePath)
  let changed = false
  for (const key of Object.keys(map)) {
    if (prefixes.some((p) => key.startsWith(p))) {
      delete map[key]
      changed = true
    }
  }
  if (changed) await writeHashMap(workspacePath, map)
}
