<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <button
    type="button"
    class="topbar-settings-btn"
    aria-label="设置"
    aria-haspopup="dialog"
    @click="ui.openSettings()"
  >
    <Settings class="topbar-settings-btn__icon" aria-hidden="true" />
  </button>
</template>

<style scoped>
.topbar-settings-btn {
  display: flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background 180ms cubic-bezier(0.25, 0.1, 0.25, 1),
    color 180ms cubic-bezier(0.25, 0.1, 0.25, 1);
}

.topbar-settings-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.topbar-settings-btn:focus-visible {
  outline: 2px solid hsl(var(--ring) / 0.35);
  outline-offset: 2px;
}

.topbar-settings-btn__icon {
  width: 16px;
  height: 16px;
  stroke-width: 1.6px;
}
</style>
