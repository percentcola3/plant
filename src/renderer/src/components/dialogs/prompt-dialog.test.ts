import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('./PromptDialog.vue', import.meta.url),
  'utf-8'
)

const uiStoreSource = readFileSync(
  new URL('../../stores/ui.ts', import.meta.url),
  'utf-8'
)

describe('PromptDialog', () => {
  it('renders prompt options as a select instead of a free text input', () => {
    expect(uiStoreSource).toContain('options?: PromptOption[]')
    expect(source).toContain('@/components/ui/select')
    expect(source).toContain('v-if="ui.promptOpen?.options?.length"')
    expect(source).toContain('<SelectItem')
    expect(source).toContain('@update:model-value="onSelectValue"')
    expect(source).toContain('const selectedOptionLabel = computed')
    expect(source).toContain('{{ selectedOptionLabel }}')
    expect(source).toContain('option.description')
  })
})
