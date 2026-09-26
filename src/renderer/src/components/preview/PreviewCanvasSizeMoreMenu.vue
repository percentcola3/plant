<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Ellipsis } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  WORKBENCH_CANVAS_PRESETS,
  WORKBENCH_CUSTOM_DEVICE_PRESET,
  getCurrentDisplayPreviewSize,
  isWorkbenchCanvasMoreActive,
  isWorkbenchCanvasPresetActive,
  type ProductPreviewMeta,
} from '@/lib/preview/product-preview'
import { usePreviewStore, DEVICE_PRESETS } from '@/stores/preview'

const props = defineProps<{
  tabId: string
  meta: ProductPreviewMeta
}>()

const previewStore = usePreviewStore()
const menuOpen = ref(false)

const moreActive = computed(() => isWorkbenchCanvasMoreActive(props.meta))
const rotated = computed(() => props.meta.rotate)
const displayWidth = computed(() => (rotated.value ? props.meta.deviceHeight : props.meta.deviceWidth))
const displayHeight = computed(() => (rotated.value ? props.meta.deviceWidth : props.meta.deviceHeight))

function presetEmoji(type: 'mobile' | 'tablet' | 'desktop'): string {
  if (type === 'mobile' || type === 'tablet') return '📱'
  return '🖥'
}

function isNamedPresetActive(name: string): boolean {
  if (name === '响应式') return props.meta.responsive
  if (props.meta.responsive) return false
  return props.meta.devicePreset === name
}

function isCustomPresetActive(): boolean {
  if (props.meta.responsive) return false
  if (WORKBENCH_CANVAS_PRESETS.some(preset => isWorkbenchCanvasPresetActive(props.meta, preset))) return false
  if (DEVICE_PRESETS.some(preset => preset.name !== '响应式' && isNamedPresetActive(preset.name))) return false
  return true
}

function syncResponsiveDisplaySize(): void {
  if (!props.meta.responsive) return
  const size = getCurrentDisplayPreviewSize()
  if (props.meta.deviceWidth === size.width && props.meta.deviceHeight === size.height) return
  previewStore.updateDevice(props.tabId, {
    deviceWidth: size.width,
    deviceHeight: size.height,
  })
}

function applyNamedPreset(name: string): void {
  const preset = DEVICE_PRESETS.find(item => item.name === name)
  if (!preset) return
  if (preset.name === '响应式') {
    const size = getCurrentDisplayPreviewSize()
    previewStore.updateDevice(props.tabId, {
      devicePreset: preset.name,
      deviceWidth: size.width,
      deviceHeight: size.height,
      responsive: true,
      rotate: false,
    })
    return
  }
  previewStore.updateDevice(props.tabId, {
    devicePreset: preset.name,
    deviceWidth: preset.width,
    deviceHeight: preset.height,
    responsive: false,
    rotate: false,
  })
}

function onWidthChange(event: Event): void {
  const val = parseInt((event.target as HTMLInputElement).value, 10)
  if (Number.isNaN(val)) return
  const slot = props.meta.rotate ? 'deviceHeight' : 'deviceWidth'
  previewStore.updateDevice(props.tabId, {
    [slot]: val,
    devicePreset: WORKBENCH_CUSTOM_DEVICE_PRESET,
    responsive: false,
  })
}

function onHeightChange(event: Event): void {
  const val = parseInt((event.target as HTMLInputElement).value, 10)
  if (Number.isNaN(val)) return
  const slot = props.meta.rotate ? 'deviceWidth' : 'deviceHeight'
  previewStore.updateDevice(props.tabId, {
    [slot]: val,
    devicePreset: WORKBENCH_CUSTOM_DEVICE_PRESET,
    responsive: false,
  })
}

function toggleRotate(): void {
  previewStore.updateDevice(props.tabId, { rotate: !props.meta.rotate })
}

onMounted(() => {
  syncResponsiveDisplaySize()
  window.addEventListener('resize', syncResponsiveDisplaySize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncResponsiveDisplaySize)
})

watch(() => props.meta.responsive, (responsive) => {
  if (responsive) syncResponsiveDisplaySize()
})
</script>

<template>
  <DropdownMenu v-model:open="menuOpen">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="product-workbench-icon-btn preview-canvas-size-toggle__btn"
        :class="{ 'is-active': moreActive || menuOpen }"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        aria-label="更多画布尺寸"
        title="更多画布尺寸"
        @click.stop
      >
        <Ellipsis aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="center"
      class="preview-canvas-size-more min-w-[240px] p-0 text-xs"
      @pointerdown.stop
    >
      <div class="preview-canvas-size-more__section preview-canvas-size-more__custom">
        <div class="preview-canvas-size-more__heading">自定义</div>
        <div
          class="preview-canvas-size-more__inputs"
          :class="{ 'preview-canvas-size-more__inputs--active': isCustomPresetActive() }"
        >
          <span class="preview-canvas-size-more__field-label">分辨率</span>
          <input
            type="number"
            class="preview-canvas-size-more__input"
            :value="displayWidth"
            min="0"
            placeholder="宽"
            aria-label="自定义宽度"
            @change="onWidthChange"
          >
          <span class="preview-canvas-size-more__multiply">×</span>
          <input
            type="number"
            class="preview-canvas-size-more__input"
            :value="displayHeight"
            min="0"
            placeholder="高"
            aria-label="自定义高度"
            @change="onHeightChange"
          >
          <button
            type="button"
            class="preview-canvas-size-more__rotate"
            :class="{ 'is-active': rotated }"
            title="旋转（宽高互换）"
            aria-label="旋转画布"
            @click="toggleRotate"
          >
            ↻
          </button>
        </div>
      </div>

      <DropdownMenuSeparator class="my-0" />

      <div class="preview-canvas-size-more__section preview-canvas-size-more__presets">
        <div class="preview-canvas-size-more__heading">预设</div>
        <DropdownMenuItem
          v-for="preset in DEVICE_PRESETS"
          :key="preset.name"
          class="preview-canvas-size-more__item text-xs"
          :class="{ 'preview-canvas-size-more__item--active': isNamedPresetActive(preset.name) }"
          @select="applyNamedPreset(preset.name)"
        >
          <span class="preview-canvas-size-more__emoji" aria-hidden="true">{{ presetEmoji(preset.type) }}</span>
          <span class="preview-canvas-size-more__label">{{ preset.name }}</span>
          <span
            v-if="preset.width && preset.height"
            class="preview-canvas-size-more__size"
          >
            {{ preset.width }}×{{ preset.height }}
          </span>
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style scoped>
.preview-canvas-size-more__section {
  padding: 6px 0;
}

.preview-canvas-size-more__heading {
  padding: 2px 12px 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.preview-canvas-size-more__item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.preview-canvas-size-more__item--active {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.preview-canvas-size-more__emoji {
  flex: 0 0 auto;
  width: 16px;
  text-align: center;
}

.preview-canvas-size-more__label {
  flex: 1 1 auto;
  min-width: 0;
}

.preview-canvas-size-more__size {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
}

.preview-canvas-size-more__custom {
  padding-top: 6px;
  padding-bottom: 4px;
}

.preview-canvas-size-more__presets {
  padding-bottom: 6px;
}

.preview-canvas-size-more__inputs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--color-bg-subtle);
}

.preview-canvas-size-more__inputs--active {
  border-color: var(--color-border-strong);
  background: var(--color-bg-elevated);
}

.preview-canvas-size-more__field-label {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--color-text-tertiary);
}

.preview-canvas-size-more__input {
  width: 52px;
  height: 26px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  background: var(--color-bg-panel);
  padding: 0 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--color-text-primary);
}

.preview-canvas-size-more__multiply {
  color: var(--color-text-tertiary);
}

.preview-canvas-size-more__rotate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-left: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  background: var(--color-bg-panel);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease),
    border-color var(--duration-fast, 120ms) var(--ease-out, ease);
}

.preview-canvas-size-more__rotate:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-strong);
}

.preview-canvas-size-more__rotate.is-active {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
}
</style>
