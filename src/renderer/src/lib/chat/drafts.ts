import type { Token } from '@/components/chat/ChipInput.vue'

const draftsByKey = new Map<string, Token[]>()

function cloneTokens(tokens: Token[]): Token[] {
  return tokens.map(token => ({ ...token }))
}

export function loadChatDraft(key: string): Token[] {
  return cloneTokens(draftsByKey.get(key) ?? [])
}

export function saveChatDraft(key: string, tokens: Token[]): void {
  draftsByKey.set(key, cloneTokens(tokens))
}
