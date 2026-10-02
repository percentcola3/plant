<script setup lang="ts">
// 项目 skills 展示 / 编辑 / 恢复模板 / 增删 / 启用禁用。
// PM (project) 与 UX (ux) 两类工作区可用。自己负责加载和刷新。

import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { Sparkles, Folder, Palette, ScanSearch, ClipboardCheck } from 'lucide-vue-next'
import PlantIllustration from '@/components/brand/PlantIllustration.vue'
import AddSkillForm from './AddSkillForm.vue'
import type { SkillSummary } from '@shared/types'

const BUILTIN_SKILLS = [
  { name: 'ux-design', label: 'UX 设计' },
  { name: 'prd-tech-review', label: 'PRD 技术评审' },
  { name: 'knowledge-search', label: '知识库检索' }
] as const

const ws = useWorkspacesStore()
const editor = useEditorStore()
const ui = useUiStore()
const { active } = storeToRefs(ws)

const addOpen = ref(false)

const skills = computed(() => {
  const id = active.value?.id
  if (!id) return []
  return ws.skillsByWorkspace[id] ?? []
})
const loading = computed(() => {
  const id = active.value?.id
  return id ? ws.skillsLoading[id] === true : false
})
let lastEditedSkillRelPath: string | null = null

async function openSkillEditor(skillRelPath: string): Promise<void> {
  if (!active.value) return
  lastEditedSkillRelPath = skillRelPath
  ui.rememberEditorReturnView()
  await editor.openProjectMarkdown(skillRelPath)
  if (editor.session?.relPath === skillRelPath) editor.setMode('edit')
}

async function restoreSkill(skillName: string): Promise<void> {
  if (!active.value) return
  const ok = window.confirm(`确定把 ${skillName} 恢复成模板版本？当前的所有改动会被覆盖。`)
  if (!ok) return
  await ws.restoreSkillTemplate(active.value.id, skillName)
}

async function toggleSkillDisabled(skillName: string, currentDisabled: boolean): Promise<void> {
  if (!active.value) return
  const next = !currentDisabled
  if (next) {
    const ok = window.confirm(`确定禁用 ${skillName}？AI 工作流将不再加载它，可随时启用。`)
    if (!ok) return
  }
  await ws.setSkillDisabled(active.value.id, skillName, next)
}

async function deleteSkillRow(skill: SkillSummary): Promise<void> {
  if (!active.value) return
  const ok = window.confirm(`确定删除 ${skill.name}？此操作不可撤销。`)
  if (!ok) return
  await ws.deleteSkill(active.value.id, skill.name)
}

function isBuiltinSkill(skillName: string): boolean {
  return BUILTIN_SKILLS.some((item) => item.name === skillName)
}

function skillLabel(skill: SkillSummary): string {
  return BUILTIN_SKILLS.find((item) => item.name === skill.name)?.label
    ?? skill.title
    ?? skill.name
}

function sourceLabel(source: 'app' | 'project'): string {
  if (source === 'app') return 'App 内置'
  return '项目自带'
}

function refreshIfApplicable(): void {
  const a = active.value
  if (!a) return
  if (a.kind !== 'project' && a.kind !== 'ux') return
  void ws.refreshSkills(a.id)
}

function refreshPanel(): void {
  refreshIfApplicable()
}

onMounted(refreshPanel)

watch(() => active.value?.id, refreshPanel)

// 关闭编辑器后若刚才编辑的是 skill，刷新一下让 hasUserEdits 同步
watch(() => editor.isOpen, (open) => {
  if (open) return
  if (!lastEditedSkillRelPath) return
  refreshIfApplicable()
  lastEditedSkillRelPath = null
})
</script>

<template>
  <section class="skills-list">
    <header class="skills-list__head">
      <div class="skills-list__head-top">
        <h3 class="skills-list__title"><Sparkles :size="16" aria-hidden="true" /> 技能</h3>
        <div class="skills-list__head-actions">
          <button
            type="button"
            class="skills-list__head-btn"
            :class="{ 'is-active': addOpen }"
            @click="addOpen = !addOpen"
          >{{ addOpen ? '收起' : '+ 添加' }}</button>
        </div>
      </div>
      <p class="skills-list__desc">每个 Skill 都是一个文件夹，SKILL.md 是入口；说明、脚本和资源文件会一起安装和使用。</p>

      <AddSkillForm v-if="addOpen" @done="addOpen = false" />
    </header>

    <div v-if="loading" class="skills-list__loading">正在加载已安装 Skill…</div>

    <section v-else-if="skills.length > 0" class="skills-list__group">
      <div class="skills-list__group-head">
        <h4>已安装</h4>
        <span>{{ skills.length }} 个 Skill</span>
      </div>
      <ul class="skills-list__cards">
        <li
          v-for="skill in skills"
          :key="skill.name"
          class="skills-list__card"
          :class="{ 'is-disabled': skill.disabled }"
        >
          <div class="skills-list__card-head">
            <span
              class="skills-list__badge"
              :data-source="skill.source"
              :title="skill.source === 'app' ? 'App 内置模板同步' : '项目自带，模板未声明'"
            >{{ sourceLabel(skill.source) }}</span>
            <div class="skills-list__statuses">
              <span v-if="skill.quickInvocation" class="skills-list__quick-status">快捷调用</span>
              <span v-if="skill.disabled" class="skills-list__status">已禁用</span>
              <span v-else-if="skill.hasUserEdits" class="skills-list__status">已修改</span>
            </div>
          </div>
          <div class="skills-list__main">
            <span class="skills-list__name"><span class="skills-list__symbol" aria-hidden="true"><component :is="skill.name === 'ux-design' ? Palette : skill.name === 'knowledge-search' ? ScanSearch : skill.name === 'prd-tech-review' ? ClipboardCheck : Sparkles" :size="16" /></span>{{ skillLabel(skill) }}</span>
            <span class="skills-list__code" :title="skill.skillDirRelPath"><Folder :size="12" aria-hidden="true" /> {{ skill.skillDirRelPath }}</span>
            <span class="skills-list__sub">
              <template v-if="skill.description">{{ skill.description }}</template>
              <template v-else><em>未填 description</em></template>
            </span>
            <span v-if="skill.quickInvocation && skill.defaultPrompt" class="skills-list__prompt">
              默认提示词：{{ skill.defaultPrompt }}
            </span>
          </div>
          <div class="skills-list__actions">
            <button
              type="button"
              class="skills-list__action"
              title="打开 Skill 文件夹并编辑其中的文件"
              @click="openSkillEditor(skill.skillRelPath)"
            >编辑文件夹</button>
            <button
              type="button"
              class="skills-list__action"
              :disabled="skill.source !== 'app' || !skill.hasUserEdits"
              :title="skill.source !== 'app' ? '只有 App 内置 skill 才能恢复模板' : skill.hasUserEdits ? '把改动覆盖回模板版本' : '当前与模板一致，无需恢复'"
              @click="restoreSkill(skill.name)"
            >恢复模板</button>
            <button
              type="button"
              class="skills-list__action"
              :title="skill.disabled ? '启用后 AI 会重新加载这个 skill' : 'AI 将不再加载这个 skill，可随时启用'"
              @click="toggleSkillDisabled(skill.name, skill.disabled)"
            >{{ skill.disabled ? '启用' : '禁用' }}</button>
            <button
              v-if="!isBuiltinSkill(skill.name)"
              type="button"
              class="skills-list__action skills-list__action--danger"
              title="从工作区移除此 skill，硬删两份目录"
              @click="deleteSkillRow(skill)"
            >删除</button>
          </div>
        </li>
      </ul>
    </section>

    <div v-else class="skills-list__empty">
      <PlantIllustration kind="skills" />
      <p>还没有 skills</p>
      <div class="skills-list__empty-actions">
        <button type="button" class="skills-list__head-btn" @click="addOpen = true">+ 添加 skill</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.skills-list { display: flex; flex-direction: column; gap: 12px; }
.skills-list__head { display: flex; flex-direction: column; gap: 8px; }
.skills-list__head-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.skills-list__title {
  margin: 0;
  display: flex; align-items: center; gap: 6px;
  font-size: 14px; font-weight: 600; color: var(--color-text-primary);
}
.skills-list__head-actions { display: flex; gap: 6px; }
.skills-list__head-btn {
  height: 26px; padding: 0 10px;
  border: 1px solid var(--color-accent-border); border-radius: 6px;
  background: var(--color-accent-light); font-size: 12px; color: var(--color-accent-pressed);
  cursor: pointer;
}
.skills-list__head-btn:hover { background: var(--color-accent-subtle); }
.skills-list__head-btn.is-active { background: var(--color-accent-subtle); border-color: var(--color-accent); color: var(--color-accent-pressed); }
.skills-list__desc { margin: 0; font-size: 12px; color: var(--color-text-secondary); }


.skills-list__group { display: flex; flex-direction: column; gap: 8px; }
.skills-list__group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.skills-list__group-head h4 { margin: 0; font-size: 12px; font-weight: 600; color: var(--color-text-primary); }
.skills-list__group-head span { font-size: 11px; color: var(--color-text-tertiary); }
.skills-list__cards {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px;
}
.skills-list__card {
  min-width: 0;
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-base);
  transition: border-color 160ms ease, background-color 160ms ease;
}
.skills-list__card:hover { border-color: var(--color-accent-border); }
.skills-list__card.is-disabled { opacity: 0.65; }
.skills-list__card.is-disabled .skills-list__name { text-decoration: line-through; }
.skills-list__card-head { min-height: 26px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.skills-list__statuses { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }

.skills-list__badge {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  height: 22px; padding: 0 8px;
  border-radius: 4px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.skills-list__badge[data-source='app'] { background: var(--color-accent-subtle); color: var(--color-accent-pressed); }
.skills-list__badge[data-source='project'] { background: var(--color-bg-elevated); color: var(--color-text-secondary); }
.skills-list__main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.skills-list__name {
  font-size: 14px; font-weight: 600; color: var(--color-text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.skills-list__code {
  font-family: SF Mono, Menlo, Consolas, monospace;
  font-size: 11px; color: var(--color-text-tertiary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.skills-list__sub {
  min-height: 34px;
  font-size: 12px; line-height: 1.45; color: var(--color-text-secondary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.skills-list__status { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--color-warning); }
.skills-list__quick-status {
  border-radius: 999px;
  background: var(--color-accent-light);
  padding: 2px 7px;
  color: var(--color-accent-pressed);
  font-size: 10px;
  font-weight: 600;
}
.skills-list__prompt {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skills-list__actions {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding-top: 10px; border-top: 1px solid var(--color-border-subtle);
}
.skills-list__action {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-base);
  padding: 4px 10px;
  font-size: 12px; color: var(--color-text-primary);
  cursor: pointer;
}
.skills-list__action:hover:not(:disabled) { background: var(--color-bg-elevated); }
.skills-list__action:disabled { color: var(--color-text-tertiary); cursor: not-allowed; background: var(--color-bg-subtle); }
.skills-list__action--danger { color: #d92d20; border-color: #f4cdc9; }
.skills-list__action--danger:hover:not(:disabled) { background: #fef0ee; }
.skills-list__loading {
  padding: 12px; border: 1px solid var(--color-border-subtle); border-radius: 8px;
  background: var(--color-bg-subtle); color: var(--color-text-secondary);
  font-size: 12px; text-align: center;
}

.skills-list__empty {
  display: flex; flex-direction: column; gap: 8px; align-items: center;
  padding: 24px; border: 1px dashed var(--color-accent-border); border-radius: 8px;
  background: var(--color-bg-subtle); color: var(--color-text-secondary);
  font-size: 13px; text-align: center;
}
.skills-list__empty p { margin: 0; }
.skills-list__empty-actions { display: flex; gap: 8px; }

@media (prefers-reduced-motion: reduce) {
  .skills-list__card { transition: none; }
}
.skills-list__title svg { color: var(--color-leaf); }
.skills-list__name { display: flex; align-items: center; gap: 8px; }
.skills-list__symbol { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; background: var(--color-accent-light); color: var(--color-leaf); flex: none; }
.skills-list__code svg { display: inline; vertical-align: -2px; margin-right: 4px; }
</style>
