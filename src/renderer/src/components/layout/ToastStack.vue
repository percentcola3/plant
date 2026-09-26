<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { toasts } = storeToRefs(ui)

const KIND_CLASS: Record<string, string> = {
  success: 'bg-emerald-600 text-white border-emerald-700/40',
  error: 'bg-rose-600 text-white border-rose-700/40',
  info: 'bg-slate-900 text-white border-slate-950/40'
}

const KIND_ICON: Record<string, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ'
}

const KIND_LABEL: Record<string, string> = {
  success: '成功',
  error: '出错了',
  info: '提示'
}
</script>

<template>
  <Teleport to="body">
    <div class="
      fixed top-4 right-4 z-[90]
      flex flex-col gap-3
      pointer-events-none
    ">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="
            pointer-events-auto
            flex items-start gap-3
            min-w-[320px] max-w-[460px]
            px-4 py-3.5 rounded-xl
            text-[13px] leading-5 font-medium
            border shadow-[0_18px_38px_rgba(15,23,42,0.28)]
            cursor-pointer select-none
          "
          :class="KIND_CLASS[t.kind]"
          :title="'点击关闭'"
          @click="ui.dismissToast(t.id)"
        >
          <span class="
            mt-[2px] flex h-6 w-6 shrink-0 items-center justify-center
            rounded-full bg-white/20 text-sm font-semibold
          ">{{ KIND_ICON[t.kind] }}</span>
          <div class="min-w-0 flex-1">
            <div class="text-xxs uppercase tracking-[0.18em] opacity-80">{{ KIND_LABEL[t.kind] }}</div>
            <div class="mt-0.5 break-words">{{ t.message }}</div>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active { transition: all 0.22s ease; }
.toast-enter-from { opacity: 0; transform: translateX(24px); }
.toast-leave-to { opacity: 0; transform: translateX(24px); }
</style>
