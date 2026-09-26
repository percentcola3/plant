<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import {
  buildInteractionResponse,
  isClaudeInteractionAnswerResult,
  type ClaudeInteraction
} from '@shared/claude-interactions'

const props = defineProps<{
  interaction: ClaudeInteraction
  toolUseId: string
  result?: { content: unknown; isError?: boolean }
  disabled?: boolean
}>()
const emit = defineEmits<{
  submit: [payload: { toolUseId: string; text: string }]
}>()

const selections = ref(new Map<string, Set<string>>())
const otherActive = ref(new Map<string, boolean>())
const otherTexts = ref(new Map<string, string>())
const note = ref('')
const currentStep = ref(0)
const containerRef = ref<HTMLDivElement | null>(null)
const otherInputRef = ref<HTMLInputElement | null>(null)

const total = computed(() => props.interaction.questions.length)
const step = computed(() => Math.min(currentStep.value, Math.max(0, total.value - 1)))
const currentQuestion = computed(() => props.interaction.questions[step.value])
const isLast = computed(() => step.value === total.value - 1)
const answered = computed(() =>
  !!props.result && isClaudeInteractionAnswerResult(props.interaction, props.result.content)
)

const answeredText = computed(() => {
  if (!props.result || !answered.value) return ''
  return typeof props.result.content === 'string'
    ? props.result.content
    : JSON.stringify(props.result.content, null, 2)
})

function selectionOf(qId: string): Set<string> {
  return selections.value.get(qId) ?? new Set()
}
function isSelected(qId: string, label: string): boolean {
  return selectionOf(qId).has(label)
}
function isOtherOn(qId: string): boolean {
  return otherActive.value.get(qId) === true
}
function otherText(qId: string): string {
  return otherTexts.value.get(qId) ?? ''
}

function toggleOption(qId: string, label: string, multi: boolean): void {
  const nextSel = new Map(selections.value)
  const cur = new Set(nextSel.get(qId) ?? [])
  if (multi) {
    if (cur.has(label)) cur.delete(label); else cur.add(label)
  } else {
    cur.clear()
    cur.add(label)
    const oa = new Map(otherActive.value); oa.set(qId, false); otherActive.value = oa
  }
  nextSel.set(qId, cur)
  selections.value = nextSel
}

function toggleOther(qId: string, multi: boolean): void {
  const oa = new Map(otherActive.value)
  const wasOn = oa.get(qId) === true
  oa.set(qId, !wasOn)
  otherActive.value = oa
  if (!multi && !wasOn) {
    const sel = new Map(selections.value); sel.set(qId, new Set()); selections.value = sel
  }
  if (!wasOn) nextTick(() => otherInputRef.value?.focus())
}

function setOtherText(qId: string, text: string): void {
  const ot = new Map(otherTexts.value); ot.set(qId, text); otherTexts.value = ot
}

function answersForQuestion(qId: string): string[] {
  const q = props.interaction.questions.find(x => x.id === qId)
  if (!q) return []
  if (q.options.length === 0) {
    const t = otherText(qId).trim()
    return t ? [t] : []
  }
  const list = Array.from(selectionOf(qId))
  if (isOtherOn(qId)) {
    const t = otherText(qId).trim()
    if (t) list.push(t)
  }
  return list
}

const canAdvance = computed(() => {
  if (props.disabled || answered.value) return false
  return answersForQuestion(currentQuestion.value.id).length > 0
})

function buildAllAnswers(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const q of props.interaction.questions) out[q.id] = answersForQuestion(q.id)
  return out
}

function submit(): void {
  if (!canAdvance.value) return
  const text = buildInteractionResponse(props.interaction, buildAllAnswers(), note.value)
  emit('submit', { toolUseId: props.toolUseId, text })
}
function next(): void {
  if (!canAdvance.value) return
  if (isLast.value) submit()
  else currentStep.value = step.value + 1
}
function prev(): void {
  if (step.value > 0) currentStep.value = step.value - 1
}

function onKeydown(e: KeyboardEvent): void {
  if (props.disabled || answered.value) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  const q = currentQuestion.value
  if (!q) return
  const num = parseInt(e.key, 10)
  if (!Number.isNaN(num)) {
    if (num >= 1 && num <= Math.min(9, q.options.length)) {
      e.preventDefault()
      toggleOption(q.id, q.options[num - 1].label, q.multiSelect)
      return
    }
    if (num === 0 && q.options.length > 0) {
      e.preventDefault()
      toggleOther(q.id, q.multiSelect)
      return
    }
  }
  if (e.key === 'Enter') { e.preventDefault(); next() }
  else if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault(); prev()
  }
}

watch(step, () => nextTick(() => containerRef.value?.focus()))
onMounted(() => nextTick(() => containerRef.value?.focus()))
</script>

<template>
  <div
    class="interaction-card"
    :class="{ 'interaction-card--answered': answered }"
    ref="containerRef"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <div class="ic-head">
      <span class="ic-title">{{ interaction.title }}</span>
      <span v-if="!answered && total > 1" class="ic-step">{{ step + 1 }} / {{ total }}</span>
    </div>

    <template v-if="answered">
      <div class="ic-result-label">已提交</div>
      <pre class="ic-result">{{ answeredText }}</pre>
    </template>

    <template v-else>
      <div class="ic-question">
        <div class="ic-question-label">{{ currentQuestion.label }}</div>
        <div class="ic-question-text">
          {{ currentQuestion.question }}
          <span v-if="currentQuestion.multiSelect" class="ic-multi-tag">可多选</span>
        </div>

        <div v-if="currentQuestion.options.length > 0" class="ic-options">
          <button
            v-for="(opt, idx) in currentQuestion.options.slice(0, 9)"
            :key="opt.label"
            class="ic-option"
            :class="{ 'ic-option--selected': isSelected(currentQuestion.id, opt.label) }"
            :disabled="disabled"
            @click="toggleOption(currentQuestion.id, opt.label, currentQuestion.multiSelect)"
          >
            <span class="ic-key">{{ idx + 1 }}</span>
            <span class="ic-option-body">
              <span class="ic-option-label">{{ opt.label }}</span>
              <span v-if="opt.description" class="ic-option-desc">{{ opt.description }}</span>
            </span>
          </button>
          <button
            class="ic-option ic-option--other"
            :class="{ 'ic-option--selected': isOtherOn(currentQuestion.id) }"
            :disabled="disabled"
            @click="toggleOther(currentQuestion.id, currentQuestion.multiSelect)"
          >
            <span class="ic-key">0</span>
            <span class="ic-option-body">
              <span class="ic-option-label">其他（自定义）</span>
            </span>
          </button>
          <input
            v-if="isOtherOn(currentQuestion.id)"
            ref="otherInputRef"
            class="ic-other-input"
            :value="otherText(currentQuestion.id)"
            placeholder="输入自定义答案"
            :disabled="disabled"
            @input="setOtherText(currentQuestion.id, ($event.target as HTMLInputElement).value)"
            @keydown.enter.stop="next"
          />
        </div>

        <textarea
          v-else
          :value="otherText(currentQuestion.id)"
          class="ic-textarea"
          rows="2"
          :disabled="disabled"
          placeholder="请填写"
          @input="setOtherText(currentQuestion.id, ($event.target as HTMLTextAreaElement).value)"
        />
      </div>

      <textarea
        v-model="note"
        class="ic-textarea"
        rows="2"
        :disabled="disabled"
        placeholder="补充说明（可选）"
      />

      <div class="ic-actions">
        <span class="ic-hint">
          <kbd>1-9</kbd> 选 · <kbd>0</kbd> 自定义 · <kbd>Enter</kbd> {{ isLast ? '提交' : '下一题' }}
        </span>
        <span class="ic-actions-right">
          <button v-if="step > 0" class="ic-btn-secondary" :disabled="disabled" @click="prev">上一题</button>
          <button class="ic-submit" :disabled="!canAdvance" @click="next">
            {{ isLast ? '提交给 Claude' : '下一题' }}
          </button>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.interaction-card {
  margin: 8px 0;
  padding: 12px;
  border: 1px solid var(--color-accent-subtle);
  border-radius: 8px;
  background: var(--color-accent-subtle);
  outline: none;
}
.interaction-card:focus-visible { box-shadow: 0 0 0 2px rgba(37,99,235,0.18); }
.interaction-card--answered { border-color: #d1d5db; background: #f9fafb; }
.ic-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ic-title { font-size: 13px; font-weight: 600; color: var(--color-accent-pressed); }
.ic-step {
  font-size: 11px; color: var(--color-accent-pressed);
  background: var(--color-accent-subtle); border-radius: 999px; padding: 2px 8px;
}
.ic-question { margin: 10px 0; }
.ic-question-label { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.ic-question-text { font-size: 13px; color: var(--color-text-primary); margin-top: 2px; }
.ic-multi-tag {
  margin-left: 6px; font-size: 11px; color: #047857;
  background: #d1fae5; border-radius: 4px; padding: 1px 6px;
}
.ic-options { display: grid; gap: 6px; margin-top: 8px; }
.ic-option {
  display: flex; align-items: stretch; gap: 0;
  padding: 0; border: 1px solid var(--color-border); border-radius: 6px;
  background: #fff; color: var(--color-text-primary); text-align: left; cursor: pointer;
  overflow: hidden;
}
.ic-option:hover:not(:disabled) { border-color: #60a5fa; }
.ic-option--selected { border-color: var(--color-accent); background: var(--color-accent-subtle); }
.ic-option--other { border-style: dashed; }
.ic-key {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; flex-shrink: 0;
  background: var(--color-bg-subtle); color: var(--color-text-secondary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px; font-weight: 600;
  border-right: 1px solid var(--color-border-border/60);
}
.ic-option--selected .ic-key { background: var(--color-accent-subtle); color: var(--color-accent-pressed); border-right-color: #93c5fd; }
.ic-option-body { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; min-width: 0; }
.ic-option-label { font-size: 13px; font-weight: 600; }
.ic-option-desc { font-size: 12px; color: var(--color-text-secondary); }
.ic-other-input {
  margin-top: 2px; padding: 8px 10px; border: 1px solid #93c5fd;
  border-radius: 6px; background: #fff; color: var(--color-text-primary); font-size: 13px;
}
.ic-textarea {
  width: 100%; margin-top: 8px; padding: 8px 10px;
  border: 1px solid var(--color-border); border-radius: 6px;
  background: #fff; color: var(--color-text-primary); font-size: 13px; line-height: 1.5; resize: vertical;
}
.ic-actions {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-top: 10px;
}
.ic-hint { font-size: 11px; color: var(--color-text-secondary); }
.ic-hint kbd {
  font-family: 'SF Mono', Menlo, monospace; font-size: 11px;
  background: #fff; border: 1px solid var(--color-border); border-bottom-width: 2px;
  border-radius: 3px; padding: 0 4px; color: var(--color-text-secondary);
}
.ic-actions-right { display: inline-flex; gap: 6px; }
.ic-submit {
  padding: 6px 12px; border: 0; border-radius: 6px;
  background: var(--color-button-bg); color: var(--color-button-fg); font-size: 13px; font-weight: 600; cursor: pointer;
}
.ic-submit:hover:not(:disabled) { background: var(--color-button-bg-hover); }
.ic-submit:disabled { background: var(--color-text-muted); cursor: not-allowed; }
.ic-btn-secondary {
  padding: 6px 10px; border: 1px solid var(--color-border); border-radius: 6px;
  background: var(--color-bg-panel); color: var(--color-text-secondary); font-size: 12px; cursor: pointer;
}
.ic-btn-secondary:hover:not(:disabled) { background: var(--color-bg-panel); }
.ic-result-label { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.ic-result {
  margin: 6px 0 0; padding: 8px 10px; border-radius: 6px;
  background: #fff; color: #334155; font-size: 12px; white-space: pre-wrap;
}
</style>
