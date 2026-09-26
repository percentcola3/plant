import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { readEditableRoots } from '../claude-headless/scope-warning'

const MAX_INSTRUCTION_BYTES = 96 * 1024

export type HarnessSkill = {
  name: string
  description: string
  path: string
  directory: string
  source: 'project' | 'user'
}

export type HarnessContext = {
  systemPrompt: string
  readRoots: string[]
  writeRoots: string[]
  skills: Map<string, HarnessSkill>
}

export async function buildHarnessContext(input: {
  projectPath: string
  workDir: string
  addDirs: string[]
}): Promise<HarnessContext> {
  const { skills, readRoots, writeRoots } = await resolveHarnessAccess(input)
  const instructions = await loadInstructionFiles(input.projectPath, input.workDir)

  return {
    readRoots,
    writeRoots,
    skills,
    systemPrompt: renderSystemPrompt({
      projectPath: input.projectPath,
      workDir: input.workDir,
      readRoots,
      writeRoots,
      skills,
      instructions
    })
  }
}

// Shared with the read-only UI scope query so the displayed roots cannot drift.
export async function resolveHarnessAccess(input: { projectPath: string; workDir: string; addDirs: string[] }) {
  const skills = await discoverSkills(input.projectPath, input.workDir)
  const readRoots = uniquePaths(await expandMountedRoots([
    input.workDir,
    ...input.addDirs,
    ...[...skills.values()].map((skill) => skill.directory)
  ]))
  const editableRoots = readEditableRoots(input.projectPath)
  const writeRoots = uniquePaths(editableRoots.length > 0
    ? editableRoots.map((root) => resolve(input.projectPath, root))
    : [input.workDir])
  return { skills, readRoots, writeRoots }
}

async function loadInstructionFiles(projectPath: string, workDir: string): Promise<Array<{ path: string; content: string }>> {
  const candidates = [
    ...['system.md', 'AGENTS.md', 'CLAUDE.md'].map((name) => join(workDir, name)),
    ...['system.md', 'AGENTS.md', 'CLAUDE.md'].map((name) => join(projectPath, name))
  ]
  const seen = new Set<string>()
  const result: Array<{ path: string; content: string }> = []
  let remaining = MAX_INSTRUCTION_BYTES

  for (const candidate of candidates) {
    if (remaining <= 0) break
    try {
      const real = await fs.realpath(candidate)
      if (seen.has(real)) continue
      seen.add(real)
      const content = await fs.readFile(real, 'utf8')
      const prefix = Buffer.from(content, 'utf8').subarray(0, remaining).toString('utf8').replace(/\uFFFD$/, '')
      if (!prefix.trim()) continue
      remaining -= Buffer.byteLength(prefix, 'utf8')
      result.push({ path: displayPath(projectPath, real), content: prefix.trim() })
    } catch {
      // Optional project instructions may not exist.
    }
  }
  return result
}

export async function discoverSkills(projectPath: string, workDir: string): Promise<Map<string, HarnessSkill>> {
  const roots: Array<{ path: string; source: HarnessSkill['source'] }> = [
    { path: join(workDir, '.claude', 'skills'), source: 'project' },
    { path: join(workDir, '.agents', 'skills'), source: 'project' },
    { path: join(projectPath, '.claude', 'skills'), source: 'project' },
    { path: join(projectPath, '.agents', 'skills'), source: 'project' },
    { path: join(homedir(), '.claude', 'skills'), source: 'user' },
    { path: join(homedir(), '.agents', 'skills'), source: 'user' }
  ]
  const skills = new Map<string, HarnessSkill>()

  for (const root of roots) {
    let entries: string[]
    try {
      entries = await fs.readdir(root.path)
    } catch {
      continue
    }
    for (const entry of entries.sort()) {
      const path = join(root.path, entry, 'SKILL.md')
      try {
        const raw = await fs.readFile(path, 'utf8')
        const meta = parseSkillFrontmatter(raw)
        const name = meta.name || entry
        if (!name || skills.has(name)) continue
        skills.set(name, {
          name,
          description: meta.description,
          path,
          directory: dirname(path),
          source: root.source
        })
      } catch {
        // Skip malformed or partially installed skills.
      }
    }
  }
  return skills
}

function parseSkillFrontmatter(raw: string): { name: string; description: string } {
  const match = /^---\s*\n([\s\S]*?)\n---/m.exec(raw)
  if (!match) return { name: '', description: '' }
  const block = match[1]
  const name = /^name:\s*(.+?)\s*$/m.exec(block)?.[1]?.trim() ?? ''
  const singleLine = /^description:\s*(?![>|])(.+?)\s*$/m.exec(block)?.[1]?.trim()
  const folded = /^description:\s*[>|]-?\s*\n((?:[ \t]+.*(?:\n|$))*)/m.exec(block)?.[1]
  const description = (singleLine ?? folded ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
  return { name, description }
}

function renderSystemPrompt(input: {
  projectPath: string
  workDir: string
  readRoots: string[]
  writeRoots: string[]
  skills: Map<string, HarnessSkill>
  instructions: Array<{ path: string; content: string }>
}): string {
  const lines = [
    'You are the built-in DeepSeek Harness for the WorkSpace desktop app.',
    'Work as a concise, production-minded coding and product agent. Use the provided tools to inspect and edit real files; never claim a file changed unless a tool succeeded.',
    '',
    'Clarification rule:',
    '- If a missing answer materially changes the implementation, ask concise questions and stop this turn.',
    '- For minor ambiguity, make a reasonable choice, state it briefly, and continue.',
    '',
    `Repository root: ${input.projectPath}`,
    `Current working directory: ${input.workDir}`,
    'Readable roots:',
    ...input.readRoots.map((root) => `- ${root}`),
    'Writable roots (enforced by the harness):',
    ...input.writeRoots.map((root) => `- ${root}`),
    '',
    'File rules:',
    '- Treat relative tool paths as relative to the current working directory. Repository-relative paths are also accepted when unambiguous.',
    '- Read only from readable roots and write only inside writable roots.',
    '- External resources are read-only unless a writable root explicitly contains them.',
    '- The zvec-grep search tool is registered as mcp__zvec-grep__zvec_grep_search. Decide whether retrieval is needed; do not call it merely to demonstrate availability.',
    '- When retrieval is needed, prioritize files or directories explicitly selected with @ in the current user context. Read known files directly or use an appropriate search tool within that scope. Only if that scope has no relevant information, expand to other mounted .external/<alias> knowledge libraries, respecting any explicit user scope restriction.',
    '- Choose Read, Grep, Glob, or zvec-grep as appropriate. For zvec-grep, use an indexed directory as root, not an individual file; restrict candidates to selected paths or read those files directly before expanding scope. Verify candidate files with Read; search excerpts alone are not authoritative facts.',
    '- Libraries are mounted as .external/<alias> directory symlinks. If retrieval is unavailable, report the actual tool error and use an appropriate alternative.',
    '- Arbitrary shell execution is intentionally unavailable; use the file/search tools and report validation you could not run.',
  ]

  if (input.skills.size > 0) {
    lines.push('', 'Available skills (call the Skill tool before following one):')
    for (const skill of input.skills.values()) {
      lines.push(`- ${skill.name}${skill.description ? `: ${skill.description}` : ''}`)
    }
  }

  if (input.instructions.length > 0) {
    lines.push('', 'Project instruction files follow. They are authoritative within the file and tool boundaries above.')
    for (const instruction of input.instructions) {
      lines.push('', `--- ${instruction.path} ---`, instruction.content)
    }
  }
  return lines.join('\n')
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))]
}

async function expandMountedRoots(paths: string[]): Promise<string[]> {
  const extra: string[] = []
  for (const root of paths) {
    let entries
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue
      try {
        extra.push(await fs.realpath(join(root, entry.name)))
      } catch {
        // dangling mount
      }
    }
  }
  return uniquePaths([...paths, ...extra])
}

function displayPath(projectPath: string, path: string): string {
  const rel = relative(projectPath, path)
  return rel && !rel.startsWith('..') ? rel : path
}
