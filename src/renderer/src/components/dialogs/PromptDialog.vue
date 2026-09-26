<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const ui = useUiStore()
const value = ref('')
const inputEl = ref<HTMLInputElement | HTMLTextAreaElement>()

const open = computed({
  get: () => !!ui.promptOpen,
  set: (v) => { if (!v) cancel() },
})
const selectedOptionLabel = computed(() =>
  ui.promptOpen?.options?.find((option) => option.value === value.value)?.label ?? ''
)

watch(
  () => ui.promptOpen,
  async (req) => {
    if (req) {
      value.value = req.defaultValue ?? req.options?.[0]?.value ?? ''
      await nextTick()
      if (!req.options?.length) {
        inputEl.value?.focus()
        inputEl.value?.select?.()
      }
    }
  },
)

function onSelectValue(nextValue: unknown): void {
  value.value = typeof nextValue === 'string' ? nextValue : ''
}

function submit(): void {
  ui.promptOpen?.onSubmit?.(value.value)
}

function cancel(): void {
  ui.promptOpen?.onSubmit?.(null)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[420px]" @keydown.esc="cancel">
      <DialogHeader>
        <DialogTitle>{{ ui.promptOpen?.title }}</DialogTitle>
      </DialogHeader>

      <p
        v-if="ui.promptOpen?.message"
        class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      >
        {{ ui.promptOpen.message }}
      </p>

      <Select
        v-if="ui.promptOpen?.options?.length"
        :model-value="value"
        @update:model-value="onSelectValue"
      >
        <SelectTrigger>
          <SelectValue :placeholder="ui.promptOpen?.placeholder ?? '请选择'">
            {{ selectedOptionLabel }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in ui.promptOpen.options"
            :key="option.value"
            :value="option.value"
          >
            <div class="min-w-0">
              <div class="truncate">{{ option.label }}</div>
              <div v-if="option.description" class="truncate text-xs text-muted-foreground">
                {{ option.description }}
              </div>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
      <Textarea
        v-else-if="ui.promptOpen?.multiline"
        ref="inputEl"
        v-model="value"
        rows="3"
        :placeholder="ui.promptOpen?.placeholder ?? ''"
        class="resize-none"
        @keydown.enter.exact.prevent="submit"
      />
      <Input
        v-else
        ref="inputEl"
        v-model="value"
        type="text"
        :placeholder="ui.promptOpen?.placeholder ?? ''"
        @keydown.enter="submit"
      />

      <DialogFooter>
        <Button variant="outline" @click="cancel">取消</Button>
        <Button @click="submit">
          {{ ui.promptOpen?.confirmLabel ?? '确定' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
