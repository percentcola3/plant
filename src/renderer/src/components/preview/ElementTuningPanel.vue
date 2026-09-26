<script setup lang="ts">
import { RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-vue-next'

type ElementTuningSelection = {
  alias: string
  path: string
  tagName: string
  textContent: string
  textPreview: string
  styles: {
    color: string
    backgroundColor: string
    fontSize: number
    fontWeight: string
    lineHeight: string
    textAlign: string
    display: string
    flexDirection: string
    flexWrap: string
    justifyContent: string
    alignItems: string
    gap: number
    rowGap: number
    columnGap: number
    flex: string
    flexGrow: string
    flexShrink: string
    flexBasis: string
    order: string
    margin: number
    padding: number
    width: number
    height: number
    borderRadius: number
  }
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
type TunableStyle =
  | 'color'
  | 'background-color'
  | 'font-size'
  | 'font-weight'
  | 'line-height'
  | 'text-align'
  | 'display'
  | 'flex-direction'
  | 'flex-wrap'
  | 'justify-content'
  | 'align-items'
  | 'gap'
  | 'row-gap'
  | 'column-gap'
  | 'flex'
  | 'flex-grow'
  | 'flex-shrink'
  | 'flex-basis'
  | 'order'
  | 'margin'
  | 'padding'
  | 'width'
  | 'height'
  | 'border-radius'

defineProps<{
  selection: ElementTuningSelection | null
  saveState: SaveState
}>()

const emit = defineEmits<{
  close: []
  'apply-text': [value: string]
  'apply-style': [property: TunableStyle, value: string]
  reset: []
  'delete-element': []
}>()

const saveStateText: Record<SaveState, string> = {
  idle: '',
  pending: '等待保存',
  saving: '保存中',
  saved: '已保存',
  error: '保存失败',
}

function applyColor(property: 'color' | 'background-color', event: Event): void {
  emit('apply-style', property, (event.target as HTMLInputElement).value)
}

function applyLength(
  property: Extract<TunableStyle, 'font-size' | 'gap' | 'row-gap' | 'column-gap' | 'margin' | 'padding' | 'width' | 'height' | 'border-radius'>,
  event: Event,
): void {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '') return
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  emit('apply-style', property, `${value}px`)
}

function applyText(event: Event): void {
  emit('apply-text', (event.target as HTMLTextAreaElement).value)
}

function applyRaw(property: TunableStyle, event: Event): void {
  emit('apply-style', property, (event.target as HTMLInputElement | HTMLSelectElement).value)
}
</script>

<template>
  <aside class="element-tuning-panel" aria-label="元素微调面板">
    <header class="element-tuning-panel__header">
      <div class="element-tuning-panel__heading">
        <SlidersHorizontal aria-hidden="true" />
        <div>
          <h2>元素微调</h2>
          <p v-if="selection">@{{ selection.alias }} · {{ selection.tagName }}</p>
          <p v-else>选择画布中的元素</p>
        </div>
      </div>
      <button
        type="button"
        class="element-tuning-panel__icon-btn"
        title="关闭微调面板"
        aria-label="关闭微调面板"
        @click="emit('close')"
      >
        <X aria-hidden="true" />
      </button>
    </header>

    <div v-if="selection" class="element-tuning-panel__body">
      <section class="element-tuning-panel__selection">
        <div class="element-tuning-panel__alias">@{{ selection.alias }}</div>
        <div class="element-tuning-panel__selection-copy">
          <strong>{{ selection.tagName }}</strong>
          <span :title="selection.path">{{ selection.path }}</span>
          <p v-if="selection.textPreview">{{ selection.textPreview }}</p>
        </div>
      </section>

      <section class="element-tuning-panel__group">
        <h3>内容</h3>
        <label class="element-tuning-panel__stack-field">
          <span>文字内容</span>
          <textarea
            :value="selection.textContent"
            rows="3"
            aria-label="文字内容"
            @input="applyText"
          />
        </label>
      </section>

      <section class="element-tuning-panel__group">
        <h3>文字</h3>
        <label class="element-tuning-panel__field">
          <span>颜色</span>
          <span class="element-tuning-panel__color-control">
            <input
              type="color"
              :value="selection.styles.color"
              aria-label="文字颜色"
              @input="applyColor('color', $event)"
            >
            <code>{{ selection.styles.color }}</code>
          </span>
        </label>
        <label class="element-tuning-panel__field">
          <span>字号</span>
          <span class="element-tuning-panel__length-control">
            <input
              type="number"
              min="0"
              :value="selection.styles.fontSize"
              aria-label="字号"
              @input="applyLength('font-size', $event)"
            >
            <span>px</span>
          </span>
        </label>
        <label class="element-tuning-panel__field">
          <span>字重</span>
          <select :value="selection.styles.fontWeight" aria-label="字重" @change="applyRaw('font-weight', $event)">
            <option value="300">300</option>
            <option value="400">400</option>
            <option value="500">500</option>
            <option value="600">600</option>
            <option value="700">700</option>
            <option value="800">800</option>
          </select>
        </label>
        <label class="element-tuning-panel__field">
          <span>行高</span>
          <input
            type="text"
            :value="selection.styles.lineHeight"
            aria-label="行高"
            placeholder="normal / 1.5 / 24px"
            @input="applyRaw('line-height', $event)"
          >
        </label>
        <label class="element-tuning-panel__field">
          <span>对齐</span>
          <select :value="selection.styles.textAlign" aria-label="文字对齐" @change="applyRaw('text-align', $event)">
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
            <option value="justify">两端对齐</option>
            <option value="start">起始</option>
            <option value="end">末尾</option>
          </select>
        </label>
      </section>

      <section class="element-tuning-panel__group">
        <h3>外观</h3>
        <label class="element-tuning-panel__field">
          <span>背景</span>
          <span class="element-tuning-panel__color-control">
            <input
              type="color"
              :value="selection.styles.backgroundColor"
              aria-label="背景颜色"
              @input="applyColor('background-color', $event)"
            >
            <code>{{ selection.styles.backgroundColor }}</code>
          </span>
        </label>
        <label class="element-tuning-panel__field">
          <span>圆角</span>
          <span class="element-tuning-panel__length-control">
            <input
              type="number"
              min="0"
              :value="selection.styles.borderRadius"
              aria-label="元素圆角"
              @input="applyLength('border-radius', $event)"
            >
            <span>px</span>
          </span>
        </label>
      </section>

      <section class="element-tuning-panel__group">
        <h3>布局</h3>
        <label class="element-tuning-panel__field">
          <span>显示</span>
          <select :value="selection.styles.display" aria-label="display" @change="applyRaw('display', $event)">
            <option value="block">block</option>
            <option value="inline-block">inline-block</option>
            <option value="flex">flex</option>
            <option value="inline-flex">inline-flex</option>
            <option value="grid">grid</option>
            <option value="none">none</option>
          </select>
        </label>
        <label class="element-tuning-panel__field">
          <span>主轴</span>
          <select :value="selection.styles.justifyContent" aria-label="主轴对齐" @change="applyRaw('justify-content', $event)">
            <option value="flex-start">flex-start</option>
            <option value="center">center</option>
            <option value="flex-end">flex-end</option>
            <option value="space-between">space-between</option>
            <option value="space-around">space-around</option>
            <option value="space-evenly">space-evenly</option>
          </select>
        </label>
        <label class="element-tuning-panel__field">
          <span>交叉轴</span>
          <select :value="selection.styles.alignItems" aria-label="交叉轴对齐" @change="applyRaw('align-items', $event)">
            <option value="stretch">stretch</option>
            <option value="flex-start">flex-start</option>
            <option value="center">center</option>
            <option value="flex-end">flex-end</option>
            <option value="baseline">baseline</option>
          </select>
        </label>
        <label class="element-tuning-panel__field">
          <span>方向</span>
          <select :value="selection.styles.flexDirection" aria-label="Flex 方向" @change="applyRaw('flex-direction', $event)">
            <option value="row">row</option>
            <option value="row-reverse">row-reverse</option>
            <option value="column">column</option>
            <option value="column-reverse">column-reverse</option>
          </select>
        </label>
        <label class="element-tuning-panel__field">
          <span>换行</span>
          <select :value="selection.styles.flexWrap" aria-label="Flex 换行" @change="applyRaw('flex-wrap', $event)">
            <option value="nowrap">nowrap</option>
            <option value="wrap">wrap</option>
            <option value="wrap-reverse">wrap-reverse</option>
          </select>
        </label>
      </section>

      <section class="element-tuning-panel__group">
        <h3>Flex 子项</h3>
        <label class="element-tuning-panel__field">
          <span>flex</span>
          <input
            type="text"
            :value="selection.styles.flex"
            aria-label="flex"
            placeholder="0 1 auto"
            @input="applyRaw('flex', $event)"
          >
        </label>
        <label class="element-tuning-panel__field">
          <span>grow</span>
          <input type="number" step="1" :value="selection.styles.flexGrow" aria-label="flex-grow" @input="applyRaw('flex-grow', $event)">
        </label>
        <label class="element-tuning-panel__field">
          <span>shrink</span>
          <input type="number" step="1" :value="selection.styles.flexShrink" aria-label="flex-shrink" @input="applyRaw('flex-shrink', $event)">
        </label>
        <label class="element-tuning-panel__field">
          <span>basis</span>
          <input
            type="text"
            :value="selection.styles.flexBasis"
            aria-label="flex-basis"
            placeholder="auto / 120px"
            @input="applyRaw('flex-basis', $event)"
          >
        </label>
        <label class="element-tuning-panel__field">
          <span>order</span>
          <input type="number" step="1" :value="selection.styles.order" aria-label="order" @input="applyRaw('order', $event)">
        </label>
      </section>

      <section class="element-tuning-panel__group">
        <h3>间距</h3>
        <label class="element-tuning-panel__field">
          <span>gap</span>
          <span class="element-tuning-panel__length-control">
            <input type="number" min="0" :value="selection.styles.gap" aria-label="gap" @input="applyLength('gap', $event)">
            <span>px</span>
          </span>
        </label>
        <label class="element-tuning-panel__field">
          <span>row gap</span>
          <span class="element-tuning-panel__length-control">
            <input type="number" min="0" :value="selection.styles.rowGap" aria-label="row gap" @input="applyLength('row-gap', $event)">
            <span>px</span>
          </span>
        </label>
        <label class="element-tuning-panel__field">
          <span>column gap</span>
          <span class="element-tuning-panel__length-control">
            <input type="number" min="0" :value="selection.styles.columnGap" aria-label="column gap" @input="applyLength('column-gap', $event)">
            <span>px</span>
          </span>
        </label>
        <label class="element-tuning-panel__field">
          <span>padding</span>
          <span class="element-tuning-panel__length-control">
            <input type="number" min="0" :value="selection.styles.padding" aria-label="padding" @input="applyLength('padding', $event)">
            <span>px</span>
          </span>
        </label>
        <label class="element-tuning-panel__field">
          <span>margin</span>
          <span class="element-tuning-panel__length-control">
            <input type="number" min="0" :value="selection.styles.margin" aria-label="margin" @input="applyLength('margin', $event)">
            <span>px</span>
          </span>
        </label>
      </section>

      <section class="element-tuning-panel__group">
        <h3>尺寸</h3>
        <label class="element-tuning-panel__field">
          <span>宽度</span>
          <span class="element-tuning-panel__length-control">
            <input
              type="number"
              min="0"
              :value="selection.styles.width"
              aria-label="元素宽度"
              @input="applyLength('width', $event)"
            >
            <span>px</span>
          </span>
        </label>
        <label class="element-tuning-panel__field">
          <span>高度</span>
          <span class="element-tuning-panel__length-control">
            <input
              type="number"
              min="0"
              :value="selection.styles.height"
              aria-label="元素高度"
              @input="applyLength('height', $event)"
            >
            <span>px</span>
          </span>
        </label>
      </section>
    </div>

    <div v-else class="element-tuning-panel__empty">
      <SlidersHorizontal aria-hidden="true" />
      <strong>选择一个元素开始微调</strong>
      <p>面板会根据当前元素更新可调整的内容。</p>
    </div>

    <footer v-if="selection" class="element-tuning-panel__footer">
      <span
        class="element-tuning-panel__save-state"
        :class="`is-${saveState}`"
        aria-live="polite"
      >{{ saveStateText[saveState] }}</span>
      <button
        type="button"
        class="element-tuning-panel__action"
        title="重置当前元素"
        @click="emit('reset')"
      >
        <RotateCcw aria-hidden="true" />
        重置
      </button>
      <button
        type="button"
        class="element-tuning-panel__action element-tuning-panel__action--danger"
        title="删除当前元素"
        @click="emit('delete-element')"
      >
        <Trash2 aria-hidden="true" />
        删除
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.element-tuning-panel {
  display: flex;
  width: 304px;
  min-width: 304px;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  border-left: 1px solid var(--color-border);
  background: var(--color-bg-panel);
  color: var(--color-text-primary);
}

.element-tuning-panel__header {
  display: flex;
  min-height: 56px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--color-border);
  padding: 10px 12px 10px 14px;
}

.element-tuning-panel__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.element-tuning-panel__heading > svg {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: var(--color-text-secondary);
}

.element-tuning-panel__heading h2,
.element-tuning-panel__heading p {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.element-tuning-panel__heading h2 {
  font-size: 13px;
  font-weight: 600;
}

.element-tuning-panel__heading p {
  margin-top: 2px;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.element-tuning-panel__icon-btn {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.element-tuning-panel__icon-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.element-tuning-panel__icon-btn svg {
  width: 15px;
  height: 15px;
}

.element-tuning-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}

.element-tuning-panel__selection {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  padding: 10px;
}

.element-tuning-panel__alias {
  display: inline-flex;
  height: 22px;
  align-items: center;
  border-radius: 6px;
  background: var(--color-accent);
  padding: 0 7px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.element-tuning-panel__selection-copy {
  min-width: 0;
}

.element-tuning-panel__selection-copy strong,
.element-tuning-panel__selection-copy span,
.element-tuning-panel__selection-copy p {
  display: block;
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.element-tuning-panel__selection-copy strong {
  font-size: 12px;
}

.element-tuning-panel__selection-copy span,
.element-tuning-panel__selection-copy p {
  margin-top: 3px;
  color: var(--color-text-tertiary);
  font-size: 10px;
}

.element-tuning-panel__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 18px;
}

.element-tuning-panel__group h3 {
  margin: 0 0 2px;
  color: var(--color-text-tertiary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.element-tuning-panel__field {
  display: grid;
  min-height: 32px;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.element-tuning-panel__stack-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.element-tuning-panel__field input[type="text"],
.element-tuning-panel__field input[type="number"],
.element-tuning-panel__field select,
.element-tuning-panel__stack-field textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  font-size: 12px;
  outline: none;
}

.element-tuning-panel__field input[type="text"],
.element-tuning-panel__field input[type="number"],
.element-tuning-panel__field select {
  height: 28px;
  padding: 0 8px;
}

.element-tuning-panel__stack-field textarea {
  min-height: 68px;
  resize: vertical;
  padding: 7px 8px;
  line-height: 1.45;
}

.element-tuning-panel__field input:focus,
.element-tuning-panel__field select:focus,
.element-tuning-panel__stack-field textarea:focus {
  border-color: var(--color-accent);
}

.element-tuning-panel__color-control,
.element-tuning-panel__length-control {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.element-tuning-panel__color-control input {
  width: 34px;
  height: 26px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  padding: 2px;
  cursor: pointer;
}

.element-tuning-panel__color-control code {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 10px;
  text-overflow: ellipsis;
}

.element-tuning-panel__length-control input {
  width: 100%;
  min-width: 0;
  height: 28px;
}

.element-tuning-panel__length-control > span {
  color: var(--color-text-tertiary);
  font-size: 10px;
}

.element-tuning-panel__empty {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px;
  text-align: center;
}

.element-tuning-panel__empty svg {
  width: 24px;
  height: 24px;
  margin-bottom: 12px;
  color: var(--color-text-tertiary);
}

.element-tuning-panel__empty strong {
  font-size: 12px;
  font-weight: 600;
}

.element-tuning-panel__empty p {
  max-width: 210px;
  margin: 6px 0 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1.5;
}

.element-tuning-panel__footer {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--color-border);
  padding: 8px 10px;
}

.element-tuning-panel__save-state {
  min-width: 0;
  flex: 1 1 auto;
  color: var(--color-text-tertiary);
  font-size: 10px;
}

.element-tuning-panel__save-state.is-saved {
  color: #22c55e;
}

.element-tuning-panel__save-state.is-error {
  color: #ef4444;
}

.element-tuning-panel__action {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  padding: 0 8px;
  color: var(--color-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.element-tuning-panel__action:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.element-tuning-panel__action svg {
  width: 13px;
  height: 13px;
}

.element-tuning-panel__action--danger {
  color: #ef4444;
}
</style>
