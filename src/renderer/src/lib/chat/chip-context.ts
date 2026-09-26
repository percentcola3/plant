export type SubmitChipToken = {
  type: string
  alias?: string
  path?: string
  text?: string
}

export type InspectorPickContext = {
  alias: string
  path: string
  tagName?: string
  textPreview?: string
  edits?: Record<string, string>
}

export type SubmitChipContext = InspectorPickContext

export function collectSubmitChips(input: {
  text: string
  tokens: SubmitChipToken[]
  currentPicks: InspectorPickContext[]
}): SubmitChipContext[] {
  const byAlias = new Map(input.currentPicks.map(pick => [pick.alias, pick]))
  const chips: SubmitChipContext[] = []
  const seenAliases = new Set<string>()

  for (const token of input.tokens) {
    if (token.type !== 'chip' || !token.alias || !token.path) continue
    chips.push(chipFromPick(token.alias, token.path, byAlias.get(token.alias)))
    seenAliases.add(token.alias)
  }

  for (const alias of aliasesInText(input.text)) {
    if (seenAliases.has(alias)) continue
    const pick = byAlias.get(alias)
    if (!pick) continue
    chips.push(chipFromPick(alias, pick.path, pick))
    seenAliases.add(alias)
  }

  return chips
}

function aliasesInText(text: string): string[] {
  const aliases: string[] = []
  const re = /@([A-Z])(?=$|[^A-Za-z0-9_])/g
  for (const match of text.matchAll(re)) aliases.push(match[1])
  return aliases
}

function chipFromPick(
  alias: string,
  path: string,
  pick: InspectorPickContext | undefined
): SubmitChipContext {
  // pick 来自 Pinia store 的 reactive 数组，edits 是 Vue 3 reactive Proxy；
  // 直接进 IPC 会因为 Proxy 上的 ReactiveFlags Symbol 让 structuredClone 抛
  // "An object could not be cloned"。spread 一次拷成 plain object。
  return {
    alias,
    path,
    tagName: pick?.tagName,
    textPreview: pick?.textPreview,
    edits: pick?.edits ? { ...pick.edits } : undefined
  }
}
