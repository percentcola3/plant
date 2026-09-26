<script setup lang="ts">
// 从零新建一个 Skill 文件夹，并在 .claude / .agents 两侧生成入口 SKILL.md。
// 折叠 inline 表单（不弹独立对话框），保持轻量。

import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspacesStore } from '@/stores/workspaces'

const emit = defineEmits<{ (e: 'done'): void }>()

const ws = useWorkspacesStore()
const { active } = storeToRefs(ws)

const name = ref('')
const description = ref('')
const quickInvocation = ref(false)
const defaultPrompt = ref('')
const submitting = ref(false)

const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/
const valid = computed(() =>
  NAME_RE.test(name.value)
  && (!quickInvocation.value || defaultPrompt.value.trim().length > 0)
)
const hint = computed(() => {
  if (!name.value) return ''
  if (!NAME_RE.test(name.value)) return '只能用小写字母 / 数字 / 短横线，2-41 位且以字母开头'
  if (quickInvocation.value && !defaultPrompt.value.trim()) return '快捷调用必须填写默认提示词'
  return ''
})

async function submit(): Promise<void> {
  if (!active.value || !valid.value || submitting.value) return
  submitting.value = true
  try {
    const ok = await ws.createSkill(
      active.value.id,
      name.value,
      description.value.trim() || undefined,
      {
        quickInvocation: quickInvocation.value,
        defaultPrompt: defaultPrompt.value.trim() || undefined
      }
    )
    if (ok) {
      name.value = ''
      description.value = ''
      quickInvocation.value = false
      defaultPrompt.value = ''
      emit('done')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="add-skill-form">
    <div class="add-skill-form__field">
      <label class="add-skill-form__label">name</label>
      <input
        v-model="name"
        class="add-skill-form__input"
        :class="{ 'is-invalid': name && !NAME_RE.test(name) }"
        placeholder="e.g. my-skill"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        @keyup.enter="submit"
      />
    </div>
    <p v-if="hint" class="add-skill-form__hint">{{ hint }}</p>
    <div class="add-skill-form__field">
      <label class="add-skill-form__label">description（可选）</label>
      <input
        v-model="description"
        class="add-skill-form__input"
        placeholder="一句话说清这个 skill 干什么 / 何时触发"
        @keyup.enter="submit"
      />
    </div>
    <label class="add-skill-form__quick-toggle">
      <input v-model="quickInvocation" type="checkbox" />
      <span>
        <strong>快捷调用</strong>
        <small>在 AI 工作面板显示一键调用按钮</small>
      </span>
    </label>
    <div v-if="quickInvocation" class="add-skill-form__field">
      <label class="add-skill-form__label">默认提示词</label>
      <input
        v-model="defaultPrompt"
        class="add-skill-form__input"
        placeholder="例如：检索问答"
        @keyup.enter="submit"
      />
    </div>
    <div class="add-skill-form__actions">
      <button type="button" class="add-skill-form__btn" @click="emit('done')">取消</button>
      <button
        type="button"
        class="add-skill-form__btn add-skill-form__btn--primary"
        :disabled="!valid || submitting"
        @click="submit"
      >{{ submitting ? '创建中…' : '创建 Skill 文件夹' }}</button>
    </div>
  </div>
</template>

<style scoped>
.add-skill-form {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px;
  border: 1px solid #ededf0;
  border-radius: 8px;
  background: #fafafb;
}
.add-skill-form__field { display: flex; flex-direction: column; gap: 4px; }
.add-skill-form__label { font-size: 11px; color: var(--color-text-secondary); font-weight: 600; }
.add-skill-form__input {
  height: 30px;
  padding: 0 10px;
  border: 1px solid #d8d8dc;
  border-radius: 6px;
  font-size: 13px;
  font-family: SF Mono, Menlo, Consolas, monospace;
  background: #fff;
}
.add-skill-form__input.is-invalid { border-color: #d92d20; }
.add-skill-form__input:focus { outline: 2px solid var(--color-info-subtle); border-color: var(--color-accent); }
.add-skill-form__hint { margin: -4px 0 0; font-size: 11px; color: #d92d20; }
.add-skill-form__quick-toggle {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  background: var(--color-bg-panel);
  cursor: pointer;
}
.add-skill-form__quick-toggle input { margin-top: 2px; }
.add-skill-form__quick-toggle span { display: flex; flex-direction: column; gap: 2px; }
.add-skill-form__quick-toggle strong { font-size: 12px; color: var(--color-text-primary); }
.add-skill-form__quick-toggle small { font-size: 11px; color: var(--color-text-secondary); }
.add-skill-form__actions { display: flex; gap: 8px; justify-content: flex-end; }
.add-skill-form__btn {
  height: 28px; padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-panel);
  font-size: 12px; color: var(--color-text-primary);
  cursor: pointer;
}
.add-skill-form__btn:hover:not(:disabled) { background: var(--color-bg-elevated); }
.add-skill-form__btn:disabled { color: var(--color-text-muted); cursor: not-allowed; background: var(--color-bg-subtle); }
.add-skill-form__btn--primary {
  background: var(--color-button-bg); border-color: var(--color-button-bg); color: var(--color-button-fg);
}
.add-skill-form__btn--primary:hover:not(:disabled) { background: var(--color-button-bg-hover); border-color: var(--color-button-bg-hover); }
.add-skill-form__btn--primary:disabled { background: #c0c0c5; border-color: #c0c0c5; color: #fff; }
</style>
