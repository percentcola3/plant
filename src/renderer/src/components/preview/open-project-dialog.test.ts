import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/OpenProjectDialog.vue'),
  'utf-8'
)

describe('OpenProjectDialog outputs-first UX projects', () => {
  it('hides the workspace picker for outputs-first UX projects', () => {
    expect(source).toContain('hideWorkspacePicker')
    expect(source).toContain('isOutputsFirstUxProject')
    expect(source).toContain('v-if="!hideWorkspacePicker"')
    expect(source).toContain('选择 Git 项目和要打开的内部项目。')
  })
})
