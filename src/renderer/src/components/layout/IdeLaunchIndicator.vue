<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { ideLaunching, ideLaunchLabel } = storeToRefs(ui)
</script>

<template>
  <Teleport to="body">
    <Transition name="ide-indicator">
      <div
        v-if="ideLaunching"
        class="
          fixed bottom-4 left-1/2 -translate-x-1/2 z-[65]
          flex items-center gap-2.5
          px-4 py-2.5 rounded-full
          bg-muted border border-border
          shadow-2xl
          text-sm
          pointer-events-none
        "
      >
        <span
          class="inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin"
        />
        <span>{{ ideLaunchLabel || '正在打开 IDE…' }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ide-indicator-enter-active,
.ide-indicator-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.ide-indicator-enter-from,
.ide-indicator-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
