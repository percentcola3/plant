<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import PlantLogo from '@/components/brand/PlantLogo.vue'

withDefaults(defineProps<{
  title: string
  renameDisabled?: boolean
  deleteDisabled?: boolean
}>(), {
  renameDisabled: false,
  deleteDisabled: false,
})

const emit = defineEmits<{
  rename: []
  delete: []
}>()

const menuOpen = ref(false)
const menuEl = ref<HTMLElement | null>(null)

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

function closeMenu(): void {
  menuOpen.value = false
}

function onRename(): void {
  closeMenu()
  emit('rename')
}

function onDelete(): void {
  closeMenu()
  emit('delete')
}

function closeOnOutsideClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  if (menuEl.value?.contains(target)) return
  closeMenu()
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu()
}

onMounted(() => {
  document.addEventListener('click', closeOnOutsideClick)
  document.addEventListener('keydown', closeOnEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeOnOutsideClick)
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<template>
  <div ref="menuEl" class="product-brand-menu">
    <button
      type="button"
      class="product-brand product-brand--trigger"
      :class="{ 'product-brand--open': menuOpen }"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      @click.stop="toggleMenu"
    >
      <div class="product-brand__icon" aria-hidden="true">
        <PlantLogo class="product-brand__icon-glyph" :size="24" />
      </div>
      <span class="product-brand__title">{{ title }}</span>
      <svg class="product-brand__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
    <div
      v-show="menuOpen"
      class="product-brand-dropdown"
      role="menu"
    >
      <button
        type="button"
        class="product-brand-dropdown__item"
        role="menuitem"
        :disabled="renameDisabled"
        @click="onRename"
      >
        重命名
      </button>
      <div class="product-brand-dropdown__divider" role="separator" />
      <button
        type="button"
        class="product-brand-dropdown__item product-brand-dropdown__item--danger"
        role="menuitem"
        :disabled="deleteDisabled"
        @click="onDelete"
      >
        删除
      </button>
    </div>
  </div>
</template>

<style scoped>
.product-brand-menu {
  position: relative;
  min-width: 0;
}

.product-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.product-brand--trigger {
  margin: 0;
  padding: 4px 6px 4px 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--duration-fast, 120ms) var(--ease-out, ease);
}

.product-brand--trigger:hover,
.product-brand--open {
  background: var(--color-bg-hover);
}

.product-brand__icon {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm, 6px);
  background: #fff;
}

.product-brand__icon-glyph {
  width: 24px;
  height: 24px;
}

.product-brand__title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.product-brand__chevron {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
  transition: transform var(--duration-fast, 120ms) var(--ease-out, ease);
}

.product-brand--open .product-brand__chevron {
  transform: rotate(180deg);
}

.product-brand-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 200;
  min-width: 160px;
  padding: 4px 0;
  border-radius: 10px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
}

.product-brand-dropdown__item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 16px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.35;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast, 120ms) var(--ease-out, ease);
}

.product-brand-dropdown__item:hover:not(:disabled),
.product-brand-dropdown__item:focus-visible:not(:disabled) {
  outline: none;
  background: var(--color-bg-hover);
}

.product-brand-dropdown__item:disabled {
  cursor: default;
  opacity: 0.45;
}

.product-brand-dropdown__item--danger {
  color: #ff6b6b;
}

[data-theme='light'] .product-brand-dropdown__item--danger {
  color: #e03131;
}

.product-brand-dropdown__item--danger:hover:not(:disabled),
.product-brand-dropdown__item--danger:focus-visible:not(:disabled) {
  background: rgba(255, 107, 107, 0.12);
}

.product-brand-dropdown__divider {
  height: 1px;
  margin: 4px 0;
  background: var(--color-border-subtle);
}
</style>
