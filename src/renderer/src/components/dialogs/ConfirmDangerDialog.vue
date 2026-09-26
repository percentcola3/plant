<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const ui = useUiStore()

const open = computed({
  get: () => !!ui.confirmDanger,
  set: (v) => { if (!v) ui.confirmDanger = null },
})

function confirm(): void {
  const cb = ui.confirmDanger?.onConfirm
  ui.confirmDanger = null
  cb?.()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle class="text-destructive">{{ ui.confirmDanger?.title }}</DialogTitle>
        <DialogDescription class="whitespace-pre-line leading-relaxed">
          {{ ui.confirmDanger?.message }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button variant="destructive" @click="confirm">
          {{ ui.confirmDanger?.confirmLabel ?? '确认' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
