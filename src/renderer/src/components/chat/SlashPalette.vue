<script setup lang="ts">
// SlashPalette — UI 模式输入框开头敲 / 时弹出的命令选择器。
// 列表内容：
//   - 内置斜杠命令（/help /skills /think /plan / clear / new）
//     行为有两类：__APP_ACTION__:xxx → 由 ChatComposer 识别走 App 内置动作（清空 / 新会话）；
//     普通文本 → 插入到输入框作为 prompt 让 Claude 处理
//   - 当前工作区可用的 skill（项目级 + 用户级）：选中插入触发文本（"使用 skill: <name>"）
//
// 数据从主进程一次性拉，缓存到组件挂载期内（mount 时拉一次）。
import { computed, onMounted, ref, watch } from 'vue'
import { call } from '@/lib/api'
import { useWorkspacesStore } from '@/stores/workspaces'

type SkillItem = {
  kind: 'skill'
  name: string
  description: string
  source: 'project' | 'user'
  quickInvocation: boolean
  defaultPrompt: string | null
}
type BuiltinItem = { kind: 'builtin'; name: string; description: string; insertText: string }
type Item = SkillItem | BuiltinItem

const props = defineProps<{
  query: string                  // 用户输入的 / 后面的字符（不含 /）
  position: { x: number; y: number }
}>()

const emit = defineEmits<{
  select: [item: Item]
  close: []
}>()

const workspaces = useWorkspacesStore()
const skills = ref<SkillItem[]>([])
const builtins = ref<BuiltinItem[]>([])
const activeIndex = ref(0)

async function refresh(): Promise<void> {
  const id = workspaces.activeId
  if (!id) return
  const r = await call('claude.commandCatalog', { workspaceId: id })
  if (!r.ok) return
  skills.value = r.data.skills.map(s => ({ kind: 'skill' as const, ...s }))
  builtins.value = r.data.builtins.map(b => ({ kind: 'builtin' as const, ...b }))
}

onMounted(refresh)
watch(() => workspaces.activeId, refresh)

const filtered = computed<Item[]>(() => {
  const q = props.query.trim().toLowerCase()
  const all: Item[] = [...builtins.value, ...skills.value]
  if (!q) return all.slice(0, 30)
  // 简易模糊：name 前缀优先，description 包含次之
  const byPrefix: Item[] = []
  const byContain: Item[] = []
  for (const item of all) {
    const name = item.name.toLowerCase()
    if (name.startsWith('/' + q) || name.startsWith(q)) byPrefix.push(item)
    else if (name.includes(q) || item.description.toLowerCase().includes(q)) byContain.push(item)
  }
  return [...byPrefix, ...byContain].slice(0, 30)
})

watch(filtered, () => { activeIndex.value = 0 })

function onItemClick(item: Item): void {
  emit('select', item)
}

// 暴露键盘控制给 ChatComposer 调用（比 v-on 注册全局监听干净）
function moveActive(delta: number): void {
  const len = filtered.value.length
  if (len === 0) return
  activeIndex.value = (activeIndex.value + delta + len) % len
}
function pickActive(): boolean {
  const item = filtered.value[activeIndex.value]
  if (!item) return false
  emit('select', item)
  return true
}

defineExpose({ moveActive, pickActive })
</script>

<template>
  <div
    v-if="filtered.length > 0"
    class="slash-palette"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
  >
    <div class="sp-header">命令 / Skill</div>
    <ul class="sp-list">
      <li
        v-for="(item, idx) in filtered"
        :key="`${item.kind}:${item.name}`"
        class="sp-item"
        :class="{ 'sp-item--active': idx === activeIndex }"
        @mousedown.prevent="onItemClick(item)"
      >
        <span class="sp-name">
          <span v-if="item.kind === 'skill'" class="sp-tag">skill</span>
          {{ item.name }}
          <span v-if="item.kind === 'skill' && item.quickInvocation" class="sp-quick-tag">快捷</span>
        </span>
        <span class="sp-desc">{{ item.description }}</span>
      </li>
    </ul>
    <div class="sp-hint">↑↓ 选择 · Enter 确认 · Esc 取消</div>
  </div>
</template>

<style scoped>
.slash-palette {
  position: fixed;
  z-index: 1000;
  min-width: 280px;
  max-width: 420px;
  max-height: 320px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-popover-border);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
  color: var(--color-text-primary);
  font-size: 13px;
}
.sp-header {
  padding: 6px 10px;
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.sp-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  margin: 0;
  list-style: none;
  background: var(--color-bg-panel);
}
.sp-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  cursor: pointer;
}
.sp-item:hover { background: var(--color-bg-hover); }
.sp-item--active { background: var(--color-accent-light); }
.sp-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-weight: 600;
}
.sp-tag {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-bg-elevated));
  color: var(--color-accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-family: inherit;
}
.sp-quick-tag {
  color: var(--color-accent);
  font-family: inherit;
  font-size: 10px;
  font-weight: 500;
}
.sp-desc {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.sp-hint {
  padding: 5px 10px;
  background: var(--color-bg-elevated);
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 11px;
}
</style>
