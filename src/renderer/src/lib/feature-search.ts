import type { FeatureCard } from '@shared/types'

export function fuzzyMatch(haystack: string, query: string): boolean {
  const normalizedHaystack = haystack.toLowerCase()
  const normalizedQuery = query.toLowerCase()
  if (!normalizedQuery) return true
  if (normalizedHaystack.includes(normalizedQuery)) return true
  let haystackIndex = 0
  for (let queryIndex = 0; queryIndex < normalizedQuery.length; queryIndex += 1) {
    haystackIndex = normalizedHaystack.indexOf(normalizedQuery[queryIndex], haystackIndex)
    if (haystackIndex === -1) return false
    haystackIndex += 1
  }
  return true
}

export function buildFeatureSearchHaystack(
  card: FeatureCard,
  displayDocPath: (card: FeatureCard) => string,
  resolveGroup: (card: FeatureCard) => string | null
): string {
  return [
    card.name,
    card.relPath,
    card.group ?? resolveGroup(card) ?? '',
    card.prdRelPath ?? '',
    displayDocPath(card),
    ...card.uiArtifacts.map((artifact) => `${artifact.name} ${artifact.htmlRelPath}`),
  ].join(' ')
}

export function featureMatchesSearch(
  card: FeatureCard,
  query: string,
  displayDocPath: (card: FeatureCard) => string,
  resolveGroup: (card: FeatureCard) => string | null
): boolean {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = buildFeatureSearchHaystack(card, displayDocPath, resolveGroup)
  return tokens.every((token) => fuzzyMatch(haystack, token))
}
