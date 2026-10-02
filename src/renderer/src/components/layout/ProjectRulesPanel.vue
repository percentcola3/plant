<script setup lang="ts">
// 项目规则：唯一事实源是项目根的 system.md。默认只维护这一份。
// - 新建需求(feature)时，App 把 feature 目录的 CLAUDE.md/AGENTS.md 符号链接到根 system.md。
// - 默认**不**在项目根创建 CLAUDE.md/AGENTS.md。
// - 若导入的项目本来就有真实 CLAUDE.md/AGENTS.md：不丢弃，在其末尾注入 @system.md 引用；
//   面板把它们列为「项目自有」，可打开查看（App 不接管内容）。

import { SlidersHorizontal, FileCheck2, FileText } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '@/stores/editor'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useUiStore } from '@/stores/ui'
import { call } from '@/lib/api'
import { renderSystemDoc } from '@shared/ai-rule-text'

const SYSTEM_PATH = 'system.md'
const OWNABLE = [
  { relPath: 'CLAUDE.md', who: 'Claude Code 读取' },
  { relPath: 'AGENTS.md', who: 'Codex / Cursor 读取' }
] as const

type EntryKind = { kind: 'missing' | 'symlink' | 'file' | 'dir'; target?: string }

const editor = useEditorStore()
const ws = useWorkspacesStore()
const ui = useUiStore()
const { active } = storeToRefs(ws)

const kindByPath = ref<Record<string, EntryKind>>({})
const busy = ref(false)

const systemExists = computed(() => (kindByPath.value[SYSTEM_PATH]?.kind ?? 'missing') !== 'missing')

// 只展示「确实存在的」CLAUDE.md/AGENTS.md（导入项目自有的少数场景）；默认不存在 → 不展示。
const ownFiles = computed(() => OWNABLE.filter((o) => (kindByPath.value[o.relPath]?.kind ?? 'missing') !== 'missing'))

async function refreshKinds(): Promise<void> {
  if (!active.value) { kindByPath.value = {}; return }
  const paths = [SYSTEM_PATH, ...OWNABLE.map((l) => l.relPath)]
  const entries = await Promise.all(paths.map(async (p) => {
    const r = await call('editor.entryKind', { workspaceId: active.value!.id, relPath: p })
    return [p, r.ok ? r.data : { kind: 'missing' as const }] as const
  }))
  kindByPath.value = Object.fromEntries(entries)
}

onMounted(() => { void refreshKinds() })
watch(() => active.value?.id, () => { void refreshKinds() })

async function openSystem(): Promise<void> {
  if (!active.value || busy.value) return
  ui.rememberEditorReturnView()
  if (systemExists.value) {
    await editor.openMarkdown(SYSTEM_PATH)
    return
  }
  busy.value = true
  try {
    const r = await call('editor.writeTextFile', {
      workspaceId: active.value.id,
      relPath: SYSTEM_PATH,
      content: renderSystemDoc()
    })
    if (!r.ok) { ui.showToast('error', `创建 system.md 失败：${r.message}`, 5000); return }
    await refreshKinds()
    await editor.openMarkdown(SYSTEM_PATH)
  } finally {
    busy.value = false
  }
}

async function openOwn(relPath: string): Promise<void> {
  if (!active.value) return
  ui.rememberEditorReturnView()
  await editor.openMarkdown(relPath)
}
</script>

<template>
  <section class="rules-block">
    <div class="rules-block__head">
      <h3><SlidersHorizontal :size="16" aria-hidden="true" /> 项目规则</h3>
      <p>唯一事实源是 <code>system.md</code>，只维护这一份；新建需求时自动关联到 feature 目录。</p>
    </div>
    <ul class="rules-list">
      <li class="rule-row rule-row--primary">
        <span class="rule-icon" aria-hidden="true"><FileCheck2 :size="19" /></span>
        <div class="rule-main">
          <div class="rule-title">
            <code>system.md</code>
            <span v-if="systemExists" class="rule-state rule-state--ok">已存在</span>
            <span v-else class="rule-state rule-state--missing">未创建</span>
          </div>
          <div class="rule-sub">项目唯一 AI 约束事实源 · Claude / Codex / Cursor 都读它</div>
        </div>
        <button type="button" class="rule-btn" :disabled="busy" @click="openSystem">
          {{ systemExists ? '编辑' : (busy ? '新建中…' : '新建') }}
        </button>
      </li>
      <li v-for="o in ownFiles" :key="o.relPath" class="rule-row">
        <span class="rule-icon" aria-hidden="true"><FileText :size="19" /></span>
        <div class="rule-main">
          <div class="rule-title">
            <code>{{ o.relPath }}</code>
            <span class="rule-state rule-state--own">项目自有</span>
          </div>
          <div class="rule-sub">{{ o.who }} · 已在末尾注入 @system.md（App 不接管内容）</div>
        </div>
        <button type="button" class="rule-btn rule-btn--ghost" @click="openOwn(o.relPath)">打开</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.rules-block { display: flex; flex-direction: column; gap: 10px; }
.rules-block__head h3 { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--color-text-primary); font-size: 14px; font-weight: 650; }
.rules-block__head h3 span { margin-right: 4px; }
.rules-block__head p { margin: 4px 0 0; color: var(--color-text-secondary); font-size: 12px; }
.rules-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rule-row {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--color-border); background: var(--color-bg-base);
  border-radius: 6px; padding: 8px 10px;
}
.rules-block__head h3 svg { color: var(--color-leaf); }
.rule-icon { display: grid; place-items: center; flex: none; width: 30px; height: 34px; border-radius: 7px; background: var(--color-accent-light); color: var(--color-leaf); }
.rule-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.rule-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.rule-title code {
  padding: 1px 6px; border-radius: 3px; background: var(--color-bg-elevated);
  font-family: SF Mono, Menlo, Consolas, monospace; font-size: 12px;
}
.rule-state {
  display: inline-flex; align-items: center;
  border-radius: 999px; padding: 1px 8px;
  font-size: 10px; font-weight: 600;
}
.rule-state--ok {
  border: 1px solid var(--color-accent-border);
  background: var(--color-accent-subtle);
  color: var(--color-accent-pressed);
}
.rule-state--missing {
  border: 1px solid rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
}
.rule-state--own {
  border: 1px solid rgba(100, 116, 139, 0.4);
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
}
.rule-sub { color: var(--color-text-secondary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rule-btn {
  flex: 0 0 auto;
  border: 1px solid var(--color-accent-border);
  border-radius: 6px; background: var(--color-accent-light);
  padding: 4px 12px; font-size: 12px; color: var(--color-accent-pressed); cursor: pointer;
}
.rule-btn:hover:not(:disabled) { background: var(--color-accent-subtle); }
.rule-btn:disabled { cursor: wait; opacity: 0.6; }
</style>
