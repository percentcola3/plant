<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const ui = useUiStore()

const open = computed({
  get: () => !!ui.startupEnvironmentNotice,
  set: (v) => { if (!v) ui.dismissStartupEnvironmentNotice() },
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>{{ ui.startupEnvironmentNotice?.title }}</DialogTitle>
      </DialogHeader>
      <ul class="space-y-2 text-sm text-muted-foreground leading-relaxed">
        <li
          v-for="item in ui.startupEnvironmentNotice?.items"
          :key="item"
          class="flex gap-2"
        >
          <span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span>{{ item }}</span>
        </li>
      </ul>
      <DialogFooter>
        <Button variant="outline" @click="ui.dismissStartupEnvironmentNotice">稍后处理</Button>
        <Button
          v-if="ui.startupEnvironmentNotice?.primaryActionLabel"
          @click="ui.openStartupEnvironmentGuide"
        >
          {{ ui.startupEnvironmentNotice.primaryActionLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
